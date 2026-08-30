# Motuo-Tab

简洁高效的浏览器新标签页（New Tab）替换页：快捷方式管理、个性化壁纸、AI 助手、速记本。

> 开发者：Motuo24 · 博客 [pod.xr24.cn](https://pod.xr24.cn)

---

## 功能特性

- **聚合搜索**：百度 / 必应 / 谷歌 + 自定义搜索引擎，支持 `%s` 模板、搜索历史、建议下拉、站内直达（`zh 知乎` / `gh GitHub` / `bl B站` / `tb 淘宝` / `db 豆瓣`）
- **快捷方式**：卡片 CRUD、编辑模式拖拽排序、拖到底部删除、右键菜单、自动抓取 favicon
- **个性化**：图片壁纸（IndexedDB 存储）、纯色壁纸、模糊度、卡片透明度（图标/文字独立开关）
- **AI 助手**：兼容 OpenAI 协议流式对话，深度思考、联网搜索（博查 AI），支持自然语言增删改排卡片并一键撤销
- **速记本**：随手记录，输入即自动保存
- **数据导出 / 导入**：完整备份（快捷方式 + 壁纸 + AI 配置与历史 + 个性化配置）
- **快捷键**：`Ctrl+E` 专注模式 · `Ctrl+K` 编辑模式 · `Ctrl+A` 打开 AI · `Esc` 关闭弹窗

## 安装方式

三种方式任选其一：

### 1. 浏览器扩展（推荐，Chrome / Edge）

1. 运行 `npm run build`，产物在 `dist/extension/`
2. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）
3. 开启右上角「开发者模式」→「加载已解压的扩展程序」→ 选择 `dist/extension` 目录

之后新开标签页即是 Motuo-Tab。

### 2. 单文件 HTML（本地 / 手动设置）

1. 运行 `npm run build`，得到 `dist/newtab.html`
2. **双击打开**即可直接使用；或按浏览器设置设为启动页 / 新标签页：
   - Edge：设置 → 启动时 → 打开特定页面 → 添加本地文件
   - Chrome：配合 "New Tab Redirect" 等扩展指向本地文件

### 3. GitHub Pages 在线体验

把仓库发布到 GitHub 后，启用 Pages（见下方「GitHub Actions」），即可在线直接使用。

## 开发

```bash
npm install        # 安装依赖
npm run build      # 构建产物到 dist/（单文件 + 扩展目录）
npm test           # 运行测试（需先 build）
npm run gen:icons  # 重新生成扩展图标
```

> 注意：`dist/` 已加入 `.gitignore`，测试读取的是构建产物 `dist/newtab.html`，请先 `npm run build` 再 `npm test`。

## 目录结构

```
├── src/                    # 唯一真源码
│   ├── index.html          # 页面模板（外链 CSS/JS）
│   ├── styles/main.css     # 全部样式
│   ├── scripts/search.js   # 搜索模块（引擎/历史/建议/站内直达）
│   ├── scripts/main.js     # 主模块（卡片 CRUD/壁纸/AI/速记/导入导出）
│   ├── scripts/idle.js     # Idle 隐藏 UI 模块
│   └── favicon.ico
├── scripts/
│   ├── build.js            # 构建：单文件 HTML + MV3 扩展目录
│   ├── split-source.js     # 一次性迁移：旧单文件 → src/ 多文件
│   └── gen-icons.js        # 纯 Node 生成扩展 PNG 图标
├── tests/                  # jsdom 交互回归测试
├── dist/                   # 构建产物（.gitignore）
└── .github/workflows/      # CI / Pages / Release
```

## 本地数据（存储键一览）

数据全部存储在浏览器本地，不会上传：

- `localStorage`：`newtab.engine.v1`、`newtab.shortcuts.v1`（含 `.bak` 备份）、`newtab.ai.config.v1`、`newtab.ai.history.v1`、`newtab.solidColor.v1`、`newtab.blur.v1`、`newtab.alpha.v1`、`newtab.toggleImg.v1`、`newtab.toggleLtr.v1`、`newtab.scratchpad.v1`、`newtab.searchHistory.v1`、`newtab.sitedirect.v1` 等
- `IndexedDB`：`MotuoTabDB` → objectStore `wallpapers`（图片壁纸）

完整键位清单见 [src/index.html](src/index.html) 头部注释。

## GitHub Actions

| 工作流 | 触发 | 作用 |
|--------|------|------|
| `ci.yml` | push / PR | `npm ci` → `npm run build` → `npm test` |
| `pages.yml` | push main / 手动 | 构建并把 `dist/` 部署到 GitHub Pages |
| `release.yml` | 打 tag `v*` | 构建、测试、打包扩展 zip，发布 Release 附件 |

启用 Pages：仓库 Settings → Pages → Source 选择 **GitHub Actions**。

发布 Release：打 tag `git tag v1.0.0 && git push origin v1.0.0`，工作流自动产出 `newtab.html` 与扩展 zip。

## 上架应用商店（可选）

1. **Edge Add-ons**（免费）：打包 `dist/extension` 为 zip 后上传 [partner.microsoft.com](https://partner.microsoft.com)
2. **Chrome Web Store**（一次性 $5 开发者注册费）：上传至 [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)

商店版建议先验证扩展在真实浏览器中加载正常（见「安装方式 1」）。

## 许可证

[MIT](LICENSE) © 2026 Motuo24
