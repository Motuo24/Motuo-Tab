// 回归测试：导入完整备份（v2）后必须保留卡片图标/颜色/emoji 字母，以及个性化透明配置
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { setupWindow, readShortcuts } = require('./helpers.js');

// 构造 v2 备份（模拟导出产物），包含白色背景 + emoji 字母卡片，并开启文字卡片透明
function makeBackup() {
  return {
    app: 'Motuo-Tab',
    version: 2,
    exportedAt: new Date().toISOString(),
    data: {
      items: [
        { name: 'TX工具网', url: 'https://www.xr24.cn', iconSrc: 'color', color: 'white', letter: '🛠️' },
        { name: '紫色卡', url: 'https://a.com', iconSrc: 'color', color: 'purple', letter: 'A' },
        { name: '知乎', url: 'https://www.zhihu.com', iconSrc: 'image', icon: 'https://www.zhihu.com/favicon.ico' },
        { name: '自动蓝', url: 'https://d.com', iconSrc: 'auto', color: 'blue' }
      ],
      settings: { toggleLtr: '1', alpha: '0.55', toggleImg: '1' },
      ai: {},
      wallpaper: null
    }
  };
}

// 触发导入（把备份写入 importFile 并派发 change）
function doImport(window, document, payload) {
  const file = new window.File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });
  const input = document.getElementById('importFile');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  window.alert = () => {};
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

test('导入后保留卡片的 iconSrc/color/emoji 字母 与透明配置', async (t) => {
  const { window, document } = setupWindow({});
  doImport(window, document, makeBackup());

  // 等待导入的同步写入完成
  await new Promise((r) => setTimeout(r, 300));

  const items = readShortcuts(window);
  const white = items.find((it) => it.name === 'TX工具网');
  assert.ok(white, '应存在白色+emoji 卡片');
  assert.strictEqual(white.iconSrc, 'color', 'iconSrc 应保留为 color');
  assert.strictEqual(white.color, 'white', 'color 应保留为 white');
  assert.strictEqual(white.letter, '🛠️', 'emoji 字母应保留');

  const purple = items.find((it) => it.name === '紫色卡');
  assert.strictEqual(purple.color, 'purple', '预设色 color 应保留');

  const image = items.find((it) => it.name === '知乎');
  assert.strictEqual(image.iconSrc, 'image', 'image 图标来源应保留');
  assert.ok(image.icon, 'image 图标 URL 应保留');

  // 透明配置应写回 localStorage
  assert.strictEqual(window.localStorage.getItem('newtab.toggleLtr.v1'), '1', '文字卡片透明开关应保留为开启');
  assert.strictEqual(window.localStorage.getItem('newtab.alpha.v1'), '0.55', '透明度值应保留');
});

// 用户实际备份的旧格式卡片：仅有 color/letter，没有 iconSrc 字段
test('导入旧格式（无 iconSrc）卡片时仍保留 color/letter', async (t) => {
  const { window, document } = setupWindow({});
  doImport(window, document, {
    app: 'Motuo-Tab',
    version: 2,
    data: {
      items: [
        { name: 'TX工具网', url: 'https://www.xr24.cn', color: 'white', letter: '🛠️' },
        { name: 'TX同学录', url: 'https://class.xr24.cn', color: 'white', letter: '🎓' },
        { name: '普通卡片', url: 'https://x.com' }
      ],
      settings: { toggleLtr: '1', alpha: '0.7' },
      ai: {},
      wallpaper: null
    }
  });

  await new Promise((r) => setTimeout(r, 300));

  const items = readShortcuts(window);
  const w1 = items.find((it) => it.name === 'TX工具网');
  assert.ok(w1, '应存在 TX工具网 卡片');
  assert.strictEqual(w1.iconSrc, 'color', '旧格式卡片应回填 iconSrc=color');
  assert.strictEqual(w1.color, 'white', 'color 应保留');
  assert.strictEqual(w1.letter, '🛠️', 'emoji 字母应保留');

  const w2 = items.find((it) => it.name === 'TX同学录');
  assert.strictEqual(w2.color, 'white', '第二张白色卡片 color 应保留');
  assert.strictEqual(w2.letter, '🎓', '第二张卡片 emoji 字母应保留');

  // 无任何图标字段的卡片：保持普通（不强行补色）
  const plain = items.find((it) => it.name === '普通卡片');
  assert.strictEqual(plain.iconSrc, undefined, '无颜色字段的卡片不应补 iconSrc');
});
