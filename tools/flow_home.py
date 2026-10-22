"""Тест «главная на весь экран» (Макс 23.10): home.html -> home-flow.html.
На телефоне (<1000px при загрузке) экраны идут один под другим и листается САМА страница (окно браузера),
с примагничиванием к каждому экрану — Safari/Chrome прячут свои панели, видео уходит под часы и нижнюю строку.
Компьютер — как в home.html (свой переключатель экранов).

  python3 tools/flow_home.py            (home.html -> home-flow.html)
"""
import re

s = open('home.html', encoding='utf-8').read()


def rep(a, b, n=1):
    global s
    c = s.count(a)
    assert c == n, (a[:90], c)
    s = s.replace(a, b)


CSS = r'''<style>
/* ===== «главная на весь экран» (tools/flow_home.py): телефон — листается сама страница ===== */
html.flow,html.flow body{height:auto;overflow:visible;overscroll-behavior-y:none}
html.flow{scroll-snap-type:y mandatory}
html.flow.free{scroll-snap-type:none}
html.flow .stage{position:relative;height:auto;overflow:visible}
/* экран = высота самого телефона (screen.height, ставит скрипт в <head>): при свёрнутых панелях Safari видимая область больше 100lvh
   (страница уходит под часы и нижнюю строку) — со 100lvh снизу выглядывал следующий экран. Текст и кнопки держим в видимой части
   при развёрнутых панелях: --tb = запас снизу = высота экрана − 100svh (на нём уже построены все отступы главной) */
html.flow{--tb:max(0px, calc(var(--scr, 100lvh) - 100svh))}
html.flow .screen{position:relative;inset:auto;visibility:visible;height:100vh;height:var(--scr, 100lvh);scroll-snap-align:start;scroll-snap-stop:always;transform:none!important}
/* расчёт — последний экран: высотой по содержимому, листается свободно (html.free), иначе низ страницы дёргался */
html.flow .calc-screen{height:auto;min-height:100vh;min-height:var(--scr, 100lvh);overflow:visible!important}
html.flow .calc-inner{min-height:100vh;min-height:var(--scr, 100lvh)}
html.flow .stage{transition:opacity .22s ease}
html.flow.jump .stage{opacity:0}
/* меню: закрытое убрано совсем, открытое — страница под ним прозрачна (не visibility — иначе лаг) */
html.flow .site-menu[hidden]{display:none!important}
html.flow.menu-open .stage{opacity:0;transition:opacity 0s .2s}
html.flow .site-menu::after{content:"";position:absolute;left:0;right:0;top:100%;height:50vh;background:var(--bg);pointer-events:none}
</style>
<script>if(innerWidth<1000){var _de=document.documentElement;_de.classList.add('flow');
  // высота экрана телефона (а не окна браузера): окно меняется, когда браузер прячет панели, экран — нет
  var _scr=function(){var p=innerWidth<innerHeight, h=p?Math.max(screen.height||0,innerHeight):innerHeight;_de.style.setProperty('--scr',h+'px');};
  _scr();addEventListener('orientationchange',function(){setTimeout(_scr,300);});}</script>
'''
rep('</head>', CSS + '</head>')
rep('<title>', '<meta name="robots" content="noindex"><title>')
rep('<nav class="site-menu" id="siteMenu" aria-label="Меню сайта">',
    '<nav class="site-menu" id="siteMenu" aria-label="Меню сайта" hidden>')

# --- JS ---
rep("const isMob=innerWidth<1000;", "const isMob=innerWidth<1000;\nconst FLOW=document.documentElement.classList.contains('flow'), HTML=document.documentElement;")

# go(): на телефоне — мгновенный прыжок с гашением (плавная прокрутка через экраны мелькала)
rep("function go(i){\n  i=Math.max(0,Math.min(screens.length-1,i));",
    """function go(i){
  i=Math.max(0,Math.min(screens.length-1,i));
  if(FLOW){ flowGo(i); return; }""")

# свой свайп и колесо — только на ПК
rep("stage.addEventListener('touchstart',e=>{\n  if(menuOpen() || e.touches.length>1){ T=null; return; }",
    "stage.addEventListener('touchstart',e=>{\n  if(FLOW){ T=null; return; }\n  if(menuOpen() || e.touches.length>1){ T=null; return; }")
