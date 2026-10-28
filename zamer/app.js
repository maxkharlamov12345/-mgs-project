/* MGS Замер — приложение замерщика.
   Шаги: Объект → Стены → Помещение → Проверка → Чертёж 2D → 3D → Файлы.
   Замеры хранятся на устройстве (localStorage), фото — в IndexedDB. На сервер ничего не уходит. */
(function () {
  'use strict';
  var Z = window.ZG, num = Z.num, minOf = Z.minOf, TYPES = Z.TYPES, CATS = Z.CATS;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var app = $('#app'), top = $('#top');

  /* ---------------- справочники ---------------- */
  var ROOMS = [['kitchen', 'Кухня'], ['bath', 'Ванная / санузел'], ['room', 'Комната'], ['hall', 'Прихожая / коридор'], ['other', 'Другое']];
  var P_COMMON = [
    { k: 'wallMat', t: 'Материал стен', opts: ['Бетон / монолит', 'Кирпич', 'Газобетон / пеноблок', 'ГКЛ', 'Дерево', 'Другое'], req: 1 },
    { k: 'wallState', t: 'Состояние стен', opts: ['Чистовая отделка', 'Под покраску / шпаклёвка', 'Черновые', 'Будут менять'], req: 1 },
    { k: 'floor', t: 'Пол', opts: ['Чистовой', 'Стяжка (черновой)', 'Будет плитка', 'Будет ламинат / паркет', 'Тёплый пол'], req: 1 },
    { k: 'ceiling', t: 'Потолок', opts: ['Натяжной', 'ГКЛ', 'Покраска', 'Будет натяжной', 'Будет ГКЛ', 'Другое'], req: 1 },
    { k: 'floorDiff', t: 'Перепад пола по уровню, мм', n: 1, req: 1 },
    { k: 'ceilDrop', t: 'Опуск будущего потолка, мм', n: 1 },
    { k: 'ground', t: 'Заземление в розетках', opts: ['Есть', 'Нет', 'Не проверено'] },
    { k: 'access', t: 'Подъезд, этаж, лифт, заносимость', txt: 1 }
  ];
  var P_TYPE = {
    kitchen: [
      { k: 'stove', t: 'Плита', opts: ['Газовая', 'Индукционная', 'Электрическая', 'Нет / своя'], req: 1 },
      { k: 'hood', t: 'Вытяжка', opts: ['Купольная', 'Встроенная', 'Наклонная', 'Рециркуляция', 'Нет'], req: 1 },
      { k: 'topH', t: 'Высота столешницы, мм', n: 1, req: 1 },
      { k: 'builtin', t: 'Встраиваемая техника (ПММ, духовка, СВЧ…)', txt: 1, req: 1 },
      { k: 'fridge', t: 'Холодильник: размеры / место', txt: 1 },
      { k: 'sink', t: 'Мойка: тип / размер', txt: 1 }
    ],
    bath: [
      { k: 'bathT', t: 'Ванна / душ', opts: ['Ванна', 'Душевая', 'Душевой трап', 'Нет'] },
      { k: 'wc', t: 'Унитаз', opts: ['Напольный', 'Инсталляция', 'Нет'] },
      { k: 'washer', t: 'Стиральная машина здесь', opts: ['Да', 'Нет'] },
      { k: 'heater', t: 'Бойлер', opts: ['Есть', 'Нет', 'Будет'] }
    ],
    hall: [
      { k: 'what', t: 'Что ставим (шкаф, обувница…)', txt: 1 },
      { k: 'entry', t: 'Входная дверь открывается', opts: ['Внутрь', 'Наружу'] },
      { k: 'panels', t: 'Щитки / домофон на стенах', opts: ['Есть, отмечены', 'Нет'] }
    ],
    room: [{ k: 'purpose', t: 'Назначение', opts: ['Спальня', 'Гостиная', 'Детская', 'Кабинет', 'Гардеробная'] }],
    other: []
  };
  var OPEN_W = ['Глухое', 'Поворотное', 'Поворотно-откидное', 'Створки распашные', 'Раздвижное'];
  var OPEN_D = ['Внутрь, петли слева', 'Внутрь, петли справа', 'Наружу, петли слева', 'Наружу, петли справа', 'Раздвижная', 'Нет полотна'];
  var CABLE_FOR = ['Варочная панель / плита', 'Духовой шкаф', 'ПММ', 'Холодильник', 'Вытяжка', 'СВЧ', 'Подсветка', 'Стиральная машина', 'Другое'];
  var CHECKLIST = ['Каждая стена сфотографирована целиком', 'Сфотографированы узлы: трубы, счётчики, щиток, стояки', 'Записаны пожелания заказчика', 'Уточнены модели и размеры техники', 'Учтено открывание дверей и окон', 'Проверены уровень пола и вертикаль стен'];
  var TABS = [['obj', 'Объект'], ['walls', 'Стены'], ['room', 'Помещение'], ['check', 'Проверка'], ['d2', 'Чертёж 2D'], ['d3', '3D'], ['files', 'Файлы']];

  /* ---------------- хранение ---------------- */
  var KEY = 'mgsz:';
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { toast('Не удалось сохранить: память браузера заполнена'); return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function listAll() {
    var out = [];
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(KEY) === 0) { try { out.push(JSON.parse(localStorage.getItem(k))); } catch (e) {} } } } catch (e) {}
    return out.sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
  }
  var saveT = null;
  function save() {
    if (!M) return;
    M.updated = Date.now();
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      if (lsSet(KEY + M.id, JSON.stringify(M))) { var s = $('.saved'); if (s) { s.classList.add('on'); clearTimeout(s._t); s._t = setTimeout(function () { s.classList.remove('on'); }, 1200); } }
    }, 250);
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* фото — IndexedDB */
  var dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (ok, no) {
      var r = indexedDB.open('mgs-zamer', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('photos'); };
      r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); };
    });
    return dbP;
  }
  function idb(mode, fn) { return db().then(function (d) { return new Promise(function (ok, no) { var tx = d.transaction('photos', mode), st = tx.objectStore('photos'), q = fn(st); tx.oncomplete = function () { ok(q && q.result); }; tx.onerror = function () { no(tx.error); }; }); }); }
  var urlCache = {};
  function photoURL(id) {
    if (urlCache[id]) return Promise.resolve(urlCache[id]);
    return idb('readonly', function (s) { return s.get(id); }).then(function (b) { if (!b) return ''; return (urlCache[id] = URL.createObjectURL(b)); });
  }
  function putPhoto(id, blob) { return idb('readwrite', function (s) { return s.put(blob, id); }); }
  function delPhoto(id) { delete urlCache[id]; return idb('readwrite', function (s) { return s['delete'](id); }); }
  function compress(file) {
    return new Promise(function (ok) {
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
        c.toBlob(function (b) { ok(b || file); }, 'image/jpeg', 0.78);
      };
      img.onerror = function () { ok(file); };
      img.src = u;
    });
  }

  /* ---------------- состояние ---------------- */
  var M = null;
  var S = { screen: 'list', tab: 'obj', wall: 0, elev: 0, sheet: null, v3: 'out', labels: true, nw: { name: '', address: '', type: 'kitchen', n: 4, H: '' } };

  function newWall(i) { return { name: 'Стена ' + (i + 1), len: ['', '', ''], hgt: ['', '', ''], angle: '', cats: {}, items: [], photos: [], note: '' }; }
  function newMeasure(o) {
    var m = { id: uid(), v: 1, created: Date.now(), updated: Date.now(), name: o.name || 'Замер', client: '', phone: '', date: new Date().toISOString().slice(0, 10), address: o.address || '', roomType: o.type, roomName: '', H: o.H || '', T: '150', walls: [], room: {}, photos: [], wishes: '', checklist: {} };
    for (var i = 0; i < o.n; i++) m.walls.push(newWall(i));
    return m;
  }

  /* ---------------- утилиты ---------------- */
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return n === null || n === undefined || !isFinite(n) ? '—' : String(Math.round(n * 10) / 10).replace('.', ','); }
  function getP(o, p) { return p.split('.').reduce(function (a, k) { return a === null || a === undefined ? undefined : a[k]; }, o); }
  function setP(o, p, v) { var ks = p.split('.'), last = ks.pop(); var t = ks.reduce(function (a, k) { if (a[k] === undefined) a[k] = /^\d+$/.test(k) ? [] : {}; return a[k]; }, o); t[last] = v; }
  function toast(t) { var d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2600); }
  function inp(p, o) {
    o = o || {}; var v = getP(o.root || M, p);
    var ph = o.ph ? ' placeholder="' + esc(o.ph) + '"' : '';
    var im = o.n ? ' inputmode="decimal"' : '';
    if (o.ta) return '<textarea data-p="' + p + '"' + ph + (o.d ? ' data-d="1"' : '') + '>' + esc(v) + '</textarea>';
    return '<input data-p="' + p + '"' + (o.d ? ' data-d="1"' : '') + ph + im + ' value="' + esc(v) + '"' + (o.type ? ' type="' + o.type + '"' : '') + '>';
  }
  function sel(p, opts, o) {
    o = o || {}; var v = getP(o.root || M, p) || '';
    return '<select data-p="' + p + '"' + (o.d ? ' data-d="1"' : '') + '><option value="">— выберите —</option>' + opts.map(function (x) { return '<option' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>';
  }
  function fld(label, html, req) { return '<div class="fld"><label class="f' + (req ? ' req' : '') + '">' + esc(label) + '</label>' + html + '</div>'; }
  function wallL(w) { return minOf(w.len); }
  function wallH(w, m) { m = m || M; return minOf(w.hgt) || num(m && m.H) || 2700; }
  function translit(s) {
    var m = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
    return String(s || 'zamer').toLowerCase().split('').map(function (c) { return m[c] !== undefined ? m[c] : c; }).join('').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'zamer';
  }

  /* ---------------- проверка ---------------- */
  function itemMissing(it, wall, m) {
    var ty = TYPES[it.type] || TYPES.other, k = ty.kind, miss = [];
    if (num(it.off) === null) miss.push(k === 'point' || k === 'pipe' ? 'расстояние от угла до центра' : 'отступ от угла');
    if (k === 'open') {
      if (num(it.z) === null && !ty.floor) miss.push('высота от пола');
      if (!minOf(it.w)) miss.push('ширина'); if (!minOf(it.h)) miss.push('высота');
      if (num(it.depth) === null) miss.push('глубина откоса');
      if (it.type !== 'arch' && !it.opening) miss.push('тип открывания');
    } else if (k === 'point') {
      if (num(it.z) === null) miss.push('высота от пола');
      if (it.type === 'cable' && !it.purpose) miss.push('под какую технику');
    } else if (k === 'pipe') {
      if (!num(it.dia)) miss.push('диаметр');
    } else {
      if (num(it.z) === null && !ty.floor && !ty.top) miss.push('высота от пола');
      if (!num(it.w0)) miss.push('ширина'); if (!num(it.h0)) miss.push('высота');
      if (num(it.depth) === null && !ty.flat) miss.push('выступ от стены');
    }
    var L = wallL(wall);
    if (L && !miss.length) { var b = Z.itemBox(it, L, wallH(wall, m)); if (b && (b.u0 < -1 || b.u1 > L + 1)) miss.push('элемент выходит за длину стены — проверьте отступ'); }
    return miss;
  }
  function itemLabel(it, n) { return '№' + n + ' ' + ((TYPES[it.type] || {}).t || 'Элемент'); }
  function wallMeasured(w) { return Z.vals(w.len).length && Z.vals(w.hgt).length; }
  function catState(w, c) {
    var has = (w.items || []).some(function (it) { return c.types.indexOf(it.type) >= 0; });
    if (has) return 'has'; if (w.cats && w.cats[c.k] === 'none') return 'none'; return c.opt ? 'opt' : 'todo';
  }
  function check(m) {
    var E = [], W = [], all = [];
    function add(arr, t, go) { arr.push({ t: t, go: go }); }
    m.walls.forEach(function (w, wi) {
      var nm = w.name || ('Стена ' + (wi + 1)), go = { tab: 'walls', wall: wi };
      var lv = Z.vals(w.len).length, hv = Z.vals(w.hgt).length;
      if (lv < 3) add(lv ? W : E, nm + ': длина измерена ' + (lv ? 'не в 3 точках' : 'не измерена') + ' (низ, середина, верх)', go);
      if (hv < 3) add(hv ? W : E, nm + ': высота измерена ' + (hv ? 'не в 3 точках' : 'не измерена') + ' (слева, центр, справа)', go);
      var lv2 = Z.vals(w.len); if (lv2.length > 1 && Math.max.apply(null, lv2) - Math.min.apply(null, lv2) > 15) add(W, nm + ': длины в разных точках отличаются на ' + Math.round(Math.max.apply(null, lv2) - Math.min.apply(null, lv2)) + ' мм — завал стены, учтите при проектировании', go);
      var todo = CATS.filter(function (c) { return catState(w, c) === 'todo'; }).map(function (c) { return c.t; });
      if (todo.length) add(E, nm + ': не проверено — ' + todo.join(', ') + ' (добавьте элементы или отметьте «Нет на стене»)', go);
      (w.items || []).forEach(function (it, ii) {
        var ms = itemMissing(it, w, m), g = { tab: 'walls', wall: wi, item: ii };
        if (ms.length) add(E, nm + ', ' + itemLabel(it, ii + 1) + ': не указано — ' + ms.join(', '), g);
        var ty = TYPES[it.type] || {};
        if (ty.kind === 'open' && it.type !== 'arch' && (Z.vals(it.w).length < 3 || Z.vals(it.h).length < 3) && !ms.length) add(W, nm + ', ' + itemLabel(it, ii + 1) + ': ширина/высота не по 3 точкам', g);
        if (ty.kind === 'open' && !(it.photos || []).length) add(W, nm + ', ' + itemLabel(it, ii + 1) + ': желательно фото узла', g);
        all.push(it);
      });
      if (!(w.photos || []).length) add(W, nm + ': нет фото стены', go);
    });
    var defs = P_COMMON.concat(P_TYPE[m.roomType] || []);
    defs.forEach(function (d) { var v = m.room[d.k]; if (d.req && (v === undefined || v === '' || v === null)) add(E, 'Помещение: не заполнено «' + d.t + '»', { tab: 'room' }); });
    function has(t) { return all.some(function (it) { return it.type === t; }); }
    function hasPurpose(p) { return all.some(function (it) { return it.type === 'cable' && it.purpose === p; }); }
    if (!has('socket')) add(W, 'Не отмечено ни одной розетки', { tab: 'walls' });
    if (!has('switch')) add(W, 'Не отмечен выключатель света', { tab: 'walls' });
    if (m.roomType === 'kitchen') {
      if (!has('drain')) add(E, 'Кухня: не отмечен слив (канализация)', { tab: 'walls' });
      if (!has('hvs')) add(E, 'Кухня: не отмечен выход ХВС', { tab: 'walls' });
      if (!has('gvs')) add(W, 'Кухня: не отмечен выход ГВС', { tab: 'walls' });
      if (!has('ventduct')) add(W, 'Кухня: не отмечен вентканал / отверстие вытяжки', { tab: 'walls' });
      if (!has('apron')) add(W, 'Кухня: не отмечен фартук', { tab: 'walls' });
      if (!hasPurpose('Варочная панель / плита') && !has('gastap')) add(W, 'Кухня: не отмечены выводы под плиту', { tab: 'walls' });
      if (!hasPurpose('Духовой шкаф') || !hasPurpose('ПММ')) add(W, 'Кухня: не отмечены выводы кабеля под технику (духовка, ПММ)', { tab: 'walls' });
    }
    if (!(m.photos || []).length) add(W, 'Нет общих фото помещения', { tab: 'room' });
    var g = Z.build(m);
    if (g.ok && g.closed && g.closure > 30) add(W, 'Контур комнаты не сходится на ' + Math.round(g.closure) + ' мм — проверьте длины стен и углы', { tab: 'd2' });
    return { E: E, W: W };
  }

  /* ---------------- SVG ---------------- */
  function rgb(c) { return 'rgb(' + c.join(',') + ')'; }
  function planSVG(g, opt) {
    opt = opt || {};
    if (!g.ok) return '<div class="empty">Укажите длины всех стен, чтобы построить план.</div>';
    var xs = [], ys = [], T = g.T;
    g.pts.forEach(function (p) { xs.push(p[0]); ys.push(-p[1]); });
    var pad = 600 + T, x0 = Math.min.apply(null, xs) - pad, x1 = Math.max.apply(null, xs) + pad, y0 = Math.min.apply(null, ys) - pad, y1 = Math.max.apply(null, ys) + pad;
    var Wd = x1 - x0, Hd = y1 - y0, fs = Math.max(Wd, Hd) / 24;
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + [x0, y0, Wd, Hd].map(Math.round).join(' ') + '" font-family="Onest,Arial,sans-serif">';
    s += '<rect x="' + x0 + '" y="' + y0 + '" width="' + Wd + '" height="' + Hd + '" fill="#fff"/>';
    if (g.closed) s += '<polygon points="' + g.pts.slice(0, -1).map(function (p) { return p[0] + ',' + (-p[1]); }).join(' ') + '" fill="#f6f2e8"/>';
    function P(wi, u, t) { var S0 = g.pts[wi], d = g.dirs[wi], m = [d[1], -d[0]]; return [S0[0] + d[0] * u + m[0] * t, -(S0[1] + d[1] * u + m[1] * t)]; }
    function poly(ps, fill, stroke) { return '<polygon points="' + ps.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '" fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + (fs / 10) + '"' : '') + '/>'; }
    g.W.forEach(function (w, wi) {
      s += poly([P(wi, -g.e0[wi], 0), P(wi, w.L + g.e1[wi], 0), P(wi, w.L + g.e1[wi], -T), P(wi, -g.e0[wi], -T)], '#3a3631');
    });
    g.items.forEach(function (r) {
      var ty = TYPES[r.it.type] || TYPES.other, b = r.b;
      if (b.cut) {
        s += poly([P(r.wi, b.u0, 1), P(r.wi, b.u1, 1), P(r.wi, b.u1, -T - 1), P(r.wi, b.u0, -T - 1)], '#fff');
        if (r.it.type === 'window' || r.it.type === 'balcony') s += poly([P(r.wi, b.u0, -T * 0.42), P(r.wi, b.u1, -T * 0.42), P(r.wi, b.u1, -T * 0.58), P(r.wi, b.u0, -T * 0.58)], '#7fb8e6');
        if (r.it.type === 'door') { var a = P(r.wi, b.u0, 0), c = P(r.wi, b.u1, 0), rr = b.u1 - b.u0, e = P(r.wi, b.u0, rr); s += '<path d="M' + a + ' L' + e + ' A' + rr + ' ' + rr + ' 0 0 ' + (1) + ' ' + c + '" fill="none" stroke="#8a6a4f" stroke-width="' + fs / 12 + '" stroke-dasharray="' + fs / 4 + '"/>'; }
      } else {
        var t0 = b.t0 || 0, dep = Math.max(b.dep, 40);
        s += poly([P(r.wi, b.u0, t0), P(r.wi, b.u1, t0), P(r.wi, b.u1, t0 + dep), P(r.wi, b.u0, t0 + dep)], rgb(ty.c), '#0006');
      }
    });
    g.W.forEach(function (w, wi) {
      var mid = P(wi, w.L / 2, 0), d = g.dirs[wi], ang = Math.atan2(-d[1], d[0]) * 180 / Math.PI;
      if (ang > 90 || ang < -90) ang += 180;
      var lp = P(wi, w.L / 2, fs * 1.4);
      var nm = (M.walls[wi] && M.walls[wi].name) || ('Стена ' + (wi + 1));
      s += '<text x="' + lp[0] + '" y="' + lp[1] + '" font-size="' + fs + '" text-anchor="middle" dominant-baseline="middle" transform="rotate(' + ang + ' ' + lp[0] + ' ' + lp[1] + ')" fill="#111"><tspan font-weight="700">' + fmt(w.L) + '</tspan></text>';
      var lp2 = P(wi, w.L / 2, -T - fs * 1.1);
      s += '<text x="' + lp2[0] + '" y="' + lp2[1] + '" font-size="' + fs * 0.75 + '" text-anchor="middle" dominant-baseline="middle" transform="rotate(' + ang + ' ' + lp2[0] + ' ' + lp2[1] + ')" fill="#77726a">' + esc(nm) + '</text>';
      if ((wi < g.W.length - 1 || g.closed) && Math.abs(w.ang - 90) > 0.05) {
        var cp = P(wi, w.L, fs * 1.3);
        s += '<text x="' + cp[0] + '" y="' + cp[1] + '" font-size="' + fs * 0.7 + '" text-anchor="middle" fill="#d93025">' + fmt(w.ang) + '°</text>';
      }
    });
    if (g.closed && g.closure > 30) s += '<text x="' + (x0 + fs) + '" y="' + (y1 - fs) + '" font-size="' + fs * 0.8 + '" fill="#d93025">Невязка контура ' + Math.round(g.closure) + ' мм</text>';
    return s + '</svg>';
  }
  function elevSVG(wi) {
    var w = M.walls[wi], L = wallL(w), H = wallH(w);
    var Lr = L || 3000, pad = 420, fs = Math.max(Lr, H) / 26;
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + (-pad) + ' ' + (-pad) + ' ' + (Lr + pad * 2) + ' ' + (H + pad * 2) + '" font-family="Onest,Arial,sans-serif">';
    s += '<rect x="' + (-pad) + '" y="' + (-pad) + '" width="' + (Lr + pad * 2) + '" height="' + (H + pad * 2) + '" fill="#fff"/>';
    s += '<rect x="0" y="0" width="' + Lr + '" height="' + H + '" fill="#faf8f3" stroke="#3a3631" stroke-width="' + fs / 6 + '"/>';
    if (!L) return s + '<text x="' + Lr / 2 + '" y="' + H / 2 + '" font-size="' + fs + '" text-anchor="middle" fill="#d93025">укажите длину стены</text></svg>';
    var ys = H + pad * 0.45;
    s += '<line x1="0" y1="' + ys + '" x2="' + L + '" y2="' + ys + '" stroke="#111" stroke-width="' + fs / 14 + '"/><text x="' + L / 2 + '" y="' + (ys - fs * 0.35) + '" font-size="' + fs + '" text-anchor="middle" font-weight="700">' + fmt(L) + '</text>';
    s += '<line x1="' + (-pad * 0.45) + '" y1="0" x2="' + (-pad * 0.45) + '" y2="' + H + '" stroke="#111" stroke-width="' + fs / 14 + '"/><text x="' + (-pad * 0.55) + '" y="' + H / 2 + '" font-size="' + fs + '" text-anchor="middle" font-weight="700" transform="rotate(-90 ' + (-pad * 0.55) + ' ' + H / 2 + ')">' + fmt(H) + '</text>';
    (w.items || []).forEach(function (it, ii) {
      var ty = TYPES[it.type] || TYPES.other, b = Z.itemBox(it, L, H); if (!b) return;
      var x = b.u0, y = H - b.z1, ww = b.u1 - b.u0, hh = b.z1 - b.z0;
      if (b.cut) s += '<rect x="' + x + '" y="' + y + '" width="' + ww + '" height="' + hh + '" fill="' + (it.type === 'door' || it.type === 'arch' ? '#efe6dc' : '#dcecf8') + '" stroke="#3a3631" stroke-width="' + fs / 10 + '"/>';
      else s += '<rect x="' + x + '" y="' + y + '" width="' + ww + '" height="' + hh + '" fill="' + rgb(ty.c) + '" fill-opacity=".85" stroke="#111" stroke-width="' + fs / 14 + '"/>';
      var cx = x + ww / 2, cy = Math.max(fs, y - fs * 0.3);
      if (b.cut) cy = y + Math.min(hh / 2, fs * 1.6);
      s += '<text x="' + cx + '" y="' + cy + '" font-size="' + fs * 0.8 + '" text-anchor="middle" font-weight="700" fill="#111">' + (ii + 1) + '</text>';
      if (b.cut) s += '<text x="' + cx + '" y="' + (cy + fs) + '" font-size="' + fs * 0.62 + '" text-anchor="middle" fill="#333">' + fmt(ww) + '×' + fmt(hh) + '</text>';
    });
    return s + '</svg>';
  }
  function itemSize(it, w) {
    var ty = TYPES[it.type] || TYPES.other, k = ty.kind, p = [];
    var side = it.from === 'R' ? 'от прав.' : 'от лев.';
    if (k === 'open') p.push(fmt(minOf(it.w)) + '×' + fmt(minOf(it.h)));
    if (k === 'box') p.push(fmt(num(it.w0)) + '×' + fmt(num(it.h0)) + (num(it.depth) ? '×' + fmt(num(it.depth)) : ''));
    if (k === 'pipe') p.push('Ø' + fmt(num(it.dia)));
    if (num(it.off) !== null) p.push(side + ' ' + fmt(num(it.off)));
    if (num(it.z) !== null) p.push('h ' + fmt(num(it.z)));
    if (num(it.count) > 1) p.push(num(it.count) + ' шт');
    if (it.purpose) p.push(it.purpose);
    return p.join(' · ');
  }

  /* ---------------- шапка ---------------- */
  function renderTop() {
    if (S.screen !== 'edit') {
      top.innerHTML = '<div class="row1"><div class="logo"><b>MGS</b> Замер</div><div class="ttl"></div>' + (S.screen === 'new' ? '<button class="btn s ghost" style="color:#fff;border-color:#444" data-a="home">Замеры</button>' : '') + '</div><div style="height:10px"></div>';
      return;
    }
    var c = check(M), i = TABS.findIndex(function (t) { return t[0] === S.tab; });
    top.innerHTML = '<div class="row1"><button class="btn s ghost" style="color:#fff;border-color:#444" data-a="home">≡ Замеры</button><div class="ttl">' + esc(M.name) + '</div><span class="saved">сохранено ✓</span></div>' +
      '<nav class="tabs">' + TABS.map(function (t) { return '<button class="tab' + (t[0] === S.tab ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + (t[0] === 'check' && c.E.length ? '<span class="bd">' + c.E.length + '</span>' : '') + '</button>'; }).join('') + '</nav>' +
      '<div class="prog"><i style="width:' + Math.round((i + 1) / TABS.length * 100) + '%"></i></div>';
    var on = top.querySelector('.tab.on'); if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
  function refreshBadge() {
    if (S.screen !== 'edit') return;
    var c = check(M), t = top.querySelector('[data-tab=check]'); if (!t) return;
    var b = t.querySelector('.bd');
    if (c.E.length) { if (!b) { b = document.createElement('span'); b.className = 'bd'; t.appendChild(b); } b.textContent = c.E.length; } else if (b) b.remove();
  }

  /* ---------------- экраны ---------------- */
  function render() {
    stop3D();
    renderTop();
    if (S.screen === 'list') return renderList();
    if (S.screen === 'new') return renderNew();
    ({ obj: tObj, walls: tWalls, room: tRoom, check: tCheck, d2: tD2, d3: tD3, files: tFiles })[S.tab]();
    hydratePhotos();
  }

  function renderList() {
    var L = listAll();
    app.innerHTML = '<div class="hero"><h1>Замер помещения — <em>прямо с телефона</em></h1><p>По шагам: стены → всё, что на них есть → фото → проверка, что ничего не упущено → чертёж 2D, 3D и файл для PRO100.</p>' +
      '<div class="chips"><button class="btn p" data-a="new">+ Новый замер</button><button class="btn ghost" style="color:#fff;border-color:#555" data-a="openjson">Открыть файл замера</button></div></div>' +
      '<div class="card"><h2>Мои замеры</h2>' + (L.length ? L.map(function (m) {
        var c = check(m);
        return '<div class="list-item" data-open="' + m.id + '"><div class="a"><b>' + esc(m.name) + '</b><div class="b">' + esc(m.address || '') + (m.address ? ' · ' : '') + esc(m.date || '') + ' · стен: ' + m.walls.length + '</div></div>' +
          '<span class="st' + (c.E.length ? '' : ' ok') + '">' + (c.E.length ? 'ошибок ' + c.E.length : 'готов ✓') + '</span><button class="btn s red" data-del="' + m.id + '">✕</button></div>';
      }).join('') : '<p class="hint">Пока нет замеров. Замеры хранятся на этом устройстве; чтобы передать замер, выгрузите файл во вкладке «Файлы».</p>') + '</div>';
  }

  function renderNew() {
    var n = S.nw;
    app.innerHTML = '<div class="card"><h1>Новый замер</h1>' +
      fld('Название', '<input data-nw="name" placeholder="Например: Иванов, кухня" value="' + esc(n.name) + '">') +
      fld('Адрес', '<input data-nw="address" value="' + esc(n.address) + '">') +
      fld('Тип помещения', '<div class="chips">' + ROOMS.map(function (r) { return '<button class="chip' + (n.type === r[0] ? ' on' : '') + '" data-nwset="type" data-v="' + r[0] + '">' + r[1] + '</button>'; }).join('') + '</div>') +
      fld('Количество стен', '<div class="chips">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (k) { return '<button class="chip' + (n.n === k ? ' on' : '') + '" data-nwset="n" data-v="' + k + '">' + k + '</button>'; }).join('') + '</div><p class="hint" style="margin-top:8px">1 стена — замер одной стены (например, кухня вдоль стены). 2 стены — угловая. Прямоугольная комната — 4 стены. Г-образная — 6. Выступ / ниша в стене — это тоже отдельные стены (или элемент «колонна / короб»). Стен можно добавить и потом.</p>') +
      fld('Высота потолка, мм', '<input data-nw="H" inputmode="decimal" placeholder="2700" value="' + esc(n.H) + '">') +
      '<div class="bar"><button class="btn p" data-a="start">Начать замер</button><button class="btn ghost" data-a="home">Отмена</button></div></div>';
  }

  function tObj() {
    app.innerHTML = '<div class="card"><h2>Объект</h2><div class="g2">' +
      fld('Название замера', inp('name')) + fld('Заказчик', inp('client')) +
      fld('Телефон', inp('phone', { type: 'tel' })) + fld('Дата', inp('date', { type: 'date' })) + '</div>' +
      fld('Адрес', inp('address')) + '</div>' +
      '<div class="card"><h2>Помещение</h2><div class="g2">' +
      fld('Тип помещения', '<select data-p="roomType" data-r="1">' + ROOMS.map(function (r) { return '<option value="' + r[0] + '"' + (M.roomType === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select>') +
      fld('Название помещения', inp('roomName', { ph: 'Например: кухня-гостиная' })) +
      fld('Высота потолка, мм', inp('H', { n: 1, ph: '2700' })) + fld('Толщина стен (для чертежа), мм', inp('T', { n: 1, ph: '150' })) + '</div>' +
      (M.walls.length >= 3 ? '<label class="chk"><input type="checkbox" data-pb="closed"' + (M.closed === false ? '' : ' checked') + '><span>Контур замкнутый (стены обходят всю комнату). Снимите, если меряете только часть стен.</span></label>' : '') + '</div>' +
      '<div class="card"><h2>Стены: ' + M.walls.length + '</h2><p class="hint">Обходим по часовой стрелке. Стена 1 — стена с входной дверью: встаньте в комнате лицом к ней — следующая стена будет справа. Горизонтальные размеры на стене снимаются от её левого угла.</p><div id="wlist">' + wallListHTML() + '</div>' +
      '<div class="bar"><div class="chips"><button class="btn s" data-a="addwall">+ Добавить стену</button>' + (M.walls.length > 1 ? '<button class="btn s ghost" data-a="delwall">− Убрать последнюю</button>' : '') + '</div><button class="btn p" data-tab="walls">К стенам →</button></div></div>';
  }
  function wallListHTML() {
    return M.walls.map(function (w, i) {
      var ok = wallMeasured(w);
      return '<div class="wl"><b style="width:20px">' + (i + 1) + '</b><input class="nm" data-p="walls.' + i + '.name" value="' + esc(w.name) + '" style="flex:1"><span class="st' + (ok ? ' ok' : '') + '" style="width:92px">' + (ok ? fmt(wallL(w)) + ' мм' : 'не замерена') + '</span><button class="btn s" data-gowall="' + i + '">→</button></div>';
    }).join('');
  }

  function tWalls() {
    var wi = Math.min(S.wall, M.walls.length - 1); S.wall = wi;
    var w = M.walls[wi], n = M.walls.length, last = wi === n - 1, closed = n >= 3 && M.closed !== false;
    var p = 'walls.' + wi + '.';
    var h = '<div class="chips" style="margin-bottom:12px">' + M.walls.map(function (x, i) { return '<button class="chip' + (i === wi ? ' on' : '') + '" data-gowall="' + i + '">' + esc(x.name || 'Стена ' + (i + 1)) + (wallMeasured(x) ? ' ✓' : '') + '</button>'; }).join('') + '</div>';
    h += '<div class="card">' + fld('Название стены', inp(p + 'name')) + '<p class="hint">Стоим в комнате лицом к стене. Отсчёт по горизонтали — от левого угла.</p>' +
      '<h3><span class="n">1</span>Длина стены — 3 замера</h3><p class="hint">От угла до угла: у пола, посередине высоты, под потолком.</p>' +
      '<label class="f req">Длина, мм</label><div class="g3">' + ['Низ', 'Середина', 'Верх'].map(function (t, k) { return '<div><label class="f">' + t + '</label>' + inp(p + 'len.' + k, { n: 1 }) + '</div>'; }).join('') + '</div>' +
      '<h3 style="margin-top:16px"><span class="n">2</span>Высота стены — 3 замера</h3><p class="hint">От пола до потолка: у левого угла, по центру, у правого угла.</p>' +
      '<label class="f req">Высота, мм</label><div class="g3">' + ['Слева', 'Центр', 'Справа'].map(function (t, k) { return '<div><label class="f">' + t + '</label>' + inp(p + 'hgt.' + k, { n: 1, ph: M.H || '' }) + '</div>'; }).join('') + '</div>' +
      '<div class="calc" id="wcalc">' + wallCalc(w) + '</div>';
    if (!last || closed) {
      var nx = M.walls[(wi + 1) % n];
      h += '<h3 style="margin-top:16px"><span class="n">3</span>Угол со следующей стеной</h3><label class="f">Угол между «' + esc(w.name) + '» и «' + esc(nx.name) + '», °</label>' +
        '<div style="display:flex;gap:8px">' + inp(p + 'angle', { n: 1, ph: '90' }) + '<button class="btn s" data-ang="90">90</button><button class="btn s" data-ang="270">270</button></div>' +
        '<p class="hint" style="margin-top:6px">90° — обычный угол (внутренний). 270° — внешний угол, выступающий в комнату. Если угол «завален» — впишите точное значение с угломера, например 88,5.</p>';
    }
    h += '<div class="svgbox" id="welev" style="margin-top:12px">' + elevSVG(wi) + '</div><p class="hint" style="margin-top:6px">Нажмите на элемент в списке ниже — откроются все его размеры.</p></div>';
    h += '<div class="card"><h3><span class="n">4</span>Что есть на этой стене</h3><p class="hint">Идите по списку сверху вниз. Каждый пункт закройте: добавьте элементы или отметьте «Нет на стене» — так ничего не будет пропущено.</p>';
    CATS.forEach(function (c) {
      var st = catState(w, c), items = [];
      (w.items || []).forEach(function (it, ii) { if (c.types.indexOf(it.type) >= 0) items.push([it, ii]); });
      h += '<div class="cat ' + (st === 'has' || st === 'none' ? 'ok' : st === 'opt' ? 'opt' : '') + '"><div class="hd"><span>' + c.ic + '</span>' + c.t + '<span class="s">' + (st === 'has' ? items.length + ' шт.' : st === 'none' ? 'нет на стене' : st === 'opt' ? 'по необходимости' : 'не проверено') + '</span></div>';
      items.forEach(function (x) {
        var it = x[0], ty = TYPES[it.type] || TYPES.other, ms = itemMissing(it, w);
        h += '<div class="it" data-item="' + x[1] + '"><span class="dot" style="background:' + rgb(ty.c) + '"></span><span><b>' + (x[1] + 1) + '</b> ' + esc(ty.t) + '</span><span class="sz">' + esc(itemSize(it, w)) + (ms.length ? '<div class="bad">⚠ не всё</div>' : '') + '</span></div>';
      });
      h += '<div class="act">' + (st === 'has' ? '' : '<button class="btn s' + (st === 'none' ? ' d' : '') + '" data-none="' + c.k + '">' + (st === 'none' ? '✓ Нет на стене' : 'Нет на стене') + '</button>') + '<button class="btn s p" data-add="' + c.k + '">+ Добавить</button></div></div>';
    });
    h += '</div>';
    h += '<div class="card"><h3><span class="n">5</span>Фото стены</h3><p class="hint">Общий план стены + крупно узлы (трубы, щиток, счётчики).</p>' + photosHTML(p + 'photos') + '</div>';
    h += '<div class="card"><h3><span class="n">6</span>Примечание</h3>' + inp(p + 'note', { ta: 1, ph: 'Что важно учесть на этой стене' }) + '</div>';
    h += '<div class="bar">' + (wi > 0 ? '<button class="btn ghost" data-gowall="' + (wi - 1) + '">← Предыдущая</button>' : '<button class="btn ghost" data-tab="obj">← Объект</button>') +
      (last ? '<button class="btn p" data-tab="room">К помещению →</button>' : '<button class="btn p" data-gowall="' + (wi + 1) + '">Следующая стена →</button>') + '</div>';
    app.innerHTML = h;
    if (S.sheet) renderSheet();
  }
  function wallCalc(w) {
    return 'В расчёт (наименьшее): длина <b>' + fmt(wallL(w)) + '</b>, высота <b>' + fmt(wallH(w)) + '</b> мм';
  }

  function tRoom() {
    var t = ROOMS.find(function (r) { return r[0] === M.roomType; }), defs = (P_TYPE[M.roomType] || []).concat(P_COMMON);
    var h = '<div class="card"><h2>' + esc(t ? t[1] : 'Помещение') + ': параметры</h2><div class="g2">';
    defs.forEach(function (d) {
      var p = 'room.' + d.k, ctl = d.opts ? sel(p, d.opts) : inp(p, { n: d.n });
      h += '<div' + (d.txt ? ' style="grid-column:1/-1"' : '') + '>' + fld(d.t, ctl, d.req) + '</div>';
    });
    h += '</div></div><div class="card"><h3>Общие фото помещения</h3><p class="hint">Общий вид от двери и каждый угол.</p>' + photosHTML('photos') + '</div>' +
      '<div class="card"><h3>Пожелания заказчика и примечания</h3>' + inp('wishes', { ta: 1 }) + '</div>' +
      '<div class="bar"><button class="btn ghost" data-tab="walls">← Стены</button><button class="btn p" data-tab="check">Проверить замер →</button></div>';
    app.innerHTML = h;
  }

  function tCheck() {
    var c = check(M), h = '';
    h += '<div class="card"><h2>' + (c.E.length ? 'Проверьте пунктов — ' + c.E.length : 'Замер полный ✓') + '</h2><p class="hint">' + (c.E.length ? 'Замечаний: ' + c.W.length + '. Нажмите на пункт, чтобы перейти к нему.' : 'Обязательное заполнено. Замечаний: ' + c.W.length + '.') + '</p></div>';
    if (c.E.length) h += '<div class="card"><h3>Обязательно заполнить</h3>' + c.E.map(function (e, i) { return '<div class="msg e" data-go="E' + i + '"><i>⛔</i><span>' + esc(e.t) + '</span></div>'; }).join('') + '</div>';
    if (c.W.length) h += '<div class="card"><h3>Обратите внимание</h3>' + c.W.map(function (e, i) { return '<div class="msg w" data-go="W' + i + '"><i>⚠️</i><span>' + esc(e.t) + '</span></div>'; }).join('') + '</div>';
    h += '<div class="card"><h3>Перед уходом с объекта</h3>' + CHECKLIST.map(function (t, i) { return '<label class="chk"><input type="checkbox" data-pb="checklist.' + i + '"' + (M.checklist[i] ? ' checked' : '') + '><span>' + esc(t) + '</span></label>'; }).join('') + '</div>';
    h += '<div class="bar"><button class="btn ghost" data-tab="room">← Помещение</button><button class="btn p" data-tab="d2">Чертёж →</button></div>';
    app.innerHTML = h; S._chk = c;
  }

  function tD2() {
    var g = Z.build(M), wi = Math.min(S.elev, M.walls.length - 1); S.elev = wi;
    var w = M.walls[wi];
    var h = '<div class="card"><div style="display:flex;align-items:center;gap:8px"><h2 style="flex:1;margin:0">План помещения</h2><button class="btn s" data-dl="plan">⬇ SVG</button></div><p class="hint" style="margin-top:6px">Вид сверху. Цифры — длины стен по внутренней стороне, мм. Красным — углы не 90°.</p><div class="svgbox">' + planSVG(g) + '</div></div>';
    h += '<div class="chips" style="margin:0 0 12px">' + M.walls.map(function (x, i) { return '<button class="chip' + (i === wi ? ' on' : '') + '" data-elev="' + i + '">' + esc(x.name) + '</button>'; }).join('') + '</div>';
    h += '<div class="card"><div style="display:flex;align-items:center;gap:8px"><h2 style="flex:1;margin:0">Развёртка: ' + esc(w.name) + '</h2><button class="btn s" data-dl="elev">⬇ SVG</button></div>' +
      '<p class="hint" style="margin-top:6px">Длина низ / середина / верх: ' + w.len.map(function (v) { return fmt(num(v)); }).join(' / ') + ' · высота слева / центр / справа: ' + w.hgt.map(function (v) { return fmt(num(v)); }).join(' / ') + '</p>' +
      '<div class="svgbox">' + elevSVG(wi) + '</div>' + itemsTable(w) + '</div>';
    h += '<div class="bar"><button class="btn ghost" data-tab="check">← Проверка</button><button class="btn p" data-tab="d3">3D →</button></div>';
    app.innerHTML = h;
  }
  function itemsTable(w) {
    if (!(w.items || []).length) return '<p class="hint" style="margin-top:10px">На стене нет элементов.</p>';
    return '<table class="t" style="margin-top:10px"><tr><th>№</th><th>Элемент</th><th>От угла</th><th>От пола</th><th>Ш×В</th><th>Выступ / глуб.</th><th>Прим.</th></tr>' + w.items.map(function (it, i) {
      var ty = TYPES[it.type] || TYPES.other, k = ty.kind;
      var wh = k === 'open' ? fmt(minOf(it.w)) + '×' + fmt(minOf(it.h)) : k === 'box' ? fmt(num(it.w0)) + '×' + fmt(num(it.h0)) : k === 'pipe' ? 'Ø' + fmt(num(it.dia)) : (num(it.count) > 1 ? num(it.count) + ' шт' : '—');
      var dp = k === 'open' ? fmt(num(it.depth)) + (num(it.sill) ? ', подок. ' + fmt(num(it.sill)) : '') : k === 'box' ? fmt(num(it.depth)) : k === 'pipe' ? fmt(num(it.gap)) : '—';
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(ty.t) + (it.purpose ? '<br><span class="st">' + esc(it.purpose) + '</span>' : '') + '</td><td>' + (it.from === 'R' ? 'прав. ' : 'лев. ') + fmt(num(it.off)) + (k === 'point' || k === 'pipe' ? ' (центр)' : '') + '</td><td>' + (k === 'pipe' ? 'от пола' : fmt(num(it.z) === null && ty.floor ? 0 : num(it.z))) + '</td><td>' + wh + '</td><td>' + dp + '</td><td>' + esc([it.opening, it.note].filter(Boolean).join('; ')) + '</td></tr>';
    }).join('') + '</table>';
  }

  /* ---------------- 3D ---------------- */
  var V3 = null;
  function stop3D() {
    if (!V3) return;
    try { cancelAnimationFrame(V3.raf); V3.ro && V3.ro.disconnect(); V3.ctl.dispose(); V3.r.dispose(); V3.scene.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) { (o.material.map && o.material.map.dispose()); o.material.dispose(); } }); } catch (e) {}
    V3 = null;
  }
  function tD3() {
    var g = Z.build(M);
    app.innerHTML = '<div class="card"><div class="seg" style="margin-bottom:10px"><button data-v3="out" class="' + (S.v3 === 'out' ? 'on' : '') + '">Общий вид</button><button data-v3="in" class="' + (S.v3 === 'in' ? 'on' : '') + '">Изнутри</button><button data-v3="top" class="' + (S.v3 === 'top' ? 'on' : '') + '">Сверху</button></div>' +
      '<label class="chk" style="padding:0 0 8px"><input type="checkbox" data-lbl' + (S.labels ? ' checked' : '') + '><span>Подписи стен</span></label>' +
      (g.ok ? '<canvas id="v3d"></canvas><div class="info3d" id="i3d">Вращение — пальцем / мышью, масштаб — двумя пальцами / колёсиком. Нажмите на элемент — покажутся его размеры.</div>' : '<div class="empty" style="background:#e9e6df;border-radius:12px;min-height:300px">Укажите длины всех стен, чтобы построить 3D.</div>') +
      '</div><div class="bar"><button class="btn ghost" data-tab="d2">← Чертёж 2D</button><button class="btn p" data-tab="files">Файлы и PRO100 →</button></div>';
    if (g.ok) start3D(g);
  }
  function start3D(g) {
    Promise.all([import('three'), import('../assets/three/OrbitControls.js')]).then(function (mods) {
      if (S.tab !== 'd3' || !$('#v3d')) return;
      var THREE = mods[0], OC = mods[1].OrbitControls, cv = $('#v3d');
      var r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: false });
      r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); r.setClearColor(0xe9e6df);
      var scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(50, 1, 0.01, 200);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 2.2));
      var dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(3, 8, 5); scene.add(dl);
      var k = 0.001, pick = [], bb = new THREE.Box3();
      g.meshes.forEach(function (m) {
        if (!m.f.length) return;
        var pos = [];
        m.f.forEach(function (f) { f.forEach(function (i) { var v = m.v[i]; pos.push(v[0] * k, v[2] * k, -v[1] * k); }); });
        var geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
        var mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(rgb(m.c)), roughness: 0.85, side: THREE.DoubleSide, transparent: m.kind === 'window' || m.kind === 'balcony', opacity: (m.kind === 'window' || m.kind === 'balcony') ? 0.45 : 1 });
        var mesh = new THREE.Mesh(geo, mat); scene.add(mesh);
        if (m.kind === 'wall') { var eg = new THREE.EdgesGeometry(geo, 30); scene.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x8c867a }))); }
        if (m.ref) { mesh.userData.ref = m.ref; pick.push(mesh); }
        bb.expandByObject(mesh);
      });
      var labels = [];
      g.W.forEach(function (w, wi) {
        var S0 = g.pts[wi], d = g.dirs[wi], mx = S0[0] + d[0] * w.L / 2 + d[1] * 300, my = S0[1] + d[1] * w.L / 2 - d[0] * 300;
        var c = document.createElement('canvas'); c.width = 512; c.height = 128; var x = c.getContext('2d');
        x.fillStyle = 'rgba(21,19,17,.85)'; x.beginPath(); x.roundRect ? x.roundRect(0, 16, 512, 96, 48) : x.rect(0, 16, 512, 96); x.fill();
        x.fillStyle = '#bfd630'; x.font = '600 44px Onest, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText((M.walls[wi].name || ('Стена ' + (wi + 1))) + ' · ' + fmt(w.L), 256, 66);
        var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
        sp.position.set(mx * k, (w.H + 250) * k, -my * k); sp.scale.set(1.0, 0.25, 1); sp.renderOrder = 9; sp.visible = S.labels; scene.add(sp); labels.push(sp);
      });
      var ctr = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3()), R = Math.max(sz.x, sz.z, 2);
      var ctl = new OC(cam, cv); ctl.enableDamping = true;
      var nx = 0, ny = 0; g.W.forEach(function (w, wi) { var d = g.dirs[wi]; nx += d[1] * w.L; ny += -d[0] * w.L; });
      var nl = Math.hypot(nx, ny), N = nl > 0.25 * g.W.reduce(function (a, w) { return a + w.L; }, 0) ? new THREE.Vector3(nx / nl, 0, -ny / nl) : null;
      V3 = { r: r, scene: scene, cam: cam, ctl: ctl, labels: labels, ctr: ctr, R: R, H: sz.y, N: N };
      setView(S.v3);
      function size() { var w = cv.clientWidth, h = cv.clientHeight; r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
      size(); if (window.ResizeObserver) { V3.ro = new ResizeObserver(size); V3.ro.observe(cv); }
      var rc = new THREE.Raycaster(), down = null;
      cv.addEventListener('pointerdown', function (e) { down = [e.clientX, e.clientY]; });
      cv.addEventListener('pointerup', function (e) {
        if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
        var rect = cv.getBoundingClientRect();
        rc.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), cam);
        var hit = rc.intersectObjects(pick)[0], inf = $('#i3d'); if (!inf) return;
        if (!hit) { inf.textContent = 'Нажмите на элемент — покажутся его размеры.'; return; }
        var ref = hit.object.userData.ref, it = ref.it, w = M.walls[ref.wi];
        inf.innerHTML = '<b>' + esc(w.name) + ', №' + (ref.ii + 1) + ' ' + esc((TYPES[it.type] || {}).t) + '</b> — ' + esc(itemSize(it, w));
      });
      (function loop() { if (!V3) return; V3.raf = requestAnimationFrame(loop); ctl.update(); r.render(scene, cam); })();
    }).catch(function (e) { var i = $('#i3d'); if (i) i.textContent = 'Не удалось загрузить 3D: ' + e.message; });
  }
  function setView(v) {
    if (!V3) return; var c = V3.ctr, R = V3.R, cam = V3.cam, ctl = V3.ctl;
    ctl.minDistance = 0.01; ctl.maxDistance = R * 6;
    var N = V3.N;
    if (v === 'in') {
      cam.fov = 75;
      if (N) { cam.position.set(c.x + N.x * R * 0.45, 1.55, c.z + N.z * R * 0.45); ctl.target.set(c.x - N.x * 0.3, 1.45, c.z - N.z * 0.3); }
      else { cam.position.set(c.x, 1.55, c.z + 0.05); ctl.target.set(c.x, 1.45, c.z - 1); }
    }
    else if (v === 'top') { cam.fov = 45; cam.position.set(c.x, R * 2.3 + 2, c.z + 0.001); ctl.target.set(c.x, 0, c.z); }
    else if (N) { cam.fov = 50; cam.position.set(c.x + N.x * R * 1.5 + N.z * R * 0.35, R * 0.75 + 1.2, c.z + N.z * R * 1.5 - N.x * R * 0.35); ctl.target.set(c.x, V3.H * 0.4, c.z); }
    else { cam.fov = 50; cam.position.set(c.x + R * 0.9, R * 1.05 + 1.5, c.z + R * 1.25); ctl.target.set(c.x, V3.H * 0.35, c.z); }
    cam.updateProjectionMatrix(); ctl.update();
  }

  /* ---------------- файлы ---------------- */
  function tFiles() {
    var g = Z.build(M), c = check(M);
    var h = '<div class="card"><h2>Файл для PRO100</h2>' + (g.ok ? '' : '<p class="msg e" style="cursor:default"><i>⛔</i><span>Укажите длины всех стен — без них модель не построить.</span></p>') +
      '<div class="chips" style="gap:8px"><button class="btn p" data-ex="3ds-mm"' + (g.ok ? '' : ' disabled') + '>⬇ PRO100 (.3ds, мм)</button><button class="btn" data-ex="3ds-cm"' + (g.ok ? '' : ' disabled') + '>.3ds в сантиметрах</button><button class="btn" data-ex="obj"' + (g.ok ? '' : ' disabled') + '>.obj + .mtl (zip)</button></div>' +
      '<p class="note" style="margin-top:10px">Как открыть: PRO100 → импорт 3D-объекта → выберите файл .3ds. Стены, проёмы окон и дверей, розетки, выводы воды, трубы, щитки и короба встанут на свои места. Цвета: красный — розетка, оранжевый — выключатель, жёлтый — вывод кабеля, синий — ХВС, тёмно-красный — ГВС, чёрный — слив, фиолетовый — вентиляция. Если модель открылась крошечной или огромной — возьмите файл в сантиметрах.</p></div>' +
      '<div class="card"><h2>Отчёт и передача замера</h2><div class="chips" style="gap:8px"><button class="btn d" data-ex="pdf">🖨 Печать / сохранить PDF</button><button class="btn" data-ex="json">⬇ Файл замера (.json)</button><button class="btn" data-ex="zip">⬇ Всё одним архивом (.zip)</button>' + (navigator.share ? '<button class="btn" data-ex="share">↗ Отправить дизайнеру</button>' : '') + '</div>' +
      '<p class="note" style="margin-top:10px">Файл .json — полный замер вместе с фото: его можно отправить коллеге и открыть в этом приложении кнопкой «Открыть файл замера». PDF — выберите «Сохранить как PDF» в окне печати. Архив .zip — файлы PRO100 (мм и см), OBJ, чертежи SVG и замер .json.</p>' +
      (c.E.length ? '<p class="msg e" data-tab="check"><i>⛔</i><span>Замер неполный: не заполнено пунктов — ' + c.E.length + '. Откройте «Проверку».</span></p>' : '') + '</div>' +
      '<div class="card">' + reportHTML(true) + '</div>' +
      '<div class="bar"><button class="btn ghost" data-tab="d3">← 3D</button><button class="btn ghost" data-a="home">К списку замеров</button></div>';
    app.innerHTML = h;
  }
  function reportHTML(preview) {
    var g = Z.build(M), c = check(M), t = ROOMS.find(function (r) { return r[0] === M.roomType; });
    var rows = [['Заказчик', M.client], ['Телефон', M.phone], ['Адрес', M.address], ['Дата', M.date], ['Помещение', (t ? t[1] : '') + (M.roomName ? ' — ' + M.roomName : '')], ['Высота потолка', M.H ? M.H + ' мм' : ''], ['Стен', M.walls.length + (g.ok && g.closed ? ' (периметр ' + fmt(g.W.reduce(function (a, w) { return a + w.L; }, 0)) + ' мм)' : '')]];
    var h = '<div class="pg"><h1 style="margin-top:0">Замер: ' + esc(M.name) + '</h1><table class="t">' + rows.filter(function (r) { return r[1]; }).map(function (r) { return '<tr><th style="width:38%">' + r[0] + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table></div>';
    h += '<div class="pg"><h3 style="margin-top:14px">' + (c.E.length ? '⛔ Замер неполный' : '✓ Замер полный') + '</h3>' + (c.E.length || c.W.length ? '<ul style="padding-left:18px;margin:6px 0;font-size:13px">' + c.E.map(function (e) { return '<li>⛔ ' + esc(e.t) + '</li>'; }).join('') + c.W.map(function (e) { return '<li>⚠️ ' + esc(e.t) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
    var defs = (P_TYPE[M.roomType] || []).concat(P_COMMON).filter(function (d) { return M.room[d.k]; });
    if (defs.length || M.wishes) h += '<div class="pg"><h3 style="margin-top:14px">Помещение</h3><table class="t">' + defs.map(function (d) { return '<tr><th style="width:38%">' + esc(d.t) + '</th><td>' + esc(M.room[d.k]) + '</td></tr>'; }).join('') + (M.wishes ? '<tr><th>Пожелания</th><td>' + esc(M.wishes) + '</td></tr>' : '') + '</table></div>';
    h += '<div class="pg"><h3 style="margin-top:14px">План</h3><div class="svgbox">' + planSVG(g) + '</div></div>';
    M.walls.forEach(function (w, i) {
      h += '<div class="pg"><h3 style="margin-top:14px">' + (i + 1) + '. ' + esc(w.name) + ' — ' + fmt(wallL(w)) + ' × ' + fmt(wallH(w)) + ' мм</h3><p class="hint">Длина низ / середина / верх: ' + w.len.map(function (v) { return fmt(num(v)); }).join(' / ') + ' · высота слева / центр / справа: ' + w.hgt.map(function (v) { return fmt(num(v)); }).join(' / ') + ((i < M.walls.length - 1 || (M.walls.length >= 3 && M.closed !== false)) ? ' · угол со следующей: ' + fmt(num(w.angle) === null ? 90 : num(w.angle)) + '°' : '') + '</p>' +
        '<div class="svgbox">' + elevSVG(i) + '</div>' + itemsTable(w) + (w.note ? '<p class="hint">Примечание: ' + esc(w.note) + '</p>' : '') + (preview ? '' : photoImgs(w.photos)) + '</div>';
    });
    if (!preview && (M.photos || []).length) h += '<div class="pg"><h3>Общие фото</h3>' + photoImgs(M.photos) + '</div>';
    return h;
  }
  function photoImgs(ids) { return (ids || []).map(function (id) { return urlCache[id] ? '<img src="' + urlCache[id] + '">' : ''; }).join(''); }

  function download(name, data, type) {
    var b = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    var u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 4000);
  }
  function base() { return translit(M.name) + '_' + (M.date || '').replace(/-/g, ''); }
  function blobToDataURL(b) { return new Promise(function (ok) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.readAsDataURL(b); }); }
  function allPhotoIds(m) { var a = (m.photos || []).slice(); m.walls.forEach(function (w) { a = a.concat(w.photos || []); (w.items || []).forEach(function (it) { a = a.concat(it.photos || []); }); }); return a; }
  function jsonExport() {
    var ids = allPhotoIds(M), out = { app: 'mgs-zamer', v: 1, measure: M, photos: {} };
    return ids.reduce(function (p, id) { return p.then(function () { return idb('readonly', function (s) { return s.get(id); }).then(function (b) { if (b) return blobToDataURL(b).then(function (d) { out.photos[id] = d; }); }); }); }, Promise.resolve()).then(function () { return JSON.stringify(out); });
  }
  /* мини-zip без сжатия */
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { var c = 0xFFFFFFFF; for (var i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    var enc = new TextEncoder(), parts = [], cen = [], off = 0;
    files.forEach(function (f) {
      var nm = enc.encode(f.name), d = typeof f.data === 'string' ? enc.encode(f.data) : f.data, cr = crc32(d);
      var h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, cr, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(h.buffer), nm, d);
      var c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, cr, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      cen.push(new Uint8Array(c.buffer), nm); off += 30 + nm.length + d.length;
    });
    var cs = cen.reduce(function (a, x) { return a + x.length; }, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(cen, [new Uint8Array(e.buffer)]), { type: 'application/zip' });
  }
  function svgWrap(s) { return '<?xml version="1.0" encoding="UTF-8"?>\n' + s; }
  function doExport(kind) {
    var g = Z.build(M), b = base();
    if (kind === '3ds-mm') return download(b + '_mm.3ds', Z.to3DS(g, 1));
    if (kind === '3ds-cm') return download(b + '_cm.3ds', Z.to3DS(g, 0.1));
    if (kind === 'obj') { var o = Z.toOBJ(g, 1, b); return download(b + '_obj.zip', zip([{ name: b + '.obj', data: o.obj }, { name: b + '.mtl', data: o.mtl }])); }
    if (kind === 'pdf') { printReport(); return; }
    if (kind === 'json') return jsonExport().then(function (j) { download(b + '.zamer.json', j, 'application/json'); });
    if (kind === 'zip') return jsonExport().then(function (j) {
      var f = [{ name: b + '.zamer.json', data: j }, { name: 'plan.svg', data: svgWrap(planSVG(g)) }];
      M.walls.forEach(function (w, i) { f.push({ name: 'stena_' + (i + 1) + '.svg', data: svgWrap(elevSVG(i)) }); });
      if (g.ok) { var o = Z.toOBJ(g, 1, b); f.push({ name: b + '_mm.3ds', data: Z.to3DS(g, 1) }, { name: b + '_cm.3ds', data: Z.to3DS(g, 0.1) }, { name: b + '.obj', data: o.obj }, { name: b + '.mtl', data: o.mtl }); }
      download(b + '.zip', zip(f));
    });
    if (kind === 'share') {
      if (!g.ok) return toast('Сначала укажите длины всех стен');
      var files = [new File([Z.to3DS(g, 1)], b + '_mm.3ds', { type: 'application/octet-stream' })];
      return jsonExport().then(function (j) {
        files.push(new File([j], b + '.zamer.json', { type: 'application/json' }));
        var data = { files: files, title: 'Замер: ' + M.name, text: 'Замер ' + M.name + (M.address ? ', ' + M.address : '') };
        if (navigator.canShare && !navigator.canShare(data)) { delete data.files; }
        return navigator.share(data);
      }).catch(function () {});
    }
  }
  function printReport() {
    Promise.all(allPhotoIds(M).map(photoURL)).then(function () {
      $('#print').innerHTML = reportHTML(false);
      setTimeout(function () { window.print(); }, 150);
    });
  }

  /* ---------------- фото ---------------- */
  function photosHTML(p) {
    var ids = getP(M, p) || [];
    return '<div class="photos">' + ids.map(function (id) { return '<div class="ph" data-ph="' + id + '"><button data-phdel="' + p + '|' + id + '">✕</button></div>'; }).join('') +
      '<button class="phadd" data-phadd="' + p + '|cam"><div><span>📷</span>Снять</div></button><button class="phadd" data-phadd="' + p + '|gal"><div><span>🖼</span>Галерея</div></button></div>';
  }
  function hydratePhotos(rootEl) {
    (rootEl || document).querySelectorAll('[data-ph]').forEach(function (el) { photoURL(el.dataset.ph).then(function (u) { if (u) el.style.backgroundImage = 'url(' + u + ')'; }); });
  }
  var phTarget = null;
  function onFiles(files) {
    if (!phTarget || !files || !files.length) return;
    var p = phTarget, arr = getP(p.root, p.path); if (!arr) { setP(p.root, p.path, []); arr = getP(p.root, p.path); }
    Array.prototype.reduce.call(files, function (pr, f) {
      return pr.then(function () { return compress(f); }).then(function (b) { var id = 'ph_' + uid(); return putPhoto(id, b).then(function () { arr.push(id); }); });
    }, Promise.resolve()).then(function () { save(); if (S.sheet) renderSheet(); else render(); }).catch(function () { toast('Не удалось сохранить фото'); });
  }
  $('#fileCam').addEventListener('change', function (e) { onFiles(e.target.files); e.target.value = ''; });
  $('#fileGal').addEventListener('change', function (e) { onFiles(e.target.files); e.target.value = ''; });
  $('#fileJson').addEventListener('change', function (e) {
    var f = e.target.files[0]; e.target.value = ''; if (!f) return;
    f.text().then(function (t) {
      var d = JSON.parse(t), m = d.measure || d;
      if (!m || !m.walls) throw new Error('bad');
      var ids = Object.keys(d.photos || {});
      return ids.reduce(function (p, id) { return p.then(function () { return fetch(d.photos[id]).then(function (r) { return r.blob(); }).then(function (b) { return putPhoto(id, b); }); }); }, Promise.resolve()).then(function () {
        if (lsGet(KEY + m.id)) m.id = uid();
        m.updated = Date.now(); lsSet(KEY + m.id, JSON.stringify(m)); M = m; S.screen = 'edit'; S.tab = 'obj'; S.wall = 0; render(); toast('Замер открыт');
      });
    }).catch(function () { toast('Это не файл замера'); });
  });

  /* ---------------- элемент (нижняя панель) ---------------- */
  function openSheet(o) { S.sheet = o; renderSheet(); }
  function closeSheet() { S.sheet = null; var ov = $('.ov'); if (ov) ov.remove(); document.body.style.overflow = ''; }
  function renderSheet() {
    var sh = S.sheet, ov = $('.ov'); if (!ov) { ov = document.createElement('div'); ov.className = 'ov'; document.body.appendChild(ov); }
    document.body.style.overflow = 'hidden';
    var w = M.walls[sh.wi], cat = CATS.find(function (c) { return c.k === sh.cat; }), h;
    if (sh.mode === 'pick') {
      h = '<h2>Добавить на «' + esc(w.name) + '»</h2><p class="hint">' + cat.ic + ' ' + esc(cat.t) + '</p><div class="grid">' + cat.types.map(function (t) { return '<div class="tile" data-pick="' + t + '"><div class="sw" style="background:' + rgb(TYPES[t].c) + '"></div>' + esc(TYPES[t].t) + '</div>'; }).join('') + '</div>' +
        '<p style="margin:14px 0 6px"><a href="#" data-allt style="color:#7e8f12;font-weight:600">' + (sh.all ? 'Скрыть другие типы' : 'Показать все типы элементов') + '</a></p>' +
        (sh.all ? '<div class="grid">' + Object.keys(TYPES).filter(function (t) { return cat.types.indexOf(t) < 0; }).map(function (t) { return '<div class="tile" data-pick="' + t + '"><div class="sw" style="background:' + rgb(TYPES[t].c) + '"></div>' + esc(TYPES[t].t) + '</div>'; }).join('') + '</div>' : '') +
        '<div class="bar"><button class="btn ghost" data-sh="cancel">Отмена</button></div>';
    } else {
      var it = sh.draft, ty = TYPES[it.type] || TYPES.other, k = ty.kind, R = { root: it, d: 1 };
      var L = wallL(w), H = wallH(w);
      h = '<h2>' + esc(ty.t) + '</h2><p class="hint">' + esc(w.name) + ' · длина ' + fmt(L) + ' мм · высота ' + fmt(H) + ' мм</p>';
      h += '<h3><span class="n">1</span>Откуда меряем по горизонтали</h3><div class="seg" style="margin-bottom:12px"><button data-from="L" class="' + (it.from !== 'R' ? 'on' : '') + '">от левого угла</button><button data-from="R" class="' + (it.from === 'R' ? 'on' : '') + '">от правого угла</button></div>';
      var side = it.from === 'R' ? 'правого' : 'левого';
      h += '<h3><span class="n">2</span>Положение на стене</h3><div class="g2">';
      if (k === 'open') h += fld('От ' + side + ' угла до ' + side + ' края', inp('off', { root: it, d: 1, n: 1 }), 1) + fld('От пола до низа', inp('z', { root: it, d: 1, n: 1, ph: ty.floor ? '0' : 'напр. 850' }), !ty.floor);
      else if (k === 'point') h += fld('От ' + side + ' угла до центра', inp('off', { root: it, d: 1, n: 1 }), 1) + fld('От пола до центра', inp('z', { root: it, d: 1, n: 1, ph: it.type === 'socket' ? 'напр. 300 / 1100' : '' }), 1);
      else if (k === 'pipe') h += fld('От ' + side + ' угла до центра трубы', inp('off', { root: it, d: 1, n: 1 }), 1) + fld('От стены до трубы', inp('gap', { root: it, d: 1, n: 1, ph: '0' }));
      else h += fld('От ' + side + ' угла до ' + side + ' края', inp('off', { root: it, d: 1, n: 1 }), 1) + fld(ty.top ? 'От пола до низа (если не до потолка)' : 'От пола до низа', inp('z', { root: it, d: 1, n: 1, ph: ty.floor ? '0' : '' }), !ty.floor && !ty.top);
      h += '</div>';
      h += '<h3><span class="n">3</span>' + (k === 'open' ? 'Размеры — по 3 точкам' : 'Размеры') + '</h3>';
      if (k === 'open') {
        h += '<label class="f req">Ширина, мм</label><div class="g3">' + ['Низ', 'Середина', 'Верх'].map(function (t, i) { return '<div><label class="f">' + t + '</label>' + inp('w.' + i, { root: it, d: 1, n: 1 }) + '</div>'; }).join('') + '</div>';
        h += '<label class="f req" style="margin-top:10px">Высота, мм</label><div class="g3">' + ['Слева', 'Центр', 'Справа'].map(function (t, i) { return '<div><label class="f">' + t + '</label>' + inp('h.' + i, { root: it, d: 1, n: 1 }) + '</div>'; }).join('') + '</div>';
        h += '<div class="calc" id="icalc">В расчёт (наименьшее): <b>' + fmt(minOf(it.w)) + ' × ' + fmt(minOf(it.h)) + '</b> мм</div>';
        h += '<div class="g2" style="margin-top:10px">' + fld('Глубина откоса', inp('depth', { root: it, d: 1, n: 1, ph: 'напр. 250' }), 1) + '</div>';
        h += '<h3><span class="n">4</span>Дополнительно</h3><div class="g2">';
        if (it.type === 'window' || it.type === 'balcony') h += fld('Подоконник (вылет), мм', inp('sill', { root: it, d: 1, n: 1 })) + fld('Открывание', sel('opening', OPEN_W, R), 1);
        else if (it.type === 'door') h += fld('Открывание', sel('opening', OPEN_D, R), 1) + fld('Наличник / короб, мм', inp('trim', { root: it, d: 1, n: 1 }));
        h += '</div>';
      } else if (k === 'point') {
        h += '<div class="g2">';
        if (ty.count) h += fld('Сколько в блоке, шт', inp('count', { root: it, d: 1, n: 1, ph: '1' }));
        if (ty.purpose) h += fld('Под какую технику', sel('purpose', CABLE_FOR, R), 1);
        if (ty.dia) h += fld('Диаметр, мм', inp('dia', { root: it, d: 1, n: 1, ph: '50' }));
        h += '</div>';
        if (!ty.count && !ty.purpose && !ty.dia) h += '<p class="hint">Достаточно положения центра.</p>';
      } else if (k === 'pipe') {
        h += '<div class="g2">' + fld('Диаметр, мм', inp('dia', { root: it, d: 1, n: 1, ph: '110' }), 1) + '</div><p class="hint">Труба идёт от пола до потолка.</p>';
      } else {
        h += '<div class="g3">' + fld('Ширина', inp('w0', { root: it, d: 1, n: 1 }), 1) + fld('Высота', inp('h0', { root: it, d: 1, n: 1 }), 1) + fld(ty.flat ? 'Выступ (если есть)' : 'Выступ от стены', inp('depth', { root: it, d: 1, n: 1 }), !ty.flat) + '</div>';
      }
      h += fld('Примечание', inp('note', { root: it, d: 1, ta: 1 }));
      h += '<h3><span class="n">' + (k === 'open' ? 5 : 4) + '</span>Фото элемента</h3>' + photosHTMLd(it) + '';
      var ms = itemMissing(it, w);
      h += '<div class="calc" id="imiss" style="color:#d93025">' + (ms.length ? 'Не указано: ' + esc(ms.join(', ')) : '') + '</div>';
      h += '<div class="bar"><div class="chips"><button class="btn p" data-sh="save">Сохранить</button><button class="btn ghost" data-sh="cancel">Отмена</button></div>' + (sh.ii >= 0 ? '<button class="btn red" data-sh="del">Удалить</button>' : '') + '</div>';
    }
    ov.innerHTML = '<div class="sheet">' + h + '</div>';
    hydratePhotos(ov);
  }
  function photosHTMLd(it) {
    var ids = it.photos || [];
    return '<div class="photos">' + ids.map(function (id) { return '<div class="ph" data-ph="' + id + '"><button data-phdeld="' + id + '">✕</button></div>'; }).join('') +
      '<button class="phadd" data-phaddd="cam"><div><span>📷</span>Снять</div></button><button class="phadd" data-phaddd="gal"><div><span>🖼</span>Галерея</div></button></div>';
  }

  /* ---------------- события ---------------- */
  function goTab(t) { S.tab = t; closeSheet(); render(); window.scrollTo(0, 0); }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-a],[data-tab],[data-gowall],[data-open],[data-del],[data-nwset],[data-add],[data-none],[data-item],[data-pick],[data-sh],[data-from],[data-ang],[data-elev],[data-dl],[data-v3],[data-ex],[data-go],[data-phadd],[data-phdel],[data-phaddd],[data-phdeld],[data-allt]');
    if (!t) { if (e.target.classList.contains('ov')) closeSheet(); return; }
    var d = t.dataset;
    if (d.allt !== undefined) { e.preventDefault(); S.sheet.all = !S.sheet.all; renderSheet(); return; }
    if (d.a === 'home') { M = null; S.screen = 'list'; closeSheet(); render(); return; }
    if (d.a === 'new') { S.nw = { name: '', address: '', type: 'kitchen', n: 4, H: '' }; S.screen = 'new'; render(); return; }
    if (d.a === 'openjson') { $('#fileJson').click(); return; }
    if (d.a === 'start') { var nw = S.nw; M = newMeasure({ name: nw.name.trim() || 'Замер ' + new Date().toLocaleDateString('ru-RU'), address: nw.address, type: nw.type, n: nw.n, H: nw.H }); save(); lsSet(KEY + M.id, JSON.stringify(M)); S.screen = 'edit'; S.tab = 'obj'; S.wall = 0; render(); return; }
    if (d.a === 'addwall') { M.walls.push(newWall(M.walls.length)); save(); render(); return; }
    if (d.a === 'delwall') { var lw = M.walls[M.walls.length - 1]; if ((lw.items || []).length || wallMeasured(lw)) { if (!confirm('Удалить «' + lw.name + '» вместе с размерами?')) return; } M.walls.pop(); save(); render(); return; }
    if (d.nwset) { S.nw[d.nwset] = d.nwset === 'n' ? +d.v : d.v; renderNew(); return; }
    if (d.open) { if (e.target.closest('[data-del]')) return; var r = lsGet(KEY + d.open); if (r) { M = JSON.parse(r); S.screen = 'edit'; S.tab = 'obj'; S.wall = 0; S.elev = 0; render(); } return; }
    if (d.del) { e.stopPropagation(); var m0 = JSON.parse(lsGet(KEY + d.del) || 'null'); if (m0 && confirm('Удалить замер «' + m0.name + '»? Это нельзя отменить.')) { allPhotoIds(m0).forEach(delPhoto); lsDel(KEY + d.del); render(); } return; }
    if (d.tab) { goTab(d.tab); return; }
    if (d.gowall) { S.tab = 'walls'; S.wall = +d.gowall; closeSheet(); render(); window.scrollTo(0, 0); return; }
    if (d.elev) { S.elev = +d.elev; render(); return; }
    if (d.ang) { M.walls[S.wall].angle = d.ang; save(); render(); return; }
    if (d.none) { var w = M.walls[S.wall]; w.cats = w.cats || {}; w.cats[d.none] = w.cats[d.none] === 'none' ? '' : 'none'; save(); var y = window.scrollY; render(); window.scrollTo(0, y); return; }
    if (d.add) { openSheet({ mode: 'pick', wi: S.wall, cat: d.add, ii: -1 }); return; }
    if (d.item) { var it0 = M.walls[S.wall].items[+d.item], c0 = CATS.find(function (c) { return c.types.indexOf(it0.type) >= 0; }) || CATS[7]; openSheet({ mode: 'edit', wi: S.wall, cat: c0.k, ii: +d.item, draft: JSON.parse(JSON.stringify(it0)) }); return; }
    if (d.pick) { var ty = TYPES[d.pick]; S.sheet.mode = 'edit'; S.sheet.draft = { id: uid(), type: d.pick, from: 'L', off: '', z: '', w: ['', '', ''], h: ['', '', ''], photos: [] }; renderSheet(); return; }
    if (d.from) { S.sheet.draft.from = d.from; renderSheet(); return; }
    if (d.sh === 'cancel') { closeSheet(); return; }
    if (d.sh === 'save') {
      var sh = S.sheet, wl = M.walls[sh.wi]; wl.items = wl.items || [];
      if (sh.ii >= 0) wl.items[sh.ii] = sh.draft; else wl.items.push(sh.draft);
      var y2 = window.scrollY; closeSheet(); save(); render(); window.scrollTo(0, y2); return;
    }
    if (d.sh === 'del') { if (!confirm('Удалить элемент?')) return; var sh2 = S.sheet; (sh2.draft.photos || []).forEach(delPhoto); M.walls[sh2.wi].items.splice(sh2.ii, 1); var y3 = window.scrollY; closeSheet(); save(); render(); window.scrollTo(0, y3); return; }
    if (d.dl) { download(base() + (d.dl === 'plan' ? '_plan.svg' : '_stena_' + (S.elev + 1) + '.svg'), svgWrap(d.dl === 'plan' ? planSVG(Z.build(M)) : elevSVG(S.elev)), 'image/svg+xml'); return; }
    if (d.v3) { S.v3 = d.v3; document.querySelectorAll('[data-v3]').forEach(function (b) { b.classList.toggle('on', b.dataset.v3 === S.v3); }); setView(S.v3); return; }
    if (d.ex) { doExport(d.ex); return; }
    if (d.go) { var lst = (d.go[0] === 'E' ? S._chk.E : S._chk.W)[+d.go.slice(1)]; if (!lst) return; var g = lst.go; S.tab = g.tab; if (g.wall !== undefined) S.wall = g.wall; render(); window.scrollTo(0, 0); if (g.item !== undefined) { var it1 = M.walls[g.wall].items[g.item], c1 = CATS.find(function (c) { return c.types.indexOf(it1.type) >= 0; }) || CATS[7]; openSheet({ mode: 'edit', wi: g.wall, cat: c1.k, ii: g.item, draft: JSON.parse(JSON.stringify(it1)) }); } return; }
    if (d.phadd) { var pp = d.phadd.split('|'); phTarget = { root: M, path: pp[0] }; $(pp[1] === 'cam' ? '#fileCam' : '#fileGal').click(); return; }
    if (d.phaddd) { phTarget = { root: S.sheet.draft, path: 'photos' }; $(d.phaddd === 'cam' ? '#fileCam' : '#fileGal').click(); return; }
    if (d.phdel) { var q = d.phdel.split('|'), arr = getP(M, q[0]); arr.splice(arr.indexOf(q[1]), 1); delPhoto(q[1]); save(); var y4 = window.scrollY; render(); window.scrollTo(0, y4); return; }
    if (d.phdeld) { var a2 = S.sheet.draft.photos; a2.splice(a2.indexOf(d.phdeld), 1); renderSheet(); return; }
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.dataset.nw) { S.nw[t.dataset.nw] = t.value; return; }
    if (t.dataset.p && t.dataset.d && S.sheet) {
      setP(S.sheet.draft, t.dataset.p, t.value);
      var it = S.sheet.draft, w = M.walls[S.sheet.wi], ic = $('#icalc'), im = $('#imiss');
      if (ic) ic.innerHTML = 'В расчёт (наименьшее): <b>' + fmt(minOf(it.w)) + ' × ' + fmt(minOf(it.h)) + '</b> мм';
      if (im) { var ms = itemMissing(it, w); im.textContent = ms.length ? 'Не указано: ' + ms.join(', ') : ''; }
      return;
    }
    if (t.dataset.p && M) {
      setP(M, t.dataset.p, t.value); save();
      if (t.dataset.r) { render(); return; }
      if (S.tab === 'walls') { var w2 = M.walls[S.wall], c = $('#wcalc'), el = $('#welev'); if (c) c.innerHTML = wallCalc(w2); if (el) el.innerHTML = elevSVG(S.wall); }
      if (t.dataset.p === 'name') { var tt = $('.ttl'); if (tt) tt.textContent = M.name; }
      clearTimeout(refreshBadge._t); refreshBadge._t = setTimeout(refreshBadge, 500);
    }
    if (t.dataset.pb !== undefined && M) {
      if (t.dataset.pb === 'closed') { M.closed = t.checked; save(); render(); return; }
      setP(M, t.dataset.pb, t.checked); save();
    }
    if (t.hasAttribute && t.hasAttribute('data-lbl')) { S.labels = t.checked; if (V3) V3.labels.forEach(function (s) { s.visible = S.labels; }); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.sheet) closeSheet(); });
  window.addEventListener('beforeprint', function () { if (M && !$('#print').innerHTML) $('#print').innerHTML = reportHTML(false); });
  window.addEventListener('afterprint', function () { $('#print').innerHTML = ''; });

  render();
})();
