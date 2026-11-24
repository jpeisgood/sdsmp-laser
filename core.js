/* SDSMP core: shared store over the artifact db, write queue, and league math. */
(function () {
'use strict';
const { useState, useEffect } = preactHooks;

// ---------- utils ----------
const pad = n => String(n).padStart(2, '0');
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return todayStr(d); };
const fmtDate = s => { if (!s) return '일정 미정'; const d = parseD(s); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`; };
const fmtDateLong = s => { if (!s) return '일정 미정'; const d = parseD(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일`; };
const fmtClock = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clsSort = (a, b) => { const [ag, ac] = String(a).split('-').map(Number); const [bg, bc] = String(b).split('-').map(Number); return (ag - bg) || (ac - bc) || String(a).localeCompare(String(b)); };
// TOP 10 동점 정렬: 고학년(3학년)부터, 같은 학년은 반 번호 순
const clsSortTop = (a, b) => { const [ag, ac] = String(a).split('-').map(Number); const [bg, bc] = String(b).split('-').map(Number); return ((bg || 0) - (ag || 0)) || ((ac || 0) - (bc || 0)) || String(a).localeCompare(String(b)); };
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function deepMerge(base, patch) {
  const out = isObj(base) ? { ...base } : {};
  for (const k in patch) { const v = patch[k]; out[k] = isObj(v) ? deepMerge(isObj(out[k]) ? out[k] : {}, v) : v; }
  return out;
}
const ls = {
  get(k, d) { try { const v = localStorage.getItem('sdsmp.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('sdsmp.' + k, JSON.stringify(v)); } catch (e) { /* private window */ } },
};

// Sports the selector offers before they have their own data (built later). Picking one shows a 'coming soon' page.
const SOON = [{ id: '__laserrun', name: '레이저런' }];
const DIVS = ['M', 'W'];
const DIV_LABEL = { M: '남자부', W: '여자부' };
const DIV_LEAGUE = { M: '남학생 리그', W: '여학생 리그' }; // used on the TOP 10 boards
const STATUS_LABEL = { scheduled: '예정', live: '진행중', final: '종료' };
const DEFAULT_RULES = { win: 3, draw: 1, loss: 0, yFp: -1, rFp: -2, yBan: 1, rBan: 2, mvpG: 3, mvpA: 2, halfG: 7, halfK: 10, bothTie: true };
// Songs shipped with the page (files under music/). A new song = its file in music/ plus one line here.
const MUSIC = [
  { id: 'counting-stars', title: 'Counting Stars', artist: 'OneRepublic', file: 'music/counting-stars.mp3', dur: 257 },
  { id: 'last-of-the-real-ones', title: 'The Last Of The Real Ones', artist: 'Fall Out Boy', file: 'music/last-of-the-real-ones.mp3', dur: 231 },
  { id: 'ucl-anthem', title: 'UEFA Champions League Anthem (Full Ver.)', artist: 'UEFA & Tony Britten', file: 'music/ucl-anthem.mp3', dur: 180 },
  { id: 'fire', title: 'Fire', artist: 'Kasabian', file: 'music/fire.mp3', dur: 252 },
  { id: 'macarena', title: 'Macarena (Bayside Boys Mix)', artist: 'Los Del Rio', file: 'music/macarena.mp3', dur: 252 },
  { id: 'stronger', title: "Stronger (What Doesn't Kill You)", artist: 'Kelly Clarkson', file: 'music/stronger.mp3', dur: 222 },
  { id: 'lose-my-mind', title: 'Lose My Mind (feat. Doja Cat)', artist: 'Don Toliver', file: 'music/lose-my-mind.mp3', dur: 209 },
  { id: 'name-of-the-game', title: 'The Name Of The Game (Ole Ole)', artist: 'The Fans', file: 'music/name-of-the-game.mp3', dur: 343 },
  { id: 'glory-glory', title: 'Glory, Glory, Man. United', artist: 'Manchester United Football Team', file: 'music/glory-glory-man-united.mp3', dur: 175 },
  { id: 'blinding-lights', title: 'Blinding Lights', artist: 'The Weeknd', file: 'music/blinding-lights.mp3', dur: 202 },
];
// 둘러보기 복사본(다른 학교에 보여 주는 소개용 페이지): viewer.js가 window.__SDV(페이지 안 메모리 저장소)를 만들어 두면
// claude.ai 대신 그것을 쓴다. 바꾼 내용은 저장되지 않는다. 음악 파일은 복사본에 넣지 않으므로 곡 목록도 비운다.
const VIEWER = !!window.__SDV;
// 레이저런 단독 사이트(GitHub Pages + Firebase)는 풋살 데이터를 읽지 않고, 음악 파일도 싣지 않는다.
const LASER_ONLY = !!window.SD_LASER_ONLY;
if (VIEWER || LASER_ONLY) MUSIC.length = 0;
const viewerAt = () => (window.__SDV && window.__SDV.at) || 0;
const trackOf = id => MUSIC.find(t => t.id === id) || null;
// The playlist every TV plays, in order, looping: config/tv.music.order filtered to songs that exist.
const playlistOf = cfg => { const o = (cfg && cfg.music && Array.isArray(cfg.music.order)) ? cfg.music.order : MUSIC.map(t => t.id); return o.map(trackOf).filter(Boolean); };
// TV slide kinds in their original order. 'notice' is not listed: it is always the last scene.
// koM/koW replaced the single 'bracket' switch; a saved 'bracket' value still counts for both until they are set.
const TV_KEYS = ['yesterday', 'today', 'tomorrow', 'standM', 'standW', 'scorers', 'assists', 'mvp', 'chem', 'best', 'koM', 'koW', 'susp'];
function tvOrder(cfg) {
  const saved = (cfg && Array.isArray(cfg.order) ? cfg.order : []).filter((k, i, a) => TV_KEYS.includes(k) && a.indexOf(k) === i);
  const out = saved.slice();
  TV_KEYS.forEach((k, i) => {
    if (out.includes(k)) return;
    // a kind added later goes right after the nearest kind that comes before it in the original order
    let at = 0;
    for (let j = i - 1; j >= 0; j--) { const p = out.indexOf(TV_KEYS[j]); if (p >= 0) { at = p + 1; break; } }
    out.splice(at, 0, k);
  });
  return out;
}
const tvSlideOn = (cfg, k) => { const s = (cfg && cfg.slides) || {}; return (k === 'koM' || k === 'koW') && s[k] == null ? s.bracket !== false : !!s[k]; };
const tvSlideSec = (cfg, k) => { const s = (cfg && cfg.slideSec) || {}; return (k === 'koM' || k === 'koW') && s[k] == null ? s.bracket : s[k]; };
const DEFAULT_TV = { interval: 12, noticeSec: 10, noticeBar: true, notice: '', sport: '',
  music: { on: true, order: MUSIC.map(t => t.id), vol: 0.7 },
  slides: { yesterday: true, today: true, tomorrow: true, standM: true, standW: true, scorers: true, assists: true, mvp: true, chem: true, best: true, bracket: true, susp: false, notice: true },
  // order: the slide order chosen in TV 송출 › 슬라이드 구성 (see tvOrder). The notice scene always comes last.
  move: { on: true, base: 'day' },
  // TV background: colour ('' = the original night blue), floating balls, shooting stars (amount · speed)
  bg: { color: '', balls: true, meteors: true, amt: 'mid', speed: 'mix' },
  // notice band + last notice scene lettering: font key ('' = 블랙한산스), size (×), colour ('' = white)
  noticeStyle: { font: '', size: 1, color: '' } };
// A TV colour theme from one picked colour. Its hue and saturation drive the background and the card chrome;
// the TV keeps its own dark lightness, so text stays readable whatever colour is picked.
function hslToRgb(h, s, l) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255));
}
function tvTint(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  // saturation is capped so the darkest tones keep some depth; grey and black stay neutral (stars included)
  const sat = Math.min(0.9, s), star = hslToRgb(h, sat ? Math.min(1, sat + 0.1) : 0, 0.88).join(',');
  return { h: Math.round(h), s: Math.round(sat * 100), star, style: `--tv-h:${Math.round(h)};--tv-s:${Math.round(sat * 100)}%;--star:${star}` };
}
// ---------- notice lettering: free Korean web fonts from Google Fonts, loaded only when picked ----------
// q = Google Fonts family query, w = weight used, k = size factor so every face looks about as big as 블랙한산스
// at the same setting (measured: glyph height × width of a Hangul line against 블랙한산스). '' and plex ship with the page already.
const NOTICE_FONTS = [
  { key: '', name: '블랙한산스', en: 'Black Han Sans', g: 'gothic', w: 400, k: 1 },
  { key: 'dohyeon', name: '도현', en: 'Do Hyeon', g: 'gothic', q: 'Do+Hyeon', w: 400, k: 1 },
  { key: 'jua', name: '주아', en: 'Jua', g: 'gothic', q: 'Jua', w: 400, k: 0.95 },
  { key: 'sunflower', name: '해바라기', en: 'Sunflower', g: 'gothic', q: 'Sunflower:wght@700', w: 700, k: 0.85 },
  { key: 'nanumgothic', name: '나눔고딕', en: 'Nanum Gothic', g: 'gothic', q: 'Nanum+Gothic:wght@800', w: 800, k: 0.85 },
  { key: 'noto', name: '본고딕', en: 'Noto Sans KR', g: 'gothic', q: 'Noto+Sans+KR:wght@800', w: 800, k: 0.85 },
  { key: 'gowundodum', name: '고운돋움', en: 'Gowun Dodum', g: 'gothic', q: 'Gowun+Dodum', w: 400, k: 0.85 },
  { key: 'bagel', name: '베이글', en: 'Bagel Fat One', g: 'gothic', q: 'Bagel+Fat+One', w: 400, k: 0.9 },
  { key: 'gasoek', name: '가석', en: 'Gasoek One', g: 'gothic', q: 'Gasoek+One', w: 400, k: 0.9 },
  { key: 'myeongjo', name: '나눔명조', en: 'Nanum Myeongjo', g: 'serif', q: 'Nanum+Myeongjo:wght@800', w: 800, k: 0.85 },
  { key: 'songmyung', name: '송명', en: 'Song Myung', g: 'serif', q: 'Song+Myung', w: 400, k: 0.9 },
  { key: 'gowunbatang', name: '고운바탕', en: 'Gowun Batang', g: 'serif', q: 'Gowun+Batang:wght@700', w: 700, k: 0.85 },
  { key: 'pen', name: '나눔펜', en: 'Nanum Pen Script', g: 'hand', q: 'Nanum+Pen+Script', w: 400, k: 1.1 },
  { key: 'brush', name: '나눔붓', en: 'Nanum Brush Script', g: 'hand', q: 'Nanum+Brush+Script', w: 400, k: 1.1 },
  { key: 'dokdo', name: '독도', en: 'Dokdo', g: 'hand', q: 'Dokdo', w: 400, k: 1.1 },
  { key: 'gaegu', name: '개구', en: 'Gaegu', g: 'hand', q: 'Gaegu:wght@700', w: 700, k: 0.9 },
  { key: 'yeonsung', name: '연성', en: 'Yeon Sung', g: 'hand', q: 'Yeon+Sung', w: 400, k: 1 },
  { key: 'himelody', name: '하이멜로디', en: 'Hi Melody', g: 'hand', q: 'Hi+Melody', w: 400, k: 0.95 },
  { key: 'dongle', name: '동글', en: 'Dongle', g: 'hand', q: 'Dongle:wght@700', w: 700, k: 1.25 },
  { key: 'cute', name: '귀여운', en: 'Cute Font', g: 'hand', q: 'Cute+Font', w: 400, k: 1.1 },
];
const FONT_GROUPS = [['gothic', '고딕 · 굵은 글씨'], ['serif', '명조'], ['hand', '손글씨 · 개성']];
const fontOf = key => NOTICE_FONTS.find(f => f.key === (key || '')) || NOTICE_FONTS[0];
const fontStack = f => `'${f.en}', 'Black Han Sans', 'IBM Plex Sans KR', 'Malgun Gothic', sans-serif`;
const fontsAsked = new Set();
// One stylesheet per batch; Google serves Korean in small unicode slices, so a page only downloads the
// glyphs it actually shows.
function loadFonts(keys) {
  const need = keys.map(fontOf).filter(f => f.q && !fontsAsked.has(f.key));
  if (!need.length || typeof document === 'undefined') return;
  need.forEach(f => fontsAsked.add(f.key));
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?' + need.map(f => 'family=' + f.q).join('&') + '&display=swap';
  l.onload = () => window.dispatchEvent(new Event('sd-fonts')); // text that measures itself re-measures
  document.head.appendChild(l);
}
const NOTICE_SIZE = [0.7, 1.5];
const noticeSize = v => Math.min(NOTICE_SIZE[1], Math.max(NOTICE_SIZE[0], Number(v) || 1));
const hexOk = v => /^#[0-9a-f]{6}$/i.test(String(v || ''));
// CSS custom properties read by the notice band and the last notice scene (TV and the settings preview).
function noticeVars(ns) {
  const f = fontOf(ns && ns.font), k = noticeSize(ns && ns.size) * (f.k || 1);
  return `--nb-font:${fontStack(f)};--nb-w:${f.w};--nb-k:${Math.round(k * 1000) / 1000}` + (ns && hexOk(ns.color) ? `;--nb-color:${ns.color}` : '');
}
const DEFAULT_VENUES = ['A구장', 'B구장'];
// Who can be picked in the recorder. Editable per sport in 설정 (sport.staff).
const DEFAULT_STAFF = { refs: ['박충만T', '백귀성T', '박정출T', '김창범T', '정승현T', '이희권T'], recs: ['표현서', '송인서', '임승연', '박지연', '박슬빈'] };
// "2-11" → "2학년 11반"
const classLabel = cls => { const m = String(cls || '').match(/^(\d+)-(\d+)$/); return m ? `${m[1]}학년 ${m[2]}반` : (cls || '미정'); };
// "구장 A", "A 구장", "a구장" all mean the same pitch: show them as "A구장".
const venueName = v => {
  const s = String(v || '').trim();
  const m = s.match(/^(?:구장\s*([A-Za-z0-9]+)|([A-Za-z0-9]+)\s*구장)$/);
  return m ? (m[1] || m[2]).toUpperCase() + '구장' : s;
};
// Class logos shipped with the page (logos/<class>.webp). Add a class here when its logo file is added.
const LOGOS = new Set([1, 2, 3].flatMap(g => Array.from({ length: 12 }, (_, i) => `${g}-${i + 1}`)));
const logoUrl = cls => (LOGOS.has(cls) ? `logos/${cls}.webp` : null);

// ---------- store ----------
const S = {
  db: null, user: null, room: null,
  status: 'connecting',            // connecting | ok | nodb
  canWrite: null,                  // null = platform said nothing; let a refused write decide
  me: { id: null, name: '', avatar: '', color: '' },
  nick: ls.get('nick', ''),
  sports: {}, matches: {}, players: {}, bans: {}, brackets: {}, tv: null, best: null, log: [],
  loaded: { sports: false, matches: false, players: false, bans: false, brackets: false, tv: false },
  peers: [], profiles: {}, presence: {},
  sportId: ls.get('sport', ''),
  toasts: [], saving: 0, lastSaved: 0,
  myId: null, isOwner: false,
  vault: { ready: false, has: false, open: false, limit: 80 }, // activity-log lock (owner only)
  ver: 0,
};
const subs = new Set();
let tick = 0;
function bump() {
  S.ver++;
  if (!tick) tick = setTimeout(() => { tick = 0; subs.forEach(f => f(S.ver)); }, 16);
}
function useStore() {
  const [, set] = useState(0);
  // Subscribe, then catch up once: data that landed before this first effect ran must not be missed.
  useEffect(() => { const f = v => set(v); subs.add(f); set(S.ver); return () => subs.delete(f); }, []);
  return S;
}
function toast(msg, kind = '') {
  const life = kind === 'err' ? 6500 : kind === 'warn' ? 4200 : 2800;
  const t = { id: uid('t'), msg, kind, life };
  S.toasts = [...S.toasts, t]; bump();
  setTimeout(() => dropToast(t.id), life);
}
function dropToast(id) { if (!S.toasts.some(x => x.id === id)) return; S.toasts = S.toasts.filter(x => x.id !== id); bump(); }

// ---------- writes ----------
const COLS = ['sports', 'matches', 'players', 'bans', 'brackets'];
const overlay = {};   // path -> patch not yet confirmed by the server
const Q = {};         // path -> { patch, timer, busy }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function withRetry(fn) {
  try { return await fn(); }
  catch (e) { if (e && e.code === 'unavailable') { await sleep(400 + Math.random() * 700); return fn(); } throw e; }
}
function guardWrite() {
  if (!S.db) { toast('데이터베이스에 연결되지 않아 저장할 수 없습니다.', 'err'); return false; }
  if (S.canWrite === false) { toast('보기 전용 계정입니다. 편집자 권한을 받은 계정으로 열어주세요.', 'err'); return false; }
  return true;
}
function onWriteError(e) {
  const code = e && e.code;
  console.warn('write failed', e);
  if (code === 'invalid_argument' && S.canWrite !== true) {
    S.canWrite = false;
    toast('이 계정은 보기 전용입니다. 기록하려면 편집자 권한이 필요합니다.', 'err');
  } else if (code === 'quota_exceeded') toast('저장 공간이 가득 찼습니다. 설정에서 오래된 활동 기록을 정리하세요.', 'err');
  else if (code === 'revoked') toast('접근 권한이 변경되어 저장할 수 없습니다.', 'err');
  else toast('저장하지 못했습니다. 연결 상태를 확인하고 다시 시도하세요.', 'err');
  bump();
}
const stamp = d => ({ ...d, updatedAt: Date.now(), updatedBy: S.me.id || null });
function applyLocal(path, patch, replace) {
  const [col, id] = path.split('/');
  if (path === 'config/tv') { S.tv = replace ? { ...patch } : deepMerge(S.tv || {}, patch); bump(); return; }
  if (path === 'config/best') { S.best = replace ? { ...patch } : deepMerge(S.best || {}, patch); bump(); return; }
  if (!COLS.includes(col)) return;
  S[col] = { ...S[col], [id]: replace ? { ...patch, id } : deepMerge(S[col][id] || { id }, patch) };
  bump();
}
// Coalesced merge-write: many quick clicks become one update per pause, one in flight per doc.
function patchDoc(path, patch, delay = 280) {
  if (!guardWrite()) return false;
  applyLocal(path, patch);
  overlay[path] = deepMerge(overlay[path] || {}, patch);
  const q = Q[path] || (Q[path] = { patch: null, timer: 0, busy: false });
  q.patch = deepMerge(q.patch || {}, patch);
  clearTimeout(q.timer);
  q.timer = setTimeout(() => flush(path), delay);
  countSaving(); bump();
  return true;
}
const countSaving = () => { S.saving = Object.values(Q).filter(q => q.patch || q.busy).length; };
async function flush(path) {
  const q = Q[path];
  if (!q || q.busy || !q.patch) return;
  const patch = q.patch; q.patch = null; q.busy = true;
  try { await withRetry(() => S.db.doc(path).update(stamp(patch))); S.lastSaved = Date.now(); }
  catch (e) { onWriteError(e); }
  finally {
    q.busy = false;
    if (q.patch) flush(path); else delete overlay[path];
    countSaving(); bump();
  }
}
function flushAll() { Object.keys(Q).forEach(p => { clearTimeout(Q[p].timer); flush(p); }); }
async function setDoc(path, data) {
  if (!guardWrite()) return false;
  if (Q[path]) { clearTimeout(Q[path].timer); Q[path].patch = null; } // a queued merge must not re-add what this replaces
  delete overlay[path];
  applyLocal(path, data, true);
  try { await withRetry(() => S.db.doc(path).set(stamp(data))); S.lastSaved = Date.now(); return true; }
  catch (e) { onWriteError(e); return false; }
}
async function delDoc(path) {
  if (!guardWrite()) return false;
  const [col, id] = path.split('/');
  if (COLS.includes(col)) { const next = { ...S[col] }; delete next[id]; S[col] = next; bump(); }
  try { await withRetry(() => S.db.doc(path).delete()); return true; }
  catch (e) { onWriteError(e); return false; }
}
// Activity log. Each editor writes only under actlog/<their id>/e/…; storage rules let nobody but the artifact owner
// read it back (older entries in log/ are owner-only too). The owner sees it in 설정 after entering the password.
let logParent = false;
// `sport` tags the line for the per-sport views in 설정 › 활동 기록 (레이저런 passes '__laserrun').
function logAct(text, sport) {
  if (!S.db || S.canWrite === false || !S.myId) return;
  const base = 'actlog/' + S.myId;
  if (!logParent) { logParent = true; S.db.doc(base).set({ uid: S.myId, by: S.nick || '', at: Date.now() }).catch(() => { logParent = false; }); }
  S.db.doc(base + '/e/' + uid('l')).set({ ts: Date.now(), uid: S.myId, by: S.nick || '', sport: sport || S.sportId || '', text }).catch(() => {});
}
const LR_SPORT = '__laserrun';
const logOfLaser = l => l.sport === LR_SPORT;
// ---------- activity-log vault (owner only) ----------
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function pwHash(salt, pw) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + pw))); }
let vaultDoc = null, logSubs = [];
const vaultFlag = { get() { try { return sessionStorage.getItem('sdsmp.vault') === '1'; } catch (e) { return false; } },
  set(v) { try { v ? sessionStorage.setItem('sdsmp.vault', '1') : sessionStorage.removeItem('sdsmp.vault'); } catch (e) { /* private window */ } } };
