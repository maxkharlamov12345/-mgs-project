
import * as THREE from 'three';
import {OrbitControls} from './lib/OrbitControls.js';
import {OBJLoader} from './lib/OBJLoader.js';
import {MTLLoader} from './lib/MTLLoader.js';
import {GLTFLoader} from './lib/GLTFLoader.js';
import {MeshoptDecoder} from './lib/meshopt_decoder.module.js';
import {CSS2DRenderer,CSS2DObject} from './lib/CSS2DRenderer.js';
import {mergeGeometries} from './lib/BufferGeometryUtils.js';

const $=s=>document.querySelector(s);
const stage=$('#stage');
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);
const labelR=new CSS2DRenderer({element:$('#labels')});
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(35,1,10,200000);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;
const hemi=new THREE.HemisphereLight(0xffffff,0x555555,2.6);scene.add(hemi);
const sun=new THREE.DirectionalLight(0xffffff,1.9);sun.position.set(1,1.6,1.2);scene.add(sun);
const fill=new THREE.DirectionalLight(0xffffff,.9);fill.position.set(-1,.4,-.8);scene.add(fill);

let model=null, dimGroups={}, info=null, frontDir=new THREE.Vector3(0,0,1), selected=null;
const vis={overall:true,gaps:true,drawers:true,manual:true};
/* Размеры на сайте — только те, что менеджер поставил в PRO100 (плагин «Размеры MGS», файл mgs-dims.json).
   Автоматические (по геометрии) выключены по решению Макса 30.10; вернуть — AUTO_DIMS=true. */
const AUTO_DIMS=false;
let manualDims=null;

// шапка с кнопками закрывает верх экрана — центр кадра смещаем вниз на её половину (модель не уезжает под кнопки)
function topH(){const t=document.getElementById('top');return t&&!t.hidden?Math.min(t.getBoundingClientRect().height,innerHeight*.4):0;}
function resize(){const w=innerWidth,h=innerHeight;renderer.setSize(w,h);labelR.setSize(w,h);camera.aspect=w/h;
  const hh=topH();if(hh>0)camera.setViewOffset(w,h,0,-hh/2,w,h);else camera.clearViewOffset();camera.updateProjectionMatrix();
  if(typeof real!=='undefined'&&real){real.composer.setSize(w,h);real.dirty=6;}}
addEventListener('resize',resize);resize();
let _lastT=performance.now();
(function loop(){requestAnimationFrame(loop);const _now=performance.now(),_dt=Math.min(100,_now-_lastT);_lastT=_now;controls.update();if(typeof updateMovers==='function')updateMovers(_dt);if(typeof updateLabels==='function')updateLabels();if(typeof realFrame==='function'&&realFrame()){}else renderer.render(scene,camera);labelR.render(scene,camera);})();

function status(t){const s=$('#status');if(!s)return;if(!t){s.hidden=true;return;}s.textContent=t;s.hidden=false;}

/* ---------- loading ---------- */
const base=n=>decodeURIComponent(String(n)).replace(/\\/g,'/').split('/').filter(Boolean).pop().toLowerCase();
// текст файла; сжатые (gz) — распаковываем в браузере
// загрузка с процентами (если сервер сообщил размер)
async function fetchBody(f,label){
  const r=await fetch(f.url);if(!r.ok)throw new Error('Файл модели не загрузился ('+r.status+')');
  const total=+r.headers.get('content-length')||f.size||0;
  if(!label||!r.body||!total)return r;
  let got=0;const rd=r.body.getReader();
  const s=new ReadableStream({async pull(c){const {done,value}=await rd.read();if(done){c.close();return;}
    got+=value.length;status(`${label}… ${Math.min(99,Math.round(got/total*100))}%`);c.enqueue(value);}});
  return new Response(s);
}
async function getText(f,label){
  const r=await fetchBody(f,label);
  if(!f.gz)return r.text();
  if(typeof DecompressionStream==='undefined')throw new Error('Браузер слишком старый для этой модели — обновите его.');
  return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text();
}
/* лёгкая модель с сервера (GLB: сжатая геометрия, текстуры до 1024 px) — грузится в разы быстрее OBJ */
async function loadGlb(glb,files,title){
  status('Загружаем модель…');
  const buf=await (await fetchBody(glb,'Загружаем модель')).arrayBuffer();
  status('Открываем модель…');
  const gl=new GLTFLoader();gl.setMeshoptDecoder(MeshoptDecoder);
  const g=await new Promise((ok,bad)=>gl.parse(buf,'',ok,bad));
  const obj=g.scene;
  obj.traverse(o=>{if(!o.isMesh)return;(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{if(!m)return;m.side=THREE.DoubleSide;if(m.metalness>0.3)m.metalness=0.1;});});
  manualDims=null;
  if(files&&files.has('mgs-dims.json')){try{manualDims=JSON.parse(await getText(files.get('mgs-dims.json')));}catch(e){console.warn('mgs-dims.json',e);}}
  setModel(obj,title);
  status('');
}
async function loadFromMap(files,title){ // files: Map basename -> {url, text?}
  const objKey=[...files.keys()].find(k=>k.endsWith('.obj'));
  if(!objKey){status('В выбранных файлах нет .obj. Сделайте в PRO100 экспорт в OBJ и выберите его.');return;}
  status('Загружаем модель…');
  const mgr=new THREE.LoadingManager();
  mgr.setURLModifier(u=>{const f=files.get(base(u));return f?f.url:u;});
  const objText=await getText(files.get(objKey),'Загружаем модель');
  const m=objText.match(/^mtllib\s+(.+)$/m);
  let mats=null;
  const mtlKey=m&&files.has(base(m[1].trim()))?base(m[1].trim()):[...files.keys()].find(k=>k.endsWith('.mtl'));
  if(mtlKey){
    const mtlText=await getText(files.get(mtlKey));
    const ml=new MTLLoader(mgr);ml.setMaterialOptions({side:THREE.DoubleSide});
    mats=ml.parse(mtlText,'');mats.preload();
  }
  const ol=new OBJLoader(mgr);if(mats)ol.setMaterials(mats);
  const obj=ol.parse(objText);
  manualDims=null;
  if(files.has('mgs-dims.json')){try{manualDims=JSON.parse(await getText(files.get('mgs-dims.json')));}catch(e){console.warn('mgs-dims.json',e);}}
  setModel(obj,title||objKey.replace(/\.obj$/,''));
  status('');
}

function setModel(obj,title){
  if(model){scene.remove(model);}
  (movers||[]).forEach(m=>scene.remove(m.pivot));movers=[];clearBatches();
  Object.values(dimGroups).forEach(g=>{scene.remove(g);g.traverse(o=>{if(o.isMesh&&o.material.map){o.material.map.dispose();o.material.dispose();}o.geometry&&o.geometry.dispose();});});dimGroups={};clearSel();
  partInfo(null);
  // units: PRO100 OBJ is in metres -> work in mm
  const pre=new THREE.Box3().setFromObject(obj);const sz=pre.getSize(new THREE.Vector3());
  if(Math.max(sz.x,sz.y,sz.z)<60)obj.scale.setScalar(1000);
  obj.updateMatrixWorld(true);
  model=obj;scene.add(obj);
  info=analyze(obj);
  buildMovers(info);syncOpenBtn();buildBatches();
  setFronts(false,true);applyMode();
  resize();fitView('persp');
  const I=info;
  (document.fonts&&document.fonts.load?document.fonts.load('600 96px Onest').catch(()=>{}):Promise.resolve()).then(()=>{if(info===I)buildDims(I);});
}

