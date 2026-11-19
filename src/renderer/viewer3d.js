// Visor 3D (Three.js). Convención: X y Z en planta, Y vertical.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { terrainElevation, EXPOSURE } from '../calc/wind.js';

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
    this.env = new THREE.Group(); // entorno de exposición y perfiles de viento (coordenadas del mundo)
    this.scene.add(this.root, this.terrain, this.env);
    this.terrainRot = 0;
    this.topo = null;
    this.envOpts = { show: true, exposure: 'C' };
    this.windDir = { axis: 'X', sign: 1, kztApplies: true };
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
    const ref = this.arrowRef || this.size * 0.45;
    const r = ref * 0.012;
    const headL = Math.min(len * 0.35, ref * 0.12);
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
      const tail = o.clone().add(d.clone().multiplyScalar(-(this.arrowRef || this.size) * 0.05));
      tail.y += labelDy;
      this.loads.add(this.label(label, tail.toArray(), '#ffffff', color === COL.quake ? '#C8102E' : color === COL.suction ? '#7A3EA0' : '#1F5FA8'));
    }
  }


  thinArrow(tail, dir, len, color) {
    const r = (this.arrowRef || this.size * 0.45) * 0.005;
    const headL = Math.min(len * 0.35, (this.arrowRef || this.size) * 0.05);
    const mat = new THREE.MeshBasicMaterial({ color });
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.max(len - headL, 0.01), 6), mat);
    const head = new THREE.Mesh(new THREE.ConeGeometry(r * 3, headL, 8), mat);
    shaft.quaternion.copy(q);
    head.quaternion.copy(q);
    shaft.position.copy(tail).add(dir.clone().multiplyScalar((len - headL) / 2));
    head.position.copy(tail).add(dir.clone().multiplyScalar(len - headL / 2));
    this.loads.add(shaft, head);
  }

  fit(size, center) {
    const c = new THREE.Vector3(...center).add(new THREE.Vector3(...this.worldOffset));
    const r = size * (this.envOpts && this.envOpts.show ? 1.15 : 1);
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
    const sq = g.square;
    const shell = sq ? new THREE.BoxGeometry(D, Ht, D) : new THREE.CylinderGeometry(D / 2, D / 2, Ht, 40, 1, true);
    const tank = new THREE.Mesh(shell, new THREE.MeshStandardMaterial({ color: COL.tank, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
    tank.position.y = Hs + Ht / 2;
    const water = new THREE.Mesh(sq ? new THREE.BoxGeometry(D - 0.1, Hw, D - 0.1) : new THREE.CylinderGeometry(D / 2 - 0.05, D / 2 - 0.05, Hw, 40), new THREE.MeshStandardMaterial({ color: COL.water, transparent: true, opacity: 0.55 }));
    water.position.y = Hs + Hw / 2;
    const floor = new THREE.Mesh(sq ? new THREE.BoxGeometry(D, 0.15, D) : new THREE.CylinderGeometry(D / 2, D / 2, 0.15, 40), new THREE.MeshStandardMaterial({ color: COL.member }));
    floor.position.y = Hs;
    const roof = new THREE.Mesh(sq ? new THREE.ConeGeometry(D * 0.71, D * 0.15, 4, 1) : new THREE.ConeGeometry(D / 2, D * 0.15, 40), new THREE.MeshStandardMaterial({ color: COL.tank }));
    if (sq) roof.rotation.y = Math.PI / 4;
    roof.position.y = Hs + Ht + D * 0.075;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(shell), new THREE.LineBasicMaterial({ color: COL.member }));
    edges.position.copy(tank.position);
    this.model.add(tank, water, floor, roof, edges);
    if (g.support === 'apoyado') {
      if (Hs > 0) {
        // superficie de apoyo (no modelada): losa de referencia
        const slab = new THREE.Mesh(new THREE.BoxGeometry(D * 2, 0.3, D * 2), new THREE.MeshStandardMaterial({ color: COL.slab, transparent: true, opacity: 0.5 }));
        slab.position.y = Hs - 0.15;
        this.model.add(slab, this.label(`Apoyo a ${Hs.toFixed(1)} m`, [D, Hs, 0]));
      }
    } else if (g.support === 'pedestal') {
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
    this.size = Math.max((Hs + Ht) * 0.95, D * 1.6);
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



  /** Malla a partir de caras poligonales (cada cara = lista de puntos [x,y,z], triangulada en abanico). */
  polyMesh(faces, color, opacity, wire = false) {
    const pos = [];
    for (const f of faces) for (let i = 1; i < f.length - 1; i++) pos.push(...f[0], ...f[i], ...f[i + 1]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, roughness: 0.8, depthWrite: opacity > 0.4 })));
    const edges = [];
    for (const f of faces) for (let i = 0; i < f.length; i++) edges.push(new THREE.Vector3(...f[i]), new THREE.Vector3(...f[(i + 1) % f.length]));
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(edges), new THREE.LineBasicMaterial({ color: COL.member, transparent: wire, opacity: wire ? 0.7 : 1 })));
    return g;
  }

  roofMesh(v, color, open) {
    const rg = v.rg;
    if (!rg || rg.type === 'plano' || !(rg.rise > 0)) return null;
    const e = rg.eave;
    const t = rg.top;
    const P = (dx, y, dz) => [v.x + dx, y, v.y + dz];
    const a = v.bx / 2;
    const b = v.by / 2;
    const op = open ? 0.15 : 0.6;
    if (rg.type === 'domo') {
      const D = v.bx;
      const f = rg.rise;
      const R = (D * D / 4 + f * f) / (2 * f);
      const cap = Math.asin(Math.min(1, D / 2 / R));
      const geo = new THREE.SphereGeometry(R, 40, 16, 0, Math.PI * 2, 0, cap);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide, roughness: 0.7 }));
      m.position.set(v.x, t - R, v.y);
      const g = new THREE.Group();
      g.add(m);
      const w = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(R, 20, 6, 0, Math.PI * 2, 0, cap)), new THREE.LineBasicMaterial({ color: COL.member, transparent: true, opacity: 0.35 }));
      w.position.copy(m.position);
      g.add(w);
      return g;
    }
    if (rg.type === 'dos') {
      if (rg.ridgeDir === 'X') {
        return this.polyMesh([
          [P(-a, e, -b), P(a, e, -b), P(a, t, 0), P(-a, t, 0)],
          [P(-a, e, b), P(a, e, b), P(a, t, 0), P(-a, t, 0)],
          [P(-a, e, -b), P(-a, e, b), P(-a, t, 0)],
          [P(a, e, -b), P(a, e, b), P(a, t, 0)],
        ], color, op, open);
      }
      return this.polyMesh([
        [P(-a, e, -b), P(-a, e, b), P(0, t, b), P(0, t, -b)],
        [P(a, e, -b), P(a, e, b), P(0, t, b), P(0, t, -b)],
        [P(-a, e, -b), P(a, e, -b), P(0, t, -b)],
        [P(-a, e, b), P(a, e, b), P(0, t, b)],
      ], color, op, open);
    }
    if (rg.type === 'cuatro') {
      const r = rg.ridgeLen / 2;
      if (rg.ridgeDir === 'X') {
        return this.polyMesh([
          [P(-a, e, -b), P(a, e, -b), P(r, t, 0), P(-r, t, 0)],
          [P(-a, e, b), P(a, e, b), P(r, t, 0), P(-r, t, 0)],
          [P(-a, e, -b), P(-a, e, b), P(-r, t, 0)],
          [P(a, e, -b), P(a, e, b), P(r, t, 0)],
        ], color, op, open);
      }
      return this.polyMesh([
        [P(-a, e, -b), P(-a, e, b), P(0, t, r), P(0, t, -r)],
        [P(a, e, -b), P(a, e, b), P(0, t, r), P(0, t, -r)],
        [P(-a, e, -b), P(a, e, -b), P(0, t, -r)],
        [P(-a, e, b), P(a, e, b), P(0, t, r)],
      ], color, op, open);
    }
    if (rg.type === 'una') {
      if (rg.ridgeDir === 'X') {
        return this.polyMesh([
          [P(-a, e, -b), P(a, t, -b), P(a, t, b), P(-a, e, b)],
          [P(-a, e, -b), P(a, e, -b), P(a, t, -b)],
          [P(-a, e, b), P(a, e, b), P(a, t, b)],
          [P(a, e, -b), P(a, e, b), P(a, t, b), P(a, t, -b)],
        ], color, op, open);
      }
      return this.polyMesh([
        [P(-a, e, -b), P(a, e, -b), P(a, t, b), P(-a, t, b)],
        [P(-a, e, -b), P(-a, e, b), P(-a, t, b)],
        [P(a, e, -b), P(a, e, b), P(a, t, b)],
        [P(-a, e, b), P(a, e, b), P(a, t, b), P(-a, t, b)],
      ], color, op, open);
    }
    return null;
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
      const roof = this.roofMesh(v, color, open);
      if (roof) this.model.add(roof);
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
      if (this.showLabels) this.model.add(this.label(v.name, [v.x, (v.rg ? v.rg.top : v.z0 + v.h) + 0.4, v.y], '#1C2A33', 'rgba(255,255,255,0.85)'));
    });
    this.size = Math.max(x1 - x0, z1 - z0, res.geometry.top) * 0.95;
    this.center = [(x0 + x1) / 2, res.geometry.top / 2, (z0 + z1) / 2];
  }

  // ------------------------------------------------------------- cargas
  /** Longitud de referencia de las flechas: acotada por la planta para estructuras esbeltas o muy altas. */
  computeArrowRef() {
    const box = new THREE.Box3();
    this.model.traverse((o) => { if ((o.isMesh || o.isLineSegments) && !o.userData.isGround && !o.userData.isLabel) box.expandByObject(o); });
    if (box.isEmpty()) return this.size * 0.45;
    const sz = box.getSize(new THREE.Vector3());
    const plan = Math.max(sz.x, sz.z);
    const H = sz.y;
    return Math.min(0.45 * Math.max(plan, H), Math.max(0.9 * plan, 0.15 * H));
  }

  /** Índices a etiquetar cuando hay muchas fuerzas: ~12 repartidas + extremos + máximo. */
  labelSet(values) {
    const n = values.length;
    if (n <= 14) return new Set(values.map((_, i) => i));
    const step = Math.ceil(n / 12);
    const set = new Set([0, n - 1]);
    for (let i = 0; i < n; i += step) set.add(i);
    let im = 0;
    values.forEach((v, i) => { if (v > values[im]) im = i; });
    set.add(im);
    return set;
  }

  /** Perfil que une las colas de las flechas (lectura de la distribución en altura). */
  profile(points, color) {
    if (points.length < 3) return;
    const g = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
    this.loads.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 })));
  }

  setLoadCase(lc, opts = {}) {
    this.clear(this.loads);
    const res = this.res;
    if (!res || lc === 'none') return;
    this.arrowRef = this.computeArrowRef();
    const L = this.arrowRef;
    const fmt = (v) => `${v.toFixed(1)} kN`;
    if (res.typology === 'edificio') {
      const { Bx, By } = res.geometry;
      const dir = lc.endsWith('x') ? 'X' : 'Y';
      const rows = lc.startsWith('w') ? res.wind.directions[dir].rows : res.seismic.directions[dir].levels;
      const Fmax = Math.max(...rows.map((r) => r.F));
      const color = lc.startsWith('w') ? COL.wind : COL.quake;
      const lab = this.labelSet(rows.map((r) => r.F));
      const tails = [];
      rows.forEach((r, i) => {
        const len = Math.max((L * r.F) / Fmax, L * 0.02);
        const gap = L * 0.02;
        if (dir === 'X') {
          this.arrow([-len - gap, r.h, By / 2], [1, 0, 0], len, color, lab.has(i) ? fmt(r.F) : null);
          tails.push([-len - gap, r.h, By / 2]);
        } else {
          this.arrow([Bx / 2, r.h, By + len + gap], [0, 0, -1], len, color, lab.has(i) ? fmt(r.F) : null);
          tails.push([Bx / 2, r.h, By + len + gap]);
        }
      });
      if (rows.length > 8) this.profile(tails, color);
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
        const lab = this.labelSet(res.wind.segs.map((s) => s.F));
        items.forEach((it, i) => { if (!it.app && !lab.has(i)) it.nolabel = true; });
        for (const it of items) {
          const len = (L * it.F) / Fmax;
          // accesorios: flecha por el lado opuesto para no encimarse con los segmentos
          if (it.app) this.arrow([half(it.z) + len + 0.3, it.z, 0], [-1, 0, 0], len, COL.wind, `${it.app}: ${fmt(it.F)}`);
          else this.arrow([-half(it.z) - len - 0.3, it.z, 0], [1, 0, 0], len, COL.wind, it.nolabel ? null : fmt(it.F));
        }
      } else {
        const lv = res.seismic.directions.X.levels;
        const Fmax = Math.max(...lv.map((l) => l.F));
        const lab = this.labelSet(lv.map((l) => l.F));
        lv.forEach((l, i) => {
          const len = (L * l.F) / Fmax;
          this.arrow([-half(l.h) - len - 0.3, l.h, 0], [1, 0, 0], len, COL.quake, lab.has(i) ? fmt(l.F) : null);
        });
      }
    } else if (res.typology === 'generico') {
      const vols = res.geometry.volumes;
      const byName = Object.fromEntries(vols.map((v) => [v.name, v]));
      if (lc === 'wx' || lc === 'wy') {
        // viento como presión repartida sobre la cara de barlovento + una resultante por volumen
        const isX = lc === 'wx';
        const d = res.wind.directions[isX ? 'X' : 'Y'];
        const dirv = isX ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1);
        const across = isX ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
        const wall = d.rows.filter((r) => !r.roof);
        const pmax = Math.max(...wall.map((r) => r.p), 1e-9);
        const Fmax = Math.max(...d.perVol.map((x) => x.F), ...d.cols.map((c) => c.F), 1e-9);
        const ramp = (p) => new THREE.Color(0xdfeaf7).lerp(new THREE.Color(COL.wind), 0.25 + 0.75 * Math.min(1, p / pmax));
        const faceOf = (v) => {
          // punto central de la cara de barlovento (plano normal al viento)
          const half = isX ? v.bx / 2 : (v.shape === 'cyl' ? v.bx : v.by) / 2;
          return new THREE.Vector3(v.x, 0, v.y).add(dirv.clone().multiplyScalar(-(half + 0.06)));
        };
        for (const v of vols) {
          const rr = wall.filter((r) => r.vol === v.name);
          if (!rr.length) continue;
          const f0 = faceOf(v);
          const b = rr[0].b;
          // lámina de presión: una banda por franja, coloreada por p (kPa)
          for (const r of rr) {
            const pts = [
              f0.clone().add(across.clone().multiplyScalar(-b / 2)).setY(r.z0),
              f0.clone().add(across.clone().multiplyScalar(b / 2)).setY(r.z0),
              f0.clone().add(across.clone().multiplyScalar(b / 2)).setY(r.z1),
              f0.clone().add(across.clone().multiplyScalar(-b / 2)).setY(r.z1),
            ];
            const geo = new THREE.BufferGeometry().setFromPoints([pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]]);
            this.loads.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: ramp(r.p), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })));
            // campo de flechas pequeñas: la carga actúa en toda la superficie
            const nCol = Math.max(2, Math.min(5, Math.round(b / Math.max(1, (r.z1 - r.z0)))));
            for (let k = 0; k < nCol; k++) {
              const off = -b / 2 + (b * (k + 0.5)) / nCol;
              const len = L * 0.22 * (r.p / pmax) + L * 0.03;
              const tip = f0.clone().add(across.clone().multiplyScalar(off)).setY(r.zc);
              const tail = tip.clone().add(dirv.clone().multiplyScalar(-len));
              this.thinArrow(tail, dirv, len, COL.wind);
            }
          }
          // etiquetas de presión en la franja inferior y superior
          const lo = rr[0];
          const hi = rr[rr.length - 1];
          if (this.showLabels) {
            this.loads.add(this.label(`${lo.p.toFixed(2)} kPa`, f0.clone().add(across.clone().multiplyScalar(-b / 2 - 0.2)).setY(lo.zc).toArray(), '#1C2A33', 'rgba(255,255,255,0.9)'));
            if (hi !== lo) this.loads.add(this.label(`${hi.p.toFixed(2)} kPa`, f0.clone().add(across.clone().multiplyScalar(-b / 2 - 0.2)).setY(hi.zc).toArray(), '#1C2A33', 'rgba(255,255,255,0.9)'));
          }
          // resultante del volumen
          const pv = d.perVol.find((x) => x.vol === v.name);
          const len = Math.max((L * 0.9 * pv.F) / Fmax, L * 0.15);
          const tip = f0.clone().add(across.clone().multiplyScalar(b / 2 + 0.6)).setY(pv.z);
          this.arrow(tip.clone().add(dirv.clone().multiplyScalar(-len)).toArray(), dirv.toArray(), len, COL.wind, `${v.name}: F = ${fmt(pv.F)}`);
        }
        for (const c of d.cols) {
          const v = byName[c.vol];
          const f0 = faceOf(v);
          const len = Math.max((L * 0.9 * c.F) / Fmax, L * 0.12);
          const tip = f0.clone().setY(c.z);
          this.arrow(tip.clone().add(dirv.clone().multiplyScalar(-len)).toArray(), dirv.toArray(), len, COL.wind, `Columnas: ${fmt(c.F)}`);
        }
      } else {
        const items = res.seismic.directions.X.levels.map((l) => ({ v: byName[l.vol], z: l.h, F: l.F }));
        const Fmax = Math.max(...items.map((i) => i.F), 1e-9);
        const lab = this.labelSet(items.map((i) => i.F));
        items.forEach((it, i) => {
          const len = Math.max((L * it.F) / Fmax, L * 0.08);
          const v = it.v || vols[0];
          const faceX = v.x - v.bx / 2;
          this.arrow([faceX - len - 0.3, it.z, v.y], [1, 0, 0], len, COL.quake, lab.has(i) ? fmt(it.F) : null);
        });
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
    const pmax = Math.max(...rows.map((r) => Math.abs(r[internal])), 0.01);
    const color = (p) => {
      const t = Math.min(1, Math.abs(p) / pmax);
      return new THREE.Color(0xffffff).lerp(new THREE.Color(p >= 0 ? COL.wind : COL.suction), 0.25 + 0.75 * t);
    };
    /**
     * Superficie poligonal con presión p (kPa, + hacia la superficie) y normal exterior n.
     * Se colorea y se cubre con un campo de flechas: la carga actúa en toda la superficie.
     */
    this.naveSurfaces = [];
    const surface = (poly, p, n, label) => {
      const P = poly.map((q) => new THREE.Vector3(...q));
      const N = new THREE.Vector3(...n).normalize();
      this.naveSurfaces.push({ label, p, n: [N.x, N.y, N.z] });
      const off = N.clone().multiplyScalar(0.03);
      const tri = [];
      for (let i = 1; i < P.length - 1; i++) tri.push(P[0].clone().add(off), P[i].clone().add(off), P[i + 1].clone().add(off));
      const geo = new THREE.BufferGeometry().setFromPoints(tri);
      this.loads.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: color(p), transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })));
      // una flecha por superficie en su centro (estilo de la versión 1.2.0):
      // hacia la superficie si hay presión (p > 0), alejándose si hay succión (p < 0)
      const c = P.reduce((acc, q) => acc.add(q), new THREE.Vector3()).multiplyScalar(1 / P.length).add(off);
      const len = (this.size * 0.16 * Math.abs(p)) / pmax + 0.5;
      if (p >= 0) this.arrow(c.clone().add(N.clone().multiplyScalar(len)).toArray(), N.clone().negate().toArray(), len, COL.wind);
      else this.arrow(c.toArray(), N.toArray(), len, COL.suction);
      if (this.showLabels) this.loads.add(this.label(`${p.toFixed(2)} kPa`, c.clone().add(N.clone().multiplyScalar(0.3)).toArray(), '#ffffff', p >= 0 ? '#1F5FA8' : '#7A3EA0'));
      void label;
    };
    const sA = Math.atan2(hr - he, span / 2);
    const nL = [-Math.sin(sA), Math.cos(sA), 0];
    const nR = [Math.sin(sA), Math.cos(sA), 0];
    const gable = (z) => [[0, 0, z], [span, 0, z], [span, he, z], [span / 2, hr, z], [0, he, z]];
    const yAt = (x) => (x <= span / 2 ? he + ((hr - he) * x) / (span / 2) : hr - ((hr - he) * (x - span / 2)) / (span / 2));
    if (which === 'transversal') {
      // viento +X; barlovento en x = 0; los frontones (z = 0 y z = L) son muros laterales
      surface([[0, 0, length], [0, 0, 0], [0, he, 0], [0, he, length]], pick('Muro barlovento')[internal], [-1, 0, 0], 'Barlovento');
      surface([[span, 0, 0], [span, 0, length], [span, he, length], [span, he, 0]], pick('Muro sotavento')[internal], [1, 0, 0], 'Sotavento');
      const sd = pick('Muros laterales (frontones)')[internal];
      surface(gable(0), sd, [0, 0, -1], 'Lateral');
      surface(gable(length), sd, [0, 0, 1], 'Lateral');
      const rww = pick('Techo barlovento');
      const rlw = pick('Techo sotavento');
      if (rww && rlw) {
        surface([[0, he, length], [0, he, 0], [span / 2, hr, 0], [span / 2, hr, length]], rww[internal], nL, 'Techo barl.');
        surface([[span / 2, hr, length], [span / 2, hr, 0], [span, he, 0], [span, he, length]], rlw[internal], nR, 'Techo sotav.');
      } else {
        const zones = rows.filter((r) => r.x0 !== undefined && (r.caseCp === roofCase || !r.caseCp));
        for (const zn of zones) {
          // la zona puede cruzar la cumbrera: se parte en los dos faldones
          const cuts = [zn.x0, ...(zn.x0 < span / 2 && zn.x1 > span / 2 ? [span / 2] : []), zn.x1];
          for (let k = 0; k < cuts.length - 1; k++) {
            const xa = cuts[k];
            const xb = cuts[k + 1];
            const nrm = (xa + xb) / 2 <= span / 2 ? nL : nR;
            surface([[xa, yAt(xa), length], [xa, yAt(xa), 0], [xb, yAt(xb), 0], [xb, yAt(xb), length]], zn[internal], nrm, '');
          }
        }
      }
    } else {
      // viento +Z (paralelo a la cumbrera); barlovento en z = 0
      surface(gable(0), pick('Frontón barlovento')[internal], [0, 0, -1], 'Barlovento');
      surface(gable(length), pick('Frontón sotavento')[internal], [0, 0, 1], 'Sotavento');
      const sd = pick('Muros laterales largos')[internal];
      surface([[0, 0, length], [0, 0, 0], [0, he, 0], [0, he, length]], sd, [-1, 0, 0], 'Lateral');
      surface([[span, 0, 0], [span, 0, length], [span, he, length], [span, he, 0]], sd, [1, 0, 0], 'Lateral');
      const zones = rows.filter((r) => r.x0 !== undefined && (r.caseCp === roofCase || !r.caseCp));
      for (const zn of zones) {
        const z0 = zn.x0;
        const z1 = Math.min(zn.x1, length);
        surface([[0, he, z0], [0, he, z1], [span / 2, hr, z1], [span / 2, hr, z0]], zn[internal], nL, '');
        surface([[span / 2, hr, z0], [span / 2, hr, z1], [span, he, z1], [span, he, z0]], zn[internal], nR, '');
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
      this.topo = null;
      this.terrainRot = 0;
      this.terrain.rotation.y = 0;
      this.worldOffset = [0, 0, 0];
      this.root.position.set(0, 0, 0);
      this.siteBox = null;
      return;
    }
    const H = +topo.H;
    const Lh = +topo.Lh;
    const xs = +topo.x || 0;
    const t = { type: topo.type, H, Lh };
    // la cresta se orienta perpendicular a la dirección de viento con la que se calcula Kzt
    this.terrainRot = this.res && this.res.typology === 'valla' ? Math.PI / 2 : 0;
    this.terrain.rotation.y = this.terrainRot;
    this.topo = t;
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
    // colocar la estructura
    const [cx, , cz] = this.center;
    const ground = terrainElevation(t, xs, 0);
    const [wx, wz] = this.toWorld(xs, 0);
    this.worldOffset = [wx - cx, ground, wz - cz];
    this.root.position.set(...this.worldOffset);
    if (info.kztBase != null) {
      lab(`Kzt = ${info.kztBase.toFixed(2)} (base) · ${info.kztTop.toFixed(2)} (cima)`, [xs, ground + this.center[1] * 2 + this.size * 0.25, 0], '#F2E330');
    }
    this.siteBox = { x0, x1, zw, H };
  }


  // ------------------------------------------------------------- entorno de exposición y perfiles de viento
  toWorld(lx, lz) {
    const c = Math.cos(this.terrainRot);
    const s = Math.sin(this.terrainRot);
    return [lx * c + lz * s, -lx * s + lz * c];
  }
  toLocal(wx, wz) {
    const c = Math.cos(this.terrainRot);
    const s = Math.sin(this.terrainRot);
    return [wx * c - wz * s, wx * s + wz * c];
  }
  groundAt(wx, wz) {
    if (!this.topo) return 0;
    const [lx, lz] = this.toLocal(wx, wz);
    return terrainElevation(this.topo, lx, lz);
  }

  /** opts: { show, exposure, topoActive } */
  setEnvironment(opts) {
    this.envOpts = { ...this.envOpts, ...opts };
    this.buildEnvironment();
  }

  /** dir: { axis: 'X'|'Z', sign: ±1, kztApplies } */
  setWindDir(dir) {
    const d = { ...this.windDir, ...dir };
    const changed = d.axis !== this.windDir.axis || d.sign !== this.windDir.sign || d.kztApplies !== this.windDir.kztApplies;
    this.windDir = d;
    if (changed) this.buildEnvironment();
  }

  buildEnvironment() {
    this.clear(this.env);
    if (!this.res || !this.envOpts.show) return;
    const exp = this.envOpts.exposure;
    const C = new THREE.Vector3(...this.center).add(new THREE.Vector3(...this.worldOffset));
    const box = new THREE.Box3();
    this.model.traverse((o) => { if ((o.isMesh || o.isLineSegments) && !o.userData.isGround) box.expandByObject(o); });
    const sz = box.isEmpty() ? new THREE.Vector3(10, 10, 10) : box.getSize(new THREE.Vector3());
    const r0 = Math.hypot(sz.x, sz.z) / 2 + 6;
    const R = Math.min(400, Math.max(45, r0 * 3.2, this.size * 2.2));
    const dir = this.windDir.axis === 'X' ? new THREE.Vector3(this.windDir.sign, 0, 0) : new THREE.Vector3(0, 0, this.windDir.sign);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    // ---- suelo y agua
    if (!this.topo) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 64), new THREE.MeshStandardMaterial({ color: { B: 0xd8d4cb, C: 0xcfe0b9, D: 0xe8dfc3 }[exp], roughness: 1 }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(C.x, -0.03, C.z);
      this.env.add(disc);
    }
    const inWater = (x, z) => exp === 'D' && new THREE.Vector3(x - C.x, 0, z - C.z).dot(dir) < -r0;
    if (exp === 'D') {
      const len = R * 1.1;
      const water = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, len), new THREE.MeshStandardMaterial({ color: 0x5f9fcf, transparent: true, opacity: 0.85, roughness: 0.3 }));
      water.rotation.x = -Math.PI / 2;
      if (this.windDir.axis === 'X') water.rotation.z = Math.PI / 2;
      const c = C.clone().add(dir.clone().multiplyScalar(-(r0 + len / 2)));
      water.position.set(c.x, (this.topo ? 0 : 0) + 0.02, c.z);
      this.env.add(water);
    }

    // ---- obstáculos (edificaciones y árboles) según la exposición
    const nObj = { B: 190, C: 26, D: 6 }[exp];
    const houses = [];
    const trees = [];
    for (let i = 0; i < nObj * 4 && houses.length + trees.length < nObj; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = r0 + (R - r0) * Math.sqrt(rnd());
      const x = C.x + rr * Math.cos(a);
      const z = C.z + rr * Math.sin(a);
      if (inWater(x, z)) continue;
      // no tapar la vista: se excluye el sector hacia la cámara isométrica (-X, +Z)
      const cam = new THREE.Vector3(-0.66, 0, 0.75);
      const rel = new THREE.Vector3(x - C.x, 0, z - C.z);
      if (rel.clone().normalize().dot(cam) > 0.55 && rr < R * 0.95) continue;
      const g = this.groundAt(x, z);
      if (this.topo) {
        const slope = Math.abs(this.groundAt(x + 1, z) - this.groundAt(x - 1, z)) + Math.abs(this.groundAt(x, z + 1) - this.groundAt(x, z - 1));
        if (slope > 1.2) continue; // no se colocan sobre el acantilado
      }
      const isTree = exp === 'D' ? true : rnd() < (exp === 'B' ? 0.35 : 0.6);
      if (isTree) trees.push({ x, z, g, h: 4 + rnd() * 6 });
      else houses.push({ x, z, g, w: exp === 'B' ? 6 + rnd() * 8 : 5 + rnd() * 4, d: exp === 'B' ? 6 + rnd() * 8 : 5 + rnd() * 4, h: exp === 'B' ? (rnd() < 0.12 && rr > r0 * 1.8 ? 14 + rnd() * 10 : 5 + rnd() * 8) : 3.5 + rnd() * 2.5, rot: rnd() * Math.PI });
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    if (houses.length) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9 }), houses.length);
      houses.forEach((h, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h.rot);
        m4.compose(new THREE.Vector3(h.x, h.g + h.h / 2, h.z), q, new THREE.Vector3(h.w, h.h, h.d));
        im.setMatrixAt(i, m4);
        im.setColorAt(i, new THREE.Color().setHSL(0.08, 0.12, 0.62 + rnd() * 0.18));
      });
      this.env.add(im);
    }
    if (trees.length) {
      const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 8), new THREE.MeshStandardMaterial({ color: 0x5f8f4e, roughness: 1 }), trees.length);
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.2, 1, 6), new THREE.MeshStandardMaterial({ color: 0x7a5c3e }), trees.length);
      trees.forEach((t, i) => {
        m4.compose(new THREE.Vector3(t.x, t.g + t.h * 0.6, t.z), new THREE.Quaternion(), new THREE.Vector3(t.h * 0.32, t.h * 0.8, t.h * 0.32));
        crown.setMatrixAt(i, m4);
        m4.compose(new THREE.Vector3(t.x, t.g + t.h * 0.12, t.z), new THREE.Quaternion(), new THREE.Vector3(1, t.h * 0.25, 1));
        trunk.setMatrixAt(i, m4);
      });
      this.env.add(crown, trunk);
    }

    // ---- una sola flecha que indica la dirección del viento (a barlovento de la estructura)
    const e = EXPOSURE[exp];
    const expTxt = { B: 'B – urbana / suburbana', C: 'C – terreno abierto', D: 'D – costa / agua' }[exp];
    const topoOn = this.topo && this.envOpts.topoActive;
    const Lw = Math.max(this.size * 0.55, 8);
    const rad = Math.max(0.12, Lw * 0.03);
    const headL = Lw * 0.25;
    // sobre la estructura, cruzándola en la dirección del viento (siempre dentro del encuadre)
    const tail = C.clone().add(dir.clone().multiplyScalar(-Lw * 0.65));
    const tip = tail.clone().add(dir.clone().multiplyScalar(Lw));
    const yW = this.groundAt(C.x, C.z) + sz.y + Math.max(2, this.size * 0.18);
    tip.y = yW;
    tail.y = yW;
    const mat = new THREE.MeshStandardMaterial({ color: COL.wind });
    const qDir = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, Lw - headL, 16), mat);
    const head = new THREE.Mesh(new THREE.ConeGeometry(rad * 2.6, headL, 20), mat);
    shaft.quaternion.copy(qDir);
    head.quaternion.copy(qDir);
    shaft.position.copy(tail).add(dir.clone().multiplyScalar((Lw - headL) / 2));
    head.position.copy(tail).add(dir.clone().multiplyScalar(Lw - headL / 2));
    this.env.add(shaft, head);
    this.env.add(this.label(`Viento · Exposición ${expTxt} (α = ${e.alpha}, zg = ${e.zg.toFixed(0)} m)`, tail.clone().add(new THREE.Vector3(0, rad * 4 + 1, 0)).toArray(), '#ffffff', '#1F5FA8'));
    if (topoOn && !this.windDir.kztApplies) {
      this.env.add(this.label('Viento paralelo a la cresta: Kzt = 1.00', [C.x, this.groundAt(C.x, C.z) + sz.y * 1.3 + 2, C.z], '#1C2A33', '#F2E330'));
    }
    void side;
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
