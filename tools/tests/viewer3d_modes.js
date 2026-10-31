// Проверка 3D-просмотра (3d/viewer.js): все сочетания «Без фасадов» × «Открыть» × режим (Оригинал/Прозрачный/Контуры/Реалистичный).
// Запуск из корня репозитория:  python3 -m http.server 8833 &   node tools/tests/viewer3d_modes.js [model.glb]
// Без аргумента качает кухню-образец с сервера. Ищет: видимые фасады/ручки/кромки фасадов при «Без фасадов»,
// детали внутри фасада, кромки не в материале своей детали, скрытое без причины, ошибки JS. Кадр — /tmp/viewer3d-open-nofronts.png
const fs=require('fs'),path=require('path'),{chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'../..'),SAMPLE='https://api.mgsmebel.com/storage/v1/object/public/models/363ce49c-e0aa-4943-a621-9b0bd7550596/2c680efe-86fd-4bb3-a606-11f7401c6050/model.glb';
(async()=>{
  const glb=path.join(ROOT,'3d/_test.glb'),page=path.join(ROOT,'3d/_test.html');
  if(process.argv[2])fs.copyFileSync(process.argv[2],glb);else fs.writeFileSync(glb,Buffer.from(await (await fetch(SAMPLE)).arrayBuffer()));
  const head=fs.readFileSync(path.join(ROOT,'3d/view.html'),'utf8').split('<script type="importmap">')[0];
  fs.writeFileSync(page,head+`<script type="importmap">{"imports":{"three":"./lib/three.module.min.js"}}</script>
<script type="module">import {loadGlb} from './viewer.js';await loadGlb({url:'_test.glb',size:${fs.statSync(glb).size}},new Map(),'Тест');window.__done=1;</script></body></html>`);
  const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});let fails=0;
  try{
    const p=await b.newPage({viewport:{width:900,height:620}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
    await p.goto('http://localhost:8833/3d/_test.html');await p.waitForFunction(()=>window.__done,null,{timeout:120000});
    const check=()=>p.evaluate(()=>{const I=window.__info(),bad=[],sol=I.parts.filter(p=>p.kind!=='marker'&&p.kind!=='metiz');
      const hid=document.querySelector('#tFronts').getAttribute('aria-pressed')==='true';
      const fronts=sol.filter(p=>/фасад|двер/i.test(p.label)&&p.kind!=='hw');
      if(hid)sol.forEach(q=>{if(!q.mesh.visible)return;
        if(fronts.includes(q))bad.push('фасад виден');
        if(q.host&&!q.host.mesh.visible)bad.push('кромка без своей детали');
        if(/ручк/i.test(q.label))bad.push('ручка видна');
        const c=q.box.getCenter(q.box.min.clone());
        if(q.kind!=='board'&&!/кромка/i.test(q.label)&&fronts.some(f=>f.box.clone().expandByScalar(1).containsPoint(c)))bad.push('деталь внутри фасада: '+q.label);});
      else sol.forEach(q=>{if(!q.mesh.visible)bad.push('скрыто без причины: '+q.label);});
      if(document.querySelector('#tMode span').textContent==='Оригинал')sol.forEach(q=>{if(q.host&&q.mesh.material!==q.host.mesh.material)bad.push('кромка не в материале своей детали');});
      return [...new Set(bad)];});
    const tap=k=>p.evaluate(k=>document.querySelector(k).click(),k);   // клик через JS — тяжёлый кадр «Реалистичного» в swiftshader не мешает
    const on=async k=>(await p.getAttribute(k,'aria-pressed'))==='true';
    const hasOpen=!(await p.$eval('#tOpen',e=>e.hidden));
    for(const fr of [false,true])for(const op of hasOpen?[false,true]:[false])for(const m of ['orig','xray','lines','real']){
      if(await on('#tFronts')!==fr)await tap('#tFronts');
      if(hasOpen&&await on('#tOpen')!==op)await tap('#tOpen');
      await tap(`[data-mode=${m}]`);await p.waitForTimeout(m==='real'?2500:700);
      const bad=await check();if(bad.length)fails++;
      console.log(bad.length?'✗':'✓',`без фасадов=${fr} открыто=${op} ${m}`,bad.slice(0,5).join('; '));
    }
    if(hasOpen){if(!await on('#tFronts'))await tap('#tFronts');if(!await on('#tOpen'))await tap('#tOpen');
      await tap('[data-mode=orig]');await p.waitForTimeout(1200);await p.screenshot({path:'/tmp/viewer3d-open-nofronts.png'});}
    if(errs.length){fails++;console.log('✗ ошибки JS:',errs);}
  }finally{await b.close();fs.unlinkSync(glb);fs.unlinkSync(page);}
  console.log(fails?`ПРОВАЛ: ${fails}`:'ВСЁ ОК');process.exit(fails?1:0);
})();