/* ---------- analysis ---------- */
const RX_METIZ=/(саморез|евровинт|конфирмат|шкант|эксцентрик|минификс|шуруп|гвоздь|винт|^зазор|_зазор)/i;
const RX_HW=/(опора|штанг|флянец|фланец|push|ручк|петл|направля|кромка|подсвет|led)/i;
function analyze(root){
  const parts=[];
  root.traverse(o=>{
    if(!o.isMesh)return;
    const g=o.geometry;const pos=g.attributes.position;if(!pos||pos.count===0){o.visible=false;return;}
    g.computeBoundingBox();
    const box=g.boundingBox.clone().applyMatrix4(o.matrixWorld);
    const s=box.getSize(new THREE.Vector3());
    const label=(o.name||'').replace(/^\d+_/,'').trim();
    const tris=pos.count/3;
    const p={mesh:o,label,box,s,tris};
    // tidy materials: PRO100 writes edge-band textures with d=0.1
    (Array.isArray(o.material)?o.material:[o.material]).forEach(mt=>{
      if(!mt)return; if(mt.map){mt.map.colorSpace=THREE.SRGBColorSpace;}
      if(mt.opacity<=0.15&&mt.map){mt.opacity=1;mt.transparent=false;}
    });
    if(tris<=2&&Math.min(s.x,s.y,s.z)<0.5&&Math.max(s.x,s.y,s.z)<0.5){p.kind='marker';o.visible=false;}
    else if(tris<=2&&(s.x<0.5?1:0)+(s.y<0.5?1:0)+(s.z<0.5?1:0)>=2){p.kind='marker';o.visible=false;}
    else if(RX_METIZ.test(label)){p.kind='metiz';o.visible=false;}
    else if(RX_HW.test(label)){p.kind='hw';}
    else{
      const d=[s.x,s.y,s.z];const order=[0,1,2].sort((a,b)=>d[a]-d[b]);
      if(d[order[0]]>=2&&d[order[0]]<=45&&d[order[1]]>=40){p.kind='board';p.thin=order[0];p.th=d[order[0]];}
      else p.kind='other';
    }
    parts.push(p);
  });
  // edge bands: PRO100 paints them with a red marker texture; give them the panel's own material
  const boards=parts.filter(p=>p.kind==='board');
  parts.filter(p=>/кромка/i.test(p.label)).forEach(e=>{
    const c=e.box.getCenter(new THREE.Vector3());
    // своя деталь: кромка лежит на её торце и по ширине равна её толщине (иначе кромка фасада «прилипала» к боковине рядом)
    const es=e.box.getSize(new THREE.Vector3()),ev=[es.x,es.y,es.z];let host=null,best=1e9;
    for(const b of boards){
      const bx=b.box.clone().expandByScalar(3);if(!bx.containsPoint(c))continue;
      const sc=Math.abs(ev[b.thin]-b.th)+b.box.distanceToPoint(c);
      if(sc<best){best=sc;host=b;}
    }
    if(host){e.host=host;e.mesh.material=host.mesh.material;}
    else{(Array.isArray(e.mesh.material)?e.mesh.material:[e.mesh.material]).forEach(m=>{if(m){m.map=null;m.color.set(0x8a7a66);m.needsUpdate=true;}});}
  });
  // room from markers (PRO100 writes axis markers when "add walls" is on)
  let room=null;const mk=parts.filter(p=>p.kind==='marker');
  if(mk.length){room=new THREE.Box3();mk.forEach(p=>room.union(p.box));if(room.getSize(new THREE.Vector3()).length()<500)room=null;}
  const overall=new THREE.Box3();parts.filter(p=>p.kind!=='marker'&&p.kind!=='metiz').forEach(p=>overall.union(p.box));

  const ax=['x','y','z'];
  const frontOf=(b)=>{ // returns {axis:'x'|'z', sign}
    if(room){
      const c=[{a:'x',s:-1,d:b.min.x-room.min.x},{a:'x',s:1,d:room.max.x-b.max.x},{a:'z',s:-1,d:b.min.z-room.min.z},{a:'z',s:1,d:room.max.z-b.max.z}];
      c.sort((p,q)=>p.d-q.d);const back=c[0];return {axis:back.a,sign:-back.s};
    }
    return {axis:'z',sign:1};
  };

  // columns: stacks of horizontal boards with the same footprint
  const hz=parts.filter(p=>p.kind==='board'&&p.thin===1&&p.th>=10&&p.s.x*p.s.z>=180*200);
  const fp=p=>({x0:p.box.min.x,x1:p.box.max.x,z0:p.box.min.z,z1:p.box.max.z});
  const area=f=>(f.x1-f.x0)*(f.z1-f.z0);
  const inter=(a,b)=>Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.z1,b.z1)-Math.max(a.z0,b.z0));
  const cols=[];
  hz.slice().sort((a,b)=>area(fp(b))-area(fp(a))).forEach(p=>{
    const f=fp(p);
    let best=null,bs=0;
    for(const c of cols){const i=inter(c.f,f);const sc=i/Math.min(area(c.f),area(f));const ratio=Math.min(area(c.f),area(f))/Math.max(area(c.f),area(f));
      if(sc>0.75&&ratio>0.55&&sc>bs){best=c;bs=sc;}}
    if(best){best.items.push(p);}
    else cols.push({f:{...f},items:[p]});
  });
  const columns=[];
  for(const c of cols){
    if(c.items.length<2)continue;
    // footprint = median-ish: use boards with largest area
    const f={x0:Infinity,x1:-Infinity,z0:Infinity,z1:-Infinity};
    c.items.forEach(p=>{const q=fp(p);f.x0=Math.min(f.x0,q.x0);f.x1=Math.max(f.x1,q.x1);f.z0=Math.min(f.z0,q.z0);f.z1=Math.max(f.z1,q.z1);});
    const fb=new THREE.Box3(new THREE.Vector3(f.x0,0,f.z0),new THREE.Vector3(f.x1,1,f.z1));
    const front=frontOf(fb);
    const W=front.axis==='z'?'x':'z';
    const colW=W==='x'?f.x1-f.x0:f.z1-f.z0;
    // typical shelf size along width / depth (mode of board sizes)
    const shelfW=Math.max(...c.items.map(p=>p.s[W]));
    const shelfD=Math.max(...c.items.map(p=>p.s[front.axis]));
    // drawers: vertical boards facing front, low height, wide, inside footprint
    const tol=45;
    const inside=p=>p.box.min.x>=f.x0-tol&&p.box.max.x<=f.x1+tol&&p.box.min.z>=f.z0-tol&&p.box.max.z<=f.z1+tol;
    const yTop=Math.max(...c.items.map(p=>p.box.max.y)),yBot=Math.min(...c.items.map(p=>p.box.min.y));
    const fronts=parts.filter(p=>p.kind==='board'&&ax[p.thin]===front.axis&&p.s.y>=60&&p.s.y<=450&&p.s[W]>=0.6*colW&&inside(p)&&p.box.min.y>=yBot-5&&p.box.max.y<=yTop+5);
    const groups=[];
    fronts.sort((a,b)=>a.box.min.y-b.box.min.y).forEach(p=>{
      const g=groups.find(g=>{const ov=Math.min(g.y1,p.box.max.y)-Math.max(g.y0,p.box.min.y);return ov>0.6*Math.min(g.y1-g.y0,p.s.y);});
      if(g){g.items.push(p);g.y0=Math.min(g.y0,p.box.min.y);g.y1=Math.max(g.y1,p.box.max.y);}else groups.push({y0:p.box.min.y,y1:p.box.max.y,items:[p]});
    });
    // a drawer needs a bottom (any thin horizontal board) near its lower edge
    const bottoms=parts.filter(p=>p.kind==='board'&&p.thin===1&&inside(p)&&p.s[W]>=0.6*colW);
    const drawers=groups.filter(g=>bottoms.some(b=>b.box.min.y>=g.y0-25&&b.box.min.y<=g.y0+45)).map(g=>{
      // facade = the front-most member
      const k=front.axis;const fr=g.items.slice().sort((a,b)=>front.sign>0?b.box.max[k]-a.box.max[k]:a.box.min[k]-b.box.min[k])[0];
      return {y0:fr.box.min.y,y1:fr.box.max.y,h:fr.s.y,zone:[g.y0,g.y1],face:front.sign>0?fr.box.max[k]:fr.box.min[k]};
    });
    // shelf stack: skip boards that belong to drawers
    const nearDrawer=p=>drawers.some(d=>p.box.max.y>=d.zone[0]-25&&p.box.min.y<=d.zone[1]+25);
    const shelves=c.items.filter(p=>!nearDrawer(p)).sort((a,b)=>a.box.min.y-b.box.min.y);
    const blocks=[...shelves.map(p=>({y0:p.box.min.y,y1:p.box.max.y,t:'s'}))];
    // merge drawer zones into one block per run
    const dz=drawers.map(d=>[d.zone[0],d.zone[1]]).sort((a,b)=>a[0]-b[0]);
    const runs=[];dz.forEach(z=>{const r=runs[runs.length-1];if(r&&z[0]-r[1]<60){r[1]=Math.max(r[1],z[1]);}else runs.push([...z]);});
    // drawer runs absorb the boards around them
    runs.forEach(r=>{c.items.forEach(p=>{if(nearDrawer(p)){r[0]=Math.min(r[0],p.box.min.y);r[1]=Math.max(r[1],p.box.max.y);}});});
    runs.forEach(r=>{const own=c.items.filter(p=>nearDrawer(p)&&p.box.min.y>=r[0]-1&&p.box.max.y<=r[1]+1);
      // keep the lowest board of the run out of the block if it is a drawer bottom only
      blocks.push({y0:r[0],y1:r[1],t:'d'});});
    blocks.sort((a,b)=>a.y0-b.y0);
    const gaps=[];
    for(let i=0;i<blocks.length-1;i++){const a=blocks[i],b=blocks[i+1];const g=b.y0-a.y1;if(g>=40)gaps.push({y0:a.y1,y1:b.y0,h:g});}
    columns.push({f,front,W,colW,shelfW,shelfD,gaps,drawers,yTop,yBot,count:shelves.length,blockTop:blocks.length?blocks[blocks.length-1].y1:yTop,blockBot:blocks.length?blocks[0].y0:yBot});
  }
  const frontAll=frontOf(overall);
  return {parts,overall,room,columns,frontAll};
}

