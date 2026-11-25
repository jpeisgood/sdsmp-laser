/* SDSMP shared UI pieces. */
(function () {
'use strict';
const { h } = preact;
const { useState, useEffect, useRef } = preactHooks;
const html = htm.bind(h);
const { S, DIV_LABEL, fmtDate } = SD;

// ---------- icons (24px stroke set) ----------
const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  pin: 'M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  record: 'M9 4h6l1 2h3v15H5V6h3zM9 11h6M9 15h4',
  table: 'M3 5h18v14H3zM3 10h18M3 14.5h18M9 5v14',
  ball: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5l3.6 2.6-1.4 4.3H9.8L8.4 10.1zM12 3v4.5M15.6 10.1l4.9-1.3M14.2 14.4l2.9 4.2M9.8 14.4l-2.9 4.2M8.4 10.1 3.5 8.8',
  trophy: 'M7 4h10v4a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6v4H9z',
  bracket: 'M3 5h5v4H3zM3 15h5v4H3zM8 7h3v10H8M11 12h4M15 10h6v4h-6z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M18 14.5a6 6 0 0 1 4 5.5v1',
  card: 'M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM10 8h4',
  tv: 'M3 5h18v12H3zM8 21h8M12 17v4',
  save: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4.2-4.2',
  sign: 'M3 17c2.5-2.5 4.5-8.5 6.5-8.5 2.5 0-.5 8.5 2 8.5 1.8 0 2.8-3.5 4.6-3.5 1 0 1.2 1.6 2.9 1.6M3 21h18',
  story: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 7.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM16.5 5h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'M15 5l-7 7 7 7',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  ban: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  shuffle: 'M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3',
  play: 'M7 4.5v15l12-7.5z',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  prev: 'M18 5v14L8 12zM6 5v14',
  next: 'M6 5v14l10-7zM18 5v14',
  grip: 'M9 6h.5M14.5 6h.5M9 12h.5M14.5 12h.5M9 18h.5M14.5 18h.5',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  stop: 'M7 7h10v10H7z',
  vol: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  pause: 'M8 5v14M16 5v14',
  whistle: 'M9 9h12v4a6 6 0 1 1-12 0zM9 9 5 5M12 12h.01',
  timer: 'M12 8v5l3 2M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM9 2h6',
  goal: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5l3.6 2.6-1.4 4.3H9.8L8.4 10.1z',
  chev: 'M9 5l7 7-7 7',
  link2: 'M8 12h8M6 8a4 4 0 0 0 0 8M18 8a4 4 0 0 1 0 8',
};
const Icon = ({ n, size }) => html`<svg viewBox="0 0 24 24" width=${size || 18} height=${size || 18} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${P[n]} /></svg>`;

// ---------- logo: stadium LED dot-matrix "SD", S in men's gold, D in women's blue ----------
const GLYPH = {
  S: ['.###.', '#...#', '#....', '.###.', '....#', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
};
// The committee emblem (대한성덕체육회) is the platform mark; the LED "SD" below stays as the fallback.
function Logo({ size = 46 }) {
  return html`<img class="brand-logo" src="logos/brand.webp" width=${size} height=${size} alt="대한성덕체육회" />`;
}
function LedLogo({ size = 46 }) {
  const cell = 4, padX = 6, padY = 7, cols = 11, rows = 7;
  const w = cols * cell + padX * 2, hh = rows * cell + padY * 2;
  const dots = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const gi = x < 5 ? 0 : x > 5 ? 1 : -1;
    const on = gi >= 0 && GLYPH[gi ? 'D' : 'S'][y][gi ? x - 6 : x] === '#';
    dots.push(html`<circle cx=${padX + x * cell + cell / 2} cy=${padY + y * cell + cell / 2} r="1.5" fill=${on ? (gi ? '#7D96FF' : '#F2B705') : '#1C2753'} />`);
  }
  return html`<svg viewBox=${`0 0 ${w} ${hh}`} width=${size} height=${Math.round(size * hh / w)} role="img" aria-label="SDSMP 로고">
    <rect x="0.75" y="0.75" width=${w - 1.5} height=${hh - 1.5} rx="7" fill="#081130" stroke="#2B3A75" stroke-width="1.5" />${dots}
    <circle cx=${w - 5} cy="5" r="1.6" fill="#FF4D5B" /></svg>`;
}

// ---------- team logo: the class crest, or a monogram until one is added ----------
function TeamLogo({ cls, div, size = 28 }) {
  const url = cls ? SD.logoUrl(cls) : null;
  const sz = typeof size === 'number' ? size + 'px' : size; // TV passes em sizes
  const st = `width:${sz};height:${sz}`;
  if (url) return html`<span class="tlogo" style=${st}><img src=${url} alt=${cls + ' 로고'} /></span>`;
  // No crest yet: a plain shield with the grade number, so the class name isn't printed twice.
  const grade = cls ? String(cls).split('-')[0] : '';
  return html`<span class=${'tlogo mono ' + (div || '')} style=${st} aria-hidden="true"><svg viewBox="0 0 40 44">
    <path d="M20 2 36 8v13c0 10-7 17-16 21C11 38 4 31 4 21V8z" /><text x="20" y="27" text-anchor="middle">${grade || '?'}</text></svg></span>`;
}
function TeamName({ cls, div, size }) {
  return html`<span class="tname-inline"><${TeamLogo} cls=${cls} div=${div} size=${size || 22} /><b>${cls || '미정'}</b></span>`;
}

// ---------- small atoms ----------
const DivTag = ({ div, group }) => html`<span class=${'chip ' + (div === 'M' ? 'men' : 'women')}>${DIV_LABEL[div]}${group ? ` ${group}조` : ''}</span>`;
// Re-renders itself once a second while a half is running; the rest of the page stays still.
function useTick(on, ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => { if (!on) return; const t = setInterval(() => set(x => x + 1), ms); return () => clearInterval(t); }, [on, ms]);
}
// "전반 03:12" for a running match, "하프타임" at the break, '' before kick-off.
function ClockText({ m }) {
  const c = m.clock;
  useTick(!!(c && c.run));
  if (!c || !c.ph || c.ph === 'FT') return null;
  if (c.ph === 'HT') return '하프타임';
  return `${SD.PH_LABEL[c.ph]} ${SD.fmtMS(SD.clockMs(m))}`;
}
// compact: short "LIVE" chip with the running time on a small line under it (for tight match rows).
function StatusChip({ m, compact }) {
  const ck = m.clock && m.clock.ph && m.clock.ph !== 'FT';
  if (m.status === 'live' && compact) return html`<span class="st-stack"><span class="chip live">LIVE</span>${ck ? html`<span class="mclock"><${ClockText} m=${m} /></span>` : null}</span>`;
  if (m.status === 'live') return html`<span class="chip live">LIVE${ck ? html` <span class="num">· <${ClockText} m=${m} /></span>` : null}</span>`;
  if (m.status === 'final') return html`<span class="chip final">종료됨</span>`;
  return html`<span class="chip">${m.date ? '예정' : '미편성'}</span>`;
}
const CardIco = ({ t }) => html`<i class=${'cardico ' + (t === 'R' ? 'r' : 'y')} aria-label=${t === 'R' ? '레드카드' : '옐로카드'}></i>`;
const stageLabel = m => (m.stage === 'group' ? `${m.group}조 ${m.seq}경기` : `${m.stage || '추가 경기'}${m.ko ? ` ${m.seq}경기` : ''}`);
const LaserTag = () => html`<span class="chip lr" title="레이저런 리그 참가 반">LR</span>`;

