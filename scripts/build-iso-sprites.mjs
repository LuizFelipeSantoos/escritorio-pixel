// Gera a spritesheet isométrica original do escritório. Cada célula é 80×56.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const CW = 80, CH = 56, COLS = 8, ROWS = 3;
const W = CW * COLS, H = CH * ROWS;
const rgba = Buffer.alloc(W * H * 4);

const hex = (c) => {
  const n = parseInt(c.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
function plot(x, y, color, a = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 4;
  const [r, g, b] = hex(color);
  const s = a / 255;
  rgba[i] = Math.round(rgba[i] * (1 - s) + r * s);
  rgba[i + 1] = Math.round(rgba[i + 1] * (1 - s) + g * s);
  rgba[i + 2] = Math.round(rgba[i + 2] * (1 - s) + b * s);
  rgba[i + 3] = Math.min(255, rgba[i + 3] + a);
}
function diamond(cx, cy, hw, hh, color) {
  for (let y = -hh; y <= hh; y++) {
    const span = Math.round(hw * (1 - Math.abs(y) / (hh + 0.01)));
    for (let x = -span; x <= span; x++) plot(cx + x, cy + y, color);
  }
  for (let y = -hh; y <= hh; y++) {
    const span = Math.round(hw * (1 - Math.abs(y) / (hh + 0.01)));
    plot(cx - span, cy + y, '#1a140e', 90);
    plot(cx + span, cy + y, '#1a140e', 90);
  }
}
function disc(cx, cy, r, color) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
    if (x * x + y * y <= r * r + r) plot(cx + x, cy + y, color);
}
function line(x0, y0, x1, y1, color) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) plot(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, color);
}

function origin(i) {
  return { x: (i % COLS) * CW, y: Math.floor(i / COLS) * CH };
}

function screen(cx, top, theme) {
  for (let y = 0; y < 12; y++) for (let x = 0; x < 22; x++) plot(cx - 11 + x, top + y, x === 0 || y === 0 || x === 21 || y === 11 ? '#10151c' : theme.bezel);
  for (let y = 1; y < 11; y++) for (let x = 1; x < 21; x++) plot(cx - 11 + x, top + y, theme.screen);
  theme.draw(cx - 9, top + 2);
  for (let x = 0; x < 7; x++) plot(cx - 8 + x, top + 2, '#ffffff', 120);
  line(cx, top + 12, cx, top + 16, '#8d95a1');
  plot(cx - 4, top + 16, '#8d95a1'); plot(cx + 4, top + 16, '#8d95a1');
}

const screens = {
  leads(x, y) {
    const bars = [6, 10, 4, 8, 12];
    bars.forEach((h, i) => { for (let k = 0; k < h; k++) plot(x + 2 + i * 3, y + 8 - k, i % 2 ? '#d7ecff' : '#7ec8ff'); });
  },
  term(x, y) {
    [12, 8, 14, 6, 10].forEach((w, i) => { for (let k = 0; k < w; k++) plot(x + 1 + k, y + i * 2, '#7dff9a'); });
    plot(x + 16, y, '#ffb020');
  },
  tools(x, y) {
    ['#7dffb0', '#ffe08a', '#8eb6ff', '#ff8ea0'].forEach((c, i) => {
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) plot(x + 1 + (i % 4) * 4, y + 2 + dy, c);
    });
  },
  code(x, y) {
    const cols = ['#e7b0ff', '#ffffff', '#9ad0ff', '#c9a0ff'];
    [11, 7, 13, 5, 9].forEach((w, i) => { for (let k = 0; k < w; k++) plot(x + 1 + k, y + i * 2, cols[i % cols.length]); });
  },
  chart(x, y) {
    [3, 5, 4, 8, 6].forEach((h, i) => { for (let k = 0; k < h; k++) plot(x + 2 + i * 3, y + 8 - k, '#ffd27a'); });
  },
};

