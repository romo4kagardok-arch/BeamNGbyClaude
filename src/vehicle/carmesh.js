// Procedural car geometry: lofted hull + greenhouse, split into detachable/openable parts,
// with lights, grille, plates, mirrors, interior and wheels. All in design space (see shape.js).
import * as THREE from 'three';
import { clamp, lerp } from '../core/math.js';

const HULL_N = 10; // half-section points

class Bucket {
  constructor(part, mat) {
    this.part = part;
    this.mat = mat;
    this.pos = [];
    this.uv = [];
    this.idx = [];
    this.gmap = new Map();
  }
  vert(x, y, z, u = 0, v = 0) {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }
  gvert(gi, gv) {
    let i = this.gmap.get(gi);
    if (i === undefined) {
      const p = gv[gi];
      i = this.vert(p[0], p[1], p[2], p[3] || 0, p[4] || 0);
      this.gmap.set(gi, i);
    }
    return i;
  }
}

class Builder {
  constructor() {
    this.buckets = new Map();
    this.gv = [];
    this.rayTris = [];
  }
  b(part, mat) {
    const k = part + '|' + mat;
    let bk = this.buckets.get(k);
    if (!bk) {
      bk = new Bucket(part, mat);
      this.buckets.set(k, bk);
    }
    return bk;
  }
  gquad(part, mat, a, b, c, d, ray = true) {
    const bk = this.b(part, mat);
    const ia = bk.gvert(a, this.gv), ib = bk.gvert(b, this.gv), ic = bk.gvert(c, this.gv), id = bk.gvert(d, this.gv);
    bk.idx.push(ia, ib, ic, ia, ic, id);
    if (ray) this.rayTris.push(this.gv[a], this.gv[b], this.gv[c], this.gv[a], this.gv[c], this.gv[d]);
  }
  addGeometry(part, mat, geo, matrix) {
    const bk = this.b(part, mat);
    const g = geo.index ? geo : geo;
    const P = g.attributes.position, UV = g.attributes.uv;
    const base = bk.pos.length / 3;
    const v = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      if (matrix) v.applyMatrix4(matrix);
      bk.pos.push(v.x, v.y, v.z);
      if (UV) bk.uv.push(UV.getX(i), UV.getY(i));
      else bk.uv.push(0, 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) bk.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < P.count; i++) bk.idx.push(base + i);
    geo.dispose();
  }
  // Möller–Trumbore against the hull
  raycast(ox, oy, oz, dx, dy, dz) {
    let best = Infinity, bn = null;
    const T = this.rayTris;
    for (let i = 0; i < T.length; i += 3) {
      const a = T[i], b = T[i + 1], c = T[i + 2];
      const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
      const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-10) continue;
      const inv = 1 / det;
      const tx = ox - a[0], ty = oy - a[1], tz = oz - a[2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t > 0 && t < best) {
        best = t;
        let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; }
        bn = [nx, ny, nz];
      }
    }
    if (!bn) return null;
    return { p: [ox + dx * best, oy + dy * best, oz + dz * best], n: bn };
  }
}

// Matrix placing an object whose local +Z is the surface normal and local +Y is close to world up
function surfaceMatrix(hit, offset = 0, upHint = [0, 1, 0]) {
  const n = new THREE.Vector3(...hit.n);
  let up = new THREE.Vector3(...upHint);
  if (Math.abs(n.dot(up)) > 0.95) up = new THREE.Vector3(0, 0, 1);
  const x = new THREE.Vector3().crossVectors(up, n).normalize();
  const y = new THREE.Vector3().crossVectors(n, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, n);
  const p = new THREE.Vector3(...hit.p).addScaledVector(n, offset);
  m.setPosition(p);
  return m;
}

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

function lensGeometry(w, h, depth = 0.05, r = 0.03) {
  const g = new THREE.ExtrudeGeometry(roundedRectShape(w, h, r), {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.01,
    bevelSegments: 2,
    curveSegments: 4,
  });
  g.translate(0, 0, -depth);
  return g;
}

