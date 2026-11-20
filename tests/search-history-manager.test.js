// 回归测试：通用配置里的搜索历史管理（逐条删除 / 多选删除 / 一键清空）
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { setupWindow } = require('./helpers.js');

const activeWindows = [];
afterEach(() => {
  while (activeWindows.length) { try { activeWindows.pop().close(); } catch (e) {} }
});

function boot(seed) {
  const ctx = setupWindow({ seed });
  activeWindows.push(ctx.window);
  return ctx;
}
const HKEY = 'newtab.searchHistory.v1';
// 跨 realm 归一化：jsdom window 里的数组原型与 Node 不同，deepStrictEqual 会误判
function getHist(window) {
  const raw = window.localStorage.getItem(HKEY);
  return JSON.parse(JSON.stringify(raw ? JSON.parse(raw) : []));
}
// 跨 realm 归一化
function histTexts(document) {
  return JSON.parse(JSON.stringify(
    Array.from(document.querySelectorAll('#histList .hist-text')).map((el) => el.textContent)
  ));
}
function openGeneralConfig(document) {
  document.getElementById('generalConfigBtn').click();
}
function rows(document) { return document.querySelectorAll('#histList .hist-row'); }
function checks(document) { return document.querySelectorAll('#histList .hist-check'); }

const SEED = { [HKEY]: JSON.stringify(['alpha', 'beta', 'gamma']) };

test('历史管理列表渲染全部历史', () => {
  const { document } = boot(SEED);
  openGeneralConfig(document);
  const texts = histTexts(document);
  assert.deepStrictEqual(texts, ['alpha', 'beta', 'gamma']);
  assert.strictEqual(document.getElementById('histCount').textContent, '3 条');
  assert.strictEqual(document.getElementById('histDeleteSelected').disabled, true, '默认无选中时删除所选禁用');
  assert.strictEqual(document.getElementById('histClearAll').disabled, false, '有历史时清空可用');
});

test('逐条删除会更新存储、列表与搜索下拉', () => {
  const { window, document } = boot(SEED);
  openGeneralConfig(document);
  // 删除 beta
  const delBtn = Array.from(document.querySelectorAll('#histList .hist-del'))
    .find((b) => b.getAttribute('data-q') === 'beta');
  assert.ok(delBtn, '应存在 beta 的删除按钮');
  delBtn.click();

  assert.deepStrictEqual(getHist(window), ['alpha', 'gamma'], '存储应移除 beta');
  assert.deepStrictEqual(histTexts(document), ['alpha', 'gamma'], '列表应移除 beta');

  // 搜索模块内部状态同步（下拉不再含 beta）
  const merged = window.__debug.search.getMerged().map((m) => m.text);
  assert.ok(!merged.includes('beta'), '搜索下拉不应再包含被删的 beta');
  window.__debug.search.render();
  const texts2 = Array.from(document.querySelectorAll('.search-suggestions .sg-text')).map((el) => el.textContent);
  assert.ok(!texts2.includes('beta'), '重绘后的搜索下拉不含 beta');
});

test('多选删除', () => {
  const { window, document } = boot(SEED);
  openGeneralConfig(document);
  const cs = checks(document);
  cs[0].click(); // alpha
  cs[2].click(); // gamma
  assert.strictEqual(document.getElementById('histDeleteSelected').disabled, false, '选中后删除可用');
  document.getElementById('histDeleteSelected').click();
  assert.deepStrictEqual(getHist(window), ['beta'], '应只剩未选中的 beta');
  assert.deepStrictEqual(histTexts(document), ['beta']);
});

test('全选后一键清空', () => {
  const { window, document } = boot(SEED);
  openGeneralConfig(document);
  const sa = document.getElementById('histSelectAll');
  sa.click();
  // 全选后所有行勾选
  assert.strictEqual(Array.from(checks(document)).every((c) => c.checked), true, '全选应勾选所有行');
  document.getElementById('histClearAll').click();
  assert.deepStrictEqual(getHist(window), [], '存储应为空');
  assert.strictEqual(document.querySelector('#histList .hist-empty') !== null, true, '应显示空态');
  assert.strictEqual(document.getElementById('histCount').textContent, '', '计数应清空');
});

test('清空后搜索下拉也无历史项', () => {
  const { window, document } = boot(SEED);
  openGeneralConfig(document);
  document.getElementById('histClearAll').click();
  const merged = window.__debug.search.getMerged().filter((m) => m.source === 'history');
  assert.strictEqual(merged.length, 0, '清空后搜索下拉里不应再有历史项');
});

test('空历史时清空按钮禁用', () => {
  const { document } = boot({});
  openGeneralConfig(document);
  assert.strictEqual(document.getElementById('histClearAll').disabled, true, '无历史时清空禁用');
  assert.strictEqual(document.querySelector('#histList .hist-empty') !== null, true, '空态提示存在');
});
