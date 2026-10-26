// Pixel Office — servidor local que mostra as skills do Claude Code e o Harvey trabalhando.
// Sem dependências: só Node >= 22 (usa node:sqlite).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.PORT || 4777);
const HOME = os.homedir();
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const SKILLS_DIR = process.env.SKILLS_DIR || path.join(HOME, '.claude', 'skills');
const HARVEY_DIR = process.env.HARVEY_DIR || path.join(HOME, 'Documents', 'harvey');
const WORKSPACE = path.join(ROOT, 'workspace');
const OVERRIDES_FILE = path.join(ROOT, 'agents.json');
const PT_FILE = path.join(ROOT, 'descricoes.json');
const OFFICE_FILE = path.join(ROOT, 'office.json');

function ownerName() {
  try {
    const saved = JSON.parse(fs.readFileSync(OFFICE_FILE, 'utf8'));
    if (saved.name) return String(saved.name);
  } catch {}
  const raw = os.userInfo().username || 'você';
  const name = raw.charAt(0).toUpperCase() + raw.slice(1);
  try { fs.writeFileSync(OFFICE_FILE, JSON.stringify({ name }, null, 2) + '\n'); } catch {}
  return name;
}

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function skillPrefix(id) {
  const i = String(id).indexOf('-');
  return i > 0 ? id.slice(0, i) : '';
}

function roomTitle(room) {
  const known = { li: 'LinkedIn', sales: 'Vendas', cursor: 'Cursor', skills: 'Skills' };
  if (known[room]) return known[room];
  return String(room).replace(/[-_]+/g, ' ').replace(/\b\p{L}/gu, c => c.toUpperCase());
}

// Duas ou mais skills com o mesmo prefixo ganham uma sala. O resto fica junto.
// agents.json pode forçar a sala de uma pessoa; isso não desenha sala vazia.
function assignRooms(agents, overrides) {
  const counts = new Map();
  for (const a of agents) {
    if (a.kind !== 'skill' || overrides[a.id]?.room) continue;
    const p = skillPrefix(a.id);
    if (p) counts.set(p, (counts.get(p) || 0) + 1);
  }
  for (const a of agents) {
    const forced = overrides[a.id]?.room;
    let room = forced;
    if (!room) {
      if (a.kind === 'harvey') room = 'sales';
      else if (a.kind === 'cursor') room = 'cursor';
      else {
        const p = skillPrefix(a.id);
        room = p && counts.get(p) >= 2 ? p : 'skills';
      }
    }
    a.room = room;
    a.roomName = roomTitle(room);
  }
}
fs.mkdirSync(WORKSPACE, { recursive: true });

