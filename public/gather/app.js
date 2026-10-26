import { TILE, REST_ROOMS, buildWorld, findPath, roomAt } from './world.js?v=vira2';

const MAX_ON_BREAK = 3;   // quantos agentes livres podem estar fora da mesa ao mesmo tempo
import { drawAvatar, drawPortrait, lookFor, hash } from './chars.js?v=apollo';
import { drawFloor, drawWalls, drawObject, drawDeskTop } from './render.js?v=barra3';
import { drawIso, isoMapSize, project, unproject } from './iso.js?v=vira2';

const $ = id => document.getElementById(id);
const canvas = $('world');
const ctx = canvas.getContext('2d');

const STATUS = {
  idle: ['livre', 'ok'], working: ['trabalhando', 'busy'], talking: ['conversando', 'talk'], done: ['terminou', 'ok'],
  error: ['deu erro', 'bad'], sleeping: ['em pausa', 'away'], off: ['desligado', 'off'],
};

let agents = [];
let byId = new Map();
let world = null;
const ents = new Map();          // id -> entidade no mapa
const player = { id: 'voce', look: lookFor({ kind: 'player' }), x: 16, y: 12, path: [], dir: 'down', frame: 0, moving: false };
const chats = {};                // id -> {messages, busy}
const unread = new Set();
let openChat = null;
let harveyOutbox = {};
let tick = 0;
let scale = 3;
const cam = { x: 0, y: 0 };
let isoOn = localStorage.getItem('escritorio-iso') !== '0';
let isoLayout = null;
let camMode = 'fit';
let eatClick = false;
let hoverAgentId = null;
const taken = new Set();         // spots ocupados

// ── Mundo e entidades ──────────────────────────────────────────────────────

function rebuild() {
  world = buildWorld(agents);
  isoLayout = isoMapSize(world);
  for (const a of agents) {
    let e = ents.get(a.id);
    const seat = world.seats.get(a.id);
    if (!e) {
      const spare = world.wander[a.room] || [];
      const spot = spare.length ? spare[hash(a.id) % spare.length] : world.spawn;
      e = { id: a.id, x: seat?.x ?? spot.x, y: seat?.y ?? spot.y, path: [], dir: seat?.dir || 'down', frame: 0, sitting: !!seat, next: performance.now() + Math.random() * 6000, emote: null, spot: null };
      ents.set(a.id, e);
    }
    e.look = lookFor(a);
    e.seat = seat;
  }
  for (const id of [...ents.keys()]) if (!byId.has(id)) ents.delete(id);
  if (!rebuild.done) { Object.assign(player, { x: world.spawn.x, y: world.spawn.y }); rebuild.done = true; }
  resize();
  renderPeople();
  renderRooms();
}

function walkable(x, y) { return world && y >= 0 && x >= 0 && y < world.H && x < world.W && !world.solid[y][x]; }

function goTo(e, tx, ty) {
  const p = findPath(world, { x: Math.round(e.x), y: Math.round(e.y) }, { x: tx, y: ty });
  if (!p) return false;
  if (e === player) standUp();
  e.path = p;
  e.sitting = false;
  return true;
}

function releaseSpot(e) { if (e.spot) { taken.delete(`${e.spot.x},${e.spot.y}`); e.spot = null; } }

function stepEntity(e, dt, speed) {
  if (!e.path.length) { e.moving = false; return; }
  const n = e.path[0];
  const dx = n.x - e.x, dy = n.y - e.y;
  const d = Math.hypot(dx, dy);
  const s = speed * dt;
  if (dx || dy) e.dir = faceFromDelta(dx, dy);
  if (d <= s) { e.x = n.x; e.y = n.y; e.path.shift(); } else { e.x += dx / d * s; e.y += dy / d * s; }
  e.moving = true;
  e.walkT = (e.walkT || 0) + dt;
  e.frame = Math.floor(e.walkT * 8) % 4;
}

function agentBrain(a, e, now) {
  const st = a.state.status;
  e.hidden = a.kind === 'harvey' && st === 'off';
  if (e.hidden) { e.path = []; return; }
  const chatting = openChat === a.id;
  // Harvey em pausa (sleeping) ainda está com o processo no ar: fica na mesa.
  // Só passeia quando está livre (idle). Desligado continua invisível.
  const harveyPlanted = a.kind === 'harvey' && st !== 'idle' && st !== 'off';
  const busy = harveyPlanted || st === 'working' || (st === 'talking' && !chatting);
  if (st !== e.lastStatus) {
    if (st === 'done') e.emote = { text: '✓', until: now + 6000, kind: 'ok' };
    if (st === 'error') e.emote = { text: '!', until: now + 8000, kind: 'bad' };
    e.lastStatus = st;
  }
  const atSeat = e.seat && Math.round(e.x) === e.seat.x && Math.round(e.y) === e.seat.y && !e.path.length;

  const chair = meeting?.chairs?.get(a.id);
  if (chair) {
    releaseSpot(e);
    e.onBreak = false;
    const there = Math.round(e.x) === chair.x && Math.round(e.y) === chair.y && !e.path.length;
    if (there) { e.sitting = true; e.dir = chair.dir; }
    else if (!e.path.length || e.goal !== 'meet') { goTo(e, chair.x, chair.y); e.goal = 'meet'; }
    return;
  }

  if (busy && e.seat) {
    releaseSpot(e);
    e.onBreak = false;
    if (atSeat) { e.sitting = true; e.dir = e.seat.dir; }
    else if (!e.path.length || e.goal !== 'seat') { goTo(e, e.seat.x, e.seat.y); e.goal = 'seat'; }
    return;
  }
  if (chatting) {
    // para onde está e espera você chegar
    if (e.path.length) { const n = e.path[0]; e.path = [n]; e.arrive = null; }
    if (!e.path.length && !e.sitting) {
      const dx = player.x - e.x, dy = player.y - e.y;
      e.dir = faceFromDelta(dx, dy);
    }
    return;
  }
  if (e.path.length) return;
  if (e.arrive) { e.sitting = e.arrive.sit; e.dir = e.arrive.dir; e.arrive = null; }
  if (now < e.next) return;

  // Livre fica na mesa. De vez em quando alguém faz uma pausa (copa, varanda, recepção)
  // e volta; no máximo MAX_ON_BREAK ao mesmo tempo, pra o escritório não virar um formigueiro.
  releaseSpot(e);
  e.goal = 'wander';
  if (!e.seat) {
    const tiles = world.wander[a.room] || [];
    const t = tiles[Math.floor(Math.random() * tiles.length)];
    if (t) goTo(e, t.x, t.y);
    e.next = now + 15000 + Math.random() * 15000;
    return;
  }
  const atDesk = Math.round(e.x) === e.seat.x && Math.round(e.y) === e.seat.y;
  if (e.onBreak || !atDesk) {
    e.onBreak = false;
    goTo(e, e.seat.x, e.seat.y); e.arrive = { sit: true, dir: e.seat.dir };
    e.next = now + 40000 + Math.random() * 50000;
    return;
  }
  const away = [...ents.values()].filter(o => o.onBreak).length;
  if (away < MAX_ON_BREAK && Math.random() < 0.15) {
    const free = world.spots.filter(s => REST_ROOMS.has(s.room) && !taken.has(`${s.x},${s.y}`));
    const s = free[Math.floor(Math.random() * free.length)];
    if (s && goTo(e, s.x, s.y)) {
      taken.add(`${s.x},${s.y}`); e.spot = s; e.arrive = { sit: s.sit, dir: s.dir }; e.onBreak = true;
      e.next = now + 25000 + Math.random() * 35000;
      return;
    }
  }
  e.sitting = true; e.dir = e.seat.dir;
  e.next = now + 30000 + Math.random() * 40000;
}

// ── Entrada do jogador ─────────────────────────────────────────────────────

const keys = new Set();
const KEYMAP = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
const ISO_KEY = { ArrowUp: [-1, -1], KeyW: [-1, -1], ArrowDown: [1, 1], KeyS: [1, 1], ArrowLeft: [-1, 1], KeyA: [-1, 1], ArrowRight: [1, -1], KeyD: [1, -1] };

function faceFromDelta(dx, dy) {
  if (!isoOn) {
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy >= 0 ? 'down' : 'up';
  }
  const scrx = dx - dy, scry = dx + dy;
  if (Math.abs(scry) >= Math.abs(scrx)) return scry >= 0 ? 'down' : 'up';
  return scrx > 0 ? 'right' : 'left';
}
let pendingChat = null;

