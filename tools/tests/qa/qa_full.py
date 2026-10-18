"""Дотошный обход сайта: чёрные кадры видео, прыжки вёрстки (layout shift), горизонтальная прокрутка,
битые картинки, обрезанный текст. Скриншоты контрольных точек — в qa_shots/."""
import asyncio, os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_black import Rec, BASE
from playwright.async_api import async_playwright
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'qa_shots'); os.makedirs(OUT, exist_ok=True)
DEV = {
  'se':     dict(viewport={'width': 375, 'height': 667}, is_mobile=True, has_touch=True, device_scale_factor=2),
  'i13':    dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2),
  'ipad':   dict(viewport={'width': 820, 'height': 1180}, is_mobile=True, has_touch=True, device_scale_factor=2),
  'lap':    dict(viewport={'width': 1280, 'height': 720}),
  'fhd':    dict(viewport={'width': 1920, 'height': 1080}),
}
SLOW = {'offline': False, 'latency': 150, 'downloadThroughput': 600000, 'uploadThroughput': 200000}
CLS_INIT = """window.__ls=[];try{new PerformanceObserver(l=>{for(const e of l.getEntries()){if(e.hadRecentInput)continue;window.__ls.push({v:e.value,t:Math.round(e.startTime),s:(e.sources||[]).map(s=>{const n=s.node;return n&&n.nodeType===1?(n.tagName+'.'+(n.className&&n.className.baseVal===undefined?n.className:'')).slice(0,40)+' '+JSON.stringify([Math.round(s.previousRect.y),Math.round(s.currentRect.y)]):'?'})})}}).observe({type:'layout-shift',buffered:true})}catch(e){}"""
LAYOUT = """(()=>{const o={};const de=document.documentElement;o.hscroll=de.scrollWidth>innerWidth+1?de.scrollWidth-innerWidth:0;
o.broken=[...document.images].filter(i=>{const r=i.getBoundingClientRect();return i.complete&&i.getAttribute('src')&&!i.getAttribute('src').startsWith('data:')&&i.naturalWidth===0&&r.width>0}).map(i=>i.getAttribute('src').split('/').pop()).slice(0,5);
o.clipped=[...document.querySelectorAll('button,a,span,h1,h2,p')].filter(e=>{const r=e.getBoundingClientRect();if(!r.width||r.top>innerHeight||r.bottom<0)return false;const cs=getComputedStyle(e);return (cs.whiteSpace==='nowrap'||cs.textOverflow==='ellipsis')&&e.scrollWidth>e.clientWidth+2&&e.children.length===0&&e.textContent.trim()}).map(e=>e.textContent.trim().slice(0,30)).slice(0,6);
o.offscreen=[...document.querySelectorAll('button,a')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&(r.right>innerWidth+2||r.left<-2)&&getComputedStyle(e).position==='fixed'}).map(e=>(e.getAttribute('aria-label')||e.textContent).trim().slice(0,30));
return o})()"""
findings = []

def note(dev, scen, what, detail):
    findings.append((dev, scen, what, detail)); print('  !!', dev, scen, what, str(detail)[:260], flush=True)

async def checkpoint(pg, dev, scen, name):
    lay = await pg.evaluate(LAYOUT)
    if lay['hscroll']: note(dev, scen, 'горизонтальная прокрутка', '%dpx @%s' % (lay['hscroll'], name))
    if lay['broken']: note(dev, scen, 'битые картинки', lay['broken'])
    if lay['clipped']: note(dev, scen, 'обрезанный текст', lay['clipped'])
    if lay['offscreen']: note(dev, scen, 'кнопка за краем', lay['offscreen'])
    await pg.screenshot(path=os.path.join(OUT, '%s_%s_%s.png' % (dev, scen, name)))

async def shifts(pg, dev, scen, since=0):
    ls = await pg.evaluate("window.__ls||[]")
    big = [x for x in ls if x['t'] >= since and x['v'] > 0.01]
    tot = sum(x['v'] for x in ls if x['t'] >= since)
    if tot > 0.05: note(dev, scen, 'прыжок вёрстки (CLS %.3f)' % tot, big[:3])

