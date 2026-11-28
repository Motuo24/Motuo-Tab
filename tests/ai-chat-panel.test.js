// v0.9.2 AI 侧边栏升级测试：多对话模式 / 提示文案 / 思考折叠 / 操作撤销栏 / 消息操作
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  sseResponse, setupWindow, waitFor,
  openAI, configureAI, sendMessage
} = require('./helpers');

const active = [];
afterEach(() => {
  while (active.length) {
    try { active.pop().close(); } catch (e) {}
  }
});

function boot(opts) {
  const ctx = setupWindow(opts || {});
  active.push(ctx.window);
  ctx.window.alert = () => {};
  ctx.window.confirm = () => true;
  return ctx;
}

test('多对话模式：旧历史自动迁移、开启新对话、切换/重命名/删除及空会话防重复', async () => {
  const legacySeed = {
    'newtab.ai.history.v1': JSON.stringify([
      { role: 'system', content: 'sys' },
      { role: 'user', content: '第一轮旧问题' },
      { role: 'assistant', content: '第一轮旧回答' }
    ])
  };
  let seq = 0;
  const { window, document } = boot({
    seed: legacySeed,
    fetchStub(url) {
      if (!String(url).includes('/chat/completions')) return Promise.resolve({ ok: false, status: 404 });
      seq++;
      return sseResponse([{ choices: [{ delta: { content: '新会话回复 #' + seq } }] }]);
    }
  });
  openAI(document);
  configureAI(document);

  // 旧历史已自动迁移成首个会话并展示
  const sessions1 = window.__motuo.aiSessions.list();
  assert.strictEqual(sessions1.length, 1);
  assert.ok(sessions1[0].title.includes('第一轮旧问题'));
  assert.ok(document.getElementById('aiMessages').textContent.includes('第一轮旧回答'));

  // 顶部栏与抽屉新建新对话
  document.getElementById('aiNewChatBtn').click();
  const s2Id = window.__motuo.aiSessions.activeId();
  assert.notStrictEqual(s2Id, sessions1[0].id);
  assert.strictEqual(document.querySelectorAll('#aiMessages .ai-msg-group').length, 0, '新对话不应携带旧会话气泡');

  // 空对话再次点新建，不堆砌多个空白会话
  document.getElementById('aiNewChatBtn').click();
  assert.strictEqual(window.__motuo.aiSessions.list().length, 2);

  // 在第二段会话里发送消息
  sendMessage(document, '第二会话的问题');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');
  assert.ok(document.getElementById('aiMessages').textContent.includes('新会话回复 #1'));
  assert.strictEqual(document.getElementById('aiHeaderTitleText').textContent, '第二会话的问题');

  // 打开抽屉并切换回第一段旧对话
  document.getElementById('aiSessionsToggle').click();
  const drawer = document.getElementById('aiSessionsDrawer');
  assert.ok(drawer.classList.contains('open'));
  const targetBtn = document.querySelector(`.ai-session-item[data-session-id="${sessions1[0].id}"] [data-act="select"]`);
  assert.ok(targetBtn);
  targetBtn.click();
  assert.strictEqual(window.__motuo.aiSessions.activeId(), sessions1[0].id);
  assert.ok(!drawer.classList.contains('open'), '切换对话后应自动收起抽屉');
  assert.ok(document.getElementById('aiMessages').textContent.includes('第一轮旧回答'));
  assert.ok(!document.getElementById('aiMessages').textContent.includes('新会话回复 #1'));

  // 重命名 & 删除会话
  window.prompt = () => '自定义标题A';
  document.getElementById('aiSessionsToggle').click();
  document.querySelector(`.ai-session-item[data-session-id="${sessions1[0].id}"] [data-act="rename"]`).click();
  assert.strictEqual(document.getElementById('aiHeaderTitleText').textContent, '自定义标题A');

  document.querySelector(`.ai-session-item[data-session-id="${s2Id}"] [data-act="delete"]`).click();
  assert.strictEqual(window.__motuo.aiSessions.list().length, 1);

  // 删光最后一条后仍会自动创建一个空新对话
  document.querySelector(`.ai-session-item[data-session-id="${sessions1[0].id}"] [data-act="delete"]`).click();
  assert.strictEqual(window.__motuo.aiSessions.list().length, 1);
  assert.strictEqual(document.querySelectorAll('#aiMessages .ai-msg-group').length, 0);
});

