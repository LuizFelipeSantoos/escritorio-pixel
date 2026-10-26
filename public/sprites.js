// Sprites desenhados pixel a pixel. Cada personagem é um mapa 12x13 (só o tronco
// aparece — da cintura pra baixo fica atrás da mesa).
const SPRITES = {
  base: [
    '....HHHH....',
    '..HHHHHHHH..',
    '.HHHHHHHHHH.',
    '.HSSSSSSSSH.',
    '.SSEESSEESS.',
    '.SSSSSSSSSS.',
    '..SSSMMSSS..',
    '...SSSSSS...',
    '..CCCCCCCC..',
    '.CCCCCCCCCC.',
    'CCCCCCCCCCCC',
    'CCCCCCCCCCCC',
    'CCCCCCCCCCCC',
  ],
  harvey: [
    '...HHHHHH...',
    '..HHHHHHHHH.',
    '.HHHHHHHHHH.',
    '.HSSSSSSSSS.',
    '.SSEESSEESS.',
    '.SSSSSSSSSS.',
    '..SSMMMMSS..',
    '...SSSSSS...',
    '..CCWWWWCC..',
    '.CCCWTTWCCC.',
    'CCCCCTTCCCCC',
    'CCCCCTTCCCCC',
    'CCCCCTTCCCCC',
  ],
};

const SKIN = ['#f1c7a3', '#e0ac85', '#c68863', '#8d5a3b', '#f6d7bd', '#6b4128'];
const HAIR = ['#2b1d16', '#5a3a22', '#c48a3f', '#1a1a1a', '#a33b2b', '#e6d7a8', '#6e6e7a', '#3b2a5c'];
const SHIRT = ['#4da3ff', '#ff7a59', '#7bd88f', '#c792ea', '#ffcc4d', '#ff6b9a', '#55d6c2', '#e8e4d8', '#f28f3b'];

function hash(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function paletteFor(agent) {
  if (agent.kind === 'harvey') {
    return { H: '#1a1410', S: '#e9b98f', E: '#1b1a27', M: '#a5574a', C: '#1f2a44', W: '#f4f4f4', T: '#c0392b' };
  }
  const h = hash(agent.id);
  const shirt = agent.color || (agent.room === 'li' || agent.room === 'linkedin' ? ['#0a66c2', '#378fe9', '#70b5f9', '#004182'][h % 4] : SHIRT[h % SHIRT.length]);
  return { H: HAIR[(h >> 3) % HAIR.length], S: SKIN[(h >> 7) % SKIN.length], E: '#1b1a27', M: '#a5574a', C: shirt };
}

// Desenha o personagem. opts: { blink, sleeping, talk }
function drawCharacter(ctx, agent, x, y, opts = {}) {
  const map = SPRITES[agent.kind === 'harvey' ? 'harvey' : 'base'];
  const pal = paletteFor(agent);
  for (let r = 0; r < map.length; r++) {
    for (let c = 0; c < map[r].length; c++) {
      let k = map[r][c];
      if (k === '.') continue;
      if (k === 'E' && (opts.blink || opts.sleeping)) k = opts.sleeping && c % 2 === 0 ? 'E' : 'S';
      if (k === 'E' && opts.sleeping) { ctx.fillStyle = pal.E; ctx.fillRect(x + c, y + r + 1, 1, 1); continue; }
      if (k === 'M' && opts.talk) { ctx.fillStyle = '#5a2620'; ctx.fillRect(x + c, y + r, 1, 2); continue; }
      ctx.fillStyle = pal[k];
      ctx.fillRect(x + c, y + r, 1, 1);
    }
  }
  return pal;
}

window.Sprites = { drawCharacter, paletteFor, hash };
