// AI 设置新版 UI、视觉稳定性（SVG 箭头 + scrollbar-gutter）、功能扩展与密钥脱敏（T21）回归测试
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  HTML, sseResponse, jsonResponse, setupWindow, waitFor, openAI, configureAI, sendMessage
} = require('./helpers');

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

test('折叠详情按钮使用 SVG 箭头且禁用文本符号，滚动区启用 scrollbar-gutter: stable，深色模式采用中性深炭灰三级层次', () => {
  const { document } = boot({});
  assert.ok(HTML.includes('scrollbar-gutter: stable'), 'CSS 中应配置 scrollbar-gutter: stable 防止展开抖动');
  assert.ok(HTML.includes('color-scheme: dark'), '深色模式应启用 color-scheme: dark 适配原生控件');
  assert.ok(HTML.includes('--ai-dlg-bg: #2b2b2e'), '深色模式弹窗底色应采用中性深炭灰 #2b2b2e');
  assert.ok(HTML.includes('--ai-well-bg: #212225'), '深色模式凹陷输入容器应采用 #212225 区分层级');

  ['aiToggleSearchMetaBtn', 'aiToggleCustomJsonBtn'].forEach((id) => {
    const btn = document.getElementById(id);
    assert.ok(btn, id + ' 应存在');
    assert.ok(!/[⌄⌃]/.test(btn.textContent), id + ' 不应使用 Unicode ⌄/⌃ 字符');
    assert.ok(btn.querySelector('svg.ai-disclosure-chevron'), id + ' 应包含 inline SVG 箭头');
    assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');
    btn.click();
    assert.strictEqual(btn.getAttribute('aria-expanded'), 'true');
    assert.ok(btn.classList.contains('open'));
    assert.ok(!/[⌄⌃]/.test(btn.textContent), '展开后也不应包含 Unicode ⌄/⌃');
  });
});

test('模型与搜索密钥默认掩码，支持显示/隐藏切换（T21）', () => {
  const { document } = boot({});
  const keyInput = document.getElementById('aiKey');
  const searchKeyInput = document.getElementById('aiSearchKey');
  const customKeyInput = document.getElementById('aiCustomKey');
  assert.strictEqual(keyInput.type, 'password');
  assert.strictEqual(searchKeyInput.type, 'password');
  assert.strictEqual(customKeyInput.type, 'password');

  document.getElementById('aiToggleKeyEye').click();
  assert.strictEqual(keyInput.type, 'text');
  document.getElementById('aiToggleKeyEye').click();
  assert.strictEqual(keyInput.type, 'password');

  document.getElementById('aiToggleSearchEye').click();
  assert.strictEqual(searchKeyInput.type, 'text');
});

test('快速预设、拉取模型列表与复制方案正常工作', async () => {
  const { window, document, calls } = boot({
    fetchStub: (url) => {
      if (String(url).includes('/models')) {
        return jsonResponse({ data: [{ id: 'glm-4.5-air' }, { id: 'glm-z1-flash' }] });
      }
      return jsonResponse({});
    }
  });
  document.getElementById('aiConfigToggle').click();
  const zhipuChip = document.querySelector('#aiProviderChips [data-vendor="zhipu"]');
  zhipuChip.click();
  assert.strictEqual(document.getElementById('aiEndpoint').value, 'https://open.bigmodel.cn/api/paas/v4');
  assert.ok(document.getElementById('aiResolvedEndpoint').textContent.includes('/api/paas/v4/chat/completions'));

  document.getElementById('aiKey').value = 'sk-zhipu-1';
  document.getElementById('aiFetchModelsBtn').click();
  await waitFor(() => calls.some((c) => c.url.includes('/models')));
  await waitFor(() => Array.from(document.querySelectorAll('#aiModelChips .ai-chip')).some((c) => c.textContent === 'glm-z1-flash'));

  const fetchedChip = Array.from(document.querySelectorAll('#aiModelChips .ai-chip')).find((c) => c.textContent === 'glm-z1-flash');
  fetchedChip.click();
  assert.strictEqual(document.getElementById('aiModel').value, 'glm-z1-flash');

  const countBefore = document.getElementById('aiProfileSelect').options.length;
  document.getElementById('aiProfileDup').click();
  assert.strictEqual(document.getElementById('aiProfileSelect').options.length, countBefore + 1);
  assert.ok(document.getElementById('aiProfileName').value.includes('(副本)'));
  const cfg = JSON.parse(window.localStorage.getItem('newtab.ai.config.v1'));
  assert.strictEqual(cfg.profiles.length, countBefore + 1);
});

