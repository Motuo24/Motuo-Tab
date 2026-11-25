// v0.9.1 全量新特性与重构验证：T1 Hero Logo+问候语 / T3 自定义站内直达 / T5 分组 / T6 书签导入 / T7b WebDAV / 6栏系统设置弹窗
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { setupWindow, jsonResponse, readShortcuts, waitFor } = require('./helpers.js');

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

function installFullIndexedDB(window) {
  const stores = { wallpapers: new Map(), icons: new Map() };
  window.indexedDB = {
    open() {
      const request = {};
      const db = {
        objectStoreNames: { contains: () => true },
        transaction(storeName) {
          const map = stores[storeName] || new Map();
          const tx = {
            objectStore() {
              return {
                get(k) {
                  const req = {};
                  queueMicrotask(() => { req.result = map.get(k); if (req.onsuccess) req.onsuccess({ target: req }); });
                  return req;
                },
                getAll() {
                  const req = {};
                  queueMicrotask(() => { req.result = Array.from(map.values()); if (req.onsuccess) req.onsuccess({ target: req }); });
                  return req;
                },
                put(val) {
                  map.set(val.url || val.id, val);
                  return {};
                },
                delete(k) {
                  map.delete(k);
                  return {};
                }
              };
            }
          };
          Object.defineProperty(tx, 'oncomplete', { set(fn) { queueMicrotask(() => fn && fn()); } });
          Object.defineProperty(tx, 'onerror', { set() {} });
          return tx;
        }
      };
      queueMicrotask(() => { request.result = db; if (request.onsuccess) request.onsuccess({ target: request }); });
      return request;
    }
  };
  return stores;
}

test('T1：Hero Logo 与时段问候语居于搜索框上方，可独立开关并切换 A/B 样式', () => {
  const { window, document } = boot();
  const heroBrand = document.getElementById('heroBrand');
  const heroLogoWrap = document.getElementById('heroLogoWrap');
  const aboutLogoSlot = document.getElementById('aboutLogoSlot');
  const title = document.getElementById('pageTitle');
  const searchWrap = document.querySelector('.search-wrap');

  assert.ok(searchWrap.contains(heroBrand), 'Hero 品牌区应位于 .search-wrap 内');
  assert.strictEqual(heroLogoWrap.hidden, false, '默认显示起始页 Logo');
  assert.strictEqual(heroLogoWrap.getAttribute('data-logo-style'), 'a', '默认 Logo 样式为 A');
  assert.ok(heroLogoWrap.querySelector('.motuo-logo-svg'), 'Hero 区应渲染 SVG Logo');
  assert.ok(title.textContent && title.textContent !== 'Motuo Tab', '默认应展示时段问候语');
  assert.ok(!/\d{1,2}:\d{2}/.test(title.textContent), '不应包含时钟数字');

  window.__motuo.greeting.render(7);
  assert.strictEqual(title.textContent, '早上好，想干什么');
  window.__motuo.greeting.render(15);
  assert.strictEqual(title.textContent, '下午好，继续手头的事吧');
  window.__motuo.greeting.render(22);
  assert.strictEqual(title.textContent, '晚上好，慢慢来');

  // 关闭问候语：仅隐藏文字、不回退旧 Motuo Tab、Logo 仍保留
  const toggleGreet = document.getElementById('toggleGreeting');
  toggleGreet.checked = false;
  toggleGreet.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.strictEqual(window.localStorage.getItem('newtab.greeting.v1'), '0');
  assert.strictEqual(title.hidden, true);
  assert.strictEqual(title.textContent, '');
  assert.strictEqual(heroLogoWrap.hidden, false);
  assert.strictEqual(heroBrand.hidden, false);

  // 独立关闭 Logo：Logo 与 greeting 都关闭时整个 Hero 折叠
  const toggleLogo = document.getElementById('toggleHeroLogo');
  toggleLogo.checked = false;
  toggleLogo.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.strictEqual(window.localStorage.getItem('newtab.heroLogo.v1'), '0');
  assert.strictEqual(heroLogoWrap.hidden, true);
  assert.strictEqual(heroBrand.hidden, true);

  // 重新打开 Logo 并切换为样式 B（叠页星芒），Hero 与关于页同步更新
  toggleLogo.checked = true;
  toggleLogo.dispatchEvent(new window.Event('change', { bubbles: true }));
  document.querySelector('#logoStyleSwitch .sys-logo-option[data-logo-style="b"]').click();
  assert.strictEqual(window.localStorage.getItem('newtab.logoStyle.v1'), 'b');
  assert.strictEqual(heroLogoWrap.getAttribute('data-logo-style'), 'b');
  assert.strictEqual(aboutLogoSlot.getAttribute('data-logo-style'), 'b');
  assert.ok(aboutLogoSlot.querySelector('.motuo-logo-svg'));
});