rep("document.addEventListener('touchmove',e=>{ if(!stage.contains(e.target) && !$('#siteMenu').contains(e.target)) e.preventDefault(); },{passive:false});",
    "document.addEventListener('touchmove',e=>{ if(FLOW){ if(menuOpen() && !$('#siteMenu').contains(e.target)) e.preventDefault(); return; } if(!stage.contains(e.target) && !$('#siteMenu').contains(e.target)) e.preventDefault(); },{passive:false});")

# меню: закрытое — hidden, открытое — страница под ним прозрачна
rep("function setMenu(o){ menu.classList.toggle('open',o); mb.classList.toggle('open',o); }",
    """function setMenu(o){
  if(FLOW){ if(o){ menu.hidden=false; void menu.offsetWidth; } else menu.hidden=true; HTML.classList.toggle('menu-open',o); }
  menu.classList.toggle('open',o); mb.classList.toggle('open',o);
}
if(!FLOW) menu.hidden=false;""")

# форма: после клавиатуры НЕ прыгать в начало страницы
rep("cf.addEventListener('focusout',()=>setTimeout(()=>{ if(!cf.contains(document.activeElement)) window.scrollTo(0,0); },120));",
    "cf.addEventListener('focusout',()=>setTimeout(()=>{ if(!FLOW && !cf.contains(document.activeElement)) window.scrollTo(0,0); },120));")

# resize: на телефоне экраны не прячем
rep("addEventListener('resize',()=>{ sizeMap(); if(!busy){", "addEventListener('resize',()=>{ sizeMap(); if(!FLOW && !busy){")

# старт с экрана из адреса + логика прокрутки
rep("""(function(){
  const i=IDS.indexOf(location.hash.slice(1));""", """/* =====================================================================
   ТЕЛЕФОН: листается сама страница. Текущий экран — тот, чей верх ближе к верху окна.
   ===================================================================== */
const calcEl=$('#calc');
function flowCur(){ const y=scrollY; let k=0, best=1e9; screens.forEach((s,i)=>{ const d=Math.abs(s.offsetTop-y); if(d<best){ best=d; k=i; } }); return k; }
function flowFree(){ HTML.classList.toggle('free', HTML.classList.contains('jump') || scrollY > calcEl.offsetTop + 40 || cf.contains(document.activeElement)); }
let fT=0;
function flowScroll(){
  flowFree();
  const k=flowCur();
  // текст экрана проявляется, когда экран больше чем наполовину на экране
  screens.forEach(s=>{ const r=s.getBoundingClientRect(); if(r.top < innerHeight*0.5 && r.bottom > innerHeight*0.5) s.classList.add('in'); });
  if(k!==cur){ cur=k; lightDock(k); onEnter(k); }
  clearTimeout(fT); fT=setTimeout(syncMedia, 120);
}
function flowGo(i){
  lightDock(i); setMenu(false);
  HTML.classList.add('jump','free');
  setTimeout(()=>{
    window.scrollTo({top:screens[i].offsetTop, behavior:'instant'});
    cur=i; screens[i].classList.add('in'); onEnter(i); syncMedia();
    requestAnimationFrame(()=>{ HTML.classList.remove('jump'); flowFree(); });
  }, 230);
}
if(FLOW){
  addEventListener('scroll', flowScroll, {passive:true});
  cf.addEventListener('focusin', flowFree);
  cf.addEventListener('focusout', ()=>setTimeout(flowFree, 150));
  screens.forEach(s=>s.classList.add('vis'));
}
(function(){
  const i=IDS.indexOf(location.hash.slice(1));
  if(FLOW){
    cur=Math.max(0,i);
    if(i>0){ HTML.classList.add('free'); requestAnimationFrame(()=>{ window.scrollTo({top:screens[i].offsetTop, behavior:'instant'}); flowFree(); }); }
    screens[cur].classList.add('in'); lightDock(cur); syncMedia(); onEnter(cur); return;
  }""")

# ссылки ведут в тестовые «Наши работы»
s = s.replace('href="portfolio.html"', 'href="portfolio-flow.html"')
open('home-flow.html', 'w', encoding='utf-8').write(s)
print('ok home-flow.html')
