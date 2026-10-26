// Mapa compacto do escritório: cabe inteiro na tela. Salas coladas, portas entre elas,
// mesas individuais (o agente senta atrás, de frente pra você) e cantos de descanso.
export const ROOM_LABELS = {
  recep: 'Recepção',
  meeting: 'Reuniões',
  pausa: 'Lounge',
  varanda: 'Varanda',
  apollo: 'Apollo Leads',
  cron: 'Automações',
  skills: 'Laboratório IA',
  cursor: 'Desenvolvimento',
  sales: 'Comercial',
  ig: 'Instagram',
  li: 'LinkedIn',
  deposito: 'Arquivos',
};

export function roomLabel(key, fallback = '') {
  return ROOM_LABELS[key] || fallback || key;
}

export const TILE = 16;

const FLOORS = {
  woodWarm:     ['#8a5a3c', '#7f5236', '#5e3b26'],
  wood:         ['#9a6a45', '#8f6140', '#6b4429'],
  deck:         ['#7a5c44', '#6f533d', '#4f3a2a'],
  carpetDark:   ['#3d4560', '#414a66', '#2c3349'],
  carpetGray:   ['#5b5470', '#625a78', '#443e56'],
  carpetGreen:  ['#2f5a48', '#33604d', '#22443a'],
  carpetCursor: ['#4b4380', '#51498a', '#383163'],
  concrete:     ['#686c76', '#70747d', '#53565e'],
  apollo:       ['#14325f', '#1a4178', '#6ea2e8', '#d5e6ff'],
};
const PLANKS = new Set(['woodWarm', 'wood', 'deck']);

// Cantos onde os agentes vão descansar quando estão livres.
export const REST_ROOMS = new Set(['recep', 'pausa', 'varanda']);
const FLOOR_OF = { apollo: 'apollo', sales: 'wood', cursor: 'carpetCursor', skills: 'carpetGreen', li: 'carpetDark', deposito: 'concrete' };
const FLOOR_CYCLE = ['carpetDark', 'wood', 'carpetCursor', 'carpetGreen', 'carpetGray'];

// Geometria da estação: mesa de 3 tiles na linha y, cadeira logo abaixo (o agente senta
// de frente pro monitor, de costas pra câmera) e corredor depois.
// Mesas se juntam em ilhas de até 3; entre ilhas fica 1 tile de corredor.
const ISLAND = 3;
const MIN_ROOM_W = 7;
const TOP_H = 8;
const deskCols = (n, rows) => Math.max(1, Math.ceil(n / rows));
const islandsWidth = cols => cols * 3 + Math.ceil(cols / ISLAND) - 1;
// parede + corredor + ilhas + corredor + parede
const roomWidth = (n, rows) => Math.max(MIN_ROOM_W, islandsWidth(deskCols(n, rows)) + 4);
// parede + fileira encostada na parede do fundo + (cadeira, mesa, corredor) por fileira + parede
const roomHeight = rows => rows * 3 + 3;

// Decoração encostada na parede do fundo, por sala. [tipo, largura, extra]
const THEME = {
  ig:       [['whiteboard', 3, { label: 'mural' }], ['lamp', 1], ['tv', 3], ['lamp', 1], ['bookshelf', 2]],
  apollo:   [['whiteboard', 3, { label: 'funil' }], ['bookshelf', 2], ['cabinet', 2], ['whiteboard', 3, { label: 'metas' }]],
  cursor:   [['tv', 3], ['bookshelf', 2], ['bookshelf', 2], ['cabinet', 1]],
  cron:     [['server', 1], ['server', 1], ['server', 1], ['cabinet', 2], ['tv', 3]],
  skills:   [['bookshelf', 3], ['whiteboard', 3, { label: 'ideias' }], ['bookshelf', 2]],
  sales:    [['whiteboard', 3, { label: 'pipeline' }], ['cabinet', 2]],
  deposito: [['shelves', 3], ['cabinet', 2], ['printer', 1], ['cabinet', 1]],
};
const THEME_DEFAULT = [['bookshelf', 2], ['whiteboard', 3], ['cabinet', 1]];

