// drawCharacter, paletteFor e hash vêm de sprites.js (escopo global).

const CELL_W = 44, CELL_H = 46, WALL = 24, PAD = 6;
const ROOMS = {
  linkedin: { title: 'Estúdio LinkedIn', cols: 4, floor: ['#1d3557', '#213d63'], wall: '#14243d' },
  sales:    { title: 'Sala de Vendas',     cols: 2, floor: ['#5a3e2b', '#644632'], wall: '#3a281c' },
  skills:   { title: 'Outras skills',   cols: 3, floor: ['#2b4a3a', '#30533f'], wall: '#1c3227' },
};
const ROOM_ORDER = ['linkedin', 'sales', 'skills'];
const FALLBACK_ROOM = { cols: 3, floor: ['#3b3450', '#423a59'], wall: '#272238' };

const canvas = document.getElementById('office');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const world = document.getElementById('world');
const stage = document.getElementById('stage');

let agents = [];            // [{id, kind, label, room, description, state}]
let byId = new Map();
let scene = { rooms: [], W: 0, H: 0, scale: 2 };
let selected = null;
let tick = 0;

// ── Layout ─────────────────────────────────────────────────────────────────

function buildScene() {
  const groups = new Map();
  for (const a of agents) {
    if (!groups.has(a.room)) groups.set(a.room, []);
    groups.get(a.room).push(a);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = ROOM_ORDER.indexOf(a), ib = ROOM_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

  const availW = stage.clientWidth - 32, availH = stage.clientHeight - 32;
  const defs = keys.map(k => {
    const people = groups.get(k);
    return { key: k, ...FALLBACK_ROOM, ...ROOMS[k], title: people[0]?.roomName || ROOMS[k]?.title || k, agents: people };
  });

  // Testa alguns arranjos (tudo numa fileira, primeira sala em cima, uma por linha)
  // e fica com o que deixa os pixels maiores cabendo na tela.
  const n = defs.length;
  const arrangements = [[n], [1, n - 1], ...(n > 2 ? [[1, 1, n - 2]] : [])].filter(a => a.every(c => c > 0));
  arrangements.push(Array(n).fill(1));
  let best = null;
  for (const rowsSpec of arrangements) {
    const plan = place(defs, rowsSpec, Infinity);
    // Um pouco de rolagem vertical é ok se deixar os pixels maiores.
    const scale = Math.max(1, Math.min(4, Math.floor(availW / plan.W), Math.floor(availH * 1.3 / plan.H)));
    if (!best || scale > best.scale) best = { ...plan, scale };
  }
  // Tela estreita: uma sala por linha, com menos colunas, em escala 2
  if (best.scale < 2 && availW >= 2 * (2 * CELL_W + 2 * PAD)) {
    const cols = Math.floor((availW / 2 - PAD * 2) / CELL_W);
    best = { ...place(defs, Array(n).fill(1), cols), scale: 2 };
  }
  scene = best;
  const { W, H, scale } = scene;

  canvas.width = W * scale; canvas.height = H * scale;
  canvas.style.width = `${W * scale}px`; canvas.style.height = `${H * scale}px`;
  world.style.width = `${W * scale}px`; world.style.height = `${H * scale}px`;
  buildOverlay();
}

// rowsSpec: quantas salas em cada linha, ex. [1, 2]. Salas da mesma linha têm a mesma altura.
function place(defs, rowsSpec, maxCols) {
  const rooms = [];
  let y = 0, W = 0, i = 0;
  for (const count of rowsSpec) {
    const line = defs.slice(i, i + count).map(d => ({ ...d, cols: Math.min(d.cols, maxCols) }));
    i += count;
    const rows = Math.max(1, ...line.map(d => Math.ceil(d.agents.length / d.cols)));
    const h = WALL + rows * CELL_H + PAD;
    let x = 0;
    for (const d of line) {
      const w = d.cols * CELL_W + PAD * 2;
      const cells = [];
      for (let k = 0; k < rows * d.cols; k++) {
        cells.push({
          agent: d.agents[k] || null,
          x: x + PAD + (k % d.cols) * CELL_W,
          y: y + WALL + Math.floor(k / d.cols) * CELL_H,
          decor: hash(d.key + k) % 3,
        });
      }
      rooms.push({ ...d, x, y, w, h, cells });
      x += w + PAD;
    }
    W = Math.max(W, x - PAD);
    y += h + PAD;
  }
  return { rooms, W, H: y - PAD };
}

function buildOverlay() {
  const s = scene.scale;
  overlay.innerHTML = '';
  for (const room of scene.rooms) {
    const t = document.createElement('div');
    t.className = 'room-title';
    t.textContent = room.title;
    t.style.left = `${(room.x + PAD) * s}px`;
    t.style.top = `${(room.y + 4) * s}px`;
    t.style.fontSize = `${Math.max(7, 4 * s)}px`;
    overlay.appendChild(t);
    for (const cell of room.cells) {
      if (!cell.agent) continue;
      const a = cell.agent;
      const btn = document.createElement('button');
      btn.className = 'cell';
      btn.setAttribute('aria-label', a.label);
      Object.assign(btn.style, { left: `${cell.x * s}px`, top: `${cell.y * s}px`, width: `${CELL_W * s}px`, height: `${CELL_H * s}px` });
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = a.label;
      name.style.top = `${38 * s}px`;
      name.style.fontSize = `${Math.max(6, 3 * s)}px`;
      const bubble = document.createElement('span');
      bubble.className = 'bubble';
      bubble.hidden = true;
      bubble.style.bottom = `${(CELL_H - 4) * s}px`;
      btn.append(bubble, name);
      btn.onclick = () => openPanel(a.id);
      a._bubble = bubble;
      overlay.appendChild(btn);
      refreshBubble(a);
    }
  }
}

// ── Desenho ────────────────────────────────────────────────────────────────

function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }

