// Physics world: fixed small substeps, soft bodies, controllers (vehicles), static + terrain collisions,
// body-vs-body node collisions, sleeping of idle props, breakable static objects.

import { StaticWorld, SURF_PROPS } from './statics.js';

const tmp4 = new Float64Array(4);
const nrm = new Float64Array(3);

export class PhysicsWorld {
  constructor(terrain, statics) {
    this.terrain = terrain;
    this.statics = statics;
    this.bodies = [];
    this.controllers = [];
    this.gravity = -9.81;
    this.h = 1 / 1000;
    this.timeScale = 1;
    this.acc = 0;
    this.maxSubsteps = 34;
    this.time = 0;
    this.paused = false;
    this.waterLevelAt = terrain && terrain.waterBodies.length ? (x, z) => terrain.waterLevelAt(x, z) : null;
    this.onStaticBreak = null;
    this.substepsLastFrame = 0;
  }

  refreshWater() {
    this.waterLevelAt = this.terrain && this.terrain.waterBodies.length ? (x, z) => this.terrain.waterLevelAt(x, z) : null;
  }

  addBody(b) {
    if (!this.bodies.includes(b)) this.bodies.push(b);
    return b;
  }
  removeBody(b) {
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
  }
  addController(c) {
    if (!this.controllers.includes(c)) this.controllers.push(c);
  }
  removeController(c) {
    const i = this.controllers.indexOf(c);
    if (i >= 0) this.controllers.splice(i, 1);
  }

  step(dt) {
    if (this.paused) { this.substepsLastFrame = 0; return 0; }
    this.acc += Math.min(dt, 0.1) * this.timeScale;
    let n = Math.floor(this.acc / this.h);
    if (n > this.maxSubsteps) {
      n = this.maxSubsteps;
      this.acc = 0;
    } else this.acc -= n * this.h;
    this.substepsLastFrame = n;
    if (n === 0) return 0;
    this.prepareFrame(n * this.h);
    for (let s = 0; s < n; s++) this.substep(this.h);
    this.finishFrame(n * this.h);
    return n;
  }

  prepareFrame(frameDt) {
    const statics = this.statics;
    for (const b of this.bodies) {
      b.impact.speed = 0;
      b.impact.other = null;
      b.scrape.amount = 0;
      b.scrape.speed = 0;
      b.scrape.x = b.scrape.y = b.scrape.z = 0;
      b.frameDeform = 0;
      b.contact.fill(0);
      if (!b.enabled) continue;
      if (b.canSleep && !b.sleeping) {
        const e = b.kineticEnergyPerMass();
        if (e < 0.02) {
          b.sleepTimer += frameDt;
          if (b.sleepTimer > 1.2) b.sleeping = true;
        } else b.sleepTimer = 0;
      }
      if (b.sleeping) continue;
      b.computeAABB();
      // candidate static colliders for this frame (expanded by motion)
      const a = b.aabb;
      const vx = Math.abs(b.comVel[0]) * frameDt + 1.0, vz = Math.abs(b.comVel[2]) * frameDt + 1.0;
      const vy = Math.abs(b.comVel[1]) * frameDt + 1.0;
      if (statics) statics.query(a[0] - vx, a[2] - vz, a[3] + vx, a[5] + vz, b.staticCandidates, a[1] - vy, a[4] + vy);
    }
    for (const c of this.controllers) if (c.prepareFrame) c.prepareFrame(frameDt);
  }

