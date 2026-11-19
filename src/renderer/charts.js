// Gráficos SVG: espectro de diseño y perfil de fuerzas por nivel.
import { spectralAcceleration } from '../calc/seismic.js';

const C = { wind: '#1F5FA8', quake: '#C8102E', ink: '#1C2A33', muted: '#5B6B73', grid: '#E1E7E9', axis: '#9AA9AE', surface: '#FFFFFF' };
const FONT = "'Barlow Semi Condensed', 'Barlow', sans-serif";

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Espectro de diseño Sa(T) con marcas de los períodos de la estructura. */
export function spectrumSVG(p, markers = [], { w = 640, h = 340 } = {}) {
  const m = { l: 52, r: 18, t: 22, b: 42 };
  const Tmax = Math.max(4, ...markers.map((k) => k.T * 1.2));
  const ymax = niceMax(p.SDS * 1.12);
  const X = (T) => m.l + (T / Tmax) * (w - m.l - m.r);
  const Y = (s) => h - m.b - (s / ymax) * (h - m.t - m.b);
  const pts = [];
  for (let i = 0; i <= 300; i++) {
    const T = (Tmax * i) / 300;
    pts.push(`${X(T).toFixed(1)},${Y(spectralAcceleration(T, p)).toFixed(1)}`);
  }
  let grid = '';
  for (let i = 0; i <= 5; i++) {
    const v = (ymax * i) / 5;
    grid += `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.grid}"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(2)}</text>`;
  }
  for (let T = 0; T <= Tmax + 1e-9; T += Tmax > 6 ? 1 : 0.5) {
    grid += `<text x="${X(T)}" y="${h - m.b + 18}" text-anchor="middle">${T.toFixed(1)}</text>`;
  }
  const mk = markers.map((k, i) => {
    const sa = spectralAcceleration(k.T, p);
    const dy = i * 16;
    return `<line x1="${X(k.T)}" x2="${X(k.T)}" y1="${Y(0)}" y2="${Y(sa)}" stroke="${C.ink}" stroke-dasharray="3 3"/>
      <circle cx="${X(k.T)}" cy="${Y(sa)}" r="5" fill="${C.quake}" stroke="${C.surface}" stroke-width="2"/>
      <text x="${X(k.T) + 9}" y="${Y(sa) + 20 + dy}" fill="${C.ink}" font-weight="600">${k.label}: T = ${k.T.toFixed(3)} s · Sa = ${sa.toFixed(3)} g</text>`;
  }).join('');
  const notes = `<text x="${X(p.T0)}" y="${Y(p.SDS) - 8}" text-anchor="middle" fill="${C.muted}">T0 = ${p.T0.toFixed(3)}</text>
    <text x="${X(p.Ts)}" y="${Y(p.SDS) - 8}" text-anchor="middle" fill="${C.muted}">Ts = ${p.Ts.toFixed(3)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${FONT}" font-size="12" fill="${C.muted}" class="chart" data-kind="spectrum" data-tm="${Tmax}">
    <rect width="${w}" height="${h}" fill="${C.surface}"/>
    ${grid}
    <line x1="${m.l}" x2="${w - m.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="${C.axis}"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="${C.quake}" stroke-width="2" stroke-linejoin="round"/>
    ${notes}${mk}
    <text x="${(m.l + w - m.r) / 2}" y="${h - 6}" text-anchor="middle" fill="${C.ink}">Período T (s)</text>
    <text transform="translate(14 ${(m.t + h - m.b) / 2}) rotate(-90)" text-anchor="middle" fill="${C.ink}">Sa (g)</text>
    <g class="hover-layer"><line class="xh" y1="${m.t}" y2="${h - m.b}" stroke="${C.ink}" stroke-opacity="0.35" visibility="hidden"/></g>
  </svg>`;
}

