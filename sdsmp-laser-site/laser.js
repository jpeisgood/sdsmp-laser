/* SDSMP 레이저런 모듈.
   - 저장은 lr_ 로 시작하는 경로에만 한다. 풋살 문서(sports, matches, players, bans, brackets, config, signs, log, admin)에는 쓰지 않는다.
     예외: 활동 기록 한 줄씩만 풋살과 같은 actlog/<내 id>에 남긴다(SD.logAct, 계정 주인만 읽음, 설정 › 활동 기록에서 비밀번호로 열람).
   - 풋살 데이터는 읽기만 한다: 학급 로고, 선수 명단, 스태프 이름, TV 음악·공지 스타일.
   - 이 파일을 불러오지 못해도 풋살 화면은 그대로 동작한다(app.js가 window.LASER 유무를 확인한다). */
(function () {
'use strict';
const { Component } = preact;
const { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, useReducer } = preactHooks;
const SUI = window.UI, html = SUI.html;

/* ==========================================================================
   공통 유틸 · 저장소 · 사진 저장 · TV 시계
   ========================================================================== */
const pad2=n=>String(n).padStart(2,'0');
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=t=>t*t*(3-2*t);
const uid=(p='')=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function deepMerge(a,b){
  const o={...(isObj(a)?a:{})};
  for(const k in b) o[k]=isObj(b[k])&&isObj(o[k])?deepMerge(o[k],b[k]):b[k];
  return o;
}
const LS={
  get(k,d){try{const v=localStorage.getItem('lr.'+k);return v==null?d:JSON.parse(v);}catch(e){return d;}},
  set(k,v){try{localStorage.setItem('lr.'+k,JSON.stringify(v));}catch(e){}}
};

/* ---------- 시간 표기: 기록은 1/100초 정수(cs)로 다룬다 ---------- */
function fmtCs(cs){
  if(cs==null||!isFinite(cs)) return '--:--.--';
  const neg=cs<0;cs=Math.abs(Math.round(cs));
  return (neg?'-':'')+pad2(Math.floor(cs/6000))+':'+pad2(Math.floor(cs%6000/100))+'.'+pad2(cs%100);
}
const fmtPen=cs=>'+'+fmtCs(cs||0);
const hund=s=>s==null?0:(s.length===1?+s*10:+s.slice(0,2));
function parseTime(txt){
  const t=String(txt==null?'':txt).trim();
  if(!t) return null;
  let m=t.match(/^(\d{1,3}):(\d{1,2})(?:[.,](\d{1,2}))?$/);
  if(m) return +m[2]>=60?null:(+m[1])*6000+(+m[2])*100+hund(m[3]);
  m=t.match(/^(\d+)[.,](\d{1,2})$/);
  if(m) return (+m[1])*100+hund(m[2]);
  if(/^\d{1,7}$/.test(t)){ // 숫자만 입력: 뒤에서부터 소수 2자리, 초 2자리, 나머지 분
    const v=t.padStart(5,'0'),x=+v.slice(-2),s=+v.slice(-4,-2),mm=+v.slice(0,-4);
    return s>=60?null:mm*6000+s*100+x;
  }
  return null;
}
const ymd=d=>d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());
function fmtDateKo(s,withDay=true){
  if(!s) return '날짜 미정';
  const [y,m,d]=s.split('-').map(Number);
  const w='일월화수목금토'[new Date(y,m-1,d).getDay()];
  return m+'월 '+d+'일'+(withDay?' ('+w+')':'');
}
function fmtClock(ms){
  if(ms==null) return '—';
  const d=new Date(ms);
  return pad2(d.getHours())+':'+pad2(d.getMinutes())+':'+pad2(d.getSeconds());
}
function fmtStamp(ms){
  if(ms==null) return '—';
  const d=new Date(ms);
  return (d.getMonth()+1)+'/'+d.getDate()+' '+pad2(d.getHours())+':'+pad2(d.getMinutes())+':'+pad2(d.getSeconds());
}
function fmtBytes(n){
  if(n==null) return '';
  return n>=1048576?(n/1048576).toFixed(1)+'MB':Math.max(1,Math.round(n/1024))+'KB';
}

/* ---------- 알림은 SDSMP 알림 칸을 함께 쓴다. 확인 창은 브라우저 기본 창을 쓸 수 없어 직접 그린다. ---------- */
function toast(msg,kind='info'){SD.toast(msg,kind==='error'||kind==='err'?'err':kind==='warn'?'warn':'');} // 경고·오류는 화면 가운데에 뜬다
const Confirm={cur:null,fn:null};
function askConfirm(o){
  return new Promise(res=>{Confirm.cur={...o,res};Confirm.fn&&Confirm.fn();});
}

/* ---------- 초시계 텍스트 등 화면 갱신 공용 루프 ---------- */
const Ticker=(()=>{
  const fns=new Set();let on=false;
  function loop(){
    if(!fns.size){on=false;return;}
    fns.forEach(f=>{try{f();}catch(e){console.error(e);}});
    requestAnimationFrame(loop);
  }
  return {add(f){fns.add(f);if(!on){on=true;requestAnimationFrame(loop);}return()=>fns.delete(f);}};
})();

/* ==========================================================================
   Store — 레이저런 문서 저장소 (경로는 항상 lr_<모음>/<문서>)
   - 화면 값 = 서버 스냅샷(raw) + 아직 전송되지 않은 변경(queues)
   - 문서별로 한 번에 하나만 쓰고, 끊기면 재시도한다. 미전송분은 새로고침해도 남는다.
   - 레이저런 화면을 처음 열 때 start()가 불린다. 그 전에는 풋살 쪽에 구독을 하나도 더하지 않는다.
   ========================================================================== */
const Store=(()=>{
  const COLS=['config','classes','matches','runs','audit','media','cp'];
  const dbPath=c=>'lr_'+c;
  const raw={},data={},queues={};
  COLS.forEach(c=>{raw[c]={};data[c]={};});
  const subs=new Set();
  let version=0,scheduled=false,adapter=null;
  const S={mode:'init',ready:false,slow:false,readOnly:false,offline:false,COLS,pendingCount:0};

  const schedule=cb=>{ // 백그라운드 창에서도 멈추지 않도록 타이머를 함께 건다
    let done=false;
    const run=()=>{if(!done){done=true;cb();}};
    requestAnimationFrame(run);setTimeout(run,120);
  };
  function notify(){
    version++;
    if(scheduled) return;
    scheduled=true;
    schedule(()=>{scheduled=false;subs.forEach(f=>f());});
  }
  function recompute(c,id){
    let d=raw[c][id];
    const q=queues[c+'/'+id];
    if(q) for(const it of q.items){
      if(it.op==='del') d=undefined;
      else if(it.op==='set') d=it.data;
      else d=deepMerge(d||{},it.data);
    }
    if(d===undefined) delete data[c][id]; else data[c][id]=d;
  }
  function rebuild(c){
    data[c]={...raw[c]};
    for(const p in queues) if(p.startsWith(c+'/')&&queues[p].items.length) recompute(c,p.slice(c.length+1));
    notify();
  }
  function persistOutbox(){
    const o={};
    for(const p in queues) if(queues[p].items.length) o[p]=queues[p].items.map(i=>({op:i.op,data:i.data}));
    LS.set('outbox',o);
    const off=Object.keys(o).length;
    if(S.pendingCount!==off){S.pendingCount=off;notify();}
  }
  async function pump(path){
    const q=queues[path];
    if(!q||q.busy) return;
    q.busy=true;
    const i=path.indexOf('/'),c=path.slice(0,i),id=path.slice(i+1);
    while(q.items.length){
      const item=q.items[0];
      item.sending=true;
      try{
        await adapter.write(c,id,item.op,item.data);
        q.items.shift();
        q.fails=0;
        if(S.offline){S.offline=false;notify();}
      }catch(e){
        const code=e&&e.code;
        item.sending=false;
        if(code==='invalid_argument'&&item.op==='merge'&&!item.retried){
          // 아직 없는 문서를 병합하려던 경우 → 통째로 저장
          item.op='set';item.data=deepMerge(raw[c][id]||{},item.data);item.retried=true;
          continue;
        }
        if(code==='invalid_argument'||code==='not_granted'||code==='revoked'||code==='capability_disabled'||code==='capability_removed'){
          S.readOnly=true;q.items.length=0;
          toast('이 계정은 레이저런 데이터를 변경할 권한이 없습니다.','error');
          break;
        }
        if(code==='quota_exceeded'){
          q.items.shift();
          toast('저장 공간이 가득 찼습니다. 쓰지 않는 사진이나 예시 데이터를 삭제해 주세요.','error');
          continue;
        }
        q.fails=(q.fails||0)+1;
        if(!S.offline){S.offline=true;notify();}
        await sleep(Math.min(15000,800*Math.pow(2,q.fails-1))+Math.random()*300);
      }
      persistOutbox();
    }
    q.busy=false;
    recompute(c,id);
    persistOutbox();
    notify();
  }
  function enqueue(c,id,op,d){
    const path=c+'/'+id;
    const q=queues[path]||(queues[path]={items:[],busy:false,fails:0});
    const last=q.items[q.items.length-1];
    if(op==='merge'&&last&&!last.sending&&(last.op==='merge'||last.op==='set')) last.data=deepMerge(last.data,d);
    else q.items.push({op,data:d});
    recompute(c,id);
    persistOutbox();
    notify();
    pump(path);
  }
  function guard(){
    if(SD.S.canWrite===false) S.readOnly=true;
    if(S.readOnly){toast('보기 전용 계정입니다. 기록은 편집자로 초대받은 계정에서 입력할 수 있습니다.','warn');return false;}
    if(S.mode==='init'){toast('데이터를 불러온 뒤 다시 시도해 주세요.','warn');return false;}
    return true;
  }
  function cloudAdapter(db){
    const pendingFirst=new Set(COLS);
    const sub=c=>{
      db.collection(dbPath(c)).onSnapshot(snap=>{
        const o={};
        snap.docs.forEach(d=>{o[d.id]=d.data();});
        raw[c]=o;
        if(pendingFirst.delete(c)&&!pendingFirst.size){S.ready=true;S.slow=false;}
        rebuild(c);
      },err=>{
        const code=err&&err.code;
        if(code==='revoked'||code==='not_granted'){S.readOnly=true;notify();return;}
        if(code==='unavailable'||code==='resource_exhausted') setTimeout(()=>sub(c),3000);
        else console.warn('laser db listener',c,err);
      });
    };
    COLS.forEach(sub);
    return {
      write(c,id,op,d){
        const ref=db.doc(dbPath(c)+'/'+id);
        if(op==='del') return ref.delete();
        const body=JSON.parse(JSON.stringify(d)); // undefined 값 제거
        return op==='set'?ref.set(body):ref.update(body);
      }
    };
  }

  S.start=function(db){
    if(S.mode!=='init'||!db) return;
    S.mode='cloud';
    setTimeout(()=>{if(!S.ready){S.slow=true;notify();}},10000);
    adapter=cloudAdapter(db);
    const saved=LS.get('outbox',{});
    for(const p in saved){queues[p]={items:saved[p],busy:false,fails:0};}
    for(const p in saved) pump(p);
    notify();
  };
  Object.defineProperty(S,'version',{get(){return version;}});
  S.col=c=>data[c]||{};
  S.list=c=>Object.values(data[c]||{});
  S.doc=(c,id)=>(data[c]&&data[c][id])||null;
  S.subscribe=fn=>{subs.add(fn);return()=>subs.delete(fn);};
  S.touch=notify;
  S.merge=(c,id,patch)=>{if(!guard())return false;enqueue(c,id,'merge',patch);return true;};
  S.set=(c,id,d)=>{if(!guard())return false;enqueue(c,id,'set',d);return true;};
  S.remove=(c,id)=>{if(!guard())return false;enqueue(c,id,'del',null);return true;};
  // 권한 확인 없이 보내기: 체육회 지점 요원의 「통과」 기록처럼 편집 권한이 없어도 쓸 수 있는 곳(보안 규칙이 판단)
  S.put=(c,id,op,d)=>{if(S.mode==='init'){toast('데이터를 불러온 뒤 다시 시도해 주세요.','warn');return false;}enqueue(c,id,op,d);return true;};
  S.canWrite=()=>SD.S.canWrite!==false&&!S.readOnly&&S.mode!=='init';
  return S;
})();

/** 저장소가 바뀌면 컴포넌트를 다시 그린다. */
function useStore(){
  const [,force]=useReducer(x=>x+1,0);
  const seen=useRef(0);
  seen.current=Store.version;
  useEffect(()=>{
    if(Store.version!==seen.current) force(); // 구독 전에 바뀐 내용을 놓치지 않는다
    return Store.subscribe(force);
  },[]);
  return Store;
}
function useLocal(key,def){
  const [v,setV]=useState(()=>LS.get(key,def));
  const set=useCallback(n=>{setV(n);LS.set(key,n);},[key]);
  return [v,set];
}
function useNow(ms=1000){
  const [n,setN]=useState(()=>Live.now());
  useEffect(()=>{const t=setInterval(()=>setN(Live.now()),ms);return()=>clearInterval(t);},[ms]);
  return n;
}
/** 저장소 버전이 같으면 계산을 재사용한다. */
function memoV(fn){
  let v=-1,r;
  return ()=>{if(Store.version!==v){v=Store.version;r=fn();}return r;};
}

/* ==========================================================================
   MediaStore — 포스터·코스 사진·TV 사진
   사진은 줄여서 lr_blobs 문서(256KiB 이하)에 저장하고, 쓸 때만 한 장씩 읽는다.
   영상 파일은 사이트에 파일 업로드 권한(assets)이 있을 때만 올릴 수 있다.
   ========================================================================== */
const MediaStore={
  assets:null,downloads:null,cache:{},pending:{},
  async init(){
    if(window.claude&&claude.use){
      try{this.assets=await claude.use('assets');}catch(e){}
      try{this.downloads=await claude.use('downloads');}catch(e){}
      Store.touch();
    }
  },
  db(){return SD.S.db;},
  canUpload(){return !!this.db()&&Store.canWrite();},
  canVideo(){return !!this.assets;},
  url(id){
    if(!id) return null;
    if(/^[0-9a-f]{32}$/.test(id)) return '/_blob/'+id;
    if(this.cache[id]!==undefined) return this.cache[id]||null;
    this.load(id);
    return null;
  },
  load(id){
    if(this.pending[id]||!this.db()) return;
    this.pending[id]=true;
    this.db().doc('lr_blobs/'+id).get().then(d=>{
      this.cache[id]=d.exists?((d.data()||{}).url||''):'';
      delete this.pending[id];
      Store.touch();
    },()=>{setTimeout(()=>{delete this.pending[id];},5000);});
  },
  async put(blob,type){
    const t=type||blob.type||'';
    if(t.startsWith('image/')){
      const url=await imageDataUrl(blob);
      const id='img_'+uid();
      await this.db().doc('lr_blobs/'+id).set({url,at:Date.now()});
      this.cache[id]=url;
      Store.touch();
      return {id,sizeBytes:Math.round(url.length*.75),contentType:'image/jpeg'};
    }
    if(!this.assets) throw {code:'video_off'};
    const r=await this.assets.upload(blob,t?{type:t}:undefined);
    return {id:r.id,sizeBytes:r.sizeBytes,contentType:r.contentType};
  },
  async del(id){
    if(!id) return;
    try{
      if(/^[0-9a-f]{32}$/.test(id)){if(this.assets) await this.assets.delete(id);}
      else{await this.db().doc('lr_blobs/'+id).delete();delete this.cache[id];}
    }catch(e){console.warn('media delete',e);}
  },
  async save(filename,text){
    if(this.downloads){
      try{await this.downloads.save({filename,data:text});toast(filename+' 파일을 저장했습니다.','ok');}
      catch(e){if(e&&e.code!=='declined')toast('파일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.','error');}
      return;
    }
    toast('이 화면에서는 파일 저장을 쓸 수 없습니다.','warn');
  }
};
function uploadErrorText(e){
  const code=e&&e.code;
  if(code==='video_off') return '영상 파일은 올릴 수 없습니다. 사진을 올리거나, 영상은 링크·실시간 중계 창으로 연결해 주세요.';
  if(code==='image_read') return '사진을 읽지 못했습니다. PNG·JPG·WEBP 파일을 사용해 주세요.';
  if(code==='too_large') return '파일이 20MB를 넘습니다. 영상은 10초 안팎으로 다시 촬영해 주세요.';
  if(code==='unsupported_type') return '지원하지 않는 파일 형식입니다. 이미지는 PNG·JPG·WEBP, 영상은 MP4·WEBM을 사용해 주세요.';
  if(code==='quota_or_state') return '저장 공간이 부족합니다. 쓰지 않는 사진이나 영상을 삭제해 주세요.';
  if(code==='rate_limited') return '업로드 요청이 많습니다. 잠시 후 다시 시도해 주세요.';
  if(code==='not_granted') return '이 계정은 파일을 올릴 수 없습니다.';
  return '올리지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.';
}
/** 사진을 문서에 담을 수 있는 크기(약 180KB)까지 줄인다. 크기와 화질을 단계적으로 낮춘다. */
async function imageDataUrl(file,maxSide=1600){
  let img,url;
  try{
    url=URL.createObjectURL(file);
    img=new Image();
    await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=url;});
  }catch(e){if(url)URL.revokeObjectURL(url);throw {code:'image_read'};}
  const LIMIT=245000; // base64 글자 수. 문서 한도 256KiB 안쪽
  let out=null;
  for(const side of [maxSide,1280,1024,800,640]){
    const k=Math.min(1,side/Math.max(img.naturalWidth,img.naturalHeight));
    const cv=document.createElement('canvas');
    cv.width=Math.max(1,Math.round(img.naturalWidth*k));cv.height=Math.max(1,Math.round(img.naturalHeight*k));
    const ctx=cv.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,cv.width,cv.height);
    ctx.drawImage(img,0,0,cv.width,cv.height);
    for(const q of [.82,.7,.58]){
      out=cv.toDataURL('image/jpeg',q);
      if(out.length<=LIMIT){URL.revokeObjectURL(url);return out;}
    }
  }
  URL.revokeObjectURL(url);
  throw {code:'too_large'};
}

/* ==========================================================================
   Live — TV 시계 보정. 기록은 누른 기기의 시각으로 저장되므로, TV는 기록 기기의 시계에 맞춰 랩타임을 보여 준다.
   접속 현황 표시는 SDSMP가 이미 보내는 현황(mode:'tv')을 읽기만 한다.
   ========================================================================== */
const Live={
  offset:0,role:'admin',bound:false,_samples:[],_master:null,_beat:null,
  now(){return Date.now()+this.offset;},
  bind(){
    const room=SD.S.room;
    if(!room||this.bound) return;
    this.bound=true;
    room.on('clock',msg=>{
      if(msg.sameTab||this.role==='admin') return;
      const peers=SD.S.peers||[];
      if(this._master&&!peers.some(p=>p.peer===this._master)){this._master=null;this._samples=[];}
      if(!this._master) this._master=msg.peer;
      if(msg.peer!==this._master||!msg.data||typeof msg.data.t!=='number') return;
      // 네트워크 지연만큼 작게 나오므로, 최근 값 중 가장 큰 값이 실제 차이에 가장 가깝다.
      this._samples.push(msg.data.t-Date.now());
      if(this._samples.length>10) this._samples.shift();
      this.offset=Math.max(...this._samples);
    },()=>{});
  },
  setRole(role){
    this.role=role;
    if(role!=='admin') this._samples=[];
    else this.offset=0;
  },
  /** 진행 중인 경기가 있는 동안 기록 기기가 기준 시각을 알린다. */
  startBeat(){
    if(this._beat) return;
    this._beat=setInterval(()=>{
      const room=SD.S.room;
      if(!room||this.role!=='admin'||!Store.canWrite()) return;
      if(!Store.list('matches').some(m=>m.status==='live')) return;
      room.emit('clock',{t:Date.now()}).catch(()=>{});
    },4000);
  },
  count(role){
    const ps=(SD.S.peers||[]).filter(p=>!p.sameTab&&p.presence);
    if(role==='tv') return ps.filter(p=>p.presence.mode==='tv').length;
    if(role==='camera') return ps.filter(p=>p.presence.lrCam).length;
    return 0;
  }
};

/* ==========================================================================
   대회 규칙: 설정값, 릴레이 계측, 최종 기록 계산, 순위, 일정, 예시 데이터
   최종 기록 = 주행 + 사격 + 페널티. 값은 저장된 시각에서 매번 계산하므로
   페널티 설정을 바꾸면 모든 기록과 순위에 바로 반영된다.
   ========================================================================== */
const DEFAULT_SETTINGS={
  eventName:'2026 SEONGDEOK LASER RUN LEAGUE',
  eventKr:'성덕 레이저런 리그',
  requiredHits:5,
  penaltyPerMissCs:1000,
  includePenalty:true,
  rounding:'floor',
  teamCalc:'sum',
  bestOnly:true,
  autoNextStart:true,
  returnRun:true,
  autoFinishMatch:true,
  laneCount:6,
  expectedRun1Sec:210,
  expectedRun2Sec:45,
  recorders:[]
};
const DEFAULT_TV={
  scene:'auto',
  pinnedMatchId:null,
  template:'{팀}, {시간} 경기 예정입니다. 참가 학생들은 지정된 장소로 이동해 주세요.',
  notice:'',
  rotateSec:15,
  resultHoldSec:120,
  mediaMode:'new',
  pinnedMediaId:null,
  relayId:null,
  music:true,
  boards:{class:true,all:true,male:true,female:true,g1:false,g2:false,g3:false}
};
/* 기본 코스: 출발 → 운동장 한 바퀴 → 안쪽 사격장 → 도착 (1000×560 도면 좌표) */
const DEFAULT_COURSE_POINTS=[
  [470,512],[640,512],[790,506],[900,446],[944,318],[905,168],[796,84],[640,60],[500,56],[350,60],[205,84],
  [96,168],[54,300],[96,430],[185,484],[268,456],[318,398],[396,364],[500,356],[604,364],[680,398],[702,452],[650,498],[548,512]
].map(([x,y])=>({x,y}));
const DEFAULT_RANGE_AT=null; // null이면 도면의 사격장 중심(500,356)에 가장 가까운 지점
/* 기본 배경: 학교 항공사진(성덕중, 위가 북쪽). 사진 전체가 보이도록 도면 높이에 맞추고 양옆은 비워 둔다.
   코스가 학교 밖으로 이어져도 빈 곳 위에 경로를 그릴 수 있다. 실제 코스는 영상을 받아 다시 그린다. */
const SCHOOL_BG={href:'media/school-top.webp',w:963,h:657};
SCHOOL_BG.sw=560*SCHOOL_BG.w/SCHOOL_BG.h;SCHOOL_BG.sx=(1000-SCHOOL_BG.sw)/2;
/* 학교 위에서 본 사진(성덕중 건물 · 둘레 길). 기본 코스: 후문 쪽에서 출발해 건물을 한 바퀴 돌고, 아래쪽 길의 사격장을 지나 도착.
   실제 코스는 설정 › 코스에서 점을 끌어 맞춘다. */
const SCHOOL_PLAY={range:{x:371,y:546}};
const SCHOOL_COURSE_POINTS=[{x:171,y:524},{x:190,y:443},{x:190,y:341},{x:190,y:239},{x:199,y:149},{x:277,y:132},{x:396,y:132},{x:516,y:132},{x:635,y:130},{x:712,y:119},{x:797,y:128},{x:878,y:183},{x:831,y:256},{x:763,y:324},{x:756,y:426},{x:754,y:535},{x:635,y:546},{x:499,y:546},{x:371,y:546},{x:260,y:546},{x:183,y:546}];
const presetPoints=preset=>preset==='field'?DEFAULT_COURSE_POINTS:SCHOOL_COURSE_POINTS;

const CFG={
  settings:memoV(()=>({...DEFAULT_SETTINGS,...(Store.doc('config','settings')||{})})),
  tv:memoV(()=>{const d=Store.doc('config','tv')||{};return {...DEFAULT_TV,...d,boards:{...DEFAULT_TV.boards,...(d.boards||{})}};}),
  course:memoV(()=>{
    const c=Store.doc('config','course')||{};
    const preset=c.bgPreset==='field'?'field':'school',onSchool=!c.bgId&&preset==='school';
    return {
      points:Array.isArray(c.points)&&c.points.length>=3?c.points:presetPoints(preset),
      rangeAt:typeof c.rangeAt==='number'?c.rangeAt:DEFAULT_RANGE_AT,
      rangeAngle:typeof c.rangeAngle==='number'?c.rangeAngle:0,
      bgId:c.bgId||null,
      bgPreset:preset,
      bgDim:typeof c.bgDim==='number'?c.bgDim:(onSchool?0.3:0.45),
      // 코스 표시 크기(사격장·로고·선 굵기). 학교 전체 사진 위에서는 작게 그린다.
      markScale:typeof c.markScale==='number'?c.markScale:(onSchool?0.55:1),
      // 사격장(사로 칸) 크기만 따로: 코스 표시 크기에 곱한다
      rangeScale:typeof c.rangeScale==='number'?c.rangeScale:(onSchool?0.65:1),
      custom:!!(c.points&&c.points.length>=3)
    };
  }),
  app:memoV(()=>Store.doc('config','app')||{}),
  // 코스 중간 지점(체육회 요원이 「통과」를 누르는 곳)과 카메라 중계 설정
  cp:memoV(()=>{
    const d=Store.doc('config','cp')||{};
    const count=clamp(+d.count||12,0,24);
    const saved=Array.isArray(d.points)?d.points:[];
    const points=Array.from({length:count},(_,i)=>{
      const n=i+1,o=saved.find(x=>x&&x.n===n)||{};
      return {n,p:typeof o.p==='number'?o.p:null,cam:typeof o.cam==='boolean'?o.cam:n%2===0,uid:o.uid||null,name:o.name||''};
    });
    return {count,points,len:+d.len||350,room:d.room||'',camOn:d.camOn!==false};
  })
};
/** 사격장 위치(코스 비율). 설정에 없으면 도면에서 계산한다. */
const courseRangeAt=memoV(()=>{const c=CFG.course();return c.rangeAt==null?defaultRangeAt(buildCourse(c.points),c.bgPreset):c.rangeAt;});
/** 지점 위치: 저장된 값이 없으면 출발~도착 사이에 고르게, 사격장 바로 옆은 비켜서 둔다. 코스 순서(p)대로. */
const cpList=memoV(()=>{
  const cfg=CFG.cp(),ra=courseRangeAt(),N=cfg.count;
  return cfg.points.map((x,i)=>{
    let p=x.p;
    if(p==null){p=.04+.92*(i+.5)/Math.max(1,N);if(Math.abs(p-ra)<.03)p=ra+(p<ra?-.03:.03);}
    return {...x,p:clamp(p,.005,.995)};
  }).sort((a,b)=>a.p-b.p);
});
/** 지점 통과 기록 찾아보기: idx[달리기 문서][주자 번호][지점 번호] = 누른 시각 */
const cpIndex=memoV(()=>{
  const idx={};
  Store.list('cp').forEach(x=>{if(!x||!x.runId||x.t==null)return;const a=idx[x.runId]||(idx[x.runId]={}),b=a[x.leg]||(a[x.leg]={});b[x.point]=x.t;});
  return idx;
});
/** 사람이 서 있는 지점: 배정된 지점 · 지금 「지점 버튼」을 켠 요원의 지점 · 한 번이라도 눌린 지점.
    빈 지점에서는 로고를 멈춰 세우지 않는다(아무도 누르지 않아 멈춰 버리는 일을 막는다). */
let _manP=null,_manV=-1,_manS=null;
function cpManned(){
  if(_manS&&_manV===Store.version&&_manP===SD.S.peers) return _manS;
  const set=new Set();
  CFG.cp().points.forEach(c=>{if(c.uid||c.name)set.add(c.n);});
  (SD.S.peers||[]).forEach(p=>{const n=p.presence&&p.presence.cpPoint;if(n)set.add(+n);});
  Store.list('cp').forEach(x=>{if(x&&x.point)set.add(x.point);});
  _manP=SD.S.peers;_manV=Store.version;_manS=set;
  return set;
}
const LR={
  showSample:LS.get('showSample',false),
  recorder(){return LS.get('recorder','')||SD.S.me.name||'미지정';}
};
/** 풋살 스태프 이름을 기록원 목록에 더한다. 풋살 문서는 읽기만 한다. */
function staffNames(){
  const out=[];
  Object.values(SD.S.sports||{}).forEach(sp=>{
    const s=sp.staff||{};
    [...(s.recs||[]),...(s.refs||[])].forEach(n=>{if(n&&!out.includes(n))out.push(n);});
  });
  return out;
}

/* ---------- 학급 · 선수 ---------- */
const className=c=>!c?'(삭제된 학급)':(c.name||(c.grade+'학년 '+c.num+'반'));
const classShort=c=>!c?'-':(c.short||(c.grade+'-'+c.num));
const logoKey=c=>c?c.grade+'-'+c.num:'';
const logoOf=c=>c?SD.logoUrl(logoKey(c)):null;
const CLASS_COLORS=['#4C9AFF','#F05D5E','#2BC48A','#F5B342','#A78BFA','#2CC5D2','#F472B6','#9FB3C8'];
const classColor=c=>(c&&c.color)||CLASS_COLORS[((c&&+c.num)||1)%CLASS_COLORS.length];
/* 사로별 조끼 색: 설정에서 바꾸면 기록 화면과 TV에 같은 색이 쓰인다. */
const VEST_COLORS=['#E53935','#1E88E5','#FDD835','#43A047','#FB8C00','#8E24AA','#00ACC1','#EC407A','#6D4C41','#546E7A','#C0CA33','#5C6BC0'];
const vestColor=lane=>((CFG.settings().laneColors||{})[lane])||VEST_COLORS[((+lane||1)-1)%VEST_COLORS.length];
function vestInk(hex){
  const h=String(hex).replace('#','');
  const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  return (r*299+g*587+b*114)/1000>150?'#14110A':'#FFFFFF';
}
const vestStyle=lane=>{const c=vestColor(lane);return '--vest:'+c+';--vest-ink:'+vestInk(c)+';';};
/** 기본 출전 순서: 남 여 남 여 남 여 */
function defaultOrder(players){
  const m=players.filter(p=>p.gender==='M'),f=players.filter(p=>p.gender!=='M'),out=[];
  while(m.length||f.length){
    if(m.length) out.push(m.shift().id);
    if(f.length) out.push(f.shift().id);
  }
  return out;
}
/** 조 이름을 비워 두면 A조, B조 순서로 붙인다. */
function nextGroupName(){
  const used=new Set(Store.list('matches').filter(m=>!m.sample).map(m=>m.title));
  for(let i=0;i<26;i++){
    const t=String.fromCharCode(65+i)+'조';
    if(!used.has(t)) return t;
  }
  return '추가 조';
}
const classesSorted=memoV(()=>Store.list('classes').sort((a,b)=>(a.grade-b.grade)||(a.num-b.num)));
const playerOf=(c,id)=>(c&&(c.players||[]).find(p=>p.id===id))||null;
const genderKo=g=>g==='F'?'여':g==='M'?'남':'-';
function rosterIssue(c){
  const ps=(c&&c.players)||[];
  const m=ps.filter(p=>p.gender==='M').length,f=ps.filter(p=>p.gender==='F').length;
  if(ps.length===6&&m===3&&f===3) return null;
  return '남 '+m+' · 여 '+f+' (남3·여3 필요)';
}

/* ---------- 일정 ---------- */
const cmpMatch=(a,b)=>((a.date||'9')>(b.date||'9')?1:(a.date||'9')<(b.date||'9')?-1:0)||((a.time||'99')>(b.time||'99')?1:(a.time||'99')<(b.time||'99')?-1:0)||((a.seq||0)-(b.seq||0));
const matchesSorted=memoV(()=>Store.list('matches').sort(cmpMatch));
const hasReal=memoV(()=>Store.list('matches').some(m=>!m.sample));
const hasSample=memoV(()=>Store.list('matches').some(m=>m.sample)||Store.list('classes').some(c=>c.sample));
/* 실제 경기가 하나라도 등록되면 예시는 자동으로 숨긴다(이 기기에서 켜면 함께 표시). */
const sampleHidden=()=>hasReal()&&!LR.showSample;
const scopedMatches=()=>sampleHidden()?matchesSorted().filter(m=>!m.sample):matchesSorted();
const todayStr=()=>ymd(new Date(Live.now()));
function matchClockMs(m){
  if(!m||!m.date||!m.time) return null;
  const [y,mo,d]=m.date.split('-').map(Number),[h,mi]=m.time.split(':').map(Number);
  return new Date(y,mo-1,d,h,mi).getTime();
}
const effectiveMs=m=>{const t=matchClockMs(m);return t==null?null:t+(m.delayMin||0)*60000;};
function effectiveTimeStr(m){
  const t=effectiveMs(m);
  if(t==null) return '시간 미정';
  const d=new Date(t);
  return pad2(d.getHours())+':'+pad2(d.getMinutes());
}
function teamLabel(m){
  const cs=(m&&m.classIds||[]).map(id=>Store.doc('classes',id)).filter(Boolean);
  if(!cs.length) return (m&&m.title)||'경기';
  const groups={};
  cs.forEach(c=>{(groups[c.grade]=groups[c.grade]||[]).push(c);});
  return Object.keys(groups).sort().map(g=>g+'학년 '+groups[g].sort((a,b)=>a.num-b.num).map(c=>c.num+'반').join('·')).join(', ');
}
function nextMatch(list,now){
  const pool=list.filter(m=>m.status==='tbd'||!m.status);
  const timed=pool.filter(m=>effectiveMs(m)!=null).sort((a,b)=>effectiveMs(a)-effectiveMs(b));
  return timed[0]||pool[0]||null;
}
function timeUntilText(m,now){
  const eff=effectiveMs(m);
  if(eff==null) return '곧';
  const diff=eff-now;
  if(m.date!==ymd(new Date(now))&&diff>0) return fmtDateKo(m.date,false)+' '+effectiveTimeStr(m)+'에';
  const mins=Math.ceil(diff/60000);
  if(mins<=0) return '잠시 후';
  if(mins>=60) return Math.floor(mins/60)+'시간 '+(mins%60?mins%60+'분 ':'')+'후';
  return mins+'분 후';
}
function announceText(m,now){
  const tpl=CFG.tv().template||DEFAULT_TV.template;
  return tpl.replace(/\{팀\}/g,teamLabel(m)).replace(/\{시간\}/g,timeUntilText(m,now)).replace(/\{경기\}/g,m.title||'');
}
function countdownText(m,now){
  const eff=effectiveMs(m);
  if(eff==null) return '--:--';
  const s=Math.max(0,Math.ceil((eff-now)/1000));
  if(s>=3600) return Math.floor(s/3600)+':'+pad2(Math.floor(s%3600/60))+':'+pad2(s%60);
  return pad2(Math.floor(s/60))+':'+pad2(s%60);
}

/* ---------- 계측: 한 선수의 시각 기록(t0 출발, t1 사로 도착, t2 사격 완료, t3 도착) ---------- */
function toCs(ms,mode){
  const v=ms/10;
  if(mode==='round') return Math.round(v);
  if(mode==='ceil') return Math.ceil(v-1e-9);
  return Math.floor(v+1e-9);
}
const legKey=i=>'L'+i;
const legOf=(run,i)=>(run&&run.legs&&run.legs[legKey(i)])||null;
function legPhase(leg,ret){
  if(leg&&leg.manual) return 'manual';
  if(!leg||leg.t0==null) return 'ready';
  if(leg.t1==null) return 'run1';
  if(leg.t2==null) return 'shoot';
  if(ret&&leg.t3==null) return 'run2';
  return 'done';
}
function runState(run){
  const n=(run.order||[]).length,ret=run.returnRun!==false;
  for(let i=0;i<n;i++){
    const ph=legPhase(legOf(run,i),ret);
    if(ph!=='done'&&ph!=='manual') return {cur:i,phase:ph,n};
  }
  return {cur:-1,phase:'done',n};
}
const PHASE_KO={ready:'출발 대기',run1:'주행 중',shoot:'사격 중',run2:'도착 지점으로 주행',done:'완주',manual:'직접 입력'};
function actionLabel(run,st){
  const s=runState(run);
  if(s.cur<0) return '완주';
  const last=s.cur===s.n-1,ret=run.returnRun!==false;
  if(s.phase==='ready') return s.cur+1+'번 주자 출발';
  if(s.phase==='run1') return '사로 도착';
  if(s.phase==='shoot') return ret?'사격 완료 · 사로 출발':(last?'사격 완료 · 경기 종료':(st.autoNextStart?'사격 완료 · 다음 주자 출발':'사격 완료'));
  return last?'최종 도착':(st.autoNextStart?'도착 · 다음 주자 출발':'도착');
}
function lastEventTime(run){
  let t=0;
  (run.order||[]).forEach((_,i)=>{const l=legOf(run,i);if(l)['t0','t1','t2','t3'].forEach(k=>{if(l[k]!=null&&l[k]>t)t=l[k];});});
  return t;
}
/** 버튼 한 번에 해당하는 문서 변경분을 만든다. */
function advancePatch(run,t,ctx){
  const s=runState(run);
  if(s.cur<0) return null;
  const st=ctx.settings;
  t=Math.max(t,lastEventTime(run)+10); // 기기 시계 차이로 구간이 음수가 되는 일을 막는다
  const k=legKey(s.cur),leg=legOf(run,s.cur)||{},stamp={playerId:run.order[s.cur],recorder:ctx.recorder,recordedAt:t};
  const patch={legs:{}};
  const finishLeg=()=>{
    if(s.cur===s.n-1){patch.finishedAt=t;patch.status='finished';}
    else if(st.autoNextStart) patch.legs[legKey(s.cur+1)]={playerId:run.order[s.cur+1],t0:t,recorder:ctx.recorder,recordedAt:t};
  };
  if(s.phase==='ready'){
    patch.legs[k]={...stamp,t0:t};
    if(run.startedAt==null) patch.startedAt=t;
    patch.status='running';
  }else if(s.phase==='run1'){
    patch.legs[k]={...stamp,t1:t};
  }else if(s.phase==='shoot'){
    patch.legs[k]={...stamp,t2:t,hits:leg.hits!=null?leg.hits:st.requiredHits};
    if(run.returnRun===false) finishLeg();
  }else{
    patch.legs[k]={...stamp,t3:t};
    finishLeg();
  }
  return patch;
}
function undoPatch(run){
  const n=(run.order||[]).length;
  for(let i=n-1;i>=0;i--){
    const leg=legOf(run,i);
    if(!leg||leg.manual) continue;
    const key=['t3','t2','t1','t0'].find(k=>leg[k]!=null);
    if(!key) continue;
    const patch={legs:{[legKey(i)]:{[key]:null}}};
    if(run.finishedAt!=null){patch.finishedAt=null;patch.status='running';}
    if(key==='t0'){
      if(i===0){patch.startedAt=null;patch.status='ready';}
      else{
        // 다음 주자가 자동 출발했던 경우 앞 주자의 도착까지 함께 되돌린다
        const prev=legOf(run,i-1),pk=run.returnRun!==false?'t3':'t2';
        if(prev&&prev[pk]===leg.t0) patch.legs[legKey(i-1)]={[pk]:null};
      }
    }
    return patch;
  }
  return null;
}
function legResult(run,i,st){
  const leg=legOf(run,i)||{},scale=run.scale||1,ret=run.returnRun!==false;
  const cs=(a,b)=>(a!=null&&b!=null)?toCs((b-a)*scale,st.rounding):null;
  const run1=cs(leg.t0,leg.t1),shootRaw=cs(leg.t1,leg.t2),run2=ret?cs(leg.t2,leg.t3):null;
  const timed=ret?leg.t3!=null:leg.t2!=null;
  const rawRun=run1==null?null:run1+(run2||0);
  const runCs=leg.runCs!=null?leg.runCs:rawRun;
  const shootCs=leg.shootCs!=null?leg.shootCs:shootRaw;
  const hits=leg.hits!=null?leg.hits:null;
  const missPen=hits==null?0:Math.max(0,st.requiredHits-hits)*st.penaltyPerMissCs;
  const extraPen=leg.extraPenCs||0;
  const penCs=leg.penCs!=null?leg.penCs:missPen+extraPen;
  const complete=!!((timed||leg.manual)&&runCs!=null&&shootCs!=null);
  const finalCs=complete?runCs+shootCs+(st.includePenalty?penCs:0):null;
  return {run1,run2,shootRaw,rawRun,runCs,shootCs,hits,missPen,extraPen,penCs,complete,finalCs,timed,
    t0:leg.t0,t1:leg.t1,t2:leg.t2,t3:leg.t3,recorder:leg.recorder,recordedAt:leg.recordedAt,
    edited:!!leg.edited,manual:!!leg.manual,penNote:leg.penNote||'',playerId:leg.playerId||(run.order||[])[i]};
}
function teamResult(run,st){
  const n=(run.order||[]).length,scale=run.scale||1;
  let sum=0,pen=0,done=0,adj=0,plain=0;
  for(let i=0;i<n;i++){
    const r=legResult(run,i,st);
    if(!r.complete) continue;
    done++;sum+=r.finalCs;pen+=r.penCs;plain+=r.runCs+r.shootCs;
    if(r.timed&&r.rawRun!=null&&r.shootRaw!=null) adj+=(r.runCs+r.shootCs)-(r.rawRun+r.shootRaw);
  }
  const complete=n>0&&done===n;
  let lapCs=null;
  if(run.startedAt!=null&&run.finishedAt!=null) lapCs=toCs((run.finishedAt-run.startedAt)*scale,st.rounding)+adj;
  else if(complete) lapCs=plain;
  const finalCs=!complete?null:(st.teamCalc==='lap'?lapCs+(st.includePenalty?pen:0):sum);
  return {lapCs,penCs:pen,sumCs:sum,finalCs,done,n,complete};
}
const lapNowCs=(run,t,st)=>{
  if(run.startedAt==null) return null;
  const end=run.finishedAt!=null?run.finishedAt:t;
  return toCs(Math.max(0,end-run.startedAt)*(run.scale||1),st.rounding);
};
const phaseElapsedCs=(run,t,st)=>{
  const s=runState(run);
  if(s.cur<0) return null;
  const l=legOf(run,s.cur)||{};
  const from=s.phase==='run1'?l.t0:s.phase==='shoot'?l.t1:s.phase==='run2'?l.t2:null;
  return from==null?null:toCs(Math.max(0,t-from)*(run.scale||1),st.rounding);
};

/* ---------- 경기와 학급을 잇는 달리기 문서 ---------- */
const runIdOf=(mid,cid)=>mid+'__'+cid;
function virtualRun(m,cid){
  const c=Store.doc('classes',cid);
  return {id:runIdOf(m.id,cid),matchId:m.id,classId:cid,
    lane:(m.lanes&&m.lanes[cid])||((m.classIds||[]).indexOf(cid)+1),
    order:defaultOrder((c&&c.players)||[]),legs:{},status:'ready',
    returnRun:CFG.settings().returnRun,scale:1,sample:!!m.sample,check:{},virtual:true};
}
const runFor=(m,cid)=>Store.doc('runs',runIdOf(m.id,cid))||virtualRun(m,cid);
function materializeRun(m,cid){
  const id=runIdOf(m.id,cid);
  const r=Store.doc('runs',id);
  if(r) return r;
  const v=virtualRun(m,cid);
  delete v.virtual;
  Store.set('runs',id,v);
  return Store.doc('runs',id);
}
const runsOfMatch=m=>(m&&m.classIds||[]).map(cid=>runFor(m,cid)).sort((a,b)=>(a.lane||0)-(b.lane||0));

/* ---------- 개인 기록 목록 ---------- */
const allRecords=memoV(()=>{
  const st=CFG.settings(),out=[];
  Store.list('runs').forEach(run=>{
    const m=Store.doc('matches',run.matchId),c=Store.doc('classes',run.classId);
    if(!m||!c) return;
    (run.order||[]).forEach((pid,i)=>{
      const r=legResult(run,i,st);
      if(r.finalCs==null) return;
      const p=playerOf(c,r.playerId);
      out.push({id:run.id+'/'+i,runId:run.id,legIdx:i,playerId:r.playerId,
        name:p?p.name:'(명단에 없음)',gender:p?p.gender:'',classId:c.id,cls:c,grade:c.grade,num:c.num,
        matchId:m.id,matchTitle:m.title,date:m.date,runCs:r.runCs,shootCs:r.shootCs,penCs:r.penCs,finalCs:r.finalCs,
        hits:r.hits,t0:r.t0,recorder:r.recorder,recordedAt:r.recordedAt||0,edited:r.edited,manual:r.manual,
        sample:!!(run.sample||m.sample)});
    });
  });
  return out;
});
const scopedRecords=()=>sampleHidden()?allRecords().filter(r=>!r.sample):allRecords();
function rankRecords(list,bestOnly){
  const use=bestOnly===undefined?CFG.settings().bestOnly:bestOnly;
  let rows=list;
  if(use){
    const m=new Map();
    list.forEach(r=>{const x=m.get(r.playerId);if(!x||r.finalCs<x.finalCs)m.set(r.playerId,r);});
    rows=[...m.values()];
  }
  rows=[...rows].sort((a,b)=>(a.finalCs-b.finalCs)||(a.recordedAt-b.recordedAt));
  let rank=0,prev=null;
  return rows.map((r,i)=>{if(r.finalCs!==prev){rank=i+1;prev=r.finalCs;}return {...r,rank};});
}
function statsOf(rows){
  if(!rows.length) return {count:0,best:null,avg:null,bestRow:null};
  const sum=rows.reduce((a,r)=>a+r.finalCs,0);
  return {count:rows.length,best:rows[0].finalCs,avg:Math.round(sum/rows.length),bestRow:rows[0]};
}
/** 최고 기록이 바뀐 순간들. 수정된 기록도 현재 값 기준으로 다시 계산한다. */
function bestHistory(list){
  const s=[...list].sort((a,b)=>a.recordedAt-b.recordedAt),out=[];
  let b=Infinity;
  s.forEach(r=>{if(r.finalCs<b){out.push({...r,prev:b===Infinity?null:b});b=r.finalCs;}});
  return out;
}
function classTable(list,matchOk){
  const st=CFG.settings(),rows=[];
  const runs=Store.list('runs').filter(r=>{
    const m=Store.doc('matches',r.matchId);
    return m&&(!matchOk||matchOk(m))&&Store.doc('classes',r.classId)&&(!sampleHidden()||!(r.sample||m.sample));
  });
  const byClass={};
  runs.forEach(r=>{(byClass[r.classId]=byClass[r.classId]||[]).push(r);});
  classesSorted().forEach(c=>{
    if(sampleHidden()&&c.sample) return;
    const rs=byClass[c.id]||[];
    let bestTeam=null;
    rs.forEach(r=>{const t=teamResult(r,st);if(t.complete&&(!bestTeam||t.finalCs<bestTeam.finalCs))bestTeam=t;});
    const mine=list.filter(x=>x.classId===c.id);
    const avg=mine.length?Math.round(mine.reduce((a,x)=>a+x.finalCs,0)/mine.length):null;
    const best=mine.length?Math.min(...mine.map(x=>x.finalCs)):null;
    const progress=rs.reduce((a,r)=>Math.max(a,teamResult(r,st).done),0);
    rows.push({cls:c,team:bestTeam,avg,best,count:mine.length,progress,size:(c.players||[]).length,penCs:bestTeam?bestTeam.penCs:mine.reduce((a,x)=>a+x.penCs,0),lapCs:bestTeam?bestTeam.lapCs:null});
  });
  rows.sort((a,b)=>{
    if(a.team&&b.team) return a.team.finalCs-b.team.finalCs;
    if(a.team) return -1;
    if(b.team) return 1;
    return b.count-a.count||(a.cls.grade-b.cls.grade)||(a.cls.num-b.cls.num);
  });
  let rank=0,prev=null;
  return rows.map((r,i)=>{
    if(!r.team) return {...r,rank:null};
    if(r.team.finalCs!==prev){rank=i+1;prev=r.team.finalCs;}
    return {...r,rank};
  });
}

/* ---------- 순위 보드: 학급이 먼저, 개인은 그다음. 홈·TOP 10·TV·SNS가 함께 쓴다 ---------- */
const penText=cs=>cs>0?'페널티 '+fmtPen(cs):'';
const boardData=memoV(()=>{
  const recs=scopedRecords();
  const person=list=>rankRecords(list).map(r=>({id:r.id,rank:r.rank,key:logoKey(r.cls),name:r.name,sub:classShort(r.cls),time:fmtCs(r.finalCs),penText:penText(r.penCs),sample:!!r.sample}));
  const d={
    class:classTable(recs).filter(r=>r.rank).map(r=>({id:r.cls.id,rank:r.rank,key:logoKey(r.cls),name:className(r.cls),sub:'',time:fmtCs(r.team.finalCs),penText:penText(r.team.penCs),sample:!!r.cls.sample})),
    all:person(recs),male:person(recs.filter(r=>r.gender==='M')),female:person(recs.filter(r=>r.gender==='F'))
  };
  [1,2,3].forEach(g=>{d['g'+g]=person(recs.filter(r=>r.grade===g));});
  return d;
});
const BOARD_DEF=[{id:'class',label:'학급 TOP 10'},{id:'all',label:'개인 전체 TOP 10'},{id:'male',label:'남자 TOP 10'},{id:'female',label:'여자 TOP 10'},{id:'g1',label:'1학년 TOP 10'},{id:'g2',label:'2학년 TOP 10'},{id:'g3',label:'3학년 TOP 10'}];
/** TV에서 넘겨 가며 보여 줄 순위 화면. 남자·여자를 함께 고르면 한 화면에 나란히 둔다. */
function tvSlides(tv){
  const b=tv.boards||{},out=[];
  if(b.class) out.push({id:'class',title:'학급 TOP 10'});
  if(b.all) out.push({id:'all',title:'개인 전체 TOP 10'});
  if(b.male&&b.female) out.push({id:'duo',title:'남자 · 여자 TOP 10'});
  else if(b.male) out.push({id:'male',title:'남자 TOP 10'});
  else if(b.female) out.push({id:'female',title:'여자 TOP 10'});
  [1,2,3].forEach(g=>{if(b['g'+g]) out.push({id:'g'+g,title:g+'학년 TOP 10'});});
  return out;
}
const slideCount=(id,d)=>id==='duo'?d.male.length+d.female.length:(d[id]||[]).length;

/* ---------- 경기 중 순위: 통과한 구간 수와 그 구간의 (랩타임 + 페널티)로 비교 ---------- */
function raceTable(m){
  const st=CFG.settings();
  // 주자 한 명의 기록 지점 순서: [사격장 앞 코스 지점…] 사로 도착 · 사격 완료 [사격장 뒤 코스 지점…] 도착
  const ra=courseRangeAt(),list=cpList(),before=list.filter(c=>c.p<ra),after=list.filter(c=>c.p>ra);
  const K=before.length+after.length+3,idx=cpIndex();
  const rows=runsOfMatch(m).map(run=>{
    const team=teamResult(run,st),scale=run.scale||1,cps=[];
    let pen=0;
    (run.order||[]).forEach((_,i)=>{
      const l=legOf(run,i);
      if(!l||run.startedAt==null) return;
      const r=legResult(run,i,st),lap=t=>toCs((t-run.startedAt)*scale,st.rounding),base=i*K,taps=(idx[run.id]||{})[i]||{};
      before.forEach((c,j)=>{const t=taps[c.n];if(t!=null&&l.t0!=null&&t>=l.t0&&(l.t1==null||t<=l.t1)) cps[base+j]=lap(t)+pen;});
      if(l.t1!=null) cps[base+before.length]=lap(l.t1)+pen;
      if(l.t2!=null){pen+=st.includePenalty?r.penCs:0;cps[base+before.length+1]=lap(l.t2)+pen;}
      after.forEach((c,j)=>{const t=taps[c.n];if(t!=null&&l.t2!=null&&t>=l.t2&&(l.t3==null||t<=l.t3)) cps[base+before.length+2+j]=lap(t)+pen;});
      if(l.t3!=null) cps[base+K-1]=lap(l.t3)+pen;
    });
    return {run,team,cps,pen,passed:cps.length,started:run.startedAt!=null||team.done>0};
  });
  rows.sort((a,b)=>{
    if(a.team.complete&&b.team.complete) return a.team.finalCs-b.team.finalCs;
    if(a.team.complete!==b.team.complete) return a.team.complete?-1:1;
    if(a.passed!==b.passed) return b.passed-a.passed;
    if(a.passed>0&&a.cps[a.passed-1]!==b.cps[b.passed-1]) return a.cps[a.passed-1]-b.cps[b.passed-1];
    return (a.run.lane||0)-(b.run.lane||0);
  });
  const lead=rows[0];
  // 앞선 학급과의 차이: 둘 다 기록이 있는 가장 최근 지점에서 비교한다(누르지 못한 지점은 건너뛴다)
  const gapAt=(r,ld)=>{for(let k=r.passed-1;k>=0;k--) if(r.cps[k]!=null&&ld.cps[k]!=null) return r.cps[k]-ld.cps[k];return null;};
  let rank=0,prevFinal=null;
  rows.forEach((r,i)=>{
    r.rank=(r.team.complete&&r.team.finalCs===prevFinal)?rank:i+1;
    rank=r.rank;prevFinal=r.team.finalCs;
    if(i===0||!lead){r.gapCs=null;return;}
    if(r.team.complete&&lead.team.complete) r.gapCs=r.team.finalCs-lead.team.finalCs;
    else if(r.passed>0) r.gapCs=gapAt(r,lead);
    else r.gapCs=null;
  });
  return rows;
}
/** 다음 구간 도착 전까지는 지금까지의 구간 시간으로 위치를 추정한다. */
function expectedMs(run,cur,which,st){
  const vals=[];
  for(let i=0;i<cur;i++){
    const l=legOf(run,i);
    if(!l) continue;
    if(which==='run1'&&l.t0!=null&&l.t1!=null) vals.push(l.t1-l.t0);
    if(which==='run2'&&l.t2!=null&&l.t3!=null) vals.push(l.t3-l.t2);
  }
  if(vals.length) return vals.reduce((a,b)=>a+b,0)/vals.length;
  return (which==='run1'?st.expectedRun1Sec:st.expectedRun2Sec)*1000/(run.scale||1);
}
function easeProgress(x){
  // 예상보다 늦어도 다음 지점을 넘어가지 않게 끝에서 천천히 멈춘다
  if(x<=.85) return Math.max(0,x);
  return .85+.14*(1-Math.exp(-(x-.85)/.14));
}
function runProgress(run,t,st,rangeAt){
  const s=runState(run),n=(run.order||[]).length;
  if(s.cur<0) return {overall:n,p:1,leg:n-1,phase:'done'};
  const l=legOf(run,s.cur)||{};
  let p=0;
  if(s.phase==='run1'||s.phase==='run2'){
    // 마지막으로 지난 곳(출발 · 사격 완료 · 코스 지점)에서, 이번 주자의 실제 속도로 다음 지점까지 간다.
    // 다음 지점을 아직 누르지 않았으면 그 바로 앞에서 천천히 멈춘다(easeProgress).
    const run1=s.phase==='run1',p0=run1?0:rangeAt,p1=run1?rangeAt:1,t0=run1?l.t0:l.t2;
    const taps=(cpIndex()[run.id]||{})[s.cur]||{};
    const man=cpManned(),pts=cpList().filter(c=>c.p>p0&&c.p<p1&&(man.has(c.n)||taps[c.n]!=null));
    let a={p:p0,t:t0};
    pts.forEach(c=>{const tt=taps[c.n];if(tt!=null&&tt>=a.t&&c.p>a.p)a={p:c.p,t:tt};});
    const next=pts.find(c=>c.p>a.p+1e-6),pn=next?next.p:p1;
    let msPerP=expectedMs(run,s.cur,s.phase,st)/Math.max(1e-6,p1-p0);
    if(a.p>p0&&a.t>t0) msPerP=(a.t-t0)/(a.p-p0);
    const dur=Math.max(400,(pn-a.p)*msPerP);
    p=a.p+(pn-a.p)*easeProgress((t-a.t)/dur);
  }else if(s.phase==='shoot') p=rangeAt;
  return {overall:s.cur+p,p,leg:s.cur,phase:s.phase};
}

/* ==========================================================================
   활동 기록 — 기록원이 누른 버튼과 바꾼 설정을 한 줄씩 남긴다. 계정 주인이 설정 › 활동 기록에서
   비밀번호(풋살과 같은 비밀번호)로 열어 본다. 예시 데이터와 시뮬레이터 입력은 남기지 않는다.
   key를 주면 잠깐 사이 연속 입력(명중 수, 명단 타이핑 등)은 마지막 한 줄만 남긴다.
   ========================================================================== */
const LR_ID='__laserrun';
const ActLog={
  t:{},
  add(text,o={}){
    if(!text||o.sample||!SD.logAct) return;
    const who=o.by==null?LR.recorder():o.by,me=(SD.S.me&&SD.S.me.name)||SD.S.nick||'';
    if(who==='시뮬레이터') return;
    const line=text+(who&&who!==me&&who!=='미지정'?' · 입력 '+who:'');
    const go=()=>{try{SD.logAct(line,LR_ID);}catch(e){}};
    if(!o.key){go();return;}
    clearTimeout(this.t[o.key]);
    this.t[o.key]=setTimeout(()=>{delete this.t[o.key];go();},o.wait||2500);
  }
};
const runner=(c,run,i)=>{const p=playerOf(c,(run.order||[])[i]);return (i+1)+'번'+(p&&p.name?' '+p.name:'');};
const PH_LOG={ready:'출발',run1:'사로 도착',shoot:'사격 완료',run2:'도착'};

/* ==========================================================================
   데이터 변경 동작
   ========================================================================== */
const Actions={
  _last:{},
  advance(matchId,classId,t,opts={}){
    const m=Store.doc('matches',matchId);
    if(!m||!Store.canWrite()) return false;
    t=t==null?Live.now():t;
    const key=matchId+'|'+classId;
    if(!opts.force&&t-(this._last[key]||0)<350) return false; // 두 번 눌림 방지
    this._last[key]=t;
    const c=Store.doc('classes',classId);
    if(!c||!(c.players||[]).length){toast(className(c)+'의 참가자가 아직 등록되지 않았습니다.','warn');return false;}
    const run=materializeRun(m,classId);
    const s0=runState(run);
    const patch=advancePatch(run,t,{settings:CFG.settings(),recorder:opts.by||LR.recorder()});
    if(!patch) return false;
    Store.merge('runs',run.id,patch);
    if(m.status!=='live'&&m.status!=='done') Store.merge('matches',m.id,{status:'live',startedAt:t,finishedAt:null});
    if(!opts.quiet&&s0.cur>=0){
      const fin=patch.status==='finished';
      ActLog.add(m.title+' · '+className(c)+' '+runner(c,run,s0.cur)+' — '+(PH_LOG[s0.phase]||'입력')+(fin?' · 완주':''),{sample:m.sample,by:opts.by});
    }
    this.afterRun(matchId);
    return true;
  },
  startAll(matchId){this.startMatch(matchId);},
  undo(matchId,classId){
    const m=Store.doc('matches',matchId);
    const run=m&&Store.doc('runs',runIdOf(matchId,classId));
    if(!run) return;
    const p=undoPatch(run);
    if(p){
      Store.merge('runs',run.id,p);
      if(m.status==='done') Store.merge('matches',m.id,{status:'live',finishedAt:null});
      toast('마지막 입력을 되돌렸습니다.','info',1800);
      ActLog.add(m.title+' · '+className(Store.doc('classes',classId))+' 마지막 입력 되돌리기',{sample:m.sample});
    }
  },
  afterRun(matchId){
    const st=CFG.settings(),m=Store.doc('matches',matchId);
    if(!m||m.status==='done'||!st.autoFinishMatch) return;
    const rs=runsOfMatch(m);
    if(rs.length&&rs.every(r=>teamResult(r,st).complete)){
      this.finishMatch(matchId,true);
      toast(m.title+' 경기가 끝났습니다. 경기 운영 › ④ 서명 · 종료에서 주장 서명을 받아 주세요.','ok');
    }
  },
  setHits(run,i,hits){
    Store.merge('runs',run.id,{legs:{[legKey(i)]:{hits}}});
    const m=Store.doc('matches',run.matchId),c=Store.doc('classes',run.classId);
    ActLog.add((m?m.title+' · ':'')+className(c)+' '+runner(c,run,i)+' — 명중 '+hits+'발',{sample:run.sample,key:'hits|'+run.id+'|'+i});
  },
  addPenalty(run,i,cs,note){
    const r=legOf(run,i)||{};
    Store.merge('runs',run.id,{legs:{[legKey(i)]:{extraPenCs:(r.extraPenCs||0)+cs,penNote:note||r.penNote||'',playerId:run.order[i]}}});
    const m=Store.doc('matches',run.matchId),c=Store.doc('classes',run.classId);
    ActLog.add((m?m.title+' · ':'')+className(c)+' '+runner(c,run,i)+' — 페널티 +'+Math.round(cs/100)+'초'+(note?' ('+note+')':''),{sample:run.sample});
  },
  /** 어디서 누르든 같은 동작: 모든 학급의 1번 주자가 같은 시각에 출발하고 경기가 진행 상태가 된다. */
  startMatch(id){
    const m=Store.doc('matches',id);
    if(!m||!Store.canWrite()) return;
    const t=Live.now(),empty=[];
    (m.classIds||[]).forEach(cid=>materializeRun(m,cid));
    (m.classIds||[]).forEach(cid=>{
      const run=runFor(m,cid),st=runState(run);
      if(!(run.order||[]).length){empty.push(className(Store.doc('classes',cid)));return;}
      if(st.phase==='ready'&&st.cur===0) this.advance(id,cid,t,{force:true,quiet:true});
    });
    Store.merge('matches',id,{status:'live',startedAt:m.startedAt||t,finishedAt:null});
    if(empty.length) toast(empty.join(', ')+'의 참가자가 아직 등록되지 않았습니다.','warn');
    ActLog.add(m.title+' 경기 시작'+(m.startedAt?' (남은 학급 출발)':'')+(empty.length?' · 참가자 없음: '+empty.join(', '):''),{sample:m.sample});
  },
  finishMatch(id,auto){
    Store.merge('matches',id,{status:'done',finishedAt:Live.now()});
    const m=Store.doc('matches',id);
    if(m) ActLog.add(m.title+' 경기 종료'+(auto?' (모든 주자 완주)':''),{sample:m.sample});
  },
  reopenMatch(id){
    Store.merge('matches',id,{status:'live',finishedAt:null});
    const m=Store.doc('matches',id);
    if(m) ActLog.add(m.title+' 종료를 취소하고 진행으로 되돌림',{sample:m.sample});
  },
  /** 달리기 문서를 지운다. 출전 순서를 직접 바꿔 둔 반은 그 순서만 남긴 새 문서로 둔다. */
  wipeRuns(m){
    Store.list('runs').filter(r=>r.matchId===m.id).forEach(r=>{
      if(r.orderCustom&&(r.order||[]).length){
        const v=virtualRun(m,r.classId);
        delete v.virtual;
        Store.set('runs',r.id,{...v,order:r.order,orderCustom:true});
      }else Store.remove('runs',r.id);
    });
  },
  resetMatch(id,by){
    const m=Store.doc('matches',id);
    if(!m||!Store.canWrite()) return;
    const had=allRecords().filter(r=>r.matchId===id);
    this.wipeRuns(m);
    Store.merge('matches',id,{status:'tbd',startedAt:null,finishedAt:null});
    Signs.clearMatch(id);
    if(had.length&&by!=='sim') this.log({kind:'reset',matchId:id,matchTitle:m.title,reason:'경기 기록 초기화 ('+had.length+'건)',by:LR.recorder(),sample:!!m.sample});
    if(by!=='sim') ActLog.add(m.title+' 경기 초기화'+(had.length?' (기록 '+had.length+'건 삭제)':''),{sample:m.sample});
  },
  log(o){
    const id=uid('a_');
    Store.set('audit',id,{id,at:Live.now(),...o});
  },
  saveRecord(run,i,v,reason,by){
    const st=CFG.settings(),before=legResult(run,i,st),c=Store.doc('classes',run.classId),m=Store.doc('matches',run.matchId);
    const stored=Store.doc('runs',run.id)||materializeRun(m,run.classId);
    const leg={
      playerId:stored.order[i],
      runCs:v.runCs===before.rawRun?null:v.runCs,
      shootCs:v.shootCs===before.shootRaw?null:v.shootCs,
      hits:v.hits,
      extraPenCs:v.extraPenCs||0,
      penNote:v.penNote||'',
      penCs:v.penOverride?v.penCs:null,
      recorder:by,
      recordedAt:before.complete&&before.recordedAt?before.recordedAt:Live.now(),
      edited:before.complete?true:!!before.edited
    };
    if(!before.timed) leg.manual=true;
    if(v.t0!=null) leg.t0=v.t0;
    Store.merge('runs',stored.id,{legs:{[legKey(i)]:leg}});
    const after=legResult(Store.doc('runs',stored.id),i,st);
    const p=playerOf(c,before.playerId);
    this.log({kind:before.complete?'edit':'manual',runId:stored.id,legIdx:i,matchId:stored.matchId,matchTitle:m&&m.title,classId:stored.classId,className:className(c),
      playerId:before.playerId,playerName:p?p.name:'',by,reason:reason||(before.complete?'':'직접 입력'),sample:!!stored.sample,
      before:before.complete?{runCs:before.runCs,shootCs:before.shootCs,penCs:before.penCs,finalCs:before.finalCs}:null,
      after:{runCs:after.runCs,shootCs:after.shootCs,penCs:after.penCs,finalCs:after.finalCs}});
    ActLog.add((before.complete?'기록 수정: ':'기록 직접 입력: ')+(m?m.title+' · ':'')+className(c)+' '+(p?p.name:'')+' → 최종 '+fmtCs(after.finalCs)+(before.complete?' (이전 '+fmtCs(before.finalCs)+')':'')+(reason?' · 사유: '+reason:''),{sample:stored.sample,by});
    const fresh=Store.doc('runs',stored.id);
    if(teamResult(fresh,st).complete&&fresh.status!=='finished') Store.merge('runs',stored.id,{status:'finished'});
    this.afterRun(stored.matchId);
  },
  clearRecord(run,i,reason,by){
    const st=CFG.settings(),before=legResult(run,i,st),c=Store.doc('classes',run.classId),m=Store.doc('matches',run.matchId),p=playerOf(c,before.playerId);
    Store.merge('runs',run.id,{status:'running',finishedAt:null,legs:{[legKey(i)]:{t0:null,t1:null,t2:null,t3:null,hits:null,runCs:null,shootCs:null,penCs:null,extraPenCs:0,penNote:'',manual:false,edited:false}}});
    this.log({kind:'delete',runId:run.id,legIdx:i,matchId:run.matchId,matchTitle:m&&m.title,classId:run.classId,className:className(c),playerId:before.playerId,playerName:p?p.name:'',by,reason,sample:!!run.sample,
      before:{runCs:before.runCs,shootCs:before.shootCs,penCs:before.penCs,finalCs:before.finalCs},after:null});
    ActLog.add('기록 삭제: '+(m?m.title+' · ':'')+className(c)+' '+(p?p.name:'')+' (최종 '+fmtCs(before.finalCs)+')'+(reason?' · 사유: '+reason:''),{sample:run.sample,by});
  },
  saveOrder(m,cid,order){
    const run=materializeRun(m,cid);
    Store.merge('runs',run.id,{order,orderCustom:true});
    ActLog.add('출전 순서 변경: '+m.title+' · '+className(Store.doc('classes',cid)),{sample:m.sample,key:'order|'+m.id+'|'+cid,wait:3000});
  },
  saveRoster(classId,players){
    Store.merge('classes',classId,{players});
    const cc=Store.doc('classes',classId);
    ActLog.add('참가자 명단 수정: '+className(cc)+' ('+players.length+'명)',{sample:cc&&cc.sample,key:'roster|'+classId,wait:4000});
    // 아직 출발하지 않은 경기의 출전 순서를 명단에 맞춘다
    Store.list('runs').filter(r=>r.classId===classId&&r.startedAt==null&&!Object.keys(r.legs||{}).length).forEach(r=>{
      const ids=players.map(p=>p.id);
      const kept=(r.order||[]).filter(id=>ids.includes(id));
      Store.merge('runs',r.id,{order:r.orderCustom?[...kept,...ids.filter(id=>!kept.includes(id))]:defaultOrder(players)});
    });
  },
  deleteClass(id){
    const dc=Store.doc('classes',id);
    if(dc) ActLog.add('참가 반 삭제: '+className(dc),{sample:dc.sample});
    Store.remove('classes',id);
    Store.list('matches').filter(m=>(m.classIds||[]).includes(id)).forEach(m=>{
      Store.merge('matches',m.id,{classIds:m.classIds.filter(x=>x!==id)});
    });
  },
  deleteMatch(id){
    const dm=Store.doc('matches',id);
    if(dm) ActLog.add('경기 삭제: '+dm.title,{sample:dm.sample});
    Signs.clearMatch(id);
    Store.list('runs').filter(r=>r.matchId===id).forEach(r=>Store.remove('runs',r.id));
    Store.remove('matches',id);
  },
  saveConfig(id,patch){
    Store.merge('config',id,patch);
    const k=Object.keys(patch||{});
    if(id==='tv'&&k.length===1&&k[0]==='notice') ActLog.add(patch.notice?'TV 안내 문구 표시: '+patch.notice:'TV 안내 문구 지움');
    else if(id==='app'&&'open' in patch) ActLog.add('레이저런 화면을 '+(patch.open?'모든 계정에 공개':'편집자만 보기로 변경'));
    else ActLog.add('설정 변경: '+({settings:'대회 정보·규칙',tv:'TV 송출',course:'코스'}[id]||id),{key:'cfg|'+id+'|'+k.join(','),wait:3000});
  },
  clearSample(){
    Sim.stop();
    Store.list('matches').filter(m=>m.sample).forEach(m=>Signs.clearMatch(m.id));
    Store.list('audit').filter(a=>a.sample).forEach(a=>Store.remove('audit',a.id));
    Store.list('runs').filter(r=>r.sample).forEach(r=>Store.remove('runs',r.id));
    Store.list('matches').filter(m=>m.sample).forEach(m=>Store.remove('matches',m.id));
    Store.list('classes').filter(c=>c.sample).forEach(c=>Store.remove('classes',c.id));
    toast('예시 데이터를 모두 삭제했습니다.','ok');
    ActLog.add('예시 데이터 삭제');
  },
  loadSample(){
    const docs=makeSampleDocs(Live.now());
    docs.forEach(d=>Store.set(d.c,d.id,d.data));
    toast('예시 데이터를 불러왔습니다. 화면의 “예시” 표시를 확인해 주세요.','ok');
    ActLog.add('예시 데이터 불러오기');
  },
  resetAll(){
    Sim.stop();
    Store.list('media').forEach(m=>MediaStore.del(m.assetId));
    Store.list('classes').forEach(c=>{MediaStore.del(c.posterId);});
    MediaStore.del(CFG.course().bgId);
    Signs.clearAll();
    Store.COLS.forEach(c=>Object.keys(Store.col(c)).forEach(id=>{if(c==='config'&&id==='app')return;Store.remove(c,id);})); // 공개 설정은 남긴다
    toast('모든 레이저런 데이터를 삭제했습니다. 풋살 데이터는 그대로입니다.','ok');
    ActLog.add('레이저런 전체 초기화 (모든 학급·일정·기록 삭제)');
  },
  /** 반·선수·일정은 두고 모든 경기의 기록, 주장 서명, 수정 이력만 지운다. 예시 데이터는 화면에 보일 때만 함께 지운다. */
  resetRecords(){
    if(!Store.canWrite()) return 0;
    Sim.stop();
    const ms=scopedMatches(),ids=new Set(ms.map(m=>m.id)),hide=sampleHidden();
    const n=allRecords().filter(r=>ids.has(r.matchId)).length;
    ms.forEach(m=>{
      this.wipeRuns(m);
      if((m.status&&m.status!=='tbd')||m.startedAt!=null||m.finishedAt!=null) Store.merge('matches',m.id,{status:'tbd',startedAt:null,finishedAt:null});
      Signs.clearMatch(m.id);
    });
    Store.list('audit').filter(a=>!hide||!a.sample).forEach(a=>Store.remove('audit',a.id));
    this.log({kind:'reset',matchTitle:'전체 경기',reason:'전체 기록 초기화 (경기 '+ms.length+'개 · 기록 '+n+'건)',by:LR.recorder(),sample:false});
    ActLog.add('전체 기록 초기화 (경기 '+ms.length+'개 · 기록 '+n+'건 삭제)');
    return n;
  }
};

/* ==========================================================================
   예시 경기 시뮬레이터 — 실제 계측과 같은 경로로 버튼 입력을 재생한다
   ========================================================================== */
const Sim={
  active:null,
  start(matchId,speed){
    this.stop();
    const m=Store.doc('matches',matchId);
    if(!m||!m.sample||!Store.canWrite()) return;
    Actions.resetMatch(matchId,'sim');
    const plans={};
    (m.classIds||[]).forEach(cid=>{
      const v=virtualRun(m,cid);
      delete v.virtual;
      v.scale=speed;
      Store.set('runs',v.id,v);
      const form=.94+Math.random()*.12;
      plans[cid]=v.order.map(()=>{
        const miss=Math.random();
        return {
          run1:(190+Math.random()*50)*form,
          shoot:48+Math.random()*Math.random()*95,
          run2:(34+Math.random()*16)*form,
          hits:miss>.97?3:miss>.86?4:5
        };
      });
    });
    const t=Live.now();
    Store.merge('matches',matchId,{status:'live',startedAt:t,finishedAt:null});
    this.active={matchId,speed,plans,at:t+1800,timer:setInterval(()=>this.tick(),120)};
    Store.touch();
  },
  tick(){
    const a=this.active;
    if(!a) return;
    const m=Store.doc('matches',a.matchId);
    if(!m||m.status==='done'){this.stop();return;}
    const now=Live.now();
    (m.classIds||[]).forEach(cid=>{
      const run=Store.doc('runs',runIdOf(a.matchId,cid));
      if(!run) return;
      const s=runState(run);
      if(s.cur<0) return;
      const plan=a.plans[cid][s.cur],l=legOf(run,s.cur)||{};
      let from,dur;
      if(s.phase==='ready'){from=a.at;dur=0;}
      else if(s.phase==='run1'){from=l.t0;dur=plan.run1;}
      else if(s.phase==='shoot'){from=l.t1;dur=plan.shoot;}
      else{from=l.t2;dur=plan.run2;}
      const due=from+dur*1000/a.speed;
      if(now<due) return;
      if(s.phase==='shoot') Store.merge('runs',run.id,{legs:{[legKey(s.cur)]:{hits:plan.hits}}});
      Actions.advance(a.matchId,cid,s.phase==='ready'?a.at:due,{force:true,by:'시뮬레이터'});
    });
    if(runsOfMatch(m).every(r=>runState(r).cur<0)) this.stop();
  },
  stop(){
    if(this.active){clearInterval(this.active.timer);this.active=null;Store.touch();}
  }
};

/* ==========================================================================
   예시 데이터 (모든 문서에 sample:true)
   ========================================================================== */
function makeSampleDocs(nowMs){
  let seed=20261104;
  const rnd=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
  const SUR='김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민'.split('');
  const docs=[],add=(c,id,data)=>docs.push({c,id,data:{id,...data}});
  let si=0;
  const classIdOf=(g,n)=>'sc'+g+n;
  for(let g=1;g<=3;g++) for(let n=1;n<=6;n++){
    const players=[];
    for(let k=0;k<6;k++) players.push({id:'sp'+g+n+k,name:SUR[si++%SUR.length]+'○○',gender:k%2===0?'M':'F'});
    add('classes',classIdOf(g,n),{grade:g,num:n,color:CLASS_COLORS[(n-1)%CLASS_COLORS.length],players,posterId:null,sample:true});
  }
  const fmtHM=d=>pad2(d.getHours())+':'+pad2(d.getMinutes());
  const slot=off=>{
    const d=new Date(Math.round((nowMs+off*60000)/600000)*600000);
    return {date:ymd(d),time:fmtHM(d)};
  };
  const lanesOf=ids=>{const o={};ids.forEach((id,i)=>{o[id]=i+1;});return o;};
  const tomorrow=ymd(new Date(nowMs+864e5));
  const defs=[
    {id:'sm1',title:'A조',g:1,ns:[1,2,3],...slot(-95),status:'done'},
    {id:'sm2',title:'B조',g:1,ns:[4,5,6],...slot(-55),status:'done'},
    {id:'sm3',title:'C조',g:2,ns:[1,2,3],...slot(20),status:'tbd'},
    {id:'sm4',title:'D조',g:2,ns:[4,5,6],...slot(50),status:'tbd',delayMin:10,delayReason:'앞 경기 지연'},
    {id:'sm5',title:'E조',g:3,ns:[1,2,3],date:tomorrow,time:'10:00',status:'tbd',changed:true,changes:[{from:{date:tomorrow,time:'09:30'},to:{date:tomorrow,time:'10:00'},at:nowMs,by:'예시 기록원',reason:'운동장 사용 시간 조정'}]},
    {id:'sm6',title:'F조',g:3,ns:[4,5,6],date:tomorrow,time:'10:40',status:'tbd'}
  ];
  defs.forEach((d,idx)=>{
    const classIds=d.ns.map(n=>classIdOf(d.g,n));
    const start=matchClockMs(d);
    add('matches',d.id,{title:d.title,date:d.date,time:d.time,classIds,lanes:lanesOf(classIds),status:d.status,delayMin:d.delayMin||0,delayReason:d.delayReason||'',changed:!!d.changed,changes:d.changes||[],note:'',notes:{},seq:idx,sample:true,
      startedAt:d.status==='done'?start:null,finishedAt:null});
    if(d.status!=='done') return;
    let matchEnd=start;
    classIds.forEach((cid,ci)=>{
      let T=start;
      const order=d.ns.length?[0,1,2,3,4,5].map(k=>'sp'+d.g+d.ns[ci]+k):[];
      const legs={};
      order.forEach((pid,i)=>{
        const r1=(182+rnd()*62)*1000+Math.floor(rnd()*990),s=(48+rnd()*rnd()*96)*1000+Math.floor(rnd()*990),r2=(32+rnd()*20)*1000+Math.floor(rnd()*990);
        const x=rnd(),hits=x>.93?3:x>.8?4:5;
        const t0=T,t1=t0+r1,t2=t1+s,t3=t2+r2;
        legs['L'+i]={playerId:pid,t0:Math.round(t0),t1:Math.round(t1),t2:Math.round(t2),t3:Math.round(t3),hits,recorder:'예시 기록원',recordedAt:Math.round(t3)};
        T=t3;
      });
      matchEnd=Math.max(matchEnd,T);
      const id=runIdOf(d.id,cid);
      add('runs',id,{matchId:d.id,classId:cid,lane:ci+1,order,legs,status:'finished',startedAt:start,finishedAt:Math.round(T),returnRun:true,scale:1,sample:true,check:Object.fromEntries(order.map(p=>[p,true]))});
    });
    docs.find(x=>x.c==='matches'&&x.id===d.id).data.finishedAt=Math.round(matchEnd);
    if(d.id==='sm1'){
      const r=docs.find(x=>x.c==='runs'&&x.data.matchId==='sm1').data,l=r.legs.L1,c=classIdOf(1,1);
      const st={rounding:'floor',requiredHits:5,penaltyPerMissCs:1000,includePenalty:true};
      const was=legResult(r,1,st);
      l.runCs=was.runCs-212;l.edited=true;
      const now=legResult(r,1,st),p=docs.find(x=>x.c==='classes'&&x.id===c).data.players.find(x=>x.id===l.playerId);
      add('audit','sa1',{at:Math.round(r.finishedAt+60000),kind:'edit',runId:r.id,legIdx:1,matchId:'sm1',matchTitle:d.title,classId:c,className:'1학년 1반',playerId:l.playerId,playerName:p.name,by:'예시 기록원',reason:'버튼 오입력',sample:true,
        before:{runCs:was.runCs,shootCs:was.shootCs,penCs:was.penCs,finalCs:was.finalCs},after:{runCs:now.runCs,shootCs:now.shootCs,penCs:now.penCs,finalCs:now.finalCs}});
    }
  });
  return docs;
}

/* ==========================================================================
   공용 화면 요소
   ========================================================================== */
const ICONS={
  home:'<path d="M3 10.2 10 4l7 6.2"/><path d="M5 9v7h3.6v-4h2.8v4H15V9"/>',
  calendar:'<rect x="3" y="4.5" width="14" height="12.5" rx="1.5"/><path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4"/>',
  flag:'<path d="M5 18V3"/><path d="M5 4h10l-2 3.2L15 10.5H5"/>',
  timer:'<circle cx="10" cy="11" r="6.5"/><path d="M10 7.5V11l2.2 1.6M7.8 2.5h4.4"/>',
  list:'<path d="M7 5.5h10M7 10h10M7 14.5h10"/><path d="M3 5.5h.8M3 10h.8M3 14.5h.8"/>',
  trophy:'<path d="M6 3.5h8v5a4 4 0 0 1-8 0z"/><path d="M6 5H3.2c0 2.6 1 4 3.2 4.3M14 5h2.8c0 2.6-1 4-3.2 4.3M10 12.5V15M7 17h6M8 15h4v2H8z"/>',
  tv:'<rect x="2.5" y="4" width="15" height="10" rx="1.2"/><path d="M7 17h6M10 14v3"/>',
  gear:'<circle cx="10" cy="10" r="2.6"/><path d="M10 2.6v2M10 15.4v2M2.6 10h2M15.4 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M4.8 15.2l1.4-1.4M13.8 6.2l1.4-1.4"/>',
  up:'<path d="M10 16V4M5 9l5-5 5 5"/>',
  down:'<path d="M10 4v12M5 11l5 5 5-5"/>',
  undo:'<path d="M7 5 3.5 8.5 7 12"/><path d="M4 8.5h8a4 4 0 0 1 0 8H8"/>',
  plus:'<path d="M10 4v12M4 10h12"/>',
  edit:'<path d="M13.5 3.5l3 3L7 16H4v-3z"/>',
  trash:'<path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11"/>',
  reset:'<path d="M4.2 11a6 6 0 1 0 1.7-5.2"/><path d="M4 3.2v3.6h3.6"/>',
  camera:'<rect x="2.5" y="5.5" width="11" height="9" rx="1.2"/><path d="m13.5 9 4-2.2v6.4l-4-2.2"/>',
  link:'<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.8-2.8a3 3 0 0 0-4.2-4.2l-1 1"/><path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.8 2.8a3 3 0 0 0 4.2 4.2l1-1"/>',
  check:'<path d="m4 10.5 4 4 8-9"/>',
  full:'<path d="M3 7.5V3h4.5M17 7.5V3h-4.5M3 12.5V17h4.5M17 12.5V17h-4.5"/>',
  play:'<path d="M6 4v12l10-6z"/>',
  stop:'<rect x="5" y="5" width="10" height="10" rx="1"/>',
  image:'<rect x="3" y="4" width="14" height="12" rx="1.2"/><circle cx="7.5" cy="8.3" r="1.3"/><path d="m3.5 14 4-3.5 3 2.5 2.5-2 3.5 3"/>',
  upload:'<path d="M10 13V4M6 7.5 10 3.5l4 4M3.5 13.5V16.5h13v-3"/>',
  menu:'<path d="M3 6h14M3 10h14M3 14h14"/>'
};
function Icon({n,s=18}){
  return html`<svg class="ic" width=${s} height=${s} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{__html:ICONS[n]||''}}></svg>`;
}
const STATUS={live:{t:'진행',c:'live'},done:{t:'종료',c:'final'},tbd:{t:'미정',c:'st-tbd'}};
function StatusChip({s}){
  const o=STATUS[s]||STATUS.tbd;
  return html`<span class="chip ${o.c}">${o.t}</span>`;
}
const SampleChip=()=>html`<span class="chip chip-sample" title="연습용으로 만든 데이터입니다. 실제 기록이 아닙니다.">예시</span>`;
const RealChip=()=>html`<span class="chip chip-real">실제</span>`;
function ScheduleFlags({m}){
  return html`
    ${m.delayMin>0?html`<span class="chip chip-delay">지연 +${m.delayMin}분</span>`:null}
    ${m.changed?html`<span class="chip chip-change" title=${(m.changes&&m.changes.length)?(m.changes[m.changes.length-1].reason||''):''}>일정 변경</span>`:null}
  `;
}
/** 학급 로고는 풋살과 같은 36개 로고를 쓴다. */
function Logo({cls,size,className:extra,plain}){
  const [err,setErr]=useState(false);
  const url=!err?logoOf(cls):null;
  const st=size?('width:'+size+';height:'+size+';'):'';
  if(url) return html`<img class="logo ${extra||''}" style=${st} src=${url} alt=${className(cls)+' 로고'} onError=${()=>setErr(true)}/>`;
  return html`<span class="logo logo-fb ${extra||''}" style=${st+'--c:'+classColor(cls)}>${plain?(cls?cls.num:'-'):classShort(cls)}</span>`;
}
function ClassName({cls,short}){
  return html`<span class="clsname"><${Logo} cls=${cls} plain/><span>${short?classShort(cls):className(cls)}</span></span>`;
}
/** 전광판 글꼴(Big Shoulders)은 숫자 폭이 달라 초시계가 흔들린다. 글자마다 같은 폭의 칸에 넣어 흔들리지 않게 한다. */
function setTm(el,text){
  if(el.__t===text) return;
  el.__t=text;
  let kids=el.children;
  if(kids.length!==text.length){
    el.textContent='';
    for(let i=0;i<text.length;i++) el.appendChild(document.createElement('i'));
    kids=el.children;
  }
  for(let i=0;i<text.length;i++){
    const ch=text[i],k=kids[i];
    if(k.textContent!==ch){k.textContent=ch;k.className=/\d/.test(ch)?'d':'p';}
  }
}
function Tm({v,class:c,id}){
  const r=useRef(null);
  useLayoutEffect(()=>{if(r.current)setTm(r.current,String(v==null?'':v));},[v]);
  return html`<span ref=${r} id=${id} class=${'tmono '+(c||'')} aria-label=${String(v==null?'':v)}></span>`;
}
/** 초시계처럼 매 프레임 바뀌는 글자. 다시 그리기 없이 글자만 바꾼다. */
function LiveText({fn,class:cls}){
  const r=useRef(null),f=useRef(fn);
  f.current=fn;
  useLayoutEffect(()=>{if(r.current)setTm(r.current,String(f.current()));},[]);
  useEffect(()=>Ticker.add(()=>{
    const el=r.current;
    if(el) setTm(el,String(f.current()));
  }),[]);
  return html`<span ref=${r} class=${'tmono '+(cls||'')}></span>`;
}
function Tabs({items,value,onChange}){
  return html`<div class="stage-tabs" role="tablist">
    ${items.map(it=>html`<button key=${it.id} type="button" role="tab" aria-selected=${String(value===it.id)} onClick=${()=>onChange(it.id)}>${it.label}${it.count!=null?html` <b>${it.count}</b>`:null}</button>`)}
  </div>`;
}
function Modal({title,onClose,children,footer,wide}){
  return html`<${SUI.Modal} title=${title} onClose=${onClose||(()=>{})} foot=${footer} wide=${wide} cls="lr lr-modal">${children}<//>`;
}
function Field({label,hint,children,error,grow}){
  return html`<label class="field ${grow?'grow':''}">
    <span class="field-label">${label}</span>
    ${children}
    ${error?html`<span class="field-error">${error}</span>`:hint?html`<span class="field-hint">${hint}</span>`:null}
  </label>`;
}
/** 기록 입력: 분 : 초 . 소수 세 칸. 두 자리가 차면 다음 칸으로 이동한다. */
function TimeField({value,onChange,idBase,disabled}){
  const toParts=cs=>cs==null?['','','']:[pad2(Math.floor(cs/6000)),pad2(Math.floor(cs%6000/100)),pad2(cs%100)];
  const [parts,setParts]=useState(()=>toParts(value));
  const refs=[useRef(null),useRef(null),useRef(null)];
  const lastSent=useRef(value);
  useEffect(()=>{
    if(value!==lastSent.current){lastSent.current=value;setParts(toParts(value));}
  },[value]);
  const push=p=>{
    setParts(p);
    if(p.every(x=>x==='')){lastSent.current=null;onChange(null,true);return;}
    const m=+(p[0]||0),s=+(p[1]||0),x=+(p[2].length===1?p[2]+'0':(p[2]||0));
    const ok=s<60;
    const cs=m*6000+s*100+x;
    lastSent.current=ok?cs:null;
    onChange(ok?cs:null,ok);
  };
  const set=(i,val)=>{
    const digits=val.replace(/\D/g,'');
    if(digits.length>2){ // 13241처럼 한 번에 들어온 숫자는 분·초·소수로 나눈다
      const cs=parseTime(digits.slice(0,6));
      if(cs!=null){
        push(toParts(cs));
        if(refs[2].current){refs[2].current.focus();refs[2].current.select();}
        return;
      }
    }
    const clean=digits.slice(0,2);
    const p=[...parts];p[i]=clean;push(p);
    if(clean.length===2&&i<2&&refs[i+1].current&&document.activeElement===refs[i].current){refs[i+1].current.focus();refs[i+1].current.select();}
  };
  const onPaste=e=>{
    const t=(e.clipboardData||window.clipboardData).getData('text');
    const cs=parseTime(t);
    if(cs!=null){e.preventDefault();const p=toParts(cs);push(p);}
  };
  const onKey=(i,e)=>{
    if(e.key==='Backspace'&&!parts[i]&&i>0&&refs[i-1].current) refs[i-1].current.focus();
  };
  const bad=parts[1]!==''&&+parts[1]>=60;
  return html`<span class="timefield ${bad?'bad':''}">
    <input id=${idBase+'-m'} ref=${refs[0]} inputmode="numeric" aria-label="분" placeholder="00" value=${parts[0]} disabled=${disabled} onInput=${e=>set(0,e.target.value)} onPaste=${onPaste} onFocus=${e=>e.target.select()} onKeyDown=${e=>onKey(0,e)}/>
    <i>:</i>
    <input id=${idBase+'-s'} ref=${refs[1]} inputmode="numeric" aria-label="초" placeholder="00" value=${parts[1]} disabled=${disabled} onInput=${e=>set(1,e.target.value)} onPaste=${onPaste} onFocus=${e=>e.target.select()} onKeyDown=${e=>onKey(1,e)}/>
    <i>.</i>
    <input id=${idBase+'-x'} ref=${refs[2]} inputmode="numeric" aria-label="소수" placeholder="00" value=${parts[2]} disabled=${disabled} onInput=${e=>set(2,e.target.value)} onPaste=${onPaste} onFocus=${e=>e.target.select()} onKeyDown=${e=>onKey(2,e)}/>
  </span>`;
}
function RecorderPicker(){
  useStore();
  const st=CFG.settings();
  const name=LS.get('recorder','');
  const [custom,setCustom]=useState(false);
  const setName=v=>{LS.set('recorder',v);Store.touch();};
  const opts=[...new Set([...(st.recorders||[]),...staffNames()])];
  const isCustom=custom||(name&&!opts.includes(name));
  return html`<label class="recorder ${!name&&!SD.S.me.name?'need':''}">
    <span>기록 입력자</span>
    ${isCustom?html`<input class="input" value=${name} placeholder="이름 입력" onInput=${e=>setName(e.target.value)} onBlur=${()=>setCustom(false)}/>`
    :html`<select class="select" value=${name} onChange=${e=>{if(e.target.value==='__c'){setCustom(true);setName('');}else setName(e.target.value);}}>
      <option value="">${SD.S.me.name?SD.S.me.name+' (내 계정)':'미지정'}</option>
      ${opts.map(o=>html`<option key=${o} value=${o}>${o}</option>`)}
      <option value="__c">직접 입력…</option>
    </select>`}
  </label>`;
}
function EmptyState({title,children,action}){
  return html`<div class="empty"><strong>${title}</strong>${children?html`<p>${children}</p>`:null}${action?html`<div class="empty-act">${action}</div>`:null}</div>`;
}
function Panel({title,kicker,right,children,class:cls,flush}){
  return html`<section class="panel ${cls||''}">
    ${title?html`<header class="panel-head"><div>${kicker?html`<span class="kicker">${kicker}</span>`:null}<h2>${title}</h2></div>${right?html`<div class="panel-right">${right}</div>`:null}</header>`:null}
    <div class="panel-body ${flush?'flush':''}">${children}</div>
  </section>`;
}
function RankMark({n}){
  return html`<span class="rk-m ${n===1?'r1':n===2?'r2':n===3?'r3':''}">${n==null?'–':n}</span>`;
}
const GenderTag=({g})=>html`<span class="chip ${g==='F'?'women':'men'}">${genderKo(g)}</span>`;
/** 사용자가 제시한 기록 표기 그대로 보여 주는 카드 */
function RecordCard({name,r}){
  return html`<div class="reccard">
    <strong class="reccard-name">${name}</strong>
    <dl>
      <div><dt>사격</dt><dd><${Tm} v=${fmtCs(r.shootCs)}/></dd></div>
      <div><dt>주행</dt><dd><${Tm} v=${fmtCs(r.runCs)}/></dd></div>
      <div class=${r.penCs>0?'pen':''}><dt>페널티</dt><dd><${Tm} v=${fmtPen(r.penCs)}/></dd></div>
      <div class="final"><dt>최종 기록</dt><dd><${Tm} v=${fmtCs(r.finalCs)}/></dd></div>
    </dl>
  </div>`;
}
/** 개인 순위표 — 순위, TOP 10, 홈이 함께 쓴다. */
function RecordTable({rows,compact,bestId,showMatch,emptyText,onEdit}){
  if(!rows.length) return html`<${EmptyState} title=${emptyText||'아직 입력된 기록이 없습니다.'}>경기 운영 › ③ 실시간 계측에서 기록이 들어오면 자동으로 정렬됩니다.<//>`;
  const anySample=rows.some(r=>r.sample);
  return html`<div class="tbl-wrap"><table class="tbl ${compact?'tbl-compact':''}">
    <thead><tr>
      <th class="c-rank">순위</th><th>이름</th><th>학급</th>
      ${compact?null:html`<th class="c-g">성별</th>`}
      ${compact?null:html`<th class="num">사격</th><th class="num">주행</th><th class="num">페널티</th>`}
      <th class="num">최종 기록</th>
      ${compact?null:html`<th>기록 입력자</th>`}
      ${(!compact||anySample)?html`<th class="c-kind">구분</th>`:null}
    </tr></thead>
    <tbody>
      ${rows.map(r=>html`<tr key=${r.id} class=${r.id===bestId?'is-best':''}>
        <td class="c-rank"><${RankMark} n=${r.rank}/></td>
        <td class="c-name"><strong>${r.name}</strong>${r.id===bestId?html`<span class="chip chip-best">최고 기록</span>`:null}${r.edited?html`<span class="chip chip-edit" title="수정된 기록입니다. 기록 관리의 수정 이력에서 볼 수 있습니다.">수정</span>`:null}</td>
        <td><${ClassName} cls=${r.cls} short=${compact}/></td>
        ${compact?null:html`<td class="c-g"><${GenderTag} g=${r.gender}/></td>`}
        ${compact?null:html`<td class="num">${fmtCs(r.shootCs)}</td><td class="num">${fmtCs(r.runCs)}</td><td class="num ${r.penCs>0?'is-pen':'dim'}">${fmtPen(r.penCs)}</td>`}
        <td class="num strong">${fmtCs(r.finalCs)}</td>
        ${compact?null:html`<td class="dim">${r.recorder||'—'}</td>`}
        ${(!compact||anySample)?html`<td class="c-kind">${r.sample?html`<${SampleChip}/>`:html`<${RealChip}/>`}</td>`:null}
      </tr>`)}
    </tbody>
  </table></div>`;
}
/** 순위 보드. 풋살 홈의 TOP 10과 같은 모양(1~3위 금·은·동 배경)이다. */
function RankBoard({title,rows,limit=10,empty,right}){
  const list=(rows||[]).slice(0,limit);
  return html`<section class="panel lr-board">
    <div class="panel-head"><h2>${title}</h2>${list.some(r=>r.sample)?html`<${SampleChip}/>`:null}${right?html`<div class="end">${right}</div>`:null}</div>
    ${list.length?html`<div class="ranklist">${list.map(r=>html`<div class=${'rk-row '+(r.rank<=3?'rk-'+r.rank:'rk-n')} key=${r.id}>
      <span class="rk">${r.rank}</span><${SUI.TeamLogo} cls=${r.key} size=${30}/>
      <span class="nm">${r.name}${r.sub?html`<small>${r.sub}</small>`:null}</span>
      <span class="val"><${Tm} v=${r.time}/>${r.penText?html`<em>${r.penText}</em>`:null}</span>
    </div>`)}</div>`:html`<${SUI.Empty} title=${empty||'아직 기록이 없습니다'}/>`}
  </section>`;
}
function StatStrip({items}){
  return html`<div class="statstrip">${items.map(i=>html`<div class="stat" key=${i.label}><span>${i.label}</span><strong class=${i.num===false?'':'num'}>${i.value}</strong>${i.sub?html`<em>${i.sub}</em>`:null}</div>`)}</div>`;
}
function FilePick({accept,capture,onFile,children,class:cls,disabled,id}){
  const r=useRef(null);
  return html`<span class="filepick">
    <input ref=${r} id=${id} class="lr-file" type="file" accept=${accept} capture=${capture} hidden onChange=${e=>{const f=e.target.files&&e.target.files[0];e.target.value='';if(f)onFile(f);}}/>
    <button type="button" class=${cls||'btn'} disabled=${disabled} onClick=${()=>r.current&&r.current.click()}>${children}</button>
  </span>`;
}
function ImageSlot({label,assetId,onFile,onRemove,busy,wide,hint}){
  const url=MediaStore.url(assetId);
  return html`<div class="imgslot ${wide?'wide':''}">
    <div class="imgslot-view">${url?html`<img src=${url} alt=${label}/>`:html`<span>${label} 없음</span>`}</div>
    <div class="imgslot-act">
      <${FilePick} accept="image/*" onFile=${onFile} class="btn btn-sm" disabled=${busy||!MediaStore.canUpload()}><${Icon} n="upload" s=${14}/> ${busy?'올리는 중…':url?'변경':'등록'}<//>
      ${url?html`<button class="btn btn-sm btn-ghost" onClick=${onRemove}>삭제</button>`:null}
    </div>
    ${hint?html`<span class="field-hint">${hint}</span>`:null}
  </div>`;
}
/** QR 코드 도구는 쓸 때만 불러온다. 풋살 화면에는 영향이 없다. */
let qrAsked=false;
function useQrLib(){
  const [ok,setOk]=useState(!!window.qrcode);
  useEffect(()=>{
    if(window.qrcode) return;
    if(!qrAsked){
      qrAsked=true;
      const el=document.createElement('script');
      el.src='https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
      document.head.appendChild(el);
    }
    const t=setInterval(()=>{if(window.qrcode){clearInterval(t);setOk(true);}},300);
    return()=>clearInterval(t);
  },[]);
  return ok;
}
function Qr({text,size=148}){
  const ok=useQrLib();
  const svg=useMemo(()=>{
    if(!ok||!window.qrcode||!text) return '';
    try{const q=qrcode(0,'M');q.addData(text);q.make();return q.createSvgTag({cellSize:4,margin:2,scalable:true});}catch(e){return '';}
  },[text,ok]);
  if(!svg) return null;
  return html`<div class="qr" style=${'width:'+size+'px;height:'+size+'px'} dangerouslySetInnerHTML=${{__html:svg}} role="img" aria-label="QR 코드"></div>`;
}
function CopyField({value,label,id}){
  const [done,setDone]=useState(false);
  const r=useRef(null);
  const copy=()=>{
    const ok=()=>{setDone(true);setTimeout(()=>setDone(false),1600);};
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(value).then(ok,()=>{if(r.current)r.current.select();});
    else if(r.current) r.current.select();
  };
  return html`<div class="copyfield">
    ${label?html`<span class="field-label">${label}</span>`:null}
    <div><input class="input" id=${id} ref=${r} readonly value=${value} onFocus=${e=>e.target.select()}/><button class="btn btn-sm" onClick=${copy}>${done?'복사됨':'복사'}</button></div>
  </div>`;
}
function ConfirmHost(){
  const [,force]=useReducer(x=>x+1,0);
  useEffect(()=>{Confirm.fn=force;return()=>{Confirm.fn=null;};},[]);
  const c=Confirm.cur;
  if(!c) return null;
  const close=v=>{Confirm.cur=null;force();c.res(v);};
  return html`<${Modal} title=${c.title} onClose=${()=>close(false)} footer=${html`
    <button class="btn" onClick=${()=>close(false)}>취소</button>
    <button id="confirm-ok" class="btn ${c.danger?'btn-danger':'btn-primary'}" onClick=${()=>close(true)}>${c.ok||'확인'}</button>`}>
    <p class="confirm-body">${c.body}</p>
  <//>`;
}

/* ==========================================================================
   주장 서명 — 풋살 경기 기록의 전자 서명과 같은 방식
   학급마다 lr_signs/<경기__학급> 한 장. 서명 뒤 기록이 바뀌면 그 서명은 효력을 잃고 다시 받아야 한다.
   서명 이미지는 편집 권한이 있는 계정만 읽는다(풋살 signs와 같은 규칙).
   ========================================================================== */
const Signs={
  data:{},started:false,
  start(){
    if(this.started||!SD.S.db) return;
    this.started=true;
    const sub=()=>SD.S.db.collection('lr_signs').onSnapshot(snap=>{
      const o={};
      snap.docs.forEach(d=>{o[d.id]=d.data();});
      this.data=o;
      Store.touch();
    },err=>{
      const c=err&&err.code;
      if(c==='unavailable'||c==='resource_exhausted') setTimeout(sub,3000);
    });
    sub();
  },
  of(runId){return this.data[runId]||null;},
  save(runId,d){
    return SD.S.db.doc('lr_signs/'+runId).set(d).then(()=>{
      this.data={...this.data,[runId]:d};
      Store.touch();
      return true;
    },()=>{toast('서명을 저장하지 못했습니다. 다시 시도해 주세요.','error');return false;});
  },
  clear(runId){
    const n={...this.data};
    delete n[runId];
    this.data=n;
    Store.touch();
    return SD.S.db.doc('lr_signs/'+runId).delete().catch(()=>{});
  },
  clearMatch(mid){
    Object.keys(this.data).filter(id=>id.startsWith(mid+'__')).forEach(id=>this.clear(id));
  },
  clearAll(){
    Object.keys(this.data).forEach(id=>this.clear(id));
  }
};
const signKey=(run,st)=>{
  const t=teamResult(run,st);
  return (t.complete?fmtCs(t.finalCs):'미완주 '+t.done+'/'+t.n)+' · 페널티 '+fmtPen(t.penCs);
};
const okSign=(s,run,st)=>!!(s&&s.img&&s.res===signKey(run,st));

/* 손가락·펜 서명 칸. 획은 0~1 좌표로 보관해 크기가 바뀌어도 다시 그린다. */
function drawInk(ctx,strokes,w,h,lw){
  ctx.save();ctx.strokeStyle='#0E1834';ctx.fillStyle='#0E1834';ctx.lineWidth=lw;ctx.lineCap='round';ctx.lineJoin='round';
  strokes.forEach(s=>{
    if(s.length===1){ctx.beginPath();ctx.arc(s[0][0]*w,s[0][1]*h,lw/2,0,Math.PI*2);ctx.fill();return;}
    ctx.beginPath();ctx.moveTo(s[0][0]*w,s[0][1]*h);
    for(let i=1;i<s.length-1;i++){const mx=(s[i][0]+s[i+1][0])/2,my=(s[i][1]+s[i+1][1])/2;ctx.quadraticCurveTo(s[i][0]*w,s[i][1]*h,mx*w,my*h);}
    const l=s[s.length-1];ctx.lineTo(l[0]*w,l[1]*h);ctx.stroke();
  });
  ctx.restore();
}
function SignPad({api,onInk}){
  const ref=useRef(null),strokes=useRef([]),cur=useRef(null);
  const paint=()=>{
    const cv=ref.current;
    if(!cv) return;
    const ctx=cv.getContext('2d'),r=cv.getBoundingClientRect();
    ctx.clearRect(0,0,r.width,r.height);
    drawInk(ctx,strokes.current,r.width,r.height,2.6);
  };
  useEffect(()=>{
    const cv=ref.current;
    const size=()=>{const r=cv.getBoundingClientRect(),d=window.devicePixelRatio||1;cv.width=Math.max(1,Math.round(r.width*d));cv.height=Math.max(1,Math.round(r.height*d));cv.getContext('2d').setTransform(d,0,0,d,0,0);paint();};
    size();
    const ro=window.ResizeObserver?new ResizeObserver(size):null;
    if(ro) ro.observe(cv);
    api.current={
      clear:()=>{strokes.current=[];paint();onInk(false);},
      png:()=>{
        const r=cv.getBoundingClientRect(),w=480,h=Math.round(480*r.height/Math.max(1,r.width));
        const o=document.createElement('canvas');o.width=w;o.height=h;
        drawInk(o.getContext('2d'),strokes.current,w,h,2.6*w/Math.max(1,r.width));
        return o.toDataURL('image/png');
      }
    };
    return()=>{if(ro)ro.disconnect();};
  },[]);
  const pt=e=>{const r=ref.current.getBoundingClientRect();return [(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height];};
  const down=e=>{e.preventDefault();try{ref.current.setPointerCapture(e.pointerId);}catch(x){}cur.current=[pt(e)];strokes.current.push(cur.current);paint();};
  const move=e=>{
    if(!cur.current) return;
    const evs=e.getCoalescedEvents?e.getCoalescedEvents():[e];
    (evs.length?evs:[e]).forEach(ev=>cur.current.push(pt(ev)));
    paint();
  };
  const up=()=>{if(!cur.current)return;cur.current=null;onInk(strokes.current.length>0);};
  return html`<div class="sign-pad"><canvas ref=${ref} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onPointerLeave=${up} aria-label="서명 칸"></canvas>
    <span class="ph" aria-hidden="true">여기에 서명하세요</span></div>`;
}
/* 한 학급의 서명 칸: 팀 기록, 주장 선택, 서명, 지우기·확인 */
function SignSide({m,run,st}){
  const cls=Store.doc('classes',run.classId);
  const players=(cls&&cls.players)||[];
  const capId=(cls&&cls.captainId)||'';
  const sign=Signs.of(run.id);
  const valid=okSign(sign,run,st);
  const [pid,setPid]=useState(capId||(sign&&sign.pid)||'');
  const [typed,setTyped]=useState('');
  const [ink,setInk]=useState(false);
  const [busy,setBusy]=useState(false);
  const pad=useRef(null);
  const name=players.length?((players.find(p=>p.id===pid)||{}).name||''):typed.trim();
  const confirm=async()=>{
    if(!name||!ink||!pad.current) return;
    setBusy(true);
    materializeRun(m,run.classId);
    const ok=await Signs.save(run.id,{pid:players.length?pid:'',name,img:pad.current.png(),res:signKey(run,st),at:Date.now(),by:LR.recorder(),sample:!!run.sample});
    if(ok&&players.length&&pid&&pid!==capId) Store.merge('classes',cls.id,{captainId:pid});
    if(ok) ActLog.add('주장 서명: '+m.title+' · '+className(cls)+' ('+name+')',{sample:run.sample});
    setBusy(false);
  };
  const head=html`<div class="lr-sign-head"><${Logo} cls=${cls} size="30px"/><b>${className(cls)}</b><span class="muted small">${signKey(run,st)}</span></div>`;
  if(valid) return html`<div class="sign-side done">${head}
    <div class="sign-who"><span>주장</span><b>${sign.name}</b><span class="chip ok">확인</span></div>
    <div class="sign-img"><img src=${sign.img} alt=${className(cls)+' 주장 '+sign.name+' 서명'}/></div>
    <div class="sign-actions"><span class="small muted">${fmtClock(sign.at)} 서명</span><span class="spacer"></span>
      <button type="button" class="btn btn-sm" onClick=${()=>Signs.clear(run.id)}>다시 서명</button></div>
  </div>`;
  return html`<div class="sign-side">${head}
    <div class="sign-who"><span>주장</span>
      ${players.length?html`<select class="select" aria-label=${className(cls)+' 주장'} value=${pid} onChange=${e=>setPid(e.target.value)}>
          <option value="">주장 선택</option>${players.map(p=>html`<option key=${p.id} value=${p.id}>${p.name}${p.id===capId?' (주장)':''}</option>`)}</select>`
        :html`<input class="input" placeholder="주장 이름" value=${typed} onInput=${e=>setTyped(e.target.value)}/>`}</div>
    ${sign&&sign.img?html`<div class="small lr-sign-warn">서명한 뒤 기록이 바뀌어 다시 서명해야 합니다.</div>`:null}
    <${SignPad} api=${pad} onInk=${setInk}/>
    <div class="sign-actions"><button type="button" class="btn btn-sm" disabled=${!ink} onClick=${()=>pad.current&&pad.current.clear()}>지우기</button><span class="spacer"></span>
      <button type="button" class="btn btn-primary" disabled=${!name||!ink||busy} onClick=${confirm}>${busy?'저장 중…':'확인'}</button></div>
  </div>`;
}
function SignSheet({m,finishing,onClose}){
  useStore();
  const st=CFG.settings();
  const cur=Store.doc('matches',m.id)||m;
  const runs=runsOfMatch(cur);
  const allOk=runs.length>0&&runs.every(r=>okSign(Signs.of(r.id),r,st));
  const unfinished=runs.filter(r=>!teamResult(r,st).complete).length;
  const done=()=>{
    Actions.finishMatch(cur.id);
    toast(cur.title+' 경기를 종료 처리했습니다.','ok');
    onClose();
  };
  return html`<${Modal} title=${(finishing?'경기 종료 · ':'')+'주장 서명 · '+cur.title} wide onClose=${onClose} footer=${finishing?html`
    <${SUI.ConfirmBtn} cls="foot-left" onConfirm=${done} armedText="한 번 더 누르면 종료">서명 없이 종료<//>
    <button class="btn" onClick=${onClose}>취소</button>
    <button id="sign-finish" class="btn btn-primary" disabled=${!allOk} onClick=${done}>경기 종료</button>`:html`<button class="btn" onClick=${onClose}>닫기</button>`}>
    <p class="muted small">각 학급 주장이 기록을 확인하고 서명합니다. 서명한 뒤 기록이 바뀌면 다시 서명해야 합니다.</p>
    ${finishing&&unfinished?html`<div class="banner warn small">아직 완주하지 않은 학급이 ${unfinished}개 있습니다. 종료하면 그 학급은 미완주로 남습니다.</div>`:null}
    <div class="lr-sign-grid">${runs.map(r=>html`<${SignSide} key=${r.id} m=${cur} run=${r} st=${st}/>`)}</div>
  <//>`;
}
function SignChip({run,st}){
  const s=Signs.of(run.id);
  if(okSign(s,run,st)) return html`<span class="chip ok">서명 완료</span>`;
  if(s&&s.img) return html`<span class="chip warn">다시 서명 필요</span>`;
  return teamResult(run,st).complete?html`<span class="chip">서명 전</span>`:null;
}
function SignPanel({m,runs,st,onOpen}){
  if(!runs.some(r=>teamResult(r,st).done>0)&&m.status!=='done') return null;
  const nOk=runs.filter(r=>okSign(Signs.of(r.id),r,st)).length;
  return html`<${Panel} title="주장 서명" right=${html`<span class="dim">${nOk}/${runs.length} 학급</span><button id="sign-open" class="btn btn-sm" onClick=${onOpen}>서명 받기</button>`}>
    <div class="lr-sign-row">${runs.map(r=>{
      const c=Store.doc('classes',r.classId);
      return html`<span class="lr-sign-item" key=${r.id}><${Logo} cls=${c} size="22px"/>${classShort(c)} <${SignChip} run=${r} st=${st}/></span>`;
    })}</div>
  <//>`;
}

/* ==========================================================================
   [1] 홈 · [2] 경기 일정 · [3] 경기 관리
   ========================================================================== */
function Onboarding(){
  if(!Store.canWrite()) return html`<${Panel}><${EmptyState} title="아직 등록된 경기가 없습니다.">일정이 등록되면 이곳에 표시됩니다.<//><//>`;
  return html`<div class="onboard">
    <h2>레이저런 데이터가 아직 없습니다</h2>
    <p>참가 반과 선수, 경기 일정을 등록하면 이 화면에 진행 상황과 순위가 나타납니다. 풋살 기록과는 따로 저장됩니다.</p>
    <div class="onboard-grid">
      <button class="onboard-card" onClick=${()=>{LS.set('ui.teamsTab','class');navigate('teams');}}>
        <strong>참가 반부터 등록</strong>
        <span>36개 학급 로고에서 참가 반을 고르고, 풋살 명단이나 엑셀로 선수를 넣습니다.</span>
      </button>
      <button class="onboard-card" onClick=${()=>Actions.loadSample()}>
        <strong>예시 데이터로 둘러보기</strong>
        <span>“예시”로 표시된 학급과 기록을 만듭니다. 언제든 한 번에 삭제할 수 있습니다.</span>
      </button>
    </div>
  </div>`;
}
/** 홈 맨 위: 대회 진행 단계(준비 → 경기 → 결과). 단계마다 해당 화면으로 바로 간다. */
function ProgressSteps(){
  useStore();
  const cs=classesSorted().filter(c=>!c.sample);
  const withP=cs.filter(c=>(c.players||[]).length).length;
  const gs=groupsList(),placed=new Set(gs.flatMap(g=>g.seeds.filter(Boolean)));
  const ms=Store.list('matches').filter(m=>!m.sample);
  const dated=ms.filter(m=>m.date).length,done=ms.filter(m=>m.status==='done').length,live=ms.filter(m=>m.status==='live').length;
  const gm=gs.filter(g=>groupMatches(g.key).length).length;
  const to=(r,tab)=>()=>{if(tab)LS.set('ui.teamsTab',tab);navigate(r);};
  const steps=[
    {label:'참가 반',sub:cs.length?cs.length+'개 반':'고르기 전',ok:cs.length>0,go:to('teams','class')},
    {label:'참가자 명단',sub:cs.length?'명단 '+withP+' / '+cs.length+' 반':'—',ok:cs.length>0&&withP===cs.length,go:to('teams','roster')},
    {label:'조 추첨',sub:gs.length?gs.length+'개 조'+(placed.size<cs.length?' · 미배정 '+(cs.length-placed.size):''):'추첨 전',ok:gs.length>0&&cs.length>0&&placed.size>=cs.length,go:to('teams','groups')},
    {label:'경기 일정',sub:ms.length?ms.length+'경기 · 날짜 '+dated+'/'+ms.length:'만들기 전',ok:gs.length>0&&gm===gs.length&&ms.length>0&&dated===ms.length,go:to('schedule')},
    {label:'경기 운영',sub:ms.length?(live?'진행 중 '+live+' · ':'')+'종료 '+done+' / '+ms.length:'—',ok:ms.length>0&&done===ms.length,go:to('ops')},
    {label:'순위 · 방송',sub:'TOP 10 · TV · SNS',ok:false,go:to('standings')}
  ];
  const cur=steps.findIndex(x=>!x.ok);
  return html`<section class="panel lr-prog" aria-label="대회 진행 단계">
    <ol>${steps.map((x,i)=>html`<li key=${i} class=${(x.ok?'ok':'')+(i===cur?' cur':'')}>
      <button type="button" onClick=${x.go}><span class="lr-pno">${x.ok?html`<${Icon} n="check" s=${14}/>`:i+1}</span><span class="lr-ptx"><b>${x.label}</b><small>${x.sub}</small></span></button>
    </li>`)}</ol>
    ${cur>=0?html`<div class="lr-prog-now"><span class="kicker">지금 할 일</span><b>${steps[cur].label}</b><button class="btn btn-sm btn-primary" onClick=${steps[cur].go}>바로 가기 →</button></div>`:null}
  </section>`;
}
/** 홈 카드의 참가 학급: 사로 순서대로 로고 + 학년 반을 한 줄씩 */
function KpiTeams({m}){
  const lanes=m.lanes||{};
  const cs=(m.classIds||[]).map(id=>Store.doc('classes',id)).filter(Boolean).sort((a,b)=>(lanes[a.id]||99)-(lanes[b.id]||99));
  if(!cs.length) return null;
  return html`<ul class="kpi-teams">${cs.map(c=>html`<li key=${c.id}><${Logo} cls=${c} className="kpi-tlogo"/><span>${className(c)}</span></li>`)}</ul>`;
}
function HomePage(){
  useStore();
  const now=useNow(1000);
  const st=CFG.settings();
  const ms=scopedMatches();
  if(!ms.length&&!Store.list('classes').length) return html`<${Onboarding}/>`;
  const live=ms.filter(m=>m.status==='live');
  const next=nextMatch(ms,now);
  const doneCount=ms.filter(m=>m.status==='done').length;
  const pct=ms.length?Math.round(doneCount/ms.length*100):0;
  const liveLegs=live.reduce((a,m)=>a+runsOfMatch(m).reduce((b,r)=>b+teamResult(r,st).done,0),0);
  const all=rankRecords(scopedRecords());
  const best=all[0];
  const data=boardData(),topClass=data.class[0];
  const grades=[1,2,3].filter(g=>data['g'+g].length);
  const today=todayStr();
  const todays=ms.filter(m=>m.date===today);
  const nextDay=!todays.length?ms.find(m=>m.date>today):null;
  const dayList=todays.length?todays:(nextDay?ms.filter(m=>m.date===nextDay.date):[]);
  const can=Store.canWrite();
  return html`<div class="page">
    ${can?html`<${ProgressSteps}/>`:null}
    <div class="kpis">
      <section class="kpi kpi-live">
        <header><span>현재 진행 중</span>${live.length?html`<${StatusChip} s="live"/>`:null}</header>
        ${live.length?live.slice(0,2).map(m=>{
          const rs=runsOfMatch(m);
          const started=rs.filter(r=>r.startedAt!=null);
          const from=started.length?Math.min(...started.map(r=>r.startedAt)):null;
          const scale=started.length?(started[0].scale||1):1;
          return html`<div class="kpi-main" key=${m.id}>
            <strong>${m.title}${m.sample?html` <${SampleChip}/>`:null}</strong>
            <${KpiTeams} m=${m}/>
            <div class="kpi-clock"><small>전체 랩타임</small><${LiveText} class="num" fn=${()=>from==null?'--:--.--':fmtCs(toCs(Math.max(0,Live.now()-from)*scale,st.rounding))}/></div>
          </div>`;
        }):html`<div class="kpi-main"><strong class="muted">진행 중인 경기 없음</strong><em>경기를 시작하면 여기에 표시됩니다.</em></div>`}
        ${can?html`<button class="kpi-link" onClick=${()=>{if(live[0]){LS.set('ui.match',live[0].id);LS.set('ui.opsGo','live');}navigate('ops');}}>${live.length?'실시간 계측으로 →':'경기 운영으로 →'}</button>`:null}
      </section>
      <section class="kpi">
        <header><span>다음 경기 예정</span>${next&&next.sample?html`<${SampleChip}/>`:null}</header>
        ${next?html`<div class="kpi-main">
          <strong class="kpi-next-ttl">${next.title}<span class="kpi-dot">·</span><small>${next.date===today?'오늘':fmtDateKo(next.date)} ${effectiveTimeStr(next)}</small></strong>
          <${KpiTeams} m=${next}/>
          <div class="kpi-clock"><small>시작까지</small><span class="num">${timeUntilText(next,now)}</span></div>
          <div class="kpi-flags"><${ScheduleFlags} m=${next}/></div>
        </div>`:html`<div class="kpi-main"><strong class="muted">예정된 경기 없음</strong></div>`}
        <button class="kpi-link" onClick=${()=>navigate('schedule')}>경기 일정 보기 →</button>
      </section>
      <section class="kpi">
        <header><span>전체 경기 진행률</span></header>
        <div class="kpi-main">
          <strong class="num kpi-big">${pct}<small>%</small></strong>
          <div class="progress" role="progressbar" aria-valuenow=${pct} aria-valuemin="0" aria-valuemax="100"><i style=${'width:'+pct+'%'}></i></div>
          <em>${ms.length}경기 중 ${doneCount}경기 종료${live.length?' · '+live.length+'경기 진행 중':''}${liveLegs?' (완주 '+liveLegs+'명)':''}</em>
        </div>
      </section>
      <section class="kpi">
        <header><span>학급 1위</span>${topClass&&topClass.sample?html`<${SampleChip}/>`:null}</header>
        ${topClass?html`<div class="kpi-main">
          <strong class="num kpi-big">${topClass.time}</strong>
          <em>${topClass.name}${topClass.penText?' · '+topClass.penText:''}</em>
          ${best?html`<em>개인 최고 ${fmtCs(best.finalCs)} · ${best.name}</em>`:null}
        </div>`:best?html`<div class="kpi-main">
          <strong class="muted">완주한 학급 없음</strong>
          <em>개인 최고 ${fmtCs(best.finalCs)} · ${best.name}</em>
        </div>`:html`<div class="kpi-main"><strong class="muted">기록 없음</strong></div>`}
<button class="kpi-link" onClick=${()=>navigate('top10')}>TOP 10 보기 →</button>
      </section>
    </div>
    <div class="grid-2">
<${RankBoard} title="학급 TOP 10" rows=${data.class} empty="완주한 학급이 아직 없습니다" right=${html`<button class="btn btn-sm btn-ghost" onClick=${()=>navigate('ranking')}>전체 순위</button>`}/>
      <${Panel} title=${todays.length?'오늘의 경기 현황':(nextDay?fmtDateKo(nextDay.date)+' 경기 현황':'오늘의 경기 현황')} flush right=${html`<span class="dim">${fmtDateKo(today)}</span>`}>
        ${dayList.length?html`<div class="tbl-wrap"><table class="tbl tbl-compact">
          <thead><tr><th>시간</th><th>경기</th><th>참가 학급</th><th>상태</th></tr></thead>
          <tbody>${dayList.map(m=>html`<tr key=${m.id} class=${can?'tr-link':''} onClick=${()=>{if(!can)return;opsGo(m);}}>
            <td class="num">${m.delayMin>0?html`<s class="dim">${m.time}</s> `:null}${effectiveTimeStr(m)}</td>
            <td><strong>${m.title}</strong>${m.sample?html` <${SampleChip}/>`:null}</td>
            <td>${(m.classIds||[]).map(id=>Store.doc('classes',id)).filter(Boolean).map(c=>html`<span class="mini-class" key=${c.id}>${classShort(c)}</span>`)}</td>
            <td><${StatusChip} s=${m.status}/> <${ScheduleFlags} m=${m}/></td>
          </tr>`)}</tbody>
        </table></div>`:html`<${EmptyState} title="오늘 예정된 경기가 없습니다."/>`}
      <//>
    </div>
    <div class="lr-boards">
      <${RankBoard} title="개인 전체 TOP 10" rows=${data.all}/>
      <${RankBoard} title="남자 TOP 10" rows=${data.male}/>
      <${RankBoard} title="여자 TOP 10" rows=${data.female}/>
    </div>
    ${grades.length?html`<div class="lr-boards">${grades.map(g=>html`<${RankBoard} key=${g} title=${g+'학년 TOP 10'} rows=${data['g'+g]}/>`)}</div>`:null}
  </div>`;
}

/* ---------- 경기 일정 ---------- */
/** 경기 추가 · 수정. 새 경기는 조를 고르면 그 조의 반이 시드 순서(= 기본 사로)로 들어간다. */
function MatchForm({match,onClose}){
  useStore();
  const isNew=!match.id;
  const gs=groupsList();
  const myKey=isNew?null:matchGroupKey(match);
  const started=!isNew&&matchStarted(match);
  const groupDoc=k=>{const g=gs.find(x=>x.key===k),seeds=g?g.seeds.filter(Boolean):[];return {title:k===myKey?match.title:groupMatchTitle(k),classIds:seeds,lanes:seedLanes(seeds)};};
  const firstKey=(()=>{
    if(!isNew) return myKey&&gs.some(g=>g.key===myKey)?myKey:'';
    if(match.groupKey&&gs.some(g=>g.key===match.groupKey)) return match.groupKey;
    const free=gs.find(g=>!groupMatches(g.key).length);
    return free?free.key:(gs[0]?gs[0].key:'');
  })();
  const [gk,setGk]=useState(firstKey);
  const [custom,setCustom]=useState(isNew?!firstKey:!myKey);
  const [d,setD]=useState(()=>({
    date:match.date||todayStr(),time:match.time||'',noDate:!isNew&&!match.date,noTime:!isNew&&!match.time,
    title:match.title||'',classIds:match.classIds||[],lanes:{...(match.lanes||{})},status:match.status||'tbd',
    delayMin:match.delayMin||0,delayReason:match.delayReason||'',note:match.note||'',
    ...(isNew&&firstKey?groupDoc(firstKey):{})
  }));
  const [reason,setReason]=useState('');
  const [err,setErr]=useState('');
  const set=p=>setD(x=>({...x,...p}));
  const st=CFG.settings();
  const classes=classesSorted().filter(c=>!sampleHidden()||!c.sample);
  const grades=[...new Set(classes.map(c=>c.grade))];
  const timeChanged=!isNew&&((d.noDate?'':d.date)!==(match.date||'')||(d.noTime?'':d.time)!==(match.time||''));
  const pickGroup=k=>{if(started) return;setGk(k);setCustom(false);set(groupDoc(k));setErr('');};
  const pickCustom=()=>{if(started) return;setGk('');setCustom(true);if(isNew||myKey) set({title:'',classIds:[],lanes:{}});setErr('');};
  const toggle=cid=>setD(x=>{
    if(x.classIds.includes(cid)){const lanes={...x.lanes};delete lanes[cid];return {...x,classIds:x.classIds.filter(y=>y!==cid),lanes};}
    const used=new Set(Object.values(x.lanes));
    let lane=1;while(used.has(lane))lane++;
    return {...x,classIds:[...x.classIds,cid],lanes:{...x.lanes,[cid]:lane}};
  });
  const dup=(()=>{const v=d.classIds.map(c=>d.lanes[c]);return new Set(v).size!==v.length;})();
  const customTitle=()=>{const n=Store.list('matches').filter(m=>!m.sample&&!matchGroupKey(m)).length;return '추가 경기 '+(n+1);};
  const save=()=>{
    if(!d.classIds.length){setErr(custom?'참가 학급을 한 개 이상 선택해 주세요.':'조를 골라 주세요.');return;}
    if(dup){setErr('같은 사로에 두 학급이 배정되어 있습니다.');return;}
    const title=d.title.trim()||(custom?customTitle():groupMatchTitle(gk));
    const doc={title,groupKey:custom?null:gk,date:d.noDate?'':d.date,time:d.noTime?'':d.time,classIds:d.classIds,lanes:d.lanes,note:d.note};
    if(!isNew){Object.assign(doc,{status:d.status,delayMin:+d.delayMin||0,delayReason:d.delayReason});if(d.status==='done'&&!match.finishedAt) doc.finishedAt=Live.now();}
    if(isNew){
      const id=uid('m_');
      Store.set('matches',id,{id,...doc,status:'tbd',delayMin:0,delayReason:'',notes:{},changes:[],changed:false,seq:Date.now(),sample:false,startedAt:null,finishedAt:null,lanesOk:false});
      toast(title+' 경기를 만들었습니다. 「경기 운영」에서 사로 배정부터 진행합니다.','ok');
      ActLog.add('경기 일정 추가: '+title+' '+[doc.date,doc.time].filter(Boolean).join(' '));
    }else{
      if(timeChanged){
        const ch={from:{date:match.date||'',time:match.time||''},to:{date:doc.date,time:doc.time},at:Live.now(),by:LR.recorder(),reason};
        doc.changes=[...(match.changes||[]),ch];doc.changed=true;
      }
      const lanesChanged=JSON.stringify(doc.classIds)!==JSON.stringify(match.classIds||[])||doc.classIds.some(c=>doc.lanes[c]!==(match.lanes||{})[c]);
      const {classIds,lanes,...rest}=doc;
      Store.merge('matches',match.id,rest);
      if(lanesChanged&&!started) applyLanes(match,classIds,lanes,{lanesOk:false});
      ActLog.add('경기 일정 수정: '+title+(timeChanged?' ('+[match.date,match.time].filter(Boolean).join(' ')+' → '+[doc.date,doc.time].filter(Boolean).join(' ')+')':''),{sample:match.sample});
      toast('경기 일정을 저장했습니다. TV 화면에도 바로 반영됩니다.','ok');
    }
    onClose();
  };
  const remove=async()=>{if(await confirmDeleteMatch(match)) onClose();};
  const sel=gs.find(g=>g.key===gk);
  return html`<${Modal} title=${isNew?'경기 추가':'경기 수정 · '+match.title} wide onClose=${onClose} footer=${html`
    ${!isNew?html`<button class="btn btn-danger-ghost foot-left" onClick=${remove}><${Icon} n="trash" s=${14}/> 경기 삭제</button>`:null}
    ${err?html`<span class="field-error foot-err">${err}</span>`:null}
    <button class="btn" onClick=${onClose}>취소</button>
    <button id="match-save" class="btn btn-primary" onClick=${save}>${isNew?'경기 만들기':'저장'}</button>`}>
    <h4 class="form-sub mf-sub">${isNew?'1. 조 선택':'조'}${started?html` <span class="chip">시작한 경기는 학급을 바꿀 수 없습니다</span>`:null}</h4>
    ${gs.length?html`<div class="mg-grid">
      ${gs.map(g=>{const n=groupMatches(g.key).filter(x=>x.id!==match.id).length;return html`<button type="button" key=${g.key} id=${'mg-'+g.key} class=${'mg-card'+(!custom&&gk===g.key?' on':'')} disabled=${started} onClick=${()=>pickGroup(g.key)}>
        <span class="mg-top"><b>${g.key}조</b><small class=${n?'':'dim'}>${n?'경기 '+n+'개 있음':'아직 경기 없음'}</small></span>
        <span class="mg-logos">${g.seeds.filter(Boolean).map(cid=>{const c=Store.doc('classes',cid);return c?html`<${Logo} key=${cid} cls=${c} size="24px"/>`:null;})}</span>
      </button>`;})}
      <button type="button" class=${'mg-card mg-custom'+(custom?' on':'')} disabled=${started} onClick=${pickCustom}><span class="mg-top"><b>직접 고르기</b><small class="dim">번외 · 재경기</small></span><span class="mg-logos dim">학급을 하나씩 선택</span></button>
    </div>`:html`<div class="banner small lr-banner"><span>아직 조 추첨 전입니다.</span><button class="linkish lr-banner-act" onClick=${()=>{onClose();LS.set('ui.teamsTab','groups');navigate('teams');}}>팀 · 선수 › 조 추첨으로 →</button><span class="dim">또는 아래에서 학급을 직접 고르세요.</span></div>`}
    <h4 class="form-sub mf-sub">${isNew?'2. 날짜 · 시간':'날짜 · 시간'}</h4>
    <div class="form-grid">
      <${Field} label="경기 이름" hint=${custom?'비우면 「추가 경기 N」으로 붙습니다.':'조를 고르면 자동으로 붙습니다(같은 조 두 번째 경기는 「2차」).'} grow>
        <input id="match-title" value=${d.title} onInput=${e=>set({title:e.target.value})} placeholder=${custom?customTitle():groupMatchTitle(gk||'A')}/>
      <//>
      <${Field} label="날짜">
        <input id="match-date" type="date" value=${d.date} disabled=${d.noDate} onInput=${e=>set({date:e.target.value})}/>
      <//>
      <${Field} label="시간">
        <input id="match-time" type="time" value=${d.time} disabled=${d.noTime} onInput=${e=>set({time:e.target.value})}/>
      <//>
      <label class="check-line"><input id="match-notime" type="checkbox" checked=${d.noTime} onChange=${e=>set({noTime:e.target.checked})}/> 시간 미정</label>
      ${!isNew?html`
      <${Field} label="경기 상태">
        <select id="match-status" value=${d.status} onChange=${e=>set({status:e.target.value})}>
          <option value="tbd">미정</option><option value="live">진행</option><option value="done">종료</option>
        </select>
      <//>
      <${Field} label="지연 (분)">
        <input id="match-delay" type="number" min="0" step="5" value=${d.delayMin} onInput=${e=>set({delayMin:e.target.value})}/>
      <//>
      <${Field} label="지연 사유" grow>
        <input id="match-delay-reason" value=${d.delayReason} onInput=${e=>set({delayReason:e.target.value})} placeholder="앞 경기 지연, 우천 등"/>
      <//>`:null}
      ${timeChanged?html`<${Field} label="일정 변경 사유" grow hint="변경 전후 시각과 함께 저장되어 일정표에 “일정 변경”으로 표시됩니다.">
        <input id="match-change-reason" value=${reason} onInput=${e=>setReason(e.target.value)}/>
      <//>`:null}
    </div>
    ${custom?html`
      <h4 class="form-sub mf-sub">참가 학급 · 사로</h4>
      ${classes.length?html`<div class="class-pick">
        ${grades.map(g=>html`<div class="class-pick-row" key=${g}>
          <span class="class-pick-grade">${g}학년</span>
          <div>${classes.filter(c=>c.grade===g).map(c=>html`<button type="button" key=${c.id} class="pickbtn ${d.classIds.includes(c.id)?'on':''}" disabled=${started} onClick=${()=>toggle(c.id)}>${c.num}반${c.sample?' *':''}</button>`)}</div>
        </div>`)}
      </div>`:html`<${EmptyState} title="등록된 학급이 없습니다.">팀 · 선수 › 참가 반에서 먼저 학급을 골라 주세요.<//>`}
      ${d.classIds.length?html`<div class="lane-assign">
        ${d.classIds.map(cid=>{const c=Store.doc('classes',cid);return html`<label key=${cid}>
          <${Logo} cls=${c}/> ${className(c)}
          <i class="lane-dot" style=${'background:'+vestColor(d.lanes[cid])}></i>
          <select value=${d.lanes[cid]} disabled=${started} onChange=${e=>set({lanes:{...d.lanes,[cid]:+e.target.value}})}>
            ${Array.from({length:Math.max(st.laneCount,d.classIds.length)},(_,i)=>html`<option key=${i} value=${i+1}>${i+1}사로</option>`)}
          </select>
        </label>`;})}
        ${dup?html`<span class="field-error">같은 사로에 두 학급이 있습니다.</span>`:null}
      </div>`:null}`
    :sel?html`<div class="mf-lineup">
      <span class="dim small">${isNew?'참가 학급 · 기본 사로(시드 순서)':'참가 학급 · 사로'}</span>
      <div>${d.classIds.slice().sort((a,b)=>(d.lanes[a]||99)-(d.lanes[b]||99)).map(cid=>{const c=Store.doc('classes',cid);return c?html`<span key=${cid} class="mf-l"><i style=${vestStyle(d.lanes[cid])}>${d.lanes[cid]}</i><${Logo} cls=${c} size="22px"/>${className(c)}</span>`:null;})}</div>
      <p class="dim small">사로는 경기 직전 「경기 운영 › ① 사로 배정」에서 랜덤으로 바꿀 수 있습니다.</p>
    </div>`:null}
    <${Field} label="비고" grow>
      <input id="match-note" value=${d.note} onInput=${e=>set({note:e.target.value})} placeholder="집합 장소 등"/>
    <//>
  <//>`;
}
/** 경기 삭제(일정표 · 수정 창 공용). 기록이 있으면 함께 지워진다고 알린다. */
async function confirmDeleteMatch(m){
  const count=allRecords().filter(r=>r.matchId===m.id).length;
  const ok=await askConfirm({title:'경기 삭제',body:m.title+(m.date?' ('+fmtDateKo(m.date,false)+' '+effectiveTimeStr(m)+')':'')+' 경기를 삭제합니다.'+(count?' 이 경기의 기록 '+count+'건도 함께 삭제되어 순위에서 빠집니다.':' 조 편성은 그대로 남아 언제든 다시 만들 수 있습니다.'),ok:'삭제',danger:true});
  if(ok){Actions.deleteMatch(m.id);toast(m.title+' 경기를 삭제했습니다.','ok');}
  return ok;
}
const opsGo=m=>{LS.set('ui.match',m.id);LS.set('ui.opsGo',m.status==='live'?'live':m.status==='done'?'finish':null);navigate('ops');};
function ScheduleTable({rows,onEdit}){
  const can=Store.canWrite();
  return html`<div class="tbl-wrap"><table class="tbl sched-tbl">
    <thead><tr><th class="c-time">시간</th><th>경기</th><th>참가 학급 (사로 순)</th><th>상태</th><th>일정 변경 · 지연</th><th>비고</th>${can?html`<th class="c-act">관리</th>`:null}</tr></thead>
    <tbody>${rows.map(m=>{
      const lastCh=(m.changes||[])[(m.changes||[]).length-1];
      const cs=(m.classIds||[]).map(id=>Store.doc('classes',id)).filter(Boolean).sort((a,b)=>((m.lanes||{})[a.id]||99)-((m.lanes||{})[b.id]||99));
      return html`<tr key=${m.id}>
        <td class="c-time"><span class="num strong">${effectiveTimeStr(m)}</span>${m.delayMin>0&&m.time?html`<s class="dim num">${m.time}</s>`:null}</td>
        <td><strong>${m.title}</strong>${m.sample?html` <${SampleChip}/>`:null}</td>
        <td><div class="cls-row">${cs.map(c=>html`<span class="cls-in" key=${c.id} title=${((m.lanes||{})[c.id]||'-')+'사로'}><${Logo} cls=${c} plain/>${classShort(c)}</span>`)}</div></td>
        <td><${StatusChip} s=${m.status}/></td>
        <td>
          <${ScheduleFlags} m=${m}/>
          ${m.delayMin>0&&m.delayReason?html`<div class="sub dim">${m.delayReason}</div>`:null}
          ${lastCh?html`<div class="sub dim">${lastCh.from.date!==lastCh.to.date?fmtDateKo(lastCh.from.date,false)+' ':''}${lastCh.from.time||'미정'} → ${lastCh.to.date!==lastCh.from.date?fmtDateKo(lastCh.to.date,false)+' ':''}${lastCh.to.time||'미정'}${lastCh.reason?' · '+lastCh.reason:''}</div>`:null}
        </td>
        <td class="dim">${m.note||''}</td>
        ${can?html`<td class="c-act"><div class="row-act">
          <button class=${'btn btn-sm '+(m.status==='live'?'btn-live':m.status==='done'?'':'btn-primary')} onClick=${()=>opsGo(m)}>${m.status==='live'?'계측 화면 →':m.status==='done'?'결과 · 서명 →':'경기 운영 →'}</button>
          ${m.status!=='done'?html`<button class="btn btn-sm btn-ghost" title="10분 지연" onClick=${()=>{Store.merge('matches',m.id,{delayMin:(m.delayMin||0)+10});ActLog.add(m.title+' 시작 '+((m.delayMin||0)+10)+'분 지연',{sample:m.sample});}}>+10분</button>`:null}
          ${m.delayMin>0?html`<button class="btn btn-sm btn-ghost" onClick=${()=>{Store.merge('matches',m.id,{delayMin:0,delayReason:''});ActLog.add(m.title+' 지연 해제',{sample:m.sample});}}>지연 해제</button>`:null}
          <button class="btn btn-sm" onClick=${()=>onEdit(m)}><${Icon} n="edit" s=${14}/> 수정</button>
          <button class="icon-btn row-del" aria-label=${m.title+' 삭제'} title="경기 삭제" onClick=${()=>confirmDeleteMatch(m)}><${Icon} n="trash" s=${15}/></button>
        </div></td>`:null}
      </tr>`;
    })}</tbody>
  </table></div>`;
}
function SchedulePage(){
  useStore();
  const now=useNow(10000);
  const [dateF,setDateF]=useState('all');
  const [cal,setCal]=useState(false);
  const [gradeF,setGradeF]=useState('all');
  const [classF,setClassF]=useState('all');
  const [grpF,setGrpF]=useState(()=>{const v=LS.get('ui.schGroup',null);if(v)LS.set('ui.schGroup',null);return v||'all';});
  const [edit,setEdit]=useState(null);
  useEffect(()=>{const k=LS.get('ui.newMatchGroup',null);if(k){LS.set('ui.newMatchGroup',null);setEdit({groupKey:k});}},[]);
  const ms=scopedMatches();
  const gs=groupsList();
  const noMatch=gs.filter(g=>!groupMatches(g.key).length);
  const can=Store.canWrite();
  const makeAll=()=>{
    noMatch.forEach((g,i)=>{
      const id=uid('m_'),seeds=g.seeds.filter(Boolean);
      Store.set('matches',id,{id,title:g.key+'조',groupKey:g.key,date:'',time:'',classIds:seeds,lanes:seedLanes(seeds),status:'tbd',delayMin:0,delayReason:'',note:'',notes:{},changes:[],changed:false,seq:Date.now()+i,sample:false,startedAt:null,finishedAt:null,lanesOk:false});
    });
    ActLog.add('조별 경기 만들기: '+noMatch.map(g=>g.key+'조').join(', '));
    toast(noMatch.length+'개 조의 경기를 만들었습니다. 「날짜 미정」 목록에서 「수정」을 눌러 날짜와 시간을 정하세요.','ok');
  };
  const classes=classesSorted().filter(c=>!sampleHidden()||!c.sample);
  const grades=[...new Set(classes.map(c=>c.grade))];
  const filtered=ms.filter(m=>{
    if(dateF!=='all'&&(m.date||'')!==dateF) return false;
    const cs=(m.classIds||[]).map(id=>Store.doc('classes',id)).filter(Boolean);
    if(gradeF!=='all'&&!cs.some(c=>String(c.grade)===gradeF)) return false;
    if(classF!=='all'&&!(m.classIds||[]).includes(classF)) return false;
    if(grpF!=='all'&&matchGroupKey(m)!==grpF) return false;
    return true;
  });
  const groups=[...new Set(filtered.map(m=>m.date||''))].sort((a,b)=>(a||'9')>(b||'9')?1:-1);
  const next=nextMatch(ms,now);
  const today=todayStr();
  // 날짜: 어제 · 오늘 · 내일은 바로 누르고, 그 밖의 날은 달력에서 고른다(경기 있는 날에 개수 표시)
  const shiftDay=n=>{const [y,mo,d]=today.split('-').map(Number);return ymd(new Date(y,mo-1,d+n));};
  const quick=[['어제',shiftDay(-1)],['오늘',today],['내일',shiftDay(1)]];
  const marks={};
  ms.forEach(m=>{if(!m.date) return;const k=marks[m.date]||(marks[m.date]={n:0,live:false});k.n++;if(m.status==='live')k.live=true;});
  const other=dateF!=='all'&&!quick.some(q=>q[1]===dateF);
  const pickDay=d=>{setDateF(d||'all');setCal(false);};
  return html`<div class="page">
    <div class="toolbar">
      <div class="seg lr-dayseg">
        <button aria-pressed=${String(dateF==='all')} onClick=${()=>setDateF('all')}>전체</button>
        ${quick.map(([label,d])=>html`<button key=${label} aria-pressed=${String(dateF===d)} onClick=${()=>setDateF(d)}>${label}<small>${fmtDateKo(d,false).replace('월 ','/').replace('일','')}</small>${marks[d]?html`<i class="lr-daycnt">${marks[d].n}</i>`:null}</button>`)}
      </div>
      <div class="datebox lr-datebox">
        <button type="button" id="sch-cal" class=${'date-btn'+(other?' on':'')} data-cal-toggle aria-expanded=${String(cal)} onClick=${()=>setCal(!cal)}>
          <${Icon} n="calendar" s=${16}/><span>${other?fmtDateKo(dateF):'달력에서 날짜 선택'}</span></button>
        ${cal?html`<${SUI.MiniCal} value=${dateF==='all'?'':dateF} marks=${marks} onPick=${pickDay} onClose=${()=>setCal(false)}/>`:null}
      </div>
      ${gs.length?html`<select id="sch-group" class="select" aria-label="조" value=${grpF} onChange=${e=>setGrpF(e.target.value)}>
        <option value="all">전체 조</option>
        ${gs.map(g=>html`<option key=${g.key} value=${g.key}>${g.key}조</option>`)}
      </select>`:null}
      <select id="sch-grade" class="select" aria-label="학년" value=${gradeF} onChange=${e=>{setGradeF(e.target.value);setClassF('all');}}>
        <option value="all">전체 학년</option>
        ${grades.map(g=>html`<option key=${g} value=${String(g)}>${g}학년</option>`)}
      </select>
      <select id="sch-class" class="select" aria-label="반" value=${classF} onChange=${e=>setClassF(e.target.value)}>
        <option value="all">전체 반</option>
        ${classes.filter(c=>gradeF==='all'||String(c.grade)===gradeF).map(c=>html`<option key=${c.id} value=${c.id}>${className(c)}</option>`)}
      </select>
      <span class="spacer"></span>
      <div class="legend">
        <span><i class="lg lg-live"></i>진행</span><span><i class="lg lg-done"></i>종료</span><span><i class="lg lg-tbd"></i>미정</span>
      </div>
      ${can&&noMatch.length?html`<button id="sch-makeall" class="btn" onClick=${makeAll} title=${noMatch.map(g=>g.key+'조').join(', ')}>조별 경기 한 번에 만들기 (${noMatch.length})</button>`:null}
      ${can?html`<button id="sch-add" class="btn btn-primary" onClick=${()=>setEdit({})}><${Icon} n="plus" s=${15}/> 경기 추가</button>`:null}
    </div>
    ${can&&!gs.length?html`<div class="lr-next"><span><b>먼저 조 추첨</b> 조를 정하면 「경기 추가」에서 조만 고르면 반과 사로가 한 번에 들어갑니다.</span><button class="btn btn-primary" onClick=${()=>{LS.set('ui.teamsTab','groups');navigate('teams');}}>팀 · 선수 › 조 추첨 →</button></div>`:null}
    ${next?html`<div class="tv-preview-line">
      <span class="kicker">TV 안내 문구</span>
      <span>${announceText(next,now)}</span>
    </div>`:null}
    ${groups.length?groups.map(g=>html`<${Panel} key=${g} title=${g?fmtDateKo(g,false)+' 경기':'날짜 미정'} flush right=${html`<span class="dim">${g===today?'오늘 · ':''}${filtered.filter(m=>(m.date||'')===g).length}경기</span>`}>
      <${ScheduleTable} rows=${filtered.filter(m=>(m.date||'')===g)} onEdit=${setEdit}/>
    <//>`):html`<${Panel}><${EmptyState} title=${dateF!=='all'?fmtDateKo(dateF)+'에는 경기가 없습니다.':'표시할 경기가 없습니다.'} action=${Store.canWrite()?html`<span style="display:inline-flex;gap:8px">${dateF!=='all'?html`<button class="btn" onClick=${()=>setDateF('all')}>전체 날짜 보기</button>`:null}<button class="btn btn-primary" onClick=${()=>setEdit({})}>경기 추가</button></span>`:dateF!=='all'?html`<button class="btn" onClick=${()=>setDateF('all')}>전체 날짜 보기</button>`:null}>${Store.canWrite()?'경기 추가 버튼으로 일정을 등록하거나 필터를 바꿔 보세요.':'일정이 등록되면 이곳에 표시됩니다.'}<//><//>`}
    ${edit?html`<${MatchForm} key=${edit.id||'new'} match=${edit} onClose=${()=>setEdit(null)}/>`:null}
  </div>`;
}

/* ---------- 경기 관리 ---------- */
function useCurrentMatch(){
  const [mid,setMid]=useLocal('ui.match',null);
  const list=scopedMatches();
  const kept=useRef(null); // 직접 고르지 않았어도, 보고 있던 경기가 끝났다고 다른 경기로 넘어가지 않는다
  let m=mid&&Store.doc('matches',mid);
  if(!m) m=list.find(x=>x.status==='live')||list.find(x=>x.id===kept.current)||nextMatch(list,Live.now())||list[list.length-1]||null;
  kept.current=m?m.id:null;
  return [m,setMid,list];
}
function MatchPicker({list,value,onChange}){
  return html`<select id="match-picker" class="select sel-strong" aria-label="경기 선택" value=${value&&value.id} onChange=${e=>onChange(e.target.value)}>
    ${list.map(m=>html`<option key=${m.id} value=${m.id}>[${(STATUS[m.status]||STATUS.tbd).t}] ${m.date?fmtDateKo(m.date,false)+' ':''}${effectiveTimeStr(m)} · ${m.title}${m.sample?' (예시)':''}</option>`)}
  </select>`;
}
/* ==========================================================================
   [3] 경기 운영 — 경기를 고르고 ① 사로 배정 → ② 명단 · 순서 확인 → ③ 실시간 계측 → ④ 서명 · 종료.
   기록 수정 · 수정 이력 · 현장 TV도 여기서 연다. (예전 「경기 관리」와 「기록 관리」를 합쳤다)
   ========================================================================== */
const OPS_STEPS=[['lanes','사로 배정'],['roster','명단 · 순서 확인'],['live','실시간 계측'],['finish','서명 · 종료']];
function opsDefaultStep(m){
  if(!m) return 'lanes';
  if(m.status==='done') return 'finish';
  if(m.status==='live'||matchStarted(m)) return 'live';
  return m.lanesOk?'roster':'lanes';
}
function opsStepState(m,runs,st){
  const started=matchStarted(m);
  const checked=runs.length>0&&runs.every(r=>(r.order||[]).length>0&&(r.order||[]).every(p=>r.check&&r.check[p]));
  const allFin=runs.length>0&&runs.every(r=>teamResult(r,st).complete);
  const signed=runs.length>0&&runs.every(r=>okSign(Signs.of(r.id),r,st));
  return {lanes:!!m.lanesOk||started,roster:checked||started,live:m.status==='done'||allFin,finish:m.status==='done'&&signed};
}
/** ① 사로 배정: 기본은 조의 시드 순서. 랜덤 배정 · 두 사로를 눌러 맞바꾸기 · 확정 */
function LaneStep({m,onNext}){
  useStore();
  const st=CFG.settings();
  const started=matchStarted(m);
  const ids=m.classIds||[];
  const n=Math.max(st.laneCount||6,ids.length);
  const [sel,setSel]=useState(null);
  const [roll,setRoll]=useState(null); // 랜덤 배정 연출 중 잠깐 보이는 배치 {사로:반}
  const gk=matchGroupKey(m),grp=gk&&groupsList().find(g=>g.key===gk);
  const byLane={};
  ids.forEach(cid=>{const l=(m.lanes||{})[cid];if(l&&!byLane[l])byLane[l]=cid;});
  const shown=roll||byLane;
  const lanesFrom=bl=>{const o={};Object.entries(bl).forEach(([l,cid])=>{if(cid)o[cid]=+l;});return o;};
  const logLanes=(lanes,how)=>ActLog.add(m.title+' 사로 '+how+': '+ids.slice().sort((a,b)=>(lanes[a]||99)-(lanes[b]||99)).map(cid=>(lanes[cid]||'-')+'사로 '+classShort(Store.doc('classes',cid))).join(', '),{sample:m.sample});
  const save=(lanes,how)=>{applyLanes(m,ids,lanes,{lanesOk:false});logLanes(lanes,how);};
  const tap=l=>{
    if(started||roll) return;
    if(sel==null){if(byLane[l]) setSel(l);return;}
    if(sel===l){setSel(null);return;}
    const bl={...byLane},a=bl[sel],b=bl[l];
    bl[l]=a;bl[sel]=b;
    save(lanesFrom(bl),'맞바꿈');setSel(null);
  };
  const shuffle=a=>{const x=[...a];for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];}return x;};
  const random=async()=>{
    if(started||roll||!ids.length) return;
    setSel(null);
    const k=ids.length,slots=Array.from({length:k},(_,i)=>i+1);
    for(let f=0;f<12;f++){
      const p=shuffle(ids),bl={};slots.forEach((l,i)=>{bl[l]=p[i];});
      setRoll(bl);await sleep(70+f*12);
    }
    const p=shuffle(ids),bl={};slots.forEach((l,i)=>{bl[l]=p[i];});
    setRoll(null);save(lanesFrom(bl),'랜덤 배정');
    toast('사로를 랜덤으로 배정했습니다.','ok',1800);
  };
  const seedOrder=()=>{if(!grp) return;const seeds=grp.seeds.filter(cid=>ids.includes(cid));const lanes=seedLanes(seeds);ids.forEach(cid=>{if(!lanes[cid]){let l=1;while(Object.values(lanes).includes(l))l++;lanes[cid]=l;}});save(lanes,'시드 순서로');};
  const missing=ids.filter(cid=>!(m.lanes||{})[cid]);
  const dupLane=Object.values(m.lanes||{}).filter(Boolean).length!==new Set(Object.entries(m.lanes||{}).filter(([c,l])=>l&&ids.includes(c)).map(([,l])=>l)).size;
  const ok=!missing.length&&!dupLane&&ids.length>0;
  return html`<${Panel} title="① 사로 배정" kicker=${grp?gk+'조 · 시드 번호가 기본 사로':'참가 학급 '+ids.length+'개'} right=${Store.canWrite()&&!started?html`
      ${grp?html`<button class="btn btn-sm btn-ghost" disabled=${!!roll} onClick=${seedOrder}>시드 순서로</button>`:null}
      <button id="ops-lane-rand" class="btn" disabled=${!!roll||!ids.length} onClick=${random}><${Icon} n="reset" s=${15}/> 사로 랜덤 배정</button>`:null}>
    <p class="dim small ops-help">${started?'경기가 시작되어 사로를 바꿀 수 없습니다.':sel!=null?html`<b>${sel}사로</b>와 바꿀 사로를 누르세요. <button type="button" class="linklike" onClick=${()=>setSel(null)}>취소</button>`:'두 사로를 차례로 누르면 서로 바뀝니다. 「사로 랜덤 배정」을 누르면 반을 섞어 다시 배정합니다.'}</p>
    <div class=${'ln-grid'+(roll?' rolling':'')} style=${'--n:'+n}>
      ${Array.from({length:n},(_,i)=>{
        const l=i+1,cid=shown[l],c=cid&&Store.doc('classes',cid),seed=grp&&cid?grp.seeds.indexOf(cid)+1:0;
        return html`<button type="button" key=${l} class=${'ln-card'+(c?'':' empty')+(sel===l?' on':'')+(sel!=null&&sel!==l?' target':'')} style=${vestStyle(l)} disabled=${started||!Store.canWrite()||(!c&&sel==null)} onClick=${()=>tap(l)}>
          <span class="ln-no">${l}<small>사로</small></span>
          ${c?html`<${Logo} cls=${c} size="54px"/><b>${className(c)}</b><small class="dim">${seed?gk+'조 '+seed+'번 시드':(c.players||[]).length+'명'}</small>`:html`<b class="dim">비어 있음</b>`}
        </button>`;
      })}
    </div>
    ${missing.length?html`<p class="field-error">사로가 없는 학급: ${missing.map(cid=>className(Store.doc('classes',cid))).join(', ')} — 「사로 랜덤 배정」을 눌러 주세요.</p>`:null}
  <//>
  <div class="lr-next">
    <span>${started?'경기가 이미 시작되었습니다.':m.lanesOk?html`<b>사로 확정됨</b> 다음은 선수 명단과 출전 순서를 확인합니다.`:html`<b>다음 단계</b> 사로가 맞으면 확정하고 선수 명단을 확인하세요.`}</span>
    <button id="ops-lane-ok" class="btn btn-primary" disabled=${!ok&&!started} onClick=${()=>{if(!started&&!m.lanesOk){Store.merge('matches',m.id,{lanesOk:true});logLanes(m.lanes||{},'확정');}onNext();}}>${started||m.lanesOk?'명단 · 순서 확인으로 →':'사로 확정 · 명단 확인 →'}</button>
  </div>`;
}
/** ② 명단 · 순서 확인: 반마다 출전 순서(↑↓ · 남녀 교대)와 참가 확인 */
function RosterStep({m,onStart}){
  useStore();
  const st=CFG.settings();
  const runs=runsOfMatch(m);
  const started=matchStarted(m);
  const can=Store.canWrite();
  const move=(run,i,dir)=>{const o=[...run.order],j=i+dir;[o[i],o[j]]=[o[j],o[i]];Actions.saveOrder(m,run.classId,o);};
  const alternate=(run,cls,first)=>{
    const done=(run.order||[]).filter((_,i)=>{const l=legOf(run,i);return l&&(l.t0!=null||l.manual);});
    const rest=(run.order||[]).filter(id=>!done.includes(id));
    const a=rest.filter(id=>{const p=playerOf(cls,id);return p&&p.gender===first;}),b=rest.filter(id=>!a.includes(id));
    const out=[...done];
    while(a.length||b.length){if(a.length)out.push(a.shift());if(b.length)out.push(b.shift());}
    Actions.saveOrder(m,run.classId,out);
  };
  const check=(run,pid,on)=>{
    const r=materializeRun(m,run.classId);
    Store.merge('runs',r.id,{check:{[pid]:on}});
    const c=Store.doc('classes',run.classId),p=playerOf(c,pid);
    ActLog.add('참가 확인: '+m.title+' · '+className(c)+' '+(p?p.name:'')+(on?' 확인':' 확인 취소'),{sample:m.sample,key:'chk|'+r.id+'|'+pid,wait:2000});
  };
  const checkAll=run=>{
    const r=materializeRun(m,run.classId);
    Store.merge('runs',r.id,{check:Object.fromEntries((r.order||[]).map(p=>[p,true]))});
    ActLog.add('참가 확인: '+m.title+' · '+className(Store.doc('classes',run.classId))+' 전원 확인',{sample:m.sample});
  };
  const ready=runs.filter(r=>(r.order||[]).length&&(r.order||[]).every(p=>r.check&&r.check[p])).length;
  const empty=runs.filter(r=>!(r.order||[]).length);
  return html`<div class="ops-roster">${runs.map(run=>{
      const cls=Store.doc('classes',run.classId);
      const n=(run.order||[]).length,ck=(run.order||[]).filter(p=>run.check&&run.check[p]).length;
      const locked=i=>{const l=legOf(run,i);return !!(l&&(l.t0!=null||l.manual));};
      return html`<${Panel} key=${run.id} flush class=${'ops-rcard'+(n&&ck===n?' ok':'')} title=${html`<span class="panel-class"><span class="lane-tag" style=${vestStyle(run.lane)}>${run.lane}사로</span><${Logo} cls=${cls}/>${className(cls)}</span>`}
        right=${html`<span class=${'chip '+(n&&ck===n?'ok':'')}>확인 ${ck}/${n}</span>`}>
        ${n?html`
          ${can?html`<div class="order-tools">
            <button class="btn btn-sm" disabled=${ck===n} onClick=${()=>checkAll(run)}><${Icon} n="check" s=${13}/> 전원 확인</button>
            <button class="btn btn-sm btn-ghost" onClick=${()=>alternate(run,cls,'M')}>남녀 교대 (남 먼저)</button>
            <button class="btn btn-sm btn-ghost" onClick=${()=>alternate(run,cls,'F')}>(여 먼저)</button>
            ${rosterIssue(cls)?html`<span class="chip chip-delay">${rosterIssue(cls)}</span>`:null}
          </div>`:null}
          <ol class="order-list ops-olist">${(run.order||[]).map((pid,i)=>{
            const p=playerOf(cls,pid),on=!!(run.check&&run.check[pid]);
            return html`<li key=${pid} class=${locked(i)?'locked':''}>
              <span class="order-no num">${i+1}</span>
              <strong>${p?p.name:'(명단에 없음)'}</strong> <${GenderTag} g=${p&&p.gender}/>
              <span class="spacer"></span>
              <button class=${'checkbtn '+(on?'on':'')} aria-pressed=${on} disabled=${!can} onClick=${()=>check(run,pid,!on)}>${on?html`<${Icon} n="check" s=${13}/> 확인`:'미확인'}</button>
              ${locked(i)?html`<span class="dim small">출발함</span>`:can?html`
                <button class="icon-btn" aria-label=${(p?p.name:'')+' 앞으로'} disabled=${i===0||locked(i-1)} onClick=${()=>move(run,i,-1)}><${Icon} n="up" s=${15}/></button>
                <button class="icon-btn" aria-label=${(p?p.name:'')+' 뒤로'} disabled=${i===n-1} onClick=${()=>move(run,i,1)}><${Icon} n="down" s=${15}/></button>`:null}
            </li>`;
          })}</ol>`
        :html`<${EmptyState} title="참가자가 등록되지 않았습니다." action=${html`<button class="btn" onClick=${()=>{LS.set('ui.teamsTab','roster');navigate('teams');}}>팀 · 선수에서 명단 등록 →</button>`}/>`}
      <//>`;
    })}</div>
    <div class="lr-next">
      <span>${started?'경기가 시작되었습니다.':html`<b>명단 확인 ${ready} / ${runs.length} 반</b>${empty.length?' · 명단 없는 반 '+empty.length+'개':''}${ready<runs.length&&!empty.length?' · 확인하지 않아도 시작할 수 있습니다':''}`}</span>
      ${started?html`<button class="btn btn-primary" onClick=${onStart}>실시간 계측으로 →</button>`
        :can?html`<button id="ops-start" class="btn btn-go btn-lg" disabled=${!runs.length} onClick=${()=>{Actions.startMatch(m.id);onStart();}}><${Icon} n="play" s=${17}/> 경기 시작</button>`:null}
    </div>`;
}
/** ④ 서명 · 종료: 주장 서명 · 경기별 특이사항 · 종료 */
function FinishStep({m,onSign}){
  useStore();
  const st=CFG.settings();
  const runs=runsOfMatch(m);
  const [noteText,setNoteText]=useState('');
  const can=Store.canWrite();
  const notes=Object.entries(m.notes||{}).filter(([,n])=>n).map(([id,n])=>({id,...n})).sort((a,b)=>b.at-a.at);
  const addNote=()=>{
    const text=noteText.trim();
    if(!text) return;
    const id=uid('n');
    if(Store.merge('matches',m.id,{notes:{[id]:{at:Live.now(),by:LR.recorder(),text}}})){setNoteText('');ActLog.add('특이사항 메모: '+m.title+' — '+text,{sample:m.sample});}
  };
  const nOk=runs.filter(r=>okSign(Signs.of(r.id),r,st)).length;
  const unfinished=runs.filter(r=>!teamResult(r,st).complete).length;
  return html`<${Panel} title="주장 서명" right=${html`<span class="dim">${nOk}/${runs.length} 학급</span><button id="sign-open" class="btn btn-sm" onClick=${()=>onSign(false)}>서명 받기</button>`}>
      <div class="lr-sign-row">${runs.map(r=>{
        const c=Store.doc('classes',r.classId),t=teamResult(r,st);
        return html`<span class="lr-sign-item" key=${r.id}><${Logo} cls=${c} size="22px"/>${classShort(c)} <span class="num dim">${t.complete?fmtCs(t.finalCs):t.done+'/'+t.n+' 완주'}</span> <${SignChip} run=${r} st=${st}/></span>`;
      })}</div>
    <//>
    <${Panel} title="경기별 특이사항">
      ${can?html`<div class="note-input">
        <textarea id="note-text" class="textarea" rows="2" placeholder="예: 3반 2번 주자 코스 이탈로 재출발 / 2사로 표적 교체" value=${noteText} onInput=${e=>setNoteText(e.target.value)}></textarea>
        <button id="note-add" class="btn btn-primary" onClick=${addNote}>기록</button>
      </div>`:null}
      ${notes.length?html`<ul class="notes">${notes.map(n=>html`<li key=${n.id}>
        <div><span class="num dim">${fmtStamp(n.at)}</span> <span class="dim">${n.by||''}</span><p>${n.text}</p></div>
        ${can?html`<button class="icon-btn" aria-label="삭제" onClick=${()=>{Store.merge('matches',m.id,{notes:{[n.id]:null}});ActLog.add('특이사항 메모 삭제: '+m.title,{sample:m.sample});}}><${Icon} n="trash" s=${15}/></button>`:null}
      </li>`)}</ul>`:html`<p class="dim empty-line">아직 기록된 특이사항이 없습니다.</p>`}
    <//>
    <div class="lr-next">
      <span>${m.status==='done'?html`<b>경기 종료</b> ${m.finishedAt?fmtClock(m.finishedAt)+' 종료 · ':''}순위와 TV에 반영되었습니다.`
        :html`<b>마무리</b> ${unfinished?'아직 완주하지 않은 학급 '+unfinished+'개 · ':''}주장 서명을 받고 경기를 종료합니다.`}</span>
      ${m.status==='done'?html`${can?html`<button class="btn" onClick=${()=>Actions.reopenMatch(m.id)}>진행으로 되돌리기</button>`:null}<button class="btn btn-primary" onClick=${()=>navigate('standings')}>순위 보기 →</button>`
        :can?html`<button id="m-finish" class="btn btn-stop" disabled=${m.status!=='live'} onClick=${()=>onSign(true)}><${Icon} n="stop" s=${15}/> 경기 종료</button>`:null}
    </div>`;
}
function OpsBody({m,onEdit,onDel,auditN,onSign,onReset,onVenue}){
  useStore();
  const st=CFG.settings();
  const runs=runsOfMatch(m);
  const done=opsStepState(m,runs,st);
  const [step,setStepRaw]=useState(()=>{const go=LS.get('ui.opsGo',null);if(go){LS.set('ui.opsGo',null);return go;}return (LS.get('ui.opsSteps',{})||{})[m.id]||opsDefaultStep(m);});
  const setStep=k=>{setStepRaw(k);try{const all=LS.get('ui.opsSteps',{})||{};all[m.id]=k;LS.set('ui.opsSteps',all);}catch(e){}window.scrollTo(0,0);};
  // 다른 기기에서 시작·종료해도 화면이 따라간다
  const prev=useRef(m.status);
  useEffect(()=>{
    const was=prev.current;prev.current=m.status;
    if(was===m.status) return;
    if(m.status==='live'&&(step==='lanes'||step==='roster')) setStep('live');
    else if(m.status==='done'&&step==='live') setStep('finish');
  },[m.status]);
  const can=Store.canWrite();
  const cs=(m.classIds||[]).map(id=>Store.doc('classes',id)).filter(Boolean).sort((a,b)=>((m.lanes||{})[a.id]||99)-((m.lanes||{})[b.id]||99));
  return html`<section class="panel ops-head">
      <div class="ops-title">
        <div class="match-head-title"><h2>${m.title}</h2><${StatusChip} s=${m.status}/><${ScheduleFlags} m=${m}/>${m.sample?html`<${SampleChip}/>`:null}</div>
        <p class="dim">${fmtDateKo(m.date)} ${effectiveTimeStr(m)}${m.startedAt?' · 시작 '+fmtClock(m.startedAt):''}${m.finishedAt?' · 종료 '+fmtClock(m.finishedAt):''}</p>
      </div>
      <div class="ops-teams">${cs.map(c=>html`<span key=${c.id} class="ops-team" title=${className(c)}><i style=${vestStyle((m.lanes||{})[c.id])}>${(m.lanes||{})[c.id]||'-'}</i><${Logo} cls=${c} size="26px"/>${classShort(c)}</span>`)}</div>
      <div class="match-actions">
        <button id="rec-venue" class="btn btn-venue" title="경기장 옆 TV에 사로별 현재 주자 · 랩타임을 크게 띄웁니다" onClick=${onVenue}><${Icon} n="full" s=${15}/> 현장 TV</button>
        ${can?html`<button class="btn btn-ghost" onClick=${onReset}><${Icon} n="reset" s=${14}/> 초기화</button>`:null}
      </div>
    </section>
    <nav class="ops-steps" aria-label="경기 진행 단계">
      ${OPS_STEPS.map(([k,label],i)=>html`<button type="button" key=${k} id=${'ops-step-'+k} class=${'ops-step'+(step===k?' on':'')+(done[k]?' ok':'')} aria-current=${step===k?'step':null} onClick=${()=>setStep(k)}>
        <span class="ops-sno">${done[k]&&step!==k?html`<${Icon} n="check" s=${14}/>`:i+1}</span><b>${label}</b>${k==='live'&&m.status==='live'?html`<i class="live-dot"></i>`:null}
      </button>`)}
      <span class="spacer"></span>
      <button type="button" class=${'ops-sub'+(step==='edit'?' on':'')} onClick=${()=>setStep('edit')}><${Icon} n="edit" s=${14}/> 기록 수정</button>
      <button type="button" class=${'ops-sub'+(step==='audit'?' on':'')} onClick=${()=>setStep('audit')}>수정 이력${auditN?html` <b>${auditN}</b>`:null}</button>
    </nav>
    ${step==='lanes'?html`<${LaneStep} m=${m} onNext=${()=>setStep('roster')}/>`:null}
    ${step==='roster'?html`<${RosterStep} m=${m} onStart=${()=>setStep('live')}/>`:null}
    ${step==='live'?html`<${ConsoleTab} m=${m} onEdit=${onEdit}/>
      <div class="lr-next"><span>${m.status==='done'?html`<b>경기 종료</b> 서명과 특이사항을 정리하세요.`:html`<b>다음 단계</b> 모든 주자가 들어오면 주장 서명을 받고 경기를 종료합니다.`}</span>
        <button class="btn btn-primary" onClick=${()=>setStep('finish')}>서명 · 종료로 →</button></div>`:null}
    ${step==='finish'?html`<${FinishStep} m=${m} onSign=${onSign}/>`:null}
    ${step==='edit'?html`<${RecordsTab} m=${m} onEdit=${onEdit} onDel=${onDel}/>`:null}
    ${step==='audit'?html`<${AuditTab}/>`:null}`;
}
function OpsPage(){
  useStore();
  const [m,setMid,list]=useCurrentMatch();
  const [edit,setEdit]=useState(null);
  const [del,setDel]=useState(null);
  const [reset,setReset]=useState(false);
  const [sign,setSign]=useState(null);
  const [venue,setVenue]=useState(false);
  const onEdit=useCallback((run,i)=>setEdit({run,i}),[]);
  const onDel=useCallback((run,i)=>setDel({run,i}),[]);
  const canW=Store.canWrite();
  const auditN=Store.list('audit').filter(a=>!sampleHidden()||!a.sample).length;
  const liveOther=list.find(x=>x.status==='live');
  if(venue&&m) return html`<${VenueTV} m=${m} list=${list} setMid=${setMid} onExit=${()=>setVenue(false)}/>`;
  if(!list.length) return html`<div class="page"><${Panel}><${EmptyState} title="아직 만든 경기가 없습니다." action=${html`<button class="btn btn-primary" onClick=${()=>navigate('schedule')}>경기 일정에서 경기 만들기 →</button>`}>「경기 일정 › 경기 추가」에서 조를 골라 경기를 만들면 여기서 사로 배정부터 기록까지 진행합니다.<//><//></div>`;
  return html`<div class="page ops">
    <div class="toolbar">
      <${MatchPicker} list=${list} value=${m} onChange=${setMid}/>
      <span class="spacer"></span>
      <${RecorderPicker}/>
    </div>
    ${m&&m.status!=='live'&&liveOther&&liveOther.id!==m.id?html`<div class="live-hint"><i class="live-dot"></i><span>지금 <b>${liveOther.title}</b> 경기가 진행 중입니다.</span><button class="btn btn-sm" onClick=${()=>setMid(liveOther.id)}>이 경기로 이동</button></div>`:null}
    ${m?html`<${OpsBody} key=${m.id} m=${m} onEdit=${onEdit} onDel=${canW?onDel:null} auditN=${auditN} onSign=${f=>setSign({finishing:f})} onReset=${()=>setReset(true)} onVenue=${()=>setVenue(true)}/>`:null}
    ${edit?html`<${RecordEditor} key=${edit.run.id+edit.i} run=${edit.run} idx=${edit.i} onClose=${()=>setEdit(null)}/>`:null}
    ${del?html`<${DeleteRecordDialog} key=${'d'+del.run.id+del.i} run=${del.run} idx=${del.i} onClose=${()=>setDel(null)}/>`:null}
    ${reset&&m?html`<${ResetDialog} m=${m} onClose=${()=>setReset(false)}/>`:null}
    ${sign&&m?html`<${SignSheet} key=${m.id} m=${m} finishing=${sign.finishing} onClose=${()=>setSign(null)}/>`:null}
  </div>`;
}
/* ==========================================================================
   [4] 기록 관리 (실시간 계측 · 출전 순서 · 입력/수정 · 수정 이력) · [5] 종합 순위 · [6] TOP 10
   ========================================================================== */
function LaneCard({m,run,cls,st,rankRow,hotkey,onEdit}){
  const s=runState(run),n=(run.order||[]).length;
  const cur=s.cur>=0?s.cur:n-1;
  const leg=legOf(run,cur)||{};
  const player=playerOf(cls,leg.playerId||(run.order||[])[cur]);
  const r=n?legResult(run,cur,st):null;
  const pressAt=useRef(null);
  const [flash,setFlash]=useState(false);
  const canHit=s.phase==='shoot'||s.phase==='run2';
  const team=teamResult(run,st);
  const hitVal=leg.hits!=null?leg.hits:st.requiredHits;
  // 마지막 주자의 최종 도착 버튼은 조끼 색으로 아른거린다
  const isFinal=n>0&&s.cur===n-1&&(run.returnRun!==false?s.phase==='run2':s.phase==='shoot');
  const action=()=>{
    const t=pressAt.current&&Date.now()-pressAt.current<1500?pressAt.current+Live.offset:Live.now();
    pressAt.current=null;
    if(Actions.advance(m.id,run.classId,t)){setFlash(true);setTimeout(()=>setFlash(false),260);}
  };
  const addPen=async(cs,label)=>{
    Actions.addPenalty(materializeRun(m,run.classId),cur,cs,label);
    toast((player?player.name:'선수')+' 페널티 '+fmtPen(cs)+' 추가','info',1800);
  };
  return html`<article class="lane ${s.phase==='shoot'?'is-shoot':''} ${s.cur<0?'is-done':''}" style=${vestStyle(run.lane)}>
    <header class="lane-head">
      <span class="lane-no"><small>사로</small>${run.lane}</span>
      <${Logo} cls=${cls} size="40px"/>
      <div class="lane-title"><strong>${className(cls)}</strong><em>${rankRow&&rankRow.started?rankRow.rank+'위'+(rankRow.gapCs?' · '+(rankRow.gapCs>0?'+':'')+fmtCs(rankRow.gapCs):''):'출발 전'}</em></div>
      <div class="lane-lap"><small>전체 랩타임</small><${LiveText} class="num" fn=${()=>fmtCs(lapNowCs(Store.doc('runs',run.id)||run,Live.now(),st))}/></div>
    </header>
    <div class="lane-now">
      ${n?html`
      <div class="lane-runner">
        <span class="runner-no">${s.cur<0?n:cur+1}<small>/${n}</small></span>
        <div><strong>${player?player.name:'-'}</strong> <${GenderTag} g=${player&&player.gender}/><em class="phase ph-${s.phase}">${s.cur<0?'전원 완주':PHASE_KO[s.phase]}</em></div>
      </div>
      <div class="lane-split"><small>${s.phase==='shoot'?'사격 시간':s.phase==='run1'?'사로까지':s.phase==='run2'?'도착까지':'구간'}</small><${LiveText} class="num" fn=${()=>{const x=Store.doc('runs',run.id)||run;const v=phaseElapsedCs(x,Live.now(),st);return v==null?'--:--.--':fmtCs(v);}}/></div>
      `:html`<p class="dim">참가자를 먼저 등록해 주세요.</p>`}
    </div>
    <div class="hits ${canHit?'':'off'}" role="group" aria-label="명중 수">
      <span class="hits-label">명중</span>
      ${Array.from({length:st.requiredHits+1},(_,i)=>html`<button key=${i} disabled=${!canHit} class=${canHit&&hitVal===i?'on':''} onClick=${()=>Actions.setHits(run,cur,i)}>${i}</button>`)}
      <span class="hits-pen ${r&&r.penCs>0?'on':''}">${fmtPen(r?r.penCs:0)}</span>
    </div>
    <button id=${'lane-act-'+run.lane} class="lane-action act-${s.phase} ${isFinal?'act-final':''} ${flash?'flash':''}" disabled=${s.cur<0||!n}
      onPointerDown=${()=>{pressAt.current=Date.now();}} onClick=${action}>
      <span>${actionLabel(run,st)}</span>${hotkey&&s.cur>=0?html`<kbd>${hotkey}</kbd>`:null}
    </button>
    <div class="lane-tools">
      <button class="btn btn-sm" onClick=${()=>Actions.undo(m.id,run.classId)} disabled=${run.virtual||run.startedAt==null}><${Icon} n="undo" s=${14}/> 되돌리기</button>
      <button class="btn btn-sm" disabled=${run.startedAt==null||s.cur<0} onClick=${()=>addPen(500,'경기 규칙 위반')}>페널티 +5초</button>
      <button class="btn btn-sm" disabled=${run.startedAt==null||s.cur<0} onClick=${()=>addPen(1000,'경기 규칙 위반')}>+10초</button>
    </div>
    <ol class="legs">
      ${(run.order||[]).map((pid,i)=>{
        const lr=legResult(run,i,st),p=playerOf(cls,lr.playerId);
        return html`<li key=${pid} class=${(i===s.cur?'cur ':'')+(lr.complete?'done':'')}>
          <span class="legs-no">${i+1}</span>
          <button class="legs-name" onClick=${()=>onEdit(run,i)} title="기록 입력·수정">${p?p.name:'-'}</button>
          <span class="legs-t" title="주행">${lr.runCs!=null?fmtCs(lr.runCs):'—'}</span>
          <span class="legs-t" title="사격">${lr.shootCs!=null?fmtCs(lr.shootCs):'—'}</span>
          <span class="legs-t ${lr.penCs>0?'is-pen':''}" title="페널티">${lr.penCs>0?fmtPen(lr.penCs):''}</span>
          <strong class="legs-t" title="최종 기록">${lr.finalCs!=null?fmtCs(lr.finalCs):''}</strong>
        </li>`;
      })}
    </ol>
    <footer class="lane-foot"><span>주행 / 사격 / 페널티 / 최종</span>${team.complete?html`<strong>팀 기록 <b class="num">${fmtCs(team.finalCs)}</b></strong>`:null}</footer>
  </article>`;
}
function ConsoleTab({m,onEdit}){
  useStore();
  const st=CFG.settings();
  const [laneF,setLaneF]=useLocal('ui.laneFilter','all');
  const runs=runsOfMatch(m);
  const table=raceTable(m);
  const rankOf=id=>table.find(x=>x.run.id===id);
  useEffect(()=>{
    const onKey=e=>{
      const tag=(e.target&&e.target.tagName)||'';
      if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||e.metaKey||e.ctrlKey||e.altKey||e.repeat) return;
      if(!/^[1-9]$/.test(e.key)) return;
      const mm=Store.doc('matches',m.id);
      const run=mm&&runsOfMatch(mm).find(r=>String(r.lane)===e.key);
      if(run){e.preventDefault();Actions.advance(mm.id,run.classId,Live.now());}
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[m.id]);
  useEffect(()=>{Live.startBeat();},[]);
  const anyReady=runs.some(r=>{const s=runState(r);return s.cur===0&&s.phase==='ready'&&(r.order||[]).length;});
  const lanes=runs.map(r=>r.lane);
  const shown=runs.filter(r=>laneF==='all'||String(r.lane)===String(laneF));
  const from=runs.filter(r=>r.startedAt!=null);
  const t0=from.length?Math.min(...from.map(r=>r.startedAt)):null;
  return html`<div class="console">
    <div class="console-bar">
      <button id="start-all" class="btn btn-go btn-lg" disabled=${!anyReady} onClick=${()=>Actions.startMatch(m.id)}><${Icon} n="play" s=${17}/> ${anyReady?(from.length?'남은 학급 출발':'경기 시작'):(m.status==='done'?'경기 종료됨':'경기 진행 중')}</button>
      <div class="console-clock"><small>경기 시작 ${t0?fmtClock(t0):'전'}</small><${LiveText} class="num" fn=${()=>{
        const rs=(Store.doc('matches',m.id)?runsOfMatch(Store.doc('matches',m.id)):[]).filter(r=>r.startedAt!=null);
        if(!rs.length) return '00:00.00';
        const a=Math.min(...rs.map(r=>r.startedAt)),done=rs.every(r=>r.finishedAt!=null);
        const b=done?Math.max(...rs.map(r=>r.finishedAt)):Live.now();
        return fmtCs(toCs(Math.max(0,b-a)*(rs[0].scale||1),st.rounding));
      }}/></div>
      <label class="console-filter"><span>담당 사로</span>
        <select id="lane-filter" class="select" value=${laneF} onChange=${e=>setLaneF(e.target.value)}>
          <option value="all">전체</option>
          ${lanes.map(l=>html`<option key=${l} value=${String(l)}>${l}사로</option>`)}
        </select>
      </label>
      <p class="console-help">숫자 키 <kbd>1</kbd>~<kbd>${Math.max(...lanes,1)}</kbd>로 해당 사로의 다음 버튼을 누를 수 있습니다. 블루투스 리모컨이나 USB 숫자 패드도 같은 방식으로 동작합니다.</p>
    </div>
    <div class="lanes">
      ${shown.map(run=>html`<${LaneCard} key=${run.id} m=${m} run=${run} cls=${Store.doc('classes',run.classId)} st=${st} rankRow=${rankOf(run.id)} hotkey=${run.lane<=9?String(run.lane):null} onEdit=${onEdit}/>`)}
    </div>
  </div>`;
}
const REASON_CHIPS=['버튼 오입력','계측 오류','판정 변경','사후 입력'];
function RecordEditor({run,idx,onClose}){
  useStore();
  const st=CFG.settings();
  const fresh=Store.doc('runs',run.id)||run;
  const before=useMemo(()=>legResult(fresh,idx,st),[]);
  const cls=Store.doc('classes',fresh.classId),m=Store.doc('matches',fresh.matchId);
  const p=playerOf(cls,before.playerId);
  const [runCs,setRun]=useState(before.runCs);
  const [shootCs,setShoot]=useState(before.shootCs);
  const [hits,setHits]=useState(before.hits!=null?before.hits:st.requiredHits);
  const [extra,setExtra]=useState(before.extraPen||0);
  const [penNote,setPenNote]=useState(before.penNote);
  const hasOverride=(legOf(fresh,idx)||{}).penCs!=null;
  const [penOverride,setPenOverride]=useState(hasOverride);
  const [penDirect,setPenDirect]=useState(hasOverride?before.penCs:0);
  const defaultStart=before.t0!=null?new Date(before.t0):null;
  const [startText,setStartText]=useState(defaultStart?fmtClock(before.t0):'');
  const [by,setBy]=useState(()=>LR.recorder());
  const [reason,setReason]=useState('');
  const [err,setErr]=useState('');
  const missPen=Math.max(0,st.requiredHits-hits)*st.penaltyPerMissCs;
  const penCs=penOverride?penDirect:missPen+extra;
  const finalCs=(runCs!=null&&shootCs!=null)?runCs+shootCs+(st.includePenalty?penCs:0):null;
  const preview={runCs,shootCs,penCs,finalCs};
  const save=()=>{
    if(runCs==null||shootCs==null){setErr('주행 기록과 사격 기록을 입력해 주세요. 초는 59까지 입력할 수 있습니다.');return;}
    if(before.complete&&!reason.trim()){setErr('기록을 수정할 때는 수정 사유가 필요합니다.');return;}
    let t0=null;
    if(startText&&m&&m.date){
      const mt=startText.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if(mt){
        const [y,mo,d]=m.date.split('-').map(Number);
        const typed=new Date(y,mo-1,d,+mt[1],+mt[2],+(mt[3]||0)).getTime();
        if(before.t0==null||fmtClock(before.t0)!==startText) t0=typed;
      }
    }
    Actions.saveRecord(fresh,idx,{runCs,shootCs,hits,extraPenCs:extra,penNote,penOverride,penCs:penDirect,t0},reason.trim(),by||'미지정');
    toast((p?p.name:'선수')+' 기록을 저장했습니다. 순위에 바로 반영됩니다.','ok');
    onClose();
  };
  const del=async()=>{
    if(!reason.trim()){setErr('기록을 삭제할 때도 사유가 필요합니다.');return;}
    const ok=await askConfirm({title:'기록 삭제',body:(p?p.name:'이 선수')+'의 기록을 지웁니다. 삭제 전 기록은 수정 이력에 남습니다.',ok:'삭제',danger:true});
    if(ok){Actions.clearRecord(fresh,idx,reason.trim(),by||'미지정');onClose();}
  };
  return html`<${Modal} title=${(before.complete?'기록 수정':'기록 입력')+' · '+(p?p.name:'')} wide onClose=${onClose} footer=${html`
    ${before.complete?html`<button class="btn btn-danger-ghost foot-left" onClick=${del}>기록 삭제</button>`:null}
    ${err?html`<span class="field-error foot-err">${err}</span>`:null}
    <button class="btn" onClick=${onClose}>취소</button>
    <button id="record-save" class="btn btn-primary" onClick=${save}>저장</button>`}>
    <div class="editor">
      <div class="editor-form">
        <p class="dim editor-who">${m&&m.title} · ${className(cls)} · ${idx+1}번 주자 · ${genderKo(p&&p.gender)}${fresh.sample?' · 예시 기록':''}</p>
        <div class="form-grid">
          <${Field} label="주행 기록 (분:초.소수)" hint=${before.run1!=null?'사로까지 '+fmtCs(before.run1)+(before.run2!=null?' + 도착까지 '+fmtCs(before.run2):''):'출발~사로 도착, 사격 후~도착을 합친 시간'}>
            <${TimeField} idBase="rec-run" value=${runCs} onChange=${v=>setRun(v)}/>
          <//>
          <${Field} label="사격 기록 (분:초.소수)" hint="사로 도착~사로 출발">
            <${TimeField} idBase="rec-shoot" value=${shootCs} onChange=${v=>setShoot(v)}/>
          <//>
          <${Field} label="출발 시각" hint="시:분:초">
            <input id="rec-start" value=${startText} placeholder="10:31:05" onInput=${e=>setStartText(e.target.value)}/>
          <//>
        </div>
        <h4 class="form-sub">페널티</h4>
        <div class="hits hits-form" role="group" aria-label="명중 수">
          <span class="hits-label">명중 수</span>
          ${Array.from({length:st.requiredHits+1},(_,i)=>html`<button key=${i} class=${hits===i?'on':''} disabled=${penOverride} onClick=${()=>setHits(i)}>${i}</button>`)}
          <span class="hits-pen ${missPen>0&&!penOverride?'on':''}">${st.requiredHits-hits>0?(st.requiredHits-hits)+'발 부족 ':''}${fmtPen(missPen)}</span>
        </div>
        <div class="form-grid">
          <${Field} label="추가 페널티">
            <${TimeField} idBase="rec-extra" value=${extra} disabled=${penOverride} onChange=${v=>setExtra(v||0)}/>
          <//>
          <${Field} label="페널티 사유" grow>
            <input id="rec-pen-note" value=${penNote} onInput=${e=>setPenNote(e.target.value)} placeholder="부정 출발, 코스 이탈 등"/>
          <//>
        </div>
        <label class="check-line"><input id="rec-pen-direct" type="checkbox" checked=${penOverride} onChange=${e=>setPenOverride(e.target.checked)}/> 페널티 총합을 직접 입력</label>
        ${penOverride?html`<${Field} label="페널티 총합"><${TimeField} idBase="rec-pen" value=${penDirect} onChange=${v=>setPenDirect(v||0)}/><//>`:null}
        <h4 class="form-sub">입력 정보</h4>
        <div class="form-grid">
          <${Field} label="기록 입력자"><input id="rec-by" value=${by} onInput=${e=>setBy(e.target.value)}/><//>
          <${Field} label=${before.complete?'수정 사유 (필수)':'메모'} grow>
            <input id="rec-reason" value=${reason} onInput=${e=>setReason(e.target.value)} placeholder="수정한 이유를 적어 주세요"/>
          <//>
        </div>
        ${before.complete?html`<div class="reason-chips">${REASON_CHIPS.map(c=>html`<button key=${c} type="button" class="pickbtn" onClick=${()=>setReason(c)}>${c}</button>`)}</div>`:null}
      </div>
      <aside class="editor-side">
        <span class="kicker">${before.complete?'수정 후':'자동 계산'}</span>
        <${RecordCard} name=${p?p.name:''} r=${preview}/>
        ${before.complete?html`<span class="kicker">수정 전</span><${RecordCard} name=${p?p.name:''} r=${before}/>`:null}
        <p class="dim editor-note">최종 기록 = 주행 + 사격${st.includePenalty?' + 페널티':' (페널티 제외 설정)'}</p>
      </aside>
    </div>
  <//>`;
}
/* ---------- 기록 삭제 · 초기화 (편집 권한이 있으면 누구나, 확인 창을 거친다) ---------- */
const DEL_CHIPS=['버튼 오입력','계측 오류','중복 입력','테스트 기록','재경기'];
const legHasData=(run,i)=>{const l=legOf(run,i);return !!(l&&(l.manual||['t0','t1','t2','t3'].some(k=>l[k]!=null)||l.runCs!=null||l.shootCs!=null));};
function DeleteRecordDialog({run,idx,onClose}){
  useStore();
  const st=CFG.settings();
  const fresh=Store.doc('runs',run.id)||run;
  const r=legResult(fresh,idx,st);
  const cls=Store.doc('classes',fresh.classId),m=Store.doc('matches',fresh.matchId),p=playerOf(cls,r.playerId);
  const [reason,setReason]=useState('');
  const [err,setErr]=useState('');
  const pick=v=>{setReason(v);setErr('');};
  const go=()=>{
    if(!reason.trim()){setErr('삭제 사유를 적어 주세요.');return;}
    if(!legHasData(fresh,idx)){onClose();return;}
    Actions.clearRecord(fresh,idx,reason.trim(),LR.recorder());
    toast((p?p.name:'선수')+' 기록을 지웠습니다. 지우기 전 기록은 수정 이력에 남아 있습니다.','ok');
    onClose();
  };
  return html`<${Modal} title=${'기록 삭제 · '+(p?p.name:(idx+1)+'번 주자')} onClose=${onClose} footer=${html`
    ${err?html`<span class="field-error foot-err">${err}</span>`:null}
    <button class="btn" onClick=${onClose}>취소</button>
    <button id="del-ok" class="btn btn-danger" onClick=${go}><${Icon} n="trash" s=${15}/> 삭제</button>`}>
    <div class="del-rec">
      <p class="dim">${m&&m.title} · ${className(cls)} · ${idx+1}번 주자${r.complete?'':' · 아직 완주 전 기록'}${fresh.sample?' · 예시 기록':''}</p>
      <${RecordCard} name=${p?p.name:''} r=${r}/>
      <${Field} label="삭제 사유 (필수)">
        <input id="del-reason" value=${reason} placeholder="지우는 이유를 적어 주세요" onInput=${e=>pick(e.target.value)} onKeyDown=${e=>{if(e.key==='Enter'&&!e.isComposing)go();}}/>
      <//>
      <div class="reason-chips">${DEL_CHIPS.map(c=>html`<button key=${c} type="button" class=${'pickbtn'+(reason===c?' on':'')} onClick=${()=>pick(c)}>${c}</button>`)}</div>
      <p class="dim del-note">지운 기록은 수정 이력에 남고, 같은 줄의 「입력」으로 다시 넣을 수 있습니다. 삭제한 사람: ${LR.recorder()}</p>
    </div>
  <//>`;
}
const matchUsed=x=>!!((x.status&&x.status!=='tbd')||x.startedAt!=null||runsOfMatch(x).some(r=>r.startedAt!=null||Object.keys(r.legs||{}).length));
/** 전체 기록 초기화 대상. 전체 초기화 표시 한 줄(경기 없는 이력)만 남았으면 지울 것이 없는 것으로 본다. */
function recordsResetInfo(){
  const ms=scopedMatches(),ids=new Set(ms.map(x=>x.id)),hide=sampleHidden();
  const nAll=allRecords().filter(r=>ids.has(r.matchId)).length;
  const audit=Store.list('audit').filter(a=>!hide||!a.sample);
  return {ms,nAll,nAudit:audit.length,busy:nAll>0||audit.some(a=>a.matchId)||ms.some(matchUsed)};
}
function ResetDialog({m,onClose}){
  useStore();
  const {ms,nAll,nAudit,busy:allBusy}=recordsResetInfo();
  const nOne=allRecords().filter(r=>r.matchId===m.id).length;
  const oneBusy=matchUsed(m);
  const one=()=>{Actions.resetMatch(m.id);toast(m.title+' 기록을 초기화했습니다.','ok');onClose();};
  const all=()=>{const n=Actions.resetRecords();toast('모든 경기 기록을 초기화했습니다'+(n?' (기록 '+n+'건)':'')+'.','ok');onClose();};
  return html`<${Modal} title="기록 초기화" onClose=${onClose} footer=${html`
    <span class="dim reset-foot foot-left">지운 기록은 되돌릴 수 없습니다. 필요하면 먼저 설정 › 데이터에서 백업해 두세요.</span>
    <button class="btn" onClick=${onClose}>닫기</button>`}>
    <div class="reset-opts">
      <section class="reset-opt">
        <div><strong>이 경기만 · ${m.title}</strong>
          <p>출발·도착 시각과 기록 <b>${nOne}건</b>, 주장 서명을 지우고 미정 상태로 되돌립니다. 바꿔 둔 출전 순서는 그대로 둡니다.</p></div>
        <button id="reset-match" type="button" class="btn btn-sm btn-danger armed" disabled=${!oneBusy} onClick=${one}>이 경기 초기화</button>
      </section>
      <section class="reset-opt">
        <div><strong>전체 기록</strong>
          <p>반·선수·일정은 그대로 두고 경기 <b>${ms.length}개</b>의 기록 <b>${nAll}건</b>, 수정 이력 <b>${nAudit}건</b>, 주장 서명을 모두 지웁니다.</p></div>
        <${SUI.ConfirmBtn} disabled=${!allBusy} armedText="한 번 더 누르면 전체 삭제" onConfirm=${all}>전체 기록 초기화<//>
      </section>
    </div>
  <//>`;
}
function RecordsTab({m,onEdit,onDel}){
  useStore();
  const st=CFG.settings();
  const runs=runsOfMatch(m);
  return html`${runs.map(run=>{
    const c=Store.doc('classes',run.classId),team=teamResult(run,st);
    return html`<${Panel} key=${run.id} flush title=${html`<span class="panel-class"><span class="lane-tag" style=${vestStyle(run.lane)}>${run.lane}사로</span><${Logo} cls=${c}/>${className(c)}${run.sample?html` <${SampleChip}/>`:null}</span>`}
      right=${html`<${SignChip} run=${run} st=${st}/><span class="team-sum">전체 랩타임 <b class="num">${fmtCs(team.lapCs)}</b> · 페널티 <b class="num">${fmtPen(team.penCs)}</b> · 팀 기록 <b class="num">${fmtCs(team.finalCs)}</b></span>`}>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th class="c-rank">순번</th><th>이름</th><th class="c-g">성별</th><th class="num">출발 시각</th><th class="num">사격</th><th class="num">주행</th><th class="num">페널티</th><th class="num">최종 기록</th><th>기록 입력자</th><th>상태</th><th class="c-act">관리</th></tr></thead>
        <tbody>${(run.order||[]).map((pid,i)=>{
          const r=legResult(run,i,st),p=playerOf(c,r.playerId),ph=legPhase(legOf(run,i),run.returnRun!==false);
          return html`<tr key=${pid}>
            <td class="c-rank num">${i+1}</td>
            <td><strong>${p?p.name:'(명단에 없음)'}</strong>${r.edited?html` <span class="chip chip-edit">수정</span>`:null}${r.manual?html` <span class="chip chip-manual">직접 입력</span>`:null}</td>
            <td class="c-g"><${GenderTag} g=${p&&p.gender}/></td>
            <td class="num">${r.t0!=null?fmtClock(r.t0):'—'}</td>
            <td class="num">${fmtCs(r.shootCs)}</td>
            <td class="num">${fmtCs(r.runCs)}</td>
            <td class="num ${r.penCs>0?'is-pen':'dim'}" title=${r.penNote||''}>${fmtPen(r.penCs)}</td>
            <td class="num strong">${fmtCs(r.finalCs)}</td>
            <td class="dim">${r.recorder||'—'}</td>
            <td><span class="phase ph-${r.complete?'done':ph}">${r.complete?'완료':PHASE_KO[ph]}</span></td>
            <td class="c-act"><button class="btn btn-sm" onClick=${()=>onEdit(run,i)}><${Icon} n="edit" s=${14}/> ${r.complete?'수정':'입력'}</button>${onDel?html`<button class="icon-btn del-btn" disabled=${!legHasData(run,i)} aria-label=${(p?p.name:(i+1)+'번 주자')+' 기록 삭제'} title="기록 삭제" onClick=${()=>onDel(run,i)}><${Icon} n="trash" s=${16}/></button>`:null}</td>
          </tr>`;
        })}</tbody>
      </table></div>
    <//>`;
  })}`;
}
function AuditTab(){
  useStore();
  const rows=Store.list('audit').filter(a=>!sampleHidden()||!a.sample).sort((a,b)=>b.at-a.at);
  const line=x=>x?html`<span class="audit-vals">사격 ${fmtCs(x.shootCs)} · 주행 ${fmtCs(x.runCs)} · 페널티 ${fmtPen(x.penCs)}<br/><b class="num">최종 ${fmtCs(x.finalCs)}</b></span>`:html`<span class="dim">없음</span>`;
  const KIND={edit:'수정',manual:'직접 입력',delete:'삭제',reset:'초기화'};
  if(!rows.length) return html`<${Panel}><${EmptyState} title="수정 이력이 없습니다.">기록을 수정하면 수정 전후 기록과 사유, 수정한 사람이 여기에 남습니다.<//><//>`;
  return html`<${Panel} flush title="기록 수정 이력" right=${html`<span class="dim">${rows.length}건</span>`}>
    <div class="tbl-wrap"><table class="tbl audit-tbl">
      <thead><tr><th>시각</th><th>구분</th><th>경기 · 선수</th><th>수정 전</th><th>수정 후</th><th>사유</th><th>입력자</th></tr></thead>
      <tbody>${rows.map(a=>html`<tr key=${a.id}>
        <td class="num">${fmtStamp(a.at)}</td>
        <td><span class="chip ${a.kind==='delete'||a.kind==='reset'?'chip-del':'chip-edit'}">${KIND[a.kind]||a.kind}</span>${a.sample?html` <${SampleChip}/>`:null}</td>
        <td><strong>${a.playerName||a.matchTitle||''}</strong><div class="sub dim">${[a.playerName?a.matchTitle:null,a.className].filter(Boolean).join(' · ')}</div></td>
        <td>${a.kind==='reset'?html`<span class="dim">—</span>`:line(a.before)}</td>
        <td>${a.kind==='reset'?html`<span class="dim">—</span>`:line(a.after)}</td>
        <td>${a.reason||html`<span class="dim">—</span>`}</td>
        <td class="dim">${a.by||'—'}</td>
      </tr>`)}</tbody>
    </table></div>
  <//>`;
}
/* ---------- 순위: TOP 10 보드 + 전체 순위(학급 · 개인 · 남녀 · 학년) ---------- */
function StandingsPage(){
  const [view,setView]=useLocal('ui.rankView','top10');
  return html`<div class="page">
    <div class="seg lr-viewseg" role="tablist" aria-label="순위 보기">
      <button type="button" role="tab" aria-pressed=${String(view!=='all')} onClick=${()=>setView('top10')}><${Icon} n="trophy" s=${15}/> TOP 10</button>
      <button type="button" role="tab" aria-pressed=${String(view==='all')} onClick=${()=>setView('all')}><${Icon} n="list" s=${15}/> 전체 순위</button>
    </div>
    ${view==='all'?html`<${RankingPage}/>`:html`<${Top10Page}/>`}
  </div>`;
}
/* ---------- 종합 순위 ---------- */
function RankingPage(){
  useStore();
  const [tab,setTab]=useLocal('ui.rankTab','class');
  const [grade,setGrade]=useState(null);
  const [cid,setCid]=useState(null);
  const recs=scopedRecords();
  const grades=[...new Set(classesSorted().filter(c=>!sampleHidden()||!c.sample).map(c=>c.grade))];
  const g=grade||grades[0];
  let list=recs;
  if(tab==='male') list=recs.filter(r=>r.gender==='M');
  if(tab==='female') list=recs.filter(r=>r.gender==='F');
  if(tab==='grade') list=recs.filter(r=>r.grade===g);
  const rows=rankRecords(list);
  const stats=statsOf(rows);
  const penRows=rows.filter(r=>r.penCs>0).length;
  const classRows=classTable(recs);
  const sel=cid?Store.doc('classes',cid):null;
  const allRanked=rankRecords(recs);
  const bestId=allRanked[0]&&allRanked[0].id;
  return html`<div class="page">
    <${Tabs} value=${tab} onChange=${setTab} items=${[{id:'class',label:'학급 순위'},{id:'all',label:'개인 전체 순위'},{id:'male',label:'남자 순위'},{id:'female',label:'여자 순위'},{id:'grade',label:'학년별 순위'}]}/>
    ${tab==='grade'?html`<div class="seg seg-line">${grades.map(x=>html`<button key=${x} aria-pressed=${String(g===x)} onClick=${()=>setGrade(x)}>${x}학년</button>`)}</div>`:null}
    ${tab!=='class'?html`
      <${StatStrip} items=${[
        {label:'최고 기록',value:stats.best!=null?fmtCs(stats.best):'--:--.--',sub:stats.bestRow?stats.bestRow.name+' · '+classShort(stats.bestRow.cls):''},
        {label:'평균 기록',value:stats.avg!=null?fmtCs(stats.avg):'--:--.--',sub:stats.count?stats.count+'명 기준':''},
        {label:'기록 수',value:String(stats.count),sub:'선수별 최고 기록'+(CFG.settings().bestOnly?'만 반영':' 전체')},
        {label:'페널티 받은 선수',value:String(penRows),sub:stats.count?Math.round(penRows/stats.count*100)+'%':''}
      ]}/>
      <${Panel} flush>
        <${RecordTable} rows=${rows} bestId=${bestId} emptyText="이 조건의 기록이 없습니다."/>
      <//>`:html`
      <${Panel} flush title="학급별 팀 순위" right=${html`<span class="dim">${CFG.settings().teamCalc==='lap'?'전체 랩타임 + 페널티':'선수 6명 최종 기록 합계'} 기준</span>`}>
        ${classRows.length?html`<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th class="c-rank">순위</th><th>학급</th><th class="num">팀 기록</th><th class="num">전체 랩타임</th><th class="num">페널티 합계</th><th class="num">개인 평균</th><th class="num">개인 최고</th><th>진행</th></tr></thead>
          <tbody>${classRows.map(r=>html`<tr key=${r.cls.id} class="tr-link ${cid===r.cls.id?'tr-on':''}" onClick=${()=>setCid(cid===r.cls.id?null:r.cls.id)}>
            <td class="c-rank"><${RankMark} n=${r.rank}/></td>
            <td><${ClassName} cls=${r.cls}/>${r.cls.sample?html` <${SampleChip}/>`:null}</td>
            <td class="num strong">${r.team?fmtCs(r.team.finalCs):'--:--.--'}</td>
            <td class="num">${fmtCs(r.lapCs)}</td>
            <td class="num ${r.penCs>0?'is-pen':'dim'}">${fmtPen(r.penCs)}</td>
            <td class="num">${fmtCs(r.avg)}</td>
            <td class="num">${fmtCs(r.best)}</td>
            <td>${r.team?html`<span class="phase ph-done">완주</span>`:r.count?html`<span class="phase ph-run1">${r.count}/${r.size}명</span>`:html`<span class="dim">경기 전</span>`}</td>
          </tr>`)}</tbody>
        </table></div>`:html`<${EmptyState} title="등록된 학급이 없습니다."/>`}
      <//>
      ${sel?html`<${Panel} flush title=${className(sel)+' 선수별 기록'} right=${html`<button class="btn btn-sm btn-ghost" onClick=${()=>setCid(null)}>닫기</button>`}>
        <${RecordTable} rows=${rankRecords(recs.filter(r=>r.classId===cid))} bestId=${bestId} emptyText="이 학급의 기록이 아직 없습니다."/>
      <//>`:html`<p class="dim tbl-note">학급을 누르면 선수별 기록과 반 내 순위를 볼 수 있습니다.</p>`}
    `}
  </div>`;
}

/* ---------- TOP 10 ---------- */
function Top10Page(){
  useStore();
  const now=useNow(10000);
  const recs=scopedRecords();
  const all=rankRecords(recs);
  const best=all[0];
  const data=boardData(),topClass=data.class[0];
  const topCls=topClass?Store.doc('classes',topClass.id):null;
  const today=todayStr();
  const grades=[1,2,3].filter(g=>data['g'+g].length);
  const hist=bestHistory(recs).slice().reverse();
  const recentBest=best&&best.recordedAt&&now-best.recordedAt<600000&&hist.length>1;
  const todayRows=rankRecords(recs.filter(r=>r.date===today)).map(r=>({id:r.id,rank:r.rank,key:logoKey(r.cls),name:r.name,sub:classShort(r.cls),time:fmtCs(r.finalCs),penText:penText(r.penCs),sample:!!r.sample}));
  return html`<div class="page">
    ${topClass?html`<div class="best-band">
      <span class="best-kicker">학급 1위</span>
      <${Tm} class="best-time" v=${topClass.time}/>
      <span class="best-who"><${Logo} cls=${topCls}/>${topClass.name}${topClass.penText?' · '+topClass.penText:''}</span>
      ${topClass.sample?html`<${SampleChip}/>`:null}
    </div>`:null}
    ${best?html`<div class="best-band ${recentBest?'is-new':''}">
      <span class="best-kicker">${recentBest?'개인 최고 기록 갱신':'개인 최고 기록'}</span>
      <${Tm} class="best-time" v=${fmtCs(best.finalCs)}/>
      <span class="best-who"><${Logo} cls=${best.cls}/>${best.name} · ${className(best.cls)} · ${genderKo(best.gender)}</span>
      ${best.sample?html`<${SampleChip}/>`:null}
      ${hist[0]&&hist[0].prev!=null?html`<span class="best-prev">이전 기록 ${fmtCs(hist[0].prev)}에서 ${fmtCs(hist[0].prev-hist[0].finalCs)} 단축</span>`:null}
    </div>`:null}
    <div class="grid-top">
      <${RankBoard} title="학급 TOP 10" rows=${data.class} empty="완주한 학급이 아직 없습니다"/>
      <${RankBoard} title="개인 전체 TOP 10" rows=${data.all}/>
      <${RankBoard} title="남자 TOP 10" rows=${data.male}/>
      <${RankBoard} title="여자 TOP 10" rows=${data.female}/>
      ${grades.map(g=>html`<${RankBoard} key=${g} title=${g+'학년 TOP 10'} rows=${data['g'+g]}/>`)}
      <${RankBoard} title="오늘의 TOP 기록" rows=${todayRows} empty="오늘 입력된 기록이 없습니다" right=${html`<span class="dim">${fmtDateKo(today,false)}</span>`}/>
      <${Panel} title="최고 기록 갱신 이력" flush>
        ${hist.length?html`<ol class="hist">${hist.slice(0,10).map((h,i)=>html`<li key=${h.id} class=${i===0?'cur':''}>
          <${Tm} class="hist-time" v=${fmtCs(h.finalCs)}/>
          <span>${h.name} · ${classShort(h.cls)}${i===0?html` <span class="chip chip-best">현재</span>`:null}</span>
          <span class="dim num">${h.recordedAt?fmtStamp(h.recordedAt):''}</span>
        </li>`)}</ol>`:html`<${EmptyState} title="아직 기록이 없습니다."/>`}
      <//>
    </div>
  </div>`;
}

/* ==========================================================================
   [7] TV 실시간 현황(운영 화면) · [8] 설정 · 휴대폰 촬영 화면
   ========================================================================== */
const SEGMENTS=['출발','달리기','사격','도착','경기 전체'];
const relayLinks=id=>({push:'https://vdo.ninja/?push='+id,view:'https://vdo.ninja/?view='+id+'&cleanoutput'});
function ensureRelayId(){
  const tv=CFG.tv();
  if(tv.relayId) return tv.relayId;
  const id='lr'+Math.random().toString(36).slice(2,10);
  Actions.saveConfig('tv',{relayId:id});
  return id;
}
async function addVideoOrImage(file,meta){
  const isImg=file.type.startsWith('image/');
  const isVid=file.type.startsWith('video/')||/\.(mov|mp4|webm|m4v)$/i.test(file.name||'');
  if(!isImg&&!isVid){toast('이미지나 영상 파일만 올릴 수 있습니다.','warn');return null;}
  if(isVid&&!MediaStore.canVideo()) throw {code:'video_off'};
  let type=file.type;
  if(isVid&&type!=='video/mp4'&&type!=='video/webm') type='video/mp4'; // 아이폰 MOV는 MP4로 저장해야 재생된다
  if(isVid&&file.size>20*1048576) throw {code:'too_large'};
  const r=await MediaStore.put(file,isImg?(type||'image/jpeg'):type);
  const id=uid('v_');
  Store.set('media',id,{id,kind:isImg?'image':'video',assetId:r.id,title:meta.title||file.name||'',segment:meta.segment||'',matchId:meta.matchId||null,by:meta.by||LR.recorder(),at:Live.now(),sizeBytes:r.sizeBytes,contentType:r.contentType});
  ActLog.add('TV '+(isImg?'사진':'영상')+' 올림: '+(meta.title||file.name||''),{by:meta.by||null});
  return id;
}
function MediaManager(){
  useStore();
  const tv=CFG.tv();
  const [busy,setBusy]=useState(false);
  const [segment,setSegment]=useState(SEGMENTS[0]);
  const [link,setLink]=useState('');
  const [linkTitle,setLinkTitle]=useState('');
  const list=Store.list('media').sort((a,b)=>b.at-a.at);
  const upload=async f=>{
    setBusy(true);
    try{
      const live=matchesSorted().find(m=>m.status==='live');
      await addVideoOrImage(f,{segment,matchId:live&&live.id});
      toast('등록했습니다. TV 표시 방식에 따라 화면에 나옵니다.','ok');
    }catch(e){toast(uploadErrorText(e),'error');}
    setBusy(false);
  };
  const addLink=()=>{
    const u=link.trim();
    if(!/^https?:\/\//i.test(u)){toast('https:// 로 시작하는 주소를 입력해 주세요.','warn');return;}
    const id=uid('v_');
    if(Store.set('media',id,{id,kind:'link',url:u,title:linkTitle.trim()||u,segment,by:LR.recorder(),at:Live.now()})){ActLog.add('TV 영상 링크 추가: '+(linkTitle.trim()||u));setLink('');setLinkTitle('');}
  };
  const remove=async m=>{
    const ok=await askConfirm({title:'영상 삭제',body:(m.title||'이 항목')+'을(를) 목록에서 지웁니다.',ok:'삭제',danger:true});
    if(!ok) return;
    if(m.assetId) await MediaStore.del(m.assetId);
    Store.remove('media',m.id);
    ActLog.add('TV 사진·영상 삭제: '+(m.title||m.url||''));
    if(tv.pinnedMediaId===m.id) Actions.saveConfig('tv',{pinnedMediaId:null});
  };
  return html`<div class="media-mgr">
    <div class="form-grid">
      <${Field} label="TV 표시 방식" grow>
        <select id="tv-media-mode" class="select" value=${tv.mediaMode} onChange=${e=>Actions.saveConfig('tv',{mediaMode:e.target.value})}>
          <option value="new">새 사진·영상이 올라오면 잠시 보여 주고 기본 화면으로</option>
          <option value="loop">등록한 사진·영상 계속 순환</option>
          <option value="pinned">선택한 항목 고정</option>
          <option value="off">끄기 (기본 경기 현황만)</option>
        </select>
      <//>
      <${Field} label="촬영 구간">
        <select id="media-seg" class="select" value=${segment} onChange=${e=>setSegment(e.target.value)}>
          ${SEGMENTS.map(s=>html`<option key=${s} value=${s}>${s}</option>`)}
        </select>
      <//>
    </div>
    <div class="media-add">
  ${MediaStore.canUpload()?html`<${FilePick} id="media-file" accept=${MediaStore.canVideo()?'video/*,image/*':'image/*'} onFile=${upload} class="btn btn-primary" disabled=${busy}><${Icon} n="upload" s=${15}/> ${busy?'올리는 중…':MediaStore.canVideo()?'영상·사진 올리기':'사진 올리기'}<//>`
  :html`<span class="field-hint">이 계정은 파일을 올릴 수 없습니다.</span>`}
  <span class="field-hint">${MediaStore.canVideo()?'MP4·WEBM 영상과 사진, 파일당 20MB까지':'사진은 자동으로 줄여서 저장합니다. 영상은 아래 링크나 실시간 중계 창으로 연결합니다.'}</span>
</div>
    <div class="link-add">
      <input id="link-url" class="input" placeholder="영상 링크 (YouTube, 드라이브 등)" value=${link} onInput=${e=>setLink(e.target.value)}/>
      <input id="link-title" class="input" placeholder="이름" value=${linkTitle} onInput=${e=>setLinkTitle(e.target.value)}/>
      <button id="link-add" class="btn" onClick=${addLink}><${Icon} n="link" s=${15}/> 링크 등록</button>
    </div>
    <p class="field-hint">링크 영상은 보안 정책상 TV 화면 안에 넣을 수 없어, 목록에서 새 창으로 열어 TV 화면 옆에 배치합니다.</p>
    ${list.length?html`<ul class="media-list">${list.map(m=>html`<li key=${m.id} class=${tv.pinnedMediaId===m.id?'pinned':''}>
      <div class="media-thumb">
        ${m.kind==='video'?html`<video src=${MediaStore.url(m.assetId)} muted preload="metadata" playsinline></video>`:m.kind==='image'?html`<img src=${MediaStore.url(m.assetId)} alt=""/>`:html`<${Icon} n="link" s=${24}/>`}
      </div>
      <div class="media-meta">
        <strong>${m.title||'이름 없음'}</strong>
        <span class="dim">${m.segment?m.segment+' · ':''}${fmtStamp(m.at)}${m.by?' · '+m.by:''}${m.sizeBytes?' · '+fmtBytes(m.sizeBytes):''}</span>
      </div>
      <div class="row-act">
        ${m.kind==='link'?html`<a class="btn btn-sm" href=${/^https?:\/\//i.test(m.url||'')?m.url:'#'} target="_blank" rel="noopener noreferrer">새 창으로 열기</a>`
        :html`<button class="btn btn-sm ${tv.pinnedMediaId===m.id?'btn-primary':''}" onClick=${()=>Actions.saveConfig('tv',tv.pinnedMediaId===m.id?{pinnedMediaId:null,mediaMode:'new'}:{pinnedMediaId:m.id,mediaMode:'pinned'})}>${tv.pinnedMediaId===m.id?'고정 해제':'TV에 고정'}</button>`}
        <button class="icon-btn" aria-label="삭제" onClick=${()=>remove(m)}><${Icon} n="trash" s=${15}/></button>
      </div>
    </li>`)}</ul>`:html`<p class="dim empty-line">등록된 항목이 없습니다. 없으면 TV에는 기본 경기 현황이 나옵니다.</p>`}
  </div>`;
}
function RelayCard(){
  useStore();
  const tv=CFG.tv();
  const id=tv.relayId;
  const links=id?relayLinks(id):null;
  return html`<div class="relay">
    <div class="relay-block">
      <h4>휴대폰 → TV ${MediaStore.canVideo()?'영상·사진':'사진'} 보내기 <span class="chip ok">바로 사용</span></h4>
      <p>휴대폰으로 SDSMP를 열고 종목을 레이저런으로 고른 뒤, TV 송출 메뉴의 <b>휴대폰 촬영 화면</b>을 누르세요. 찍어서 보내면 몇 초 안에 TV에 표시됩니다.</p>
      <p><button class="btn btn-sm" onClick=${()=>navigate('camera')}><${Icon} n="camera" s=${14}/> 휴대폰 촬영 화면 열기</button></p>
    </div>
    <div class="relay-block">
      <h4>끊김 없는 실시간 중계 <span class="chip">외부 도구</span></h4>
      <p>이 사이트 안에서는 보안 정책상 휴대폰 카메라를 직접 생중계할 수 없습니다. 무료 웹 도구 VDO.Ninja로 중계 창을 따로 띄우고, 전자칠판에서 TV 화면 옆에 나란히 배치합니다. 앱 설치와 가입은 필요 없습니다.</p>
      ${links?html`<div class="relay-qr">
        <${Qr} text=${links.push}/>
        <div class="relay-links">
          <${CopyField} id="relay-push" label="① 휴대폰에서 열기 (QR 촬영) → 카메라 시작" value=${links.push}/>
          <div class="copyfield"><span class="field-label">② 전자칠판에서 열기</span><div><a class="btn btn-sm" href=${links.view} target="_blank" rel="noopener noreferrer"><${Icon} n="link" s=${14}/> 중계 창 새로 열기</a></div></div>
        </div>
      </div>
      <p class="field-hint">Windows에서는 창을 끌어 화면 왼쪽·오른쪽 끝에 붙이면 나란히 배치됩니다. TV 화면은 좁아진 창에 맞춰 자동으로 배치가 바뀝니다. 학생 얼굴이 나오는 영상이므로 학교 안내 기준을 확인해 주세요.</p>`
      :html`<button id="relay-make" class="btn" onClick=${ensureRelayId}>중계 주소 만들기</button>`}
    </div>
  </div>`;
}
function TvControlPanel(){
  useStore();
  const tv=CFG.tv();
  const ms=matchesSorted();
  const [tpl,setTpl]=useState(tv.template);
  const [notice,setNotice]=useState(tv.notice);
  useEffect(()=>{setNotice(tv.notice);},[tv.notice]);
  return html`<div class="form-grid">
    <${Field} label="TV 화면 구성" grow>
      <select id="tv-scene" class="select" value=${tv.scene==='top10'?'auto':tv.scene} onChange=${e=>Actions.saveConfig('tv',{scene:e.target.value})}>
        <option value="auto">화면 목록 순서대로 넘기기 (아래 「화면 순서 · 시간」)</option>
        <option value="race">경기 현황 고정</option>
        <option value="next">다음 경기 안내 고정</option>
        <option value="schedule">경기 일정 고정</option>
      </select>
    <//>
    <${Field} label="표시할 경기" grow hint="자동이면 진행 중인 경기를 보여 줍니다.">
      <select id="tv-pin" class="select" value=${tv.pinnedMatchId||''} onChange=${e=>Actions.saveConfig('tv',{pinnedMatchId:e.target.value||null})}>
        <option value="">자동</option>
        ${ms.map(m=>html`<option key=${m.id} value=${m.id}>${m.title}${m.sample?' (예시)':''}</option>`)}
      </select>
    <//>
    <${Field} label="종료 후 결과 표시 (초)">
      <input id="tv-hold" type="number" min="0" value=${tv.resultHoldSec} onChange=${e=>Actions.saveConfig('tv',{resultHoldSec:Math.max(0,+e.target.value||0)})}/>
    <//>
    <${Field} label="다음 경기 안내 문구" grow hint="{팀}은 학급 이름, {시간}은 “10분 후”처럼 자동으로 바뀝니다.">
      <input id="tv-template" value=${tpl} onInput=${e=>setTpl(e.target.value)} onChange=${e=>Actions.saveConfig('tv',{template:e.target.value||DEFAULT_TV.template})}/>
    <//>
    <${Field} label="긴급 공지 (입력하면 안내 띠에 번갈아 표시)" grow>
      <div class="inline-input">
        <input id="tv-notice" value=${notice} placeholder="예: 우천으로 30분 지연됩니다." onInput=${e=>setNotice(e.target.value)}/>
        <button id="tv-notice-send" class="btn" onClick=${()=>Actions.saveConfig('tv',{notice})}>표시</button>
        ${tv.notice?html`<button class="btn btn-ghost" onClick=${()=>{setNotice('');Actions.saveConfig('tv',{notice:''});}}>지우기</button>`:null}
      </div>
    <//>
<label class="toggle"><input id="tv-music" type="checkbox" checked=${tv.music!==false} onChange=${e=>Actions.saveConfig('tv',{music:e.target.checked})}/><span><b>TV 배경음악</b><em>풋살 TV와 같은 곡 목록을 재생합니다. 곡 목록은 풋살 TV 송출에서 관리합니다.</em></span></label>
  </div>`;
}
/** TV 송출 › 화면 순서 · 시간: 끌거나 ▲▼로 순서, 체크로 켜고 끄기, 화면마다 초 */
function TvListPanel(){
  useStore();
  const tv=CFG.tv();
  const cfg=tvListCfg(tv);
  const now=useNow(5000);
  const [drag,setDrag]=useState(null);
  const [over,setOver]=useState(null);
  const save=patch=>Actions.saveConfig('tv',{slides:patch});
  const move=(k,d)=>{const o=[...cfg.order],i=o.indexOf(k),j=i+d;if(j<0||j>=o.length)return;[o[i],o[j]]=[o[j],o[i]];save({order:o});};
  const drop=to=>{if(!drag||drag===to)return;const o=cfg.order.filter(x=>x!==drag);o.splice(o.indexOf(to)+(cfg.order.indexOf(drag)<cfg.order.indexOf(to)?1:0),0,drag);save({order:o});setDrag(null);setOver(null);};
  const toggle=(k,on)=>{save({on:{[k]:on}});if(BOARD_DEF.some(b=>b.id===k)) Actions.saveConfig('tv',{boards:{[k]:on}});};
  const setSec=(k,v)=>save({sec:{[k]:Math.max(5,Math.min(600,Math.round(+v)||15))}});
  const reset=()=>Actions.saveConfig('tv',{slides:{order:TV_ITEMS.map(x=>x.k),sec:Object.fromEntries(TV_ITEMS.map(x=>[x.k,x.sec]))}});
  const data=boardData(),scoped=scopedMatches();
  const why=k=>{
    if(k==='race') return tvLiveMatch(tv,now)?'':'진행 중인 경기가 없으면 건너뜁니다';
    if(k==='next') return nextMatch(scoped,now)?'':'예정된 경기가 없으면 건너뜁니다';
    if(k==='schedule') return scoped.length?'':'경기가 없으면 건너뜁니다';
    return slideCount(k,data)>0?'':'아직 기록이 없어 건너뜁니다';
  };
  const total=cfg.order.filter(k=>cfg.on[k]&&!why(k)).reduce((a,k)=>a+cfg.sec[k],0);
  const locked=tvLocked(tv,now);
  return html`<div class="tvl">
    ${tv.scene&&tv.scene!=='auto'&&tv.scene!=='top10'?html`<div class="banner warn small">지금은 「TV 화면 구성」이 <b>${{race:'경기 현황 고정',next:'다음 경기 안내 고정',schedule:'경기 일정 고정'}[tv.scene]}</b>이라 이 목록대로 넘기지 않습니다. <button class="linkish" onClick=${()=>Actions.saveConfig('tv',{scene:'auto'})}>목록대로 넘기기로 바꾸기</button></div>`:null}
    <label class="toggle tvl-lock"><input id="tv-livelock" type="checkbox" checked=${tv.liveLock!==false} onChange=${e=>Actions.saveConfig('tv',{liveLock:e.target.checked})}/><span><b>경기 중에는 경기 현황만 보여 주기</b><em>${tv.liveLock!==false?'경기가 진행 중이면 목록과 상관없이 경기 현황에 머뭅니다. 끄면 경기 중에도 아래 순서대로 넘깁니다.':'경기 중에도 아래 순서대로 넘깁니다(경기 현황은 목록의 한 칸).'}${locked?' · 지금 경기 중이라 고정되어 있습니다':''}</em></span></label>
    <ol class="tvl-list">${cfg.order.map((k,i)=>{
      const it=TV_ITEM[k],on=cfg.on[k],w=on?why(k):'';
      return html`<li key=${k} class=${'tvl-row'+(on?'':' off')+(drag===k?' drag':'')+(over===k&&drag&&drag!==k?' over':'')}
        onDragOver=${e=>{if(drag){e.preventDefault();setOver(k);}}} onDrop=${e=>{e.preventDefault();drop(k);}}>
        <span class="tvl-grip" draggable="true" title="끌어서 순서 바꾸기" onDragStart=${e=>{setDrag(k);try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',k);e.dataTransfer.setDragImage(e.currentTarget.parentNode,20,20);}catch(x){}}} onDragEnd=${()=>{setDrag(null);setOver(null);}}>⋮⋮</span>
        <span class="tvl-no num">${i+1}</span>
        <label class="tvl-main"><input type="checkbox" id=${'tvl-on-'+k} checked=${on} onChange=${e=>toggle(k,e.target.checked)}/>
          <span><b>${it.label}</b>${it.desc||w?html`<small>${w?html`<em>${w}</em>${it.desc?' · ':''}`:null}${it.desc||''}</small>`:null}</span></label>
        <label class="tvl-sec"><input type="number" min="5" max="600" step="5" id=${'tvl-sec-'+k} value=${cfg.sec[k]} disabled=${!on} onChange=${e=>setSec(k,e.target.value)}/><span>초</span></label>
        <span class="tvl-mv">
          <button type="button" class="icon-btn" aria-label=${it.label+' 위로'} disabled=${i===0} onClick=${()=>move(k,-1)}><${Icon} n="up" s=${15}/></button>
          <button type="button" class="icon-btn" aria-label=${it.label+' 아래로'} disabled=${i===cfg.order.length-1} onClick=${()=>move(k,1)}><${Icon} n="down" s=${15}/></button>
        </span>
      </li>`;
    })}</ol>
    <div class="tvl-foot"><span class="dim">한 바퀴 약 ${Math.floor(total/60)?Math.floor(total/60)+'분 ':''}${total%60}초 · 내용이 없는 화면은 자동으로 건너뜁니다 · 긴급 공지는 아래 안내 띠에 나옵니다</span><span class="spacer"></span><button class="btn btn-sm btn-ghost" onClick=${reset}>처음 순서로</button></div>
  </div>`;
}
/** 오래 '진행 중'으로 남은 경기 알림: TV가 그 경기에 묶이지 않게 종료 처리를 권한다 */
function StaleLiveBanner(){
  useStore();
  const now=useNow(30000);
  const stale=matchesSorted().filter(m=>m.status==='live'&&liveStale(m,now));
  if(!stale.length||!Store.canWrite()) return null;
  return html`<div class="banner warn lr-stale">${stale.map(m=>{
    const ev=Math.max(m.startedAt||0,...runsOfMatch(m).map(lastEventTime));
    const mins=Math.round((now-ev)/60000);
    return html`<div key=${m.id} class="lr-stale-row"><span><b>${m.title}</b>${m.sample?' (예시)':''}이(가) ${mins>=1440?Math.floor(mins/1440)+'일':mins>=60?Math.floor(mins/60)+'시간':mins+'분'} 동안 기록 없이 「진행 중」으로 남아 있습니다. TV는 이 경기에 고정하지 않고 목록대로 넘깁니다.</span>
      <span class="lr-stale-act"><button class="btn btn-sm" onClick=${()=>opsGo(m)}>경기 운영에서 보기</button><button class="btn btn-sm btn-primary" onClick=${()=>{Actions.finishMatch(m.id);toast(m.title+' 경기를 종료 처리했습니다.','ok');}}>경기 종료 처리</button></span></div>`;
  })}</div>`;
}
function SimCard(){
  useStore();
  const [speed,setSpeed]=useLocal('ui.simSpeed',20);
  const samples=matchesSorted().filter(m=>m.sample);
  const [mid,setMid]=useState(null);
  const a=Sim.active;
  const pick=(a&&samples.find(m=>m.id===a.matchId))||samples.find(m=>m.id===mid)||samples.find(m=>m.status==='tbd')||samples[0];
  const staleLive=!a&&samples.find(m=>m.status==='live');
  return html`<div class="sim">
    <p>예시 학급으로 가상 경기를 재생합니다. 실제 버튼 입력과 같은 경로로 처리되므로 TV·순위·TOP 10이 함께 움직입니다. 결과는 “예시”로 표시됩니다.</p>
    ${samples.length?html`<div class="sim-row">
      <select id="sim-match" class="select" aria-label="예시 경기" value=${pick&&pick.id} disabled=${!!a} onChange=${e=>setMid(e.target.value)}>
        ${samples.map(m=>html`<option key=${m.id} value=${m.id}>${m.title} (${(STATUS[m.status]||STATUS.tbd).t})</option>`)}
      </select>
      <div class="seg" role="group" aria-label="재생 속도">
        ${[10,20,40].map(v=>html`<button key=${v} aria-pressed=${String(speed===v)} disabled=${!!a} onClick=${()=>setSpeed(v)}>${v}배속</button>`)}
      </div>
      ${a?html`<button id="sim-stop" class="btn btn-stop" onClick=${()=>Sim.stop()}><${Icon} n="stop" s=${15}/> 중지</button>`
      :html`<button id="sim-start" class="btn btn-go" onClick=${()=>pick&&Sim.start(pick.id,speed)}><${Icon} n="play" s=${15}/> 시뮬레이션 시작</button>`}
    </div>
    ${a?html`<p class="sim-live"><i class="live-dot"></i> ${Store.doc('matches',a.matchId)?.title} 재생 중 · 이 창을 닫으면 멈춥니다.</p>`:null}
    ${staleLive?html`<p class="field-hint">${staleLive.title}이(가) 진행 상태로 남아 있습니다. <button class="linklike" onClick=${()=>Actions.resetMatch(staleLive.id,'sim')}>미정으로 되돌리기</button></p>`:null}`
    :html`<button class="btn" onClick=${()=>Actions.loadSample()}>예시 데이터 불러오기</button>`}
  </div>`;
}
function BroadcastPage(){
  useStore();
  SD.useStore();
  const can=Store.canWrite();
  const tvN=Live.count('tv'),camN=Live.count('camera');
  return html`<div class="page">
    <div class="broadcast-top">
      <div class="ltv-frame-wrap">
        <div class="ltv-frame"><${TvBody} embedded/></div>
      </div>
      <${Panel} title="TV 송출" class="tv-launch">
        <p class="dim">전자칠판의 브라우저에서 SDSMP를 열고, 종목을 레이저런으로 고른 뒤 아래 버튼을 눌러 전체 화면으로 전환합니다.</p>
        <button id="open-tv" class="btn btn-primary btn-lg btn-block" onClick=${()=>navigate('tv')}><${Icon} n="full" s=${17}/> TV 화면 열기</button>
        <dl class="lr-conn">
          <div><dt>연결된 TV 화면</dt><dd class="num">${SD.S.room?tvN:'—'}</dd></div>
          ${can?html`<div><dt>촬영 중인 휴대폰</dt><dd class="num">${SD.S.room?camN:'—'}</dd></div>`:null}
        </dl>
      <//>
    </div>
    ${can?html`<${StaleLiveBanner}/>`:null}
    ${can?html`<div class="grid-2">
      <${Panel} title="화면 순서 · 시간" right=${html`<span class="dim small">끌거나 ▲▼로 순서 · 체크로 켜고 끄기</span>`}><${TvListPanel}/><//>
      <${Panel} title="화면 구성 · 안내 문구"><${TvControlPanel}/><//>
      <${Panel} title="예시 경기 시뮬레이션"><${SimCard}/><//>
      <${Panel} title="사진 · 영상 관리"><${MediaManager}/><//>
      <${Panel} title="휴대폰 영상 송출 방법"><${RelayCard}/><//>
    </div>`:null}
  </div>`;
}

/* ---------- 휴대폰 촬영 화면 (#camera) ---------- */
function CameraPage(){
  useStore();
  useEffect(()=>{SD.setPresence({lrCam:true});return()=>SD.setPresence({lrCam:null});},[]);
  const [segment,setSegment]=useLocal('cam.seg',SEGMENTS[0]);
  const [by,setBy]=useLocal('cam.by','');
  const [state,setState]=useState({busy:false,msg:'',err:''});
  const live=matchesSorted().find(m=>m.status==='live');
  const list=Store.list('media').filter(m=>m.kind!=='link').sort((a,b)=>b.at-a.at).slice(0,6);
  const tv=CFG.tv();
  const send=async f=>{
    setState({busy:true,msg:'올리는 중… ('+fmtBytes(f.size)+')',err:''});
    try{
      await addVideoOrImage(f,{segment,matchId:live&&live.id,by:by||'휴대폰',title:segment+' 구간 '+fmtClock(Live.now())});
      setState({busy:false,msg:'TV로 보냈습니다. 이어서 촬영할 수 있습니다.',err:''});
    }catch(e){setState({busy:false,msg:'',err:uploadErrorText(e)});}
  };
  const can=MediaStore.canUpload();
  const vid=MediaStore.canVideo();
  const links=tv.relayId?relayLinks(tv.relayId):null;
  return html`<div class="cam-main">
    <p class="dim">${live?live.title+' 진행 중':'진행 중인 경기 없음'}</p>
    <section>
      <span class="kicker">촬영 구간</span>
      <div class="cam-segs">${SEGMENTS.map(s=>html`<button key=${s} class=${segment===s?'on':''} onClick=${()=>setSegment(s)}>${s}</button>`)}</div>
    </section>
    <section class="cam-actions">
      ${can?html`
        ${vid?html`<${FilePick} id="cam-video" accept="video/*" capture="environment" onFile=${send} class="cam-btn primary" disabled=${state.busy}><${Icon} n="camera" s=${26}/><span>영상 촬영 후 TV로 보내기</span><small>10초 안팎 권장 · 20MB까지</small><//>`:null}
        <${FilePick} id="cam-photo" accept="image/*" capture="environment" onFile=${send} class=${vid?'cam-btn':'cam-btn primary'} disabled=${state.busy}><${Icon} n="image" s=${vid?22:26}/><span>사진 촬영 후 TV로 보내기</span><//>
        <${FilePick} id="cam-file" accept=${vid?'video/*,image/*':'image/*'} onFile=${send} class="cam-btn" disabled=${state.busy}><${Icon} n="upload" s=${22}/><span>앨범에서 선택</span><//>
      `:html`<p class="cam-err">이 계정은 파일을 올릴 수 없습니다. 편집 권한이 있는 계정으로 접속해 주세요.</p>`}
      ${state.msg?html`<p class="cam-msg" role="status">${state.msg}</p>`:null}
      ${state.err?html`<p class="cam-err" role="alert">${state.err}</p>`:null}
    </section>
    ${links?html`<section class="cam-live">
      <span class="kicker">끊김 없는 실시간 중계</span>
      <a class="btn btn-block" href=${links.push} target="_blank" rel="noopener noreferrer"><${Icon} n="link" s=${15}/> 중계 도구 열기 (VDO.Ninja)</a>
      <p class="field-hint">카메라를 후면으로 고른 뒤 시작을 누르세요. 전자칠판에서 중계 창을 함께 열어야 합니다.</p>
    </section>`:null}
    <section>
      <${Field} label="촬영자"><input id="cam-by" value=${by} placeholder="홍보부 이름" onInput=${e=>setBy(e.target.value)}/><//>
    </section>
    <section>
      <span class="kicker">최근 보낸 항목</span>
      ${list.length?html`<ul class="cam-list">${list.map(m=>html`<li key=${m.id}><strong>${m.title||m.segment}</strong><span class="dim">${fmtStamp(m.at)}${m.sizeBytes?' · '+fmtBytes(m.sizeBytes):''}</span></li>`)}</ul>`:html`<p class="dim">아직 보낸 항목이 없습니다.</p>`}
    </section>
  </div>`;
}

/* ---------- 설정 ---------- */
function EventSettings(){
  useStore();
  const st=CFG.settings();
  const [name,setName]=useState(st.eventName);
  const [kr,setKr]=useState(st.eventKr);
  const [recorders,setRecorders]=useState((st.recorders||[]).join(', '));
  const open=Flag.open;
  const flip=async()=>{
    const ok=await askConfirm(open
      ?{title:'다시 관리자만 보기',body:'보기 전용 계정에는 레이저런이 다시 “준비 중”으로 표시됩니다. 기록은 지워지지 않습니다.',ok:'관리자만 보기'}
      :{title:'레이저런 전체 공개',body:'모든 계정이 레이저런 일정·순위·TV 화면을 볼 수 있게 됩니다. 풋살이 끝난 뒤에 눌러 주세요. 풋살 기록과 화면에는 영향이 없습니다.',ok:'전체 공개'});
    if(ok) Actions.saveConfig('app',{open:!open});
  };
  return html`${window.SD_LASER_ONLY?null:html`<${Panel} title="공개 범위" right=${open?html`<span class="chip ok">전체 공개 중</span>`:html`<span class="chip">관리자만</span>`}>
    <p class="dim">${open?'지금은 모든 계정이 레이저런을 볼 수 있습니다. 기록 입력과 설정은 편집 권한이 있는 계정만 할 수 있습니다.':'지금은 편집 권한이 있는 계정만 레이저런을 볼 수 있습니다. 보기 전용 계정의 종목 선택에는 “준비 중”으로 표시됩니다.'}</p>
    <div class="course-btns"><button id="lr-open" class=${open?'btn':'btn btn-primary'} onClick=${flip}>${open?'다시 관리자만 보기':'전체 공개하기'}</button></div>
  <//>`}
  <${Panel} title="대회 정보">
    <div class="form-grid">
      <${Field} label="대회 이름 (영문)" grow hint="TV 상단과 SNS 카드에 표시됩니다."><input id="set-name" value=${name} onInput=${e=>setName(e.target.value)} onChange=${e=>Actions.saveConfig('settings',{eventName:e.target.value})}/><//>
      <${Field} label="대회 이름 (한글)" grow hint="SNS 카드와 리캡 영상에 표시됩니다."><input id="set-kr" value=${kr} onInput=${e=>setKr(e.target.value)} onChange=${e=>Actions.saveConfig('settings',{eventKr:e.target.value})}/><//>
      <${Field} label="사로 수"><input id="set-lanes" type="number" min="1" max="12" value=${st.laneCount} onChange=${e=>Actions.saveConfig('settings',{laneCount:clamp(+e.target.value||6,1,12)})}/><//>
      <${Field} label="기록원 추가" grow hint="쉼표로 구분합니다. 풋살 심판·기록원은 자동으로 목록에 나옵니다."><input id="set-recorders" value=${recorders} onInput=${e=>setRecorders(e.target.value)} onChange=${e=>Actions.saveConfig('settings',{recorders:e.target.value.split(',').map(s=>s.trim()).filter(Boolean)})}/><//>
    </div>
  <//>
  <${LaneColorPanel}/>`;
}
/** 사로별 조끼 색: 고른 색이 기록 화면과 TV 코스, 마지막 주자 도착 버튼에 쓰인다. */
function LaneColorPanel(){
  useStore();
  const st=CFG.settings();
  const lanes=Array.from({length:st.laneCount},(_,i)=>i+1);
  return html`<${Panel} title="사로별 조끼 색" right=${html`<button id="vest-reset" class="btn btn-sm btn-ghost" onClick=${()=>Actions.saveConfig('settings',{laneColors:null})}>기본 색으로</button>`}>
    <p class="dim">조끼 색을 고르면 기록 화면과 TV 코스의 로고 테두리·진행 막대, 마지막 주자의 최종 도착 버튼에 같은 색이 쓰입니다.</p>
    <div class="lr-vests">${lanes.map(n=>html`<label class="lr-vest" key=${n}>
      <span class="lane-tag" style=${vestStyle(n)}>${n}사로</span>
      <input id=${'vest-'+n} type="color" aria-label=${n+'사로 조끼 색'} value=${vestColor(n)} onChange=${e=>Actions.saveConfig('settings',{laneColors:{[n]:e.target.value}})}/>
    </label>`)}</div>
  <//>`;
}
function ClassSettings(){
  useStore();
  const list=classesSorted();
  const real=list.filter(c=>!c.sample);
  const sampleN=list.length-real.length;
  const has=id=>!!Store.doc('classes',id);
  const addClass=(g,n)=>{
    const id=g+'-'+n;
    if(has(id)) return false;
    Store.set('classes',id,{id,grade:g,num:n,color:CLASS_COLORS[(n-1)%CLASS_COLORS.length],players:[],posterId:null,sample:false});
    ActLog.add('참가 반 추가: '+g+'학년 '+n+'반');
    return true;
  };
  const toggle=async(g,n)=>{
    const id=g+'-'+n;
    if(!has(id)){addClass(g,n);return;}
    const c=Store.doc('classes',id);
    const recs=allRecords().filter(r=>r.classId===id).length;
    const inMatch=Store.list('matches').filter(m=>(m.classIds||[]).includes(id)).length;
    if(recs||inMatch||(c.players||[]).length){
      const ok=await askConfirm({title:'참가 반 해제',body:className(c)+'을(를) 참가 반에서 뺍니다.'+((c.players||[]).length?' 등록한 선수 명단이 지워지고,':'')+(inMatch?' 경기 '+inMatch+'개에서 빠지며,':'')+(recs?' 기록 '+recs+'건이 순위에서 빠집니다.':' 기록은 없습니다.'),ok:'해제',danger:true});
      if(!ok) return;
    }
    Actions.deleteClass(id);
  };
  const allOf=g=>{let made=0;for(let n=1;n<=12;n++)if(addClass(g,n))made++;toast(made?g+'학년 '+made+'개 반을 추가했습니다.':g+'학년은 이미 모두 참가 중입니다.');};
  return html`
  <${Panel} title="참가 반 선택" right=${html`<span class="dim">${real.length}개 반 참가</span>`}>
    <p class="dim">참가하는 반의 로고를 누릅니다. 로고는 풋살과 같은 학급 로고를 쓰고, 풋살 기록에는 아무 영향이 없습니다.</p>
    <div class="lr-pick">
      ${[1,2,3].map(g=>html`<div class="lr-pick-row" key=${g}>
        <div class="lr-pick-head"><b>${g}학년</b><button class="btn btn-sm" onClick=${()=>allOf(g)}>전체 추가</button></div>
        <div class="lr-pick-grid">
          ${Array.from({length:12},(_,i)=>i+1).map(n=>{
            const id=g+'-'+n,on=has(id);
            return html`<button key=${id} id=${'pick-'+id} type="button" class="lr-pick-item ${on?'on':''}" aria-pressed=${String(on)} onClick=${()=>toggle(g,n)}>
              <img src=${SD.logoUrl(id)} alt="" loading="lazy"/><span>${n}반</span>${on?html`<i aria-hidden="true"><${Icon} n="check" s=${13}/></i>`:null}
            </button>`;
          })}
        </div>
      </div>`)}
    </div>
    ${sampleN?html`<p class="field-hint">예시 학급 ${sampleN}개는 설정 → 데이터에서 한 번에 지울 수 있습니다.</p>`:null}
  <//>
  <${Panel} flush title="참가 학급 정보" right=${html`<span class="dim">${list.length}개 학급</span>`}>
    ${list.length?html`<div class="tbl-wrap"><table class="tbl tbl-compact">
      <thead><tr><th>학급</th><th>명단</th><th>구분</th></tr></thead>
      <tbody>${list.map(c=>html`<tr key=${c.id}>
        <td><${ClassName} cls=${c}/></td>
        <td>${(c.players||[]).length}명 ${rosterIssue(c)?html`<span class="chip chip-delay">${rosterIssue(c)}</span>`:html`<span class="chip ok">남3 · 여3</span>`}</td>
        <td>${c.sample?html`<${SampleChip}/>`:html`<${RealChip}/>`}</td>
      </tr>`)}</tbody>
    </table></div>`:html`<${EmptyState} title="참가 반이 없습니다.">위에서 참가하는 반을 골라 주세요.<//>`}
  <//>`;
}
/** 풋살 명단에서 이 학급 선수를 찾는다. 풋살 문서는 읽기만 한다. */
function futsalRoster(c){
  if(!c||c.sample) return [];
  const key=logoKey(c);
  return Object.entries(SD.S.players||{}).map(([id,p])=>({id,...p})).filter(p=>p.cls===key&&p.name).sort((a,b)=>String(a.name).localeCompare(String(b.name),'ko'));
}
function parseRosterLines(text){
  const rows=[],bad=[];
  text.split(/\r?\n/).forEach((line,i)=>{
    const t=line.trim();
    if(!t) return;
    const p=t.split(/\t|,|\s+/).filter(Boolean);
    if(p.length<4){bad.push(i+1);return;}
    const g=parseInt(p[0],10),n=parseInt(p[1],10),name=p[2],gRaw=p[3];
    const gender=/^(남|남자|m|male)$/i.test(gRaw)?'M':/^(여|여자|f|female)$/i.test(gRaw)?'F':null;
    if(!g||!n||!gender){bad.push(i+1);return;}
    rows.push({grade:g,num:n,name,gender});
  });
  return {rows,bad};
}
function RosterSettings(){
  useStore();
  const list=classesSorted();
  const [cid,setCid]=useLocal('ui.rosterClass',null);
  const c=(cid&&Store.doc('classes',cid))||list[0]||null;
  const [paste,setPaste]=useState('');
  const parsed=useMemo(()=>parseRosterLines(paste),[paste]);
  const players=(c&&c.players)||[];
  const update=(i,p)=>{const next=players.map((x,k)=>k===i?{...x,...p}:x);Actions.saveRoster(c.id,next);};
  const addP=()=>{
    const g=players.filter(p=>p.gender==='M').length<3?'M':'F';
    Actions.saveRoster(c.id,[...players,{id:uid('p_'),name:'',gender:g}]);
  };
  const delP=i=>Actions.saveRoster(c.id,players.filter((_,k)=>k!==i));
  const move=(i,d)=>{const n=[...players];[n[i],n[i+d]]=[n[i+d],n[i]];Actions.saveRoster(c.id,n);};
  const applyPaste=()=>{
    const byClass={};
    parsed.rows.forEach(r=>{(byClass[r.grade+'-'+r.num]=byClass[r.grade+'-'+r.num]||[]).push(r);});
    let cCount=0;
    Object.values(byClass).forEach(rows=>{
      const {grade,num}=rows[0];
      let doc=list.find(x=>!x.sample&&+x.grade===grade&&+x.num===num);
      const ps=rows.map(r=>{const old=doc&&(doc.players||[]).find(p=>p.name===r.name);return {id:old?old.id:uid('p_'),name:r.name,gender:r.gender};});
      if(doc) Actions.saveRoster(doc.id,ps);
      else{
        const id=grade+'-'+num;
        Store.set('classes',id,{id,grade,num,color:CLASS_COLORS[(num-1)%CLASS_COLORS.length],players:ps,posterId:null,sample:false});
      }
      cCount++;
    });
    toast(cCount+'개 학급, '+parsed.rows.length+'명을 등록했습니다.','ok');
    setPaste('');
  };
const futsal=futsalRoster(c);
const addFutsal=p=>{
  const g=p.div==='W'?'F':'M';
  if(players.some(x=>x.fid===p.id||x.name===p.name)) return;
  Actions.saveRoster(c.id,[...players,{id:uid('p_'),name:p.name,gender:g,fid:p.id}]);
};
const inRoster=p=>players.some(x=>x.fid===p.id||x.name===p.name);
const futsalList=(div,label,cls)=>{
  const rows=futsal.filter(p=>p.div===div);
  return html`<div class="lr-fs-col"><span class="chip ${cls}">${label}</span>
    ${rows.length?html`<div class="lr-fs-list">${rows.map(p=>html`<button key=${p.id} type="button" class="pickbtn ${inRoster(p)?'on':''}" disabled=${inRoster(p)} onClick=${()=>addFutsal(p)}>${p.name}</button>`)}</div>`:html`<span class="dim small">명단 없음</span>`}
  </div>`;
};
return html`<div class="grid-2 grid-roster">
  <${Panel} flush title="참가자 정보" right=${list.length?html`<select id="roster-class" class="select" aria-label="학급 선택" value=${c&&c.id} onChange=${e=>setCid(e.target.value)}>${list.map(x=>html`<option key=${x.id} value=${x.id}>${className(x)}${x.sample?' (예시)':''}</option>`)}</select>`:null}>
      ${c?html`
        <div class="roster-status">${rosterIssue(c)?html`<span class="chip chip-delay">${rosterIssue(c)}</span>`:html`<span class="chip ok">남3 · 여3 구성 완료</span>`}<span class="dim">출전 순서는 남·여 번갈아 자동으로 정해집니다. 경기별로 바꾸려면 기록 관리 → 출전 순서로 가세요.</span></div>
        <div class="tbl-wrap"><table class="tbl tbl-compact roster-tbl">
          <thead><tr><th class="c-rank">순번</th><th>이름</th><th>성별</th><th class="c-act">관리</th></tr></thead>
          <tbody>${players.map((p,i)=>html`<tr key=${p.id}>
            <td class="c-rank num">${i+1}</td>
            <td><input class="input" id=${'p-name-'+p.id} aria-label=${(i+1)+'번 이름'} value=${p.name} placeholder="이름" onChange=${e=>update(i,{name:e.target.value})}/></td>
            <td><div class="seg"><button class="men" aria-pressed=${String(p.gender==='M')} onClick=${()=>update(i,{gender:'M'})}>남</button><button class="women" aria-pressed=${String(p.gender==='F')} onClick=${()=>update(i,{gender:'F'})}>여</button></div></td>
            <td class="c-act"><div class="row-act">
              <button class="icon-btn" aria-label="위로" disabled=${i===0} onClick=${()=>move(i,-1)}><${Icon} n="up" s=${15}/></button>
              <button class="icon-btn" aria-label="아래로" disabled=${i===players.length-1} onClick=${()=>move(i,1)}><${Icon} n="down" s=${15}/></button>
              <button class="icon-btn" aria-label="삭제" onClick=${()=>delP(i)}><${Icon} n="trash" s=${15}/></button>
            </div></td>
          </tr>`)}</tbody>
        </table></div>
        <div class="panel-foot"><button id="roster-add" class="btn" onClick=${addP}><${Icon} n="plus" s=${15}/> 선수 추가</button></div>
      `:html`<${EmptyState} title="참가 반을 먼저 골라 주세요."/>`}
    <//>
    <div class="lr-roster-side">
    ${c&&!c.sample?html`<${Panel} title="풋살 명단에서 가져오기" right=${html`<span class="dim">${className(c)}</span>`}>
      ${futsal.length?html`<p class="dim">이름을 누르면 레이저런 명단에 추가됩니다. 풋살 명단은 바뀌지 않습니다.</p>
      <div class="lr-fs">${futsalList("M","남자부","men")}${futsalList("W","여자부","women")}</div>`
      :html`<p class="dim">풋살 명단에 이 학급 선수가 없습니다. 왼쪽에서 직접 추가하거나 엑셀로 붙여 넣어 주세요.</p>`}
    <//>`:null}
    <${Panel} title="엑셀 명단 붙여넣기">
      <p class="dim">엑셀에서 <b>학년, 반, 이름, 성별</b> 순서의 칸을 복사해 붙여 넣습니다. 없는 학급은 참가 반에 추가되고, 있는 학급은 레이저런 명단이 교체됩니다.</p>
      <textarea id="roster-paste" class="textarea" rows="7" placeholder=${'2\t5\t김민수\t남\n2\t5\t이서연\t여'} value=${paste} onInput=${e=>setPaste(e.target.value)}></textarea>
      <div class="paste-foot">
        <span class=${parsed.bad.length?'field-error':'dim'}>${parsed.rows.length}명 인식${parsed.bad.length?' · '+parsed.bad.slice(0,5).join(', ')+'번째 줄 확인 필요':''}</span>
        <button id="roster-apply" class="btn btn-primary" disabled=${!parsed.rows.length} onClick=${applyPaste}>명단 등록</button>
      </div>
    <//>
    </div>
  </div>`;
}
function ImageSettings(){
  useStore();
  const list=classesSorted();
  const [busy,setBusy]=useState({});
  const up=async(c,f)=>{
    setBusy(b=>({...b,[c.id]:true}));
    try{
      const r=await MediaStore.put(f,f.type||'image/jpeg');
      if(c.posterId) MediaStore.del(c.posterId);
      Store.merge('classes',c.id,{posterId:r.id});
      toast(className(c)+' 포스터를 등록했습니다.','ok');
    }catch(e){toast(uploadErrorText(e),'error');}
    setBusy(b=>({...b,[c.id]:false}));
  };
  const rm=c=>{MediaStore.del(c.posterId);Store.merge('classes',c.id,{posterId:null});};
  if(!list.length) return html`<${Panel}><${EmptyState} title="참가 반을 먼저 골라 주세요."/><//>`;
  return html`<${Panel} title="반별 포스터 등록" right=${html`<span class="dim">다음 경기 안내 화면에 표시됩니다.</span>`}>
    <div class="img-grid">
      ${list.map(c=>html`<div class="img-card" key=${c.id}>
        <header><${ClassName} cls=${c}/>${c.sample?html`<${SampleChip}/>`:null}</header>
        <${ImageSlot} label="포스터" wide assetId=${c.posterId} busy=${busy[c.id]} onFile=${f=>up(c,f)} onRemove=${()=>rm(c)}/>
      </div>`)}
    </div>
  <//>`;
}
const Toggle=({id,on,onChange,label,hint})=>html`<label class="toggle"><input id=${id} type="checkbox" checked=${on} onChange=${e=>onChange(e.target.checked)}/><span><b>${label}</b>${hint?html`<em>${hint}</em>`:null}</span></label>`;
function RuleSettings(){
  useStore();
  const st=CFG.settings();
  const save=p=>Actions.saveConfig('settings',p);
    return html`<div class="grid-2">
    <${Panel} title="페널티">
      <div class="form-grid">
        <${Field} label="필수 명중 수" hint="이보다 적게 맞추고 출발하면 페널티"><input id="rule-hits" type="number" min="1" max="10" value=${st.requiredHits} onChange=${e=>save({requiredHits:clamp(+e.target.value||5,1,10)})}/><//>
        <${Field} label="부족 1발당 페널티">
          <${TimeField} idBase="rule-pen" value=${st.penaltyPerMissCs} onChange=${(v,ok)=>{if(ok&&v!=null)save({penaltyPerMissCs:v});}}/>
        <//>
      </div>
      <${Toggle} id="rule-include" on=${st.includePenalty} onChange=${v=>save({includePenalty:v})} label="최종 기록에 페널티 포함"/>
      <p class="formula">최종 기록 = 주행 + 사격${st.includePenalty?' + 페널티':''}<br/><small>예: 5발 중 4발 명중 → 페널티 ${fmtPen(st.penaltyPerMissCs)}</small></p>
    <//>
    <${Panel} title="기록 계산 방식">
      <div class="form-grid">
        <${Field} label="소수 둘째 자리 처리" grow>
          <select id="rule-round" class="select" value=${st.rounding} onChange=${e=>save({rounding:e.target.value})}>
            <option value="floor">버림</option><option value="round">반올림</option><option value="ceil">올림</option>
          </select>
        <//>
        <${Field} label="학급 팀 기록" grow>
          <select id="rule-team" class="select" value=${st.teamCalc} onChange=${e=>save({teamCalc:e.target.value})}>
            <option value="sum">선수 6명 최종 기록의 합계</option>
            <option value="lap">전체 랩타임 + 페널티 합계</option>
          </select>
        <//>
      </div>
      <${Toggle} id="rule-best" on=${st.bestOnly} onChange=${v=>save({bestOnly:v})} label="순위에 선수별 최고 기록만 반영" hint="한 선수가 여러 경기에 나와도 한 번만 집계합니다."/>
    <//>
    <${Panel} title="경기 진행 방식">
      <${Toggle} id="rule-return" on=${st.returnRun} onChange=${v=>save({returnRun:v})} label="사격 후 도착 지점까지 달리는 구간 사용" hint="끄면 사격 완료가 곧 그 선수의 도착이 됩니다. 시작 전 경기부터 적용됩니다."/>
      <${Toggle} id="rule-auto" on=${st.autoNextStart} onChange=${v=>save({autoNextStart:v})} label="앞 주자 도착 시 다음 주자 자동 출발" hint="릴레이 터치와 동시에 다음 주자의 시간이 시작됩니다."/>
      <${Toggle} id="rule-finish" on=${st.autoFinishMatch} onChange=${v=>save({autoFinishMatch:v})} label="모든 학급 완주 시 경기 자동 종료"/>
    <//>
    <${Panel} title="TV 코스 이동 예상 시간">
      <p class="dim">버튼을 누르기 전까지 로고 위치는 이 시간으로 추정합니다. 같은 경기에서 앞 주자 기록이 쌓이면 그 평균을 씁니다. 순위는 실제 입력된 구간 기록으로만 계산합니다.</p>
      <div class="form-grid">
        <${Field} label="출발 → 사로 도착 (초)"><input id="rule-e1" type="number" min="5" value=${st.expectedRun1Sec} onChange=${e=>save({expectedRun1Sec:Math.max(5,+e.target.value||210)})}/><//>
        <${Field} label="사격 후 → 도착 (초)"><input id="rule-e2" type="number" min="1" value=${st.expectedRun2Sec} onChange=${e=>save({expectedRun2Sec:Math.max(1,+e.target.value||45)})}/><//>
      </div>
    <//>
  </div>`;
}
function CourseSettings(){
  useStore();
  const saved=CFG.course();
  const st=CFG.settings();
  const [pts,setPts]=useState(saved.points);
  const [rangeAt,setRangeAt]=useState(saved.rangeAt);
  const [angle,setAngle]=useState(saved.rangeAngle);
  const [dim,setDim]=useState(saved.bgDim);
  const [preset,setPreset]=useState(saved.bgPreset);
  const [k,setK]=useState(saved.markScale);
  const [rs,setRs]=useState(saved.rangeScale);
  const [busy,setBusy]=useState(false);
  const [drag,setDrag]=useState(null);
  const [draw,setDraw]=useState(false);
  const svgRef=useRef(null);
  const geo=useMemo(()=>buildCourse(pts),[pts]);
  const ra=rangeAt==null?defaultRangeAt(geo,preset):rangeAt;
  const toLocal=e=>{
    const svg=svgRef.current;
    const pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;
    const r=pt.matrixTransform(svg.getScreenCTM().inverse());
    return {x:Math.round(clamp(r.x,0,1000)),y:Math.round(clamp(r.y,0,560))};
  };
  const save=()=>{
    Actions.saveConfig('course',{points:pts,rangeAt:ra,rangeAngle:angle,bgDim:dim,bgPreset:preset,markScale:k,rangeScale:rs});
    toast('코스를 저장했습니다. TV 화면에 바로 반영됩니다.','ok');
  };
  // 기본 배경 바꾸기: 저장된 경로가 없으면 그 배경에 맞는 기본 경로·크기로 함께 바꾼다
  const pickPreset=v=>{
    setPreset(v);
    if(!saved.custom){setPts(presetPoints(v));setRangeAt(null);setAngle(0);}
    if(!saved.bgId){setK(v==='field'?1:0.55);setRs(v==='field'?1:0.65);setDim(v==='field'?0.45:0.3);}
  };
  const up=async f=>{
    setBusy(true);
    try{
      const r=await MediaStore.put(f,f.type||'image/jpeg');
      if(saved.bgId) MediaStore.del(saved.bgId);
      Actions.saveConfig('course',{bgId:r.id,points:pts,rangeAt:ra,rangeAngle:angle,bgDim:dim,bgPreset:preset,markScale:k,rangeScale:rs});
      toast('코스 사진을 등록했습니다. 사진 위에 경로를 그려 주세요.','ok');
    }catch(e){toast(uploadErrorText(e),'error');}
    setBusy(false);
  };
  const restore=()=>{setPts(presetPoints(preset));setRangeAt(null);setAngle(0);};
  return html`<${Panel} title="코스 일러스트 · 사진" right=${html`<button id="course-save" class="btn btn-primary" onClick=${save}>코스 저장</button>`}>
    <div class="course-edit">
      <div class="course-stage" onPointerMove=${e=>{if(drag!=null){const p=toLocal(e);setPts(a=>a.map((x,i)=>i===drag?p:x));}}} onPointerUp=${()=>setDrag(null)} onPointerLeave=${()=>setDrag(null)}>
        <${CourseSvg} svgRef=${svgRef} geo=${geo} rangeAt=${ra} rangeAngle=${angle} laneCount=${st.laneCount} bgId=${saved.bgId} bgDim=${dim} preset=${preset} k=${k} rs=${rs} onBgClick=${draw?e=>{if(e.target.closest&&e.target.closest('.pt'))return;setPts(a=>[...a,toLocal(e)]);}:null}>
          ${pts.map((p,i)=>html`<g key=${i} transform=${'translate('+p.x+','+p.y+') scale('+Math.max(k,.6)+')'} class="pt ${i===0?'pt-start':i===pts.length-1?'pt-end':''}" onPointerDown=${e=>{e.stopPropagation();e.preventDefault();setDrag(i);}}>
            <circle r="9"></circle><text y="3.6" text-anchor="middle">${i+1}</text>
          </g>`)}
        <//>
      </div>
      <div class="course-side">
        ${window.SD_LASER_ONLY?null:html`<${ImageSlot} label="코스 사진" wide assetId=${saved.bgId} busy=${busy} onFile=${up} onRemove=${()=>{MediaStore.del(saved.bgId);Actions.saveConfig('course',{bgId:null});}} hint="운동장 사진을 찍어 올리면 일러스트 대신 사진 위에 코스가 표시됩니다."/>`}
        ${saved.bgId?null:html`<${Field} label="기본 배경" hint="코스 사진을 올리지 않았을 때 보이는 배경입니다.">
          <div class="seg" role="group" aria-label="기본 배경">
            <button type="button" aria-pressed=${String(preset!=='field')} onClick=${()=>pickPreset('school')}>학교 항공사진</button>
            <button type="button" aria-pressed=${String(preset==='field')} onClick=${()=>pickPreset('field')}>축구장 그림</button>
          </div><//>`}
        ${saved.bgId||preset!=='field'?html`<${Field} label="사진 어둡게"><input id="course-dim" type="range" min="0" max="0.8" step="0.05" value=${dim} onInput=${e=>setDim(+e.target.value)}/><//>`:null}
        <${Field} label=${'코스 표시 크기 · '+Math.round(k*100)+'%'} hint="사격장·로고·경로 굵기를 함께 줄이거나 키웁니다. 학교 전체 사진에서는 작게 두세요.">
          <input id="course-scale" type="range" min="0.35" max="1" step="0.05" value=${k} onInput=${e=>setK(+e.target.value)}/>
        <//>
        <${Field} label=${'사격장 크기 · '+Math.round(rs*100)+'%'} hint="사격장(사로 칸)만 따로 줄이거나 키웁니다. 사로에 선 로고도 칸에 맞춰 작아집니다.">
          <input id="course-range-size" type="range" min="0.3" max="1.5" step="0.05" value=${rs} onInput=${e=>setRs(+e.target.value)}/>
        <//>
        <${Field} label="사격 구간 위치" hint="코스 전체에서 사로가 있는 지점">
          <input id="course-range" type="range" min="0.05" max="0.98" step="0.005" value=${ra} onInput=${e=>setRangeAt(+e.target.value)}/>
        <//>
        <${Field} label="사격장 방향"><input id="course-angle" type="range" min="-180" max="180" step="5" value=${angle} onInput=${e=>setAngle(+e.target.value)}/><//>
        <div class="course-btns">
          <button id="course-draw" class="btn ${draw?'btn-primary':''}" onClick=${()=>setDraw(!draw)}>${draw?'점 찍기 끝내기':'클릭으로 점 추가'}</button>
          <button class="btn" onClick=${()=>{setPts([]);setDraw(true);}}>경로 새로 그리기</button>
          <button class="btn" disabled=${!pts.length} onClick=${()=>setPts(a=>a.slice(0,-1))}>마지막 점 삭제</button>
          <button class="btn btn-ghost" onClick=${restore}>기본 코스로</button>
        </div>
        <p class="field-hint">번호 순서대로 달립니다. 1번이 출발, 마지막 번호가 도착입니다. 점은 끌어서 옮길 수 있습니다.</p>
      </div>
    </div>
  <//>`;
}
function DataSettings(){
  useStore();
  const toCsv=()=>{
    const esc=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
    const rows=[['구분','경기','날짜','학년','반','이름','성별','출발 시각','사격','주행','페널티','최종 기록','기록 입력자','수정 여부']];
    rankRecords(allRecords(),false).forEach(r=>rows.push([r.sample?'예시':'실제',r.matchTitle,r.date,r.grade,r.num,r.name,genderKo(r.gender),r.t0?fmtClock(r.t0):'',fmtCs(r.shootCs),fmtCs(r.runCs),fmtPen(r.penCs),fmtCs(r.finalCs),r.recorder||'',r.edited?'수정됨':'']));
    MediaStore.save('레이저런_기록.csv','﻿'+rows.map(x=>x.map(esc).join(',')).join('\r\n'));
  };
  const toJson=()=>{
    const data={};
    Store.COLS.forEach(c=>{data[c]=Store.col(c);});
    MediaStore.save('레이저런_백업_'+todayStr()+'.json',JSON.stringify({app:'laser-run',version:2,exportedAt:Live.now(),data},null,1));
  };
  const importJson=async f=>{
    try{
      const j=JSON.parse(await f.text());
      if(j.app!=='laser-run'||!j.data) throw new Error('format');
      const count=Store.COLS.reduce((a,c)=>a+Object.keys(j.data[c]||{}).length,0);
      const ok=await askConfirm({title:'백업 불러오기',body:count+'개 항목을 불러옵니다. 같은 항목은 백업 내용으로 덮어씁니다.',ok:'불러오기'});
      if(!ok) return;
      Store.COLS.forEach(c=>Object.entries(j.data[c]||{}).forEach(([id,d])=>Store.set(c,id,d)));
      toast('백업을 불러왔습니다.','ok');
    }catch(e){toast('백업 파일을 읽지 못했습니다. 이 사이트에서 만든 JSON 파일인지 확인해 주세요.','error',5000);}
  };
  const sampleN=Store.list('matches').filter(m=>m.sample).length+Store.list('classes').filter(c=>c.sample).length;
  const realN=allRecords().filter(r=>!r.sample).length;
  const rri=recordsResetInfo();
  return html`<div class="grid-2">
    <${Panel} title="예시 데이터">
      <dl class="lr-conn">
        <div><dt>실제 기록</dt><dd class="num">${realN}건</dd></div>
        <div><dt>예시 기록</dt><dd class="num">${allRecords().length-realN}건</dd></div>
      </dl>
      <p class="dim">실제 경기가 하나라도 등록되면 예시 데이터는 모든 화면에서 자동으로 숨겨집니다.</p>
      <label class="toggle"><input id="data-show-sample" type="checkbox" checked=${LR.showSample} onChange=${e=>{LR.showSample=e.target.checked;LS.set('showSample',e.target.checked);Store.touch();}}/><span><b>실제 데이터와 함께 예시도 보기</b><em>이 기기에만 적용됩니다.</em></span></label>
      <div class="course-btns">
        <button id="data-load-sample" class="btn" onClick=${()=>Actions.loadSample()}>예시 데이터 불러오기</button>
        <button id="data-clear-sample" class="btn btn-danger-ghost" disabled=${!sampleN} onClick=${async()=>{const ok=await askConfirm({title:'예시 데이터 삭제',body:'예시 학급, 경기, 기록을 모두 지웁니다. 실제 데이터는 그대로 남습니다.',ok:'예시 삭제',danger:true});if(ok)Actions.clearSample();}}>예시 데이터 전체 삭제</button>
      </div>
    <//>
    <${Panel} title="내보내기 · 백업">
      <div class="course-btns">
        <button id="data-csv" class="btn" onClick=${toCsv}>기록 CSV 내보내기 (엑셀)</button>
        <button id="data-json" class="btn" onClick=${toJson}>전체 백업 저장 (JSON)</button>
        <${FilePick} id="data-import" accept="application/json,.json" onFile=${importJson} class="btn">백업 불러오기<//>
      </div>
      <p class="dim">대회 전후로 백업을 저장해 두면 문제가 생겨도 되돌릴 수 있습니다. 포스터·코스 사진 파일은 백업에 들어가지 않습니다.</p>
    <//>
    <${Panel} title="전체 초기화">
      <p class="dim">「기록만 초기화」는 반·선수·일정을 두고 경기 기록, 수정 이력, 주장 서명만 지웁니다. 「모든 데이터 삭제」는 실제 기록을 포함한 레이저런 데이터를 모두 지웁니다. 풋살 데이터는 건드리지 않습니다. 되돌릴 수 없으니 먼저 백업해 주세요.</p>
      <div class="course-btns">
        <button id="data-reset-records" class="btn btn-danger-ghost" disabled=${!rri.busy} onClick=${async()=>{const ok=await askConfirm({title:'기록만 초기화',body:'반·선수·일정은 그대로 두고 경기 '+rri.ms.length+'개의 기록 '+rri.nAll+'건, 수정 이력 '+rri.nAudit+'건, 주장 서명을 지웁니다. 정말 진행할까요?',ok:'기록 초기화',danger:true});if(ok){const k=Actions.resetRecords();toast('모든 경기 기록을 초기화했습니다'+(k?' (기록 '+k+'건)':'')+'.','ok');}}}>기록만 초기화</button>
        <button id="data-reset" class="btn btn-danger-ghost" onClick=${async()=>{const ok=await askConfirm({title:'전체 초기화',body:'레이저런의 학급, 선수, 일정, 기록, 수정 이력, 주장 서명을 모두 삭제합니다. 풋살 데이터는 그대로 남습니다. 정말 진행할까요?',ok:'모두 삭제',danger:true});if(ok)Actions.resetAll();}}>모든 데이터 삭제</button>
      </div>
    <//>
  </div>`;
}
/* ==========================================================================
   조 추첨 — 참가 반을 조(A조, B조 …)의 1~N번 시드에 넣는다. 시드 번호 = 그 조 경기의 기본 사로.
   저장: lr_config/groups {list:[{key:'A',seeds:['1-1',…]}]}. 경기는 「경기 일정 › 경기 추가」에서 조를 골라 만든다.
   예전 방식(조 편성을 저장하면 경기가 바로 생기던 때)의 데이터는 조 이름이 붙은 경기에서 읽어 온다.
   ========================================================================== */
const groupLetter=i=>i<26?String.fromCharCode(65+i)+'조':(i+1)+'조';
const byGroupTitle=(a,b)=>{const ka=/^[A-Z]조$/.test(a.title||'')?a.title:'~'+(a.title||''),kb=/^[A-Z]조$/.test(b.title||'')?b.title:'~'+(b.title||'');return ka<kb?-1:ka>kb?1:(a.seq||0)-(b.seq||0);};
const evenCaps=(n,g)=>Array.from({length:g},(_,i)=>Math.floor(n/g)+(i<n%g?1:0));
const GKEYS='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const matchGroupKey=m=>(m&&(m.groupKey||((/^([A-Z])조/.exec(m.title||'')||[])[1])))||null;
const groupsSaved=()=>{const d=Store.doc('config','groups');return d&&Array.isArray(d.list)?d:null;};
const groupsList=memoV(()=>{
  const d=groupsSaved();
  if(d) return d.list.map(g=>({key:g.key,seeds:[...(g.seeds||[])]}));
  const out=[];
  Store.list('matches').filter(m=>!m.sample).sort(byGroupTitle).forEach(m=>{
    const k=matchGroupKey(m);
    if(!k||out.some(g=>g.key===k)) return;
    out.push({key:k,seeds:[...(m.classIds||[])].sort((a,b)=>((m.lanes||{})[a]||99)-((m.lanes||{})[b]||99)),legacy:true});
  });
  return out.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
});
const seedLanes=seeds=>{const o={};(seeds||[]).forEach((cid,i)=>{if(cid)o[cid]=i+1;});return o;};
const groupMatches=k=>matchesSorted().filter(m=>!m.sample&&matchGroupKey(m)===k);
const matchStarted=m=>!!m&&(m.status==='live'||m.status==='done'||m.startedAt!=null||Store.list('runs').some(r=>r.matchId===m.id&&(r.startedAt!=null||Object.keys(r.legs||{}).length>0)));
const groupMatchTitle=k=>{const n=groupMatches(k).length;return k+'조'+(n?' '+(n+1)+'차':'');};
const groupLayout=(N,size)=>{const G=Math.max(1,Math.ceil(N/Math.max(1,size)));return {G,caps:evenCaps(N,G)};};
/** 경기의 사로를 바꾼다(이미 만들어진 달리기 문서까지). 빠진 학급의 사로 값은 지운다. */
function applyLanes(m,classIds,lanes,extra){
  const patch={classIds,lanes:{...lanes},...(extra||{})};
  Object.keys(m.lanes||{}).forEach(cid=>{if(!(cid in lanes)) patch.lanes[cid]=null;});
  Store.merge('matches',m.id,patch);
  Store.list('runs').filter(r=>r.matchId===m.id).forEach(r=>{
    if(!classIds.includes(r.classId)){if(r.startedAt==null&&!Object.keys(r.legs||{}).length) Store.remove('runs',r.id);}
    else if(r.lane!==lanes[r.classId]) Store.merge('runs',r.id,{lane:lanes[r.classId]});
  });
}
/** 조 편성을 저장한다. 아직 시작하지 않은 그 조의 경기는 새 편성(시드 = 사로)을 따른다. */
function saveGroups(list,how){
  const clean=list.map(g=>({key:g.key,seeds:(g.seeds||[]).map(x=>x||'')}));
  Store.set('config','groups',{id:'groups',list:clean,savedAt:Live.now(),by:LR.recorder(),how:how||'edit'});
  let n=0;
  clean.forEach(g=>{
    const ids=g.seeds.filter(Boolean);
    groupMatches(g.key).forEach(m=>{
      if(matchStarted(m)) return;
      applyLanes(m,ids,seedLanes(g.seeds),{groupKey:g.key,lanesOk:false});
      n++;
    });
  });
  ActLog.add('조 편성 저장 ('+(how==='draw'?'추첨 방송':'직접 수정')+'): '+clean.length+'개 조 · '+clean.reduce((a,g)=>a+g.seeds.filter(Boolean).length,0)+'개 반'+(n?' · 시작 전 경기 '+n+'개에 반영':''));
  return n;
}

/* ---------- 조 추첨 방송: 풋살 토너먼트 추첨과 같은 무대(슬롯 릴 · 소리 · 꽃가루) ---------- */
function LaserDraw({size,onClose}){
  useStore();
  const K=window.KDRAW.kit,{Sfx,confetti,BULBS,IH,DW,DH,rnd}=K;
  K.ensureCss();
  const st=CFG.settings();
  const classes=classesSorted().filter(c=>!c.sample);
  const N=classes.length,{G,caps}=groupLayout(N,size);
  const maxCap=Math.max(1,...caps);
  const order=[];
  for(let s=0;s<maxCap;s++) for(let g=0;g<G;g++) if(s<caps[g]) order.push([g,s]);
  const sig=classes.map(c=>c.id).join(',')+'|'+caps.join('.');
  const fresh=()=>({sig,a:caps.map(n=>Array(n).fill('')),hist:[]});
  const [S,setS]=useState(()=>{const v=LS.get('lrDraw',null);return v&&v.sig===sig&&Array.isArray(v.a)?v:fresh();});
  const [phase,setPhase]=useState('board'); // board → spin → reveal → board
  const [pickSlot,setPickSlot]=useState(null);
  const [cur,setCur]=useState(null);
  const [ghost,setGhost]=useState(null);
  const [just,setJust]=useState(null);
  const [scale,setScale]=useState(1);
  const [sound,setSound]=useState(Sfx.on);
  const [armReset,setArmReset]=useState(false);
  const [armOk,setArmOk]=useState(false);
  const [armAuto,setArmAuto]=useState(false);
  const [auto,setAuto]=useState(false);
  const [flash,setFlash]=useState(0);
  const root=useRef(null),strip=useRef(null),cv=useRef(null),cv2=useRef(null),finale=useRef(false);
  const rgb='255,74,94';
  const placed=new Set(S.a.flat().filter(Boolean));
  const pool=classes.filter(c=>!placed.has(c.id));
  const filled=placed.size,complete=N>0&&filled===N;
  const nextSlot=order.find(([g,s])=>!S.a[g][s])||null;
  const target=pickSlot&&!S.a[pickSlot[0]][pickSlot[1]]?pickSlot:nextSlot;
  // 배치 (1920×1080 기준)
  const LX=56,GAP=G>6?14:22,CW=(DW-2*LX-(G-1)*GAP)/G,GT=176,GH=568,HH=62,RG=8;
  const RH=Math.min(76,Math.floor((GH-HH-18-(maxCap-1)*RG)/maxCap));
  const slotPos=(g,s)=>({x:LX+g*(CW+GAP)+10,y:GT+HH+s*(RH+RG),w:CW-20,h:RH});
  useEffect(()=>{LS.set('lrDraw',S);},[S]);
  useEffect(()=>{
    const fit=()=>setScale(Math.min(window.innerWidth/DW,window.innerHeight/DH));
    fit();window.addEventListener('resize',fit);
    return()=>window.removeEventListener('resize',fit);
  },[]);
  useEffect(()=>{if(!armReset) return;const t=setTimeout(()=>setArmReset(false),4000);return()=>clearTimeout(t);},[armReset]);
  useEffect(()=>{if(!armOk) return;const t=setTimeout(()=>setArmOk(false),4000);return()=>clearTimeout(t);},[armOk]);
  useEffect(()=>{if(!armAuto) return;const t=setTimeout(()=>setArmAuto(false),4000);return()=>clearTimeout(t);},[armAuto]);
  useEffect(()=>{
    if(complete&&phase==='board'&&!auto&&!finale.current){finale.current=true;setTimeout(()=>{Sfx.fanfare(true);confetti(cv2.current,rgb);},500);}
    if(!complete) finale.current=false;
  },[complete,phase,auto]);
  const spin=()=>{
    if(phase!=='board'||!target||!pool.length||auto) return;
    const ok=pool,pick=ok[rnd(ok.length)];
    const n=ok.length===1?14:34+rnd(Math.min(ok.length,12)*2);
    const items=[];
    let prev=null;
    for(let i=0;i<n;i++){const p=ok.length>1?ok.filter(q=>q!==prev):ok;const q=p[rnd(p.length)];items.push(q);prev=q;}
    if(ok.length>1&&items[n-1]===pick) items[n-1]=ok.find(q=>q!==pick);
    items.push(pick,ok.length>1?ok.find(q=>q!==pick):pick);
    setCur({g:target[0],s:target[1],pick,items,stop:n,one:ok.length===1,left:ok.length});
    setPhase('spin');Sfx.start();
  };
  useEffect(()=>{
    if(phase!=='spin'||!cur||!strip.current) return;
    const el=strip.current,stop=cur.stop,fast=window.__kdFast,T=fast?120:cur.one?2200:5600,back=fast?40:520,over=.34;
    let raf=0,last=-1;
    const t0=performance.now();
    const place=p=>{el.style.transform='translate3d(0,'+(IH-p*IH)+'px,0)';};
    const step=now=>{
      const t=now-t0;
      let p;
      if(t<T){const x=t/T;p=(1-Math.pow(1-x,4))*(stop+over);}
      else if(t<T+back){const x=(t-T)/back;p=stop+over*(.5+Math.cos(Math.PI*x)/2);}
      else p=stop;
      place(p);
      const i=Math.floor(p+.5);
      if(i>last){if(last>=0)Sfx.tick(i);last=i;}
      if(t<T+back) raf=requestAnimationFrame(step);
      else{setPhase('reveal');setFlash(f=>f+1);Sfx.ding();setTimeout(()=>Sfx.fanfare(false),260);confetti(cv.current,rgb);}
    };
    place(0);
    raf=requestAnimationFrame(step);
    return()=>cancelAnimationFrame(raf);
  },[phase]);
  const commit=()=>{
    if(phase!=='reveal'||!cur) return;
    const {g,s,pick}=cur,p=slotPos(g,s);
    setGhost({g,s,c:pick,x:p.x,y:p.y,w:p.w,h:p.h,fx:DW/2-(p.x+p.w/2),fy:DH/2-(p.y+p.h/2)});
    setPhase('board');setCur(null);setPickSlot(null);
    setTimeout(()=>{
      setS(x=>{const a=x.a.map(r=>r.slice());a[g][s]=pick.id;return {...x,a,hist:[...x.hist,[g,s]]};});
      setGhost(null);setJust(g+':'+s);Sfx.pop();
      setTimeout(()=>setJust(j=>j===g+':'+s?null:j),900);
    },700);
  };
  const undo=()=>{
    if(phase!=='board'||!S.hist.length||auto) return;
    const [g,s]=S.hist[S.hist.length-1];
    setS(x=>{const a=x.a.map(r=>r.slice());a[g][s]='';return {...x,a,hist:x.hist.slice(0,-1)};});
  };
  const reset=()=>{if(!armReset){setArmReset(true);return;}setArmReset(false);setPickSlot(null);setS(fresh());};
  const autoAll=async()=>{
    if(phase!=='board'||auto||!pool.length) return;
    if(!armAuto){setArmAuto(true);return;}
    setArmAuto(false);setAuto(true);setPickSlot(null);
    const left=[...pool];
    for(let i=left.length-1;i>0;i--){const j=rnd(i+1);[left[i],left[j]]=[left[j],left[i]];}
    const a=S.a.map(r=>r.slice()),hist=[...S.hist];
    for(const [g,s] of order){
      if(a[g][s]) continue;
      const c=left.shift();
      if(!c) break;
      a[g][s]=c.id;hist.push([g,s]);
      setS(x=>({...x,a:a.map(r=>r.slice()),hist:[...hist]}));setJust(g+':'+s);Sfx.pop();
      await sleep(window.__kdFast?5:150);
    }
    setJust(null);setAuto(false);
  };
  const toggleSound=()=>{Sfx.on=!Sfx.on;SD.ls.set('kdSound',Sfx.on);setSound(Sfx.on);if(Sfx.on)Sfx.pop();};
  const full=()=>{
    const el=root.current;
    if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    else if(el&&el.requestFullscreen) el.requestFullscreen().catch(()=>{});
  };
  const exit=()=>{if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});onClose();};
  const confirm=()=>{
    if(!complete||!Store.canWrite()) return;
    if(!armOk){setArmOk(true);return;} // 방송 중 실수로 누르지 않게 두 번 눌러 확정
    setArmOk(false);
    const n=saveGroups(S.a.map((seeds,g)=>({key:GKEYS[g],seeds})),'draw');
    LS.set('lrDraw',null);
    toast('조 편성을 확정했습니다.'+(n?' 시작 전 경기 '+n+'개에도 반영했습니다.':' 「경기 일정 › 경기 추가」에서 조를 골라 경기를 만드세요.'),'ok');
    exit();
  };
  useEffect(()=>{
    const onKey=e=>{
      if(e.key===' '||e.key==='Enter'){
        if(phase==='board'&&!complete){e.preventDefault();spin();}
        else if(phase==='reveal'){e.preventDefault();commit();}
      }
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  });
  const grades=[...new Set(classes.map(c=>c.grade))];
  return html`<div class="kd lrd" ref=${root} style=${'--acc:'+rgb}>
    <div class="kd-bg"></div>
    <div class="kd-stage" style=${'--s:'+scale}>
      <header class="kd-head">
        <div class="kd-brand"><img src="logos/brand.webp" alt=""/><span>${st.eventName}</span></div>
        <div class="kd-title">조 추첨<small>GROUP STAGE DRAW</small></div>
        <div class="kd-prog"><span>추첨</span><b>${filled}</b><span>/ ${N}</span></div>
      </header>
      ${S.a.map((row,g)=>html`<section class=${'lrd-group'+(target&&target[0]===g&&phase==='board'&&!complete?' hot':'')} key=${'g'+g} style=${'left:'+(LX+g*(CW+GAP))+'px;top:'+GT+'px;width:'+CW+'px;height:'+GH+'px'}>
        <header><b>${GKEYS[g]}조</b><span>${row.filter(Boolean).length}/${row.length}</span></header>
      </section>`)}
      ${order.map(([g,s])=>{
        const p=slotPos(g,s),cid=S.a[g][s],c=cid&&Store.doc('classes',cid);
        const isT=!cid&&target&&target[0]===g&&target[1]===s&&phase==='board'&&!auto;
        return html`<button type="button" key=${g+':'+s} class=${'lrd-slot'+(c?' on':'')+(isT?' next':'')+(just===g+':'+s?' pop':'')}
          style=${'left:'+p.x+'px;top:'+p.y+'px;width:'+p.w+'px;height:'+p.h+'px;'+vestStyle(s+1)} disabled=${phase!=='board'||!!cid||auto}
          onClick=${()=>setPickSlot([g,s])} aria-label=${GKEYS[g]+'조 '+(s+1)+'번 시드'+(c?' '+className(c):'')}>
          <span class="lrd-no">${s+1}</span>
          ${c?html`<span class="lrd-team"><${Logo} cls=${c} size=${(p.h-18)+'px'}/><b>${className(c)}</b></span>`
            :html`<span class="kd-q">${ghost&&ghost.g===g&&ghost.s===s?'':'?'}</span>`}
        </button>`;
      })}
      <div class="lrd-pool">${grades.map(gr=>html`<div class="lrd-prow" key=${gr}><span class="lrd-pl">${gr}학년</span><div>
        ${classes.filter(c=>c.grade===gr).map(c=>html`<span key=${c.id} class=${'lrd-chip'+(placed.has(c.id)?' used':'')}><${Logo} cls=${c} size="40px"/><b>${c.num}반</b></span>`)}
      </div></div>`)}</div>
      <div class="lrd-cta">
        ${complete?html`<b class="lrd-done">조 편성 완성!</b>${Store.canWrite()?html`<button type="button" class=${'kd-confirm'+(armOk?' arm':'')} onClick=${confirm}>${armOk?'한 번 더 누르면 확정':'조 편성 확정'}</button><small class="lrd-note">확정하면 「경기 일정」에서 조를 골라<br/>경기를 만들 수 있습니다</small>`:html`<small class="lrd-note">편집자 계정에서 확정할 수 있습니다</small>`}`
          :target?html`<span class="lrd-tgt"><small>${pickSlot?'고른 자리':'다음 추첨'}</small><b>${GKEYS[target[0]]}조 ${target[1]+1}번 시드</b></span>
            <button type="button" class="kd-go lrd-go" disabled=${phase!=='board'||auto} onClick=${spin}>추첨하기</button>
            <small class="lrd-note">빈칸을 누르면 그 자리를 먼저 뽑습니다 · 스페이스 · 엔터</small>`:null}
      </div>
      <div class="kd-ctl">
        <button type="button" disabled=${phase!=='board'||!S.hist.length||auto} onClick=${undo}>되돌리기</button>
        <button type="button" class=${armAuto?'arm':''} disabled=${phase!=='board'||!pool.length||auto} onClick=${autoAll}>${armAuto?'한 번 더 누르면 남은 반 모두':'남은 반 한 번에'}</button>
        <button type="button" class=${armReset?'arm':''} disabled=${phase!=='board'||!filled||auto} onClick=${reset}>${armReset?'한 번 더 누르면 처음부터':'처음부터'}</button>
        <button type="button" onClick=${toggleSound}>${sound?'소리 켜짐':'소리 꺼짐'}</button>
        <button type="button" onClick=${full}>전체 화면</button>
        <button type="button" onClick=${exit}>나가기</button>
      </div>
      ${ghost?html`<div class="kd-ghost lrd-ghost" style=${'left:'+ghost.x+'px;top:'+ghost.y+'px;width:'+ghost.w+'px;height:'+ghost.h+'px;--fx:'+ghost.fx+'px;--fy:'+ghost.fy+'px'}>
        <${Logo} cls=${ghost.c} size=${(ghost.h-18)+'px'}/><b>${className(ghost.c)}</b></div>`:null}
      <canvas class="kd-confetti" ref=${cv2} width=${DW} height=${DH}></canvas>
      ${(phase==='spin'||phase==='reveal')&&cur?html`<div class="kd-ov dark">
        <div class=${'kd-reelbox'+(phase==='spin'?' spinning':' won')}>
          <div class="kd-bulbs">${BULBS.map(([x,y],i)=>html`<i class="kd-bulb" style=${'left:'+x+'%;top:'+y+'%;animation-delay:'+((i%2)*-.6)+'s'}></i>`)}</div>
          <div class="kd-reeltitle"><i>${GKEYS[cur.g]}</i>조 ${cur.s+1}번 시드${phase==='spin'?html`<span class="kd-dots">${cur.left}개 반 중에서 추첨 중</span>`:null}</div>
          <div class="kd-window">
            <div class="kd-strip" ref=${strip}>${cur.items.map((c,i)=>html`<div class=${'kd-item'+(phase==='reveal'&&i===cur.stop?' hit':'')} key=${i}>
              <${Logo} cls=${c} size="118px"/><span><b>${className(c)}</b><em>${GKEYS[cur.g]}조 ${cur.s+1}번 · ${cur.s+1}사로</em></span></div>`)}</div>
            <div class="kd-mark"></div>
          </div>
          ${phase==='reveal'?html`<div class="kd-result"><button type="button" class="kd-next" onClick=${commit}>${GKEYS[cur.g]}조 ${cur.s+1}번에 넣기</button></div>`:html`<div class="kd-result"><span class="kd-hint">띠로리로리로…</span></div>`}
        </div>
        <canvas class="kd-confetti" ref=${cv} width=${DW} height=${DH}></canvas>
        ${flash?html`<div class="kd-flash" key=${flash}></div>`:null}
      </div>`:null}
    </div>
  </div>`;
}

/* ---------- 팀 · 선수 › 조 추첨 탭: 저장된 조 편성 보기 · 추첨 방송 · 직접 수정 ---------- */
function GroupsTab({onTab}){
  useStore();
  const st=CFG.settings(),maxLane=Math.max(1,st.laneCount||6);
  const canEdit=Store.canWrite();
  const classes=classesSorted().filter(c=>!c.sample);
  const N=classes.length;
  const sizes=[4,5,6,7,8].filter(n=>n<=maxLane);
  const [sizePick,setSize]=useLocal('ui.groupSize',maxLane);
  const size=sizes.includes(sizePick)?sizePick:sizes[sizes.length-1]||maxLane;
  const saved=groupsList();
  const [draft,setDraft]=useState(null);
  const [sel,setSel]=useState(null); // {g,s} 조 안의 자리 | {cid} 미배정 반
  const [show,setShow]=useState(false);
  const canShow=!!(window.KDRAW&&KDRAW.kit&&KDRAW.available());
  const groups=draft||saved;
  const placed=new Set(groups.flatMap(g=>g.seeds.filter(Boolean)));
  const pool=classes.filter(c=>!placed.has(c.id));
  const {G,caps}=groupLayout(N,size);
  const counts=Object.fromEntries(groups.map(g=>[g.key,groupMatches(g.key).length]));
  const allIds=groups.flatMap(g=>g.seeds.filter(Boolean)),dups=new Set(allIds.filter((c,i)=>allIds.indexOf(c)!==i));
  const locked=k=>groupMatches(k).some(matchStarted);
  const startEdit=()=>{
    const base=saved.length?saved.map(g=>({key:g.key,seeds:[...g.seeds]})):caps.map((n,i)=>({key:GKEYS[i],seeds:Array(n).fill('')}));
    setDraft(base);setSel(null);
  };
  const relayout=n=>{
    setSize(n);
    if(!draft) return;
    const L=groupLayout(N,n),flat=draft.flatMap(g=>g.seeds.filter(Boolean));
    setDraft(L.caps.map((cap,i)=>({key:GKEYS[i],seeds:Array.from({length:cap},()=>flat.shift()||'')})));
  };
  const put=(to)=>{ // 고른 반(sel)을 to 자리로: 빈자리면 옮기고, 찬 자리면 서로 바꾼다
    if(!sel||!draft) return;
    const d=draft.map(g=>({...g,seeds:[...g.seeds]}));
    const from=sel.cid?null:sel;
    const a=from?d[from.g].seeds[from.s]:sel.cid;
    if(to.pool){if(from){d[from.g].seeds[from.s]='';}setDraft(d);setSel(null);return;}
    const b=d[to.g].seeds[to.s];
    d[to.g].seeds[to.s]=a;
    if(from) d[from.g].seeds[from.s]=b||'';
    setDraft(d);setSel(null);
  };
  const addGroup=()=>setDraft(d=>[...d,{key:GKEYS[d.length]||String(d.length+1),seeds:Array(size).fill('')}]);
  const save=()=>{
    const seen=new Set(); // 같은 반이 두 조에 들어가 있으면 앞 조에만 남긴다
    const list=draft.map(g=>({seeds:g.seeds.filter(c=>c&&!seen.has(c)&&seen.add(c))})).filter(g=>g.seeds.length).map((g,i)=>({key:GKEYS[i],seeds:g.seeds}));
    const n=saveGroups(list,'edit');
    setDraft(null);setSel(null);
    toast('조 편성을 저장했습니다.'+(n?' 시작 전 경기 '+n+'개에도 반영했습니다.':''),'ok');
  };
  if(!N) return html`<${Panel} title="조 추첨"><${EmptyState} title="참가 반이 없습니다." action=${html`<button class="btn btn-primary" onClick=${()=>onTab('class')}>참가 반 고르기</button>`}>「참가 반」 탭에서 대회에 나가는 반을 먼저 골라 주세요.<//><//>`;
  const isSel=(g,s)=>sel&&!sel.cid&&sel.g===g&&sel.s===s;
  const slot=(g,s,cid)=>{
    const c=cid&&Store.doc('classes',cid),n=c?(c.players||[]).length:0;
    const lk=!draft;
    return html`<li key=${s} class=${'gt-slot'+(c?'':' empty')+(cid&&dups.has(cid)?' dup':'')+(isSel(g,s)?' on':'')+(draft&&sel&&!isSel(g,s)?' target':'')}>
      <button type="button" class="gt-pick" disabled=${lk} onClick=${()=>{if(!draft) return;if(sel&&!isSel(g,s)) put({g,s});else if(c) setSel(isSel(g,s)?null:{g,s});}}>
        <span class="gt-seed" style=${vestStyle(s+1)} title=${(s+1)+'번 시드 · 기본 '+(s+1)+'사로'}>${s+1}</span>
        ${c?html`<${Logo} cls=${c} size="26px"/><span class="gt-name">${className(c)}</span>${n?html`<span class="gt-n dim">${n}명</span>`:html`<span class="gt-n warn">명단 없음</span>`}`
          :html`<span class="gt-name dim">${draft&&sel?'여기에 넣기':'빈 자리'}</span>`}
      </button>
    </li>`;
  };
  return html`<div class="gt">
    <${Panel} title="조 추첨" kicker=${saved.length?(groupsSaved()?'저장된 조 편성':'예전 방식으로 만든 조'):'아직 조가 없습니다'} right=${canEdit?(draft?html`
      <span class="chip chip-change">수정 중</span>
      <button class="btn btn-ghost" onClick=${()=>{setDraft(null);setSel(null);}}>취소</button>
      <button id="gt-save" class="btn btn-primary" disabled=${!draft.some(g=>g.seeds.some(Boolean))} onClick=${save}>저장</button>`:html`
      ${canShow?html`<button id="gt-show" class="btn btn-primary" onClick=${()=>setShow(true)}><${Icon} n="play" s=${15}/> 추첨 방송${saved.length?' 다시 하기':' 시작'}</button>`:null}
      <button id="gt-edit" class="btn" onClick=${startEdit}><${Icon} n="edit" s=${14}/> 직접 ${saved.length?'수정':'편성'}</button>`):null}>
      <div class="gt-top">
        <span>참가 반 <b class="num">${N}</b>개</span>
        <span class="gt-size">한 조
          <span class="seg" role="group" aria-label="한 조 반 수">${sizes.map(n=>html`<button type="button" key=${n} aria-pressed=${String(size===n)} disabled=${!canEdit} onClick=${()=>relayout(n)}>${n}반</button>`)}</span></span>
        <span class="dim">→ 추첨하면 ${G}개 조 (${caps.join('·')})</span>
        <span class="spacer"></span>
        <span class="dim">시드 번호 = 기본 사로 · 경기 시작 전 「경기 운영 › 사로 배정」에서 랜덤으로 섞을 수 있습니다</span>
      </div>
      ${dups.size?html`<p class="field-error">${[...dups].map(id=>className(Store.doc('classes',id))).join(', ')}이(가) 두 조에 들어 있습니다.${draft?' 한쪽을 다른 반으로 바꿔 주세요(저장하면 앞 조에만 남습니다).':' 「직접 수정」에서 고쳐 주세요.'}</p>`:null}
      ${draft?html`<p class="gt-help">${sel?html`<b>${className(Store.doc('classes',sel.cid||draft[sel.g].seeds[sel.s]))}</b>을(를) 놓을 자리를 누르세요. 찬 자리를 누르면 서로 바뀝니다. <button type="button" class="linklike" onClick=${()=>setSel(null)}>취소</button>`
        :'반을 누른 뒤 옮길 자리를 누르세요. 찬 자리끼리는 서로 바뀌고, 아래 미배정 칸을 누르면 빠집니다.'}</p>`:null}
      ${groups.length?html`<div class="gt-grid">${groups.map((g,gi)=>{
        const lk=locked(g.key);
        return html`<section class=${'gt-group'+(lk?' lock':'')} key=${g.key+gi}>
          <header><b>${draft?GKEYS[gi]:g.key}조</b><span class="dim num">${g.seeds.filter(Boolean).length}반</span>
            ${counts[g.key]?html`<span class="chip">${'경기 '+counts[g.key]+'개'}</span>`:null}${lk?html`<span class="chip warn" title="시작한 경기는 편성을 바꿔도 그대로입니다">시작한 경기 있음</span>`:null}</header>
          <ol class="gt-slots">${g.seeds.map((cid,s)=>slot(gi,s,cid))}</ol>
          ${!draft&&canEdit?html`<footer>${counts[g.key]
            ?html`<button class="btn btn-sm" onClick=${()=>{LS.set('ui.schGroup',g.key);navigate('schedule');}}>경기 일정 보기 →</button>`
            :html`<button class="btn btn-sm btn-primary" onClick=${()=>{LS.set('ui.newMatchGroup',g.key);navigate('schedule');}}><${Icon} n="plus" s=${13}/> ${g.key}조 경기 만들기</button>`}</footer>`:null}
        </section>`;})}
        ${draft?html`<button type="button" class="gt-addgroup" onClick=${addGroup}><${Icon} n="plus" s=${16}/> 조 추가</button>`:null}
      </div>`:html`<${EmptyState} title="아직 조를 정하지 않았습니다." action=${canEdit?html`<span style="display:inline-flex;gap:8px">${canShow?html`<button class="btn btn-primary" onClick=${()=>setShow(true)}>추첨 방송 시작</button>`:null}<button class="btn" onClick=${startEdit}>직접 편성</button></span>`:null}>
        「추첨 방송」을 열어 TV에 띄우고 조마다 1번 시드부터 한 반씩 뽑습니다. 다 뽑고 확정하면 「경기 일정」에서 조를 골라 경기를 만들 수 있습니다.<//>`}
    <//>
    ${pool.length?html`<${Panel} title=${'미배정 반 · '+pool.length+'개'} class=${draft&&sel&&!sel.cid?'gt-pool target':'gt-pool'}>
      <div class="gt-poolrow" onClick=${draft&&sel&&!sel.cid?()=>put({pool:true}):undefined}>
        ${pool.map(c=>html`<button type="button" key=${c.id} class=${'gt-chip'+(sel&&sel.cid===c.id?' on':'')} disabled=${!draft} onClick=${e=>{e.stopPropagation();if(sel&&!sel.cid) put({pool:true});else setSel(sel&&sel.cid===c.id?null:{cid:c.id});}}>
          <${Logo} cls=${c} size="22px"/><span>${className(c)}</span></button>`)}
      </div>
      ${!draft?html`<p class="dim small" style="margin-top:8px">${saved.length?'조에 들어가지 않은 반입니다. 「직접 수정」으로 넣거나 추첨 방송을 다시 하세요.':''}</p>`:null}
    <//>`:null}
    ${saved.length&&!draft&&canEdit&&groups.some(g=>!counts[g.key])?html`<div class="lr-next">
      <span><b>다음 단계</b> 조가 정해졌습니다. 「경기 일정」에서 조를 골라 경기를 만들고 날짜·시간을 정하세요.</span>
      <button class="btn btn-primary" onClick=${()=>navigate('schedule')}>경기 일정으로 →</button>
    </div>`:null}
    ${show?html`<${LaserDraw} size=${size} onClose=${()=>setShow(false)}/>`:null}
  </div>`;
}
/** 팀 · 선수: 참가 반 → 참가자 명단 → 조 추첨 (대회 준비 순서) */
function TeamsPage(){
  useStore();
  const [pick,setTab]=useLocal('ui.teamsTab','class');
  const tab=['class','roster','groups'].includes(pick)?pick:'class';
  const cs=classesSorted().filter(c=>!c.sample);
  const withP=cs.filter(c=>(c.players||[]).length).length;
  const gs=groupsList(),placed=new Set(gs.flatMap(g=>g.seeds.filter(Boolean)));
  return html`<div class="page">
    <div class="lr-steps" role="tablist" aria-label="준비 단계">
      ${[['class','참가 반',cs.length?cs.length+'개 반':'고르기 전',cs.length>0],
         ['roster','참가자 명단',cs.length?withP+' / '+cs.length+' 반':'—',cs.length>0&&withP===cs.length],
         ['groups','조 추첨',gs.length?gs.length+'개 조'+(placed.size<cs.length?' · 미배정 '+(cs.length-placed.size):''):'추첨 전',gs.length>0&&placed.size>=cs.length&&cs.length>0]].map(([id,label,sub,ok],i)=>html`
        <button type="button" role="tab" key=${id} aria-selected=${String(tab===id)} class=${'lr-step'+(ok?' ok':'')} onClick=${()=>setTab(id)}>
          <span class="lr-stepno">${ok?html`<${Icon} n="check" s=${14}/>`:i+1}</span><span><b>${label}</b><small>${sub}</small></span>
        </button>`)}
    </div>
    ${tab==='class'?html`<${ClassSettings}/>`:null}
    ${tab==='roster'?html`<${RosterSettings}/>`:null}
    ${tab==='groups'?html`<${GroupsTab} onTab=${setTab}/>`:null}
  </div>`;
}
function SetupPage(){
  const [pick,setTab]=useLocal('ui.setupTab','event');
  // 활동 기록은 이 페이지 주인 계정에만 보인다(저장 규칙상 다른 계정은 읽을 수도 없다). 비밀번호는 풋살 설정과 같다.
  const owner=!!SD.S.isOwner,tab=(pick==='log'&&!owner)||['class','roster','groups'].includes(pick)?'event':pick;
  return html`<div class="page">
    <${Tabs} value=${tab} onChange=${setTab} items=${[
      {id:'event',label:'대회 정보'},{id:'schedule',label:'경기 일정'},
      {id:'image',label:'포스터'},{id:'rule',label:'페널티·계산'},{id:'course',label:'코스'},{id:'tv',label:'TV 송출'},{id:'data',label:'데이터'},
      ...(owner?[{id:'log',label:'활동 기록'}]:[])]}/>
    ${tab==='event'?html`<${EventSettings}/>`:null}
    ${tab==='schedule'?html`<${SchedulePage}/>`:null}
    ${tab==='image'?html`<${ImageSettings}/>`:null}
    ${tab==='rule'?html`<${RuleSettings}/>`:null}
    ${tab==='course'?html`<${CourseSettings}/>`:null}
    ${tab==='tv'?html`<div class="grid-2"><${Panel} title="화면 구성 · 안내 문구"><${TvControlPanel}/><//><${Panel} title="사진 · 영상 관리"><${MediaManager}/><//></div>`:null}
    ${tab==='data'?html`<${DataSettings}/>`:null}
    ${tab==='log'&&window.PAGES&&PAGES.LogVault?html`<div class="lr-vault"><${PAGES.LogVault} sport=${LR_ID}/></div>`:null}
  </div>`;
}

/* ==========================================================================
   [7] TV 전용 화면 — 코스 위 로고 이동, 실시간 순위, 다음 경기 안내, 촬영 영상
   로고 위치와 초시계는 다시 그리기 없이 매 프레임 직접 갱신한다.
   ========================================================================== */
function buildCourse(points){
  const pts=points||[];
  if(pts.length<2){
    const c=pts[0]||{x:500,y:280};
    return {d:'',total:0,at:()=>({x:c.x,y:c.y,a:0}),sub:()=>'',nearest:()=>.5,cx:500,cy:280,empty:true};
  }
  const samples=[];
  for(let i=0;i<pts.length-1;i++){
    const p0=pts[Math.max(0,i-1)],p1=pts[i],p2=pts[i+1],p3=pts[Math.min(pts.length-1,i+2)];
    for(let k=0;k<20;k++){
      const u=k/20,u2=u*u,u3=u2*u;
      const f=(a,b,c,d)=>.5*((2*b)+(-a+c)*u+(2*a-5*b+4*c-d)*u2+(-a+3*b-3*c+d)*u3);
      samples.push({x:f(p0.x,p1.x,p2.x,p3.x),y:f(p0.y,p1.y,p2.y,p3.y)});
    }
  }
  samples.push({x:pts[pts.length-1].x,y:pts[pts.length-1].y});
  const lens=[0];
  for(let i=1;i<samples.length;i++) lens.push(lens[i-1]+Math.hypot(samples[i].x-samples[i-1].x,samples[i].y-samples[i-1].y));
  const total=lens[lens.length-1]||1;
  const idxAt=d=>{
    let lo=0,hi=lens.length-1;
    while(hi-lo>1){const m=(lo+hi)>>1;if(lens[m]<=d)lo=m;else hi=m;}
    return lo;
  };
  const at=p=>{
    const d=clamp(p,0,1)*total,i=idxAt(d),a=samples[i],b=samples[i+1]||a,seg=(lens[i+1]||lens[i])-lens[i]||1,t=(d-lens[i])/seg;
    return {x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t),a:Math.atan2(b.y-a.y,b.x-a.x)};
  };
  const toD=arr=>'M'+arr.map(s=>s.x.toFixed(1)+' '+s.y.toFixed(1)).join('L');
  const sub=(a,b)=>{
    const A=clamp(a,0,1)*total,B=clamp(b,0,1)*total,arr=[at(a)];
    samples.forEach((s,i)=>{if(lens[i]>A&&lens[i]<B)arr.push(s);});
    arr.push(at(b));
    return toD(arr);
  };
  const nearest=(x,y)=>{
    let bi=0,bd=Infinity;
    samples.forEach((s,i)=>{const d=(s.x-x)*(s.x-x)+(s.y-y)*(s.y-y);if(d<bd){bd=d;bi=i;}});
    return lens[bi]/total;
  };
  const xs=samples.map(s=>s.x),ys=samples.map(s=>s.y);
  return {d:toD(samples),total,at,sub,nearest,cx:(Math.min(...xs)+Math.max(...xs))/2,cy:(Math.min(...ys)+Math.max(...ys))/2};
}
const defaultRangeAt=(geo,preset)=>preset==='field'||!preset?geo.nearest(500,356):geo.nearest(SCHOOL_PLAY.range.x,SCHOOL_PLAY.range.y);
/* k = 코스 표시 크기. 사격장은 k배로 그리고, 로고가 서는 사로 자리도 같은 비율로 맞춘다. */
function rangeFrame(geo,rangeAt,angle,laneCount,k=1,rs=1){
  const c=geo.at(rangeAt),rad=(angle||0)*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad);
  const spacing=Math.min(62,380/Math.max(laneCount,1));
  const rk=k*rs; // 사격장은 코스 표시 크기 × 사격장 크기
  const world=(lx,ly)=>({x:c.x+(lx*cos-ly*sin)*rk,y:c.y+(lx*sin+ly*cos)*rk});
  return {c,spacing,k,rs,rk,angle:angle||0,world,slot:lane=>world((lane-(laneCount+1)/2)*spacing,-32)};
}
function SvgPill({x,y,text,cls,k=1}){
  const w=text.length*15.5+26;
  const X=clamp(x,(w/2+6)*k,1000-(w/2+6)*k),Y=clamp(y,20*k,560-20*k);
  return html`<g class="pill ${cls||''}" transform=${'translate('+X+','+Y+') scale('+k+')'}>
    <rect x=${-w/2} y="-15" width=${w} height="30" rx="4"></rect>
    <text y="6" text-anchor="middle">${text}</text>
  </g>`;
}
/** 경기 코스 도면. 코스 사진을 등록하면 사진 위에 같은 경로를 그린다. */
function CourseSvg({svgRef,geo,rangeAt,rangeAngle,laneCount,bgId,bgDim,onBgClick,children,preset='school',k=1,rs=1}){
  const frame=rangeFrame(geo,rangeAt,rangeAngle,laneCount,k,rs);
  const bg=bgId?MediaStore.url(bgId):null,school=!bgId&&preset!=='field',B=SCHOOL_BG;
  const S=geo.at(0),F=geo.at(1),R=geo.at(rangeAt*.5);
  const toC=Math.atan2(geo.cy-R.y,geo.cx-R.x);
  const halfW=(laneCount/2)*frame.spacing+10;
  const chevrons=[];
  if(!geo.empty) for(let p=.05;p<1;p+=.07){
    const a=geo.at(p);
    if(Math.abs(p-rangeAt)<.05) continue;
    chevrons.push(html`<path key=${p} class="chev" d="M-6 -6 L4 0 L-6 6" transform=${'translate('+a.x.toFixed(1)+','+a.y.toFixed(1)+') rotate('+(a.a*180/Math.PI).toFixed(1)+') scale('+k+')'}></path>`);
  }
  const line=(pt,cls)=>{
    const deg=(pt.a*180/Math.PI+90).toFixed(1);
    return html`<g transform=${'translate('+pt.x.toFixed(1)+','+pt.y.toFixed(1)+') rotate('+deg+') scale('+k+')'} class=${cls}>
      <rect x="-19" y="-5" width="38" height="10" fill="url(#chk)" stroke="#fff" stroke-width="1"></rect>
    </g>`;
  };
  return html`<svg ref=${svgRef} class="course" viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid meet" role="img" aria-label="레이저런 경기 코스: 출발, 달리기 구간, 사격 구간, 도착" onClick=${onBgClick||undefined}>
    <defs>
      <pattern id="chk" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#0B1D38"></rect><rect width="5" height="5" fill="#fff"></rect><rect x="5" y="5" width="5" height="5" fill="#fff"></rect></pattern>
    </defs>
    ${bg?html`
      <image href=${bg} x="0" y="0" width="1000" height="560" preserveAspectRatio="xMidYMid slice"></image>
      <rect class="course-dim" width="1000" height="560" fill="#061226" opacity=${bgDim}></rect>
    `:school?html`
      <defs>
        <linearGradient id="sch-fade-g"><stop offset="0" stop-color="#000"></stop><stop offset=".07" stop-color="#fff"></stop><stop offset=".93" stop-color="#fff"></stop><stop offset="1" stop-color="#000"></stop></linearGradient>
        <mask id="sch-fade" maskContentUnits="userSpaceOnUse"><rect x=${B.sx} y="0" width=${B.sw} height="560" fill="url(#sch-fade-g)"></rect></mask>
        <pattern id="sch-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" class="sch-grid-l"></path></pattern>
      </defs>
      <rect class="course-bg" width="1000" height="560" fill="#0A1E3B"></rect>
      <rect width="1000" height="560" fill="url(#sch-grid)"></rect>
      <image class="sch-photo" href=${B.href} x=${B.sx} y="0" width=${B.sw} height="560" preserveAspectRatio="none" mask="url(#sch-fade)"></image>
      <rect class="course-dim" x=${B.sx} width=${B.sw} height="560" fill="#061226" opacity=${bgDim} mask="url(#sch-fade)"></rect>
    `:html`
      <rect class="course-bg" width="1000" height="560" fill="#0A1E3B"></rect>
      <rect class="field" x="14" y="14" width="972" height="532" rx="150"></rect>
      <g class="pitch"><rect x="150" y="128" width="700" height="306"></rect><path d="M500 128V434"></path><circle cx="500" cy="281" r="58"></circle><rect x="150" y="205" width="66" height="152"></rect><rect x="784" y="205" width="66" height="152"></rect></g>
      <g class="trees">${[[34,36],[66,22],[22,74],[966,36],[934,22],[978,74],[34,524],[66,538],[966,524],[934,538]].map(([x,y],i)=>html`<circle key=${i} cx=${x} cy=${y} r=${i%3===0?13:9}></circle>`)}</g>
    `}
    ${geo.empty?null:html`
      <path class="track ${bg||school?'on-photo':''}" d=${geo.d} style=${k!==1?'stroke-width:'+(34*k).toFixed(1)+'px':''}></path>
      <path class="track-run1" d=${geo.sub(0,rangeAt)} style=${k<.9?'stroke-width:'+(3.5*Math.max(k,.7)).toFixed(2)+'px':''}></path>
      <path class="track-run2" d=${geo.sub(rangeAt,1)} style=${k<.9?'stroke-width:'+(3.5*Math.max(k,.7)).toFixed(2)+'px':''}></path>
      ${chevrons}
    `}
    <g transform=${'translate('+frame.c.x.toFixed(1)+','+frame.c.y.toFixed(1)+') rotate('+frame.angle+') scale('+frame.rk+')'} class="range">
      <rect class="range-box" x=${-halfW-8} y="-206" width=${halfW*2+16} height="186" rx="6"></rect>
      ${Array.from({length:laneCount},(_,i)=>{
        const lx=(i+1-(laneCount+1)/2)*frame.spacing;
        return html`<g key=${i} transform=${'translate('+lx.toFixed(1)+',0)'} class="lane-col" data-lane=${i+1} style=${vestStyle(i+1)}>
          <rect class="lane-rect" x=${-frame.spacing/2+3} y="-174" width=${frame.spacing-6} height="150"></rect>
          <circle class="tgt tgt-o" cy="-150" r="15"></circle><circle class="tgt tgt-i" cy="-150" r="6"></circle>
          <text class="lane-no-t" y="-116" text-anchor="middle">${i+1}</text>
        </g>`;
      })}
      <g transform="translate(0,-190)"><text class="range-title" text-anchor="middle" y="5" transform=${'rotate('+(-frame.angle)+')'}>③ 사격 구간</text></g>
    </g>
    ${geo.empty?null:html`
      ${line(S,'startline')}${line(F,'finishline')}
      <${SvgPill} k=${k} x=${S.x-58*k} y=${S.y+30*k} text="① 출발" cls="p-start"/>
      <${SvgPill} k=${k} x=${F.x+58*k} y=${F.y+30*k} text="④ 도착" cls="p-finish"/>
      <${SvgPill} k=${k} x=${R.x+Math.cos(toC)*58*k} y=${R.y+Math.sin(toC)*58*k} text="② 달리기 구간"/>
    `}
    ${children}
  </svg>`;
}
function MoveToken({tm,rank}){
  const [err,setErr]=useState(false);
  return html`<g class="tk" data-tk=${tm.id} transform="translate(-100,-100)">
    <circle class="tk-pulse" r="34" stroke=${tm.color}></circle>
    <circle class="tk-bg" r="26" stroke=${tm.color}></circle>
    ${tm.logo&&!err?html`<image href=${tm.logo} x="-23" y="-23" width="46" height="46" preserveAspectRatio="xMidYMid meet" onError=${()=>setErr(true)}></image>`
    :html`<text class="tk-fb" y="7" text-anchor="middle">${tm.short}</text>`}
    ${rank?html`<g class="tk-rank"><circle cx="-21" cy="-21" r="13"></circle><text x="-21" y="-16" text-anchor="middle">${rank}</text></g>`:null}
    ${tm.logo&&!err?html`<text class="tk-label" y="44" text-anchor="middle">${tm.short}</text>`:null}
  </g>`;
}
function TvPlayerLine({row,st}){
  const run=row.run,c=Store.doc('classes',run.classId),s=runState(run);
  if(s.cur<0) return html`<span class="tm-sub done">완주 · 페널티 ${fmtPen(row.team.penCs)}</span>`;
  if(run.startedAt==null) return html`<span class="tm-sub">출발 대기</span>`;
  const l=legOf(run,s.cur),p=playerOf(c,(l&&l.playerId)||run.order[s.cur]);
  return html`<span class="tm-sub"><b>${s.cur+1}번</b> ${p?p.name:''} · <em class=${'ph-'+s.phase}>${PHASE_KO[s.phase]}</em> <i class="num" data-ph=${run.classId}></i></span>`;
}
function RaceScene({match,media,cam}){
  useStore();
  const st=CFG.settings(),course=CFG.course();
  const geoKey=JSON.stringify(course.points);
  const geo=useMemo(()=>buildCourse(course.points),[geoKey]);
  const rangeAt=course.rangeAt==null?defaultRangeAt(geo,course.bgPreset):course.rangeAt;
  const frame=useMemo(()=>rangeFrame(geo,rangeAt,course.rangeAngle,st.laneCount,course.markScale,course.rangeScale),[geo,rangeAt,course.rangeAngle,st.laneCount,course.markScale,course.rangeScale]);
  const table=raceTable(match);
  const teams=table.map(r=>{
    const c=Store.doc('classes',r.run.classId);
    return {id:r.run.classId,run:r.run,cls:c,short:classShort(c),name:className(c),color:vestColor(r.run.lane),lane:r.run.lane,logo:logoOf(c)};
  });
  const byId={};
  table.forEach(r=>{byId[r.run.classId]=r;});
  const model=useRef(null);
  model.current={teams,st,geo,frame,rangeAt,byId,table,tokenScale:(Math.min(1,frame.spacing*frame.rs/58)*frame.k).toFixed(3)};
  const root=useRef(null);
  const orderKey=table.map(r=>r.run.classId).join();
  const prevOrder=useRef(null);
  const [flash,setFlash]=useState(null);
  const [ups,setUps]=useState({});
  useEffect(()=>{
    const cur=orderKey.split(','),prev=prevOrder.current;
    prevOrder.current=cur;
    if(!prev||prev.join()===orderKey) return;
    const gains=cur.map((id,i)=>({id,i,was:prev.indexOf(id)})).filter(x=>x.was>x.i);
    const real=gains.filter(g=>{const over=model.current.byId[prev[g.i]];return over&&over.passed>0;});
    if(!real.length) return;
    const top=real.sort((a,b)=>a.i-b.i)[0];
    const c=Store.doc('classes',top.id),until=Date.now()+3800;
    setFlash({text:className(c)+', '+(top.i+1)+'위로 역전!',key:Date.now(),until});
    setUps(u=>({...u,[top.id]:until}));
  },[orderKey]);
  const clock=Date.now();
  const flashNow=flash&&clock<flash.until?flash:null;
  const isUp=id=>!!ups[id]&&clock<ups[id];
  useEffect(()=>{
    const disp={};
    let last=performance.now();
    return Ticker.add(()=>{
      const M=model.current,el=root.current;
      if(!M||!el) return;
      const t=Live.now(),perf=performance.now(),dt=Math.min(.25,(perf-last)/1000);
      last=perf;
      const k=1-Math.exp(-dt/.35),k2=1-Math.exp(-dt/.14);
      const items=[],shooting=new Set();
      M.teams.forEach(tm=>{
        const run=tm.run,prog=runProgress(run,t,M.st,M.rangeAt),n=(run.order||[]).length||1;
        const d=disp[tm.id]||(disp[tm.id]={o:prog.overall,x:null,y:null});
        d.o+=(prog.overall-d.o)*k;
        if(Math.abs(prog.overall-d.o)<.0004) d.o=prog.overall;
        const p=d.o>=n?1:d.o-Math.floor(d.o);
        const pt=M.geo.at(p),sl=M.frame.slot(tm.lane);
        const b=smooth(clamp(1-Math.abs(p-M.rangeAt)/.045,0,1));
        items.push({tm,prog,d,n,x:lerp(pt.x,sl.x,b),y:lerp(pt.y,sl.y,b),slot:b>.5});
        if(prog.phase==='shoot') shooting.add(tm.lane);
      });
      // 같은 자리에 모인 로고는 서로 비켜 세운다
      for(let it=0;it<2;it++) for(let i=0;i<items.length;i++) for(let j=i+1;j<items.length;j++){
        const a=items[i],b=items[j];
        if(a.slot||b.slot) continue;
        let dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy);
        const min=44*M.frame.k;
        if(dist>=min) continue;
        if(dist<.01){dx=j-i;dy=j%2?1:-1;dist=Math.hypot(dx,dy);}
        const push=(min-dist)/2/dist;
        a.x-=dx*push;a.y-=dy*push;b.x+=dx*push;b.y+=dy*push;
      }
      items.forEach(o=>{
        const id=o.tm.id,d=o.d,row=M.byId[id],run=o.tm.run;
        d.x=d.x==null?o.x:d.x+(o.x-d.x)*k2;
        d.y=d.y==null?o.y:d.y+(o.y-d.y)*k2;
        const tk=el.querySelector('[data-tk="'+id+'"]');
        if(tk){
          tk.setAttribute('transform','translate('+d.x.toFixed(1)+','+d.y.toFixed(1)+') scale('+M.tokenScale+')');
          tk.classList.toggle('is-shoot',o.prog.phase==='shoot');
          tk.classList.toggle('is-done',o.prog.phase==='done');
        }
        const pct=clamp(d.o/o.n,0,1)*100;
        const trk=el.querySelector('[data-trk="'+id+'"]');
        if(trk) trk.style.left=pct.toFixed(2)+'%';
        const fill=el.querySelector('[data-fill="'+id+'"]');
        if(fill) fill.style.width=pct.toFixed(2)+'%';
        const tt=el.querySelector('[data-tt="'+id+'"]');
        if(tt&&row){
          const v=row.team.complete?fmtCs(row.team.finalCs):run.startedAt==null?'--:--.--':fmtCs(lapNowCs(run,t,M.st)+row.pen);
          setTm(tt,v);
        }
        const ph=el.querySelector('[data-ph="'+id+'"]');
        if(ph){
          const v=phaseElapsedCs(run,t,M.st);
          const txt=v==null?'':fmtCs(v);
          if(ph.textContent!==txt) ph.textContent=txt;
        }
      });
      el.querySelectorAll('[data-lane]').forEach(g=>{
        g.classList.toggle('active',shooting.has(+g.getAttribute('data-lane')));
      });
    });
  },[match.id]);
  const allRec=rankRecords(allRecords().filter(r=>r.matchId===match.id),false);
  const legsN=Math.max(1,...teams.map(t=>(t.run.order||[]).length));
  const nRows=Math.max(teams.length,3);
  return html`<div class="ltv-race ${media?'with-media':''} ${teams.length>4?'is-many':''}" ref=${root}>
    <div class="ltv-left">
      ${media?html`<div class="ltv-media">${media}</div>`:null}
      <div class="ltv-course">
        <${CourseSvg} geo=${geo} rangeAt=${rangeAt} rangeAngle=${course.rangeAngle} laneCount=${st.laneCount} bgId=${course.bgId} bgDim=${course.bgDim} preset=${course.bgPreset} k=${course.markScale} rs=${course.rangeScale}>
          ${cpList().length?html`<${CpMarks} geo=${geo} k=${Math.max(.6,course.markScale*.8)} cam=${cam}/>`:null}
          ${[...teams].reverse().map((tm,i)=>html`<${MoveToken} key=${tm.id} tm=${tm} rank=${byId[tm.id].started?byId[tm.id].rank:null}/>`)}
        <//>
        ${flashNow?html`<div class="ltv-flash" key=${flashNow.key}><span>${flashNow.text}</span></div>`:null}
      </div>
      ${media?null:html`<div class="ltv-tracker">
        <div class="trk-head"><span></span><div class="trk-legs">${Array.from({length:legsN},(_,i)=>html`<span key=${i}>${i+1}번 주자</span>`)}</div></div>
        <div class="trk-rows" style=${'--n:'+nRows}>
          ${teams.map((tm,i)=>html`<div class="trk-row" key=${tm.id} style=${'--i:'+i}>
            <span class="trk-name"><${Logo} cls=${tm.cls} className="trk-nlogo"/><b>${tm.name}</b></span>
            <div class="trk-track">
              <div class="trk-grid">${Array.from({length:legsN},(_,k)=>html`<i key=${k}></i>`)}</div>
              <b class="trk-fill" data-fill=${tm.id} style=${'background:'+tm.color}></b>
              <span class="trk-logo" data-trk=${tm.id}><${Logo} cls=${tm.cls} className="trk-img"/></span>
            </div>
          </div>`)}
        </div>
      </div>`}
    </div>
    <div class="ltv-right">
      <section class="ltv-board ltv-teams">
        <h3>실시간 경기 순위</h3>
        <div class="ltv-rows" style=${'--n:'+Math.max(table.length,3)}>
          ${table.map((r,i)=>{
            const c=Store.doc('classes',r.run.classId);
            return html`<div class="tm ${r.started&&r.rank<=3?'p'+r.rank:''} ${isUp(r.run.classId)?'is-up':''} ${r.team.complete?'is-fin':''}" key=${r.run.classId} style=${'--i:'+i+';'+vestStyle(r.run.lane)}>
              <i class="tm-vest"></i><span class="tm-rank">${r.started?r.rank:'–'}</span>
              <${Logo} cls=${c} className="tm-logo"/>
              <div class="tm-main"><strong>${className(c)}${isUp(r.run.classId)?html`<i class="tm-up">▲</i>`:null}</strong></div>
              <div class="tm-time"><span class="tmono tm-now" data-tt=${r.run.classId}></span>${r.gapCs?html`<em><${Tm} v=${(r.gapCs>0?'+':'')+fmtCs(r.gapCs)}/></em>`:null}</div>
            </div>`;
          })}
        </div>
      </section>
      <section class="ltv-board ltv-indiv">
        <h3>${match.title} 개인 순위</h3>
        ${allRec.length?html`<div class="ltv-rows" style="--n:6">
          ${allRec.slice(0,6).map((r,i)=>html`<div class="ind" key=${r.id} style=${'--i:'+i}>
            <span class="ind-rank">${r.rank}위</span>
            <strong>${r.name}</strong>
            <span class="ind-cls">${classShort(r.cls)}</span>
            <span class="ind-pen">${r.penCs>0?fmtPen(r.penCs):''}</span>
            <${Tm} class="ind-time" v=${fmtCs(r.finalCs)}/>
          </div>`)}
        </div>`:html`<p class="ltv-empty">첫 주자가 도착하면 기록이 표시됩니다.</p>`}
      </section>
    </div>
  </div>`;
}
/* 순위 화면: 풋살 TV와 같은 줄 등장 애니메이션과 1~3위 금·은·동 배경 */
const rankLi=(r,i,div,big)=>html`<li key=${r.id} class=${'fly '+(r.rank<=3?'p'+r.rank:'')} style=${`--i:${i};animation-delay:${(.25+(div==='W'?.08:0)+i*.16).toFixed(2)}s`}>
  <span class="rk">${r.rank}</span>
  <${SUI.TeamLogo} cls=${r.key} size=${big?'3.6em':'2.2em'}/>
  <span class="nm">${r.name}${r.sub?html`<small>${r.sub}</small>`:null}</span>
  <span class="gl"><${Tm} v=${r.time}/>${r.penText?html`<em>${r.penText}</em>`:null}</span>
</li>`;
function RankScene({slide}){
  const d=boardData();
  const empty=html`<div class="tv-empty"><span><b>아직 기록이 없습니다</b>경기가 끝나면 순위가 나타납니다.</span></div>`;
  if(slide.id==='duo'){
    const col=(title,rows,div)=>html`<div class=${'col '+div}><h3><i></i>${title}</h3>
      ${rows.length?html`<ol>${rows.slice(0,10).map((r,i)=>rankLi(r,i,div,false))}</ol>`:html`<div class="tv-empty" style="font-size:1.2em">아직 기록이 없습니다</div>`}</div>`;
    return html`<div class="tv-sc">${col('남자 TOP 10',d.male,'M')}${col('여자 TOP 10',d.female,'W')}</div>`;
  }
  const rows=(d[slide.id]||[]).slice(0,10);
  if(!rows.length) return empty;
  const a=rows.slice(0,5),b=rows.slice(5,10);
  return html`<div class="tv-sc tv-best">
    <div class="col"><ol>${a.map((r,i)=>rankLi(r,i,'',true))}</ol></div>
    <div class="col"><ol>${b.map((r,i)=>rankLi(r,i+5,'',true))}</ol></div>
  </div>`;
}
function ScheduleScene({now}){
  const ms=scopedMatches();
  const today=todayStr();
  const day=ms.filter(m=>m.date===today);
  const list=(day.length?day:ms).slice(0,9);
  return html`<section class="ltv-board ltv-sched">
    <h3>${day.length?fmtDateKo(today)+' 경기 일정':'경기 일정'}</h3>
    <ol>${list.map(m=>html`<li key=${m.id} class=${'s-'+m.status}>
      <${Tm} class="sc-time" v=${effectiveTimeStr(m)}/>
      <strong>${m.title}</strong>
      <span class="sc-teams">${teamLabel(m)}</span>
      <span class="sc-flags">${m.delayMin>0?html`<em class="f-delay">지연 ${m.delayMin}분</em>`:null}${m.changed?html`<em class="f-change">일정 변경</em>`:null}</span>
      <span class="ltv-status ${(STATUS[m.status]||STATUS.tbd).c}">${(STATUS[m.status]||STATUS.tbd).t}</span>
    </li>`)}</ol>
  </section>`;
}
function NextScene({next,now,media}){
  const data=boardData();
  const side=data.class.length?{t:'학급 TOP 5',rows:data.class}:{t:'개인 TOP 5',rows:data.all};
  const after=scopedMatches().filter(m=>(m.status==='tbd'||!m.status)&&(!next||m.id!==next.id)).sort((a,b)=>(effectiveMs(a)||9e15)-(effectiveMs(b)||9e15)).slice(0,3);
  const classes=next?(next.classIds||[]).map(id=>Store.doc('classes',id)).filter(Boolean):[];
  const posters=classes.filter(c=>c.posterId);
  return html`<div class="ltv-next">
    <section class="ltv-next-main">
      <span class="ltv-kicker">다음 경기</span>
      ${next?html`
        <h2>${teamLabel(next)}</h2>
        <div class="ltv-next-info">
          <span class="ltv-next-title">${next.title}</span>
          <span class="num">${next.date===ymd(new Date(now))?'':fmtDateKo(next.date,false)+' '}${effectiveTimeStr(next)}</span>
          ${next.delayMin>0?html`<em class="f-delay">지연 ${next.delayMin}분${next.delayReason?' · '+next.delayReason:''}</em>`:null}
          ${next.changed?html`<em class="f-change">일정 변경</em>`:null}
        </div>
        <div class="ltv-next-count"><small>시작까지</small><${Tm} class="cnt" v=${next.date===ymd(new Date(now))||effectiveMs(next)-now<36e5*24?countdownText(next,now):timeUntilText(next,now)}/></div>
        <div class="ltv-next-visual">
          ${media?html`<div class="ltv-media">${media}</div>`:
            posters.length?posters.slice(0,3).map(c=>html`<figure key=${c.id}><img src=${MediaStore.url(c.posterId)} alt=${className(c)+' 포스터'}/><figcaption>${className(c)}</figcaption></figure>`)
            :classes.map(c=>html`<div class="ltv-next-team" key=${c.id}><${Logo} cls=${c} className="ltv-next-logo"/><span>${className(c)}</span></div>`)}
        </div>
      `:html`<h2>예정된 경기가 없습니다</h2>${media?html`<div class="ltv-next-visual"><div class="ltv-media">${media}</div></div>`:null}`}
    </section>
    <aside class="ltv-next-side">
      ${after.length?html`<section class="ltv-board ltv-after">
        <h3>이후 일정</h3>
        <ol>${after.map(m=>html`<li key=${m.id}><span class="num">${m.date===ymd(new Date(now))?'':fmtDateKo(m.date,false)+' '}${effectiveTimeStr(m)}</span><strong>${teamLabel(m)}</strong></li>`)}</ol>
      </section>`:null}
      <section class="ltv-board ltv-top ltv-top-side">
        <h3>${side.t}</h3>
        ${side.rows.length?html`<ol>${side.rows.slice(0,5).map((r,i)=>html`<li key=${r.id} class=${'lr-fly '+(r.rank<=3?'p'+r.rank:'')} style=${'animation-delay:'+(.25+i*.16).toFixed(2)+'s'}>
          <span class="tt-rank">${r.rank}</span><strong>${r.name}</strong><span class="tt-cls">${r.sub}</span><${Tm} class="tt-time" v=${r.time}/>
        </li>`)}</ol>`:html`<p class="ltv-empty">아직 기록이 없습니다.</p>`}
      </section>
    </aside>
  </div>`;
}
/* ---------- TV 화면 목록: 순서 · 켜기 · 화면마다 보여 줄 시간 (TV 송출 › 화면 순서 · 시간) ---------- */
const TV_ITEMS=[
  {k:'race',label:'경기 현황',desc:'코스 위 학급 로고 · 실시간 순위 · 진행 막대 (진행 중이거나 막 끝난 경기가 있을 때)',sec:30},
  {k:'next',label:'다음 경기 안내',desc:'다음 경기 학급 · 시작까지 남은 시간 · 이후 일정',sec:15},
  {k:'class',label:'학급 TOP 10',sec:15},
  {k:'all',label:'개인 전체 TOP 10',sec:15},
  {k:'male',label:'남자 TOP 10',desc:'여자 TOP 10과 함께 켜면 한 화면에 나란히',sec:15},
  {k:'female',label:'여자 TOP 10',sec:15},
  {k:'g1',label:'1학년 TOP 10',sec:12},
  {k:'g2',label:'2학년 TOP 10',sec:12},
  {k:'g3',label:'3학년 TOP 10',sec:12},
  {k:'schedule',label:'경기 일정',desc:'오늘 경기 순서와 상태',sec:15}
];
const TV_ITEM=Object.fromEntries(TV_ITEMS.map(x=>[x.k,x]));
/** 저장된 목록 설정(예전 boards · rotateSec도 읽는다) */
function tvListCfg(tv){
  const s=tv.slides||{},b=tv.boards||{};
  const keys=TV_ITEMS.map(x=>x.k);
  const order=(Array.isArray(s.order)?s.order.filter(k=>TV_ITEM[k]):[]);
  keys.forEach(k=>{if(!order.includes(k)){const i=keys.indexOf(k);let at=order.length;for(let j=i-1;j>=0;j--){const p=order.indexOf(keys[j]);if(p>=0){at=p+1;break;}}order.splice(at,0,k);}});
  const on={},sec={};
  keys.forEach(k=>{
    on[k]=s.on&&k in s.on?!!s.on[k]:(k in b?!!b[k]:true);
    const v=s.sec&&+s.sec[k];
    sec[k]=Math.max(5,v||(k==='race'?TV_ITEM.race.sec:(tv.rotateSec||TV_ITEM[k].sec)));
  });
  return {order,on,sec};
}
/** 오래 버려진 '진행 중' 경기: 30분 넘게 아무 기록도 없으면 TV를 그 경기에 붙잡아 두지 않는다 */
function liveStale(m,now){
  const ev=Math.max(m.startedAt||0,...runsOfMatch(m).map(lastEventTime));
  return !!ev&&now-ev>30*60000;
}
function tvLiveMatch(tv,now){
  const live=matchesSorted().filter(m=>m.status==='live'&&!liveStale(m,now));
  const pinned=tv.pinnedMatchId?Store.doc('matches',tv.pinnedMatchId):null;
  return (pinned&&pinned.status==='live'&&!liveStale(pinned,now)&&pinned)||live.find(m=>!m.sample)||live[0]||null;
}
/** 지금 경기 현황에 고정되어 이전 · 멈춤 · 다음이 듣지 않는가 */
function tvLocked(tv,now){
  if(tv.scene==='race') return true;
  if(tv.scene&&tv.scene!=='auto'&&tv.scene!=='top10') return false;
  return tv.liveLock!==false&&!!tvLiveMatch(tv,now);
}
/** 지금 보여 줄 화면. ctl={adj,hold}: 이전 · 멈춤 · 다음으로 옮긴 칸 */
function tvPick(now,tv,ctl){
  const all=matchesSorted(),scoped=scopedMatches();
  const pinned=tv.pinnedMatchId?Store.doc('matches',tv.pinnedMatchId):null;
  const liveM=tvLiveMatch(tv,now);
  const recent=all.filter(m=>m.status==='done'&&m.finishedAt&&now-m.finishedAt<tv.resultHoldSec*1000&&(!sampleHidden()||!m.sample)).sort((a,b)=>b.finishedAt-a.finishedAt)[0]||null;
  const next=nextMatch(scoped,now);
  const raceM=liveM||(pinned&&pinned.status!=='tbd'&&!(pinned.status==='live'&&liveStale(pinned,now))&&pinned)||recent||null;
  const fixed=(scene,match)=>({scene,match,next,board:null,locked:true,sec:0,el:0,idx:0,n:1,autoIdx:0});
  if(tv.scene==='race'){const m=pinned||raceM||scoped.filter(x=>x.status==='done').pop()||next;return m?fixed('race',m):fixed('next',null);}
  if(tv.scene==='next'||tv.scene==='schedule') return fixed(tv.scene,null);
  if(tv.liveLock!==false&&(liveM||recent)) return fixed('race',liveM||recent);
  // 목록 순서대로: 꺼 둔 화면과 보여 줄 내용이 없는 화면은 건너뛴다
  const cfg=tvListCfg(tv),data=boardData(),seq=[];
  const both=cfg.on.male&&cfg.on.female&&slideCount('duo',data)>0;
  let duoDone=false;
  cfg.order.forEach(k=>{
    if(!cfg.on[k]) return;
    const sec=cfg.sec[k];
    if(k==='race'){if(raceM) seq.push({k:'race',sec,match:raceM});return;}
    if(k==='next'){if(next) seq.push({k:'next',sec});return;}
    if(k==='schedule'){if(scoped.length) seq.push({k:'schedule',sec});return;}
    if((k==='male'||k==='female')&&both){if(!duoDone){duoDone=true;seq.push({k:'board',sec,s:{id:'duo',title:'남자 · 여자 TOP 10'}});}return;}
    if(slideCount(k,data)>0) seq.push({k:'board',sec,s:{id:k,title:TV_ITEM[k].label}});
  });
  if(!seq.length) seq.push({k:next?'next':'schedule',sec:15});
  const T=seq.reduce((a,x)=>a+x.sec*1000,0);
  let p=now%T,autoIdx=0;
  while(autoIdx<seq.length-1&&p>=seq[autoIdx].sec*1000){p-=seq[autoIdx].sec*1000;autoIdx++;}
  const n=seq.length,mod=i=>((i%n)+n)%n;
  const idx=ctl?(ctl.hold!=null?mod(ctl.hold):mod(autoIdx+ctl.adj)):autoIdx;
  const cur=seq[idx];
  return {scene:cur.k,match:cur.match||null,next,board:cur.s||null,locked:false,sec:cur.sec,el:p,idx,n,autoIdx,cycle:Math.floor(now/T)};
}
/** 표시할 촬영 영상을 고른다. 고장 난 파일은 건너뛰고 기본 화면으로 돌아간다. */
function useTvMedia(){
  const tv=CFG.tv();
  const [curId,setCurId]=useState(null);
  const seen=useRef(Live.now());
  const bad=useRef(new Set());
  const items=Store.list('media').filter(m=>(m.kind==='video'||m.kind==='image')&&MediaStore.url(m.assetId)&&!bad.current.has(m.id)).sort((a,b)=>a.at-b.at);
  let active=null;
  if(tv.mediaMode==='pinned') active=items.find(m=>m.id===tv.pinnedMediaId)||null;
  else if(tv.mediaMode==='new') active=items.find(m=>m.id===curId)||items.find(m=>m.at>seen.current)||null;
  else if(tv.mediaMode==='loop') active=items.find(m=>m.id===curId)||items[0]||null;
  const activeId=active&&active.id;
  useEffect(()=>{if(activeId&&activeId!==curId&&tv.mediaMode!=='pinned')setCurId(activeId);},[activeId]);
  const done=useCallback(()=>{
    const cfg=CFG.tv(),list=Store.list('media').filter(m=>(m.kind==='video'||m.kind==='image')&&!bad.current.has(m.id)).sort((a,b)=>a.at-b.at);
    if(cfg.mediaMode==='new'){
      setCurId(id=>{const c=list.find(m=>m.id===id);if(c)seen.current=Math.max(seen.current,c.at);return null;});
    }else if(cfg.mediaMode==='loop'){
      setCurId(id=>{const i=list.findIndex(m=>m.id===id);return list.length?list[(i+1)%list.length].id:null;});
    }
  },[]);
  const fail=useCallback(id=>{bad.current.add(id);done();Store.touch();},[done]);
  return {active,done,fail,loop:tv.mediaMode==='pinned'||items.length===1&&tv.mediaMode==='loop'};
}
function TvMediaView({item,loop,onDone,onFail}){
  const vid=useRef(null);
  useEffect(()=>{
    if(item.kind==='image'&&!loop){const t=setTimeout(onDone,8000);return()=>clearTimeout(t);}
    if(item.kind==='video'&&!loop){const t=setTimeout(onDone,120000);return()=>clearTimeout(t);}
  },[item.id,loop]);
  useEffect(()=>{if(vid.current)vid.current.play().catch(()=>{});},[item.id]);
  const url=MediaStore.url(item.assetId);
  return html`<div class="ltv-media-in">
    ${item.kind==='image'?html`<img src=${url} alt=${item.title||'촬영 사진'} onError=${()=>onFail(item.id)}/>`
    :html`<video key=${item.id} ref=${vid} src=${url} muted autoplay playsinline loop=${loop} onEnded=${onDone} onError=${()=>onFail(item.id)}></video>`}
    <span class="ltv-media-tag"><i class="live-dot"></i>${item.segment?item.segment+' 구간':'현장 영상'}</span>
  </div>`;
}
/* ---------- 풋살 TV의 음악·화면 유지 동작을 같은 방식으로 쓴다 (풋살 tv.js는 고치지 않는다) ---------- */
function useBgm(cfg,started){
  const m=cfg.music||{};
  const list=SD.playlistOf(cfg);
  const on=m.on!==false&&list.length>0;
  const audio=useRef(null);
  if(!audio.current&&typeof Audio!=='undefined'){audio.current=new Audio();audio.current.preload='auto';}
  const cur=useRef(null),listRef=useRef(list),onRef=useRef(on),wanted=useRef(false),live=useRef(started);
  listRef.current=list;onRef.current=on;live.current=started;
  const [st,setSt]=useState({id:null,playing:false,blocked:false});
  const [vol,setVolS]=useState(()=>{const v=SD.ls.get('tvVol',null);return v==null?(Number(m.vol)||0.7):v;});
  const setVol=v=>{setVolS(v);SD.ls.set('tvVol',v);};
  const play=()=>{const a=audio.current;if(!a)return;a.play().then(()=>setSt(s=>({...s,playing:true,blocked:false}))).catch(()=>setSt(s=>({...s,playing:false,blocked:true})));};
  const load=(t,go)=>{const a=audio.current;if(!a||!t)return;cur.current=t.id;a.src=t.file;setSt(s=>({...s,id:t.id}));if(go)play();};
  const step=d=>{
    const l=listRef.current,a=audio.current;
    if(!l.length||!a) return;
    const i=l.findIndex(t=>t.id===cur.current);
    const t=l[((i<0?(d>0?-1:0):i)+d+l.length)%l.length];
    if(t.id===cur.current&&a.src){a.currentTime=0;play();}else load(t,true);
  };
  const fails=useRef(0);
  const start=()=>{if(!onRef.current)return;wanted.current=true;if(!cur.current)load(listRef.current[0],true);else play();};
  const pause=()=>{wanted.current=false;if(audio.current)audio.current.pause();setSt(s=>({...s,playing:false}));};
  useEffect(()=>{
    const a=audio.current;
    if(!a) return;
    const end=()=>{fails.current=0;step(1);};
    const bad=()=>{if(!a.getAttribute('src')||!wanted.current)return;if(++fails.current>listRef.current.length)return;setTimeout(()=>{if(wanted.current)step(1);},1500);};
    const ok=()=>{fails.current=0;};
    const p1=()=>setSt(s=>({...s,playing:true})),p0=()=>setSt(s=>({...s,playing:false}));
    a.addEventListener('ended',end);a.addEventListener('error',bad);a.addEventListener('playing',ok);a.addEventListener('play',p1);a.addEventListener('pause',p0);
    return()=>{a.removeEventListener('ended',end);a.removeEventListener('error',bad);a.removeEventListener('playing',ok);a.removeEventListener('play',p1);a.removeEventListener('pause',p0);a.pause();a.removeAttribute('src');a.load();};
  },[]);
  useEffect(()=>{if(audio.current)audio.current.volume=Math.max(0,Math.min(1,vol));},[vol]);
  const key=list.map(t=>t.id).join('|');
  useEffect(()=>{
    if(!on){if(audio.current&&!audio.current.paused)audio.current.pause();return;}
    if(cur.current&&!list.some(t=>t.id===cur.current)&&wanted.current) step(1);
    else if(live.current&&!wanted.current) start();
  },[on,key]);
  return {on,track:SD.trackOf(st.id),playing:st.playing,blocked:st.blocked&&wanted.current,start,pause,next:()=>step(1),prev:()=>step(-1),vol,setVol,wanted};
}
function useKeepAwake(on,vref){
  const [st,setSt]=useState({api:false,vid:false});
  useEffect(()=>{
    if(!on) return;
    let alive=true,lock=null;
    const getLock=async()=>{
      if(!alive||document.visibilityState!=='visible'||!navigator.wakeLock||(lock&&!lock.released)) return;
      try{
        lock=await navigator.wakeLock.request('screen');
        setSt(x=>({...x,api:true}));
        lock.addEventListener('release',()=>{setSt(x=>({...x,api:false}));if(alive)setTimeout(getLock,1000);});
      }catch(e){setSt(x=>({...x,api:false}));}
    };
    const v=vref.current;
    if(!v) return;
    v.muted=false;v.volume=1;
    const play=()=>{if(alive&&v.paused)v.play().then(()=>setSt(x=>({...x,vid:true}))).catch(()=>setSt(x=>({...x,vid:false})));};
    const onPause=()=>setSt(x=>({...x,vid:false}));
    v.addEventListener('pause',onPause);
    const poke=()=>{play();getLock();};
    const vis=()=>{if(document.visibilityState==='visible')poke();};
    getLock();play();
    document.addEventListener('visibilitychange',vis);
    window.addEventListener('pointerdown',poke);window.addEventListener('keydown',poke);
    const t=setInterval(poke,60000);
    return()=>{
      alive=false;clearInterval(t);
      document.removeEventListener('visibilitychange',vis);window.removeEventListener('pointerdown',poke);window.removeEventListener('keydown',poke);
      v.removeEventListener('pause',onPause);v.pause();
      if(lock) lock.release().catch(()=>{});
    };
  },[on]);
  return st.api||st.vid;
}
/* 다음 경기 안내 · 공지 띠. 풋살 공지 띠와 같은 모양이고, 글이 길면 흐른다. */
function AnnounceBar({tag,text,count,notice}){
  const box=useRef(null),one=useRef(null);
  const [run,setRun]=useState(0);
  useLayoutEffect(()=>{
    const measure=()=>{
      const b=box.current,t=one.current;
      if(!b||!t) return;
      const w=t.getBoundingClientRect().width;
      setRun(w-b.clientWidth>4?Math.max(12,Math.round(w/90)):0);
    };
    measure();
    const ro=window.ResizeObserver&&box.current?new ResizeObserver(measure):null;
    if(ro) ro.observe(box.current);
    return()=>{if(ro)ro.disconnect();};
  },[text]);
  return html`<div class="tv-nbar ltv-bar ${notice?'is-notice':''}"><span class="nb-tag">${tag}</span><div class="nb-box" ref=${box}>
    <span class=${'nb-text'+(run?' run':'')} style=${run?`animation-duration:${run}s`:''}><span class="nb-one" ref=${one}>${text}</span>${run?html`<span class="nb-gap"></span>${text}<span class="nb-gap"></span>`:null}</span></div>
    ${count?html`<${Tm} class="ltv-bar-count" v=${count}/>`:null}</div>`;
}
const SCENE_TITLE={next:'다음 경기 안내',schedule:'경기 일정'};
/** TV 화면 본체. TV 송출 메뉴의 미리보기(embedded)와 전체 화면 TV가 함께 쓴다. */
/* 레이저런 TV는 늘 블랙·레드: 붉은 색조(--tv-h/--tv-s)로 카드·선·글씨를 맞추고, 배경은 Waves가 그린다. */
const LR_TV_TINT='--tv-h:356;--tv-s:80%;--star:255,178,184;';
function TvBody({embedded,root,rootClass,rootStyle,head,foot,extra,ctl,tc}){
  useStore();
  const now=useNow(500);
  const st=CFG.settings(),tv=CFG.tv();
  // 이전 · 멈춤 · 다음: 자동으로 넘어가는 화면 순서에서 몇 칸 옮겼는지(adj), 멈춘 칸(hold)
  const pick=tvPick(now,tv,ctl);
  const rotMs=Math.max(5,pick.sec||15)*1000;
  const md=useTvMedia();
  const mediaEl=md.active?html`<${TvMediaView} key=${md.active.id} item=${md.active} loop=${md.loop} onDone=${md.done} onFail=${md.fail}/>`:null;
  // 최고 기록 갱신 알림
  const best=rankRecords(scopedRecords())[0]||null;
  const prevBest=useRef(best);
  const [recFlash,setRecFlash]=useState(null);
  useEffect(()=>{
    const p=prevBest.current;
    prevBest.current=best;
    if(p&&best&&best.id!==p.id&&best.finalCs<p.finalCs){
      setRecFlash({r:best,prev:p.finalCs});
      const t=setTimeout(()=>setRecFlash(null),9000);
      return()=>clearTimeout(t);
    }
  },[best&&best.id,best&&best.finalCs]);
  const m=pick.match;
  const isRace=pick.scene==='race'&&m;
  const runs=isRace?runsOfMatch(m):[];
  // 기자단 카메라: 경기 화면일 때만 코스 위에 띄운다 (자동이면 선두가 다음에 지나갈 카메라)
  const camN=isRace&&tc&&camPoints().length?(tc.auto?camSuggest(m,now):camPoints().some(c=>c.n===tc.cam)?tc.cam:null):null;
  const camEl=camN?html`<${CamView} n=${camN}/>`:null;
  const lapFn=()=>{
    const mm=m&&Store.doc('matches',m.id);
    const rs=(mm?runsOfMatch(mm):[]).filter(r=>r.startedAt!=null);
    if(!rs.length) return '00:00.00';
    const a=Math.min(...rs.map(r=>r.startedAt)),fin=rs.length===runs.length&&rs.every(r=>r.finishedAt!=null);
    const b=fin?Math.max(...rs.map(r=>r.finishedAt)):Live.now();
    return fmtCs(toCs(Math.max(0,b-a)*(rs[0].scale||1),st.rounding));
  };
  const isFinal=isRace&&m.status==='done';
  const showSampleTag=isRace?m.sample:(!hasReal()&&hasSample());
  const clock=new Date(now);
  const notice=tv.notice&&tv.notice.trim();
  const showNotice=notice&&(!pick.next||Math.floor(now/8000)%2===0);
  const held=!!(ctl&&ctl.hold!=null);
  const legsDone=runs.reduce((a,r)=>a+teamResult(r,st).done,0),legsAll=runs.reduce((a,r)=>a+(r.order||[]).length,0);
  const pct=legsAll?Math.round(legsDone/legsAll*100):0;
  const sceneKey=isRace?'race'+m.id:pick.scene==='board'?'board'+pick.board.id:pick.scene;
  return html`<div class=${'tv lr lr-tv tint lr-red '+(embedded?'lr-tv-embed ':'lr-tv-full ')+(rootClass||'')} style=${LR_TV_TINT+(rootStyle||'')} ref=${root}>
    <${SUI.Waves}/>
    ${head}
    <div class="tv-head">
      <${SUI.Logo} size=${86}/>
      <div class="league"><b>${st.eventName}</b><span>레이저런 · SD Sports Management Platform</span></div>
      ${showSampleTag?html`<span class="ltv-sample">예시 데이터</span>`:null}
      <div class="ttl"><b>${isRace?m.title:pick.scene==='board'?pick.board.title:(SCENE_TITLE[pick.scene]||'')}</b><span>${isRace?(isFinal?'최종 결과':m.status==='live'?'경기 진행 중':'출발 대기'):fmtDateKo(todayStr())}</span></div>
      ${isRace?html`<div class="ltv-lap"><small>전체 랩타임</small><${LiveText} fn=${lapFn}/></div>`:null}
      <div class="clock">${pad2(clock.getHours())}:${pad2(clock.getMinutes())}<small>${SD.fmtDate(todayStr())}</small></div>
    </div>
    <div class="tv-prog">${pick.locked
      ?html`<i class="ltv-prog-fill" style=${'width:'+(isRace?pct:100)+'%'}></i>`
      :html`<i key=${'c'+pick.cycle+'i'+pick.idx+(ctl?'a'+ctl.adj:'')} style=${held?'width:100%;opacity:.45':`animation:tvprog ${rotMs}ms linear forwards;animation-delay:-${Math.min(pick.el,rotMs-50)}ms`}></i>`}</div>
    <div class="tv-stage">
      <div class="tv-slide" key=${sceneKey}>
        ${isRace?html`<${RaceScene} key=${m.id} match=${m} media=${camEl||mediaEl} cam=${camN}/>`:null}
        ${pick.scene==='next'?html`<${NextScene} next=${pick.next} now=${now} media=${mediaEl}/>`:null}
        ${pick.scene==='board'?html`<${RankScene} key=${pick.board.id} slide=${pick.board}/>`:null}
        ${pick.scene==='schedule'?html`<${ScheduleScene} now=${now}/>`:null}
      </div>
      ${recFlash?html`<div class="ltv-record"><span>최고 기록 갱신</span><strong><${Tm} v=${fmtCs(recFlash.r.finalCs)}/></strong><em>${recFlash.r.name} · ${className(recFlash.r.cls)} (이전 ${fmtCs(recFlash.prev)})</em></div>`:null}
    </div>
    ${showNotice
      ?html`<${AnnounceBar} tag="공지" text=${notice} notice/>`
      :html`<${AnnounceBar} tag="다음 경기" text=${pick.next?announceText(pick.next,now):'오늘 예정된 경기를 모두 마쳤습니다.'} count=${pick.next&&effectiveMs(pick.next)!=null&&effectiveMs(pick.next)-now<864e5&&effectiveMs(pick.next)>now?countdownText(pick.next,now):null}/>`}
    ${foot?html`<div class="tv-foot">${foot}</div>`:null}
    ${extra}
  </div>`;
}
/** 전체 화면 TV (#tv): 풋살 TV와 같은 시작 화면, 별 배경, 배경음악, 화면 유지 */
function LaserTVInner({onExit}){
  useStore();
  SD.useStore();
  const base=SD.deepMerge(SD.DEFAULT_TV,SD.S.tv||{});
  const tv=CFG.tv();
  const cfg=tv.music===false?{...base,music:{...(base.music||{}),on:false}}:base;
  const [started,setStarted]=useState(!!document.fullscreenElement);
  const bgm=useBgm(cfg,started);
  const awakeRef=useRef(null);
  const awake=useKeepAwake(started,awakeRef);
  const bgmRef=useRef(bgm);bgmRef.current=bgm;
  const [idle,setIdle]=useState(false);
  const root=useRef(null);
  const [lastAt,setLastAt]=useState(Date.now());
  const seen=useRef(Store.version);
  if(seen.current!==Store.version){seen.current=Store.version;}
  useEffect(()=>Store.subscribe(()=>setLastAt(Date.now())),[]);
  const begin=()=>{setStarted(true);bgm.start();};
  // 이전 · 멈춤 · 다음 (풋살 TV와 같은 버튼 · ← → 스페이스). 경기 중에는 경기 현황을 계속 보여 준다.
  const [ctl,setCtl]=useState({adj:0,hold:null});
  const tc=useTvCam();
  const tcRef=useRef(tc);tcRef.current=tc;
  const go=d=>setCtl(c=>c.hold!=null?{...c,hold:c.hold+d}:{...c,adj:c.adj+d});
  const pauseToggle=()=>setCtl(c=>{const p=tvPick(Live.now(),CFG.tv(),c);return c.hold!=null?{adj:p.idx-p.autoIdx,hold:null}:{adj:c.adj,hold:p.idx};});
  const ctlRef=useRef({go,pauseToggle});ctlRef.current={go,pauseToggle};
  const raceLock=tvLocked(CFG.tv(),Live.now());
  const full=()=>{
    const el=root.current;
    if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    else if(el&&el.requestFullscreen) el.requestFullscreen().catch(()=>toast('전체 화면을 쓸 수 없습니다. 브라우저에서 F11 키를 눌러 주세요.','warn'));
  };
  const exit=()=>{if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});onExit();};
  useEffect(()=>{
    Live.setRole('tv');
    SD.setPresence({mode:'tv',mid:null});
    const key=e=>{
      if(e.key==='Escape'&&!document.fullscreenElement) onExit();
      else if(e.key==='f'||e.key==='F') full();
      else if(e.key==='m'||e.key==='M'){const b=bgmRef.current;if(b.playing)b.pause();else b.start();}
      else if(e.key==='n'||e.key==='N') bgmRef.current.next();
      else if(e.key==='ArrowRight') ctlRef.current.go(1);
      else if(e.key==='ArrowLeft') ctlRef.current.go(-1);
      else if(e.key===' '){e.preventDefault();ctlRef.current.pauseToggle();}
      else if(/^[0-9]$/.test(e.key)&&camPoints().length){const cams=camPoints(),i=+e.key;if(i===0)tcRef.current.setCam(null);else if(cams[i-1])tcRef.current.setCam(cams[i-1].n);}
      else if((e.key==='a'||e.key==='A')&&camPoints().length) tcRef.current.setAuto(!tcRef.current.auto);
    };
    window.addEventListener('keydown',key);
    return()=>{Live.setRole('admin');SD.setPresence({mode:'admin'});window.removeEventListener('keydown',key);};
  },[]);
  useEffect(()=>{let t;const mv=()=>{setIdle(false);clearTimeout(t);t=setTimeout(()=>setIdle(true),3000);};mv();window.addEventListener('pointermove',mv);return()=>{clearTimeout(t);window.removeEventListener('pointermove',mv);};},[]);
  const bg=base.bg||{},ns=base.noticeStyle||{},look=SD.noticeVars(ns); // 배경 색은 풋살 TV 것을 따르지 않는다(레이저런은 블랙·레드)
  useEffect(()=>{SD.loadFonts([ns.font]);},[ns.font]);
  const I=SUI.Icon;
  const liveM=tvLiveMatch(CFG.tv(),Live.now());
  return html`<${TvBody} root=${root} ctl=${ctl} tc=${tc} rootClass=${idle&&started?'hidecursor':''} rootStyle=${look}
    head=${html`<${SUI.StarField} tv=${true} balls=${false} meteors=${!!bg.meteors} amt=${bg.amt} speed=${bg.speed}/>
      <video class="keepawake" ref=${awakeRef} loop playsInline preload="auto" aria-hidden="true" tabIndex="-1"><source src="media/keepawake.webm" type="video/webm"/><source src="media/keepawake.mp4" type="video/mp4"/></video>`}
    foot=${html`
      <span class="live">실시간 · ${SD.fmtClock(lastAt)} 갱신</span>
      ${ctl.hold!=null?html`<span>일시 정지</span>`:null}
      ${started?html`<span class=${'awake'+(awake?' on':'')} title=${awake?'송출 중에는 화면이 꺼지지 않습니다':'화면 꺼짐 방지를 켜지 못했습니다. 화면을 한 번 눌러 주세요.'}>${awake?'화면 유지':'화면 유지 꺼짐 · 화면을 한 번 눌러 주세요'}</span>`:null}
      ${bgm.on&&bgm.track?html`<span class=${'bgm'+(bgm.playing?' on':'')}><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><b>${bgm.track.title}</b><span>${bgm.track.artist}</span></span>`:null}
      ${bgm.on&&bgm.blocked?html`<button class="bgm-go" onClick=${bgm.start}><${I} n="music" size=${16}/>음악 재생</button>`:null}
      <div class="ctl">
        <${CamCtl} tc=${tc} suggest=${camSuggest(liveM,Live.now())}/>
        ${bgm.on?html`<span class="bgm-ctl" role="group" aria-label="배경음악">
          <button aria-label="이전 곡" onClick=${bgm.prev}><${I} n="prev" size=${16}/></button>
          <button aria-label=${bgm.playing?'음악 멈춤':'음악 재생'} onClick=${bgm.playing?bgm.pause:bgm.start}><${I} n=${bgm.playing?'pause':'play'} size=${16}/></button>
          <button aria-label="다음 곡" onClick=${bgm.next}><${I} n="next" size=${16}/></button>
          <label class="bgm-vol"><${I} n="vol" size=${16}/><input id="tv-vol" type="range" min="0" max="1" step="0.05" value=${bgm.vol} aria-label="음량" onInput=${e=>bgm.setVol(Number(e.target.value))}/></label>
        </span>`:null}
        <button id="tv-prev" disabled=${raceLock} title=${raceLock?'경기 중에는 경기 현황을 계속 보여 줍니다':''} onClick=${()=>go(-1)}>이전</button>
        <button id="tv-pause" disabled=${raceLock} onClick=${pauseToggle}>${ctl.hold!=null?'재생':'멈춤'}</button>
        <button id="tv-next" disabled=${raceLock} title=${raceLock?'경기 중에는 경기 현황을 계속 보여 줍니다':''} onClick=${()=>go(1)}>다음</button>
        <button id="tv-full" onClick=${full}>전체 화면</button><button id="tv-exit" onClick=${exit}>나가기</button>
      </div>`}
    extra=${started?null:html`<div class="tv-start" onClick=${begin}><div style="text-align:center">
      <button id="tv-begin" onClick=${e=>{e.stopPropagation();begin();full();}}>전체 화면으로 송출 시작</button>
      <p>화면을 누르면 창 모드로 계속합니다 · ← → 넘기기 · 스페이스 멈춤 · F 전체 화면 · M 음악 켜기/끄기 · N 다음 곡 · Esc 나가기</p>
      ${bgm.on?html`<p class="tv-start-bgm"><${I} n="music" size=${16}/> 배경음악 ${SD.playlistOf(cfg).length}곡이 순서대로 반복 재생됩니다</p>`:null}</div></div>`}/>`;
}

/* ==========================================================================
   현장 TV — 경기 운영 › 현장 TV. 경기장 옆 TV에 사로마다 세로 카드 하나씩(1사로부터 고정 순서)
   현재 주자 · 지금 구간 시간 · 주자별 랩타임 · 누적 기록을 크게 보여 준다. 순위는 카드 위 배지로만 바뀐다.
   ========================================================================== */
const VT_PHASE={ready:'출발 대기',run1:'달리는 중',shoot:'사격 중',run2:'도착 지점으로',done:'완주',manual:'직접 입력'};
const penShort=cs=>'+'+fmtCs(cs).replace(/^00:/,'');
function legLiveCs(run,i,t,st){
  const l=legOf(run,i);
  if(!l||l.t0==null) return null;
  return toCs(Math.max(0,t-l.t0)*(run.scale||1),st.rounding);
}
/** 지금 주자의 구간별 시간: 사로까지 · 사격(시작~끝) · 도착까지. 진행 중인 칸은 초시계처럼 흐른다. */
function splitCs(run,i,a,b,t,st){
  const l=legOf(run,i)||{};
  if(l[a]==null) return null;
  const end=l[b]!=null?l[b]:t;
  return toCs(Math.max(0,end-l[a])*(run.scale||1),st.rounding);
}
/** 현장 TV 버튼은 짧게: 출발 · 사로 도착 · 사격 완료 · 도착 (다음 주자 자동 출발은 설정대로 함께 처리된다) */
function venueLabel(run,s){
  const last=s.cur===s.n-1,ret=run.returnRun!==false;
  if(s.phase==='ready') return (s.cur+1)+'번 주자 출발';
  if(s.phase==='run1') return '사로 도착';
  if(s.phase==='shoot') return !ret&&last?'사격 완료 · 끝':'사격 완료';
  return last?'최종 도착':'도착';
}
function VenueLane({m,run,row,st,rec,hotkey}){
  const c=Store.doc('classes',run.classId);
  const s=runState(run),n=(run.order||[]).length;
  const done=s.cur<0,started=run.startedAt!=null;
  const cur=done?n-1:s.cur;
  const p=playerOf(c,(run.order||[])[cur]);
  const legs=Array.from({length:n},(_,i)=>legResult(run,i,st));
  const team=row?row.team:teamResult(run,st);
  const rank=row&&row.started?row.rank:null;
  const ph=done?'done':s.phase;
  const pen=row?row.pen:0;
  const t=Live.now();
  const ret=run.returnRun!==false;
  const pressAt=useRef(null);
  const [flash,setFlash]=useState(false);
  const isFinal=n>0&&s.cur===n-1&&(ret?s.phase==='run2':s.phase==='shoot');
  const act=()=>{
    const at=pressAt.current&&Date.now()-pressAt.current<1500?pressAt.current+Live.offset:Live.now();
    pressAt.current=null;
    if(Actions.advance(m.id,run.classId,at)){setFlash(true);setTimeout(()=>setFlash(false),300);}
  };
  const bigFn=()=>{
    if(done) return team.finalCs!=null?fmtCs(team.finalCs):'--:--.--';
    const v=legLiveCs(run,cur,Live.now(),st);
    return v==null?'00:00.00':fmtCs(v);
  };
  const totFn=()=>{
    if(team.complete) return fmtCs(team.finalCs);
    if(!started) return '--:--.--';
    return fmtCs(lapNowCs(run,Live.now(),st)+pen);
  };
  const cells=[['run1','사로까지','t0','t1'],['shoot','사격','t1','t2']].concat(ret?[['run2','도착까지','t2','t3']]:[]);
  const curLeg=legOf(run,cur)||{};
  const live=ph==='run1'||ph==='shoot'||ph==='run2';
  return html`<article class=${'vt-lane'+(ph==='shoot'?' is-shoot':'')+(done?' is-done':'')+(rank===1?' is-lead':'')+(flash?' is-press':'')} style=${vestStyle(run.lane)}>
    <header class="vt-top">
      <span class="vt-laneno">${run.lane}<small>사로</small></span>
      <span class=${'vt-rank'+(rank&&rank<=3?' r'+rank:'')}>${rank||'–'}<small>위</small></span>
    </header>
    <div class="vt-team"><${Logo} cls=${c} className="vt-logo"/><b>${className(c)}</b></div>
    <div class="vt-now">
      ${done?html`<div class="vt-who"><span class="vt-ord">${n}명 완주</span><b class="vt-name">최종 기록</b></div>`
        :html`<div class="vt-who"><span class="vt-ord">${cur+1}번 주자</span><b class="vt-name">${p?p.name:'-'}</b></div>`}
      ${live?html`<div class="vt-split">${cells.map(([k,label,a,b])=>html`<span key=${k} class=${'ph-'+k+(ph===k?' on':curLeg[b]!=null?' fin':'')}>
          <small>${label}</small>${curLeg[a]!=null?html`<${LiveText} fn=${()=>{const v=splitCs(run,cur,a,b,Live.now(),st);return v==null?'—':fmtCs(v).replace(/^00:/,'');}}/>`:html`<b>—</b>`}
        </span>`)}</div>`
        :html`<div class=${'vt-phase ph-'+ph}><span>${VT_PHASE[ph]||''}</span></div>`}
      <${LiveText} class="vt-big" fn=${bigFn}/>
    </div>
    <ol class="vt-laps" style=${'--n:'+Math.max(n,1)}>
      ${legs.map((r,i)=>{
        const nm=(playerOf(c,r.playerId)||{}).name||'-';
        const isCur=!done&&i===cur&&r.t0!=null&&!r.complete;
        const fin=r.timed?(ret?r.t3:r.t2):null;
        const just=r.complete&&fin!=null&&t-fin<5000;
        return html`<li key=${i} class=${r.complete?('done'+(just?' just':'')):isCur?'cur':'wait'}>
          <span class="vt-no">${i+1}</span><span class="vt-nm">${nm}</span>
          ${r.complete?html`<span class="vt-tm"><${Tm} v=${fmtCs(r.finalCs)}/>${r.penCs>0?html`<em class="vt-pen">${penShort(r.penCs)}</em>`:null}</span>`
            :isCur?html`<span class="vt-tm"><${LiveText} fn=${()=>{const v=legLiveCs(run,i,Live.now(),st);return v==null?'':fmtCs(v);}}/></span>`
            :html`<span class="vt-tm wait">—</span>`}
        </li>`;
      })}
    </ol>
    <footer class="vt-total"><small>${team.complete?'팀 기록':'누적'}${pen>0?html`<em>페널티 ${penShort(pen)}</em>`:null}</small><${LiveText} fn=${totFn}/></footer>
    ${rec?html`<div class="vt-rec">
      <button id=${'vt-act-'+run.lane} class=${'vt-act act-'+ph+(isFinal?' act-final':'')} disabled=${done||!n}
        onPointerDown=${()=>{pressAt.current=Date.now();}} onClick=${act}>
        <span>${done?'완주':n?venueLabel(run,s):'참가자 없음'}</span>${hotkey&&!done&&n?html`<kbd>${hotkey}</kbd>`:null}
      </button>
      <button class="vt-undo" aria-label=${run.lane+'사로 되돌리기'} title="방금 누른 버튼 되돌리기" disabled=${run.virtual||!started} onClick=${()=>Actions.undo(m.id,run.classId)}><${Icon} n="undo" s=${18}/></button>
    </div>`:null}
  </article>`;
}
function VenueTV({m,list,setMid,onExit}){
  useStore();
  const now=useNow(1000);
  const st=CFG.settings();
  const root=useRef(null);
  const awakeRef=useRef(null);
  useKeepAwake(true,awakeRef);
  const [idle,setIdle]=useState(false);
  // 기록 모드: 이 화면에서 바로 출발·사로 도착·사격 완료·도착을 누른다(터치 · 숫자 키). 기기마다 따로 기억한다.
  const canW=Store.canWrite();
  const [recOn,setRec]=useLocal('ui.venueRec',false);
  const rec=!!recOn&&canW;
  // 보기 전용일 때는 진행 중인 경기를 따라가고, 기록 모드에서는 고른 경기를 그대로 둔다
  const liveM=list.find(x=>x.status==='live');
  const vm=rec?m:((m&&m.status==='live')||!liveM?m:liveM);
  const vmRef=useRef(vm);vmRef.current=vm;
  const recRef=useRef(rec);recRef.current=rec;
  const full=()=>{
    const el=root.current;
    if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    else if(el&&el.requestFullscreen) el.requestFullscreen().catch(()=>toast('전체 화면을 쓸 수 없습니다. 브라우저에서 F11 키를 눌러 주세요.','warn'));
  };
  const exit=()=>{if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});onExit();};
  const exitRef=useRef(exit);exitRef.current=exit;
  useEffect(()=>{
    SD.setPresence({mode:'tv',mid:null});
    const key=e=>{
      const tag=(e.target&&e.target.tagName)||'';
      if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||e.metaKey||e.ctrlKey||e.altKey) return;
      if(e.key==='Escape'&&!document.fullscreenElement) exitRef.current();
      else if(e.key==='f'||e.key==='F') full();
      else if(recRef.current&&!e.repeat&&/^[1-9]$/.test(e.key)){
        // 기록 콘솔과 같은 숫자 키: 해당 사로의 다음 버튼
        const mm=vmRef.current&&Store.doc('matches',vmRef.current.id);
        const run=mm&&runsOfMatch(mm).find(r=>String(r.lane)===e.key);
        if(run){e.preventDefault();Actions.advance(mm.id,run.classId,Live.now());}
      }
    };
    window.addEventListener('keydown',key);
    return()=>{Live.setRole('admin');SD.setPresence({mode:'admin'});window.removeEventListener('keydown',key);};
  },[]);
  // 기록하는 기기는 기준 시계가 되고(다른 TV가 이 시계에 맞춘다), 보기 전용이면 기록 기기 시계를 따른다
  useEffect(()=>{if(rec){Live.setRole('admin');Live.startBeat();}else Live.setRole('tv');},[rec]);
  useEffect(()=>{let tm;const mv=()=>{setIdle(false);clearTimeout(tm);tm=setTimeout(()=>setIdle(true),3000);};mv();window.addEventListener('pointermove',mv);return()=>{clearTimeout(tm);window.removeEventListener('pointermove',mv);};},[]);
  const runs=vm?runsOfMatch(vm):[];
  const table=vm?raceTable(vm):[];
  const rowOf={};table.forEach(r=>{rowOf[r.run.id]=r;});
  const lapFn=()=>{
    const mm=vm&&Store.doc('matches',vm.id);
    const rs=(mm?runsOfMatch(mm):[]).filter(r=>r.startedAt!=null);
    if(!rs.length) return '00:00.00';
    const a=Math.min(...rs.map(r=>r.startedAt)),fin=rs.length===runs.length&&rs.every(r=>r.finishedAt!=null);
    const b=fin?Math.max(...rs.map(r=>r.finishedAt)):Live.now();
    return fmtCs(toCs(Math.max(0,b-a)*(rs[0].scale||1),st.rounding));
  };
  const legsDone=runs.reduce((a,r)=>a+teamResult(r,st).done,0),legsAll=runs.reduce((a,r)=>a+(r.order||[]).length,0);
  const pct=legsAll?Math.round(legsDone/legsAll*100):0;
  const clock=new Date(now);
  const stTxt=!vm?'':vm.status==='done'?'최종 결과':vm.status==='live'?'경기 진행 중':'출발 대기';
  const anyReady=rec&&runs.some(r=>{const x=runState(r);return x.cur===0&&x.phase==='ready'&&(r.order||[]).length;});
  const startedN=runs.filter(r=>r.startedAt!=null).length;
  return html`<div class=${'tv lr lr-tv tint lr-red lr-tv-full lr-venue'+(idle?' hidecursor':'')} style=${LR_TV_TINT} ref=${root}>
    <${SUI.Waves}/>
    <video class="keepawake" ref=${awakeRef} loop playsInline preload="auto" aria-hidden="true" tabIndex="-1"><source src="media/keepawake.webm" type="video/webm"/><source src="media/keepawake.mp4" type="video/mp4"/></video>
    <div class="tv-head">
      <${SUI.Logo} size=${86}/>
      <div class="league"><b>${st.eventName}</b><span>레이저런 · 현장 기록판</span></div>
      ${vm&&vm.sample?html`<span class="ltv-sample">예시 데이터</span>`:null}
      ${anyReady?html`<button id="vt-start" class="vt-start" onClick=${()=>Actions.startMatch(vm.id)}><${Icon} n="play" s=${22}/>${startedN?'남은 학급 출발':'경기 시작'}</button>`:null}
      <div class="ttl"><b>${vm?vm.title:'경기 없음'}</b><span>${stTxt}${vm?' · '+(vm.date?fmtDateKo(vm.date,false)+' ':'')+effectiveTimeStr(vm):''}</span></div>
      ${vm?html`<div class="ltv-lap"><small>전체 랩타임</small><${LiveText} fn=${lapFn}/></div>`:null}
      <div class="clock">${pad2(clock.getHours())}:${pad2(clock.getMinutes())}<small>${SD.fmtDate(todayStr())}</small></div>
    </div>
    <div class="tv-prog"><i class="ltv-prog-fill" style=${'width:'+pct+'%'}></i></div>
    <div class="tv-stage">
      ${runs.length?html`<div class="vt-grid" style=${'--cols:'+runs.length}>
        ${runs.map(run=>html`<${VenueLane} key=${run.id} m=${vm} run=${run} row=${rowOf[run.id]} st=${st} rec=${rec} hotkey=${run.lane<=9?String(run.lane):null}/>`)}
      </div>`:html`<div class="tv-empty"><span><b>참가 학급이 없습니다</b>경기 일정에서 조를 골라 경기를 만들면 사로별 카드가 나타납니다.</span></div>`}
    </div>
    <div class="tv-foot">
      ${canW?html`<button id="vt-rec" class=${'vt-mode'+(rec?' on':'')} aria-pressed=${String(rec)} onClick=${()=>setRec(!rec)}>${rec?'기록 모드 켜짐':'보기 전용 · 기록 모드 켜기'}</button>`:null}
      ${rec?html`<span class="vt-hint">카드 아래 버튼을 누르거나 숫자 키 1~${Math.max(1,...runs.map(r=>r.lane||0))} · 기록원 ${LR.recorder()||'미지정'}</span>`
        :html`<span class="live">실시간 · 기록원이 버튼을 누르면 바로 바뀝니다</span>`}
      ${rec&&liveM&&vm&&liveM.id!==vm.id?html`<button class="vt-golive" onClick=${()=>setMid(liveM.id)}>지금 ${liveM.title} 진행 중 · 이동</button>`:null}
      <div class="ctl">
        ${list.length>1?html`<select class="vt-pick" aria-label="경기 선택" value=${vm&&vm.id} onChange=${e=>setMid(e.target.value)}>
          ${list.map(x=>html`<option key=${x.id} value=${x.id}>[${(STATUS[x.status]||STATUS.tbd).t}] ${x.title}${x.sample?' (예시)':''}</option>`)}
        </select>`:null}
        <button id="vt-full" onClick=${full}>전체 화면</button><button id="vt-exit" onClick=${exit}>나가기</button>
      </div>
    </div>
  </div>`;
}

/* ==========================================================================
   SNS — 풋살 SNS와 같은 1080×1920 스토리 이미지 · 주간 리캡 영상
   풋살의 그리는 도구(SNS.K)만 빌려 쓰고, 풋살 sns.js·recap.js 파일은 고치지 않는다.
   파일 이름은 SDSLR_ 로 시작한다.
   ========================================================================== */
const K=window.SNS.K;
const LR_FOOT='#성덕레이저런  ·  SDSMP';
const LR_THEME={results:'violet',schedule:'ember',recap:'navy'};
CFG.sns=memoV(()=>Store.doc('config','sns')||{});
const RANK_C={1:'#FFD34D',2:'#E8ECF4',3:'#F2AE7E'};
const LR_KO='경기 결과 일정 남학생 여학생 전체 예시 데이터 페널티 위 주자 사로 시간 미정 월 일 요일 화 수 목 금 토 주차 리캡 학년 반 순위 팀 기록 사격 주행 최종 이번 주 최고 완주 미완주 다음 없습니다 명 합계 누적 0123456789 · – + …:.';
const LR_EN='SEONGDEOK LASER RUN LEAGUE FINISH RESULTS RACE DAY NEXT TOP 10 FASTEST RUNNER WEEK OF THE BEST CLASS STANDINGS RECORD VS ALL MEN WOMEN 0123456789:+-–.,';
async function lrAssets(keys,text){
  const img={};
  const [brand]=await Promise.all([K.loadImg('logos/brand.webp'),...[...new Set(keys)].filter(Boolean).map(async c=>{const u=SD.logoUrl(c);img[c]=u?await K.loadImg(u):null;})]);
  const F=K.FONT,EN=LR_EN+K.MON.join(' '),KO=LR_KO+' '+(text||'');
  try{
    await Promise.all([
      document.fonts.load('italic 900 100px '+F.title,EN),document.fonts.load('800 100px '+F.title,EN),
      document.fonts.load('700 60px '+F.en,EN),document.fonts.load('600 30px '+F.en,EN),document.fonts.load('500 20px '+F.en,EN),
      document.fonts.load('700 38px '+F.ko,KO),document.fonts.load('600 28px '+F.ko,KO),document.fonts.load('500 24px '+F.ko,KO)
    ]);
  }catch(e){}
  return {img,brand};
}
function sampleMark(ctx,on){
  if(!on) return;
  ctx.save();
  K.rrect(ctx,850,232,158,46,10);ctx.fillStyle='#FFC93F';ctx.fill();
  ctx.fillStyle='#3E2A00';K.setFont(ctx,700,24,K.FONT.ko);ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('예시 데이터',929,256);
  ctx.restore();ctx.textBaseline='alphabetic';
}
function lrHead(ctx,A,st,head,line){
  const P=st.P;
  K.emblem(ctx,A,P,st.en);
  ctx.textAlign='center';ctx.fillStyle=K.WHITE;K.setFont(ctx,700,36,K.FONT.ko);K.spaced(ctx,st.kr,K.W/2,466,2);
  K.title(ctx,P,head,668,196,900);
  K.sub(ctx,line,734,P.light,32);
}
function classRows(ctx,A,rows,top,bottom){
  const n=rows.length,rowH=Math.min(150,Math.floor((bottom-top)/Math.max(1,n)));
  const y0=top+Math.max(0,Math.floor((bottom-top-rowH*n)/2));
  rows.forEach((r,i)=>{
    const y=y0+i*rowH,cy=y+rowH/2;
    if(i) K.hline(ctx,120,960,y,.1);
    ctx.textBaseline='middle';
    ctx.textAlign='center';K.setFont(ctx,800,Math.min(72,Math.round(rowH*.56)),K.FONT.title);ctx.fillStyle=RANK_C[r.rank]||K.DIM;ctx.fillText(r.rank==null?'–':String(r.rank),170,cy+2);
    K.crest(ctx,A.img[r.key],r.key,272,cy,Math.min(104,rowH-22));
    ctx.textAlign='left';ctx.fillStyle=K.WHITE;K.fitFont(ctx,r.label,290,700,40,K.FONT.ko,24);ctx.fillText(r.label,344,cy+2);
    ctx.textAlign='right';K.setFont(ctx,700,Math.min(62,Math.round(rowH*.46)),K.FONT.en);ctx.fillStyle=r.rank===1?RANK_C[1]:K.WHITE;
    ctx.fillText(r.time||(r.done+'/'+r.n+'명'),948,cy+(r.pen?-12:2));
    if(r.pen){K.setFont(ctx,600,23,K.FONT.ko);ctx.fillStyle='#FF9AA2';ctx.fillText('페널티 '+fmtPen(r.pen),948,cy+36);}
    ctx.textBaseline='alphabetic';
  });
}
function drawFinish(ctx,st,A){
  K.scene(ctx,st.P,true);K.frame(ctx);
  lrHead(ctx,A,st,'FINISH',K.md(st.date)+' '+K.wd(st.date)+' · '+st.mTitle);
  classRows(ctx,A,st.rows,774,st.best?1448:1606);
  if(st.best) K.honour(ctx,st.P,1468,'FASTEST RUNNER',st.best.name+'  '+st.best.time,st.best.cls);
  K.footer(ctx,st.footer);sampleMark(ctx,st.sample);
}
function drawResults(ctx,st,A){
  K.scene(ctx,st.P,true);K.frame(ctx);
  lrHead(ctx,A,st,'RESULTS',K.md(st.date)+' '+K.wd(st.date)+' · '+st.label+' 경기 결과'+(st.pages>1?' '+st.page+'/'+st.pages:''));
  const top=774,bottom=1606,n=st.list.length,rowH=Math.min(196,Math.floor((bottom-top)/Math.max(1,n)));
  const y0=top+Math.max(0,Math.floor((bottom-top-rowH*n)/2));
  st.list.forEach((m,i)=>{
    const y=y0+i*rowH,cy=y+rowH/2+14;
    if(i) K.hline(ctx,120,960,y,.1);
    const w=m.rows[0];
    const finished=!!(w&&w.time);
    ctx.textAlign='center';ctx.fillStyle=st.P.light;K.setFont(ctx,600,25,K.FONT.ko);ctx.fillText(m.title+(finished?' · 1위':''),K.W/2,y+38);
    if(!finished){
      ctx.textBaseline='middle';ctx.fillStyle=K.DIM;K.setFont(ctx,600,34,K.FONT.ko);ctx.fillText('완주한 학급이 없습니다',K.W/2,cy+4);ctx.textBaseline='alphabetic';
      return;
    }
    K.crest(ctx,A.img[w.key],w.key,172,cy,Math.min(104,rowH-72));
    ctx.textBaseline='middle';
    ctx.textAlign='left';ctx.fillStyle=K.WHITE;K.fitFont(ctx,w.label,300,700,38,K.FONT.ko,24);ctx.fillText(w.label,244,cy+2);
    ctx.textAlign='right';K.setFont(ctx,700,68,K.FONT.en);ctx.fillStyle=RANK_C[1];ctx.fillText(w.time,948,cy+4);
    ctx.textBaseline='alphabetic';
  });
  K.footer(ctx,st.footer);sampleMark(ctx,st.sample);
}
function drawTop(ctx,st,A){
  K.scene(ctx,st.P,true);K.frame(ctx);
  lrHead(ctx,A,st,'TOP 10',st.line);
  const top=768,bottom=1612,n=Math.max(1,st.rows.length),rowH=Math.min(86,Math.floor((bottom-top)/n));
  st.rows.forEach((r,i)=>{
    const y=top+i*rowH,cy=y+rowH/2;
    if(i) K.hline(ctx,104,976,y,.09);
    ctx.textBaseline='middle';
    ctx.textAlign='center';K.setFont(ctx,800,44,K.FONT.title);ctx.fillStyle=RANK_C[r.rank]||K.DIM;ctx.fillText(String(r.rank),146,cy+2);
    K.crest(ctx,A.img[r.key],r.key,226,cy,rowH-16);
    ctx.textAlign='left';ctx.fillStyle=K.WHITE;K.fitFont(ctx,r.name,240,700,36,K.FONT.ko,22);ctx.fillText(r.name,282,cy+1);
    const nw=ctx.measureText(r.name).width;
    K.setFont(ctx,500,24,K.FONT.ko);ctx.fillStyle=K.DIM;ctx.fillText(r.cls,282+nw+14,cy+3);
    ctx.textAlign='right';K.setFont(ctx,700,46,K.FONT.en);ctx.fillStyle=r.rank===1?RANK_C[1]:K.WHITE;ctx.fillText(r.time,960,cy+3);
    ctx.textBaseline='alphabetic';
  });
  K.footer(ctx,st.footer);sampleMark(ctx,st.sample);
}
function drawRaceDay(ctx,st,A){
  K.scene(ctx,st.P,false);K.frame(ctx);
  lrHead(ctx,A,st,'RACE DAY',K.md(st.date)+' '+K.wd(st.date)+' · '+st.label+' '+st.total+'경기'+(st.pages>1?' ('+st.page+'/'+st.pages+')':''));
  const top=774,bottom=1606,n=st.list.length,rowH=Math.min(196,Math.floor((bottom-top)/Math.max(1,n)));
  const y0=top+Math.max(0,Math.floor((bottom-top-rowH*n)/2));
  st.list.forEach((m,i)=>{
    const y=y0+i*rowH,cy=y+rowH/2;
    if(i) K.hline(ctx,120,960,y,.1);
    ctx.textBaseline='middle';
    ctx.textAlign='left';K.setFont(ctx,700,64,K.FONT.en);ctx.fillStyle=K.WHITE;ctx.fillText(m.time,120,cy-16);
    ctx.fillStyle=st.P.light;K.fitFont(ctx,m.title,260,600,28,K.FONT.ko,20);ctx.fillText(m.title,120,cy+38);
    const cs=Math.min(96,rowH-44,Math.floor(560/Math.max(1,m.keys.length)));
    m.keys.forEach((c,j)=>{K.crest(ctx,A.img[c],c,960-cs/2-(m.keys.length-1-j)*(cs+6),cy,cs);});
    ctx.textBaseline='alphabetic';
  });
  K.footer(ctx,st.footer);sampleMark(ctx,st.sample);
}
function drawNextRace(ctx,st,A){
  const P=st.P,n=st.keys.length,per=n<=3?n:3,cs=n<=2?240:n<=3?200:150,gap=cs+40;
  K.scene(ctx,P,false);K.frame(ctx);K.emblem(ctx,A,P,st.en);
  K.sub(ctx,st.mTitle,458,P.light,28);
  st.keys.forEach((c,i)=>{
    const row=Math.floor(i/per),col=i%per,count=Math.min(per,n-row*per);
    K.crest(ctx,A.img[c],c,K.W/2+(col-(count-1)/2)*gap,(n>3?590:650)+row*(cs+22),cs);
  });
  K.title(ctx,P,'NEXT',994,238,900);
  K.title(ctx,P,'RACE',1186,238,900);
  ctx.textAlign='center';ctx.fillStyle=K.WHITE;K.fitFont(ctx,st.teams,900,700,38,K.FONT.ko,24);ctx.fillText(st.teams,K.W/2,1270);
  K.pills(ctx,P,[['날짜',K.md(st.date)],['시간',st.time]],1370);
  K.footer(ctx,st.footer);sampleMark(ctx,st.sample);
}
const LR_DRAW={finish:drawFinish,results:drawResults,top:drawTop,raceday:drawRaceDay,next:drawNextRace};
async function lrRender(st){
  const A=await lrAssets(st.keysAll||[],st.text||'');
  const c=document.createElement('canvas');c.width=K.W;c.height=K.H;
  const ctx=c.getContext('2d');ctx.textBaseline='alphabetic';
  LR_DRAW[st.kind](ctx,st,A);
  return c;
}
/* ---------- 이미지 자료 ---------- */
function matchRows(m){
  return raceTable(m).map(r=>{
    const c=Store.doc('classes',r.run.classId);
    return {rank:r.team.complete?r.rank:null,key:logoKey(c),label:className(c),time:r.team.complete?fmtCs(r.team.finalCs):null,pen:r.team.penCs,done:r.team.done,n:r.team.n};
  });
}
const matchKeys=m=>(m.classIds||[]).map(id=>logoKey(Store.doc('classes',id))).filter(Boolean);
function LrStoryCard({st,guides,onShot,onOpen}){
  const [shot,setShot]=useState(null);
  useEffect(()=>{
    let live=true;
    lrRender(st).then(c=>{
      if(!live) return;
      let url;
      try{url=c.toDataURL('image/jpeg',.92);}catch(e){url='err';}
      const s={url,canvas:c};
      setShot(s);onShot(st.key,s);
    });
    return()=>{live=false;};
  },[st.sig]);
  const ok=shot&&shot.url!=='err';
  return html`<figure class="story">
    <button type="button" class="story-frame" aria-label=${st.title+' 크게 보기'} disabled=${!ok} onClick=${onOpen}>
      ${ok?html`<img src=${shot.url} alt=${st.alt}/>`:html`<div class="story-wait">${shot?'이미지를 만들지 못했습니다':'그리는 중…'}</div>`}
      ${guides?html`<i class="safe t"></i><i class="safe b"></i>`:null}
      ${ok?html`<span class="story-zoom" aria-hidden="true"><${SUI.Icon} n="search" size=${16}/></span>`:null}</button>
    <figcaption><b>${st.title}</b><span>${st.sub}</span><${K.SaveBtn} shot=${shot} file=${st.file}/></figcaption>
  </figure>`;
}
function LaserSnsPage(){
  useStore();
  const can=Store.canWrite();
  const today=todayStr();
  const [mode,setMode]=useLocal('ui.snsMode','results');
  const lastDone=()=>{
    const d=scopedMatches().filter(m=>m.status==='done'&&m.date).map(m=>m.date).sort();
    return d.includes(today)||!d.length?today:d[d.length-1];
  };
  const [date,setDate]=useState(()=>mode==='schedule'?today:lastDone());
  const [guides,setGuides]=useState(true);
  const [zoom,setZoom]=useState(-1);
  const [,setTick]=useState(0);
  const shots=useRef({});
  const cfg=CFG.sns(),st=CFG.settings();
  const footerText=cfg.footer==null?LR_FOOT:cfg.footer;
  const [foot,setFoot]=useState(footerText);
  const [localTheme,setLocalTheme]=useState({});
  const theme=localTheme[mode]||(cfg.theme&&cfg.theme[mode])||LR_THEME[mode];
  const P=K.PAL[theme]||K.PAL[LR_THEME[mode]];
  const pickTheme=v=>{setLocalTheme({...localTheme,[mode]:v});if(can)Actions.saveConfig('sns',{theme:{[mode]:v}});};
  const switchMode=v=>{setMode(v);setZoom(-1);setDate(v==='schedule'?today:lastDone());};
  const modeSeg=html`<${SUI.Seg} label="종류" value=${mode} onChange=${switchMode} options=${[{value:'results',label:'경기 결과'},{value:'schedule',label:'경기 일정'},{value:'recap',label:'주간 리캡'}]}/>`;
  const saveFoot=()=>{Actions.saveConfig('sns',{footer:foot.trim()});toast('하단 문구를 저장했습니다.');};
  const look=html`
    <div class="field"><span>색상</span><div class="swatches" role="group" aria-label="색상">${K.THEMES.map(t=>html`
      <button type="button" class=${'swatch '+t} aria-pressed=${String(theme===t)} onClick=${()=>pickTheme(t)}><i></i>${K.PAL[t].label}</button>`)}</div></div>
    <label class="field sns-foot"><span>이미지 하단 문구</span><div class="row"><input id="sns-footer" class="input" style="flex:1;min-width:160px" value=${foot} disabled=${!can} onInput=${e=>setFoot(e.target.value)} placeholder="예: @seongdeok_league"/>
      ${can?html`<button type="button" class="btn btn-sm" onClick=${saveFoot}>저장</button>`:null}</div></label>
    <label class="switch"><input type="checkbox" checked=${guides} onChange=${e=>setGuides(e.target.checked)}/><span>${mode==='recap'?'9:14 안전 영역 표시':'가려지는 영역 표시'}</span></label>`;
  if(mode==='recap') return html`<div>
    <${PAGES.PageHead} eyebrow="Weekly recap" title="SNS" desc="한 주의 레이저런 경기를 9:16 스토리로 정리합니다. 장면마다 켜기·끄기, 시간, 순서를 바꾸고 미리보기로 움직임을 확인한 뒤 이미지나 영상으로 저장하세요.">${modeSeg}<//>
    <div class="sns-bar">${look}</div>
    <${LaserRecapPanel} can=${can} P=${P} theme=${theme} footerText=${footerText} guides=${guides}/>
  </div>`;
  const label=date===SD.addDays(today,1)?'내일':date===today?'오늘':K.md(date);
  const stamp=date.replace(/-/g,'');
  const base={P,theme,footer:footerText,en:st.eventName,kr:st.eventKr,date};
  const stories=[];
  const dayAll=scopedMatches().filter(m=>m.date===date);
  const add=o=>stories.push({...base,...o,sig:JSON.stringify([theme,footerText,st.eventName,st.eventKr,o.kind,o.page,o.rows,o.list,o.best,o.time,o.teams,o.line,o.keys,date])});
  if(mode==='results'){
    const done=dayAll.filter(m=>m.status==='done');
    const all=done.map(m=>({title:m.title,rows:matchRows(m),keys:matchKeys(m),sample:m.sample}));
    const pages=K.chunk(all,5);
    if(done.length) pages.forEach((list,i)=>add({key:'r'+i,kind:'results',list,label,page:i+1,pages:pages.length,sample:list.some(x=>x.sample),keysAll:list.flatMap(x=>x.keys),text:list.map(x=>x.title+' '+x.rows.map(r=>r.label).join(' ')).join(' '),
      title:label+' 경기 결과',sub:list.length+'경기'+(pages.length>1?' · '+(i+1)+'/'+pages.length:''),alt:K.md(date)+' 경기 결과',file:'SDSLR_'+stamp+'_결과'+(pages.length>1?'_'+(i+1):'')+'.jpg'}));
    done.forEach((m,i)=>{
      const rows=matchRows(m),rec=rankRecords(allRecords().filter(r=>r.matchId===m.id),false)[0];
      const best=rec?{name:rec.name,time:fmtCs(rec.finalCs),cls:className(rec.cls)}:null;
      add({key:'f'+m.id,kind:'finish',mTitle:m.title,rows,best,sample:m.sample,keysAll:matchKeys(m),text:m.title+' '+rows.map(r=>r.label).join(' ')+' '+(best?best.name+' '+best.cls:''),
        title:m.title+' FINISH',sub:(rows[0]&&rows[0].time?rows[0].label+' 1위':'경기 결과'),alt:'FINISH',file:'SDSLR_'+stamp+'_FINISH_'+(i+1)+'.jpg'});
    });
const classBoard=boardData().class.slice(0,10);
if(classBoard.length){
  const rows=classBoard.map(r=>({rank:r.rank,key:r.key,name:r.name,cls:'',time:r.time}));
  add({key:'tclass',kind:'top',line:'학급 종합 순위',rows,sample:classBoard.some(r=>r.sample),keysAll:rows.map(r=>r.key),text:'학급 종합 순위 '+rows.map(r=>r.name).join(' '),title:'TOP 10 · 학급 순위',sub:rows.length+'개 반',alt:'TOP 10',file:'SDSLR_'+stamp+'_TOP10_학급.jpg'});
}
const recs=scopedRecords();
[['all','전체 개인 기록',recs],['M','남학생 개인 기록',recs.filter(r=>r.gender==='M')],['F','여학생 개인 기록',recs.filter(r=>r.gender==='F')]].forEach(([k,line,list])=>{
      const rows=rankRecords(list).slice(0,10).map(r=>({rank:r.rank,key:logoKey(r.cls),name:r.name,cls:classShort(r.cls),time:fmtCs(r.finalCs)}));
      if(rows.length) add({key:'t'+k,kind:'top',line,rows,sample:list.some(r=>r.sample),keysAll:rows.map(r=>r.key),text:line+' '+rows.map(r=>r.name+' '+r.cls).join(' '),title:'TOP 10 · '+line,sub:rows.length+'명',alt:'TOP 10',file:'SDSLR_'+stamp+'_TOP10_'+k+'.jpg'});
    });
  }else{
    const list=dayAll.map(m=>({title:m.title,time:effectiveTimeStr(m).replace('시간 미정','--:--'),keys:matchKeys(m),sample:m.sample}));
    const pages=K.chunk(list,5);
    if(list.length) pages.forEach((p,i)=>add({key:'s'+i,kind:'raceday',list:p,label,total:list.length,page:i+1,pages:pages.length,sample:p.some(x=>x.sample),keysAll:p.flatMap(x=>x.keys),text:p.map(x=>x.title).join(' '),
      title:label+' 경기 일정',sub:p.length+'경기'+(pages.length>1?' · '+(i+1)+'/'+pages.length:''),alt:K.md(date)+' 경기 일정',file:'SDSLR_'+stamp+'_일정'+(pages.length>1?'_'+(i+1):'')+'.jpg'}));
    dayAll.filter(m=>m.status!=='done').forEach((m,i)=>{
      const keys=matchKeys(m),time=effectiveTimeStr(m).replace('시간 미정','--:--');
      add({key:'n'+m.id,kind:'next',mTitle:m.title,keys,keysAll:keys,time,teams:teamLabel(m),sample:m.sample,text:m.title+' '+teamLabel(m)+' 날짜 시간',title:time+' '+m.title,sub:teamLabel(m),alt:'NEXT RACE',file:'SDSLR_'+stamp+'_NEXT_'+(i+1)+'.jpg'});
    });
  }
  const onShot=(k,s)=>{shots.current[k]=s;setTick(t=>t+1);};
  return html`<div>
    <${PAGES.PageHead} eyebrow="Instagram story" title="SNS" desc="인스타그램 스토리(1080×1920)용 이미지를 레이저런 기록으로 바로 만듭니다. 이미지를 누르면 크게 볼 수 있고, 빗금 친 위·아래는 인스타 화면 막대에 가려질 수 있는 부분입니다.">${modeSeg}<//>
    <div class="sns-bar">
      <label class="field"><span>날짜</span><div class="row">
        <button type="button" class="icon-btn" aria-label="하루 전" onClick=${()=>setDate(SD.addDays(date,-1))}><${SUI.Icon} n="back"/></button>
        <input id="sns-date" type="date" class="input" value=${date} onInput=${e=>e.target.value&&setDate(e.target.value)}/>
        <button type="button" class="icon-btn" aria-label="하루 뒤" onClick=${()=>setDate(SD.addDays(date,1))}><${SUI.Icon} n="chev"/></button>
        <button type="button" class="btn btn-sm" onClick=${()=>setDate(today)}>오늘</button></div></label>
      ${look}
    </div>
    ${stories.length?html`<div class="story-grid">${stories.map((s,i)=>html`<${LrStoryCard} key=${s.key} st=${s} guides=${guides} onShot=${onShot} onOpen=${()=>setZoom(i)}/>`)}</div>`
      :html`<section class="panel"><${SUI.Empty} title=${mode==='results'?K.md(date)+'에 끝난 경기가 없습니다':K.md(date)+'에 등록된 경기가 없습니다'}>${mode==='results'?'경기를 종료 처리하면 결과 이미지가 만들어집니다.':'경기 일정에서 이 날짜에 경기를 등록해 주세요.'}<//></section>`}
    ${zoom>=0&&zoom<stories.length?html`<${K.Lightbox} stories=${stories} idx=${zoom} shots=${shots.current} onIdx=${setZoom} onClose=${()=>setZoom(-1)} guides=${guides}/>`:null}
  </div>`;
}

/* ==========================================================================
   주간 리캡 — 표지 · 이번 주 결과 · 최고 기록 · 학급 순위 · 개인 TOP 10 · 다음 경기
   각 장면은 시간의 함수로 캔버스에 그려 미리보기, 이미지, MP4를 같은 코드로 만든다.
   ========================================================================== */
const RW=K.W,RH=K.H,TITLE_Y=580,SUB_Y=636,CT=680,CB=1606,X0=84,XW=RW-168;
const TINT={1:'242,183,5',2:'200,210,228',3:'214,138,90'};
const c01=(v,a=0,b=1)=>v<a?a:v>b?b:v;
const eOut=t=>1-Math.pow(1-t,3);
const eBack=t=>{const c=1.8;return 1+(c+1)*Math.pow(t-1,3)+c*Math.pow(t-1,2);};
function bezierEase(x1,y1,x2,y2){
  const cx=3*x1,bx=3*(x2-x1)-cx,ax=1-cx-bx,cy=3*y1,by=3*(y2-y1)-cy,ay=1-cy-by;
  const fx=t=>((ax*t+bx)*t+cx)*t,fy=t=>((ay*t+by)*t+cy)*t,dx=t=>(3*ax*t+2*bx)*t+cx;
  return x=>{
    if(x<=0) return 0;
    if(x>=1) return 1;
    let t=x;
    for(let i=0;i<8;i++){const d=fx(t)-x;if(Math.abs(d)<1e-5)break;const s=dx(t);if(Math.abs(s)<1e-6)break;t-=d/s;}
    return fy(c01(t));
  };
}
const EF=bezierEase(.16,.84,.24,1);
const LANDED={x:0,sk:0,a:1};
function fly(tt,i,d0=.3,gap=.13,dur=.85){
  const p=c01((tt-d0-i*gap)/dur);
  if(p>=1) return LANDED;
  let x,sk;
  if(p<.78){const e=EF(p/.78);x=1.15+(-.016-1.15)*e;sk=-16+19*e;}
  else{const e=EF((p-.78)/.22);x=-.016*(1-e);sk=3*(1-e);}
  return {x,sk:sk*Math.PI/180,a:p<.55?EF(p/.55):1};
}
function inFly(ctx,f,x,y,w,h,fn){
  if(f.a<=.001) return;
  ctx.save();ctx.globalAlpha*=f.a;
  if(f!==LANDED){const cx=x+w/2,cy=y+h/2;ctx.translate(cx+f.x*w,cy);if(f.sk)ctx.transform(1,0,Math.tan(f.sk),1,0,0);ctx.translate(-cx,-cy);}
  fn();ctx.restore();
}
function glint(ctx,tt,t0,x,y,w,h,r){
  const p=(tt-t0)/.9;
  if(p<=0||p>=1) return;
  const gx=x-w*.3+w*1.5*eOut(p);
  ctx.save();K.rrect(ctx,x,y,w,h,r);ctx.clip();
  const g=ctx.createLinearGradient(gx-140,y,gx+140,y+h*.35);
  g.addColorStop(0,'rgba(255,255,255,0)');g.addColorStop(.5,'rgba(255,255,255,0.2)');g.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=g;ctx.fillRect(x,y,w,h);ctx.restore();
}
const fadeIn=(ctx,a,fn)=>{if(a<=.001)return;ctx.save();ctx.globalAlpha*=a;fn();ctx.restore();};
function rcCard(ctx,x,y,w,h,r,tint){
  K.rrect(ctx,x,y,w,h,r);
  const g=ctx.createLinearGradient(x,y,x+w,y);
  if(tint){g.addColorStop(0,`rgba(${tint},0.32)`);g.addColorStop(.5,`rgba(${tint},0.11)`);g.addColorStop(1,`rgba(${tint},0.05)`);}
  else{g.addColorStop(0,'rgba(255,255,255,0.085)');g.addColorStop(1,'rgba(255,255,255,0.03)');}
  ctx.fillStyle=g;ctx.fill();
  ctx.strokeStyle=tint?`rgba(${tint},0.5)`:'rgba(255,255,255,0.12)';ctx.lineWidth=2;ctx.stroke();
}
const bgCache=new Map();
function cachedCanvas(key,make){
  let c=bgCache.get(key);
  if(c) return c;
  c=document.createElement('canvas');c.width=RW;c.height=RH;make(c.getContext('2d'));
  bgCache.set(key,c);
  if(bgCache.size>6) bgCache.delete(bgCache.keys().next().value);
  return c;
}
function pageBg(X,A){
  return cachedCanvas(['p',X.theme,X.wkLine,X.foot,X.en,A.brand?1:0].join('|'),ctx=>{
    K.scene(ctx,X.P,false);K.frame(ctx);K.emblem(ctx,A,X.P,X.en);
    ctx.textAlign='center';ctx.fillStyle=X.P.light;K.setFont(ctx,600,25,K.FONT.en);K.spaced(ctx,X.wkLine,RW/2,452,5);
    if(X.foot){ctx.fillStyle=K.FAINT;K.fitFont(ctx,X.foot,900,500,24,K.FONT.ko,16);ctx.fillText(X.foot,RW/2,1664);}
    sampleMark(ctx,X.sample);
  });
}
function coverBg(X,A){
  return cachedCanvas(['c',X.theme,A.brand?1:0,X.sample?1:0].join('|'),ctx=>{
    const P=X.P;
    K.scene(ctx,P,false);
    ctx.save();ctx.globalCompositeOperation='lighter';
    [[-.34,.15],[0,.11],[.34,.15]].forEach(([k,a])=>{
      const g=ctx.createLinearGradient(0,0,0,1500);g.addColorStop(0,`rgba(${P.silk[2]},${a})`);g.addColorStop(1,`rgba(${P.silk[2]},0)`);
      ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(RW/2+k*300-40,-20);ctx.lineTo(RW/2+k*300+40,-20);ctx.lineTo(RW/2+k*1500+260,1500);ctx.lineTo(RW/2+k*1500-260,1500);ctx.closePath();ctx.fill();
    });
    ctx.restore();
    ctx.save();ctx.translate(RW/2,930);ctx.scale(1,.6);
    const pl=ctx.createRadialGradient(0,0,80,0,0,660);
    pl.addColorStop(0,'rgba(0,0,0,0.58)');pl.addColorStop(.55,'rgba(0,0,0,0.4)');pl.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=pl;ctx.fillRect(-RW,-1200,2*RW,2400);ctx.restore();
    const v=ctx.createRadialGradient(RW/2,1000,280,RW/2,1000,1150);v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,0,0,0.62)');
    ctx.fillStyle=v;ctx.fillRect(0,0,RW,RH);
    ctx.save();ctx.translate(0,152);K.emblem(ctx,A,P,'');ctx.restore();
    sampleMark(ctx,X.sample);
  });
}
const CY={year:610,sf:688,ch:862,lg:1024,rule:1076,wk:1230,date:1338,ko:1392,foot:1664};
function bigWord(ctx,P,text,y,px,T,t0,dir){
  const p=c01((T-t0)/.9);
  if(p<=0) return;
  const e=EF(p);
  ctx.save();ctx.globalAlpha*=c01(p/.35);
  ctx.translate((1-e)*560*dir,0);
  if(p<1){ctx.translate(RW/2,y);ctx.transform(1,0,Math.tan((1-e)*.3*-dir),1,0,0);ctx.translate(-RW/2,-y);}
  K.setFont(ctx,'italic 900',px,K.FONT.title);ctx.textAlign='center';
  const g=ctx.createLinearGradient(0,y-px*.74,0,y+px*.04);
  g.addColorStop(0,'#FFFFFF');g.addColorStop(.5,P.light);g.addColorStop(1,P.titleTop);
  ctx.shadowColor=`rgba(${P.glow[0]},0.8)`;ctx.shadowBlur=36;
  ctx.fillStyle=g;ctx.fillText(text,RW/2,y);
  ctx.shadowBlur=0;ctx.lineWidth=1.5;ctx.strokeStyle='rgba(255,255,255,0.35)';ctx.strokeText(text,RW/2,y);
  ctx.restore();
}
function drawCover(ctx,X,s,tt,A,still){
  const P=X.P,T=still?60:tt;
  const ex=still?0:c01((tt-(s.sec-.45))/.45);
  ctx.save();ctx.globalAlpha*=1-ex;
  const z=still?1:1.045-.045*eOut(c01(T/Math.max(1,s.sec-.4)));
  ctx.translate(RW/2,1000);ctx.scale(z,z);ctx.translate(-RW/2,-1000);
  ctx.textAlign='center';
  const a1=eOut(c01((T-.1)/.9));
  fadeIn(ctx,a1,()=>{
    ctx.fillStyle=P.light;K.setFont(ctx,600,28,K.FONT.en);K.spaced(ctx,X.year,RW/2,CY.year,16+(1-a1)*24);
    ctx.fillStyle=K.WHITE;K.setFont(ctx,600,54,K.FONT.en);K.spaced(ctx,'SEONGDEOK',RW/2,CY.sf,12+(1-a1)*34);
  });
  const px=K.fitFont(ctx,'LASER RUN',940,'italic 900',190,K.FONT.title,80);
  bigWord(ctx,P,'LASER',CY.ch,px,T,.35,-1);
  bigWord(ctx,P,'RUN',CY.lg,px,T,.5,1);
  const a3=eOut(c01((T-.9)/.6));
  if(a3>0){
    ctx.save();ctx.globalAlpha*=a3;ctx.shadowColor=`rgba(${P.line},0.9)`;ctx.shadowBlur=14;
    const half=380*a3,g=ctx.createLinearGradient(RW/2-half,0,RW/2+half,0);
    g.addColorStop(0,`rgba(${P.line},0)`);g.addColorStop(.5,`rgba(${P.line},1)`);g.addColorStop(1,`rgba(${P.line},0)`);
    ctx.fillStyle=g;ctx.fillRect(RW/2-half,CY.rule-1.5,half*2,3);
    ctx.fillStyle=K.WHITE;ctx.beginPath();ctx.moveTo(RW/2,CY.rule-9);ctx.lineTo(RW/2+9,CY.rule);ctx.lineTo(RW/2,CY.rule+9);ctx.lineTo(RW/2-9,CY.rule);ctx.closePath();ctx.fill();
    ctx.restore();
  }
  const p=still?1:c01((T-1.1)/.62);
  if(p>0){
    const wpx=K.fitFont(ctx,X.label,820,'italic 900',138,K.FONT.title,56);
    const cy=CY.wk-wpx*.36,sc=1+1.1*(1-eBack(p));
    ctx.save();ctx.globalAlpha*=c01(p/.22);
    ctx.translate(RW/2,cy);ctx.scale(sc,sc);ctx.translate(-RW/2,-cy);
    const g=ctx.createLinearGradient(0,CY.wk-wpx*.74,0,CY.wk+wpx*.04);
    g.addColorStop(0,'#FFFFFF');g.addColorStop(.5,P.light);g.addColorStop(1,P.titleTop);
    ctx.textAlign='center';ctx.shadowColor=`rgba(${P.glow[0]},0.85)`;ctx.shadowBlur=40;ctx.fillStyle=g;
    ctx.fillText(X.label,RW/2,CY.wk);
    ctx.restore();
  }
  const a5=eOut(c01((T-1.75)/.6));
  fadeIn(ctx,a5,()=>{
    ctx.textAlign='center';
    ctx.fillStyle=P.light;K.setFont(ctx,600,34,K.FONT.en);K.spaced(ctx,X.rangeEn,RW/2,CY.date+(1-a5)*16,6);
    ctx.fillStyle=K.DIM;K.setFont(ctx,600,28,K.FONT.ko);ctx.fillText(X.kr+' · '+(X.num||X.wk.n)+'주차 리캡',RW/2,CY.ko+(1-a5)*16);
    if(X.foot){ctx.fillStyle=K.FAINT;K.fitFont(ctx,X.foot,900,500,24,K.FONT.ko,16);ctx.fillText(X.foot,RW/2,CY.foot);}
  });
  ctx.restore();
}
function pageHead(ctx,X,s,tt,still,ex){
  const P=X.P;
  const a=still||!s.first?1:eOut(c01(tt/.6));
  fadeIn(ctx,a*(1-(s.last?ex:0)),()=>{
    const sc=1+(1-a)*.08;
    ctx.translate(RW/2,TITLE_Y-40);ctx.scale(sc,sc);ctx.translate(-RW/2,-(TITLE_Y-40));
    K.title(ctx,P,s.title,TITLE_Y,s.tpx||112,920);
  });
  const b=still?1:eOut(c01((tt-(s.first?.25:.05))/.4));
  fadeIn(ctx,b*(1-ex),()=>{
    ctx.textAlign='center';ctx.fillStyle=P.light;K.fitFont(ctx,s.sub,920,600,30,K.FONT.ko,20);ctx.fillText(s.sub,RW/2,SUB_Y);
  });
}
function rcPaint(ctx,X,s,tt,A,still){
  ctx.save();
  ctx.drawImage(s.cover?coverBg(X,A):pageBg(X,A),0,0,RW,RH);
  if(!still&&s.bgFrom&&tt<.5){
    ctx.globalAlpha=1-eOut(tt/.5);ctx.drawImage(s.bgFrom==='cover'?coverBg(X,A):pageBg(X,A),0,0,RW,RH);ctx.globalAlpha=1;
  }
  if(s.cover) drawCover(ctx,X,s,tt,A,still);
  else{
    const ex=still?0:c01((tt-(s.sec-.4))/.4);
    pageHead(ctx,X,s,tt,still,ex);
    fadeIn(ctx,1-ex,()=>{if(ex)ctx.translate(-80*ex*ex,0);s.draw(ctx,tt,A,still);});
  }
  ctx.restore();
}
function rcStepAt(seq,t){
  const {steps,starts,total}=seq;
  if(t>=total) return [steps.length-1,Math.max(0,steps[steps.length-1].sec-.45)];
  let i=0;
  while(i<steps.length-1&&t>=starts[i+1])i++;
  return [i,t-starts[i]];
}
function rcPaintAt(ctx,seq,t,A){
  if(!seq.steps.length) return -1;
  const [i,tt]=rcStepAt(seq,t);
  rcPaint(ctx,seq.X,seq.steps[i],tt,A,false);
  return i;
}
function rcStill(seq,s,A){
  const c=document.createElement('canvas');c.width=RW;c.height=RH;
  rcPaint(c.getContext('2d'),seq.X,s,99,A,true);
  return c;
}
/** 줄: 순위, 로고, 이름, 값. 앞 3위는 금·은·동 색을 입힌다. */
function rcRow(ctx,A,r,x,y,w,h){
  rcCard(ctx,x,y,w,h,Math.min(20,h*.24),r.rank<=3?TINT[r.rank]:null);
  const cy=y+h/2;
  ctx.textBaseline='middle';ctx.textAlign='center';
  ctx.fillStyle=RANK_C[r.rank]||'rgba(255,255,255,0.66)';K.setFont(ctx,800,Math.round(Math.min(60,h*.56)),K.FONT.title);
  ctx.fillText(String(r.rank),x+48,cy+2);
  const cs=Math.round(Math.min(h*.74,104));
  K.crest(ctx,A.img[r.key],r.key,x+94+cs/2,cy,cs);
  const tx=x+94+cs+20;
  const vpx=Math.round(Math.min(64,h*.56));
  K.setFont(ctx,700,vpx,K.FONT.en);
  const vw=ctx.measureText(r.val).width,vr=x+w-26;
  ctx.textAlign='right';ctx.fillStyle=r.rank===1?RANK_C[1]:K.WHITE;ctx.fillText(r.val,vr,cy+3);
  const maxW=vr-vw-26-tx,npx=Math.round(Math.min(40,h*.42));
  ctx.textAlign='left';
  K.fitFont(ctx,r.name,maxW*.72,700,npx,K.FONT.ko,18);ctx.fillStyle=K.WHITE;ctx.fillText(r.name,tx,cy+1);
  if(r.tag){
    const nw=ctx.measureText(r.name).width;
    K.setFont(ctx,500,Math.round(npx*.62),K.FONT.ko);ctx.fillStyle=K.DIM;
    if(nw+12+ctx.measureText(r.tag).width<=maxW) ctx.fillText(r.tag,tx+nw+12,cy+3);
  }
  ctx.textBaseline='alphabetic';
}
function rcBlocks(ctx,blocks,tt,A,still){
  const nb=blocks.length,headH=blocks.some(b=>b.label)?50:0,gapB=22,gap=9;
  const rows=blocks.reduce((s,b)=>s+b.items.length,0);
  const maxH=rows<=4?150:nb>1?100:104;
  const h=Math.floor(Math.min(maxH,(CB-CT-nb*headH-gapB*(nb-1)-gap*(rows-nb))/Math.max(1,rows)));
  const used=nb*headH+gapB*(nb-1)+rows*h+gap*(rows-nb);
  let y=CT+Math.max(0,Math.floor((CB-CT-used)/2));
  blocks.forEach((b,bi)=>{
    const d0=.3+bi*.9,hy=y;
    if(headH) fadeIn(ctx,still?1:eOut(c01((tt-d0+.2)/.4)),()=>{
      ctx.textAlign='left';K.setFont(ctx,700,32,K.FONT.ko);ctx.fillStyle=K.WHITE;ctx.fillText(b.label||'',X0+8,hy+headH-14);
    });
    y+=headH;
    b.items.forEach((r,j)=>{
      const yy=y;
      inFly(ctx,still?LANDED:fly(tt,j,d0,.13),X0,yy,XW,h,()=>rcRow(ctx,A,r,X0,yy,XW,h));
      if(!still) glint(ctx,tt,d0+.95+j*.13,X0,yy,XW,h,Math.min(20,h*.24));
      y+=h+gap;
    });
    y+=gapB-gap;
  });
}
const MON_EN=K.MON;
function rangeEnOf(a,b){
  const pd=s=>s.split('-').map(Number),[,m1,d1]=pd(a),[y2,m2,d2]=pd(b);
  return a===b?`${MON_EN[m1-1]} ${d1}, ${y2}`:m1===m2?`${MON_EN[m1-1]} ${d1} – ${d2}, ${y2}`:`${MON_EN[m1-1]} ${d1} – ${MON_EN[m2-1]} ${d2}, ${y2}`;
}
const dotDate=ds=>{const [,m,d]=ds.split('-').map(Number);return m+'.'+d;};
const fmtSec=t=>{const s=Math.max(0,Math.round(t));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
function lrWeeks(){
  const by={};
  scopedMatches().filter(m=>m.status==='done'&&m.date).forEach(m=>{const k=SD.mondayOf(m.date);(by[k]=by[k]||[]).push(m);});
  return Object.keys(by).sort().map((mon,i)=>{
    const ms=by[mon],ds=ms.map(m=>m.date).sort();
    return {mon,n:i+1,end:SD.addDays(mon,6),first:ds[0],last:ds[ds.length-1],matches:ms};
  });
}
const LR_SCN={
  cover:{label:'표지',sec:5},results:{label:'이번 주 경기 결과',sec:5},record:{label:'이번 주 최고 기록',sec:5},
  classes:{label:'학급 종합 순위',sec:6},top:{label:'개인 TOP 10',sec:6},next:{label:'다음 경기',sec:5}
};
const LR_ORDER=['cover','results','classes','record','top','next'];
function recapCfg(loc){
  const c=(CFG.sns().recap)||{};
  const m=deepMerge(deepMerge({order:LR_ORDER,scenes:{},pick:{}},c),loc||{});
  m.order=[...m.order.filter(k=>LR_SCN[k]),...LR_ORDER.filter(k=>!m.order.includes(k))];
  return m;
}
function buildLaserRecap(wk,cfg,P,theme,foot){
  const st=CFG.settings();
  const pick=(cfg.pick&&cfg.pick[wk.mon])||{};
  const label=String(pick.label||'').trim()||'WEEK '+wk.n;
  const lm=label.match(/^(.*?)\s*(\d+)\s*$/);
  const rangeEn=rangeEnOf(wk.first,wk.last);
  const X={wk,cfg,P,theme,foot,pick,label,num:lm?lm[2]:'',year:wk.first.slice(0,4),wkLine:label+'  ·  '+rangeEn,rangeEn,en:st.eventName,kr:st.eventKr,sample:wk.matches.some(m=>m.sample)};
  const until=scopedRecords().filter(r=>(r.date||'')<=wk.end);
  const inWeek=until.filter(r=>(r.date||'')>=wk.mon);
  const asOf=label+' 종료 기준';
  const BUILD={
    cover:()=>[{cover:true,name:'표지',sub:'',sig:label}],
    results:()=>{
      const pages=[];
      let cur=[],rows=0;
      wk.matches.forEach(m=>{
        const items=matchRows(m).map((r,i)=>({rank:r.rank||i+1,key:r.key,name:r.label,val:r.time||(r.done+'/'+r.n+'명')}));
        if(cur.length&&rows+items.length>7){pages.push(cur);cur=[];rows=0;}
        cur.push({label:m.title+'  ·  '+dotDate(m.date),items});
        rows+=items.length;
      });
      if(cur.length) pages.push(cur);
      return pages.map((blocks,i)=>({name:'이번 주 경기 결과'+(pages.length>1?' '+(i+1)+'/'+pages.length:''),title:'RESULTS',sub:label+' 경기 결과'+(pages.length>1?' '+(i+1)+'/'+pages.length:''),sig:JSON.stringify(blocks),draw:(c,t,A,s)=>rcBlocks(c,blocks,t,A,s)}));
    },
    record:()=>{
      const r=rankRecords(inWeek,false)[0];
      if(!r) return [];
      const key=logoKey(r.cls);
      return [{name:'이번 주 최고 기록',title:'RECORD',sub:'이번 주 최고 기록',sig:r.id+r.finalCs,draw:(c,t,A,s)=>{
        const a=s?1:eOut(c01((t-.25)/.7)),sc=s?1:.82+.18*eBack(c01((t-.2)/.7));
        fadeIn(c,a,()=>{
          c.save();c.translate(RW/2,900);c.scale(sc,sc);c.translate(-RW/2,-900);
          K.crest(c,A.img[key],key,RW/2,900,320);
          c.restore();
        });
        const b=s?1:eOut(c01((t-.8)/.6));
        fadeIn(c,b,()=>{
          c.textAlign='center';c.fillStyle=K.WHITE;K.fitFont(c,r.name,860,700,76,K.FONT.ko,36);c.fillText(r.name,RW/2,1158);
          c.fillStyle=K.DIM;K.setFont(c,600,32,K.FONT.ko);c.fillText(className(r.cls)+' · '+genderKo(r.gender)+' · '+r.matchTitle,RW/2,1212);
          K.setFont(c,700,132,K.FONT.en);c.fillStyle=RANK_C[1];c.fillText(fmtCs(r.finalCs),RW/2,1358);
          K.pills(c,X.P,[['주행',fmtCs(r.runCs)],['사격',fmtCs(r.shootCs)],['페널티',fmtPen(r.penCs)]],1462);
        });
      }}];
    },
    classes:()=>{
      const rows=classTable(until,m=>(m.date||'')<=wk.end).filter(r=>r.rank);
      if(!rows.length) return [];
      const items=rows.slice(0,10).map(r=>({rank:r.rank,key:logoKey(r.cls),name:className(r.cls),val:fmtCs(r.team.finalCs)}));
      return [{name:'학급 종합 순위',title:'CLASS STANDINGS',tpx:92,sub:(st.teamCalc==='lap'?'전체 랩타임 + 페널티':'선수 6명 최종 기록 합계')+' · '+asOf,sig:JSON.stringify(items),draw:(c,t,A,s)=>rcBlocks(c,[{items}],t,A,s)}];
    },
    top:()=>[['전체',until],['남학생',until.filter(r=>r.gender==='M')],['여학생',until.filter(r=>r.gender==='F')]].map(([lab,list])=>{
      const items=rankRecords(list).slice(0,10).map(r=>({rank:r.rank,key:logoKey(r.cls),name:r.name,tag:classShort(r.cls),val:fmtCs(r.finalCs)}));
      return items.length?{name:'개인 TOP 10 · '+lab,title:'TOP 10',sub:lab+' 개인 기록 · '+asOf,sig:JSON.stringify(items),draw:(c,t,A,s)=>rcBlocks(c,[{items}],t,A,s)}:null;
    }).filter(Boolean),
    next:()=>{
      const list=scopedMatches().filter(m=>m.status!=='done'&&m.date&&m.date>wk.end||(m.status==='tbd'&&m.date&&m.date>=wk.last)).slice(0,5);
      if(!list.length) return [];
      const rows=list.map(m=>({date:dotDate(m.date),time:effectiveTimeStr(m).replace('시간 미정','--:--'),title:m.title,keys:matchKeys(m)}));
      return [{name:'다음 경기',title:'NEXT RACE',sub:rows[0].date+' 부터',sig:JSON.stringify(rows),draw:(c,t,A,s)=>{
        const h=Math.min(170,Math.floor((CB-CT-12*(rows.length-1))/rows.length));
        let y=CT+Math.max(0,Math.floor((CB-CT-(h+12)*rows.length+12)/2));
        rows.forEach((r,j)=>{
          const yy=y;
          inFly(c,s?LANDED:fly(t,j,.3,.13),X0,yy,XW,h,()=>{
            rcCard(c,X0,yy,XW,h,20,null);
            const cy=yy+h/2;
            c.textBaseline='middle';c.textAlign='left';
            K.setFont(c,700,52,K.FONT.en);c.fillStyle=K.WHITE;c.fillText(r.time,X0+28,cy-18);
            K.setFont(c,600,26,K.FONT.ko);c.fillStyle=X.P.light;c.fillText(r.date+' · '+r.title,X0+28,cy+32);
            const cs=Math.min(84,h-30,Math.floor(420/Math.max(1,r.keys.length)));
            r.keys.forEach((k,q)=>K.crest(c,A.img[k],k,X0+XW-24-cs/2-(r.keys.length-1-q)*(cs+6),cy,cs));
            c.textBaseline='alphabetic';
          });
          y+=h+12;
        });
      }}];
    }
  };
  const steps=[],info={};
  cfg.order.forEach(k=>{
    const sc=cfg.scenes[k]||{};
    const pages=BUILD[k]();
    info[k]={pages:pages.length};
    if(sc.on===false) return;
    const sec=c01(Number(sc.sec)||LR_SCN[k].sec,2,30);
    pages.forEach((p,i)=>steps.push({...p,key:k+'-'+i,scene:k,sec,first:i===0,last:i===pages.length-1,page:i+1,pages:pages.length}));
  });
  steps.forEach((s,i)=>{const prev=steps[i-1];s.bgFrom=prev&&!!prev.cover!==!!s.cover?(prev.cover?'cover':'page'):null;});
  let t=0;
  const starts=steps.map(s=>{const a=t;t+=s.sec;return a;});
  return {X,steps,starts,total:t,info};
}
function RecapPlayer({seq,A,guides,jump}){
  const I=SUI.Icon;
  const cv=useRef(null),st=useRef({t:seq.steps.length?Math.max(0,Math.min(3.2,seq.steps[0].sec-.5)):0,play:false,last:0,raf:0,ui:0,fresh:true}),seqRef=useRef(seq),aRef=useRef(A);
  seqRef.current=seq;aRef.current=A;
  const [,force]=useState(0);
  const draw=()=>{
    const c=cv.current;
    if(!c) return;
    const ctx=c.getContext('2d');ctx.setTransform(c.width/RW,0,0,c.height/RH,0,0);
    if(!aRef.current||!seqRef.current.steps.length){ctx.fillStyle='#04060f';ctx.fillRect(0,0,RW,RH);return;}
    rcPaintAt(ctx,seqRef.current,Math.min(st.current.t,seqRef.current.total),aRef.current);
  };
  const stop=()=>{const s=st.current;s.play=false;cancelAnimationFrame(s.raf);};
  const loop=now=>{
    const s=st.current;
    if(!s.play) return;
    if(s.last) s.t+=Math.min(.1,(now-s.last)/1000);
    s.last=now;
    if(s.t>=seqRef.current.total){s.t=seqRef.current.total;s.play=false;}
    draw();
    if(!s.play||now-s.ui>150){s.ui=now;force(x=>x+1);}
    if(s.play) s.raf=requestAnimationFrame(loop);
  };
  const play=()=>{const s=st.current;if(s.fresh||s.t>=seqRef.current.total-.05)s.t=0;s.fresh=false;s.play=true;s.last=0;cancelAnimationFrame(s.raf);s.raf=requestAnimationFrame(loop);force(x=>x+1);};
  const seek=t=>{st.current.fresh=false;st.current.t=c01(t,0,seqRef.current.total);draw();force(x=>x+1);};
  useEffect(()=>{draw();},[seq,A]);
  useEffect(()=>{if(jump){seek(jump.t);if(jump.play)play();}},[jump]);
  useEffect(()=>()=>stop(),[]);
  const s=st.current,total=seq.total,t=Math.min(s.t,total);
  const [i]=seq.steps.length?rcStepAt(seq,t):[-1];
  const cur=seq.steps[i];
  const toStep=j=>seek(seq.starts[c01(j,0,seq.steps.length-1)]+.001);
  const prev=()=>{if(i<0)return;const tt=t-seq.starts[i];toStep(tt>.6?i:i-1);};
  const next=()=>{if(i>=0&&i<seq.steps.length-1)toStep(i+1);};
  return html`<div class="rc-player">
    <div class="rc-screen" onClick=${()=>(s.play?(stop(),force(x=>x+1)):play())}>
      <canvas ref=${cv} width="720" height="1280" aria-label="주간 리캡 미리보기"></canvas>
      ${guides?html`<i class="rc-band t"></i><i class="rc-band b"></i>`:null}
      ${!s.play?html`<span class="rc-big" aria-hidden="true"><${I} n="play" size=${26}/></span>`:null}
    </div>
    <div class="rc-scrub">
      <div class="rc-marks" aria-hidden="true">${seq.steps.map((x,j)=>x.first&&j?html`<i style=${`left:${(seq.starts[j]/total)*100}%`}></i>`:null)}</div>
      <input type="range" min="0" max=${total} step="0.05" value=${t} aria-label="재생 위치" onInput=${e=>{stop();seek(Number(e.target.value));}}/>
    </div>
    <div class="rc-ctl">
      <button type="button" class="icon-btn" aria-label="이전 장" onClick=${prev}><${I} n="prev"/></button>
      <button type="button" id="rc-play" class="btn btn-primary rc-play" aria-label=${s.play?'일시정지':'재생'} onClick=${()=>(s.play?(stop(),force(x=>x+1)):play())}><${I} n=${s.play?'pause':'play'}/>${s.play?'일시정지':'재생'}</button>
      <button type="button" class="icon-btn" aria-label="다음 장" onClick=${next}><${I} n="next"/></button>
      <span class="rc-time">${fmtSec(t)} / ${fmtSec(total)}</span>
    </div>
    <div class="rc-now">${cur?html`<b>${i+1}/${seq.steps.length}</b> ${cur.name}`:'보여 줄 장면이 없습니다'}</div>
  </div>`;
}
function useRcStills(seq,A,sig){
  const [shots,setShots]=useState({});
  useEffect(()=>{
    if(!A) return;
    let live=true;
    const out={};
    const t=setTimeout(async()=>{
      for(const s of seq.steps){
        if(!live) return;
        const c=rcStill(seq,s,A);
        let url;
        try{url=c.toDataURL('image/jpeg',.9);}catch(e){url='err';}
        out[s.key]={url,get canvas(){return rcStill(seq,s,A);}};
        if(live) setShots({...out});
        await new Promise(r=>setTimeout(r,16));
      }
    },250);
    return()=>{live=false;clearTimeout(t);};
  },[sig,A]);
  return shots;
}
/* ---------- 영상 (MP4): 풋살 리캡과 같은 방식, 인스타 스토리용 60초 나누기 ---------- */
const FPS=30,BITRATE=5e6,STORY_MAX=59;
let muxerP=null;
function loadMuxer(){
  if(window.Mp4Muxer) return Promise.resolve(window.Mp4Muxer);
  return muxerP||(muxerP=new Promise((res,rej)=>{
    const sc=document.createElement('script');sc.src='lib/mp4-muxer.js';
    sc.onload=()=>(window.Mp4Muxer?res(window.Mp4Muxer):rej(new Error('mp4-muxer missing')));
    sc.onerror=()=>{muxerP=null;rej(new Error('mp4-muxer failed to load'));};
    document.head.appendChild(sc);
  }));
}
async function videoSupport(){
  if(typeof VideoEncoder!=='undefined'&&typeof VideoFrame!=='undefined'){
    for(const codec of ['avc1.640028','avc1.4d0028','avc1.42002a']){
      try{const r=await VideoEncoder.isConfigSupported({codec,width:RW,height:RH,bitrate:BITRATE,framerate:FPS});if(r&&r.supported)return {kind:'fast',codec};}catch(e){}
    }
  }
  if(typeof MediaRecorder!=='undefined'&&HTMLCanvasElement.prototype.captureStream){
    const mime=['video/mp4;codecs=avc1','video/mp4'].find(t=>{try{return MediaRecorder.isTypeSupported(t);}catch(e){return false;}});
    if(mime) return {kind:'live',mime};
  }
  return null;
}
function planParts(seq,split){
  if(!seq.steps.length) return [];
  if(!split) return [{t0:0,t1:seq.total}];
  const blocks=[];
  seq.steps.forEach((st,i)=>{
    const b=blocks[blocks.length-1],a=seq.starts[i],e=a+st.sec;
    if(b&&b.scene===st.scene){b.t1=e;b.cuts.push([a,e]);}else blocks.push({scene:st.scene,t0:a,t1:e,cuts:[[a,e]]});
  });
  const parts=[];
  let cur=null;
  const add=(a,e)=>{if(cur&&e-cur.t0<=STORY_MAX)cur.t1=e;else{cur={t0:a,t1:e};parts.push(cur);}};
  blocks.forEach(b=>{if(b.t1-b.t0<=STORY_MAX)add(b.t0,b.t1);else b.cuts.forEach(([a,e])=>add(a,e));});
  return parts;
}
const tick0=()=>new Promise(r=>setTimeout(r,0));
async function encodeFast(seq,A,part,codec,onProg,stop){
  const M=await loadMuxer();
  const c=document.createElement('canvas');c.width=RW;c.height=RH;
  const ctx=c.getContext('2d');
  const muxer=new M.Muxer({target:new M.ArrayBufferTarget(),fastStart:'in-memory',video:{codec:'avc',width:RW,height:RH,frameRate:FPS}});
  let fail=null;
  const enc=new VideoEncoder({output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),error:e=>{fail=e;}});
  enc.configure({codec,width:RW,height:RH,bitrate:BITRATE,framerate:FPS,avc:{format:'avc'}});
  const n=Math.max(1,Math.round((part.t1-part.t0)*FPS));
  try{
    for(let i=0;i<n;i++){
      if(fail) throw fail;
      if(stop()) throw {code:'cancelled'};
      rcPaintAt(ctx,seq,part.t0+i/FPS,A);
      const f=new VideoFrame(c,{timestamp:Math.round(i*1e6/FPS),duration:Math.round(1e6/FPS)});
      enc.encode(f,{keyFrame:i%(FPS*2)===0});f.close();
      while(enc.encodeQueueSize>4&&!fail) await new Promise(r=>setTimeout(r,2));
      if(i%5===0){onProg(i/n);await tick0();}
    }
    await enc.flush();
  }finally{if(enc.state!=='closed')enc.close();}
  if(fail) throw fail;
  muxer.finalize();
  return new Blob([muxer.target.buffer],{type:'video/mp4'});
}
async function encodeLive(seq,A,part,mime,onProg,stop){
  const c=document.createElement('canvas');c.width=RW;c.height=RH;
  c.style.cssText='position:fixed;left:-20000px;top:0;width:9px;height:16px;opacity:0;pointer-events:none';
  document.body.appendChild(c);
  const ctx=c.getContext('2d');rcPaintAt(ctx,seq,part.t0,A);
  const stream=c.captureStream(FPS),chunks=[];
  const rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:BITRATE});
  rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
  const stopped=new Promise(r=>{rec.onstop=r;});
  rec.start(500);
  const dur=part.t1-part.t0,t0=performance.now();
  let cancelled=false;
  await new Promise(res=>{
    const step=()=>{
      if(stop()){cancelled=true;return res();}
      const el=(performance.now()-t0)/1000;
      if(el>=dur) return res();
      rcPaintAt(ctx,seq,part.t0+el,A);onProg(el/dur);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  rec.stop();await stopped;stream.getTracks().forEach(t=>t.stop());c.remove();
  if(cancelled) throw {code:'cancelled'};
  return new Blob(chunks,{type:'video/mp4'});
}
async function saveVideoFile(blob,filename){
  try{
    const d=await claude.use('downloads').catch(()=>null);
    if(!d){SD.toast('이 화면에서는 바로 저장할 수 없습니다. 미리보기 영상을 길게 눌러(또는 오른쪽 클릭) 저장하세요.','err');return;}
    const r=await d.save({filename,data:blob});
    if(r&&r.status==='saved') SD.toast('영상을 저장했습니다.');
  }catch(e){
    const c=e&&e.code;
    if(c==='declined') return;
    SD.toast(c==='rate_limited'?'저장 확인 창이 이미 열려 있습니다. 잠시 후 다시 눌러 주세요.':c==='too_large'?'파일이 너무 커서 저장하지 못했습니다. 「스토리용 60초씩」으로 다시 만들어 보세요.':'여기서는 바로 저장할 수 없습니다. 미리보기 영상을 길게 눌러(또는 오른쪽 클릭) 저장하세요.','err');
  }
}
const mbOf=b=>(b/1048576).toFixed(b<10485760?1:0)+'MB';
function RecapVideoBox({seq,A,stamp,vsig}){
  const I=SUI.Icon;
  const [sup,setSup]=useState(undefined);
  const [mode,setMode]=useLocal('ui.recapSplit','split');
  const [job,setJob]=useState(null);
  const [outs,setOuts]=useState([]);
  const [cur,setCur]=useState(0);
  const stopRef=useRef(false),madeFor=useRef('');
  useEffect(()=>{let live=true;videoSupport().then(v=>{if(live)setSup(v);});return()=>{live=false;stopRef.current=true;};},[]);
  useEffect(()=>{
    if(madeFor.current&&madeFor.current!==vsig+mode){setOuts(o=>{o.forEach(x=>URL.revokeObjectURL(x.url));return [];});madeFor.current='';}
  },[vsig,mode]);
  const parts=planParts(seq,mode!=='one');
  const make=async()=>{
    if(!sup||!A||job||!parts.length) return;
    stopRef.current=false;
    outs.forEach(x=>URL.revokeObjectURL(x.url));setOuts([]);
    const made=[],key=vsig+mode,snap=seq,list=parts.slice();
    try{
      for(let i=0;i<list.length;i++){
        setJob({i,n:list.length,p:0});
        const onProg=p=>setJob({i,n:list.length,p});
        const blob=sup.kind==='fast'?await encodeFast(snap,A,list[i],sup.codec,onProg,()=>stopRef.current):await encodeLive(snap,A,list[i],sup.mime,onProg,()=>stopRef.current);
        made.push({url:URL.createObjectURL(blob),blob,file:list.length>1?`SDSLR_${stamp}_리캡_${i+1}of${list.length}.mp4`:`SDSLR_${stamp}_리캡.mp4`,dur:list[i].t1-list[i].t0,size:blob.size});
        setOuts(made.slice());setCur(0);
      }
      SD.toast(list.length>1?`영상 ${list.length}개를 만들었습니다. 하나씩 저장해 주세요.`:'영상을 만들었습니다. 저장을 눌러 주세요.');
    }catch(e){
      if(!(e&&e.code==='cancelled')){console.error(e);SD.toast('영상을 만들지 못했습니다. 새로 고친 뒤 다시 해 보세요.','err');}
    }finally{madeFor.current=made.length?key:'';setJob(null);}
  };
  const nSplit=planParts(seq,true).length;
  const pct=job?Math.round(((job.i+job.p)/job.n)*100):0;
  const shown=outs[Math.min(cur,outs.length-1)];
  return html`<section class="rc-video">
    <div class="rc-vhead"><b>영상으로 저장</b><span class="small muted">MP4 · 1080×1920 · 소리 없음 (음악은 인스타그램에서 넣어 주세요)</span></div>
    ${sup===null?html`<p class="small rc-vwarn">이 브라우저에서는 영상을 만들 수 없습니다. 컴퓨터의 크롬·엣지, 또는 아이폰의 사파리나 Claude 앱에서 열어 주세요.</p>`:html`
      <div class="rc-vopts">
        <${SUI.Seg} label="영상 나누기" value=${mode==='one'?'one':'split'} onChange=${setMode} options=${[{value:'split',label:'스토리용 60초씩 · '+nSplit+'개'},{value:'one',label:'한 개로 · '+fmtSec(seq.total)}]}/>
        <button type="button" id="rc-make" class="btn btn-primary" disabled=${!A||!sup||!!job||!parts.length} onClick=${make}><${I} n="play" size=${15}/>${sup===undefined?'확인 중…':outs.length?'다시 만들기':'영상 만들기'}</button>
      </div>
      <p class="small muted rc-vnote">${mode==='one'?'한 개의 영상으로 만듭니다. 인스타 스토리는 한 장에 60초까지라 60초가 넘으면 올릴 때 잘라야 해요.':parts.length>1?`인스타 스토리는 한 장에 60초까지라서 장면이 끊기지 않게 ${parts.length}개로 나눕니다 (${parts.map(p=>fmtSec(p.t1-p.t0)).join(' + ')}). 순서대로 올리면 이어서 재생돼요.`:'60초 안쪽이라 영상 하나로 만듭니다. 스토리에 그대로 올릴 수 있어요.'}
        ${sup&&sup.kind==='live'?' 이 브라우저는 재생 시간만큼 녹화하니 끝날 때까지 이 화면을 켜 두세요.':''}</p>`}
    ${job?html`<div class="rc-prog" role="status"><div class="rc-bar"><i style=${`width:${pct}%`}></i></div>
      <span>${job.n>1?`${job.i+1}/${job.n} · `:''}${Math.round(job.p*100)}% 만드는 중…</span>
      <button type="button" class="btn btn-sm" onClick=${()=>{stopRef.current=true;}}>취소</button></div>`:null}
    ${shown?html`<div class="rc-outs">
      <video class="rc-vid" key=${shown.url} src=${shown.url} controls playsinline muted loop preload="metadata" onLoadedMetadata=${e=>{try{e.target.currentTime=Math.min(2.6,(e.target.duration||0)/2);}catch(x){}}}></video>
      <div class="rc-outlist">${outs.map((o,i)=>html`<div class=${'rc-out'+(o===shown?' on':'')} key=${o.file}>
        <button type="button" class="rc-out-name" onClick=${()=>setCur(i)} aria-label=${o.file+' 미리보기'}><b>${outs.length>1?(i+1)+'번째 영상':'전체 영상'}</b><span>${fmtSec(o.dur)} · ${mbOf(o.size)}</span></button>
        <button type="button" class="btn btn-primary btn-sm" onClick=${()=>saveVideoFile(o.blob,o.file)}><${I} n="save" size=${14}/>저장</button></div>`)}
        <span class="small muted">아이폰은 저장 창에서 「비디오 저장」을 누르면 사진 앱에 들어갑니다.</span></div>
    </div>`:null}
  </section>`;
}
function RecapDraft({value,onCommit,...rest}){
  const [v,setV]=useState(value==null?'':String(value));
  useEffect(()=>{setV(value==null?'':String(value));},[value]);
  return html`<input ...${rest} value=${v} onInput=${e=>setV(e.target.value)} onBlur=${()=>onCommit(v)} onKeyDown=${e=>{if(e.key==='Enter')e.target.blur();}}/>`;
}
function LaserRecapPanel({can,P,theme,footerText,guides}){
  const I=SUI.Icon;
  const weeks=lrWeeks();
  const [wkPick,setWkPick]=useLocal('ui.recapWeek','');
  const [loc,setLoc]=useState({});
  const [A,setA]=useState(null);
  const [zoom,setZoom]=useState(-1);
  const [jump,setJump]=useState(null);
  const cfg=recapCfg(loc);
  const save=patch=>{if(can)Actions.saveConfig('sns',{recap:patch});else setLoc(p=>deepMerge(p,patch));};
  const wk=weeks.find(w=>w.mon===wkPick)||weeks[weeks.length-1]||null;
  const seq=wk?buildLaserRecap(wk,cfg,P,theme,footerText):{X:null,steps:[],starts:[],total:0,info:{}};
  const keyList=wk?[...new Set(classesSorted().map(logoKey))]:[];
  const names=wk?scopedRecords().map(r=>r.name).join(' ')+' '+classesSorted().map(className).join(' ')+' '+wk.matches.map(m=>m.title).join(' ')+' '+footerText+' '+seq.X.kr:'';
  useEffect(()=>{
    if(!wk) return;
    let live=true;
    lrAssets(keyList,names).then(a=>{if(live)setA(a);});
    return()=>{live=false;};
  },[wk&&wk.mon,keyList.join()]);
  const sig=wk?JSON.stringify([theme,footerText,seq.X.label,seq.X.en,seq.X.kr,seq.steps.map(s=>[s.key,s.sub,s.sig])]):'';
  const shots=useRcStills(seq,A,sig);
  if(!wk) return html`<section class="panel"><${SUI.Empty} title="아직 끝난 경기가 없습니다">경기를 종료 처리하면 그 주의 리캡이 만들어집니다.<//></section>`;
  const stamp=seq.X.label.replace(/\s+/g,'');
  const fileOf=(s,i)=>`SDSLR_${stamp}_${String(i+1).padStart(2,'0')}_${s.name.replace(/[\s/·]+/g,'_')}.jpg`;
  const stories=seq.steps.map((s,i)=>({key:s.key,title:(i+1)+'. '+s.name,sub:s.sec+'초',alt:s.name,file:fileOf(s,i)}));
  const vsig=JSON.stringify([sig,seq.steps.map(s=>s.sec)]);
  const move=(i,d)=>{const o=cfg.order.slice(),j=i+d;if(j<0||j>=o.length)return;[o[i],o[j]]=[o[j],o[i]];save({order:o});};
  const setSec=(k,raw)=>{const v=Math.round(Number(raw));if(!v||v===(cfg.scenes[k]||{}).sec)return;save({scenes:{[k]:{sec:c01(v,2,30)}}});};
  return html`<div class="rc-wrap"><div class="rc">
    <${RecapPlayer} seq=${seq} A=${A} guides=${guides} jump=${jump}/>
    <div class="rc-side">
      <div class="rc-top">
        <label class="field"><span>주차</span><select id="rc-week" class="select" value=${wk.mon} onChange=${e=>setWkPick(e.target.value)}>
          ${weeks.map(w=>html`<option value=${w.mon}>${(cfg.pick[w.mon]&&cfg.pick[w.mon].label)||'WEEK '+w.n} · ${dotDate(w.first)}–${dotDate(w.last)} · ${w.matches.length}경기</option>`)}</select></label>
        <label class="field"><span>표지 문구</span><${RecapDraft} id="rc-label" class="input" maxlength="18" value=${seq.X.pick.label||''} placeholder=${'WEEK '+wk.n} onCommit=${v=>{if(v.trim()!==(seq.X.pick.label||''))save({pick:{[wk.mon]:{label:v.trim()||null}}});}}/></label>
        <span class="spacer"></span>
        <span class="rc-total">총 <b>${fmtSec(seq.total)}</b> · ${seq.steps.length}장</span>
      </div>
      <${RecapVideoBox} seq=${seq} A=${A} stamp=${stamp} vsig=${vsig}/>
      <div class="rc-list">${cfg.order.map((k,i)=>{
        const sc=cfg.scenes[k]||{},pages=(seq.info[k]||{}).pages||0,on=sc.on!==false,sec=sc.sec||LR_SCN[k].sec;
        const first=seq.steps.findIndex(s=>s.scene===k);
        return html`<div class=${'rc-row'+(on&&pages?'':' off')} key=${k}>
          <div class="rc-ord">
            <button type="button" class="icon-btn sm" aria-label=${LR_SCN[k].label+' 위로'} disabled=${i===0} onClick=${()=>move(i,-1)}><${I} n="up" size=${14}/></button>
            <button type="button" class="icon-btn sm" aria-label=${LR_SCN[k].label+' 아래로'} disabled=${i===cfg.order.length-1} onClick=${()=>move(i,1)}><${I} n="down" size=${14}/></button>
          </div>
          <label class="switch rc-name"><input type="checkbox" checked=${on} onChange=${e=>save({scenes:{[k]:{on:e.target.checked}}})}/>
            <span><b>${LR_SCN[k].label}</b><small>${pages?(pages>1?pages+'장 · '+pages*sec+'초':'1장 · '+sec+'초'):'이번 주 내용 없음'}</small></span></label>
          <div class="rc-opt"></div>
          <label class="rc-sec"><${RecapDraft} class="input" type="number" min="2" max="30" step="1" inputmode="numeric" aria-label=${LR_SCN[k].label+' 시간(초)'} value=${sec} onCommit=${v=>setSec(k,v)}/><span>${pages>1?'초/장':'초'}</span></label>
          <button type="button" class="icon-btn" aria-label=${LR_SCN[k].label+' 부터 재생'} title="여기부터 재생" disabled=${first<0} onClick=${()=>setJump({t:seq.starts[first]+.001,play:true,n:Date.now()})}><${I} n="play" size=${15}/></button>
        </div>`;
      })}</div>
    </div>
  </div>
  <section class="rc-stills">
    <div class="panel-head" style="padding:0 0 10px"><h2>장면별 이미지</h2><span class="sub">마지막 모습으로 저장됩니다 · 누르면 크게 보기</span></div>
    ${seq.steps.length?html`<div class="story-grid">${seq.steps.map((s,i)=>{
      const shot=shots[s.key],ok=shot&&shot.url!=='err';
      return html`<figure class="story" key=${s.key}>
        <button type="button" class="story-frame" aria-label=${s.name+' 크게 보기'} disabled=${!ok} onClick=${()=>setZoom(i)}>
          ${ok?html`<img src=${shot.url} alt=${s.name}/>`:html`<div class="story-wait">${shot?'이미지를 만들지 못했습니다':'그리는 중…'}</div>`}
          ${guides?html`<i class="safe t band"></i><i class="safe b band"></i>`:null}
          ${ok?html`<span class="story-zoom" aria-hidden="true"><${I} n="search" size=${16}/></span>`:null}</button>
        <figcaption><b>${i+1}. ${s.name}</b><span>${s.sec}초</span><${K.SaveBtn} shot=${shot} file=${fileOf(s,i)}/></figcaption>
      </figure>`;
    })}</div>`:html`<section class="panel"><${SUI.Empty} title="켜진 장면이 없습니다">위 목록에서 보여 줄 장면을 켜 주세요.<//></section>`}
  </section>
  ${zoom>=0&&zoom<stories.length?html`<${K.Lightbox} stories=${stories} idx=${zoom} shots=${shots} onIdx=${setZoom} onClose=${()=>setZoom(-1)} guides=${guides} band=${true}/>`:null}</div>`;
}

/* ==========================================================================
   SDSMP와 연결되는 부분: 공개 여부, 메뉴, 화면 뼈대, 오류 차단
   ========================================================================== */
/* 공개 여부 한 칸만 모든 계정이 구독한다. 나머지 레이저런 데이터는 레이저런 화면을 열 때만 구독한다. */
const Flag={
  open:false,attached:false,
  attach(db){
    if(this.attached||!db) return;
    this.attached=true;
    const sub=()=>db.doc('lr_config/app').onSnapshot(d=>{
      const o=!!(d.exists&&(d.data()||{}).open===true);
      if(o!==this.open){this.open=o;SD.bump();}
    },err=>{
      const c=err&&err.code;
      if(c==='unavailable'||c==='resource_exhausted') setTimeout(sub,3000);
    });
    sub();
  }
};
const liveCount=()=>Store.list('matches').filter(m=>m.status==='live'&&(!sampleHidden()||!m.sample)).length;
const Boot={
  started:false,
  ensure(){
    if(this.started||!SD.S.db) return;
    this.started=true;
    Store.start(SD.S.db);
    MediaStore.init();
    Signs.start();
    let last=0;
    Store.subscribe(()=>{const n=liveCount();if(n!==last){last=n;SD.bump();}});
    let tries=0;
    const t=setInterval(()=>{
      if(SD.S.room){Live.bind();Live.startBeat();clearInterval(t);}
      else if(++tries>60) clearInterval(t);
    },500);
  }
};
/* 스타일 파일도 레이저런 화면을 열 때만 불러온다. 풋살 화면의 첫 표시에는 영향이 없다. */
const Css={
  state:0,subs:new Set(),
  ensure(){
    if(this.state) return;
    this.state=1;
    const done=()=>{if(this.state===2)return;this.state=2;this.subs.forEach(f=>f());};
    const el=document.createElement('link');
    el.rel='stylesheet';el.href='laser.css';
    el.onload=done;el.onerror=done;
    document.head.appendChild(el);
    setTimeout(done,4000);
  }
};
function useCss(){
  const [ok,setOk]=useState(Css.state===2);
  useEffect(()=>{
    Css.ensure();
    if(Css.state===2){setOk(true);return;}
    const f=()=>setOk(true);
    Css.subs.add(f);
    return()=>Css.subs.delete(f);
  },[]);
  return ok;
}

/* ==========================================================================
   코스 지점 · 카메라
   - 지점 버튼(cp): 체육회 지점 요원이 선수가 자기 앞을 지나는 순간 그 조끼 색 버튼을 누른다 → TV 코스 위치 · 순위가 바뀐다
   - 코스 지점 · 카메라(points): 지점 위치(드래그) · 요원 배정 · 스포츠기자단 휴대폰 카메라 링크(QR)
   - TV: 화면 아래 CAM 버튼으로 기자단 카메라를 골라 경기 화면 위에 띄운다 (VDO.Ninja)
   ========================================================================== */
const Me={
  role:()=>(window.FBX&&FBX.state&&FBX.state.role)||(Store.canWrite()?'editor':'viewer'),
  uid:()=>(window.FBX&&FBX.state&&FBX.state.user&&FBX.state.user.uid)||(SD.S.me&&SD.S.me.id)||'',
  name:()=>(window.FBX&&FBX.state&&FBX.state.name)||(SD.S.me&&SD.S.me.name)||''
};
const cpDocId=(runId,leg,n)=>runId+'__'+leg+'__'+n;
const cpSeg=c=>c.p<courseRangeAt()?'run1':'run2';
const cpMeters=c=>Math.round(c.p*CFG.cp().len);
const CP_SEG_KO={run1:'1구간 · 출발 → 사격장',run2:'2구간 · 사격장 → 도착'};
/* 카메라: 기자단 휴대폰은 push 링크로 보내고, TV는 view 링크로 받는다. 방 이름(room)이 링크 앞부분이라 대회마다 새로 만든다. */
const CAM_BASE='https://vdo.ninja/';
const camId=n=>(CFG.cp().room||'sdlr')+'c'+n;
const camPushUrl=n=>CAM_BASE+'?push='+camId(n)+'&webcam&quality=1&label='+encodeURIComponent('CAM'+n);
const camViewUrl=n=>CAM_BASE+'?view='+camId(n)+'&cleanoutput&noaudio&cover';
const camPoints=()=>{const c=CFG.cp();return c.camOn&&c.room?cpList().filter(x=>x.cam):[];};
/** 추천 카메라: 선두 학급이 다음에 지나갈 카메라 */
function camSuggest(m,t){
  const cams=camPoints();
  if(!cams.length) return null;
  if(!m) return cams[0].n;
  const rows=raceTable(m).filter(r=>r.started&&!r.team.complete);
  if(!rows.length) return cams[0].n;
  const pr=runProgress(rows[0].run,t,CFG.settings(),courseRangeAt());
  return (cams.find(c=>c.p>=pr.p-.01)||cams[0]).n;
}
const CpAct={
  _last:{},
  tap(m,run,leg,c){
    const id=cpDocId(run.id,leg,c.n),t=Live.now();
    if(t-(this._last[id]||0)<600) return false; // 두 번 눌림 방지
    this._last[id]=t;
    const ok=Store.put('cp',id,'set',{matchId:m.id,runId:run.id,classId:run.classId,leg,point:c.n,t,by:Me.uid(),name:Me.name(),at:Date.now()});
    if(ok&&navigator.vibrate) try{navigator.vibrate(35);}catch(e){}
    return ok;
  },
  undo(id){return Store.put('cp',id,'del',null);}
};

/* ---------- 지점 버튼 (체육회 지점 요원 휴대폰) ---------- */
function CpButton({m,run,point,now}){
  const c=Store.doc('classes',run.classId),s=runState(run),st=CFG.settings();
  const seg=cpSeg(point),leg=s.cur;
  const id=leg>=0?cpDocId(run.id,leg,point.n):null;
  const mine=id?Store.doc('cp',id):null;
  const pid=leg>=0?((legOf(run,leg)||{}).playerId||(run.order||[])[leg]):null;
  const p=pid?playerOf(c,pid):null;
  const active=leg>=0&&s.phase===seg&&!mine;
  const [hit,setHit]=useState(0);
  let state='';
  if(leg<0) state='완주';
  else if(run.startedAt==null||s.phase==='ready') state='출발 대기';
  else if(mine) state='통과 '+fmtCs(toCs(Math.max(0,mine.t-run.startedAt)*(run.scale||1),st.rounding));
  else if(seg==='run2'&&s.phase==='run1') state='사격장으로 가는 중';
  else if(seg==='run2'&&s.phase==='shoot') state='사격 중 · 곧 옵니다';
  else if(seg==='run1'&&(s.phase==='shoot'||s.phase==='run2')) state=PHASE_KO[s.phase]+' · 이미 지나감';
  else state=PHASE_KO[s.phase]||'';
  const canUndo=mine&&mine.by===Me.uid()&&now-mine.t<10000;
  const press=()=>{if(!active)return;if(CpAct.tap(m,run,leg,point))setHit(Date.now());};
  return html`<div class=${'cpb'+(active?' on':'')+(mine?' done':'')+(Date.now()-hit<500?' hit':'')} style=${vestStyle(run.lane)}>
    <button type="button" class="cpb-main" id=${'cp-btn-'+run.lane} disabled=${!active} onClick=${press} aria-label=${className(c)+' '+(active?'통과':state)}>
      <span class="cpb-lane">${run.lane}사로</span>
      <${Logo} cls=${c} className="cpb-logo"/>
      <b class="cpb-name">${className(c)}</b>
      <span class="cpb-runner">${leg>=0?(leg+1)+'번 '+(p?p.name:''):'모든 주자 완주'}</span>
      <span class="cpb-state">${active?'통과!':mine?html`✓ ${state}`:state}</span>
    </button>
    ${canUndo?html`<button type="button" class="cpb-undo" onClick=${()=>CpAct.undo(id)}>취소 <small>${Math.ceil((10000-(now-mine.t))/1000)}초</small></button>`:null}
  </div>`;
}
function CpPicker({list,cur,onPick,mineUid}){
  return html`<div class="cp-pick">${list.map(c=>html`<button key=${c.n} type="button" class=${'cp-pt'+(cur===c.n?' on':'')} id=${'cp-pt-'+c.n} onClick=${()=>onPick(c.n)}>
    <b>${c.n}</b><span>${cpMeters(c)}m${c.cam?' · CAM':''}</span><small>${c.name&&c.uid!==mineUid?c.name:cpSeg(c)==='run1'?'1구간':'2구간'}</small>
  </button>`)}</div>`;
}
function CpPage(){
  useStore();
  const now=useNow(250);
  const list=cpList(),uid=Me.uid(),edit=Store.canWrite();
  const assigned=list.find(c=>c.uid&&c.uid===uid)||null;
  const [pick,setPick]=useLocal('cp.point',null);
  const [choosing,setChoosing]=useState(false);
  const point=(!edit||!choosing)&&assigned?assigned:list.find(c=>c.n===pick)||null;
  const lives=scopedMatches().filter(m=>m.status==='live');
  const [mSel,setMSel]=useLocal('cp.match',null);
  const m=lives.find(x=>x.id===mSel)||lives[0]||null;
  const awakeRef=useRef(null);
  const awake=useKeepAwake(true,awakeRef);
  useEffect(()=>{Live.setRole('tv');return()=>{Live.setRole('admin');SD.setPresence({cpPoint:null});};},[]);
  useEffect(()=>{SD.setPresence({cpPoint:point&&!choosing?point.n:null});},[point&&point.n,choosing]);
  const synced=Live._samples.length>0;
  const keep=html`<video class="keepawake" ref=${awakeRef} loop playsInline preload="auto" aria-hidden="true" tabIndex="-1"><source src="media/keepawake.webm" type="video/webm"/><source src="media/keepawake.mp4" type="video/mp4"/></video>`;
  if(!list.length) return html`<${Panel}><div class="empty" style="padding:40px 16px"><strong>코스 지점이 없습니다</strong><span>선생님이 「코스 지점 · 카메라」에서 지점 수를 정하면 나타납니다.</span></div><//>`;
  if(!point||choosing) return html`<div class="cp-page">${keep}
    <${Panel} title="내 지점 고르기" kicker="Checkpoint">
      <p class="muted small" style="margin:0 0 10px">내가 서 있는 코스 지점 번호를 누르세요. ${assigned&&!edit?'':'선생님이 미리 배정하면 자동으로 정해집니다.'}</p>
      <${CpPicker} list=${list} cur=${point&&point.n} mineUid=${uid} onPick=${n=>{setPick(n);setChoosing(false);}}/>
    <//>
  </div>`;
  const runs=m?runsOfMatch(m):[];
  const seg=cpSeg(point);
  const pend=Store.pendingCount;
  // 이 지점 통과 순서: 가장 최근 주자 차례(같은 번호 주자)만, 먼저 지나간 순서대로
  const tapsAll=m?Store.list('cp').filter(x=>x.matchId===m.id&&x.point===point.n):[];
  const lastLeg=tapsAll.reduce((a,x)=>Math.max(a,x.leg),-1);
  const taps=tapsAll.filter(x=>x.leg===lastLeg).sort((a,b)=>a.t-b.t);
  return html`<div class="cp-page">${keep}
    <header class="cp-head">
      <div class="cp-no"><small>지점</small><b>${point.n}</b></div>
      <div class="cp-where"><b>${CP_SEG_KO[seg]}</b><span>출발에서 약 ${cpMeters(point)}m${point.cam?' · 카메라 지점':''}${point.name?' · '+point.name:''}</span></div>
      ${!assigned||edit?html`<button type="button" class="btn btn-sm btn-ghost" id="cp-change" onClick=${()=>setChoosing(true)}>지점 바꾸기</button>`:null}
    </header>
    <div class="cp-status">
      <span class=${synced?'ok':''}>${synced?'시계 맞춤':'시계 맞추는 중'}</span>
      <span class=${Store.offline?'bad':pend?'':'ok'}>${Store.offline?'연결 끊김 · 연결되면 보냄':pend?'보내는 중 '+pend:'저장됨'}</span>
      <span class=${awake?'ok':''}>${awake?'화면 유지':'화면을 한 번 눌러 주세요'}</span>
    </div>
    ${!m?html`<${Panel}><div class="empty" style="padding:36px 16px"><strong>진행 중인 경기가 없습니다</strong><span>기록원이 경기를 시작하면 이 화면에 조끼 색 버튼이 자동으로 나타납니다.</span></div><//>`:html`
      ${lives.length>1?html`<div class="seg cp-mseg" role="group">${lives.map(x=>html`<button key=${x.id} type="button" aria-pressed=${String(x.id===m.id)} onClick=${()=>setMSel(x.id)}>${x.title}</button>`)}</div>`:null}
      <div class="cp-match"><b>${m.title}</b><span>${seg==='run2'&&CFG.settings().returnRun===false?'이 경기는 사격 뒤 달리기가 없어 이 지점은 쓰지 않습니다':'선수가 내 앞을 지나는 순간 그 조끼 색 버튼을 누르세요'}</span></div>
      <div class=${'cp-grid n'+runs.length}>${runs.map(run=>html`<${CpButton} key=${run.id} m=${m} run=${run} point=${point} now=${now}/>`)}</div>
      ${taps.length?html`<${Panel} title="이 지점 통과 순서" kicker=${(lastLeg+1)+'번 주자 차례 · '+taps.length+'/'+runs.length}>
        <ol class="cp-log">${taps.map((x,i)=>{const run=Store.doc('runs',x.runId),c=Store.doc('classes',x.classId);
          return html`<li key=${x.runId+x.leg}><em>${i+1}</em><i style=${run?vestStyle(run.lane):''}></i><b>${className(c)}</b><${Tm} v=${run&&run.startedAt!=null?fmtCs(toCs(Math.max(0,x.t-run.startedAt)*(run.scale||1),CFG.settings().rounding)):''}/></li>`;})}</ol>
      <//>`:null}
    `}
    <p class="cp-help">잘못 눌렀으면 10초 안에 「취소」를 누르세요. 화면이 꺼지지 않게 켜 두고, 휴대폰은 세로로 들고 있어도 됩니다.</p>
  </div>`;
}

/* ---------- 코스 지점 · 카메라 설정 (선생님) ---------- */
function CpMarks({geo,k=1,cam=null,dragN=null,tmp={},onDown}){
  const list=cpList().map(c=>tmp[c.n]!=null?{...c,p:tmp[c.n]}:c);
  return html`<g class="cpm-layer">${list.map(c=>{const a=geo.at(c.p);
    return html`<g key=${c.n} class=${'cpm'+(c.cam?' cam':'')+(cam===c.n?' live':'')+(dragN===c.n?' drag':'')+(onDown?' edit':'')} data-cp=${c.n}
      transform=${'translate('+a.x.toFixed(1)+','+a.y.toFixed(1)+') scale('+k+')'} onPointerDown=${onDown?e=>onDown(e,c.n):undefined}>
      ${c.cam?html`<rect class="cpm-cam" x="-17" y="-17" width="34" height="34" rx="9"></rect>`:html`<circle class="cpm-bg" r="15"></circle>`}
      <text y="6" text-anchor="middle">${c.n}</text>
    </g>`;})}</g>`;
}
function CamCard({c,room}){
  const [prev,setPrev]=useState(false);
  const url=camPushUrl(c.n);
  return html`<div class="camc">
    <div class="camc-head"><b>CAM ${c.n}</b><span>${c.n}번 지점 · 약 ${cpMeters(c)}m · ${cpSeg(c)==='run1'?'1구간':'2구간'}</span></div>
    <div class="camc-body"><${Qr} text=${url} size=${132}/>
      <div class="camc-side"><${CopyField} value=${url} id=${'cam-link-'+c.n}/>
        <button type="button" class="btn btn-sm" onClick=${()=>setPrev(!prev)}>${prev?'미리보기 닫기':'TV에서 보이는 화면 미리보기'}</button></div></div>
    ${prev?html`<div class="camc-prev"><iframe src=${camViewUrl(c.n)} allow="autoplay; fullscreen" title=${'CAM '+c.n+' 미리보기'}></iframe></div>`:null}
  </div>`;
}
function PointsPage(){
  useStore();
  SD.useStore();
  const cfg=CFG.cp(),list=cpList(),course=CFG.course(),st=CFG.settings();
  const geoKey=JSON.stringify(course.points);
  const geo=useMemo(()=>buildCourse(course.points),[geoKey]);
  const ra=courseRangeAt();
  const svgRef=useRef(null);
  const [dragN,setDragN]=useState(null);
  const [tmp,setTmp]=useState({});
  const [users,setUsers]=useState([]);
  useEffect(()=>{
    const db=SD.S.db;
    if(!db||!window.SD_LASER_ONLY) return;
    try{return db.collection('users').onSnapshot(s=>setUsers(s.docs.map(d=>({id:d.id,...d.data()})).filter(u=>u.role==='staff')),()=>{});}catch(e){}
  },[]);
  const online=new Set((SD.S.peers||[]).map(p=>p.by).filter(Boolean));
  const clean=pts=>pts.map(({n,p,cam,uid,name})=>({n,p:p==null?null:+(+p).toFixed(4),cam:!!cam,uid:uid||null,name:name||''}));
  const saveAll=(patch,msg)=>{if(Store.merge('config','cp',patch)&&msg)ActLog.add(msg);};
  const all=()=>{ // 저장된 전체(개수보다 많은 칸 포함)
    const saved=(Store.doc('config','cp')||{}).points;
    const byN={};(Array.isArray(saved)?saved:[]).forEach(x=>{if(x&&x.n)byN[x.n]=x;});
    cfg.points.forEach(x=>{byN[x.n]={...(byN[x.n]||{}),...x};});
    return Object.values(byN).sort((a,b)=>a.n-b.n);
  };
  const setPoint=(n,patch)=>saveAll({points:clean(all().map(x=>x.n===n?{...x,...patch}:x))});
  const setCount=v=>saveAll({count:clamp(v,0,24)},'코스 지점 수 '+clamp(v,0,24)+'개');
  const spread=()=>saveAll({points:clean(all().map(x=>({...x,p:null})))},'코스 지점 고르게 다시 배치');
  const toSvg=e=>{const svg=svgRef.current;if(!svg)return null;const pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;return pt.matrixTransform(svg.getScreenCTM().inverse());};
  const onDown=(e,n)=>{e.preventDefault();e.stopPropagation();setDragN(n);try{svgRef.current.setPointerCapture(e.pointerId);}catch(x){}};
  const pOf=e=>{const q=toSvg(e);if(!q)return null;let p=clamp(geo.nearest(q.x,q.y),.005,.995);if(Math.abs(p-ra)<.015)p=ra+(p<ra?-.015:.015);return p;};
  const onMove=e=>{if(dragN==null)return;const p=pOf(e);if(p!=null)setTmp({[dragN]:p});};
  const onUp=()=>{if(dragN==null)return;const p=tmp[dragN];if(p!=null)setPoint(dragN,{p});setDragN(null);setTimeout(()=>setTmp({}),400);};
  const assign=(c,v)=>{
    if(v==='')setPoint(c.n,{uid:null,name:''});
    else if(v==='__type'){const nm=prompt(c.n+'번 지점 요원 이름','');if(nm!=null)setPoint(c.n,{uid:null,name:nm.trim().slice(0,30)});}
    else{const u=users.find(x=>x.id===v);setPoint(c.n,{uid:v,name:(u&&u.name)||''});}
  };
  const newRoom=async()=>{
    if(cfg.room&&!await askConfirm({title:'카메라 링크를 새로 만들까요?',body:'지금 기자단 휴대폰에 열려 있는 링크는 더 이상 TV로 보이지 않습니다. 새 QR을 다시 찍어야 합니다.',ok:'새로 만들기',danger:true})) return;
    const r='sd'+Math.random().toString(36).slice(2,8);
    saveAll({room:r,camOn:true},'카메라 링크 새로 만들기');
  };
  const cams=list.filter(c=>c.cam);
  return html`<div class="pts">
    <${Panel} title="코스 지점" kicker=${'지점 '+cfg.count+'개 · 코스 약 '+cfg.len+'m'} right=${html`
      <div class="pts-ctl">
        <span class="pts-step"><button class="btn btn-sm" id="pts-minus" onClick=${()=>setCount(cfg.count-1)} disabled=${cfg.count<=0}>−</button><b id="pts-count">${cfg.count}</b><button class="btn btn-sm" id="pts-plus" onClick=${()=>setCount(cfg.count+1)} disabled=${cfg.count>=24}>+</button></span>
        <label class="pts-len">코스 길이 <input class="input" type="number" min="50" max="5000" step="10" value=${cfg.len} onChange=${e=>saveAll({len:clamp(+e.target.value||350,50,5000)})}/> m</label>
        <button class="btn btn-sm" onClick=${spread}>고르게 다시 배치</button>
      </div>`}>
      <p class="muted small" style="margin:0 0 10px">번호를 끌어 실제 요원이 서는 자리로 옮기세요. 네모(□)는 카메라 지점입니다. 사격장 바로 앞뒤에는 놓을 수 없어요.</p>
      <div class="pts-map" onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp}>
        <${CourseSvg} svgRef=${svgRef} geo=${geo} rangeAt=${ra} rangeAngle=${course.rangeAngle} laneCount=${st.laneCount} bgId=${course.bgId} bgDim=${course.bgDim} preset=${course.bgPreset} k=${course.markScale} rs=${course.rangeScale}>
          <${CpMarks} geo=${geo} k=${Math.max(.7,course.markScale)} dragN=${dragN} tmp=${tmp} onDown=${onDown}/>
        <//>
      </div>
    <//>
    <${Panel} title="지점 요원 배정" kicker="체육회">
      <p class="muted small" style="margin:0 0 10px">체육회 학생이 코드로 들어오면 목록에 나타납니다. 배정하면 그 학생 휴대폰의 「지점 버튼」이 바로 그 지점으로 열립니다. 배정하지 않으면 학생이 직접 지점을 고릅니다.</p>
      <div class="tbl-wrap"><table class="tbl pts-tbl">
        <thead><tr><th>지점</th><th>위치</th><th>구간</th><th>요원</th><th>카메라</th></tr></thead>
        <tbody>${list.map(c=>html`<tr key=${c.n}>
          <td><b class="pts-no ${c.cam?'cam':''}">${c.n}</b></td>
          <td class="num">약 ${cpMeters(c)}m</td>
          <td>${cpSeg(c)==='run1'?'1구간':'2구간'}</td>
          <td><div class="pts-who">
            <select class="select" id=${'pts-who-'+c.n} value=${c.uid||(c.name?'__name':'')} onChange=${e=>assign(c,e.target.value)}>
              <option value="">배정 안 함</option>
              ${users.map(u=>html`<option value=${u.id}>${u.name||'이름 없음'}${online.has(u.id)?' · 접속 중':''}</option>`)}
              ${c.name&&!c.uid?html`<option value="__name">${c.name} (이름만)</option>`:null}
              <option value="__type">이름만 적기…</option>
            </select>
            ${c.uid?html`<i class=${'pts-dot'+(online.has(c.uid)?' on':'')} title=${online.has(c.uid)?'접속 중':'접속 안 함'}></i>`:null}
          </div></td>
          <td><button type="button" class=${'chip pts-cam'+(c.cam?' on':'')} id=${'pts-cam-'+c.n} aria-pressed=${String(c.cam)} onClick=${()=>setPoint(c.n,{cam:!c.cam})}>${c.cam?'CAM':'없음'}</button></td>
        </tr>`)}</tbody>
      </table></div>
    <//>
    <${Panel} title="카메라 중계" kicker="스포츠기자단 휴대폰 → TV" right=${html`
      <label class="check-line"><input id="cam-on" type="checkbox" checked=${cfg.camOn} onChange=${e=>saveAll({camOn:e.target.checked})}/> 사용</label>
      <button class="btn btn-sm" id="cam-room" onClick=${newRoom}>${cfg.room?'링크 새로 만들기':'카메라 링크 만들기'}</button>`}>
      ${!cfg.room?html`<p class="muted">「카메라 링크 만들기」를 누르면 카메라 지점마다 QR이 생깁니다.</p>`
      :!cams.length?html`<p class="muted">카메라 지점이 없습니다. 위 표에서 카메라를 켜세요.</p>`
      :html`
        <ol class="cam-how">
          <li><b>기자단</b> 휴대폰 카메라로 자기 CAM의 QR을 찍는다 → 열린 화면에서 카메라·마이크 <b>허용</b></li>
          <li>뒷면 카메라를 고르고 <b>Start</b> → 휴대폰을 <b>가로</b>로 들고 화면이 꺼지지 않게 둔다</li>
          <li><b>TV 노트북</b>: TV 화면 아래 <b>CAM</b> 버튼(또는 숫자 키 1~${Math.min(9,cams.length)}, 0은 끄기)으로 바꾼다. 「자동」은 선두 학급이 다음에 지나갈 카메라를 따라간다</li>
        </ol>
        <div class="cam-grid">${cams.map(c=>html`<${CamCard} key=${c.n} c=${c} room=${cfg.room}/>`)}</div>
        <p class="muted small">카메라 영상은 VDO.Ninja(무료 공개 서비스)로 휴대폰에서 TV로 바로 전달됩니다. 학교 와이파이에 따라 끊길 수 있어, 경기 전에 꼭 한 번 미리 연결해 보세요.</p>`}
    <//>
  </div>`;
}
/* ---------- TV 카메라 ---------- */
function CamView({n}){
  const c=cpList().find(x=>x.n===n);
  const [ready,setReady]=useState(false);
  useEffect(()=>{setReady(false);const t=setTimeout(()=>setReady(true),2500);return()=>clearTimeout(t);},[n]);
  return html`<div class="ltv-cam">
    <iframe key=${n} src=${camViewUrl(n)} allow="autoplay; fullscreen" title=${'CAM '+n}></iframe>
    <span class="ltv-cam-tag"><i></i>CAM ${n}${c?' · 약 '+cpMeters(c)+'m':''}</span>
    ${ready?null:html`<div class="ltv-cam-wait">CAM ${n} 연결 중…</div>`}
  </div>`;
}
/** TV 화면 아래 카메라 고르기. 이 TV 기기에만 저장된다. */
function useTvCam(){
  const [cam,setCam]=useLocal('tv.cam',null);
  const [auto,setAuto]=useLocal('tv.camAuto',false);
  return {cam,auto,setCam:n=>{setAuto(false);setCam(n);},setAuto:v=>{setAuto(v);if(v)setCam(null);}};
}
function CamCtl({tc,suggest}){
  useStore();
  const cams=camPoints();
  if(!cams.length) return null;
  return html`<span class="cam-ctl" role="group" aria-label="카메라">
    <button id="cam-off" aria-pressed=${String(!tc.cam&&!tc.auto)} onClick=${()=>tc.setCam(null)}>CAM 끔</button>
    ${cams.map((c,i)=>html`<button key=${c.n} id=${'cam-'+c.n} aria-pressed=${String(!tc.auto&&tc.cam===c.n)} class=${suggest===c.n?'sug':''} title=${(i<9?'숫자 '+(i+1)+' · ':'')+'약 '+cpMeters(c)+'m'} onClick=${()=>tc.setCam(c.n)}>CAM ${c.n}</button>`)}
    <button id="cam-auto" aria-pressed=${String(!!tc.auto)} onClick=${()=>tc.setAuto(!tc.auto)}>자동</button>
  </span>`;
}

// 대회 진행 순서: 준비(팀 · 선수 → 경기 일정) → 경기(경기 운영) → 결과 · 방송. '§'로 시작하면 메뉴의 구역 이름.
const NAV=[
  ['home','홈','home'],
  ['§prep','대회 준비'],['teams','팀 · 선수','users',true],['schedule','경기 일정','calendar'],['points','코스 지점 · 카메라','pin',true],
  ['§game','경기'],['ops','경기 운영','timer',true],['cp','지점 버튼','flag'],
  ['§result','결과 · 방송'],['standings','순위','trophy'],['broadcast','TV 송출','tv'],['sns','SNS','story'],
  ['§etc',''],['settings','설정','settings',true]
];
const EDIT_ONLY=new Set(['ops','teams','settings','camera','points']);
// 예전 경로(경기 관리 · 기록 관리 · TOP 10 · 종합 순위)는 새 화면으로 보낸다
const ROUTE_ALIAS={manage:'ops',records:'ops',scorers:'standings',setup:'settings',ranking:'standings',top10:'standings'};
const Bus={nav:null};
/** 레이저런 화면 안의 이동. 옛 이름도 받아 SDSMP 경로로 바꾼다. */
function navigate(r){
  const n=Bus.nav;
  if(!n) return;
  if(r==='tv'){n.tv();return;}
  if(r==='top10'||r==='scorers') LS.set('ui.rankView','top10');
  if(r==='ranking') LS.set('ui.rankView','all');
  n.go(ROUTE_ALIAS[r]||r);
}
const INFO={
  home:{title:'레이저런 리그 현황'},
  schedule:{eyebrow:'2 · Schedule',title:'경기 일정',desc:'조를 골라 경기를 만들고 날짜·시간을 정합니다. 지연·변경은 TV 안내 문구에 바로 반영됩니다.'},
  ops:{eyebrow:'3 · Match operations',title:'경기 운영',desc:'경기를 고르고 ① 사로 배정 → ② 명단 · 순서 확인 → ③ 실시간 계측 → ④ 서명 · 종료 순서로 진행합니다.'},
  standings:{eyebrow:'4 · Standings',title:'순위',desc:'TOP 10 보드와 학급 · 개인 · 남녀 · 학년별 전체 순위입니다. 기록이 들어오면 바로 바뀝니다.'},
  broadcast:{eyebrow:'TV broadcast',title:'TV 송출',desc:'학교 TV와 전자칠판에 코스 위 학급 로고와 실시간 순위, 다음 경기 안내를 보여 줍니다.'},
  teams:{eyebrow:'1 · Teams & players',title:'팀 · 선수',desc:'참가 반 → 참가자 명단 → 조 추첨 순서로 대회를 준비합니다. 풋살 명단과 따로 저장됩니다.'},
  settings:{eyebrow:'Settings',title:'설정',desc:'대회 정보, 경기 일정, 포스터, 페널티, 코스, TV 송출, 공개 범위를 관리합니다. 풋살 설정과 따로 저장됩니다.'},
  camera:{eyebrow:'Phone camera',title:'휴대폰 촬영 화면',desc:'경기 구간을 촬영해 TV로 보냅니다.'},
  points:{eyebrow:'Course points',title:'코스 지점 · 카메라',desc:'체육회 요원이 서는 코스 지점의 위치와 담당을 정하고, 스포츠기자단 휴대폰 카메라 링크(QR)를 만듭니다.'},
  cp:{eyebrow:'Checkpoint',title:'지점 버튼',desc:'선수가 내 지점을 지나는 순간 조끼 색 버튼을 누르면 TV 코스 위치와 순위에 바로 반영됩니다.'}
};
class Boundary extends Component{
  constructor(p){super(p);this.state={err:null};}
  componentDidCatch(e){console.error('laser',e);this.setState({err:e});}
  render(){
    if(this.state.err) return html`<div class="panel"><div class="empty" style="padding:48px 16px"><strong>레이저런 화면을 표시하지 못했습니다</strong>
      <span>풋살 기록과 레이저런 데이터는 그대로입니다. 다시 시도하거나 종목을 풋살로 바꿔 계속 사용할 수 있습니다.</span>
      <button class="btn btn-primary" style="margin-top:8px" onClick=${()=>this.setState({err:null})}>다시 시도</button></div></div>`;
    return this.props.children;
  }
}
function SyncBadge(){
  useStore();
  let cls='ok',txt='저장됨',tip='모든 기기에 실시간으로 공유됩니다.';
  if(SD.VIEWER){cls='';txt='둘러보기 · 저장 안 됨';tip='바꾼 내용은 이 창에만 있고, 새로고침하면 처음으로 돌아갑니다.';}
  else if(Store.mode==='init'||!Store.ready){cls='';txt='연결 중';tip='';}
  else if(Store.offline){cls='warn';txt='연결 끊김 · 재전송 대기';tip='입력한 기록은 기기에 보관되었다가 연결되면 전송됩니다.';}
  else if(Store.pendingCount){cls='';txt='저장 중';tip='';}
  return html`<span class="chip ${cls}" title=${tip}>${txt}</span>`;
}
function LiveLink(){
  useStore();
  const live=matchesSorted().find(m=>m.status==='live'&&(!sampleHidden()||!m.sample));
  if(!live) return null;
  return html`<button class="btn btn-live lr-live" onClick=${()=>{LS.set('ui.match',live.id);LS.set('ui.opsGo','live');navigate('ops');}}>
    ${live.title}
    <${LiveText} class="num" fn=${()=>{
      const m=Store.doc('matches',live.id);
      const rs=m?runsOfMatch(m).filter(r=>r.startedAt!=null):[];
      if(!rs.length) return '출발 전';
      const a=Math.min(...rs.map(r=>r.startedAt));
      return fmtCs(toCs(Math.max(0,Live.now()-a)*(rs[0].scale||1),CFG.settings().rounding));
    }}/>
  </button>`;
}
function SampleBanner(){
  useStore();
  if(!hasSample()||sampleHidden()) return null;
  return html`<div class="banner warn small lr-banner" role="note">
    <span class="chip chip-sample">예시</span>
    <span>${hasReal()?'실제 데이터와 예시 데이터를 함께 표시하고 있습니다.':'지금 보이는 학급·선수·기록은 연습용 예시입니다. 실제 경기를 등록하면 자동으로 숨겨집니다.'}</span>
    ${Store.canWrite()?html`<button class="linkish lr-banner-act" onClick=${()=>{LS.set('ui.teamsTab','class');navigate('teams');}}>실제 데이터 등록</button>`:null}
  </div>`;
}
function Pages({route}){
  if(route==='schedule') return html`<${SchedulePage}/>`;
  if(route==='ops') return html`<${OpsPage}/>`;
  if(route==='standings') return html`<${StandingsPage}/>`;
  if(route==='broadcast') return html`<${BroadcastPage}/>`;
  if(route==='sns') return html`<${LaserSnsPage}/>`;
  if(route==='teams') return html`<${TeamsPage}/>`;
  if(route==='settings') return html`<${SetupPage}/>`;
  if(route==='camera') return html`<${CameraPage}/>`;
  if(route==='points') return html`<${PointsPage}/>`;
  if(route==='cp') return html`<${CpPage}/>`;
  return html`<${HomePage}/>`;
}
function RootInner({route,nav,canEdit}){
  useStore();
  useEffect(()=>{Boot.ensure();},[]);
  Bus.nav=nav;
  if(ROUTE_ALIAS[route]){if(route==='scorers')LS.set('ui.rankView','top10');route=ROUTE_ALIAS[route];}
  const known=(route[0]!=='§'&&NAV.some(n=>n[0]===route))||route==='camera';
  const r=!known||(!canEdit&&EDIT_ONLY.has(route))?'home':route;
  const st=CFG.settings();
  const info=INFO[r]||{};
  if(r==='sns') return html`<div class="lr"><${Boundary}><${Pages} route=${r}/><//><${ConfirmHost}/></div>`;
  return html`<div class="lr">
    <${PAGES.PageHead} eyebrow=${info.eyebrow||st.eventName} title=${info.title} desc=${r==='home'?SD.fmtDateLong(todayStr()):info.desc}>
      ${canEdit?html`<${LiveLink}/><${SyncBadge}/>`:null}
      <button id="top-tv" class="btn btn-primary" onClick=${()=>navigate('tv')}>TV 화면</button>
    <//>
    ${canEdit&&!Flag.open&&!window.SD_LASER_ONLY?html`<div class="banner small lr-banner" role="note">
      <span class="chip">관리자만</span>
      <span>아직 편집 권한이 있는 계정에만 보입니다. 보기 전용 계정의 종목 선택에는 “준비 중”으로 표시됩니다. 풋살이 끝나면 설정에서 전체 공개할 수 있습니다.</span>
    </div>`:null}
    <${SampleBanner}/>
    ${Store.ready?html`<${Boundary}><${Pages} route=${r}/><//>`
      :html`<div class="panel"><div class="empty" style="padding:64px 16px"><strong>레이저런 데이터를 불러오는 중입니다</strong><span>${Store.slow?'연결이 늦어지고 있습니다. 네트워크를 확인해 주세요.':'잠시만 기다려 주세요.'}</span></div></div>`}
    <${ConfirmHost}/>
  </div>`;
}
function Root(p){
  const ok=useCss();
  if(!ok) return html`<div class="empty" style="padding:80px 16px"><strong>레이저런 화면을 불러오는 중입니다</strong></div>`;
  return html`<${RootInner} ...${p}/>`;
}
function TV(p){
  const ok=useCss();
  useEffect(()=>{Boot.ensure();},[]);
  if(!ok) return html`<div class="tv"></div>`;
  return html`<${Boundary}><${LaserTVInner} ...${p}/><//>`;
}

window.LASER={
  id:'__laserrun',
  attach:db=>Flag.attach(db),
  visible:canEdit=>!!canEdit||Flag.open,
  // 보기 전용 계정에는 편집 메뉴를 빼고, 아래에 메뉴가 하나도 없는 구역 이름도 뺀다
  nav:canEdit=>{const l=NAV.filter(n=>canEdit||!n[3]);return l.filter((n,i)=>n[0][0]!=='§'||(l[i+1]&&l[i+1][0][0]!=='§')).map(n=>[n[0],n[1],n[2]]);},
  routes:[...NAV.map(n=>n[0]).filter(r=>r[0]!=='§'),'camera'],
  liveCount:()=>Boot.started?liveCount():0,
  Root,
  TV
};

})();