/* ---------- dimension drawing (оформление как в Базис-Мебельщике) ----------
   Выносные линии от детали, размерная линия со стрелками, число над линией и вдоль неё.
   Всё — объекты 3D-сцены: поворачиваются вместе с моделью и прячутся вместе со своей группой. */
const COL={w:0xf2f2ee,c:0x7fd3ff,l:0xbfd630,d:0xffd166};
const CSS={[0xf2f2ee]:'#f2f2ee',[0x7fd3ff]:'#7fd3ff',[0xbfd630]:'#bfd630',[0xffd166]:'#ffd166'};
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const r=n=>String(Math.round(n));
var labels=[], TS=40;                       // TS — высота цифр, мм (от размера модели)
const matCache={};
function lineMat(color,d){const k='l'+color+d;return matCache[k]||(matCache[k]=new THREE.LineBasicMaterial({color,depthTest:!!d,transparent:true,opacity:.95}));}
function fillMat(color,d){const k='f'+color+d;return matCache[k]||(matCache[k]=new THREE.MeshBasicMaterial({color,depthTest:!!d,transparent:true,opacity:.95,side:THREE.DoubleSide}));}
function textMesh(text,color,h,d){
  const fs=96,pad=18,c=document.createElement('canvas'),x=c.getContext('2d');
  const font=`600 ${fs}px Onest, "Segoe UI", system-ui, sans-serif`;x.font=font;
  const w=Math.ceil(x.measureText(text).width)+pad*2;c.width=w;c.height=fs+pad*2;
  x.font=font;x.textAlign='center';x.textBaseline='middle';x.lineJoin='round';
  x.lineWidth=fs*.22;x.strokeStyle='rgba(15,14,12,.92)';x.strokeText(text,w/2,c.height/2+fs*.04);
  x.fillStyle=CSS[color]||'#fff';x.fillText(text,w/2,c.height/2+fs*.04);
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=8;
  const k=h/fs;const m=new THREE.Mesh(new THREE.PlaneGeometry(w*k,c.height*k),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthTest:!!d,depthWrite:false}));
  m.renderOrder=12;m.userData.hw=w*k/2;return m;
}
/* p1,p2 — точки на детали; side — куда (в плоскости размера) вынести размерную линию; dist — на сколько;
   n — нормаль плоскости размера (лицевая сторона); opts.ext — рисовать выносные линии */
function dim(group,p1,p2,side,dist,n,text,color,opts={}){
  const h=(opts.size||1)*TS;
  const u=p2.clone().sub(p1);const len=u.length();if(len<1)return;u.normalize();
  const sd=side.clone().normalize();
  const A=p1.clone().addScaledVector(sd,dist),B=p2.clone().addScaledVector(sd,dist);
  const pts=[A,B];
  if(opts.ext!==false&&dist>0){const g=Math.min(dist*.25,h*.4),o=h*.45;
    pts.push(p1.clone().addScaledVector(sd,g),A.clone().addScaledVector(sd,o),p2.clone().addScaledVector(sd,g),B.clone().addScaledVector(sd,o));}
  // стрелки; на коротком размере — засечки
  const al=h*.62,aw=h*.2;
  if(len>al*2.6){
    const tri=[];const add=(tip,dir)=>{const b=tip.clone().addScaledVector(dir,al);tri.push(tip,b.clone().addScaledVector(sd,aw),b.clone().addScaledVector(sd,-aw));};
    add(A,u);add(B,u.clone().negate());
    const g=new THREE.BufferGeometry().setFromPoints(tri);const m=new THREE.Mesh(g,fillMat(color,opts.depth));m.renderOrder=11;group.add(m);
  }else{const t=sd.clone().add(u).normalize().multiplyScalar(h*.35);pts.push(A.clone().sub(t),A.clone().add(t),B.clone().sub(t),B.clone().add(t));}
  const ls=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),lineMat(color,opts.depth));ls.renderOrder=10;group.add(ls);
  const tm=textMesh(text,color,h,opts.depth);group.add(tm);
  const nn=(n||new THREE.Vector3().crossVectors(u,sd)).clone().normalize();
  labels.push({m:tm,mid:A.clone().lerp(B,.5),u,n:nn,sd,h,len,out:opts.inside?0:1});
}
// каждый кадр: цифры читаются слева направо / снизу вверх, лицом к камере
const _x=V(),_y=V(),_z=V(),_m=new THREE.Matrix4(),_s=V(),_s2=V();
function updateLabels(){
  if(!labels||!labels.length)return;
  for(const L of labels){
    if(!L.m.parent||!L.m.parent.visible)continue;
    _z.copy(L.n);if(_z.dot(_s.copy(camera.position).sub(L.mid))<0)_z.negate();
    _x.copy(L.u);
    _s.copy(L.mid).project(camera);_s2.copy(L.mid).add(L.u).project(camera);
    const dx=_s2.x-_s.x,dy=_s2.y-_s.y;
    if(Math.abs(dx)>=Math.abs(dy)*.35?dx<0:dy<0)_x.negate();
    _y.crossVectors(_z,_x).normalize();
    // цифры — над линией (с внешней стороны размера), если не помещаются — сдвигаем вдоль
    const sgn=L.out&&_y.dot(L.sd)<0?-1:1;
    const pos=L.mid.clone().addScaledVector(_y,sgn*L.h*.62);
    if(L.out&&L.m.userData.hw*2>L.len-L.h*1.6)pos.addScaledVector(L.u,L.len/2+L.m.userData.hw+L.h*.4);
    _m.makeBasis(_x,_y,_z);L.m.quaternion.setFromRotationMatrix(_m);L.m.position.copy(pos);
  }
}

/* Система координат PRO100 (метры, Z вверх) → модель OBJ (мм). Ищем поворот осей, при котором углы деталей из
   mgs-dims.json (anchors) совпадают с углами деталей модели; сдвиг — по совпавшим точкам. */
