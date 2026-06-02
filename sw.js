// Service Worker — siempre red, sin cache
// iOS Safari necesita esto para no mostrar pantalla negra al recargar

const CACHE_NAME = 'cantabria-v1';

self.addEventListener('install', e => {
  // Activar inmediatamente sin esperar
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // Borrar TODOS los caches anteriores
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Solo interceptar requests del mismo origen
  if (url.origin !== location.origin) return;

  // Estrategia: Network first, sin cache
  // Si la red falla, devolver página básica de error
  e.respondWith(
    fetch(e.request)
      .catch(() => {
        // Solo para navegación (no assets)
        if (e.request.mode === 'navigate') {
          return new Response(
            '<html><body style="background:#0f1923;color:white;font-family:sans-serif;padding:30px;text-align:center">' +
            '<h2>Sin conexión</h2><p>Comprueba tu conexión a internet y recarga.</p>' +
            '<button onclick="location.reload()" style="padding:12px 24px;background:#22b050;color:white;border:none;border-radius:10px;font-size:16px;cursor:pointer;margin-top:10px">Reintentar</button>' +
            '</body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        }
      })
  );
});
