// Consulta de Ss y S1 en la grilla digitalizada de los mapas REP (ver tools/digitize).

export const COVERAGE_WARN_KM = 15;
export const COVERAGE_MAX_KM = 30;

function cell(param, G, lon, lat) {
  const fx = (lon - G.lon0) / G.step;
  const fy = (lat - G.lat0) / G.step;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  if (i0 < 0 || j0 < 0 || i0 >= param.nlon - 1 || j0 >= param.nlat - 1) return null;
  return { i0, j0, tx: fx - i0, ty: fy - j0 };
}

function bilinear(arr, param, c) {
  const at = (i, j) => arr[j * param.nlon + i];
  const { i0, j0, tx, ty } = c;
  return (
    at(i0, j0) * (1 - tx) * (1 - ty) +
    at(i0 + 1, j0) * tx * (1 - ty) +
    at(i0, j0 + 1) * (1 - tx) * ty +
    at(i0 + 1, j0 + 1) * tx * ty
  );
}

/** Devuelve { Ss, S1, distKm, status: 'ok'|'baja'|'fuera' } o null si está fuera de la grilla. */
export function lookup(grid, lon, lat) {
  const G = grid.grid;
  const out = {};
  for (const name of ['Ss', 'S1']) {
    const p = grid.params[name];
    const c = cell(p, G, lon, lat);
    if (!c) return null;
    out[name] = bilinear(p.values, p, c) / 1000;
    out[name + 'dist'] = bilinear(p.dist_km, p, c);
  }
  const distKm = Math.max(out.Ssdist, out.S1dist);
  const status = distKm > COVERAGE_MAX_KM ? 'fuera' : distKm > COVERAGE_WARN_KM ? 'baja' : 'ok';
  return { Ss: round(out.Ss, 3), S1: round(out.S1, 3), distKm: Math.round(distKm), status };
}

const round = (x, n) => Math.round(x * 10 ** n) / 10 ** n;

/** Hojas (1..36) que contienen el punto, con coordenadas de píxel en la imagen JPG de la hoja. */
export function sheetsAt(grid, lon, lat) {
  const res = [];
  for (const [n, sh] of Object.entries(grid.sheets)) {
    const px = (lon - sh.fx.b) / sh.fx.a;
    const py = (lat - sh.fy.b) / sh.fy.a;
    const [x0, y0, x1, y1] = sh.frame;
    if (px >= x0 && px <= x1 && py >= y0 && py <= y1) {
      const c = sh.crop;
      res.push({ sheet: +n, x: (px - c.ox) * c.scale, y: (py - c.oy) * c.scale });
    }
  }
  return res;
}

/** Inversa: píxel de la imagen JPG de la hoja → lon/lat */
export function pixelToLonLat(grid, sheet, x, y) {
  const sh = grid.sheets[String(sheet)];
  const c = sh.crop;
  const px = x / c.scale + c.ox;
  const py = y / c.scale + c.oy;
  return { lon: sh.fx.a * px + sh.fx.b, lat: sh.fy.a * py + sh.fy.b };
}

/** Extensión geográfica de cada hoja (para el mapa índice). */
export function sheetBounds(grid) {
  return Object.entries(grid.sheets).map(([n, sh]) => {
    const [x0, y0, x1, y1] = sh.frame;
    return {
      sheet: +n,
      lon0: sh.fx.a * x0 + sh.fx.b, lon1: sh.fx.a * x1 + sh.fx.b,
      lat0: sh.fy.a * y1 + sh.fy.b, lat1: sh.fy.a * y0 + sh.fy.b,
    };
  });
}