function Empty({ title, children }) {
  return html`<div class="empty"><strong>${title}</strong>${children ? html`<span>${children}</span>` : null}</div>`;
}
function Seg({ value, options, onChange, label }) {
  return html`<div class="seg" role="group" aria-label=${label || ''}>${options.map(o => html`
    <button type="button" class=${o.cls || ''} aria-pressed=${String(value === o.value)} onClick=${() => onChange(o.value)}>${o.label}</button>`)}</div>`;
}
function DivSeg({ value, onChange, divs }) {
  return html`<${Seg} label="부문" value=${value} onChange=${onChange}
    options=${(divs || ['M', 'W']).map(d => ({ value: d, label: DIV_LABEL[d], cls: d === 'M' ? 'men' : 'women' }))} />`;
}
// Two-step destructive button: first click arms it, second click within 4s performs.
function ConfirmBtn({ onConfirm, children, armedText, cls, disabled }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  return html`<button type="button" disabled=${disabled} class=${'btn btn-sm btn-danger ' + (armed ? 'armed ' : '') + (cls || '')}
    onClick=${() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>${armed ? (armedText || '한 번 더 눌러 확인') : children}</button>`;
}
function Modal({ title, onClose, children, foot, wide, cls }) {
  useEffect(() => { const k = e => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  return html`<div class="modal-wrap" onClick=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <div class=${'modal' + (cls ? ' ' + cls : '')} style=${wide ? 'width:min(760px,100%)' : ''} role="dialog" aria-modal="true" aria-label=${title}>
      <div class="panel-head"><h3>${title}</h3><div class="end"><button class="icon-btn" aria-label="닫기" onClick=${onClose}><${Icon} n="close" /></button></div></div>
      <div class="panel-body stack">${children}</div>
      ${foot ? html`<div class="panel-head" style="border-top:1px solid var(--line-2);border-bottom:0"><div class="end">${foot}</div></div>` : null}
    </div></div>`;
}
// Pick one name from a fixed list (referees, recorders). A name saved earlier that is no longer on the list still shows.
function StaffSelect({ id, list, value, onChange, placeholder, disabled }) {
  const opts = !value || list.includes(value) ? list : [...list, value];
  return html`<select id=${id} class="select" disabled=${disabled} value=${value || ''} onChange=${e => onChange(e.target.value)}>
    <option value="">${placeholder || '선택'}</option>${opts.map(v => html`<option value=${v}>${v}</option>`)}</select>`;
}
function VenueSelect({ L, value, onChange, id, disabled }) {
  value = SD.venueName(value);
  const opts = L.venues.includes(value) || !value ? L.venues : [...L.venues, value];
  return html`<select id=${id} class="select" aria-label="구장" disabled=${disabled} value=${value || ''} onChange=${e => onChange(e.target.value)}>
    <option value="">구장 선택</option>${opts.map(v => html`<option value=${v}>${v}</option>`)}</select>`;
}

// ---------- sky layer: glass footballs drifting across, fine twinkles behind ----------
// Colours come from CSS tokens (--star, --star-a) so it follows the light/dark theme; the TV passes tv for its brighter set.
const PHI = (1 + Math.sqrt(5)) / 2;
// Classic football = truncated icosahedron: 60 vertices, 90 edges, 12 pentagon panels.
const BALL = (() => {
  const cyc = ([x, y, z]) => [[x, y, z], [y, z, x], [z, x, y]];
  const signs = (v) => { const out = [[]]; v.forEach(c => { const nx = []; out.forEach(o => { nx.push([...o, c]); if (c) nx.push([...o, -c]); }); out.splice(0, out.length, ...nx); }); return out; };
  const base = [[0, 1, 3 * PHI], [1, 2 + PHI, 2 * PHI], [PHI, 2, 2 * PHI + 1]];
  const raw = []; base.forEach(b => signs(b).forEach(v => cyc(v).forEach(c => raw.push(c))));
  const key = v => v.map(n => n.toFixed(4)).join(',');
  const seen = new Set(), V = [];
  raw.forEach(v => { const k = key(v); if (!seen.has(k)) { seen.add(k); V.push(v); } });
  const R = Math.hypot(...V[0]);
  const P = V.map(v => v.map(n => n / R));
  const E = [];
  for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) { const d = Math.hypot(V[i][0] - V[j][0], V[i][1] - V[j][1], V[i][2] - V[j][2]); if (Math.abs(d - 2) < 1e-3) E.push([i, j]); }
  const axes = []; signs([0, 1, PHI]).forEach(v => cyc(v).forEach(c => { const n = Math.hypot(...c); axes.push(c.map(x => x / n)); }));
  const uniq = []; axes.forEach(a => { if (!uniq.some(u => Math.abs(u[0] - a[0]) + Math.abs(u[1] - a[1]) + Math.abs(u[2] - a[2]) < 1e-6)) uniq.push(a); });
  const F = uniq.map(ax => {
    const near = P.map((p, i) => [p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2], i]).sort((x, y) => y[0] - x[0]).slice(0, 5).map(x => x[1]);
    const u = Math.abs(ax[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const e1 = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]]; const n1 = Math.hypot(...e1); e1.forEach((x, k) => { e1[k] = x / n1; });
    const e2 = [ax[1] * e1[2] - ax[2] * e1[1], ax[2] * e1[0] - ax[0] * e1[2], ax[0] * e1[1] - ax[1] * e1[0]];
    near.sort((i, j) => Math.atan2(P[i][0] * e2[0] + P[i][1] * e2[1] + P[i][2] * e2[2], P[i][0] * e1[0] + P[i][1] * e1[1] + P[i][2] * e1[2]) - Math.atan2(P[j][0] * e2[0] + P[j][1] * e2[1] + P[j][2] * e2[2], P[j][0] * e1[0] + P[j][1] * e1[1] + P[j][2] * e1[2]));
    return { ax, vs: near };
  });
  return { P, E, F };
})();
function rotPts(pts, a, b) { // rotate around y by a, then around x by b
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  return pts.map(([x, y, z]) => { const x1 = x * ca + z * sa, z1 = -x * sa + z * ca; return [x1, y * cb - z1 * sb, y * sb + z1 * cb]; });
}
function drawBall(ctx, cx, cy, R, a, b, tone, al, tv) {
  const P = rotPts(BALL.P, a, b);
  // glass body
  const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R);
  g.addColorStop(0, `rgba(255,255,255,${0.16 * al})`); g.addColorStop(0.45, `rgba(${tone},${0.07 * al})`); g.addColorStop(1, `rgba(${tone},${0.02 * al})`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill();
  // pentagon panels, front ones a touch stronger
  for (const f of BALL.F) {
    const nz = P[f.vs[0]][2] + P[f.vs[1]][2] + P[f.vs[2]][2] + P[f.vs[3]][2] + P[f.vs[4]][2];
    const front = nz / 5;
    ctx.beginPath(); f.vs.forEach((i, k) => { const q = P[i]; ctx[k ? 'lineTo' : 'moveTo'](cx + q[0] * R, cy + q[1] * R); }); ctx.closePath();
    ctx.fillStyle = `rgba(${tv ? '150,190,255' : tone},${(front > 0 ? 0.05 + 0.16 * front : 0.025) * al})`; ctx.fill();
  }
  // seams: back first, faint; front bright with a prism tint on the TV
  const es = BALL.E.map(([i, j]) => [i, j, (P[i][2] + P[j][2]) / 2]).sort((x, y) => x[2] - y[2]);
  ctx.lineCap = 'round';
  for (const [i, j, z] of es) {
    const d = (z + 1) / 2, A = (0.12 + 0.88 * d * d) * al;
    let col = tone;
    if (tv && z > 0) { const hx = (P[i][0] + P[j][0]) / 2; col = hx < -0.35 ? '126,232,255' : hx > 0.45 ? '255,150,225' : '235,242,255'; }
    ctx.strokeStyle = `rgba(${col},${A})`; ctx.lineWidth = z > 0 ? (tv ? 1.5 : 1.2) : 0.8;
    ctx.beginPath(); ctx.moveTo(cx + P[i][0] * R, cy + P[i][1] * R); ctx.lineTo(cx + P[j][0] * R, cy + P[j][1] * R); ctx.stroke();
  }
  // rim light
  ctx.strokeStyle = `rgba(${tv ? '170,205,255' : tone},${0.35 * al})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();
}
// Shooting stars: mean seconds between two (적게 / 보통 / 많게).
const METEOR_GAP = { low: 3.4, mid: 1.6, high: 0.7 };
function StarField({ tv, balls: ballsOn = true, meteors = false, amt = 'mid', speed = 'mix' }) {
  const ref = useRef(null), opt = useRef(null);
  opt.current = { ballsOn, meteors, amt, speed }; // read every frame, so settings apply without a restart
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !cv.getContext) return;
    const ctx = cv.getContext('2d');
    // the TV is signage: it keeps moving even when its computer asks for reduced motion
    const still = !tv && window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, raf = 0, last = 0, tone = '96,128,255', amp = 0.5, toneAt = 0, glints = [], balls = [], mets = [], nextAt = 0;
    const readTone = () => { const cs = getComputedStyle(cv); tone = (cs.getPropertyValue('--star') || '').trim() || tone; amp = Number(cs.getPropertyValue('--star-a')) || amp; };
    const glint = () => ({ x: Math.random() * w, y: Math.random() * h * 0.8, r: 0.6 + Math.random() * (tv ? 1.6 : 1.3), a: 0.3 + Math.random() * 0.6, ph: Math.random() * 6.28, sp: 0.6 + Math.random() * 1.4 });
    // Balls drift across the upper part of the screen and wrap around; each turns slowly on its own.
    const mkBalls = () => {
      const n = tv ? 3 : 2, out = [];
      for (let i = 0; i < n; i++) {
        const big = i === 0;
        const R = Math.max(tv ? 8 : 26, Math.min(w, h) * (big ? (tv ? 0.1 : 0.075) : (tv ? 0.055 : 0.045)) * (0.9 + Math.random() * 0.2)); // TV scale holds in the small settings preview too
        out.push({ R, x: (w / n) * (i + 0.3 + Math.random() * 0.4), y0: h * (0.14 + Math.random() * (tv ? 0.3 : 0.32)), vx: (big ? 7 : 12) * (Math.random() < 0.5 ? -1 : 1),
          bob: 6 + Math.random() * 12, ph: Math.random() * 6.28, a: Math.random() * 6.28, b: Math.random() * 6.28, va: 0.12 + Math.random() * 0.15, vb: 0.05 + Math.random() * 0.08,
          al: (big ? 0.75 : 0.55) * (tv ? 1 : 0.9) });
      }
      return out;
    };
    // One shooting star: slow ones drift across with a short tail, fast ones streak with a long one.
    const spawn = t => {
      const o = opt.current;
      const fast = o.speed === 'fast' ? true : o.speed === 'slow' ? false : Math.random() < 0.45;
      const dir = Math.random() < 0.78 ? -1 : 1, rad = ((fast ? 26 : 20) + Math.random() * 18) * Math.PI / 180;
      const v = (fast ? 0.95 + Math.random() * 0.65 : 0.12 + Math.random() * 0.12) * h; // px / s
      mets.push({ x0: dir < 0 ? w * (0.3 + Math.random() * 0.8) : w * (-0.1 + Math.random() * 0.8), y0: h * (-0.06 + Math.random() * 0.4),
        vx: Math.cos(rad) * v * dir, vy: Math.sin(rad) * v, len: (fast ? 0.2 + Math.random() * 0.16 : 0.08 + Math.random() * 0.07) * h,
        born: t, life: fast ? 0.65 + Math.random() * 0.5 : 3.2 + Math.random() * 2.6, wid: Math.max(0.6, h / 1080) * ((fast ? 2 : 1.5) + Math.random() * (tv ? 1.2 : 0.7)) });
    };
    const drawMeteors = t => {
      if (!mets.length) return;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      mets = mets.filter(m => {
        const age = (t - m.born) / 1000, p = age / m.life;
        if (p >= 1) return false;
        const a = Math.min(1, p / 0.12) * (1 - Math.max(0, (p - 0.62) / 0.38)) * Math.min(1, amp + 0.25);
        const hx = m.x0 + m.vx * age, hy = m.y0 + m.vy * age, sp = Math.hypot(m.vx, m.vy) || 1;
        const L = m.len * Math.min(1, age / 0.3), tx = hx - (m.vx / sp) * L, ty = hy - (m.vy / sp) * L;
        const g = ctx.createLinearGradient(hx, hy, tx, ty);
        g.addColorStop(0, `rgba(255,255,255,${0.95 * a})`); g.addColorStop(0.18, `rgba(${tone},${0.6 * a})`); g.addColorStop(1, `rgba(${tone},0)`);
        ctx.strokeStyle = g; ctx.lineWidth = m.wid; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
        const r = m.wid * 4.5, rg = ctx.createRadialGradient(hx, hy, 0, hx, hy, r);
        rg.addColorStop(0, `rgba(255,255,255,${0.9 * a})`); rg.addColorStop(0.4, `rgba(${tone},${0.35 * a})`); rg.addColorStop(1, `rgba(${tone},0)`);
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(hx, hy, r, 0, 6.2832); ctx.fill();
        return true;
      });
      ctx.restore();
    };
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1); const r = cv.getBoundingClientRect(); w = r.width; h = r.height;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      glints = Array.from({ length: tv ? Math.round(90 * Math.max(0.35, Math.min(1, w * h / 600000))) : 44 }, glint); balls = mkBalls(); // fewer in the small settings preview
    };
    const draw = t => {
      ctx.clearRect(0, 0, w, h);
      for (const s of glints) {
        const al = s.a * (0.5 + 0.5 * Math.sin(t / 1000 * s.sp + s.ph)) * amp;
        ctx.fillStyle = `rgba(${tone},${al})`; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.2832); ctx.fill();
        if (tv && s.r > 1.6) { ctx.strokeStyle = `rgba(${tone},${al * 0.5})`; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(s.x - s.r * 3, s.y); ctx.lineTo(s.x + s.r * 3, s.y); ctx.moveTo(s.x, s.y - s.r * 3); ctx.lineTo(s.x, s.y + s.r * 3); ctx.stroke(); }
      }
      if (opt.current.ballsOn) for (const b of balls) drawBall(ctx, b.x, b.y0 + Math.sin(t / 2600 + b.ph) * b.bob, b.R, b.a, b.b, tone, b.al * amp, tv);
      drawMeteors(t);
    };
    const step = t => {
      raf = requestAnimationFrame(step);
      const o = opt.current;
      // shooting stars need every frame to stay smooth; the slow drift alone is fine at ~30 fps
      if (t - last < (mets.length ? 14 : 33)) return;
      const dt = Math.min(0.1, (t - last) / 1000); last = t;
      if (t - toneAt > 2000) { readTone(); toneAt = t; }
      if (o.meteors && t >= nextAt) {
        if (nextAt) spawn(t);
        nextAt = t + -Math.log(1 - Math.random()) * (METEOR_GAP[o.amt] || METEOR_GAP.mid) * 1000;
      }
      for (const b of balls) {
        b.x += b.vx * dt; b.a += b.va * dt; b.b += b.vb * dt;
        if (b.vx > 0 && b.x - b.R > w) b.x = -b.R; else if (b.vx < 0 && b.x + b.R < 0) b.x = w + b.R;
      }
      draw(t);
    };
    readTone(); size();
    const ro = window.ResizeObserver ? new ResizeObserver(() => { size(); draw(performance.now()); }) : null;
    if (ro) ro.observe(cv); else window.addEventListener('resize', size);
    const vis = () => { cancelAnimationFrame(raf); if (!document.hidden && !still) { last = performance.now(); raf = requestAnimationFrame(step); } };
    document.addEventListener('visibilitychange', vis);
    draw(0); vis();
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', vis); if (ro) ro.disconnect(); else window.removeEventListener('resize', size); };
  }, []);
  return html`<canvas class=${'starfield' + (tv ? ' tv-stars' : '')} ref=${ref} aria-hidden="true"></canvas>`;
}

// ---------- small month calendar: days with matches carry a dot and a count ----------
const WD_SHORT = ['일', '월', '화', '수', '목', '금', '토'];
function MiniCal({ value, onPick, marks, onClose }) {
  const today = SD.todayStr();
  const base = value || today;
  const [ym, setYm] = useState(() => base.slice(0, 7));
  const box = useRef(null);
  useEffect(() => {
    const down = e => { if (box.current && !box.current.contains(e.target) && !e.target.closest('[data-cal-toggle]')) onClose(); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', down); window.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down); window.removeEventListener('keydown', key, true); };
  }, []);
  const [y, mo] = ym.split('-').map(Number);
  const first = new Date(y, mo - 1, 1), days = new Date(y, mo, 0).getDate();
  const shift = d => { const t = new Date(y, mo - 1 + d, 1); setYm(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`); };
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(html`<span class="mc-blank"></span>`);
  for (let d = 1; d <= days; d++) {
    const ds = `${ym}-${String(d).padStart(2, '0')}`, mk = marks[ds];
    const cls = 'mc-day' + (ds === value ? ' sel' : '') + (ds === today ? ' today' : '') + (mk ? ' has' : '') + (mk && mk.live ? ' live' : '');
    cells.push(html`<button type="button" class=${cls} aria-pressed=${String(ds === value)} aria-label=${`${mo}월 ${d}일${mk ? ` 경기 ${mk.n}개` : ''}`} onClick=${() => onPick(ds)}>
      <span>${d}</span>${mk ? html`<i>${mk.n}</i>` : null}</button>`);
  }
  const monthDays = Object.keys(marks).filter(k => k.startsWith(ym)).length;
  return html`<div class="minical" ref=${box} role="dialog" aria-label="날짜 선택">
    <div class="mc-head"><button type="button" class="icon-btn" aria-label="이전 달" onClick=${() => shift(-1)}><${Icon} n="back" /></button>
      <b>${y}년 ${mo}월</b><button type="button" class="icon-btn" aria-label="다음 달" onClick=${() => shift(1)}><span style="display:inline-grid;transform:scaleX(-1)"><${Icon} n="back" /></span></button></div>
    <div class="mc-grid">${WD_SHORT.map((w, i) => html`<span class=${'mc-wd' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '')}>${w}</span>`)}${cells}</div>
    <div class="mc-foot"><span class="small muted">${monthDays ? `이 달 경기일 ${monthDays}일` : '이 달에는 경기가 없습니다'}</span><span class="spacer"></span>
      <button type="button" class="btn btn-sm" onClick=${() => onPick(today)}>오늘</button><button type="button" class="btn btn-sm" onClick=${() => onPick('')}>전체 날짜</button></div>
  </div>`;
}

