// 回归测试：T22 + T4 IndexedDB 图标缓存、v1→v2 升级、7 天静默刷新、失败保留旧缓存、手动全量更新与淘汰策略
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { HTML, waitFor } = require('./helpers');

const active = [];
afterEach(() => {
  while (active.length) {
    try { active.pop().close(); } catch (e) {}
  }
});

// 内存版 IndexedDB mock，支持 version upgrade、wallpapers 与 icons 两个 objectStore
function createMemoryIDB(initialState = {}) {
  const state = {
    version: initialState.version || 0,
    stores: {}
  };
  if (initialState.stores) {
    Object.keys(initialState.stores).forEach((name) => {
      state.stores[name] = new Map(Object.entries(initialState.stores[name]));
    });
  }

  function makeDB() {
    return {
      objectStoreNames: {
        contains(name) { return Object.prototype.hasOwnProperty.call(state.stores, name); }
      },
      createObjectStore(name) {
        if (!state.stores[name]) state.stores[name] = new Map();
        return {};
      },
      transaction(storeName) {
        const map = state.stores[storeName];
        let scheduled = false;
        const tx = {
          _oncomplete: null,
          objectStore() {
            return {
              get(key) {
                const req = {};
                queueMicrotask(() => {
                  req.result = map ? map.get(key) : undefined;
                  if (req.onsuccess) req.onsuccess({ target: req });
                });
                return req;
              },
              getAll() {
                const req = {};
                queueMicrotask(() => {
                  req.result = map ? Array.from(map.values()) : [];
                  if (req.onsuccess) req.onsuccess({ target: req });
                });
                return req;
              },
              put(obj) {
                const key = obj.url || obj.id;
                if (map) map.set(key, obj);
                scheduleComplete();
                return {};
              },
              delete(key) {
                if (map) map.delete(key);
                scheduleComplete();
                return {};
              }
            };
          }
        };
        function scheduleComplete() {
          if (scheduled) return;
          scheduled = true;
          queueMicrotask(() => {
            if (tx._oncomplete) tx._oncomplete();
          });
        }
        Object.defineProperty(tx, 'oncomplete', {
          get() { return tx._oncomplete; },
          set(fn) {
            tx._oncomplete = fn;
            scheduleComplete();
          }
        });
        Object.defineProperty(tx, 'onerror', { set() {} });
        return tx;
      }
    };
  }

  const api = {
    open(_name, targetVersion) {
      const req = {};
      queueMicrotask(() => {
        const db = makeDB();
        if (targetVersion > state.version) {
          state.version = targetVersion;
          if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: db } });
        }
        req.result = db;
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    }
  };
  return { api, state };
}

function makeIconFetchStub(responder) {
  return (url, opts, window) => responder(String(url), opts, window);
}

function okPngResponse(window, bytes = [137, 80, 78, 71, 13, 10, 26, 10]) {
  const buf = new Uint8Array(bytes);
  return Promise.resolve({
    ok: true,
    status: 200,
    blob: () => Promise.resolve(new window.Blob([buf], { type: 'image/png' }))
  });
}

function bootWithIDB({ idb, seed, fetchStub } = {}) {
  const calls = [];
  const mem = idb || createMemoryIDB();
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://localhost/',
    pretendToBeVisual: true,
    beforeParse(window) {
      if (!window.AbortSignal.timeout) {
        window.AbortSignal.timeout = function (ms) {
          const c = new AbortController();
          setTimeout(() => c.abort(), ms);
          return c.signal;
        };
      }
      window.indexedDB = mem.api;
      if (seed) {
        Object.keys(seed).forEach((k) => {
          window.localStorage.setItem(k, seed[k]);
        });
      }
      window.fetch = function (url, opts) {
        calls.push(String(url));
        if (fetchStub) return fetchStub(String(url), opts, window);
        return okPngResponse(window);
      };
    }
  });
  active.push(dom.window);
  dom.window.alert = () => {};
  return { dom, window: dom.window, document: dom.window.document, calls, idb: mem };
}

