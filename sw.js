// Service Worker — sin cache, siempre red
// Versión: 2026-06-05

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Responder a mensaje de actualización forzada
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  // Solo interceptar requests del mismo origen
  if (!e.request.url.startsWith(self.location.origin)) return;

  // NUNCA usar cache — siempre red directa
  e.respondWith(
    fetch(e.request).catch(() => {
      // Solo para navegación — página de error offline
      if (e.request.mode === 'navigate') {
        return new Response(
          '<html><meta name="viewport" content="width=device-width"><body style="background:#0f1923;color:white;font-family:sans-serif;padding:40px 20px;text-align:center">' +
          '<div style="font-size:40px;margin-bottom:16px">📡</div>' +
          '<h2 style="font-family:serif;margin-bottom:8px">Sin conexión</h2>' +
          '<p style="color:rgba(255,255,255,0.5);margin-bottom:24px">Comprueba tu conexión e inténtalo de nuevo</p>' +
          '<button onclick="location.reload()" style="padding:12px 28px;background:#22b050;color:white;border:none;border-radius:12px;font-size:16px;cursor:pointer">Reintentar</button>' +
          '</body></html>',
          { headers: { 'Content-Type': 'text/html' } }
        );
      }
    })
  );
});
