#!/usr/bin/env python3
"""Проверка сайта перед публикацией.  Запуск из корня репозитория:

    python3 tools/tests/check.py          # всё (~4–5 мин)
    python3 tools/tests/check.py quick    # без долгих проверок на медленном интернете (~1,5 мин)

Нужны: python3, playwright (+ chromium), Pillow.  Сам поднимает локальный сервер на свободном порту.
Каждая проверка — то, что уже ломалось у Макса.  Итог: ✅/❌ по каждой; код выхода 1, если что-то упало.

Проверки:
  files        все фото из страниц существуют, у каждого есть превью assets/t/*.webp и пропорции в assets/dims.js
  pages        все страницы открываются на телефоне и ПК: без ошибок JS, без «битых» файлов (404), лента есть
  speed        первый экран на «мобильном интернете»: главная картинка появляется быстрее 2,5 с
  feeds        смена лент в портфолио: на экране нет пустых плиток (было: плитки пустые после переключения)
  one-video    телефон, REELS/Комплекс: одновременно играет не больше одного видео (было: играли все)
  after-viewer после просмотра изделия видео в «Комплексе» и REELS на месте (было: чёрные плитки)
  slider       медленный интернет: соседние фото в просмотре не перестраиваются, пока грузятся (было: «менялись»)
  ready        фоновая докачка: через несколько секунд на ленте все фото в просмотре уже готовы (даже без сети)
"""
import asyncio, glob, json, os, random, re, socket, subprocess, sys, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
os.chdir(ROOT)
QUICK = 'quick' in sys.argv[1:]
PAGES = ['portfolio.html', 'index.html', 'project-2.html', 'project-5.html', 'project-6.html', 'project-7.html', 'project-8.html']
PHONE = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=3)
DESK = dict(viewport={'width': 1440, 'height': 900})
SLOW = {'offline': False, 'latency': 250, 'downloadThroughput': 250000, 'uploadThroughput': 100000}
FAST4G = {'offline': False, 'latency': 60, 'downloadThroughput': 9e6 / 8, 'uploadThroughput': 3e6 / 8}
results = []


def report(name, ok, detail=''):
    results.append((name, ok))
    print(('✅ ' if ok else '❌ ') + name + ('  — ' + detail if detail else ''), flush=True)


# ---------- files: без браузера ----------
def check_files():
    dims = open('assets/dims.js').read()
    miss = []
    for p in PAGES:
        for a in sorted(set(re.findall(r"assets/[A-Za-z0-9_.-]+\.jpg", open(p, encoding='utf-8').read()))):
            if not os.path.exists(a): miss.append(a + ' (нет файла)'); continue
            base = os.path.basename(a)[:-4]
            if not os.path.exists('assets/t/' + base + '.webp'): miss.append(a + ' (нет превью — make_thumbs.py)')
            if '"' + a + '"' not in dims: miss.append(a + ' (нет в dims.js — make_thumbs.py)')
    report('files', not miss, ', '.join(sorted(set(miss))[:6]) + (' …' if len(set(miss)) > 6 else ''))


async def throttle(ctx, pg, cond, nocache=False):
    cdp = await ctx.new_cdp_session(pg)
    await cdp.send('Network.enable')
    if nocache: await cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
    await cdp.send('Network.emulateNetworkConditions', cond)
    return cdp


async def check_pages(b, base):
    bad = []
    for prof, kw in [('телефон', PHONE), ('ПК', DESK)]:
        for p in PAGES:
            ctx = await b.new_context(**kw); pg = await ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append('JS: ' + str(e)[:80]))
            pg.on('response', lambda r: errs.append('%d %s' % (r.status, r.url.split('/')[-1][:40])) if r.status >= 400 else None)
            await pg.goto(base + p); await pg.wait_for_timeout(2500)
            n = await pg.evaluate("document.querySelectorAll('.pin').length")
            if n == 0: errs.append('лента пустая')
            if errs: bad.append('%s %s: %s' % (prof, p, '; '.join(errs[:3])))
            await ctx.close()
    report('pages', not bad, ' | '.join(bad[:4]))


