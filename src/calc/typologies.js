// Aplicación de viento y sismo por tipología estructural.
import * as W from './wind.js';
import * as S from './seismic.js';
import { REP } from './rep.js';
import { findSystem, systemWarnings } from './systems.js';

const G_ACC = 9.81;
const GAMMA_W = 9.81; // kN/m³

export const TYPOLOGIES = {
  edificio: 'Edificio de varios niveles (pórticos / muros)',
  nave: 'Nave industrial con techo a dos aguas',
  torre: 'Torre de celosía / chimenea / poste',
  tanque: 'Tanque elevado',
  valla: 'Valla publicitaria (en terreno o sobre edificación)',
};

function sum(a, f = (x) => x) {
  return a.reduce((s, x) => s + f(x), 0);
}

/** Deflexión de un voladizo con EI(z) variable bajo cargas puntuales (método numérico). */
export function cantileverDeflections(H, loads, EI, n = 400) {
  const dz = H / n;
  const zs = Array.from({ length: n + 1 }, (_, i) => i * dz);
  const M = zs.map((z) => sum(loads.filter((p) => p.z > z), (p) => p.P * (p.z - z)));
  const kappa = zs.map((z, i) => M[i] / EI(z));
  const theta = [0];
  const defl = [0];
  for (let i = 1; i <= n; i++) {
    theta[i] = theta[i - 1] + 0.5 * (kappa[i] + kappa[i - 1]) * dz;
    defl[i] = defl[i - 1] + 0.5 * (theta[i] + theta[i - 1]) * dz;
  }
  return (z) => {
    const i = Math.min(n - 1, Math.floor(z / dz));
    const t = (z - zs[i]) / dz;
    return defl[i] + t * (defl[i + 1] - defl[i]);
  };
}

/** Período por Rayleigh (masas puntuales w_i a alturas z_i, voladizo con EI(z)). */
export function rayleighPeriod(H, levels, EI) {
  const loads = levels.map((l) => ({ z: l.h, P: l.w }));
  const d = cantileverDeflections(H, loads, EI);
  const dl = levels.map((l) => d(l.h));
  const num = sum(levels.map((l, i) => l.w * dl[i] * dl[i]));
  const den = sum(levels.map((l, i) => l.w * dl[i]));
  return 2 * Math.PI * Math.sqrt(num / (G_ACC * den));
}

function seismicCommon(project) {
  const s = project.site;
  const p = S.designParameters({ Ss: +s.Ss, S1: +s.S1, siteClass: s.siteClass, occupancy: s.occupancy });
  return p;
}

function windCtx(project, Kd) {
  const w = project.wind;
  return W.windContext({
    region: w.region,
    returnPeriod: +w.returnPeriod,
    Voverride: +w.Voverride || null,
    exposure: w.exposure,
    occupancy: project.site.occupancy,
    Kd,
    topo: w.topo,
  });
}

function stdWarnings(p, project) {
  const w = [];
  if (p.sdc === 'E' || p.sdc === 'F') w.push(`Categoría de Diseño Sísmico ${p.sdc}: revisar limitaciones de altura e irregularidades (ASCE 7-05 §12.2.5, §12.3.3).`);
  if (project.site.mapDistKm > 30) w.push('El punto está fuera de la cobertura de los mapas REP-2014 digitalizados; Ss y S1 deben verificarse con los mapas oficiales del REP-2021 (JTIA).');
  else if (project.site.mapDistKm > 15) w.push(`Ss/S1 interpolados a ${project.site.mapDistKm} km de la etiqueta de contorno más cercana: verificar en la hoja del mapa.`);
  return w;
}