// Chats, reuniões e traduções passam pelo OmniRoute quando .env tem a chave.
function loadLocalEnv() {
  let text = '';
  try { text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const i = s.indexOf('=');
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadLocalEnv();

function claudeModel(fast) {
  if (!process.env.OMNIROUTE_API_KEY) return fast ? 'haiku' : '';
  return fast
    ? (process.env.OMNIROUTE_MODEL_FAST || 'auto/claude-haiku')
    : (process.env.OMNIROUTE_MODEL || 'auto/claude-sonnet');
}

function claudeEnv() {
  const env = { ...process.env, PIXEL_OFFICE_RUN: '1' };
  const key = process.env.OMNIROUTE_API_KEY;
  if (!key) return env;
  env.ANTHROPIC_BASE_URL = String(process.env.OMNIROUTE_BASE_URL || 'http://127.0.0.1:20128').replace(/\/+$/, '').replace(/\/v1$/, '');
  env.ANTHROPIC_AUTH_TOKEN = key;
  delete env.ANTHROPIC_API_KEY;
  env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1';
  return env;
}

// ── Agentes ────────────────────────────────────────────────────────────────

const state = new Map();      // agentId -> runtime state
const sessions = new Map();   // claude session_id -> agentId
const sessionTasks = new Map(); // claude session_id -> taskId
const runs = new Map();       // agentId -> child process (rodadas iniciadas pela web)

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  const lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let [, key, val] = kv;
    if (/^[>|]-?$/.test(val)) {
      const block = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) block.push(lines[++i].trim());
      val = block.join(' ');
    }
    out[key] = val.replace(/^["']|["']$/g, '');
  }
  return out;
}

// ── Português ──────────────────────────────────────────────────────────────
// As descrições dos SKILL.md ficam como estão (é por elas que o Claude decide quando
// usar cada skill). O escritório mostra uma versão em português guardada em
// descricoes.json; skill nova sem tradução é traduzida uma vez pelo Haiku.

function readPt() {
  try { return JSON.parse(fs.readFileSync(PT_FILE, 'utf8')); } catch { return {}; }
}

const translating = new Set();
function translateSkill(id, description) {
  if (translating.has(id) || !description) return;
  translating.add(id);
  const prompt = `Você recebe a descrição de uma skill do Claude Code chamada "${id}". Responda SOMENTE com um JSON no formato {"cargo": "...", "descricao": "..."}, em português do Brasil.
- cargo: um cargo curto e divertido de escritório pra essa skill (2 a 4 palavras), ex.: "Redator de posts".
- descricao: até 2 frases claras. A primeira diz o que a skill faz, começando por um verbo na 3ª pessoa (ex.: "Transforma...", "Escreve..."). A segunda diz quando usar, falando com o dono (ex.: "Use quando você..."). Sem travessões.

Descrição original:
${description}`;
  const child = spawn('claude', ['-p', prompt, '--model', claudeModel(true), '--tools', ''], { cwd: WORKSPACE, env: claudeEnv(), stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  child.stdout.on('data', c => { out += c; });
  child.on('error', () => translating.delete(id));
  child.on('close', () => {
    translating.delete(id);
    const m = out.match(/\{[\s\S]*\}/);
    let pt; try { pt = JSON.parse(m[0]); } catch { return; }
    if (!pt.descricao) return;
    const all = readPt();
    all[id] = { cargo: pt.cargo || '', descricao: pt.descricao };
    fs.writeFileSync(PT_FILE, JSON.stringify(all, null, 2) + '\n');
    emit('reload', {});
  });
}

function readOverrides() {
  try { return JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8')); } catch { return {}; }
}

function listAgents() {
  const overrides = readOverrides();
  const pt = readPt();
  const agents = [];
  let dirs = [];
  try { dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true }); } catch {}
  for (const d of dirs) {
    if (!d.isDirectory() && !d.isSymbolicLink()) continue;
    const file = path.join(SKILLS_DIR, d.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const fm = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    const id = fm.name || d.name;
    if (id.startsWith('li-') || d.name.startsWith('li-')) continue;
    if (!pt[id]) translateSkill(id, fm.description);
    agents.push({
      id, kind: 'skill',
      label: id,
      cargo: pt[id]?.cargo || '',
      description: pt[id]?.descricao || fm.description || '',
      ...overrides[id],
    });
  }
  if (fs.existsSync(path.join(HARVEY_DIR, 'data', 'harvey.db'))) {
    agents.push({
      id: 'harvey', kind: 'harvey', label: 'Harvey',
      cargo: pt.harvey?.cargo || 'Vendedor',
      description: pt.harvey?.descricao || 'Agente de vendas autônomo.',
      ...overrides.harvey,
    });
  }
  if (cursorChats.size === 0) {
    agents.push({
      id: 'cursor', kind: 'cursor', label: 'Cursor',
      cargo: 'Programador',
      description: 'Guarda o pedido num arquivo da pasta de trabalho. Não executa nada no editor. Mostra o que o Cursor já está fazendo.',
      ...overrides.cursor,
    });
  } else {
    for (const [id, rec] of cursorChats) {
      agents.push({
        id, kind: 'cursor', label: rec.title || 'Cursor',
        cargo: 'Conversa',
        description: rec.title || 'Conversa aberta no Cursor.',
      });
    }
  }
  assignRooms(agents, overrides);
  agents.sort((a, b) => a.id.localeCompare(b.id));
  for (const a of agents) a.state = getState(a.id);
  return agents;
}

function getState(id) {
  if (!state.has(id)) state.set(id, { status: 'idle', task: '', tool: '', since: Date.now(), log: [], result: '' });
  return state.get(id);
}

function resolveSkill(name) {
  if (!name) return null;
  const ids = listAgents().map(a => a.id);
  if (ids.includes(name)) return name;
  const short = name.split(':').pop();
  return ids.includes(short) ? short : null;
}

// ── SSE ────────────────────────────────────────────────────────────────────

const clients = new Set();
function emit(type, payload) {
  const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(data);
}

function update(id, patch, logLine) {
  const s = getState(id);
  if (patch.status && patch.status !== s.status) s.since = Date.now();
  Object.assign(s, patch);
  if (logLine) {
    s.log.push({ t: Date.now(), text: String(logLine).slice(0, 400) });
    if (s.log.length > 60) s.log.shift();
  }
  emit('agent', { id, state: s, line: logLine || null });
}

// ── Hooks do Claude Code ───────────────────────────────────────────────────

const TOOL_PT = {
  Read: 'Lendo', Write: 'Escrevendo', Edit: 'Editando', MultiEdit: 'Editando', NotebookEdit: 'Editando notebook',
  Bash: 'Rodando comando', Glob: 'Procurando arquivos', Grep: 'Buscando no código',
  WebSearch: 'Pesquisando na web', WebFetch: 'Abrindo página', Task: 'Chamando um ajudante', Agent: 'Chamando um ajudante',
  TodoWrite: 'Organizando tarefas', Skill: 'Usando skill', AskUserQuestion: 'Te perguntando algo',
};
function describeTool(name, input = {}) {
  const label = TOOL_PT[name] || (name.startsWith('mcp__') ? `Usando ${name.split('__').pop()}` : name);
  let hint = input.file_path || input.command || input.pattern || input.url || input.query || input.description || '';
  if (input.file_path) hint = path.basename(input.file_path);
  return hint ? `${label}: ${String(hint).slice(0, 60)}` : label;
}

// Uma pessoa por conversa do Cursor. A chave vem do payload do hook.
const cursorChats = new Map(); // id -> { title }

function cursorConversationRaw(ev) {
  const direct = ev.conversation_id || ev.conversationId || ev.composer_id || ev.composerId || ev.session_id;
  if (direct) return String(direct);
  const transcript = String(ev.transcript_path || ev.transcriptPath || '');
  const m = transcript.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : '';
}

function cursorChatId(ev) {
  const raw = cursorConversationRaw(ev).replace(/[^a-zA-Z0-9]/g, '');
  return raw ? `c-${raw.slice(0, 12)}` : '';
}

function cursorTitle(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Cursor';
  return t.length > 32 ? `${t.slice(0, 30)}…` : t;
}

function handleCursorHook(ev) {
  const name = ev.hook_event_name || '';
  const prompt = String(ev.prompt || ev.user_message || ev.text || '').replace(/\s+/g, ' ').trim();
  const id = cursorChatId(ev);
  if (!id) {
    if (cursorChats.size === 0) update('cursor', { status: 'working', task: prompt.slice(0, 160) || 'No Cursor', tool: '' });
    return;
  }
  let rosterChanged = false;
  if (!cursorChats.has(id)) { cursorChats.set(id, { title: '' }); rosterChanged = true; }
  const rec = cursorChats.get(id);
  if (name === 'sessionEnd') {
    cursorChats.delete(id);
    state.delete(id);
    emit('reload', {});
    return;
  }
  if (name === 'sessionStart') {
    update(id, { status: 'working', task: rec.title || 'Abriu o Cursor', tool: 'Indo pra sala' }, '▶ abriu o Cursor');
  } else if (name === 'beforeSubmitPrompt') {
    const task = prompt.slice(0, 160) || 'Novo pedido no Cursor';
    if (!rec.title) { rec.title = cursorTitle(task); rosterChanged = true; }
    update(id, { status: 'working', task, tool: 'Lendo o pedido' }, `▶ ${task}`);
  } else if (name === 'postToolUse' || name === 'afterFileEdit' || name === 'afterShellExecution') {
    const tool = describeTool(ev.tool_name || ev.toolName || 'ferramenta', ev.tool_input || ev.toolInput || ev.input || {});
    update(id, { status: 'working', tool }, `🔧 ${tool}`);
  } else if (name === 'stop') {
    update(id, { status: 'done', tool: '' }, '✓ terminou');
  }
  if (rosterChanged) emit('reload', {});
}

function handleHook(ev) {
  if (ev.source === 'cursor') return handleCursorHook(ev);
  const sid = ev.session_id;
  const name = ev.hook_event_name;
  if (name === 'UserPromptSubmit') {
    const m = (ev.prompt || '').match(/^\s*\/([\w:-]+)/);
    const id = m && resolveSkill(m[1]);
    if (id) {
      sessions.set(sid, id);
      sessionTasks.set(sid, addTask({ agent: id, title: ev.prompt.replace(/^\s*\/[\w:-]+\s*/, '') || `/${id}`, status: 'andamento', source: 'claude' }).id);
      update(id, { status: 'working', task: ev.prompt.slice(0, 120), tool: '' }, `▶ ${ev.prompt.slice(0, 200)}`);
    }
  } else if (name === 'PreToolUse') {
    if (ev.tool_name === 'Skill') {
      const id = resolveSkill(ev.tool_input?.skill);
      if (id) {
        sessions.set(sid, id);
        update(id, { status: 'working', task: ev.tool_input?.args || 'chamada pelo Claude', tool: '' }, `▶ skill ${id} acionada`);
      }
      return;
    }
    const id = sessions.get(sid);
    if (id) update(id, { status: 'working', tool: describeTool(ev.tool_name, ev.tool_input) }, `🔧 ${describeTool(ev.tool_name, ev.tool_input)}`);
  } else if (name === 'Stop' || name === 'SessionEnd') {
    const id = sessions.get(sid);
    if (id) {
      sessions.delete(sid);
      if (sessionTasks.has(sid)) { setTask(sessionTasks.get(sid), { status: 'feito', done: Date.now() }); sessionTasks.delete(sid); }
      if (!runs.has(id) && !chatProcs.has(id)) update(id, { status: 'done', tool: '' }, '✓ terminou');
    }
  }
}

// ── Rodar uma skill pela web ───────────────────────────────────────────────

function runSkill(id, text) {
  if (runs.has(id)) return { ok: false, message: 'Já está trabalhando.' };
  const prompt = `/${id} ${text}\n\n(Responda em português do Brasil.)`;
  // Rodadas da web: só leitura + web. A skill lê os próprios arquivos (fórmulas, voz),
  // mas não edita nada nem roda comandos além de cat/ls.
  const readDirs = [SKILLS_DIR, path.join(HOME, '.linkedin-agent'), HARVEY_DIR].filter(d => fs.existsSync(d));
  const child = spawn('claude', [
    '-p', prompt,
    ...(claudeModel(false) ? ['--model', claudeModel(false)] : []),
    '--output-format', 'stream-json', '--verbose',
    '--allowedTools', 'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Bash(cat:*)', 'Bash(ls:*)',
    ...(readDirs.length ? ['--add-dir', ...readDirs] : []),
  ], {
    cwd: WORKSPACE, env: claudeEnv(), stdio: ['ignore', 'pipe', 'pipe'],
  });
  runs.set(id, child);
  update(id, { status: 'working', running: true, task: text.slice(0, 120), tool: '', result: '' }, `▶ você pediu: ${text}`);

  let buf = '';
  child.stdout.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.type === 'assistant') {
        for (const c of msg.message?.content || []) {
          if (c.type === 'text' && c.text.trim()) update(id, { tool: '' }, `💬 ${c.text.trim()}`);
          if (c.type === 'tool_use') update(id, { tool: describeTool(c.name, c.input) }, `🔧 ${describeTool(c.name, c.input)}`);
        }
      } else if (msg.type === 'result') {
        getState(id).result = msg.result || '';
      }
    }
  });
  let err = '';
  child.stderr.on('data', c => { err += c; });
  child.on('close', code => {
    runs.delete(id);
    if (code === 0) update(id, { status: 'done', running: false, tool: '' }, '✓ terminou');
    else update(id, { status: 'error', running: false, tool: '' }, `✗ erro (${code}) ${err.slice(-200)}`);
  });
  child.on('error', e => { runs.delete(id); update(id, { status: 'error', running: false }, `✗ ${e.message}`); });
  return { ok: true };
}