function isDay() { const h = new Date().getHours(); return h >= 6 && h < 18; }

function drawRoom(room) {
  const { x, y, w, h } = room;
  // Piso xadrez
  for (let ty = y + WALL; ty < y + h; ty += 8)
    for (let tx = x; tx < x + w; tx += 8)
      rect(tx, ty, Math.min(8, x + w - tx), Math.min(8, y + h - ty), room.floor[((tx - x) / 8 + (ty - y) / 8) % 2]);
  // Parede
  rect(x, y, w, WALL, room.wall);
  rect(x, y + WALL - 3, w, 3, '#00000055');
  // Janelas
  const day = isDay();
  for (let wx = x + w - 30; wx > x + 70; wx -= 46) {
    rect(wx - 1, y + 5, 22, 14, '#0c0b12');
    rect(wx, y + 6, 20, 12, day ? '#8fd3ff' : '#1d2a4a');
    if (day) rect(wx + 13, y + 8, 4, 3, '#fff6c7');
    else for (let i = 0; i < 4; i++) rect(wx + 2 + (hash(room.key + wx + i) % 16), y + 7 + (hash(i + room.key) % 8), 1, 1, '#ffffffaa');
    rect(wx + 9, y + 6, 2, 12, '#0c0b12');
  }
  // Moldura
  ctx.strokeStyle = '#0c0b12'; ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function drawPlant(cx, cy, kind) {
  if (kind === 0) {           // planta
    rect(cx + 17, cy + 26, 10, 9, '#a0522d'); rect(cx + 16, cy + 25, 12, 2, '#b8653a');
    rect(cx + 19, cy + 14, 2, 11, '#2f8f46'); rect(cx + 15, cy + 16, 5, 3, '#3fb85c');
    rect(cx + 22, cy + 12, 6, 3, '#3fb85c'); rect(cx + 21, cy + 19, 6, 3, '#2f8f46');
  } else if (kind === 1) {    // bebedouro
    rect(cx + 17, cy + 10, 10, 9, '#9ad7ff'); rect(cx + 18, cy + 11, 3, 6, '#d6f0ff');
    rect(cx + 16, cy + 19, 12, 16, '#d9d9e0'); rect(cx + 18, cy + 22, 3, 2, '#4da3ff');
  } else {                    // estante
    rect(cx + 8, cy + 8, 28, 28, '#5b3a24');
    for (let r = 0; r < 3; r++) {
      rect(cx + 10, cy + 10 + r * 9, 24, 7, '#3b2416');
      for (let b = 0; b < 5; b++) rect(cx + 11 + b * 4, cy + 11 + r * 9 + (b % 2), 3, 6 - (b % 2), ['#c0392b', '#2980b9', '#f1c40f', '#27ae60', '#8e44ad'][(b + r) % 5]);
    }
  }
}

function drawDesk(cell) {
  const a = cell.agent;
  const { x: cx, y: cy } = cell;
  const st = a.state.status;
  const working = st === 'working';
  const absent = a.kind === 'harvey' && st === 'off';
  const sleeping = st === 'sleeping' || (st === 'idle' && Date.now() - a.state.since > 300000);
  const seed = hash(a.id);

  // Cadeira
  rect(cx + 14, cy + 9, 16, 14, '#3a3347'); rect(cx + 15, cy + 10, 14, 2, '#4a4259');

  // Personagem
  if (!absent) {
    const bob = working && (tick + seed) % 6 < 3 ? -1 : 0;
    const blink = (tick + seed) % 40 === 0;
    const talking = working && a.kind === 'harvey' && tick % 4 < 2;
    const headDown = sleeping ? 2 : 0;
    drawCharacter(ctx, a, cx + 16, cy + 9 + bob + headDown, { blink, sleeping, talk: talking });
    // Telefone no ouvido do Harvey
    if (a.kind === 'harvey' && working && Math.floor(tick / 20) % 2 === 0) {
      rect(cx + 14, cy + 12, 3, 7, '#111'); rect(cx + 13, cy + 11, 2, 3, '#111');
    }
  }

  // Mesa
  rect(cx + 3, cy + 21, 38, 3, '#c08a55');
  rect(cx + 3, cy + 24, 38, 11, '#8a5a33');
  rect(cx + 3, cy + 34, 38, 1, '#5e3c20');
  rect(cx + 5, cy + 35, 3, 4, '#5e3c20'); rect(cx + 36, cy + 35, 3, 4, '#5e3c20');
  rect(cx + 18, cy + 26, 8, 2, '#6d4526');

  // Mãos
  if (!absent && !sleeping) {
    const t = working ? (tick + seed) % 4 : 0;
    const skin = drawCharacterSkin(a);
    rect(cx + 17, cy + 20 - (t === 1 ? 1 : 0), 3, 2, skin);
    rect(cx + 24, cy + 20 - (t === 3 ? 1 : 0), 3, 2, skin);
  }

  // Monitor (virado pra você)
  const mx = cx + 28, my = cy + 9;
  rect(mx + 4, my + 10, 3, 3, '#2a2a33'); rect(mx + 1, my + 12, 9, 1, '#2a2a33');
  rect(mx - 1, my - 1, 13, 11, '#2a2a33');
  const scr = (c) => rect(mx, my, 11, 9, c);
  if (absent) scr('#111');
  else if (st === 'error') { scr('#5a1a1a'); rect(mx + 5, my + 1, 1, 5, '#ff6b6b'); rect(mx + 5, my + 7, 1, 1, '#ff6b6b'); }
  else if (st === 'done') { scr('#163a1f'); [[2,4],[3,5],[4,6],[5,5],[6,4],[7,3],[8,2]].forEach(([px, py]) => rect(mx + px, my + py, 1, 1, '#6bd968')); }
  else if (working) {
    scr('#0e1a2b');
    for (let l = 0; l < 4; l++) {
      const len = 2 + ((hash(a.id + (tick + l * 3)) >> (l * 2)) % 8);
      rect(mx + 1, my + 1 + l * 2, len, 1, ['#4da3ff', '#ffcc4d', '#7bd88f', '#c792ea'][(l + Math.floor(tick / 3)) % 4]);
    }
  } else if (a.room === 'linkedin') { scr('#0a1f33'); rect(mx + 3, my + 2, 5, 5, '#0a66c2'); rect(mx + 4, my + 3, 1, 3, '#fff'); rect(mx + 6, my + 4, 1, 2, '#fff'); }
  else if (a.kind === 'harvey') { scr('#1a1410'); rect(mx + 2, my + 6, 1, 2, '#6bd968'); rect(mx + 4, my + 4, 1, 4, '#6bd968'); rect(mx + 6, my + 5, 1, 3, '#6bd968'); rect(mx + 8, my + 2, 1, 6, '#6bd968'); }
  else scr(sleeping ? '#0b0b10' : '#16202e');

  // Objetos da mesa
  if (a.kind === 'harvey') {
    rect(cx + 6, cy + 18, 7, 3, '#111'); rect(cx + 7, cy + 17, 5, 1, '#333');
    const pending = (window.harveyOutbox || 0);
    rect(cx + 4, cy + 25, 9, 6, '#d9d9e0');
    for (let i = 0; i < Math.min(pending, 4); i++) rect(cx + 5, cy + 30 - i * 2, 7, 1, '#fffbe9');
  } else {
    const mugC = ['#e8e4d8', '#ff7a59', '#4da3ff'][seed % 3];
    rect(cx + 7, cy + 17, 4, 4, mugC); rect(cx + 11, cy + 18, 1, 2, mugC);
    if (working && tick % 8 < 4) rect(cx + 8, cy + 14 - (tick % 4), 1, 2, '#ffffff55');
  }

  // Partículas / zzz
  if (working && !absent) {
    for (let i = 0; i < 3; i++) {
      const p = (tick * 2 + i * 9 + seed) % 24;
      rect(mx + 2 + ((seed >> i) % 8), my - 2 - p, 1, 1, ['#ffcc4d', '#4da3ff', '#7bd88f'][i]);
    }
  }
  if (sleeping && !absent) {
    const p = tick % 30;
    ctx.fillStyle = '#ffffffaa';
    ctx.font = '6px monospace';
    ctx.fillText('z', cx + 28 + p / 6, cy + 8 - p / 3);
    if (p > 12) ctx.fillText('z', cx + 31 + p / 8, cy + 5 - (p - 12) / 3);
  }
}

function drawCharacterSkin(a) { return window.Sprites.paletteFor(a).S; }

function render() {
  const s = scene.scale;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.imageSmoothingEnabled = false;
  rect(0, 0, scene.W, scene.H, '#12111a');
  for (const room of scene.rooms) {
    drawRoom(room);
    for (const cell of room.cells) cell.agent ? drawDesk(cell) : drawPlant(cell.x, cell.y, cell.decor);
  }
}

let last = 0;
function loop(t) {
  if (t - last > 110) { tick++; last = t; render(); }
  requestAnimationFrame(loop);
}

// ── Estado / bolhas ────────────────────────────────────────────────────────

function bubbleText(a) {
  const s = a.state;
  const lastLine = s.log[s.log.length - 1];
  const recent = lastLine && Date.now() - lastLine.t < 6000;
  switch (s.status) {
    case 'working': return (recent && lastLine.text.startsWith('💬')) ? lastLine.text.slice(2).trim() : (s.tool || 'trabalhando…');
    case 'done': return '✓ pronto';
    case 'error': return '✗ deu erro';
    case 'sleeping': return 'esperando o próximo ciclo';
    default: return '';
  }
}

function refreshBubble(a) {
  if (!a._bubble) return;
  const text = bubbleText(a);
  a._bubble.hidden = !text;
  a._bubble.textContent = text;
  a._bubble.className = `bubble ${a.state.status}`;
}

function setAgents(list) {
  const oldIds = agents.map(a => a.id).join();
  agents = list;
  byId = new Map(agents.map(a => [a.id, a]));
  if (oldIds !== agents.map(a => a.id).join() || !scene.rooms.length) buildScene();
  if (selected) renderPanel(true);
  else buildOverlay();
}

const ticker = document.getElementById('ticker');
function connect() {
  const es = new EventSource('/events');
  const conn = document.getElementById('conn');
  es.addEventListener('snapshot', e => { setAgents(JSON.parse(e.data)); conn.classList.add('on'); ticker.textContent = `${agents.length} agentes no escritório. Clique em alguém.`; });
  es.addEventListener('reload', refreshAgents);
  es.addEventListener('agent', e => {
    const { id, state, line } = JSON.parse(e.data);
    const a = byId.get(id);
    if (!a) { refreshAgents(); return; }
    a.state = state;
    refreshBubble(a);
    if (line) ticker.textContent = `${a.label} · ${line}`;
    if (selected === id) renderPanel();
  });
  es.onerror = () => conn.classList.remove('on');
}

async function refreshAgents() {
  try { setAgents(await (await fetch('/api/agents')).json()); } catch {}
}
setInterval(refreshAgents, 30000);
setInterval(() => agents.forEach(refreshBubble), 2000);
window.addEventListener('resize', () => { clearTimeout(window._rz); window._rz = setTimeout(buildScene, 150); });

// ── Painel ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const panel = $('panel');
const STATUS_PT = { idle: 'livre', working: 'trabalhando', done: 'pronto', error: 'erro', sleeping: 'em pausa', off: 'desligado' };

function post(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office': '1' }, body: JSON.stringify(body || {}) }).then(r => r.json());
}

function openPanel(id) {
  selected = id;
  panel.hidden = false;
  renderPanel(true);
  if (byId.get(id)?.kind === 'harvey') loadHarvey();
  else $('p-input').focus();
}

function renderPanel(full) {
  const a = byId.get(selected);
  if (!a) return;
  const s = a.state;
  $('p-name').textContent = a.label;
  $('p-cargo').textContent = a.cargo || '';
  $('p-status').textContent = STATUS_PT[s.status] || s.status;
  $('p-status').className = `pill ${s.status}`;
  if (full) {
    $('p-desc').textContent = a.description;
    const pc = $('portrait').getContext('2d');
    pc.clearRect(0, 0, 12, 13);
    drawCharacter(pc, a, 0, 0);
  }
  const isHarvey = a.kind === 'harvey';
  $('p-skill').hidden = isHarvey;
  $('p-harvey').hidden = !isHarvey;
  $('p-run').disabled = !!s.running;
  $('p-stop').disabled = !s.running;
  $('p-result-wrap').hidden = !s.result;
  $('p-result').textContent = s.result || '';
  const log = $('p-log');
  log.innerHTML = '';
  for (const l of s.log.slice(-40)) {
    const li = document.createElement('li');
    const time = document.createElement('time');
    time.textContent = new Date(l.t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    li.append(time, l.text);
    log.appendChild(li);
  }
  if (!s.log.length) log.innerHTML = '<li>Nada ainda. Mande trabalhar ou use a skill no Claude Code.</li>';
}

$('close').onclick = () => { panel.hidden = true; selected = null; };
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('close').onclick(); });