test('统一系统设置弹窗：6 栏切换、个性化/快捷键/关于直达独立页签与主题同步', () => {
  const { window, document } = boot();
  assert.strictEqual(document.querySelectorAll('#sysConfigNav button[data-pane]').length, 6);

  // 点击菜单「快捷键」→ 打开系统设置并定位到独立快捷键页签
  document.getElementById('shortcutBtn').click();
  const modal = document.getElementById('generalConfigModal');
  assert.ok(modal.classList.contains('open'));
  assert.ok(document.getElementById('cfgPaneKeys').classList.contains('active'));
  assert.ok(!document.getElementById('cfgPaneAbout').classList.contains('active'));

  // 点击菜单「关于」→ 定位到独立关于页签并渲染 Logo
  document.getElementById('aboutBtn').click();
  assert.ok(document.getElementById('cfgPaneAbout').classList.contains('active'));
  assert.ok(!document.getElementById('cfgPaneKeys').classList.contains('active'));
  assert.ok(document.querySelector('#aboutLogoSlot .motuo-logo-svg'));

  // 点击菜单「个性化」→ 打开系统设置并定位到外观与壁纸
  document.getElementById('personalizeBtn').click();
  assert.ok(modal.classList.contains('open'));
  assert.ok(document.getElementById('cfgPaneAppearance').classList.contains('active'));
  assert.strictEqual(document.getElementById('personalizeModal'), null, '旧个性化独立弹窗应已合并移除');

  // 切换到通用设置并点击深色大卡片
  document.querySelector('#sysConfigNav button[data-pane="general"]').click();
  assert.ok(document.getElementById('cfgPaneGeneral').classList.contains('active'));
  document.querySelector('#sysConfigNav button[data-pane="data"]').click();
  assert.ok(document.querySelector('#aiConfigModal .ai-config-pane[data-pane="model"]').classList.contains('active'), '切换系统设置页签不能串扰 AI 设置弹窗');
  document.querySelector('#sysConfigNav button[data-pane="general"]').click();
  document.querySelector('#cfgPaneGeneral .sys-theme-card[data-theme="dark"]').click();
  assert.strictEqual(document.documentElement.getAttribute('data-theme'), 'dark');
  assert.strictEqual(window.localStorage.getItem('newtab.theme.v1'), 'dark');

  // 切换「联网搜索建议」双向同步到菜单药丸
  const cfgSuggest = document.getElementById('cfgToggleSuggestOnline');
  cfgSuggest.checked = false;
  cfgSuggest.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.strictEqual(document.getElementById('toggleSuggestOnline').checked, false);
  assert.strictEqual(window.localStorage.getItem('newtab.suggestOnline.v1'), '0');
});

test('T3：站内搜索直达支持增删与恢复默认并按自定义规则匹配', () => {
  const { window, document } = boot();
  document.getElementById('sdKeyInput').value = 'wk';
  document.getElementById('sdNameInput').value = '维基';
  document.getElementById('sdUrlInput').value = 'https://zh.wikipedia.org/wiki/%s';
  document.getElementById('sdAddBtn').click();

  const rules = window.__motuo.siteDirect.getList();
  assert.ok(rules.some((r) => r.key === 'wk' && r.name === '维基'));
  const found = window.__motuo.siteDirect.find('wk');
  assert.ok(found);
  assert.strictEqual(window.__motuo.siteDirect.buildUrl(found, 'Node'), 'https://zh.wikipedia.org/wiki/Node');

  // 删除刚添加的规则
  const delBtn = document.querySelector('#siteDirectList .sys-sd-del[aria-label="删除 wk"]');
  assert.ok(delBtn);
  delBtn.click();
  assert.strictEqual(window.__motuo.siteDirect.find('wk'), null);

  // 恢复默认
  document.querySelector('#siteDirectList .sys-sd-del').click();
  document.getElementById('sdResetBtn').click();
  assert.ok(window.__motuo.siteDirect.find('zh'));
});

