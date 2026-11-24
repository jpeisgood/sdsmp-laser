/* SDSMP 토너먼트 추첨 방송 (토너먼트 › 「추첨 방송」).
   방송실 PC 화면을 그대로 각 반 TV로 내보내면서 번호를 하나씩 눌러 뽑는다:
   번호 → 그 자리에 들어갈 수 있는 학급(로고) → 「추첨하기」 → 가운데 슬롯이 띠로리로 돌다가 천천히 멈춤 → 자리에 들어감.
   규칙: 같은 조끼리는 첫 경기에서 만나지 않는다(부전승 자리는 처음 만나는 상대 기준). 뒤에서 막히는 일이 없도록
   남은 자리를 모두 채울 수 있는 학급만 후보로 보여 준다. 진행 상황은 이 기기에 저장돼 새로고침해도 이어진다.
   다 뽑으면 「대진 확정」으로 토너먼트 경기를 만든다(토너먼트 화면의 대진 확정과 같은 동작).
   원본 SDSMP 전용 — 둘러보기 복사본에서는 열리지 않는다. */
(function () {
'use strict';
const { useState, useEffect, useRef, useMemo } = preactHooks;
const { html, Icon, TeamLogo } = UI;
const { S, DIV_LABEL, setDoc, logAct, toast } = SD;

const DW = 1920, DH = 1080;
const ACC = { M: '242,183,5', W: '142,164,255' };
const rnd = n => { try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; } catch (e) { return Math.floor(Math.random() * n); } };

// ---------- 대진 모양: 번호(1..n) ↔ 칸(slot), 처음 만나는 상대 ----------
function bracketModel(n) {
  const size = SD.nextPow2(Math.max(2, n)), byes = SD.byeSlots(size, n), R = Math.round(Math.log2(size));
  const pos = [];
  for (let s = 0; s < size; s++) if (!byes.has(s)) pos.push(s);
  const num = new Map(pos.map((s, k) => [s, k]));
  const teamsUnder = (r, i) => { const out = []; for (let s = i << r; s < (i + 1) << r; s++) if (num.has(s)) out.push(num.get(s)); return out; };
  // 첫 상대: 아래 단계부터 올라가며 형제 칸에 팀이 처음 나오는 곳 (부전승이면 한 단계 위)
  const first = pos.map(s => { for (let r = 0; r < R; r++) { const t = teamsUnder(r, (s >> r) ^ 1); if (t.length) return t; } return []; });
  const conf = pos.map(() => new Set());
  first.forEach((list, k) => list.forEach(j => { conf[k].add(j); conf[j].add(k); }));
  return { n, size, byes, R, pos, num, first, conf };
}

// 이 번호에 넣을 수 있는 학급: 같은 조 첫 대결이 아니고, 넣은 뒤에도 남은 자리를 모두 채울 수 있어야 한다.
function candidates(M, quals, assign, k) {
  const G = {}; quals.forEach(q => { G[q.cls] = q.group; });
  const clash = (j, a, g) => { for (const x of M.conf[j]) if (a[x] && G[a[x]] === g) return true; return false; };
  const solvable = a => {
    const pool = quals.filter(q => !a.includes(q.cls)), open = [];
    a.forEach((c, j) => { if (!c) open.push(j); });
    const go = (todo, left) => {
      if (!todo.length) return true;
      let bj = -1, bo = null;
      for (const j of todo) { const o = left.filter(q => !clash(j, a, q.group)); if (!o.length) return false; if (!bo || o.length < bo.length) { bj = j; bo = o; } }
      const rest = todo.filter(j => j !== bj);
      for (const q of bo) { a[bj] = q.cls; const ok = go(rest, left.filter(x => x !== q)); a[bj] = ''; if (ok) return true; }
      return false;
    };
    return go(open, pool);
  };
  const ok = [], no = [];
  quals.forEach(q => {
    if (assign.includes(q.cls)) return;
    if (clash(k, assign, q.group)) { no.push({ q, why: 'group' }); return; }
    const a = assign.slice(); a[k] = q.cls;
    if (solvable(a)) ok.push(q); else no.push({ q, why: 'later' });
  });
  return { ok, no };
}

// ---------- 화면 배치 (1920×1080 기준) ----------
const TOP = 214, BOT = 876, CW = 340, LX = 56, FX = 790, FW = 340;
function layout(M) {
  const ch = M.n > 12 ? 66 : 80;
  const leaf = {};
  [0, 1].forEach(h => {
    const list = M.pos.filter(s => (s < M.size / 2) === (h === 0));
    const step = (BOT - TOP) / Math.max(1, list.length);
    list.forEach((s, i) => {
      const cy = TOP + step * (i + 0.5), x = h === 0 ? LX : DW - LX - CW;
      leaf[s] = { k: M.num.get(s), h, x, y: cy - ch / 2, w: CW, ch, ax: h === 0 ? x + CW : x, ay: cy };
    });
  });
  const gap = (FX - (LX + CW)) / M.R;
  const colX = (h, r) => (h === 0 ? LX + CW + r * gap : DW - LX - CW - r * gap);
  const lines = [], junc = [], cols = {};
  const rec = (r, i) => {
    if (r === 0) return leaf[i] ? { x: leaf[i].ax, y: leaf[i].ay, slots: [i] } : null;
    const a = rec(r - 1, 2 * i), b = rec(r - 1, 2 * i + 1);
    if (!a || !b) return a || b;
    const h = (i << r) < M.size / 2 ? 0 : 1;
    const nd = { x: colX(h, r), y: (a.y + b.y) / 2, r, h, slots: [...a.slots, ...b.slots] };
    lines.push({ a, b: nd, slots: a.slots }, { a: b, b: nd, slots: b.slots });
    junc.push(nd); (cols[h + ':' + r] ||= nd.x);
    return nd;
  };
  const roots = [rec(M.R - 1, 0), rec(M.R - 1, 1)];
  const fy = (TOP + BOT) / 2;
  roots.forEach((rt, h) => { if (rt) lines.push({ a: rt, b: { x: h === 0 ? FX : FX + FW, y: fy }, slots: rt.slots }); });
  const labels = Object.entries(cols).map(([key, x]) => {
    const r = Number(key.split(':')[1]);
    return { x, text: r === 1 && M.byes.size ? '1회전' : SD.ROUND_NAME(M.size / 2 ** (r - 1)) };
  });
  return { leaf, lines, junc, labels, ch, fy };
}

// ---------- 효과음 (Web Audio로 직접 만든다 — 파일 없음) ----------
const Sfx = {
  on: SD.ls.get('kdSound', true), ac: null, master: null, lastTick: 0,
  ctx() {
    if (!this.on) return null;
    if (!this.ac) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      this.ac = new C(); this.master = this.ac.createGain(); this.master.gain.value = 0.7; this.master.connect(this.ac.destination);
    }
    if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
    return this.ac;
  },
  tone(f, t, dur, type, vol, f2) {
    const ac = this.ctx(); if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.03);
  },
  tick(i) { // 띠-로-리-로
    const ac = this.ctx(); if (!ac) return;
    const now = ac.currentTime; if (now - this.lastTick < 0.028) return; this.lastTick = now;
    this.tone([1568, 1319, 1175, 1319][i % 4], now, 0.06, 'square', 0.06);
  },
  ding() {
    const ac = this.ctx(); if (!ac) return;
    const t = ac.currentTime + 0.01;
    this.tone(1760, t, 1.7, 'sine', 0.28); this.tone(2637, t, 1.1, 'sine', 0.09); this.tone(3520, t, 0.6, 'sine', 0.05);
  },
  fanfare(big) {
    const ac = this.ctx(); if (!ac) return;
    const t = ac.currentTime + 0.18, notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, t + i * 0.1, 0.2, 'triangle', 0.16));
    const end = t + notes.length * 0.1;
    (big ? [523, 659, 784, 1047, 1319] : [784, 1047]).forEach(f => this.tone(f, end, big ? 1.6 : 0.8, 'triangle', 0.09));
    if (big) [1047, 1319, 1568].forEach((f, i) => this.tone(f, end + 0.45 + i * 0.09, 0.5, 'square', 0.035));
  },
  pop() { const ac = this.ctx(); if (!ac) return; this.tone(380, ac.currentTime, 0.14, 'sine', 0.22, 920); },
  start() { const ac = this.ctx(); if (!ac) return; const t = ac.currentTime; [392, 523, 659].forEach((f, i) => this.tone(f, t + i * 0.06, 0.12, 'square', 0.05)); },
};

