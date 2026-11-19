// Esquemas de formularios ligados al objeto de proyecto por rutas ("wind.exposure").
import { BUILDING_SYSTEMS, NONBUILDING_SYSTEMS } from '../calc/systems.js';
import { SITE_CLASSES, PERIOD_TYPES } from '../calc/seismic.js';
import { TYPOLOGIES } from '../calc/typologies.js';
import { TOPO_TYPES } from '../calc/wind.js';

const opts = (o) => Object.entries(o).map(([value, label]) => ({ value, label }));
const sysOpts = (list) => list.map((s) => ({ value: s.id, label: `${s.label} (R=${s.R})`, group: s.group }));

export const OCCUPANCY = [
  { value: 'I', label: 'I – Bajo riesgo para la vida (agrícolas, temporales)' },
  { value: 'II', label: 'II – Ocupación normal' },
  { value: 'III', label: 'III – Gran número de ocupantes / escuelas' },
  { value: 'IV', label: 'IV – Esenciales (hospitales, bomberos, tanques de agua para incendio)' },
];

export const SECTIONS = {
  proyecto: [
    { path: 'meta.nombre', label: 'Nombre del proyecto', type: 'text' },
    { path: 'meta.cliente', label: 'Cliente / propietario', type: 'text' },
    { path: 'meta.ubicacion', label: 'Ubicación (descripción)', type: 'text' },
    { path: 'meta.ingeniero', label: 'Ingeniero responsable', type: 'text' },
    { path: 'meta.idoneidad', label: 'N.º de idoneidad', type: 'text' },
    { path: 'meta.fecha', label: 'Fecha', type: 'date' },
    { path: 'meta.notas', label: 'Notas para el reporte', type: 'textarea' },
  ],
  sitio: [
    { path: 'site.occupancy', label: 'Categoría de ocupación (Tabla 1-1)', type: 'select', options: OCCUPANCY },
    { path: 'site.siteClass', label: 'Clase de sitio (Cap. 20)', type: 'select', options: opts(SITE_CLASSES) },
    { path: 'site.Ss', label: 'Ss', unit: 'g', type: 'number', step: 0.01, tag: true },
    { path: 'site.S1', label: 'S1', unit: 'g', type: 'number', step: 0.01, tag: true },
  ],
  viento: [
    { path: 'wind.region', label: 'Región (Tabla 4.1 REP)', type: 'select', options: [{ value: 'Pacifico', label: 'Pacífico' }, { value: 'Atlantico', label: 'Atlántico' }] },
    { path: 'wind.returnPeriod', label: 'Período de retorno', type: 'select', options: [10, 20, 50, 100].map((v) => ({ value: v, label: `${v} años${v === 50 ? ' (diseño)' : v === 10 ? ' (aceleraciones en servicio)' : v === 100 ? ' (puentes)' : ''}` })) },
    { path: 'wind.Voverride', label: 'V mayor justificada (opcional)', unit: 'km/h', type: 'number', step: 1, placeholder: 'Tabla 4.1' },
    { path: 'wind.exposure', label: 'Exposición (§6.5.6)', type: 'select', options: [{ value: 'B', label: 'B – Urbana / suburbana / boscosa' }, { value: 'C', label: 'C – Terreno abierto' }, { value: 'D', label: 'D – Costa, superficies de agua' }] },
    { path: 'wind.enclosure', label: 'Clasificación de cerramiento', type: 'select', options: [{ value: 'cerrado', label: 'Cerrado (GCpi = ±0.18)' }, { value: 'parcial', label: 'Parcialmente cerrado (±0.55)' }, { value: 'abierto', label: 'Abierto (0.00)' }] },
    { path: 'wind.rigidMode', label: 'Factor de ráfaga (rígidas)', type: 'select', options: [{ value: 'calc', label: 'Calculado, Ec. 6-4' }, { value: '0.85', label: 'G = 0.85' }] },
    { path: 'wind.beta', label: 'Amortiguamiento β (flexibles)', type: 'number', step: 0.005 },
    { path: 'wind.topo.enabled', label: 'Efecto topográfico (Kzt)', type: 'checkbox' },
    { path: 'wind.topo.type', label: 'Forma del relieve', type: 'select', options: opts(TOPO_TYPES), showIf: (p) => p.wind.topo.enabled },
    { path: 'wind.topo.H', label: 'Altura del relieve H', unit: 'm', type: 'number', showIf: (p) => p.wind.topo.enabled },
    { path: 'wind.topo.Lh', label: 'Distancia Lh', unit: 'm', type: 'number', showIf: (p) => p.wind.topo.enabled },
    { path: 'wind.topo.x', label: 'Distancia x a la cresta', unit: 'm', type: 'number', showIf: (p) => p.wind.topo.enabled },
  ],
  estructura: {
    common: [{ path: 'typology', label: 'Tipología', type: 'select', options: opts(TYPOLOGIES) }],
    edificio: [
      { path: 'edificio.Bx', label: 'Dimensión en X', unit: 'm', type: 'number' },
      { path: 'edificio.By', label: 'Dimensión en Y', unit: 'm', type: 'number' },
      { path: 'edificio.nx', label: 'Vanos en X', type: 'number', step: 1 },
      { path: 'edificio.ny', label: 'Vanos en Y', type: 'number', step: 1 },
      { path: 'edificio.nStories', label: 'Número de pisos', type: 'number', step: 1 },
      { path: 'edificio.firstStoryHeight', label: 'Altura del primer piso', unit: 'm', type: 'number', step: 0.1 },
      { path: 'edificio.storyHeight', label: 'Altura de pisos típicos', unit: 'm', type: 'number', step: 0.1 },
      { path: 'edificio.wFloor', label: 'Peso sísmico por piso', unit: 'kN/m²', type: 'number', step: 0.1 },
      { path: 'edificio.wRoof', label: 'Peso sísmico de azotea', unit: 'kN/m²', type: 'number', step: 0.1 },
      { path: 'edificio.systemX', label: 'Sistema resistente en X', type: 'select', options: sysOpts(BUILDING_SYSTEMS) },
      { path: 'edificio.systemY', label: 'Sistema resistente en Y', type: 'select', options: sysOpts(BUILDING_SYSTEMS) },
      { path: 'edificio.Tx', label: 'T analítico X (opcional)', unit: 's', type: 'number', step: 0.01, placeholder: 'Ta' },
      { path: 'edificio.Ty', label: 'T analítico Y (opcional)', unit: 's', type: 'number', step: 0.01, placeholder: 'Ta' },
    ],
    nave: [
      { path: 'nave.span', label: 'Luz (perpendicular a la cumbrera)', unit: 'm', type: 'number' },
      { path: 'nave.length', label: 'Longitud (paralela a la cumbrera)', unit: 'm', type: 'number' },
      { path: 'nave.eaveHeight', label: 'Altura al alero', unit: 'm', type: 'number', step: 0.1 },
      { path: 'nave.roofSlope', label: 'Pendiente del techo θ', unit: '°', type: 'number', step: 0.5 },
      { path: 'nave.frameSpacing', label: 'Separación entre marcos', unit: 'm', type: 'number', step: 0.1 },
      { path: 'nave.wRoof', label: 'Peso sísmico de techo', unit: 'kN/m²', type: 'number', step: 0.05 },
      { path: 'nave.wWalls', label: 'Peso de muros tributario al techo', unit: 'kN', type: 'number' },
      { path: 'nave.system', label: 'Sistema resistente', type: 'select', options: sysOpts(BUILDING_SYSTEMS) },
      { path: 'nave.T', label: 'T analítico (opcional)', unit: 's', type: 'number', step: 0.01, placeholder: 'Ta' },
    ],
    torre: [
      { path: 'torre.kind', label: 'Tipo', type: 'select', options: [{ value: 'celosia', label: 'Torre de celosía' }, { value: 'chimenea', label: 'Chimenea / poste / fuste sólido' }] },
      { path: 'torre.section', label: 'Sección de la celosía', type: 'select', options: [{ value: 'square', label: 'Cuadrada' }, { value: 'triangular', label: 'Triangular' }], showIf: (p) => p.torre.kind === 'celosia' },
      { path: 'torre.shape', label: 'Sección del fuste', type: 'select', options: [{ value: 'round', label: 'Circular' }, { value: 'square', label: 'Cuadrada' }, { value: 'hex', label: 'Hexagonal / octogonal' }], showIf: (p) => p.torre.kind !== 'celosia' },
      { path: 'torre.surface', label: 'Superficie (sección circular)', type: 'select', options: [{ value: 'moderadamente liso', label: 'Moderadamente lisa' }, { value: 'rugoso', label: 'Rugosa (D′/D = 0.02)' }, { value: 'muy rugoso', label: 'Muy rugosa (D′/D = 0.08)' }], showIf: (p) => p.torre.kind !== 'celosia' && p.torre.shape === 'round' },
      { path: 'torre.H', label: 'Altura total', unit: 'm', type: 'number' },
      { path: 'torre.bBase', label: 'Ancho / diámetro en la base', unit: 'm', type: 'number', step: 0.05 },
      { path: 'torre.bTop', label: 'Ancho / diámetro en la punta', unit: 'm', type: 'number', step: 0.05 },
      { path: 'torre.epsBase', label: 'Solidez ε en la base', type: 'number', step: 0.01, showIf: (p) => p.torre.kind === 'celosia' },
      { path: 'torre.epsTop', label: 'Solidez ε en la punta', type: 'number', step: 0.01, showIf: (p) => p.torre.kind === 'celosia' },
      { path: 'torre.roundMembers', label: 'Miembros redondos (Nota 3)', type: 'checkbox', showIf: (p) => p.torre.kind === 'celosia' },
      { path: 'torre.diagonal', label: 'Viento en diagonal (Nota 4)', type: 'checkbox', showIf: (p) => p.torre.kind === 'celosia' && p.torre.section === 'square' },
      { path: 'torre.nSeg', label: 'Número de segmentos', type: 'number', step: 1 },
      { path: 'torre.wBase', label: 'Peso lineal en la base', unit: 'kN/m', type: 'number', step: 0.1 },
      { path: 'torre.wTop', label: 'Peso lineal en la punta', unit: 'kN/m', type: 'number', step: 0.1 },
      { path: 'torre.system', label: 'Sistema (Tabla 15.4-2)', type: 'select', options: sysOpts(NONBUILDING_SYSTEMS) },
      { path: 'torre.periodMethod', label: 'Período fundamental', type: 'select', options: [{ value: 'manual', label: 'Ingresar T' }, { value: 'rayleigh', label: 'Rayleigh con EI' }] },
      { path: 'torre.T', label: 'T', unit: 's', type: 'number', step: 0.01, showIf: (p) => p.torre.periodMethod === 'manual' },
      { path: 'torre.EIbase', label: 'EI en la base', unit: 'kN·m²', type: 'number', showIf: (p) => p.torre.periodMethod === 'rayleigh' },
      { path: 'torre.EItop', label: 'EI en la punta', unit: 'kN·m²', type: 'number', showIf: (p) => p.torre.periodMethod === 'rayleigh' },
    ],
    tanque: [
      { path: 'tanque.D', label: 'Diámetro del tanque', unit: 'm', type: 'number', step: 0.1 },
      { path: 'tanque.Ht', label: 'Altura del tanque', unit: 'm', type: 'number', step: 0.1 },
      { path: 'tanque.Hw', label: 'Altura de agua', unit: 'm', type: 'number', step: 0.1 },
      { path: 'tanque.Hs', label: 'Altura del soporte', unit: 'm', type: 'number', step: 0.1 },
      { path: 'tanque.support', label: 'Soporte', type: 'select', options: [{ value: 'patas', label: 'Patas (columnas)' }, { value: 'pedestal', label: 'Pedestal único' }] },
      { path: 'tanque.nLegs', label: 'Número de patas', type: 'number', step: 1, showIf: (p) => p.tanque.support === 'patas' },
      { path: 'tanque.dLeg', label: 'Diámetro de patas', unit: 'm', type: 'number', step: 0.05, showIf: (p) => p.tanque.support === 'patas' },
      { path: 'tanque.Dped', label: 'Diámetro del pedestal', unit: 'm', type: 'number', step: 0.1, showIf: (p) => p.tanque.support === 'pedestal' },
      { path: 'tanque.Wshell', label: 'Peso del tanque vacío', unit: 'kN', type: 'number' },
      { path: 'tanque.Wsupport', label: 'Peso del soporte', unit: 'kN', type: 'number' },
      { path: 'tanque.system', label: 'Sistema (Tabla 15.4-2)', type: 'select', options: sysOpts(NONBUILDING_SYSTEMS.filter((s) => s.group === 'Tanques elevados')) },
      { path: 'tanque.periodMethod', label: 'Período fundamental', type: 'select', options: [{ value: 'rigidez', label: 'Desde la rigidez lateral K' }, { value: 'manual', label: 'Ingresar T' }] },
      { path: 'tanque.K', label: 'Rigidez lateral del soporte K', unit: 'kN/m', type: 'number', showIf: (p) => p.tanque.periodMethod === 'rigidez' },
      { path: 'tanque.T', label: 'T', unit: 's', type: 'number', step: 0.01, showIf: (p) => p.tanque.periodMethod === 'manual' },
    ],
  },
};

