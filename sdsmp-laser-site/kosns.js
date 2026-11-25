/* SDSMP SNS › 토너먼트 대진표: 부별로 세로 스토리(1080×1920)와 가로(1920×1080) 이미지를 만든다.
   추첨 방송 화면과 같은 모양(어두운 무대, 양쪽 학급 칸, 막대기 선)에 가운데는 트로피 사진 + 결승 · FINAL.
   경기가 진행되면 TV 대진표처럼 이긴 반 칩이 올라가고, 점수 · 날짜 · 우승 학급이 함께 그려진다.
   원본 SDSMP 전용 — 둘러보기 복사본에서는 SNS 종류에 나오지 않는다. */
(function () {
'use strict';
const { useState, useEffect } = preactHooks;
const { html, Icon, Empty } = UI;
const { S, DIV_LABEL, fmtDate } = SD;
const K = SNS.K;

const ACC = { M: '242,183,5', W: '142,164,255' };
const F = {
  kr: '"Black Han Sans", "IBM Plex Sans KR", sans-serif',
  ko: '"IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
  en: '"Big Shoulders Display", "Arial Narrow", sans-serif',
};
const setF = (ctx, w, px, fam) => { ctx.font = `${w} ${px}px ${fam}`; };
const when = m => (m && m.date ? `${fmtDate(m.date)}${m.time ? ' ' + m.time : ''}` : '');

// ---------- 대진 모양: main 축(가로 이미지는 x, 세로 이미지는 y)으로 가운데를 향해 라운드가 이어진다 ----------
function geom(size, slots, o) {
  const R = Math.round(Math.log2(size));
  const halves = [[], []];
  for (let s = 0; s < size; s++) if (slots[s]) halves[s < size / 2 ? 0 : 1].push(s);
  const leaf = {};
  halves.forEach((list, h) => {
    const st = (o.C1 - o.C0) / Math.max(1, list.length);
    list.forEach((s, k) => { leaf[s] = { s, h, k, c: o.C0 + st * (k + 0.5), m: h ? o.A1 : o.A0, step: st }; });
  });
  const mAt = (h, r) => { const A = h ? o.A1 : o.A0, E = h ? o.E1 : o.E0; return A + ((E - A) * r) / R; };
  const lines = [], nodes = [], cols = {};
  const rec = (r, i) => {
    if (r === 0) { const l = leaf[i]; return l ? { m: l.m, c: l.c, r: 0, i, h: l.h, leaf: l } : null; }
    const a = rec(r - 1, 2 * i), b = rec(r - 1, 2 * i + 1);
    if (!a || !b) return a || b;
    const h = (i << r) < size / 2 ? 0 : 1;
    const nd = { m: mAt(h, r), c: (a.c + b.c) / 2, r, i, h };
    lines.push({ a, b: nd, first: true }, { a: b, b: nd, first: false });
    nodes.push(nd); cols[h + ':' + r] = nd.m;
    return nd;
  };
  const fin = { r: R, i: 0, final: true };
  if (R >= 1) [rec(R - 1, 0), rec(R - 1, 1)].forEach((rt, h) => { if (rt) lines.push({ a: rt, b: fin, end: h ? o.E1 : o.E0, h }); });
  const bye = halves[0].length + halves[1].length < size;
  const labels = Object.entries(cols).map(([k, m]) => { const [h, r] = k.split(':').map(Number); return { h, m, text: r === 1 && bye ? '1회전' : SD.ROUND_NAME(size / 2 ** (r - 1)) }; });
  return { R, leaf, lines, nodes, labels, fin, n: halves[0].length + halves[1].length, bye, most: Math.max(halves[0].length, halves[1].length) };
}

// ---------- 그리기 도구 ----------
function rr(ctx, x, y, w, h, r) { K.rrect(ctx, x, y, w, h, r); }
function logo(ctx, img, cls, cx, cy, size, dim) {
  ctx.save(); if (dim) { ctx.globalAlpha = 0.42; ctx.filter = 'grayscale(1)'; }
  K.crest(ctx, img, cls, cx, cy, size); ctx.restore();
}
function stage(ctx, W, H, rgb) {
  ctx.fillStyle = '#02040b'; ctx.fillRect(0, 0, W, H);
  const R = Math.max(W, H);
  let g = ctx.createRadialGradient(W / 2, H * 1.15, 0, W / 2, H * 1.15, R * 0.95);
  g.addColorStop(0, '#10245e'); g.addColorStop(0.52, '#060c22'); g.addColorStop(1, '#02040b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(W / 2, H * 0.47); ctx.scale(W * 0.62, H * 0.56);
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, `rgba(${rgb},.2)`); g.addColorStop(0.7, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
  // 천천히 도는 빛줄기 (정지 화면이라 한 장면만)
  if (ctx.createConicGradient) {
    ctx.save(); const cg = ctx.createConicGradient(-0.4, W / 2, H * 0.5);
    [[0, 0], [0.07, 0], [0.09, `rgba(${rgb},.07)`], [0.12, 0], [0.32, 0], [0.35, 'rgba(255,255,255,.045)'], [0.38, 0], [0.57, 0], [0.6, `rgba(${rgb},.06)`], [0.63, 0], [0.82, 0], [0.85, 'rgba(255,255,255,.04)'], [0.88, 0], [1, 0]]
      .forEach(([p, c]) => cg.addColorStop(p, c || 'rgba(0,0,0,0)'));
    ctx.fillStyle = cg; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  let s = 11; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 110; i++) { ctx.globalAlpha = 0.15 + rnd() * 0.5; ctx.beginPath(); ctx.arc(rnd() * W, rnd() * H, 0.6 + rnd() * 1.2, 0, 6.29); ctx.fill(); }
  ctx.globalAlpha = 1;
}
function pill(ctx, cx, top, text, live, px = 16) {
  setF(ctx, live ? 700 : 600, px, F.ko);
  const w = ctx.measureText(text).width + 26, h = px + 12;
  rr(ctx, cx - w / 2, top, w, h, h / 2);
  ctx.fillStyle = live ? '#0E9F57' : 'rgba(6,10,28,.92)'; ctx.fill();
  ctx.lineWidth = 1.2; ctx.strokeStyle = live ? '#7CF0B0' : 'rgba(255,255,255,.24)'; ctx.stroke();
  ctx.fillStyle = live ? '#fff' : 'rgba(255,255,255,.82)'; ctx.textAlign = 'center'; ctx.fillText(text, cx, top + h / 2 + px * 0.36);
}

// ---------- 한 장 그리기 ----------
function draw(ctx, st, A) {
  const { div, orient, L, bracket } = st;
  const V = orient === 'v', W = V ? 1080 : 1920, H = V ? 1920 : 1080, rgb = ACC[div] || ACC.M;
  const size = bracket.size, slots = bracket.slots || [];
  const n = slots.filter(Boolean).length;
  // 배치 (세로: 위 반쪽 → 가운데 트로피 ← 아래 반쪽 / 가로: 추첨 방송 화면과 같은 1920×1080)
  const o = V
    ? { A0: 530, A1: 1436, E0: 810, E1: 1156, C0: 64, C1: W - 36 }
    : { A0: 396, A1: W - 396, E0: W / 2 - 112, E1: W / 2 + 112, C0: 236, C1: 930 };
  const G = geom(size, slots, o);
  const P = (m, c) => (V ? [c, m] : [m, c]);
  const byId = Object.fromEntries(L.matches.filter(m => m.ko && m.bracket === `${L.sid}-${div}`).map(m => [m.id, m]));
  const mOf = nd => byId[SD.koId(L.sid, div, nd.r, nd.i)];
  const teamAt = nd => (nd.leaf ? slots[nd.leaf.s] : SD.winnerOf(mOf(nd)));
  const out = new Set();
  Object.values(byId).forEach(m => { const w = SD.winnerOf(m); if (w) out.add(w === m.home ? m.away : m.home); });
  const tag = {}; SD.qualifiers(L, div).forEach(q => { tag[q.cls] = `${q.group}조 ${q.rank}위`; });
  const finM = mOf(G.fin), champ = SD.winnerOf(finM);
  const all = Object.values(byId);

  stage(ctx, W, H, rgb);

  // ----- 머리 -----
  const league = (L.sp && L.sp.league) || 'SEONGDEOK FUTSAL CHAMPIONS LEAGUE';
  const title = `${DIV_LABEL[div]} ${G.bye ? '토너먼트' : SD.ROUND_NAME(size)} 대진표`;
  const now = all.filter(m => m.home && m.away && !SD.winnerOf(m)).sort((x, y) => x.round - y.round)[0];
  const first = all.filter(m => m.date).map(m => m.date).sort()[0];
  const status = champ ? ['CHAMPION', SD.classLabel(champ)] : now && all.some(SD.hasResult) ? ['NOW', now.round === 1 && G.bye ? '1회전' : now.stage]
    : first ? ['KICK-OFF', fmtDate(first)] : ['KNOCKOUT', `${n}팀`];
  ctx.textBaseline = 'alphabetic';
  if (V) {
    if (A.brand) { const s = 84, r = Math.min(s / A.brand.naturalWidth, s / A.brand.naturalHeight); ctx.drawImage(A.brand, W / 2 - (A.brand.naturalWidth * r) / 2, 124, A.brand.naturalWidth * r, A.brand.naturalHeight * r); }
    ctx.fillStyle = 'rgba(255,255,255,.72)'; setF(ctx, 700, 22, F.en); K.spaced(ctx, league.toUpperCase(), W / 2, 240, 3);
    ctx.save(); ctx.shadowColor = `rgba(${rgb},.6)`; ctx.shadowBlur = 34; ctx.fillStyle = '#fff'; K.fitFont(ctx, title, 960, 400, 66, F.kr); ctx.textAlign = 'center'; ctx.fillText(title, W / 2, 314); ctx.restore();
    ctx.fillStyle = `rgb(${rgb})`; setF(ctx, 800, 22, F.en); K.spaced(ctx, 'KNOCKOUT STAGE', W / 2, 356, 11);
  } else {
    if (A.brand) { const s = 82, r = Math.min(s / A.brand.naturalWidth, s / A.brand.naturalHeight); ctx.drawImage(A.brand, 56, 52, A.brand.naturalWidth * r, A.brand.naturalHeight * r); }
    const words = league.toUpperCase().split(' '), half = Math.ceil(words.length / 2);
    ctx.fillStyle = 'rgba(255,255,255,.72)'; setF(ctx, 700, 21, F.en);
    K.spaced(ctx, words.slice(0, half).join(' '), 154, 88, 3, 'left'); K.spaced(ctx, words.slice(half).join(' '), 154, 116, 3, 'left');
    ctx.save(); ctx.shadowColor = `rgba(${rgb},.55)`; ctx.shadowBlur = 34; ctx.fillStyle = '#fff'; K.fitFont(ctx, title, 820, 400, 62, F.kr); ctx.textAlign = 'center'; ctx.fillText(title, W / 2, 112); ctx.restore();
    ctx.fillStyle = `rgb(${rgb})`; setF(ctx, 800, 20, F.en); K.spaced(ctx, 'KNOCKOUT STAGE', W / 2, 150, 11);
    // 오른쪽: 지금 상황
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,.62)'; setF(ctx, 800, 22, F.en); K.spaced(ctx, status[0], W - 56, 78, 5, 'right');
    ctx.save(); ctx.shadowColor = `rgba(${rgb},.6)`; ctx.shadowBlur = 24; ctx.fillStyle = '#fff'; K.fitFont(ctx, status[1], 420, 400, 52, F.kr); ctx.textAlign = 'right'; ctx.fillText(status[1], W - 56, 136); ctx.restore();
  }

  // ----- 라운드 이름 -----
  ctx.fillStyle = 'rgba(255,255,255,.62)';
  G.labels.forEach(lb => {
    if (V) { ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.5)'; setF(ctx, 600, 20, F.ko); ctx.textAlign = 'left'; ctx.fillText(lb.text, 8, lb.m + 7); ctx.restore(); }
    else { setF(ctx, 600, 30, F.ko); ctx.textAlign = 'center'; ctx.fillText(lb.text, lb.m, o.C0 - 36); }
  });

  // ----- 선 -----
  const stateOf = ln => {
    const t = teamAt(ln.a); if (!t) return 'idle';
    const w = SD.winnerOf(ln.b.final ? finM : mOf(ln.b));
    return w ? (w !== t ? 'lost' : out.has(t) ? 'past' : 'won') : 'in';
  };
  const pts = ln => {
    if (ln.end != null) return [P(ln.a.m, ln.a.c), P(ln.end, ln.a.c)];
    return [P(ln.a.m, ln.a.c), P(ln.b.m, ln.a.c), P(ln.b.m, ln.b.c)];
  };
  const order = { idle: 0, lost: 1, past: 2, in: 3, won: 4 };
  G.lines.map(ln => ({ ln, s: stateOf(ln) })).sort((x, y) => order[x.s] - order[y.s]).forEach(({ ln, s }) => {
    const p = pts(ln);
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); p.slice(1).forEach(q => ctx.lineTo(q[0], q[1]));
    if (s === 'won') { ctx.strokeStyle = `rgba(${rgb},.3)`; ctx.lineWidth = 14; ctx.stroke(); ctx.shadowColor = `rgba(${rgb},.9)`; ctx.shadowBlur = 16; ctx.strokeStyle = `rgb(${rgb})`; ctx.lineWidth = 5; }
    else if (s === 'in') { ctx.strokeStyle = `rgba(${rgb},.62)`; ctx.lineWidth = 3.5; }
    else if (s === 'past') { ctx.strokeStyle = `rgba(${rgb},.4)`; ctx.lineWidth = 3.5; }
    else { ctx.strokeStyle = s === 'lost' ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.18)'; ctx.lineWidth = 3; }
    ctx.stroke(); ctx.restore();
  });
  // 갈림점(아직 승자가 없는 경기)
  G.nodes.forEach(nd => {
    const m = mOf(nd); if (SD.winnerOf(m)) return;
    const [x, y] = P(nd.m, nd.c);
    ctx.beginPath(); ctx.arc(x, y, m && m.status === 'live' ? 10 : 7, 0, 6.29);
    ctx.fillStyle = m && m.status === 'live' ? '#0E9F57' : '#0a1330'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = m && m.status === 'live' ? '#7CF0B0' : 'rgba(255,255,255,.4)'; ctx.stroke();
  });

  // ----- 학급 칸 -----
  const cards = Object.values(G.leaf);
  if (V) {
    const cw = Math.min(190, Math.min(...cards.map(l => l.step)) - 10), chh = 150;
    cards.forEach(lf => {
      const c = slots[lf.s], gone = out.has(c), x = lf.c - cw / 2, y = lf.h ? o.A1 : o.A0 - chh;
      rr(ctx, x, y, cw, chh, 14);
      const g = ctx.createLinearGradient(0, y, 0, y + chh);
      if (gone) { ctx.fillStyle = 'rgba(9,16,42,.72)'; }
      else { g.addColorStop(lf.h ? 0 : 1, `rgba(${rgb},.3)`); g.addColorStop(lf.h ? 0.62 : 0.38, 'rgba(9,16,42,.9)'); ctx.fillStyle = g; }
      ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = gone ? 'rgba(255,255,255,.14)' : champ === c ? `rgb(${rgb})` : `rgba(${rgb},.75)`; ctx.stroke();
      const ls = Math.min(70, cw * 0.58);
      logo(ctx, A.img[c], c, lf.c, y + 12 + ls / 2, ls, gone);
      ctx.globalAlpha = gone ? 0.42 : 1; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      K.fitFont(ctx, SD.classLabel(c), cw - 10, 700, cw > 150 ? 26 : 22, F.ko, 14); ctx.fillText(SD.classLabel(c), lf.c, y + 110);
      ctx.fillStyle = 'rgba(255,255,255,.62)'; setF(ctx, 600, cw > 150 ? 17 : 15, F.ko); ctx.fillText(tag[c] || '', lf.c, y + 136); ctx.globalAlpha = 1;
    });
  } else {
    const ch = G.most > 6 ? 66 : 80, cw = 340;
    cards.forEach(lf => {
      const c = slots[lf.s], gone = out.has(c), x = lf.h ? o.A1 : o.A0 - cw, y = lf.c - ch / 2;
      rr(ctx, x, y, cw, ch, 16);
      const g = ctx.createLinearGradient(x, 0, x + cw, 0);
      if (gone) ctx.fillStyle = 'rgba(9,16,42,.72)';
      else { g.addColorStop(lf.h ? 1 : 0, `rgba(${rgb},.26)`); g.addColorStop(lf.h ? 0.38 : 0.62, 'rgba(9,16,42,.9)'); ctx.fillStyle = g; }
      ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = gone ? 'rgba(255,255,255,.14)' : champ === c ? `rgb(${rgb})` : `rgba(${rgb},.75)`; ctx.stroke();
      const ls = ch - 18, lx = lf.h ? x + cw - 10 - ls / 2 : x + 10 + ls / 2;
      logo(ctx, A.img[c], c, lx, lf.c, ls, gone);
      ctx.globalAlpha = gone ? 0.42 : 1; ctx.fillStyle = '#fff'; setF(ctx, 700, 26, F.ko);
      ctx.textAlign = lf.h ? 'right' : 'left'; ctx.fillText(SD.classLabel(c), lf.h ? x + cw - 22 - ls : x + 22 + ls, lf.c + 9);
      ctx.fillStyle = 'rgba(255,255,255,.62)'; setF(ctx, 600, 16, F.ko); ctx.textAlign = lf.h ? 'left' : 'right';
      ctx.fillText(tag[c] || '', lf.h ? x + 16 : x + cw - 16, lf.c + 6); ctx.globalAlpha = 1;
    });
  }

  // ----- 점수: 그 팀 선이 꺾이는 곳 -----
  G.lines.forEach(ln => {
    const m = ln.b.final ? finM : mOf(ln.b), t = teamAt(ln.a);
    if (!m || !t || m.status === 'scheduled') return;
    const side = m.home === t ? 0 : m.away === t ? 1 : -1; if (side < 0) return;
    const pk = SD.pkScore(m), w = SD.winnerOf(m), v = String(side ? m.scoreA : m.scoreH), pv = pk ? `(${pk[side]})` : '';
    let x, y, al;
    if (ln.end != null) {
      if (V) { x = ln.a.c + 12; y = ln.h ? ln.end + 34 : ln.end - 10; al = 'left'; }
      else { x = ln.end + (ln.h ? 12 : -12); y = ln.a.c - 10; al = ln.h ? 'left' : 'right'; }
    } else if (V) { x = ln.a.c + (ln.first ? -10 : 10); y = ln.b.h ? ln.b.m + 34 : ln.b.m - 10; al = ln.first ? 'right' : 'left'; }
    else { x = ln.b.m + (ln.b.h ? 12 : -12); y = ln.first ? ln.a.c - 10 : ln.a.c + 34; al = ln.b.h ? 'left' : 'right'; }
    ctx.save(); ctx.textAlign = 'left'; setF(ctx, 900, 32, F.en); const w1 = ctx.measureText(v).width; setF(ctx, 900, 19, F.en); const w2 = pv ? ctx.measureText(pv).width + 2 : 0;
    const x0 = al === 'right' ? x - w1 - w2 : x;
    const col = w ? (w === t ? `rgb(${rgb})` : 'rgba(255,255,255,.4)') : '#7CF0B0';
    if (w === t) { ctx.shadowColor = `rgba(${rgb},.55)`; ctx.shadowBlur = 16; }
    ctx.fillStyle = col; setF(ctx, 900, 32, F.en); ctx.fillText(v, x0, y);
    if (pv) { setF(ctx, 900, 19, F.en); ctx.fillText(pv, x0 + w1 + 2, y); }
    ctx.restore();
  });

  // ----- 갈림점: 이긴 반 칩 / 날짜 · LIVE -----
  G.nodes.forEach(nd => {
    const m = mOf(nd), w = SD.winnerOf(m), [x, y] = P(nd.m, nd.c);
    if (w) {
      const gone = out.has(w); setF(ctx, 900, 25, F.en); const tw = ctx.measureText(w).width, cw = tw + 58, chh = 44;
      ctx.save(); rr(ctx, x - cw / 2, y - chh / 2, cw, chh, 8);
      ctx.shadowColor = gone ? 'rgba(0,0,0,0)' : `rgba(${rgb},.6)`; ctx.shadowBlur = gone ? 0 : 22;
      ctx.fillStyle = gone ? '#0d1636' : `rgb(${rgb})`; ctx.fill(); ctx.shadowBlur = 0;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(4,8,23,.85)'; ctx.stroke();
      if (gone) { rr(ctx, x - cw / 2 + 1.5, y - chh / 2 + 1.5, cw - 3, chh - 3, 7); ctx.lineWidth = 2; ctx.strokeStyle = `rgba(${rgb},.3)`; ctx.stroke(); }
      ctx.restore();
      logo(ctx, A.img[w], w, x - cw / 2 + 6 + 17, y, 34, gone);
      ctx.fillStyle = gone ? 'rgba(255,255,255,.55)' : div === 'W' ? '#0b1240' : '#141006'; setF(ctx, 900, 25, F.en); ctx.textAlign = 'left';
      ctx.fillText(w, x - cw / 2 + 46, y + 9);
      return;
    }
    if (!m) return;
    const live = m.status === 'live', t = when(m);
    if (!live && !t) return;
    if (V && nd.h) pill(ctx, x, y - 15 - 28, live ? 'LIVE' : t, live); else pill(ctx, x, y + 15, live ? 'LIVE' : t, live);
  });

  // ----- 가운데: 트로피 + 결승 · FINAL (우승이 정해지면 우승 학급 · CHAMPION) -----
  const cx = W / 2, th = V ? 210 : 330, ttop = V ? 822 : (o.C0 + o.C1) / 2 - 250;
  ctx.save(); ctx.translate(cx, ttop + th * 0.45); ctx.scale(1, 1.25);
  const gg = ctx.createRadialGradient(0, 0, 0, 0, 0, th * 0.62); gg.addColorStop(0, `rgba(${rgb},${champ ? 0.45 : 0.28})`); gg.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = gg; ctx.fillRect(-th, -th, th * 2, th * 2); ctx.restore();
  if (A.trophy) {
    const tw = (A.trophy.naturalWidth / A.trophy.naturalHeight) * th;
    ctx.save(); ctx.shadowColor = `rgba(${rgb},${champ ? 0.9 : 0.5})`; ctx.shadowBlur = champ ? 46 : 28;
    ctx.drawImage(A.trophy, cx - tw / 2, ttop, tw, th); ctx.restore();
  }
  let ty = ttop + th;
  ctx.textAlign = 'center';
  if (champ) {
    const ls = V ? 46 : 56; setF(ctx, 700, V ? 30 : 34, F.ko); const nm = SD.classLabel(champ), nw = ctx.measureText(nm).width, tot = ls + 10 + nw;
    logo(ctx, A.img[champ], champ, cx - tot / 2 + ls / 2, ty + 20 + ls / 2, ls, false);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(nm, cx - tot / 2 + ls + 10, ty + 20 + ls / 2 + 11); ctx.textAlign = 'center';
    ty += 20 + ls;
    ctx.save(); ctx.fillStyle = `rgb(${rgb})`; ctx.shadowColor = `rgba(${rgb},.7)`; ctx.shadowBlur = 18; setF(ctx, 800, V ? 28 : 32, F.en); K.spaced(ctx, 'CHAMPION', cx, ty + (V ? 34 : 42), V ? 7 : 8); ctx.restore();
    const pk = SD.pkScore(finM);
    if (!V) { ctx.fillStyle = 'rgba(255,255,255,.62)'; setF(ctx, 500, 18, F.ko);
      ctx.fillText(`결승 ${finM.scoreH}:${finM.scoreA}${pk ? ` (PK ${pk.join(':')})` : ''} · ${champ === finM.home ? finM.away : finM.home}`, cx, ty + 76); }
  } else {
    ctx.fillStyle = '#fff'; setF(ctx, 500, V ? 34 : 40, F.ko); K.spaced(ctx, '결승', cx, ty + (V ? 40 : 52), V ? 3 : 4);
    ctx.fillStyle = 'rgba(255,255,255,.7)'; setF(ctx, 800, V ? 28 : 32, F.en); K.spaced(ctx, 'FINAL', cx, ty + (V ? 72 : 92), V ? 7 : 8);
    const live = finM && finM.status === 'live', t = when(finM);
    if (live || t) pill(ctx, cx, ty + (V ? 84 : 106), live ? 'LIVE' : t, live);
  }

  // ----- 바닥 -----
  if (st.footer) { ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.42)'; setF(ctx, 500, 22, F.ko); ctx.fillText(st.footer, cx, V ? 1640 : 1040); }
}

// ---------- 준비(그림 · 글꼴) ----------
async function render(st) {
  if (st.kind === 'cover') return renderCover(st);
  const classes = (st.bracket.slots || []).filter(Boolean);
  const img = {};
  const [brand, trophy] = await Promise.all([K.loadImg('logos/brand.webp'), K.loadImg(KO.TROPHY || 'media/trophy.webp'),
    ...classes.map(async c => { const u = SD.logoUrl(c); img[c] = u ? await K.loadImg(u) : null; })]);
  const text = `${DIV_LABEL[st.div]} 토너먼트 16강 8강 4강 결승 1회전 대진표 학년 반 조 위 팀 일정 미정 월화수목금토일 () ${classes.map(SD.classLabel).join(' ')} ${st.footer || ''} 0123456789:/ABCDEFGHIJKLMNOPQRSTUVWXYZ`;
  try {
    await Promise.all([
      document.fonts.load(`400 60px ${F.kr}`, text),
      document.fonts.load(`700 26px ${F.ko}`, text), document.fonts.load(`600 24px ${F.ko}`, text), document.fonts.load(`500 40px ${F.ko}`, text),
      document.fonts.load(`900 32px ${F.en}`, '0123456789()-'), document.fonts.load(`800 22px ${F.en}`, 'KNOCKOUTSTAGEFINALCHAMPIONNOWKICK-OFF'),
      document.fonts.load(`700 22px ${F.en}`, ((st.L.sp && st.L.sp.league) || 'SEONGDEOK FUTSAL CHAMPIONS LEAGUE').toUpperCase()),
    ]);
  } catch (e) { /* system fonts */ }
  const c = document.createElement('canvas');
  c.width = st.orient === 'v' ? 1080 : 1920; c.height = st.orient === 'v' ? 1920 : 1080;
  draw(c.getContext('2d'), st, { img, brand, trophy });
  return c;
}


// ---------- 표지: 대진표 이미지 사이(또는 앞)에 넣는 가로 1920×1080. 체육회 로고 + 리그 이름 + 토너먼트 대진표 (한글 · 영어) ----------
const WD_KO = '일월화수목금토', WD_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
function coverInfo(L) {
  const info = SD.divList(L.sp).filter(d => S.brackets[`${L.sid}-${d}`]).map(div => {
    const b = S.brackets[`${L.sid}-${div}`], n = (b.slots || []).filter(Boolean).length;
    return { div, n, size: b.size, bye: n < b.size };
  });
  const first = L.matches.filter(m => m.ko && m.date).map(m => m.date).sort()[0] || '';
  return { info, first };
}
// 양옆에 희미한 대진 선(남자부 금색 · 여자부 파랑)이 가운데를 향해 모인다
function ghostBracket(ctx, side, rgb, W, H) {
  ctx.save(); ctx.strokeStyle = `rgba(${rgb},.16)`; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  const dir = side ? -1 : 1, x0 = side ? W - 60 : 60, top = 250, bot = 840;
  let ys = Array.from({ length: 8 }, (_, i) => top + ((bot - top) / 8) * (i + 0.5)), x = x0;
  ys.forEach(y => { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + dir * 60, y); ctx.stroke(); });
  x = x0 + dir * 60;
  for (let r = 0; r < 3; r++) {
    const nx = x + dir * 75, next = [];
    for (let i = 0; i < ys.length; i += 2) {
      const a = ys[i], b = ys[i + 1], m = (a + b) / 2;
      ctx.beginPath(); ctx.moveTo(x, a); ctx.lineTo(nx, a); ctx.lineTo(nx, b); ctx.lineTo(x, b); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(nx, m); ctx.lineTo(nx + dir * 30, m); ctx.stroke();
      next.push(m);
    }
    ys = next; x = nx + dir * 30;
  }
  ctx.restore();
}
function chip(ctx, x, y, text, rgb, px) {
  setF(ctx, 600, px, F.ko); const w = ctx.measureText(text).width + px * 1.6, h = px * 2.1;
  rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = 'rgba(6,10,28,.78)'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = rgb ? `rgba(${rgb},.85)` : 'rgba(255,255,255,.4)'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(text, x + w / 2, y + h / 2 + px * 0.36);
  return w;
}
function chipsRow(ctx, items, cy, px) {
  setF(ctx, 600, px, F.ko);
  const ws = items.map(([t]) => ctx.measureText(t).width + px * 1.6), gap = 18, tot = ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
  let x = 960 - tot / 2;
  items.forEach(([t, rgb], i) => { chip(ctx, x, cy - px * 1.05, t, rgb, px); x += ws[i] + gap; });
}
function drawCover(ctx, st, A) {
  const W = 1920, H = 1080, EN = st.lang === 'en', { info, first } = coverInfo(st.L);
  ctx.fillStyle = '#02040b'; ctx.fillRect(0, 0, W, H);
  let g = ctx.createRadialGradient(W / 2, H * 1.2, 0, W / 2, H * 1.2, W * 0.95);
  g.addColorStop(0, '#10245e'); g.addColorStop(0.5, '#060c22'); g.addColorStop(1, '#02040b'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  [[0.2, ACC.M, 0.2], [0.8, ACC.W, 0.22], [0.5, '255,255,255', 0.05]].forEach(([fx, rgb, a]) => {
    ctx.save(); ctx.translate(W * fx, H * 0.52); ctx.scale(W * 0.42, H * 0.62);
    const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1); rg.addColorStop(0, `rgba(${rgb},${a})`); rg.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = rg; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
  });
  if (ctx.createConicGradient) {
    const cg = ctx.createConicGradient(-0.4, W / 2, H * 0.5);
    [[0, 0], [0.07, 0], [0.09, 'rgba(255,255,255,.05)'], [0.12, 0], [0.32, 0], [0.35, 'rgba(255,255,255,.04)'], [0.38, 0], [0.57, 0], [0.6, 'rgba(255,255,255,.05)'], [0.63, 0], [0.82, 0], [0.85, 'rgba(255,255,255,.04)'], [0.88, 0], [1, 0]]
      .forEach(([p, c]) => cg.addColorStop(p, c || 'rgba(0,0,0,0)'));
    ctx.fillStyle = cg; ctx.fillRect(0, 0, W, H);
  }
  let sd = 23; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 130; i++) { ctx.globalAlpha = 0.15 + rnd() * 0.5; ctx.beginPath(); ctx.arc(rnd() * W, rnd() * H, 0.6 + rnd() * 1.3, 0, 6.29); ctx.fill(); }
  ctx.globalAlpha = 1;
  ghostBracket(ctx, 0, ACC.M, W, H); ghostBracket(ctx, 1, ACC.W, W, H);

  // 체육회 로고
  const cx = W / 2;
  const lg = ctx.createRadialGradient(cx, 205, 0, cx, 205, 220); lg.addColorStop(0, 'rgba(255,255,255,.13)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = lg; ctx.fillRect(cx - 240, 0, 480, 430);
  if (A.brand) { const s = 220, r = Math.min(s / A.brand.naturalWidth, s / A.brand.naturalHeight), w = A.brand.naturalWidth * r, h = A.brand.naturalHeight * r; ctx.drawImage(A.brand, cx - w / 2, 205 - h / 2, w, h); }

  const goldBlue = (x0, x1) => { const gg = ctx.createLinearGradient(x0, 0, x1, 0); gg.addColorStop(0, `rgb(${ACC.M})`); gg.addColorStop(0.5, '#FFF4D6'); gg.addColorStop(1, `rgb(${ACC.W})`); return gg; };
  const rules = (y, half) => {
    ctx.save(); ctx.lineWidth = 2; ctx.lineCap = 'round';
    [[cx - half - 240, cx - half - 24, ACC.M, 1], [cx + half + 24, cx + half + 240, ACC.W, 0]].forEach(([a, b, rgb, inward]) => {
      const lgd = ctx.createLinearGradient(a, 0, b, 0); lgd.addColorStop(inward ? 0 : 1, `rgba(${rgb},0)`); lgd.addColorStop(inward ? 1 : 0, `rgba(${rgb},.95)`);
      ctx.strokeStyle = lgd; ctx.shadowColor = `rgba(${rgb},.8)`; ctx.shadowBlur = 10; ctx.beginPath(); ctx.moveTo(a, y); ctx.lineTo(b, y); ctx.stroke();
    });
    ctx.restore();
  };
  const year = (first || SD.todayStr()).slice(0, 4);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  if (EN) {
    ctx.fillStyle = 'rgba(255,255,255,.66)'; setF(ctx, 700, 26, F.en); const hw = K.spaced(ctx, `${year} SEASON  ·  KNOCKOUT STAGE`, cx, 384, 7) / 2;
    rules(375, hw);
    ctx.save(); ctx.shadowColor = 'rgba(160,190,255,.5)'; ctx.shadowBlur = 36; ctx.fillStyle = '#fff'; setF(ctx, 900, 124, F.en);
    K.spaced(ctx, 'SEONGDEOK FUTSAL', cx, 522, 6); K.spaced(ctx, 'CHAMPIONS LEAGUE', cx, 642, 6); ctx.restore();
    setF(ctx, 900, 70, F.en); const tw = ctx.measureText('TOURNAMENT BRACKET').width + 17 * 12;
    ctx.save(); ctx.fillStyle = goldBlue(cx - tw / 2, cx + tw / 2); ctx.shadowColor = 'rgba(255,220,140,.35)'; ctx.shadowBlur = 24; K.spaced(ctx, 'TOURNAMENT BRACKET', cx, 738, 12); ctx.restore();
    const items = info.map(x => [`${x.div === 'M' ? 'MEN' : 'WOMEN'}  ·  ${x.bye ? `${x.n} TEAMS` : `ROUND OF ${x.size}`}`, ACC[x.div]]);
    if (first) { const d = new Date(first + 'T00:00:00'); items.push([`KICK-OFF  ·  ${WD_EN[d.getDay()]} ${K.MON[d.getMonth()]} ${d.getDate()}`, null]); }
    chipsRow(ctx, items, 832, 26);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,.66)'; setF(ctx, 700, 26, F.en); const hw = K.spaced(ctx, ((st.L.sp && st.L.sp.league) || `${year} SEONGDEOK FUTSAL CHAMPIONS LEAGUE`).toUpperCase(), cx, 384, 6) / 2;
    rules(375, hw);
    ctx.save(); ctx.shadowColor = 'rgba(160,190,255,.5)'; ctx.shadowBlur = 36; ctx.fillStyle = '#fff'; K.fitFont(ctx, '성덕 풋살 챔피언스리그', 1500, 400, 112, F.kr); ctx.fillText('성덕 풋살 챔피언스리그', cx, 540); ctx.restore();
    setF(ctx, 400, 100, F.kr); const tw = ctx.measureText('토너먼트 대진표').width + 6 * 10;
    ctx.save(); ctx.fillStyle = goldBlue(cx - tw / 2, cx + tw / 2); ctx.shadowColor = 'rgba(255,220,140,.35)'; ctx.shadowBlur = 24; K.spaced(ctx, '토너먼트 대진표', cx, 680, 10); ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.7)'; setF(ctx, 800, 24, F.en); K.spaced(ctx, 'KNOCKOUT STAGE', cx, 736, 12);
    const items = info.map(x => [`${DIV_LABEL[x.div]} ${x.bye ? `${x.n}팀` : SD.ROUND_NAME(x.size)}`, ACC[x.div]]);
    if (first) { const d = new Date(first + 'T00:00:00'); items.push([`${d.getMonth() + 1}월 ${d.getDate()}일(${WD_KO[d.getDay()]}) 킥오프`, null]); }
    chipsRow(ctx, items, 828, 26);
  }
  if (st.footer) { ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.42)'; setF(ctx, 500, 22, F.ko); ctx.fillText(st.footer, cx, 1030); }
}
async function renderCover(st) {
  const brand = await K.loadImg('logos/brand.webp');
  const text = `성덕 풋살 챔피언스리그 토너먼트 대진표 남자부 여자부 16강 8강 팀 월 일 킥오프 ${WD_KO} () 0123456789 ${st.footer || ''}`;
  try {
    await Promise.all([document.fonts.load(`400 100px ${F.kr}`, text), document.fonts.load(`600 26px ${F.ko}`, text), document.fonts.load(`500 22px ${F.ko}`, text),
      document.fonts.load(`900 120px ${F.en}`, 'SEONGDEOKFUTSALCHAMPIONSLEAGUETOURNAMENTBRACKET'), document.fonts.load(`800 24px ${F.en}`, 'KNOCKOUTSTAGE'),
      document.fonts.load(`700 26px ${F.en}`, `0123456789 SEASON KNOCKOUT STAGE ${((st.L.sp && st.L.sp.league) || '').toUpperCase()}`)]);
  } catch (e) { /* system fonts */ }
  const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
  drawCover(c.getContext('2d'), st, { brand });
  return c;
}

