// Visor 3D (Three.js). Convención: X y Z en planta, Y vertical.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { terrainElevation } from '../calc/wind.js';

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
    this.root = new THREE.Group(); // estructura + cargas (se traslada sobre el terreno)
    this.root.add(this.model, this.loads);
    this.terrain = new THREE.Group();
    this.scene.add(this.root, this.terrain);
    this.worldOffset = [0, 0, 0];
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

  arrow(from, dir, len, color, label, labelDy = 0) {
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
      tail.y += labelDy;
      this.loads.add(this.label(label, tail.toArray(), '#ffffff', color === COL.quake ? '#C8102E' : color === COL.suction ? '#7A3EA0' : '#1F5FA8'));
    }
  }

  fit(size, center) {
    const c = new THREE.Vector3(...center).add(new THREE.Vector3(...this.worldOffset));
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
    g.userData.isGround = true;
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
    else if (t === 'valla') this.buildValla(res);
    else if (t === 'generico') this.buildGenerico(res);
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


  buildValla(res) {
    const g = res.geometry;
    const W = g.onRoof ? g.Bx : g.B * 1.6;
    const Dd = g.onRoof ? g.By : g.B * 0.8;
    this.ground(W, Dd);
    if (g.onRoof) {
      const hs = [];
      for (let i = 0; i < g.nSt; i++) hs.push(g.firstStoryHeight + i * g.storyHeight);
      const pts = [];
      const xs = [0, g.Bx / 2, g.Bx];
      const zs = [0, g.By / 2, g.By];
      for (const x of xs) for (const z of zs) pts.push([x, 0, z], [x, g.Hb, z]);
      for (const y of hs) {
        for (const z of zs) pts.push([0, y, z], [g.Bx, y, z]);
        for (const x of xs) pts.push([x, y, 0], [x, y, g.By]);
      }
      this.model.add(this.line(pts, COL.member));
      for (const y of hs) {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(g.Bx, 0.15, g.By), new THREE.MeshStandardMaterial({ color: COL.slab, transparent: true, opacity: 0.3 }));
        slab.position.set(g.Bx / 2, y, g.By / 2);
        this.model.add(slab);
      }
    }
    const cx = W / 2;
    const cz = Dd / 2;
    this.signOrigin = [cx - g.B / 2, g.zb, cz]; // esquina inferior de barlovento del anuncio
    const panel = new THREE.Mesh(new THREE.BoxGeometry(g.B, g.s, 0.25), new THREE.MeshStandardMaterial({ color: g.panel === 'abierta' ? 0xb9c6ca : 0xe9edee, roughness: 0.8, transparent: g.panel === 'abierta', opacity: g.panel === 'abierta' ? 0.55 : 1 }));
    panel.position.set(cx, g.zb + g.s / 2, cz);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(panel.geometry), new THREE.LineBasicMaterial({ color: COL.member }));
    edge.position.copy(panel.position);
    this.model.add(panel, edge);
    if (g.direct && g.c > 0) {
      // estructura de soporte genérica bajo el anuncio (marco)
      const pts = [];
      for (const x of [cx - g.B / 2, cx, cx + g.B / 2]) pts.push([x, g.Hb, cz], [x, g.zb, cz]);
      pts.push([cx - g.B / 2, g.Hb, cz], [cx, g.zb, cz], [cx, g.Hb, cz], [cx + g.B / 2, g.zb, cz]);
      this.model.add(this.line(pts, COL.member));
    }
    for (let i = 0; i < g.nP; i++) {
      const x = g.nP === 1 ? cx : cx - g.B / 2 + (g.B * (i + 0.5)) / g.nP;
      const geo = g.postShape === 'square' ? new THREE.BoxGeometry(g.D, g.zt - g.Hb, g.D) : new THREE.CylinderGeometry(g.D / 2, g.D / 2, g.zt - g.Hb, 24);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x6f7f86, roughness: 0.6 }));
      m.position.set(x, (g.Hb + g.zt) / 2, cz - 0.4);
      this.model.add(m);
    }
    this.size = Math.max(g.zt, W) * 0.85;
    this.center = [cx, g.zt / 2, cz];
  }


  buildGenerico(res) {
    const vols = res.geometry.volumes;
    const xs = vols.flatMap((v) => [v.x - v.bx / 2, v.x + v.bx / 2]);
    const zs = vols.flatMap((v) => [v.y - (v.shape === 'cyl' ? v.bx : v.by) / 2, v.y + (v.shape === 'cyl' ? v.bx : v.by) / 2]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const z0 = Math.min(...zs);
    const z1 = Math.max(...zs);
    const grid = new THREE.GridHelper(Math.max(x1 - x0, z1 - z0, res.geometry.top) * 2.2, 22, 0xb7c4c7, 0xd4dcdc);
    grid.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    grid.userData.isGround = true;
    this.model.add(grid);
    vols.forEach((v, i) => {
      const cyl = v.shape === 'cyl';
      const open = v.tipo === 'abierto';
      const geo = cyl ? new THREE.CylinderGeometry(v.bx / 2, v.bx / 2, v.h, 32, Math.max(1, Math.round(v.h / 1.5)), open) : new THREE.BoxGeometry(v.bx, v.h, v.by);
      const color = [0x9fb3bb, 0xc3b49a, 0xa7b89c, 0xb3a2b8][i % 4];
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: open ? 0.12 : 0.55, roughness: 0.8, side: THREE.DoubleSide, depthWrite: !open }));
      mesh.position.set(v.x, v.z0 + v.h / 2, v.y);
      this.model.add(mesh);
      const edges = new THREE.LineSegments(open ? new THREE.WireframeGeometry(geo) : new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: COL.member, transparent: open, opacity: open ? 0.7 : 1 }));
      edges.position.copy(mesh.position);
      this.model.add(edges);
      if (v.nCols > 0 && v.z0 > 0) {
        const n = v.nCols;
        const pts = [];
        if (cyl) {
          for (let k = 0; k < n; k++) {
            const a = (2 * Math.PI * k) / n;
            pts.push([v.x + (v.bx / 2) * 0.85 * Math.cos(a), v.y + (v.bx / 2) * 0.85 * Math.sin(a)]);
          }
        } else {
          // columnas repartidas en el perímetro (dos líneas a lo largo de X)
          const per = Math.max(1, Math.ceil(n / 2));
          for (let k = 0; k < n; k++) {
            const row = k < per ? -1 : 1;
            const idx = k < per ? k : k - per;
            const cnt = k < per ? per : n - per;
            const fx = cnt === 1 ? 0 : -0.5 + idx / (cnt - 1);
            pts.push([v.x + fx * (v.bx - v.dCol), v.y + row * (v.by / 2 - v.dCol / 2)]);
          }
        }
        for (const [px, pz] of pts) this.model.add(this.member([px, 0, pz], [px, v.z0, pz], Math.max(v.dCol / 2, 0.06), 0x6f7f86));
      }
      if (this.showLabels) this.model.add(this.label(v.name, [v.x, v.z0 + v.h + 0.4, v.y], '#1C2A33', 'rgba(255,255,255,0.85)'));
    });
    this.size = Math.max(x1 - x0, z1 - z0, res.geometry.top) * 0.95;
    this.center = [(x0 + x1) / 2, res.geometry.top / 2, (z0 + z1) / 2];
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
    } else if (res.typology === 'generico') {
      const vols = res.geometry.volumes;
      const byName = Object.fromEntries(vols.map((v) => [v.name, v]));
      let items;
      let color;
      if (lc === 'wx' || lc === 'wy') {
        const d = res.wind.directions[lc === 'wx' ? 'X' : 'Y'];
        items = [...d.rows.map((r) => ({ v: byName[r.vol], z: r.zc, F: r.F })), ...d.cols.map((c) => ({ v: byName[c.vol], z: c.z, F: c.F, label: `Columnas: ${fmt(c.F)}` }))];
        color = COL.wind;
      } else {
        items = res.seismic.directions.X.levels.map((l) => ({ v: byName[l.vol], z: l.h, F: l.F }));
        color = COL.quake;
      }
      const Fmax = Math.max(...items.map((i) => i.F), 1e-9);
      for (const it of items) {
        const len = Math.max((L * it.F) / Fmax, L * 0.08);
        const v = it.v || vols[0];
        // la punta toca la cara de barlovento de su propio volumen
        const faceX = v.x - v.bx / 2;
        const faceZ = v.y + (v.shape === 'cyl' ? v.bx : v.by) / 2;
        if (lc === 'wy') this.arrow([v.x, it.z, faceZ + len + 0.3], [0, 0, -1], len, color, it.label || fmt(it.F));
        else this.arrow([faceX - len - 0.3, it.z, v.y], [1, 0, 0], len, color, it.label || fmt(it.F));
      }
    } else if (res.typology === 'valla') {
      const g = res.geometry;
      const [x0, , zc] = this.signOrigin;
      const cx = x0 + g.B / 2;
      if (lc === 'wA' || lc === 'wC') {
        const items = [];
        if (lc === 'wC' && res.wind.caseC) {
          for (const r of res.wind.caseC.regions) items.push({ x: x0 + r.xc, y: g.zb + g.s / 2, F: r.F, label: `${fmt(r.F)} (Cf ${r.Cfnet.toFixed(2)})` });
        } else {
          const k = res.wind.cases.find((c) => c.name === 'Caso B') || res.wind.cases[0];
          const a = res.wind.cases[0];
          items.push({ x: cx, y: a.z, F: a.F, label: `${a.name}: ${fmt(a.F)}` });
          if (k !== a) items.push({ x: x0 + g.B / 2 - k.ex, y: k.z, F: k.F, label: `Caso B (e = 0.2B): ${fmt(k.F)}`, dy: -g.s * 0.22 });
        }
        if (res.wind.posts.F > 0) items.push({ x: cx, y: res.wind.posts.z, F: res.wind.posts.F, label: `Postes: ${fmt(res.wind.posts.F)}` });
        const Fmax = Math.max(...items.map((i) => i.F));
        for (const it of items) {
          const len = Math.max((L * it.F) / Fmax, L * 0.15);
          this.arrow([it.x, it.y, zc + len + 0.6], [0, 0, -1], len, COL.wind, it.label, it.dy || 0);
        }
      } else {
        const lv = res.seismic.component ? res.seismic.component.levels : res.seismic.directions.X.levels;
        // postes agrupados en una resultante para no saturar la vista
        const posts = lv.filter((l) => l.name !== 'Anuncio');
        const Fpost = posts.reduce((a, l) => a + l.F, 0);
        const zPost = Fpost > 0 ? posts.reduce((a, l) => a + l.F * l.h, 0) / Fpost : 0;
        const pan = lv.find((l) => l.name === 'Anuncio');
        const items = [{ h: pan.h, F: pan.F, label: `${res.seismic.component ? 'Fp' : 'F'} anuncio: ${fmt(pan.F)}` }];
        if (Fpost > 0) items.push({ h: zPost, F: Fpost, label: `Postes: ${fmt(Fpost)}` });
        const Fmax = Math.max(...items.map((i) => i.F));
        for (const it of items) {
          const len = Math.max((L * it.F) / Fmax, L * 0.15);
          this.arrow([cx, g.Hb + it.h, zc + len + 0.6], [0, 0, -1], len, COL.quake, it.label);
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


  // ------------------------------------------------------------- topografía (Fig. 6-4)
  /**
   * Dibuja el relieve y coloca la estructura sobre él.
   * topo: { enabled, type, H, Lh, x }; info: { kztBase, kztTop } para la etiqueta.
   */
  setTerrain(topo, info = {}) {
    this.clear(this.terrain);
    const enabled = topo && topo.enabled && +topo.H > 0 && +topo.Lh > 0;
    this.model.traverse((o) => { if (o.userData.isGround) o.visible = !enabled; });
    if (!enabled) {
      this.worldOffset = [0, 0, 0];
      this.root.position.set(0, 0, 0);
      this.siteBox = null;
      return;
    }
    const H = +topo.H;
    const Lh = +topo.Lh;
    const xs = +topo.x || 0;
    const t = { type: topo.type, H, Lh };
    const ex = Math.max(3 * Lh, Math.abs(xs) + 3 * this.size, 4 * H);
    const x0 = Math.min(-ex, xs - 3 * this.size);
    const x1 = Math.max(topo.type === 'escarp2D' ? Math.max(Lh, 3 * this.size + xs) : ex, xs + 3 * this.size);
    const zw = topo.type === 'hill3D' ? Math.max(ex, 3 * this.size) : Math.max(1.6 * Lh, 3 * this.size, 2 * H);
    const nx = 160;
    const nz = topo.type === 'hill3D' ? 160 : 60;
    const pos = [];
    const col = [];
    const idx = [];
    const low = new THREE.Color(0x9fb88a);
    const high = new THREE.Color(0xc9b48a);
    const rock = new THREE.Color(0x8d8174);
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = x0 + ((x1 - x0) * i) / nx;
        const z = -zw + (2 * zw * j) / nz;
        const y = terrainElevation(t, x, z);
        pos.push(x, y, z);
        // pendiente para sombrear el acantilado
        const dy = (terrainElevation(t, x + 0.5, z) - terrainElevation(t, x - 0.5, z));
        const c = low.clone().lerp(high, Math.min(1, y / H)).lerp(rock, Math.min(1, Math.abs(dy) * 1.2));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide, flatShading: false }));
    this.terrain.add(mesh);
    // cresta y referencias
    const crest = [];
    if (topo.type === 'hill3D') {
      for (let k = 0; k <= 64; k++) {
        const a = (2 * Math.PI * k) / 64;
        crest.push(new THREE.Vector3(Lh * Math.cos(a), terrainElevation(t, Lh, 0) + 0.05, Lh * Math.sin(a)));
      }
      this.terrain.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(crest), new THREE.LineBasicMaterial({ color: 0x5b6b73 })));
    } else {
      const ln = (x, color) => this.terrain.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, terrainElevation(t, x) + 0.05, -zw), new THREE.Vector3(x, terrainElevation(t, x) + 0.05, zw)]), new THREE.LineBasicMaterial({ color })));
      ln(0, 0x1c2a33);
      ln(-Lh, 0x5b6b73);
    }
    const lab = (txt, p, bg = 'rgba(255,255,255,0.9)', color = '#1C2A33') => this.terrain.add(this.label(txt, p, color, bg));
    lab(`Cresta (x = 0) · H = ${H.toFixed(1)} m`, [0, H + H * 0.12, -zw * 0.6]);
    lab(`Lh = ${Lh.toFixed(1)} m (cota H/2)`, [-Lh, H * 0.5 + H * 0.1, -zw * 0.6]);
    // viento
    const wy = H + this.size * 0.4;
    const wl = Math.min(Lh, ex * 0.4);
    const d = new THREE.Vector3(1, 0, 0);
    const o = new THREE.Vector3(x0 + ex * 0.15, wy, -zw * 0.3);
    const r = Math.max(0.15, this.size * 0.012);
    const mat = new THREE.MeshStandardMaterial({ color: COL.wind });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, wl, 10), mat);
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    shaft.position.copy(o).add(d.clone().multiplyScalar(wl / 2));
    const head = new THREE.Mesh(new THREE.ConeGeometry(r * 3, r * 8, 14), mat);
    head.quaternion.copy(shaft.quaternion);
    head.position.copy(o).add(d.clone().multiplyScalar(wl + r * 4));
    this.terrain.add(shaft, head);
    lab('Viento', o.toArray(), '#1F5FA8', '#ffffff');
    // colocar la estructura
    const [cx, , cz] = this.center;
    const ground = terrainElevation(t, xs, 0);
    this.worldOffset = [xs - cx, ground, -cz];
    this.root.position.set(...this.worldOffset);
    if (info.kztBase != null) {
      lab(`Kzt = ${info.kztBase.toFixed(2)} (base) · ${info.kztTop.toFixed(2)} (cima)`, [xs, ground + this.center[1] * 2 + this.size * 0.25, 0], '#F2E330');
    }
    this.siteBox = { x0, x1, zw, H };
  }

  fitSite() {
    if (!this.siteBox) return this.resetCamera();
    const b = this.siteBox;
    const c = new THREE.Vector3((b.x0 + b.x1) / 2, b.H / 2, 0);
    const r = Math.max(b.x1 - b.x0, 2 * b.zw) * 0.55;
    this.camera.position.set(c.x - r * 0.9, c.y + r * 0.75, c.z + r * 1.25);
    this.controls.target.copy(c);
    this.camera.near = r / 200;
    this.camera.far = r * 30;
    this.camera.updateProjectionMatrix();
  }

  setView(name) {
    if (name === 'site') return this.fitSite();
    const c = new THREE.Vector3(...this.center).add(new THREE.Vector3(...this.worldOffset));
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
