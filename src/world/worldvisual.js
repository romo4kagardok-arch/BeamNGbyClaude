// Builds Three.js meshes for the generated map.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { worldTextures } from './textures.js';
import { SURF } from '../physics/statics.js';
import { makeNoise2D, rng, clamp } from '../core/math.js';

const SURF_RGB = {
  [SURF.GRASS]: [0.25, 0.38, 0.16], [SURF.ASPHALT]: [0.26, 0.26, 0.27], [SURF.DIRT]: [0.42, 0.33, 0.22], [SURF.SAND]: [0.7, 0.63, 0.45],
  [SURF.CONCRETE]: [0.44, 0.44, 0.42], [SURF.ROCK]: [0.4, 0.38, 0.35], [SURF.SNOW]: [0.92, 0.94, 0.97], [SURF.MUD]: [0.25, 0.19, 0.12],
};

export function boxGeometry(hx, hy, hz, uvScale = 2) {
  const g = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
  const uv = g.attributes.uv;
  // faces order: +x,-x,+y,-y,+z,-z (4 verts each)
  const dims = [[hz, hy], [hz, hy], [hx, hz], [hx, hz], [hx, hy], [hx, hy]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * (dims[f][0] * 2) / uvScale, uv.getY(i) * (dims[f][1] * 2) / uvScale);
  }
  return g;
}

export class WorldVisual {
  constructor(map, scene, quality = 'high') {
    this.map = map;
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.tx = worldTextures();
    this.quality = quality;
    this.buildTerrain();
    this.buildRoads();
    this.buildBuildings();
    this.buildTrees();
    this.buildLamps();
    this.buildStructures();
    this.buildTrack();
    this.buildWater();
  }

