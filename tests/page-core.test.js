// 非 AI 主路径：卡片增删改、主题、搜索历史与站内直达、导出备份
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { setupWindow, waitFor, readShortcuts } = require('./helpers');

const active = [];
afterEach(() => {
  while (active.length) {
    try { active.pop().close(); } catch (e) {}
  }
});

function boot(opts) {
  const ctx = setupWindow(opts || {});
  active.push(ctx.window);
  ctx.window.alert = () => {};
  return ctx;
}

function cardByName(document, name) {
  return Array.from(document.querySelectorAll('.shortcut')).find((el) => {
    const label = el.querySelector('.label');
    return label && label.textContent === name;
  });
}

function addColorCard(window, document, name, url) {
  document.getElementById('addSlot').click();
  document.getElementById('addName').value = name;
  document.getElementById('addUrl').value = url;
  const color = document.querySelector('input[name="iconSrc"][value="color"]');
  color.checked = true;
  color.dispatchEvent(new window.Event('change', { bubbles: true }));
  document.getElementById('addLetter').value = '测';
  document.getElementById('addForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

test('添加、改名、删除一张快捷方式会写回存储和页面', async () => {
  const { window, document } = boot();
  const before = readShortcuts(window).length;
  addColorCard(window, document, '测试站', 'https://example.com/path');

  const saved = readShortcuts(window);
  assert.strictEqual(saved.length, before + 1);
  const item = saved.find((it) => it.name === '测试站');
  assert.ok(item, '存储里应有新卡片');
  assert.strictEqual(item.url, 'https://example.com/path');
  assert.strictEqual(item.iconSrc, 'color');
  assert.strictEqual(item.letter, '测');
  assert.ok(cardByName(document, '测试站'), '页面上应出现新卡片');

  const card = cardByName(document, '测试站');
  card.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 8, clientY: 8 }));
  document.querySelector('#ctxMenu button[data-action="edit"]').click();
  assert.strictEqual(document.getElementById('addName').value, '测试站');
  document.getElementById('addName').value = '改名站';
  document.getElementById('addForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  assert.strictEqual(readShortcuts(window).filter((it) => it.name === '测试站').length, 0);
  const renamed = readShortcuts(window).find((it) => it.name === '改名站');
  assert.ok(renamed, '改名应写回同一条');
  assert.strictEqual(renamed.url, 'https://example.com/path');
  assert.ok(cardByName(document, '改名站'));
  assert.strictEqual(readShortcuts(window).length, before + 1, '改名不应多出一张卡');

  cardByName(document, '改名站').dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 8, clientY: 8 }));
  document.querySelector('#ctxMenu button[data-action="delete"]').click();
  assert.strictEqual(readShortcuts(window).some((it) => it.name === '改名站'), false);
  assert.strictEqual(readShortcuts(window).length, before);
  await waitFor(() => !cardByName(document, '改名站'));
});

test('主题按钮写入 data-theme，再次打开沿用已保存的模式', () => {
  const first = boot();
  assert.strictEqual(first.document.documentElement.getAttribute('data-theme'), 'light');
  first.document.querySelector('.theme-btn[data-theme="dark"]').click();
  assert.strictEqual(first.document.documentElement.getAttribute('data-theme'), 'dark');
  assert.strictEqual(first.window.localStorage.getItem('newtab.theme.v1'), 'dark');
  assert.ok(first.document.querySelector('.theme-btn[data-theme="dark"]').classList.contains('active'));

  const again = boot({ seed: { 'newtab.theme.v1': 'auto' } });
  assert.strictEqual(again.document.documentElement.getAttribute('data-theme'), 'auto');
  assert.ok(again.document.querySelector('.theme-btn[data-theme="auto"]').classList.contains('active'));
});

test('普通搜索写入历史，站内直达不写入', () => {
  const { window, document } = boot();
  const form = document.getElementById('searchForm');
  const input = document.getElementById('searchInput');

  input.value = '天气';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const history = JSON.parse(window.localStorage.getItem('newtab.searchHistory.v1') || '[]');
  assert.ok(history.includes('天气'), '普通搜索应记入历史');

  input.value = 'zh Node.js';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const after = JSON.parse(window.localStorage.getItem('newtab.searchHistory.v1') || '[]');
  assert.ok(!after.some((q) => String(q).includes('zh ')), '站内直达不应记成一条搜索历史');
});

function installWallpaperDB(window) {
  window.indexedDB = {
    open() {
      const request = {};
      const db = {
        objectStoreNames: { contains() { return true; } },
        transaction() {
          const tx = {
            objectStore() {
              return {
                get() {
                  const result = {};
                  queueMicrotask(() => {
                    result.result = undefined;
                    if (result.onsuccess) result.onsuccess({ target: result });
                  });
                  return result;
                }
              };
            }
          };
          Object.defineProperty(tx, 'oncomplete', { set(fn) { queueMicrotask(() => fn && fn()); } });
          Object.defineProperty(tx, 'onerror', { set() {} });
          return tx;
        }
      };
      queueMicrotask(() => {
        request.result = db;
        if (request.onsuccess) request.onsuccess({ target: request });
      });
      return request;
    }
  };
}

test('导出备份包含当前快捷方式和版本号', async () => {
  const { window, document } = boot();
  installWallpaperDB(window);
  addColorCard(window, document, '导出站', 'https://export.example');
  let text = '';
  window.URL.createObjectURL = (blob) => {
    blob.text().then((t) => { text = t; });
    return 'blob:mock';
  };
  window.URL.revokeObjectURL = () => {};
  document.getElementById('exportBtn').click();
  await waitFor(() => text.includes('导出站'));
  const payload = JSON.parse(text);
  assert.strictEqual(payload.app, 'Motuo-Tab');
  assert.strictEqual(payload.version, 2);
  assert.ok(payload.data.items.some((it) => it.name === '导出站' && it.url === 'https://export.example'));
  assert.ok(payload.data.settings, '备份应带上个性化设置');
  assert.ok(payload.data.ai, '备份应带上 AI 配置槽');
});
