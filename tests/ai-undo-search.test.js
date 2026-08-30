// 问题一 & 问题二：撤销按钮可点击 / 撤销语义为纯回滚（不自动重发）
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  sseResponse, setupWindow, waitFor,
  openAI, configureAI, sendMessage, readShortcuts
} = require('./helpers');

const activeWindows = [];
afterEach(() => {
  while (activeWindows.length) {
    const w = activeWindows.pop();
    try { w.close(); } catch (e) { /* ignore */ }
  }
});

function boot(opts) {
  const ctx = setupWindow(opts);
  activeWindows.push(ctx.window);
  return ctx;
}

// 构造"已把 GitHub 改为绿色"的 ops 流
const UPDATE_OPS_STREAM = [
  { choices: [{ delta: { content: '已将 GitHub 图标改为绿色\n<ops>{"update":[{"name":"GitHub","color":"green"}]}</ops>' } }] }
];

function chatOnlyStub(streams) {
  let chatSeq = 0;
  return (url) => {
    if (String(url).includes('/chat/completions')) {
      const s = streams[chatSeq] || streams[streams.length - 1];
      chatSeq++;
      return sseResponse(s);
    }
    return Promise.reject(new Error('unexpected ' + url));
  };
}

test('问题一：实时创建的撤销按钮可点击并执行撤销（纯回滚，不自动重发）', async () => {
  const { window, document, calls } = boot({
    fetchStub: chatOnlyStub([UPDATE_OPS_STREAM])
  });

  openAI(document);
  // 即使联网搜索开启，撤销也应为纯回滚，不再自动重发
  configureAI(document, { webSearch: true });

  const beforeList = readShortcuts(window);
  const github = beforeList.find((x) => x.name === 'GitHub');
  assert.ok(github, '默认列表应有 GitHub');
  assert.strictEqual(github.color, undefined, '初始 GitHub 不应有 color');

  sendMessage(document, '把 GitHub 改成绿色');

  // 等待撤销按钮出现
  await waitFor(() => document.querySelector('.ai-undo-btn') !== null);
  // 快照应已保存
  const snapRaw = window.localStorage.getItem('newtab.ai.snapshot.v1');
  assert.ok(snapRaw, '撤销前应保存快照');
  const snap = JSON.parse(snapRaw);
  assert.deepStrictEqual(snap.list, beforeList, '快照应等于操作前列表');

  // 操作已应用：GitHub 现在有 color
  assert.strictEqual(readShortcuts(window).find((x) => x.name === 'GitHub').color, 'green');

  // 点击撤销
  document.querySelector('.ai-undo-btn').click();

  // 列表应恢复为快照内容
  assert.deepStrictEqual(readShortcuts(window), beforeList, '撤销后列表应恢复');
  assert.strictEqual(window.localStorage.getItem('newtab.ai.snapshot.v1'), null, '撤销后快照应被删除');

  // 按钮进入已撤销态
  const btn = document.querySelector('.ai-undo-btn');
  assert.strictEqual(btn.disabled, true);
  assert.strictEqual(btn.textContent, '✓ 已撤销');
  assert.ok(btn.classList.contains('ai-undo-done'));

  // 纯回滚：撤销后不应发起任何新请求（联网开启也不重发）
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(calls.filter((c) => c.url.includes('/chat/completions')).length, 1, '撤销后不应自动重发');
  assert.strictEqual(calls.filter((c) => c.url.includes('web-search')).length, 0, '撤销后不应触发搜索');
});

test('问题一：历史重渲染出来的撤销按钮（无 onclick）仍可点击 —— 事件委托修复', async () => {
  const beforeList = [
    { name: 'GitHub', url: 'https://github.com', iconSrc: 'image', icon: 'https://github.com/favicon.ico' }
  ];
  const afterList = [
    { name: 'GitHub', url: 'https://github.com', iconSrc: 'image', icon: 'https://github.com/favicon.ico', color: 'green' }
  ];
  // 模拟旧版本遗留的历史：rendered HTML 里带撤销按钮（属性序列化保留了 class，但没有 onclick）
  const seed = {
    'newtab.shortcuts.v1': JSON.stringify(afterList),
    'newtab.shortcuts.v1.bak': JSON.stringify(afterList),
    'newtab.ai.snapshot.v1': JSON.stringify({ list: beforeList, time: Date.now() }),
    'newtab.ai.history.v1': JSON.stringify([
      { role: 'system', content: 'system' },
      { role: 'user', content: '把 GitHub 改成绿色' },
      {
        role: 'assistant',
        content: '已将 GitHub 图标改为绿色\n<ops>{"update":[{"name":"GitHub","color":"green"}]}</ops>',
        rendered: '<div style="white-space:normal;">已将 GitHub 图标改为绿色</div>' +
          '<div class="ai-tool-calls"></div>' +
          '<div class="ai-save-status ok">✓ 已保存到 localStorage</div>' +
          '<button type="button" class="ai-undo-btn">↶ 撤销这次操作</button>'
      }
    ])
  };

  const { window, document, calls } = boot({ seed });

  openAI(document);

  // 历史里的按钮被渲染出来
  const btn = document.querySelector('.ai-undo-btn');
  assert.ok(btn, '重渲染后应出现撤销按钮');

  // 点击应正常执行撤销（不再是"点了没反应"），且不发起新请求
  btn.click();
  assert.deepStrictEqual(readShortcuts(window), beforeList, '事件委托应让历史按钮也能撤销');
  assert.strictEqual(btn.textContent, '✓ 已撤销');
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(calls.filter((c) => c.url.includes('/chat/completions')).length, 0, '纯回滚不应发起新请求');
});

test('问题二：撤销为纯回滚 —— 联网搜索开启时撤销也不自动重发（原指令不再重复发回 agent）', async () => {
  const { window, document, calls } = boot({
    fetchStub: chatOnlyStub([UPDATE_OPS_STREAM])
  });

  openAI(document);
  configureAI(document, { webSearch: true }); // 联网开关开启，验证撤销仍不重发

  const beforeList = readShortcuts(window);
  sendMessage(document, '把 GitHub 改成绿色');
  await waitFor(() => document.querySelector('.ai-undo-btn') !== null);

  // 点击撤销
  document.querySelector('.ai-undo-btn').click();

  // 列表纯回滚
  assert.deepStrictEqual(readShortcuts(window), beforeList, '撤销后列表应恢复');
  assert.strictEqual(window.localStorage.getItem('newtab.ai.snapshot.v1'), null, '撤销后快照应被删除');

  // 关键断言：撤销后原指令不再重复发回 agent —— 聊天请求始终只有 1 次，也无任何搜索调用
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(calls.filter((c) => c.url.includes('/chat/completions')).length, 1, '撤销后不应重发原指令');
  assert.strictEqual(calls.filter((c) => c.url.includes('web-search')).length, 0, '撤销后不应触发联网搜索');
});