// ---------- 꽃가루 ----------
function confetti(cv, rgb) {
  if (!cv) return;
  const g = cv.getContext('2d'), cols = [`rgb(${rgb})`, '#FFFFFF', '#FFD34D', '#7CF2B5', '#FF8FA3', '#9DB0FF'];
  const ps = Array.from({ length: 190 }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, v = 10 + Math.random() * 16;
    return { x: DW / 2 + (Math.random() - 0.5) * 300, y: DH * 0.42, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4,
      w: 10 + Math.random() * 12, h: 6 + Math.random() * 8, c: cols[(Math.random() * cols.length) | 0] };
  });
  const t0 = performance.now();
  const step = now => {
    const t = now - t0;
    g.clearRect(0, 0, DW, DH);
    if (t > 3200) return;
    ps.forEach(p => {
      p.vy += 0.42; p.vx *= 0.992; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.globalAlpha = Math.max(0, 1 - t / 3200);
      g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2))); g.restore();
    });
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// 슬롯 둘레 전구
const BULBS = (() => {
  const out = [], per = [11, 6, 11, 6];
  per.forEach((n, side) => {
    for (let i = 0; i < n; i++) {
      const p = (i + 0.5) / n;
      out.push(side === 0 ? [p * 100, 0] : side === 1 ? [100, p * 100] : side === 2 ? [100 - p * 100, 100] : [0, 100 - p * 100]);
    }
  });
  return out;
})();

const IH = 160; // 슬롯 한 줄 높이 (창은 세 줄)

