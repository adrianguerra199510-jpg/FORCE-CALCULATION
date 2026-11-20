// Mapa de ubicación unificado: grilla Ss/S1 digitalizada + contorno de Panamá + hojas REP
// escaneadas, dibujadas georreferenciadas en un solo visor.
import { lookup, sheetsAt, sheetBounds, COVERAGE_MAX_KM } from '../calc/maplookup.js';

const BBOX = { lon0: -83.15, lon1: -77.05, lat0: 6.95, lat1: 9.75 };
const KX = Math.cos((8.35 * Math.PI) / 180);
// Marco interior (neatline) del mapa dentro de cada JPG de hoja, en píxeles de la imagen.
const NEAT = { x0: 33, y0: 115, x1: 1019, y1: 1142 };
const ZMAX = 40;

const RAMP = ['#FFF7C7', '#F9E27A', '#F3B84A', '#E5822F', '#CF4A2A', '#A81F2B', '#6E0F22'];
function rampColor(t) {
  t = Math.max(0, Math.min(1, t));
  const x = t * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = hex(RAMP[i]);
  const b = hex(RAMP[i + 1]);
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f));
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const smooth = (a, b, x) => Math.max(0, Math.min(1, (x - a) / (b - a)));

export const CITIES = [
  { name: 'Ciudad de Panamá', lon: -79.52, lat: 8.98 },
  { name: 'Colón', lon: -79.9, lat: 9.36 },
  { name: 'La Chorrera', lon: -79.78, lat: 8.88 },
  { name: 'Penonomé', lon: -80.36, lat: 8.52 },
  { name: 'Santiago de Veraguas', lon: -80.98, lat: 8.1 },
  { name: 'Chitré', lon: -80.43, lat: 7.96 },
  { name: 'Las Tablas', lon: -80.27, lat: 7.77 },
  { name: 'David', lon: -82.43, lat: 8.43 },
  { name: 'Bocas del Toro', lon: -82.24, lat: 9.34 },
  { name: 'La Palma (Darién)', lon: -78.14, lat: 8.41 },
];

