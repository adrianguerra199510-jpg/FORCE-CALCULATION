// Viento según REP-2021 Cap. 4 → ASCE/SEI 7-05 Cap. 6, Método 2 (procedimiento analítico).
// Unidades SI: m, m/s, kPa (kN/m²), kN.

import { REP, basicWindSpeed } from './rep.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (x, x0, x1, y0, y1) => (x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));

export function interp1(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 0; i < xs.length - 1; i++) {
    if (x >= xs[i] && x <= xs[i + 1]) return lerp(x, xs[i], xs[i + 1], ys[i], ys[i + 1]);
  }
  return ys[ys.length - 1];
}

// Tabla 6-2 (SI)
export const EXPOSURE = {
  B: { alpha: 7.0, zg: 365.76, ahat: 1 / 7, bhat: 0.84, abar: 1 / 4.0, bbar: 0.45, c: 0.3, l: 97.54, epsbar: 1 / 3.0, zmin: 9.14 },
  C: { alpha: 9.5, zg: 274.32, ahat: 1 / 9.5, bhat: 1.0, abar: 1 / 6.5, bbar: 0.65, c: 0.2, l: 152.4, epsbar: 1 / 5.0, zmin: 4.57 },
  D: { alpha: 11.5, zg: 213.36, ahat: 1 / 11.5, bhat: 1.07, abar: 1 / 9.0, bbar: 0.8, c: 0.15, l: 198.12, epsbar: 1 / 8.0, zmin: 2.13 },
};

// Tabla 6-1 (regiones no propensas a huracanes)
export function importanceWind(occ) {
  return { I: 0.87, II: 1.0, III: 1.15, IV: 1.15 }[occ];
}

// Tabla 6-4
export const KD = {
  building: 0.85,
  chimneySquare: 0.9,
  chimneyHex: 0.95,
  chimneyRound: 0.95,
  solidSign: 0.85,
  lattice: 0.85,
  trussTower: 0.85,
};

// Tabla 6-5 / Fig. 6-5
export const GCPI = { cerrado: 0.18, parcial: 0.55, abierto: 0.0 };

// Tabla 6-3, Caso 2 (SPRFV de todos los edificios y otras estructuras): z < 4.57 m → 4.57 m
export function Kz(z, exp) {
  const e = EXPOSURE[exp];
  const zz = Math.max(z, 4.57);
  return 2.01 * Math.pow(Math.min(zz, e.zg) / e.zg, 2 / e.alpha);
}

// §6.5.7 Factor topográfico (Fig. 6-4)
const TOPO = {
  ridge2D: { label: 'Cresta 2D', K1: { B: 1.3, C: 1.45, D: 1.55 }, gamma: 3, muUp: 1.5, muDown: 1.5 },
  escarp2D: { label: 'Escarpe 2D', K1: { B: 0.75, C: 0.85, D: 0.95 }, gamma: 2.5, muUp: 1.5, muDown: 4 },
  hill3D: { label: 'Colina 3D axisimétrica', K1: { B: 0.95, C: 1.05, D: 1.15 }, gamma: 4, muUp: 1.5, muDown: 1.5 },
};
export const TOPO_TYPES = Object.fromEntries(Object.entries(TOPO).map(([k, v]) => [k, v.label]));

/** topo: { enabled, type, H, Lh, x } (x>0 a sotavento de la cresta, x<0 a barlovento) */
export function Kzt(z, exp, topo) {
  if (!topo || !topo.enabled) return 1.0;
  const t = TOPO[topo.type];
  let { H, Lh } = topo;
  if (!(H > 0 && Lh > 0)) return 1.0;
  let ratio = H / Lh;
  // Condiciones de §6.5.7.1
  const Hmin = exp === 'B' ? 4.5 : 18;
  if (ratio < 0.2 || H < Hmin) return 1.0;
  if (ratio > 0.5) {
    ratio = 0.5;
    Lh = 2 * H;
  }
  const K1 = t.K1[exp] * ratio;
  const mu = topo.x >= 0 ? t.muDown : t.muUp;
  const K2 = Math.max(0, 1 - Math.abs(topo.x) / (mu * Lh));
  const K3 = Math.exp((-t.gamma * z) / Lh);
  return Math.pow(1 + K1 * K2 * K3, 2);
}

