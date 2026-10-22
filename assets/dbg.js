/* Временная диагностика для iPhone: открыть страницу с ?dbg в адресе.
   Показывает размеры экрана/окна просмотра и что лежит в самом верху экрана. Обычные посетители этого не видят. */
(function () {
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:8px;right:8px;top:45%;z-index:2147483647;background:rgba(200,0,0,.88);color:#fff;font:12px/1.35 monospace;padding:8px;border-radius:8px;pointer-events:none;white-space:pre-wrap';
  var top0 = document.createElement('div');   // красная полоска: где у браузера «верх» для закреплённых элементов
  top0.style.cssText = 'position:fixed;left:0;width:40px;top:0;height:6px;background:#f00;z-index:2147483647;pointer-events:none';
  function d(el) { if (!el) return '-'; var c = (el.className && el.className.baseVal === undefined ? el.className : '') || ''; return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (c ? '.' + String(c).trim().split(/\s+/).slice(0, 2).join('.') : ''); }
  function r(n) { return Math.round(n); }
  function tick() {
    var vv = window.visualViewport, lb = document.getElementById('lb-wrap'), lr = lb && lb.getBoundingClientRect();
    var cs = lb && getComputedStyle(lb);
    var hits = [2, 20, 40, 60].map(function (y) { return y + ':' + d(document.elementFromPoint(innerWidth / 2, y)); });
    box.textContent =
      'inner ' + innerWidth + 'x' + innerHeight + '  client ' + document.documentElement.clientHeight + '  screen ' + screen.height + '\n' +
      'vv h ' + (vv ? r(vv.height) + ' offTop ' + r(vv.offsetTop) + ' pageTop ' + r(vv.pageTop) + ' scale ' + vv.scale.toFixed(2) : '-') + '\n' +
      'scrollY ' + r(scrollY) + '  body h ' + document.body.scrollHeight + '\n' +
      'lb ' + (lr ? 'top ' + r(lr.top) + ' h ' + r(lr.height) + ' scrollTop ' + r(lb.scrollTop) + ' op ' + cs.opacity + ' tf ' + cs.transform.slice(0, 30) : 'нет') + '\n' +
      hits.join('\n') + '\n' +
      'safeTop ' + (function () { var e = document.getElementById('_sat'); if (!e) { e = document.createElement('div'); e.id = '_sat'; e.setAttribute('data-dbg', ''); e.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top);width:1px;visibility:hidden'; document.body.appendChild(e); } return e.offsetHeight; })() +
      '  screens ' + [].map.call(document.querySelectorAll('.screen'), function (x) { return r(x.getBoundingClientRect().top); }).join(',');
    requestAnimationFrame(function () { setTimeout(tick, 150); });
  }
  function start() { box.setAttribute('data-dbg', ''); top0.setAttribute('data-dbg', ''); document.body.appendChild(box); document.body.appendChild(top0); tick(); }
  if (document.body) start(); else addEventListener('DOMContentLoaded', start);
})();