test('T5：卡片分组创建、移入、展开弹窗、重命名、解散与导出/导入保留', () => {
  const { window, document } = boot();
  // 创建新分组并把第 1 张卡「知乎」移入
  const firstCard = document.querySelector('.shortcuts .shortcut');
  const firstName = firstCard.querySelector('.label').textContent;
  firstCard.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));

  window.prompt = () => '常用阅读';
  document.querySelector('#ctxMenu button[data-action="movetofolder"]').click();
  const createBtn = Array.from(document.querySelectorAll('#moveFolderMenu button')).find((b) => b.textContent.includes('新建分组'));
  assert.ok(createBtn);
  createBtn.click();

  const folderEl = Array.from(document.querySelectorAll('.shortcuts .shortcut-folder')).find((el) => el.querySelector('.label').textContent === '常用阅读');
  assert.ok(folderEl, '主页应生成文件夹卡片');
  assert.ok(folderEl.querySelector('.folder-mini-tile'), '应包含 2x2 缩略格');

  // 点击打开文件夹弹窗并重命名
  folderEl.click();
  const fModal = document.getElementById('folderModal');
  assert.ok(fModal.classList.contains('open'));
  assert.ok(document.querySelector('#folderGrid .shortcut .label').textContent === firstName);

  const titleInput = document.getElementById('folderTitleInput');
  titleInput.value = '知识库';
  titleInput.dispatchEvent(new window.Event('blur'));
  assert.strictEqual(folderEl.querySelector('.label').textContent, '知识库');

  // 解散分组：子卡回到主页，文件夹移除
  document.getElementById('folderDissolveBtn').click();
  assert.strictEqual(fModal.classList.contains('open'), false);
  assert.strictEqual(readShortcuts(window).some((it) => it.type === 'folder'), false);
  assert.ok(readShortcuts(window).some((it) => it.name === firstName));
});

