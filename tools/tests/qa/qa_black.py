"""Детектор чёрных кадров на видео-плитках: снимаем экран при каждой перерисовке (CDP screencast)
и смотрим, не стала ли какая-то видимая видео-плитка почти целиком чёрной."""
import asyncio, base64, io, sys
from PIL import Image
from playwright.async_api import async_playwright
BASE = 'http://127.0.0.1:8799/'
PHONE = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
DESK = dict(viewport={'width': 1440, 'height': 900})
RECTS = """[...document.querySelectorAll('video')].map(v=>{const box=v.closest('.pin,.lb-slide,.lb-vslide')||v;const r=box.getBoundingClientRect();
const cx=Math.min(innerWidth-2,Math.max(1,r.left+r.width/2)),cy=Math.min(innerHeight-2,Math.max(1,r.top+r.height/2));
const top=document.elementFromPoint(cx,cy);let op=1,e=box;while(e&&e!==document.body){op*=parseFloat(getComputedStyle(e).opacity);e=e.parentElement}
const vis=top&&(box.contains(top)||top===box)&&op>0.3;return vis?[r.left,r.top,r.width,r.height]:null}).filter(r=>r&&r[2]>40&&r[3]>40&&r[1]<innerHeight&&r[1]+r[3]>0&&r[0]<innerWidth&&r[0]+r[2]>0)"""

class Rec:
    def __init__(s, pg, cdp, scale):
        s.pg, s.cdp, s.scale, s.frames, s.rects, s.on = pg, cdp, scale, [], [], False
    async def start(s):
        s.on = True
        s.cdp.on('Page.screencastFrame', s._frame)
        await s.cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': 60, 'everyNthFrame': 1})
        s._t = asyncio.ensure_future(s._poll())
    async def _poll(s):
        while s.on:
            try: s.rects.append((asyncio.get_event_loop().time(), await s.pg.evaluate(RECTS)))
            except Exception: pass
            await asyncio.sleep(0.03)
    def _frame(s, ev):
        s.frames.append((asyncio.get_event_loop().time(), ev['data'], ev['metadata']))
        asyncio.ensure_future(s.cdp.send('Page.screencastFrameAck', {'sessionId': ev['sessionId']}))
    async def stop(s):
        s.on = False; await s.cdp.send('Page.stopScreencast'); await asyncio.sleep(0.05)
    def black(s, tag, save=None):
        bad = []
        for t, data, md in s.frames:
            rs = [r for (tt, r) in s.rects if tt <= t]
            if not rs: continue
            rects = rs[-1]
            im = Image.open(io.BytesIO(base64.b64decode(data))).convert('L')
            k = im.width / md['deviceWidth']
            for (x, y, w, h) in rects:
                box = (max(0, int(x * k)), max(0, int((y + 0) * k)), min(im.width, int((x + w) * k)), min(im.height, int((y + h) * k)))
                if box[2] - box[0] < 60 * k or box[3] - box[1] < 60 * k: continue   # видна только узкая полоска — не считаем
                # центр плитки (без плашек по краям)
                cx0 = box[0] + (box[2] - box[0]) // 5; cx1 = box[2] - (box[2] - box[0]) // 5
                cy0 = box[1] + (box[3] - box[1]) // 5; cy1 = box[3] - (box[3] - box[1]) // 5
                reg = im.crop((cx0, cy0, cx1, cy1)).resize((40, 40))
                px = list(reg.getdata()); dark = sum(1 for v in px if v < 14) / len(px)
                if dark > 0.85:
                    bad.append((round(t, 2), (int(x), int(y), int(w), int(h)), round(dark, 2)))
                    if save is not None and len(save) < 6:
                        from PIL import ImageDraw
                        fi = Image.open(io.BytesIO(base64.b64decode(data))).convert('RGB'); d = ImageDraw.Draw(fi)
                        d.rectangle(box, outline=(255, 0, 0), width=4); save.append(fi)
        return bad
