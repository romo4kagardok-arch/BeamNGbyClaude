// Node-beam soft body solved with XPBD (extended position based dynamics) and small substeps.
// Beams are spring-dampers with plastic yield (permanent deformation) and tensile breaking.
// The same class is used for vehicles, wheels that fell off, detached panels and dynamic props.

import { quatToMat3, quatNormalize } from '../core/math.js';

let BODY_ID = 1;

export class SoftBodyBuilder {
  constructor() {
    this.nodes = [];
    this.beams = [];
  }
  addNode(x, y, z, mass, radius = 0.12, opts = {}) {
    this.nodes.push({
      x, y, z, mass, radius,
      friction: opts.friction ?? 0.55,
      group: opts.group ?? 0,
      collide: opts.collide ?? 1,
      tag: opts.tag ?? 0,
    });
    return this.nodes.length - 1;
  }
  // kBase: axial stiffness constant (N), actual spring k = kBase / restLength
  addBeam(a, b, opts = {}) {
    if (a === b) return -1;
    const na = this.nodes[a], nb = this.nodes[b];
    const L = Math.hypot(nb.x - na.x, nb.y - na.y, nb.z - na.z);
    const kBase = opts.kBase ?? 2.0e6;
    const k = opts.k ?? kBase / Math.max(L, 0.05);
    this.beams.push({
      a, b, L, k,
      damping: opts.damping ?? 0.4 * 2 * Math.sqrt(k * 10),
      yieldStrain: opts.yieldStrain ?? 0.012,
      breakStretch: opts.breakStretch ?? 0.6,
      minRatio: opts.minRatio ?? 0.25,
      group: opts.group ?? 0,
    });
    return this.beams.length - 1;
  }
  build() {
    return new SoftBody(this);
  }
}

export class SoftBody {
  constructor(builder) {
    const N = builder.nodes.length, M = builder.beams.length;
    this.id = BODY_ID++;
    this.n = N;
    this.m = M;
    this.pos = new Float64Array(N * 3);
    this.prev = new Float64Array(N * 3);
    this.vel = new Float64Array(N * 3);
    this.force = new Float64Array(N * 3);
    this.rest = new Float64Array(N * 3); // design-space rest positions
    this.mass = new Float64Array(N);
    this.invMass = new Float64Array(N);
    this.radius = new Float32Array(N);
    this.friction = new Float32Array(N);
    this.group = new Uint8Array(N);
    this.collide = new Uint8Array(N);
    this.tag = new Uint8Array(N);
    this.contact = new Float32Array(N); // >0 when touching something this frame (static)
    this.totalMass = 0;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < N; i++) {
      const nd = builder.nodes[i];
      this.rest[i * 3] = nd.x; this.rest[i * 3 + 1] = nd.y; this.rest[i * 3 + 2] = nd.z;
      this.mass[i] = nd.mass;
      this.invMass[i] = nd.mass > 0 ? 1 / nd.mass : 0;
      this.radius[i] = nd.radius;
      this.friction[i] = nd.friction;
      this.group[i] = nd.group;
      this.collide[i] = nd.collide;
      this.tag[i] = nd.tag;
      this.totalMass += nd.mass;
      cx += nd.x * nd.mass; cy += nd.y * nd.mass; cz += nd.z * nd.mass;
    }
    this.restCom = [cx / this.totalMass, cy / this.totalMass, cz / this.totalMass];

