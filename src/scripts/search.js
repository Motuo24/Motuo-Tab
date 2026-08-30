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

      // ========== 搜索建议 ==========
      // （HISTORY_KEY / MAX_HISTORY 已在顶部 CONFIG 声明）
      var suggestionsEl = document.getElementById('searchSuggestions');
      var searchHistory = [];

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

      // 保存搜索历史（在主 submit 里已调用 addSearchHistory）

      function renderSuggestions(filter) {
        if (!suggestionsEl) return;
        loadSearchHistory();
        var items = searchHistory;
        if (filter) {
          var f = filter.toLowerCase();
          items = items.filter(function (s) { return s.toLowerCase().indexOf(f) !== -1; });
        }
        if (items.length === 0) { suggestionsEl.classList.remove('open'); suggestionsEl.innerHTML = ''; return; }

        var html = '';
        items.forEach(function (s) {
          html += '<div class="sg-item" data-q="' + escapeAttr(s) + '">' +
            '<svg class="sg-icon" viewBox="0 0 16 16" fill="none"><path d="M7 1a6 6 0 100 12A6 6 0 007 1zM13 13l-3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' +
            '<span class="sg-text">' + escapeHtml(s) + '</span>' +
            '<button class="sg-del" data-q="' + escapeAttr(s) + '">×</button></div>';
        });
        if (items.length > 0) {
          html += '<div class="sg-clear" id="sgClearAll">清空搜索历史</div>';
        }
        suggestionsEl.innerHTML = html;
        suggestionsEl.classList.add('open');
      }

      function escapeAttr(s) { return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

      // 建议点击委托
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
          if (q) { input.value = q; suggestionsEl.classList.remove('open'); form.requestSubmit(); }
          return;
        }
        var clear = e.target.closest('#sgClearAll');
        if (clear) {
          searchHistory = [];
          saveSearchHistory();
          renderSuggestions('');
        }
      });

      // 聚焦/输入显示建议
      input.addEventListener('focus', function () {
        loadSearchHistory();
        if (searchHistory.length > 0) renderSuggestions(input.value.trim());
      });

      input.addEventListener('input', function () {
        var v = this.value.trim();
        if (v) renderSuggestions(v);
        else { loadSearchHistory(); if (searchHistory.length > 0) renderSuggestions(''); else suggestionsEl.classList.remove('open'); }
      });

      // 失活关闭建议（延迟以允许点击）
      input.addEventListener('blur', function () {
        setTimeout(function () { suggestionsEl.classList.remove('open'); }, 180);
      });

      // 回车关闭建议（提交由 form submit 处理）
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') suggestionsEl.classList.remove('open');
      });

      loadSearchHistory();
    })();
