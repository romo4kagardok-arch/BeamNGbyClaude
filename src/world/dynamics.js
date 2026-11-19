// Dynamic objects: props (cones, barrels, crates...), detached car parts, lost wheels, fallen trees.
// Each is a small soft body in the shared physics world plus a mesh following its best-fit frame.
import * as THREE from 'three';
import { SoftBodyBuilder } from '../physics/softbody.js';
import { quatFromYaw } from '../core/math.js';
import { worldTextures } from './textures.js';
import { buildWheelMesh } from '../vehicle/carmesh.js';

export const PROP_DEFS = {
  cone: { name: 'Конус', mass: 4 },
  barrel: { name: 'Бочка', mass: 28 },
  crate: { name: 'Ящик', mass: 60 },
  pin: { name: 'Кегля', mass: 18 },
  barrier: { name: 'Бетонный блок', mass: 650 },
  hay: { name: 'Тюк сена', mass: 140 },
  tires: { name: 'Стопка шин', mass: 60 },
};

function allPairs(B, opts) {
  const n = B.nodes.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) B.addBeam(a, b, opts);
}

export function boxBody(hx, hy, hz, mass, opts = {}) {
  const B = new SoftBodyBuilder();
  const r = opts.radius ?? Math.min(0.15, Math.min(hx, hy, hz) * 0.5);
  const m = mass / 8;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    B.addNode(sx * (hx - r * 0.7), sy * (hy - r * 0.7) + (opts.oy || 0), sz * (hz - r * 0.7), m, r, { friction: opts.friction ?? 0.6 });
  }
  const k = opts.kBase ?? mass * 2500;
  allPairs(B, { kBase: k, damping: mass * 8, yieldStrain: opts.yieldStrain ?? 0.2, breakStretch: 5 });
  return B.build();
}

export function prismBody(r, hh, sides, mass, axis = 'y', opts = {}) {
  const B = new SoftBodyBuilder();
  const nr = opts.radius ?? Math.min(0.12, r * 0.35);
  const m = mass / (sides * 2 + 2);
  const P = (u, v, w) => (axis === 'y' ? [u, w, v] : axis === 'x' ? [w, u, v] : [u, v, w]);
  for (const s of [-1, 1]) {
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const p = P(Math.cos(a) * (r - nr * 0.6), Math.sin(a) * (r - nr * 0.6), s * (hh - nr * 0.6));
      B.addNode(p[0], p[1], p[2], m, nr, { friction: opts.friction ?? 0.6 });
    }
    const c = P(0, 0, s * (hh - nr * 0.6));
    B.addNode(c[0], c[1], c[2], m, nr * 0.5, { collide: 0 });
  }
  const k = opts.kBase ?? mass * 3000;
  allPairs(B, { kBase: k, damping: mass * 6, yieldStrain: opts.yieldStrain ?? 0.3, breakStretch: 5 });
  return B.build();
}

let mats = null;
function propMaterials() {
  if (mats) return mats;
  const tx = worldTextures();
  mats = {
    cone: new THREE.MeshStandardMaterial({ color: '#ff5a0a', roughness: 0.55 }),
    white: new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.5 }),
    black: new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.8 }),
    barrel: new THREE.MeshStandardMaterial({ color: '#1d5fa8', roughness: 0.4, metalness: 0.5 }),
    barrelRed: new THREE.MeshStandardMaterial({ color: '#b52020', roughness: 0.4, metalness: 0.5 }),
    crate: new THREE.MeshStandardMaterial({ map: tx.crate, roughness: 0.85 }),
    concrete: new THREE.MeshStandardMaterial({ map: tx.concrete, color: '#eeeae2', roughness: 0.9 }),
    hazard: new THREE.MeshStandardMaterial({ map: tx.hazard, roughness: 0.6 }),
    hay: new THREE.MeshStandardMaterial({ color: '#d8b860', roughness: 1 }),
    tire: new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.9 }),
  };
  return mats;
}