async def check_speed(b, base):
    bad = []
    for u in ['portfolio.html', 'portfolio.html#Кухни', 'portfolio.html#REELS', 'project-2.html', 'project-7.html']:
        ctx = await b.new_context(**PHONE); pg = await ctx.new_page()
        await throttle(ctx, pg, FAST4G)
        await pg.goto(base + u); await pg.wait_for_timeout(4000)
        lcp = await pg.evaluate("new Promise(r=>{let v=0;new PerformanceObserver(l=>{for(const e of l.getEntries())v=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});setTimeout(()=>r(Math.round(v)),100)})")
        if not lcp or lcp > 2500: bad.append('%s %d мс' % (u, lcp))
        await ctx.close()
    report('speed', not bad, ', '.join(bad))


EMPTY = "[...document.querySelectorAll('.feed .pin-img')].filter(i=>{const r=i.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0&&i.tagName==='IMG'&&(i.src.startsWith('data:')||!i.naturalWidth)}).length"


async def check_feeds(b, base):
    bad = []
    for prof, kw in [('телефон', PHONE), ('ПК', DESK)]:
        ctx = await b.new_context(**kw); pg = await ctx.new_page()
        await pg.goto(base + 'portfolio.html#Кухни'); await pg.wait_for_timeout(1500)
        for f in ['Прихожие', 'Санузлы', 'Комплекс', 'Спальни', 'Кухни', 'Детские', 'Гостиные', 'Гардеробные']:
            await pg.click(f'button.chip:has-text("{f}")'); await pg.wait_for_timeout(1500)
            n = await pg.evaluate(EMPTY)
            await pg.mouse.wheel(0, 500); await pg.wait_for_timeout(800)
            n2 = await pg.evaluate(EMPTY)
            await pg.evaluate('scrollTo(0,0)'); await pg.wait_for_timeout(300)
            if n or n2: bad.append('%s %s: %d/%d пустых' % (prof, f, n, n2))
        await ctx.close()
    report('feeds', not bad, ', '.join(bad[:4]))


# play()/pause() без настоящего видео (в тестовом Chromium нет H.264) — как на телефоне: autoplay срабатывает с задержкой
STUB = """(()=>{const P=HTMLMediaElement.prototype;
P.play=function(){if(!this.__p){this.__p=true;this.dispatchEvent(new Event('play'));}return Promise.resolve()};
P.pause=function(){if(this.__p){this.__p=false;this.dispatchEvent(new Event('pause'));}};
Object.defineProperty(P,'paused',{configurable:true,get(){return !this.__p}});
const d=Object.getOwnPropertyDescriptor(P,'src');
Object.defineProperty(P,'src',{configurable:true,get(){return d.get.call(this)},set(v){d.set.call(this,v);if(this.hasAttribute('autoplay')){const me=this;setTimeout(()=>me.play(),350);}}});})();"""


async def check_one_video(b, base):
    random.seed(4)
    ctx = await b.new_context(**PHONE); await ctx.add_init_script(STUB)
    pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)[:80]))
    await pg.goto(base + 'portfolio.html#REELS'); await pg.wait_for_timeout(1500)
    touch = """(i)=>{const ps=document.querySelectorAll('.feed .pin');const p=ps[i%ps.length];if(!p)return;const el=p.querySelector('video')||p;const t=new Touch({identifier:Date.now()%1e6,target:el,clientX:10,clientY:10});el.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[t],targetTouches:[t],changedTouches:[t]}));}"""
    bad = 0
    for step in range(60):
        a = random.choice(['scroll', 'scroll', 'touch', 'touch', 'mode', 'feed'])
        if a == 'scroll': await pg.mouse.wheel(0, random.choice([-400, -200, 200, 400, 700]))
        elif a == 'touch': await pg.evaluate(touch, random.randint(0, 7))
        elif a == 'mode': await pg.click('.mode-btn >> nth=%d' % random.randint(0, 1))
        else:
            await pg.evaluate('scrollTo(0,0)'); await pg.wait_for_timeout(200)
            await pg.click('button.chip:has-text("%s")' % random.choice(['REELS', 'Комплекс']))
        await pg.wait_for_timeout(random.choice([150, 400, 900]))
        n = await pg.evaluate("[...document.querySelectorAll('.feed .pin video')].filter(v=>v.__p).length")
        if n > 1: bad += 1
    await ctx.close()
    report('one-video', bad == 0 and not errs, '%d раз играло больше одного видео %s' % (bad, errs[:1]) if bad or errs else '')