function desk(i, theme) {
  const o = origin(i);
  const cx = o.x + 40, base = o.y + 50;
  for (let x = -26; x <= 26; x++) plot(cx + x, base + 2, '#000000', 50);
  for (const lx of [-24, -18, 18, 24]) for (let y = base - 10; y <= base; y++) plot(cx + lx, y, theme.leg);
  for (let y = 0; y < 7; y++) for (let x = -26; x <= 26; x++) plot(cx + x, base - 12 + y, y < 1 ? theme.trim : theme.edge);
  plot(cx - 12, base - 8, '#f7f1e6'); plot(cx - 11, base - 8, '#f7f1e6');
  plot(cx + 10, base - 8, '#f7f1e6'); plot(cx + 11, base - 8, '#f7f1e6');
  diamond(cx, base - 16, 28, 7, theme.top);
  for (let k = 0; k < 8; k++) plot(cx - 10 + k * 2, base - 16, '#cfd4dc');
  plot(cx + 12, base - 17, '#eceff4'); plot(cx + 13, base - 16, '#b7bec8');
  screen(cx, base - 36, theme);
  if (theme.mug) { plot(cx - 20, base - 20, '#f4f4f4'); plot(cx - 20, base - 21, '#f4f4f4'); plot(cx - 19, base - 20, theme.mug); }
}

desk(0, { top: '#d5deee', edge: '#8ea0b8', trim: '#f4f7fb', leg: '#5e6b80', bezel: '#16304a', screen: '#1d4e86', draw: screens.leads, mug: '#7ec8ff' });
desk(1, { top: '#6e5138', edge: '#4a3424', trim: '#8a6848', leg: '#2c2118', bezel: '#142018', screen: '#0e2418', draw: screens.term });
desk(2, { top: '#d7e2d4', edge: '#6d8a72', trim: '#f3f7f1', leg: '#3d5344', bezel: '#163024', screen: '#1c4634', draw: screens.tools });
desk(3, { top: '#2a2440', edge: '#1a1630', trim: '#3a3260', leg: '#12101c', bezel: '#1a1030', screen: '#241444', draw: screens.code });
desk(4, { top: '#e7c48a', edge: '#a67a45', trim: '#f3ddb0', leg: '#6b4528', bezel: '#2a241c', screen: '#1a3358', draw: screens.chart, mug: '#c0392b' });

function meet(i) {
  const o = origin(i);
  const cx = o.x + 40, base = o.y + 48;
  for (let x = -30; x <= 30; x++) plot(cx + x, base + 2, '#000000', 45);
  for (const lx of [-26, 26]) for (let y = base - 8; y <= base; y++) { plot(cx + lx, y, '#6b5138'); plot(cx + lx + 1, y, '#6b5138'); }
  diamond(cx, base - 10, 32, 10, '#d9c4a4');
  for (let k = 0; k < 5; k++) plot(cx - 4 + k, base - 12, '#f7f4ee');
  plot(cx + 6, base - 11, '#3d7ec4');
  plot(cx - 8, base - 9, '#c24b4b');
}
meet(5);

function counter(i) {
  const o = origin(i);
  const cx = o.x + 40, base = o.y + 48;
  for (let y = 0; y < 10; y++) for (let x = -28; x <= 28; x++) plot(cx + x, base - y, y > 7 ? '#f3e2c4' : '#c9aa7e');
  for (let x = -8; x <= 8; x++) plot(cx + x, base - 12, '#d5e4ea');
  plot(cx, base - 16, '#9aabb8'); plot(cx, base - 15, '#9aabb8');
  for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) plot(cx - 24 + x, base - 16 + y, '#2c3038');
  plot(cx - 22, base - 14, '#7ec8ff');
  plot(cx - 20, base - 11, '#f4f4f4');
}
counter(6);

function sofa(i, color, cushion) {
  const o = origin(i);
  const cx = o.x + 40, base = o.y + 46;
  for (let x = -22; x <= 22; x++) plot(cx + x, base + 1, '#000000', 40);
  for (let y = 0; y < 8; y++) for (let x = -24; x <= 24; x++) plot(cx + x, base - y, color);
  for (let y = 0; y < 6; y++) for (let x = -20; x <= 20; x++) plot(cx + x, base - 10 + y, cushion);
  for (const arm of [-22, 18]) for (let y = 0; y < 8; y++) for (let x = 0; x < 5; x++) plot(cx + arm + x, base - 8 + y, color);
  plot(cx - 8, base - 8, '#ffffff', 80); plot(cx + 4, base - 8, '#ffffff', 80);
}
sofa(7, '#3a4c78', '#516494');

function chair(i) {
  const o = origin(i);
  const cx = o.x + 40, base = o.y + 48;
  for (const [dx, dy] of [[-6, 2], [6, 2], [0, 4], [-3, -1], [3, -1]]) plot(cx + dx, base + dy, '#2a2e36');
  for (let y = base - 8; y <= base; y++) plot(cx, y, '#4a515c');
  diamond(cx, base - 10, 7, 3, '#5c6778');
  for (let y = 0; y < 10; y++) for (let x = -5; x <= 5; x++) plot(cx + x, base - 22 + y, '#3e4756');
  for (let x = -4; x <= 4; x++) plot(cx + x, base - 21, '#7d8ba0');
}
chair(8);

