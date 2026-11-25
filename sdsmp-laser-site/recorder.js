/* SDSMP match recorder: match clock, score, goals with assists and time, cards, fair-play deductions, penalty shootout. */
(function () {
'use strict';
const { useState, useEffect, useRef } = preactHooks;
const { html, Icon, TeamLogo, CardIco, Empty, Seg, VenueSelect, StaffSelect, ConfirmBtn, Modal, stageLabel, useTick } = UI;
const { S, DIV_LABEL, PH_LABEL, fmtDate, todayStr, patchDoc, logAct, toast, uid, setDoc, clockMs, fmtMS, halfMin, clockStamp, evTime, evOrder } = SD;

function Stepper({ value, onDec, onInc, label, tag, disabled }) {
  return html`<span class="step" role="group" aria-label=${label}>
    ${tag ? html`<span class="lab">${tag}</span>` : null}
    <button type="button" aria-label=${label + ' 빼기'} disabled=${disabled} onClick=${onDec}>−</button>
    <output aria-live="polite">${value}</output>
    <button type="button" aria-label=${label + ' 더하기'} disabled=${disabled} onClick=${onInc}>+</button></span>`;
}

function Recorder({ mid, L, canEdit, onClose }) {
  const m = S.matches[mid];
  const [pick, setPick] = useState(null); // assist picker: { side, pid, half, sec, eid? }
  const [askReset, setAskReset] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [htAsk, setHtAsk] = useState(null); // half-time reminder: 'end' right after 전반 종료, or { side, pid } when a goal is added at half-time
  const [signs, setSigns] = useState(null); // captains' e-signatures, kept apart from the match in signs/<mid>
  const pickOpen = useRef(false);
  pickOpen.current = !!pick || askReset || signOpen || !!htAsk; // Esc closes the pop-up, not the whole recorder
  useEffect(() => {
    if (!S.db) { setSigns({}); return; }
    let un = null;
    try { un = S.db.doc('signs/' + mid).onSnapshot(d => setSigns(d.exists ? d.data() : {}), () => setSigns({})); } catch (e) { setSigns({}); }
    return () => { if (typeof un === 'function') un(); };
  }, [mid]);
  useEffect(() => {
    SD.setPresence({ mid });
    const k = e => { if (e.key === 'Escape' && !pickOpen.current && !e.target.closest('input,textarea,select')) onClose(); };
    window.addEventListener('keydown', k);
    return () => { SD.setPresence({ mid: null }); window.removeEventListener('keydown', k); SD.flushAll(); };
  }, [mid]);
  if (!m) return html`<div class="sheet-wrap"><div class="sheet"><div class="rec-top"><button class="icon-btn" aria-label="닫기" onClick=${onClose}><${Icon} n="back" /></button><span class="t">경기를 찾을 수 없습니다</span></div></div></div>`;

  const R = L.R;
  const path = 'matches/' + m.id;
  const tbd = !m.home || !m.away;
  const ro = !canEdit || tbd;
  const ko = m.stage !== 'group';
  const fresh = () => S.matches[mid] || m; // read at click time so fast taps never use a stale copy
  const patch = (p, delay) => {
    const c = fresh(), extra = {};
    if (c.status === 'scheduled' && (p.ps || p.pk || 'scoreH' in p || 'scoreA' in p)) { extra.status = 'live'; if (!c.date) extra.date = todayStr(); }
    return patchDoc(path, { ...p, ...extra }, delay);
  };
  const setStatus = st => {
    const c = fresh();
    if (st === c.status || tbd) return false;
    if (st === 'final' && ko && (c.scoreH | 0) === (c.scoreA | 0)) {
      const pk = SD.pkScore(c);
      if (!pk || pk[0] === pk[1]) { toast('토너먼트는 무승부가 없습니다. 아래 승부차기 결과를 먼저 입력하세요.', 'err'); return false; }
    }
    const p = { status: st };
    if (st !== 'scheduled' && !c.date) p.date = todayStr();
    const ck = c.clock;
    if (st === 'scheduled' && ck) p.clock = null;
    if (st === 'final' && ck && ck.ph !== 'FT') p.clock = { ph: 'FT', run: false, t0: 0, acc: 0, ...(ck.ph === '1H' ? { h1: clockMs(c) } : ck.ph === '2H' ? { h2: clockMs(c) } : {}) };
    if (!patchDoc(path, p, 0)) return false;
    if (st === 'final') {
      logAct(`${DIV_LABEL[c.div]} ${stageLabel(c)} ${c.home} ${c.scoreH}:${c.scoreA} ${c.away} 경기 종료`);
      toast('경기 결과를 확정했습니다.');
      if (c.next) SD.advanceWinner(S.matches[c.id]);
    } else if (st === 'live') logAct(`${c.home} vs ${c.away} 경기 시작`);
    return true;
  };

  // ---------- match clock ----------
  const clk = (p, msg) => { if (patchDoc(path, { clock: p }, 0) && msg) logAct(`${m.home} vs ${m.away} ${msg}`); };
  const act = {
    start: () => {
      const c = fresh(), p = { clock: { ph: '1H', run: true, t0: Date.now(), acc: 0, h1: 0, h2: 0 } };
      if (c.status !== 'live') p.status = 'live';
      if (!c.date) p.date = todayStr();
      if (patchDoc(path, p, 0)) { logAct(`${c.home} vs ${c.away} 경기 시작`); toast('전반 시작! 시간이 흐릅니다.'); }
    },
    pause: () => clk({ run: false, acc: clockMs(fresh()), t0: 0 }),
    resume: () => clk({ run: true, t0: Date.now() }),
    endHalf: () => { clk({ ph: 'HT', run: false, h1: clockMs(fresh()), acc: 0, t0: 0 }, '전반 종료'); setHtAsk('end'); },
    start2: () => clk({ ph: '2H', run: true, t0: Date.now(), acc: 0 }, '후반 시작'),
    // Final whistle stops the clock; the result is closed only after both captains sign (기록 종료).
    end: () => clk({ ph: 'FT', run: false, t0: 0, acc: 0, h2: clockMs(fresh()) }, '경기 종료 · 주장 서명 대기'),
    reset: () => clk(null),
  };

  // ---------- goals: + opens the assist picker; the goal, its assist and the clock time land together ----------
  const sideKey = s => (s === 'H' ? 'scoreH' : 'scoreA');
  const num = (ps, pid, k) => Number((ps[pid] || {})[k]) || 0;
  const openGoal = (side, pid) => {
    const c = fresh();
    if (c.clock && c.clock.ph === 'HT') { setHtAsk({ side, pid }); return; } // the 후반 clock has not been started yet
    setPick({ side, pid, ...clockStamp(c) });
  };
  const htGoal = start2nd => {
    const a = htAsk; setHtAsk(null);
    if (!a || a === 'end') return;
    if (start2nd) act.start2();
    setPick({ side: a.side, pid: a.pid, ...clockStamp(fresh()) });
  };
  const addGoal = (side, pid, ast, half, sec) => {
    const c = fresh(), ps = c.ps || {}, sk = sideKey(side);
    const pp = { [pid]: { g: num(ps, pid, 'g') + 1 } };
    if (ast) pp[ast] = { a: num(ps, ast, 'a') + 1 };
    const ev = { id: uid('e'), side, pid, ast: ast || '', half: half || '', sec: sec == null ? null : sec, at: Date.now() };
    if (!patch({ ps: pp, [sk]: (c[sk] | 0) + 1, goals: [...(c.goals || []), ev] }, 0)) return;
    const p = S.players[pid], a = ast && S.players[ast];
    logAct(`${c.home} vs ${c.away} · ${evTime(ev) ? evTime(ev) + ' ' : ''}${p ? `${p.cls} ${p.name}` : ''} 골${a ? ` (어시스트 ${a.name})` : ''}`);
  };
  const dropGoal = ev => {
    const c = fresh(), ps = c.ps || {}, sk = sideKey(ev.side);
    const pp = { [ev.pid]: { g: Math.max(0, num(ps, ev.pid, 'g') - 1) } };
    if (ev.ast) pp[ev.ast] = { a: Math.max(0, num(ps, ev.ast, 'a') - 1) };
    patch({ ps: pp, [sk]: Math.max(0, (c[sk] | 0) - 1), goals: (c.goals || []).filter(x => x.id !== ev.id) }, 0);
  };
  const goalDec = (side, pid) => {
    const c = fresh(), ps = c.ps || {}, sk = sideKey(side);
    const mine = (c.goals || []).filter(e => e.pid === pid).sort((a, b) => (a.at || 0) - (b.at || 0));
    if (mine.length) return dropGoal(mine[mine.length - 1]); // undo this player's most recent goal
    const g = num(ps, pid, 'g');
    if (g > 0) patch({ ps: { [pid]: { g: g - 1 } }, [sk]: Math.max(0, (c[sk] | 0) - 1) }); // goals entered before the timeline existed
  };
  const setAssist = (eid, ast) => {
    const c = fresh(), ev = (c.goals || []).find(x => x.id === eid);
    if (!ev || (ev.ast || '') === (ast || '')) return;
    const ps = c.ps || {}, pp = {};
    if (ev.ast) pp[ev.ast] = { a: Math.max(0, num(ps, ev.ast, 'a') - 1) };
    if (ast) pp[ast] = { a: num(ps, ast, 'a') + 1 };
    patch({ ps: pp, goals: c.goals.map(x => (x.id === eid ? { ...x, ast: ast || '' } : x)) }, 0);
  };
  const choose = ast => {
    const pk = pick; setPick(null);
    if (!pk) return;
    if (pk.eid) setAssist(pk.eid, ast); else addGoal(pk.side, pk.pid, ast, pk.half, pk.sec);
  };

  // Wipe this match's result back to '예정': score, player goals/assists/cards, goal timeline, shootout and clock.
  // Date, time, pitch, referee, recorder and memo stay.
  const resetMatch = async () => {
    setAskReset(false);
    const c = fresh(), won = SD.winnerOf(c);
    const { id, ps, goals, pk, pkH, pkA, clock, scoreH, scoreA, status, bc, updatedAt, updatedBy, ...keep } = c;
    const doc = { ...keep, status: 'scheduled', scoreH: 0, scoreA: 0, ps: {}, goals: [], pkH: null, pkA: null, clock: null };
    if (c.stage !== 'group') doc.pk = { H: [], A: [] };
    Object.keys(doc).forEach(k => { if (doc[k] === undefined) delete doc[k]; });
    if (!(await setDoc(path, doc))) return;
    if (signs && (signs.H || signs.A)) { SD.delDoc('signs/' + mid); setSigns({}); }
    if (c.next && won) { // undo the automatic advance if the next round hasn't started
      const nm = S.matches[c.next.mid];
      if (nm && !SD.hasResult(nm) && nm[c.next.side] === won) patchDoc('matches/' + nm.id, { [c.next.side]: '' }, 0);
    }
    logAct(`${DIV_LABEL[c.div]} ${stageLabel(c)} ${c.home} vs ${c.away} 경기 기록 초기화`);
    toast('경기 기록을 초기화했습니다.');
  };
  const canReset = !ro && (SD.hasResult(m) || !!m.clock || (m.goals || []).length > 0 || !!(signs && (signs.H || signs.A)));

  // ---------- captains' e-signatures ----------
  // A signature is tied to the result it confirmed; if the score or shootout changes afterwards it no longer counts.
  const okSign = s => !!(s && s.img && s.res === resKey(m));
  const signN = ['H', 'A'].filter(k => okSign(signs && signs[k])).length;
  const writeSigns = async next => {
    const clean = {}; ['H', 'A'].forEach(k => { if (next[k]) clean[k] = next[k]; });
    setSigns(clean);
    return setDoc('signs/' + mid, clean);
  };
  const saveSign = async (side, entry) => {
    const c = fresh(), cls = side === 'H' ? c.home : c.away;
    const ok = await writeSigns({ ...(signs || {}), [side]: { ...entry, res: resKey(c), at: Date.now(), by: S.myId || null } });
    if (ok) logAct(`${c.home} vs ${c.away} · ${cls} 주장 ${entry.name} 전자서명 (${resKey(c)})`);
    return ok;
  };
  const clearSign = side => writeSigns({ ...(signs || {}), [side]: null });
  const finish = force => {
    if (!force && signN < 2) { setSignOpen(true); return; }
    if (setStatus('final')) {
      setSignOpen(false);
      if (!force) logAct(`${m.home} vs ${m.away} 양 팀 주장 서명 확인 · 기록 종료`);
    }
  };
  const sign = { n: signN, open: () => setSignOpen(true), finish: () => finish(false) };

  const others = S.peers.filter(p => !p.sameTab && p.presence && p.presence.mid === mid);
  const level = (m.scoreH | 0) === (m.scoreA | 0);
  const side = (cls, sk, label) => html`<div class="side"><${TeamLogo} cls=${cls} div=${m.div} size=${72} /><span class="tname">${cls || '미정'}</span>
    ${ro ? null : html`<div class="scorebox"><button class="icon-btn" aria-label=${label + ' 점수 빼기'} onClick=${() => patch({ [sk]: Math.max(0, (fresh()[sk] | 0) - 1) })}><${Icon} n="minus" /></button><button class="icon-btn" aria-label=${label + ' 점수 더하기'} onClick=${() => patch({ [sk]: (fresh()[sk] | 0) + 1 })}><${Icon} n="plus" /></button></div>`}</div>`;

  return html`<div class="sheet-wrap" onClick=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="경기 기록">
      <div class="rec-top">
        <button class="icon-btn" aria-label="닫기" onClick=${onClose}><${Icon} n="back" /></button>
        <div><div class="t">${DIV_LABEL[m.div]} ${stageLabel(m)}</div><div class="small" style="color:var(--rail-dim)">${fmtDate(m.date)} ${m.time || ''} ${m.venue ? '· ' + m.venue : ''}${m.referee ? ` · 심판 ${m.referee}` : ''}${m.recorder ? ` · 기록 ${m.recorder}` : ''}</div></div>
        <${Seg} label="경기 상태" value=${m.status} onChange=${ro ? () => {} : v => (v === 'final' && signN < 2 ? setSignOpen(true) : setStatus(v))} options=${[
          { value: 'scheduled', label: '예정' }, { value: 'live', label: '진행중', cls: 'st-live' }, { value: 'final', label: '종료됨', cls: 'st-final' }]} />
        <span class="saved">${tbd ? '상대 팀이 정해지면 기록할 수 있습니다' : !canEdit ? '보기 전용' : SD.VIEWER ? '둘러보기 · 저장되지 않음' : S.saving ? '저장 중…' : S.lastSaved ? `저장됨 ${SD.fmtClock(S.lastSaved)}` : '변경하면 바로 저장됩니다'}</span>
      </div>
      <div class="rec-body">
        ${others.length ? html`<div class="peerwarn"><${Icon} n="users" /><span><b>${others.map(p => SD.personName(p.by, p.presence.nick)).join(', ')}</b> 님도 이 경기를 열어 두었습니다. 같은 항목을 동시에 고치면 마지막 입력이 남습니다.</span></div>` : null}
        ${m.status === 'final' && canEdit ? html`<div class="banner warn small" style="margin:0"><${Icon} n="edit" /><span>종료된 경기입니다. 수정하면 순위와 출전 정지가 다시 계산됩니다.</span></div>` : null}
        <div class=${'board ' + m.div}>
          ${side(m.home, 'scoreH', m.home)}
          <div class="scorebox"><span class="big">${m.scoreH | 0}</span><span class="colon">:</span><span class="big">${m.scoreA | 0}</span></div>
          ${side(m.away, 'scoreA', m.away)}
          ${SD.pkScore(m) ? html`<div class="note" style="color:#fff;font-weight:700">승부차기 ${SD.pkScore(m)[0]} : ${SD.pkScore(m)[1]}</div>` : null}
          ${tbd ? null : html`<${MatchClock} m=${m} R=${R} ro=${ro} act=${act} sign=${sign} />`}
          <div class="note">선수 골의 + 를 누르면 어시스트 선수를 고르고, 경기 시간이 흐르는 중이면 득점 시간도 함께 남습니다. 자책골처럼 득점자가 없는 골은 팀 점수 버튼으로만 조정하세요.</div>
        </div>
        ${canEdit ? html`<div class="panel"><div class="panel-body form-grid">
          <label class="field"><span>날짜</span><input id="rec-date" type="date" class="input" value=${m.date || ''} onInput=${e => patchDoc(path, { date: e.target.value })} /></label>
          <label class="field"><span>시간</span><input id="rec-time" type="time" class="input" value=${m.time || ''} onChange=${e => patchDoc(path, { time: e.target.value })} /></label>
          <label class="field"><span>구장</span><${VenueSelect} id="rec-venue" L=${L} value=${m.venue} onChange=${v => patchDoc(path, { venue: v }, 0)} /></label>
          <label class="field"><span>기록 담당</span><${StaffSelect} id="rec-by" list=${L.staff.recs} value=${m.recorder} placeholder="기록 담당 선택" onChange=${v => patchDoc(path, { recorder: v }, 0)} /></label>
          <label class="field"><span>심판</span><${StaffSelect} id="rec-ref" list=${L.staff.refs} value=${m.referee} placeholder="심판 선택" onChange=${v => patchDoc(path, { referee: v }, 0)} /></label>
        </div></div>` : null}
        ${tbd ? html`<div class="panel"><${Empty} title="아직 대진이 정해지지 않았습니다">앞 경기가 끝나면 진출 팀이 자동으로 들어옵니다.</${Empty}></div>` : html`
        <div class="rec-cols">
          <${TeamSheet} m=${m} side="H" L=${L} R=${R} ro=${ro} patch=${patch} onGoal=${openGoal} onGoalDec=${goalDec} />
          <${TeamSheet} m=${m} side="A" L=${L} R=${R} ro=${ro} patch=${patch} onGoal=${openGoal} onGoalDec=${goalDec} />
        </div>`}
        ${ko && !tbd && (m.status !== 'scheduled' || (m.pk && ((m.pk.H || []).length || (m.pk.A || []).length))) ? html`<${Shootout} m=${m} L=${L} ro=${ro} patch=${patch} level=${level} />` : null}
        ${tbd ? null : html`<${Timeline} m=${m} ro=${ro} onEdit=${e => setPick({ side: e.side, pid: e.pid, half: e.half, sec: e.sec, eid: e.id })} onDel=${dropGoal} />`}
        ${signs && (signs.H || signs.A) ? html`<${SignView} m=${m} signs=${signs} okSign=${okSign} n=${signN} />` : null}
        ${tbd ? null : html`<${BEST.BcPanel} m=${m} ro=${ro} />`}
        <section class="panel"><div class="panel-head"><h3>메모</h3><span class="sub">몰수, 경기 중단, 특이사항</span></div>
          <div class="panel-body">${!canEdit ? html`<p>${m.note || '없음'}</p>` : html`<textarea id="rec-note" class="textarea" rows="3" value=${m.note || ''} onInput=${e => patchDoc(path, { note: e.target.value }, 900)}></textarea>`}</div></section>
        ${!ro && (canReset || m.status !== 'final') ? html`<div class="row">
          ${canReset ? html`<button type="button" class="btn btn-danger" style="height:42px;padding:0 18px" onClick=${() => setAskReset(true)}><${Icon} n="trash" size=${16} />경기 기록 초기화</button>` : null}
          <span class="spacer"></span>
          ${m.status !== 'final' ? (signN === 2
            ? html`<button class="btn btn-primary" style="height:42px;padding:0 22px" onClick=${() => finish(false)}>기록 종료 · 결과 확정</button>`
            : html`<button class="btn btn-primary" style="height:42px;padding:0 22px" onClick=${() => setSignOpen(true)}><${Icon} n="sign" size=${17} />주장 전자서명 · 기록 종료</button>`) : null}</div>` : null}
      </div>
    </div>
    ${pick ? html`<${AssistPicker} m=${m} L=${L} pick=${pick} onChoose=${choose} onCancel=${() => setPick(null)} />` : null}
    ${signOpen ? html`<${SignModal} m=${m} L=${L} signs=${signs || {}} okSign=${okSign} canEdit=${canEdit} onSave=${saveSign} onClear=${clearSign}
      onFinish=${() => finish(false)} onForce=${() => finish(true)} onClose=${() => setSignOpen(false)} />` : null}
    ${htAsk ? html`<${Modal} cls="ht-alert" title=${htAsk === 'end' ? '전반 종료' : '아직 하프타임이에요'} onClose=${() => setHtAsk(null)} foot=${htAsk === 'end'
        ? html`<button type="button" class="btn btn-primary" style="min-width:96px" onClick=${() => setHtAsk(null)}>확인</button>`
        : html`<button type="button" class="btn" onClick=${() => htGoal(false)}>전반 득점으로 기록</button><button type="button" class="btn btn-primary" onClick=${() => htGoal(true)}>후반 시작하고 기록</button>`}>
      <div class="ht-msg"><span class="ht-ico" aria-hidden="true"><${Icon} n="timer" size=${28} /></span><b>후반전 시작 버튼을 누르고<br />기록을 시작해주세요!</b></div>
      <p class="small muted" style="text-align:center">${htAsk === 'end'
        ? '하프타임 동안에는 경기 시간이 멈춰 있어요. 후반 킥오프 휘슬이 울리면 점수판 아래 「후반 시작」을 누르세요.'
        : '후반전에 넣은 골이라면 「후반 시작」을 먼저 눌러야 득점 시간이 함께 남아요. 전반에 넣었는데 늦게 기록하는 골이면 「전반 득점으로 기록」을 누르세요.'}</p>
    </${Modal}>` : null}
    ${askReset ? html`<${Modal} title="경기 기록 초기화" onClose=${() => setAskReset(false)} foot=${html`<button type="button" class="btn" onClick=${() => setAskReset(false)}>아니오</button><button type="button" class="btn btn-danger armed" onClick=${resetMatch}>예</button>`}>
      <p class="reset-q">이 경기 기록을 초기화하시겠습니까?</p>
      <p class="small muted">${m.home} ${m.scoreH | 0} : ${m.scoreA | 0} ${m.away} · 점수, 선수별 골·어시스트·카드, 득점 기록, 승부차기, 경기 시간, 주장 서명, 베스트 학급 체크가 지워지고 경기 상태가 '예정'으로 돌아갑니다. 날짜·시간·구장·심판·기록 담당·메모는 그대로 남습니다.</p>
    </${Modal}>` : null}
  </div>`;
}

// Kick-off button under the score; once pressed the same spot shows the running half clock and its controls.
function MatchClock({ m, R, ro, act, sign }) {
  const c = m.clock;
  useTick(!!(c && c.run), 500);
  const min = halfMin(m, R), hl = min * 60000;
  if (!c || !c.ph) {
    if (ro || m.status === 'final') return null;
    return html`<div class="clockbar idle"><button type="button" class="kick" onClick=${act.start}><${Icon} n="play" size=${18} />경기 시작</button>
      <span class="clk-sub">${m.stage === 'group' ? '조별리그' : '토너먼트'} 전·후반 각 ${min}분 · 휘슬과 함께 누르세요</span></div>`;
  }
  if (c.ph === '1H' || c.ph === '2H') {
    const ms = clockMs(m), over = ms > hl;
    return html`<div class=${'clockbar run' + (over ? ' over' : '') + (c.run ? '' : ' paused')} role="timer" aria-live="off">
      <div class="clk"><span class="ph">${PH_LABEL[c.ph]}</span><span class="t">${fmtMS(ms)}</span><span class="of">/ ${fmtMS(hl)}</span>
        ${over ? html`<span class="add">추가 +${fmtMS(ms - hl)}</span>` : null}${c.run ? null : html`<span class="add">일시정지</span>`}</div>
      <div class="clk-bar" aria-hidden="true"><i style=${`width:${Math.min(100, ms / hl * 100)}%`}></i></div>
      ${ro ? null : html`<div class="clk-ctl">
        <button type="button" class="btn ghost" onClick=${c.run ? act.pause : act.resume}><${Icon} n=${c.run ? 'pause' : 'play'} size=${15} />${c.run ? '일시정지' : '재개'}</button>
        ${c.ph === '1H' ? html`<button type="button" class=${'btn half' + (over ? ' pulse' : '')} onClick=${act.endHalf}>전반 종료</button>`
          : html`<button type="button" class=${'btn fin' + (over ? ' pulse' : '')} onClick=${act.end}>경기 종료</button>`}</div>`}
    </div>`;
  }
  if (c.ph === 'HT') return html`<div class="clockbar ht"><div class="clk"><span class="ph">하프타임</span><span class="of">전반 ${fmtMS(c.h1 || 0)} 진행</span></div>
    ${ro ? null : html`<div class="clk-ctl"><button type="button" class="kick go2" onClick=${act.start2}><${Icon} n="play" size=${18} />후반 시작</button></div>
      <span class="clk-sub">후반 킥오프와 함께 누르세요 · 누르기 전에는 경기 시간이 흐르지 않습니다</span>`}</div>`;
  // after the final whistle: captains sign here, then 기록 종료 closes the result
  return html`<div class="clockbar ft"><div class="clk"><span class="ph">경기 종료</span><span class="of">전반 ${fmtMS(c.h1 || 0)} · 후반 ${fmtMS(c.h2 || 0)}</span></div>
    ${!ro && m.status !== 'final' ? html`<div class="clk-ctl">
      <button type="button" class=${'kick sign' + (sign.n === 2 ? ' done' : '')} onClick=${sign.open}><${Icon} n="sign" size=${18} />전자서명<span class="cnt">${sign.n}/2</span></button>
      <button type="button" class="btn fin" disabled=${sign.n < 2} title=${sign.n < 2 ? '양 팀 주장 서명을 마치면 누를 수 있습니다' : ''} onClick=${sign.finish}>기록 종료</button>
    </div>
    <span class="clk-sub">${sign.n < 2 ? '양 팀 주장이 서명하면 「기록 종료」를 누를 수 있습니다' : '서명 완료 · 「기록 종료」로 결과를 확정하세요'}</span>
    <button type="button" class="linkish small" style="color:var(--rail-dim)" onClick=${act.reset}>시계 초기화</button>` : null}
    ${m.status === 'final' && sign.n === 2 ? html`<span class="clk-sub">양 팀 주장 서명 완료</span>` : null}</div>`;
}

// Small dimmed pop-up after a goal +: tap the teammate who set it up, or "no assist".
function AssistPicker({ m, L, pick, onChoose, onCancel }) {
  useEffect(() => { const k = e => { if (e.key === 'Escape') onCancel(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const cls = pick.side === 'H' ? m.home : m.away;
  const scorer = S.players[pick.pid];
  const ev = pick.eid ? (m.goals || []).find(x => x.id === pick.eid) : null;
  const susp = new Set((L.suspByMatch[m.id] || []).map(e => e.pid));
  const mates = (L.playersByTeam[SD.tkey(m.div, cls)] || []).filter(p => p.id !== pick.pid && !susp.has(p.id) && !L.banOf(p));
  const when = pick.half ? evTime(pick) : '경기 시간 없이 기록';
  return html`<div class="modal-wrap pick-wrap" onClick=${e => { if (e.target === e.currentTarget) onCancel(); }}>
    <div class=${'modal pick ' + m.div} role="dialog" aria-modal="true" aria-label="어시스트 선수 선택">
      <div class="pick-head"><${TeamLogo} cls=${cls} div=${m.div} size=${44} />
        <div><b class="pick-title">${scorer ? scorer.name : '선수'} ${ev ? '골' : '골!'}</b><span class="pick-sub">${cls} · ${when}</span></div></div>
      <p class="pick-q">${ev ? '어시스트 선수를 바꿉니다' : '누가 어시스트했나요?'}</p>
      ${mates.length ? html`<div class="pick-grid">${mates.map(p => html`<button type="button" class=${'pick-btn' + (ev && ev.ast === p.id ? ' on' : '')} onClick=${() => onChoose(p.id)}>${p.name}</button>`)}</div>`
        : html`<p class="small muted">같은 반에 고를 수 있는 다른 선수가 없습니다.</p>`}
      <button type="button" class=${'pick-none' + (ev && !ev.ast ? ' on' : '')} onClick=${() => onChoose('')}>어시스트 없음 · 단독 득점</button>
      <div class="pick-foot"><button type="button" class="btn" onClick=${onCancel}>취소</button></div>
    </div></div>`;
}

// Goal timeline between the team sheets and the memo: when, who scored, who assisted.
function Timeline({ m, ro, onEdit, onDel }) {
  const evs = (m.goals || []).slice().sort(evOrder);
  const total = (m.scoreH | 0) + (m.scoreA | 0);
  const showScore = evs.length === total; // a running score only adds up when every goal has an entry
  let h = 0, a = 0;
  const rows = evs.map(e => { if (e.side === 'H') h++; else a++; return { e, h, a }; });
  const untimed = Math.max(0, total - evs.length);
  return html`<section class=${'panel ' + m.div}><div class="panel-head"><h3>득점 기록</h3><span class="sub">시간 · 득점 · 어시스트</span><div class="end"><span class="chip">${evs.length}골</span></div></div>
    ${rows.length ? html`<ol class="tl">${rows.map(({ e, h: hh, a: aa }) => {
      const p = S.players[e.pid], as = e.ast ? S.players[e.ast] : null, cls = e.side === 'H' ? m.home : m.away;
      return html`<li class=${'tl-row ' + e.side} key=${e.id}>
        <span class="tl-t">${e.half ? evTime(e) : '시간 없음'}</span>
        <span class="tl-who"><${TeamLogo} cls=${cls} div=${m.div} size=${24} /><b>${p ? p.name : '(삭제된 선수)'}</b><span class="tl-cls">${cls}</span>
          ${ro ? html`<span class=${'tl-ast' + (as ? '' : ' none')}>${as ? `어시스트 ${as.name}` : '단독 득점'}</span>`
            : html`<button type="button" class=${'tl-ast' + (as ? '' : ' none')} title="어시스트 선수 바꾸기" onClick=${() => onEdit(e)}>${as ? `어시스트 ${as.name}` : '어시스트 없음'}<${Icon} n="edit" size=${12} /></button>`}</span>
        ${showScore ? html`<span class="tl-sc">${hh}:${aa}</span>` : null}
        ${ro ? null : html`<${ConfirmBtn} armedText="삭제" onConfirm=${() => onDel(e)}><${Icon} n="trash" size=${14} /></${ConfirmBtn}>`}
      </li>`; })}</ol>`
      : html`<${Empty} title="아직 기록된 골이 없습니다">선수의 골 + 를 누르면 몇 분 몇 초에 누가 넣고 누가 도왔는지 여기에 남습니다.</${Empty}>`}
    ${untimed ? html`<div class="panel-body small muted" style="border-top:1px solid var(--line-2)">이 목록에 없는 골 ${untimed}개: 팀 점수 버튼이나 이전 방식으로 입력한 골입니다.</div>` : null}
  </section>`;
}

function TeamSheet({ m, side, L, R, ro, patch, onGoal, onGoalDec }) {
  const cls = side === 'H' ? m.home : m.away;
  const sk = side === 'H' ? 'scoreH' : 'scoreA';
  const roster = L.playersByTeam[SD.tkey(m.div, cls)] || [];
  const ps = m.ps || {};
  const susp = Object.fromEntries((L.suspByMatch[m.id] || []).map(e => [e.pid, e]));
  const sumG = roster.reduce((s, p) => s + ((ps[p.id] && Number(ps[p.id].g)) || 0), 0);
  const diff = (m[sk] | 0) - sumG;
  const [name, setName] = useState('');
  const adding = useRef({ busy: false, last: '', at: 0 });
  const st = pid => ps[pid] || {};
  const card = (pid, k) => {
    const p = S.players[pid]; const on = !st(pid)[k];
    patch({ ps: { [pid]: { [k]: on ? 1 : 0 } } }, 0);
    if (on && p) logAct(`${m.home} vs ${m.away} · ${p.cls} ${p.name} ${k === 'r' ? '레드' : '옐로'}카드`);
  };
  // One name → one player. Korean input can fire Enter twice (once while the syllable is still composing),
  // and a quick double tap can too, so a second call for the same name within a moment is ignored.
  const quickAdd = async () => {
    const t = name.trim(), g = adding.current;
    if (!t || g.busy) return;
    if (g.last === t && Date.now() - g.at < 2000) return;
    if (roster.some(p => String(p.name).trim() === t)) { toast(`${cls}에 이미 '${t}' 선수가 있습니다.`, 'err'); return; }
    g.busy = true; g.last = t; g.at = Date.now();
    setName('');
    const ok = await setDoc('players/' + uid('p'), { sport: m.sport, div: m.div, cls, name: t, createdAt: Date.now() });
    g.busy = false;
    if (ok) logAct(`${cls} ${t} 선수 등록`); else setName(t);
  };
  return html`<section class=${'panel ' + m.div}>
    <div class="panel-head"><${TeamLogo} cls=${cls} div=${m.div} size=${30} /><h3 class="team" style="font-size:18px">${cls}</h3><span class="sub">선수 ${roster.length}명 · 득점자 기록 ${sumG}골</span>
      ${diff > 0 ? html`<div class="end"><span class="chip">득점자 미기록 ${diff}골</span></div>` : diff < 0 ? html`<div class="end"><span class="chip warn">팀 점수보다 선수 득점이 ${-diff}골 많음</span></div>` : null}</div>
    ${roster.length ? roster.map(p => {
      const s = st(p.id);
      const sp = susp[p.id];
      const ban = L.banOf(p);
      const has = (Number(s.g) || 0) || (Number(s.a) || 0) || s.y || s.r || s.fp;
      const off = (sp || ban) && !has;
      const fp = SD.fpOf(s, R);
      const nextBan = s.r ? R.rBan : s.y ? R.yBan : 0;
      return html`<div class=${'prow' + (sp || ban ? ' off' : '')} key=${p.id}>
        <div class="who"><span class="nm">${p.name}</span>
          ${sp ? html`<span class="chip warn"><${CardIco} t=${sp.type} /> 출전 정지${sp.total > 1 ? ` ${sp.nth}/${sp.total}` : ''}</span>` : null}
          ${ban ? html`<span class="chip ban">영구 출전 금지</span>` : null}
          ${nextBan ? html`<span class="chip">다음 ${nextBan}경기 정지</span>` : null}</div>
        ${off ? html`<span class="small muted">이번 경기 출전 불가</span>` : html`<div class="ctl">
          <${Stepper} label=${p.name + ' 득점'} tag="골" value=${Number(s.g) || 0} disabled=${ro} onDec=${() => onGoalDec(side, p.id)} onInc=${() => onGoal(side, p.id)} />
          <span class=${'apill' + ((Number(s.a) || 0) ? ' on' : '')} title="어시스트는 동료의 골을 기록할 때 고릅니다"><small>어시스트</small><b>${Number(s.a) || 0}</b></span>
          <button type="button" class="cardbtn y" aria-pressed=${String(!!s.y)} aria-label=${p.name + ' 옐로카드'} title="옐로카드" disabled=${ro} onClick=${() => card(p.id, 'y')}><i></i></button>
          <button type="button" class="cardbtn r" aria-pressed=${String(!!s.r)} aria-label=${p.name + ' 레드카드'} title="레드카드" disabled=${ro} onClick=${() => card(p.id, 'r')}><i></i></button>
          <span class=${'fpv' + (fp < 0 ? ' neg' : '')} title="이 경기 페어플레이 점수">${fp}</span>
        </div>`}
      </div>`;
    }) : html`<${Empty} title="명단이 없습니다">아래에서 바로 선수를 추가할 수 있습니다.</${Empty}>`}
    ${ro ? null : html`<div class="panel-body row" style="border-top:1px solid var(--line-2)">
      <input id=${'quick-add-' + side} class="input" style="flex:1;min-width:140px" aria-label=${cls + ' 선수 추가'} placeholder="이름" value=${name} onInput=${e => setName(e.target.value)}
        onKeyDown=${e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); quickAdd(); } }} />
      <button type="button" class="btn" onClick=${quickAdd}><${Icon} n="plus" />선수 추가</button></div>`}
    <div class="panel-body small muted" style="border-top:1px solid var(--line-2)">골 + → 어시스트 선수 선택 · <${CardIco} t="Y" /> 옐로(${R.yFp}) · <${CardIco} t="R" /> 레드(${R.rFp}) · 이 경기 페어플레이 점수</div>
  </section>`;
}

// Penalty shootout: 3 kickers each, then sudden death from the 4th. Kicks never count as goals in the rankings.
// ---------- captains' e-signature ----------
const resKey = c => { const pk = SD.pkScore(c); return `${c.scoreH | 0}:${c.scoreA | 0}${pk ? ` 승부차기 ${pk[0]}:${pk[1]}` : ''}`; };
// Finger / pen pad. Strokes are kept in 0–1 coordinates so a resize redraws them; png() exports dark ink on transparent.
function SignPad({ api, onInk }) {
  const ref = useRef(null), strokes = useRef([]), cur = useRef(null);
  const paint = () => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'), r = cv.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    drawInk(ctx, strokes.current, r.width, r.height, 2.6);
  };
  useEffect(() => {
    const cv = ref.current;
    const size = () => { const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1; cv.width = Math.max(1, Math.round(r.width * d)); cv.height = Math.max(1, Math.round(r.height * d)); cv.getContext('2d').setTransform(d, 0, 0, d, 0, 0); paint(); };
    size();
    const ro = window.ResizeObserver ? new ResizeObserver(size) : null; if (ro) ro.observe(cv);
    api.current = {
      clear: () => { strokes.current = []; paint(); onInk(false); },
      png: () => {
        const r = cv.getBoundingClientRect(), w = 480, h = Math.round(480 * r.height / Math.max(1, r.width));
        const o = document.createElement('canvas'); o.width = w; o.height = h;
        drawInk(o.getContext('2d'), strokes.current, w, h, 2.6 * w / Math.max(1, r.width));
        return o.toDataURL('image/png');
      },
    };
    return () => { if (ro) ro.disconnect(); };
  }, []);
  const pt = e => { const r = ref.current.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const down = e => { e.preventDefault(); try { ref.current.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } cur.current = [pt(e)]; strokes.current.push(cur.current); paint(); };
  const move = e => {
    if (!cur.current) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    (evs.length ? evs : [e]).forEach(ev => cur.current.push(pt(ev)));
    paint();
  };
  const up = () => { if (!cur.current) return; cur.current = null; onInk(strokes.current.length > 0); };
  return html`<div class="sign-pad"><canvas ref=${ref} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onPointerLeave=${up} aria-label="서명 칸"></canvas>
    <span class="ph" aria-hidden="true">여기에 서명하세요</span></div>`;
}
function drawInk(ctx, strokes, w, h, lw) {
  ctx.save(); ctx.strokeStyle = '#0E1834'; ctx.fillStyle = '#0E1834'; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  strokes.forEach(s => {
    if (s.length === 1) { ctx.beginPath(); ctx.arc(s[0][0] * w, s[0][1] * h, lw / 2, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.beginPath(); ctx.moveTo(s[0][0] * w, s[0][1] * h);
    for (let i = 1; i < s.length - 1; i++) { const mx = (s[i][0] + s[i + 1][0]) / 2, my = (s[i][1] + s[i + 1][1]) / 2; ctx.quadraticCurveTo(s[i][0] * w, s[i][1] * h, mx * w, my * h); }
    const l = s[s.length - 1]; ctx.lineTo(l[0] * w, l[1] * h); ctx.stroke();
  });
  ctx.restore();
}
// One team's half of the sheet: "N학년 N반 주장 ○○○", the pad, 지우기 / 확인 — or the signature once confirmed.
function SignSide({ m, L, side, sign, valid, canEdit, onSave, onClear }) {
  const cls = side === 'H' ? m.home : m.away;
  const roster = L.playersByTeam[SD.tkey(m.div, cls)] || [];
  const capId = (((L.sp && L.sp.captains) || {})[m.div] || {})[cls] || '';
  const [pid, setPid] = useState(capId || (sign && sign.pid) || '');
  const [typed, setTyped] = useState('');
  const [ink, setInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const pad = useRef(null);
  useEffect(() => { if (!pid && capId) setPid(capId); }, [capId]);
  const name = roster.length ? ((S.players[pid] || {}).name || '') : typed.trim();
  const confirm = async () => {
    if (!name || !ink || !pad.current) return;
    setBusy(true);
    const ok = await onSave(side, { pid: roster.length ? pid : '', name, img: pad.current.png() });
    if (ok && roster.length && pid && pid !== capId && canEdit) patchDoc('sports/' + L.sid, { captains: { [m.div]: { [cls]: pid } } }, 0); // remember the captain
    setBusy(false);
  };
  if (valid) return html`<div class="sign-side done">
    <div class="sign-who"><span>${SD.classLabel(cls)} 주장</span><b>${sign.name}</b><span class="chip ok"><${Icon} n="check" size=${13} />확인</span></div>
    <div class="sign-img"><img src=${sign.img} alt=${`${SD.classLabel(cls)} 주장 ${sign.name} 서명`} /></div>
    <div class="sign-actions"><span class="small muted">${SD.fmtClock(sign.at)} 서명</span><span class="spacer"></span>
      ${canEdit ? html`<button type="button" class="btn btn-sm" onClick=${() => onClear(side)}>다시 서명</button>` : null}</div>
  </div>`;
  return html`<div class="sign-side">
    <div class="sign-who"><span>${SD.classLabel(cls)} 주장</span>
      ${roster.length ? html`<select class="select" aria-label=${SD.classLabel(cls) + ' 주장'} value=${pid} onChange=${e => setPid(e.target.value)}>
          <option value="">주장 선택</option>${roster.map(p => html`<option value=${p.id}>${p.name}${p.id === capId ? ' (주장)' : ''}</option>`)}</select>`
        : html`<input class="input" placeholder="주장 이름" value=${typed} onInput=${e => setTyped(e.target.value)} />`}</div>
    ${sign && sign.img ? html`<div class="small" style="color:var(--fin)">서명한 뒤 경기 결과가 바뀌어 다시 서명해야 합니다.</div>` : null}
    <${SignPad} api=${pad} onInk=${setInk} />
    <div class="sign-actions"><button type="button" class="btn btn-sm" disabled=${!ink} onClick=${() => pad.current && pad.current.clear()}>지우기</button><span class="spacer"></span>
      <button type="button" class="btn btn-primary" disabled=${!canEdit || !name || !ink || busy} onClick=${confirm}>${busy ? '저장 중…' : '확인'}</button></div>
  </div>`;
}
function SignModal({ m, L, signs, okSign, canEdit, onSave, onClear, onFinish, onForce, onClose }) {
  const n = ['H', 'A'].filter(k => okSign(signs[k])).length;
  const pk = SD.pkScore(m);
  return html`<${Modal} title="주장 전자서명" wide=${true} onClose=${onClose} foot=${html`
      <button type="button" class="btn" onClick=${onClose}>닫기</button>
      <button type="button" class="btn btn-primary" disabled=${n < 2 || m.status === 'final'} onClick=${onFinish}>기록 종료${n < 2 ? ` (${n}/2)` : ''}</button>`}>
    <div class="sign-res"><span>${SD.classLabel(m.home)}</span><b>${m.scoreH | 0} : ${m.scoreA | 0}</b><span>${SD.classLabel(m.away)}</span></div>
    <p class="small muted" style="text-align:center;margin-top:-6px">${pk ? `승부차기 ${pk[0]} : ${pk[1]} · ` : ''}${DIV_LABEL[m.div]} ${stageLabel(m)} — 결과를 확인했으면 각 팀 주장이 서명하고 「확인」을 눌러 주세요.</p>
    <div class="sign-cols">
      ${['H', 'A'].map(side => html`<${SignSide} key=${side + (signs[side] ? signs[side].at : '')} m=${m} L=${L} side=${side} sign=${signs[side]} valid=${okSign(signs[side])} canEdit=${canEdit} onSave=${onSave} onClear=${onClear} />`)}
    </div>
    ${canEdit && m.status !== 'final' ? html`<div class="row small muted" style="justify-content:flex-end;gap:8px">몰수·기록 정정처럼 서명을 받을 수 없을 때만
      <${ConfirmBtn} armedText="서명 없이 종료 확인" onConfirm=${onForce}>서명 없이 종료</${ConfirmBtn}></div>` : null}
  </${Modal}>`;
}
// Read-only view of the two signatures under the timeline.
function SignView({ m, signs, okSign, n }) {
  return html`<section class="panel"><div class="panel-head"><h3>주장 서명</h3><span class="sub">${n === 2 ? '양 팀 확인 완료' : `${n}/2 확인`}</span></div>
    <div class="panel-body sign-view">${['H', 'A'].map(k => {
      const s = signs[k], cls = k === 'H' ? m.home : m.away;
      return html`<div class="sv"><div class="sign-who"><span>${SD.classLabel(cls)} 주장</span><b>${s ? s.name : '—'}</b></div>
        ${s && s.img ? html`<img src=${s.img} alt=${`${SD.classLabel(cls)} 주장 서명`} />` : html`<div class="sv-empty">서명 전</div>`}
        <div class="small muted">${s ? `${new Date(s.at).getMonth() + 1}월 ${new Date(s.at).getDate()}일 ${SD.fmtClock(s.at)} · ${s.res}` : ''}${s && !okSign(s) ? html` · <span style="color:var(--fin)">서명 뒤 결과가 바뀜</span>` : null}</div></div>`;
    })}</div></section>`;
}

const PK_BASE = 3;
function Shootout({ m, L, ro, patch, level }) {
  const pk = { H: (m.pk && m.pk.H) || [], A: (m.pk && m.pk.A) || [] };
  const rounds = Math.max(PK_BASE, pk.H.length, pk.A.length);
  const score = SD.pkScore(m) || [0, 0];
  const roster = s => L.playersByTeam[SD.tkey(m.div, s === 'H' ? m.home : m.away)] || [];
  const setKick = (s, i, kv) => {
    const arr = pk[s].slice();
    while (arr.length <= i) arr.push({ pid: '', ok: null });
    arr[i] = { ...arr[i], ...kv };
    patch({ pk: { [s]: arr } }, 0);
  };
  const taken = s => pk[s].filter(k => k && k.ok != null).length;
  const decided = (() => { // after equal kicks, or when one side can no longer catch up within 5
    const th = taken('H'), ta = taken('A');
    if (th <= PK_BASE && ta <= PK_BASE) { if (score[0] > score[1] + (PK_BASE - ta)) return 'H'; if (score[1] > score[0] + (PK_BASE - th)) return 'A'; }
    if (th === ta && th >= PK_BASE && score[0] !== score[1]) return score[0] > score[1] ? 'H' : 'A';
    return null;
  })();
  const cell = (s, i) => {
    const k = pk[s][i] || { pid: '', ok: null };
    return html`<div class="pk-cell">
      <select class="select" aria-label=${(s === 'H' ? m.home : m.away) + ` ${i + 1}번 키커`} disabled=${ro} value=${k.pid || ''} onChange=${e => setKick(s, i, { pid: e.target.value })}>
        <option value="">키커 선택</option>${roster(s).map(p => html`<option value=${p.id}>${p.name}</option>`)}</select>
      <button type="button" class=${'pk-btn ok' + (k.ok === true ? ' on' : '')} disabled=${ro} aria-label="성공" onClick=${() => setKick(s, i, { ok: k.ok === true ? null : true })}>O</button>
      <button type="button" class=${'pk-btn no' + (k.ok === false ? ' on' : '')} disabled=${ro} aria-label="실패" onClick=${() => setKick(s, i, { ok: k.ok === false ? null : false })}>X</button>
    </div>`;
  };
  return html`<section class="panel pk-panel">
    <div class="panel-head"><h3>승부차기</h3><span class="sub">${level ? `정규 시간 무승부 · ${PK_BASE}명씩 차고, 같으면 ${PK_BASE + 1}번 키커부터 서든데스` : '정규 시간에 승부가 나면 비워 두세요'}</span>
      <div class="end"><span class="pk-score game">경기 <b>${m.scoreH | 0} : ${m.scoreA | 0}</b></span>
        <span class="pk-score">승부차기 ${m.home} <b>${score[0]}</b> : <b>${score[1]}</b> ${m.away}</span>${decided ? html`<span class="chip ok">${decided === 'H' ? m.home : m.away} 승리</span>` : null}</div></div>
    <div class="pk-grid">
      <div class="pk-h"></div><div class="pk-h"><${TeamLogo} cls=${m.home} div=${m.div} size=${22} /> ${m.home}</div><div class="pk-h"><${TeamLogo} cls=${m.away} div=${m.div} size=${22} /> ${m.away}</div>
      ${Array.from({ length: rounds }, (_, i) => html`<div class="pk-n">${i + 1}${i >= PK_BASE ? html`<small>서든</small>` : null}</div>${cell('H', i)}${cell('A', i)}`)}
    </div>
    ${ro ? null : html`<div class="panel-body row" style="border-top:1px solid var(--line-2)"><span class="small muted">O = 성공, X = 실패. 승부차기 골은 득점 순위에 들어가지 않습니다.</span><span class="spacer"></span>
      <button class="btn btn-sm" onClick=${() => { patch({ pk: { H: [...pk.H, ...Array(Math.max(0, rounds - pk.H.length)).fill({ pid: '', ok: null }), { pid: '', ok: null }], A: [...pk.A, ...Array(Math.max(0, rounds - pk.A.length)).fill({ pid: '', ok: null }), { pid: '', ok: null }] } }, 0); }}><${Icon} n="plus" />서든데스 추가</button></div>`}
  </section>`;
}

window.REC = { Recorder };
})();
