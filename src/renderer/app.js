// Controlador principal de la interfaz.
import { compute, defaultProject, TYPOLOGIES } from '../calc/typologies.js';
import { lookup } from '../calc/maplookup.js';
import { basicWindSpeed } from '../calc/rep.js';
import { Kzt } from '../calc/wind.js';
import { SECTIONS, renderFields, renderVolumes } from './forms.js';
import { Viewer } from './viewer3d.js';
import { MapView } from './mapview.js';
import { spectrumSVG, attachSpectrumHover, profileSVG, svgToPng } from './charts.js';
import { buildReportModel } from './report-model.js';

const $ = (s) => document.querySelector(s);
const f = (x, n = 2) => (x == null || Number.isNaN(+x) ? '—' : (+x).toFixed(n));

const state = {
  project: defaultProject(),
  filePath: null,
  res: null,
  error: null,
  loadCase: null,
  dirty: false,
};

let viewer;
let mapView;
let grid;

// ------------------------------------------------------------------ inicio
async function init() {
  const [g, bm] = await Promise.all([window.api.readData('rep-maps/grid.json'), window.api.readData('basemap.json')]);
  grid = JSON.parse(g);
  viewer = new Viewer($('#viewer'));
  mapView = new MapView($('#mapview'), { grid, basemap: JSON.parse(bm), onPick: onMapPick });
  bindUi();
  applyMapAtSite(false);
  renderAllForms();
  recompute(true);
  const st = await window.api.selftest.config();
  if (st) selfTest(st).catch((e) => window.api.selftest.log('ERROR ' + e.stack).then(() => window.api.selftest.done()));
}

function bindUi() {
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#btnGoMap').addEventListener('click', () => showTab('mapa'));
  $('#btnNew').addEventListener('click', newProject);
  $('#btnOpen').addEventListener('click', openProject);
  $('#btnSave').addEventListener('click', () => saveProject(false));
  $('#btnDocx').addEventListener('click', () => exportReport('docx'));
  $('#btnPdf').addEventListener('click', () => exportReport('pdf'));
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => viewer.setView(b.dataset.view)));
  $('#optLabels').addEventListener('change', (e) => {
    viewer.showLabels = e.target.checked;
    applyLoadCase();
  });
  $('#optInternal').addEventListener('change', applyLoadCase);
  $('#optRoof').addEventListener('change', applyLoadCase);
  window.api.onMenu((ch) => ({ new: newProject, open: openProject, save: () => saveProject(false), saveAs: () => saveProject(true), docx: () => exportReport('docx'), pdf: () => exportReport('pdf') }[ch]?.()));
}

function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => (p.hidden = p.dataset.panel !== name));
  if (name === 'mapa') {
    mapView.draw();
    mapView.showSheet();
  }
  if (name === 'modelo') viewer.resize();
}

// ------------------------------------------------------------------ formularios
function renderAllForms() {
  const p = state.project;
  const onChange = (path, rerender) => {
    state.dirty = true;
    if (path === 'site.Ss' || path === 'site.S1') {
      p.site.source = 'manual';
      p.site.mapDistKm = 0;
      renderSiteSource();
    }
    if (path === 'meta.nombre') $('#projectName').textContent = p.meta.nombre || 'Proyecto nuevo';
    if (rerender || path === 'typology') renderAllForms();
    recompute(path === 'typology');
  };
  renderFields($('#secProyecto'), SECTIONS.proyecto, p, onChange);
  renderFields($('#secSitio'), SECTIONS.sitio, p, onChange);
  renderFields($('#secViento'), SECTIONS.viento, p, onChange);
  renderFields($('#secTipo'), SECTIONS.estructura.common, p, onChange);
  renderFields($('#secEstructura'), SECTIONS.estructura[p.typology], p, onChange);
  renderAppurtenances();
  renderSiteSource();
  $('#projectName').textContent = p.meta.nombre || 'Proyecto nuevo';
}