export class MapView {
  constructor(root, { grid, basemap, onPick }) {
    this.root = root;
    this.grid = grid;
    this.basemap = basemap;
    this.onPick = onPick;
    this.param = 'Ss';
    this.layer = 'mix'; // 'heat' | 'sheet' | 'mix'
    this.point = null;
    this.view = { z: 1, px: 0, py: 0 };
    this.imgs = {}; // caché de JPG de hojas: `${param}-${n}` → Image
    this.bounds = sheetBounds(grid).map((b) => ({ ...b, ...this.neatBounds(b.sheet) }));
    this.root.innerHTML = `
      <div class="map-toolbar">
        <div class="seg" role="radiogroup" aria-label="Parámetro">
          <button data-p="Ss" class="on" role="radio" aria-checked="true">Ss (0.2 s)</button>
          <button data-p="S1" role="radio" aria-checked="false">S1 (1.0 s)</button>
        </div>
        <div class="seg" role="radiogroup" aria-label="Capa">
          <button data-l="heat" role="radio" aria-checked="false">Colores</button>
          <button data-l="mix" class="on" role="radio" aria-checked="true">Mezcla</button>
          <button data-l="sheet" role="radio" aria-checked="false">Hoja REP</button>
        </div>
        <span class="grow"></span>
        <label class="inline">Lat <input id="mv-lat" type="number" step="0.001"></label>
        <label class="inline">Lon <input id="mv-lon" type="number" step="0.001"></label>
        <button id="mv-go" class="btn small">Ubicar</button>
        <select id="mv-city" aria-label="Ciudades de referencia"><option value="">Ciudades…</option>${CITIES.map((c, i) => `<option value="${i}">${c.name}</option>`).join('')}</select>
      </div>
      <div class="map-stage">
        <canvas class="heat"></canvas>
        <svg class="overlay"></svg>
        <div class="map-hover" hidden></div>
        <div class="map-card" hidden></div>
        <div class="map-ctrl">
          <button class="btn small" data-z="1" aria-label="Acercar">+</button>
          <button class="btn small" data-z="-1" aria-label="Alejar">−</button>
          <button class="btn small" id="mv-reset" title="Ver todo Panamá">⤢</button>
        </div>
        <svg class="map-mini" aria-hidden="true"></svg>
        <div class="map-legend"><span class="lg-min"></span><span class="lg-bar"></span><span class="lg-max"></span><span class="lg-hatch">Sin cobertura (&gt; ${COVERAGE_MAX_KM} km)</span></div>
        <div class="map-hint">Rueda: zoom · arrastrar: mover · clic: ubicar · al acercarse aparece la hoja REP</div>
      </div>`;
    this.stage = root.querySelector('.map-stage');
    this.canvas = root.querySelector('canvas.heat');
    this.svg = root.querySelector('svg.overlay');
    this.mini = root.querySelector('.map-mini');
    this.hover = root.querySelector('.map-hover');
    this.card = root.querySelector('.map-card');
    const radio = (sel, attr, fn) => root.querySelectorAll(sel).forEach((b) =>
      b.addEventListener('click', () => {
        fn(b.dataset[attr]);
        root.querySelectorAll(sel).forEach((x) => {
          x.classList.toggle('on', x === b);
          x.setAttribute('aria-checked', x === b);
        });
        this.draw();
        this.renderCard();
      }));
    radio('[data-p]', 'p', (v) => (this.param = v));
    radio('[data-l]', 'l', (v) => (this.layer = v));
    root.querySelector('#mv-go').addEventListener('click', () => {
      const lat = +root.querySelector('#mv-lat').value;
      const lon = +root.querySelector('#mv-lon').value;
      if (lat && lon) this.pick(lon, lat, true);
    });
    root.querySelector('#mv-city').addEventListener('change', (e) => {
      const c = CITIES[+e.target.value];
      if (c) this.pick(c.lon, c.lat, true);
    });
    root.querySelectorAll('.map-ctrl [data-z]').forEach((b) => b.addEventListener('click', () =>
      this.zoomAt(b.dataset.z === '1' ? 1.6 : 1 / 1.6, this.stage.clientWidth / 2, this.stage.clientHeight / 2)));
    root.querySelector('#mv-reset').addEventListener('click', () => {
      this.view = { z: 1, px: 0, py: 0 };
      this.draw();
    });
    this.stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.stage.getBoundingClientRect();
      this.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
    let drag = null;
    this.stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.map-ctrl, .map-card, .map-mini')) return;
      drag = { x: e.clientX, y: e.clientY, px: this.view.px, py: this.view.py, moved: false };
      this.stage.setPointerCapture(e.pointerId);
    });
    this.stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) {
        this.view.px = drag.px + dx;
        this.view.py = drag.py + dy;
        this.stage.classList.add('dragging');
        this.draw();
      }
    });
    this.stage.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) {
        const { lon, lat } = this.toLonLat(e);
        this.pick(lon, lat);
      }
      drag = null;
      this.stage.classList.remove('dragging');
    });
    this.stage.addEventListener('mousemove', (e) => {
      if (e.target.closest('.map-ctrl, .map-card, .map-mini')) return (this.hover.hidden = true);
      const { lon, lat } = this.toLonLat(e);
      const r = lookup(this.grid, lon, lat);
      if (!r) return (this.hover.hidden = true);
      this.hover.hidden = false;
      const rect = this.stage.getBoundingClientRect();
      this.hover.style.left = e.clientX - rect.left + 14 + 'px';
      this.hover.style.top = e.clientY - rect.top + 14 + 'px';
      this.hover.textContent = r.status === 'fuera' ? `${lat.toFixed(3)}, ${lon.toFixed(3)} · sin cobertura` : `${lat.toFixed(3)}, ${lon.toFixed(3)} · Ss ${r.Ss.toFixed(2)} · S1 ${r.S1.toFixed(2)}`;
    });
    this.stage.addEventListener('mouseleave', () => (this.hover.hidden = true));
    new ResizeObserver(() => this.draw()).observe(this.stage);
    this.buildHeat();
  }

  /** Extensión geográfica del marco interior de la hoja (sin títulos ni márgenes). */
  neatBounds(n) {
    const sh = this.grid.sheets[String(n)];
    const c = sh.crop;
    const lonAt = (x) => sh.fx.a * (x / c.scale + c.ox) + sh.fx.b;
    const latAt = (y) => sh.fy.a * (y / c.scale + c.oy) + sh.fy.b;
    return { nlon0: lonAt(NEAT.x0), nlon1: lonAt(NEAT.x1), nlat1: latAt(NEAT.y0), nlat0: latAt(NEAT.y1) };
  }

  /** Hojas que contienen el punto, primero la que lo tiene dentro de su marco interior. */
  sheetsHere(lon, lat) {
    const inNeat = (n) => this.bounds.some((b) => b.sheet === n && lon >= b.nlon0 && lon <= b.nlon1 && lat >= b.nlat0 && lat <= b.nlat1);
    return sheetsAt(this.grid, lon, lat).sort((a, b) => inNeat(b.sheet) - inNeat(a.sheet));
  }

  dims() {
    const w = this.stage.clientWidth || 800;
    const h = this.stage.clientHeight || 400;
    const gw = (BBOX.lon1 - BBOX.lon0) * KX;
    const gh = BBOX.lat1 - BBOX.lat0;
    const k = Math.min(w / gw, h / gh);
    return { w, h, k, ox: (w - gw * k) / 2, oy: (h - gh * k) / 2 };
  }
  xy(lon, lat, d = this.dims()) {
    const v = this.view;
    return [(d.ox + (lon - BBOX.lon0) * KX * d.k) * v.z + v.px, (d.oy + (BBOX.lat1 - lat) * d.k) * v.z + v.py];
  }
  toLonLat(e) {
    const rect = this.stage.getBoundingClientRect();
    const d = this.dims();
    const v = this.view;
    const x = (e.clientX - rect.left - v.px) / v.z;
    const y = (e.clientY - rect.top - v.py) / v.z;
    return { lon: BBOX.lon0 + (x - d.ox) / (KX * d.k), lat: BBOX.lat1 - (y - d.oy) / d.k };
  }
  zoomAt(f, cx, cy) {
    const z0 = this.view.z;
    const z1 = Math.max(1, Math.min(ZMAX, z0 * f));
    this.view.px = cx - ((cx - this.view.px) * z1) / z0;
    this.view.py = cy - ((cy - this.view.py) * z1) / z0;
    this.view.z = z1;
    if (z1 === 1) this.view = { z: 1, px: 0, py: 0 };
    this.draw();
  }
  centerOn(lon, lat, z = this.view.z) {
    this.view = { z, px: 0, py: 0 };
    const d = this.dims();
    const [x, y] = this.xy(lon, lat, d);
    this.view.px = d.w / 2 - x;
    this.view.py = d.h / 2 - y;
  }

  buildHeat() {
    this.heat = {};
    const G = this.grid.grid;
    for (const name of ['Ss', 'S1']) {
      const p = this.grid.params[name];
      const c = document.createElement('canvas');
      c.width = p.nlon;
      c.height = p.nlat;
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(p.nlon, p.nlat);
      const lo = name === 'Ss' ? 0.5 : 0.2;
      const hi = name === 'Ss' ? 2.0 : 0.75;
      for (let j = 0; j < p.nlat; j++) {
        for (let i = 0; i < p.nlon; i++) {
          const k = j * p.nlon + i;
          const o = ((p.nlat - 1 - j) * p.nlon + i) * 4;
          const [r, g, b] = rampColor((p.values[k] / 1000 - lo) / (hi - lo));
          img.data.set([r, g, b, p.dist_km[k] > COVERAGE_MAX_KM ? 0 : 235], o);
        }
      }
      ctx.putImageData(img, 0, 0);
      this.heat[name] = { canvas: c, lo, hi, G };
    }
  }

  /** Opacidades de las capas según el modo y el zoom. */
  alphas() {
    const z = this.view.z;
    if (this.layer === 'heat') return { heat: 0.9, sheet: 0 };
    if (this.layer === 'sheet') return { heat: 0, sheet: 1 };
    const t = smooth(2.2, 5, z); // al acercarse, la hoja REP toma el protagonismo
    return { heat: 0.9 - 0.5 * t, sheet: t };
  }

  sheetImg(n) {
    const key = `${this.param}-${n}`;
    let im = this.imgs[key];
    if (!im) {
      im = this.imgs[key] = new Image();
      im.src = `../data/rep-maps/sheets/${this.param}-${String(n).padStart(2, '0')}.jpg`;
      im.onload = () => this.draw();
    }
    return im.complete && im.naturalWidth ? im : null;
  }

  draw() {
    const d = this.dims();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = d.w * dpr;
    this.canvas.height = d.h * dpr;
    this.canvas.style.width = d.w + 'px';
    this.canvas.style.height = d.h + 'px';
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#DCE7EC';
    ctx.fillRect(0, 0, d.w, d.h);
    ctx.save();
    ctx.strokeStyle = 'rgba(28,42,51,0.12)';
    for (let x = -d.h; x < d.w; x += 9) {
      ctx.beginPath();
      ctx.moveTo(x, d.h);
      ctx.lineTo(x + d.h, 0);
      ctx.stroke();
    }
    ctx.restore();
    const A = this.alphas();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // hojas REP escaneadas, recortadas a su marco y colocadas por sus coordenadas
    if (A.sheet > 0.01) {
      ctx.globalAlpha = A.sheet;
      for (const b of this.bounds) {
        const [x0, y0] = this.xy(b.nlon0, b.nlat1, d);
        const [x1, y1] = this.xy(b.nlon1, b.nlat0, d);
        if (x1 < 0 || y1 < 0 || x0 > d.w || y0 > d.h) continue;
        const im = this.sheetImg(b.sheet);
        if (im) ctx.drawImage(im, NEAT.x0, NEAT.y0, NEAT.x1 - NEAT.x0, NEAT.y1 - NEAT.y0, x0, y0, x1 - x0, y1 - y0);
      }
      ctx.globalAlpha = 1;
    }
    const H = this.heat[this.param];
    const G = H.G;
    if (A.heat > 0.01) {
      const [x0, y1] = this.xy(G.lon0 - G.step / 2, G.lat0 - G.step / 2, d);
      const [x1, y0] = this.xy(G.lon1 + G.step / 2, G.lat1 + G.step / 2, d);
      ctx.globalAlpha = A.heat;
      if (A.sheet > 0.01) ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(H.canvas, x0, y0, x1 - x0, y1 - y0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    const poly = (ring) => 'M' + ring.map(([lon, lat]) => this.xy(lon, lat, d).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z';
    const land = A.sheet > 0.6 ? '' : this.basemap.polys.map((p) => `<path d="${poly(p.r)}" class="${p.c === 'PA' ? 'pa' : 'nb'}"/>`).join('');
    const here = this.point ? this.sheetsHere(this.point.lon, this.point.lat).map((s) => s.sheet) : [];
    const sheets = this.bounds.map((b) => {
      const [sx0, sy0] = this.xy(b.nlon0, b.nlat1, d);
      const [sx1, sy1] = this.xy(b.nlon1, b.nlat0, d);
      const on = here[0] === b.sheet;
      return `<g class="sheet${on ? ' on' : ''}"><rect x="${sx0}" y="${sy0}" width="${sx1 - sx0}" height="${sy1 - sy0}"/><text x="${sx0 + 5}" y="${sy0 + 15}">${this.param}-${b.sheet}</text></g>`;
    }).join('');
    let pt = '';
    if (this.point) {
      const [px, py] = this.xy(this.point.lon, this.point.lat, d);
      pt = `<g class="pin" transform="translate(${px},${py})"><circle r="9"/><line x1="-16" x2="16"/><line y1="-16" y2="16"/></g>`;
    }
    this.svg.setAttribute('viewBox', `0 0 ${d.w} ${d.h}`);
    this.svg.innerHTML = `${sheets}${land}${pt}`;
    this.drawMini(d);
    this.root.querySelector('.map-hint').hidden = this.view.z >= 1.6;
    const lg = this.root.querySelector('.map-legend');
    lg.hidden = A.heat < 0.05;
    lg.querySelector('.lg-min').textContent = `${H.lo.toFixed(2)} g`;
    lg.querySelector('.lg-max').textContent = `≥ ${H.hi.toFixed(2)} g`;
    lg.querySelector('.lg-bar').style.background = `linear-gradient(90deg, ${RAMP.join(',')})`;
  }

  /** Mapa índice: todo Panamá con el recuadro de lo que se está viendo. */
  drawMini(d) {
    const off = this.view.z < 1.6;
    this.mini.toggleAttribute('hidden', off); // en SVG la propiedad .hidden no existe
    if (off) return;
    const W = 210;
    const s = W / ((BBOX.lon1 - BBOX.lon0) * KX);
    const Hh = (BBOX.lat1 - BBOX.lat0) * s;
    const m = (lon, lat) => [((lon - BBOX.lon0) * KX * s).toFixed(1), ((BBOX.lat1 - lat) * s).toFixed(1)];
    const land = this.basemap.polys.filter((p) => p.c === 'PA').map((p) => `<path d="M${p.r.map(([a, b]) => m(a, b).join(',')).join('L')}Z"/>`).join('');
    const tl = this.toLonLatXY(0, 0, d);
    const br = this.toLonLatXY(d.w, d.h, d);
    const [rx0, ry0] = m(tl.lon, tl.lat);
    const [rx1, ry1] = m(br.lon, br.lat);
    const pt = this.point ? `<circle cx="${m(this.point.lon, this.point.lat)[0]}" cy="${m(this.point.lon, this.point.lat)[1]}" r="3"/>` : '';
    this.mini.setAttribute('viewBox', `0 0 ${W} ${Hh.toFixed(1)}`);
    this.mini.innerHTML = `${land}<rect x="${rx0}" y="${ry0}" width="${rx1 - rx0}" height="${ry1 - ry0}"/>${pt}`;
  }
  toLonLatXY(sx, sy, d) {
    const v = this.view;
    const x = (sx - v.px) / v.z;
    const y = (sy - v.py) / v.z;
    return { lon: BBOX.lon0 + (x - d.ox) / (KX * d.k), lat: BBOX.lat1 - (y - d.oy) / d.k };
  }

  setPoint(lon, lat, silent = true) {
    this.point = { lon, lat };
    this.root.querySelector('#mv-lat').value = lat.toFixed(4);
    this.root.querySelector('#mv-lon').value = lon.toFixed(4);
    this.draw();
    this.renderCard();
    if (!silent) this.emit();
  }

  pick(lon, lat, fly = false) {
    if (fly) this.centerOn(lon, lat, Math.max(this.view.z, 7));
    this.setPoint(lon, lat, false);
  }

  renderCard() {
    if (!this.point) return;
    const r = lookup(this.grid, this.point.lon, this.point.lat);
    const sh = this.sheetsHere(this.point.lon, this.point.lat).slice(0, 1);
    const { lat, lon } = this.point;
    const coord = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon <= 0 ? 'O' : 'E'}`;
    let body;
    if (!r) body = '<p class="warn">El punto está fuera del área de los mapas.</p>';
    else if (r.status === 'fuera') body = `<p class="warn">Sin cobertura REP-2014 (contorno a ${r.distKm} km). Ingresa Ss y S1 manualmente.</p>`;
    else body = `<div class="card-vals"><span class="tag big">Ss ${r.Ss.toFixed(2)} g</span><span class="tag big">S1 ${r.S1.toFixed(2)} g</span></div>
      <p class="${r.status === 'baja' ? 'warn-inline' : 'muted'}">${r.status === 'baja' ? 'Confianza baja: ' : ''}contorno más cercano a ${r.distKm} km</p>`;
    const sheetBtns = sh.length ? sh.map((s) => `<button class="btn small" data-goto="${s.sheet}">Ver hoja ${this.param}-${s.sheet}</button>`).join('') : '';
    this.card.hidden = false;
    this.card.innerHTML = `<div class="card-head"><strong>Sitio</strong><span class="muted">${coord}</span></div>${body}<div class="card-actions">${sheetBtns}</div>`;
    this.card.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => {
      this.centerOn(this.point.lon, this.point.lat, 9);
      this.draw();
    }));
  }

  emit() {
    const r = lookup(this.grid, this.point.lon, this.point.lat);
    if (r) this.onPick({ lon: this.point.lon, lat: this.point.lat, ...r });
  }

  /** Imagen (dataURL) del recorte de la hoja alrededor del punto, para el reporte. */
  async sheetCrop(param, size = 560) {
    if (!this.point) return null;
    const s = this.sheetsHere(this.point.lon, this.point.lat)[0];
    if (!s) return null;
    const img = new Image();
    img.src = `../data/rep-maps/sheets/${param}-${String(s.sheet).padStart(2, '0')}.jpg`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, s.x - size / 2, s.y - size / 2, size, size, 0, 0, size, size);
    ctx.strokeStyle = '#C8102E';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 10, 0, Math.PI * 2);
    ctx.moveTo(size / 2 - 20, size / 2);
    ctx.lineTo(size / 2 + 20, size / 2);
    ctx.moveTo(size / 2, size / 2 - 20);
    ctx.lineTo(size / 2, size / 2 + 20);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(0, 0, 150, 30);
    ctx.fillStyle = '#1C2A33';
    ctx.font = '600 18px "Barlow", sans-serif';
    ctx.fillText(`Mapa ${param}-${s.sheet}`, 8, 21);
    return { data: c.toDataURL('image/jpeg', 0.88), sheet: s.sheet };
  }
}