test('IndexedDB 从 v1 升级到 v2 自动创建 icons store 且保留已有 wallpapers 数据', async () => {
  const mem = createMemoryIDB({
    version: 1,
    stores: {
      wallpapers: { wallpaper: { id: 'wallpaper', data: new Blob(['wp'], { type: 'image/png' }) } }
    }
  });
  const { window } = bootWithIDB({
    idb: mem,
    seed: {
      'newtab.shortcuts.v1': JSON.stringify([
        { name: '测试卡', url: 'https://example.com', iconSrc: 'image', icon: 'https://example.com/favicon.ico' }
      ])
    }
  });

  await waitFor(() => mem.state.version === 2 && mem.state.stores.icons && mem.state.stores.icons.has('https://example.com/favicon.ico'));
  assert.ok(mem.state.stores.wallpapers.has('wallpaper'), '既有壁纸数据应保留');
  const storedCards = JSON.parse(window.localStorage.getItem('newtab.shortcuts.v1'));
  assert.strictEqual(storedCards[0].icon, 'https://example.com/favicon.ico', 'localStorage 应保持轻量远程 URL 而非膨胀成 base64');
});

test('引擎图标（含百度/必应/谷歌 remit.ee）首次缓存到 IndexedDB，二次进入优先秒用且不重复拉取', async () => {
  const mem = createMemoryIDB();
  const googleRemitUrl = 'https://img.remit.ee/api/file/BQACAgUAAyEGAASHRsPbAAEX7J5qZdq2yzDGnGSV3J4cFDztxbAnNQACtyAAAj4IKVfVoyYBqFTwvT0E.jpeg';
  const first = bootWithIDB({
    idb: mem,
    seed: {
      'newtab.shortcuts.v1': JSON.stringify([
        { name: '卡片A', url: 'https://a.example', iconSrc: 'image', icon: 'https://a.example/icon.png' }
      ])
    }
  });

  await waitFor(() =>
    mem.state.stores.icons &&
    mem.state.stores.icons.has('https://www.baidu.com/favicon.ico') &&
    mem.state.stores.icons.has('https://www.bing.com/favicon.ico') &&
    mem.state.stores.icons.has(googleRemitUrl) &&
    mem.state.stores.icons.has('https://a.example/icon.png')
  );
  assert.ok(first.document.getElementById('engineIcon').src.startsWith('data:image/'), '主搜索引擎图标应切换为本地缓存 data URL');
  assert.ok(first.document.querySelector('.shortcut .tile img').src.startsWith('data:image/'), '卡片图标应切换为本地缓存 data URL');

  // 二次进入：命中 7 天有效缓存，不应再发网络请求
  const second = bootWithIDB({
    idb: mem,
    seed: {
      'newtab.shortcuts.v1': JSON.stringify([
        { name: '卡片A', url: 'https://a.example', iconSrc: 'image', icon: 'https://a.example/icon.png' }
      ])
    },
    fetchStub: () => Promise.reject(new Error('should not fetch fresh cache'))
  });

  await second.window.__motuo.iconCache.ready;
  await waitFor(() => second.document.getElementById('engineIcon').src.startsWith('data:image/'));
  assert.strictEqual(second.calls.length, 0, '未过期缓存不应再次发起网络请求');
  const googleImg = second.document.querySelector('#engineSelector .opt[data-engine="google"] img');
  assert.ok(googleImg && googleImg.src.startsWith('data:image/'), '谷歌 remit.ee 图标也应使用本地缓存');
});

