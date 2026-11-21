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

      function buildSystemPrompt() {
        // 简明卡片清单：只列 name + url，节省 token，避免模型注意力稀释
        var lines = ['当前卡片（共 ' + cards.list.length + ' 个；下面已经给出每张卡片的名称和网址，你可以直接使用，不要声称看不到）：'];
        for (var i = 0; i < cards.list.length; i++) {
          var it = cards.list[i];
          lines.push('- 名称：' + it.name + ' ｜ 网址：' + (it.url ? it.url : '（未设置）'));
        }
        var cardsList = lines.join('\n');

        var webOn = aiWebSearch && aiWebSearch.checked && aiBochaKey && aiBochaKey.value.trim();

        var cardNames = cards.list.map(function (x) { return x.name; });
        var cardNamesText = cardNames.length ? cardNames.join('、') : '（暂无卡片）';
        var exampleUpdate = cardNames.length
          ? '{"name":"' + cardNames[0] + '","color":"green"}'
          : '{"name":"GitHub","color":"green"}';

        return '你是 Motuo-Tab 的快捷方式管理助手。\n\n' +
          '## 工具说明\n' +
          '- 名称：Motuo-Tab（浏览器标签页）\n' +
          '- 开发者：Motuo24，博客 https://pod.xr24.cn\n' +
          '- 站内搜索直达：搜索框输入 "bl 关键词"（B站）、"zh 关键词"（知乎）、"gh 关键词"（GitHub）、"tb 关键词"（淘宝）、"db 关键词"（豆瓣）\n' +
          '- 自定义搜索引擎：搜索框左侧图标下拉，底部可添加\n' +
          '- 搜索建议：搜索框输入时弹历史建议\n' +
          '- 键盘快捷键：Ctrl+E 专注模式、Ctrl+K 编辑模式、Ctrl+A 打开 AI\n\n' +
          (webOn
            ? '## 联网搜索（优先级最高）\n' +
              '当用户需要实时/最新信息（天气、新闻、股价、最新事件、具体网址、你不确定的事实等）时，\n' +
              '本轮不要直接回答，也不要输出 <ops>；只输出下面这一行：\n' +
              '<web_search>简洁有效的搜索关键词</web_search>\n\n' +
              '硬性要求（违反会导致搜索失效）：\n' +
              '- 必须原样输出完整的尖括号标签，前后不能少 < 或 >。\n' +
              '- 禁止写成 web_search 关键词、<search>…</search>、用反引号包住、或加空格/说明文字。\n' +
              '- 本轮除了这一行，不要输出任何其他内容。\n\n' +
              '补充规则：\n' +
              '- 用户说"再搜一次 / 重搜 / 换个说法搜"但没给新关键词时：沿用上一轮的搜索词，可加上新的限定词，例如 <web_search>上一轮的词 官网</web_search>。\n' +
              '- 客户端会把搜索结果发回；收到后：若用户还要求改卡片，输出"一行摘要 + <ops>"；否则用中文回答并标注来源编号（如 [1]）。\n' +
              '- 常识性问题（如"1+1等于几"）不需要搜索，直接回答。\n\n'
            : '') +
          '## 当前卡片\n' + cardsList + '\n\n' +
          '## 总原则（先看这里）\n' +
          '下列规则是为了更好地协助用户，**不是必须硬凑的模板**。只有当"确实需要、且信息足够"改动卡片时，才输出 <ops>。\n' +
          '遇到下列情况**不要输出 <ops>**，只用文字回答即可：\n' +
          '- 卡片已经存在（**绝不重复添加**）\n' +
          '- 缺少必要信息（例如没有网址）且无法确定\n' +
          '- 指令不清/有歧义（先反问确认）\n' +
          '- 用户只是查询或闲聊\n' +
          '宁可只回文字，也不要为了凑 <ops> 而做出错误或重复的操作。\n\n' +
          '## 输出契约\n' +
          '多意图优先级：需要实时信息 → 先只输出搜索标签，拿到结果后再处理卡片；修改卡片 → 摘要 + <ops>；纯问答 → 普通文字。任何一轮只做一件事。\n\n' +
          '### A. 修改卡片时\n' +
          '回复必须且只能由两部分组成，除此之外不得有任何字符：\n' +
          '1) 一行中文操作摘要（≤30 字，陈述结果）\n' +
          '2) 紧随其后、位于回复最末尾的一个 <ops> 块：\n' +
          '<ops>\n{"add":[],"remove":[],"update":[],"reorder":[]}\n</ops>\n\n' +
          '硬性要求：\n' +
          '- ops 内必须是**严格 JSON**：键与字符串都用英文双引号；禁止注释、禁止尾逗号、禁止单引号。\n' +
          '- 只写实际用到的键，不要输出空数组。\n' +
          '- 只输出**一个** <ops> 块，且必须在回复末尾。\n' +
          '- 禁止用 ```json 代码块包裹；禁止只输出裸 JSON 而省略 <ops> 标签；禁止在 JSON 外用文字复述 JSON。\n' +
          '- add：数组，每项 {"name":"名称","url":"完整网址","iconSrc":"auto","color":"blue"}；**不要添加当前卡片里已存在的同名卡片**。\n' +
          '  iconSrc：auto（自动抓图标，必须同时给 color 占位色）/ color（只用颜色）/ image（配 icon 图片URL）。\n' +
          '  color 取 blue/pink/orange/purple/sky/green/amber/white。\n' +
          '- remove：字符串数组，名称必须与当前卡片完全一致。\n' +
          '- update：数组，每项 {"name":"现有名称", ...只写要改的字段}。\n' +
          '- reorder：字符串数组，按新的完整顺序列出**当前已存在的卡片名**，不要写不存在的名字。\n' +
          '- 你只需描述"改了什么"，客户端会 apply 到当前状态；没提到的卡片自动保留。\n\n' +
          '### B. 纯查询时\n' +
          '（问有哪些卡片、某网站在不在、数量等）只用中文正常回答，绝不输出 <ops>。\n\n' +
          '### C. 指令模糊时\n' +
          '（如"整理一下""优化一下"）用一句话反问确认，不要输出 <ops>。\n\n' +
          '## 正例\n' +
          '用户：加个 Google\n' +
          '你：已添加 Google\n' +
          '<ops>\n{"add": [{"name": "Google", "url": "https://www.google.com", "iconSrc": "auto", "color": "blue"}]}\n</ops>\n\n' +
          '用户：把最前面的卡片改成绿色\n' +
          '你：已将该卡片图标改为绿色\n' +
          '<ops>\n{"update": [' + exampleUpdate + ']}\n</ops>\n\n' +
          '用户：删了知乎\n' +
          '你：已删除知乎\n' +
          '<ops>\n{"remove": ["知乎"]}\n</ops>\n\n' +
          '用户：现在有哪些卡片？\n' +
          '你：当前有 ' + cards.list.length + ' 个卡片：' + cardNamesText + '。\n\n' +
          '## 反例（以下均为错误输出，禁止出现）\n' +
          '错误1：把 JSON 放进代码块而不加 <ops> → ```json {"add":[...]} ```\n' +
          '错误2：只输出裸 JSON，没有 <ops> 标签 → {"add":[...]}\n' +
          '错误3：JSON 带注释/尾逗号/单引号 → {"add":[{"name":"X", /* 新卡片 */ "url":"https://x.com",}]}\n' +
          '错误4：add/remove/update 写成对象或字符串 → {"add":{"name":"X","url":"https://x.com"},"remove":"知乎"}\n' +
          '错误5：修改请求却只用文字描述，没有任何 <ops> 块\n' +
          '错误6：一条回复里输出多个 <ops> 块或大段解释\n' +
          '错误7：reorder 里写当前不存在的卡片名';
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
        var out = [];
        for (var i = 0; i < history.length; i++) {
          var m = history[i];
          if (!m || typeof m !== 'object') continue;
          // 新协议不使用 native tools：丢弃旧的 tool 结果消息与 tool_calls 字段，
          // 否则请求里没有 tools 却带着 tool 消息，部分 API（含 DeepSeek）会报 400。
          if (m.role === 'tool') continue;
          var copy = {};
          for (var k in m) {
            // 既不带 native tool_calls，也不带 reasoning_content
            // （后者只有 native tools 链路才需要，旧版 reasoner 收到会 400）
            if (Object.prototype.hasOwnProperty.call(m, k) && k !== 'tool_calls' && k !== 'reasoning_content' && k !== 'hidden') copy[k] = m[k];
          }
          // 只清洗 assistant 的历史正文，剥离前端渲染用的语义标签。
          // 关键：system 提示词里本来就包含 <ops>/<web_search> 的格式示例，
          // 绝不能一起删掉，否则模型收不到格式规范（曾导致裸 JSON、标签丢尖括号等）。
          if (m.role === 'assistant' && typeof copy.content === 'string') {
            copy.content = copy.content
              .replace(/<think>[\s\S]*?<\/think>/gi, '')
              .replace(/<web_search>[\s\S]*?<\/web_search>/gi, '')
              .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
              .replace(/<ops>[\s\S]*?<\/ops>/gi, '')
              .trim();
          }
          // 纯 tool_calls 帧（content 为空）在去掉 tool_calls 后没有意义，直接丢弃
          if (m.tool_calls && (copy.content === null || copy.content === undefined || copy.content === '')) continue;
          out.push(copy);
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
        aiModelBadge.title = m ? '当前模型：' + m : '';
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
        updateModelBadge();
      })();

      function saveAIConfig() {
        updateModelBadge();
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
      aiWebSearch.addEventListener('change', function () {
        saveAIConfig();
        // 开启联网搜索但没有博查密钥时给出提示，避免"开了却搜不了"的静默失效
        if (this.checked && !aiBochaKey.value.trim()) {
          showAIToast('联网搜索需要先在配置窗口里填写博查 AI 密钥');
        }
      });
      aiBochaKey.addEventListener('change', saveAIConfig);
      aiDeepSearch.addEventListener('change', saveAIConfig);

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
          .replace(/(<\/?)\s*(?:web\s*search|websearch|search_web|search)\b/gi, '$1web_search');
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
          if (name === 'web_search' || /search/i.test(name)) {
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
        el.innerHTML = '';
        for (var ti = 0; ti < thinkingEls.length; ti++) { el.appendChild(thinkingEls[ti]); }

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
            return a && typeof a === 'object' && (a.type || a.action || a.op) && !a.name;
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
        if (/<ops>[\s\S]*?<\/ops>/i.test(s)) return s;
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
        var newList = cards.list.map(function (it) { return Object.assign({}, it); });
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
        if (willDelete > 3 || (newList.length < 2 && cards.list.length > 0 && willDelete > 0)) {
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

        // 应用前先存一份快照
        try {
          localStorage.setItem(AI_SNAPSHOT_KEY, JSON.stringify({
            list: cards.list,
            time: Date.now()
          }));
        } catch (e) {}

        cards.list = newList;
        var savedOk = save(cards.list);
        render(cards.list);

        // 对 AI 添加的 auto 图标卡片，触发自动抓取
        addArr.forEach(function (c) {
          if (c.iconSrc === 'auto') {
            // 找新添加卡片的 DOM
            var cardEls = nav.querySelectorAll('.shortcut');
            for (var ci = 0; ci < cardEls.length; ci++) {
              var card = cardEls[ci];
              // 根据 name 和 url 匹配（render 后的 DOM 用 dataset 存了 iconSrc，但 name 在 .label 里）
              var label = card.querySelector('.label');
              if (label && label.textContent === c.name) {
                var idx = Array.prototype.indexOf.call(cardEls, card);
                applyAutoIcon(card, idx, c.color || 'blue');
                break;
              }
            }
          }
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

          cards.list = snap.list;
          save(cards.list);
          render(cards.list);
          localStorage.removeItem(AI_SNAPSHOT_KEY);
          markUndone(undoBtn);
          showAIToast('已撤销，卡片恢复到操作前');
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

      function sendAI() {
        // 并发门禁：处理中忽略再次发送（含 Enter 连按），避免两条流水线互相踩状态
        if (aiSending) return;
        var text = aiInput.value.trim();
        if (!text) return;

        var endpoint = aiEndpoint.value.trim();
        var key = aiKey.value.trim();
        var model = aiModel.value.trim() || 'deepseek-chat';

        if (!endpoint || !key) {
          addAIMessage('请先点击右上角 ⚙ 打开配置窗口，填写 API 地址和密钥。', 'error');
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
        var followReasoningAccum = '';    // 联网搜索后续请求的推理内容（需在外层作用域，供收尾 .then 使用）
        var reasoningTextEl = null;       // 深度思考：缓存推理文本 DOM 引用
        var followReasoningTextEl = null; // 联网搜索后第二轮推理文本 DOM 引用
        var searchResultCount = 0;        // 本轮联网搜索命中的结果数（写入历史用于回显）
        var streamFailed = false;         // 首轮流式是否已失败（失败后不再走后续流程，避免错误气泡被覆盖）
        var opsRetried = false;           // 是否已做过一次"格式纠错重试"
        var searchChipParts = [];         // 多轮搜索产生的 chip JSON（写入历史）
        var AI_MAX_SEARCH_ROUNDS = 3;     // 单轮对话最多搜索几次（防模型死循环）

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

          var retryBody = { model: model, messages: toApiMessages(aiHistory), temperature: 0.1, stream: true };
          if (deepThinkingOn) { retryBody.thinking = { type: 'enabled' }; retryBody.reasoning_effort = 'high'; }

          var retryAccum = '';
          return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify(retryBody),
            signal: AbortSignal.timeout(120000)
          }).then(function (res) {
            if (!res.ok) return res.text().then(function (t) { throw new Error('HTTP ' + res.status + '：' + String(t).slice(0, 200)); });
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
                  lines.forEach(function (ln) {
                    ln = ln.trim();
                    if (ln.indexOf('data: ') !== 0 || ln === 'data: [DONE]') return;
                    try {
                      var ch = JSON.parse(ln.slice(6));
                      var d = ch.choices && ch.choices[0] && ch.choices[0].delta;
                      if (d && d.content) retryAccum += d.content;
                    } catch (e) {}
                  });
                  read();
                }, reject);
              })();
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

        // 从错误对象里抽出能给人看的原因：状态码 + message/error 字段，并保留一段原文
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
            + '不要编造网址或搜索结果。如果原因和密钥、余额或额度有关，请提醒用户打开 AI 配置窗口检查博查密钥。';
        }
        function escapeSearchHtml(s) {
          return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        // 博查搜索：返回 { searchContext, resultCount, failed, error }
        function fetchBocha(query) {
          return fetch('https://api.bochaai.com/v1/web-search', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + aiBochaKey.value.trim(),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query: query, freshness: 'noLimit', summary: true, count: 5 }),
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
                var items = webPages.value.slice(0, 5);
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
            // 搜索失败（网络 / CORS / 超时 / 配额）：不中断对话，降级为"无结果"
            return { searchContext: '', resultCount: 0, failed: true, error: sErr };
          });
        }

        // 基于当前 aiHistory 发起后续请求并流式读入 accumulated（含第二轮思考展示）
        function streamFollowUp() {
          var body = { model: model, messages: toApiMessages(aiHistory), temperature: 0.1, stream: true };
          if (deepThinkingOn) { body.thinking = { type: 'enabled' }; body.reasoning_effort = 'high'; }
          return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(120000)
          }).then(function (res) {
            if (!res.ok) return res.text().then(function (t) { throw new Error('后续请求 HTTP ' + res.status + '：' + String(t).slice(0, 200)); });
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
                  lines.forEach(function (ln) {
                    ln = ln.trim();
                    if (ln.indexOf('data: ') !== 0 || ln === 'data: [DONE]') return;
                    try {
                      var ch = JSON.parse(ln.slice(6));
                      if (ch && ch.error) {
                        var e2 = new Error('API 流式错误：' + (typeof ch.error === 'string' ? ch.error : JSON.stringify(ch.error)));
                        e2.apiError = true;
                        throw e2;
                      }
                      var d = ch.choices && ch.choices[0] && ch.choices[0].delta;
                      if (d && d.content) {
                        accumulated += d.content;
                        renderStreamBubble(bubble, accumulated, true);
                        aiMessages.scrollTop = aiMessages.scrollHeight;
                      }
                      if (d && d.reasoning_content) {
                        followReasoningAccum += d.reasoning_content;
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
                    } catch (e) { if (e && e.apiError) throw e; }
                  });
                  read();
                }, reject);
              })();
            });
          });
        }

        // 执行一轮"搜索 + 让模型基于结果作答"，可递归支持多轮搜索
        function runSearchRound(query, round) {
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

          return fetchBocha(query).then(function (r) {
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
                : '【联网搜索结果】\n' + (r.searchContext || '未找到相关搜索结果。') +
                  '\n请基于以上搜索结果回答用户的问题，并在引用处标注来源编号（如 [1]）；不要编造。'
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

        var reqBody = { model: model, messages: toApiMessages(aiHistory), temperature: 0.1, stream: true };
        // 深度思考：启用模型推理能力（thinking 参数）
        if (deepThinkingOn) {
          reqBody.thinking = { type: 'enabled' };
          reqBody.reasoning_effort = 'high';
        }
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
                    // 流式错误帧必须往上抛，否则会被下面的 catch 静默吞掉，
                    // 界面表现就是"思考了一下然后没反应"
                    if (chunk && chunk.error) {
                      var _apiErr = new Error('API 流式错误：' + (typeof chunk.error === 'string' ? chunk.error : JSON.stringify(chunk.error)));
                      _apiErr.apiError = true;
                      throw _apiErr;
                    }
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

                    // 处理推理内容（reasoning_content）：无论是否勾选"深度思考"都要累积，
                    // 因为 DeepSeek 思考模式 + tools 要求把 reasoning_content 回传给 API；
                    // 但仅在开启"深度思考"时才渲染到思考容器（避免默认信息密度过高）
                    if (delta.reasoning_content) {
                      reasoningAccum += delta.reasoning_content;
                      if (deepThinkingOn) {
                        // 在思考容器中实时展示：更新已有步骤 or 新建
                        var _rcEl = bubble.querySelector('.ai-thinking-body');
                        if (_rcEl) {
                          if (reasoningTextEl) {
                            // 已有推理文本元素，直接更新 textContent（高性能）
                            reasoningTextEl.textContent = reasoningAccum;
                          } else {
                            // 首次收到 reasoning_content，创建推理步骤并缓存引用
                            var _newStep = addThinkingStep(bubble.querySelector('.ai-thinking'), 'reasoning',
                              '<span class="ai-spinner"></span> <span class="ai-reasoning-text">' + reasoningAccum.replace(/</g, '&lt;') + '</span>');
                            if (_newStep) reasoningTextEl = _newStep.querySelector('.ai-reasoning-text');
                          }
                          aiMessages.scrollTop = aiMessages.scrollHeight;
                        }
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
                  } catch (e) { if (e && e.apiError) throw e; }
                }
              }
              return readChunk();
            });
          }
          return readChunk();
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
                aiHistory.push({ role: 'assistant', content: finalContent });
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
            aiHistory.push({ role: 'assistant', content: finalContent });
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