addEventListener('keydown', e => {
  if (e.target.closest('textarea, input')) return;
  if (KEYMAP[e.code]) { keys.add(e.code); player.path = player.path.slice(0, 1); if (player.sitting || player.arrive) standUp(); approach = null; look = null; if (isoOn && camMode !== 'fit') camMode = 'follow'; e.preventDefault(); }
  if (e.code === 'KeyE') useNearby();
  if (e.code === 'Escape') closeChat();
});
addEventListener('keyup', e => keys.delete(e.code));

function playerInput() {
  if (player.path.length) return;
  for (const k of keys) {
    const base = (isoOn ? ISO_KEY : KEYMAP)[k];
    if (!base) continue;
    const [dx, dy] = base;
    player.dir = faceFromDelta(dx, dy);
    const options = isoOn ? [[dx, dy], [dx, 0], [0, dy]] : [[dx, dy]];
    for (const [mx, my] of options) {
      if (!mx && !my) continue;
      const nx = Math.round(player.x) + mx, ny = Math.round(player.y) + my;
      if (walkable(nx, ny)) { standUp(); player.path = [{ x: nx, y: ny }]; break; }
    }
    break;
  }
}

function screenPoint(ev) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (ev.clientX - rect.left) / scale + cam.x,
    y: (ev.clientY - rect.top) / scale + cam.y,
  };
}

function screenToTile(ev) {
  const p = screenPoint(ev);
  if (isoOn && isoLayout) return unproject(p.x, p.y, isoLayout.origin);
  return { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE), fx: p.x / TILE, fy: p.y / TILE };
}

function isoAgentAt(ev) {
  if (!isoOn || !isoLayout) return null;
  const p = screenPoint(ev);
  let best = null, bestD = 1e9;
  for (const [id, e] of ents) {
    if (e.hidden) continue;
    const feet = project(e.x + 0.5, e.y + 0.5, isoLayout.origin);
    const dx = p.x - feet.x;
    const dy = p.y - (feet.y - 12);
    if (Math.abs(dx) > 12 || dy < -16 || dy > 14) continue;
    const d = dx * dx + dy * dy;
    if (d < bestD) { best = id; bestD = d; }
  }
  return best;
}

function roomsAt(x, y) {
  return world?.rooms.filter(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || [];
}

function roomByTile(x, y) {
  return roomsAt(x, y)[0] || null;
}

canvas.addEventListener('mousemove', ev => {
  const t = screenToTile(ev);
  const hit = isoAgentAt(ev);
  const hot = !!hit || world?.spots.some(s => s.sit && s.x === t.x && s.y === t.y)
    || world?.objects.some(o => interactKind(o) && t.x >= o.x && t.x < o.x + (o.w || 1) && t.y >= o.y && t.y < o.y + (o.h || 1));
  canvas.style.cursor = eatClick ? 'grabbing' : hot || roomByTile(t.x, t.y) ? 'pointer' : 'default';
  const tip = $('iso-tip');
  hoverAgentId = hit;
  if (!tip) return;
  const agent = hit && agents.find(a => a.id === hit);
  if (!agent || eatClick) { tip.hidden = true; return; }
  tip.hidden = false;
  tip.style.left = `${ev.clientX}px`;
  tip.style.top = `${ev.clientY}px`;
  const st = STATUS[agent.state.status];
  tip.querySelector('b').textContent = agent.label;
  tip.querySelector('small').textContent = `${agent.cargo || 'Agente'} · ${st?.[0] || agent.state.status || 'livre'}`;
});

function sameRoom(ax, ay, bx, by) {
  const ra = roomByTile(Math.round(ax), Math.round(ay));
  const rb = roomByTile(Math.round(bx), Math.round(by));
  if (ra && rb) return ra.key === rb.key;
  if (!ra && !rb) return Math.hypot(ax - bx, ay - by) < 3.2;
  return false;
}

function interactKind(o) {
  const keys = new Set([...roomsAt(o.x, o.y), ...roomsAt(o.x, o.y + 1)].map(r => r.key));
  if ((o.type === 'table' || o.type === 'whiteboard' || o.type === 'whiteboard-stand') && keys.has('meeting')) return 'meet';
  if (o.type === 'tv' && keys.has('meeting')) return 'meet';
  if (o.type === 'tv' && keys.has('cursor')) return 'cursor';
  if (o.type === 'coffee') return 'cafe';
  if (o.type === 'chair' || o.type === 'sofa' || o.type === 'beanbag') return 'sit';
  return null;
}

function standUp() {
  if (player.spot) taken.delete(`${player.spot.x},${player.spot.y}`);
  player.spot = null;
  player.sitting = false;
  player.arrive = null;
}

function spotTaken(s) {
  if (player.spot && player.spot.x === s.x && player.spot.y === s.y) return false;
  if (taken.has(`${s.x},${s.y}`)) return true;
  for (const e of ents.values()) if (e.sitting && Math.round(e.x) === s.x && Math.round(e.y) === s.y) return true;
  return false;
}

function sitOn(spot) {
  if (player.sitting && player.spot && player.spot.x === spot.x && player.spot.y === spot.y) { standUp(); return; }
  if (spotTaken(spot)) { toast('Esse lugar está ocupado.'); return; }
  if (Math.round(player.x) === spot.x && Math.round(player.y) === spot.y && !player.path.length) {
    standUp();
    player.sitting = !!spot.sit;
    player.dir = spot.dir || 'down';
    player.spot = spot;
    taken.add(`${spot.x},${spot.y}`);
    return;
  }
  if (goTo(player, spot.x, spot.y)) player.arrive = spot;
  else toast('Não dá pra sentar aí.');
}

function nearestHot() {
  if (!world) return null;
  let best = null, bestD = 1.8;
  for (const o of world.objects) {
    if (!interactKind(o)) continue;
    const d = Math.hypot(o.x + (o.w || 1) / 2 - player.x - 0.5, o.y + (o.h || 1) / 2 - player.y - 0.5);
    if (d < bestD) { best = o; bestD = d; }
  }
  return best;
}

function useObject(o) {
  const kind = interactKind(o);
  if (kind === 'meet') { const r = world.rooms.find(r => r.key === 'meeting'); if (r) openRoom(r); return; }
  if (kind === 'cursor') { const r = world.rooms.find(r => r.key === 'cursor'); if (r) openRoom(r); return; }
  if (kind === 'cafe') {
    const spots = world.spots.filter(s => s.kind === 'cafe');
    const s = spots.sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0];
    if (s) sitOn({ ...s, sit: true });
    return;
  }
  if (kind === 'sit') {
    const s = world.spots.find(s => s.x === o.x && s.y === o.y) || { x: o.x, y: o.y, dir: o.dir || 'down', sit: true };
    sitOn(s);
  }
}

function useNearby() {
  if (player.sitting) { standUp(); return; }
  const o = nearestHot();
  if (o) { useObject(o); return; }
  if (nearest) {
    const e = ents.get(nearest.id);
    if (e && sameRoom(player.x, player.y, e.x, e.y)) openChatWith(nearest.id);
  }
}

canvas.addEventListener('click', ev => {
  if (eatClick) { eatClick = false; return; }
  const hit = isoAgentAt(ev);
  if (hit) { look = null; walkToAgent(hit); openChatWith(hit); return; }
  const t = screenToTile(ev);
  for (const [id, e] of ents) {
    if (e.hidden) continue;
    if (Math.abs(t.fx - (e.x + 0.5)) < 0.7 && t.fy > e.y - 0.9 && t.fy < e.y + 1.1) { look = null; walkToAgent(id); openChatWith(id); return; }
  }
  const spot = world?.spots.find(s => s.sit && s.x === t.x && s.y === t.y);
  if (spot) { sitOn(spot); return; }
  const obj = world?.objects.find(o => interactKind(o) && t.x >= o.x && t.x < o.x + (o.w || 1) && t.y >= o.y && t.y < o.y + (o.h || 1));
  if (obj) { useObject(obj); return; }
  const room = roomByTile(t.x, t.y);
  if (room) { openRoom(room); return; }
  approach = null;
  look = null;
  if (walkable(t.x, t.y)) goTo(player, t.x, t.y);
});

let look = null;
let meeting = null;  // { ids, chairs, lines, running, busy }

function assignChairs(ids) {
  const chairs = (world?.spots || []).filter(s => s.kind === 'reuniao');
  const map = new Map();
  ids.forEach((id, i) => { if (chairs[i]) map.set(id, chairs[i]); });
  return map;
}

function renderRooms() {
  const bar = $('rooms');
  if (!bar || !world) return;
  bar.innerHTML = '';
  for (const room of world.rooms) {
    const b = document.createElement('button');
    b.textContent = room.displayName;
    b.dataset.key = room.key;
    b.onclick = () => openRoom(room);
    bar.appendChild(b);
  }
}