function renderAppurtenances() {
  const wrap = $('#appWrap');
  const p = state.project;
  if (p.typology === 'generico') {
    return renderVolumes(wrap, p, (rerender) => {
      state.dirty = true;
      if (rerender) renderAppurtenances();
      recompute();
    });
  }
  if (p.typology !== 'torre') return (wrap.innerHTML = '');
  const list = p.torre.appurtenances;
  wrap.innerHTML = `<div class="app-list"><div class="app-row app-head"><span>Accesorio</span><span>z (m)</span><span>Cf·A (m²)</span><span>W (kN)</span><span></span></div>
    ${list.map((a, i) => `<div class="app-row" data-i="${i}"><input data-k="name" value="${a.name}" aria-label="Nombre"><input data-k="z" type="number" value="${a.z}" aria-label="Altura"><input data-k="epa" type="number" value="${a.epa}" aria-label="Área efectiva"><input data-k="w" type="number" value="${a.w}" aria-label="Peso"><button class="icon-btn" data-del="${i}" aria-label="Quitar accesorio">×</button></div>`).join('')}
    <button class="btn small" id="addApp">Agregar accesorio</button></div>`;
  wrap.querySelectorAll('.app-row[data-i] input').forEach((inp) => inp.addEventListener('input', () => {
    const a = list[+inp.closest('.app-row').dataset.i];
    a[inp.dataset.k] = inp.type === 'number' ? Number(inp.value) : inp.value;
    recompute();
  }));
  wrap.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    list.splice(+b.dataset.del, 1);
    renderAppurtenances();
    recompute();
  }));
  $('#addApp').addEventListener('click', () => {
    list.push({ name: 'Antena', z: p.torre.H * 0.9, epa: 1.0, w: 1.0 });
    renderAppurtenances();
    recompute();
  });
}

function renderSiteSource() {
  const s = state.project.site;
  const el = $('#siteSource');
  if (s.source === 'mapa') {
    el.innerHTML = `Ss y S1 tomados del mapa REP en <strong>${f(s.lat, 4)}° N, ${f(Math.abs(s.lon), 4)}° O</strong> (contorno a ${s.mapDistKm} km). Si los editas pasan a ser valores manuales.`;
  } else {
    el.innerHTML = `Ss y S1 <strong>manuales</strong>. Usa el mapa REP para obtenerlos según la ubicación.`;
  }
}

function onMapPick(r) {
  const s = state.project.site;
  s.lat = +r.lat.toFixed(5);
  s.lon = +r.lon.toFixed(5);
  if (r.status !== 'fuera') {
    s.Ss = r.Ss;
    s.S1 = r.S1;
    s.source = 'mapa';
    s.mapDistKm = r.distKm;
    toast(`Ss = ${r.Ss.toFixed(2)} g y S1 = ${r.S1.toFixed(2)} g tomados del mapa.`);
  } else {
    s.source = 'manual';
    s.mapDistKm = r.distKm;
    toast('Punto sin cobertura en los mapas REP-2014: ingresa Ss y S1 manualmente.');
  }
  state.dirty = true;
  renderAllForms();
  recompute();
}

function applyMapAtSite(emit) {
  const s = state.project.site;
  if (s.lat && s.lon) mapView.setPoint(s.lon, s.lat, !emit);
}

// ------------------------------------------------------------------ cálculo
let pending = null;
function recompute(resetCamera = false) {
  clearTimeout(pending);
  pending = setTimeout(() => doCompute(resetCamera), 60);
}

function doCompute(resetCamera) {
  try {
    state.res = compute(state.project);
    state.error = null;
  } catch (e) {
    state.res = null;
    state.error = e.message;
  }
  renderWindV();
  renderSummary();
  if (!state.res) return;
  viewer.setModel(state.res);
  applyTerrain();
  if (resetCamera || state.topoKey !== topoKey()) viewer.resetCamera();
  state.topoKey = topoKey();
  renderLoadCases();
  applyLoadCase();
  renderSpectrum();
  renderTables();
}

function topoKey() {
  const t = state.project.wind.topo;
  return t.enabled ? `${t.type}|${t.H}|${t.Lh}|${t.x}` : 'off';
}

function applyTerrain() {
  const t = state.project.wind.topo;
  const H = state.res.H;
  const exp = state.project.wind.exposure;
  viewer.setTerrain(t, { kztBase: Kzt(0, exp, t), kztTop: Kzt(H, exp, t) });
  $('#btnSite').hidden = !(t.enabled && +t.H > 0 && +t.Lh > 0);
}

