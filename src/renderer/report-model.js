// Construye el modelo de reporte (bloques) a partir del proyecto, resultados e imágenes.
import { REFERENCES, REP } from '../calc/rep.js';
import { TYPOLOGIES } from '../calc/typologies.js';
import { SITE_CLASSES } from '../calc/seismic.js';
import { EXPOSURE, GCPI, TOPO_TYPES } from '../calc/wind.js';
import { OCCUPANCY } from './forms.js';

const f = (x, n = 2) => (x == null || Number.isNaN(+x) ? '—' : (+x).toFixed(n));
const occLabel = (o) => (OCCUPANCY.find((x) => x.value === o) || {}).label || o;
const ENCL = { cerrado: 'Cerrado', parcial: 'Parcialmente cerrado', abierto: 'Abierto' };

export function buildReportModel(project, res, images) {
  const m = project.meta;
  const p = res.seismic.params;
  const B = [];
  const h1 = (t) => B.push({ t: 'h1', text: t });
  const h2 = (t) => B.push({ t: 'h2', text: t });
  const h3 = (t) => B.push({ t: 'h3', text: t });
  const para = (t) => B.push({ t: 'p', text: t });
  const eq = (t) => B.push({ t: 'eq', text: t });
  const kv = (rows) => B.push({ t: 'kv', rows });
  const table = (caption, head, rows) => B.push({ t: 'table', caption, head, rows });
  const img = (im, caption, w = 6.5) => im && B.push({ t: 'img', data: im.data, ratio: im.ratio, caption, w });
  const note = (text, kind) => B.push({ t: 'note', text, kind });

  // 1 ---------------------------------------------------------------------
  h1('1. Descripción del proyecto');
  kv([
    ['Tipología estructural', TYPOLOGIES[res.typology]],
    ['Ubicación', m.ubicacion || '—'],
    ['Coordenadas del sitio', `${f(project.site.lat, 4)}° N, ${f(Math.abs(project.site.lon), 4)}° O`],
    ['Categoría de ocupación', occLabel(project.site.occupancy)],
  ]);
  if (m.notas) para(m.notas);
  describeGeometry(res, project, kv, table);

  // 2 ---------------------------------------------------------------------
  h1('2. Normativa aplicada');
  B.push({ t: 'list', items: [...REFERENCES.wind, ...REFERENCES.seismic] });
  para('El REP-2021 adopta por referencia los capítulos de ASCE/SEI 7-05 con las modificaciones propias de la República de Panamá indicadas en este documento (velocidad básica de viento de la Tabla 4.1, cortante basal mínimo de §5.2.1 y período de transición TL = 10 s de §5.13).');

  // 3 ---------------------------------------------------------------------
  h1('3. Parámetros sísmicos del sitio');
  const src = project.site.source === 'mapa'
    ? `Mapas REP-2014 digitalizados (interpolación entre contornos; etiqueta más cercana a ${project.site.mapDistKm} km)`
    : 'Ingresados por el usuario';
  kv([
    ['Ss – aceleración espectral MCE, T = 0.2 s (Clase B)', `${f(p.Ss, 3)} g`, 'REP-2021 §5.12'],
    ['S1 – aceleración espectral MCE, T = 1.0 s (Clase B)', `${f(p.S1, 3)} g`, 'REP-2021 §5.12'],
    ['Origen de Ss y S1', src],
    ['Clase de sitio', SITE_CLASSES[p.siteClass], 'ASCE 7-05 Cap. 20'],
    ['Fa', f(p.Fa, 3), 'Tabla 11.4-1'],
    ['Fv', f(p.Fv, 3), 'Tabla 11.4-2'],
    ['SMS = Fa·Ss', `${f(p.SMS, 3)} g`, 'Ec. 11.4-1'],
    ['SM1 = Fv·S1', `${f(p.SM1, 3)} g`, 'Ec. 11.4-2'],
    ['SDS = ⅔·SMS', `${f(p.SDS, 3)} g`, 'Ec. 11.4-3'],
    ['SD1 = ⅔·SM1', `${f(p.SD1, 3)} g`, 'Ec. 11.4-4'],
    ['T0 = 0.2·SD1/SDS', `${f(p.T0, 3)} s`, '§11.4.5'],
    ['Ts = SD1/SDS', `${f(p.Ts, 3)} s`, '§11.4.5'],
    ['TL', `${f(p.TL, 0)} s`, 'REP-2021 §5.13'],
    ['Factor de importancia sísmica I', f(p.I, 2), 'Tabla 11.5-1'],
    ['Categoría de diseño sísmico', `${p.sdc} (SDS → ${p.bySDS}, SD1 → ${p.bySD1})`, p.sdcBy],
  ]);
  if (images.mapSs || images.mapS1) {
    h3('Ubicación del sitio en los mapas de aceleraciones espectrales');
    if (images.mapSs) img(images.mapSs, `Figura: recorte de la hoja Ss-${images.mapSs.sheet} con la ubicación del sitio.`, 3.4);
    if (images.mapS1) img(images.mapS1, `Figura: recorte de la hoja S1-${images.mapS1.sheet} con la ubicación del sitio.`, 3.4);
  }
  img(images.spectrum, 'Figura: espectro de respuesta de diseño (ASCE 7-05 §11.4.5) con los períodos de la estructura.');

  // 4 ---------------------------------------------------------------------
  const kind = res.typology === 'generico' ? (res.seismic.kind === 'building' ? 'building' : 'nonbuilding') : ['torre', 'tanque', 'valla'].includes(res.typology) ? 'nonbuilding' : 'building';
  if (res.seismic.component) {
    const c = res.seismic.component;
    h1('4. Fuerzas sísmicas – componente no estructural sobre la edificación (ASCE 7-05 Cap. 13)');
    para('La valla está apoyada en la azotea y su peso es pequeño frente al de la edificación, por lo que se diseña como componente no estructural (ASCE 7-05 §15.3.1 y §13.3).');
    kv([
      ['Peso de la valla Wp', `${f(c.Wp, 1)} kN`],
      ['Factor de amplificación ap', f(c.ap, 2), 'Tabla 13.5-1 (Signs and Billboards)'],
      ['Factor de modificación Rp', f(c.Rp, 2), 'Tabla 13.5-1'],
      ['Factor de importancia Ip', f(c.Ip, 2), '§13.1.3'],
      ['z (punto de apoyo) / h (altura de azotea)', `${f(c.z, 2)} m / ${f(c.h, 2)} m`],
      ['1 + 2·z/h', f(c.amp, 3)],
      ['Fp = 0.4·ap·SDS·Wp·(1 + 2z/h)/(Rp/Ip)', `${f(c.Fcalc, 2)} kN`, 'Ec. 13.3-1'],
      ['Fp máximo = 1.6·SDS·Ip·Wp', `${f(c.Fmax, 2)} kN`, 'Ec. 13.3-2'],
      ['Fp mínimo = 0.3·SDS·Ip·Wp', `${f(c.Fmin, 2)} kN`, 'Ec. 13.3-3'],
      ['Fp de diseño', `${f(c.Fp, 2)} kN (${f(c.Fp / c.Wp, 3)}·Wp)`, c.governs],
      ['Fuerza vertical concurrente ±0.2·SDS·Wp', `${f(c.Fv, 2)} kN`, '§13.3.1'],
      ['Momento de volteo en el apoyo (azotea)', `${f(c.Mbase, 1)} kN·m`],
      ['Período de la valla (informativo)', `${f(c.T, 3)} s`, c.Tsource],
    ]);
    table('Distribución de Fp proporcional al peso', ['Elemento', 'h sobre la azotea (m)', 'w (kN)', 'F (kN)', 'V (kN)'],
      [...c.levels].reverse().map((l) => [l.name, f(l.h, 2), f(l.w, 2), f(l.F, 2), f(l.Vstory, 2)]));
  } else h1('4. Fuerzas sísmicas – procedimiento de fuerza lateral equivalente');
  for (const [dir, r] of Object.entries(res.seismic.directions)) {
    if (res.typology === 'nave' && dir === 'Y' && res.seismic.directions.X.V === r.V) {
      para('En la dirección Y se usa el mismo sistema y período; el cortante basal es igual al de la dirección X.');
      continue;
    }
    h2(res.typology === 'generico' ? 'Análisis sísmico (aplica en X e Y)' : kind === 'building' ? `Dirección ${dir}` : 'Análisis sísmico');
    if (res.typology === 'valla') para('Valla a nivel de terreno: estructura no-edificio no similar a edificios (Tabla 15.4-2, "Signs and billboards"), con el cortante mínimo de REP-2021 §5.2.1. Las alturas se miden desde la base de los postes.');
    kv([
      ['Sistema resistente', r.system.label, kind === 'building' ? 'Tabla 12.2-1' : 'Tabla 15.4-2'],
      ['R / Ω0 / Cd', `${r.system.R} / ${r.system.Omega0} / ${r.system.Cd}`],
      ...(r.Ta != null ? [['Ta = Ct·hn^x', `${f(r.Ta, 3)} s`, 'Ec. 12.8-7'], ['Cu', f(r.Cu, 2), 'Tabla 12.8-1']] : []),
      ['Período usado T', `${f(r.T, 3)} s`, r.Tsource],
      ['Peso sísmico efectivo W', `${f(r.W, 1)} kN`, '§12.7.2'],
      ['Cs = SDS/(R/I)', f(r.csEq2, 4), 'Ec. 12.8-2'],
      ['Cs máximo', f(r.csMax, 4), r.T <= p.TL ? 'Ec. 12.8-3' : 'Ec. 12.8-4'],
      ['Cs mínimo REP = 0.044·SDS·I', f(r.csMinREP, 4), `REP-2021 §5.2.1 (≥ ${kind === 'building' ? REP.CS_MIN_BUILDING : REP.CS_MIN_NONBUILDING})`],
      ...(r.csMinS1 > 0 ? [['Cs mínimo por S1 ≥ 0.6', f(r.csMinS1, 4)]] : []),
      ['Cs de diseño', f(r.Cs, 4), r.governs],
      ['Cortante basal V = Cs·W', `${f(r.V, 1)} kN`, 'Ec. 12.8-1'],
      ['Exponente k', f(r.k, 3), '§12.8.3'],
      ['Momento de volteo en la base', `${f(r.Mbase, 1)} kN·m`],
      ['Efecto vertical Ev = 0.2·SDS·D', `${f(r.Ev, 3)}·D`, '§12.4.2.2'],
    ]);
    eq(`Fx = Cvx·V ;  Cvx = wx·hx^k / Σ(wi·hi^k) ;  k = ${f(r.k, 3)}`);
    table(`Distribución vertical de fuerzas sísmicas${kind === 'building' ? ` – dirección ${dir}` : ''}`,
      ['Nivel', 'h (m)', 'w (kN)', 'w·h^k', 'Cvx', 'Fx (kN)', 'Vx (kN)', 'Mx (kN·m)'],
      [...r.levels].reverse().map((l) => [l.name, f(l.h, 2), f(l.w, 1), f(l.w * Math.pow(l.h, r.k), 0), f(l.Cvx, 4), f(l.F, 2), f(l.Vstory, 2), f(l.Mot, 1)]));
  }

  // 5 ---------------------------------------------------------------------
  h1('5. Cargas de viento – ASCE 7-05 Cap. 6, Método 2');
  const ctx = res.wind.ctx;
  const ex = EXPOSURE[ctx.exposure];
  kv([
    ['Región (Tabla 4.1 REP-2021)', ctx.region === 'Pacifico' ? 'Pacífico' : 'Atlántico'],
    ['Período de retorno', `${ctx.returnPeriod} años`, 'REP-2021 §4.2'],
    ['Velocidad básica V (ráfaga 3 s, 10 m, exp. C)', `${f(ctx.Vkmh, 1)} km/h = ${f(ctx.V, 2)} m/s`, Math.abs(ctx.Vkmh - ctx.Vtable) > 0.05 ? `Mayor justificada (Tabla 4.1: ${ctx.Vtable} km/h)` : 'Tabla 4.1'],
    ['Factor de direccionalidad Kd', f(ctx.Kd, 2), 'Tabla 6-4'],
    ['Factor de importancia I', f(ctx.I, 2), 'Tabla 6-1'],
    ['Categoría de exposición', ctx.exposure, '§6.5.6.3'],
    ['α / zg', `${ex.alpha} / ${f(ex.zg, 1)} m`, 'Tabla 6-2'],
    ['Efecto topográfico', project.wind.topo.enabled ? `Sí (${TOPO_TYPES[project.wind.topo.type]}, H = ${project.wind.topo.H} m, Lh = ${project.wind.topo.Lh} m, x = ${project.wind.topo.x} m)` : 'No (Kzt = 1.0)', '§6.5.7'],
    ['Cerramiento / GCpi', `${ENCL[project.wind.enclosure]} / ±${f(GCPI[project.wind.enclosure], 2)}`, 'Fig. 6-5'],
  ]);
  eq('qz = 0.613·Kz·Kzt·Kd·V²·I  (N/m², V en m/s) – Ec. 6-15');
  para(`Según REP-2021 §4.2 las cargas de viento así obtenidas son de nivel de servicio. Límites de servicio (§4.3): desplazamiento en la azotea ≤ H/400, deriva de entrepiso ≤ h/300 y aceleración ≤ ${REP.ACCEL_MAX} m/s² (con viento de ${REP.WIND_SERVICE_RETURN} años de período de retorno).`);
  windSection(res, project, { h2, h3, kv, table, eq, para, note });

  // 6 ---------------------------------------------------------------------
  h1('6. Combinaciones de carga');
  para('REP-2021 §1.4.1 remite a las combinaciones del Capítulo 2 de ASCE/SEI 7-05.');
  h3('Resistencia (LRFD) – §2.3.2');
  B.push({ t: 'list', items: res.combos.lrfd });
  h3('Esfuerzos admisibles (ASD) – §2.4.1');
  B.push({ t: 'list', items: res.combos.asd });
  B.push({ t: 'list', items: res.combos.notes });

  // 7 ---------------------------------------------------------------------
  h1('7. Vistas del modelo');
  img(images.viewWind, 'Figura: cargas de viento sobre el modelo.');
  img(images.viewQuake, 'Figura: fuerzas sísmicas sobre el modelo.');
  img(images.profile, 'Figura: comparación de fuerzas de viento (servicio) y sismo (resistencia) por nivel.');

  // 8 ---------------------------------------------------------------------
  h1('8. Observaciones');
  if (res.warnings.length) for (const w of res.warnings) note(w, 'warn');
  else para('Sin observaciones adicionales sobre los datos de entrada.');
  note('Las fuerzas sísmicas están a nivel de resistencia (E = ρ·QE ± 0.2·SDS·D) y las de viento a nivel de servicio (REP-2021 §4.2). Compararlas directamente requiere aplicar los factores de las combinaciones de carga.');
  note('Este reporte es una herramienta de apoyo. El ingeniero responsable debe verificar los datos de entrada, la aplicabilidad de cada procedimiento y los resultados.');

  const typ = TYPOLOGIES[res.typology];
  return {
    fileName: `Memoria-cargas-${(m.nombre || 'proyecto').replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '').replace(/\s+/g, '_')}`,
    title: `Memoria de cálculo de cargas de viento y sismo`,
    subtitle: `${m.nombre} — ${typ} — REP-2021 / ASCE 7-05`,
    meta: [
      ['Proyecto', m.nombre], ['Cliente', m.cliente || '—'], ['Ubicación', m.ubicacion || '—'],
      ['Ingeniero responsable', m.ingeniero || '—'], ['Idoneidad', m.idoneidad || '—'], ['Fecha', m.fecha],
    ],
    engineer: m.ingeniero, license: m.idoneidad, date: m.fecha,
    blocks: B,
  };
}

