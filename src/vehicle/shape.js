// Parametric vehicle body shape. The same description drives the physics node lattice
// and the procedural render mesh, so the collision body matches what you see.
// Design space: origin on the ground at the middle of the wheelbase, +Y up, +Z forward, +X = left side.

import { clamp, lerp } from '../core/math.js';

// Monotone cubic (PCHIP) interpolation through [[x, y], ...] sorted by x
export function pchip(points) {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const d = new Array(n).fill(0);
  const delta = [];
  for (let i = 0; i < n - 1; i++) delta.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  if (n === 2) {
    d[0] = d[1] = delta[0];
  } else {
    d[0] = delta[0];
    d[n - 1] = delta[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (delta[i - 1] * delta[i] <= 0) d[i] = 0;
      else {
        const w1 = 2 * (xs[i + 1] - xs[i]) + (xs[i] - xs[i - 1]);
        const w2 = (xs[i + 1] - xs[i]) + 2 * (xs[i] - xs[i - 1]);
        d[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
      }
    }
  }
  return function (x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const hh = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / hh;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hh * d[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hh * d[i + 1];
  };
}

export class BodyShape {
  constructor(p) {
    this.p = p;
    this.style = p.style;
    this.length = p.length;
    this.width = p.width;
    this.wheelbase = p.wheelbase;
    this.zFront = p.wheelbase / 2 + p.frontOverhang;
    this.zRear = -(p.wheelbase / 2 + p.rearOverhang);
    this.zFA = p.wheelbase / 2;
    this.zRA = -p.wheelbase / 2;
    this.top = pchip(p.top);
    this.bottom = pchip(p.bottom);
    this.roofFn = p.roof ? pchip(p.roof) : null;
    this.roofRange = p.roof ? [p.roof[0][0], p.roof[p.roof.length - 1][0]] : null;
    this.cargo = p.cargo || null; // {z0, z1, top, hw}
    this.bed = p.bed || null; // pickup bed {z0, z1, top}
    this.cornerFront = p.cornerFront ?? 0.35;
    this.cornerRear = p.cornerRear ?? 0.3;
    this.roofWidth = p.roofWidth ?? 0.72;
    this.crown = p.crown ?? 0.03;
    this.archR = p.wheelRadius + (p.archGap ?? 0.085);
    this.wheelRadius = p.wheelRadius;
    this.track = p.track;
    this.tireWidth = p.tireWidth;
    this.axles = p.axles || [this.zFA, this.zRA];
    this.flare = p.flare ?? 0;
  }

  halfWidth(z) {
    const W = this.width / 2;
    let hw = W;
    const df = this.zFront - z;
    const rf = this.cornerFront;
    if (df < rf) hw = W - rf + Math.sqrt(Math.max(0, rf * rf - (rf - Math.max(df, 0)) ** 2));
    const dr = z - this.zRear;
    const rr = this.cornerRear;
    if (dr < rr) hw = Math.min(hw, W - rr + Math.sqrt(Math.max(0, rr * rr - (rr - Math.max(dr, 0)) ** 2)));
    // subtle fender flare around wheels
    if (this.flare) {
      for (const az of this.axles) {
        const d = Math.abs(z - az);
        if (d < this.archR * 1.5) hw += this.flare * Math.cos((d / (this.archR * 1.5)) * Math.PI * 0.5) ** 2;
      }
    }
    return hw;
  }

  archY(z) {
    let best = -1;
    for (const az of this.axles) {
      const d = Math.abs(z - az);
      if (d < this.archR) best = Math.max(best, this.wheelRadius + Math.sqrt(this.archR * this.archR - d * d) * 1.0);
    }
    return best;
  }

  roofAt(z) {
    if (!this.roofFn) return null;
    if (z < this.roofRange[0] || z > this.roofRange[1]) return null;
    return this.roofFn(z);
  }

  // Half cross-section polygon of the lower hull at z (from bottom center to top center)
  hullSection(z) {
    const yb = this.bottom(z);
    const yt = this.top(z);
    const hw = this.halfWidth(z);
    const s = hw / (this.width / 2);
    const archTop = this.archY(z);
    const yA = Math.max(yb, archTop);
    const xIn = Math.min(hw * 0.9, Math.max(0.2, this.track / 2 - this.tireWidth / 2 - 0.06));
    const H = yt - yb;
    const y4 = Math.max(yA + 0.025, yb + H * 0.3);
    const y5 = Math.max(y4 + 0.02, yb + H * 0.68);
    const y6 = Math.max(y5 + 0.01, yt - Math.min(0.07, H * 0.12));
    const y7 = Math.max(y6 + 0.005, yt - 0.012);
    const cr = this.crown * s;
    const inset = Math.min(0.06, hw * 0.06);
    return [
      [0, yb],
      [xIn * s, yb],
      [xIn * s, yA],
      [hw - 0.035, yA],
      [hw - 0.004, y4],
      [hw, y5],
      [hw - inset * 0.55, y6],
      [hw - inset * 1.6, y7],
      [hw * 0.6, yt + cr * 0.75],
      [0, yt + cr],
    ];
  }

  // Half cross-section of greenhouse at z: [belt outer, upper side, roof edge, center]
  cabinSection(z) {
    const ry = this.roofAt(z);
    if (ry === null) return null;
    const yt = this.top(z);
    const hw = this.halfWidth(z);
    const hb = hw - Math.min(0.06, hw * 0.06) * 1.6;
    const hr = hw * this.roofWidth;
    const H = Math.max(ry - yt, 0);
    const k = clamp(H / 0.15, 0, 1);
    return [
      [hb, yt - 0.012],
      [lerp(hb, hr + 0.05, 0.92), yt + H * 0.84],
      [lerp(hb, hr - 0.02, 0.98), yt + H * 0.975 + 0.0 * k],
      [hr * 0.55, ry + 0.012 * k],
      [0, ry + 0.018 * k],
    ];
  }
}
