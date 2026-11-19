import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lookup, sheetsAt, pixelToLonLat } from '../src/calc/maplookup.mjs';

const grid = JSON.parse(readFileSync(new URL('../src/data/rep-maps/grid.json', import.meta.url)));

test('Ciudad de Panamá (verificado visualmente en hojas Ss-14 y S1-14)', () => {
  const r = lookup(grid, -79.535, 8.952);
  assert.equal(r.status, 'ok');
  assert.ok(r.Ss > 1.2 && r.Ss < 1.32, 'Ss ' + r.Ss);
  assert.ok(r.S1 > 0.41 && r.S1 < 0.45, 'S1 ' + r.S1);
  const sh = sheetsAt(grid, -79.535, 8.952);
  assert.deepEqual(sh.map((s) => s.sheet), [14]);
});

test('David (Chiriquí) queda fuera de la cobertura de los mapas REP-2014', () => {
  const r = lookup(grid, -82.43, 8.43);
  assert.equal(r.status, 'fuera');
});

test('pixelToLonLat es la inversa de sheetsAt', () => {
  const [s] = sheetsAt(grid, -80.0, 8.5);
  const p = pixelToLonLat(grid, s.sheet, s.x, s.y);
  assert.ok(Math.abs(p.lon + 80.0) < 1e-6 && Math.abs(p.lat - 8.5) < 1e-6);
});
