// ============================================================================
// 一次性迁移工具：把旧版"单文件 HTML"拆分为 src/ 多文件源码
//   src/index.html          → 页面模板（引用 styles/main.css 与 scripts/*.js）
//   src/styles/main.css     → 原 <style> 中的全部 CSS
//   src/scripts/search.js   → IIFE 1 搜索模块
//   src/scripts/main.js     → IIFE 2 主模块（卡片/壁纸/AI/速记）
//   src/scripts/idle.js     → Idle 隐藏 UI 模块
// 用法：node scripts/split-source.js
// 幂等：重复执行会基于"当前的 src/index.html"重新拆分（会覆盖 src 下产物）
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const INDEX = path.join(SRC, 'index.html');

const file = fs.readFileSync(INDEX, 'utf8');

// ---------- 1) 抽取 CSS ----------
// 注意：头部 HTML 注释里也出现了 "<style>" 字样，必须锚定"标签独占一行"，
// 只匹配真正的 `<style>` 元素（其后紧跟换行），避免吞掉 <head>。
const cssMatch = file.match(/<style>\r?\n([\s\S]*?)\r?\n<\/style>/);
if (!cssMatch) throw new Error('未找到 <style> 块');
const css = cssMatch[1];
fs.mkdirSync(path.join(SRC, 'styles'), { recursive: true });
fs.writeFileSync(path.join(SRC, 'styles', 'main.css'), css + '\n');
console.log('✓ src/styles/main.css (' + css.split('\n').length + ' 行)');

// ---------- 2) 抽取脚本并按模块边界拆分 ----------
const scriptMatch = file.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('未找到 <script> 块');
const script = scriptMatch[1];

// 行首定位：返回 idx 所在行的起始位置（含该行）
function lineStart(text, idx) { return text.lastIndexOf('\n', idx - 1) + 1; }

const iSearch = lineStart(script, script.indexOf('IIFE 1: 搜索模块'));
const iMain = lineStart(script, script.indexOf('IIFE 2: 主模块'));
const iIdle = lineStart(script, script.indexOf('Idle 隐藏 UI'));

// 每个 IIFE 注释块都以 `/* ====...` 行开头，标记行（* IIFE x: ...）只是其中一行；
// 从标记行往前找最近的 `/*`，确保切出的文件以注释起始行开头，而不是裸的 `*` 行。
const startSearch = lineStart(script, script.lastIndexOf('/*', iSearch));
const startMain = lineStart(script, script.lastIndexOf('/*', iMain));

const searchJs = script.slice(startSearch, startMain).trim() + '\n';
const mainJs = script.slice(startMain, iIdle).trim() + '\n';
const idleJs = script.slice(iIdle).trim() + '\n';

fs.mkdirSync(path.join(SRC, 'scripts'), { recursive: true });
fs.writeFileSync(path.join(SRC, 'scripts', 'search.js'), searchJs);
fs.writeFileSync(path.join(SRC, 'scripts', 'main.js'), mainJs);
fs.writeFileSync(path.join(SRC, 'scripts', 'idle.js'), idleJs);
console.log('✓ src/scripts/search.js (' + searchJs.split('\n').length + ' 行)');
console.log('✓ src/scripts/main.js   (' + mainJs.split('\n').length + ' 行)');
console.log('✓ src/scripts/idle.js   (' + idleJs.split('\n').length + ' 行)');

// ---------- 3) 重写 src/index.html 为模板（外链 CSS/JS） ----------
const htmlTemplate = file
  // 内联 CSS → 外链（锚定独占一行的 <style> 标签）
  .replace(/<style>\r?\n[\s\S]*?\r?\n<\/style>/, '<link rel="stylesheet" href="styles/main.css" />')
  // 内联脚本 → 三个外链（顺序：search → main → idle）
  .replace(/<script>[\s\S]*?<\/script>/, [
    '<script src="scripts/search.js"></script>',
    '<script src="scripts/main.js"></script>',
    '<script src="scripts/idle.js"></script>'
  ].join('\n  '))
  // 在 <title> 后补 favicon
  .replace('</title>', '</title>\n  <link rel="icon" href="favicon.ico" />');

fs.writeFileSync(INDEX, htmlTemplate);
console.log('✓ src/index.html 已重写为模板');
