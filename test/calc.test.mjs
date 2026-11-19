import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/calc/seismic.mjs';
import * as W from '../src/calc/wind.mjs';
import { basicWindSpeed } from '../src/calc/rep.mjs';
import { compute, defaultProject, rayleighPeriod } from '../src/calc/typologies.mjs';

const near = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (tol ${tol})`);

test('Tabla 4.1 REP-2021: velocidades básicas', () => {
  near(basicWindSpeed('Pacifico', 50).kmh, 124.9);
  near(basicWindSpeed('Atlantico', 50).kmh, 150.8);
  near(basicWindSpeed('Atlantico', 100).kmh, 163.4);
  near(basicWindSpeed('Pacifico', 20).kmh, 113.0);
});

test('Coeficientes de sitio Fa/Fv (Tablas 11.4-1/2) con interpolación', () => {
  const a = S.siteCoefficients('D', 1.0, 0.4);
  near(a.Fa, 1.1);
  near(a.Fv, 1.6);
  near(S.siteCoefficients('D', 0.6, 0.1).Fa, 1.32);
  near(S.siteCoefficients('E', 2.0, 0.8).Fa, 0.9);
  near(S.siteCoefficients('C', 0.1, 0.05).Fv, 1.7);
  assert.throws(() => S.siteCoefficients('F', 1, 0.4));
});

test('Parámetros de diseño y categoría sísmica', () => {
  const p = S.designParameters({ Ss: 1.0, S1: 0.4, siteClass: 'D', occupancy: 'II' });
  near(p.SDS, 0.7333);
  near(p.SD1, 0.4267);
  assert.equal(p.sdc, 'D');
  assert.equal(p.TL, 10);
  const q = S.designParameters({ Ss: 0.2, S1: 0.06, siteClass: 'B', occupancy: 'II' });
  assert.equal(q.sdc, 'A');
  assert.equal(S.seismicDesignCategory(0.2, 0.1, 0.8, 'IV').sdc, 'F');
  assert.equal(S.seismicDesignCategory(0.2, 0.1, 0.3, 'IV').sdc, 'C');
});

test('Espectro de diseño §11.4.5', () => {
  const p = S.designParameters({ Ss: 1.0, S1: 0.4, siteClass: 'D', occupancy: 'II' });
  near(S.spectralAcceleration(0, p), 0.4 * p.SDS);
  near(S.spectralAcceleration(p.Ts, p), p.SDS);
  near(S.spectralAcceleration(2, p), p.SD1 / 2);
  near(S.spectralAcceleration(12, p), (p.SD1 * 10) / 144);
});

test('Cs con mínimo REP-2021 §5.2.1', () => {
  const p = S.designParameters({ Ss: 1.0, S1: 0.4, siteClass: 'D', occupancy: 'II' });
  const c = S.seismicCoefficient({ p, R: 8, T: 1.0 });
  near(c.Cs, 0.4267 / 8, 1e-4);
  near(c.csMinREP, 0.044 * 0.7333, 1e-4);
  // período largo: gobierna el mínimo REP
  const c2 = S.seismicCoefficient({ p, R: 8, T: 4.0 });
  near(c2.Cs, 0.044 * p.SDS, 1e-4);
  assert.match(c2.governs, /REP/);
  // no-edificio no similar: piso 0.03
  const q = S.designParameters({ Ss: 0.3, S1: 0.1, siteClass: 'B', occupancy: 'II' });
  const c3 = S.seismicCoefficient({ p: q, R: 3, T: 3, kind: 'nonbuildingNotSimilar' });
  near(c3.Cs, 0.03);
  // S1 ≥ 0.6
  const r = S.designParameters({ Ss: 1.5, S1: 0.7, siteClass: 'D', occupancy: 'II' });
  const c4 = S.seismicCoefficient({ p: r, R: 8, T: 3 });
  near(c4.csMinS1, (0.5 * 0.7) / 8);
});

test('Período aproximado y Cu', () => {
  near(S.approximatePeriod(20, 'concreteMRF').Ta, 0.0466 * Math.pow(20, 0.9));
  near(S.cuCoefficient(0.4267), 1.4);
  near(S.cuCoefficient(0.125), 1.65);
  near(S.kExponent(1.5), 1.5);
});

test('Distribución vertical suma V y momentos', () => {
  const levels = [1, 2, 3].map((i) => ({ name: 'N' + i, h: 3 * i, w: 100 }));
  const d = S.verticalDistribution(levels, 30, 0.4);
  near(d.levels.reduce((s, l) => s + l.F, 0), 30);
  near(d.levels[2].F, 15); // k=1: 300/600·30
  near(d.levels[0].Vstory, 30);
  near(d.Mbase, 5 * 3 + 10 * 6 + 15 * 9);
});

test('Kz (Tabla 6-3, Caso 2) y qz', () => {
  near(W.Kz(10, 'C'), 1.0, 0.005);
  near(W.Kz(3, 'B'), 0.575, 0.003);
  near(W.Kz(30.48, 'D'), 1.43, 0.01); // Tabla 6-3: 100 ft, exp. D
  const ctx = W.windContext({ region: 'Pacifico', returnPeriod: 50, exposure: 'C', occupancy: 'II', Kd: 0.85 });
  near(W.qz(10, ctx).q, (0.613 * W.Kz(10, 'C') * 0.85 * Math.pow(124.9 / 3.6, 2)) / 1000, 1e-6);
  near(W.qz(10, ctx).q, 0.627, 0.005);
});

test('Factor de ráfaga rígido (Ec. 6-4)', () => {
  const g = W.gustFactor({ exposure: 'C', h: 10, B: 10, L: 10, n1: 2, beta: 0.02, V: 35 });
  assert.equal(g.flexible, false);
  near(g.G, 0.883, 0.002);
  const g2 = W.gustFactor({ exposure: 'C', h: 120, B: 30, L: 30, n1: 0.3, beta: 0.02, V: 35 });
  assert.equal(g2.flexible, true);
  assert.ok(g2.G > 0.8 && g2.G < 1.5);
});

test('Factor topográfico Kzt', () => {
  const topo = { enabled: true, type: 'hill3D', H: 30, Lh: 100, x: 0 };
  // z=0, x=0: K1 = 1.05·0.3 = 0.315, K2=1, K3=1 → (1.315)²
  near(W.Kzt(0, 'C', topo), Math.pow(1.315, 2));
  near(W.Kzt(10, 'C', { enabled: false }), 1);
});

test('Coeficientes Cp Fig. 6-6 y Cf Fig. 6-21/6-23', () => {
  near(W.cpLeewardWall(1), -0.5);
  near(W.cpLeewardWall(3), -0.25);
  const r = W.cpRoofWindward(20, 0.5);
  near(r.A, -0.4);
  near(r.B, 0.0);
  const r2 = W.cpRoofWindward(30, 0.25);
  near(r2.A, -0.2);
  near(r2.B, 0.3);
  near(W.cpRoofLeeward(10, 0.5), -0.5);
  near(W.cpRoofLeeward(25, 1.0), -0.6);
  near(W.cfTrussTower('square', 0.2).Cf, 2.98);
  near(W.cfTrussTower('triangular', 0.2).Cf, 3.4 * 0.04 - 0.94 + 3.4);
  near(W.cfChimney('square', 7), 1.4);
  near(W.cfChimney('round', 25, 'moderadamente liso', 10), 0.7);
  near(W.cfChimney('round', 25, 'moderadamente liso', 2), 1.2);
});

test('Período de Rayleigh: voladizo con masa en el extremo', () => {
  const T = rayleighPeriod(10, [{ h: 10, w: 100 }], () => 1e6);
  const d = (100 * 1000) / 3e6;
  near(T, 2 * Math.PI * Math.sqrt(d / 9.81), 2e-3);
});

test('Cálculo completo de las cuatro tipologías', () => {
  for (const typ of ['edificio', 'nave', 'torre', 'tanque']) {
    const p = defaultProject();
    p.typology = typ;
    const r = compute(p);
    assert.equal(r.typology, typ);
    const V = r.seismic.directions.X.V;
    assert.ok(V > 0 && Number.isFinite(V), `${typ}: V sísmico`);
    if (typ === 'edificio') {
      assert.ok(r.wind.directions.X.Vbase > 0);
      const sumF = r.seismic.directions.X.levels.reduce((s, l) => s + l.F, 0);
      near(sumF, V, 1e-6);
    }
    if (typ === 'nave') assert.ok(r.wind.transversal.cases.length >= 5);
    if (typ === 'torre' || typ === 'tanque') assert.ok(r.wind.Vbase > 0);
  }
});
