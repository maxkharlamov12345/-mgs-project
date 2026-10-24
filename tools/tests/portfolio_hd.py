import os,sys
from playwright.sync_api import sync_playwright
# Проверка тестовой страницы portfolio-hd.html. Запуск: python3 -m http.server 8812 & python3 tools/tests/portfolio_hd.py
import re, subprocess
D='/tmp/mgs-hd/'; W=D+'webm/'; os.makedirs(W, exist_ok=True)
# Chromium в Playwright не играет H.264 — делаем короткие webm-копии видео страницы и подменяем ими mp4
import glob
for f in sorted(set(re.findall(r'assets/[\w-]+\.mp4', open('portfolio-hd.html').read())) | set(glob.glob('assets/*-preview.mp4'))):
    out=W+os.path.basename(f)[:-4]+'.webm'
    if not os.path.exists(out):
        subprocess.run(['ffmpeg','-nostdin','-loglevel','error','-y','-t','6','-i',f,'-vf','scale=270:-2','-c:v','libvpx','-b:v','300k','-c:a','libvorbis',out])
        if not os.path.exists(out): subprocess.run(['ffmpeg','-nostdin','-loglevel','error','-y','-t','6','-i',f,'-vf','scale=270:-2','-c:v','libvpx','-b:v','300k','-an',out])
URL=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:8812/portfolio-hd.html'
fails=[]
Y0=160 if 'hd2' in URL else 0   # hd2: при «сдвиге» страница стоит прокрученной на запас (контент под часами)
def ok(c,msg):
    print(('OK   ' if c else 'FAIL ')+msg)
    if not c: fails.append(msg)
def route(r):
    n=os.path.basename(r.request.url.split('?')[0].split('#')[0])[:-4]
    f=W+n+'.webm'
    if os.path.exists(f): r.fulfill(path=f, headers={'content-type':'video/webm','accept-ranges':'bytes'})
    else: r.continue_()
