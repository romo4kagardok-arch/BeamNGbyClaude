// Renders a Vehicle: procedural mesh skinned to the soft-body lattice (deforms with the physics),
// hinged doors/hood/trunk, detachable parts, breakable glass and lights, wheels.
import * as THREE from 'three';
import { buildCarParts, buildWheelMesh } from './carmesh.js';
import { clamp, lerp } from '../core/math.js';

const K = 4;
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

let sharedTex = null;
function textures() {
  if (sharedTex) return sharedTex;
  const mk = (w, h, draw) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  sharedTex = {
    plate: mk(256, 64, (g, w, h) => {
      g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#222'; g.lineWidth = 4; g.strokeRect(3, 3, w - 6, h - 6);
      g.fillStyle = '#1a3a8a'; g.fillRect(4, 4, 30, h - 8);
      g.fillStyle = '#fff'; g.font = 'bold 14px sans-serif'; g.fillText('CZ', 8, 40);
      g.fillStyle = '#111'; g.font = 'bold 40px monospace';
      const s = 'K' + Math.floor(100 + Math.random() * 899) + 'MT';
      g.fillText(s, 46, 47);
    }),
    grille: mk(128, 64, (g, w, h) => {
      g.fillStyle = '#0d0d0d'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#2a2a2a';
      for (let y = 4; y < h; y += 9) g.fillRect(0, y, w, 4);
      g.fillStyle = '#060606';
      for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 2, h);
    }),
    sign: mk(256, 40, (g, w, h) => {
      g.fillStyle = '#111'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffae00'; g.font = 'bold 30px monospace';
      g.fillText('42  ЦЕНТР', 18, 31);
    }),
    crack: mk(256, 256, (g, w, h) => {
      g.fillStyle = 'rgba(255,255,255,0.0)'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(240,245,255,0.9)';
      const cx = w * (0.3 + Math.random() * 0.4), cy = h * (0.3 + Math.random() * 0.4);
      for (let i = 0; i < 22; i++) {
        let x = cx, y = cy;
        const a0 = Math.random() * Math.PI * 2;
        g.lineWidth = 1 + Math.random();
        g.beginPath(); g.moveTo(x, y);
        for (let s = 0; s < 8; s++) {
          const a = a0 + (Math.random() - 0.5) * 0.6;
          x += Math.cos(a) * 22; y += Math.sin(a) * 22;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      for (let r = 12; r < 130; r += 18 + Math.random() * 14) {
        g.beginPath();
        for (let a = 0; a < Math.PI * 2; a += 0.3) {
          const rr = r + (Math.random() - 0.5) * 8;
          g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        g.closePath(); g.lineWidth = 0.7; g.stroke();
      }
    }),
  };
  return sharedTex;
}

let tireTexture = null;
function getTireTexture() {
  if (tireTexture) return tireTexture;
  const c = document.createElement('canvas');
  c.width = 32; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#202020'; g.fillRect(0, 0, 32, 256);
  g.fillStyle = '#0e0e0e';
  for (let y = 0; y < 256; y += 8) { g.fillRect(10, y, 12, 3); g.fillRect(0, y + 4, 6, 2); g.fillRect(26, y + 4, 6, 2); }
  tireTexture = new THREE.CanvasTexture(c);
  tireTexture.wrapS = tireTexture.wrapT = THREE.RepeatWrapping;
  tireTexture.colorSpace = THREE.SRGBColorSpace;
  return tireTexture;
}

export function makeCarMaterials(color, opts = {}) {
  const tx = textures();
  const paint = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.3, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.06, vertexColors: true, side: THREE.DoubleSide, shadowSide: THREE.FrontSide,
  });
  const lens = (c, e) => new THREE.MeshPhysicalMaterial({ color: c, emissive: e, emissiveIntensity: 0, roughness: 0.08, metalness: 0.2, transmission: 0, clearcoat: 1 });
  const m = {
    paint,
    paint2: new THREE.MeshPhysicalMaterial({ color: opts.color2 || '#f2f2f2', metalness: 0.3, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08, vertexColors: true, side: THREE.DoubleSide }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#141a22', metalness: 0.9, roughness: 0.04, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    glassCracked: new THREE.MeshPhysicalMaterial({ color: '#2a3340', map: tx.crack, metalness: 0.6, roughness: 0.3, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }),
    trim: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.75, metalness: 0.1, side: THREE.DoubleSide }),
    chrome: new THREE.MeshStandardMaterial({ color: '#d8dbe0', roughness: 0.12, metalness: 1.0 }),
    under: new THREE.MeshStandardMaterial({ color: '#0b0b0b', roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide }),
    interior: new THREE.MeshStandardMaterial({ color: '#2b2b2e', roughness: 0.9 }),
    grille: new THREE.MeshStandardMaterial({ color: '#ffffff', map: tx.grille, roughness: 0.6, metalness: 0.3 }),
    plate: new THREE.MeshStandardMaterial({ map: tx.plate, roughness: 0.5 }),
    sign: new THREE.MeshBasicMaterial({ map: tx.sign }),
    headL: lens('#e8eef5', '#fff6dd'), headR: lens('#e8eef5', '#fff6dd'),
    tailL: lens('#7a0000', '#ff1a0a'), tailR: lens('#7a0000', '#ff1a0a'),
    revL: lens('#dddddd', '#ffffff'), revR: lens('#dddddd', '#ffffff'),
    indL: lens('#d07a00', '#ffa500'), indR: lens('#d07a00', '#ffa500'),
    broken: new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.6, metalness: 0.4 }),
    barR: new THREE.MeshStandardMaterial({ color: '#600000', emissive: '#ff0000', emissiveIntensity: 0 }),
    barB: new THREE.MeshStandardMaterial({ color: '#000060', emissive: '#0030ff', emissiveIntensity: 0 }),
    tire: new THREE.MeshStandardMaterial({ color: '#ffffff', map: getTireTexture(), roughness: 0.92, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ color: opts.rimColor || '#c9ccd2', roughness: 0.25, metalness: 0.95 }),
    rimDark: new THREE.MeshStandardMaterial({ color: '#3a3a3a', roughness: 0.6, metalness: 0.7 }),
    disc: new THREE.MeshStandardMaterial({ color: '#5a5a5a', roughness: 0.45, metalness: 0.9 }),
    caliper: new THREE.MeshStandardMaterial({ color: opts.caliper || '#202020', roughness: 0.5, metalness: 0.3 }),
  };
  return m;
}