test('深度思考 4 宫格卡片与底栏开关、档位选择双向同步', () => {
  const { window, document } = boot({});
  const deepCheck = document.getElementById('aiDeepSearch');
  const gearSel = document.getElementById('aiThinkingGear');

  document.querySelector('#aiThinkCards [data-gear="medium"]').click();
  assert.strictEqual(deepCheck.checked, true);
  assert.strictEqual(gearSel.value, 'medium');

  document.querySelector('#aiThinkCards [data-gear="off"]').click();
  assert.strictEqual(deepCheck.checked, false);

  deepCheck.checked = true;
  deepCheck.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.ok(document.querySelector('#aiThinkCards [data-gear="medium"]').classList.contains('active'));
});

test('联网搜索测试按钮支持真实探测成功与错误提示', async () => {
  let fail = false;
  const { window, document } = boot({
    fetchStub: (url) => {
      if (String(url).includes('bochaai.com')) {
        if (fail) {
          return Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve('{"message":"Invalid key"}') });
        }
        return jsonResponse({ data: { webPages: { value: [{ name: 'Motuo', url: 'https://pod.xr24.cn', snippet: 'Tab' }] } } });
      }
      return Promise.reject(new Error('unexpected ' + url));
    }
  });
  document.getElementById('aiSearchKey').value = 'sk-bocha-ok';
  document.getElementById('aiSearchKey').dispatchEvent(new window.Event('change', { bubbles: true }));

  document.getElementById('aiTestSearchBtn').click();
  const badge = document.getElementById('aiSearchProbeStatus');
  await waitFor(() => badge.classList.contains('ok'));
  assert.ok(badge.textContent.includes('可用'));

  fail = true;
  document.getElementById('aiTestSearchBtn').click();
  await waitFor(() => badge.classList.contains('err'));
  assert.ok(badge.textContent.includes('HTTP 403'));
});

test('Top-P、非流式响应、自定义请求头与额外参数、提示词日期主题变量均生效', async () => {
  const { window, document, calls } = boot({
    fetchStub: () => jsonResponse({ choices: [{ message: { content: '非流式回复 OK' } }] })
  });
  openAI(document);
  configureAI(document, { endpoint: 'https://api.example.com', key: 'sk-test', model: 'm-1' });
  document.documentElement.setAttribute('data-theme', 'dark');

  document.getElementById('aiSendTopP').checked = true;
  document.getElementById('aiTopP').value = '0.75';
  document.getElementById('aiStreamEnabled').checked = false;
  document.getElementById('aiCustomHeaders').value = '{"X-Client":"Motuo-Test"}';
  document.getElementById('aiExtraBody').value = '{"presence_penalty":0.3}';
  document.getElementById('aiSystemPrompt').value = '日期={{date}} 主题={{theme}} 卡片={{card_count}}';
  ['aiSendTopP', 'aiTopP', 'aiStreamEnabled', 'aiCustomHeaders', 'aiExtraBody', 'aiSystemPrompt'].forEach((id) => {
    document.getElementById(id).dispatchEvent(new window.Event('change', { bubbles: true }));
  });

  sendMessage(document, '你好');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');

  const chat = calls.find((c) => c.url.includes('/chat/completions'));
  assert.ok(chat);
  assert.strictEqual(chat.opts.headers['X-Client'], 'Motuo-Test');
  const body = JSON.parse(chat.opts.body);
  assert.strictEqual(body.stream, false);
  assert.strictEqual(body.top_p, 0.75);
  assert.strictEqual(body.presence_penalty, 0.3);
  const sys = body.messages.find((m) => m.role === 'system').content;
  assert.ok(/日期=\d{4}-\d{2}-\d{2}/.test(sys), '系统提示词应展开 {{date}}');
  assert.ok(sys.includes('主题=深色'), '系统提示词应展开 {{theme}}');

  const lastMsg = Array.from(document.querySelectorAll('#aiMessages .ai-msg-assistant')).pop();
  assert.ok(lastMsg.textContent.includes('非流式回复 OK'));
});

test('最大搜索轮数与携带历史消息窗口控制生效', async () => {
  let seq = 0;
  const { window, document, calls } = boot({
    fetchStub: (url) => {
      if (String(url).includes('/chat/completions')) {
        seq++;
        if (seq <= 2) return sseResponse([{ choices: [{ delta: { content: '<web_search>第' + seq + '轮</web_search>' } }] }]);
        return sseResponse([{ choices: [{ delta: { content: '完成' } }] }]);
      }
      return jsonResponse({ data: { webPages: { value: [{ name: 'r', url: 'https://r.test', snippet: 'ok' }] } } });
    }
  });
  openAI(document);
  configureAI(document, { webSearch: true });
  document.querySelector('#aiMaxSearchRoundsSeg [data-rounds="1"]').click();
  sendMessage(document, '查资料');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');
  assert.strictEqual(calls.filter((c) => c.url.includes('bochaai.com')).length, 1, '最大搜索轮数设为 1 时仅搜 1 轮');

  // 验证携带历史条数只裁剪请求窗口，不破坏本地历史
  document.getElementById('aiHistoryLimit').value = '4';
  document.getElementById('aiHistoryLimit').dispatchEvent(new window.Event('change', { bubbles: true }));
  document.getElementById('aiWebSearch').checked = false;
  for (let i = 1; i <= 5; i++) {
    sendMessage(document, '第' + i + '条');
    await waitFor(() => document.getElementById('aiSend').textContent === '发送');
  }
  const lastChat = calls.filter((c) => c.url.includes('/chat/completions')).pop();
  const sentMsgs = JSON.parse(lastChat.opts.body).messages;
  assert.strictEqual(sentMsgs.length, 5, 'system + 最近 4 条历史 = 5 条');
  const savedHist = JSON.parse(window.localStorage.getItem('newtab.ai.history.v1'));
  assert.ok(savedHist.length > 6, '本地持久化历史不会被窗口参数误删');
});