// =============================================================================
// EDIFICIO
// =============================================================================
export function computeEdificio(project) {
  const e = project.edificio;
  const n = Math.max(1, Math.round(+e.nStories));
  const heights = [];
  let z = 0;
  for (let i = 0; i < n; i++) {
    z += i === 0 ? +e.firstStoryHeight : +e.storyHeight;
    heights.push(z);
  }
  const H = heights[n - 1];
  const A = +e.Bx * +e.By;
  const levels = heights.map((h, i) => ({
    name: i === n - 1 ? 'Azotea' : `Nivel ${i + 1}`,
    h,
    w: (i === n - 1 ? +e.wRoof : +e.wFloor) * A,
  }));

  const p = seismicCommon(project);
  const warnings = stdWarnings(p, project);
  const seismic = { params: p, directions: {} };
  for (const dir of ['X', 'Y']) {
    const sys = findSystem(dir === 'X' ? e.systemX : e.systemY);
    const r = S.equivalentLateralForce({
      p, system: sys, hn: H, periodType: sys.periodType,
      Tuser: +(dir === 'X' ? e.Tx : e.Ty) || null, levels, kind: 'building',
    });
    seismic.directions[dir] = r;
    warnings.push(...systemWarnings(sys, p.sdc));
  }

  const ctx = windCtx(project, W.KD.building);
  const gcpi = W.GCPI[project.wind.enclosure];
  const wind = { ctx, directions: {}, gcpi };
  for (const dir of ['X', 'Y']) {
    // viento soplando en dirección X: ancho expuesto B = By, profundidad L = Bx
    const B = dir === 'X' ? +e.By : +e.Bx;
    const L = dir === 'X' ? +e.Bx : +e.By;
    const T = seismic.directions[dir].T;
    const n1 = +(dir === 'X' ? e.n1x : e.n1y) || 1 / T;
    const gust = W.gustFactor({
      exposure: ctx.exposure, h: H, B, L, n1, beta: +project.wind.beta || REP.WIND_SERVICE_DAMPING,
      V: ctx.V, rigidMode: project.wind.rigidMode,
    });
    const G = gust.G;
    const qh = W.qz(H, ctx);
    const cpLw = W.cpLeewardWall(L / B);
    const bands = heights.map((h, i) => {
      const z0 = i === 0 ? (0 + h) / 2 : (heights[i - 1] + h) / 2;
      const z1 = i === n - 1 ? H : (h + heights[i + 1]) / 2;
      return [z0, z1];
    });
    const rows = levels.map((l, i) => {
      const [z0, z1] = bands[i];
      const qzl = W.qz(l.h, ctx);
      const Fww = G * W.CP_WINDWARD_WALL * B * W.integrateQ(z0, z1, ctx);
      const Flw = G * Math.abs(cpLw) * qh.q * B * (z1 - z0);
      return {
        name: l.name, h: l.h, z0, z1, Kz: qzl.Kz, Kzt: qzl.Kzt, qz: qzl.q,
        pww: qzl.q * G * W.CP_WINDWARD_WALL, plw: qh.q * G * cpLw,
        Fww, Flw, F: Fww + Flw,
      };
    });
    // franja inferior (0 a la mitad del primer piso) va directo a la base
    const Fbase = G * W.CP_WINDWARD_WALL * B * W.integrateQ(0, bands[0][0], ctx) + G * Math.abs(cpLw) * qh.q * B * bands[0][0];
    let Vacc = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      Vacc += rows[i].F;
      rows[i].Vstory = Vacc;
    }
    const Vbase = Vacc + Fbase;
    const Mbase = sum(rows, (r) => r.F * r.h) + Fbase * bands[0][0] / 2;
    const Vmin = W.MIN_WIND_PRESSURE * B * H;
    if (Vbase < Vmin) warnings.push(`Viento ${dir}: el cortante basal (${Vbase.toFixed(1)} kN) es menor que la carga mínima de 0.48 kPa·B·H = ${Vmin.toFixed(1)} kN (§6.1.4.1). Usar la carga mínima.`);
    // Caso de carga 2 (Fig. 6-9): 75% con excentricidad 0.15B
    const torsion = rows.map((r) => ({ name: r.name, MT: 0.75 * r.F * 0.15 * B }));
    const roofZones = W.cpRoofZones(H, H / L, L).map((zn) => ({
      ...zn,
      pA: qh.q * G * zn.A, pB: qh.q * G * zn.B,
      netUplift: qh.q * G * zn.A - qh.q * gcpi,
    }));
    wind.directions[dir] = {
      B, L, H, n1, gust, G, qh: qh.q, Kzh: qh.Kz, cpLw, rows, Fbase, Vbase, Mbase, Vmin, torsion, roofZones,
      pSide: qh.q * G * W.CP_SIDE_WALL,
    };
  }
  return {
    typology: 'edificio', H, A, levels, wind, seismic, warnings,
    combos: S.loadCombinations(p.SDS),
    geometry: { Bx: +e.Bx, By: +e.By, heights, nx: +e.nx || 3, ny: +e.ny || 3 },
  };
}