/** Presión de velocidad qz (kPa), Ec. 6-15 SI: qz = 0.613·Kz·Kzt·Kd·V²·I (N/m²) */
export function qz(z, ctx) {
  const kz = Kz(z, ctx.exposure);
  const kzt = Kzt(z, ctx.exposure, ctx.topo);
  return { z, Kz: kz, Kzt: kzt, q: (0.613 * kz * kzt * ctx.Kd * ctx.V * ctx.V * ctx.I) / 1000 };
}

/** Contexto común de viento */
export function windContext({ region, returnPeriod = REP.WIND_DESIGN_RETURN, Voverride, exposure, occupancy, Kd, topo }) {
  const base = basicWindSpeed(region, returnPeriod);
  const V = Voverride && Voverride > 0 ? Voverride / 3.6 : base.ms;
  return {
    region, returnPeriod, exposure, occupancy, Kd, topo,
    Vkmh: V * 3.6, V, Vtable: base.kmh,
    I: importanceWind(occupancy),
  };
}

// §6.5.8 Factor de efecto de ráfaga
export function gustFactor({ exposure, h, B, L, n1, beta, V, forceRigid = false, rigidMode = 'calc' }) {
  const e = EXPOSURE[exposure];
  const zbar = Math.max(0.6 * h, e.zmin);
  const Iz = e.c * Math.pow(10 / zbar, 1 / 6);
  const Lz = e.l * Math.pow(zbar / 10, e.epsbar);
  const Q = Math.sqrt(1 / (1 + 0.63 * Math.pow((B + h) / Lz, 0.63)));
  const gQ = 3.4;
  const gv = 3.4;
  const flexible = !forceRigid && n1 > 0 && n1 < 1;
  const base = { zbar, Iz, Lz, Q, gQ, gv, n1, flexible };
  if (!flexible) {
    const Gcalc = (0.925 * (1 + 1.7 * gQ * Iz * Q)) / (1 + 1.7 * gv * Iz);
    const G = rigidMode === '0.85' ? 0.85 : Gcalc;
    return { ...base, G, Gcalc, method: rigidMode === '0.85' ? 'Rígida: G = 0.85 (§6.5.8.1)' : 'Rígida: G calculado (Ec. 6-4)' };
  }
  const Vz = e.bbar * Math.pow(zbar / 10, e.abar) * V; // Ec. 6-14 SI
  const N1 = (n1 * Lz) / Vz;
  const Rn = (7.47 * N1) / Math.pow(1 + 10.3 * N1, 5 / 3);
  const Rl = (eta) => (eta > 0 ? 1 / eta - (1 / (2 * eta * eta)) * (1 - Math.exp(-2 * eta)) : 1);
  const Rh = Rl((4.6 * n1 * h) / Vz);
  const RB = Rl((4.6 * n1 * B) / Vz);
  const RL = Rl((15.4 * n1 * L) / Vz);
  const R = Math.sqrt((1 / beta) * Rn * Rh * RB * (0.53 + 0.47 * RL));
  const lnn = Math.log(3600 * n1);
  const gR = Math.sqrt(2 * lnn) + 0.577 / Math.sqrt(2 * lnn);
  const G = (0.925 * (1 + 1.7 * Iz * Math.sqrt(gQ * gQ * Q * Q + gR * gR * R * R))) / (1 + 1.7 * gv * Iz);
  return { ...base, Vz, N1, Rn, Rh, RB, RL, R, gR, beta, G, method: 'Flexible: Gf (Ec. 6-8), n1 < 1 Hz' };
}