function propMesh(type) {
  const M = propMaterials();
  const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  switch (type) {
    case 'cone':
      add(new THREE.ConeGeometry(0.17, 0.62, 14), M.cone, 0, 0.02, 0);
      add(new THREE.CylinderGeometry(0.105, 0.135, 0.12, 14, 1, true), M.white, 0, -0.02, 0);
      add(new THREE.BoxGeometry(0.4, 0.04, 0.4), M.black, 0, -0.33, 0);
      break;
    case 'barrel': {
      const mat = Math.random() < 0.5 ? M.barrel : M.barrelRed;
      add(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 18), mat);
      for (const y of [-0.22, 0.22]) add(new THREE.TorusGeometry(0.302, 0.015, 6, 20).rotateX(Math.PI / 2), mat, 0, y, 0);
      break;
    }
    case 'crate':
      add(new THREE.BoxGeometry(1.2, 1.2, 1.2), M.crate);
      break;
    case 'pin': {
      const pts = [];
      const prof = [[0, -0.8], [0.18, -0.8], [0.26, -0.5], [0.28, -0.2], [0.16, 0.25], [0.12, 0.38], [0.17, 0.58], [0.15, 0.74], [0, 0.8]];
      for (const p of prof) pts.push(new THREE.Vector2(p[0], p[1]));
      add(new THREE.LatheGeometry(pts, 18), M.white);
      add(new THREE.TorusGeometry(0.135, 0.03, 6, 18).rotateX(Math.PI / 2), M.barrelRed, 0, 0.34, 0);
      break;
    }
    case 'barrier': {
      const s = new THREE.Shape();
      s.moveTo(-0.3, -0.45); s.lineTo(0.3, -0.45); s.lineTo(0.22, -0.2); s.lineTo(0.1, 0.45); s.lineTo(-0.1, 0.45); s.lineTo(-0.22, -0.2); s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, { depth: 2.0, bevelEnabled: false });
      geo.translate(0, 0, -1.0);
      geo.rotateY(Math.PI / 2);
      add(geo, M.concrete);
      break;
    }
    case 'hay':
      add(new THREE.CylinderGeometry(0.6, 0.6, 1.2, 16).rotateZ(Math.PI / 2), M.hay);
      break;
    case 'tires':
      for (let i = 0; i < 4; i++) add(new THREE.TorusGeometry(0.33, 0.13, 8, 16).rotateX(Math.PI / 2), M.tire, 0, -0.4 + i * 0.26, 0);
      break;
  }
  return g;
}

function propBody(type) {
  switch (type) {
    case 'cone': return boxBody(0.18, 0.34, 0.18, 4, { radius: 0.07, friction: 0.7 });
    case 'barrel': return prismBody(0.3, 0.45, 8, 28, 'y', { radius: 0.09 });
    case 'crate': return boxBody(0.6, 0.6, 0.6, 60, { radius: 0.14, yieldStrain: 0.03 });
    case 'pin': return prismBody(0.24, 0.8, 6, 18, 'y', { radius: 0.09 });
    case 'barrier': return boxBody(1.0, 0.45, 0.28, 650, { radius: 0.14, friction: 0.7 });
    case 'hay': return prismBody(0.6, 0.6, 8, 140, 'x', { radius: 0.15, yieldStrain: 0.05 });
    case 'tires': return prismBody(0.45, 0.52, 8, 60, 'y', { radius: 0.12 });
  }
  return boxBody(0.5, 0.5, 0.5, 30);
}

const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _m = new THREE.Matrix4();

export class Dynamics {
  constructor(scene, world, terrain) {
    this.scene = scene;
    this.world = world;
    this.terrain = terrain;
    this.items = [];
    this.maxDebris = 60;
  }

  add(body, obj, opts = {}) {
    obj.matrixAutoUpdate = false;
    this.scene.add(obj);
    this.world.addBody(body);
    const it = { body, obj, kind: opts.kind || 'prop', life: opts.life ?? Infinity, age: 0, ignoreTimer: opts.ignoreTimer || 0, persistent: !!opts.persistent, data: opts.data || null };
    this.items.push(it);
    this.syncItem(it);
    // trim old debris
    const debris = this.items.filter((i) => i.kind === 'debris' || i.kind === 'wheel');
    if (debris.length > this.maxDebris) this.remove(debris[0]);
    return it;
  }

  spawnProp(type, x, y, z, yaw = 0, opts = {}) {
    const body = propBody(type);
    body.canSleep = true;
    const g = y ?? this.terrain.heightAt(x, z);
    let minY = Infinity;
    for (let i = 0; i < body.n; i++) minY = Math.min(minY, body.rest[i * 3 + 1] - body.radius[i]);
    body.placeAt([x, g - minY + body.restCom[1] + 0.02 + (opts.yOff || 0), z], quatFromYaw(yaw));
    if (!opts.awake) { body.sleeping = true; body.computeAABB(); }
    body.ownerType = type;
    const obj = propMesh(type);
    return this.add(body, obj, { kind: 'prop', persistent: opts.persistent, data: { type, x, z, yaw, yOff: opts.yOff || 0 } });
  }

