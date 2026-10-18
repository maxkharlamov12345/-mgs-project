/* MGS Mebel — кэш сайта в браузере (service worker).
   GitHub Pages разрешает браузеру хранить файлы всего 10 минут, потом каждое фото переспрашивается у сервера.
   Здесь:
   - фото, превью и шрифты (webp/jpg/woff2) — сразу из кэша, а в фоне тихо проверяем, не обновились ли;
   - страницы и support.js — сначала из сети (чтобы правки были видны сразу), если сеть не ответила за 3 с — из кэша;
   - видео (mp4) не трогаем: браузер грузит их кусками, это он делает сам.
   После крупных изменений в логике кэша — поднять VERSION. */
var VERSION = 'mgs-v1';
var ASSETS = VERSION + '-assets', PAGES = VERSION + '-pages';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf(VERSION) !== 0; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function fromNetwork(req, cacheName) {
  return fetch(req).then(function (res) {
    if (res && res.ok && res.type === 'basic') { var copy = res.clone(); caches.open(cacheName).then(function (c) { c.put(req, copy); }); }
    return res;
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var path = url.pathname;
  if (/\.mp4$/i.test(path)) return;

  if (/\.(webp|jpe?g|png|woff2)$/i.test(path)) {
    // сразу из кэша; в фоне — обновление
    e.respondWith(caches.open(ASSETS).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fromNetwork(req, ASSETS);
        if (hit) { e.waitUntil(net.catch(function () {})); return hit; }
        return net;
      });
    }));
    return;
  }

  if (req.mode === 'navigate' || /\.(html|js|css)$/i.test(path) || path.slice(-1) === '/') {
    // сначала сеть (правки видны сразу); нет сети или она молчит 3 с — отдаём сохранённое
    e.respondWith(new Promise(function (resolve) {
      var done = false, net = fromNetwork(req, PAGES);
      var fallback = function () {
        caches.match(req, { ignoreSearch: true }).then(function (hit) { if (done) return; if (hit) { done = true; resolve(hit); } });
      };
      var t = setTimeout(fallback, 3000);
      net.then(function (res) { clearTimeout(t); if (!done) { done = true; resolve(res); } })
        .catch(function () {
          clearTimeout(t);
          caches.match(req, { ignoreSearch: true }).then(function (hit) { if (!done) { done = true; resolve(hit || Response.error()); } });
        });
    }));
  }
});