test('提示文案、思考折叠、操作栏内嵌撤销与按钮兼容性', async () => {
  const { window, document } = boot({
    fetchStub(url) {
      if (!String(url).includes('/chat/completions')) return Promise.resolve({ ok: false, status: 404 });
      return sseResponse([{
        choices: [{
          delta: {
            reasoning_content: '逐步推理分析用户意图',
            content: '已为您添加。\n<ops>{"add":[{"name":"谷歌","url":"https://www.google.com","iconSrc":"auto","color":"blue"}]}</ops>'
          }
        }]
      }]);
    }
  });
  openAI(document);
  configureAI(document, { deepSearch: true });

  // #aiSend 兼容现有测试断言 textContent === '发送'
  assert.strictEqual(document.getElementById('aiSend').textContent, '发送');
  const footerDisc = document.querySelector('.ai-footer-disclaimer');
  assert.ok(footerDisc);
  assert.strictEqual(footerDisc.textContent.trim(), 'AI 生成内容仅供参考，请核实重要信息');

  sendMessage(document, '帮我添加谷歌');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');

  // 深度思考折叠胶囊：完成后显示用时并默认收起，可点击展开/关闭
  const thinking = document.querySelector('#aiMessages .ai-thinking');
  const thinkHeader = thinking.querySelector('.ai-thinking-header');
  assert.ok(/已思考（用时 \d+ 秒）/.test(thinkHeader.textContent));
  assert.strictEqual(thinking.classList.contains('open'), false);
  assert.strictEqual(thinkHeader.getAttribute('aria-expanded'), 'false');
  thinkHeader.click();
  assert.strictEqual(thinking.classList.contains('open'), true);
  assert.strictEqual(thinkHeader.getAttribute('aria-expanded'), 'true');
  thinkHeader.click();
  assert.strictEqual(thinking.classList.contains('open'), false);

  // 操作芯片与撤销按钮合并在同一个 .ai-tool-calls 栏内
  const opsBar = document.querySelector('#aiMessages .ai-tool-calls');
  assert.ok(opsBar, '应生成操作栏 .ai-tool-calls');
  assert.ok(opsBar.querySelector('.ai-tool-call.add'), '操作栏内应包含添加芯片');
  const undoBtn = opsBar.querySelector('.ai-undo-btn');
  assert.ok(undoBtn, '撤销按钮应放入 .ai-tool-calls 同排展示');

  // 回复下方免责文案
  const msgDisc = document.querySelector('.ai-msg-group-assistant .ai-msg-disclaimer');
  assert.ok(msgDisc);
  assert.strictEqual(msgDisc.textContent.trim(), '以上内容由 AI 生成，仅供参考');

  // 切换回来重渲染历史：思考标题为「思考过程」，撤销仍在 .ai-tool-calls 内
  document.getElementById('aiNewChatBtn').click();
  const list = window.__motuo.aiSessions.list();
  window.__motuo.aiSessions.switchTo(list[1].id);
  const histThinkTitle = document.querySelector('#aiMessages .ai-thinking-title');
  assert.strictEqual(histThinkTitle.textContent, '思考过程');
  assert.ok(document.querySelector('#aiMessages .ai-tool-calls .ai-undo-btn'));
});

