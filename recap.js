/* SDSMP weekly recap — SNS › 주간 리캡.
   One played week as a 9:16 story sequence: cover, the week's results, match and player of the week, group tables,
   the TOP lists and the best class of each grade. Every page is a function of time drawn on a canvas, so the same
   code makes the animated preview, the still images and (next step) the video. Content stays in the 9:14 band. */
(function () {
'use strict';
const { useState, useEffect, useRef } = preactHooks;
const { html, Icon, Empty, Seg } = UI;
const { S, toast } = SD;
const K = SNS.K;
const { W, H, FONT, WHITE, DIM, FAINT, MEN, WOMEN, LEAGUE_EN, LEAGUE_KR, MON, setFont, fitFont, spaced, rrect, glow, scene, frame, emblem,
  crest, pills, honour, loadImg, stageText, matchFacts, chunk, Lightbox, SaveBtn } = K;
const headline = K.title;

// ---------- layout & palette ----------
const TITLE_Y = 580, SUB_Y = 636, CT = 680, CB = 1606; // headline, sub line, content band
const X0 = 84, XW = W - 168;
const RGB = { M: '242,183,5', W: '157,176,255' };
const TINT = { 1: '242,183,5', 2: '200,210,228', 3: '214,138,90' };
const RANK_C = { 1: '#FFD34D', 2: '#E8ECF4', 3: '#F2AE7E' };
const UP = '#45E08F', DOWN = '#FF7A86', NEWC = '#FFD34D', ADV = '69,224,143';
const DIV_KO = { M: '남학생', W: '여학생' };
const WDK = ['일', '월', '화', '수', '목', '금', '토'];
const pd = ds => ds.split('-').map(Number);
const dayKo = ds => { const [y, m, d] = pd(ds); return `${m}.${d} (${WDK[new Date(y, m - 1, d).getDay()]})`; };
const dot = ds => { const [, m, d] = pd(ds); return `${m}.${d}`; };
function rangeKo(a, b) { const [, m1, d1] = pd(a), [, m2, d2] = pd(b); return a === b ? `${m1}월 ${d1}일` : m1 === m2 ? `${m1}월 ${d1}일 – ${d2}일` : `${m1}월 ${d1}일 – ${m2}월 ${d2}일`; }
function rangeEn(a, b) { const [, m1, d1] = pd(a), [y2, m2, d2] = pd(b); return a === b ? `${MON[m1 - 1]} ${d1}, ${y2}` : m1 === m2 ? `${MON[m1 - 1]} ${d1} – ${d2}, ${y2}` : `${MON[m1 - 1]} ${d1} – ${MON[m2 - 1]} ${d2}, ${y2}`; }
const fmtSec = t => { const s = Math.max(0, Math.round(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------- motion ----------
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const eOut = t => 1 - Math.pow(1 - t, 3);
const eBack = t => { const c = 1.8; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = t => ((ax * t + bx) * t + cx) * t, fy = t => ((ay * t + by) * t + cy) * t, dx = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const d = fx(t) - x; if (Math.abs(d) < 1e-5) break; const s = dx(t); if (Math.abs(s) < 1e-6) break; t -= d / s; }
    return fy(clamp(t));
  };
}
const EF = bezier(0.16, 0.84, 0.24, 1); // the TV's row easing
const DONE = { x: 0, sk: 0, a: 1 };
// TV row entrance (tvfly): in from the right with a −16° lean, overshoot a hair, settle.
function fly(τ, i, d0 = 0.3, gap = 0.13, dur = 0.85) {
  const p = clamp((τ - d0 - i * gap) / dur);
  if (p >= 1) return DONE;
  let x, sk;
  if (p < 0.78) { const e = EF(p / 0.78); x = 1.15 + (-0.016 - 1.15) * e; sk = -16 + 19 * e; }
  else { const e = EF((p - 0.78) / 0.22); x = -0.016 * (1 - e); sk = 3 * (1 - e); }
  return { x, sk: sk * Math.PI / 180, a: p < 0.55 ? EF(p / 0.55) : 1 };
}
function inFly(ctx, f, x, y, w, h, fn) {
  if (f.a <= 0.001) return;
  ctx.save(); ctx.globalAlpha *= f.a;
  if (f !== DONE) { const cx = x + w / 2, cy = y + h / 2; ctx.translate(cx + f.x * w, cy); if (f.sk) ctx.transform(1, 0, Math.tan(f.sk), 1, 0, 0); ctx.translate(-cx, -cy); }
  fn(); ctx.restore();
}
// The light sweep that crosses a row once it has landed.
function glint(ctx, τ, t0, x, y, w, h, r) {
  const p = (τ - t0) / 0.9; if (p <= 0 || p >= 1) return;
  const gx = x - w * 0.3 + w * 1.5 * eOut(p);
  ctx.save(); rrect(ctx, x, y, w, h, r); ctx.clip();
  const g = ctx.createLinearGradient(gx - 140, y, gx + 140, y + h * 0.35);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.2)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h); ctx.restore();
}
const fade = (ctx, a, fn) => { if (a <= 0.001) return; ctx.save(); ctx.globalAlpha *= a; fn(); ctx.restore(); };

// ---------- small drawing helpers ----------
function card(ctx, x, y, w, h, r, tint) {
  rrect(ctx, x, y, w, h, r);
  const g = ctx.createLinearGradient(x, y, x + w, y);
  if (tint) { g.addColorStop(0, `rgba(${tint},0.32)`); g.addColorStop(0.5, `rgba(${tint},0.11)`); g.addColorStop(1, `rgba(${tint},0.05)`); }
  else { g.addColorStop(0, 'rgba(255,255,255,0.085)'); g.addColorStop(1, 'rgba(255,255,255,0.03)'); }
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = tint ? `rgba(${tint},0.5)` : 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; ctx.stroke();
}
function clip(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text; while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
// Up to `lines` lines of " · "-separated facts.
function wrapBits(ctx, text, maxW, lines) {
  const parts = text.split(' · '), out = [];
  let cur = '';
  for (const p of parts) {
    const t = cur ? `${cur} · ${p}` : p;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t;
    else { out.push(cur); cur = p; if (out.length === lines) break; }
  }
  if (out.length < lines && cur) out.push(cur);
  if (out.length) out[out.length - 1] = clip(ctx, out[out.length - 1], maxW);
  return out.slice(0, lines);
}
// Letter-spaced line, filled and/or outlined.
function track(ctx, text, x, y, sp, fill, stroke) {
  const ch = [...text], ws = ch.map(c => ctx.measureText(c).width), tot = ws.reduce((a, b) => a + b, 0) + sp * (ch.length - 1);
  let cx = x - tot / 2; const al = ctx.textAlign; ctx.textAlign = 'left';
  ch.forEach((c, i) => { if (fill) ctx.fillText(c, cx, y); if (stroke) ctx.strokeText(c, cx, y); cx += ws[i] + sp; });
  ctx.textAlign = al;
}
// Rank movement: ▲n / ▼n / – / NEW (triangles are drawn, so they never depend on a font).
function mvMark(ctx, v, cx, cy, px) {
  if (v == null) return;
  ctx.save(); ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  if (v === 'new') { setFont(ctx, 700, Math.round(px * 0.78), FONT.en); ctx.fillStyle = NEWC; ctx.fillText('NEW', cx, cy + 1); }
  else if (v === 0) { ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(cx - px * 0.34, cy - px * 0.06, px * 0.68, Math.max(2, px * 0.12)); }
  else {
    const up = v > 0, n = String(Math.abs(v)); setFont(ctx, 700, px, FONT.en);
    const tw = ctx.measureText(n).width, s = px * 0.62, gp = px * 0.16, x0 = cx - (s + gp + tw) / 2;
    ctx.fillStyle = up ? UP : DOWN; ctx.beginPath();
    if (up) { ctx.moveTo(x0, cy + s * 0.42); ctx.lineTo(x0 + s, cy + s * 0.42); ctx.lineTo(x0 + s / 2, cy - s * 0.5); }
    else { ctx.moveTo(x0, cy - s * 0.42); ctx.lineTo(x0 + s, cy - s * 0.42); ctx.lineTo(x0 + s / 2, cy + s * 0.5); }
    ctx.closePath(); ctx.fill();
    ctx.textAlign = 'left'; ctx.fillText(n, x0 + s + gp, cy + px * 0.06);
  }
  ctx.restore();
}

// ---------- backdrops (drawn once, reused every frame) ----------
const bgCache = new Map();
function cachedCanvas(key, make) {
  let c = bgCache.get(key); if (c) return c;
  c = document.createElement('canvas'); c.width = W; c.height = H; make(c.getContext('2d'));
  bgCache.set(key, c); if (bgCache.size > 6) bgCache.delete(bgCache.keys().next().value);
  return c;
}
function pageBg(X, A) {
  return cachedCanvas(['p', X.theme, X.wkLine, X.foot, A.brand ? 1 : 0].join('|'), ctx => {
    scene(ctx, X.P, false); frame(ctx); emblem(ctx, A, X.P, LEAGUE_EN);
    ctx.textAlign = 'center'; ctx.fillStyle = X.P.light; setFont(ctx, 600, 25, FONT.en); spaced(ctx, X.wkLine, W / 2, 452, 5);
    if (X.foot) { ctx.fillStyle = FAINT; fitFont(ctx, X.foot, 900, 500, 24, FONT.ko, 16); ctx.fillText(X.foot, W / 2, 1664); }
  });
}
function coverBg(X, A) {
  return cachedCanvas(['c', X.theme, A.brand ? 1 : 0].join('|'), ctx => {
    const P = X.P;
    scene(ctx, P, false);
    // stadium-light beams from the top, then a vignette that pulls the eye to the middle
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    [[-0.34, 0.15], [0, 0.11], [0.34, 0.15]].forEach(([k, a]) => {
      const g = ctx.createLinearGradient(0, 0, 0, 1500); g.addColorStop(0, `rgba(${P.silk[2]},${a})`); g.addColorStop(1, `rgba(${P.silk[2]},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(W / 2 + k * 300 - 40, -20); ctx.lineTo(W / 2 + k * 300 + 40, -20); ctx.lineTo(W / 2 + k * 1500 + 260, 1500); ctx.lineTo(W / 2 + k * 1500 - 260, 1500); ctx.closePath(); ctx.fill();
    });
    ctx.restore();
    // a soft dark plate behind the lockup, so the light trails never cut through the type
    ctx.save(); ctx.translate(W / 2, 930); ctx.scale(1, 0.6);
    const pl = ctx.createRadialGradient(0, 0, 80, 0, 0, 660);
    pl.addColorStop(0, 'rgba(0,0,0,0.58)'); pl.addColorStop(0.55, 'rgba(0,0,0,0.4)'); pl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = pl; ctx.fillRect(-W, -1200, 2 * W, 2400); ctx.restore();
    const v = ctx.createRadialGradient(W / 2, 1000, 280, W / 2, 1000, 1150); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(0, CY.emb - 318); emblem(ctx, A, P, ''); ctx.restore(); // the poster emblem sits at y 318; the cover lockup is centred lower
  });
}

// ---------- cover ----------
const CY = { emb: 470, year: 610, sf: 688, ch: 862, lg: 1024, rule: 1076, wk: 1230, date: 1338, ko: 1392, foot: 1664 };
const coverPx = ctx => fitFont(ctx, 'CHAMPIONS', 940, 'italic 900', 172, FONT.title, 80);
function bigWord(ctx, P, text, y, px, T, t0, dir) {
  const p = clamp((T - t0) / 0.9); if (p <= 0) return;
  const e = EF(p);
  ctx.save(); ctx.globalAlpha *= clamp(p / 0.35);
  ctx.translate((1 - e) * 560 * dir, 0);
  if (p < 1) { ctx.translate(W / 2, y); ctx.transform(1, 0, Math.tan((1 - e) * 0.3 * -dir), 1, 0, 0); ctx.translate(-W / 2, -y); }
  setFont(ctx, 'italic 900', px, FONT.title); ctx.textAlign = 'center';
  const g = ctx.createLinearGradient(0, y - px * 0.74, 0, y + px * 0.04);
  g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.5, P.light); g.addColorStop(1, P.titleTop);
  ctx.shadowColor = `rgba(${P.glow[0]},0.8)`; ctx.shadowBlur = 36;
  ctx.fillStyle = g; ctx.fillText(text, W / 2, y);
  ctx.shadowBlur = 0; ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.strokeText(text, W / 2, y);
  ctx.restore();
}
// A bright band crossing CHAMPIONS LEAGUE, masked by the letters (drawn off-screen, then added).
let sheenC = null;
function sheen(ctx, px, p) {
  if (!sheenC) { sheenC = document.createElement('canvas'); sheenC.width = W; sheenC.height = 420; }
  const g = sheenC.getContext('2d');
  g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, W, 420);
  setFont(g, 'italic 900', px, FONT.title); g.textAlign = 'center'; g.fillStyle = '#fff';
  g.fillText('CHAMPIONS', W / 2, 200); g.fillText('LEAGUE', W / 2, 200 + CY.lg - CY.ch);
  g.globalCompositeOperation = 'source-in';
  const x = -300 + (W + 600) * eOut(p);
  const lg = g.createLinearGradient(x - 170, 0, x + 170, 420);
  lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.95)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = lg; g.fillRect(0, 0, W, 420);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.8; ctx.drawImage(sheenC, 0, CY.ch - 200); ctx.restore();
}
function drawCover(ctx, X, s, τ, A, still) {
  const P = X.P, T = still ? 60 : τ;
  const ex = still ? 0 : clamp((τ - (s.sec - 0.45)) / 0.45);
  ctx.save(); ctx.globalAlpha *= 1 - ex;
  // slow push-in, like a broadcast opener
  const z = still ? 1 : 1.045 - 0.045 * eOut(clamp(T / Math.max(1, s.sec - 0.4)));
  ctx.translate(W / 2, 1000); ctx.scale(z, z); ctx.translate(-W / 2, -1000);
  ctx.textAlign = 'center';
  const a1 = eOut(clamp((T - 0.1) / 0.9));
  fade(ctx, a1, () => {
    ctx.fillStyle = P.light; setFont(ctx, 600, 28, FONT.en); spaced(ctx, X.year, W / 2, CY.year, 16 + (1 - a1) * 24);
    ctx.fillStyle = WHITE; setFont(ctx, 600, 54, FONT.en); spaced(ctx, 'SEONGDEOK FUTSAL', W / 2, CY.sf, 12 + (1 - a1) * 34);
  });
  const px = coverPx(ctx);
  bigWord(ctx, P, 'CHAMPIONS', CY.ch, px, T, 0.35, -1);
  bigWord(ctx, P, 'LEAGUE', CY.lg, px, T, 0.5, 1);
  if (!still) { const p = (T - 2.05) / 0.9; if (p > 0 && p < 1) sheen(ctx, px, p); }
  // light rule with a small diamond
  const a3 = eOut(clamp((T - 0.9) / 0.6));
  if (a3 > 0) {
    ctx.save(); ctx.globalAlpha *= a3; ctx.shadowColor = `rgba(${P.line},0.9)`; ctx.shadowBlur = 14;
    const half = 380 * a3, g = ctx.createLinearGradient(W / 2 - half, 0, W / 2 + half, 0);
    g.addColorStop(0, `rgba(${P.line},0)`); g.addColorStop(0.5, `rgba(${P.line},1)`); g.addColorStop(1, `rgba(${P.line},0)`);
    ctx.fillStyle = g; ctx.fillRect(W / 2 - half, CY.rule - 1.5, half * 2, 3);
    ctx.fillStyle = WHITE; ctx.beginPath(); ctx.moveTo(W / 2, CY.rule - 9); ctx.lineTo(W / 2 + 9, CY.rule); ctx.lineTo(W / 2, CY.rule + 9); ctx.lineTo(W / 2 - 9, CY.rule); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  weekBlock(ctx, X, T, still);
  const a5 = eOut(clamp((T - 1.75) / 0.6));
  fade(ctx, a5, () => {
    ctx.textAlign = 'center';
    ctx.fillStyle = P.light; setFont(ctx, 600, 34, FONT.en); spaced(ctx, X.rangeEn, W / 2, CY.date + (1 - a5) * 16, 6);
    ctx.fillStyle = DIM; setFont(ctx, 600, 28, FONT.ko); ctx.fillText(`${LEAGUE_KR} · ${X.num || X.wk.n}주차 리캡`, W / 2, CY.ko + (1 - a5) * 16);
    if (X.foot) { ctx.fillStyle = FAINT; fitFont(ctx, X.foot, 900, 500, 24, FONT.ko, 16); ctx.fillText(X.foot, W / 2, CY.foot); }
  });
  ctx.restore();
}
// "WEEK 1" on one line in the same chrome as CHAMPIONS LEAGUE, slammed in with a flash once the league name has landed.
function weekBlock(ctx, X, T, still) { slamBlock(ctx, X, X.label, T, still); }
function slamBlock(ctx, X, text, T, still) {
  const P = X.P, sp = 8;
  const p = still ? 1 : clamp((T - 1.1) / 0.62);
  if (p <= 0) return;
  const px = fitFont(ctx, text, 820 - sp * Math.max(0, [...text].length - 1), 'italic 900', 138, FONT.title, 56);
  const cy = CY.wk - px * 0.36, sc = 1 + 1.1 * (1 - eBack(p));
  ctx.save(); ctx.globalAlpha *= clamp(p / 0.22);
  ctx.translate(W / 2, cy); ctx.scale(sc, sc); ctx.translate(-W / 2, -cy);
  const g = ctx.createLinearGradient(0, CY.wk - px * 0.74, 0, CY.wk + px * 0.04);
  g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.5, P.light); g.addColorStop(1, P.titleTop);
  ctx.textAlign = 'center'; ctx.shadowColor = `rgba(${P.glow[0]},0.85)`; ctx.shadowBlur = 40; ctx.fillStyle = g;
  track(ctx, text, W / 2, CY.wk, sp, true, false);
  ctx.shadowBlur = 0; ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  track(ctx, text, W / 2, CY.wk, sp, false, true);
  ctx.restore();
  if (!still) {
    const q = clamp((T - 1.4) / 0.9);
    if (q > 0 && q < 1) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      glow(ctx, W / 2, cy, 220 + 320 * q, P.glow[2], 0.45 * (1 - q));
      ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - q)})`; ctx.lineWidth = 5 * (1 - q) + 1;
      ctx.beginPath(); ctx.ellipse(W / 2, cy, 200 + 520 * eOut(q), 70 + 180 * eOut(q), 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
}

// 토너먼트 진출팀 영상의 표지: 리그 로고 그대로, WEEK 자리에 KNOCKOUT STAGE, 아래에 진출팀 로고가 하나씩 켜진다.
function drawAdvCover(ctx, X, s, τ, A, still) {
  const P = X.P, T = still ? 60 : τ, qs = advQuals(X.cum);
  const ex = still ? 0 : clamp((τ - (s.sec - 0.45)) / 0.45);
  ctx.save(); ctx.globalAlpha *= 1 - ex;
  const z = still ? 1 : 1.045 - 0.045 * eOut(clamp(T / Math.max(1, s.sec - 0.4)));
  ctx.translate(W / 2, 1000); ctx.scale(z, z); ctx.translate(-W / 2, -1000);
  ctx.textAlign = 'center';
  const a1 = eOut(clamp((T - 0.1) / 0.9));
  fade(ctx, a1, () => {
    ctx.fillStyle = P.light; setFont(ctx, 600, 28, FONT.en); spaced(ctx, X.year, W / 2, CY.year, 16 + (1 - a1) * 24);
    ctx.fillStyle = WHITE; setFont(ctx, 600, 54, FONT.en); spaced(ctx, 'SEONGDEOK FUTSAL', W / 2, CY.sf, 12 + (1 - a1) * 34);
  });
  const px = coverPx(ctx);
  bigWord(ctx, P, 'CHAMPIONS', CY.ch, px, T, 0.35, -1);
  bigWord(ctx, P, 'LEAGUE', CY.lg, px, T, 0.5, 1);
  if (!still) { const p = (T - 2.05) / 0.9; if (p > 0 && p < 1) sheen(ctx, px, p); }
  const a3 = eOut(clamp((T - 0.9) / 0.6));
  if (a3 > 0) {
    ctx.save(); ctx.globalAlpha *= a3; ctx.shadowColor = `rgba(${P.line},0.9)`; ctx.shadowBlur = 14;
    const half = 380 * a3, g = ctx.createLinearGradient(W / 2 - half, 0, W / 2 + half, 0);
    g.addColorStop(0, `rgba(${P.line},0)`); g.addColorStop(0.5, `rgba(${P.line},1)`); g.addColorStop(1, `rgba(${P.line},0)`);
    ctx.fillStyle = g; ctx.fillRect(W / 2 - half, CY.rule - 1.5, half * 2, 3);
    ctx.fillStyle = WHITE; ctx.beginPath(); ctx.moveTo(W / 2, CY.rule - 9); ctx.lineTo(W / 2 + 9, CY.rule); ctx.lineTo(W / 2, CY.rule + 9); ctx.lineTo(W / 2 - 9, CY.rule); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  slamBlock(ctx, X, 'KNOCKOUT STAGE', T, still);
  const a5 = eOut(clamp((T - 1.75) / 0.6));
  fade(ctx, a5, () => {
    ctx.textAlign = 'center';
    ctx.fillStyle = P.light; setFont(ctx, 600, 34, FONT.en); spaced(ctx, `QUALIFIED  ·  MEN ${qs.M.length}  ·  WOMEN ${qs.W.length}`, W / 2, CY.date + (1 - a5) * 16, 6);
    ctx.fillStyle = DIM; setFont(ctx, 600, 28, FONT.ko); ctx.fillText(`${LEAGUE_KR} · 토너먼트 진출팀 발표`, W / 2, CY.ko + (1 - a5) * 16);
    if (X.foot) { ctx.fillStyle = FAINT; fitFont(ctx, X.foot, 900, 500, 24, FONT.ko, 16); ctx.fillText(X.foot, W / 2, CY.foot); }
  });
  // 진출팀 로고: 남학생(금색 고리) 한 줄, 여학생(파란 고리) 한 줄
  const rows = [['M', qs.M, 1482, '242,183,5'], ['W', qs.W, 1566, '157,176,255']];
  let n = 0;
  rows.forEach(([div, list, y, rgb]) => {
    const cs = 50, gap = list.length > 12 ? 9 : 14, total = list.length * cs + (list.length - 1) * gap;
    list.forEach((q, i) => {
      const cx = W / 2 - total / 2 + cs / 2 + i * (cs + gap), t0 = 2.1 + (n++) * 0.045;
      const p = still ? 1 : clamp((T - t0) / 0.45);
      if (p <= 0) return;
      const sc = 0.4 + 0.6 * eBack(p);
      ctx.save(); ctx.globalAlpha *= clamp(p / 0.3);
      ctx.translate(cx, y); ctx.scale(sc, sc); ctx.translate(-cx, -y);
      ctx.beginPath(); ctx.arc(cx, y, cs / 2 + 5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(8,8,14,0.6)'; ctx.fill();
      ctx.shadowColor = `rgba(${rgb},0.9)`; ctx.shadowBlur = 12; ctx.strokeStyle = `rgba(${rgb},0.95)`; ctx.lineWidth = 2.5; ctx.stroke(); ctx.shadowBlur = 0;
      crest(ctx, A.img[q.cls], q.cls, cx, y, cs - 6);
      ctx.restore();
    });
  });
  ctx.restore();
}

// ---------- page header ----------
function head(ctx, X, s, τ, still, ex) {
  const P = X.P;
  const a = still || !s.first ? 1 : eOut(clamp(τ / 0.6));
  fade(ctx, a * (1 - (s.last ? ex : 0)), () => {
    const sc = 1 + (1 - a) * 0.08;
    ctx.translate(W / 2, TITLE_Y - 40); ctx.scale(sc, sc); ctx.translate(-W / 2, -(TITLE_Y - 40));
    headline(ctx, P, s.title, TITLE_Y, s.tpx || 112, 920);
  });
  const b = still ? 1 : eOut(clamp((τ - (s.first ? 0.25 : 0.05)) / 0.4));
  fade(ctx, b * (1 - ex), () => {
    ctx.textAlign = 'center'; ctx.fillStyle = s.subColor || P.light; fitFont(ctx, s.sub, 920, 600, 30, FONT.ko, 20); ctx.fillText(s.sub, W / 2, SUB_Y);
  });
}

// ---------- results ----------
function drawResults(ctx, X, list, τ, A, still) {
  const n = Math.max(1, list.length), gap = 18;
  const h = Math.min(222, Math.floor((CB - CT - gap * (n - 1)) / n));
  const y0 = CT + Math.floor((CB - CT - (h * n + gap * (n - 1))) / 2);
  list.forEach((m, i) => {
    const y = y0 + i * (h + gap);
    inFly(ctx, still ? DONE : fly(τ, i, 0.28, 0.16), X0, y, XW, h, () => matchCard(ctx, A, m, X0, y, XW, h));
    if (!still) glint(ctx, τ, 1.2 + i * 0.16, X0, y, XW, h, 24);
  });
}
function matchCard(ctx, A, m, x, y, w, h) {
  card(ctx, x, y, w, h, 24, null);
  ctx.textAlign = 'center'; ctx.fillStyle = m.div === 'W' ? WOMEN : MEN; setFont(ctx, 600, 24, FONT.ko);
  ctx.fillText(`${dayKo(m.date)}  ·  ${SD.DIV_LEAGUE[m.div]} ${stageText(m)}`, W / 2, y + 42);
  const cy = y + 42 + (h - 42) / 2, cs = Math.min(116, h - 84), win = SD.winnerOf(m);
  crest(ctx, A.img[m.home], m.home, x + 88, cy, cs); crest(ctx, A.img[m.away], m.away, x + w - 88, cy, cs);
  ctx.textBaseline = 'middle';
  const nm = (c, xx, al, dim) => { ctx.textAlign = al; ctx.fillStyle = dim ? 'rgba(255,255,255,0.5)' : WHITE; fitFont(ctx, SD.classLabel(c), 186, 700, 36, FONT.ko, 22); ctx.fillText(SD.classLabel(c), xx, cy + 2); };
  nm(m.home, x + 160, 'left', win && win !== m.home); nm(m.away, x + w - 160, 'right', win && win !== m.away);
  setFont(ctx, 700, 84, FONT.en);
  ctx.textAlign = 'right'; ctx.fillStyle = win && win !== m.home ? 'rgba(255,255,255,0.5)' : WHITE; ctx.fillText(String(m.scoreH | 0), W / 2 - 24, cy + 6);
  ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText(':', W / 2, cy + 2);
  ctx.textAlign = 'left'; ctx.fillStyle = win && win !== m.away ? 'rgba(255,255,255,0.5)' : WHITE; ctx.fillText(String(m.scoreA | 0), W / 2 + 24, cy + 6);
  const pk = SD.pkScore(m);
  if (pk) { setFont(ctx, 600, 22, FONT.ko); ctx.fillStyle = DIM; ctx.textAlign = 'center'; ctx.fillText(`승부차기 ${pk[0]} : ${pk[1]}`, W / 2, cy + 60); }
  ctx.textBaseline = 'alphabetic';
}

// ---------- match of the week ----------
function drawMotw(ctx, X, m, τ, A, still) {
  const P = X.P, f = matchFacts(m), T = still ? 60 : τ, cy = 806, win = f.w;
  const e1 = still ? 1 : EF(clamp((T - 0.15) / 0.75));
  fade(ctx, clamp(e1 * 1.5), () => {
    crest(ctx, A.img[m.home], m.home, 392 - (1 - e1) * 300, cy, 200);
    crest(ctx, A.img[m.away], m.away, 688 + (1 - e1) * 300, cy, 200);
  });
  // the score counts up to the final result
  const e2 = still ? 1 : clamp((T - 0.6) / 0.8);
  const hs = Math.round((m.scoreH | 0) * eOut(e2)), as = Math.round((m.scoreA | 0) * eOut(e2));
  fade(ctx, still ? 1 : clamp((T - 0.5) / 0.3), () => {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; setFont(ctx, 800, 176, FONT.title);
    ctx.fillStyle = e2 >= 1 && win && win !== m.home ? 'rgba(255,255,255,0.4)' : WHITE; ctx.fillText(String(hs), 166, cy + 12);
    ctx.fillStyle = e2 >= 1 && win && win !== m.away ? 'rgba(255,255,255,0.4)' : WHITE; ctx.fillText(String(as), 914, cy + 12);
    ctx.textBaseline = 'alphabetic';
  });
  fade(ctx, still ? 1 : eOut(clamp((T - 0.5) / 0.5)), () => {
    [[m.home, 392], [m.away, 688]].forEach(([c, x]) => { ctx.textAlign = 'center'; ctx.fillStyle = WHITE; fitFont(ctx, SD.classLabel(c), 250, 700, 38, FONT.ko, 24); ctx.fillText(SD.classLabel(c), x, 966); });
    ctx.fillStyle = DIM; setFont(ctx, 600, 30, FONT.en); ctx.fillText('VS', W / 2, 964);
  });
  let y = 1004;
  const items = [];
  if (f.timed) items.push(['전반', `${f.half['1H'][0]} : ${f.half['1H'][1]}`], ['후반', `${f.half['2H'][0]} : ${f.half['2H'][1]}`]);
  if (f.pk) items.push(['승부차기', `${f.pk[0]} : ${f.pk[1]}`]);
  if (items.length) { fade(ctx, still ? 1 : eOut(clamp((T - 1.0) / 0.4)), () => pills(ctx, P, items, y + 46)); y += 100; }
  // goal by goal, each side under its own crest
  const potmTop = 1474, end = f.potm ? potmTop - 20 : CB;
  const n = Math.max(f.home.length, f.away.length);
  y += 24;
  if (n) {
    const withAst = (end - y) / n >= 80 && f.home.concat(f.away).some(g => g.ast);
    const step = withAst ? 80 : Math.min(60, Math.floor((end - y) / n));
    const max = Math.min(n, Math.max(1, Math.floor((end - y) / step)));
    const col = (list, x, side) => list.slice(0, max).forEach((g, i) => {
      const yy = y + i * step + 30, a = still ? 1 : eOut(clamp((T - 1.15 - i * 0.14 - side * 0.07) / 0.45));
      fade(ctx, a, () => {
        ctx.translate(0, (1 - a) * 18);
        if (i === max - 1 && list.length > max) { ctx.textAlign = 'center'; setFont(ctx, 500, 26, FONT.ko); ctx.fillStyle = DIM; ctx.fillText(`외 ${list.length - max + 1}골`, x, yy); return; }
        setFont(ctx, 700, 34, FONT.ko); const nw = ctx.measureText(g.name).width;
        setFont(ctx, 600, 27, FONT.ko); const tw = g.time ? ctx.measureText(g.time).width + 14 : 0;
        const x0 = x - (nw + tw) / 2;
        ctx.textAlign = 'left'; setFont(ctx, 700, 34, FONT.ko); ctx.fillStyle = WHITE; ctx.fillText(g.name, x0, yy);
        if (g.time) { setFont(ctx, 600, 27, FONT.ko); ctx.fillStyle = P.light; ctx.fillText(g.time, x0 + nw + 14, yy); }
        if (withAst && g.ast) { ctx.textAlign = 'center'; setFont(ctx, 500, 23, FONT.ko); ctx.fillStyle = FAINT; ctx.fillText(`어시스트 ${g.ast}`, x, yy + 33); }
      });
    });
    fade(ctx, still ? 1 : eOut(clamp((T - 1.1) / 0.5)), () => {
      const vg = ctx.createLinearGradient(0, y - 6, 0, y + step * max);
      vg.addColorStop(0, 'rgba(255,255,255,0)'); vg.addColorStop(0.5, 'rgba(255,255,255,0.28)'); vg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = vg; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(W / 2, y - 6); ctx.lineTo(W / 2, y + step * max - 12); ctx.stroke();
    });
    col(f.home, 300, 0); col(f.away, 780, 1);
  } else {
    fade(ctx, still ? 1 : eOut(clamp((T - 1.1) / 0.5)), () => { ctx.textAlign = 'center'; ctx.fillStyle = DIM; setFont(ctx, 500, 30, FONT.ko); ctx.fillText('득점 기록이 아직 없습니다', W / 2, y + 44); });
  }
  if (f.potm) {
    const a = still ? 1 : eOut(clamp((T - 1.9) / 0.5));
    fade(ctx, a, () => {
      const sc = 0.92 + 0.08 * a; ctx.translate(W / 2, potmTop + 62); ctx.scale(sc, sc); ctx.translate(-W / 2, -(potmTop + 62));
      const p = f.potm, stat = [p.g ? `${p.g}골` : '', p.a ? `${p.a}어시스트` : ''].filter(Boolean).join(' ');
      honour(ctx, P, potmTop, 'PLAYER OF THE MATCH', `${p.p.name}  ${stat}`, SD.classLabel(p.p.cls));
    });
  }
}

// ---------- player of the week ----------
function drawPotw(ctx, X, list, τ, A, still) {
  const n = list.length, gap = 28;
  const h = Math.min(430, Math.floor((CB - CT - gap * (n - 1)) / n));
  let y = CT + Math.floor((CB - CT - (h * n + gap * (n - 1))) / 2);
  list.forEach((r, i) => {
    const yy = y;
    inFly(ctx, still ? DONE : fly(τ, 0, 0.3 + i * 0.55, 0, 0.95), X0, yy, XW, h, () => potwCard(ctx, X, A, r, X0, yy, XW, h));
    if (!still) glint(ctx, τ, 1.35 + i * 0.55, X0, yy, XW, h, 28);
    y += h + gap;
  });
}
function potwCard(ctx, X, A, r, x, y, w, h) {
  card(ctx, x, y, w, h, 28, RGB[r.div]);
  ctx.textAlign = 'left'; ctx.fillStyle = r.div === 'W' ? WOMEN : MEN; setFont(ctx, 700, 28, FONT.ko);
  ctx.fillText(SD.DIV_LEAGUE[r.div], x + 40, y + 60);
  const cs = Math.min(230, h * 0.54), ccy = y + h * 0.58;
  crest(ctx, A.img[r.p.cls], r.p.cls, x + 44 + cs / 2, ccy, cs);
  const tx = x + 44 + cs + 44, mw = x + w - 36 - tx;
  ctx.fillStyle = WHITE; fitFont(ctx, r.p.name, mw, 700, 92, FONT.ko, 40); ctx.fillText(r.p.name, tx, ccy - 24);
  ctx.fillStyle = DIM; setFont(ctx, 600, 30, FONT.ko);
  ctx.fillText(clip(ctx, `${SD.classLabel(r.p.cls)} · 이번 주 ${r.games}경기`, mw), tx, ccy + 28);
  // stat chips: 3 골 · 2 어시스트 · 13 점
  let cx = tx; const cyy = ccy + 96;
  [[r.g, '골'], [r.a, '어시스트'], [r.v, '점']].forEach(([v, l]) => {
    setFont(ctx, 700, 40, FONT.en); const vw = ctx.measureText(String(v)).width;
    setFont(ctx, 600, 24, FONT.ko); const lw = ctx.measureText(l).width;
    const cw = 22 + vw + 10 + lw + 22; if (cx + cw > x + w - 30) return;
    rrect(ctx, cx, cyy - 30, cw, 60, 30); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill(); ctx.strokeStyle = `rgba(${RGB[r.div]},0.6)`; ctx.lineWidth = 2; ctx.stroke();
    ctx.textBaseline = 'middle'; ctx.fillStyle = WHITE; setFont(ctx, 700, 40, FONT.en); ctx.fillText(String(v), cx + 22, cyy + 3);
    ctx.fillStyle = DIM; setFont(ctx, 600, 24, FONT.ko); ctx.fillText(l, cx + 22 + vw + 10, cyy + 1); ctx.textBaseline = 'alphabetic';
    cx += cw + 14;
  });
}

// ---------- group tables ----------
function standLayout(w, rh, mv) {
  const wide = w > 600, fpx = Math.round(Math.min(wide ? 38 : 34, Math.max(18, rh * 0.46)));
  const cs = Math.round(Math.min(wide ? 64 : mv ? 44 : 52, rh * 0.66));
  // with ▲▼ the narrow card gets a marker column, so the crest shrinks and the stats close up
  const rk = mv && !wide ? 24 : 28, mvx = mv ? (wide ? 74 : 60) : 0, cr = (mv ? (wide ? 124 : 98) : 72) + (wide ? 8 : 0), tx = cr + cs / 2 + 10;
  // fair play comes before goal difference in the league's tiebreak, so the table shows FP
  const cols = wide
    ? [['p', '경기', w - 470], ['w', '승', w - 390], ['d', '무', w - 320], ['l', '패', w - 250], ['fp', 'FP', w - 160], ['pts', '승점', w - 56]]
    : mv ? [['w', '승', w - 200], ['d', '무', w - 166], ['l', '패', w - 132], ['fp', 'FP', w - 86], ['pts', '승점', w - 32]]
      : [['w', '승', w - 214], ['d', '무', w - 176], ['l', '패', w - 138], ['fp', 'FP', w - 90], ['pts', '승점', w - 34]];
  return { wide, fpx, cs, rk, mv: mvx, cr, tx, cols, nameMax: cols[0][2] - 22 - tx };
}
function drawStand(ctx, X, div, ks, τ, A, still) {
  const gs = X.D.standings[div], adv = PAGES.advOf(X.D, div), prev = X.mv && X.mv.stand && X.mv.stand[div];
  const n = ks.length, cols = n === 1 ? 1 : 2, split = Math.ceil(n / cols);
  // same-size groups read A B / C D; uneven ones (women's 4- and 5-team groups) fill down each column to stay balanced
  const even = ks.every(k => gs[k].rows.length === gs[ks[0]].rows.length);
  const colKs = cols === 1 ? [ks] : even ? [ks.filter((_, i) => i % 2 === 0), ks.filter((_, i) => i % 2 === 1)] : [ks.slice(0, split), ks.slice(split)];
  const gx = 20, gy = 16, hh = 52, cw = cols === 1 ? XW : (XW - gx) / 2;
  const rowsIn = c => c.reduce((s, k) => s + gs[k].rows.length, 0);
  const rh = Math.floor(Math.min(cols === 1 ? 96 : 100, ...colKs.map(c => (CB - CT - c.length * hh - gy * (c.length - 1)) / Math.max(1, rowsIn(c)))));
  const colH = colKs.map(c => c.length * hh + gy * (c.length - 1) + rh * rowsIn(c));
  const top = CT + Math.max(0, Math.floor((CB - CT - Math.max(...colH)) / 2));
  const lay = standLayout(cw, rh, !!X.mv);
  colKs.forEach((c, ci) => {
    let y = top; const x = X0 + ci * (cw + gx);
    c.forEach(k => { groupCard(ctx, X, A, div, k, gs[k], x, y, cw, hh, rh, lay, adv, prev && prev[k], τ, ks.indexOf(k), still); y += hh + rh * gs[k].rows.length + gy; });
  });
}
function groupCard(ctx, X, A, div, k, g, x, y, w, hh, rh, lay, adv, prevMap, τ, gi, still) {
  const P = X.P, d = 0.2 + gi * 0.1, h = hh + rh * g.rows.length;
  const ca = still ? 1 : eOut(clamp((τ - d) / 0.45));
  // soft league colour: champagne for the men's groups, lavender-blue for the women's — a light wash, not a fill
  const rgb = div === 'W' ? '195,205,255' : '255,224,138', lead = div === 'W' ? '#C3CDFF' : '#FFE08A';
  fade(ctx, ca, () => {
    rrect(ctx, x, y, w, h, 18);
    ctx.fillStyle = 'rgba(8,8,14,0.55)'; ctx.fill();
    const g = ctx.createLinearGradient(x, y, x + w * 0.35, y + h);
    g.addColorStop(0, `rgba(${rgb},0.17)`); g.addColorStop(0.45, `rgba(${rgb},0.05)`); g.addColorStop(1, 'rgba(255,255,255,0.03)');
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); rrect(ctx, x, y, w, h, 18); ctx.clip(); ctx.fillStyle = `rgba(${rgb},0.1)`; ctx.fillRect(x, y, w, hh); ctx.restore();
    rrect(ctx, x, y, w, h, 18); ctx.strokeStyle = `rgba(${rgb},0.34)`; ctx.lineWidth = 2; ctx.stroke();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = lead; setFont(ctx, 800, 38, FONT.title); ctx.fillText(k, x + 18, y + hh / 2 + 2);
    const kw = ctx.measureText(k).width;
    ctx.fillStyle = `rgba(${rgb},0.85)`; setFont(ctx, 600, 22, FONT.ko); ctx.fillText(`${DIV_KO[div]} ${k}조`, x + 18 + kw + 10, y + hh / 2 + 3);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; setFont(ctx, 500, lay.wide ? 21 : 19, FONT.ko); ctx.textAlign = 'center';
    lay.cols.forEach(([, l, cx]) => ctx.fillText(l, x + cx, y + hh / 2 + 3));
    ctx.textBaseline = 'alphabetic';
  });
  const played = X.cfg.scope !== 'week' && g.rows.some(r => r.p > 0); // qualification colours only make sense for the running table
  g.rows.forEach((r, j) => {
    const ry = y + hh + j * rh;
    inFly(ctx, still ? DONE : fly(τ, j, d + 0.12, 0.08, 0.7), x, ry, w, rh, () => standRow(ctx, A, r, j, x, ry, w, rh, lay, played && r.rank <= adv, SD.moveOf(prevMap, r.cls, r.rank)));
  });
}
function standRow(ctx, A, r, j, x, y, w, rh, lay, isAdv, mv) {
  const cy = y + rh / 2;
  if (isAdv) { ctx.fillStyle = `rgba(${ADV},0.1)`; ctx.fillRect(x + 2, y, w - 4, rh); ctx.fillStyle = `rgb(${ADV})`; ctx.fillRect(x + 2, y + 5, 5, rh - 10); }
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x + 12, y, w - 24, 1.5);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillStyle = isAdv ? WHITE : 'rgba(255,255,255,0.6)'; setFont(ctx, 700, lay.fpx, FONT.title); ctx.fillText(String(r.rank), x + lay.rk, cy + 2);
  if (lay.mv) mvMark(ctx, mv, x + lay.mv, cy, Math.round(Math.max(16, lay.fpx * 0.6)));
  crest(ctx, A.img[r.cls], r.cls, x + lay.cr, cy, lay.cs);
  ctx.textAlign = 'left'; ctx.fillStyle = WHITE;
  const label = lay.wide ? SD.classLabel(r.cls) : r.cls;
  if (lay.wide) fitFont(ctx, label, lay.nameMax, 700, Math.round(lay.fpx * 0.95), FONT.ko, 18); else fitFont(ctx, label, lay.nameMax, 600, lay.fpx, FONT.en, 16);
  ctx.fillText(label, x + lay.tx, cy + 2);
  const val = { p: r.p, w: r.w, d: r.d, l: r.l, fp: r.fp, pts: r.pts };
  ctx.textAlign = 'center';
  lay.cols.forEach(([kk, , cx]) => {
    const big = kk === 'pts';
    setFont(ctx, big ? 800 : 600, big ? Math.round(lay.fpx * 1.12) : Math.round(lay.fpx * 0.92), big ? FONT.title : FONT.en);
    ctx.fillStyle = big ? WHITE : kk === 'fp' && r.fp < 0 ? '#FF8A94' : 'rgba(255,255,255,0.78)';
    ctx.fillText(String(val[kk]), x + cx, cy + 3);
  });
  ctx.textBaseline = 'alphabetic';
}

// ---------- TOP lists ----------
function drawRankPage(ctx, X, blocks, top, τ, A, still) {
  const nb = blocks.length, headH = nb > 1 ? 50 : 0, gapB = 22, gap = 9;
  const rows = blocks.reduce((s, b) => s + b.items.length, 0);
  const maxH = nb > 1 ? 96 : top <= 5 ? 160 : 104;
  const h = Math.floor(Math.min(maxH, (CB - CT - nb * headH - gapB * (nb - 1) - gap * (rows - nb)) / rows));
  const used = nb * headH + gapB * (nb - 1) + rows * h + gap * (rows - nb);
  let y = CT + Math.max(0, Math.floor((CB - CT - used) / 2));
  blocks.forEach((b, bi) => {
    const d0 = 0.3 + bi * 1.0; // the second league follows once the first has landed
    const hy = y;
    if (headH) fade(ctx, still ? 1 : eOut(clamp((τ - d0 + 0.2) / 0.4)), () => blockHead(ctx, X, b, top, X0, hy + headH - 14));
    y += headH;
    b.items.forEach((r, j) => {
      const yy = y;
      inFly(ctx, still ? DONE : fly(τ, j, d0, 0.13), X0, yy, XW, h, () => rankRow(ctx, X, A, r, X0, yy, XW, h));
      if (!still) glint(ctx, τ, d0 + 0.95 + j * 0.13, X0, yy, XW, h, Math.min(20, h * 0.24));
      y += h + gap;
    });
    y += gapB - gap;
  });
}
function blockHead(ctx, X, b, top, x, y) {
  const col = b.div === 'W' ? WOMEN : b.div === 'M' ? MEN : X.P.light;
  ctx.fillStyle = col; rrect(ctx, x + 4, y - 27, 10, 32, 3); ctx.fill();
  ctx.textAlign = 'left'; setFont(ctx, 700, 32, FONT.ko); ctx.fillStyle = WHITE;
  const lab = b.label || SD.DIV_LEAGUE[b.div]; ctx.fillText(lab, x + 28, y);
  const lw = ctx.measureText(lab).width;
  setFont(ctx, 700, 28, FONT.en); ctx.fillStyle = col; ctx.fillText(`TOP ${top}`, x + 28 + lw + 16, y);
}
function rankRow(ctx, X, A, r, x, y, w, h) {
  card(ctx, x, y, w, h, Math.min(20, h * 0.24), r.rank <= 3 ? TINT[r.rank] : null);
  const cy = y + h / 2;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillStyle = RANK_C[r.rank] || 'rgba(255,255,255,0.66)'; setFont(ctx, 800, Math.round(Math.min(60, h * 0.56)), FONT.title);
  ctx.fillText(String(r.rank), x + 48, cy + 2);
  let nx = x + 94;
  if (X.mv) { mvMark(ctx, r.mv, x + 124, cy, Math.round(Math.min(28, Math.max(20, h * 0.3)))); nx = x + 162; }
  const cs = Math.round(Math.min(h * 0.74, 104));
  crest(ctx, A.img[r.cls], r.cls, nx + cs / 2, cy, cs);
  const tx = nx + cs + 20;
  // value + unit on the right
  const upx = Math.round(Math.min(28, Math.max(20, h * 0.28))); setFont(ctx, 600, upx, FONT.ko); const uw = ctx.measureText(r.unit).width;
  const vpx = Math.round(Math.min(76, h * 0.64)); setFont(ctx, 800, vpx, FONT.title); const vw = ctx.measureText(String(r.val)).width;
  const vr = x + w - 28 - uw - 10;
  ctx.textAlign = 'right'; ctx.fillStyle = r.rank === 1 ? RANK_C[1] : WHITE; ctx.fillText(String(r.val), vr, cy + 4);
  setFont(ctx, 600, upx, FONT.ko); ctx.fillStyle = DIM; ctx.fillText(r.unit, x + w - 28, cy + vpx * 0.16);
  // name (+ class) and an optional detail line
  const maxW = vr - vw - 26 - tx, hasD = !!r.detail;
  const dLines = hasD ? (h >= 140 ? 2 : 1) : 0, dpx = Math.round(Math.min(26, Math.max(19, h * 0.2)));
  let npx = Math.round(Math.min(r.big ? 46 : 40, h * (hasD ? (dLines > 1 ? 0.3 : 0.36) : 0.42)));
  const tpx = Math.round(npx * 0.66);
  const nameY = hasD ? cy - (dLines > 1 ? h * 0.22 : h * 0.15) : cy + 1;
  ctx.textAlign = 'left';
  if (r.duo) {
    const [a, b] = r.duo, plus = ' + ';
    let s = npx; const total = () => { setFont(ctx, 700, s, FONT.ko); return ctx.measureText(a + plus + b).width; };
    while (s > 18 && total() > maxW) s -= 2;
    setFont(ctx, 700, s, FONT.ko); ctx.fillStyle = WHITE; ctx.fillText(a, tx, nameY);
    const aw = ctx.measureText(a).width; ctx.fillStyle = X.P.light; ctx.fillText(plus, tx + aw, nameY);
    const pw = ctx.measureText(plus).width; ctx.fillStyle = WHITE; ctx.fillText(b, tx + aw + pw, nameY);
    const bw = ctx.measureText(b).width;
    setFont(ctx, 500, Math.round(s * 0.66), FONT.ko); ctx.fillStyle = DIM;
    if (tx + aw + pw + bw + 12 + ctx.measureText(r.tag).width <= tx + maxW) ctx.fillText(r.tag, tx + aw + pw + bw + 12, nameY + 2);
  } else {
    setFont(ctx, 500, tpx, FONT.ko); const tw = r.tag ? ctx.measureText(r.tag).width + 12 : 0;
    let s = npx; setFont(ctx, 700, s, FONT.ko);
    while (s > 18 && ctx.measureText(r.name).width + tw > maxW) { s -= 2; setFont(ctx, 700, s, FONT.ko); }
    const nw = ctx.measureText(r.name).width;
    ctx.fillStyle = WHITE; ctx.fillText(clip(ctx, r.name, maxW), tx, nameY);
    if (r.tag && nw + tw <= maxW) { setFont(ctx, 500, Math.round(s * 0.66), FONT.ko); ctx.fillStyle = DIM; ctx.fillText(r.tag, tx + nw + 12, nameY + 2); }
  }
  if (hasD) {
    setFont(ctx, 500, dpx, FONT.ko); ctx.fillStyle = X.P.light;
    wrapBits(ctx, r.detail, maxW, dLines).forEach((ln, i) => ctx.fillText(ln, tx, nameY + npx * 0.62 + dpx * 0.7 + i * dpx * 1.3));
  }
  ctx.textBaseline = 'alphabetic';
}

// ---------- weeks, snapshots, pages ----------
const byWhen = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '99:99').localeCompare(b.time || '99:99') || SD.mKey(a).localeCompare(SD.mKey(b));
// Monday–Sunday weeks that had at least one finished match, numbered in order (WEEK 1, 2, …).
function weeksOf(L) {
  const by = {};
  L.matches.forEach(m => { if (m.status === 'final' && m.date && m.home && m.away) (by[SD.mondayOf(m.date)] ||= []).push(m); });
  return Object.keys(by).sort().map((mon, i) => {
    const ms = by[mon].sort(byWhen);
    return { n: i + 1, mon, end: SD.addDays(mon, 6), prevEnd: SD.addDays(mon, -1), first: ms[0].date, last: ms[ms.length - 1].date, matches: ms };
  });
}
const SCN = {
  cover: { label: '표지', sec: 4, hint: 'SEONGDEOK FUTSAL CHAMPIONS LEAGUE · WEEK' },
  results: { label: '이번 주 경기 결과', sec: 5, per: 4 },
  motw: { label: '이주의 경기', sec: 6 },
  potw: { label: '이주의 선수', sec: 5 },
  standM: { label: '남학생 조별 순위', sec: 6, per: 4 },
  standW: { label: '여학생 조별 순위', sec: 6, per: 0 },
  advCover: { label: '진출팀 표지', sec: 5 },
  adv: { label: '토너먼트 진출팀', sec: 7 },
  scorers: { label: '득점 TOP', sec: 5, top: 10 },
  assists: { label: '어시스트 TOP', sec: 5, top: 10 },
  chem: { label: '베스트 케미', sec: 5, top: 5 },
  mvp: { label: '발롱도르', sec: 5, top: 5 },
  best: { label: '베스트 학급 (학년별)', sec: 5, top: 5 },
};
// 토너먼트 진출팀 영상(진출팀 표지 + 남·여 진출팀)은 주간 리캡과 따로 만든다(리캡 종류 「토너먼트 진출팀」).
// 원본 SDSMP 전용 — 둘러보기 복사본에서는 없앤다.
const ADV_ORDER = ['advCover', 'adv'];
if (SD.VIEWER) ADV_ORDER.forEach(k => { delete SCN[k]; });
const ORDER = ['cover', 'results', 'motw', 'potw', 'standM', 'standW', 'scorers', 'assists', 'chem', 'mvp', 'best'];
const DEFAULT_RECAP = {
  scope: 'cum', move: true, order: ORDER, pick: {},
  scenes: Object.fromEntries(ORDER.map(k => { const d = SCN[k], o = { on: true, sec: d.sec }; if ('per' in d) o.per = d.per; if ('top' in d) o.top = d.top; return [k, o]; })),
};
function recapCfg(extra) {
  const c = SD.deepMerge(SD.deepMerge(DEFAULT_RECAP, (S.tv && S.tv.recap) || {}), extra || {});
  const seen = Array.isArray(c.order) ? c.order.filter(k => SCN[k]) : [];
  c.order = [...new Set([...seen, ...ORDER])];
  return c;
}
const msig = m => [m.id, m.scoreH, m.scoreA, m.pkH, m.pkA, m.pk, (m.goals || []).length, m.ps];
const topOf = sc => ([3, 5, 10].includes(Number(sc.top)) ? Number(sc.top) : 10);
// Auto pick: plenty of goals and a close score (a shoot-out or a draw adds drama, a rout takes some away).
function motwScore(m) {
  const h = m.scoreH | 0, a = m.scoreA | 0, mar = Math.abs(h - a);
  return (h + a) * 1.5 + (mar <= 1 ? 3 : mar === 2 ? 1 : 0) + (SD.pkScore(m) ? 3 : 0) + (mar === 0 ? 1 : 0) - Math.max(0, mar - 2);
}
function motwAuto(ms) {
  const mar = m => Math.abs((m.scoreH | 0) - (m.scoreA | 0));
  return ms.slice().sort((a, b) => motwScore(b) - motwScore(a) || mar(a) - mar(b) || byWhen(b, a))[0] || null;
}
// Week-only Ballon d'Or points (goal = mvpG, assist = mvpA); the top one per league unless a teacher picked someone.
function potwOf(X, div) {
  const list = X.only.mvp[div] || [];
  const pick = X.pick['potw' + div];
  let r = pick ? list.find(x => x.p.id === pick) : null;
  if (!r) r = list.filter(x => x.rank === 1).sort((a, b) => b.g - a.g || b.a - a.a)[0] || null;
  if (!r) return null;
  const games = X.wk.matches.filter(m => m.div === div && (m.home === r.p.cls || m.away === r.p.cls)).length;
  return { div, p: r.p, g: r.g, a: r.a, v: r.v, games };
}
function pagesOf(X, blocks, top, title, ko) {
  if (!blocks.length) return [];
  const groups = top <= 5 ? [blocks] : blocks.map(b => [b]);
  return groups.map(bs => ({ title, sub: `${bs.length > 1 ? '남학생 · 여학생 리그' : SD.DIV_LEAGUE[bs[0].div]} ${ko} TOP ${top} · ${X.asOf}`,
    name: `${ko} TOP ${top}${groups.length > 1 ? ` · ${DIV_KO[bs[0].div]}` : ''}`, sig: bs.map(b => b.items.map(r => [r.rank, r.mv, r.name, r.val, r.detail])),
    draw: (ctx, τ, A, still) => drawRankPage(ctx, X, bs, top, τ, A, still) }));
}
function rankPages(X, key, title, ko, val) {
  const top = topOf(X.sc), prev = X.mv && X.mv[key];
  const blocks = SD.DIVS.map(div => ({ div, items: (X.D[key][div] || []).slice(0, top).map(r => ({ rank: r.rank, mv: prev ? SD.moveOf(prev[div], r.p.id, r.rank) : null,
    cls: r.p.cls, name: r.p.name, tag: SD.classLabel(r.p.cls), ...val(r) })) })).filter(b => b.items.length);
  return pagesOf(X, blocks, top, title, ko);
}
const bestBits = r => [r.parts.cheer ? `응원 ${r.parts.cheer}` : '', r.parts.song ? `응원가 ${r.parts.song}` : '', r.parts.flag ? `응원깃발 ${r.parts.flag}` : '',
  r.parts.fight ? `경기 전 파이팅 ${r.parts.fight}` : '', r.parts.fair ? `페어플레이 ${r.parts.fair}` : '',
  r.parts.both ? `남·여 참가 ${r.parts.both}` : '', r.parts.teacher ? `담임쌤 참여 ${r.parts.teacher}` : ''].filter(Boolean).join(' · ');
const BUILD = {
  cover: X => [{ cover: true, name: '표지', sig: [X.label, X.rangeEn, X.foot] }],
  results: X => {
    const per = [3, 4, 5, 6].includes(Number(X.sc.per)) ? Number(X.sc.per) : 4;
    const ms = X.wk.matches, pages = chunk(ms, per);
    return pages.map((list, i) => ({ title: 'RESULTS', sub: `${X.rangeKo} · ${ms.length}경기 결과${pages.length > 1 ? `  (${i + 1}/${pages.length})` : ''}`,
      name: `경기 결과${pages.length > 1 ? ` ${i + 1}/${pages.length}` : ''}`, sig: list.map(msig), draw: (ctx, τ, A, still) => drawResults(ctx, X, list, τ, A, still) }));
  },
  motw: X => {
    const m = X.motw; if (!m) return [];
    return [{ title: 'MATCH OF THE WEEK', tpx: 104, sub: `${SD.DIV_LEAGUE[m.div]} · ${stageText(m)} · ${dayKo(m.date)}`, name: '이주의 경기', sig: msig(m),
      draw: (ctx, τ, A, still) => drawMotw(ctx, X, m, τ, A, still) }];
  },
  potw: X => {
    const list = SD.DIVS.map(d => potwOf(X, d)).filter(Boolean); if (!list.length) return [];
    return [{ title: 'PLAYER OF THE WEEK', tpx: 104, sub: `${X.rangeKo} · 골 ${X.L.R.mvpG}점 · 어시스트 ${X.L.R.mvpA}점`, name: '이주의 선수',
      sig: list.map(r => [r.p.id, r.g, r.a, r.v, r.games]), draw: (ctx, τ, A, still) => drawPotw(ctx, X, list, τ, A, still) }];
  },
  standM: X => standPages(X, 'M'),
  standW: X => standPages(X, 'W'),
  // 진출팀 영상: 리그 전체의 조별 경기가 모두 끝난 뒤에만 만든다. 진출팀은 누적(최종) 순위로 정한다.
  advCover: X => {
    if (!advDone(X)) return [];
    const qs = advQuals(X.cum);
    return [{ cover: true, advCover: true, name: '진출팀 표지', sig: ['adv', X.foot, qs.M.map(q => q.cls), qs.W.map(q => q.cls)] }];
  },
  adv: X => {
    const D = X.cum;
    if (!advDone(X)) return [];
    return SD.DIVS.map(div => {
      const gs = D.standings[div] || {}, ks = Object.keys(gs).sort();
      if (!ks.length) return null;
      const adv = PAGES.advOf(D, div), total = ks.reduce((n, k) => n + Math.min(adv, gs[k].rows.length), 0);
      return { title: 'KNOCKOUT STAGE', subColor: div === 'W' ? '#C3CDFF' : '#FFE08A', sub: `${SD.DIV_LEAGUE[div]} 토너먼트 진출 ${total}팀 · 조별리그 최종 순위`,
        name: `${DIV_KO[div]} 토너먼트 진출팀`, sig: ks.map(k => gs[k].rows.slice(0, adv).map(r => [r.cls, r.rank, r.pts, r.both, r.fp, r.gf, r.ga])),
        draw: (ctx, τ, A, still) => drawAdv(ctx, X, div, τ, A, still) };
    }).filter(Boolean);
  },
  scorers: X => rankPages(X, 'scorers', 'TOP SCORERS', '득점', r => ({ val: r.g, unit: '골' })),
  assists: X => rankPages(X, 'assists', 'TOP ASSISTS', '어시스트', r => ({ val: r.a, unit: '어시스트' })),
  mvp: X => rankPages(X, 'mvp', "BALLON D'OR", '발롱도르', r => ({ val: r.v, unit: '점', detail: [r.g ? `${r.g}골` : '', r.a ? `${r.a}어시스트` : ''].filter(Boolean).join(' · ') })),
  chem: X => {
    const top = topOf(X.sc), prev = X.mv && X.mv.chem;
    const blocks = SD.DIVS.map(div => ({ div, items: ((X.D.chem && X.D.chem[div]) || []).slice(0, top).map(c => ({ rank: c.rank, mv: prev ? SD.moveOf(prev[div], c.x + '|' + c.y, c.rank) : null,
      cls: c.px.cls, name: `${c.px.name} + ${c.py.name}`, duo: [c.px.name, c.py.name], tag: SD.classLabel(c.px.cls), val: c.n, unit: '골 합작' })) })).filter(b => b.items.length);
    return pagesOf(X, blocks, top, 'BEST CHEMISTRY', '베스트 케미');
  },
  best: X => {
    if (!window.BEST) return [];
    const cfgB = BEST.cfgOf(), top = topOf(X.sc);
    const { rows, grades } = BEST.bestScores(X.D, cfgB);
    const prev = X.mv && X.mv.L ? new Map(BEST.bestScores(X.mv.L, cfgB).rows.filter(r => r.total > 0).map(r => [r.cls, r.rank])) : null;
    return grades.filter(g => !cfgB.skip[g]).map(g => {
      const list = rows.filter(r => r.grade === g && r.total > 0).sort((a, b) => a.rank - b.rank || SD.clsSort(a.cls, b.cls)).slice(0, top);
      if (!list.length) return null;
      const items = list.map(r => ({ rank: r.rank, mv: prev ? SD.moveOf(prev, r.cls, r.rank) : null, cls: r.cls, name: SD.classLabel(r.cls), detail: bestBits(r), val: r.total, unit: '점', big: true }));
      return { title: 'BEST CLASS', sub: `${g}학년 베스트 학급 TOP ${top} · ${X.asOf}`, name: `베스트 학급 ${g}학년`, sig: items.map(r => [r.rank, r.mv, r.cls, r.val, r.detail]),
        draw: (ctx, τ, A, still) => drawRankPage(ctx, X, [{ label: `${g}학년`, items }], top, τ, A, still) };
    }).filter(Boolean);
  },
};
// ---------- knockout qualifiers ----------
function advDone(X) {
  const gms = X.L.matches.filter(m => m.stage === 'group');
  return !SD.VIEWER && gms.length > 0 && gms.every(m => m.status === 'final' && m.date && m.date <= X.wk.end);
}
// 남·여 진출팀 (조 순서대로 1위, 2위)
function advQuals(D) {
  const out = {};
  SD.DIVS.forEach(div => {
    const gs = D.standings[div] || {}, adv = PAGES.advOf(D, div);
    out[div] = Object.keys(gs).sort().flatMap(k => gs[k].rows.slice(0, adv).map(r => ({ cls: r.cls, group: k, rank: r.rank })));
  });
  return out;
}
const ADV_C = { M: ['255,224,138', '#FFE08A'], W: ['195,205,255', '#C3CDFF'] };
function drawAdv(ctx, X, div, τ, A, still) {
  const D = X.cum, gs = D.standings[div] || {}, ks = Object.keys(gs).sort(), adv = PAGES.advOf(D, div);
  const [rgb, lead] = ADV_C[div] || ADV_C.M;
  const n = Math.max(1, ks.length), gap = n > 6 ? 12 : 18, foot = 60;
  const h = Math.min(186, Math.floor((CB - CT - foot - gap * (n - 1)) / n));
  const y0 = CT + Math.floor((CB - CT - foot - (h * n + gap * (n - 1))) / 2);
  ks.forEach((k, i) => {
    const y = y0 + i * (h + gap);
    inFly(ctx, still ? DONE : fly(τ, i, 0.3, 0.09, 0.75), X0, y, XW, h, () => advCard(ctx, A, D, div, k, gs[k].rows, adv, X0, y, XW, h, rgb, lead));
    if (!still) glint(ctx, τ, 1.15 + i * 0.09, X0, y, XW, h, 20);
  });
  const laser = Object.values((D.sp && D.sp.laser) || {}).some(o => Object.values(o || {}).some(Boolean));
  const line = '순위 기준  ' + SD.tiebreakOf(D.R).filter(t => laser || !t.startsWith('레이저런')).map(t => t.replace(/ 반$/, '').replace(/ 점수$/, '')).join(' → ');
  fade(ctx, still ? 1 : eOut(clamp((τ - 1) / 0.5)), () => {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255,255,255,0.62)';
    fitFont(ctx, line, XW, 500, 25, FONT.ko, 16); ctx.fillText(line, W / 2, CB - foot / 2 + 8);
    ctx.textBaseline = 'alphabetic';
  });
}
function advCard(ctx, A, D, div, k, rows, adv, x, y, w, h, rgb, lead) {
  const big = h > 140;
  rrect(ctx, x, y, w, h, 20); ctx.fillStyle = 'rgba(8,8,14,0.58)'; ctx.fill();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, `rgba(${rgb},0.2)`); g.addColorStop(0.5, `rgba(${rgb},0.05)`); g.addColorStop(1, 'rgba(255,255,255,0.03)');
  ctx.fillStyle = g; ctx.fill();
  rrect(ctx, x, y, w, h, 20); ctx.strokeStyle = `rgba(${rgb},0.38)`; ctx.lineWidth = 2; ctx.stroke();
  const gw = big ? 140 : 100;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = lead; setFont(ctx, 800, Math.round(h * (big ? 0.46 : 0.52)), FONT.title); ctx.fillText(k, x + gw / 2, y + h / 2 - (big ? 14 : 9));
  ctx.fillStyle = `rgba(${rgb},0.85)`; setFont(ctx, 600, big ? 24 : 18, FONT.ko); ctx.fillText(`${k}조`, x + gw / 2, y + h - (big ? 28 : 17));
  ctx.fillStyle = `rgba(${rgb},0.28)`; ctx.fillRect(x + gw, y + 16, 2, h - 32);
  const qs = rows.slice(0, adv), cw = (w - gw) / Math.max(1, qs.length);
  qs.forEach((r, j) => {
    const bx = x + gw + j * cw, cy = y + h / 2;
    if (j) { ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(bx, y + 18, 1.5, h - 36); }
    const cs = Math.round(Math.min(h * (big ? 0.6 : 0.62), 104)), cx = bx + (big ? 34 : 26) + cs / 2;
    crest(ctx, A.img[r.cls], r.cls, cx, cy, cs);
    const mr = big ? 19 : 15, mx = cx - cs / 2 + mr * 0.3, my = cy - cs / 2 + mr * 0.3;
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fillStyle = RANK_C[r.rank] || '#E8ECF4'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,8,14,0.85)'; ctx.stroke();
    ctx.fillStyle = '#14100A'; setFont(ctx, 800, Math.round(mr * 1.25), FONT.title); ctx.fillText(String(r.rank), mx, my + 2);
    const tx = cx + cs / 2 + (big ? 22 : 16), maxW = bx + cw - 14 - tx, label = SD.classLabel(r.cls);
    ctx.textAlign = 'left'; ctx.fillStyle = WHITE;
    fitFont(ctx, label, maxW, 700, big ? 42 : 30, FONT.ko, 18); ctx.fillText(label, tx, cy - (big ? 19 : 13));
    ctx.fillStyle = 'rgba(255,255,255,0.72)'; setFont(ctx, 600, big ? 25 : 19, FONT.ko); ctx.fillText(`${r.rank}위 · 승점 ${r.pts}`, tx, cy + (big ? 25 : 18));
    ctx.textAlign = 'center';
  });
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
}
function standPages(X, div) {
  const gs = X.D.standings[div] || {}, keys = Object.keys(gs);
  if (!keys.length) return [];
  const per = Number(X.sc.per) > 0 ? Number(X.sc.per) : keys.length;
  const pages = chunk(keys, per);
  return pages.map((ks, i) => ({ title: 'STANDINGS', subColor: div === 'W' ? '#C3CDFF' : '#FFE08A', sub: `${SD.DIV_LEAGUE[div]} 조별 순위 · ${X.asOf}${pages.length > 1 ? `  (${i + 1}/${pages.length})` : ''}`,
    name: `${DIV_KO[div]} 조별 순위${pages.length > 1 ? ` ${i + 1}/${pages.length}` : ''}`,
    sig: ks.map(k => gs[k].rows.map(r => [r.cls, r.rank, r.p, r.pts, r.w, r.d, r.l, r.fp, X.mv ? SD.moveOf(X.mv.stand[div] && X.mv.stand[div][k], r.cls, r.rank) : null])),
    draw: (ctx, τ, A, still) => drawStand(ctx, X, div, ks, τ, A, still) }));
}
// The whole sequence for one week: steps (one per image), their start times and the total length.
function buildRecap(L, wk, cfg, P, theme, foot) {
  const sid = L.sid;
  const cum = SD.leagueWhere(sid, 'le:' + wk.end, m => !!m.date && m.date <= wk.end);
  const only = SD.leagueWhere(sid, 'wk:' + wk.mon, m => !!m.date && m.date >= wk.mon && m.date <= wk.end);
  const D = cfg.scope === 'week' ? only : cum;
  const mv = cfg.move !== false && cfg.scope !== 'week' ? SD.movesFrom(SD.leagueWhere(sid, 'le:' + wk.prevEnd, m => !!m.date && m.date <= wk.prevEnd)) : null;
  const pick = (cfg.pick && cfg.pick[wk.mon]) || {};
  const label = String(pick.label || '').trim() || `WEEK ${wk.n}`;
  const lm = label.match(/^(.*?)\s*(\d+)\s*$/);
  const X = { L, wk, cfg, P, theme, foot, cum, only, D, mv, pick, label, word: (lm ? lm[1] : label).trim() || 'WEEK', num: lm ? lm[2] : '',
    year: wk.first.slice(0, 4), wkLine: `${label}  ·  ${rangeEn(wk.first, wk.last)}`, rangeEn: rangeEn(wk.first, wk.last), rangeKo: rangeKo(wk.first, wk.last),
    asOf: cfg.scope === 'week' ? `${label} 경기만` : `${label} 종료 기준` };
  X.motw = (pick.motw && wk.matches.find(m => m.id === pick.motw)) || motwAuto(wk.matches);
  const steps = [], info = {};
  cfg.order.forEach(k => {
    const sc = cfg.scenes[k] || {};
    const pages = BUILD[k]({ ...X, sc });
    info[k] = { pages: pages.length };
    if (sc.on === false) return;
    const sec = clamp(Number(sc.sec) || SCN[k].sec, 2, 30);
    pages.forEach((p, i) => steps.push({ ...p, key: k + '-' + i, scene: k, sec, first: i === 0, last: i === pages.length - 1, page: i + 1, pages: pages.length }));
  });
  steps.forEach((s, i) => { const prev = steps[i - 1]; s.bgFrom = prev && !!prev.cover !== !!s.cover ? (prev.cover ? 'cover' : 'page') : null; });
  let t = 0; const starts = steps.map(s => { const a = t; t += s.sec; return a; });
  return { X, steps, starts, total: t, info };
}

// ---------- painting ----------
function paint(ctx, X, s, τ, A, still) {
  ctx.save();
  ctx.drawImage(s.cover ? coverBg(X, A) : pageBg(X, A), 0, 0, W, H);
  if (!still && s.bgFrom && τ < 0.5) { // cross-fade from the previous backdrop (cover ↔ pages)
    ctx.globalAlpha = 1 - eOut(τ / 0.5); ctx.drawImage(s.bgFrom === 'cover' ? coverBg(X, A) : pageBg(X, A), 0, 0, W, H); ctx.globalAlpha = 1;
  }
  if (s.cover) (s.advCover ? drawAdvCover : drawCover)(ctx, X, s, τ, A, still);
  else {
    const ex = still ? 0 : clamp((τ - (s.sec - 0.4)) / 0.4);
    head(ctx, X, s, τ, still, ex);
    fade(ctx, 1 - ex, () => { if (ex) ctx.translate(-80 * ex * ex, 0); s.draw(ctx, τ, A, still); });
  }
  ctx.restore();
}
function stepAt(seq, t) {
  const { steps, starts, total } = seq;
  if (t >= total) return [steps.length - 1, Math.max(0, steps[steps.length - 1].sec - 0.45)];
  let i = 0; while (i < steps.length - 1 && t >= starts[i + 1]) i++;
  return [i, t - starts[i]];
}
function paintAt(ctx, seq, t, A) {
  if (!seq.steps.length) return -1;
  const [i, τ] = stepAt(seq, t);
  paint(ctx, seq.X, seq.steps[i], τ, A, false);
  return i;
}
function still(seq, s, A) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  paint(c.getContext('2d'), seq.X, s, 99, A, true);
  return c;
}

// ---------- assets ----------
const FIXED_KO = '토너먼트 진출 팀 발표 표지 최종 동점 남·여 모두 참가 골득실 다득점 레이저런 추첨 위 → 남학생 여학생 리그 조별 순위 종료 기준 경기만 경기 결과 승부차기 전반 후반 어시스트 골 합작 점 학년 반 이번 주 득점 발롱도르 베스트 케미 학급 응원 응원가 응원깃발 '
  + '경기 전 파이팅 페어플레이 남·여 참가 담임쌤 참여 조 승 무 패 득실 승점 월 화 수 목 금 토 일 주차 리캡 성덕 풋살 챔피언스리그 외 분 기록이 아직 없습니다 0123456789 · – + …';
async function prepare(seq) {
  const X = seq.X, classes = new Set();
  Object.values(X.D.standings).forEach(gs => Object.values(gs).forEach(g => g.rows.forEach(r => classes.add(r.cls))));
  X.wk.matches.forEach(m => { classes.add(m.home); classes.add(m.away); });
  const img = {};
  const [brand] = await Promise.all([loadImg('logos/brand.webp'), ...[...classes].map(async c => { const u = SD.logoUrl(c); img[c] = u ? await loadImg(u) : null; })]);
  const text = [FIXED_KO, LEAGUE_KR, X.foot || '', ...[...classes].map(SD.classLabel), ...X.L.players.map(p => p.name)].join(' ');
  const EN = `SEONGDEOK FUTSAL CHAMPIONS LEAGUE WEEK ${MON.join(' ')} RESULTS MATCH OF THE PLAYER STANDINGS TOP SCORERS ASSISTS BEST CHEMISTRY BALLON D'OR CLASS NEW VS KNOCKOUT STAGE QUALIFIED MEN WOMEN GROUP 0123456789:+-–,`;
  try {
    await Promise.all([
      document.fonts.load(`italic 900 100px ${FONT.title}`, EN), document.fonts.load(`italic 800 100px ${FONT.title}`, EN),
      document.fonts.load(`800 100px ${FONT.title}`, EN), document.fonts.load(`700 60px ${FONT.en}`, EN), document.fonts.load(`600 30px ${FONT.en}`, EN + LEAGUE_EN),
      document.fonts.load(`500 20px ${FONT.en}`, LEAGUE_EN),
      document.fonts.load(`700 38px ${FONT.ko}`, text), document.fonts.load(`600 28px ${FONT.ko}`, text), document.fonts.load(`500 24px ${FONT.ko}`, text),
    ]);
  } catch (e) { /* system fonts */ }
  return { img, brand };
}

// ---------- preview player ----------
function Player({ seq, A, guides, jump }) {
  const cv = useRef(null), st = useRef({ t: seq.steps.length ? Math.max(0, Math.min(3.2, seq.steps[0].sec - 0.5)) : 0, play: false, last: 0, raf: 0, ui: 0, fresh: true }), seqRef = useRef(seq), aRef = useRef(A);
  seqRef.current = seq; aRef.current = A;
  const [, force] = useState(0);
  const draw = () => {
    const c = cv.current; if (!c) return;
    const ctx = c.getContext('2d'); ctx.setTransform(c.width / W, 0, 0, c.height / H, 0, 0);
    if (!aRef.current || !seqRef.current.steps.length) { ctx.fillStyle = '#04060f'; ctx.fillRect(0, 0, W, H); return; }
    paintAt(ctx, seqRef.current, Math.min(st.current.t, seqRef.current.total), aRef.current);
  };
  const stop = () => { const s = st.current; s.play = false; cancelAnimationFrame(s.raf); };
  const loop = now => {
    const s = st.current; if (!s.play) return;
    if (s.last) s.t += Math.min(0.1, (now - s.last) / 1000);
    s.last = now;
    if (s.t >= seqRef.current.total) { s.t = seqRef.current.total; s.play = false; }
    draw();
    if (!s.play || now - s.ui > 150) { s.ui = now; force(x => x + 1); }
    if (s.play) s.raf = requestAnimationFrame(loop);
  };
  const play = () => { const s = st.current; if (s.fresh || s.t >= seqRef.current.total - 0.05) s.t = 0; s.fresh = false; s.play = true; s.last = 0; cancelAnimationFrame(s.raf); s.raf = requestAnimationFrame(loop); force(x => x + 1); };
  const seek = t => { st.current.fresh = false; st.current.t = clamp(t, 0, seqRef.current.total); draw(); force(x => x + 1); };
  useEffect(() => { draw(); }, [seq, A]);
  useEffect(() => { if (jump) { seek(jump.t); if (jump.play) play(); } }, [jump]);
  useEffect(() => () => stop(), []);
  const s = st.current, total = seq.total, t = Math.min(s.t, total);
  const [i] = seq.steps.length ? stepAt(seq, t) : [-1];
  const cur = seq.steps[i];
  const toStep = j => seek(seq.starts[clamp(j, 0, seq.steps.length - 1)] + 0.001);
  const prev = () => { if (i < 0) return; const τ = t - seq.starts[i]; toStep(τ > 0.6 ? i : i - 1); };
  const next = () => { if (i >= 0 && i < seq.steps.length - 1) toStep(i + 1); };
  return html`<div class="rc-player">
    <div class="rc-screen" onClick=${() => (s.play ? (stop(), force(x => x + 1)) : play())}>
      <canvas ref=${cv} width="720" height="1280" aria-label="주간 리캡 미리보기"></canvas>
      ${guides ? html`<i class="rc-band t"></i><i class="rc-band b"></i>` : null}
      ${!s.play ? html`<span class="rc-big" aria-hidden="true"><${Icon} n="play" size=${26} /></span>` : null}
    </div>
    <div class="rc-scrub">
      <div class="rc-marks" aria-hidden="true">${seq.steps.map((x, j) => x.first && j ? html`<i style=${`left:${(seq.starts[j] / total) * 100}%`}></i>` : null)}</div>
      <input type="range" min="0" max=${total} step="0.05" value=${t} aria-label="재생 위치" onInput=${e => { stop(); seek(Number(e.target.value)); }} />
    </div>
    <div class="rc-ctl">
      <button type="button" class="icon-btn" aria-label="이전 장" onClick=${prev}><${Icon} n="prev" /></button>
      <button type="button" class="btn btn-primary rc-play" aria-label=${s.play ? '일시정지' : '재생'} onClick=${() => (s.play ? (stop(), force(x => x + 1)) : play())}><${Icon} n=${s.play ? 'pause' : 'play'} />${s.play ? '일시정지' : '재생'}</button>
      <button type="button" class="icon-btn" aria-label="다음 장" onClick=${next}><${Icon} n="next" /></button>
      <span class="rc-time">${fmtSec(t)} / ${fmtSec(total)}</span>
    </div>
    <div class="rc-now">${cur ? html`<b>${i + 1}/${seq.steps.length}</b> ${cur.name}` : '보여 줄 장면이 없습니다'}</div>
  </div>`;
}

// ---------- scene list (on/off, seconds, order, options) ----------
// An input that keeps what is being typed (the panel re-renders while images are drawn) and saves on blur / Enter.
function Draft({ value, onCommit, ...rest }) {
  const [v, setV] = useState(String(value ?? '')), typing = useRef(false);
  useEffect(() => { if (!typing.current) setV(String(value ?? '')); }, [value]);
  return html`<input ...${rest} value=${v} onFocus=${() => { typing.current = true; }} onInput=${e => setV(e.target.value)}
    onBlur=${e => { typing.current = false; onCommit(e.target.value); }} onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />`;
}
const PER_OPTS = { results: [[3, '3경기씩'], [4, '4경기씩'], [5, '5경기씩'], [6, '6경기씩']], standM: [[0, '한 장에 모두'], [4, '4개 조씩'], [2, '2개 조씩']], standW: [[0, '한 장에 모두'], [4, '4개 조씩'], [2, '2개 조씩']] };
const TOP_OPTS = [[3, 'TOP 3'], [5, 'TOP 5'], [10, 'TOP 10']];
function SceneOpt({ k, sc, X, save, wkKey, canEdit }) {
  const setSc = patch => save({ scenes: { [k]: patch } });
  const setPick = patch => save({ pick: { [wkKey]: patch } });
  if (PER_OPTS[k]) return html`<select class="select" aria-label=${SCN[k].label + ' 한 장에'} value=${String(sc.per ?? SCN[k].per)} onChange=${e => setSc({ per: Number(e.target.value) })}>
    ${PER_OPTS[k].map(([v, l]) => html`<option value=${String(v)}>${l}</option>`)}</select>`;
  if ('top' in SCN[k]) return html`<select class="select" aria-label=${SCN[k].label + ' 몇 위까지'} value=${String(topOf(sc))} onChange=${e => setSc({ top: Number(e.target.value) })}>
    ${TOP_OPTS.map(([v, l]) => html`<option value=${String(v)}>${l}</option>`)}</select>`;
  if (k === 'cover') return html`<${Draft} class="input rc-label" aria-label="표지 문구 (끝의 숫자가 크게 나옵니다)" title="끝의 숫자가 크게 나옵니다" value=${X.pick.label || ''} placeholder=${`WEEK ${X.wk.n}`} maxlength="18"
    onCommit=${v => { if (v.trim() !== (X.pick.label || '')) setPick({ label: v.trim() || null }); }} />`;
  if (k === 'motw') {
    const auto = motwAuto(X.wk.matches);
    const lab = m => `${dot(m.date)} ${m.home} ${m.scoreH}:${m.scoreA} ${m.away}`;
    return html`<select class="select rc-pick" aria-label="이주의 경기 고르기" value=${X.pick.motw && X.wk.matches.some(m => m.id === X.pick.motw) ? X.pick.motw : ''} onChange=${e => setPick({ motw: e.target.value || null })}>
      <option value="">자동 · ${auto ? lab(auto) : '-'}</option>${X.wk.matches.map(m => html`<option value=${m.id}>${lab(m)}</option>`)}</select>`;
  }
  if (k === 'potw') return html`<div class="rc-pair">${SD.DIVS.map(div => {
    const list = (X.only.mvp[div] || []).slice(0, 12);
    const autoP = list.filter(x => x.rank === 1).sort((a, b) => b.g - a.g || b.a - a.a)[0];
    const cur = X.pick['potw' + div] && list.some(x => x.p.id === X.pick['potw' + div]) ? X.pick['potw' + div] : '';
    return html`<select class="select rc-pick" key=${div} aria-label=${DIV_KO[div] + ' 이주의 선수'} value=${cur} onChange=${e => setPick({ ['potw' + div]: e.target.value || null })}>
      <option value="">${DIV_KO[div]} 자동 · ${autoP ? autoP.p.name : '없음'}</option>${list.map(x => html`<option value=${x.p.id}>${x.p.name} (${x.p.cls}) ${x.v}점</option>`)}</select>`;
  })}</div>`;
  return null;
}
function SceneList({ seq, cfg, save, canEdit, wk, onJump, fixed }) {
  const X = seq.X;
  const move = (i, d) => { const o = cfg.order.slice(), j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; save({ order: o }); };
  const setSec = (k, raw) => { const v = Math.round(Number(raw)); if (!v || v === (cfg.scenes[k] || {}).sec) return; save({ scenes: { [k]: { sec: clamp(v, 2, 30) } } }); };
  return html`<div class="rc-list">${cfg.order.map((k, i) => {
    const sc = cfg.scenes[k] || {}, pages = (seq.info[k] || {}).pages || 0, on = sc.on !== false;
    const first = seq.steps.findIndex(s => s.scene === k);
    const note = pages ? (pages > 1 ? `${pages}장 · ${pages * (sc.sec || SCN[k].sec)}초` : `1장 · ${sc.sec || SCN[k].sec}초`) : '이번 주 내용 없음';
    return html`<div class=${'rc-row' + (on && pages ? '' : ' off')} key=${k}>
      <div class="rc-ord">${fixed ? null : html`
        <button type="button" class="icon-btn sm" aria-label=${SCN[k].label + ' 위로'} disabled=${i === 0} onClick=${() => move(i, -1)}><${Icon} n="up" size=${14} /></button>
        <button type="button" class="icon-btn sm" aria-label=${SCN[k].label + ' 아래로'} disabled=${i === cfg.order.length - 1} onClick=${() => move(i, 1)}><${Icon} n="down" size=${14} /></button>`}
      </div>
      <label class="switch rc-name"><input type="checkbox" checked=${on} onChange=${e => save({ scenes: { [k]: { on: e.target.checked } } })} />
        <span><b>${SCN[k].label}</b><small>${note}</small></span></label>
      <div class="rc-opt"><${SceneOpt} k=${k} sc=${sc} X=${X} save=${save} wkKey=${wk.mon} canEdit=${canEdit} /></div>
      <label class="rc-sec"><${Draft} class="input" type="number" min="2" max="30" step="1" inputmode="numeric" aria-label=${SCN[k].label + ' 시간(초)'} value=${sc.sec || SCN[k].sec}
        onCommit=${v => setSec(k, v)} /><span>${pages > 1 ? '초/장' : '초'}</span></label>
      <button type="button" class="icon-btn" aria-label=${SCN[k].label + ' 부터 재생'} title="여기부터 재생" disabled=${first < 0} onClick=${() => onJump(seq.starts[first] + 0.001)}><${Icon} n="play" size=${15} /></button>
    </div>`;
  })}</div>`;
}

// ---------- still images ----------
function useStills(seq, A, sig) {
  const [shots, setShots] = useState({});
  useEffect(() => {
    if (!A) return;
    let live = true; const out = {};
    const t = setTimeout(async () => {
      for (const s of seq.steps) {
        if (!live) return;
        const c = still(seq, s, A); let url;
        try { url = c.toDataURL('image/jpeg', 0.9); } catch (e) { url = 'err'; }
        out[s.key] = { url, get canvas() { return still(seq, s, A); } };
        if (live) setShots({ ...out });
        await new Promise(r => setTimeout(r, 16));
      }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [sig, A]);
  return shots;
}
function RecapCard({ s, i, shot, guides, file, onOpen }) {
  const ok = shot && shot.url !== 'err';
  return html`<figure class="story">
    <button type="button" class="story-frame" aria-label=${s.name + ' 크게 보기'} disabled=${!ok} onClick=${onOpen}>
      ${ok ? html`<img src=${shot.url} alt=${s.name} />` : html`<div class="story-wait">${shot ? '이미지를 만들지 못했습니다' : '그리는 중…'}</div>`}
      ${guides ? html`<i class="safe t band"></i><i class="safe b band"></i>` : null}
      ${ok ? html`<span class="story-zoom" aria-hidden="true"><${Icon} n="search" size=${16} /></span>` : null}</button>
    <figcaption><b>${i + 1}. ${s.name}</b><span>${s.sec}초</span><${SaveBtn} shot=${shot} file=${file} /></figcaption>
  </figure>`;
}

// ---------- video (MP4 for Instagram stories) ----------
const FPS = 30, BITRATE = 5e6, STORY_MAX = 59; // an Instagram story clip takes up to 60 s
let muxerP = null;
function loadMuxer() {
  if (window.Mp4Muxer) return Promise.resolve(window.Mp4Muxer);
  return muxerP || (muxerP = new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = 'lib/mp4-muxer.js';
    sc.onload = () => (window.Mp4Muxer ? res(window.Mp4Muxer) : rej(new Error('mp4-muxer missing')));
    sc.onerror = () => { muxerP = null; rej(new Error('mp4-muxer failed to load')); };
    document.head.appendChild(sc);
  }));
}
// H.264 in MP4 is what phones and Instagram take. WebCodecs encodes it faster than real time; otherwise the canvas
// is recorded live with MediaRecorder (Safari / newer Chrome record MP4). Anything else cannot make the file.
async function videoSupport() {
  if (typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined') {
    for (const codec of (window.__recapCodecs || ['avc1.640028', 'avc1.4d0028', 'avc1.42002a'])) {
      try { const r = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate: BITRATE, framerate: FPS }); if (r && r.supported) return { kind: 'fast', codec }; } catch (e) { /* next codec */ }
    }
  }
  if (typeof MediaRecorder !== 'undefined' && HTMLCanvasElement.prototype.captureStream) {
    const mime = ['video/mp4;codecs=avc1', 'video/mp4'].find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } });
    if (mime) return { kind: 'live', mime };
  }
  return null;
}
// Clips of at most STORY_MAX seconds, cut between scenes (a scene longer than that is cut between its pages).
function planParts(seq, split) {
  if (!seq.steps.length) return [];
  if (!split) return [{ t0: 0, t1: seq.total }];
  const blocks = [];
  seq.steps.forEach((st, i) => {
    const b = blocks[blocks.length - 1], a = seq.starts[i], e = a + st.sec;
    if (b && b.scene === st.scene) { b.t1 = e; b.cuts.push([a, e]); } else blocks.push({ scene: st.scene, t0: a, t1: e, cuts: [[a, e]] });
  });
  const parts = []; let cur = null;
  const add = (a, e) => { if (cur && e - cur.t0 <= STORY_MAX) cur.t1 = e; else { cur = { t0: a, t1: e }; parts.push(cur); } };
  blocks.forEach(b => { if (b.t1 - b.t0 <= STORY_MAX) add(b.t0, b.t1); else b.cuts.forEach(([a, e]) => add(a, e)); });
  return parts;
}
const tick0 = () => new Promise(r => setTimeout(r, 0));
async function encodeFast(seq, A, part, codec, onProg, stop) {
  const M = await loadMuxer();
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const muxer = new M.Muxer({ target: new M.ArrayBufferTarget(), fastStart: 'in-memory',
    video: { codec: codec.startsWith('avc') ? 'avc' : codec.startsWith('vp09') ? 'vp9' : 'av1', width: W, height: H, frameRate: FPS } });
  let fail = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { fail = e; } });
  enc.configure({ codec, width: W, height: H, bitrate: BITRATE, framerate: FPS, ...(codec.startsWith('avc') ? { avc: { format: 'avc' } } : {}) });
  const n = Math.max(1, Math.round((part.t1 - part.t0) * FPS));
  try {
    for (let i = 0; i < n; i++) {
      if (fail) throw fail;
      if (stop()) throw { code: 'cancelled' };
      paintAt(ctx, seq, part.t0 + i / FPS, A);
      const f = new VideoFrame(c, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
      enc.encode(f, { keyFrame: i % (FPS * 2) === 0 }); f.close();
      while (enc.encodeQueueSize > 4 && !fail) await new Promise(r => setTimeout(r, 2));
      if (i % 5 === 0) { onProg(i / n); await tick0(); }
    }
    await enc.flush();
  } finally { if (enc.state !== 'closed') enc.close(); }
  if (fail) throw fail;
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}
async function encodeLive(seq, A, part, mime, onProg, stop) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  c.style.cssText = 'position:fixed;left:-20000px;top:0;width:9px;height:16px;opacity:0;pointer-events:none';
  document.body.appendChild(c);
  const ctx = c.getContext('2d'); paintAt(ctx, seq, part.t0, A);
  const stream = c.captureStream(FPS), chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: BITRATE });
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => { rec.onstop = r; });
  rec.start(500);
  const dur = part.t1 - part.t0, t0 = performance.now();
  let cancelled = false;
  await new Promise(res => {
    const step = () => {
      if (stop()) { cancelled = true; return res(); }
      const el = (performance.now() - t0) / 1000;
      if (el >= dur) return res();
      paintAt(ctx, seq, part.t0 + el, A); onProg(el / dur);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  rec.stop(); await stopped; stream.getTracks().forEach(t => t.stop()); c.remove();
  if (cancelled) throw { code: 'cancelled' };
  return new Blob(chunks, { type: 'video/mp4' });
}
let dlNs;
async function saveFile(blob, filename) {
  try {
    const d = dlNs !== undefined ? dlNs : (dlNs = await claude.use('downloads').catch(() => null));
    if (!d) { toast('이 화면에서는 바로 저장할 수 없습니다. 미리보기 영상을 길게 눌러(또는 오른쪽 클릭) 저장하세요.', 'err'); return; }
    const r = await d.save({ filename, data: blob });
    if (r && r.status === 'saved') toast('영상을 저장했습니다.');
  } catch (e) {
    const c = e && e.code;
    if (c === 'declined') return;
    toast(c === 'rate_limited' ? '저장 확인 창이 이미 열려 있습니다. 잠시 후 다시 눌러 주세요.'
      : c === 'too_large' ? '파일이 너무 커서 저장하지 못했습니다. 「스토리용 60초씩」으로 다시 만들어 보세요.'
        : '여기서는 바로 저장할 수 없습니다. 미리보기 영상을 길게 눌러(또는 오른쪽 클릭) 저장하세요.', 'err');
  }
}
const mbOf = b => `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)}MB`;
function VideoBox({ seq, A, stamp, vsig }) {
  const [sup, setSup] = useState(undefined); // undefined: checking · null: this browser cannot make MP4
  const [mode, setMode] = PAGES.usePref('recapSplit', 'split');
  const [job, setJob] = useState(null);
  const [outs, setOuts] = useState([]);
  const [cur, setCur] = useState(0);
  const stopRef = useRef(false), madeFor = useRef('');
  useEffect(() => { let live = true; videoSupport().then(v => { if (live) setSup(v); }); return () => { live = false; stopRef.current = true; }; }, []);
  // a finished video belongs to the sequence it was made from: drop it once scenes, times, colours or records change
  useEffect(() => {
    if (madeFor.current && madeFor.current !== vsig + mode) { setOuts(o => { o.forEach(x => URL.revokeObjectURL(x.url)); return []; }); madeFor.current = ''; }
  }, [vsig, mode]);
  const parts = planParts(seq, mode !== 'one');
  const make = async () => {
    if (!sup || !A || job || !parts.length) return;
    stopRef.current = false;
    outs.forEach(x => URL.revokeObjectURL(x.url)); setOuts([]);
    const made = [];
    const key = vsig + mode, snap = seq, list = parts.slice();
    try {
      for (let i = 0; i < list.length; i++) {
        setJob({ i, n: list.length, p: 0 });
        const onProg = p => setJob({ i, n: list.length, p });
        const blob = sup.kind === 'fast' ? await encodeFast(snap, A, list[i], sup.codec, onProg, () => stopRef.current)
          : await encodeLive(snap, A, list[i], sup.mime, onProg, () => stopRef.current);
        made.push({ url: URL.createObjectURL(blob), blob, file: list.length > 1 ? `SDSCL_${stamp}_리캡_${i + 1}of${list.length}.mp4` : `SDSCL_${stamp}_리캡.mp4`, dur: list[i].t1 - list[i].t0, size: blob.size });
        setOuts(made.slice()); setCur(0);
      }
      toast(list.length > 1 ? `영상 ${list.length}개를 만들었습니다. 하나씩 저장해 주세요.` : '영상을 만들었습니다. 저장을 눌러 주세요.');
    } catch (e) {
      if (!(e && e.code === 'cancelled')) { console.error(e); toast('영상을 만들지 못했습니다. 새로 고친 뒤 다시 해 보세요.', 'err'); }
    } finally { madeFor.current = made.length ? key : ''; setJob(null); }
  };
  const nSplit = planParts(seq, true).length;
  const pct = job ? Math.round(((job.i + job.p) / job.n) * 100) : 0;
  const shown = outs[Math.min(cur, outs.length - 1)];
  return html`<section class="rc-video">
    <div class="rc-vhead"><b>영상으로 저장</b><span class="small muted">MP4 · 1080×1920 · 소리 없음 (음악은 인스타그램에서 넣어 주세요)</span></div>
    ${sup === null ? html`<p class="small rc-vwarn">이 브라우저에서는 영상을 만들 수 없습니다. 컴퓨터의 크롬·엣지, 또는 아이폰의 사파리나 Claude 앱에서 열어 주세요.</p>` : html`
      <div class="rc-vopts">
        <${Seg} label="영상 나누기" value=${mode === 'one' ? 'one' : 'split'} onChange=${setMode}
          options=${[{ value: 'split', label: `스토리용 60초씩 · ${nSplit}개` }, { value: 'one', label: `한 개로 · ${fmtSec(seq.total)}` }]} />
        <button type="button" class="btn btn-primary" disabled=${!A || !sup || !!job || !parts.length} onClick=${make}><${Icon} n="play" size=${15} />${sup === undefined ? '확인 중…' : outs.length ? '다시 만들기' : '영상 만들기'}</button>
      </div>
      <p class="small muted rc-vnote">${mode === 'one' ? '한 개의 영상으로 만듭니다. 인스타 스토리는 한 장에 60초까지라 60초가 넘으면 올릴 때 잘라야 해요.'
        : parts.length > 1 ? `인스타 스토리는 한 장에 60초까지라서 장면이 끊기지 않게 ${parts.length}개로 나눕니다 (${parts.map(p => fmtSec(p.t1 - p.t0)).join(' + ')}). 순서대로 올리면 이어서 재생돼요.`
          : '60초 안쪽이라 영상 하나로 만듭니다. 스토리에 그대로 올릴 수 있어요.'}
        ${sup && sup.kind === 'live' ? ' 이 브라우저는 재생 시간만큼 녹화하니 끝날 때까지 이 화면을 켜 두세요.' : ''}</p>`}
    ${job ? html`<div class="rc-prog" role="status"><div class="rc-bar"><i style=${`width:${pct}%`}></i></div>
      <span>${job.n > 1 ? `${job.i + 1}/${job.n} · ` : ''}${Math.round(job.p * 100)}% 만드는 중…</span>
      <button type="button" class="btn btn-sm" onClick=${() => { stopRef.current = true; }}>취소</button></div>` : null}
    ${shown ? html`<div class="rc-outs">
      <video class="rc-vid" key=${shown.url} src=${shown.url} controls playsinline muted loop preload="metadata"
        onLoadedMetadata=${e => { try { e.target.currentTime = Math.min(2.6, (e.target.duration || 0) / 2); } catch (x) { /* poster frame only */ } }}></video>
      <div class="rc-outlist">${outs.map((o, i) => html`<div class=${'rc-out' + (o === shown ? ' on' : '')} key=${o.file}>
        <button type="button" class="rc-out-name" onClick=${() => setCur(i)} aria-label=${`${o.file} 미리보기`}><b>${outs.length > 1 ? `${i + 1}번째 영상` : '전체 영상'}</b><span>${fmtSec(o.dur)} · ${mbOf(o.size)}</span></button>
        <button type="button" class="btn btn-primary btn-sm" onClick=${() => saveFile(o.blob, o.file)}><${Icon} n="save" size=${14} />저장</button></div>`)}
        ${outs.length > 1 ? html`<span class="small muted">저장할 때마다 확인 창이 떠요. 아이폰은 「비디오 저장」을 누르면 사진 앱에 들어갑니다.</span>`
          : html`<span class="small muted">아이폰은 저장 창에서 「비디오 저장」을 누르면 사진 앱에 들어갑니다.</span>`}</div>
    </div>` : null}
  </section>`;
}

// ---------- the panel ----------
function RecapPanel({ L, canEdit, P, theme, footerText, guides }) {
  const weeks = weeksOf(L);
  const [wkPick, setWkPick] = PAGES.usePref('recapWeek', '');
  const [kindPick, setKind] = PAGES.usePref('recapKind', 'week');
  const [loc, setLoc] = useState({});
  const [A, setA] = useState(null);
  const [zoom, setZoom] = useState(-1);
  const [jump, setJump] = useState(null);
  const base = recapCfg(loc);
  const save = patch => { if (canEdit) PAGES.saveTv({ recap: patch }); else setLoc(prev => SD.deepMerge(prev, patch)); };
  // 리캡 종류: 주간 리캡 / 토너먼트 진출팀(조별리그가 모두 끝나면 고를 수 있다 — 표지 + 남·여 진출팀만)
  const gms = L.matches.filter(m => m.stage === 'group'), gDates = gms.map(m => m.date).filter(Boolean).sort();
  const advReady = !SD.VIEWER && !!SCN.adv && gms.length > 0 && gms.every(m => m.status === 'final' && m.date);
  const isAdv = advReady && kindPick === 'adv';
  let wk, cfg;
  if (isAdv) {
    const lw = weeks.find(w => w.mon === SD.mondayOf(gDates[gDates.length - 1])) || weeks[weeks.length - 1] || null;
    wk = lw && { ...lw, first: gDates[0], last: gDates[gDates.length - 1] }; // 머리글 날짜는 조별리그 전체 기간
    cfg = lw && { ...base, scope: 'cum', move: false, order: ADV_ORDER, pick: { ...base.pick, [lw.mon]: { ...(base.pick[lw.mon] || {}), label: 'GROUP STAGE' } } };
  } else {
    wk = weeks.find(w => w.mon === wkPick) || weeks[weeks.length - 1] || null;
    cfg = { ...base, order: base.order.filter(k => !ADV_ORDER.includes(k)) };
  }
  const seq = wk ? buildRecap(L, wk, cfg, P, theme, footerText) : { X: null, steps: [], starts: [], total: 0, info: {} };
  useEffect(() => { if (!wk) return; let live = true; prepare(seq).then(a => { if (live) setA(a); }); return () => { live = false; }; }, [wk && wk.mon, L.sid, isAdv]);
  const sig = wk ? JSON.stringify([theme, footerText, seq.X.label, seq.steps.map(s => [s.key, s.sub, s.sig])]) : '';
  const shots = useStills(seq, A, sig);
  if (!wk) return html`<section class="panel"><${Empty} title="아직 끝난 경기가 없습니다">경기를 「종료됨」으로 확정하면 그 주의 리캡이 만들어집니다.</${Empty}></section>`;
  const stamp = isAdv ? 'KNOCKOUT' : seq.X.label.replace(/\s+/g, '');
  const fileOf = (s, i) => `SDSCL_${stamp}_${String(i + 1).padStart(2, '0')}_${s.name.replace(/[\s/·]+/g, '_')}.jpg`;
  const stories = seq.steps.map((s, i) => ({ key: s.key, title: `${i + 1}. ${s.name}`, sub: `${s.sec}초`, alt: s.name, file: fileOf(s, i) }));
  const reset = () => (isAdv ? save({ scenes: { advCover: { on: true, sec: SCN.advCover.sec }, adv: { on: true, sec: SCN.adv.sec } } })
    : save({ scope: 'cum', move: true, order: ORDER, scenes: DEFAULT_RECAP.scenes }));
  const kindSeg = advReady ? html`<label class="field"><span>종류</span><${Seg} label="리캡 종류" value=${isAdv ? 'adv' : 'week'} onChange=${setKind}
    options=${[{ value: 'week', label: '주간 리캡' }, { value: 'adv', label: '토너먼트 진출팀' }]} /></label>` : null;
  const qs = isAdv ? advQuals(seq.X.cum) : null;
  const vsig = JSON.stringify([sig, seq.steps.map(s => s.sec)]);
  return html`<div class="rc-wrap"><div class="rc">
    <${Player} seq=${seq} A=${A} guides=${guides} jump=${jump} />
    <div class="rc-side">
      <div class="rc-top">
        ${kindSeg}
        ${isAdv ? html`<p class="small muted rc-advnote" style="margin:0;align-self:center">조별리그 최종 순위 기준 · 남학생 ${qs.M.length}팀 · 여학생 ${qs.W.length}팀 · 진출팀 표지와 남·여 진출팀만 담깁니다</p>` : html`
        <label class="field"><span>주차</span><select id="rc-week" class="select" value=${wk.mon} onChange=${e => setWkPick(e.target.value)}>
          ${weeks.map(w => html`<option value=${w.mon}>${(cfg.pick[w.mon] && cfg.pick[w.mon].label) || `WEEK ${w.n}`} · ${dot(w.first)}–${dot(w.last)} · ${w.matches.length}경기</option>`)}</select></label>
        <label class="field"><span>순위 기준</span><${Seg} label="순위 기준" value=${cfg.scope === 'week' ? 'week' : 'cum'} onChange=${v => save({ scope: v })}
          options=${[{ value: 'cum', label: '누적' }, { value: 'week', label: '이번 주만' }]} /></label>
        <label class="switch"><input id="rc-move" type="checkbox" checked=${cfg.move !== false} disabled=${cfg.scope === 'week'} onChange=${e => save({ move: e.target.checked })} />
          <span>순위 변동 ▲▼${cfg.scope === 'week' ? ' (누적일 때만)' : !seq.X.mv ? ' (지난주 기록이 생기면 표시)' : ''}</span></label>`}
        <span class="spacer"></span>
        <span class="rc-total">총 <b>${fmtSec(seq.total)}</b> · ${seq.steps.length}장</span>
      </div>
      <${VideoBox} seq=${seq} A=${A} stamp=${stamp} vsig=${vsig} />
      <div class="rc-head small muted"><span>장면 · 순서</span><span>옵션</span><span>시간</span></div>
      <${SceneList} seq=${seq} cfg=${cfg} save=${save} canEdit=${canEdit} wk=${wk} fixed=${isAdv} onJump=${t => setJump({ t, play: true, n: Date.now() })} />
      <div class="row rc-foot"><span class="small muted">${isAdv ? '켜기·끄기와 시간(초)을 바꾸면 바로 미리보기에 반영됩니다.' : '장면마다 켜기·끄기, 시간(초), 순서(▲▼)를 바꾸면 바로 미리보기에 반영됩니다.'}</span><span class="spacer"></span>
        <button type="button" class="btn btn-sm" onClick=${reset}>기본값으로</button></div>
    </div>
  </div>
  <section class="rc-stills">
    <div class="panel-head" style="padding:0 0 10px"><h2>장면별 이미지</h2><span class="sub">마지막 모습으로 저장됩니다 · 누르면 크게 보기</span></div>
    ${seq.steps.length ? html`<div class="story-grid">${seq.steps.map((s, i) => html`<${RecapCard} key=${s.key} s=${s} i=${i} shot=${shots[s.key]} guides=${guides} file=${fileOf(s, i)} onOpen=${() => setZoom(i)} />`)}</div>`
      : html`<section class="panel"><${Empty} title="켜진 장면이 없습니다">위 목록에서 보여 줄 장면을 켜 주세요.</${Empty}></section>`}
  </section>
  ${zoom >= 0 && zoom < stories.length ? html`<${Lightbox} stories=${stories} idx=${zoom} shots=${shots} onIdx=${setZoom} onClose=${() => setZoom(-1)} guides=${guides} band=${true} />` : null}</div>`;
}

window.RECAP = { RecapPanel, buildRecap, weeksOf, paint, paintAt, stepAt, still, prepare, recapCfg, DEFAULT_RECAP, planParts, videoSupport, encodeFast };
})();
