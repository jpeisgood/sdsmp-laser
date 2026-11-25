/* SDSMP TV mode: auto-advancing LED-board slideshow for an HDMI screen. */
(function () {
'use strict';
const { useState, useEffect, useLayoutEffect, useRef } = preactHooks;
const { html, Logo, TeamLogo } = UI;
const { S, DIV_LABEL, fmtDate, fmtDateLong, todayStr, addDays, setPresence } = SD;
const pad = n => String(n).padStart(2, '0');
const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out.length ? out : [[]]; };
const byTime = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || SD.mKey(a).localeCompare(SD.mKey(b));

// "2-11" → "2학년 11반" for the TV audience.
const classLabel = SD.classLabel;

// Time with the venue centred under it · division/group tag beside it · crest + class under each team · score or VS dead centre.
// Finished: just the division/group tag, with FINAL over the score. Live: the running half clock over the score.
function TvMatch({ m }) {
  const live = m.status === 'live', fin = m.status === 'final';
  const w = SD.winnerOf(m), pk = SD.pkScore(m);
  const team = (cls, lose) => html`<div class=${'tvm-team' + (lose ? ' lose' : '')}><${TeamLogo} cls=${cls} div=${m.div} size="5.4em" /><b>${classLabel(cls)}</b></div>`;
  const ck = m.clock && m.clock.ph && m.clock.ph !== 'FT';
  return html`<div class=${'tvm ' + m.div + (live ? ' live' : '') + (fin ? ' fin' : '')}>
    <div class="tvm-when"><b>${m.time || '--:--'}</b><span>${SD.venueName(m.venue) || '구장 미정'}</span></div>
    <div class="tvm-tag"><span class=${'tag ' + m.div}>${DIV_LABEL[m.div]} ${m.stage === 'group' ? m.group + '조' : m.stage}</span></div>
    <div class="tvm-teams">
      ${team(m.home, fin && w && w !== m.home)}
      <div class="tvm-mid">
        ${fin ? html`<span class="tv-final">FINAL</span>` : live ? html`<span class="tv-live"><i></i>LIVE${ck ? html` <${UI.ClockText} m=${m} />` : null}</span>` : null}
        ${m.status === 'scheduled' ? html`<span class="tv-vs">VS</span>` : html`<span class="sc">${m.scoreH}<i>:</i>${m.scoreA}</span>`}${pk ? html`<small>PK ${pk[0]}:${pk[1]}</small>` : null}</div>
      ${team(m.away, fin && w && w !== m.away)}
    </div></div>`;
}
function MatchesSlide({ list }) {
  const cols = list.length > 4 ? 2 : 1;
  const fs = list.length <= 2 ? 1.2 : list.length <= 4 ? 0.95 : 0.86;
  return html`<div class=${'tv-matches c' + cols} style=${`font-size:${fs}em`}>${list.map(m => html`<${TvMatch} m=${m} />`)}</div>`;
}
function StandSlide({ L, div, mv }) {
  const groups = L.standings[div] || {};
  const keys = Object.keys(groups);
  const n = keys.length, cols = n <= 4 ? Math.max(n, 1) : n <= 6 ? 3 : 4;
  const adv = PAGES.advOf(L, div);
  return html`<div style="display:flex;flex-wrap:wrap;justify-content:center;align-content:flex-start;gap:1.2em">
    ${keys.map(k => { const g = groups[k]; const fin = g.matches.filter(m => m.status === 'final').length; return html`
      <div class=${'tvg-card ' + div} style=${`width:calc((100% - ${cols - 1} * 1.2em) / ${cols})`}>
        <div class="gh"><b>${k}</b><span>${k}조 · ${fin}/${g.matches.length}경기</span></div>
        <table class="tvt"><thead><tr><th></th><th style="text-align:left">팀</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>득실</th><th>FP</th><th>승점</th></tr></thead>
        <tbody>${g.rows.map((r, i) => html`<tr class=${'rise' + (fin && r.rank <= adv ? ' adv' : '')} style=${`animation-delay:${(0.42 + i * 0.09).toFixed(2)}s`}>
          <td class="rk">${r.rank}<${Mv} v=${SD.moveOf(mv && mv.stand[div] && mv.stand[div][k], r.cls, r.rank)} /></td><td class="tm"><span class="tm-in"><${TeamLogo} cls=${r.cls} div=${div} size="1.5em" />${r.cls}${r.laser ? html`<i class="lr">LR</i>` : null}${r.live ? html`<i class="lv" title="경기 중"></i>` : null}</span></td>
          <td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td><td class=${r.fp < 0 ? 'neg' : ''}>${r.fp}</td><td class="pt">${r.pts}</td></tr>`)}</tbody></table>
      </div>`; })}</div>`;
}
// ▲▼ next to a rank: v is a number (up/down), 'new', 0 (same) or null (nothing to show).
const Mv = ({ v }) => (v == null ? null : v === 'new' ? html`<i class="mv new">NEW</i>` : v === 0 ? html`<i class="mv same">–</i>`
  : v > 0 ? html`<i class="mv up">▲${v}</i>` : html`<i class="mv dn">▼${-v}</i>`);
// 1st place lands first, the rest follow 0.16 s apart; the women's column starts a beat later.
const flyStyle = (i, div) => `--i:${i};animation-delay:${(0.25 + (div === 'W' ? 0.08 : 0) + i * 0.16).toFixed(2)}s`;
function RankCol({ L, div, kind, mv }) {
  const src = kind === 'a' ? L.assists : kind === 'mvp' ? L.mvp : L.scorers;
  const prev = mv && (kind === 'a' ? mv.assists : kind === 'mvp' ? mv.mvp : mv.scorers)[div];
  const list = src[div].slice(0, 10);
  const unit = kind === 'a' ? '어시스트' : kind === 'mvp' ? '점' : '골';
  return html`<div class=${'col ' + div}><h3><i></i>${SD.DIV_LEAGUE[div]} TOP 10</h3>
    ${list.length ? html`<ol>${list.map((r, i) => html`<li class=${'fly ' + (r.rank <= 3 ? 'p' + r.rank : '')} style=${flyStyle(i, div)}><span class="rk">${r.rank}<${Mv} v=${SD.moveOf(prev, r.p.id, r.rank)} /></span><${TeamLogo} cls=${r.p.cls} div=${div} size="2.2em" />
      <span class="nm">${r.p.name}<small>${r.p.cls}</small></span><span class=${'gl' + (kind === 'mvp' ? ' mvp' : '')}>${r.v}<small>${unit}</small>${kind === 'mvp' ? html`<em>${r.g}골 ${r.a}어시스트</em>` : null}</span></li>`)}</ol>`
      : html`<div class="tv-empty" style="font-size:1.2em">아직 기록이 없습니다</div>`}</div>`;
}

// Scorer–assister duos, same fly-in rows as the rankings.
function ChemCol({ L, div, mv }) {
  const prev = mv && mv.chem[div];
  const list = ((L.chem && L.chem[div]) || []).slice(0, 10);
  return html`<div class=${'col ' + div}><h3><i></i>${SD.DIV_LEAGUE[div]} TOP 10</h3>
    ${list.length ? html`<ol>${list.map((c, i) => html`<li class=${'fly chem ' + (c.rank <= 3 ? 'p' + c.rank : '')} style=${flyStyle(i, div)}><span class="rk">${c.rank}<${Mv} v=${SD.moveOf(prev, c.x + '|' + c.y, c.rank)} /></span><${TeamLogo} cls=${c.px.cls} div=${div} size="2.2em" />
      <span class="nm">${c.px.name}<b class="duo">⇄</b>${c.py.name}<small>${c.px.cls === c.py.cls ? c.px.cls : `${c.px.cls} · ${c.py.cls}`}</small></span>
      <span class="gl">${c.n}<small>골</small></span></li>`)}</ol>`
      : html`<div class="tv-empty" style="font-size:1.2em">아직 합작 골이 없습니다</div>`}</div>`;
}

// 베스트 학급 TOP 10: one combined score per class (men's + women's teams), across the whole school.
function BestSlide({ L, mv }) {
  const cfg = BEST.cfgOf();
  const { rows } = BEST.bestScores(L, cfg);
  const list = BEST.overallRanks(rows).slice(0, 10);
  const prevMap = mv && mv.L ? new Map(BEST.overallRanks(BEST.bestScores(mv.L, cfg).rows).map(r => [r.cls, r.oRank])) : null;
  if (!list.length) return html`<div class="tv-empty"><div><b>아직 베스트 학급 점수가 없습니다</b>경기 기록에서 학급 응원 · 경기 전 파이팅 · 페어플레이를 체크하면 이곳에 쌓입니다</div></div>`;
  const P = cfg.pts;
  const bits = r => [r.parts.cheer ? `응원 ${r.parts.cheer}` : '', r.parts.song ? `응원가 ${r.parts.song}` : '', r.parts.flag ? `응원깃발 ${r.parts.flag}` : '',
    r.parts.fight ? `경기 전 파이팅 ${r.parts.fight}` : '', r.parts.fair ? `페어플레이 ${r.parts.fair}` : '',
    r.parts.both ? `남·여 참가 ${r.parts.both}` : '', r.parts.teacher ? `담임쌤 참여 ${r.parts.teacher}` : ''].filter(Boolean).join(' · ');
  return html`<div class="tv-sc tv-best">${[list.slice(0, 5), list.slice(5, 10)].map((col, ci) => html`<div class="col"><ol>${col.map((r, j) => html`
    <li class=${'fly ' + (r.oRank <= 3 ? 'p' + r.oRank : '')} style=${flyStyle(ci * 5 + j, 'M')}><span class="rk">${r.oRank}<${Mv} v=${SD.moveOf(prevMap, r.cls, r.oRank)} /></span><${TeamLogo} cls=${r.cls} div=${r.men ? 'M' : 'W'} size="2.5em" />
      <span class="nm">${SD.classLabel(r.cls)}${r.rank === 1 && !cfg.skip[r.grade] ? html`<i class="gb">${r.grade}학년 1위</i>` : null}<small>${bits(r)}</small></span>
      <span class="gl">${r.total}<small>점</small></span></li>`)}</ol></div>`)}</div>`;
}

// Slides in the order chosen in TV 송출 › 슬라이드 구성 (SD.tvOrder); the notice scene always closes the loop.
function buildSlides(L, cfg) {
  const mv = cfg.move && cfg.move.on !== false ? SD.moveBase(L.sid, cfg.move.base) : null; // ▲▼ baseline
  const today = todayStr();
  const divs = SD.divList(L.sp);
  const day = (k, ds, title) => {
    const list = L.matches.filter(m => m.date === ds && m.home && m.away).sort(byTime);
    if (!list.length && k !== 'today') return [];
    const pages = chunk(list, 8);
    return pages.map((pg, i) => ({ key: k + i, kind: k, title, fit: list.length > 0, sub: fmtDateLong(ds) + (pages.length > 1 ? ` · ${i + 1}/${pages.length}` : ''),
      body: () => list.length ? html`<${MatchesSlide} list=${pg} />` : html`<div class="tv-empty"><div><b>오늘은 경기가 없습니다</b>다음 일정이 편성되면 이곳에 표시됩니다</div></div>` }));
  };
  const stand = div => (divs.includes(div) ? [{ key: 'st' + div, kind: 'stand' + div, div, title: `${DIV_LABEL[div]} 조별 순위`, sub: `상위 ${PAGES.advOf(L, div)}팀 본선 진출 · 승점 → 레이저런 → ${L.R && L.R.bothTie === false ? '' : '남녀 참가 → '}페어플레이`, body: () => html`<${StandSlide} L=${L} div=${div} mv=${mv} />` }] : []);
  const rank = (k, kind, title, sub) => [{ key: k, kind: k, title, sub, body: () => html`<div class="tv-sc"><${RankCol} L=${L} div="M" kind=${kind} mv=${mv} /><${RankCol} L=${L} div="W" kind=${kind} mv=${mv} /></div>` }];
  const ko = div => {
    const b = divs.includes(div) && S.brackets[`${L.sid}-${div}`];
    if (!b) return [];
    const n = (b.slots || []).filter(Boolean).length;
    const ms = L.matches.filter(m => m.ko && m.bracket === `${L.sid}-${div}`);
    const fin = ms.find(m => m.round === Math.round(Math.log2(b.size)));
    const champ = SD.winnerOf(fin);
    const now = ms.filter(m => m.home && m.away && !SD.winnerOf(m)).sort((x, y) => x.round - y.round)[0];
    const state = champ ? `우승 ${SD.classLabel(champ)}` : now && ms.some(SD.hasResult) ? `${now.round === 1 && n < b.size ? '1회전' : now.stage} 진행 중` : '';
    return [{ key: 'ko' + div, kind: 'ko' + div, div, fit: false, title: `${DIV_LABEL[div]} 토너먼트`, sub: [n < b.size ? `${n}팀 대진표` : `${b.size}강 대진표`, state].filter(Boolean).join(' · '),
      body: () => html`<${KO.Arena} L=${L} div=${div} bracket=${b} tv=${true} />` }];
  };
  const make = {
    yesterday: () => day('yesterday', addDays(today, -1), '어제의 경기 결과'),
    today: () => day('today', today, '오늘의 경기'),
    tomorrow: () => day('tomorrow', addDays(today, 1), '내일의 경기'),
    standM: () => stand('M'), standW: () => stand('W'),
    scorers: () => rank('scorers', 'g', '득점 TOP 10', '남학생 리그 · 여학생 리그'),
    assists: () => rank('assists', 'a', '어시스트 TOP 10', '남학생 리그 · 여학생 리그'),
    mvp: () => rank('mvp', 'mvp', 'MVP 발롱도르 레이스', `득점 ${L.R.mvpG}점 + 어시스트 ${L.R.mvpA}점`),
    chem: () => [{ key: 'chem', kind: 'chem', title: '베스트 케미 TOP 10', sub: '골 + 어시스트 합작 듀오', body: () => html`<div class="tv-sc"><${ChemCol} L=${L} div="M" mv=${mv} /><${ChemCol} L=${L} div="W" mv=${mv} /></div>` }],
    best: () => (window.BEST ? [{ key: 'best', kind: 'best', title: '베스트 학급 TOP 10', sub: '남·여 리그 합산 학급 포인트 · 학년별 1위 학급 시상', body: () => html`<${BestSlide} L=${L} mv=${mv} />` }] : []),
    koM: () => ko('M'), koW: () => ko('W'),
    susp: () => {
      const act = Object.values(L.suspByPlayer).filter(i => i.active).map(i => ({ i, p: S.players[i.pid] })).filter(x => x.p);
      return act.length ? [{ key: 'su', kind: 'susp', title: '출전 정지 명단', sub: '카드에 따른 다음 경기 출전 정지', body: () => html`<div class="tv-susp">${act.slice(0, 20).map(({ i, p }) => html`<div>
        <i class=${'cardico ' + (i.src && i.src.type === 'R' ? 'r' : 'y')} style="width:.7em;height:1em"></i><b>${p.cls} ${p.name}</b><span>${i.next ? `${fmtDate(i.next.date)} ${i.next.home} vs ${i.next.away}` : '다음 경기 미정'}</span></div>`)}</div>` }] : [];
    },
  };
  const out = [];
  for (const k of SD.tvOrder(cfg)) if (SD.tvSlideOn(cfg, k) && make[k]) out.push(...make[k]());
  // last scene: its own text, or the strip notice when that is left empty
  const endText = (cfg.noticeEnd || '').trim() || (cfg.notice || '').trim();
  if (cfg.slides.notice && endText) out.push({ key: 'nt', kind: 'notice', notice: true, fit: false, title: '공지', sub: '', body: () => html`<${NoticeScene} text=${endText} look=${SD.noticeVars(cfg.noticeStyle)} />` });
  if (!out.length) out.push({ key: 'none', fit: false, title: 'SDSMP', sub: '', body: () => html`<div class="tv-empty"><div><b>표시할 슬라이드가 없습니다</b>TV 송출 설정에서 슬라이드를 켜세요</div></div>` });
  return out;
}

// Shrinks (or slightly grows) a slide's type so it always fits the space above the notice strip, on any screen.
function Fit({ children, max = 1.12 }) {
  const box = useRef(null), inner = useRef(null);
  useLayoutEffect(() => {
    const b = box.current, el = inner.current;
    if (!b || !el) return;
    el.style.fontSize = '1em';
    const have = b.clientHeight;
    let s = Math.min(max, have / Math.max(1, el.scrollHeight));
    el.style.fontSize = s + 'em';
    if (el.scrollHeight > have) { s *= have / el.scrollHeight; el.style.fontSize = s + 'em'; }
  });
  return html`<div class="fit" ref=${box}><div class="fit-in" ref=${inner}>${children}</div></div>`;
}

// Ticks when web fonts finish loading, so text that measures itself can measure again in the real font.
function useFontTick() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const f = () => setN(x => x + 1), fs = document.fonts;
    if (fs && fs.addEventListener) fs.addEventListener('loadingdone', f);
    window.addEventListener('sd-fonts', f);
    return () => { if (fs && fs.removeEventListener) fs.removeEventListener('loadingdone', f); window.removeEventListener('sd-fonts', f); };
  }, []);
  return n;
}
// Ticks when the element changes size (full screen, window resize, the settings preview scaling).
function useSizeTick(ref) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || !window.ResizeObserver) return;
    let w = -1, h = -1, raf = 0;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === w && el.clientHeight === h) return;
      w = el.clientWidth; h = el.clientHeight;
      cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setN(x => x + 1));
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);
  return n;
}
// Notice strip under every slide; scrolls only when the text is wider than the screen. Lettering (font, size,
// colour) comes from the CSS variables of TV 송출 › 공지 글씨; `look` only tells it when to measure again.
function NoticeBar({ text, look = '' }) {
  const box = useRef(null), one = useRef(null);
  const [run, setRun] = useState(0);
  const tick = useFontTick() + useSizeTick(box) * 1000;
  useLayoutEffect(() => {
    const b = box.current, t = one.current;
    if (!b || !t) return;
    const w = t.getBoundingClientRect().width;
    setRun(w - b.clientWidth > 4 ? Math.max(12, Math.round(w / 90)) : 0);
  }, [text, look, tick]);
  return html`<div class="tv-nbar"><span class="nb-tag">공지</span><div class="nb-box" ref=${box}>
    <span class=${'nb-text' + (run ? ' run' : '')} style=${run ? `animation-duration:${run}s` : ''}><span class="nb-one" ref=${one}>${text}</span>${run ? html`<span class="nb-gap"></span>${text}<span class="nb-gap"></span>` : null}</span></div></div>`;
}
// The last notice scene: big lettering in the notice style, shrunk only when long text would not fit.
function NoticeScene({ text, look = '' }) {
  const box = useRef(null), p = useRef(null);
  const tick = useFontTick() + useSizeTick(box) * 1000;
  useLayoutEffect(() => {
    const b = box.current, el = p.current;
    if (!b || !el) return;
    let s = 1;
    el.style.setProperty('--fit', '1');
    for (let i = 0; i < 4 && el.scrollHeight > b.clientHeight; i++) {
      s *= Math.max(0.5, b.clientHeight / el.scrollHeight) * 0.97;
      el.style.setProperty('--fit', String(Math.max(0.25, s)));
    }
  }, [text, look, tick]);
  return html`<div class="tv-notice" ref=${box}><p ref=${p}>${text}</p></div>`;
}