function openRoom(room) {
  look = { key: room.key, x: room.x + room.w / 2, y: room.y + room.h / 2, until: performance.now() + 60000 };
  if (isoOn) {
    camMode = 'room';
    frameRoom(room);
  }
  for (const b of $('rooms').querySelectorAll('button')) b.classList.toggle('on', b.dataset.key === room.key);
  if (room.key === 'meeting') openTeam();
  else if (room.key === 'cursor') { /* cada conversa é uma pessoa; E abre o chat dela */ }
}

function frameRoom(room) {
  if (!isoLayout) return;
  const o = isoLayout.origin;
  const pts = [
    project(room.x, room.y, o),
    project(room.x + room.w, room.y, o),
    project(room.x + room.w, room.y + room.h, o),
    project(room.x, room.y + room.h, o),
  ];
  const bw = Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x));
  const bh = Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y)) + 40;
  const ins = contentInsets();
  const availW = Math.max(160, innerWidth - ins.left - ins.right);
  const availH = Math.max(160, innerHeight - ins.top - ins.bottom);
  const lim = zoomLimits();
  scale = Math.min(lim.max, Math.max(lim.fit, Math.min(availW / bw, availH / bh) * 0.78));
  centerIso(room.x + room.w / 2, room.y + room.h / 2);
}

function appendTeamLine(label, text, mine, attachments) {
  const log = $('team-log');
  const row = document.createElement('div');
  row.className = `msg ${mine ? 'user' : 'assistant'}`;
  row.innerHTML = `<div class="from"></div>${chipsHtml(attachments)}<div class="body"></div>`;
  row.querySelector('.from').textContent = label;
  row.querySelector('.body').textContent = text;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

function teamSeated() {
  $('team-seat').hidden = true;
  $('team-send').hidden = false;
}

function onMeeting(ev) {
  if (ev.type === 'start') {
    meeting = { ids: ev.ids, chairs: assignChairs(ev.ids), lines: new Map(), running: true, busy: false };
    if (!$('team-log').childElementCount) {
      for (const line of ev.lines || []) appendTeamLine(line.label, line.text, line.id === 'voce', line.attachments);
    }
    teamSeated();
    openTeam();
  } else if (ev.type === 'say' && meeting) {
    if (ev.id !== 'voce') meeting.lines.set(ev.id, ev.text);
    appendTeamLine(ev.label, ev.text, ev.id === 'voce', ev.attachments);
    if (ev.id === 'voce') meeting.busy = true;
  } else if (ev.type === 'note') {
    appendTeamLine('Reunião', ev.text, false);
  } else if (ev.type === 'file') {
    const log = $('team-log');
    const link = document.createElement('a');
    link.className = 'file';
    link.href = `/arquivos/${encodeURIComponent(ev.name)}`;
    link.target = '_blank';
    link.textContent = `📄 ${ev.name}`;
    log.appendChild(link);
    log.scrollTop = log.scrollHeight;
  } else if (ev.type === 'idle' && meeting) {
    meeting.busy = false;
  } else if (ev.type === 'done') {
    meeting = null;
    $('team-seat').hidden = false;
    $('team-send').hidden = true;
  }
}

function openTeam() {
  document.body.classList.add('side-open', 'team');
  document.body.classList.remove('chatting', 'resumo');
  openChat = null;
  resize();
  const box = $('team-people');
  if (!box.childElementCount) {
    for (const a of agents) {
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" value="${a.id}"> <span></span>`;
      label.querySelector('span').textContent = a.label;
      if (meeting?.ids?.includes(a.id)) label.querySelector('input').checked = true;
      box.appendChild(label);
    }
  }
}

function closeTeam() {
  document.body.classList.remove('team');
  resize();
}

async function seatTeam() {
  const ids = [...$('team-people').querySelectorAll('input:checked')].map(el => el.value);
  if (ids.length < 2) { toast('Escolhe pelo menos duas pessoas.'); return; }
  const r = await post('/api/meeting', { ids });
  if (!r.ok) toast(r.message);
}

async function sendTeam() {
  const text = $('team-input').value.trim();
  const attachments = takeAttachments('team');
  if (!text && !attachments.length) return;
  $('team-input').value = '';
  const r = await post('/api/meeting/say', { text, attachments });
  if (!r.ok) toast(r.message);
}

let meName = 'Você';
let approach = null;  // agente que você está indo encontrar
function followApproach() {
  const e = approach && ents.get(approach);
  if (!e) { approach = null; return; }
  const d = Math.hypot(e.x - player.x, e.y - player.y);
  if (d <= 1.6) { approach = null; return; }
  if (!player.path.length && !walkToAgent(approach, true)) approach = null;
}

function walkToAgent(id, keep) {
  if (!keep) approach = id;
  const e = ents.get(id);
  if (!e) return;
  const ex = Math.round(e.x), ey = Math.round(e.y);
  const options = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [0, 2], [2, 0], [-2, 0]]
    .map(([dx, dy]) => ({ x: ex + dx, y: ey + dy })).filter(p => walkable(p.x, p.y));
  for (const o of options) if (goTo(player, o.x, o.y)) return true;
  return false;
}

// ── Loop ───────────────────────────────────────────────────────────────────

let nearest = null;
let last = performance.now();

function contentInsets() {
  const side = sidePx();
  const narrow = innerWidth <= 760;
  return {
    left: narrow ? 12 : 158,
    right: side + 12,
    top: narrow ? 92 : 18,
    bottom: narrow ? 80 : 120,
  };
}

function zoomLimits() {
  if (!isoLayout) return { min: 0.35, max: 3, fit: 1 };
  const ins = contentInsets();
  const availW = Math.max(180, innerWidth - ins.left - ins.right);
  const availH = Math.max(180, innerHeight - ins.top - ins.bottom);
  const fit = Math.min(availW / isoLayout.w, availH / isoLayout.h) * 0.98;
  return { min: Math.max(0.2, fit * 0.55), max: Math.max(fit * 2.6, 2.2), fit };
}

function frameOffice() {
  if (!isoLayout) return;
  const ins = contentInsets();
  const lim = zoomLimits();
  scale = lim.fit;
  const cx = (ins.left + innerWidth - ins.right) / 2;
  const cy = (ins.top + innerHeight - ins.bottom) / 2;
  cam.x = isoLayout.w / 2 - cx / scale;
  cam.y = isoLayout.h / 2 - cy / scale;
}

function centerIso(gx, gy) {
  if (!isoLayout) return;
  const ins = contentInsets();
  const p = project(gx, gy, isoLayout.origin);
  const cx = (ins.left + innerWidth - ins.right) / 2;
  const cy = (ins.top + innerHeight - ins.bottom) / 2;
  cam.x = p.x - cx / scale;
  cam.y = p.y - cy / scale;
}

function zoomAt(factor, cssX, cssY) {
  const lim = zoomLimits();
  const worldX = cssX / scale + cam.x;
  const worldY = cssY / scale + cam.y;
  scale = Math.max(lim.min, Math.min(lim.max, scale * factor));
  cam.x = worldX - cssX / scale;
  cam.y = worldY - cssY / scale;
  camMode = 'free';
  localStorage.setItem('escritorio-zoom', String(Math.round(scale * 1000) / 1000));
}

function resize() {
  const w = innerWidth, h = innerHeight;
  canvas.width = w * devicePixelRatio; canvas.height = h * devicePixelRatio;
  canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  if (isoOn && isoLayout && camMode === 'fit') frameOffice();
  else if (!(isoOn && isoLayout)) {
    const mapW = (world?.W || 44) * TILE, mapH = (world?.H || 24) * TILE;
    scale = mapW * 3 <= w - 16 && mapH * 3 <= h - 16 ? 3 : 2;
  }
}
addEventListener('resize', resize);
resize();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick = Math.floor(now / 90);
  if (world) {
    playerInput();
    followApproach();
    stepEntity(player, dt, 6.8);
    if (!player.moving) player.frame = 0;
    if (!player.moving && player.arrive) {
      const s = player.arrive;
      player.arrive = null;
      if (Math.round(player.x) === s.x && Math.round(player.y) === s.y && !spotTaken(s)) {
        player.sitting = !!s.sit;
        player.dir = s.dir || 'down';
        player.spot = s;
        taken.add(`${s.x},${s.y}`);
      } else if (spotTaken(s)) toast('Esse lugar está ocupado.');
    }
    for (const a of agents) {
      const e = ents.get(a.id);
      if (!e) continue;
      agentBrain(a, e, now);
      stepEntity(e, dt, 3.2);
      if (!e.moving) e.frame = 0;
    }
    updateProximity();
    draw(now);
  }
  requestAnimationFrame(frame);
}