// ---------------------------------------------------------------------------
// Fig. 6-6: coeficientes de presión externa, edificios cerrados/parcialmente cerrados
// ---------------------------------------------------------------------------
export function cpLeewardWall(LoverB) {
  return interp1(LoverB, [1, 2, 4], [-0.5, -0.3, -0.2]);
}
export const CP_WINDWARD_WALL = 0.8;
export const CP_SIDE_WALL = -0.7;

const ROOF_THETA = [10, 15, 20, 25, 30, 35, 45, 60];
// Barlovento, normal a la cumbrera, θ ≥ 10°: [caso succión (A), caso presión/menor succión (B)]
const ROOF_WW = {
  0.25: { A: [-0.7, -0.5, -0.3, -0.2, -0.2, 0.0, 0.0, 0.0], B: [-0.18, 0.0, 0.2, 0.3, 0.3, 0.4, 0.4, null] },
  0.5: { A: [-0.9, -0.7, -0.4, -0.3, -0.2, -0.2, 0.0, 0.0], B: [-0.18, -0.18, 0.0, 0.2, 0.2, 0.3, 0.4, null] },
  1.0: { A: [-1.3, -1.0, -0.7, -0.5, -0.3, -0.2, 0.0, 0.0], B: [-0.18, -0.18, -0.18, 0.0, 0.2, 0.2, 0.3, null] },
};
const ROOF_LW = { 0.25: [-0.3, -0.5, -0.6], 0.5: [-0.5, -0.5, -0.6], 1.0: [-0.7, -0.6, -0.6] };

function roofRowWW(row, theta, which) {
  const ys = ROOF_WW[row][which].map((v, i) => (v === null ? 0.01 * Math.max(theta, ROOF_THETA[i]) : v));
  if (theta >= 60) return which === 'B' ? 0.01 * theta : 0.0;
  return interp1(theta, ROOF_THETA, ys);
}

/** Cp techo barlovento (θ ≥ 10°, viento normal a la cumbrera). Devuelve {A, B}. */
export function cpRoofWindward(theta, hOverL) {
  const r = clamp(hOverL, 0.25, 1.0);
  const keys = [0.25, 0.5, 1.0];
  const out = {};
  for (const w of ['A', 'B']) {
    const vals = keys.map((k) => roofRowWW(k, theta, w));
    out[w] = interp1(r, keys, vals);
  }
  return out;
}

export function cpRoofLeeward(theta, hOverL) {
  const r = clamp(hOverL, 0.25, 1.0);
  const keys = [0.25, 0.5, 1.0];
  const vals = keys.map((k) => interp1(theta, [10, 15, 20], ROOF_LW[k]));
  return interp1(r, keys, vals);
}

/**
 * Techo con θ < 10° (normal a cumbrera) o viento paralelo a la cumbrera (todo θ).
 * Devuelve zonas [{x0, x1, A, B}] medidas desde el borde de barlovento (m).
 */
export function cpRoofZones(h, hOverL, Lroof, areaReduction = 1.0) {
  const lowRow = (x) => (x <= h / 2 ? -0.9 : x <= h ? -0.9 : x <= 2 * h ? -0.5 : -0.3);
  const highRow = (x) => (x <= h / 2 ? -1.3 * areaReduction : -0.7);
  const cuts = [0, h / 2, h, 2 * h, Lroof].filter((v, i, a) => v <= Lroof && (i === 0 || v > a[i - 1]));
  if (cuts[cuts.length - 1] < Lroof) cuts.push(Lroof);
  const zones = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const x0 = cuts[i];
    const x1 = Math.min(cuts[i + 1], Lroof);
    if (x1 <= x0) continue;
    const xm = (x0 + x1) / 2;
    const r = clamp(hOverL, 0.5, 1.0);
    const A = lerp(r, 0.5, 1.0, lowRow(xm), highRow(xm));
    zones.push({ x0, x1, A, B: -0.18 });
  }
  return zones;
}