$('p-run').onclick = async () => {
  const text = $('p-input').value.trim();
  const r = await post(`/api/agents/${encodeURIComponent(selected)}/run`, { text });
  if (!r.ok) ticker.textContent = r.message;
  else $('p-input').value = '';
};
$('p-input').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('p-run').onclick(); });
$('p-stop').onclick = () => post(`/api/agents/${encodeURIComponent(selected)}/stop`);
$('p-copy').onclick = () => navigator.clipboard.writeText($('p-result').textContent).then(() => { $('p-copy').textContent = 'Copiado'; setTimeout(() => $('p-copy').textContent = 'Copiar', 1200); });

async function loadHarvey() {
  try {
    const h = await (await fetch('/api/harvey')).json();
    const ob = h.outbox || {};
    window.harveyOutbox = (ob.pending_review || 0) + (ob.approved || 0);
    $('h-stats').innerHTML = '';
    for (const [label, n] of [['p/ revisar', ob.pending_review || 0], ['aprovados', ob.approved || 0], ['enviados', ob.sent || 0]]) {
      const d = document.createElement('div');
      d.className = 'stat';
      d.innerHTML = `<b>${n}</b><span>${label}</span>`;
      $('h-stats').appendChild(d);
    }
    $('h-start').disabled = !!h.pid;
    $('h-stop').disabled = !h.pid;
  } catch {}
}
setInterval(() => { if (byId.get(selected)?.kind === 'harvey') loadHarvey(); }, 4000);
$('h-start').onclick = async () => { const r = await post('/api/harvey/start'); ticker.textContent = r.success ? 'Harvey ligado.' : r.message; loadHarvey(); };
$('h-dash').onclick = async () => {
  const win = window.open('about:blank', '_blank');
  ticker.textContent = 'Abrindo o dashboard do Harvey…';
  const r = await post('/api/harvey/dashboard');
  if (r.success) { if (win) win.location = 'http://127.0.0.1:5555'; ticker.textContent = 'Dashboard do Harvey aberto.'; }
  else { win?.close(); ticker.textContent = r.message; }
};
$('h-stop').onclick = async () => { const r = await post('/api/harvey/stop'); ticker.textContent = r.success ? 'Harvey desligado.' : r.message; loadHarvey(); };

loadHarvey();
connect();
requestAnimationFrame(loop);