function renderWindV() {
  const w = state.project.wind;
  const b = basicWindSpeed(w.region, +w.returnPeriod);
  $('#windV').innerHTML = w.Voverride ? `V = <strong>${f(w.Voverride, 1)} km/h</strong> (mayor justificada; Tabla 4.1 da ${b.kmh} km/h)` : `V = <strong>${b.kmh} km/h</strong> (${f(b.ms, 2)} m/s), Tabla 4.1 REP-2021, ${w.returnPeriod} años`;
}

function loadCaseList(res) {
  switch (res.typology) {
    case 'edificio': return [['wx', 'Viento X', 'wind'], ['wy', 'Viento Y', 'wind'], ['sx', 'Sismo X', 'quake'], ['sy', 'Sismo Y', 'quake']];
    case 'nave': return [['wt', 'Viento transversal', 'wind'], ['wl', 'Viento longitudinal', 'wind'], ['sx', 'Sismo X', 'quake'], ['sy', 'Sismo Y', 'quake']];
    case 'generico': return [['wx', 'Viento X', 'wind'], ['wy', 'Viento Y', 'wind'], ['s', 'Sismo', 'quake']];
    case 'valla': return [['wA', 'Viento casos A/B', 'wind'], ...(res.wind.caseC ? [['wC', 'Viento caso C', 'wind']] : []), ['s', 'Sismo', 'quake']];
    default: return [['w', 'Viento', 'wind'], ['s', 'Sismo', 'quake']];
  }
}

function renderLoadCases() {
  const list = loadCaseList(state.res);
  if (!list.find((l) => l[0] === state.loadCase)) state.loadCase = list[0][0];
  const el = $('#loadCases');
  el.innerHTML = list.map(([k, label, cls]) => `<button class="${cls} ${k === state.loadCase ? 'on' : ''}" data-lc="${k}" role="radio" aria-checked="${k === state.loadCase}">${label}</button>`).join('');
  el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    state.loadCase = b.dataset.lc;
    renderLoadCases();
    applyLoadCase();
  }));
  $('#naveOpts').hidden = !(state.res.typology === 'nave' && state.loadCase.startsWith('w'));
}

function applyLoadCase() {
  if (!state.res) return;
  viewer.setLoadCase(state.loadCase, { internal: $('#optInternal').value, roofCase: $('#optRoof').value });
  const r = state.res;
  const lc = state.loadCase;
  let txt = '';
  if (r.typology === 'edificio') {
    const dir = lc.endsWith('x') ? 'X' : 'Y';
    txt = lc.startsWith('w') ? `Viento ${dir} (servicio): cortante basal <b>${f(r.wind.directions[dir].Vbase, 1)} kN</b>, G = ${f(r.wind.directions[dir].G, 3)}` : `Sismo ${dir} (resistencia): V = <b>${f(r.seismic.directions[dir].V, 1)} kN</b>, Cs = ${f(r.seismic.directions[dir].Cs, 4)}`;
  } else if (r.typology === 'nave') {
    txt = lc.startsWith('w') ? `Presión neta por superficie (kPa). Azul = presión, morado = succión. GCpi ${$('#optInternal').value === 'pos' ? '+' : '−'}${f(r.wind.gcpi, 2)}` : `Sismo: V = <b>${f(r.seismic.directions.X.V, 1)} kN</b> (≈ ${f(r.seismic.perFrame, 1)} kN por marco interior)`;
  } else if (r.typology === 'generico') {
    const d = r.wind.directions[lc === 'wy' ? 'Y' : 'X'];
    const sx = r.seismic.directions.X;
    txt = lc.startsWith('w') ? `Viento ${lc === 'wy' ? 'Y' : 'X'} (servicio): cortante basal <b>${f(d.Vbase, 1)} kN</b>, momento <b>${f(d.Mbase, 1)} kN·m</b>, G = ${f(d.G, 3)}` : `Sismo: V = <b>${f(sx.V, 1)} kN</b>, Cs = ${f(sx.Cs, 4)}, T = ${f(sx.T, 3)} s (aplica en X e Y)`;
  } else if (r.typology === 'valla') {
    const sm = seismicMain(r);
    txt = lc.startsWith('w')
      ? `Viento (servicio): gobierna ${r.wind.governing}; cortante en la base de la valla <b>${f(r.wind.Vbase, 1)} kN</b>, momento <b>${f(r.wind.Mbase, 1)} kN·m</b>, torsión máx. ${f(r.wind.MTmax, 1)} kN·m`
      : r.seismic.component ? `Sismo (Cap. 13): Fp = <b>${f(sm.V, 1)} kN</b> = ${f(sm.V / r.Wp, 3)}·Wp` : `Sismo: V = <b>${f(sm.V, 1)} kN</b>, T = ${f(sm.T, 3)} s`;
  } else {
    txt = lc === 'w' ? `Viento: cortante basal <b>${f(r.wind.Vbase, 1)} kN</b>, momento <b>${f(r.wind.Mbase, 1)} kN·m</b>` : `Sismo: V = <b>${f(r.seismic.directions.X.V, 1)} kN</b>, T = ${f(r.seismic.directions.X.T, 3)} s`;
  }
  $('#viewerLegend').innerHTML = txt;
}