// Background music: the shared playlist in order, looping. Starts from the '송출 시작' tap (browsers only let sound
// start after a tap). Volume is kept per TV; the playlist and on/off come from TV 송출 settings and apply live.
function useBgm(cfg, started) {
  const m = cfg.music || {};
  const list = SD.playlistOf(cfg);
  const on = m.on !== false && list.length > 0;
  const audio = useRef(null);
  if (!audio.current && typeof Audio !== 'undefined') { audio.current = new Audio(); audio.current.preload = 'auto'; }
  const cur = useRef(null), listRef = useRef(list), onRef = useRef(on), wanted = useRef(false), live = useRef(started);
  listRef.current = list; onRef.current = on; live.current = started;
  const [st, setSt] = useState({ id: null, playing: false, blocked: false });
  const [vol, setVolS] = useState(() => { const v = SD.ls.get('tvVol', null); return v == null ? (Number(m.vol) || 0.7) : v; });
  const setVol = v => { setVolS(v); SD.ls.set('tvVol', v); };
  const play = () => { const a = audio.current; if (!a) return; a.play().then(() => setSt(s => ({ ...s, playing: true, blocked: false }))).catch(() => setSt(s => ({ ...s, playing: false, blocked: true }))); };
  const load = (t, go) => { const a = audio.current; if (!a || !t) return; cur.current = t.id; a.src = t.file; setSt(s => ({ ...s, id: t.id })); if (go) play(); };
  // Next / previous in the list, wrapping around: 1, 2, 3, 4, 1, 2, … A one-song list just starts that song again.
  const step = d => {
    const l = listRef.current, a = audio.current; if (!l.length || !a) return;
    const i = l.findIndex(t => t.id === cur.current);
    const t = l[((i < 0 ? (d > 0 ? -1 : 0) : i) + d + l.length) % l.length];
    if (t.id === cur.current && a.src) { a.currentTime = 0; play(); } else load(t, true);
  };
  const fails = useRef(0);
  const start = () => { if (!onRef.current) return; wanted.current = true; if (!cur.current) load(listRef.current[0], true); else play(); };
  const pause = () => { wanted.current = false; if (audio.current) audio.current.pause(); setSt(s => ({ ...s, playing: false })); };
  useEffect(() => {
    const a = audio.current; if (!a) return;
    const end = () => { fails.current = 0; step(1); };
    // A song that will not load is skipped after a moment, so one bad file never stops the music (gives up after a full round of failures).
    const bad = () => { if (!a.getAttribute('src') || !wanted.current) return; if (++fails.current > listRef.current.length) return; setTimeout(() => { if (wanted.current) step(1); }, 1500); };
    const ok = () => { fails.current = 0; };
    const p1 = () => setSt(s => ({ ...s, playing: true })), p0 = () => setSt(s => ({ ...s, playing: false }));
    a.addEventListener('ended', end); a.addEventListener('error', bad); a.addEventListener('playing', ok); a.addEventListener('play', p1); a.addEventListener('pause', p0);
    return () => { a.removeEventListener('ended', end); a.removeEventListener('error', bad); a.removeEventListener('playing', ok); a.removeEventListener('play', p1); a.removeEventListener('pause', p0); a.pause(); a.removeAttribute('src'); a.load(); };
  }, []);
  useEffect(() => { if (audio.current) audio.current.volume = Math.max(0, Math.min(1, vol)); }, [vol]);
  // Settings changed while playing: turned off → stop; current song taken out of the list → move on.
  const key = list.map(t => t.id).join('|');
  useEffect(() => {
    if (!on) { if (audio.current && !audio.current.paused) audio.current.pause(); return; }
    if (cur.current && !list.some(t => t.id === cur.current) && wanted.current) step(1);
    else if (live.current && !wanted.current) start(); // music switched on while the TV is already running
  }, [on, key]);
  return { on, track: SD.trackOf(st.id), playing: st.playing, blocked: st.blocked && wanted.current, start, pause, next: () => step(1), prev: () => step(-1), vol, setVol, wanted };
}