// ---------- ring diagram: teams on the drawn polygon, edges = the ring fixtures ----------
function ringPos(n, w, hh) {
  const cx = w / 2, cy = hh / 2 + 2;
  if (n === 4) { const dx = w * 0.27, dy = hh * 0.27; return [[cx - dx, cy - dy], [cx + dx, cy - dy], [cx + dx, cy + dy], [cx - dx, cy + dy]]; }
  const r = Math.min(w, hh) * 0.33;
  return Array.from({ length: n }, (_, i) => { const a = (-90 - i * 360 / n) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
}
function RingDiagram({ teams, matches, w = 120, hh = 100 }) {
  const n = teams.length;
  if (n < 2) return null;
  const pos = ringPos(n, w, hh);
  const pairs = SD.ringPairs(teams);
  const edgeOf = (a, b) => matches.find(m => (m.home === a && m.away === b) || (m.home === b && m.away === a));
  return html`<svg class="ring" viewBox=${`0 0 ${w} ${hh}`} role="img" aria-label=${'링크전 대진: ' + pairs.map(p => p.join('–')).join(', ')}>
    ${pairs.map(([a, b]) => {
      const i = teams.indexOf(a), j = teams.indexOf(b), m = edgeOf(a, b);
      const cls = 'edge ' + (m ? (m.status === 'final' ? 'final' : m.status === 'live' ? 'live' : m.date ? 'sched' : '') : '');
      const tip = m ? `${m.home} ${m.status === 'scheduled' ? 'vs' : `${m.scoreH}:${m.scoreA}`} ${m.away} · ${fmtDate(m.date)}` : '';
      return html`<line class=${cls} x1=${pos[i][0]} y1=${pos[i][1]} x2=${pos[j][0]} y2=${pos[j][1]}><title>${tip}</title></line>`;
    })}
    ${teams.map((t, i) => {
      const [x, y] = pos[i];
      const top = y < hh / 2 + 2;
      return html`<g><circle class="node" cx=${x} cy=${y} r="4.5" />
        <text x=${x} y=${top ? y - 8 : y + 15} text-anchor="middle">${t}</text>
        <text class="idx" x=${x} y=${y + 2.8} text-anchor="middle">${i + 1}</text></g>`;
    })}
  </svg>`;
}

// ---------- standings table (top N advance get the gold row) ----------
function GroupTable({ div, data, compact, adv }) {
  const gd = r => { const v = r.gf - r.ga; return v > 0 ? '+' + v : String(v); };
  if (!data.matches.some(m => m.status === 'final')) adv = 0; // nothing to highlight before the first result
  return html`<div class="scroll-x"><table class="tbl">
    <thead><tr><th>#</th><th class="l">팀</th><th>경기</th>${compact ? null : html`<th>승</th><th>무</th><th>패</th><th>득</th><th>실</th>`}<th>득실</th><th title="페어플레이 점수">FP</th><th>승점</th></tr></thead>
    <tbody>${data.rows.map(r => html`<tr class=${adv && r.rank <= adv ? 'adv' : ''}>
      <td class="rank">${r.rank}</td>
      <td class="l"><span class="team-cell"><${TeamLogo} cls=${r.cls} div=${div} size=${24} /><b>${r.cls}</b>${r.laser ? html`<${LaserTag} />` : null}${r.live ? html`<span class="chip live" style="height:18px;font-size:10px">LIVE</span>` : null}</span></td>
      <td>${r.p}</td>
      ${compact ? null : html`<td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf}</td><td>${r.ga}</td>`}
      <td>${gd(r)}</td>
      <td style=${r.fp < 0 ? 'color:var(--card-r);font-weight:700' : ''}>${r.fp}</td>
      <td class="pts">${r.pts}</td></tr>`)}</tbody></table></div>`;
}

// ---------- match row ----------
function SuspChips({ m, L, max }) {
  const list = (L.suspByMatch[m.id] || []);
  const bans = [m.home, m.away].filter(Boolean).flatMap(c => (L.playersByTeam[SD.tkey(m.div, c)] || []).filter(p => L.banOf(p)));
  if (!list.length && !bans.length) return null;
  const items = [
    ...list.map(e => { const p = S.players[e.pid]; return p ? html`<span class="chip warn" title=${`${e.type === 'R' ? '레드' : '옐로'}카드 출전정지 ${e.nth}/${e.total}`}><${CardIco} t=${e.type} /> ${p.cls} ${p.name} 출전정지${e.total > 1 ? ` ${e.nth}/${e.total}` : ''}</span>` : null; }),
    ...bans.map(p => html`<span class="chip ban">${p.cls} ${p.name} 영구 출전 금지</span>`),
  ].filter(Boolean);
  return html`<div class="susp-line">${max && items.length > max ? [...items.slice(0, max), html`<span class="chip">+${items.length - max}</span>`] : items}</div>`;
}
// 특이사항: suspended / banned players for this match and the match memo, in one small box under the match.
function MatchNotes({ m, L }) {
  const list = (L.suspByMatch[m.id] || []).map(e => ({ e, p: S.players[e.pid] })).filter(x => x.p);
  const bans = [m.home, m.away].filter(Boolean).flatMap(c => (L.playersByTeam[SD.tkey(m.div, c)] || []).filter(p => L.banOf(p)));
  const note = String(m.note || '').trim();
  if (!list.length && !bans.length && !note) return null;
  return html`<div class="mnotes"><span class="mn-h">특이사항</span><div class="mn-list">
    ${list.map(({ e, p }) => html`<span class="mn-item"><${CardIco} t=${e.type} /><b>${p.cls} ${p.name}</b> ${e.type === 'R' ? '레드' : '옐로'}카드 출전정지${e.total > 1 ? ` ${e.nth}/${e.total}` : ''}</span>`)}
    ${bans.map(p => html`<span class="mn-item ban"><b>${p.cls} ${p.name}</b> 영구 출전 금지</span>`)}
    ${note ? html`<span class="mn-item memo" title=${note}>메모 · ${note}</span>` : null}</div></div>`;
}
function Score({ m }) {
  if (m.status === 'scheduled') return html`<span class="sc pending">vs</span>`;
  const pk = SD.pkScore(m);
  return html`<span class="sc">${m.scoreH}:${m.scoreA}${pk ? html`<small class="pk-note">PK ${pk[0]}:${pk[1]}</small>` : null}</span>`;
}
function winSide(m) {
  const w = SD.winnerOf(m);
  return !w ? 0 : w === m.home ? -1 : 1;
}
function MatchRow({ m, L, onOpen, showDate, end, long, cls, logo }) {
  const ws = winSide(m);
  const nm = c => (long ? SD.classLabel(c) : c || '미정');
  const ls = logo || 44;
  return html`<div class=${'mrow' + (onOpen ? ' click' : '') + (cls ? ' ' + cls : '')} onClick=${onOpen ? () => onOpen(m.id) : null}>
    <div class="when">${showDate ? html`<span>${fmtDate(m.date)}</span>` : null}<b>${m.time || (m.date ? '--:--' : '미정')}</b>${showDate ? null : html`<span>${SD.venueName(m.venue) || '구장 미정'}</span>`}</div>
    <div style="min-width:0">
      <div class="vs"><span class=${'t h ' + (ws > 0 ? 'lz' : '')}><b>${nm(m.home)}</b><${TeamLogo} cls=${m.home} div=${m.div} size=${ls} /></span><${Score} m=${m} /><span class=${'t ' + (ws < 0 ? 'lz' : '')}><${TeamLogo} cls=${m.away} div=${m.div} size=${ls} /><b>${nm(m.away)}</b></span></div>
      <div class="mmeta" style="justify-content:center"><${DivTag} div=${m.div} /><span>${stageLabel(m)}</span>${showDate && m.venue ? html`<span>· ${SD.venueName(m.venue)}</span>` : null}</div>
    </div>
    <div class="end">${end || html`<${StatusChip} m=${m} compact=${true} />`}</div>
    <${MatchNotes} m=${m} L=${L} />
  </div>`;
}

// ---------- personal rankings (gold / silver / bronze rows) ----------
const KIND = { g: ['득점', '골'], a: ['어시스트', '어시스트'], mvp: ['MVP', '점'] };
function RankList({ L, div, kind = 'g', limit, onPlayer }) {
  const src = kind === 'a' ? L.assists : kind === 'mvp' ? L.mvp : L.scorers;
  const list = src[div].slice(0, limit || 999);
  if (!list.length) return html`<${Empty} title=${`아직 ${KIND[kind][0]} 기록이 없습니다`}>경기 기록에서 선수별로 입력하면 자동으로 집계됩니다.</${Empty}>`;
  return html`<div class="ranklist">${list.map(r => html`
    <button type="button" class=${'rk-row ' + (r.rank <= 3 ? 'rk-' + r.rank : 'rk-n')} onClick=${onPlayer ? () => onPlayer(r.p.id) : null}>
      <span class="rk">${r.rank}</span><${TeamLogo} cls=${r.p.cls} div=${div} size=${30} />
      <span class="nm">${r.p.name}<small>${r.p.cls} · ${L.groupOf(div, r.p.cls) || '-'}조</small></span>
      <span class="val">${r.v}<small>${KIND[kind][1]}</small>${kind === 'mvp' ? html`<em>${r.g}골 ${r.a}어시스트</em>` : null}</span>
    </button>`)}</div>`;
}

// ---------- player card (opened from any ranking) ----------
function PlayerCard({ pid, L, onClose }) {
  useEffect(() => { const k = e => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const p = S.players[pid];
  if (!p) return null;
  const s = L.pst[pid] || { g: 0, a: 0, y: 0, r: 0, fp: 0, mvp: 0, log: [] };
  const susp = L.suspByPlayer[pid];
  const ban = L.banOf(p);
  const grp = L.groupOf(p.div, p.cls);
  const rk = [['득점', L.rankOf(L.scorers[p.div], pid)], ['어시스트', L.rankOf(L.assists[p.div], pid)], ['MVP', L.rankOf(L.mvp[p.div], pid)]].filter(x => x[1]);
  const tiles = [['골', s.g], ['어시스트', s.a], ['MVP 포인트', s.mvp], ['옐로', s.y], ['레드', s.r], ['페어플레이', s.fp]];
  const partners = ((L.chem && L.chem[p.div]) || []).filter(c => c.x === pid || c.y === pid).slice(0, 4)
    .map(c => { const mine = c.x === pid; return { o: mine ? c.py : c.px, n: c.n, got: mine ? c.xy : c.yx, gave: mine ? c.yx : c.xy }; });
  return html`<div class="modal-wrap pc-wrap" onClick=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <div class=${'pcard ' + p.div} role="dialog" aria-modal="true" aria-label=${p.name + ' 선수 카드'}>
      <button class="icon-btn pc-x" aria-label="닫기" onClick=${onClose}><${Icon} n="close" /></button>
      <div class="pc-top">
        <${TeamLogo} cls=${p.cls} div=${p.div} size=${112} />
        <div class="pc-id"><span class="pc-div">${DIV_LABEL[p.div]} ${grp ? grp + '조' : ''} · ${p.cls}</span>
          <h2>${p.name}</h2>
          <div class="row">${rk.map(([k, v]) => html`<span class=${'chip ' + (v <= 3 ? 'medal m' + v : '')}>${k} ${v}위</span>`)}
            ${susp && susp.active ? html`<span class="chip warn">출전 정지</span>` : null}${ban ? html`<span class="chip ban">영구 출전 금지</span>` : null}</div></div>
      </div>
      <div class="pc-stats">${tiles.map(([k, v]) => html`<div><b class=${k === '페어플레이' && v < 0 ? 'neg' : ''}>${v}</b><span>${k}</span></div>`)}</div>
      ${partners.length ? html`<div class="pc-chem"><div class="small muted" style="font-weight:600">골 합작 파트너</div>
        <div class="row">${partners.map(x => html`<span class="pc-mate"><b>${x.o.name}</b> ${x.n}골<small>${x.got ? `받은 어시스트 ${x.got}` : ''}${x.got && x.gave ? ' · ' : ''}${x.gave ? `준 어시스트 ${x.gave}` : ''}</small></span>`)}</div></div>` : null}
      <div class="pc-log">
        <div class="small muted" style="font-weight:600">경기별 기록</div>
        ${s.log.length ? s.log.map(x => html`<div class="pc-logrow"><span class="muted">${fmtDate(x.m.date)}</span><span>${x.m.home} vs ${x.m.away} <span class="muted small">${stageLabel(x.m)}</span></span>
          <span class="row" style="justify-content:flex-end">${x.g ? html`<b>${x.g}골</b>` : null}${x.a ? html`<b>${x.a}어시스트</b>` : null}${x.y ? html`<${CardIco} t="Y" />` : null}${x.r ? html`<${CardIco} t="R" />` : null}</span></div>`)
          : html`<p class="muted small">아직 기록이 없습니다.</p>`}
      </div>
    </div></div>`;
}

// Notices: ordinary ones slide in at the corner; warnings and errors pop up in the middle of the screen
// (with a little bounce) so they are seen at once. A tap on the card closes it early.
const POP = k => k === 'warn' || k === 'err';
function Toasts() {
  const pops = S.toasts.filter(t => POP(t.kind)), top = pops[pops.length - 1];
  return html`<div class="toasts" role="status" aria-live="polite">${S.toasts.filter(t => !POP(t.kind)).map(t => html`<div key=${t.id} class=${'toast ' + (t.kind || '')}>${t.msg}</div>`)}</div>
    <div class="alert-pop" role="alert" aria-live="assertive">${top ? html`<button type="button" key=${top.id} class=${'alert-card ' + top.kind} style=${`--life:${top.life}ms`} onClick=${() => SD.dropToast(top.id)}>
      <span class="alert-ic" aria-hidden="true">!</span><span class="alert-msg">${top.msg}</span><span class="alert-ok">눌러서 닫기</span></button>` : null}</div>`;
}
// 레이저런 블랙·레드 배경: 아래에서 붉은 빛이 일렁이고, 빛의 물결선이 천천히 흘러간다 (CSS 애니메이션만 사용).
function Waves({ page }) {
  return html`<div class=${'lr-waves' + (page ? ' page' : '')} aria-hidden="true"><i class="w1"></i><i class="w2"></i><i class="w3"></i><i class="w4"></i><b class="l1"></b><b class="l2"></b></div>`;
}

window.UI = { html, Icon, Logo, useTick, ClockText, MiniCal, StarField, StaffSelect, TeamLogo, TeamName, DivTag, StatusChip, CardIco, LaserTag, stageLabel, Empty, Seg, DivSeg, ConfirmBtn, Modal, VenueSelect,
  RingDiagram, GroupTable, SuspChips, MatchNotes, MatchRow, Score, winSide, RankList, PlayerCard, Toasts, Waves, KIND };
})();
