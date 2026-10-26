// Projeção isométrica 2:1. O mapa lógico continua em tiles; só a tela muda.
export const ISO_TW = 36;
export const ISO_TH = 18;
const HW = ISO_TW / 2;
const HH = ISO_TH / 2;
const WALL_LIFT = 12;

const STYLES = {
  apollo:       { base: '#3c6298', alt: '#35588c', line: '#2c4c7c', spec: '#8eafd4', carpet: true },
  woodWarm:     { base: '#c48b52', alt: '#b78049', line: '#966538', spec: '#e4c08a', carpet: false },
  wood:         { base: '#d0a56c', alt: '#c49860', line: '#a67b44', spec: '#f0d4a6', carpet: false },
  woodDark:     { base: '#7a5438', alt: '#6e4b32', line: '#59381f', spec: '#a67a52', carpet: false },
  woodLight:    { base: '#e2b87e', alt: '#d6ac72', line: '#c09458', spec: '#f6e0bc', carpet: false },
  carpetGreen:  { base: '#3e6b54', alt: '#37624c', line: '#2c513e', spec: '#7eae96', carpet: true },
  carpetCursor: { base: '#5b5186', alt: '#524978', line: '#433c64', spec: '#9b94c0', carpet: true },
  carpetGray:   { base: '#7e8ca4', alt: '#73839a', line: '#61738c', spec: '#c5d0de', carpet: true },
  deck:         { base: '#8d6e52', alt: '#816348', line: '#6a5138', spec: '#c4a484', carpet: false },
  concrete:     { base: '#8d929a', alt: '#82878f', line: '#6e747c', spec: '#c8ccd2', carpet: true },
  carpetRose:   { base: '#8a5d7c', alt: '#805571', line: '#6c4560', spec: '#c49ab6', carpet: true },
};