test('过期缓存后台静默刷新：成功则更新，失败则保留旧缓存且不显示破图', async () => {
  const oldDataUrl = 'data:image/png;base64,OLD';
  const staleTime = Date.now() - 8 * 86400000;
  const mem = createMemoryIDB({
    version: 2,
    stores: {
      wallpapers: {},
      icons: {
        'https://ok.example/icon.png': { url: 'https://ok.example/icon.png', dataUrl: oldDataUrl, fetchedAt: staleTime, size: oldDataUrl.length },
        'https://fail.example/icon.png': { url: 'https://fail.example/icon.png', dataUrl: oldDataUrl, fetchedAt: staleTime, size: oldDataUrl.length }
      }
    }
  });

  const ctx = bootWithIDB({
    idb: mem,
    seed: {
      'newtab.shortcuts.v1': JSON.stringify([
        { name: '可更新', url: 'https://ok.example', iconSrc: 'image', icon: 'https://ok.example/icon.png' },
        { name: '会失败', url: 'https://fail.example', iconSrc: 'image', icon: 'https://fail.example/icon.png' }
      ])
    },
    fetchStub: makeIconFetchStub((url, _opts, window) => {
      if (url === 'https://ok.example/icon.png') return okPngResponse(window, [1, 2, 3, 4]);
      return Promise.resolve({ ok: false, status: 503 });
    })
  });

  await waitFor(() => {
    const okEntry = mem.state.stores.icons.get('https://ok.example/icon.png');
    return okEntry && okEntry.dataUrl !== oldDataUrl && ctx.calls.includes('https://fail.example/icon.png');
  });

  const failEntry = mem.state.stores.icons.get('https://fail.example/icon.png');
  assert.strictEqual(failEntry.dataUrl, oldDataUrl, '抓不到时必须保留旧缓存');
  const failCardImg = Array.from(ctx.document.querySelectorAll('.shortcut')).find((el) => el.querySelector('.label').textContent === '会失败').querySelector('img');
  assert.ok(failCardImg && failCardImg.src === oldDataUrl, '抓取失败的卡片仍应使用旧缓存展示，不破图');
});

test('通用配置「更新图标缓存」按钮强制全量重抓并展示结果', async () => {
  const oldDataUrl = 'data:image/png;base64,FRESHOLD';
  const freshTime = Date.now() - 60000; // 1 分钟前，未过期
  const mem = createMemoryIDB({
    version: 2,
    stores: {
      wallpapers: {},
      icons: {
        'https://card.example/i.png': { url: 'https://card.example/i.png', dataUrl: oldDataUrl, fetchedAt: freshTime, size: oldDataUrl.length }
      }
    }
  });

  let allowRefresh = false;
  const ctx = bootWithIDB({
    idb: mem,
    seed: {
      'newtab.shortcuts.v1': JSON.stringify([
        { name: '刷新卡', url: 'https://card.example', iconSrc: 'image', icon: 'https://card.example/i.png' }
      ])
    },
    fetchStub: makeIconFetchStub((url, _opts, window) => {
      if (!allowRefresh && url === 'https://card.example/i.png') return Promise.reject(new Error('unexpected'));
      if (url === 'https://card.example/i.png') return okPngResponse(window, [9, 8, 7, 6]);
      return okPngResponse(window);
    })
  });

  await ctx.window.__motuo.iconCache.ready;
  allowRefresh = true;
  ctx.document.getElementById('refreshIconsBtn').click();

  await waitFor(() => ctx.document.getElementById('refreshIconsStatus').textContent.includes('已更新'));
  assert.strictEqual(ctx.document.getElementById('refreshIconsStatus').textContent.includes('失败'), false, '全部成功时不应报失败');
  const updated = mem.state.stores.icons.get('https://card.example/i.png');
  assert.notStrictEqual(updated.dataUrl, oldDataUrl, '强制刷新应替换未过期旧缓存');
});

test('图标缓存超过 200 条上限时按时间优先淘汰未被引用的旧缓存', async () => {
  const initialIcons = {};
  const baseTs = Date.now() - 1000000;
  for (let i = 0; i < 205; i++) {
    const u = 'https://old' + i + '.example/i.png';
    initialIcons[u] = { url: u, dataUrl: 'data:image/png;base64,AA==', fetchedAt: baseTs + i, size: 26 };
  }
  const mem = createMemoryIDB({
    version: 2,
    stores: { wallpapers: {}, icons: initialIcons }
  });

  const ctx = bootWithIDB({
    idb: mem,
    seed: {
      'newtab.shortcuts.v1': JSON.stringify([
        { name: '新卡', url: 'https://new.example', iconSrc: 'image', icon: 'https://new.example/i.png' }
      ])
    }
  });

  await waitFor(() => mem.state.stores.icons.has('https://new.example/i.png') && mem.state.stores.icons.size <= 200);
  assert.ok(mem.state.stores.icons.size <= 200, '缓存总数应被裁剪到 200 条以内');
  assert.strictEqual(mem.state.stores.icons.has('https://old0.example/i.png'), false, '最早未被引用的记录应优先淘汰');
  assert.ok(mem.state.stores.icons.has('https://new.example/i.png'), '当前被引用的图标应保留');
});
