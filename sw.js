/* Кэш сайта ВЫКЛЮЧЕН (Макс тестирует как новый пользователь). Этот файл удаляет старый кэш и снимает себя.
   Включить обратно: скопировать tools/sw-cache.js в sw.js и вернуть регистрацию в <head> страниц (см. CLAUDE.md). */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })
    .then(function () { return self.registration.unregister(); })
    .then(function () { return self.clients.matchAll(); })
    .then(function (cs) { cs.forEach(function (c) { c.navigate(c.url); }); }));
});
