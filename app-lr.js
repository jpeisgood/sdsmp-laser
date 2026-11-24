/* SDSMP 레이저런 단독 사이트(GitHub Pages + Firebase)의 껍데기: 로그인 화면 · 메뉴 · TV 전환 · 계정 관리.
   화면 내용은 laser.js(LASER.Root · LASER.TV)를 그대로 쓴다. 로그인과 역할은 fb/shim.js(window.FBX)가 맡는다. */
(function () {
'use strict';
const { render } = preact;
const { useState, useEffect } = preactHooks;
const { html, Icon, Logo, Toasts } = UI;
const { S, useStore } = SD;
const LR = window.LASER;
const FBX = window.FBX;
const ROLE_KO = { owner: '관리자', editor: '선생님 · 편집', staff: '체육회 · 지점 요원', viewer: 'TV 화면' };

const readHash = () => { const h = (location.hash || '').replace('#', ''); return h === 'tv' ? { route: 'home', tv: true } : { route: h || 'home', tv: false }; };
const setHash = h => { try { history.replaceState(null, '', location.pathname + location.search + '#' + h); } catch (e) { /* 그대로 */ } };

/* ---------- 로그인 화면 ---------- */
function CodeJoin({ st }) {
  const [role, setRole] = useState('staff');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    if (!code.trim()) { setErr('코드를 입력해 주세요.'); return; }
    if (role === 'staff' && !name.trim()) { setErr('이름을 입력해 주세요.'); return; }
    setBusy(true); setErr('');
    try { await FBX.joinWithCode(role, code, role === 'viewer' ? 'TV 화면' : name); }
    catch (e) { setErr(FBX.friendly(e)); }
    setBusy(false);
  };
  return html`<div class="lg-box">
    <h3>체육회 학생 · TV 화면</h3>
    <p class="muted small">관리자 선생님께 받은 코드로 들어갑니다. 계정 만들기는 필요 없어요.</p>
    <div class="seg lg-seg" role="group" aria-label="들어가는 용도">
      <button type="button" aria-pressed=${String(role === 'staff')} onClick=${() => setRole('staff')}>체육회 · 지점 요원</button>
      <button type="button" aria-pressed=${String(role === 'viewer')} onClick=${() => setRole('viewer')}>TV 화면</button>
    </div>
    ${role === 'staff' ? html`<label class="field"><span>이름</span><input id="lg-name" class="input" value=${name} maxlength="30" placeholder="예: 김성덕" onInput=${e => setName(e.target.value)} /></label>` : null}
    <label class="field"><span>${role === 'staff' ? '체육회 코드' : 'TV 코드'}</span><input id="lg-code" class="input" value=${code} autocomplete="off" onInput=${e => setCode(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') go(); }} /></label>
    ${err ? html`<p class="lg-err">${err}</p>` : null}
    <button id="lg-join" class="btn btn-primary btn-block" disabled=${busy} onClick=${go}>${busy ? '확인하는 중…' : '들어가기'}</button>
  </div>`;
}
function TeacherBox({ st }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [sent, setSent] = useState(false);
  const u = st.user, google = !!(u && !u.isAnonymous);
  useEffect(() => { if (!google || st.phase !== 'noRole') return; return FBX.watch('joinRequests/' + u.uid, d => setSent(!!d)); }, [google, st.phase, u && u.uid]);
  const run = async f => { setBusy(true); setErr(''); try { await f(); } catch (e) { setErr(FBX.friendly(e)); } setBusy(false); };
  if (!google) return html`<div class="lg-box">
    <h3>선생님 (기록 입력 · 관리)</h3>
    <p class="muted small">구글 계정으로 로그인합니다. 처음이면 관리자 선생님이 승인해야 편집할 수 있어요.</p>
    ${err ? html`<p class="lg-err">${err}</p>` : null}
    <button id="lg-google" class="btn btn-primary btn-block" disabled=${busy} onClick=${() => run(FBX.signInGoogle)}>Google로 로그인</button>
  </div>`;
  return html`<div class="lg-box">
    <h3>${u.displayName || u.email} 선생님</h3>
    ${!st.ownerUid ? html`<p class="small">아직 이 대회의 관리자가 없습니다. 대회를 맡은 선생님이면 관리자로 등록하세요. 관리자는 코드를 정하고 다른 선생님의 편집 권한을 승인합니다.</p>
      ${err ? html`<p class="lg-err">${err}</p>` : null}
      <button id="lg-owner" class="btn btn-primary btn-block" disabled=${busy} onClick=${() => run(FBX.claimOwner)}>이 대회의 관리자로 등록</button>`
    : sent ? html`<p class="small">편집 권한 요청을 보냈습니다. 관리자 선생님이 승인하면 이 화면이 자동으로 열려요.</p>`
    : html`<p class="small">편집 권한이 아직 없습니다. 관리자 선생님께 요청을 보내세요.</p>
      <label class="field"><span>이름 (관리자에게 보일 이름)</span><input id="lg-tname" class="input" value=${name} placeholder=${u.displayName || ''} onInput=${e => setName(e.target.value)} /></label>
      ${err ? html`<p class="lg-err">${err}</p>` : null}
      <button id="lg-request" class="btn btn-primary btn-block" disabled=${busy} onClick=${() => run(() => FBX.requestEditor(name || u.displayName))}>편집 권한 요청 보내기</button>`}
  </div>`;
}
function Gate({ st }) {
  if (st.phase === 'config') return html`<div class="lg"><div class="lg-card"><${Logo} size=${72} /><h2>설정이 필요합니다</h2><p class="muted">${FBX.error}</p></div></div>`;
  if (st.phase === 'loading') return html`<div class="lg"><div class="lg-card lg-wait"><${Logo} size=${72} /><p class="muted">불러오는 중…</p></div></div>`;
  const signed = !!st.user;
  return html`<div class="lg"><div class="lg-card">
    <div class="lg-head"><${Logo} size=${64} /><div><b>SDSMP 레이저런</b><span>성덕 레이저런 리그 · 기록 · 중계</span></div></div>
    <div class="lg-grid">
      <${TeacherBox} st=${st} />
      <${CodeJoin} st=${st} />
    </div>
    ${signed ? html`<p class="lg-foot muted small">${st.user.isAnonymous ? '코드 확인 전입니다.' : '로그인됨: ' + (st.user.email || '')} <button class="linkish" onClick=${() => FBX.signOut()}>로그아웃</button></p>` : null}
  </div></div>`;
}

/* ---------- 관리자: 코드 · 편집 권한 승인 · 구성원 ---------- */
function AccessPanel({ onClose }) {
  const [codes, setCodes] = useState(null);
  const [reqs, setReqs] = useState([]);
  const [roles, setRoles] = useState([]);
  const [draft, setDraft] = useState({ staff: '', viewer: '' });
  useEffect(() => FBX.watch('private/codes', d => { setCodes(d || {}); setDraft({ staff: (d && d.staff) || '', viewer: (d && d.viewer) || '' }); }), []);
  useEffect(() => FBX.watch('joinRequests', setReqs), []);
  useEffect(() => FBX.watch('roles', setRoles), []);
  const saveCodes = async () => { await FBX.put('private/codes', { staff: draft.staff.trim(), viewer: draft.viewer.trim() }, true); SD.toast('코드를 저장했습니다.'); };
  const approve = async r => { await FBX.put('roles/' + r.id, { role: 'editor', name: r.name || r.email || '선생님', at: Date.now() }); await FBX.del('joinRequests/' + r.id); SD.toast((r.name || '선생님') + ' 편집 권한을 승인했습니다.'); };
  const deny = r => FBX.del('joinRequests/' + r.id);
  const setRole = (r, role) => FBX.put('roles/' + r.id, { role }, true);
  const remove = r => { if (confirm((r.name || '이 사람') + '의 권한을 없앨까요?')) FBX.del('roles/' + r.id); };
  const rand = () => String(Math.floor(100000 + Math.random() * 900000));
  return html`<${UI.Modal} title="계정 · 권한 관리" wide onClose=${onClose} foot=${html`<button class="btn" onClick=${onClose}>닫기</button>`} cls="lr lr-modal">
    <section class="acc-sec">
      <h4>들어가는 코드</h4>
      <p class="muted small">체육회 학생과 TV 화면은 계정 없이 이 코드로 들어옵니다. 코드를 바꿔도 이미 들어온 사람은 그대로이니, 내보내려면 아래 구성원에서 지우세요.</p>
      <div class="acc-codes">
        <label class="field"><span>체육회 · 지점 요원 코드</span><div class="inline-input"><input class="input" value=${draft.staff} onInput=${e => setDraft({ ...draft, staff: e.target.value })} /><button class="btn btn-sm" onClick=${() => setDraft({ ...draft, staff: rand() })}>새로 만들기</button></div></label>
        <label class="field"><span>TV 화면 코드</span><div class="inline-input"><input class="input" value=${draft.viewer} onInput=${e => setDraft({ ...draft, viewer: e.target.value })} /><button class="btn btn-sm" onClick=${() => setDraft({ ...draft, viewer: rand() })}>새로 만들기</button></div></label>
      </div>
      <button class="btn btn-primary" disabled=${codes === null} onClick=${saveCodes}>코드 저장</button>
    </section>
    <section class="acc-sec">
      <h4>편집 권한 요청 ${reqs.length ? html`<span class="chip warn">${reqs.length}</span>` : null}</h4>
      ${reqs.length ? html`<ul class="acc-list">${reqs.map(r => html`<li key=${r.id}><b>${r.name || '이름 없음'}</b><span class="muted small">${r.email || ''}</span><span class="spacer"></span>
        <button class="btn btn-sm btn-primary" onClick=${() => approve(r)}>승인</button><button class="btn btn-sm btn-ghost" onClick=${() => deny(r)}>거절</button></li>`)}</ul>`
        : html`<p class="muted small">기다리는 요청이 없습니다. 다른 선생님은 사이트에서 구글로 로그인한 뒤 「편집 권한 요청」을 누르면 여기에 나타납니다.</p>`}
    </section>
    <section class="acc-sec">
      <h4>구성원 · ${roles.length}명</h4>
      <ul class="acc-list">${roles.slice().sort((a, b) => String(a.role).localeCompare(String(b.role)) || (b.at || 0) - (a.at || 0)).map(r => html`<li key=${r.id}>
        <b>${r.name || '이름 없음'}</b>
        <select class="select" value=${r.role} onChange=${e => setRole(r, e.target.value)}>${['editor', 'staff', 'viewer'].map(k => html`<option value=${k}>${ROLE_KO[k]}</option>`)}</select>
        <span class="spacer"></span><button class="btn btn-sm btn-danger-ghost" onClick=${() => remove(r)}>내보내기</button></li>`)}</ul>
    </section>
  <//>`;
}

/* ---------- 메뉴 ---------- */
function Rail({ route, nav, open, canEdit, st, onAccess }) {
  useStore();
  const others = S.peers.filter(p => !p.sameTab);
  const tvs = others.filter(p => p.presence && p.presence.mode === 'tv').length;
  const live = LR.liveCount();
  return html`<aside class=${'rail' + (open ? ' open' : '')} aria-label="메뉴">
    <div class="rail-head"><${Logo} size=${64} /><div><div class="brand-word">SDSMP</div><div class="brand-sub">SD Sports<br/>Management Platform</div></div></div>
    <div class="rail-sport lr-only"><span class="lbl">종목</span><b>레이저런</b></div>
    <nav class="nav">${LR.nav(canEdit).map(([r, label, ic]) => r[0] === '§' ? html`<div class=${'nav-sec' + (label ? '' : ' line')}>${label}</div>` : html`
      <a href=${'#' + r} aria-current=${route === r ? 'page' : null} onClick=${e => { e.preventDefault(); nav.go(r); }}>
        <${Icon} n=${ic} />${label}
        ${r === 'ops' && live ? html`<span class="count">LIVE ${live}</span>` : null}
        ${r === 'broadcast' && tvs ? html`<span class="tvdot">ON AIR</span>` : null}
      </a>`)}</nav>
    <div class="rail-foot">
      <div class="who">${st.user && st.user.photoURL ? html`<img src=${st.user.photoURL} alt="" />` : null}<span>${st.name || '내 계정'}</span></div>
      <span class="conn"><i></i>${ROLE_KO[st.role] || ''}</span>
      <div class="lr-acct">
        ${st.role === 'owner' ? html`<button class="btn btn-sm" onClick=${onAccess}>계정 · 권한</button>` : null}
        <button class="btn btn-sm btn-ghost" onClick=${() => FBX.signOut()}>로그아웃</button>
      </div>
    </div>
  </aside>`;
}

function Shell({ st }) {
  useStore();
  const [navState, setNav] = useState(readHash);
  const [menu, setMenu] = useState(false);
  const [access, setAccess] = useState(false);
  useEffect(() => { const f = () => setNav(readHash()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  useEffect(() => { SD.setPresence({ view: navState.tv ? 'tv' : navState.route, mode: navState.tv ? 'tv' : 'admin' }); }, [navState.route, navState.tv]);
  useEffect(() => { document.documentElement.classList.add('lr-red'); }, []);
  const canEdit = st.role === 'owner' || st.role === 'editor';
  if (S.db) LR.attach(S.db);
  const { route, tv } = navState;
  const nav = {
    go: r => { setHash(r); setNav({ route: r, tv: false }); setMenu(false); window.scrollTo(0, 0); },
    openMatch: () => {}, openPlayer: () => {},
    tv: () => { setHash('tv'); setNav({ route, tv: true }); setMenu(false); },
  };
  if (tv) {
    const exit = () => { setHash(route); setNav({ route, tv: false }); };
    if (S.status === 'connecting') return html`<div class="tv"></div>`;
    return html`<${LR.TV} onExit=${exit} /><${Toasts} />`;
  }
  const body = S.status === 'connecting' ? html`<div class="empty" style="padding:80px 16px"><strong>데이터를 불러오는 중입니다</strong><span>잠시만 기다려 주세요.</span></div>`
    : S.status === 'nodb' ? html`<div class="banner err"><${Icon} n="link" /><div><b>데이터에 연결할 수 없습니다.</b> 인터넷 연결을 확인하고 새로고침해 주세요.</div></div>`
    : html`<${LR.Root} route=${route} nav=${nav} canEdit=${canEdit} />`;
  return html`<${UI.Waves} page=${true} /><${UI.StarField} balls=${false} /><div class="shell">
    <div class="topbar"><button class="icon-btn" aria-label="메뉴 열기" onClick=${() => setMenu(true)}><${Icon} n="menu" /></button><${Logo} size=${40} /><span class="brand-word">SDSMP</span>
      <span class="spacer"></span><span style="font-size:13px;color:var(--rail-dim)">레이저런</span></div>
    <div class=${'scrim' + (menu ? ' open' : '')} onClick=${() => setMenu(false)}></div>
    <${Rail} route=${route} nav=${nav} open=${menu} canEdit=${canEdit} st=${st} onAccess=${() => setAccess(true)} />
    <main class="main" id="main">
      ${st.role === 'staff' || st.role === 'viewer' ? html`<div class="banner small"><${Icon} n="users" /><div>${ROLE_KO[st.role]}로 들어왔습니다. 화면은 모두 볼 수 있고, 기록과 설정은 선생님 계정에서 바꿉니다.</div></div>` : null}
      ${body}
    </main>
    ${access ? html`<${AccessPanel} onClose=${() => setAccess(false)} />` : null}
    <${Toasts} />
  </div>`;
}

let booted = false;
function Root() {
  const [st, setSt] = useState(FBX.state);
  useEffect(() => FBX.onChange(setSt), []);
  if (st.phase === 'member' && !booted) {
    booted = true;
    S.sportId = LR.id;
    SD.boot();
  }
  if (booted && st.phase !== 'member') { location.reload(); return null; } // 로그아웃 · 권한 삭제: 처음부터 다시
  return st.phase === 'member' ? html`<${Shell} st=${st} />` : html`<${UI.Waves} page=${true} /><${Gate} st=${st} /><${Toasts} />`;
}
render(html`<${Root} />`, document.getElementById('app'));
})();