/** Resultado sísmico principal (FLE en X, o fuerza de componente para valla en azotea). */
function seismicMain(r) {
  return r.seismic.directions.X || r.seismic.component;
}

// ------------------------------------------------------------------ resumen
function renderSummary() {
  const el = $('#summary');
  const s = state.project.site;
  if (!state.res) {
    el.innerHTML = `<h3>No se pudo calcular</h3><ul class="warnings"><li>${state.error}</li></ul>`;
    return;
  }
  const r = state.res;
  const p = r.seismic.params;
  const sx = seismicMain(r);
  const sy = r.seismic.directions.Y;
  let windK = '';
  if (r.typology === 'edificio') {
    windK = `<div class="kpi wind"><div class="v">${f(r.wind.directions.X.Vbase, 0)}</div><div class="l">kN · viento X</div></div>
             <div class="kpi wind"><div class="v">${f(r.wind.directions.Y.Vbase, 0)}</div><div class="l">kN · viento Y</div></div>`;
  } else if (r.typology === 'nave') {
    const maxUp = Math.min(...r.wind.transversal.cases.concat(r.wind.longitudinal.cases).filter((c) => c.surface.startsWith('Techo')).flatMap((c) => [c.pPos, c.pNeg]));
    windK = `<div class="kpi wind full"><div class="v">${f(maxUp, 2)}</div><div class="l">kPa · succión neta máxima en techo</div></div>`;
  } else if (r.typology === 'generico') {
    windK = `<div class="kpi wind"><div class="v">${f(r.wind.directions.X.Vbase, 1)}</div><div class="l">kN · viento X</div></div>
             <div class="kpi wind"><div class="v">${f(r.wind.directions.Y.Vbase, 1)}</div><div class="l">kN · viento Y</div></div>`;
  } else if (r.typology === 'valla') {
    windK = `<div class="kpi wind"><div class="v">${f(r.wind.Vbase, 1)}</div><div class="l">kN · cortante por viento</div></div>
             <div class="kpi wind"><div class="v">${f(r.wind.Mbase, 0)}</div><div class="l">kN·m · volteo por viento</div></div>`;
  } else {
    windK = `<div class="kpi wind"><div class="v">${f(r.wind.Vbase, 0)}</div><div class="l">kN · cortante por viento</div></div>
             <div class="kpi wind"><div class="v">${f(r.wind.Mbase, 0)}</div><div class="l">kN·m · volteo por viento</div></div>`;
  }
  const quakeK = sy && r.typology === 'edificio'
    ? `<div class="kpi quake"><div class="v">${f(sx.V, 0)}</div><div class="l">kN · sismo X</div></div><div class="kpi quake"><div class="v">${f(sy.V, 0)}</div><div class="l">kN · sismo Y</div></div>`
    : r.seismic.component
      ? `<div class="kpi quake"><div class="v">${f(sx.V, 1)}</div><div class="l">kN · Fp (Cap. 13)</div></div><div class="kpi quake"><div class="v">${f(sx.V / r.Wp, 3)}</div><div class="l">Fp / Wp</div></div>`
      : `<div class="kpi quake"><div class="v">${f(sx.V, r.typology === 'valla' ? 1 : 0)}</div><div class="l">kN · cortante sísmico</div></div><div class="kpi quake"><div class="v">${f(sx.Cs, 4)}</div><div class="l">Cs</div></div>`;
  el.innerHTML = `
    <h3>Sitio</h3>
    <div class="tags"><span class="tag">Ss ${f(s.Ss, 2)} g</span><span class="tag">S1 ${f(s.S1, 2)} g</span><span class="tag">Clase ${p.siteClass}</span></div>
    <h3>Diseño sísmico</h3>
    <dl class="plist">
      <dt>SDS / SD1</dt><dd>${f(p.SDS, 3)} / ${f(p.SD1, 3)} g</dd>
      <dt>Fa / Fv</dt><dd>${f(p.Fa, 2)} / ${f(p.Fv, 2)}</dd>
      <dt>I sísmico</dt><dd>${f(p.I, 2)}</dd>
      <dt>Categoría de diseño</dt><dd><span class="sdc">${p.sdc}</span></dd>
      <dt>T usado</dt><dd>${f(sx.T, 3)} s</dd>
    </dl>
    <h3>Cortantes en la base</h3>
    <div class="kpis">${quakeK}${windK}</div>
    <h3>Viento</h3>
    <dl class="plist">
      <dt>V de diseño</dt><dd>${f(r.wind.ctx.Vkmh, 1)} km/h</dd>
      <dt>Exposición / Kd / I</dt><dd>${r.wind.ctx.exposure} / ${f(r.wind.ctx.Kd, 2)} / ${f(r.wind.ctx.I, 2)}</dd>
      ${state.project.wind.topo.enabled ? `<dt>Kzt base / cima</dt><dd>${f(Kzt(0, r.wind.ctx.exposure, state.project.wind.topo), 2)} / ${f(Kzt(r.H, r.wind.ctx.exposure, state.project.wind.topo), 2)}</dd>` : ''}
    </dl>
    ${r.warnings.length ? `<h3>Revisar</h3><ul class="warnings">${r.warnings.map((w) => `<li>${w}</li>`).join('')}</ul>` : ''}`;
}

