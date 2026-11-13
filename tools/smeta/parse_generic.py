"""Разбор PDF-прайсов фабрики (pdftotext -layout) в позиции: [раздел-заголовок, название, ед., цена].
Строка режется на куски по 2+ пробелам; тройка «название | ед. | цена» = позиция (в строке их может быть две — две колонки).
Цены вида 160/700 или 2290/2645/4625 разворачиваются в варианты по «а/б/в» в названии, иначе — берётся наибольшая."""
import re, sys, json
UNITS = {'шт','шт.','компл.','компл','пог.м','пог. м','м/п','м.п','м.п.','кв.м','м2','М2','пог.метр','3м','м/шт','м/шт/шт','пог.м.'}
num = re.compile(r'^\d[\d\s]*(?:[.,]\d+)?(?:\s*/\s*(?:\d[\d\s]*|[-\s]+))*$')
def price_list(s):
    out=[]
    for p in s.split('/'):
        p=p.strip().replace(' ','')
        if re.fullmatch(r'\d+(?:[.,]\d+)?',p): out.append(float(p.replace(',','.')))
        else: out.append(None)
    return out
def parse(path, src):
    items=[]; head=''
    for raw in open(path, encoding='utf-8'):
        line=raw.rstrip('\n')
        segs=[x.strip() for x in re.split(r'\s{2,}', line) if x.strip()]
        if not segs: continue
        i=0; got=False
        while i < len(segs):
            # name | unit | price   or   name unit | price  (unit glued)
            if i+2 < len(segs)+0 and i+2 <= len(segs)-1 and segs[i+1] in UNITS and num.match(segs[i+2]):
                items.append([head, segs[i], segs[i+1], segs[i+2], src]); i+=3; got=True; continue
            m = re.match(r'^(.*\S)\s+(шт\.?|компл\.?|пог\.\s?м|м\.п\.?|кв\.м|м/п)\s+(\d[\d\s/.,-]*)$', segs[i])
            if m and num.match(m.group(3).strip()):
                items.append([head, m.group(1), m.group(2), m.group(3), src]); i+=1; got=True; continue
            i+=1
        if not got and len(segs)<=2 and not re.search(r'\d{3}', line) and 4 < len(segs[0]) < 70 and segs[0][0].isupper():
            head=segs[0]
    return items
if __name__=='__main__':
    res=[]
    for a in sys.argv[1:]:
        p,src=a.split('=')
        res+=parse(p,src)
    json.dump(res, sys.stdout, ensure_ascii=False, indent=0)