export class VehicleVisual {
  constructor(vehicle, scene, opts = {}) {
    this.v = vehicle;
    this.scene = scene;
    const def = vehicle.def;
    const cfg = vehicle.cfg;
    this.mats = makeCarMaterials(cfg.color, {
      color2: def.id === 'truck' ? '#e9e9e9' : '#f4f4f4',
      caliper: def.shape.style === 'sport' ? '#c01818' : '#262626',
    });
    if (vehicle.id === 'truck') this.mats.paint2.color.set('#eeeeee');
    this.root = new THREE.Group();
    this.root.matrixAutoUpdate = false;
    scene.add(this.root);
    const { builder, hinges } = buildCarParts(def, vehicle.shape, opts);
    this.hinges = hinges;
    const body = vehicle.body;
    this.nodeCount = body.n;
    this.D = new Float32Array(body.n * 3); // smoothed node displacement (design space)
    this.Dt = new Float32Array(body.n * 3);
    this.parts = new Map();
    this.panels = []; // breakable glass & lights
    this.lightMeshes = [];
    for (const bk of builder.buckets.values()) this.addBucket(bk);
    // hinge skinning
    for (const [name, h] of Object.entries(hinges)) {
      const p = this.parts.get(name);
      if (!p) continue;
      p.hinge = h;
      p.hingeSkin = [this.skinPoint(h.a), this.skinPoint(h.b)];
    }
    // anchors for parts
    for (const p of this.parts.values()) this.computeAnchors(p);
    // wheels
    this.wheelMeshes = [];
    for (const w of vehicle.wheels) {
      const wm = buildWheelMesh(w.radius, w.width, cfg.wheelStyle || def.wheelStyle, this.mats);
      scene.add(wm.root);
      this.wheelMeshes.push(wm);
    }
    // headlight spot lights (optional, player car)
    this.spots = [];
    this.hasSpots = false;
    this.changed = true;
    this.updateGeometry(true);
    this.lightsOn = false;
    this.blink = 0;
  }

  enableHeadlights(on) {
    if (on && !this.hasSpots) {
      const L = this.v.def.shape.lights;
      for (const side of [1, -1]) {
        const s = new THREE.SpotLight('#fff3dc', 0, 70, 0.55, 0.45, 1.2);
        s.position.set(side * L.headX, L.headY, this.v.shape.zFront - 0.1);
        s.target.position.set(side * L.headX * 0.6, 0, this.v.shape.zFront + 25);
        this.root.add(s);
        this.root.add(s.target);
        this.spots.push(s);
      }
      this.hasSpots = true;
    }
  }