// =============================================================================
// NAVE INDUSTRIAL A DOS AGUAS
// =============================================================================
export function computeNave(project) {
  const nv = project.nave;
  const S_ = +nv.span; // luz (perpendicular a la cumbrera)
  const Lg = +nv.length; // longitud (paralela a la cumbrera)
  const he = +nv.eaveHeight;
  const theta = +nv.roofSlope;
  const hr = he + (S_ / 2) * Math.tan((theta * Math.PI) / 180);
  const h = theta <= 10 ? he : (he + hr) / 2;
  const s = +nv.frameSpacing;
  const nFrames = Math.round(Lg / s) + 1;

  const p = seismicCommon(project);
  const warnings = stdWarnings(p, project);
  const sys = findSystem(nv.system);
  warnings.push(...systemWarnings(sys, p.sdc));
  const Wroof = +nv.wRoof * S_ * Lg;
  const Wtot = Wroof + +nv.wWalls;
  const levels = [{ name: 'Techo', h, w: Wtot }];
  const seismic = { params: p, directions: {} };
  for (const dir of ['X', 'Y']) {
    const r = S.equivalentLateralForce({ p, system: sys, hn: h, periodType: sys.periodType, Tuser: +nv.T || null, levels, kind: 'building' });
    seismic.directions[dir] = r;
  }
  seismic.perFrame = seismic.directions.X.V * (s / Lg);

  const ctx = windCtx(project, W.KD.building);
  const gcpi = W.GCPI[project.wind.enclosure];
  const qh = W.qz(h, ctx);
  const qe = W.qz(he, ctx);
  const n1 = +nv.n1 || 1 / seismic.directions.X.T;
  const wind = { ctx, gcpi, qh: qh.q, qe: qe.q, Kzh: qh.Kz, h, hr };

  // --- Viento transversal (normal a la cumbrera) ---
  {
    const B = Lg;
    const L = S_;
    const gust = W.gustFactor({ exposure: ctx.exposure, h, B, L, n1, beta: +project.wind.beta || 0.02, V: ctx.V, rigidMode: project.wind.rigidMode });
    const G = gust.G;
    const cpLw = W.cpLeewardWall(L / B);
    let roof;
    if (theta >= 10) {
      const ww = W.cpRoofWindward(theta, h / L);
      const lw = W.cpRoofLeeward(theta, h / L);
      roof = { type: 'pendiente', ww, lw };
    } else {
      roof = { type: 'zonas', zones: W.cpRoofZones(h, h / L, L) };
    }
    const surfaces = [
      { name: 'Muro barlovento', Cp: [W.CP_WINDWARD_WALL], q: qe.q },
      { name: 'Muro sotavento', Cp: [cpLw], q: qh.q },
      { name: 'Muros laterales (frontones)', Cp: [W.CP_SIDE_WALL], q: qh.q },
    ];
    if (roof.type === 'pendiente') {
      surfaces.push({ name: 'Techo barlovento', Cp: [roof.ww.A, roof.ww.B], q: qh.q });
      surfaces.push({ name: 'Techo sotavento', Cp: [roof.lw], q: qh.q });
    } else {
      for (const z of roof.zones) surfaces.push({ name: `Techo ${z.x0.toFixed(1)}–${z.x1.toFixed(1)} m`, Cp: [z.A, z.B], q: qh.q, x0: z.x0, x1: z.x1 });
    }
    const cases = buildNaveCases(surfaces, G, gcpi, qh.q, s);
    wind.transversal = { B, L, gust, G, cpLw, roof, surfaces, cases };
  }
  // --- Viento longitudinal (paralelo a la cumbrera) ---
  {
    const B = S_;
    const L = Lg;
    const gust = W.gustFactor({ exposure: ctx.exposure, h, B, L, n1, beta: +project.wind.beta || 0.02, V: ctx.V, rigidMode: project.wind.rigidMode });
    const G = gust.G;
    const cpLw = W.cpLeewardWall(L / B);
    const zones = W.cpRoofZones(h, h / L, L);
    const surfaces = [
      { name: 'Frontón barlovento', Cp: [W.CP_WINDWARD_WALL], q: qe.q },
      { name: 'Frontón sotavento', Cp: [cpLw], q: qh.q },
      { name: 'Muros laterales largos', Cp: [W.CP_SIDE_WALL], q: qh.q },
      ...zones.map((z) => ({ name: `Techo ${z.x0.toFixed(1)}–${z.x1.toFixed(1)} m`, Cp: [z.A, z.B], q: qh.q, x0: z.x0, x1: z.x1 })),
    ];
    const cases = buildNaveCases(surfaces, G, gcpi, qh.q, s);
    wind.longitudinal = { B, L, gust, G, cpLw, zones, surfaces, cases };
  }
  const Vmin = W.MIN_WIND_PRESSURE * Lg * hr;
  return {
    typology: 'nave', h, hr, he, theta, nFrames, levels, wind, seismic, warnings, Vmin,
    combos: S.loadCombinations(p.SDS),
    geometry: { span: S_, length: Lg, he, hr, s, nFrames },
  };
}