function describeGeometry(res, project, kv, table) {
  const g = res.geometry;
  if (res.typology === 'edificio') {
    const e = project.edificio;
    kv([
      ['Dimensiones en planta', `${f(g.Bx, 2)} m (X) × ${f(g.By, 2)} m (Y)`],
      ['Número de pisos / altura total', `${e.nStories} / ${f(res.H, 2)} m`],
      ['Altura primer piso / típicos', `${f(e.firstStoryHeight, 2)} m / ${f(e.storyHeight, 2)} m`],
      ['Peso sísmico por piso / azotea', `${f(e.wFloor, 2)} / ${f(e.wRoof, 2)} kN/m²`],
    ]);
  } else if (res.typology === 'nave') {
    kv([
      ['Luz × longitud', `${f(g.span, 2)} m × ${f(g.length, 2)} m`],
      ['Altura al alero / cumbrera', `${f(g.he, 2)} m / ${f(g.hr, 2)} m`],
      ['Pendiente del techo θ', `${f(res.theta, 1)}°`],
      ['Altura media de techo h', `${f(res.h, 2)} m`, '§6.2'],
      ['Separación de marcos / n.º de marcos', `${f(g.s, 2)} m / ${g.nFrames}`],
    ]);
  } else if (res.typology === 'torre') {
    const t = project.torre;
    kv([
      ['Tipo', t.kind === 'celosia' ? `Celosía ${t.section === 'square' ? 'cuadrada' : 'triangular'}` : `Fuste ${{ round: 'circular', square: 'cuadrado', hex: 'hexagonal/octogonal' }[t.shape]}`],
      ['Altura', `${f(g.H, 2)} m`],
      ['Ancho base / punta', `${f(g.bBase, 2)} m / ${f(g.bTop, 2)} m`],
      ['Segmentos de cálculo', String(g.nSeg)],
    ]);
  } else if (res.typology === 'generico') {
    table('Volúmenes que componen la estructura', ['Volumen', 'Forma', 'Tipo', 'Dimensiones (m)', 'Cota base (m)', 'Centro X, Y (m)', 'W (kN)', 'Columnas'],
      g.volumes.map((v) => [v.name, v.shape === 'cyl' ? 'Cilindro' : 'Prisma', v.tipo === 'abierto' ? `Abierto ε = ${f(v.eps, 2)}` : 'Sólido',
        v.shape === 'cyl' ? `Ø${f(v.bx, 2)} × ${f(v.h, 2)}` : `${f(v.bx, 2)} × ${f(v.by, 2)} × ${f(v.h, 2)}`, f(v.z0, 2), `${f(v.x, 2)}, ${f(v.y, 2)}`, f(v.W, 1),
        v.nCols > 0 && v.z0 > 0 ? `${v.nCols} × Ø${f(v.dCol, 2)} m` : '—']));
    kv([['Altura total', `${f(g.top, 2)} m`]]);
  } else if (res.typology === 'valla') {
    const v = project.valla;
    kv([
      ['Apoyo', g.onRoof ? `Sobre la azotea de una edificación de ${g.nSt} niveles (azotea a ${f(g.Hb, 2)} m)` : 'A nivel de terreno'],
      ['Anuncio B × s', `${f(g.B, 2)} m × ${f(g.s, 2)} m (${v.panel === 'abierta' ? 'abierto' : 'sólido'}, ε = ${f(v.eps, 2)})`],
      ['Altura libre bajo el anuncio', `${f(g.c, 2)} m`],
      ['Borde superior sobre el terreno h', `${f(g.zt, 2)} m`],
      ['Soporte', g.direct ? 'Sin postes: anclada directamente a la estructura / apoyada como muro' : `${g.nP} poste(s) ${g.postShape === 'square' ? 'cuadrado(s) de' : 'Ø'} ${f(g.D, 2)} m`],
      ['Peso total de la valla', `${f(res.Wp, 1)} kN`],
    ]);
  } else if (res.typology === 'tanque') {
    kv([
      ['Diámetro / altura del tanque', `${f(g.D, 2)} m / ${f(g.Ht, 2)} m`],
      ['Altura de agua / volumen', `${f(g.Hw, 2)} m / ${f((Math.PI * g.D * g.D / 4) * g.Hw, 1)} m³`],
      ['Altura del soporte', `${f(g.Hs, 2)} m (${g.support === 'pedestal' ? 'pedestal' : `${g.nLegs} patas`})`],
      ['Peso del agua', `${f(res.Ww, 1)} kN`],
    ]);
  }
}