  // detached panel from a car (info from VehicleVisual.detachPart)
  spawnPart(info, carBody) {
    const b = info.box;
    const c = new THREE.Vector3();
    b.getCenter(c);
    const size = new THREE.Vector3();
    b.getSize(size);
    const hx = Math.max(0.08, size.x / 2), hy = Math.max(0.06, size.y / 2), hz = Math.max(0.08, size.z / 2);
    const vol = hx * hy * hz * 8;
    const mass = Math.min(40, 6 + vol * 30);
    const body = boxBody(hx, hy, hz, mass, { radius: Math.min(0.06, Math.min(hx, hy, hz) * 0.8), yieldStrain: 0.05 });
    // shift design space so node rest coordinates match the car design space
    for (let i = 0; i < body.n; i++) { body.rest[i * 3] += c.x; body.rest[i * 3 + 1] += c.y; body.rest[i * 3 + 2] += c.z; }
    body.restCom = [body.restCom[0] + c.x, body.restCom[1] + c.y, body.restCom[2] + c.z];
    const wp = carBody.toWorld(c.x, c.y, c.z, [0, 0, 0]);
    const v = carBody.comVel;
    body.placeAt(wp, carBody.q, [v[0] * 0.9 + (Math.random() - 0.5) * 2, v[1] + 1 + Math.random() * 2, v[2] * 0.9 + (Math.random() - 0.5) * 2]);
    body.canSleep = true;
    body.ignoreBodies = new Set([carBody.id]);
    return this.add(body, info.group, { kind: 'debris', ignoreTimer: 0.5, life: 240 });
  }

  spawnWheel(vehicle, w) {
    const body = prismBody(w.radius, w.width / 2, 10, 20 + w.radius * 20, 'x', { radius: 0.07, friction: 0.9, kBase: 4e5 });
    const vis = vehicle.visual;
    const root = new THREE.Group();
    const wm = buildWheelMesh(w.radius, w.width, vehicle.cfg.wheelStyle || vehicle.def.wheelStyle, vis.mats);
    if (w.side < 0) wm.root.rotation.y = Math.PI;
    root.add(wm.root);
    const cb = vehicle.body;
    const v = cb.comVel;
    body.placeAt([w.center[0], w.center[1], w.center[2]], cb.q, [v[0], v[1] + 1, v[2]]);
    // spin
    const R = cb.R;
    const ax = [R[0], R[3], R[6]];
    for (let i = 0; i < body.n; i++) {
      const k = i * 3;
      const rx = body.pos[k] - w.center[0], ry = body.pos[k + 1] - w.center[1], rz = body.pos[k + 2] - w.center[2];
      const om = w.omega;
      body.vel[k] += om * (ax[1] * rz - ax[2] * ry);
      body.vel[k + 1] += om * (ax[2] * rx - ax[0] * rz);
      body.vel[k + 2] += om * (ax[0] * ry - ax[1] * rx);
    }
    body.canSleep = true;
    body.ignoreBodies = new Set([cb.id]);
    return this.add(body, root, { kind: 'wheel', ignoreTimer: 0.4, life: 300 });
  }

  spawnFallen(kind, x, y, z, s, mesh, push) {
    const h = kind === 'tree' ? 6 * s : 7;
    const r = kind === 'tree' ? 0.25 * s : 0.12;
    const mass = kind === 'tree' ? 260 * s : 70;
    const body = boxBody(r, h / 2, r, mass, { radius: Math.min(0.2, r), oy: h / 2, friction: 0.8 });
    body.placeAt([x, y + h / 2 + 0.05, z], [0, 0, 0, 1]);
    // topple in push direction: upper nodes get velocity
    const pl = Math.hypot(push[0], push[1]) || 1;
    const sp = Math.min(9, pl * 0.35 + 1.5);
    for (let i = 0; i < body.n; i++) {
      const frac = body.rest[i * 3 + 1] / h;
      body.vel[i * 3] = (push[0] / pl) * sp * frac;
      body.vel[i * 3 + 2] = (push[1] / pl) * sp * frac;
    }
    body.canSleep = true;
    return this.add(body, mesh, { kind: 'fallen', life: Infinity, persistent: true });
  }

  syncItem(it) {
    const b = it.body;
    b.computeFrame(3);
    const q = b.q, c = b.com, rc = b.restCom;
    _q.set(q[0], q[1], q[2], q[3]);
    it.obj.matrix.compose(_p.set(c[0], c[1], c[2]), _q, _s);
    it.obj.matrix.multiply(_m.makeTranslation(-rc[0], -rc[1], -rc[2]));
    it.obj.matrixWorldNeedsUpdate = true;
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      if (it.ignoreTimer > 0) {
        it.ignoreTimer -= dt;
        if (it.ignoreTimer <= 0) it.body.ignoreBodies = null;
      }
      if (!it.body.sleeping) this.syncItem(it);
      if (it.age > it.life || it.body.com[1] < -200) this.remove(it);
    }
  }

  remove(it) {
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
    this.world.removeBody(it.body);
    this.scene.remove(it.obj);
  }

  clear(kinds = null) {
    for (const it of [...this.items]) if (!kinds || kinds.includes(it.kind)) this.remove(it);
  }

  // impacts from props for audio
  forEachAwake(fn) {
    for (const it of this.items) if (!it.body.sleeping) fn(it);
  }
}
