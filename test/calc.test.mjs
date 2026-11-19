import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/calc/seismic.js';
import * as W from '../src/calc/wind.js';
import { basicWindSpeed } from '../src/calc/rep.js';
import { compute, defaultProject, rayleighPeriod } from '../src/calc/typologies.js';

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

test('Fig. 6-20: Cf de anuncios sólidos (casos A/B y C) y Fig. 6-22', () => {
  near(W.cfSignAB(1.0, 1), 1.45);
  near(W.cfSignAB(0.16, 45), 1.95);
  near(W.cfSignAB(0.3, 3), 1.8);
  near(W.cfSignAB(0.4, 2), 1.75); // entre 0.3 (1.80) y 0.5 (1.70)
  const c4 = W.cfSignCaseC(12, 3); // B/s = 4
  assert.deepEqual(c4.map((r) => r.Cf), [2.9, 1.9, 1.3, 1.1]);
  near(c4[3].x1, 12);
  const c10 = W.cfSignCaseC(30, 3, 1); // B/s = 10, Lr/s = 1 → 0.75 sobre 3.75*
  near(c10[0].Cf, 3.75 * 0.75);
  near(W.openingsFactor(0.8), 1 - Math.pow(0.2, 1.5));
  near(W.cfOpenSign(0.2, 'plano'), 1.8);
  near(W.cfOpenSign(0.5, 'redondo', 3), 1.5);
});

test('Fp de componentes (§13.3.1) con límites', () => {
  const p = S.designParameters({ Ss: 1.0, S1: 0.4, siteClass: 'D', occupancy: 'II' });
  const c = S.componentForce({ p, ap: 2.5, Rp: 2.5, Ip: 1, Wp: 100, z: 12, h: 12 });
  near(c.Fp, 0.4 * 2.5 * p.SDS * 100 * 3 / 2.5);
  const c0 = S.componentForce({ p, ap: 1, Rp: 12, Ip: 1, Wp: 100, z: 0, h: 12 });
  near(c0.Fp, 0.3 * p.SDS * 100);
});

test('Valla publicitaria en terreno y en azotea', () => {
  const p = defaultProject();
  p.typology = 'valla';
  p.valla.B = 12; p.valla.s = 4; p.valla.clearance = 8;
  let r = compute(p);
  // qh a 12 m, G y Cf A/B (s/h = 1/3, B/s = 3)
  const ctx = W.windContext({ region: 'Pacifico', returnPeriod: 50, exposure: 'C', occupancy: 'II', Kd: 0.85 });
  const qh = W.qz(12, ctx).q;
  const A = r.wind.cases.find((c) => c.name === 'Caso A');
  near(A.F, qh * r.wind.G * W.cfSignAB(1 / 3, 3) * 48, 1e-6);
  assert.ok(r.wind.caseC, 'B/s ≥ 2 requiere caso C');
  near(r.wind.cases.find((c) => c.name === 'Caso B').MT, A.F * 0.2 * 12, 1e-6);
  assert.equal(r.seismic.directions.X.system.id, 'P2');
  assert.ok(r.seismic.directions.X.Cs >= 0.03 - 1e-12);
  // azotea de 4 niveles: 3.5 + 3·3.0 = 12.5 m
  p.valla.apoyo = 'azotea';
  p.valla.clearance = 2;
  r = compute(p);
  near(r.geometry.Hb, 12.5);
  near(r.wind.zt, 18.5);
  near(r.seismic.component.amp, 3);
  near(r.seismic.component.Fp, (0.4 * 2.5 * r.seismic.params.SDS * r.Wp * 3) / 2.5, 1e-6);
});

test('Perfil topográfico Fig. 6-4: H/2 a la distancia Lh de la cresta', () => {
  const ridge = { type: 'ridge2D', H: 30, Lh: 50 };
  near(W.terrainElevation(ridge, 0), 30);
  near(W.terrainElevation(ridge, -50), 15);
  near(W.terrainElevation(ridge, 100), 0);
  const esc = { type: 'escarp2D', H: 30, Lh: 50 };
  near(W.terrainElevation(esc, -50), 15);
  near(W.terrainElevation(esc, 200), 30); // meseta a sotavento
  const hill = { type: 'hill3D', H: 30, Lh: 50 };
  near(W.terrainElevation(hill, 30, 40), 15); // r = 50
});