    this.bA = new Int32Array(M);
    this.bB = new Int32Array(M);
    this.bRest = new Float64Array(M);
    this.bRest0 = new Float64Array(M);
    this.bCompliance = new Float64Array(M);
    this.bDamp = new Float32Array(M);
    this.bYield = new Float32Array(M);
    this.bBreak = new Float32Array(M);
    this.bMinRatio = new Float32Array(M);
    this.bGroup = new Uint8Array(M);
    this.bBroken = new Uint8Array(M);
    for (let b = 0; b < M; b++) {
      const bm = builder.beams[b];
      this.bA[b] = bm.a;
      this.bB[b] = bm.b;
      this.bRest[b] = this.bRest0[b] = bm.L;
      this.bCompliance[b] = 1 / bm.k;
      this.bDamp[b] = bm.damping;
      this.bYield[b] = bm.yieldStrain;
      this.bBreak[b] = bm.breakStretch;
      this.bMinRatio[b] = bm.minRatio;
      this.bGroup[b] = bm.group;
    }
    // frame from shape matching
    this.q = [0, 0, 0, 1];
    this.R = new Float64Array(9);
    this.R[0] = this.R[4] = this.R[8] = 1;
    this.com = [0, 0, 0];
    this.comVel = [0, 0, 0];
    this.aabb = new Float64Array(6);
    this.sleeping = false;
    this.sleepTimer = 0;
    this.canSleep = false;
    this.owner = null;
    this.plasticEnergy = 0; // accumulated permanent deformation measure
    this.frameDeform = 0; // plastic change this frame
    this.brokenCount = 0;
    this.impact = { speed: 0, x: 0, y: 0, z: 0, other: null };
    this.scrape = { amount: 0, x: 0, y: 0, z: 0, speed: 0, surface: 0 };
    this.staticCandidates = [];
    this.ignoreBodies = null; // Set of body ids not to collide with
    this.waterImmersion = 0;
    this.dragCoef = 0.0; // per-node linear air drag scaling
    this.enabled = true;
    this.placeAt([0, 0, 0], [0, 0, 0, 1]);
  }

  // Place body in world with rest shape, translation and rotation (quat). Resets velocities.
  placeAt(p, q, vel = null) {
    const R = quatToMat3(q, new Float64Array(9));
    const rc = this.restCom;
    for (let i = 0; i < this.n; i++) {
      const x = this.rest[i * 3] - rc[0], y = this.rest[i * 3 + 1] - rc[1], z = this.rest[i * 3 + 2] - rc[2];
      const wx = R[0] * x + R[1] * y + R[2] * z + p[0];
      const wy = R[3] * x + R[4] * y + R[5] * z + p[1];
      const wz = R[6] * x + R[7] * y + R[8] * z + p[2];
      this.pos[i * 3] = this.prev[i * 3] = wx;
      this.pos[i * 3 + 1] = this.prev[i * 3 + 1] = wy;
      this.pos[i * 3 + 2] = this.prev[i * 3 + 2] = wz;
      this.vel[i * 3] = vel ? vel[0] : 0;
      this.vel[i * 3 + 1] = vel ? vel[1] : 0;
      this.vel[i * 3 + 2] = vel ? vel[2] : 0;
    }
    this.q = [q[0], q[1], q[2], q[3]];
    this.R.set(R);
    this.com[0] = p[0]; this.com[1] = p[1]; this.com[2] = p[2];
    this.sleeping = false;
    this.sleepTimer = 0;
    this.computeAABB();
  }

  // Restore original beam lengths (full repair) and re-place in the current frame.
  repair(p = null, q = null) {
    this.bRest.set(this.bRest0);
    this.bBroken.fill(0);
    this.brokenCount = 0;
    this.plasticEnergy = 0;
    this.computeFrame();
    this.placeAt(p || this.com, q || this.q);
  }

  setVelocity(vx, vy, vz) {
    for (let i = 0; i < this.n; i++) {
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    }
  }

  addVelocity(vx, vy, vz) {
    for (let i = 0; i < this.n; i++) {
      this.vel[i * 3] += vx; this.vel[i * 3 + 1] += vy; this.vel[i * 3 + 2] += vz;
    }
  }

  wake() {
    this.sleeping = false;
    this.sleepTimer = 0;
  }

  predict(h, gy, world) {
    const pos = this.pos, prev = this.prev, vel = this.vel, f = this.force, im = this.invMass;
    const drag = this.dragCoef;
    const water = world.waterLevelAt;
    let immersed = 0;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      const w = im[i];
      if (w === 0) { f[k] = f[k + 1] = f[k + 2] = 0; prev[k] = pos[k]; prev[k + 1] = pos[k + 1]; prev[k + 2] = pos[k + 2]; continue; }
      let ax = f[k] * w, ay = f[k + 1] * w + gy, az = f[k + 2] * w;
      if (drag > 0) {
        const vx = vel[k], vy = vel[k + 1], vz = vel[k + 2];
        const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
        ax -= vx * sp * drag; ay -= vy * sp * drag; az -= vz * sp * drag;
      }
      if (water) {
        const wl = water(pos[k], pos[k + 2]);
        if (wl !== null && pos[k + 1] < wl) {
          const depth = Math.min(wl - pos[k + 1], 0.6);
          immersed++;
          ay += 9.81 * 1.25 * (depth / 0.6) * 1.0; // buoyancy (cars float a moment then sink)
          const wd = 2.2;
          ax -= vel[k] * wd; ay -= vel[k + 1] * wd; az -= vel[k + 2] * wd;
        }
      }
      vel[k] += ax * h; vel[k + 1] += ay * h; vel[k + 2] += az * h;
      prev[k] = pos[k]; prev[k + 1] = pos[k + 1]; prev[k + 2] = pos[k + 2];
      pos[k] += vel[k] * h; pos[k + 1] += vel[k + 1] * h; pos[k + 2] += vel[k + 2] * h;
      f[k] = f[k + 1] = f[k + 2] = 0;
    }
    this.waterImmersion = immersed / this.n;
  }

  solveBeams(h) {
    const p = this.pos, w = this.invMass;
    const ih2 = 1 / (h * h);
    const bA = this.bA, bB = this.bB, rest = this.bRest, rest0 = this.bRest0, comp = this.bCompliance;
    const yieldS = this.bYield, brk = this.bBreak, minR = this.bMinRatio, broken = this.bBroken;
    let plastic = 0;
    for (let b = 0; b < this.m; b++) {
      if (broken[b]) continue;
      const ia = bA[b], ib = bB[b];
      const i = ia * 3, j = ib * 3;
      let dx = p[j] - p[i], dy = p[j + 1] - p[i + 1], dz = p[j + 2] - p[i + 2];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L < 1e-7) continue;
      const r = rest[b];
      const C = L - r;
      const strain = C / r;
      const ys = yieldS[b];
      if (strain > ys || strain < -ys) {
        // plastic flow: move rest length so that remaining elastic strain equals yield strain
        let nr = strain > 0 ? L / (1 + ys) : L / (1 - ys);
        const r0 = rest0[b];
        const lo = r0 * minR[b];
        if (nr < lo) nr = lo;
        plastic += Math.abs(nr - r);
        rest[b] = nr;
        if (nr > r0 * (1 + brk[b])) {
          broken[b] = 1;
          this.brokenCount++;
          continue;
        }
      }
      const wa = w[ia], wb = w[ib];
      const ws = wa + wb;
      if (ws === 0) continue;
      const dl = -(L - rest[b]) / (ws + comp[b] * ih2);
      const inv = 1 / L;
      dx *= inv; dy *= inv; dz *= inv;
      const sa = -wa * dl, sb = wb * dl;
      p[i] += sa * dx; p[i + 1] += sa * dy; p[i + 2] += sa * dz;
      p[j] += sb * dx; p[j + 1] += sb * dy; p[j + 2] += sb * dz;
    }
    if (plastic > 0) {
      this.plasticEnergy += plastic;
      this.frameDeform += plastic;
    }
  }

  updateVelocities(h) {
    const pos = this.pos, prev = this.prev, vel = this.vel;
    const ih = 1 / h;
    for (let k = 0; k < this.n * 3; k++) vel[k] = (pos[k] - prev[k]) * ih;
    // sanity limit (~430 km/h per node) guards against numerical blow-ups
    const vmax = 120;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      const s2 = vel[k] * vel[k] + vel[k + 1] * vel[k + 1] + vel[k + 2] * vel[k + 2];
      if (s2 > vmax * vmax) {
        const f = vmax / Math.sqrt(s2);
        vel[k] *= f; vel[k + 1] *= f; vel[k + 2] *= f;
      }
    }
  }

  dampBeams(h) {
    const p = this.pos, v = this.vel, w = this.invMass;
    const bA = this.bA, bB = this.bB, damp = this.bDamp, broken = this.bBroken;
    for (let b = 0; b < this.m; b++) {
      if (broken[b]) continue;
      const ia = bA[b], ib = bB[b];
      const i = ia * 3, j = ib * 3;
      let dx = p[j] - p[i], dy = p[j + 1] - p[i + 1], dz = p[j + 2] - p[i + 2];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L < 1e-7) continue;
      dx /= L; dy /= L; dz /= L;
      const dv = (v[j] - v[i]) * dx + (v[j + 1] - v[i + 1]) * dy + (v[j + 2] - v[i + 2]) * dz;
      const wa = w[ia], wb = w[ib], ws = wa + wb;
      if (ws === 0) continue;
      let f = damp[b] * h * ws;
      if (f > 0.9) f = 0.9;
      const corr = (f * dv) / ws;
      v[i] += wa * corr * dx; v[i + 1] += wa * corr * dy; v[i + 2] += wa * corr * dz;
      v[j] -= wb * corr * dx; v[j + 1] -= wb * corr * dy; v[j + 2] -= wb * corr * dz;
    }
  }

  // Shape matching: best-fit rigid frame (rotation R, translation com) of the node cloud.
  computeFrame(iters = 3) {
    const n = this.n, pos = this.pos, rest = this.rest, m = this.mass, rc = this.restCom;
    let cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0, M = 0;
    const vel = this.vel;
    for (let i = 0; i < n; i++) {
      const mi = m[i], k = i * 3;
      cx += pos[k] * mi; cy += pos[k + 1] * mi; cz += pos[k + 2] * mi;
      vx += vel[k] * mi; vy += vel[k + 1] * mi; vz += vel[k + 2] * mi;
      M += mi;
    }
    cx /= M; cy /= M; cz /= M;
    this.com[0] = cx; this.com[1] = cy; this.com[2] = cz;
    this.comVel[0] = vx / M; this.comVel[1] = vy / M; this.comVel[2] = vz / M;
    // A = sum m (x - c)(r - rc)^T  (row-major, A[r][c])
    let a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0;
    for (let i = 0; i < n; i++) {
      const mi = m[i], k = i * 3;
      const px = (pos[k] - cx) * mi, py = (pos[k + 1] - cy) * mi, pz = (pos[k + 2] - cz) * mi;
      const qx = rest[k] - rc[0], qy = rest[k + 1] - rc[1], qz = rest[k + 2] - rc[2];
      a00 += px * qx; a01 += px * qy; a02 += px * qz;
      a10 += py * qx; a11 += py * qy; a12 += py * qz;
      a20 += pz * qx; a21 += pz * qy; a22 += pz * qz;
    }
    // Müller et al. 2016 iterative rotation extraction (warm started)
    const q = this.q, R = this.R;
    for (let it = 0; it < iters; it++) {
      quatToMat3(q, R);
      // columns of R: (R0,R3,R6), (R1,R4,R7), (R2,R5,R8); columns of A: (a00,a10,a20)...
      const r0x = R[0], r0y = R[3], r0z = R[6];
      const r1x = R[1], r1y = R[4], r1z = R[7];
      const r2x = R[2], r2y = R[5], r2z = R[8];
      let ox = (r0y * a20 - r0z * a10) + (r1y * a21 - r1z * a11) + (r2y * a22 - r2z * a12);
      let oy = (r0z * a00 - r0x * a20) + (r1z * a01 - r1x * a21) + (r2z * a02 - r2x * a22);
      let oz = (r0x * a10 - r0y * a00) + (r1x * a11 - r1y * a01) + (r2x * a12 - r2y * a02);
      const dot = r0x * a00 + r0y * a10 + r0z * a20 + r1x * a01 + r1y * a11 + r1z * a21 + r2x * a02 + r2y * a12 + r2z * a22;
      const s = 1 / (Math.abs(dot) + 1e-9);
      ox *= s; oy *= s; oz *= s;
      const wl = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (wl < 1e-9) break;
      const h = wl * 0.5, sn = Math.sin(h) / wl;
      const dq0 = ox * sn, dq1 = oy * sn, dq2 = oz * sn, dq3 = Math.cos(h);
      const x = q[0], y = q[1], z = q[2], w = q[3];
      q[0] = dq3 * x + dq0 * w + dq1 * z - dq2 * y;
      q[1] = dq3 * y - dq0 * z + dq1 * w + dq2 * x;
      q[2] = dq3 * z + dq0 * y - dq1 * x + dq2 * w;
      q[3] = dq3 * w - dq0 * x - dq1 * y - dq2 * z;
      quatNormalize(q);
    }
    quatToMat3(q, R);
  }

  computeAABB() {
    const p = this.pos, a = this.aabb;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3, r = this.radius[i];
      const x = p[k], y = p[k + 1], z = p[k + 2];
      if (x - r < x0) x0 = x - r; if (x + r > x1) x1 = x + r;
      if (y - r < y0) y0 = y - r; if (y + r > y1) y1 = y + r;
      if (z - r < z0) z0 = z - r; if (z + r > z1) z1 = z + r;
    }
    a[0] = x0; a[1] = y0; a[2] = z0; a[3] = x1; a[4] = y1; a[5] = z1;
  }

  // local (design-space) position of node i, given current frame
  localNode(i, out, off = 0) {
    const k = i * 3, R = this.R, c = this.com, rc = this.restCom;
    const dx = this.pos[k] - c[0], dy = this.pos[k + 1] - c[1], dz = this.pos[k + 2] - c[2];
    out[off] = R[0] * dx + R[3] * dy + R[6] * dz + rc[0];
    out[off + 1] = R[1] * dx + R[4] * dy + R[7] * dz + rc[1];
    out[off + 2] = R[2] * dx + R[5] * dy + R[8] * dz + rc[2];
    return out;
  }

  // world position of a design-space point (rigid frame only)
  toWorld(x, y, z, out, off = 0) {
    const R = this.R, c = this.com, rc = this.restCom;
    const dx = x - rc[0], dy = y - rc[1], dz = z - rc[2];
    out[off] = R[0] * dx + R[1] * dy + R[2] * dz + c[0];
    out[off + 1] = R[3] * dx + R[4] * dy + R[5] * dz + c[1];
    out[off + 2] = R[6] * dx + R[7] * dy + R[8] * dz + c[2];
    return out;
  }

  kineticEnergyPerMass() {
    let e = 0;
    const v = this.vel;
    for (let i = 0; i < this.n * 3; i++) e += v[i] * v[i];
    return e / this.n;
  }
}