// Distribui as salas de trabalho em faixas horizontais da largura W.
// Cada faixa tem uma altura (fileiras de mesas) e as salas nela são largas o bastante
// pra ter uma mesa por agente. A última sala da faixa estica até a borda.
function planBands(items, W) {
  const left = [...items];
  const bands = [];
  while (left.length) {
    let best = null;
    for (let rows = 1; rows <= 6; rows++) {
      const picked = [];
      let used = 0;
      for (const it of left) {
        const w = roomWidth(it.n, rows);
        const add = picked.length ? w - 1 : w;
        if (used + add > W) continue;
        if (Math.ceil(it.n / deskCols(it.n, rows)) > rows) continue;
        picked.push(it); used += add;
      }
      if (!picked.length) continue;
      const score = picked.reduce((s, it) => s + it.n + 0.5, 0) / (roomHeight(rows) - 1);
      if (!best || score > best.score + 1e-9) best = { rows, picked, score };
    }
    if (!best) best = { rows: 6, picked: [left[0]] };
    for (const it of best.picked) left.splice(left.indexOf(it), 1);
    bands.push(best);
  }
  return bands;
}

function layoutWork(items, W) {
  const bands = planBands(items, W);
  const rects = [];
  let y = TOP_H - 1;
  for (const b of bands) {
    const h = roomHeight(b.rows);
    let x = 0;
    b.picked.forEach((it, i) => {
      const last = i === b.picked.length - 1;
      const w = last ? W - x : roomWidth(it.n, b.rows);
      rects.push({ ...it, x, y, w, h, rows: b.rows });
      x += w - 1;
    });
    y += h - 1;
  }
  return { rects, H: y + 1 };
}