test('Valla sin postes: rígida (§15.4.2) y sin viento en postes', () => {
  const p = defaultProject();
  p.typology = 'valla';
  p.valla.soporte = 'directa';
  p.valla.clearance = 0;
  const r = compute(p);
  const x = r.seismic.directions.X;
  near(x.Cs, 0.3 * r.seismic.params.SDS * r.seismic.params.I);
  assert.equal(r.wind.posts.F, 0);
  near(r.wind.sh, 1);
  // s/h = 1: resultante 0.05h sobre el centro geométrico
  near(r.wind.cases[0].z, p.valla.s / 2 + 0.05 * p.valla.s);
});

test('Volumen genérico: suma de franjas, columnas y elevación', () => {
  const p = defaultProject();
  p.typology = 'generico';
  p.generico.volumes = [{ name: 'Caja', shape: 'rect', bx: 6, by: 6, h: 4, z0: 3, x: 0, y: 0, tipo: 'solido', eps: 1, W: 200, nCols: 4, dCol: 0.4, wCol: 2 }];
  p.generico.slices = 4;
  const r = compute(p);
  const d = r.wind.directions.X;
  assert.equal(d.rows.length, 4);
  near(d.rows[0].z0, 3);
  near(d.rows[3].z1, 7);
  near(d.rows.reduce((s, x) => s + x.Af, 0), 24);
  near(d.rows[0].Cf, W.cfChimney('square', 1)); // h/D = 4/6 → 1
  assert.equal(d.cols.length, 1);
  near(d.cols[0].Af, 4 * 0.4 * 3);
  // peso total = volumen + columnas
  near(r.seismic.directions.X.W, 200 + 4 * 2 * 3);
  near(r.H, 7);
});

test('Tanque sin patas: ninguna carga de patas; tanque cuadrado', () => {
  const p = defaultProject();
  p.typology = 'tanque';
  p.tanque.support = 'apoyado';
  p.tanque.Hs = 0;
  let r = compute(p);
  assert.equal(r.wind.parts.length, 1);
  assert.equal(r.seismic.directions.X.levels.length, 1);
  assert.ok(!r.wind.parts.some((x) => /pata/i.test(x.name)));
  assert.equal(r.seismic.directions.X.system.id.startsWith('G'), true);
  // patas con n = 0 → apoyado, sin cargas de patas
  p.tanque.support = 'patas';
  p.tanque.nLegs = 0;
  p.tanque.Hs = 12;
  r = compute(p);
  assert.equal(r.geometry.support, 'apoyado');
  assert.equal(r.wind.parts.length, 1);
  // cuadrado: volumen de agua a²·Hw y Cf de sección cuadrada
  p.tanque.support = 'patas';
  p.tanque.nLegs = 4;
  p.tanque.shape = 'rect';
  r = compute(p);
  near(r.Ww, 9.81 * p.tanque.D * p.tanque.D * p.tanque.Hw);
  near(r.wind.parts[0].Cf, W.cfChimney('square', Math.max(1, p.tanque.Ht / p.tanque.D)));
});

test('Techos de volúmenes: geometría, áreas proyectadas y Cp de domo', async () => {
  const { roofGeometry, roofProjectedArea } = await import('../src/calc/typologies.js');
  const v = { shape: 'rect', bx: 12, by: 8, h: 6, z0: 0, roof: 'dos', roofAngle: 45, roofDir: 'X' };
  const rg = roofGeometry(v);
  near(rg.rise, 4); // (8/2)·tan45
  near(rg.hMean, 8);
  near(roofProjectedArea(v, rg, 'X'), 0.5 * 8 * 4); // hastial triangular
  near(roofProjectedArea(v, rg, 'Y'), 12 * 4);
  const hip = roofGeometry({ ...v, roof: 'cuatro' });
  near(hip.ridgeLen, 4);
  near(roofProjectedArea({ ...v, roof: 'cuatro' }, hip, 'Y'), 0.5 * (12 + 4) * 4);
  const dome = roofGeometry({ shape: 'cyl', bx: 10, h: 5, z0: 0, roof: 'domo', domeRise: 2 });
  near(dome.top, 7);
  const c = W.cpDome(5, 2.5, 10); // hD/D = 0.5, f/D = 0.25
  near(c.B, -1.2);
  near(c.C, -0.5);
  near(W.cpDome(0, 5, 10).A, 0.8);
});