function updateProximity() {
  let best = null, bestD = 2.2;
  for (const a of agents) {
    const e = ents.get(a.id);
    if (!e || e.hidden || !sameRoom(player.x, player.y, e.x, e.y)) continue;
    const d = Math.hypot(e.x - player.x, e.y - player.y);
    if (d < bestD) { best = a; bestD = d; }
  }
  if (pendingChat && best?.id === pendingChat) pendingChat = null;
  if (best?.id !== nearest?.id) {
    nearest = best;
    const card = $('prox');
    card.hidden = !best || openChat === best?.id;
    if (best) {
      $('prox-name').textContent = best.label;
      $('prox-cargo').textContent = best.cargo || '';
      drawPortrait($('prox-face'), lookFor(best));
    }
  } else if (nearest) $('prox').hidden = openChat === nearest.id;
  $('here').textContent = roomAt(world, Math.round(player.x), Math.round(player.y));
  const hint = $('hint');
  if (hint) {
    const hot = nearestHot();
    const kind = hot && interactKind(hot);
    const label = player.sitting ? '<kbd>E</kbd> pra levantar'
      : kind === 'meet' ? '<kbd>E</kbd> abre a reunião'
      : kind === 'cursor' ? '<kbd>E</kbd> abre o Cursor'
      : kind === 'cafe' ? '<kbd>E</kbd> pra uma pausa'
      : kind === 'sit' ? '<kbd>E</kbd> pra sentar'
      : nearest ? '<kbd>E</kbd> pra conversar'
      : '<kbd>WASD</kbd> anda · clique na cadeira senta · <kbd>E</kbd> usa o que está na frente';
    if (hint.dataset.k !== label) { hint.dataset.k = label; hint.innerHTML = label; }
  }
}

function sidePx() {
  if (!document.body.classList.contains('side-open') || innerWidth <= 760) return 0;
  return 300;
}

function drawIsoView(now) {
  if (camMode === 'fit') frameOffice();
  else if (camMode === 'room' && look && now < look.until) centerIso(look.x, look.y);
  else if (camMode === 'follow') centerIso(player.x + 0.5, player.y + 0.5);

  const k = scale * devicePixelRatio;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#12141f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k);
  ctx.imageSmoothingEnabled = false;
  drawIso(ctx, world, {
    origin: isoLayout.origin, agents, ents, player, tick,
    nearestId: nearest?.id || null, meName: `${meName} (você)`,
    focus: camMode === 'room' && look ? look.key : null,
  });

  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  const S = (gx, gy) => {
    const p = project(gx, gy, isoLayout.origin);
    return [(p.x - cam.x) * scale, (p.y - cam.y) * scale];
  };
  const far = scale < zoomLimits().fit * 0.72;
  const overview = scale <= zoomLimits().fit * 1.08;
  const occupied = (x, y) => world.objects.some(o => o.type !== 'rug' && o.type !== 'sign' && o.type !== 'skyline'
      && x >= o.x && x < o.x + (o.w || 1) && y >= o.y && y < o.y + (o.h || 1))
    || [...ents.values()].some(e => !e.hidden && Math.round(e.x) === x && Math.round(e.y) === y);
  for (const room of world.rooms) {
    const mid = Math.round(room.x + room.w / 2);
    const back = room.y + 1;
    let gx = mid + 0.5, gy = back + 0.15;
    let found = false;
    for (let d = 0; d < room.w && !found; d++) {
      for (const x of [mid - d, mid + d]) {
        if (x <= room.x + 1 || x >= room.x + room.w - 2) continue;
        if (!occupied(x, back) && !occupied(x - 1, back) && !occupied(x + 1, back)) {
          gx = x + 0.5; gy = back + 0.15; found = true; break;
        }
      }
    }
    const [x, y] = S(gx, gy);
    const active = camMode === 'room' && look?.key === room.key;
    const lift = Math.round(8 + (found ? 14 : 20) * Math.min(scale, 2.4));
    if (!far && x > -40 && y > -20 && x < innerWidth + 40 && y < innerHeight + 20) label(room.displayName, x, y - lift, active);
  }
  const hover = hoverAgentId;
  for (const a of agents) {
    const e = ents.get(a.id);
    if (!e || e.hidden) continue;
    const [fx, fy] = S(e.x + 0.5, e.y + 0.5);
    const head = fy - Math.max(14, 12 * scale);
    const st = a.state.status;
    const dot = { working: '#ffd166', talking: '#7b9bff', error: '#ff5d73', done: '#06d6a0', off: '#8a8fa8', sleeping: '#c3a4ff' }[st] || '#06d6a0';
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(fx, head, overview ? 2.2 : 2.8, 0, Math.PI * 2);
    ctx.fill();
    const working = st === 'working';
    const named = working || (!overview && (hover === a.id || nearest?.id === a.id || (st && st !== 'idle' && st !== 'off' && st !== 'sleeping')));
    if (named) nameTag(a.label, fx, head - 14, STATUS[st]?.[1] || 'ok', hover === a.id || nearest?.id === a.id);
    const b = bubbleFor(a, e, now);
    // Balão de tarefa só pra quem você está olhando (mouse, perto ou na mesma sala); o resto mostra só o nome.
    const focused = hover === a.id || nearest?.id === a.id || (!overview && sameRoom(player.x, player.y, e.x, e.y));
    const showBubble = b && (focused || (e.emote && now < e.emote.until));
    if (showBubble) bubble(b.text, fx, head - (named ? 30 : 16), b.kind);
    if (unread.has(a.id)) { ctx.fillStyle = '#ff5d73'; ctx.beginPath(); ctx.arc(fx + 7, head, 2.2, 0, Math.PI * 2); ctx.fill(); }
  }
  {
    const [px, py] = S(player.x + 0.5, player.y + 0.5);
    const head = py - Math.max(14, 12 * scale);
    ctx.fillStyle = '#8ef0c4';
    ctx.beginPath();
    ctx.arc(px, head, 2.2, 0, Math.PI * 2);
    ctx.fill();
    if (!overview) nameTag('você', px, head - 14, 'me', false);
  }
  const here = roomByTile(Math.round(player.x), Math.round(player.y));
  if (!overview && here?.key === 'cursor') {
    const tv = world.objects.find(o => o.type === 'tv' && roomsAt(o.x, o.y).concat(roomsAt(o.x, o.y + 1)).some(r => r.key === 'cursor'));
    const task = agents.filter(a => a.kind === 'cursor' && a.state?.status === 'working').map(a => a.state.task).filter(Boolean).join(' · ');
    if (tv && task) {
      const [x, y] = S(tv.x + (tv.w || 1) / 2, tv.y + (tv.h || 1) / 2);
      bubble(task, x, y - 20 * scale, 'busy');
    }
  }
}