test('消息操作：复制（过滤思考与 ops）、重新回答、原地修改已发送消息并重发分支', async () => {
  let reqCount = 0;
  const seenUserBodies = [];
  const { window, document } = boot({
    fetchStub(url, opts) {
      if (!String(url).includes('/chat/completions')) return Promise.resolve({ ok: false, status: 404 });
      reqCount++;
      const parsed = JSON.parse(opts.body);
      const lastUser = parsed.messages.filter((m) => m.role === 'user').pop();
      seenUserBodies.push(lastUser ? lastUser.content : '');
      if (reqCount === 1) {
        return sseResponse([{
          choices: [{
            delta: {
              reasoning_content: '内部思考细节',
              content: '第一版回答内容'
            }
          }]
        }]);
      }
      if (reqCount === 2) {
        return sseResponse([{ choices: [{ delta: { content: '重新生成的新回答' } }] }]);
      }
      return sseResponse([{ choices: [{ delta: { content: '修改问题后的新回答' } }] }]);
    }
  });
  let copiedText = '';
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText(txt) {
        copiedText = txt;
        return Promise.resolve();
      }
    }
  });

  openAI(document);
  configureAI(document, { deepSearch: true });

  // 1. 首次发送并复制（应过滤掉 <think>）
  sendMessage(document, '最初的问题');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');
  document.querySelector('.ai-msg-group-assistant .ai-act-copy').click();
  await waitFor(() => copiedText !== '');
  assert.strictEqual(copiedText, '第一版回答内容');

  // 2. 点击「重新回答」：保留原用户提问，重新生成回复替换旧版
  document.querySelector('.ai-msg-group-assistant .ai-act-regen').click();
  await waitFor(() => reqCount === 2 && document.getElementById('aiSend').textContent === '发送');
  const bubblesAfterRegen = document.querySelectorAll('#aiMessages .ai-msg-assistant:not(.ai-msg-persist)');
  assert.strictEqual(bubblesAfterRegen.length, 1);
  assert.ok(bubblesAfterRegen[0].textContent.includes('重新生成的新回答'));

  // 3. 点击用户消息下方「修改消息」，先取消一次，再打开提交修改并重发
  document.querySelector('.ai-msg-group-user .ai-act-edit').click();
  assert.ok(document.querySelector('.ai-edit-box'));
  document.querySelector('.ai-edit-cancel').click();
  assert.strictEqual(document.querySelector('.ai-edit-box'), null);

  document.querySelector('.ai-msg-group-user .ai-act-edit').click();
  const editTa = document.querySelector('.ai-edit-input');
  editTa.value = '改写后的精准提问';
  document.querySelector('.ai-edit-save').click();

  await waitFor(() => reqCount === 3 && document.getElementById('aiSend').textContent === '发送');
  assert.ok(seenUserBodies[2].endsWith('改写后的精准提问'));
  assert.strictEqual(document.querySelector('.ai-msg-user').textContent.trim(), '改写后的精准提问');
  assert.ok(document.querySelector('.ai-msg-assistant:not(.ai-msg-persist)').textContent.includes('修改问题后的新回答'));
  assert.strictEqual(document.getElementById('aiHeaderTitleText').textContent, '改写后的精准提问');
});

test('修复误显撤销按钮与精简顶栏：纯文本/思考提及 <ops> 或空 ops 不出现撤销，且无顶栏清空按钮', async () => {
  const { window, document } = boot({
    fetchStub(url) {
      if (!String(url).includes('/chat/completions')) return Promise.resolve({ ok: false, status: 404 });
      return sseResponse([{
        choices: [{
          delta: {
            reasoning_content: '思考过程提到了 <ops> 标签，但并不需要执行操作。',
            content: '普通回答正文，示例说明不要随意输出 <ops>。\n<ops>{"add":[],"remove":[]}</ops>'
          }
        }]
      }]);
    }
  });
  openAI(document);
  configureAI(document, { deepSearch: true });

  // 顶栏已去除独立删除/清空按钮
  assert.strictEqual(document.getElementById('aiClear'), null, '侧边栏顶栏不应再显示删除/清空对话按钮');

  sendMessage(document, '介绍一下卡片能力');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');
  assert.strictEqual(document.querySelectorAll('#aiMessages .ai-undo-btn').length, 0, '未实际改卡片不应显示撤销按钮');

  // 切走再切回重渲染历史，仍然不能误渲染撤销按钮
  const s1Id = window.__motuo.aiSessions.activeId();
  document.getElementById('aiNewChatBtn').click();
  window.__motuo.aiSessions.switchTo(s1Id);
  assert.strictEqual(document.querySelectorAll('#aiMessages .ai-undo-btn').length, 0, '历史重渲染后也不应误显撤销按钮');
});

