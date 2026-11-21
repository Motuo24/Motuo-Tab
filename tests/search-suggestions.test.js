// T2 回归测试：搜索建议 = 本地历史（永远在前）+ 百度联网建议（去重在后）+ 键盘导航
// 传输层经 window.__debug.search.setTransport 注入（jsdom 无法发真实 JSONP）
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { setupWindow, sleep } = require('./helpers');

const activeWindows = [];
afterEach(() => {
  while (activeWindows.length) {
    const w = activeWindows.pop();
    try { w.close(); } catch (e) { /* ignore */ }
  }
});

function boot(opts = {}) {
  const ctx = setupWindow(opts);
  activeWindows.push(ctx.window);
  const { window, document } = ctx;
  window.alert = () => {};
  // 拦截表单提交，避免 jsdom 导航噪音
  document.getElementById('searchForm').addEventListener('submit', (e) => e.preventDefault());
  return ctx;
}

function type(ctx, text) {
  const input = ctx.document.getElementById('searchInput');
  input.value = text;
  input.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  return input;
}

function key(ctx, input, k) {
  input.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

// 立即返回固定结果的传输层 stub
function instantTransport(list) {
  return (q, done) => done(list);
}

// 记录调用次数/参数的 spy 传输层
function spyTransport() {
  const calls = [];
  const fn = (q, done) => { calls.push({ q, done }); };
  fn.calls = calls;
  return fn;
}

// 跨 realm 归一化：jsdom window 里的数组原型与 Node 不同，deepStrictEqual 会误判
function merged(ctx) { return JSON.parse(JSON.stringify(ctx.window.__debug.search.getMerged())); }
function sugEl(ctx) { return ctx.document.getElementById('searchSuggestions'); }

test('历史永远在前，联网去重在后，来源标记与分隔线齐全', async () => {
  const ctx = boot({ seed: { 'newtab.searchHistory.v1': JSON.stringify(['node.js', 'nodejs 教程']) } });
  ctx.window.__debug.search.setTransport(instantTransport(['node.js', 'node video', 'nodeseek']));
  type(ctx, 'node');
  await sleep(300); // 防抖 200ms

  const m = merged(ctx);
  assert.deepStrictEqual(m.map((x) => x.source), ['history', 'history', 'online', 'online'], '历史组必须整体在前');
  assert.deepStrictEqual(m.map((x) => x.text), ['node.js', 'nodejs 教程', 'node video', 'nodeseek'], '与历史重复的联网建议应被去掉');

  const rows = sugEl(ctx).querySelectorAll('.sg-item');
  assert.strictEqual(rows.length, 4);
  assert.strictEqual(rows[0].dataset.source, 'history');
  assert.strictEqual(rows[2].dataset.source, 'online');
  assert.strictEqual(rows[0].querySelector('.sg-src').textContent, '历史', '历史行来源小字');
  assert.strictEqual(rows[2].querySelector('.sg-src').textContent, '百度', '联网行来源小字');
  assert.ok(rows[0].querySelector('.sg-del'), '历史行可单条删除');
  assert.strictEqual(rows[2].querySelector('.sg-del'), null, '联网行无删除按钮');
  assert.ok(sugEl(ctx).querySelector('.sg-divider'), '两组之间应有分隔线');
});

test('去重不区分大小写', async () => {
  const ctx = boot({ seed: { 'newtab.searchHistory.v1': JSON.stringify(['Node.js']) } });
  ctx.window.__debug.search.setTransport(instantTransport(['node.js', 'NODE.JS', '其它建议']));
  type(ctx, 'node');
  await sleep(300);
  const online = merged(ctx).filter((x) => x.source === 'online').map((x) => x.text);
  assert.deepStrictEqual(online, ['其它建议']);
});

test('键盘 ↓↓ 选中第二项，Enter 执行选中项', async () => {
  const ctx = boot({ seed: { 'newtab.searchHistory.v1': JSON.stringify(['alpha', 'beta']) } });
  ctx.window.__debug.search.setTransport(() => {}); // 联网永不返回
  const input = type(ctx, 'a');
  await sleep(250);
  assert.strictEqual(merged(ctx).length, 2);

  key(ctx, input, 'ArrowDown');
  key(ctx, input, 'ArrowDown');
  assert.strictEqual(ctx.window.__debug.search.getActive(), 1);
  assert.strictEqual(input.getAttribute('aria-activedescendant'), 'sg-opt-1', 'aria 选中态应跟随');
  assert.ok(sugEl(ctx).querySelectorAll('.sg-item')[1].classList.contains('active'));

  key(ctx, input, 'Enter');
  assert.strictEqual(input.value, 'beta', 'Enter 应把选中项填入输入框并提交');
  assert.ok(!sugEl(ctx).classList.contains('open'), '提交后下拉关闭');
});

test('未选中时 ArrowUp 循环到最后一项', async () => {
  const ctx = boot({ seed: { 'newtab.searchHistory.v1': JSON.stringify(['alpha', 'beta']) } });
  ctx.window.__debug.search.setTransport(() => {});
  const input = type(ctx, 'a');
  await sleep(250);
  key(ctx, input, 'ArrowUp');
  assert.strictEqual(ctx.window.__debug.search.getActive(), 1);
});

test('Esc 关闭建议下拉', async () => {
  const ctx = boot({ seed: { 'newtab.searchHistory.v1': JSON.stringify(['alpha']) } });
  ctx.window.__debug.search.setTransport(() => {});
  const input = type(ctx, 'a');
  await sleep(250);
  assert.ok(sugEl(ctx).classList.contains('open'));
  key(ctx, input, 'Escape');
  assert.ok(!sugEl(ctx).classList.contains('open'));
});

test('开关关闭后不请求联网，仅本地历史', async () => {
  const ctx = boot({ seed: {
    'newtab.searchHistory.v1': JSON.stringify(['node.js']),
    'newtab.suggestOnline.v1': '0'
  } });
  const spy = spyTransport();
  ctx.window.__debug.search.setTransport(spy);
  type(ctx, 'node');
  await sleep(300);
  assert.strictEqual(spy.calls.length, 0, '关闭后不应发起联网请求');
  assert.deepStrictEqual(merged(ctx).map((x) => x.source), ['history']);
});

test('竞态守卫：过期查询的响应被丢弃', async () => {
  const ctx = boot({});
  const spy = spyTransport();
  ctx.window.__debug.search.setTransport(spy);
  type(ctx, 'a');
  await sleep(250);
  type(ctx, 'ab');
  await sleep(250);
  assert.strictEqual(spy.calls.length, 2);
  spy.calls[0].done(['旧查询a的结果']); // 过期响应，应被丢弃
  spy.calls[1].done(['新查询ab的结果']);
  const online = merged(ctx).filter((x) => x.source === 'online').map((x) => x.text);
  assert.deepStrictEqual(online, ['新查询ab的结果']);
});

test('网址样输入与站内直达查询不触发联网建议', async () => {
  const ctx = boot({});
  const spy = spyTransport();
  ctx.window.__debug.search.setTransport(spy);
  type(ctx, 'github.com');
  await sleep(250);
  type(ctx, 'zh 测试');
  await sleep(250);
  assert.strictEqual(spy.calls.length, 0);
});

test('空输入只展示历史，不请求联网', async () => {
  const ctx = boot({ seed: { 'newtab.searchHistory.v1': JSON.stringify(['旧查询']) } });
  const spy = spyTransport();
  ctx.window.__debug.search.setTransport(spy);
  type(ctx, '');
  await sleep(250);
  assert.strictEqual(spy.calls.length, 0);
  assert.deepStrictEqual(merged(ctx).map((x) => x.text), ['旧查询']);
  assert.ok(sugEl(ctx).classList.contains('open'));
});

test('历史单条删除按钮仍可用（回归）', async () => {
  const ctx = boot({ seed: { 'newtab.searchHistory.v1': JSON.stringify(['del-me', 'keep']) } });
  ctx.window.__debug.search.setTransport(() => {});
  type(ctx, '');
  await sleep(250);
  const del = sugEl(ctx).querySelector('.sg-item .sg-del');
  del.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
  assert.deepStrictEqual(JSON.parse(ctx.window.localStorage.getItem('newtab.searchHistory.v1')), ['keep']);
  assert.deepStrictEqual(merged(ctx).map((x) => x.text), ['keep']);
});

test('联网建议开关：默认开，切换写存储', async () => {
  const ctx = boot({});
  const toggle = ctx.document.getElementById('toggleSuggestOnline');
  assert.strictEqual(toggle.checked, true, '默认开启');
  toggle.checked = false;
  toggle.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.strictEqual(ctx.window.localStorage.getItem('newtab.suggestOnline.v1'), '0');
  toggle.checked = true;
  toggle.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.strictEqual(ctx.window.localStorage.getItem('newtab.suggestOnline.v1'), '1');
});

test('导入完整备份保留联网建议开关', async () => {
  const ctx = boot({});
  const payload = {
    app: 'Motuo-Tab',
    version: 2,
    exportedAt: new Date().toISOString(),
    data: {
      items: [{ name: '知乎', url: 'https://www.zhihu.com' }],
      settings: { suggestOnline: '0' },
      ai: {},
      wallpaper: null
    }
  };
  const file = new ctx.window.File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });
  const input = ctx.document.getElementById('importFile');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await sleep(300);
  assert.strictEqual(ctx.window.localStorage.getItem('newtab.suggestOnline.v1'), '0');
});

test('帮助中心说明联网建议会把输入发给百度，并可关闭', () => {
  const { document } = boot({});
  const tips = document.getElementById('help-section-tips').textContent;
  assert.match(tips, /联网搜索建议/);
  assert.match(tips, /百度/);
  assert.match(tips, /关闭/);
  assert.match(tips, /搜索历史/);
});
