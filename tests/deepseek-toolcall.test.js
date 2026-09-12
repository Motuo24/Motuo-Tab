// DeepSeek 工具调用回归：模型把调用写成正文文本（DSML / <tool_calls>）时，
// 前端要能解析并真正触发联网搜索，且不把原始标记回显/存历史。
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  sseResponse, jsonResponse, setupWindow, waitFor,
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

const BAR = '\uFF5C'; // 全角竖线，DeepSeek DSML 分隔符
const dsml = (tag) => '<' + BAR + 'DSML' + BAR + tag;
const dsmlClose = (tag) => '</' + BAR + 'DSML' + BAR + tag;
const dsmlTag = (tag, attrs, body) => {
  const open = dsml(tag + (attrs || ''));
  return body === undefined ? open + '>' : open + '>' + body + dsmlClose(tag) + '>';
};

const FINAL_OPS = '已添加蓝希云\n<ops>{"add":[{"name":"蓝希云","url":"https://lanxi.example.com","iconSrc":"color","color":"blue"}]}</ops>';

// 搜索链路 stub：chat#1 → 泄漏的工具调用；web-search → 结果；chat#2 → 最终回答
function leakChainStub(firstChatChunks) {
  let chatSeq = 0;
  return (url) => {
    if (String(url).includes('/chat/completions')) {
      chatSeq++;
      if (chatSeq === 1) return sseResponse(firstChatChunks);
      return sseResponse([{ choices: [{ delta: { content: FINAL_OPS } }] }]);
    }
    if (String(url).includes('web-search')) {
      return jsonResponse({
        data: {
          webPages: {
            value: [{ name: '蓝希云官网', url: 'https://lanxi.example.com', snippet: '蓝希云是一家云服务商' }]
          }
        }
      });
    }
    return Promise.reject(new Error('unexpected ' + url));
  };
}

test('DeepSeek DSML：正文里泄漏的 <｜DSML｜tool_calls> 也能触发联网搜索', async () => {
  const leak =
    '用户想加"蓝希云"，我不知道 URL，先搜索。\n' +
    dsmlTag('tool_calls', '', '\n' +
      dsmlTag('invoke', ' name="web_search"', '\n' +
        dsmlTag('parameter', ' name="query" string="true"', '蓝希云 云服务 官网') + '\n' +
        dsmlTag('parameter', ' name="top_k" string="false"', '5') + '\n') + '\n') + '\n';

  const { window, document, calls } = boot({
    fetchStub: leakChainStub([{ choices: [{ delta: { content: leak } }] }])
  });
  openAI(document);
  configureAI(document, { webSearch: true });

  sendMessage(document, '帮我加个蓝希云');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');

  // 工具真的被调用了，且用的是解析出来的 query
  const searchCalls = calls.filter((c) => c.url.includes('web-search'));
  assert.strictEqual(searchCalls.length, 1, '应触发一次联网搜索');
  const searchBody = JSON.parse(searchCalls[0].opts.body);
  assert.strictEqual(searchBody.query, '蓝希云 云服务 官网', '应从 DSML parameter 中取到 query');

  // 原始标记不得出现在界面或历史里
  const visible = document.getElementById('aiMessages').textContent;
  assert.ok(!visible.includes('DSML'), '界面不应出现 DSML 原文');
  assert.ok(!visible.includes('invoke'), '界面不应出现 invoke 原文');
  const history = JSON.parse(window.localStorage.getItem('newtab.ai.history.v1'));
  const assistantMsgs = history.filter((m) => m.role === 'assistant');
  assistantMsgs.forEach((m) => {
    assert.ok(!String(m.content || '').includes('DSML'), '历史不应存 DSML 原文');
    assert.ok(!String(m.content || '').includes('<invoke'), '历史不应存 invoke 原文');
  });
  // ops 正常应用
  assert.ok(readShortcuts(window).some((s) => s.name === '蓝希云'), '卡片应被添加');

  // 文本兜底路径必须补上合法的 tool_call_id，否则 DeepSeek 会 400
  const toolCallMsg = history.find((m) => m.role === 'assistant' && m.tool_calls);
  const toolMsg = history.find((m) => m.role === 'tool');
  assert.ok(toolCallMsg, '历史应含带 tool_calls 的 assistant 消息');
  assert.ok(toolCallMsg.tool_calls[0].id, 'tool_calls[].id 不能为空');
  assert.strictEqual(toolMsg.tool_call_id, toolCallMsg.tool_calls[0].id, 'tool_call_id 必须与调用 id 一致');
});