test('模型自动生成对话标题与单独标题提示词设置：首轮完成后自动更新且不覆盖手动改名', async () => {
  const chatCalls = [];
  const { window, document } = boot({
    fetchStub(url, opts) {
      if (!String(url).includes('/chat/completions')) return Promise.resolve({ ok: false, status: 404 });
      const body = JSON.parse(opts.body);
      chatCalls.push(body);
      if (body.stream === false) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            choices: [{ message: { content: '《高效开发书签汇总》' } }]
          })
        });
      }
      return sseResponse([{ choices: [{ delta: { content: '推荐几个常用开发工具站给你参考。' } }] }]);
    }
  });

  // 打开 AI 设置 -> 提示词 -> 对话标题，测试自定义与恢复默认
  openAI(document);
  document.getElementById('aiConfigToggle').click();
  document.querySelector('#aiPromptLayerSeg [data-prompt-layer="title"]').click();
  const titlePromptEl = document.getElementById('aiTitlePrompt');
  const autoTitleEl = document.getElementById('aiAutoTitle');
  assert.strictEqual(autoTitleEl.checked, true);
  assert.strictEqual(titlePromptEl.hidden, false);

  const defaultPrompt = titlePromptEl.value;
  titlePromptEl.value = '自定义标题提示词：提炼8字内短标题';
  titlePromptEl.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.strictEqual(document.getElementById('aiPromptResetBtn').hidden, false);
  document.getElementById('aiPromptResetBtn').click();
  assert.strictEqual(titlePromptEl.value, defaultPrompt);

  // 设置自定义提示词并保存
  titlePromptEl.value = '自定义标题提示词：请总结成中文短标题';
  titlePromptEl.dispatchEvent(new window.Event('change', { bubbles: true }));

  configureAI(document, { autoTitle: true });
  sendMessage(document, '帮我整理几个后端开发常用的网站，越简洁越好');

  await waitFor(() => chatCalls.length === 2 && document.getElementById('aiHeaderTitleText').textContent === '高效开发书签汇总');
  assert.strictEqual(chatCalls[1].stream, false);
  assert.strictEqual(chatCalls[1].messages[0].content, '自定义标题提示词：请总结成中文短标题');
  assert.ok(document.querySelector('.ai-session-item.active .ai-session-select').textContent === '高效开发书签汇总');

  // 手动重命名后再次对话，不再覆盖自定义标题
  const sid = window.__motuo.aiSessions.activeId();
  window.prompt = () => '我的专属对话';
  window.__motuo.aiSessions.rename(sid);
  assert.strictEqual(document.getElementById('aiHeaderTitleText').textContent, '我的专属对话');

  sendMessage(document, '再来一个数据库站点');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(chatCalls.length, 3, '已有手动标题后不应重复触发自动命名');
  assert.strictEqual(document.getElementById('aiHeaderTitleText').textContent, '我的专属对话');
});

