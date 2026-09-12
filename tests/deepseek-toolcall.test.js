// 联网搜索回归：统一走自有文本协议 <web_search>…</web_search>，
// 同时兼容历史遗留的 DSML / <tool_calls><invoke> 文本工具调用。
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

const ADD_OPS = '已添加蓝希云\n<ops>{"add":[{"name":"蓝希云","url":"https://lanxi.example.com","iconSrc":"color","color":"blue"}]}</ops>';

// 搜索链路 stub：chat#1 → 触发搜索；web-search → 结果；chat#2 → 最终回答
function chainStub(firstChatChunks, finalContent) {
  let chatSeq = 0;
  return (url) => {
    if (String(url).includes('/chat/completions')) {
      chatSeq++;
      if (chatSeq === 1) return sseResponse(firstChatChunks);
      return sseResponse([{ choices: [{ delta: { content: finalContent || ADD_OPS } }] }]);
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

test('文本协议 <web_search>：触发联网搜索、应用 ops、且不泄露原始标记', async () => {
  const { window, document, calls } = boot({
    fetchStub: chainStub([{ choices: [{ delta: { content: '<web_search>蓝希云 云服务 官网</web_search>' } }] }])
  });
  openAI(document);
  configureAI(document, { webSearch: true });

  sendMessage(document, '帮我加个蓝希云');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');

  // 工具真的被调用了，且用的是解析出来的 query
  const searchCalls = calls.filter((c) => c.url.includes('web-search'));
  assert.strictEqual(searchCalls.length, 1, '应触发一次联网搜索');
  assert.strictEqual(JSON.parse(searchCalls[0].opts.body).query, '蓝希云 云服务 官网');

  // 原始标记不得出现在界面
  const visible = document.getElementById('aiMessages').textContent;
  assert.ok(!visible.includes('<web_search>'), '界面不应出现 <web_search> 原文');

  // 结果只作为 hidden 上下文保留，不渲染
  const history = JSON.parse(window.localStorage.getItem('newtab.ai.history.v1'));
  const resultsMsg = history.find((m) => m.hidden && String(m.content).includes('蓝希云是一家云服务商'));
  assert.ok(resultsMsg, '历史应含 hidden 的搜索结果消息');

  // ops 正常应用
  assert.ok(readShortcuts(window).some((s) => s.name === '蓝希云'), '卡片应被添加');

  // 搜索结果数写入 chip 标签
  const lastAssistant = history.filter((m) => m.role === 'assistant').pop();
  assert.ok(String(lastAssistant.content).includes('"count":1'), '历史应保存搜索结果数');
});

test('兼容历史：正文里泄漏的 <｜DSML｜tool_calls> 也能触发联网搜索', async () => {
  const leak =
    '需要先搜索。\n' +
    dsmlTag('tool_calls', '', '\n' +
      dsmlTag('invoke', ' name="web_search"', '\n' +
        dsmlTag('parameter', ' name="query" string="true"', '蓝希云 云服务') + '\n') + '\n') + '\n';

  const { document, calls } = boot({
    fetchStub: chainStub([{ choices: [{ delta: { content: leak } }] }])
  });
  openAI(document);
  configureAI(document, { webSearch: true });

  sendMessage(document, '帮我加个蓝希云');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');

  const searchCalls = calls.filter((c) => c.url.includes('web-search'));
  assert.strictEqual(searchCalls.length, 1, '应触发一次联网搜索');
  assert.strictEqual(JSON.parse(searchCalls[0].opts.body).query, '蓝希云 云服务');
  assert.ok(!document.getElementById('aiMessages').textContent.includes('DSML'), '界面不应出现 DSML 原文');
});

test('兼容历史：普通 <tool_calls><invoke> 文本调用也能触发联网搜索', async () => {
  const leak =
    '先搜索再回答。\n' +
    '<tool_calls>\n<invoke name="web_search">\n' +
    '<parameter name="query">最新 AI 工具</parameter>\n' +
    '</invoke>\n</tool_calls>\n';

  const { document, calls } = boot({
    fetchStub: chainStub([{ choices: [{ delta: { content: leak } }] }])
  });
  openAI(document);
  configureAI(document, { webSearch: true });

  sendMessage(document, '搜一下最新 AI 工具');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');

  const searchCalls = calls.filter((c) => c.url.includes('web-search'));
  assert.strictEqual(searchCalls.length, 1, '应触发一次联网搜索');
  assert.strictEqual(JSON.parse(searchCalls[0].opts.body).query, '最新 AI 工具');
  const visible = document.getElementById('aiMessages').textContent;
  assert.ok(!visible.includes('<tool_calls>') && !visible.includes('<parameter'), '界面不应出现原始标记');
});

test('思考记录保留搜索步骤；搜索后的第二次请求带 results 且不含语义标签', async () => {
  const REASONING = '先判断：用户问实时问题，需要联网。';
  const firstChat = [
    { choices: [{ delta: { reasoning_content: REASONING } }] },
    { choices: [{ delta: { content: '<web_search>北京今天天气</web_search>' } }] }
  ];

  const { document, calls } = boot({ fetchStub: chainStub(firstChat, '北京今天晴，25℃。') });
  openAI(document);
  configureAI(document, { webSearch: true, deepSearch: true });

  sendMessage(document, '北京今天天气怎么样');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');

  const chatCalls = calls.filter((c) => c.url.includes('/chat/completions'));
  assert.strictEqual(chatCalls.length, 2, '应有一次搜索 + 一次后续回答');

  // 第二次请求：带 hidden 的搜索结果 user 消息，且 assistant 正文不含语义标签
  const followMsgs = JSON.parse(chatCalls[1].opts.body).messages;
  assert.ok(followMsgs.some((m) => m.role === 'user' && String(m.content).includes('联网搜索结果')), '第二次请求应带搜索结果');
  const assistantRaw = JSON.stringify(followMsgs.filter((m) => m.role === 'assistant'));
  assert.ok(!assistantRaw.includes('<think>') && !assistantRaw.includes('<tool_call>'), 'assistant 消息不应含语义标签');

  // 思考记录里应保留搜索步骤：搜索：query（N 个结果）
  assert.strictEqual(document.querySelectorAll('.ai-thinking').length, 1, '不应出现多个思考容器');
  const stepTexts = Array.from(document.querySelectorAll('.ai-thinking-step')).map((el) => el.textContent);
  const searchStep = stepTexts.find((t) => t.indexOf('搜索') !== -1);
  assert.ok(searchStep && searchStep.indexOf('北京今天天气') !== -1 && searchStep.indexOf('个结果') !== -1, '思考记录应有搜索步骤与结果数');
});

test('回传模型的历史不含语义标签，也不含 native tool 消息/字段', async () => {
  const seed = {
    'newtab.ai.history.v1': JSON.stringify([
      { role: 'system', content: 'sys' },
      { role: 'user', content: '帮我加个蓝希云' },
      {
        role: 'assistant', content: null, reasoning_content: '第一轮思考',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"蓝希云"}' } }]
      },
      { role: 'tool', tool_call_id: 'call_1', content: '搜索结果……' },
      {
        role: 'assistant', reasoning_content: '第二轮思考',
        content: '<think>第一轮思考</think>\n' +
          '<web_search>蓝希云</web_search>\n' +
          '<tool_call>{"type":"web_search","query":"蓝希云","count":1}</tool_call>\n' +
          '没搜到相关结果\n<ops>{"add":[{"name":"蓝希云","url":"https://x.com","iconSrc":"color","color":"blue"}]}</ops>'
      }
    ])
  };

  const { document, calls } = boot({
    seed,
    fetchStub: () => sseResponse([{ choices: [{ delta: { content: '好的，我再搜一次。' } }] }])
  });
  openAI(document);
  configureAI(document);
  sendMessage(document, '再搜一遍');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');

  const chatCall = calls.find((c) => c.url.includes('/chat/completions'));
  assert.ok(chatCall, '应发出对话请求');
  const msgs = JSON.parse(chatCall.opts.body).messages;
  const assistantRaw = JSON.stringify(msgs.filter((m) => m.role === 'assistant'));
  assert.ok(!assistantRaw.includes('<tool_call>'), 'assistant 不应含 <tool_call>');
  assert.ok(!assistantRaw.includes('<think>'), 'assistant 不应含 <think>');
  assert.ok(!assistantRaw.includes('<ops>'), 'assistant 不应含 <ops>');
  assert.ok(!assistantRaw.includes('<web_search>'), 'assistant 不应含 <web_search>');
  assert.ok(!assistantRaw.includes('tool_calls'), '不应再带 native tool_calls 字段');
  assert.ok(!msgs.some((m) => m.role === 'tool'), '不应再带 role:tool 消息');
  const finalAssistant = msgs.filter((m) => m.role === 'assistant').pop();
  assert.ok(finalAssistant.content.includes('没搜到相关结果'), '清洗后应保留正常正文');
});

test('两轮联网搜索：用户第二次说"再搜一遍"仍会真正调用工具', async () => {
  let chatSeq = 0;
  const fetchStub = (url) => {
    if (String(url).includes('/chat/completions')) {
      chatSeq++;
      if (chatSeq === 1) return sseResponse([{ choices: [{ delta: { content: '<web_search>蓝希云 官网</web_search>' } }] }]);
      if (chatSeq === 2) return sseResponse([{ choices: [{ delta: { content: '没搜到相关结果。' } }] }]);
      if (chatSeq === 3) return sseResponse([{ choices: [{ delta: { content: '<web_search>蓝希云 云服务</web_search>' } }] }]);
      return sseResponse([{ choices: [{ delta: { content: '找到了：蓝希云官网。' } }] }]);
    }
    if (String(url).includes('web-search')) {
      return jsonResponse({ data: { webPages: { value: [{ name: 'x', url: 'https://x.com', snippet: 's' }] } } });
    }
    return Promise.reject(new Error('unexpected ' + url));
  };

  const { document, calls } = boot({ fetchStub });
  openAI(document);
  configureAI(document, { webSearch: true, deepSearch: true });

  sendMessage(document, '帮我加个蓝希云');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');
  sendMessage(document, '再搜一遍');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');

  assert.strictEqual(calls.filter((c) => c.url.includes('web-search')).length, 2, '两轮都应触发联网搜索');
  assert.strictEqual(calls.filter((c) => c.url.includes('/chat/completions')).length, 4, '两轮共 4 次对话请求');
});

test('模型直接输出裸 JSON（无 <ops> 包裹）时也能应用创建卡片', async () => {
  const bare = '已添加 Google\n{"add":[{"name":"Google","url":"https://www.google.com","iconSrc":"color","color":"blue"}]}';
  const { window, document } = boot({
    fetchStub: () => sseResponse([{ choices: [{ delta: { content: bare } }] }])
  });
  openAI(document);
  configureAI(document);
  sendMessage(document, '加个 Google');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');

  assert.ok(readShortcuts(window).some((s) => s.name === 'Google'), '裸 JSON 也应被应用');
  const visible = document.getElementById('aiMessages').textContent;
  assert.ok(!visible.includes('"add"'), '裸 JSON 不应原样显示');
  assert.ok(visible.includes('已添加 Google'), '摘要文本应保留');
});

test('模型用 ```json 代码块输出时也能应用创建卡片', async () => {
  const fenced = '已添加百度\n```json\n{"add":[{"name":"百度","url":"https://www.baidu.com","iconSrc":"color","color":"blue"}]}\n```';
  const { window, document } = boot({
    fetchStub: () => sseResponse([{ choices: [{ delta: { content: fenced } }] }])
  });
  openAI(document);
  configureAI(document);
  sendMessage(document, '加个百度');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');

  assert.ok(readShortcuts(window).some((s) => s.name === '百度'), '代码块 JSON 也应被应用');
  assert.ok(!document.getElementById('aiMessages').textContent.includes('"add"'), 'JSON 不应原样显示');
});

test('模型输出 JSON 数组（卡片列表）时也能识别为 add', async () => {
  const arr = '已添加 Google\n[{"name":"Google","url":"https://www.google.com","iconSrc":"color","color":"blue"}]';
  const { window, document } = boot({
    fetchStub: () => sseResponse([{ choices: [{ delta: { content: arr } }] }])
  });
  openAI(document);
  configureAI(document);
  sendMessage(document, '加个 Google');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');
  assert.ok(readShortcuts(window).some((s) => s.name === 'Google'), 'JSON 数组也应被识别为 add');
});

test('模型输出宽松 JSON（未加引号键 / 单引号）时也能应用', async () => {
  const loose = "已添加百度\n{add:[{name:'百度', url:'https://www.baidu.com', iconSrc:'color', color:'blue'}]}";
  const { window, document } = boot({
    fetchStub: () => sseResponse([{ choices: [{ delta: { content: loose } }] }])
  });
  openAI(document);
  configureAI(document);
  sendMessage(document, '加个百度');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');
  assert.ok(readShortcuts(window).some((s) => s.name === '百度'), '宽松 JSON 也应被应用');
});

test('搜索失败时优雅降级：不报错、带上失败说明继续让模型作答', async () => {
  let chatSeq = 0;
  const fetchStub = (url) => {
    if (String(url).includes('/chat/completions')) {
      chatSeq++;
      if (chatSeq === 1) return sseResponse([{ choices: [{ delta: { content: '<web_search>蓝希云 官网</web_search>' } }] }]);
      return sseResponse([{ choices: [{ delta: { content: '暂时无法联网，我不确定蓝希云的网址。' } }] }]);
    }
    if (String(url).includes('web-search')) {
      // 模拟网络/超时/CORS 失败
      return Promise.reject(new Error('signal timed out'));
    }
    return Promise.reject(new Error('unexpected ' + url));
  };

  const { document, calls } = boot({ fetchStub });
  openAI(document);
  configureAI(document, { webSearch: true, deepSearch: true });

  sendMessage(document, '帮我加个蓝希云');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');

  // 搜索失败不应中断，仍发出后续请求让模型作答
  assert.strictEqual(calls.filter((c) => c.url.includes('/chat/completions')).length, 2, '搜索失败后仍应有后续回答请求');
  assert.strictEqual(document.querySelectorAll('.ai-msg-error').length, 0, '不应出现错误气泡');

  const followMsgs = JSON.parse(calls.filter((c) => c.url.includes('/chat/completions'))[1].opts.body).messages;
  assert.ok(followMsgs.some((m) => m.role === 'user' && String(m.content).includes('联网搜索失败')), '应把失败说明回传给模型');

  const steps = Array.from(document.querySelectorAll('.ai-thinking-step')).map((el) => el.textContent).join('|');
  assert.ok(steps.indexOf('失败') !== -1, '思考记录应标注搜索失败');
});