function gustRows(gust) {
  const rows = [
    ['Método', gust.method, '§6.5.8'],
    ['n1', `${f(gust.n1, 3)} Hz`],
    ['z̄ / Iz̄ / Lz̄', `${f(gust.zbar, 2)} m / ${f(gust.Iz, 4)} / ${f(gust.Lz, 1)} m`, 'Ec. 6-5, 6-7'],
    ['Q', f(gust.Q, 4), 'Ec. 6-6'],
  ];
  if (gust.flexible) rows.push(['V̄z̄ / N1 / R', `${f(gust.Vz, 2)} m/s / ${f(gust.N1, 3)} / ${f(gust.R, 4)}`, 'Ec. 6-10 a 6-14'], ['β', f(gust.beta, 3)]);
  rows.push(['G', f(gust.G, 3)]);
  return rows;
}

function windSection(res, project, { h2, h3, kv, table, eq, para, note }) {
  if (res.typology === 'edificio') {
    for (const [dir, d] of Object.entries(res.wind.directions)) {
      h2(`Viento en dirección ${dir}`);
      kv([
        ['Ancho expuesto B / profundidad L', `${f(d.B, 2)} m / ${f(d.L, 2)} m`],
        ['qh (z = h)', `${f(d.qh, 4)} kPa`, `Kh = ${f(d.Kzh, 3)}`],
        ['Cp barlovento / sotavento / lateral', `0.80 / ${f(d.cpLw, 2)} / −0.70`, 'Fig. 6-6'],
        ...gustRows(d.gust),
        ['Cortante basal', `${f(d.Vbase, 1)} kN`],
        ['Momento de volteo', `${f(d.Mbase, 1)} kN·m`],
        ['Carga mínima 0.48 kPa·B·H', `${f(d.Vmin, 1)} kN`, '§6.1.4.1'],
      ]);
      eq('F = G·[0.8·∫qz dz + |Cp,sot|·qh·Δh]·B  (fuerza neta de barlovento + sotavento por franja tributaria)');
      table(`Presiones y fuerzas de viento por nivel – dirección ${dir}`,
        ['Nivel', 'z (m)', 'Kz', 'Kzt', 'qz (kPa)', 'p barlov. (kPa)', 'p sotav. (kPa)', 'F (kN)', 'V (kN)', 'MT caso 2 (kN·m)'],
        [...d.rows].reverse().map((r, i, arr) => [r.name, f(r.h, 2), f(r.Kz, 3), f(r.Kzt, 3), f(r.qz, 4), f(r.pww, 3), f(r.plw, 3), f(r.F, 2), f(r.Vstory, 2), f(d.torsion[arr.length - 1 - i].MT, 1)]));
      table(`Presiones en techo (Cp de Fig. 6-6, viento ${dir}) – succión neta con +GCpi`,
        ['Zona desde el borde de barlovento', 'Cp', 'p ext. (kPa)', 'p neta (kPa)'],
        d.roofZones.map((z) => [`${f(z.x0, 1)} – ${f(z.x1, 1)} m`, f(z.A, 2), f(z.pA, 3), f(z.netUplift, 3)]));
    }
    para('MT caso 2: momento torsional de la Fig. 6-9 (75 % de la carga con excentricidad de 0.15·B).');
  } else if (res.typology === 'nave') {
    const w = res.wind;
    kv([
      ['Altura media de techo h', `${f(w.h, 2)} m`],
      ['qh / q al alero', `${f(w.qh, 4)} kPa / ${f(w.qe, 4)} kPa`],
      ['GCpi', `±${f(w.gcpi, 2)}`],
    ]);
    note('El muro de barlovento se evalúa con q a la altura del alero (valor máximo sobre el muro); el resto de superficies con qh.');
    for (const key of ['transversal', 'longitudinal']) {
      const d = w[key];
      h2(key === 'transversal' ? 'Viento normal a la cumbrera (transversal)' : 'Viento paralelo a la cumbrera (longitudinal)');
      kv([['B / L / h/L', `${f(d.B, 2)} m / ${f(d.L, 2)} m / ${f(w.h / d.L, 3)}`], ...gustRows(d.gust)]);
      eq('p = q·G·Cp − qh·(±GCpi) ;  w (marco) = p · separación');
      table('Presiones de diseño por superficie y cargas lineales en un marco interior',
        ['Superficie', 'Caso', 'Cp', 'p ext. (kPa)', 'p +GCpi (kPa)', 'p −GCpi (kPa)', 'w +GCpi (kN/m)', 'w −GCpi (kN/m)'],
        d.cases.map((c) => [c.surface, c.caseCp || '—', f(c.Cp, 2), f(c.pe, 3), f(c.pPos, 3), f(c.pNeg, 3), f(c.wPos, 2), f(c.wNeg, 2)]));
    }
    para('Signos: positivo = presión hacia la superficie; negativo = succión. Casos A/B: los dos valores de Cp que la Fig. 6-6 da para el techo de barlovento o las zonas del techo; ambos deben revisarse.');
  } else if (res.typology === 'torre') {
    const d = res.wind;
    kv([...gustRows(d.gust), ['Cortante basal', `${f(d.Vbase, 1)} kN`], ['Momento de volteo', `${f(d.Mbase, 1)} kN·m`]]);
    eq(project.torre.kind === 'celosia' ? 'F = qz·G·Cf·Af ;  Cf (cuadrada) = 4.0ε² − 5.9ε + 4.0 ; (triangular) = 3.4ε² − 4.7ε + 3.4 – Fig. 6-23' : 'F = qz·G·Cf·Af ;  Cf según Fig. 6-21');
    table('Fuerzas de viento por segmento',
      project.torre.kind === 'celosia' ? ['Segmento', 'z (m)', 'Kz', 'qz (kPa)', 'ε', 'Cf', 'Af (m²)', 'F (kN)', 'V (kN)'] : ['Segmento', 'z (m)', 'Kz', 'qz (kPa)', 'D (m)', 'Cf', 'Af (m²)', 'F (kN)', 'V (kN)'],
      [...d.segs].reverse().map((s) => [s.name, `${f(s.z0, 1)}–${f(s.z1, 1)}`, f(s.Kz, 3), f(s.qz, 4), project.torre.kind === 'celosia' ? f(s.eps, 3) : f(s.b, 2), f(s.Cf, 3), f(s.Af, 2), f(s.F, 2), f(s.Vstory, 2)]));
    if (d.appForces.length) table('Fuerzas sobre accesorios', ['Accesorio', 'z (m)', 'qz (kPa)', 'Cf·A (m²)', 'F (kN)'], d.appForces.map((a) => [a.name, f(a.z, 1), f(a.qz, 4), f(a.EPA, 2), f(a.F, 2)]));
  } else if (res.typology === 'generico') {
    para('Cada volumen se divide en franjas horizontales; la fuerza en cada franja es F = q̄z·G·Cf·Af (ASCE 7-05 §6.5.15). Cf: prismas sólidos y cilindros según Fig. 6-21 (h/D del volumen); volúmenes abiertos según Fig. 6-23 con la solidez ε. Las columnas de apoyo se evalúan como cilindros (Fig. 6-21).');
    for (const [dir, d] of Object.entries(res.wind.directions)) {
      h2(`Viento en dirección ${dir}`);
      kv([...gustRows(d.gust), ['Cortante basal', `${f(d.Vbase, 1)} kN`], ['Momento de volteo', `${f(d.Mbase, 1)} kN·m`], ['Carga mínima 0.48 kPa·A proyectada', `${f(d.Vmin, 1)} kN`, '§6.1.4.1']]);
      table(`Fuerzas de viento por franja – dirección ${dir}`, ['Volumen', 'z (m)', 'Kz', 'q̄z (kPa)', 'Kd', 'Cf', 'Af (m²)', 'F (kN)'],
        [...d.rows].reverse().map((r) => [r.vol, `${f(r.z0, 2)}–${f(r.z1, 2)}`, f(r.Kz, 3), f(r.qz, 4), f(r.Kd, 2), `${f(r.Cf, 3)} (${r.fig})`, f(r.Af, 2), f(r.F, 2)]));
      if (d.cols.length) table(`Columnas de apoyo – dirección ${dir}`, ['Volumen', 'Columnas', 'q̄z (kPa)', 'Cf', 'Af (m²)', 'F (kN)'], d.cols.map((c) => [c.vol, `${c.n} × Ø${f(c.d, 2)} m`, f(c.qz, 4), f(c.Cf, 3), f(c.Af, 2), f(c.F, 2)]));
    }
  } else if (res.typology === 'valla') {
    const d = res.wind;
    kv([
      ['h (borde superior sobre el terreno)', `${f(d.zt, 2)} m`, 'Fig. 6-20'],
      ['qh', `${f(d.qh, 4)} kPa`, `Kh = ${f(d.Kzh, 3)}`],
      ['s/h  ·  B/s', `${f(d.sh, 3)}  ·  ${f(d.Bs, 2)}`],
      ...gustRows(d.gust),
      ...(d.solid ? [['Cf casos A y B', f(d.CfAB, 3), 'Fig. 6-20'], ['Factor por aberturas (1 − (1 − ε)^1.5)', f(d.openings, 3), 'Fig. 6-20 Nota 2']] : [['Cf anuncio abierto', f(d.open.Cf, 2), 'Fig. 6-22'], ['Área sólida Af = ε·B·s', `${f(d.open.Af, 2)} m²`]]),
    ]);
    eq(d.solid ? 'F = qh·G·Cf·As  (ASCE 7-05 §6.5.14)' : 'F = qz·G·Cf·Af  (ASCE 7-05 §6.5.15, qz en el centroide)');
    table('Casos de carga de viento sobre el anuncio', ['Caso', 'F (kN)', 'z de la resultante (m)', 'Excentricidad horizontal (m)', 'Torsión (kN·m)'],
      d.cases.map((c) => [c.name, f(c.F, 2), f(c.z, 2), f(c.ex, 2), f(c.MT, 1)]));
    if (d.caseC) {
      table(`Caso C – regiones desde el borde de barlovento (factor (1.8 − s/h) = ${f(d.caseC.reduction, 3)})`, ['Región', 'Cf tabla', 'Cf neto', 'F (kN)'],
        d.caseC.regions.map((r) => [`${f(r.x0, 2)} – ${f(r.x1, 2)} m${r.starred ? ' *' : ''}`, f(r.Cf, 3), f(r.Cfnet, 3), f(r.F, 2)]));
      if (project.valla.Lr > 0) para('* Valor reducido por esquina de retorno (Fig. 6-20).');
    }
    if (d.posts.n > 0) table('Viento sobre los postes expuestos (Fig. 6-21)', ['Elemento', 'q̄z (kPa)', 'Cf', 'Af (m²)', 'F (kN)'], [[`${d.posts.n} poste(s) Ø/lado ${f(d.posts.D, 2)} m`, f(d.posts.q, 4), f(d.posts.Cf, 3), f(d.posts.Af, 2), f(d.posts.F, 2)]]);
    kv([
      ['Caso que gobierna (fuerza)', d.governing],
      ['Cortante en la base de la valla', `${f(d.Vbase, 2)} kN`],
      ['Momento de volteo en la base', `${f(d.Mbase, 1)} kN·m`],
      ['Torsión máxima (casos B/C)', `${f(d.MTmax, 1)} kN·m`],
      ['Carga mínima 0.48 kPa sobre el área proyectada', `${f(d.Vmin, 1)} kN`, '§6.1.4.1'],
    ]);
    if (d.Hb > 0) para('Para la valla sobre la azotea, h y s/h se miden desde el terreno y qh se evalúa en el borde superior del anuncio (criterio conservador; ASCE 7-05 no trata explícitamente los anuncios sobre techos).');
  } else if (res.typology === 'tanque') {
    const d = res.wind;
    kv([...gustRows(d.gust), ['Cortante basal', `${f(d.Vbase, 1)} kN`], ['Momento de volteo', `${f(d.Mbase, 1)} kN·m`]]);
    eq('F = q̄z·G·Cf·Af ;  Cf según Fig. 6-21 (sección circular)');
    table('Fuerzas de viento por componente', ['Componente', 'z (m)', 'q̄z (kPa)', 'Cf', 'Af (m²)', 'F (kN)'], d.parts.map((x) => [x.name, f(x.z, 2), f(x.q, 4), f(x.Cf, 3), f(x.Af, 2), f(x.F, 2)]));
  }
}