async def run(b, dev, scen, fn, slow=False):
    ctx = await b.new_context(**DEV[dev]); await ctx.add_init_script(CLS_INIT)
    pg = await ctx.new_page(); cdp = await ctx.new_cdp_session(pg); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
    pg.on('response', lambda r: errs.append('%d %s' % (r.status, r.url.split('/')[-1][:40])) if r.status >= 400 else None)
    if slow:
        await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', SLOW)
    rec = Rec(pg, cdp, 1)
    try:
        await fn(pg, rec, dev, scen)
    except Exception as e:
        note(dev, scen, 'сценарий упал', str(e)[:200])
    if rec.on: await rec.stop()
    sv = []
    bad = rec.black('', sv)
    for i, im in enumerate(sv): im.save(os.path.join(OUT, 'BLACK_%s_%s_%d.png' % (dev, scen, i)))
    if bad:
        note(dev, scen, 'чёрный кадр на видео (%d кадров)' % len(bad), bad[:3])
    for e in errs: note(dev, scen, 'ошибка', e)
    await ctx.close()

def mobile(dev): return dev in ('se', 'i13')

async def tap(pg, sel, i=0):
    await pg.locator(sel).nth(i).click()

async def close_lb(pg):
    await pg.evaluate("(()=>{const b=[...document.querySelectorAll('#lb-wrap button[aria-label=\"Закрыть\"], [aria-label=\"Закрыть\"]')].find(b=>b.getBoundingClientRect().width>0);b&&b.click();})()")

# ---------- сценарии ----------
async def s_portfolio_start(pg, rec, dev, scen):
    await rec.start()
    await pg.goto(BASE + 'portfolio.html'); await pg.wait_for_timeout(3500)
    await checkpoint(pg, dev, scen, 'complex')
    await pg.mouse.wheel(0, 700); await pg.wait_for_timeout(1500)
    await checkpoint(pg, dev, scen, 'complex_scrolled')
    await shifts(pg, dev, scen)

async def s_feeds(pg, rec, dev, scen):
    await pg.goto(BASE + 'portfolio.html'); await pg.wait_for_timeout(2500)
    await rec.start()
    for f in ['REELS', 'Кухни', 'Спальни', 'Гардеробные', 'Прихожие', 'Санузлы', 'Детские', 'Гостиные', 'Комплекс']:
        t0 = await pg.evaluate('performance.now()')
        await pg.click(f'button.chip:has-text("{f}")'); await pg.wait_for_timeout(1600)
        await checkpoint(pg, dev, scen, f)
        await pg.mouse.wheel(0, 900); await pg.wait_for_timeout(900)
        await pg.evaluate('scrollTo(0,0)'); await pg.wait_for_timeout(400)
        await shifts(pg, dev, scen + ':' + f, since=t0 + 900)   # волна — намеренная анимация первых ~0,9 с

async def s_reels_phone(pg, rec, dev, scen):
    await pg.goto(BASE + 'portfolio.html#REELS'); await pg.wait_for_timeout(3000)
    await rec.start()
    for i in range(3):
        await pg.evaluate("""(i)=>{const p=document.querySelectorAll('.feed .pin')[i];if(!p)return;const el=p.querySelector('video')||p;const r=el.getBoundingClientRect();const t=new Touch({identifier:Date.now()%1e6,target:el,clientX:r.left+20,clientY:r.top+20});el.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[t],targetTouches:[t],changedTouches:[t]}));}""", i); await pg.wait_for_timeout(1500)
        playing = await pg.evaluate("[...document.querySelectorAll('.feed .pin video')].filter(v=>!v.paused).length")
        if playing > 1: note(dev, scen, 'играет больше одного видео', playing)
    await checkpoint(pg, dev, scen, 'grid_tapped')
    if await pg.locator('.mode-btn').count():
        await pg.locator('.mode-btn').nth(1).click(); await pg.wait_for_timeout(1500)
        await checkpoint(pg, dev, scen, 'slide')
        for _ in range(4):
            await pg.mouse.wheel(0, 500); await pg.wait_for_timeout(1300)
        await checkpoint(pg, dev, scen, 'slide_scrolled')
        await pg.locator('.mode-btn').nth(0).click(); await pg.wait_for_timeout(1500)
        await checkpoint(pg, dev, scen, 'grid_again')

async def s_complex_roundtrip(pg, rec, dev, scen):
    await pg.goto(BASE + 'portfolio.html'); await pg.wait_for_timeout(3500)
    await rec.start()
    await pg.locator('.cx-pin a').first.click(); await pg.wait_for_timeout(4000)
    await checkpoint(pg, dev, scen, 'project')
    await pg.go_back(); await pg.wait_for_timeout(3000)
    await checkpoint(pg, dev, scen, 'back_portfolio')
    await pg.locator('.cx-pin a').nth(1).click(); await pg.wait_for_timeout(4000)
    await pg.go_back(); await pg.wait_for_timeout(1500)
    await pg.go_forward(); await pg.wait_for_timeout(3000)
    await checkpoint(pg, dev, scen, 'project2_again')

