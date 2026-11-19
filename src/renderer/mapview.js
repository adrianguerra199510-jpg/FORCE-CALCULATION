// Mapa de ubicación: grilla Ss/S1 digitalizada + contorno de Panamá + hojas REP georreferenciadas.
import { lookup, sheetsAt, pixelToLonLat, sheetBounds, COVERAGE_MAX_KM } from '../calc/maplookup.js';

const BBOX = { lon0: -83.15, lon1: -77.05, lat0: 6.95, lat1: 9.75 };
const KX = Math.cos((8.35 * Math.PI) / 180);

// escala secuencial (amarillo del mapa REP → rojo sísmico)
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
    this.point = null;
    this.sheetZoom = 1;
    this.view = { z: 1, px: 0, py: 0 }; // zoom y desplazamiento del mapa de mosaicos
    this.root.innerHTML = `
      <div class="map-left">
        <div class="map-toolbar">
          <div class="seg" role="radiogroup" aria-label="Parámetro">
            <button data-p="Ss" class="on" role="radio" aria-checked="true">Ss (0.2 s)</button>
            <button data-p="S1" role="radio" aria-checked="false">S1 (1.0 s)</button>
          </div>
          <label class="inline">Lat <input id="mv-lat" type="number" step="0.001"></label>
          <label class="inline">Lon <input id="mv-lon" type="number" step="0.001"></label>
          <button id="mv-go" class="btn small">Ubicar</button>
          <button id="mv-reset" class="btn small" title="Restablecer el zoom del mapa">Ver todo</button>
          <select id="mv-city" aria-label="Ciudades de referencia"><option value="">Ciudades…</option>${CITIES.map((c, i) => `<option value="${i}">${c.name}</option>`).join('')}</select>
        </div>
        <div class="map-stage">
          <canvas class="heat"></canvas>
          <svg class="overlay"></svg>
          <div class="map-hover" hidden></div>
        </div>
        <div class="map-legend"><span class="lg-min"></span><span class="lg-bar"></span><span class="lg-max"></span><span class="lg-hatch">Sin cobertura REP-2014 (&gt; ${COVERAGE_MAX_KM} km de un contorno)</span></div>
      </div>
      <div class="map-right">
        <div class="sheet-head"><strong class="sheet-title">Hoja del mapa</strong><span class="sheet-tabs"></span>
          <span class="hint">Rueda: zoom · arrastrar: mover · clic: ubicar</span>
          <span class="zoom"><button class="btn small" data-z="-1" aria-label="Alejar">−</button><button class="btn small" data-z="1" aria-label="Acercar">+</button></span></div>
        <div class="sheet-view"><div class="sheet-empty">Haz clic en el mapa para ver la hoja REP del sitio y ajustar el punto sobre ella.</div></div>
        <div class="pick-info"></div>
      </div>`;
    this.stage = root.querySelector('.map-stage');
    this.canvas = root.querySelector('canvas.heat');
    this.svg = root.querySelector('svg.overlay');
    this.hover = root.querySelector('.map-hover');
    this.sheetView = root.querySelector('.sheet-view');
    root.querySelectorAll('.seg button').forEach((b) =>
      b.addEventListener('click', () => {
        this.param = b.dataset.p;
        root.querySelectorAll('.seg button').forEach((x) => {
          x.classList.toggle('on', x === b);
          x.setAttribute('aria-checked', x === b);
        });
        this.draw();
        this.showSheet();
      }));
    root.querySelector('#mv-go').addEventListener('click', () => {
      const lat = +root.querySelector('#mv-lat').value;
      const lon = +root.querySelector('#mv-lon').value;
      if (lat && lon) this.pick(lon, lat);
    });
    root.querySelector('#mv-city').addEventListener('change', (e) => {
      const c = CITIES[+e.target.value];
      if (c) this.pick(c.lon, c.lat);
    });
    root.querySelectorAll('.zoom button').forEach((b) => b.addEventListener('click', () => {
      const v = this.sheetView;
      this.zoomSheet(b.dataset.z === '1' ? 1.25 : 0.8, v.clientWidth / 2, v.clientHeight / 2);
    }));
    root.querySelector('#mv-reset').addEventListener('click', () => {
      this.view = { z: 1, px: 0, py: 0 };
      this.draw();
    });
    // ---- mapa de mosaicos: rueda = zoom en el cursor; arrastrar = mover; clic = ubicar
    this.stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.stage.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const z0 = this.view.z;
      const z1 = Math.max(1, Math.min(60, z0 * Math.exp(-e.deltaY * 0.0015)));
      this.view.px = cx - ((cx - this.view.px) * z1) / z0;
      this.view.py = cy - ((cy - this.view.py) * z1) / z0;
      this.view.z = z1;
      if (z1 === 1) this.view = { z: 1, px: 0, py: 0 };
      this.draw();
    }, { passive: false });
    let drag = null;
    this.stage.addEventListener('pointerdown', (e) => {
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
    // ---- hoja REP: rueda = zoom en el cursor; arrastrar = desplazar
    this.sheetView.addEventListener('wheel', (e) => {
      if (!this.sheetImg) return;
      e.preventDefault();
      const rect = this.sheetView.getBoundingClientRect();
      this.zoomSheet(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
    let sdrag = null;
    this.sheetView.addEventListener('pointerdown', (e) => {
      if (!this.sheetImg) return;
      sdrag = { x: e.clientX, y: e.clientY, sl: this.sheetView.scrollLeft, st: this.sheetView.scrollTop, moved: false };
      this.sheetView.setPointerCapture(e.pointerId);
    });
    this.sheetView.addEventListener('pointermove', (e) => {
      if (!sdrag) return;
      const dx = e.clientX - sdrag.x;
      const dy = e.clientY - sdrag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) sdrag.moved = true;
      if (sdrag.moved) {
        this.sheetView.scrollLeft = sdrag.sl - dx;
        this.sheetView.scrollTop = sdrag.st - dy;
        this.sheetView.classList.add('dragging');
      }
    });
    this.sheetView.addEventListener('pointerup', (e) => {
      if (sdrag && !sdrag.moved && this.sheetImg) {
        const r = this.sheetImg.getBoundingClientRect();
        const x = (e.clientX - r.left) / this.sheetZoom;
        const y = (e.clientY - r.top) / this.sheetZoom;
        if (x >= 0 && y >= 0 && x <= this.sheetImg.naturalWidth && y <= this.sheetImg.naturalHeight) {
          const ll = pixelToLonLat(this.grid, this.sheet.sheet, x, y);
          this.setPoint(ll.lon, ll.lat, false);
        }
      }
      sdrag = null;
      this.sheetView.classList.remove('dragging');
    });
    this.stage.addEventListener('mousemove', (e) => {
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

  dims() {
    const w = this.stage.clientWidth || 800;
    const h = this.stage.clientHeight || 400;
    const gw = (BBOX.lon1 - BBOX.lon0) * KX;
    const gh = BBOX.lat1 - BBOX.lat0;
    const k = Math.min(w / gw, h / gh);
    const ox = (w - gw * k) / 2;
    const oy = (h - gh * k) / 2;
    return { w, h, k, ox, oy };
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
      const vals = p.values;
      const lo = name === 'Ss' ? 0.5 : 0.2;
      const hi = name === 'Ss' ? 2.0 : 0.75;
      for (let j = 0; j < p.nlat; j++) {
        for (let i = 0; i < p.nlon; i++) {
          const k = j * p.nlon + i;
          const row = p.nlat - 1 - j; // norte arriba
          const o = (row * p.nlon + i) * 4;
          const out = p.dist_km[k] > COVERAGE_MAX_KM;
          const [r, g, b] = rampColor((vals[k] / 1000 - lo) / (hi - lo));
          img.data[o] = r;
          img.data[o + 1] = g;
          img.data[o + 2] = b;
          img.data[o + 3] = out ? 0 : 235;
        }
      }
      ctx.putImageData(img, 0, 0);
      this.heat[name] = { canvas: c, lo, hi, G };
    }
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
    // rayado de "sin cobertura"
    ctx.save();
    ctx.strokeStyle = 'rgba(28,42,51,0.12)';
    for (let x = -d.h; x < d.w; x += 9) {
      ctx.beginPath();
      ctx.moveTo(x, d.h);
      ctx.lineTo(x + d.h, 0);
      ctx.stroke();
    }
    ctx.restore();
    const H = this.heat[this.param];
    const G = H.G;
    const [x0, y1] = this.xy(G.lon0 - G.step / 2, G.lat0 - G.step / 2, d);
    const [x1, y0] = this.xy(G.lon1 + G.step / 2, G.lat1 + G.step / 2, d);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(H.canvas, x0, y0, x1 - x0, y1 - y0);
    ctx.globalAlpha = 1;

    // SVG: contornos, hojas, punto
    const poly = (ring) => 'M' + ring.map(([lon, lat]) => this.xy(lon, lat, d).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z';
    const land = this.basemap.polys.map((p) => `<path d="${poly(p.r)}" class="${p.c === 'PA' ? 'pa' : 'nb'}"/>`).join('');
    const sheets = sheetBounds(this.grid).map((b) => {
      const [sx0, sy0] = this.xy(b.lon0, b.lat1, d);
      const [sx1, sy1] = this.xy(b.lon1, b.lat0, d);
      return `<g class="sheet"><rect x="${sx0}" y="${sy0}" width="${sx1 - sx0}" height="${sy1 - sy0}"/><text x="${sx0 + 4}" y="${sy0 + 13}">${b.sheet}</text></g>`;
    }).join('');
    let pt = '';
    if (this.point) {
      const [px, py] = this.xy(this.point.lon, this.point.lat, d);
      pt = `<g class="pin" transform="translate(${px},${py})"><circle r="7"/><line x1="-13" x2="13"/><line y1="-13" y2="13"/></g>`;
    }
    this.svg.setAttribute('viewBox', `0 0 ${d.w} ${d.h}`);
    this.svg.innerHTML = `${sheets}${land}${pt}`;
    const lg = this.root.querySelector('.map-legend');
    lg.querySelector('.lg-min').textContent = `${H.lo.toFixed(2)} g`;
    lg.querySelector('.lg-max').textContent = `≥ ${H.hi.toFixed(2)} g`;
    lg.querySelector('.lg-bar').style.background = `linear-gradient(90deg, ${RAMP.join(',')})`;
  }

  setPoint(lon, lat, silent = true) {
    this.point = { lon, lat };
    this.root.querySelector('#mv-lat').value = lat.toFixed(4);
    this.root.querySelector('#mv-lon').value = lon.toFixed(4);
    this.draw();
    this.showSheet();
    if (!silent) this.emit();
  }

  pick(lon, lat) {
    this.setPoint(lon, lat, false);
  }

  emit() {
    const r = lookup(this.grid, this.point.lon, this.point.lat);
    const info = this.root.querySelector('.pick-info');
    if (!r) {
      info.innerHTML = '<p class="warn">El punto está fuera del área de los mapas.</p>';
      return;
    }
    info.innerHTML = r.status === 'fuera'
      ? `<p class="warn">Sin cobertura en los mapas REP-2014 (contorno más cercano a ${r.distKm} km). Ingresa Ss y S1 manualmente según los mapas oficiales del REP-2021.</p>`
      : `<p><span class="tag">Ss = ${r.Ss.toFixed(2)} g</span> <span class="tag">S1 = ${r.S1.toFixed(2)} g</span> ${r.status === 'baja' ? `<span class="warn-inline">Confianza baja: contorno a ${r.distKm} km</span>` : `<span class="muted">contorno más cercano a ${r.distKm} km</span>`}</p><p class="muted">Valores interpolados de los mapas digitalizados (Clase de sitio B). Verifica en la hoja.</p>`;
    this.onPick({ lon: this.point.lon, lat: this.point.lat, ...r });
  }

  showSheet(keepScroll = false) {
    if (!this.point) return;
    const list = sheetsAt(this.grid, this.point.lon, this.point.lat);
    const tabs = this.root.querySelector('.sheet-tabs');
    if (!list.length) {
      this.sheetView.innerHTML = '<div class="sheet-empty">El punto no está dentro de ninguna hoja del mapa.</div>';
      tabs.innerHTML = '';
      return;
    }
    if (!this.sheet || !list.find((s) => s.sheet === this.sheet.sheet)) this.sheet = list[0];
    else this.sheet = list.find((s) => s.sheet === this.sheet.sheet);
    tabs.innerHTML = list.map((s) => `<button class="btn small ${s.sheet === this.sheet.sheet ? 'on' : ''}" data-s="${s.sheet}">Hoja ${s.sheet}</button>`).join('');
    tabs.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      this.sheet = list.find((s) => s.sheet === +b.dataset.s);
      this.showSheet();
    }));
    this.root.querySelector('.sheet-title').textContent = `Mapa ${this.param === 'Ss' ? 'Ss' : 'S1'}-${this.sheet.sheet}`;
    const src = `../data/rep-maps/sheets/${this.param}-${String(this.sheet.sheet).padStart(2, '0')}.jpg`;
    const prevScroll = keepScroll ? [this.sheetView.scrollLeft, this.sheetView.scrollTop] : null;
    const z = this.sheetZoom;
    this.sheetView.innerHTML = `<div class="sheet-canvas" style="transform-origin:0 0"><img src="${src}" alt="Hoja ${this.sheet.sheet} del mapa ${this.param}" draggable="false"><div class="sheet-pin" style="left:${this.sheet.x}px;top:${this.sheet.y}px"></div></div>`;
    const sc = this.sheetView.querySelector('.sheet-canvas');
    const img = sc.querySelector('img');
    this.sheetImg = null;
    img.addEventListener('load', () => {
      this.sheetImg = img;
      this.applySheetZoom();
      if (prevScroll) [this.sheetView.scrollLeft, this.sheetView.scrollTop] = prevScroll;
      else {
        this.sheetView.scrollLeft = this.sheet.x * z - this.sheetView.clientWidth / 2;
        this.sheetView.scrollTop = this.sheet.y * z - this.sheetView.clientHeight / 2;
      }
    });
  }

  applySheetZoom() {
    const img = this.sheetImg;
    if (!img) return;
    const z = this.sheetZoom;
    const sc = img.parentElement;
    sc.style.width = img.naturalWidth * z + 'px';
    sc.style.height = img.naturalHeight * z + 'px';
    img.style.width = img.naturalWidth * z + 'px';
    const pin = sc.querySelector('.sheet-pin');
    pin.style.left = this.sheet.x * z + 'px';
    pin.style.top = this.sheet.y * z + 'px';
  }

  /** Zoom de la hoja manteniendo fijo el punto bajo (mx, my) del visor. */
  zoomSheet(factor, mx, my) {
    if (!this.sheetImg) return;
    const v = this.sheetView;
    const z0 = this.sheetZoom;
    const z1 = Math.max(0.25, Math.min(4, z0 * factor));
    const cx = (v.scrollLeft + mx) / z0;
    const cy = (v.scrollTop + my) / z0;
    this.sheetZoom = z1;
    this.applySheetZoom();
    v.scrollLeft = cx * z1 - mx;
    v.scrollTop = cy * z1 - my;
  }

  /** Imagen (dataURL) del recorte de la hoja alrededor del punto, para el reporte. */
  async sheetCrop(param, size = 560) {
    if (!this.point) return null;
    const list = sheetsAt(this.grid, this.point.lon, this.point.lat);
    if (!list.length) return null;
    const s = list[0];
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