function stationList(shape, def) {
  const zs = [];
  const z0 = shape.zRear, z1 = shape.zFront;
  const step = shape.length > 6 ? 0.1 : 0.055;
  for (let z = z0; z < z1; z += step) zs.push(z);
  zs.push(z1);
  // dense near ends for rounded corners
  for (let k = 1; k < 8; k++) {
    zs.push(z0 + k * 0.012);
    zs.push(z1 - k * 0.012);
  }
  // arches
  for (const az of shape.axles) {
    const R = shape.archR;
    for (let a = -R; a <= R; a += R / 12) zs.push(az + a);
    zs.push(az - R - 0.004, az + R + 0.004);
  }
  const P = shape.p;
  const keys = [];
  (P.doorsZ || []).forEach((d) => keys.push(d[0], d[1]));
  if (P.hood) keys.push(...P.hood);
  if (P.trunk) keys.push(...P.trunk);
  if (P.hatchHinge) keys.push(P.hatchHinge);
  const G = P.glass;
  if (G) {
    if (G.ws) keys.push(...G.ws);
    if (G.rw) keys.push(...G.rw);
    if (G.side) keys.push(...G.side);
    const pw = G.pillarW || 0.08;
    for (const pz of G.pillars || []) keys.push(pz - pw / 2, pz + pw / 2);
  }
  if (P.roof) for (const r of P.roof) keys.push(r[0]);
  if (P.bed) keys.push(P.bed.z0, P.bed.z1);
  for (const k of keys) zs.push(k);
  zs.sort((a, b) => a - b);
  const out = [];
  for (const z of zs) {
    if (z < z0 - 1e-6 || z > z1 + 1e-6) continue;
    if (!out.length || z - out[out.length - 1] > 0.006) out.push(z);
  }
  return out;
}