/** Interacción: cruz + lectura de Sa(T) al pasar el mouse. */
export function attachSpectrumHover(svgEl, p, tip) {
  const vb = svgEl.viewBox.baseVal;
  const m = { l: 52, r: 18 };
  const xh = svgEl.querySelector('.xh');
  svgEl.addEventListener('mousemove', (e) => {
    const r = svgEl.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * vb.width;
    if (x < m.l || x > vb.width - m.r) return;
    const tm = +svgEl.getAttribute('data-tm');
    const T = ((x - m.l) / (vb.width - m.l - m.r)) * tm;
    xh.setAttribute('x1', x);
    xh.setAttribute('x2', x);
    xh.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.style.left = e.clientX - r.left + 12 + 'px';
    tip.style.top = e.clientY - r.top - 30 + 'px';
    tip.textContent = `T = ${T.toFixed(2)} s · Sa = ${spectralAcceleration(T, p).toFixed(3)} g`;
  });
  svgEl.addEventListener('mouseleave', () => {
    xh.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });
}

/**
 * Perfil de fuerzas por nivel: barras horizontales agrupadas (viento / sismo).
 * rows: [{ name, wind, quake }] de abajo hacia arriba.
 */
export function profileSVG(rows, { w = 640, title = 'Fuerza por nivel (kN)', windLabel = 'Viento', quakeLabel = 'Sismo' } = {}) {
  const bh = 9;
  const gap = 2;
  const rowH = bh * 2 + gap + 10;
  const m = { l: 92, r: 70, t: 34, b: 30 };
  const h = m.t + m.b + rows.length * rowH;
  const vmax = niceMax(Math.max(...rows.flatMap((r) => [r.wind || 0, r.quake || 0]), 1e-6));
  const X = (v) => m.l + (v / vmax) * (w - m.l - m.r);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (vmax * i) / 4;
    g += `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t - 6}" y2="${h - m.b}" stroke="${C.grid}"/><text x="${X(v)}" y="${h - m.b + 16}" text-anchor="middle">${v.toFixed(0)}</text>`;
  }
  const rev = [...rows].reverse();
  const bars = rev.map((r, i) => {
    const y = m.t + i * rowH;
    const bar = (v, dy, col, key) => {
      if (v == null) return '';
      const wpx = Math.max(1, X(v) - m.l);
      return `<path d="M${m.l},${y + dy} h${Math.max(0, wpx - 4)} a4,4 0 0 1 4,4 v${bh - 8} a4,4 0 0 1 -4,4 h${-Math.max(0, wpx - 4)} z" fill="${col}"><title>${r.name} · ${key}: ${v.toFixed(1)} kN</title></path>
        <text x="${m.l + wpx + 5}" y="${y + dy + bh - 1}" fill="${C.ink}">${v.toFixed(1)}</text>`;
    };
    return `<text x="${m.l - 8}" y="${y + bh + 4}" text-anchor="end" fill="${C.ink}">${r.name}</text>
      ${bar(r.wind, 0, C.wind, windLabel)}${bar(r.quake, bh + gap, C.quake, quakeLabel)}`;
  }).join('');
  const legend = `<g transform="translate(${m.l},14)"><rect width="12" height="10" rx="2" fill="${C.wind}"/><text x="17" y="9" fill="${C.ink}">${windLabel}</text>
    <rect x="${30 + windLabel.length * 6.5}" width="12" height="10" rx="2" fill="${C.quake}"/><text x="${47 + windLabel.length * 6.5}" y="9" fill="${C.ink}">${quakeLabel}</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${FONT}" font-size="12" fill="${C.muted}" class="chart">
    <rect width="${w}" height="${h}" fill="${C.surface}"/>${g}
    <line x1="${m.l}" x2="${m.l}" y1="${m.t - 6}" y2="${h - m.b}" stroke="${C.axis}"/>
    ${bars}${legend}
    <text x="${w - m.r}" y="${h - 4}" text-anchor="end" fill="${C.ink}">${title}</text>
  </svg>`;
}

/** Convierte un SVG (string) a PNG dataURL para el reporte. */
export async function svgToPng(svg, scale = 2) {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const w = +vb[1];
  const h = +vb[2];
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w * scale;
  c.height = h * scale;
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, w, h);
  return { data: c.toDataURL('image/png'), ratio: h / w };
}
