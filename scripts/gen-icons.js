// ============================================================================
// 扩展图标生成器：纯 Node 实现（无第三方依赖），输出品牌色圆角方块 + 白色 "M"
//   npm run gen:icons   →   dist/extension/icons/icon{16,32,48,128}.png
// 说明：首次发行的占位品牌图标；若后续有正式 logo，直接替换这些 PNG 即可。
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist', 'extension', 'icons');

// ---------- 最小 PNG 编码器（RGBA 8bit） ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // 位深
  ihdr[9] = 6;  // 颜色类型 RGBA
  ihdr[10] = 0; // 压缩
  ihdr[11] = 0; // 滤波
  ihdr[12] = 0; // 隔行
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 绘制图标 ----------
const BG = [0x24, 0x68, 0xF2, 255];   // 品牌蓝 #2468f2
const FG = [255, 255, 255, 255];      // 白色 M

function inRoundedRect(x, y, size, r) {
  const min = r, max = size - 1 - r;
  const px = Math.min(Math.max(x, min), max);
  const py = Math.min(Math.max(y, min), max);
  return (x - px) * (x - px) + (y - py) * (y - py) <= r * r;
}

function stampCircle(rgba, size, cx, cy, rad) {
  const r0 = Math.ceil(rad);
  for (let dy = -r0; dy <= r0; dy++) {
    for (let dx = -r0; dx <= r0; dx++) {
      if (dx * dx + dy * dy > rad * rad) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const i = (y * size + x) * 4;
      if (rgba[i + 3] === 0) continue; // 只画在背景内部
      rgba[i] = FG[0]; rgba[i + 1] = FG[1]; rgba[i + 2] = FG[2]; rgba[i + 3] = FG[3];
    }
  }
}

function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const r = Math.max(3, size * 0.22); // 圆角半径

  // 背景：品牌蓝圆角方块
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRoundedRect(x, y, size, r)) continue;
      const i = (y * size + x) * 4;
      rgba[i] = BG[0]; rgba[i + 1] = BG[1]; rgba[i + 2] = BG[2]; rgba[i + 3] = BG[3];
    }
  }

  // 前景：白色 "M"（三条粗线段）
  const cx = (size - 1) / 2;
  const w = size * 0.44;            // M 总宽
  const top = size * 0.30;
  const bottom = size * 0.70;
  const mid = size * 0.50;
  const stroke = Math.max(3, size * 0.075);
  const segs = [
    [cx - w / 2, top, cx - w / 2, bottom],
    [cx - w / 2, top, cx, mid],
    [cx, mid, cx + w / 2, top],
    [cx + w / 2, top, cx + w / 2, bottom]
  ];
  for (const [x0, y0, x1, y1] of segs) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len * 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      stampCircle(rgba, size, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), stroke / 2);
    }
  }
  return rgba;
}

// 仅在作为独立脚本运行时执行（被 build.js require 时静默）
if (require.main === module || process.argv[1] && process.argv[1].endsWith('build.js')) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  [16, 32, 48, 128].forEach((size) => {
    fs.writeFileSync(path.join(OUT_DIR, `icon${size}.png`), encodePNG(size, size, makeIcon(size)));
  });
  if (process.argv[1] && process.argv[1].endsWith('gen-icons.js')) {
    console.log('✓ dist/extension/icons/icon{16,32,48,128}.png');
  }
}

module.exports = { makeIcon, encodePNG };