// ------------------------------------------------------------------ espectro y tablas
function spectrumMarkers(r) {
  if (r.typology === 'edificio') {
    const a = r.seismic.directions.X;
    const b = r.seismic.directions.Y;
    return Math.abs(a.T - b.T) < 1e-6 ? [{ T: a.T, label: 'X, Y' }] : [{ T: a.T, label: 'X' }, { T: b.T, label: 'Y' }];
  }
  return [{ T: seismicMain(r).T, label: 'T' }];
}

function renderSpectrum() {
  const r = state.res;
  const svg = spectrumSVG(r.seismic.params, spectrumMarkers(r), { w: 900, h: 440 });
  const wrap = $('#spectrum');
  wrap.innerHTML = svg;
  attachSpectrumHover(wrap.querySelector('svg'), r.seismic.params, document.querySelector('.chart-tip'));
}

function profileRows(r) {
  if (r.typology === 'edificio') {
    return r.seismic.directions.X.levels.map((l, i) => ({ name: l.name, quake: l.F, wind: r.wind.directions.X.rows[i].F }));
  }
  if (r.typology === 'torre') {
    return r.wind.segs.map((s) => {
      const lv = r.seismic.directions.X.levels.find((l) => l.name === s.name);
      return { name: s.name, wind: s.F, quake: lv ? lv.F : 0 };
    });
  }
  if (r.typology === 'tanque') {
    return [
      { name: 'Soporte', wind: r.wind.parts[1].F, quake: r.seismic.directions.X.levels[0].F },
      { name: 'Tanque', wind: r.wind.parts[0].F, quake: r.seismic.directions.X.levels[1].F },
    ];
  }
  return null;
}

