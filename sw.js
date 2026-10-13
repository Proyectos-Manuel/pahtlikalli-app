/* v2: se sube la versión de caché. El service worker usa estrategia
   cache-first, así que si el nombre de la caché no cambia, el navegador
   sigue sirviendo el app.js/index.html antiguos aunque se publique la v2.
   Al cambiar el nombre, el nuevo SW se instala, vuelve a descargar los
   assets y el handler de 'activate' borra la caché vieja. */
const CACHE = 'pahtlikalli-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './data/terrenos.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // no cachear externos
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => cached)
    )
  );
});