export function buildCarParts(def, shape, opts = {}) {
  const B = new Builder();
  const P = shape.p;
  const style = P.style;
  const st = stationList(shape, def);
  const S = st.length;
  const ring = HULL_N * 2 - 2; // 18
  const doors = (P.doorsZ || []).map((d, i) => ({ zf: d[0], zr: d[1], i }));
  const rugged = style === 'suv' || style === 'pickup' || style === 'truck' || style === 'bus';
  const bumperLen = style === 'bus' ? 0.3 : style === 'truck' ? 0.3 : 0.26;
  const L = P.lights;
  const bumperTopF = L.headY - L.headH / 2 - 0.03;
  const bumperTopR = L.tailY - L.tailH / 2 - 0.03;
  const glass = P.glass || {};
  const pw = glass.pillarW || 0.085;
  const police = !!def.police;
  const inRange = (z, r) => r && z > Math.min(r[0], r[1]) && z < Math.max(r[0], r[1]);
  const doorAt = (z) => doors.find((d) => z < d.zf && z > d.zr);
  const cabinH = (z) => {
    const r = shape.roofAt(z);
    return r === null ? 0 : r - shape.top(z);
  };
  const hatch = !!P.hatchback;

  // ---------- hull ----------
  const hullBase = B.gv.length;
  for (let i = 0; i < S; i++) {
    const z = st[i];
    const h = shape.hullSection(z);
    for (let j = 0; j < HULL_N; j++) B.gv.push([h[j][0], h[j][1], z]);
    for (let j = HULL_N - 2; j >= 1; j--) B.gv.push([-h[j][0], h[j][1], z]);
  }
  const gi = (i, j) => hullBase + i * ring + (j % ring);
  for (let i = 0; i < S - 1; i++) {
    const za = st[i], zb = st[i + 1], zc = (za + zb) / 2;
    const openCabin = cabinH(za) > 0.03 && cabinH(zb) > 0.03 && !(shape.cargo && zc > shape.cargo.z0 && zc < shape.cargo.z1);
    for (let j = 0; j < ring; j++) {
      const seg = j < HULL_N - 1 ? j : ring - 1 - j;
      const side = j < HULL_N - 1 ? 1 : -1;
      const a = gi(i, j), b = gi(i, j + 1), c = gi(i + 1, j + 1), d = gi(i + 1, j);
      const yc = (B.gv[a][1] + B.gv[b][1] + B.gv[c][1] + B.gv[d][1]) / 4;
      const isTop = seg >= 7;
      if (isTop && openCabin) continue;
      let mat = seg <= 2 ? 'under' : 'paint';
      if (seg === 3 && rugged) mat = 'trim';
      let part = 'body';
      const dr = doorAt(zc);
      if (seg >= 6 && P.hood && inRange(zc, P.hood)) part = 'hood';
      else if (seg >= 6 && P.trunk && !hatch && inRange(zc, P.trunk)) part = 'trunk';
      else if (hatch && seg >= 4 && zc < P.trunk[1] && yc > bumperTopR + 0.02) part = 'trunk';
      else if (seg >= 3 && seg <= 6 && dr) part = 'door' + dr.i + (side > 0 ? 'L' : 'R');
      if (part === 'body' || (part === 'hood' && zc > shape.zFront - 0.05)) {
        if (zc > shape.zFront - bumperLen && (yc < bumperTopF || seg <= 3)) part = 'bumperF';
        else if (zc < shape.zRear + bumperLen && (yc < bumperTopR || seg <= 3)) part = 'bumperR';
      }
      if ((part === 'bumperF' || part === 'bumperR') && (rugged || yc < shape.bottom(zc) + 0.1) && seg >= 3) mat = 'trim';
      if (police && part.startsWith('door') && seg >= 4) mat = 'paint2';
      if (style === 'pickup' && P.bed && isTop && zc > P.bed.z0 && zc < P.bed.z1) mat = 'trim';
      B.gquad(part, mat, a, b, c, d);
    }
  }
  // end caps (fans)
  const capHull = (i, dirZ, part) => {
    let cx = 0, cy = 0;
    for (let j = 0; j < ring; j++) { cx += B.gv[gi(i, j)][0]; cy += B.gv[gi(i, j)][1]; }
    const c = B.gv.length;
    B.gv.push([cx / ring, cy / ring, st[i]]);
    for (let j = 0; j < ring; j++) {
      const a = gi(i, j), b = gi(i, j + 1);
      const ya = B.gv[a][1];
      let mat = (ya < (dirZ > 0 ? bumperTopF : bumperTopR) && rugged) ? 'trim' : 'paint';
      const bk = B.b(part, mat);
      const ic = bk.gvert(c, B.gv), ia = bk.gvert(a, B.gv), ib = bk.gvert(b, B.gv);
      if (dirZ > 0) bk.idx.push(ic, ib, ia); else bk.idx.push(ic, ia, ib);
      B.rayTris.push(B.gv[c], B.gv[a], B.gv[b]);
    }
  };
  capHull(0, -1, 'bumperR');
  capHull(S - 1, 1, 'bumperF');

  // ---------- greenhouse ----------
  if (shape.roofFn) {
    const cs = st.filter((z) => shape.roofAt(z) !== null);
    const CN = 5, cring = CN * 2 - 1; // 9 points, open at bottom
    const base = B.gv.length;
    for (const z of cs) {
      const c = shape.cabinSection(z);
      for (let j = 0; j < CN; j++) B.gv.push([c[j][0], c[j][1], z]);
      for (let j = CN - 2; j >= 0; j--) B.gv.push([-c[j][0], c[j][1], z]);
    }
    const cg = (i, j) => base + i * cring + j;
    const sideGlass = (z) => {
      if (!inRange(z, glass.side)) return false;
      for (const pz of glass.pillars || []) if (Math.abs(z - pz) < pw / 2) return false;
      return true;
    };
    for (let i = 0; i < cs.length - 1; i++) {
      const zc = (cs[i] + cs[i + 1]) / 2;
      if (shape.cargo && zc > shape.cargo.z0 - 0.02 && zc < shape.cargo.z1 - 0.05 && style === 'truck') continue;
      for (let j = 0; j < cring - 1; j++) {
        const seg = j; // 0 side L,1 rail L,2-5 top,6 rail R,7 side R
        const isSide = seg === 0 || seg === 7, isRail = seg === 1 || seg === 6;
        const side = seg < 4 ? 1 : -1;
        let mat = 'paint';
        if (isSide && sideGlass(zc)) mat = 'glass';
        if (!isSide && !isRail && (inRange(zc, glass.ws) || inRange(zc, glass.rw))) mat = 'glass';
        if (isRail && inRange(zc, glass.ws) && style === 'bus') mat = 'glass';
        if (police && !isSide && mat === 'paint') mat = 'paint2';
        let part = 'body';
        const dr = doorAt(zc);
        if (isSide && dr) part = 'door' + dr.i + (side > 0 ? 'L' : 'R');
        if (hatch && zc < (P.hatchHinge ?? -99)) part = 'trunk';
        if (style === 'bus' && isSide && side < 0 && ((zc > 3.6 && zc < 4.75) || (zc > -0.55 && zc < 0.55))) mat = 'glass';
        B.gquad(part, mat, cg(i, j), cg(i, j + 1), cg(i + 1, j + 1), cg(i + 1, j));
      }
    }
    // caps
    const capCab = (i, dir) => {
      let cx = 0, cy = 0;
      for (let j = 0; j < cring; j++) { cx += B.gv[cg(i, j)][0]; cy += B.gv[cg(i, j)][1]; }
      const c = B.gv.length;
      B.gv.push([cx / cring, cy / cring, cs[i]]);
      const bk = B.b(hatch && dir < 0 ? 'trunk' : 'body', 'paint');
      for (let j = 0; j < cring - 1; j++) {
        const ic = bk.gvert(c, B.gv), ia = bk.gvert(cg(i, j), B.gv), ib = bk.gvert(cg(i, j + 1), B.gv);
        if (dir > 0) bk.idx.push(ic, ia, ib); else bk.idx.push(ic, ib, ia);
      }
    };
    if (cs.length > 1) {
      if (cabinH(cs[0]) > 0.05) capCab(0, -1);
      if (cabinH(cs[cs.length - 1]) > 0.05) capCab(cs.length - 1, 1);
    }
  }

  const hinges = {};
  const top = (z) => shape.top(z);
  // hinge definitions
  if (P.hood) {
    const z = Math.min(P.hood[0], P.hood[1]);
    const hw = shape.halfWidth(z) * 0.8;
    hinges.hood = { a: [hw, top(z), z], b: [-hw, top(z), z], max: 1.15, kind: 'hood' };
  }
  if (P.trunk && !hatch) {
    const z = Math.max(P.trunk[0], P.trunk[1]);
    const hw = shape.halfWidth(z) * 0.8;
    hinges.trunk = { a: [-hw, top(z), z], b: [hw, top(z), z], max: 1.25, kind: 'trunk' };
  }
  if (hatch) {
    const z = P.hatchHinge;
    const ry = shape.roofAt(z) ?? top(z);
    const hw = shape.halfWidth(z) * shape.roofWidth;
    hinges.trunk = { a: [-hw, ry, z], b: [hw, ry, z], max: 1.3, kind: 'trunk' };
  }
  for (const d of doors) {
    for (const side of [1, -1]) {
      const z = d.zf - 0.01;
      const hw = shape.halfWidth(z) - 0.02;
      const yb = shape.bottom(z), yt = top(z);
      hinges['door' + d.i + (side > 0 ? 'L' : 'R')] = {
        a: [side * hw, yb + 0.1, z],
        b: [side * hw, yt, z],
        max: side > 0 ? -1.15 : 1.15,
        kind: 'door',
        side,
      };
    }
  }

  // ---------- pickup bed / truck cargo ----------
  if (P.bed) {
    const bd = P.bed;
    const len = bd.z1 - bd.z0;
    const zc = (bd.z0 + bd.z1) / 2;
    const hw = shape.halfWidth(zc) - 0.03;
    const h = bd.top - bd.floor;
    for (const side of [1, -1]) {
      const g = new THREE.BoxGeometry(0.07, h, len, 1, 2, 10);
      B.addGeometry('body', 'paint', g, new THREE.Matrix4().makeTranslation(side * (hw - 0.035), bd.floor + h / 2, zc));
      const cap = new THREE.BoxGeometry(0.11, 0.03, len, 1, 1, 10);
      B.addGeometry('body', 'trim', cap, new THREE.Matrix4().makeTranslation(side * (hw - 0.035), bd.top + 0.015, zc));
    }
    const fw = new THREE.BoxGeometry(hw * 2, h, 0.07, 6, 2, 1);
    B.addGeometry('body', 'paint', fw, new THREE.Matrix4().makeTranslation(0, bd.floor + h / 2, bd.z1 - 0.035));
    const tg = new THREE.BoxGeometry(hw * 2 - 0.02, h, 0.06, 6, 2, 1);
    B.addGeometry('tailgate', 'paint', tg, new THREE.Matrix4().makeTranslation(0, bd.floor + h / 2, bd.z0 + 0.04));
    hinges.tailgate = { a: [hw, bd.floor + 0.02, bd.z0 + 0.04], b: [-hw, bd.floor + 0.02, bd.z0 + 0.04], max: 1.5, kind: 'tailgate' };
  }
  if (shape.cargo && style === 'truck') {
    const cg = shape.cargo;
    const len = cg.z1 - cg.z0;
    const zc = (cg.z0 + cg.z1) / 2;
    const hw = shape.width / 2;
    const h = cg.top - cg.bottom;
    const g = new THREE.BoxGeometry(hw * 2, h, len, 4, 6, 16);
    B.addGeometry('body', 'paint2', g, new THREE.Matrix4().makeTranslation(0, cg.bottom + h / 2, zc));
    // corner posts / rails
    for (const sx of [1, -1]) for (const sy of [0, 1]) {
      const r = new THREE.BoxGeometry(0.06, 0.06, len + 0.02, 1, 1, 10);
      B.addGeometry('body', 'chrome', r, new THREE.Matrix4().makeTranslation(sx * (hw + 0.005), cg.bottom + sy * h, zc));
    }
    for (const sx of [1, -1]) {
      const r = new THREE.BoxGeometry(0.06, h, 0.06, 1, 4, 1);
      B.addGeometry('body', 'chrome', r, new THREE.Matrix4().makeTranslation(sx * (hw + 0.005), cg.bottom + h / 2, cg.z0));
    }
    const doorLine = new THREE.BoxGeometry(0.02, h - 0.1, 0.01, 1, 4, 1);
    B.addGeometry('body', 'trim', doorLine, new THREE.Matrix4().makeTranslation(0, cg.bottom + h / 2, cg.z0 - 0.003));
    const bumper = new THREE.BoxGeometry(hw * 2 - 0.2, 0.12, 0.12, 4, 1, 1);
    B.addGeometry('bumperR', 'trim', bumper, new THREE.Matrix4().makeTranslation(0, cg.bottom - 0.25, cg.z0 + 0.05));
  }

  // ---------- lights, grille, plates ----------
  const ray = (x, y, z, dx, dy, dz) => B.raycast(x, y, z, dx, dy, dz);
  for (const side of [1, -1]) {
    const hh = ray(side * L.headX, L.headY, shape.zFront + 2, 0, 0, -1);
    if (hh) {
      const m = surfaceMatrix(hh, 0.012);
      B.addGeometry('lightF' + (side > 0 ? 'L' : 'R'), 'head', lensGeometry(L.headW, L.headH, 0.03, Math.min(L.headH, L.headW) * 0.35), m);
      const inner = lensGeometry(L.headW * 0.32, L.headH * 0.55, 0.01, 0.02);
      B.addGeometry('lightF' + (side > 0 ? 'L' : 'R'), 'chrome', inner, m.clone().multiply(new THREE.Matrix4().makeTranslation(-side * L.headW * 0.22, 0, 0.004)));
      // indicator
      const ind = lensGeometry(L.headW * 0.22, L.headH * 0.35, 0.01, 0.01);
      B.addGeometry('lightF' + (side > 0 ? 'L' : 'R'), 'ind', ind, m.clone().multiply(new THREE.Matrix4().makeTranslation(side * L.headW * 0.36, -L.headH * 0.22, 0.004)));
    }
    const th = ray(side * L.tailX, L.tailY, shape.zRear - 2, 0, 0, 1);
    if (th) {
      const m = surfaceMatrix(th, 0.01);
      const part = hatch && L.tailY > bumperTopR + 0.05 && th.p[2] < P.trunk[1] + 0.05 ? 'trunk' : 'lightR' + (side > 0 ? 'L' : 'R');
      B.addGeometry(part, 'tail', lensGeometry(L.tailW, L.tailH, 0.025, Math.min(L.tailH, L.tailW) * 0.3), m);
      const rev = lensGeometry(L.tailW * 0.3, L.tailH * 0.35, 0.008, 0.01);
      B.addGeometry(part, 'rev', rev, m.clone().multiply(new THREE.Matrix4().makeTranslation(-side * L.tailW * 0.25, 0, 0.003)));
    }
  }
  // grille
  {
    const gw = Math.max(0.3, 2 * (L.headX - L.headW / 2) - 0.12);
    const gy = L.headY - (style === 'truck' || style === 'bus' ? 0 : 0.02);
    const gh = style === 'pickup' || style === 'suv' || style === 'truck' ? L.headH * 1.6 : L.headH * 0.9;
    const hit = ray(0, gy, shape.zFront + 2, 0, 0, -1);
    if (hit && style !== 'bus') {
      const g = lensGeometry(gw, gh, 0.02, 0.025);
      B.addGeometry('bumperF', 'grille', g, surfaceMatrix(hit, 0.008));
      const bar = new THREE.BoxGeometry(gw * 0.98, 0.018, 0.015);
      B.addGeometry('bumperF', 'chrome', bar, surfaceMatrix(hit, 0.02).multiply(new THREE.Matrix4().makeTranslation(0, gh / 2 + 0.005, 0)));
    }
    // lower intake
    const yl = (shape.bottom(shape.zFront - 0.1) + bumperTopF) / 2 - 0.02;
    const hit2 = ray(0, yl, shape.zFront + 2, 0, 0, -1);
    if (hit2) {
      const g = lensGeometry(gw * 1.2, 0.08, 0.01, 0.03);
      B.addGeometry('bumperF', 'grille', g, surfaceMatrix(hit2, 0.004));
    }
  }
  // plates
  {
    const yf = (shape.bottom(shape.zFront - 0.15) + bumperTopF) / 2 + 0.05;
    const hp = ray(0, yf, shape.zFront + 2, 0, 0, -1);
    if (hp) {
      const g = new THREE.PlaneGeometry(0.46, 0.11);
      B.addGeometry('bumperF', 'plate', g, surfaceMatrix(hp, 0.02));
    }
    const yr = style === 'truck' ? shape.cargo.bottom - 0.25 : (shape.bottom(shape.zRear + 0.2) + bumperTopR) / 2 + 0.08;
    const hr = style === 'truck' ? { p: [0, yr, shape.cargo.z0 - 0.02], n: [0, 0, -1] } : ray(0, yr, shape.zRear - 2, 0, 0, 1);
    if (hr) {
      const g = new THREE.PlaneGeometry(0.46, 0.11);
      g.rotateY(0); // plane faces +Z; surfaceMatrix maps local +Z to the normal
      B.addGeometry(hatch ? 'bumperR' : 'bumperR', 'plate', g, surfaceMatrix(hr, 0.02));
    }
  }
  // mirrors and handles
  if (shape.roofFn) {
    const zm = (glass.ws ? glass.ws[1] : shape.zFA - 0.4) - 0.12;
    for (const side of [1, -1]) {
      const yt = top(zm);
      const big = style === 'truck' || style === 'bus';
      const yM = yt + (big ? 0.35 : 0.1);
      const hit = ray(side * 4, yt - 0.03, zm, -side, 0, 0);
      const bx = hit ? Math.abs(hit.p[0]) : shape.halfWidth(zm) - 0.08;
      const xs = bx + (big ? 0.2 : 0.11);
      const dr = doorAt(zm);
      const part = dr ? 'door' + dr.i + (side > 0 ? 'L' : 'R') : 'body';
      const g = new THREE.BoxGeometry(big ? 0.08 : 0.07, big ? 0.32 : 0.1, big ? 0.12 : 0.16);
      B.addGeometry(part, 'paint', g, new THREE.Matrix4().makeTranslation(side * xs, yM, zm));
      const gl = new THREE.PlaneGeometry(big ? 0.1 : 0.13, big ? 0.28 : 0.075);
      const mm = new THREE.Matrix4().makeRotationY(Math.PI).setPosition(side * xs, yM, zm - (big ? 0.061 : 0.081));
      B.addGeometry(part, 'chrome', gl, mm);
      const sl = xs - bx + 0.04;
      const stalk = new THREE.BoxGeometry(sl, 0.025, 0.05);
      B.addGeometry(part, 'trim', stalk, new THREE.Matrix4().makeTranslation(side * (bx - 0.02 + sl / 2), yt + 0.02, zm));
      if (big) {
        const arm = new THREE.BoxGeometry(0.03, yM - yt, 0.03);
        B.addGeometry(part, 'trim', arm, new THREE.Matrix4().makeTranslation(side * xs, yt + (yM - yt) / 2, zm));
      }
    }
    for (const d of doors) {
      for (const side of [1, -1]) {
        const z = d.zr + 0.17;
        const y = top(z) - 0.1;
        const hit = ray(side * 3, y, z, -side, 0, 0);
        if (!hit) continue;
        const g = new THREE.BoxGeometry(0.13, 0.025, 0.02);
        const m = surfaceMatrix(hit, 0.008, [0, 1, 0]);
        B.addGeometry('door' + d.i + (side > 0 ? 'L' : 'R'), 'chrome', g, m);
      }
    }
  }
  // exhaust
  {
    const yb = shape.bottom(shape.zRear + 0.25);
    const n = def.drive === 'RWD' && (style === 'sport' || def.police) ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const x = n === 2 ? (k ? -0.5 : 0.5) : -0.45;
      const g = new THREE.CylinderGeometry(0.04, 0.045, 0.22, 10, 1, true);
      g.rotateX(Math.PI / 2);
      B.addGeometry('bumperR', 'chrome', g, new THREE.Matrix4().makeTranslation(x, yb + 0.06, shape.zRear + 0.05));
    }
  }
  // spoiler
  if (P.spoiler && P.trunk) {
    const z = Math.min(P.trunk[0], P.trunk[1]) + 0.08;
    const y = top(z);
    const w = shape.width * 0.82;
    const wing = new THREE.BoxGeometry(w, 0.025, 0.2, 6, 1, 1);
    B.addGeometry('trunk', 'trim', wing, new THREE.Matrix4().makeTranslation(0, y + 0.13, z));
    for (const sx of [1, -1]) {
      const post = new THREE.BoxGeometry(0.03, 0.12, 0.08);
      B.addGeometry('trunk', 'trim', post, new THREE.Matrix4().makeTranslation(sx * w * 0.35, y + 0.06, z + 0.02));
    }
  }
  // roof rack
  if (def.roofRack && shape.roofFn) {
    const zs = [-1.75, 0.15];
    for (const sx of [1, -1]) {
      const ry = shape.roofAt(-0.8);
      const hw = shape.halfWidth(-0.8) * shape.roofWidth * 0.85;
      const g = new THREE.BoxGeometry(0.04, 0.04, zs[1] - zs[0], 1, 1, 8);
      B.addGeometry('body', 'trim', g, new THREE.Matrix4().makeTranslation(sx * hw, ry + 0.07, (zs[0] + zs[1]) / 2));
    }
    for (const z of [-1.2, -0.3]) {
      const ry = shape.roofAt(z);
      const hw = shape.halfWidth(z) * shape.roofWidth * 0.85;
      const g = new THREE.BoxGeometry(hw * 2 + 0.04, 0.03, 0.04, 6, 1, 1);
      B.addGeometry('body', 'trim', g, new THREE.Matrix4().makeTranslation(0, ry + 0.09, z));
    }
  }
  // police light bar
  if (police && shape.roofFn) {
    const z = -0.25;
    const ry = shape.roofAt(z);
    const base = new THREE.BoxGeometry(1.1, 0.05, 0.25, 4, 1, 1);
    B.addGeometry('body', 'trim', base, new THREE.Matrix4().makeTranslation(0, ry + 0.045, z));
    const r = new THREE.BoxGeometry(0.5, 0.07, 0.22, 2, 1, 1);
    B.addGeometry('lightbar', 'barR', r, new THREE.Matrix4().makeTranslation(0.27, ry + 0.1, z));
    const bl = new THREE.BoxGeometry(0.5, 0.07, 0.22, 2, 1, 1);
    B.addGeometry('lightbar', 'barB', bl, new THREE.Matrix4().makeTranslation(-0.27, ry + 0.1, z));
  }
  // bus details: route sign, bumpers
  if (style === 'bus') {
    const sign = new THREE.PlaneGeometry(1.6, 0.25);
    B.addGeometry('body', 'sign', sign, new THREE.Matrix4().makeTranslation(0, 2.78, shape.zFront - 0.02));
    for (const zz of [shape.zFront - 0.05, shape.zRear + 0.05]) {
      const g = new THREE.BoxGeometry(shape.width - 0.2, 0.28, 0.14, 6, 1, 1);
      B.addGeometry(zz > 0 ? 'bumperF' : 'bumperR', 'trim', g, new THREE.Matrix4().makeTranslation(0, 0.55, zz));
    }
    // interior seats rows
    for (let z = -5; z < 3.6; z += 0.85) {
      for (const sx of [0.75, -0.75]) {
        const s = new THREE.BoxGeometry(0.9, 0.12, 0.42);
        B.addGeometry('body', 'interior', s, new THREE.Matrix4().makeTranslation(sx, 0.95, z));
        const bk = new THREE.BoxGeometry(0.9, 0.5, 0.08);
        B.addGeometry('body', 'interior', bk, new THREE.Matrix4().makeTranslation(sx, 1.2, z - 0.2));
      }
    }
  }
  // interior for cars
  if (shape.roofFn && style !== 'bus' && style !== 'truck') {
    const zws = glass.ws ? glass.ws[1] : shape.zFA;
    const yb = shape.bottom(0) + 0.08;
    const belt = top(0);
    const hw = shape.halfWidth(0) - 0.12;
    const dash = new THREE.BoxGeometry(hw * 2, 0.22, 0.45, 4, 1, 1);
    B.addGeometry('body', 'interior', dash, new THREE.Matrix4().makeTranslation(0, belt - 0.08, zws - 0.3));
    const zSeat = zws - 1.05;
    for (const sx of [0.38, -0.38]) {
      const cush = new THREE.BoxGeometry(0.5, 0.12, 0.5);
      B.addGeometry('body', 'interior', cush, new THREE.Matrix4().makeTranslation(sx, yb + 0.2, zSeat));
      const back = new THREE.BoxGeometry(0.5, 0.62, 0.12);
      B.addGeometry('body', 'interior', back, new THREE.Matrix4().makeRotationX(-0.2).setPosition(sx, yb + 0.55, zSeat - 0.27));
      const head = new THREE.BoxGeometry(0.26, 0.16, 0.1);
      B.addGeometry('body', 'interior', head, new THREE.Matrix4().makeTranslation(sx, yb + 0.95, zSeat - 0.36));
    }
    if (doors.length > 1 || style === 'suv') {
      const zr = zSeat - 0.95;
      const cush = new THREE.BoxGeometry(hw * 2 - 0.1, 0.12, 0.5);
      B.addGeometry('body', 'interior', cush, new THREE.Matrix4().makeTranslation(0, yb + 0.2, zr));
      const back = new THREE.BoxGeometry(hw * 2 - 0.1, 0.58, 0.12);
      B.addGeometry('body', 'interior', back, new THREE.Matrix4().makeRotationX(-0.2).setPosition(0, yb + 0.53, zr - 0.27));
    }
    // steering wheel (left-hand drive: driver on +x side)
    const sw = new THREE.TorusGeometry(0.18, 0.022, 6, 18);
    B.addGeometry('body', 'trim', sw, new THREE.Matrix4().makeRotationX(-0.45).setPosition(0.38, belt + 0.02, zws - 0.62));
  }
  if (style === 'truck') {
    const zws = glass.ws[1];
    const dash = new THREE.BoxGeometry(shape.width - 0.3, 0.25, 0.4);
    B.addGeometry('body', 'interior', dash, new THREE.Matrix4().makeTranslation(0, top(2.4) - 0.05, zws - 0.35));
    const sw = new THREE.TorusGeometry(0.23, 0.025, 6, 18);
    B.addGeometry('body', 'trim', sw, new THREE.Matrix4().makeRotationX(-0.9).setPosition(0.55, top(2.4) + 0.15, zws - 0.7));
  }

  return { builder: B, hinges };
}