function renderTables() {
  const r = state.res;
  // Reutiliza el modelo de reporte (sin imágenes) para mostrar todas las tablas en pantalla.
  const model = buildReportModel(state.project, r, {});
  const html = [];
  const rows = profileRows(r);
  if (rows) html.push(`<h2>Fuerzas por nivel: viento X frente a sismo X</h2><div class="chart-wrap">${profileSVG(rows, { w: 900, windLabel: 'Viento (servicio)', quakeLabel: 'Sismo (resistencia)' })}</div>`);
  for (const b of model.blocks) {
    if (b.t === 'h1') html.push(`<h2>${b.text}</h2>`);
    else if (b.t === 'h2' || b.t === 'h3') html.push(`<h3>${b.text}</h3>`);
    else if (b.t === 'kv') html.push(`<table><tbody>${b.rows.map((x) => `<tr><td>${x[0]}</td><td>${x[1]}</td><td class="muted">${x[2] ?? ''}</td></tr>`).join('')}</tbody></table>`);
    else if (b.t === 'table') html.push(`${b.caption ? `<h3>${b.caption}</h3>` : ''}<table><thead><tr>${b.head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${b.rows.map((x) => `<tr>${x.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    else if (b.t === 'eq') html.push(`<p class="muted">${b.text}</p>`);
    else if (b.t === 'list') html.push(`<ul>${b.items.map((i) => `<li>${i}</li>`).join('')}</ul>`);
    else if (b.t === 'note') html.push(`<p class="warn">${b.text}</p>`);
    else if (b.t === 'p') html.push(`<p>${b.text}</p>`);
  }
  $('#tables').innerHTML = html.join('');
}

// ------------------------------------------------------------------ archivos
function newProject() {
  if (state.dirty && !confirm('¿Descartar los cambios no guardados?')) return;
  state.project = defaultProject();
  state.filePath = null;
  state.dirty = false;
  applyMapAtSite(false);
  renderAllForms();
  recompute(true);
}

async function openProject() {
  const r = await window.api.openProject();
  if (!r) return;
  try {
    const data = JSON.parse(r.content);
    state.project = mergeDeep(defaultProject(), data);
    state.filePath = r.path;
    state.dirty = false;
    applyMapAtSite(false);
    renderAllForms();
    recompute(true);
    toast('Proyecto abierto.');
  } catch (e) {
    toast('El archivo no es un proyecto válido: ' + e.message);
  }
}

async function saveProject(as) {
  const p = await window.api.saveProject({ content: JSON.stringify(state.project, null, 2), filePath: as ? null : state.filePath, suggestedName: state.project.meta.nombre });
  if (p) {
    state.filePath = p;
    state.dirty = false;
    toast('Proyecto guardado.');
  }
}

function mergeDeep(base, over) {
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') mergeDeep(base[k], v);
    else base[k] = v;
  }
  return base;
}

// ------------------------------------------------------------------ reporte
async function collectImages() {
  const r = state.res;
  const images = {};
  const prevCase = state.loadCase;
  const prevTab = document.querySelector('.tabs button[aria-selected=true]').dataset.tab;
  showTab('modelo');
  await new Promise((ok) => requestAnimationFrame(ok));
  const cases = loadCaseList(r);
  const wCase = cases.find((c) => c[2] === 'wind')[0];
  const sCase = cases.find((c) => c[2] === 'quake')[0];
  viewer.resetCamera();
  viewer.controls.update();
  for (const [key, lc] of [['viewWind', wCase], ['viewQuake', sCase]]) {
    state.loadCase = lc;
    applyLoadCase();
    images[key] = { data: viewer.snapshot(1400, 840), ratio: 0.6 };
  }
  state.loadCase = prevCase;
  renderLoadCases();
  applyLoadCase();
  showTab(prevTab);
  images.spectrum = await svgToPng(spectrumSVG(r.seismic.params, spectrumMarkers(r), { w: 900, h: 440 }));
  const rows = profileRows(r);
  if (rows) images.profile = await svgToPng(profileSVG(rows, { w: 900, windLabel: 'Viento (servicio)', quakeLabel: 'Sismo (resistencia)' }));
  if (state.project.site.source === 'mapa') {
    const a = await mapView.sheetCrop('Ss');
    const b = await mapView.sheetCrop('S1');
    if (a) images.mapSs = { ...a, ratio: 1 };
    if (b) images.mapS1 = { ...b, ratio: 1 };
  }
  return images;
}

async function exportReport(kind) {
  if (!state.res) return toast('Corrige los datos antes de exportar.');
  toast(kind === 'docx' ? 'Generando el reporte Word…' : 'Generando el reporte PDF…');
  try {
    const images = await collectImages();
    const model = buildReportModel(state.project, state.res, images);
    const out = kind === 'docx' ? await window.api.exportDocx(model) : await window.api.exportPdf(model);
    if (out) toast(`Reporte guardado en ${out}`, () => window.api.openPath(out));
    else hideToast();
    return out;
  } catch (e) {
    toast('No se pudo exportar el reporte: ' + e.message);
    throw e;
  }
}

// ------------------------------------------------------------------ avisos
let toastTimer;
function toast(msg, onOpen) {
  const t = $('#toast');
  t.innerHTML = '';
  t.append(msg);
  if (onOpen) {
    const b = document.createElement('button');
    b.textContent = 'Abrir';
    b.onclick = onOpen;
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, onOpen ? 8000 : 3500);
}
function hideToast() {
  $('#toast').hidden = true;
}

// ------------------------------------------------------------------ autoprueba (FC_SELFTEST)
function r0(r) {
  return r.wind.directions ? r.wind.directions.X.Vbase : r.wind.Vbase;
}

async function selfTest() {
  const log = (m) => window.api.selftest.log(m);
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  await document.fonts.ready;
  await wait(800);
  // ubicar en Ciudad de Panamá desde el mapa
  mapView.pick(-79.535, 8.952);
  await wait(400);
  await log(`site ${JSON.stringify(state.project.site)}`);
  for (const variant of [...Object.keys(TYPOLOGIES), 'valla-azotea']) {
    const typ = variant.split('-')[0];
    state.project.typology = typ;
    state.project.valla.apoyo = variant === 'valla-azotea' ? 'azotea' : 'terreno';
    if (variant === 'valla-azotea') state.project.valla.clearance = 2;
    state.project.meta.nombre = `Prueba ${variant}`;
    renderAllForms();
    doCompute(true);
    await wait(600);
    const r = state.res;
    await log(`${variant}: Vsismo=${f(seismicMain(r).V, 1)} warnings=${r.warnings.length}`);
    for (const lc of loadCaseList(r)) {
      state.loadCase = lc[0];
      renderLoadCases();
      applyLoadCase();
      await wait(350);
      await window.api.selftest.capture(`${variant}-${lc[0]}`);
    }
    for (const tab of ['mapa', 'espectro', 'tablas']) {
      if (typ !== 'edificio' && tab === 'mapa') continue;
      showTab(tab);
      await wait(500);
      await window.api.selftest.capture(`${variant}-tab-${tab}`);
    }
    showTab('modelo');
    const d = await exportReport('docx');
    const p = await exportReport('pdf');
    await log(`${variant}: docx=${d} pdf=${p}`);
  }
  // escenarios topográficos
  const topoCases = [
    ['edificio', { enabled: true, type: 'escarp2D', H: 35, Lh: 30, x: 15 }, 'acantilado'],
    ['torre', { enabled: true, type: 'hill3D', H: 60, Lh: 120, x: 0 }, 'colina'],
  ];
  for (const [typ, topo, name] of topoCases) {
    state.project.typology = typ;
    state.project.wind.topo = topo;
    state.project.meta.nombre = `Prueba ${typ} ${name}`;
    renderAllForms();
    doCompute(true);
    state.loadCase = loadCaseList(state.res)[0][0];
    renderLoadCases();
    applyLoadCase();
    await wait(500);
    await window.api.selftest.capture(`topo-${name}`);
    viewer.setView('site');
    await wait(500);
    await window.api.selftest.capture(`topo-${name}-sitio`);
    await log(`topo ${name}: Kzt base=${f(Kzt(0, 'C', topo), 3)} Vviento=${f(r0(state.res), 1)}`);
    if (name === 'acantilado') await exportReport('pdf');
  }
  state.project.wind.topo = { enabled: false, type: 'hill3D', H: 0, Lh: 0, x: 0 };
  await log('OK');
  await window.api.selftest.done();
}

init();