with sync_playwright() as p:
    b=p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx=b.new_context(**p.devices['iPhone 13']); pg=ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e))); pg.route('**/*.mp4',route)
    J=pg.evaluate
    st=lambda: J("""(()=>{const S=window.MGS_TEST;const cs=S.cards;return {feed:S.feed,n:cs.length,act:cs.indexOf(S.active),
      playing:cs.map((c,i)=>c._v&&!c._v.paused?i:-1).filter(i=>i>=0), loaded:cs.map((c,i)=>c._v&&c._v.getAttribute('src')?i:-1).filter(i=>i>=0),
      t:S.active&&S.active._v?S.active._v.currentTime:null, y:scrollY, ti:S.T.i, snap:document.documentElement.classList.contains('snap')}})()""")
    cdp=ctx.new_cdp_session(pg)
    def swipe(dy, ms=260, x=195, y0=430, n=10):
        # настоящий жест пальцем: касание, движение, отпускание
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y0}]})
        for k in range(1,n+1):
            pg.wait_for_timeout(ms/n); cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':y0+dy*k/n}]})
        cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]}); pg.wait_for_timeout(650)
    top=lambda i: J("MGS_TEST.cards[%d].getBoundingClientRect().top"%i)
    pg.goto(URL); pg.wait_for_timeout(2500)
    TF="parseFloat(getComputedStyle(document.getElementById('feed')).paddingTop)"
    s=st(); print(s)
    ok(s['feed']=='REELS' and s['n']==7 and s['act']==0,'старт: REELS, 7 превью, активное первое')
    ok(J("MGS_TEST.cards[0].classList.contains('rp') && Math.abs(MGS_TEST.cards[0].offsetHeight/MGS_TEST.cards[0].offsetWidth-1.25)<0.02"),'превью рилсов — карточки 4:5, как в Комплексе')
    ok(J("MGS_TEST.cards[0]._v.getAttribute('src')||''").find('-preview.mp4')>0,'в ленте играет короткое превью (-preview.mp4)')
    ok(J("MGS_TEST.cards[0].getBoundingClientRect().top")>50,'первое превью — с отступом под шапкой')
    pg.wait_for_timeout(800); ok(st()['playing']==[0],'в ленте играет только первое превью')
    tf=J(TF); swipe(-140, 500); s=st()
    ok(s['act']==1 and s['ti']==1 and abs(top(1)-tf)<2 and s['y']==Y0,'лента превью: свайп → следующее встаёт под шапку, страница не прокручивается (%.0f/%.0f)'%(top(1),tf))
    ok(J("document.documentElement.classList.contains('trk')") and 'translate3d' in J("document.querySelector('#feed .lenta').style.transform"),'лента едет сдвигом (transform), а не прокруткой')
    swipe(200, 500); ok(st()['ti']==0 and abs(top(0)-tf)<2,'свайп вниз — назад к первому')
    # касание превью → полноценная рилс-лента
    b0=J("MGS_TEST.cards[0].getBoundingClientRect().toJSON()"); pg.touchscreen.tap(b0['x']+100,b0['y']+150); pg.wait_for_timeout(1200)
    ok(J("MGS_TEST.rv===true && document.documentElement.classList.contains('viewing')"),'касание превью — открылся просмотр рилсов')
    s=st(); print(s)
    ok(s['n']==7 and s['act']==0 and J("MGS_TEST.cards[0].classList.contains('reel')") and (J("MGS_TEST.active._v.getAttribute('src')||''").find('-preview')<0),'в просмотре — полные видео 9:16, с 1-го')
    pg.wait_for_timeout(800); s2=st()
    ok(s2['playing']==[0] and s2['t']>0.3,'играет только первый рилс (t=%.1f)'%(s2['t'] or 0))
    ok(set(s2['loaded'])<= {0,1},'загружены только текущий и следующий: %s'%s2['loaded'])
    swipe(-150, 500); s=st()
    ok(s['act']==1 and abs(top(1)-5)<2 and s['y']==Y0,'медленный свайп → доезжает до 2-го (верх %.0f)'%top(1))
    swipe(-70, 20, n=2)
    ok(st()['ti']==2 and abs(top(2)-5)<2,'быстрый короткий флик (70 px) — к следующему')
    swipe(-40, 700)
    ok(st()['ti']==2 and abs(top(2)-5)<2,'палец протянул 40 px медленно — возвращает на место')
    swipe(150, 500)
    ok(st()['ti']==1 and abs(top(1)-5)<2,'палец вниз — к предыдущему')
    swipe(-150,400); swipe(-150,400); pg.wait_for_timeout(800); s=st(); print(s)
    ok(s['act']==3 and s['playing']==[3],'4-й рилс активен и играет один')
    ok(0 not in s['loaded'],'дальние выгружены: %s'%s['loaded'])
    ok(J("MGS_TEST.cards[2].classList.contains('above') && MGS_TEST.cards[4].classList.contains('below')"),'соседние притемнены')
    ok(J("+getComputedStyle(MGS_TEST.cards[2].querySelector('.dim')).opacity")>0.95 and J("+getComputedStyle(MGS_TEST.cards[3].querySelector('.dim')).opacity")<0.05 and J("+getComputedStyle(MGS_TEST.cards[3].querySelector('.num')).opacity")>0.95 and J("+getComputedStyle(MGS_TEST.cards[4].querySelector('.num')).opacity")<0.05,'затемнение и счётчик — по положению ленты (текущая чистая, соседи тёмные)')
    c3="MGS_TEST.cards[3]"
    box=J(c3+".getBoundingClientRect().toJSON()")
    pg.touchscreen.tap(box['x']+box['width']/2, box['y']+box['height']*0.4); pg.wait_for_timeout(500)
    ok(J(c3+"._v.paused") and J(c3+".classList.contains('paused')"),'касание — пауза и значок ▶')
    pg.touchscreen.tap(box['x']+box['width']/2, box['y']+box['height']*0.4); pg.wait_for_timeout(700)
    ok(not J(c3+"._v.paused") and not J(c3+".classList.contains('paused')"),'второе касание — снова играет')
    pr=J(c3+".querySelector('.prog').getBoundingClientRect().toJSON()")
    pg.touchscreen.tap(pr['x']+8+(pr['width']-16)*0.5, pr['y']+pr['height']/2); pg.wait_for_timeout(400)
    t=J(c3+"._v.currentTime"); d=J(c3+"._v.duration")
    ok(abs(t-d*0.5)<0.6 and not J(c3+"._v.paused"),'касание полоски — перемотка на середину (%.1f из %.1f)'%(t,d))
    pg.mouse.move(pr['x']+20, pr['y']+13); pg.mouse.down(); pg.mouse.move(pr['x']+pr['width']*0.8, pr['y']+13, steps=5); pg.mouse.up(); pg.wait_for_timeout(300)
    t=J(c3+"._v.currentTime"); ok(abs(t-d*0.8)<0.8,'перетаскивание полоски — перемотка (%.1f)'%t)
    sb=J(c3+".querySelector('.snd').getBoundingClientRect().toJSON()")
    pg.touchscreen.tap(sb['x']+20,sb['y']+20); pg.wait_for_timeout(400)
    ok(J("document.documentElement.classList.contains('sound')") and not J(c3+"._v.muted") and not J(c3+"._v.paused"),'кнопка звука — звук включён, видео играет')
    swipe(-150, 400, y0=300); pg.wait_for_timeout(400)
    ok(J("!MGS_TEST.cards[4]._v.muted") and J("MGS_TEST.cards[3]._v.paused"),'следующий рилс — со звуком, предыдущий остановлен')
    # закрыть — назад к превью
    pg.go_back(); pg.wait_for_timeout(1200); s=st()
    ok(not J("MGS_TEST.rv") and s['feed']=='REELS' and J("MGS_TEST.cards[0].classList.contains('rp')") and s['ti']==0 and abs(top(0)-tf)<2,'«Назад» — снова лента превью на прежнем месте')
    ok(J("document.querySelectorAll('#view video').length")==0 and s['playing']==[0],'полные видео выгружены, снова играет превью')
    # открыть 3-е превью — просмотр с 3-го
    swipe(-150,400); swipe(-150,400)
    b2=J("MGS_TEST.cards[2].getBoundingClientRect().toJSON()"); pg.touchscreen.tap(b2['x']+100,b2['y']+150); pg.wait_for_timeout(1200)
    ok(J("MGS_TEST.rv && MGS_TEST.cards.indexOf(MGS_TEST.active)")==2,'касание 3-го превью — просмотр с 3-го рилса')
    pg.tap('#vclose'); pg.wait_for_timeout(1000)
    ok(not J("MGS_TEST.rv") and J("MGS_TEST.cards.indexOf(MGS_TEST.active)")==2,'крестик — назад к 3-му превью')
    # Комплекс — с начала
    pg.tap('.chip[data-f="Комплекс"]'); pg.wait_for_timeout(1500); s=st(); print(s)
    ok(J("MGS_TEST.cards[0].getBoundingClientRect().top")>50,'Комплекс: первая карточка с отступом под шапкой (%d px)'%J("MGS_TEST.cards[0].getBoundingClientRect().top"))
    ok(s['feed']=='Комплекс' and s['act']==0 and s['ti']==0 and abs(top(0)-tf)<2,'Комплекс открывается с 1-го проекта')
    ok(s['playing']==[0],'в Комплексе играет только первый')
    ok(J("MGS_TEST.cards[0].querySelector('.cx-chips .dark').textContent")=='1 / 6' and J("MGS_TEST.cards[0].querySelector('.cx-bottom h3').textContent")=='Квартира в тёплых тонах' and J("!MGS_TEST.cards[0].querySelector('.snd,.prog')"),'Комплекс: счётчик есть, звука и полоски нет')
    swipe(-150,500); s=st()
    ok(s['act']==1 and abs(top(1)-tf)<2,'Комплекс: свайп → доезжает до 2-го')
    pg.screenshot(path=D+'h_cx.png')
    # Кухни
    pg.tap('.chip[data-f="Кухни"]'); pg.wait_for_timeout(1200)
    ok(J("document.querySelector('.tile').getBoundingClientRect().top")>50,'Кухни: сетка с отступом под шапкой')
    ok(not J("document.documentElement.classList.contains('trk')") and J("document.querySelectorAll('.tile').length")>5 and J("scrollY")==0,'Кухни: сетка, без примагничивания, с начала (%d плиток)'%J("document.querySelectorAll('.tile').length"))
    ok(J("[...document.querySelectorAll('video')].every(v=>v.paused)"),'в сетке видео не играют')
    pg.screenshot(path=D+'h_k.png')
    # подфильтры кухонь
    allk=J("document.querySelectorAll('.tile').length")
    ok(J("document.getElementById('subchips').classList.contains('show')") and J("document.querySelectorAll('.sub').length")==4,'Кухни: строка подфильтров всплыла')
    sb=J("document.getElementById('subchips').getBoundingClientRect().bottom"); ct=J("document.getElementById('chipsIn').getBoundingClientRect().top")
    ok(sb<=ct+2,'подфильтры над плашками (%d ≤ %d)'%(sb,ct))
    pg.tap('.sub[data-s="П-образная"]'); pg.wait_for_timeout(700); pg.screenshot(path=D+'h_sub.png')
    n=J("document.querySelectorAll('.tile').length")
    ok(0<n<allk and J("document.querySelector('.sub.on').dataset.s")=='П-образная','П-образная: %d из %d'%(n,allk))
    pg.tap('.sub[data-s="Прямая"]'); pg.wait_for_timeout(500)
    ok(J("document.documentElement.scrollHeight")>J("innerHeight"),'короткая лента (Прямая) всё равно выше экрана — панель Safari не дёргает плашки')
    pg.tap('.sub[data-s="Все"]'); pg.wait_for_timeout(500)
    ok(J("document.querySelectorAll('.tile').length")==allk,'«Все» возвращает все кухни')
    J("scrollTo(0,700)"); pg.wait_for_timeout(400); y0=J("scrollY")
    t=J("(()=>{const t=[...document.querySelectorAll('.tile')].find(e=>e.getBoundingClientRect().top>60);const r=t.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()")
    pg.touchscreen.tap(t[0],t[1]); pg.wait_for_timeout(1000)
    ok(J("document.documentElement.classList.contains('viewing')") and J("scrollY")==Y0,'касание плитки — просмотр изделия сверху')
    ok(J("document.getElementById('vcount').textContent").startswith('1 /'),'счётчик фото: '+J("document.getElementById('vcount').textContent"))
    pg.screenshot(path=D+'h_v.png')
    ok(J("document.documentElement.classList.contains('trk') && MGS_TEST.T.mode")=='view','просмотр изделия листается сдвигом')
    swipe(-150,500)
    vt=J("document.querySelectorAll('.vm')[1].getBoundingClientRect().top")
    ok(abs(vt-5)<2 and J("document.getElementById('vcount').textContent").startswith('2 /') and J("scrollY")==Y0,'в просмотре свайп → следующее фото встаёт к верху (%.0f)'%vt)
    swipe(150,500); ok(J("document.getElementById('vcount').textContent").startswith('1 /'),'свайп вниз — к предыдущему фото')
    for k in range(6): swipe(-150,400)
    ok(J("document.documentElement.classList.contains('vfree')"),'после последнего фото — описание')
    bt=J("document.querySelector('.vpanel .btns').getBoundingClientRect().bottom"); ih=J("innerHeight")
    ok(bt<=ih+1,'описание дотягивается до кнопок (низ кнопок %.0f ≤ %d)'%(bt,ih))
    y1=J("MGS_TEST.T.y"); swipe(-200,600); ok(J("MGS_TEST.T.y")<=y1+1,'ниже конца описания не уезжает')
    for k in range(3): swipe(250,400)
    ok(not J("document.documentElement.classList.contains('vfree')"),'свайп вниз с описания — обратно к фото')
    pg.screenshot(path=D+'h_v2.png')
    pg.go_back(); pg.wait_for_timeout(800)
    ok(not J("document.documentElement.classList.contains('viewing')") and abs(J("scrollY")-y0)<3 and 'portfolio-hd' in pg.url,'«Назад» закрывает просмотр, лента на том же месте')
    # снова REELS — примагничивание работает
    pg.tap('.chip[data-f="REELS"]'); pg.wait_for_timeout(1200)
    ok(not J("document.getElementById('subchips').classList.contains('show')"),'в REELS подфильтров нет')
    swipe(-150,500); pg.wait_for_timeout(400); s=st()
    ok(s['act']==1 and abs(top(1)-tf)<2 and s['playing']==[1],'после Кухонь лента REELS снова листается по одной')
    # меню
    pg.tap('#menuBtn'); pg.wait_for_timeout(400); ok(J("!document.getElementById('menu').hidden"),'меню открывается')
    pg.tap('#menuBtn'); pg.wait_for_timeout(300); ok(J("document.getElementById('menu').hidden"),'меню закрывается')
    # адрес
    pg.goto(URL+'#%D0%A1%D0%B0%D0%BD%D1%83%D0%B7%D0%BB%D1%8B'); pg.wait_for_timeout(1500)
    ok(J("MGS_TEST.feed")=='Санузлы' and J("document.querySelector('.chip.on').dataset.f")=='Санузлы','адрес #Санузлы открывает Санузлы')
    ok(not errs,'ошибок JS нет '+str(errs[:2]))
    # ПК
    pc=b.new_page(viewport={'width':1440,'height':900}); pc.route('**/*.mp4',route); e2=[]; pc.on('pageerror',lambda e:e2.append(str(e)))
    pc.goto(URL); pc.wait_for_timeout(2000); pc.screenshot(path=D+'h_pc.png')
    pc.mouse.move(720,450); pc.mouse.wheel(0,120); pc.wait_for_timeout(120); pc.mouse.wheel(0,120); pc.wait_for_timeout(900)
    ok(pc.evaluate("MGS_TEST.T.i")==1,'ПК: один жест колесом — ровно одна карточка')
    pc.click('.chip[data-f="Кухни"]'); pc.wait_for_timeout(1200); pc.screenshot(path=D+'h_pc2.png')
    ok(pc.evaluate("document.querySelectorAll('.col').length")==4 and not e2,'ПК: сетка 4 колонки, без ошибок')
    b.close()
print('\nИТОГ:', 'всё хорошо' if not fails else '%d ошибок'%len(fails))
