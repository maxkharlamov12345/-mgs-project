
import * as THREE from 'three';
import {OrbitControls} from './lib/OrbitControls.js';
import {OBJLoader} from './lib/OBJLoader.js';
import {MTLLoader} from './lib/MTLLoader.js';
import {CSS2DRenderer,CSS2DObject} from './lib/CSS2DRenderer.js';

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
scene.add(new THREE.HemisphereLight(0xffffff,0x555555,2.6));
const sun=new THREE.DirectionalLight(0xffffff,1.9);sun.position.set(1,1.6,1.2);scene.add(sun);
const fill=new THREE.DirectionalLight(0xffffff,.9);fill.position.set(-1,.4,-.8);scene.add(fill);

let model=null, dimGroups={}, info=null, frontDir=new THREE.Vector3(0,0,1), selected=null;
const vis={overall:true,gaps:true,drawers:true};

function resize(){const w=innerWidth,h=innerHeight;renderer.setSize(w,h);labelR.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}
addEventListener('resize',resize);resize();
(function loop(){requestAnimationFrame(loop);controls.update();if(typeof updateLabels==='function')updateLabels();renderer.render(scene,camera);labelR.render(scene,camera);})();

function status(t){const s=$('#status');if(!s)return;if(!t){s.hidden=true;return;}s.textContent=t;s.hidden=false;}

/* ---------- loading ---------- */
const base=n=>decodeURIComponent(String(n)).replace(/\\/g,'/').split('/').filter(Boolean).pop().toLowerCase();
async function loadFromMap(files,title){ // files: Map basename -> {url, text?}
  const objKey=[...files.keys()].find(k=>k.endsWith('.obj'));
  if(!objKey){status('В выбранных файлах нет .obj. Сделайте в PRO100 экспорт в OBJ и выберите его.');return;}
  status('Загружаем модель…');
  const mgr=new THREE.LoadingManager();
  mgr.setURLModifier(u=>{const f=files.get(base(u));return f?f.url:u;});
  const objText=await (await fetch(files.get(objKey).url)).text();
  const m=objText.match(/^mtllib\s+(.+)$/m);
  let mats=null;
  const mtlKey=m&&files.has(base(m[1].trim()))?base(m[1].trim()):[...files.keys()].find(k=>k.endsWith('.mtl'));
  if(mtlKey){
    const mtlText=await (await fetch(files.get(mtlKey).url)).text();
    const ml=new MTLLoader(mgr);ml.setMaterialOptions({side:THREE.DoubleSide});
    mats=ml.parse(mtlText,'');mats.preload();
  }
  const ol=new OBJLoader(mgr);if(mats)ol.setMaterials(mats);
  const obj=ol.parse(objText);
  setModel(obj,title||objKey.replace(/\.obj$/,''));
  status('');
}

function setModel(obj,title){
  if(model){scene.remove(model);}
  Object.values(dimGroups).forEach(g=>{scene.remove(g);g.traverse(o=>{if(o.isMesh&&o.material.map){o.material.map.dispose();o.material.dispose();}o.geometry&&o.geometry.dispose();});});dimGroups={};selected=null;
  $('#part').innerHTML='<span class="hint">Нажмите на любую деталь модели, чтобы увидеть её размер.</span>';
  // units: PRO100 OBJ is in metres -> work in mm
  const pre=new THREE.Box3().setFromObject(obj);const sz=pre.getSize(new THREE.Vector3());
  if(Math.max(sz.x,sz.y,sz.z)<60)obj.scale.setScalar(1000);
  obj.updateMatrixWorld(true);
  model=obj;scene.add(obj);
  info=analyze(obj);
  fitView('persp');
  const I=info;
  (document.fonts&&document.fonts.load?document.fonts.load('600 96px Onest').catch(()=>{}):Promise.resolve()).then(()=>{if(info===I)buildDims(I);});
}

/* ---------- analysis ---------- */
const RX_METIZ=/(саморез|евровинт|конфирмат|шкант|эксцентрик|минификс|шуруп|гвоздь|винт)/i;
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
    const host=boards.find(b=>b.box.clone().expandByScalar(3).containsPoint(c));
    if(host){e.mesh.material=host.mesh.material;}
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

function buildDims(I){
  labels=[];
  ['overall','gaps','drawers'].forEach(k=>{const g=new THREE.Group();g.visible=vis[k];dimGroups[k]=g;scene.add(g);});
  const o=I.overall,s=o.getSize(V());
  $('#oW').textContent=r(s.x);$('#oH').textContent=r(s.y);$('#oD').textContent=r(s.z);
  TS=THREE.MathUtils.clamp(Math.max(s.x,s.y,s.z)*.02,24,80);
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
  $('#stat').innerHTML=`Найдено секций: <b>${I.columns.length}</b>, промежутков между полками: <b>${nGaps}</b>, ящиков: <b>${nDr}</b>.`;
}

/* ---------- camera ---------- */
function fitView(v){
  if(!info)return;
  document.querySelectorAll('.views button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
  const o=info.overall,c=o.getCenter(V()),s=o.getSize(V());
  const R=s.length()*.5;const vf=THREE.MathUtils.degToRad(camera.fov);const hf=2*Math.atan(Math.tan(vf/2)*camera.aspect);const dist=R/Math.sin(Math.min(vf,hf)/2)*(camera.aspect<1?1.15:.9);
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

/* ---------- picking ---------- */
const ray=new THREE.Raycaster();let downAt=null;
renderer.domElement.addEventListener('pointerdown',e=>{downAt=[e.clientX,e.clientY];});
renderer.domElement.addEventListener('pointerup',e=>{
  if(!downAt||Math.hypot(e.clientX-downAt[0],e.clientY-downAt[1])>5||!model)return;
  const m=V((e.clientX/innerWidth)*2-1,-(e.clientY/innerHeight)*2+1,0);
  ray.setFromCamera(m,camera);
  const hits=ray.intersectObject(model,true).filter(h=>h.object.visible);
  if(selected){scene.remove(selected);selected=null;}
  if(!hits.length){$('#part').innerHTML='<span class="hint">Нажмите на любую деталь модели, чтобы увидеть её размер.</span>';return;}
  const p=info.parts.find(p=>p.mesh===hits[0].object);if(!p)return;
  const d=[p.s.x,p.s.y,p.s.z].map(v=>Math.round(v));
  const nm=p.label||'Деталь без названия';
  $('#part').innerHTML='<div class="nm"></div><div class="sz"></div><div class="hint"></div>';
  $('#part .nm').textContent=nm;
  $('#part .sz').textContent=`${d[0]} × ${d[1]} × ${d[2]}`;
  $('#part .hint').textContent='ширина × высота × глубина, мм';
  selected=new THREE.Box3Helper(p.box.clone().expandByScalar(2),0xbfd630);selected.material.depthTest=false;selected.renderOrder=11;scene.add(selected);
});


export {loadFromMap,status,base,fitView};
window.__info=()=>info;
