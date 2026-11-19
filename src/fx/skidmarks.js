// Tyre marks: ring buffer of quads laid on the ground behind sliding wheels.
import * as THREE from 'three';

export class Skidmarks {
  constructor(scene, max = 6000) {
    this.max = max;
    this.pos = new Float32Array(max * 4 * 3);
    this.col = new Float32Array(max * 4 * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      idx[i * 6] = i * 4; idx[i * 6 + 1] = i * 4 + 2; idx[i * 6 + 2] = i * 4 + 1;
      idx[i * 6 + 3] = i * 4 + 1; idx[i * 6 + 4] = i * 4 + 2; idx[i * 6 + 5] = i * 4 + 3;
    }
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('color', this.colAttr);
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -10 });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.head = 0;
    this.count = 0;
    this.last = new Map();
    this.dirty = false;
  }
  // key: unique wheel id; p: contact point; dir: tyre forward; w: half width; a: alpha; col: rgb
  add(key, p, side, w, a, col) {
    const last = this.last.get(key);
    const x = p[0], y = p[1] + 0.03, z = p[2];
    if (!last || a <= 0.01) {
      this.last.set(key, a > 0.01 ? { x, y, z, sx: side[0], sz: side[2], a } : null);
      return;
    }
    const dx = x - last.x, dz = z - last.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.09) return;
    if (d2 > 9) { this.last.set(key, { x, y, z, sx: side[0], sz: side[2], a }); return; }
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.count = Math.min(this.max, this.count + 1);
    const P = this.pos, C = this.col;
    const o = i * 12;
    P[o] = last.x + last.sx * w; P[o + 1] = last.y; P[o + 2] = last.z + last.sz * w;
    P[o + 3] = last.x - last.sx * w; P[o + 4] = last.y; P[o + 5] = last.z - last.sz * w;
    P[o + 6] = x + side[0] * w; P[o + 7] = y; P[o + 8] = z + side[2] * w;
    P[o + 9] = x - side[0] * w; P[o + 10] = y; P[o + 11] = z - side[2] * w;
    const c = i * 16;
    for (let k = 0; k < 4; k++) {
      C[c + k * 4] = col[0]; C[c + k * 4 + 1] = col[1]; C[c + k * 4 + 2] = col[2];
      C[c + k * 4 + 3] = k < 2 ? last.a : a;
    }
    this.last.set(key, { x, y, z, sx: side[0], sz: side[2], a });
    this.dirty = true;
  }
  break(key) {
    this.last.delete(key);
  }
  update() {
    if (!this.dirty) return;
    this.dirty = false;
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.geo.setDrawRange(0, this.count * 6);
  }
  clear() {
    this.pos.fill(0);
    this.count = 0;
    this.head = 0;
    this.last.clear();
    this.dirty = true;
    this.update();
  }
}