function buildNaveCases(surfaces, G, gcpi, qh, s) {
  // Para cada superficie y cada Cp, presión neta con ±GCpi.
  const rows = [];
  for (const sf of surfaces) {
    sf.Cp.forEach((cp, k) => {
      const pe = sf.q * G * cp;
      const pPos = pe - qh * gcpi; // presión interna positiva
      const pNeg = pe + qh * gcpi; // presión interna negativa (succión)
      rows.push({
        surface: sf.name, caseCp: sf.Cp.length > 1 ? (k === 0 ? 'A' : 'B') : '', Cp: cp, q: sf.q,
        pe, pPos, pNeg, wPos: pPos * s, wNeg: pNeg * s, x0: sf.x0, x1: sf.x1,
      });
    });
  }
  return rows;
}

// =============================================================================
// TORRE / CHIMENEA / POSTE
// =============================================================================
export function computeTorre(project) {
  const t = project.torre;
  const H = +t.H;
  const nSeg = Math.max(2, Math.round(+t.nSeg || 10));
  const dz = H / nSeg;
  const width = (z) => +t.bBase + ((+t.bTop - +t.bBase) * z) / H;
  const epsAt = (z) => +t.epsBase + ((+t.epsTop - +t.epsBase) * z) / H;
  const wLin = (z) => +t.wBase + ((+t.wTop - +t.wBase) * z) / H;
  const lattice = t.kind === 'celosia';

  // Niveles sísmicos (centro de cada segmento) + accesorios
  const levels = [];
  for (let i = 0; i < nSeg; i++) {
    const zc = (i + 0.5) * dz;
    levels.push({ name: `Seg ${i + 1}`, h: zc, w: wLin(zc) * dz });
  }
  for (const a of t.appurtenances || []) {
    if (+a.w > 0) levels.push({ name: a.name || 'Accesorio', h: +a.z, w: +a.w });
  }
  levels.sort((a, b) => a.h - b.h);

  let T;
  let Tmethod;
  if (t.periodMethod === 'rayleigh') {
    const EI = (z) => +t.EIbase + ((+t.EItop - +t.EIbase) * z) / H;
    T = rayleighPeriod(H, levels, EI);
    Tmethod = 'Rayleigh (voladizo, EI variable lineal)';
  } else {
    T = +t.T;
    Tmethod = 'Período ingresado por el usuario';
  }

  const p = seismicCommon(project);
  const warnings = stdWarnings(p, project);
  const sys = findSystem(t.system);
  const r = S.equivalentLateralForce({ p, system: sys, hn: H, Tuser: T, levels, kind: 'nonbuildingNotSimilar' });
  r.Tsource = Tmethod;
  const seismic = { params: p, directions: { X: r } };

  // Viento
  let Kd;
  if (lattice) Kd = W.KD.trussTower;
  else Kd = t.shape === 'square' ? W.KD.chimneySquare : W.KD.chimneyRound;
  const ctx = windCtx(project, Kd);
  const bAvg = (+t.bBase + +t.bTop) / 2;
  const n1 = 1 / T;
  const gust = W.gustFactor({ exposure: ctx.exposure, h: H, B: bAvg, L: bAvg, n1, beta: +project.wind.beta || 0.02, V: ctx.V, rigidMode: project.wind.rigidMode });
  const G = gust.G;
  const segs = [];
  for (let i = 0; i < nSeg; i++) {
    const z0 = i * dz;
    const z1 = (i + 1) * dz;
    const zc = (z0 + z1) / 2;
    const b = width(zc);
    const qavg = W.integrateQ(z0, z1, ctx) / dz;
    const qq = W.qz(zc, ctx);
    let Cf;
    let Af;
    let extra = {};
    if (lattice) {
      const eps = epsAt(zc);
      const c = W.cfTrussTower(t.section, eps, !!t.roundMembers, !!t.diagonal);
      Cf = c.Cf * c.fDiag;
      Af = eps * b * dz;
      extra = { eps, fRound: c.fRound, fDiag: c.fDiag };
    } else {
      const Dsq = b * Math.sqrt(qavg * 1000);
      const shape = t.shape === 'square' ? 'square' : t.shape === 'hex' ? 'hex' : 'round';
      Cf = W.cfChimney(shape, H / bAvg, t.surface, Dsq);
      Af = b * dz;
      extra = { Dsqrtq: Dsq };
    }
    const F = qavg * G * Cf * Af;
    segs.push({ name: `Seg ${i + 1}`, z0, z1, zc, b, Kz: qq.Kz, Kzt: qq.Kzt, qz: qavg, Cf, Af, F, ...extra });
  }
  const appForces = (t.appurtenances || []).filter((a) => +a.epa > 0).map((a) => {
    const qq = W.qz(+a.z, ctx);
    return { name: a.name || 'Accesorio', z: +a.z, qz: qq.q, EPA: +a.epa, F: qq.q * G * +a.epa };
  });
  const Vbase = sum(segs, (s) => s.F) + sum(appForces, (a) => a.F);
  const Mbase = sum(segs, (s) => s.F * s.zc) + sum(appForces, (a) => a.F * a.z);
  // cortante por segmento (de arriba hacia abajo)
  for (let i = segs.length - 1; i >= 0; i--) {
    const above = sum(segs.slice(i), (s) => s.F) + sum(appForces.filter((a) => a.z >= segs[i].z0), (a) => a.F);
    segs[i].Vstory = above;
  }
  const wind = { ctx, gust, G, n1, segs, appForces, Vbase, Mbase, H };
  return {
    typology: 'torre', H, levels, wind, seismic, warnings, T,
    combos: S.loadCombinations(p.SDS),
    geometry: { H, bBase: +t.bBase, bTop: +t.bTop, kind: t.kind, section: t.section, shape: t.shape, nSeg, appurtenances: t.appurtenances || [] },
  };
}

