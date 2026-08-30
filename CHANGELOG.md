# 更新日志

本项目的版本历史。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-08-30

首个发行版。从单文件 HTML 重构为多文件源码 + 构建工具，产出单文件 HTML 与 MV3 浏览器扩展两种发行形态。

### 新增

- 聚合搜索：百度 / 必应 / 谷歌 / 自定义搜索引擎（`%s` 模板）、搜索历史、建议下拉、站内搜索直达（zh/gh/bl/tb/db）
- 快捷方式：卡片增删改、编辑模式拖拽排序、拖到底部删除、右键菜单、favicon 自动抓取、任意色值卡片（hex/rgb）
- 个性化：图片壁纸（IndexedDB）、纯色壁纸、模糊度、卡片透明度（图标 / 文字独立开关）、一键恢复默认
- AI 助手：OpenAI 兼容流式对话、深度思考、联网搜索（博查 AI）、自然语言管理卡片、一键撤销（纯回滚）
- 速记本：随手记录，输入即自动保存
- 完整备份导出 / 导入（快捷方式 + 壁纸 + AI 配置与历史 + 个性化配置）
- 专注模式 / 编辑模式 / Idle 自动隐藏 UI 快捷键

### 工程化

- 源码拆分：`src/index.html` + `styles/main.css` + `scripts/{search,main,idle}.js`
- 构建脚本 `scripts/build.js`：产出单文件 `dist/newtab.html` 与 MV3 扩展目录
- 图标生成 `scripts/gen-icons.js`：纯 Node 生成扩展 PNG 图标
- 测试迁移：jsdom 回归测试改为读取构建产物，CI 保证产物可测
- GitHub Actions：CI / GitHub Pages / Release 三套工作流

### 安全

- 移除 HTML 中硬编码的博查 AI API 密钥（改为空默认值，由用户在设置中填写）

### 修复

- AI 历史重渲染后，含操作记录的旧消息恢复「撤销」按钮，且可正常点击（事件委托）