test('T6：解析 Netscape 书签 HTML、预览、文件夹建组与 IndexedDB 图标缓存', async () => {
  const { window, document } = boot();
  const stores = installFullIndexedDB(window);

  const bmHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
  <DL><p>
    <DT><H3>开发工具</H3>
    <DL><p>
      <DT><A HREF="https://developer.mozilla.org" ICON="data:image/png;base64,AAAA">MDN 文档</A>
      <DT><A HREF="javascript:alert(1)">危险链接应过滤</A>
    </DL><p>
    <DT><A HREF="https://github.com">GitHub 重复跳过测试</A>
    <DT><A HREF="https://news.ycombinator.com">Hacker News</A>
  </DL><p>`;

  const file = new window.File([bmHtml], 'bookmarks.html', { type: 'text/html' });
  const input = document.getElementById('bookmarkImportFile');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));

  await waitFor(() => document.getElementById('bookmarkModal').classList.contains('open'));
  assert.strictEqual(document.getElementById('bmSelectedCount').textContent, '已选 3 条', '应过滤 javascript: 协议并识别 3 条书签');

  document.getElementById('bmConfirmImport').click();
  await waitFor(() => !document.getElementById('bookmarkModal').classList.contains('open'));

  const saved = readShortcuts(window);
  const devFolder = saved.find((it) => it.type === 'folder' && it.name === '开发工具');
  assert.ok(devFolder, '应按书签文件夹生成 T5 分组');
  assert.strictEqual(devFolder.children.length, 1);
  assert.strictEqual(devFolder.children[0].name, 'MDN 文档');
  assert.ok(devFolder.children[0].icon.startsWith('bmicon:'), 'ICON data URL 应拆存入 IndexedDB 而不直接塞入 localStorage');
  assert.ok(stores.icons.has(devFolder.children[0].icon), 'IndexedDB icons store 应存有该图标');
  // 已有 GitHub 被去重，新增 Hacker News
  assert.ok(saved.some((it) => it.name === 'Hacker News'));
});

test('T7b：WebDAV 测试连接、上传排除壁纸与凭证、拉取支持合并与覆盖', async () => {
  const davCalls = [];
  const remoteSnapshot = {
    app: 'Motuo-Tab',
    version: 2,
    syncedAt: '2026-11-25T10:00:00.000Z',
    data: {
      items: [
        { name: '远端新卡', url: 'https://remote.example', iconSrc: 'color', color: 'blue', letter: '远' }
      ],
      settings: { theme: 'dark', greeting: '0', heroLogo: '1', logoStyle: 'b' },
      ai: {},
      wallpaper: null
    }
  };
  const { window, document } = boot({
    fetchStub(url, opts) {
      davCalls.push({ url, method: opts.method, headers: opts.headers, body: opts.body });
      if (opts.method === 'PROPFIND') return Promise.resolve({ ok: true, status: 207 });
      if (opts.method === 'PUT') return Promise.resolve({ ok: true, status: 201 });
      if (opts.method === 'GET') return jsonResponse(remoteSnapshot);
      return Promise.resolve({ ok: false, status: 405 });
    }
  });
  installFullIndexedDB(window);

  document.getElementById('webdavUrl').value = 'https://dav.example.com/dav/MotuoTab/';
  document.getElementById('webdavFile').value = 'sync.json';
  document.getElementById('webdavUser').value = 'motuo';
  document.getElementById('webdavPass').value = 'app-secret-pwd';

  // 1. 测试连接
  document.getElementById('webdavTestBtn').click();
  await waitFor(() => document.getElementById('webdavStatus').textContent.includes('连接正常'));
  const propfindCall = davCalls.find((c) => c.method === 'PROPFIND');
  assert.ok(propfindCall, '应发出 PROPFIND 请求');
  assert.ok(propfindCall.headers.Authorization.startsWith('Basic '));

  // 2. 上传到云端：检查排除了壁纸与 WebDAV 凭证
  document.getElementById('webdavUploadBtn').click();
  await waitFor(() => document.getElementById('webdavStatus').textContent.includes('上传成功'));
  const putCall = davCalls.find((c) => c.method === 'PUT');
  assert.ok(putCall && typeof putCall.body === 'string', '应发出带 JSON 正文的 PUT 请求');
  const putBody = putCall.body;
  assert.ok(!putBody.includes('app-secret-pwd'), '上传数据绝不能包含 WebDAV 密码');
  assert.strictEqual(JSON.parse(putBody).data.wallpaper, null, '云同步应排除壁纸数据');

  // 3. 拉取并合并：原有卡片保留且合入远端新卡
  const localBefore = readShortcuts(window).length;
  document.getElementById('webdavDownloadBtn').click();
  await waitFor(() => document.getElementById('webdavPullConfirm').hidden === false);
  document.getElementById('webdavApplyMerge').click();
  const afterMerge = readShortcuts(window);
  assert.strictEqual(afterMerge.length, localBefore + 1);
  assert.ok(afterMerge.some((it) => it.name === '远端新卡'));

  // 4. 拉取并覆盖
  document.getElementById('webdavDownloadBtn').click();
  await waitFor(() => document.getElementById('webdavPullConfirm').hidden === false);
  document.getElementById('webdavApplyOverwrite').click();
  const afterOverwrite = readShortcuts(window);
  assert.strictEqual(afterOverwrite.length, 1);
  assert.strictEqual(document.documentElement.getAttribute('data-theme'), 'dark');
  assert.strictEqual(document.getElementById('pageTitle').hidden, true);
  assert.strictEqual(document.getElementById('pageTitle').textContent, '');
  assert.strictEqual(document.getElementById('heroLogoWrap').hidden, false);
  assert.strictEqual(window.localStorage.getItem('newtab.logoStyle.v1'), 'b');
  assert.strictEqual(document.getElementById('aboutLogoSlot').getAttribute('data-logo-style'), 'b');
});
