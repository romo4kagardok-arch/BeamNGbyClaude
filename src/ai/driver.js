// AI drivers: path following with curvature-based speed planning (traffic, racers, fleeing suspects)
// and pursuit (police) with simple obstacle avoidance and stuck/flip recovery.
import { clamp, wrapAngle } from '../core/math.js';

// Pre-compute a drivable path with target speeds. pts: [[x,z],...]
export function makePath(pts, { closed = true, offset = 0, reverse = false, mu = 0.9, speedLimit = 60, brake = 6 } = {}) {
  let P = pts.map((p) => [p[0], p[1]]);
  if (reverse) P.reverse();
  const n = P.length;
  if (offset) {
    P = P.map((p, i) => {
      const a = P[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = P[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const tx = b[0] - a[0], tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      // right-hand side of travel direction: (−tz, tx) is left for +x=left convention → use (tz, -tx)
      return [p[0] - (tz / l) * offset, p[1] + (tx / l) * offset];
    });
  }
  const speed = new Float32Array(n);
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = P[closed ? (i - 3 + n) % n : Math.max(0, i - 3)], b = P[i], c = P[closed ? (i + 3) % n : Math.min(n - 1, i + 3)];
    const h1 = Math.atan2(b[0] - a[0], b[1] - a[1]), h2 = Math.atan2(c[0] - b[0], c[1] - b[1]);
    const dh = Math.abs(wrapAngle(h2 - h1));
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1]);
    const k = dh / Math.max(1, len);
    speed[i] = Math.min(speedLimit, Math.sqrt((mu * 9.81) / Math.max(k, 1e-4)));
    if (i > 0) dist[i] = dist[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  }
  // braking pass (twice around for closed paths)
  for (let rep = 0; rep < (closed ? 2 : 1); rep++) {
    for (let i = n - 2 + (closed ? 1 : 0); i >= 0; i--) {
      const j = (i + 1) % n;
      const d = Math.hypot(P[j][0] - P[i][0], P[j][1] - P[i][1]);
      speed[i] = Math.min(speed[i], Math.sqrt(speed[j] * speed[j] + 2 * brake * d));
    }
  }
  const total = dist[n - 1] + (closed ? Math.hypot(P[0][0] - P[n - 1][0], P[0][1] - P[n - 1][1]) : 0);
  return { pts: P, speed, dist, closed, n, total };
}