// Keep the TV computer's screen on while broadcasting (no screensaver, no display sleep).
// Two layers: the Screen Wake Lock API, which a page inside another site's frame may not be allowed to use,
// and a tiny silent looping video in the corner — browsers keep the display awake while a visible video with sound plays.
// The video lives inside the TV element so it stays on screen in full-screen mode too.
function useKeepAwake(on, vref) {
  const [st, setSt] = useState({ api: false, vid: false });
  useEffect(() => {
    if (!on) return;
    let alive = true, lock = null;
    const getLock = async () => {
      if (!alive || document.visibilityState !== 'visible' || !navigator.wakeLock || (lock && !lock.released)) return;
      try {
        lock = await navigator.wakeLock.request('screen');
        setSt(x => ({ ...x, api: true }));
        lock.addEventListener('release', () => { setSt(x => ({ ...x, api: false })); if (alive) setTimeout(getLock, 1000); });
      } catch (e) { setSt(x => ({ ...x, api: false })); }
    };
    const v = vref.current;
    if (!v) return;
    v.muted = false; v.volume = 1;
    const play = () => { if (alive && v.paused) v.play().then(() => setSt(x => ({ ...x, vid: true }))).catch(() => setSt(x => ({ ...x, vid: false }))); };
    const onPause = () => setSt(x => ({ ...x, vid: false }));
    v.addEventListener('pause', onPause);
    // if the browser refused to start it (no click yet), try again on the next touch / key
    const poke = () => { play(); getLock(); };
    const vis = () => { if (document.visibilityState === 'visible') poke(); };
    getLock(); play();
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pointerdown', poke); window.addEventListener('keydown', poke);
    const t = setInterval(poke, 60000); // belt and braces: re-check every minute
    return () => {
      alive = false; clearInterval(t);
      document.removeEventListener('visibilitychange', vis); window.removeEventListener('pointerdown', poke); window.removeEventListener('keydown', poke);
      v.removeEventListener('pause', onPause); v.pause();
      if (lock) lock.release().catch(() => {});
    };
  }, [on]);
  return st.api || st.vid;
}