function pro100ToModel(D,I){
  const keys=new Set(),K=(x,y,z)=>Math.round(x)+','+Math.round(y)+','+Math.round(z);
  I.parts.forEach(p=>{if(p.kind==='marker'||p.kind==='metiz')return;const b=p.box;
    for(let k=0;k<8;k++)keys.add(K(k&1?b.max.x:b.min.x,k&2?b.max.y:b.min.y,k&4?b.max.z:b.min.z));});
  const A=(D.anchors||[]).concat((D.dims||[]).flatMap(d=>[d.a,d.b]));
  const perms=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];let best=null;
  for(const pm of perms)for(let sg=0;sg<8;sg++){
    const sgn=[sg&1?-1:1,sg&2?-1:1,sg&4?-1:1];
    const f=q=>[sgn[0]*q[pm[0]]*1000,sgn[1]*q[pm[1]]*1000,sgn[2]*q[pm[2]]*1000];
    // сдвиг: перебираем совмещение первой точки с каждым углом модели нельзя (дорого) — сначала без сдвига,
    // затем со сдвигом, выровнявшим центры габаритов
    const offs=[[0,0,0]];
    if(D.bbox){const c=f(D.bbox.min.map((v,i)=>(v+D.bbox.max[i])/2)),oc=I.overall.getCenter(V());offs.push([oc.x-c[0],oc.y-c[1],oc.z-c[2]]);}
    for(const o of offs){let n=0;for(const q of A){const t=f(q);if(keys.has(K(t[0]+o[0],t[1]+o[1],t[2]+o[2])))n++;}
      if(!best||n>best.n)best={n,pm,sgn,o};}
  }
  if(!best||!best.n){// не совпало ни одной точки: PRO100 Z вверх → OBJ Y вверх, X как есть
    best={n:0,pm:[0,2,1],sgn:[1,1,-1],o:[0,0,0]};}
  const {pm,sgn,o}=best;
  return {n:best.n,total:A.length,map:q=>V(sgn[0]*q[pm[0]]*1000+o[0],sgn[1]*q[pm[1]]*1000+o[1],sgn[2]*q[pm[2]]*1000+o[2]),
          axis:i=>{const v=V();const j=pm.indexOf(i);v.setComponent(j,sgn[j]);return v;}};
}
function buildManualDims(I){
  const D=manualDims,g=new THREE.Group();g.visible=vis.manual;dimGroups.manual=g;scene.add(g);
  const T=pro100ToModel(D,I);
  console.info('MGS dims: совпало точек',T.n,'из',T.total);
  let n=0;
  (D.dims||[]).forEach(d=>{
    const A=T.map(d.a),D1=T.map(d.d1),D2=T.map(d.d2);
    const A2=A.clone().add(D2.clone().sub(D1));          // точка на линии детали напротив второй стрелки
    const off=D1.clone().sub(A),dist=off.length();
    const side=dist>0.5?off.clone().normalize():T.axis(d.offAxis);
    const n_=new THREE.Vector3().crossVectors(D2.clone().sub(D1).normalize(),side);
    dim(g,A,A2,side,dist,n_.lengthSq()>1e-6?n_:null,String(d.text||Math.round(d.value)),COL.w,{size:1.1});n++;
  });
  return n;
}
function setChips(manual){
  const td=$('#tDims');if(td){td.hidden=!manual;td.setAttribute('aria-pressed',String(vis.manual));}
  if(!$('#chips'))return;
  document.querySelectorAll('#chips .chip').forEach(c=>{if(c.dataset.k!=='manual')c.hidden=!AUTO_DIMS;});
  let mc=document.querySelector('#chips .chip[data-k="manual"]');
  if(!mc&&manual){mc=document.createElement('button');mc.className='chip'+(vis.manual?' on':'');mc.dataset.k='manual';mc.innerHTML='<i></i>Размеры';
    mc.onclick=()=>{vis.manual=!vis.manual;mc.classList.toggle('on',vis.manual);if(dimGroups.manual)dimGroups.manual.visible=vis.manual;};
    document.querySelector('#chips').prepend(mc);}
  if(mc)mc.hidden=!manual;
}
function buildDims(I){
  labels=[];
  const o=I.overall,s=o.getSize(V());
  if($('#oW')){$('#oW').textContent=r(s.x);$('#oH').textContent=r(s.y);$('#oD').textContent=r(s.z);}
  TS=THREE.MathUtils.clamp(Math.max(s.x,s.y,s.z)*.02,24,80);
  if(!AUTO_DIMS){
    const n=manualDims&&manualDims.dims&&manualDims.dims.length?buildManualDims(I):0;
    setChips(n>0);
    if($('#stat'))$('#stat').innerHTML=n?`Размеров от менеджера: <b>${n}</b>.`:'Менеджер ещё не проставил размеры.';
    return;
  }
  ['overall','gaps','drawers'].forEach(k=>{const g=new THREE.Group();g.visible=vis[k];dimGroups[k]=g;scene.add(g);});
  const step=TS*2.6;
  const UP=V(0,1,0);
  const fa=I.frontAll;const F=fa.axis,FS=fa.sign;const W=F==='z'?'x':'z';
  const FD=V();FD[F]=FS;const RD=new THREE.Vector3().crossVectors(UP,FD);
  const fv=FS>0?o.max[F]:o.min[F];
  const rightW=RD[W]>0?o.max[W]:o.min[W];
  const P=(w,y,f=fv)=>{const p=V(0,y,0);p[F]=f;p[W]=w;return p;};

  // общие: ширина — сверху, высота — справа, глубина — справа внизу
  dim(dimGroups.overall,P(o.min[W],o.max.y),P(o.max[W],o.max.y),UP,step,FD,r(s[W]),COL.w,{size:1.15});
  dim(dimGroups.overall,P(rightW,o.min.y),P(rightW,o.max.y),RD,step*1.4,FD,r(s.y),COL.w,{size:1.15});
  const backF=FS>0?o.min[F]:o.max[F];
  dim(dimGroups.overall,P(rightW,o.min.y,backF),P(rightW,o.min.y,fv),UP.clone().negate(),step*.9,RD,r(s[F]),COL.w,{size:1.15});

  // препятствия над/под секцией: любые видимые детали, накрывающие середину секции
  const solid=I.parts.filter(p=>p.kind!=='marker'&&p.kind!=='metiz'&&!/кромка/i.test(p.label));
  const hits=(cx,cz)=>solid.filter(p=>p.box.min.x<=cx&&p.box.max.x>=cx&&p.box.min.z<=cz&&p.box.max.z>=cz);

  let nGaps=0,nDr=0;
  I.columns.forEach(c=>{
    const cF=c.front.axis,S=c.front.sign,cW=c.W,f=c.f;
    const w0=cW==='x'?f.x0:f.z0,w1=cW==='x'?f.x1:f.z1;
    const back=(S>0?(cF==='x'?f.x0:f.z0):(cF==='x'?f.x1:f.z1))+S*4;   // размеры полок — по заду секции
    const Q=(w,y,at=back)=>{const p=V(0,y,0);p[cF]=at;p[cW]=w;return p;};
    const n=V();n[cF]=S;const along=V();along[cW]=1;
    const wm=(w0+w1)/2;
    const ins={ext:false,size:1,inside:true,depth:true};
    const gaps=c.gaps.slice();
    // сверху и снизу секции — до ближайшей детали или до края изделия
    const cx=(f.x0+f.x1)/2,cz=(f.z0+f.z1)/2,hs=hits(cx,cz);
    const above=hs.filter(p=>p.box.min.y>=c.blockTop-1).reduce((m,p)=>Math.min(m,p.box.min.y),o.max.y);
    const below=hs.filter(p=>p.box.max.y<=c.blockBot+1).reduce((m,p)=>Math.max(m,p.box.max.y),o.min.y);
    if(above-c.blockTop>=20)gaps.push({y0:c.blockTop,y1:above,h:above-c.blockTop});
    if(c.blockBot-below>=20)gaps.push({y0:below,y1:c.blockBot,h:c.blockBot-below});
    gaps.forEach(g=>{nGaps++;dim(dimGroups.gaps,Q(wm,g.y0),Q(wm,g.y1),along,0,n,r(g.h),COL.l,ins);});
    // ящики — на самом фасаде
    const wd=w0+(w1-w0)*.18;
    c.drawers.forEach(d=>{nDr++;dim(dimGroups.drawers,Q(wd,d.y0,d.face+S*3),Q(wd,d.y1,d.face+S*3),along,0,n,r(d.h),COL.d,ins);});
  });
  if($('#stat'))$('#stat').innerHTML=`Найдено секций: <b>${I.columns.length}</b>, промежутков между полками: <b>${nGaps}</b>, ящиков: <b>${nDr}</b>.`;
}

