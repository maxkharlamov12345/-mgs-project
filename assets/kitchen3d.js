/* MGS — 3D-кухня из списка модулей (пилот).
   Вход: стены {ox,oz,ang,len,n,mods:[{o,w,t}]} в метрах; t: door|drawers|bottle|filler|corner|blind|sink|hob|dw|fridge|oven.
   Локальные оси стены: x — вдоль стены, y — вверх, z — от стены в комнату. */
import * as THREE from 'three';
import { OrbitControls } from './three/OrbitControls.js';

const H = { plinth: .1, body: .72, top: .04, gap: .55, up: .72, upD: .32, tall: 2.13, wallH: 2.7, D: .6, ft: .018, gap2: .003 };
let renderer, scene, camera, controls, sun, root, host, labelsEl, ro, ready = false;
let showDims = true, need = true, home = null, labels = [], walls3 = [];
const geoCache = {};
const matCache = {};

function mat(color, r = .55, m = 0) {
  const k = color + r + m;
  if (!matCache[k]) matCache[k] = new THREE.MeshStandardMaterial({ color, roughness: r, metalness: m });
  return matCache[k];
}
function geo(w, h, d) {
  const k = w.toFixed(4) + '|' + h.toFixed(4) + '|' + d.toFixed(4);
  return geoCache[k] || (geoCache[k] = new THREE.BoxGeometry(w, h, d));
}
// коробка по нижнему-левому-заднему углу
function box(parent, x, y, z, w, h, d, material, shadow = true) {
  if (w <= 0 || h <= 0 || d <= 0) return null;
  const m = new THREE.Mesh(geo(w, h, d), material);
  m.position.set(x + w / 2, y + h / 2, z + d / 2);
  m.castShadow = shadow; m.receiveShadow = true;
  parent.add(m); return m;
}

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#d8d3cb');
  camera = new THREE.PerspectiveCamera(42, 1, .05, 60);

  scene.add(new THREE.HemisphereLight('#ffffff', '#a89c8c', 1.25));
  sun = new THREE.DirectionalLight('#fff4e6', 2.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: .5, far: 20 });
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#e9eef5', .6); fill.position.set(-4, 3, -2); scene.add(fill);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = .08;
  controls.maxPolarAngle = Math.PI * .495; controls.minDistance = 1.2; controls.maxDistance = 14;
  controls.addEventListener('change', () => { need = true; });

  labelsEl = document.createElement('div');
  labelsEl.className = 'k3d-labels';
  ro = new ResizeObserver(resize);
  ready = true;
  (function loop() { requestAnimationFrame(loop); if (!host) return; controls.update(); if (need) { hideWalls(); renderer.render(scene, camera); placeLabels(); need = false; } })();
}

function hideWalls() {
  for (const w of walls3) { _d.copy(camera.position).sub(w.p); w.mesh.visible = _d.dot(w.n) > -0.05; }
}
function resize() {
  if (!host) return;
  const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); need = true;
}

function mount(el) {
  if (!ready) init();
  if (host) ro.unobserve(host);
  host = el; el.appendChild(renderer.domElement); el.appendChild(labelsEl);
  ro.observe(el); resize();
}

/* ---------- фасады ---------- */
function front(g, x, y, w, h, z, L, kind = 'door') {
  const g2 = H.gap2, t = H.ft, fm = mat(kind === 'glass' ? '#1c1c1e' : L.front, kind === 'glass' ? .15 : L.rough, kind === 'glass' ? .4 : 0);
  const f = box(g, x + g2 / 2, y + g2 / 2, z, w - g2, h - g2, t, fm);
  if (kind === 'glass') { box(g, x + .02, y + h - .05, z + t, w - .04, .012, .006, mat('#888', .3, .9)); return f; }
  if (L.style === 'classic' && w > .2 && h > .14) {          // филёнка: рамка + углублённое поле
    const b = Math.min(.065, w * .18, h * .18);
    box(g, x + b, y + b, z + t, w - 2 * b, h - 2 * b, .004, mat(L.front, L.rough + .05));
    box(g, x + b - .008, y + b - .008, z + t, w - 2 * b + .016, .008, .006, mat(L.front, L.rough));
    box(g, x + b - .008, y + h - b, z + t, w - 2 * b + .016, .008, .006, mat(L.front, L.rough));
  }
  if (L.handles === 'bar') {
    const hm = mat(L.handleColor, .35, .8), len = Math.min(.32, w * .6);
    if (kind === 'drawer') box(g, x + (w - len) / 2, y + h - .06, z + t, len, .012, .025, hm);
    else if (kind === 'upper') box(g, x + (w - len) / 2, y + .04, z + t, len, .012, .025, hm);
    else if (kind === 'tall') box(g, x + w - .05, y + h / 2 - .2, z + t, .012, .4, .025, hm);
    else box(g, x + (w - len) / 2, y + h - .06, z + t, len, .012, .025, hm);
  }
  return f;
}
function doors(g, x, y, w, h, z, L, kind) {
  if (w >= .7) { front(g, x, y, w / 2, h, z, L, kind); front(g, x + w / 2, y, w / 2, h, z, L, kind); }
  else front(g, x, y, w, h, z, L, kind);
}