function TV({ L, onExit }) {
  const cfg = SD.deepMerge(SD.DEFAULT_TV, S.tv || {});
  const slides = buildSlides(L, cfg);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [run, setRun] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [started, setStarted] = useState(!!document.fullscreenElement);
  const bgm = useBgm(cfg, started);
  const awakeRef = useRef(null);
  const awake = useKeepAwake(started, awakeRef);
  const bgmRef = useRef(bgm); bgmRef.current = bgm;
  const begin = () => { setStarted(true); bgm.start(); };
  const [idle, setIdle] = useState(false);
  const root = useRef(null);
  const lastVer = useRef({ ver: S.ver, at: Date.now() });
  if (lastVer.current.ver !== S.ver) lastVer.current = { ver: S.ver, at: Date.now() };
  const nRef = useRef(slides.length);
  nRef.current = slides.length;
  const cur = slides[idx % slides.length];
  // Each slide type can have its own time (TV 송출 › 슬라이드 구성); otherwise the default scene time.
  const own = cur.notice ? cfg.noticeSec : SD.tvSlideSec(cfg, cur.kind);
  const ms = Math.max(3, Number(own) || Number(cfg.interval) || 12) * 1000;
  const go = d => { setIdx(i => ((i % nRef.current) + d + nRef.current) % nRef.current); setRun(r => r + 1); };
  const full = () => {
    const el = root.current;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (el && el.requestFullscreen) el.requestFullscreen().catch(() => {});
  };

  useEffect(() => { if (paused) return; const t = setTimeout(() => go(1), ms); return () => clearTimeout(t); }, [idx, run, paused, ms, slides.length]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);
  useEffect(() => {
    setPresence({ mode: 'tv', mid: null });
    const key = e => {
      if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === ' ') { e.preventDefault(); setPaused(p => !p); }
      else if (e.key === 'Escape' && !document.fullscreenElement) onExit();
      else if (e.key === 'f' || e.key === 'F') full();
      else if (e.key === 'm' || e.key === 'M') { const b = bgmRef.current; if (b.playing) b.pause(); else b.start(); }
      else if (e.key === 'n' || e.key === 'N') bgmRef.current.next();
    };
    window.addEventListener('keydown', key);
    return () => { setPresence({ mode: 'admin' }); window.removeEventListener('keydown', key); };
  }, []);
  useEffect(() => { let t; const mv = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 3000); }; mv(); window.addEventListener('pointermove', mv); return () => { clearTimeout(t); window.removeEventListener('pointermove', mv); }; }, []);
  const d = new Date(now);
  const league = (L.sp && L.sp.league) || 'SD SPORTS';
  const notice = (cfg.notice || '').trim();
  const bg = cfg.bg || {}, tint = SD.tvTint(bg.color);
  const ns = cfg.noticeStyle || {}, look = SD.noticeVars(ns);
  useEffect(() => { SD.loadFonts([ns.font]); }, [ns.font]);
  return html`<div class=${'tv' + (tint ? ' tint' : '') + (idle && started ? ' hidecursor' : '')} style=${(tint ? tint.style + ';' : '') + look} ref=${root}>
    <${UI.StarField} tv=${true} balls=${bg.balls !== false} meteors=${!!bg.meteors} amt=${bg.amt} speed=${bg.speed} />
    <video class="keepawake" ref=${awakeRef} loop playsInline preload="auto" aria-hidden="true" tabIndex="-1">
      <source src="media/keepawake.webm" type="video/webm" /><source src="media/keepawake.mp4" type="video/mp4" /></video>
    <div class="tv-head"><${Logo} size=${86} />
      <div class="league"><b>${league}</b><span>${(L.sp && L.sp.name) || ''} · SD Sports Management Platform</span></div>
      <div class="ttl"><b>${cur.title}</b><span>${cur.sub}</span></div>
      <div class="clock">${pad(d.getHours())}:${pad(d.getMinutes())}<small>${fmtDate(todayStr(d))}</small></div>
    </div>
    <div class=${'tv-prog ' + (cur.div || '')}><i key=${cur.key + run + idx} style=${`animation:tvprog ${ms}ms linear forwards;animation-play-state:${paused ? 'paused' : 'running'}`}></i></div>
    <div class="tv-stage"><div class="tv-slide" key=${cur.key + idx}>${cur.fit === false ? cur.body() : html`<${Fit}>${cur.body()}</${Fit}>`}</div></div>
    ${cfg.noticeBar && notice && !cur.notice ? html`<${NoticeBar} text=${notice} look=${look} />` : null}
    <div class="tv-foot">
      <div class="dots">${slides.map((s, i) => html`<i class=${i === idx % slides.length ? 'on' : ''}></i>`)}</div>
      <span class="live">실시간 · ${SD.fmtClock(lastVer.current.at)} 갱신</span>
      ${started ? html`<span class=${'awake' + (awake ? ' on' : '')} title=${awake ? '송출 중에는 화면이 꺼지지 않습니다' : '화면 꺼짐 방지를 켜지 못했습니다. 화면을 한 번 눌러 주세요.'}>${awake ? '화면 유지' : '화면 유지 꺼짐 · 화면을 한 번 눌러 주세요'}</span>` : null}
      ${paused ? html`<span>일시 정지</span>` : null}
      ${bgm.on && bgm.track ? html`<span class=${'bgm' + (bgm.playing ? ' on' : '')}><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><b>${bgm.track.title}</b><span>${bgm.track.artist}</span></span>` : null}
      ${bgm.on && bgm.blocked ? html`<button class="bgm-go" onClick=${bgm.start}><${UI.Icon} n="music" size=${16} />음악 재생</button>` : null}
      <div class="ctl">
        ${bgm.on ? html`<span class="bgm-ctl" role="group" aria-label="배경음악">
          <button aria-label="이전 곡" onClick=${bgm.prev}><${UI.Icon} n="prev" size=${16} /></button>
          <button aria-label=${bgm.playing ? '음악 멈춤' : '음악 재생'} onClick=${bgm.playing ? bgm.pause : bgm.start}><${UI.Icon} n=${bgm.playing ? 'pause' : 'play'} size=${16} /></button>
          <button aria-label="다음 곡" onClick=${bgm.next}><${UI.Icon} n="next" size=${16} /></button>
          <label class="bgm-vol"><${UI.Icon} n="vol" size=${16} /><input id="tv-vol" type="range" min="0" max="1" step="0.05" value=${bgm.vol} aria-label="음량" onInput=${e => bgm.setVol(Number(e.target.value))} /></label>
        </span>` : null}
        <button onClick=${() => go(-1)}>이전</button><button onClick=${() => setPaused(p => !p)}>${paused ? '재생' : '멈춤'}</button><button onClick=${() => go(1)}>다음</button>
        <button onClick=${full}>전체 화면</button><button onClick=${() => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); onExit(); }}>나가기</button>
      </div>
    </div>
    ${started ? null : html`<div class="tv-start" onClick=${begin}><div style="text-align:center">
      <button onClick=${e => { e.stopPropagation(); begin(); full(); }}>전체 화면으로 송출 시작</button>
      <p>화면을 누르면 창 모드로 계속합니다 · ← → 넘기기 · 스페이스 멈춤 · M 음악 켜기/끄기 · N 다음 곡 · Esc 나가기</p>
      ${bgm.on ? html`<p class="tv-start-bgm"><${UI.Icon} n="music" size=${16} /> 배경음악 ${SD.playlistOf(cfg).length}곡이 순서대로 반복 재생됩니다</p>` : null}</div></div>`}
  </div>`;
}

window.TVMODE = { TV, NoticeBar, NoticeScene };
})();
