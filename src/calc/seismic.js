// Sismo según REP-2021 Cap. 5 → ASCE/SEI 7-05 Cap. 11, 12 y 15.
// Unidades: SI (m, kN, s). Aceleraciones espectrales en g.

import { REP } from './rep.js';

const lerp = (x, x0, x1, y0, y1) => y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);

function interpTable(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 0; i < xs.length - 1; i++) {
    if (x >= xs[i] && x <= xs[i + 1]) return lerp(x, xs[i], xs[i + 1], ys[i], ys[i + 1]);
  }
  return ys[ys.length - 1];
}

// ASCE 7-05 Tabla 11.4-1 (Fa) y 11.4-2 (Fv)
const FA_X = [0.25, 0.5, 0.75, 1.0, 1.25];
const FA = {
  A: [0.8, 0.8, 0.8, 0.8, 0.8],
  B: [1.0, 1.0, 1.0, 1.0, 1.0],
  C: [1.2, 1.2, 1.1, 1.0, 1.0],
  D: [1.6, 1.4, 1.2, 1.1, 1.0],
  E: [2.5, 1.7, 1.2, 0.9, 0.9],
};
const FV_X = [0.1, 0.2, 0.3, 0.4, 0.5];
const FV = {
  A: [0.8, 0.8, 0.8, 0.8, 0.8],
  B: [1.0, 1.0, 1.0, 1.0, 1.0],
  C: [1.7, 1.6, 1.5, 1.4, 1.3],
  D: [2.4, 2.0, 1.8, 1.6, 1.5],
  E: [3.5, 3.2, 2.8, 2.4, 2.4],
};

export const SITE_CLASSES = {
  A: 'A - Roca dura',
  B: 'B - Roca',
  C: 'C - Suelo muy denso y roca blanda',
  D: 'D - Suelo rígido',
  E: 'E - Suelo blando',
  F: 'F - Requiere estudio específico (Cap. 21)',
};

export function siteCoefficients(siteClass, Ss, S1) {
  if (siteClass === 'F') {
    throw new Error('Clase de sitio F: se requiere análisis de respuesta de sitio (ASCE 7-05 §11.4.7 / Cap. 21).');
  }
  const Fa = interpTable(Ss, FA_X, FA[siteClass]);
  const Fv = interpTable(S1, FV_X, FV[siteClass]);
  return { Fa, Fv };
}

// Tabla 11.5-1
export function importanceSeismic(occ) {
  return { I: 1.0, II: 1.0, III: 1.25, IV: 1.5 }[occ];
}

// Tablas 11.6-1 y 11.6-2 + §11.6
export function seismicDesignCategory(SDS, SD1, S1, occ) {
  const iv = occ === 'IV';
  if (S1 >= 0.75) return { sdc: iv ? 'F' : 'E', by: 'S1 ≥ 0.75 (§11.6)' };
  const rank = 'ABCDEF';
  let a;
  if (SDS < 0.167) a = 'A';
  else if (SDS < 0.33) a = iv ? 'C' : 'B';
  else if (SDS < 0.5) a = iv ? 'D' : 'C';
  else a = 'D';
  let b;
  if (SD1 < 0.067) b = 'A';
  else if (SD1 < 0.133) b = iv ? 'C' : 'B';
  else if (SD1 < 0.2) b = iv ? 'D' : 'C';
  else b = 'D';
  const sdc = rank.indexOf(a) >= rank.indexOf(b) ? a : b;
  return { sdc, bySDS: a, bySD1: b, by: 'Tablas 11.6-1 y 11.6-2' };
}

export function designParameters({ Ss, S1, siteClass, occupancy }) {
  const { Fa, Fv } = siteCoefficients(siteClass, Ss, S1);
  const SMS = Fa * Ss;
  const SM1 = Fv * S1;
  const SDS = (2 / 3) * SMS;
  const SD1 = (2 / 3) * SM1;
  const I = importanceSeismic(occupancy);
  const T0 = (0.2 * SD1) / SDS;
  const Ts = SD1 / SDS;
  const TL = REP.TL;
  const { sdc, bySDS, bySD1, by } = seismicDesignCategory(SDS, SD1, S1, occupancy);
  return { Ss, S1, siteClass, occupancy, Fa, Fv, SMS, SM1, SDS, SD1, I, T0, Ts, TL, sdc, bySDS, bySD1, sdcBy: by };
}

// §11.4.5 Espectro de diseño
export function spectralAcceleration(T, p) {
  const { SDS, SD1, T0, Ts, TL } = p;
  if (T < T0) return SDS * (0.4 + (0.6 * T) / T0);
  if (T <= Ts) return SDS;
  if (T <= TL) return SD1 / T;
  return (SD1 * TL) / (T * T);
}

