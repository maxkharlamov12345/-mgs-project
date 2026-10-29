/* MGS Замер — геометрия комнаты и выгрузка в 3DS / OBJ / SVG.
   Единицы — миллиметры. План: x вправо, y вверх; z — высота от пола.
   Обход стен — по часовой стрелке: стоим в комнате лицом к стене 1, следующая стена справа.
   Идём вдоль стены от её левого угла к правому, помещение — справа по ходу, толщина стены — слева (снаружи).
   Угол со следующей стеной: 90 — обычный (внутренний) угол, 270 — внешний (выступает в комнату). */
(function (root) {
  'use strict';

  var TYPES = {
    window:   { t: 'Окно',                 kind: 'open', c: [150, 205, 245] },
    door:     { t: 'Дверь',                kind: 'open', c: [150, 110, 80], floor: true },
    arch:     { t: 'Проём / арка',         kind: 'open', c: [200, 200, 200], floor: true },
    balcony:  { t: 'Балконный блок',       kind: 'open', c: [150, 205, 245] },
    socket:   { t: 'Розетка',              kind: 'point', c: [225, 40, 40], count: true },
    'switch': { t: 'Выключатель',          kind: 'point', c: [250, 140, 0], count: true },
    cable:    { t: 'Вывод кабеля',         kind: 'point', c: [250, 215, 50], purpose: true },
    panel:    { t: 'Электрощит',           kind: 'box', c: [35, 35, 35] },
    lamp:     { t: 'Светильник / бра',     kind: 'point', c: [255, 240, 150] },
    hvs:      { t: 'Выход ХВС',            kind: 'point', c: [30, 110, 230] },
    gvs:      { t: 'Выход ГВС',            kind: 'point', c: [200, 30, 30] },
    drain:    { t: 'Слив (канализация)',   kind: 'point', c: [20, 20, 20], dia: true },
    riser:    { t: 'Стояк',                kind: 'pipe', c: [120, 140, 150] },
    wmeter:   { t: 'Счётчик / фильтры воды', kind: 'box', c: [80, 190, 245] },
    gaspipe:  { t: 'Газовая труба',        kind: 'pipe', c: [250, 190, 40] },
    gasmeter: { t: 'Газовый счётчик',      kind: 'box', c: [190, 190, 190] },
    gastap:   { t: 'Газовый кран / отвод', kind: 'point', c: [250, 190, 40] },
    boiler:   { t: 'Котёл / колонка',      kind: 'box', c: [240, 240, 240] },
    radiator: { t: 'Радиатор',             kind: 'box', c: [235, 235, 235] },
    heatpipe: { t: 'Труба отопления',      kind: 'pipe', c: [255, 140, 100] },
    ventduct: { t: 'Вентканал / отверстие вытяжки', kind: 'box', c: [140, 40, 170], flat: true },
    ventbox:  { t: 'Короб вентиляции',     kind: 'box', c: [170, 70, 190] },
    beam:     { t: 'Ригель / балка',       kind: 'box', c: [160, 160, 160], top: true },
    column:   { t: 'Колонна / пилястра',   kind: 'box', c: [160, 160, 160], floor: true },
    box:      { t: 'Короб (ГКЛ, трубы)',   kind: 'box', c: [175, 175, 175] },
    ledge:    { t: 'Выступ / порог / подиум', kind: 'box', c: [175, 175, 175], floor: true },
    apron:    { t: 'Фартук',               kind: 'box', c: [210, 200, 170], flat: true },
    niche:    { t: 'Ниша',                 kind: 'recess', c: [150, 140, 125] },
    other:    { t: 'Прочее',               kind: 'box', c: [190, 190, 190] }
  };

  var CATS = [
    { k: 'open',   t: 'Окна, двери, проёмы',      ic: '🚪', types: ['window', 'door', 'arch', 'balcony'] },
    { k: 'el',     t: 'Электрика',                ic: '🔌', types: ['socket', 'switch', 'cable', 'panel', 'lamp'] },
    { k: 'water',  t: 'Вода и канализация',       ic: '🚰', types: ['hvs', 'gvs', 'drain', 'riser', 'wmeter'] },
    { k: 'gas',    t: 'Газ',                      ic: '🔥', types: ['gaspipe', 'gasmeter', 'gastap', 'boiler'] },
    { k: 'heat',   t: 'Отопление',                ic: '♨️', types: ['radiator', 'heatpipe'] },
    { k: 'vent',   t: 'Вентиляция',               ic: '🌀', types: ['ventduct', 'ventbox'] },
    { k: 'struct', t: 'Ригели, колонны, короба',  ic: '🧱', types: ['beam', 'column', 'box', 'ledge'] },
    { k: 'other',  t: 'Фартук, ниши, прочее',     ic: '▦', types: ['apron', 'niche', 'other'], opt: true }
  ];

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  }
  function vals(a) { return (a || []).map(num).filter(function (x) { return x !== null && x > 0; }); }
  function minOf(a) { var v = vals(a); return v.length ? Math.min.apply(null, v) : null; }

  /* Размеры элемента в координатах стены: u0..u1 вдоль стены от левого угла, z0..z1 от пола, глубина в комнату. */
  function itemBox(it, L, H) {
    var ty = TYPES[it.type] || TYPES.other, k = ty.kind;
    var off = num(it.off), z = num(it.z), from = it.from === 'R' ? 'R' : 'L';
    var w, h, dep, z0;
    if (k === 'open') {
      w = minOf(it.w); h = minOf(it.h); z0 = ty.floor && z === null ? 0 : z;
      dep = 0;
      if (off === null || w === null || h === null || z0 === null) return null;
      var u0 = from === 'R' ? L - off - w : off;
      return { u0: u0, u1: u0 + w, z0: z0, z1: z0 + h, dep: 0, cut: true };
    }
    if (k === 'point') {
      var cnt = Math.max(1, Math.round(num(it.count) || 1));
      w = it.type === 'drain' ? (num(it.dia) || 50) : 80 * cnt; h = it.type === 'drain' ? w : 80;
      if (off === null || z === null) return null;
      var uc = from === 'R' ? L - off : off;
      return { u0: uc - w / 2, u1: uc + w / 2, z0: z - h / 2, z1: z + h / 2, dep: 25 };
    }
    if (k === 'recess') {                                         // ниша: вырез в стене + углубление
      w = num(it.w0); h = num(it.h0); dep = num(it.depth); z0 = z;
      if (off === null || w === null || h === null || z0 === null || dep === null) return null;
      var r0 = from === 'R' ? L - off - w : off;
      return { u0: r0, u1: r0 + w, z0: z0, z1: z0 + h, dep: dep, cut: true, recess: true };
    }
    if (k === 'pipe') {
      var d = num(it.dia) || 110;
      if (off === null) return null;
      var c = from === 'R' ? L - off : off;
      var gap = num(it.gap); if (gap === null) gap = 0;           // от стены до трубы
      return { u0: c - d / 2, u1: c + d / 2, z0: 0, z1: H, dep: d, t0: gap };
    }
    // box
    w = num(it.w0); h = num(it.h0); dep = num(it.depth);
    z0 = z;
    if (ty.floor && z0 === null) z0 = 0;
    if (ty.top && h !== null && z0 === null) z0 = H - h;
    if (ty.flat && dep === null) dep = 10;
    if (off === null || w === null || h === null || z0 === null || dep === null) return null;
    var b0 = from === 'R' ? L - off - w : off;
    return { u0: b0, u1: b0 + w, z0: z0, z1: z0 + h, dep: dep };
  }

  function extAt(ang, T) {               // удлинение стен у угла, чтобы закрыть его снаружи
    if (!(ang > 0 && ang < 180)) return 0;
    return Math.min(3 * T, T / Math.tan(ang * Math.PI / 360));
  }

  /* Главная функция: план + список сеток. */
  function build(M) {
    var T = num(M.T) || 150, Hroom = num(M.H) || 2700, n = M.walls.length;
    var closed = n >= 3 && M.closed !== false;
    var W = M.walls.map(function (w) {
      return { L: minOf(w.len), H: minOf(w.hgt) || Hroom, ang: num(w.angle) === null ? 90 : num(w.angle) };
    });
    var ok = n > 0 && W.every(function (w) { return w.L; });
    var res = { ok: ok, closed: closed, T: T, W: W, pts: [], dirs: [], meshes: [], items: [], closure: null };
    if (!ok) return res;
    var x = 0, y = 0, hd = 0;
    res.pts.push([0, 0]);
    for (var i = 0; i < n; i++) {
      var d = [Math.cos(hd * Math.PI / 180), Math.sin(hd * Math.PI / 180)];
      res.dirs.push(d);
      x += d[0] * W[i].L; y += d[1] * W[i].L; res.pts.push([x, y]);
      if (i < n - 1 || closed) hd -= (180 - W[i].ang);
    }
    if (closed) res.closure = Math.hypot(x, y);
    var e0 = [], e1 = [];
    for (i = 0; i < n; i++) { e0.push(0); e1.push(0); }
    for (i = 0; i < n; i++) {
      if (i === n - 1 && !closed) break;
      var e = extAt(W[i].ang, T); e1[i] = e; e0[(i + 1) % n] = e;
    }
    res.e0 = e0; res.e1 = e1;

    var meshes = res.meshes;
    function mesh(name, col, kind) { var m = { name: name, c: col, kind: kind, v: [], f: [] }; meshes.push(m); return m; }
    var BF = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
    function lbox(m, wi, u0, u1, t0, t1, z0, z1) {
      var S = res.pts[wi], d = res.dirs[wi], nm = [d[1], -d[0]], o = m.v.length;
      [z0, z1].forEach(function (z) {
        [[u0, t0], [u1, t0], [u1, t1], [u0, t1]].forEach(function (p) {
          m.v.push([S[0] + d[0] * p[0] + nm[0] * p[1], S[1] + d[1] * p[0] + nm[1] * p[1], z]);
        });
      });
      BF.forEach(function (f) { m.f.push([f[0] + o, f[1] + o, f[2] + o]); });
    }
    res.lbox = lbox;

    M.walls.forEach(function (w, wi) {
      var L = W[wi].L, H = W[wi].H, cuts = [];
      (w.items || []).forEach(function (it, ii) {
        var b = itemBox(it, L, H); if (!b) return;
        res.items.push({ wi: wi, ii: ii, it: it, b: b });
        if (b.cut) cuts.push([b.u0, b.u1, Math.max(0, b.z0), Math.min(H, b.z1)]);
      });
      var wm = mesh('Stena' + (wi + 1), [228, 225, 216], 'wall');
      var us = [-e0[wi], L + e1[wi]];
      cuts.forEach(function (c) { us.push(c[0], c[1]); });
      us = us.filter(function (u) { return u >= -e0[wi] && u <= L + e1[wi]; })
             .sort(function (a, b) { return a - b; })
             .filter(function (u, k, a) { return k === 0 || u - a[k - 1] > 0.01; });
      for (var k = 0; k < us.length - 1; k++) {
        var a = us[k], b2 = us[k + 1], zs = [[0, H]];
        cuts.forEach(function (c) {
          if (c[0] <= a + 0.01 && b2 <= c[1] + 0.01) {
            var nz = [];
            zs.forEach(function (z) {
              if (c[2] > z[0]) nz.push([z[0], Math.min(z[1], c[2])]);
              if (c[3] < z[1]) nz.push([Math.max(z[0], c[3]), z[1]]);
            });
            zs = nz;
          }
        });
        zs.forEach(function (z) { if (z[1] - z[0] > 0.5) lbox(wm, wi, a, b2, -T, 0, z[0], z[1]); });
      }
    });

    var cnt = {};
    res.items.forEach(function (r) {
      var ty = TYPES[r.it.type] || TYPES.other;
      var tag = (r.it.type || 'el').slice(0, 5) + '_' + (r.wi + 1) + '_' + (cnt[r.it.type] = (cnt[r.it.type] || 0) + 1);
      var m = mesh(tag, ty.c, r.it.type); m.ref = r;
      if (r.b.recess) {
        var D = r.b.dep, s0 = 20;
        lbox(m, r.wi, r.b.u0, r.b.u1, -D - s0, -D, r.b.z0, r.b.z1);
        lbox(m, r.wi, r.b.u0 - s0, r.b.u0, -D - s0, 0, r.b.z0 - s0, r.b.z1 + s0);
        lbox(m, r.wi, r.b.u1, r.b.u1 + s0, -D - s0, 0, r.b.z0 - s0, r.b.z1 + s0);
        lbox(m, r.wi, r.b.u0, r.b.u1, -D - s0, 0, r.b.z1, r.b.z1 + s0);
        if (r.b.z0 > 0.5) lbox(m, r.wi, r.b.u0, r.b.u1, -D - s0, 0, r.b.z0 - s0, r.b.z0);
      } else if (r.b.cut) {   // окно/дверь: тонкая рамка-«стекло» в проёме, чтобы было видно в PRO100
        var col = r.it.type === 'door' ? -T * 0.5 - 20 : -T * 0.5 - 10;
        if (r.it.type !== 'arch') lbox(m, r.wi, r.b.u0, r.b.u1, col, col + (r.it.type === 'door' ? 40 : 20), r.b.z0, r.b.z1);
        else lbox(m, r.wi, r.b.u0, r.b.u1, -T, 0, r.b.z0 - 0.01, r.b.z0);
        if (r.it.type === 'window' && num(r.it.sill)) lbox(m, r.wi, r.b.u0 - 50, r.b.u1 + 50, -T * 0.5, num(r.it.sill), r.b.z0 - 40, r.b.z0);
      } else {
        var t0 = r.b.t0 || 0;
        lbox(m, r.wi, r.b.u0, r.b.u1, t0, t0 + r.b.dep, r.b.z0, r.b.z1);
      }
    });

    if (closed) {
      var poly = res.pts.slice(0, n), fm = mesh('Pol', [175, 145, 105], 'floor');
      var tri = earclip(poly);
      poly.forEach(function (p) { fm.v.push([p[0], p[1], -20]); });
      poly.forEach(function (p) { fm.v.push([p[0], p[1], 0]); });
      tri.forEach(function (t) { fm.f.push([t[0], t[2], t[1]]); fm.f.push([t[0] + n, t[1] + n, t[2] + n]); });
    }
    return res;
  }

  function earclip(P) {
    var n = P.length, idx = [], tri = [], area = 0, i;
    for (i = 0; i < n; i++) { idx.push(i); var j = (i + 1) % n; area += P[i][0] * P[j][1] - P[j][0] * P[i][1]; }
    var sg = area > 0 ? 1 : -1;
    function cr(a, b, c) { return ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) * sg; }
    var guard = 0;
    while (idx.length > 3 && guard++ < 1000) {
      var cut = false;
      for (var k = 0; k < idx.length; k++) {
        var a = idx[(k - 1 + idx.length) % idx.length], b = idx[k], c = idx[(k + 1) % idx.length];
        if (cr(P[a], P[b], P[c]) <= 0) continue;
        var inside = idx.some(function (q) {
          return q !== a && q !== b && q !== c && cr(P[a], P[b], P[q]) > 0 && cr(P[b], P[c], P[q]) > 0 && cr(P[c], P[a], P[q]) > 0;
        });
        if (inside) continue;
        tri.push(sg > 0 ? [a, b, c] : [a, c, b]); idx.splice(k, 1); cut = true; break;
      }
      if (!cut) break;
    }
    if (idx.length === 3) tri.push(sg > 0 ? [idx[0], idx[1], idx[2]] : [idx[0], idx[2], idx[1]]);
    return tri;
  }

  /* ---------- 3DS (бинарный, без библиотек; Z вверх) ---------- */
  function to3DS(res, scale) {
    var parts = [];
    function u16(n) { var b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; }
    function u32(n) { var b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; }
    function f32(n) { var b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, n, true); return b; }
    function str(s) { var a = []; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); a.push(c < 128 ? c : 95); } a.push(0); return new Uint8Array(a); }
    function cat(list) { var len = 0; list.forEach(function (x) { len += x.length; }); var o = new Uint8Array(len), p = 0; list.forEach(function (x) { o.set(x, p); p += x.length; }); return o; }
    function chunk(id, data) { return cat([u16(id), u32(6 + data.length), data]); }
    var mats = {}, objs = [];
    res.meshes.forEach(function (m, i) {
      if (!m.f.length) return;
      var mname = 'm_' + m.c.join('_');
      mats[mname] = m.c;
      var vl = [u16(m.v.length)];
      m.v.forEach(function (v) { vl.push(f32(v[0] * scale), f32(v[1] * scale), f32(v[2] * scale)); });
      var fl = [u16(m.f.length)], fi = [str(mname), u16(m.f.length)];
      m.f.forEach(function (f, k) { fl.push(u16(f[0]), u16(f[1]), u16(f[2]), u16(7)); fi.push(u16(k)); });
      var faces = chunk(0x4120, cat(fl.concat([chunk(0x4130, cat(fi))])));
      var name = m.name.slice(0, 10);
      objs.push(chunk(0x4000, cat([str(name), chunk(0x4100, cat([chunk(0x4110, cat(vl)), faces]))])));
    });
    var ml = Object.keys(mats).map(function (k) {
      var c = mats[k];
      return chunk(0xAFFF, cat([chunk(0xA000, str(k)), chunk(0xA020, chunk(0x0011, new Uint8Array(c)))]));
    });
    var edit = chunk(0x3D3D, cat([chunk(0x3D3E, u32(3))].concat(ml, objs)));
    return chunk(0x4D4D, cat([chunk(0x0002, u32(3)), edit]));
  }

  /* ---------- OBJ + MTL (Y вверх) ---------- */
  function toOBJ(res, scale, base) {
    var mtl = '', obj = 'mtllib ' + base + '.mtl\n', seen = {}, o = 1;
    res.meshes.forEach(function (m) {
      if (!m.f.length) return;
      var mn = 'm_' + m.c.join('_');
      if (!seen[mn]) { seen[mn] = 1; mtl += 'newmtl ' + mn + '\nKd ' + m.c.map(function (x) { return (x / 255).toFixed(3); }).join(' ') + '\n\n'; }
      obj += 'o ' + m.name + '\nusemtl ' + mn + '\n';
      m.v.forEach(function (v) { obj += 'v ' + (v[0] * scale).toFixed(3) + ' ' + (v[2] * scale).toFixed(3) + ' ' + (-v[1] * scale).toFixed(3) + '\n'; });
      m.f.forEach(function (f) { obj += 'f ' + (f[0] + o) + ' ' + (f[1] + o) + ' ' + (f[2] + o) + '\n'; });
      o += m.v.length;
    });
    return { obj: obj, mtl: mtl };
  }

  root.ZG = { TYPES: TYPES, CATS: CATS, num: num, minOf: minOf, vals: vals, itemBox: itemBox, build: build, to3DS: to3DS, toOBJ: toOBJ };
  if (typeof module !== 'undefined') module.exports = root.ZG;
})(typeof window !== 'undefined' ? window : globalThis);