function plant(i, pot, leaf, light) {
  const o = origin(i);
  const cx = o.x + 40, base = o.y + 50;
  for (let x = -5; x <= 5; x++) plot(cx + x, base, '#000000', 40);
  for (let y = 0; y < 7; y++) for (let x = -4 + Math.floor(y / 3); x <= 4 - Math.floor(y / 3); x++) plot(cx + x, base - y, pot);
  for (let x = -5; x <= 5; x++) plot(cx + x, base - 7, '#e7c4a0');
  disc(cx - 4, base - 14, 4, leaf);
  disc(cx + 4, base - 15, 4, light);
  disc(cx, base - 18, 4, leaf);
  plot(cx - 1, base - 19, '#eaffe4');
}
plant(9, '#a15a34', '#2f8a45', '#67c56e');
plant(10, '#7a4a3a', '#1f6b3a', '#3aaa58');

function shelf(i) {
  const o = origin(i);
  const cx = o.x + 40, base = o.y + 50;
  for (let y = 0; y < 28; y++) for (let x = -16; x <= 16; x++) plot(cx + x, base - y, '#5c3a24');
  for (let x = -15; x <= 15; x++) { plot(cx + x, base - 27, '#8a5a38'); plot(cx + x, base - 16, '#8a5a38'); plot(cx + x, base - 6, '#8a5a38'); }
  const books = ['#c24b4b', '#3d7ec4', '#e2c14a', '#2f8a4e', '#8a5ad0', '#d07a3a', '#f4f4f4', '#1a1a1a'];
  books.forEach((c, n) => {
    const h = 6 + (n % 3);
    const x = cx - 14 + n * 3;
    const y0 = n < 5 ? base - 26 : base - 15;
    for (let y = 0; y < h; y++) plot(x, y0 + y, c);
  });
}
shelf(11);

function cabinet(i) {
  const o = origin(i);
  const cx = o.x + 40, base = o.y + 50;
  for (let y = 0; y < 24; y++) for (let x = -12; x <= 12; x++) plot(cx + x, base - y, '#7a5434');
  for (let y = 2; y < 20; y++) for (let x = 1; x < 10; x++) plot(cx - 11 + x, base - y, '#a47b54');
  for (let y = 2; y < 20; y++) for (let x = 1; x < 10; x++) plot(cx + 1 + x, base - y, '#8d6844');
  plot(cx - 2, base - 12, '#f4efe6'); plot(cx + 2, base - 12, '#f4efe6');
  for (let x = -12; x <= 12; x++) plot(cx + x, base - 23, '#c4a07a');
}
cabinet(12);

function boxes(i) {
  const o = origin(i);
  const cx = o.x + 40, base = o.y + 50;
  const box = (x, y, c) => { for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 12; dx++) plot(x + dx, y + dy, c); for (let dx = 0; dx < 12; dx++) plot(x + dx, y, '#f0d2a4'); };
  box(cx - 14, base - 8, '#c49255');
  box(cx + 2, base - 8, '#a67a40');
  box(cx - 6, base - 16, '#d0a56c');
}
boxes(13);

function lamp(i) {
  const o = origin(i);
  const cx = o.x + 40, base = o.y + 50;
  for (let y = base - 18; y <= base; y++) plot(cx, y, '#5c5348');
  for (let y = 0; y < 6; y++) for (let x = -6 + y; x <= 6 - y; x++) plot(cx + x, base - 24 + y, '#ffe3a1');
  for (let x = -8; x <= 8; x++) plot(cx + x, base - 12, '#ffe3a1', 50);
}
lamp(14);

function coffee(i) {
  const o = origin(i);
  const cx = o.x + 40, base = o.y + 48;
  for (let y = 0; y < 14; y++) for (let x = -6; x <= 6; x++) plot(cx + x, base - y, '#2a2e36');
  for (let y = 0; y < 4; y++) for (let x = -3; x <= 1; x++) plot(cx - 2 + x, base - 10 + y, '#6ec8ff');
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) plot(cx + 2 + x, base - 4 + y, '#f7f7f4');
  plot(cx, base - 15, '#c0392b'); plot(cx, base - 16, '#c0392b');
}
coffee(15);

