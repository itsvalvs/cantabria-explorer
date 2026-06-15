// ═══════════════════════════════════════════════════════════
//  Service Worker — "Ya lo pisé" — MODO OFFLINE
//  · App shell (HTML, JS, librerías CDN): disponible sin red
//  · Mapa (TopoJSON de es-atlas): cacheado tras la 1ª carga
//  · Fotos de Supabase Storage: stale-while-revalidate, con la
//    URL firmada normalizada (sin query) como clave de caché
//  · API de Supabase (rest/auth/realtime): siempre red, sin caché
//
//  Para publicar una versión nueva: sube los archivos y cambia
//  el <meta name="app-version"> del index.html — el SW se
//  reinstala solo y limpia las cachés antiguas.
// ═══════════════════════════════════════════════════════════

const VERSION = 'ylp-v12';

const PRECACHE = [
  './',
  'index.html',
  'app.js',
  'manifest.json',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
  'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js',
  'https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js',
  'https://cdn.jsdelivr.net/npm/es-atlas@0.5.0/es/municipalities.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION).then(cache =>
      // allSettled: si un recurso falla, los demás se cachean igual
      Promise.allSettled(PRECACHE.map(u => cache.add(u)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Clave de caché sin query (las URLs firmadas cambian cada sesión)
function strippedKey(request) {
  const u = new URL(request.url);
  u.search = '';
  return u.toString();
}

// stale-while-revalidate con clave normalizada
async function swr(request, key) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(key);
  const network = fetch(request).then(res => {
    if (res && res.ok) cache.put(key, res.clone());
    return res;
  }).catch(() => null);
  return cached || network || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // API de Supabase: nunca cachear (datos vivos + auth)
  if (url.pathname.startsWith('/rest/v1') ||
      url.pathname.startsWith('/auth/v1') ||
      url.pathname.includes('/realtime')) return;

  // Imágenes de Storage (firmadas o públicas): SWR sin query
  if (url.pathname.includes('/storage/v1/object/')) {
    e.respondWith(swr(req, strippedKey(req)));
    return;
  }

  // Navegación: red primero, fallback al index cacheado (offline)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) caches.open(VERSION).then(c => c.put('index.html', res.clone()));
        return res;
      }).catch(() => caches.match('index.html'))
    );
    return;
  }

  // Mismo origen (app.js, index, manifest): RED PRIMERO, caché solo
  // si no hay conexión — así cada deploy llega al instante
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) caches.open(VERSION).then(c => c.put(strippedKey(req), res.clone()));
        return res;
      }).catch(() => caches.match(strippedKey(req)))
    );
    return;
  }
  // CDNs (librerías versionadas, topojson): caché primero
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(swr(req, strippedKey(req)));
    return;
  }

  // Resto (fuentes de Google, iconos...): cache-first oportunista
  e.respondWith(
    caches.match(req).then(c => c || fetch(req).then(res => {
      if (res && res.ok) caches.open(VERSION).then(cc => cc.put(req, res.clone()));
      return res;
    }).catch(() => c))
  );
});

// ═══ NOTIFICACIONES PUSH ═════════════════════════════════════
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch (_) { d = { title: 'Ya lo pisé', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Ya lo pisé', {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: d.url || './' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
      for (const w of ws) if ('focus' in w) return w.focus();
      return clients.openWindow((e.notification.data && e.notification.data.url) || './');
    })
  );
});