// ── Tarefas do dia ─────────────────────────────────────────────────────────
// Toda vez que um agente trabalha de verdade (usa ferramenta pelo chat, roda pelo
// Claude Code, ou fica na fila esperando), vira uma tarefa aqui.

const TASKS_FILE = path.join(ROOT, 'tarefas.json');
let tasks = [];
try { tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); } catch {}
const saveTasks = () => { if (tasks.length > 400) tasks = tasks.slice(-400); fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks)); emit('tasks', {}); };
function addTask(t) {
  const task = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, t: Date.now(), ...t };
  task.title = String(task.title || '').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Tarefa';
  tasks.push(task);
  saveTasks();
  return task;
}
function setTask(id, patch) {
  const task = tasks.find(t => t.id === id);
  if (task) { Object.assign(task, patch); saveTasks(); }
}
const queues = new Map();   // agentId -> [{ text, taskId }]

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }

function harveyTasksToday() {
  const since = new Date(startOfToday()).toISOString().replace('T', ' ').slice(0, 19);
  const rows = harveyQuery("SELECT action_type, COUNT(*) n, MAX(created_at) last FROM actions WHERE created_at >= ? GROUP BY action_type", since);
  return rows.map(r => ({
    id: `harvey-${r.action_type}`, agent: 'harvey', source: 'harvey', status: 'feito',
    title: `${(ACTION_PT[r.action_type] || r.action_type).replace(/^./, c => c.toUpperCase())}${r.n > 1 ? ` (${r.n}x)` : ''}`,
    t: Date.parse(r.last.replace(' ', 'T') + 'Z'), done: Date.parse(r.last.replace(' ', 'T') + 'Z'),
  }));
}

function tasksToday() {
  const since = startOfToday();
  return [...tasks.filter(t => t.t >= since || t.status === 'andamento' || t.status === 'pendente'), ...harveyTasksToday()]
    .sort((a, b) => b.t - a.t);
}

// ── Anexos arrastados pro chat ─────────────────────────────────────────────
// Tarefas (conversas) do Cursor, arquivos, pastas e texto soltos no chat.
// O agente recebe o conteúdo junto com a mensagem; pastas ficam liberadas só pra leitura.

const CURSOR_PROJECTS = path.join(HOME, '.cursor', 'projects');
const transcriptCache = new Map(); // file -> { mtime, title, text }

function cleanCursorText(t) {
  const q = String(t).match(/<user_query>([\s\S]*?)<\/user_query>/);
  return (q ? q[1] : String(t)).replace(/<timestamp>[\s\S]*?<\/timestamp>/g, '').replace(/<[^>]+>/g, '').trim();
}

// "Users-fulano-Documents-meu-projeto" -> "/Users/fulano/Documents/meu-projeto" (confere no disco)
function cursorProjectDir(slug) {
  const parts = slug.split('-');
  const walk = (dir, i) => {
    if (i >= parts.length) return dir;
    for (let j = parts.length; j > i; j--) {
      const cand = path.join(dir, parts.slice(i, j).join('-'));
      if (fs.existsSync(cand)) { const r = walk(cand, j); if (r) return r; }
    }
    return null;
  };
  return walk('/', 0);
}

function readTranscript(file) {
  const st = fs.statSync(file);
  const hit = transcriptCache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit;
  const lines = [];
  let title = '';
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    let d; try { d = JSON.parse(raw); } catch { continue; }
    const role = d.role || d.message?.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const content = d.message?.content;
    const text = (Array.isArray(content) ? content.filter(c => c.type === 'text').map(c => c.text).join('\n') : String(content || '')).trim();
    if (!text) continue;
    const clean = role === 'user' ? cleanCursorText(text) : text;
    if (!clean) continue;
    if (role === 'user' && !title) title = clean.replace(/\s+/g, ' ').slice(0, 80);
    lines.push(`${role === 'user' ? 'Luiz' : 'Cursor'}: ${clean}`);
  }
  const out = { mtime: st.mtimeMs, title: title || 'Conversa do Cursor', text: lines.join('\n\n') };
  transcriptCache.set(file, out);
  return out;
}

function cursorTasks(limit = 30) {
  const out = [];
  let projects = [];
  try { projects = fs.readdirSync(CURSOR_PROJECTS); } catch { return out; }
  for (const proj of projects) {
    const dir = path.join(CURSOR_PROJECTS, proj, 'agent-transcripts');
    let uuids = [];
    try { uuids = fs.readdirSync(dir); } catch { continue; }
    for (const uuid of uuids) {
      const base = path.join(dir, uuid);
      let file = null;
      try {
        const st = fs.statSync(base);
        if (st.isDirectory()) file = fs.readdirSync(base).filter(f => f.endsWith('.jsonl')).map(f => path.join(base, f))[0];
        else if (base.endsWith('.jsonl')) file = base;
      } catch {}
      if (!file) continue;
      const id = `c-${uuid.replace(/\.jsonl$/, '').replace(/-/g, '').slice(0, 12)}`;
      out.push({ id, uuid, file, slug: proj, t: fs.statSync(file).mtimeMs });
    }
  }
  return out.sort((a, b) => b.t - a.t).slice(0, limit).map(c => {
    let title = 'Conversa do Cursor';
    try { title = readTranscript(c.file).title; } catch {}
    const projectDir = cursorProjectDir(c.slug);
    return { id: c.id, title, project: projectDir ? path.basename(projectDir) : c.slug, projectDir, t: c.t, live: state.has(c.id) };
  });
}

function findCursorTask(id) {
  const key = String(id).replace(/^c-/, '');
  const all = cursorTasks(500);
  const hit = all.find(c => c.id === id);
  if (!hit) return null;
  let file = null;
  for (const proj of fs.readdirSync(CURSOR_PROJECTS)) {
    const dir = path.join(CURSOR_PROJECTS, proj, 'agent-transcripts');
    let uuids = []; try { uuids = fs.readdirSync(dir); } catch { continue; }
    const u = uuids.find(x => x.replace(/-/g, '').startsWith(key));
    if (u) { const b = path.join(dir, u); file = fs.statSync(b).isDirectory() ? path.join(b, fs.readdirSync(b).find(f => f.endsWith('.jsonl'))) : b; break; }
  }
  return file ? { ...hit, file } : null;
}

const SECRET_FILE = /(^|\/)\.env(\..*)?$|\.pem$|id_rsa|\.p12$|\.key$/i;