  substep(h) {
    const bodies = this.bodies;
    const g = this.gravity;
    for (const c of this.controllers) c.preSubstep(h, this);
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.sleeping || !b.enabled) continue;
      b.predict(h, g, this);
    }
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.sleeping || !b.enabled) continue;
      b.solveBeams(h);
    }
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.sleeping || !b.enabled) continue;
      this.collideStatic(b, h);
    }
    // body-body
    for (let i = 0; i < bodies.length; i++) {
      const A = bodies[i];
      if (!A.enabled) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const B = bodies[j];
        if (!B.enabled) continue;
        if (A.sleeping && B.sleeping) continue;
        const a = A.aabb, bb = B.aabb;
        if (a[3] < bb[0] || a[0] > bb[3] || a[4] < bb[1] || a[1] > bb[4] || a[5] < bb[2] || a[2] > bb[5]) continue;
        if (A.ignoreBodies && A.ignoreBodies.has(B.id)) continue;
        if (B.ignoreBodies && B.ignoreBodies.has(A.id)) continue;
        if (A.sleeping) A.wake();
        if (B.sleeping) B.wake();
        this.collidePair(A, B, h);
      }
    }
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.sleeping || !b.enabled) continue;
      b.updateVelocities(h);
      b.dampBeams(h);
      b.computeAABB();
    }
    for (const c of this.controllers) if (c.postSubstep) c.postSubstep(h, this);
    this.time += h;
  }

  finishFrame(frameDt) {
    for (const b of this.bodies) {
      if (b.scrape.amount > 0) {
        b.scrape.x /= b.scrape.amount;
        b.scrape.y /= b.scrape.amount;
        b.scrape.z /= b.scrape.amount;
        b.scrape.speed /= b.scrape.amount;
      }
    }
    if (this.statics && this.onStaticBreak) {
      for (const b of this.bodies) {
        for (const c of b.staticCandidates) {
          if (c.breakable && c.hitImpulse > c.breakable && c.enabled) {
            c.enabled = false;
            this.onStaticBreak(c);
          }
          c.hitImpulse = 0;
        }
      }
    }
    for (const c of this.controllers) if (c.finishFrame) c.finishFrame(frameDt);
  }

  collideStatic(body, h) {
    const T = this.terrain;
    const p = body.pos, prev = body.prev, rad = body.radius, fr = body.friction, mass = body.mass;
    const cands = body.staticCandidates;
    const nc = cands.length;
    const ih = 1 / h;
    for (let i = 0; i < body.n; i++) {
      const k = i * 3;
      const r = rad[i];
      if (T) {
        const x = p[k], y = p[k + 1], z = p[k + 2];
        T.sample(x, z, tmp4);
        const dist = (y - tmp4[0]) * tmp4[2];
        if (dist < r) {
          const surf = T.surfaceAt(x, z);
          const mu = fr[i] * (0.6 + 0.4 * SURF_PROPS[surf].grip);
          this._contact(body, i, tmp4[1], tmp4[2], tmp4[3], r - dist, mu, ih, null, surf);
        }
      }
      if (nc) {
        const x = p[k], y = p[k + 1], z = p[k + 2];
        for (let c = 0; c < nc; c++) {
          const col = cands[c];
          if (x + r < col.minX || x - r > col.maxX || z + r < col.minZ || z - r > col.maxZ || y + r < col.minY || y - r > col.maxY) continue;
          const pen = StaticWorld.sphereContact(col, p[k], p[k + 1], p[k + 2], r, nrm);
          if (pen > 0) {
            const mu = Math.min(fr[i], col.friction) * 1.1;
            this._contact(body, i, nrm[0], nrm[1], nrm[2], pen, mu, ih, col, col.surface);
            if (col.breakable) {
              const vx = (p[k] - prev[k]) * ih, vz = (p[k + 2] - prev[k + 2]) * ih;
              col.hitImpulse += mass[i] * Math.hypot(vx, vz) * 0.05;
              col.hitDir = [vx, vz];
              col.hitPoint = [p[k], p[k + 1], p[k + 2]];
            }
          }
        }
      }
    }
  }

  _contact(body, i, nx, ny, nz, pen, mu, ih, collider, surf) {
    const p = body.pos, prev = body.prev;
    const k = i * 3;
    // limit correction per substep: deep initial penetration resolves over several substeps
    // instead of converting into an explosive velocity
    if (pen > 0.04) {
      const dvn = (prev[k] - p[k]) * nx + (prev[k + 1] - p[k + 1]) * ny + (prev[k + 2] - p[k + 2]) * nz;
      pen = Math.min(pen, 0.04 + Math.max(0, -dvn));
    }
    let dx = p[k] - prev[k], dy = p[k + 1] - prev[k + 1], dz = p[k + 2] - prev[k + 2];
    const vn = -(dx * nx + dy * ny + dz * nz) * ih;
    p[k] += nx * pen; p[k + 1] += ny * pen; p[k + 2] += nz * pen;
    dx = p[k] - prev[k]; dy = p[k + 1] - prev[k + 1]; dz = p[k + 2] - prev[k + 2];
    const dn = dx * nx + dy * ny + dz * nz;
    const tx = dx - dn * nx, ty = dy - dn * ny, tz = dz - dn * nz;
    const lt = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (lt > 1e-9) {
      const maxF = mu * pen;
      const s = lt < maxF * 1.15 ? 1 : maxF / lt;
      p[k] -= tx * s; p[k + 1] -= ty * s; p[k + 2] -= tz * s;
    }
    body.contact[i] = 1 + surf;
    if (vn > 1.2 && vn > body.impact.speed) {
      const im = body.impact;
      im.speed = vn; im.x = p[k]; im.y = p[k + 1]; im.z = p[k + 2];
      im.other = collider; im.surface = surf;
    }
    const ts = lt * ih;
    if (ts > 1.5) {
      const w = pen * ts;
      const sc = body.scrape;
      sc.amount += w;
      sc.x += p[k] * w; sc.y += p[k + 1] * w; sc.z += p[k + 2] * w;
      sc.speed += ts * w;
      sc.surface = surf;
    }
  }

  collidePair(A, B, h) {
    const pa = A.pos, pb = B.pos, qa = A.prev, qb = B.prev;
    const ra = A.radius, rb = B.radius, wa = A.invMass, wb = B.invMass;
    const ab = B.aabb, aa = A.aabb;
    const ih = 1 / h;
    // filter B nodes inside A's box
    const listB = this._listB || (this._listB = []);
    listB.length = 0;
    for (let j = 0; j < B.n; j++) {
      if (!B.collide[j]) continue;
      const k = j * 3;
      if (pb[k] < aa[0] - 0.4 || pb[k] > aa[3] + 0.4 || pb[k + 1] < aa[1] - 0.4 || pb[k + 1] > aa[4] + 0.4 || pb[k + 2] < aa[2] - 0.4 || pb[k + 2] > aa[5] + 0.4) continue;
      listB.push(j);
    }
    if (!listB.length) return;
    const mu = 0.45;
    for (let i = 0; i < A.n; i++) {
      if (!A.collide[i]) continue;
      const ki = i * 3;
      let x = pa[ki], y = pa[ki + 1], z = pa[ki + 2];
      if (x < ab[0] - 0.4 || x > ab[3] + 0.4 || y < ab[1] - 0.4 || y > ab[4] + 0.4 || z < ab[2] - 0.4 || z > ab[5] + 0.4) continue;
      const ri = ra[i];
      for (let jj = 0; jj < listB.length; jj++) {
        const j = listB[jj];
        const kj = j * 3;
        let dx = pb[kj] - x, dy = pb[kj + 1] - y, dz = pb[kj + 2] - z;
        const rr = ri + rb[j];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rr * rr) continue;
        const wi = wa[i], wj = wb[j], ws = wi + wj;
        if (ws === 0) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-6) { dx = 0; dy = 1; dz = 0; d = 1e-6; } else { dx /= d; dy /= d; dz /= d; }
        const pen = rr - d;
        // approach velocity
        const vax = pa[ki] - qa[ki], vay = pa[ki + 1] - qa[ki + 1], vaz = pa[ki + 2] - qa[ki + 2];
        const vbx = pb[kj] - qb[kj], vby = pb[kj + 1] - qb[kj + 1], vbz = pb[kj + 2] - qb[kj + 2];
        const vn = ((vax - vbx) * dx + (vay - vby) * dy + (vaz - vbz) * dz) * ih;
        const sa = (pen * wi) / ws, sb = (pen * wj) / ws;
        pa[ki] -= dx * sa; pa[ki + 1] -= dy * sa; pa[ki + 2] -= dz * sa;
        pb[kj] += dx * sb; pb[kj + 1] += dy * sb; pb[kj + 2] += dz * sb;
        // friction on relative tangential displacement
        const rx = (pa[ki] - qa[ki]) - (pb[kj] - qb[kj]);
        const ry = (pa[ki + 1] - qa[ki + 1]) - (pb[kj + 1] - qb[kj + 1]);
        const rz = (pa[ki + 2] - qa[ki + 2]) - (pb[kj + 2] - qb[kj + 2]);
        const rn = rx * dx + ry * dy + rz * dz;
        const tx = rx - rn * dx, ty = ry - rn * dy, tz = rz - rn * dz;
        const lt = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (lt > 1e-9) {
          const maxF = mu * pen;
          const s = lt < maxF ? 1 : maxF / lt;
          const fa = (s * wi) / ws, fb = (s * wj) / ws;
          pa[ki] -= tx * fa; pa[ki + 1] -= ty * fa; pa[ki + 2] -= tz * fa;
          pb[kj] += tx * fb; pb[kj + 1] += ty * fb; pb[kj + 2] += tz * fb;
        }
        x = pa[ki]; y = pa[ki + 1]; z = pa[ki + 2];
        if (vn > 1.0) {
          if (vn > A.impact.speed) { const im = A.impact; im.speed = vn; im.x = x; im.y = y; im.z = z; im.other = B; im.surface = 8; }
          if (vn > B.impact.speed) { const im = B.impact; im.speed = vn; im.x = x; im.y = y; im.z = z; im.other = A; im.surface = 8; }
        }
        const ts = lt * ih;
        if (ts > 2 && pen > 0.002) {
          const w = pen * ts;
          const sc = A.scrape;
          sc.amount += w; sc.x += x * w; sc.y += y * w; sc.z += z * w; sc.speed += ts * w; sc.surface = 8;
        }
      }
    }
  }
}