  buildTerrain() {
    const T = this.map.T;
    const res = T.res;
    const chunks = 8;
    const cells = (res - 1) / chunks;
    const noise = makeNoise2D(3);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: this.tx.detail, roughness: 0.96, metalness: 0 });
    this.terrainMat = mat;
    const tmp = new Float64Array(4);
    for (let cz = 0; cz < chunks; cz++) for (let cx = 0; cx < chunks; cx++) {
      const n = cells + 1;
      const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), nor = new Float32Array(n * n * 3);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const gi = cx * cells + i, gj = cz * cells + j;
        const x = -T.half + gi * T.step, z = -T.half + gj * T.step;
        const k = j * n + i;
        const h = T.h[gj * res + gi];
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        T.sample(x, z, tmp);
        nor[k * 3] = tmp[1]; nor[k * 3 + 1] = tmp[2]; nor[k * 3 + 2] = tmp[3];
        uv[k * 2] = x / 9; uv[k * 2 + 1] = z / 9;
        const s = T.surf[gj * res + gi];
        let c = SURF_RGB[s] || SURF_RGB[0];
        const v = noise(x / 40, z / 40) * 0.5 + noise(x / 9, z / 9) * 0.25;
        let r = c[0], g = c[1], b = c[2];
        if (s === SURF.GRASS) {
          r += v * 0.08 + 0.02; g += v * 0.1; b += v * 0.03;
          const dry = clamp(noise(x / 300 + 5, z / 300) * 1.5, 0, 1);
          r += dry * 0.12; g += dry * 0.05;
          const hh = clamp((h - 60) / 120, 0, 1);
          r = r * (1 - hh) + 0.33 * hh; g = g * (1 - hh) + 0.34 * hh; b = b * (1 - hh) + 0.28 * hh;
        } else { r += v * 0.06; g += v * 0.06; b += v * 0.06; }
        const slope = 1 - tmp[2];
        if (slope > 0.12 && s !== SURF.ASPHALT && s !== SURF.CONCRETE) {
          const f = clamp((slope - 0.12) * 4, 0, 0.8);
          r = r * (1 - f) + 0.42 * f; g = g * (1 - f) + 0.39 * f; b = b * (1 - f) + 0.35 * f;
        }
        col[k * 3] = r; col[k * 3 + 1] = g; col[k * 3 + 2] = b;
      }
      const idx = [];
      for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  ribbon(pts, heights, hw, closed, opts = {}) {
    const T = this.map.T;
    const n = pts.length;
    const cross = opts.cross || [-1, -0.5, 0, 0.5, 1];
    const m = cross.length;
    const pos = [], uv = [], idx = [];
    let dist = 0;
    const count = closed ? n + 1 : n;
    for (let s = 0; s < count; s++) {
      const i = s % n;
      const p = pts[i];
      const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      let tx = next[0] - prev[0], tz = next[1] - prev[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const nx = tz, nz = -tx;
      if (s > 0) {
        const q = pts[(s - 1) % n];
        dist += Math.hypot(p[0] - q[0], p[1] - q[1]);
      }
      for (let c = 0; c < m; c++) {
        const off = cross[c] * hw + (opts.offset || 0);
        const x = p[0] + nx * off, z = p[1] + nz * off;
        const y = (opts.useTerrain === false && heights ? heights[i] : T.heightAt(x, z)) + (opts.lift ?? 0.06);
        pos.push(x, y, z);
        uv.push(opts.uAlong ? dist / opts.repeat : (cross[c] + 1) / 2, opts.uAlong ? (cross[c] + 1) / 2 : dist / (opts.repeat || 12));
      }
    }
    for (let s = 0; s < count - 1; s++) for (let c = 0; c < m - 1; c++) {
      const a = s * m + c, b = a + 1, d = a + m, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  buildRoads() {
    const tx = this.tx;
    const mk = (map, extra = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, ...extra });
    const mats = {
      highway: mk(tx.road4), road: mk(tx.road2), mountain: mk(tx.road2), street: mk(tx.street), track: mk(tx.track), runway: mk(tx.runway), trail: mk(tx.dirt, { roughness: 1 }),
    };
    const geos = {};
    for (const r of this.map.roads) {
      const kind = mats[r.kind] ? r.kind : 'road';
      const repeat = r.kind === 'highway' ? 16 : r.kind === 'runway' ? 40 : r.kind === 'trail' ? 8 : 12;
      const g = this.ribbon(r.pts, r.h, r.width / 2, r.closed, { repeat, lift: r.kind === 'trail' ? 0.04 : 0.06 });
      (geos[kind] || (geos[kind] = [])).push(g);
    }
    // city intersections
    const xs = this.map.streetXs, zs = this.map.streetZs;
    const inter = [];
    for (const x of xs) for (const z of zs) {
      const g = new THREE.PlaneGeometry(12.2, 12.2);
      g.rotateX(-Math.PI / 2);
      g.translate(x, this.map.cityH + 0.075, z);
      inter.push(g);
    }
    const asphalt = mk(tx.track, { polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    if (inter.length) this.group.add(new THREE.Mesh(mergeGeometries(inter), asphalt));
    for (const [k, list] of Object.entries(geos)) {
      const mesh = new THREE.Mesh(mergeGeometries(list), mats[k]);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    // sidewalk curbs in city (thin raised strips along streets)
    const curbs = [];
    const H = this.map.cityH;
    for (const x of xs) for (let b = 0; b < zs.length - 1; b++) for (const s of [-1, 1]) {
      const len = zs[b + 1] - zs[b] - 12;
      const g = new THREE.BoxGeometry(0.3, 0.16, len);
      g.translate(x + s * 6.15, H + 0.08, (zs[b] + zs[b + 1]) / 2);
      curbs.push(g);
    }
    for (const z of zs) for (let a = 0; a < xs.length - 1; a++) for (const s of [-1, 1]) {
      const len = xs[a + 1] - xs[a] - 12;
      const g = new THREE.BoxGeometry(len, 0.16, 0.3);
      g.translate((xs[a] + xs[a + 1]) / 2, H + 0.08, z + s * 6.15);
      curbs.push(g);
    }
    if (curbs.length) {
      const m = new THREE.Mesh(mergeGeometries(curbs), new THREE.MeshStandardMaterial({ color: '#a8a6a0', roughness: 0.9 }));
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  buildBuildings() {
    const tx = this.tx;
    const byStyle = [[], [], [], [], []];
    const roofs = [];
    for (const b of this.map.buildings) {
      const st = b.style % 5;
      const hw = b.w / 2, hd = b.d / 2;
      const y0 = b.y - 1, y1 = b.y + b.h;
      const pos = [], uv = [], idx = [];
      const walls = [
        [[b.x - hw, b.z + hd], [b.x + hw, b.z + hd]],
        [[b.x + hw, b.z + hd], [b.x + hw, b.z - hd]],
        [[b.x + hw, b.z - hd], [b.x - hw, b.z - hd]],
        [[b.x - hw, b.z - hd], [b.x - hw, b.z + hd]],
      ];
      for (const [p, q] of walls) {
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const base = pos.length / 3;
        pos.push(p[0], y0, p[1], q[0], y0, q[1], q[0], y1, q[1], p[0], y1, p[1]);
        const u1 = Math.round(L / 3.5) / 4;
        const v0 = -1 / 12.8, v1 = (y1 - b.y) / 12.8;
        uv.push(0, v0, u1, v0, u1, v1, 0, v1);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      byStyle[st].push(g);
      const roof = new THREE.BoxGeometry(b.w + 0.4, 0.6, b.d + 0.4);
      roof.translate(b.x, y1 + 0.3, b.z);
      roofs.push(roof);
      if (b.h > 20 && b.w > 14) {
        const box = new THREE.BoxGeometry(b.w * 0.3, 2.5, b.d * 0.3);
        box.translate(b.x + b.w * 0.15, y1 + 1.5, b.z - b.d * 0.1);
        roofs.push(box);
      }
    }
    this.buildingMats = [];
    byStyle.forEach((list, st) => {
      if (!list.length) return;
      const mat = new THREE.MeshStandardMaterial({ map: tx.facades[st], emissiveMap: tx.facadeEmissive[st], emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.75, metalness: st === 1 || st === 4 ? 0.35 : 0.05 });
      this.buildingMats.push(mat);
      const m = new THREE.Mesh(mergeGeometries(list), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    });
    if (roofs.length) {
      const m = new THREE.Mesh(mergeGeometries(roofs.map((g) => g.toNonIndexed())), new THREE.MeshStandardMaterial({ color: '#4a4c50', roughness: 0.9 }));
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
    // park lawns / parking lots
    const lots = [];
    for (const p of this.map.parks) {
      const g = new THREE.PlaneGeometry(p.x1 - p.x0, p.z1 - p.z0);
      g.rotateX(-Math.PI / 2);
      g.translate((p.x0 + p.x1) / 2, this.map.cityH + 0.05, (p.z0 + p.z1) / 2);
      (p.kind === 'park' ? (this._lawns || (this._lawns = [])) : lots).push(g);
    }
    if (this._lawns) this.group.add(new THREE.Mesh(mergeGeometries(this._lawns), new THREE.MeshStandardMaterial({ color: '#4f7a34', map: tx.detail, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 })));
    if (lots.length) this.group.add(new THREE.Mesh(mergeGeometries(lots), new THREE.MeshStandardMaterial({ map: tx.runway, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 })));
  }

  treeGeometries() {
    const color = (g, c) => {
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      const cc = new THREE.Color(c);
      for (let i = 0; i < n; i++) { col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g.index ? g.toNonIndexed() : g;
    };
    const pine = [];
    const trunk = new THREE.CylinderGeometry(0.14, 0.22, 2.2, 6);
    trunk.translate(0, 1.1, 0);
    pine.push(color(trunk, '#4a3424'));
    for (let k = 0; k < 3; k++) {
      const c = new THREE.ConeGeometry(1.8 - k * 0.45, 2.6, 7);
      c.translate(0, 2.4 + k * 1.5, 0);
      pine.push(color(c, k === 0 ? '#1f4a26' : k === 1 ? '#245430' : '#2a5e35'));
    }
    const leafy = [];
    const t2 = new THREE.CylinderGeometry(0.16, 0.24, 3, 6);
    t2.translate(0, 1.5, 0);
    leafy.push(color(t2, '#54402c'));
    const R = rng(4);
    for (let k = 0; k < 4; k++) {
      const s = new THREE.IcosahedronGeometry(1.3 + R() * 0.5, 1);
      s.translate((R() - 0.5) * 1.6, 3.6 + R() * 1.4, (R() - 0.5) * 1.6);
      leafy.push(color(s, k % 2 ? '#3b6b2a' : '#4a7a32'));
    }
    return [mergeGeometries(pine), mergeGeometries(leafy)];
  }

  buildTrees() {
    const trees = this.map.trees;
    const geos = this.treeGeometries();
    this.treeGeos = geos;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    this.treeMat = mat;
    const counts = [0, 0];
    for (const t of trees) counts[t.type]++;
    this.treeMeshes = geos.map((g, i) => {
      const m = new THREE.InstancedMesh(g, mat, Math.max(1, counts[i]));
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    });
    this.treeIndex = [];
    const c = [0, 0];
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const k = c[t.type]++;
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
      S.set(t.s, t.s * (0.9 + (i % 7) * 0.05), t.s);
      P.set(t.x, t.y - 0.1, t.z);
      M.compose(P, Q, S);
      this.treeMeshes[t.type].setMatrixAt(k, M);
      this.treeIndex.push([t.type, k]);
    }
    for (const m of this.treeMeshes) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
  }

  hideTree(i) {
    const [type, k] = this.treeIndex[i];
    const M = new THREE.Matrix4().makeScale(0, 0, 0);
    this.treeMeshes[type].setMatrixAt(k, M);
    this.treeMeshes[type].instanceMatrix.needsUpdate = true;
  }

  showAllTrees() {
    const trees = this.map.trees;
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const [type, k] = this.treeIndex[i];
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
      S.set(t.s, t.s * (0.9 + (i % 7) * 0.05), t.s);
      P.set(t.x, t.y - 0.1, t.z);
      M.compose(P, Q, S);
      this.treeMeshes[type].setMatrixAt(k, M);
    }
    for (const m of this.treeMeshes) m.instanceMatrix.needsUpdate = true;
  }

  lampGeometry() {
    const pole = new THREE.CylinderGeometry(0.07, 0.11, 7, 6);
    pole.translate(0, 3.5, 0);
    const arm = new THREE.BoxGeometry(0.08, 0.08, 1.6);
    arm.translate(0, 6.9, 0.75);
    const head = new THREE.BoxGeometry(0.35, 0.12, 0.6);
    head.translate(0, 6.85, 1.5);
    return { body: mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed()]), head };
  }

  buildLamps() {
    const lamps = this.map.lamps;
    const g = this.lampGeometry();
    this.lampMat = new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.5, metalness: 0.7 });
    this.lampHeadMat = new THREE.MeshStandardMaterial({ color: '#ddd', emissive: '#ffd9a0', emissiveIntensity: 0 });
    this.lampBody = new THREE.InstancedMesh(g.body, this.lampMat, Math.max(1, lamps.length));
    this.lampHead = new THREE.InstancedMesh(g.head, this.lampHeadMat, Math.max(1, lamps.length));
    this.lampBody.castShadow = true;
    const M = new THREE.Matrix4();
    lamps.forEach((l, i) => {
      const yaw = l.side === 1 ? -Math.PI / 2 : 0;
      M.makeRotationY(yaw).setPosition(l.x, l.y, l.z);
      this.lampBody.setMatrixAt(i, M);
      this.lampHead.setMatrixAt(i, M);
    });
    this.group.add(this.lampBody, this.lampHead);
  }

  hideLamp(i) {
    const M = new THREE.Matrix4().makeScale(0, 0, 0);
    this.lampBody.setMatrixAt(i, M);
    this.lampHead.setMatrixAt(i, M);
    this.lampBody.instanceMatrix.needsUpdate = true;
    this.lampHead.instanceMatrix.needsUpdate = true;
  }

  showAllLamps() {
    const M = new THREE.Matrix4();
    this.map.lamps.forEach((l, i) => {
      M.makeRotationY(l.side === 1 ? -Math.PI / 2 : 0).setPosition(l.x, l.y, l.z);
      this.lampBody.setMatrixAt(i, M);
      this.lampHead.setMatrixAt(i, M);
    });
    this.lampBody.instanceMatrix.needsUpdate = true;
    this.lampHead.instanceMatrix.needsUpdate = true;
  }

  structureMaterials() {
    if (this._smats) return this._smats;
    const tx = this.tx;
    this._smats = {
      concrete: new THREE.MeshStandardMaterial({ map: tx.concrete, roughness: 0.9 }),
      barrier: new THREE.MeshStandardMaterial({ map: tx.concrete, color: '#e8e4dc', roughness: 0.85 }),
      wood: new THREE.MeshStandardMaterial({ map: tx.wood, roughness: 0.85 }),
      metal: new THREE.MeshStandardMaterial({ map: tx.metal, roughness: 0.45, metalness: 0.6 }),
      tirewall: new THREE.MeshStandardMaterial({ map: tx.tires, roughness: 0.95 }),
      armco: new THREE.MeshStandardMaterial({ color: '#c8ccd0', roughness: 0.3, metalness: 0.9 }),
      dirt: new THREE.MeshStandardMaterial({ map: tx.dirt, roughness: 1 }),
      log: new THREE.MeshStandardMaterial({ map: tx.wood, color: '#8a6a4a', roughness: 0.95 }),
      building: new THREE.MeshStandardMaterial({ map: tx.concrete, roughness: 0.9 }),
      pole: new THREE.MeshStandardMaterial({ map: tx.hazard, roughness: 0.5, metalness: 0.3 }),
      hazard: new THREE.MeshStandardMaterial({ map: tx.hazard, roughness: 0.6 }),
    };
    return this._smats;
  }

  structureGeometry(s) {
    if (s.kind === 'pole') {
      const g = new THREE.CylinderGeometry(s.r, s.r, s.y1 - s.y0, 12);
      g.translate(s.x, (s.y0 + s.y1) / 2, s.z);
      return g;
    }
    const g = boxGeometry(s.hx, s.hy, s.hz, s.kind === 'tirewall' ? 2 : s.kind === 'building' ? 6 : 2);
    const e = new THREE.Euler(s.pitch || 0, s.yaw || 0, s.roll || 0, 'YXZ');
    const m = new THREE.Matrix4().makeRotationFromEuler(e).setPosition(s.x, s.y, s.z);
    g.applyMatrix4(m);
    return g;
  }

  buildStructures() {
    const mats = this.structureMaterials();
    const by = {};
    for (const s of this.map.structures) {
      const g = this.structureGeometry(s);
      const k = mats[s.kind] ? s.kind : 'concrete';
      (by[k] || (by[k] = [])).push(g.index ? g.toNonIndexed() : g);
    }
    for (const [k, list] of Object.entries(by)) {
      const m = new THREE.Mesh(mergeGeometries(list), mats[k]);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  buildTrack() {
    const tr = this.map.track;
    const pts = tr.pts, n = pts.length;
    const mat = new THREE.MeshStandardMaterial({ map: this.tx.curb, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    const geos = [];
    // curbs where curvature is high
    let run = null;
    const flush = () => {
      if (run && run.pts.length > 3) geos.push(this.ribbon(run.pts, null, 0.8, false, { offset: run.side * (tr.width / 2 + 0.6), cross: [-1, 1], lift: 0.09, uAlong: true, repeat: 2.4 }));
      run = null;
    };
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 3 + n) % n], b = pts[i], c = pts[(i + 3) % n];
      const h1 = Math.atan2(b[0] - a[0], b[1] - a[1]), h2 = Math.atan2(c[0] - b[0], c[1] - b[1]);
      let dh = h2 - h1;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const side = dh > 0 ? 1 : -1; // inside of the corner
      if (Math.abs(dh) > 0.06) {
        if (!run || run.side !== side) { flush(); run = { side, pts: [] }; }
        run.pts.push(b);
      } else flush();
    }
    flush();
    for (const g of geos) this.group.add(new THREE.Mesh(g, mat));
    // start / finish line
    const p = pts[0], q = pts[1];
    const yaw = Math.atan2(q[0] - p[0], q[1] - p[1]);
    const line = new THREE.PlaneGeometry(tr.width, 2);
    line.rotateX(-Math.PI / 2);
    line.rotateY(yaw);
    line.translate(p[0], this.map.T.heightAt(p[0], p[1]) + 0.1, p[1]);
    const cm = new THREE.MeshStandardMaterial({ map: this.tx.checker, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.group.add(new THREE.Mesh(line, cm));
    // gantry over the start
    const gm = new THREE.MeshStandardMaterial({ color: '#2b2f36', metalness: 0.6, roughness: 0.4 });
    const H = this.map.T.heightAt(p[0], p[1]);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 0.4), gm);
      post.position.set(p[0] + Math.cos(yaw) * s * (tr.width / 2 + 1.5), H + 3.5, p[1] - Math.sin(yaw) * s * (tr.width / 2 + 1.5));
      post.castShadow = true;
      this.group.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(tr.width + 3.4, 1.2, 0.5), new THREE.MeshStandardMaterial({ map: this.tx.checker }));
    beam.position.set(p[0], H + 7, p[1]);
    beam.rotation.y = yaw;
    beam.castShadow = true;
    this.group.add(beam);
  }

  buildWater() {
    const L = this.map.lake;
    const g = new THREE.CircleGeometry(L.r * 1.55, 72);
    g.rotateX(-Math.PI / 2);
    this.waterMat = new THREE.MeshStandardMaterial({ color: '#1f4f6a', roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.86 });
    const m = new THREE.Mesh(g, this.waterMat);
    m.position.set(L.x, L.level, L.z);
    m.receiveShadow = true;
    this.water = m;
    this.group.add(m);
  }

  setNight(f) {
    for (const m of this.buildingMats) m.emissiveIntensity = f * 0.9;
    this.lampHeadMat.emissiveIntensity = f * 4;
  }
}
