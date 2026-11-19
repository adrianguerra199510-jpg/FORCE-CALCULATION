// Aplicación de viento y sismo por tipología estructural.
import * as W from './wind.js';
import * as S from './seismic.js';
import { REP } from './rep.js';
import { findSystem, systemWarnings, BUILDING_SYSTEMS } from './systems.js';

const G_ACC = 9.81;
const GAMMA_W = 9.81; // kN/m³

export const TYPOLOGIES = {
  edificio: 'Edificio de varios niveles (pórticos / muros)',
  nave: 'Nave industrial con techo a dos aguas',
  torre: 'Torre de celosía / chimenea / poste',
  tanque: 'Tanque elevado',
  valla: 'Valla publicitaria (en terreno o sobre edificación)',
  generico: 'Volumen genérico (cuerpos configurables)',
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

/**
 * Relieve aplicable a una dirección de viento. El relieve se define con la cresta
 * perpendicular a la dirección X (x medido a lo largo de X). Para crestas y escarpes 2D
 * el viento en Y es paralelo a la cresta y no hay aumento de velocidad (Kzt = 1);
 * la colina 3D es axisimétrica y aplica en ambas direcciones.
 */
export function topoFor(topo, dir = 'X') {
  if (topo && topo.enabled && dir === 'Y' && topo.type !== 'hill3D') return { ...topo, enabled: false, parallel: true };
  return topo;
}

function windCtx(project, Kd, dir = 'X') {
  const w = project.wind;
  return W.windContext({
    region: w.region,
    returnPeriod: +w.returnPeriod,
    Voverride: +w.Voverride || null,
    exposure: w.exposure,
    occupancy: project.site.occupancy,
    Kd,
    topo: topoFor(w.topo, dir),
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
    const ctx = windCtx(project, W.KD.building, dir);
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
      B, L, H, n1, gust, G, qh: qh.q, Kzh: qh.Kz, cpLw, rows, Fbase, Vbase, Mbase, Vmin, torsion, roofZones, topoApplies: !!ctx.topo?.enabled,
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
    const ctxY = windCtx(project, W.KD.building, 'Y');
    const qh = W.qz(h, ctxY);
    const qe = W.qz(he, ctxY);
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
    wind.longitudinal = { B, L, gust, G, cpLw, zones, surfaces, cases, qh: qh.q, qe: qe.q, topoApplies: !!ctxY.topo?.enabled };
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
// TANQUE (elevado sobre patas o pedestal, o apoyado sin patas); cilíndrico o cuadrado
// =============================================================================
export function computeTanque(project) {
  const k = project.tanque;
  const square = k.shape === 'rect';
  const D = +k.D; // diámetro o lado
  const Ht = +k.Ht;
  const Hw = Math.min(+k.Hw, Ht);
  const warnings = [];
  let support = k.support;
  if (support === 'patas' && (!(+k.nLegs > 0) || !(+k.Hs > 0))) {
    support = 'apoyado';
    warnings.push('El tanque no tiene patas (n.º de patas o altura de soporte igual a cero): se calcula como tanque apoyado, sin cargas en patas.');
  }
  if (support === 'pedestal' && !(+k.Hs > 0)) support = 'apoyado';
  const onGround = support === 'apoyado';
  const Hs = Math.max(0, +k.Hs || 0); // cota del fondo del tanque (para "apoyado": cota de la superficie de apoyo)
  const Htot = Hs + Ht;
  const Aplan = square ? D * D : (Math.PI * D * D) / 4;
  const Ww = GAMMA_W * Aplan * Hw;
  const Wshell = +k.Wshell;
  const Wsup = onGround ? 0 : +k.Wsupport;
  const Wtop = Wshell + Ww;
  // alturas sísmicas medidas desde la base de la estructura (terreno o superficie de apoyo)
  const base = onGround ? Hs : 0;
  const zTop = Hs - base + (Wshell * (Ht / 2) + Ww * (Hw / 2)) / Math.max(Wtop, 1e-9);
  const levels = onGround
    ? [{ name: 'Tanque + agua', h: zTop, w: Wtop }]
    : [{ name: support === 'pedestal' ? 'Pedestal' : 'Patas y arriostramiento', h: Hs / 2, w: Wsup }, { name: 'Tanque + agua', h: zTop, w: Wtop }];
  let T;
  let Tmethod;
  const pm = onGround && k.periodMethod === 'rigidez' ? 'rigida' : k.periodMethod;
  if (pm === 'rigidez') {
    T = 2 * Math.PI * Math.sqrt((Wtop + 0.33 * Wsup) / (G_ACC * +k.K));
    Tmethod = 'T = 2π·√[(Wtanque + 0.33·Wsoporte)/(g·K)]';
  } else if (pm === 'rigida') {
    T = 0.05;
    Tmethod = onGround ? 'Tanque apoyado considerado rígido (T < 0.06 s, §15.4.2)' : 'Rígido (T < 0.06 s, §15.4.2)';
  } else {
    T = +k.T;
    Tmethod = 'Período ingresado por el usuario';
  }
  const p = seismicCommon(project);
  warnings.unshift(...stdWarnings(p, project));
  let sys = findSystem(k.system);
  if (onGround && !sys.id.startsWith('G')) sys = findSystem('G1');
  if (!onGround && sys.id.startsWith('G')) sys = findSystem('T1');
  const r = S.equivalentLateralForce({ p, system: sys, hn: Htot - base, Tuser: T, levels, kind: 'nonbuildingNotSimilar' });
  r.Tsource = Tmethod;
  const seismic = { params: p, directions: { X: r } };
  warnings.push('No se incluye el componente convectivo (oleaje) del líquido; verificar según ASCE 7-05 §15.7.6 si aplica.');
  if (onGround && Hs > 0) warnings.push(`Tanque apoyado a ${Hs.toFixed(2)} m sobre el terreno: el viento se evalúa a su altura real; si descansa sobre una edificación, sus reacciones deben incluirse en el diseño de ésta (§15.3).`);

  const ctx = windCtx(project, square ? W.KD.chimneySquare : W.KD.chimneyRound);
  const gust = W.gustFactor({ exposure: ctx.exposure, h: Htot, B: D, L: D, n1: 1 / T, beta: +project.wind.beta || 0.02, V: ctx.V, rigidMode: project.wind.rigidMode });
  const G = gust.G;
  const qv = W.integrateQ(Hs, Htot, ctx) / Ht;
  const cfV = square
    ? W.cfChimney('square', Math.max(1, Ht / D))
    : W.cfChimney('round', Math.max(1, Ht / D), k.surface || 'moderadamente liso', D * Math.sqrt(qv * 1000));
  const vessel = { name: square ? 'Recipiente cuadrado (viento normal a la cara)' : 'Recipiente cilíndrico', q: qv, Cf: cfV, Af: D * Ht, F: qv * G * cfV * D * Ht, z: Hs + Ht / 2 };
  const parts = [vessel];
  if (support === 'pedestal') {
    const Dp = +k.Dped;
    const qs = W.integrateQ(0, Hs, ctx) / Hs;
    const cf = W.cfChimney('round', Hs / Dp, 'moderadamente liso', Dp * Math.sqrt(qs * 1000));
    parts.push({ name: 'Pedestal', q: qs, Cf: cf, Af: Dp * Hs, F: qs * G * cf * Dp * Hs, z: Hs / 2 });
  } else if (support === 'patas') {
    const dl = +k.dLeg;
    const nL = Math.round(+k.nLegs);
    const qs = W.integrateQ(0, Hs, ctx) / Hs;
    const cf = W.cfChimney('round', Hs / dl, 'moderadamente liso', dl * Math.sqrt(qs * 1000));
    parts.push({ name: `${nL} patas Ø${dl.toFixed(2)} m (sin apantallamiento)`, q: qs, Cf: cf, Af: nL * dl * Hs, F: qs * G * cf * nL * dl * Hs, z: Hs / 2 });
    warnings.push('Viento sobre patas: no se considera arriostramiento ni apantallamiento (conservador). Agregar el área de riostras si es significativa.');
  }
  const Vbase = sum(parts, (x) => x.F);
  const Mbase = sum(parts, (x) => x.F * (x.z - base));
  return {
    typology: 'tanque', H: Htot, levels, T, Ww, Wtop, seismic, warnings,
    wind: { ctx, gust, G, parts, Vbase, Mbase, base },
    combos: S.loadCombinations(p.SDS),
    geometry: { square, D, Ht, Hw, Hs, support, nLegs: +k.nLegs, dLeg: +k.dLeg, Dped: +k.Dped },
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
  const direct = v.soporte === 'directa'; // sin postes: anclada a la estructura o apoyada en el terreno
  const nP = direct ? 0 : Math.max(1, Math.round(+v.nPosts));
  const D = +v.postD;
  const zb = Hb + c; // borde inferior del anuncio sobre el terreno
  const zt = zb + s_; // borde superior
  const Hs = c + s_; // altura de la estructura de la valla sobre su base

  // ---- masas y período (voladizo desde su base)
  const wPostTot = nP * +v.wPost;
  const levels = [];
  const nSeg = 4;
  if (nP > 0 && c > 0) for (let i = 0; i < nSeg; i++) levels.push({ name: `Poste ${i + 1}`, h: ((i + 0.5) * c) / nSeg, w: (wPostTot * c) / nSeg });
  levels.push({ name: 'Anuncio', h: c + s_ / 2, w: +v.Wpanel + wPostTot * s_ });
  const Wp = sum(levels, (l) => l.w);
  let T;
  let Tmethod;
  if (v.periodMethod === 'manual') {
    T = +v.T;
    Tmethod = 'Período ingresado por el usuario';
  } else if (direct || v.periodMethod === 'rigida') {
    T = 0.05;
    Tmethod = 'Anclaje directo: se considera rígida (T < 0.06 s, §15.4.2)';
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
  const Fposts = nP > 0 ? nP * qPost * G * CfPost * D * c : 0;
  wind.posts = { n: nP, D, q: qPost, Cf: CfPost, Af: nP * D * c, F: Fposts, z: Hb + c / 2 };
  if (direct && c > 0) warnings.push(`Valla sin postes con ${c.toFixed(2)} m libres bajo el anuncio: incluir el viento y el peso de la estructura de soporte que la separa del ${onRoof ? 'techo' : 'terreno'}.`);
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
    geometry: { direct, onRoof, Hb, nSt, Bx: +v.Bx, By: +v.By, firstStoryHeight: +v.firstStoryHeight, storyHeight: +v.storyHeight, B, s: s_, c, nP, D, zb, zt, postShape: v.postShape, panel: v.panel },
  };
}


// ---------------------------------------------------------------- techos de volúmenes
const ROOF_LABEL = { plano: 'Plano', una: 'A una agua', dos: 'A dos aguas', cuatro: 'A cuatro aguas', domo: 'Domo' };
export { ROOF_LABEL };

/** Geometría del techo de un volumen: flecha, cumbrera, altura media y cota máxima. */
export function roofGeometry(v) {
  const eave = +v.z0 + +v.h;
  const t = Math.tan(((+v.roofAngle || 0) * Math.PI) / 180);
  const cyl = v.shape === 'cyl';
  let type = v.roof || 'plano';
  if (cyl && type !== 'domo') type = 'plano';
  if (!cyl && type === 'domo') type = 'plano';
  let rise = 0;
  let ridgeDir = v.roofDir === 'Y' ? 'Y' : 'X';
  let ridgeLen = 0;
  if (type === 'dos') rise = ((ridgeDir === 'X' ? +v.by : +v.bx) / 2) * t;
  else if (type === 'cuatro') {
    const a = Math.min(+v.bx, +v.by);
    rise = (a / 2) * t;
    ridgeDir = +v.bx >= +v.by ? 'X' : 'Y';
    ridgeLen = Math.abs(+v.bx - +v.by);
  } else if (type === 'una') rise = (ridgeDir === 'X' ? +v.bx : +v.by) * t; // la pendiente sube hacia +X o +Y
  else if (type === 'domo') rise = Math.min(Math.max(+v.domeRise || 0, 0), +v.bx / 2);
  const theta = +v.roofAngle || 0;
  const hMean = type === 'domo' ? eave + rise : type === 'plano' || theta <= 10 ? eave : eave + rise / 2;
  return { type, rise, eave, top: eave + rise, hMean, ridgeDir, ridgeLen, theta };
}

function circleSegmentArea(D, f) {
  if (!(f > 0)) return 0;
  const R = (D * D / 4 + f * f) / (2 * f);
  return R * R * Math.acos((R - f) / R) - (R - f) * Math.sqrt(Math.max(0, 2 * R * f - f * f));
}

/** Área del techo proyectada sobre el plano normal al viento (dir = 'X' o 'Y'). */
export function roofProjectedArea(v, rg, dir) {
  const bperp = dir === 'X' ? +v.by : +v.bx;
  switch (rg.type) {
    case 'dos': return rg.ridgeDir === dir ? 0.5 * bperp * rg.rise : bperp * rg.rise;
    case 'cuatro': return rg.ridgeDir === dir ? 0.5 * bperp * rg.rise : 0.5 * (bperp + rg.ridgeLen) * rg.rise;
    case 'una': return rg.ridgeDir === dir ? bperp * rg.rise : 0.5 * (dir === 'X' ? +v.bx : +v.by) * rg.rise;
    case 'domo': return circleSegmentArea(+v.bx, rg.rise);
    default: return 0;
  }
}

/**
 * Presiones de techo de un volumen sólido para viento en 'dir' (Fig. 6-6 / 6-7).
 * Devuelve filas por superficie con p externa y neta (±GCpi) y la succión vertical aproximada.
 */
export function roofPressures(v, rg, dir, ctx, G, gcpi) {
  const q = W.qz(rg.type === 'domo' ? rg.top : rg.hMean, ctx).q;
  const L = rg.type === 'domo' ? +v.bx : dir === 'X' ? +v.bx : +v.by; // dimensión paralela al viento
  const B = rg.type === 'domo' ? +v.bx : dir === 'X' ? +v.by : +v.bx;
  const hL = rg.hMean / L;
  const rows = [];
  const add = (face, Cp, area, caseCp = '') => rows.push({ face, caseCp, Cp, q, pe: q * G * Cp, pPos: q * G * Cp - q * gcpi, pNeg: q * G * Cp + q * gcpi, area });
  const zones = () => W.cpRoofZones(rg.hMean, hL, L).forEach((z) => {
    add(`Techo ${z.x0.toFixed(1)}–${z.x1.toFixed(1)} m`, z.A, (z.x1 - z.x0) * B, 'A');
    add(`Techo ${z.x0.toFixed(1)}–${z.x1.toFixed(1)} m`, z.B, (z.x1 - z.x0) * B, 'B');
  });
  const normal = rg.theta >= 10;
  if (rg.type === 'domo') {
    const c = W.cpDome(rg.eave, rg.rise, +v.bx);
    add('Domo – A (borde de barlovento)', c.A, 0);
    add('Domo – B (cima)', c.B, 0);
    add('Domo – C (borde de sotavento)', c.C, 0);
    const Cm = (c.A + 2 * c.B + c.C) / 4;
    const Aplan = (Math.PI * +v.bx * +v.bx) / 4;
    return { rows, q, hL, hDD: c.hDD, fD: c.fD, uplift: -Math.min(0, q * G * Cm - q * gcpi) * Aplan, note: 'Succión vertical aproximada con Cp medio = (A + 2B + C)/4 sobre el área en planta (Fig. 6-7, caso A).' };
  }
  if (rg.type === 'plano' || !normal) zones();
  else if (rg.type === 'dos' || rg.type === 'cuatro') {
    const ridgeNormal = rg.ridgeDir !== dir;
    if (rg.type === 'dos' && !ridgeNormal) zones();
    else {
      const ww = W.cpRoofWindward(rg.theta, hL);
      const lw = W.cpRoofLeeward(rg.theta, hL);
      const half = (L / 2) * B;
      add('Faldón de barlovento', ww.A, half, 'A');
      add('Faldón de barlovento', ww.B, half, 'B');
      add('Faldón de sotavento', lw, half);
      if (rg.type === 'cuatro' && !ridgeNormal) {
        // viento paralelo a la cumbrera: los faldones laterales se evalúan con la zona a L/2
        const zs = W.cpRoofZones(rg.hMean, hL, L);
        const mid = zs.find((z) => z.x0 <= L / 2 && z.x1 >= L / 2) || zs[zs.length - 1];
        add('Faldones laterales', mid.A, 0);
      }
    }
  } else if (rg.type === 'una') {
    const ww = W.cpRoofWindward(rg.theta, hL);
    const lw = W.cpRoofLeeward(rg.theta, hL);
    const A = L * B;
    if (rg.ridgeDir === dir) {
      add('Techo (viento hacia el alero bajo: barlovento)', ww.A, A, 'A');
      add('Techo (viento hacia el alero bajo: barlovento)', ww.B, A, 'B');
      add('Techo (viento hacia el alero alto: sotavento)', lw, A);
    } else zones();
  }
  // succión vertical: peor combinación por superficie (sólo filas con área)
  const byFace = {};
  for (const r of rows) {
    if (!r.area) continue;
    const pn = Math.min(r.pPos, r.pNeg);
    byFace[r.face] = Math.min(byFace[r.face] ?? 0, pn * r.area);
  }
  const uplift = -Object.values(byFace).reduce((a, b) => a + Math.min(0, b), 0);
  return { rows, q, hL, uplift, note: 'Succión vertical: suma de la presión neta más desfavorable de cada superficie por su área en planta.' };
}

// =============================================================================
// VOLUMEN GENÉRICO: lista de cuerpos (prisma o cilindro, sólidos o abiertos),
// a cualquier cota sobre el terreno y con columnas de apoyo opcionales.
// Viento: §6.5.15 (F = qz·G·Cf·Af) por franjas; sismo: FLE con el sistema elegido.
// =============================================================================
export function computeGenerico(project) {
  const gp = project.generico;
  const vols = (gp.volumes || []).filter((v) => +v.h > 0 && +v.bx > 0 && (v.shape === 'cyl' || +v.by > 0));
  if (!vols.length) throw new Error('Agrega al menos un volumen con dimensiones mayores que cero.');
  const nS = Math.max(1, Math.round(+gp.slices || 4));
  const rgs = new Map(vols.map((v) => [v, roofGeometry(v)]));
  const top = Math.max(...vols.map((v) => rgs.get(v).top));

  // ---- masas
  const levels = [];
  for (const v of vols) {
    const dz = +v.h / nS;
    for (let k = 0; k < nS; k++) levels.push({ name: `${v.name} ${k + 1}/${nS}`, h: +v.z0 + (k + 0.5) * dz, w: +v.W / nS, vol: v.name });
    if (+v.nCols > 0 && +v.z0 > 0) levels.push({ name: `${v.name} – columnas`, h: +v.z0 / 2, w: +v.nCols * +v.wCol * +v.z0, vol: v.name });
  }
  levels.sort((a, b) => a.h - b.h);

  // ---- sismo
  const p = seismicCommon(project);
  const warnings = stdWarnings(p, project);
  const sys = findSystem(gp.system);
  const kind = BUILDING_SYSTEMS.some((b) => b.id === sys.id) ? 'building' : 'nonbuildingNotSimilar';
  let Tuser = null;
  let Tsrc = null;
  if (gp.periodMethod === 'manual') Tuser = +gp.T;
  else if (gp.periodMethod === 'rigida') {
    Tuser = 0.05;
    Tsrc = 'Rígida (T < 0.06 s)';
  } else if (kind !== 'building') {
    Tuser = +gp.T;
    warnings.push('Para estructuras no-edificio no se permite Ta = Ct·hn^x (§15.4.4): se usa el período ingresado.');
  }
  const r = S.equivalentLateralForce({ p, system: sys, hn: top, periodType: sys.periodType || 'other', Tuser, levels, kind });
  if (Tsrc) r.Tsource = Tsrc;
  warnings.push(...systemWarnings(sys, p.sdc));
  const seismic = { params: p, directions: { X: r }, kind };

  // ---- viento
  const n1 = 1 / r.T;
  const wind = { directions: {}, n1 };
  for (const dir of ['X', 'Y']) {
    const rows = [];
    const cols = [];
    let Bmax = 0;
    let Lmax = 0;
    for (const v of vols) {
      const cyl = v.shape === 'cyl';
      Bmax = Math.max(Bmax, cyl ? +v.bx : dir === 'X' ? +v.by : +v.bx);
      Lmax = Math.max(Lmax, cyl ? +v.bx : dir === 'X' ? +v.bx : +v.by);
    }
    const ctx0 = windCtx(project, W.KD.building, dir);
    const gust = W.gustFactor({ exposure: ctx0.exposure, h: top, B: Bmax, L: Lmax, n1, beta: +project.wind.beta || 0.02, V: ctx0.V, rigidMode: project.wind.rigidMode });
    const G = gust.G;
    for (const v of vols) {
      const cyl = v.shape === 'cyl';
      const open = v.tipo === 'abierto';
      const bperp = cyl ? +v.bx : dir === 'X' ? +v.by : +v.bx;
      const Kd = open ? W.KD.lattice : cyl ? W.KD.chimneyRound : W.KD.chimneySquare;
      const ctx = windCtx(project, Kd, dir);
      const dz = +v.h / nS;
      for (let k = 0; k < nS; k++) {
        const z0 = +v.z0 + k * dz;
        const z1 = z0 + dz;
        const q = W.integrateQ(z0, z1, ctx) / dz;
        let Cf;
        let fig;
        if (open) {
          Cf = W.cfTrussTower(cyl ? 'triangular' : 'square', +v.eps).Cf;
          fig = 'Fig. 6-23';
        } else if (cyl) {
          Cf = W.cfChimney('round', Math.max(1, +v.h / bperp), gp.surface || 'moderadamente liso', bperp * Math.sqrt(q * 1000));
          fig = 'Fig. 6-21';
        } else {
          Cf = W.cfChimney('square', Math.max(1, +v.h / bperp));
          fig = 'Fig. 6-21';
        }
        const Af = (open ? +v.eps : 1) * bperp * dz;
        // p: presión equivalente sobre el área bruta de la cara (kPa); F = p · b · Δz
        rows.push({ vol: v.name, z0, z1, zc: (z0 + z1) / 2, Kz: W.Kz((z0 + z1) / 2, ctx.exposure), qz: q, Kd, Cf, fig, Af, b: bperp, p: q * G * Cf * (open ? +v.eps : 1), F: q * G * Cf * Af });
      }
      const rg = rgs.get(v);
      const Ar = roofProjectedArea(v, rg, dir) * (open ? +v.eps : 1);
      if (Ar > 0) {
        const zr = rg.eave + rg.rise / 3;
        const q = W.qz(zr, ctx).q;
        const Cf = rows[rows.length - 1].Cf;
        rows.push({ vol: v.name, roof: true, z0: rg.eave, z1: rg.top, zc: zr, Kz: W.Kz(zr, ctx.exposure), qz: q, Kd, Cf, fig: `techo ${ROOF_LABEL[rg.type].toLowerCase()}`, Af: Ar, F: q * G * Cf * Ar });
      }
      if (+v.nCols > 0 && +v.z0 > 0) {
        const q = W.integrateQ(0, +v.z0, ctx0) / +v.z0;
        const d = +v.dCol;
        const Cf = W.cfChimney('round', +v.z0 / d, 'moderadamente liso', d * Math.sqrt(q * 1000));
        const Af = +v.nCols * d * +v.z0;
        cols.push({ vol: v.name, n: +v.nCols, d, z: +v.z0 / 2, qz: q, Cf, Af, F: q * G * Cf * Af });
      }
    }
    const Vbase = sum(rows, (x) => x.F) + sum(cols, (x) => x.F);
    const Mbase = sum(rows, (x) => x.F * x.zc) + sum(cols, (x) => x.F * x.z);
    const perVol = vols.map((v) => {
      const rr = rows.filter((x) => x.vol === v.name);
      const wall = rr.filter((x) => !x.roof);
      const F = sum(rr, (x) => x.F);
      return {
        vol: v.name, F, z: F > 0 ? sum(rr, (x) => x.F * x.zc) / F : 0,
        pMin: Math.min(...wall.map((x) => x.p)), pMax: Math.max(...wall.map((x) => x.p)),
        qMin: Math.min(...wall.map((x) => x.qz)), qMax: Math.max(...wall.map((x) => x.qz)),
        Cf: wall[0] ? wall[0].Cf : 0, b: wall[0] ? wall[0].b : 0, Froof: sum(rr.filter((x) => x.roof), (x) => x.F),
      };
    });
    const Aproj = sum(rows, (x) => x.Af) + sum(cols, (x) => x.Af);
    const Vmin = W.MIN_WIND_PRESSURE * Aproj;
    if (Vbase < Vmin) warnings.push(`Viento ${dir}: el cortante (${Vbase.toFixed(1)} kN) es menor que la carga mínima de 0.48 kPa sobre el área proyectada (${Vmin.toFixed(1)} kN, §6.1.4.1).`);
    const roofs = vols.filter((v) => v.tipo !== 'abierto' && (rgs.get(v).type !== 'plano' || v.shape !== 'cyl'))
      .map((v) => ({ vol: v.name, type: rgs.get(v).type, ...roofPressures(v, rgs.get(v), dir, ctx0, G, W.GCPI[project.wind.enclosure]) }));
    wind.directions[dir] = { ctx: ctx0, gust, G, rows, cols, Vbase, Mbase, Vmin, roofs, perVol };
  }
  wind.ctx = wind.directions.X.ctx;
  if (vols.some((v) => v.shape !== 'cyl' && v.tipo !== 'abierto' && Math.abs(+v.bx / +v.by - 1) > 0.25)) {
    warnings.push('Prismas rectangulares no cuadrados: se usa Cf de sección cuadrada de la Fig. 6-21 (viento normal a la cara). Para edificios cerrados apoyados en el terreno se recomienda la tipología "Edificio" (Cp de la Fig. 6-6).');
  }
  warnings.push('Volumen genérico: no se considera apantallamiento entre cuerpos ni entre columnas (conservador).');

  return {
    typology: 'generico', H: top, levels, seismic, wind, warnings,
    combos: S.loadCombinations(p.SDS),
    geometry: { volumes: vols.map((v) => ({ ...v, bx: +v.bx, by: +v.by, h: +v.h, z0: +v.z0, x: +v.x || 0, y: +v.y || 0, nCols: +v.nCols || 0, dCol: +v.dCol, eps: +v.eps, rg: rgs.get(v) })), top },
  };
}

export function compute(project) {
  switch (project.typology) {
    case 'edificio': return computeEdificio(project);
    case 'nave': return computeNave(project);
    case 'torre': return computeTorre(project);
    case 'tanque': return computeTanque(project);
    case 'valla': return computeValla(project);
    case 'generico': return computeGenerico(project);
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
      shape: 'cyl', D: 6, Ht: 5, Hw: 4.5, Hs: 20, support: 'patas', nLegs: 4, dLeg: 0.4, Dped: 3,
      Wshell: 250, Wsupport: 300, periodMethod: 'rigidez', K: 6000, T: 1.0, system: 'T1', surface: 'moderadamente liso',
    },
    valla: {
      apoyo: 'terreno', nStories: 4, firstStoryHeight: 3.5, storyHeight: 3.0, Bx: 18, By: 14,
      B: 12, s: 4, clearance: 8, panel: 'solida', eps: 1.0, members: 'plano', memberD: 0.05, Lr: 0,
      soporte: 'postes', nPosts: 1, postShape: 'round', postD: 0.9, Wpanel: 45, wPost: 3.5,
      periodMethod: 'rayleigh', EIpost: 1.2e6, T: 1.0, system: 'P2', ap: 2.5, Rp: 2.5, Ip: 1.0,
    },
    generico: {
      system: 'P1', periodMethod: 'manual', T: 0.4, slices: 4, surface: 'moderadamente liso',
      volumes: [
        { name: 'Cuerpo principal', shape: 'rect', bx: 12, by: 8, h: 6, z0: 5, x: 0, y: 0, tipo: 'solido', eps: 1, W: 900, nCols: 6, dCol: 0.5, wCol: 5, roof: 'dos', roofAngle: 20, roofDir: 'X', domeRise: 0 },
        { name: 'Cuerpo superior', shape: 'cyl', bx: 4, by: 4, h: 4, z0: 13.2, x: 3, y: 0, tipo: 'solido', eps: 1, W: 60, nCols: 0, dCol: 0.3, wCol: 1, roof: 'domo', roofAngle: 0, roofDir: 'X', domeRise: 1.2 },
      ],
    },
  };
}