export function buildWorld(agents) {
  const byRoom = new Map();
  for (const a of agents) {
    const r = a.room || 'skills';
    if (!byRoom.has(r)) byRoom.set(r, []);
    byRoom.get(r).push(a);
  }
  const work = [...byRoom.entries()]
    .map(([key, list]) => ({ key, n: list.length, name: list[0].roomName || key, agents: list }))
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  work.forEach((item, i) => { item.floor = FLOOR_OF[item.key] || FLOOR_CYCLE[i % FLOOR_CYCLE.length]; });
  work.push({ key: 'deposito', n: 0, name: 'Depósito / Arquivos', agents: [], floor: 'concrete' });

  // Escolhe a largura que deixa o mapa mais "quadrado" (no isométrico, W + H é o tamanho na tela).
  let plan = null;
  for (let w = 32; w <= 48; w++) {
    const p = layoutWork(work, w);
    if (!plan || w + p.H < plan.W + plan.H) plan = { ...p, W: w };
  }
  const { W, H } = plan;

  const floor = Array.from({ length: H }, () => Array(W).fill('wall'));
  const solid = Array.from({ length: H }, () => Array(W).fill(true));
  const objects = [];
  const rooms = [];
  const seats = new Map();
  const spots = [];                // {x, y, dir, sit, room, kind}
  const used = new Set();
  const doorFront = new Set();     // tiles logo depois de uma porta: nada pode tampar
  const key = (x, y) => `${x},${y}`;

  const mark = (x, y, w, h, isSolid) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { used.add(key(i, j)); if (isSolid) solid[j][i] = true; }
  };
  const free = (x, y, w = 1, h = 1) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++)
      if (j < 0 || i < 0 || j >= H || i >= W || solid[j][i] || used.has(key(i, j)) || doorFront.has(key(i, j))) return false;
    return true;
  };
  const obj = (o, isSolid = true) => { objects.push(o); mark(o.x, o.y, o.w || 1, o.h || 1, isSolid); };
  const spot = (x, y, dir, sit, room, kind) => { spots.push({ x, y, dir, sit, room, kind }); used.add(key(x, y)); };

  function room(k, name, x, y, w, h, f) {
    rooms.push({ key: k, name, displayName: roomLabel(k, name), x, y, w, h, floor: f });
    for (let j = y + 1; j < y + h - 1; j++) for (let i = x + 1; i < x + w - 1; i++) { floor[j][i] = f; solid[j][i] = false; }
  }
  const door = (x, y, w, h, f) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      floor[j][i] = f; solid[j][i] = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) doorFront.add(key(i + dx, j + dy));
    }
  };

  // O prédio (recepção, reunião, pausa, varanda) existe sempre. A varanda estica até a borda.
  room('recep',   'Recepção',        0,  0, 10, TOP_H, 'woodWarm');
  room('meeting', 'Sala de Reunião', 9,  0,  9, TOP_H, 'carpetGray');
  room('pausa',   'Área de Pausa',   17, 0,  9, TOP_H, 'woodWarm');
  room('varanda', 'Varanda',         25, 0, W - 25, TOP_H, 'deck');

  door(9, 3, 1, 2, 'woodWarm');
  door(17, 3, 1, 2, 'woodWarm');
  door(25, 3, 1, 2, 'deck');

  const connectRooms = (a, b) => {
    if (a.y + a.h - 1 === b.y || b.y + b.h - 1 === a.y) {
      const y = Math.max(a.y, b.y);
      const x0 = Math.max(a.x, b.x) + 1;
      const x1 = Math.min(a.x + a.w, b.x + b.w) - 1;
      if (x1 > x0) door(x0, y, Math.min(2, x1 - x0), 1, 'wood');
    }
    if (a.x + a.w - 1 === b.x || b.x + b.w - 1 === a.x) {
      const x = Math.max(a.x, b.x);
      const y0 = Math.max(a.y, b.y) + 1;
      const y1 = Math.min(a.y + a.h, b.y + b.h) - 1;
      if (y1 > y0) door(x, y0, 1, Math.min(2, y1 - y0), 'wood');
    }
  };

  for (const rect of plan.rects) room(rect.key, rect.name, rect.x, rect.y, rect.w, rect.h, rect.floor);
  const top = rooms.filter(r => r.y === 0);
  for (const a of plan.rects) for (const b of [...plan.rects, ...top]) if (a !== b) connectRooms(a, b);

  // ── Estações de trabalho em ilhas, centralizadas na sala ──
  const workstation = (id, x, y, roomKey) => {
    obj({ type: 'workstation', x: x - 1, y, w: 3, h: 1, owner: id });
    obj({ type: 'chair-back', x, y: y + 1, owner: id }, false);
    seats.set(id, { x, y: y + 1, dir: 'up', room: roomKey, mon: { x, y } });
  };
  const grid = rect => {
    let cols = rect.agents.length ? deskCols(rect.agents.length, rect.rows) : 1;
    if (!rect.agents.length) while (islandsWidth(cols + 1) + 4 <= rect.w) cols++;
    const rows = rect.agents.length ? Math.ceil(rect.agents.length / cols) : rect.rows;
    const x0 = rect.x + 2 + Math.floor((rect.w - 4 - islandsWidth(cols)) / 2);
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
      cells.push({ x: x0 + c * 3 + Math.floor(c / ISLAND) + 1, y: rect.y + 2 + r * 3 });
    return cells;
  };
  const decorateWork = rect => {
    // Fileira do fundo: tema da sala, centralizado, com 1 tile de folga entre as peças.
    const items = THEME[rect.key] || THEME_DEFAULT;
    const y = rect.y + 1;
    const fits = [];
    let width = 0;
    for (const it of items) {
      const add = (fits.length ? 1 : 0) + it[1];
      if (width + add > rect.w - 4) break;
      fits.push(it); width += add;
    }
    let x = rect.x + 2 + Math.floor((rect.w - 4 - width) / 2);
    for (const [type, w, extra] of fits) {
      if (free(x, y, w)) obj({ type, x, y, w, h: 1, ...(extra || {}) }, false);
      x += w + 1;
    }
    for (const [px, kind] of [[rect.x + 1, 'plant'], [rect.x + rect.w - 2, 'plant']]) {
      if (free(px, rect.y + rect.h - 2)) obj({ type: kind, x: px, y: rect.y + rect.h - 2 }, false);
    }
  };
  for (const rect of plan.rects) {
    const cells = grid(rect);
    if (rect.key === 'deposito' && !rect.agents.length) {
      cells.forEach((c, i) => obj({ type: i % 2 ? 'cabinet' : 'shelves', x: c.x - 1, y: c.y, w: 3, h: 1 }));
    } else {
      rect.agents.forEach((a, i) => workstation(a.id, cells[i].x, cells[i].y, rect.key));
    }
    decorateWork(rect);
  }

  // ── Decoração por sala ──
  // Recepção
  obj({ type: 'neon', x: 2, y: 0, w: 6, h: 1 }, false);
  obj({ type: 'rug', x: 2, y: 2, w: 6, h: 4, color: '#7a3b3b' }, false);
  // Os móveis só olham pro sul ou pro leste: o sofá fica atrás da mesa de centro, a poltrona à esquerda.
  obj({ type: 'sofa', x: 2, y: 2, w: 4, h: 1, dir: 'down', color: '#3b4a7a' }, false);
  for (let i = 0; i < 4; i++) spot(2 + i, 2, 'down', true, 'recep', 'sofa');
  obj({ type: 'coffeetable', x: 3, y: 4, w: 3, h: 1 });
  obj({ type: 'armchair', x: 2, y: 4, dir: 'right' }, false); spot(2, 4, 'right', true, 'recep', 'poltrona');
  obj({ type: 'plant', x: 1, y: 1 }); obj({ type: 'plant', x: 8, y: 1 }); obj({ type: 'lamp', x: 1, y: 6 });

  // Sala de reunião
  obj({ type: 'whiteboard', x: 11, y: 0, w: 5, h: 1 }, false);
  // Cadeiras no lado norte e no oeste da mesa, todas de frente pra ela.
  obj({ type: 'table', x: 12, y: 3, w: 4, h: 2 });
  for (const x of [12, 13, 14, 15]) { obj({ type: 'chair', x, y: 2, dir: 'down' }, false); spot(x, 2, 'down', true, 'meeting', 'reuniao'); }
  for (const y of [3, 4]) { obj({ type: 'chair', x: 11, y, dir: 'right' }, false); spot(11, y, 'right', true, 'meeting', 'reuniao'); }
  obj({ type: 'plant', x: 10, y: 1 }); obj({ type: 'plant', x: 16, y: 6 });

  // Área de pausa
  obj({ type: 'counter', x: 18, y: 1, w: 4, h: 1 });
  obj({ type: 'coffee', x: 19, y: 1 }, false); obj({ type: 'sink', x: 21, y: 1 }, false);
  obj({ type: 'fridge', x: 23, y: 1 });
  spot(19, 2, 'up', false, 'pausa', 'cafe'); spot(20, 2, 'up', false, 'pausa', 'cafe');
  // Sofá em pé no lado oeste, de frente pra sinuca; o corredor da porta (x=18) fica livre.
  obj({ type: 'pool', x: 21, y: 3, w: 4, h: 2 });
  spot(20, 4, 'right', false, 'pausa', 'sinuca'); spot(23, 5, 'up', false, 'pausa', 'sinuca');
  obj({ type: 'sofa', x: 19, y: 3, w: 1, h: 4, dir: 'right', color: '#8a4b3a' }, false);
  for (let i = 0; i < 4; i++) spot(19, 3 + i, 'right', true, 'pausa', 'sofa');
  obj({ type: 'lamp', x: 24, y: 6 });

  // Varanda
  obj({ type: 'skyline', x: 25, y: 0, w: W - 25, h: 1 }, false);
  obj({ type: 'roundtable', x: 27, y: 3, w: 2, h: 2 });
  obj({ type: 'chair', x: 26, y: 3, dir: 'right' }, false); spot(26, 3, 'right', true, 'varanda', 'mesa');
  obj({ type: 'chair', x: 27, y: 2, dir: 'down' }, false); spot(27, 2, 'down', true, 'varanda', 'mesa');
  if (W - 25 >= 11) {
    obj({ type: 'roundtable', x: 32, y: 3, w: 2, h: 2 });
    obj({ type: 'chair', x: 31, y: 3, dir: 'right' }, false); spot(31, 3, 'right', true, 'varanda', 'mesa');
    obj({ type: 'chair', x: 32, y: 2, dir: 'down' }, false); spot(32, 2, 'down', true, 'varanda', 'mesa');
  }
  obj({ type: 'plant', x: W - 2, y: 1 }); obj({ type: 'plant', x: 26, y: 6 }); obj({ type: 'lamp', x: W - 2, y: 6 });

  // Lugares pra passear em cada sala
  const wander = {};
  for (const r of rooms) {
    wander[r.key] = [];
    for (let j = r.y + 1; j < r.y + r.h - 1; j++) for (let i = r.x + 1; i < r.x + r.w - 1; i++)
      if (!solid[j][i] && !used.has(key(i, j))) wander[r.key].push({ x: i, y: j });
  }

  return { W, H, floor, solid, objects, rooms, seats, spots, wander, spawn: { x: 6, y: 6 }, FLOORS, PLANKS };
}

