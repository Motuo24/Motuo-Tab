// 问题三：退出页面重进后，不再展示上一次的联网搜索结果
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  sseResponse, jsonResponse, setupWindow, waitFor,
  openAI, configureAI, sendMessage
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

// 搜索链路 stub：chat#1 → tool_calls(web_search)；web-search → 结果；chat#2 → 基于结果的最终回答
function searchChainStub() {
  let chatSeq = 0;
  return (url) => {
    if (String(url).includes('/chat/completions')) {
      chatSeq++;
      if (chatSeq === 1) {
        return sseResponse([
          { choices: [{ delta: { tool_calls: [{ id: 'call_1', type: 'function', index: 0, function: { name: 'web_search', arguments: '{"query":"最新AI工具"}' } }] } }] }
        ]);
      }
      return sseResponse([
        { choices: [{ delta: { content: '根据搜索结果，推荐最新 AI 工具站 XYZ。' } }] }
      ]);
    }
    if (String(url).includes('web-search')) {
      return jsonResponse({
        data: {
          webPages: {
            value: [
              { name: 'AI工具站', url: 'https://ai-tool.example.com', snippet: '这里是最新AI工具的汇总页面' }
            ]
          }
        }
      });
    }
    return Promise.reject(new Error('unexpected ' + url));
  };
}

const LEAK_SNIPPET = '这里是最新AI工具的汇总页面'; // 搜索结果正文（应只存在于 tool 消息，不应渲染）

function captureLocalStorage(window) {
  const out = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    out[k] = window.localStorage.getItem(k);
  }
  return out;
}

test('问题三：重进页面后不再外露上一次的联网搜索结果（tool 消息仅作 API 上下文保留）', async () => {
  // ===== 第一次进入：跑完一轮联网搜索 =====
  const s1 = boot({ fetchStub: searchChainStub() });
  openAI(s1.document);
  configureAI(s1.document, { webSearch: true });

  sendMessage(s1.document, '帮我搜一下最新AI工具');
  await waitFor(() => s1.document.querySelectorAll('.ai-msg-assistant').length >= 2);
  // 等发送态复位，确保历史已落盘
  await waitFor(() => s1.document.getElementById('aiSend').textContent === '发送');

  // 搜索链路确实执行了
  assert.strictEqual(s1.calls.filter((c) => c.url.includes('web-search')).length, 1);

  // localStorage 历史中确实持久化了 tool 消息（含搜索结果原文）
  const history1 = JSON.parse(s1.window.localStorage.getItem('newtab.ai.history.v1'));
  const toolMsg = history1.find((m) => m.role === 'tool');
  assert.ok(toolMsg, '历史中应保留 tool 消息（API 上下文）');
  assert.ok(toolMsg.content.includes(LEAK_SNIPPET), 'tool 消息应包含搜索结果原文');

  // 同一会话内：关闭再重开面板也不应渲染出搜索结果气泡
  s1.document.getElementById('aiClose').click();
  openAI(s1.document);
  await waitFor(() => s1.document.querySelectorAll('.ai-msg').length > 0);
  const text1 = s1.document.getElementById('aiMessages').textContent;
  assert.ok(!text1.includes(LEAK_SNIPPET), '重开面板后不应渲染搜索结果的 tool 气泡');
  assert.strictEqual(s1.document.querySelectorAll('.ai-msg-tool').length, 0, '不应存在 tool 角色的气泡节点');

  // 捕获持久化状态，模拟"退出页面"
  const persisted = captureLocalStorage(s1.window);
  s1.window.close();
  activeWindows.pop();

  // ===== 第二次进入：重进页面后恢复历史 =====
  const s2 = boot({ seed: persisted });
  openAI(s2.document);

  // 历史里的搜索结果不应再展示
  const text2 = s2.document.getElementById('aiMessages').textContent;
  assert.ok(!text2.includes(LEAK_SNIPPET), '重进页面后不应展示上一次的联网搜索结果');
  assert.ok(!text2.includes('AI工具站'), '搜索结果标题也不应出现');
  assert.strictEqual(s2.document.querySelectorAll('.ai-msg-tool').length, 0, '重进后不应存在 tool 气泡');

  // 正常的对话内容（最终回答）仍保留
  assert.ok(text2.includes('推荐最新 AI 工具站 XYZ'), '正常的助手回答应保留');

  // API 上下文完整性不受影响：tool 消息仍保留在持久化历史中
  const history2 = JSON.parse(s2.window.localStorage.getItem('newtab.ai.history.v1'));
  assert.ok(history2.find((m) => m.role === 'tool'), 'tool 消息应保留在 localStorage（不影响 API 协议）');
});