test('P0-P2：环境前缀提供完整卡片只读字段与分组计数，并向模型回传 ops 回执与远程图标可达性探测', async () => {
  const bigBase64Icon = 'data:image/png;base64,' + 'A'.repeat(256);
  const seedCards = [
    { name: 'RO音乐下载', url: 'http://192.168.1.90:23330/', iconSrc: 'auto', color: 'blue' },
    { name: '本地图卡', url: 'https://local.example/', iconSrc: 'image', icon: bigBase64Icon },
    {
      type: 'folder',
      id: 'fld_tx',
      name: 'TX网站',
      children: [
        { name: 'TX工具网', url: 'https://www.xr24.cn', iconSrc: 'color', color: 'white', letter: '🛠️' },
        { name: 'TX同学录', url: 'https://class.xr24.cn', iconSrc: 'color', color: 'sky', letter: '🎓' }
      ]
    }
  ];

  const chatPayloads = [];
  let chatSeq = 0;
  const { window, document } = boot({
    seed: {
      'newtab.shortcuts.v1': JSON.stringify(seedCards),
      'newtab.shortcuts.v1.bak': JSON.stringify(seedCards)
    },
    fetchStub(url, opts) {
      const u = String(url);
      if (u.includes('/chat/completions')) {
        const body = JSON.parse(opts.body);
        if (body.stream === false) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ choices: [{ message: { content: '图标调整' } }] }) });
        }
        chatSeq++;
        chatPayloads.push(body);
        if (chatSeq === 1) {
          return sseResponse([{
            choices: [{
              delta: {
                content: '已更换音符图标。\n<ops>{"update":[{"name":"RO音乐下载","iconSrc":"https://cdn.example/music.svg"}]}</ops>'
              }
            }]
          }]);
        }
        if (chatSeq === 2) {
          return sseResponse([{
            choices: [{
              delta: {
                content: '已换坏链做验证。\n<ops>{"update":[{"name":"TX工具网","iconSrc":"image","icon":"https://cdn.example/missing.png"}]}</ops>'
              }
            }]
          }]);
        }
        return sseResponse([{ choices: [{ delta: { content: '确认完毕。' } }] }]);
      }
      if (u === 'https://cdn.example/music.svg') {
        const svg = '<svg viewBox="0 0 24 24"><path fill="#2468f2" d="M9 18V5l12-2v13"/></svg>';
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'image/svg+xml' : null) },
          blob: () => Promise.resolve(new window.Blob([svg], { type: 'image/svg+xml' }))
        });
      }
      if (u === 'https://cdn.example/missing.png') {
        return Promise.resolve({ ok: false, status: 404 });
      }
      return Promise.reject(new Error('unexpected ' + u));
    }
  });

  openAI(document);
  configureAI(document, { autoTitle: false });

  // 第 1 轮：校验发给模型的上下文包含 P0+P2 全部只读字段，且不泄漏冗长 base64
  sendMessage(document, '帮我把 RO音乐下载 换成音符图标');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');

  const firstMsgs = chatPayloads[0].messages;
  const sysText = firstMsgs.find((m) => m.role === 'system').content;
  const ctxUserText = firstMsgs.filter((m) => m.role === 'user').pop().content;

  assert.ok(sysText.includes('通用助手') || sysText.includes('Motuo-Tab'));
  assert.ok(ctxUserText.includes('主表共 3 项：2 张独立卡片 + 1 个分组；分组内共 2 张卡片，全部快捷方式合计 4 张'), 'P2 分组计数口径必须明确');
  assert.ok(ctxUserText.includes('#1 名称：RO音乐下载') && ctxUserText.includes('iconSrc：auto') && ctxUserText.includes('iconResolved：auto-pending'), '应透传 RO音乐下载 的完整字段与实时状态');
  assert.ok(ctxUserText.includes('[本地图片 data:image/png]') && !ctxUserText.includes('AAAA'), '本地图片应展示脱敏摘要而非爆出 base64');
  assert.ok(ctxUserText.includes('id：fld_tx') && ctxUserText.includes('#3.1 名称：TX工具网') && ctxUserText.includes('letter：🛠️'), '分组与组内子卡字段应完整暴露');
  assert.ok(ctxUserText.includes('iconSrc="image" 配合 icon="https://..."'), 'ops 契约应明确 iconSrc 取值语义');

  // 校验兼容规范化：iconSrc 传入直链自动转为 iconSrc="image" + icon="..."
  const listAfter1 = JSON.parse(window.localStorage.getItem('newtab.shortcuts.v1'));
  const roCard = listAfter1.find((x) => x.name === 'RO音乐下载');
  assert.strictEqual(roCard.iconSrc, 'image');
  assert.strictEqual(roCard.icon, 'https://cdn.example/music.svg');

  // 等待第 1 轮异步图标可达性探测写回历史回执
  await waitFor(() => {
    const h = JSON.parse(window.localStorage.getItem('newtab.ai.history.v1'));
    const a = h.filter((m) => m.role === 'assistant')[0];
    return a && a.opsReceipt && Array.isArray(a.opsReceipt.iconChecks) && a.opsReceipt.iconChecks.length === 1;
  });

  // 第 2 轮：传入 404 坏图到分组内卡片，验证 (a) 上一轮回执已随历史回传模型，(b) 支持分组内更新，(c) 404 图标展示失败芯片并记入回执
  sendMessage(document, '把 TX工具网 换成另一个图试试');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');
  await waitFor(() => document.querySelectorAll('#aiMessages .ai-tool-call.fail').length >= 1);

  const secondMsgs = chatPayloads[1].messages;
  const prevAssistantSent = secondMsgs.find((m) => m.role === 'assistant');
  assert.ok(prevAssistantSent && prevAssistantSent.content.includes('[操作回执：'), '下一轮应携带上一轮结构化操作回执');
  assert.ok(prevAssistantSent.content.includes('RO音乐下载.iconSrc: auto -> image'), '回执应含精准 from -> to 变更记录');
  assert.ok(prevAssistantSent.content.includes('reachable=true'), '回执应含远程图标可达性结果');

  const listAfter2 = JSON.parse(window.localStorage.getItem('newtab.shortcuts.v1'));
  const txFolder = listAfter2.find((x) => x.type === 'folder' && x.id === 'fld_tx');
  assert.strictEqual(txFolder.children[0].iconSrc, 'image');
  assert.strictEqual(txFolder.children[0].icon, 'https://cdn.example/missing.png');

  const failChip = document.querySelector('#aiMessages .ai-tool-call.fail');
  assert.ok(failChip && failChip.textContent.includes('图标不可达') && failChip.textContent.includes('HTTP 404'), '404 图标应显示不可达警告芯片');
});