// §6.5.15 / Fig. 6-21 chimeneas, tanques y similares
export function cfChimney(shape, hOverD, surface = 'moderadamente liso', Dsqrtq = 99) {
  const hs = [1, 7, 25];
  let ys;
  if (shape === 'square') ys = [1.3, 1.4, 2.0];
  else if (shape === 'squareDiag') ys = [1.0, 1.1, 1.5];
  else if (shape === 'hex') ys = [1.0, 1.2, 1.4];
  else if (Dsqrtq > 5.3) {
    ys = { 'moderadamente liso': [0.5, 0.6, 0.7], rugoso: [0.7, 0.8, 0.9], 'muy rugoso': [0.8, 1.0, 1.2] }[surface] || [0.5, 0.6, 0.7];
  } else ys = [0.7, 0.8, 1.2];
  return interp1(hOverD, hs, ys);
}

// Fig. 6-23 torres de celosía
export function cfTrussTower(section, eps, roundMembers = false, diagonal = false) {
  let cf = section === 'triangular' ? 3.4 * eps * eps - 4.7 * eps + 3.4 : 4.0 * eps * eps - 5.9 * eps + 4.0;
  let fRound = 1;
  if (roundMembers) {
    fRound = Math.min(1, 0.51 * eps * eps + 0.57);
    cf *= fRound;
  }
  let fDiag = 1;
  if (diagonal && section === 'square') {
    fDiag = Math.min(1.2, 1 + 0.75 * eps);
  }
  return { Cf: cf, fRound, fDiag };
}

/** Integra qz en una franja [z0,z1] (kPa·m) por Simpson. */
export function integrateQ(z0, z1, ctx, n = 8) {
  if (z1 <= z0) return 0;
  const hstep = (z1 - z0) / n;
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
    s += w * qz(z0 + i * hstep, ctx).q;
  }
  return (s * hstep) / 3;
}

/** Carga mínima §6.1.4.1: 0.48 kPa sobre el área proyectada */
export const MIN_WIND_PRESSURE = 0.48;

// ---------------------------------------------------------------------------
// Fig. 6-20: muros independientes sólidos y anuncios sólidos (§6.5.14)
// ---------------------------------------------------------------------------
const SIGN_SH = [0.16, 0.2, 0.3, 0.5, 0.7, 0.9, 1.0];
const SIGN_BS = [0.05, 0.1, 0.2, 0.5, 1, 2, 4, 5, 10, 20, 30, 45];
const SIGN_CF_AB = {
  0.16: [1.95, 1.9, 1.85, 1.85, 1.8, 1.8, 1.85, 1.85, 1.85, 1.9, 1.9, 1.95],
  0.2: [1.95, 1.9, 1.85, 1.85, 1.8, 1.8, 1.8, 1.8, 1.85, 1.9, 1.9, 1.95],
  0.3: [1.95, 1.9, 1.85, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.85, 1.85, 1.85],
  0.5: [1.95, 1.85, 1.8, 1.75, 1.75, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.75],
  0.7: [1.9, 1.85, 1.75, 1.7, 1.65, 1.6, 1.6, 1.55, 1.55, 1.55, 1.55, 1.55],
  0.9: [1.85, 1.75, 1.7, 1.6, 1.55, 1.5, 1.45, 1.45, 1.4, 1.4, 1.4, 1.4],
  1.0: [1.8, 1.7, 1.65, 1.55, 1.45, 1.4, 1.35, 1.35, 1.3, 1.3, 1.3, 1.3],
};

/** Cf casos A y B (interpolación bilineal en s/h y B/s). */
export function cfSignAB(sOverH, BoverS) {
  const sh = clamp(sOverH, 0.16, 1.0);
  const rows = SIGN_SH.map((k) => interp1(BoverS, SIGN_BS, SIGN_CF_AB[k]));
  return interp1(sh, SIGN_SH, rows);
}

