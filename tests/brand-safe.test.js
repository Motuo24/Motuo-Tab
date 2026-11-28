// 回归测试：品牌避嫌模式（临时隐藏指定卡片/分组、关闭后恢复原样、右键菜单切换、一键勾选与备份保留）
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { setupWindow, readShortcuts } = require('./helpers');

const active = [];
afterEach(() => {
  while (active.length) {
    try { active.pop().close(); } catch (e) {}
  }
});

function boot(opts) {
  const ctx = setupWindow(opts || {});
  active.push(ctx.window);
  return ctx;
}

test('品牌避嫌模式：开启后临时隐藏勾选卡片与分组，关闭即无损恢复原样', () => {
  const { window, document } = boot();
  const initialShortcuts = readShortcuts(window);
  assert.ok(initialShortcuts.length >= 5);

  // 打开系统设置 -> 通用设置，勾选「知乎」与「GitHub」避嫌隐藏
  document.getElementById('generalConfigBtn').click();
  const zhChip = Array.from(document.querySelectorAll('#brandSafeGrid .brand-safe-chip'))
    .find((el) => el.textContent.includes('知乎'));
  const ghChip = Array.from(document.querySelectorAll('#brandSafeGrid .brand-safe-chip'))
    .find((el) => el.textContent.includes('GitHub'));
  assert.ok(zhChip && ghChip, '设置页应列出知乎与 GitHub 避嫌勾选芯片');

  zhChip.click();
  ghChip.click();

  // 未开启总开关前，卡片仍正常可见
  assert.strictEqual(document.body.classList.contains('brand-safe-mode'), false);
  const zhCard = Array.from(document.querySelectorAll('.shortcuts .shortcut'))
    .find((el) => el.querySelector('.label').textContent === '知乎');
  const workCard = Array.from(document.querySelectorAll('.shortcuts .shortcut'))
    .find((el) => el.querySelector('.label').textContent === '工作台');
  assert.ok(zhCard.classList.contains('brand-safe-hidden'));
  assert.strictEqual(workCard.classList.contains('brand-safe-hidden'), false);

  // 开启避嫌模式开关：body 挂上 brand-safe-mode，原卡片数据毫发无损
  const toggle = document.getElementById('toggleBrandSafe');
  toggle.checked = true;
  toggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.strictEqual(document.body.classList.contains('brand-safe-mode'), true);
  assert.ok(document.getElementById('brandSafeSummary').textContent.includes('已选 2 项'));
  assert.ok(document.getElementById('brandSafeSummary').textContent.includes('已生效'));
  assert.deepStrictEqual(readShortcuts(window), initialShortcuts, '开启避嫌模式不得删除或修改原始卡片数据');

  // 关闭避嫌模式开关：恢复原样
  toggle.checked = false;
  toggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.strictEqual(document.body.classList.contains('brand-safe-mode'), false);
  assert.ok(document.getElementById('brandSafeSummary').textContent.includes('当前未开启'));
  assert.deepStrictEqual(readShortcuts(window), initialShortcuts);
});

test('品牌避嫌模式：右键菜单可直接切换避嫌隐藏，且一键勾选外网图标与清空生效', () => {
  const seedCards = [
    { name: 'TX工具网', url: 'https://www.xr24.cn', iconSrc: 'color', color: 'white', letter: '🛠️' },
    { name: '内网NAS', url: 'http://192.168.1.2:5666', iconSrc: 'color', color: 'blue', letter: 'N' },
    { name: 'GitHub', url: 'https://github.com', iconSrc: 'image', icon: 'https://github.com/favicon.ico' },
    {
      type: 'folder',
      id: 'fld_demo',
      name: '常用分组',
      children: [
        { name: '哔哩哔哩', url: 'https://www.bilibili.com', iconSrc: 'image', icon: 'https://www.bilibili.com/favicon.ico' }
      ]
    }
  ];
  const { window, document } = boot({
    seed: { 'newtab.shortcuts.v1': JSON.stringify(seedCards) }
  });

  // 右键点击「常用分组」-> 设为避嫌隐藏
  const folderCard = document.querySelector('.shortcuts .shortcut-folder');
  folderCard.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
  const ctxToggleBtn = document.querySelector('#ctxMenu [data-action="brandSafeToggle"]');
  assert.strictEqual(ctxToggleBtn.textContent, '避嫌隐藏');
  ctxToggleBtn.click();
  assert.ok(folderCard.classList.contains('brand-safe-hidden'), '右键应能直接将分组设为避嫌隐藏');

  // 再次右键显示「取消避嫌隐藏」
  folderCard.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
  assert.strictEqual(ctxToggleBtn.textContent, '取消避嫌隐藏');
  ctxToggleBtn.click();
  assert.strictEqual(folderCard.classList.contains('brand-safe-hidden'), false);

  // 一键勾选外网图标：应勾选 GitHub 与 哔哩哔哩，跳过 TX工具网（xr24.cn）和 内网NAS（192.168.1.2）
  document.getElementById('brandSafeSelectExtBtn').click();
  const keys = window.__motuo.brandSafe.getHidden();
  assert.ok(keys.includes('name:GitHub'));
  assert.ok(keys.includes('name:哔哩哔哩'));
  assert.strictEqual(keys.includes('name:TX工具网'), false);
  assert.strictEqual(keys.includes('name:内网NAS'), false);

  // 清空勾选
  document.getElementById('brandSafeClearBtn').click();
  assert.strictEqual(window.__motuo.brandSafe.getHidden().length, 0);
});
