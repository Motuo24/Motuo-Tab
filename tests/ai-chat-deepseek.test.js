// v0.9.2 AI 侧边栏 DeepSeek 风格升级测试：多对话模式 / 提示文案 / 复制 / 重新回答 / 修改已发送消息
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

test('提示文案与按钮兼容性：底部提示、回答免责声明且不污染 .ai-msg-assistant', async () => {
  const { window, document } = boot({
    fetchStub() {
      return sseResponse([{ choices: [{ delta: { content: '这是一句干净的回答' } }] }]);
    }
  });
  openAI(document);
  configureAI(document);

  // #aiSend 兼容现有测试断言 textContent === '发送'
  assert.strictEqual(document.getElementById('aiSend').textContent, '发送');
  const footerDisc = document.querySelector('.ai-footer-disclaimer');
  assert.ok(footerDisc);
  assert.strictEqual(footerDisc.textContent.trim(), '内容由 AI 生成，请仔细甄别');

  sendMessage(document, '你好');
  await waitFor(() => document.getElementById('aiSend').textContent === '发送');

  const assistantBubbles = document.querySelectorAll('#aiMessages .ai-msg-assistant:not(.ai-msg-persist)');
  assert.strictEqual(assistantBubbles.length, 1);
  assert.strictEqual(assistantBubbles[0].textContent.trim(), '这是一句干净的回答');

  const msgDisc = document.querySelector('.ai-msg-group-assistant .ai-msg-disclaimer');
  assert.ok(msgDisc);
  assert.strictEqual(msgDisc.textContent.trim(), '本回答由 AI 生成，内容仅供参考，请仔细甄别');
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
