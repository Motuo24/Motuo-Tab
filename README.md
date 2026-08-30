# Motuo-Tab

浏览器新标签页（New Tab）替换页：快捷方式管理、个性化壁纸、AI 助手、速记本。

[中文](README.md) · [English](README-en.md)

> 数据全部保存在浏览器本地（LocalStorage / IndexedDB），**不依赖任何后端**。
> 无论使用扩展版、本地单文件版还是在线版，功能完全一致：更换文件位置、或直接在线使用，均正常工作。

---

## 功能

- **搜索**：百度 / 必应 / 谷歌 / 自定义引擎（`%s` 模板）；搜索历史、建议下拉、站内直达（`zh`/`gh`/`bl`/`tb`/`db`）
- **快捷方式**：增删改、拖拽排序、拖到底部删除、右键菜单、自动抓取 favicon
- **个性化**：图片 / 纯色壁纸、模糊度、卡片透明度（图标 / 文字独立开关）
- **AI 助手**：OpenAI 兼容接口流式对话，深度思考、联网搜索（博查 AI），自然语言管理卡片并一键撤销
- **速记本**：随手记录，自动保存
- **导出 / 导入**：完整备份（快捷方式 + 壁纸 + AI 配置与历史 + 个性化配置）

## 安装

目前仅支持 Chromium 内核浏览器（Chrome / Edge 等）。Firefox 用户请用「单文件 HTML」方式。

### 发行版下载（推荐）

从 [Releases](../../releases) 下载最新版扩展压缩包（`motuo-tab-extension.zip`），解压后在 Chrome / Edge 中安装：

1. 打开 `chrome://extensions`（Edge 用 `edge://extensions`）
2. 开启右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选择解压后的 `extension` 文件夹

之后新开标签页即是 Motuo-Tab。（若已上架应用商店，也可直接从商店搜索安装。）

### 单文件 HTML（免安装）

直接下载 [dist/newtab.html](dist/newtab.html)，双击打开即用；也可设为浏览器新标签页：

- Edge：设置 → 启动时 → 打开特定页面 → 添加该文件
- Chrome：配合「New Tab Redirect」等扩展指向该文件
- 其他浏览器（如 Firefox）：直接用单文件即可

### 在线版（GitHub Pages）

直接访问线上地址即可使用，无需下载安装；数据仍存于本机浏览器（LocalStorage）。

### 手动构建（开发者）

```bash
npm install
npm run build
```

产物：`dist/newtab.html`（单文件）与 `dist/extension`（MV3 扩展目录）。

## 使用

### 快捷键

| 快捷键 | 作用 |
|--------|------|
| `Ctrl+E` | 专注模式（内容淡出、搜索框居中） |
| `Ctrl+K` | 编辑模式（拖拽排序 / 拖到底部删除） |
| `Ctrl+A` | 打开 AI 助手 |
| `Esc` | 关闭弹窗 / 菜单 |

### 站内搜索直达

搜索框输入「前缀 + 空格 + 关键词」，直接跳到对应站点搜索：

| 前缀 | 站点 |
|------|------|
| `zh` | 知乎 |
| `gh` | GitHub |
| `bl` | B站 |
| `tb` | 淘宝 |
| `db` | 豆瓣 |

例：`bl Node.js` → 在 B 站搜索 Node.js。

### AI 助手

1. 点左下角 `AI` 按钮打开面板
2. 点右上角 `⚙` 配置：API 地址、Key、模型（兼容 OpenAI 协议，如 DeepSeek）
3. 可选：「联网搜索」需填入博查 AI 密钥；「深度思考」启用模型推理

支持自然语言操作卡片，例如「把 GitHub 改成绿色」「把知乎移到最前面」，操作后可一键撤销。

### 数据

- 导出 / 导入：右下角菜单 → 通用配置，导出完整 JSON 备份
- 数据全部存本地：`localStorage`（配置、快捷方式、AI 历史）与 `IndexedDB`（图片壁纸）；完整键位清单见 `src/index.html` 头部注释

## 开发

```bash
npm install        # 安装依赖
npm run build      # 构建产物到 dist/（单文件 + 扩展目录）
npm test           # 运行测试（需先 build）
npm run gen:icons  # 重新生成扩展图标
```

## 目录结构

```
src/                  # 源码
  index.html          # 页面模板（外链 CSS/JS）
  styles/main.css     # 样式
  scripts/search.js   # 搜索模块
  scripts/main.js     # 主模块（卡片/壁纸/AI/速记/导入导出）
  scripts/idle.js     # Idle 隐藏 UI
  favicon.ico
scripts/              # 构建工具
  build.js            # 单文件 + MV3 扩展
  split-source.js     # 旧单文件 → src/ 迁移工具
  gen-icons.js        # 生成扩展图标
tests/                # jsdom 回归测试
dist/                 # 构建产物（gitignore）
```

## GitHub Actions

| 工作流 | 触发 | 作用 |
|--------|------|------|
| `ci.yml` | push / PR | 构建 + 测试 |
| `pages.yml` | push main | 部署 GitHub Pages |
| `release.yml` | tag `v*` | 发布 Release（newtab.html + 扩展 zip） |

发布版本：`git tag v1.0.0 && git push origin v1.0.0`。

## 上架商店（可选）

- **Edge Add-ons**（免费）：打包 `dist/extension` 上传至 https://partner.microsoft.com
- **Chrome Web Store**（一次性 $5 注册费）：上传至 https://chrome.google.com/webstore/devconsole

## 许可证

[MIT](LICENSE) © 2026 Motuo24
