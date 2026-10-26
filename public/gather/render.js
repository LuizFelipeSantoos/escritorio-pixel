// Desenho do piso, paredes e móveis (coordenadas em pixels lógicos, 16px por tile).
import { TILE } from './world.js';

const r = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

const tiles = new Image();
tiles.src = '/gather/tileset.png?v=apollo';
let tilesReady = false;
tiles.onload = () => { tilesReady = true; };

function carpet(ctx, px, py, pal, x, y) {
  const a = pal[0], b = pal[1], thread = pal[2], speck = pal[3] || 'rgba(255,255,255,.45)';
  r(ctx, px, py, 16, 16, (x + y) % 2 ? a : b);
  for (let i = 0; i < 16; i += 2) r(ctx, px + ((i + y) % 2), py + i, 16, 1, (i % 4 === 0 ? a : b));
  for (let i = 1; i < 16; i += 4) {
    r(ctx, px + ((x + i) % 8), py + i, 3, 1, thread);
    r(ctx, px + ((x * 3 + i) % 10), py + i + 1, 2, 1, thread);
  }
  if ((x + y) % 4 === 0) r(ctx, px, py, 16, 1, thread);
  if ((x * 5 + y * 3) % 7 === 0) r(ctx, px + 5, py + 6, 1, 1, speck);
  if ((x * 2 + y) % 9 === 0) r(ctx, px + 12, py + 11, 1, 1, speck);
  r(ctx, px, py + 15, 16, 1, 'rgba(0,0,0,.18)');
}

function woodRich(ctx, px, py, pal, x, y) {
  const [a, b, dark] = pal;
  const alt = (x + Math.floor(y / 1)) % 2;
  r(ctx, px, py, 16, 8, alt ? a : b);
  r(ctx, px, py + 8, 16, 8, alt ? b : a);
  r(ctx, px, py + 7, 16, 1, dark);
  r(ctx, px, py + 15, 16, 1, dark);
  const grain = alt ? 3 : 11;
  r(ctx, px + grain, py + 1, 1, 5, 'rgba(255,236,200,.35)');
  r(ctx, px + (16 - grain), py + 9, 1, 5, 'rgba(80,40,16,.25)');
  if ((x * 3 + y) % 8 === 0) {
    r(ctx, px + 6, py + 3, 3, 2, dark);
    r(ctx, px + 7, py + 2, 1, 1, 'rgba(255,220,160,.4)');
  }
}

export function drawFloor(ctx, world) {
  const { W, H, floor, FLOORS } = world;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const f = floor[y][x];
    if (f === 'wall') continue;
    const px = x * TILE, py = y * TILE;
    if (tilesReady && f === 'apollo') {
      ctx.drawImage(tiles, ((x + y) % 2) * 16, 0, 16, 16, px, py, 16, 16);
      continue;
    }
    const pal = FLOORS[f] || FLOORS.concrete;
    if (f === 'hall' || f === 'wood' || f === 'woodWarm' || f === 'deck' || world.PLANKS?.has(f)) woodRich(ctx, px, py, pal, x, y);
    else if (f === 'kitchen') {
      r(ctx, px, py, TILE, TILE, pal[(x + y) % 2]);
      r(ctx, px, py, TILE, 1, 'rgba(255,255,255,.35)');
    } else carpet(ctx, px, py, pal, x, y);
  }
}

function windowView(ctx, px, py) {
  r(ctx, px + 2, py + 5, 12, 7, '#1a2430');
  r(ctx, px + 3, py + 6, 10, 5, '#7eb6e0');
  r(ctx, px + 3, py + 6, 10, 2, '#c5e4f7');
  r(ctx, px + 4, py + 8, 2, 3, '#2c3a52');
  r(ctx, px + 7, py + 7, 2, 4, '#243246');
  r(ctx, px + 10, py + 9, 2, 2, '#3a4c68');
  r(ctx, px + 5, py + 7, 1, 1, '#fff6c8');
  r(ctx, px + 8, py + 6, 1, 5, '#f4efe6');
  r(ctx, px + 2, py + 5, 12, 1, '#6b5340');
  r(ctx, px + 2, py + 11, 12, 1, '#6b5340');
}

function glassWall(ctx, px, py) {
  r(ctx, px, py, 16, 16, '#6b5344');
  r(ctx, px, py + 2, 16, 9, '#9fd4ea');
  r(ctx, px + 1, py + 3, 6, 7, '#d7f3ff');
  r(ctx, px + 8, py + 3, 7, 7, '#b7e4f6');
  r(ctx, px + 7, py + 2, 1, 9, '#f7f1e8');
  r(ctx, px, py + 11, 16, 5, '#4a3428');
  r(ctx, px, py + 11, 16, 1, '#c4a27a');
  r(ctx, px + 2, py + 4, 1, 4, 'rgba(255,255,255,.85)');
}