async function vaultInit() {
  if (!S.isOwner || !S.db) return;
  try { const d = await S.db.doc('admin/lock').get(); vaultDoc = d.exists ? d.data() : null; } catch (e) { vaultDoc = null; }
  S.vault = { ...S.vault, ready: true, has: !!(vaultDoc && vaultDoc.hash) };
  if (S.vault.has && vaultFlag.get()) openLog(); else bump();
}
async function vaultSet(pw, current) {
  if (!S.isOwner) return false;
  if (S.vault.has && !(await vaultCheck(current))) { toast('현재 비밀번호가 맞지 않습니다.', 'err'); return false; }
  const salt = uid('s');
  const doc = { salt, hash: await pwHash(salt, pw), at: Date.now() };
  try { await S.db.doc('admin/lock').set(doc); } catch (e) { onWriteError(e); return false; }
  vaultDoc = doc; S.vault = { ...S.vault, has: true }; openLog(); return true;
}
async function vaultCheck(pw) { return !!(vaultDoc && vaultDoc.hash && (await pwHash(vaultDoc.salt, pw)) === vaultDoc.hash); }
async function vaultOpen(pw) { if (!(await vaultCheck(pw))) return false; openLog(); return true; }
function vaultLock() { vaultFlag.set(false); logSubs.forEach(f => f()); logSubs = []; S.log = []; S.vault = { ...S.vault, open: false, limit: 80 }; bump(); }
function vaultMore() { S.vault = { ...S.vault, limit: S.vault.limit + 120 }; openLog(); }
// Live view of everything: the old log/ collection plus every editor's actlog/<id>/e, merged newest first.
function openLog() {
  vaultFlag.set(true);
  logSubs.forEach(f => f()); logSubs = [];
  S.vault = { ...S.vault, open: true };
  const n = S.vault.limit, parts = {}, inner = {};
  const merge = () => { S.log = Object.values(parts).flat().sort((a, b) => (b.ts || 0) - (a.ts || 0)); bump(); resolveProfiles(); };
  const watch = (key, q) => q.onSnapshot(snap => { parts[key] = snap.docs.map(d => ({ id: key + '/' + d.id, ...d.data() })); merge(); }, () => {});
  logSubs.push(watch('log', S.db.collection('log').orderBy('ts', 'desc').limit(n)));
  logSubs.push(S.db.collection('actlog').onSnapshot(snap => {
    for (const d of snap.docs) if (!inner[d.id]) { inner[d.id] = watch('a:' + d.id, S.db.collection('actlog/' + d.id + '/e').orderBy('ts', 'desc').limit(n)); logSubs.push(inner[d.id]); }
  }, () => {}));
  bump();
}
// Owner-only cleanup of entries older than the cut-off, across both places logs live. `laser` picks whose lines go:
// true = only 레이저런 lines, false = only the others (풋살), undefined = all.
async function pruneLog(beforeTs, laser) {
  let n = 0;
  const keep = d => laser !== undefined && logOfLaser(d.data() || {}) !== laser;
  const wipe = async col => { const snap = await S.db.collection(col).where('ts', '<', beforeTs).limit(300).get(); for (const d of snap.docs) { if (keep(d)) continue; await S.db.doc(col + '/' + d.id).delete(); n++; } };
  await wipe('log');
  const people = await S.db.collection('actlog').get();
  for (const p of people.docs) await wipe('actlog/' + p.id + '/e');
  return n;
}

