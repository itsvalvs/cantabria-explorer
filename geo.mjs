// Geometría pura para "cerca de ti". Sin DOM, sin red → fácil de testear.
// (Extraído de app.js: _haversineKm y el cálculo de tiempo aproximado.)

/** Distancia en km entre [lng,lat] y [lng,lat] (fórmula del haversine). */
export function haversineKm(a, b) {
  const R = 6371, toR = d => d * Math.PI / 180;
  const dLat = toR(b[1] - a[1]), dLng = toR(b[0] - a[0]);
  const la1 = toR(a[1]), la2 = toR(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Minutos aprox. en coche para una distancia en línea recta (factor carretera 1.3, 50 km/h). */
export function approxDriveMinutes(km) {
  return Math.max(2, Math.round(km * 1.3 / 50 * 60));
}

/** Ordena destinos {nombre,lnglat} por cercanía a `from` y devuelve los `limit` más próximos. */
export function nearest(from, destinos, limit = 6) {
  return destinos
    .map(d => { const km = haversineKm(from, d.lnglat); return { nombre: d.nombre, km, min: approxDriveMinutes(km) }; })
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

// Para usar sin build: expón en global y carga este archivo como <script type="module"> antes de app.js
if (typeof window !== "undefined") {
  window.haversineKm = haversineKm;
  window.approxDriveMinutes = approxDriveMinutes;
}