function draw(now) {
  if (isoOn && isoLayout) { drawIsoView(now); return; }
  const side = sidePx();
  const vw = Math.max(160, (innerWidth - side) / scale), vh = innerHeight / scale;
  const mapW = world.W * TILE, mapH = world.H * TILE;
  const focus = look && now < look.until ? look : player;
  const tx = (focus.x + 0.5) * TILE - vw / 2, ty = (focus.y + 0.5) * TILE - vh / 2;
  cam.x = mapW < vw ? (mapW - vw) / 2 : Math.max(0, Math.min(mapW - vw, tx));
  cam.y = mapH < vh ? (mapH - vh) / 2 : Math.max(0, Math.min(mapH - vh, ty));
  cam.x = Math.round(cam.x * scale) / scale; cam.y = Math.round(cam.y * scale) / scale;

  const k = scale * devicePixelRatio;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1b1e33';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k);
  ctx.imageSmoothingEnabled = false;

  const working = agents.filter(a => a.state.status === 'working').length;
  const info = { tick, harvey: harveyOutbox, working };
  drawFloor(ctx, world);
  for (const o of world.objects) if (o.type === 'rug') drawObject(ctx, o, info);
  drawWalls(ctx, world);

  // Ordena móveis e pessoas pela base (y) pra dar profundidade
  const items = [];
  for (const o of world.objects) if (o.type !== 'rug') items.push({ y: o.y + (o.h || 1) - 0.01, draw: () => drawObject(ctx, o, info) });
  for (const a of agents) {
    const seat = world.seats.get(a.id);
    if (seat) {
      const mon = seat.mon || { x: seat.x, y: seat.y + 1 };
      const status = a.kind === 'harvey' && a.state.status === 'off' ? 'off' : a.state.status === 'talking' ? 'idle' : a.state.status;
      items.push({ y: mon.y + 1, draw: () => drawDeskTop(ctx, { ...seat, mon }, status, tick) });
    }
    const e = ents.get(a.id);
    if (e && !e.hidden) {
      const typing = e.sitting && (a.state.status === 'working' || a.state.status === 'talking');
      const frame = typing ? (tick % 4) : e.frame;
      items.push({ y: e.y + (e.sitting && e.dir === 'down' ? 0.4 : 0.6), draw: () => drawAvatar(ctx, e.x * TILE, e.y * TILE + (e.sitting ? 2 : 0), e.look, e.dir, frame, e.sitting, typing) });
    }
  }
  items.push({ y: player.y + (player.sitting ? 0.4 : 0.6), draw: () => drawAvatar(ctx, player.x * TILE, player.y * TILE + (player.sitting ? 2 : 0), player.look, player.dir, player.frame, !!player.sitting) });
  items.sort((p, q) => p.y - q.y).forEach(i => i.draw());
  const hot = nearestHot();
  if (hot) {
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = 1;
    ctx.strokeRect(hot.x * TILE + 1, hot.y * TILE + 1, (hot.w || 1) * TILE - 2, (hot.h || 1) * TILE - 2);
  }

  // Camada de texto (em pixels de tela, nítido)
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  const S = (x, y) => [(x * TILE - cam.x) * scale, (y * TILE - cam.y) * scale];
  for (const room of world.rooms) {
    const [x, y] = S(room.x + room.w / 2, room.y + 0.28);
    label(room.displayName, x, y);
  }
  {
    const sign = world.objects.find(o => o.type === 'sign');
    if (sign) { const [x, y] = S(sign.x + sign.w / 2, sign.y + 0.5); centered('Escritório Pixel', x, y, 'sign'); }
  }
  for (const a of agents) {
    const e = ents.get(a.id);
    if (!e || e.hidden) continue;
    const [hx, hy] = S(e.x + 0.5, e.y - 0.35);
    const [fx, fy] = S(e.x + 0.5, e.y + 1.05);
    const st = a.state.status;
    const named = nearest?.id === a.id || (st && st !== 'idle' && st !== 'off' && st !== 'sleeping');
    if (named) nameTag(a.label, fx, fy, STATUS[st]?.[1] || 'ok', nearest?.id === a.id);
    const b = sameRoom(player.x, player.y, e.x, e.y) ? bubbleFor(a, e, now) : null;
    if (b) bubble(b.text, hx, hy, b.kind);
    if (unread.has(a.id)) { ctx.fillStyle = '#ff5d73'; ctx.beginPath(); ctx.arc(fx + 8, fy + 4, 3, 0, Math.PI * 2); ctx.fill(); }
  }
  const [px, py] = S(player.x + 0.5, player.y + 1.05);
  nameTag(`${meName} (você)`, px, py, 'me', false);
  const here = roomByTile(Math.round(player.x), Math.round(player.y));
  if (here?.key === 'cursor') {
    const tv = world.objects.find(o => o.type === 'tv' && roomsAt(o.x, o.y).concat(roomsAt(o.x, o.y + 1)).some(r => r.key === 'cursor'));
    const task = agents.filter(a => a.kind === 'cursor' && a.state?.status === 'working').map(a => a.state.task).filter(Boolean).join(' · ');
    if (tv && task) {
      const [x, y] = S(tv.x + (tv.w || 1) / 2, tv.y - 0.15);
      bubble(task, x, y, 'busy');
    }
  }
}

function bubbleFor(a, e, now) {
  const st = a.state.status;
  if (e.emote && now < e.emote.until) return { text: e.emote.text, kind: e.emote.kind };
  if (meeting?.lines?.has(a.id)) return { text: meeting.lines.get(a.id), kind: 'talk' };
  if (st === 'working') {
    const task = String(a.state.task || '').replace(/\s+/g, ' ').trim();
    const tool = String(a.state.tool || '').replace(/\s+/g, ' ').trim();
    const what = a.kind === 'cursor'
      ? (tool || task)
      : (task && tool && tool !== task ? `${task} — ${tool}` : (task || tool));
    return { text: what || 'trabalhando…', kind: 'busy' };
  }
  if (chats[a.id]?.busy || (st === 'talking')) return { text: 'digitando' + '.'.repeat(1 + (tick >> 3) % 3), kind: 'talk' };
  if (a.kind === 'harvey' && st === 'sleeping') return { text: 'em pausa', kind: 'plain' };
  return null;
}

function roundRect(x, y, w, h, rad) {
  ctx.beginPath();
  ctx.moveTo(x + rad, y); ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad); ctx.closePath();
}

const DOT = { ok: '#06d6a0', busy: '#ffd166', talk: '#7b9bff', bad: '#ff5d73', away: '#c3a4ff', off: '#8a8fa8', me: '#06d6a0' };

function nameTag(text, x, y, status, hl) {
  ctx.font = '700 11px "DM Sans", system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.lineWidth = 3; ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(28,22,16,.9)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = hl ? '#ffe08a' : '#fff';
  ctx.fillText(text, x, y);
  ctx.fillStyle = DOT[status] || DOT.ok;
  ctx.beginPath(); ctx.arc(x - ctx.measureText(text).width / 2 - 6, y + 6, 3, 0, Math.PI * 2); ctx.fill();
  ctx.textAlign = 'left';
}

function bubble(text, x, y, kind) {
  ctx.font = '500 12px "DM Sans", system-ui, sans-serif';
  let t = text;
  while (ctx.measureText(t).width > 210 && t.length > 4) t = t.slice(0, -2);
  if (t !== text) t = t.trimEnd() + '…';
  const w = Math.max(28, ctx.measureText(t).width + 16);
  const bg = { busy: '#fff4d1', talk: '#e3e8ff', ok: '#d6f7ea', bad: '#ffd9de', plain: '#ffffff' }[kind] || '#fff';
  roundRect(x - w / 2, y - 20, w, 20, 8);
  ctx.fillStyle = bg; ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.fill();
  ctx.fillStyle = '#1d2040'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(t, x, y - 10);
  ctx.textAlign = 'left';
}

function label(text, x, y, active) {
  ctx.font = `${active ? 700 : 600} ${active ? 12 : 10}px "DM Sans", system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width + (active ? 16 : 12));
  const h = active ? 18 : 15;
  x = Math.round(x - w / 2);
  y = Math.round(y - h);
  const ins = contentInsets();
  x = Math.max(ins.left + 6, Math.min(innerWidth - ins.right - w - 6, x));
  y = Math.max(ins.top + 6, Math.min(innerHeight - ins.bottom - h - 6, y));
  roundRect(x, y, w, h, 4);
  ctx.fillStyle = active ? 'rgba(16,18,28,.88)' : 'rgba(16,18,28,.66)';
  ctx.fill();
  ctx.fillStyle = '#f6f1e8';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + (active ? 8 : 6), y + h / 2);
}

function centered(text, x, y) {
  ctx.font = `800 ${Math.round(4 * scale + 4)}px "DM Sans", system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y); ctx.textAlign = 'left';
}

// ── Lista de pessoas ───────────────────────────────────────────────────────

function roomTitle(key) {
  return world?.rooms.find(r => r.key === key)?.displayName || agents.find(a => a.room === key)?.roomName || key;
}

function renderPeople() {
  const list = $('people');
  list.innerHTML = '';
  const groups = new Map();
  for (const a of agents) {
    const r = world?.seats.get(a.id)?.room || 'skills';
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(a);
  }
  $('count').textContent = agents.length;
  const order = ['li', 'sales', 'cursor', 'skills'];
  const roomGroups = [...groups].sort((a, b) => (order.indexOf(a[0]) + 1 || 9) - (order.indexOf(b[0]) + 1 || 9));
  for (const [r, list2] of roomGroups) list2.sort((a, b) => (a.state?.status === 'working' ? 0 : 1) - (b.state?.status === 'working' ? 0 : 1));
  for (const [r, list2] of roomGroups) {
    const h = document.createElement('div');
    h.className = 'group';
    h.textContent = `${roomTitle(r)} · ${list2.length}`;
    list.appendChild(h);
    for (const a of list2) {
      const row = document.createElement('button');
      row.className = 'person';
      row.dataset.id = a.id;
      row.innerHTML = `<canvas width="32" height="32"></canvas><span class="who"><b></b><small></small></span><span class="dot"></span>`;
      drawPortrait(row.querySelector('canvas'), lookFor(a));
      row.querySelector('b').textContent = a.label;
      row.onclick = () => { walkToAgent(a.id); openChatWith(a.id); };
      list.appendChild(row);
      refreshPerson(a);
    }
  }
  filterPeople();
  refreshCounts();
}