const ROOM_STYLE = {
  recep: 'woodWarm', apollo: 'apollo', cron: 'woodDark', skills: 'carpetGreen',
  cursor: 'carpetCursor', sales: 'wood', meeting: 'carpetGray', pausa: 'woodLight',
  varanda: 'deck', deposito: 'concrete', ig: 'carpetRose',
};

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * f))));
  return `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

export function project(gx, gy, origin) {
  return {
    x: origin.x + (gx - gy) * HW,
    y: origin.y + (gx + gy) * HH,
  };
}

export function unproject(sx, sy, origin) {
  const x = sx - origin.x;
  const y = sy - origin.y;
  const gx = (x / HW + y / HH) / 2;
  const gy = (y / HH - x / HW) / 2;
  return { x: Math.floor(gx), y: Math.floor(gy), fx: gx, fy: gy };
}

export function isoMapSize(world) {
  let minGX = world.W, minGY = world.H, maxGX = 0, maxGY = 0, any = false;
  for (let y = 0; y < world.H; y++) for (let x = 0; x < world.W; x++) {
    if (world.floor[y][x] === 'wall') continue;
    any = true;
    if (x < minGX) minGX = x;
    if (y < minGY) minGY = y;
    if (x + 1 > maxGX) maxGX = x + 1;
    if (y + 1 > maxGY) maxGY = y + 1;
  }
  if (!any) { minGX = 0; minGY = 0; maxGX = world.W; maxGY = world.H; }
  const corners = [
    project(minGX, minGY, { x: 0, y: 0 }),
    project(maxGX, minGY, { x: 0, y: 0 }),
    project(maxGX, maxGY, { x: 0, y: 0 }),
    project(minGX, maxGY, { x: 0, y: 0 }),
  ];
  const minX = Math.min(...corners.map(p => p.x)) - 4;
  const maxX = Math.max(...corners.map(p => p.x)) + 4;
  const minY = Math.min(...corners.map(p => p.y)) - WALL_LIFT - 48;
  const maxY = Math.max(...corners.map(p => p.y)) + 10;
  return {
    origin: { x: -minX, y: -minY },
    w: maxX - minX,
    h: maxY - minY,
  };
}

function corners(gx, gy, w, h, origin) {
  return {
    top: project(gx, gy, origin),
    right: project(gx + w, gy, origin),
    bot: project(gx + w, gy + h, origin),
    left: project(gx, gy + h, origin),
  };
}

function poly(ctx, pts, color) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function floorOf(world, x, y) {
  if (y < 0 || x < 0 || y >= world.H || x >= world.W) return 'wall';
  return world.floor[y][x];
}

function styleOf(room) {
  return STYLES[ROOM_STYLE[room?.key] || 'wood'];
}

function rr(ctx, x, y, w, h, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function shadow(ctx, x, y, rx, ry) {
  ctx.fillStyle = 'rgba(22,16,28,.22)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

// Ponto do mapa (em tiles, com altura em pixels) já projetado na tela.
const at = (origin, gx, gy, z = 0) => { const p = project(gx, gy, origin); return { x: p.x, y: p.y - z }; };

// ── Piso: um polígono por sala, de centro de parede a centro de parede ─────────

function roomPoly(origin, r, z = 0) {
  const x0 = r.x + 0.5, y0 = r.y + 0.5, x1 = r.x + r.w - 0.5, y1 = r.y + r.h - 0.5;
  return [at(origin, x0, y0, z), at(origin, x1, y0, z), at(origin, x1, y1, z), at(origin, x0, y1, z)];
}

function drawBase(ctx, world, origin) {
  const all = { x: 0, y: 0, w: world.W, h: world.H };
  const [a, b, c, d] = roomPoly(origin, all);
  const drop = 7;
  const down = p => ({ x: p.x, y: p.y + drop });
  poly(ctx, [d, c, down(c), down(d)], '#2b2e40');
  poly(ctx, [c, b, down(b), down(c)], '#22253a');
}

function drawRoomFloor(ctx, world, room, origin, focused) {
  const style = styleOf(room);
  const pts = roomPoly(origin, room);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  const g = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[2].x, pts[2].y);
  g.addColorStop(0, shade(style.base, 1.06));
  g.addColorStop(1, shade(style.base, 0.9));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();
  // Rejunte discreto: tábuas num sentido só, carpete quase liso, concreto em placas.
  ctx.strokeStyle = style.line;
  ctx.lineWidth = 0.6;
  ctx.globalAlpha = style.carpet ? (room.key === 'deposito' ? 0.22 : 0.07) : 0.2;
  ctx.beginPath();
  for (let j = room.y + 1; j < room.y + room.h; j++) {
    const p = at(origin, room.x + 0.5, j), q = at(origin, room.x + room.w - 0.5, j);
    ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
  }
  if (style.carpet) for (let i = room.x + 1; i < room.x + room.w; i++) {
    const p = at(origin, i, room.y + 0.5), q = at(origin, i, room.y + room.h - 0.5);
    ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
  }
  ctx.stroke();
  const tint = LIGHT[room.key];
  if (tint) {
    const c = at(origin, room.x + room.w / 2, room.y + room.h / 2);
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, room.w * 9, room.h * 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (focused) {
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#ffe7a3';
    ctx.fillRect(-1e4, -1e4, 2e4, 2e4);
  }
  ctx.restore();
}

function drawRug(ctx, o, origin) {
  const r = { x: o.x - 0.5 + 0.15, y: o.y - 0.5 + 0.15, w: (o.w || 1) + 0.7, h: (o.h || 1) + 0.7 };
  ctx.save();
  ctx.globalAlpha = 0.75;
  poly(ctx, roomPoly(origin, r), o.color || '#7a3b3b');
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = shade(o.color || '#7a3b3b', 1.4);
  ctx.lineWidth = 1;
  const inner = roomPoly(origin, { x: r.x + 0.25, y: r.y + 0.25, w: r.w - 0.5, h: r.h - 0.5 });
  ctx.beginPath(); inner.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
  ctx.restore();
}

// ── Paredes: placas finas e contínuas no limite entre as salas ────────────────
// O fundo do prédio (norte e oeste) é alto; divisórias internas ficam a meia altura
// e a fachada da frente é baixa, como o corte do The Sims, pra dar pra ver dentro.

const WALL_TALL = 40;
const WALL_MID = 20;
const WALL_LOW = 7;
const WALL_T = 0.16;
const WALL = { face: '#f1e9dc', side: '#d8cbb6', top: '#fbf8f2', edge: 'rgba(120,98,76,.45)', base: '#b89a7c' };

function wallHeight(world, axis, x, y) {
  if (axis === 'x') return y === 0 ? WALL_TALL : y === world.H - 1 ? WALL_LOW : WALL_MID;
  return x === 0 ? WALL_TALL : x === world.W - 1 ? WALL_LOW : WALL_MID;
}

function drawWallSeg(ctx, origin, axis, x, y, h, alpha, win) {
  const t = WALL_T / 2;
  // Trecho de centro de tile a centro de tile; a face visível é a sul (eixo x) ou a leste (eixo y).
  // Cada trecho passa um pouco do centro dos dois lados pra encostar no vizinho sem fresta.
  const [x0, y0, x1, y1] = axis === 'x' ? [x + 0.5 - t, y + 0.5, x + 1.5 + t, y + 0.5] : [x + 0.5, y + 0.5 - t, x + 0.5, y + 1.5 + t];
  const [ox, oy] = axis === 'x' ? [0, t] : [t, 0];
  const A = at(origin, x0 + ox, y0 + oy), B = at(origin, x1 + ox, y1 + oy);
  const up = (p, z) => ({ x: p.x, y: p.y - z });
  ctx.save();
  ctx.globalAlpha = alpha;
  poly(ctx, [A, B, up(B, h), up(A, h)], axis === 'x' ? WALL.face : WALL.side);
  if (h >= WALL_MID) {
    ctx.strokeStyle = WALL.base;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(A.x, A.y - 1.5); ctx.lineTo(B.x, B.y - 1.5); ctx.stroke();
  }
  if (win) {
    const P = (u, z) => ({ x: A.x + (B.x - A.x) * u, y: A.y + (B.y - A.y) * u - z });
    poly(ctx, [P(0.18, h * 0.32), P(0.82, h * 0.32), P(0.82, h * 0.82), P(0.18, h * 0.82)], '#9b8670');
    const glass = ctx.createLinearGradient(P(0.2, h * 0.8).x, P(0.2, h * 0.8).y, P(0.8, h * 0.35).x, P(0.8, h * 0.35).y);
    glass.addColorStop(0, '#cfe9f7'); glass.addColorStop(1, '#8cc3e2');
    ctx.fillStyle = glass;
    ctx.beginPath();
    [P(0.22, h * 0.36), P(0.78, h * 0.36), P(0.78, h * 0.78), P(0.22, h * 0.78)].forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath(); ctx.fill();
  }
  const T = [at(origin, x0 - ox, y0 - oy, h), at(origin, x1 - ox, y1 - oy, h), at(origin, x1 + ox, y1 + oy, h), at(origin, x0 + ox, y0 + oy, h)];
  poly(ctx, T, WALL.top);
  ctx.strokeStyle = WALL.edge;
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(T[3].x, T[3].y); ctx.lineTo(T[2].x, T[2].y); ctx.stroke();
  ctx.restore();
}

// Tampa em cada junção, pra emendar o topo dos trechos sem fresta.
function drawWallPost(ctx, origin, x, y, h, alpha) {
  const t = WALL_T / 2, cx = x + 0.5, cy = y + 0.5;
  const g = [at(origin, cx - t, cy - t), at(origin, cx + t, cy - t), at(origin, cx + t, cy + t), at(origin, cx - t, cy + t)];
  const up = p => ({ x: p.x, y: p.y - h });
  ctx.save();
  ctx.globalAlpha = alpha;
  poly(ctx, g.map(up), WALL.top);
  ctx.restore();
}

// ── Móveis ────────────────────────────────────────────────────────────────

// Móveis de Sweeetpotatoo (uso livre): https://sweeetpotatoo.itch.io/isometric-home-furniture
const atlas = new Image();
atlas.src = '/gather/potato-atlas.png?v=potato';
// Ponto de contato medido no PNG: a ponta sul do sprite, não o centro da caixa.
// base = largura da planta no chão; face = quantos pixels a face da frente sobe até a superfície.
const SPR = {
  desk:     { x: 1, y: 1, w: 90, h: 85, footX: 67, footY: 83, base: 88, face: 20 },
  table:    { x: 92, y: 1, w: 60, h: 55, footX: 45.5, footY: 53, base: 58, face: 16 },
  chair:    { x: 153, y: 1, w: 19, h: 39, footX: 9, footY: 38, base: 17, face: 14 },
  shelf:    { x: 173, y: 1, w: 30, h: 60, footX: 9.5, footY: 58, base: 30, face: 21 },
  books:    { x: 204, y: 1, w: 30, h: 76, footX: 19.5, footY: 74, base: 30, face: 28 },
  file:     { x: 235, y: 1, w: 20, h: 55, footX: 9.5, footY: 53, base: 20, face: 20 },
  sofa:     { x: 256, y: 1, w: 74, h: 68, footX: 55.5, footY: 66, base: 74, face: 16 },
  seat:     { x: 331, y: 1, w: 52, h: 57, footX: 33.5, footY: 55, base: 52, face: 16 },
  screen:   { x: 384, y: 1, w: 42, h: 63, footX: 9.5, footY: 61, base: 42, face: 12 },
  low:      { x: 427, y: 1, w: 38, h: 32, footX: 21.5, footY: 30, base: 38, face: 8 },
  plant:    { x: 466, y: 1, w: 27, h: 38, footX: 14.5, footY: 37, base: 18, face: 8 },
  lamp:     { x: 494, y: 1, w: 10, h: 37, footX: 4.5, footY: 36, base: 8, face: 2 },
  tree:     { x: 1, y: 87, w: 19, h: 47, footX: 5.5, footY: 46, base: 19, face: 10 },
  bush:     { x: 21, y: 87, w: 23, h: 36, footX: 8.5, footY: 35, base: 17, face: 6 },
  fridge:   { x: 45, y: 87, w: 40, h: 65, footX: 15.5, footY: 63, base: 40, face: 22 },
  machine:  { x: 86, y: 87, w: 34, h: 44, footX: 17.5, footY: 42, base: 34, face: 13 },
  counter:  { x: 121, y: 87, w: 111, h: 61, footX: 99, footY: 38, base: 100, face: 12 },
  wardrobe: { x: 233, y: 87, w: 58, h: 74, footX: 9.5, footY: 72, base: 58, face: 20 },
  glass:    { x: 292, y: 87, w: 34, h: 62, footX: 9.5, footY: 60, base: 34, face: 20 },
};
const LIGHT = {
  apollo: '#7eb0ff', cursor: '#b794f6', recep: '#ffc56e', pausa: '#ffb45a', ig: '#f5a3d0',
  varanda: '#ffe0a0', cron: '#7dcea0', skills: '#8fd4a8', sales: '#ffd59a', meeting: '#c5d4ea',
};

// Escala única pra todos os sprites: um móvel nunca cresce por ocupar mais tiles.
// Coisa larga (estante, arquivo, rack) vira várias peças lado a lado.
const K = 0.82;

function groundOf(o, origin) {
  const w = o.w || 1, h = o.h || 1;
  // Canto sul do retângulo: é onde a ponta da frente do sprite encosta no piso.
  const p = project(o.x + w, o.y + h, origin);
  return { x: p.x, y: p.y, w, h, span: (w + h) * 18, depth: (w + h) * 9 };
}

// O pacote desenha cada peça olhando pra um lado só: estantes, arquivos e armários
// de frente pro leste (+x); sofá, cadeira e o resto pro sul (+y). Espelhar troca um pelo outro.
const FACES_EAST = new Set(['shelf', 'books', 'file', 'wardrobe', 'glass']);

const sprScale = (name, ground, fill, stretch = 1) => Math.min((ground.span * fill) / SPR[name].base, K * stretch);

// face: pra onde a frente do móvel aponta no mapa ('south' ou 'east').
function paint(ctx, name, ground, fill, stretch = 1, face = 'south') {
  const s = SPR[name];
  if (!s || !atlas.complete || !atlas.naturalWidth) return null;
  const scale = sprScale(name, ground, fill, stretch);
  const mirror = (face === 'east') !== FACES_EAST.has(name);
  const dw = s.w * scale;
  const dh = s.h * scale;
  const dx = ground.x - (mirror ? s.w - s.footX : s.footX) * scale;
  const dy = ground.y - s.footY * scale;
  if (mirror) {
    ctx.save();
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(atlas, s.x, s.y, s.w, s.h, 0, 0, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(atlas, s.x, s.y, s.w, s.h, dx, dy, dw, dh);
  }
  return { x: dx, y: dy, w: dw, h: dh, scale };
}

// Peças largas viram várias lado a lado; todas encostadas na parede do fundo, de frente pro sul.
function paintRow(ctx, name, o, origin, fill) {
  for (let j = 0; j < (o.h || 1); j++) for (let i = 0; i < (o.w || 1); i++)
    paint(ctx, name, groundOf({ x: o.x + i, y: o.y + j }, origin), fill);
}

function supportLift(world, o, origin) {
  if (o.type !== 'coffee' && o.type !== 'sink') return null;
  const host = world.objects.find(h => h.type === 'counter'
    && o.x >= h.x && o.x < h.x + (h.w || 1) && o.y >= h.y && o.y < h.y + (h.h || 1));
  if (!host) return null;
  const hostGround = groundOf(host, origin);
  const own = groundOf(o, origin);
  return { ...own, y: hostGround.y - SPR.counter.face * sprScale('counter', hostGround, 0.9, 1.25) };
}

function glow(ctx, x, y, on, tick) {
  const pulse = on && Math.floor(tick / 8) % 2 === 0 ? 0.34 : on ? 0.2 : 0.1;
  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.fillStyle = on ? '#d7fbff' : '#9ecfff';
  ctx.beginPath();
  ctx.ellipse(x, y, on ? 8 : 6, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Bloco liso (mesa, mesa de centro, sinuca) do tamanho exato da planta.
function slab(ctx, o, origin, height, top, side, inset = 0.12) {
  const x0 = o.x + inset, y0 = o.y + inset, x1 = o.x + (o.w || 1) - inset, y1 = o.y + (o.h || 1) - inset;
  const P = (x, y, z) => at(origin, x, y, z);
  shadow(ctx, at(origin, (x0 + x1) / 2, y1).x, at(origin, (x0 + x1) / 2, y1).y, (x1 - x0 + y1 - y0) * 8, 3);
  poly(ctx, [P(x0, y1, 0), P(x1, y1, 0), P(x1, y1, height), P(x0, y1, height)], side);
  poly(ctx, [P(x1, y1, 0), P(x1, y0, 0), P(x1, y0, height), P(x1, y1, height)], shade(side, 0.82));
  const T = [P(x0, y0, height), P(x1, y0, height), P(x1, y1, height), P(x0, y1, height)];
  const g = ctx.createLinearGradient(T[0].x, T[0].y, T[2].x, T[2].y);
  g.addColorStop(0, shade(top, 1.1)); g.addColorStop(1, shade(top, 0.94));
  ctx.fillStyle = g;
  ctx.beginPath(); T.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fill();
  return { x0, y0, x1, y1, height };
}

function roundTable(ctx, o, origin) {
  const c = at(origin, o.x + (o.w || 1) / 2, o.y + (o.h || 1) / 2);
  const rx = (o.w || 1) * 13, ry = (o.h || 1) * 6.5;
  shadow(ctx, c.x, c.y + 1, rx * 0.7, ry * 0.6);
  rr(ctx, c.x - 2, c.y - 10, 4, 10, 1.5, '#5d4636');
  ctx.fillStyle = '#7a5a44';
  ctx.beginPath(); ctx.ellipse(c.x, c.y - 9, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#b58a64';
  ctx.beginPath(); ctx.ellipse(c.x, c.y - 11, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
}

// Quadro/TV preso na parede de trás: plano e fino, sempre do tamanho da parede que ocupa.
function wallBoard(ctx, world, o, origin, scene) {
  const onWall = floorOf(world, o.x, o.y) === 'wall';
  const gy = onWall ? o.y + 0.5 + WALL_T / 2 + 0.02 : o.y - 0.5 + WALL_T / 2 + 0.02;
  const wallTop = onWall ? (o.y === 0 ? WALL_TALL : WALL_MID) : (o.y - 1 === 0 ? WALL_TALL : WALL_MID);
  const lo = wallTop >= WALL_TALL ? 13 : 5, hi = wallTop >= WALL_TALL ? 33 : WALL_MID - 3;
  const a = at(origin, o.x + 0.12, gy), b = at(origin, o.x + (o.w || 1) - 0.12, gy);
  const P = (u, z) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u - z });
  const quad = (u0, u1, z0, z1, color) => poly(ctx, [P(u0, z0), P(u1, z0), P(u1, z1), P(u0, z1)], color);
  const t = o.type;
  if (t === 'tv') {
    quad(0, 1, lo, hi, '#1b1d27');
    quad(0.04, 0.96, lo + 1.5, hi - 1.5, '#2c4466');
    ctx.save(); ctx.globalAlpha = 0.35 + 0.1 * Math.sin((scene?.tick || 0) / 12);
    quad(0.1, 0.55, lo + 3, hi - 3, '#7fb3ff'); ctx.restore();
  } else if (t === 'neon') {
    quad(0, 1, lo, hi, '#2a2140');
    ctx.save(); ctx.shadowColor = '#ff7ad9'; ctx.shadowBlur = 6;
    quad(0.12, 0.88, (lo + hi) / 2 - 1, (lo + hi) / 2 + 1, '#ff9ae4'); ctx.restore();
  } else {
    quad(0, 1, lo, hi, '#a3abb9');
    quad(0.03, 0.97, lo + 1.2, hi - 1.2, '#f7f9fc');
    const ink = ['#e0607e', '#4f8fe0', '#3fb37f', '#e0a43f'];
    for (let i = 0; i < 3; i++) {
      const u = 0.1 + i * 0.28, z = hi - 4 - i * 2.5;
      ctx.strokeStyle = ink[(o.x + i) % ink.length]; ctx.lineWidth = 1;
      ctx.beginPath(); const p = P(u, z), q = P(u + 0.2, z - 1); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }
  }
}

function drawProp(ctx, world, o, origin, scene) {
  const t = o.type;
  if (t === 'whiteboard' || t === 'tv' || t === 'neon') return wallBoard(ctx, world, o, origin, scene);
  if (t === 'table') return slab(ctx, o, origin, 11, '#c99d70', '#8f6644');
  if (t === 'coffeetable') return slab(ctx, o, origin, 6, '#7d5a43', '#5b4030', 0.2);
  if (t === 'roundtable') return roundTable(ctx, o, origin);
  if (t === 'pool') {
    const s = slab(ctx, o, origin, 10, '#6b4430', '#53331f', 0.05);
    const P = (x, y) => at(origin, x, y, s.height);
    poly(ctx, [P(s.x0 + 0.18, s.y0 + 0.18), P(s.x1 - 0.18, s.y0 + 0.18), P(s.x1 - 0.18, s.y1 - 0.18), P(s.x0 + 0.18, s.y1 - 0.18)], '#2f8a5c');
    return;
  }
  const lift = supportLift(world, o, origin);
  const g = lift || groundOf(o, origin);
  if (!lift) shadow(ctx, g.x - 4, g.y - 2, Math.min(14, Math.max(5, g.span * 0.16)), 2.4);
  const n = (o.x + o.y) % 3;
  let drawn = null;
  if (t === 'workstation' || t === 'desk' || t === 'bigdesk') drawn = paint(ctx, 'desk', g, 0.96);
  else if (t === 'chair' || t === 'chair-back') drawn = paint(ctx, 'chair', g, 0.5, 1, o.dir === 'right' ? 'east' : 'south');
  else if (t === 'sofa') drawn = paint(ctx, 'sofa', g, 0.9, 1.25, (o.h || 1) > (o.w || 1) ? 'east' : 'south');
  else if (t === 'armchair') drawn = paint(ctx, 'seat', g, 0.7, 1, o.dir === 'right' ? 'east' : 'south');
  else if (t === 'plant') drawn = paint(ctx, n === 0 ? 'plant' : n === 1 ? 'tree' : 'bush', g, 0.5);
  else if (t === 'bookshelf') return paintRow(ctx, 'books', o, origin, 0.9);
  else if (t === 'shelves') return paintRow(ctx, 'shelf', o, origin, 0.9);
  else if (t === 'cabinet') return paintRow(ctx, 'file', o, origin, 0.9);
  else if (t === 'server') return paintRow(ctx, 'glass', o, origin, 0.9);
  else if (t === 'fridge') drawn = paint(ctx, 'fridge', g, 0.7);
  else if (t === 'lamp') drawn = paint(ctx, 'lamp', g, 0.35);
  else if (t === 'counter') drawn = paint(ctx, 'counter', g, 0.9, 1.25);
  else if (t === 'coffee' || t === 'printer') drawn = paint(ctx, 'machine', g, lift ? 0.28 : 0.55);
  else if (t === 'sink') drawn = paint(ctx, 'low', g, 0.3);
  else drawn = paint(ctx, 'file', g, 0.55);
  if (!drawn) return;
  if (t === 'workstation' || t === 'desk' || t === 'bigdesk') {
    const owner = scene?.agents?.find(a => a.id === o.owner);
    glow(ctx, drawn.x + drawn.w * 0.62, drawn.y + drawn.h * 0.22, owner?.state?.status === 'working', scene?.tick || 0);
  }
}

// ── Pessoas: formas arredondadas em vez de blocos de pixel ────────────────────

function isoPerson(ctx, gx, gy, origin, look, dir, mode, frame, sitting) {
  const p = project(gx + 0.5, gy + 0.5, origin);
  const step = frame % 2 === 1;
  const bob = mode === 'walk' ? (step ? -1.5 : 0) : (mode === 'rest' && frame % 2 === 0 ? -0.6 : 0);
  const y = p.y - (sitting ? 20 : 28) + bob;
  shadow(ctx, p.x, p.y + 1, sitting ? 7 : 6, 2.4);
  const skin = look?.skin || '#e5b088';
  const shirt = look?.shirt || '#3d7dff';
  const hair = look?.hair || '#2b1d16';
  const pants = look?.pants || '#2c3148';
  const shoe = '#2a2326';
  const shirtD = shade(shirt, 0.78);
  if (sitting && dir === 'up') {
    // de costas, as pernas ficam embaixo da mesa
  } else if (sitting) {
    rr(ctx, p.x - 6, y + 15.5, 5.5, 4, 2, pants);
    rr(ctx, p.x + 0.5, y + 15.5, 5.5, 4, 2, pants);
    rr(ctx, p.x - 6, y + 18.5, 4.5, 2.2, 1.1, shoe);
    rr(ctx, p.x + 1.5, y + 18.5, 4.5, 2.2, 1.1, shoe);
  } else {
    const ll = mode === 'walk' && step ? -1.5 : 0;
    const rl = mode === 'walk' && !step && frame ? -1.5 : 0;
    rr(ctx, p.x - 4.5, y + 15 + ll, 4, 9, 2, pants);
    rr(ctx, p.x + 0.5, y + 15 + rl, 4, 9, 2, pants);
    rr(ctx, p.x - 5, y + 22.5 + ll, 5, 2.5, 1.2, shoe);
    rr(ctx, p.x + 0.5, y + 22.5 + rl, 5, 2.5, 1.2, shoe);
  }
  // braços atrás do tronco
  const arm = mode === 'type' ? (step ? 1.5 : 0) : mode === 'talk' ? (step ? -1 : 0) : 0;
  const swing = mode === 'walk' ? (step ? 1 : -1) : 0;
  const armLen = mode === 'type' ? 5 : 7;
  rr(ctx, p.x - 8.2, y + 9.5 + swing, 3.4, armLen, 1.7, shirtD);
  rr(ctx, p.x + 4.8, y + 9.5 + arm - swing, 3.4, armLen, 1.7, shirtD);
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(p.x - 6.5, y + 9.5 + swing + armLen, 1.7, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(p.x + 6.5, y + 9.5 + arm - swing + armLen, 1.7, 0, Math.PI * 2); ctx.fill();
  // tronco
  rr(ctx, p.x - 5.8, y + 8.5, 11.6, 9, 4, shirt);
  rr(ctx, p.x + 1.5, y + 9.5, 4, 7.5, 3, shirtD);
  if (look?.suit && dir !== 'up') {
    rr(ctx, p.x - 1.5, y + 8.6, 3, 1.4, 0.7, '#f4efe6');
    rr(ctx, p.x - 0.8, y + 9.8, 1.6, 5, 0.8, '#c0392b');
  }
  if (look?.hoodie && dir === 'down') rr(ctx, p.x - 3, y + 13.5, 6, 2.2, 1, shirtD);
  // cabeça
  const hx = p.x, hy = y + 4.2;
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.08)';
  ctx.beginPath(); ctx.arc(hx + 1.2, hy + 1, 4.2, -0.3, Math.PI * 0.9); ctx.fill();
  ctx.fillStyle = hair;
  const long = look?.style === 3;
  if (dir === 'up') {
    ctx.beginPath(); ctx.arc(hx, hy - 0.2, 5.3, 0, Math.PI * 2); ctx.fill();
    if (long) rr(ctx, hx - 5.3, hy, 10.6, 7, 3, hair);
  } else {
    ctx.beginPath(); ctx.ellipse(hx, hy - 1.6, 5.5, 4.2, 0, Math.PI, Math.PI * 2); ctx.fill();
    if (dir === 'left' || dir === 'right') {
      const s = dir === 'left' ? 1 : -1;
      ctx.beginPath(); ctx.ellipse(hx + s * 2.2, hy - 0.5, 3.6, 4.6, 0, 0, Math.PI * 2); ctx.fill();
      if (long) rr(ctx, hx + s * 1 - 2.5, hy, 5, 7, 2.5, hair);
    } else {
      rr(ctx, hx - 5.4, hy - 2, 2, long ? 9 : 4.5, 1, hair);
      rr(ctx, hx + 3.4, hy - 2, 2, long ? 9 : 4.5, 1, hair);
    }
  }
  if (look?.style === 1) { ctx.beginPath(); ctx.arc(hx + 0.5, hy - 5.6, 1.8, 0, Math.PI * 2); ctx.fill(); }
  if (look?.style === 2) for (const dx of [-3, 0, 3]) { ctx.beginPath(); ctx.arc(hx + dx, hy - 5.2, 1.4, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = shade(hair, 1.35);
  ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.ellipse(hx - 1.5, hy - 4, 2.2, 0.9, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  if (dir === 'up') return;
  const eye = (ex) => {
    ctx.fillStyle = '#1f1a1c'; ctx.beginPath(); ctx.arc(ex, hy + 0.6, 0.9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + 0.3, hy + 0.3, 0.3, 0, Math.PI * 2); ctx.fill();
  };
  const talking = mode === 'talk' && step;
  if (dir === 'left' || dir === 'right') {
    const ex = dir === 'left' ? hx - 2.4 : hx + 2.4;
    eye(ex);
    if (talking) rr(ctx, ex - 0.8, hy + 2.6, 1.8, 1, 0.5, '#a84848');
  } else {
    eye(hx - 2); eye(hx + 2);
    ctx.fillStyle = 'rgba(232,120,120,.35)';
    ctx.beginPath(); ctx.arc(hx - 3.2, hy + 2, 1, 0, Math.PI * 2); ctx.arc(hx + 3.2, hy + 2, 1, 0, Math.PI * 2); ctx.fill();
    if (talking) rr(ctx, hx - 1, hy + 2.6, 2, 1.1, 0.5, '#a84848');
  }
}

function someoneNear(scene, x, y) {
  const close = e => e && !e.hidden && Math.abs(e.x - x) < 1.2 && Math.abs(e.y - y) < 1.2;
  if (close(scene.player)) return true;
  for (const e of scene.ents.values()) if (close(e)) return true;
  return false;
}

export function drawIso(ctx, world, scene) {
  const { origin, agents, ents, player, tick } = scene;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Piso e tapetes ficam por baixo de tudo, sem ordenar.
  drawBase(ctx, world, origin);
  for (const room of world.rooms) drawRoomFloor(ctx, world, room, origin, scene.focus === room.key);
  for (const o of world.objects) if (o.type === 'rug') drawRug(ctx, o, origin);

  const items = [];
  const isWall = (x, y) => x >= 0 && y >= 0 && x < world.W && y < world.H && world.floor[y][x] === 'wall';
  for (let y = 0; y < world.H; y++) for (let x = 0; x < world.W; x++) {
    if (!isWall(x, y)) continue;
    let post = 0;
    for (const [axis, nx, ny] of [['x', x + 1, y], ['y', x, y + 1]]) {
      if (!isWall(nx, ny)) continue;
      const h = wallHeight(world, axis, x, y);
      const mx = axis === 'x' ? x + 1 : x + 0.5, my = axis === 'x' ? y + 0.5 : y + 1;
      const alpha = h === WALL_MID && someoneNear(scene, mx, my - 0.5) ? 0.4 : 1;
      const win = h === WALL_TALL && (axis === 'x' ? x % 4 === 2 : y % 4 === 2);
      items.push({ z: x + y + 1.5, draw: () => drawWallSeg(ctx, origin, axis, x, y, h, alpha, win) });
    }
    for (const [axis, nx, ny, wx, wy] of [['x', x + 1, y, x, y], ['x', x - 1, y, x - 1, y], ['y', x, y + 1, x, y], ['y', x, y - 1, x, y - 1]])
      if (isWall(nx, ny)) post = Math.max(post, wallHeight(world, axis, wx, wy));
    if (post) {
      const alpha = post === WALL_MID && someoneNear(scene, x + 0.5, y) ? 0.4 : 1;
      items.push({ z: x + y + 1.55, draw: () => drawWallPost(ctx, origin, x, y, post, alpha) });
    }
  }

  for (const o of world.objects) {
    if (o.type === 'rug' || o.type === 'sign' || o.type === 'skyline') continue;
    const w = o.w || 1, h = o.h || 1;
    const onTop = (o.type === 'coffee' || o.type === 'sink')
      && world.objects.find(h => h.type === 'counter'
        && o.x >= h.x && o.x < h.x + (h.w || 1) && o.y >= h.y && o.y < h.y + (h.h || 1));
    const board = o.type === 'whiteboard' || o.type === 'tv' || o.type === 'neon';
    // A cadeira fica na frente da mesa e logo atrás de quem senta nela.
    const depth = o.type === 'chair-back' ? o.x + o.y + 0.9
      : board ? o.x + o.y + 1.6
      : onTop ? onTop.x + (onTop.w || 1) / 2 + onTop.y + (onTop.h || 1) + 0.2
      : o.x + w / 2 + o.y + h;
    items.push({ z: depth, draw: () => drawProp(ctx, world, o, origin, scene) });
  }

  const body = (gx, gy, look, dir, mode, frame, sitting) => {
    items.push({ z: gx + gy + 1, draw: () => isoPerson(ctx, gx, gy, origin, look, dir, mode, frame, sitting) });
  };
  for (const a of agents) {
    const e = ents.get(a.id);
    if (!e || e.hidden) continue;
    const st = a.state.status;
    const mode = e.moving ? 'walk'
      : st === 'working' && e.sitting ? 'type'
      : st === 'talking' ? 'talk'
      : (st === 'idle' || st === 'sleeping' || st === 'off' || st === 'done' || st === 'error') ? 'rest'
      : 'idle';
    const frame = mode === 'rest' ? Math.floor(tick / 24) % 4 : (mode === 'idle' ? 0 : tick % 4);
    body(e.x, e.y, e.look, e.dir, mode, frame, e.sitting);
  }
  const playerMode = player.moving ? 'walk' : player.sitting ? 'rest' : 'idle';
  body(player.x, player.y, player.look, player.dir, playerMode, player.moving ? player.frame : Math.floor(tick / 24) % 4, player.sitting);

  items.sort((a, b) => a.z - b.z);
  for (const item of items) item.draw();
}