async def check_after_viewer(b, base):
    bad = []
    for prof, kw in [('телефон', PHONE), ('ПК', DESK)]:
        ctx = await b.new_context(**kw); pg = await ctx.new_page()
        await pg.goto(base + 'portfolio.html#Кухни'); await pg.wait_for_timeout(1500)
        await pg.locator('.feed .pin-btn').first.click(); await pg.wait_for_timeout(1500)
        await pg.evaluate("(()=>{const b=[...document.querySelectorAll('#lb-wrap button[aria-label=\"Закрыть\"]')].find(b=>b.getBoundingClientRect().width>0);b&&b.click();})()")
        await pg.wait_for_timeout(1200)
        if await pg.evaluate(EMPTY): bad.append(prof + ' Кухни пустые после просмотра')
        for f in ['Комплекс', 'REELS']:
            await pg.click(f'button.chip:has-text("{f}")'); await pg.wait_for_timeout(2000)
            no = await pg.evaluate("[...document.querySelectorAll('.feed .pin video')].filter(v=>{const r=v.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0&&!v.getAttribute('src')}).length")
            if no: bad.append('%s %s: %d видео без источника' % (prof, f, no))
        await ctx.close()
    report('after-viewer', not bad, ', '.join(bad))


SLIDES = "(()=>{const W=innerWidth;return [...document.querySelectorAll('#lb-track .lb-slide')].map(x=>{const r=x.getBoundingClientRect();const im=x.querySelector('img,video');return [im?(im.getAttribute('alt')||'v'):'',Math.round(r.left),Math.round(r.width)]}).filter(a=>a[1]<W&&a[1]+a[2]>0)})()"


async def check_slider(b, base):
    bad = []
    for u in ['portfolio.html#Кухни', 'project-2.html', 'project-7.html']:
        for i in range(3):
            ctx = await b.new_context(**DESK); pg = await ctx.new_page()
            await pg.goto(base + u); await pg.wait_for_timeout(2500)
            await throttle(ctx, pg, SLOW, nocache=True)
            await pg.locator('.pin-btn').nth(i).click(); await pg.wait_for_timeout(200)
            a = await pg.evaluate(SLIDES); await pg.wait_for_timeout(7000); c = await pg.evaluate(SLIDES)
            if a != c: bad.append('%s №%d' % (u, i + 1))
            await ctx.close()
    report('slider', not bad, 'перестраивается: ' + ', '.join(bad) if bad else '')


READY = "[...document.querySelectorAll('#lb-track .lb-slide img, .lb-vslide img')].filter(x=>{const r=x.getBoundingClientRect();return r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight}).map(x=>x.complete&&x.naturalWidth>1)"


async def check_ready(b, base):
    bad = []
    for prof, kw in [('ПК', DESK), ('телефон', PHONE)]:
        for u in ['portfolio.html#Прихожие', 'portfolio.html#Кухни', 'project-7.html']:
            ctx = await b.new_context(**kw); pg = await ctx.new_page()
            cdp = await throttle(ctx, pg, {'offline': False, 'latency': 80, 'downloadThroughput': 1500000, 'uploadThroughput': 300000})
            await pg.goto(base + u); await pg.wait_for_timeout(10000)
            await cdp.send('Network.emulateNetworkConditions', {'offline': True, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1})
            await pg.locator('.pin-btn').nth(2).click(); await pg.wait_for_timeout(80)
            r = await pg.evaluate(READY)
            if not r or not all(r): bad.append('%s %s %s' % (prof, u, r))
            await ctx.close()
    report('ready', not bad, 'не готовы: ' + ', '.join(bad) if bad else '')


async def main():
    from playwright.async_api import async_playwright
    s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = 'http://127.0.0.1:%d/' % port
    t0 = time.time()
    try:
        time.sleep(0.8)
        check_files()
        async with async_playwright() as p:
            b = await p.chromium.launch()
            await check_pages(b, base)
            await check_speed(b, base)
            await check_feeds(b, base)
            await check_one_video(b, base)
            await check_after_viewer(b, base)
            if not QUICK:
                await check_slider(b, base)
                await check_ready(b, base)
            await b.close()
    finally:
        srv.terminate()
    bad = [n for n, ok in results if not ok]
    print('\n%s  %d из %d проверок прошли (%d с)' % ('ВСЁ ХОРОШО' if not bad else 'ЕСТЬ ОШИБКИ: ' + ', '.join(bad), len(results) - len(bad), len(results), time.time() - t0))
    sys.exit(1 if bad else 0)


asyncio.run(main())