// ---------- boot & live subscriptions ----------
function subscribe(name, build, onSnap) {
  let unsub = null, tries = 0;
  const start = () => {
    unsub = build().onSnapshot(snap => { tries = 0; onSnap(snap); }, e => {
      console.warn('subscription', name, e && e.code);
      if (e && e.code === 'unavailable' && tries++ < 5) setTimeout(start, 2000 * tries);
      else if (e && (e.code === 'revoked' || e.code === 'not_granted')) { S.status = 'nodb'; bump(); }
    });
  };
  start();
  return () => unsub && unsub();
}
function colSnap(col) {
  return snap => {
    const next = {};
    for (const d of snap.docs) {
      const path = col + '/' + d.id;
      let v = { ...d.data(), id: d.id };
      if (overlay[path]) v = deepMerge(v, overlay[path]);
      next[d.id] = v;
    }
    S[col] = next; S.loaded[col] = true; bump();
  };
}
async function boot() {
  const CL = window.__SDV || window.claude; // 둘러보기 복사본이면 페이지 안 메모리 저장소
  if (!CL || typeof CL.use !== 'function') { S.status = 'nodb'; bump(); return; }
  const [db, user] = await Promise.all([CL.use('db').catch(() => null), CL.use('user').catch(() => null)]);
  S.user = user;
  if (user) {
    user.me().then(me => { S.me = { id: me.id, name: me.name || '', avatar: me.avatarUrl, color: me.color }; bump(); setPresence({}); });
    user.can('data.write').then(v => { if (S.canWrite === null && v !== null) { S.canWrite = v; bump(); } });
    user.id().then(id => { S.myId = id || null; }).catch(() => {});
  }
  if (!db) { S.status = 'nodb'; bump(); return; }
  S.db = db; S.status = 'ok'; bump();
  if (LASER_ONLY) COLS.forEach(col => { S.loaded[col] = true; });
  else COLS.forEach(col => subscribe(col, () => db.collection(col), colSnap(col)));
  subscribe('tv', () => db.doc('config/tv'), d => {
    S.tv = d.exists ? deepMerge(d.data(), overlay['config/tv'] || {}) : null; S.loaded.tv = true; bump();
  });
  // best-class award (베스트 학급 팀워크상): judges' checks and cheering counts
  if (!LASER_ONLY) subscribe('best', () => db.doc('config/best'), d => {
    S.best = d.exists ? deepMerge(d.data(), overlay['config/best'] || {}) : null; bump();
  });
  if (user) user.isOwner().then(v => { S.isOwner = !!v; bump(); if (v) vaultInit(); }).catch(() => {});
  CL.use('room').then(room => {
    if (!room) return;
    S.room = room;
    room.onPeers(ch => { S.peers = ch.peers; bump(); resolveProfiles(); }, () => {});
    setPresence({});
  }).catch(() => {});
  window.addEventListener('beforeunload', flushAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAll(); });
}
function setPresence(patch) {
  S.presence = { ...S.presence, ...patch };
  if (!S.room) return;
  const p = { nick: S.nick || null, uid: S.me.id || null, ...S.presence };
  S.room.presence(p).catch(() => {});
}
let profBusy = false;
async function resolveProfiles() {
  if (!S.user || profBusy) return;
  const ids = new Set();
  S.log.forEach(l => l.uid && ids.add(l.uid));
  S.peers.forEach(p => { if (p.by) ids.add(p.by); });
  const want = [...ids].filter(id => !(id in S.profiles));
  if (!want.length) return;
  profBusy = true;
  try { const ps = await S.user.profiles(want); S.profiles = { ...S.profiles, ...ps }; bump(); }
  catch (e) { /* never rejects by contract */ }
  finally { profBusy = false; }
}
const personName = (id, nick) => (id && S.profiles[id] && S.profiles[id].name) || nick || '편집자';

