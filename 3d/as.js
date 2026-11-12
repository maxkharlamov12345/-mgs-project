/* «Войти как» (Макс 12.11): главный быстро переключается на любого сотрудника (менеджер, админ салонов, фабрика)
   и видит систему с его правами по-настоящему (вход в базу от имени сотрудника), потом возвращается к себе.
   Подключается одной строкой на страницах кабинета, CRM и фабрики: <script type="module" src="as.js"></script>.
   Сервер: POST /admin/v1/impersonate/<id> (только главный) → token_hash → sb.auth.verifyOtp.
   Сессия главного на время режима хранится в localStorage 'mgs-as' (как и обычная сессия — в этом браузере). */
import {sb} from './db.js';
import {SUPABASE_URL,SUPABASE_KEY} from './config.js';

const KEY='mgs-as';
const ROLE={owner:'главный',admin:'админ салонов',manager:'менеджер',factory:'фабрика'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials=n=>String(n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
const get=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null');}catch{return null;}};
const put=v=>{try{v?localStorage.setItem(KEY,JSON.stringify(v)):localStorage.removeItem(KEY);}catch{}};
const page=()=>location.pathname.split('/').pop()||'index.html';
const home=role=>role==='factory'?'factory.html':page()==='factory.html'?'crm.html':page();
let role=null;   // роль текущего входа (с сервера)

async function api(method,path,token){
  const r=await fetch(SUPABASE_URL+'/admin/v1'+path,{method,headers:{Authorization:'Bearer '+token}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||('Ошибка '+r.status));
  return d;
}
/* свежий токен главного, НЕ трогая сессию страницы (в браузере в это время может быть сотрудник) */
const expSoon=t=>{try{return JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).exp*1000<Date.now()+60000;}catch{return true;}};
async function ownerToken(st){
  if(st.owner.access_token&&!expSoon(st.owner.access_token))return st.owner.access_token;
  const r=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',
    headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:st.owner.refresh_token})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.access_token){put(null);throw new Error('Вход главного истёк — войдите заново своим паролем');}
  st.owner.access_token=d.access_token;st.owner.refresh_token=d.refresh_token;put(st);
  return d.access_token;
}
/* кто главный в этом режиме: из хранилища или текущий вход */
async function ownerState(){
  const st=get();if(st?.owner)return {st,token:await ownerToken(st)};
  const s=(await sb.auth.getSession()).data.session;if(!s)throw new Error('Нужно войти');
  return {st:{owner:{id:s.user.id,email:s.user.email,access_token:s.access_token,refresh_token:s.refresh_token}},token:s.access_token};
}
async function switchTo(u){
  const {st,token}=await ownerState();
  if(u.id===st.owner.id)return back();
  const r=await api('POST','/impersonate/'+u.id,token);
  const prev=get();
  if(!prev){const s=(await sb.auth.getSession()).data.session;st.owner.access_token=s.access_token;st.owner.refresh_token=s.refresh_token;}
  st.as={id:u.id,name:u.name||u.email,role:u.role};put(st);           // сохранить главного ДО смены сессии
  let {error}=await sb.auth.verifyOtp({token_hash:r.token_hash,type:r.type||'magiclink'});
  if(error&&(r.type||'magiclink')!=='email')({error}=await sb.auth.verifyOtp({token_hash:r.token_hash,type:'email'}));
  if(error){put(prev);throw new Error('Не удалось войти: '+error.message);}   // сессия в браузере не сменилась
  location.href=home(u.role);
}
export async function back(){
  const st=get();if(!st)return;
  try{await ownerToken(st);
    const {error}=await sb.auth.setSession({access_token:st.owner.access_token,refresh_token:st.owner.refresh_token});
    if(error)throw new Error('Вход главного истёк — войдите заново своим паролем');
    put(null);location.href=home('owner');}
  catch(e){put(null);alert(e.message);await sb.auth.signOut({scope:'local'});location.reload();}
}

