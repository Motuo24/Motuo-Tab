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

test('内置提示词说明 Motuo-Tab 是什么，以及助手不能做什么', async () => {
  const { document, calls } = boot({
    fetchStub: () => sseResponse([{ choices: [{ delta: { content: '好' } }] }])
  });
  openAI(document);
  configureAI(document);
  const box = document.getElementById('aiSystemPrompt');
  assert.ok(box.value.includes('浏览器新标签页'), '预设里应有项目定位');
  assert.ok(box.value.includes('你的边界'), '预设里应有能力边界');
  assert.ok(box.value.includes('Ctrl+E'), '预设里应有快捷键');
  const preset = document.getElementById('aiPromptPreset');
  assert.ok(preset, '应有提示词预设');
  assert.strictEqual(preset.value, 'general');
  preset.value = 'cards';
  preset.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  assert.ok(box.value.includes('快捷方式管理员'));
  sendMessage(document, '你好');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');
  const chat = calls.find((c) => String(c.url).includes('/chat/completions'));
  const messages = JSON.parse(chat.opts.body).messages;
  const sys = messages.find((m) => m.role === 'system').content;
  const user = messages.filter((m) => m.role === 'user').pop().content;
  assert.ok(sys.includes('快捷方式管理员'));
  assert.ok(!sys.includes('{{cards}}'), '系统提示词不放实时卡片');
  assert.ok(user.includes('GitHub'), '卡片列表应出现在用户消息前面的环境前缀里');
});

test('智谱搜索请求带引擎和时间范围', async () => {
  let chat = 0;
  const fetchStub = (url) => {
    if (String(url).includes('/chat/completions')) {
      chat++;
      if (chat === 1) return sseResponse([{ choices: [{ delta: { content: '<web_search>财经</web_search>' } }] }]);
      return sseResponse([{ choices: [{ delta: { content: '已查到。' } }] }]);
    }
    if (String(url).includes('open.bigmodel.cn')) {
      return jsonResponse({ search_result: [{ title: '财经', link: 'https://news.example', content: '增长' }] });
    }
    return Promise.reject(new Error('unexpected ' + url));
  };
  const { document, calls } = boot({ fetchStub });
  openAI(document);
  configureAI(document, { webSearch: true });
  document.getElementById('aiSearchProvider').value = 'zhipu';
  document.getElementById('aiZhipuEngine').value = 'search_std';
  document.getElementById('aiSearchFreshness').value = 'week';
  document.getElementById('aiSearchKey').value = 'zhipu-key';
  sendMessage(document, '最近财经');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');
  const hit = calls.find((c) => String(c.url).includes('open.bigmodel.cn/api/paas/v4/web_search'));
  assert.ok(hit, '应请求智谱 Web Search');
  const body = JSON.parse(hit.opts.body);
  assert.strictEqual(body.search_engine, 'search_std');
  assert.strictEqual(body.search_recency_filter, 'oneWeek');
  assert.strictEqual(body.search_query, '财经');
  assert.strictEqual(hit.opts.headers.Authorization, 'Bearer zhipu-key');
});

test('DeepSeek 搜索走 tools/search，并带 after 时间条件', async () => {
  let chat = 0;
  const fetchStub = (url) => {
    if (String(url).includes('/chat/completions')) {
      chat++;
      if (chat === 1) return sseResponse([{ choices: [{ delta: { content: '<web_search>DeepSeek 发布</web_search>' } }] }]);
      return sseResponse([{ choices: [{ delta: { content: '已查到。' } }] }]);
    }
    if (String(url).includes('/v1/tools/search')) {
      return jsonResponse({ results: [{ title: '发布', url: 'https://api-docs.deepseek.com', snippet: '新版本', summary: 'V4.1' }] });
    }
    return Promise.reject(new Error('unexpected ' + url));
  };
  const { document, calls } = boot({ fetchStub });
  openAI(document);
  configureAI(document, { endpoint: 'https://api.deepseek.com', key: 'sk-ds', webSearch: true });
  document.getElementById('aiSearchProvider').value = 'deepseek';
  document.getElementById('aiSearchFreshness').value = 'week';
  sendMessage(document, 'DeepSeek 现在的版本');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');
  const hit = calls.find((c) => String(c.url).includes('api.deepseek.com/v1/tools/search'));
  assert.ok(hit, '应请求 DeepSeek Search');
  const body = JSON.parse(hit.opts.body);
  assert.ok(body.query.indexOf('after:') !== -1, '应按查询语法附带 after:');
  assert.strictEqual(hit.opts.headers.Authorization, 'Bearer sk-ds');
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