function board(i) {
  const o = origin(i);
  const cx = o.x + 40, top = o.y + 14;
  for (let y = 0; y < 26; y++) for (let x = -24; x <= 24; x++) plot(cx + x, top + y, '#f6f4ee');
  for (let x = -24; x <= 24; x++) { plot(cx + x, top, '#c8c2b4'); plot(cx + x, top + 25, '#c8c2b4'); }
  for (let k = 0; k < 18; k++) plot(cx - 16 + k, top + 8, '#7eb0e0');
  for (let k = 0; k < 12; k++) plot(cx - 16 + k, top + 12, '#e07a7a');
  for (let k = 0; k < 8; k++) plot(cx - 16 + k, top + 16, '#7dcea0');
}
board(16);

function tv(i) {
  const o = origin(i);
  const cx = o.x + 40, top = o.y + 16;
  for (let y = 0; y < 22; y++) for (let x = -22; x <= 22; x++) plot(cx + x, top + y, '#141a24');
  for (let y = 2; y < 18; y++) for (let x = -18; x <= 18; x++) plot(cx + x, top + y, '#2a4a86');
  screens.code(cx - 8, top + 4);
}
tv(17);

function fridge(i) {
  const o = origin(i);
  const cx = o.x + 40, base = o.y + 52;
  for (let y = 0; y < 30; y++) for (let x = -8; x <= 8; x++) plot(cx + x, base - y, '#e7eef2');
  for (let x = -8; x <= 8; x++) { plot(cx + x, base - 29, '#ffffff'); plot(cx + x, base - 14, '#c5d0d8'); }
  for (let y = 0; y < 6; y++) plot(cx + 5, base - 22 + y, '#9aa8b4');
}
fridge(18);

function pool(i) {
  const o = origin(i);
  const cx = o.x + 40, base = o.y + 40;
  diamond(cx, base, 26, 10, '#6b4428');
  diamond(cx, base - 2, 22, 8, '#1e7a40');
  disc(cx - 4, base - 2, 2, '#f4f4f4');
  disc(cx + 5, base - 3, 2, '#e74c3c');
  disc(cx + 1, base + 1, 2, '#f1c40f');
}
pool(19);

function round(i) {
  const o = origin(i);
  const cx = o.x + 40, base = o.y + 44;
  for (const lx of [-8, 8]) for (let y = 0; y < 6; y++) plot(cx + lx, base - y, '#6b5138');
  diamond(cx, base - 8, 16, 8, '#e4c89a');
  disc(cx, base - 10, 2, '#f7f4ee');
}
round(20);

function printer(i) {
  const o = origin(i);
  const cx = o.x + 40, base = o.y + 46;
  for (let y = 0; y < 8; y++) for (let x = -10; x <= 10; x++) plot(cx + x, base - y, '#e4e8ee');
  for (let y = 0; y < 4; y++) for (let x = -8; x <= 8; x++) plot(cx + x, base - 10 + y, '#b7bec8');
  for (let x = 0; x < 8; x++) plot(cx - 6 + x, base - 4, '#7eb0e0');
}
printer(21);

function door(i) {
  const o = origin(i);
  const cx = o.x + 40, base = o.y + 50;
  for (let y = 0; y < 22; y++) { plot(cx - 8, base - y, '#f4efe6'); plot(cx + 8, base - y, '#f4efe6'); }
  for (let x = -8; x <= 8; x++) plot(cx + x, base - 22, '#f4efe6');
  for (let y = 0; y < 18; y++) for (let x = -6; x <= 6; x++) plot(cx + x, base - y, '#8d5a32');
  plot(cx + 3, base - 9, '#e7c48a');
}
door(22);

function logo(i) {
  const o = origin(i);
  const cx = o.x + 40, top = o.y + 18;
  for (let y = 0; y < 16; y++) for (let x = -18; x <= 18; x++) plot(cx + x, top + y, '#1d2040');
  for (let y = 2; y < 14; y++) for (let x = 0; x < 8; x++) plot(cx - 14 + x, top + y, '#7b8cff');
  const word = [2, 6, 4, 8, 5];
  word.forEach((w, n) => { for (let k = 0; k < w; k++) plot(cx - 2 + n * 3, top + 6 + (k % 2), '#ffffff'); });
}
logo(23);

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) rgba.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../public/gather/iso-sprites.png', import.meta.url), png);
console.log('iso-sprites.png', W, H, png.length);