/* ---------- модули ---------- */
function lower(g, m, L, ovenUnder) {
  const { o: x, w, t } = m, D = H.D, y0 = H.plinth, hb = H.body, zf = D - H.ft;
  if (t === 'blind') return;
  box(g, x, 0, 0, w, H.plinth, D - .07, mat(L.plinth, .8));                       // цоколь
  box(g, x, y0, 0, w, hb, zf, mat(L.carcass, .7));                                // корпус
  box(g, x, y0 + hb, 0, w, H.top, D + .02, mat(L.top, L.topRough));                // столешница
  if (t === 'corner') return;
  if (t === 'drawers' || (t === 'hob' && !ovenUnder)) {
    let yy = y0;
    [.27, .27, hb - .54].forEach(hh => { front(g, x, yy, w, hh, zf, L, 'drawer'); yy += hh; });
  } else if (t === 'hob') {
    front(g, x, y0, w, .1, zf, L, 'drawer');
    front(g, x, y0 + .1, w, hb - .1, zf, L, 'glass');
  } else if (t === 'filler') {
    box(g, x, y0, zf, w, hb, H.ft, mat(L.front, L.rough));
  } else doors(g, x, y0, w, hb, zf, L, 'door');
  const ty = y0 + hb + H.top;
  if (t === 'sink') {
    const sw = Math.min(.5, w - .1);
    box(g, x + (w - sw) / 2, ty, .1, sw, .004, .4, mat('#9a9c9e', .25, .85), false);
    box(g, x + (w - sw) / 2 + .02, ty + .001, .12, sw - .04, .004, .36, mat('#5b5d60', .3, .8), false);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(.014, .018, .32, 16), mat('#b9bbbe', .2, .95));
    c.position.set(x + w / 2, ty + .16, .06); c.castShadow = true; g.add(c);
    const a = new THREE.Mesh(new THREE.CylinderGeometry(.011, .011, .2, 12), mat('#b9bbbe', .2, .95));
    a.rotation.x = Math.PI / 2; a.position.set(x + w / 2, ty + .31, .15); g.add(a);
  }
  if (t === 'hob') {
    box(g, x + (w - .58) / 2, ty, .05, .58, .006, .5, mat('#111214', .12, .3), false);
    [[.15, .15], [.43, .15], [.15, .37], [.43, .37]].forEach(([a, b]) => {
      const r = new THREE.Mesh(new THREE.RingGeometry(.06, .065, 32), mat('#55575a', .4));
      r.rotation.x = -Math.PI / 2; r.position.set(x + (w - .58) / 2 + a, ty + .0075, .05 + b); g.add(r);
    });
  }
}
function upper(g, m, L) {
  const { o: x, w, t } = m, y = H.plinth + H.body + H.top + H.gap, d = H.upD;
  if (t === 'blind' || t === 'fridge' || t === 'oven') return;
  box(g, x, y, 0, w, H.up, d - H.ft, mat(L.carcassUp, .7));
  if (t === 'corner') return;
  if (t === 'filler') { box(g, x, y, d - H.ft, w, H.up, H.ft, mat(L.frontUp, L.rough)); return; }
  const Lu = { ...L, front: L.frontUp };
  if (t === 'hob') { front(g, x, y + .06, w, H.up - .06, d - H.ft, Lu, 'upper'); box(g, x + .01, y, .02, w - .02, .05, d - .04, mat('#2a2b2d', .4, .5)); return; }
  doors(g, x, y, w, H.up, d - H.ft, Lu, 'upper');
}
function tall(g, m, L) {
  const { o: x, w, t } = m, y0 = H.plinth, top = H.tall, zf = H.D - H.ft;
  box(g, x, 0, 0, w, H.plinth, H.D - .07, mat(L.plinth, .8));
  box(g, x, y0, 0, w, top - y0, zf, mat(L.carcass, .7));
  if (t === 'fridge') { front(g, x, y0, w, 1.2, zf, L, 'tall'); front(g, x, y0 + 1.2, w, top - y0 - 1.2, zf, L, 'tall'); }
  else { front(g, x, y0, w, .7, zf, L, 'tall'); front(g, x, y0 + .7, w, .6, zf, L, 'glass'); front(g, x, y0 + 1.3, w, top - y0 - 1.3, zf, L, 'tall'); }
}