export function spectrumCurve(p, Tmax = 4, n = 200) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const T = (Tmax * i) / n;
    pts.push([T, spectralAcceleration(T, p)]);
  }
  return pts;
}

// Tabla 12.8-2 (SI, hn en m)
export const PERIOD_TYPES = {
  steelMRF: { label: 'Pórticos de acero resistentes a momento', Ct: 0.0724, x: 0.8 },
  concreteMRF: { label: 'Pórticos de concreto resistentes a momento', Ct: 0.0466, x: 0.9 },
  steelEBF: { label: 'Pórticos de acero con arriostramiento excéntrico / BRB', Ct: 0.0731, x: 0.75 },
  other: { label: 'Todos los demás sistemas estructurales', Ct: 0.0488, x: 0.75 },
};

// Tabla 12.8-1
export function cuCoefficient(SD1) {
  return interpTable(SD1, [0.1, 0.15, 0.2, 0.3, 0.4], [1.7, 1.6, 1.5, 1.4, 1.4]);
}

export function approximatePeriod(hn, type) {
  const { Ct, x } = PERIOD_TYPES[type];
  return { Ta: Ct * Math.pow(hn, x), Ct, x };
}

/**
 * Coeficiente sísmico Cs (§12.8.1.1 con la modificación del REP-2021 §5.2.1).
 * kind: 'building' | 'nonbuildingSimilar' | 'nonbuildingNotSimilar'
 */
export function seismicCoefficient({ p, R, T, kind = 'building' }) {
  const { SDS, SD1, TL, I, S1 } = p;
  const RI = R / I;
  const csEq2 = SDS / RI; // 12.8-2
  const csMax = T <= TL ? SD1 / (T * RI) : (SD1 * TL) / (T * T * RI); // 12.8-3 / 12.8-4
  // Mínimo REP-2021 §5.2.1: Cs = 0.044·SDS·I ≥ 0.01 (edificios y no-edificios similares), ≥ 0.03 (no similares)
  const floor = kind === 'nonbuildingNotSimilar' ? REP.CS_MIN_NONBUILDING : REP.CS_MIN_BUILDING;
  const csMinREP = Math.max(REP.CS_MIN_FACTOR * SDS * I, floor);
  // Mínimo adicional cuando S1 ≥ 0.6 g
  let csMinS1 = 0;
  let eqS1 = null;
  if (S1 >= 0.6) {
    if (kind === 'nonbuildingNotSimilar') {
      csMinS1 = (0.8 * S1) / RI; // 15.4-2
      eqS1 = 'ASCE 7-05 Ec. 15.4-2: 0.8·S1/(R/I)';
    } else {
      csMinS1 = (0.5 * S1) / RI; // 12.8-6 / 15.4-4
      eqS1 = 'ASCE 7-05 Ec. 12.8-6: 0.5·S1/(R/I)';
    }
  }
  const csMin = Math.max(csMinREP, csMinS1);
  let Cs = Math.min(csEq2, csMax);
  let governs = csEq2 <= csMax ? 'Ec. 12.8-2 (SDS/(R/I))' : T <= TL ? 'Ec. 12.8-3 (SD1/(T·R/I))' : 'Ec. 12.8-4 (SD1·TL/(T²·R/I))';
  if (Cs < csMin) {
    Cs = csMin;
    governs = csMinS1 > csMinREP ? eqS1 : 'Mínimo REP-2021 §5.2.1 (0.044·SDS·I)';
  }
  return { Cs, csEq2, csMax, csMinREP, csMinS1, csMin, governs, RI };
}

// §12.8.3 Distribución vertical
export function kExponent(T) {
  if (T <= 0.5) return 1;
  if (T >= 2.5) return 2;
  return 1 + (T - 0.5) / 2;
}

/**
 * levels: [{ name, h (altura sobre la base, m), w (peso sísmico, kN) }] de abajo hacia arriba
 */
export function verticalDistribution(levels, V, T) {
  const k = kExponent(T);
  const sum = levels.reduce((s, l) => s + l.w * Math.pow(l.h, k), 0);
  const out = levels.map((l) => {
    const Cvx = (l.w * Math.pow(l.h, k)) / sum;
    return { ...l, Cvx, F: Cvx * V };
  });
  // cortante y momento de volteo por nivel (de arriba hacia abajo)
  let Vx = 0;
  for (let i = out.length - 1; i >= 0; i--) {
    Vx += out[i].F;
    out[i].Vstory = Vx;
  }
  for (let i = 0; i < out.length; i++) {
    const hb = i === 0 ? 0 : out[i - 1].h; // cota inferior del entrepiso
    let M = 0;
    for (let j = i; j < out.length; j++) M += out[j].F * (out[j].h - hb);
    out[i].Mot = M;
  }
  const Mbase = out.reduce((s, l) => s + l.F * l.h, 0);
  return { k, levels: out, Mbase };
}

