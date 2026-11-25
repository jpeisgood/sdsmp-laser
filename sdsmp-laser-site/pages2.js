/* SDSMP pages, part 2: teams, discipline, settings, broadcast. */
(function () {
'use strict';
const { useState, useEffect, useLayoutEffect, useRef } = preactHooks;
const { html, Icon, TeamLogo, CardIco, LaserTag, Empty, Seg, DivSeg, ConfirmBtn, Modal } = UI;
const { PageHead, usePref, SuspList, vsText, advOf } = PAGES;
const { S, DIVS, DIV_LABEL, fmtDate, todayStr, patchDoc, setDoc, delDoc, logAct, toast, uid } = SD;

// One name per line (commas also split). No jersey numbers in this league.
const parseRoster = text => text.split(/[\n,]+/).map(s => s.trim().replace(/^\d{1,3}[.)번]?\s+/, '')).filter(Boolean);
async function addPlayers(sid, div, cls, names) {
  let n = 0;
  for (const name of names) {
    const ok = await setDoc('players/' + uid('p'), { sport: sid, div, cls, name, createdAt: Date.now() });
    if (!ok) break; n++;
  }
  if (n) logAct(`${DIV_LABEL[div]} ${cls} 선수 ${n}명 등록`);
  return n;
}

// ---------- teams & rosters ----------
function Teams({ L, nav, canEdit }) {
  const divs = SD.divList(L.sp);
  const [div, setDiv] = usePref('teamDiv', 'M');
  const [view, setView] = usePref('teamView', 'roster');
  const d = divs.includes(div) ? div : divs[0];
  const [sel, setSel] = useState(null);
  const TITLE = '팀 · 선수 명단 관리';
  if (!d) return html`<${PageHead} title=${TITLE} /><${Empty} title="조편성이 없습니다" />`;
  const groups = SD.groupsOf(L.sp, d);
  const cls = sel && groups.some(g => g.teams.includes(sel)) ? sel : groups[0] && groups[0].teams[0];
  const v = view === 'logos' ? 'logos' : 'roster';
  return html`<div>
    <${PageHead} eyebrow="Teams & rosters" title=${TITLE} desc=${v === 'logos' ? '참가한 반의 로고를 학년·반 순서로 모아 봅니다. 반을 누르면 그 반 명단으로 이동합니다.' : '반별 출전 선수 명단과 레이저런 리그 참가 여부를 관리합니다. 레이저런 참가 반은 승점이 같을 때 우선 순위가 됩니다.'}>
      <${Seg} label="보기" value=${v} onChange=${setView} options=${[{ value: 'roster', label: '선수 명단' }, { value: 'logos', label: '반 로고 모아보기' }]} />
      ${v === 'roster' ? html`<${DivSeg} value=${d} onChange=${x => { setDiv(x); setSel(null); }} divs=${divs} />` : null}
    </${PageHead}>
    ${v === 'logos' ? html`<${LogoGallery} L=${L} divs=${divs} onPick=${(dv, c) => { setDiv(dv); setSel(c); setView('roster'); window.scrollTo(0, 0); }} />` : html`
    <div class="grid team-layout">
      <section class="panel"><div class="panel-head"><h2>${DIV_LABEL[d]} 참가 반</h2><span class="sub">${groups.reduce((s, g) => s + g.teams.length, 0)}팀</span></div>
        <div class="panel-body stack">${groups.map(g => html`<div key=${g.key}><div class="small muted" style="margin-bottom:6px;font-weight:600">${g.key}조</div>
          <div class="team-grid">${g.teams.map(t => { const n = (L.playersByTeam[SD.tkey(d, t)] || []).length; return html`
            <button class="team-tile" aria-pressed=${String(t === cls)} onClick=${() => setSel(t)}>
              <${TeamLogo} cls=${t} div=${d} size=${34} />
              <span class="tt"><b>${t}</b><span>${n ? `선수 ${n}명` : '명단 없음'}</span></span>
              ${SD.isLaser(L.sp, d, t) ? html`<${LaserTag} />` : null}</button>`; })}</div></div>`)}</div>
      </section>
      ${cls ? html`<${Roster} key=${d + cls} L=${L} div=${d} cls=${cls} canEdit=${canEdit} nav=${nav} />` : null}
    </div>`}
  </div>`;
}
// Every participating class, by grade then class number: crest, "N학년 N반", and where it plays.
function LogoGallery({ L, divs, onPick }) {
  const where = {};
  for (const dv of divs) for (const g of SD.groupsOf(L.sp, dv)) for (const t of g.teams) (where[t] ||= []).push({ d: dv, g: g.key });
  const all = Object.keys(where).sort(SD.clsSort);
  if (!all.length) return html`<section class="panel"><${Empty} title="참가한 반이 없습니다">설정에서 조편성을 입력하면 여기에 모입니다.</${Empty}></section>`;
  const grades = [];
  all.forEach(c => { const gr = String(c).split('-')[0]; let x = grades.find(y => y.gr === gr); if (!x) grades.push(x = { gr, list: [] }); x.list.push(c); });
  return html`<div class="stack" style="gap:18px">${grades.map(({ gr, list }) => html`<section class="panel" key=${gr}>
    <div class="panel-head"><h2>${/^\d+$/.test(gr) ? gr + '학년' : gr}</h2><span class="sub">${list.length}개 반</span></div>
    <div class="logo-grid">${list.map(c => html`<button type="button" class="logo-tile" onClick=${() => onPick(where[c][0].d, c)}>
      <${TeamLogo} cls=${c} div=${where[c][0].d} size=${104} />
      <b>${SD.classLabel(c)}</b>
      <span class="lt-tags">${where[c].map(x => html`<span class=${'chip ' + (x.d === 'M' ? 'men' : 'women')}>${DIV_LABEL[x.d]} ${x.g}조</span>`)}${SD.isLaser(L.sp, where[c][0].d, c) ? html`<${LaserTag} />` : null}</span>
    </button>`)}</div></section>`)}</div>`;
}
function Roster({ L, div, cls, canEdit, nav }) {
  const list = L.playersByTeam[SD.tkey(div, cls)] || [];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const g = SD.groupsOf(L.sp, div).find(x => x.teams.includes(cls));
  const laser = SD.isLaser(L.sp, div, cls);
  const add = async () => {
    const names = parseRoster(text);
    if (!names.length) return;
    setBusy(true);
    const n = await addPlayers(L.sid, div, cls, names);
    setBusy(false);
    if (n) { setText(''); toast(`${cls} 선수 ${n}명을 등록했습니다.`); }
  };
  const capId = (((L.sp && L.sp.captains) || {})[div] || {})[cls] || '';
  const setCap = (p, on) => { if (patchDoc('sports/' + L.sid, { captains: { [div]: { [cls]: on ? p.id : '' } } }, 0)) logAct(`${cls} 주장 ${on ? `${p.name}(으)로 지정` : '지정 해제'}`); };
  const toggleLaser = on => { if (patchDoc('sports/' + L.sid, { laser: { [div]: { [cls]: on } } }, 0)) logAct(`${DIV_LABEL[div]} ${cls} 레이저런 리그 ${on ? '참가' : '미참가'}로 변경`); };
  return html`<section class=${'panel ' + div}>
    <div class="panel-head"><${TeamLogo} cls=${cls} div=${div} size=${44} /><div><h2 style="font-size:18px">${cls}</h2><span class="sub">${DIV_LABEL[div]} ${g ? g.key + '조' : ''} · 선수 ${list.length}명</span></div>
      <div class="end"><label class="switch"><input type="checkbox" checked=${laser} disabled=${!canEdit} onChange=${e => toggleLaser(e.target.checked)} /><span>레이저런 리그 참가</span></label></div></div>
    ${list.length ? html`<div class="roster">${list.map(p => {
      const s = L.pst[p.id] || { g: 0, a: 0, y: 0, r: 0, fp: 0 };
      const isCap = capId === p.id;
      const sp = L.suspByPlayer[p.id];
      const ban = L.banOf(p);
      return html`<div class="pl-row" key=${p.id}>
        ${canEdit ? html`<input class="input" aria-label="이름" value=${p.name} onInput=${e => e.target.value.trim() && patchDoc('players/' + p.id, { name: e.target.value.trim() }, 800)} />`
          : html`<button class="linkish" onClick=${() => nav.openPlayer(p.id)}>${p.name}</button>`}
        <div class="stats">
          ${isCap && !canEdit ? html`<span class="chip cap">주장</span>` : null}
          ${canEdit ? html`<button type="button" class="btn btn-sm cap-btn" aria-pressed=${String(isCap)} title=${isCap ? '주장 지정 해제' : '주장으로 지정 (전자서명에 사용)'} onClick=${() => setCap(p, !isCap)}>${isCap ? '주장' : '주장 지정'}</button>` : null}
          ${s.g ? html`<span><b>${s.g}</b>골</span>` : null}
          ${s.a ? html`<span><b>${s.a}</b>어시스트</span>` : null}
          ${s.y ? html`<span><${CardIco} t="Y" /> ${s.y}</span>` : null}
          ${s.r ? html`<span><${CardIco} t="R" /> ${s.r}</span>` : null}
          ${s.fp ? html`<span style="color:var(--card-r);font-weight:700">FP ${s.fp}</span>` : null}
          ${sp && sp.active ? html`<span class="chip warn">출전정지</span>` : null}
          ${ban ? html`<span class="chip ban">영구 출전 금지</span>` : null}
          <button class="btn btn-sm" onClick=${() => nav.openPlayer(p.id)}>카드</button>
          ${canEdit ? html`<${ConfirmBtn} armedText="삭제 확인" onConfirm=${() => delDoc('players/' + p.id).then(ok => ok && logAct(`${cls} ${p.name} 선수 삭제`))}><${Icon} n="trash" size=${14} /></${ConfirmBtn}>` : null}
        </div></div>`;
    })}</div>` : html`<${Empty} title="등록된 선수가 없습니다">아래에 명단을 붙여넣어 한 번에 등록하세요.</${Empty}>`}
    ${canEdit ? html`<div class="panel-body stack" style="border-top:1px solid var(--line-2)">
      <label class="field"><span>명단 일괄 등록 · 한 줄에 한 명</span>
        <textarea id="roster-bulk" class="textarea" rows="4" placeholder=${'김민수\n이도윤\n박서준'} value=${text} onInput=${e => setText(e.target.value)}></textarea></label>
      <div class="row"><span class="small muted">${text.trim() ? `${parseRoster(text).length}명 인식됨` : '엑셀에서 이름 열을 복사해 붙여넣어도 됩니다.'}</span><span class="spacer"></span>
        <button class="btn btn-primary" disabled=${busy || !text.trim()} onClick=${add}>${busy ? '등록 중…' : '명단 추가'}</button></div>
    </div>` : null}
  </section>`;
}

// ---------- discipline ----------
function Discipline({ L, nav, canEdit }) {
  const [adding, setAdding] = useState(false);
  const bans = Object.values(S.bans).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const cards = L.cards.slice().sort((a, b) => SD.mKey(b.m).localeCompare(SD.mKey(a.m)));
  const teamFp = [];
  for (const d of SD.divList(L.sp)) for (const g of SD.groupsOf(L.sp, d)) for (const t of g.teams) {
    const ps = L.playersByTeam[SD.tkey(d, t)] || [];
    const agg = ps.reduce((a, p) => { const s = L.pst[p.id]; if (s) { a.fp += s.fp; a.y += s.y; a.r += s.r; } return a; }, { fp: 0, y: 0, r: 0 });
    teamFp.push({ d, g: g.key, t, ...agg });
  }
  teamFp.sort((a, b) => a.fp - b.fp || SD.clsSort(a.t, b.t));
  const flagged = teamFp.filter(x => x.fp < 0);
  return html`<div>
    <${PageHead} eyebrow="Discipline & fair play" title="징계 · 페어플레이" desc="카드는 경기 기록 화면에서 입력합니다. 출전 정지는 팀의 다음 경기부터 자동으로 적용됩니다.">
      ${canEdit ? html`<button class="btn btn-danger" style="height:34px" onClick=${() => setAdding(true)}><${Icon} n="ban" />영구 출전 금지 등록</button>` : null}
    </${PageHead}>
    <div class="banner"><${Icon} n="card" /><div class="small">
      <b>규정</b> · <${CardIco} t="Y" /> 옐로카드: 다음 ${L.R.yBan}경기 출전 정지, FP ${L.R.yFp}점 · <${CardIco} t="R" /> 레드카드: 다음 ${L.R.rBan}경기 출전 정지, FP ${L.R.rFp}점 ·
      기타 비매너는 경기 기록의 추가 감점으로 기록 · <b>영구 출전 금지</b>: 심한 반칙이나 리그 취지에 어긋나는 행동을 한 학생은 이후 모든 종목 리그에 참가할 수 없습니다.</div></div>
    <div class="grid cols-2">
      <section class="panel"><div class="panel-head"><h2>출전 정지 현황</h2><span class="sub">진행 중인 징계</span></div><${SuspList} L=${L} onPlayer=${nav.openPlayer} /></section>
      <section class="panel"><div class="panel-head"><h2>영구 출전 금지 명단</h2><span class="sub">모든 종목 공통 · ${bans.filter(b => b.active !== false).length}명</span></div>
        ${bans.length ? bans.map(b => html`<div class="log-row" key=${b.id} style="grid-template-columns:minmax(0,1fr) auto;align-items:center;opacity:${b.active === false ? .55 : 1}">
          <span><b>${b.name}</b> <span class="muted">${DIV_LABEL[b.div] || ''} ${b.cls}</span> ${b.active === false ? html`<span class="chip">해제됨</span>` : html`<span class="chip ban">금지</span>`}<br/>
            <span class="small muted">${fmtDate(b.date)} · ${(S.sports[b.sport] && S.sports[b.sport].name) || ''} · ${b.reason || '사유 미기재'}</span></span>
          ${canEdit ? html`<span class="row">
            <button class="btn btn-sm" onClick=${() => { patchDoc('bans/' + b.id, { active: b.active === false }); logAct(`${b.cls} ${b.name} 영구 출전 금지 ${b.active === false ? '복원' : '해제'}`); }}>${b.active === false ? '복원' : '해제'}</button>
            <${ConfirmBtn} armedText="삭제 확인" onConfirm=${() => delDoc('bans/' + b.id)}><${Icon} n="trash" size=${14} /></${ConfirmBtn}></span>` : null}
        </div>`) : html`<${Empty} title="등록된 학생이 없습니다" />`}
      </section>
      <section class="panel"><div class="panel-head"><h2>카드 · 감점 기록</h2><span class="sub">${cards.length}건</span></div>
        ${cards.length ? html`<div class="scroll-x"><table class="tbl"><thead><tr><th class="l">경기</th><th class="l">선수</th><th>카드</th><th>FP</th></tr></thead><tbody>
          ${cards.map(c => { const p = S.players[c.pid]; return html`<tr style="cursor:pointer" onClick=${() => nav.openMatch(c.m.id)}>
            <td class="l"><span class="small muted">${fmtDate(c.m.date)}</span> ${vsText(c.m)}</td>
            <td class="l"><b>${p ? p.name : '(삭제된 선수)'}</b> <span class="muted small">${p ? p.cls : ''}</span></td>
            <td>${c.st.y ? html`<${CardIco} t="Y" />` : null} ${c.st.r ? html`<${CardIco} t="R" />` : null}</td>
            <td style="color:var(--card-r);font-weight:700">${c.fp}</td></tr>`; })}</tbody></table></div>`
          : html`<${Empty} title="카드 기록이 없습니다" />`}
      </section>
      <section class="panel"><div class="panel-head"><h2>팀 페어플레이</h2><span class="sub">감점이 있는 팀 · 0점이 최고</span></div>
        ${flagged.length ? html`<div class="scroll-x"><table class="tbl"><thead><tr><th class="l">팀</th><th>조</th><th>옐로</th><th>레드</th><th>FP</th></tr></thead><tbody>
          ${flagged.map(x => html`<tr><td class="l"><b>${x.t}</b> <span class="muted small">${DIV_LABEL[x.d]}</span></td><td>${x.g}</td><td>${x.y}</td><td>${x.r}</td><td class="pts" style="color:var(--card-r)">${x.fp}</td></tr>`)}</tbody></table></div>`
          : html`<${Empty} title="모든 팀이 FP 0점입니다" />`}
      </section>
    </div>
    ${adding ? html`<${AddBan} onClose=${() => setAdding(false)} />` : null}
  </div>`;
}
function AddBan({ onClose }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState({ pid: '', name: '', cls: '', div: 'M', reason: '', date: todayStr() });
  const hits = q.trim() ? Object.values(S.players).filter(p => p.name.includes(q.trim()) || p.cls === q.trim()).slice(0, 8) : [];
  const pick = p => { setF({ ...f, pid: p.id, name: p.name, cls: p.cls, div: p.div }); setQ(''); };
  const up = k => e => setF({ ...f, [k]: e.target.value, ...(k === 'name' || k === 'cls' ? { pid: '' } : {}) });
  const save = async () => {
    if (!f.name.trim() || !f.cls.trim()) return toast('이름과 반을 입력하세요.', 'err');
    const ok = await setDoc('bans/' + uid('b'), { ...f, name: f.name.trim(), cls: f.cls.trim(), sport: S.sportId, active: true, createdAt: Date.now() });
    if (ok) { logAct(`${f.cls} ${f.name} 영구 출전 금지 등록`); toast('영구 출전 금지 명단에 등록했습니다.'); onClose(); }
  };
  return html`<${Modal} title="영구 출전 금지 등록" onClose=${onClose} foot=${html`<button class="btn" onClick=${onClose}>취소</button><button class="btn btn-danger armed" onClick=${save}>등록</button>`}>
    <p class="small muted">등록된 학생은 모든 종목의 명단과 경기 기록에 '영구 출전 금지'로 표시됩니다. 같은 반·같은 이름이면 다른 종목 명단에서도 자동으로 찾아 표시합니다.</p>
    <label class="field"><span>선수 찾기</span><input id="ban-q" class="input" placeholder="이름 또는 반(예: 2-3)" value=${q} onInput=${e => setQ(e.target.value)} /></label>
    ${hits.length ? html`<div class="row">${hits.map(p => html`<button class="chip" style="cursor:pointer" onClick=${() => pick(p)}>${p.cls} ${p.name} · ${(S.sports[p.sport] || {}).name || ''}</button>`)}</div>` : null}
    <div class="form-grid">
      <label class="field"><span>이름</span><input id="ban-name" class="input" value=${f.name} onInput=${up('name')} /></label>
      <label class="field"><span>반</span><input id="ban-cls" class="input" placeholder="2-3" value=${f.cls} onInput=${up('cls')} /></label>
      <label class="field"><span>부문</span><select id="ban-div" class="select" value=${f.div} onChange=${up('div')}>${DIVS.map(d => html`<option value=${d}>${DIV_LABEL[d]}</option>`)}</select></label>
      <label class="field"><span>날짜</span><input id="ban-date" type="date" class="input" value=${f.date} onInput=${up('date')} /></label>
    </div>
    <label class="field"><span>사유</span><textarea id="ban-reason" class="textarea" rows="3" value=${f.reason} onInput=${up('reason')} placeholder="경기, 상황, 결정한 회의 등"></textarea></label>
  </${Modal}>`;
}

// ---------- settings ----------
const groupsToText = (sp, div) => SD.groupsOf(sp, div).map(g => `${g.key}: ${g.teams.join(', ')}`).join('\n');
function parseGroups(text) {
  const out = {}, errs = [];
  text.split('\n').map(s => s.trim()).filter(Boolean).forEach((line, i) => {
    const m = line.match(/^([A-Za-z0-9가-힣]{1,3})\s*[:：조]?\s*[:：]?\s*(.+)$/);
    if (!m) { errs.push(`${i + 1}번째 줄을 읽을 수 없습니다`); return; }
    const teams = m[2].split(/[,\s/]+/).map(s => s.trim()).filter(Boolean);
    if (teams.length < 2) { errs.push(`${m[1]}조에 팀이 2개 이상 필요합니다`); return; }
    out[m[1].toUpperCase()] = teams;
  });
  return { groups: out, errs };
}
function Settings({ L, canEdit }) {
  const sp = L.sp;
  const [nick, setNick] = useState(S.nick);
  return html`<div>
    <${PageHead} eyebrow="Settings" title="설정" desc="리그 규정, 구장, 조편성, 종목을 관리합니다. 모든 변경은 편집자 전원에게 바로 반영됩니다." />
    <div class="grid cols-2">
      <section class="panel"><div class="panel-head"><h2>내 이름</h2><span class="sub">이 기기에만 저장</span></div>
        <div class="panel-body stack"><p class="small muted">활동 기록과 접속 중 표시에 쓰입니다. 예: 체육부 2-3 김민수</p>
          <div class="row"><input id="my-nick" class="input" style="flex:1" value=${nick} onInput=${e => setNick(e.target.value)} placeholder="이름" />
          <button class="btn btn-primary" onClick=${() => { S.nick = nick.trim(); SD.ls.set('nick', S.nick); SD.setPresence({}); SD.bump(); toast('저장했습니다.'); }}>저장</button></div></div></section>
      <${AccessHelp} />
      ${sp ? html`<${RulesForm} key=${'r' + L.sid} L=${L} canEdit=${canEdit} />` : null}
      ${sp ? html`<${GroupEditor} key=${'g' + L.sid} L=${L} canEdit=${canEdit} />` : null}
      ${canEdit ? html`<${SportAdmin} L=${L} />` : null}
      ${S.isOwner && sp ? html`<${DataReset} key=${'x' + L.sid} L=${L} />` : null}
      ${S.isOwner ? html`<${LogVault} />` : null}
    </div>
  </div>`;
}

// ---------- data reset (page owner only) ----------
// Wipes test data while keeping the groups (조편성), league rules, pitches and staff lists.
const RESET_ITEMS = [
  ['results', '경기 기록', '점수·골·어시스트·카드·득점 시간·승부차기·경기 시간·메모·주장 서명·베스트 학급 체크를 지우고 모든 경기를 「예정」으로 돌립니다. 토너먼트에서 올라간 진출 팀도 비워집니다.'],
  ['schedule', '경기 일정', '모든 경기의 날짜·시간·구장·심판·기록 담당·급식(선/후)을 비웁니다. 조편성으로 만든 경기(대진)는 그대로 남습니다.'],
  ['extra', '추가 경기', '순위결정전처럼 경기 일정에서 직접 추가한 경기를 지웁니다.'],
  ['bracket', '토너먼트 대진', '토너먼트 추첨과 토너먼트 경기를 지웁니다. 조별리그가 끝난 뒤 다시 추첨하면 됩니다.'],
  ['players', '선수 명단', '등록한 선수와 주장 지정을 지웁니다. 선수별 기록이 남지 않도록 경기 기록도 함께 초기화됩니다.'],
  ['bans', '영구 출전 금지 명단', '징계 · 페어플레이의 영구 출전 금지 명단을 지웁니다. (모든 종목 공통, 경고·퇴장 카드는 경기 기록에 들어 있습니다)'],
  ['best', '베스트 학급 점수', '경기마다 체크한 학급 응원·경기 전 파이팅·페어플레이(메모 포함)와 남·여 둘 다·담임쌤 참여 체크, 「수상 안 함」 표시를 지웁니다. 포인트 기준은 그대로 둡니다.'],
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
// One write at a time; back off when the store says we are going too fast.
async function slowWrite(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      const c = e && e.code;
      if (c === 'not_found') return; // already gone
      if (i < 5 && (c === 'resource_exhausted' || c === 'unavailable')) { await sleep(800 * (i + 1)); continue; }
      throw e;
    }
  }
}
function DataReset({ L }) {
  const sid = L.sid, sp = L.sp, ms = L.matches;
  const isExtra = m => m.stage !== 'group' && !m.ko;
  const brackets = Object.entries(S.brackets).filter(([, b]) => b.sport === sid).map(([id]) => id);
  const count = {
    results: ms.filter(m => SD.hasResult(m) || m.clock || (m.goals || []).length || m.note || m.status !== 'scheduled').length,
    schedule: ms.filter(m => m.date || m.time || m.venue || m.referee || m.recorder || m.meal || m.mealH || m.mealA).length,
    extra: ms.filter(isExtra).length,
    bracket: ms.filter(m => m.ko).length,
    players: L.players.length,
    bans: Object.keys(S.bans).length,
    best: ms.filter(m => m.bc && (m.bc.H || m.bc.A)).length,
  };
  const unit = { results: '경기', schedule: '경기', extra: '경기', bracket: '경기', players: '명', bans: '명', best: '경기 체크' };
  const [sel, setSel] = useState({});
  const [ask, setAsk] = useState(false), [typed, setTyped] = useState('');
  const [prog, setProg] = useState(null); // { done, total } while running
  const eff = { ...sel, results: !!(sel.results || sel.players) };
  const chosen = RESET_ITEMS.filter(([k]) => eff[k]);
  const groupsKept = SD.divList(sp).map(d => `${DIV_LABEL[d]} ${SD.groupsOf(sp, d).length}개 조`).join(' · ');
  const openAll = () => { setSel(Object.fromEntries(RESET_ITEMS.map(([k]) => [k, true]))); setTyped(''); setAsk(true); };
  const openSel = () => { setTyped(''); setAsk(true); };

  const backup = async () => {
    const data = { app: 'SDSMP', exportedAt: new Date().toISOString(), sport: { id: sid, ...sp }, matches: ms, players: L.players,
      brackets: brackets.map(id => ({ id, ...S.brackets[id] })), bans: Object.entries(S.bans).map(([id, b]) => ({ id, ...b })) };
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    const name = `SDSMP_백업_${sp.name || sid}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;
    try {
      const dl = await claude.use('downloads').catch(() => null);
      if (!dl) return toast('이 화면에서는 파일을 저장할 수 없습니다.', 'err');
      await dl.save({ filename: name, data: JSON.stringify(data, null, 1) });
      toast('백업 파일을 저장했습니다.');
    } catch (e) { if (!e || e.code !== 'declined') toast('백업 파일을 저장하지 못했습니다.', 'err'); }
  };

  const run = async () => {
    if (typed.trim() !== '초기화' || !S.db) return;
    SD.flushAll(); await sleep(700);
    const ops = [];
    const put = (path, doc) => ops.push(() => S.db.doc(path).set({ ...doc, updatedAt: Date.now(), updatedBy: S.me.id || null }));
    const del = path => ops.push(() => S.db.doc(path).delete());
    const gone = new Set();
    if (eff.extra) ms.filter(isExtra).forEach(m => gone.add(m.id));
    if (eff.bracket) ms.filter(m => m.ko).forEach(m => gone.add(m.id));
    gone.forEach(id => del('matches/' + id));
    // knockout slots that were filled by an earlier match's winner (draw / bye slots stay)
    const fed = {};
    ms.forEach(m => { if (m.next && !gone.has(m.id)) (fed[m.next.mid] = fed[m.next.mid] || []).push(m.next.side); });
    if (eff.results || eff.schedule || eff.best) ms.forEach(m0 => {
      if (gone.has(m0.id)) return;
      const cur = S.matches[m0.id] || m0;
      const { id, updatedAt, updatedBy, ...d } = cur;
      if (eff.results) {
        Object.assign(d, { status: 'scheduled', scoreH: 0, scoreA: 0, ps: {}, goals: [], pkH: null, pkA: null, clock: null, note: '' });
        if (d.stage !== 'group') d.pk = { H: [], A: [] }; else delete d.pk;
        (fed[id] || []).forEach(side => { d[side] = ''; });
      }
      if (eff.schedule) Object.assign(d, { date: '', time: '', venue: '', referee: '', recorder: '', meal: '', mealH: '', mealA: '' });
      if (eff.results || eff.best) delete d.bc;
      Object.keys(d).forEach(k => { if (d[k] === undefined) delete d[k]; });
      const before = { ...cur }; delete before.id; delete before.updatedAt; delete before.updatedBy;
      if (JSON.stringify(before) !== JSON.stringify(d)) put('matches/' + id, d);
    });
    if (eff.bracket) brackets.forEach(id => del('brackets/' + id));
    if (eff.players) { L.players.forEach(p => del('players/' + p.id)); ops.push(() => S.db.doc('sports/' + sid).update({ captains: null })); }
    if (eff.bans) Object.keys(S.bans).forEach(id => del('bans/' + id));
    if (eff.best && S.best) { const b = BEST.cfgOf(); put('config/best', { pts: b.pts, cheerScope: b.cheerScope, cls: {}, skip: {} }); }
    if (eff.results || gone.size) {
      try {
        const ids = new Set(ms.map(m => m.id));
        const snap = await S.db.collection('signs').get();
        snap.docs.forEach(x => { if (ids.has(x.id)) del('signs/' + x.id); });
      } catch (e) { /* signatures are optional */ }
    }
    setProg({ done: 0, total: ops.length });
    let done = 0, failed = 0;
    for (const op of ops) {
      try { await slowWrite(op); } catch (e) { failed++; console.warn('reset write failed', e); }
      done++; if (done % 3 === 0 || done === ops.length) setProg({ done, total: ops.length });
    }
    logAct(`데이터 초기화 (${sp.name}): ${chosen.map(([, l]) => l).join(', ')} · ${done - failed}건 처리${failed ? ` · 실패 ${failed}건` : ''}`);
    setProg(null); setAsk(false); setSel({});
    if (failed) toast(`초기화 중 ${failed}건을 처리하지 못했습니다. 한 번 더 실행해 주세요.`, 'err');
    else toast('초기화를 마쳤습니다. 조편성은 그대로입니다.');
  };

  const busy = !!prog;
  return html`<section class="panel reset-panel" style="grid-column:1/-1">
    <div class="panel-head"><h2>데이터 초기화</h2><span class="sub">${sp.name} · 이 페이지 주인 계정만 보입니다</span></div>
    <div class="panel-body stack">
      <div class="banner ok small" style="margin:0"><${Icon} n="check" /><div><b>조편성은 지우지 않습니다.</b> 조편성(${groupsKept})과 리그 규정·구장·심판·기록 담당 명단, TV 송출 설정은 그대로 남습니다.</div></div>
      <div class="reset-list">${RESET_ITEMS.map(([k, label, desc]) => {
        const forced = k === 'results' && sel.players && !sel.results;
        return html`<label class=${'reset-item' + (eff[k] ? ' on' : '')}>
          <input type="checkbox" checked=${!!eff[k]} disabled=${forced || busy} onChange=${e => setSel({ ...sel, [k]: e.target.checked })} />
          <div><div class="row" style="gap:8px"><b>${label}</b><span class="chip">${count[k]}${unit[k]}</span>${forced ? html`<span class="small muted">선수 명단과 함께 초기화</span>` : null}</div>
            <p class="small muted">${desc}</p></div></label>`;
      })}</div>
      <div class="row"><span class="small muted">초기화한 데이터는 되돌릴 수 없습니다. 먼저 백업 파일을 저장해 두면 필요할 때 Claude에게 복원을 부탁할 수 있습니다.</span><span class="spacer"></span>
        <button type="button" class="btn" onClick=${backup}><${Icon} n="save" size=${15} />백업 저장</button>
        <button type="button" class="btn btn-danger" disabled=${!chosen.length || busy} onClick=${openSel}>선택 항목 초기화</button>
        <button type="button" class="btn btn-danger armed" disabled=${busy} onClick=${openAll}>전체 초기화</button></div>
    </div>
    ${ask ? html`<${Modal} title="데이터 초기화 확인" onClose=${() => { if (!busy) setAsk(false); }} foot=${html`
        <button type="button" class="btn" disabled=${busy} onClick=${() => setAsk(false)}>취소</button>
        <button type="button" class="btn btn-danger armed" disabled=${busy || typed.trim() !== '초기화' || !chosen.length} onClick=${run}>${busy ? '초기화하는 중…' : '초기화'}</button>`}>
      <p class="reset-q">${sp.name}에서 아래 항목을 지웁니다.</p>
      <ul class="reset-sum">${chosen.map(([k, l]) => html`<li><b>${l}</b> <span class="muted">${count[k]}${unit[k]}</span></li>`)}</ul>
      <p class="small muted">남는 것: 조편성(${groupsKept}), 리그 규정, 구장, 심판·기록 담당 명단, TV 송출 설정, 활동 기록.</p>
      ${busy ? html`<div class="reset-prog"><i style=${`width:${prog.total ? Math.round(prog.done / prog.total * 100) : 100}%`}></i></div><p class="small muted">${prog.done} / ${prog.total} 처리 중… 창을 닫지 마세요.</p>`
        : html`<label class="field"><span>확인을 위해 <b>초기화</b> 라고 입력하세요</span><input id="reset-confirm" class="input" value=${typed} autocomplete="off" onInput=${e => setTyped(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter' && !e.isComposing) run(); }} /></label>
          <button type="button" class="btn btn-sm" style="justify-self:start" onClick=${backup}><${Icon} n="save" size=${14} />초기화 전에 백업 저장</button>`}
    </${Modal}>` : null}
  </section>`;
}

// Activity history, owner only: nobody else can read these records at all, and the owner opens them with a password.
const fmtStamp = ts => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${SD.fmtClock(ts)}`; };
// sport='__laserrun' shows the 레이저런 recorders' lines (opened from 레이저런 설정); anything else shows 풋살's.
// 「전체」 shows both with a tag. Clearing old lines only touches the sport being viewed.
function LogVault({ sport = '' }) {
  const v = S.vault, lr = sport === SD.LR_SPORT;
  const [scope, setScope] = useState('mine');
  const [pw, setPw] = useState(''), [pw2, setPw2] = useState(''), [cur, setCur] = useState('');
  const [changing, setChanging] = useState(false), [busy, setBusy] = useState(false);
  const [q, setQ] = useState(''), [who, setWho] = useState('');
  const [cut, setCut] = useState(30), [ask, setAsk] = useState(false), [ppw, setPpw] = useState('');
  const run = async f => { setBusy(true); try { await f(); } finally { setBusy(false); } };
  // Clearing records always asks for the password again, even while the history is open.
  const prune = () => run(async () => {
    if (!(await SD.vaultCheck(ppw))) return toast('비밀번호가 맞지 않습니다.', 'err');
    setAsk(false); setPpw('');
    try { const n = await SD.pruneLog(Date.now() - cut * 864e5, lr); logAct(`${lr ? '레이저런 ' : ''}활동 기록 정리 (${cut}일 이전 ${n}건)`, lr ? SD.LR_SPORT : undefined); toast(`활동 기록 ${n}건을 정리했습니다.`); }
    catch (e) { toast('정리하지 못했습니다.', 'err'); }
  });
  const create = () => run(async () => {
    if (pw.length < 4) return toast('비밀번호는 4자 이상으로 정하세요.', 'err');
    if (pw !== pw2) return toast('두 비밀번호가 다릅니다.', 'err');
    if (await SD.vaultSet(pw, cur)) { setPw(''); setPw2(''); setCur(''); setChanging(false); toast('비밀번호를 저장했습니다.'); }
  });
  const open = () => run(async () => { if (await SD.vaultOpen(pw)) setPw(''); else toast('비밀번호가 맞지 않습니다.', 'err'); });
  const head = html`<div class="panel-head"><h2>${lr ? '레이저런 활동 기록' : '활동 기록'}</h2><span class="sub">${lr ? '기록원이 누른 버튼·수정·설정 변경' : '공동 편집 기록'} · 이 페이지 주인 계정만 볼 수 있습니다</span>
    ${v.open ? html`<div class="end"><button type="button" class="btn btn-sm" onClick=${() => setChanging(!changing)}>비밀번호 바꾸기</button><button type="button" class="btn btn-sm btn-primary" onClick=${SD.vaultLock}><${Icon} n="ban" size=${14} />잠그기</button></div>` : null}</div>`;
  if (!v.ready) return html`<section class="panel vault" style="grid-column:1/-1">${head}<div class="panel-body small muted">확인하는 중…</div></section>`;
  const pwForm = (label, again) => html`<div class="vault-form">
    ${again && v.has ? html`<label class="field"><span>현재 비밀번호</span><input id="vault-cur" type="password" class="input" autocomplete="current-password" value=${cur} onInput=${e => setCur(e.target.value)} /></label>` : null}
    <label class="field"><span>${label}</span><input id="vault-pw" type="password" class="input" autocomplete="new-password" value=${pw} onInput=${e => setPw(e.target.value)} /></label>
    <label class="field"><span>한 번 더</span><input id="vault-pw2" type="password" class="input" autocomplete="new-password" value=${pw2} onInput=${e => setPw2(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter' && !e.isComposing) create(); }} /></label>
    <button type="button" class="btn btn-primary" disabled=${busy} onClick=${create}>저장</button></div>`;
  if (!v.has) return html`<section class="panel vault" style="grid-column:1/-1">${head}<div class="panel-body stack">
    <p class="small muted">기록·일정을 바꾼 내용은 모두 남지만 이 페이지 주인 계정 말고는 아무도 볼 수 없습니다. 비밀번호를 만들면 여기서만 열어 볼 수 있습니다.</p>
    ${pwForm('새 비밀번호', false)}</div></section>`;
  if (!v.open) return html`<section class="panel vault" style="grid-column:1/-1">${head}<div class="panel-body stack">
    <div class="vault-form"><label class="field"><span>비밀번호</span><input id="vault-open" type="password" class="input" autocomplete="current-password" value=${pw} onInput=${e => setPw(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter' && !e.isComposing) open(); }} /></label>
      <button type="button" class="btn btn-primary" disabled=${busy || !pw} onClick=${open}><${Icon} n="link" size=${15} />열기</button></div>
    <p class="small muted">비밀번호를 잊으면 Claude 대화에서 초기화를 요청하세요.</p></div></section>`;
  const base = scope === 'all' ? S.log : S.log.filter(l => SD.logOfLaser(l) === lr);
  const people = [...new Set(base.map(l => SD.personName(l.uid, l.by)))].sort();
  const t = q.trim();
  const rows = base.filter(l => (!who || SD.personName(l.uid, l.by) === who) && (!t || String(l.text || '').includes(t)));
  return html`<section class="panel vault" style="grid-column:1/-1">${head}
    ${changing ? html`<div class="panel-body" style="border-bottom:1px solid var(--line-2)">${pwForm('새 비밀번호', true)}</div>` : null}
    <div class="panel-body row" style="border-bottom:1px solid var(--line-2)">
      <input id="vault-q" class="input" style="flex:1;min-width:160px" placeholder="내용 검색 (예: 2-11, 경기 종료)" value=${q} onInput=${e => setQ(e.target.value)} />
      <select id="vault-who" class="select" value=${who} onChange=${e => setWho(e.target.value)}><option value="">모든 사람</option>${people.map(p => html`<option value=${p}>${p}</option>`)}</select>
      <${Seg} label="종목" value=${scope} onChange=${setScope} options=${[{ value: 'mine', label: lr ? '레이저런' : '풋살' }, { value: 'all', label: '전체' }]} />
      <span class="small muted">${rows.length}건</span></div>
    ${rows.length ? html`<div class="vault-list">${rows.map(l => html`<div class="log-row vault-row" key=${l.id}><time>${fmtStamp(l.ts)}</time><span>${scope === 'all' ? html`<i class=${'log-sp' + (SD.logOfLaser(l) ? ' lr' : '')}>${SD.logOfLaser(l) ? '레이저런' : '풋살'}</i>` : null}<b>${SD.personName(l.uid, l.by)}</b> · ${l.text}</span></div>`)}</div>`
      : html`<${Empty} title="기록이 없습니다">${t || who ? '검색 조건을 바꿔 보세요.' : lr ? '레이저런 기록원이 버튼을 누르거나 기록·설정을 바꾸면 여기에 쌓입니다.' : '기록·일정을 바꾸면 여기에 쌓입니다.'}</${Empty}>`}
    <div class="panel-body row" style="border-top:1px solid var(--line-2)">
      <span class="small muted">오래된 ${lr ? '레이저런 ' : ''}기록 정리</span>
      <select id="vault-cut" class="select" value=${cut} onChange=${e => setCut(Number(e.target.value))}><option value="7">7일 이전</option><option value="14">14일 이전</option><option value="30">30일 이전</option></select>
      <button type="button" class="btn btn-sm btn-danger" onClick=${() => { setPpw(''); setAsk(true); }}><${Icon} n="trash" size=${14} />정리</button>
      <span class="spacer"></span>
      ${S.log.length >= v.limit ? html`<button type="button" class="btn btn-sm" onClick=${SD.vaultMore}>이전 기록 더 보기</button>` : null}</div>
    ${ask ? html`<${Modal} title="오래된 기록 정리" onClose=${() => setAsk(false)} foot=${html`<button type="button" class="btn" onClick=${() => setAsk(false)}>취소</button><button type="button" class="btn btn-danger armed" disabled=${busy || !ppw} onClick=${prune}>정리</button>`}>
      <p>${cut}일 이전의 ${lr ? '레이저런 ' : '풋살 '}활동 기록을 지웁니다. 지운 기록은 되돌릴 수 없습니다.</p>
      <label class="field"><span>비밀번호 확인</span><input id="vault-prune-pw" type="password" class="input" autocomplete="current-password" value=${ppw} onInput=${e => setPpw(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter' && !e.isComposing) prune(); }} /></label>
    </${Modal}>` : null}
  </section>`;
}
function AccessHelp() {
  return html`<section class="panel"><div class="panel-head"><h2>함께 편집하기</h2></div><div class="panel-body stack small">
    <p>편집할 사람을 이 페이지의 <b>공유 메뉴에서 이메일로 편집자</b>로 초대하면 모두 같은 데이터를 실시간으로 기록합니다.</p>
    <p class="muted">claude.ai 계정은 만 18세 이상만 만들 수 있습니다. 학생 기록원은 편집자 계정으로 로그인된 학교 기기에서 입력하세요. 공개 링크를 켜면 초대한 편집자의 저장 권한이 꺼질 수 있습니다.</p>
    <p>현재 계정: ${S.canWrite === false ? html`<span class="chip warn">보기 전용</span>` : S.canWrite ? html`<span class="chip ok">편집 가능</span>` : html`<span class="chip">권한 확인 중</span>`}</p>
  </div></section>`;
}
function RulesForm({ L, canEdit }) {
  const sp = L.sp;
  const [f, setF] = useState(() => ({ name: sp.name || '', league: sp.league || '', ...L.R, venues: L.venues.join('\n'), refs: L.staff.refs.join('\n'), recs: L.staff.recs.join('\n'),
    advM: advOf(L, 'M'), advW: advOf(L, 'W') }));
  const up = (k, num) => e => setF({ ...f, [k]: num ? Number(e.target.value) : e.target.value });
  const save = () => {
    const rules = { win: f.win, draw: f.draw, loss: f.loss, yFp: -Math.abs(f.yFp), rFp: -Math.abs(f.rFp), yBan: Math.max(0, f.yBan), rBan: Math.max(0, f.rBan),
      mvpG: Math.max(0, f.mvpG), mvpA: Math.max(0, f.mvpA), halfG: Math.min(45, Math.max(1, f.halfG || 7)), halfK: Math.min(45, Math.max(1, f.halfK || 10)), bothTie: f.bothTie !== false };
    const divisions = {};
    if (sp.divisions.M) divisions.M = { advance: Math.max(1, f.advM) };
    if (sp.divisions.W) divisions.W = { advance: Math.max(1, f.advW) };
    const venues = f.venues.split('\n').map(s => s.trim()).filter(Boolean);
    const lines = t => [...new Set(t.split('\n').map(s => s.trim()).filter(Boolean))];
    const staff = { refs: lines(f.refs), recs: lines(f.recs) };
    if (patchDoc('sports/' + L.sid, { name: f.name.trim() || sp.name, league: f.league.trim(), rules, divisions, venues, staff }, 0)) { logAct(`${sp.name} 규정 수정`); toast('규정을 저장했습니다.'); }
  };
  const num = (k, label, min, max) => html`<label class="field"><span>${label}</span><input id=${'rule-' + k} class="input" type="number" min=${min} max=${max} value=${f[k]} disabled=${!canEdit} onInput=${up(k, true)} /></label>`;
  return html`<section class="panel"><div class="panel-head"><h2>${sp.name} 규정</h2></div><div class="panel-body stack">
    <div class="form-grid">
      <label class="field"><span>종목 이름</span><input id="rule-name" class="input" value=${f.name} disabled=${!canEdit} onInput=${up('name')} /></label>
      <label class="field" style="grid-column:span 2"><span>리그 이름 (TV 상단)</span><input id="rule-league" class="input" value=${f.league} disabled=${!canEdit} onInput=${up('league')} /></label>
    </div>
    <div class="form-grid">${num('win', '승리 승점', 0, 9)}${num('draw', '무승부 승점', 0, 9)}${num('loss', '패배 승점', 0, 9)}</div>
    <div class="form-grid">${num('yFp', '옐로 FP 감점', -9, 9)}${num('rFp', '레드 FP 감점', -9, 9)}${num('yBan', '옐로 정지 경기', 0, 9)}${num('rBan', '레드 정지 경기', 0, 9)}</div>
    <div class="form-grid">${num('mvpG', 'MVP · 득점 1개당', 0, 9)}${num('mvpA', 'MVP · 어시스트 1개당', 0, 9)}${num('advM', '남자부 조별 진출 팀', 1, 5)}${num('advW', '여자부 조별 진출 팀', 1, 5)}</div>
    <div class="form-grid">${num('halfG', '조별리그 전·후반 (분)', 1, 45)}${num('halfK', '토너먼트 전·후반 (분)', 1, 45)}</div>
    <label class="field"><span>구장 목록 · 한 줄에 하나</span><textarea id="rule-venues" class="textarea" rows="3" disabled=${!canEdit} value=${f.venues} onInput=${up('venues')}></textarea></label>
    <div class="grid cols-2" style="gap:10px">
      <label class="field"><span>심판 목록 · 한 줄에 한 명</span><textarea id="rule-refs" class="textarea" rows="6" disabled=${!canEdit} value=${f.refs} onInput=${up('refs')}></textarea></label>
      <label class="field"><span>기록 담당 목록 · 한 줄에 한 명</span><textarea id="rule-recs" class="textarea" rows="6" disabled=${!canEdit} value=${f.recs} onInput=${up('recs')}></textarea></label>
    </div>
    <label class="switch"><input id="rule-bothTie" type="checkbox" checked=${f.bothTie !== false} disabled=${!canEdit} onChange=${e => setF({ ...f, bothTie: e.target.checked })} />
      <span>승점이 같으면 레이저런 다음으로 <b>남·여 리그에 모두 참가한 반</b>이 앞섭니다</span></label>
    <p class="small muted">순위 결정: ${SD.tiebreakOf({ bothTie: f.bothTie }).join(' → ')}. 레이저런 참가 반은 팀·선수 메뉴에서 지정하고, 남·여 모두 참가는 조편성으로 자동 판단합니다.</p>
    ${canEdit ? html`<div class="row"><span class="spacer"></span><button class="btn btn-primary" onClick=${save}>규정 저장</button></div>` : null}
  </div></section>`;
}
function GroupEditor({ L, canEdit }) {
  const sp = L.sp;
  const [txt, setTxt] = useState(() => ({ M: groupsToText(sp, 'M'), W: groupsToText(sp, 'W') }));
  const [plan, setPlan] = useState(null);
  const preview = () => {
    const divisions = {}; const errs = [];
    for (const d of DIVS) { const r = parseGroups(txt[d]); errs.push(...r.errs.map(e => `${DIV_LABEL[d]}: ${e}`)); divisions[d] = { ...(sp.divisions[d] || {}), groups: r.groups }; }
    if (errs.length) return toast(errs[0], 'err');
    const nextSp = { ...sp, divisions };
    setPlan({ nextSp, ...SD.planRing(L.sid, nextSp) });
  };
  const apply = async () => {
    const p = plan; setPlan(null);
    const { id, ...body } = p.nextSp;
    if (!(await setDoc('sports/' + L.sid, body))) return;
    for (const c of p.create) await setDoc('matches/' + c.id, c.doc);
    for (const u of p.update) patchDoc('matches/' + u.id, u.patch, 0);
    for (const r of p.remove) await delDoc('matches/' + r);
    logAct(`${sp.name} 조편성 저장 (경기 +${p.create.length} / 변경 ${p.update.length} / 삭제 ${p.remove.length})`);
    toast('조편성과 링크전 경기를 저장했습니다.');
  };
  return html`<section class="panel" style="grid-column:1/-1"><div class="panel-head"><h2>조편성</h2><span class="sub">한 줄에 한 조 · 적은 순서가 링크전 번호(1→2→3→4→1)</span></div>
    <div class="panel-body stack">
      <div class="grid cols-2">${DIVS.map(d => html`<label class="field"><span>${DIV_LABEL[d]}</span>
        <textarea id=${'grp-' + d} class="textarea" rows="9" style="font-variant-numeric:tabular-nums" disabled=${!canEdit} value=${txt[d]} onInput=${e => setTxt({ ...txt, [d]: e.target.value })} placeholder="A: 2-2, 2-1, 3-5, 1-10"></textarea></label>`)}</div>
      ${canEdit ? html`<div class="row"><span class="small muted">기록이 있는 경기는 지우거나 바꾸지 않습니다.</span><span class="spacer"></span><button class="btn btn-primary" onClick=${preview}>저장하고 경기 동기화</button></div>` : null}
    </div>
    ${plan ? html`<${Modal} title="조편성 변경 확인" onClose=${() => setPlan(null)} foot=${html`<button class="btn" onClick=${() => setPlan(null)}>취소</button><button class="btn btn-primary" onClick=${apply}>적용</button>`}>
      <dl class="kv"><dt>유지</dt><dd>${plan.keep}경기</dd><dt>새로 만들 경기</dt><dd>${plan.create.length}경기</dd><dt>대진 변경</dt><dd>${plan.update.length}경기</dd><dt>삭제</dt><dd>${plan.remove.length}경기</dd></dl>
      ${plan.blocked.length ? html`<div class="banner warn small">기록이 있는 ${plan.blocked.length}경기는 새 조편성과 맞지 않지만 그대로 둡니다: ${plan.blocked.map(m => vsText(m)).join(', ')}</div>` : null}
    </${Modal}>` : null}
  </section>`;
}
function SportAdmin({ L }) {
  const [name, setName] = useState('');
  const create = async () => {
    const n = name.trim(); if (!n) return;
    const id = 's' + uid().slice(-8);
    const ok = await setDoc('sports/' + id, { name: n, league: (L.sp && L.sp.league) || '', order: Object.keys(S.sports).length + 1, venues: L.venues,
      divisions: { M: { label: '남자부', groups: {}, advance: 2 }, W: { label: '여자부', groups: {}, advance: 2 } }, rules: { ...SD.DEFAULT_RULES }, laser: { M: {}, W: {} }, createdAt: Date.now() });
    if (ok) { logAct(`새 종목 '${n}' 추가`); S.sportId = id; SD.ls.set('sport', id); setName(''); SD.bump(); toast(`'${n}' 종목을 만들었습니다. 조편성을 입력하세요.`); }
  };
  return html`<section class="panel"><div class="panel-head"><h2>종목 · 데이터</h2></div><div class="panel-body stack">
    <label class="field"><span>새 종목 추가 (레이저런, 농구, 피구 등)</span><div class="row"><input id="new-sport" class="input" style="flex:1" value=${name} onInput=${e => setName(e.target.value)} placeholder="종목 이름" /><button class="btn" onClick=${create}>추가</button></div></label>
    <p class="small muted">새 종목은 선수 명단과 경기 기록을 따로 관리하고, 영구 출전 금지 명단은 모든 종목이 함께 씁니다.</p>
    ${S.isOwner ? html`<div class="hr"></div><p class="small muted">오래된 활동 기록 정리는 아래 「활동 기록」에서 비밀번호를 넣고 할 수 있습니다.</p>` : null}
  </div></section>`;
}

// ---------- broadcast settings ----------
// Slide kinds for TV 송출 › 슬라이드 구성, listed in the saved order (SD.tvOrder). The notice scene is always last.
const SLIDES = {
  yesterday: ['어제의 경기 결과', '어제 경기가 없으면 건너뜁니다'], today: ['오늘의 경기', ''], tomorrow: ['내일의 경기', '내일 경기가 없으면 건너뜁니다'],
  standM: ['남자부 조별 순위', ''], standW: ['여자부 조별 순위', ''],
  scorers: ['득점 TOP 10', '남녀 나란히'], assists: ['어시스트 TOP 10', '남녀 나란히'], mvp: ['MVP · 발롱도르 레이스', '득점 3점 + 어시스트 2점'],
  chem: ['베스트 케미 TOP 10', '골-어시스트 합작 듀오'], best: ['베스트 학급 TOP 10', '남·여 합산 학급 포인트'],
  koM: ['남자부 토너먼트 대진표', '대진을 만든 뒤 표시'], koW: ['여자부 토너먼트 대진표', '대진을 만든 뒤 표시'],
  susp: ['출전 정지 명단', '학생 이름이 공개되니 학교 방침을 확인하세요'],
};
// The slide list: switch · time per row, reordered by dragging the handle or with ▲▼.
function SlideList({ tv, canEdit, setSec }) {
  const order = SD.tvOrder(tv);
  const [drag, setDrag] = useState(null);   // kind being dragged
  const [over, setOver] = useState(null);   // { k, after } drop mark
  const rows = useRef({});
  const save = o => saveTv({ order: o });
  const move = (i, d) => { const o = order.slice(), j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; save(o); };
  const drop = () => {
    if (drag && over && over.k !== drag) {
      const o = order.filter(k => k !== drag);
      o.splice(o.indexOf(over.k) + (over.after ? 1 : 0), 0, drag);
      save(o);
    }
    setDrag(null); setOver(null);
  };
  const changed = order.join() !== SD.TV_KEYS.join();
  const row = (k, i) => {
    const [label, hint] = SLIDES[k] || [k, ''];
    const own = SD.tvSlideSec(tv, k);
    const mark = over && over.k === k && drag && drag !== k ? (over.after ? ' drop-after' : ' drop-before') : '';
    return html`<div class=${'slide-row' + (drag === k ? ' dragging' : '') + mark} key=${k} ref=${el => { rows.current[k] = el; }}
      onDragOver=${e => { if (!drag) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2; if (!over || over.k !== k || over.after !== after) setOver({ k, after }); }}
      onDrop=${e => { e.preventDefault(); drop(); }}>
      ${canEdit ? html`<span class="sl-grip" draggable="true" title="끌어서 순서 바꾸기" aria-hidden="true"
        onDragStart=${e => { setDrag(k); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', k); if (rows.current[k]) e.dataTransfer.setDragImage(rows.current[k], 20, 18); } catch (x) { /* old browsers */ } }}
        onDragEnd=${() => { setDrag(null); setOver(null); }}><${Icon} n="grip" size=${16} /></span>` : null}
      <label class="switch"><input type="checkbox" checked=${SD.tvSlideOn(tv, k)} disabled=${!canEdit} onChange=${e => saveTv({ slides: { [k]: e.target.checked } })} /><span>${label}${hint ? html` <span class="small muted">· ${hint}</span>` : null}</span></label>
      ${canEdit ? html`<span class="sl-mv"><button type="button" class="icon-btn" aria-label=${label + ' 위로'} disabled=${i === 0} onClick=${() => move(i, -1)}><${Icon} n="up" size=${15} /></button><button type="button" class="icon-btn" aria-label=${label + ' 아래로'} disabled=${i === order.length - 1} onClick=${() => move(i, 1)}><${Icon} n="down" size=${15} /></button></span>` : null}
      <label class="sec"><input id=${'tv-sec-' + k} class="input" type="number" min="3" max="120" step="1" inputmode="numeric" aria-label=${label + ' 시간(초)'} disabled=${!canEdit}
        value=${own == null ? '' : own} placeholder=${String(tv.interval)} onChange=${e => setSec(k, e.target.value)} /><span>초</span></label></div>`;
  };
  return html`<div class="slide-list">
    <div class="slide-head small muted"><span>슬라이드 · 위에서부터 차례로 나옵니다${canEdit ? ' (⋮⋮ 끌기 또는 ▲▼로 순서 바꾸기)' : ''}</span><span>보여 줄 시간</span></div>
    ${order.map(row)}
    <div class="slide-row fixed" key="notice">
      ${canEdit ? html`<span class="sl-grip off" aria-hidden="true"></span>` : null}
      <label class="switch"><input type="checkbox" checked=${!!tv.slides.notice} disabled=${!canEdit} onChange=${e => saveTv({ slides: { notice: e.target.checked } })} /><span>공지 (마지막 장면) <span class="small muted">· 항상 맨 끝에 나옵니다</span></span></label>
      ${canEdit ? html`<span class="sl-mv"></span>` : null}
      <label class="sec"><input id="tv-sec-notice" class="input" type="number" min="3" max="120" step="1" inputmode="numeric" aria-label="공지 시간(초)" disabled=${!canEdit}
        value=${tv.noticeSec} placeholder=${String(tv.interval)} onChange=${e => setSec('notice', e.target.value)} /><span>초</span></label></div>
    ${canEdit && changed ? html`<div class="row"><span class="spacer"></span><button type="button" class="btn btn-sm" onClick=${() => save(SD.TV_KEYS.slice())}>처음 순서로</button></div>` : null}
  </div>`;
}
function saveTv(patch) {
  if (!S.tv) return setDoc('config/tv', SD.deepMerge(SD.DEFAULT_TV, patch));
  return patchDoc('config/tv', patch, 500);
}
// ---------- notice lettering: font, size, colour for the notice strip and the last notice scene ----------
const NC_SWATCHES = [['', '흰색 (기본)', '#FFFFFF'], ['#FFE066', '노랑'], ['#FFF3B0', '연노랑'], ['#FFB86B', '주황'], ['#FF8FB1', '분홍'], ['#FF7B7B', '빨강'],
  ['#B5F28C', '연두'], ['#7EF0CF', '민트'], ['#8FD3FF', '하늘'], ['#C7B8FF', '연보라']];
const lum = hex => { const n = parseInt(hex.slice(1), 16), c = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(n >> 16) + 0.7152 * c((n >> 8) & 255) + 0.0722 * c(n & 255); };
// Sizes the mini TV like the real one: 1em = 1/96 of the width (20px on a 1920px TV). Set on an element that
// Preact gives no style of its own, so a re-render never wipes it.
function useTvEm() {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => { el.style.fontSize = Math.max(3.6, el.clientWidth / 96) + 'px'; };
    fit();
    const ro = window.ResizeObserver ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(el); else window.addEventListener('resize', fit);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', fit); };
  }, []);
  return ref;
}
function NoticeLook({ tv, canEdit, notice, noticeEnd }) {
  const ns = tv.noticeStyle || {}, bg = tv.bg || {};
  const [draft, setDraft] = useState({}); // size / colour while a slider or the colour picker is being dragged
  const cur = { font: ns.font || '', size: draft.size != null ? draft.size : SD.noticeSize(ns.size), color: draft.color != null ? draft.color : (SD.hexOk(ns.color) ? ns.color : '') };
  const set = patch => { setDraft({}); if (canEdit) saveTv({ noticeStyle: patch }); };
  useEffect(() => { SD.loadFonts(SD.NOTICE_FONTS.map(f => f.key)); }, []);
  const em = useTvEm();
  const tint = SD.tvTint(bg.color), look = SD.noticeVars(cur);
  const band = (notice || '').trim() || '오늘 점심 경기는 체육관에서 진행합니다';
  const scene = (noticeEnd || '').trim() || (notice || '').trim() || '치열한 승부 뒤에는 따뜻한 악수와 응원을!';
  const sample = band.length > 14 ? band.slice(0, 14) : band;
  const custom = !!cur.color && !NC_SWATCHES.some(x => x[0] === cur.color);
  const changed = cur.font || cur.size !== 1 || cur.color;
  const N = window.TVMODE || {};
  return html`<section class="panel nl-panel" style="grid-column:1/-1">
    <div class="panel-head"><h2>공지 글씨</h2><span class="sub">하단 공지 띠와 마지막 공지 장면의 폰트 · 크기 · 색 · 모든 TV에 바로 반영됩니다</span>
      ${changed && canEdit ? html`<div class="end"><button class="btn btn-sm" onClick=${() => set({ font: '', size: 1, color: '' })}>처음 글씨로</button></div>` : null}</div>
    <div class="panel-body nl-body">
      <div class="nl-left">
        <div class=${'tvp ntp' + (tint ? ' tint' : '')} style=${(tint ? tint.style + ';' : '') + look} role="img" aria-label="공지 글씨 미리보기">
          <div class="ntp-in" ref=${em}>
            <div class="ntp-scene">${N.NoticeScene ? html`<${N.NoticeScene} text=${scene} look=${look} />` : null}</div>
            ${N.NoticeBar ? html`<${N.NoticeBar} text=${band} look=${look} />` : null}
          </div>
        </div>
        <span class="small muted">미리보기 · 위는 마지막 공지 장면, 아래는 슬라이드마다 흐르는 공지 띠예요. 공지 문구를 고치면 바로 바뀌어요.</span>
      </div>
      <div class="stack nl-ctl">
        <div class="field"><span>글씨 크기 · ${Math.round(cur.size * 100)}%</span>
          <div class="row nl-size"><span class="small muted">작게</span>
            <input id="tv-nsize" type="range" min=${SD.NOTICE_SIZE[0] * 100} max=${SD.NOTICE_SIZE[1] * 100} step="5" value=${Math.round(cur.size * 100)} disabled=${!canEdit}
              aria-label="공지 글씨 크기" onInput=${e => setDraft(d => ({ ...d, size: Number(e.target.value) / 100 }))} onChange=${e => set({ size: Number(e.target.value) / 100 })} />
            <span class="small muted">크게</span></div>
          <span class="small muted">100%는 처음 크기예요. 폰트마다 크기 차이가 나지 않도록 맞춰 두었어요.</span>
        </div>
        <div class="hr"></div>
        <div class="field"><span>글씨 색</span>
          <div class="bg-sw" role="group" aria-label="공지 글씨 색">${NC_SWATCHES.map(([hex, name, shown]) => html`
            <button type="button" class="bg-dot" key=${name} title=${name} aria-label=${name} aria-pressed=${String(draft.color == null && cur.color === hex)} disabled=${!canEdit}
              style=${`--c:${shown || hex}`} onClick=${() => set({ color: hex })}></button>`)}
            <label class=${'bg-dot custom' + (custom ? ' on' : '')} title="직접 고르기" style=${custom ? `--c:${cur.color}` : ''}>
              <input type="color" aria-label="공지 글씨 색 직접 고르기" disabled=${!canEdit} value=${cur.color || '#FFFFFF'}
                onInput=${e => setDraft(d => ({ ...d, color: e.target.value }))} onChange=${e => set({ color: e.target.value })} /></label>
          </div>
          ${cur.color && lum(cur.color) < 0.3 ? html`<span class="small nl-warn">어두운 색은 TV 배경 위에서 잘 안 보일 수 있어요. 밝은 색을 추천해요.</span>`
            : html`<span class="small muted">${cur.color ? `고른 색 ${cur.color.toUpperCase()}` : '처음 디자인의 흰색 글씨예요.'}</span>`}
        </div>
      </div>
      <div class="nl-fonts">
        <div class="nl-fh"><b>폰트</b><span class="small muted">눌러서 고르세요 · 모두 무료 한글 폰트(구글 폰트)예요</span></div>
        ${SD.FONT_GROUPS.map(([g, label]) => html`<div class="nl-group" key=${g}>
          <span class="nl-gl small muted">${label}</span>
          <div class="nl-grid" role="group" aria-label=${label}>${SD.NOTICE_FONTS.filter(f => f.g === g).map(f => html`
            <button type="button" key=${f.key || 'default'} class="nl-font" aria-pressed=${String(cur.font === f.key)} disabled=${!canEdit} aria-label=${f.name + (f.key ? '' : ' (기본)')}
              onClick=${() => set({ font: f.key })}>
              <span class="nl-sample" style=${`font-family:'${f.en}', 'Black Han Sans', sans-serif;font-weight:${f.w};font-size:${Math.round(22 * f.k)}px`}>${sample}</span>
              <span class="nl-name">${f.name}${f.key ? '' : ' · 기본'}</span></button>`)}</div></div>`)}
      </div>
    </div></section>`;
}
// ---------- TV background: colour palette + effects ----------
// [saved value, name, swatch colour]; '' is the original night blue.
const BG_SWATCHES = [['', '기본 남색', '#0B1D6B'], ['#2F6BFF', '파랑'], ['#1FA6E8', '하늘'], ['#0FA3A3', '청록'], ['#1E9E5A', '초록'], ['#7CB518', '연두'],
  ['#D4A017', '골드'], ['#E8731C', '주황'], ['#E0333F', '빨강'], ['#E04E8F', '분홍'], ['#7B4DFF', '보라'], ['#A43BB5', '자주'], ['#6B7280', '회색'], ['#1A1A1A', '검정']];
function BgPanel({ tv, canEdit }) {
  const bg = tv.bg || {};
  const [drag, setDrag] = useState(null); // colour being picked (preview only until the picker closes)
  const color = drag != null ? drag : (bg.color || '');
  const tint = SD.tvTint(color);
  const set = patch => { if (canEdit) saveTv({ bg: patch }); };
  const custom = !!bg.color && !BG_SWATCHES.some(x => x[0] === bg.color);
  return html`<section class="panel bg-panel" style="grid-column:1/-1">
    <div class="panel-head"><h2>배경 꾸미기</h2><span class="sub">TV 화면의 배경 색과 효과 · 모든 TV에 바로 반영됩니다</span></div>
    <div class="panel-body bg-body">
      <div class=${'tvp' + (tint ? ' tint' : '')} style=${tint ? tint.style : ''} role="img" aria-label="TV 배경 미리보기">
        <${UI.StarField} tv=${true} balls=${bg.balls !== false} meteors=${!!bg.meteors} amt=${bg.amt} speed=${bg.speed} />
        <div class="tvp-in">
          <div class="tvp-head"><b>2026 SEONGDEOK FUTSAL</b><span>12:30</span></div>
          <div class="tvp-cards">
            <div class="tvp-card M"><b>A</b><i></i><i></i><i></i></div>
            <div class="tvp-card W"><b>A</b><i></i><i></i><i></i></div>
            <div class="tvp-card"><b>VS</b><i></i><i></i><i></i></div>
          </div>
        </div>
      </div>
      <div class="stack bg-ctl">
        <div class="field"><span>배경 색</span>
          <div class="bg-sw" role="group" aria-label="배경 색">${BG_SWATCHES.map(([hex, name, shown]) => html`
            <button type="button" class="bg-dot" key=${name} title=${name} aria-label=${name} aria-pressed=${String(!drag && (bg.color || '') === hex)} disabled=${!canEdit}
              style=${`--c:${shown || hex}`} onClick=${() => { setDrag(null); set({ color: hex }); }}></button>`)}
            <label class=${'bg-dot custom' + (custom || drag ? ' on' : '')} title="직접 고르기" style=${custom || drag ? `--c:${color}` : ''}>
              <input type="color" aria-label="배경 색 직접 고르기" disabled=${!canEdit} value=${/^#[0-9a-f]{6}$/i.test(color) ? color : '#2F6BFF'}
                onInput=${e => setDrag(e.target.value)} onChange=${e => { setDrag(null); set({ color: e.target.value }); }} /></label>
          </div>
          <span class="small muted">${color ? `고른 색 ${color.toUpperCase()} · 밝은 색을 골라도 글씨가 잘 보이도록 어두운 톤으로 맞춥니다. 남녀 조 색과 1·2·3위 색은 그대로예요.` : '처음 디자인의 남색 배경입니다. 마지막 동그라미(무지개)를 누르면 아무 색이나 고를 수 있어요.'}</span>
        </div>
        <div class="hr"></div>
        <div class="field"><span>배경 효과 · 반짝이는 작은 별은 늘 깔려 있어요</span>
          <label class="switch"><input id="tv-bg-balls" type="checkbox" checked=${bg.balls !== false} disabled=${!canEdit} onChange=${e => set({ balls: e.target.checked })} /><span>떠다니는 공</span></label>
          <label class="switch"><input id="tv-bg-met" type="checkbox" checked=${!!bg.meteors} disabled=${!canEdit} onChange=${e => set({ meteors: e.target.checked })} /><span>별똥별</span></label>
          ${bg.meteors ? html`<div class="bg-met">
            <div class="row"><span class="small muted bg-l">양</span><${Seg} label="별똥별 양" value=${bg.amt || 'mid'} onChange=${v => set({ amt: v })}
              options=${[{ value: 'low', label: '적게' }, { value: 'mid', label: '보통' }, { value: 'high', label: '많게' }]} /></div>
            <div class="row"><span class="small muted bg-l">속도</span><${Seg} label="별똥별 속도" value=${bg.speed || 'mix'} onChange=${v => set({ speed: v })}
              options=${[{ value: 'slow', label: '느리게' }, { value: 'mix', label: '느린 것 + 빠른 것' }, { value: 'fast', label: '빠르게' }]} /></div>
          </div>` : null}
        </div>
      </div>
    </div></section>`;
}
function Broadcast({ nav, canEdit }) {
  const tv = SD.deepMerge(SD.DEFAULT_TV, S.tv || {});
  // Seconds per slide type; empty = the default scene time. The notice scene keeps its own setting.
  const setSec = (k, raw) => {
    const v = String(raw).trim() === '' ? null : Math.min(120, Math.max(3, Math.round(Number(raw)) || 0));
    if (k === 'notice') return saveTv({ noticeSec: v == null ? SD.DEFAULT_TV.noticeSec : v });
    saveTv({ slideSec: { [k]: v } });
  };
  const tvs = S.peers.filter(p => p.presence && p.presence.mode === 'tv');
  const [notice, setNotice] = useState(tv.notice || '');
  const [noticeEnd, setNoticeEnd] = useState(tv.noticeEnd || '');
  return html`<div>
    <${PageHead} eyebrow="TV broadcast" title="TV 송출" desc="HDMI로 연결한 TV에 경기 일정, 조별 순위, 개인 순위를 자동으로 넘기며 보여줍니다. 기록이 바뀌면 TV 화면도 바로 갱신됩니다.">
      <button class="btn btn-primary" onClick=${() => nav.tv()}><${Icon} n="tv" />TV 모드 시작</button>
    </${PageHead}>
    <div class="grid cols-2">
      <section class="panel"><div class="panel-head"><h2>공지</h2><span class="sub">하단 공지 띠 · 마지막 공지 장면</span></div>
        <div class="panel-body stack">
          <label class="field"><span>하단 공지 띠 문구 · 모든 슬라이드 아래에 흐릅니다</span><textarea id="tv-notice" class="textarea" rows="2" disabled=${!canEdit} value=${notice} onInput=${e => setNotice(e.target.value)} placeholder="예: 오늘 점심 경기는 우천으로 체육관에서 진행합니다"></textarea></label>
          <label class="switch"><input type="checkbox" checked=${!!tv.noticeBar} disabled=${!canEdit} onChange=${e => saveTv({ noticeBar: e.target.checked })} /><span>모든 슬라이드 아래에 공지 띠 표시</span></label>
          <div class="hr"></div>
          <label class="field"><span>마지막 공지 장면 문구 · 한 장면에 크게 보여줍니다</span><textarea id="tv-notice-end" class="textarea" rows="4" disabled=${!canEdit} value=${noticeEnd} onInput=${e => setNoticeEnd(e.target.value)} placeholder="비워 두면 위 하단 공지 띠 문구를 그대로 보여줍니다"></textarea></label>
          <label class="field"><span>마지막 공지 장면 시간: ${tv.noticeSec}초</span><input id="tv-nsec" type="range" min="3" max="60" step="1" value=${tv.noticeSec} disabled=${!canEdit} onChange=${e => saveTv({ noticeSec: Number(e.target.value) })} /></label>
          ${canEdit ? html`<div class="row"><span class="small muted">${tv.slides.notice ? '' : '마지막 공지 장면이 슬라이드 구성에서 꺼져 있습니다.'}</span><span class="spacer"></span><button class="btn btn-primary" onClick=${() => { saveTv({ notice, noticeEnd }); toast('공지를 저장했습니다. TV에 바로 반영됩니다.'); }}>공지 저장</button></div>` : null}
        </div></section>
      <section class="panel"><div class="panel-head"><h2>슬라이드 구성</h2><span class="sub">모든 TV에 공통 적용</span></div>
        <div class="panel-body stack">
          <${SlideList} tv=${tv} canEdit=${canEdit} setSec=${setSec} />
          <div class="hr"></div>
          <label class="field"><span>기본 장면 시간: ${tv.interval}초 · 시간을 비워 둔 슬라이드에 적용</span><input id="tv-int" type="range" min="6" max="40" step="1" value=${tv.interval} disabled=${!canEdit} onChange=${e => saveTv({ interval: Number(e.target.value) })} /></label>
          <div class="hr"></div>
          <div class="mv-set">
            <label class="switch"><input id="tv-move" type="checkbox" checked=${tv.move.on !== false} disabled=${!canEdit} onChange=${e => saveTv({ move: { on: e.target.checked } })} /><span>순위 변동 표시
              <span class="mv-demo" aria-hidden="true"><i class="mv up">▲2</i><i class="mv dn">▼1</i><i class="mv same">–</i><i class="mv new">NEW</i></span></span></label>
            ${tv.move.on !== false ? html`<div class="row wrap mv-base"><span class="small muted">비교 기준</span>
              <${Seg} label="순위 변동 비교 기준" value=${tv.move.base === 'week' ? 'week' : 'day'} onChange=${v => canEdit && saveTv({ move: { base: v } })}
                options=${[{ value: 'day', label: '최근 경기일 전' }, { value: 'week', label: '그 주 월요일 전' }]} /></div>` : null}
            <span class="small muted">조별 순위 · 득점 · 어시스트 · 발롱도르 · 케미 · 베스트 학급 순위 옆에 ▲▼가 붙습니다. ${tv.move.base === 'week' ? '최근 경기가 있었던 주의 월요일 직전 순위와 비교합니다.' : '가장 최근 경기일 직전 순위와 비교합니다. 오늘 경기 결과로 순위가 어떻게 바뀌었는지 보여 줍니다.'}</span>
          </div>
        </div></section>
      <${NoticeLook} tv=${tv} canEdit=${canEdit} notice=${notice} noticeEnd=${noticeEnd} />
      <${BgPanel} tv=${tv} canEdit=${canEdit} />
      <${MusicPanel} tv=${tv} canEdit=${canEdit} />
      <section class="panel"><div class="panel-head"><h2>연결 방법</h2>${tvs.length ? html`<span class="chip ok">TV ${tvs.length}대 송출 중</span>` : html`<span class="chip">송출 중인 TV 없음</span>`}</div>
        <ol class="panel-body stack small" style="margin:0;padding-left:34px">
          <li>TV와 연결한 PC에서 편집자로 초대받은 계정으로 claude.ai에 로그인합니다.</li>
          <li>이 페이지를 열고 <b>TV 모드 시작</b>을 누릅니다. 주소 끝에 <code>#tv</code>를 붙여 즐겨찾기하면 바로 TV 모드로 열립니다.</li>
          <li>전체 화면 버튼(또는 F11)을 누릅니다. 키보드 ← → 로 넘기고, 스페이스로 멈추고, Esc로 나갑니다.</li>
        </ol></section>
    </div>
  </div>`;
}

// Background music for every TV: on/off, order (↑ ↓), take out / add back from the song library, preview, default volume.
const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
function MusicPanel({ tv, canEdit }) {
  const m = tv.music || {};
  const list = SD.playlistOf(tv);
  const ids = list.map(t => t.id);
  const rest = SD.MUSIC.filter(t => !ids.includes(t.id));
  const [preview, setPreview] = useState(null);
  const au = preactHooks.useRef(null);
  preactHooks.useEffect(() => () => { if (au.current) { au.current.pause(); au.current = null; } }, []);
  const listen = t => {
    if (!au.current) { au.current = new Audio(); au.current.addEventListener('ended', () => setPreview(null)); }
    if (preview === t.id) { au.current.pause(); setPreview(null); return; }
    au.current.src = t.file; au.current.volume = 0.8; au.current.play().then(() => setPreview(t.id)).catch(() => toast('미리듣기를 시작하지 못했습니다.', 'err'));
  };
  const setOrder = order => saveTv({ music: { order } });
  const move = (i, d) => { const o = ids.slice(); const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; setOrder(o); };
  const total = list.reduce((s, t) => s + (t.dur || 0), 0);
  if (SD.VIEWER) return html`<section class="panel music-panel" style="grid-column:1/-1">
    <div class="panel-head"><h2>배경음악</h2><span class="sub">TV 송출을 시작하면 위에서부터 차례로 재생하고, 마지막 곡 뒤에는 처음으로 돌아갑니다</span></div>
    <div class="panel-body"><p class="muted">둘러보기 페이지에는 음악 파일을 넣지 않았습니다. 실제 화면에서는 여기서 TV 배경음악의 재생 목록과 순서를 정하고 미리 들어 볼 수 있습니다.</p></div></section>`;
  return html`<section class="panel music-panel" style="grid-column:1/-1">
    <div class="panel-head"><h2>배경음악</h2><span class="sub">TV 송출을 시작하면 위에서부터 차례로 재생하고, 마지막 곡 뒤에는 처음으로 돌아갑니다</span>
      <div class="end"><label class="switch"><input type="checkbox" checked=${m.on !== false} disabled=${!canEdit} onChange=${e => saveTv({ music: { on: e.target.checked } })} /><span>${m.on !== false ? '켜짐' : '꺼짐'}</span></label></div></div>
    <div class="music-cols">
      <div><div class="mu-h">재생 목록 <span class="muted">${list.length}곡 · ${mmss(total)}</span></div>
        ${list.length ? html`<ol class="mu-list">${list.map((t, i) => html`<li class=${'mu-row' + (preview === t.id ? ' on' : '')} key=${t.id}>
          <span class="mu-n">${i + 1}</span>
          <span class="mu-t"><b>${t.title}</b><span>${t.artist} · ${mmss(t.dur)}</span></span>
          <span class="mu-ctl">
            <button type="button" class="icon-btn" aria-label=${preview === t.id ? '미리듣기 멈춤' : '미리듣기'} title="미리듣기" onClick=${() => listen(t)}><${Icon} n=${preview === t.id ? 'stop' : 'play'} size=${15} /></button>
            ${canEdit ? html`<button type="button" class="icon-btn" aria-label="위로" disabled=${i === 0} onClick=${() => move(i, -1)}><${Icon} n="up" /></button>
            <button type="button" class="icon-btn" aria-label="아래로" disabled=${i === list.length - 1} onClick=${() => move(i, 1)}><${Icon} n="down" /></button>
            <button type="button" class="btn btn-sm" onClick=${() => setOrder(ids.filter(x => x !== t.id))}>빼기</button>` : null}
          </span></li>`)}</ol>` : html`<${Empty} title="재생 목록이 비어 있습니다">오른쪽 곡 목록에서 추가하세요.</${Empty}>`}
      </div>
      <div><div class="mu-h">추가할 수 있는 곡 <span class="muted">${rest.length}곡</span></div>
        ${rest.length ? html`<ul class="mu-list">${rest.map(t => html`<li class=${'mu-row' + (preview === t.id ? ' on' : '')} key=${t.id}>
          <span class="mu-n"><${Icon} n="music" size=${15} /></span>
          <span class="mu-t"><b>${t.title}</b><span>${t.artist} · ${mmss(t.dur)}</span></span>
          <span class="mu-ctl"><button type="button" class="icon-btn" aria-label="미리듣기" onClick=${() => listen(t)}><${Icon} n=${preview === t.id ? 'stop' : 'play'} size=${15} /></button>
            ${canEdit ? html`<button type="button" class="btn btn-sm" onClick=${() => setOrder([...ids, t.id])}><${Icon} n="plus" />추가</button>` : null}</span></li>`)}</ul>`
          : html`<p class="small muted" style="padding:10px 2px">모든 곡이 재생 목록에 있습니다.</p>`}
        <label class="field" style="margin-top:14px"><span>TV 기본 음량: ${Math.round((m.vol ?? 0.7) * 100)}%</span>
          <input id="tv-music-vol" type="range" min="0" max="1" step="0.05" value=${m.vol ?? 0.7} disabled=${!canEdit} onChange=${e => saveTv({ music: { vol: Number(e.target.value) } })} /></label>
        <p class="small muted" style="margin-top:8px">각 TV 화면 아래 조작 버튼에서 음량을 따로 바꿀 수 있습니다. 새 노래는 mp3 파일(곡당 15MB 이하)로 받아 이 곡 목록에 추가합니다.</p>
      </div>
    </div>
  </section>`;
}

Object.assign(window.PAGES, { Teams, Discipline, Settings, Broadcast, SLIDES, saveTv, LogVault });
})();
