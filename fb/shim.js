/* SDSMP 레이저런 · Firebase 연결층
   claude.ai 페이지가 쓰던 window.claude.use('db' | 'user' | 'room' | 'downloads' | 'assets')를 Firebase로 흉내 낸다.
   그래서 core.js · laser.js는 거의 그대로 쓴다.
   - db   → Cloud Firestore (경로를 그대로 쓴다: lr_matches/m_1, config/tv, actlog/<uid>/e/<id> …)
   - room → Realtime Database (지금 접속한 기기끼리: 시계 맞추기 · 접속 현황)
   - user → Firebase 로그인 + roles/<uid> 문서의 역할(owner · editor · staff · viewer)
   window.FBX는 로그인 화면(app-lr.js)이 쓰는 로그인 · 역할 관리 도구다. */
(function () {
  'use strict';
  const F = window.FB, cfg = window.FIREBASE_CONFIG;
  const FBX = window.FBX = { ok: false, error: '', state: { phase: 'loading', user: null, role: null, name: '', ownerUid: null }, subs: new Set() };
  if (!F || !cfg || !cfg.apiKey) {
    FBX.error = 'Firebase 설정(fb/config.js)이 비어 있습니다.';
    FBX.state = { ...FBX.state, phase: 'config' };
    window.claude = { use: async () => null };
    return;
  }
  const app = F.initializeApp(cfg);
  const auth = F.getAuth(app);
  let fs;
  try { fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
  catch (e) { fs = F.getFirestore(app); }
  let rt = null;
  try { if (cfg.databaseURL) rt = F.getDatabase(app); } catch (e) { rt = null; }
  FBX.ok = true;

  const emit = () => FBX.subs.forEach(f => { try { f(FBX.state); } catch (e) { console.error(e); } });
  const setState = p => { FBX.state = { ...FBX.state, ...p }; emit(); };
  FBX.onChange = fn => { FBX.subs.add(fn); fn(FBX.state); return () => FBX.subs.delete(fn); };
  const EDIT = new Set(['owner', 'editor']);
  const isEditor = () => EDIT.has(FBX.state.role);

  // ---------- 오류 코드: claude.ai 쪽 이름으로 바꿔 core.js · laser.js가 그대로 알아듣게 ----------
  function mapErr(e) {
    const c = (e && e.code) || '';
    const code = c === 'permission-denied' || c === 'unauthenticated' ? 'not_granted'
      : c === 'unavailable' || c === 'deadline-exceeded' ? 'unavailable'
      : c === 'resource-exhausted' ? 'resource_exhausted'
      : c === 'invalid-argument' || c === 'failed-precondition' ? 'invalid_argument' : 'upstream_error';
    const x = new Error((e && e.message) || code); x.code = code; x.cause = e; return x;
  }
  const clean = d => JSON.parse(JSON.stringify(d === undefined ? null : d));

  // ---------- db ----------
  const wrapDoc = s => ({ id: s.id, exists: s.exists(), data: () => s.data(), ref: { path: s.ref.path } });
  const wrapQuery = qs => { const docs = qs.docs.map(wrapDoc); return { docs, size: docs.length, empty: !docs.length, forEach: f => docs.forEach(f) }; };
  const OPS = { '==': '==', eq: '==', '!=': '!=', ne: '!=', '<': '<', lt: '<', '<=': '<=', lte: '<=', '>': '>', gt: '>', '>=': '>=', gte: '>=', in: 'in', 'not-in': 'not-in', 'array-contains': 'array-contains' };
  function query(col, cons) {
    const build = () => (cons.length ? F.query(F.collection(fs, col), ...cons) : F.collection(fs, col));
    return {
      where: (f, op, v) => query(col, [...cons, F.where(f, OPS[op] || op, v)]),
      orderBy: (f, dir) => query(col, [...cons, F.orderBy(f, dir === 'desc' ? 'desc' : 'asc')]),
      limit: n => query(col, [...cons, F.limit(n)]),
      doc: id => db.doc(col + '/' + id),
      get: () => F.getDocs(build()).then(wrapQuery, e => { throw mapErr(e); }),
      onSnapshot(cb, err) { return F.onSnapshot(build(), qs => cb(wrapQuery(qs)), e => err && err(mapErr(e))); },
    };
  }
  const db = {
    doc(path) {
      const r = () => F.doc(fs, path);
      return {
        path, id: path.split('/').pop(),
        get: () => F.getDoc(r()).then(wrapDoc, e => { throw mapErr(e); }),
        set: d => F.setDoc(r(), clean(d)).catch(e => { throw mapErr(e); }),
        // claude.ai의 update는 깊게 합친다 → Firestore set(merge)와 같다. 없는 문서도 만든다.
        update: d => F.setDoc(r(), clean(d), { merge: true }).catch(e => { throw mapErr(e); }),
        delete: () => F.deleteDoc(r()).catch(e => { throw mapErr(e); }),
        collection: sub => query(path + '/' + sub, []),
        onSnapshot(cb, err) { return F.onSnapshot(r(), s => cb(wrapDoc(s)), e => err && err(mapErr(e))); },
      };
    },
    collection: col => query(col, []),
  };

  // ---------- user ----------
  const profCache = {};
  const user = {
    me: async () => { const u = FBX.state.user; return { id: u ? u.uid : null, name: FBX.state.name || '', avatarUrl: (u && u.photoURL) || '', color: null }; },
    id: async () => (FBX.state.user ? FBX.state.user.uid : null),
    can: async name => (name === 'data.write' ? isEditor() : null),
    canEdit: async () => isEditor(),
    isOwner: async () => FBX.state.role === 'owner',
    profiles: async ids => {
      const out = {};
      await Promise.all((ids || []).map(async id => {
        if (!(id in profCache)) {
          try { const s = await F.getDoc(F.doc(fs, 'users/' + id)); const d = s.exists() ? s.data() : {}; profCache[id] = { id, name: d.name || '', avatarUrl: d.photo || '' }; }
          catch (e) { profCache[id] = { id, name: '', avatarUrl: '' }; }
        }
        out[id] = profCache[id];
      }));
      return out;
    },
    search: async () => [],
  };

  // ---------- room (Realtime Database) ----------
  const peerId = Math.random().toString(36).slice(2, 12);
  let room = null;
  function makeRoom() {
    if (!rt) return null;
    const base = 'room/main';
    const uid = () => (FBX.state.user ? FBX.state.user.uid : null);
    let mine = {}, peers = [], conn = false, seq = 0, offset = 0;
    const connSubs = new Set(), evKeys = new Set();
    F.onValue(F.ref(rt, '.info/serverTimeOffset'), s => { offset = s.val() || 0; });
    F.onValue(F.ref(rt, '.info/connected'), s => { conn = !!s.val(); connSubs.forEach(f => f(conn)); if (conn) writePresence(); });
    const meRef = () => F.ref(rt, base + '/peers/' + peerId);
    let armed = false;
    function writePresence() {
      if (!uid()) return Promise.resolve();
      if (!armed) { armed = true; F.onDisconnect(meRef()).remove().catch(() => { armed = false; }); }
      return F.set(meRef(), { by: uid(), p: clean(mine), t: F.serverTimestamp() }).catch(() => {});
    }
    const asPeer = (peer, o) => ({ peer, by: o.by || null, isMe: !!o.by && o.by === uid(), sameTab: peer === peerId, kind: 'viewer', guest: false, presence: Object.freeze({ ...(o.p || {}) }), updatedAt: Date.now() });
    return {
      presence: async patch => { for (const k in patch) { if (patch[k] === null) delete mine[k]; else mine[k] = patch[k]; } return writePresence(); },
      peers: () => peers,
      onPeers(cb, err) {
        return F.onValue(F.ref(rt, base + '/peers'), s => {
          const v = s.val() || {};
          peers = Object.freeze(Object.entries(v).map(([k, o]) => Object.freeze(asPeer(k, o || {}))));
          cb({ peers, joined: [], left: [], updated: [] });
        }, e => err && err(mapErr(e)));
      },
      emit: async (topic, data) => {
        if (!conn) return;
        const key = peerId + '_' + topic, r = F.ref(rt, base + '/ev/' + key);
        if (!evKeys.has(key)) { evKeys.add(key); F.onDisconnect(r).remove().catch(() => {}); }
        await F.set(r, { topic, data: clean(data), by: uid(), peer: peerId, n: ++seq, t: F.serverTimestamp() }).catch(e => { throw mapErr(e); });
      },
      on(topic, fn, err) {
        const q = F.ref(rt, base + '/ev');
        const hand = s => {
          const v = s.val();
          if (!v || v.topic !== topic) return;
          if (v.t && Date.now() + offset - v.t > 15000) return; // 오래된 신호는 버린다
          fn({ topic, data: v.data, peer: v.peer, by: v.by || null, isMe: !!v.by && v.by === uid(), sameTab: v.peer === peerId, kind: 'viewer', guest: false });
        };
        const a = F.onChildAdded(q, hand, e => err && err(mapErr(e))), b = F.onChildChanged(q, hand, e => err && err(mapErr(e)));
        return () => { a(); b(); };
      },
      connected: () => conn,
      onConnection(fn) { connSubs.add(fn); setTimeout(() => fn(conn), 0); return () => connSubs.delete(fn); },
      join: async () => room,
      leave: async () => {},
    };
  }

  // ---------- downloads ----------
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename || 'download'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return { status: 'saved' };
    },
  };

  window.claude = {
    use: async name => {
      if (FBX.state.phase !== 'member') return null;
      if (name === 'db') return db;
      if (name === 'user') return user;
      if (name === 'room') return room || (room = makeRoom());
      if (name === 'downloads') return downloads;
      return null; // assets(사진 · 영상 올리기)는 아직 쓰지 않는다
    },
  };

  // ---------- 로그인 · 역할 ----------
  let roleUnsub = null, ownerUnsub = null;
  function watchMember(u) {
    if (roleUnsub) { roleUnsub(); roleUnsub = null; }
    if (ownerUnsub) { ownerUnsub(); ownerUnsub = null; }
    if (!u) { setState({ phase: 'signedOut', user: null, role: null, name: '' }); return; }
    // 로그인 화면에 있던 중이면(코드 입력 등) 화면을 지우지 않고 사용자만 바꾼다
    setState(FBX.state.phase === 'signedOut' || FBX.state.phase === 'noRole' ? { user: u } : { phase: 'loading', user: u });
    let owner = undefined, roleDoc = undefined;
    const decide = () => {
      if (owner === undefined || roleDoc === undefined) return;
      const role = owner && owner === u.uid ? 'owner' : roleDoc ? roleDoc.role : null;
      const name = (roleDoc && roleDoc.name) || u.displayName || (FBX.state.name || '');
      setState({ phase: role ? 'member' : 'noRole', role, name, ownerUid: owner || null });
      if (role) F.setDoc(F.doc(fs, 'users/' + u.uid), { name, photo: u.photoURL || '', role, seen: Date.now() }, { merge: true }).catch(() => {});
    };
    ownerUnsub = F.onSnapshot(F.doc(fs, 'meta/owner'), s => { owner = s.exists() ? s.data().uid : null; decide(); }, () => { owner = null; decide(); });
    roleUnsub = F.onSnapshot(F.doc(fs, 'roles/' + u.uid), s => { roleDoc = s.exists() ? s.data() : null; decide(); }, () => { roleDoc = null; decide(); });
  }
  F.onAuthStateChanged(auth, u => watchMember(u));

  const friendly = e => {
    const c = (e && e.code) || '';
    if (c === 'permission-denied') return '코드가 맞지 않거나 권한이 없습니다.';
    if (c.includes('popup-blocked')) return '팝업이 막혔습니다. 브라우저에서 팝업을 허용하고 다시 눌러 주세요.';
    if (c.includes('popup-closed') || c.includes('cancelled-popup')) return '로그인 창이 닫혔습니다.';
    if (c.includes('unauthorized-domain')) return '이 주소가 Firebase 승인된 도메인에 없습니다. Authentication › 설정 › 승인된 도메인에 추가해 주세요.';
    if (c.includes('operation-not-allowed')) return 'Firebase Authentication에서 이 로그인 방법을 사용 설정해 주세요.';
    if (c.includes('network')) return '인터넷 연결을 확인해 주세요.';
    return (e && e.message) || '문제가 생겼습니다.';
  };
  FBX.friendly = friendly;
  FBX.signInGoogle = async () => { const p = new F.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); await F.signInWithPopup(auth, p); };
  // 체육회 지점 요원 · TV 화면: 익명 로그인 + 관리자가 정한 코드
  FBX.joinWithCode = async (role, code, name) => {
    let u = auth.currentUser;
    if (!u) u = (await F.signInAnonymously(auth)).user;
    await F.setDoc(F.doc(fs, 'roles/' + u.uid), { role, code: String(code || '').trim(), name: String(name || '').trim().slice(0, 30), at: Date.now() });
  };
  FBX.claimOwner = async () => { const u = auth.currentUser; await F.setDoc(F.doc(fs, 'meta/owner'), { uid: u.uid, at: Date.now() }); };
  FBX.requestEditor = async name => { const u = auth.currentUser; await F.setDoc(F.doc(fs, 'joinRequests/' + u.uid), { name: String(name || u.displayName || '').slice(0, 30), email: u.email || '', at: Date.now() }); };
  FBX.signOut = () => F.signOut(auth);
  // 관리자(주인) 화면용
  FBX.watch = (path, cb) => (path.split('/').length % 2 === 0
    ? F.onSnapshot(F.doc(fs, path), s => cb(s.exists() ? s.data() : null), () => cb(null))
    : F.onSnapshot(F.collection(fs, path), qs => cb(qs.docs.map(d => ({ id: d.id, ...d.data() }))), () => cb([])));
  FBX.put = (path, data, merge) => F.setDoc(F.doc(fs, path), clean(data), merge ? { merge: true } : undefined);
  FBX.del = path => F.deleteDoc(F.doc(fs, path));
})();