function installWallpaperDB(window) {
  window.indexedDB = {
    open() {
      const request = {};
      const db = {
        objectStoreNames: { contains() { return true; } },
        transaction() {
          const tx = {
            objectStore() {
              return {
                get() {
                  const result = {};
                  queueMicrotask(() => {
                    result.result = undefined;
                    if (result.onsuccess) result.onsuccess({ target: result });
                  });
                  return result;
                }
              };
            }
          };
          Object.defineProperty(tx, 'oncomplete', { set(fn) { queueMicrotask(() => fn && fn()); } });
          Object.defineProperty(tx, 'onerror', { set() {} });
          return tx;
        }
      };
      queueMicrotask(() => {
        request.result = db;
        if (request.onsuccess) request.onsuccess({ target: request });
      });
      return request;
    }
  };
}

test('关闭「整页备份包含密钥」后导出备份自动脱敏密钥，恢复默认可清空并重置（T21）', async () => {
  const exportedTexts = [];
  const { window, document } = boot({});
  installWallpaperDB(window);
  window.URL.createObjectURL = (blob) => {
    blob.text().then((t) => exportedTexts.push(t));
    return 'blob:mock';
  };
  window.URL.revokeObjectURL = () => {};
  window.confirm = () => true;

  configureAI(document, { endpoint: 'https://api.deepseek.com', key: 'sk-secret-main', model: 'deepseek-flash', bochaKey: 'sk-secret-search' });
  document.getElementById('aiCustomHeaders').value = '{"Authorization":"Bearer bad","X-Keep":"1"}';
  document.getElementById('aiBackupIncludeKeys').checked = false;
  ['aiEndpoint', 'aiKey', 'aiModel', 'aiBochaKey', 'aiCustomHeaders', 'aiBackupIncludeKeys'].forEach((id) => {
    document.getElementById(id).dispatchEvent(new window.Event('change', { bubbles: true }));
  });

  document.getElementById('exportBtn').click();
  await waitFor(() => exportedTexts.length >= 1);

  const backup = JSON.parse(exportedTexts[0]);
  const exportedAi = JSON.parse(backup.data.ai.config);
  assert.strictEqual(exportedAi.endpoint, 'https://api.deepseek.com');
  assert.strictEqual(exportedAi.key, '', '模型主密钥应被脱敏');
  assert.strictEqual(exportedAi.bochaKey, '', '旧版博查密钥字段应被脱敏');
  assert.ok(exportedAi.profiles.every((p) => p.key === ''), '所有方案里的密钥应被脱敏');
  assert.deepStrictEqual(exportedAi.search.keys, {}, '搜索密钥袋应被清空');
  assert.strictEqual(JSON.parse(exportedAi.customHeaders)['X-Keep'], '1');
  assert.strictEqual(JSON.parse(exportedAi.customHeaders).Authorization, undefined, '敏感 Authorization 请求头应被剔除');

  // 独立导出 AI 配置同样脱敏
  document.getElementById('aiExportConfigBtn').click();
  await waitFor(() => exportedTexts.length >= 2);
  const standalone = JSON.parse(exportedTexts[1]);
  assert.strictEqual(standalone.app, 'Motuo-Tab-AI');
  assert.strictEqual(standalone.config.key, '');
  assert.deepStrictEqual(standalone.config.search.keys, {});

  // 恢复默认 AI 配置
  document.getElementById('aiResetConfigBtn').click();
  assert.strictEqual(document.getElementById('aiEndpoint').value, '');
  assert.strictEqual(document.getElementById('aiKey').value, '');
  assert.strictEqual(document.getElementById('aiBackupIncludeKeys').checked, true);
});