// ---------- league math ----------
const rulesOf = sp => ({ ...DEFAULT_RULES, ...((sp && sp.rules) || {}) });
const divList = sp => DIVS.filter(d => sp && sp.divisions && sp.divisions[d] && Object.keys(sp.divisions[d].groups || {}).length);
function groupsOf(sp, div) {
  const g = (sp && sp.divisions && sp.divisions[div] && sp.divisions[div].groups) || {};
  return Object.keys(g).sort().map(k => ({ key: k, teams: (g[k] || []).filter(Boolean) }));
}
function ringPairs(teams) {
  const n = teams.length;
  if (n < 2) return [];
  if (n === 2) return [[teams[0], teams[1]]];
  return teams.map((t, i) => [t, teams[(i + 1) % n]]);
}
const mKey = m => `${m.date || '9999-12-31'} ${m.time || '99:99'} ${m.stage === 'group' ? 0 : 1} ${String(m.seq || 0).padStart(3, '0')} ${m.id}`;
const fpOf = (st, R) => (st.y ? R.yFp : 0) + (st.r ? R.rFp : 0) + (Number(st.fp) || 0);
const hasResult = m => m.status !== 'scheduled' || (m.scoreH | 0) || (m.scoreA | 0) || Object.keys(m.ps || {}).length > 0;
const tkey = (div, cls) => div + '|' + cls;

