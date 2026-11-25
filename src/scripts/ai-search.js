/* ========================================================================
 * AI 联网搜索适配层 & 响应读取工具（T23）
 *   - 封装 11 家联网搜索提供商（博查/DeepSeek/智谱/Kimi/百炼/豆包/千帆/You/腾讯元宝/Tavily/自定义）
 *   - 提供报错格式化、结果规范化、SSE/JSON 对话流读取等纯工具函数
 * ====================================================================== */
(function (global) {
  'use strict';

  function clipText(s, n) {
    s = String(s || '').trim();
    return s.length > n ? s.slice(0, n) : s;
  }

  function isoDaysAgo(days) {
    var d = new Date(Date.now() - days * 86400000);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }

  function escapeSearchHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function pickErrorMessage(obj, depth) {
    if (obj == null || depth > 4) return '';
    if (typeof obj === 'string') return obj.trim();
    if (typeof obj !== 'object') return '';
    var keys = ['message', 'msg', 'error_message', 'detail', 'error'];
    for (var i = 0; i < keys.length; i++) {
      if (obj[keys[i]] != null) {
        var got = pickErrorMessage(obj[keys[i]], (depth || 0) + 1);
        if (got) return got;
      }
    }
    if (obj.data) return pickErrorMessage(obj.data, (depth || 0) + 1);
    return '';
  }

  function readableSearchBody(text) {
    var raw = String(text || '').trim();
    if (!raw) return '';
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) {
      var start = raw.indexOf('{');
      var end = raw.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch (e2) {}
      }
    }
    var friendly = parsed ? pickErrorMessage(parsed, 0) : '';
    var snippet = raw.replace(/\s+/g, ' ');
    if (snippet.length > 500) snippet = snippet.slice(0, 500);
    if (friendly && snippet && snippet !== friendly) return friendly + '（原文：' + snippet + '）';
    return friendly || snippet;
  }

  function describeSearchError(err) {
    var status = err && err.httpStatus;
    var body = err && err.body;
    var msg = String((err && err.message) || err || '');
    if (!body) {
      var matched = msg.match(/^搜索API HTTP (\d+)：([\s\S]*)$/);
      if (matched) {
        status = status || matched[1];
        body = matched[2];
      } else {
        body = msg;
      }
    }
    var detail = readableSearchBody(body);
    if (status) return 'HTTP ' + status + '：' + (detail || '无响应正文');
    return detail || '未知错误';
  }

  function searchFailurePrompt(detail) {
    return '【联网搜索失败】\n'
      + '原因：' + detail + '\n'
      + '请用中文把上述原因告诉用户，不要只说「调用失败」或「无法核实」。'
      + '不要编造网址或搜索结果。如果原因和密钥、余额或额度有关，请提醒用户打开 AI 配置窗口，检查当前搜索提供商的密钥和余额。';
  }

  function normalizeSearchItem(p) {
    p = p || {};
    var snippet = p.summary || p.snippet || p.content || p.text || p.description || p.passage || p.Text || '';
    if (!snippet && Array.isArray(p.snippets)) snippet = p.snippets.join('\n');
    if (!snippet && Array.isArray(p.chunks)) {
      snippet = p.chunks.map(function (c) { return (c && (c.text || c.Text || c.content)) || ''; }).filter(Boolean).join('\n');
    }
    if (!snippet && Array.isArray(p.Snippet)) {
      snippet = p.Snippet.map(function (c) { return (c && (c.Text || c.text)) || ''; }).filter(Boolean).join('\n');
    }
    snippet = String(snippet);
    if (snippet.length > 700) snippet = snippet.slice(0, 700);
    return {
      title: p.title || p.name || p.Title || '',
      url: p.url || p.link || p.Url || '',
      snippet: snippet
    };
  }

  function searchItemsToContext(items, maxCount) {
    var limit = parseInt(maxCount, 10);
    if (!limit || limit < 1) limit = 5;
    if (limit > 10) limit = 10;
    var searchContext = '';
    var list = (items || []).slice(0, limit).map(normalizeSearchItem);
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      searchContext += '【' + (i + 1) + '】' + p.title + '\n';
      searchContext += '链接：' + p.url + '\n';
      searchContext += p.snippet + '\n\n';
    }
    return { searchContext: searchContext, resultCount: list.length, failed: false };
  }

  function qianfanQuery(query) {
    var s = String(query || '');
    var n = 0;
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var add = s.charCodeAt(i) > 255 ? 2 : 1;
      if (n + add > 72) break;
      n += add;
      out += s.charAt(i);
    }
    return out || clipText(s, 36);
  }

  function parseMcpPayload(text) {
    var raw = String(text || '').trim();
    if (!raw) return null;
    if (raw.charAt(0) === '{' || raw.charAt(0) === '[') {
      try { return JSON.parse(raw); } catch (e) {}
    }
    var last = null;
    var lines = raw.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf('data:') !== 0) continue;
      var payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try { last = JSON.parse(payload); } catch (e2) {}
    }
    return last;
  }

  function pickMcpTool(tools, preferred) {
    var list = tools || [];
    var i;
    if (preferred) {
      for (i = 0; i < list.length; i++) if (list[i] && list[i].name === preferred) return list[i];
    }
    var order = ['search_pro', 'SearchPro', 'web_search', 'search'];
    for (var n = 0; n < order.length; n++) {
      for (i = 0; i < list.length; i++) if (list[i] && list[i].name === order[n]) return list[i];
    }
    for (i = 0; i < list.length; i++) {
      if (list[i] && /search/i.test(list[i].name || '')) return list[i];
    }
    return list[0] || null;
  }

  function mcpProp(props, names) {
    for (var i = 0; i < names.length; i++) if (props[names[i]]) return names[i];
    return '';
  }

  function mcpResultText(result) {
    if (!result) return '';
    if (typeof result === 'string') return result;
    var content = result.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(function (c) { return (c && (c.text || c.content)) || ''; }).join('\n');
    }
    return JSON.stringify(result);
  }

  function itemsFromUnknown(data) {
    if (!data) return [];
    if (typeof data === 'string') {
      var trimmed = data.trim();
      if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
        try { return itemsFromUnknown(JSON.parse(trimmed)); } catch (e) { return [{ snippet: trimmed.slice(0, 700) }]; }
      }
      return trimmed ? [{ snippet: trimmed.slice(0, 700) }] : [];
    }
    if (Array.isArray(data)) {
      if (data.length && typeof data[0] === 'string') {
        return data.map(function (s) {
          try { return JSON.parse(s); } catch (e) { return { snippet: s }; }
        });
      }
      return data;
    }
    if (Array.isArray(data.Pages)) return itemsFromUnknown(data.Pages);
    if (data.Response && Array.isArray(data.Response.Pages)) return itemsFromUnknown(data.Response.Pages);
    if (Array.isArray(data.search_result)) return data.search_result;
    if (Array.isArray(data.search_results)) return data.search_results;
    if (Array.isArray(data.references)) return data.references;
    if (Array.isArray(data.results)) return data.results;
    if (data.results && Array.isArray(data.results.web)) return data.results.web;
    if (data.Result && Array.isArray(data.Result.Documents)) return data.Result.Documents;
    if (data.data && data.data.webPages && Array.isArray(data.data.webPages.value)) return data.data.webPages.value;
    return [];
  }

  /** 创建与当前 UI 配置解耦的联网搜索客户端 */
  function createSearchClient(opts) {
    opts = opts || {};
    function getProvider() { return opts.getProvider ? opts.getProvider() : 'bocha'; }
    function getKey() { return opts.getKey ? opts.getKey() : ''; }
    function getFreshness() { return opts.getFreshness ? opts.getFreshness() : 'noLimit'; }
    function getCount() {
      var n = parseInt((opts.getCount ? opts.getCount() : 5) || 5, 10);
      if (!n || n < 1) n = 5;
      if (n > 10) n = 10;
      return n;
    }
    function getSummary() { return opts.getSummary ? !!opts.getSummary() : true; }
    function getCustomUrl() { return opts.getCustomUrl ? opts.getCustomUrl() : ''; }
    function getZhipuEngine() { return opts.getZhipuEngine ? opts.getZhipuEngine() : 'search_pro'; }
    function getKimiTier() { return opts.getKimiTier ? opts.getKimiTier() : 'pro'; }

    function fetchSearchPost(url, headers, body, pickItems) {
      return fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000)
      }).then(function (sRes) {
        if (!sRes.ok) {
          return sRes.text().then(function (t) {
            var err = new Error('搜索API HTTP ' + sRes.status);
            err.httpStatus = sRes.status;
            err.body = String(t || '').slice(0, 500);
            throw err;
          });
        }
        return sRes.json();
      }).then(function (data) {
        return searchItemsToContext(pickItems(data), getCount());
      }).catch(function (sErr) {
        return { searchContext: '', resultCount: 0, failed: true, error: sErr };
      });
    }

    function fetchBocha(query) {
      var f = getFreshness();
      return fetch('https://api.bochaai.com/v1/web-search', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + getKey(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: query,
          freshness: f === 'day' ? 'oneDay' : f === 'week' ? 'oneWeek' : f === 'month' ? 'oneMonth' : 'noLimit',
          summary: getSummary(),
          count: getCount()
        }),
        signal: AbortSignal.timeout(30000)
      }).then(function (sRes) {
        if (!sRes.ok) {
          return sRes.text().then(function (t) {
            var err = new Error('搜索API HTTP ' + sRes.status);
            err.httpStatus = sRes.status;
            err.body = String(t || '').slice(0, 500);
            throw err;
          });
        }
        return sRes.json();
      }).then(function (sData) {
        var searchContext = '', resultCount = 0;
        try {
          var webPages = sData.data && sData.data.webPages;
          if (webPages && webPages.value && webPages.value.length > 0) {
            var items = webPages.value.slice(0, getCount());
            resultCount = items.length;
            for (var i = 0; i < items.length; i++) {
              var p = items[i];
              searchContext += '【' + (i + 1) + '】' + (p.name || '') + '\n';
              searchContext += '链接：' + (p.url || '') + '\n';
              searchContext += (p.snippet || p.summary || '') + '\n\n';
            }
          }
        } catch (e) {}
        return { searchContext: searchContext, resultCount: resultCount, failed: false };
      }).catch(function (sErr) {
        return { searchContext: '', resultCount: 0, failed: true, error: sErr };
      });
    }

    function fetchTavily(query) {
      var fresh = getFreshness();
      var body = {
        api_key: getKey(),
        query: query,
        max_results: getCount(),
        include_answer: false,
        search_depth: 'basic'
      };
      if (fresh === 'day' || fresh === 'week' || fresh === 'month') body.time_range = fresh;
      return fetchSearchPost('https://api.tavily.com/search', { 'Content-Type': 'application/json' }, body, function (data) {
        return (data && data.results) || [];
      });
    }

    function fetchCustomSearch(query) {
      var headers = { 'Content-Type': 'application/json' };
      var customKey = getKey();
      if (customKey) headers.Authorization = 'Bearer ' + customKey;
      return fetchSearchPost(getCustomUrl(), headers, {
        query: query,
        count: getCount(),
        freshness: getFreshness()
      }, function (data) {
        if (!data) return [];
        if (data.data && data.data.webPages && data.data.webPages.value) return data.data.webPages.value;
        if (Array.isArray(data.results)) return data.results;
        if (Array.isArray(data.data)) return data.data;
        if (Array.isArray(data)) return data;
        return [];
      });
    }

    function fetchDeepSeekSearch(query) {
      var fresh = getFreshness();
      var q = clipText(query, fresh === 'noLimit' ? 128 : 110);
      if (fresh === 'day') q += ' after:' + isoDaysAgo(1);
      else if (fresh === 'week') q += ' after:' + isoDaysAgo(7);
      else if (fresh === 'month') q += ' after:' + isoDaysAgo(30);
      return fetchSearchPost('https://api.deepseek.com/v1/tools/search', {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getKey()
      }, { query: q, count: getCount(), need_content: false }, function (data) {
        return (data && data.results) || [];
      });
    }

    function fetchZhipu(query) {
      var engine = getZhipuEngine() || 'search_pro';
      var fresh = getFreshness();
      var body = {
        search_query: clipText(query, 70),
        search_engine: engine,
        search_intent: false,
        search_recency_filter: fresh === 'day' ? 'oneDay' : fresh === 'week' ? 'oneWeek' : fresh === 'month' ? 'oneMonth' : 'noLimit'
      };
      if (engine !== 'search_pro_quark') body.count = getCount();
      return fetchSearchPost('https://open.bigmodel.cn/api/paas/v4/web_search', {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getKey()
      }, body, function (data) {
        return (data && (data.search_result || data.search_results)) || [];
      });
    }

    function fetchKimi(query) {
      var tier = getKimiTier() || 'pro';
      var fresh = getFreshness();
      var path = tier === 'basic' ? '/v1/tools/search' : '/v1/tools/search_pro';
      var body = { text_query: query, limit: getCount() };
      if (tier === 'basic') {
        body.include_content = getSummary();
      } else if (fresh === 'day' || fresh === 'week' || fresh === 'month') {
        var days = fresh === 'day' ? 1 : fresh === 'week' ? 7 : 30;
        body.time_window = { start: isoDaysAgo(days), end: isoDaysAgo(0) };
      }
      return fetchSearchPost('https://api.moonshot.ai' + path, {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getKey()
      }, body, function (data) {
        return (data && data.search_results) || [];
      });
    }

    function fetchQianfan(query) {
      var fresh = getFreshness();
      var body = {
        messages: [{ role: 'user', content: qianfanQuery(query) }],
        search_source: 'baidu_search_v2',
        edition: 'standard',
        resource_type_filter: [{ type: 'web', top_k: getCount() }]
      };
      if (fresh === 'day' || fresh === 'week') body.search_recency_filter = 'week';
      else if (fresh === 'month') body.search_recency_filter = 'month';
      return fetchSearchPost('https://qianfan.baidubce.com/v2/ai_search/web_search', {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getKey()
      }, body, function (data) {
        return (data && data.references) || [];
      });
    }

    function fetchDoubao(query) {
      return fetchSearchPost('https://open.feedcoopapi.com/search_api/global_search', {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getKey()
      }, {
        SearchType: 'web',
        Query: clipText(query, 100),
        DocCount: getCount(),
        MaxSnippetLength: 500
      }, function (data) {
        if (data && data.ResponseMetadata && data.ResponseMetadata.Error) {
          var metaErr = new Error('搜索API ' + (data.ResponseMetadata.Error.Message || data.ResponseMetadata.Error.Code || '调用失败'));
          metaErr.body = JSON.stringify(data.ResponseMetadata.Error).slice(0, 500);
          throw metaErr;
        }
        if (data && data.Result && data.Result.ErrorCode) {
          var err = new Error('搜索API ' + data.Result.ErrorCode + ' ' + (data.Result.ErrorMsg || ''));
          err.body = data.Result.ErrorMsg || '';
          throw err;
        }
        return (data && data.Result && data.Result.Documents) || [];
      });
    }

    function fetchYou(query) {
      var body = { query: query, count: getCount() };
      var fresh = getFreshness();
      if (fresh === 'day' || fresh === 'week' || fresh === 'month') body.freshness = fresh;
      return fetchSearchPost('https://ydc-index.io/v1/search', {
        'Content-Type': 'application/json',
        'X-API-Key': getKey()
      }, body, function (data) {
        if (data && data.results && Array.isArray(data.results.web)) return data.results.web;
        if (data && Array.isArray(data.results)) return data.results;
        return [];
      });
    }

    function mcpRequest(url, session, body) {
      var headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': 'Bearer ' + getKey()
      };
      if (session) headers['Mcp-Session-Id'] = session;
      return fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000)
      }).then(function (res) {
        var next = session || '';
        try {
          if (res.headers && res.headers.get) next = res.headers.get('mcp-session-id') || res.headers.get('Mcp-Session-Id') || next;
        } catch (e) {}
        return res.text().then(function (t) {
          if (!res.ok) {
            var err = new Error('搜索API HTTP ' + res.status);
            err.httpStatus = res.status;
            err.body = String(t || '').slice(0, 500);
            throw err;
          }
          return { session: next, json: parseMcpPayload(t), raw: String(t || '') };
        });
      });
    }

    function fillMcpArgs(tool, query, fallbackArgs) {
      var schema = (tool && (tool.inputSchema || tool.input_schema)) || {};
      var props = schema.properties || {};
      var names = Object.keys(props);
      if (!names.length) return fallbackArgs ? fallbackArgs() : { query: query };
      var args = {};
      var qKey = mcpProp(props, ['query', 'Query', 'text_query', 'search_query', 'q']);
      args[qKey || names[0]] = qKey === 'Query' ? clipText(query, 500) : query;
      var countKey = mcpProp(props, ['count', 'Count', 'Cnt', 'limit', 'top_k']);
      if (countKey) args[countKey] = countKey === 'Cnt' ? 10 : getCount();
      var timeKey = mcpProp(props, ['Freshness', 'freshness', 'search_recency_filter', 'time_range']);
      var fresh = getFreshness();
      if (timeKey && fresh !== 'noLimit') {
        if (timeKey === 'Freshness') args[timeKey] = fresh === 'day' ? 'd1' : fresh === 'week' ? 'd7' : 'm1';
        else if (timeKey === 'search_recency_filter') args[timeKey] = fresh === 'day' ? 'oneDay' : fresh === 'week' ? 'oneWeek' : 'oneMonth';
        else args[timeKey] = fresh;
      }
      return args;
    }

    function fetchMcpSearch(url, preferred, query, fallbackArgs) {
      return mcpRequest(url, '', {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'motuo-tab', version: '0.9.0' }
        }
      }).then(function (init) {
        if (init.json && init.json.error) {
          var err = new Error('搜索API ' + (init.json.error.message || 'initialize 失败'));
          err.body = JSON.stringify(init.json.error).slice(0, 500);
          throw err;
        }
        return mcpRequest(url, init.session, { jsonrpc: '2.0', method: 'notifications/initialized' }).then(function () {
          return init.session;
        }, function () { return init.session; });
      }).then(function (session) {
        return mcpRequest(url, session, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }).then(function (listed) {
          return { session: listed.session || session, listed: listed };
        }, function () {
          return { session: session, listed: null };
        });
      }).then(function (state) {
        var tools = state.listed && state.listed.json && state.listed.json.result && state.listed.json.result.tools;
        var tool = pickMcpTool(tools, preferred);
        var args = fillMcpArgs(tool, query, fallbackArgs);
        return mcpRequest(url, state.session, {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: (tool && tool.name) || preferred, arguments: args }
        });
      }).then(function (called) {
        if (called.json && called.json.error) {
          var err = new Error('搜索API ' + (called.json.error.message || 'tools/call 失败'));
          err.body = JSON.stringify(called.json.error).slice(0, 500);
          throw err;
        }
        var result = called.json && called.json.result;
        if (result && result.isError) {
          var err2 = new Error('搜索API 工具返回错误');
          err2.body = mcpResultText(result).slice(0, 500);
          throw err2;
        }
        var text = mcpResultText(result);
        var items = itemsFromUnknown(text);
        if (!items.length) items = itemsFromUnknown(result);
        return searchItemsToContext(items, getCount());
      }).catch(function (sErr) {
        return { searchContext: '', resultCount: 0, failed: true, error: sErr };
      });
    }

    function fetchBailian(query) {
      return fetchMcpSearch('https://dashscope.aliyuncs.com/api/v1/mcps/EnhancedSearch/mcp', 'search_pro', query, function () {
        return { query: query };
      });
    }

    function fetchTencent(query) {
      return fetchMcpSearch('https://api.wsa.cloud.tencent.com/Mcp', 'SearchPro', query, function () {
        var args = { Query: clipText(query, 500), Mode: 0, Cnt: 10 };
        var fresh = getFreshness();
        if (fresh === 'day') args.Freshness = 'd1';
        else if (fresh === 'week') args.Freshness = 'd7';
        else if (fresh === 'month') args.Freshness = 'm1';
        return args;
      });
    }

    function fetchWebSearch(query) {
      var p = getProvider();
      if (p === 'deepseek') return fetchDeepSeekSearch(query);
      if (p === 'zhipu') return fetchZhipu(query);
      if (p === 'kimi') return fetchKimi(query);
      if (p === 'bailian') return fetchBailian(query);
      if (p === 'doubao') return fetchDoubao(query);
      if (p === 'qianfan') return fetchQianfan(query);
      if (p === 'you') return fetchYou(query);
      if (p === 'tencent') return fetchTencent(query);
      if (p === 'tavily') return fetchTavily(query);
      if (p === 'custom') return fetchCustomSearch(query);
      return fetchBocha(query);
    }

    return { fetchWebSearch: fetchWebSearch };
  }

  /** 读取对话 API 响应：流式 SSE 与一次性 JSON 共用 */
  function consumeChatResponse(res, opts, streamEnabled) {
    var ct = '';
    try { if (res.headers && res.headers.get) ct = String(res.headers.get('content-type') || ''); } catch (e) {}
    var canStream = streamEnabled && res.body && typeof res.body.getReader === 'function' && !(/application\/json/i.test(ct));
    if (!canStream) {
      var jsonP = typeof res.json === 'function'
        ? res.json()
        : res.text().then(function (t) { return JSON.parse(t); });
      return jsonP.then(function (data) {
        if (data && data.error) {
          var jErr = new Error('API 错误：' + (typeof data.error === 'string' ? data.error : JSON.stringify(data.error)));
          jErr.apiError = true;
          throw jErr;
        }
        var ch = data && data.choices && data.choices[0];
        var msg = (ch && (ch.message || ch.delta)) || {};
        if (msg.reasoning_content && opts.onReasoning) opts.onReasoning(msg.reasoning_content);
        if (msg.content && opts.onContent) opts.onContent(msg.content);
        if (msg.tool_calls && opts.onToolCalls) opts.onToolCalls(msg.tool_calls);
      });
    }
    return new Promise(function (resolve, reject) {
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      (function read() {
        reader.read().then(function (r) {
          if (r.done) return resolve();
          buf += dec.decode(r.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop() || '';
          for (var i = 0; i < lines.length; i++) {
            var ln = lines[i].trim();
            if (!ln || ln.indexOf(':') === 0 || ln === 'data: [DONE]') continue;
            if (ln.indexOf('data: ') === 0) {
              try {
                var ch = JSON.parse(ln.slice(6));
                if (ch && ch.error) {
                  var _apiErr = new Error('API 流式错误：' + (typeof ch.error === 'string' ? ch.error : JSON.stringify(ch.error)));
                  _apiErr.apiError = true;
                  throw _apiErr;
                }
                var d = ch.choices && ch.choices[0] && ch.choices[0].delta;
                if (!d) continue;
                if (opts.onFirstDelta) { opts.onFirstDelta(d); opts.onFirstDelta = null; }
                if (d.content && opts.onContent) opts.onContent(d.content);
                if (d.reasoning_content && opts.onReasoning) opts.onReasoning(d.reasoning_content);
                if (d.tool_calls && opts.onToolCalls) opts.onToolCalls(d.tool_calls);
              } catch (e) { if (e && e.apiError) throw e; }
            }
          }
          read();
        }, reject);
      })();
    });
  }

  global.__motuoAISearch = {
    clipText: clipText,
    isoDaysAgo: isoDaysAgo,
    escapeSearchHtml: escapeSearchHtml,
    pickErrorMessage: pickErrorMessage,
    readableSearchBody: readableSearchBody,
    describeSearchError: describeSearchError,
    searchFailurePrompt: searchFailurePrompt,
    normalizeSearchItem: normalizeSearchItem,
    searchItemsToContext: searchItemsToContext,
    qianfanQuery: qianfanQuery,
    parseMcpPayload: parseMcpPayload,
    itemsFromUnknown: itemsFromUnknown,
    createSearchClient: createSearchClient,
    consumeChatResponse: consumeChatResponse
  };
})(typeof window !== 'undefined' ? window : globalThis);
