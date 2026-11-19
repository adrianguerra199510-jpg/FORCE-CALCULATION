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
    valla: [
      { path: 'valla.apoyo', label: 'Ubicación de la valla', type: 'select', options: [{ value: 'terreno', label: 'A nivel de terreno' }, { value: 'azotea', label: 'Sobre la azotea de una edificación' }] },
      { path: 'valla.nStories', label: 'Niveles de la edificación', type: 'number', step: 1, showIf: (p) => p.valla.apoyo === 'azotea' },
      { path: 'valla.firstStoryHeight', label: 'Altura del primer nivel', unit: 'm', type: 'number', step: 0.1, showIf: (p) => p.valla.apoyo === 'azotea' },
      { path: 'valla.storyHeight', label: 'Altura de niveles típicos', unit: 'm', type: 'number', step: 0.1, showIf: (p) => p.valla.apoyo === 'azotea' },
      { path: 'valla.Bx', label: 'Planta del edificio en X', unit: 'm', type: 'number', showIf: (p) => p.valla.apoyo === 'azotea' },
      { path: 'valla.By', label: 'Planta del edificio en Y', unit: 'm', type: 'number', showIf: (p) => p.valla.apoyo === 'azotea' },
      { path: 'valla.B', label: 'Ancho del anuncio B', unit: 'm', type: 'number', step: 0.1 },
      { path: 'valla.s', label: 'Alto del anuncio s', unit: 'm', type: 'number', step: 0.1 },
      { path: 'valla.clearance', label: 'Altura libre bajo el anuncio', unit: 'm', type: 'number', step: 0.1 },
      { path: 'valla.panel', label: 'Tipo de anuncio', type: 'select', options: [{ value: 'solida', label: 'Sólido (aberturas < 30 %) – Fig. 6-20' }, { value: 'abierta', label: 'Abierto / celosía (aberturas ≥ 30 %) – Fig. 6-22' }] },
      { path: 'valla.eps', label: 'Relación de solidez ε (área sólida / bruta)', type: 'number', step: 0.05 },
      { path: 'valla.members', label: 'Miembros del anuncio abierto', type: 'select', options: [{ value: 'plano', label: 'De caras planas' }, { value: 'redondo', label: 'Redondos' }], showIf: (p) => p.valla.panel === 'abierta' },
      { path: 'valla.memberD', label: 'Diámetro típico de miembro', unit: 'm', type: 'number', step: 0.01, showIf: (p) => p.valla.panel === 'abierta' && p.valla.members === 'redondo' },
      { path: 'valla.Lr', label: 'Esquina de retorno Lr (0 = sin retorno)', unit: 'm', type: 'number', step: 0.1, showIf: (p) => p.valla.panel !== 'abierta' },
      { path: 'valla.soporte', label: 'Soporte', type: 'select', options: [{ value: 'postes', label: 'Sobre postes' }, { value: 'directa', label: 'Sin postes (anclada a la estructura o apoyada como muro)' }] },
      { path: 'valla.nPosts', label: 'Número de postes', type: 'number', step: 1, showIf: (p) => p.valla.soporte !== 'directa' },
      { path: 'valla.postShape', label: 'Sección de los postes', type: 'select', options: [{ value: 'round', label: 'Circular' }, { value: 'square', label: 'Cuadrada' }], showIf: (p) => p.valla.soporte !== 'directa' },
      { path: 'valla.postD', label: 'Diámetro / lado de poste', unit: 'm', type: 'number', step: 0.05, showIf: (p) => p.valla.soporte !== 'directa' },
      { path: 'valla.Wpanel', label: 'Peso del anuncio y su armadura', unit: 'kN', type: 'number' },
      { path: 'valla.wPost', label: 'Peso de cada poste', unit: 'kN/m', type: 'number', step: 0.1, showIf: (p) => p.valla.soporte !== 'directa' },
      { path: 'valla.periodMethod', label: 'Período fundamental', type: 'select', options: [{ value: 'rayleigh', label: 'Rayleigh con EI de los postes' }, { value: 'rigida', label: 'Rígida (T < 0.06 s)' }, { value: 'manual', label: 'Ingresar T' }] },
      { path: 'valla.EIpost', label: 'EI de cada poste', unit: 'kN·m²', type: 'number', showIf: (p) => p.valla.periodMethod === 'rayleigh' && p.valla.soporte !== 'directa' },
      { path: 'valla.T', label: 'T', unit: 's', type: 'number', step: 0.01, showIf: (p) => p.valla.periodMethod === 'manual' },
      { path: 'valla.system', label: 'Sistema (Tabla 15.4-2)', type: 'select', options: sysOpts(NONBUILDING_SYSTEMS.filter((s) => ['P1', 'P2', 'P3'].includes(s.id))), showIf: (p) => p.valla.apoyo === 'terreno' },
      { path: 'valla.ap', label: 'ap (Tabla 13.5-1)', type: 'number', step: 0.25, showIf: (p) => p.valla.apoyo === 'azotea' },
      { path: 'valla.Rp', label: 'Rp (Tabla 13.5-1)', type: 'number', step: 0.25, showIf: (p) => p.valla.apoyo === 'azotea' },
      { path: 'valla.Ip', label: 'Ip del componente (§13.1.3)', type: 'select', options: [{ value: 1.0, label: '1.0' }, { value: 1.5, label: '1.5 (riesgo para la vida / esencial)' }], showIf: (p) => p.valla.apoyo === 'azotea' },
    ],
    generico: [
      { path: 'generico.system', label: 'Sistema sismorresistente', type: 'select', options: [...sysOpts(BUILDING_SYSTEMS), ...sysOpts(NONBUILDING_SYSTEMS)] },
      { path: 'generico.periodMethod', label: 'Período fundamental', type: 'select', options: [{ value: 'Ta', label: 'Ta = Ct·hn^x (sólo sistemas de edificio)' }, { value: 'manual', label: 'Ingresar T' }, { value: 'rigida', label: 'Rígida (T < 0.06 s)' }] },
      { path: 'generico.T', label: 'T', unit: 's', type: 'number', step: 0.01, showIf: (p) => p.generico.periodMethod !== 'rigida' },
      { path: 'generico.slices', label: 'Franjas de cálculo por cuerpo', type: 'number', step: 1 },
      { path: 'generico.surface', label: 'Superficie de cuerpos cilíndricos', type: 'select', options: [{ value: 'moderadamente liso', label: 'Moderadamente lisa' }, { value: 'rugoso', label: 'Rugosa' }, { value: 'muy rugoso', label: 'Muy rugosa' }] },
    ],
    tanque: [
      { path: 'tanque.shape', label: 'Forma del tanque', type: 'select', options: [{ value: 'cyl', label: 'Cilíndrico' }, { value: 'rect', label: 'Cuadrado' }] },
      { path: 'tanque.D', label: 'Diámetro / lado del tanque', unit: 'm', type: 'number', step: 0.1 },
      { path: 'tanque.Ht', label: 'Altura del tanque', unit: 'm', type: 'number', step: 0.1 },
      { path: 'tanque.Hw', label: 'Altura de agua', unit: 'm', type: 'number', step: 0.1 },
      { path: 'tanque.support', label: 'Soporte', type: 'select', options: [{ value: 'patas', label: 'Elevado sobre patas (columnas)' }, { value: 'pedestal', label: 'Elevado sobre pedestal único' }, { value: 'apoyado', label: 'Sin patas: apoyado directamente' }] },
      { path: 'tanque.Hs', label: 'Altura del soporte / cota de apoyo', unit: 'm', type: 'number', step: 0.1 },
      { path: 'tanque.nLegs', label: 'Número de patas', type: 'number', step: 1, showIf: (p) => p.tanque.support === 'patas' },
      { path: 'tanque.dLeg', label: 'Diámetro de patas', unit: 'm', type: 'number', step: 0.05, showIf: (p) => p.tanque.support === 'patas' },
      { path: 'tanque.Dped', label: 'Diámetro del pedestal', unit: 'm', type: 'number', step: 0.1, showIf: (p) => p.tanque.support === 'pedestal' },
      { path: 'tanque.Wshell', label: 'Peso del tanque vacío', unit: 'kN', type: 'number' },
      { path: 'tanque.Wsupport', label: 'Peso del soporte', unit: 'kN', type: 'number', showIf: (p) => p.tanque.support !== 'apoyado' },
      { path: 'tanque.system', label: 'Sistema (Tabla 15.4-2)', type: 'select', options: sysOpts(NONBUILDING_SYSTEMS.filter((s) => s.group === 'Tanques elevados')), showIf: (p) => p.tanque.support !== 'apoyado' },
      { path: 'tanque.system', label: 'Sistema (Tabla 15.4-2)', type: 'select', options: sysOpts(NONBUILDING_SYSTEMS.filter((s) => s.group === 'Tanques apoyados en el terreno')), showIf: (p) => p.tanque.support === 'apoyado' },
      { path: 'tanque.periodMethod', label: 'Período fundamental', type: 'select', options: [{ value: 'rigidez', label: 'Desde la rigidez lateral K' }, { value: 'rigida', label: 'Rígido (T < 0.06 s)' }, { value: 'manual', label: 'Ingresar T' }] },
      { path: 'tanque.K', label: 'Rigidez lateral del soporte K', unit: 'kN/m', type: 'number', showIf: (p) => p.tanque.periodMethod === 'rigidez' && p.tanque.support !== 'apoyado' },
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
      if (input.selectedIndex < 0 && f.options.length) {
        input.value = String(f.options[0].value);
        setPath(project, f.path, typeof val === 'number' ? Number(input.value) : input.value);
      }
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


// ---------------------------------------------------------------- editor de volúmenes
const VOL_FIELDS = [
  ['name', 'Nombre', 'text'],
  ['shape', 'Forma', 'select', [['rect', 'Prisma rectangular'], ['cyl', 'Cilindro']]],
  ['tipo', 'Tipo', 'select', [['solido', 'Sólido / cerrado'], ['abierto', 'Abierto / celosía']]],
  ['bx', 'Ancho X (o diámetro)', 'number', 'm'],
  ['by', 'Ancho Y', 'number', 'm', (v) => v.shape !== 'cyl'],
  ['h', 'Alto', 'number', 'm'],
  ['z0', 'Cota de la base (despegue)', 'number', 'm'],
  ['x', 'Posición X del centro', 'number', 'm'],
  ['y', 'Posición Y del centro', 'number', 'm'],
  ['eps', 'Solidez ε', 'number', '', (v) => v.tipo === 'abierto'],
  ['roof', 'Techo', 'select', (v) => (v.shape === 'cyl' ? [['plano', 'Plano'], ['domo', 'Domo']] : [['plano', 'Plano'], ['una', 'A una agua'], ['dos', 'A dos aguas'], ['cuatro', 'A cuatro aguas']])],
  ['roofAngle', 'Inclinación del techo', 'number', '°', (v) => ['una', 'dos', 'cuatro'].includes(v.roof) && v.shape !== 'cyl'],
  ['roofDir', 'Orientación', 'select', (v) => (v.roof === 'una' ? [['X', 'Sube hacia +X'], ['Y', 'Sube hacia +Y']] : [['X', 'Cumbrera paralela a X'], ['Y', 'Cumbrera paralela a Y']]), (v) => ['una', 'dos'].includes(v.roof) && v.shape !== 'cyl'],
  ['domeRise', 'Flecha del domo f', 'number', 'm', (v) => v.roof === 'domo' && v.shape === 'cyl'],
  ['W', 'Peso sísmico', 'number', 'kN'],
  ['nCols', 'Columnas de apoyo', 'number', 'n.º', (v) => +v.z0 > 0],
  ['dCol', 'Diámetro de columna', 'number', 'm', (v) => +v.z0 > 0 && +v.nCols > 0],
  ['wCol', 'Peso de columna', 'number', 'kN/m', (v) => +v.z0 > 0 && +v.nCols > 0],
];

export function renderVolumes(container, project, onChange) {
  const list = project.generico.volumes;
  const esc = (t) => String(t ?? '').replace(/"/g, '&quot;');
  container.innerHTML = `<div class="vol-list">${list.map((v, i) => `
    <fieldset class="vol" data-i="${i}">
      <legend>${esc(v.name) || 'Volumen ' + (i + 1)}</legend>
      <div class="vol-grid">${VOL_FIELDS.filter((f) => !f[4] || f[4](v)).map(([k, label, type, extra]) => {
        if (type === 'select') {
          const optsList = typeof extra === 'function' ? extra(v) : extra;
          if (!optsList.some(([val]) => val === v[k])) v[k] = optsList[0][0];
          return `<label>${label}<select data-k="${k}">${optsList.map(([val, l]) => `<option value="${val}" ${v[k] === val ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
        }
        return `<label>${label}${extra ? ` <span class="unit">${extra}</span>` : ''}<input data-k="${k}" type="${type}" ${type === 'number' ? 'step="any"' : ''} value="${esc(v[k])}"></label>`;
      }).join('')}</div>
      <div class="vol-actions"><button class="btn small" data-dup="${i}">Duplicar</button><button class="btn small" data-del="${i}" ${list.length < 2 ? 'disabled' : ''}>Quitar</button></div>
    </fieldset>`).join('')}
    <button class="btn small wide" id="addVol">Agregar volumen</button></div>`;
  container.querySelectorAll('fieldset.vol').forEach((fs) => {
    const v = list[+fs.dataset.i];
    fs.querySelectorAll('[data-k]').forEach((inp) => {
      const k = inp.dataset.k;
      const isSel = inp.tagName === 'SELECT';
      inp.addEventListener(isSel ? 'change' : 'input', () => {
        v[k] = inp.type === 'number' ? (inp.value === '' ? 0 : Number(inp.value)) : inp.value;
        const structural = isSel || k === 'z0' || k === 'nCols' || k === 'roof';
        if (k === 'name') fs.querySelector('legend').textContent = v.name;
        onChange(structural);
      });
    });
  });
  container.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { list.splice(+b.dataset.del, 1); onChange(true); }));
  container.querySelectorAll('[data-dup]').forEach((b) => b.addEventListener('click', () => {
    const v = list[+b.dataset.dup];
    list.splice(+b.dataset.dup + 1, 0, { ...v, name: v.name + ' (copia)', z0: +v.z0 + +v.h });
    onChange(true);
  }));
  container.querySelector('#addVol').addEventListener('click', () => {
    const top = Math.max(0, ...list.map((v) => +v.z0 + +v.h));
    list.push({ name: `Volumen ${list.length + 1}`, shape: 'rect', bx: 4, by: 4, h: 3, z0: top, x: 0, y: 0, tipo: 'solido', eps: 1, W: 50, nCols: 0, dCol: 0.3, wCol: 1, roof: 'plano', roofAngle: 15, roofDir: 'X', domeRise: 1 });
    onChange(true);
  });
}