function filterPeople() {
  const q = ($('people-filter')?.value || '').trim().toLowerCase();
  for (const row of document.querySelectorAll('#people .person')) {
    const a = byId.get(row.dataset.id);
    const hay = `${a?.label || ''} ${a?.cargo || ''} ${a?.id || ''} ${a?.state?.task || ''} ${a?.state?.tool || ''}`.toLowerCase();
    row.hidden = !!q && !hay.includes(q);
  }
  for (const g of document.querySelectorAll('#people .group')) {
    let n = g.nextElementSibling;
    let any = false;
    while (n && !n.classList.contains('group')) {
      if (n.classList.contains('person') && !n.hidden) any = true;
      n = n.nextElementSibling;
    }
    g.hidden = !any;
  }
}

function refreshPerson(a) {
  const row = document.querySelector(`.person[data-id="${CSS.escape(a.id)}"]`);
  if (!row) return;
  const [txt, cls] = STATUS[a.state.status] || ['', 'ok'];
  const task = String(a.state.task || '').replace(/\s+/g, ' ').trim();
  const tool = String(a.state.tool || '').replace(/\s+/g, ' ').trim();
  const st = a.state.status;
  const line = st === 'working'
    ? (a.kind === 'cursor' ? (tool || task || 'trabalhando') : (task && tool && tool !== task ? `${task} — ${tool}` : (task || tool || 'trabalhando')))
    : (!st || st === 'idle') ? (a.cargo || '')
    : (tool ? `${txt} — ${tool}` : `${a.cargo ? `${a.cargo} · ` : ''}${txt}`);
  row.querySelector('small').textContent = line;
  row.querySelector('.dot').className = `dot ${cls}${unread.has(a.id) ? ' unread' : ''}`;
}

function refreshCounts() {
  const busy = agents.filter(a => a.state.status === 'working');
  $('busy').textContent = busy.length
    ? `${busy.map(a => a.label).slice(0, 3).join(', ')} trabalhando`
    : 'ninguém trabalhando agora';
}

// ── Chat ───────────────────────────────────────────────────────────────────

function post(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office': '1' }, body: JSON.stringify(body || {}) }).then(r => r.json());
}

async function openChatWith(id) {
  const a = byId.get(id);
  if (!a) return;
  openChat = id;
  unread.delete(id);
  refreshPerson(a);
  document.body.classList.add('chatting', 'side-open');
  document.body.classList.remove('team', 'resumo');
  $('prox').hidden = true;
  $('chat-name').textContent = a.label;
  $('chat-cargo').textContent = a.cargo || '';
  drawPortrait($('chat-face'), lookFor(a));
  $('harvey-actions').hidden = a.kind !== 'harvey';
  $('input').placeholder = a.kind === 'harvey' ? 'Pergunte do pipeline, prospects, e-mails…' : `Fale com ${a.label} ou peça uma tarefa…`;
  renderChatStatus();
  if (!chats[id]) {
    $('messages').innerHTML = '<div class="empty">Carregando…</div>';
    try { chats[id] = await (await fetch(`/api/agents/${encodeURIComponent(id)}/chat`)).json(); } catch { chats[id] = { messages: [] }; }
  }
  renderMessages();
  if (a.kind === 'harvey') loadHarvey();
  setTimeout(() => $('input').focus(), 50);
}

function closeChat() {
  openChat = null;
  document.body.classList.remove('chatting', 'team', 'resumo');
  if (innerWidth < 760) document.body.classList.remove('side-open');
  resize();
}

function renderChatStatus() {
  const a = byId.get(openChat);
  if (!a) return;
  const [txt, cls] = STATUS[a.state.status] || ['', 'ok'];
  $('chat-status').textContent = a.state.status === 'working' && a.state.tool ? a.state.tool : txt;
  $('chat-status').className = `status ${cls}`;
  const busy = chats[openChat]?.busy;
  $('send').hidden = !!busy;
  $('stop').hidden = !busy;
}

