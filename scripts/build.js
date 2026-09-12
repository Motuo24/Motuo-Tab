// ============================================================================
// 构建脚本：把 src/ 多文件源码打包成发行产物
//
//   npm run build
//
// 产物：
//   dist/newtab.html          单文件 HTML（双击即可用 / 手动设为浏览器新标签页）
//   dist/favicon.ico
//   dist/extension/           Chrome/Edge MV3 扩展目录（chrome://extensions 加载）
//     ├── manifest.json
//     ├── newtab.html         （引用外部 CSS/JS，符合 MV3 CSP：禁内联脚本）
//     ├── styles/main.css
//     ├── scripts/{search,main,idle}.js
//     ├── favicon.ico
//     └── icons/icon{16,32,48,128}.png
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// ---------- 产物 1：单文件 HTML ----------
let html = read(path.join(SRC, 'index.html'));

// 内联 CSS（锚定独占一行的 <link rel="stylesheet">）
html = html.replace(
  /<link\s+rel="stylesheet"\s+href="styles\/main\.css"\s*\/?>/i,
  () => '<style>\n' + read(path.join(SRC, 'styles', 'main.css')) + '\n</style>'
);

// 内联 JS（按脚本标签顺序逐一替换）
html = html.replace(
  /<script\s+src="scripts\/([^"]+)"\s*><\/script>/gi,
  (m, name) => '<script>\n' + read(path.join(SRC, 'scripts', name)) + '\n</script>'
);

// 单文件产物中，favicon 链接指向同目录 favicon.ico，保持不变
write(path.join(DIST, 'newtab.html'), html);
copy(path.join(SRC, 'favicon.ico'), path.join(DIST, 'favicon.ico'));
console.log('✓ dist/newtab.html（单文件，' + html.split('\n').length + ' 行）');

// ---------- 产物 2：MV3 扩展目录 ----------
// MV3 默认 CSP 禁止内联脚本，因此扩展页必须引用外部 JS。
// 直接把 src/ 原样拷贝（本就是外链结构），并补 manifest 与图标。
const EXT = path.join(DIST, 'extension');
const extHtml = read(path.join(SRC, 'index.html'))
  // 扩展页重命名为 newtab.html；favicon 用 ico（扩展内相对路径）
  .replace('href="favicon.ico"', 'href="favicon.ico"');

write(path.join(EXT, 'newtab.html'), extHtml);
copy(path.join(SRC, 'styles', 'main.css'), path.join(EXT, 'styles', 'main.css'));
['search.js', 'main.js', 'idle.js'].forEach((f) =>
  copy(path.join(SRC, 'scripts', f), path.join(EXT, 'scripts', f))
);
copy(path.join(SRC, 'favicon.ico'), path.join(EXT, 'favicon.ico'));

const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
const manifest = {
  manifest_version: 3,
  name: 'Motuo-Tab',
  version: pkg.version,
  description: pkg.description,
  author: 'Motuo24',
  homepage_url: 'https://pod.xr24.cn',
  // AI 助手需要跨域请求用户自填的模型接口，以及博查搜索 API。
  // 缺少 host_permissions 时，扩展页面的 fetch 会被 CORS 拦截（表现为请求挂起/超时）。
  host_permissions: ['<all_urls>'],
  chrome_url_overrides: { newtab: 'newtab.html' },
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png'
  }
};
write(path.join(EXT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('✓ dist/extension/manifest.json（MV3，newtab 覆盖页）');

// 图标由 scripts/gen-icons.js 生成（独立脚本，便于单独重跑）
// 这里仅提示；实际生成在 build 末尾调用
require('./gen-icons.js');
console.log('✓ dist/extension/icons/icon{16,32,48,128}.png');
console.log('\n构建完成。产物：');
console.log('  单文件 HTML ：dist/newtab.html');
console.log('  MV3 扩展    ：dist/extension/（chrome://extensions → 加载已解压的扩展程序）');