// Transforma os anexos em texto para o agente + pastas liberadas para leitura.
function expandAttachments(list = []) {
  const blocks = [], dirs = new Set(), names = [];
  let budget = 60000;
  const add = (title, body) => {
    const b = String(body || '').slice(-Math.max(0, Math.min(budget, 24000)));
    budget -= b.length;
    blocks.push(`### ${title}\n${b}`);
  };
  for (const a of list.slice(0, 8)) {
    if (a.kind === 'cursor') {
      const c = findCursorTask(a.id);
      if (!c) continue;
      names.push(`Cursor: ${c.title}`);
      add(`Tarefa do Cursor "${c.title}" (projeto ${c.project})`, readTranscript(c.file).text);
      if (c.projectDir) dirs.add(c.projectDir);
    } else if (a.kind === 'path') {
      let p = String(a.path || '').replace(/^file:\/\//, '');
      try { p = decodeURIComponent(p); } catch {}
      p = path.resolve(p.replace(/^~/, HOME));
      if (!p.startsWith(HOME + path.sep) || SECRET_FILE.test(p) || !fs.existsSync(p)) continue;
      const st = fs.statSync(p);
      names.push(path.basename(p) + (st.isDirectory() ? '/' : ''));
      if (st.isDirectory()) { dirs.add(p); blocks.push(`### Pasta ${p}\n(você pode ler os arquivos dela)`); }
      else if (st.size < 400000) add(`Arquivo ${p}`, fs.readFileSync(p, 'utf8'));
    } else if (a.kind === 'text' || a.kind === 'file') {
      if (a.kind === 'file' && SECRET_FILE.test(a.name || '')) continue;
      names.push(a.name || 'texto');
      add(a.kind === 'file' ? `Arquivo ${a.name}` : (a.name || 'Texto arrastado'), a.text);
    }
  }
  return {
    context: blocks.length ? `\n\n---\nO Luiz arrastou isto para o chat. Leia antes de responder:\n\n${blocks.join('\n\n')}` : '',
    dirs: [...dirs], names,
  };
}

// ── Conversa com os agentes ────────────────────────────────────────────────
// Cada agente tem uma conversa contínua (claude --resume). Ele responde como colega;
// quando o pedido exige trabalho de verdade, usa a skill e vai pra mesa trabalhar.

const CHATS_FILE = path.join(ROOT, 'chats.json');
let chats = {};
try { chats = JSON.parse(fs.readFileSync(CHATS_FILE, 'utf8')); } catch {}
const chatProcs = new Map();
const saveChats = () => fs.writeFileSync(CHATS_FILE, JSON.stringify(chats));
const getChat = id => (chats[id] ??= { sessionId: null, messages: [] });

function persona(agent) {
  const who = ownerName();
  const base = `Você está no "Escritório Pixel", o escritório virtual de ${who} com agentes de IA. ${who} está conversando com você pelo chat do escritório.
Fale sempre em português do Brasil, curto e natural, como um colega de trabalho no chat (sem formalidade, sem listas longas quando não precisa).
Nunca publique, envie ou poste nada em nome de ${who}. Arquivos que você criar vão em ${WORKSPACE}.`;
  if (agent.kind === 'harvey') {
    return `${base}
Você é o Harvey, ${agent.cargo}: ${agent.description}
Estado atual do seu pipeline (JSON): ${JSON.stringify(harveySnapshot())}
Para detalhes, consulte o banco em ${path.join(HARVEY_DIR, 'data', 'harvey.db')} só com "sqlite3 -readonly" e o código em ${HARVEY_DIR}.
Você pode editar UM arquivo: ${path.join(HARVEY_DIR, 'harvey.local.yaml')} (sua configuração local: cidades, ICP, limites etc.). Nenhum outro arquivo.
Antes de editar, diga em uma frase o que vai mudar. Depois de editar, confirme o que mudou e avise que a mudança vale a partir do próximo reinício (botões Desligar e Ligar no escritório).
Ligar e desligar o agente, e aprovar e-mails, é com ${who}: indique os botões do escritório. O dashboard (http://127.0.0.1:5555) é outra luz e não significa que o agente está ligado.`;
  }
  return `${base}
Você é "${agent.label}", o ${agent.cargo || 'agente'} do escritório. Sua especialidade é a skill "${agent.id}": ${agent.description}
Se ${who} só estiver conversando ou tirando dúvida, responda sem usar ferramentas.
Para QUALQUER pedido de produção da sua especialidade (escrever, criar, revisar, analisar, planejar, mesmo que pareça simples), SEMPRE chame primeiro a ferramenta Skill com a skill "${agent.id}" e siga as instruções dela: é ela que traz as fórmulas, a voz de ${who} e o padrão de qualidade. Não improvise a tarefa de cabeça.
Para rodar scripts da skill, chame sempre com o caminho completo (python3 ${SKILLS_DIR}/...), sem "cd" antes, e use ${WORKSPACE} para arquivos temporários.
Se faltar informação importante, pergunte antes.`;
}

function chatTurn(id, text, queuedTaskId, attachments = []) {
  const agent = listAgents().find(a => a.id === id);
  if (!agent) return { ok: false, message: 'Agente não encontrado.' };
  if (agent.kind === 'cursor') {
    fs.mkdirSync(WORKSPACE, { recursive: true });
    const name = `cursor-${stamp()}.md`;
    fs.writeFileSync(path.join(WORKSPACE, name), `# Pedido para o Cursor\n\n${text}\n\nO escritório só guardou este pedido. Ele não foi executado no editor.\n`);
    const reply = `Deixei o pedido em workspace/${name}. Eu não executo isso no Cursor. Abre esse arquivo na conversa do editor se quiser que ele faça.`;
    const chat = getChat(id);
    chat.messages.push({ role: 'user', text, t: Date.now() }, { role: 'assistant', text: reply, tools: [], files: [name], t: Date.now() });
    saveChats();
    emit('chat', { id, type: 'user', text });
    emit('chat', { id, type: 'start' });
    emit('chat', { id, type: 'delta', text: reply });
    emit('chat', { id, type: 'done', files: [name], text: '' });
    return { ok: true };
  }
  if (chatProcs.has(id) || runs.has(id)) {
    // Ocupado: entra na fila como tarefa pendente e roda quando ele terminar.
    const task = addTask({ agent: id, title: text, status: 'pendente', source: 'chat' });
    if (!queues.has(id)) queues.set(id, []);
    queues.get(id).push({ text, taskId: task.id, attachments });
    return { ok: true, queued: true, message: `${agent.label} está ocupado. Ficou na fila.` };
  }
  let task = queuedTaskId ? tasks.find(t => t.id === queuedTaskId) : null;
  if (task) setTask(task.id, { status: 'andamento', t: Date.now() });
  const chat = getChat(id);
  const startedAt = Date.now();
  const extra = expandAttachments(attachments);
  chat.messages.push({ role: 'user', text, t: startedAt, ...(extra.names.length ? { attachments: extra.names } : {}) });
  const reply = { role: 'assistant', text: '', tools: [], files: [], t: startedAt };
  chat.messages.push(reply);
  if (chat.messages.length > 120) chat.messages.splice(0, chat.messages.length - 120);
  emit('chat', { id, type: 'user', text, attachments: extra.names });

  const readDirs = [SKILLS_DIR, path.join(HOME, '.linkedin-agent'), HARVEY_DIR].filter(d => fs.existsSync(d));
  const tools = agent.kind === 'harvey'
    ? ['Read', 'Glob', 'Grep', 'Bash(sqlite3 -readonly:*)',
       // única coisa que o Harvey pode mudar: a própria configuração local
       `Edit(/${HARVEY_DIR}/harvey.local.yaml)`, `Write(/${HARVEY_DIR}/harvey.local.yaml)`]
    : ['Skill', 'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Bash(cat:*)', 'Bash(ls:*)', `Write(/${WORKSPACE}/**)`, `Edit(/${WORKSPACE}/**)`,
       // scripts que vêm com as próprias skills (ex.: humanize.py do li-human)
       `Bash(python3 ${SKILLS_DIR}/*)`];
  // Sem acceptEdits: só escreve onde as regras Write/Edit acima deixam. Pastas arrastadas: só leitura.
  for (const d of extra.dirs) tools.push(`Read(/${d}/**)`, `Glob(/${d}/**)`, `Grep(/${d}/**)`);
  const args = ['-p', (text || 'Dá uma olhada no que eu arrastei.') + extra.context,
    ...(claudeModel(false) ? ['--model', claudeModel(false)] : []),
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--append-system-prompt', persona(agent), '--allowedTools', ...tools];
  if (chat.sessionId) args.push('--resume', chat.sessionId);
  if (readDirs.length) args.push('--add-dir', ...readDirs);

  const child = spawn('claude', args, { cwd: WORKSPACE, env: claudeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  chatProcs.set(id, child);
  let usedTools = false;
  if (agent.kind !== 'harvey') update(id, { status: 'talking', running: true, tool: '' }, `💬 você: ${text.slice(0, 200)}`);
  emit('chat', { id, type: 'start' });

  let buf = '', err = '';
  child.stdout.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.type === 'system' && msg.subtype === 'init') chat.sessionId = msg.session_id;
      else if (msg.type === 'stream_event') {
        const d = msg.event?.delta;
        if (msg.event?.type === 'content_block_delta' && d?.type === 'text_delta') {
          // Separa blocos de texto de mensagens diferentes (antes/depois de usar ferramenta)
          if (reply._newBlock && reply.text) { reply.text += '\n\n'; emit('chat', { id, type: 'delta', text: '\n\n' }); }
          reply._newBlock = false;
          reply.text += d.text;
          emit('chat', { id, type: 'delta', text: d.text });
        } else if (msg.event?.type === 'message_start') reply._newBlock = true;
      } else if (msg.type === 'assistant') {
        for (const c of msg.message?.content || []) {
          if (c.type !== 'tool_use') continue;
          const desc = describeTool(c.name === 'Skill' ? 'Skill' : c.name, c.name === 'Skill' ? { description: c.input?.skill } : c.input);
          reply.tools.push(desc);
          usedTools = true;
          if (!task) task = addTask({ agent: id, title: text, status: 'andamento', source: 'chat' });
          emit('chat', { id, type: 'tool', text: desc });
          if (agent.kind !== 'harvey') update(id, { status: 'working', tool: desc }, `🔧 ${desc}`);
        }
      } else if (msg.type === 'result') {
        if (!reply.text && msg.result) { reply.text = msg.result; emit('chat', { id, type: 'delta', text: msg.result }); }
        if (msg.session_id) chat.sessionId = msg.session_id;
      }
    }
  });
  child.stderr.on('data', c => { err += c; });
  const finish = (ok, message) => {
    chatProcs.delete(id);
    delete reply._newBlock;
    try {
      reply.files = fs.readdirSync(WORKSPACE).filter(f => fs.statSync(path.join(WORKSPACE, f)).mtimeMs >= startedAt);
    } catch {}
    if (!ok) reply.text += `${reply.text ? '\n\n' : ''}⚠️ ${message}`;
    saveChats();
    if (task) setTask(task.id, { status: ok ? 'feito' : 'erro', done: Date.now(), files: reply.files });
    emit('chat', { id, type: 'done', files: reply.files, text: ok ? '' : message });
    if (meetingDeliveries.has(id)) {
      for (const f of reply.files || []) if (!f.startsWith('reuniao-')) emit('meeting', { type: 'file', name: f });
      if (!queues.get(id)?.length) meetingDeliveries.delete(id);
    }
    // Próximo da fila
    const next = queues.get(id)?.shift();
    if (next) setTimeout(() => chatTurn(id, next.text, next.taskId, next.attachments), 800);
    if (agent.kind !== 'harvey') {
      update(id, { status: ok ? (usedTools ? 'done' : 'idle') : 'error', running: false, tool: '', result: ok ? reply.text : getState(id).result },
        ok ? (usedTools ? '✓ terminou a tarefa' : '💬 respondeu') : `✗ ${message}`);
    }
  };
  child.on('close', code => finish(code === 0, `deu erro (código ${code}). ${err.slice(-200)}`));
  child.on('error', e => finish(false, e.message));
  return { ok: true };
}