/* ---------- окно выбора сотрудника ---------- */
const CSS=`
.as-pill{position:fixed;left:50%;bottom:max(14px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:6px;
  max-width:calc(100vw - 24px);padding:6px 6px 6px 14px;border-radius:999px;background:#1d1c0f;border:1px solid #bfd630;color:#f4f1ec;font:500 13px/1.2 Onest,system-ui,sans-serif;
  box-shadow:0 8px 30px rgba(0,0,0,.5)}
.as-pill .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.as-pill .t b{color:#bfd630;font-weight:600}
.as-pill button{all:unset;cursor:pointer;flex:0 0 auto;height:30px;padding:0 12px;border-radius:999px;background:#2b2a1a;font-weight:600;white-space:nowrap}
.as-pill button.home{background:#bfd630;color:#151311}
.as-pill button:focus-visible{outline:2px solid #bfd630;outline-offset:2px}
.as-dlg{border:0;padding:0;border-radius:22px;background:#151311;color:#f4f1ec;width:min(520px,calc(100vw - 24px));max-height:min(720px,calc(100vh - 40px));font-family:Onest,system-ui,sans-serif}
.as-dlg::backdrop{background:rgba(0,0,0,.6)}
.as-dlg .in{display:flex;flex-direction:column;gap:12px;padding:20px;max-height:inherit;box-sizing:border-box}
.as-dlg h2{margin:0;font-size:20px;font-weight:600}
.as-dlg .sub{color:#9b968d;font-size:13px}
.as-dlg input{all:unset;box-sizing:border-box;height:42px;padding:0 14px;border-radius:999px;background:#201e1a;font-size:15px}
.as-dlg .ls{overflow:auto;display:flex;flex-direction:column;gap:2px;min-height:0;margin:0 -6px}
.as-dlg .g{color:#9b968d;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:10px 8px 4px}
.as-dlg .u{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:12px;padding:8px;border-radius:14px}
.as-dlg .u:hover,.as-dlg .u:focus-visible{background:#201e1a}
.as-dlg .u[aria-current]{outline:1px solid #bfd630}
.as-dlg .u .av{display:grid;flex:0 0 36px;height:36px;border-radius:50%;background:#2a2723 center/cover;display:grid;place-items:center;font-size:13px;font-weight:600;color:#cfcac2}
.as-dlg .u b{display:block;font-weight:500;font-size:15px}
.as-dlg .u span{display:block;color:#9b968d;font-size:12.5px}
.as-dlg .acts{display:flex;justify-content:space-between;align-items:center;gap:8px}
.as-dlg .acts button{all:unset;cursor:pointer;height:40px;padding:0 18px;border-radius:999px;background:#201e1a;font-weight:600}
.as-dlg .err{color:#ff8a7a;font-size:13px}
.as-btn-menu{display:block;width:100%}`;
function style(){if(document.getElementById('as-css'))return;const s=document.createElement('style');s.id='as-css';s.textContent=CSS;document.head.appendChild(s);}

export async function pick(){
  style();
  let d=document.getElementById('as-dlg');
  if(!d){d=document.createElement('dialog');d.id='as-dlg';d.className='as-dlg';document.body.appendChild(d);}
  d.innerHTML=`<div class="in"><div><h2>Войти как сотрудник</h2><div class="sub">Система откроется с его правами. Вернуться к себе — кнопкой внизу экрана.</div></div>
    <input type="search" placeholder="Имя, салон, почта" aria-label="Поиск сотрудника"><div class="ls"><div class="sub">Загружаем…</div></div>
    <div class="err"></div><div class="acts"><span></span><button type="button" data-x>Закрыть</button></div></div>`;
  d.querySelector('[data-x]').onclick=()=>d.close();
  d.showModal();
  const ls=d.querySelector('.ls'),err=d.querySelector('.err'),q=d.querySelector('input');
  let users=[],salons={};
  try{
    const {token}=await ownerState();
    const [u,sl]=await Promise.all([api('GET','/staff',token),sb.from('salons').select('id,name')]);
    users=u.filter(x=>!x.disabled);(sl.data||[]).forEach(x=>salons[x.id]=x.name);
  }catch(e){ls.innerHTML='';err.textContent=e.message;return;}
  const cur=get()?.as?.id;
  const paint=()=>{
    const t=q.value.trim().toLowerCase();
    const f=users.filter(u=>(u.role!=='owner'||cur)&&(!t||[u.name,u.email,salons[u.salon_id]].some(x=>String(x||'').toLowerCase().includes(t))));
    const groups=[['owner','Вы'],['factory','Фабрика'],['admin','Администраторы салонов'],['manager','Менеджеры']];
    ls.innerHTML=groups.map(([r,l])=>{const g=f.filter(u=>u.role===r);if(!g.length)return '';
      return `<div class="g">${l}</div>`+g.map(u=>`<button type="button" class="u" data-u="${u.id}" ${u.id===cur?'aria-current="true"':''}>
        <span class="av" style="${u.photo?`background-image:url('${SUPABASE_URL}/storage/v1/object/public/media/${esc(u.photo)}')`:''}">${u.photo?'':esc(initials(u.name||u.email))}</span>
        <span style="min-width:0"><b>${esc(u.name||u.email)}${r==='owner'?' — вернуться к себе':''}</b><span>${esc([ROLE[u.role],salons[u.salon_id],u.email].filter(Boolean).join(' · '))}</span></span></button>`).join('');}).join('')
      ||'<div class="sub">Никого не нашли.</div>';
    ls.querySelectorAll('[data-u]').forEach(b=>b.onclick=async()=>{const u=users.find(x=>x.id===b.dataset.u);err.textContent='';
      b.querySelector('b').textContent='Входим…';
      try{if(u.role==='owner'){if(get())await back();else d.close();}else await switchTo(u);}catch(e){err.textContent=e.message;paint();}});
  };
  q.oninput=paint;paint();q.focus();
}

