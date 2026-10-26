// Avatares chibi desenhados pixel a pixel, 4 direções, andando e sentados.

const SKIN = ['#f3cba5', '#e5b088', '#c98e66', '#9a623f', '#f8dcc3', '#714528'];
const HAIR = ['#2b1d16', '#5a3a22', '#c48a3f', '#151515', '#a33b2b', '#e8d8a8', '#6e6e7a', '#3b2a5c', '#d26b8f'];
const SHIRT = ['#ff7a59', '#7bd88f', '#c792ea', '#ffcc4d', '#ff6b9a', '#55d6c2', '#f28f3b', '#9aa7ff'];
const LINKEDIN = ['#0a66c2', '#378fe9', '#70b5f9', '#1d4e89'];
const PANTS = ['#2d3047', '#3b3355', '#4a3b2a', '#1f2a44', '#39424e'];

export function hash(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * f))));
  return `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

export function lookFor(agent) {
  if (agent.kind === 'harvey') return { skin: '#ebbd93', hair: '#1a1410', shirt: '#1f2a44', pants: '#1a2236', style: 0, suit: true };
  if (agent.kind === 'player') return { skin: '#e5b088', hair: '#2b1d16', shirt: '#ff8a3d', pants: '#2d3047', style: 2, hoodie: true };
  if (agent.kind === 'cursor') {
    const h = hash(agent.id);
    const shirts = ['#1c1c1c', '#243056', '#4a2c3a', '#1d3a32'];
    const hairs = ['#151515', '#3a2a1a', '#22262e', '#4a3728'];
    return { skin: '#f3cba5', hair: hairs[h % 4], shirt: shirts[h % 4], pants: '#2d3047', style: h % 3, hoodie: true };
  }
  const h = hash(agent.id);
  const shirt = agent.color || (agent.room === 'li' || agent.room === 'linkedin' ? LINKEDIN[h % 4] : SHIRT[h % SHIRT.length]);
  return {
    skin: SKIN[(h >>> 4) % SKIN.length], hair: HAIR[(h >>> 8) % HAIR.length], shirt,
    pants: PANTS[(h >>> 12) % PANTS.length], style: (h >>> 16) % 4,
  };
}

// (px, py) = canto superior esquerdo do tile em pixels lógicos. frame 0..3 (passos).
export function drawAvatar(ctx, px, py, look, dir = 'down', frame = 0, sitting = false, typing = false) {
  const r = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const ink = (x, y, w, h, c) => {
    ctx.fillStyle = '#1a1614';
    ctx.fillRect(x - 1, y, w + 2, h);
    ctx.fillRect(x, y - 1, w, h + 2);
    r(x, y, w, h, c);
  };
  const cx = px + 8;
  const feet = py + 16;
  const step = frame % 2 === 1 ? (frame === 1 ? 1 : -1) : 0;
  const skinD = shade(look.skin, 0.82);
  const shirtD = shade(look.shirt, 0.72);

  ctx.fillStyle = 'rgba(16,12,20,.38)';
  ctx.beginPath(); ctx.ellipse(cx, feet, sitting ? 8 : 6, 2.6, 0, 0, Math.PI * 2); ctx.fill();

  const bodyTop = sitting ? feet - 10 : feet - 12;
  if (!sitting) {
    const lLift = step === 1 ? 2 : 0, rLift = step === -1 ? 2 : 0;
    ink(cx - 4, feet - 6, 3, 6 - lLift, look.pants);
    ink(cx + 1, feet - 6, 3, 6 - rLift, look.pants);
    r(cx - 4, feet - 2 - lLift, 3, 2, '#241c18');
    r(cx + 1, feet - 2 - rLift, 3, 2, '#241c18');
  } else {
    ink(cx - 5, feet - 4, 10, 3, look.pants);
    r(cx - 5, feet - 2, 3, 2, '#241c18');
    r(cx + 2, feet - 2, 3, 2, '#241c18');
  }

  ink(cx - 5, bodyTop, 10, 7, look.shirt);
  r(cx + 2, bodyTop + 1, 3, 6, shirtD);
  const swing = sitting ? 0 : step;
  const type = typing ? (frame % 2 === 0 ? 1 : -1) : 0;
  ink(cx - 7, bodyTop + 1 + swing + (typing ? 2 : 0), 2, typing ? 4 : 5, shirtD);
  r(cx - 7 + (type < 0 ? 1 : 0), bodyTop + (typing ? 6 : 5) + swing, 2, 2, look.skin);
  ink(cx + 5, bodyTop + 1 - swing + (typing ? 2 : 0), 2, typing ? 4 : 5, shirtD);
  r(cx + 4 + (type > 0 ? 1 : 0), bodyTop + (typing ? 6 : 5) - swing, 2, 2, look.skin);
  if (look.suit && dir !== 'up') { r(cx - 1, bodyTop, 2, 1, '#f7f4ef'); r(cx - 1, bodyTop + 1, 2, 5, '#c0392b'); }
  if (look.hoodie && dir === 'down') { r(cx - 3, bodyTop + 4, 6, 2, shirtD); r(cx - 1, bodyTop, 2, 2, '#ffe0c2'); }

  const ht = bodyTop - 10;
  ink(cx - 6, ht, 12, 10, look.skin);
  r(cx - 6, ht + 8, 12, 2, skinD);
  const H = look.hair;
  ink(cx - 6, ht - 3, 12, 5, H);
  if (look.style === 1) ink(cx - 2, ht - 6, 5, 3, H);
  if (look.style === 2) { r(cx - 5, ht - 5, 2, 3, H); r(cx - 1, ht - 6, 2, 3, H); r(cx + 3, ht - 5, 2, 3, H); }
  const long = look.style === 3;
  if (dir === 'up') {
    r(cx - 6, ht - 1, 12, long ? 11 : 9, H);
  } else if (dir === 'down') {
    r(cx - 6, ht + 1, 2, long ? 9 : 5, H);
    r(cx + 4, ht + 1, 2, long ? 9 : 5, H);
    r(cx - 3, ht + 4, 2, 2, '#1a1614');
    r(cx + 1, ht + 4, 2, 2, '#1a1614');
    r(cx - 3, ht + 4, 1, 1, '#fff');
    r(cx + 1, ht + 4, 1, 1, '#fff');
    r(cx - 4, ht + 7, 2, 1, '#f0a0a4');
    r(cx + 2, ht + 7, 2, 1, '#f0a0a4');
    r(cx - 1, ht - 2, 3, 1, 'rgba(255,255,255,.35)');
    if (!long) r(cx - 2, ht + 6, 4, 1, shade(look.skin, 0.9));
  } else {
    const faceLeft = dir === 'right';
    r(faceLeft ? cx - 6 : cx + 2, ht, 4, long ? 11 : 7, H);
    const eye = faceLeft ? cx + 2 : cx - 3;
    r(eye, ht + 4, 2, 2, '#1a1614');
    r(eye + (faceLeft ? -2 : 2), ht + 7, 2, 1, '#f0a0a4');
  }
}

// Retrato (só cabeça e ombros) para a lista e o chat.
export function drawPortrait(canvas, look) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const s = canvas.width / 22;
  ctx.setTransform(s, 0, 0, s, 0, 2);
  drawAvatar(ctx, 3, 8, look, 'down', 0, true);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