// Busca em largura no grid (4 direções). Retorna lista de tiles sem o ponto de partida.
export function findPath(world, from, to) {
  const { W, H, solid } = world;
  const sx = Math.round(from.x), sy = Math.round(from.y);
  if (to.x < 0 || to.y < 0 || to.x >= W || to.y >= H || solid[to.y][to.x]) return null;
  const prev = new Map();
  const q = [[sx, sy]];
  const k = (x, y) => y * W + x;
  prev.set(k(sx, sy), null);
  while (q.length) {
    const [x, y] = q.shift();
    if (x === to.x && y === to.y) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || solid[ny][nx] || prev.has(k(nx, ny))) continue;
      prev.set(k(nx, ny), [x, y]);
      q.push([nx, ny]);
    }
  }
  if (!prev.has(k(to.x, to.y))) return null;
  const path = [];
  let cur = [to.x, to.y];
  while (cur && !(cur[0] === sx && cur[1] === sy)) { path.unshift({ x: cur[0], y: cur[1] }); cur = prev.get(k(cur[0], cur[1])); }
  return path;
}

export function roomAt(world, x, y) {
  const r = world.rooms.find(r => x > r.x && x < r.x + r.w - 1 && y > r.y && y < r.y + r.h - 1);
  return r ? r.displayName : 'Corredor';
}
