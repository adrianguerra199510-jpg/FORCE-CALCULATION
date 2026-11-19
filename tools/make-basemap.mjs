// Genera src/data/basemap.json: contornos de Panamá y vecinos recortados al área de los mapas REP.
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';
const topo = JSON.parse(readFileSync(new URL('../node_modules/world-atlas/countries-10m.json', import.meta.url)));
const fc = feature(topo, topo.objects.countries);
const want = { Panama: 'PA', 'Costa Rica': 'CR', Colombia: 'CO' };
const bbox = [-83.4, 6.8, -76.9, 9.9];
const inBox = ([x, y]) => x >= bbox[0] - 0.5 && x <= bbox[2] + 0.5 && y >= bbox[1] - 0.5 && y <= bbox[3] + 0.5;
const out = [];
for (const f of fc.features) {
  const code = want[f.properties.name];
  if (!code) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    const ring = poly[0];
    if (!ring.some(inBox)) continue;
    out.push({ c: code, r: ring.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]) });
  }
}
writeFileSync(new URL('../src/data/basemap.json', import.meta.url), JSON.stringify({ bbox, polys: out }));
console.log(out.length, 'polígonos', out.reduce((s, p) => s + p.r.length, 0), 'vértices');
