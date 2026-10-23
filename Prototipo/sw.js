/* El prototipo anterior registraba un service worker que guardaba la app en caché.
   Este reemplazo borra ese caché y se da de baja, para que el navegador cargue la versión nueva. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll())
      .then((clients) => clients.forEach((c) => c.navigate(c.url))),
  )
})
