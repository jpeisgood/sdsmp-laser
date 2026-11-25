/* SDSMP SNS: Instagram story images (1080×1920) — today's results and the next match day.
   Poster style: black stage, silky light trails, a thin glass frame, the association emblem on top and one big
   accent-coloured headline (orange / purple / blue). Every story is drawn on a canvas, so the preview is the file. */
(function () {
'use strict';
const { useState, useEffect, useRef } = preactHooks;
const { html, Icon, Empty, Seg } = UI;
const { PageHead, usePref } = PAGES;
const { S, fmtDateLong, todayStr, addDays, toast } = SD;

const W = 1080, H = 1920;
const FONT = {
  title: '"Kanit", "Arial Black", sans-serif',
  en: '"Kanit", "IBM Plex Sans KR", "Apple SD Gothic Neo", sans-serif',
  ko: '"IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
};
const WHITE = '#FFFFFF', DIM = 'rgba(255,255,255,0.62)', FAINT = 'rgba(255,255,255,0.42)';
const MEN = '#F2B705', WOMEN = '#9DB0FF';
const LEAGUE_EN = '2026 SEONGDEOK CHAMPIONS LEAGUE';
const LEAGUE_KR = '2026 성덕 풋살 챔피언스리그';
const DIV_LEAGUE = SD.DIV_LEAGUE;

// Three colourways of the same poster. rgb strings are for rgba() building.
const PAL = {
  ember: { label: '오렌지', bg: '#070302', title: '#BE5A1C', titleTop: '#D7752F', light: '#F3A566', line: '255,150,62',
    glow: ['255,112,28', '214,52,18', '255,176,84'], silk: ['255,138,48', '238,82,30', '255,196,120'] },
  violet: { label: '퍼플', bg: '#05030D', title: '#6639DD', titleTop: '#8058F2', light: '#BBA6FF', line: '160,120,255',
    glow: ['118,64,255', '70,40,210', '196,120,255'], silk: ['150,104,255', '96,62,236', '214,160,255'] },
  navy: { label: '블루', bg: '#020716', title: '#2E62EE', titleTop: '#4F86FF', light: '#9CC0FF', line: '96,150,255',
    glow: ['46,92,255', '40,170,255', '110,90,255'], silk: ['80,140,255', '50,196,255', '150,120,255'] },
};
const THEMES = ['ember', 'violet', 'navy'];
const DEFAULT_THEME = { results: 'violet', schedule: 'ember', recap: 'navy' };

// ---------- drawing helpers ----------
const setFont = (ctx, w, px, fam) => { ctx.font = `${w} ${px}px ${fam}`; };
function fitFont(ctx, text, maxW, w, px, fam, min = 16) { let s = px; setFont(ctx, w, s, fam); while (s > min && ctx.measureText(text).width > maxW) { s -= 2; setFont(ctx, w, s, fam); } return s; }
function spaced(ctx, text, x, y, sp, align = 'center') {
  const ch = [...String(text)], ws = ch.map(c => ctx.measureText(c).width);
  const total = ws.reduce((a, b) => a + b, 0) + sp * Math.max(0, ch.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const a0 = ctx.textAlign; ctx.textAlign = 'left';
  ch.forEach((c, i) => { ctx.fillText(c, cx, y); cx += ws[i] + sp; });
  ctx.textAlign = a0; return total;
}
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function glow(ctx, x, y, r, rgb, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.4, `rgba(${rgb},${a * 0.45})`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
let grainTile = null;
function grain() {
  if (grainTile) return grainTile;
  const c = document.createElement('canvas'); c.width = c.height = 220;
  const g = c.getContext('2d'), d = g.createImageData(220, 220);
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647); // seeded: every export looks the same
  for (let i = 0; i < d.data.length; i += 4) { const v = (rnd() * 255) | 0; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0); grainTile = c; return c;
}
const bez = (ctx, p) => { ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); ctx.bezierCurveTo(p[1][0], p[1][1], p[2][0], p[2][1], p[3][0], p[3][1]); };
// One silk ribbon: many hairlines swept between two curves, brightest in the middle of the band, plus a glowing edge.
function silk(ctx, A, B, rgb, alpha, n = 44) {
  const g = ctx.createLinearGradient(A[0][0], A[0][1], A[3][0], A[3][1]);
  g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(0.28, `rgba(${rgb},${alpha})`); g.addColorStop(0.72, `rgba(${rgb},${alpha * 0.85})`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.strokeStyle = g;
  for (let i = 0; i <= n; i++) {
    const t = i / n, k = Math.sin(Math.PI * t);
    const p = A.map((a, j) => [a[0] + (B[j][0] - a[0]) * t, a[1] + (B[j][1] - a[1]) * t]);
    ctx.globalAlpha = 0.25 + 0.75 * k; ctx.lineWidth = 0.8 + 1.8 * k;
    bez(ctx, p); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.shadowColor = `rgba(${rgb},0.95)`; ctx.shadowBlur = 26; ctx.lineWidth = 2.6;
  bez(ctx, A); ctx.stroke(); ctx.shadowBlur = 0;
}
// Light trails on black. `flip` mirrors the composition so result and schedule stories don't look identical.
function scene(ctx, P, flip) {
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
  ctx.save();
  if (flip) { ctx.translate(W, 0); ctx.scale(-1, 1); }
  glow(ctx, 60, 120, 820, P.glow[0], 0.78);
  glow(ctx, 1060, 1860, 900, P.glow[1], 0.85);
  glow(ctx, 1080, 560, 520, P.glow[2], 0.26);
  glow(ctx, -20, 1420, 480, P.glow[1], 0.3);
  ctx.globalCompositeOperation = 'lighter';
  silk(ctx, [[-140, 420], [260, 40], [720, 620], [1220, 230]], [[-140, 640], [440, 400], [600, 100], [1220, 500]], P.silk[0], 0.95, 60);
  silk(ctx, [[-160, 1580], [300, 1980], [760, 1340], [1240, 1700]], [[-160, 1800], [420, 1520], [700, 1990], [1240, 1500]], P.silk[1], 0.95, 60);
  silk(ctx, [[1240, 820], [760, 1180], [300, 680], [-160, 1160]], [[1240, 1060], [840, 800], [200, 1040], [-160, 940]], P.silk[2], 0.42, 40);
  silk(ctx, [[1180, -60], [880, 420], [1260, 860], [940, 1380]], [[1260, -40], [1060, 520], [1000, 820], [1120, 1400]], P.silk[0], 0.55, 40);
  // a few long thin arcs, like light catching the seams of a ball
  ctx.lineWidth = 1.8; ctx.shadowBlur = 16;
  [[540, 1030, 980, 3.55, 5.2, 0.5], [180, 2150, 1180, 4.4, 5.75, 0.42], [1250, 300, 900, 1.75, 3.1, 0.4], [-200, 900, 1000, 5.4, 6.9, 0.3]].forEach(([x, y, r, a0, a1, a]) => {
    ctx.strokeStyle = `rgba(${P.silk[2]},${a})`; ctx.shadowColor = `rgba(${P.silk[0]},0.9)`; ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.stroke();
  });
  ctx.restore();
  ctx.save(); ctx.globalAlpha = 0.06; ctx.globalCompositeOperation = 'overlay'; ctx.fillStyle = ctx.createPattern(grain(), 'repeat'); ctx.fillRect(0, 0, W, H); ctx.restore();
}
// Thin glass frame: dark inside so the type reads, silver edge brighter at the corners.
const FR = { x: 44, y: 204, w: 992, h: 1512 };
function frame(ctx) {
  const { x, y, w, h } = FR;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 50;
  const fg = ctx.createLinearGradient(0, y, 0, y + h);
  fg.addColorStop(0, 'rgba(16,14,16,0.62)'); fg.addColorStop(0.12, 'rgba(4,4,6,0.68)'); fg.addColorStop(0.88, 'rgba(4,4,6,0.68)'); fg.addColorStop(1, 'rgba(16,14,16,0.62)');
  ctx.fillStyle = fg; ctx.fillRect(x, y, w, h); ctx.restore();
  const sh = ctx.createLinearGradient(0, y, 0, y + 140); sh.addColorStop(0, 'rgba(255,255,255,0.09)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sh; ctx.fillRect(x, y, w, 140);
  const bg = ctx.createLinearGradient(x, y, x + w, y + h);
  bg.addColorStop(0, 'rgba(255,255,255,0.78)'); bg.addColorStop(0.25, 'rgba(255,255,255,0.30)'); bg.addColorStop(0.75, 'rgba(255,255,255,0.24)'); bg.addColorStop(1, 'rgba(255,255,255,0.7)');
  ctx.strokeStyle = bg; ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1; ctx.strokeRect(x + 12, y + 12, w - 24, h - 24);
}
// The association emblem in white between two glowing rules, with a small caption under it.
const whiteCache = new Map();
function whiteMark(img, size) {
  if (whiteCache.has(size)) return whiteCache.get(size);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), r = Math.min(size / img.naturalWidth, size / img.naturalHeight), w = img.naturalWidth * r, h = img.naturalHeight * r;
  g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  g.globalCompositeOperation = 'source-in'; g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
  whiteCache.set(size, c); return c;
}
const EMB_Y = 318;
function emblem(ctx, A, P, caption) {
  const s = 108;
  if (A.brand) ctx.drawImage(whiteMark(A.brand, s), W / 2 - s / 2, EMB_Y - s / 2);
  ctx.save(); ctx.lineCap = 'round'; ctx.shadowColor = `rgba(${P.line},0.9)`; ctx.shadowBlur = 14; ctx.lineWidth = 3;
  [[150, 452, 1], [628, 930, 0]].forEach(([x1, x2, inward]) => {
    const g = ctx.createLinearGradient(x1, 0, x2, 0);
    g.addColorStop(inward ? 0 : 1, `rgba(${P.line},0)`); g.addColorStop(inward ? 1 : 0, `rgba(${P.line},1)`);
    ctx.strokeStyle = g; ctx.beginPath(); ctx.moveTo(x1, EMB_Y); ctx.lineTo(x2, EMB_Y); ctx.stroke();
  });
  ctx.restore();
  if (caption) { ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; setFont(ctx, 500, 20, FONT.en); spaced(ctx, caption, W / 2, EMB_Y + 84, 6); }
}
function footer(ctx, text) {
  if (!text) return;
  ctx.textAlign = 'center'; ctx.fillStyle = FAINT; setFont(ctx, 500, 24, FONT.ko);
  ctx.fillText(text, W / 2, 1650);
}
function crest(ctx, img, cls, cx, cy, size) {
  if (img) {
    const r = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * r, h = img.naturalHeight * r;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h); return;
  }
  // no crest yet: a plain shield with the grade
  const s = size / 44; ctx.save(); ctx.translate(cx - 20 * s, cy - 22 * s); ctx.scale(s, s);
  ctx.beginPath(); ctx.moveTo(20, 2); ctx.lineTo(36, 8); ctx.lineTo(36, 21); ctx.bezierCurveTo(36, 31, 29, 38, 20, 42); ctx.bezierCurveTo(11, 38, 4, 31, 4, 21); ctx.lineTo(4, 8); ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = WHITE; setFont(ctx, 700, 16, FONT.en); ctx.textAlign = 'center'; ctx.fillText(String(cls || '?'), 20, 27);
  ctx.restore();
}
function hline(ctx, x1, x2, y, a = 0.12) { ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); }
// The one loud thing on every story: a wide geometric headline in the accent colour.
function title(ctx, P, text, y, px, maxW = 900) {
  const s = fitFont(ctx, text, maxW, 800, px, FONT.title, 60);
  const g = ctx.createLinearGradient(0, y - s * 0.72, 0, y);
  g.addColorStop(0, P.titleTop); g.addColorStop(1, P.title);
  ctx.textAlign = 'center'; ctx.fillStyle = g; ctx.fillText(text, W / 2, y);
  return s;
}
function sub(ctx, text, y, color, px = 30) {
  ctx.textAlign = 'center'; ctx.fillStyle = color || DIM; fitFont(ctx, text, 900, 600, px, FONT.ko, 20); ctx.fillText(text, W / 2, y);
}
// line icons for the info row
function icon(ctx, kind, x, y) {
  ctx.save(); ctx.strokeStyle = WHITE; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (kind === 'stadium') {
    ctx.beginPath(); ctx.ellipse(x, y - 10, 32, 11, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2.4; ctx.beginPath(); ctx.ellipse(x, y - 10, 19, 5.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - 32, y - 10); ctx.lineTo(x - 25, y + 10); ctx.ellipse(x, y + 10, 25, 8.5, 0, Math.PI, 0, true); ctx.lineTo(x + 32, y - 10); ctx.stroke();
    ctx.lineWidth = 2; [-0.62, -0.22, 0.22, 0.62].forEach(f => { ctx.beginPath(); ctx.moveTo(x + 32 * f, y - 10 + 11 * Math.sqrt(1 - f * f)); ctx.lineTo(x + 25 * f, y + 10 + 8.5 * Math.sqrt(1 - f * f)); ctx.stroke(); });
  } else if (kind === 'cal') {
    rrect(ctx, x - 24, y - 20, 48, 44, 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 24, y - 7); ctx.lineTo(x + 24, y - 7); ctx.moveTo(x - 11, y - 28); ctx.lineTo(x - 11, y - 13); ctx.moveTo(x + 11, y - 28); ctx.lineTo(x + 11, y - 13); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(x, y, 24, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - 13); ctx.lineTo(x, y); ctx.lineTo(x + 10, y + 7); ctx.stroke();
  }
  ctx.restore();
}

// ---------- match facts ----------
const minute = e => (e && e.half ? `${e.half === '1H' ? '전반' : '후반'} ${Math.floor((e.sec || 0) / 60) + 1}분` : '');
const nameOf = id => (S.players[id] || {}).name || '';
function matchFacts(m) {
  const evs = (m.goals || []).slice().sort(SD.evOrder);
  const total = (m.scoreH | 0) + (m.scoreA | 0);
  const timed = total > 0 && evs.length === total && evs.every(e => e.half);
  const half = { '1H': [0, 0], '2H': [0, 0] };
  if (timed) evs.forEach(e => { half[e.half][e.side === 'H' ? 0 : 1]++; });
  const ps = m.ps || {};
  // Goal by goal when the recorder logged them; otherwise fall back to the per-player tallies.
  const goals = side => {
    const own = evs.filter(e => e.side === side);
    if (own.length) return own.map(e => ({ name: nameOf(e.pid) || '선수', time: minute(e), ast: e.ast ? nameOf(e.ast) : '' }));
    const cls = side === 'H' ? m.home : m.away;
    return Object.keys(ps).filter(id => (S.players[id] || {}).cls === cls && Number(ps[id].g) > 0)
      .map(id => ({ name: nameOf(id), time: Number(ps[id].g) > 1 ? `${ps[id].g}골` : '', ast: '' }));
  };
  // player of the match: goal 3 points, assist 2, the winning side first on a tie
  const w = SD.winnerOf(m);
  let potm = null;
  Object.keys(ps).forEach(pid => {
    const p = S.players[pid]; if (!p) return;
    const g = Number(ps[pid].g) || 0, a = Number(ps[pid].a) || 0, v = g * 3 + a * 2;
    if (!v) return;
    const win = p.cls === w ? 1 : 0;
    if (!potm || v > potm.v || (v === potm.v && win > potm.win) || (v === potm.v && win === potm.win && g > potm.g)) potm = { p, g, a, v, win };
  });
  return { timed, half, home: goals('H'), away: goals('A'), pk: SD.pkScore(m), potm, w };
}
const stageText = m => (m.stage === 'group' ? `${m.group}조 ${m.seq}경기` : m.stage || '추가 경기');
const wd = ds => fmtDateLong(ds).replace(/^\d+월 \d+일 /, '');
const md = ds => { const [, mo, d] = ds.split('-').map(Number); return `${mo}월 ${d}일`; };
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const enDate = ds => { const [y, mo, d] = ds.split('-').map(Number); return `${MON[mo - 1]} ${d} ${y}`; };
const enTime = t => { if (!t) return '시간 미정'; const [h, mi] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
// What the result means for each side: group rank now, or how far the winner goes.
function standingNote(m, side, st) {
  const cls = side === 'H' ? m.home : m.away;
  if (m.stage === 'group') { const r = st.rank && st.rank[cls]; return r ? `${m.group}조 ${r.rank}위 · 승점 ${r.pts}` : ''; }
  const w = SD.winnerOf(m); if (!w || w !== cls) return '';
  const s = String(m.stage || '');
  if (/3.?4위/.test(s)) return '3위';
  if (/결승/.test(s) && !/준/.test(s)) return '우승';
  return '다음 라운드 진출';
}
// One centred row of outlined chips: [label, score]
function pills(ctx, P, items, y) {
  const gap = 18, padX = 26, h = 64;
  const ws = items.map(([l, v]) => { setFont(ctx, 600, 26, FONT.ko); const a = ctx.measureText(l).width; setFont(ctx, 700, 38, FONT.en); return padX * 2 + a + 14 + ctx.measureText(v).width; });
  let x = W / 2 - (ws.reduce((s, v) => s + v, 0) + gap * (items.length - 1)) / 2;
  items.forEach(([l, v], i) => {
    rrect(ctx, x, y - h / 2, ws[i], h, h / 2); ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill(); ctx.strokeStyle = `rgba(${P.line},0.55)`; ctx.lineWidth = 2; ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    setFont(ctx, 600, 26, FONT.ko); ctx.fillStyle = DIM; ctx.fillText(l, x + padX, y + 1);
    const lw = ctx.measureText(l).width;
    setFont(ctx, 700, 38, FONT.en); ctx.fillStyle = WHITE; ctx.fillText(v, x + padX + lw + 14, y + 3);
    x += ws[i] + gap;
  });
  ctx.textBaseline = 'alphabetic';
}
// Highlight box (player of the match, top scorer)
function honour(ctx, P, y, label, line, small) {
  rrect(ctx, 150, y, 780, 124, 22);
  ctx.fillStyle = 'rgba(255,255,255,0.045)'; ctx.fill(); ctx.strokeStyle = `rgba(${P.line},0.6)`; ctx.lineWidth = 2; ctx.stroke();
  ctx.textAlign = 'center'; ctx.fillStyle = P.light; setFont(ctx, 600, 24, FONT.en); spaced(ctx, label, W / 2, y + 44, 6);
  const s = fitFont(ctx, line, small ? 520 : 700, 700, 40, FONT.ko, 26); const lw = ctx.measureText(line).width;
  let cw = 0; if (small) { setFont(ctx, 500, 24, FONT.ko); cw = ctx.measureText(small).width + 18; }
  const x0 = W / 2 - (lw + cw) / 2;
  ctx.textAlign = 'left'; ctx.fillStyle = WHITE; setFont(ctx, 700, s, FONT.ko); ctx.fillText(line, x0, y + 100);
  if (small) { setFont(ctx, 500, 24, FONT.ko); ctx.fillStyle = DIM; ctx.fillText(small, x0 + lw + 18, y + 98); }
}

// ---------- stories ----------
function drawFinal(ctx, st, A) {
  const m = st.m, f = matchFacts(m), P = st.P;
  scene(ctx, P, true); frame(ctx); emblem(ctx, A, P, LEAGUE_EN);
  sub(ctx, `${DIV_LEAGUE[m.div]} · ${stageText(m)} · ${md(m.date)}`, 458, P.light, 28);
  // score row: 3 [crest]   [crest] 2 — the losing side is dimmed
  const cy = 640, hl = f.w && f.w !== m.home, al = f.w && f.w !== m.away;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; setFont(ctx, 800, 190, FONT.title);
  ctx.fillStyle = hl ? 'rgba(255,255,255,0.38)' : WHITE; ctx.fillText(String(m.scoreH | 0), 178, cy + 14);
  ctx.fillStyle = al ? 'rgba(255,255,255,0.38)' : WHITE; ctx.fillText(String(m.scoreA | 0), 902, cy + 14);
  ctx.textBaseline = 'alphabetic';
  crest(ctx, A.img[m.home], m.home, 395, cy, 200); crest(ctx, A.img[m.away], m.away, 685, cy, 200);
  [[m.home, 'H', 395], [m.away, 'A', 685]].forEach(([c, side, x]) => {
    ctx.textAlign = 'center'; ctx.fillStyle = WHITE; fitFont(ctx, SD.classLabel(c), 250, 700, 38, FONT.ko, 24); ctx.fillText(SD.classLabel(c), x, 800);
    const note = standingNote(m, side, st);
    if (note) { setFont(ctx, 500, 25, FONT.ko); ctx.fillStyle = /진출|우승/.test(note) ? P.light : DIM; ctx.fillText(note, x, 842); }
  });
  title(ctx, P, 'FULL TIME', 1012, 168, 900);
  // half-by-half score and shootout
  const items = [];
  if (f.timed) items.push(['전반', `${f.half['1H'][0]} : ${f.half['1H'][1]}`], ['후반', `${f.half['2H'][0]} : ${f.half['2H'][1]}`]);
  if (f.pk) items.push(['승부차기', `${f.pk[0]} : ${f.pk[1]}`]);
  let y = 1040;
  if (items.length) { pills(ctx, P, items, y + 50); y += 100; }
  // scorers, each side under its own half of the frame
  const potmTop = 1468, end = f.potm ? potmTop - 22 : 1600;
  const n = Math.max(f.home.length, f.away.length);
  y += 30;
  if (!n) {
    ctx.textAlign = 'center'; ctx.fillStyle = DIM; setFont(ctx, 500, 30, FONT.ko);
    ctx.fillText((m.scoreH | 0) + (m.scoreA | 0) ? '득점 기록이 아직 없습니다' : '무득점 경기', W / 2, y + 44);
  } else {
    const withAst = (end - y) / n >= 82 && f.home.concat(f.away).some(g => g.ast);
    const step = withAst ? 82 : Math.min(62, Math.floor((end - y) / n));
    const max = Math.min(n, Math.floor((end - y) / step));
    const vg = ctx.createLinearGradient(0, y - 6, 0, y + step * max);
    vg.addColorStop(0, 'rgba(255,255,255,0)'); vg.addColorStop(0.5, 'rgba(255,255,255,0.28)'); vg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = vg; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(540, y - 6); ctx.lineTo(540, y + step * max - 12); ctx.stroke();
    const col = (list, x) => list.slice(0, max).forEach((g, i) => {
      const yy = y + i * step + 28;
      ctx.textAlign = 'center';
      if (i === max - 1 && list.length > max) { setFont(ctx, 500, 26, FONT.ko); ctx.fillStyle = DIM; ctx.fillText(`외 ${list.length - max + 1}골`, x, yy); return; }
      setFont(ctx, 700, 34, FONT.ko); const nw = ctx.measureText(g.name).width;
      setFont(ctx, 600, 28, FONT.ko); const tw = g.time ? ctx.measureText(g.time).width + 16 : 0;
      const x0 = x - (nw + tw) / 2;
      ctx.textAlign = 'left'; setFont(ctx, 700, 34, FONT.ko); ctx.fillStyle = WHITE; ctx.fillText(g.name, x0, yy);
      if (g.time) { setFont(ctx, 600, 28, FONT.ko); ctx.fillStyle = P.light; ctx.fillText(g.time, x0 + nw + 16, yy); }
      if (withAst && g.ast) { ctx.textAlign = 'center'; setFont(ctx, 500, 23, FONT.ko); ctx.fillStyle = FAINT; ctx.fillText(`어시스트 ${g.ast}`, x, yy + 34); }
    });
    col(f.home, 300); col(f.away, 780);
  }
  if (f.potm) {
    const p = f.potm, stat = [p.g ? `${p.g}골` : '', p.a ? `${p.a}어시스트` : ''].filter(Boolean).join(' ');
    honour(ctx, P, potmTop, 'PLAYER OF THE MATCH', `${p.p.name}  ${stat}`, SD.classLabel(p.p.cls));
  }
  footer(ctx, st.footer);
}
// Shared match list: league/group label on top, then crest + class on each side of a centre column.
function rowsList(ctx, list, A, top, bottom, centre, winner) {
  const n = list.length, rowH = Math.min(196, Math.floor((bottom - top) / Math.max(1, n)));
  const y0 = top + Math.max(0, Math.floor(((bottom - top) - rowH * n) / 2));
  list.forEach((m, i) => {
    const y = y0 + i * rowH, cy = y + rowH / 2 + 14;
    if (i) hline(ctx, 120, 960, y, 0.1);
    ctx.textAlign = 'center'; ctx.fillStyle = m.div === 'W' ? WOMEN : MEN; setFont(ctx, 600, 23, FONT.ko);
    ctx.fillText(`${DIV_LEAGUE[m.div]} · ${stageText(m)}`, W / 2, y + 40);
    const cs = Math.min(104, rowH - 72), w = winner ? winner(m) : null;
    crest(ctx, A.img[m.home], m.home, 168, cy, cs); crest(ctx, A.img[m.away], m.away, 912, cy, cs);
    ctx.textBaseline = 'middle';
    const name = (c, x, align, dim) => { ctx.textAlign = align; ctx.fillStyle = dim ? 'rgba(255,255,255,0.45)' : WHITE; fitFont(ctx, SD.classLabel(c), 190, 700, 34, FONT.ko, 22); ctx.fillText(SD.classLabel(c), x, cy + 2); };
    name(m.home, 238, 'left', w && w !== m.home); name(m.away, 842, 'right', w && w !== m.away);
    ctx.textBaseline = 'alphabetic';
    centre(m, cy);
  });
}
function summaryHead(ctx, A, P, head, line) {
  emblem(ctx, A, P, LEAGUE_EN);
  ctx.textAlign = 'center'; ctx.fillStyle = WHITE; setFont(ctx, 700, 36, FONT.ko); spaced(ctx, LEAGUE_KR, W / 2, 466, 2);
  title(ctx, P, head, 668, 196, 900);
  sub(ctx, line, 734, P.light, 32);
}
function drawResults(ctx, st, A) {
  const P = st.P;
  scene(ctx, P, true); frame(ctx);
  summaryHead(ctx, A, P, 'RESULTS', `${md(st.date)} ${wd(st.date)} · ${st.label} 경기 결과${st.pages > 1 ? ` ${st.page}/${st.pages}` : ''}`);
  const top = st.top && st.list.length <= 4 ? st.top : null;
  rowsList(ctx, st.list, A, 774, top ? 1448 : 1606, (m, y) => {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; setFont(ctx, 700, 84, FONT.en); ctx.fillStyle = WHITE;
    ctx.fillText(`${m.scoreH | 0} : ${m.scoreA | 0}`, W / 2, y + 6);
    const pk = SD.pkScore(m); if (pk) { setFont(ctx, 600, 23, FONT.ko); ctx.fillStyle = DIM; ctx.fillText(`승부차기 ${pk[0]} : ${pk[1]}`, W / 2, y + 60); }
    ctx.textBaseline = 'alphabetic';
  }, m => SD.winnerOf(m));
  if (top) honour(ctx, P, 1468, "TODAY'S TOP SCORER", `${top.names}  ${top.g}골`);
  footer(ctx, st.footer);
}
function drawSchedule(ctx, st, A) {
  const P = st.P;
  scene(ctx, P, false); frame(ctx);
  summaryHead(ctx, A, P, 'MATCH DAY', `${md(st.date)} ${wd(st.date)} · ${st.label} ${st.total}경기${st.pages > 1 ? ` (${st.page}/${st.pages})` : ''}`);
  rowsList(ctx, st.list, A, 774, 1606, (m, y) => {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; setFont(ctx, 700, 72, FONT.en); ctx.fillStyle = WHITE;
    ctx.fillText(m.time || '--:--', W / 2, y - 4);
    setFont(ctx, 600, 24, FONT.ko); ctx.fillStyle = P.light; ctx.fillText(SD.venueName(m.venue) || '구장 미정', W / 2, y + 48);
    ctx.textBaseline = 'alphabetic';
  });
  footer(ctx, st.footer);
}
function drawNext(ctx, st, A) {
  const m = st.m, P = st.P;
  scene(ctx, P, false); frame(ctx); emblem(ctx, A, P, LEAGUE_EN);
  sub(ctx, `${DIV_LEAGUE[m.div]} · ${stageText(m)}`, 458, P.light, 28);
  crest(ctx, A.img[m.home], m.home, 395, 650, 240); crest(ctx, A.img[m.away], m.away, 685, 650, 240);
  title(ctx, P, 'NEXT', 994, 238, 900);
  title(ctx, P, 'MATCH', 1186, 238, 900);
  ctx.textAlign = 'center'; ctx.fillStyle = WHITE;
  fitFont(ctx, SD.classLabel(m.home), 230, 700, 38, FONT.ko, 24); ctx.fillText(SD.classLabel(m.home), 395, 1270);
  fitFont(ctx, SD.classLabel(m.away), 230, 700, 38, FONT.ko, 24); ctx.fillText(SD.classLabel(m.away), 685, 1270);
  setFont(ctx, 600, 34, FONT.en); ctx.fillText('VS', 540, 1269);
  const cols = [[224, 'stadium', SD.venueName(m.venue) || '구장 미정'], [540, 'cal', enDate(m.date)], [856, 'clock', enTime(m.time)]];
  cols.forEach(([x, k, t]) => { icon(ctx, k, x, 1446); ctx.textAlign = 'center'; ctx.fillStyle = WHITE; fitFont(ctx, t, 280, 600, 36, FONT.en, 22); ctx.fillText(t, x, 1528); });
  footer(ctx, st.footer);
}
const DRAW = { final: drawFinal, results: drawResults, schedule: drawSchedule, next: drawNext };

// ---------- assets ----------
const imgCache = {};
// Crests must not taint the canvas (a tainted canvas cannot be saved), so load them in CORS mode, or as a blob.
const imgFrom = (src, cors) => new Promise(res => { const i = new Image(); if (cors) i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
const loadImg = url => imgCache[url] || (imgCache[url] = (async () => {
  const a = await imgFrom(url, true); if (a) return a;
  try { const r = await fetch(url); if (!r.ok) return null; return await imgFrom(URL.createObjectURL(await r.blob()), false); } catch (e) { return null; }
})());
async function prepare(st) {
  const ms = st.m ? [st.m] : st.list;
  const classes = [...new Set(ms.flatMap(m => [m.home, m.away]).filter(Boolean))];
  const img = {};
  const [brand] = await Promise.all([loadImg('logos/brand.webp'), ...classes.map(async c => { const u = SD.logoUrl(c); img[c] = u ? await loadImg(u) : null; })]);
  // Korean web fonts arrive in slices; ask for exactly the characters this story uses.
  const text = [LEAGUE_KR, '오늘 내일 경기 결과 일정 전반 후반 승부차기 어시스트 골 분 외 구장 미정 시간 득점 기록이 아직 없습니다 무득점 경기 남학생 여학생 리그 조 위 승점 다음 라운드 진출 우승 월 일 요일 학년 반 추가 순위결정전 0123456789',
    st.footer || '', ...classes.map(SD.classLabel), ...ms.flatMap(m => Object.keys(m.ps || {}).map(id => (S.players[id] || {}).name || '')), ...ms.map(m => `${m.stage || ''} ${SD.venueName(m.venue) || ''}`)].join(' ');
  try {
    await Promise.all([
      document.fonts.load(`800 100px ${FONT.title}`, 'NEXTMATCHFULLTIMERESULTSDAY0123456789'),
      document.fonts.load(`700 40px ${FONT.en}`, `0123456789: ${MON.join('')}AMPM`),
      document.fonts.load(`600 36px ${FONT.en}`, `${LEAGUE_EN}VS PLAYEROFTHEMATCH TODAY'S TOP SCORER ${MON.join('')}AMPM0123456789:`),
      document.fonts.load(`500 20px ${FONT.en}`, LEAGUE_EN),
      document.fonts.load(`700 38px ${FONT.ko}`, text),
      document.fonts.load(`600 28px ${FONT.ko}`, text),
      document.fonts.load(`500 24px ${FONT.ko}`, text),
    ]);
  } catch (e) { /* fall back to system fonts */ }
  return { img, brand };
}
async function render(st) {
  const A = await prepare(st);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'); ctx.textBaseline = 'alphabetic';
  DRAW[st.kind](ctx, st, A);
  return c;
}

// ---------- saving ----------
let dl = null; // downloads capability (null where this view cannot save files)
async function saveStory(canvas, filename) {
  try {
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
    const d = dl || (dl = await claude.use('downloads').catch(() => null));
    if (!d) { toast('이 화면에서는 바로 저장할 수 없습니다. 크게 보기에서 이미지를 길게 눌러(또는 오른쪽 클릭) 저장하세요.', 'err'); return; }
    const r = await d.save({ filename, data: blob });
    if (r && r.status === 'saved') toast('이미지를 저장했습니다.');
  } catch (e) {
    const c = e && e.code;
    if (c === 'declined') return;
    toast(c === 'rate_limited' ? '저장 확인 창이 이미 열려 있습니다. 잠시 후 다시 눌러 주세요.'
      : '여기서는 바로 저장할 수 없습니다. 크게 보기에서 이미지를 길게 눌러(또는 오른쪽 클릭) 저장하세요.', 'err');
  }
}
function SaveBtn({ shot, file, big }) {
  const [busy, setBusy] = useState(false);
  const ok = shot && shot.url && shot.url !== 'err';
  return html`<button type="button" class=${'btn btn-primary ' + (big ? '' : 'btn-sm')} disabled=${!ok || busy}
    onClick=${async () => { setBusy(true); await saveStory(shot.canvas, file); setBusy(false); }}><${Icon} n="save" size=${15} />이미지 저장</button>`;
}

// ---------- page ----------
const sigOf = st => JSON.stringify([st.kind, st.theme, st.footer, st.date, st.page, st.label, st.top, st.total, st.m && st.rank && [st.rank[st.m.home], st.rank[st.m.away]],
  (st.m ? [st.m] : st.list).map(m => [m.id, m.home, m.away, m.scoreH, m.scoreA, m.time, m.venue, m.date, m.goals, m.ps, m.pk, m.status])]);
function StoryCard({ st, guides, onShot, onOpen }) {
  const [shot, setShot] = useState(null);
  const sig = sigOf(st);
  useEffect(() => {
    let live = true;
    render(st).then(c => {
      if (!live) return;
      let url; try { url = c.toDataURL('image/jpeg', 0.92); } catch (e) { url = 'err'; }
      const s = { url, canvas: c }; setShot(s); onShot(st.key, s);
    });
    return () => { live = false; };
  }, [sig]);
  const ok = shot && shot.url !== 'err';
  return html`<figure class="story">
    <button type="button" class="story-frame" aria-label=${st.title + ' 크게 보기'} disabled=${!ok} onClick=${onOpen}>
      ${ok ? html`<img src=${shot.url} alt=${st.alt} />` : html`<div class="story-wait">${shot ? '이미지를 만들지 못했습니다' : '그리는 중…'}</div>`}
      ${guides ? html`<i class="safe t"></i><i class="safe b"></i>` : null}
      ${ok ? html`<span class="story-zoom" aria-hidden="true"><${Icon} n="search" size=${16} /></span>` : null}</button>
    <figcaption><b>${st.title}</b><span>${st.sub}</span><${SaveBtn} shot=${shot} file=${st.file} /></figcaption>
  </figure>`;
}
// Big centred view of one story; arrows / keys step through the set.
function Lightbox({ stories, idx, shots, onIdx, onClose, guides, band }) {
  const n = stories.length, st = stories[idx], shot = shots[st.key];
  useEffect(() => {
    const k = e => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && idx < n - 1) onIdx(idx + 1);
      else if (e.key === 'ArrowLeft' && idx > 0) onIdx(idx - 1);
    };
    window.addEventListener('keydown', k);
    const ov = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ov; };
  }, [idx, n]);
  // swipe left / right on phones
  const x0 = useRef(null);
  const touch = {
    onTouchStart: e => { x0.current = e.touches[0].clientX; },
    onTouchEnd: e => { if (x0.current == null) return; const dx = e.changedTouches[0].clientX - x0.current; x0.current = null; if (dx < -50 && idx < n - 1) onIdx(idx + 1); else if (dx > 50 && idx > 0) onIdx(idx - 1); },
  };
  return html`<div class="lb" role="dialog" aria-modal="true" aria-label="스토리 크게 보기" onClick=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <button type="button" class="lb-x" aria-label="닫기" onClick=${onClose}><${Icon} n="close" size=${22} /></button>
    ${idx > 0 ? html`<button type="button" class="lb-nav prev" aria-label="이전" onClick=${() => onIdx(idx - 1)}><${Icon} n="back" size=${26} /></button>` : null}
    ${idx < n - 1 ? html`<button type="button" class="lb-nav next" aria-label="다음" onClick=${() => onIdx(idx + 1)}><${Icon} n="chev" size=${26} /></button>` : null}
    <figure class="lb-fig" ...${touch}>
      <div class="lb-img">${shot && shot.url !== 'err' ? html`<img src=${shot.url} alt=${st.alt} />` : html`<div class="story-wait">그리는 중…</div>`}
        ${guides ? html`<i class=${'safe t' + (band ? ' band' : '')}></i><i class=${'safe b' + (band ? ' band' : '')}></i>` : null}</div>
      <figcaption><div><b>${st.title}</b><span>${idx + 1} / ${n} · ${st.sub}</span></div><${SaveBtn} shot=${shot} file=${st.file} big=${true} /></figcaption>
    </figure>
  </div>`;
}
const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const byTime = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || SD.mKey(a).localeCompare(SD.mKey(b));
const FOOT_DEFAULT = '#성덕챔피언스리그  ·  SDSMP';
function SnsPage({ L, canEdit }) {
  const today = todayStr();
  const [mode, setMode] = usePref('snsMode', 'results');
  const [date, setDate] = useState(() => (mode === 'schedule' ? addDays(today, 1) : today));
  const [div, setDiv] = usePref('snsDiv', 'all');
  const [guides, setGuides] = useState(true);
  const [zoom, setZoom] = useState(-1);
  const [, setTick] = useState(0);
  const shots = useRef({});
  const cfg = SD.deepMerge(SD.DEFAULT_TV, S.tv || {});
  const footerText = cfg.snsFooter == null ? FOOT_DEFAULT : cfg.snsFooter;
  const [foot, setFoot] = useState(footerText);
  const [localTheme, setLocalTheme] = useState({});
  const theme = localTheme[mode] || (cfg.snsTheme && cfg.snsTheme[mode]) || DEFAULT_THEME[mode];
  const P = PAL[theme] || PAL[DEFAULT_THEME[mode]];
  const pickTheme = v => { setLocalTheme({ ...localTheme, [mode]: v }); if (canEdit) PAGES.saveTv({ snsTheme: { [mode]: v } }); };
  const switchMode = v => { setMode(v); setZoom(-1); setDate(v === 'schedule' ? addDays(today, 1) : today); };
  // 토너먼트 대진표 이미지는 원본 SDSMP 전용 (kosns.js)
  const koOk = !!(window.KOSNS && KOSNS.available());
  const modeSeg = html`<${Seg} label="종류" value=${mode} onChange=${switchMode} options=${[{ value: 'results', label: '경기 결과' }, { value: 'schedule', label: '경기 일정' }, { value: 'recap', label: '주간 리캡' },
    ...(koOk ? [{ value: 'bracket', label: '토너먼트 대진표' }] : [])]} />`;
  const saveFoot = () => { PAGES.saveTv({ snsFooter: foot.trim() }); toast('하단 문구를 저장했습니다.'); };
  const look = html`
      <div class="field"><span>색상</span><div class="swatches" role="group" aria-label="색상">${THEMES.map(t => html`
        <button type="button" class=${'swatch ' + t} aria-pressed=${String(theme === t)} onClick=${() => pickTheme(t)}><i></i>${PAL[t].label}</button>`)}</div></div>
      <label class="field sns-foot"><span>이미지 하단 문구</span><div class="row"><input id="sns-footer" class="input" style="flex:1;min-width:160px" value=${foot} disabled=${!canEdit} onInput=${e => setFoot(e.target.value)} placeholder="예: @seongdeok_league" />
        ${canEdit ? html`<button type="button" class="btn btn-sm" onClick=${saveFoot}>저장</button>` : null}</div></label>
      <label class="switch"><input type="checkbox" checked=${guides} onChange=${e => setGuides(e.target.checked)} /><span>${mode === 'recap' ? '9:14 안전 영역 표시' : '가려지는 영역 표시'}</span></label>`;
  if (mode === 'bracket' && koOk) return html`<div>
    <${PageHead} eyebrow="Knockout bracket" title="SNS" desc="토너먼트 대진표를 부별로 세로 스토리(1080×1920)와 가로(1920×1080) 이미지로 만듭니다. 경기 결과가 기록되면 이긴 반이 올라간 대진표로 바로 바뀝니다. 이미지를 누르면 크게 볼 수 있습니다.">${modeSeg}</${PageHead}>
    <div class="sns-bar">
      <label class="field sns-foot"><span>이미지 하단 문구</span><div class="row"><input id="sns-footer" class="input" style="flex:1;min-width:160px" value=${foot} disabled=${!canEdit} onInput=${e => setFoot(e.target.value)} placeholder="예: @seongdeok_league" />
        ${canEdit ? html`<button type="button" class="btn btn-sm" onClick=${saveFoot}>저장</button>` : null}</div></label>
      <label class="switch"><input type="checkbox" checked=${guides} onChange=${e => setGuides(e.target.checked)} /><span>스토리에서 가려지는 영역 표시</span></label>
    </div>
    <${KOSNS.Panel} L=${L} guides=${guides} footerText=${footerText} />
  </div>`;
  if (mode === 'recap') return html`<div>
    <${PageHead} eyebrow="Weekly recap" title="SNS" desc="한 주의 경기를 9:16 스토리로 정리합니다. 장면마다 켜기·끄기, 시간, 순서를 바꾸고 미리보기로 움직임을 확인한 뒤 장면별 이미지로 저장하세요. 내용은 위아래 여백을 둔 9:14 안쪽에 들어갑니다.">${modeSeg}</${PageHead}>
    <div class="sns-bar">${look}</div>
    <${RECAP.RecapPanel} L=${L} canEdit=${canEdit} P=${P} theme=${theme} footerText=${footerText} guides=${guides} />
  </div>`;
  const pass = m => m.date === date && m.home && m.away && (div === 'all' || m.div === div);
  const finals = L.matches.filter(m => pass(m) && m.status === 'final').sort(byTime);
  const sched = L.matches.filter(m => pass(m)).sort(byTime);
  const label = date === addDays(today, 1) ? '내일' : date === today ? '오늘' : md(date);
  const stamp = date.replace(/-/g, '');
  // group rank right now for every class, so a result story can say where each side stands
  const rank = {};
  Object.values(L.standings).forEach(gs => Object.values(gs).forEach(g => g.rows.forEach((r, i) => { rank[r.cls] = { rank: i + 1, pts: r.pts }; })));
  // the day's top scorer(s)
  const tally = {};
  finals.forEach(m => Object.keys(m.ps || {}).forEach(id => { const g = Number(m.ps[id].g) || 0; if (g && S.players[id]) tally[id] = (tally[id] || 0) + g; }));
  const best = Math.max(0, ...Object.values(tally));
  const tops = Object.keys(tally).filter(id => tally[id] === best);
  const top = best && tops.length <= 2 ? { g: best, names: tops.map(id => `${S.players[id].name}(${SD.classLabel(S.players[id].cls)})`).join(' · ') } : null;
  const base = { P, theme, footer: footerText };
  const stories = [];
  if (mode === 'results') {
    const pages = chunk(finals, 5);
    pages.forEach((list, i) => stories.push({ ...base, key: 'r' + i, kind: 'results', date, list, label, top: i === pages.length - 1 ? top : null, page: i + 1, pages: pages.length,
      title: `${label} 경기 결과`, sub: `${list.length}경기${pages.length > 1 ? ` · ${i + 1}/${pages.length}` : ''}`, alt: `${md(date)} 경기 결과`, file: `SDSCL_${stamp}_결과${pages.length > 1 ? '_' + (i + 1) : ''}.jpg` }));
    finals.forEach((m, i) => stories.push({ ...base, key: 'f' + m.id, kind: 'final', m, rank, title: `${SD.classLabel(m.home)} ${m.scoreH}:${m.scoreA} ${SD.classLabel(m.away)}`,
      sub: `${DIV_LEAGUE[m.div]} · ${stageText(m)}`, alt: 'FULL TIME', file: `SDSCL_${stamp}_FT_${i + 1}_${m.home}vs${m.away}.jpg` }));
  } else {
    const pages = chunk(sched, 5);
    pages.forEach((list, i) => stories.push({ ...base, key: 's' + i, kind: 'schedule', date, list, label, total: sched.length, page: i + 1, pages: pages.length,
      title: `${label} 경기 일정`, sub: `${list.length}경기${pages.length > 1 ? ` · ${i + 1}/${pages.length}` : ''}`, alt: `${md(date)} 경기 일정`, file: `SDSCL_${stamp}_일정${pages.length > 1 ? '_' + (i + 1) : ''}.jpg` }));
    sched.forEach((m, i) => stories.push({ ...base, key: 'n' + m.id, kind: 'next', m, title: `${m.time || '--:--'} ${SD.classLabel(m.home)} vs ${SD.classLabel(m.away)}`,
      sub: `${DIV_LEAGUE[m.div]} · ${stageText(m)}`, alt: 'NEXT MATCH', file: `SDSCL_${stamp}_NEXT_${i + 1}_${m.home}vs${m.away}.jpg` }));
  }
  const onShot = (k, s) => { shots.current[k] = s; setTick(t => t + 1); };
  return html`<div>
    <${PageHead} eyebrow="Instagram story" title="SNS" desc="인스타그램 스토리(1080×1920)용 이미지를 경기 기록으로 바로 만듭니다. 이미지를 누르면 크게 볼 수 있고, 빗금 친 위·아래는 인스타 화면 막대에 가려질 수 있는 부분입니다.">
      ${modeSeg}
    </${PageHead}>
    <div class="sns-bar">
      <label class="field"><span>날짜</span><div class="row">
        <button type="button" class="icon-btn" aria-label="하루 전" onClick=${() => setDate(addDays(date, -1))}><${Icon} n="back" /></button>
        <input id="sns-date" type="date" class="input" value=${date} onInput=${e => e.target.value && setDate(e.target.value)} />
        <button type="button" class="icon-btn" aria-label="하루 뒤" onClick=${() => setDate(addDays(date, 1))}><${Icon} n="chev" /></button>
        <button type="button" class="btn btn-sm" onClick=${() => setDate(mode === 'schedule' ? addDays(today, 1) : today)}>${mode === 'schedule' ? '내일' : '오늘'}</button></div></label>
      <label class="field"><span>리그</span><${Seg} label="리그" value=${div} onChange=${setDiv} options=${[{ value: 'all', label: '전체' }, { value: 'M', label: '남학생', cls: 'men' }, { value: 'W', label: '여학생', cls: 'women' }]} /></label>
      ${look}
    </div>
    ${stories.length ? html`<div class="story-grid">${stories.map((st, i) => html`<${StoryCard} key=${st.key} st=${st} guides=${guides} onShot=${onShot} onOpen=${() => setZoom(i)} />`)}</div>`
      : html`<section class="panel"><${Empty} title=${mode === 'results' ? `${md(date)}에 끝난 경기가 없습니다` : `${md(date)}에 편성된 경기가 없습니다`}>${mode === 'results' ? '경기를 「종료됨」으로 확정하면 결과 이미지가 만들어집니다.' : '경기 일정에서 이 날짜에 경기를 편성하면 일정 이미지가 만들어집니다.'}</${Empty}></section>`}
    ${zoom >= 0 && zoom < stories.length ? html`<${Lightbox} stories=${stories} idx=${zoom} shots=${shots.current} onIdx=${setZoom} onClose=${() => setZoom(-1)} guides=${guides} />` : null}
  </div>`;
}

window.SNS = { SnsPage, render, PAL,
  // shared poster kit for the weekly recap (recap.js)
  K: { W, H, FONT, PAL, THEMES, WHITE, DIM, FAINT, MEN, WOMEN, LEAGUE_EN, LEAGUE_KR, MON, setFont, fitFont, spaced, rrect, glow, scene, frame, emblem,
    footer, crest, hline, title, sub, pills, honour, matchFacts, stageText, md, wd, enDate, loadImg, saveStory, SaveBtn, Lightbox, chunk } };
})();