export function nearestIndex(path, x, z, hint = -1, window = 40) {
  let best = -1, bd = Infinity;
  const n = path.n;
  if (hint >= 0) {
    for (let k = -window; k <= window * 2; k++) {
      let i = hint + k;
      if (path.closed) i = ((i % n) + n) % n;
      else if (i < 0 || i >= n) continue;
      const p = path.pts[i];
      const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    if (bd < 900) return best;
  }
  for (let i = 0; i < n; i++) {
    const p = path.pts[i];
    const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export class AIDriver {
  constructor(vehicle, opts = {}) {
    this.v = vehicle;
    this.role = opts.role || 'traffic';
    this.path = opts.path || null;
    this.idx = -1;
    this.skill = opts.skill ?? 0.9;
    this.speedFactor = opts.speedFactor ?? 1;
    this.lateral = opts.lateral || 0;
    this.target = opts.target || null; // vehicle to chase
    this.stuck = 0;
    this.reverseT = 0;
    this.flipT = 0;
    this.enabled = true;
    this.allowRecover = opts.allowRecover ?? true;
    this.maxSpeed = opts.maxSpeed ?? 80;
    this.progress = 0;
    this.lap = 0;
    this.lastIdx = -1;
    this.aggro = opts.aggro ?? 1;
    this.avoidT = 0;
    this.avoidSide = 1;
  }

  steerTo(tx, tz) {
    const v = this.v, b = v.body, R = b.R, c = b.com;
    const fx = R[2], fz = R[8];
    const yaw = Math.atan2(fx, fz);
    const ang = wrapAngle(Math.atan2(tx - c[0], tz - c[2]) - yaw);
    const L = Math.max(4, Math.hypot(tx - c[0], tz - c[2]));
    const curv = (2 * Math.sin(ang)) / L;
    const delta = Math.atan(curv * v.shape.wheelbase);
    const vs = Math.abs(v.fwdSpeed);
    const maxSteer = ((v.def.steer || 34) * Math.PI) / 180;
    const lim = Math.max(maxSteer / (1 + (vs * vs) / (24 * 24)), maxSteer * 0.12);
    return { steer: clamp(delta / lim, -1, 1), ang };
  }

  update(dt, game) {
    const v = this.v;
    if (!this.enabled || !v.body.enabled) { v.input.throttle = 0; v.input.brake = 0; v.input.steerDirect = 0; return; }
    const inp = v.input;
    const b = v.body, c = b.com;
    const up = v.up;
    // flip recovery
    if (up[1] < 0.25) this.flipT += dt; else this.flipT = 0;
    if (this.flipT > 3.5 && this.allowRecover) { this.flipT = 0; v.repair(); return; }
    let targetSpeed = 0, steer = 0, tx = c[0], tz = c[2];
    const speed = v.fwdSpeed;
    if (this.role === 'police' && this.target) {
      const T = this.target.body;
      const dx = T.com[0] - c[0], dz = T.com[2] - c[2];
      const d = Math.hypot(dx, dz);
      const lead = clamp(d / 25, 0, 1.2);
      tx = T.com[0] + T.comVel[0] * lead;
      tz = T.com[2] + T.comVel[2] * lead;
      // ram: aim slightly to the side of the target's rear when close
      if (d < 18) {
        const tR = T.R;
        tx += tR[0] * 0.8 * this.avoidSide - tR[2] * 1.5;
        tz += tR[6] * 0.8 * this.avoidSide - tR[8] * 1.5;
      }
      const st = this.steerTo(tx, tz);
      steer = st.steer;
      const tspd = Math.hypot(T.comVel[0], T.comVel[2]);
      targetSpeed = Math.min(this.maxSpeed, Math.max(tspd + 8 * this.aggro, 12)) * (Math.abs(st.ang) > 1.2 ? 0.45 : 1);
      if (d < 6 && tspd < 3) targetSpeed = 3;
    } else if (this.path) {
      const P = this.path;
      this.idx = nearestIndex(P, c[0], c[2], this.idx);
      // progress (for race positions)
      if (this.lastIdx >= 0 && P.closed) {
        if (this.lastIdx > P.n * 0.8 && this.idx < P.n * 0.2) this.lap++;
        if (this.lastIdx < P.n * 0.2 && this.idx > P.n * 0.8) this.lap--;
      }
      this.lastIdx = this.idx;
      this.progress = this.lap * P.total + P.dist[this.idx];
      const look = clamp(6 + Math.abs(speed) * 0.55, 7, 32);
      let i = this.idx, acc = 0;
      while (acc < look) {
        const j = P.closed ? (i + 1) % P.n : Math.min(P.n - 1, i + 1);
        if (j === i) break;
        acc += Math.hypot(P.pts[j][0] - P.pts[i][0], P.pts[j][1] - P.pts[i][1]);
        i = j;
      }
      let px = P.pts[i][0], pz = P.pts[i][1];
      // lateral offset (racers spread out)
      if (this.lateral || this.avoidT > 0) {
        const j = P.closed ? (i + 1) % P.n : Math.min(P.n - 1, i + 1);
        const ddx = P.pts[j][0] - px, ddz = P.pts[j][1] - pz;
        const l = Math.hypot(ddx, ddz) || 1;
        const off = this.lateral + (this.avoidT > 0 ? this.avoidSide * 3 : 0);
        px += (-ddz / l) * off; pz += (ddx / l) * off;
      }
      tx = px; tz = pz;
      steer = this.steerTo(px, pz).steer;
      // plan speed: min over the next ~60 m
      let mins = Infinity;
      let k = this.idx, dacc = 0;
      while (dacc < 70) {
        mins = Math.min(mins, P.speed[k]);
        const j = P.closed ? (k + 1) % P.n : Math.min(P.n - 1, k + 1);
        if (j === k) { mins = Math.min(mins, 0); break; }
        dacc += Math.hypot(P.pts[j][0] - P.pts[k][0], P.pts[j][1] - P.pts[k][1]);
        k = j;
      }
      targetSpeed = Math.min(this.maxSpeed, mins * this.skill * this.speedFactor);
      if (!P.closed && this.idx >= P.n - 3) targetSpeed = 0;
    }
    // traffic avoidance: slow down for vehicles ahead
    if (game && this.role !== 'police') {
      const R = b.R;
      const fx = R[2], fz = R[8];
      for (const o of game.vehicles) {
        if (o === v) continue;
        const dx = o.body.com[0] - c[0], dz = o.body.com[2] - c[2];
        const ahead = dx * fx + dz * fz;
        const side = Math.abs(dx * fz - dz * fx);
        if (ahead > 0 && ahead < 8 + Math.abs(speed) * 1.2 && side < 2.6) {
          const ov = o.body.comVel[0] * fx + o.body.comVel[2] * fz;
          targetSpeed = Math.min(targetSpeed, Math.max(0, ov - 1 + (ahead - 8) * 0.3));
          if (this.role === 'racer' && ahead < 18) { this.avoidT = 1.2; this.avoidSide = (dx * fz - dz * fx) > 0 ? -1 : 1; }
        }
      }
      this.avoidT -= dt;
    }
    // obstacle look-ahead against statics for police
    if (this.role === 'police' && game && speed > 5) {
      const R = b.R;
      const fx = R[2], fz = R[8];
      const hit = { nx: 0, ny: 0, nz: 0, collider: null };
      const t = game.statics.raycast(c[0], c[1] + 0.3, c[2], fx, 0, fz, Math.min(40, speed * 1.6), hit);
      if (t < Infinity) {
        // steer away from the obstacle normal
        const cross = fx * hit.nz - fz * hit.nx;
        steer = clamp(steer + (cross > 0 ? -0.8 : 0.8), -1, 1);
        targetSpeed = Math.min(targetSpeed, t * 0.6);
      }
    }
    // stuck handling
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      inp.throttle = 0;
      inp.brake = 1;
      inp.steerDirect = -steer;
      inp.handbrake = 0;
      return;
    }
    if (targetSpeed > 2 && Math.abs(speed) < 0.8) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt);
    if (this.stuck > 2.2) { this.stuck = 0; this.reverseT = 1.6; v.gear = -1; return; }
    if (v.gear < 0) v.gear = 1;
    const err = targetSpeed - speed;
    inp.throttle = clamp(err * 0.35 + (targetSpeed > 1 ? 0.15 : 0), 0, 1);
    inp.brake = err < -1.5 ? clamp(-err * 0.18, 0, 1) : targetSpeed < 0.5 && Math.abs(speed) < 2 ? 0.6 : 0;
    if (inp.brake > 0) inp.throttle = 0;
    inp.steerDirect = steer;
    inp.handbrake = 0;
  }
}
