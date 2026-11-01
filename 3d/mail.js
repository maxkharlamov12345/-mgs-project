/* Переписка по позиции «как почта» — общее для CRM дилера (crm.html) и кабинета фабрики (factory.html).
   Данные — функции базы (server/migrations/005_factory.sql): mail_list, mail_send, mail_approve, factory_step.
   Файлы — бакет crm: файлы карточки клиента (<client>/<uuid>.ext) или вложения писем (mail/<позиция>/<uuid>.ext). */
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money=v=>v==null||v===''?'':Math.round(+v).toLocaleString('ru-RU').replace(/\s/g,' ')+' ₽';
export const dmy=d=>{if(!d)return '';const x=new Date(String(d).length===10?d+'T00:00:00':d);return x.toLocaleDateString('ru-RU');};
export const dm=d=>{if(!d)return '';const x=new Date(String(d).length===10?d+'T00:00:00':d);return x.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});};
export const when=d=>{const x=new Date(d);return x.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})+' · '+x.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});};
export const initials=n=>String(n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
export const isImg=m=>/^image\//.test(m||'');
const plural=(n,a,b,c)=>{const m=n%10,h=n%100;return m===1&&h!==11?a:m>=2&&m<=4&&(h<12||h>14)?b:c;};
export {plural};

export const COMPANIES=['ООО «Мебельный Завод»','ИП Михайлов Г. А.'];
export const FSTAGES=['Новые','Заказ заведён','У технолога','На согласовании у дилера','В производстве'];
export const LABELS={new:'Новый заказ',opened:'Заказ заведён',tech:'Передан технологу',approval:'На согласование',approved:'Согласовано',production:'В производстве',back:'Возвращено'};
const ROWK={num:'№ заказа фабрики',price:'Предв. стоимость',ready:'Готовность'};
const rowV=(k,v)=>v==null||v===''?'—':k==='price'?money(v):k==='ready'?dmy(v):String(v);

/* сколько времени: «2 часа назад» / «2 часа» */
export function ago(d,suffix=true){
  if(!d)return '';const s=Math.max(0,(Date.now()-new Date(d))/1000);
  let t;if(s<90)return suffix?'только что':'меньше минуты';
  if(s<3600){const n=Math.round(s/60);t=`${n} минут${plural(n,'у','ы','')}`;}
  else if(s<86400){const n=Math.round(s/3600);t=`${n} час${plural(n,'','а','ов')}`;}
  else{const n=Math.floor(s/86400);t=`${n} ${plural(n,'день','дня','дней')}`;}
  return suffix?t+' назад':t;
}
/* плитка «этап / сколько» для доски фабрики */
export function stageTile(p){
  const k=p.fstage??0;
  const lbl=['Отправлен','Заведён','У технолога','На согласовании','В производстве'][k];
  return {label:lbl,value:ago(p.fstage_at||p.sent_at,k<2)};
}

/* ---------- подписанные ссылки ---------- */
const urls=new Map();
export async function signed(sb,paths){
  const need=[...new Set(paths.filter(p=>p&&!urls.has(p)))];
  if(need.length){const {data}=await sb.storage.from('crm').createSignedUrls(need,3600);(data||[]).forEach(d=>d.signedUrl&&urls.set(d.path,d.signedUrl));}
}
export const surl=p=>urls.get(p)||'';

/* ---------- письмо ---------- */
function fileTile(f,i){
  const ext=(String(f.name).split('.').pop()||'').slice(0,5).toUpperCase();
  const img=f.path&&isImg(f.mime);
  return `<a href="#" class="mfile" data-mf="${i}" ${img?`data-mimg="${esc(f.path)}"`:''} title="${esc(f.name)}">
    <span class="mth">${f.url?'ССЫЛКА':img?'':esc(ext||'ФАЙЛ')}</span><span class="mfn">${esc(f.name)}</span></a>`;
}
/* m — письмо; me — сторона смотрящего ('dealer'|'factory'); ctx — {toDealer, toFactory, approve:boolean} */
export function mailHtml(m,me,ctx={}){
  const lbl=LABELS[m.label]||'';
  const role=m.side==='dealer'?'дилер':'менеджер фабрики';
  const to=m.side==='dealer'?(ctx.toFactory||'фабрика'):(ctx.toDealer||'дилер');
  const subj=m.subject&&m.subject!==lbl?`<span class="msubj">${esc(m.subject)}</span>`:'';
  const rows=(m.rows||[]).length?`<div class="mrows">${m.rows.map(r=>`<div><span>${ROWK[r.k]||esc(r.k)}</span><b class="num">${esc(rowV(r.k,r.v))}${r.old!=null?`<s>${esc(rowV(r.k,r.old))}</s>`:''}</b></div>`).join('')}</div>`:'';
  const files=(m.files||[]).length?`<div class="mfiles">${m.files.map(fileTile).join('')}</div>`:'';
  return `<article class="mail ${lbl?'act':''} ${m.side===me?'mine':''}" data-mail="${m.id}">
    <div class="mh"><span class="mav">${esc(initials(m.author))}</span>
      <div class="mwho"><b>${esc(m.author)}</b> <span>· ${role}</span><div class="mto">кому: ${esc(to)}</div></div>
      <span class="mwhen num">${when(m.created_at)}</span></div>
    <div class="mb">${lbl||subj?`<div class="mline">${lbl?`<span class="mtag">${lbl}</span>`:''}${subj}</div>`:''}
      ${m.body?`<div class="mtext">${esc(m.body)}</div>`:''}${rows}${files}
      ${ctx.approve?`<div class="mappr"><button class="pill lime" data-approve>✓ Согласовать</button><span class="msg">Если нужны правки — ответьте письмом</span></div>`:''}</div>
  </article>`;
}
/* после вставки в DOM: картинки и открытие файлов */
export async function wireMails(sb,root,mails){
  const imgs=[...root.querySelectorAll('[data-mimg]')];
  await signed(sb,imgs.map(e=>e.dataset.mimg));
  imgs.forEach(e=>{const u=surl(e.dataset.mimg);if(u)e.querySelector('.mth').style.backgroundImage=`url("${u}")`;});
  root.querySelectorAll('[data-mail]').forEach(art=>{
    const m=mails.find(x=>x.id===art.dataset.mail);if(!m)return;
    art.querySelectorAll('[data-mf]').forEach(a=>a.onclick=async e=>{e.preventDefault();const f=m.files[+a.dataset.mf];
      if(f.url)return window.open(f.url,'_blank','noopener');
      await signed(sb,[f.path]);const u=surl(f.path);if(u)window.open(u,'_blank','noopener');});
  });
}
/* нужна ли кнопка «Согласовать» (дилер, последнее письмо «На согласование», ещё не согласовано) */
export function approveId(mails,pos){
  if(pos?.fstage!==3)return null;
  let last=null,ok=false;for(const m of mails){if(m.label==='approval'){last=m.id;ok=false;}if(m.label==='approved')ok=true;}
  return ok?null:last;
}

/* ---------- вложения ---------- */
export function shrink(file){return new Promise(res=>{if(!/^image\/(jpeg|png|webp)$/.test(file.type))return res(file);
  const img=new Image();img.onload=()=>{const k=Math.min(1,2000/Math.max(img.naturalWidth,img.naturalHeight));
    if(k===1&&file.size<1.5e6){URL.revokeObjectURL(img.src);return res(file);}
    const cv=document.createElement('canvas');cv.width=Math.round(img.naturalWidth*k);cv.height=Math.round(img.naturalHeight*k);
    cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);URL.revokeObjectURL(img.src);
    cv.toBlob(b=>res(b?new File([b],file.name.replace(/\.\w+$/,'')+'.jpg',{type:'image/jpeg'}):file),'image/jpeg',.85);};
  img.onerror=()=>res(file);img.src=URL.createObjectURL(file);});}