export { PERIOD_TYPES };

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = val;
}

let uid = 0;
export function renderFields(container, fields, project, onChange) {
  container.innerHTML = '';
  for (const f of fields) {
    if (f.showIf && !f.showIf(project)) continue;
    const id = 'f' + ++uid;
    const row = document.createElement('div');
    row.className = 'field' + (f.type === 'checkbox' ? ' check' : '') + (f.type === 'textarea' ? ' wide' : '');
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = f.label;
    let input;
    const val = getPath(project, f.path);
    if (f.type === 'select') {
      input = document.createElement('select');
      let group = null;
      let parent = input;
      for (const o of f.options) {
        if (o.group && o.group !== group) {
          group = o.group;
          parent = document.createElement('optgroup');
          parent.label = group;
          input.appendChild(parent);
        }
        const op = document.createElement('option');
        op.value = o.value;
        op.textContent = o.label;
        parent.appendChild(op);
      }
      input.value = String(val);
    } else if (f.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 3;
      input.value = val ?? '';
    } else {
      input = document.createElement('input');
      input.type = f.type === 'number' ? 'number' : f.type;
      if (f.type === 'checkbox') input.checked = !!val;
      else input.value = val ?? '';
      if (f.step) input.step = f.step;
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.type === 'number') input.inputMode = 'decimal';
    }
    input.id = id;
    input.dataset.path = f.path;
    const handler = () => {
      let v;
      if (f.type === 'checkbox') v = input.checked;
      else if (f.type === 'number') v = input.value === '' ? '' : Number(input.value);
      else if (f.type === 'select' && typeof val === 'number') v = Number(input.value);
      else v = input.value;
      setPath(project, f.path, v);
      // re-dibujar sólo ante cambios discretos (no pierde el foco al escribir)
      onChange(f.path, (f.type === 'select' || f.type === 'checkbox') && fields.some((g) => g.showIf));
    };
    input.addEventListener(f.type === 'select' || f.type === 'checkbox' ? 'change' : 'input', handler);
    if (f.type === 'checkbox') {
      row.append(input, label);
    } else {
      row.append(label);
      if (f.unit || f.tag) {
        const wrap = document.createElement('div');
        wrap.className = 'inwrap' + (f.tag ? ' tagged' : '');
        wrap.append(input);
        if (f.unit) {
          const u = document.createElement('span');
          u.className = 'unit';
          u.textContent = f.unit;
          wrap.append(u);
        }
        row.append(wrap);
      } else row.append(input);
    }
    container.appendChild(row);
  }
}
