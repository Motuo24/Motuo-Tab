# Motuo-Tab

A browser New Tab replacement page: shortcut management, personalized wallpapers, an AI assistant, and a scratchpad.

[中文](README.md) · [English](README-en.md)

> All data is stored locally in your browser (LocalStorage / IndexedDB) — **no backend required**.
> The extension, single-file, and online versions behave identically: moving the file or using it online works the same.

---

## Features

- **Search**: Baidu / Bing / Google / custom engines (`%s` template); search history, suggestion dropdown, site-direct shortcuts (`zh`/`gh`/`bl`/`tb`/`db`)
- **Shortcuts**: add / edit / delete, drag-to-sort, drag-to-bottom-to-delete, context menu, automatic favicon fetching
- **Personalization**: image / solid-color wallpaper, blur amount, card opacity (image / text toggles independently)
- **AI assistant**: OpenAI-compatible streaming chat, deep thinking, web search (Bocha AI), manage cards in natural language with one-click undo
- **Scratchpad**: quick notes, auto-saved
- **Export / Import**: full backup (shortcuts + wallpaper + AI config & history + personalization)

## Installation

Currently supports Chromium-based browsers (Chrome / Edge, etc.). Firefox users can use the "Single-file HTML" method.

### Release download (recommended)

Download the latest extension package (`motuo-tab-extension.zip`) from [Releases](../../releases), unzip it, and install in Chrome / Edge:

1. Open `chrome://extensions` (Edge: `edge://extensions`)
2. Enable "Developer mode" in the top-right corner
3. Click "Load unpacked" and select the unzipped `extension` folder

New tabs will now show Motuo-Tab. (If published to a web store, you can also install it directly from there.)

### Single-file HTML (no installation)

Download [dist/newtab.html](dist/newtab.html) and double-click to use it. You can also set it as your new tab page:

- Edge: Settings → On startup → Open specific pages → add the file
- Chrome: needs an extension such as "New Tab Redirect" pointing to the file
- Other browsers (e.g. Firefox): just use the single file

### Online version (GitHub Pages)

Visit the online URL directly — no installation needed. Data still stays in your local browser (LocalStorage).

### Manual build (for developers)

```bash
npm install
npm run build
```

Artifacts: `dist/newtab.html` (single-file) and `dist/extension` (MV3 extension).

## Usage

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+E` | Focus mode (content fades out, search box centers) |
| `Ctrl+K` | Edit mode (drag to sort / drag to bottom to delete) |
| `Ctrl+A` | Open AI assistant |
| `Esc` | Close modals / menus |

### Site-direct search

Type "prefix + space + keyword" in the search box to search directly on a site:

| Prefix | Site |
|--------|------|
| `zh` | Zhihu |
| `gh` | GitHub |
| `bl` | Bilibili |
| `tb` | Taobao |
| `db` | Douban |

Example: `bl Node.js` → search Node.js on Bilibili.

### AI assistant

1. Click the `AI` button in the bottom-left corner to open the panel
2. Click `⚙` in the top-right to configure: API endpoint, key, model (OpenAI-compatible, e.g. DeepSeek)
3. Optional: enable "Web search" with a Bocha AI key; enable "Deep thinking" for model reasoning

Manage cards in natural language, e.g. "make GitHub green" or "move Zhihu to the front"; every operation can be undone.

### Data

- Export / Import: bottom-right menu → General settings, exports a full JSON backup
- All data stays local: `localStorage` (settings, shortcuts, AI history) and `IndexedDB` (image wallpaper); the full key list is documented in the header comment of `src/index.html`

## Development

```bash
npm install        # install dependencies
npm run build      # build artifacts to dist/ (single-file + extension)
npm test           # run tests (requires build first)
npm run gen:icons  # regenerate extension icons
```

## Directory structure

```
src/                  # source code
  index.html          # page template (external CSS/JS)
  styles/main.css     # styles
  scripts/search.js   # search module
  scripts/main.js     # main module (cards/wallpaper/AI/scratchpad/import-export)
  scripts/idle.js     # idle-hide UI module
  favicon.ico
scripts/              # build tooling
  build.js            # single-file + MV3 extension
  split-source.js     # legacy single-file → src/ migration tool
  gen-icons.js        # generate extension icons
tests/                # jsdom regression tests
dist/                 # build output (gitignored)
```

## GitHub Actions

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | push / PR | build + test |
| `pages.yml` | push main | deploy GitHub Pages |
| `release.yml` | tag `v*` | publish Release (newtab.html + extension zip) |

Release: `git tag v1.0.0 && git push origin v1.0.0`.

## License

[MIT](LICENSE) © 2026 Motuo24
