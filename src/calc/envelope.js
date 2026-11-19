// Envolvente de presiones de viento por cara (máxima presión y máxima succión netas),
// considerando viento en +X, −X, +Y y −Y, presión interna ±GCpi y los casos A/B de techo.
// Convención: p > 0 presión hacia la cara; p < 0 succión (hacia afuera).

function collector() {
  const faces = new Map();
  return {
    face(id, name, area) {
      if (!faces.has(id)) faces.set(id, { id, name, area, pMax: -Infinity, pMin: Infinity, govMax: '', govMin: '' });
      return faces.get(id);
    },
    add(id, p, gov) {
      const f = faces.get(id);
      if (p > f.pMax) {
        f.pMax = p;
        f.govMax = gov;
      }
      if (p < f.pMin) {
        f.pMin = p;
        f.govMin = gov;
      }
    },
    list() {
      return [...faces.values()].map((f) => ({
        ...f,
        FMax: Math.max(Math.abs(f.pMax), Math.abs(f.pMin)) * (f.area || 0),
      }));
    },
  };
}

const sgn = (s) => (s > 0 ? '+' : '−');

/** Nave a dos aguas: muros X−/X+, frontones Y−/Y+ y faldones X−/X+. */
export function envelopeNave(res) {
  const g = res.geometry;
  const w = res.wind;
  const c = collector();
  const gableA = g.span * g.he + 0.5 * g.span * (g.hr - g.he);
  const slopeA = (g.length * g.span) / 2 / Math.cos(Math.atan2(g.hr - g.he, g.span / 2));
  c.face('X-', 'Muro X− (x = 0)', g.length * g.he);
  c.face('X+', `Muro X+ (x = ${g.span.toFixed(1)} m)`, g.length * g.he);
  c.face('Y-', 'Frontón Y− (y = 0)', gableA);
  c.face('Y+', `Frontón Y+ (y = ${g.length.toFixed(1)} m)`, gableA);
  c.face('RX-', 'Faldón del techo X−', slopeA);
  c.face('RX+', 'Faldón del techo X+', slopeA);
  const addRow = (fid, row, dirTxt, role) => {
    const cs = row.caseCp ? ` caso ${row.caseCp}` : '';
    c.add(fid, row.pPos, `Viento ${dirTxt}, ${role}${cs}, +GCpi`);
    c.add(fid, row.pNeg, `Viento ${dirTxt}, ${role}${cs}, −GCpi`);
  };
  // transversal: +X (barlovento en x = 0) y −X (simétrico)
  for (const s of [1, -1]) {
    const dirTxt = `${sgn(s)}X`;
    const ww = s > 0 ? 'X-' : 'X+';
    const lw = s > 0 ? 'X+' : 'X-';
    const rww = s > 0 ? 'RX-' : 'RX+';
    const rlw = s > 0 ? 'RX+' : 'RX-';
    for (const row of w.transversal.cases) {
      if (row.surface === 'Muro barlovento') addRow(ww, row, dirTxt, 'barlovento');
      else if (row.surface === 'Muro sotavento') addRow(lw, row, dirTxt, 'sotavento');
      else if (row.surface.startsWith('Muros laterales')) {
        addRow('Y-', row, dirTxt, 'lateral');
        addRow('Y+', row, dirTxt, 'lateral');
      } else if (row.surface === 'Techo barlovento') addRow(rww, row, dirTxt, 'techo barlovento');
      else if (row.surface === 'Techo sotavento') addRow(rlw, row, dirTxt, 'techo sotavento');
      else if (row.x0 !== undefined) {
        // zona medida desde el borde de barlovento
        if (row.x0 < g.span / 2) addRow(rww, row, dirTxt, `techo ${row.x0.toFixed(1)}–${row.x1.toFixed(1)} m`);
        if (row.x1 > g.span / 2) addRow(rlw, row, dirTxt, `techo ${row.x0.toFixed(1)}–${row.x1.toFixed(1)} m`);
      }
    }
  }
  // longitudinal: +Y (barlovento en y = 0) y −Y
  for (const s of [1, -1]) {
    const dirTxt = `${sgn(s)}Y`;
    const ww = s > 0 ? 'Y-' : 'Y+';
    const lw = s > 0 ? 'Y+' : 'Y-';
    for (const row of w.longitudinal.cases) {
      if (row.surface === 'Frontón barlovento') addRow(ww, row, dirTxt, 'barlovento');
      else if (row.surface === 'Frontón sotavento') addRow(lw, row, dirTxt, 'sotavento');
      else if (row.surface.startsWith('Muros laterales')) {
        addRow('X-', row, dirTxt, 'lateral');
        addRow('X+', row, dirTxt, 'lateral');
      } else if (row.x0 !== undefined) {
        addRow('RX-', row, dirTxt, `techo ${row.x0.toFixed(1)}–${row.x1.toFixed(1)} m`);
        addRow('RX+', row, dirTxt, `techo ${row.x0.toFixed(1)}–${row.x1.toFixed(1)} m`);
      }
    }
  }
  return {
    groups: [{ name: 'Nave', faces: c.list() }],
    note: 'Muro de barlovento evaluado con q a la altura del alero; demás superficies con qh (Fig. 6-6).',
  };
}