// ---------- wheel meshes ----------
let tireTex = null;
function tireTexture() {
  if (tireTex) return tireTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#1b1b1b';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#0c0c0c';
  for (let i = 0; i < 32; i++) {
    const x = i * 8;
    g.fillRect(x, 18, 3, 28);
    g.fillRect(x + 4, 8, 2, 12);
    g.fillRect(x + 4, 44, 2, 12);
  }
  g.fillRect(0, 30, 256, 3);
  tireTex = new THREE.CanvasTexture(c);
  tireTex.wrapS = tireTex.wrapT = THREE.RepeatWrapping;
  tireTex.colorSpace = THREE.SRGBColorSpace;
  return tireTex;
}

export function buildWheelMesh(radius, width, style, mats) {
  const root = new THREE.Group();
  const spin = new THREE.Group();
  root.add(spin);
  const rimR = radius * 0.66;
  // tyre via lathe (axis = Y), then rotate so axis = X
  const prof = [];
  const hw = width / 2;
  const sr = Math.min(0.05, width * 0.22);
  prof.push(new THREE.Vector2(rimR * 0.98, -hw * 0.92));
  prof.push(new THREE.Vector2(radius - sr * 1.8, -hw));
  for (let k = 0; k <= 4; k++) {
    const a = -Math.PI / 2 + (k / 4) * (Math.PI / 2);
    prof.push(new THREE.Vector2(radius - sr + Math.cos(a) * sr, -hw + sr + Math.sin(a) * sr));
  }
  for (let k = 0; k <= 4; k++) {
    const a = (k / 4) * (Math.PI / 2);
    prof.push(new THREE.Vector2(radius - sr + Math.cos(a) * sr, hw - sr + Math.sin(a) * sr));
  }
  prof.push(new THREE.Vector2(radius - sr * 1.8, hw));
  prof.push(new THREE.Vector2(rimR * 0.98, hw * 0.92));
  const tire = new THREE.LatheGeometry(prof, 30);
  tire.rotateZ(Math.PI / 2);
  const tm = new THREE.Mesh(tire, mats.tire);
  tm.castShadow = true;
  spin.add(tm);
  // rim barrel
  const barrel = new THREE.CylinderGeometry(rimR, rimR, width * 0.86, 22, 1, true);
  barrel.rotateZ(Math.PI / 2);
  spin.add(new THREE.Mesh(barrel, mats.rimDark));
  // rim face
  const outer = hw * 0.75;
  const ws = style || 'spoke5';
  const nsp = { spoke5: 5, spoke10: 10, mesh: 14, steel: 0, deep: 6 }[ws] ?? 5;
  const lip = new THREE.TorusGeometry(rimR * 0.97, 0.012, 5, 26);
  lip.rotateY(Math.PI / 2);
  lip.translate(outer, 0, 0);
  spin.add(new THREE.Mesh(lip, mats.rim));
  if (nsp === 0) {
    const disc = new THREE.CylinderGeometry(rimR * 0.95, rimR * 0.95, 0.02, 22);
    disc.rotateZ(Math.PI / 2);
    disc.translate(outer - 0.02, 0, 0);
    spin.add(new THREE.Mesh(disc, mats.rim));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const hole = new THREE.CylinderGeometry(0.025, 0.025, 0.025, 8);
      hole.rotateZ(Math.PI / 2);
      hole.translate(outer - 0.012, Math.cos(a) * rimR * 0.62, Math.sin(a) * rimR * 0.62);
      spin.add(new THREE.Mesh(hole, mats.rimDark));
    }
  } else {
    const depth = ws === 'deep' ? 0.06 : 0.02;
    for (let k = 0; k < nsp; k++) {
      const a = (k / nsp) * Math.PI * 2;
      const thick = ws === 'mesh' ? 0.018 : ws === 'spoke10' ? 0.03 : 0.05;
      const sp = new THREE.BoxGeometry(0.03, rimR * 0.82, thick);
      sp.translate(0, rimR * 0.5, 0);
      sp.rotateX(a + (ws === 'mesh' ? 0.35 : 0));
      sp.translate(outer - depth * 0.5, 0, 0);
      spin.add(new THREE.Mesh(sp, mats.rim));
      if (ws === 'mesh') {
        const sp2 = new THREE.BoxGeometry(0.03, rimR * 0.82, thick);
        sp2.translate(0, rimR * 0.5, 0);
        sp2.rotateX(a - 0.35);
        sp2.translate(outer - depth * 0.5, 0, 0);
        spin.add(new THREE.Mesh(sp2, mats.rim));
      }
    }
  }
  const hub = new THREE.CylinderGeometry(rimR * 0.22, rimR * 0.25, 0.05, 14);
  hub.rotateZ(Math.PI / 2);
  hub.translate(outer - 0.01, 0, 0);
  spin.add(new THREE.Mesh(hub, mats.rim));
  // brake disc (spins), caliper (does not)
  const disc = new THREE.CylinderGeometry(rimR * 0.82, rimR * 0.82, 0.024, 24);
  disc.rotateZ(Math.PI / 2);
  disc.translate(-hw * 0.05, 0, 0);
  spin.add(new THREE.Mesh(disc, mats.disc));
  const cal = new THREE.BoxGeometry(0.07, rimR * 0.5, rimR * 0.32);
  cal.translate(hw * 0.02, rimR * 0.62, 0);
  cal.rotateX(-0.5);
  const calM = new THREE.Mesh(cal, mats.caliper);
  root.add(calM);
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, spin };
}
