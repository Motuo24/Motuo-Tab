// 回归测试：T22 + T4 IndexedDB 图标缓存、v1→v2 升级、7 天静默刷新、失败保留旧缓存、手动全量更新与淘汰策略
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
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

test('内置引擎使用透明底矢量 SVG 图标且免网络请求，自定义引擎与卡片图标首次缓存到 IndexedDB 后二次秒用', async () => {
  const mem = createMemoryIDB();
  const customEngineIconUrl = 'https://custom-engine.example/icon.png';
  const first = bootWithIDB({
    idb: mem,
    seed: {
      'newtab.customEngines.v1': JSON.stringify([
        { name: '自定义搜索', url: 'https://custom-engine.example/?q=%s', icon: customEngineIconUrl }
      ]),
      'newtab.shortcuts.v1': JSON.stringify([
        { name: '卡片A', url: 'https://a.example', iconSrc: 'image', icon: 'https://a.example/icon.png' }
      ])
    }
  });

  // 内置三大引擎（百度/必应/谷歌）均直接内置透明底 SVG data URL
  assert.ok(first.document.getElementById('engineIcon').src.startsWith('data:image/svg+xml'), '主搜索引擎默认图标应为内嵌透明 SVG');
  for (const key of ['baidu', 'bing', 'google']) {
    const img = first.document.querySelector(`#engineSelector .opt[data-engine="${key}"] img`);
    assert.ok(img && img.src.startsWith('data:image/svg+xml'), `${key} 引擎图标应为内嵌透明 SVG`);
  }

  await waitFor(() =>
    mem.state.stores.icons &&
    mem.state.stores.icons.has(customEngineIconUrl) &&
    mem.state.stores.icons.has('https://a.example/icon.png')
  );
  assert.strictEqual(first.calls.some((u) => /baidu\.com\/favicon|bing\.com\/favicon|remit\.ee/.test(u)), false, '内置引擎图标不应额外发起外网请求');
  const customOptFirst = first.document.querySelector('#engineSelector .opt.custom-opt img');
  assert.ok(customOptFirst && customOptFirst.src.startsWith('data:image/'), '自定义引擎远程图标应切换为本地缓存 data URL');
  assert.ok(first.document.querySelector('.shortcut .tile img').src.startsWith('data:image/'), '卡片图标应切换为本地缓存 data URL');

  // 二次进入：命中 7 天有效缓存，不应再发网络请求
  const second = bootWithIDB({
    idb: mem,
    seed: {
      'newtab.customEngines.v1': JSON.stringify([
        { name: '自定义搜索', url: 'https://custom-engine.example/?q=%s', icon: customEngineIconUrl }
      ]),
      'newtab.shortcuts.v1': JSON.stringify([
        { name: '卡片A', url: 'https://a.example', iconSrc: 'image', icon: 'https://a.example/icon.png' }
      ])
    },
    fetchStub: () => Promise.reject(new Error('should not fetch fresh cache'))
  });

  await second.window.__motuo.iconCache.ready;
  await waitFor(() => second.document.querySelector('#engineSelector .opt.custom-opt img').src.startsWith('data:image/'));
  assert.strictEqual(second.calls.length, 0, '未过期缓存不应再次发起网络请求');
  const customOptSecond = second.document.querySelector('#engineSelector .opt.custom-opt img');
  assert.ok(customOptSecond && customOptSecond.src.startsWith('data:image/'), '自定义引擎图标二次进入也应使用本地缓存');
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

function makePixelBuffer(w, h, filler) {
  const buf = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = filler(x, y);
      const i = (y * w + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
    }
  }
  return buf;
}

test('SVG 图标清洗：消除全画布浅色底（内联/百分比/CSS类/根样式），保留深色彩色徽标与全白剪影', async () => {
  const ctx = bootWithIDB({ seed: { 'newtab.shortcuts.v1': '[]' } });
  await ctx.window.__motuo.iconCache.ready;
  const { cleanSvgMarkup, cleanSvgDataUrl } = ctx.window.__motuo.iconCache;

  // 1. #fff / 100% / <style> class / root background 各种形式
  const svgRectWhite = '<svg viewBox="0 0 32 32"><rect width="32" height="32" fill="#fff"/><path d="M4 4h24v24H4z" fill="#1e6cff"/></svg>';
  const cleanedRect = cleanSvgMarkup(svgRectWhite);
  assert.strictEqual(cleanedRect.includes('#fff'), false, '应移除 #fff 满画布背景 rect');
  assert.ok(cleanedRect.includes('#1e6cff'), '应保留前景图形');

  const svgPct = '<svg viewBox="0 0 64 64"><rect x="0" y="0" width="100%" height="100%" fill="#ffffff"/><circle cx="32" cy="32" r="18" fill="#10b981"/></svg>';
  assert.strictEqual(cleanSvgMarkup(svgPct).includes('#ffffff'), false, '应移除 100% 白色背景 rect');

  const svgStyleCls = '<svg viewBox="0 0 32 32"><style>.cls-bg{fill:#fafafa;}.cls-fg{fill:#2468f2;}</style><rect class="cls-bg" width="32" height="32"/><circle class="cls-fg" cx="16" cy="16" r="10"/></svg>';
  const cleanedCls = cleanSvgMarkup(svgStyleCls);
  assert.strictEqual(cleanedCls.includes('class="cls-bg"'), false, '应识别 <style> 浅中性色类并移除背景 rect');
  assert.ok(cleanedCls.includes('cls-fg'), '前景圆形应保留');

  const svgRootStyle = '<svg viewBox="0 0 24 24" style="background:#ffffff; display:block"><path fill="#ef4444" d="M2 2h20v20H2z"/></svg>';
  const cleanedRoot = cleanSvgMarkup(svgRootStyle);
  assert.strictEqual(/background\s*:\s*#ffffff/i.test(cleanedRoot), false, '应清理 root svg 白色 background');
  assert.ok(cleanedRoot.includes('#ef4444'), '应保留前景 path');

  // 2. base64 与 UTF-8 SVG data URL 清洗
  const b64In = 'data:image/svg+xml;base64,' + Buffer.from(svgPct, 'utf8').toString('base64');
  const b64Out = cleanSvgDataUrl(b64In);
  assert.strictEqual(b64Out.changed, true);
  assert.strictEqual(Buffer.from(b64Out.dataUrl.split(',')[1], 'base64').toString('utf8').includes('#ffffff'), false);

  const utfIn = 'data:image/svg+xml,' + encodeURIComponent(svgRectWhite);
  const utfOut = cleanSvgDataUrl(utfIn);
  assert.strictEqual(utfOut.changed, true);
  assert.strictEqual(decodeURIComponent(utfOut.dataUrl.split(',')[1]).includes('#fff'), false);

  // 3. 彩色/黑色实底品牌徽标保留
  const blueBadge = '<svg viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#2468f2"/><path d="M8 8h16v16H8z" fill="#ffffff"/></svg>';
  assert.strictEqual(cleanSvgMarkup(blueBadge), blueBadge, '蓝色品牌圆角方底不应被删');
  const blackBadge = '<svg viewBox="0 0 32 32"><rect width="32" height="32" fill="#000000"/><circle cx="16" cy="16" r="8" fill="#ffffff"/></svg>';
  assert.strictEqual(cleanSvgMarkup(blackBadge), blackBadge, '黑色品牌实底不应被删');

  // 4. 全白单色剪影防误删保护
  const whiteOnly = '<svg viewBox="0 0 32 32"><rect width="32" height="32" fill="#ffffff"/></svg>';
  assert.strictEqual(cleanSvgMarkup(whiteOnly), whiteOnly, '仅剩唯一白色形状时应保护不删');
});

test('光栅像素清洗 cleanIconImageData：剥除顶部黑线与浅白/浅灰底，保护深色徽标/封闭内白洞/四边线框/全白剪影', async () => {
  const ctx = bootWithIDB({ seed: { 'newtab.shortcuts.v1': '[]' } });
  await ctx.window.__motuo.iconCache.ready;
  const { cleanIconImageData } = ctx.window.__motuo.iconCache;

  // 1. 顶部 1px 纯黑杂线 + 纯白底 + 中央深色图形（模拟 基元律动）
  const w = 16, h = 16;
  const rhythmLike = makePixelBuffer(w, h, (x, y) => {
    if (y === 0) return [0, 0, 0, 255];
    if (x >= 5 && x <= 10 && y >= 5 && y <= 10) return [60, 60, 60, 255];
    return [255, 255, 255, 255];
  });
  const res1 = cleanIconImageData(rhythmLike, w, h);
  assert.strictEqual(res1.changed, true);
  assert.strictEqual(res1.data[0 * w * 4 + 3], 0, '顶部黑线像素应变透明');
  assert.strictEqual(res1.data[(1 * w + 1) * 4 + 3], 0, '外围纯白背景应变透明');
  assert.strictEqual(res1.data[(7 * w + 7) * 4 + 3], 255, '中央深色主体应完整保留');

  // 2. 透明底 + 顶部 1px 黑线（模拟 Roogoo）
  const roogooLike = makePixelBuffer(w, h, (x, y) => {
    if (y === 0) return [0, 0, 0, 255];
    if (x >= 5 && x <= 10 && y >= 5 && y <= 10) return [40, 140, 255, 255];
    return [0, 0, 0, 0];
  });
  const res2 = cleanIconImageData(roogooLike, w, h);
  assert.strictEqual(res2.changed, true);
  assert.strictEqual(res2.data[(0 * w + 8) * 4 + 3], 0, '独立顶部黑线应消除');
  assert.strictEqual(res2.data[(7 * w + 7) * 4 + 3], 255, '蓝色图标主体应保留');

  // 3. 顶部黑线 + 浅灰底(225,225,225) + 闭合深色环内保留纯白镂空（如 Cursor）
  const grayBgClosedRing = makePixelBuffer(w, h, (x, y) => {
    if (y === 0) return [0, 0, 0, 255];
    const inOuter = x >= 4 && x <= 11 && y >= 4 && y <= 11;
    const inInner = x >= 6 && x <= 9 && y >= 6 && y <= 9;
    if (inInner) return [255, 255, 255, 255];
    if (inOuter) return [20, 20, 20, 255];
    return [225, 225, 225, 255];
  });
  const res3 = cleanIconImageData(grayBgClosedRing, w, h);
  assert.strictEqual(res3.changed, true);
  assert.strictEqual(res3.data[(2 * w + 2) * 4 + 3], 0, '外围浅灰背景应变透明');
  assert.strictEqual(res3.data[(7 * w + 7) * 4 + 3], 255, '闭合图形内部的纯白细节不应被洪泛消掉');

  // 4. 实底深色/蓝色品牌徽标完全保留
  const blackBadge = makePixelBuffer(w, h, (x, y) => (
    (x >= 5 && x <= 10 && y >= 5 && y <= 10) ? [255, 255, 255, 255] : [18, 18, 22, 255]
  ));
  assert.strictEqual(cleanIconImageData(blackBadge, w, h).changed, false, '黑色方底品牌图标应原样保留');

  const blueBadge = makePixelBuffer(w, h, (x, y) => (
    (x >= 5 && x <= 10 && y >= 5 && y <= 10) ? [255, 255, 255, 255] : [0, 102, 255, 255]
  ));
  assert.strictEqual(cleanIconImageData(blueBadge, w, h).changed, false, '蓝色方底品牌图标应原样保留');

  // 5. 刻意四边细框不应被误认为四条杂线删光
  const framedBox = makePixelBuffer(w, h, (x, y) => {
    if (x === 0 || x === w - 1 || y === 0 || y === h - 1) return [0, 0, 0, 255];
    return [255, 255, 255, 255];
  });
  assert.strictEqual(cleanIconImageData(framedBox, w, h).changed, false, '完整四边边框应受保护不误删');

  // 6. 纯白图形占满实体时不触发全删
  const allWhiteSolid = makePixelBuffer(w, h, () => [255, 255, 255, 255]);
  assert.strictEqual(cleanIconImageData(allWhiteSolid, w, h).changed, false, '纯白图形应触发防全删保护');
});

test('既有 IndexedDB 历史缓存缺少 cleanVer 时，启动即在本地无感清理且 0 网络请求', async () => {
  const dirtySvg = '<svg viewBox="0 0 32 32"><rect width="100%" height="100%" fill="#ffffff"/><path fill="#2468f2" d="M4 4h24v24H4z"/></svg>';
  const dirtyDataUrl = 'data:image/svg+xml;base64,' + Buffer.from(dirtySvg, 'utf8').toString('base64');
  const mem = createMemoryIDB({
    version: 2,
    stores: {
      wallpapers: {},
      icons: {
        'https://svg.example/icon.svg': {
          url: 'https://svg.example/icon.svg',
          dataUrl: dirtyDataUrl,
          fetchedAt: Date.now() - 60000,
          size: dirtyDataUrl.length
        }
      }
    }
  });

  const ctx = bootWithIDB({
    idb: mem,
    seed: {
      'newtab.shortcuts.v1': JSON.stringify([
        { name: 'SVG站', url: 'https://svg.example', iconSrc: 'image', icon: 'https://svg.example/icon.svg' }
      ])
    },
    fetchStub: () => Promise.reject(new Error('should not fetch cached entry'))
  });

  await waitFor(() => {
    const entry = mem.state.stores.icons.get('https://svg.example/icon.svg');
    return entry && entry.cleanVer === 1 && entry.dataUrl !== dirtyDataUrl;
  });

  assert.strictEqual(ctx.calls.length, 0, '升级历史缓存应纯本地完成，不应发起网络请求');
  const upgraded = mem.state.stores.icons.get('https://svg.example/icon.svg');
  const decoded = Buffer.from(upgraded.dataUrl.split(',')[1], 'base64').toString('utf8');
  assert.strictEqual(decoded.includes('#ffffff'), false, 'IndexedDB 内缓存的 SVG 应已清除白色底框');
  const imgEl = ctx.document.querySelector('.shortcut .tile img');
  assert.strictEqual(imgEl.src, upgraded.dataUrl, '页面渲染的图标应已切换为清理后的 data URL');
});

test('0.9.2.1 版本号及精修内置 PNG 图标资源完整性校验', () => {
  const rootDir = path.join(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'dist', 'extension', 'manifest.json'), 'utf8'));
  assert.strictEqual(manifest.version, '0.9.2.1');
  assert.ok(HTML.includes('v0.9.2.1'), 'dist/newtab.html 应包含 v0.9.2.1 版本展示');

  const mainSrc = fs.readFileSync(path.join(rootDir, 'src', 'scripts', 'main.js'), 'utf8');
  ['default-rhythm.png', 'default-roogoo.png', 'default-bocha.png'].forEach((fname) => {
    assert.ok(mainSrc.includes('__ASSET_' + fname + '__'), `src/scripts/main.js 应引用 ${fname}`);
    const assetBytes = fs.readFileSync(path.join(rootDir, 'src', 'assets', fname));
    assert.ok(assetBytes.length > 1000, `${fname} 应为有效非空图像`);
    assert.deepStrictEqual(Array.from(assetBytes.slice(0, 4)), [137, 80, 78, 71], `${fname} 应为标准 PNG 文件`);
  });
});
