"""«Просмотр как лента» (Макс 23.10): на телефоне (<1000px) просмотр изделия — не окно поверх страницы, а сама страница.
Лента прячется (display:none), фото изделия идут одно под другим, листается окно браузера — Safari/Chrome прячут свои панели,
фото уходят под часы и нижнюю строку. Компьютер не меняется.

  python3 tools/flow_viewer.py <исходная.html> <результат.html>

Что делает с копией страницы (страницы проектов и portfolio.html устроены одинаково):
- html.lb-on (ставит сам код, без :has — работает и в старых браузерах): лента и всё вне просмотра скрыты, #lb-wrap в потоке;
- примагничивание фото — на html; описание после последнего фото листается свободно (html.lb-free), иначе низ дёргался;
- при открытии примагничивание на миг выключено (html.lb-hold) — Safari не уводит на другое фото;
- место в ленте запоминается при касании и восстанавливается после закрытия;
- «Назад» браузера/телефона закрывает просмотр (history.pushState при открытии);
- видео ленты, пока открыт просмотр, не выгружаются — после закрытия лента сразу с видео.
"""
import sys

src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()


def rep(a, b, n=1):
    global s
    c = s.count(a)
    assert c == n, (a[:80], c)
    s = s.replace(a, b)


CSS = '''<style>
/* «просмотр как лента» (tools/flow_viewer.py): на телефоне просмотр — сама страница, не окно поверх */
@media (max-width: 999px){
  html.lb-on{scroll-snap-type:y mandatory;scroll-padding-top:5px}
  html.lb-on .sc-host > div > :not(#lb-wrap):not([role=dialog]),
  html.lb-on body > :not(#dc-root):not(script):not(style):not([data-dbg]){display:none !important}
  html.lb-on #lb-wrap{position:relative !important;inset:auto !important;overflow:visible !important;min-height:100lvh;scroll-snap-type:none !important}
  html.lb-on .lb-close-v,html.lb-on .lb-vcount{top:calc(14px + env(safe-area-inset-top)) !important}
  /* описание после последнего фото — без примагничивания (lb-free ставит vScroll); последнее фото без описания —
     точка у самого низа страницы (достижима при любой высоте экрана — не дёргается, когда браузер прячет панели) */
  html.lb-on .lb-panel{scroll-snap-align:none !important;flex-grow:1}
  html.lb-on #lb-wrap::after{content:"";display:block;flex:none;height:1px;scroll-snap-align:end}
  html.lb-free,html.lb-hold{scroll-snap-type:none !important}
  html.lb-free .lb-vcount{opacity:0;transition:opacity .2s}  /* на описании счётчик фото не налезает на заголовок */
}
</style>
'''
rep('</head>', CSS + '</head>')
if '<meta name="robots"' not in s:
    rep('<title>', '<meta name="robots" content="noindex"><title>')

# vScroll: на телефоне прокрутка — у окна
rep("""      vScroll: function (e) {
        if (window.innerWidth >= 1000) return;
        var el = e.currentTarget, sl = el.querySelectorAll('.lb-vslide'), k = 0;
        for (var i = 0; i < sl.length; i++) if (sl[i].offsetTop <= el.scrollTop + el.clientHeight * 0.4) k = i;""",
    """      vScroll: self._vs = function (e) {
        if (window.innerWidth >= 1000) return;
        var el = document.getElementById('lb-wrap'); if (!el) return;
        var stp = window.scrollY, chh = window.innerHeight;
        var sl = el.querySelectorAll('.lb-vslide'), k = 0;
        for (var i = 0; i < sl.length; i++) if (sl[i].offsetTop <= stp + chh * 0.4) k = i;
        // описание после последнего фото листается свободно, вернулся к последнему фото — снова примагничивание
        var pnl = el.querySelector('.lb-panel'), lastS = sl[sl.length - 1];
        document.documentElement.classList.toggle('lb-free', !!pnl && pnl.offsetParent !== null && !!lastS && stp > lastS.offsetTop - 5 + 40);""")
