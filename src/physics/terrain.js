// Heightfield terrain with bilinear interpolation, analytic gradient and surface material map.

export class Terrain {
  constructor(size, res) {
    this.size = size; // world size in metres (square, centred on origin)
    this.res = res; // vertices per side
    this.step = size / (res - 1);
    this.half = size / 2;
    this.h = new Float32Array(res * res);
    this.surf = new Uint8Array(res * res);
    this.waterBodies = []; // {x, z, r, level} circles
  }

  idx(i, j) {
    return j * this.res + i;
  }

  // world -> grid coords
  heightAt(x, z) {
    const s = this.step, r = this.res;
    let gx = (x + this.half) / s, gz = (z + this.half) / s;
    if (gx < 0) gx = 0; else if (gx > r - 1.001) gx = r - 1.001;
    if (gz < 0) gz = 0; else if (gz > r - 1.001) gz = r - 1.001;
    const i = gx | 0, j = gz | 0;
    const fx = gx - i, fz = gz - j;
    const k = j * r + i;
    const h = this.h;
    const h00 = h[k], h10 = h[k + 1], h01 = h[k + r], h11 = h[k + r + 1];
    return h00 + (h10 - h00) * fx + (h01 - h00) * fz + (h00 - h10 - h01 + h11) * fx * fz;
  }

  // Writes [height, nx, ny, nz] into out
  sample(x, z, out) {
    const s = this.step, r = this.res;
    let gx = (x + this.half) / s, gz = (z + this.half) / s;
    if (gx < 0) gx = 0; else if (gx > r - 1.001) gx = r - 1.001;
    if (gz < 0) gz = 0; else if (gz > r - 1.001) gz = r - 1.001;
    const i = gx | 0, j = gz | 0;
    const fx = gx - i, fz = gz - j;
    const k = j * r + i;
    const h = this.h;
    const h00 = h[k], h10 = h[k + 1], h01 = h[k + r], h11 = h[k + r + 1];
    const c = h00 - h10 - h01 + h11;
    out[0] = h00 + (h10 - h00) * fx + (h01 - h00) * fz + c * fx * fz;
    const dhdx = ((h10 - h00) + c * fz) / s;
    const dhdz = ((h01 - h00) + c * fx) / s;
    const il = 1 / Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
    out[1] = -dhdx * il;
    out[2] = il;
    out[3] = -dhdz * il;
    return out;
  }

  surfaceAt(x, z) {
    const s = this.step, r = this.res;
    let i = Math.round((x + this.half) / s), j = Math.round((z + this.half) / s);
    if (i < 0) i = 0; else if (i > r - 1) i = r - 1;
    if (j < 0) j = 0; else if (j > r - 1) j = r - 1;
    return this.surf[j * r + i];
  }

  waterLevelAt(x, z) {
    const wb = this.waterBodies;
    for (let i = 0; i < wb.length; i++) {
      const w = wb[i];
      const dx = x - w.x, dz = z - w.z;
      if (dx * dx + dz * dz < w.r * w.r) return w.level;
    }
    return null;
  }

  // Ray march + bisection. Returns t (Infinity if none).
  raycast(ox, oy, oz, dx, dy, dz, maxT, out) {
    const stepLen = 0.5;
    let tPrev = 0;
    let prevAbove = oy - this.heightAt(ox, oz);
    if (prevAbove < 0) {
      out[0] = 0;
      this.sample(ox, oz, out);
      out[0] = 0;
      return 0;
    }
    for (let t = stepLen; ; t += stepLen) {
      const tt = t > maxT ? maxT : t;
      const x = ox + dx * tt, y = oy + dy * tt, z = oz + dz * tt;
      const above = y - this.heightAt(x, z);
      if (above < 0) {
        let a = tPrev, b = tt;
        for (let k = 0; k < 10; k++) {
          const m = (a + b) * 0.5;
          const xm = ox + dx * m, zm = oz + dz * m;
          if (oy + dy * m - this.heightAt(xm, zm) < 0) b = m; else a = m;
        }
        const tHit = (a + b) * 0.5;
        this.sample(ox + dx * tHit, oz + dz * tHit, out);
        return tHit;
      }
      tPrev = tt;
      if (tt >= maxT) break;
    }
    return Infinity;
  }
}