// ---------- match clock ----------
// m.clock = { ph: '1H' | 'HT' | '2H' | 'FT', run, t0 (ms when the current run started), acc (ms banked before t0), h1, h2 (ms played per half) }
const PH_LABEL = { '1H': '전반', HT: '하프타임', '2H': '후반', FT: '경기 종료' };
const halfMin = (m, R) => Number(m && m.stage === 'group' ? R.halfG : R.halfK) || (m && m.stage === 'group' ? 7 : 10);
const clockMs = (m, now = Date.now()) => { const c = m && m.clock; if (!c) return 0; return Math.max(0, (Number(c.acc) || 0) + (c.run && c.t0 ? now - c.t0 : 0)); };
const fmtMS = ms => { const s = Math.floor(Math.max(0, ms) / 1000); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
// When a goal is entered: which half and how far into it (null when the clock isn't running a half).
const clockStamp = m => { const c = m && m.clock; return c && (c.ph === '1H' || c.ph === '2H') ? { half: c.ph, sec: Math.floor(clockMs(m) / 1000) } : { half: '', sec: null }; };
const evTime = e => (e && e.half ? `${PH_LABEL[e.half]} ${fmtMS((e.sec || 0) * 1000)}` : '');
const evOrder = (a, b) => ((a.half === '1H' ? 1 : a.half === '2H' ? 2 : 3) - (b.half === '1H' ? 1 : b.half === '2H' ? 2 : 3)) || ((a.sec || 0) - (b.sec || 0)) || ((a.at || 0) - (b.at || 0));

let memo = { ver: -1, sid: null, val: null };
function league(sid) {
  sid = sid || S.sportId;
  if (memo.ver === S.ver && memo.sid === sid) return memo.val;
  const val = computeLeague(sid, null);
  memo = { ver: S.ver, sid, val };
  return val;
}
// The league as it stood over a subset of matches — up to a date (for ▲▼ rank changes) or one week (weekly recap).
// `key` names the subset; results are kept until the data changes.
const snaps = new Map();
let snapVer = -1;
function leagueWhere(sid, key, keep) {
  sid = sid || S.sportId;
  if (snapVer !== S.ver) { snaps.clear(); snapVer = S.ver; }
  const k = sid + '|' + key;
  if (!snaps.has(k)) snaps.set(k, computeLeague(sid, keep));
  return snaps.get(k);
}
// Previous ranks from an earlier snapshot, ready for moveOf(). null when the earlier snapshot has no results yet.
function movesFrom(prev) {
  if (!prev || !prev.matches.some(m => m.status === 'final')) return null;
  const byPlayer = list => new Map(list.map(r => [r.p.id, r.rank]));
  const out = { L: prev, scorers: {}, assists: {}, mvp: {}, chem: {}, stand: {} };
  for (const div of DIVS) {
    out.scorers[div] = byPlayer(prev.scorers[div] || []); out.assists[div] = byPlayer(prev.assists[div] || []); out.mvp[div] = byPlayer(prev.mvp[div] || []);
    out.chem[div] = new Map((prev.chem[div] || []).map(c => [c.x + '|' + c.y, c.rank]));
  }
  for (const div in prev.standings) {
    out.stand[div] = {};
    for (const g in prev.standings[div]) {
      const gs = prev.standings[div][g];
      if (gs.matches.some(m => m.status === 'final')) out.stand[div][g] = new Map(gs.rows.map(r => [r.cls, r.rank]));
    }
  }
  return out;
}
// Rank movement: a number (positive = moved up, 0 = same), 'new' for a newcomer, null when there is nothing to compare.
const moveOf = (map, key, rank) => (!map || rank == null ? null : map.has(key) ? map.get(key) - rank : 'new');
const mondayOf = ds => { const d = new Date(ds + 'T00:00:00'); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// Baseline for ▲▼ on the TV: before the latest match day, or before this week.
function moveBase(sid, base) {
  const L = league(sid);
  const today = todayStr();
  const days = [...new Set(L.matches.filter(m => m.status === 'final' && m.date && m.date <= today).map(m => m.date))].sort();
  if (!days.length) return null;
  // 'day': just before the latest match day. 'week': just before the Monday of the latest week that had matches.
  const last = days[days.length - 1];
  const cut = base === 'week' ? mondayOf(last) : last;
  return movesFrom(leagueWhere(sid, 'lt:' + cut, m => !!m.date && m.date < cut));
}
function computeLeague(sid, keep) {
  const sp = S.sports[sid] || null;
  const R = rulesOf(sp);
  const matches = Object.values(S.matches).filter(m => m.sport === sid && (!keep || keep(m))).sort((a, b) => (mKey(a) < mKey(b) ? -1 : 1));
  const players = Object.values(S.players).filter(p => p.sport === sid);
  const playersByTeam = {};
  players.forEach(p => (playersByTeam[tkey(p.div, p.cls)] ||= []).push(p));
  Object.values(playersByTeam).forEach(l => l.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko')));
  const teamMs = {};
  matches.forEach(m => { [m.home, m.away].forEach(c => c && (teamMs[tkey(m.div, c)] ||= []).push(m)); });

  // player stats (MVP / Ballon d'Or points = goals x mvpG + assists x mvpA)
  const pst = {};
  const cards = [];
  for (const m of matches) {
    for (const pid in (m.ps || {})) {
      const st = m.ps[pid] || {};
      const s = pst[pid] || (pst[pid] = { g: 0, a: 0, y: 0, r: 0, fp: 0, fpGroup: 0, mvp: 0, log: [] });
      const g = Number(st.g) || 0, a = Number(st.a) || 0;
      s.g += g; s.a += a; s.y += st.y ? 1 : 0; s.r += st.r ? 1 : 0;
      const f = fpOf(st, R); s.fp += f; if (m.stage === 'group') s.fpGroup += f;
      s.mvp = s.g * R.mvpG + s.a * R.mvpA;
      if (g || a || st.y || st.r || st.fp) s.log.push({ m, g, a, y: !!st.y, r: !!st.r, fp: f });
      if (st.y || st.r || st.fp) cards.push({ m, pid, st, fp: f });
    }
  }

  // chemistry: scorer + assister pairs from the goal timeline (m.goals)
  const pairs = {};
  for (const m of matches) for (const e of (m.goals || [])) {
    if (!e || !e.pid || !e.ast || e.pid === e.ast) continue;
    const [x, y] = [e.pid, e.ast].sort(), k = x + '|' + y;
    const c = pairs[k] || (pairs[k] = { x, y, n: 0, xy: 0, yx: 0 }); // xy = x scored, y assisted
    c.n++; if (e.pid === x) c.xy++; else c.yx++;
  }
  const chem = {};
  for (const div of DIVS) {
    const l = Object.values(pairs).map(c => ({ ...c, px: S.players[c.x], py: S.players[c.y] }))
      .filter(c => c.px && c.py && c.px.div === div && c.px.sport === sid)
      .sort((a, b) => b.n - a.n || Math.max(b.xy, b.yx) - Math.max(a.xy, a.yx) || clsSortTop(a.px.cls, b.px.cls) || String(a.px.name).localeCompare(String(b.px.name), 'ko'));
    l.forEach((r, i) => { r.rank = i > 0 && l[i - 1].n === r.n ? l[i - 1].rank : i + 1; });
    chem[div] = l;
  }

  // suspensions: each card blocks the team's next N matches in date order
  const suspByMatch = {}, suspByPlayer = {};
  for (const p of players) {
    const list = teamMs[tkey(p.div, p.cls)] || [];
    let rem = 0, cur = null;
    const info = { pid: p.id, entries: [], remaining: 0, src: null };
    for (const m of list) {
      if (rem > 0) {
        cur.served++;
        const e = { pid: p.id, mid: m.id, type: cur.type, nth: cur.served, total: cur.total, from: cur.mid };
        (suspByMatch[m.id] ||= []).push(e); info.entries.push(e); rem--;
      }
      const st = m.ps && m.ps[p.id];
      if (st) {
        const add = st.r ? R.rBan : st.y ? R.yBan : 0;
        if (add > 0) { rem += add; cur = { type: st.r ? 'R' : 'Y', total: add, served: 0, mid: m.id }; }
      }
    }
    info.remaining = rem; info.src = cur;
    const open = info.entries.filter(e => S.matches[e.mid] && S.matches[e.mid].status !== 'final');
    info.active = open.length > 0 || rem > 0;
    info.next = open[0] ? S.matches[open[0].mid] : null;
    if (info.entries.length || rem) suspByPlayer[p.id] = info;
  }

  // permanent bans (all sports)
  const banByKey = {};
  Object.values(S.bans).forEach(b => { if (b.active === false) return; if (b.pid) banByKey['p:' + b.pid] = b; if (b.cls && b.name) banByKey['n:' + b.cls + '|' + String(b.name).trim()] = b; });
  const banOf = p => p && (banByKey['p:' + p.id] || banByKey['n:' + p.cls + '|' + String(p.name).trim()]) || null;

  // standings
  const standings = {};
  // classes that field a team in both the men's and the women's league (tiebreak right after Laser Run)
  const teamsIn = d => new Set(groupsOf(sp, d).flatMap(g => g.teams));
  const inM = teamsIn('M'), inW = teamsIn('W');
  for (const div of divList(sp)) {
    standings[div] = {};
    for (const g of groupsOf(sp, div)) {
      const gms = matches.filter(m => m.stage === 'group' && m.div === div && m.group === g.key);
      const rows = g.teams.map((cls, i) => ({ cls, idx: i + 1, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, fp: 0, live: false, form: [] }));
      const by = Object.fromEntries(rows.map(r => [r.cls, r]));
      for (const m of gms) {
        const h = by[m.home], a = by[m.away];
        if (!h || !a) continue;
        if (m.status === 'live') { h.live = a.live = true; }
        if (m.status !== 'final') continue;
        const hs = m.scoreH | 0, as = m.scoreA | 0;
        h.p++; a.p++; h.gf += hs; h.ga += as; a.gf += as; a.ga += hs;
        if (hs > as) { h.w++; a.l++; h.pts += R.win; a.pts += R.loss; h.form.push('W'); a.form.push('L'); }
        else if (hs < as) { a.w++; h.l++; a.pts += R.win; h.pts += R.loss; h.form.push('L'); a.form.push('W'); }
        else { h.d++; a.d++; h.pts += R.draw; a.pts += R.draw; h.form.push('D'); a.form.push('D'); }
      }
      rows.forEach(r => {
        r.fp = (playersByTeam[tkey(div, r.cls)] || []).reduce((s, p) => s + ((pst[p.id] && pst[p.id].fpGroup) || 0), 0);
        r.laser = isLaser(sp, div, r.cls);
        r.both = inM.has(r.cls) && inW.has(r.cls);
      });
      sortGroup(rows, R);
      standings[div][g.key] = { rows, matches: gms, teams: g.teams };
    }
  }

  // personal rankings: goals, assists, MVP points (ties share a rank)
  const rank = (div, key) => {
    const l = players.filter(p => p.div === div && pst[p.id] && pst[p.id][key] > 0)
      .map(p => ({ p, g: pst[p.id].g, a: pst[p.id].a, mvp: pst[p.id].mvp, v: pst[p.id][key] }))
      .sort((x, y) => y.v - x.v || clsSortTop(x.p.cls, y.p.cls) || String(x.p.name).localeCompare(String(y.p.name), 'ko'));
    l.forEach((r, i) => { r.rank = i > 0 && l[i - 1].v === r.v ? l[i - 1].rank : i + 1; });
    return l;
  };
  const scorers = {}, assists = {}, mvp = {};
  for (const div of DIVS) { scorers[div] = rank(div, 'g'); assists[div] = rank(div, 'a'); mvp[div] = rank(div, 'mvp'); }
  const rankOf = (list, pid) => { const r = list.find(x => x.p.id === pid); return r ? r.rank : null; };

  const groupMs = matches.filter(m => m.stage === 'group');
  const stats = {
    total: groupMs.length, final: groupMs.filter(m => m.status === 'final').length,
    live: matches.filter(m => m.status === 'live').length,
    goals: matches.reduce((s, m) => s + (m.status !== 'scheduled' ? (m.scoreH | 0) + (m.scoreA | 0) : 0), 0),
    yellow: cards.filter(c => c.st.y).length, red: cards.filter(c => c.st.r).length,
    unscheduled: matches.filter(m => !m.date && m.status !== 'final').length,
  };
  stats.groupDone = stats.total > 0 && stats.final === stats.total;
  const groupOf = (div, cls) => (groupsOf(sp, div).find(g => g.teams.includes(cls)) || {}).key || '';
  const venues = [...new Set(((sp && sp.venues && sp.venues.length) ? sp.venues : DEFAULT_VENUES).map(venueName))];
  const stf = (sp && sp.staff) || {};
  const staff = { refs: (stf.refs && stf.refs.length) ? stf.refs : DEFAULT_STAFF.refs, recs: (stf.recs && stf.recs.length) ? stf.recs : DEFAULT_STAFF.recs };
  return { sid, sp, R, matches, players, playersByTeam, teamMs, pst, cards, suspByMatch, suspByPlayer, banOf, standings,
    scorers, assists, mvp, chem, rankOf, stats, groupOf, venues, staff };
}
const isLaser = (sp, div, cls) => !!(sp && sp.laser && sp.laser[div] && sp.laser[div][cls]);
// League rule: points, then classes also playing the Laser Run league, then classes with a team in both the
// men's and the women's league, then fair play, then goal difference and goals scored; anything still level
// falls back to draw order.
// The 남·여 step can be switched off in 설정 › 규정 (rules.bothTie).
const TIEBREAK = ['승점', '레이저런 리그 참가 반', '남·여 리그 모두 참가 반', '페어플레이 점수', '골득실', '다득점'];
const tiebreakOf = R => TIEBREAK.filter(t => t !== TIEBREAK[2] || !R || R.bothTie !== false);
function sortGroup(rows, R) {
  const both = !R || R.bothTie !== false;
  rows.sort((a, b) => (b.pts - a.pts) || (Number(b.laser) - Number(a.laser)) || (both ? Number(b.both) - Number(a.both) : 0) || (b.fp - a.fp)
    || ((b.gf - b.ga) - (a.gf - a.ga)) || (b.gf - a.gf) || a.idx - b.idx);
  rows.forEach((r, k) => { r.rank = k + 1; });
}

// Ring (링크전) fixtures: every team plays its two neighbours in the drawn order.
function newMatch(sid, div, group, seq, home, away, extra) {
  return { sport: sid, div, group, stage: 'group', seq, home, away, date: '', time: '', venue: '', status: 'scheduled',
    scoreH: 0, scoreA: 0, pkH: null, pkA: null, ps: {}, note: '', recorder: '', ...(extra || {}) };
}
function planRing(sid, sp) {
  const want = {};
  for (const div of divList(sp)) for (const g of groupsOf(sp, div)) {
    ringPairs(g.teams).forEach(([h, a], i) => { want[`${sid}-${div}-${g.key}-${i + 1}`] = newMatch(sid, div, g.key, i + 1, h, a); });
  }
  const plan = { create: [], update: [], remove: [], blocked: [], keep: 0 };
  const existing = Object.values(S.matches).filter(m => m.sport === sid && m.stage === 'group');
  for (const e of existing) {
    const w = want[e.id];
    if (w && w.home === e.home && w.away === e.away && w.div === e.div && w.group === e.group) { plan.keep++; delete want[e.id]; continue; }
    if (hasResult(e)) { plan.blocked.push(e); if (w) delete want[e.id]; continue; }
    if (w) { plan.update.push({ id: e.id, patch: { home: w.home, away: w.away, div: w.div, group: w.group, seq: w.seq } }); delete want[e.id]; }
    else plan.remove.push(e.id);
  }
  for (const id in want) plan.create.push({ id, doc: want[id] });
  return plan;
}

// ---------- knockout tournament ----------
const ROUND_NAME = n => (n <= 2 ? '결승' : `${n}강`);
const nextPow2 = n => { let s = 2; while (s < n) s *= 2; return s; };
function spreadOrder(n) { // bracket order of first-round pairs, so byes land in different quarters
  let order = [0];
  while (order.length < n) { const m = order.length * 2; order = order.flatMap(x => [x, m - 1 - x]); }
  return order;
}
// Byes take the second slot of spread-out first-round pairs, so two byes never meet.
function byeSlots(size, n) {
  return new Set(spreadOrder(size / 2).slice(0, Math.max(0, size - n)).map(p => p * 2 + 1));
}
function qualifiers(L, div) {
  const adv = Number(L.sp && L.sp.divisions && L.sp.divisions[div] && L.sp.divisions[div].advance) || 2;
  const groups = L.standings[div] || {};
  return Object.keys(groups).flatMap(gk => groups[gk].rows.slice(0, adv).map(r => ({ cls: r.cls, group: gk, rank: r.rank })));
}
const koId = (sid, div, r, i) => `${sid}-${div}-ko-${r}-${i}`;
function planBracket(sid, div, slots) {
  const size = slots.length, R = Math.round(Math.log2(size));
  const byId = {}, order = [];
  for (let r = 1; r <= R; r++) {
    const count = size / 2 ** r;
    for (let i = 0; i < count; i++) {
      const id = koId(sid, div, r, i);
      const next = r < R ? { mid: koId(sid, div, r + 1, i >> 1), side: i % 2 ? 'away' : 'home' } : null;
      byId[id] = newMatch(sid, div, '', i + 1, '', '', { stage: ROUND_NAME(size / 2 ** (r - 1)), ko: true, round: r, next, bracket: `${sid}-${div}`, pk: { H: [], A: [] } });
      order.push(id);
    }
  }
  // First round comes from the drawn slots; a team drawn against a bye goes straight into round 2.
  for (let i = 0; i < size / 2; i++) {
    const h = slots[2 * i] || '', a = slots[2 * i + 1] || '', id = koId(sid, div, 1, i), m = byId[id];
    if (h && a) { m.home = h; m.away = a; continue; }
    if (m.next && (h || a)) byId[m.next.mid][m.next.side] = h || a;
    delete byId[id];
  }
  return { size, rounds: R, docs: order.filter(id => byId[id]).map(id => ({ id, doc: byId[id] })) };
}
function pkScore(m) {
  const k = m.pk || {}, H = k.H || [], A = k.A || [];
  if (H.length || A.length) return [H.filter(x => x && x.ok).length, A.filter(x => x && x.ok).length];
  if (m.pkH != null && m.pkA != null && m.pkH !== '' && m.pkA !== '') return [Number(m.pkH) || 0, Number(m.pkA) || 0];
  return null;
}
function winnerOf(m) {
  if (!m || m.status !== 'final' || !m.home || !m.away) return null;
  const d = (m.scoreH | 0) - (m.scoreA | 0);
  if (d) return d > 0 ? m.home : m.away;
  const pk = pkScore(m);
  return pk && pk[0] !== pk[1] ? (pk[0] > pk[1] ? m.home : m.away) : null;
}
// After a knockout result is confirmed, put the winner into the next round (unless that match already started).
function advanceWinner(m) {
  if (!m || !m.next) return;
  const nm = S.matches[m.next.mid];
  if (!nm) return;
  const want = winnerOf(m) || '';
  if ((nm[m.next.side] || '') === want) return;
  if (hasResult(nm)) { toast(`다음 경기(${nm.stage})가 이미 기록 중이라 진출 팀을 자동으로 바꾸지 않았습니다.`, 'err'); return; }
  patchDoc('matches/' + nm.id, { [m.next.side]: want }, 0);
}

window.SD = {
  S, bump, useStore, toast, dropToast, patchDoc, setDoc, delDoc, flushAll, logAct, boot, vaultSet, vaultOpen, vaultCheck, vaultLock, vaultMore, pruneLog, logOfLaser, LR_SPORT, setPresence, resolveProfiles, personName,
  league, leagueWhere, movesFrom, moveOf, moveBase, mondayOf, rulesOf, divList, groupsOf, ringPairs, planRing, newMatch, hasResult, fpOf, tkey, mKey, clsSort, clsSortTop,
  isLaser, TIEBREAK, tiebreakOf, ROUND_NAME, nextPow2, byeSlots, qualifiers, planBracket, pkScore, winnerOf, advanceWinner, koId,
  DEFAULT_VENUES, DEFAULT_STAFF, classLabel, LOGOS, logoUrl, venueName,
  PH_LABEL, halfMin, clockMs, fmtMS, clockStamp, evTime, evOrder,
  todayStr, addDays, fmtDate, fmtDateLong, fmtClock, uid, ls, deepMerge, tvTint, NOTICE_FONTS, FONT_GROUPS, fontOf, loadFonts, noticeVars, noticeSize, NOTICE_SIZE, hexOk,
  SOON, MUSIC, VIEWER, viewerAt, trackOf, playlistOf, DIVS, DIV_LABEL, DIV_LEAGUE, STATUS_LABEL, DEFAULT_RULES, DEFAULT_TV, TV_KEYS, tvOrder, tvSlideOn, tvSlideSec,
};
})();
