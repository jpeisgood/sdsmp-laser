/* SDSMP 베스트 학급 팀워크상: one combined score per class (the men's and women's teams count together).
   Recorders tick three things on every match sheet (학급 응원 상/중/하, 경기 전 파이팅, 페어플레이 + 메모);
   the 개인 · 팀 TOP 10 › 베스트 학급 tab adds them up per class, with two class-level checks kept there. */
(function () {
'use strict';
const { useState } = preactHooks;
const { html, Icon, TeamLogo, Seg } = UI;
const { usePref } = PAGES;
const { S, patchDoc, setDoc, logAct } = SD;

const DEFAULT_BEST = { pts: { both: 100, teacher: 50, fight: 20, fair: 50, cheerHi: 30, cheerMid: 20, cheerLo: 10, song: 100, flag: 100 }, cls: {}, skip: {} };
// made-for-the-league extras, ticked under 학급 응원; each counts once per class (the first match it was ticked)
const EXTRAS = [['song', '응원가 제작'], ['flag', '응원깃발 제작']];
const CHEER_LV = [['none', '없음'], ['lo', '하'], ['mid', '중'], ['hi', '상']];
const CHEER_KEY = { hi: 'cheerHi', mid: 'cheerMid', lo: 'cheerLo' };

const num = v => Number(v) || 0;
const cfgOf = () => {
  const c = SD.deepMerge(DEFAULT_BEST, S.best || {});
  c.cls = c.cls || {}; c.skip = c.skip || {};
  return c;
};
function saveBest(patch) {
  if (!S.best) return setDoc('config/best', SD.deepMerge(DEFAULT_BEST, patch));
  return patchDoc('config/best', patch, 300);
}
const cheerPts = (P, lv) => (CHEER_KEY[lv] ? num(P[CHEER_KEY[lv]]) : 0);
// The earliest match (by date/order) where this class has the extra ticked: the one that counts.
function firstExtra(sport, cls, key) {
  let best = null;
  Object.values(S.matches).forEach(m => {
    if (m.sport !== sport) return;
    ['H', 'A'].forEach(side => {
      if ((side === 'H' ? m.home : m.away) !== cls || !(m.bc && m.bc[side] && m.bc[side][key])) return;
      if (!best || SD.mKey(m).localeCompare(SD.mKey(best)) < 0) best = m;
    });
  });
  return best;
}
// points one class earned in one match (extras only where they count)
function matchPts(P, rec, m, cls) {
  if (!rec) return 0;
  let v = cheerPts(P, rec.cheer) + (rec.fight ? num(P.fight) : 0) + (rec.fair ? num(P.fair) : 0);
  EXTRAS.forEach(([k]) => { if (rec[k]) { const f = firstExtra(m.sport, cls, k); if (f && f.id === m.id) v += num(P[k]); } });
  return v;
}
const parts = c => c.split('-').map(Number);
const sortCls = (a, b) => { const [ga, ca] = parts(a), [gb, cb] = parts(b); return ga - gb || ca - cb; };
// Competition ranking (1, 1, 3), highest first. Zero is not ranked.
function rankBy(list, val) {
  const out = new Map();
  let prev = null, r = 0;
  list.filter(x => val(x) > 0).sort((a, b) => val(b) - val(a)).forEach((x, i) => { if (val(x) !== prev) { r = i + 1; prev = val(x); } out.set(x, r); });
  return out;
}

// Every class in the groups (men's and women's together), with what its match sheets and the judges gave it.
function bestScores(L, cfg) {
  const sp = L.sp || {};
  const inDiv = d => new Set(SD.groupsOf(sp, d).flatMap(g => g.teams));
  const M = inDiv('M'), Wn = inDiv('W');
  const classes = [...new Set([...M, ...Wn])].filter(c => /^\d+-\d+$/.test(c)).sort(sortCls);
  const P = cfg.pts;
  const by = {};
  const rows = classes.map(c => {
    const e = cfg.cls[c] || {};
    const auto = M.has(c) && Wn.has(c);
    const r = { cls: c, grade: parts(c)[0], e, auto, both: e.both == null ? auto : !!e.both, teacher: !!e.teacher, men: M.has(c), women: Wn.has(c),
      cheer: 0, lv: { hi: 0, mid: 0, lo: 0, none: 0 }, fightN: 0, fairN: 0, memos: [], games: [], ex: {} };
    by[c] = r; return r;
  });
  L.matches.forEach(m => ['H', 'A'].forEach(side => {
    const cls = side === 'H' ? m.home : m.away, r = by[cls];
    if (!r) return;
    const rec = (m.bc && m.bc[side]) || null;
    if (m.status !== 'scheduled' || rec) r.games.push({ m, side, rec });
    if (!rec) return;
    if (rec.cheer && r.lv[rec.cheer] != null) { r.lv[rec.cheer]++; r.cheer += cheerPts(P, rec.cheer); }
    if (rec.fight) r.fightN++;
    EXTRAS.forEach(([k]) => { if (rec[k] && (!r.ex[k] || SD.mKey(m).localeCompare(SD.mKey(r.ex[k])) < 0)) r.ex[k] = m; });
    if (rec.fair) { r.fairN++; if ((rec.fairMemo || '').trim()) r.memos.push({ m, text: rec.fairMemo.trim() }); }
  }));
  rows.forEach(r => {
    r.parts = { cheer: r.cheer, song: r.ex.song ? num(P.song) : 0, flag: r.ex.flag ? num(P.flag) : 0, fight: r.fightN * num(P.fight), fair: r.fairN * num(P.fair), both: r.both ? num(P.both) : 0, teacher: r.teacher ? num(P.teacher) : 0 };
    r.total = Object.values(r.parts).reduce((a, b) => a + b, 0);
    r.games.sort((a, b) => SD.mKey(a.m).localeCompare(SD.mKey(b.m)));
  });
  const grades = [...new Set(rows.map(r => r.grade))].sort((a, b) => a - b);
  grades.forEach(g => { const pool = rows.filter(r => r.grade === g); const rk = rankBy(pool, r => r.total); pool.forEach(r => { r.rank = rk.get(r) || null; }); });
  return { rows, grades };
}

function Check({ on, label, pts, ro, onToggle, text, sm }) {
  return html`<button type="button" class=${'bc-chk' + (on ? ' on' : '') + (sm ? ' sm' : '')} aria-pressed=${String(!!on)} aria-label=${label} title=${label} disabled=${ro} onClick=${onToggle}>
    <i>${on ? html`<${Icon} n="check" size=${14} />` : null}</i>${text ? html`<span>${text}</span>` : on ? html`<span>+${pts}</span>` : null}</button>`;
}

// ---------- match sheet panel (경기 기록) ----------
function BcPanel({ m, ro }) {
  const cfg = cfgOf(), P = cfg.pts;
  const path = 'matches/' + m.id;
  const set = (side, patch, msg) => {
    if (ro) return;
    if (!patchDoc(path, { bc: { [side]: patch } }, 0)) return;
    const cls = side === 'H' ? m.home : m.away;
    if (msg) logAct(`${m.home} vs ${m.away} · 베스트 학급 ${cls} ${msg}`);
  };
  const memo = (side, v) => { if (!ro) patchDoc(path, { bc: { [side]: { fairMemo: v } } }, 900); };
  return html`<section class="panel bcp">
    <div class="panel-head"><h3>베스트 학급 체크</h3><span class="sub">학급 응원 · 경기 전 파이팅 · 페어플레이 — 「개인 · 팀 TOP 10 › 베스트 학급」에 모입니다</span></div>
    <div class="panel-body bcp-cols">${['H', 'A'].map(side => {
      const cls = side === 'H' ? m.home : m.away, rec = (m.bc && m.bc[side]) || {};
      const lvLabel = k => `${CHEER_LV.find(x => x[0] === k)[1]} ${k === 'none' ? 0 : cheerPts(P, k)}`;
      return html`<div class="bcp-side" key=${side}>
        <div class="bcp-who"><${TeamLogo} cls=${cls} div=${m.div} size=${30} /><b>${SD.classLabel(cls)}</b><span class="spacer"></span><span class="bcp-sum">이 경기 <b>+${matchPts(P, rec, m, cls)}</b></span></div>
        <div class="bcp-item"><span class="bcp-l">학급 응원</span>
          <div class="seg bcp-seg" role="group" aria-label=${SD.classLabel(cls) + ' 학급 응원'}>${CHEER_LV.map(([k]) => html`
            <button type="button" aria-pressed=${String(rec.cheer === k)} disabled=${ro} onClick=${() => set(side, { cheer: rec.cheer === k ? '' : k }, `학급 응원 ${rec.cheer === k ? '선택 해제' : CHEER_LV.find(x => x[0] === k)[1]}`)}>${lvLabel(k)}</button>`)}</div></div>
        <div class="bcp-item bcp-sub"><span class="bcp-l"></span><div class="bcp-exs">${EXTRAS.map(([k, n]) => {
          const f = firstExtra(m.sport, cls, k), elsewhere = f && f.id !== m.id;
          return html`<span class="bcp-ex"><${Check} sm=${true} on=${rec[k]} pts=${num(P[k])} ro=${ro} label=${`${SD.classLabel(cls)} ${n}`}
            text=${`${n}${rec[k] && !elsewhere ? ` +${num(P[k])}` : ''}`} onToggle=${() => set(side, { [k]: !rec[k] }, `${n} ${rec[k] ? '해제' : '체크'}`)} />
            ${elsewhere ? html`<small>${SD.fmtDate(f.date) || '다른 경기'}에 반영됨</small>` : null}</span>`;
        })}<span class="bcp-note">학급당 1회</span></div></div>
        <div class="bcp-item"><span class="bcp-l">경기 전 파이팅</span>
          <${Check} on=${rec.fight} pts=${num(P.fight)} ro=${ro} label=${SD.classLabel(cls) + ' 경기 전 학급 파이팅'} text=${rec.fight ? `했음 +${num(P.fight)}` : '했음'} onToggle=${() => set(side, { fight: !rec.fight }, `경기 전 파이팅 ${rec.fight ? '해제' : '체크'}`)} /></div>
        <div class="bcp-item"><span class="bcp-l">페어플레이</span>
          <${Check} on=${rec.fair} pts=${num(P.fair)} ro=${ro} label=${SD.classLabel(cls) + ' 페어플레이 · 스포츠맨십'} text=${rec.fair ? `보여줌 +${num(P.fair)}` : '보여줌'} onToggle=${() => set(side, { fair: !rec.fair }, `페어플레이 ${rec.fair ? '해제' : '체크'}`)} /></div>
        ${rec.fair || (rec.fairMemo || '').trim() ? html`<input id=${'bcp-memo-' + side} class="input bcp-memo" value=${rec.fairMemo || ''} disabled=${ro} onInput=${e => memo(side, e.target.value)}
          placeholder="어떤 장면이었는지 적어 두세요 (예: 넘어진 상대 선수를 일으켜 줌)" aria-label=${SD.classLabel(cls) + ' 페어플레이 메모'} />` : null}
      </div>`;
    })}</div></section>`;
}

// ---------- TOP 10 › 베스트 학급 ----------
function GradeCard({ g, rows, cfg, canEdit }) {
  const pool = rows.filter(r => r.grade === g);
  const top = pool.filter(r => r.rank === 1), next = pool.filter(r => r.rank && r.rank > 1).sort((a, b) => a.rank - b.rank)[0];
  const skip = !!cfg.skip[g];
  const setSkip = on => { saveBest({ skip: { [g]: on } }); logAct(`베스트 학급 ${g}학년 ${on ? '수상 안 함으로 표시' : '수상 대상으로 되돌림'}`); };
  return html`<div class=${'bc-card' + (skip ? ' skip' : '') + (top.length && !skip ? ' has' : '')}>
    <div class="bc-card-h"><b>${g}학년</b><span>${pool.length}개 반</span>
      ${canEdit ? html`<label class="switch small bc-skip"><input type="checkbox" checked=${skip} onChange=${e => setSkip(e.target.checked)} /><span>수상 안 함</span></label>` : null}</div>
    ${skip ? html`<span class="bc-none">이 학년은 수상하지 않음</span>`
      : top.length ? html`<div class="bc-card-b">${top.map(r => html`<div class="bc-lead"><${TeamLogo} cls=${r.cls} div=${r.men ? 'M' : 'W'} size=${36} /><b>${SD.classLabel(r.cls)}</b><span>${r.total}점</span></div>`)}
          ${top.length > 1 ? html`<span class="chip warn">동점 · 회의로 결정</span>` : next ? html`<span class="bc-next">2위 ${SD.classLabel(next.cls)} ${next.total}점 · ${top[0].total - next.total}점 차</span>` : null}</div>`
      : html`<span class="bc-none">아직 점수가 없습니다</span>`}
  </div>`;
}
function PointSettings({ cfg, canEdit }) {
  const P = cfg.pts;
  const set = (k, raw) => {
    const v = Math.max(0, Math.min(1000, Math.round(Number(raw)) || 0));
    if (v === num(P[k])) return;
    saveBest({ pts: { [k]: v } }); logAct(`베스트 학급 포인트 기준 변경: ${k} ${num(P[k])}→${v}`);
  };
  const field = (k, label) => html`<label class="field"><span>${label}</span><div class="bc-pt"><input id=${'bc-pt-' + k} class="input" type="number" min="0" max="1000" step="5" inputmode="numeric" value=${num(P[k])} disabled=${!canEdit} onChange=${e => set(k, e.target.value)} /><span>점</span></div></label>`;
  return html`<details class="bc-set">
    <summary><${Icon} n="settings" size=${15} />포인트 기준</summary>
    <div class="bc-set-body">
      <p class="small muted">경기 기록에서 체크 (경기마다)</p>
      <div class="bc-pts">${field('cheerHi', '학급 응원 상')}${field('cheerMid', '학급 응원 중')}${field('cheerLo', '학급 응원 하')}${field('song', '응원가 제작 (학급당 1회)')}${field('flag', '응원깃발 제작 (학급당 1회)')}${field('fight', '경기 전 파이팅 1회')}${field('fair', '페어플레이 1회')}</div>
      <p class="small muted">이 화면에서 체크 (한 번)</p>
      <div class="bc-pts">${field('both', '남·여 리그 둘 다 참가')}${field('teacher', '담임쌤 경기 참여')}</div>
    </div></details>`;
}
function Detail({ r, nav, P }) {
  if (!r.games.length) return html`<div class="bc-detail"><span class="small muted">아직 치른 경기가 없습니다.</span></div>`;
  return html`<div class="bc-detail">${r.games.map(({ m, side, rec }) => {
    const opp = side === 'H' ? m.away : m.home, x = rec || {};
    const lv = x.cheer ? CHEER_LV.find(v => v[0] === x.cheer)[1] : '';
    return html`<div class="bc-game">
      <span class="g-when">${SD.fmtDate(m.date) || '날짜 미정'}</span>
      <span class="g-what">${SD.DIV_LABEL[m.div]} ${UI.stageLabel(m)} · vs ${SD.classLabel(opp)}</span>
      <span class="g-recs">${rec ? html`
        <span class=${'g-tag' + (x.cheer && x.cheer !== 'none' ? ' on' : '')}>응원 ${lv || '미기록'}${x.cheer && x.cheer !== 'none' ? ` +${cheerPts(P, x.cheer)}` : ''}</span>
        ${EXTRAS.map(([k, n]) => (x[k] ? html`<span class="g-tag on">${n}${r.ex[k] && r.ex[k].id === m.id ? ` +${num(P[k])}` : ' (반영됨)'}</span>` : null))}
        ${x.fight ? html`<span class="g-tag on">경기 전 파이팅 +${num(P.fight)}</span>` : null}
        ${x.fair ? html`<span class="g-tag on">페어플레이 +${num(P.fair)}</span>` : null}
        ${(x.fairMemo || '').trim() ? html`<span class="g-memo">“${x.fairMemo.trim()}”</span>` : null}` : html`<span class="small muted">체크 없음</span>`}</span>
      <button type="button" class="btn btn-sm" onClick=${() => nav.openMatch(m.id)}>경기 기록</button>
    </div>`;
  })}</div>`;
}
function BestClass({ L, canEdit, nav }) {
  const cfg = cfgOf();
  const { rows, grades } = bestScores(L, cfg);
  const [grade, setGrade] = usePref('bcGrade', 'all');
  const [order, setOrder] = usePref('bcOrder', 'cls');
  const [open, setOpen] = useState(null);
  const ro = !canEdit, P = cfg.pts;
  const setCls = (c, patch, msg) => { saveBest({ cls: { [c]: patch } }); if (msg) logAct(`베스트 학급 ${c} ${msg}`); };
  const shown = grade === 'all' ? grades : grades.filter(g => String(g) === String(grade));
  if (!rows.length) return html`<section class="panel"><div class="empty"><strong>조편성이 없습니다</strong><span>설정에서 조편성을 입력하면 참가 학급이 여기에 줄을 섭니다.</span></div></section>`;
  const sortRows = pool => (order === 'pts' ? pool.slice().sort((a, b) => b.total - a.total || sortCls(a.cls, b.cls)) : pool);
  return html`<div class="stack" style="gap:14px">
    <div class="bc-cards">${grades.map(g => html`<${GradeCard} key=${g} g=${g} rows=${rows} cfg=${cfg} canEdit=${canEdit} />`)}</div>
    <div class="bc-tools">
      <${Seg} label="학년" value=${String(grade)} onChange=${setGrade} options=${[{ value: 'all', label: '전체' }, ...grades.map(g => ({ value: String(g), label: `${g}학년` }))]} />
      <${Seg} label="정렬" value=${order} onChange=${setOrder} options=${[{ value: 'cls', label: '반 순서' }, { value: 'pts', label: '점수 순' }]} />
      <span class="spacer"></span><${PointSettings} cfg=${cfg} canEdit=${canEdit} />
    </div>
    ${shown.map(g => { const pool = sortRows(rows.filter(r => r.grade === g)); return html`<section class="panel bc-grade" key=${g}>
      <div class="bc-row bc-h"><span>${g}학년</span><span>학급 응원</span><span>경기 전 파이팅</span><span>페어플레이</span><span>남·여 둘 다</span><span>담임쌤 참여</span><span>총점</span><span></span></div>
      ${pool.map(r => { const isOpen = open === r.cls; return html`<div class=${'bc-item' + (r.rank === 1 && !cfg.skip[g] ? ' lead' : '') + (isOpen ? ' open' : '')} key=${r.cls}>
        <div class="bc-row">
          <span class="c-cls"><${TeamLogo} cls=${r.cls} div=${r.men ? 'M' : 'W'} size=${30} /><b>${SD.classLabel(r.cls)}</b>
            <span class="bc-lg">${r.men ? html`<i class="m">남</i>` : null}${r.women ? html`<i class="w">여</i>` : null}</span></span>
          <span class="c-v" data-l="학급 응원">${r.lv.hi + r.lv.mid + r.lv.lo + r.lv.none || r.ex.song || r.ex.flag
            ? html`<b>${r.parts.cheer + r.parts.song + r.parts.flag}</b><small>상${r.lv.hi} 중${r.lv.mid} 하${r.lv.lo}${r.ex.song ? ' · 응원가' : ''}${r.ex.flag ? ' · 깃발' : ''}</small>` : html`<b class="z">–</b>`}</span>
          <span class="c-v" data-l="경기 전 파이팅">${r.fightN ? html`<b>${r.parts.fight}</b><small>${r.fightN}회</small>` : html`<b class="z">–</b>`}</span>
          <span class="c-v" data-l="페어플레이">${r.fairN ? html`<b>${r.parts.fair}</b><small>${r.fairN}회${r.memos.length ? ` · 메모 ${r.memos.length}` : ''}</small>` : html`<b class="z">–</b>`}</span>
          <span class=${'c-v' + (r.auto && r.e.both == null ? ' auto' : '')} data-l="남·여 둘 다"><${Check} on=${r.both} pts=${num(P.both)} ro=${ro} label=${`${SD.classLabel(r.cls)} 남·여 리그 둘 다 참가`} onToggle=${() => setCls(r.cls, { both: !r.both }, `남·여 둘 다 참가 ${r.both ? '해제' : '체크'}`)} /></span>
          <span class="c-v" data-l="담임쌤 참여"><${Check} on=${r.teacher} pts=${num(P.teacher)} ro=${ro} label=${`${SD.classLabel(r.cls)} 담임쌤 경기 참여`} onToggle=${() => setCls(r.cls, { teacher: !r.teacher }, `담임쌤 참여 ${r.teacher ? '해제' : '체크'}`)} /></span>
          <span class="c-tot">${r.total ? html`<b>${r.total}</b><small>${r.rank ? `학년 ${r.rank}위` : ''}</small>` : html`<b class="z">0</b>`}</span>
          <button type="button" class="c-more" aria-expanded=${String(isOpen)} aria-label=${`${SD.classLabel(r.cls)} 경기별 기록 ${isOpen ? '접기' : '보기'}`} onClick=${() => setOpen(isOpen ? null : r.cls)}><${Icon} n="down" size=${18} /></button>
        </div>
        ${isOpen ? html`<${Detail} r=${r} nav=${nav} P=${P} />` : null}
      </div>`; })}</section>`; })}
    <p class="small muted">학급 응원·경기 전 파이팅·페어플레이는 경기 기록 화면 아래 「베스트 학급 체크」에서 경기마다 입력합니다. 남·여 둘 다 참가는 조편성을 보고 미리 체크해 두었습니다(점선). 행을 펼치면 경기별 기록과 페어플레이 메모를 볼 수 있습니다.</p>
  </div>`;
}

// Whole-school order (TV / recap): total points, then higher grade first (3학년부터) and class number; ties share a rank (1, 1, 3).
function overallRanks(rows) {
  const ranked = rows.filter(r => r.total > 0).sort((a, b) => b.total - a.total || SD.clsSortTop(a.cls, b.cls));
  let prev = null, rk = 0;
  ranked.forEach((r, i) => { if (r.total !== prev) { rk = i + 1; prev = r.total; } r.oRank = rk; });
  return ranked;
}

window.BEST = { BestClass, BcPanel, bestScores, overallRanks, cfgOf, DEFAULT_BEST };
})();