test('配置方案与提示词预设采用「单胶囊 + ··· 菜单 + 原地重命名」，内置预设受保护且 [hidden] 生效', () => {
  const { window, document } = boot({});
  assert.ok(HTML.includes('#aiConfigModal [hidden] { display: none !important; }'), '[hidden] 规则优先级必须高于 .ai-row-ctrl');

  // 默认状态下重命名框、菜单和恢复默认按钮都应隐藏，不重复显示名称
  assert.strictEqual(document.getElementById('aiProfileName').hidden, true);
  assert.strictEqual(document.getElementById('aiSystemPresetName').hidden, true);
  assert.strictEqual(document.getElementById('aiContextPresetName').hidden, true);
  assert.strictEqual(document.getElementById('aiContextPresetCtrl').hidden, true);
  assert.strictEqual(document.getElementById('aiProfileMenu').hidden, true);
  assert.strictEqual(document.getElementById('aiPromptResetBtn').hidden, true);

  // 打开配置方案「···」菜单并触发原地重命名
  document.getElementById('aiProfileMoreBtn').click();
  assert.strictEqual(document.getElementById('aiProfileMenu').hidden, false);
  document.getElementById('aiProfileRename').click();
  assert.strictEqual(document.getElementById('aiProfileMenu').hidden, true);
  assert.strictEqual(document.getElementById('aiProfileSelectWrap').hidden, true);
  const nameInp = document.getElementById('aiProfileName');
  assert.strictEqual(nameInp.hidden, false);
  nameInp.value = '主力方案';
  nameInp.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.strictEqual(nameInp.hidden, true);
  assert.strictEqual(document.getElementById('aiProfileSelectWrap').hidden, false);
  const sel = document.getElementById('aiProfileSelect');
  assert.strictEqual(sel.options[sel.selectedIndex].textContent, '主力方案');

  // 内置提示词预设禁止改名和删除；正文修改后才露出底部「恢复默认」
  assert.strictEqual(document.getElementById('aiSystemPresetRename').hidden, true);
  assert.strictEqual(document.getElementById('aiSystemPresetDel').hidden, true);
  const box = document.getElementById('aiSystemPrompt');
  const orig = box.value;
  box.value = orig + '\n补充指令';
  box.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.strictEqual(document.getElementById('aiPromptResetBtn').hidden, false);
  document.getElementById('aiPromptResetBtn').click();
  assert.strictEqual(box.value, orig);
  assert.strictEqual(document.getElementById('aiPromptResetBtn').hidden, true);
});

test('设置弹窗内全部下拉菜单采用自定义圆角浮层与勾选标志，Esc 仅关闭下拉不关闭弹窗', () => {
  const { window, document } = boot({});
  document.getElementById('aiConfigToggle').click();
  const modal = document.getElementById('aiConfigModal');
  const nativeSelects = Array.from(modal.querySelectorAll('select.ai-pill-select'));
  assert.ok(nativeSelects.length >= 6, '应增强弹窗内所有下拉控件');
  nativeSelects.forEach((sel) => {
    assert.ok(sel.classList.contains('ai-select-native'), sel.id + ' 应保留原生 select 但隐藏视觉样式');
    const trig = sel.parentNode.querySelector('.ai-select-trigger');
    assert.ok(trig, sel.id + ' 应生成自定义 .ai-select-trigger');
  });

  // 切换联网搜索服务：打开浮层 -> 校验全部选项与当前勾选 -> 选中智谱 -> 验证同步与条件字段显示
  const spSel = document.getElementById('aiSearchProvider');
  const spTrig = spSel.parentNode.querySelector('.ai-select-trigger');
  assert.ok(spTrig.textContent.includes('博查'));
  spTrig.click();

  const portal = document.getElementById('aiSelectPortalMenu');
  assert.strictEqual(portal.hidden, false);
  assert.ok(spTrig.classList.contains('open'));
  const opts = Array.from(portal.querySelectorAll('.ai-select-option'));
  assert.strictEqual(opts.length, spSel.options.length);
  const selectedOpt = opts.find((o) => o.classList.contains('selected'));
  assert.ok(selectedOpt && selectedOpt.querySelector('.ai-select-check'), '当前选中项应带有 SVG 对勾');

  const zhipuOpt = opts.find((o) => o.getAttribute('data-value') === 'zhipu');
  zhipuOpt.click();
  assert.strictEqual(spSel.value, 'zhipu');
  assert.ok(spTrig.textContent.includes('智谱'));
  assert.strictEqual(portal.hidden, true);
  assert.notStrictEqual(document.getElementById('zhipuEngineField').style.display, 'none');

  // Esc 关闭打开的下拉浮层时，不关闭设置弹窗本体
  const toTrig = document.getElementById('aiTimeoutSec').parentNode.querySelector('.ai-select-trigger');
  toTrig.click();
  assert.strictEqual(portal.hidden, false);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.strictEqual(portal.hidden, true);
  assert.ok(modal.classList.contains('open'), 'Esc 应只关闭下拉浮层，保持 AI 设置弹窗打开');
});
