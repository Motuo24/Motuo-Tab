// 卡片去重、思考档位、搜索提供商、提示词变量
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { sseResponse, jsonResponse, setupWindow, waitFor, openAI, configureAI, sendMessage, readShortcuts } = require('./helpers');

const activeWindows = [];
afterEach(() => {
  while (activeWindows.length) {
    try { activeWindows.pop().close(); } catch (e) {}
  }
});

function boot(opts) {
  const ctx = setupWindow(opts);
  activeWindows.push(ctx.window);
  return ctx;
}

test('同名卡片不会被再次添加', async () => {
  const { window, document } = boot({
    fetchStub: () => sseResponse([{ choices: [{ delta: { content: '已添加 GitHub\n<ops>{"add":[{"name":"GitHub","url":"https://github.com","iconSrc":"color","color":"blue"}]}</ops>' } }] }])
  });
  openAI(document);
  configureAI(document);
  const before = readShortcuts(window).filter((s) => s.name === 'GitHub').length;
  sendMessage(document, '加个 GitHub');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');
  assert.strictEqual(readShortcuts(window).filter((s) => s.name === 'GitHub').length, before);
});

test('DeepSeek 思考档位写入 reasoning_effort', async () => {
  const { document, calls } = boot({
    fetchStub: () => sseResponse([{ choices: [{ delta: { content: '好' } }] }])
  });
  openAI(document);
  configureAI(document, { endpoint: 'https://api.deepseek.com', model: 'deepseek-chat', deepSearch: true });
  document.getElementById('aiThinkingGear').value = 'medium';
  sendMessage(document, '你好');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');
  const chat = calls.find((c) => String(c.url).includes('/chat/completions'));
  const body = JSON.parse(chat.opts.body);
  assert.strictEqual(body.thinking.type, 'enabled');
  assert.strictEqual(body.reasoning_effort, 'medium');
});

test('选择 Tavily 时请求打到 Tavily', async () => {
  let chat = 0;
  const fetchStub = (url) => {
    if (String(url).includes('/chat/completions')) {
      chat++;
      if (chat === 1) return sseResponse([{ choices: [{ delta: { content: '<web_search>天气</web_search>' } }] }]);
      return sseResponse([{ choices: [{ delta: { content: '今天晴。' } }] }]);
    }
    if (String(url).includes('api.tavily.com')) {
      return jsonResponse({ results: [{ title: '天气', url: 'https://w.example', content: '晴' }] });
    }
    return Promise.reject(new Error('unexpected ' + url));
  };
  const { document, calls } = boot({ fetchStub });
  openAI(document);
  configureAI(document, { webSearch: true });
  document.getElementById('aiSearchProvider').value = 'tavily';
  document.getElementById('aiTavilyKey').value = 'tvly-test';
  sendMessage(document, '今天天气');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');
  assert.ok(calls.some((c) => String(c.url).includes('api.tavily.com/search')), '应请求 Tavily');
  assert.ok(!calls.some((c) => String(c.url).includes('bochaai.com')), '不应再打博查');
});

test('自定义系统提示词里的卡片标签会被换成当前列表', async () => {
  const { document, calls } = boot({
    fetchStub: () => sseResponse([{ choices: [{ delta: { content: '好' } }] }])
  });
  openAI(document);
  configureAI(document);
  document.getElementById('aiSystemPrompt').value = '名单：{{cards}}';
  sendMessage(document, '你好');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');
  const chat = calls.find((c) => String(c.url).includes('/chat/completions'));
  const sys = JSON.parse(chat.opts.body).messages.find((m) => m.role === 'system').content;
  assert.ok(sys.indexOf('名单：') === 0);
  assert.ok(sys.indexOf('GitHub') !== -1);
  assert.ok(sys.indexOf('https://github.com') !== -1);
});
