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
  assert.strictEqual(payload.data.settings.theme, 'light', '导出备份应包含主题模式');
  assert.ok(payload.data.ai, '备份应带上 AI 配置槽');
});

test('切换编辑模式保留菜单图标并正确切换文案', () => {
  const { window, document } = boot();
  const editBtn = document.getElementById('editBtn');
  assert.strictEqual(editBtn.querySelectorAll('svg').length, 2);
  editBtn.click();
  assert.strictEqual(editBtn.querySelectorAll('svg').length, 2, '进入编辑模式后图标 SVG 应保留');
  assert.strictEqual(editBtn.querySelector('.mi-label').textContent, '退出编辑');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  assert.strictEqual(editBtn.querySelectorAll('svg').length, 2, 'Ctrl+K 退出编辑后图标 SVG 应保留');
  assert.strictEqual(editBtn.querySelector('.mi-label').textContent, '编辑页面');
});

test('同名卡片拖拽排序不覆盖且图片图标失败自动降级', () => {
  const { window, document } = boot();
  addColorCard(window, document, '同名卡', 'https://first.example');
  addColorCard(window, document, '同名卡', 'https://second.example');
  document.getElementById('editBtn').click();

  const cards = Array.from(document.querySelectorAll('.shortcut'));
  const firstCard = cards[cards.length - 2];
  const secondCard = cards[cards.length - 1];
  assert.strictEqual(firstCard.getAttribute('href'), 'https://first.example');
  assert.strictEqual(secondCard.getAttribute('href'), 'https://second.example');

  // 模拟把第一张同名卡拖到第二张同名卡之后
  secondCard.getBoundingClientRect = () => ({ left: 100, top: 0, width: 80, height: 80 });
  const nav = document.querySelector('.shortcuts');
  const dt = { effectAllowed: 'move', dropEffect: 'move', setData() {} };
  firstCard.dispatchEvent(Object.assign(new window.Event('dragstart', { bubbles: true }), { dataTransfer: dt }));
  secondCard.dispatchEvent(Object.assign(new window.MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 160 }), { dataTransfer: dt }));

  const saved = readShortcuts(window);
  const same = saved.filter((it) => it.name === '同名卡');
  assert.strictEqual(same.length, 2, '两张同名卡都应保留');
  assert.strictEqual(same[0].url, 'https://second.example');
  assert.strictEqual(same[1].url, 'https://first.example');

  // 测试远程图标加载失败自动降级为首字卡片且不破坏存储
  const imgCard = cardByName(document, '知乎');
  const img = imgCard.querySelector('.tile img');
  assert.ok(img, '知乎卡片应包含图片图标');
  img.dispatchEvent(new window.Event('error'));
  assert.strictEqual(imgCard.querySelector('.tile img'), null, '失败后应移除破图');
  assert.strictEqual(imgCard.querySelector('.tile').textContent, '知', '失败后应展示首字兜底');
  const storedZhihu = readShortcuts(window).find((it) => it.name === '知乎');
  assert.strictEqual(storedZhihu.iconSrc, 'image', 'DOM 降级不应覆盖原存储配置');
});

test('自定义搜索引擎渲染对危险字符转义', () => {
  const { document } = boot();
  document.getElementById('engineName').value = '<img src=x onerror=alert(1)>';
  document.getElementById('engineUrl').value = 'https://s.example/?q=%s';
  document.getElementById('engineIcon').value = 'javascript:alert(1)';
  document.getElementById('engineAddBtn').click();

  const selector = document.getElementById('engineSelector');
  const list = document.getElementById('customEngineList');
  assert.strictEqual(selector.querySelectorAll('img[onerror]').length, 0, '下拉不应注入 img 标签');
  assert.strictEqual(list.querySelectorAll('img[onerror]').length, 0, '列表不应注入 img 标签');
  assert.strictEqual(selector.querySelectorAll('img[src^="javascript:"]').length, 0, '不应允许 javascript: 图标');
  assert.ok(selector.textContent.includes('<img src=x onerror=alert(1)>'), '名称应作为纯文本展示');
});

test('超过 30 天未导出显示温和备份提醒，稍后或导出后消退', async () => {
  const fresh = boot();
  assert.strictEqual(fresh.document.getElementById('fabBtn').classList.contains('has-backup-dot'), false, '新用户不应立即提醒');
  assert.strictEqual(fresh.document.getElementById('backupReminderBar').hidden, true);

  const staleTs = Date.now() - 35 * 86400000;
  const stale = boot({
    seed: { 'newtab.backupMeta.v1': JSON.stringify({ firstSeenAt: staleTs, lastExportAt: 0, dismissedAt: 0 }) }
  });
  installWallpaperDB(stale.window);
  assert.strictEqual(stale.document.getElementById('fabBtn').classList.contains('has-backup-dot'), true, '超 30 天应显示菜单角标');
  assert.strictEqual(stale.document.getElementById('generalConfigBtn').classList.contains('has-backup-dot'), true, '通用配置项应显示角标');
  assert.strictEqual(stale.document.getElementById('backupReminderBar').hidden, false, '通用配置弹窗内应显示提示条');

  stale.document.getElementById('backupRemindLater').click();
  assert.strictEqual(stale.document.getElementById('fabBtn').classList.contains('has-backup-dot'), false, '点稍后应隐藏角标');
  assert.strictEqual(stale.document.getElementById('backupReminderBar').hidden, true, '点稍后应隐藏提示条');
  const metaAfterLater = JSON.parse(stale.window.localStorage.getItem('newtab.backupMeta.v1'));
  assert.ok(metaAfterLater.dismissedAt > 0, '应记录稍后时间戳');

  const stale2 = boot({
    seed: { 'newtab.backupMeta.v1': JSON.stringify({ firstSeenAt: staleTs, lastExportAt: 0, dismissedAt: 0 }) }
  });
  installWallpaperDB(stale2.window);
  stale2.window.URL.createObjectURL = () => 'blob:mock';
  stale2.window.URL.revokeObjectURL = () => {};
  stale2.document.getElementById('backupRemindExport').click();
  await waitFor(() => !stale2.document.getElementById('fabBtn').classList.contains('has-backup-dot'));
  const metaAfterExport = JSON.parse(stale2.window.localStorage.getItem('newtab.backupMeta.v1'));
  assert.ok(metaAfterExport.lastExportAt > 0, '导出后应更新 lastExportAt');
  assert.strictEqual(stale2.document.getElementById('backupReminderBar').hidden, true, '导出后应隐藏提示条');
});
