/* ========================================================================
     * IIFE 2: 主模块
     *   - 快捷方式 CRUD、编辑模式（拖拽/删除）、导入导出
     *   - 壁纸（IndexedDB）+ 模糊 + 纯色 + 透明度
     *   - AI 助手（流式对话 + JSON 指令解析）
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
      // IndexedDB（壁纸 blob 存这里）
      var DB_NAME            = 'MotuoTabDB';
      var DB_VERSION         = 1;
      var STORE_NAME         = 'wallpapers';
      // favicon 自动抓取候选（按顺序尝试，第一个成功即用）
      var RANDOM_COLORS      = ['blue', 'pink', 'orange', 'purple', 'sky', 'green', 'amber'];

      // 默认快捷方式（首次访问时使用，用户编辑/删除后会被持久化）
      var DEFAULTS = [
        { name: '知乎',       url: 'https://www.zhihu.com',                           iconSrc: 'image', icon: 'https://www.zhihu.com/favicon.ico' },
        { name: 'Motuo-nas',  url: 'https://fnnas.com',                                           iconSrc: 'image', icon: 'https://fnnas.com/favicon.ico' },
        { name: '1Panel',     url: 'http://45.207.196.124:39189',                      iconSrc: 'image', icon: 'https://apps-assets.fit2cloud.com/stable/1panel/logo.png' },
        { name: 'cloudflare', url: 'https://dash.cloudflare.com',                      iconSrc: 'image', icon: 'https://dash.cloudflare.com/favicon.ico' },
        { name: '腾讯云',     url: 'https://cloud.tencent.com',                        iconSrc: 'image', icon: 'https://cloud.tencent.com/favicon.ico' },
        { name: '哔哩哔哩',   url: 'https://www.bilibili.com',                        iconSrc: 'image', icon: 'https://www.bilibili.com/favicon.ico' },
        { name: 'MiniMax',    url: 'https://minimaxi.com',                            iconSrc: 'image', icon: 'https://minimaxi.com/favicon.ico' },
        { name: 'DeepSeek',   url: 'https://platform.deepseek.com',                    iconSrc: 'image', icon: 'https://www.deepseek.com/favicon.ico' },
        { name: 'GitHub',     url: 'https://github.com',                              iconSrc: 'image', icon: 'https://github.com/favicon.ico' },
        { name: 'TX星融网',   url: 'https://pod.xr24.cn',                             iconSrc: 'image', icon: 'https://pod.xr24.cn/upload/image_ce9a8fe48b1bbed7f785e92ba1965a79-removebg-preview.png' },
        { name: 'TX弹簧派',   url: 'https://tx.xr24.cn/',                              iconSrc: 'image', icon: 'https://tx.xr24.cn/img/asd.jpg' },
        { name: 'TX工具网',   url: 'https://www.xr24.cn',                             iconSrc: 'color', color: 'white', letter: '🛠️' },
        { name: 'TX同学录',   url: 'https://class.xr24.cn',                            iconSrc: 'color', color: 'white', letter: '🎓' }
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
          tile.style.background = '#f5f7fb';
          tile.style.color = '#1f2329';
        }
      }

      // 填充 tile 内容（图片/文字 + 颜色），公共逻辑给 build/update 共用
      function fillTile(tile, item) {
        while (tile.firstChild) tile.removeChild(tile.firstChild);
        tile.removeAttribute('style');
        tile.className = 'tile';

        if (item.iconSrc === 'image' && item.icon) {
          tile.style.background = 'rgba(255, 255, 255, var(--ui-img-alpha, 1))';
          var img = document.createElement('img');
          img.src = item.icon;
          img.alt = item.name || '';
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = 'contain';
          img.style.padding = '10px';
          img.style.boxSizing = 'border-box';
          img.style.borderRadius = '16px';
          tile.appendChild(img);
        } else {
          var ch = (item.letter || (item.name || '').trim().charAt(0).toUpperCase()) || '?';
          if (item.color) {
            applyTileColor(tile, item.color);
          } else {
            tile.style.background = '#f5f7fb';
            tile.style.color = '#1f2329';
          }
          tile.textContent = ch;
        }
      }

      // 创建一张未挂载的快捷方式 DOM 节点
      function buildCard(item) {
        var a = document.createElement('a');
        a.className = 'shortcut';
        a.href = item.url || '#';
        a.dataset.iconSrc = item.iconSrc || 'color';

        var tile = document.createElement('div');
        fillTile(tile, item);

        var label = document.createElement('div');
        label.className = 'label';
        label.textContent = item.name;

        a.appendChild(tile);
        a.appendChild(label);
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

      // 就地更新某张卡片的内容（编辑后用，不重绘避免闪烁）
      function updateCardContent(card, item) {
        card.href = item.url || '#';
        card.dataset.iconSrc = item.iconSrc || 'color';
        var tile = card.querySelector('.tile');
        var label = card.querySelector('.label');
        fillTile(tile, item);
        label.textContent = item.name;
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

      // FLIP：让重排时其他卡片平滑滑动到新位置
      // （被拖的卡片自身不参与，避免 .dragging 的 transform 干扰位置测量）
      function animateReorder(change) {
        var cards = Array.from(nav.querySelectorAll('.shortcut'));
        var firstRects = new Map();
        cards.forEach(function (c) { firstRects.set(c, c.getBoundingClientRect()); });

        change(); // 改 DOM

        cards.forEach(function (c) {
          if (c === dragSrc) return;
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
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            cards.forEach(function (c) {
              if (c === dragSrc) return;
              c.style.transition = '';
              c.style.transform = '';
            });
          });
        });
      }

      var list = load();
      render(list);

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
          var radio = addForm.querySelector('input[name="iconSrc"][value="image"]');
          if (!radio.checked) {
            radio.checked = true;
            // 显隐字段（image / color / letter）跟着切
            radio.dispatchEvent(new Event('change'));
          }
          addImage.value = String(reader.result || '');
          updatePreview();
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
          previewTile.style.background = 'rgba(255, 255, 255, var(--ui-img-alpha, 1))';
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

      // 异步抓取并替换：抓到就把 list 对应项改成 image+iconUrl 并持久化；失败用 fallback 颜色
      function applyAutoIcon(cardEl, itemIndex, fallbackColor) {
         var item = list[itemIndex];
         if (!item) return;
         fetchFavicon(item.url).then(function (iconUrl) {
           if (iconUrl) {
             // 把这条数据改成"图片链接"模式并持久化
             item.iconSrc = 'image';
             item.icon = iconUrl;
             save(list);
           } else {
             // 抓不到，保持 color 模式 + 随机色
             item.iconSrc = 'color';
             item.color = fallbackColor;
             save(list);
           }
           // 就地更新卡片，不重绘避免已有卡片闪烁
           updateCardContent(cardEl, item);
         });
       }

      // 打开添加弹窗
      var editingIndex = -1; // ≥0 表示编辑模式
      function openAddModal() {
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

      slot.addEventListener('click', openAddModal);
      slot.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openAddModal();
        }
      });

      // 提交添加
      addForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = addName.value.trim();
        var url = normalizeUrl(addUrl.value.trim());
        if (!name || !url) return;
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

        if (editingIndex >= 0) {
          // 编辑模式：就地更新，不重绘避免闪烁
          list[editingIndex] = item;
          var existing = nav.querySelectorAll('.shortcut')[editingIndex];
          if (existing) updateCardContent(existing, item);
          editingIndex = -1;
        } else {
          // 添加模式：追加单卡（带入场动画），不重绘已有卡片
          list.push(item);
          var newCard = appendCard(item);
          if (mode === 'auto') {
            applyAutoIcon(newCard, list.length - 1, item.color);
          }
        }
        save(list);

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

      function setEditing(on) {
        document.body.classList.toggle('editing', !!on);
        editBanner.classList.toggle('open', !!on);
        // 进入编辑模式时关闭菜单
        if (on) toggleMenu(false);
      }

      fabBtn.addEventListener('click', function (e) {
        e.stopPropagation();
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
          editBtn.textContent = editing ? '退出编辑' : '编辑页面';
          setEditing(editing);
          return;
        }
        // Ctrl+A / Cmd+A → 快速打开 AI 面板并聚焦输入框
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
          // 如果焦点在输入框内，让浏览器的全选行为正常执行
          var activeTag = document.activeElement ? document.activeElement.tagName : '';
          if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
          e.preventDefault();
          toggleAI(true);
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
        editBtn.textContent = editing ? '退出编辑' : '编辑页面';
        setEditing(editing);
      });
      exitEditBtn.addEventListener('click', function () {
        editing = false;
        editBtn.textContent = '编辑页面';
        setEditing(false);
      });

      // ========== 编辑模式：HTML5 拖拽排序 + 拖到底部删除 ==========
      var dragSrc = null; // 当前拖拽的卡片元素

      // 给所有 shortcut 绑定拖拽相关事件（委托在 nav 上）
      nav.addEventListener('dragstart', function (e) {
        if (!editing) return;
        var card = e.target.closest('.shortcut');
        if (!card) return;
        dragSrc = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        // 必须 setData 才能在 Firefox 里触发拖拽
        try { e.dataTransfer.setData('text/plain', ''); } catch (err) {}
      });

      nav.addEventListener('dragend', function () {
        nav.querySelectorAll('.shortcut').forEach(function (el) {
          el.classList.remove('dragging');
          el.classList.remove('drop-target');
        });
        dragSrc = null;
      });

      nav.addEventListener('dragover', function (e) {
        if (!editing || !dragSrc) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        var card = e.target.closest('.shortcut');
        if (card && card !== dragSrc) {
          nav.querySelectorAll('.shortcut.drop-target').forEach(function (el) { el.classList.remove('drop-target'); });
          card.classList.add('drop-target');
        }
      });

      nav.addEventListener('dragleave', function (e) {
        var card = e.target.closest('.shortcut');
        if (card) card.classList.remove('drop-target');
      });

      nav.addEventListener('drop', function (e) {
        if (!editing || !dragSrc) return;
        e.preventDefault();
        var target = e.target.closest('.shortcut');

        // 用 FLIP 包住整个 DOM 变更，让其他卡片平滑滑动
        animateReorder(function () {
          // 关键修复：根据鼠标在目标卡片上的左右位置决定插入到前面还是后面
          if (target && target !== dragSrc) {
            var rect = target.getBoundingClientRect();
            var dropAfter = (e.clientX - rect.left) > rect.width / 2;
            // 修复 no-op：如果原插入方向不会改变 DOM 顺序（dragSrc 已经在那个位置），
            // 自动翻向，让"落到任何卡上"都能产生动作（实际就是和邻居 swap）
            if (dropAfter && target.nextElementSibling === dragSrc) {
              dropAfter = false;
            } else if (!dropAfter && target.previousElementSibling === dragSrc) {
              dropAfter = true;
            }
            if (dropAfter) {
              // 插到 target 后面
              var next = target.nextElementSibling;
              if (next && next.classList.contains('shortcut')) {
                nav.insertBefore(dragSrc, next);
              } else {
                // target 是最后一张卡片
                nav.insertBefore(dragSrc, slot);
              }
            } else {
              // 插到 target 前面
              nav.insertBefore(dragSrc, target);
            }
          } else if (!target) {
            // 拖到 nav 空白处：插到末尾（slot 前面）
            nav.insertBefore(dragSrc, slot);
          }
        });

        // 同步到 list（DOM 顺序已经反映新顺序）
        var cards = Array.prototype.slice.call(nav.querySelectorAll('.shortcut'));
        var newOrder = cards.map(function (el) {
          var lbl = el.querySelector('.label');
          var name = lbl ? lbl.textContent : '';
          return list.find(function (it) { return it.name === name; });
        }).filter(Boolean);
        list = newOrder;
        save(list);

        nav.querySelectorAll('.shortcut.drop-target').forEach(function (el) {
          el.classList.remove('drop-target');
        });
      });

      // 删除区：拖入即删除
      dropzone.addEventListener('dragover', function (e) {
        if (!editing || !dragSrc) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        dropzone.classList.add('active');
      });

      dropzone.addEventListener('dragleave', function () {
        dropzone.classList.remove('active');
      });

      dropzone.addEventListener('drop', function (e) {
        if (!editing || !dragSrc) return;
        e.preventDefault();
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

      // 卡片右键菜单
      var ctxMenu = document.getElementById('ctxMenu');
      var ctxCard = null; // 当前右键的卡片对应的 list 索引

      // 在 nav 上委托 contextmenu 事件
      nav.addEventListener('contextmenu', function (e) {
        var card = e.target.closest('.shortcut');
        if (!card) return;
        e.preventDefault();
        // 找对应 list 索引
        var cards = nav.querySelectorAll('.shortcut');
        var idx = Array.prototype.indexOf.call(cards, card);
        if (idx < 0 || idx >= list.length) return;
        ctxCard = idx;
        // 定位菜单
        ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
        ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - 180) + 'px';
        ctxMenu.classList.add('open');
      });

      // 菜单项点击处理
      ctxMenu.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn || ctxCard === null) return;
        var action = btn.dataset.action;
        var item = list[ctxCard];
        if (!item) return;
        ctxMenu.classList.remove('open');

        switch (action) {
          case 'newtab':
            window.open(item.url, '_blank');
            break;
          case 'edit':
            // 打开编辑弹窗并预填数据
            openAddModal();
            editingIndex = ctxCard;
            document.querySelector('#addTitle span').textContent = '编辑快捷方式';
            addName.value = item.name;
            addUrl.value = item.url;
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
            ctxCard = null;
            break;
          case 'delete':
            var toRemove = nav.querySelectorAll('.shortcut')[ctxCard];
            list.splice(ctxCard, 1);
            save(list);
            if (toRemove) removeCardWithAnim(toRemove);
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

      // 点击其他位置关闭右键菜单
      document.addEventListener('click', function (e) {
        if (!ctxMenu.contains(e.target)) {
          ctxMenu.classList.remove('open');
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

      // 导出：打包快捷方式 + 壁纸图片 + AI 配置/历史 + 个性化配置
      exportBtn.addEventListener('click', function () {
        // 先读取壁纸（可能为 null），再组包下载
        loadWallpaperFromDB().then(blobToDataURL).then(function (wallpaperDataUrl) {
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
                solidColor: readLS('newtab.solidColor.v1'),
                blur: readLS('newtab.blur.v1'),
                alpha: readLS('newtab.alpha.v1'),
                toggleImg: readLS('newtab.toggleImg.v1'),
                toggleLtr: readLS('newtab.toggleLtr.v1'),
                scratchpad: readLS('newtab.scratchpad.v1')
              },
              ai: {
                config: readLS('newtab.ai.config.v1'),
                history: readLS('newtab.ai.history.v1')
              },
              wallpaper: wallpaperDataUrl
            }
          };
          var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'motuo-tab-backup-' + Date.now() + '.json';
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
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
            // 识别新版备份（v2：含 settings / ai / wallpaper）与旧版（仅快捷方式）
            var isFull = !!(data && data.data && data.version === 2);
            var d = isFull ? data.data : null;

            // ---- 快捷方式 ----
            var items;
            if (isFull) {
              items = Array.isArray(d.items) ? d.items : [];
            } else {
              items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : null);
            }
            items = (items || [])
              .filter(function (it) { return it && typeof it.name === 'string' && it.name.trim(); })
              .map(function (it) {
                var clean = { name: String(it.name).slice(0, 40), url: String(it.url || '#') };
                // 保留图标相关字段，避免导入后丢失自定义图标
                if (it.iconSrc === 'image' && it.icon) { clean.iconSrc = 'image'; clean.icon = String(it.icon); }
                else if (it.color) {
                  // 颜色卡片：兼容旧格式（无 iconSrc，仅有 color/letter）
                  var src = it.iconSrc || 'color';
                  if (src !== 'image') {
                    clean.iconSrc = src; clean.color = String(it.color);
                    if (it.letter) clean.letter = String(it.letter);
                  }
                }
                return clean;
              });
            if (!isFull && !items.length) throw new Error('没有有效的快捷方式');

            // ---- 个性化 / 搜索配置 ----
            if (isFull && d.settings) {
              var s = d.settings;
              writeLS('newtab.engine.v1', s.engine);
              writeLS('newtab.customEngines.v1', s.customEngines);
              writeLS('newtab.searchHistory.v1', s.searchHistory);
              writeLS('newtab.sitedirect.v1', s.sitedirect);
              writeLS('newtab.solidColor.v1', s.solidColor);
              writeLS('newtab.blur.v1', s.blur);
              writeLS('newtab.alpha.v1', s.alpha);
              writeLS('newtab.toggleImg.v1', s.toggleImg);
              writeLS('newtab.toggleLtr.v1', s.toggleLtr);
              writeLS('newtab.scratchpad.v1', s.scratchpad);
            }

            // ---- AI 配置 / 历史 ----
            if (isFull && d.ai) {
              writeLS('newtab.ai.config.v1', d.ai.config);
              writeLS('newtab.ai.history.v1', d.ai.history);
            }

            // 立即应用快捷方式（其余配置刷新页面后生效）
            list = items;
            save(list);
            render(list);

            var summary = '导入成功：恢复 ' + items.length + ' 条快捷方式' +
              (isFull ? '，以及壁纸与全部配置' : '');
            alert(summary);

            if (isFull) {
              // 恢复壁纸并刷新背景，随后刷新页面让引擎/AI 等启动期配置生效
              dataURLToBlob(d.wallpaper).then(function (blob) {
                return blob ? saveWallpaperToDB(blob) : removeWallpaperFromDB();
              }).catch(function () {}).then(function () {
                refreshBackground();
                setTimeout(function () { location.reload(); }, 300);
              });
            }
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
          if (wallpaperDb) { resolve(wallpaperDb); return; }
          var req = indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = function (e) {
            var d = e.target.result;
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

      function applyBackground(blob, solidColor, blurPx) {
        if (currentWallpaperUrl) {
          URL.revokeObjectURL(currentWallpaperUrl);
          currentWallpaperUrl = null;
        }
        bgContainer.style.backgroundImage = 'none';
        bgContainer.style.filter = 'none';
        document.body.style.background = '';

        if (solidColor) {
          document.body.style.background = solidColor;
        } else if (blob) {
          currentWallpaperUrl = URL.createObjectURL(blob);
          bgContainer.style.backgroundImage = 'url(' + currentWallpaperUrl + ')';
          bgContainer.style.filter = 'blur(' + (blurPx || 0) + 'px)';
          document.body.style.background =
            'linear-gradient(rgba(255,255,255,0.78), rgba(255,255,255,0.78))';
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

      // 个性化按钮：打开弹窗
      personalizeBtn.addEventListener('click', function () {
        toggleMenu(false);
        openModal(document.getElementById('personalizeModal'));
      });

      document.getElementById('aboutBtn').addEventListener('click', function () {
        toggleMenu(false);
        openModal(document.getElementById('aboutModal'));
      });

      document.getElementById('shortcutBtn').addEventListener('click', function () {
        toggleMenu(false);
        openModal(document.getElementById('shortcutModal'));
      });

      document.getElementById('generalConfigBtn').addEventListener('click', function () {
        toggleMenu(false);
        openModal(document.getElementById('generalConfigModal'));
      });

      // 站内搜索直达开关
      var siteDirectToggle = document.getElementById('toggleSiteDirect');
      if (siteDirectToggle) {
        try {
          siteDirectToggle.checked = localStorage.getItem('newtab.sitedirect.v1') !== '0';
        } catch (e) {}
        siteDirectToggle.addEventListener('change', function () {
          localStorage.setItem('newtab.sitedirect.v1', this.checked ? '1' : '0');
        });
      }

      // 设置壁纸
      wallpaperBtn.addEventListener('click', function () {
        wallpaperFile.value = '';
        wallpaperFile.click();
      });

      wallpaperFile.addEventListener('change', function () {
        var file = wallpaperFile.files && wallpaperFile.files[0];
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) {
          alert('图片太大，请选择 8MB 以内的图片');
          return;
        }
        var blur = getBlur();
        setSolidColor('');
        applyBackground(file, null, blur);
        saveWallpaperToDB(file).catch(function (err) {
          console.error('壁纸保存失败', err);
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

      // ========== AI 助手 ==========
      // （AI_CONFIG_KEY / AI_HISTORY_KEY 已在顶部 CONFIG 声明）
      var aiFab = document.getElementById('aiFab');
      var aiPanel = document.getElementById('aiPanel');
      var aiOverlay = document.getElementById('aiOverlay');
      var aiClose = document.getElementById('aiClose');
      var aiMessages = document.getElementById('aiMessages');
      var aiInput = document.getElementById('aiInput');
      var aiSend = document.getElementById('aiSend');

      var aiEndpoint = document.getElementById('aiEndpoint');
      var aiKey = document.getElementById('aiKey');
      var aiModel = document.getElementById('aiModel');
      var aiWebSearch = document.getElementById('aiWebSearch');
      var aiBochaKey = document.getElementById('aiBochaKey');
      var aiDeepSearch = document.getElementById('aiDeepSearch');

      // 对话历史
      var aiHistory = [];
      var aiSending = false; // 是否正在请求中

      function buildSystemPrompt() {
        // 简明卡片清单：只列 name + url，节省 token，避免模型注意力稀释
        var lines = ['当前卡片（共 ' + list.length + ' 个）：'];
        for (var i = 0; i < list.length; i++) {
          var it = list[i];
          lines.push('- ' + it.name + ' (' + it.url + ')');
        }
        var cardsList = lines.join('\n');

        return '你是 Motuo-Tab 的快捷方式管理助手。\n\n' +
          '## 工具说明\n' +
          '- 名称：Motuo-Tab（浏览器标签页）\n' +
          '- 开发者：Motuo24，博客 https://pod.xr24.cn\n' +
          '- 站内搜索直达：搜索框输入 "bl 关键词"（B站）、"zh 关键词"（知乎）、"gh 关键词"（GitHub）、"tb 关键词"（淘宝）、"db 关键词"（豆瓣）\n' +
          '- 自定义搜索引擎：搜索框左侧图标下拉，底部可添加\n' +
          '- 搜索建议：搜索框输入时弹历史建议\n' +
          '- 键盘快捷键：Ctrl+E 专注模式、Ctrl+K 编辑模式、Ctrl+A 打开 AI\n' +
          '- 联网搜索：开启后你拥有 web_search 工具，可搜索互联网获取最新信息（天气、新闻、股价等）。由你判断是否需要搜索，搜索后基于结果回答并附引用来源。\n\n' +
          '## 当前卡片\n' + cardsList + '\n\n' +
          '## 核心规则（违反就是 bug，必须遵守）\n' +
          '1. **绝不删减**：用户没说"删"或"移除"的卡片，必须原样保留\n' +
          '2. **精准修改**：只改用户明确指名的卡片；没说改的别动\n' +
          '3. **不确定就问**：指令模糊时（比如"整理一下"、"优化一下"），先用一句话确认意图，不要自己脑补操作\n' +
          '4. **回答简练**：先一行操作摘要，再 <ops> 输出；不要解释思路、不要重复用户的话、不要客套\n' +
          '5. **问询用文字**：被问"卡片有哪些"、"某个网站在不在"等查询类问题时，只用文字回答，**不要输出 <ops>**\n\n' +
          '## 输出格式（修改类指令）\n' +
          '一行操作摘要\n' +
          '<ops>\n' +
          '{\n' +
          '  "add": [ /* 新增的卡片 */ ],\n' +
          '  "remove": [ /* 要删的卡片名 */ ],\n' +
          '  "update": [ /* 修改现有卡片 */ ],\n' +
          '  "reorder": [ /* 完整的新顺序（只列名字） */ ]\n' +
          '}\n' +
          '</ops>\n\n' +
          '字段说明：\n' +
          '- add: 数组，每项是完整卡片对象 {name, url, iconSrc, color?, letter?, icon?}\n' +
          '  - iconSrc 默认 "auto"（自动抓取网站图标，抓不到才用颜色）\n' +
          '    - auto 模式必须同时提供 color 字段作为占位色：blue/pink/orange/purple/sky/green/amber/white\n' +
          '  - 想强制用颜色：iconSrc: "color", color: "blue"（或其他颜色）\n' +
          '  - 想用图片图标：iconSrc: "image", icon: 图片URL\n' +
          '- remove: 数组，每项是要删的卡片 name（必须跟当前列表里的完全一致）\n' +
          '- update: 数组，每项 {name: "GitHub", color: "green"}，只列要改的字段\n' +
          '- reorder: 数组，完整的新顺序，只列卡片名；不写就保持原顺序\n' +
          '- 没列出的字段（add/remove/update/reorder）就完全不动\n' +
          '- **关键**：你不需要"重写整张列表"，只描述"做了什么改动"——客户端会把改动 apply 到当前状态\n' +
          '  - 这意味着：没提到的卡片自动保留，绝对不可能被误删\n' +
          '  - 想重命名 = update + remove/add；想移动 = reorder；想加新 = add\n\n' +
          '## 例子\n' +
          '用户：把知乎移到最前面\n' +
          '你：已将知乎移到最前面\n' +
          '<ops>\n{"reorder": ["知乎", "GitHub", "百度", "Gmail"]}\n</ops>\n\n' +
          '用户：加个 Google\n' +
          '你：已添加 Google\n' +
          '<ops>\n{"add": [{"name": "Google", "url": "https://www.google.com", "iconSrc": "auto", "color": "blue"}]}\n</ops>\n\n' +
          '用户：把 GitHub 改成绿色\n' +
          '你：已将 GitHub 图标改为绿色\n' +
          '<ops>\n{"update": [{"name": "GitHub", "color": "green"}]}\n</ops>\n\n' +
          '用户：删了知乎\n' +
          '你：已删除知乎\n' +
          '<ops>\n{"remove": ["知乎"]}\n</ops>\n\n' +
          '用户：现在有哪些卡片？\n' +
          '你：当前有 N 个卡片：知乎、GitHub、百度、Gmail。';
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

      function saveAIHistory() {
        try { localStorage.setItem(AI_HISTORY_KEY, JSON.stringify(aiHistory)); } catch (e) {}
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

      // 加载已保存的配置
      (function loadAIConfig() {
        try {
          var raw = localStorage.getItem(AI_CONFIG_KEY);
          if (raw) {
            var cfg = JSON.parse(raw);
            if (cfg.endpoint) aiEndpoint.value = cfg.endpoint;
            if (cfg.key) aiKey.value = cfg.key;
            if (cfg.model) aiModel.value = cfg.model;
            if (cfg.webSearch) aiWebSearch.checked = true;
            if (cfg.bochaKey) aiBochaKey.value = cfg.bochaKey;
            if (cfg.deepSearch) aiDeepSearch.checked = true;
          }
        } catch (e) {}
      })();

      function saveAIConfig() {
        try {
          localStorage.setItem(AI_CONFIG_KEY, JSON.stringify({
            endpoint: aiEndpoint.value.trim(),
            key: aiKey.value.trim(),
            model: aiModel.value.trim(),
            webSearch: aiWebSearch.checked,
            bochaKey: aiBochaKey.value.trim(),
            deepSearch: aiDeepSearch.checked
          }));
        } catch (e) {}
      }

      aiEndpoint.addEventListener('change', saveAIConfig);
      aiKey.addEventListener('change', saveAIConfig);
      aiModel.addEventListener('change', saveAIConfig);
      aiWebSearch.addEventListener('change', saveAIConfig);
      aiBochaKey.addEventListener('change', saveAIConfig);
      aiDeepSearch.addEventListener('change', saveAIConfig);

      // 深度搜索：在气泡内部创建思考过程容器
      function createThinkingEl() {
        var el = document.createElement('div');
        el.className = 'ai-thinking';
        el.innerHTML = '<div class="ai-thinking-header"><span class="ai-thinking-arrow">▶</span> 深度思考</div><div class="ai-thinking-body"></div>';
        el.querySelector('.ai-thinking-header').onclick = function () { el.classList.toggle('open'); };
        return el;
      }
      // 思考步骤图标映射（语义化 SVG 圆点，按类型区分颜色）
      var _thinkingIconMap = {
        depth:    '<svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#7a4df0"/></svg>',
        reasoning:'<svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#2468f2"/></svg>',
        search:   '<svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#e88a2b"/></svg>',
        result:   '<svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#1aa86b"/></svg>',
        done:     '<svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#1aa86b"/></svg>',
        error:    '<svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#d93b3b"/></svg>'
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
        aiMessages.scrollTop = aiMessages.scrollHeight;
        return step;
      }
      // 标记思考完成（仅移除 spinner，保留推理正文，不再追加"完成"提示）
      function finishThinking(thinkingEl) {
        if (!thinkingEl) return;
        var spinner = thinkingEl.querySelector('.ai-thinking-spinner');
        if (spinner) spinner.remove();
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

      // 解析"文本标签"形式的工具调用：部分模型/API 不返回结构化 delta.tool_calls，
      // 而是把 <tool_call><function=web_search><parameter=query>…</parameter></function></tool_call>
      // 直接写进正文文本。命中则返回 {name, query, raw}，否则返回 null。
      function parseTextToolCall(text) {
        if (!text || typeof text !== 'string') return null;
        var m = text.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
        if (!m) return null;
        var inner = m[1];
        // function=web_search 或 function="web_search"
        var fn = inner.match(/<function\s*=\s*"?([^>\s"']+)"?>/i);
        if (!fn) return null;
        var name = fn[1].trim();
        var query = '';
        // parameter=query … </parameter>（也兼容 parameter name="query"）
        var pm = inner.match(/<parameter\s*=\s*"?query"?[^>]*>([\s\S]*?)<\/parameter>/i);
        if (!pm) pm = inner.match(/<parameter\s+name\s*=\s*"?query"?[^>]*>([\s\S]*?)<\/parameter>/i);
        if (pm) query = pm[1].trim();
        return { name: name, query: query, raw: m[0] };
      }

      // 把"纯文本 + 语义标签"的 assistant 内容渲染成带样式的 DOM：
      //   <think>…</think>        → 深度思考卡片（前端样式）
      //   <tool_call>…</tool_call> → 联网搜索状态块（前端样式）
      //   <ops>…</ops>            → 工具操作 chips（前端样式）
      //   其余                    → Markdown 正文
      function renderAIContent(content) {
        var frag = document.createDocumentFragment();
        var rest = String(content || '');

        // 1) 思考过程
        var thinkMatch = rest.match(/<think>([\s\S]*?)<\/think>/i);
        if (thinkMatch) {
          var thinkEl = document.createElement('div');
          thinkEl.className = 'ai-thinking open';
          thinkEl.innerHTML = '<div class="ai-thinking-header"><span class="ai-thinking-arrow">▶</span> 深度思考</div><div class="ai-thinking-body"></div>';
          var bodyEl = thinkEl.querySelector('.ai-thinking-body');
          var stepEl = document.createElement('div');
          stepEl.className = 'ai-thinking-step ai-reasoning-step';
          stepEl.innerHTML = '<span class="step-icon"><svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#2468f2"/></svg></span><span class="step-text"><span class="ai-reasoning-text"></span></span>';
          stepEl.querySelector('.ai-reasoning-text').textContent = thinkMatch[1];
          bodyEl.appendChild(stepEl);
          frag.appendChild(thinkEl);
          rest = rest.slice(0, thinkMatch.index) + rest.slice(thinkMatch.index + thinkMatch[0].length);
        }

        // 2) 工具调用（联网搜索）
        var toolMatch = rest.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
        if (toolMatch) {
          var _tq = '';
          try {
            var tc = JSON.parse(toolMatch[1].trim());
            _tq = String(tc.query || '');
          } catch (e) {
            // 兼容旧历史里的"文本标签"形式：<function=web_search><parameter=query>…</parameter>
            var _tf = parseTextToolCall(rest);
            if (_tf) _tq = _tf.query;
          }
          if (_tq) {
            var searchEl = document.createElement('div');
            searchEl.className = 'ai-ops-placeholder';
            searchEl.innerHTML = '<span class="ai-ops-spin">🔍</span> 联网搜索: ' + _tq.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            frag.appendChild(searchEl);
          }
          rest = rest.slice(0, toolMatch.index) + rest.slice(toolMatch.index + toolMatch[0].length);
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
          //  - role === 'tool'：联网搜索原始结果，仅作为 API 上下文保留；
          //    否则退出页面重进/重开面板时会残留展示上一次的搜索结果
          //  - msg.tool_calls：assistant 的搜索工具调用帧（content 通常为 null）
          if (msg.role === 'tool' || msg.tool_calls) continue;

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
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
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
        // 无序列表
        html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
        // 有序列表
        html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
        // 换行
        html = html.replace(/\n/g, '<br>');
        return html;
      }

      // 实时解析 <ops> 标签，分段渲染气泡（streaming=true 时 <ops> 块显示 placeholder）
      function renderStreamBubble(el, text, streaming) {
        // 保留气泡内的思考过程容器（深度思考时创建在 bubble 内部）
        var thinkingEls = el.querySelectorAll('.ai-thinking');
        el.innerHTML = '';
        for (var ti = 0; ti < thinkingEls.length; ti++) { el.appendChild(thinkingEls[ti]); }
        // 剔除"文本标签"形式的工具调用（<tool_call>…</tool_call>），
        // 避免流式期间把原始工具调用代码暴露给用户；搜索状态由后续流程展示。
        text = String(text || '').replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
        var m = text.match(/<ops>([\s\S]*?)(<\/ops>|$)/i);
        if (!m) {
          // 有思考容器时，用 appendChild 不会覆盖；无思考容器时也安全
          var mdDiv = document.createElement('div');
          mdDiv.innerHTML = renderMarkdown(text);
          el.appendChild(mdDiv);
          return;
        }
        // <ops> 之前的文本
        var before = text.substring(0, m.index);
        if (before.trim()) {
          var beforeDiv = document.createElement('div');
          beforeDiv.style.whiteSpace = 'normal';
          beforeDiv.innerHTML = renderMarkdown(before);
          el.appendChild(beforeDiv);
        }
        // <ops> 块：流式时显示 placeholder，结束后会被 chips 替换
        if (streaming) {
          var placeholder = document.createElement('div');
          placeholder.className = 'ai-ops-placeholder';
          placeholder.innerHTML = '<span class="ai-ops-spin">⚙</span> 准备执行操作…';
          el.appendChild(placeholder);
        }
        // <ops> 之后的内容
        var after = text.substring(m.index + m[0].length);
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
            add:     { icon: '+',  label: 'add' },
            remove:  { icon: '−',  label: 'remove' },
            update:  { icon: '↻',  label: 'update' },
            reorder: { icon: '⇄', label: 'reorder' }
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

      aiFab.addEventListener('click', function () { toggleAI(true); });
      aiClose.addEventListener('click', function () { toggleAI(false); });
      aiOverlay.addEventListener('click', function () { toggleAI(false); });
      document.getElementById('aiClear').addEventListener('click', clearAIConversation);

      // AI 配置面板开关
      var aiConfigPanel = document.getElementById('aiConfigPanel');
      document.getElementById('aiConfigToggle').addEventListener('click', function () {
        aiConfigPanel.classList.toggle('open');
        this.classList.toggle('active');
      });

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
          var raw = localStorage.getItem(AI_SNAPSHOT_KEY);
          var snap = null;
          if (raw) {
            try { snap = JSON.parse(raw); } catch (e) { snap = null; }
          }
          if (!snap || !Array.isArray(snap.list)) {
            // 快照已被消费（历史重渲染后再次点击）：只做状态提示，不重复执行
            markUndone(undoBtn);
            return;
          }

          list = snap.list;
          save(list);
          render(list);
          localStorage.removeItem(AI_SNAPSHOT_KEY);
          markUndone(undoBtn);
          // 纯回滚语义：撤销只恢复列表，不自动把原指令重发回 agent（避免"撤了又做"）
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
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      });

      function sendAI() {
        var text = aiInput.value.trim();
        if (!text) return;

        var endpoint = aiEndpoint.value.trim();
        var key = aiKey.value.trim();
        var model = aiModel.value.trim() || 'deepseek-chat';

        if (!endpoint || !key) {
          addAIMessage('请先点击右上角 ⚙ 配置 API 地址和密钥。', 'error');
          return;
        }

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
        var url = endpoint.trim().replace(/\/+$/, '');
        if (url && url.indexOf('/chat/completions') === -1) {
          var urlPath = url.replace(/^https?:\/\/[^\/]+/, '');
          if (!/\/v\d+/.test(urlPath)) url += '/v1';
          url += '/chat/completions';
        }

        // 联网搜索：工具调用相关
        var deepThinkingOn = aiDeepSearch && aiDeepSearch.checked;
        var webSearchEnabled = aiWebSearch && aiWebSearch.checked && aiBochaKey && aiBochaKey.value.trim();
        var pendingToolCallId = null;
        var pendingToolCallName = null;
        var pendingToolCallArgs = '';
        var reasoningAccum = '';          // 深度思考：推理内容累积（局部变量，避免竞态）
        var reasoningTextEl = null;       // 深度思考：缓存推理文本 DOM 引用

        var reqBody = { model: model, messages: aiHistory, temperature: 0.1, stream: true };
        // 深度思考：启用模型推理能力（thinking 参数）
        if (deepThinkingOn) {
          reqBody.thinking = { type: 'enabled' };
          reqBody.reasoning_effort = 'high';
        }
        // 联网搜索：添加 web_search 工具定义，让 AI 自行判断是否需要搜索
        if (webSearchEnabled) {
          reqBody.tools = [{
            type: 'function',
            function: {
              name: 'web_search',
              description: '搜索互联网获取最新信息。当用户询问天气、新闻、实时股价、最新事件、或任何需要当前/实时信息的问题时使用此工具。对于常识性问题（如"1+1等于几"）不需要使用。',
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: '简洁有效的搜索关键词' }
                },
                required: ['query']
              }
            }
          }];
          reqBody.tool_choice = 'auto';
        }

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
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + key
          },
          body: JSON.stringify(reqBody),
          signal: AbortSignal.timeout(120000)
        }).then(function (res) {
          if (!res.ok) {
            return res.text().then(function (t) { throw new Error('HTTP ' + res.status + ': ' + t); });
          }
          var reader = res.body.getReader();
          var decoder = new TextDecoder();
          var buffer = '';

          function readChunk() {
            return reader.read().then(function (result) {
              if (result.done) {
                // 流结束，不做处理
                return;
              }

              // ====== 处理每个数据块 ======
              buffer += decoder.decode(result.value, { stream: true });
              var lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (line === '' || line.startsWith(':')) continue;
                if (line === 'data: [DONE]') continue;
                if (line.startsWith('data: ')) {
                  try {
                    var chunk = JSON.parse(line.slice(6));
                    var delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
                    if (!delta) continue;

                    // Debug：第一次拿到 delta 时打一下完整结构
                    if (window.console && console.log && !window.__aiLoggedFirst) {
                      window.__aiLoggedFirst = true;
                      console.log('[AI] ← first delta:', JSON.stringify(delta, null, 2));
                    }

                    // 处理文本内容
                    if (delta.content && bubble) {
                      accumulated += delta.content;
                      renderStreamBubble(bubble, accumulated, true);
                      aiMessages.scrollTop = aiMessages.scrollHeight;
                    }

                    // 处理深度思考内容（reasoning_content）— 流式累积到同一个步骤
                    if (deepThinkingOn && delta.reasoning_content) {
                      if (!reasoningAccum) reasoningAccum = '';
                      reasoningAccum += delta.reasoning_content;
                      // 在思考容器中实时展示：更新已有步骤 or 新建
                      var _rcEl = bubble.querySelector('.ai-thinking-body');
                      if (_rcEl) {
                        if (reasoningTextEl) {
                          // 已有推理文本元素，直接更新 textContent（高性能）
                          reasoningTextEl.textContent = reasoningAccum;
                        } else {
                          // 首次收到 reasoning_content，创建推理步骤并缓存引用
                          var _newStep = addThinkingStep(bubble.querySelector('.ai-thinking'), 'reasoning',
                            '<span class="ai-thinking-spinner">⏳</span> <span class="ai-reasoning-text">' + reasoningAccum.replace(/</g, '&lt;') + '</span>');
                          if (_newStep) reasoningTextEl = _newStep.querySelector('.ai-reasoning-text');
                        }
                        aiMessages.scrollTop = aiMessages.scrollHeight;
                      }
                    }

                    // 处理工具调用（联网搜索）
                    if (delta.tool_calls) {
                      for (var tci = 0; tci < delta.tool_calls.length; tci++) {
                        var tc = delta.tool_calls[tci];
                        if (tc.id) pendingToolCallId = tc.id;
                        if (tc.function) {
                          if (tc.function.name) pendingToolCallName = tc.function.name;
                          if (tc.function.arguments) pendingToolCallArgs += tc.function.arguments;
                        }
                      }
                    }
                  } catch (e) {}
                }
              }
              return readChunk();
            });
          }
          return readChunk();
        }).catch(function (err) {
          var errMsg = '操作失败：' + err.message;
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
          // 联网搜索：检测工具调用，执行搜索并发起后续请求
          // 优先结构化 delta.tool_calls；若模型把工具调用写成正文里的文本标签
          // （<tool_call><function=web_search><parameter=query>…），则解析标签兜底。
          if (webSearchEnabled && !(pendingToolCallName === 'web_search' && pendingToolCallArgs)) {
            var _textTc = parseTextToolCall(accumulated);
            if (_textTc && _textTc.name === 'web_search' && _textTc.query) {
              pendingToolCallName = 'web_search';
              pendingToolCallArgs = JSON.stringify({ query: _textTc.query });
              // 从正文中剔除原始标签，避免展示/保存原始代码
              accumulated = accumulated.replace(_textTc.raw, '');
            }
          }
          if (webSearchEnabled && pendingToolCallName === 'web_search' && pendingToolCallArgs) {
            try {
              var tcArgs = JSON.parse(pendingToolCallArgs);
              var searchQuery = tcArgs.query || text;

              // 深度思考：创建思考过程容器（插入气泡内部，随 bubble 一起保存）
              var thinkingEl = deepThinkingOn ? createThinkingEl() : null;
              if (thinkingEl) {
                bubble.appendChild(thinkingEl);
                bubble.style.whiteSpace = 'normal';
                addThinkingStep(thinkingEl, 'search', '正在分析问题，判断是否需要联网搜索…');
                addThinkingStep(thinkingEl, 'search', '决定搜索: <strong>' + searchQuery.replace(/</g, '&lt;') + '</strong>');
              }

              // 显示搜索状态（深度思考时追加在思考容器之后，不覆盖）
              bubble.className = 'ai-msg ai-msg-assistant';
              bubble.style.whiteSpace = 'normal';
              var searchStatusEl = document.createElement('div');
              searchStatusEl.className = 'ai-ops-placeholder';
              searchStatusEl.innerHTML = '<span class="ai-ops-spin">⏳</span> 正在搜索: ' + searchQuery.replace(/</g, '&lt;') + '…';
              bubble.appendChild(searchStatusEl);
              aiMessages.scrollTop = aiMessages.scrollHeight;

              // 调用博查AI搜索API
              return fetch('https://api.bochaai.com/v1/web-search', {
                method: 'POST',
                headers: {
                  'Authorization': 'Bearer ' + aiBochaKey.value.trim(),
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ query: searchQuery, freshness: 'noLimit', summary: true, count: 5 }),
                signal: AbortSignal.timeout(30000)
              }).then(function (sRes) {
                if (!sRes.ok) throw new Error('搜索API HTTP ' + sRes.status);
                return sRes.json();
              }).then(function (sData) {
                // 格式化搜索结果
                var searchContext = '';
                var resultCount = 0;
                try {
                  var webPages = sData.data && sData.data.webPages;
                  if (webPages && webPages.value && webPages.value.length > 0) {
                    var sItems = webPages.value.slice(0, 5);
                    resultCount = sItems.length;
                    for (var si = 0; si < sItems.length; si++) {
                      var page = sItems[si];
                      searchContext += '【' + (si + 1) + '】' + (page.name || '') + '\n';
                      searchContext += '链接：' + (page.url || '') + '\n';
                      searchContext += (page.snippet || page.summary || '') + '\n\n';
                    }
                  }
                } catch (e) {}

                // 深度搜索：记录搜索结果
                if (thinkingEl) {
                  addThinkingStep(thinkingEl, 'result', '搜索完成，找到 <strong>' + resultCount + '</strong> 条相关结果');
                  addThinkingStep(thinkingEl, 'search', '<span class="ai-thinking-spinner">⏳</span> 正在阅读筛选，整理回答…');
                }

                // 将工具调用和结果加入历史（让模型知道搜索结果）
                aiHistory.push({
                  role: 'assistant', content: null,
                  tool_calls: [{ id: pendingToolCallId, type: 'function', function: { name: 'web_search', arguments: pendingToolCallArgs } }]
                });
                aiHistory.push({ role: 'tool', tool_call_id: pendingToolCallId, content: searchContext || '未找到相关搜索结果。' });
                saveAIHistory();

                // 重置状态，发起后续请求（让模型基于搜索结果回答）
                // 保留思考容器，避免被 innerHTML 清空
                var savedThinking = bubble.querySelector('.ai-thinking');
                accumulated = '';
                pendingToolCallId = null;
                pendingToolCallName = null;
                pendingToolCallArgs = '';
                bubble.innerHTML = '';
                if (savedThinking) bubble.appendChild(savedThinking);

                var followUpBody = { model: model, messages: aiHistory, temperature: 0.1, stream: true };

                return fetch(url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
                  body: JSON.stringify(followUpBody),
                  signal: AbortSignal.timeout(120000)
                }).then(function (fRes) {
                  if (!fRes.ok) return fRes.text().then(function (t) { throw new Error('后续请求 HTTP ' + fRes.status + ': ' + t); });
                  var fReader = fRes.body.getReader();
                  var fDecoder = new TextDecoder();
                  var fBuffer = '';

                  function readFollowUp() {
                    return fReader.read().then(function (fResult) {
                      if (fResult.done) return;
                      fBuffer += fDecoder.decode(fResult.value, { stream: true });
                      var fLines = fBuffer.split('\n');
                      fBuffer = fLines.pop() || '';
                      for (var fi = 0; fi < fLines.length; fi++) {
                        var fLine = fLines[fi].trim();
                        if (fLine === '' || fLine.startsWith(':')) continue;
                        if (fLine === 'data: [DONE]') continue;
                        if (fLine.startsWith('data: ')) {
                          try {
                            var fChunk = JSON.parse(fLine.slice(6));
                            var fDelta = fChunk.choices && fChunk.choices[0] && fChunk.choices[0].delta;
                            if (fDelta && fDelta.content) {
                              accumulated += fDelta.content;
                              renderStreamBubble(bubble, accumulated, true);
                              aiMessages.scrollTop = aiMessages.scrollHeight;
                            }
                          } catch (e) {}
                        }
                      }
                      return readFollowUp();
                    });
                  }
                  return readFollowUp();
                });
              }).then(function () {
                // 后续请求完成，渲染最终结果
                renderStreamBubble(bubble, accumulated, false);
                if (thinkingEl) finishThinking(thinkingEl);
                // 保存：思考过程 + 联网搜索调用 + 正文，全部以语义标签/纯文本存储
                var finalContent = '';
                if (reasoningAccum) finalContent += '<think>' + reasoningAccum + '</think>\n';
                if (searchQuery) finalContent += '<tool_call>' + JSON.stringify({ type: 'web_search', query: searchQuery }) + '</tool_call>\n';
                finalContent += accumulated;
                aiHistory.push({ role: 'assistant', content: finalContent });
                saveAIHistory();
                aiSending = false;
                aiSend.disabled = false;
                aiSend.textContent = '发送';
              }).catch(function (fErr) {
                var fErrMsg = '搜索后回复失败：' + fErr.message;
                if (bubble) {
                  bubble.innerHTML = renderMarkdown(fErrMsg);
                  bubble.style.whiteSpace = 'normal';
                  bubble.className = 'ai-msg ai-msg-error';
                }
                reasoningTextEl = null;
                if (thinkingEl) finishThinking(thinkingEl);
                aiHistory.push({ role: 'assistant', content: fErrMsg });
                saveAIHistory();
                aiSending = false;
                aiSend.disabled = false;
                aiSend.textContent = '发送';
              });
            } catch (e) {
              // 工具调用处理失败，降级为正常流程
              console.warn('[AI] 工具调用处理失败:', e);
            }
          }

          // 正常流程（无工具调用）
          // 深度思考：仅结束 spinner（不追加"推理完成"提示）
          if (deepThinkingOn && bubble) {
            var _dtDone = bubble.querySelector('.ai-thinking');
            if (_dtDone) {
              finishThinking(_dtDone);
            }
            // reasoningAccum 是局部变量，函数退出自动销毁
          }
          if (!accumulated) {
            aiSending = false;
            aiSend.disabled = false;
            aiSend.textContent = '发送';
            return;
          }

          // 重新渲染气泡（流式结束，折叠区设为收起状态）
          renderStreamBubble(bubble, accumulated, false);

          // 提取 <ops> 并应用 diff（不是重写整张列表，模型只描述"做了什么改动"）
          var opsMatch = accumulated.match(/<ops>([\s\S]*?)<\/ops>/i);
          if (opsMatch) {
            var opsStr = opsMatch[1].trim();
            var ops = JSON.parse(opsStr);

            // 防御性校验
            if (typeof ops !== 'object' || ops === null) throw new Error('ops 格式错误');
            var addArr = Array.isArray(ops.add) ? ops.add : [];
            var removeArr = Array.isArray(ops.remove) ? ops.remove : [];
            var updateArr = Array.isArray(ops.update) ? ops.update : [];
            var reorderArr = Array.isArray(ops.reorder) ? ops.reorder : null;

            // 校验 add 项字段
            for (var ai2 = 0; ai2 < addArr.length; ai2++) {
              var a2 = addArr[ai2];
              if (!a2.name || !a2.url) throw new Error('add[' + ai2 + '] 缺少 name 或 url');
              // 默认使用 auto 模式，自动抓取网站图标
              if (!a2.iconSrc) a2.iconSrc = 'auto';
              // auto 模式需要 color 作为占位色
              if (a2.iconSrc === 'auto' && !a2.color) a2.color = 'blue';
            }

            // 从当前 list 出发，按 ops 应用 diff（没提到的字段原样保留）
            // 注意：必须逐项拷贝，浅拷贝 slice() 会让 update 原地改到 list 共享对象，
            // 进而污染下方用于撤销的快照（update 类操作将无法正确撤销）。
            var newList = list.map(function (it) { return Object.assign({}, it); });
            var nameIndex = {};
            newList.forEach(function (it, idx) { nameIndex[it.name] = idx; });

            // remove: 按 name 删
            removeArr.forEach(function (nm) {
              if (nameIndex[nm] !== undefined) {
                newList.splice(nameIndex[nm], 1);
                // 索引重算
                nameIndex = {};
                newList.forEach(function (it, idx) { nameIndex[it.name] = idx; });
              }
            });

            // update: 按 name 合并字段
            updateArr.forEach(function (u) {
              if (!u || !u.name) return;
              var idx2 = nameIndex[u.name];
              if (idx2 === undefined) return;
              var keys = Object.keys(u);
              for (var ki = 0; ki < keys.length; ki++) {
                var k = keys[ki];
                if (k === 'name') continue;
                newList[idx2][k] = u[k];
              }
            });

            // add: 追加到末尾
            addArr.forEach(function (c) { newList.push(c); });

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
            if (willDelete > 3 || (newList.length < 2 && list.length > 0 && willDelete > 0)) {
              var msg = 'AI 准备删除 ' + willDelete + ' 个卡片，剩余 ' + newList.length + ' 个。\n确定要执行吗？';
              if (!confirm(msg)) {
                if (bubble) {
                  bubble.classList.add('ai-msg-cancelled');
                  var cancelTag = document.createElement('div');
                  cancelTag.className = 'ai-cancel-tag';
                  cancelTag.textContent = '已取消应用';
                  bubble.appendChild(cancelTag);
                }
                return;
              }
            }

            // 应用前先存一份快照
            try {
              localStorage.setItem(AI_SNAPSHOT_KEY, JSON.stringify({
                list: list,
                time: Date.now()
              }));
            } catch (e) {}

            list = newList;
            var savedOk = save(list);
            render(list);

            // 对 AI 添加的 auto 图标卡片，触发自动抓取
            addArr.forEach(function (c) {
              if (c.iconSrc === 'auto') {
                // 找新添加卡片的 DOM
                var cards = nav.querySelectorAll('.shortcut');
                for (var ci = 0; ci < cards.length; ci++) {
                  var card = cards[ci];
                  // 根据 name 和 url 匹配（render 后的 DOM 用 dataset 存了 iconSrc，但 name 在 .label 里）
                  var label = card.querySelector('.label');
                  if (label && label.textContent === c.name) {
                    var idx = Array.prototype.indexOf.call(cards, card);
                    applyAutoIcon(card, idx, c.color || 'blue');
                    break;
                  }
                }
              }
            });

            // 在气泡里显示保存状态
            if (bubble) {
              var statusLine = document.createElement('div');
              statusLine.className = 'ai-save-status ' + (savedOk ? 'ok' : 'err');
              statusLine.style.marginTop = '8px';
              statusLine.textContent = savedOk ? '✓ 已保存到 localStorage' : '✗ 保存失败';
              bubble.appendChild(statusLine);
            }

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
              bubble.appendChild(undoBtn);
            }
          }

          // 保存 AI 回复到历史：只存纯文本 + 语义标签，不存渲染后的 HTML 快照，
          // 这样样式改动后旧消息也会用最新样式重新渲染
          var finalContent = accumulated;
          if (reasoningAccum) {
            finalContent = '<think>' + reasoningAccum + '</think>\n' + finalContent;
          }
          aiHistory.push({ role: 'assistant', content: finalContent });
          saveAIHistory();

          aiSending = false;
          aiSend.disabled = false;
          aiSend.textContent = '发送';
        });
      } // end of doSend

        doSend('');
      }

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
      window.__debug = { fabBtn: fabBtn, menu: menu, toggle: toggleMenu, note: { open: openNote, close: closeNote } };
    })();