function tables(html) {
  // blocos de linhas "| a | b |" viram <table>
  return html.replace(/(^\|.*\|[ \t]*$\n?)+/gm, block => {
    const rows = block.trim().split('\n').filter(l => !/^\|[\s:|-]+\|$/.test(l.trim()));
    const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const [head, ...body] = rows;
    return `<table><tr>${cells(head).map(c => `<th>${c}</th>`).join('')}</tr>${body.map(r => `<tr>${cells(r).map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>\n`;
  });
}

function md(text) {
  const esc = tables(text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  return esc
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, l, c) => `<pre>${c.trim()}</pre>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/^#{1,4} (.+)$/gm, '<b>$1</b>')
    .replace(/^---$/gm, '<hr>')
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\n/g, '<br>')
    .replace(/<\/(table|blockquote)><br>/g, '</$1>')
    .replace(/<pre>([\s\S]*?)<\/pre>/g, (_, c) => `<pre>${c.replace(/<br>/g, '\n')}</pre>`);
}

function renderMessages() {
  const box = $('messages');
  const chat = chats[openChat];
  const a = byId.get(openChat);
  box.innerHTML = '';
  if (!chat?.messages?.length) {
    box.innerHTML = `<div class="empty"><b>Diga oi pra ${a.label}.</b><br>${a.kind === 'harvey' ? 'Pergunte como está o pipeline ou o que ele fez hoje.' : 'Converse normalmente. Quando pedir algo da especialidade, a skill vai pra mesa e faz o trabalho de verdade.'}</div>`;
  }
  for (const m of chat?.messages || []) box.appendChild(messageEl(m, a));
  box.scrollTop = box.scrollHeight;
  renderChatStatus();
}

function messageEl(m, a) {
  const el = document.createElement('div');
  el.className = `msg ${m.role}`;
  if (m.role === 'assistant') {
    const tools = (m.tools || []).map(t => `<div class="tool">🔧 ${t.replace(/</g, '&lt;')}</div>`).join('');
    const files = (m.files || []).map(f => `<a class="file" href="/arquivos/${encodeURIComponent(f)}" target="_blank">📄 ${f.replace(/</g, '&lt;')}</a>`).join('');
    const typing = !m.text && chats[openChat]?.busy ? '<span class="typing"><i></i><i></i><i></i></span>' : '';
    el.innerHTML = `<div class="from">${a.label}</div>${tools}<div class="body">${md(m.text || '')}${typing}</div>${files}${m.text ? '<button class="copy">Copiar</button>' : ''}`;
    el.querySelector('.copy')?.addEventListener('click', ev => {
      navigator.clipboard.writeText(m.text);
      ev.target.textContent = 'Copiado'; setTimeout(() => ev.target.textContent = 'Copiar', 1200);
    });
  } else {
    el.innerHTML = `${chipsHtml(m.attachments)}<div class="body">${md(m.text)}</div>`;
  }
  return el;
}

async function send() {
  const text = $('input').value.trim();
  if ((!text && !pending.input.length) || !openChat) return;
  const attachments = takeAttachments('input');
  $('input').value = '';
  autosize();
  const r = await post(`/api/agents/${encodeURIComponent(openChat)}/chat`, { text, attachments });
  if (!r.ok) toast(r.message);
}

$('send').onclick = send;
$('stop').onclick = () => post(`/api/agents/${encodeURIComponent(openChat)}/chat/stop`);
$('input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
const autosize = () => { const t = $('input'); t.style.height = 'auto'; t.style.height = `${Math.min(160, t.scrollHeight)}px`; };
$('input').addEventListener('input', autosize);
$('back').onclick = closeChat;
$('reset').onclick = async () => {
  if (!openChat || !confirm('Começar uma conversa nova? O agente esquece esta.')) return;
  await post(`/api/agents/${encodeURIComponent(openChat)}/chat/reset`);
  chats[openChat] = { messages: [] };
  renderMessages();
};
$('goto').onclick = () => openChat && walkToAgent(openChat);
$('prox-talk').onclick = () => nearest && openChatWith(nearest.id);
$('toggle-side').onclick = () => { document.body.classList.toggle('side-open'); resize(); };
function syncIsoButton() {
  const b = $('iso-toggle');
  if (b) b.textContent = isoOn ? 'Visão de cima' : 'Visão isométrica';
  const z = $('zoom-ctl');
  if (z) z.hidden = !isoOn;
}
syncIsoButton();
$('iso-toggle').onclick = () => {
  isoOn = !isoOn;
  localStorage.setItem('escritorio-iso', isoOn ? '1' : '0');
  if (isoOn) camMode = 'fit';
  syncIsoButton();
  resize();
};
function contentCenter() {
  const ins = contentInsets();
  return { x: (ins.left + innerWidth - ins.right) / 2, y: (ins.top + innerHeight - ins.bottom) / 2 };
}
$('zoom-in').onclick = () => { const c = contentCenter(); zoomAt(1.18, c.x, c.y); };
$('zoom-out').onclick = () => { const c = contentCenter(); zoomAt(1 / 1.18, c.x, c.y); };
$('zoom-fit').onclick = () => {
  camMode = 'fit';
  look = null;
  for (const b of $('rooms').querySelectorAll('button')) b.classList.remove('on');
  frameOffice();
  localStorage.setItem('escritorio-zoom', 'fit');
};

let pan = null;
canvas.addEventListener('pointerdown', ev => {
  if (!isoOn || ev.button > 2) return;
  pan = { x: ev.clientX, y: ev.clientY, camX: cam.x, camY: cam.y, moved: false };
});
addEventListener('pointermove', ev => {
  if (!pan) return;
  if (ev.buttons === 0) { pan = null; return; }
  const dx = ev.clientX - pan.x, dy = ev.clientY - pan.y;
  if (!pan.moved && dx * dx + dy * dy < 25) return;
  pan.moved = true;
  eatClick = true;
  camMode = 'free';
  cam.x = pan.camX - dx / scale;
  cam.y = pan.camY - dy / scale;
});
addEventListener('pointerup', () => { pan = null; });
canvas.addEventListener('wheel', ev => {
  if (!isoOn || !isoLayout) return;
  ev.preventDefault();
  const rect = canvas.getBoundingClientRect();
  zoomAt(ev.deltaY < 0 ? 1.12 : 1 / 1.12, ev.clientX - rect.left, ev.clientY - rect.top);
}, { passive: false });
canvas.addEventListener('contextmenu', ev => { if (isoOn) ev.preventDefault(); });
$('cursor-toggle').onclick = () => $('cursor-drawer').classList.toggle('open');
$('people-filter').addEventListener('input', filterPeople);
$('meet-open').onclick = () => { if (!document.body.classList.contains('team')) openTeam(); else closeTeam(); };

let resumoSubjects = [];
let resumoOpen = null;

function closeResumo() {
  resumoOpen = null;
  document.body.classList.remove('resumo');
  resize();
}

function renderResumoList() {
  resumoOpen = null;
  $('resumo-title').textContent = 'Resumo';
  $('resumo-actions').hidden = true;
  const box = $('resumo-list');
  box.innerHTML = '';
  if (!resumoSubjects.length) {
    box.innerHTML = '<div class="empty">Ainda não há assunto. Quando alguém trabalhar, aparece aqui.</div>';
    return;
  }
  for (const s of resumoSubjects) {
    const b = document.createElement('button');
    b.className = 'assunto';
    const who = s.agents.map(a => a.label).join(' · ') || 'arquivo';
    const line = s.agents.find(a => a.did)?.did || '';
    b.innerHTML = '<b></b><small></small>';
    b.querySelector('b').textContent = s.title;
    b.querySelector('small').textContent = line ? `${who} — ${line}` : who;
    b.onclick = () => renderAssunto(s);
    box.appendChild(b);
  }
}

function renderAssunto(s) {
  resumoOpen = s;
  $('resumo-title').textContent = 'Assunto';
  const box = $('resumo-list');
  box.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'assunto-title';
  title.textContent = s.title;
  box.appendChild(title);
  if (!s.agents.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Ninguém assinou este assunto.';
    box.appendChild(empty);
  }
  for (const a of s.agents) {
    const row = document.createElement('article');
    row.className = 'feito';
    const where = a.present ? (a.statusLabel || a.cargo || '') : 'não está no escritório';
    row.innerHTML = '<b></b><small></small><p></p>';
    row.querySelector('b').textContent = a.cargo ? `${a.label} · ${a.cargo}` : a.label;
    row.querySelector('small').textContent = where;
    row.querySelector('p').textContent = a.did || 'Sem relato.';
    for (const f of a.files || []) row.appendChild(fileLink(f));
    box.appendChild(row);
  }
  for (const f of s.files || []) box.appendChild(fileLink(f));
  const present = s.agents.filter(a => a.present);
  $('resumo-meet').textContent = present.length >= 2 ? 'Reunir na sala' : 'Levar pra sala de reunião';
  $('resumo-actions').hidden = present.length < 1;
}

function fileLink(name) {
  const link = document.createElement('a');
  link.className = 'file';
  link.href = `/arquivos/${encodeURIComponent(name)}`;
  link.target = '_blank';
  link.textContent = name;
  return link;
}

async function openResumo() {
  document.body.classList.add('side-open', 'resumo');
  document.body.classList.remove('chatting', 'team');
  openChat = null;
  resize();
  $('resumo-list').innerHTML = '<div class="empty">Carregando…</div>';
  try {
    resumoSubjects = (await (await fetch('/api/resumo')).json()).subjects || [];
  } catch {
    resumoSubjects = [];
  }
  renderResumoList();
}

async function reunirAssunto() {
  const s = resumoOpen;
  if (!s) return;
  const ids = s.agents.filter(a => a.present).map(a => a.id);
  openTeam();
  for (const input of $('team-people').querySelectorAll('input')) input.checked = ids.includes(input.value);
  $('team-input').value = `Vamos falar sobre: ${s.title}`;
  const room = world?.rooms?.find(r => r.key === 'meeting');
  if (room) look = { x: room.x + room.w / 2, y: room.y + room.h / 2, until: performance.now() + 12000 };
  if (ids.length >= 2) {
    const r = await post('/api/meeting', { ids });
    if (!r.ok) toast(r.message);
    else toast('Eles foram pra sala. Manda a fala quando quiser.');
  } else toast('Marca mais uma pessoa e coloca na sala.');
}

$('resumo-open').onclick = () => openResumo();
$('resumo-back').onclick = () => { if (resumoOpen) renderResumoList(); else closeResumo(); };
$('resumo-meet').onclick = reunirAssunto;
$('team-back').onclick = closeTeam;
$('team-stop').onclick = () => post('/api/meeting/stop');
$('team-seat').onclick = seatTeam;
$('team-send').onclick = sendTeam;
$('team-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTeam(); } });

function toast(text) {
  const t = $('toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3500);
}

// Harvey
async function loadHarvey() {
  try {
    const h = await (await fetch('/api/harvey')).json();
    harveyOutbox = h.outbox || {};
    const pending = harveyOutbox.pending_review || 0;
    $('h-agent').classList.toggle('on', !!h.pid);
    $('h-board').classList.toggle('on', !!h.dashboard);
    $('h-start').disabled = !!h.pid;
    $('h-stop').disabled = !h.pid;
    $('h-approve').disabled = pending < 1;
    $('h-approve').textContent = `Aprovar os ${pending} da fila`;
    $('h-nums').textContent = `${pending} p/ revisar · ${harveyOutbox.approved || 0} aprovados · ${harveyOutbox.sent || 0} enviados`;
  } catch {}
}
$('h-start').onclick = async () => { const r = await post('/api/harvey/start'); toast(r.success ? 'Agente ligado.' : r.message); loadHarvey(); };
$('h-stop').onclick = async () => { const r = await post('/api/harvey/stop'); toast(r.success ? 'Agente desligado.' : r.message); loadHarvey(); };
$('h-approve').onclick = async () => {
  $('h-approve').disabled = true;
  const r = await post('/api/harvey/approve');
  toast(r.success ? `Aprovados: ${r.approved ?? 0}.` : (r.message || 'Não aprovei.'));
  loadHarvey();
};
$('h-dash').onclick = async () => {
  const win = window.open('about:blank', '_blank');
  const r = await post('/api/harvey/dashboard');
  if (r.success && win) win.location = 'http://127.0.0.1:5555'; else { win?.close(); toast(r.message || 'Não abriu.'); }
};
setInterval(loadHarvey, 10000);

// ── Tempo real ─────────────────────────────────────────────────────────────

function setAgents(list) {
  const ids = agents.map(a => a.id).join();
  agents = list;
  byId = new Map(agents.map(a => [a.id, a]));
  if (ids !== agents.map(a => a.id).join() || !world) rebuild(); else renderPeople();
}

function connect() {
  const es = new EventSource('/events');
  es.addEventListener('snapshot', e => { setAgents(JSON.parse(e.data)); $('conn').className = 'conn on'; });
  es.addEventListener('reload', async () => setAgents(await (await fetch('/api/agents')).json()));
  es.addEventListener('meeting', e => onMeeting(JSON.parse(e.data)));
  es.addEventListener('agent', e => {
    const { id, state } = JSON.parse(e.data);
    const a = byId.get(id);
    if (!a) return;
    a.state = state;
    refreshPerson(a);
    refreshCounts();
    if (openChat === id) renderChatStatus();
  });
  es.addEventListener('chat', e => {
    const ev = JSON.parse(e.data);
    const chat = chats[ev.id];
    if (ev.type === 'done' && openChat !== ev.id) { unread.add(ev.id); const a = byId.get(ev.id); if (a) { refreshPerson(a); toast(`${a.label} respondeu.`); } }
    if (!chat) return;
    const lastMsg = chat.messages[chat.messages.length - 1];
    if (ev.type === 'user') { chat.messages.push({ role: 'user', text: ev.text, attachments: ev.attachments }); chat.messages.push({ role: 'assistant', text: '', tools: [], files: [] }); chat.busy = true; }
    else if (ev.type === 'start') chat.busy = true;
    else if (ev.type === 'delta' && lastMsg?.role === 'assistant') lastMsg.text += ev.text;
    else if (ev.type === 'tool' && lastMsg?.role === 'assistant') lastMsg.tools.push(ev.text);
    else if (ev.type === 'done') {
      chat.busy = false;
      if (lastMsg?.role === 'assistant') { lastMsg.files = ev.files || []; if (ev.text) lastMsg.text += `${lastMsg.text ? '\n\n' : ''}⚠️ ${ev.text}`; }
    }
    if (openChat === ev.id) {
      if (ev.type === 'delta' && lastMsg) {
        const body = $('messages').lastElementChild?.querySelector('.body');
        if (body) { body.innerHTML = md(lastMsg.text); const box = $('messages'); box.scrollTop = box.scrollHeight; }
        else renderMessages();
      } else renderMessages();
    }
  });
  es.onerror = () => { $('conn').className = 'conn'; };
}

fetch('/api/me').then(r => r.json()).then(me => {
  if (!me?.name) return;
  meName = me.name;
  const el = $('me-name');
  if (el) el.textContent = me.name;
}).catch(() => {});

if (innerWidth < 760) document.body.classList.remove('side-open');
drawPortrait($('own-face'), player.look);
connect();
loadHarvey();
requestAnimationFrame(frame);

// ── Arrastar pro chat: tarefas do Cursor, arquivos, pastas e texto ─────────

const pending = { input: [], team: [] };
const escHtml = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function chipsHtml(list) {
  if (!list?.length) return '';
  return `<div class="chips">${list.map(n => `<span class="chip">${n.startsWith('Cursor:') ? '🧭' : n.endsWith('/') ? '📁' : '📄'} ${escHtml(n)}</span>`).join('')}</div>`;
}

function renderTray(which) {
  const tray = $(which === 'team' ? 'team-att' : 'input-att');
  tray.hidden = !pending[which].length;
  tray.innerHTML = '';
  pending[which].forEach((a, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${a.kind === 'cursor' ? '🧭' : a.kind === 'path' && a.dir ? '📁' : '📄'} <span></span><button aria-label="Tirar anexo">×</button>`;
    chip.querySelector('span').textContent = a.label;
    chip.querySelector('button').onclick = () => { pending[which].splice(i, 1); renderTray(which); };
    tray.appendChild(chip);
  });
}

function takeAttachments(which) {
  const out = pending[which].map(({ label, dir, ...rest }) => rest);
  pending[which] = [];
  renderTray(which);
  return out;
}

function addAttachments(which, list) {
  for (const a of list) if (!pending[which].some(p => p.label === a.label)) pending[which].push(a);
  renderTray(which);
  if (list.length) toast(list.length === 1 ? `Anexado: ${list[0].label}` : `${list.length} anexos`);
}

const baseName = p => p.replace(/\/+$/, '').split('/').pop();

async function readDrop(dt) {
  const out = [];
  const office = dt.getData('application/x-office-cursor');
  if (office) {
    try { const c = JSON.parse(office); out.push({ kind: 'cursor', id: c.id, label: `Cursor: ${c.title}` }); } catch {}
    return out;
  }
  // Caminhos vindos do Cursor/VS Code (explorador) ou do Finder
  const uriText = [dt.getData('application/vnd.code.uri-list'), dt.getData('text/uri-list')].filter(Boolean).join('\n');
  let uris = [];
  try { const j = JSON.parse(dt.getData('application/vnd.code.uri-list') || 'null'); if (Array.isArray(j)) uris = j; } catch {}
  if (!uris.length) uris = uriText.split(/\r?\n/).filter(l => l && !l.startsWith('#'));
  for (const u of uris) {
    if (/^(file|vscode-file):/.test(u)) {
      const p = decodeURIComponent(u.replace(/^vscode-file:\/\/vscode-app/, '').replace(/^file:\/\//, ''));
      out.push({ kind: 'path', path: p, label: baseName(p), dir: !/\.[a-z0-9]{1,6}$/i.test(p) });
    } else if (/^https?:/.test(u)) out.push({ kind: 'text', name: u, text: u, label: u.slice(0, 40) });
  }
  if (!out.length && dt.files?.length) {
    for (const f of dt.files) {
      if (/(^|\/)\.env/.test(f.name)) { toast('O .env não vai pro chat.'); continue; }
      if (f.size > 400000) { toast(`${f.name} é grande demais (máx. 400 KB).`); continue; }
      let text = '';
      try { text = await f.text(); } catch { continue; }
      if (!text && !f.type) { toast(`${f.name}: pasta? Arraste do Cursor ou cole o caminho.`); continue; }
      if (/\u0000/.test(text.slice(0, 2000))) { toast(`${f.name} não é texto.`); continue; }
      out.push({ kind: 'file', name: f.name, text, label: f.name });
    }
  }
  if (!out.length) {
    const t = (dt.getData('text/plain') || '').trim();
    if (/^(~|\/Users)\/\S+$/.test(t)) out.push({ kind: 'path', path: t, label: baseName(t), dir: !/\.[a-z0-9]{1,6}$/i.test(t) });
    else if (t) out.push({ kind: 'text', name: 'Texto arrastado', text: t, label: t.replace(/\s+/g, ' ').slice(0, 40) + (t.length > 40 ? '…' : '') });
  }
  return out;
}

for (const zone of document.querySelectorAll('[data-drop]')) {
  const which = zone.dataset.drop;
  let depth = 0;
  zone.addEventListener('dragenter', e => { e.preventDefault(); depth++; zone.classList.add('dropping'); });
  zone.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  zone.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; zone.classList.remove('dropping'); } });
  zone.addEventListener('drop', async e => {
    e.preventDefault();
    depth = 0; zone.classList.remove('dropping');
    addAttachments(which, await readDrop(e.dataTransfer));
    $(which === 'team' ? 'team-input' : 'input').focus();
  });
}
// Solto em qualquer lugar fora do chat: não deixa o navegador abrir o arquivo
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { if (!e.target.closest('[data-drop]')) e.preventDefault(); });

function dragCursor(el, c) {
  el.draggable = true;
  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('application/x-office-cursor', JSON.stringify({ id: c.id, title: c.title }));
    e.dataTransfer.setData('text/plain', c.title);
    e.dataTransfer.effectAllowed = 'copy';
    document.body.classList.add('dragging-task');
  });
  el.addEventListener('dragend', () => document.body.classList.remove('dragging-task'));
}

const timeAgo = t => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'agora' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
};

async function loadCursorTasks() {
  let list = [];
  try { list = await (await fetch('/api/cursor/tarefas')).json(); } catch { return; }
  const box = $('cursor-tasks');
  box.innerHTML = '';
  const count = $('cursor-count');
  if (count) count.textContent = String(list.length);
  for (const c of list.slice(0, 8)) {
    const card = document.createElement('div');
    card.className = `card${c.live ? ' live' : ''}`;
    card.title = 'Arraste para o chat de um agente ou para a reunião';
    card.innerHTML = `<b></b><small></small>`;
    card.querySelector('b').textContent = c.title;
    card.querySelector('small').textContent = `${c.project} · ${timeAgo(c.t)}${c.live ? ' · aberta' : ''}`;
    dragCursor(card, c);
    box.appendChild(card);
  }
  if (!list.length) box.innerHTML = '<div class="empty">Nenhuma conversa do Cursor ainda.</div>';
  // As pessoas c-… (conversas abertas no Cursor) também podem ser arrastadas da lista
  for (const c of list) {
    const row = document.querySelector(`.person[data-id="${CSS.escape(c.id)}"]`);
    if (row && !row.draggable) dragCursor(row, c);
  }
}
loadCursorTasks();
setInterval(loadCursorTasks, 20000);