/** Edificio cerrado: muros X−, X+, Y−, Y+ y azotea. */
export function envelopeEdificio(res) {
  const g = res.geometry;
  const gcpi = res.wind.gcpi;
  const H = res.H;
  const c = collector();
  c.face('X-', 'Fachada X− (x = 0)', g.By * H);
  c.face('X+', `Fachada X+ (x = ${g.Bx.toFixed(1)} m)`, g.By * H);
  c.face('Y-', 'Fachada Y− (y = 0)', g.Bx * H);
  c.face('Y+', `Fachada Y+ (y = ${g.By.toFixed(1)} m)`, g.Bx * H);
  c.face('R', 'Azotea', g.Bx * g.By);
  for (const dir of ['X', 'Y']) {
    const d = res.wind.directions[dir];
    const qi = d.qh * gcpi;
    for (const s of [1, -1]) {
      const dirTxt = `${sgn(s)}${dir}`;
      const ww = dir === 'X' ? (s > 0 ? 'X-' : 'X+') : s > 0 ? 'Y-' : 'Y+';
      const lw = dir === 'X' ? (s > 0 ? 'X+' : 'X-') : s > 0 ? 'Y+' : 'Y-';
      const sides = dir === 'X' ? ['Y-', 'Y+'] : ['X-', 'X+'];
      const pTop = Math.max(...d.rows.map((r) => r.pww));
      const pBot = Math.min(...d.rows.map((r) => r.pww));
      c.add(ww, pTop + qi, `Viento ${dirTxt}, barlovento (parte alta), −GCpi`);
      c.add(ww, pBot - qi, `Viento ${dirTxt}, barlovento (parte baja), +GCpi`);
      for (const [pe, f, role] of [[d.plw, lw, 'sotavento'], [d.pSide, sides[0], 'lateral'], [d.pSide, sides[1], 'lateral']]) {
        c.add(f, pe - qi, `Viento ${dirTxt}, ${role}, +GCpi`);
        c.add(f, pe + qi, `Viento ${dirTxt}, ${role}, −GCpi`);
      }
      for (const z of d.roofZones) {
        for (const [pe, cs] of [[z.pA, 'A'], [z.pB, 'B']]) {
          c.add('R', pe - qi, `Viento ${dirTxt}, azotea ${z.x0.toFixed(1)}–${z.x1.toFixed(1)} m caso ${cs}, +GCpi`);
          c.add('R', pe + qi, `Viento ${dirTxt}, azotea ${z.x0.toFixed(1)}–${z.x1.toFixed(1)} m caso ${cs}, −GCpi`);
        }
      }
    }
  }
  return {
    groups: [{ name: 'Edificio', faces: c.list() }],
    note: 'En las fachadas de barlovento la presión crece con la altura: el máximo corresponde a la parte alta (qz en la azotea).',
  };
}

/**
 * Volumen genérico (calculado dentro de computeGenerico porque requiere qz por cota).
 * vols: volúmenes con rg; qzAt(z, dir); G[dir]; gcpi; cpLw(L/B); roofs[dir] (presiones de techo por volumen).
 */
