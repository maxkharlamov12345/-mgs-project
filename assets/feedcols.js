/* MGS Mebel — кнопка «1 / 2 в ряд» для ленты на телефоне (все страницы с лентой).
   Выбор хранится в браузере посетителя и общий для всех страниц. Лента перестраивается «волной». */
(function () {
  var KEY = 'mgs-onecol';
  try { window.MGS_ONECOL = localStorage.getItem(KEY) === '1'; } catch (e) { window.MGS_ONECOL = false; }
  var css = '.mgs-cols{display:none;position:fixed;z-index:30;right:max(16px,env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));' +
    'width:48px;height:48px;border-radius:50%;border:1px solid #2c2824;background:rgba(21,19,17,.92);color:#bfd630;' +
    '-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:0 6px 20px rgba(0,0,0,.45);cursor:pointer;padding:0;align-items:center;justify-content:center}' +
    '.mgs-cols:focus-visible{outline:2px solid #bfd630;outline-offset:3px}' +
    '@media (max-width:759px){.mgs-cols{display:flex}}';
  // значок показывает, во что переключит кнопка: сетка 2×2 — «по 2 в ряд», один квадрат — «по 1 в ряд»
  var ICON2 = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="7" height="7" rx="1.6"/><rect x="11" y="2" width="7" height="7" rx="1.6"/><rect x="2" y="11" width="7" height="7" rx="1.6"/><rect x="11" y="11" width="7" height="7" rx="1.6"/></svg>';
  var ICON1 = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2.5"/></svg>';
  var reduce = false; try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function visiblePins() {
    var vh = innerHeight;
    return [].slice.call(document.querySelectorAll('.feed .pin')).map(function (el) { return { el: el, r: el.getBoundingClientRect() }; })
      .filter(function (o) { return o.r.bottom > -40 && o.r.top < vh + 40; })
      .sort(function (a, b) { return (a.r.top - b.r.top) || (a.r.left - b.r.left); });
  }
  function relayout() { window.dispatchEvent(new Event('resize')); }

  function toggle(btn) {
    var next = !window.MGS_ONECOL;
    var paint = function () { btn.innerHTML = next ? ICON2 : ICON1; btn.setAttribute('aria-label', next ? 'Показать по 2 в ряд' : 'Показать по 1 в ряд'); };
    var apply = function () {
      window.MGS_ONECOL = next; try { localStorage.setItem(KEY, next ? '1' : '0'); } catch (e) {}
      paint(); relayout();
    };
    var feed = document.querySelector('.feed');
    if (reduce || !feed || !feed.animate) { apply(); return; }
    // волна: старые плитки гаснут, новые всплывают по очереди (как при смене ленты в портфолио)
    var out = visiblePins().map(function (o) { return o.el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-10px)' }], { duration: 170, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }); });
    setTimeout(function () {
      apply();
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        out.forEach(function (a) { a.cancel(); });
        visiblePins().forEach(function (o, i) {
          o.el.animate([{ opacity: 0, transform: 'translateY(28px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: Math.min(i * 45, 450), easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
        });
      }); });
    }, 170);
  }

  function init() {
    if (document.getElementById('mgs-cols')) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var b = document.createElement('button'); b.type = 'button'; b.id = 'mgs-cols'; b.className = 'mgs-cols';
    b.innerHTML = window.MGS_ONECOL ? ICON2 : ICON1;
    b.setAttribute('aria-label', window.MGS_ONECOL ? 'Показать по 2 в ряд' : 'Показать по 1 в ряд');
    b.onclick = function () { toggle(b); };
    document.body.appendChild(b);
    if (window.MGS_ONECOL) relayout();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
