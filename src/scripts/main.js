/* ========================================================================
     * 主模块
     *   - 快捷方式 CRUD、编辑模式（拖拽/删除）、导入导出
     *   - 壁纸（IndexedDB）+ 模糊 + 纯色 + 透明度 + 主题
     *   - 速记本
     * AI 助手在 scripts/ai.js，通过 window.__motuo.cards 读写卡片。
     * ====================================================================== */
    (function () {
      var nav = document.querySelector('.shortcuts');
      var slot = document.getElementById('addSlot');
      if (!nav || !slot) return;

      // -------- CONFIG（主模块常量集中地） --------
      // 存储键
      var KEY                = 'newtab.shortcuts.v1';      // 快捷方式数据
      var SOLID_COLOR_KEY    = 'newtab.solidColor.v1';     // 纯色壁纸
      var BLUR_KEY           = 'newtab.blur.v1';           // 壁纸模糊度
      var ALPHA_KEY          = 'newtab.alpha.v1';          // 卡片透明度
      var TOGGLE_IMG_KEY     = 'newtab.toggleImg.v1';      // 图标卡片透明开关
      var TOGGLE_LTR_KEY     = 'newtab.toggleLtr.v1';      // 文字卡片透明开关
      var AI_CONFIG_KEY      = 'newtab.ai.config.v1';      // AI 配置
      var AI_HISTORY_KEY     = 'newtab.ai.history.v1';     // AI 对话历史
      var AI_SNAPSHOT_KEY    = 'newtab.ai.snapshot.v1';    // AI 操作前的快照（用于撤销）
      var SCRATCHPAD_KEY     = 'newtab.scratchpad.v1';     // 速记本内容
      var THEME_KEY          = 'newtab.theme.v1';          // 主题模式：light / dark / auto
      var GREETING_KEY       = 'newtab.greeting.v1';       // T1 时段问候语开关（默认开）
      var HERO_LOGO_KEY      = 'newtab.heroLogo.v1';       // T1 起始页 Hero Logo 开关（默认开）
      var LOGO_STYLE_KEY     = 'newtab.logoStyle.v1';      // T1 Logo 样式：a（流光 M）/ c（折角新页）
      var HERO_LOGO_ALPHA_KEY = 'newtab.heroLogoAlpha.v1'; // T1 起始页 Logo 透明度（0.2–1.0，默认 0.65）
      var WEBDAV_KEY         = 'newtab.webdav.v1';         // T7b WebDAV 云同步配置
      var BACKUP_META_KEY    = 'newtab.backupMeta.v1';     // 备份提醒状态
      var BACKUP_REMIND_MS   = 30 * 86400000;
      var BACKUP_DISMISS_MS  = 7 * 86400000;
      // IndexedDB（壁纸 blob 存这里）
      var DB_NAME            = 'MotuoTabDB';
      var DB_VERSION         = 2;
      var ICON_STORE_NAME    = 'icons';
      var ICON_TTL_MS        = 7 * 86400000;
      var ICON_CLEAN_VERSION = 1;
      var ICON_LOCAL_CLEAN_VER_KEY = 'newtab.iconCleanVer.v1';
      var ICON_MAX_SINGLE_BYTES = 256 * 1024;
      var ICON_MAX_ENTRIES   = 200;
      var ICON_MAX_TOTAL_CHARS = 10 * 1024 * 1024;
      var iconCacheMem       = Object.create(null);
      var iconCacheReadyPromise = null;
      function getCachedIconSync(url) {
        if (!url || !/^(?:https?:|bmicon:)/i.test(url)) return '';
        var entry = iconCacheMem[url];
        return (entry && entry.dataUrl) ? entry.dataUrl : '';
      }
      function isFolderItem(it) { return !!(it && it.type === 'folder'); }
      function makeFolderId() { return 'fld_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
      var STORE_NAME         = 'wallpapers';
      // favicon 自动抓取候选（按顺序尝试，第一个成功即用）
      var RANDOM_COLORS      = ['blue', 'pink', 'orange', 'purple', 'sky', 'green', 'amber'];

      // 默认快捷方式（首次访问时使用，用户编辑/删除后会被持久化）
      var DEFAULTS = [
        {
          name: '知乎',
          url: 'https://www.zhihu.com',
          iconSrc: 'image',
          icon: 'https://www.zhihu.com/favicon.ico'
        },
        {
          name: '工作台',
          url: '',
          iconSrc: 'image',
          icon: '__ASSET_default-workbench.png__'
        },
        {
          name: 'fnOS',
          url: 'https://fnnas.com',
          iconSrc: 'image',
          icon: 'https://fnnas.com/favicon.ico'
        },
        {
          name: '1Panel',
          url: '',
          iconSrc: 'image',
          icon: 'https://apps-assets.fit2cloud.com/stable/1panel/logo.png'
        },
        {
          name: 'cloudflare',
          url: 'https://dash.cloudflare.com',
          iconSrc: 'image',
          icon: 'https://dash.cloudflare.com/favicon.ico'
        },
        {
          name: '腾讯云',
          url: 'https://console.cloud.tencent.com/cns',
          iconSrc: 'image',
          icon: 'https://cloud.tencent.com/favicon.ico'
        },
        {
          name: '哔哩哔哩',
          url: 'https://www.bilibili.com',
          iconSrc: 'image',
          icon: 'https://www.bilibili.com/favicon.ico'
        },
        {
          name: 'DeepSeek',
          url: 'https://platform.deepseek.com',
          iconSrc: 'image',
          icon: 'https://www.deepseek.com/favicon.ico'
        },
        {
          name: 'OpenAI API',
          url: 'https://platform.openai.com/',
          iconSrc: 'image',
          icon: 'https://icons.duckduckgo.com/ip3/platform.openai.com.ico'
        },
        {
          name: '小米MIMO',
          url: 'https://mimo.mi.com/',
          iconSrc: 'image',
          icon: 'https://mimo.mi.com/favicon.png'
        },
        {
          name: '基元律动',
          url: 'https://tokenrhythm.studio/i/rf_tr_RfwVmCBmMHJmkiE8CqfWWhBQ',
          iconSrc: 'image',
          icon: '__ASSET_default-rhythm.png__'
        },
        {
          name: 'MiniMax',
          url: 'https://minimaxi.com',
          iconSrc: 'image',
          icon: 'https://minimaxi.com/favicon.ico'
        },
        {
          name: 'GitHub',
          url: 'https://github.com',
          iconSrc: 'image',
          icon: 'https://github.com/favicon.ico'
        },
        {
          name: 'TX星融网',
          url: 'https://pod.xr24.cn',
          iconSrc: 'image',
          icon: 'https://pod.xr24.cn/upload/image_ce9a8fe48b1bbed7f785e92ba1965a79-removebg-preview.png'
        },
        {
          name: 'TX工具网',
          url: 'https://www.xr24.cn',
          iconSrc: 'color',
          color: 'white',
          letter: '🛠️'
        },
        {
          name: 'TX同学录',
          url: 'https://class.xr24.cn',
          iconSrc: 'color',
          color: 'white',
          letter: '🎓'
        },
        {
          name: 'Roogoo虚拟卡',
          url: 'https://wap.roogoo.cloud/dashboard',
          iconSrc: 'image',
          icon: '__ASSET_default-roogoo.png__'
        },
        {
          name: 'Remit图床',
          url: 'https://img.remit.ee/',
          iconSrc: 'image',
          icon: 'https://img.remit.ee/favicon.ico'
        },
        {
          name: 'Bocha搜索',
          url: 'https://open.bochaai.com/overview',
          iconSrc: 'image',
          icon: '__ASSET_default-bocha.png__'
        }
      ];

      // 从 localStorage 读取列表（主 + 备份双保险）
      //   - 首次访问（没有这个 key）→ 种入默认值
      //   - 数据被破坏（非数组）→ 种入默认值
      //   - 空数组 → 保留空数组（用户/AI 主动删光的状态要保住）
      function load() {
        try {
          // 先读主 key，没有再读备份
          var raw = localStorage.getItem(KEY);
          if (raw === null || raw === '') {
            raw = localStorage.getItem(KEY + '.bak');
          }
          if (raw === null || raw === '') {
            // 首次访问：种入默认值
            var seed = DEFAULTS.slice();
            save(seed);
            return seed;
          }
          var arr = JSON.parse(raw);
          if (!Array.isArray(arr)) {
            // 数据被破坏：种入默认值
            var seed2 = DEFAULTS.slice();
            save(seed2);
            return seed2;
          }
          if (window.console && console.log) {
            console.log('[shortcuts] loaded ' + arr.length + ' items from localStorage');
          }
          return arr; // 包括空数组，原样保留
        } catch (e) {
          if (window.console && console.error) {
            console.error('[shortcuts] load failed', e);
          }
          return DEFAULTS.slice();
        }
      }

      // 持久化保存（同时写主 + 备份，方便排查问题）
      function save(list) {
        var json = JSON.stringify(list);
        var ok1 = false, ok2 = false;
        try {
          localStorage.setItem(KEY, json);
          ok1 = true;
        } catch (e1) {
          if (window.console && console.error) console.error('[shortcuts] save(primary) failed', e1);
        }
        try {
          localStorage.setItem(KEY + '.bak', json);
          ok2 = true;
        } catch (e2) {
          if (window.console && console.error) console.error('[shortcuts] save(backup) failed', e2);
        }
        if (window.console && console.log) {
          console.log('[shortcuts] saved ' + list.length + ' items (primary=' + ok1 + ', backup=' + ok2 + ')');
        }
        return ok1 || ok2;
      }

      // 把列表渲染成 DOM，插到 "+" 前面
      function render(list) {
        // 清掉所有 .shortcut（包括默认/自定义，全部由数据驱动）
        nav.querySelectorAll('.shortcut').forEach(function (n) { n.remove(); });

        list.forEach(function (item, i) {
          var a = buildCard(item);
          a.style.setProperty('--i', String(i)); // 错开入场动画
          nav.insertBefore(a, slot);
        });
      }

      // ========== 增量操作：避免每次都全量重绘，保留卡片各自的状态/动画 ==========

      // 预设色名（走 CSS 类名，含浅底+彩色文字样式）；其余一律视为自定义色值
      var PRESET_COLORS = ['blue', 'pink', 'orange', 'purple', 'sky', 'green', 'amber', 'white'];

      // 解析颜色为 [r,g,b]；解析失败返回 null
      function parseColor(str) {
        if (!str || typeof str !== 'string') return null;
        var s = str.trim();
        var m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (m) {
          var hex = m[1];
          if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
          var n = parseInt(hex, 16);
          return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        }
        m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
        if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
        return null;
      }

      // 相对亮度（WCAG 近似），用于决定前景文字深浅
      function colorLuminance(rgb) {
        return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
      }

      // 给 tile 应用背景色 + 自动对比文字色（预设色走类名，自定义色走内联样式）
      function applyTileColor(tile, color) {
        if (PRESET_COLORS.indexOf(color) !== -1) {
          tile.classList.add(color);
          return;
        }
        var rgb = parseColor(color);
        if (rgb) {
          tile.style.background = color;
          tile.style.color = colorLuminance(rgb) > 0.5 ? '#1f2329' : '#ffffff';
          tile.style.border = '1px solid rgba(31, 35, 41, 0.10)';
        } else {
          tile.style.background = 'var(--tile-ltr-bg)';
          tile.style.color = 'var(--text-1)';
        }
      }

      // 填充 tile 内容（图片/文字 + 颜色），公共逻辑给 build/update 共用
      var cardItemMap = new WeakMap();

      // 文字/颜色兜底 tile（无图或图标加载失败时使用）
      function fillFallbackTile(tile, item) {
        while (tile.firstChild) tile.removeChild(tile.firstChild);
        tile.removeAttribute('style');
        tile.className = 'tile';
        var ch = (item.letter || (item.name || '').trim().charAt(0).toUpperCase()) || '?';
        if (item.color) {
          applyTileColor(tile, item.color);
        } else {
          tile.style.background = 'var(--tile-ltr-bg)';
          tile.style.color = 'var(--text-1)';
        }
        tile.textContent = ch;
      }

      function resolveItemIconSrc(icon) {
        if (!icon) return '';
        if (/^(?:https?:|bmicon:)/i.test(icon)) {
          var hit = getCachedIconSync(icon);
          if (hit) return hit;
          if (/^bmicon:/i.test(icon)) return '';
        }
        return icon;
      }

      function fillMiniTile(mini, child) {
        mini.className = 'folder-mini-tile';
        if (child.iconSrc === 'image' && child.icon) {
          var resolved = resolveItemIconSrc(child.icon);
          if (resolved) {
            var img = document.createElement('img');
            img.src = resolved;
            if (/^https?:/i.test(child.icon)) img.dataset.iconUrl = child.icon;
            img.alt = '';
            img.onerror = function () {
              if (img.dataset.iconUrl && !img.dataset.retriedRemote && img.src !== img.dataset.iconUrl) {
                img.dataset.retriedRemote = '1';
                img.src = img.dataset.iconUrl;
                return;
              }
              mini.textContent = (child.letter || (child.name || '').trim().charAt(0).toUpperCase()) || '?';
            };
            mini.appendChild(img);
            return;
          }
        }
        mini.textContent = (child.letter || (child.name || '').trim().charAt(0).toUpperCase()) || '?';
        if (child.color && PRESET_COLORS.indexOf(child.color) !== -1) mini.classList.add(child.color);
      }

      function fillFolderTile(tile, folder) {
        while (tile.firstChild) tile.removeChild(tile.firstChild);
        tile.removeAttribute('style');
        tile.className = 'tile folder-tile';
        var kids = Array.isArray(folder.children) ? folder.children : [];
        if (!kids.length) {
          var em = document.createElement('div');
          em.className = 'folder-empty-glyph';
          em.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>';
          tile.appendChild(em);
          return;
        }
        kids.slice(0, 4).forEach(function (child) {
          var mini = document.createElement('div');
          fillMiniTile(mini, child);
          tile.appendChild(mini);
        });
      }

      function fillTile(tile, item) {
        if (isFolderItem(item)) {
          fillFolderTile(tile, item);
          return;
        }
        while (tile.firstChild) tile.removeChild(tile.firstChild);
        tile.removeAttribute('style');
        tile.className = 'tile';

        if (item.iconSrc === 'image' && item.icon) {
          var cachedSrc = '';
          if (/^(?:https?:|bmicon:)/i.test(item.icon)) cachedSrc = getCachedIconSync(item.icon);
          if (/^bmicon:/i.test(item.icon) && !cachedSrc) {
            fillFallbackTile(tile, item);
            return;
          }
          // 背景用主题变量：深色模式为深色，自动模式为透明（背景由 CSS 反色层提供）
          tile.style.background = 'var(--tile-img-bg)';
          var img = document.createElement('img');
          if (/^(?:https?:|bmicon:)/i.test(item.icon)) img.dataset.iconUrl = item.icon;
          img.src = cachedSrc || item.icon;
          img.alt = item.name || '';
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = 'contain';
          img.style.padding = '10px';
          img.style.boxSizing = 'border-box';
          img.style.borderRadius = '16px';
          img.onerror = function () {
            if (img.dataset.iconUrl && /^https?:/i.test(img.dataset.iconUrl) && !img.dataset.retriedRemote && img.src !== img.dataset.iconUrl) {
              img.dataset.retriedRemote = '1';
              img.src = img.dataset.iconUrl;
              return;
            }
            fillFallbackTile(tile, item);
          };
          tile.appendChild(img);
        } else {
          var ch = (item.letter || (item.name || '').trim().charAt(0).toUpperCase()) || '?';
          if (item.color) {
            applyTileColor(tile, item.color);
          } else {
            tile.style.background = 'var(--tile-ltr-bg)';
            tile.style.color = 'var(--text-1)';
          }
          tile.textContent = ch;
        }
      }

      // 创建一张未挂载的快捷方式或分组 DOM 节点
      function buildCard(item) {
        var a = document.createElement('a');
        var folder = isFolderItem(item);
        a.className = 'shortcut' + (folder ? ' shortcut-folder' : '');
        a.href = folder ? '#' : (item.url || '#');
        a.dataset.iconSrc = folder ? 'folder' : (item.iconSrc || 'color');
        if (folder && item.id) a.dataset.folderId = item.id;

        var tile = document.createElement('div');
        fillTile(tile, item);

        var label = document.createElement('div');
        label.className = 'label';
        label.textContent = item.name;

        a.appendChild(tile);
        a.appendChild(label);
        cardItemMap.set(a, item);
        return a;
      }

      // 末尾追加一张卡片（带入场动画，不重绘已有卡片）
      function appendCard(item) {
        var card = buildCard(item);
        card.style.setProperty('--i', '0'); // 新增的卡片不延迟
        nav.insertBefore(card, slot);
        if (editing) card.setAttribute('draggable', 'true');
        return card;
      }

      // 就地更新某张卡片的内容（编辑/入组后用，保持原 DOM 节点避免整页重建卡顿）
      function updateCardContent(card, item) {
        if (!card || !item) return;
        cardItemMap.set(card, item);
        var folder = isFolderItem(item);
        card.className = 'shortcut no-enter-anim' + (folder ? ' shortcut-folder' : '');
        card.href = folder ? '#' : (item.url || '#');
        card.dataset.iconSrc = folder ? 'folder' : (item.iconSrc || 'color');
        if (folder && item.id) card.dataset.folderId = item.id;
        else card.removeAttribute('data-folder-id');
        card.setAttribute('draggable', editing ? 'true' : 'false');
        var tile = card.querySelector('.tile');
        var label = card.querySelector('.label');
        if (tile) fillTile(tile, item);
        if (label) label.textContent = item.name;
      }

      function pulseFolderAbsorb(cardEl) {
        if (!cardEl) return;
        cardEl.classList.remove('folder-absorb');
        void cardEl.offsetWidth;
        cardEl.classList.add('folder-absorb');
        setTimeout(function () { cardEl.classList.remove('folder-absorb'); }, 320);
      }

      function findCardElementByItem(item) {
        if (!item) return null;
        var cards = nav.querySelectorAll('.shortcut');
        for (var i = 0; i < cards.length; i++) {
          if (cardItemMap.get(cards[i]) === item) return cards[i];
        }
        if (isFolderItem(item) && item.id) {
          return nav.querySelector('.shortcut-folder[data-folder-id="' + item.id + '"]');
        }
        return null;
      }

      // 删除一张卡片（带退场动画），动画结束后自动从 DOM 移除
      function removeCardWithAnim(card) {
        if (!card || !card.parentNode) return;
        card.classList.add('removing');
        var done = false;
        function finish(e) {
          if (done) return;
          if (e && e.animationName && e.animationName !== 'shortcut-out') return;
          done = true;
          card.removeEventListener('animationend', finish);
          if (card.parentNode) card.parentNode.removeChild(card);
        }
        card.addEventListener('animationend', finish);
        // 兜底：300ms 后强制结束（防止 animationend 不触发）
        setTimeout(finish, 300);
      }

      // FLIP：让重排时其他卡片平滑滑动到新位置（支持主页 nav 或文件夹 folderGrid）
      function animateReorder(change, container, ignoreEl) {
        var root = container || nav;
        var skip = ignoreEl === undefined ? dragSrc : ignoreEl;
        var cards = Array.from(root.querySelectorAll('.shortcut'));
        var firstRects = new Map();
        cards.forEach(function (c) { firstRects.set(c, c.getBoundingClientRect()); });

        change(); // 改 DOM

        var postCards = Array.from(root.querySelectorAll('.shortcut'));
        postCards.forEach(function (c) {
          if (c === skip) return;
          var first = firstRects.get(c);
          if (!first) return;
          var last = c.getBoundingClientRect();
          var dx = first.left - last.left;
          var dy = first.top - last.top;
          if (dx !== 0 || dy !== 0) {
            c.style.transition = 'none';
            c.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
          }
        });
        // 下一帧开始播放过渡
        var play = function () {
          postCards.forEach(function (c) {
            if (c === skip) return;
            c.style.transition = '';
            c.style.transform = '';
          });
        };
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(function () { requestAnimationFrame(play); });
        } else {
          play();
        }
      }

      var list = load();
      render(list);
      // 后台把远程图标缓存到本地（首次以后进页面无需再联网加载图标）
      // 图标缓存优先（IndexedDB）：先读本地缓存渲染，再后台 7 天周期静默刷新
      initIconCache();

      // 离开页面前最后再存一次（关 tab/刷新/navigate 都触发）
      window.addEventListener('beforeunload', function () {
        try { save(list); } catch (e) {}
      });
      // 页面隐藏（切到其他 tab）也存一次
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
          try { save(list); } catch (e) {}
        }
      });

      // ========== 添加卡片：表单弹窗流程 ==========
      var addModal = document.getElementById('addModal');
      var addForm = document.getElementById('addForm');
      var addName = document.getElementById('addName');
      var addUrl = document.getElementById('addUrl');
      var addImage = document.getElementById('addImage');
      var addImageField = document.getElementById('addImageField');
      var addColorField = document.getElementById('addColorField');
      var addColorPicker = document.getElementById('addColorPicker');
      var previewTile = document.getElementById('previewTile');
      var previewLabel = document.getElementById('previewLabel');
      var chosenColor = 'blue';

      // ========== 图标图片：本地文件 / Ctrl+V 粘贴 / 拖拽 ==========
      var addImageFileBtn = document.getElementById('addImageFileBtn');
      var addImageFile = document.getElementById('addImageFile');
      var addImageDropzone = document.getElementById('addImageDropzone');

      // 把 File 应用为图标：转 base64 → 自动切到 image 模式 → 刷新预览
      function setIconFromFile(file) {
        if (!file) return;
        if (!file.type || file.type.indexOf('image/') !== 0) {
          alert('请选择图片文件');
          return;
        }
        // base64 会比原始大 ~33%，localStorage 单 key 5~10MB 上限，留余量限制 2MB
        if (file.size > 2 * 1024 * 1024) {
          alert('图片太大，请选择 2MB 以内的图片（图片会以 base64 存到本地）');
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          var rawUrl = String(reader.result || '');
          var applyVal = function (val) {
            var radio = addForm.querySelector('input[name="iconSrc"][value="image"]');
            if (!radio.checked) {
              radio.checked = true;
              // 显隐字段（image / color / letter）跟着切
              radio.dispatchEvent(new Event('change'));
            }
            addImage.value = val;
            updatePreview();
          };
          if (/^data:image\/svg\+xml/i.test(rawUrl)) {
            applyVal(cleanSvgDataUrl(rawUrl).dataUrl);
            return;
          }
          if (!canCleanRaster()) {
            applyVal(rawUrl);
            return;
          }
          cleanIconDataUrlStr(rawUrl).then(applyVal);
        };
        reader.onerror = function () { alert('图片读取失败'); };
        reader.readAsDataURL(file);
      }

      // 入口 1：按钮 → 触发 file 选择器
      addImageFileBtn.addEventListener('click', function () {
        addImageFile.value = '';
        addImageFile.click();
      });
      addImageFile.addEventListener('change', function () {
        var f = addImageFile.files && addImageFile.files[0];
        if (f) setIconFromFile(f);
      });

      // 入口 2：Ctrl+V 粘贴图片（整个弹窗都生效，但输入框/可编辑区域里保持原生粘贴行为）
      addModal.addEventListener('paste', function (e) {
        var t = e.target;
        // 用户在文本框里正常粘贴文字时不要劫持
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
          // 但 INPUT 里有图片时（dataTransfer 里 file 项），仍允许
          var items = e.clipboardData && e.clipboardData.items;
          if (!items) return;
          var hasImage = false;
          for (var i = 0; i < items.length; i++) {
            if (items[i].kind === 'file' && items[i].type && items[i].type.indexOf('image/') === 0) { hasImage = true; break; }
          }
          if (!hasImage) return; // 让浏览器走默认粘贴
        }
        var items2 = e.clipboardData && e.clipboardData.items;
        if (!items2) return;
        for (var j = 0; j < items2.length; j++) {
          var it = items2[j];
          if (it.kind === 'file' && it.type && it.type.indexOf('image/') === 0) {
            var f = it.getAsFile();
            if (f) {
              e.preventDefault();
              setIconFromFile(f);
              return;
            }
          }
        }
      });

      // 入口 3：拖拽图片到弹窗
      function findImageFile(dataTransfer) {
        if (!dataTransfer || !dataTransfer.files || !dataTransfer.files.length) return null;
        for (var i = 0; i < dataTransfer.files.length; i++) {
          if (dataTransfer.files[i].type && dataTransfer.files[i].type.indexOf('image/') === 0) {
            return dataTransfer.files[i];
          }
        }
        return null;
      }
      addModal.addEventListener('dragover', function (e) {
        if (findImageFile(e.dataTransfer)) {
          e.preventDefault(); // 阻止浏览器打开图片
          addImageDropzone.classList.add('is-dragover');
        }
      });
      addModal.addEventListener('dragleave', function (e) {
        // 只有真正离开 dropzone 才去掉高亮（避免子元素冒泡误触发）
        if (e.target === addImageDropzone) addImageDropzone.classList.remove('is-dragover');
      });
      addModal.addEventListener('drop', function (e) {
        var f = findImageFile(e.dataTransfer);
        if (f) {
          e.preventDefault();
          addImageDropzone.classList.remove('is-dragover');
          setIconFromFile(f);
        }
      });

      // 颜色点选中
      addColorPicker.addEventListener('click', function (e) {
        var dot = e.target.closest('.color-dot');
        if (!dot) return;
        addColorPicker.querySelectorAll('.color-dot').forEach(function (d) { d.classList.remove('selected'); });
        dot.classList.add('selected');
        chosenColor = dot.dataset.color;
        updatePreview();
      });
      // 默认选中第一个
      addColorPicker.querySelector('.color-dot').classList.add('selected');

      // 切换图标来源时显隐对应字段
      addForm.querySelectorAll('input[name="iconSrc"]').forEach(function (r) {
        r.addEventListener('change', function () {
          var v = r.value;
          addImageField.style.display = v === 'image' ? '' : 'none';
          addColorField.style.display = v === 'color' ? '' : 'none';
          addLetterField.style.display = v === 'color' ? '' : 'none';
          updatePreview();
        });
      });

      // 名称变化时同步预览字符
      addName.addEventListener('input', updatePreview);
      addUrl.addEventListener('input', updatePreview);
      addImage.addEventListener('input', updatePreview);
      addLetter.addEventListener('input', updatePreview);

      function updatePreview() {
        var name = (addName.value || '').trim();
        var url = (addUrl.value || '').trim();
        var customLetter = (addLetter.value || '').trim();
        var ch = customLetter || (name ? name.charAt(0).toUpperCase() : '?');
        previewLabel.textContent = name || '名称';
        var mode = addForm.querySelector('input[name="iconSrc"]:checked').value;

        // 清空旧的预览 tile 内容
        previewTile.innerHTML = '';
        previewTile.style.background = '';
        previewTile.style.color = '';
        previewTile.className = 'tile preview-tile';

        if (mode === 'image' && addImage.value.trim()) {
          var img = document.createElement('img');
          img.src = addImage.value.trim();
          img.alt = name || '';
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = 'cover';
          previewTile.style.background = 'var(--tile-img-bg)';
          previewTile.appendChild(img);
        } else {
          // 文字模式（color / auto 预览）：tile 显示带颜色的字母
          var span = document.createElement('span');
          span.textContent = ch;
          previewTile.classList.add(mode === 'color' ? chosenColor : 'blue');
          previewTile.appendChild(span);
        }
      }

      // 自动抓取 favicon：根目录 → HTML 声明 → 失败用随机颜色
      // （RANDOM_COLORS 已在顶部 CONFIG 声明）
      function pickRandomColor() {
        return RANDOM_COLORS[Math.floor(Math.random() * RANDOM_COLORS.length)];
      }
      function normalizeUrl(u) {
        if (!u) return '';
        // file: 等本地/特殊协议不要自动补 http://（如 file:///D:/test/index.html）
        if (/^(file|mailto|javascript|data|about|chrome|chrome-extension|ftp):/i.test(u)) return u;
        if (!/^https?:\/\//i.test(u)) return 'http://' + u;
        return u;
      }
      function originOf(u) {
        try { return new URL(u).origin; } catch (e) { return ''; }
      }

      // 异步加载图片，成功返回 URL，失败返回 null
      function tryImage(url) {
        return new Promise(function (resolve) {
          var img = new Image();
          img.onload = function () { resolve(url); };
          img.onerror = function () { resolve(null); };
          img.src = url;
        });
      }

      function fetchFavicon(url) {
        var origin = originOf(url);
        if (!origin) return Promise.resolve(null);
        var hostname = new URL(origin).hostname;

        var candidates = [
          'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(hostname) + '&sz=64',
          'https://icons.duckduckgo.com/ip3/' + hostname + '.ico',
          'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=' + encodeURIComponent(origin) + '&size=64',
          origin + '/favicon.ico',
          origin + '/favicon.png',
          origin + '/favicon.svg'
        ];

        function fetchHtml(url) {
          return fetch(url, { method: 'GET', signal: AbortSignal.timeout(4000) })
            .then(function (r) {
              if (!r.ok) throw new Error('fetch failed');
              return r.text();
            })
            .catch(function () {
              var proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
              return fetch(proxyUrl, { method: 'GET', signal: AbortSignal.timeout(6000) })
                .then(function (r) { return r.text(); })
                .catch(function () { return ''; });
            });
        }

        var htmlPromise = fetchHtml(origin)
          .then(function (html) {
            if (!html) return null;
            var m = html.match(/<link[^>]+rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]+href=["']([^"']+)["']/i)
                  || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:icon|shortcut icon|apple-touch-icon)["']/i);
            if (m && m[1]) {
              var href = m[1];
              if (/^https?:\/\//i.test(href)) return href;
              if (href.startsWith('//')) return 'http:' + href;
              if (href.startsWith('/')) return origin + href;
              return origin + '/' + href;
            }
            return null;
          });

        var imagePromises = candidates.map(tryImage);
        imagePromises.push(
          htmlPromise.then(function (h) { return h ? tryImage(h).then(function (ok) { return ok ? h : null; }) : null; })
        );

        return new Promise(function (resolve) {
          var resolved = false;
          imagePromises.forEach(function (p) {
            p.then(function (iconUrl) {
              if (resolved) return;
              if (iconUrl) { resolved = true; resolve(iconUrl); }
            });
          });
          setTimeout(function () {
            if (!resolved) { resolved = true; resolve(null); }
          }, 3000);
        });
      }

      // ========== 站点图标自动去底与杂边清理（SVG / ICO / PNG / JPEG / WebP） ==========
      function isLightNeutralColor(r, g, b) {
        var mn = Math.min(r, g, b);
        var mx = Math.max(r, g, b);
        return mn >= 215 && (mx - mn) <= 22;
      }

      function clampByte(n) {
        return n < 0 ? 0 : (n > 255 ? 255 : Math.round(n));
      }

      function colorChebyshev(a, b) {
        return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
      }

      function parseSvgColor(str) {
        if (!str || typeof str !== 'string') return null;
        var s = str.trim().toLowerCase();
        if (!s || s === 'none' || s === 'transparent') return [0, 0, 0, 0];
        if (s === 'white') return [255, 255, 255, 1];
        if (s === 'black') return [0, 0, 0, 1];
        var m = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
        if (m) {
          var h = m[1];
          if (h.length === 3 || h.length === 4) {
            var r3 = parseInt(h[0] + h[0], 16);
            var g3 = parseInt(h[1] + h[1], 16);
            var b3 = parseInt(h[2] + h[2], 16);
            var a3 = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1;
            return [r3, g3, b3, a3];
          }
          var r6 = parseInt(h.slice(0, 2), 16);
          var g6 = parseInt(h.slice(2, 4), 16);
          var b6 = parseInt(h.slice(4, 6), 16);
          var a6 = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
          return [r6, g6, b6, a6];
        }
        m = s.match(/^rgba?\(\s*([\d.]+%?)[,\s]+([\d.]+%?)[,\s]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
        if (m) {
          var to255 = function (v) { return v.indexOf('%') !== -1 ? clampByte(parseFloat(v) * 2.55) : clampByte(parseFloat(v)); };
          var alpha = 1;
          if (m[4] !== undefined) {
            alpha = m[4].indexOf('%') !== -1 ? Math.max(0, Math.min(1, parseFloat(m[4]) / 100)) : Math.max(0, Math.min(1, parseFloat(m[4])));
          }
          return [to255(m[1]), to255(m[2]), to255(m[3]), alpha];
        }
        return null;
      }

      function parseSvgAttrMap(attrStr) {
        var map = Object.create(null);
        if (!attrStr) return map;
        var re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
        var m;
        while ((m = re.exec(attrStr)) !== null) {
          map[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
        }
        return map;
      }

      function parseInlineCssDecls(styleText) {
        var decls = Object.create(null);
        if (!styleText) return decls;
        styleText.split(';').forEach(function (part) {
          var idx = part.indexOf(':');
          if (idx === -1) return;
          var prop = part.slice(0, idx).trim().toLowerCase();
          var val = part.slice(idx + 1).trim();
          if (prop && val) decls[prop] = val;
        });
        return decls;
      }

      function parseSvgClassStyles(svgText) {
        var clsMap = Object.create(null);
        var styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
        var sm;
        while ((sm = styleRe.exec(svgText)) !== null) {
          var css = sm[1].replace(/\/\*[\s\S]*?\*\//g, '');
          var ruleRe = /([^{}]+)\{([^}]*)\}/g;
          var rm;
          while ((rm = ruleRe.exec(css)) !== null) {
            var sels = rm[1].split(',');
            var decls = parseInlineCssDecls(rm[2]);
            sels.forEach(function (sel) {
              var m = sel.trim().match(/^\.([A-Za-z0-9_-]+)$/);
              if (m) clsMap[m[1]] = Object.assign(clsMap[m[1]] || Object.create(null), decls);
            });
          }
        }
        return clsMap;
      }

      function parseSvgLength(val, refSize) {
        if (val === undefined || val === null || val === '') return NaN;
        var s = String(val).trim();
        if (s.slice(-1) === '%') {
          var pct = parseFloat(s.slice(0, -1));
          return isNaN(pct) || !refSize ? NaN : (pct / 100) * refSize;
        }
        var num = parseFloat(s);
        return isNaN(num) ? NaN : num;
      }

      function isFullRectPath(dAttr, vbX, vbY, vbW, vbH) {
        if (!dAttr || !vbW || !vbH) return false;
        var s = dAttr.trim();
        var mMatch = s.match(/^M\s*([-\d.]+)[,\s]+([-\d.]+)\s*(.+)$/i);
        if (!mMatch) return false;
        var x0 = parseFloat(mMatch[1]);
        var y0 = parseFloat(mMatch[2]);
        var rest = mMatch[3].replace(/z\s*$/i, '').trim();
        if (Math.abs(x0 - vbX) > vbW * 0.1 || Math.abs(y0 - vbY) > vbH * 0.1) return false;
        var mHV = rest.match(/^h\s*([\d.]+)\s*v\s*([\d.]+)\s*h\s*-([\d.]+)/i);
        if (mHV) {
          return parseFloat(mHV[1]) >= vbW * 0.85 && parseFloat(mHV[2]) >= vbH * 0.85;
        }
        var mVH = rest.match(/^v\s*([\d.]+)\s*h\s*([\d.]+)\s*v\s*-([\d.]+)/i);
        if (mVH) {
          return parseFloat(mVH[2]) >= vbW * 0.85 && parseFloat(mVH[1]) >= vbH * 0.85;
        }
        var mL = rest.match(/^L\s*([-\d.]+)[,\s]+([-\d.]+)\s*L\s*([-\d.]+)[,\s]+([-\d.]+)\s*L\s*([-\d.]+)[,\s]+([-\d.]+)$/i);
        if (mL) {
          var xs = [x0, parseFloat(mL[1]), parseFloat(mL[3]), parseFloat(mL[5])];
          var ys = [y0, parseFloat(mL[2]), parseFloat(mL[4]), parseFloat(mL[6])];
          var spanX = Math.max.apply(null, xs) - Math.min.apply(null, xs);
          var spanY = Math.max.apply(null, ys) - Math.min.apply(null, ys);
          return spanX >= vbW * 0.85 && spanY >= vbH * 0.85;
        }
        return false;
      }

      function cleanSvgMarkup(svgText) {
        if (typeof svgText !== 'string' || !/<svg\b/i.test(svgText)) return svgText;
        var svgOpenMatch = svgText.match(/<svg\b([^>]*)>/i);
        if (!svgOpenMatch) return svgText;
        var rootAttrs = parseSvgAttrMap(svgOpenMatch[1]);
        var vbX = 0, vbY = 0, vbW = NaN, vbH = NaN;
        if (rootAttrs.viewbox) {
          var vbNums = rootAttrs.viewbox.trim().split(/[\s,]+/).map(Number);
          if (vbNums.length === 4 && vbNums.every(function (n) { return !isNaN(n); })) {
            vbX = vbNums[0]; vbY = vbNums[1]; vbW = vbNums[2]; vbH = vbNums[3];
          }
        }
        var svgW = parseSvgLength(rootAttrs.width, NaN);
        var svgH = parseSvgLength(rootAttrs.height, NaN);
        if (!(vbW > 0)) vbW = svgW;
        if (!(vbH > 0)) vbH = svgH;

        var clsMap = parseSvgClassStyles(svgText);
        var resultText = svgText;
        var rootBgRemoved = false;
        if (rootAttrs.style) {
          var strippedStyle = rootAttrs.style.replace(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/gi, function (full, val) {
            var rgba = parseSvgColor(val);
            if (rgba && rgba[3] >= 0.85 && isLightNeutralColor(rgba[0], rgba[1], rgba[2])) {
              rootBgRemoved = true;
              return '';
            }
            return full;
          }).replace(/^\s*;+\s*/, '');
          if (rootBgRemoved) {
            var newOpenTag = svgOpenMatch[0].replace(rootAttrs.style, strippedStyle);
            resultText = resultText.slice(0, svgOpenMatch.index) + newOpenTag + resultText.slice(svgOpenMatch.index + svgOpenMatch[0].length);
          }
        }

        // 扫描标签：仅移除 <defs>/<clipPath>/<mask> 外部、位于前景图形之前的满画布浅中性色背景矩形
        var hiddenTags = { defs: 1, clippath: 1, mask: 1, pattern: 1, symbol: 1 };
        var shapeTags = { path: 1, circle: 1, ellipse: 1, polygon: 1, polyline: 1, rect: 1, text: 1, line: 1, image: 1, use: 1 };
        var tagRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z_:][-a-zA-Z0-9_:.]*)(\s[^>]*)?\s*\/?>/g;
        var hiddenDepth = 0;
        var seenForeground = false;
        var removals = [];
        var remainingShapes = 0;
        var tm;

        while ((tm = tagRe.exec(resultText)) !== null) {
          var fullTag = tm[0];
          if (fullTag.indexOf('<!--') === 0) continue;
          var rawName = tm[1].toLowerCase();
          var colonIdx = rawName.indexOf(':');
          var tagName = colonIdx !== -1 ? rawName.slice(colonIdx + 1) : rawName;
          var isClose = fullTag.charAt(1) === '/';
          var isSelfClose = /\/>\s*$/.test(fullTag);

          if (hiddenTags[tagName]) {
            if (isClose) hiddenDepth = Math.max(0, hiddenDepth - 1);
            else if (!isSelfClose) hiddenDepth++;
            continue;
          }
          if (hiddenDepth > 0 || isClose || !shapeTags[tagName]) continue;

          var attrs = parseSvgAttrMap(tm[2] || '');
          var styleDecls = parseInlineCssDecls(attrs.style || '');
          var clsDecls = null;
          if (attrs['class']) {
            attrs['class'].trim().split(/\s+/).forEach(function (cn) {
              if (clsMap[cn]) clsDecls = Object.assign(clsDecls || Object.create(null), clsMap[cn]);
            });
          }
          var getStyleVal = function (prop) {
            return styleDecls[prop] !== undefined ? styleDecls[prop] : (attrs[prop] !== undefined ? attrs[prop] : (clsDecls ? clsDecls[prop] : undefined));
          };

          var isBgCandidate = false;
          if (!seenForeground && (tagName === 'rect' || tagName === 'path')) {
            var fillVal = getStyleVal('fill');
            var fillRgba = parseSvgColor(fillVal);
            var fillOpacity = parseFloat(getStyleVal('fill-opacity'));
            var elemOpacity = parseFloat(getStyleVal('opacity'));
            var effAlpha = (fillRgba ? fillRgba[3] : 1) * (isNaN(fillOpacity) ? 1 : fillOpacity) * (isNaN(elemOpacity) ? 1 : elemOpacity);

            var strokeVal = getStyleVal('stroke');
            var strokeRgba = parseSvgColor(strokeVal);
            var hasColoredStroke = strokeRgba && strokeRgba[3] > 0.15 && !isLightNeutralColor(strokeRgba[0], strokeRgba[1], strokeRgba[2]);

            if (fillRgba && effAlpha >= 0.85 && isLightNeutralColor(fillRgba[0], fillRgba[1], fillRgba[2]) && !hasColoredStroke) {
              if (tagName === 'rect') {
                var wRaw = attrs.width;
                var hRaw = attrs.height;
                var fullByPct = String(wRaw || '').trim() === '100%' && String(hRaw || '').trim() === '100%';
                var rw = parseSvgLength(wRaw, vbW);
                var rh = parseSvgLength(hRaw, vbH);
                var rx = attrs.x !== undefined ? parseSvgLength(attrs.x, vbW) : vbX;
                var ry = attrs.y !== undefined ? parseSvgLength(attrs.y, vbH) : vbY;
                var fullByNum = vbW > 0 && vbH > 0 && rw >= vbW * 0.85 && rh >= vbH * 0.85 &&
                  Math.abs((isNaN(rx) ? 0 : rx) - vbX) <= vbW * 0.1 && Math.abs((isNaN(ry) ? 0 : ry) - vbY) <= vbH * 0.1;
                if (fullByPct || fullByNum) isBgCandidate = true;
              } else if (tagName === 'path' && isFullRectPath(attrs.d, vbX, vbY, vbW, vbH)) {
                isBgCandidate = true;
              }
            }
          }

          if (isBgCandidate) {
            var removeEnd = tm.index + fullTag.length;
            if (!isSelfClose) {
              var closeRe = new RegExp('<\\/' + rawName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*>', 'i');
              var afterSlice = resultText.slice(removeEnd);
              var closeMatch = closeRe.exec(afterSlice);
              if (closeMatch) {
                removeEnd += closeMatch.index + closeMatch[0].length;
                tagRe.lastIndex = removeEnd;
              }
            }
            removals.push([tm.index, removeEnd]);
          } else {
            seenForeground = true;
            remainingShapes++;
          }
        }

        if (!removals.length && !rootBgRemoved) return svgText;
        if (remainingShapes === 0) return svgText; // 防误删全白剪影图标

        var rebuilt = resultText;
        for (var i = removals.length - 1; i >= 0; i--) {
          rebuilt = rebuilt.slice(0, removals[i][0]) + rebuilt.slice(removals[i][1]);
        }
        return rebuilt;
      }

      function cleanSvgDataUrl(dataUrl) {
        if (typeof dataUrl !== 'string' || !/^data:image\/svg\+xml/i.test(dataUrl)) {
          return { dataUrl: dataUrl, changed: false };
        }
        var commaIdx = dataUrl.indexOf(',');
        if (commaIdx === -1) return { dataUrl: dataUrl, changed: false };
        var meta = dataUrl.slice(0, commaIdx);
        var payload = dataUrl.slice(commaIdx + 1);
        var isBase64 = /;base64/i.test(meta);
        var svgText = '';
        try {
          if (isBase64) {
            var bin = atob(payload.replace(/\s+/g, ''));
            if (typeof TextDecoder !== 'undefined') {
              var bytes = new Uint8Array(bin.length);
              for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              svgText = new TextDecoder('utf-8').decode(bytes);
            } else {
              svgText = decodeURIComponent(escape(bin));
            }
          } else {
            svgText = decodeURIComponent(payload);
          }
        } catch (e) {
          return { dataUrl: dataUrl, changed: false };
        }
        var cleaned = cleanSvgMarkup(svgText);
        if (!cleaned || cleaned === svgText) return { dataUrl: dataUrl, changed: false };
        try {
          if (isBase64) {
            var outBin = '';
            if (typeof TextEncoder !== 'undefined') {
              var enc = new TextEncoder().encode(cleaned);
              for (var j = 0; j < enc.length; j++) outBin += String.fromCharCode(enc[j]);
            } else {
              outBin = unescape(encodeURIComponent(cleaned));
            }
            return { dataUrl: meta + ',' + btoa(outBin), changed: true };
          }
          return { dataUrl: meta + ',' + encodeURIComponent(cleaned), changed: true };
        } catch (e2) {
          return { dataUrl: dataUrl, changed: false };
        }
      }

      function medianByte(arr) {
        if (!arr.length) return 0;
        var sorted = arr.slice().sort(function (a, b) { return a - b; });
        return sorted[Math.floor(sorted.length / 2)];
      }

      // 纯像素缓冲清洗：剥除最外侧 1–2px 杂线（如顶部黑线），再从边缘洪泛消除浅中性纯色底并做 1px 抗锯齿羽化
      function cleanIconImageData(data, width, height) {
        if (!data || !width || !height || data.length < width * height * 4) {
          return { changed: false, data: data, width: width, height: height };
        }
        var out = new Uint8ClampedArray(data);
        var changed = false;

        var checkArtifactStrip = function (side, thick) {
          var len = (side === 0 || side === 1) ? width : height;
          var depth = (side === 0 || side === 1) ? height : width;
          if (thick >= depth - 2 || len < 4) return null;

          var getPx = function (along, inward) {
            var x = side === 2 ? inward : (side === 3 ? (width - 1 - inward) : along);
            var y = side === 0 ? inward : (side === 1 ? (height - 1 - inward) : along);
            var idx = (y * width + x) * 4;
            return [out[idx], out[idx + 1], out[idx + 2], out[idx + 3]];
          };

          var rs = [], gs = [], bs = [], opaqueOuter = 0, totalOuter = len * thick;
          for (var t = 0; t < thick; t++) {
            for (var a = 0; a < len; a++) {
              var p = getPx(a, t);
              if (p[3] >= 180) {
                opaqueOuter++;
                rs.push(p[0]); gs.push(p[1]); bs.push(p[2]);
              }
            }
          }
          if (opaqueOuter < totalOuter * 0.85 || !rs.length) return null;
          var med = [medianByte(rs), medianByte(gs), medianByte(bs)];
          // 浅白/浅灰底由 Pass 2 统一消除，Pass 1 专注杂边线（含深色黑线/彩线）
          var matchOuter = 0;
          for (var t2 = 0; t2 < thick; t2++) {
            for (var a2 = 0; a2 < len; a2++) {
              var p2 = getPx(a2, t2);
              if (p2[3] >= 180 && colorChebyshev(p2, med) <= 38) matchOuter++;
            }
          }
          if (matchOuter < totalOuter * 0.85) return null;

          var adjSafe = 0;
          for (var a3 = 0; a3 < len; a3++) {
            var pa = getPx(a3, thick);
            var isClearOrLightBg = pa[3] < 24 || (isLightNeutralColor(pa[0], pa[1], pa[2]) && colorChebyshev(pa, med) >= 60);
            if (isClearOrLightBg) adjSafe++;
          }
          if (adjSafe < len * 0.85) return null;

          // 检查内邻行两端点，避免误伤完整四边边框
          var endA = getPx(0, thick);
          var endB = getPx(len - 1, thick);
          var endASafe = endA[3] < 24 || (isLightNeutralColor(endA[0], endA[1], endA[2]) && colorChebyshev(endA, med) >= 60);
          var endBSafe = endB[3] < 24 || (isLightNeutralColor(endB[0], endB[1], endB[2]) && colorChebyshev(endB, med) >= 60);
          if (!endASafe || !endBSafe) return null;

          return { side: side, thick: thick, med: med };
        };

        var matchedStrips = [];
        for (var side = 0; side < 4; side++) {
          var maxT = ((side < 2 ? height : width) >= 64) ? 2 : 1;
          var hit = null;
          for (var tt = maxT; tt >= 1; tt--) {
            hit = checkArtifactStrip(side, tt);
            if (hit) break;
          }
          if (hit) matchedStrips.push(hit);
        }
        // 若四条边都命中同一颜色，视为刻意线框而非杂线
        if (matchedStrips.length > 0 && matchedStrips.length < 4) {
          matchedStrips.forEach(function (st) {
            var len = (st.side === 0 || st.side === 1) ? width : height;
            for (var t = 0; t < st.thick; t++) {
              for (var a = 0; a < len; a++) {
                var x = st.side === 2 ? t : (st.side === 3 ? (width - 1 - t) : a);
                var y = st.side === 0 ? t : (st.side === 1 ? (height - 1 - t) : a);
                var idx = (y * width + x) * 4;
                out[idx] = out[idx + 1] = out[idx + 2] = out[idx + 3] = 0;
              }
            }
            changed = true;
          });
        }

        // Pass 2：从画布外围透明边界穿透至实底像素，收集外缘不透明像素
        var totalPx = width * height;
        var seenTrans = new Uint8Array(totalPx);
        var seenBorderOpq = new Uint8Array(totalPx);
        var transQ = [];
        var borderOpq = [];
        var sideHits = [0, 0, 0, 0];

        var pushPerimeter = function (x, y, sideMask) {
          var p = y * width + x;
          var idx = p * 4;
          if (out[idx + 3] < 24) {
            if (!seenTrans[p]) { seenTrans[p] = 1; transQ.push(p); }
          } else if (!seenBorderOpq[p]) {
            seenBorderOpq[p] = 1;
            borderOpq.push(p);
            if (isLightNeutralColor(out[idx], out[idx + 1], out[idx + 2]) && out[idx + 3] >= 200) {
              for (var s = 0; s < 4; s++) { if (sideMask & (1 << s)) sideHits[s]++; }
            }
          }
        };
        for (var bx = 0; bx < width; bx++) {
          pushPerimeter(bx, 0, 1);
          pushPerimeter(bx, height - 1, 2);
        }
        for (var by = 0; by < height; by++) {
          pushPerimeter(0, by, 4);
          pushPerimeter(width - 1, by, 8);
        }

        var dx = [1, -1, 0, 0];
        var dy = [0, 0, 1, -1];
        var tHead = 0;
        while (tHead < transQ.length) {
          var tp = transQ[tHead++];
          var tx = tp % width, ty = (tp - tx) / width;
          for (var d = 0; d < 4; d++) {
            var nx = tx + dx[d], ny = ty + dy[d];
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            var np = ny * width + nx;
            var nidx = np * 4;
            if (out[nidx + 3] < 24) {
              if (!seenTrans[np]) { seenTrans[np] = 1; transQ.push(np); }
            } else if (!seenBorderOpq[np]) {
              seenBorderOpq[np] = 1;
              borderOpq.push(np);
              if (isLightNeutralColor(out[nidx], out[nidx + 1], out[nidx + 2]) && out[nidx + 3] >= 200) {
                if (ny < height / 2) sideHits[0]++; else sideHits[1]++;
                if (nx < width / 2) sideHits[2]++; else sideHits[3]++;
              }
            }
          }
        }

        var lightSeeds = [];
        var lRs = [], lGs = [], lBs = [];
        for (var bi = 0; bi < borderOpq.length; bi++) {
          var bp = borderOpq[bi];
          var bidx = bp * 4;
          var r = out[bidx], g = out[bidx + 1], b = out[bidx + 2], a = out[bidx + 3];
          if (a >= 200 && isLightNeutralColor(r, g, b)) {
            lightSeeds.push(bp);
            lRs.push(r); lGs.push(g); lBs.push(b);
          }
        }

        var activeSides = (sideHits[0] > 0 ? 1 : 0) + (sideHits[1] > 0 ? 1 : 0) + (sideHits[2] > 0 ? 1 : 0) + (sideHits[3] > 0 ? 1 : 0);
        if (lightSeeds.length >= 4 && activeSides >= 2 && lightSeeds.length >= borderOpq.length * 0.6) {
          var bgColor = [medianByte(lRs), medianByte(lGs), medianByte(lBs)];
          var matchingSeeds = lightSeeds.filter(function (sp) {
            var sidx = sp * 4;
            return colorChebyshev([out[sidx], out[sidx + 1], out[sidx + 2]], bgColor) <= 28;
          });
          if (matchingSeeds.length >= borderOpq.length * 0.6) {
            var visitedFill = new Uint8Array(totalPx);
            var visitedBg = new Uint8Array(totalPx);
            var fillQ = [];
            matchingSeeds.forEach(function (sp) {
              visitedFill[sp] = 1;
              visitedBg[sp] = 1;
              fillQ.push(sp);
            });
            var fHead = 0;
            while (fHead < fillQ.length) {
              var fp = fillQ[fHead++];
              var fx = fp % width, fy = (fp - fx) / width;
              for (var fd = 0; fd < 4; fd++) {
                var fnx = fx + dx[fd], fny = fy + dy[fd];
                if (fnx < 0 || fnx >= width || fny < 0 || fny >= height) continue;
                var fnp = fny * width + fnx;
                if (visitedFill[fnp]) continue;
                var fidx = fnp * 4;
                var fa = out[fidx + 3];
                if (fa < 24) {
                  if (seenTrans[fnp]) { visitedFill[fnp] = 1; fillQ.push(fnp); }
                  continue;
                }
                var fr = out[fidx], fg = out[fidx + 1], fb = out[fidx + 2];
                var mn = Math.min(fr, fg, fb), mx = Math.max(fr, fg, fb);
                if (mn >= 205 && (mx - mn) <= 30 && colorChebyshev([fr, fg, fb], bgColor) <= 32) {
                  visitedFill[fnp] = 1;
                  visitedBg[fnp] = 1;
                  fillQ.push(fnp);
                }
              }
            }

            // 防误删保护：若超过 95% 原不透明像素都会被清掉（或剩余少于 4 像素），则放弃本次消底
            var origOpaque = 0, remainOpaque = 0;
            for (var pi = 0; pi < totalPx; pi++) {
              if (out[pi * 4 + 3] >= 24) {
                origOpaque++;
                if (!visitedBg[pi]) remainOpaque++;
              }
            }
            if (origOpaque > 0 && remainOpaque >= Math.max(4, Math.floor(origOpaque * 0.04))) {
              var origCopy = new Uint8ClampedArray(out);
              for (var py = 0; py < height; py++) {
                for (var px = 0; px < width; px++) {
                  var cp = py * width + px;
                  var cidx = cp * 4;
                  if (visitedBg[cp]) {
                    out[cidx] = out[cidx + 1] = out[cidx + 2] = out[cidx + 3] = 0;
                  } else if (origCopy[cidx + 3] > 0) {
                    var adjBg = false;
                    for (var oy = -1; oy <= 1 && !adjBg; oy++) {
                      for (var ox = -1; ox <= 1; ox++) {
                        var ax = px + ox, ay = py + oy;
                        if (ax >= 0 && ax < width && ay >= 0 && ay < height && visitedBg[ay * width + ax]) {
                          adjBg = true;
                          break;
                        }
                      }
                    }
                    if (adjBg) {
                      var cr = origCopy[cidx], cg = origCopy[cidx + 1], cb = origCopy[cidx + 2], ca = origCopy[cidx + 3];
                      var dist = colorChebyshev([cr, cg, cb], bgColor);
                      var cmx = Math.max(cr, cg, cb), cmn = Math.min(cr, cg, cb);
                      if (dist <= 72 && cmx >= 175 && cmn >= 120) {
                        var blend = Math.max(0, Math.min(1, (dist - 20) / 56));
                        out[cidx + 3] = clampByte(ca * blend);
                        if (blend > 0.08) {
                          out[cidx]     = clampByte((cr - (1 - blend) * bgColor[0]) / blend);
                          out[cidx + 1] = clampByte((cg - (1 - blend) * bgColor[1]) / blend);
                          out[cidx + 2] = clampByte((cb - (1 - blend) * bgColor[2]) / blend);
                        }
                      }
                    }
                  }
                }
              }
              changed = true;
            }
          }
        }

        return { changed: changed, data: out, width: width, height: height };
      }

      var _canCleanRasterCached = null;
      function canCleanRaster() {
        if (_canCleanRasterCached !== null) return _canCleanRasterCached;
        try {
          if (typeof document === 'undefined' || typeof Image === 'undefined') {
            _canCleanRasterCached = false;
            return false;
          }
          var c = document.createElement('canvas');
          var ctx = c && typeof c.getContext === 'function' ? c.getContext('2d') : null;
          _canCleanRasterCached = !!(ctx && typeof ctx.getImageData === 'function' && typeof c.toDataURL === 'function');
        } catch (e) {
          _canCleanRasterCached = false;
        }
        return _canCleanRasterCached;
      }

      function renderCleanedRasterToDataUrl(data, width, height) {
        var c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        var ctx = c.getContext('2d');
        var imgData = ctx.createImageData(width, height);
        imgData.data.set(data);
        ctx.putImageData(imgData, 0, 0);

        // 计算有效不透明边界框；若裁去杂边/纯色底后留白过多或非正方形，居中回方画布
        var minX = width, minY = height, maxX = -1, maxY = -1;
        for (var y = 0; y < height; y++) {
          for (var x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] >= 16) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        var outCanvas = c;
        if (maxX >= minX && maxY >= minY) {
          var cw = maxX - minX + 1;
          var ch = maxY - minY + 1;
          var excessMargin = (minX > width * 0.1 || (width - 1 - maxX) > width * 0.1 || minY > height * 0.1 || (height - 1 - maxY) > height * 0.1);
          if (width !== height || excessMargin) {
            var box = Math.min(256, Math.max(64, Math.max(cw, ch)));
            var pad = Math.round(box * 0.06);
            var target = box - pad * 2;
            var scale = Math.min(target / cw, target / ch);
            var dw = Math.max(1, Math.round(cw * scale));
            var dh = Math.max(1, Math.round(ch * scale));
            outCanvas = document.createElement('canvas');
            outCanvas.width = box;
            outCanvas.height = box;
            var octx = outCanvas.getContext('2d');
            octx.imageSmoothingEnabled = true;
            octx.imageSmoothingQuality = 'high';
            octx.drawImage(c, minX, minY, cw, ch, Math.round((box - dw) / 2), Math.round((box - dh) / 2), dw, dh);
          }
        }
        var outUrl = outCanvas.toDataURL('image/png');
        if (outUrl.length > ICON_MAX_SINGLE_BYTES && outCanvas.width > 128) {
          var small = document.createElement('canvas');
          small.width = 128;
          small.height = 128;
          var sctx = small.getContext('2d');
          sctx.imageSmoothingEnabled = true;
          sctx.imageSmoothingQuality = 'high';
          sctx.drawImage(outCanvas, 0, 0, 128, 128);
          outUrl = small.toDataURL('image/png');
        }
        return outUrl;
      }

      function cleanIconDataUrl(dataUrl) {
        if (!dataUrl || typeof dataUrl !== 'string' || !/^data:image\//i.test(dataUrl)) {
          return Promise.resolve({ dataUrl: dataUrl || '', changed: false, processed: false });
        }
        if (/^data:image\/svg\+xml/i.test(dataUrl)) {
          var svgRes = cleanSvgDataUrl(dataUrl);
          return Promise.resolve({ dataUrl: svgRes.dataUrl, changed: svgRes.changed, processed: true });
        }
        if (!/^data:image\/(?:png|x-icon|vnd\.microsoft\.icon|ico|jpeg|jpg|webp|bmp)/i.test(dataUrl) || !canCleanRaster()) {
          return Promise.resolve({ dataUrl: dataUrl, changed: false, processed: false });
        }
        return new Promise(function (resolve) {
          var settled = false;
          var img = new Image();
          var timer = setTimeout(function () {
            if (settled) return;
            settled = true;
            resolve({ dataUrl: dataUrl, changed: false, processed: false });
          }, 2000);
          img.onload = function () {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
              var natW = img.naturalWidth || img.width || 0;
              var natH = img.naturalHeight || img.height || 0;
              if (!natW || !natH) { resolve({ dataUrl: dataUrl, changed: false, processed: false }); return; }
              var scale = Math.min(1, 256 / Math.max(natW, natH));
              var w = Math.max(1, Math.round(natW * scale));
              var h = Math.max(1, Math.round(natH * scale));
              var canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              var ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, w, h);
              var imgData = ctx.getImageData(0, 0, w, h);
              var res = cleanIconImageData(imgData.data, w, h);
              if (!res.changed) {
                resolve({ dataUrl: dataUrl, changed: false, processed: true });
                return;
              }
              var cleanedUrl = renderCleanedRasterToDataUrl(res.data, w, h);
              resolve({ dataUrl: cleanedUrl || dataUrl, changed: !!cleanedUrl && cleanedUrl !== dataUrl, processed: true });
            } catch (e) {
              resolve({ dataUrl: dataUrl, changed: false, processed: false });
            }
          };
          img.onerror = function () {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ dataUrl: dataUrl, changed: false, processed: false });
          };
          img.src = dataUrl;
        });
      }

      function cleanIconDataUrlStr(dataUrl) {
        return cleanIconDataUrl(dataUrl).then(function (res) {
          return (res && res.dataUrl) ? res.dataUrl : (dataUrl || null);
        }).catch(function () { return dataUrl || null; });
      }

      // 把图标转成 data URL 缓存到本地，避免每次进页面都重新联网加载。
      // 扩展环境有 host_permissions，fetch 可跨域；失败返回 null（调用方退回用远程 URL）。
      function cacheImageAsDataUrl(url) {
        if (!url) return Promise.resolve(null);
        if (/^data:/i.test(url)) return cleanIconDataUrlStr(url);
        return fetch(url, { mode: 'cors', signal: AbortSignal.timeout(8000) })
          .then(function (r) {
            if (!r.ok) throw new Error('http ' + r.status);
            return r.blob();
          })
          .then(function (blob) {
            if (blob.size <= 0 || blob.size > ICON_MAX_SINGLE_BYTES) return null; // 太大或空图不缓存
            return new Promise(function (resolve) {
              var fr = new FileReader();
              fr.onload = function () { resolve(typeof fr.result === 'string' ? fr.result : null); };
              fr.onerror = function () { resolve(null); };
              fr.readAsDataURL(blob);
            });
          })
          .then(function (rawUrl) {
            return rawUrl ? cleanIconDataUrlStr(rawUrl) : null;
          })
          .catch(function () { return null; });
      }

      // 异步抓取并替换：抓到就把 list 对应项改成 image + 本地缓存(data URL) 并持久化；失败用 fallback 颜色
      function applyAutoIcon(cardEl, itemIndex, fallbackColor) {
         var item = list[itemIndex];
         if (!item) return;
         fetchFavicon(item.url).then(function (iconUrl) {
           if (iconUrl) {
             // 尽量转成 data URL 本地缓存（下次进页面秒开）；转不了就退回存远程 URL
             return cacheImageAsDataUrl(iconUrl).then(function (dataUrl) {
               item.iconSrc = 'image';
               item.icon = iconUrl;
               if (dataUrl) putIconToDB(iconUrl, dataUrl, Date.now());
               save(list);
               updateCardContent(cardEl, item);
             });
           }
           // 抓不到，保持 color 模式 + 随机色
           item.iconSrc = 'color';
           item.color = fallbackColor;
           save(list);
           // 就地更新卡片，不重绘避免已有卡片闪烁
           updateCardContent(cardEl, item);
         });
       }

      // 打开添加弹窗（支持主页或指定文件夹内添加/编辑）
      var editingIndex = -1; // ≥0 表示编辑模式
      var targetFolderId = null;
      var openFolderId = null;
      function findFolderById(fid) {
        if (!fid) return null;
        for (var i = 0; i < list.length; i++) {
          if (isFolderItem(list[i]) && list[i].id === fid) return list[i];
        }
        return null;
      }
      function openAddModal(folderId) {
        addForm.reset();
        editingIndex = -1;
        addImageField.style.display = 'none';
        addColorField.style.display = 'none';
        addLetterField.style.display = 'none';
        chosenColor = 'blue';
        addColorPicker.querySelectorAll('.color-dot').forEach(function (d) { d.classList.remove('selected'); });
        addColorPicker.querySelector('.color-dot').classList.add('selected');
        // 默认选中"自动抓取"
        addForm.querySelector('input[name="iconSrc"][value="auto"]').checked = true;
        updatePreview();
        document.querySelector('#addTitle span').textContent = '添加快捷方式';
        openModal(addModal);
        setTimeout(function () { addName.focus(); }, 50);
      }

      slot.addEventListener('click', function () { targetFolderId = null; openAddModal(null); });
      slot.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          targetFolderId = null;
          openAddModal(null);
        }
      });
      var addCreateFolderBtn = document.getElementById('addCreateFolderBtn');
      if (addCreateFolderBtn) {
        addCreateFolderBtn.addEventListener('click', function () {
          var folderName = (addName.value || '').trim();
          if (!folderName) folderName = (prompt('输入新分组名称：', '新建分组') || '').trim();
          if (!folderName) return;
          var folder = { type: 'folder', id: makeFolderId(), name: folderName.slice(0, 20), children: [] };
          list.push(folder);
          save(list);
          appendCard(folder);
          closeModal(addModal);
          openFolderModal(folder.id);
        });
      }

      // 提交添加
      addForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = addName.value.trim();
        var url = normalizeUrl(addUrl.value.trim());
        if (!name) return;
        var mode = addForm.querySelector('input[name="iconSrc"]:checked').value;

        var item = { name: name, url: url };
        if (mode === 'image') {
          var iconUrl = addImage.value.trim();
          if (!iconUrl) { alert('请填写图片链接'); return; }
          item.iconSrc = 'image';
          item.icon = iconUrl;
        } else if (mode === 'color') {
          item.iconSrc = 'color';
          item.color = chosenColor;
          var customLetter = (addLetter.value || '').trim();
          if (customLetter) item.letter = customLetter;
        } else {
          // auto：先用随机色占位，后台异步替换
          item.iconSrc = 'auto';
          item.color = pickRandomColor();
        }

        var targetFolder = findFolderById(targetFolderId);
        if (targetFolder) {
          if (!Array.isArray(targetFolder.children)) targetFolder.children = [];
          if (editingIndex >= 0 && editingIndex < targetFolder.children.length) {
            targetFolder.children[editingIndex] = item;
          } else {
            targetFolder.children.push(item);
          }
          editingIndex = -1;
          targetFolderId = null;
          save(list);
          var rootFolderEl = nav.querySelector('.shortcut-folder[data-folder-id="' + targetFolder.id + '"]');
          if (rootFolderEl) updateCardContent(rootFolderEl, targetFolder);
          if (openFolderId === targetFolder.id) renderFolderGrid(targetFolder);
        } else if (editingIndex >= 0) {
          // 编辑模式：就地更新，不重绘避免闪烁
          list[editingIndex] = item;
          var existing = nav.querySelectorAll('.shortcut')[editingIndex];
          if (existing) updateCardContent(existing, item);
          editingIndex = -1;
          save(list);
        } else {
          // 添加模式：追加单卡（带入场动画），不重绘已有卡片
          list.push(item);
          var newCard = appendCard(item);
          if (mode === 'auto') {
            applyAutoIcon(newCard, list.length - 1, item.color);
          }
          save(list);
        }

        closeModal(addModal);
      });

      // ========== 菜单：导入 / 导出 / 清空 ==========
      var fabBtn = document.getElementById('fabBtn');
      if (!fabBtn) { console.error('fabBtn 未找到'); return; }
      var menuWrapper = document.getElementById('menuWrapper');
      var menu = document.getElementById('menu');
      var exportBtn = document.getElementById('exportBtn');
      var importBtn = document.getElementById('importBtn');
      var importFile = document.getElementById('importFile');
      var wallpaperBtn = document.getElementById('wallpaperBtn');
      var resetWallpaperBtn = document.getElementById('resetWallpaperBtn');
      var wallpaperFile = document.getElementById('wallpaperFile');
      var personalizeBtn = document.getElementById('personalizeBtn');
      var clearBtn = document.getElementById('clearBtn');

      var editBtn = document.getElementById('editBtn');
      var editBanner = document.getElementById('editBanner');
      var exitEditBtn = document.getElementById('exitEditBtn');
      var dropzone = document.getElementById('dropzone');

      function toggleMenu(force) {
        var willOpen = typeof force === 'boolean' ? force : !menuWrapper.classList.contains('open');
        menuWrapper.classList.toggle('open', willOpen);
      }

      function openModal(el) { el.classList.add('open'); el.setAttribute('aria-hidden', 'false'); }
      function closeModal(el) { el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); }

      function setEditBtnLabel(on) {
        var lbl = editBtn && editBtn.querySelector('.mi-label');
        if (lbl) lbl.textContent = on ? '退出编辑' : '编辑页面';
        else if (editBtn) editBtn.textContent = on ? '退出编辑' : '编辑页面';
      }

      function setEditing(on) {
        document.body.classList.toggle('editing', !!on);
        editBanner.classList.toggle('open', !!on);
        // 进入编辑模式时关闭菜单
        if (on) toggleMenu(false);
      }

      fabBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        // 弹窗通常从菜单打开：若已有弹窗打开，再点菜单按钮视为“返回”，关闭它
        var openModal = document.querySelector('.modal-mask.open');
        if (openModal) {
          closeModal(openModal);
          return;
        }
        toggleMenu();
      });

      // 菜单本身阻止冒泡，避免被外层 click 立刻关闭
      menuWrapper.addEventListener('click', function (e) { e.stopPropagation(); });

      // 点页面其他位置关闭菜单（fab 区域内任何点击都跳过）
      document.addEventListener('click', function (e) {
        if (fabBtn.contains(e.target)) return;
        if (menuWrapper.contains(e.target)) return;
        toggleMenu(false);
      });
      // 键盘快捷键
      document.addEventListener('keydown', function (e) {
        // Ctrl+E / Cmd+E → 切换专注模式并聚焦搜索
        if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
          e.preventDefault();
          document.body.classList.toggle('focus-mode');
          if (document.body.classList.contains('focus-mode')) {
            var si = document.getElementById('searchInput');
            if (si) { si.focus(); si.select(); }
          }
          return;
        }
        // Ctrl+K / Cmd+K → 切换编辑模式
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
          e.preventDefault();
          editing = !editing;
          setEditBtnLabel(editing);
          setEditing(editing);
          return;
        }
        // Ctrl+A / Cmd+A → 快速打开 AI 面板并聚焦输入框
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
          // 如果焦点在输入框内，让浏览器的全选行为正常执行
          var activeTag = document.activeElement ? document.activeElement.tagName : '';
          if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
          e.preventDefault();
          if (window.__motuo && window.__motuo.toggleAI) window.__motuo.toggleAI(true);
          var aiInp = document.getElementById('aiInput');
          if (aiInp) { setTimeout(function () { aiInp.focus(); }, 100); }
          return;
        }
        if (e.key === 'Escape') {
          toggleMenu(false);
          // 关闭所有弹窗
          document.querySelectorAll('.modal-mask.open').forEach(closeModal);
        }
      });

      // 弹窗关闭按钮 + 点击遮罩关闭
      document.querySelectorAll('[data-close]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          closeModal(document.getElementById(btn.getAttribute('data-close')));
        });
      });
      document.querySelectorAll('.modal-mask').forEach(function (mask) {
        mask.addEventListener('click', function (e) {
          if (e.target === mask) closeModal(mask);
        });
      });

      // ========== 编辑模式：删除自定义卡片 ==========
      var editing = false;
      editBtn.addEventListener('click', function () {
        editing = !editing;
        // 文字也跟随变化
        setEditBtnLabel(editing);
        setEditing(editing);
      });
      exitEditBtn.addEventListener('click', function () {
        editing = false;
        setEditBtnLabel(false);
        setEditing(false);
      });

      // ========== 编辑模式：智能拖拽（缝隙排序 / 主体入组 / 悬停建组 / 拖到底部删除） ==========
      var dragSrc = null; // 当前拖拽的主页卡片元素
      var lastDraggedEl = null;
      var justDraggedAt = 0;
      var dragInsertLine = document.getElementById('dragInsertLine');
      var dragIntentBadge = document.getElementById('dragIntentBadge');
      var dragIntent = { mode: 'none' };
      var mergeHoverTimer = null;
      var mergeCandidateEl = null;
      var MERGE_HOLD_MS = 450;
      var STICKY_MARGIN = 8;

      function cancelMergeTimer() {
        if (mergeHoverTimer) {
          clearTimeout(mergeHoverTimer);
          mergeHoverTimer = null;
        }
        mergeCandidateEl = null;
      }

      function hideDragVisuals() {
        nav.querySelectorAll('.shortcut.drop-into-folder').forEach(function (el) { el.classList.remove('drop-into-folder'); });
        nav.querySelectorAll('.shortcut.drop-merge-folder').forEach(function (el) { el.classList.remove('drop-merge-folder'); });
        if (dragInsertLine) dragInsertLine.classList.remove('visible');
        if (dragIntentBadge) dragIntentBadge.classList.remove('visible');
      }

      function clearDragFeedback() {
        cancelMergeTimer();
        hideDragVisuals();
        dragIntent = { mode: 'none' };
      }

      function getNormRect(el) {
        var r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        if (!r) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
        var w = r.width || 0;
        var h = r.height || 0;
        var left = r.left || 0;
        var top = r.top || 0;
        var right = typeof r.right === 'number' ? r.right : left + w;
        var bottom = typeof r.bottom === 'number' ? r.bottom : top + h;
        return { left: left, top: top, right: right, bottom: bottom, width: w, height: h };
      }

      function getTileNormRect(cardEl) {
        var tr = getNormRect(cardEl && cardEl.querySelector('.tile'));
        return tr.width > 0 ? tr : getNormRect(cardEl);
      }

      function showDragBadgeOver(cardEl, text) {
        if (!dragIntentBadge || !cardEl) return;
        var r = getTileNormRect(cardEl);
        if (r.width > 0) {
          dragIntentBadge.style.left = Math.round(r.left + r.width / 2) + 'px';
          dragIntentBadge.style.top = Math.max(8, Math.round(r.top - 10)) + 'px';
        }
        dragIntentBadge.textContent = text;
        dragIntentBadge.classList.add('visible');
      }

      function applyDragFeedback() {
        hideDragVisuals();
        if (dragIntent.mode === 'into-folder' && dragIntent.folderEl) {
          dragIntent.folderEl.classList.add('drop-into-folder');
          showDragBadgeOver(dragIntent.folderEl, '移入「' + ((dragIntent.folderItem && dragIntent.folderItem.name) || '分组') + '」');
        } else if (dragIntent.mode === 'merge-folder' && dragIntent.targetEl) {
          dragIntent.targetEl.classList.add('drop-merge-folder');
          showDragBadgeOver(dragIntent.targetEl, '松手合并为新分组');
        } else if (dragIntent.mode === 'reorder' && dragInsertLine) {
          dragInsertLine.style.left = Math.round((dragIntent.indicatorX || 0) - 1.5) + 'px';
          dragInsertLine.style.top = Math.round(dragIntent.indicatorY || 0) + 'px';
          dragInsertLine.style.height = Math.max(24, Math.round(dragIntent.indicatorH || 64)) + 'px';
          dragInsertLine.classList.add('visible');
        }
      }

      function moveCardIntoFolderInPlace(srcCardEl, srcItem, folderEl, dstFolder) {
        var srcIdx = list.indexOf(srcItem);
        if (!srcItem || isFolderItem(srcItem) || !dstFolder || !isFolderItem(dstFolder) || srcIdx === -1) return false;
        list.splice(srcIdx, 1);
        if (!Array.isArray(dstFolder.children)) dstFolder.children = [];
        dstFolder.children.push(srcItem);
        save(list);
        var cardEl = srcCardEl || findCardElementByItem(srcItem);
        var targetFolderEl = folderEl || findCardElementByItem(dstFolder);
        animateReorder(function () {
          if (cardEl && cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
        }, nav, cardEl);
        if (targetFolderEl) {
          updateCardContent(targetFolderEl, dstFolder);
          pulseFolderAbsorb(targetFolderEl);
        }
        if (openFolderId === dstFolder.id) renderFolderGrid(dstFolder);
        return true;
      }

      function mergeCardsIntoNewFolderInPlace(srcCardEl, srcItem, dstCardEl, dstItem) {
        var srcIdx = list.indexOf(srcItem);
        var dstIdx = list.indexOf(dstItem);
        if (!srcItem || !dstItem || srcItem === dstItem || isFolderItem(srcItem) || isFolderItem(dstItem) || srcIdx === -1 || dstIdx === -1) return false;
        var newFolder = { type: 'folder', id: makeFolderId(), name: '新建分组', children: [dstItem, srcItem] };
        list.splice(dstIdx, 1, newFolder);
        var removeSrcIdx = list.indexOf(srcItem);
        if (removeSrcIdx !== -1) list.splice(removeSrcIdx, 1);
        save(list);
        var sEl = srcCardEl || findCardElementByItem(srcItem);
        var dEl = dstCardEl || findCardElementByItem(dstItem);
        animateReorder(function () {
          if (sEl && sEl.parentNode) sEl.parentNode.removeChild(sEl);
        }, nav, sEl);
        if (dEl) {
          updateCardContent(dEl, newFolder);
          pulseFolderAbsorb(dEl);
        }
        return true;
      }

      function scheduleMergeCandidate(targetCard, targetItem) {
        if (mergeCandidateEl === targetCard) return;
        cancelMergeTimer();
        mergeCandidateEl = targetCard;
        mergeHoverTimer = setTimeout(function () {
          mergeHoverTimer = null;
          if (!dragSrc || mergeCandidateEl !== targetCard) return;
          dragIntent = { mode: 'merge-folder', targetEl: targetCard, targetItem: targetItem };
          applyDragFeedback();
        }, MERGE_HOLD_MS);
      }

      function isPointInRect(x, y, rect, padX, padY) {
        return rect && x >= rect.left - padX && x <= rect.right + padX && y >= rect.top - padY && y <= rect.bottom + padY;
      }

      function computeGapReorderIntent(allCards, clientX, clientY, edgeInsertBeforeEl, edgeIndicatorX, edgeTileRect) {
        var insertBeforeEl = edgeInsertBeforeEl;
        var indicatorX = edgeIndicatorX;
        var indicatorY = edgeTileRect ? edgeTileRect.top : 0;
        var indicatorH = edgeTileRect ? edgeTileRect.height : 64;

        if (!edgeInsertBeforeEl && edgeInsertBeforeEl !== null) {
          // 按垂直中心分组为视觉行，再匹配最接近的一行
          var rows = [];
          allCards.forEach(function (c) {
            var r = getNormRect(c);
            var tr = getTileNormRect(c);
            if (r.width <= 0) return;
            var cy = tr.top + tr.height / 2;
            var entry = { el: c, rect: r, tileRect: tr, midX: r.left + r.width / 2, cy: cy };
            var matchedRow = null;
            for (var i = 0; i < rows.length; i++) {
              if (Math.abs(rows[i].cy - cy) < 42) { matchedRow = rows[i]; break; }
            }
            if (!matchedRow) {
              matchedRow = { cy: cy, cards: [] };
              rows.push(matchedRow);
            }
            matchedRow.cards.push(entry);
          });
          if (!rows.length) {
            dragIntent = { mode: 'none' };
            return;
          }
          rows.sort(function (a, b) { return a.cy - b.cy; });
          var bestRow = rows[0];
          var bestDist = Math.abs(clientY - bestRow.cy);
          for (var ri = 1; ri < rows.length; ri++) {
            var d = Math.abs(clientY - rows[ri].cy);
            if (d < bestDist) { bestDist = d; bestRow = rows[ri]; }
          }
          var rowCards = bestRow.cards.slice().sort(function (a, b) { return a.rect.left - b.rect.left; });
          var placed = false;
          for (var ci = 0; ci < rowCards.length; ci++) {
            var cur = rowCards[ci];
            if (clientX < cur.midX) {
              insertBeforeEl = cur.el;
              indicatorY = cur.tileRect.top;
              indicatorH = cur.tileRect.height;
              if (ci > 0) {
                indicatorX = (rowCards[ci - 1].rect.right + cur.rect.left) / 2;
              } else {
                indicatorX = cur.rect.left - 11;
              }
              placed = true;
              break;
            }
          }
          if (!placed) {
            var lastInRow = rowCards[rowCards.length - 1];
            var nextDom = lastInRow.el.nextElementSibling;
            while (nextDom && (nextDom === dragSrc || (!nextDom.classList.contains('shortcut') && nextDom !== slot))) {
              nextDom = nextDom.nextElementSibling;
            }
            insertBeforeEl = (nextDom && nextDom.classList.contains('shortcut')) ? nextDom : slot;
            indicatorY = lastInRow.tileRect.top;
            indicatorH = lastInRow.tileRect.height;
            indicatorX = lastInRow.rect.right + 11;
          }
        }

        // 若插入位置紧贴 dragSrc 当前位置，则属于无效空操作，不展示误导性竖线
        var nextActive = dragSrc ? dragSrc.nextElementSibling : null;
        if (insertBeforeEl === dragSrc || insertBeforeEl === nextActive) {
          dragIntent = { mode: 'none' };
          return;
        }
        dragIntent = {
          mode: 'reorder',
          insertBeforeEl: insertBeforeEl || slot,
          indicatorX: indicatorX,
          indicatorY: indicatorY,
          indicatorH: indicatorH
        };
      }

      function resolveMainDragIntent(clientX, clientY, fallbackCard) {
        if (!dragSrc) return;
        var srcItem = cardItemMap.get(dragSrc);
        var allCards = Array.from(nav.querySelectorAll('.shortcut')).filter(function (c) { return c !== dragSrc; });
        var hasLayout = allCards.some(function (c) {
          return getNormRect(c).width > 0;
        });

        // 无几何布局环境（如 jsdom 单测且未 mock getBoundingClientRect）时的保底回退
        if (!hasLayout) {
          if (fallbackCard && fallbackCard !== dragSrc) {
            var fbDst = cardItemMap.get(fallbackCard);
            if (srcItem && !isFolderItem(srcItem) && fbDst && isFolderItem(fbDst)) {
              cancelMergeTimer();
              dragIntent = { mode: 'into-folder', folderEl: fallbackCard, folderItem: fbDst };
              return;
            }
            if (srcItem && !isFolderItem(srcItem) && fbDst && !isFolderItem(fbDst)) {
              if (dragIntent.mode === 'merge-folder' && dragIntent.targetEl === fallbackCard) return;
              scheduleMergeCandidate(fallbackCard, fbDst);
            } else {
              cancelMergeTimer();
            }
            dragIntent = { mode: 'reorder', insertBeforeEl: fallbackCard, indicatorX: 0, indicatorY: 0, indicatorH: 64 };
            return;
          }
          cancelMergeTimer();
          dragIntent = { mode: 'reorder', insertBeforeEl: slot, indicatorX: 0, indicatorY: 0, indicatorH: 64 };
          return;
        }

        // 迟滞锁定：已锁定「移入分组」或「合并建组」时，若指针仍在缓冲边距内且未进入其它卡片主体，保持原意图不抖动
        if ((dragIntent.mode === 'into-folder' && dragIntent.folderEl) || (dragIntent.mode === 'merge-folder' && dragIntent.targetEl)) {
          var lockedEl = dragIntent.folderEl || dragIntent.targetEl;
          var lockedRect = getNormRect(lockedEl);
          var enteredOtherCard = allCards.some(function (c) {
            return c !== lockedEl && isPointInRect(clientX, clientY, getNormRect(c), 0, 2);
          });
          if (!enteredOtherCard && isPointInRect(clientX, clientY, lockedRect, STICKY_MARGIN, STICKY_MARGIN)) {
            return;
          }
        }

        var hitCard = null;
        for (var i = 0; i < allCards.length; i++) {
          if (isPointInRect(clientX, clientY, getNormRect(allCards[i]), 0, 4)) {
            hitCard = allCards[i];
            break;
          }
        }

        if (hitCard) {
          var dstItem = cardItemMap.get(hitCard);
          var rect = getNormRect(hitCard);
          var tileRect = getTileNormRect(hitCard);
          var ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;

          if (srcItem && !isFolderItem(srcItem) && dstItem && isFolderItem(dstItem)) {
            cancelMergeTimer();
            if (ratio >= 0.12 && ratio <= 0.88) {
              dragIntent = { mode: 'into-folder', folderEl: hitCard, folderItem: dstItem };
              return;
            }
            // 分组最外侧窄边按前后缝隙插队处理
            if (ratio < 0.12) {
              var prev = hitCard.previousElementSibling;
              while (prev && (prev === dragSrc || !prev.classList.contains('shortcut'))) prev = prev.previousElementSibling;
              var leftX = prev ? (getNormRect(prev).right + rect.left) / 2 : rect.left - 11;
              computeGapReorderIntent(allCards, clientX, clientY, hitCard, leftX, tileRect);
            } else {
              var nxt = hitCard.nextElementSibling;
              while (nxt && (nxt === dragSrc || (!nxt.classList.contains('shortcut') && nxt !== slot))) nxt = nxt.nextElementSibling;
              var nextTarget = (nxt && nxt.classList.contains('shortcut')) ? nxt : slot;
              var rightX = (nxt && nxt.classList && nxt.classList.contains('shortcut')) ? (rect.right + getNormRect(nxt).left) / 2 : rect.right + 11;
              computeGapReorderIntent(allCards, clientX, clientY, nextTarget, rightX, tileRect);
            }
            return;
          }

          if (srcItem && !isFolderItem(srcItem) && dstItem && !isFolderItem(dstItem)) {
            if (ratio >= 0.22 && ratio <= 0.78 && clientY >= tileRect.top && clientY <= tileRect.bottom) {
              if (dragIntent.mode === 'merge-folder' && dragIntent.targetEl === hitCard) return;
              scheduleMergeCandidate(hitCard, dstItem);
            } else {
              cancelMergeTimer();
            }
            computeGapReorderIntent(allCards, clientX, clientY);
            return;
          }
        }

        cancelMergeTimer();
        computeGapReorderIntent(allCards, clientX, clientY);
      }

      // 给所有 shortcut 绑定拖拽相关事件（委托在 nav 上）
      nav.addEventListener('dragstart', function (e) {
        if (!editing) return;
        var card = e.target.closest('.shortcut');
        if (!card) return;
        dragSrc = card;
        clearDragFeedback();
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', ''); } catch (err) {}
      });

      nav.addEventListener('dragend', function () {
        justDraggedAt = Date.now();
        lastDraggedEl = dragSrc;
        clearDragFeedback();
        nav.querySelectorAll('.shortcut.dragging').forEach(function (el) {
          el.classList.remove('dragging');
        });
        dragSrc = null;
      });

      nav.addEventListener('dragover', function (e) {
        if (!editing || !dragSrc) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        var fallbackCard = e.target && e.target.closest ? e.target.closest('.shortcut') : null;
        resolveMainDragIntent(e.clientX, e.clientY, fallbackCard);
        applyDragFeedback();
      });

      nav.addEventListener('dragleave', function (e) {
        // 仅当指针真正离开整个 nav 容器时才清除反馈，彻底杜绝子元素冒泡误清入组状态
        if (!e.relatedTarget || !nav.contains(e.relatedTarget)) {
          clearDragFeedback();
        }
      });

      nav.addEventListener('drop', function (e) {
        if (!editing || !dragSrc) return;
        e.preventDefault();
        justDraggedAt = Date.now();
        lastDraggedEl = dragSrc;
        var fallbackCard = e.target && e.target.closest ? e.target.closest('.shortcut') : null;
        if (dragIntent.mode === 'none') {
          resolveMainDragIntent(e.clientX, e.clientY, fallbackCard);
        }
        var executedIntent = dragIntent;
        var srcEl = dragSrc;
        var srcItem = cardItemMap.get(srcEl);
        clearDragFeedback();
        if (srcEl) srcEl.classList.remove('dragging');
        dragSrc = null;

        if (executedIntent.mode === 'into-folder' && executedIntent.folderEl) {
          moveCardIntoFolderInPlace(srcEl, srcItem, executedIntent.folderEl, executedIntent.folderItem);
          return;
        }
        if (executedIntent.mode === 'merge-folder' && executedIntent.targetEl) {
          mergeCardsIntoNewFolderInPlace(srcEl, srcItem, executedIntent.targetEl, executedIntent.targetItem);
          return;
        }
        if (executedIntent.mode === 'reorder' && srcEl) {
          var targetBefore = executedIntent.insertBeforeEl || slot;
          if (targetBefore !== srcEl && srcEl.nextElementSibling !== targetBefore) {
            animateReorder(function () {
              if (targetBefore && targetBefore.parentNode === nav) {
                nav.insertBefore(srcEl, targetBefore);
              } else {
                nav.insertBefore(srcEl, slot);
              }
            }, nav, srcEl);

            var cards = Array.prototype.slice.call(nav.querySelectorAll('.shortcut'));
            var newOrder = cards.map(function (el) {
              var mapped = cardItemMap.get(el);
              if (mapped && list.indexOf(mapped) !== -1) return mapped;
              var lbl = el.querySelector('.label');
              var name = lbl ? lbl.textContent : '';
              return list.find(function (it) { return it.name === name; });
            }).filter(Boolean);
            list = newOrder;
            save(list);
          }
        }
      });

      // 删除区：拖入即删除
      dropzone.addEventListener('dragover', function (e) {
        if (!editing || !dragSrc) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        clearDragFeedback();
        dropzone.classList.add('active');
      });

      dropzone.addEventListener('dragleave', function () {
        dropzone.classList.remove('active');
      });

      dropzone.addEventListener('drop', function (e) {
        if (!editing || !dragSrc) return;
        e.preventDefault();
        justDraggedAt = Date.now();
        clearDragFeedback();
        // 通过 DOM 位置找对应的 list 索引，避免同名卡片删错
        var cards = nav.querySelectorAll('.shortcut');
        var idx = Array.prototype.indexOf.call(cards, dragSrc);
        dropzone.classList.remove('active');
        var dropped = dragSrc;
        dragSrc = null;
        if (idx >= 0 && idx < list.length) {
          // 立即从数据中删除并保存；DOM 走动画删除
          list.splice(idx, 1);
          save(list);
          removeCardWithAnim(dropped);
        }
      });

      // 让所有卡片可拖拽（编辑模式下重新挂上 draggable）
      function bindDraggable() {
        nav.querySelectorAll('.shortcut').forEach(function (el) {
          el.setAttribute('draggable', editing ? 'true' : 'false');
        });
      }
      // 重写 render，在末尾调用
      var _origRender = render;
      render = function (l) { _origRender(l); bindDraggable(); };

      // 退出编辑时把所有 draggable 关掉
      function refreshDraggable() {
        nav.querySelectorAll('.shortcut').forEach(function (el) {
          el.setAttribute('draggable', editing ? 'true' : 'false');
        });
      }
      var _origSetEditing = setEditing;
      setEditing = function (on) {
        _origSetEditing(on);
        editing = on;
        refreshDraggable();
      };

      // ========== T5 卡片分组弹窗与右键菜单 ==========
      var folderModal = document.getElementById('folderModal');
      var folderTitleInput = document.getElementById('folderTitleInput');
      var folderGrid = document.getElementById('folderGrid');
      var folderDragOutZone = document.getElementById('folderDragOutZone');
      var folderAddItemBtn = document.getElementById('folderAddItemBtn');
      var folderDissolveBtn = document.getElementById('folderDissolveBtn');
      var editNewFolderBtn = document.getElementById('editNewFolderBtn');

      function renderFolderGrid(folder) {
        if (!folderGrid) return;
        folderGrid.innerHTML = '';
        var kids = Array.isArray(folder && folder.children) ? folder.children : [];
        if (!kids.length) {
          var em = document.createElement('div');
          em.className = 'folder-grid-empty';
          em.textContent = '该分组暂无卡片，点击右上角「+ 添加卡片」或拖动主页卡片放入此分组';
          folderGrid.appendChild(em);
          return;
        }
        kids.forEach(function (child) {
          var c = buildCard(child);
          c.classList.add('no-enter-anim');
          c.setAttribute('draggable', 'true');
          folderGrid.appendChild(c);
        });
      }

      function openFolderModal(fid) {
        var folder = findFolderById(fid);
        if (!folder || !folderModal) return;
        openFolderId = folder.id;
        if (folderTitleInput) folderTitleInput.value = folder.name || '';
        renderFolderGrid(folder);
        openModal(folderModal);
      }

      function closeFolderModalIfMatching(folder) {
        if (folder && openFolderId === folder.id && folderModal) {
          openFolderId = null;
          closeModal(folderModal);
        }
      }

      // 当分组被删除/移空（0 项）或仅剩 1 项时，就地自动消失或解散为单卡（不整页重建）
      function cleanupFolderIfSparseInPlace(folder) {
        var idx = list.indexOf(folder);
        if (idx === -1 || !isFolderItem(folder)) return false;
        var kids = Array.isArray(folder.children) ? folder.children : [];
        if (kids.length >= 2) return false;
        closeFolderModalIfMatching(folder);
        var folderEl = findCardElementByItem(folder);
        if (kids.length === 0) {
          list.splice(idx, 1);
          save(list);
          if (folderEl && folderEl.parentNode === nav) {
            animateReorder(function () {
              folderEl.parentNode.removeChild(folderEl);
            }, nav, null);
          } else {
            render(list);
          }
          return true;
        }
        var soleChild = kids[0];
        list.splice(idx, 1, soleChild);
        save(list);
        if (folderEl && folderEl.parentNode === nav) {
          updateCardContent(folderEl, soleChild);
        } else {
          render(list);
        }
        return true;
      }

      function moveCardOutOfFolderInPlace(parentFolder, childIdx) {
        if (!parentFolder || !Array.isArray(parentFolder.children)) return false;
        if (childIdx < 0 || childIdx >= parentFolder.children.length) return false;
        var item = parentFolder.children.splice(childIdx, 1)[0];
        var remaining = parentFolder.children;
        var pIdx = list.indexOf(parentFolder);
        var folderEl = findCardElementByItem(parentFolder);

        // 所有应用都被移出（剩 0 项）：空分组自动消失，移出项接管原位置
        if (remaining.length === 0) {
          closeFolderModalIfMatching(parentFolder);
          if (pIdx >= 0) list.splice(pIdx, 1, item);
          else list.push(item);
          save(list);
          if (folderEl && folderEl.parentNode === nav) {
            updateCardContent(folderEl, item);
          } else {
            render(list);
          }
          return true;
        }

        // 仅剩 1 项：分组自动解散为该单卡，并将刚移出的项紧随其后放回主页
        if (remaining.length === 1) {
          var soleChild = remaining[0];
          closeFolderModalIfMatching(parentFolder);
          if (pIdx >= 0) list.splice(pIdx, 1, soleChild, item);
          else list.push(soleChild, item);
          save(list);
          if (folderEl && folderEl.parentNode === nav) {
            animateReorder(function () {
              var newCard = buildCard(item);
              newCard.classList.add('no-enter-anim');
              newCard.setAttribute('draggable', editing ? 'true' : 'false');
              nav.insertBefore(newCard, folderEl.nextElementSibling || slot);
              updateCardContent(folderEl, soleChild);
            }, nav, null);
          } else {
            render(list);
          }
          return true;
        }

        // 仍剩 >= 2 项：保留分组，仅将移出卡平滑放回主页并刷新分组缩略图与弹窗网格
        list.splice(pIdx >= 0 ? pIdx + 1 : list.length, 0, item);
        save(list);
        animateReorder(function () {
          var newCard = buildCard(item);
          newCard.classList.add('no-enter-anim');
          newCard.setAttribute('draggable', editing ? 'true' : 'false');
          if (folderEl && folderEl.parentNode === nav) {
            nav.insertBefore(newCard, folderEl.nextElementSibling || slot);
          } else {
            nav.insertBefore(newCard, slot);
          }
        }, nav, null);
        if (folderEl) updateCardContent(folderEl, parentFolder);
        renderFolderGrid(parentFolder);
        return true;
      }

      function dissolveFolderAt(idx) {
        var folder = list[idx];
        if (!folder || !isFolderItem(folder)) return;
        var kids = Array.isArray(folder.children) ? folder.children.slice() : [];
        Array.prototype.splice.apply(list, [idx, 1].concat(kids));
        if (openFolderId === folder.id && folderModal) {
          openFolderId = null;
          closeModal(folderModal);
        }
        save(list);
        var folderEl = findCardElementByItem(folder);
        if (folderEl && folderEl.parentNode === nav) {
          animateReorder(function () {
            kids.forEach(function (child) {
              var c = buildCard(child);
              c.classList.add('no-enter-anim');
              c.setAttribute('draggable', editing ? 'true' : 'false');
              nav.insertBefore(c, folderEl);
            });
            folderEl.parentNode.removeChild(folderEl);
          }, nav, null);
        } else {
          render(list);
        }
      }

      function commitFolderRename() {
        var folder = findFolderById(openFolderId);
        if (!folder || !folderTitleInput) return;
        var next = folderTitleInput.value.trim();
        if (!next) { folderTitleInput.value = folder.name || '新建分组'; return; }
        if (next !== folder.name) {
          folder.name = next.slice(0, 20);
          save(list);
          var el = nav.querySelector('.shortcut-folder[data-folder-id="' + folder.id + '"]');
          if (el) updateCardContent(el, folder);
        }
      }
      if (folderTitleInput) {
        folderTitleInput.addEventListener('blur', commitFolderRename);
        folderTitleInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); folderTitleInput.blur(); }
        });
      }
      if (folderAddItemBtn) {
        folderAddItemBtn.addEventListener('click', function () {
          if (!openFolderId) return;
          targetFolderId = openFolderId;
          openAddModal(openFolderId);
        });
      }
      if (folderDissolveBtn) {
        folderDissolveBtn.addEventListener('click', function () {
          if (!openFolderId) return;
          var idx = list.findIndex(function (it) { return isFolderItem(it) && it.id === openFolderId; });
          if (idx !== -1) dissolveFolderAt(idx);
        });
      }
      if (editNewFolderBtn) {
        editNewFolderBtn.addEventListener('click', function () {
          var name = (prompt('输入新分组名称：', '新建分组') || '').trim();
          if (!name) return;
          var folder = { type: 'folder', id: makeFolderId(), name: name.slice(0, 20), children: [] };
          list.push(folder);
          save(list);
          appendCard(folder);
        });
      }

      // 主页点击分组卡片打开分组弹窗（编辑模式下也可点开分组进行内部管理；仅屏蔽刚被拖拽卡片自身的误触 click）
      nav.addEventListener('click', function (e) {
        var card = e.target.closest('.shortcut');
        if (!card) return;
        if (card === lastDraggedEl && (Date.now() - justDraggedAt < 200)) {
          e.preventDefault();
          return;
        }
        var isFld = card.classList.contains('shortcut-folder');
        if (isFld) {
          e.preventDefault();
          var item = cardItemMap.get(card);
          if (item && isFolderItem(item)) openFolderModal(item.id);
          return;
        }
        if (editing) e.preventDefault();
      });

      // 分组弹窗内部：拖拽排序 + 拖出到主页 + 编辑模式下点击子卡直接编辑
      if (folderGrid) {
        var folderDragSrc = null;
        var folderDragInsertBefore = undefined;

        function clearFolderDragState() {
          if (dragInsertLine) dragInsertLine.classList.remove('visible');
          if (folderDragOutZone) folderDragOutZone.classList.remove('active');
          if (folderModal) folderModal.classList.remove('folder-dragging');
          if (folderDragSrc) folderDragSrc.classList.remove('dragging');
          folderDragSrc = null;
          folderDragInsertBefore = undefined;
        }

        function resolveFolderGridInsert(clientX, clientY, fallbackEl) {
          var cards = Array.from(folderGrid.querySelectorAll('.shortcut')).filter(function (c) { return c !== folderDragSrc; });
          var hasLayout = cards.some(function (c) {
            return getNormRect(c).width > 0;
          });
          if (!hasLayout) {
            folderDragInsertBefore = (fallbackEl && fallbackEl !== folderDragSrc) ? fallbackEl : null;
            return;
          }
          var rows = [];
          cards.forEach(function (c) {
            var r = getNormRect(c);
            var tr = getTileNormRect(c);
            if (r.width <= 0) return;
            var cy = tr.top + tr.height / 2;
            var row = rows.find(function (rw) { return Math.abs(rw.cy - cy) < 42; });
            if (!row) { row = { cy: cy, cards: [] }; rows.push(row); }
            row.cards.push({ el: c, rect: r, tileRect: tr, midX: r.left + r.width / 2 });
          });
          if (!rows.length) { folderDragInsertBefore = null; return; }
          rows.sort(function (a, b) { return a.cy - b.cy; });
          var bestRow = rows[0];
          var bestDist = Math.abs(clientY - bestRow.cy);
          for (var i = 1; i < rows.length; i++) {
            var d = Math.abs(clientY - rows[i].cy);
            if (d < bestDist) { bestDist = d; bestRow = rows[i]; }
          }
          var rowCards = bestRow.cards.slice().sort(function (a, b) { return a.rect.left - b.rect.left; });
          var insertBefore = null;
          var ix = 0, iy = 0, ih = 64;
          var placed = false;
          for (var ci = 0; ci < rowCards.length; ci++) {
            var cur = rowCards[ci];
            if (clientX < cur.midX) {
              insertBefore = cur.el;
              iy = cur.tileRect.top;
              ih = cur.tileRect.height;
              ix = ci > 0 ? (rowCards[ci - 1].rect.right + cur.rect.left) / 2 : (cur.rect.left - 7);
              placed = true;
              break;
            }
          }
          if (!placed) {
            var last = rowCards[rowCards.length - 1];
            var nxt = last.el.nextElementSibling;
            while (nxt && nxt === folderDragSrc) nxt = nxt.nextElementSibling;
            insertBefore = (nxt && nxt.classList && nxt.classList.contains('shortcut')) ? nxt : null;
            iy = last.tileRect.top;
            ih = last.tileRect.height;
            ix = last.rect.right + 7;
          }
          var curNext = folderDragSrc ? folderDragSrc.nextElementSibling : undefined;
          if (insertBefore === folderDragSrc || insertBefore === curNext) {
            folderDragInsertBefore = undefined;
            if (dragInsertLine) dragInsertLine.classList.remove('visible');
            return;
          }
          folderDragInsertBefore = insertBefore;
          if (dragInsertLine) {
            dragInsertLine.style.left = Math.round(ix - 1.5) + 'px';
            dragInsertLine.style.top = Math.round(iy) + 'px';
            dragInsertLine.style.height = Math.max(24, Math.round(ih)) + 'px';
            dragInsertLine.classList.add('visible');
          }
        }

        folderGrid.addEventListener('dragstart', function (e) {
          var card = e.target.closest('.shortcut');
          if (!card || !openFolderId) return;
          folderDragSrc = card;
          card.classList.add('dragging');
          if (folderModal) folderModal.classList.add('folder-dragging');
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', ''); } catch (err) {}
        });

        folderGrid.addEventListener('dragover', function (e) {
          if (!folderDragSrc || !openFolderId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (folderDragOutZone) folderDragOutZone.classList.remove('active');
          resolveFolderGridInsert(e.clientX, e.clientY, e.target && e.target.closest ? e.target.closest('.shortcut') : null);
        });

        folderGrid.addEventListener('dragleave', function (e) {
          if (!e.relatedTarget || !folderGrid.contains(e.relatedTarget)) {
            if (dragInsertLine) dragInsertLine.classList.remove('visible');
          }
        });

        folderGrid.addEventListener('drop', function (e) {
          if (!folderDragSrc || !openFolderId) return;
          e.preventDefault();
          justDraggedAt = Date.now();
          lastDraggedEl = folderDragSrc;
          var folder = findFolderById(openFolderId);
          var srcEl = folderDragSrc;
          if (folderDragInsertBefore === undefined) {
            resolveFolderGridInsert(e.clientX, e.clientY, e.target && e.target.closest ? e.target.closest('.shortcut') : null);
          }
          var insertBefore = folderDragInsertBefore;
          clearFolderDragState();
          if (!folder || !Array.isArray(folder.children) || insertBefore === undefined) return;
          if (insertBefore !== srcEl && srcEl.nextElementSibling !== insertBefore) {
            animateReorder(function () {
              folderGrid.insertBefore(srcEl, insertBefore || null);
            }, folderGrid, srcEl);
            var domCards = Array.from(folderGrid.querySelectorAll('.shortcut'));
            folder.children = domCards.map(function (el) { return cardItemMap.get(el); }).filter(Boolean);
            save(list);
            var rootF = findCardElementByItem(folder);
            if (rootF) updateCardContent(rootF, folder);
          }
        });

        folderGrid.addEventListener('dragend', function () {
          justDraggedAt = Date.now();
          lastDraggedEl = folderDragSrc;
          clearFolderDragState();
        });

        folderGrid.addEventListener('click', function (e) {
          var card = e.target.closest('.shortcut');
          if (!card || !openFolderId) return;
          if (card === lastDraggedEl && (Date.now() - justDraggedAt < 200)) { e.preventDefault(); return; }
          if (!editing) return;
          e.preventDefault();
          var folder = findFolderById(openFolderId);
          if (!folder || !Array.isArray(folder.children)) return;
          var cards = folderGrid.querySelectorAll('.shortcut');
          var idx = Array.prototype.indexOf.call(cards, card);
          if (idx < 0 || idx >= folder.children.length) return;
          targetFolderId = openFolderId;
          openAddModal(targetFolderId);
          editingIndex = idx;
          fillAddFormFromItem(folder.children[idx]);
        });

        function handleFolderDragOutDrop(e) {
          if (!folderDragSrc || !openFolderId) return;
          e.preventDefault();
          e.stopPropagation();
          justDraggedAt = Date.now();
          var folder = findFolderById(openFolderId);
          var cards = folderGrid.querySelectorAll('.shortcut');
          var childIdx = Array.prototype.indexOf.call(cards, folderDragSrc);
          clearFolderDragState();
          if (folder && childIdx !== -1) moveCardOutOfFolderInPlace(folder, childIdx);
        }

        if (folderDragOutZone) {
          folderDragOutZone.addEventListener('dragover', function (e) {
            if (!folderDragSrc || !openFolderId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dragInsertLine) dragInsertLine.classList.remove('visible');
            folderDragOutZone.classList.add('active');
          });
          folderDragOutZone.addEventListener('dragleave', function () {
            folderDragOutZone.classList.remove('active');
          });
          folderDragOutZone.addEventListener('drop', handleFolderDragOutDrop);
        }

        if (folderModal) {
          folderModal.addEventListener('dragover', function (e) {
            if (!folderDragSrc || !openFolderId || e.target !== folderModal) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dragInsertLine) dragInsertLine.classList.remove('visible');
            if (folderDragOutZone) folderDragOutZone.classList.add('active');
          });
          folderModal.addEventListener('drop', function (e) {
            if (!folderDragSrc || !openFolderId || e.target !== folderModal) return;
            handleFolderDragOutDrop(e);
          });
        }
      }

      // 卡片 / 分组右键菜单
      var ctxMenu = document.getElementById('ctxMenu');
      var moveFolderMenu = document.getElementById('moveFolderMenu');
      var ctxCard = null;        // root 索引（或 folder 内索引）
      var ctxFolderId = null;    // 非 null 表示来自 folderModal 内部子卡
      var lastCtxPos = { x: 80, y: 80 };

      function configureCtxMenu(item, inFolderModal) {
        var isFld = isFolderItem(item);
        var setShow = function (act, visible) {
          var b = ctxMenu.querySelector('[data-action="' + act + '"]');
          if (b) b.hidden = !visible;
        };
        setShow('newtab', !isFld);
        setShow('openfolder', isFld);
        setShow('edit', true);
        var editBtnCtx = ctxMenu.querySelector('[data-action="edit"]');
        if (editBtnCtx) editBtnCtx.textContent = isFld ? '重命名分组' : '编辑';
        setShow('movetofolder', !isFld && !inFolderModal);
        setShow('moveout', !isFld && !!inFolderModal);
        setShow('dissolvefolder', isFld);
        setShow('delete', true);
        var sep = ctxMenu.querySelector('[data-ctx-sep]');
        if (sep) sep.hidden = isFld;
        setShow('copy', !isFld);
        setShow('copymd', !isFld);
      }

      nav.addEventListener('contextmenu', function (e) {
        var card = e.target.closest('.shortcut');
        if (!card) return;
        e.preventDefault();
        var cards = nav.querySelectorAll('.shortcut');
        var idx = Array.prototype.indexOf.call(cards, card);
        if (idx < 0 || idx >= list.length) return;
        ctxCard = idx;
        ctxFolderId = null;
        configureCtxMenu(list[idx], false);
        lastCtxPos = { x: Math.min(e.clientX, window.innerWidth - 170), y: Math.min(e.clientY, window.innerHeight - 230) };
        ctxMenu.style.left = lastCtxPos.x + 'px';
        ctxMenu.style.top = lastCtxPos.y + 'px';
        if (moveFolderMenu) moveFolderMenu.classList.remove('open');
        ctxMenu.classList.add('open');
      });

      if (folderGrid) {
        folderGrid.addEventListener('contextmenu', function (e) {
          var card = e.target.closest('.shortcut');
          if (!card || !openFolderId) return;
          e.preventDefault();
          var folder = findFolderById(openFolderId);
          if (!folder || !Array.isArray(folder.children)) return;
          var cards = folderGrid.querySelectorAll('.shortcut');
          var idx = Array.prototype.indexOf.call(cards, card);
          if (idx < 0 || idx >= folder.children.length) return;
          ctxCard = idx;
          ctxFolderId = openFolderId;
          configureCtxMenu(folder.children[idx], true);
          lastCtxPos = { x: Math.min(e.clientX, window.innerWidth - 170), y: Math.min(e.clientY, window.innerHeight - 230) };
          ctxMenu.style.left = lastCtxPos.x + 'px';
          ctxMenu.style.top = lastCtxPos.y + 'px';
          if (moveFolderMenu) moveFolderMenu.classList.remove('open');
          ctxMenu.classList.add('open');
        });
      }

      function fillAddFormFromItem(item) {
        document.querySelector('#addTitle span').textContent = '编辑快捷方式';
        addName.value = item.name || '';
        addUrl.value = item.url || '';
        if (item.iconSrc === 'image') {
          document.querySelector('input[name="iconSrc"][value="image"]').checked = true;
          addImageField.style.display = '';
          addColorField.style.display = 'none';
          addLetterField.style.display = 'none';
          if (item.icon) addImage.value = item.icon;
        } else if (item.iconSrc === 'color') {
          document.querySelector('input[name="iconSrc"][value="color"]').checked = true;
          addImageField.style.display = 'none';
          addColorField.style.display = '';
          addLetterField.style.display = '';
          if (item.color) {
            chosenColor = item.color;
            addColorPicker.querySelectorAll('.color-dot').forEach(function (d) {
              d.classList.toggle('selected', d.dataset.color === item.color);
            });
          }
          if (item.letter) addLetter.value = item.letter;
        }
        updatePreview();
      }

      function openMoveToFolderPicker(cardIndex) {
        if (!moveFolderMenu) return;
        moveFolderMenu.innerHTML = '';
        var folders = list.filter(isFolderItem);
        folders.forEach(function (fld) {
          var b = document.createElement('button');
          b.type = 'button';
          b.textContent = fld.name + '（' + ((fld.children && fld.children.length) || 0) + '）';
          b.addEventListener('click', function () {
            moveFolderMenu.classList.remove('open');
            var cardItem = list[cardIndex];
            if (!cardItem || isFolderItem(cardItem)) return;
            moveCardIntoFolderInPlace(findCardElementByItem(cardItem), cardItem, findCardElementByItem(fld), fld);
          });
          moveFolderMenu.appendChild(b);
        });
        if (folders.length) moveFolderMenu.appendChild(document.createElement('hr'));
        var newBtn = document.createElement('button');
        newBtn.type = 'button';
        newBtn.textContent = '+ 新建分组并移入';
        newBtn.addEventListener('click', function () {
          moveFolderMenu.classList.remove('open');
          var cardItem = list[cardIndex];
          if (!cardItem || isFolderItem(cardItem)) return;
          var fName = (prompt('输入新分组名称：', '新建分组') || '').trim();
          if (!fName) return;
          var cardEl = findCardElementByItem(cardItem);
          var newFld = { type: 'folder', id: makeFolderId(), name: fName.slice(0, 20), children: [cardItem] };
          list.splice(cardIndex, 1, newFld);
          save(list);
          if (cardEl) {
            updateCardContent(cardEl, newFld);
            pulseFolderAbsorb(cardEl);
          } else {
            render(list);
          }
        });
        moveFolderMenu.appendChild(newBtn);
        moveFolderMenu.style.left = Math.min(lastCtxPos.x + 12, window.innerWidth - 190) + 'px';
        moveFolderMenu.style.top = Math.min(lastCtxPos.y + 12, window.innerHeight - 200) + 'px';
        moveFolderMenu.classList.add('open');
      }

      ctxMenu.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn || ctxCard === null) return;
        var action = btn.dataset.action;
        var inFld = !!ctxFolderId;
        var parentFolder = inFld ? findFolderById(ctxFolderId) : null;
        var item = inFld ? (parentFolder && parentFolder.children && parentFolder.children[ctxCard]) : list[ctxCard];
        if (!item) return;
        ctxMenu.classList.remove('open');

        if (isFolderItem(item)) {
          var fIdx = ctxCard;
          ctxCard = null;
          if (action === 'openfolder') {
            openFolderModal(item.id);
          } else if (action === 'edit') {
            openFolderModal(item.id);
            if (folderTitleInput) setTimeout(function () { folderTitleInput.focus(); folderTitleInput.select(); }, 30);
          } else if (action === 'dissolvefolder') {
            dissolveFolderAt(fIdx);
          } else if (action === 'delete') {
            var count = Array.isArray(item.children) ? item.children.length : 0;
            if (count > 0 && !confirm('确定删除分组「' + item.name + '」及其中的 ' + count + ' 张卡片吗？')) return;
            var toRemF = nav.querySelectorAll('.shortcut')[fIdx];
            list.splice(fIdx, 1);
            save(list);
            if (toRemF) removeCardWithAnim(toRemF);
          }
          return;
        }

        switch (action) {
          case 'newtab':
            window.open(item.url, '_blank');
            ctxCard = null;
            break;
          case 'edit':
            targetFolderId = inFld ? ctxFolderId : null;
            openAddModal(targetFolderId);
            editingIndex = ctxCard;
            fillAddFormFromItem(item);
            ctxCard = null;
            break;
          case 'movetofolder':
            var moveIdx = ctxCard;
            ctxCard = null;
            openMoveToFolderPicker(moveIdx);
            break;
          case 'moveout':
            moveCardOutOfFolderInPlace(parentFolder, ctxCard);
            ctxCard = null;
            break;
          case 'delete':
            if (inFld && parentFolder) {
              parentFolder.children.splice(ctxCard, 1);
              if (!cleanupFolderIfSparseInPlace(parentFolder)) {
                save(list);
                renderFolderGrid(parentFolder);
                var rootF = findCardElementByItem(parentFolder);
                if (rootF) updateCardContent(rootF, parentFolder);
              }
            } else {
              var toRemove = nav.querySelectorAll('.shortcut')[ctxCard];
              list.splice(ctxCard, 1);
              save(list);
              if (toRemove) removeCardWithAnim(toRemove);
            }
            ctxCard = null;
            break;
          case 'copy':
            navigator.clipboard.writeText(item.url).catch(function () {});
            ctxCard = null;
            break;
          case 'copymd':
            navigator.clipboard.writeText('[' + item.name + '](' + item.url + ')').catch(function () {});
            ctxCard = null;
            break;
        }
      });

      document.addEventListener('click', function (e) {
        if (!ctxMenu.contains(e.target)) {
          ctxMenu.classList.remove('open');
        }
        if (moveFolderMenu && !moveFolderMenu.contains(e.target) && !ctxMenu.contains(e.target)) {
          moveFolderMenu.classList.remove('open');
        }
      });

      // 读取指定 localStorage 键（找不到返回 null）
      function readLS(key) {
        try { var v = localStorage.getItem(key); return v == null ? null : v; } catch (e) { return null; }
      }
      function writeLS(key, value) {
        try {
          if (value == null) { localStorage.removeItem(key); }
          else { localStorage.setItem(key, value); }
        } catch (e) {}
      }
      // Blob → base64 DataURL（导出壁纸用）
      function blobToDataURL(blob) {
        return new Promise(function (resolve, reject) {
          if (!blob) { resolve(null); return; }
          var reader = new FileReader();
          reader.onload = function () { resolve(reader.result); };
          reader.onerror = function () { reject(reader.error); };
          reader.readAsDataURL(blob);
        });
      }
      // base64 DataURL → Blob（导入壁纸用）
      function dataURLToBlob(dataURL) {
        if (!dataURL) return Promise.resolve(null);
        return fetch(dataURL).then(function (r) { return r.blob(); });
      }

      function sanitizeImportedCard(it) {
        if (!it || typeof it.name !== 'string' || !it.name.trim()) return null;
        if (it.type === 'folder') {
          var kids = Array.isArray(it.children) ? it.children.map(sanitizeImportedCard).filter(function (c) { return c && !isFolderItem(c); }) : [];
          return { type: 'folder', id: String(it.id || makeFolderId()), name: String(it.name).slice(0, 40), children: kids };
        }
        var clean = { name: String(it.name).slice(0, 40), url: it.url == null ? '' : String(it.url) };
        if (it.iconSrc === 'image' && it.icon) { clean.iconSrc = 'image'; clean.icon = String(it.icon); }
        else if (it.color) {
          var src = it.iconSrc || 'color';
          if (src !== 'image') {
            clean.iconSrc = src; clean.color = String(it.color);
            if (it.letter) clean.letter = String(it.letter);
          }
        }
        return clean;
      }

      function mergeImportedItems(existing, incoming) {
        var urlSet = {};
        var folderMap = {};
        existing.forEach(function (it) {
          if (isFolderItem(it)) {
            folderMap[it.name] = it;
            (it.children || []).forEach(function (c) { if (c && c.url) urlSet[c.url] = true; });
          } else if (it && it.url) {
            urlSet[it.url] = true;
          }
        });
        var merged = existing.map(function (it) {
          return isFolderItem(it)
            ? Object.assign({}, it, { children: (it.children || []).map(function (c) { return Object.assign({}, c); }) })
            : Object.assign({}, it);
        });
        folderMap = {};
        merged.forEach(function (it) { if (isFolderItem(it)) folderMap[it.name] = it; });
        var added = 0;
        incoming.forEach(function (it) {
          if (isFolderItem(it)) {
            var targetF = folderMap[it.name];
            if (!targetF) {
              targetF = { type: 'folder', id: it.id || makeFolderId(), name: it.name, children: [] };
              merged.push(targetF);
              folderMap[it.name] = targetF;
            }
            (it.children || []).forEach(function (c) {
              if (c.url && urlSet[c.url]) return;
              if (c.url) urlSet[c.url] = true;
              targetF.children.push(c);
              added++;
            });
          } else {
            if (it.url && urlSet[it.url]) return;
            if (it.url) urlSet[it.url] = true;
            merged.push(it);
            added++;
          }
        });
        return { items: merged, added: added };
      }

      function buildBackupPayload(options) {
        var opts = options || {};
        var includeWallpaper = opts.includeWallpaper !== false;
        var skippedWallpaper = false;
        var wpPromise = includeWallpaper
          ? loadWallpaperFromDB().then(function (wpBlob) {
              if (wpBlob && (wpBlob.size > 10 * 1024 * 1024 || /^video\//i.test(wpBlob.type || ''))) {
                skippedWallpaper = true;
                return null;
              }
              return blobToDataURL(wpBlob);
            }).catch(function () { return null; })
          : Promise.resolve(null);

        return wpPromise.then(function (wallpaperDataUrl) {
          var payload = {
            app: 'Motuo-Tab',
            version: 2,
            exportedAt: new Date().toISOString(),
            data: {
              items: list,
              settings: {
                engine: readLS('newtab.engine.v1'),
                customEngines: readLS('newtab.customEngines.v1'),
                searchHistory: readLS('newtab.searchHistory.v1'),
                sitedirect: readLS('newtab.sitedirect.v1'),
                siteDirectList: readLS('newtab.sitedirect.list.v1'),
                suggestOnline: readLS('newtab.suggestOnline.v1'),
                greeting: readLS(GREETING_KEY),
                heroLogo: readLS(HERO_LOGO_KEY),
                logoStyle: readLS(LOGO_STYLE_KEY),
                heroLogoAlpha: readLS(HERO_LOGO_ALPHA_KEY),
                solidColor: readLS('newtab.solidColor.v1'),
                blur: readLS('newtab.blur.v1'),
                alpha: readLS('newtab.alpha.v1'),
                toggleImg: readLS('newtab.toggleImg.v1'),
                toggleLtr: readLS('newtab.toggleLtr.v1'),
                scratchpad: readLS('newtab.scratchpad.v1'),
                theme: readLS(THEME_KEY) || getTheme()
              },
              ai: {
                config: (window.__motuo && window.__motuo.redactAIConfigJson)
                  ? window.__motuo.redactAIConfigJson(readLS('newtab.ai.config.v1'))
                  : readLS('newtab.ai.config.v1'),
                history: readLS('newtab.ai.history.v1'),
                sessions: readLS('newtab.ai.sessions.v1')
              },
              wallpaper: wallpaperDataUrl
            }
          };
          return { payload: payload, skippedWallpaper: skippedWallpaper };
        });
      }

      function applyBackupPayload(data, opts) {
        opts = opts || {};
        var mode = opts.mode === 'merge' ? 'merge' : 'overwrite';
        var isFull = !!(data && data.data && data.version === 2);
        var d = isFull ? data.data : null;

        var rawItems = isFull
          ? (Array.isArray(d.items) ? d.items : [])
          : (Array.isArray(data) ? data : (Array.isArray(data && data.items) ? data.items : null));
        var items = (rawItems || []).map(sanitizeImportedCard).filter(Boolean);
        if (!isFull && !items.length) throw new Error('没有有效的快捷方式');

        if (mode === 'merge') {
          var resMerge = mergeImportedItems(list, items);
          list = resMerge.items;
          save(list);
          render(list);
          return { count: resMerge.added, isFull: isFull, merged: true };
        }

        if (isFull && d.settings) {
          var st = d.settings;
          writeLS('newtab.engine.v1', st.engine);
          writeLS('newtab.customEngines.v1', st.customEngines);
          writeLS('newtab.searchHistory.v1', st.searchHistory);
          writeLS('newtab.sitedirect.v1', st.sitedirect);
          if (st.siteDirectList !== undefined) writeLS('newtab.sitedirect.list.v1', st.siteDirectList);
          writeLS('newtab.suggestOnline.v1', st.suggestOnline);
          if (st.greeting !== undefined) writeLS(GREETING_KEY, st.greeting);
          if (st.heroLogo !== undefined) writeLS(HERO_LOGO_KEY, st.heroLogo);
          if (st.logoStyle !== undefined) writeLS(LOGO_STYLE_KEY, st.logoStyle);
          if (st.heroLogoAlpha !== undefined) writeLS(HERO_LOGO_ALPHA_KEY, st.heroLogoAlpha);
          writeLS('newtab.solidColor.v1', st.solidColor);
          writeLS('newtab.blur.v1', st.blur);
          writeLS('newtab.alpha.v1', st.alpha);
          writeLS('newtab.toggleImg.v1', st.toggleImg);
          writeLS('newtab.toggleLtr.v1', st.toggleLtr);
          writeLS('newtab.scratchpad.v1', st.scratchpad);
          if (st.theme === 'light' || st.theme === 'dark' || st.theme === 'auto') {
            writeLS(THEME_KEY, st.theme);
            applyTheme(st.theme);
          }
          renderBrandHero();
        }

        if (isFull && d.ai) {
          writeLS('newtab.ai.config.v1', d.ai.config);
          writeLS('newtab.ai.history.v1', d.ai.history);
          if (d.ai.sessions !== undefined) writeLS('newtab.ai.sessions.v1', d.ai.sessions);
        }

        list = items;
        save(list);
        render(list);
        if (typeof renderGreeting === 'function') renderGreeting();
        if (window.__motuo && window.__motuo.engines && window.__motuo.engines.reload) window.__motuo.engines.reload();
        if (typeof renderSiteDirectRules === 'function') renderSiteDirectRules();

        if (isFull && opts.applyWallpaper !== false && d.wallpaper !== undefined) {
          dataURLToBlob(d.wallpaper).then(function (blob) {
            return blob ? saveWallpaperToDB(blob) : removeWallpaperFromDB();
          }).catch(function () {}).then(function () {
            refreshBackground();
            if (opts.reloadAfter) setTimeout(function () { location.reload(); }, 300);
          });
        }
        return { count: items.length, isFull: isFull, merged: false };
      }

      // 导出：打包快捷方式 + 壁纸图片 + AI 配置/历史 + 个性化配置
      exportBtn.addEventListener('click', function () {
        buildBackupPayload({ includeWallpaper: true }).then(function (res) {
          var blob = new Blob([JSON.stringify(res.payload, null, 2)], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'motuo-tab-backup-' + Date.now() + '.json';
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          recordBackupExported();
          if (res.skippedWallpaper) alert('当前是动态/超大壁纸，备份已跳过壁纸文件（卡片与配置已照常导出）。');
        }).catch(function (err) {
          console.error('导出失败', err);
          alert('导出失败：' + (err && err.message ? err.message : '未知错误'));
        });
      });

      // 导入：选 JSON 文件 → 覆盖当前列表
      importBtn.addEventListener('click', function () {
        importFile.value = ''; // 重置以便选同一个文件也能触发 change
        importFile.click();
      });

      importFile.addEventListener('change', function () {
        var file = importFile.files && importFile.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var data = JSON.parse(reader.result);
            var out = applyBackupPayload(data, { mode: 'overwrite', reloadAfter: true, applyWallpaper: true });
            var summary = '导入成功：恢复 ' + out.count + ' 条快捷方式' +
              (out.isFull ? '，以及壁纸与全部配置' : '');
            alert(summary);
          } catch (e) {
            alert('导入失败：' + e.message);
          }
        };
        reader.onerror = function () { alert('文件读取失败'); };
        reader.readAsText(file);
      });

      // 清空
      clearBtn.addEventListener('click', function () {
        toggleMenu(false);
        if (!confirm('确定要清空所有自定义快捷方式吗？此操作不可撤销（建议先导出备份）。')) return;
        list = [];
        save(list);
        // 错开淡出再移除，最后留空
        var cards = Array.from(nav.querySelectorAll('.shortcut'));
        cards.forEach(function (c, i) {
          c.style.animationDelay = (i * 25) + 'ms';
          c.classList.add('removing');
        });
        setTimeout(function () {
          cards.forEach(function (c) {
            if (c.parentNode) c.parentNode.removeChild(c);
          });
        }, cards.length * 25 + 280);
      });

      // ========== 壁纸功能：IndexedDB 存储 ==========
      // （DB_NAME / DB_VERSION / STORE_NAME 已在顶部 CONFIG 声明）
      var wallpaperDb = null;

      function openWallpaperDB() {
        return new Promise(function (resolve, reject) {
          if (typeof indexedDB === 'undefined') { reject(new Error('indexedDB unavailable')); return; }
          if (wallpaperDb) { resolve(wallpaperDb); return; }
          var req = indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = function (e) {
            var d = e.target.result;
            if (!d.objectStoreNames.contains(ICON_STORE_NAME)) {
              d.createObjectStore(ICON_STORE_NAME, { keyPath: 'url' });
            }
            if (!d.objectStoreNames.contains(STORE_NAME)) {
              d.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
          };
          req.onsuccess = function (e) {
            wallpaperDb = e.target.result;
            resolve(wallpaperDb);
          };
          req.onerror = function (e) {
            reject(e.target.error);
          };
        });
      }

      function saveWallpaperToDB(blob) {
        return openWallpaperDB().then(function () {
          return new Promise(function (resolve, reject) {
            var tx = wallpaperDb.transaction(STORE_NAME, 'readwrite');
            var store = tx.objectStore(STORE_NAME);
            store.put({ id: 'wallpaper', data: blob });
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function (e) { reject(e.target.error); };
          });
        });
      }

      function loadWallpaperFromDB() {
        return openWallpaperDB().then(function () {
          return new Promise(function (resolve, reject) {
            var tx = wallpaperDb.transaction(STORE_NAME, 'readonly');
            var store = tx.objectStore(STORE_NAME);
            var req = store.get('wallpaper');
            req.onsuccess = function (e) {
              resolve(e.target.result ? e.target.result.data : null);
            };
            req.onerror = function (e) { reject(e.target.error); };
          });
        });
      }

      // ========== 图标缓存（IndexedDB：缓存优先 + 7 天静默刷新 + 配额淘汰） ==========
      function loadIconCacheFromDB() {
        return openWallpaperDB().then(function (db) {
          if (!db || !db.objectStoreNames || !db.objectStoreNames.contains(ICON_STORE_NAME)) return [];
          return new Promise(function (resolve) {
            try {
              var tx = db.transaction(ICON_STORE_NAME, 'readonly');
              var store = tx.objectStore(ICON_STORE_NAME);
              if (!store || typeof store.getAll !== 'function') { resolve([]); return; }
              var req = store.getAll();
              req.onsuccess = function (e) {
                var rows = (e && e.target && Array.isArray(e.target.result)) ? e.target.result : [];
                rows.forEach(function (row) {
                  if (row && row.url && row.dataUrl) {
                    iconCacheMem[row.url] = {
                      url: row.url,
                      dataUrl: row.dataUrl,
                      fetchedAt: Number(row.fetchedAt) || 0,
                      size: Number(row.size) || String(row.dataUrl).length,
                      cleanVer: Number(row.cleanVer) || 0
                    };
                  }
                });
                resolve(rows);
              };
              req.onerror = function () { resolve([]); };
            } catch (err) { resolve([]); }
          });
        }).catch(function () { return []; });
      }

      function putIconToDB(url, dataUrl, fetchedAt, cleanVer) {
        if (!url || !dataUrl) return Promise.resolve(false);
        var defaultCleanVer = (canCleanRaster() || /^data:image\/svg\+xml/i.test(dataUrl)) ? ICON_CLEAN_VERSION : 0;
        var entry = {
          url: url,
          dataUrl: dataUrl,
          fetchedAt: typeof fetchedAt === 'number' ? fetchedAt : Date.now(),
          size: String(dataUrl).length,
          cleanVer: typeof cleanVer === 'number' ? cleanVer : defaultCleanVer
        };
        iconCacheMem[url] = entry;
        return openWallpaperDB().then(function (db) {
          if (!db || !db.objectStoreNames || !db.objectStoreNames.contains(ICON_STORE_NAME)) return false;
          return new Promise(function (resolve) {
            try {
              var tx = db.transaction(ICON_STORE_NAME, 'readwrite');
              var store = tx.objectStore(ICON_STORE_NAME);
              if (!store || typeof store.put !== 'function') { resolve(false); return; }
              store.put(entry);
              tx.oncomplete = function () { resolve(true); };
              tx.onerror = function () { resolve(false); };
            } catch (err) { resolve(false); }
          });
        }).catch(function () { return false; });
      }

      function deleteIconFromDB(url) {
        delete iconCacheMem[url];
        return openWallpaperDB().then(function (db) {
          if (!db || !db.objectStoreNames || !db.objectStoreNames.contains(ICON_STORE_NAME)) return;
          return new Promise(function (resolve) {
            try {
              var tx = db.transaction(ICON_STORE_NAME, 'readwrite');
              var store = tx.objectStore(ICON_STORE_NAME);
              if (!store || typeof store.delete !== 'function') { resolve(); return; }
              store.delete(url);
              tx.oncomplete = function () { resolve(); };
              tx.onerror = function () { resolve(); };
            } catch (err) { resolve(); }
          });
        }).catch(function () {});
      }

      function pruneIconCache(keepSet) {
        var keys = Object.keys(iconCacheMem);
        var totalChars = 0;
        keys.forEach(function (k) { totalChars += (iconCacheMem[k] && iconCacheMem[k].size) || 0; });
        if (keys.length <= ICON_MAX_ENTRIES && totalChars <= ICON_MAX_TOTAL_CHARS) return Promise.resolve();
        var candidates = keys.map(function (k) {
          var e = iconCacheMem[k];
          return {
            url: k,
            pinned: !!(keepSet && keepSet[k]),
            fetchedAt: (e && e.fetchedAt) || 0,
            size: (e && e.size) || 0
          };
        }).sort(function (a, b) {
          if (a.pinned !== b.pinned) return a.pinned ? 1 : -1;
          return a.fetchedAt - b.fetchedAt;
        });
        var drops = [];
        var count = keys.length;
        for (var i = 0; i < candidates.length && (count > ICON_MAX_ENTRIES || totalChars > ICON_MAX_TOTAL_CHARS); i++) {
          var c = candidates[i];
          count--;
          totalChars -= c.size;
          drops.push(deleteIconFromDB(c.url));
        }
        return Promise.all(drops);
      }

      function applyCachedIconsToDom() {
        nav.querySelectorAll('.shortcut').forEach(function (card) {
          var item = cardItemMap.get(card);
          if (!item) return;
          if (isFolderItem(item)) {
            var ftile = card.querySelector('.tile');
            if (ftile) fillFolderTile(ftile, item);
            return;
          }
          if (item.iconSrc !== 'image' || !item.icon || !/^(?:https?:|bmicon:)/i.test(item.icon)) return;
          var cached = getCachedIconSync(item.icon);
          if (!cached) return;
          var tile = card.querySelector('.tile');
          if (!tile) return;
          var img = tile.querySelector('img');
          if (!img) {
            fillTile(tile, item);
            return;
          }
          if (img.src !== cached) {
            delete img.dataset.retriedRemote;
            img.src = cached;
          }
        });
        var eng = window.__motuo && window.__motuo.engines;
        if (eng && typeof eng.applyCachedIcons === 'function') eng.applyCachedIcons();
      }

      function walkCards(items, fn) {
        (items || []).forEach(function (it) {
          if (!it) return;
          if (isFolderItem(it)) walkCards(it.children, fn);
          else fn(it);
        });
      }

      function collectPinnedIconKeys() {
        var keep = {};
        walkCards(list, function (it) {
          if (it.iconSrc === 'image' && typeof it.icon === 'string' && /^(?:https?:|bmicon:)/i.test(it.icon)) keep[it.icon] = true;
        });
        var eng = window.__motuo && window.__motuo.engines;
        if (eng && typeof eng.getIconUrls === 'function') {
          eng.getIconUrls().forEach(function (u) { keep[u] = true; });
        }
        return keep;
      }

      function collectRemoteIconUrls() {
        var seen = {};
        var urls = [];
        function pushUrl(u) {
          if (u && /^https?:/i.test(u) && !seen[u]) {
            seen[u] = true;
            urls.push(u);
          }
        }
        walkCards(list, function (item) {
          if (item.iconSrc === 'image' && typeof item.icon === 'string') pushUrl(item.icon);
        });
        var eng = window.__motuo && window.__motuo.engines;
        if (eng && typeof eng.getIconUrls === 'function') {
          eng.getIconUrls().forEach(pushUrl);
        }
        return urls;
      }

      function syncIcons(options) {
        var opts = options || {};
        var force = !!opts.force;
        var ready = iconCacheReadyPromise || loadIconCacheFromDB().then(function () { applyCachedIconsToDom(); });
        return ready.then(function () {
          var allUrls = Array.isArray(opts.urls)
            ? opts.urls.filter(function (u) { return /^https?:/i.test(u || ''); })
            : collectRemoteIconUrls();
          var now = Date.now();
          var targets = allUrls.filter(function (u) {
            if (force) return true;
            var entry = iconCacheMem[u];
            return !entry || !entry.dataUrl || (now - (entry.fetchedAt || 0)) >= ICON_TTL_MS;
          });
          var updated = 0, failed = 0, kept = 0;
          return Promise.all(targets.map(function (u) {
            return cacheImageAsDataUrl(u).then(function (dataUrl) {
              if (dataUrl) {
                return putIconToDB(u, dataUrl, Date.now()).then(function () { updated++; });
              }
              failed++;
              if (iconCacheMem[u] && iconCacheMem[u].dataUrl) kept++;
            });
          })).then(function () {
            if (updated > 0) applyCachedIconsToDom();
            var keepSet = collectPinnedIconKeys();
            return pruneIconCache(keepSet).then(function () {
              return { total: allUrls.length, attempted: targets.length, updated: updated, failed: failed, kept: kept };
            });
          });
        }).catch(function () {
          return { total: 0, attempted: 0, updated: 0, failed: 0, kept: 0 };
        });
      }

      function upgradeCachedIconsIfNeeded() {
        var keys = Object.keys(iconCacheMem);
        var pending = keys.filter(function (k) {
          var e = iconCacheMem[k];
          return e && e.dataUrl && (e.cleanVer || 0) < ICON_CLEAN_VERSION;
        });
        if (!pending.length) return Promise.resolve(false);
        var domDirty = false;
        return Promise.all(pending.map(function (k) {
          var entry = iconCacheMem[k];
          if (!entry || !entry.dataUrl) return Promise.resolve();
          return cleanIconDataUrl(entry.dataUrl).then(function (res) {
            if (!res || !res.processed) return;
            if (res.changed && res.dataUrl) domDirty = true;
            var nextUrl = (res.changed && res.dataUrl) ? res.dataUrl : entry.dataUrl;
            return putIconToDB(entry.url, nextUrl, entry.fetchedAt, ICON_CLEAN_VERSION);
          }).catch(function () {});
        })).then(function () {
          if (domDirty) applyCachedIconsToDom();
          return domDirty;
        });
      }

      function upgradeLocalDataIconsIfNeeded() {
        var rasterCapable = canCleanRaster();
        try {
          if (rasterCapable && localStorage.getItem(ICON_LOCAL_CLEAN_VER_KEY) === String(ICON_CLEAN_VERSION)) {
            return Promise.resolve(false);
          }
        } catch (e) {}
        var tasks = [];
        walkCards(list, function (it) {
          if (it && it.iconSrc === 'image' && typeof it.icon === 'string' && /^data:image\//i.test(it.icon)) {
            if (!rasterCapable && !/^data:image\/svg\+xml/i.test(it.icon)) return;
            tasks.push(cleanIconDataUrl(it.icon).then(function (res) {
              if (res && res.changed && res.dataUrl) {
                it.icon = res.dataUrl;
                return true;
              }
              return false;
            }).catch(function () { return false; }));
          }
        });
        var markLocalDone = function () {
          if (rasterCapable) {
            try { localStorage.setItem(ICON_LOCAL_CLEAN_VER_KEY, String(ICON_CLEAN_VERSION)); } catch (e2) {}
          }
        };
        if (!tasks.length) {
          markLocalDone();
          return Promise.resolve(false);
        }
        return Promise.all(tasks).then(function (flags) {
          var anyChanged = flags.some(Boolean);
          markLocalDone();
          if (anyChanged) {
            save(list);
            render(list);
          }
          return anyChanged;
        });
      }

      function initIconCache() {
        iconCacheReadyPromise = loadIconCacheFromDB().then(function () {
          applyCachedIconsToDom();
          return Promise.all([upgradeCachedIconsIfNeeded(), upgradeLocalDataIconsIfNeeded()]);
        }).catch(function () {});
        return iconCacheReadyPromise.then(function () {
          return syncIcons({ force: false });
        }).catch(function () {});
      }

      function removeWallpaperFromDB() {
        return openWallpaperDB().then(function () {
          return new Promise(function (resolve, reject) {
            var tx = wallpaperDb.transaction(STORE_NAME, 'readwrite');
            var store = tx.objectStore(STORE_NAME);
            store.delete('wallpaper');
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function (e) { reject(e.target.error); };
          });
        });
      }

      // 当前壁纸的 object URL，用于清理
      var currentWallpaperUrl = null;
      // （SOLID_COLOR_KEY / BLUR_KEY 已在顶部 CONFIG 声明）

      function getSolidColor() {
        try { return localStorage.getItem(SOLID_COLOR_KEY) || ''; } catch (e) { return ''; }
      }

      function setSolidColor(c) {
        try {
          if (c) { localStorage.setItem(SOLID_COLOR_KEY, c); }
          else { localStorage.removeItem(SOLID_COLOR_KEY); }
        } catch (e) {}
      }

      function getBlur() {
        try { var v = parseFloat(localStorage.getItem(BLUR_KEY)); return isNaN(v) ? 3 : v; } catch (e) { return 3; }
      }

      function setBlur(v) {
        try { localStorage.setItem(BLUR_KEY, v); } catch (e) {}
      }

      var bgContainer = document.getElementById('bgContainer');
      var bgVideo = document.getElementById('bgVideo');

      function stopBgVideo() {
        if (!bgVideo) return;
        try { bgVideo.pause(); } catch (e) {}
        bgVideo.style.display = 'none';
        if (bgVideo.getAttribute('src')) bgVideo.removeAttribute('src');
        try { bgVideo.load(); } catch (e) {}
      }

      function applyBackground(blob, solidColor, blurPx) {
        if (currentWallpaperUrl) {
          URL.revokeObjectURL(currentWallpaperUrl);
          currentWallpaperUrl = null;
        }
        bgContainer.style.backgroundImage = 'none';
        bgContainer.style.filter = 'none';
        document.body.style.background = '';
        stopBgVideo();

        if (solidColor) {
          document.body.style.background = solidColor;
        } else if (blob && /^video\//i.test(blob.type || '')) {
          // 动态壁纸（视频）：铺满容器的 <video>，静音循环自动播放
          currentWallpaperUrl = URL.createObjectURL(blob);
          if (bgVideo) {
            bgVideo.src = currentWallpaperUrl;
            bgVideo.style.display = 'block';
            bgContainer.style.filter = 'blur(' + (blurPx || 0) + 'px)';
            document.body.style.background = 'var(--overlay-bg)';
            var p = bgVideo.play();
            if (p && p.catch) p.catch(function () {});
          }
        } else if (blob) {
          currentWallpaperUrl = URL.createObjectURL(blob);
          bgContainer.style.backgroundImage = 'url(' + currentWallpaperUrl + ')';
          bgContainer.style.filter = 'blur(' + (blurPx || 0) + 'px)';
          // 遮罩改用 CSS 变量，深色模式下自动切换为深色遮罩（主题切换即时生效）
          document.body.style.background = 'var(--overlay-bg)';
        }
      }

      // 统一刷新背景：纯色 > 壁纸图片 > 默认渐变
      function refreshBackground() {
        var c = getSolidColor();
        if (c) { applyBackground(null, c); return; }
        var blur = getBlur();
        loadWallpaperFromDB().then(function (blob) {
          applyBackground(blob, null, blur);
        }).catch(function () { applyBackground(null, null); });
      }

      // 页面加载时读取壁纸
      (function initWallpaper() {
        refreshBackground();
      })();

      // ========== 主题模式：浅色 / 深色 / 跟随系统（Auto） ==========
      function getTheme() {
        try { return localStorage.getItem(THEME_KEY) || 'light'; } catch (e) { return 'light'; }
      }
      var darkSchemeMql = (window.matchMedia && typeof window.matchMedia === 'function')
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
      function systemPrefersDark() {
        return !!(darkSchemeMql && darkSchemeMql.matches);
      }
      function resolveTheme(mode) {
        if (mode === 'dark') return 'dark';
        if (mode === 'auto') return systemPrefersDark() ? 'dark' : 'light';
        return 'light';
      }
      function updateThemeButtons(mode) {
        document.querySelectorAll('.theme-btn').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-theme') === mode);
        });
      }
      function applyTheme(mode) {
        var pref = (mode === 'dark' || mode === 'auto') ? mode : 'light';
        var resolved = resolveTheme(pref);
        document.documentElement.setAttribute('data-theme-mode', pref);
        document.documentElement.setAttribute('data-theme', resolved);
        updateThemeButtons(pref);
        var sideTxt = document.getElementById('sysSideThemeText');
        if (sideTxt) {
          sideTxt.textContent = pref === 'dark' ? '深色主题' : pref === 'auto' ? ('跟随系统（' + (resolved === 'dark' ? '深色' : '浅色') + '）') : '浅色主题';
        }
      }
      function setTheme(mode, persist) {
        var pref = (mode === 'dark' || mode === 'auto') ? mode : 'light';
        applyTheme(pref);
        if (persist !== false) {
          try { localStorage.setItem(THEME_KEY, pref); } catch (e) {}
        }
      }
      if (darkSchemeMql) {
        var onSystemSchemeChange = function () {
          if (getTheme() === 'auto') applyTheme('auto');
        };
        if (typeof darkSchemeMql.addEventListener === 'function') {
          darkSchemeMql.addEventListener('change', onSystemSchemeChange);
        } else if (typeof darkSchemeMql.addListener === 'function') {
          darkSchemeMql.addListener(onSystemSchemeChange);
        }
      }
      document.querySelectorAll('.theme-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          setTheme(btn.getAttribute('data-theme'));
        });
      });
      // 初始化：应用已保存的主题（不重复写回）

      // ========== 温和备份提醒（30 天未导出 / 稍后 7 天） ==========
      function readBackupMeta() {
        try {
          var obj = JSON.parse(localStorage.getItem(BACKUP_META_KEY) || 'null');
          return (obj && typeof obj === 'object') ? obj : {};
        } catch (e) { return {}; }
      }
      function writeBackupMeta(meta) {
        try { localStorage.setItem(BACKUP_META_KEY, JSON.stringify(meta)); } catch (e) {}
      }
      function refreshBackupReminder() {
        var meta = readBackupMeta();
        var now = Date.now();
        if (!meta.firstSeenAt) {
          meta.firstSeenAt = now;
          meta.lastExportAt = meta.lastExportAt || 0;
          meta.dismissedAt = meta.dismissedAt || 0;
          writeBackupMeta(meta);
        }
        var ref = meta.lastExportAt || meta.firstSeenAt;
        var overdue = ref > 0 && (now - ref) >= BACKUP_REMIND_MS;
        var dismissed = meta.dismissedAt > 0 && (now - meta.dismissedAt) < BACKUP_DISMISS_MS;
        var show = overdue && !dismissed;
        var gBtn = document.getElementById('generalConfigBtn');
        var bar = document.getElementById('backupReminderBar');
        var txt = document.getElementById('backupReminderText');
        fabBtn.classList.toggle('has-backup-dot', show);
        if (gBtn) gBtn.classList.toggle('has-backup-dot', show);
        var navDotBtn = document.getElementById('sysDataNavBtn');
        if (navDotBtn) navDotBtn.classList.toggle('has-backup-dot', show);
        if (bar) bar.hidden = !show;
        if (show && txt) {
          var days = Math.max(30, Math.floor((now - ref) / 86400000));
          txt.textContent = '已超过 ' + days + ' 天未导出备份，建议留存一份';
        }
      }
      function recordBackupExported() {
        var meta = readBackupMeta();
        if (!meta.firstSeenAt) meta.firstSeenAt = Date.now();
        meta.lastExportAt = Date.now();
        meta.dismissedAt = 0;
        writeBackupMeta(meta);
        refreshBackupReminder();
      }
      var remindExportBtn = document.getElementById('backupRemindExport');
      var remindLaterBtn = document.getElementById('backupRemindLater');
      if (remindExportBtn) remindExportBtn.addEventListener('click', function () { exportBtn.click(); });
      if (remindLaterBtn) {
        remindLaterBtn.addEventListener('click', function () {
          var meta = readBackupMeta();
          if (!meta.firstSeenAt) meta.firstSeenAt = Date.now();
          meta.dismissedAt = Date.now();
          writeBackupMeta(meta);
          refreshBackupReminder();
        });
      }
      refreshBackupReminder();
      setTheme(getTheme(), false);

      // ========== 统一系统设置弹窗导航 + 旧入口直达 ==========
      var sysSavedTimer = null;
      function flashSysSaved(msg) {
        var hint = document.getElementById('sysSavedHint');
        if (!hint) return;
        hint.textContent = msg || '已保存';
        hint.classList.add('show');
        clearTimeout(sysSavedTimer);
        sysSavedTimer = setTimeout(function () { hint.classList.remove('show'); }, 1500);
      }

      function switchSettingsPane(paneName) {
        var modal = document.getElementById('generalConfigModal');
        if (!modal) return;
        var navEl = document.getElementById('sysConfigNav');
        if (navEl) {
          navEl.querySelectorAll('button[data-pane]').forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-pane') === paneName);
          });
        }
        modal.querySelectorAll('.ai-config-pane').forEach(function (p) {
          p.classList.toggle('active', p.getAttribute('data-pane') === paneName);
        });
        var panesEl = document.getElementById('sysConfigPanes');
        if (panesEl) panesEl.scrollTop = 0;
      }

      function openSettingsModal(paneName) {
        switchSettingsPane(paneName || 'general');
        renderSiteDirectRules();
        openModal(document.getElementById('generalConfigModal'));
      }

      var sysConfigNav = document.getElementById('sysConfigNav');
      if (sysConfigNav) {
        sysConfigNav.addEventListener('click', function (e) {
          var b = e.target.closest('button[data-pane]');
          if (!b) return;
          switchSettingsPane(b.getAttribute('data-pane'));
        });
      }

      if (personalizeBtn) {
        personalizeBtn.addEventListener('click', function () {
          toggleMenu(false);
          openSettingsModal('appearance');
        });
      }
      var aboutBtn = document.getElementById('aboutBtn');
      if (aboutBtn) {
        aboutBtn.addEventListener('click', function () {
          toggleMenu(false);
          openSettingsModal('about');
        });
      }
      var shortcutBtn = document.getElementById('shortcutBtn');
      if (shortcutBtn) {
        shortcutBtn.addEventListener('click', function () {
          toggleMenu(false);
          openSettingsModal('keys');
        });
      }
      var cfgOpenEngineBtn = document.getElementById('cfgOpenEngineBtn');
      if (cfgOpenEngineBtn) {
        cfgOpenEngineBtn.addEventListener('click', function () {
          closeModal(document.getElementById('generalConfigModal'));
          var engModal = document.getElementById('engineModal');
          if (engModal) openModal(engModal);
        });
      }

      document.getElementById('helpBtn').addEventListener('click', function () {
        toggleMenu(false);
        openModal(document.getElementById('helpModal'));
      });

      // 帮助弹窗：左侧章节导航 → 平滑滚动到对应区块，并按滚动位置高亮当前章节
      (function initHelpModal() {
        var modal = document.getElementById('helpModal');
        if (!modal) return;
        var content = modal.querySelector('.help-content');
        var nav = modal.querySelector('.help-nav');
        if (!content || !nav) return;
        var items = Array.prototype.slice.call(nav.querySelectorAll('.help-nav-item'));
        var sections = Array.prototype.slice.call(content.querySelectorAll('.help-section'));

        function setActive(idx) {
          items.forEach(function (a, i) { a.classList.toggle('active', i === idx); });
        }
        items.forEach(function (a, i) {
          a.addEventListener('click', function (e) {
            e.preventDefault();
            var sec = sections[i];
            if (!sec) return;
            content.scrollTo({ top: sec.offsetTop - 12, behavior: 'smooth' });
            setActive(i);
          });
        });
        function onScroll() {
          var top = content.scrollTop + 48;
          var idx = 0;
          sections.forEach(function (sec, i) {
            if (sec.offsetTop <= top) idx = i;
          });
          setActive(idx);
        }
        content.addEventListener('scroll', onScroll);
      })();

      document.getElementById('generalConfigBtn').addEventListener('click', function () {
        toggleMenu(false);
        openSettingsModal('general');
      });

      // ========== T1 起始页 Hero Logo 与时段问候语 ==========
      var MOTUO_LOGOS = {
        a: '<svg class="motuo-logo-svg" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 46C12 46 14 21 21 16C26 12.5 30 24 32 29C34 24 38 12.5 43 16C50 21 52 46 52 46C52 48.5 48.5 50 45.5 48C42.5 46 41 32 39 27C37 33 34.5 38.5 32 38.5C29.5 38.5 27 33 25 27C23 32 21.5 46 18.5 48C15.5 50 12 48.5 12 46Z" fill="url(#mtLogoGradV)" stroke="var(--logo-rim)" stroke-width="1"/></svg>',
        c: '<svg class="motuo-logo-svg" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 14H37L50 27V44C50 48.4 46.4 52 42 52H22C17.6 52 14 48.4 14 44V22C14 17.6 17.6 14 22 14Z" fill="url(#mtLogoGradV)" stroke="var(--logo-rim)" stroke-width="1"/><path d="M37 14V23C37 25.2 38.8 27 41 27H50L37 14Z" fill="var(--logo-accent)"/><path d="M23 39V30L32 37L41 30V39" stroke="var(--logo-rim)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      };
      var heroBrandEl = document.getElementById('heroBrand');
      var heroLogoWrapEl = document.getElementById('heroLogoWrap');
      var aboutLogoSlotEl = document.getElementById('aboutLogoSlot');
      var pageTitleEl = document.getElementById('pageTitle') || document.querySelector('.hero-greeting') || document.querySelector('.page-title');
      var toggleGreetingEl = document.getElementById('toggleGreeting');
      var toggleHeroLogoEl = document.getElementById('toggleHeroLogo');
      var logoStyleSwitchEl = document.getElementById('logoStyleSwitch');
      var heroLogoAlphaRowEl = document.getElementById('heroLogoAlphaRow');
      var heroLogoAlphaSliderEl = document.getElementById('heroLogoAlphaSlider');
      var heroLogoAlphaValEl = document.getElementById('heroLogoAlphaVal');

      function greetingForHour(h) {
        if (h < 5) return '夜深了，早点休息';
        if (h < 9) return '早上好，想干什么';
        if (h < 12) return '上午好，今天顺顺利利';
        if (h < 14) return '中午好，记得休息一下';
        if (h < 18) return '下午好，继续手头的事吧';
        if (h < 20) return '傍晚好，今天辛苦了';
        return '晚上好，慢慢来';
      }
      function isGreetingEnabled() {
        try { return localStorage.getItem(GREETING_KEY) !== '0'; } catch (e) { return true; }
      }
      function isHeroLogoEnabled() {
        try { return localStorage.getItem(HERO_LOGO_KEY) !== '0'; } catch (e) { return true; }
      }
      function getLogoStyle() {
        try {
          var v = localStorage.getItem(LOGO_STYLE_KEY);
          return v === 'c' ? 'c' : 'a';
        } catch (e) { return 'a'; }
      }
      function setLogoStyle(style) {
        var next = style === 'c' ? 'c' : 'a';
        try { localStorage.setItem(LOGO_STYLE_KEY, next); } catch (e) {}
        renderBrandHero();
        return next;
      }
      function clampHeroLogoAlpha(val) {
        var n = parseFloat(val);
        if (!isFinite(n)) return 0.65;
        n = Math.max(0.2, Math.min(1, n));
        return Math.round(n * 100) / 100;
      }
      function getHeroLogoAlpha() {
        try {
          var raw = localStorage.getItem(HERO_LOGO_ALPHA_KEY);
          return raw === null ? 0.65 : clampHeroLogoAlpha(raw);
        } catch (e) { return 0.65; }
      }
      function setHeroLogoAlpha(val) {
        var next = clampHeroLogoAlpha(val);
        try { localStorage.setItem(HERO_LOGO_ALPHA_KEY, String(next)); } catch (e) {}
        renderBrandHero();
        return next;
      }
      function renderLogoThumbPreviews() {
        if (!logoStyleSwitchEl) return;
        logoStyleSwitchEl.querySelectorAll('.sys-logo-thumb[data-thumb]').forEach(function (thumb) {
          var key = thumb.getAttribute('data-thumb');
          if (!thumb.firstChild && MOTUO_LOGOS[key]) {
            thumb.innerHTML = MOTUO_LOGOS[key];
          }
        });
      }
      function renderBrandHero(hourOverride) {
        var greetOn = isGreetingEnabled();
        var logoOn = isHeroLogoEnabled();
        var style = getLogoStyle();
        var alpha = getHeroLogoAlpha();
        var sliderPct = Math.round(((alpha - 0.2) / 0.8) * 1000) / 10;
        var svgMarkup = MOTUO_LOGOS[style] || MOTUO_LOGOS.a;

        document.documentElement.style.setProperty('--hero-logo-alpha', String(alpha));
        document.documentElement.style.setProperty('--hero-logo-slider-pct', sliderPct + '%');

        if (toggleGreetingEl) toggleGreetingEl.checked = greetOn;
        if (toggleHeroLogoEl) toggleHeroLogoEl.checked = logoOn;
        if (heroLogoAlphaRowEl) heroLogoAlphaRowEl.classList.toggle('is-disabled', !logoOn);
        if (heroLogoAlphaSliderEl) {
          heroLogoAlphaSliderEl.value = String(alpha);
          heroLogoAlphaSliderEl.disabled = !logoOn;
        }
        if (heroLogoAlphaValEl) heroLogoAlphaValEl.textContent = Math.round(alpha * 100) + '%';
        if (logoStyleSwitchEl) {
          logoStyleSwitchEl.classList.toggle('is-disabled', !logoOn);
          logoStyleSwitchEl.querySelectorAll('.sys-logo-option').forEach(function (btn) {
            var active = btn.getAttribute('data-logo-style') === style;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-checked', active ? 'true' : 'false');
          });
        }
        renderLogoThumbPreviews();

        if (heroLogoWrapEl) {
          if (heroLogoWrapEl.getAttribute('data-logo-style') !== style) {
            heroLogoWrapEl.innerHTML = svgMarkup;
            heroLogoWrapEl.setAttribute('data-logo-style', style);
          }
          heroLogoWrapEl.hidden = !logoOn;
        }
        if (aboutLogoSlotEl && aboutLogoSlotEl.getAttribute('data-logo-style') !== style) {
          aboutLogoSlotEl.innerHTML = svgMarkup;
          aboutLogoSlotEl.setAttribute('data-logo-style', style);
        }
        if (pageTitleEl) {
          var h = typeof hourOverride === 'number' ? hourOverride : new Date().getHours();
          pageTitleEl.textContent = greetOn ? greetingForHour(h) : '';
          pageTitleEl.hidden = !greetOn;
        }
        if (heroBrandEl) {
          heroBrandEl.hidden = !logoOn && !greetOn;
        }
      }
      var renderGreeting = renderBrandHero;

      if (toggleGreetingEl) {
        toggleGreetingEl.addEventListener('change', function () {
          try { localStorage.setItem(GREETING_KEY, this.checked ? '1' : '0'); } catch (e) {}
          renderBrandHero();
          flashSysSaved();
        });
      }
      if (toggleHeroLogoEl) {
        toggleHeroLogoEl.addEventListener('change', function () {
          try { localStorage.setItem(HERO_LOGO_KEY, this.checked ? '1' : '0'); } catch (e) {}
          renderBrandHero();
          flashSysSaved();
        });
      }
      if (logoStyleSwitchEl) {
        logoStyleSwitchEl.addEventListener('click', function (e) {
          var btn = e.target.closest('.sys-logo-option[data-logo-style]');
          if (!btn) return;
          setLogoStyle(btn.getAttribute('data-logo-style'));
          flashSysSaved();
        });
      }
      if (heroLogoAlphaSliderEl) {
        heroLogoAlphaSliderEl.addEventListener('input', function () {
          setHeroLogoAlpha(this.value);
        });
        heroLogoAlphaSliderEl.addEventListener('change', function () {
          setHeroLogoAlpha(this.value);
          flashSysSaved();
        });
      }
      renderBrandHero();

      // 手动刷新图标缓存（强制全量重抓，失败保留旧缓存）
      var refreshIconsBtn = document.getElementById('refreshIconsBtn');
      var refreshIconsStatus = document.getElementById('refreshIconsStatus');
      if (refreshIconsBtn) {
        refreshIconsBtn.addEventListener('click', function () {
          refreshIconsBtn.disabled = true;
          if (refreshIconsStatus) refreshIconsStatus.textContent = '正在更新图标缓存…';
          syncIcons({ force: true }).then(function (res) {
            if (refreshIconsStatus) {
              if (!res || res.total === 0) {
                refreshIconsStatus.textContent = '当前没有可刷新的远程图标';
              } else if (res.failed === 0) {
                refreshIconsStatus.textContent = '已更新 ' + res.updated + ' 个图标缓存';
              } else {
                refreshIconsStatus.textContent = '已更新 ' + res.updated + ' 个，' + res.failed + ' 个拉取失败已保留旧缓存';
              }
            }
          }).finally(function () {
            refreshIconsBtn.disabled = false;
          });
        });
      }

      // 站内搜索直达开关（菜单药丸 ↔ 系统设置双向同步）
      var siteDirectToggle = document.getElementById('toggleSiteDirect');
      var cfgSiteDirectToggle = document.getElementById('cfgToggleSiteDirect');
      function syncSiteDirectToggles(on) {
        if (siteDirectToggle) siteDirectToggle.checked = on;
        if (cfgSiteDirectToggle) cfgSiteDirectToggle.checked = on;
      }
      syncSiteDirectToggles(readLS('newtab.sitedirect.v1') !== '0');
      [siteDirectToggle, cfgSiteDirectToggle].forEach(function (el) {
        if (!el) return;
        el.addEventListener('change', function () {
          var on = !!this.checked;
          writeLS('newtab.sitedirect.v1', on ? '1' : '0');
          syncSiteDirectToggles(on);
          flashSysSaved();
        });
      });

      // 联网搜索建议开关（菜单药丸 ↔ 系统设置双向同步）
      var suggestOnlineToggle = document.getElementById('toggleSuggestOnline');
      var cfgSuggestOnlineToggle = document.getElementById('cfgToggleSuggestOnline');
      function syncSuggestOnlineToggles(on) {
        if (suggestOnlineToggle) suggestOnlineToggle.checked = on;
        if (cfgSuggestOnlineToggle) cfgSuggestOnlineToggle.checked = on;
      }
      syncSuggestOnlineToggles(readLS('newtab.suggestOnline.v1') !== '0');
      [suggestOnlineToggle, cfgSuggestOnlineToggle].forEach(function (el) {
        if (!el) return;
        el.addEventListener('change', function () {
          var on = !!this.checked;
          writeLS('newtab.suggestOnline.v1', on ? '1' : '0');
          syncSuggestOnlineToggles(on);
          flashSysSaved();
        });
      });

      // ========== T3 站内搜索直达规则管理 ==========
      var siteDirectListEl = document.getElementById('siteDirectList');
      var sdKeyInput = document.getElementById('sdKeyInput');
      var sdNameInput = document.getElementById('sdNameInput');
      var sdUrlInput = document.getElementById('sdUrlInput');
      var sdAddBtn = document.getElementById('sdAddBtn');
      var sdResetBtn = document.getElementById('sdResetBtn');

      function renderSiteDirectRules() {
        var sd = window.__motuo && window.__motuo.siteDirect;
        if (!siteDirectListEl || !sd) return;
        var rules = sd.getList();
        siteDirectListEl.innerHTML = '';
        if (!rules.length) {
          var em = document.createElement('div');
          em.className = 'hist-empty';
          em.textContent = '暂无站内直达规则，可上方添加或点击「恢复默认」';
          siteDirectListEl.appendChild(em);
          return;
        }
        rules.forEach(function (rule, idx) {
          var row = document.createElement('div');
          row.className = 'sys-sd-item';
          var badge = document.createElement('span');
          badge.className = 'sys-sd-badge';
          badge.textContent = rule.key;
          var nm = document.createElement('span');
          nm.className = 'sys-sd-name-lbl';
          nm.textContent = rule.name;
          var ul = document.createElement('span');
          ul.className = 'sys-sd-url-lbl';
          ul.textContent = rule.url;
          ul.title = rule.url;
          var del = document.createElement('button');
          del.type = 'button';
          del.className = 'sys-sd-del';
          del.textContent = '×';
          del.title = '删除该规则';
          del.setAttribute('aria-label', '删除 ' + rule.key);
          del.addEventListener('click', function () {
            var cur = sd.getList();
            cur.splice(idx, 1);
            sd.saveList(cur);
            renderSiteDirectRules();
            flashSysSaved();
          });
          row.appendChild(badge);
          row.appendChild(nm);
          row.appendChild(ul);
          row.appendChild(del);
          siteDirectListEl.appendChild(row);
        });
      }
      if (sdAddBtn) {
        sdAddBtn.addEventListener('click', function () {
          var sd = window.__motuo && window.__motuo.siteDirect;
          if (!sd) return;
          var k = (sdKeyInput ? sdKeyInput.value : '').trim().toLowerCase();
          var n = (sdNameInput ? sdNameInput.value : '').trim();
          var u = (sdUrlInput ? sdUrlInput.value : '').trim();
          if (!k || /\s/.test(k)) { alert('请填写不含空格的触发词（如 wk）'); return; }
          if (!u) { alert('请填写搜索网址'); return; }
          if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
          var cur = sd.getList();
          var dupIdx = cur.findIndex(function (r) { return String(r.key).toLowerCase() === k; });
          var nextRule = { key: k, name: n || k, url: u };
          if (dupIdx !== -1) cur[dupIdx] = nextRule;
          else cur.push(nextRule);
          sd.saveList(cur);
          if (sdKeyInput) sdKeyInput.value = '';
          if (sdNameInput) sdNameInput.value = '';
          if (sdUrlInput) sdUrlInput.value = '';
          renderSiteDirectRules();
          flashSysSaved();
        });
      }
      if (sdResetBtn) {
        sdResetBtn.addEventListener('click', function () {
          var sd = window.__motuo && window.__motuo.siteDirect;
          if (!sd) return;
          sd.resetDefault();
          renderSiteDirectRules();
          flashSysSaved('已恢复默认');
        });
      }
      renderSiteDirectRules();

      // ========== T6 浏览器书签 HTML 导入与预览 ==========
      function hashString(str) {
        var h = 2166136261;
        for (var i = 0; i < str.length; i++) {
          h ^= str.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(36);
      }

      function parseBookmarkHtml(htmlText) {
        var doc = new DOMParser().parseFromString(String(htmlText || ''), 'text/html');
        var groups = [];
        var rootBucket = { name: '', isRoot: true, items: [] };

        function collectDl(dlEl, folderName) {
          if (!dlEl) return;
          var children = dlEl.children || [];
          var currentBucket = folderName ? { name: folderName, isRoot: false, items: [] } : rootBucket;
          for (var i = 0; i < children.length; i++) {
            var node = children[i];
            if (!node || !node.tagName) continue;
            var tag = node.tagName.toUpperCase();
            if (tag === 'DT') {
              var h3 = null, a = null, subDl = null;
              for (var k = 0; k < node.children.length; k++) {
                var c = node.children[k];
                var ct = c.tagName ? c.tagName.toUpperCase() : '';
                if (!h3 && ct === 'H3') h3 = c;
                else if (!a && ct === 'A') a = c;
                else if (!subDl && ct === 'DL') subDl = c;
              }
              if (h3) {
                if (!subDl && node.nextElementSibling && node.nextElementSibling.tagName && node.nextElementSibling.tagName.toUpperCase() === 'DL') {
                  subDl = node.nextElementSibling;
                }
                collectDl(subDl, (h3.textContent || '').trim() || '未命名文件夹');
              } else if (a) {
                var href = (a.getAttribute('href') || '').trim();
                if (/^https?:\/\//i.test(href)) {
                  var icon = (a.getAttribute('icon') || '').trim();
                  currentBucket.items.push({
                    name: ((a.textContent || '').trim() || href).slice(0, 40),
                    url: href,
                    iconDataUrl: /^data:image\//i.test(icon) ? icon : ''
                  });
                }
              } else if (subDl) {
                collectDl(subDl, folderName);
              }
            } else if (tag === 'DL') {
              collectDl(node, folderName);
            }
          }
          if (folderName && currentBucket.items.length) groups.push(currentBucket);
        }

        var topDls = doc.querySelectorAll('body > dl');
        if (topDls && topDls.length) {
          for (var d = 0; d < topDls.length; d++) collectDl(topDls[d], '');
        } else {
          var firstDl = doc.querySelector('dl');
          if (firstDl) collectDl(firstDl, '');
          else {
            // Fallback: flat <a> tags
            doc.querySelectorAll('a[href]').forEach(function (aEl) {
              var href = (aEl.getAttribute('href') || '').trim();
              if (/^https?:\/\//i.test(href)) {
                var ic = (aEl.getAttribute('icon') || '').trim();
                rootBucket.items.push({
                  name: ((aEl.textContent || '').trim() || href).slice(0, 40),
                  url: href,
                  iconDataUrl: /^data:image\//i.test(ic) ? ic : ''
                });
              }
            });
          }
        }
        if (rootBucket.items.length) groups.unshift(rootBucket);
        return groups;
      }

      function collectExistingUrlSet() {
        var set = {};
        walkCards(list, function (it) {
          if (it && it.url) set[it.url.replace(/\/+$/, '')] = true;
        });
        return set;
      }

      function applyParsedBookmarks(selectedGroups, opts) {
        opts = opts || {};
        var mapFolders = opts.mapFolders !== false;
        var dedupUrl = opts.dedupUrl !== false;
        var existingUrls = dedupUrl ? collectExistingUrlSet() : {};
        var folderMap = {};
        list.forEach(function (it) { if (isFolderItem(it)) folderMap[it.name] = it; });

        var imported = 0, skipped = 0, iconPromises = [];
        function toCard(bm) {
          var normU = String(bm.url || '').trim().replace(/\/+$/, '');
          if (dedupUrl && existingUrls[normU]) { skipped++; return null; }
          if (normU) existingUrls[normU] = true;
          imported++;
          if (bm.iconDataUrl) {
            var key = 'bmicon:' + hashString(bm.iconDataUrl);
            var rawBmIcon = bm.iconDataUrl;
            iconPromises.push(cleanIconDataUrlStr(rawBmIcon).then(function (cleanedBmIcon) {
              return putIconToDB(key, cleanedBmIcon || rawBmIcon, Date.now());
            }));
            return { name: bm.name, url: bm.url, iconSrc: 'image', icon: key };
          }
          return { name: bm.name, url: bm.url, iconSrc: 'auto', color: pickRandomColor() };
        }

        (selectedGroups || []).forEach(function (grp) {
          var cardsToAdd = (grp.items || []).map(toCard).filter(Boolean);
          if (!cardsToAdd.length) return;
          if (mapFolders && !grp.isRoot && grp.name) {
            var fld = folderMap[grp.name];
            if (!fld) {
              fld = { type: 'folder', id: makeFolderId(), name: grp.name.slice(0, 20), children: [] };
              list.push(fld);
              folderMap[grp.name] = fld;
            }
            if (!Array.isArray(fld.children)) fld.children = [];
            cardsToAdd.forEach(function (c) { fld.children.push(c); });
          } else {
            cardsToAdd.forEach(function (c) { list.push(c); });
          }
        });

        save(list);
        return Promise.all(iconPromises).then(function () {
          render(list);
          return { imported: imported, skipped: skipped };
        });
      }

      var bookmarkImportBtn = document.getElementById('bookmarkImportBtn');
      var bookmarkImportFile = document.getElementById('bookmarkImportFile');
      var bookmarkModal = document.getElementById('bookmarkModal');
      var bookmarkTreeEl = document.getElementById('bookmarkTree');
      var bmSelectAllEl = document.getElementById('bmSelectAll');
      var bmMapFoldersEl = document.getElementById('bmMapFolders');
      var bmDedupUrlEl = document.getElementById('bmDedupUrl');
      var bmSelectedCountEl = document.getElementById('bmSelectedCount');
      var bmConfirmImportBtn = document.getElementById('bmConfirmImport');
      var parsedBookmarkGroups = [];

      function updateBmCount() {
        if (!bookmarkTreeEl || !bmSelectedCountEl) return;
        var checked = bookmarkTreeEl.querySelectorAll('.bm-item-check:checked').length;
        bmSelectedCountEl.textContent = '已选 ' + checked + ' 条';
        if (bmConfirmImportBtn) bmConfirmImportBtn.disabled = checked === 0;
      }

      function renderBookmarkPreview(groups) {
        parsedBookmarkGroups = groups || [];
        if (!bookmarkTreeEl) return;
        bookmarkTreeEl.innerHTML = '';
        if (!parsedBookmarkGroups.length) {
          var em = document.createElement('div');
          em.className = 'hist-empty';
          em.textContent = '未在文件中识别到有效的 http/https 书签链接';
          bookmarkTreeEl.appendChild(em);
          updateBmCount();
          return;
        }
        parsedBookmarkGroups.forEach(function (grp, gi) {
          var wrap = document.createElement('div');
          wrap.className = 'bm-folder';
          var head = document.createElement('label');
          head.className = 'bm-folder-head';
          var gChk = document.createElement('input');
          gChk.type = 'checkbox';
          gChk.checked = true;
          gChk.className = 'bm-folder-check';
          var gTitle = document.createElement('span');
          gTitle.textContent = (grp.isRoot ? '根目录书签' : grp.name) + '（' + grp.items.length + '）';
          head.appendChild(gChk);
          head.appendChild(gTitle);
          wrap.appendChild(head);

          var kids = document.createElement('div');
          kids.className = 'bm-folder-children';
          grp.items.forEach(function (item, ii) {
            var row = document.createElement('label');
            row.className = 'bm-item';
            var iChk = document.createElement('input');
            iChk.type = 'checkbox';
            iChk.checked = true;
            iChk.className = 'bm-item-check';
            iChk.dataset.gi = String(gi);
            iChk.dataset.ii = String(ii);
            row.appendChild(iChk);
            if (item.iconDataUrl) {
              var ic = document.createElement('img');
              ic.className = 'bm-item-icon';
              ic.src = item.iconDataUrl;
              ic.alt = '';
              row.appendChild(ic);
            } else {
              var icPh = document.createElement('span');
              icPh.className = 'bm-item-icon';
              icPh.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/></svg>';
              row.appendChild(icPh);
            }
            var nm = document.createElement('span');
            nm.className = 'bm-item-name';
            nm.textContent = item.name;
            var ul = document.createElement('span');
            ul.className = 'bm-item-url';
            ul.textContent = item.url;
            row.appendChild(nm);
            row.appendChild(ul);
            kids.appendChild(row);
          });
          wrap.appendChild(kids);
          gChk.addEventListener('change', function () {
            var on = this.checked;
            kids.querySelectorAll('.bm-item-check').forEach(function (c) { c.checked = on; });
            updateBmCount();
          });
          kids.addEventListener('change', function () {
            var all = kids.querySelectorAll('.bm-item-check');
            var chk = kids.querySelectorAll('.bm-item-check:checked');
            gChk.checked = chk.length > 0 && chk.length === all.length;
            updateBmCount();
          });
          bookmarkTreeEl.appendChild(wrap);
        });
        if (bmSelectAllEl) bmSelectAllEl.checked = true;
        updateBmCount();
      }

      if (bookmarkImportBtn && bookmarkImportFile) {
        bookmarkImportBtn.addEventListener('click', function () {
          bookmarkImportFile.value = '';
          bookmarkImportFile.click();
        });
        bookmarkImportFile.addEventListener('change', function () {
          var file = bookmarkImportFile.files && bookmarkImportFile.files[0];
          if (!file) return;
          var reader = new FileReader();
          reader.onload = function () {
            var groups = parseBookmarkHtml(reader.result);
            renderBookmarkPreview(groups);
            if (bookmarkModal) openModal(bookmarkModal);
          };
          reader.onerror = function () { alert('书签文件读取失败'); };
          reader.readAsText(file);
        });
      }
      if (bmSelectAllEl && bookmarkTreeEl) {
        bmSelectAllEl.addEventListener('change', function () {
          var on = this.checked;
          bookmarkTreeEl.querySelectorAll('input[type="checkbox"]').forEach(function (c) { c.checked = on; });
          updateBmCount();
        });
      }
      if (bmConfirmImportBtn && bookmarkTreeEl) {
        bmConfirmImportBtn.addEventListener('click', function () {
          var chosenMap = {};
          bookmarkTreeEl.querySelectorAll('.bm-item-check:checked').forEach(function (chk) {
            var gi = parseInt(chk.dataset.gi, 10);
            var ii = parseInt(chk.dataset.ii, 10);
            if (!parsedBookmarkGroups[gi] || !parsedBookmarkGroups[gi].items[ii]) return;
            if (!chosenMap[gi]) {
              chosenMap[gi] = { name: parsedBookmarkGroups[gi].name, isRoot: parsedBookmarkGroups[gi].isRoot, items: [] };
            }
            chosenMap[gi].items.push(parsedBookmarkGroups[gi].items[ii]);
          });
          var selectedGroups = Object.keys(chosenMap).map(function (k) { return chosenMap[k]; });
          applyParsedBookmarks(selectedGroups, {
            mapFolders: !(bmMapFoldersEl && bmMapFoldersEl.checked === false),
            dedupUrl: !(bmDedupUrlEl && bmDedupUrlEl.checked === false)
          }).then(function (res) {
            if (bookmarkModal) closeModal(bookmarkModal);
            alert('书签导入完成：新增 ' + res.imported + ' 条' + (res.skipped ? '，跳过重复 ' + res.skipped + ' 条' : ''));
          });
        });
      }

      // ========== T7b WebDAV 云同步（坚果云 / Nextcloud 等） ==========
      var webdavUrlEl = document.getElementById('webdavUrl');
      var webdavFileEl = document.getElementById('webdavFile');
      var webdavUserEl = document.getElementById('webdavUser');
      var webdavPassEl = document.getElementById('webdavPass');
      var webdavPassToggleEl = document.getElementById('webdavPassToggle');
      var webdavTestBtn = document.getElementById('webdavTestBtn');
      var webdavUploadBtn = document.getElementById('webdavUploadBtn');
      var webdavDownloadBtn = document.getElementById('webdavDownloadBtn');
      var webdavStatusEl = document.getElementById('webdavStatus');
      var webdavPullConfirmEl = document.getElementById('webdavPullConfirm');
      var webdavPullInfoEl = document.getElementById('webdavPullInfo');
      var webdavApplyMergeBtn = document.getElementById('webdavApplyMerge');
      var webdavApplyOverwriteBtn = document.getElementById('webdavApplyOverwrite');
      var webdavPullCancelBtn = document.getElementById('webdavPullCancel');
      var pendingWebdavPayload = null;

      function readWebdavConfig() {
        try {
          var o = JSON.parse(localStorage.getItem(WEBDAV_KEY) || 'null');
          return (o && typeof o === 'object') ? o : {};
        } catch (e) { return {}; }
      }
      function saveWebdavConfig(extra) {
        var cur = Object.assign(readWebdavConfig(), {
          url: (webdavUrlEl ? webdavUrlEl.value : '').trim(),
          filename: ((webdavFileEl ? webdavFileEl.value : '').trim() || 'motuo-tab-sync.json').replace(/^\/+/, ''),
          username: (webdavUserEl ? webdavUserEl.value : '').trim(),
          password: webdavPassEl ? webdavPassEl.value : ''
        }, extra || {});
        try { localStorage.setItem(WEBDAV_KEY, JSON.stringify(cur)); } catch (e) {}
        updateSideSyncText(cur);
        return cur;
      }
      function updateSideSyncText(cfg) {
        var dot = document.getElementById('sysSideSyncDot');
        var txt = document.getElementById('sysSideSyncText');
        if (!txt) return;
        if (cfg && cfg.lastSyncAt) {
          if (dot) dot.classList.remove('muted');
          var d = new Date(cfg.lastSyncAt);
          txt.textContent = 'WebDAV · ' + (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
        } else if (cfg && cfg.url) {
          if (dot) dot.classList.add('muted');
          txt.textContent = 'WebDAV 已配置';
        } else {
          if (dot) dot.classList.add('muted');
          txt.textContent = '仅本地存储';
        }
      }
      function setWebdavStatus(msg, cls) {
        if (!webdavStatusEl) return;
        webdavStatusEl.textContent = msg;
        webdavStatusEl.className = 'sys-webdav-status' + (cls ? ' ' + cls : '');
      }
      function webdavTargetUrl(cfg) {
        var base = String((cfg && cfg.url) || '').trim();
        if (!base) return '';
        if (!/^https?:\/\//i.test(base)) throw new Error('WebDAV 地址须以 http:// 或 https:// 开头');
        var fname = String((cfg && cfg.filename) || 'motuo-tab-sync.json').trim().replace(/^\/+/, '') || 'motuo-tab-sync.json';
        if (base.toLowerCase().slice(-5) === '.json') return base;
        return base.replace(/\/+$/, '') + '/' + fname;
      }
      function webdavAuthHeaders(cfg) {
        var h = {};
        if (cfg && (cfg.username || cfg.password)) {
          var rawCred = (cfg.username || '') + ':' + (cfg.password || '');
          try { h.Authorization = 'Basic ' + btoa(unescape(encodeURIComponent(rawCred))); }
          catch (e) { h.Authorization = 'Basic ' + btoa(rawCred); }
        }
        return h;
      }
      function formatWebdavError(err, status) {
        if (status === 401 || status === 403) return '认证失败（HTTP ' + status + '），请检查用户名或应用密码';
        if (status === 404) return '远端文件不存在（HTTP 404）';
        if (status) return '服务端返回 HTTP ' + status;
        var m = String((err && err.message) || err || '');
        if (/failed to fetch|network|cors/i.test(m)) return '网络请求被拦截或连接失败（若为纯网页版请改用扩展版或开启 WebDAV CORS）';
        return m || '未知错误';
      }
      (function initWebdavUI() {
        var cfg = readWebdavConfig();
        if (webdavUrlEl && cfg.url) webdavUrlEl.value = cfg.url;
        if (webdavFileEl) webdavFileEl.value = cfg.filename || 'motuo-tab-sync.json';
        if (webdavUserEl && cfg.username) webdavUserEl.value = cfg.username;
        if (webdavPassEl && cfg.password) webdavPassEl.value = cfg.password;
        updateSideSyncText(cfg);
        [webdavUrlEl, webdavFileEl, webdavUserEl, webdavPassEl].forEach(function (el) {
          if (el) el.addEventListener('change', function () { saveWebdavConfig(); });
        });
        if (webdavPassToggleEl && webdavPassEl) {
          webdavPassToggleEl.addEventListener('click', function () {
            webdavPassEl.type = webdavPassEl.type === 'password' ? 'text' : 'password';
          });
        }
        if (webdavTestBtn) {
          webdavTestBtn.addEventListener('click', function () {
            var c = saveWebdavConfig();
            var target;
            try { target = webdavTargetUrl(c); } catch (e) { setWebdavStatus(e.message, 'err'); return; }
            if (!target) { setWebdavStatus('请先填写 WebDAV 目录地址', 'err'); return; }
            setWebdavStatus('正在测试连接…', '');
            var headers = Object.assign({ Depth: '0' }, webdavAuthHeaders(c));
            fetch(target, { method: 'PROPFIND', headers: headers, signal: AbortSignal.timeout(15000) })
              .then(function (res) {
                if (res.status === 401 || res.status === 403) throw { status: res.status };
                if (res.status === 405 || res.status === 501) {
                  return fetch(target, { method: 'GET', headers: webdavAuthHeaders(c), signal: AbortSignal.timeout(15000) });
                }
                return res;
              })
              .then(function (res2) {
                if (res2.status === 401 || res2.status === 403) {
                  setWebdavStatus(formatWebdavError(null, res2.status), 'err');
                  return;
                }
                if (res2.ok || res2.status === 207 || res2.status === 404) {
                  setWebdavStatus('连接正常（HTTP ' + res2.status + (res2.status === 404 ? '，尚无远端文件，可直接上传' : '') + '）', 'ok');
                } else {
                  setWebdavStatus(formatWebdavError(null, res2.status), 'err');
                }
              })
              .catch(function (err) {
                setWebdavStatus(formatWebdavError(err, err && err.status), 'err');
              });
          });
        }
        if (webdavUploadBtn) {
          webdavUploadBtn.addEventListener('click', function () {
            var c = saveWebdavConfig();
            var target;
            try { target = webdavTargetUrl(c); } catch (e) { setWebdavStatus(e.message, 'err'); return; }
            if (!target) { setWebdavStatus('请先填写 WebDAV 目录地址', 'err'); return; }
            setWebdavStatus('正在打包并上传…', '');
            buildBackupPayload({ includeWallpaper: false }).then(function (res) {
              res.payload.syncedAt = new Date().toISOString();
              var headers = Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, webdavAuthHeaders(c));
              return fetch(target, {
                method: 'PUT',
                headers: headers,
                body: JSON.stringify(res.payload, null, 2),
                signal: AbortSignal.timeout(20000)
              });
            }).then(function (resp) {
              if (!resp.ok) throw { status: resp.status };
              saveWebdavConfig({ lastSyncAt: Date.now(), lastSyncAction: 'upload' });
              setWebdavStatus('上传成功（已自动排除壁纸与 WebDAV 凭证）', 'ok');
            }).catch(function (err) {
              setWebdavStatus('上传失败：' + formatWebdavError(err, err && err.status), 'err');
            });
          });
        }
        if (webdavDownloadBtn) {
          webdavDownloadBtn.addEventListener('click', function () {
            var c = saveWebdavConfig();
            var target;
            try { target = webdavTargetUrl(c); } catch (e) { setWebdavStatus(e.message, 'err'); return; }
            if (!target) { setWebdavStatus('请先填写 WebDAV 目录地址', 'err'); return; }
            setWebdavStatus('正在从云端拉取…', '');
            if (webdavPullConfirmEl) webdavPullConfirmEl.hidden = true;
            fetch(target, { method: 'GET', headers: webdavAuthHeaders(c), signal: AbortSignal.timeout(20000) })
              .then(function (resp) {
                if (!resp.ok) throw { status: resp.status };
                return resp.json();
              })
              .then(function (remoteData) {
                if (!remoteData || remoteData.app !== 'Motuo-Tab') throw new Error('远端文件不是有效的 Motuo-Tab 备份');
                pendingWebdavPayload = remoteData;
                var cnt = (remoteData.data && Array.isArray(remoteData.data.items)) ? remoteData.data.items.length : 0;
                var ts = remoteData.syncedAt || remoteData.exportedAt || '未知时间';
                if (webdavPullInfoEl) {
                  webdavPullInfoEl.textContent = '云端备份时间：' + ts + ' · 包含 ' + cnt + ' 个主页卡片/分组，请选择应用方式：';
                }
                if (webdavPullConfirmEl) webdavPullConfirmEl.hidden = false;
                setWebdavStatus('已拉取云端数据，请在下方确认合并或覆盖', 'ok');
              })
              .catch(function (err) {
                setWebdavStatus('拉取失败：' + formatWebdavError(err, err && err.status), 'err');
              });
          });
        }
        if (webdavApplyMergeBtn) {
          webdavApplyMergeBtn.addEventListener('click', function () {
            if (!pendingWebdavPayload) return;
            try {
              var out = applyBackupPayload(pendingWebdavPayload, { mode: 'merge' });
              pendingWebdavPayload = null;
              if (webdavPullConfirmEl) webdavPullConfirmEl.hidden = true;
              saveWebdavConfig({ lastSyncAt: Date.now(), lastSyncAction: 'merge' });
              setWebdavStatus('合并完成：新增 ' + out.count + ' 张卡片（保留本地原有配置）', 'ok');
            } catch (e) {
              setWebdavStatus('合并失败：' + e.message, 'err');
            }
          });
        }
        if (webdavApplyOverwriteBtn) {
          webdavApplyOverwriteBtn.addEventListener('click', function () {
            if (!pendingWebdavPayload) return;
            try {
              var out = applyBackupPayload(pendingWebdavPayload, { mode: 'overwrite', reloadAfter: false, applyWallpaper: false });
              pendingWebdavPayload = null;
              if (webdavPullConfirmEl) webdavPullConfirmEl.hidden = true;
              saveWebdavConfig({ lastSyncAt: Date.now(), lastSyncAction: 'overwrite' });
              setWebdavStatus('覆盖完成：已恢复 ' + out.count + ' 个主页卡片/分组与系统配置', 'ok');
            } catch (e) {
              setWebdavStatus('覆盖失败：' + e.message, 'err');
            }
          });
        }
        if (webdavPullCancelBtn) {
          webdavPullCancelBtn.addEventListener('click', function () {
            pendingWebdavPayload = null;
            if (webdavPullConfirmEl) webdavPullConfirmEl.hidden = true;
            setWebdavStatus('已取消拉取应用', '');
          });
        }
      })();

      // ---- 搜索历史管理（通用配置弹窗）：逐条删除 / 多选删除 / 一键清空 ----
      (function initHistoryManager() {
        var listEl = document.getElementById('histList');
        var countEl = document.getElementById('histCount');
        var delSelBtn = document.getElementById('histDeleteSelected');
        var clearBtn = document.getElementById('histClearAll');
        var selectAll = document.getElementById('histSelectAll');
        if (!listEl || !delSelBtn || !clearBtn || !selectAll) return;
        var HISTORY_KEY = 'newtab.searchHistory.v1';

        function readHistory() {
          try {
            var raw = localStorage.getItem(HISTORY_KEY);
            if (!raw) return [];
            var arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
          } catch (e) { return []; }
        }
        function writeHistory(arr) {
          try { localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); } catch (e) {}
        }
        function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

        function render() {
          var hist = readHistory();
          listEl.innerHTML = '';
          countEl.textContent = hist.length ? hist.length + ' 条' : '';
          selectAll.checked = false;
          delSelBtn.disabled = true;
          clearBtn.disabled = hist.length === 0;

          if (!hist.length) {
            var em = document.createElement('div');
            em.className = 'hist-empty';
            em.textContent = '暂无搜索历史';
            listEl.appendChild(em);
            return;
          }
          hist.forEach(function (q) {
            var row = document.createElement('div');
            row.className = 'hist-row';
            row.innerHTML =
              '<input type="checkbox" class="hist-check" data-q="' + esc(q) + '" aria-label="选中该条" />' +
              '<span class="hist-text" title="' + esc(q) + '">' + esc(q) + '</span>' +
              '<button type="button" class="hist-del" data-q="' + esc(q) + '" title="删除该条" aria-label="删除该条">×</button>';
            listEl.appendChild(row);
          });
        }

        function selectedTexts() {
          var out = [];
          listEl.querySelectorAll('.hist-check:checked').forEach(function (c) { out.push(c.getAttribute('data-q')); });
          return out;
        }
        function refreshDeleteBtn() {
          delSelBtn.disabled = selectedTexts().length === 0;
        }
        function removeTexts(texts) {
          if (!texts.length) return;
          var removeSet = {};
          texts.forEach(function (t) { removeSet[t] = true; });
          writeHistory(readHistory().filter(function (s) { return !removeSet[s]; }));
          if (window.__debug && window.__debug.search && window.__debug.search.removeItems) {
            window.__debug.search.removeItems(texts); // 同步搜索下拉（处理内部状态）
          }
          render();
        }

        // 逐条删除 / 多选删除
        listEl.addEventListener('click', function (e) {
          var del = e.target.closest('.hist-del');
          if (del) { removeTexts([del.getAttribute('data-q')]); return; }
          if (e.target.classList && e.target.classList.contains('hist-check')) refreshDeleteBtn();
        });

        // 全选 / 清空 / 删除所选
        selectAll.addEventListener('change', function () {
          var on = this.checked;
          listEl.querySelectorAll('.hist-check').forEach(function (c) { c.checked = on; });
          refreshDeleteBtn();
        });
        delSelBtn.addEventListener('click', function () { removeTexts(selectedTexts()); });
        clearBtn.addEventListener('click', function () {
          writeHistory([]);
          if (window.__debug && window.__debug.search && window.__debug.search.clearAll) window.__debug.search.clearAll();
          render();
        });

        render();
      })();

      // 设置壁纸
      wallpaperBtn.addEventListener('click', function () {
        wallpaperFile.value = '';
        wallpaperFile.click();
      });

      wallpaperFile.addEventListener('change', function () {
        var file = wallpaperFile.files && wallpaperFile.files[0];
        if (!file) return;
        var isVideo = /^video\//i.test(file.type || '');
        var limit = isVideo ? 200 * 1024 * 1024 : 15 * 1024 * 1024;
        if (file.size > limit) {
          alert((isVideo ? '视频' : '图片') + '太大，请选择 ' + (isVideo ? '200MB' : '15MB') + ' 以内的文件');
          return;
        }
        var blur = getBlur();
        setSolidColor('');
        applyBackground(file, null, blur);
        saveWallpaperToDB(file).catch(function (err) {
          console.error('壁纸保存失败', err);
          alert('壁纸保存失败（可能超出浏览器存储配额）：' + (err && err.message ? err.message : ''));
        });
      });

      // 重置壁纸
      resetWallpaperBtn.addEventListener('click', function () {
        removeWallpaperFromDB().catch(function () {});
        refreshBackground();
      });

      // ========== 模糊度滑块 ==========
      var blurSlider = document.getElementById('blurSlider');
      var blurVal = document.getElementById('blurVal');

      (function initBlur() {
        var saved = getBlur();
        blurSlider.value = saved;
        blurVal.textContent = saved + 'px';
        document.documentElement.style.setProperty('--blur-slider-pct', (saved / 20 * 100) + '%');
      })();

      blurSlider.addEventListener('input', function () {
        var v = parseFloat(this.value);
        setBlur(v);
        blurVal.textContent = v + 'px';
        document.documentElement.style.setProperty('--blur-slider-pct', (v / 20 * 100) + '%');
        var c = getSolidColor();
        if (!c && currentWallpaperUrl) {
          bgContainer.style.filter = 'blur(' + v + 'px)';
        }
      });

      // ========== 纯色壁纸 ==========
      var solidColorPicker = document.getElementById('solidColorPicker');
      var resetSolidColorBtn = document.getElementById('resetSolidColorBtn');

      // 加载已保存的纯色
      (function initSolidColor() {
        var saved = getSolidColor();
        if (saved) solidColorPicker.value = saved;
      })();

      solidColorPicker.addEventListener('input', function () {
        var c = this.value;
        setSolidColor(c);
        // 设置纯色时清除图片壁纸
        removeWallpaperFromDB().catch(function () {});
        applyBackground(null, c);
      });

      resetSolidColorBtn.addEventListener('click', function () {
        setSolidColor('');
        refreshBackground();
      });

      // ========== 恢复默认 ==========
      document.getElementById('resetPersonalizeBtn').addEventListener('click', function () {
        // 重置图片壁纸
        removeWallpaperFromDB().catch(function () {});
        // 重置纯色壁纸
        setSolidColor('');
        // 重置模糊
        setBlur(3);
        blurSlider.value = 3;
        blurVal.textContent = '3px';
        document.documentElement.style.setProperty('--blur-slider-pct', '15%');
        // 重置透明度
        alphaSlider.value = 1;
        toggleImgAlpha.checked = true;
        toggleLtrAlpha.checked = true;
        syncAlpha();
        // 刷新背景
        refreshBackground();
      });

      // ========== 透明度滑块 + 开关 ==========
      var alphaSlider = document.getElementById('alphaSlider');
      var alphaVal = document.getElementById('alphaVal');
      var toggleImgAlpha = document.getElementById('toggleImgAlpha');
      var toggleLtrAlpha = document.getElementById('toggleLtrAlpha');
      // （ALPHA_KEY / TOGGLE_IMG_KEY / TOGGLE_LTR_KEY 已在顶部 CONFIG 声明）

      function syncAlpha() {
        var raw = parseFloat(alphaSlider.value);
        var imgOn = toggleImgAlpha.checked;
        var ltrOn = toggleLtrAlpha.checked;
        var pct = ((raw - 0.3) / (1 - 0.3)) * 100;
        document.documentElement.style.setProperty('--ui-alpha', raw);
        document.documentElement.style.setProperty('--ui-slider-pct', pct + '%');
        document.documentElement.style.setProperty('--ui-img-alpha', imgOn ? raw : 1);
        document.documentElement.style.setProperty('--ui-ltr-alpha', ltrOn ? raw : 1);
        alphaVal.textContent = Math.round(raw * 100) + '%';
        try { localStorage.setItem(ALPHA_KEY, raw); } catch (e) {}
        try { localStorage.setItem(TOGGLE_IMG_KEY, imgOn ? '1' : '0'); } catch (e) {}
        try { localStorage.setItem(TOGGLE_LTR_KEY, ltrOn ? '1' : '0'); } catch (e) {}
      }

      // 加载已保存的状态
      (function initAlpha() {
        try {
          var saved = localStorage.getItem(ALPHA_KEY);
          if (saved !== null) {
            var num = parseFloat(saved);
            if (num >= 0.3 && num <= 1) alphaSlider.value = num;
          }
        } catch (e) {}
        try {
          var imgSaved = localStorage.getItem(TOGGLE_IMG_KEY);
          if (imgSaved !== null) toggleImgAlpha.checked = imgSaved === '1';
        } catch (e) {}
        try {
          var ltrSaved = localStorage.getItem(TOGGLE_LTR_KEY);
          if (ltrSaved !== null) toggleLtrAlpha.checked = ltrSaved === '1';
        } catch (e) {}
        syncAlpha();
      })();

      alphaSlider.addEventListener('input', syncAlpha);
      toggleImgAlpha.addEventListener('change', syncAlpha);
      toggleLtrAlpha.addEventListener('change', syncAlpha);

      // 卡片桥：ai.js 是后加载的独立脚本，读写真卡片列表走这里
      window.__motuo = window.__motuo || {};
      window.__motuo.cards = {
        get list() { return list; },
        set list(v) { list = v; },
        save: save,
        render: render,
        nav: nav,
        applyAutoIcon: applyAutoIcon,
        normalizeUrl: normalizeUrl,
        keys: {
          config: AI_CONFIG_KEY,
          history: AI_HISTORY_KEY,
          snapshot: AI_SNAPSHOT_KEY
        }
      };
      window.__motuo.bookmarks = {
        parse: parseBookmarkHtml,
        apply: applyParsedBookmarks
      };
      window.__motuo.greeting = {
        render: renderBrandHero,
        renderHero: renderBrandHero,
        textForHour: greetingForHour,
        isEnabled: isGreetingEnabled,
        isLogoEnabled: isHeroLogoEnabled,
        getLogoStyle: getLogoStyle,
        setLogoStyle: setLogoStyle,
        getLogoAlpha: getHeroLogoAlpha,
        setLogoAlpha: setHeroLogoAlpha
      };
      window.__motuo.iconCache = {
        getSync: getCachedIconSync,
        put: putIconToDB,
        sync: syncIcons,
        cleanSvgMarkup: cleanSvgMarkup,
        cleanSvgDataUrl: cleanSvgDataUrl,
        cleanIconImageData: cleanIconImageData,
        cleanIconDataUrl: cleanIconDataUrl,
        get ready() { return iconCacheReadyPromise; },
        getAllSync: function () { return Object.assign({}, iconCacheMem); }
      };

      // ========== 速记本 ==========
      var noteFab     = document.getElementById('noteFab');
      var notePanel   = document.getElementById('notePanel');
      var noteClose   = document.getElementById('noteClose');
      var noteInput   = document.getElementById('noteInput');
      var noteSaved   = document.getElementById('noteSaved');
      var noteCount   = document.getElementById('noteCount');
      var noteClear   = document.getElementById('noteClear');

      function loadNote() {
        try {
          var v = localStorage.getItem(SCRATCHPAD_KEY);
          return v == null ? '' : v;
        } catch (e) { return ''; }
      }
      function saveNote(v) {
        try { localStorage.setItem(SCRATCHPAD_KEY, v); return true; }
        catch (e) { return false; }
      }
      function updateNoteCount() {
        var n = noteInput.value.length;
        noteCount.textContent = n + ' 字';
      }
      function setNoteStatus(state, text) {
        noteSaved.classList.remove('saving', 'saved');
        if (state) noteSaved.classList.add(state);
        noteSaved.textContent = text;
      }
      function openNote() {
        notePanel.classList.add('open');
        notePanel.setAttribute('aria-hidden', 'false');
        setTimeout(function () { noteInput.focus(); }, 50);
      }
      function closeNote() {
        notePanel.classList.remove('open');
        notePanel.setAttribute('aria-hidden', 'true');
        // 立即把光标从 textarea 移走，避免误输入
        if (document.activeElement === noteInput) noteInput.blur();
      }
      function toggleNote() {
        if (notePanel.classList.contains('open')) closeNote();
        else openNote();
      }

      // 初始化：恢复内容、刷新计数
      if (noteInput) {
        noteInput.value = loadNote();
        updateNoteCount();
        setNoteStatus(null, noteInput.value ? '已加载' : '空闲');

        // 自动保存：输入后 500ms 保存
        var saveTimer = null;
        noteInput.addEventListener('input', function () {
          updateNoteCount();
          setNoteStatus('saving', '保存中…');
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(function () {
            var ok = saveNote(noteInput.value);
            if (ok) setNoteStatus('saved', '已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5));
            else setNoteStatus(null, '保存失败（存储满？）');
          }, 500);
        });
      }

      if (noteFab)    noteFab.addEventListener('click', toggleNote);
      if (noteClose)  noteClose.addEventListener('click', closeNote);

      // 清空（带确认）
      if (noteClear) {
        noteClear.addEventListener('click', function () {
          if (!noteInput.value) return;
          if (!confirm('确定清空速记吗？此操作不可撤销。')) return;
          noteInput.value = '';
          saveNote('');
          updateNoteCount();
          setNoteStatus(null, '已清空');
          noteInput.focus();
        });
      }

      // Esc 关闭速记面板（追加到全局 Escape 处理中）
      // 已有 keydown 监听器里只关 modal-mask；这里用捕获阶段补一个
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && notePanel.classList.contains('open')) {
          closeNote();
        }
      }, true);

      // 调试钩子
      window.__debug = Object.assign(window.__debug || {}, { fabBtn: fabBtn, menu: menu, toggle: toggleMenu, note: { open: openNote, close: closeNote } });
    })();