/* ---------- camera ---------- */
function fitView(v){
  if(!info)return;
  document.querySelectorAll('.views button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
  document.querySelectorAll('#mView [data-v]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.v===v)));
  const o=info.overall,c=o.getCenter(V()),s=o.getSize(V());
  const R=s.length()*.5;const vf=THREE.MathUtils.degToRad(camera.fov);const hf=2*Math.atan(Math.tan(vf/2)*camera.aspect);const hh=topH(),H=innerHeight;// центр кадра сдвинут вниз на полшапки (см. resize); модель должна влезть в высоту под шапкой
  const vfe=2*Math.atan(Math.tan(vf/2)*Math.max(H-hh,H*.5)/H);
  const dist=R/Math.sin(Math.min(vfe,hf)/2)*(camera.aspect<1?1.15:.9);
  const fa=info.frontAll;const fd=V();fd[fa.axis]=fa.sign;frontDir=fd;
  let dir;
  if(v==='front')dir=fd.clone();
  else if(v==='top')dir=V(0,1,0).add(fd.clone().multiplyScalar(.001)).normalize();
  else{const sideAx=fa.axis==='z'?'x':'z';const sd=V();sd[sideAx]=fa.sign>0?-1:1;dir=fd.clone().multiplyScalar(1).add(sd.multiplyScalar(.55)).add(V(0,.42,0)).normalize();}
  camera.position.copy(c).add(dir.multiplyScalar(dist));
  camera.near=Math.max(1,dist/200);camera.far=dist*20;camera.updateProjectionMatrix();
  controls.target.copy(c);controls.update();
}
document.querySelectorAll('.views button').forEach(b=>b.onclick=()=>fitView(b.dataset.v));

/* ---------- toggles ---------- */
document.querySelectorAll('.chip').forEach(ch=>ch.onclick=()=>{const k=ch.dataset.k;vis[k]=!vis[k];ch.classList.toggle('on',vis[k]);if(dimGroups[k])dimGroups[k].visible=vis[k];});

/* ---------- двери и ящики: распознавание и открывание ----------
   В OBJ нет «дверей» — только детали. Фасады ищем по имени («Фасад», «Дверь»), сторону петель — по петлям рядом
   (маленькие сложные детали за фасадом у его края), ящики — по боковинам ящика за фасадом. */
var movers=[];
function detectMovers(I){
  const parts=I.parts.filter(p=>p.kind!=='marker'&&p.kind!=='metiz');
  const isFace=p=>/фасад|двер/i.test(p.label)&&p.kind!=='hw';
  const boards=parts.filter(p=>p.kind==='board'&&!isFace(p));
  const F=[];
  parts.filter(isFace).forEach(f=>{
    const s=[f.s.x,f.s.y,f.s.z];const n=['x','y','z'][s.indexOf(Math.min(...s))];if(n==='y')return;
    const w=n==='x'?'z':'x';const W=f.s[w],H=f.s.y;if(W<150||H<100)return;   // узкие вставки и заглушки не открываем
    // наружу — туда, где больше места до стены комнаты; без комнаты — где меньше деталей вплотную
    let out;
    if(I.room){const a=I.room.max[n]-f.box.max[n],b=f.box.min[n]-I.room.min[n];out=a>=b?1:-1;}
    else{const cnt=sg=>boards.filter(b=>{const c=b.box.getCenter(V());const d=sg>0?b.box.min[n]-f.box.max[n]:f.box.min[n]-b.box.max[n];
      return d>-2&&d<120&&c[w]>f.box.min[w]&&c[w]<f.box.max[w]&&c.y>f.box.min.y-50&&c.y<f.box.max.y+50;}).length;out=cnt(1)<cnt(-1)?1:-1;}
    F.push({f,n,w,W,H,out,front:out>0?f.box.max[n]:f.box.min[n],back:out>0?f.box.min[n]:f.box.max[n],h:[],type:null});
  });
  // петли: деталь «Петля…» или маленькая сложная деталь (≤75 мм, ≥1500 треугольников)
  const hinges=parts.filter(p=>(p.kind==='other'||p.kind==='hw')&&(/петл/i.test(p.label)||(Math.max(p.s.x,p.s.y,p.s.z)<=75&&p.tris>=1500)));
  hinges.forEach(hg=>{
    const c=hg.box.getCenter(V());let best=null,bs=1e9;
    for(const q of F){
      const perp=(q.back-c[q.n])*q.out;if(perp<-5||perp>80)continue;
      if(c.y<q.f.box.min.y-30||c.y>q.f.box.max.y+30)continue;
      const u=c[q.w],a=q.f.box.min[q.w],b=q.f.box.max[q.w];const inside=u>=a&&u<=b;
      const de=inside?0:Math.min(Math.abs(u-a),Math.abs(u-b));if(de>60)continue;
      const sc=(inside?0:1000)+de;if(sc<bs){bs=sc;best=q;}
    }
    if(best)best.h.push(c);
  });
  F.forEach(q=>{
    if(!q.h.length)return;
    const e={min:0,max:0,top:0,bottom:0};
    q.h.forEach(c=>{const a=c[q.w]-q.f.box.min[q.w],b=q.f.box.max[q.w]-c[q.w],t=q.f.box.max.y-c.y,d=c.y-q.f.box.min.y;
      if(Math.min(a,b)<=Math.min(t,d))e[a<b?'min':'max']++;else e[t<d?'top':'bottom']++;});
    const k=Object.keys(e).sort((x,y)=>e[y]-e[x])[0];
    q.type=k==='top'?'lift':k==='bottom'?'flap':'door';q.edge=k;
  });
  // ящики: за фасадом боковины ящика ниже фасада
  F.filter(q=>!q.type).forEach(q=>{
    let depth=0;
    boards.forEach(b=>{const sb=[b.s.x,b.s.y,b.s.z];if(['x','y','z'][sb.indexOf(Math.min(...sb))]!==q.w)return;
      const c=b.box.getCenter(V());const dp=(q.back-c[q.n])*q.out;
      if(dp>40&&dp<500&&c[q.w]>q.f.box.min[q.w]&&c[q.w]<q.f.box.max[q.w]&&b.box.min.y>=q.f.box.min.y-10&&b.box.max.y<=q.f.box.max.y+10&&b.s.y<q.H*.95&&b.s[q.n]>150)
        depth=Math.max(depth,b.s[q.n]);});
    if(depth){q.type='drawer';q.depth=depth;}
  });
  // складной подъёмник: фасад без петель вплотную под подъёмным — едет вместе с ним
  F.filter(q=>!q.type).forEach(q=>{
    const up=F.find(l=>l.type==='lift'&&l.n===q.n&&Math.abs(l.front-q.front)<5&&Math.abs(l.f.box.min[q.w]-q.f.box.min[q.w])<10&&Math.abs(l.f.box.max[q.w]-q.f.box.max[q.w])<10&&Math.abs(l.f.box.min.y-q.f.box.max.y)<15);
    if(up){q.type='join';q.to=up;}
  });
  return F;
}
function buildMovers(I){
  movers=[];const F=detectMovers(I);
  const faces=new Set(F.map(q=>q.f));
  const free=I.parts.filter(p=>p.kind!=='marker'&&!faces.has(p));
  const used=new Set();
  const within=(p,q,n0,n1,tw,ty)=>p.box.min[q.w]>=q.f.box.min[q.w]-tw&&p.box.max[q.w]<=q.f.box.max[q.w]+tw&&p.box.min.y>=q.f.box.min.y-ty&&p.box.max.y<=q.f.box.max.y+ty
    &&Math.min((p.box.min[q.n]-q.front)*q.out,(p.box.max[q.n]-q.front)*q.out)>=n0&&Math.max((p.box.min[q.n]-q.front)*q.out,(p.box.max[q.n]-q.front)*q.out)<=n1;
  const groupOf=q=>{
    const ms=[q.f.mesh];
    const th=Math.abs(q.front-q.back);
    const isKr=p=>/кромка/i.test(p.label);
    free.forEach(p=>{if(used.has(p)||isKr(p))return;
      const ok=q.type==='drawer'?within(p,q,-(th+q.depth+15),70,6,12):within(p,q,-(th+3),70,4,4);
      if(ok){ms.push(p.mesh);used.add(p);}});
    // кромка едет, только если едет её деталь (раньше дверь утаскивала кромки полок и боковин рядом с собой)
    const inG=new Set(ms);
    free.forEach(p=>{if(!used.has(p)&&isKr(p)&&p.host&&inG.has(p.host.mesh)){ms.push(p.mesh);used.add(p);}});
    return ms;
  };
  F.filter(q=>q.type&&q.type!=='join').forEach(q=>{
    const pivot=new THREE.Group();scene.add(pivot);
    const N=V();N[q.n]=q.out;const Wd=V();Wd[q.w]=1;
    let axis=null,angle=0,move=null;
    if(q.type==='drawer'){move=N.clone().multiplyScalar(Math.max(150,q.depth*.8));}
    else if(q.type==='door'){
      const p=V(0,0,0);p[q.w]=q.edge==='min'?q.f.box.min[q.w]:q.f.box.max[q.w];p[q.n]=q.front;pivot.position.copy(p);
      const d=Wd.clone().multiplyScalar(q.edge==='min'?1:-1);axis=V(0,1,0);angle=THREE.MathUtils.degToRad(90)*Math.sign(new THREE.Vector3().crossVectors(d,N).y||1);
    }else{ // lift / flap
      const p=V(0,0,0);p.y=q.edge==='top'?q.f.box.max.y:q.f.box.min.y;p[q.n]=q.front;p[q.w]=(q.f.box.min[q.w]+q.f.box.max[q.w])/2;pivot.position.copy(p);
      const d=V(0,q.edge==='top'?-1:1,0);axis=Wd.clone();angle=THREE.MathUtils.degToRad(90)*Math.sign(new THREE.Vector3().crossVectors(d,N).dot(axis)||1);
    }
    pivot.updateMatrixWorld(true);
    const ms=groupOf(q);
    F.filter(j=>j.type==='join'&&j.to===q).forEach(j=>ms.push(...groupOf(Object.assign(j,{type:'door'}))));
    ms.forEach(m=>pivot.attach(m));
    movers.push({pivot,axis,angle,move,base:pivot.position.clone(),t:0,goal:0,meshes:new Set(ms),type:q.type,face:q.f});
  });
  return movers;
}
function updateMovers(dt){
  if(!movers||!movers.length)return;
  for(const m of movers){
    if(m.t===m.goal)continue;
    const sp=dt/450;m.t=m.goal>m.t?Math.min(m.goal,m.t+sp):Math.max(m.goal,m.t-sp);
    const k=m.t<.5?2*m.t*m.t:1-Math.pow(-2*m.t+2,2)/2;
    if(m.move)m.pivot.position.copy(m.base).addScaledVector(m.move,k);
    else m.pivot.quaternion.setFromAxisAngle(m.axis,m.angle*k);
  }
}
function clearSel(){if(selected){scene.remove(selected);selected=null;}}
function setAllOpen(open){movers.forEach(m=>m.goal=open?1:0);clearSel();partInfo(null);syncOpenBtn();}
function syncOpenBtn(){
  const t=$('#tOpen');if(t){const any=movers.some(m=>m.goal>0);t.hidden=!movers.length;t.setAttribute('aria-pressed',String(any));
    t.querySelector('span').textContent=any?'Закрыть':'Открыть';t.title=any?'Закрыть все двери и ящики':'Открыть все двери и выдвинуть ящики';}
  const b=$('#openAll');if(!b)return;const n=movers.length;b.hidden=!n;
  const anyOpen=movers.some(m=>m.goal>0);b.textContent=anyOpen?'Закрыть всё':'Открыть всё';
  const s=$('#openStat');if(s){const c={door:0,drawer:0,lift:0,flap:0};movers.forEach(m=>c[m.type]++);
    s.textContent=n?`Дверей: ${c.door}, ящиков: ${c.drawer}, подъёмных: ${c.lift+c.flap}. Нажмите на фасад, чтобы открыть.`:'Открывающихся фасадов не найдено.';}}
if($('#openAll'))$('#openAll').onclick=()=>setAllOpen(!movers.some(m=>m.goal>0));

/* ---------- picking ---------- */
const ray=new THREE.Raycaster();let downAt=null;
renderer.domElement.addEventListener('pointerdown',e=>{downAt=[e.clientX,e.clientY];});
renderer.domElement.addEventListener('pointerup',e=>{
  if(!downAt||Math.hypot(e.clientX-downAt[0],e.clientY-downAt[1])>5||!model)return;
  const m=V((e.clientX/innerWidth)*2-1,-(e.clientY/innerHeight)*2+1,0);
  ray.setFromCamera(m,camera);
  const hits=ray.intersectObjects([model,...movers.map(m=>m.pivot)],true).filter(h=>h.object.visible||h.object.userData.batched);
  clearSel();
  if(!hits.length){partInfo(null);return;}
  const mv=movers.find(m=>m.meshes.has(hits[0].object));if(mv){mv.goal=mv.goal>0?0:1;syncOpenBtn();return;}
  const p=info.parts.find(p=>p.mesh===hits[0].object);if(!p)return;
  const d=[p.s.x,p.s.y,p.s.z].map(v=>Math.round(v));
  const nm=p.label||'Деталь без названия';
  partInfo(nm,`${d[0]} × ${d[1]} × ${d[2]}`);
  selected=new THREE.Box3Helper(mv?new THREE.Box3().setFromObject(p.mesh).expandByScalar(2):p.box.clone().expandByScalar(2),0xbfd630);selected.material.depthTest=false;selected.renderOrder=11;scene.add(selected);
});


/* ---------- панель инструментов (view.html: #tools) ---------- */
let partTimer=0;
function partInfo(nm,sz){
  const t=$('#partInfo');if(!t)return;clearTimeout(partTimer);
  if(!nm){t.hidden=true;return;}
  t.innerHTML='<b></b><div class="sz"></div><small>ширина × высота × глубина, мм</small>';
  t.querySelector('b').textContent=nm;t.querySelector('.sz').textContent=sz;t.hidden=false;
  partTimer=setTimeout(()=>{t.hidden=true;},5000);
}
// режимы показа: оригинал / прозрачный / контуры
let viewMode='orig';
const MODE_NAMES={orig:'Оригинал',xray:'Прозрачный',lines:'Контуры',real:'Реалистичный'};
const xrayMat=new Map();
// контуры рёбер — во всех режимах (как в аналоге Макса 31.10: так лучше читается изделие); цвет — под режим
/* ---------- склейка неподвижных деталей (скорость) ----------
   ~700 деталей = ~700 отрисовок на кадр (а в «Реалистичном» ещё тени и затенение — втрое больше). Детали, которые не ездят
   (не двери/ящики) и не прячутся кнопкой «Без фасадов», склеиваем по материалу в несколько больших сеток, их рёбра — в две
   сетки линий. Исходные детали остаются (невидимыми) — по ним работает клик «что за деталь». */
let batches=[],batchEdges=[];
function clearBatches(){
  for(const b of batches){scene.remove(b);b.geometry.dispose();}
  for(const e of batchEdges){scene.remove(e);e.geometry.dispose();}
  batches=[];batchEdges=[];
}
function floatGeo(g,mw){
  const out=new THREE.BufferGeometry();
  for(const name of ['position','normal','uv']){
    const a=g.getAttribute(name);if(!a){if(name==='position')return null;continue;}
    const n=a.count,k=a.itemSize,arr=new Float32Array(n*k),get=[a.getX,a.getY,a.getZ];
    for(let i=0;i<n;i++)for(let j=0;j<k;j++)arr[i*k+j]=get[j].call(a,i);
    out.setAttribute(name,new THREE.BufferAttribute(arr,k));
  }
  const n=out.getAttribute('position').count;
  if(g.index){out.setIndex(new THREE.BufferAttribute(Uint32Array.from(g.index.array),1));}
  else{const ix=new Uint32Array(n);for(let i=0;i<n;i++)ix[i]=i;out.setIndex(new THREE.BufferAttribute(ix,1));}
  if(!out.getAttribute('normal'))out.computeVertexNormals();
  out.applyMatrix4(mw);
  return out;
}
const isMetal=p=>RX_METAL.test(p.label)&&!/фасад|двер/i.test(p.label);
function buildBatches(){
  clearBatches();if(!info||!model)return;
  model.updateMatrixWorld(true);
  const moving=new Set();movers.forEach(m=>m.meshes.forEach(x=>moving.add(x)));
  const fs=frontSet(),groups=new Map(),edges={n:[],b:[]};
  for(const p of solidParts()){
    const m=p.mesh;
    if(moving.has(m)||fs.has(p)||Array.isArray(m.material)||!m.material||!m.geometry||m.geometry.groups.length>1)continue;
    const g=floatGeo(m.geometry,m.matrixWorld);if(!g)continue;
    const metal=isMetal(p),key=m.material.uuid+'|'+(metal?1:0)+'|'+(g.getAttribute('uv')?1:0);
    if(!groups.has(key))groups.set(key,{src:m.material,metal,geos:[]});groups.get(key).geos.push(g);
    const eg=new THREE.EdgesGeometry(m.geometry,28);eg.applyMatrix4(m.matrixWorld);
    edges[(/кромка/i.test(p.label)||p.tris>400)?'b':'n'].push(eg);
    m.visible=false;m.userData.batched=true;
  }
  for(const G of groups.values()){
    const geo=G.geos.length>1?mergeGeometries(G.geos,false):G.geos[0];G.geos.forEach(x=>{if(x!==geo)x.dispose();});
    if(!geo)continue;
    const src=G.src;if(!src.polygonOffset){src.polygonOffset=true;src.polygonOffsetFactor=1;src.polygonOffsetUnits=1;}
    const mesh=new THREE.Mesh(geo,src);mesh.userData.src=src;mesh.userData.metal=G.metal;mesh.raycast=()=>{};
    scene.add(mesh);batches.push(mesh);
  }
  for(const k of ['n','b']){
    if(!edges[k].length)continue;
    const geo=mergeGeometries(edges[k],false);edges[k].forEach(x=>x.dispose());if(!geo)continue;
    const e=new THREE.LineSegments(geo,EDGE_MAT.orig);e.raycast=()=>{};e.userData.busy=k==='b';e.renderOrder=1;
    scene.add(e);batchEdges.push(e);
  }
}
function xrayOf(mt){
  if(!mt)return mt;let c=xrayMat.get(mt);
  if(!c){c=mt.clone();c.transparent=true;c.opacity=Math.min(mt.opacity??1,.28);c.depthWrite=false;c.side=THREE.DoubleSide;xrayMat.set(mt,c);}
  return c;
}
const EDGE_MAT={
  orig: new THREE.LineBasicMaterial({color:0x1d1b19,transparent:true,opacity:.55}),
  xray: new THREE.LineBasicMaterial({color:0x2a2724,transparent:true,opacity:.7,depthWrite:false}),
  lines:new THREE.LineBasicMaterial({color:0xe9ecef,transparent:true,opacity:.85}),
};
const ghostMat=new THREE.MeshBasicMaterial({color:0x9aa3ab,transparent:true,opacity:.06,depthWrite:false,side:THREE.DoubleSide});
function solidParts(){return info?info.parts.filter(p=>p.kind!=='marker'&&p.kind!=='metiz'):[];}
function edgesOf(p){
  const m=p.mesh,u=m.userData;
  if(u.edges!==undefined)return u.edges;
  // кромки повторяют рёбра своей детали, сложная фурнитура (петли, опоры — тысячи граней) даёт кашу линий — им контур только в режиме «Контуры»
  const busy=/кромка/i.test(p.label)||p.tris>400;
  const g=new THREE.EdgesGeometry(m.geometry,28);
  const e=new THREE.LineSegments(g,EDGE_MAT.orig);e.raycast=()=>{};e.userData.busy=busy;e.renderOrder=1;m.add(e);
  // заливка чуть «отодвигается», чтобы линии рёбер не мерцали поверх неё
  (Array.isArray(m.material)?m.material:[m.material]).forEach(mt=>{if(mt&&!mt.polygonOffset){mt.polygonOffset=true;mt.polygonOffsetFactor=1;mt.polygonOffsetUnits=1;}});
  return u.edges=e;
}
/* ---------- «Реалистичный»: свет комнаты (отражения), затенение углов и стыков (GTAO), мягкая тень на полу,
   материалы PBR с лёгким рельефом из самой текстуры. Модули грузятся только при первом включении. ---------- */
var real=null;
const realMats=new Map();
const RX_METAL=/(ручк|профил|алюмин|штанг|опора|направля|петл|флипер|flipper|aventos|хром|сталь|металл)/i;
async function realInit(){
  const [{RoomEnvironment},{EffectComposer},{RenderPass},{GTAOPass},{OutputPass}]=await Promise.all([
    import('./lib/jsm/environments/RoomEnvironment.js'),import('./lib/jsm/postprocessing/EffectComposer.js'),
    import('./lib/jsm/postprocessing/RenderPass.js'),import('./lib/jsm/postprocessing/GTAOPass.js'),import('./lib/jsm/postprocessing/OutputPass.js')]);
  const pm=new THREE.PMREMGenerator(renderer);const env=pm.fromScene(new RoomEnvironment(renderer),.04).texture;pm.dispose();
  const phone=matchMedia('(pointer:coarse)').matches&&Math.min(innerWidth,innerHeight)<700;
  // сглаживание краёв (MSAA): у промежуточной картинки эффектов его нет по умолчанию — края «лесенкой» и рябь при вращении
  const rt=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:phone?2:4});
  const composer=new EffectComposer(renderer,rt);
  // чёткость: в покое — полная; пока крутят — вдвое ниже по каждой стороне (на Retina это 4× меньше точек), на телефоне не трогаем
  const fullPR=Math.min(devicePixelRatio,phone?1.5:2),lowPR=phone?fullPR:Math.max(1,fullPR*.75);   // ×0,5 давало рябь — ×0,75 со сглаживанием
  composer.setPixelRatio(fullPR);composer.setSize(innerWidth,innerHeight);
  composer.addPass(new RenderPass(scene,camera));
  // затенение углов — в половинном разрешении: оно мягкое, на вид то же, а работы вчетверо меньше (Retina Mac — ~5 млн точек)
  const ao=new GTAOPass(scene,camera,innerWidth,innerHeight);
  ao.setSize=function(w,h){GTAOPass.prototype.setSize.call(this,Math.max(1,Math.ceil(w/2)),Math.max(1,Math.ceil(h/2)));};
  composer.addPass(ao);
  composer.addPass(new OutputPass());
  // свет «из окна» с мягкой тенью
  // свет сверху-спереди (как потолочный): тени ложатся под полки ровно, а не косыми полосами
  const key=new THREE.DirectionalLight(0xfff4e6,2.0);key.castShadow=true;const ms=phone?2048:4096;key.shadow.mapSize.set(ms,ms);
  key.shadow.radius=3;key.shadow.bias=-.0003;key.shadow.normalBias=.6;scene.add(key);scene.add(key.target);key.visible=false;
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.ShadowMaterial({opacity:.38}));
  floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;floor.visible=false;scene.add(floor);
  real={env,composer,ao,key,floor,phone,fullPR,lowPR,curPR:fullPR,dirty:6,on:false,fitFor:null,lastMove:0,fade:0,shadowDirty:2};
  controls.addEventListener('change',()=>{if(real){real.dirty=Math.max(real.dirty,1);real.lastMove=performance.now();}});
  return real;
}
// под текущую модель: тень и пол по её габаритам, радиус затенения в мм
function realFit(){
  if(!real||!info||real.fitFor===info)return;real.fitFor=info;
  const b=info.overall,c=b.getCenter(V()),sz=b.getSize(V()),R=Math.max(sz.x,sz.y,sz.z);
  const k=real.key;k.position.set(c.x+R*.12,c.y+R*2.5,c.z+R*.45);k.target.position.copy(c);k.updateMatrixWorld();k.target.updateMatrixWorld();
  // камера тени — ровно по габаритам изделия (в осях света) + запас под тень на полу: чем плотнее, тем чётче край тени
  const sc=k.shadow.camera;sc.position.copy(k.position);sc.lookAt(c);sc.updateMatrixWorld();
  const inv=sc.matrixWorldInverse,lb=new THREE.Box3();
  for(const x of [b.min.x,b.max.x])for(const y of [b.min.y-1,b.max.y])for(const z of [b.min.z,b.max.z])lb.expandByPoint(V(x,y,z).applyMatrix4(inv));
  const pad=R*.08;sc.left=lb.min.x-pad;sc.right=lb.max.x+pad;sc.bottom=lb.min.y-pad;sc.top=lb.max.y+pad;sc.near=Math.max(1,-lb.max.z-R*.5);sc.far=-lb.min.z+R*.5;sc.updateProjectionMatrix();
  real.floor.scale.set(R*4,R*4,1);real.floor.position.set(c.x,b.min.y-.5,c.z);
  real.ao.updateGtaoMaterial({radius:Math.min(160,Math.max(60,R*.045)),distanceExponent:1.2,thickness:Math.max(20,R*.015),scale:1.8,samples:real.phone?8:16,distanceFallOff:1,screenSpaceRadius:false});
  real.ao.updatePdMaterial({lumaPhi:10,depthPhi:6,normalPhi:3,radius:real.phone?8:12,rings:3,samples:16});
}
function realSet(on){
  if(!real)return;real.on=on;realFit();
  scene.environment=on?real.env:null;
  renderer.toneMapping=THREE.NoToneMapping;renderer.toneMappingExposure=1;   // ACES/AgX разбеливали дерево (проверено 31.10) — цвета как в проекте
  renderer.shadowMap.enabled=on;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;real.shadowDirty=2;
  real.key.visible=on;real.floor.visible=on;sun.visible=fill.visible=!on;hemi.intensity=on?.25:2.6;
  scene.traverse(o=>{if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.needsUpdate=true);});
  real.dirty=8;
}
/* кадр «Реалистичного»: затенение углов — всегда, и при вращении (Макс 31.10: «проявление потом» ломало целостность);
   плавность дают склейка деталей и тень, посчитанная один раз (пересчёт — только когда двигаются двери / «Без фасадов»).
   В покое ничего не рисуется. */