export async function uploadMailFiles(sb,pid,files,onProgress){
  const out=[];
  for(let i=0;i<files.length;i++){
    onProgress&&onProgress(i,files.length);
    const f=await shrink(files[i]);const ext=(f.name.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8)||'bin';
    const path=`mail/${pid}/${crypto.randomUUID()}.${ext}`;
    const up=await sb.storage.from('crm').upload(path,f,{contentType:f.type||'application/octet-stream'});
    if(up.error)throw new Error('Не загрузилось: '+files[i].name+' — '+up.error.message);
    out.push({name:files[i].name,path,mime:f.type||'',size:f.size});
  }
  return out;
}
export function askLink(){
  const url=(prompt('Ссылка (например, на файл Базис)')||'').trim();if(!url)return null;
  const u=/^https?:\/\//i.test(url)?url:'https://'+url;
  const name=(prompt('Как подписать ссылку?','Проект Базис')||'').trim()||'Ссылка';
  return {name,url:u};
}
/* плашки вложений в черновике */
export function draftFilesHtml(files){
  return files.length?`<div class="dfiles">${files.map((f,i)=>`<span class="dfile">${f.url?'<i>ссылка</i> ':''}${esc(f.name)}<button type="button" data-dx="${i}" aria-label="Убрать ${esc(f.name)}">×</button></span>`).join('')}</div>`:'';
}
/* текст ошибки базы — по-человечески */
export const errText=e=>{const m=String(e?.message||e||'');return m.replace(/^.*?ERROR:\s*/,'')||'Ошибка';};