export function envelopeGenerico({ vols, qzAt, G, gcpi, cpLw, roofs, cfOf }) {
  const groups = [];
  for (const v of vols) {
    const c = collector();
    const rg = v.rg;
    const cyl = v.shape === 'cyl';
    const open = v.tipo === 'abierto';
    if (cyl || open) {
      // método de fuerza (Cf): presión neta equivalente sobre el área proyectada
      const D = +v.bx;
      const id = 'S';
      c.face(id, open ? 'Celosía (presión neta equivalente, Cf·ε)' : 'Fuste cilíndrico (presión neta equivalente, Cf)', (cyl ? D : Math.max(+v.bx, +v.by)) * +v.h);
      for (const dir of ['X', 'Y']) {
        const pTop = qzAt(rg.eave, dir) * G[dir] * cfOf(v, dir);
        c.add(id, pTop, `Viento ${dir}, parte alta (Cf)`);
        c.add(id, qzAt(+v.z0, dir) * G[dir] * cfOf(v, dir), `Viento ${dir}, parte baja (Cf)`);
      }
    } else {
      const bx = +v.bx;
      const by = +v.by;
      c.face('X-', 'Cara X−', by * +v.h);
      c.face('X+', 'Cara X+', by * +v.h);
      c.face('Y-', 'Cara Y−', bx * +v.h);
      c.face('Y+', 'Cara Y+', bx * +v.h);
      for (const dir of ['X', 'Y']) {
        const qh = qzAt(rg.hMean, dir);
        const qi = qh * gcpi;
        const Gd = G[dir];
        const L = dir === 'X' ? bx : by;
        const B = dir === 'X' ? by : bx;
        const pTop = qzAt(rg.eave, dir) * Gd * 0.8;
        const pBot = qzAt(Math.max(+v.z0, 0), dir) * Gd * 0.8;
        const plw = qh * Gd * cpLw(L / B);
        const pside = qh * Gd * -0.7;
        for (const s of [1, -1]) {
          const dirTxt = `${sgn(s)}${dir}`;
          const ww = dir === 'X' ? (s > 0 ? 'X-' : 'X+') : s > 0 ? 'Y-' : 'Y+';
          const lw = dir === 'X' ? (s > 0 ? 'X+' : 'X-') : s > 0 ? 'Y+' : 'Y-';
          const sides = dir === 'X' ? ['Y-', 'Y+'] : ['X-', 'X+'];
          c.add(ww, pTop + qi, `Viento ${dirTxt}, barlovento (parte alta), −GCpi`);
          c.add(ww, pBot - qi, `Viento ${dirTxt}, barlovento (parte baja), +GCpi`);
          for (const [pe, f, role] of [[plw, lw, 'sotavento'], [pside, sides[0], 'lateral'], [pside, sides[1], 'lateral']]) {
            c.add(f, pe - qi, `Viento ${dirTxt}, ${role}, +GCpi`);
            c.add(f, pe + qi, `Viento ${dirTxt}, ${role}, −GCpi`);
          }
        }
      }
    }
    // techo (presiones de Fig. 6-6 / 6-7 ya calculadas por dirección)
    const rf = ['X', 'Y'].map((d) => ({ d, r: (roofs[d] || []).find((x) => x.vol === v.name) })).filter((x) => x.r);
    if (rf.length && !open) {
      const roofArea = cyl ? (Math.PI * +v.bx * +v.bx) / 4 : +v.bx * +v.by;
      c.face('R', rg.type === 'domo' ? 'Domo' : rg.type === 'plano' ? 'Techo plano' : 'Techo', roofArea);
      for (const { d, r } of rf) {
        for (const row of r.rows) {
          const cs = row.caseCp ? ` caso ${row.caseCp}` : '';
          c.add('R', row.pPos, `Viento ${d}, ${row.face}${cs}, +GCpi`);
          c.add('R', row.pNeg, `Viento ${d}, ${row.face}${cs}, −GCpi`);
        }
      }
    }
    groups.push({ name: v.name, faces: c.list(), cyl, open });
  }
  return {
    groups,
    note: 'Prismas sólidos: caras con Cp de la Fig. 6-6 como recinto cerrado (barlovento 0.8, sotavento según L/B, laterales −0.7) y ±GCpi. Cilindros y celosías: presión neta equivalente del método de fuerza (Cf).',
  };
}
