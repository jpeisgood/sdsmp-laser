/* SDSMP pages, part 1: home, standings, records, rankings, schedule. */
(function () {
'use strict';
const { useState } = preactHooks;
const { html, Icon, TeamLogo, DivTag, StatusChip, CardIco, Empty, Seg, DivSeg, Modal, VenueSelect, RingDiagram, GroupTable, MatchNotes, MatchRow, Score, RankList, stageLabel } = UI;
const { S, DIV_LABEL, fmtDate, fmtDateLong, fmtClock, todayStr, addDays, patchDoc, setDoc, logAct, ls } = SD;

const byTime = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || SD.mKey(a).localeCompare(SD.mKey(b));
const vsText = m => `${m.home || '미정'} vs ${m.away || '미정'}`;

function PageHead({ eyebrow, title, desc, children }) {
  return html`<header class="page-head"><div style="min-width:0">${eyebrow ? html`<div class="eyebrow">${eyebrow}</div>` : null}
    <h1 class="page-title">${title}</h1>${desc ? html`<p class="page-desc">${desc}</p>` : null}</div>
    ${children ? html`<div class="row">${children}</div>` : null}</header>`;
}
function usePref(key, init) {
  const [v, setV] = useState(() => ls.get(key, init));
  return [v, nv => { setV(nv); ls.set(key, nv); }];
}
const advOf = (L, div) => (L.sp && L.sp.divisions && L.sp.divisions[div] && Number(L.sp.divisions[div].advance)) || 2;

function SuspList({ L, limit, onPlayer }) {
  const act = Object.values(L.suspByPlayer).filter(i => i.active).map(i => ({ i, p: S.players[i.pid] })).filter(x => x.p);
  const bans = L.players.filter(p => L.banOf(p));
  if (!act.length && !bans.length) return html`<${Empty} title="출전 정지 선수가 없습니다">옐로·레드카드를 기록하면 다음 경기 출전 정지가 자동으로 표시됩니다.</${Empty}>`;
  const rows = act.slice(0, limit || 99);
  return html`<div>${rows.map(({ i, p }) => {
    const nx = i.next;
    const left = i.entries.filter(e => S.matches[e.mid] && S.matches[e.mid].status !== 'final').length + i.remaining;
    return html`<div class="log-row click" style="grid-template-columns:auto minmax(0,1fr) auto;align-items:center" onClick=${onPlayer ? () => onPlayer(p.id) : null}>
      <${CardIco} t=${i.src ? i.src.type : 'Y'} />
      <span><b>${p.name}</b> <span class="muted">${DIV_LABEL[p.div]} ${p.cls}</span><br/>
        <span class="small muted">${nx ? `다음 경기 ${fmtDate(nx.date)} ${nx.time || ''} · ${vsText(nx)}` : '다음 경기 일정 미정'}</span></span>
      <span class="chip warn">${left}경기 정지</span></div>`;
  })}${bans.map(p => html`<div class="log-row" style="grid-template-columns:auto minmax(0,1fr) auto;align-items:center">
      <${Icon} n="ban" size=${16} /><span><b>${p.name}</b> <span class="muted">${DIV_LABEL[p.div]} ${p.cls}</span></span><span class="chip ban">영구 출전 금지</span></div>`)}</div>`;
}

// ---------- home ----------
function Home({ L, nav }) {
  const today = todayStr();
  const todays = L.matches.filter(m => m.date === today).sort(byTime);
  const nextDate = todays.length ? null : L.matches.filter(m => m.date > today).map(m => m.date).sort()[0];
  const list = todays.length ? todays : nextDate ? L.matches.filter(m => m.date === nextDate).sort(byTime) : [];
  const recent = L.matches.filter(m => m.status === 'final').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 6);
  const st = L.stats;
  return html`<div>
    <${PageHead} eyebrow=${(L.sp && L.sp.league) || 'SD SPORTS MANAGEMENT PLATFORM'} title=${`${(L.sp && L.sp.name) || ''} 리그 현황`} desc=${fmtDateLong(today)}>
      <button class="btn" onClick=${() => nav.go('schedule')}><${Icon} n="calendar" />일정 편성</button>
      <button class="btn btn-primary" onClick=${() => nav.tv()}><${Icon} n="tv" />TV 송출</button>
    </${PageHead}>
    ${L.players.length === 0 ? html`<div class="banner warn"><${Icon} n="users" /><div><b>선수 명단이 아직 없습니다.</b> 득점·어시스트·카드를 선수별로 기록하려면 먼저 <a href="#teams" onClick=${e => { e.preventDefault(); nav.go('teams'); }}>팀·선수</a>에서 반별 명단을 입력하세요.</div></div>` : null}
    <div class="kpis two">
      <div class="kpi"><div class="k">조별리그 진행</div><div class="v">${st.final}<small> / ${st.total}경기</small></div><div class="bar"><i style=${`width:${st.total ? st.final / st.total * 100 : 0}%`}></i></div></div>
      <div class="kpi"><div class="k">오늘 경기</div><div class="v">${todays.length}<small>경기</small></div><div class="small muted">${st.live ? html`<span class="chip live">LIVE ${st.live}</span>` : `미편성 ${st.unscheduled}경기`}</div></div>
    </div>
    <div class="grid cols-3">
      <section class="panel mlist">
        <div class="panel-head"><h2>${todays.length ? '오늘의 경기' : '다음 경기'}</h2><span class="sub">${todays.length ? fmtDate(today) : nextDate ? fmtDate(nextDate) : ''}</span><div class="end"><button class="btn btn-sm" onClick=${() => nav.go('schedule')}>일정</button></div></div>
        ${list.length ? list.map(m => html`<${MatchRow} m=${m} L=${L} onOpen=${nav.openMatch} />`) : html`<${Empty} title="편성된 경기가 없습니다">경기 일정에서 날짜와 시간을 지정하세요.</${Empty}>`}
      </section>
      <section class="panel"><div class="panel-head"><h2 class="div-head">남학생 리그 득점 TOP 10</h2><div class="end"><button class="btn btn-sm" onClick=${() => nav.go('scorers')}>전체</button></div></div><${RankList} L=${L} div="M" kind="g" limit=${10} onPlayer=${nav.openPlayer} /></section>
      <section class="panel"><div class="panel-head"><h2 class="div-head W">여학생 리그 득점 TOP 10</h2><div class="end"><button class="btn btn-sm" onClick=${() => nav.go('scorers')}>전체</button></div></div><${RankList} L=${L} div="W" kind="g" limit=${10} onPlayer=${nav.openPlayer} /></section>
      <section class="panel"><div class="panel-head"><h2>출전 정지 현황</h2><div class="end"><button class="btn btn-sm" onClick=${() => nav.go('discipline')}>징계 관리</button></div></div><${SuspList} L=${L} limit=${6} onPlayer=${nav.openPlayer} /></section>
      <section class="panel mlist"><div class="panel-head"><h2>최근 결과</h2></div>
        ${recent.length ? recent.map(m => html`<${MatchRow} m=${m} L=${L} onOpen=${nav.openMatch} showDate=${true} />`) : html`<${Empty} title="종료된 경기가 없습니다" />`}</section>
      ${!(S.isOwner && S.vault.open) ? html`<${HomeChem} L=${L} nav=${nav} />` : html`<section class="panel"><div class="panel-head"><h2>최근 활동</h2><span class="sub">나만 보기 · 공동 편집 기록</span><div class="end"><button class="btn btn-sm" onClick=${() => nav.go('settings')}>전체</button></div></div>
        ${S.log.length ? html`<div>${S.log.slice(0, 12).map(l => html`<div class="log-row"><time>${fmtClock(l.ts)}</time><span><b>${SD.personName(l.uid, l.by)}</b> · ${l.text}</span></div>`)}</div>`
          : html`<${Empty} title="아직 활동이 없습니다">기록·일정 변경이 여기에 쌓입니다.</${Empty}>`}</section>`}
    </div>
  </div>`;
}

// Home slot everyone sees: the top scorer–assister duos across both divisions.
function HomeChem({ L, nav }) {
  const top = [...(L.chem.M || []), ...(L.chem.W || [])].sort((a, b) => b.n - a.n).slice(0, 6);
  return html`<section class="panel"><div class="panel-head"><h2>베스트 케미</h2><span class="sub">골 + 어시스트 합작</span><div class="end"><button class="btn btn-sm" onClick=${() => nav.go('scorers')}>전체</button></div></div>
    ${top.length ? html`<div class="ranklist">${top.map((c, i) => html`<div class=${'rk-row chem ' + (i < 3 ? 'rk-' + (i + 1) : 'rk-n')}>
      <span class="rk">${i + 1}</span><${TeamLogo} cls=${c.px.cls} div=${c.px.div} size=${28} />
      <span class="nm"><b>${c.px.name}</b><span class="duo">⇄</span><b>${c.py.name}</b><small>${DIV_LABEL[c.px.div]} · ${c.px.cls}</small></span>
      <span class="val">${c.n}<small>골</small></span></div>`)}</div>`
      : html`<${Empty} title="아직 합작 골이 없습니다">경기 기록에서 골을 넣을 때 어시스트 선수를 고르면 여기에 쌓입니다.</${Empty}>`}</section>`;
}

// ---------- standings ----------
function Standings({ L, nav }) {
  const divs = SD.divList(L.sp);
  const [div, setDiv] = usePref('standDiv', 'M');
  const d = divs.includes(div) ? div : divs[0];
  if (!d) return html`<${PageHead} title="조별 순위" /><${Empty} title="조편성이 없습니다">설정에서 조편성을 입력하세요.</${Empty}>`;
  const adv = advOf(L, d);
  const groups = L.standings[d] || {};
  return html`<div>
    <${PageHead} eyebrow="Group stage · 링크전" title="조별 순위" desc=${`조편성 순서대로 이웃한 두 팀과만 경기합니다. 각 조 상위 ${adv}팀이 토너먼트에 진출하며, 종료된 경기만 순위에 반영됩니다.`}>
      <${DivSeg} value=${d} onChange=${setDiv} divs=${divs} />
    </${PageHead}>
    <div class="legend" style="margin-bottom:14px">
      <span>순위 결정: ${SD.tiebreakOf(L.R).join(' → ')}</span>
      <span><i class="adv-swatch"></i>상위 ${adv}팀 본선 진출</span>
      <span><span class="chip lr">LR</span> 레이저런 리그 참가 반</span>
      <span>승 ${L.R.win} · 무 ${L.R.draw} · 패 ${L.R.loss}</span>
    </div>
    <div class="grid cols-auto">${Object.keys(groups).map(gk => {
      const g = groups[gk];
      const fin = g.matches.filter(m => m.status === 'final').length;
      return html`<section class=${'panel ' + d} key=${gk}>
        <div class="gcard-head"><span class="gletter">${gk}</span>
          <div><b>${DIV_LABEL[d]} ${gk}조</b><div class="small muted">${g.teams.length}팀 · ${fin}/${g.matches.length}경기 종료</div></div>
          <${RingDiagram} teams=${g.teams} matches=${g.matches} /></div>
        <${GroupTable} div=${d} data=${g} adv=${adv} />
        <div class="hr"></div>
        <div style="padding:4px 8px 10px">${g.matches.slice().sort((a, b) => a.seq - b.seq).map(m => html`
          <button class="fx" onClick=${() => nav.openMatch(m.id)}>
            <span class="muted">${m.seq}</span><span class="fx-vs"><b>${m.home}</b> <${Score} m=${m} /> <b>${m.away}</b></span>
            <span class="muted small">${m.status === 'live' ? html`<span class="chip live">LIVE</span>` : m.date ? `${fmtDate(m.date)} ${m.time || ''}` : '미편성'}</span></button>`)}</div>
      </section>`;
    })}</div>
  </div>`;
}

// ---------- records (match list → recorder) ----------
function Records({ L, nav, canEdit }) {
  const divs = SD.divList(L.sp);
  const [div, setDiv] = usePref('recDiv', 'M');
  const [flt, setFlt] = usePref('recFlt', 'all');
  const [view, setView] = usePref('recView', 'group');
  const [date, setDate] = useState('');
  const [cal, setCal] = useState(false);
  const [adding, setAdding] = useState(false);
  const d = divs.includes(div) ? div : divs[0];
  if (!d) return html`<${PageHead} title="경기 기록" /><${Empty} title="조편성이 없습니다" />`;
  const today = todayStr();
  const pass = m => (flt === 'all' || (flt === 'unsched' ? !m.date && m.status === 'scheduled' : m.status === flt)) && (!date || m.date === date);
  const groups = SD.groupsOf(L.sp, d);
  const divMs = L.matches.filter(m => m.div === d);
  const groupMs = divMs.filter(m => m.stage === 'group' && pass(m));
  const koMs = divMs.filter(m => m.stage !== 'group' && pass(m)).sort((a, b) => (a.round || 9) - (b.round || 9) || a.seq - b.seq);
  const v = view === 'ko' ? 'ko' : 'group';
  // Calendar marks: this division's matches per day.
  const marks = {};
  divMs.forEach(m => { if (!m.date) return; const k = marks[m.date] || (marks[m.date] = { n: 0, live: false }); k.n++; if (m.status === 'live') k.live = true; });
  const pick = ds => { setDate(ds); setCal(false); };
  // ◀ ▶ jump between days that have matches (from '전체 날짜', today counts as a stop).
  const step = n => { const ds = Object.keys(marks).sort(); const base = date || today;
    const nx = n > 0 ? ds.find(x => (date ? x > base : x >= base)) : ds.slice().reverse().find(x => (date ? x < base : x <= base));
    if (nx) setDate(nx); else toastNoMore(n); };
  const toastNoMore = n => SD.toast(n > 0 ? '이후에 잡힌 경기가 없습니다.' : '이전에 잡힌 경기가 없습니다.');
  const stages = [];
  koMs.forEach(m => { const k = m.stage || '추가 경기'; let g = stages.find(x => x.k === k); if (!g) stages.push(g = { k, ms: [] }); g.ms.push(m); });
  const noneMsg = date || flt !== 'all' ? html`<${Empty} title=${`${date ? fmtDateLong(date) + ' · ' : ''}조건에 맞는 경기가 없습니다`}>
      <button class="btn btn-sm" style="margin-top:6px" onClick=${() => { setDate(''); setFlt('all'); }}>전체 보기</button></${Empty}>` : null;
  return html`<div>
    <${PageHead} eyebrow="Match records" title="경기 기록" desc="경기를 눌러 점수, 득점·어시스트, 옐로·레드카드, 페어플레이 감점을 기록하세요. 입력하는 즉시 모든 화면과 TV에 반영됩니다.">
      <${DivSeg} value=${d} onChange=${setDiv} divs=${divs} />
      ${canEdit ? html`<button class="btn" onClick=${() => setAdding(true)}><${Icon} n="plus" />추가 경기</button>` : null}
    </${PageHead}>
    <div class="rec-filter">
      <${Seg} label="상태" value=${flt} onChange=${setFlt} options=${[
        { value: 'all', label: '전체' }, { value: 'unsched', label: '미편성' }, { value: 'scheduled', label: '예정' }, { value: 'live', label: '진행중' }, { value: 'final', label: '종료됨' }]} />
      <div class="datebox">
        <button type="button" class="icon-btn" aria-label="이전 경기일" onClick=${() => step(-1)}><${Icon} n="back" /></button>
        <button type="button" class=${'date-btn' + (date ? ' on' : '')} data-cal-toggle aria-expanded=${String(cal)} onClick=${() => setCal(!cal)}>
          <${Icon} n="calendar" size=${16} /><span>${date ? fmtDateLong(date) : '전체 날짜'}</span></button>
        <button type="button" class="icon-btn" aria-label="다음 경기일" onClick=${() => step(1)}><span style="display:inline-grid;transform:scaleX(-1)"><${Icon} n="back" /></span></button>
        ${date ? html`<button type="button" class="btn btn-sm" onClick=${() => setDate('')}>전체 날짜</button>` : html`<button type="button" class="btn btn-sm" onClick=${() => setDate(today)}>오늘</button>`}
        ${cal ? html`<${UI.MiniCal} value=${date} marks=${marks} onPick=${pick} onClose=${() => setCal(false)} />` : null}
      </div>
    </div>
    <div class="stage-tabs" role="tablist" aria-label="경기 구분">
      <button type="button" role="tab" aria-selected=${String(v === 'group')} onClick=${() => setView('group')}>조별 리그 <b>${groupMs.length}</b></button>
      <button type="button" role="tab" aria-selected=${String(v === 'ko')} onClick=${() => setView('ko')}>토너먼트 · 추가 경기 <b>${koMs.length}</b></button>
    </div>
    ${v === 'group' ? (groupMs.length ? html`<div class="grid cols-2">${groups.map(g => {
        const ms = groupMs.filter(m => m.group === g.key).sort((a, b) => (date ? byTime(a, b) : a.seq - b.seq));
        if (!ms.length) return null;
        return html`<section class=${'panel ' + d} key=${g.key}><div class="panel-head"><span class="gletter sm">${g.key}</span><h3>${DIV_LABEL[d]} ${g.key}조</h3><span class="sub">${g.teams.join(' · ')}</span></div>
          ${ms.map(m => html`<${MatchRow} m=${m} L=${L} onOpen=${nav.openMatch} showDate=${true} />`)}</section>`;
      })}</div>` : html`<section class="panel">${noneMsg || html`<${Empty} title="조별 리그 경기가 없습니다">설정에서 조편성을 저장하면 링크전 경기가 만들어집니다.</${Empty}>`}</section>`)
    : (koMs.length ? html`<div class="stack" style="gap:16px">${stages.map(g => html`<section class=${'panel ' + d} key=${g.k}>
        <div class="panel-head"><h3>${g.k}</h3><span class="sub">${g.ms.length}경기</span><div class="end"><button class="btn btn-sm" onClick=${() => nav.go('tournament')}>대진표</button></div></div>
        ${g.ms.map(m => html`<${MatchRow} m=${m} L=${L} onOpen=${nav.openMatch} showDate=${true} />`)}</section>`)}</div>`
      : html`<section class="panel">${noneMsg || html`<${Empty} title="토너먼트 경기가 아직 없습니다">토너먼트 메뉴에서 대진을 추첨하거나, 위의 추가 경기 버튼으로 순위결정전을 만드세요.</${Empty}>`}</section>`)}
    ${adding ? html`<${AddMatch} L=${L} div=${d} onClose=${() => setAdding(false)} onCreated=${id => { setAdding(false); nav.openMatch(id); }} />` : null}
  </div>`;
}
function AddMatch({ L, div, onClose, onCreated }) {
  const teams = SD.groupsOf(L.sp, div).flatMap(g => g.teams).sort(SD.clsSort);
  const [f, setF] = useState({ stage: '순위결정전', home: teams[0] || '', away: teams[1] || '', date: '', time: '', venue: '' });
  const up = k => e => setF({ ...f, [k]: e.target.value });
  const create = async () => {
    if (!f.home || !f.away || f.home === f.away) return SD.toast('서로 다른 두 팀을 고르세요.', 'err');
    const id = `${L.sid}-${div}-x-${SD.uid()}`;
    const seq = L.matches.filter(m => m.div === div && m.stage !== 'group' && !m.ko).length + 1;
    const ok = await setDoc('matches/' + id, SD.newMatch(L.sid, div, '', seq, f.home, f.away, { stage: f.stage.trim() || '추가 경기', date: f.date, time: f.time, venue: f.venue, pk: { H: [], A: [] } }));
    if (ok) { logAct(`${DIV_LABEL[div]} ${f.stage} ${f.home} vs ${f.away} 경기 추가`); onCreated(id); }
  };
  return html`<${Modal} title=${`${DIV_LABEL[div]} 추가 경기`} onClose=${onClose} foot=${html`<button class="btn" onClick=${onClose}>취소</button><button class="btn btn-primary" onClick=${create}>만들기</button>`}>
    <p class="small muted">토너먼트 대진은 토너먼트 메뉴에서 추첨으로 만듭니다. 여기서는 순위결정전처럼 따로 잡는 경기를 만듭니다.</p>
    <label class="field"><span>경기 이름</span><input id="am-stage" class="input" value=${f.stage} onInput=${up('stage')} /></label>
    <div class="form-grid">
      <label class="field"><span>팀 1</span><select id="am-home" class="select" value=${f.home} onChange=${up('home')}>${teams.map(t => html`<option value=${t}>${t}</option>`)}</select></label>
      <label class="field"><span>팀 2</span><select id="am-away" class="select" value=${f.away} onChange=${up('away')}>${teams.map(t => html`<option value=${t}>${t}</option>`)}</select></label>
      <label class="field"><span>날짜</span><input id="am-date" type="date" class="input" value=${f.date} onInput=${up('date')} /></label>
      <label class="field"><span>시간</span><input id="am-time" type="time" class="input" value=${f.time} onInput=${up('time')} /></label>
      <label class="field"><span>구장</span><${VenueSelect} id="am-venue" L=${L} value=${f.venue} onChange=${v => setF({ ...f, venue: v })} /></label>
    </div>
  </${Modal}>`;
}

// ---------- personal rankings: goals / assists / MVP (Ballon d'Or) ----------
function Rankings({ L, nav, canEdit }) {
  const [kind, setKind] = usePref('rkKind', 'g');
  const desc = { g: '모든 경기(조별·토너먼트)의 득점을 합산합니다. 동점자는 같은 순위입니다.', a: '골을 어시스트한 횟수를 합산합니다.',
    mvp: `발롱도르 MVP 레이스 · 득점 1개 ${L.R.mvpG}점, 어시스트 1개 ${L.R.mvpA}점으로 계산합니다.`,
    chem: '한 선수가 넣은 골을 다른 선수가 어시스트한 횟수를 두 사람 기준으로 합산합니다. 경기 기록에서 득점과 어시스트를 함께 입력한 골부터 집계됩니다.',
    best: '베스트 학급 팀워크상 · 남학생·여학생 리그를 합쳐 학급마다 하나의 점수로 계산하고, 학년별 1위 학급을 시상합니다.' }[kind];
  const kinds = [{ value: 'g', label: '득점' }, { value: 'a', label: '어시스트' }, { value: 'mvp', label: 'MVP · 발롱도르' }, { value: 'chem', label: '베스트 케미' }, { value: 'best', label: '베스트 학급' }];
  return html`<div>
    <${PageHead} eyebrow="Rankings" title="개인 · 팀 TOP 10" desc=${desc + (kind === 'best' ? '' : ' 선수를 누르면 선수 카드가 열립니다.')}>
      <${Seg} label="순위 종류" value=${kind} onChange=${setKind} options=${kinds} />
    </${PageHead}>
    ${kind === 'best' ? html`<${BEST.BestClass} L=${L} canEdit=${canEdit} nav=${nav} />` : html`<div class="grid cols-2">
      ${['M', 'W'].map(div => kind === 'chem' ? html`<section class=${'panel ' + div}><div class="panel-head"><h2 class=${'div-head ' + div}>${SD.DIV_LEAGUE[div]} 베스트 케미</h2><span class="sub">${L.chem[div].length}쌍</span></div>
        <${ChemList} L=${L} div=${div} onPlayer=${nav.openPlayer} /></section>`
        : html`<section class=${'panel ' + div}><div class="panel-head"><h2 class=${'div-head ' + div}>${SD.DIV_LEAGUE[div]} ${UI.KIND[kind][0]} 순위</h2><span class="sub">${(kind === 'a' ? L.assists : kind === 'mvp' ? L.mvp : L.scorers)[div].length}명</span></div>
        <${RankList} L=${L} div=${div} kind=${kind} onPlayer=${nav.openPlayer} /></section>`)}
    </div>`}
  </div>`;
}

// Scorer–assister duos. Each pair counts goals either way; the line under the names shows who set up whom.
function ChemList({ L, div, onPlayer }) {
  const list = L.chem[div].slice(0, 20);
  if (!list.length) return html`<${Empty} title="아직 합작 골이 없습니다">경기 기록에서 골을 넣을 때 어시스트 선수를 고르면 여기에 쌓입니다.</${Empty}>`;
  return html`<div class="ranklist">${list.map(c => html`
    <div class=${'rk-row chem ' + (c.rank <= 3 ? 'rk-' + c.rank : 'rk-n')}>
      <span class="rk">${c.rank}</span><${TeamLogo} cls=${c.px.cls} div=${div} size=${30} />
      <span class="nm"><button type="button" class="linkish" onClick=${() => onPlayer(c.x)}>${c.px.name}</button><span class="duo" aria-hidden="true">⇄</span><button type="button" class="linkish" onClick=${() => onPlayer(c.y)}>${c.py.name}</button>
        <small>${c.px.cls === c.py.cls ? c.px.cls : `${c.px.cls} · ${c.py.cls}`}</small>
        <em>${[c.xy ? `${c.px.name} 골 ← ${c.py.name} ${c.xy}` : '', c.yx ? `${c.py.name} 골 ← ${c.px.name} ${c.yx}` : ''].filter(Boolean).join(' · ')}</em></span>
      <span class="val">${c.n}<small>골 합작</small></span>
    </div>`)}</div>`;
}

// ---------- schedule ----------
// ---------- lunch timing (선급식 / 후급식) ----------
// Players eat before or after their match; every player of both class teams follows the match's choice.
const MEALS = [['pre', '선급식'], ['post', '후급식'], ['none', '해당없음']];
const MEAL_HINT = { pre: '경기 전에 먹어요', post: '경기 끝나고 먹어요', none: '급식과 상관없는 경기' };
const mealLabel = k => (MEALS.find(x => x[0] === k) || [])[1] || '';
// Each team in a match has its own choice (mealH / mealA); an older single `meal` still counts for both sides.
const mealOf = (m, side) => m['meal' + side] || (typeof m.meal === 'string' ? m.meal : '') || '';
const SIDES = m => [['H', m.home], ['A', m.away]];
function setMealSide(m, side, v) {
  if (v === mealOf(m, side)) return;
  const patch = { ['meal' + side]: v };
  if (typeof m.meal === 'string' && m.meal) { const o = side === 'H' ? 'A' : 'H'; if (!m['meal' + o]) patch['meal' + o] = m.meal; patch.meal = ''; }
  const cls = side === 'H' ? m.home : m.away;
  if (patchDoc('matches/' + m.id, patch, 0)) logAct(`${DIV_LABEL[m.div]} ${vsText(m)} · ${cls} 급식 ${mealLabel(v)}`);
}
const gradeOf = cls => Number(String(cls).split('-')[0]) || 0;
// Class teams eating before / after on one day (a team counts once per meal even if it plays twice).
function mealTally(L, day) {
  const out = { pre: [], post: [] }, seen = new Set();
  day.forEach(m => SIDES(m).forEach(([side, cls]) => {
    const meal = mealOf(m, side), k = meal + '|' + m.div + '|' + cls;
    if ((meal !== 'pre' && meal !== 'post') || !cls || seen.has(k)) return;
    seen.add(k);
    out[meal].push({ div: m.div, cls, grade: gradeOf(cls), n: (L.playersByTeam[SD.tkey(m.div, cls)] || []).length });
  }));
  Object.values(out).forEach(l => l.sort((a, b) => a.div.localeCompare(b.div) || SD.clsSort(a.cls, b.cls)));
  return out;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* the page frame may block the async clipboard */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch (e) { return false; }
}
function MealPick({ m, date, onPick, onClose }) {
  const [v, setV] = useState({ H: '', A: '' });
  const ready = !!(v.H && v.A);
  return html`<${Modal} title=${`${fmtDate(date)}에 편성`} onClose=${onClose} cls="meal-modal"
    foot=${html`<button type="button" class="btn" onClick=${onClose}>취소</button><button type="button" class="btn btn-primary" disabled=${!ready} onClick=${() => onPick(v)}>편성하기</button>`}>
    <div class="meal-q"><${DivTag} div=${m.div} /><b>${SD.classLabel(m.home)} vs ${SD.classLabel(m.away)}</b><span class="small muted">${stageLabel(m)}</span></div>
    <p class="small muted" style="margin:0">반마다 선수들 급식 시간을 골라 주세요. 그 반 선수 모두에게 적용되고, 경기 일정 맨 아래에서 학년별 인원으로 모아 볼 수 있어요.</p>
    ${SIDES(m).map(([side, cls]) => html`<div class="meal-row" key=${side}>
      <span class="meal-team"><${TeamLogo} cls=${cls} div=${m.div} size=${30} /><b>${SD.classLabel(cls)}</b></span>
      <div class="meal-opts" role="group" aria-label=${SD.classLabel(cls) + ' 급식'}>${MEALS.map(([k, l]) => html`
        <button type="button" class=${'meal-opt ' + k} aria-pressed=${String(v[side] === k)} onClick=${() => setV({ ...v, [side]: k })}>${l}</button>`)}</div>
    </div>`)}
    ${ready ? null : html`<p class="small muted" style="margin:0">두 반 모두 고르면 「편성하기」를 누를 수 있어요.</p>`}
  </${Modal}>`;
}
function MealSummary({ L, date, day }) {
  const [txt, setTxt] = useState(null);
  if (!day.length) return null;
  const T = mealTally(L, day);
  const unset = day.flatMap(m => (m.status === 'final' ? [] : SIDES(m).filter(([side, cls]) => cls && !mealOf(m, side)).map(([, cls]) => ({ m, cls }))));
  const grades = [...new Set([1, 2, 3, ...Object.values(L.standings).flatMap(gs => Object.values(gs).flatMap(g => g.teams.map(gradeOf)))])].filter(Boolean).sort((a, b) => a - b);
  const sum = l => l.reduce((s, x) => s + x.n, 0);
  const textOf = () => {
    const lines = [`[${fmtDateLong(date)} 급식 인원]`];
    ['pre', 'post'].forEach(k => {
      const list = T[k];
      lines.push('', `■ ${mealLabel(k)} ${sum(list)}명`);
      if (!list.length) { lines.push('  없음'); return; }
      ['M', 'W'].forEach(div => {
        const l = list.filter(x => x.div === div);
        if (l.length) lines.push(`  ${div === 'W' ? '여학생' : '남학생'}: ${grades.map(g => `${g}학년 ${sum(l.filter(x => x.grade === g))}명`).join(' · ')} (계 ${sum(l)}명)`);
      });
      lines.push(`  학급: ${list.map(x => `${SD.classLabel(x.cls)}(${x.div === 'W' ? '여' : '남'}) ${x.n}명`).join(', ')}`);
    });
    return lines.join('\n');
  };
  const copy = async () => { const t = textOf(); if (await copyText(t)) SD.toast('급식 인원을 복사했습니다. 메신저에 붙여 넣으세요.'); else setTxt(t); };
  return html`<section class="panel meal-panel">
    <div class="panel-head"><h2>급식 인원</h2><span class="sub">${fmtDateLong(date)} · 선급식·후급식 경기에 나가는 반의 선수 전체</span>
      <div class="end"><button type="button" class="btn btn-sm" onClick=${copy}>영양사님께 보낼 글 복사</button></div></div>
    <div class="panel-body meal-grid">${['pre', 'post'].map(k => { const list = T[k]; return html`<div class=${'meal-col ' + k} key=${k}>
      <div class="meal-h"><b>${mealLabel(k)}</b><span>${list.length ? `${list.length}개 팀 · ` : ''}<b class="num">${sum(list)}</b>명</span></div>
      ${list.length ? html`<table class="meal-tbl"><thead><tr><th></th>${grades.map(g => html`<th>${g}학년</th>`)}<th>합계</th></tr></thead><tbody>
          ${['M', 'W'].map(div => { const l = list.filter(x => x.div === div); return html`<tr class=${div}><th>${div === 'W' ? '여학생' : '남학생'}</th>
            ${grades.map(g => { const v = sum(l.filter(x => x.grade === g)); return html`<td class=${v ? '' : 'z'}>${v}</td>`; })}<td class="t">${sum(l)}</td></tr>`; })}
          <tr class="sum"><th>합계</th>${grades.map(g => html`<td>${sum(list.filter(x => x.grade === g))}</td>`)}<td class="t">${sum(list)}</td></tr>
        </tbody></table>
        <div class="meal-cls">${list.map(x => html`<span class=${'meal-chip ' + x.div + (x.n ? '' : ' empty')} key=${x.div + x.cls}><${TeamLogo} cls=${x.cls} div=${x.div} size=${20} />${SD.classLabel(x.cls)}<small>${x.div === 'W' ? '여' : '남'} · ${x.n ? `${x.n}명` : '명단 없음'}</small></span>`)}</div>`
        : html`<p class="small muted" style="margin:0">${mealLabel(k)} 경기가 없습니다.</p>`}
    </div>`; })}</div>
    ${unset.length ? html`<div class="panel-body meal-warn small"><b>급식을 아직 정하지 않은 반 ${unset.length}개</b> · ${unset.map(x => `${x.m.time || '시간 미정'} ${x.cls}`).join(', ')}. 위 경기 카드에서 골라 주세요.</div>` : null}
    ${txt ? html`<${Modal} title="급식 인원 복사" onClose=${() => setTxt(null)}>
      <p class="small muted" style="margin:0">이 화면에서는 자동 복사가 막혀 있어요. 아래 글을 모두 선택해서 복사해 주세요.</p>
      <textarea class="textarea meal-txt" rows="12" readonly value=${txt} onFocus=${e => e.target.select()}></textarea></${Modal}>` : null}
  </section>`;
}
function DayCard({ m, L, nav, canEdit, onUnassign }) {
  const fin = m.status === 'final';
  return html`<div class=${'day-card ' + m.div + (m.status === 'live' ? ' live' : '')}>
    <div class="row">
      ${canEdit ? html`<input type="time" class="input" style="width:152px;flex:none" aria-label="시간" value=${m.time || ''} onChange=${e => patchDoc('matches/' + m.id, { time: e.target.value })} />` : html`<b class="num">${m.time || '--:--'}</b>`}
      ${canEdit ? html`<${VenueSelect} L=${L} value=${m.venue} onChange=${v => patchDoc('matches/' + m.id, { venue: v }, 0)} />` : html`<span class="muted">${SD.venueName(m.venue) || '구장 미정'}</span>`}
      <span class="spacer"></span><${StatusChip} m=${m} />
    </div>
    <div class="dc-vs"><span class="dc-team"><${TeamLogo} cls=${m.home} div=${m.div} size=${64} /><b>${SD.classLabel(m.home)}</b></span><${Score} m=${m} /><span class="dc-team"><${TeamLogo} cls=${m.away} div=${m.div} size=${64} /><b>${SD.classLabel(m.away)}</b></span></div>
    <div class="mmeta" style="justify-content:center"><${DivTag} div=${m.div} /><span>${stageLabel(m)}</span></div>
    <div class="dc-meals"><span class="dc-meals-h">급식</span>${SIDES(m).map(([side, cls]) => { const val = mealOf(m, side), nag = !val && m.status !== 'final'; return html`
      <div class=${'dc-meal' + (nag ? ' unset' : '')} key=${side}><span class="dc-meal-l">${SD.classLabel(cls)}</span>
        ${canEdit ? html`<${Seg} label=${SD.classLabel(cls) + ' 급식'} value=${val} onChange=${v => setMealSide(m, side, v)} options=${MEALS.map(([k, l]) => ({ value: k, label: l, cls: 'meal-' + k }))} />`
          : html`<span class=${'chip meal-' + (val || 'unset')}>${mealLabel(val) || '미정'}</span>`}
        ${nag ? html`<span class="small dc-meal-todo">아직 안 정함</span>` : null}</div>`; })}</div>
    <${MatchNotes} m=${m} L=${L} />
    <div class="row" style="justify-content:flex-end;margin-top:8px">
      ${canEdit && m.status === 'scheduled' ? html`<button class="btn btn-sm" onClick=${() => onUnassign(m)}>편성 취소</button>` : null}
      <button class=${'btn btn-sm ' + (fin ? '' : 'btn-primary')} onClick=${() => nav.openMatch(m.id)}>${fin ? '기록 확인하기' : '기록하기'}</button>
    </div>
  </div>`;
}
function Schedule({ L, nav, canEdit }) {
  const today = todayStr();
  const [date, setDate] = useState(() => addDays(today, 1));
  const [div, setDiv] = usePref('schDiv', 'all');
  const day = L.matches.filter(m => m.date === date).sort(byTime);
  const unsched = L.matches.filter(m => !m.date && m.status === 'scheduled' && (div === 'all' || m.div === div));
  const dates = [...new Set(L.matches.filter(m => m.date).map(m => m.date))].sort();
  const [pick, setPick] = useState(null); // match waiting for its lunch choice (선급식 / 후급식 / 해당없음)
  const assign = (m, v) => {
    setPick(null);
    if (patchDoc('matches/' + m.id, { date, mealH: v.H, mealA: v.A, meal: '' })) logAct(`${DIV_LABEL[m.div]} ${vsText(m)} → ${fmtDate(date)} 편성 · ${m.home} ${mealLabel(v.H)} / ${m.away} ${mealLabel(v.A)}`);
  };
  const unassign = m => { if (patchDoc('matches/' + m.id, { date: '', time: '', meal: '', mealH: '', mealA: '' })) logAct(`${DIV_LABEL[m.div]} ${vsText(m)} 편성 취소`); };
  return html`<div>
    <${PageHead} eyebrow="Schedule" title="경기 일정" desc="날짜를 고르고 미편성 경기를 추가한 뒤 시간과 구장을 정하세요. 출전 정지 선수는 해당 경기에 자동으로 표시됩니다." />
    <div class="row" style="margin-bottom:14px">
      <button class="icon-btn" aria-label="이전 날" onClick=${() => setDate(addDays(date, -1))}><${Icon} n="back" /></button>
      <input id="sch-date" type="date" class="input" value=${date} onInput=${e => e.target.value && setDate(e.target.value)} />
      <button class="icon-btn" aria-label="다음 날" onClick=${() => setDate(addDays(date, 1))} style="transform:scaleX(-1)"><${Icon} n="back" /></button>
      <button class="btn btn-sm" onClick=${() => setDate(today)}>오늘</button>
      <button class="btn btn-sm" onClick=${() => setDate(addDays(today, 1))}>내일</button>
      <span class="spacer"></span>
      ${dates.length ? html`<div class="row">${dates.slice(-8).map(ds => html`<button class=${'chip' + (ds === date ? ' sel' : '')} style="cursor:pointer" onClick=${() => setDate(ds)}>${fmtDate(ds)} · ${L.matches.filter(m => m.date === ds).length}</button>`)}</div>` : null}
    </div>
    <div class="grid cols-2">
      <section class="panel">
        <div class="panel-head"><h2>${fmtDateLong(date)}</h2><span class="sub">${day.length}경기${date === today ? ' · 오늘' : date === addDays(today, 1) ? ' · 내일' : ''}</span></div>
        ${day.length ? html`<div class="day-list">${day.map(m => html`<${DayCard} key=${m.id} m=${m} L=${L} nav=${nav} canEdit=${canEdit} onUnassign=${unassign} />`)}</div>`
          : html`<${Empty} title="이 날짜에 편성된 경기가 없습니다">${canEdit ? '오른쪽 목록에서 경기를 추가하세요.' : ''}</${Empty}>`}
      </section>
      <section class="panel un-panel">
        <div class="panel-head"><h2>미편성 경기</h2><span class="sub">${unsched.length}경기</span>
          <div class="end"><${Seg} label="부문" value=${div} onChange=${setDiv} options=${[{ value: 'all', label: '전체' }, { value: 'M', label: '남', cls: 'men' }, { value: 'W', label: '여', cls: 'women' }]} /></div></div>
        ${unsched.length ? unsched.map(m => html`<${MatchRow} key=${m.id} m=${m} L=${L} long=${true} cls="sch-un" logo=${52}
            end=${canEdit ? html`<button class="btn btn-sm" onClick=${() => setPick(m)}><${Icon} n="plus" />${fmtDate(date)}</button>` : html`<${StatusChip} m=${m} />`} />`)
          : html`<${Empty} title="모든 경기가 편성되었습니다" />`}
      </section>
    </div>
    <${MealSummary} L=${L} date=${date} day=${day} />
    ${pick ? html`<${MealPick} m=${pick} date=${date} onPick=${k => assign(pick, k)} onClose=${() => setPick(null)} />` : null}
  </div>`;
}

window.PAGES = { PageHead, usePref, SuspList, Home, Standings, Records, Rankings, ChemList, Schedule, byTime, vsText, advOf };
})();