function realFrame(){
  if(!real||!real.on)return false;
  const now=performance.now(),doors=movers&&movers.some(m=>m.t!==m.goal),moving=doors||now-real.lastMove<150;
  if(doors)real.shadowDirty=1;
  const pr=moving?real.lowPR:real.fullPR;
  if(pr!==real.curPR){real.curPR=pr;real.composer.setPixelRatio(pr);if(!moving)real.dirty=Math.max(real.dirty,2);}   // остановились — сразу чёткий кадр
  if(real.dirty>0||moving||real.shadowDirty>0){
    // не чаще 60 кадров в секунду: экраны 120 Гц (MacBook Pro) иначе рисуют вдвое больше при той же плавности на глаз
    if(now-(real.lastFrame||0)<15)return true;
    real.lastFrame=now;
    real.dirty=Math.max(0,real.dirty-1);
    if(real.shadowDirty>0){renderer.shadowMap.needsUpdate=true;real.shadowDirty--;}
    real.composer.render();
  }
  return true;
}
// материал PBR по исходному: металл — фурнитура, стекло — полупрозрачное, остальное — плита с лёгким рельефом текстуры
function realMatOf(src,p){
  if(Array.isArray(src))return src.map(m=>realMatOf(m,p));
  if(!src)return src;
  const op=src.opacity??1,metal=isMetal(p),glass=op<.6,tint=!glass&&op<.98;
  const key=src.uuid+(metal?'m':'');let r=realMats.get(key);if(r)return r;
  r=new THREE.MeshStandardMaterial({map:src.map||null,color:src.color?src.color.clone():new THREE.Color(0xffffff),
    transparent:!!src.transparent||glass,opacity:src.opacity??1,side:src.side??THREE.FrontSide,alphaTest:src.alphaTest||0});
  if(metal){r.metalness=.85;r.roughness=.32;if(!src.map)r.color.multiplyScalar(.95);}
  else if(glass){r.metalness=0;r.roughness=.08;r.envMapIntensity=1.1;r.depthWrite=false;}
  else if(tint){r.metalness=0;r.roughness=.5;r.envMapIntensity=.35;r.depthWrite=false;}   // полупрозрачная заливка PRO100 — как в проекте, без зеркальных бликов
  else{r.metalness=0;r.roughness=.62;r.envMapIntensity=.6;if(src.map){r.bumpMap=src.map;r.bumpScale=.9;}}
  realMats.set(key,r);return r;
}
function applyMode(){
  for(const p of solidParts()){
    const m=p.mesh,u=m.userData;
    if(u.batched)continue;
    if(!u.mat0)u.mat0=m.material;
    const e=edgesOf(p);
    e.material=EDGE_MAT[viewMode];e.visible=viewMode==='lines'||!e.userData.busy;
    if(viewMode==='real'){e.visible=false;m.material=realMatOf(u.mat0,p);m.castShadow=m.receiveShadow=true;continue;}
    m.castShadow=m.receiveShadow=false;
    if(viewMode==='orig'){m.material=u.mat0;continue;}
    if(viewMode==='xray'){const x=(Array.isArray(u.mat0)?u.mat0:[u.mat0]).map(xrayOf);m.material=Array.isArray(u.mat0)?x:x[0];continue;}
    m.material=ghostMat;          // контуры: только рёбра + едва заметная заливка
  }
  for(const b of batches){const src=b.userData.src;
    b.material=viewMode==='real'?realMatOf(src,{label:b.userData.metal?'металл':''}):viewMode==='orig'?src:viewMode==='xray'?xrayOf(src):ghostMat;
    b.castShadow=b.receiveShadow=viewMode==='real';}
  for(const e of batchEdges){e.material=EDGE_MAT[viewMode]||EDGE_MAT.orig;e.visible=viewMode!=='real'&&(viewMode==='lines'||!e.userData.busy);}
  realSet(viewMode==='real');
  const l=$('#tModeL');if(l)l.textContent=MODE_NAMES[viewMode];
  document.querySelectorAll('#mMode [data-mode]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.mode===viewMode)));
}
// без фасадов: прячем фасады/двери (по имени детали) и ручки, чтобы видеть, что внутри
let frontsHidden=false;
// детали, которые прячет «Без фасадов»: фасады, ручки, всё, что ездит с дверью/подъёмником (у ящика — только в толщине фасада),
// кромки этих деталей и то, что сидит внутри фасада (чашки петель, ручки-профили)
function frontSet(){
  const all=solidParts(),isFront=p=>(/фасад|двер/i.test(p.label)&&p.kind!=='hw')||/ручк/i.test(p.label);
  const fr=all.filter(isFront),frBox=fr.filter(p=>p.kind!=='hw').map(p=>p.box.clone().expandByScalar(1));
  const S=new Set(fr);
  for(const m of movers){const fb=m.face.box.clone().expandByScalar(3);
    for(const p of all)if(m.meshes.has(p.mesh)&&(m.type!=='drawer'||fb.containsBox(p.box)))S.add(p);}
  for(const p of all){
    if(S.has(p)||p.kind==='board'||/кромка/i.test(p.label))continue;
    const c=p.box.getCenter(new THREE.Vector3());if(frBox.some(b=>b.containsPoint(c)))S.add(p);}
  for(const p of all)if(/кромка/i.test(p.label)&&p.host&&S.has(p.host))S.add(p);
  return S;
}
function setFronts(hide,silent){
  frontsHidden=!!hide;
  for(const p of frontSet())p.mesh.visible=!frontsHidden;
  const b=$('#tFronts');if(b){b.setAttribute('aria-pressed',String(frontsHidden));b.querySelector('span').textContent=frontsHidden?'Вернуть фасады':'Без фасадов';}
  clearSel();if(real){real.dirty=4;real.shadowDirty=2;}if(!silent)partInfo(null);
}
function closeMenus(except){document.querySelectorAll('.menu').forEach(m=>{if(m!==except){m.hidden=true;const b=m.previousElementSibling;if(b)b.setAttribute('aria-expanded','false');}});}
function bindMenu(btn,menu,onPick){
  if(!btn||!menu)return;
  btn.onclick=e=>{e.stopPropagation();const open=menu.hidden;closeMenus(menu);menu.hidden=!open;btn.setAttribute('aria-expanded',String(open));
    if(open)(menu.querySelector('[aria-checked="true"]')||menu.querySelector('button')).focus();};
  menu.querySelectorAll('button').forEach(b=>b.onclick=e=>{e.stopPropagation();onPick(b);closeMenus();btn.focus();});
  menu.addEventListener('keydown',e=>{const items=[...menu.querySelectorAll('button')],i=items.indexOf(document.activeElement);
    if(e.key==='ArrowDown'){e.preventDefault();items[(i+1)%items.length].focus();}
    else if(e.key==='ArrowUp'){e.preventDefault();items[(i-1+items.length)%items.length].focus();}
    else if(e.key==='Escape'){closeMenus();btn.focus();}});
}
bindMenu($('#tView'),$('#mView'),b=>fitView(b.dataset.v));
bindMenu($('#tMode'),$('#mMode'),async b=>{const m=b.dataset.mode;
  if(m==='real'&&!real){status('Готовим реалистичный вид…');try{await realInit();}catch(e){console.error(e);status('');partInfo('Реалистичный вид не поддерживается этим браузером','');return;}status('');}
  viewMode=m;applyMode();});
document.addEventListener('click',()=>closeMenus());
if($('#tFronts'))$('#tFronts').onclick=()=>setFronts(!frontsHidden);
if($('#tOpen'))$('#tOpen').onclick=()=>setAllOpen(!movers.some(m=>m.goal>0));
if($('#tDims'))$('#tDims').onclick=()=>{vis.manual=!vis.manual;if(dimGroups.manual)dimGroups.manual.visible=vis.manual;$('#tDims').setAttribute('aria-pressed',String(vis.manual));};
new ResizeObserver(()=>resize()).observe(document.getElementById('top')||document.body);

export {loadFromMap,loadGlb,status,base,fitView};
window.__info=()=>info;window.__stats=()=>({calls:renderer.info.render.calls,tris:renderer.info.render.triangles,batches:batches.length});
