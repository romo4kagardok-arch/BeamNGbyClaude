// Static collision geometry: oriented boxes and vertical cylinders stored in a 2D uniform grid.
// Supports sphere contact queries (for soft-body nodes) and raycasts (for wheels and the editor).

export const SURF = {
  GRASS: 0, ASPHALT: 1, DIRT: 2, SAND: 3, CONCRETE: 4, ROCK: 5, SNOW: 6, WOOD: 7, METAL: 8, MUD: 9, CURB: 10,
};
// grip, rolling resistance, dust colour index, is "soft" (makes dust)
export const SURF_PROPS = [
  { name: 'grass', grip: 0.62, roll: 0.035, dust: 1, bump: 0.012 },
  { name: 'asphalt', grip: 1.0, roll: 0.012, dust: 0, bump: 0.0 },
  { name: 'dirt', grip: 0.72, roll: 0.03, dust: 2, bump: 0.02 },
  { name: 'sand', grip: 0.55, roll: 0.08, dust: 3, bump: 0.01 },
  { name: 'concrete', grip: 0.95, roll: 0.012, dust: 0, bump: 0.0 },
  { name: 'rock', grip: 0.8, roll: 0.02, dust: 2, bump: 0.025 },
  { name: 'snow', grip: 0.38, roll: 0.04, dust: 4, bump: 0.005 },
  { name: 'wood', grip: 0.85, roll: 0.015, dust: 0, bump: 0.0 },
  { name: 'metal', grip: 0.75, roll: 0.012, dust: 0, bump: 0.0 },
  { name: 'mud', grip: 0.4, roll: 0.12, dust: 5, bump: 0.015 },
  { name: 'curb', grip: 0.9, roll: 0.015, dust: 0, bump: 0.015 },
];

export class StaticWorld {
  constructor(minX = -1100, minZ = -1100, size = 2200, cell = 8) {
    this.minX = minX;
    this.minZ = minZ;
    this.cell = cell;
    this.dim = Math.ceil(size / cell);
    this.cells = new Array(this.dim * this.dim);
    this.colliders = [];
    this.free = [];
    this.stamp = new Uint32Array(1024);
    this.stampId = 1;
  }

  _cellRange(c) {
    const m = 0.6; // margin for node radius
    const cs = this.cell;
    const x0 = Math.max(0, Math.floor((c.minX - m - this.minX) / cs));
    const x1 = Math.min(this.dim - 1, Math.floor((c.maxX + m - this.minX) / cs));
    const z0 = Math.max(0, Math.floor((c.minZ - m - this.minZ) / cs));
    const z1 = Math.min(this.dim - 1, Math.floor((c.maxZ + m - this.minZ) / cs));
    return [x0, x1, z0, z1];
  }

  // Box: center, yaw/pitch/roll via axes, half extents
  addBox(opts) {
    const { x, y, z, hx, hy, hz } = opts;
    let ax = opts.ax, ay = opts.ay, az = opts.az;
    if (!ax) {
      // build from yaw (around Y), pitch (around local X), roll (around local Z)
      const yaw = opts.yaw || 0, pitch = opts.pitch || 0, roll = opts.roll || 0;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
      // R = Ry * Rx * Rz
      const m00 = cy * cr + sy * sp * sr, m01 = -cy * sr + sy * sp * cr, m02 = sy * cp;
      const m10 = cp * sr, m11 = cp * cr, m12 = -sp;
      const m20 = -sy * cr + cy * sp * sr, m21 = sy * sr + cy * sp * cr, m22 = cy * cp;
      ax = [m00, m10, m20];
      ay = [m01, m11, m21];
      az = [m02, m12, m22];
    }
    const ex = Math.abs(ax[0]) * hx + Math.abs(ay[0]) * hy + Math.abs(az[0]) * hz;
    const ey = Math.abs(ax[1]) * hx + Math.abs(ay[1]) * hy + Math.abs(az[1]) * hz;
    const ez = Math.abs(ax[2]) * hx + Math.abs(ay[2]) * hy + Math.abs(az[2]) * hz;
    const c = {
      type: 0, x, y, z, hx, hy, hz, ax, ay, az,
      minX: x - ex, maxX: x + ex, minY: y - ey, maxY: y + ey, minZ: z - ez, maxZ: z + ez,
      friction: opts.friction ?? 0.6,
      surface: opts.surface ?? 4,
      breakable: opts.breakable || 0,
      userData: opts.userData || null,
      hitImpulse: 0,
      enabled: true,
    };
    return this._insert(c);
  }

