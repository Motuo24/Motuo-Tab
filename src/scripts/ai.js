/* ========================================================================
 * AI 助手（独立脚本，须在 main.js 之后加载）
 *   流式对话、深度思考、联网搜索、<ops> 卡片操作与撤销。
 *   卡片数据经 window.__motuo.cards 与主模块交换，避免共享闭包。
 * ====================================================================== */
(function () {
  var bridge = window.__motuo && window.__motuo.cards;
  if (!bridge) return;
  var cards = bridge;
  var nav = cards.nav;
  var save = cards.save;
  var render = cards.render;
  var applyAutoIcon = cards.applyAutoIcon;
  var AI_CONFIG_KEY = cards.keys.config;
  var AI_HISTORY_KEY = cards.keys.history;
  var AI_SNAPSHOT_KEY = cards.keys.snapshot;

      // ========== AI 助手 ==========
      // （AI_CONFIG_KEY / AI_HISTORY_KEY 已在顶部 CONFIG 声明）
      var aiFab = document.getElementById('aiFab');
      var aiPanel = document.getElementById('aiPanel');
      var aiOverlay = document.getElementById('aiOverlay');
      var aiClose = document.getElementById('aiClose');
      var aiMessages = document.getElementById('aiMessages');
      var aiInput = document.getElementById('aiInput');
      var aiSend = document.getElementById('aiSend');
      var aiModelBadge = document.getElementById('aiModelBadge');
      var aiToastEl = document.getElementById('aiToast');
      var aiScrollBottom = document.getElementById('aiScrollBottom');

      var aiEndpoint = document.getElementById('aiEndpoint');
      var aiKey = document.getElementById('aiKey');
      var aiModel = document.getElementById('aiModel');
      var aiWebSearch = document.getElementById('aiWebSearch');
      var aiBochaKey = document.getElementById('aiBochaKey');
      var aiDeepSearch = document.getElementById('aiDeepSearch');

      // 对话历史
      var aiHistory = [];
      var aiSending = false; // 是否正在请求中
      var lastSearchQuery = '';
      var pendingSnapshotId = null;
      var aiProfiles = [];
      var activeProfile = null;
      try { lastSearchQuery = localStorage.getItem('newtab.ai.lastQuery.v1') || ''; } catch (e) {}

      function fieldValue(id) {
        var el = document.getElementById(id);
        return el ? String(el.value || '').trim() : '';
      }
      function isChecked(id, def) {
        var el = document.getElementById(id);
        return el ? !!el.checked : !!def;
      }
      function isSendTopP() { return isChecked('aiSendTopP', false); }
      function topPValue() {
        var n = parseFloat(fieldValue('aiTopP') || '0.9');
        if (isNaN(n) || n < 0.05) return 0.9;
        if (n > 1) return 1;
        return n;
      }
      function historyLimit() {
        var n = parseInt(fieldValue('aiHistoryLimit') || '20', 10);
        if (isNaN(n) || n < 4) return 20;
        if (n > 60) return 60;
        return n;
      }
      function timeoutMs() {
        var sec = parseInt(fieldValue('aiTimeoutSec') || '120', 10);
        if (isNaN(sec) || sec < 10) sec = 120;
        return sec * 1000;
      }
      function isStreamEnabled() { return isChecked('aiStreamEnabled', true); }
      function shouldConfirmBulkDelete() { return isChecked('aiConfirmBulkDelete', true); }
      function maxSearchRounds() {
        var n = parseInt(fieldValue('aiMaxSearchRounds') || '3', 10);
        if (isNaN(n) || n < 1) return 3;
        if (n > 10) return 10;
        return n;
      }
      function shouldCiteSources() { return isChecked('aiCiteSources', true); }
      function includeKeysInBackup() { return isChecked('aiBackupIncludeKeys', true); }
      function parseJsonObjectField(id) {
        var rawJson = fieldValue(id);
        if (!rawJson) return { ok: true, obj: null, error: '' };
        try {
          var parsed = JSON.parse(rawJson);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { ok: false, obj: null, error: '必须是 JSON 对象（{ ... }）' };
          }
          return { ok: true, obj: parsed, error: '' };
        } catch (e) {
          return { ok: false, obj: null, error: 'JSON 格式错误：' + (e && e.message ? e.message : e) };
        }
      }
      function buildModelsUrl(endpoint) {
        var rawEp = String(endpoint || '').trim();
        if (!rawEp) return '';
        var q = '';
        var qi = rawEp.indexOf('?');
        if (qi !== -1) { q = rawEp.slice(qi); rawEp = rawEp.slice(0, qi); }
        rawEp = rawEp.replace(/\/+$/, '');
        if (/\/chat\/completions$/i.test(rawEp)) {
          return rawEp.replace(/\/chat\/completions$/i, '/models') + q;
        }
        var path = rawEp.replace(/^https?:\/\/[^/]+/, '');
        if (!/\/v\d+/.test(path)) rawEp += '/v1';
        return rawEp + '/models' + q;
      }
      function buildChatHeaders(key) {
        var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };
        var parsed = parseJsonObjectField('aiCustomHeaders');
        if (parsed.ok && parsed.obj) {
          Object.keys(parsed.obj).forEach(function (k) {
            if (parsed.obj[k] != null) headers[k] = String(parsed.obj[k]);
          });
        }
        return headers;
      }
      function redactAIConfigObject(cfg) {
        if (!cfg || typeof cfg !== 'object') return cfg;
        var clone = JSON.parse(JSON.stringify(cfg));
        if (clone.includeKeysInBackup !== false) return clone;
        clone.key = '';
        clone.bochaKey = '';
        if (Array.isArray(clone.profiles)) {
          clone.profiles.forEach(function (item) { if (item && typeof item === 'object') item.key = ''; });
        }
        if (clone.search && typeof clone.search === 'object') {
          clone.search.bochaKey = '';
          clone.search.tavilyKey = '';
          clone.search.customKey = '';
          if (clone.search.keys && typeof clone.search.keys === 'object') clone.search.keys = {};
        }
        if (typeof clone.customHeaders === 'string' && clone.customHeaders.trim()) {
          try {
            var hdrs = JSON.parse(clone.customHeaders);
            if (hdrs && typeof hdrs === 'object' && !Array.isArray(hdrs)) {
              Object.keys(hdrs).forEach(function (hk) {
                if (/authorization|api[-_]?key|token|secret/i.test(hk)) delete hdrs[hk];
              });
              clone.customHeaders = JSON.stringify(hdrs);
            }
          } catch (e) {}
        }
        return clone;
      }
      window.__motuo.redactAIConfigJson = function (rawJson) {
        if (!rawJson) return rawJson;
        try {
          var parsed = JSON.parse(rawJson);
          if (!parsed || parsed.includeKeysInBackup !== false) return rawJson;
          return JSON.stringify(redactAIConfigObject(parsed));
        } catch (e) { return rawJson; }
      };
      function thinkingGear() {
        if (!(aiDeepSearch && aiDeepSearch.checked)) return 'off';
        var gear = fieldValue('aiThinkingGear') || 'high';
        if (gear !== 'low' && gear !== 'medium' && gear !== 'high') return 'high';
        return gear;
      }
      function nativeThinkingHost(endpoint, model) {
        var blob = (String(endpoint || '') + ' ' + String(model || '')).toLowerCase();
        return blob.indexOf('deepseek') !== -1 || blob.indexOf('bigmodel') !== -1 || blob.indexOf('zhipu') !== -1;
      }
      var SEARCH_CHECKED = '2026-11-20';
      var searchKeyBag = {};
      var shownProvider = 'bocha';
      function searchProvider() { return fieldValue('aiSearchProvider') || 'bocha'; }
      function currentSearchKey() {
        var typed = fieldValue('aiSearchKey');
        if (typed) return typed;
        var p = searchProvider();
        if (searchKeyBag[p]) return searchKeyBag[p];
        if (p === 'tavily') return fieldValue('aiTavilyKey');
        if (p === 'custom') return fieldValue('aiCustomKey');
        if (p === 'bocha' && aiBochaKey) return aiBochaKey.value.trim();
        if (p === 'deepseek' && aiKey) return aiKey.value.trim();
        return '';
      }
      function providerReady() {
        if (searchProvider() === 'custom') return !!fieldValue('aiCustomUrl');
        return !!currentSearchKey();
      }
      function clipText(s, n) {
        s = String(s || '').trim();
        return s.length > n ? s.slice(0, n) : s;
      }
      function isoDaysAgo(days) {
        var d = new Date(Date.now() - days * 86400000);
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
      }
      function searchCount() {
        var n = parseInt(fieldValue('aiSearchCount') || '5', 10);
        if (!n || n < 1) n = 5;
        if (n > 10) n = 10;
        return n;
      }
      function searchFreshness() { return fieldValue('aiSearchFreshness') || 'noLimit'; }
      function cardLinesText() {
        var lines = [];
        for (var i = 0; i < cards.list.length; i++) {
          var it = cards.list[i];
          lines.push('- 名称：' + it.name + ' ｜ 网址：' + (it.url ? it.url : '（未设置）'));
        }
        return lines.join('\n') || '（暂无卡片）';
      }
      function searchRulesText() {
        if (!(aiWebSearch && aiWebSearch.checked && providerReady())) return '';
        var citeNote = shouldCiteSources() ? '用中文回答并标注来源编号（如 [1]）。' : '用中文回答。';
        return '## 联网搜索（优先级最高）\n'
          + '当用户需要实时或最新信息时，本轮不要直接回答，也不要输出 <ops>；只输出一行：\n'
          + '<web_search>简洁有效的搜索关键词</web_search>\n'
          + '用户说再搜一次且没给新关键词时，沿用最近一次搜索词：' + (lastSearchQuery || '（还没有）') + '。\n'
          + '客户端会把结果发回。收到后：若用户还要求改卡片，输出一行摘要和 <ops>；否则' + citeNote + '\n'
          + '常识题直接回答。\n';
      }
      function opsContractText() {
        var first = cards.list.length ? String(cards.list[0].name).replace(/"/g, '') : 'GitHub';
        return '## 卡片操作\n'
          + '只有确实要改快捷方式时，才在回复末尾输出一个 <ops>。只写用到的键，不要输出空数组。\n'
          + '已存在的同名卡片不要再 add。没有把握的网址先问，不要编。\n'
          + '改名写成 {"name":"现有名称","newName":"新名称"}。\n'
          + 'reorder 是整表排序：只写一个名字时，这张放到最前，其余按原来的相对顺序接在后面。\n'
          + '正例：\n已添加 Google\n<ops>\n{"add":[{"name":"Google","url":"https://www.google.com","iconSrc":"auto","color":"blue"}]}\n</ops>\n'
          + '已将该卡片图标改为绿色\n<ops>\n{"update":[{"name":"' + first + '","color":"green"}]}\n</ops>\n';
      }
      function thinkingHint() {
        var gear = thinkingGear();
        if (gear === 'off') return '';
        if (nativeThinkingHost(aiEndpoint && aiEndpoint.value, aiModel && aiModel.value)) return '';
        if (gear === 'low') return '\n回答尽量简短。\n';
        if (gear === 'medium') return '\n先想清楚再回答，不要把思考过程写给用户。\n';
        return '\n充分思考后再回答，不要把思考过程写给用户。\n';
      }
      function legacyPromptTemplate() {
        return '你是 Motuo-Tab 的快捷方式管理助手。\n\n'
          + '## 当前卡片（共 {{card_count}} 个；下面已经给出每张卡片的名称和网址，不要声称看不到）\n'
          + '{{cards}}\n\n'
          + '## 站内搜索直达\n{{site_direct}}\n\n'
          + '{{search_rules}}\n'
          + '{{ops_contract}}\n';
      }
      function oldCombinedPrompt(id) {
        if (id === 'cards') {
          return '你是 Motuo-Tab 的快捷方式管理员。Motuo-Tab 是浏览器新标签页，你只处理下面这些卡片。\n\n'
            + '## 当前卡片（共 {{card_count}} 个）\n'
            + '{{cards}}\n\n'
            + '用户没有明确要求添加、修改、排序或删除卡片时，不要输出 <ops>。\n'
            + '{{ops_contract}}\n';
        }
        if (id === 'qa') {
          return '你负责回答 Motuo-Tab 怎么用。这是一个浏览器新标签页，作者是 Motuo（Motuo24，pod.xr24.cn），数据只在本机。\n\n'
            + '能做的事：搜索（百度 / 必应 / 谷歌 / 自定义 %s 引擎）、搜索历史管理、联网联想开关、站内直达（{{site_direct}}）、快捷方式的增删改和拖拽、壁纸与主题、速记、导入导出。快捷键是 Ctrl+E、Ctrl+K、Ctrl+A、Esc。\n\n'
            + '## 当前卡片（共 {{card_count}} 个）\n'
            + '{{cards}}\n\n'
            + '先回答问题。只有用户明确要求改快捷方式时，才在末尾输出 <ops>。你不能替用户改壁纸、主题或速记。\n'
            + '{{search_rules}}\n'
            + '{{ops_contract}}\n';
        }
        return '你是 Motuo-Tab 的页内助手。\n\n'
          + '## 项目\n'
          + 'Motuo-Tab 是 Motuo（Motuo24，说明站 pod.xr24.cn）做的浏览器新标签页。它替换新开的标签页，用来放快捷方式、搜索、壁纸和速记。数据只存在这台浏览器里，没有项目自己的服务器。\n\n'
          + '## 页面现在有的能力\n'
          + '- 搜索：百度、必应、谷歌，以及用户自己添加的引擎（地址模板用 %s 表示关键词）。搜索历史在菜单「通用配置」里可以逐条删、多选删或清空。输入联想先用本机历史，再向百度要联想词；菜单里的「联网搜索建议」关掉后，只留本机历史。\n'
          + '- 站内直达：{{site_direct}}\n'
          + '- 快捷方式：添加、改名、改网址、改颜色、排序、删除。右键可以新标签页打开、编辑、删除、复制链接或复制成 Markdown。Ctrl+K 进入编辑模式后可以拖动排序，拖进底部删除区即删除。图标可以自动抓取。\n'
          + '- 外观：图片、视频、动图或纯色壁纸，模糊，卡片透明度，浅色 / 深色 / 自动主题。\n'
          + '- 速记：右下角「速记」，输入后自动留在本机。\n'
          + '- 备份：菜单「通用配置」导出或导入全部本机数据。\n'
          + '- 快捷键：Ctrl+E 专注模式，Ctrl+K 编辑模式，Ctrl+A 打开本助手，Esc 关闭弹窗。Mac 上用 Command 代替 Ctrl。\n\n'
          + '## 你的边界\n'
          + '你只能用文末的 <ops> 修改快捷方式卡片。不要改壁纸、主题、速记、搜索引擎或搜索历史，也不要声称能看到其他标签页、浏览历史或密码。没有把握的网址先问，不要编。下面的卡片列表是当前页面的真实数据，不要说自己看不到。\n\n'
          + '## 当前卡片（共 {{card_count}} 个）\n'
          + '{{cards}}\n\n'
          + '{{search_rules}}\n'
          + '{{ops_contract}}\n';
      }
      function builtinSystemPresets() {
        return [
          {
            id: 'general',
            name: '通用助手',
            builtin: true,
            text: '你是 Motuo-Tab 的页内助手。\n\n'
              + '## 项目\n'
              + 'Motuo-Tab 是 Motuo（Motuo24，说明站 pod.xr24.cn）做的浏览器新标签页。它替换新开的标签页，用来放快捷方式、搜索、壁纸和速记。数据只存在这台浏览器里，没有项目自己的服务器。\n\n'
              + '## 页面现在有的能力\n'
              + '- 搜索：百度、必应、谷歌，以及用户自己添加的引擎（地址模板用 %s 表示关键词）。搜索历史在菜单「通用配置」里可以逐条删、多选删或清空。输入联想先用本机历史，再向百度要联想词；菜单里的「联网搜索建议」关掉后，只留本机历史。\n'
              + '- 站内直达：搜索框输入「前缀 空格 关键词」。zh 知乎，gh GitHub，bl 和 b站 是哔哩哔哩，tb 淘宝，db 豆瓣。\n'
              + '- 快捷方式：添加、改名、改网址、改颜色、排序、删除。右键可以新标签页打开、编辑、删除、复制链接或复制成 Markdown。Ctrl+K 进入编辑模式后可以拖动排序，拖进底部删除区即删除。图标可以自动抓取。\n'
              + '- 外观：图片、视频、动图或纯色壁纸，模糊，卡片透明度，浅色 / 深色 / 自动主题。\n'
              + '- 速记：右下角「速记」，输入后自动留在本机。\n'
              + '- 备份：菜单「通用配置」导出或导入全部本机数据。\n'
              + '- 快捷键：Ctrl+E 专注模式，Ctrl+K 编辑模式，Ctrl+A 打开本助手，Esc 关闭弹窗。Mac 上用 Command 代替 Ctrl。\n\n'
              + '## 你的边界\n'
              + '你只能用文末的 <ops> 修改快捷方式卡片。不要改壁纸、主题、速记、搜索引擎或搜索历史，也不要声称能看到其他标签页、浏览历史或密码。没有把握的网址先问，不要编。\n'
              + '当前有哪些卡片，以用户消息前面的环境说明为准，不要说自己看不到。\n'
          },
          {
            id: 'cards',
            name: '只改卡片',
            builtin: true,
            text: '你是 Motuo-Tab 的快捷方式管理员。Motuo-Tab 是浏览器新标签页，你只处理快捷方式卡片。\n'
              + '用户没有明确要求添加、修改、排序或删除卡片时，不要输出 <ops>。没有把握的网址先问，不要编。\n'
          },
          {
            id: 'qa',
            name: '页面问答',
            builtin: true,
            text: '你负责回答 Motuo-Tab 怎么用。这是一个浏览器新标签页，作者是 Motuo（Motuo24，pod.xr24.cn），数据只在本机。\n'
              + '能做的事：搜索（百度 / 必应 / 谷歌 / 自定义 %s 引擎）、搜索历史管理、联网联想开关、站内直达、快捷方式的增删改和拖拽、壁纸与主题、速记、导入导出。快捷键是 Ctrl+E、Ctrl+K、Ctrl+A、Esc。\n'
              + '先回答问题。只有用户明确要求改快捷方式时，才在末尾输出 <ops>。你不能替用户改壁纸、主题或速记。\n'
          }
        ];
      }
      function builtinContextPresets() {
        return [
          {
            id: 'full',
            name: '完整环境',
            builtin: true,
            text: '## 当前环境\n'
              + '页面上现有 {{card_count}} 张快捷方式。下面是此刻的列表。\n'
              + '{{cards}}\n\n'
              + '## 站内直达\n{{site_direct}}\n\n'
              + '{{search_rules}}\n'
              + '{{ops_contract}}\n'
          },
          {
            id: 'cards',
            name: '仅卡片',
            builtin: true,
            text: '## 当前卡片（共 {{card_count}} 个）\n{{cards}}\n'
          },
          {
            id: 'none',
            name: '不附加',
            builtin: true,
            text: ''
          }
        ];
      }
      var systemPresetList = builtinSystemPresets();
      var contextPresetList = builtinContextPresets();
      var activeSystemPresetId = 'general';
      var activeContextPresetId = 'full';
      function defaultPromptTemplate() {
        return builtinSystemPresets()[0].text;
      }
      function presetById(list, id) {
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return list[0] || null;
      }
      function mergePresets(saved, builtins) {
        var out = [];
        builtins.forEach(function (b) {
          var hit = null;
          (saved || []).forEach(function (p) { if (p && p.id === b.id) hit = p; });
          out.push({
            id: b.id,
            name: (hit && hit.name) || b.name,
            text: hit && typeof hit.text === 'string' ? hit.text : b.text,
            builtin: true
          });
        });
        (saved || []).forEach(function (p) {
          if (!p || !p.id || out.some(function (x) { return x.id === p.id; })) return;
          out.push({ id: p.id, name: p.name || '未命名', text: p.text || '', builtin: false });
        });
        return out;
      }
      function classifyStoredPrompt(text) {
        var t = String(text || '').trim();
        if (!t || t === legacyPromptTemplate().trim() || t === oldCombinedPrompt('general').trim()) {
          return { systemId: 'general', contextId: 'full' };
        }
        if (t === oldCombinedPrompt('cards').trim()) return { systemId: 'cards', contextId: 'cards' };
        if (t === oldCombinedPrompt('qa').trim()) return { systemId: 'qa', contextId: 'full' };
        return {
          custom: t,
          contextId: /\{\{(cards|ops_contract|search_rules|site_direct|card_names|card_count|last_query)\}\}/.test(t) ? 'none' : 'full'
        };
      }
      function layerState(kind) {
        if (kind === 'context') {
          return {
            list: function () { return contextPresetList; },
            getId: function () { return activeContextPresetId; },
            setId: function (v) { activeContextPresetId = v; },
            select: 'aiContextPreset',
            selectWrap: 'aiContextSelectWrap',
            name: 'aiContextPresetName',
            rename: 'aiContextPresetRename',
            reset: 'aiContextPresetReset',
            del: 'aiContextPresetDel',
            delSep: 'aiContextPresetDelSep',
            box: 'aiContextPrompt'
          };
        }
        return {
          list: function () { return systemPresetList; },
          getId: function () { return activeSystemPresetId; },
          setId: function (v) { activeSystemPresetId = v; },
          select: 'aiPromptPreset',
          selectWrap: 'aiSystemSelectWrap',
          name: 'aiSystemPresetName',
          rename: 'aiSystemPresetRename',
          reset: 'aiSystemPresetReset',
          del: 'aiSystemPresetDel',
          delSep: 'aiSystemPresetDelSep',
          box: 'aiSystemPrompt'
        };
      }
      function commitLayer(kind) {
        var s = layerState(kind);
        var cur = presetById(s.list(), s.getId());
        if (!cur) return;
        var box = document.getElementById(s.box);
        var name = document.getElementById(s.name);
        if (box) cur.text = box.value;
        if (!cur.builtin && name && name.value.trim()) cur.name = name.value.trim();
      }
      function renderLayer(kind) {
        var s = layerState(kind);
        var list = s.list();
        var sel = document.getElementById(s.select);
        if (sel) {
          var prev = s.getId();
          sel.innerHTML = '';
          list.forEach(function (p) {
            var opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name || '未命名';
            if (p.id === prev) opt.selected = true;
            sel.appendChild(opt);
          });
          if (!presetById(list, prev) && list[0]) s.setId(list[0].id);
        }
        var cur = presetById(list, s.getId());
        var box = document.getElementById(s.box);
        var name = document.getElementById(s.name);
        if (box && cur && document.activeElement !== box) box.value = cur.text;
        if (name && cur && document.activeElement !== name) name.value = cur.name || '';
        var isBuiltin = !!(cur && cur.builtin);
        var del = document.getElementById(s.del);
        var delSep = document.getElementById(s.delSep);
        var ren = document.getElementById(s.rename);
        var rst = document.getElementById(s.reset);
        if (del) del.hidden = !cur || isBuiltin;
        if (delSep) delSep.hidden = !cur || isBuiltin;
        if (ren) ren.hidden = !cur || isBuiltin;
        if (rst) rst.hidden = !cur || !isBuiltin;
        if (typeof syncCustomSelect === 'function') syncCustomSelect(sel);
      }
      function commitPromptLayers() {
        commitLayer('system');
        commitLayer('context');
      }
      function currentDateTimeVars() {
        var d = new Date();
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        var date = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        var time = pad(d.getHours()) + ':' + pad(d.getMinutes());
        var tAttr = document.documentElement.getAttribute('data-theme') || 'light';
        var theme = tAttr === 'dark' ? '深色' : '浅色';
        var engKey = '';
        try { engKey = localStorage.getItem('newtab.engine.v1') || 'baidu'; } catch (e) { engKey = 'baidu'; }
        var engNames = { baidu: '百度', bing: '必应', google: 'Google' };
        var engine = engNames[engKey] || engKey;
        return { date: date, time: time, theme: theme, engine: engine };
      }
      function fillPrompt(template) {
        var names = cards.list.map(function (x) { return x.name; }).join('、') || '（暂无卡片）';
        var ctxVars = currentDateTimeVars();
        return String(template || '')
          .replace(/\{\{cards\}\}/g, cardLinesText())
          .replace(/\{\{card_names\}\}/g, names)
          .replace(/\{\{card_count\}\}/g, String(cards.list.length))
          .replace(/\{\{site_direct\}\}/g, '搜索框输入「前缀 空格 关键词」会打开对应网站的站内搜索。zh 知乎，gh GitHub，bl 和 b站 都是哔哩哔哩，tb 淘宝，db 豆瓣。开关在菜单「站内搜索直达」。')
          .replace(/\{\{search_rules\}\}/g, searchRulesText())
          .replace(/\{\{ops_contract\}\}/g, opsContractText())
          .replace(/\{\{last_query\}\}/g, lastSearchQuery || '（还没有）')
          .replace(/\{\{date\}\}/g, ctxVars.date)
          .replace(/\{\{time\}\}/g, ctxVars.time)
          .replace(/\{\{theme\}\}/g, ctxVars.theme)
          .replace(/\{\{engine\}\}/g, ctxVars.engine);
      }
      function buildSystemPrompt() {
        var box = document.getElementById('aiSystemPrompt');
        var cur = presetById(systemPresetList, activeSystemPresetId);
        var tpl = box && box.value.trim() ? box.value : (cur && cur.text) || defaultPromptTemplate();
        return fillPrompt(tpl) + thinkingHint();
      }
      function buildContextPrefix() {
        var box = document.getElementById('aiContextPrompt');
        var cur = presetById(contextPresetList, activeContextPresetId);
        var tpl = box ? box.value : (cur && cur.text) || '';
        if (!String(tpl).trim()) return '';
        return fillPrompt(tpl).trim();
      }
      function buildChatUrl(endpoint) {
        var raw = String(endpoint || '').trim();
        if (!raw) return raw;
        if (raw.indexOf('/chat/completions') !== -1) return raw;
        var q = '';
        var qi = raw.indexOf('?');
        if (qi !== -1) { q = raw.slice(qi); raw = raw.slice(0, qi); }
        raw = raw.replace(/\/+$/, '');
        var path = raw.replace(/^https?:\/\/[^/]+/, '');
        if (!/\/v\d+/.test(path)) raw += '/v1';
        return raw + '/chat/completions' + q;
      }
      function buildChatBody(modelName, messages, endpointValue) {
        var body = { model: modelName, messages: messages, stream: isStreamEnabled() };
        var sendTemp = document.getElementById('aiSendTemperature');
        if (!sendTemp || sendTemp.checked) {
          var tEl = document.getElementById('aiTemperature');
          var temp = tEl && tEl.value !== '' ? parseFloat(tEl.value) : 0.1;
          if (!isNaN(temp)) body.temperature = temp;
        }
        if (isSendTopP()) {
          body.top_p = topPValue();
        }
        var mt = parseInt(fieldValue('aiMaxTokens'), 10);
        if (mt > 0) body.max_tokens = mt;
        var gear = thinkingGear();
        if (gear !== 'off' && nativeThinkingHost(endpointValue, modelName)) {
          var effort = gear === 'low' ? 'low' : gear === 'medium' ? 'medium' : 'high';
          body.thinking = { type: 'enabled' };
          if ((String(endpointValue || '') + ' ' + modelName).toLowerCase().indexOf('deepseek') !== -1) {
            body.reasoning_effort = effort;
          }
        }
        var extra = parseJsonObjectField('aiExtraBody');
        if (extra.ok && extra.obj) {
          Object.keys(extra.obj).forEach(function (k) {
            if (k !== 'model' && k !== 'messages') body[k] = extra.obj[k];
          });
        }
        return body;
      }

      // 加载历史
      (function loadAIHistory() {
        try {
          var raw = localStorage.getItem(AI_HISTORY_KEY);
          if (raw) {
            aiHistory = JSON.parse(raw);
            if (!Array.isArray(aiHistory)) aiHistory = [];
          }
        } catch (e) {}
        // 一次性迁移：旧历史存的是"渲染后的 HTML 快照"（rendered），样式被冻结；
        // 改为只存纯文本 + 语义标签（<think>/<tool_call>/<ops>），渲染时由前端套用样式。
        migrateAIHistory();
        // 不再过滤 tool 相关消息：联网搜索需要保留 assistant(tool_calls) + tool 历史
        // 如果历史为空或首条不是 system，插入初始 system 消息
        if (aiHistory.length === 0 || aiHistory[0].role !== 'system') {
          aiHistory.unshift({ role: 'system', content: buildSystemPrompt() });
        }
      })();

      // 迁移旧历史：把 rendered HTML 快照中的思考文本抽回 <think> 标签，并删除 rendered
      function migrateAIHistory() {
        var changed = false;
        aiHistory.forEach(function (m) {
          if (!m || m.role !== 'assistant') return;
          if (!m.rendered) return;
          var content = m.content;
          // 内容里没有语义标签时，尝试从旧 HTML 快照提取思考文本
          if (typeof content !== 'string' || !/<think>|<tool_call>|<ops>/i.test(content)) {
            try {
              var tmp = document.createElement('div');
              tmp.innerHTML = m.rendered;
              var rt = tmp.querySelector('.ai-reasoning-text');
              if (rt && rt.textContent && rt.textContent.trim()) {
                m.content = '<think>' + rt.textContent + '</think>\n' + (content || '');
              }
            } catch (e) {}
          }
          delete m.rendered;
          changed = true;
        });
        if (changed) saveAIHistory();
      }

      // 历史裁剪：防止联网搜索的 hidden 结果无限堆积导致上下文超长（HTTP 400）
      var AI_MAX_MESSAGES = 60;   // system 之后最多保留的消息条数
      var AI_MAX_HIDDEN = 8;      // 最多保留的 hidden 搜索结果条数
      function pruneAIHistory() {
        if (aiHistory.length <= 1) return;
        var sys = aiHistory[0];
        var rest = aiHistory.slice(1);
        if (rest.length > AI_MAX_MESSAGES) rest = rest.slice(rest.length - AI_MAX_MESSAGES);
        var hiddenIdx = [];
        rest.forEach(function (m, i) { if (m && m.hidden) hiddenIdx.push(i); });
        if (hiddenIdx.length > AI_MAX_HIDDEN) {
          var drop = hiddenIdx.slice(0, hiddenIdx.length - AI_MAX_HIDDEN);
          rest = rest.filter(function (_m, i) { return drop.indexOf(i) === -1; });
        }
        aiHistory = [sys].concat(rest);
      }

      function saveAIHistory() {
        pruneAIHistory();
        try { localStorage.setItem(AI_HISTORY_KEY, JSON.stringify(aiHistory)); } catch (e) {}
      }

      // 发送给模型前清洗历史：<think>/<tool_call>/<ops> 只是前端渲染用的语义标签，
      // 不应回传给模型。否则模型会把它们当成自己的历史正文（尤其 <tool_call>），
      // 干扰它后续是否/如何真正发起工具调用的判断。
      function toApiMessages(history) {
        var lim = historyLimit();
        var sys = history[0] && history[0].role === 'system' ? history[0] : null;
        var sliceSrc = sys ? history.slice(1) : history.slice(0);
        var filtered = [];
        for (var fi = 0; fi < sliceSrc.length; fi++) {
          var fm = sliceSrc[fi];
          if (!fm || typeof fm !== 'object' || fm.role === 'tool' || fm.tool_calls) continue;
          filtered.push(fm);
        }
        if (filtered.length > lim) {
          filtered = filtered.slice(filtered.length - lim);
          while (filtered.length && filtered[0] && filtered[0].hidden) filtered.shift();
        }
        var windowed = sys ? [sys].concat(filtered) : filtered;
        var out = [];
        for (var i = 0; i < windowed.length; i++) {
          var m = windowed[i];
          if (!m || typeof m !== 'object') continue;
          if (m.role === 'tool') continue;
          var copy = {};
          for (var k in m) {
            if (Object.prototype.hasOwnProperty.call(m, k) && k !== 'tool_calls' && k !== 'reasoning_content' && k !== 'hidden' && k !== 'snapshotId' && k !== 'searchQuery') copy[k] = m[k];
          }
          if (m.role === 'assistant' && typeof copy.content === 'string') {
            copy.content = copy.content
              .replace(/<think>[\s\S]*?<\/think>/gi, '')
              .replace(/<web_search>[\s\S]*?<\/web_search>/gi, '')
              .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
              .replace(/<ops>[\s\S]*?<\/ops>/gi, '')
              .trim();
          }
          if (m.tool_calls && (copy.content === null || copy.content === undefined || copy.content === '')) continue;
          out.push(copy);
        }
        var prefix = buildContextPrefix();
        if (prefix) {
          for (var n = out.length - 1; n >= 0; n--) {
            if (out[n].role !== 'user' || typeof out[n].content !== 'string') continue;
            if (out[n].content.indexOf(prefix) !== 0) out[n].content = prefix + '\n\n' + out[n].content;
            break;
          }
        }
        return out;
      }

      // 追加一条系统/错误提示气泡（sendAI 未配置时使用；此前调用处引用了未定义函数）
      function addAIMessage(text, kind) {
        var div = document.createElement('div');
        div.className = 'ai-msg ai-msg-' + (kind === 'error' ? 'error' : 'system');
        div.style.whiteSpace = 'normal';
        div.innerHTML = renderMarkdown(text);
        aiMessages.appendChild(div);
        aiMessages.scrollTop = aiMessages.scrollHeight;
      }

      // 面板内轻提示：操作成功等反馈用 Toast，不打断对话流
      var aiToastTimer = null;
      function showAIToast(msg) {
        if (!aiToastEl) return;
        aiToastEl.textContent = msg;
        aiToastEl.classList.add('show');
        if (aiToastTimer) clearTimeout(aiToastTimer);
        aiToastTimer = setTimeout(function () { aiToastEl.classList.remove('show'); }, 2200);
      }

      // 头部模型徽标：让当前使用的模型在标题上可见（任务上下文指示）
      function updateModelBadge() {
        if (!aiModelBadge) return;
        var m = aiModel.value.trim();
        aiModelBadge.textContent = m;
        aiModelBadge.style.display = m ? '' : 'none';
        aiModelBadge.title = m ? ('当前模型：' + m) : '';
      }

      function setIf(id, value) {
        var el = document.getElementById(id);
        if (el && value != null) el.value = value;
      }
      function blankProfile(name) {
        return { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name || '新配置', endpoint: '', key: '', model: '' };
      }
      function readProfileFromForm(p) {
        if (!p) return;
        var nameEl = document.getElementById('aiProfileName');
        if (nameEl) p.name = nameEl.value.trim() || p.name || '未命名';
        p.endpoint = aiEndpoint.value.trim();
        p.key = aiKey.value.trim();
        p.model = aiModel.value.trim();
      }
      function writeProfileToForm(p) {
        setIf('aiProfileName', p.name || '');
        aiEndpoint.value = p.endpoint || '';
        aiKey.value = p.key || '';
        aiModel.value = p.model || '';
        updateModelBadge();
      }
      function renderProfileSelect() {
        var sel = document.getElementById('aiProfileSelect');
        if (!sel) return;
        sel.innerHTML = '';
        aiProfiles.forEach(function (p) {
          var opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.name || '未命名';
          if (activeProfile && p.id === activeProfile.id) opt.selected = true;
          sel.appendChild(opt);
        });
        if (typeof syncCustomSelect === 'function') syncCustomSelect(sel);
      }

      var AI_VENDORS = {
        deepseek:   { label: 'DeepSeek',   endpoint: 'https://api.deepseek.com',                          models: ['deepseek-flash', 'deepseek-chat', 'deepseek-reasoner'] },
        openai:     { label: 'OpenAI',     endpoint: 'https://api.openai.com',                            models: ['gpt-4.1', 'gpt-4.1-mini', 'o4-mini'] },
        zhipu:      { label: '智谱',       endpoint: 'https://open.bigmodel.cn/api/paas/v4',              models: ['glm-4.5', 'glm-4.5-air', 'glm-z1-flash'] },
        kimi:       { label: 'Kimi',       endpoint: 'https://api.moonshot.ai',                           models: ['kimi-k2', 'moonshot-v1-32k'] },
        bailian:    { label: '百炼',       endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen3-max', 'qwen-plus', 'qwen-turbo'] },
        doubao:     { label: '豆包',       endpoint: 'https://ark.cn-beijing.volces.com/api/v3',          models: ['doubao-1.5-pro', 'doubao-1.5-lite'] },
        openrouter: { label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1',                      models: ['anthropic/claude-sonnet-4', 'google/gemini-2.5-flash'] },
        ollama:     { label: 'Ollama',     endpoint: 'http://localhost:11434',                            models: ['qwen3:8b', 'llama3.2', 'deepseek-r1:8b'] },
        custom:     { label: '自定义',     endpoint: '',                                                  models: [] }
      };
      var fetchedModelsCache = {};
      var SEARCH_META_TAGS = {
        bocha:    { label: '博查搜索',   tags: ['Bearer 鉴权', '支持时间过滤', '支持摘要', '按次计费'] },
        deepseek: { label: 'DeepSeek',   tags: ['Bearer 鉴权', '复用模型密钥可留空', '空结果不计费'] },
        zhipu:    { label: '智谱搜索',   tags: ['Bearer 鉴权', '4 档引擎可选', '支持时间过滤'] },
        kimi:     { label: 'Kimi',       tags: ['Bearer 鉴权', 'Basic / Pro 分档', 'Pro 支持时间窗口'] },
        bailian:  { label: '百炼搜索',   tags: ['Bearer 鉴权', 'HTTP Streamable MCP', '免费月额度'] },
        doubao:   { label: '豆包搜索',   tags: ['Bearer 鉴权', '每月 500 次免费', '无时间范围参数'] },
        qianfan:  { label: '百度千帆',   tags: ['Bearer 鉴权', '每月 1500 次免费', '周/月过滤'] },
        you:      { label: 'You.com',    tags: ['X-API-Key 鉴权', '支持时间过滤', '5 美元/千次'] },
        tencent:  { label: '腾讯元宝',   tags: ['Bearer 鉴权', 'MCP SearchPro', '支持 d/m 时间'] },
        tavily:   { label: 'Tavily',     tags: ['api_key 体参数', '支持时间过滤', '按账户额度'] },
        custom:   { label: '自定义接口', tags: ['可选 Bearer', '兼容常见返回字段'] }
      };

      var aiSavedTimer = null;
      function flashSaved(msg) {
        var el = document.getElementById('aiSavedHint');
        if (!el) return;
        el.textContent = msg || '已保存';
        el.classList.add('show');
        clearTimeout(aiSavedTimer);
        aiSavedTimer = setTimeout(function () { el.classList.remove('show'); }, 1400);
      }
      function detectVendorFromEndpoint(ep) {
        var raw = String(ep || '').toLowerCase();
        if (!raw) return 'custom';
        if (raw.indexOf('deepseek.com') !== -1) return 'deepseek';
        if (raw.indexOf('openai.com') !== -1) return 'openai';
        if (raw.indexOf('bigmodel.cn') !== -1 || raw.indexOf('zhipu') !== -1) return 'zhipu';
        if (raw.indexOf('moonshot.') !== -1) return 'kimi';
        if (raw.indexOf('dashscope.aliyuncs.com') !== -1) return 'bailian';
        if (raw.indexOf('volces.com') !== -1) return 'doubao';
        if (raw.indexOf('openrouter.ai') !== -1) return 'openrouter';
        if (raw.indexOf('localhost:11434') !== -1 || raw.indexOf('127.0.0.1:11434') !== -1) return 'ollama';
        return 'custom';
      }
      function resolvedEndpointHint() {
        var el = document.getElementById('aiResolvedEndpoint');
        if (!el) return;
        el.textContent = buildChatUrl(aiEndpoint ? aiEndpoint.value : '') || '（未填写）';
      }
      function renderVendorAndModelChips() {
        var vendor = detectVendorFromEndpoint(aiEndpoint ? aiEndpoint.value : '');
        var chipWrap = document.getElementById('aiProviderChips');
        if (chipWrap) {
          chipWrap.querySelectorAll('.ai-chip').forEach(function (c) {
            c.classList.toggle('active', c.getAttribute('data-vendor') === vendor);
          });
        }
        var modelWrap = document.getElementById('aiModelChips');
        if (!modelWrap) return;
        var mUrl = buildModelsUrl(aiEndpoint ? aiEndpoint.value : '');
        var list = (mUrl && fetchedModelsCache[mUrl]) || (AI_VENDORS[vendor] && AI_VENDORS[vendor].models) || [];
        var curModel = aiModel ? aiModel.value.trim() : '';
        modelWrap.innerHTML = '';
        list.forEach(function (m) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ai-chip' + (curModel === m ? ' active' : '');
          btn.textContent = m;
          btn.addEventListener('click', function () {
            if (aiModel) aiModel.value = m;
            saveAIConfig();
          });
          modelWrap.appendChild(btn);
        });
      }
      function syncSidebarStatus() {
        var ep = aiEndpoint ? aiEndpoint.value.trim() : '';
        var mdl = aiModel ? aiModel.value.trim() : '';
        var vendor = detectVendorFromEndpoint(ep);
        var vLabel = (AI_VENDORS[vendor] && AI_VENDORS[vendor].label) || '模型';
        var mText = document.getElementById('aiSideModelText');
        var mDot = document.getElementById('aiSideModelDot');
        if (mText) mText.textContent = (ep || mdl) ? (vLabel + ' · ' + (mdl || '未填模型')) : '未配置模型';
        if (mDot) mDot.classList.toggle('muted', !(ep && mdl));
        var p = searchProvider();
        var sMeta = SEARCH_META_TAGS[p] || SEARCH_META_TAGS.bocha;
        var sText = document.getElementById('aiSideSearchText');
        var sDot = document.getElementById('aiSideSearchDot');
        var ready = providerReady();
        if (sText) sText.textContent = sMeta.label + (ready ? ' 已配置' : ' 未填密钥');
        if (sDot) sDot.classList.toggle('muted', !ready);
      }
      function syncThinkUI() {
        var cardsWrap = document.getElementById('aiThinkCards');
        if (!cardsWrap) return;
        var gear = (aiDeepSearch && aiDeepSearch.checked) ? (fieldValue('aiThinkingGear') || 'high') : 'off';
        if (gear !== 'off' && gear !== 'low' && gear !== 'medium' && gear !== 'high') gear = 'high';
        cardsWrap.querySelectorAll('.ai-choice-card').forEach(function (c) {
          c.classList.toggle('active', c.getAttribute('data-gear') === gear);
        });
      }
      function syncSegmentedUI() {
        var kimiTier = fieldValue('aiKimiTier') || 'pro';
        document.querySelectorAll('#aiKimiTierSeg .ai-seg-btn').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-kimi-tier') === kimiTier);
        });
        var fresh = searchFreshness();
        document.querySelectorAll('#aiSearchFreshnessSeg .ai-seg-btn').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-freshness') === fresh);
        });
        var rounds = String(maxSearchRounds());
        document.querySelectorAll('#aiMaxSearchRoundsSeg .ai-seg-btn').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-rounds') === rounds);
        });
        var scVal = document.getElementById('aiSearchCountVal');
        if (scVal) scVal.textContent = searchCount() + ' 条';
        var mtVal = fieldValue('aiMaxTokens');
        document.querySelectorAll('#aiMaxTokensSeg .ai-seg-btn').forEach(function (b) {
          b.classList.toggle('active', (b.getAttribute('data-tokens') || '') === mtVal);
        });
      }
      function syncParamsUI() {
        var sendTemp = isChecked('aiSendTemperature', true);
        var tempEl = document.getElementById('aiTemperature');
        var tNum = tempEl && tempEl.value !== '' ? parseFloat(tempEl.value) : 0.1;
        if (isNaN(tNum)) tNum = 0.1;
        var tempValEl = document.getElementById('aiTempVal');
        if (tempValEl) tempValEl.textContent = Number(tNum).toFixed(1);
        var tempGroup = document.getElementById('aiTempGroup');
        if (tempGroup) tempGroup.classList.toggle('disabled', !sendTemp);
        document.querySelectorAll('#aiTempChips .ai-chip').forEach(function (c) {
          c.classList.toggle('active', Number(c.getAttribute('data-temp')) === Number(tNum));
        });
        var sendP = isSendTopP();
        var topP = topPValue();
        var topPVal = document.getElementById('aiTopPVal');
        var topPRow = document.getElementById('aiTopPSliderRow');
        if (topPVal) {
          topPVal.textContent = Number(topP).toFixed(2).replace(/0$/, '');
          topPVal.style.display = sendP ? 'inline-flex' : 'none';
        }
        if (topPRow) topPRow.style.display = sendP ? 'flex' : 'none';
        var hlVal = document.getElementById('aiHistoryLimitVal');
        if (hlVal) hlVal.textContent = historyLimit() + ' 条';
        var errBox = document.getElementById('aiCustomJsonError');
        if (errBox) {
          var hRes = parseJsonObjectField('aiCustomHeaders');
          var bRes = parseJsonObjectField('aiExtraBody');
          var errs = [];
          if (!hRes.ok) errs.push('自定义请求头：' + hRes.error);
          if (!bRes.ok) errs.push('额外请求体：' + bRes.error);
          errBox.textContent = errs.join('；');
        }
      }
      var activePromptLayer = 'system';
      var promptPreviewOpen = false;
      function syncPromptUI() {
        document.querySelectorAll('#aiPromptLayerSeg [data-prompt-layer]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-prompt-layer') === activePromptLayer);
        });
        var sysCtrl = document.getElementById('aiSystemPresetCtrl');
        var ctxCtrl = document.getElementById('aiContextPresetCtrl');
        if (sysCtrl) sysCtrl.hidden = activePromptLayer !== 'system';
        if (ctxCtrl) ctxCtrl.hidden = activePromptLayer !== 'context';
        var desc = document.getElementById('aiPromptLayerDesc');
        if (desc) {
          desc.textContent = activePromptLayer === 'context'
            ? '每次发送前附加在当前用户消息前面，卡片或搜索状态变更后自动更新'
            : '基础人设与能力边界，整段对话共享，不随卡片变动';
        }
        var sysBox = document.getElementById('aiSystemPrompt');
        var ctxBox = document.getElementById('aiContextPrompt');
        var previewBox = document.getElementById('aiPromptPreviewBox');
        var activeBox = activePromptLayer === 'context' ? ctxBox : sysBox;
        if (sysBox) sysBox.hidden = promptPreviewOpen || activePromptLayer !== 'system';
        if (ctxBox) ctxBox.hidden = promptPreviewOpen || activePromptLayer !== 'context';
        if (previewBox) {
          previewBox.classList.toggle('open', promptPreviewOpen);
          if (promptPreviewOpen && activeBox) {
            previewBox.textContent = fillPrompt(activeBox.value) || '（内容为空）';
          }
        }
        var counter = document.getElementById('aiPromptCounter');
        if (counter && activeBox) {
          var len = String(activeBox.value || '').length;
          counter.textContent = len + ' 字 · 约 ' + Math.ceil(len * 0.65) + ' tokens';
        }
        var activeList = activePromptLayer === 'context' ? contextPresetList : systemPresetList;
        var activeId = activePromptLayer === 'context' ? activeContextPresetId : activeSystemPresetId;
        var curPreset = presetById(activeList, activeId);
        var builtins = activePromptLayer === 'context' ? builtinContextPresets() : builtinSystemPresets();
        var defPreset = curPreset && builtins.filter(function (b) { return b.id === curPreset.id; })[0];
        var isModifiedBuiltin = !!(curPreset && curPreset.builtin && defPreset && String(curPreset.text || '') !== String(defPreset.text || ''));
        var rstBtn = document.getElementById('aiPromptResetBtn');
        if (rstBtn) rstBtn.hidden = !isModifiedBuiltin;
        var previewBtn = document.getElementById('aiTogglePromptPreviewBtn');
        if (previewBtn) previewBtn.textContent = promptPreviewOpen ? '返回编辑' : '预览展开效果';
      }

      function searchCatalog() {
        return {
          deepseek: {
            auth: 'Authorization: Bearer，与 DeepSeek 对话用的是同一把密钥。搜索密钥留空时，用模型页里的密钥。',
            bill: 'Search API 成功且 results 非空才计费，1000 次 0.75 美元。空结果、失败、超时不计。条数不影响单价。',
            time: '没有单独的时间参数。选择时间范围时，会在查询词后加上官方支持的 after:YYYY-MM-DD。',
            shape: 'POST https://api.deepseek.com/v1/tools/search，读 results[] 的 title、url、snippet、summary。同一密钥还能调 /v1/tools/fetch 抓单页，本页搜索只用 Search。'
          },
          zhipu: {
            auth: 'Authorization: Bearer，密钥在 open.bigmodel.cn 创建。',
            bill: '按次。search_std 0.01 元，search_pro 0.03 元，search_pro_sogou 与 search_pro_quark 各 0.05 元。',
            time: 'search_recency_filter：oneDay / oneWeek / oneMonth / oneYear / noLimit。本页的一天、一周、一月对应前三个。',
            shape: 'POST https://open.bigmodel.cn/api/paas/v4/web_search。查询字段是 search_query（最长 70 字）。返回 search_result[] 的 title、link、content，不是 results。'
          },
          kimi: {
            auth: 'Authorization: Bearer。官方地址是 api.moonshot.ai。',
            bill: '成功且 search_results 非空才计费。基础版 POST /v1/tools/search 为 0.002 美元/次；Pro 为 POST /v1/tools/search_pro，0.003 美元/次。失败或空结果不计。',
            time: '只有 Pro 接受 time_window（start、end，YYYY-MM-DD）。基础版没有时间参数，选了时间范围也不会传。',
            shape: '返回 search_results[] 的 title、url、snippet。Pro 另有按相关度排好的 chunks。'
          },
          bailian: {
            auth: 'Authorization: Bearer，用百炼 API Key（sk- 开头）。Token Plan 专属的 sk-sp- 密钥不能调用这个 MCP。',
            bill: '这是 Token Plan 的 Harness 工具「联网搜索增强版」。Standard 每月 100 次、Pro 每月 500 次免费，超出部分按目录价 88 折。帮助页没有写明目录单价，以控制台「查看明细」为准。广场上另一个「联网搜索 MCP」是 2000 次免费后 29 元/千次，不是这一项。',
            time: '先读取工具自己的参数说明，只有里面真有时间字段才传。',
            shape: 'POST https://dashscope.aliyuncs.com/api/v1/mcps/EnhancedSearch/mcp，HTTP Streamable MCP。优先调用名为 search_pro 的工具，再从返回文本里取标题和链接。'
          },
          doubao: {
            auth: 'Authorization: Bearer。密钥在火山引擎联网搜索控制台按量后付费里创建，和订阅套餐的密钥不通用。',
            bill: 'Global 版文搜按量 0.020 元/次，按日结算。每个火山账号每月 500 次免费额度，与 Custom 版共用。',
            time: 'Global 版文搜的 Filter 只有 IcpHostOnly，没有时间范围参数。上面的时间范围对它无效。',
            shape: 'POST https://open.feedcoopapi.com/search_api/global_search，正文是 Query、SearchType=web、DocCount。结果在 Result.Documents[] 的 Title、Url、Snippet[].Text。'
          },
          qianfan: {
            auth: 'Authorization: Bearer，用千帆 API Key。',
            bill: '本页固定请求标准版（edition=standard）。每月 1500 次免费，按天发放，优先抵扣；国内内容标准版超出后 0.036 元/次。增强版、旗舰版价格不同，这里不调用。',
            time: 'search_recency_filter 只有 week / month / semiyear / year。没有「一天」，选一天时按最近 7 天（week）查询。',
            shape: 'POST https://qianfan.baidubce.com/v2/ai_search/web_search。查询放在 messages 最后一条 content 里，最长约 72 个字符宽度（一个汉字算两个）。返回 references[] 的 title、url、snippet。'
          },
          bocha: {
            auth: 'Authorization: Bearer。密钥在 open.bochaai.com 创建。',
            bill: '按次计费。官网「产品价格」在飞书文档里，这次核对时页面要登录，没有写死单价。',
            time: 'freshness：noLimit、oneDay、oneWeek、oneMonth、oneYear。官网示例使用 oneYear；一天 / 一周 / 一月对应该字段的 oneDay / oneWeek / oneMonth。',
            shape: 'POST https://api.bochaai.com/v1/web-search，字段 query、freshness、summary、count。结果在 data.webPages.value[] 的 name、url、snippet 或 summary。'
          },
          you: {
            auth: '请求头是 X-API-Key，不是 Authorization。',
            bill: 'Web Search 标准接口 5 美元 / 1000 次。一次请求不论返回多少条都算一次。新账号有免费额度，以 you.com/pricing 为准。',
            time: 'freshness：day、week、month、year，或 YYYY-MM-DDtoYYYY-MM-DD。本页的一天 / 一周 / 一月对应前三个。',
            shape: 'POST https://ydc-index.io/v1/search，字段 query、count、freshness。结果读 results 或 results.web 里的 title、url、snippets。'
          },
          tencent: {
            auth: 'Authorization: Bearer，用元宝搜索（WSA）的 API Key。',
            bill: '按开通的版本按次计费。官方 MCP 页不写单价，免费额度以控制台活动专区为准。这次没能打开 cloud.tencent.com 计费页，所以不写死每千次价格。',
            time: 'SearchPro 的 Freshness：d1–d30、m1–m12、y1–y5。一天传 d1，一周传 d7，一月传 m1。',
            shape: 'POST https://api.wsa.cloud.tencent.com/Mcp，MCP 工具 SearchPro。入参 Query、Freshness、Cnt（只允许 10/20/30/40/50，不足 10 条会请求 10 条再截取）。网页结果在 Pages 里，每条是含 title、url、passage 的 JSON 字符串。'
          },
          tavily: {
            auth: '密钥放在 JSON 的 api_key 字段，不走 Authorization 头。',
            bill: '按 Tavily 账户额度计费。这次打开的接口文档没有单列单价，以 tavily.com 账户为准。',
            time: 'time_range：day、week、month，与本页三个范围一致。',
            shape: 'POST https://api.tavily.com/search。返回 results[] 的 title、url、content。'
          },
          custom: {
            auth: '可选 Authorization: Bearer。',
            bill: '费用由你填写的接口决定。',
            time: '请求体带 freshness：noLimit、day、week、month。对端是否识别取决于该接口。',
            shape: 'POST 到填写的地址，字段 query、count、freshness。能识别 data.webPages.value、results 或 data 数组。'
          }
        };
      }
      function commitSearchKeyFromDom() {
        var activeId = document.activeElement && document.activeElement.id;
        if (activeId === 'aiBochaKey' && aiBochaKey) {
          searchKeyBag.bocha = aiBochaKey.value.trim();
          if (shownProvider === 'bocha') setIf('aiSearchKey', searchKeyBag.bocha);
        } else if (activeId === 'aiTavilyKey') {
          searchKeyBag.tavily = fieldValue('aiTavilyKey');
          if (shownProvider === 'tavily') setIf('aiSearchKey', searchKeyBag.tavily);
        } else if (activeId === 'aiCustomKey') {
          searchKeyBag.custom = fieldValue('aiCustomKey');
          if (shownProvider === 'custom') setIf('aiSearchKey', searchKeyBag.custom);
        } else if (activeId === 'aiSearchKey') {
          searchKeyBag[shownProvider] = fieldValue('aiSearchKey');
        } else if (fieldValue('aiSearchKey')) {
          searchKeyBag[shownProvider] = fieldValue('aiSearchKey');
        }
        if (activeId !== 'aiSearchKey' && aiBochaKey && aiBochaKey.value.trim() && !searchKeyBag.bocha) {
          searchKeyBag.bocha = aiBochaKey.value.trim();
        }
        if (activeId !== 'aiSearchKey' && fieldValue('aiTavilyKey') && !searchKeyBag.tavily) {
          searchKeyBag.tavily = fieldValue('aiTavilyKey');
        }
        if (shownProvider === 'bocha' && aiBochaKey && activeId !== 'aiBochaKey') aiBochaKey.value = searchKeyBag.bocha || '';
        if (shownProvider === 'tavily' && activeId !== 'aiTavilyKey') setIf('aiTavilyKey', searchKeyBag.tavily || '');
        if (shownProvider === 'custom' && activeId !== 'aiCustomKey') setIf('aiCustomKey', searchKeyBag.custom || '');
      }
      function renderSearchMeta() {
        var p = searchProvider();
        var box = document.getElementById('aiSearchMeta');
        var info = searchCatalog()[p] || searchCatalog().bocha;
        if (box && info) {
          box.innerHTML = '<b>鉴权</b> ' + info.auth
            + '<br><b>计费</b> ' + info.bill
            + '<br><b>时间过滤</b> ' + info.time
            + '<br><b>返回</b> ' + info.shape;
        }
        var tagsBox = document.getElementById('aiSearchMetaTags');
        var tagMeta = SEARCH_META_TAGS[p] || SEARCH_META_TAGS.bocha;
        if (tagsBox && tagMeta) {
          tagsBox.innerHTML = tagMeta.tags.map(function (t) {
            return '<span class="ai-meta-tag">' + t + '</span>';
          }).join('');
        }
      }
      function syncProviderFields() {
        var p = searchProvider();
        var show = function (id, on) {
          var el = document.getElementById(id);
          if (el) el.style.display = on ? '' : 'none';
        };
        show('bochaKeyField', false);
        show('tavilyKeyField', false);
        show('aiSearchKeyField', p !== 'custom');
        show('zhipuEngineField', p === 'zhipu');
        show('kimiTierField', p === 'kimi');
        show('customUrlField', p === 'custom');
        show('customKeyField', p === 'custom');
        var keyLabel = document.getElementById('aiSearchKeyLabel');
        if (keyLabel) {
          keyLabel.textContent = p === 'you' ? 'You.com API Key（X-API-Key）' : '搜索密钥';
        }
        renderSearchMeta();
      }
      function syncProfileRow() {
        var row = document.getElementById('aiProfileRow');
        if (row) row.style.display = '';
        var hasMulti = aiProfiles.length > 1;
        var del = document.getElementById('aiProfileDel');
        var delSep = document.getElementById('aiProfileDelSep');
        if (del) del.hidden = !hasMulti;
        if (delSep) delSep.hidden = !hasMulti;
      }

      // 搜索报错格式化与提供商适配器（对话与「测试搜索」共用）
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
      function escapeSearchHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      function fetchBocha(query) {
        return fetch('https://api.bochaai.com/v1/web-search', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + currentSearchKey(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            query: query,
            freshness: (function () {
              var f = searchFreshness();
              if (f === 'day') return 'oneDay';
              if (f === 'week') return 'oneWeek';
              if (f === 'month') return 'oneMonth';
              return 'noLimit';
            })(),
            summary: !(document.getElementById('aiSearchSummary') && document.getElementById('aiSearchSummary').checked === false),
            count: searchCount()
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
              var items = webPages.value.slice(0, searchCount());
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
      function searchItemsToContext(items) {
        var searchContext = '';
        var list = (items || []).slice(0, searchCount()).map(normalizeSearchItem);
        for (var i = 0; i < list.length; i++) {
          var p = list[i];
          searchContext += '【' + (i + 1) + '】' + p.title + '\n';
          searchContext += '链接：' + p.url + '\n';
          searchContext += p.snippet + '\n\n';
        }
        return { searchContext: searchContext, resultCount: list.length, failed: false };
      }
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
          return searchItemsToContext(pickItems(data));
        }).catch(function (sErr) {
          return { searchContext: '', resultCount: 0, failed: true, error: sErr };
        });
      }
      function fetchTavily(query) {
        var fresh = searchFreshness();
        var body = {
          api_key: currentSearchKey(),
          query: query,
          max_results: searchCount(),
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
        var customKey = currentSearchKey();
        if (customKey) headers.Authorization = 'Bearer ' + customKey;
        return fetchSearchPost(fieldValue('aiCustomUrl'), headers, {
          query: query,
          count: searchCount(),
          freshness: searchFreshness()
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
        var fresh = searchFreshness();
        var q = clipText(query, fresh === 'noLimit' ? 128 : 110);
        if (fresh === 'day') q += ' after:' + isoDaysAgo(1);
        else if (fresh === 'week') q += ' after:' + isoDaysAgo(7);
        else if (fresh === 'month') q += ' after:' + isoDaysAgo(30);
        return fetchSearchPost('https://api.deepseek.com/v1/tools/search', {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + currentSearchKey()
        }, { query: q, count: searchCount(), need_content: false }, function (data) {
          return (data && data.results) || [];
        });
      }
      function fetchZhipu(query) {
        var engine = fieldValue('aiZhipuEngine') || 'search_pro';
        var fresh = searchFreshness();
        var body = {
          search_query: clipText(query, 70),
          search_engine: engine,
          search_intent: false,
          search_recency_filter: fresh === 'day' ? 'oneDay' : fresh === 'week' ? 'oneWeek' : fresh === 'month' ? 'oneMonth' : 'noLimit'
        };
        if (engine !== 'search_pro_quark') body.count = searchCount();
        return fetchSearchPost('https://open.bigmodel.cn/api/paas/v4/web_search', {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + currentSearchKey()
        }, body, function (data) {
          return (data && (data.search_result || data.search_results)) || [];
        });
      }
      function fetchKimi(query) {
        var tier = fieldValue('aiKimiTier') || 'pro';
        var fresh = searchFreshness();
        var path = tier === 'basic' ? '/v1/tools/search' : '/v1/tools/search_pro';
        var body = { text_query: query, limit: searchCount() };
        if (tier === 'basic') {
          var sum = document.getElementById('aiSearchSummary');
          body.include_content = !(sum && sum.checked === false);
        } else if (fresh === 'day' || fresh === 'week' || fresh === 'month') {
          var days = fresh === 'day' ? 1 : fresh === 'week' ? 7 : 30;
          body.time_window = { start: isoDaysAgo(days), end: isoDaysAgo(0) };
        }
        return fetchSearchPost('https://api.moonshot.ai' + path, {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + currentSearchKey()
        }, body, function (data) {
          return (data && data.search_results) || [];
        });
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
      function fetchQianfan(query) {
        var fresh = searchFreshness();
        var body = {
          messages: [{ role: 'user', content: qianfanQuery(query) }],
          search_source: 'baidu_search_v2',
          edition: 'standard',
          resource_type_filter: [{ type: 'web', top_k: searchCount() }]
        };
        if (fresh === 'day' || fresh === 'week') body.search_recency_filter = 'week';
        else if (fresh === 'month') body.search_recency_filter = 'month';
        return fetchSearchPost('https://qianfan.baidubce.com/v2/ai_search/web_search', {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + currentSearchKey()
        }, body, function (data) {
          return (data && data.references) || [];
        });
      }
      function fetchDoubao(query) {
        return fetchSearchPost('https://open.feedcoopapi.com/search_api/global_search', {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + currentSearchKey()
        }, {
          SearchType: 'web',
          Query: clipText(query, 100),
          DocCount: searchCount(),
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
        var body = { query: query, count: searchCount() };
        var fresh = searchFreshness();
        if (fresh === 'day' || fresh === 'week' || fresh === 'month') body.freshness = fresh;
        return fetchSearchPost('https://ydc-index.io/v1/search', {
          'Content-Type': 'application/json',
          'X-API-Key': currentSearchKey()
        }, body, function (data) {
          if (data && data.results && Array.isArray(data.results.web)) return data.results.web;
          if (data && Array.isArray(data.results)) return data.results;
          return [];
        });
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
      function mcpRequest(url, session, body) {
        var headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': 'Bearer ' + currentSearchKey()
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
      function fillMcpArgs(tool, query, fallbackArgs) {
        var schema = (tool && (tool.inputSchema || tool.input_schema)) || {};
        var props = schema.properties || {};
        var names = Object.keys(props);
        if (!names.length) return fallbackArgs ? fallbackArgs() : { query: query };
        var args = {};
        var qKey = mcpProp(props, ['query', 'Query', 'text_query', 'search_query', 'q']);
        args[qKey || names[0]] = qKey === 'Query' ? clipText(query, 500) : query;
        var countKey = mcpProp(props, ['count', 'Count', 'Cnt', 'limit', 'top_k']);
        if (countKey) args[countKey] = countKey === 'Cnt' ? 10 : searchCount();
        var timeKey = mcpProp(props, ['Freshness', 'freshness', 'search_recency_filter', 'time_range']);
        var fresh = searchFreshness();
        if (timeKey && fresh !== 'noLimit') {
          if (timeKey === 'Freshness') args[timeKey] = fresh === 'day' ? 'd1' : fresh === 'week' ? 'd7' : 'm1';
          else if (timeKey === 'search_recency_filter') args[timeKey] = fresh === 'day' ? 'oneDay' : fresh === 'week' ? 'oneWeek' : 'oneMonth';
          else args[timeKey] = fresh;
        }
        return args;
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
      function fetchMcpSearch(url, preferred, query, fallbackArgs) {
        return mcpRequest(url, '', {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'motuo-tab', version: '0.8.12' }
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
          return searchItemsToContext(items);
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
          var fresh = searchFreshness();
          if (fresh === 'day') args.Freshness = 'd1';
          else if (fresh === 'week') args.Freshness = 'd7';
          else if (fresh === 'month') args.Freshness = 'm1';
          return args;
        });
      }
      function fetchWebSearch(query) {
        var p = searchProvider();
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

      function saveAIConfig(quiet) {
        updateModelBadge();
        commitPromptLayers();
        commitSearchKeyFromDom();
        if (!aiProfiles.length) aiProfiles = [blankProfile('通用配置')];
        if (!activeProfile) activeProfile = aiProfiles[0];
        readProfileFromForm(activeProfile);
        var gear = thinkingGear() === 'off'
          ? (fieldValue('aiThinkingGear') || 'high')
          : thinkingGear();
        if (gear !== 'low' && gear !== 'medium' && gear !== 'high') gear = 'high';
        var data = {
          profiles: aiProfiles,
          activeProfileId: activeProfile.id,
          thinkingGear: gear,
          temperature: fieldValue('aiTemperature') || '0.1',
          maxTokens: fieldValue('aiMaxTokens'),
          sendTemperature: isChecked('aiSendTemperature', true),
          sendTopP: isSendTopP(),
          topP: String(topPValue()),
          historyLimit: historyLimit(),
          timeoutSec: Math.round(timeoutMs() / 1000),
          stream: isStreamEnabled(),
          confirmBulkDelete: shouldConfirmBulkDelete(),
          customHeaders: fieldValue('aiCustomHeaders'),
          extraBody: fieldValue('aiExtraBody'),
          includeKeysInBackup: includeKeysInBackup(),
          webSearch: !!(aiWebSearch && aiWebSearch.checked),
          deepSearch: !!(aiDeepSearch && aiDeepSearch.checked),
          endpoint: aiEndpoint.value.trim(),
          key: aiKey.value.trim(),
          model: aiModel.value.trim(),
          bochaKey: searchKeyBag.bocha || (aiBochaKey ? aiBochaKey.value.trim() : ''),
          search: {
            provider: searchProvider(),
            count: searchCount(),
            summary: isChecked('aiSearchSummary', true),
            citeSources: shouldCiteSources(),
            maxRounds: maxSearchRounds(),
            freshness: searchFreshness(),
            bochaKey: searchKeyBag.bocha || (aiBochaKey ? aiBochaKey.value.trim() : ''),
            tavilyKey: searchKeyBag.tavily || fieldValue('aiTavilyKey'),
            customUrl: fieldValue('aiCustomUrl'),
            customKey: searchKeyBag.custom || fieldValue('aiCustomKey'),
            keys: searchKeyBag,
            zhipuEngine: fieldValue('aiZhipuEngine') || 'search_pro',
            kimiTier: fieldValue('aiKimiTier') || 'pro'
          },
          systemPrompt: fieldValue('aiSystemPrompt'),
          contextPrompt: fieldValue('aiContextPrompt'),
          systemPresets: systemPresetList,
          activeSystemPresetId: activeSystemPresetId,
          contextPresets: contextPresetList,
          activeContextPresetId: activeContextPresetId
        };
        try { localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(data)); } catch (e) {}
        renderProfileSelect();
        syncProviderFields();
        syncProfileRow();
        resolvedEndpointHint();
        renderVendorAndModelChips();
        syncThinkUI();
        syncSegmentedUI();
        syncParamsUI();
        syncPromptUI();
        syncSidebarStatus();
        if (typeof syncAllCustomSelects === 'function') syncAllCustomSelects();
        if (!quiet) {
          var cfgModal = document.getElementById('aiConfigModal');
          if (cfgModal && cfgModal.classList.contains('open')) flashSaved();
        }
      }

      function applyAIConfigObject(cfg) {
        var migrated = false;
        systemPresetList = builtinSystemPresets();
        contextPresetList = builtinContextPresets();
        activeSystemPresetId = 'general';
        activeContextPresetId = 'full';
        searchKeyBag = {};
        shownProvider = 'bocha';

        if (cfg && Array.isArray(cfg.profiles) && cfg.profiles.length) {
          aiProfiles = cfg.profiles;
          activeProfile = aiProfiles.filter(function (p) { return p.id === cfg.activeProfileId; })[0] || aiProfiles[0];
          aiProfiles.forEach(function (p) {
            if (p && p.name === '默认') { p.name = '通用配置'; migrated = true; }
          });
        } else {
          var p0 = blankProfile('通用配置');
          if (cfg) {
            p0.endpoint = cfg.endpoint || '';
            p0.key = cfg.key || '';
            p0.model = cfg.model || '';
          }
          aiProfiles = [p0];
          activeProfile = p0;
        }
        writeProfileToForm(activeProfile);
        renderProfileSelect();

        // 重置默认可控参数，再叠加传入配置
        if (aiWebSearch) aiWebSearch.checked = !!(cfg && cfg.webSearch);
        if (aiDeepSearch) aiDeepSearch.checked = !!(cfg && cfg.deepSearch);
        if (aiBochaKey) aiBochaKey.value = '';
        setIf('aiThinkingGear', (cfg && cfg.thinkingGear) || 'high');
        setIf('aiTemperature', (cfg && cfg.temperature != null && cfg.temperature !== '') ? cfg.temperature : '0.1');
        setIf('aiMaxTokens', (cfg && cfg.maxTokens != null) ? cfg.maxTokens : '');
        var sendT = document.getElementById('aiSendTemperature');
        if (sendT) sendT.checked = !(cfg && cfg.sendTemperature === false);
        var sendP = document.getElementById('aiSendTopP');
        if (sendP) sendP.checked = !!(cfg && cfg.sendTopP);
        setIf('aiTopP', (cfg && cfg.topP != null && cfg.topP !== '') ? cfg.topP : '0.9');
        setIf('aiHistoryLimit', (cfg && cfg.historyLimit != null) ? cfg.historyLimit : 20);
        setIf('aiTimeoutSec', (cfg && cfg.timeoutSec != null) ? String(cfg.timeoutSec) : '120');
        var stEl = document.getElementById('aiStreamEnabled');
        if (stEl) stEl.checked = !(cfg && cfg.stream === false);
        var cbEl = document.getElementById('aiConfirmBulkDelete');
        if (cbEl) cbEl.checked = !(cfg && cfg.confirmBulkDelete === false);
        setIf('aiCustomHeaders', (cfg && cfg.customHeaders) || '');
        setIf('aiExtraBody', (cfg && cfg.extraBody) || '');
        var bkEl = document.getElementById('aiBackupIncludeKeys');
        if (bkEl) bkEl.checked = !(cfg && cfg.includeKeysInBackup === false);

        var search = (cfg && cfg.search) || {};
        var bKey = (search && search.bochaKey) || (cfg && cfg.bochaKey) || '';
        if (bKey && aiBochaKey) aiBochaKey.value = bKey;
        searchKeyBag = (search.keys && typeof search.keys === 'object') ? Object.assign({}, search.keys) : {};
        if (!searchKeyBag.bocha && bKey) searchKeyBag.bocha = bKey;
        if (!searchKeyBag.tavily && search.tavilyKey) searchKeyBag.tavily = search.tavilyKey;
        if (!searchKeyBag.custom && search.customKey) searchKeyBag.custom = search.customKey;
        setIf('aiSearchProvider', search.provider || 'bocha');
        shownProvider = search.provider || 'bocha';
        setIf('aiSearchKey', searchKeyBag[shownProvider] || '');
        setIf('aiTavilyKey', search.tavilyKey || searchKeyBag.tavily || '');
        setIf('aiCustomUrl', search.customUrl || '');
        setIf('aiCustomKey', search.customKey || searchKeyBag.custom || '');
        setIf('aiZhipuEngine', search.zhipuEngine || 'search_pro');
        setIf('aiKimiTier', search.kimiTier || 'pro');
        setIf('aiSearchCount', search.count || 5);
        setIf('aiSearchFreshness', search.freshness || 'noLimit');
        setIf('aiMaxSearchRounds', String(search.maxRounds || 3));
        var sum = document.getElementById('aiSearchSummary');
        if (sum) sum.checked = !(search.summary === false);
        var cite = document.getElementById('aiCiteSources');
        if (cite) cite.checked = !(search.citeSources === false);

        if (cfg && Array.isArray(cfg.systemPresets) && cfg.systemPresets.length) {
          systemPresetList = mergePresets(cfg.systemPresets, builtinSystemPresets());
          activeSystemPresetId = cfg.activeSystemPresetId || 'general';
        }
        if (cfg && Array.isArray(cfg.contextPresets) && cfg.contextPresets.length) {
          contextPresetList = mergePresets(cfg.contextPresets, builtinContextPresets());
          activeContextPresetId = cfg.activeContextPresetId || 'full';
        }
        if (cfg && !cfg.systemPresets) {
          var classified = classifyStoredPrompt(cfg.systemPrompt);
          if (classified.custom) {
            var customId = 's' + Date.now().toString(36);
            systemPresetList.push({ id: customId, name: '已保存的提示词', text: classified.custom, builtin: false });
            activeSystemPresetId = customId;
            activeContextPresetId = classified.contextId;
            migrated = true;
          } else if (cfg.systemPrompt) {
            activeSystemPresetId = classified.systemId;
            activeContextPresetId = classified.contextId;
            migrated = true;
          }
        }
        if (!presetById(systemPresetList, activeSystemPresetId)) activeSystemPresetId = 'general';
        if (!presetById(contextPresetList, activeContextPresetId)) activeContextPresetId = 'full';
        renderLayer('system');
        renderLayer('context');
        updateModelBadge();
        syncProviderFields();
        syncProfileRow();
        resolvedEndpointHint();
        renderVendorAndModelChips();
        syncThinkUI();
        syncSegmentedUI();
        syncParamsUI();
        syncPromptUI();
        syncSidebarStatus();
        if (typeof syncAllCustomSelects === 'function') syncAllCustomSelects();
        return migrated;
      }

      (function loadAIConfig() {
        var cfg = null;
        try { cfg = JSON.parse(localStorage.getItem(AI_CONFIG_KEY) || 'null'); } catch (e) { cfg = null; }
        var migrated = applyAIConfigObject(cfg);
        if (migrated) saveAIConfig(true);
      })();

      ['aiEndpoint', 'aiKey', 'aiModel', 'aiCustomUrl', 'aiSearchKey', 'aiMaxTokens', 'aiSystemPrompt', 'aiContextPrompt', 'aiProfileName', 'aiCustomHeaders', 'aiExtraBody'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('change', function () { saveAIConfig(); });
      });
      if (aiBochaKey) {
        aiBochaKey.addEventListener('change', function () {
          searchKeyBag.bocha = aiBochaKey.value.trim();
          if (shownProvider === 'bocha') setIf('aiSearchKey', searchKeyBag.bocha);
          saveAIConfig();
        });
      }
      var aiTavilyKeyEl = document.getElementById('aiTavilyKey');
      if (aiTavilyKeyEl) {
        aiTavilyKeyEl.addEventListener('change', function () {
          searchKeyBag.tavily = aiTavilyKeyEl.value.trim();
          if (shownProvider === 'tavily') setIf('aiSearchKey', searchKeyBag.tavily);
          saveAIConfig();
        });
      }
      var aiCustomKeyEl = document.getElementById('aiCustomKey');
      if (aiCustomKeyEl) {
        aiCustomKeyEl.addEventListener('change', function () {
          searchKeyBag.custom = aiCustomKeyEl.value.trim();
          if (shownProvider === 'custom') setIf('aiSearchKey', searchKeyBag.custom);
          saveAIConfig();
        });
      }
      ['aiThinkingGear', 'aiSearchFreshness', 'aiZhipuEngine', 'aiKimiTier', 'aiTimeoutSec'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('change', function () { saveAIConfig(); });
      });
      var searchProviderSel = document.getElementById('aiSearchProvider');
      if (searchProviderSel) {
        searchProviderSel.addEventListener('change', function () {
          var next = searchProvider();
          if (next !== shownProvider) {
            searchKeyBag[shownProvider] = fieldValue('aiSearchKey');
            if (shownProvider === 'bocha' && aiBochaKey) aiBochaKey.value = searchKeyBag.bocha || '';
            if (shownProvider === 'tavily') setIf('aiTavilyKey', searchKeyBag.tavily || '');
            if (shownProvider === 'custom') setIf('aiCustomKey', searchKeyBag.custom || '');
            shownProvider = next;
            setIf('aiSearchKey', searchKeyBag[next] || '');
          }
          var probeEl = document.getElementById('aiSearchProbeStatus');
          if (probeEl) { probeEl.className = 'ai-probe-badge'; probeEl.textContent = '未测试'; }
          saveAIConfig();
        });
      }
      ['aiSendTemperature', 'aiSendTopP', 'aiSearchSummary', 'aiCiteSources', 'aiStreamEnabled', 'aiConfirmBulkDelete', 'aiBackupIncludeKeys'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('change', function () { saveAIConfig(); });
      });
      ['aiTemperature', 'aiTopP', 'aiSearchCount', 'aiHistoryLimit'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
          el.addEventListener('input', function () {
            syncSegmentedUI();
            syncParamsUI();
          });
          el.addEventListener('change', function () { saveAIConfig(); });
        }
      });
      // maxTokens input synced below
      var aiMaxTokensInput = document.getElementById('aiMaxTokens');
      if (aiMaxTokensInput) {
        aiMaxTokensInput.addEventListener('input', syncSegmentedUI);
      }
      var customHeadersBox = document.getElementById('aiCustomHeaders');
      var extraBodyBox = document.getElementById('aiExtraBody');
      if (customHeadersBox) customHeadersBox.addEventListener('input', syncParamsUI);
      if (extraBodyBox) extraBodyBox.addEventListener('input', syncParamsUI);

      aiWebSearch.addEventListener('change', function () {
        saveAIConfig(true);
        if (this.checked && !providerReady()) {
          showAIToast('联网搜索需要先在配置窗口里填写当前提供商的密钥');
        }
      });
      aiDeepSearch.addEventListener('change', function () { saveAIConfig(true); });

      // 快速厂商预设芯片
      var providerChips = document.getElementById('aiProviderChips');
      if (providerChips) {
        providerChips.addEventListener('click', function (e) {
          var chip = e.target.closest ? e.target.closest('.ai-chip[data-vendor]') : null;
          if (!chip) return;
          var key = chip.getAttribute('data-vendor');
          var v = AI_VENDORS[key];
          if (!v) return;
          if (v.endpoint && aiEndpoint) aiEndpoint.value = v.endpoint;
          if (v.models && v.models.length && aiModel) aiModel.value = v.models[0];
          saveAIConfig();
        });
      }

      // 密钥遮罩切换与复制
      function bindEyeToggle(btnId, inputId) {
        var btn = document.getElementById(btnId);
        if (!btn) return;
        btn.addEventListener('click', function () {
          var inp = document.getElementById(inputId);
          if (!inp) return;
          inp.type = inp.type === 'password' ? 'text' : 'password';
        });
      }
      bindEyeToggle('aiToggleKeyEye', 'aiKey');
      bindEyeToggle('aiToggleSearchEye', 'aiSearchKey');
      bindEyeToggle('aiToggleCustomKeyEye', 'aiCustomKey');
      var copyKeyBtn = document.getElementById('aiCopyKeyBtn');
      if (copyKeyBtn) {
        copyKeyBtn.addEventListener('click', function () {
          var v = aiKey ? aiKey.value : '';
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(v).catch(function () {});
          }
          flashSaved(v ? '已复制密钥' : '密钥为空');
        });
      }

      // 深度思考 4 宫格卡片
      var thinkCards = document.getElementById('aiThinkCards');
      if (thinkCards) {
        thinkCards.addEventListener('click', function (e) {
          var card = e.target.closest ? e.target.closest('.ai-choice-card[data-gear]') : null;
          if (!card) return;
          var g = card.getAttribute('data-gear');
          if (g === 'off') {
            if (aiDeepSearch) aiDeepSearch.checked = false;
          } else {
            if (aiDeepSearch) aiDeepSearch.checked = true;
            setIf('aiThinkingGear', g);
          }
          saveAIConfig();
        });
      }

      // 分段胶囊按钮同步
      var kimiTierSeg = document.getElementById('aiKimiTierSeg');
      if (kimiTierSeg) {
        kimiTierSeg.addEventListener('click', function (e) {
          var btn = e.target.closest ? e.target.closest('.ai-seg-btn[data-kimi-tier]') : null;
          if (!btn) return;
          setIf('aiKimiTier', btn.getAttribute('data-kimi-tier'));
          saveAIConfig();
        });
      }
      var freshSeg = document.getElementById('aiSearchFreshnessSeg');
      if (freshSeg) {
        freshSeg.addEventListener('click', function (e) {
          var btn = e.target.closest ? e.target.closest('.ai-seg-btn[data-freshness]') : null;
          if (!btn) return;
          setIf('aiSearchFreshness', btn.getAttribute('data-freshness'));
          saveAIConfig();
        });
      }
      var roundsSeg = document.getElementById('aiMaxSearchRoundsSeg');
      if (roundsSeg) {
        roundsSeg.addEventListener('click', function (e) {
          var btn = e.target.closest ? e.target.closest('.ai-seg-btn[data-rounds]') : null;
          if (!btn) return;
          setIf('aiMaxSearchRounds', btn.getAttribute('data-rounds'));
          saveAIConfig();
        });
      }
      var maxTokensSeg = document.getElementById('aiMaxTokensSeg');
      if (maxTokensSeg) {
        maxTokensSeg.addEventListener('click', function (e) {
          var btn = e.target.closest ? e.target.closest('.ai-seg-btn[data-tokens]') : null;
          if (!btn) return;
          setIf('aiMaxTokens', btn.getAttribute('data-tokens') || '');
          saveAIConfig();
        });
      }
      var tempChips = document.getElementById('aiTempChips');
      if (tempChips) {
        tempChips.addEventListener('click', function (e) {
          var chip = e.target.closest ? e.target.closest('.ai-chip[data-temp]') : null;
          if (!chip) return;
          setIf('aiTemperature', chip.getAttribute('data-temp'));
          saveAIConfig();
        });
      }

      // 折叠详情与自定义 JSON 区块（SVG chevron 原地旋转）
      function bindDisclosure(btnId, bodyId, openLabel, closedLabel) {
        var btn = document.getElementById(btnId);
        var body = document.getElementById(bodyId);
        if (!btn || !body) return;
        btn.addEventListener('click', function () {
          var open = body.classList.toggle('open');
          btn.classList.toggle('open', open);
          btn.setAttribute('aria-expanded', open ? 'true' : 'false');
          var span = btn.querySelector('span');
          if (span) span.textContent = open ? openLabel : closedLabel;
        });
      }
      bindDisclosure('aiToggleSearchMetaBtn', 'aiSearchMetaDetail', '收起接口与计费详情', '查看接口与计费详情');
      bindDisclosure('aiToggleCustomJsonBtn', 'aiCustomJsonBody', '收起自定义请求头与额外参数', '自定义请求头与额外参数');

      var openSelectEl = null;
      var openSelectTrigger = null;
      function closeCustomSelect() {
        var menu = document.getElementById('aiSelectPortalMenu');
        if (menu) { menu.hidden = true; menu.innerHTML = ''; }
        if (openSelectTrigger) {
          openSelectTrigger.classList.remove('open');
          openSelectTrigger.setAttribute('aria-expanded', 'false');
        }
        openSelectEl = null;
        openSelectTrigger = null;
      }
      function syncCustomSelect(sel) {
        if (!sel || !sel.parentNode) return;
        var trig = sel.parentNode.querySelector('.ai-select-trigger');
        if (!trig) return;
        var opt = sel.options && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;
        var lbl = trig.querySelector('.ai-select-label');
        if (lbl) lbl.textContent = opt ? opt.textContent : '';
      }
      function syncAllCustomSelects() {
        var modal = document.getElementById('aiConfigModal');
        if (!modal) return;
        modal.querySelectorAll('select.ai-pill-select').forEach(syncCustomSelect);
      }
      function positionCustomSelectMenu(trigger, menu) {
        var rect = trigger.getBoundingClientRect ? trigger.getBoundingClientRect() : { top: 0, bottom: 34, right: 200, width: 160 };
        var mw = Math.max(176, Math.round(rect.width || 160), menu.offsetWidth || 176);
        menu.style.minWidth = Math.max(176, Math.round(rect.width || 160)) + 'px';
        var mh = menu.offsetHeight || Math.min(292, menu.children.length * 38 + 12);
        var vw = window.innerWidth || 1024;
        var vh = window.innerHeight || 768;
        var left = Math.max(12, Math.min((rect.right || 200) - mw, vw - mw - 12));
        var top = (rect.bottom || 34) + 6;
        if (top + mh > vh - 14 && (rect.top || 0) - mh - 6 >= 12) {
          top = (rect.top || 0) - mh - 6;
        }
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
      }
      function openCustomSelect(sel, trigger) {
        var menu = document.getElementById('aiSelectPortalMenu');
        if (!menu || !sel) return;
        closeAllPopMenus();
        menu.innerHTML = '';
        var checkSvg = '<svg class="ai-select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
        Array.prototype.forEach.call(sel.options || [], function (opt, idx) {
          var item = document.createElement('button');
          item.type = 'button';
          item.className = 'ai-select-option' + (idx === sel.selectedIndex ? ' selected' : '');
          item.setAttribute('role', 'option');
          item.setAttribute('aria-selected', idx === sel.selectedIndex ? 'true' : 'false');
          item.setAttribute('data-value', opt.value);
          var txt = document.createElement('span');
          txt.className = 'ai-select-option-text';
          txt.textContent = opt.textContent;
          item.appendChild(txt);
          if (idx === sel.selectedIndex) {
            item.insertAdjacentHTML('beforeend', checkSvg);
          }
          item.addEventListener('click', function (ev) {
            ev.stopPropagation();
            var val = opt.value;
            sel.value = val;
            syncCustomSelect(sel);
            closeCustomSelect();
            try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e2) {}
          });
          menu.appendChild(item);
        });
        menu.hidden = false;
        trigger.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        openSelectEl = sel;
        openSelectTrigger = trigger;
        positionCustomSelectMenu(trigger, menu);
      }
      function initCustomSelects() {
        var modal = document.getElementById('aiConfigModal');
        if (!modal) return;
        modal.querySelectorAll('.ai-pill-select-wrap').forEach(function (wrap) {
          var sel = wrap.querySelector('select.ai-pill-select');
          if (!sel || wrap.querySelector('.ai-select-trigger')) return;
          sel.classList.add('ai-select-native');
          sel.tabIndex = -1;
          var trig = document.createElement('button');
          trig.type = 'button';
          trig.className = 'ai-select-trigger';
          trig.setAttribute('aria-haspopup', 'listbox');
          trig.setAttribute('aria-expanded', 'false');
          if (sel.getAttribute('aria-label')) trig.setAttribute('aria-label', sel.getAttribute('aria-label'));
          trig.innerHTML = '<span class="ai-select-label"></span><svg class="ai-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
          wrap.appendChild(trig);
          syncCustomSelect(sel);
          sel.addEventListener('change', function () { syncCustomSelect(sel); });
          trig.addEventListener('click', function (ev) {
            ev.stopPropagation();
            if (openSelectEl === sel) { closeCustomSelect(); return; }
            openCustomSelect(sel, trig);
          });
          trig.addEventListener('keydown', function (ev) {
            if (ev.key === 'ArrowDown' || ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              if (openSelectEl !== sel) openCustomSelect(sel, trig);
            }
          });
        });
      }
      function closeAllPopMenus() {
        closeCustomSelect();
        var modal = document.getElementById('aiConfigModal');
        if (!modal) return;
        modal.querySelectorAll('.ai-pop-menu').forEach(function (m) { m.hidden = true; });
        modal.querySelectorAll('.ai-more-btn').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
      }
      function bindPopMenu(btnId, menuId) {
        var btn = document.getElementById(btnId);
        var menu = document.getElementById(menuId);
        if (!btn || !menu) return;
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var willOpen = !!menu.hidden;
          closeAllPopMenus();
          menu.hidden = !willOpen;
          btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        });
      }
      bindPopMenu('aiProfileMoreBtn', 'aiProfileMenu');
      bindPopMenu('aiSystemPresetMoreBtn', 'aiSystemPresetMenu');
      bindPopMenu('aiContextPresetMoreBtn', 'aiContextPresetMenu');
      document.addEventListener('click', function (e) {
        var inPop = e.target && e.target.closest && (e.target.closest('#aiConfigModal .ai-pop-wrap') || e.target.closest('#aiSelectPortalMenu') || e.target.closest('.ai-select-trigger'));
        if (!inPop) closeAllPopMenus();
      });
      var panesBox = document.querySelector('#aiConfigModal .ai-config-panes');
      if (panesBox) panesBox.addEventListener('scroll', closeCustomSelect);
      window.addEventListener('resize', closeCustomSelect);
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        var modal = document.getElementById('aiConfigModal');
        if (!modal) return;
        var selMenu = document.getElementById('aiSelectPortalMenu');
        var hasOpenSelect = !!(selMenu && !selMenu.hidden);
        var hasOpenMenu = hasOpenSelect || Array.prototype.some.call(modal.querySelectorAll('.ai-pop-menu'), function (m) { return !m.hidden; });
        if (hasOpenMenu) {
          closeAllPopMenus();
          e.stopPropagation();
        }
      }, true);
      initCustomSelects();

      function beginInlineRename(selectWrapId, inputId, getOriginal, onCommit) {
        var wrap = document.getElementById(selectWrapId);
        var inp = document.getElementById(inputId);
        if (!inp) return;
        closeAllPopMenus();
        var orig = String(getOriginal() || '');
        if (wrap) wrap.hidden = true;
        inp.hidden = false;
        inp.value = orig;
        inp.focus();
        if (typeof inp.select === 'function') inp.select();
        var finished = false;
        function done(commit) {
          if (finished) return;
          finished = true;
          inp.removeEventListener('keydown', onKey);
          inp.removeEventListener('blur', onBlur);
          inp.hidden = true;
          if (wrap) wrap.hidden = false;
          if (commit) {
            var nextVal = inp.value.trim();
            if (nextVal) onCommit(nextVal);
          } else {
            inp.value = orig;
          }
        }
        function onKey(ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
          else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); done(false); }
        }
        function onBlur() { done(true); }
        inp.addEventListener('keydown', onKey);
        inp.addEventListener('blur', onBlur);
      }

      var profileSel = document.getElementById('aiProfileSelect');
      if (profileSel) {
        profileSel.addEventListener('change', function () {
          closeAllPopMenus();
          readProfileFromForm(activeProfile);
          activeProfile = aiProfiles.filter(function (p) { return p.id === profileSel.value; })[0] || aiProfiles[0];
          writeProfileToForm(activeProfile);
          saveAIConfig();
        });
      }
      var profileRename = document.getElementById('aiProfileRename');
      if (profileRename) {
        profileRename.addEventListener('click', function () {
          beginInlineRename('aiProfileSelectWrap', 'aiProfileName', function () {
            return activeProfile ? activeProfile.name : '';
          }, function (val) {
            if (activeProfile) activeProfile.name = val;
            saveAIConfig();
          });
        });
      }
      var profileAdd = document.getElementById('aiProfileAdd');
      if (profileAdd) {
        profileAdd.addEventListener('click', function () {
          closeAllPopMenus();
          readProfileFromForm(activeProfile);
          var p = blankProfile('配置 ' + (aiProfiles.length + 1));
          aiProfiles.push(p);
          activeProfile = p;
          writeProfileToForm(p);
          saveAIConfig();
          beginInlineRename('aiProfileSelectWrap', 'aiProfileName', function () { return p.name; }, function (val) {
            p.name = val;
            saveAIConfig();
          });
        });
      }
      var profileDup = document.getElementById('aiProfileDup');
      if (profileDup) {
        profileDup.addEventListener('click', function () {
          closeAllPopMenus();
          readProfileFromForm(activeProfile);
          var src = activeProfile || blankProfile('通用配置');
          var copy = {
            id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            name: (src.name || '配置') + ' (副本)',
            endpoint: src.endpoint || '',
            key: src.key || '',
            model: src.model || ''
          };
          aiProfiles.push(copy);
          activeProfile = copy;
          writeProfileToForm(copy);
          saveAIConfig();
          flashSaved('已复制方案');
        });
      }
      var profileDel = document.getElementById('aiProfileDel');
      if (profileDel) {
        profileDel.addEventListener('click', function () {
          closeAllPopMenus();
          if (aiProfiles.length < 2) { showAIToast('至少保留一套配置'); return; }
          aiProfiles = aiProfiles.filter(function (p) { return p !== activeProfile; });
          activeProfile = aiProfiles[0];
          writeProfileToForm(activeProfile);
          saveAIConfig();
        });
      }

      // 拉取模型列表（GET /v1/models）
      var fetchModelsBtn = document.getElementById('aiFetchModelsBtn');
      if (fetchModelsBtn) {
        fetchModelsBtn.addEventListener('click', function () {
          var endpoint = aiEndpoint ? aiEndpoint.value.trim() : '';
          var mUrl = buildModelsUrl(endpoint);
          if (!mUrl) { flashSaved('请先填写 API 地址'); return; }
          var key = aiKey ? aiKey.value.trim() : '';
          var headers = {};
          if (key) headers.Authorization = 'Bearer ' + key;
          var parsedHdrs = parseJsonObjectField('aiCustomHeaders');
          if (parsedHdrs.ok && parsedHdrs.obj) {
            Object.keys(parsedHdrs.obj).forEach(function (k) {
              if (parsedHdrs.obj[k] != null) headers[k] = String(parsedHdrs.obj[k]);
            });
          }
          var prevText = fetchModelsBtn.textContent;
          fetchModelsBtn.disabled = true;
          fetchModelsBtn.textContent = '拉取中…';
          fetch(mUrl, { method: 'GET', headers: headers, signal: AbortSignal.timeout(15000) }).then(function (r) {
            if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ' ' + String(t || '').slice(0, 120)); });
            return r.json();
          }).then(function (data) {
            var list = [];
            if (data && Array.isArray(data.data)) {
              list = data.data.map(function (x) { return x && x.id; }).filter(Boolean);
            } else if (data && Array.isArray(data.models)) {
              list = data.models.map(function (x) { return x && (x.name || x.model || x.id); }).filter(Boolean);
            }
            list = list.filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, 24);
            if (!list.length) throw new Error('接口未返回模型列表');
            fetchedModelsCache[mUrl] = list;
            renderVendorAndModelChips();
            flashSaved('已拉取 ' + list.length + ' 个模型');
          }).catch(function (err) {
            flashSaved('拉取失败：' + (err && err.message ? err.message : err));
          }).finally(function () {
            fetchModelsBtn.disabled = false;
            fetchModelsBtn.textContent = prevText;
          });
        });
      }

      var testBtn = document.getElementById('aiTestBtn');
      if (testBtn) {
        testBtn.addEventListener('click', function () {
          var status = document.getElementById('aiTestStatus');
          var endpoint = aiEndpoint.value.trim();
          var key = aiKey.value.trim();
          var model = aiModel.value.trim() || 'deepseek-flash';
          if (!endpoint || !key) {
            if (status) { status.className = 'ai-probe-badge err'; status.textContent = '请先填写地址和密钥'; }
            return;
          }
          if (status) { status.className = 'ai-probe-badge'; status.textContent = '正在连接…'; }
          var t0 = Date.now();
          var testBody = { model: model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false };
          fetch(buildChatUrl(endpoint), {
            method: 'POST',
            headers: buildChatHeaders(key),
            body: JSON.stringify(testBody),
            signal: AbortSignal.timeout(timeoutMs())
          }).then(function (r) {
            if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ' ' + String(t).slice(0, 160)); });
            var ms = Math.max(1, Date.now() - t0);
            if (status) {
              status.className = 'ai-probe-badge ok';
              status.innerHTML = '<i class="ai-dot-ok"></i><span>连接成功 · ' + ms + 'ms</span>';
            }
          }).catch(function (err) {
            if (status) {
              status.className = 'ai-probe-badge err';
              status.textContent = '连接失败：' + (err && err.message ? err.message : err);
            }
          });
        });
      }

      // 测试联网搜索接口
      var testSearchBtn = document.getElementById('aiTestSearchBtn');
      if (testSearchBtn) {
        testSearchBtn.addEventListener('click', function () {
          var badge = document.getElementById('aiSearchProbeStatus');
          commitSearchKeyFromDom();
          if (!providerReady()) {
            if (badge) {
              badge.className = 'ai-probe-badge err';
              badge.textContent = searchProvider() === 'custom' ? '请先填写自定义地址' : '请先填写搜索密钥';
            }
            return;
          }
          if (badge) { badge.className = 'ai-probe-badge'; badge.textContent = '探测中…'; }
          var t0 = Date.now();
          fetchWebSearch('Motuo-Tab').then(function (r) {
            if (r && r.failed) {
              if (badge) {
                badge.className = 'ai-probe-badge err';
                badge.textContent = '失败：' + describeSearchError(r.error);
              }
              return;
            }
            var ms = Math.max(1, Date.now() - t0);
            if (badge) {
              badge.className = 'ai-probe-badge ok';
              badge.innerHTML = '<i class="ai-dot-ok"></i><span>可用 · ' + r.resultCount + ' 条 · ' + ms + 'ms</span>';
            }
          });
        });
      }

      function resetPromptLayer(kind) {
        var s = layerState(kind);
        var builtins = kind === 'context' ? builtinContextPresets() : builtinSystemPresets();
        var cur = presetById(s.list(), s.getId());
        var match = cur && builtins.filter(function (b) { return b.id === cur.id; })[0];
        if (cur) cur.text = (match || builtins[0]).text;
        var box = document.getElementById(s.box);
        if (box && cur) box.value = cur.text;
        renderLayer(kind);
        saveAIConfig();
        flashSaved('已恢复默认');
      }
      function bindPromptLayer(kind, addId) {
        var s = layerState(kind);
        var sel = document.getElementById(s.select);
        if (sel) {
          sel.addEventListener('change', function () {
            closeAllPopMenus();
            commitLayer(kind);
            s.setId(sel.value);
            renderLayer(kind);
            saveAIConfig();
          });
        }
        var box = document.getElementById(s.box);
        if (box) {
          box.addEventListener('input', function () {
            syncPromptUI();
            saveAIConfig();
          });
        }
        var name = document.getElementById(s.name);
        if (name) name.addEventListener('change', function () { saveAIConfig(); });
        var renBtn = document.getElementById(s.rename);
        if (renBtn) {
          renBtn.addEventListener('click', function () {
            var cur = presetById(s.list(), s.getId());
            if (!cur || cur.builtin) return;
            beginInlineRename(s.selectWrap, s.name, function () { return cur.name || ''; }, function (val) {
              cur.name = val;
              renderLayer(kind);
              saveAIConfig();
            });
          });
        }
        var rstMenuBtn = document.getElementById(s.reset);
        if (rstMenuBtn) {
          rstMenuBtn.addEventListener('click', function () {
            closeAllPopMenus();
            resetPromptLayer(kind);
          });
        }
        var addBtn = document.getElementById(addId);
        if (addBtn) {
          addBtn.addEventListener('click', function () {
            closeAllPopMenus();
            commitLayer(kind);
            var list = s.list();
            var created = {
              id: (kind === 'context' ? 'c' : 's') + Date.now().toString(36),
              name: (kind === 'context' ? '环境预设 ' : '系统预设 ') + (list.length + 1),
              text: (presetById(list, s.getId()) || {}).text || '',
              builtin: false
            };
            list.push(created);
            s.setId(created.id);
            renderLayer(kind);
            saveAIConfig();
            beginInlineRename(s.selectWrap, s.name, function () { return created.name; }, function (val) {
              created.name = val;
              renderLayer(kind);
              saveAIConfig();
            });
          });
        }
        var delBtn = document.getElementById(s.del);
        if (delBtn) {
          delBtn.addEventListener('click', function () {
            closeAllPopMenus();
            var cur = presetById(s.list(), s.getId());
            if (!cur || cur.builtin) return;
            var next = s.list().filter(function (p) { return p.id !== cur.id; });
            if (kind === 'context') contextPresetList = next;
            else systemPresetList = next;
            s.setId((next[0] && next[0].id) || (kind === 'context' ? 'full' : 'general'));
            renderLayer(kind);
            saveAIConfig();
          });
        }
      }
      bindPromptLayer('system', 'aiSystemPresetAdd');
      bindPromptLayer('context', 'aiContextPresetAdd');

      // 提示词双层切换、预览与恢复默认
      var promptLayerSeg = document.getElementById('aiPromptLayerSeg');
      if (promptLayerSeg) {
        promptLayerSeg.addEventListener('click', function (e) {
          var btn = e.target.closest ? e.target.closest('[data-prompt-layer]') : null;
          if (!btn) return;
          closeAllPopMenus();
          activePromptLayer = btn.getAttribute('data-prompt-layer') === 'context' ? 'context' : 'system';
          promptPreviewOpen = false;
          syncPromptUI();
        });
      }
      var promptPreviewBtn = document.getElementById('aiTogglePromptPreviewBtn');
      if (promptPreviewBtn) {
        promptPreviewBtn.addEventListener('click', function () {
          promptPreviewOpen = !promptPreviewOpen;
          syncPromptUI();
        });
      }
      var promptResetBtn = document.getElementById('aiPromptResetBtn');
      if (promptResetBtn) {
        promptResetBtn.addEventListener('click', function () {
          resetPromptLayer(activePromptLayer);
        });
      }

      ['aiEndpoint', 'aiKey', 'aiModel'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
          el.addEventListener('input', function () {
            syncProfileRow();
            resolvedEndpointHint();
            renderVendorAndModelChips();
            syncSidebarStatus();
          });
        }
      });
      var configNav = document.querySelector('.ai-config-nav');
      if (configNav) {
        configNav.addEventListener('click', function (e) {
          var btn = e.target.closest ? e.target.closest('button[data-pane]') : null;
          if (!btn) return;
          if (typeof closeAllPopMenus === 'function') closeAllPopMenus();
          var id = btn.getAttribute('data-pane');
          configNav.querySelectorAll('button').forEach(function (b) {
            b.classList.toggle('active', b === btn);
          });
          document.querySelectorAll('.ai-config-pane').forEach(function (pane) {
            pane.classList.toggle('active', pane.getAttribute('data-pane') === id);
          });
        });
      }
      var varRow = document.querySelector('.ai-var-row');
      if (varRow) {
        varRow.addEventListener('click', function (e) {
          var btn = e.target.closest ? e.target.closest('.ai-var-btn') : null;
          if (!btn) return;
          var box = document.getElementById(activePromptLayer === 'context' ? 'aiContextPrompt' : 'aiSystemPrompt');
          if (!box) return;
          if (promptPreviewOpen) { promptPreviewOpen = false; syncPromptUI(); }
          var token = btn.getAttribute('data-var') || '';
          var start = box.selectionStart || 0;
          var end = box.selectionEnd || 0;
          box.value = box.value.slice(0, start) + token + box.value.slice(end);
          box.focus();
          saveAIConfig();
        });
      }

      // 数据与安全 Tab 按钮
      var exportAiBtn = document.getElementById('aiExportConfigBtn');
      if (exportAiBtn) {
        exportAiBtn.addEventListener('click', function () {
          saveAIConfig(true);
          var rawCfg = null;
          try { rawCfg = JSON.parse(localStorage.getItem(AI_CONFIG_KEY) || 'null'); } catch (e) { rawCfg = null; }
          var payload = {
            app: 'Motuo-Tab-AI',
            version: 1,
            exportedAt: new Date().toISOString(),
            config: redactAIConfigObject(rawCfg || {})
          };
          var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'motuo-tab-ai-config-' + Date.now() + '.json';
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          flashSaved('已导出 AI 配置');
        });
      }
      var importAiBtn = document.getElementById('aiImportConfigBtn');
      var importAiFile = document.getElementById('aiImportConfigFile');
      if (importAiBtn && importAiFile) {
        importAiBtn.addEventListener('click', function () {
          importAiFile.value = '';
          importAiFile.click();
        });
        importAiFile.addEventListener('change', function () {
          var file = importAiFile.files && importAiFile.files[0];
          if (!file) return;
          var reader = new FileReader();
          reader.onload = function () {
            try {
              var obj = JSON.parse(reader.result);
              var cfg = null;
              if (obj && obj.data && obj.data.ai && obj.data.ai.config) {
                cfg = typeof obj.data.ai.config === 'string' ? JSON.parse(obj.data.ai.config) : obj.data.ai.config;
              } else if (obj && obj.config && typeof obj.config === 'object') {
                cfg = obj.config;
              } else if (obj && typeof obj === 'object') {
                cfg = obj;
              }
              if (!cfg || typeof cfg !== 'object') throw new Error('无效的 AI 配置文件');
              applyAIConfigObject(cfg);
              saveAIConfig(true);
              flashSaved('已导入 AI 配置');
            } catch (err) {
              alert('导入 AI 配置失败：' + (err && err.message ? err.message : err));
            }
          };
          reader.readAsText(file);
        });
      }
      var clearHistBtn = document.getElementById('aiClearHistoryBtn');
      if (clearHistBtn) {
        clearHistBtn.addEventListener('click', function () {
          if (aiSending) return;
          if (aiHistory.length > 1 && !confirm('确定清空全部对话？清空后不可恢复。')) return;
          clearAIConversation();
          flashSaved('已清空对话历史');
        });
      }
      var resetAiBtn = document.getElementById('aiResetConfigBtn');
      if (resetAiBtn) {
        resetAiBtn.addEventListener('click', function () {
          if (!confirm('确定恢复默认 AI 配置？将清除已填写的接口地址与密钥，并还原内置提示词。')) return;
          try { localStorage.removeItem(AI_CONFIG_KEY); } catch (e) {}
          fetchedModelsCache = {};
          applyAIConfigObject(null);
          saveAIConfig(true);
          var mProbe = document.getElementById('aiTestStatus');
          if (mProbe) { mProbe.className = 'ai-probe-badge'; mProbe.textContent = '未测试'; }
          var sProbe = document.getElementById('aiSearchProbeStatus');
          if (sProbe) { sProbe.className = 'ai-probe-badge'; sProbe.textContent = '未测试'; }
          flashSaved('已恢复默认配置');
        });
      }
      // 深度搜索：在气泡内部创建思考过程容器（默认收起，点击头部展开/收起）
      function createThinkingEl() {
        var el = document.createElement('div');
        el.className = 'ai-thinking';
        el.innerHTML = '<div class="ai-thinking-header" role="button" tabindex="0" aria-expanded="false"><span class="ai-thinking-arrow">▶</span> 深度思考</div><div class="ai-thinking-body"></div>';
        var header = el.querySelector('.ai-thinking-header');
        function flip() {
          var open = el.classList.toggle('open');
          header.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        header.onclick = flip;
        header.onkeydown = function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); flip(); }
        };
        return el;
      }
      // 思考步骤图标映射（语义化小圆点，按类型区分颜色；刻意做小以降低视觉比重）
      var _thinkingIconMap = {
        depth:    '<svg width="6" height="6" viewBox="0 0 6 6"><circle cx="3" cy="3" r="3" fill="#7a4df0"/></svg>',
        reasoning:'<svg width="6" height="6" viewBox="0 0 6 6"><circle cx="3" cy="3" r="3" fill="#2468f2"/></svg>',
        search:   '<svg width="6" height="6" viewBox="0 0 6 6"><circle cx="3" cy="3" r="3" fill="#e88a2b"/></svg>',
        result:   '<svg width="6" height="6" viewBox="0 0 6 6"><circle cx="3" cy="3" r="3" fill="#1aa86b"/></svg>',
        done:     '<svg width="6" height="6" viewBox="0 0 6 6"><circle cx="3" cy="3" r="3" fill="#1aa86b"/></svg>',
        error:    '<svg width="6" height="6" viewBox="0 0 6 6"><circle cx="3" cy="3" r="3" fill="#d93b3b"/></svg>'
      };
      // 添加一步思考记录（返回步骤元素，便于缓存引用）
      function addThinkingStep(thinkingEl, iconType, text) {
        if (!thinkingEl) return null;
        var body = thinkingEl.querySelector('.ai-thinking-body');
        var step = document.createElement('div');
        step.className = 'ai-thinking-step';
        var iconSvg = _thinkingIconMap[iconType] || _thinkingIconMap.depth;
        step.innerHTML = '<span class="step-icon">' + iconSvg + '</span><span class="step-text">' + text + '</span>';
        body.appendChild(step);
        thinkingEl.classList.add('open');
        var _h = thinkingEl.querySelector('.ai-thinking-header');
        if (_h) _h.setAttribute('aria-expanded', 'true');
        aiMessages.scrollTop = aiMessages.scrollHeight;
        return step;
      }
      // 标记思考完成：移除加载指示并收起，降低完成后的默认信息密度
      function finishThinking(thinkingEl) {
        if (!thinkingEl) return;
        var spins = thinkingEl.querySelectorAll('.ai-spinner');
        for (var i = 0; i < spins.length; i++) {
          if (spins[i].parentNode) spins[i].parentNode.removeChild(spins[i]);
        }
        thinkingEl.classList.remove('open');
        var _h = thinkingEl.querySelector('.ai-thinking-header');
        if (_h) _h.setAttribute('aria-expanded', 'false');
      }

      function toggleAI(open) {
        aiPanel.classList.toggle('open', open);
        aiOverlay.classList.toggle('open', open);
        if (open) {
          if (aiSending) {
            // 请求中：不渲染历史，气泡还在 DOM 里，继续流
            aiMessages.scrollTop = aiMessages.scrollHeight;
          } else {
            // 空闲状态：恢复按钮并渲染历史
            aiSend.disabled = false;
            aiSend.textContent = '发送';
            renderAIHistory();
          }
        }
      }

      // 归一化 DeepSeek DSML 标记：V3.2 用 <｜DSML｜function_calls>、V4 用 <｜DSML｜tool_calls>，
      // 分隔符是全角竖线 U+FF5C（也兼容半角 |），里面的 invoke/parameter 同样带前缀。
      // 归一化后统一退化成普通 XML，便于解析与剥离。
      function normalizeDSML(text) {
        return String(text || '')
          .replace(/<(\/)?[|\uFF5C]DSML[|\uFF5C]/g, '<$1')
          // 联网搜索标签的别名统一成 <web_search>：模型有时写成 <search>/<websearch>/<search_web>/<web search>
          .replace(/(<\/?)\s*(?:web\s*search|websearch|search_web)\b/gi, '$1web_search');
      }

      // 剥离模型"泄漏"到正文里的工具调用标记（DeepSeek DSML、<tool_calls><invoke>、
      // 旧式 <tool_call><function>），但保留本项目自己写入的语义标签
      // <tool_call>{json}</tool_call>（用于渲染搜索 chip）。
      function stripToolMarkup(text) {
        var s = normalizeDSML(text);
        s = s
          // 自有文本协议：<web_search>…</web_search>（成对 / 未闭合）
          .replace(/<web_search>[\s\S]*?<\/web_search>/gi, '')
          .replace(/<web_search>[\s\S]*$/i, '')
          // 成对包裹的调用块（DSML tool_calls/function_calls、普通 <tool_calls>）
          .replace(/<(?:tool_calls|function_calls)>[\s\S]*?<\/(?:tool_calls|function_calls)>/gi, '')
          // 未闭合的调用块（流式中途）
          .replace(/<(?:tool_calls|function_calls)>[\s\S]*$/i, '')
          // 单数 <tool_call> 且内部是 XML（泄漏的调用）；保留 <tool_call>{json}</tool_call>
          .replace(/<tool_call>\s*<[\s\S]*?<\/tool_call>/gi, '')
          .replace(/<tool_call>(?:(?!<\/tool_call>)[\s\S])*$/i, '')
          // 没有外层包裹时残留的 invoke/parameter
          .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, '')
          .replace(/<parameter\b[^>]*>[\s\S]*?<\/parameter>/gi, '')
          .replace(/<parameter\b[^>]*\/>/gi, '');
        return s;
      }

      // 解析"文本标签"形式的工具调用：部分模型/API 不返回结构化 delta.tool_calls，
      // 而是把调用直接写进正文/推理文本。支持：
      //   A) DeepSeek DSML：<｜DSML｜tool_calls><｜DSML｜invoke name="web_search">
      //        <｜DSML｜parameter name="query" string="true">…</｜DSML｜parameter>…
      //   B) 普通 XML：<tool_calls><invoke name="web_search"><parameter name="query">…</parameter></invoke></tool_calls>
      //   C) 旧式：<tool_call><function=web_search><parameter=query>…</parameter></function></tool_call>
      // 命中则返回 {name, query, raw, params}，否则返回 null。
      function parseTextToolCall(text) {
        if (!text || typeof text !== 'string') return null;
        var src = normalizeDSML(text);

        // 0) 本项目自有的文本协议：<web_search>关键词</web_search>。
        //    不依赖 OpenAI 原生 tools，避免 DeepSeek 思考模式下结构化/text 工具调用来回变的兼容问题。
        var ws = src.match(/<web_search>\s*([\s\S]*?)\s*<\/web_search>/i);
        if (ws && ws[1]) return { name: 'web_search', query: ws[1].trim(), raw: ws[0] };

        // A/B) invoke + parameter 语法
        var env = src.match(/<(?:tool_calls|function_calls)\b[^>]*>([\s\S]*?)<\/(?:tool_calls|function_calls)>/i);
        var scope = env ? env[1] : src;
        var inv = scope.match(/<invoke\s+name\s*=\s*"([^"]+)"[^>]*>/i);
        if (inv) {
          var name = inv[1].trim();
          var params = {};
          var pRe = /<parameter\s+name\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/parameter>/gi;
          var pm;
          while ((pm = pRe.exec(scope)) !== null) { params[pm[1]] = pm[2].trim(); }
          var query = params.query || params.q || params.keyword || params.search_query || '';
          if (!query) {
            // 没按约定命名时退回第一个参数值，尽量别让工具调用落空
            var firstKey = Object.keys(params)[0];
            if (firstKey) query = params[firstKey];
          }
          var lname = name.toLowerCase();
          if (lname === 'web_search' || lname === 'websearch' || lname === 'search_web') {
            return { name: 'web_search', query: query, raw: env ? env[0] : inv[0], params: params };
          }
          return null;
        }

        // C) 旧式 <function=web_search><parameter=query>
        var m = src.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
        var inner = m ? m[1] : src;
        var fn = inner.match(/<function\s*=\s*"?([^>\s"']+)"?>/i);
        if (!fn) return null;
        var name2 = fn[1].trim();
        var query2 = '';
        var pm2 = inner.match(/<parameter\s*=\s*"?query"?[^>]*>([\s\S]*?)<\/parameter>/i);
        if (!pm2) pm2 = inner.match(/<parameter\s+name\s*=\s*"?query"?[^>]*>([\s\S]*?)<\/parameter>/i);
        if (pm2) query2 = pm2[1].trim();
        return { name: name2, query: query2, raw: m ? m[0] : fn[0] };
      }

      // 把"纯文本 + 语义标签"的 assistant 内容渲染成带样式的 DOM：
      //   <think>…</think>        → 深度思考卡片（前端样式）
      //   <tool_call>…</tool_call> → 联网搜索状态块（前端样式）
      //   <ops>…</ops>            → 工具操作 chips（前端样式）
      //   其余                    → Markdown 正文
      function renderAIContent(content) {
        var frag = document.createDocumentFragment();
        var rest = String(content || '');

        // 先剥离模型"泄漏"到正文里的工具调用标记（DeepSeek DSML / <tool_calls> / <invoke>），
        // 保留本项目写入的语义标签 <tool_call>{json}</tool_call>（下方会渲染成搜索 chip）
        rest = stripToolMarkup(rest);
        // 旧历史里可能存的是裸 JSON ops，规范成 <ops> 才能渲染成 chips
        rest = normalizeOpsTags(rest);

        // 0) 安全兜底：未闭合的标签（异常数据/中断的流式输出）一律不展示原文。
        //    用 tempered dot 确保只剥离"确实没有闭合标签"的尾巴，不影响正常内容
        rest = rest
          .replace(/<tool_call>(?:(?!<\/tool_call>)[\s\S])*$/i, '')
          .replace(/<think>(?:(?!<\/think>)[\s\S])*$/i, '');

        // 1) 思考过程（默认收起，点击展开；避免窄侧边栏默认信息密度过高）
        var thinkMatch = rest.match(/<think>([\s\S]*?)<\/think>/i);
        if (thinkMatch) {
          var thinkEl = createThinkingEl();
          var stepEl = document.createElement('div');
          stepEl.className = 'ai-thinking-step ai-reasoning-step';
          stepEl.innerHTML = '<span class="step-icon">' + _thinkingIconMap.reasoning + '</span><span class="step-text"><span class="ai-reasoning-text"></span></span>';
          stepEl.querySelector('.ai-reasoning-text').textContent = thinkMatch[1];
          thinkEl.querySelector('.ai-thinking-body').appendChild(stepEl);
          frag.appendChild(thinkEl);
          rest = rest.slice(0, thinkMatch.index) + rest.slice(thinkMatch.index + thinkMatch[0].length);
        }

        // 2) 工具调用（联网搜索）：剥离全部 <tool_call> 原始标签（含文本标签形式），
        //    只展示"已搜索"摘要 chip —— 原始代码绝不暴露给用户
        var queries = [];
        rest = rest.replace(/<tool_call>([\s\S]*?)<\/tool_call>/gi, function (_all, inner) {
          var q = '';
          var n = 0;
          try {
            var tc = JSON.parse(inner.trim());
            q = String((tc && tc.query) || '');
            n = Number((tc && tc.count) || 0) || 0;
          } catch (e) {
            // 兼容旧历史里的"文本标签"形式：<function=web_search><parameter=query>…</parameter>
            var tf = parseTextToolCall('<tool_call>' + inner + '</tool_call>');
            if (tf) q = tf.query;
          }
          if (q) queries.push({ q: q, count: n });
          return '';
        });
        if (queries.length) {
          var chipsWrap = document.createElement('div');
          chipsWrap.className = 'ai-search-chips';
          queries.forEach(function (item) {
            var chip = document.createElement('span');
            chip.className = 'ai-search-chip';
            chip.title = '已联网搜索「' + item.q + '」' + (item.count ? '，找到 ' + item.count + ' 个结果' : '');
            chip.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2.2"/><path d="M20.5 20.5l-4.3-4.3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg><span></span>';
            chip.querySelector('span').textContent = item.q + (item.count ? '（' + item.count + ' 个结果）' : '');
            chipsWrap.appendChild(chip);
          });
          frag.appendChild(chipsWrap);
        }

        // 3) ops 工具操作
        var opsMatch = rest.match(/<ops>([\s\S]*?)<\/ops>/i);
        if (opsMatch) {
          var summary = (rest.slice(0, opsMatch.index) + rest.slice(opsMatch.index + opsMatch[0].length)).trim();
          if (summary) {
            var p = document.createElement('div');
            p.style.whiteSpace = 'normal';
            p.innerHTML = renderMarkdown(summary);
            frag.appendChild(p);
          }
          try {
            var ops = JSON.parse(opsMatch[1].trim());
            var chips = renderOpsChips(ops);
            if (chips && chips.childNodes.length) frag.appendChild(chips);
          } catch (e) {}
          rest = '';
        }

        // 4) 剩余正文
        if (rest.trim()) {
          var md = document.createElement('div');
          md.style.whiteSpace = 'normal';
          md.innerHTML = renderMarkdown(rest);
          frag.appendChild(md);
        }
        return frag;
      }

      function renderAIHistory() {
        // 保留持久元素（引导语），清除其余
        var persist = [].slice.call(aiMessages.querySelectorAll('.ai-msg-persist'));
        aiMessages.innerHTML = '';
        persist.forEach(function(el) { aiMessages.appendChild(el); });

        // 渲染历史（索引 1 开始，跳过 system）
        for (var i = 1; i < aiHistory.length; i++) {
          var msg = aiHistory[i];

          // 跳过内部协议消息（不向用户展示）：
          //  - role === 'tool'：旧版 native tools 的搜索结果，仅作 API 上下文
          //  - msg.tool_calls：旧版结构化工具调用帧（content 通常为 null）
          //  - msg.hidden：新版文本协议注入的搜索结果（user 角色，但不该显示）
          if (msg.role === 'tool' || msg.tool_calls || msg.hidden) continue;

          var div = document.createElement('div');
          div.className = 'ai-msg ai-msg-' + msg.role;

          // assistant 消息：从"纯文本 + 语义标签"重新渲染（样式由前端定义，不冻结）
          if (msg.role === 'assistant') {
            var content = msg.content;
            if (content !== null && content !== undefined) {
              div.style.whiteSpace = 'normal';
              var frag = renderAIContent(content);
              if (frag.childNodes.length) div.appendChild(frag);
              // 含 <ops> 的历史消息补"撤销"按钮：点击由 aiMessages 上的
              // 事件委托（applyAIUndo）统一处理，重渲染后依然可点
              if (typeof content === 'string' && /<ops>/i.test(content)) {
                var undoBtn = document.createElement('button');
                undoBtn.type = 'button';
                undoBtn.className = 'ai-undo-btn';
                undoBtn.textContent = '↶ 撤销这次操作';
                if (msg.snapshotId) undoBtn.setAttribute('data-snap', msg.snapshotId);
                div.appendChild(undoBtn);
              }
            }
          } else {
            div.style.whiteSpace = 'normal';
            div.innerHTML = renderMarkdown(msg.content || '');
          }

          aiMessages.appendChild(div);
        }
        aiMessages.scrollTop = aiMessages.scrollHeight;
      }

      // 轻量 markdown → HTML 渲染（只处理 AI 输出中的常见格式）
      function renderMarkdown(text) {
        var html = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        // 代码块 ```...```
        html = html.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        // 行内代码 `...`
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        // 加粗 **text**
        html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        // 斜体 *text*
        html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
        // 删除线 ~~text~~
        html = html.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
        // 链接 [text](url)
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_m, label, rawUrl) {
          var href = String(rawUrl || '').trim().replace(/&amp;/g, '&');
          if (/^https?:\/\//i.test(href)) {
            return '<a href="' + href.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener">' + label + '</a>';
          }
          return label;
        });
        // 表格 | A | B |\n |---|---|\n | C | D |
        html = html.replace(/^\|(.+)\|\n\|[-| :]+\|\n(\|.+\|\n?)+/gm, function(m) {
          var lines = m.trim().split('\n');
          var out = '<table><thead><tr>';
          lines[0].split('|').filter(function(c){return c.trim()!=='';}).forEach(function(h){ out += '<th>' + h.trim() + '</th>'; });
          out += '</tr></thead><tbody>';
          for (var i = 2; i < lines.length; i++) {
            var cells = lines[i].split('|').filter(function(c){return c.trim()!=='';});
            if (cells.length) {
              out += '<tr>';
              cells.forEach(function(c){ out += '<td>' + c.trim() + '</td>'; });
              out += '</tr>';
            }
          }
          return out + '</tbody></table>';
        });
        // 标题
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        // 引用
        html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
        // 列表项必须放进列表容器，否则孤立的 <li> 会把标记画到气泡内容区外。
        html = html.replace(/^[-*] (.+)$/gm, '<li class="md-ul-item">$1</li>');
        html = html.replace(/^\d+\. (.+)$/gm, '<li class="md-ol-item">$1</li>');
        html = html.replace(/((?:<li class="md-ul-item">[\s\S]*?<\/li>\n?)+)/g, function (items) {
          return '<ul>' + items.replace(/\n/g, '') + '</ul>';
        });
        html = html.replace(/((?:<li class="md-ol-item">[\s\S]*?<\/li>\n?)+)/g, function (items) {
          return '<ol>' + items.replace(/\n/g, '') + '</ol>';
        });
        // 换行
        html = html.replace(/\n/g, '<br>');
        return html;
      }

      // 实时解析 <ops> 标签，分段渲染气泡（streaming=true 时 <ops> 块显示 placeholder）
      function renderStreamBubble(el, text, streaming) {
        // 保留气泡内的思考过程容器（深度思考时创建在 bubble 内部）
        var thinkingEls = el.querySelectorAll('.ai-thinking');
        var failEls = el.querySelectorAll('.ai-search-fail');
        el.innerHTML = '';
        for (var ti = 0; ti < thinkingEls.length; ti++) { el.appendChild(thinkingEls[ti]); }
        for (var fi = 0; fi < failEls.length; fi++) { el.appendChild(failEls[fi]); }

        text = String(text || '');

        // 部分模型（如 GLM 系列）把推理以 <think>…</think> 内联在正文里而非 reasoning_content：
        // 注入到思考卡片展示，绝不把原始标签暴露给用户。若 reasoning_content 已在流入则跳过。
        var inlineThink = text.match(/<think>([\s\S]*?)<\/think>/i);
        if (inlineThink) {
          text = text.replace(inlineThink[0], '');
          var _th = el.querySelector('.ai-thinking');
          var _rt = _th && _th.querySelector('.ai-reasoning-text');
          if (!_rt || !_rt.textContent) {
            if (!_th) { _th = createThinkingEl(); el.appendChild(_th); }
            _rt = _th.querySelector('.ai-reasoning-text');
            if (!_rt) {
              var _body = _th.querySelector('.ai-thinking-body');
              var _step = document.createElement('div');
              _step.className = 'ai-thinking-step ai-reasoning-step';
              _step.innerHTML = '<span class="step-icon">' + _thinkingIconMap.reasoning + '</span><span class="step-text"><span class="ai-spinner"></span> <span class="ai-reasoning-text"></span></span>';
              _body.appendChild(_step);
              _rt = _step.querySelector('.ai-reasoning-text');
            }
            _rt.textContent = inlineThink[1];
            _th.classList.add('open');
          }
        }

        // 剔除工具调用与思考标签（含流式中尚未闭合的半截标签），避免原始代码暴露；
        // 搜索状态由后续流程以"正在搜索…"占位展示
        text = stripToolMarkup(text)
          .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
          .replace(/<tool_call>(?:(?!<\/tool_call>)[\s\S])*$/i, '')
          .replace(/<think>(?:(?!<\/think>)[\s\S])*$/i, '');

        // 定位 ops 区域：优先 <ops> 标签；其次已配平的裸 JSON / 代码块；再次流式中未闭合的代码围栏。
        // 这样模型就算不用 <ops> 包裹，也不会把原始 JSON 暴露在气泡里。
        var opsStart = -1, opsEnd = -1;
        var m = text.match(/<ops>([\s\S]*?)(<\/ops>|$)/i);
        if (m) {
          opsStart = m.index;
          opsEnd = m.index + m[0].length;
        } else {
          var ex = extractOps(text);
          if (ex) {
            opsStart = ex.start;
            opsEnd = ex.end;
          } else if (((text.match(/```/g) || []).length) % 2 === 1) {
            opsStart = text.lastIndexOf('```');
            opsEnd = text.length;
          }
        }
        if (opsStart < 0) {
          // 有思考容器时，用 appendChild 不会覆盖；无思考容器时也安全
          var mdDiv = document.createElement('div');
          mdDiv.innerHTML = renderMarkdown(text);
          el.appendChild(mdDiv);
          return;
        }
        // ops 之前的文本
        var before = text.substring(0, opsStart);
        if (before.trim()) {
          var beforeDiv = document.createElement('div');
          beforeDiv.style.whiteSpace = 'normal';
          beforeDiv.innerHTML = renderMarkdown(before);
          el.appendChild(beforeDiv);
        }
        // ops 块：流式时显示 placeholder，结束后会被 chips 替换
        if (streaming) {
          var placeholder = document.createElement('div');
          placeholder.className = 'ai-ops-placeholder';
          placeholder.innerHTML = '<span class="ai-spinner"></span> 准备执行操作…';
          el.appendChild(placeholder);
        }
        // ops 之后的内容
        var after = text.substring(opsEnd);
        if (after.trim()) {
          var afterDiv = document.createElement('div');
          afterDiv.style.whiteSpace = 'normal';
          afterDiv.innerHTML = renderMarkdown(after);
          el.appendChild(afterDiv);
        }
      }

      // 把 ops 渲染成 tool call chips（add/remove/update/reorder）
      function renderOpsChips(ops) {
        var container = document.createElement('div');
        container.className = 'ai-tool-calls';

        function makeChip(type, items, detailFn) {
          if (!items || items.length === 0) return;
          var meta = {
            add:     { icon: '+',  label: '添加' },
            remove:  { icon: '−',  label: '删除' },
            update:  { icon: '↻',  label: '更新' },
            reorder: { icon: '⇄', label: '排序' }
          }[type];

          var chip = document.createElement('span');
          chip.className = 'ai-tool-call ' + type;

          var iconSpan = document.createElement('span');
          iconSpan.className = 'ai-tool-icon';
          iconSpan.textContent = meta.icon;

          var labelSpan = document.createElement('span');
          labelSpan.className = 'ai-tool-label';
          labelSpan.textContent = meta.label + (items.length > 1 ? ' ×' + items.length : '');

          chip.appendChild(iconSpan);
          chip.appendChild(labelSpan);

          var detail = detailFn(items);
          if (detail) {
            var detailSpan = document.createElement('span');
            detailSpan.className = 'ai-tool-detail';
            detailSpan.textContent = detail;
            detailSpan.title = detail; // hover 看完整
            chip.appendChild(detailSpan);
          }

          container.appendChild(chip);
        }

        if (Array.isArray(ops.add) && ops.add.length) {
          var names = ops.add.map(function (c) { return c.name; });
          makeChip('add', ops.add, function () {
            var pre = names.slice(0, 3).join(', ');
            return pre + (names.length > 3 ? ' …等 ' + names.length + ' 项' : '');
          });
        }
        if (Array.isArray(ops.remove) && ops.remove.length) {
          makeChip('remove', ops.remove, function () {
            var pre = ops.remove.slice(0, 3).join(', ');
            return pre + (ops.remove.length > 3 ? ' …等 ' + ops.remove.length + ' 项' : '');
          });
        }
        if (Array.isArray(ops.update) && ops.update.length) {
          var descs = ops.update.map(function (u) {
            if (!u || !u.name) return '';
            var keys = Object.keys(u).filter(function (k) { return k !== 'name'; });
            if (keys.length === 0) return u.name;
            var changes = keys.map(function (k) { return k + ': ' + u[k]; }).join(', ');
            return u.name + ' (' + changes + ')';
          }).filter(Boolean);
          makeChip('update', ops.update, function () {
            var pre = descs.slice(0, 2).join('; ');
            return pre + (descs.length > 2 ? ' …等 ' + descs.length + ' 项' : '');
          });
        }
        if (Array.isArray(ops.reorder) && ops.reorder.length) {
          makeChip('reorder', ops.reorder, function () {
            var pre = ops.reorder.slice(0, 4).join(' → ');
            return pre + (ops.reorder.length > 4 ? ' …' : '');
          });
        }

        return container;
      }

      // 解析正文里的 <ops> 并应用到卡片列表（快照 / chips / 撤销按钮），
      // 正常对话与"联网搜索后的最终回答"都会调用它，避免两条链路行为不一致。
      // 返回 true 表示识别到 ops（无论是否真的应用）。
      // 宽松 JSON 解析：先标准 parse，失败再修常见问题（注释 / 尾逗号 / 未加引号的键 / 单引号）
      function parseLooseJson(str) {
        var s = String(str || '').trim();
        if (!s) return undefined;
        try { return JSON.parse(s); } catch (e) {}
        // 去掉 JSON 注释（/* */ 与行首 //；不会碰 https:// 里的 //）
        var t = s
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
          .replace(/,\s*([}\]])/g, '$1')
          .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
        try { return JSON.parse(t); } catch (e) {}
        // 单引号值 → 双引号（只匹配成对的单引号片段，不动双引号字符串内的撇号）
        try { return JSON.parse(t.replace(/'((?:[^'\\]|\\.)*)'/g, '"$1"')); } catch (e) {}
        return undefined;
      }

      // 归一化标准四键的常见变体：add 对象→数组、remove 字符串→数组、update map→数组
      function normalizeOpsObject(obj) {
        var out = {};
        if (obj.add !== undefined) {
          out.add = Array.isArray(obj.add) ? obj.add : (obj.add ? [obj.add] : []);
        }
        if (obj.remove !== undefined) {
          var r = Array.isArray(obj.remove) ? obj.remove : [obj.remove];
          out.remove = r.map(function (p) { return typeof p === 'string' ? p : (p && p.name); }).filter(Boolean);
        }
        if (obj.update !== undefined) {
          if (Array.isArray(obj.update)) out.update = obj.update;
          else if (obj.update && typeof obj.update === 'object') {
            out.update = Object.keys(obj.update).map(function (nm) {
              var v = obj.update[nm];
              return (v && typeof v === 'object') ? Object.assign({ name: nm }, v) : { name: nm, value: v };
            });
          }
        }
        if (obj.reorder !== undefined) {
          out.reorder = Array.isArray(obj.reorder) ? obj.reorder : [obj.reorder];
        }
        return Object.keys(out).length ? out : null;
      }

      // 把任意解析结果强制成 ops 对象（兼容数组/动作数组/单卡片/包裹层/四键变体）
      function coerceOps(obj) {
        if (obj == null) return null;
        if (Array.isArray(obj)) {
          // 动作数组：[{type:'add',card:{...}}, {action:'remove',name:'x'}]
          if (obj.length && obj.every(function (a) {
            return a && typeof a === 'object' && (a.type || a.action || a.op);
          })) {
            var acc = {};
            obj.forEach(function (a) {
              var t = String(a.type || a.action || a.op);
              var payload = a.card || a.item || a.data || a.name || a;
              var arr = Array.isArray(payload) ? payload : [payload];
              if (/add|create/i.test(t)) acc.add = (acc.add || []).concat(arr);
              else if (/remove|delete|del/i.test(t)) acc.remove = (acc.remove || []).concat(arr.map(function (p) { return typeof p === 'string' ? p : (p && p.name); }).filter(Boolean));
              else if (/update|edit|modify/i.test(t)) acc.update = (acc.update || []).concat(arr);
              else if (/reorder|sort|order/i.test(t)) acc.reorder = (acc.reorder || []).concat(arr);
            });
            return Object.keys(acc).length ? acc : null;
          }
          // 卡片数组
          if (obj.length && obj.every(function (x) { return x && typeof x === 'object' && (x.name || x.url); })) return { add: obj };
          return null;
        }
        if (typeof obj !== 'object') return null;
        // 包裹层
        if (obj.ops && typeof obj.ops === 'object') return coerceOps(obj.ops);
        if (obj.actions && Array.isArray(obj.actions)) return coerceOps(obj.actions);
        if (obj.actions && typeof obj.actions === 'object') return coerceOps(obj.actions);
        // 标准四键（含对象/字符串/map 变体）
        var norm = normalizeOpsObject(obj);
        if (norm) return norm;
        // {action:'add', card:{...}} / {type:'add', cards:[...]}
        if (obj.type || obj.action || obj.operation) {
          var t2 = String(obj.type || obj.action || obj.operation);
          var payload2 = obj.card || obj.cards || obj.item || obj.data || obj;
          var arr2 = Array.isArray(payload2) ? payload2 : [payload2];
          if (/add|create/i.test(t2)) return { add: arr2 };
          if (/remove|delete|del/i.test(t2)) return { remove: arr2.map(function (p) { return typeof p === 'string' ? p : (p && p.name); }).filter(Boolean) };
          if (/update|edit|modify/i.test(t2)) return { update: arr2 };
          if (/reorder|sort|order/i.test(t2)) return { reorder: arr2 };
        }
        // 单个卡片
        if (obj.name && (obj.url || obj.icon || obj.iconSrc || obj.letter)) return { add: [obj] };
        return null;
      }

      // 尝试把一段文本解析成 ops 对象
      function tryParseOps(str) {
        var s = String(str || '').trim();
        if (!s) return null;
        var fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
        if (fence) s = fence[1].trim();
        return coerceOps(parseLooseJson(s));
      }

      // 在文本里定位配平的 JSON 对象/数组
      function findBalanced(text, open, close) {
        var s = String(text || '');
        for (var i = 0; i < s.length; i++) {
          if (s.charAt(i) !== open) continue;
          var depth = 0, inStr = false, esc = false, end = -1;
          for (var j = i; j < s.length; j++) {
            var c = s.charAt(j);
            if (inStr) {
              if (esc) esc = false;
              else if (c === '\\') esc = true;
              else if (c === '"') inStr = false;
            } else if (c === '"') {
              inStr = true;
            } else if (c === open) {
              depth++;
            } else if (c === close) {
              depth--;
              if (depth === 0) { end = j + 1; break; }
            }
          }
          if (end > 0) {
            var obj = tryParseOps(s.slice(i, end));
            if (obj) return { start: i, end: end, text: s.slice(i, end), ops: obj };
          }
        }
        return null;
      }

      // 从任意内容中提取 ops：<ops> 标签 / ```json 代码块 / 裸 JSON / JSON 数组 / 单卡片对象。
      // 模型偶尔不按 <ops> 包裹、直接吐 JSON，这里统一兜住。
      function extractOps(content) {
        var s = String(content || '');
        var m = s.match(/<ops>([\s\S]*?)<\/ops>/i);
        if (m) {
          var obj = tryParseOps(m[1]);
          if (obj) return { ops: obj, start: m.index, end: m.index + m[0].length, text: m[0] };
        }
        var fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (fence) {
          var obj2 = tryParseOps(fence[1]);
          if (obj2) return { ops: obj2, start: fence.index, end: fence.index + fence[0].length, text: fence[0] };
        }
        // 整段就是一个 JSON
        var whole = tryParseOps(s);
        if (whole) return { ops: whole, start: 0, end: s.length, text: s };
        return findBalanced(s, '{', '}') || findBalanced(s, '[', ']');
      }

      // 把裸 JSON / 代码块的 ops 规范成 <ops>…</ops>，便于统一渲染与保存
      function normalizeOpsTags(content) {
        var s = String(content || '');
        var tagged = s.match(/<ops>([\s\S]*?)<\/ops>/i);
        if (tagged) {
          var parsed = parseLooseJson(tagged[1]);
          var ops = coerceOps(parsed);
          if (!ops) return s;
          return s.slice(0, tagged.index) + '<ops>' + JSON.stringify(ops) + '</ops>' + s.slice(tagged.index + tagged[0].length);
        }
        var ex = extractOps(s);
        if (!ex) return s;
        return s.slice(0, ex.start) + '<ops>' + JSON.stringify(ex.ops) + '</ops>' + s.slice(ex.end);
      }

      // 深度思考兜底：正文里没有 ops，但思考流(reasoning_content)里有显式 <ops> 标签时并入。
      // 只认带标签的，避免把思考里的示例 JSON 误当指令。
      function mergeReasoningOps(content, reasoning) {
        var s = String(content || '');
        if (extractOps(s)) return s;
        var m = String(reasoning || '').match(/<ops>[\s\S]*?<\/ops>/i);
        if (m) return (s ? s + '\n' : '') + m[0];
        return s;
      }

      // 是否"修改卡片"意图（纠错重试的门控）：查询类返回 false
      function wantsCardChange(t) {
        var s = String(t || '');
        if (!s) return false;
        if (/(哪些|有哪些|有没有|是什么|在不在|多少|查询|列出|告诉|介绍|怎么用)/.test(s)) return false;
        return /(加|添加|新增|删|删除|移除|改|换|更新|设置|重命名|改名|移到|移动|置顶|排序|整理|颜色|图标|卡片|快捷方式|网址|url)/i.test(s);
      }

      // 只有当模型"明显尝试输出 ops 却格式坏了"时才值得纠错重试；
      // 纯文字回答（如"已存在，无需添加"）不能重试，否则会逼出重复 ops。
      function looksLikeOpsAttempt(s) {
        var t = String(s || '');
        if (!t) return false;
        if (/<ops\b/i.test(t)) return true;
        if (t.indexOf('```') !== -1) return true;
        if (/["']?(add|remove|update|reorder)["']?\s*[:：]/i.test(t)) return true;
        return false;
      }

      function applyOpsFromContent(content, bubble) {
        var ex = extractOps(content);
        if (!ex) return false;
        var ops = ex.ops;

        // 防御性校验
        if (typeof ops !== 'object' || ops === null) throw new Error('ops 格式错误');
        var addArr = Array.isArray(ops.add) ? ops.add : [];
        var removeArr = Array.isArray(ops.remove) ? ops.remove : [];
        var updateArr = Array.isArray(ops.update) ? ops.update : [];
        var reorderArr = Array.isArray(ops.reorder) ? ops.reorder : null;

        function safeNormalizeCardUrl(u) {
          var s = String(u || '').trim();
          if (!s || /^\s*(?:javascript|data|vbscript):/i.test(s)) return '';
          if (cards.normalizeUrl) return cards.normalizeUrl(s);
          if (/^(file|mailto|about|chrome|chrome-extension|ftp|https?):/i.test(s)) return s;
          return 'http://' + s;
        }
        addArr = addArr.map(function (a2) {
          if (!a2 || !a2.name || !a2.url) return null;
          var normUrl = safeNormalizeCardUrl(a2.url);
          if (!normUrl) return null;
          return Object.assign({}, a2, { url: normUrl });
        }).filter(Boolean);
        addArr.forEach(function (a2) {
          if (!a2.iconSrc) a2.iconSrc = 'auto';
          if (a2.iconSrc === 'auto' && !a2.color) a2.color = 'blue';
        });

        // 从当前 list 出发，按 ops 应用 diff（没提到的字段原样保留）
        // 注意：必须逐项拷贝，浅拷贝 slice() 会让 update 原地改到 list 共享对象，
        // 进而污染下方用于撤销的快照（update 类操作将无法正确撤销）。
        var newList = cards.list.map(function (it) { return Object.assign({}, it); });
        var nameIndex = {};
        function reindex() {
          nameIndex = {};
          newList.forEach(function (it, idx) { nameIndex[it.name] = idx; });
        }
        reindex();

        // remove: 按 name 删
        removeArr.forEach(function (nm) {
          if (nameIndex[nm] !== undefined) {
            newList.splice(nameIndex[nm], 1);
            reindex();
          }
        });

        // update: 按 name 合并字段；newName / rename 才改显示名
        updateArr.forEach(function (u) {
          if (!u || !u.name) return;
          var idx2 = nameIndex[u.name];
          if (idx2 === undefined) return;
          var nextName = u.newName || u.rename;
          if (nextName && nextName !== u.name && nameIndex[nextName] === undefined) {
            newList[idx2].name = nextName;
            reindex();
            idx2 = nameIndex[nextName];
          }
          var keys = Object.keys(u);
          for (var ki = 0; ki < keys.length; ki++) {
            var k = keys[ki];
            if (k === 'name' || k === 'newName' || k === 'rename') continue;
            if (k === 'url' && typeof u[k] === 'string' && u[k].trim()) {
              var normU = safeNormalizeCardUrl(u[k]);
              if (normU) newList[idx2][k] = normU;
              continue;
            }
            newList[idx2][k] = u[k];
          }
        });

        // add: 已有同名则跳过，追加到末尾
        var addedNames = {};
        addArr.forEach(function (c) {
          if (nameIndex[c.name] !== undefined) return;
          newList.push(c);
          addedNames[c.name] = true;
          reindex();
        });

        // reorder: 按给定名字顺序重排（不重命名，只重排现有项；新加的不在列表里时自动忽略）
        if (reorderArr && reorderArr.length > 0) {
          var orderMap = {};
          reorderArr.forEach(function (nm, idx3) { orderMap[nm] = idx3; });
          newList.sort(function (a, b) {
            var ai = orderMap[a.name];
            var bi = orderMap[b.name];
            if (ai === undefined && bi === undefined) return 0;
            if (ai === undefined) return 1; // 未列出的放后面
            if (bi === undefined) return -1;
            return ai - bi;
          });
        }

        // 危险操作检测：删超过 3 个、或者几乎清空（剩不到 2 个）
        var willDelete = removeArr.length;
        if (shouldConfirmBulkDelete() && (willDelete > 3 || (newList.length < 2 && cards.list.length > 0 && willDelete > 0))) {
          var msg = 'AI 准备删除 ' + willDelete + ' 个卡片，剩余 ' + newList.length + ' 个。\n确定要执行吗？';
          if (!confirm(msg)) {
            if (bubble) {
              bubble.classList.add('ai-msg-cancelled');
              var cancelTag = document.createElement('div');
              cancelTag.className = 'ai-cancel-tag';
              cancelTag.textContent = '已取消应用';
              bubble.appendChild(cancelTag);
            }
            return true;
          }
        }

        if (JSON.stringify(newList) === JSON.stringify(cards.list)) {
          showAIToast('没有需要应用的改动');
          return true;
        }

        // 每条操作一份快照；同时写旧键，兼容只认 newtab.ai.snapshot.v1 的撤销
        var snapId = '';
        var before = cards.list.map(function (it) { return Object.assign({}, it); });
        var snap = { list: before, time: Date.now() };
        try {
          var map = {};
          try { map = JSON.parse(localStorage.getItem('newtab.ai.snapshots.v1') || '{}') || {}; } catch (e1) { map = {}; }
          snapId = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          map[snapId] = snap;
          var snapKeys = Object.keys(map);
          while (snapKeys.length > 30) { delete map[snapKeys.shift()]; }
          localStorage.setItem('newtab.ai.snapshots.v1', JSON.stringify(map));
          localStorage.setItem(AI_SNAPSHOT_KEY, JSON.stringify(snap));
        } catch (e) {}
        pendingSnapshotId = snapId;

        cards.list = newList;
        var savedOk = save(cards.list);
        render(cards.list);

        // 自动抓图标写回新卡：同名时优先对上网址，避免打到旧卡
        addArr.forEach(function (c) {
          if (c.iconSrc !== 'auto' || !addedNames[c.name]) return;
          var cardEls = nav.querySelectorAll('.shortcut');
          var hit = null;
          for (var ci = 0; ci < cardEls.length; ci++) {
            var card = cardEls[ci];
            var label = card.querySelector('.label');
            if (!label || label.textContent !== c.name) continue;
            if (c.url && card.getAttribute('href') === c.url) { hit = card; break; }
            hit = card;
          }
          if (hit) applyAutoIcon(hit, Array.prototype.indexOf.call(cardEls, hit), c.color || 'blue');
        });

        // 保存结果用轻提示反馈，不再往气泡里插技术性状态行
        showAIToast(savedOk ? '已应用 AI 的修改' : '修改已应用，但保存失败（存储空间不足？）');

        // 把流式时的 placeholder 换成实际的 tool call chips
        if (bubble) {
          var chips = renderOpsChips(ops);
          var oldPlaceholder = bubble.querySelector('.ai-ops-placeholder');
          if (oldPlaceholder) {
            oldPlaceholder.replaceWith(chips);
          } else {
            bubble.appendChild(chips);
          }
        }

        // 在气泡底部加"撤销"按钮
        // 点击处理统一由 aiMessages 上的事件委托（applyAIUndo）负责：
        // 若把 onclick 直接绑在按钮上，保存历史时 innerHTML 序列化会丢失该 handler，
        // 重进页面/重开面板后按钮会变成"点了没反应"的僵尸按钮。
        if (bubble) {
          var undoBtn = document.createElement('button');
          undoBtn.type = 'button';
          undoBtn.className = 'ai-undo-btn';
          undoBtn.textContent = '↶ 撤销这次操作';
          if (snapId) undoBtn.setAttribute('data-snap', snapId);
          bubble.appendChild(undoBtn);
        }
        return true;
      }

      aiFab.addEventListener('click', function () { toggleAI(true); });
      aiClose.addEventListener('click', function () { toggleAI(false); });
      aiOverlay.addEventListener('click', function () { toggleAI(false); });
      document.getElementById('aiClear').addEventListener('click', function () {
        if (aiSending) return;
        // 破坏性操作：仅在有历史时二次确认，防止误触
        if (aiHistory.length > 1 && !confirm('确定清空全部对话？清空后不可恢复。')) return;
        clearAIConversation();
        showAIToast('对话已清空');
      });

      // AI 配置：独立弹窗（Esc / 遮罩 / 关闭按钮由主模块的 modal-mask 逻辑处理）
      var aiConfigModal = document.getElementById('aiConfigModal');
      var aiConfigToggle = document.getElementById('aiConfigToggle');
      function syncConfigBtn() {
        if (!aiConfigToggle || !aiConfigModal) return;
        aiConfigToggle.classList.toggle('active', aiConfigModal.classList.contains('open'));
      }
      if (aiConfigToggle && aiConfigModal) {
        aiConfigToggle.addEventListener('click', function () {
          aiConfigModal.classList.add('open');
          aiConfigModal.setAttribute('aria-hidden', 'false');
          syncConfigBtn();
          if (aiEndpoint) setTimeout(function () { aiEndpoint.focus(); }, 30);
        });
        aiConfigModal.addEventListener('click', function () { setTimeout(syncConfigBtn, 0); });
        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') setTimeout(syncConfigBtn, 0);
        });
      }

      // 清空对话
      function clearAIConversation() {
        if (aiSending) return;
        aiHistory = [{ role: 'system', content: buildSystemPrompt() }];
        saveAIHistory();
        renderAIHistory();
      }

      // ========== AI 撤销（事件委托，避免历史重渲染后 handler 丢失） ==========

      // 把按钮标记为已撤销状态
      function markUndone(undoBtn) {
        undoBtn.disabled = true;
        undoBtn.textContent = '✓ 已撤销';
        undoBtn.classList.add('ai-undo-done');
      }

      // 执行撤销：恢复快照 → 标记已撤销 → 自动以原指令重发（触发新一轮联网搜索）
      function applyAIUndo(undoBtn) {
        try {
          var snap = null;
          var id = undoBtn.getAttribute('data-snap');
          if (id) {
            var map = {};
            try { map = JSON.parse(localStorage.getItem('newtab.ai.snapshots.v1') || '{}') || {}; } catch (e1) { map = {}; }
            snap = map[id] || null;
            if (snap) {
              delete map[id];
              localStorage.setItem('newtab.ai.snapshots.v1', JSON.stringify(map));
            }
          }
          var legacy = null;
          try { legacy = JSON.parse(localStorage.getItem(AI_SNAPSHOT_KEY) || 'null'); } catch (e2) { legacy = null; }
          if (!snap) snap = legacy;
          if (!snap || !Array.isArray(snap.list)) {
            markUndone(undoBtn);
            return;
          }
          cards.list = snap.list;
          save(cards.list);
          render(cards.list);
          if (!id || (legacy && JSON.stringify(legacy.list) === JSON.stringify(snap.list))) {
            localStorage.removeItem(AI_SNAPSHOT_KEY);
          }
          markUndone(undoBtn);
          showAIToast('已撤销，卡片恢复到操作前');
        } catch (e) {
          undoBtn.textContent = '撤销失败';
        }
      }

      // 事件委托：实时创建或历史重渲染出来的 .ai-undo-btn 都能正常响应点击
      aiMessages.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('.ai-undo-btn') : null;
        if (btn) applyAIUndo(btn);
      });

      aiSend.addEventListener('click', sendAI);

      aiInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendAI();
        }
      });

      aiInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 140) + 'px';
      });

      // 回到底部：消息区向上滚离底部一段距离时出现
      function updateScrollBtn() {
        if (!aiScrollBottom) return;
        var far = aiMessages.scrollHeight - aiMessages.scrollTop - aiMessages.clientHeight > 160;
        aiScrollBottom.classList.toggle('show', far);
      }
      if (aiScrollBottom) {
        aiMessages.addEventListener('scroll', updateScrollBtn);
        aiScrollBottom.addEventListener('click', function () {
          try {
            aiMessages.scrollTo({ top: aiMessages.scrollHeight, behavior: 'smooth' });
          } catch (e) {
            aiMessages.scrollTop = aiMessages.scrollHeight;
          }
        });
      }

      // 统一收尾：任何路径结束都复位发送态（避免卡在"处理中…"）
      function endAISend() {
        aiSending = false;
        aiSend.disabled = false;
        aiSend.textContent = '发送';
      }

      function pushAssistant(content) {
        var msg = { role: 'assistant', content: content };
        if (pendingSnapshotId) {
          msg.snapshotId = pendingSnapshotId;
          pendingSnapshotId = null;
        }
        aiHistory.push(msg);
      }

      function sendAI() {
        // 并发门禁：处理中忽略再次发送（含 Enter 连按），避免两条流水线互相踩状态
        if (aiSending) return;
        var text = aiInput.value.trim();
        if (!text) return;

        var endpoint = aiEndpoint.value.trim();
        var key = aiKey.value.trim();
        var model = aiModel.value.trim() || 'deepseek-flash';

        if (!endpoint || !key) {
          addAIMessage('请先点击右上角 ⚙ 打开配置窗口，填写 API 地址和密钥。', 'error');
          return;
        }
        pendingSnapshotId = null;

        var self = this;

        function doSend(searchContext) {
        // 更新 system prompt 中的卡片列表
        aiHistory[0].content = buildSystemPrompt();

        var userContent = searchContext ? text + '\n\n【联网搜索结果】\n' + searchContext : text;

        // 加入用户消息
        aiHistory.push({ role: 'user', content: userContent });
        saveAIHistory();

        // 渲染用户消息
        var userDiv = document.createElement('div');
        userDiv.className = 'ai-msg ai-msg-user';
        userDiv.textContent = text;
        aiMessages.appendChild(userDiv);
        aiMessages.scrollTop = aiMessages.scrollHeight;

        aiInput.value = '';
        aiInput.style.height = 'auto';

        aiSending = true;
        aiSend.disabled = true;
        aiSend.textContent = '处理中…';

        // 智能拼接 API URL：
        //   - 完整路径（含 /chat/completions）→ 直接用
        //   - 路径里已有 /v1、/v4 等版本号 → 只补 /chat/completions
        //   - 只有域名 → 补 /v1/chat/completions（OpenAI 风格）
        var url = buildChatUrl(endpoint);

        // 联网搜索：工具调用相关
        var deepThinkingOn = aiDeepSearch && aiDeepSearch.checked;
        var webSearchEnabled = aiWebSearch && aiWebSearch.checked && providerReady();
        var pendingToolCallId = null;
        var pendingToolCallName = null;
        var pendingToolCallArgs = '';
        var reasoningAccum = '';          // 深度思考：推理内容累积（局部变量，避免竞态）
        var followReasoningAccum = '';    // 联网搜索后续请求的推理内容（需在外层作用域，供收尾 .then 使用）
        var reasoningTextEl = null;       // 深度思考：缓存推理文本 DOM 引用
        var followReasoningTextEl = null; // 联网搜索后第二轮推理文本 DOM 引用
        var searchResultCount = 0;        // 本轮联网搜索命中的结果数（写入历史用于回显）
        var streamFailed = false;         // 首轮流式是否已失败（失败后不再走后续流程，避免错误气泡被覆盖）
        var opsRetried = false;           // 是否已做过一次"格式纠错重试"
        var searchChipParts = [];         // 多轮搜索产生的 chip JSON（写入历史）
        var AI_MAX_SEARCH_ROUNDS = maxSearchRounds();     // 单轮对话最多搜索几次（防模型死循环）

        function consumeChatResponse(res, opts) {
          var ct = '';
          try { if (res.headers && res.headers.get) ct = String(res.headers.get('content-type') || ''); } catch (e) {}
          var canStream = isStreamEnabled() && res.body && typeof res.body.getReader === 'function' && !(/application\/json/i.test(ct));
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

        // P1：格式纠错——问模型要一次"只给 <ops> 块"。仅修改意图且首次没解析到 ops 时调用。
        // 完全内部化：用完即从历史移除，绝不污染后续轮次；若模型判断无需改动则整个作废、保留首轮回答。
        function retryOpsOnce() {
          opsRetried = true;
          var correctionMsg = {
            role: 'user', hidden: true,
            content: '【系统校验】你上一条回复没有包含可解析的 <ops> 操作块。' +
              (accumulated ? '你上一条的原文是：\n' + String(accumulated).slice(0, 1500) + '\n' : '') +
              '如果确实需要修改卡片，请只输出一个可解析的 <ops>{"add":[],"remove":[],"update":[],"reorder":[]}</ops>，放在回复末尾；' +
              '如果不需要改动卡片（例如卡片已存在、缺少网址、指令不清），只回复“无需改动”，不要输出 <ops>。不要解释、不要代码块、不要裸 JSON。'
          };
          aiHistory.push(correctionMsg);
          saveAIHistory();

          var retryBody = buildChatBody(model, toApiMessages(aiHistory), endpoint);

          var retryAccum = '';
          return fetch(url, {
            method: 'POST',
            headers: buildChatHeaders(key),
            body: JSON.stringify(retryBody),
            signal: AbortSignal.timeout(timeoutMs())
          }).then(function (res) {
            if (!res.ok) return res.text().then(function (t) { throw new Error('HTTP ' + res.status + '：' + String(t).slice(0, 200)); });
            return consumeChatResponse(res, {
              onContent: function (c) { retryAccum += c; }
            });
          }).then(function () {
            // 关键：内部纠错消息用完即删，避免污染后续用户请求（否则下一轮会被"系统校验"带偏）
            var idx = aiHistory.indexOf(correctionMsg);
            if (idx !== -1) aiHistory.splice(idx, 1);
            saveAIHistory();

            // 只认 ops：没有 ops（含"无需改动"）就整个作废，保留首轮回答，不留下任何痕迹
            var normalized = normalizeOpsTags(retryAccum);
            if (extractOps(normalized)) {
              accumulated = normalized;
              renderStreamBubble(bubble, accumulated, false);
              applyOpsFromContent(accumulated, bubble);
              if (window.console && console.log) console.log('[AI] ← 纠错重试结果:', accumulated);
            }
          });
        }

        // 基于当前 aiHistory 发起后续请求并读入 accumulated（含第二轮思考展示）
        function streamFollowUp() {
          var body = buildChatBody(model, toApiMessages(aiHistory), endpoint);
          return fetch(url, {
            method: 'POST',
            headers: buildChatHeaders(key),
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs())
          }).then(function (res) {
            if (!res.ok) return res.text().then(function (t) { throw new Error('后续请求 HTTP ' + res.status + '：' + String(t).slice(0, 200)); });
            return consumeChatResponse(res, {
              onContent: function (c) {
                accumulated += c;
                renderStreamBubble(bubble, accumulated, true);
                aiMessages.scrollTop = aiMessages.scrollHeight;
              },
              onReasoning: function (rc) {
                followReasoningAccum += rc;
                if (deepThinkingOn) {
                  var th = bubble.querySelector('.ai-thinking');
                  if (th) {
                    if (!followReasoningTextEl) {
                      var st = addThinkingStep(th, 'reasoning', '<span class="ai-spinner"></span> <span class="ai-reasoning-text"></span>');
                      if (st) followReasoningTextEl = st.querySelector('.ai-reasoning-text');
                    }
                    if (followReasoningTextEl) followReasoningTextEl.textContent = followReasoningAccum;
                    aiMessages.scrollTop = aiMessages.scrollHeight;
                  }
                }
              }
            });
          });
        }

        // 执行一轮"搜索 + 让模型基于结果作答"，可递归支持多轮搜索
        function runSearchRound(query, round) {
          lastSearchQuery = String(query || '');
          try { localStorage.setItem('newtab.ai.lastQuery.v1', lastSearchQuery); } catch (e) {}
          if (window.console && console.log) console.log('[AI] 搜索第 ' + round + ' 轮：', query);
          var qEsc = String(query).replace(/</g, '&lt;');
          var searchStepEl = null;
          if (deepThinkingOn) {
            var th = bubble.querySelector('.ai-thinking');
            if (!th) { th = createThinkingEl(); bubble.appendChild(th); }
            bubble.style.whiteSpace = 'normal';
            searchStepEl = addThinkingStep(th, 'search', '<span class="ai-spinner"></span> 搜索：<strong>' + qEsc + '</strong>');
          } else {
            bubble.style.whiteSpace = 'normal';
            var ss = document.createElement('div');
            ss.className = 'ai-ops-placeholder';
            ss.innerHTML = '<span class="ai-spinner"></span> 正在搜索: ' + qEsc + '…';
            bubble.appendChild(ss);
          }
          aiMessages.scrollTop = aiMessages.scrollHeight;

          return fetchWebSearch(query).then(function (r) {
            if (r.failed) {
              var detail = describeSearchError(r.error);
              var safe = escapeSearchHtml(detail);
              if (searchStepEl) {
                var t1 = searchStepEl.querySelector('.step-text');
                if (t1) t1.innerHTML = '搜索失败：' + safe;
              }
              var searching = bubble.querySelector('.ai-ops-placeholder');
              if (searching) searching.innerHTML = '搜索失败：' + safe;
              var failNote = bubble.querySelector('.ai-search-fail');
              if (!failNote) {
                failNote = document.createElement('div');
                failNote.className = 'ai-search-fail ai-thinking-step';
                bubble.appendChild(failNote);
              }
              failNote.textContent = '搜索失败：' + detail;
            } else {
              var oldFail = bubble.querySelector('.ai-search-fail');
              if (oldFail) oldFail.remove();
              searchResultCount = r.resultCount;
              if (searchStepEl) {
                var t2 = searchStepEl.querySelector('.step-text');
                if (t2) t2.innerHTML = '搜索：<strong>' + qEsc + '</strong>（<strong>' + r.resultCount + '</strong> 个结果）';
              } else if (thinkingElForRound()) {
                addThinkingStep(thinkingElForRound(), 'result', '搜索完成，找到 <strong>' + r.resultCount + '</strong> 条相关结果');
              }
            }
            // 记录搜索 chip（多轮时全部保留）
            searchChipParts.push(JSON.stringify({ type: 'web_search', query: String(query), count: r.resultCount }));

            aiHistory.push({
              role: 'user',
              hidden: true,
              content: r.failed
                ? searchFailurePrompt(describeSearchError(r.error))
                : '【联网搜索结果】\n搜索词：' + query + '\n' + (r.searchContext || '未找到相关搜索结果。') +
                  '\n请基于以上搜索结果回答。若用户还要求添加或修改快捷方式，在回答末尾给出 <ops>。' + (shouldCiteSources() ? '引用处标注来源编号（如 [1]）；' : '') + '不要编造。'
            });
            saveAIHistory();

            // 保留思考容器，清空气泡正文，准备接收回答（后续轮次思考沿用同一容器/步骤）
            var savedThinking = bubble.querySelector('.ai-thinking');
            var savedFail = bubble.querySelector('.ai-search-fail');
            accumulated = '';
            pendingToolCallId = null;
            pendingToolCallName = null;
            pendingToolCallArgs = '';
            bubble.innerHTML = '';
            if (savedThinking) bubble.appendChild(savedThinking);
            if (savedFail) bubble.appendChild(savedFail);
            var tidy = document.createElement('div');
            tidy.className = 'ai-ops-placeholder';
            tidy.innerHTML = '<span class="ai-spinner"></span> 正在整理回答…';
            bubble.appendChild(tidy);

            return streamFollowUp().then(function () {
              // 多轮：模型若继续要求搜索（含 <search> 等别名），且未超上限，则再来一轮
              var more = normalizeDSML(accumulated).match(/<web_search>\s*([\s\S]*?)\s*<\/web_search>/i);
              if (more && more[1] && round < AI_MAX_SEARCH_ROUNDS) {
                accumulated = stripToolMarkup(accumulated);
                return runSearchRound(more[1].trim(), round + 1);
              }
            });
          });
        }

        function thinkingElForRound() { return bubble ? bubble.querySelector('.ai-thinking') : null; }

        var reqBody = buildChatBody(model, toApiMessages(aiHistory), endpoint);
        // 深度思考的请求字段由 buildChatBody 按厂商写入。界面上的思考容器仍看底栏开关。
        // 联网搜索：刻意不使用 OpenAI 原生 tools。
        // 原因：DeepSeek 在思考模式下时好时坏（有时返回结构化 tool_calls，有时把调用写成
        // DSML/<tool_calls> 文本，还要求回传 reasoning_content，否则 400），极不稳定。
        // 改为自有的文本协议 <web_search>关键词</web_search>（见 buildSystemPrompt），
        // 由本地解析并执行搜索，前后端只认一种格式。
        // Debug：F12 控制台能看到实际发的请求
        if (window.console && console.log) {
          console.log('[AI] →', url);
          console.log('[AI] → body:', JSON.stringify(reqBody, null, 2));
        }

        // 创建助手气泡
        var bubble = document.createElement('div');
        bubble.className = 'ai-msg ai-msg-assistant';
        aiMessages.appendChild(bubble);
        aiMessages.scrollTop = aiMessages.scrollHeight;

        // 深度思考：仅在开启时创建思考容器接收 reasoning_content
        if (deepThinkingOn === true) {
          var _dtEl = createThinkingEl();
          bubble.appendChild(_dtEl);
          bubble.style.whiteSpace = 'normal';
        }

        var accumulated = '';

        fetch(url, {
          method: 'POST',
          headers: buildChatHeaders(key),
          body: JSON.stringify(reqBody),
          signal: AbortSignal.timeout(timeoutMs())
        }).then(function (res) {
          if (!res.ok) {
            return res.text().then(function (t) { throw new Error('HTTP ' + res.status + ': ' + t); });
          }
          return consumeChatResponse(res, {
            onFirstDelta: function (delta) {
              if (window.console && console.log && !window.__aiLoggedFirst) {
                window.__aiLoggedFirst = true;
                console.log('[AI] ← first delta:', JSON.stringify(delta, null, 2));
              }
            },
            onContent: function (c) {
              if (!bubble) return;
              accumulated += c;
              renderStreamBubble(bubble, accumulated, true);
              aiMessages.scrollTop = aiMessages.scrollHeight;
            },
            onReasoning: function (rc) {
              reasoningAccum += rc;
              if (deepThinkingOn && bubble) {
                var _rcEl = bubble.querySelector('.ai-thinking-body');
                if (_rcEl) {
                  if (reasoningTextEl) {
                    reasoningTextEl.textContent = reasoningAccum;
                  } else {
                    var _newStep = addThinkingStep(bubble.querySelector('.ai-thinking'), 'reasoning',
                      '<span class="ai-spinner"></span> <span class="ai-reasoning-text">' + reasoningAccum.replace(/</g, '&lt;') + '</span>');
                    if (_newStep) reasoningTextEl = _newStep.querySelector('.ai-reasoning-text');
                  }
                  aiMessages.scrollTop = aiMessages.scrollHeight;
                }
              }
            },
            onToolCalls: function (tcs) {
              for (var tci = 0; tci < tcs.length; tci++) {
                var tc = tcs[tci];
                if (tc.id) pendingToolCallId = tc.id;
                if (tc.function) {
                  if (tc.function.name) pendingToolCallName = tc.function.name;
                  if (tc.function.arguments) pendingToolCallArgs += tc.function.arguments;
                }
              }
            }
          });
        }).catch(function (err) {
          streamFailed = true;
          var errMsg = '对话请求失败：' + (err && err.message ? err.message : err);
          if (bubble) {
            // 清理深度思考容器
            var _errThinking = bubble.querySelector('.ai-thinking');
            if (_errThinking) finishThinking(_errThinking);
            reasoningTextEl = null;
            bubble.innerHTML = renderMarkdown(errMsg);
            bubble.style.whiteSpace = 'normal';
            bubble.className = 'ai-msg ai-msg-error';
          }
          aiHistory.push({ role: 'assistant', content: errMsg });
          saveAIHistory();
        }).then(function () {
          // 首轮已失败：错误气泡与历史已写好，直接结束，不要再走搜索/正常流程覆盖它
          if (streamFailed) { endAISend(); return; }
          // 联网搜索：检测模型是否输出了 <web_search>关键词</web_search>，有则执行搜索。
          // 兼容历史：若旧模型仍返回结构化 delta.tool_calls 或 DSML/<tool_calls> 文本，也一并识别。
          if (webSearchEnabled && !(pendingToolCallName === 'web_search' && pendingToolCallArgs)) {
            // 模型可能把标记写在 content，也可能写在 reasoning_content，两边都扫。
            var _textTc = parseTextToolCall(accumulated) || parseTextToolCall(reasoningAccum);
            if (_textTc && _textTc.name === 'web_search' && _textTc.query) {
              pendingToolCallName = 'web_search';
              pendingToolCallArgs = JSON.stringify({ query: _textTc.query });
              // 从正文/思考中剔除原始标签，避免展示/保存原始代码
              accumulated = stripToolMarkup(accumulated);
              reasoningAccum = stripToolMarkup(reasoningAccum);
            }
          }
          if (webSearchEnabled && pendingToolCallName === 'web_search' && pendingToolCallArgs) {
            var _tcArgs = null;
            try { _tcArgs = JSON.parse(pendingToolCallArgs); } catch (e) { console.warn('[AI] 工具参数解析失败:', e); }
            if (_tcArgs) {
              return runSearchRound(_tcArgs.query || text, 1).then(function () {
                // 收尾：规范化 ops、渲染、应用、落盘
                accumulated = normalizeOpsTags(mergeReasoningOps(accumulated, reasoningAccum));
                renderStreamBubble(bubble, accumulated, false);
                var _bt = bubble.querySelector('.ai-thinking');
                if (_bt) finishThinking(_bt);
                applyOpsFromContent(accumulated, bubble);

                // 气泡里保留联网搜索记录（与重开面板时的 chip 一致）
                if (bubble && searchChipParts.length) {
                  var chipsWrap = document.createElement('div');
                  chipsWrap.className = 'ai-search-chips';
                  searchChipParts.forEach(function (p) {
                    var obj = {};
                    try { obj = JSON.parse(p); } catch (e) {}
                    var chip = document.createElement('span');
                    chip.className = 'ai-search-chip';
                    chip.title = '已联网搜索「' + obj.query + '」' + (obj.count ? '，找到 ' + obj.count + ' 个结果' : '');
                    chip.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2.2"/><path d="M20.5 20.5l-4.3-4.3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg><span></span>';
                    chip.querySelector('span').textContent = obj.query + (obj.count ? '（' + obj.count + ' 个结果）' : '');
                    chipsWrap.appendChild(chip);
                  });
                  bubble.appendChild(chipsWrap);
                }

                // 思考记录：合并首轮推理与搜索后的推理，一起写入历史
                var allReasoning = [reasoningAccum, followReasoningAccum].filter(Boolean).join('\n');
                var finalContent = '';
                if (allReasoning) finalContent += '<think>' + stripToolMarkup(allReasoning) + '</think>\n';
                searchChipParts.forEach(function (chip) { finalContent += '<tool_call>' + chip + '</tool_call>\n'; });
                finalContent += stripToolMarkup(accumulated)
                  .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
                  .replace(/<tool_call>(?:(?!<\/tool_call>)[\s\S])*$/i, '');
                pushAssistant(finalContent);
                saveAIHistory();
                endAISend();
              }).catch(function (fErr) {
                var fErrMsg = '联网搜索后回答失败：' + (fErr && fErr.message ? fErr.message : fErr);
                if (bubble) {
                  bubble.innerHTML = renderMarkdown(fErrMsg);
                  bubble.style.whiteSpace = 'normal';
                  bubble.className = 'ai-msg ai-msg-error';
                }
                reasoningTextEl = null;
                var _et = bubble.querySelector('.ai-thinking');
                if (_et) finishThinking(_et);
                aiHistory.push({ role: 'assistant', content: fErrMsg });
                saveAIHistory();
                endAISend();
              });
            }
          }

          // 正常流程（无工具调用）
          // 思考完成收起：同时覆盖 reasoning_content 与内联 <think> 两种来源
          if (bubble) {
            var _dtDone = bubble.querySelector('.ai-thinking');
            if (_dtDone) finishThinking(_dtDone);
          }

          // 深度思考兜底：ops 若只出现在 reasoning_content 里，也要能应用
          accumulated = mergeReasoningOps(accumulated, reasoningAccum);

          if (!accumulated) {
            aiSending = false;
            aiSend.disabled = false;
            aiSend.textContent = '发送';
            return;
          }

          // Debug：原始输出（排查格式问题时看这一行）
          if (window.console && console.log) console.log('[AI] ← final content:', accumulated);

          // 模型若没按 <ops> 包裹、直接吐 JSON，先规范成 <ops> 再渲染/应用
          accumulated = normalizeOpsTags(accumulated);

          // 重新渲染气泡（流式结束，折叠区设为收起状态）
          renderStreamBubble(bubble, accumulated, false);

          // 提取 <ops> 并应用 diff（不是重写整张列表，模型只描述"做了什么改动"）
          var opsApplied = applyOpsFromContent(accumulated, bubble);

          // 保存 AI 回复到历史：只存纯文本 + 语义标签，不存渲染后的 HTML 快照，
          // 这样样式改动后旧消息也会用最新样式重新渲染。
          var finalizeNormal = function () {
            var finalContent = stripToolMarkup(accumulated)
              .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
              .replace(/<tool_call>(?:(?!<\/tool_call>)[\s\S])*$/i, '');
            if (reasoningAccum) {
              finalContent = '<think>' + stripToolMarkup(reasoningAccum) + '</think>\n' + finalContent;
            }
            // 注意：普通（无工具调用）回复不回传 reasoning_content —— 旧版 reasoner 会因此 400
            pushAssistant(finalContent);
            saveAIHistory();
            endAISend();
          };

          // P1：修改意图但第一次没解析到 ops → 自动纠错重试一轮（最多一次）
          if (!opsApplied && !opsRetried && wantsCardChange(text) && looksLikeOpsAttempt(accumulated)) {
            if (window.console && console.log) console.log('[AI] 未解析到 ops，触发一次纠错重试');
            return retryOpsOnce().then(finalizeNormal).catch(function (e) {
              console.warn('[AI] 纠错重试失败:', e);
              finalizeNormal();
            });
          }
          finalizeNormal();
        }).catch(function (lateErr) {
          // 兜底：后段异常（如 ops JSON 解析失败）不应让发送按钮卡死在"处理中"
          console.warn('[AI] 处理异常:', lateErr);
          if (bubble && !bubble.querySelector('.ai-undo-btn')) {
            var lateTag = document.createElement('div');
            lateTag.className = 'ai-cancel-tag';
            lateTag.textContent = '操作应用失败：' + lateErr.message;
            bubble.appendChild(lateTag);
          }
          endAISend();
        });
      } // end of doSend

        try {
          doSend('');
        } catch (e) {
          console.warn('[AI] 发送异常:', e);
          addAIMessage('发送失败：' + e.message, 'error');
          endAISend();
        }
      }


  window.__motuo.toggleAI = toggleAI;
})();