test('DeepSeek：普通 <tool_calls><invoke> 文本调用也能触发联网搜索', async () => {
  const leak =
    '先搜索再回答。\n' +
    '<tool_calls>\n<invoke name="web_search">\n' +
    '<parameter name="query">最新 AI 工具</parameter>\n' +
    '</invoke>\n</tool_calls>\n';

  const { window, document, calls } = boot({
    fetchStub: leakChainStub([{ choices: [{ delta: { content: leak } }] }])
  });
  openAI(document);
  configureAI(document, { webSearch: true });

  sendMessage(document, '搜一下最新 AI 工具');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');

  const searchCalls = calls.filter((c) => c.url.includes('web-search'));
  assert.strictEqual(searchCalls.length, 1, '应触发一次联网搜索');
  assert.strictEqual(JSON.parse(searchCalls[0].opts.body).query, '最新 AI 工具');

  const visible = document.getElementById('aiMessages').textContent;
  assert.ok(!visible.includes('<tool_calls>'), '界面不应出现 <tool_calls> 原文');
  assert.ok(!visible.includes('<parameter'), '界面不应出现 parameter 原文');
});

test('DeepSeek 思考模式 + 结构化工具调用：reasoning_content 需回传给后续请求', async () => {
  const REASONING = '先判断：用户问实时问题，需要联网。';
  const firstChat = [
    { choices: [{ delta: { reasoning_content: REASONING } }] },
    {
      choices: [{
        delta: {
          tool_calls: [{
            id: 'call_1', type: 'function', index: 0,
            function: { name: 'web_search', arguments: '{"query":"北京今天天气"}' }
          }]
        }
      }]
    }
  ];

  const { document, calls } = boot({ fetchStub: leakChainStub(firstChat) });
  openAI(document);
  configureAI(document, { webSearch: true, deepSearch: true });

  sendMessage(document, '北京今天天气怎么样');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');

  const chatCalls = calls.filter((c) => c.url.includes('/chat/completions'));
  assert.strictEqual(chatCalls.length, 2, '应有一次工具调用 + 一次后续回答');

  const followMsgs = JSON.parse(chatCalls[1].opts.body).messages;
  const toolCallMsg = followMsgs.find((m) => m.role === 'assistant' && m.tool_calls);
  assert.ok(toolCallMsg, '后续请求应包含带 tool_calls 的 assistant 消息');
  assert.strictEqual(toolCallMsg.reasoning_content, REASONING, 'DeepSeek 要求回传 reasoning_content');

  // 收尾流程必须成功：不能出现错误气泡，且最终回答要落盘
  // （曾因 followReasoningAccum 作用域错误抛出 "is not defined"）
  assert.strictEqual(document.querySelectorAll('.ai-msg-error').length, 0, '不应出现错误气泡');
  const history = JSON.parse(document.defaultView.localStorage.getItem('newtab.ai.history.v1'));
  const lastAssistant = history.filter((m) => m.role === 'assistant').pop();
  assert.ok(lastAssistant && String(lastAssistant.content).includes('已添加蓝希云'), '最终回答应已保存');
  assert.ok(!String(lastAssistant.content).includes('is not defined'), '历史不应含异常信息');

  // 思考记录里应保留搜索步骤（搜索完毕后也不消失）：搜索：query（N 个结果）
  assert.strictEqual(document.querySelectorAll('.ai-thinking').length, 1, '不应出现多个思考容器');
  const stepTexts = Array.from(document.querySelectorAll('.ai-thinking-step')).map((el) => el.textContent);
  const searchStep = stepTexts.find((t) => t.indexOf('搜索') !== -1);
  assert.ok(searchStep, '思考记录里应有搜索步骤');
  assert.ok(searchStep.indexOf('北京今天天气') !== -1, '搜索步骤应包含查询词');
  assert.ok(searchStep.indexOf('个结果') !== -1, '搜索步骤应包含结果数量');

  // 历史里保存结果数，供重开面板时 chip 回显
  assert.ok(String(lastAssistant.content).includes('"count":1'), '历史应保存搜索结果数');
});