// =============================================================================
// TANQUE ELEVADO
// =============================================================================
export function computeTanque(project) {
  const k = project.tanque;
  const D = +k.D;
  const Ht = +k.Ht;
  const Hw = Math.min(+k.Hw, Ht);
  const Hs = +k.Hs;
  const Htot = Hs + Ht;
  const Ww = GAMMA_W * (Math.PI * D * D / 4) * Hw;
  const Wshell = +k.Wshell;
  const Wsup = +k.Wsupport;
  const Wtop = Wshell + Ww;
  const zTop = Hs + (Wshell * (Ht / 2) + Ww * (Hw / 2)) / Math.max(Wtop, 1e-9);
  const levels = [
    { name: 'Estructura de soporte', h: Hs / 2, w: Wsup },
    { name: 'Tanque + agua', h: zTop, w: Wtop },
  ];
  let T;
  let Tmethod;
  if (k.periodMethod === 'rigidez') {
    T = 2 * Math.PI * Math.sqrt((Wtop + 0.33 * Wsup) / (G_ACC * +k.K));
    Tmethod = 'T = 2π·√[(Wtanque + 0.33·Wsoporte)/(g·K)]';
  } else {
    T = +k.T;
    Tmethod = 'Período ingresado por el usuario';
  }
  const p = seismicCommon(project);
  const warnings = stdWarnings(p, project);
  const sys = findSystem(k.system);
  const r = S.equivalentLateralForce({ p, system: sys, hn: Htot, Tuser: T, levels, kind: 'nonbuildingNotSimilar' });
  r.Tsource = Tmethod;
  const seismic = { params: p, directions: { X: r } };
  warnings.push('No se incluye el componente convectivo (oleaje) del líquido; verificar según ASCE 7-05 §15.7.6 si aplica.');

  const ctx = windCtx(project, W.KD.chimneyRound);
  const gust = W.gustFactor({ exposure: ctx.exposure, h: Htot, B: D, L: D, n1: 1 / T, beta: +project.wind.beta || 0.02, V: ctx.V, rigidMode: project.wind.rigidMode });
  const G = gust.G;
  const qv = W.integrateQ(Hs, Htot, ctx) / Ht;
  const cfV = W.cfChimney('round', Math.max(1, Ht / D), k.surface || 'moderadamente liso', D * Math.sqrt(qv * 1000));
  const Fv = qv * G * cfV * D * Ht;
  const zv = Hs + Ht / 2;
  let supp;
  if (k.support === 'pedestal') {
    const Dp = +k.Dped;
    const qs = W.integrateQ(0, Hs, ctx) / Hs;
    const cf = W.cfChimney('round', Hs / Dp, 'moderadamente liso', Dp * Math.sqrt(qs * 1000));
    supp = { name: 'Pedestal', q: qs, Cf: cf, Af: Dp * Hs, F: qs * G * cf * Dp * Hs, z: Hs / 2 };
  } else {
    const dl = +k.dLeg;
    const nL = Math.round(+k.nLegs);
    const qs = W.integrateQ(0, Hs, ctx) / Hs;
    const cf = W.cfChimney('round', Hs / dl, 'moderadamente liso', dl * Math.sqrt(qs * 1000));
    supp = { name: `${nL} patas Ø${dl.toFixed(2)} m (sin apantallamiento)`, q: qs, Cf: cf, Af: nL * dl * Hs, F: qs * G * cf * nL * dl * Hs, z: Hs / 2 };
    warnings.push('Viento sobre patas: no se considera arriostramiento ni apantallamiento (conservador). Agregar el área de riostras si es significativa.');
  }
  const vessel = { name: 'Recipiente', q: qv, Cf: cfV, Af: D * Ht, F: Fv, z: zv };
  const Vbase = vessel.F + supp.F;
  const Mbase = vessel.F * vessel.z + supp.F * supp.z;
  return {
    typology: 'tanque', H: Htot, levels, T, Ww, Wtop, seismic, warnings,
    wind: { ctx, gust, G, parts: [vessel, supp], Vbase, Mbase },
    combos: S.loadCombinations(p.SDS),
    geometry: { D, Ht, Hw, Hs, support: k.support, nLegs: +k.nLegs, dLeg: +k.dLeg, Dped: +k.Dped },
  };
}