// Caso C: regiones desde el borde de barlovento (anchos de s, la última es el "resto").
// Regiones unificadas: [0-s, s-2s, 2s-3s, 3s-4s, 4s-5s, 5s-10s, >10s]
const CASEC_BS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 45];
const CASEC = {
  2: [2.25, 1.5, null, null, null, null, null],
  3: [2.6, 1.7, 1.15, null, null, null, null],
  4: [2.9, 1.9, 1.3, 1.1, 1.1, 1.1, null],
  5: [3.1, 2.0, 1.45, 1.05, 1.05, 1.05, null],
  6: [3.3, 2.15, 1.55, 1.05, 1.05, 1.05, null],
  7: [3.4, 2.25, 1.65, 1.05, 1.05, 1.05, null],
  8: [3.55, 2.3, 1.7, 1.05, 1.05, 1.05, null],
  9: [3.65, 2.35, 1.75, 1.0, 1.0, 1.0, null],
  10: [3.75, 2.45, 1.85, 0.95, 0.95, 0.95, null],
  13: [4.0, 2.6, 2.0, 1.5, 1.35, 0.9, 0.55],
  45: [4.3, 2.55, 1.95, 1.85, 1.85, 1.1, 0.55],
};
const CASEC_STAR_FROM = 5; // valores con * (región 0-s, B/s ≥ 5) se reducen por esquina de retorno

function caseCcol(bs, region) {
  // valor de la columna; si la región no existe en esa columna, se usa el último definido
  const col = CASEC[bs];
  for (let r = region; r >= 0; r--) if (col[r] !== null) return col[r];
  return col[0];
}

/** Factor de reducción por esquina de retorno (Lr/s). */
export function returnCornerFactor(LrOverS) {
  if (!(LrOverS > 0)) return 1;
  return interp1(LrOverS, [0, 0.3, 1.0, 2.0], [1.0, 0.9, 0.75, 0.6]);
}

/**
 * Regiones del caso C para un anuncio de ancho B y alto s.
 * Devuelve [{x0, x1, Cf, starred}]
 */
export function cfSignCaseC(B, s, LrOverS = 0) {
  const bs = clamp(B / s, 2, 45);
  const regionsX = [];
  const cuts = [0, 1, 2, 3, 4, 5, 10].map((k) => k * s);
  for (let r = 0; r < 7; r++) {
    const x0 = cuts[r];
    const x1 = r < 6 ? Math.min(cuts[r + 1], B) : B;
    if (x0 >= B) break;
    regionsX.push({ r, x0, x1 });
  }
  // la última región es el "resto" hasta B
  regionsX[regionsX.length - 1].x1 = B;
  let i = 0;
  while (i < CASEC_BS.length - 2 && bs > CASEC_BS[i + 1]) i++;
  const b0 = CASEC_BS[i];
  const b1 = CASEC_BS[Math.min(i + 1, CASEC_BS.length - 1)];
  const rc = returnCornerFactor(LrOverS);
  return regionsX.map(({ r, x0, x1 }) => {
    const v = lerp(bs, b0, b1, caseCcol(b0, r), caseCcol(b1, r));
    const starred = r === 0 && bs >= CASEC_STAR_FROM;
    return { x0, x1, Cf: starred ? v * rc : v, starred };
  });
}

/** Nota 2: anuncios sólidos con aberturas < 30 %: factor (1 − (1 − ε)^1.5). */
export function openingsFactor(eps) {
  if (!(eps < 1)) return 1;
  return 1 - Math.pow(1 - eps, 1.5);
}

// Fig. 6-22: anuncios abiertos y armazones de celosía
export function cfOpenSign(eps, members = 'plano', Dsqrtq = 0) {
  const row = eps < 0.1 ? 0 : eps < 0.3 ? 1 : 2;
  if (members === 'redondo') {
    return Dsqrtq <= 5.3 ? [1.2, 1.3, 1.5][row] : [0.8, 0.9, 1.1][row];
  }
  return [2.0, 1.8, 1.6][row];
}