export function drawWalls(ctx, world) {
  const { W, H, floor } = world;
  const isFloor = (x, y) => y >= 0 && x >= 0 && y < H && x < W && floor[y][x] !== 'wall';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (floor[y][x] !== 'wall') continue;
    const px = x * TILE, py = y * TILE;
    const below = isFloor(x, y + 1);
    const above = isFloor(x, y - 1);
    if (above && below) {
      glassWall(ctx, px, py);
      r(ctx, px, py + TILE, TILE, 4, 'rgba(20,16,30,.22)');
      continue;
    }
    r(ctx, px, py, TILE, TILE, '#8d735c');
    r(ctx, px, py, TILE, 4, '#5c4636');
    r(ctx, px, py + 3, TILE, 1, '#c9a27a');
    if (!below) continue;
    r(ctx, px, py + 4, TILE, 8, '#f6f0e6');
    r(ctx, px + (x % 3) * 5, py + 5, 1, 6, '#e4d8c6');
    r(ctx, px, py + 12, TILE, 4, '#6b4e38');
    r(ctx, px, py + 12, TILE, 1, '#d7b48a');
    const left = x > 0 && floor[y][x - 1] === 'wall';
    const right = x + 1 < W && floor[y][x + 1] === 'wall';
    if (left && right && x % 4 === 2) windowView(ctx, px, py);
    r(ctx, px, py + TILE, TILE, 5, 'rgba(30,20,16,.28)');
    r(ctx, px, py + TILE, TILE, 2, 'rgba(30,20,16,.18)');
  }
}