// =============================================================================
// VALLA PUBLICITARIA (terreno o azotea)
// =============================================================================
export function computeValla(project) {
  const v = project.valla;
  const onRoof = v.apoyo === 'azotea';
  const nSt = Math.max(1, Math.round(+v.nStories || 1));
  const Hb = onRoof ? +v.firstStoryHeight + (nSt - 1) * +v.storyHeight : 0; // altura de la azotea
  const B = +v.B;
  const s_ = +v.s;
  const c = +v.clearance;
  const nP = Math.max(1, Math.round(+v.nPosts));
  const D = +v.postD;
  const zb = Hb + c; // borde inferior del anuncio sobre el terreno
  const zt = zb + s_; // borde superior
  const Hs = c + s_; // altura de la estructura de la valla sobre su base

  // ---- masas y período (voladizo desde su base)
  const wPostTot = nP * +v.wPost;
  const levels = [];
  const nSeg = 4;
  for (let i = 0; i < nSeg; i++) levels.push({ name: `Poste ${i + 1}`, h: ((i + 0.5) * c) / nSeg, w: (wPostTot * c) / nSeg });
  levels.push({ name: 'Anuncio', h: c + s_ / 2, w: +v.Wpanel + wPostTot * s_ });
  const Wp = sum(levels, (l) => l.w);
  let T;
  let Tmethod;
  if (v.periodMethod === 'manual') {
    T = +v.T;
    Tmethod = 'Período ingresado por el usuario';
  } else {
    T = rayleighPeriod(Hs, levels, () => nP * +v.EIpost);
    Tmethod = `Rayleigh (voladizo de ${nP} poste${nP > 1 ? 's' : ''}, EI = ${nP} × ${(+v.EIpost).toExponential(2)} kN·m²)`;
  }

  // ---- sismo
  const p = seismicCommon(project);
  const warnings = stdWarnings(p, project);
  const seismic = { params: p, directions: {} };
  if (!onRoof) {
    const sys = findSystem(v.system);
    const r = S.equivalentLateralForce({ p, system: sys, hn: Hs, Tuser: T, levels, kind: 'nonbuildingNotSimilar' });
    r.Tsource = Tmethod;
    seismic.directions.X = r;
  } else {
    const cf = S.componentForce({ p, ap: +v.ap, Rp: +v.Rp, Ip: +v.Ip, Wp, z: Hb, h: Hb });
    const lv = levels.map((l) => ({ ...l, F: (cf.Fp * l.w) / Wp }));
    let acc = 0;
    for (let i = lv.length - 1; i >= 0; i--) {
      acc += lv[i].F;
      lv[i].Vstory = acc;
    }
    cf.levels = lv;
    cf.V = cf.Fp;
    cf.Mbase = sum(lv, (l) => l.F * l.h);
    cf.T = T;
    cf.Tsource = Tmethod;
    seismic.component = cf;
    warnings.push(`Valla sobre la azotea: se diseña como componente no estructural (ASCE 7-05 §13.3, Tabla 13.5-1, aplicable cuando su peso es menor al 25 % del peso combinado, §15.3.1). Agregar Wp = ${Wp.toFixed(1)} kN al peso sísmico de la azotea y las reacciones de la valla al diseño del edificio.`);
  }

  // ---- viento
  const ctx = windCtx(project, W.KD.solidSign);
  const gust = W.gustFactor({ exposure: ctx.exposure, h: zt, B, L: Math.max(D, 0.5), n1: 1 / T, beta: +project.wind.beta || 0.02, V: ctx.V, rigidMode: project.wind.rigidMode });
  const G = gust.G;
  const sh = s_ / zt;
  const Bs = B / s_;
  const qh = W.qz(zt, ctx);
  const wind = { ctx, gust, G, sh, Bs, qh: qh.q, Kzh: qh.Kz, zb, zt, Hb, solid: v.panel !== 'abierta', cases: [] };
  const As = B * s_;
  const zcGeom = zb + s_ / 2;
  if (wind.solid) {
    const fo = W.openingsFactor(+v.eps);
    const CfAB = W.cfSignAB(sh, Bs);
    const F = qh.q * G * CfAB * fo * As;
    const dz = sh >= 0.99 ? 0.05 * zt : 0;
    wind.openings = fo;
    wind.CfAB = CfAB;
    wind.cases.push({ name: 'Caso A', F, z: zcGeom + dz, ex: 0, MT: 0 });
    wind.cases.push({ name: 'Caso B', F, z: zcGeom + dz, ex: 0.2 * B, MT: F * 0.2 * B });
    if (Bs >= 2) {
      const red = sh > 0.8 ? 1.8 - sh : 1;
      const regs = W.cfSignCaseC(B, s_, (+v.Lr || 0) / s_).map((r) => {
        const Fr = qh.q * G * r.Cf * red * fo * s_ * (r.x1 - r.x0);
        return { ...r, Cfnet: r.Cf * red * fo, F: Fr, xc: (r.x0 + r.x1) / 2 };
      });
      const Fc = sum(regs, (r) => r.F);
      const xr = sum(regs, (r) => r.F * r.xc) / Fc;
      wind.caseC = { regions: regs, reduction: red, F: Fc, xr };
      wind.cases.push({ name: 'Caso C', F: Fc, z: zcGeom + dz, ex: B / 2 - xr, MT: Fc * (B / 2 - xr) });
    }
  } else {
    const eps = +v.eps;
    const qc = W.qz(zcGeom, ctx);
    const Cf = W.cfOpenSign(eps, v.members, (+v.memberD || 0) * Math.sqrt(qc.q * 1000));
    const F = qc.q * G * Cf * eps * As;
    wind.open = { eps, Cf, qz: qc.q, Af: eps * As };
    wind.cases.push({ name: 'Anuncio abierto (Fig. 6-22)', F, z: zcGeom, ex: 0, MT: 0 });
  }
  // postes expuestos bajo el anuncio
  const qPost = c > 0 ? W.integrateQ(Hb, zb, ctx) / c : 0;
  const CfPost = W.cfChimney(v.postShape === 'square' ? 'square' : 'round', Hs / D, 'moderadamente liso', D * Math.sqrt(qPost * 1000));
  const Fposts = nP * qPost * G * CfPost * D * c;
  wind.posts = { n: nP, D, q: qPost, Cf: CfPost, Af: nP * D * c, F: Fposts, z: Hb + c / 2 };
  const gov = wind.cases.reduce((a, b) => (b.F > a.F ? b : a));
  wind.governing = gov.name;
  wind.Vbase = gov.F + Fposts;
  wind.Mbase = gov.F * (gov.z - Hb) + Fposts * (c / 2);
  wind.MTmax = Math.max(...wind.cases.map((k) => Math.abs(k.MT)));
  wind.Vmin = W.MIN_WIND_PRESSURE * (As + nP * D * c);
  if (gov.F + Fposts < wind.Vmin) warnings.push(`Viento: la fuerza total es menor que la carga mínima de 0.48 kPa sobre el área proyectada (${wind.Vmin.toFixed(1)} kN, §6.1.4.1).`);
  if (onRoof) warnings.push('El viento sobre el propio edificio no se incluye en esta tipología; usar la tipología "Edificio" para el sistema principal del edificio.');

  return {
    typology: 'valla', H: zt, levels, T, Wp, seismic, wind, warnings,
    combos: S.loadCombinations(p.SDS),
    geometry: { onRoof, Hb, nSt, Bx: +v.Bx, By: +v.By, firstStoryHeight: +v.firstStoryHeight, storyHeight: +v.storyHeight, B, s: s_, c, nP, D, zb, zt, postShape: v.postShape, panel: v.panel },
  };
}