// ── Barra de comando: "li-audit, verifica X" ou texto livre ────────────────

async function routeAsk(text) {
  const agents = listAgents().filter(a => a.kind !== 'cursor');
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const m = text.match(/^\s*@?([\w-]+)\s*[,:]\s*([\s\S]+)$/) || text.match(/^\s*@([\w-]+)\s+([\s\S]+)$/);
  if (m) {
    const hit = agents.find(a => norm(a.id) === norm(m[1]) || norm(a.label) === norm(m[1]));
    if (hit) return { id: hit.id, text: m[2].trim() };
  }
  const list = agents.map(a => `${a.id}: ${a.cargo || ''}. ${String(a.description).slice(0, 160)}`).join('\n');
  const out = await claudeOnce(`Escolha o agente certo para este pedido de ${ownerName()}. Responda SOMENTE com o id do agente, nada mais.

Agentes:
${list}

Pedido: ${text}`);
  const id = (out.match(/[\w-]+/g) || []).find(w => agents.some(a => a.id === w));
  return id ? { id, text } : null;
}

// ── Reunião: as IAs sentam juntas e planejam ──────────────────────────────

let meeting = null;
const meetingDeliveries = new Set();

// Pastas citadas na conversa (ex.: /Users/.../meu-projeto) que existem de verdade.
function dirsIn(text) {
  const out = new Set();
  for (let m of String(text).match(/(?:~|\/Users)\/[^\s"'`,;()<>]+/g) || []) {
    m = m.replace(/^~/, HOME).replace(/[.:]+$/, '');
    try {
      const st = fs.statSync(m);
      out.add(st.isDirectory() ? m : path.dirname(m));
    } catch {}
  }
  return [...out].slice(0, 5);
}

// Uma resposta curta. Com `dirs`, pode ler (só ler) essas pastas antes de responder.
function claudeOnce(prompt, { dirs = [], timeout = 40000 } = {}) {
  return new Promise(resolve => {
    const args = ['-p', prompt, '--model', claudeModel(true)];
    if (dirs.length) {
      args.push('--allowedTools', 'Read', 'Glob', 'Grep', 'Skill',
        '--disallowedTools', 'Read(**/.env)', 'Read(**/.env.*.local)', 'Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch',
        '--add-dir', ...dirs);
    } else args.push('--tools', '');
    const child = spawn('claude', args, {
      cwd: WORKSPACE, env: claudeEnv(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); resolve(out.trim()); }, timeout);
    child.stdout.on('data', c => { out += c; });
    child.on('close', () => { clearTimeout(timer); resolve(out.trim()); });
    child.on('error', () => { clearTimeout(timer); resolve(''); });
  });
}

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function writeAta(who, lines, entregas) {
  fs.mkdirSync(WORKSPACE, { recursive: true });
  const when = stamp();
  const name = `reuniao-${when}.md`;
  const fala = lines.map(l => `- **${l.label}:** ${l.text}`).join('\n') || '- (sem falas)';
  const itens = entregas.length ? entregas.map(e => {
    const quando = e.data ? ` — ${e.data}` : '';
    const estado = e.pronta ? 'em produção' : 'pendente';
    return `- **${e.agente}**${quando} — ${estado}\n  ${e.pedido || '(sem pedido)'}`;
  }).join('\n') : '- Nenhuma entrega concreta.';
  const body = `# Reunião ${when}\n\nParticipante: ${who}\n\n## Conversa\n\n${fala}\n\n## Entregas\n\n${itens}\n`;
  fs.writeFileSync(path.join(WORKSPACE, name), body);
  return name;
}

async function settleMeeting(current) {
  const who = ownerName();
  const said = current.lines.map(l => `${l.id} (${l.label}): ${l.text}`).join('\n');
  const ids = current.ids || [];
  const today = new Date().toISOString().slice(0, 10);
  const raw = await claudeOnce(`Hoje é ${today}. Leia a reunião e extraia só entregas concretas: alguém vai produzir um arquivo, texto, PDF, plano ou análise.
Responda SOMENTE com JSON neste formato: {"entregas":[{"agente":"id","pedido":"...","data":"YYYY-MM-DD ou vazio","pronta":true}]}
- agente tem que ser um destes ids: ${ids.join(', ') || '(nenhum)'}
- pronta=true só se o briefing já basta para produzir agora
- pronta=false se a data é futura ou ainda falta uma peça
- se não houver entrega, {"entregas":[]}
Sem markdown.

${said}`);
  let entregas = [];
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    entregas = m ? (JSON.parse(m[0]).entregas || []) : [];
  } catch { entregas = []; }
  const start = todayStart();
  entregas = entregas.filter(e => e && ids.includes(e.agente)).map(e => {
    const data = /^\d{4}-\d{2}-\d{2}$/.test(e.data || '') ? e.data : '';
    const future = data && new Date(`${data}T00:00:00`) > start;
    const pronta = !future && (e.pronta === true || e.pronta === 'true') && String(e.pedido || '').trim();
    return { agente: e.agente, pedido: String(e.pedido || '').trim(), data, pronta: !!pronta };
  });
  const name = writeAta(who, current.lines, entregas);
  emit('meeting', { type: 'file', name });
  const roster = listAgents();
  for (const e of entregas) {
    const label = roster.find(a => a.id === e.agente)?.label || e.agente;
    if (e.pronta) {
      emit('meeting', { type: 'note', text: `${label} vai produzir agora.` });
      meetingDeliveries.add(e.agente);
      chatTurn(e.agente, `Pedido decidido na reunião:\n${e.pedido}\n\nContexto:\n${said}\n\nProduza agora e grave o arquivo na pasta de trabalho.`);
    } else {
      emit('meeting', { type: 'note', text: `${label} ficou pendente${e.data ? ` para ${e.data}` : ''}.` });
    }
  }
}

async function replyRound() {
  const current = meeting;
  if (!current) return;
  const who = ownerName();
  const agents = listAgents().filter(a => current.ids.includes(a.id));
  for (const agent of agents) {
    if (!current.running) break;
    const said = current.lines.map(l => `${l.label}: ${l.text}${l.context || ''}`).join('\n');
    const mine = current.lines.filter(l => l.id === 'voce');
    const dirs = [...new Set([...dirsIn(mine.map(l => l.text).join(' ')), ...mine.flatMap(l => l.dirs || [])])].slice(0, 5);
    update(agent.id, { status: 'working', tool: dirs.length ? `Lendo ${path.basename(dirs[0])}` : 'Pensando' });
    const prompt = `Você é ${agent.label}, ${agent.cargo || 'colega'} do Escritório Pixel. ${agent.description || ''}
Está numa reunião com ${agents.map(a => a.label).join(', ')} e com ${who}.
Conversa até agora:
${said}

Responda à última fala, em português do Brasil, de 2 a 4 frases, como quem está sentado na mesa. Reaja ao que foi dito e traga um passo da sua especialidade. Sem lista, sem travessão.${dirs.length ? `
Antes de responder, LEIA o que for relevante em ${dirs.join(', ')} (Read, Glob, Grep; se existir uma skill "${agent.id}", siga o que ela manda). Baseie a resposta no que viu, citando arquivo. Não peça permissão: você já pode ler. Nunca mostre valores do .env.
Sua resposta final deve ser só a fala, sem narrar o que leu.` : ''}`;
    const text = (await claudeOnce(prompt, { dirs, timeout: dirs.length ? 180000 : 40000 })).replace(/^["']|["']$/g, '').trim().slice(0, 900);
    const line = text || '…';
    current.lines.push({ id: agent.id, label: agent.label, text: line });
    update(agent.id, { status: 'talking', tool: line.slice(0, 90) }, `💬 ${line.slice(0, 180)}`);
    emit('meeting', { type: 'say', id: agent.id, label: agent.label, text: line });
  }
  await settleMeeting(current);
  if (meeting === current) {
    current.busy = false;
    emit('meeting', { type: 'idle' });
  }
}

function startMeeting(ids) {
  if (meeting?.busy) return { ok: false, message: 'Espera elas terminarem de falar.' };
  const agents = listAgents().filter(a => ids.includes(a.id));
  if (agents.length < 2) return { ok: false, message: 'Escolhe pelo menos duas pessoas.' };
  const same = meeting && meeting.ids.join() === agents.map(a => a.id).join();
  meeting = { ids: agents.map(a => a.id), lines: same ? meeting.lines : [], running: true, busy: false };
  emit('meeting', { type: 'start', ids: meeting.ids, lines: meeting.lines });
  for (const a of agents) update(a.id, { status: 'talking', tool: 'Na reunião' }, '🪑 foi pra reunião');
  return { ok: true, ids: meeting.ids };
}

function meetingSay(text, attachments = []) {
  const extra = expandAttachments(attachments);
  const clean = String(text || '').trim() || (extra.names.length ? 'Olhem o que eu trouxe.' : '');
  if (!clean) return { ok: false, message: 'Mensagem vazia.' };
  if (!meeting?.running) return { ok: false, message: 'Escolhe quem vai sentar primeiro.' };
  if (meeting.busy) return { ok: false, message: 'Espera elas terminarem de falar.' };
  const who = ownerName();
  meeting.busy = true;
  meeting.lines.push({ id: 'voce', label: who, text: clean, context: extra.context.slice(0, 30000), dirs: extra.dirs, attachments: extra.names });
  emit('meeting', { type: 'say', id: 'voce', label: who, text: clean, attachments: extra.names });
  replyRound();
  return { ok: true };
}

function stopMeeting() {
  if (meeting?.running) {
    const ids = meeting.ids || [];
    meeting.running = false;
    for (const id of ids) update(id, { status: 'idle', tool: '' }, 'reunião interrompida');
    emit('meeting', { type: 'done' });
  }
  return { ok: true };
}

// ── Harvey ─────────────────────────────────────────────────────────────────

let harveyDb = null;
let lastActionAt = '';
let logOffset = -1;
let harveyActiveAt = 0;
const HARVEY_LOG = path.join(HARVEY_DIR, 'data', 'harvey.log');

function harveyPid() {
  try {
    const pid = Number(fs.readFileSync(path.join(HARVEY_DIR, 'data', 'harvey.pid'), 'utf8').trim());
    process.kill(pid, 0);
    return pid;
  } catch {}
  // `harvey run` no terminal não escreve PID file: procura o processo.
  try {
    const out = execFileSync('pgrep', ['-f', 'bin/harvey run|-m harvey$'], { encoding: 'utf8' });
    const pid = Number(out.trim().split('\n')[0]) || null;
    // Registra o PID pro dashboard do Harvey também enxergar (ele limpa o arquivo se ficar velho).
    if (pid) fs.writeFileSync(path.join(HARVEY_DIR, 'data', 'harvey.pid'), String(pid));
    return pid;
  } catch { return null; }
}

function harveyQuery(sql, ...params) {
  try {
    harveyDb ??= new DatabaseSync(path.join(HARVEY_DIR, 'data', 'harvey.db'), { readOnly: true });
    return harveyDb.prepare(sql).all(...params);
  } catch { harveyDb = null; return []; }
}

function harveySnapshot() {
  return {
    pid: harveyPid(),
    outbox: Object.fromEntries(harveyQuery('SELECT status, COUNT(*) n FROM outbox GROUP BY status').map(r => [r.status, r.n])),
    actions: harveyQuery('SELECT agent, action_type, details_json, created_at FROM actions ORDER BY created_at DESC LIMIT 20'),
    runs: harveyQuery("SELECT stage, status, records, started_at FROM runs ORDER BY started_at DESC LIMIT 5"),
  };
}

async function dashboardUp() {
  try {
    const r = await fetch('http://127.0.0.1:5555/api/harvey/status', { signal: AbortSignal.timeout(700) });
    return r.ok;
  } catch { return false; }
}

// Aprova a fila pelo mesmo endpoint do dashboard. Não escreve no banco daqui.
async function approveOutbox() {
  const up = await ensureHarveyDashboard();
  if (!up.success) return { success: false, message: up.message || 'O dashboard não está no ar.' };
  try {
    const r = await fetch('http://127.0.0.1:5555/api/outbox/approve-all', { method: 'POST', signal: AbortSignal.timeout(8000) });
    return await r.json();
  } catch (e) {
    return { success: false, message: e.message };
  }
}

const AGENT_PT = { main: 'chefe', scout: 'olheiro', writer: 'redator', sender: 'carteiro', reader: 'leitor', profiler: 'pesquisador' };
const ACTION_PT = {
  prospect: 'prospectando', write_campaign: 'escrevendo campanha', send_campaign: 'enviando campanha',
  stage_campaign: 'preparando envio', email_sent: 'e-mail enviado', reply: 'lendo resposta',
};

function pollHarvey() {
  if (!fs.existsSync(path.join(HARVEY_DIR, 'data', 'harvey.db'))) return;
  const pid = harveyPid();
  const rows = harveyQuery('SELECT agent, action_type, created_at FROM actions WHERE created_at > ? ORDER BY created_at', lastActionAt);
  const first = !lastActionAt;
  for (const r of rows) {
    lastActionAt = r.created_at;
    if (!first) harveyActiveAt = Date.now();
    if (!first) update('harvey', { status: pid ? 'working' : 'off', tool: `${AGENT_PT[r.agent] || r.agent}: ${ACTION_PT[r.action_type] || r.action_type}` },
      `📈 ${AGENT_PT[r.agent] || r.agent} → ${ACTION_PT[r.action_type] || r.action_type}`);
  }
  // Tail do log
  try {
    const size = fs.statSync(HARVEY_LOG).size;
    if (logOffset < 0 || size < logOffset) logOffset = size;
    if (size > logOffset) {
      const fd = fs.openSync(HARVEY_LOG, 'r');
      const b = Buffer.alloc(Math.min(size - logOffset, 65536));
      fs.readSync(fd, b, 0, b.length, logOffset); fs.closeSync(fd);
      logOffset = size;
      for (const line of b.toString('utf8').split('\n').filter(l => l.trim()).slice(-10)) update('harvey', {}, line.trim());
      harveyActiveAt = Date.now();
    }
  } catch {}
  const s = getState('harvey');
  const next = !pid ? 'off' : (Date.now() - harveyActiveAt < 20000 ? 'working' : 'sleeping');
  if (next !== s.status) update('harvey', { status: next, tool: next === 'working' ? s.tool : '' });
}
setInterval(pollHarvey, 2500);
pollHarvey();

// Liga/desliga o Harvey do mesmo jeito que o dashboard dele faz (mesmo PID file e log),
// então os dois enxergam o mesmo processo.
async function harveyControl(action) {
  const pidFile = path.join(HARVEY_DIR, 'data', 'harvey.pid');
  const pid = harveyPid();
  if (action === 'start') {
    if (pid) return { success: false, message: 'O Harvey já está rodando.' };
    const venvPy = path.join(HARVEY_DIR, '.venv', 'bin', 'python');
    const py = fs.existsSync(venvPy) ? venvPy : 'python3';
    const log = fs.openSync(HARVEY_LOG, 'a');
    try {
      // Sem o subcomando "run" o CLI só imprime a ajuda e sai na hora.
      const child = spawn(py, ['-m', 'harvey', 'run'], { cwd: HARVEY_DIR, stdio: ['ignore', log, log], detached: true });
      child.unref();
      fs.writeFileSync(pidFile, String(child.pid));
      update('harvey', { status: 'sleeping' }, `▶ Harvey ligado (pid ${child.pid})`);
      return { success: true, pid: child.pid };
    } catch (e) {
      return { success: false, message: `Não consegui ligar: ${e.message}` };
    } finally { fs.closeSync(log); }
  }
  if (!pid) return { success: false, message: 'O Harvey não está rodando.' };
  try { process.kill(pid, 'SIGTERM'); } catch {}
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { process.kill(pid, 0); } catch { break; }
    if (i === 9) try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  fs.rmSync(pidFile, { force: true });
  update('harvey', { status: 'off', tool: '' }, '■ Harvey desligado');
  return { success: true };
}

// Sobe o dashboard do Harvey (porta 5555) se não estiver no ar.
async function ensureHarveyDashboard() {
  const up = () => fetch('http://127.0.0.1:5555/api/harvey/status').then(r => r.ok, () => false);
  if (await up()) return { success: true, started: false };
  const venvBin = path.join(HARVEY_DIR, '.venv', 'bin', 'harvey');
  const log = fs.openSync(path.join(HARVEY_DIR, 'data', 'dashboard.log'), 'a');
  try {
    const child = spawn(fs.existsSync(venvBin) ? venvBin : 'harvey', ['dashboard'], { cwd: HARVEY_DIR, stdio: ['ignore', log, log], detached: true });
    child.on('error', () => {});
    child.unref();
  } finally { fs.closeSync(log); }
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await up()) return { success: true, started: true };
  }
  return { success: false, message: 'O dashboard não subiu. Veja ~/Documents/harvey/data/dashboard.log' };
}

// ── Decaimento done → idle ─────────────────────────────────────────────────

setInterval(() => {
  for (const [id, s] of state) {
    if ((s.status === 'done' || s.status === 'error') && Date.now() - s.since > 12000) update(id, { status: 'idle' });
    // Sessão do Claude que morreu sem mandar Stop: solta depois de 10 min sem notícias.
    const lastLog = s.log.at(-1)?.t || s.since;
    if (s.status === 'working' && !s.running && id !== 'harvey' && Date.now() - lastLog > 600000) update(id, { status: 'idle', tool: '' });
  }
}, 2000);

// ── Resumo: o que cada agente fez, agrupado por assunto ───────────────────

const STATUS_PT = { feito: 'Feito', andamento: 'Em andamento', pendente: 'Na fila', erro: 'Parou com erro' };

function clip(s, n = 180) {
  const t = String(s || '').replace(/[#>*_`]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function wordsOf(title) {
  const stop = new Set(['para', 'com', 'que', 'uma', 'uns', 'por', 'dos', 'das', 'nas', 'nos', 'sobre', 'isso', 'este', 'esta', 'hoje', 'fazer', 'faz', 'pedido', 'agente', 'vamos', 'falar']);
  return String(title || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !stop.has(w));
}

function subjectKey(title) {
  const words = [...new Set(wordsOf(title))].sort().slice(0, 5);
  return words.join('-') || clip(title, 48).toLowerCase() || 'assunto';
}

function snippetFor(agentId, around) {
  const msgs = chats[agentId]?.messages || [];
  let best = '', bestDist = Infinity;
  for (const m of msgs) {
    if (m.role !== 'assistant') continue;
    const text = clip(m.text, 220);
    if (!text) continue;
    const dist = Math.abs((m.t || 0) - (around || 0));
    if (dist < bestDist) { bestDist = dist; best = text; }
  }
  if (!around) return best;
  return bestDist < 6 * 3600 * 1000 ? best : '';
}

function workspaceEntries() {
  try {
    return fs.readdirSync(WORKSPACE).filter(name => !name.startsWith('.')).map(name => {
      const full = path.join(WORKSPACE, name);
      const st = fs.statSync(full);
      return st.isFile() ? { name, t: st.mtimeMs, full } : null;
    }).filter(Boolean);
  } catch { return []; }
}

function officeResumo() {
  const roster = listAgents();
  const byId = new Map(roster.map(a => [a.id, a]));
  const pt = readPt();
  const known = id => {
    const live = byId.get(id);
    if (live) return { id, label: live.label, cargo: live.cargo || '', present: true };
    return { id, label: id === 'harvey' ? 'Harvey' : id === 'cursor' ? 'Cursor' : id, cargo: pt[id]?.cargo || '', present: false };
  };
  const groups = new Map();
  const touch = (key, title, t) => {
    let g = groups.get(key);
    if (!g) {
      g = { key, title: clip(title, 90), t: t || 0, files: new Set(), people: new Map() };
      groups.set(key, g);
    } else if ((t || 0) >= g.t && title) {
      g.t = t || g.t;
      g.title = clip(title, 90);
    }
    return g;
  };
  const addPerson = (g, id, patch) => {
    if (!id) return;
    const cur = g.people.get(id) || { ...known(id), status: '', did: '', didT: 0, files: [] };
    if ((patch.t || 0) >= cur.didT) {
      if (patch.status) cur.status = patch.status;
      if (patch.did) cur.did = patch.did;
      cur.didT = patch.t || cur.didT;
    } else if (patch.status && !cur.status) cur.status = patch.status;
    for (const f of patch.files || []) if (f && !cur.files.includes(f)) cur.files.push(f);
    g.people.set(id, cur);
  };

  for (const task of tasks) {
    const g = touch(subjectKey(task.title), task.title, task.t);
    const did = snippetFor(task.agent, task.done || task.t) || clip(task.title, 180);
    addPerson(g, task.agent, { status: task.status, did, t: task.done || task.t, files: task.files || [] });
    for (const f of task.files || []) g.files.add(f);
  }

  for (const file of workspaceEntries()) {
    if (file.name.startsWith('reuniao-') && file.name.endsWith('.md')) {
      let text = '';
      try { text = fs.readFileSync(file.full, 'utf8'); } catch { continue; }
      const entregas = [];
      const block = text.split('## Entregas')[1] || '';
      for (const m of block.matchAll(/^- \*\*([^*]+)\*\*([^\n]*)\n[ \t]+(.+)$/gm)) {
        entregas.push({
          agente: m[1].trim(),
          pedido: m[3].trim(),
          status: /pendente/i.test(m[2]) ? 'pendente' : 'feito',
        });
      }
      const who = ownerName();
      const speeches = [...text.matchAll(/^- \*\*([^*]+):\*\*\s*(.+)$/gm)]
        .map(m => ({ label: m[1].trim(), text: m[2].trim() }))
        .filter(s => s.label && s.label !== who);
      const day = file.name.slice(8, 18);
      const title = entregas.find(e => e.pedido && e.pedido !== '(sem pedido)')?.pedido
        || `Reunião ${day}`;
      const g = touch(subjectKey(title), title, file.t);
      g.files.add(file.name);
      const personId = label => {
        if (byId.has(label) || pt[label] || chats[label] || tasks.some(t => t.agent === label)) return label;
        return roster.find(a => a.label === label)?.id || '';
      };
      for (const e of entregas) {
        addPerson(g, personId(e.agente), { status: e.status, did: clip(e.pedido, 220), t: file.t, files: [] });
      }
      for (const s of speeches) {
        addPerson(g, personId(s.label), { did: clip(s.text, 220), t: file.t, files: [] });
      }
      continue;
    }
    if ([...groups.values()].some(g => g.files.has(file.name))) continue;
    const words = wordsOf(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
    const hit = [...groups.values()].find(g => words.some(w => g.key.includes(w)));
    if (hit) { hit.files.add(file.name); continue; }
    if (file.name.startsWith('cursor-')) {
      let pedido = '';
      try {
        pedido = fs.readFileSync(file.full, 'utf8').split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#')) || '';
      } catch {}
      const g = touch(`cursor-${file.name}`, pedido || 'Pedido guardado para o Cursor', file.t);
      g.files.add(file.name);
      addPerson(g, 'cursor', { status: 'feito', did: 'Guardou o pedido num arquivo. Não executou no editor.', t: file.t, files: [file.name] });
      continue;
    }
    const g = touch(`arquivo-${file.name}`, file.name, file.t);
    g.files.add(file.name);
  }

  const since = new Date(Date.now() - 7 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  for (const row of harveyQuery('SELECT action_type, COUNT(*) n, MAX(created_at) last FROM actions WHERE created_at >= ? GROUP BY action_type ORDER BY last DESC LIMIT 8', since)) {
    const title = `${(ACTION_PT[row.action_type] || row.action_type).replace(/^./, c => c.toUpperCase())}${row.n > 1 ? ` (${row.n}x)` : ''}`;
    const key = subjectKey(`harvey ${row.action_type}`);
    if ([...groups.values()].some(g => g.people.has('harvey') && g.key === key)) continue;
    const t = Date.parse(String(row.last).replace(' ', 'T') + 'Z') || Date.now();
    const g = touch(key, title, t);
    addPerson(g, 'harvey', { status: 'feito', did: title, t, files: [] });
  }

  return {
    subjects: [...groups.values()].sort((a, b) => b.t - a.t).slice(0, 40).map(g => {
      const agents = [...g.people.values()].sort((a, b) => b.didT - a.didT).map(a => ({
        id: a.id,
        label: a.label,
        cargo: a.cargo,
        present: a.present,
        status: a.status,
        statusLabel: STATUS_PT[a.status] || '',
        did: a.did,
        files: a.files,
      }));
      const owned = new Set(agents.flatMap(a => a.files));
      return {
        id: createHash('sha1').update(g.key).digest('hex').slice(0, 10),
        title: g.title,
        t: g.t,
        agents,
        files: [...g.files].filter(f => !owned.has(f)),
      };
    }),
  };
}

// ── HTTP ───────────────────────────────────────────────────────────────────

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// Toda escrita exige o header X-Office. Sites de fora não conseguem mandá-lo
// sem preflight CORS (que nunca é respondido), então não conseguem rodar o claude por aqui.
function guarded(req) {
  if (req.headers['x-office'] !== '1') return false;
  const origin = req.headers.origin;
  return !origin || origin === `http://127.0.0.1:${PORT}` || origin === `http://localhost:${PORT}`;
}

// Só atende quem chama pelo próprio endereço. Sem isso, um site malicioso pode
// usar DNS rebinding pra ler chats, tarefas e arquivos do escritório.
const HOSTS_OK = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);

const server = http.createServer(async (req, res) => {
  if (!HOSTS_OK.has(String(req.headers.host || '').toLowerCase())) return json(res, 421, { error: 'host não permitido' });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (req.method === 'POST' && !guarded(req)) return json(res, 403, { error: 'forbidden' });

    if (p === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`event: snapshot\ndata: ${JSON.stringify(listAgents())}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clients.delete(res); clearInterval(ping); });
      return;
    }
    if (p === '/api/me') return json(res, 200, { name: ownerName() });
    if (p === '/api/resumo') return json(res, 200, officeResumo());
    if (p === '/api/agents') return json(res, 200, listAgents());
    if (req.method === 'GET' && p === '/api/meeting') return json(res, 200, meeting ? { ids: meeting.ids, lines: meeting.lines, running: meeting.running, busy: meeting.busy } : { lines: [] });
    if (req.method === 'POST' && p === '/api/meeting') {
      const { ids = [] } = await readBody(req);
      return json(res, 200, startMeeting(Array.isArray(ids) ? ids : []));
    }
    if (req.method === 'POST' && p === '/api/meeting/say') {
      const { text = '', attachments = [] } = await readBody(req);
      return json(res, 200, meetingSay(text, Array.isArray(attachments) ? attachments : []));
    }
    if (req.method === 'POST' && p === '/api/meeting/stop') return json(res, 200, stopMeeting());
    if (p === '/api/harvey') return json(res, 200, { ...harveySnapshot(), dashboard: await dashboardUp() });
    if (req.method === 'POST' && p === '/hook') { handleHook(await readBody(req)); return json(res, 200, {}); }
    if (req.method === 'POST' && p === '/api/harvey/dashboard') return json(res, 200, await ensureHarveyDashboard());
    if (req.method === 'POST' && (p === '/api/harvey/start' || p === '/api/harvey/stop')) {
      return json(res, 200, await harveyControl(p.split('/').pop()));
    }
    if (req.method === 'POST' && p === '/api/harvey/approve') return json(res, 200, await approveOutbox());
    let m;
    if (p === '/api/cursor/tarefas') return json(res, 200, cursorTasks(30));
    if (p === '/api/tasks') return json(res, 200, tasksToday());
    if (p === '/api/arquivos') {
      const files = fs.readdirSync(WORKSPACE).filter(f => !f.startsWith('.')).map(f => {
        const st = fs.statSync(path.join(WORKSPACE, f));
        return st.isFile() ? { name: f, size: st.size, t: st.mtimeMs } : null;
      }).filter(Boolean).sort((a, b) => b.t - a.t);
      return json(res, 200, files);
    }
    if (req.method === 'POST' && p === '/api/ask') {
      const { text = '' } = await readBody(req);
      if (!String(text).trim()) return json(res, 400, { ok: false, message: 'Escreve o que você precisa.' });
      const route = await routeAsk(String(text).slice(0, 8000));
      if (!route) return json(res, 200, { ok: false, message: 'Não achei quem faz isso. Começa com o nome, ex.: "li-post, ..."' });
      return json(res, 200, { ...chatTurn(route.id, route.text), id: route.id });
    }
    if ((m = p.match(/^\/api\/agents\/([\w:-]+)\/chat$/))) {
      if (req.method === 'GET') return json(res, 200, { ...getChat(m[1]), busy: chatProcs.has(m[1]) });
      const { text = '', attachments = [] } = await readBody(req);
      const atts = Array.isArray(attachments) ? attachments : [];
      if (!String(text).trim() && !atts.length) return json(res, 400, { ok: false, message: 'Mensagem vazia.' });
      return json(res, 200, chatTurn(m[1], String(text).slice(0, 8000), null, atts));
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/agents\/([\w:-]+)\/chat\/reset$/))) {
      chatProcs.get(m[1])?.kill('SIGTERM');
      chats[m[1]] = { sessionId: null, messages: [] }; saveChats();
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/agents\/([\w:-]+)\/chat\/stop$/))) {
      const c = chatProcs.get(m[1]); c?.kill('SIGTERM');
      return json(res, 200, { ok: !!c });
    }
    if (p.startsWith('/arquivos/')) {
      const f = path.join(WORKSPACE, path.basename(decodeURIComponent(p.slice(10))));
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end('não encontrado'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || (f.endsWith('.pdf') ? 'application/pdf' : f.endsWith('.md') || f.endsWith('.txt') ? 'text/plain; charset=utf-8' : 'application/octet-stream') });
      return fs.createReadStream(f).pipe(res);
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/agents\/([\w:-]+)\/run$/))) {
      const id = resolveSkill(m[1]);
      if (!id) return json(res, 404, { ok: false, message: 'Skill não encontrada.' });
      const { text = '' } = await readBody(req);
      return json(res, 200, runSkill(id, String(text)));
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/agents\/([\w:-]+)\/stop$/))) {
      const child = runs.get(m[1]);
      if (child) child.kill('SIGTERM');
      return json(res, 200, { ok: !!child });
    }
    // Estáticos
    const file = path.join(ROOT, 'public', p === '/' ? 'index.html' : path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`Pixel Office em http://127.0.0.1:${PORT}`));
