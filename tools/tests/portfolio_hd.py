import os,sys
from playwright.sync_api import sync_playwright
# Проверка тестовой страницы portfolio-hd.html. Запуск: python3 -m http.server 8812 & python3 tools/tests/portfolio_hd.py
import re, subprocess
D='/tmp/mgs-hd/'; W=D+'webm/'; os.makedirs(W, exist_ok=True)
# Chromium в Playwright не играет H.264 — делаем короткие webm-копии видео страницы и подменяем ими mp4
for f in sorted(set(re.findall(r'assets/[\w-]+\.mp4', open('portfolio-hd.html').read()))):
    out=W+os.path.basename(f)[:-4]+'.webm'
    if not os.path.exists(out):
        subprocess.run(['ffmpeg','-nostdin','-loglevel','error','-y','-t','6','-i',f,'-vf','scale=270:-2','-c:v','libvpx','-b:v','300k','-c:a','libvorbis',out])
        if not os.path.exists(out): subprocess.run(['ffmpeg','-nostdin','-loglevel','error','-y','-t','6','-i',f,'-vf','scale=270:-2','-c:v','libvpx','-b:v','300k','-an',out])
URL=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:8812/portfolio-hd.html'
fails=[]
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
      t:S.active&&S.active._v?S.active._v.currentTime:null, y:scrollY, snap:document.documentElement.classList.contains('snap')}})()""")
    pg.goto(URL); pg.wait_for_timeout(2500)
    s=st(); print(s)
    ok(s['feed']=='REELS' and s['n']==7 and s['act']==0 and s['snap'],'старт: REELS, 7 рилсов, активный первый, примагничивание')
    ok(J("MGS_TEST.cards[0].getBoundingClientRect().top")>50,'первый рилс — с отступом под шапкой (%d px)'%J("MGS_TEST.cards[0].getBoundingClientRect().top"))
    J("scrollTo(0,30)"); pg.wait_for_timeout(700); ok(J("scrollY")==0,'начальное положение — тоже точка доводки (вернуло в 0)')
    pg.wait_for_timeout(1000); s2=st()
    ok(s2['playing']==[0] and s2['t']>0.3,'играет только первый рилс (t=%.1f)'%(s2['t'] or 0))
    ok(set(s2['loaded'])<= {0,1},'загружены только текущий и следующий: %s'%s2['loaded'])
    # свайп-эмуляция: прокрутка на полкарточки → примагничивание
    h=J("MGS_TEST.cards[1].getBoundingClientRect().top+scrollY-5")
    J("scrollTo(0,%d)"%(h*0.6)); pg.wait_for_timeout(900); s=st()
    ok(s['act']==1 and abs(s['y']-h)<3,'полсвайпа → доводит до 2-го (y=%d, ждали %d)'%(s['y'],h))
    # палец: протянул на 80 px и отпустил → следующий; на 10 px → вернуло на место
    J("document.dispatchEvent(new Event('touchstart'))"); J("scrollTo(0,scrollY+80)"); pg.wait_for_timeout(50); J("document.dispatchEvent(new Event('touchend'))"); pg.wait_for_timeout(700)
    h2=J("MGS_TEST.cards[2].getBoundingClientRect().top+scrollY-5"); ok(abs(J("scrollY")-h2)<3 and J("MGS_TEST.cards.indexOf(MGS_TEST.active)")==2,'палец протянул 80 px — доводит до следующего')
    J("document.dispatchEvent(new Event('touchstart'))"); J("scrollTo(0,scrollY+10)"); pg.wait_for_timeout(50); J("document.dispatchEvent(new Event('touchend'))"); pg.wait_for_timeout(700)
    ok(abs(J("scrollY")-h2)<3,'палец протянул 10 px — возвращает на место')
    J("document.dispatchEvent(new Event('touchstart'))"); J("scrollTo(0,scrollY-90)"); pg.wait_for_timeout(50); J("document.dispatchEvent(new Event('touchend'))"); pg.wait_for_timeout(700)
    ok(abs(J("scrollY")-h)<3,'палец вверх — к предыдущему')
    for k in [2,3]:
        hk=J("MGS_TEST.cards[%d].getBoundingClientRect().top+scrollY-5"%k); J("scrollTo(0,%d)"%hk); pg.wait_for_timeout(900)
    pg.wait_for_timeout(800); s=st(); print(s)
    ok(s['act']==3 and s['playing']==[3],'4-й рилс активен и играет один')
    ok(0 not in s['loaded'],'дальние выгружены: %s'%s['loaded'])
    # пауза / продолжить
    c3="MGS_TEST.cards[3]"
    box=J(c3+".getBoundingClientRect().toJSON()")
    pg.touchscreen.tap(box['x']+box['width']/2, box['y']+box['height']*0.4); pg.wait_for_timeout(500)
    ok(J(c3+"._v.paused") and J(c3+".classList.contains('paused')"),'касание — пауза и значок ▶')
    pg.touchscreen.tap(box['x']+box['width']/2, box['y']+box['height']*0.4); pg.wait_for_timeout(700)
    ok(not J(c3+"._v.paused") and not J(c3+".classList.contains('paused')"),'второе касание — снова играет')
    # перемотка
    pr=J(c3+".querySelector('.prog').getBoundingClientRect().toJSON()")
    pg.touchscreen.tap(pr['x']+8+(pr['width']-16)*0.5, pr['y']+pr['height']/2); pg.wait_for_timeout(400)
    t=J(c3+"._v.currentTime"); d=J(c3+"._v.duration")
    ok(abs(t-d*0.5)<0.6 and not J(c3+"._v.paused"),'касание полоски — перемотка на середину (%.1f из %.1f), не ставит на паузу'%(t,d))
    # тянем полоску
    pg.mouse.move(pr['x']+20, pr['y']+13); pg.mouse.down(); pg.mouse.move(pr['x']+pr['width']*0.8, pr['y']+13, steps=5); pg.mouse.up(); pg.wait_for_timeout(300)
    t=J(c3+"._v.currentTime"); ok(abs(t-d*0.8)<0.8,'перетаскивание полоски — перемотка (%.1f)'%t)
    # звук
    sb=J(c3+".querySelector('.snd').getBoundingClientRect().toJSON()")
    pg.touchscreen.tap(sb['x']+20,sb['y']+20); pg.wait_for_timeout(400)
    ok(J("document.documentElement.classList.contains('sound')") and not J(c3+"._v.muted") and not J(c3+"._v.paused"),'кнопка звука — звук включён, видео играет')
    # переход на следующий со звуком
    h4=J("MGS_TEST.cards[4].getBoundingClientRect().top+scrollY-5"); J("scrollTo(0,%d)"%h4); pg.wait_for_timeout(1000)
    ok(J("!MGS_TEST.cards[4]._v.muted") and J("MGS_TEST.cards[3]._v.paused"),'следующий рилс — со звуком, предыдущий остановлен')
    # Комплекс — с начала
    pg.tap('.chip[data-f="Комплекс"]'); pg.wait_for_timeout(1500); s=st(); print(s)
    ok(J("MGS_TEST.cards[0].getBoundingClientRect().top")>50,'Комплекс: первая карточка с отступом под шапкой (%d px)'%J("MGS_TEST.cards[0].getBoundingClientRect().top"))
    ok(s['feed']=='Комплекс' and s['act']==0 and s['y']==0 and s['snap'],'Комплекс открывается с 1-го проекта (не с 4-го)')
    ok(s['playing']==[0],'в Комплексе играет только первый')
    ok(J("MGS_TEST.cards[0].querySelector('.num').textContent")=='1 / 6' and J("!MGS_TEST.cards[0].querySelector('.snd,.prog')"),'Комплекс: счётчик есть, звука и полоски нет')
    hc=J("MGS_TEST.cards[1].getBoundingClientRect().top+scrollY-5"); J("scrollTo(0,%d)"%(hc*0.55)); pg.wait_for_timeout(900); s=st()
    ok(s['act']==1 and abs(s['y']-hc)<3,'Комплекс: полсвайпа → доводит до 2-го')
    pg.screenshot(path=D+'h_cx.png')
    # Кухни
    pg.tap('.chip[data-f="Кухни"]'); pg.wait_for_timeout(1200)
    ok(J("document.querySelector('.tile').getBoundingClientRect().top")>50,'Кухни: сетка с отступом под шапкой')
    ok(not J("document.documentElement.classList.contains('snap')") and J("document.querySelectorAll('.tile').length")>5 and J("scrollY")==0,'Кухни: сетка, без примагничивания, с начала (%d плиток)'%J("document.querySelectorAll('.tile').length"))
    ok(J("[...document.querySelectorAll('video')].every(v=>v.paused)"),'в сетке видео не играют')
    pg.screenshot(path=D+'h_k.png')
    J("scrollTo(0,700)"); pg.wait_for_timeout(400); y0=J("scrollY")
    t=J("(()=>{const t=[...document.querySelectorAll('.tile')].find(e=>e.getBoundingClientRect().top>60);const r=t.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()")
    pg.touchscreen.tap(t[0],t[1]); pg.wait_for_timeout(1000)
    ok(J("document.documentElement.classList.contains('viewing')") and J("scrollY")==0,'касание плитки — просмотр изделия сверху')
    ok(J("document.getElementById('vcount').textContent").startswith('1 /'),'счётчик фото: '+J("document.getElementById('vcount').textContent"))
    pg.screenshot(path=D+'h_v.png')
    h2=J("document.querySelectorAll('.vm')[1].getBoundingClientRect().top+scrollY-5"); J("scrollTo(0,%d)"%(h2*0.6)); pg.wait_for_timeout(900)
    ok(abs(J("scrollY")-h2)<3 and J("document.getElementById('vcount').textContent").startswith('2 /'),'в просмотре полсвайпа → следующее фото')
    J("scrollTo(0,99999)"); pg.wait_for_timeout(600)
    ok(J("document.documentElement.classList.contains('vfree')"),'описание листается свободно')
    pg.screenshot(path=D+'h_v2.png')
    pg.go_back(); pg.wait_for_timeout(800)
    ok(not J("document.documentElement.classList.contains('viewing')") and abs(J("scrollY")-y0)<3 and 'portfolio-hd' in pg.url,'«Назад» закрывает просмотр, лента на том же месте')
    # снова REELS — примагничивание работает
    pg.tap('.chip[data-f="REELS"]'); pg.wait_for_timeout(1200)
    h=J("MGS_TEST.cards[1].getBoundingClientRect().top+scrollY-5"); J("scrollTo(0,%d)"%(h*0.6)); pg.wait_for_timeout(900); s=st()
    ok(s['act']==1 and abs(s['y']-h)<3 and s['playing']==[1],'после Кухонь REELS снова листается слайдером')
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
    pc.click('.chip[data-f="Кухни"]'); pc.wait_for_timeout(1200); pc.screenshot(path=D+'h_pc2.png')
    ok(pc.evaluate("document.querySelectorAll('.col').length")==4 and not e2,'ПК: сетка 4 колонки, без ошибок')
    b.close()
print('\nИТОГ:', 'всё хорошо' if not fails else '%d ошибок'%len(fails))