// ---------- 화면 ----------
const sigOf = st => st.kind === 'cover' ? JSON.stringify([st.lang, st.footer, coverInfo(st.L), st.L.sp && st.L.sp.league]) : JSON.stringify([st.orient, st.footer, st.bracket.slots, st.L.matches.filter(m => m.ko && m.bracket === `${st.L.sid}-${st.div}`)
  .map(m => [m.id, m.home, m.away, m.scoreH, m.scoreA, m.status, m.date, m.time, m.pk, m.pkH, m.pkA])]);
function Card({ st, guides, onOpen, onShot }) {
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
  return html`<figure class=${'story kb-card ' + st.orient}>
    <button type="button" class="story-frame" aria-label=${st.title + ' 크게 보기'} disabled=${!ok} onClick=${onOpen}>
      ${ok ? html`<img src=${shot.url} alt=${st.title} />` : html`<div class="story-wait">${shot ? '이미지를 만들지 못했습니다' : '그리는 중…'}</div>`}
      ${guides && st.orient === 'v' ? html`<i class="safe t"></i><i class="safe b"></i>` : null}
      ${ok ? html`<span class="story-zoom" aria-hidden="true"><${Icon} n="search" size=${16} /></span>` : null}</button>
    <figcaption><b>${st.title}</b><span>${st.sub}</span><${K.SaveBtn} shot=${shot} file=${st.file} /></figcaption>
  </figure>`;
}
function Zoom({ st, shot, onClose, guides }) {
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    const ov = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ov; };
  }, []);
  return html`<div class="lb" role="dialog" aria-modal="true" aria-label="대진표 크게 보기" onClick=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <button type="button" class="lb-x" aria-label="닫기" onClick=${onClose}><${Icon} n="close" size=${22} /></button>
    <figure class=${'lb-fig kb-zoom ' + st.orient}>
      <div class="kb-zimg">${shot && shot.url !== 'err' ? html`<img src=${shot.url} alt=${st.title} />` : html`<div class="story-wait">그리는 중…</div>`}
        ${guides && st.orient === 'v' ? html`<i class="safe t"></i><i class="safe b"></i>` : null}</div>
      <figcaption><div><b>${st.title}</b><span>${st.sub}</span></div><${K.SaveBtn} shot=${shot} file=${st.file} big=${true} /></figcaption>
    </figure>
  </div>`;
}
function Panel({ L, guides, footerText }) {
  const [zoom, setZoom] = useState(null);
  const [shots, setShots] = useState({});
  const divs = SD.divList(L.sp).filter(d => S.brackets[`${L.sid}-${d}`]);
  if (!divs.length) return html`<section class="panel"><${Empty} title="토너먼트 대진이 아직 없습니다">토너먼트 화면에서 대진을 확정하면 부별 대진표 이미지가 여기에 만들어집니다.</${Empty}></section>`;
  const stamp = SD.todayStr().replace(/-/g, '');
  const rows = divs.map(div => {
    const bracket = S.brackets[`${L.sid}-${div}`];
    const base = { L, div, bracket, footer: footerText };
    return { div, items: [
      { ...base, key: div + 'v', orient: 'v', title: `${DIV_LABEL[div]} 대진표 · 스토리`, sub: '세로 1080×1920 · 인스타 스토리', file: `SDSCL_${stamp}_${DIV_LABEL[div]}_대진표_스토리.jpg` },
      { ...base, key: div + 'h', orient: 'h', title: `${DIV_LABEL[div]} 대진표 · 가로`, sub: '가로 1920×1080 · 피드 · 카톡 · 게시판', file: `SDSCL_${stamp}_${DIV_LABEL[div]}_대진표_가로.jpg` },
    ] };
  });
  const cover = [['ko', '한글'], ['en', '영어']].map(([lang, label]) => ({ L, kind: 'cover', lang, orient: 'h', footer: footerText, key: 'c' + lang,
    title: `표지 · ${label}`, sub: '가로 1920×1080 · 두 대진표 사이나 앞에', file: `SDSCL_${stamp}_대진표_표지_${label}.jpg` }));
  const onShot = (k, s) => setShots(x => ({ ...x, [k]: s }));
  const all = [...cover, ...rows.flatMap(r => r.items)], zst = zoom && all.find(x => x.key === zoom);
  return html`<div class="kb-wrap">
    <section class="kb-row"><h3>표지 <span class="small muted">· 체육회 로고와 리그 이름 · 스토리에서 두 대진표 사이에 넣기 좋아요</span></h3>
      <div class="kb-grid cover">${cover.map(st => html`<${Card} key=${st.key} st=${st} guides=${false} onShot=${onShot} onOpen=${() => setZoom(st.key)} />`)}</div></section>
    ${rows.map(r => html`<section class="kb-row" key=${r.div}><h3 class=${'div-head ' + r.div}>${DIV_LABEL[r.div]}</h3>
      <div class="kb-grid">${r.items.map(st => html`<${Card} key=${st.key} st=${st} guides=${guides} onShot=${onShot} onOpen=${() => setZoom(st.key)} />`)}</div></section>`)}
    ${zst ? html`<${Zoom} st=${zst} shot=${shots[zst.key]} guides=${guides} onClose=${() => setZoom(null)} />` : null}
  </div>`;
}

window.KOSNS = { Panel, render, draw, geom, available: () => !SD.VIEWER };
})();