/* ---------- сцена ---------- */
function build(data, L) {
  if (!ready) init();
  if (root) { scene.remove(root); root.traverse(o => { if (o.geometry && !Object.values(geoCache).includes(o.geometry)) o.geometry.dispose(); }); }
  root = new THREE.Group(); scene.add(root);
  labelsEl.innerHTML = ''; labels = []; walls3 = [];
  const bb = new THREE.Box3(), nrm = new THREE.Vector3();
  data.walls.forEach(w => {
    const g = new THREE.Group(); g.position.set(w.ox, 0, w.oz); g.rotation.y = w.ang; root.add(g);
    // стена
    const wm = box(g, -.12, 0, -.1, w.len + .24, H.wallH, .1, mat(L.wall, .95), false);
    w.mods.forEach(m => { if (m.t === 'fridge' || m.t === 'oven') tall(g, m, L); else { lower(g, m, L, data.ovenUnder); upper(g, m, L); } });
    g.updateMatrixWorld(true);
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
    nrm.addScaledVector(n, w.len);
    walls3.push({ mesh: wm, n, p: g.localToWorld(new THREE.Vector3(w.len / 2, 0, 0)) });
    bb.expandByPoint(g.localToWorld(new THREE.Vector3(0, 0, 0))); bb.expandByPoint(g.localToWorld(new THREE.Vector3(w.len, 0, H.D)));
    // подписи
    w.mods.forEach(m => {
      if (m.t === 'blind' || m.t === 'corner' || m.w < .15) return;
      const tallM = m.t === 'fridge' || m.t === 'oven';
      addLabel(Math.round(m.w * 100) + '', g.localToWorld(new THREE.Vector3(m.o + m.w / 2, tallM ? 1.0 : H.plinth + H.body * .55, H.D + .03)), n, 'mod');
    });
    if (data.walls.length > 1 || true) addLabel((data.walls.length > 1 ? 'Стена ' + w.n + ' · ' : '') + Math.round(w.len * 100) + ' см', g.localToWorld(new THREE.Vector3(w.len / 2, H.tall + .25, .02)), n, 'wall');
  });
  // пол
  const size = new THREE.Vector3(); bb.getSize(size); const c = new THREE.Vector3(); bb.getCenter(c);
  const fw = Math.max(size.x, 2) + 3, fd = Math.max(size.z, 2) + 3;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), mat(L.floor, .85));
  floor.rotation.x = -Math.PI / 2; floor.position.set(c.x, 0, c.z); floor.receiveShadow = true; root.add(floor);
  // камера
  if (nrm.lengthSq() < 1e-6) nrm.set(0, 0, 1); nrm.y = 0; nrm.normalize();
  const span = Math.max(size.x, size.z, 2.4);
  const target = new THREE.Vector3(c.x, 1.05, c.z);
  const pos = target.clone().addScaledVector(nrm, span * 1.25 + 2.0); pos.y = 1.9;
  home = { pos, target };
  sun.position.copy(target).addScaledVector(nrm, 3).add(new THREE.Vector3(1.5, 4, 0)); sun.target.position.copy(target);
  if (!build.didFrame || data.reframe) { reset(); build.didFrame = true; }
  need = true;
}
function addLabel(text, pos, normal, cls) {
  const el = document.createElement('span'); el.className = 'k3d-l ' + cls; el.textContent = text; labelsEl.appendChild(el);
  labels.push({ el, pos, normal });
}
const _v = new THREE.Vector3(), _d = new THREE.Vector3();
function placeLabels() {
  if (!host) return; const w = host.clientWidth, h = host.clientHeight;
  labelsEl.style.display = showDims ? '' : 'none'; if (!showDims) return;
  for (const L of labels) {
    _d.copy(camera.position).sub(L.pos);
    const facing = _d.dot(L.normal) > 0.05;
    _v.copy(L.pos).project(camera);
    const vis = facing && _v.z < 1 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05;
    L.el.style.display = vis ? '' : 'none';
    if (vis) L.el.style.transform = `translate(-50%,-50%) translate(${((_v.x + 1) / 2 * w).toFixed(1)}px,${((1 - _v.y) / 2 * h).toFixed(1)}px)`;
  }
}
function reset() { if (!home) return; camera.position.copy(home.pos); controls.target.copy(home.target); controls.update(); need = true; }
function setDims(v) { showDims = v; need = true; }
function snapshot(maxW = 1024) {
  hideWalls(); renderer.render(scene, camera);
  const src = renderer.domElement, k = Math.min(1, maxW / src.width), c = document.createElement('canvas');
  c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', .92);
}
window.K3D = { mount, build, reset, setDims, snapshot };
window.dispatchEvent(new Event('k3d-ready'));
