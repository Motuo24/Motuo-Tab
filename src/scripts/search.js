/* ========================================================================
     * IIFE 1: 搜索模块
     * ====================================================================== */
    (function () {
      var form = document.getElementById('searchForm');
      var input = document.getElementById('searchInput');
      var trigger = document.getElementById('engineTrigger');
      var selector = document.getElementById('engineSelector');
      if (!form || !input || !trigger || !selector) return;

      // -------- CONFIG（搜索模块常量集中地） --------
      var ENGINE_KEY = 'newtab.engine.v1';
      var CUSTOM_ENGINES_KEY = 'newtab.customEngines.v1';
      var HISTORY_KEY = 'newtab.searchHistory.v1';
      var SITEDIRECT_KEY = 'newtab.sitedirect.v1';
      var SUGGEST_ONLINE_KEY = 'newtab.suggestOnline.v1'; // 联网搜索建议开关（默认开，'0'=关）
      var ONLINE_MAX = 8;          // 联网建议最多展示条数
      var SUGGEST_DEBOUNCE = 200;  // 联网建议防抖（ms）
      var SUGGEST_TIMEOUT = 2500;  // 单源 JSONP 超时（ms）
      var MAX_HISTORY = 20;
      var BUILTIN_ENGINES = {
        baidu:  { name: '百度', url: 'https://www.baidu.com/s?wd=',       placeholder: '使用百度搜索，或者输入网址', icon: 'https://www.baidu.com/favicon.ico' },
        bing:   { name: '必应', url: 'https://www.bing.com/search?q=',    placeholder: '使用必应搜索，或者输入网址', icon: 'https://www.bing.com/favicon.ico' },
        google: { name: '谷歌', url: 'https://www.google.com/search?q=',  placeholder: '使用谷歌搜索，或者输入网址', icon: 'https://img.remit.ee/api/file/BQACAgUAAyEGAASHRsPbAAEX7J5qZdq2yzDGnGSV3J4cFDztxbAnNQACtyAAAj4IKVfVoyYBqFTwvT0E.jpeg' }
      };

      // 自定义引擎存储
      var customEngines = [];
      function loadCustomEngines() {
        try {
          var raw = localStorage.getItem(CUSTOM_ENGINES_KEY);
          if (raw) { customEngines = JSON.parse(raw); if (!Array.isArray(customEngines)) customEngines = []; }
          else customEngines = [];
        } catch (e) { customEngines = []; }
      }
      function saveCustomEngines() {
        try { localStorage.setItem(CUSTOM_ENGINES_KEY, JSON.stringify(customEngines)); } catch (e) {}
      }

      // 构造完整 ENGINES 对象（内置 + 自定义）
      function buildEngines() {
        var e = {};
        for (var k in BUILTIN_ENGINES) e[k] = BUILTIN_ENGINES[k];
        customEngines.forEach(function (ce, i) {
          e['custom_' + i] = {
            name: ce.name,
            url: ce.url,
            placeholder: '使用 ' + ce.name + ' 搜索，或者输入网址',
            icon: ce.icon || ''
          };
        });
        return e;
      }

      // 读取保存的引擎
      function getEngine() {
        try {
          var raw = localStorage.getItem(ENGINE_KEY);
          if (raw) return raw;
        } catch (e) {}
        return 'baidu';
      }

      function setEngine(key) {
        try { localStorage.setItem(ENGINE_KEY, key); } catch (e) {}
      }

      var ENGINES = {};

      // 渲染下拉列表（内置 + 自定义 + 管理按钮）
      function renderEngineDropdown() {
        ENGINES = buildEngines();
        // 清空下拉（保留并清除所有子节点）
        while (selector.firstChild) selector.removeChild(selector.firstChild);

        // 内置引擎
        var builtinKeys = ['baidu', 'bing', 'google'];
        builtinKeys.forEach(function (k) {
          var e = ENGINES[k];
          if (!e) return;
          var div = document.createElement('div');
          div.className = 'opt' + (k === getEngine() ? ' current' : '');
          div.dataset.engine = k;
          div.innerHTML = '<img class="opt-icon" src="' + e.icon + '" alt="" /><span>' + e.name + '</span>';
          selector.appendChild(div);
        });

        // 自定义引擎
        if (customEngines.length > 0) {
          var hr = document.createElement('hr');
          hr.className = 'engine-divider';
          selector.appendChild(hr);
          customEngines.forEach(function (ce, i) {
            var k = 'custom_' + i;
            var e = ENGINES[k];
            if (!e) return;
            var div = document.createElement('div');
            div.className = 'opt custom-opt' + (k === getEngine() ? ' current' : '');
            div.dataset.engine = k;
            var iconHtml = ce.icon ? '<img class="opt-icon" src="' + ce.icon + '" alt="" />' : '<span class="opt-icon" style="background:#f0f2f5;display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:#4b5158;">' + ce.name.charAt(0) + '</span>';
            div.innerHTML = iconHtml + '<span>' + ce.name + '</span><button class="del-custom" data-custom-idx="' + i + '" title="删除此引擎">×</button>';
            selector.appendChild(div);
          });
        }

        // 管理按钮
        var mgr = document.createElement('div');
        mgr.className = 'engine-manage-btn';
        mgr.id = 'engineManageBtn';
        mgr.innerHTML = '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>管理搜索引擎';
        selector.appendChild(mgr);

        // 重新绑定切换事件（通过委托）
        // 委托已经在 selector 上绑了，不需要重复绑
      }

      // 切换引擎
      var engineIcon = document.getElementById('engineIcon');
      var engineIconFallback = document.getElementById('engineIconFallback');
      function switchEngine(key) {
        var engine = ENGINES[key];
        if (!engine) return;
        setEngine(key);
        // 更新下拉当前标记
        selector.querySelectorAll('.opt').forEach(function (o) {
          o.classList.toggle('current', o.dataset.engine === key);
        });
        // 更新主图标
        if (engineIcon) {
          engineIcon.src = engine.icon;
          engineIcon.style.display = '';
          engineIconFallback.style.display = 'none';
        }
        // 更新 placeholder
        input.placeholder = engine.placeholder;
      }

      // 刷新自定义引擎列表渲染 + 重选当前引擎
      function refreshEngines() {
        loadCustomEngines();
        renderEngineDropdown();
        var cur = getEngine();
        // 如果当前引擎是自定义且已被删除，fallback 到百度
        if (cur.startsWith('custom_')) {
          var idx = parseInt(cur.replace('custom_', ''), 10);
          if (idx >= customEngines.length || !customEngines[idx]) cur = 'baidu';
        }
        if (!ENGINES[cur]) cur = 'baidu';
        switchEngine(cur);
      }

      // 初始化引擎
      loadCustomEngines();
      renderEngineDropdown();
      switchEngine(getEngine());

      // 点击图标展开/收起下拉
      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        selector.classList.toggle('open');
      });

      // 点击选项切换引擎 / 删除自定义 / 打开管理
      selector.addEventListener('click', function (e) {
        // 删除按钮
        var delBtn = e.target.closest('.del-custom');
        if (delBtn) {
          e.stopPropagation();
          var idx = parseInt(delBtn.dataset.customIdx, 10);
          if (!isNaN(idx) && idx >= 0 && idx < customEngines.length) {
            // 如果当前选中的就是被删的引擎，重置为百度
            if (getEngine() === 'custom_' + idx) setEngine('baidu');
            customEngines.splice(idx, 1);
            saveCustomEngines();
            refreshEngines();
          }
          return;
        }
        // 管理按钮
        var mgrBtn = e.target.closest('#engineManageBtn');
        if (mgrBtn) {
          selector.classList.remove('open');
          openEngineModal();
          return;
        }
        // 引擎切换
        var opt = e.target.closest('.opt');
        if (!opt) return;
        var key = opt.dataset.engine;
        if (!key || key === getEngine()) { selector.classList.remove('open'); return; }
        switchEngine(key);
        selector.classList.remove('open');
      });

      // 点击其他位置关闭下拉
      document.addEventListener('click', function (e) {
        if (!selector.contains(e.target) && e.target !== trigger) {
          selector.classList.remove('open');
        }
      });

      // 关闭菜单也关下拉
      document.querySelectorAll('.menu').forEach(function (m) {
        m.addEventListener('click', function () { selector.classList.remove('open'); });
      });

      // ========== 自定义引擎管理弹窗 ==========
      var engineModal = document.getElementById('engineModal');
      var engineName = document.getElementById('engineName');
      var engineUrl = document.getElementById('engineUrl');
      var engineIconInput = document.getElementById('engineIcon');
      var engineAddBtn = document.getElementById('engineAddBtn');
      var customEngineList = document.getElementById('customEngineList');

      function openEngineModal() {
        engineName.value = '';
        engineUrl.value = '';
        engineIconInput.value = '';
        renderCustomEngineList();
        engineModal.classList.add('open');
        engineModal.setAttribute('aria-hidden', 'false');
        setTimeout(function () { engineName.focus(); }, 50);
      }

      function renderCustomEngineList() {
        if (customEngines.length === 0) {
          customEngineList.innerHTML = '<div class="placeholder" style="display:flex;align-items:center;justify-content:center;padding:16px;font-size:12px;color:#9aa0a6;background:#f7f8fc;border-radius:8px;border:1px dashed rgba(31,35,41,0.12);">暂无自定义引擎</div>';
          return;
        }
        customEngineList.innerHTML = '';
        customEngines.forEach(function (ce, i) {
          var row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;background:#f7f8fc;border-radius:8px;font-size:13px;';
          var iconHtml = ce.icon ? '<img src="' + ce.icon + '" style="width:18px;height:18px;border-radius:4px;flex-shrink:0;" alt="" />' : '<span style="width:18px;height:18px;border-radius:4px;background:#e8ecf1;display:flex;align-items:center;justify-content:center;font-size:10px;color:#4b5158;flex-shrink:0;">' + ce.name.charAt(0) + '</span>';
          row.innerHTML = iconHtml +
            '<span style="flex:1;color:#1f2329;">' + escapeHtml(ce.name) + '</span>' +
            '<span style="font-size:11px;color:#9aa0a6;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(ce.url) + '</span>' +
            '<button class="del-custom-list" data-idx="' + i + '" style="width:20px;height:20px;border:none;background:transparent;color:#9aa0a6;cursor:pointer;font-size:14px;border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">×</button>';
          customEngineList.appendChild(row);
        });
        // 绑定删除
        customEngineList.querySelectorAll('.del-custom-list').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var idx = parseInt(this.dataset.idx, 10);
            if (!isNaN(idx) && idx >= 0 && idx < customEngines.length) {
               if (getEngine() === 'custom_' + idx) setEngine('baidu');
               customEngines.splice(idx, 1);
               saveCustomEngines();
               renderCustomEngineList();
               refreshEngines();
             }
          });
        });
      }

      function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      // 添加自定义引擎
      engineAddBtn.addEventListener('click', function () {
        var name = engineName.value.trim();
        var url = engineUrl.value.trim();
        if (!name) { alert('请输入搜索引擎名称'); return; }
        if (!url) { alert('请输入搜索地址'); return; }
        if (url.indexOf('%s') === -1) {
          // 如果没有 %s，尝试补全
          if (/[?&]$/.test(url)) url += '%s';
          else if (url.indexOf('?') === -1) url += '?q=%s';
          else url += '&q=%s';
        }
        var icon = engineIconInput.value.trim() || '';
        customEngines.push({ name: name, url: url, icon: icon });
        saveCustomEngines();
        renderCustomEngineList();
        refreshEngines();
        engineName.value = '';
        engineUrl.value = '';
        engineIconInput.value = '';
        engineName.focus();
      });

      // 回车提交
      engineUrl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); engineAddBtn.click(); }
      });
      engineName.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); engineUrl.focus(); }
      });

      // URL 构建：支持 %s 替换
      function buildSearchUrl(engineKey, query) {
        var engine = ENGINES[engineKey];
        if (!engine) return '';
        var url = engine.url;
        if (url.indexOf('%s') !== -1) {
          return url.replace(/%s/g, encodeURIComponent(query));
        }
        return url + encodeURIComponent(query);
      }

      // 站内搜索直达：在搜索引擎前匹配
      var SITE_DIRECT = {
        'zh':  'https://www.zhihu.com/search?type=content&q=',
        'gh':  'https://github.com/search?q=',
        'bl':  'https://search.bilibili.com/all?keyword=',
        'b站': 'https://search.bilibili.com/all?keyword=',
        'tb':  'https://s.taobao.com/search?q=',
        'db':  'https://www.douban.com/search?q='
      };

      function isUrlLike(q) {
        return /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(q)
            || /^localhost(:\d+)?(\/.*)?$/i.test(q);
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var q = input.value.trim();
        if (!q) return;
        // 网址 → 直接导航
        if (isUrlLike(q)) {
          var url = /^https?:\/\//i.test(q) ? q : 'http://' + q;
          window.location.href = url;
          return;
        }
        // 站内搜索直达: "zh Node.js" → 知乎搜 Node.js（开关在个性化→搜索）
        var bangMatch = q.match(/^(\S+)\s+(.+)/);
        if (bangMatch) {
          var bang = bangMatch[1].toLowerCase();
          var rest = bangMatch[2].trim();
          if (SITE_DIRECT[bang] && localStorage.getItem('newtab.sitedirect.v1') !== '0') {
            window.location.href = SITE_DIRECT[bang] + encodeURIComponent(rest);
            return;
          }
        }
        // 默认搜索引擎
        window.location.href = buildSearchUrl(getEngine(), q);
        addSearchHistory(q);
      });

      // ========== 搜索建议（本地历史 + 百度联网 + 键盘导航） ==========
      // 历史永远在前；联网建议在后，且与历史去重。
      // 来源区分「分得清但不直白」：历史=时钟图标、联网=放大镜图标，
      // 来源小字仅在 hover/选中时浮现，两组之间以发丝级分隔线过渡。
      // （HISTORY_KEY / MAX_HISTORY 已在顶部 CONFIG 声明）
      var suggestionsEl = document.getElementById('searchSuggestions');
      var searchHistory = [];
      var onlineItems = [];     // 当前查询的联网建议（字符串数组）
      var mergedItems = [];     // [{text, source:'history'|'online'}]，顺序即展示顺序
      var activeIndex = -1;     // 键盘选中项（-1 表示未选中）
      var sugReqSeq = 0;        // 请求序号：过期回调丢弃（竞态守卫）
      var sugDebounceTimer = null;
      var jsonpSeq = 0;

      function loadSearchHistory() {
        try {
          var raw = localStorage.getItem(HISTORY_KEY);
          if (raw) { searchHistory = JSON.parse(raw); if (!Array.isArray(searchHistory)) searchHistory = []; }
          else searchHistory = [];
        } catch (e) { searchHistory = []; }
      }

      function saveSearchHistory() {
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(searchHistory)); } catch (e) {}
      }

      function addSearchHistory(q) {
        if (!q || isUrlLike(q)) return;
        var idx = searchHistory.indexOf(q);
        if (idx !== -1) searchHistory.splice(idx, 1);
        searchHistory.unshift(q);
        if (searchHistory.length > MAX_HISTORY) searchHistory.length = MAX_HISTORY;
        saveSearchHistory();
      }

      function escapeAttr(s) { return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

      function onlineEnabled() {
        try { return localStorage.getItem(SUGGEST_ONLINE_KEY) !== '0'; } catch (e) { return true; }
      }

      // 是否「站内直达」查询（如 "zh Node.js"）：用户意图是站内搜索，不用百度建议打扰
      function isSiteDirectQuery(q) {
        var m = q.match(/^(\S+)\s+(.+)/);
        if (!m) return false;
        try { if (localStorage.getItem(SITEDIRECT_KEY) === '0') return false; } catch (e) {}
        return !!SITE_DIRECT[m[1].toLowerCase()];
      }

      // ---- 联网建议传输层：JSONP（file:// 单文件版亦可用，无 CORS 问题） ----
      // su 加 ie=utf-8 后请求/响应均为 UTF-8（实测）；主源失败自动备源 sugrec；
      // 全部失败 → null，静默降级为仅历史，不打断输入。
      function jsonp(baseUrl, extract, done) {
        var cbName = '__mtSugCb' + (++jsonpSeq);
        var script = document.createElement('script');
        var settled = false;
        var timer = setTimeout(function () { finish(null); }, SUGGEST_TIMEOUT);
        function cleanup() {
          clearTimeout(timer);
          try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
          if (script.parentNode) script.parentNode.removeChild(script);
        }
        function finish(list) {
          if (settled) return;
          settled = true;
          cleanup();
          done(list);
        }
        window[cbName] = function (obj) {
          var list = null;
          try { list = extract(obj); } catch (e) { /* 解析失败视为无结果 */ }
          finish(list);
        };
        script.onerror = function () { finish(null); };
        script.src = baseUrl + cbName;
        document.head.appendChild(script);
      }

      var onlineTransport = function (query, done) {
        var wd = encodeURIComponent(query);
        jsonp('https://suggestion.baidu.com/su?ie=utf-8&wd=' + wd + '&cb=', function (obj) {
          return obj && Array.isArray(obj.s)
            ? obj.s.filter(function (s) { return typeof s === 'string' && s; })
            : null;
        }, function (list) {
          if (list) { done(list); return; }
          jsonp('https://www.baidu.com/sugrec?prod=pc&ie=utf-8&json=1&wd=' + wd + '&cb=', function (obj) {
            return obj && Array.isArray(obj.g)
              ? obj.g.map(function (g) { return g && g.q; }).filter(function (s) { return typeof s === 'string' && s; })
              : null;
          }, done);
        });
      };

      function scheduleOnlineFetch(q) {
        clearTimeout(sugDebounceTimer);
        var seq = ++sugReqSeq; // 使此前所有请求的回调失效
        if (!q || !onlineEnabled() || isUrlLike(q) || isSiteDirectQuery(q)) return;
        sugDebounceTimer = setTimeout(function () {
          onlineTransport(q, function (list) {
            if (seq !== sugReqSeq) return; // 过期响应：查询已变化，丢弃
            onlineItems = (list || []).slice(0, ONLINE_MAX);
            renderSuggestions(input.value.trim());
          });
        }, SUGGEST_DEBOUNCE);
      }

      // 历史=时钟（搜过的），联网=放大镜（新建议）；图标语义差异即来源区分的第一层
      var SG_CLOCK = '<svg class="sg-icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.3" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.6V8l2.3 1.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      var SG_MAG = '<svg class="sg-icon" viewBox="0 0 16 16" fill="none"><path d="M7 1a6 6 0 100 12A6 6 0 007 1zM13 13l-3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

      function sgRow(idx, text, source) {
        var icon = source === 'history' ? SG_CLOCK : SG_MAG;
        var tag = source === 'history' ? '历史' : '百度';
        var del = source === 'history'
          ? '<button class="sg-del" data-q="' + escapeAttr(text) + '" aria-label="删除此历史记录">×</button>'
          : '';
        return '<div class="sg-item" id="sg-opt-' + idx + '" role="option" aria-selected="false" data-idx="' + idx + '" data-source="' + source + '" data-q="' + escapeAttr(text) + '">' +
          icon + '<span class="sg-text">' + escapeHtml(text) + '</span>' +
          '<span class="sg-src" aria-hidden="true">' + tag + '</span>' + del + '</div>';
      }

      function renderSuggestions(filter) {
        if (!suggestionsEl) return;
        loadSearchHistory();
        var f = (filter || '').toLowerCase();
        var hist = searchHistory.filter(function (s) { return !f || s.toLowerCase().indexOf(f) !== -1; });
        var histSet = {};
        hist.forEach(function (s) { histSet[s.toLowerCase()] = true; });
        var online = [];
        if (f && onlineEnabled()) {
          online = onlineItems.filter(function (s) { return !histSet[s.toLowerCase()]; });
        }
        mergedItems = hist.map(function (s) { return { text: s, source: 'history' }; })
          .concat(online.map(function (s) { return { text: s, source: 'online' }; }));
        activeIndex = -1;
        if (!mergedItems.length) {
          suggestionsEl.classList.remove('open');
          suggestionsEl.innerHTML = '';
          input.removeAttribute('aria-activedescendant');
          input.setAttribute('aria-expanded', 'false');
          return;
        }
        var html = '';
        var idx = 0;
        hist.forEach(function (s) { html += sgRow(idx++, s, 'history'); });
        if (hist.length && online.length) html += '<div class="sg-divider" role="separator"></div>';
        online.forEach(function (s) { html += sgRow(idx++, s, 'online'); });
        if (hist.length) html += '<div class="sg-clear" id="sgClearAll">清空搜索历史</div>';
        suggestionsEl.innerHTML = html;
        suggestionsEl.classList.add('open');
        input.setAttribute('aria-expanded', 'true');
        input.removeAttribute('aria-activedescendant');
      }

      // 键盘选中态同步（含 aria 与滚动跟随）
      function updateActive() {
        var rows = suggestionsEl.querySelectorAll('.sg-item');
        rows.forEach(function (row, i) {
          var on = i === activeIndex;
          row.classList.toggle('active', on);
          row.setAttribute('aria-selected', on ? 'true' : 'false');
          if (on) {
            input.setAttribute('aria-activedescendant', row.id);
            if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
          }
        });
        if (activeIndex < 0) input.removeAttribute('aria-activedescendant');
      }

      function closeSuggestions() {
        suggestionsEl.classList.remove('open');
        activeIndex = -1;
        input.removeAttribute('aria-activedescendant');
        input.setAttribute('aria-expanded', 'false');
      }

      // 建议点击委托（历史可单条删除；联网建议点击即搜）
      suggestionsEl.addEventListener('click', function (e) {
        var item = e.target.closest('.sg-item');
        if (item) {
          var delBtn = e.target.closest('.sg-del');
          if (delBtn) {
            e.stopPropagation();
            var dq = delBtn.dataset.q;
            var di = searchHistory.indexOf(dq);
            if (di !== -1) { searchHistory.splice(di, 1); saveSearchHistory(); renderSuggestions(input.value.trim()); }
            return;
          }
          var q = item.dataset.q;
          if (q) { input.value = q; closeSuggestions(); form.requestSubmit(); }
          return;
        }
        var clear = e.target.closest('#sgClearAll');
        if (clear) {
          searchHistory = [];
          saveSearchHistory();
          renderSuggestions(input.value.trim());
        }
      });

      // 鼠标 hover 同步键盘选中态（鼠标/键盘体验一致）
      suggestionsEl.addEventListener('mouseover', function (e) {
        var item = e.target.closest('.sg-item');
        if (!item) return;
        var idx = parseInt(item.dataset.idx, 10);
        if (!isNaN(idx) && idx !== activeIndex) { activeIndex = idx; updateActive(); }
      });

      // 聚焦/输入显示建议
      input.addEventListener('focus', function () {
        loadSearchHistory();
        var v = input.value.trim();
        renderSuggestions(v);
        if (v) scheduleOnlineFetch(v);
      });

      input.addEventListener('input', function () {
        var v = this.value.trim();
        onlineItems = []; // 查询已变：先清旧联网结果，避免张冠李戴
        renderSuggestions(v);
        scheduleOnlineFetch(v);
      });

      // 失活关闭建议（延迟以允许点击）
      input.addEventListener('blur', function () {
        setTimeout(function () { closeSuggestions(); }, 180);
      });

      // 键盘导航：↑↓ 循环选择（跨历史/联网两组）、Enter 执行选中项、Esc 关闭
      input.addEventListener('keydown', function (e) {
        var open = suggestionsEl.classList.contains('open');
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          if (!open || !mergedItems.length) return;
          e.preventDefault();
          var n = mergedItems.length;
          activeIndex = e.key === 'ArrowDown'
            ? (activeIndex + 1) % n
            : (activeIndex <= 0 ? n - 1 : activeIndex - 1); // 未选中/首项按 ↑ 都循环到末项
          updateActive();
        } else if (e.key === 'Enter') {
          if (open && activeIndex >= 0 && mergedItems[activeIndex]) {
            input.value = mergedItems[activeIndex].text; // 提交选中项（form submit 读取 input）
          }
          closeSuggestions();
        } else if (e.key === 'Escape') {
          if (open) { e.stopPropagation(); closeSuggestions(); }
        }
      });

      loadSearchHistory();
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-controls', 'searchSuggestions');
      input.setAttribute('aria-expanded', 'false');
      suggestionsEl.setAttribute('role', 'listbox');

      // 调试/测试钩子（传输层可注入：jsdom 无法发真实 JSONP）
      window.__debug = window.__debug || {};
      window.__debug.search = {
        setTransport: function (fn) { onlineTransport = fn; },
        getMerged: function () { return mergedItems.slice(); },
        getActive: function () { return activeIndex; },
        render: function () { renderSuggestions(input.value.trim()); }
      };
    })();
