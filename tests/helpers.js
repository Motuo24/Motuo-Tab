// 测试公共设施：JSDOM 加载构建产物、fetch stub、SSE 流模拟、常用操作
// 注意：先 `npm run build` 生成 dist/newtab.html，再运行测试（CI 已按此顺序）
'use strict';

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'dist', 'newtab.html'), 'utf8');

// 构造 OpenAI 兼容的 SSE 流式响应（与真实接口的 data: 行格式一致）
function sseResponse(chunks) {
  const encoder = new TextEncoder();
  const data = chunks
    .map((c) => 'data: ' + JSON.stringify(c) + '\n\n')
    .join('') + 'data: [DONE]\n\n';
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(data));
      controller.close();
    }
  });
  return Promise.resolve({ ok: true, status: 200, body: stream });
}

function jsonResponse(obj) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(obj) });
}

// 启动一个页面实例
// options.seed: 预置 localStorage（模拟"退出页面重进"后的持久化状态）
// options.fetchStub(url, opts, calls): 请求 stub，calls 收集所有请求
function setupWindow(options = {}) {
  const { fetchStub, seed } = options;
  const calls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://localhost/',
    pretendToBeVisual: true,
    beforeParse(window) {
      // jsdom 未实现 AbortSignal.timeout，补充最小实现
      if (!window.AbortSignal.timeout) {
        window.AbortSignal.timeout = function (ms) {
          const c = new AbortController();
          setTimeout(() => c.abort(), ms);
          return c.signal;
        };
      }
      if (seed) {
        Object.keys(seed).forEach((k) => {
          try { window.localStorage.setItem(k, seed[k]); } catch (e) { /* ignore */ }
        });
      }
      window.fetch = function (url, opts) {
        calls.push({ url: String(url), opts: opts || {} });
        if (fetchStub) return fetchStub(String(url), opts, calls);
        return Promise.reject(new Error('no fetch stub for ' + url));
      };
    }
  });
  return { dom, window: dom.window, document: dom.window.document, calls };
}

// 轮询等待条件成立（页面异步流程用）
function waitFor(fn, timeout = 5000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function tick() {
      let ok = false;
      try { ok = fn(); } catch (e) { return reject(e); }
      if (ok) return resolve(true);
      if (Date.now() - start > timeout) return reject(new Error('waitFor timeout'));
      setTimeout(tick, 15);
    })();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ===== AI 面板操作 =====
function openAI(doc) { doc.getElementById('aiFab').click(); }
function closeAI(doc) { doc.getElementById('aiClose').click(); }

function configureAI(doc, cfg = {}) {
  doc.getElementById('aiEndpoint').value = cfg.endpoint || 'https://api.example.com/v1';
  doc.getElementById('aiKey').value = cfg.key || 'sk-test';
  doc.getElementById('aiModel').value = cfg.model || 'deepseek-chat';
  doc.getElementById('aiWebSearch').checked = !!cfg.webSearch;
  doc.getElementById('aiBochaKey').value = cfg.bochaKey || 'sk-bocha-test';
}

function sendMessage(doc, text) {
  doc.getElementById('aiInput').value = text;
  doc.getElementById('aiSend').click();
}

// 读取当前快捷方式列表（localStorage 主键）
function readShortcuts(window) {
  const raw = window.localStorage.getItem('newtab.shortcuts.v1');
  return raw ? JSON.parse(raw) : [];
}

module.exports = {
  HTML, sseResponse, jsonResponse, setupWindow, waitFor, sleep,
  openAI, closeAI, configureAI, sendMessage, readShortcuts
};
