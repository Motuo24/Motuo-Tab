// T23：独立联网搜索适配层（src/scripts/ai-search.js）单元测试
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { setupWindow, jsonResponse } = require('./helpers.js');

const active = [];
afterEach(() => {
  while (active.length) {
    try { active.pop().close(); } catch (e) {}
  }
});

test('ai-search 模块挂在 window.__motuoAISearch 且工具函数行为正确', () => {
  const { window } = setupWindow({
    fetchStub: () => Promise.resolve({ ok: false, status: 404 })
  });
  active.push(window);
  const mod = window.__motuoAISearch;
  assert.ok(mod, 'window.__motuoAISearch 应存在');
  assert.strictEqual(mod.clipText('  hello world  ', 5), 'hello');
  assert.strictEqual(mod.escapeSearchHtml('<a&b>'), '&lt;a&amp;b&gt;');
  assert.strictEqual(mod.qianfanQuery('中a文b测'), '中a文b测');

  const ctx = mod.searchItemsToContext([
    { title: '标题一', url: 'https://a.test', snippet: '摘要一' },
    { name: '标题二', link: 'https://b.test', content: '摘要二' }
  ], 1);
  assert.strictEqual(ctx.resultCount, 1);
  assert.ok(ctx.searchContext.includes('标题一'));
  assert.ok(!ctx.searchContext.includes('标题二'));

  const detail = mod.describeSearchError({
    httpStatus: 402,
    body: JSON.stringify({ error: { message: '账户余额不足' } })
  });
  assert.ok(detail.includes('HTTP 402'));
  assert.ok(detail.includes('账户余额不足'));

  const unknown = mod.itemsFromUnknown(JSON.stringify({
    Pages: [JSON.stringify({ title: '元宝', url: 'https://t.example', passage: '内容' })]
  }));
  assert.strictEqual(unknown.length, 1);
  assert.strictEqual(unknown[0].title, '元宝');
});

test('createSearchClient 支持 DeepSeek / 智谱 / 自定义等不同鉴权与请求体', async () => {
  const requests = [];
  const { window } = setupWindow({
    fetchStub(url, opts) {
      if (!opts || opts.method !== 'POST') return Promise.resolve({ ok: false, status: 404 });
      requests.push({ url, opts, body: JSON.parse(opts.body) });
      return jsonResponse({
        results: [{ title: 'DS结果', url: 'https://ds.example', snippet: 'ok' }],
        search_result: [{ title: '智谱结果', link: 'https://zp.example', content: 'ok2' }]
      });
    }
  });
  active.push(window);
  const mod = window.__motuoAISearch;

  const dsClient = mod.createSearchClient({
    getProvider: () => 'deepseek',
    getKey: () => 'sk-ds-123',
    getFreshness: () => 'week',
    getCount: () => 3
  });
  const r1 = await dsClient.fetchWebSearch('Motuo');
  assert.strictEqual(r1.failed, false);
  assert.strictEqual(r1.resultCount, 1);
  assert.ok(requests[0].url.includes('api.deepseek.com/v1/tools/search'));
  assert.strictEqual(requests[0].opts.headers.Authorization, 'Bearer sk-ds-123');
  assert.ok(requests[0].body.query.includes('after:'));

  const zpClient = mod.createSearchClient({
    getProvider: () => 'zhipu',
    getKey: () => 'sk-zp-123',
    getFreshness: () => 'day',
    getCount: () => 4,
    getZhipuEngine: () => 'search_pro'
  });
  const r2 = await zpClient.fetchWebSearch('今日新闻');
  assert.strictEqual(r2.failed, false);
  assert.ok(requests[1].url.includes('open.bigmodel.cn'));
  assert.strictEqual(requests[1].body.search_recency_filter, 'oneDay');

  const youClient = mod.createSearchClient({
    getProvider: () => 'you',
    getKey: () => 'you-key-99',
    getFreshness: () => 'noLimit',
    getCount: () => 5
  });
  await youClient.fetchWebSearch('test');
  assert.strictEqual(requests[2].opts.headers['X-API-Key'], 'you-key-99');
});
