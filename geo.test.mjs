import { test } from "node:test";
import assert from "node:assert/strict";
import { haversineKm, approxDriveMinutes, nearest } from "../lib/geo.mjs";

test("haversine: misma coordenada = 0 km", () => {
  assert.equal(haversineKm([-3.8, 43.46], [-3.8, 43.46]), 0);
});

test("haversine: Santander ↔ Torrelavega ≈ 24-30 km", () => {
  const d = haversineKm([-3.805, 43.462], [-4.046, 43.349]); // aprox
  assert.ok(d > 20 && d < 35, "distancia razonable, fue " + d);
});

test("minutos: nunca menos de 2", () => {
  assert.equal(approxDriveMinutes(0), 2);
  assert.ok(approxDriveMinutes(50) > 50); // 50km*1.3/50*60 = 78 min
});

test("nearest: ordena y recorta", () => {
  const from = [0, 0];
  const dst = [
    { nombre: "lejos", lnglat: [10, 10] },
    { nombre: "cerca", lnglat: [0.1, 0.1] },
    { nombre: "medio", lnglat: [1, 1] }
  ];
  const r = nearest(from, dst, 2);
  assert.equal(r.length, 2);
  assert.equal(r[0].nombre, "cerca");
  assert.equal(r[1].nombre, "medio");
});