  skinPoint(p) {
    const b = this.v.body;
    const rest = b.rest;
    const best = [];
    for (let i = 0; i < b.n; i++) {
      const d2 = (rest[i * 3] - p[0]) ** 2 + (rest[i * 3 + 1] - p[1]) ** 2 + (rest[i * 3 + 2] - p[2]) ** 2;
      best.push([d2, i]);
    }
    best.sort((a, c) => a[0] - c[0]);
    const sel = best.slice(0, K);
    let ws = 0;
    const out = sel.map(([d2, i]) => { const w = 1 / (d2 + 0.01); ws += w; return [i, w]; });
    out.forEach((o) => (o[1] /= ws));
    return { p, w: out };
  }

  addBucket(bk) {
    if (!bk.idx.length) return;
    const b = this.v.body;
    const rest = b.rest;
    const n = bk.pos.length / 3;
    const pos = new Float32Array(bk.pos);
    const skinI = new Uint16Array(n * K);
    const skinW = new Float32Array(n * K);
    const N = b.n;
    const dists = new Float32Array(N);
    // per-vertex nearest nodes (inverse distance weights)
    for (let v = 0; v < n; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      for (let i = 0; i < N; i++) {
        const dx = rest[i * 3] - x, dy = rest[i * 3 + 1] - y, dz = rest[i * 3 + 2] - z;
        dists[i] = dx * dx + dy * dy + dz * dz;
      }
      const sel = [-1, -1, -1, -1];
      const sd = [Infinity, Infinity, Infinity, Infinity];
      for (let i = 0; i < N; i++) {
        const d = dists[i];
        if (d < sd[3]) {
          let k = 3;
          while (k > 0 && d < sd[k - 1]) { sd[k] = sd[k - 1]; sel[k] = sel[k - 1]; k--; }
          sd[k] = d; sel[k] = i;
        }
      }
      let ws = 0;
      for (let k = 0; k < K; k++) { const w = 1 / (sd[k] + 0.015); skinW[v * K + k] = w; ws += w; skinI[v * K + k] = sel[k]; }
      for (let k = 0; k < K; k++) skinW[v * K + k] /= ws;
    }
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(new Float32Array(pos), 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bk.uv), 2));
    geo.setIndex(bk.idx);
    const isPaint = bk.mat === 'paint' || bk.mat === 'paint2';
    if (isPaint) {
      const col = new Float32Array(n * 3).fill(1);
      const ca = new THREE.BufferAttribute(col, 3);
      ca.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('color', ca);
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    let matName = bk.mat;
    const side = bk.part.endsWith('L') ? 'L' : 'R';
    if (bk.mat === 'head' || bk.mat === 'tail' || bk.mat === 'rev' || bk.mat === 'ind') matName = bk.mat + side;
    const isGlass = bk.mat.startsWith('glass');
    if (isGlass) matName = 'glass';
    const mat = this.mats[matName] || this.mats.paint;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = !isGlass && bk.mat !== 'under';
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    let part = this.parts.get(bk.part);
    if (!part) {
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      this.root.add(group);
      part = { name: bk.part, group, meshes: [], angle: 0, vel: 0, target: 0, latched: true, detached: false, anchors: [], hinge: null, broken: false };
      this.parts.set(bk.part, part);
    }
    group_add(part, mesh);
    const entry = { mesh, rest: pos, skinI, skinW, isPaint, part, mat: bk.mat, n };
    part.meshes.push(entry);
    if (isGlass) this.panels.push({ kind: 'glass', entry, part, broken: false, cracked: false, windshield: bk.mat === 'glassWS' || bk.mat === 'glassRW' });
    if (bk.mat === 'head' || bk.mat === 'tail') this.panels.push({ kind: 'light', entry, part, broken: false, matName });
  }

  computeAnchors(part) {
    const score = new Map();
    for (const e of part.meshes) {
      for (let v = 0; v < e.n; v++) for (let k = 0; k < K; k++) {
        const i = e.skinI[v * K + k];
        score.set(i, (score.get(i) || 0) + e.skinW[v * K + k]);
      }
    }
    const arr = [...score.entries()].sort((a, b) => b[1] - a[1]);
    part.anchors = arr.slice(0, Math.max(2, Math.min(8, Math.ceil(arr.length * 0.5)))).map((a) => a[0]);
    part.beams = this.beamsOf(part.anchors);
    for (const p of this.panels) if (!p.anchors) {
      const sc = new Map();
      const e = p.entry;
      for (let v = 0; v < e.n; v++) for (let k = 0; k < K; k++) {
        const i = e.skinI[v * K + k];
        sc.set(i, (sc.get(i) || 0) + e.skinW[v * K + k]);
      }
      p.anchors = [...sc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map((a) => a[0]);
      p.beams = this.beamsOf(p.anchors);
    }
  }

  beamsOf(anchors) {
    const b = this.v.body;
    const set = new Set(anchors);
    const out = [];
    for (let i = 0; i < b.m; i++) if (set.has(b.bA[i]) || set.has(b.bB[i])) out.push(i);
    return out;
  }

  // frame-independent damage: largest permanent length change (m) of beams around the part
  partDamage(beams) {
    const b = this.v.body;
    let m = 0;
    for (const i of beams) {
      const d = b.bBroken[i] ? 0.5 : Math.abs(b.bRest[i] - b.bRest0[i]);
      if (d > m) m = d;
    }
    return m;
  }

  // compute smoothed node displacements; returns true if geometry needs update
  computeDisplacement(dt) {
    const b = this.v.body;
    const D = this.D;
    const loc = this._loc || (this._loc = new Float64Array(3));
    let maxChange = 0;
    for (let i = 0; i < b.n; i++) {
      b.localNode(i, loc);
      const k = i * 3;
      const tx = loc[0] - b.rest[k], ty = loc[1] - b.rest[k + 1], tz = loc[2] - b.rest[k + 2];
      const dx = tx - D[k], dy = ty - D[k + 1], dz = tz - D[k + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > 0.006) {
        const a = Math.min(1, dt * 40);
        D[k] += dx * a; D[k + 1] += dy * a; D[k + 2] += dz * a;
        if (dist > maxChange) maxChange = dist;
      }
    }
    return maxChange > 0.002;
  }

  updateGeometry(force = false) {
    const D = this.D;
    for (const part of this.parts.values()) {
      if (part.detached) continue;
      for (const e of part.meshes) {
        const attr = e.mesh.geometry.attributes.position;
        const out = attr.array;
        const rest = e.rest, si = e.skinI, sw = e.skinW;
        const col = e.isPaint ? e.mesh.geometry.attributes.color.array : null;
        for (let v = 0; v < e.n; v++) {
          let dx = 0, dy = 0, dz = 0;
          const o = v * K;
          for (let k = 0; k < K; k++) {
            const w = sw[o + k], i = si[o + k] * 3;
            dx += D[i] * w; dy += D[i + 1] * w; dz += D[i + 2] * w;
          }
          out[v * 3] = rest[v * 3] + dx;
          out[v * 3 + 1] = rest[v * 3 + 1] + dy;
          out[v * 3 + 2] = rest[v * 3 + 2] + dz;
          if (col) {
            const dm = Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz) / 0.22);
            const c = 1 - dm * 0.55;
            col[v * 3] = c; col[v * 3 + 1] = c * (1 - dm * 0.08); col[v * 3 + 2] = c * (1 - dm * 0.15);
          }
        }
        attr.needsUpdate = true;
        if (col) e.mesh.geometry.attributes.color.needsUpdate = true;
        e.mesh.geometry.computeVertexNormals();
      }
    }
  }

  skinnedPoint(sp, out) {
    const D = this.D;
    let x = sp.p[0], y = sp.p[1], z = sp.p[2];
    for (const [i, w] of sp.w) { x += D[i * 3] * w; y += D[i * 3 + 1] * w; z += D[i * 3 + 2] * w; }
    out[0] = x; out[1] = y; out[2] = z;
    return out;
  }

  // interaction: toggle openable parts
  toggle(kind) {
    for (const p of this.parts.values()) {
      if (!p.hinge || p.detached) continue;
      if (kind === 'doors' && p.hinge.kind !== 'door') continue;
      if (kind === 'hood' && p.hinge.kind !== 'hood') continue;
      if (kind === 'trunk' && p.hinge.kind !== 'trunk' && p.hinge.kind !== 'tailgate') continue;
      p.target = p.target > 0.5 ? 0 : 1;
    }
  }

  update(dt, events) {
    const v = this.v, b = v.body;
    // root transform
    const q = b.q, c = b.com, rc = b.restCom;
    _q.set(q[0], q[1], q[2], q[3]);
    this.root.matrix.compose(_v.set(c[0], c[1], c[2]), _q, new THREE.Vector3(1, 1, 1));
    this.root.matrix.multiply(_m.makeTranslation(-rc[0], -rc[1], -rc[2]));
    this.root.matrixWorldNeedsUpdate = true;
    // deformation
    if (dt > 0 && this.computeDisplacement(dt)) this.updateGeometry();
    // local acceleration for loose parts
    const R = b.R;
    const a = v.accel;
    const alx = R[0] * a[0] + R[3] * a[1] + R[6] * a[2];
    const alz = R[2] * a[0] + R[5] * a[1] + R[8] * a[2];
    const tmpA = [0, 0, 0], tmpB = [0, 0, 0];
    for (const p of this.parts.values()) {
      if (p.detached) continue;
      const kind = p.hinge ? p.hinge.kind : p.name.startsWith('bumper') ? 'bumper' : p.name.startsWith('light') ? 'light' : 'body';
      if (kind !== 'body' && kind !== 'light' && dt > 0) {
        const dmg = this.partDamage(p.beams);
        const unl = kind === 'door' ? 0.055 : kind === 'bumper' ? 99 : 0.065;
        const det = kind === 'door' ? 0.17 : kind === 'bumper' ? 0.13 : kind === 'tailgate' ? 0.15 : 0.22;
        if (p.latched && dmg > unl && p.hinge) {
          p.latched = false;
          p.vel = Math.random() * 1.5 + 0.5;
        }
        if (dmg > det) {
          events.push({ type: 'partOff', part: p, vehicle: v, visual: this });
          continue;
        }
      }
      if (!p.hinge) continue;
      const h = p.hinge;
      const max = h.max;
      if (p.latched) {
        const tgt = p.target * max;
        p.angle += clamp(tgt - p.angle, -2.5 * dt, 2.5 * dt);
        p.vel = 0;
      } else if (dt > 0) {
        // loose swinging part: u = opening fraction 0..1, driven by inertia, wind and gravity
        const amax = Math.abs(max);
        let u = p.angle / max;
        let accOpen;
        const vf = v.fwdSpeed;
        if (h.kind === 'door') accOpen = alz * 0.7 - alx * h.side * 0.6 - 0.0025 * vf * Math.abs(vf);
        else if (h.kind === 'hood') accOpen = 0.0045 * vf * Math.abs(vf) - 7 * Math.cos(u * amax);
        else if (h.kind === 'tailgate') accOpen = 6 * Math.sin(u * amax) + 1.5;
        else accOpen = 0.002 * vf * Math.abs(vf) - 5 * Math.cos(u * amax) + alz * 0.3;
        p.vel += (accOpen / amax) * dt;
        p.vel *= Math.exp(-1.2 * dt);
        u += p.vel * dt;
        if (u < 0) { u = 0; p.vel = -p.vel * 0.25; }
        if (u > 1) { u = 1; p.vel = -p.vel * 0.3; }
        p.angle = u * max;
      }
      this.skinnedPoint(p.hingeSkin[0], tmpA);
      this.skinnedPoint(p.hingeSkin[1], tmpB);
      const ax = new THREE.Vector3(tmpB[0] - tmpA[0], tmpB[1] - tmpA[1], tmpB[2] - tmpA[2]).normalize();
      const M = p.group.matrix;
      M.makeTranslation(tmpA[0], tmpA[1], tmpA[2]);
      M.multiply(_m.makeRotationAxis(ax, p.angle));
      M.multiply(_m.makeTranslation(-tmpA[0], -tmpA[1], -tmpA[2]));
      p.group.matrixWorldNeedsUpdate = true;
    }
    // glass and lights breaking
    for (const pn of this.panels) {
      if (pn.broken || pn.part.detached) continue;
      const dmg = this.partDamage(pn.beams);
      const thr = pn.kind === 'glass' ? (pn.cracked ? 0.075 : 0.045) : 0.028;
      if (dmg > thr) {
        if (pn.kind === 'glass') {
          const ws = pn.windshield && !pn.cracked && dmg < thr * 1.6;
          if (ws) {
            pn.cracked = true;
            pn.entry.mesh.material = this.mats.glassCracked;
            events.push({ type: 'glassCrack', vehicle: v, entry: pn.entry, visual: this });
            if (dmg < thr * 1.6) continue;
          }
          pn.broken = true;
          pn.entry.mesh.visible = false;
          events.push({ type: 'glassBreak', vehicle: v, entry: pn.entry, visual: this });
        } else {
          pn.broken = true;
          pn.entry.mesh.material = this.mats.broken;
          events.push({ type: 'lightBreak', vehicle: v, entry: pn.entry, visual: this });
        }
      }
    }
    // lights
    const ctl = v.controls;
    const braking = ctl.brake > 0.1 && v.engineAlive;
    const night = this.lightsOn;
    for (const s of ['L', 'R']) {
      const head = this.mats['head' + s];
      head.emissiveIntensity = night ? 2.2 : 0;
      const tail = this.mats['tail' + s];
      tail.emissiveIntensity = braking ? 3.5 : night ? 1.2 : 0.05;
      this.mats['rev' + s].emissiveIntensity = v.gear < 0 ? 2.0 : 0;
    }
    if (this.hasSpots) {
      const fl = this.parts.get('lightFL'), fr = this.parts.get('lightFR');
      const okL = !this.panels.find((p) => p.kind === 'light' && p.part === fl && p.broken);
      const okR = !this.panels.find((p) => p.kind === 'light' && p.part === fr && p.broken);
      this.spots[0].intensity = night && okL ? 60 : 0;
      this.spots[1].intensity = night && okR ? 60 : 0;
    }
    this.blink += dt;
    const sir = v.sirenOn;
    const ph = Math.floor(this.blink * 6) % 4;
    this.mats.barR.emissiveIntensity = sir && (ph === 0 || ph === 2) ? 6 : 0;
    this.mats.barB.emissiveIntensity = sir && (ph === 1 || ph === 3) ? 6 : 0;
    const hazard = v.hazard && Math.floor(this.blink * 2.5) % 2 === 0;
    this.mats.indL.emissiveIntensity = hazard ? 3 : 0;
    this.mats.indR.emissiveIntensity = hazard ? 3 : 0;
    // wheels
    for (let i = 0; i < v.wheels.length; i++) {
      const w = v.wheels[i], wm = this.wheelMeshes[i];
      if (w.detached) { wm.root.visible = false; continue; }
      wm.root.visible = true;
      wm.root.position.set(w.center[0], w.center[1], w.center[2]);
      _q.set(q[0], q[1], q[2], q[3]);
      const steer = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), w.steerAngle + (w.side < 0 ? Math.PI : 0));
      const camber = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), w.camber * 0.5);
      wm.root.quaternion.copy(_q).multiply(steer).multiply(camber);
      wm.spin.rotation.x = w.side < 0 ? -w.spin : w.spin;
    }
  }

  setColor(c) {
    this.mats.paint.color.set(c);
  }

  setVisible(vis) {
    this.root.visible = vis;
    for (const w of this.wheelMeshes) w.root.visible = vis;
  }

  // reset all visual damage
  repair() {
    this.D.fill(0);
    for (const p of this.parts.values()) {
      if (p.detached) {
        p.detached = false;
        this.root.add(p.group);
        for (const e of p.meshes) {
          const g = e.mesh.geometry;
          if (e.origGeo) { e.mesh.geometry = e.origGeo; e.origGeo = null; }
          void g;
        }
      }
      p.latched = true;
      p.angle = 0;
      p.vel = 0;
      p.target = 0;
      p.group.visible = true;
    }
    for (const pn of this.panels) {
      pn.broken = false;
      pn.cracked = false;
      pn.entry.mesh.visible = true;
      pn.entry.mesh.material = pn.kind === 'glass' ? this.mats.glass : this.mats[pn.matName];
    }
    this.updateGeometry(true);
  }

  // detach a part: returns {geometryGroup (design space, baked), bounds}
  detachPart(p) {
    p.detached = true;
    this.root.remove(p.group);
    const g = new THREE.Group();
    const box = new THREE.Box3();
    const M = p.group.matrix;
    for (const e of p.meshes) {
      const geo = e.mesh.geometry.clone();
      geo.applyMatrix4(M);
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      box.union(geo.boundingBox);
      const mesh = new THREE.Mesh(geo, e.mesh.material);
      mesh.castShadow = true;
      mesh.visible = e.mesh.visible;
      g.add(mesh);
    }
    return { group: g, box };
  }

  dispose() {
    this.scene.remove(this.root);
    for (const w of this.wheelMeshes) this.scene.remove(w.root);
    this.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    for (const w of this.wheelMeshes) w.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    for (const m of Object.values(this.mats)) m.dispose();
  }
}

function group_add(part, mesh) {
  part.group.add(mesh);
}