export function compute(project) {
  switch (project.typology) {
    case 'edificio': return computeEdificio(project);
    case 'nave': return computeNave(project);
    case 'torre': return computeTorre(project);
    case 'tanque': return computeTanque(project);
    case 'valla': return computeValla(project);
    default: throw new Error('Tipología desconocida: ' + project.typology);
  }
}

export function defaultProject() {
  return {
    version: 1,
    meta: {
      nombre: 'Proyecto nuevo', cliente: '', ubicacion: 'Ciudad de Panamá', ingeniero: '', idoneidad: '',
      fecha: new Date().toISOString().slice(0, 10), notas: '',
    },
    site: { lat: 8.98, lon: -79.52, Ss: 1.0, S1: 0.4, source: 'manual', siteClass: 'D', occupancy: 'II', mapDistKm: 0 },
    wind: {
      region: 'Pacifico', returnPeriod: 50, Voverride: '', exposure: 'C', enclosure: 'cerrado',
      rigidMode: 'calc', beta: 0.02,
      topo: { enabled: false, type: 'hill3D', H: 0, Lh: 0, x: 0 },
    },
    typology: 'edificio',
    edificio: {
      Bx: 24, By: 18, nx: 4, ny: 3, nStories: 6, firstStoryHeight: 4.0, storyHeight: 3.2,
      wFloor: 8.0, wRoof: 6.5, systemX: 'C5', systemY: 'C5', Tx: '', Ty: '', n1x: '', n1y: '',
    },
    nave: { span: 30, length: 60, eaveHeight: 8, roofSlope: 10, frameSpacing: 7.5, wRoof: 0.35, wWalls: 400, system: 'C4', T: '', n1: '' },
    torre: {
      kind: 'celosia', section: 'square', shape: 'round', surface: 'moderadamente liso',
      H: 40, bBase: 5, bTop: 1.5, epsBase: 0.2, epsTop: 0.3, roundMembers: false, diagonal: false,
      nSeg: 10, wBase: 2.5, wTop: 1.0,
      appurtenances: [{ name: 'Antenas', z: 38, epa: 4.0, w: 5 }],
      periodMethod: 'manual', T: 0.8, EIbase: 2.0e7, EItop: 2.0e6, system: 'S1',
    },
    tanque: {
      D: 6, Ht: 5, Hw: 4.5, Hs: 20, support: 'patas', nLegs: 4, dLeg: 0.4, Dped: 3,
      Wshell: 250, Wsupport: 300, periodMethod: 'rigidez', K: 6000, T: 1.0, system: 'T1', surface: 'moderadamente liso',
    },
    valla: {
      apoyo: 'terreno', nStories: 4, firstStoryHeight: 3.5, storyHeight: 3.0, Bx: 18, By: 14,
      B: 12, s: 4, clearance: 8, panel: 'solida', eps: 1.0, members: 'plano', memberD: 0.05, Lr: 0,
      nPosts: 1, postShape: 'round', postD: 0.9, Wpanel: 45, wPost: 3.5,
      periodMethod: 'rayleigh', EIpost: 1.2e6, T: 1.0, system: 'P2', ap: 2.5, Rp: 2.5, Ip: 1.0,
    },
  };
}