rep("el.scrollTop + el.clientHeight * 0.5 >= panel.offsetTop", "stp + chh * 0.5 >= panel.offsetTop")

# vsnap: ставим окно браузера на нужное фото
rep("""    el.style.scrollSnapType = 'none'; el.scrollTop = c ? Math.max(0, c.offsetTop - 5) : 0; el.style.scrollSnapType = '';""",
    """    var de = document.documentElement; de.classList.add('lb-hold');
    window.scrollTo({ top: c ? Math.max(0, c.getBoundingClientRect().top + window.scrollY - 5) : 0, behavior: 'instant' });
    requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(function () { de.classList.remove('lb-hold'); }, 60); }); });""")

# componentDidMount: место в ленте, прокрутка окна, «Назад»
rep("  componentDidMount() {", """  componentDidMount() {
    var fm = this, phoneW = function () { return window.innerWidth < 1000; };
    document.addEventListener('pointerdown', function () {
      if (fm.state.lb >= 0 || !phoneW()) return;
      fm._feedY = window.scrollY;
      // на миг выключаем примагничивание — иначе Safari, увидев просмотр на месте прокрутки ленты, примагничивал к случайному фото
      document.documentElement.classList.add('lb-hold');
    }, true);
    window.addEventListener('scroll', function () { if (fm.state.lb >= 0 && phoneW() && fm._vs) fm._vs({}); }, { passive: true });
    // «Назад» браузера/телефона закрывает просмотр
    window.addEventListener('popstate', function () { if (fm.state.lb >= 0 && fm._lbHist) { fm._lbHist = false; fm._byBack = true; fm.setState({ lb: -1, lbZone: null, lbStart: 0 }); } });
    try { if (history.state && history.state.mgsLb) history.replaceState(null, ''); } catch (e) {}""")

# componentDidUpdate: открытие/закрытие на телефоне
CDU = "  componentDidUpdate(prev) {" if "  componentDidUpdate(prev) {" in s else "  componentDidUpdate() {"
rep(CDU, CDU + """
    var wasLb = this._wasLb, isLb = this.state.lb >= 0, de = document.documentElement; this._wasLb = isLb;
    if (isLb && !wasLb && window.innerWidth < 1000) {
      de.classList.add('lb-on');
      try { history.pushState({ mgsLb: 1 }, ''); this._lbHist = true; } catch (e) {}
    }
    if (!isLb && wasLb) {
      var hadOn = de.classList.contains('lb-on');
      de.classList.remove('lb-on', 'lb-free', 'lb-hold');
      if (hadOn && this._feedY != null) window.scrollTo({ top: this._feedY, behavior: 'instant' });
      // закрыли крестиком/Esc — убираем свою запись из истории, чтобы следующий «Назад» не был пустым
      if (this._lbHist && !this._byBack) { this._lbHist = false; try { history.back(); } catch (e) {} }
      this._byBack = false;
    }""")

# видео ленты, пока открыт просмотр, не выгружаем (только пауза)
n = s.count("if (!el.getAttribute('data-lb') && el.getAttribute('src')) {")
if n:
    rep("if (!el.getAttribute('data-lb') && el.getAttribute('src')) {",
        "if (!el.getAttribute('data-lb') && el.getAttribute('src') && !document.documentElement.classList.contains('lb-on')) {", n)

# ссылки между страницами теста ведут на такие же тестовые страницы (-flow), если передан флаг --links
if '--links' in sys.argv:
    for nm in ['index', 'project-2', 'project-5', 'project-6', 'project-7', 'project-8', 'portfolio']:
        s = s.replace("href: '%s.html'" % nm, "href: '%s-flow.html'" % nm).replace('href="%s.html"' % nm, 'href="%s-flow.html"' % nm)

open(dst, 'w', encoding='utf-8').write(s)
print('ok', dst, 'video-keep:', n)