/**
 * Procedimiento de la fuerza lateral equivalente para una dirección.
 * opts: { p, system:{R,Omega0,Cd}, hn, periodType, Tuser, levels, kind }
 */
export function equivalentLateralForce(opts) {
  const { p, system, hn, periodType, Tuser, levels, kind = 'building' } = opts;
  const W = levels.reduce((s, l) => s + l.w, 0);
  let Ta = null;
  let Cu = null;
  let T;
  let Tsource;
  if (kind === 'building') {
    const ap = approximatePeriod(hn, periodType);
    Ta = ap.Ta;
    Cu = cuCoefficient(p.SD1);
    if (Tuser && Tuser > 0) {
      T = Math.min(Tuser, Cu * Ta);
      Tsource = Tuser > Cu * Ta ? 'T analítico limitado a Cu·Ta (§12.8.2)' : 'T analítico ingresado (≤ Cu·Ta)';
    } else {
      T = Ta;
      Tsource = 'Ta = Ct·hn^x (Ec. 12.8-7)';
    }
  } else {
    T = Tuser;
    Tsource = 'Período de la estructura no-edificio (§15.4.4)';
  }
  const cs = seismicCoefficient({ p, R: system.R, T, kind });
  const V = cs.Cs * W;
  const dist = verticalDistribution(levels, V, T);
  const Ev = 0.2 * p.SDS; // §12.4.2.2, multiplica a D
  return { W, Ta, Cu, T, Tsource, ...cs, V, ...dist, system, Ev, Sa: spectralAcceleration(T, p) };
}

// Combinaciones de carga (ASCE 7-05 §2.3.2 y §2.4.1, efectos sísmicos §12.4.2.3)
export function loadCombinations(SDS, rho = 1.0) {
  const ev = (0.2 * SDS).toFixed(3);
  return {
    lrfd: [
      '1.4D',
      '1.2D + 1.6L + 0.5(Lr ó R)',
      '1.2D + 1.6(Lr ó R) + (L ó 0.8W)',
      '1.2D + 1.6W + L + 0.5(Lr ó R)',
      `(1.2 + ${ev})D + ${rho.toFixed(1)}·QE + L`,
      '0.9D + 1.6W',
      `(0.9 − ${ev})D + ${rho.toFixed(1)}·QE`,
    ],
    asd: [
      'D',
      'D + L',
      'D + (Lr ó R)',
      'D + 0.75L + 0.75(Lr ó R)',
      'D + W',
      `(1 + ${(0.14 * SDS).toFixed(3)})D + ${(0.7 * rho).toFixed(2)}·QE`,
      'D + 0.75W + 0.75L + 0.75(Lr ó R)',
      `(1 + ${(0.105 * SDS).toFixed(3)})D + ${(0.525 * rho).toFixed(3)}·QE + 0.75L + 0.75(Lr ó R)`,
      '0.6D + W',
      `(0.6 − ${(0.14 * SDS).toFixed(3)})D + ${(0.7 * rho).toFixed(2)}·QE`,
    ],
    notes: [
      'E = ρ·QE ± 0.2·SDS·D (ASCE 7-05 §12.4.2).',
      'Según REP-2021 §4.2, las cargas de viento del Cap. 6 de ASCE 7-05 son a nivel de servicio; las combinaciones de ASCE 7-05 Cap. 2 ya incluyen el factor 1.6W (LRFD) / 1.0W (ASD).',
      'ρ (factor de redundancia) según §12.3.4; se muestra ρ = ' + rho.toFixed(1) + '.',
    ],
  };
}

/**
 * Fuerza sísmica de diseño en componentes no estructurales (ASCE 7-05 §13.3.1).
 * Fp = 0.4·ap·SDS·Wp·(1 + 2z/h)/(Rp/Ip), con 0.3·SDS·Ip·Wp ≤ Fp ≤ 1.6·SDS·Ip·Wp
 */
export function componentForce({ p, ap, Rp, Ip, Wp, z, h }) {
  const zz = Math.min(Math.max(z, 0), h);
  const amp = 1 + (2 * zz) / h;
  const Fcalc = (0.4 * ap * p.SDS * Wp * amp) / (Rp / Ip);
  const Fmax = 1.6 * p.SDS * Ip * Wp;
  const Fmin = 0.3 * p.SDS * Ip * Wp;
  const Fp = Math.min(Math.max(Fcalc, Fmin), Fmax);
  const governs = Fp === Fcalc ? 'Ec. 13.3-1' : Fp === Fmax ? 'Máximo, Ec. 13.3-2' : 'Mínimo, Ec. 13.3-3';
  return { ap, Rp, Ip, Wp, z: zz, h, amp, Fcalc, Fmax, Fmin, Fp, governs, Fv: 0.2 * p.SDS * Wp };
}