  addCylinder(opts) {
    const { x, z, y0, y1, r } = opts;
    const c = {
      type: 1, x, z, y0, y1, r,
      minX: x - r, maxX: x + r, minY: y0, maxY: y1, minZ: z - r, maxZ: z + r,
      friction: opts.friction ?? 0.5,
      surface: opts.surface ?? 7,
      breakable: opts.breakable || 0,
      userData: opts.userData || null,
      hitImpulse: 0,
      enabled: true,
    };
    return this._insert(c);
  }

  _insert(c) {
    const id = this.free.length ? this.free.pop() : this.colliders.length;
    c.id = id;
    this.colliders[id] = c;
    const [x0, x1, z0, z1] = this._cellRange(c);
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const k = cz * this.dim + cx;
        (this.cells[k] || (this.cells[k] = [])).push(id);
      }
    if (this.stamp.length < this.colliders.length + 1) {
      const s = new Uint32Array(this.colliders.length * 2);
      s.set(this.stamp);
      this.stamp = s;
    }
    return id;
  }

  remove(id) {
    const c = this.colliders[id];
    if (!c) return;
    const [x0, x1, z0, z1] = this._cellRange(c);
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.cells[cz * this.dim + cx];
        if (!arr) continue;
        const i = arr.indexOf(id);
        if (i >= 0) arr.splice(i, 1);
      }
    this.colliders[id] = null;
    this.free.push(id);
  }

  // Collect collider ids overlapping an xz rectangle into out array
  query(minX, minZ, maxX, maxZ, out, minY = -Infinity, maxY = Infinity) {
    out.length = 0;
    const cs = this.cell;
    const x0 = Math.max(0, Math.floor((minX - this.minX) / cs));
    const x1 = Math.min(this.dim - 1, Math.floor((maxX - this.minX) / cs));
    const z0 = Math.max(0, Math.floor((minZ - this.minZ) / cs));
    const z1 = Math.min(this.dim - 1, Math.floor((maxZ - this.minZ) / cs));
    if (x1 < x0 || z1 < z0) return out;
    const sid = ++this.stampId;
    const st = this.stamp;
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.cells[cz * this.dim + cx];
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const id = arr[i];
          if (st[id] === sid) continue;
          st[id] = sid;
          const c = this.colliders[id];
          if (!c || !c.enabled) continue;
          if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
          if (c.maxY < minY || c.minY > maxY) continue;
          out.push(c);
        }
      }
    return out;
  }

  // Sphere vs collider. Returns penetration depth and writes normal into n, or 0.
  static sphereContact(c, px, py, pz, r, n) {
    if (c.type === 0) {
      const dx = px - c.x, dy = py - c.y, dz = pz - c.z;
      const ax = c.ax, ay = c.ay, az = c.az;
      const lx = dx * ax[0] + dy * ax[1] + dz * ax[2];
      const ly = dx * ay[0] + dy * ay[1] + dz * ay[2];
      const lz = dx * az[0] + dy * az[1] + dz * az[2];
      const hx = c.hx, hy = c.hy, hz = c.hz;
      if (lx > hx + r || lx < -hx - r || ly > hy + r || ly < -hy - r || lz > hz + r || lz < -hz - r) return 0;
      const cx = lx < -hx ? -hx : lx > hx ? hx : lx;
      const cy = ly < -hy ? -hy : ly > hy ? hy : ly;
      const cz = lz < -hz ? -hz : lz > hz ? hz : lz;
      let ex = lx - cx, ey = ly - cy, ez = lz - cz;
      const d2 = ex * ex + ey * ey + ez * ez;
      let pen;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        if (d >= r) return 0;
        ex /= d; ey /= d; ez /= d;
        pen = r - d;
      } else {
        // inside box: push out along least penetration axis
        const px_ = hx - Math.abs(lx), py_ = hy - Math.abs(ly), pz_ = hz - Math.abs(lz);
        ex = ey = ez = 0;
        if (px_ <= py_ && px_ <= pz_) { ex = lx < 0 ? -1 : 1; pen = px_ + r; }
        else if (py_ <= pz_) { ey = ly < 0 ? -1 : 1; pen = py_ + r; }
        else { ez = lz < 0 ? -1 : 1; pen = pz_ + r; }
      }
      n[0] = ax[0] * ex + ay[0] * ey + az[0] * ez;
      n[1] = ax[1] * ex + ay[1] * ey + az[1] * ez;
      n[2] = ax[2] * ex + ay[2] * ey + az[2] * ez;
      return pen;
    } else {
      if (py < c.y0 - r || py > c.y1 + r) return 0;
      const dx = px - c.x, dz = pz - c.z;
      const d2 = dx * dx + dz * dz;
      const rr = c.r + r;
      if (d2 >= rr * rr) return 0;
      const d = Math.sqrt(d2);
      const side = rr - d;
      const top = c.y1 + r - py;
      if (top < side && top > 0 && d < c.r + r * 0.5) {
        n[0] = 0; n[1] = 1; n[2] = 0;
        return top;
      }
      if (d < 1e-6) { n[0] = 1; n[1] = 0; n[2] = 0; return side; }
      n[0] = dx / d; n[1] = 0; n[2] = dz / d;
      return side;
    }
  }

  // Ray vs list of colliders (boxes only). Returns t or Infinity; writes normal + collider into hit
  static raycastList(list, ox, oy, oz, dx, dy, dz, maxT, hit) {
    let best = maxT;
    let found = null;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.type !== 0) continue;
      const rx = ox - c.x, ry = oy - c.y, rz = oz - c.z;
      const ax = c.ax, ay = c.ay, az = c.az;
      const o = [rx * ax[0] + ry * ax[1] + rz * ax[2], rx * ay[0] + ry * ay[1] + rz * ay[2], rx * az[0] + ry * az[1] + rz * az[2]];
      const d = [dx * ax[0] + dy * ax[1] + dz * ax[2], dx * ay[0] + dy * ay[1] + dz * ay[2], dx * az[0] + dy * az[1] + dz * az[2]];
      const h = [c.hx, c.hy, c.hz];
      let tmin = -Infinity, tmax = Infinity, axis = -1, sgn = 0;
      let ok = true;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-9) {
          if (o[a] < -h[a] || o[a] > h[a]) { ok = false; break; }
        } else {
          let t1 = (-h[a] - o[a]) / d[a], t2 = (h[a] - o[a]) / d[a];
          let s = -1;
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
          if (t1 > tmin) { tmin = t1; axis = a; sgn = s; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) { ok = false; break; }
        }
      }
      if (!ok || tmax < 0 || axis < 0) continue;
      if (tmin < 0) continue; // origin inside box: ignore
      if (tmin < best) {
        best = tmin;
        found = c;
        const A = axis === 0 ? ax : axis === 1 ? ay : az;
        hit.nx = A[0] * sgn; hit.ny = A[1] * sgn; hit.nz = A[2] * sgn;
      }
    }
    hit.collider = found;
    return found ? best : Infinity;
  }

  raycast(ox, oy, oz, dx, dy, dz, maxT, hit) {
    const ex = ox + dx * maxT, ez = oz + dz * maxT;
    const tmp = [];
    this.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), tmp);
    return StaticWorld.raycastList(tmp, ox, oy, oz, dx, dy, dz, maxT, hit);
  }
}