function DrawShow({ L, div, canEdit, onClose }) {
  const quals = useMemo(() => SD.qualifiers(L, div), [L, div]);
  const n = quals.length;
  const M = useMemo(() => bracketModel(n), [n]);
  const lay = useMemo(() => layout(M), [M]);
  const Q = useMemo(() => Object.fromEntries(quals.map(q => [q.cls, q])), [quals]);
  const sig = quals.map(q => q.cls + q.group + q.rank).join('|');
  const key = `kdraw.${L.sid}-${div}`;
  const [st, setSt] = useState(() => { const v = SD.ls.get(key, null); return v && v.sig === sig && Array.isArray(v.a) && v.a.length === n ? v : { sig, a: Array(n).fill(''), hist: [] }; });
  const [phase, setPhase] = useState('board'); // board → pick → spin → reveal → board
  const [cur, setCur] = useState(null);         // { k, ok, no, pick, items }
  const [ghost, setGhost] = useState(null);
  const [just, setJust] = useState(null);
  const [scale, setScale] = useState(1);
  const [sound, setSound] = useState(Sfx.on);
  const [armReset, setArmReset] = useState(false);
  const [armOk, setArmOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(0);
  const root = useRef(null), strip = useRef(null), cv = useRef(null), cv2 = useRef(null), finale = useRef(false);
  const rgb = ACC[div] || ACC.M;
  const filled = st.a.filter(Boolean).length, complete = n > 0 && filled === n;
  const next = st.a.findIndex(c => !c);

  useEffect(() => { SD.ls.set(key, st); }, [st]);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / DW, window.innerHeight / DH));
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  useEffect(() => { if (!armReset) return; const t = setTimeout(() => setArmReset(false), 4000); return () => clearTimeout(t); }, [armReset]);
  useEffect(() => { if (!armOk) return; const t = setTimeout(() => setArmOk(false), 4000); return () => clearTimeout(t); }, [armOk]);
  // 마지막 자리가 채워지면 한 번 크게 축하
  useEffect(() => {
    if (complete && phase === 'board' && !finale.current) { finale.current = true; setTimeout(() => { Sfx.fanfare(true); confetti(cv2.current, rgb); }, 500); }
    if (!complete) finale.current = false;
  }, [complete, phase]);

  const open = k => {
    if (phase !== 'board' || st.a[k]) return;
    const c = candidates(M, quals, st.a, k);
    setCur({ k, ...c }); setPhase('pick'); Sfx.start();
  };
  const spin = () => {
    if (phase !== 'pick' || !cur || !cur.ok.length) return;
    const ok = cur.ok, pick = ok[rnd(ok.length)];
    // 릴: 후보를 섞어 여러 바퀴 돌린 뒤 뽑힌 학급에서 멈춘다(바로 앞 칸은 다른 학급).
    const N = ok.length === 1 ? 14 : 34 + rnd(ok.length * 2);
    const items = [];
    let prev = null;
    for (let i = 0; i < N; i++) {
      const pool = ok.length > 1 ? ok.filter(q => q !== prev) : ok;
      const q = pool[rnd(pool.length)]; items.push(q); prev = q;
    }
    if (ok.length > 1 && items[N - 1] === pick) items[N - 1] = ok.find(q => q !== pick);
    items.push(pick, ok.length > 1 ? ok.find(q => q !== pick) : pick);
    setCur({ ...cur, pick, items, stop: N });
    setPhase('spin');
  };
  // 회전: 처음엔 빠르게, 끝에는 한 칸씩 느리게 → 살짝 지나쳤다가 제자리로
  useEffect(() => {
    if (phase !== 'spin' || !cur || !strip.current) return;
    const el = strip.current, stop = cur.stop, fast = window.__kdFast, T = fast ? 120 : cur.ok.length === 1 ? 2200 : 5600, back = fast ? 40 : 520, over = 0.34;
    let raf = 0, last = -1;
    const t0 = performance.now();
    const place = p => { el.style.transform = `translate3d(0,${IH - p * IH}px,0)`; };
    const step = now => {
      const t = now - t0;
      let p;
      if (t < T) { const x = t / T; p = (1 - Math.pow(1 - x, 4)) * (stop + over); }
      else if (t < T + back) { const x = (t - T) / back; p = stop + over * (0.5 + Math.cos(Math.PI * x) / 2); }
      else p = stop;
      place(p);
      const i = Math.floor(p + 0.5);
      if (i > last) { if (last >= 0) Sfx.tick(i); last = i; }
      if (t < T + back) raf = requestAnimationFrame(step);
      else {
        setPhase('reveal'); setFlash(f => f + 1); Sfx.ding(); setTimeout(() => Sfx.fanfare(false), 260);
        confetti(cv.current, rgb);
      }
    };
    place(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase]);
  const commit = () => {
    if (phase !== 'reveal' || !cur) return;
    const { k, pick } = cur, lf = lay.leaf[M.pos[k]];
    setGhost({ k, cls: pick.cls, x: lf.x, y: lf.y, w: lf.w, h: lf.ch, fx: DW / 2 - (lf.x + lf.w / 2), fy: DH / 2 - (lf.y + lf.ch / 2) });
    setPhase('board'); setCur(null);
    setTimeout(() => {
      setSt(s => { const a = s.a.slice(); a[k] = pick.cls; return { ...s, a, hist: [...s.hist, k] }; });
      setGhost(null); setJust(k); Sfx.pop();
      setTimeout(() => setJust(j => (j === k ? null : j)), 900);
    }, 700);
  };
  const undo = () => {
    if (phase !== 'board' || !st.hist.length) return;
    const k = st.hist[st.hist.length - 1];
    setSt(s => { const a = s.a.slice(); a[k] = ''; return { ...s, a, hist: s.hist.slice(0, -1) }; });
  };
  const reset = () => {
    if (!armReset) { setArmReset(true); return; }
    setArmReset(false); setSt({ sig, a: Array(n).fill(''), hist: [] });
  };
  const toggleSound = () => { Sfx.on = !Sfx.on; SD.ls.set('kdSound', Sfx.on); setSound(Sfx.on); if (Sfx.on) Sfx.pop(); };
  const full = () => {
    const el = root.current;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (el && el.requestFullscreen) el.requestFullscreen().catch(() => {});
  };
  const exit = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); onClose(); };
  const confirm = async () => {
    if (!complete || saving || !canEdit) return;
    if (!armOk) { setArmOk(true); return; } // 방송 중 실수로 누르지 않게 두 번 눌러 확정
    setArmOk(false); setSaving(true);
    const slots = Array(M.size).fill('');
    M.pos.forEach((s, k) => { slots[s] = st.a[k]; });
    const plan = SD.planBracket(L.sid, div, slots);
    const id = `${L.sid}-${div}`;
    if (!(await setDoc('brackets/' + id, { sport: L.sid, div, size: M.size, slots, createdAt: Date.now(), drawn: 'show' }))) { setSaving(false); return; }
    for (const x of plan.docs) await setDoc('matches/' + x.id, x.doc);
    logAct(`${DIV_LABEL[div]} 토너먼트 대진 확정 (추첨 방송 · ${n}팀)`);
    SD.ls.set(key, null);
    toast('대진을 확정했습니다. 경기 일정에서 날짜를 잡을 수 있습니다.');
    exit();
  };
  useEffect(() => {
    const onKey = e => {
      if (e.key === ' ' || e.key === 'Enter') {
        if (phase === 'pick') { e.preventDefault(); spin(); }
        else if (phase === 'reveal') { e.preventDefault(); commit(); }
        else if (phase === 'board' && next >= 0 && e.key === 'Enter') { e.preventDefault(); open(next); }
      } else if (e.key === 'Escape' && phase === 'pick') { e.preventDefault(); setPhase('board'); setCur(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const title = M.byes.size ? `${DIV_LABEL[div]} 토너먼트 대진 추첨` : `${DIV_LABEL[div]} ${SD.ROUND_NAME(M.size)} 대진 추첨`;
  const tag = q => `${q.group}조 ${q.rank}위`;
  const hotSlots = new Set(st.a.map((c, k) => (c ? M.pos[k] : -1)));
  const firstOpp = k => M.first[k].map(j => (st.a[j] ? `${j + 1}번 ${SD.classLabel(st.a[j])}` : `${j + 1}번`)).join(' 또는 ');
  const path = ln => `M${ln.a.x} ${ln.a.y}H${ln.b.x}V${ln.b.y}`;
  return html`<div class="kd" data-div=${div} ref=${root} style=${'--acc:' + rgb}>
    <div class="kd-bg"></div>
    <div class="kd-stage" style=${'--s:' + scale}>
      <header class="kd-head">
        <div class="kd-brand"><img src="logos/brand.webp" alt="" /><span>${(L.sp && L.sp.league) || 'SEONGDEOK FUTSAL CHAMPIONS LEAGUE'}</span></div>
        <div class="kd-title">${title}<small>KNOCKOUT STAGE DRAW</small></div>
        <div class="kd-prog"><span>추첨</span><b>${filled}</b><span>/ ${n}</span></div>
      </header>
      ${L.stats.groupDone ? null : html`<div class="kd-warn">조별리그가 아직 끝나지 않아 현재 순위로 진출팀을 보여 줍니다</div>`}
      <svg class="kd-svg" viewBox="0 0 ${DW} ${DH}" width=${DW} height=${DH} aria-hidden="true">
        ${lay.lines.map(ln => html`<path d=${path(ln)} class=${ln.slots.length === 1 && hotSlots.has(ln.slots[0]) ? 'hot' : ''} />`)}
        ${lay.junc.map(j => html`<circle cx=${j.x} cy=${j.y} r="7" />`)}
      </svg>
      ${lay.labels.map(lb => html`<span class="kd-rlabel" style=${`left:${lb.x}px;top:${TOP - 64}px`}>${lb.text}</span>`)}
      <span class="kd-rlabel" style=${`left:${FX + FW / 2}px;top:${TOP - 64}px`}>결승</span>
      ${M.pos.map((s, k) => {
        const lf = lay.leaf[s], c = st.a[k], q = c && Q[c];
        return html`<button type="button" key=${k} class=${'kd-slot' + (lf.h ? ' r' : '') + (c ? ' on' : '') + (just === k ? ' pop' : '') + (!c && k === next && phase === 'board' ? ' next' : '')}
          style=${`left:${lf.x}px;top:${lf.y}px;width:${lf.w}px;height:${lf.ch}px`} disabled=${phase !== 'board' || !!c} onClick=${() => open(k)} aria-label=${`${k + 1}번 자리${c ? ' ' + SD.classLabel(c) : ''}`}>
          <span class="kd-no">${k + 1}</span>
          ${c ? html`<span class="kd-team"><${TeamLogo} cls=${c} div=${div} size=${lf.ch - 18} /><b>${SD.classLabel(c)}</b><em>${q ? tag(q) : ''}</em></span>`
            : html`<span class="kd-q">${ghost && ghost.k === k ? '' : '?'}</span>`}
        </button>`;
      })}
      <div class=${'kd-final' + (complete ? ' done' : '')} style=${`left:${FX}px;width:${FW}px;top:${lay.fy - 150}px`}>
        <span class="kd-cup"><${Icon} n="trophy" size=${complete ? 96 : 84} /></span>
        ${complete ? html`<b>대진 완성!</b>
          ${canEdit ? html`<button type="button" class=${'kd-confirm' + (armOk ? ' arm' : '')} disabled=${saving} onClick=${confirm}>${saving ? '저장하는 중…' : armOk ? '한 번 더 누르면 확정' : '대진 확정'}</button>
            <small>확정하면 토너먼트 경기가<br />경기 일정에 만들어집니다</small>` : html`<small>편집자 계정에서<br />대진을 확정할 수 있습니다</small>`}`
          : html`<b>결승</b><span>FINAL</span>`}
      </div>
      <div class="kd-pool">${quals.map(q => {
        const k = st.a.indexOf(q.cls);
        return html`<span class=${'kd-chip' + (k >= 0 ? ' used' : '')} key=${q.cls}><${TeamLogo} cls=${q.cls} div=${div} size=${50} /><b>${q.cls}</b><em>${k >= 0 ? `${k + 1}번` : q.group + q.rank}</em></span>`;
      })}</div>
      <div class="kd-ctl">
        <button type="button" disabled=${phase !== 'board' || !st.hist.length} onClick=${undo}><${Icon} n="back" size=${18} />되돌리기</button>
        <button type="button" class=${armReset ? 'arm' : ''} disabled=${phase !== 'board' || !filled} onClick=${reset}>${armReset ? '한 번 더 누르면 처음부터' : '처음부터'}</button>
        <button type="button" onClick=${toggleSound}><${Icon} n="vol" size=${18} />${sound ? '소리 켜짐' : '소리 꺼짐'}</button>
        <button type="button" onClick=${full}>전체 화면</button>
        <button type="button" onClick=${exit}>나가기</button>
      </div>
      ${ghost ? html`<div class="kd-ghost" style=${`left:${ghost.x}px;top:${ghost.y}px;width:${ghost.w}px;height:${ghost.h}px;--fx:${ghost.fx}px;--fy:${ghost.fy}px`}>
        <${TeamLogo} cls=${ghost.cls} div=${div} size=${ghost.h - 18} /><b>${SD.classLabel(ghost.cls)}</b></div>` : null}
      <canvas class="kd-confetti" ref=${cv2} width=${DW} height=${DH}></canvas>
      ${phase === 'pick' && cur ? html`<div class="kd-ov" onClick=${e => { if (e.target === e.currentTarget) { setPhase('board'); setCur(null); } }}>
        <div class="kd-panel">
          <div class="kd-ptitle"><span class="kd-bigno">${cur.k + 1}</span><span>번 자리</span></div>
          <p class="kd-psub">${cur.ok.length > 1 ? `${cur.ok.length}개 학급 중에서 뽑습니다` : '들어갈 수 있는 학급이 하나 남았습니다'}${M.first[cur.k].length ? ` · 첫 상대 ${firstOpp(cur.k)}` : ''}</p>
          <div class=${'kd-cands' + (cur.ok.length > 12 ? ' many' : '')}>${cur.ok.map((q, i) => html`<span class="kd-cand" key=${q.cls} style=${'animation-delay:' + i * 0.04 + 's'}>
            <${TeamLogo} cls=${q.cls} div=${div} size=${cur.ok.length > 12 ? 64 : 78} /><b>${SD.classLabel(q.cls)}</b><em>${tag(q)}</em></span>`)}</div>
          ${cur.no.some(x => x.why === 'group') ? html`<p class="kd-excl">같은 조와 첫 경기에서 만나서 빠진 학급 · ${cur.no.filter(x => x.why === 'group').map(x => SD.classLabel(x.q.cls)).join(', ')}</p>` : null}
          ${cur.no.some(x => x.why === 'later') ? html`<p class="kd-excl">남은 자리를 채울 수 없게 돼서 빠진 학급 · ${cur.no.filter(x => x.why === 'later').map(x => SD.classLabel(x.q.cls)).join(', ')}</p>` : null}
          <div class="kd-pbtns">
            <button type="button" class="kd-go" disabled=${!cur.ok.length} onClick=${spin}>${cur.ok.length > 1 ? '추첨하기' : '확정하기'}</button>
            <button type="button" class="kd-cancel" onClick=${() => { setPhase('board'); setCur(null); }}>취소</button>
          </div>
        </div>
      </div>` : null}
      ${(phase === 'spin' || phase === 'reveal') && cur && cur.items ? html`<div class="kd-ov dark">
        <div class=${'kd-reelbox' + (phase === 'spin' ? ' spinning' : ' won')}>
          <div class="kd-bulbs">${BULBS.map(([x, y], i) => html`<i class="kd-bulb" style=${`left:${x}%;top:${y}%;animation-delay:${(i % 2) * -0.6}s`}></i>`)}</div>
          <div class="kd-reeltitle"><i>${cur.k + 1}</i>번 자리${phase === 'spin' ? html`<span class="kd-dots">추첨 중</span>` : null}</div>
          <div class="kd-window">
            <div class="kd-strip" ref=${strip}>${cur.items.map((q, i) => html`<div class=${'kd-item' + (phase === 'reveal' && i === cur.stop ? ' hit' : '')} key=${i}>
              <${TeamLogo} cls=${q.cls} div=${div} size=${118} /><span><b>${SD.classLabel(q.cls)}</b><em>${tag(q)}</em></span></div>`)}</div>
            <div class="kd-mark"></div>
          </div>
          ${phase === 'reveal' ? html`<div class="kd-result"><button type="button" class="kd-next" onClick=${commit}>${cur.k + 1}번 자리에 넣기</button></div>` : html`<div class="kd-result"><span class="kd-hint">띠로리로리로…</span></div>`}
        </div>
        <canvas class="kd-confetti" ref=${cv} width=${DW} height=${DH}></canvas>
        ${flash ? html`<div class="kd-flash" key=${flash}></div>` : null}
      </div>` : null}
    </div>
  </div>`;
}

// ---------- 스타일 (처음 열 때 한 번만 넣는다) ----------
let cssDone = false;
function ensureCss() {
  if (cssDone) return; cssDone = true;
  const css = `
.kd{position:fixed;inset:0;z-index:110;overflow:hidden;background:#02040b;color:#fff;font-family:"IBM Plex Sans KR",system-ui,sans-serif;user-select:none;-webkit-user-select:none}
.kd-bg{position:absolute;inset:0;background:radial-gradient(ellipse 60% 55% at 50% 46%,rgba(var(--acc),.16),transparent 70%),radial-gradient(ellipse at 50% 115%,#10245e 0%,#060c22 52%,#02040b 100%)}
.kd-bg::before{content:'';position:absolute;inset:-50%;background:conic-gradient(from 0deg,transparent 0 7%,rgba(var(--acc),.07) 9%,transparent 12% 32%,rgba(255,255,255,.045) 35%,transparent 38% 57%,rgba(var(--acc),.06) 60%,transparent 63% 82%,rgba(255,255,255,.04) 85%,transparent 88%);animation:kd-sweep 46s linear infinite}
.kd-bg::after{content:'';position:absolute;inset:0;opacity:.55;background-image:radial-gradient(1.6px 1.6px at 8% 14%,#fff,transparent),radial-gradient(1.2px 1.2px at 23% 72%,#fff,transparent),radial-gradient(1.4px 1.4px at 41% 22%,#fff,transparent),radial-gradient(1px 1px at 57% 86%,#fff,transparent),radial-gradient(1.5px 1.5px at 69% 12%,#fff,transparent),radial-gradient(1.2px 1.2px at 83% 64%,#fff,transparent),radial-gradient(1.4px 1.4px at 93% 28%,#fff,transparent),radial-gradient(1px 1px at 33% 48%,#fff,transparent),radial-gradient(1.3px 1.3px at 76% 92%,#fff,transparent)}
@keyframes kd-sweep{to{transform:rotate(360deg)}}
.kd-stage{position:absolute;left:50%;top:50%;width:${DW}px;height:${DH}px;transform:translate(-50%,-50%) scale(var(--s,1))}
.kd-head{position:absolute;left:56px;right:56px;top:30px;height:126px;display:flex;align-items:center;gap:24px}
.kd-brand{width:500px;display:flex;align-items:center;gap:16px}
.kd-brand img{width:82px;height:82px;object-fit:contain}
.kd-brand span{font:700 21px/1.3 "Big Shoulders Display",sans-serif;letter-spacing:.14em;color:rgba(255,255,255,.72)}
.kd-title{flex:1;text-align:center;font:400 62px/1 "Black Han Sans",sans-serif;text-shadow:0 0 34px rgba(var(--acc),.55)}
.kd-title small{display:block;margin-top:12px;font:800 20px/1 "Big Shoulders Display",sans-serif;letter-spacing:.55em;color:rgb(var(--acc));text-shadow:none}
.kd-prog{width:500px;display:flex;align-items:baseline;justify-content:flex-end;gap:10px;font:800 30px "Big Shoulders Display",sans-serif;color:rgba(255,255,255,.62)}
.kd-prog span:first-child{font:600 24px "IBM Plex Sans KR",sans-serif;margin-right:6px}
.kd-prog b{font-size:84px;line-height:1;color:#fff;text-shadow:0 0 24px rgba(var(--acc),.6)}
.kd-warn{position:absolute;left:50%;top:166px;transform:translateX(-50%);padding:6px 18px;border-radius:999px;background:rgba(255,200,60,.16);border:1px solid rgba(255,200,60,.5);color:#FFE08A;font-size:18px}
.kd-svg{position:absolute;left:0;top:0;pointer-events:none}
.kd-svg path{fill:none;stroke:rgba(255,255,255,.2);stroke-width:3}
.kd-svg path.hot{stroke:rgba(var(--acc),.95);stroke-width:4}
.kd-svg circle{fill:#0a1330;stroke:rgba(255,255,255,.34);stroke-width:2}
.kd-rlabel{position:absolute;transform:translateX(-50%);font:600 30px/1 "IBM Plex Sans KR",sans-serif;letter-spacing:.04em;color:rgba(255,255,255,.62);white-space:nowrap}
.kd-slot{position:absolute;display:flex;align-items:center;gap:14px;padding:0 18px 0 10px;border-radius:16px;border:2px dashed rgba(255,255,255,.3);background:rgba(9,16,42,.78);color:#fff;font:inherit;text-align:left;cursor:pointer;transition:transform .16s,border-color .2s,box-shadow .2s}
.kd-slot.r{flex-direction:row-reverse;padding:0 10px 0 18px;text-align:right}
.kd-slot:hover:not(:disabled){transform:scale(1.045);border-color:rgb(var(--acc));box-shadow:0 0 0 4px rgba(var(--acc),.22),0 0 34px rgba(var(--acc),.45)}
.kd-slot:disabled{cursor:default}
.kd-slot.on{border-style:solid;border-color:rgba(var(--acc),.75);background:linear-gradient(90deg,rgba(var(--acc),.26),rgba(9,16,42,.88) 62%)}
.kd-slot.r.on{background:linear-gradient(270deg,rgba(var(--acc),.26),rgba(9,16,42,.88) 62%)}
.kd-slot.next{animation:kd-pulse 1.5s ease-in-out infinite;border-color:rgba(var(--acc),.75)}
.kd-slot.pop{animation:kd-pop .75s cubic-bezier(.2,1.7,.4,1)}
@keyframes kd-pulse{0%,100%{box-shadow:0 0 0 0 rgba(var(--acc),0)}50%{box-shadow:0 0 0 6px rgba(var(--acc),.25),0 0 30px rgba(var(--acc),.45)}}
@keyframes kd-pop{0%{transform:scale(.7);box-shadow:0 0 0 0 rgba(var(--acc),.9)}55%{transform:scale(1.14)}100%{transform:scale(1);box-shadow:0 0 0 22px rgba(var(--acc),0)}}
.kd-no{flex:none;width:46px;height:46px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.12);font:800 28px "Big Shoulders Display",sans-serif}
.kd-slot.on .kd-no{background:rgb(var(--acc));color:#141006}
.kd[data-div=W] .kd-slot.on .kd-no{color:#0b1240}
.kd-q{flex:1;text-align:center;font:800 34px "Big Shoulders Display",sans-serif;color:rgba(255,255,255,.32)}
.kd-team{flex:1;min-width:0;display:flex;align-items:center;gap:12px}
.kd-slot.r .kd-team{flex-direction:row-reverse}
.kd-team b{font:700 26px/1.1 "IBM Plex Sans KR",sans-serif;white-space:nowrap}
.kd-team em{font-style:normal;font:600 16px "IBM Plex Sans KR",sans-serif;color:rgba(255,255,255,.62);white-space:nowrap}
.kd-slot:not(.r) .kd-team em{margin-left:auto}
.kd-slot.r .kd-team em{margin-right:auto}
.kd .tlogo{flex:none}
.kd-final{position:absolute;height:300px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;border-radius:28px;border:2px solid rgba(var(--acc),.4);background:radial-gradient(ellipse at 50% 30%,rgba(var(--acc),.2),rgba(6,10,28,.85) 70%);box-shadow:0 0 50px rgba(var(--acc),.18)}
.kd-cup{color:rgb(var(--acc));filter:drop-shadow(0 0 22px rgba(var(--acc),.75))}
.kd-final b{font:400 40px "Black Han Sans",sans-serif}
.kd-final span:not(.kd-cup){font:800 22px "Big Shoulders Display",sans-serif;letter-spacing:.45em;color:rgba(255,255,255,.55)}
.kd-final small{font-size:15px;color:rgba(255,255,255,.62);padding:0 18px;line-height:1.4}
.kd-final.done{animation:kd-glow 1.6s ease-in-out infinite;border-color:rgb(var(--acc))}
@keyframes kd-glow{0%,100%{box-shadow:0 0 40px rgba(var(--acc),.25)}50%{box-shadow:0 0 90px rgba(var(--acc),.6)}}
.kd-confirm{height:58px;padding:0 34px;border-radius:999px;border:0;background:linear-gradient(180deg,#fff,#E6EBF7);color:#0a0f24;font:400 28px "Black Han Sans",sans-serif;cursor:pointer}
.kd-confirm:disabled{opacity:.6;cursor:default}
.kd-confirm.arm{background:linear-gradient(180deg,#FFE58A,#F2B705);color:#1d1400;box-shadow:0 0 30px rgba(242,183,5,.6)}
.kd-pool{position:absolute;left:56px;right:56px;top:906px;display:flex;justify-content:center;gap:8px}
.kd-chip{width:96px;display:flex;flex-direction:column;align-items:center;gap:3px;transition:opacity .4s,transform .4s}
.kd-chip b{font:800 21px/1 "Big Shoulders Display",sans-serif}
.kd-chip em{font-style:normal;font:700 15px/1 "IBM Plex Sans KR",sans-serif;color:rgb(var(--acc))}
.kd-chip.used{opacity:.26;transform:scale(.88)}
.kd-ctl{position:absolute;right:46px;bottom:22px;display:flex;gap:10px;opacity:.5;transition:opacity .2s}
.kd-ctl:hover{opacity:1}
.kd-ctl button{display:inline-flex;align-items:center;gap:6px;height:42px;padding:0 16px;border-radius:12px;border:1px solid rgba(255,255,255,.28);background:rgba(0,0,0,.38);color:#fff;font:600 17px "IBM Plex Sans KR",sans-serif;cursor:pointer}
.kd-ctl button:disabled{opacity:.35;cursor:default}
.kd-ctl button.arm{background:#C8303C;border-color:#C8303C}
.kd-ctl svg{width:18px;height:18px}
.kd-ghost{position:absolute;z-index:6;pointer-events:none;display:flex;align-items:center;gap:12px;padding:0 18px;border-radius:16px;background:rgb(var(--acc));color:#141006;font:700 26px "IBM Plex Sans KR",sans-serif;box-shadow:0 0 50px rgba(var(--acc),.8);animation:kd-fly .7s cubic-bezier(.55,0,.2,1) both}
@keyframes kd-fly{from{transform:translate(var(--fx),var(--fy)) scale(2.3)}to{transform:translate(0,0) scale(1)}}
.kd-confetti{position:absolute;left:0;top:0;width:${DW}px;height:${DH}px;pointer-events:none;z-index:8}
.kd-ov{position:absolute;inset:0;z-index:7;display:grid;place-items:center;background:rgba(2,4,12,.64);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);animation:kd-fade .28s ease-out}
.kd-ov.dark{background:rgba(2,4,12,.8)}
@keyframes kd-fade{from{opacity:0}}
.kd-panel{width:1300px;padding:40px 52px 44px;border-radius:34px;background:linear-gradient(160deg,rgba(30,42,92,.97),rgba(7,11,30,.97));border:2px solid rgba(var(--acc),.55);box-shadow:0 30px 90px rgba(0,0,0,.6),0 0 70px rgba(var(--acc),.22);animation:kd-rise .5s cubic-bezier(.2,1.25,.4,1)}
@keyframes kd-rise{from{opacity:0;transform:translateY(40px) scale(.94)}}
.kd-ptitle{display:flex;align-items:baseline;justify-content:center;gap:10px;font:400 60px "Black Han Sans",sans-serif}
.kd-bigno{font:900 150px/.85 "Big Shoulders Display",sans-serif;color:rgb(var(--acc));text-shadow:0 0 44px rgba(var(--acc),.65)}
.kd-psub{margin:14px 0 28px;text-align:center;font-size:25px;color:rgba(255,255,255,.74)}
.kd-cands{display:flex;flex-wrap:wrap;justify-content:center;gap:16px}
.kd-cand{width:162px;padding:16px 6px 14px;display:flex;flex-direction:column;align-items:center;gap:8px;border-radius:20px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);animation:kd-in .45s cubic-bezier(.2,1.3,.4,1) both}
.kd-cands.many .kd-cand{width:142px;padding:12px 4px}
.kd-cand b{font:700 21px "IBM Plex Sans KR",sans-serif;white-space:nowrap}
.kd-cand em{font-style:normal;font:700 16px "IBM Plex Sans KR",sans-serif;color:rgb(var(--acc))}
@keyframes kd-in{from{opacity:0;transform:translateY(18px) scale(.8)}}
.kd-excl{margin:20px 0 0;text-align:center;font-size:19px;color:rgba(255,255,255,.55)}
.kd-pbtns{display:flex;justify-content:center;gap:18px;margin-top:30px}
.kd-go{height:88px;padding:0 70px;border-radius:999px;border:0;background:linear-gradient(180deg,#FFE58A,#F2B705);color:#1d1400;font:400 42px "Black Han Sans",sans-serif;cursor:pointer;box-shadow:0 12px 36px rgba(242,183,5,.45);animation:kd-breathe 1.5s ease-in-out infinite}
.kd[data-div=W] .kd-go{background:linear-gradient(180deg,#D7DFFF,#8EA4FF);color:#0b1240;box-shadow:0 12px 36px rgba(142,164,255,.45)}
@keyframes kd-breathe{50%{transform:scale(1.05)}}
.kd-cancel{height:88px;padding:0 40px;border-radius:999px;border:1px solid rgba(255,255,255,.32);background:transparent;color:#fff;font:600 26px "IBM Plex Sans KR",sans-serif;cursor:pointer}
.kd-reelbox{position:relative;width:1060px;padding:34px 64px 40px;border-radius:44px;background:radial-gradient(ellipse at 50% 0%,rgba(var(--acc),.28),transparent 62%),linear-gradient(180deg,#141c44,#060a1b);border:3px solid rgba(var(--acc),.8);box-shadow:0 0 0 12px rgba(0,0,0,.35),0 0 90px rgba(var(--acc),.35);animation:kd-rise .45s cubic-bezier(.2,1.25,.4,1)}
.kd-reeltitle{position:relative;text-align:center;font:400 52px "Black Han Sans",sans-serif;margin-bottom:22px}
.kd-reeltitle i{font:900 84px/.8 "Big Shoulders Display",sans-serif;font-style:normal;color:rgb(var(--acc));margin-right:6px;text-shadow:0 0 30px rgba(var(--acc),.6)}
.kd-dots{display:block;margin-top:8px;font:600 22px "IBM Plex Sans KR",sans-serif;letter-spacing:.3em;color:rgba(255,255,255,.6);animation:kd-blink .7s steps(2) infinite}
@keyframes kd-blink{50%{opacity:.3}}
.kd-window{position:relative;height:${IH * 3}px;overflow:hidden;border-radius:26px;background:linear-gradient(180deg,#010309,#0c1538 50%,#010309);box-shadow:inset 0 0 50px rgba(0,0,0,.85)}
.kd-window::before,.kd-window::after{content:'';position:absolute;left:0;right:0;height:${IH}px;z-index:2;pointer-events:none}
.kd-window::before{top:0;background:linear-gradient(#010309 8%,rgba(1,3,9,.15))}
.kd-window::after{bottom:0;background:linear-gradient(rgba(1,3,9,.15),#010309 92%)}
.kd-strip{position:absolute;left:0;right:0;top:0;will-change:transform}
.kd-item{height:${IH}px;display:flex;align-items:center;justify-content:center;gap:34px}
.kd-item span{display:flex;flex-direction:column;gap:4px}
.kd-item b{font:400 70px/1 "Black Han Sans",sans-serif;white-space:nowrap}
.kd-item em{font-style:normal;font:700 26px "IBM Plex Sans KR",sans-serif;color:rgb(var(--acc))}
.kd-item.hit{animation:kd-hit .9s ease-in-out infinite alternate}
@keyframes kd-hit{to{transform:scale(1.07);filter:drop-shadow(0 0 22px rgba(var(--acc),.9))}}
.kd-mark{position:absolute;left:20px;right:20px;top:${IH}px;height:${IH}px;z-index:3;pointer-events:none;border-top:4px solid rgba(var(--acc),.95);border-bottom:4px solid rgba(var(--acc),.95);box-shadow:0 0 34px rgba(var(--acc),.4),inset 0 0 46px rgba(var(--acc),.16)}
.kd-mark::before,.kd-mark::after{content:'';position:absolute;top:50%;margin-top:-22px;border:22px solid transparent}
.kd-mark::before{left:-22px;border-left-color:rgb(var(--acc))}
.kd-mark::after{right:-22px;border-right-color:rgb(var(--acc))}
.kd-reelbox.won .kd-mark{animation:kd-markwin .5s ease-in-out 4}
@keyframes kd-markwin{50%{box-shadow:0 0 70px rgba(var(--acc),.95),inset 0 0 70px rgba(var(--acc),.4)}}
.kd-bulbs{position:absolute;inset:16px;pointer-events:none}
.kd-bulb{position:absolute;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:#FFF4B8;box-shadow:0 0 12px 4px rgba(255,214,90,.75);animation:kd-bulb 1.2s steps(2) infinite}
.kd-reelbox.spinning .kd-bulb{animation-duration:.22s}
.kd-reelbox.won .kd-bulb{animation:kd-bulbwin .34s steps(2) infinite}
@keyframes kd-bulb{50%{opacity:.15;box-shadow:none}}
@keyframes kd-bulbwin{50%{opacity:.25;box-shadow:none}}
.kd-result{height:96px;margin-top:26px;display:flex;align-items:center;justify-content:center}
.kd-hint{font:400 34px "Black Han Sans",sans-serif;letter-spacing:.06em;color:rgba(255,255,255,.55);animation:kd-blink .5s steps(2) infinite}
.kd-next{height:90px;padding:0 60px;border-radius:999px;border:0;background:#fff;color:#0a0f24;font:400 40px "Black Han Sans",sans-serif;cursor:pointer;animation:kd-in .4s .35s both;box-shadow:0 0 40px rgba(var(--acc),.55)}
.kd-flash{position:absolute;inset:0;z-index:9;background:#fff;pointer-events:none;animation:kd-flash .75s ease-out both}
@keyframes kd-flash{from{opacity:.88}to{opacity:0}}
@media (prefers-reduced-motion:reduce){.kd-bg::before,.kd-slot.next,.kd-go,.kd-bulb{animation:none!important}}
`;
  const el = document.createElement('style');
  el.id = 'kdraw-css'; el.textContent = css;
  document.head.appendChild(el);
}

function Show(props) { ensureCss(); return html`<${DrawShow} ...${props} />`; }
// 원본 SDSMP에서만 연다 (둘러보기 복사본에는 버튼이 없다).
// 레이저런 조 추첨도 같은 무대(소리 · 꽃가루 · 슬롯 릴)를 쓴다.
window.KDRAW = { DrawShow: Show, available: () => !SD.VIEWER, bracketModel, candidates, kit: { Sfx, confetti, BULBS, ensureCss, IH, DW, DH, rnd } };
})();
