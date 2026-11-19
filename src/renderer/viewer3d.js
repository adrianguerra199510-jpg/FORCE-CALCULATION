// Visor 3D (Three.js). Convención: X y Z en planta, Y vertical.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const COL = {
  member: 0x2b3a44,
  slab: 0x9fb3bb,
  ground: 0xdfe6e4,
  wind: 0x1f5fa8,
  quake: 0xc8102e,
  suction: 0x7a3ea0,
  tank: 0x7f98a3,
  water: 0x5a9fd6,
};

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0xf4f7f6);
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a9f, 1.2));
    const dl = new THREE.DirectionalLight(0xffffff, 1.4);
    dl.position.set(60, 120, 80);
    this.scene.add(dl);
    this.model = new THREE.Group();
    this.loads = new THREE.Group();
    this.scene.add(this.model, this.loads);
    this.labelScale = 1;
    this.showLabels = true;
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  resize() {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clear(g) {
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    g.clear();
  }

  // ------------------------------------------------------------- utilidades
  line(points, color = COL.member, width = 1) {
    const g = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
    const m = new THREE.LineBasicMaterial({ color, linewidth: width });
    return new THREE.LineSegments(g, m);
  }

  member(a, b, r, color = COL.member) {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const geo = new THREE.CylinderGeometry(r, r, len, 8);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1 }));
    mesh.position.copy(va).add(vb).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    return mesh;
  }

  label(text, pos, color = '#1C2A33', bg = 'rgba(255,255,255,0.9)') {
    const pad = 10;
    const fs = 30;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = `600 ${fs}px "Barlow Semi Condensed", sans-serif`;
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
    c.width = w;
    c.height = fs + pad * 1.4;
    ctx.font = `600 ${fs}px "Barlow Semi Condensed", sans-serif`;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, pad, c.height / 2 + 1);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
    const k = 0.00055 * this.labelScale;
    sp.scale.set(c.width * k, c.height * k, 1);
    sp.position.set(...pos);
    sp.renderOrder = 10;
    sp.userData.isLabel = true;
    return sp;
  }

  arrow(from, dir, len, color, label) {
    // flecha sólida (cilindro + cono); 'from' es la cola, la punta toca la estructura
    const d = new THREE.Vector3(...dir).normalize();
    const o = new THREE.Vector3(...from);
    len = Math.max(len, 0.05);
    const r = this.size * 0.006;
    const headL = Math.min(len * 0.35, this.size * 0.05);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.max(len - headL, 0.01), 10), mat);
    const head = new THREE.Mesh(new THREE.ConeGeometry(r * 3, headL, 14), mat);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    shaft.quaternion.copy(q);
    head.quaternion.copy(q);
    shaft.position.copy(o).add(d.clone().multiplyScalar((len - headL) / 2));
    head.position.copy(o).add(d.clone().multiplyScalar(len - headL / 2));
    this.loads.add(shaft, head);
    if (label && this.showLabels) {
      const tail = o.clone().add(d.clone().multiplyScalar(-this.size * 0.03));
      this.loads.add(this.label(label, tail.toArray(), '#ffffff', color === COL.quake ? '#C8102E' : color === COL.suction ? '#7A3EA0' : '#1F5FA8'));
    }
  }

  fit(size, center) {
    const c = new THREE.Vector3(...center);
    const r = size;
    this.camera.position.set(c.x - r * 1.55, c.y + r * 0.95, c.z + r * 1.8);
    this.controls.target.copy(c);
    this.camera.near = r / 100;
    this.camera.far = r * 50;
    this.camera.updateProjectionMatrix();
  }

  ground(w, d) {
    const g = new THREE.GridHelper(Math.max(w, d) * 2.2, 22, 0xb7c4c7, 0xd4dcdc);
    g.position.set(w / 2, 0, d / 2);
    this.model.add(g);
  }

  // ------------------------------------------------------------- modelos
  setModel(res) {
    this.res = res;
    this.clear(this.model);
    this.clear(this.loads);
    const t = res.typology;
    if (t === 'edificio') this.buildEdificio(res);
    else if (t === 'nave') this.buildNave(res);
    else if (t === 'torre') this.buildTorre(res);
    else if (t === 'tanque') this.buildTanque(res);
  }

  buildEdificio(res) {
    const { Bx, By, heights, nx, ny } = res.geometry;
    const H = heights[heights.length - 1];
    this.ground(Bx, By);
    const xs = Array.from({ length: nx + 1 }, (_, i) => (Bx * i) / nx);
    const zs = Array.from({ length: ny + 1 }, (_, j) => (By * j) / ny);
    const lvls = [0, ...heights];
    const pts = [];
    for (const x of xs) for (const z of zs) pts.push([x, 0, z], [x, H, z]);
    for (const y of heights) {
      for (const z of zs) pts.push([0, y, z], [Bx, y, z]);
      for (const x of xs) pts.push([x, y, 0], [x, y, By]);
    }
    this.model.add(this.line(pts, COL.member));
    for (const y of heights) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(Bx, 0.18, By), new THREE.MeshStandardMaterial({ color: COL.slab, transparent: true, opacity: 0.35 }));
      slab.position.set(Bx / 2, y, By / 2);
      this.model.add(slab);
    }
    void lvls;
    this.size = Math.max(Bx, By, H);
    this.center = [Bx / 2, H / 2, By / 2];
  }

  buildNave(res) {
    const { span, length, he, hr, s, nFrames } = res.geometry;
    this.ground(span, length);
    const pts = [];
    for (let i = 0; i < nFrames; i++) {
      const z = Math.min(length, i * s);
      pts.push([0, 0, z], [0, he, z], [0, he, z], [span / 2, hr, z], [span / 2, hr, z], [span, he, z], [span, he, z], [span, 0, z]);
    }
    for (const [x, y] of [[0, he], [span / 2, hr], [span, he]]) pts.push([x, y, 0], [x, y, length]);
    this.model.add(this.line(pts, COL.member));
    this.size = Math.max(span, length, hr) * 0.8;
    this.center = [span / 2, hr / 2, length / 2];
  }

  buildTorre(res) {
    const g = res.geometry;
    const H = g.H;
    const half = (z) => (g.bBase + ((g.bTop - g.bBase) * z) / H) / 2;
    if (g.kind === 'celosia') {
      const nSides = g.section === 'triangular' ? 3 : 4;
      const corner = (z, k) => {
        const r = half(z) * (nSides === 4 ? Math.SQRT2 : 1.15);
        const a = (2 * Math.PI * k) / nSides + (nSides === 4 ? Math.PI / 4 : -Math.PI / 2);
        return [r * Math.cos(a), z, r * Math.sin(a)];
      };
      const n = g.nSeg;
      const pts = [];
      for (let i = 0; i < n; i++) {
        const z0 = (H * i) / n;
        const z1 = (H * (i + 1)) / n;
        for (let k = 0; k < nSides; k++) {
          const k2 = (k + 1) % nSides;
          pts.push(corner(z0, k), corner(z1, k));
          pts.push(corner(z1, k), corner(z1, k2));
          pts.push(corner(z0, k), corner(z1, k2));
          pts.push(corner(z0, k2), corner(z1, k));
        }
      }
      for (let k = 0; k < nSides; k++) pts.push(corner(0, k), corner(0, (k + 1) % nSides));
      this.model.add(this.line(pts, COL.member));
    } else {
      const geo = g.shape === 'square'
        ? new THREE.CylinderGeometry(g.bTop / Math.SQRT2, g.bBase / Math.SQRT2, H, 4, 1)
        : new THREE.CylinderGeometry(g.bTop / 2, g.bBase / 2, H, g.shape === 'hex' ? 8 : 32, 1);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: COL.tank, roughness: 0.6 }));
      if (g.shape === 'square') m.rotation.y = Math.PI / 4;
      m.position.y = H / 2;
      this.model.add(m);
    }
    for (const a of g.appurtenances || []) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.3), new THREE.MeshStandardMaterial({ color: 0x55646b }));
      box.position.set(half(+a.z) + 0.4, +a.z, 0);
      this.model.add(box);
    }
    this.ground(0.01, 0.01);
    this.size = H * 1.0;
    this.center = [0, H / 2, 0];
  }

  buildTanque(res) {
    const g = res.geometry;
    const { D, Ht, Hw, Hs } = g;
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(D / 2, D / 2, Ht, 40, 1, true), new THREE.MeshStandardMaterial({ color: COL.tank, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
    tank.position.y = Hs + Ht / 2;
    const water = new THREE.Mesh(new THREE.CylinderGeometry(D / 2 - 0.05, D / 2 - 0.05, Hw, 40), new THREE.MeshStandardMaterial({ color: COL.water, transparent: true, opacity: 0.55 }));
    water.position.y = Hs + Hw / 2;
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(D / 2, D / 2, 0.15, 40), new THREE.MeshStandardMaterial({ color: COL.member }));
    floor.position.y = Hs;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(D / 2, D * 0.15, 40), new THREE.MeshStandardMaterial({ color: COL.tank }));
    roof.position.y = Hs + Ht + D * 0.075;
    this.model.add(tank, water, floor, roof);
    if (g.support === 'pedestal') {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(g.Dped / 2, g.Dped / 2 * 1.15, Hs, 32), new THREE.MeshStandardMaterial({ color: 0x9aa7ab }));
      p.position.y = Hs / 2;
      this.model.add(p);
    } else {
      const n = g.nLegs;
      const r = D / 2 * 0.85;
      const base = r * 1.25;
      const nb = Math.max(2, Math.round(Hs / 5));
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n + Math.PI / 4;
        const a2 = (2 * Math.PI * (i + 1)) / n + Math.PI / 4;
        const P = (rad, ang, y) => [rad * Math.cos(ang), y, rad * Math.sin(ang)];
        const rAt = (y) => base + ((r - base) * y) / Hs;
        this.model.add(this.member(P(base, a, 0), P(r, a, Hs), Math.max(g.dLeg / 2, 0.08)));
        for (let k = 0; k < nb; k++) {
          const y0 = (Hs * k) / nb;
          const y1 = (Hs * (k + 1)) / nb;
          this.model.add(this.member(P(rAt(y1), a, y1), P(rAt(y1), a2, y1), 0.05));
          this.model.add(this.member(P(rAt(y0), a, y0), P(rAt(y1), a2, y1), 0.04));
        }
      }
    }
    this.ground(0.01, 0.01);
    this.size = (Hs + Ht) * 0.95;
    this.center = [0, (Hs + Ht) / 2, 0];
  }

  // ------------------------------------------------------------- cargas
  setLoadCase(lc, opts = {}) {
    this.clear(this.loads);
    const res = this.res;
    if (!res || lc === 'none') return;
    const L = this.size * 0.45;
    const fmt = (v) => `${v.toFixed(1)} kN`;
    if (res.typology === 'edificio') {
      const { Bx, By } = res.geometry;
      const dir = lc.endsWith('x') ? 'X' : 'Y';
      const rows = lc.startsWith('w') ? res.wind.directions[dir].rows : res.seismic.directions[dir].levels;
      const Fmax = Math.max(...rows.map((r) => r.F));
      const color = lc.startsWith('w') ? COL.wind : COL.quake;
      for (const r of rows) {
        const len = (L * r.F) / Fmax;
        if (dir === 'X') this.arrow([-len - 0.5, r.h, By / 2], [1, 0, 0], len, color, fmt(r.F));
        else this.arrow([Bx / 2, r.h, By + len + 0.5], [0, 0, -1], len, color, fmt(r.F));
      }
    } else if (res.typology === 'nave') {
      if (lc === 'sx' || lc === 'sy') {
        const { span, length, he } = res.geometry;
        const V = res.seismic.directions.X.V;
        if (lc === 'sx') this.arrow([-L - 0.5, he, length / 2], [1, 0, 0], L, COL.quake, `V = ${fmt(V)}`);
        else this.arrow([span / 2, he, length + L + 0.5], [0, 0, -1], L, COL.quake, `V = ${fmt(V)}`);
      } else this.naveWind(lc === 'wt' ? 'transversal' : 'longitudinal', opts);
    } else if (res.typology === 'torre') {
      const g = res.geometry;
      const half = (z) => (g.bBase + ((g.bTop - g.bBase) * z) / g.H) / 2;
      if (lc === 'w') {
        const items = [...res.wind.segs.map((s) => ({ z: s.zc, F: s.F })), ...res.wind.appForces.map((a) => ({ z: a.z, F: a.F, app: a.name }))];
        const Fmax = Math.max(...items.map((i) => i.F));
        for (const it of items) {
          const len = (L * it.F) / Fmax;
          // accesorios: flecha por el lado opuesto para no encimarse con los segmentos
          if (it.app) this.arrow([half(it.z) + len + 0.3, it.z, 0], [-1, 0, 0], len, COL.wind, `${it.app}: ${fmt(it.F)}`);
          else this.arrow([-half(it.z) - len - 0.3, it.z, 0], [1, 0, 0], len, COL.wind, fmt(it.F));
        }
      } else {
        const lv = res.seismic.directions.X.levels;
        const Fmax = Math.max(...lv.map((l) => l.F));
        for (const l of lv) {
          const len = (L * l.F) / Fmax;
          this.arrow([-half(l.h) - len - 0.3, l.h, 0], [1, 0, 0], len, COL.quake, fmt(l.F));
        }
      }
    } else if (res.typology === 'tanque') {
      const g = res.geometry;
      const items = lc === 'w'
        ? res.wind.parts.map((p) => ({ z: p.z, F: p.F, r: p.name === 'Recipiente' ? g.D / 2 : g.D / 2 }))
        : res.seismic.directions.X.levels.map((l) => ({ z: l.h, F: l.F, r: g.D / 2 }));
      const Fmax = Math.max(...items.map((i) => i.F));
      for (const it of items) {
        const len = (L * it.F) / Fmax;
        this.arrow([-it.r - len - 0.3, it.z, 0], [1, 0, 0], len, lc === 'w' ? COL.wind : COL.quake, fmt(it.F));
      }
    }
  }

  naveWind(which, opts) {
    const res = this.res;
    const { span, length, he, hr } = res.geometry;
    const w = res.wind[which];
    const internal = opts.internal === 'neg' ? 'pNeg' : 'pPos';
    const roofCase = opts.roofCase || 'A';
    const rows = w.cases;
    const pick = (name) => {
      const cand = rows.filter((r) => r.surface === name);
      if (!cand.length) return null;
      return cand.find((r) => r.caseCp === roofCase) || cand[0];
    };
    const allP = rows.map((r) => Math.abs(r[internal]));
    const pmax = Math.max(...allP, 0.01);
    const color = (p) => {
      const t = Math.min(1, Math.abs(p) / pmax);
      const base = new THREE.Color(p >= 0 ? COL.wind : COL.suction);
      return new THREE.Color(0xffffff).lerp(base, 0.25 + 0.75 * t);
    };
    const quad = (pts, p, labelPos, normal) => {
      const geo = new THREE.BufferGeometry();
      const v = [pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]].flat();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: color(p), transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }));
      this.loads.add(m);
      // flecha: hacia la superficie si p > 0 (presión), alejándose si p < 0 (succión)
      const n = new THREE.Vector3(...normal).normalize();
      const len = (this.size * 0.16 * Math.abs(p)) / pmax + 0.5;
      const c = new THREE.Vector3(...labelPos);
      if (p >= 0) this.arrow(c.clone().add(n.clone().multiplyScalar(len)).toArray(), n.clone().negate().toArray(), len, COL.wind);
      else this.arrow(c.toArray(), n.toArray(), len, COL.suction);
      if (this.showLabels) this.loads.add(this.label(`${p.toFixed(2)} kPa`, c.clone().add(n.clone().multiplyScalar(0.3)).toArray(), '#ffffff', p >= 0 ? '#1F5FA8' : '#7A3EA0'));
    };
    const e = 0.02;
    const sA = Math.atan2(hr - he, span / 2);
    const nL = [-Math.sin(sA), Math.cos(sA), 0];
    const nR = [Math.sin(sA), Math.cos(sA), 0];
    if (which === 'transversal') {
      // viento +X; barlovento en x = 0
      const ww = pick('Muro barlovento');
      const lw = pick('Muro sotavento');
      const sd = pick('Muros laterales (frontones)');
      quad([[-e, 0, 0], [-e, he, 0], [-e, he, length], [-e, 0, length]], ww[internal], [-e, he / 2, length / 2], [-1, 0, 0]);
      quad([[span + e, 0, 0], [span + e, he, 0], [span + e, he, length], [span + e, 0, length]], lw[internal], [span + e, he / 2, length / 2], [1, 0, 0]);
      quad([[0, 0, -e], [0, he, -e], [span, he, -e], [span, 0, -e]], sd[internal], [span / 2, he / 2, -e], [0, 0, -1]);
      const rww = pick('Techo barlovento');
      const rlw = pick('Techo sotavento');
      if (rww && rlw) {
        quad([[0, he + e, 0], [span / 2, hr + e, 0], [span / 2, hr + e, length], [0, he + e, length]], rww[internal], [span / 4, (he + hr) / 2 + e, length / 2], nL);
        quad([[span / 2, hr + e, 0], [span, he + e, 0], [span, he + e, length], [span / 2, hr + e, length]], rlw[internal], [(3 * span) / 4, (he + hr) / 2 + e, length / 2], nR);
      } else {
        const zones = rows.filter((r) => r.x0 !== undefined && (r.caseCp === roofCase || !r.caseCp));
        const yAt = (x) => (x <= span / 2 ? he + ((hr - he) * x) / (span / 2) : hr - ((hr - he) * (x - span / 2)) / (span / 2));
        for (const zn of zones) {
          const x0 = zn.x0;
          const x1 = zn.x1;
          quad([[x0, yAt(x0) + e, 0], [x1, yAt(x1) + e, 0], [x1, yAt(x1) + e, length], [x0, yAt(x0) + e, length]], zn[internal], [(x0 + x1) / 2, yAt((x0 + x1) / 2) + e, length / 2], [0, 1, 0]);
        }
      }
    } else {
      // viento +Z (paralelo a la cumbrera); barlovento en z = 0
      const ww = pick('Frontón barlovento');
      const lw = pick('Frontón sotavento');
      const sd = pick('Muros laterales largos');
      quad([[0, 0, -e], [0, he, -e], [span, he, -e], [span, 0, -e]], ww[internal], [span / 2, he / 2, -e], [0, 0, -1]);
      quad([[0, 0, length + e], [0, he, length + e], [span, he, length + e], [span, 0, length + e]], lw[internal], [span / 2, he / 2, length + e], [0, 0, 1]);
      quad([[-e, 0, 0], [-e, he, 0], [-e, he, length], [-e, 0, length]], sd[internal], [-e, he / 2, length / 2], [-1, 0, 0]);
      const zones = rows.filter((r) => r.x0 !== undefined && (r.caseCp === roofCase || !r.caseCp));
      for (const zn of zones) {
        const z0 = zn.x0;
        const z1 = zn.x1;
        quad([[0, he + e, z0], [span / 2, hr + e, z0], [span / 2, hr + e, z1], [0, he + e, z1]], zn[internal], [span / 4, (he + hr) / 2 + e, (z0 + z1) / 2], nL);
      }
    }
  }

  setView(name) {
    const c = new THREE.Vector3(...this.center);
    const r = this.size * 3.2;
    const pos = { iso: [-1.5, 0.9, 1.7], front: [0, 0.2, 2.2], side: [-2.2, 0.2, 0], top: [0.001, 2.4, 0] }[name];
    this.camera.position.set(c.x + (r * pos[0]) / 2.2, c.y + (r * pos[1]) / 2.2, c.z + (r * pos[2]) / 2.2);
    this.controls.target.copy(c);
  }

  resetCamera() {
    this.fit(this.size, this.center);
  }

  /** Captura PNG (dataURL) a un tamaño fijo para el reporte. */
  snapshot(w = 1400, h = 840) {
    const prev = { w: this.renderer.domElement.width, h: this.renderer.domElement.height, aspect: this.camera.aspect, pr: this.renderer.getPixelRatio() };
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setClearColor(0xffffff);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.renderer.setClearColor(0xf4f7f6);
    this.renderer.setPixelRatio(prev.pr);
    this.resize();
    return url;
  }
}