/* ---------- плашка и пункты меню ---------- */
function pill(st){
  style();let p=document.getElementById('as-pill');
  if(!p){p=document.createElement('div');p.id='as-pill';p.className='as-pill';p.setAttribute('role','status');document.body.appendChild(p);}
  p.innerHTML=`<span class="t">Вы как <b>${esc(st.as.name)}</b> · ${esc(ROLE[st.as.role]||'')}</span><button type="button" data-sw>Сменить</button><button type="button" class="home" data-home>Вернуться к себе</button>`;
  p.querySelector('[data-sw]').onclick=()=>pick();
  p.querySelector('[data-home]').onclick=()=>back();
  if(!document.title.startsWith('['))document.title=`[${st.as.name}] `+document.title;
}
function entry(show){
  let b=document.getElementById('as-entry');
  const lo=document.getElementById('logout');if(!lo)return;
  if(!b){
    b=document.createElement('button');b.id='as-entry';b.type='button';b.textContent='Войти как…';
    if(lo.getAttribute('role')==='menuitem'){b.setAttribute('role','menuitem');b.className=lo.className;}
    else{b.className=lo.className;b.title='Войти как сотрудник (менеджер, админ, фабрика)';}
    b.onclick=()=>{document.getElementById('menu')&&(document.getElementById('menu').hidden=true);pick();};
    lo.parentNode.insertBefore(b,lo);
    if(lo.getAttribute('role')!=='menuitem')new MutationObserver(()=>b.hidden=!b.dataset.ok||lo.hidden).observe(lo,{attributes:true,attributeFilter:['hidden']});
  }
  b.dataset.ok=show?'1':'';b.hidden=!show||(lo.getAttribute('role')!=='menuitem'&&lo.hidden);
}
async function refresh(){
  const s=(await sb.auth.getSession()).data.session;const st=get();
  if(!s){document.getElementById('as-pill')?.remove();entry(false);return;}
  if(st&&s.user.id===st.as?.id){pill(st);entry(true);return;}
  if(st&&s.user.id!==st.as?.id)put(null);            // вернулись к себе или вошли заново
  document.getElementById('as-pill')?.remove();
  try{role=(await api('GET','/me',s.access_token)).role;}catch{role=null;}
  entry(role==='owner');
}
/* «Выйти» в режиме «как сотрудник» = вернуться к себе (обычный выход закрыл бы сессии настоящего сотрудника) */
document.addEventListener('click',e=>{
  if(!e.target.closest?.('#logout'))return;
  const st=get();if(!st?.as)return;
  e.preventDefault();e.stopImmediatePropagation();back();
},true);

if(sb){
  window.MGSAS={pick,back};
  sb.auth.onAuthStateChange(ev=>{if(ev==='SIGNED_IN'||ev==='SIGNED_OUT')setTimeout(refresh,0);});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh);else refresh();
}