async def s_project(pg, rec, dev, scen, page='project-2.html'):
    await rec.start()
    await pg.goto(BASE + page); await pg.wait_for_timeout(3500)
    await checkpoint(pg, dev, scen, 'top')
    await shifts(pg, dev, scen + ':load')
    for k in range(4):
        await pg.mouse.wheel(0, 800); await pg.wait_for_timeout(900)
    await checkpoint(pg, dev, scen, 'mid')
    await pg.evaluate('scrollTo(0,0)'); await pg.wait_for_timeout(800)
    # фото в просмотре
    btns = pg.locator('.pin-btn')
    await btns.nth(1).click(); await pg.wait_for_timeout(1500)
    await checkpoint(pg, dev, scen, 'viewer')
    if not mobile(dev):
        for _ in range(3):
            await pg.keyboard.press('ArrowRight'); await pg.wait_for_timeout(700)
        await checkpoint(pg, dev, scen, 'viewer_next3')
    else:
        await pg.mouse.wheel(0, 700); await pg.wait_for_timeout(900)
        await checkpoint(pg, dev, scen, 'viewer_scrolled')
    await close_lb(pg); await pg.wait_for_timeout(1200)
    await checkpoint(pg, dev, scen, 'closed')
    # рилсы проекта
    v = pg.locator('button[aria-label="Открыть REELS"]')
    if await v.count():
        await v.first.click(); await pg.wait_for_timeout(2500)
        await checkpoint(pg, dev, scen, 'reels')
        await close_lb(pg); await pg.wait_for_timeout(1500)
        await checkpoint(pg, dev, scen, 'reels_closed')

async def s_portfolio_viewer(pg, rec, dev, scen):
    await pg.goto(BASE + 'portfolio.html#Кухни'); await pg.wait_for_timeout(4000)
    await rec.start()
    for i in [0, 3]:
        await pg.locator('.feed .pin-btn').nth(i).click(); await pg.wait_for_timeout(1500)
        await checkpoint(pg, dev, scen, 'item%d' % i)
        if not mobile(dev):
            await pg.keyboard.press('ArrowRight'); await pg.wait_for_timeout(800)
            await pg.keyboard.press('ArrowLeft'); await pg.wait_for_timeout(800)
        else:
            await pg.mouse.wheel(0, 600); await pg.wait_for_timeout(900)
            await checkpoint(pg, dev, scen, 'item%d_scrolled' % i)
        await close_lb(pg); await pg.wait_for_timeout(1000)
    await pg.click('button.chip:has-text("REELS")'); await pg.wait_for_timeout(2500)
    await pg.locator('.feed .pin-btn, .feed .pin button').first.click(); await pg.wait_for_timeout(2500)
    await checkpoint(pg, dev, scen, 'reel_viewer')
    await close_lb(pg); await pg.wait_for_timeout(1500)
    await checkpoint(pg, dev, scen, 'reel_closed')

async def main():
    only = sys.argv[1:] or list(DEV)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for dev in only:
            print('==', dev, flush=True)
            await run(b, dev, 'start', s_portfolio_start)
            await run(b, dev, 'feeds', s_feeds)
            if mobile(dev): await run(b, dev, 'reels', s_reels_phone)
            await run(b, dev, 'roundtrip', s_complex_roundtrip)
            await run(b, dev, 'p2', lambda pg, r, d, s: s_project(pg, r, d, s, 'project-2.html'))
            await run(b, dev, 'p1', lambda pg, r, d, s: s_project(pg, r, d, s, 'index.html'))
            await run(b, dev, 'pviewer', s_portfolio_viewer)
            if dev in ('i13', 'lap'):
                await run(b, dev, 'slow_start', s_portfolio_start, slow=True)
                await run(b, dev, 'slow_p2', lambda pg, r, d, s: s_project(pg, r, d, s, 'project-2.html'), slow=True)
                await run(b, dev, 'slow_roundtrip', s_complex_roundtrip, slow=True)
        await b.close()
    json.dump(findings, open(os.path.join(OUT, 'findings.json'), 'w'), ensure_ascii=False, indent=1)
    print('\nИТОГО замечаний:', len(findings))

asyncio.run(main())