function plant(ctx, px, py) {
  ctx.fillStyle = 'rgba(20,16,10,.25)';
  ctx.beginPath(); ctx.ellipse(px + 8, py + 15, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
  r(ctx, px + 4, py + 10, 8, 5, '#7a3e28');
  r(ctx, px + 5, py + 9, 6, 2, '#c47a48');
  r(ctx, px + 7, py + 10, 2, 3, '#e8c49a');
  r(ctx, px + 7, py + 4, 2, 7, '#246b38');
  r(ctx, px + 2, py + 5, 5, 4, '#2f9a4a');
  r(ctx, px + 1, py + 6, 2, 2, '#67d36e');
  r(ctx, px + 9, py + 3, 5, 4, '#1f7a3c');
  r(ctx, px + 12, py + 4, 2, 2, '#8ee88a');
  r(ctx, px + 5, py + 1, 6, 4, '#3ec85a');
  r(ctx, px + 6, py, 2, 2, '#d8ffc4');
  r(ctx, px + 4, py + 7, 3, 2, '#145c30');
}

function monitor(ctx, px, py, state, t, facingUp) {
  const y = facingUp ? py + 1 : py + 6;
  r(ctx, px + 1, y - 2, 14, 11, '#14181f');
  r(ctx, px, y - 1, 1, 8, '#2a3140');
  r(ctx, px + 15, y - 1, 1, 8, '#2a3140');
  r(ctx, px + 2, y, 12, 8, '#101820');
  const scr = (c) => r(ctx, px + 3, y + 1, 10, 6, c);
  if (state === 'working') {
    scr('#0e1a2b');
    for (let l = 0; l < 3; l++) r(ctx, px + 4, y + 2 + l * 2, 2 + ((t + l * 3) % 7), 1, ['#4da3ff', '#ffcc4d', '#7bd88f'][(l + (t >> 2)) % 3]);
  } else if (state === 'done') { scr('#163a1f'); r(ctx, px + 6, y + 4, 1, 1, '#6bd968'); r(ctx, px + 7, y + 5, 1, 1, '#6bd968'); r(ctx, px + 8, y + 3, 1, 2, '#6bd968'); r(ctx, px + 9, y + 2, 1, 1, '#6bd968'); }
  else if (state === 'error') { scr('#5a1a1a'); r(ctx, px + 7, y + 2, 1, 3, '#ff6b6b'); r(ctx, px + 7, y + 6, 1, 0.8, '#ff6b6b'); }
  else if (state === 'off') scr('#111');
  else scr('#24364f');
  r(ctx, px + 7, facingUp ? y + 8 : y - 1, 2, 1, '#22212b');
}

export function drawObject(ctx, o, ctxInfo) {
  const px = o.x * TILE, py = o.y * TILE, w = (o.w || 1) * TILE, h = (o.h || 1) * TILE;
  const t = ctxInfo.tick;
  switch (o.type) {
    case 'rug':
      r(ctx, px + 1, py + 1, w - 2, h - 2, '#2a241c');
      r(ctx, px + 2, py + 2, w - 4, h - 4, o.color);
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1; ctx.strokeRect(px + 4.5, py + 4.5, w - 9, h - 9);
      break;
    case 'sign':
      break;
    case 'desk':
    case 'bigdesk':
      ctx.fillStyle = 'rgba(40,28,16,.22)';
      ctx.beginPath(); ctx.ellipse(px + w / 2, py + h + 1, w / 2 - 1, 2, 0, 0, Math.PI * 2); ctx.fill();
      r(ctx, px + 2, py + h - 1, 3, 4, '#4a301c');
      r(ctx, px + w - 5, py + h - 1, 3, 4, '#4a301c');
      r(ctx, px, py + 1, w, h - 2, '#4a301c');
      r(ctx, px + 1, py + 2, w - 2, h - 4, '#e2b06a');
      r(ctx, px + 1, py + 2, w - 2, 2, '#f6d7a4');
      r(ctx, px + 2, py + h - 4, w - 4, 1, '#c48a48');
      break;
    case 'table':
      r(ctx, px + 1, py + 1, w - 2, h - 2, '#6b4428');
      r(ctx, px + 2, py + 2, w - 4, h - 4, '#e2b06a');
      r(ctx, px + 2, py + 2, w - 4, 2, '#f3d09a');
      break;
    case 'roundtable':
      ctx.fillStyle = '#a87648'; ctx.beginPath(); ctx.arc(px + 16, py + 16, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c18c5a'; ctx.beginPath(); ctx.arc(px + 16, py + 15, 11, 0, Math.PI * 2); ctx.fill();
      r(ctx, px + 12, py + 11, 4, 4, '#fff'); r(ctx, px + 13, py + 12, 2, 2, '#6b3e22');
      break;
    case 'coffeetable':
      r(ctx, px + 2, py + 4, w - 4, 9, '#6b4a33'); r(ctx, px + 2, py + 4, w - 4, 3, '#85603f');
      break;
    case 'chair': {
      const wood = '#4a3424', seat = '#6a5a78', back = '#3d3148';
      ctx.fillStyle = 'rgba(40,28,16,.2)';
      ctx.beginPath(); ctx.ellipse(px + 8, py + 14, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
      if (o.dir === 'down') { r(ctx, px + 3, py + 1, 10, 4, back); r(ctx, px + 2, py + 5, 12, 6, seat); r(ctx, px + 3, py + 11, 2, 3, wood); r(ctx, px + 11, py + 11, 2, 3, wood); }
      else if (o.dir === 'up') { r(ctx, px + 2, py + 4, 12, 6, seat); r(ctx, px + 3, py + 10, 10, 4, back); r(ctx, px + 3, py + 2, 2, 3, wood); r(ctx, px + 11, py + 2, 2, 3, wood); }
      else { r(ctx, px + 3, py + 5, 10, 6, seat); r(ctx, o.dir === 'left' ? px + 11 : px + 2, py + 2, 3, 10, back); }
      break;
    }
    case 'bookshelf': {
      r(ctx, px, py - 8, w, h + 10, '#4a301c');
      r(ctx, px + 1, py - 7, w - 2, h + 7, '#6b4428');
      const colors = ['#c0392b', '#2471a3', '#f4d03f', '#1e8449', '#6c3483', '#e67e22'];
      for (let row = 0; row < 3; row++) {
        const y0 = py - 6 + row * 6;
        r(ctx, px + 1, y0 + 5, w - 2, 1, '#3b2416');
        for (let b = 0; b < w - 4; b += 3) {
          const c = colors[(b + row * 2) % colors.length];
          r(ctx, px + 2 + b, y0 + (b % 2), 2, 5 - (b % 2), c);
          r(ctx, px + 2 + b, y0 + (b % 2), 1, 5 - (b % 2), 'rgba(255,255,255,.25)');
        }
      }
      break;
    }
    case 'plant': plant(ctx, px, py); break;
    case 'whiteboard':
    case 'whiteboard-stand': {
      const y0 = o.type === 'whiteboard' ? py + 2 : py - 8;
      if (o.type === 'whiteboard-stand') { r(ctx, px + 3, py + 4, 1, 11, '#777'); r(ctx, px + w - 4, py + 4, 1, 11, '#777'); }
      r(ctx, px + 1, y0, w - 2, 12, '#9aa0a6'); r(ctx, px + 2, y0 + 1, w - 4, 10, '#fbfbf8');
      if (o.label === 'pipeline') {
        const v = ctxInfo.harvey || {};
        const bars = [v.pending_review || 0, v.approved || 0, v.sent || 0];
        const max = Math.max(1, ...bars);
        bars.forEach((n, i) => r(ctx, px + 8 + i * 14, y0 + 9 - Math.round(7 * n / max), 8, Math.max(1, Math.round(7 * n / max)), ['#ffcc4d', '#4da3ff', '#6bd968'][i]));
      } else {
        r(ctx, px + 5, y0 + 3, 14, 1, '#4da3ff'); r(ctx, px + 5, y0 + 6, 20, 1, '#ff7a59'); r(ctx, px + 5, y0 + 8, 9, 1, '#7bd88f');
      }
      break;
    }
    case 'tv': {
      r(ctx, px + 2, py + 1, w - 4, 13, '#111');
      r(ctx, px + 3, py + 2, w - 6, 11, '#1b2a44');
      const n = ctxInfo.working || 0;
      for (let i = 0; i < Math.min(n, 12); i++) r(ctx, px + 6 + i * 6, py + 9, 4, 3, '#ffcc4d');
      r(ctx, px + 6, py + 4, (t % 40) + 10, 2, '#4da3ff');
      break;
    }
    case 'sofa': {
      const c = o.color || '#5b6ee1';
      ctx.fillStyle = 'rgba(40,28,16,.22)';
      ctx.beginPath(); ctx.ellipse(px + w / 2, py + 16, w / 2 - 2, 2, 0, 0, Math.PI * 2); ctx.fill();
      r(ctx, px, py + 3, w, 12, '#1a1614');
      r(ctx, px + 1, py + 4, w - 2, 10, shadeHex(c));
      r(ctx, px + 4, py + 8, w - 8, 5, c);
      r(ctx, px + 1, py + 4, 3, 10, shadeHex(c));
      r(ctx, px + w - 4, py + 4, 3, 10, shadeHex(c));
      r(ctx, px + 4, py + 5, w - 8, 2, '#fff3');
      break;
    }
    case 'beanbag':
      ctx.fillStyle = o.color; ctx.beginPath(); ctx.ellipse(px + 8, py + 10, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
      break;
    case 'counter':
      r(ctx, px, py - 4, w, h + 2, '#c9c3b5'); r(ctx, px, py - 4, w, 4, '#e6e1d6'); r(ctx, px, py + h - 3, w, 1, '#9d9688');
      break;
    case 'coffee':
      r(ctx, px + 3, py - 6, 10, 12, '#2d2d34'); r(ctx, px + 5, py - 4, 6, 3, '#e74c3c');
      r(ctx, px + 6, py + 2, 4, 3, '#fff');
      if (t % 20 < 10) r(ctx, px + 7, py - 1 - (t % 5), 1, 2, 'rgba(255,255,255,.6)');
      break;
    case 'sink': r(ctx, px + 2, py - 2, 12, 6, '#a9b4bf'); r(ctx, px + 7, py - 5, 2, 4, '#7f8a95'); break;
    case 'fridge': r(ctx, px + 1, py - 10, 14, 24, '#e9eef2'); r(ctx, px + 1, py - 1, 14, 1, '#b8c0c8'); r(ctx, px + 12, py - 7, 1, 4, '#8a949e'); r(ctx, px + 12, py + 2, 1, 5, '#8a949e'); break;
    case 'pingpong':
      r(ctx, px + 2, py + 2, w - 4, h - 4, '#1f6f5c'); r(ctx, px + w / 2, py + 2, 1, h - 4, '#fff');
      r(ctx, px + 2, py + h / 2, w - 4, 1, 'rgba(255,255,255,.5)');
      { const bx = px + 6 + Math.abs(((t * 2) % ((w - 12) * 2)) - (w - 12)); r(ctx, bx, py + 12 + Math.sin(t / 3) * 6, 2, 2, '#fff'); }
      break;
    case 'phone': r(ctx, px + 2, py + 3, 6, 4, '#1b1a27'); r(ctx, px + 3, py + 2, 4, 1, '#333'); break;
    case 'workstation': {
      ctx.fillStyle = 'rgba(20,12,8,.28)';
      ctx.beginPath(); ctx.ellipse(px + w / 2, py + h + 3, w / 2 - 2, 2.4, 0, 0, Math.PI * 2); ctx.fill();
      r(ctx, px + 2, py + h, 3, 4, '#3a2416');
      r(ctx, px + w - 5, py + h, 3, 4, '#3a2416');
      r(ctx, px, py, w, h, '#3d2918');
      r(ctx, px + 1, py + 1, w - 2, h - 3, '#e7c48a');
      r(ctx, px + 1, py + 1, w - 2, 2, '#f8e2b8');
      r(ctx, px + 2, py + h - 4, w - 4, 1, '#c48a48');
      r(ctx, px + 4, py + 4, 8, 5, '#f4efe4');
      r(ctx, px + 5, py + 5, 6, 1, '#7aa2d4');
      r(ctx, px + 5, py + 7, 4, 1, '#d0d4dc');
      r(ctx, px + w / 2 - 6, py + 8, 12, 3, '#2c3038');
      r(ctx, px + w / 2 - 5, py + 9, 10, 1, '#c5cad3');
      r(ctx, px + w - 10, py + 5, 5, 4, '#f7f7f8');
      r(ctx, px + w - 9, py + 6, 3, 2, '#4d7ec4');
      break;
    }
    case 'chair-back':
      r(ctx, px + 3, py + 10, 10, 4, '#3d3148');
      r(ctx, px + 4, py + 11, 8, 2, '#6a5a78');
      break;
    case 'armchair':
      r(ctx, px + 2, py + 4, 12, 8, '#3b4a7a'); r(ctx, px + 1, py + 3, 3, 9, '#2c3860'); r(ctx, px + 12, py + 3, 3, 9, '#2c3860');
      r(ctx, px + 4, py + 2, 8, 3, '#2c3860');
      break;
    case 'lamp':
      r(ctx, px + 7, py + 8, 2, 7, '#6b4428'); r(ctx, px + 4, py + 2, 8, 6, '#f4e4a8'); r(ctx, px + 6, py + 1, 4, 2, '#fff6cf');
      break;
    case 'neon':
      r(ctx, px + 2, py + 3, w - 4, 8, '#1a1630'); r(ctx, px + 4, py + 5, w - 8, 4, '#7ec8e3');
      break;
    case 'pool':
      r(ctx, px + 1, py + 1, w - 2, h - 2, '#1a6b45'); r(ctx, px + w / 2 - 1, py + 2, 2, h - 4, '#e8efe4');
      r(ctx, px + 4, py + 6, 3, 3, '#f2f2f2'); r(ctx, px + w - 10, py + h - 10, 3, 3, '#111');
      break;
    case 'skyline':
      r(ctx, px, py + 4, w, 12, '#8ec8e8');
      r(ctx, px + 2, py + 8, 4, 8, '#3d4a62'); r(ctx, px + 8, py + 5, 5, 11, '#2c3548'); r(ctx, px + 16, py + 9, 6, 7, '#4a5874');
      break;
    case 'shelves':
    case 'cabinet':
      r(ctx, px, py, w, h + 4, '#6b4428'); r(ctx, px + 1, py + 1, w - 2, h + 1, '#8a5a38');
      break;
    case 'server':
      r(ctx, px + 2, py - 6, 12, 20, '#262b38'); r(ctx, px + 3, py - 5, 10, 18, '#363d4f');
      for (let i = 0; i < 4; i++) { r(ctx, px + 4, py - 3 + i * 4, 8, 2, '#1b1f2a'); r(ctx, px + 10, py - 3 + i * 4, 1, 1, (t + i * 7) % 20 < 10 ? '#5ef0a0' : '#2f7a55'); }
      break;
    case 'printer':
      r(ctx, px + 2, py + 4, 12, 8, '#d5d8de'); r(ctx, px + 4, py + 2, 8, 3, '#9aa3b2'); r(ctx, px + 3, py + 8, 10, 1, '#333');
      break;
    case 'box':
      r(ctx, px + 3, py + 6, 10, 8, '#c4a574'); r(ctx, px + 3, py + 6, 10, 2, '#ddc08a'); r(ctx, px + 7, py + 8, 2, 4, '#8a6a40');
      break;
  }
}

function shadeHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) * 0.75 | 0},${((n >> 8) & 255) * 0.75 | 0},${(n & 255) * 0.75 | 0})`;
}

export function drawDeskTop(ctx, seat, state, t) {
  // monitor + teclado na mesa do agente
  const px = seat.mon.x * TILE, py = seat.mon.y * TILE;
  const facingUp = seat.dir === 'down'; // agente acima da mesa: tela voltada pra ele
  monitor(ctx, px + 8, py - 1, state, t, !facingUp);
  r(ctx, px + 1, facingUp ? py + 3 : py + 10, 6, 2, '#ddd');
}
