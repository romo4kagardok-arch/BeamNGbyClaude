// Procedural open world "Долина Сталь" (2 x 2 km): city, highway ring, race circuit, proving ground,
// mountains with a serpentine pass, off-road park, lake, airfield and forests.
import { Terrain } from '../physics/terrain.js';
import { SURF } from '../physics/statics.js';
import { makeNoise2D, fbm, ridged, smoothstep, clamp, lerp, rng, sampleSpline } from '../core/math.js';

export const MAP_SIZE = 2048;
const RES = 513;

export const ZONES = {
  city: { x0: 110, x1: 650, z0: 30, z1: 570, h: 14, name: 'Новоград' },
  track: { x0: -660, x1: -160, z0: 200, z1: 570, h: 9, name: 'Кольцо Ветров' },
  proving: { x0: -570, x1: -190, z0: -310, z1: -50, h: 11, name: 'Полигон' },
  offroad: { x0: 360, x1: 640, z0: -420, z1: -170, h: null, name: 'Карьер' },
  airfield: { x0: -700, x1: 300, z0: 715, z1: 800, h: 6, name: 'Аэродром' },
};

function rectMask(z, x, zz, soft) {
  const dx = Math.max(z.x0 - x, 0, x - z.x1);
  const dz = Math.max(z.z0 - zz, 0, zz - z.z1);
  const d = Math.hypot(dx, dz);
  if (soft <= 0) return d <= 0 ? 1 : 0;
  return 1 - smoothstep(0, soft, d);
}

export function generateMap(seed = 7) {
  const T = new Terrain(MAP_SIZE, RES);
  const n1 = makeNoise2D(seed), n2 = makeNoise2D(seed + 11), n3 = makeNoise2D(seed + 23);
  const R = rng(seed * 31 + 5);
  const half = MAP_SIZE / 2, step = T.step;
  const lake = { x: 60, z: -250, r: 105, level: 4.2 };
  // ---------- base heights ----------
  for (let j = 0; j < RES; j++) {
    for (let i = 0; i < RES; i++) {
      const x = -half + i * step, z = -half + j * step;
      let h = 16 + 22 * fbm(n1, x / 650, z / 650, 5) + 4 * fbm(n2, x / 120, z / 120, 3);
      // northern mountains
      const m = smoothstep(-430, -700, z);
      h += m * (40 + 210 * ridged(n3, x / 420 + 3.1, z / 420 + 1.7, 5));
      // rim of mountains around the map edge
      const edge = Math.max(Math.abs(x), Math.abs(z));
      h += smoothstep(880, 1015, edge) * (90 + 60 * fbm(n2, x / 200, z / 200, 3));
      // lake bowl
      const dl = Math.hypot(x - lake.x, z - lake.z);
      if (dl < lake.r * 1.9) {
        const bowl = 1 - smoothstep(lake.r * 0.4, lake.r * 1.9, dl);
        h = lerp(h, lake.level - 7, bowl * bowl * (3 - 2 * bowl));
      }
      T.h[j * RES + i] = h;
    }
  }
  // ---------- zones ----------
  for (const [key, zn] of Object.entries(ZONES)) {
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
      const x = -half + i * step, z = -half + j * step;
      const m = rectMask(zn, x, z, 60);
      if (m <= 0) continue;
      const k = j * RES + i;
      if (zn.h === null) {
        // off-road: keep shape but tame it, add bumps
        const target = 18 + 6 * fbm(n2, x / 90, z / 90, 3) + 1.4 * fbm(n3, x / 14, z / 14, 2);
        T.h[k] = lerp(T.h[k], target, m);
      } else T.h[k] = lerp(T.h[k], zn.h, m);
    }
  }

  // ---------- roads ----------
  const roads = [];
  const addRoad = (pts, opts) => {
    const sampled = opts.raw ? pts.map((p) => p.slice()) : sampleSpline(pts, 3, !!opts.closed);
    const r = { pts: sampled, closed: !!opts.closed, width: opts.width || 10, surface: opts.surface ?? SURF.ASPHALT, kind: opts.kind || 'road', name: opts.name || '', grade: opts.grade || 0.09, lanes: opts.lanes || 2, flat: opts.flat ?? null, smooth: opts.smooth ?? 10 };
    roads.push(r);
    return r;
  };
  // highway ring
  const ring = addRoad([
    [-760, -430], [-800, -150], [-790, 120], [-790, 400], [-760, 640], [-560, 660], [-300, 650], [0, 655], [300, 650],
    [560, 660], [760, 640], [810, 420], [800, 120], [790, -120], [760, -420], [560, -480], [300, -490], [40, -470], [-200, -470], [-480, -460],
  ], { closed: true, width: 14, kind: 'highway', name: 'Кольцевая', lanes: 4, smooth: 18 });
  // city grid streets
  const CZ = ZONES.city;
  const streetXs = [], streetZs = [];
  for (let x = CZ.x0 + 20; x <= CZ.x1 - 10; x += 90) streetXs.push(x);
  for (let z = CZ.z0 + 20; z <= CZ.z1 - 10; z += 90) streetZs.push(z);
  for (const x of streetXs) addRoad([[x, streetZs[0] - 6], [x, streetZs[streetZs.length - 1] + 6]], { raw: false, width: 12, kind: 'street', flat: CZ.h });
  for (const z of streetZs) addRoad([[streetXs[0] - 6, z], [streetXs[streetXs.length - 1] + 6, z]], { width: 12, kind: 'street', flat: CZ.h });
  const cityE = streetXs[streetXs.length - 1], cityW = streetXs[0], cityS = streetZs[streetZs.length - 1], cityN = streetZs[0];
  const midZ = streetZs[Math.floor(streetZs.length / 2)], midX = streetXs[Math.floor(streetXs.length / 2)];
  // city connectors
  addRoad([[cityE, midZ], [700, midZ + 10], [804, midZ - 30]], { width: 12, kind: 'road' });
  addRoad([[midX, cityS], [midX + 10, 610], [midX, 652]], { width: 12, kind: 'road' });
  addRoad([[cityW, midZ], [40, midZ + 30], [-60, 400], [-150, 395]], { width: 12, kind: 'road', name: 'Трасса к кольцу' });
  addRoad([[cityW, cityN], [60, -40], [-60, -110], [-185, -150]], { width: 11, kind: 'road' });
  addRoad([[streetXs[2], cityN], [streetXs[2] + 20, -60], [300, -200], [360, -270]], { width: 9, kind: 'road' });
  // proving ground access and airfield access
  addRoad([[-380, -455], [-380, -380], [-380, -312]], { width: 12, kind: 'road' });
  addRoad([[-420, 572], [-420, 610], [-420, 652]], { width: 10, kind: 'road' });
  addRoad([[100, 657], [100, 700], [100, 748]], { width: 12, kind: 'road' });
  addRoad([[-790, 260], [-720, 270], [-662, 300]], { width: 10, kind: 'road' });
  // mountain pass (serpentine)
  const pass = addRoad([
    [-120, -472], [-90, -540], [-170, -590], [-230, -640], [-150, -680], [-60, -660], [10, -700], [-40, -760], [-140, -790],
    [-80, -850], [60, -860], [190, -820], [260, -760], [210, -700], [300, -660], [400, -640], [470, -560], [480, -490],
  ], { width: 9, kind: 'mountain', name: 'Перевал Орлиный', grade: 0.14, smooth: 6 });
  // off-road trails
  const OZ = ZONES.offroad;
  addRoad([[640, -330], [560, -320], [500, -360], [430, -380], [390, -320], [420, -250], [500, -210], [580, -240], [600, -300], [640, -330]], { width: 8, kind: 'trail', surface: SURF.DIRT, grade: 0.3, smooth: 2, closed: false });
  addRoad([[760, -420], [700, -360], [640, -330]], { width: 9, kind: 'trail', surface: SURF.DIRT, grade: 0.2, smooth: 4 });
  // race circuit
  const trackPts = [
    [-560, 250], [-470, 245], [-400, 270], [-330, 255], [-250, 240], [-195, 290], [-215, 360], [-280, 390], [-250, 450],
    [-205, 500], [-260, 545], [-360, 530], [-430, 480], [-500, 520], [-600, 530], [-635, 460], [-600, 400], [-630, 330], [-610, 270],
  ];
  const track = addRoad(trackPts, { closed: true, width: 14, kind: 'track', name: 'Кольцо Ветров', flat: ZONES.track.h });
  // runway
  const AZ = ZONES.airfield;
  const runway = addRoad([[-640, 758], [240, 758]], { width: 40, kind: 'runway', flat: AZ.h, name: 'ВПП' });

  // road heights: sample terrain, smooth, clamp grade
  for (const r of roads) {
    const n = r.pts.length;
    let hs = r.pts.map((p) => (r.flat !== null ? r.flat : T.heightAt(p[0], p[1])));
    if (r.flat === null) {
      const win = r.smooth;
      for (let pass2 = 0; pass2 < 2; pass2++) {
        const out = new Array(n);
        for (let i = 0; i < n; i++) {
          let s = 0, c = 0;
          for (let k = -win; k <= win; k++) {
            let ii = i + k;
            if (r.closed) ii = ((ii % n) + n) % n;
            else if (ii < 0 || ii >= n) continue;
            s += hs[ii]; c++;
          }
          out[i] = s / c;
        }
        hs = out;
      }
      // pin endpoints to roads already processed (junctions), blending the first/last ~50 m
      const ri = roads.indexOf(r);
      const done = roads.filter((o, oi) => o !== r && (oi < ri || o.flat !== null));
      const pinEnd = (endIdx, dir) => {
        if (r.closed) return;
        const p = r.pts[endIdx];
        let best = null, bd = Infinity;
        for (const o of done) {
          for (let k = 0; k < o.pts.length; k++) {
            const d = Math.hypot(o.pts[k][0] - p[0], o.pts[k][1] - p[1]);
            if (d < bd && d < o.width / 2 + 6) { bd = d; best = o.h ? o.h[k] : o.flat; }
          }
        }
        if (best === null) return null;
        // hold the junction height for a few samples (roads diverge at shallow angles), then blend
        const HOLD = Math.min(7, Math.floor(n / 4));
        const K = Math.min(20, Math.floor(n / 2));
        for (let k = 0; k <= K; k++) {
          const i = endIdx + dir * k;
          const t = k < HOLD ? 0 : smoothstep(0, 1, (k - HOLD) / Math.max(1, K - HOLD));
          hs[i] = best + (hs[i] - best) * t;
        }
        return best;
      };
      const pin0 = pinEnd(0, 1);
      const pin1 = pinEnd(n - 1, -1);
      // anchors: limit heights to grade cones from pinned ends (keeps junctions seamless)
      const seg = 3;
      if (pin0 !== null && pin1 !== null) {
        const need = Math.abs(pin0 - pin1) / Math.max(1, (n - 1 - 2 * Math.min(7, Math.floor(n / 4))) * seg);
        if (need > r.grade * 0.85) r.grade = need * 1.25;
      }
      const g3 = r.grade * seg;
      const HOLD = Math.min(7, Math.floor(n / 4));
      for (let i = 0; i < n; i++) {
        if (pin0 !== null) { const d = Math.max(0, i - HOLD); hs[i] = clamp(hs[i], pin0 - g3 * d, pin0 + g3 * d); }
        if (pin1 !== null) { const d = Math.max(0, n - 1 - i - HOLD); hs[i] = clamp(hs[i], pin1 - g3 * d, pin1 + g3 * d); }
      }
      // clamp grade (pinned ends are fixed)
      for (let it = 0; it < 3; it++) {
        for (let i = 1; i < n; i++) if (!(pin1 !== null && i === n - 1)) hs[i] = clamp(hs[i], hs[i - 1] - g3, hs[i - 1] + g3);
        for (let i = n - 2; i >= 0; i--) if (!(pin0 !== null && i === 0)) hs[i] = clamp(hs[i], hs[i + 1] - g3, hs[i + 1] + g3);
      }
    }
    // never below water
    r.h = hs.map((h, i) => {
      const p = r.pts[i];
      if (Math.hypot(p[0] - lake.x, p[1] - lake.z) < lake.r + 25) return Math.max(h, lake.level + 1.2);
      return h;
    });
  }
  // slope-limited corridor: terrain near a road may not rise/fall faster than ~31 degrees from it,
  // which turns deep cuts into valleys and high fills into embankments
  for (const r of roads) {
    if (r.kind === 'street' || r.kind === 'runway') continue;
    const hw = r.width / 2;
    const slope = 0.6, R = 110;
    const n = r.pts.length;
    const segs = r.closed ? n : n - 1;
    for (let s = 0; s < segs; s += 2) {
      const a = r.pts[s], b = r.pts[(s + 2) % n] || r.pts[n - 1];
      const ha = r.h[s], hb = r.h[(s + 2) % n] ?? r.h[n - 1];
      const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - R + half) / step)), i1 = Math.min(RES - 1, Math.ceil((Math.max(a[0], b[0]) + R + half) / step));
      const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - R + half) / step)), j1 = Math.min(RES - 1, Math.ceil((Math.max(a[1], b[1]) + R + half) / step));
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const L2 = dx * dx + dz * dz || 1;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -half + i * step, z = -half + j * step;
        const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L2, 0, 1);
        const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
        if (d > R) continue;
        const rh = ha + (hb - ha) * t;
        const allow = Math.max(0, d - hw - 2) * slope;
        const k = j * RES + i;
        const h = T.h[k];
        if (h > rh + allow) T.h[k] = rh + allow;
        else if (h < rh - allow) T.h[k] = rh - allow;
      }
    }
  }
  // rasterise roads into terrain
  const minD = new Float32Array(RES * RES).fill(1e9);
  const roadH = new Float32Array(RES * RES);
  const roadHW = new Float32Array(RES * RES);
  const roadSurf = new Uint8Array(RES * RES);
  for (const r of roads) {
    const hw = r.width / 2;
    const shoulder = r.kind === 'trail' ? 5 : r.kind === 'runway' ? 10 : 9;
    const reach = hw + shoulder;
    const n = r.pts.length;
    const segs = r.closed ? n : n - 1;
    for (let s = 0; s < segs; s++) {
      const a = r.pts[s], b = r.pts[(s + 1) % n];
      const ha = r.h[s], hb = r.h[(s + 1) % n];
      const minx = Math.min(a[0], b[0]) - reach, maxx = Math.max(a[0], b[0]) + reach;
      const minz = Math.min(a[1], b[1]) - reach, maxz = Math.max(a[1], b[1]) + reach;
      const i0 = Math.max(0, Math.floor((minx + half) / step)), i1 = Math.min(RES - 1, Math.ceil((maxx + half) / step));
      const j0 = Math.max(0, Math.floor((minz + half) / step)), j1 = Math.min(RES - 1, Math.ceil((maxz + half) / step));
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const L2 = dx * dx + dz * dz || 1;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -half + i * step, z = -half + j * step;
        let t = ((x - a[0]) * dx + (z - a[1]) * dz) / L2;
        t = clamp(t, 0, 1);
        const px = a[0] + dx * t, pz = a[1] + dz * t;
        const d = Math.hypot(x - px, z - pz);
        const k = j * RES + i;
        if (d < reach && d - hw < minD[k] - roadHW[k]) {
          minD[k] = d;
          roadH[k] = ha + (hb - ha) * t;
          roadHW[k] = hw;
          roadSurf[k] = r.surface;
        }
      }
    }
  }
  for (let k = 0; k < RES * RES; k++) {
    if (minD[k] > 1e8) continue;
    const hw = roadHW[k];
    const d = minD[k];
    const shoulder = 9;
    if (d <= hw + 1.5) T.h[k] = roadH[k];
    else T.h[k] = lerp(roadH[k], T.h[k], smoothstep(hw + 1.5, hw + shoulder, d));
  }

  // ---------- surfaces ----------
  const tmp = new Float64Array(4);
  for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
    const k = j * RES + i;
    const x = -half + i * step, z = -half + j * step;
    let s = SURF.GRASS;
    T.sample(x, z, tmp);
    const slope = 1 - tmp[2];
    const h = T.h[k];
    if (h > 215 + 25 * n2(x / 80, z / 80)) s = SURF.SNOW;
    else if (slope > 0.22) s = SURF.ROCK;
    const dl = Math.hypot(x - lake.x, z - lake.z);
    if (dl < lake.r + 12 && h < lake.level + 2.5) s = SURF.SAND;
    if (rectMask(ZONES.proving, x, z, 0) > 0.99) s = SURF.CONCRETE;
    if (rectMask(ZONES.offroad, x, z, 0) > 0.99) s = n2(x / 40, z / 40) > 0.35 ? SURF.MUD : SURF.DIRT;
    if (rectMask(CZ, x, z, 0) > 0.99) s = SURF.CONCRETE;
    if (minD[k] <= roadHW[k] + 0.5) s = roadSurf[k];
    T.surf[k] = s;
  }
  T.waterBodies.push(lake);

  // ---------- buildings ----------
  const buildings = [];
  const parks = [];
  const lamps = [];
  for (let a = 0; a < streetXs.length - 1; a++) {
    for (let b = 0; b < streetZs.length - 1; b++) {
      const x0 = streetXs[a] + 6 + 4, x1 = streetXs[a + 1] - 6 - 4;
      const z0 = streetZs[b] + 6 + 4, z1 = streetZs[b + 1] - 6 - 4;
      const roll = R();
      const central = Math.abs((x0 + x1) / 2 - (CZ.x0 + CZ.x1) / 2) < 120 && Math.abs((z0 + z1) / 2 - (CZ.z0 + CZ.z1) / 2) < 120;
      if (roll < 0.14) { parks.push({ x0, x1, z0, z1, kind: 'park' }); continue; }
      if (roll < 0.22) { parks.push({ x0, x1, z0, z1, kind: 'lot' }); continue; }
      // split block into lots
      const nx = R() < 0.25 ? 1 : 2, nz = R() < 0.25 ? 1 : R() < 0.5 ? 2 : 3;
      const lw = (x1 - x0) / nx, ld = (z1 - z0) / nz;
      for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
        const w = lw - 3 - R() * 4, d = ld - 3 - R() * 4;
        const cx = x0 + lw * (ix + 0.5), cz = z0 + ld * (iz + 0.5);
        let h = central ? 30 + R() * 70 : 9 + R() * 28;
        if (R() < 0.1) h *= 1.6;
        buildings.push({ x: cx, z: cz, y: CZ.h, w, d, h: Math.round(h / 3.2) * 3.2, style: Math.floor(R() * 5), yaw: 0 });
      }
    }
  }
  // street lamps along city streets
  for (const x of streetXs) for (let z = streetZs[0] + 25; z < streetZs[streetZs.length - 1]; z += 30) {
    if (streetZs.some((zz) => Math.abs(zz - z) < 12)) continue;
    lamps.push({ x: x + 7.5, z, y: CZ.h, side: 1 });
  }
  for (const z of streetZs) for (let x = streetXs[0] + 25; x < streetXs[streetXs.length - 1]; x += 30) {
    if (streetXs.some((xx) => Math.abs(xx - x) < 12)) continue;
    lamps.push({ x, z: z - 7.5, y: CZ.h, side: 0 });
  }

  // ---------- structures (static) & props (dynamic) ----------
  const structures = [];
  const props = [];
  const S = (o) => structures.push(o);
  // proving ground layout (all at h=11)
  const PH = ZONES.proving.h;
  // crash walls (launch lanes run north = -z)
  S({ kind: 'concrete', x: -500, z: -296, y: PH + 2, hx: 8, hy: 2, hz: 1.5, label: 'Стена' });
  S({ kind: 'concrete', x: -440, z: -296, y: PH + 0.75, hx: 0.6, hy: 0.75, hz: 1.5 });
  S({ kind: 'pole', x: -470, z: -270, y0: PH - 1, y1: PH + 7, r: 0.16 });
  S({ kind: 'concrete', x: -406, z: -290, y: PH + 0.9, hx: 1.2, hy: 0.9, hz: 1.2 });
  // ramps
  const ramp = (x, z, yaw, len, height, width, mat = 'wood') => {
    const ang = Math.atan2(height, len);
    const L = Math.hypot(len, height);
    const th = 0.6;
    // centre so that low edge sits at ground and top edge at `height`
    const cx = x + Math.sin(yaw) * (len / 2), cz = z + Math.cos(yaw) * (len / 2);
    const cy = PH + height / 2 - (th / 2) * Math.cos(ang);
    S({ kind: mat, ramp: true, x: cx, z: cz, y: cy, hx: width / 2, hy: th / 2, hz: L / 2, yaw, pitch: -ang });
    // support block under the high end
    const ex = x + Math.sin(yaw) * (len - 0.4), ez = z + Math.cos(yaw) * (len - 0.4);
    if (height > 0.8) S({ kind: mat, x: ex, z: ez, y: PH + height / 2 - 0.3, hx: width / 2, hy: height / 2 - 0.3, hz: 0.4, yaw });
  };
  ramp(-330, -80, Math.PI, 14, 1.6, 6);
  ramp(-300, -80, Math.PI, 16, 3.2, 6);
  ramp(-270, -80, Math.PI, 18, 5.2, 7, 'metal');
  ramp(-240, -110, Math.PI, 8, 2.2, 5);
  // landing ramp for the big jump
  S({ kind: 'metal', ramp: true, x: -270, z: -150, y: PH + 1.5, hx: 3.5, hy: 0.3, hz: 12, yaw: Math.PI, pitch: 0.24 });
  // side-tilt rollover ramp
  S({ kind: 'wood', ramp: true, x: -230, z: -190, y: PH + 0.5, hx: 1.6, hy: 0.25, hz: 6, yaw: Math.PI, roll: 0.42 });
  // vertical loop
  {
    const cx = -360, cz = -260, R0 = 11, w = 7;
    const n = 40;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2;
      const a1 = ((k + 1) / n) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const segLen = 2 * R0 * Math.sin(Math.PI / n) + 0.25;
      const shift = (am / (Math.PI * 2)) * (w + 1.5) - (w + 1.5) / 2;
      // loop in z-y plane, car enters heading -z at bottom
      const y = PH + R0 - Math.cos(am) * (R0 + 0.3);
      const z = cz - Math.sin(am) * (R0 + 0.3);
      S({ kind: 'metal', loop: true, x: cx + shift, z, y, hx: w / 2, hy: 0.3, hz: segLen / 2, yaw: 0, pitch: am });
    }
  }
  // jersey barriers lining the proving ground
  for (let x = -560; x <= -200; x += 6.2) {
    S({ kind: 'barrier', x, z: -54, y: PH + 0.45, hx: 3, hy: 0.45, hz: 0.3 });
  }
  // dynamic props: cones, barrels, crates
  for (let i = 0; i < 6; i++) for (let k = 0; k < 2; k++) props.push({ type: 'cone', x: -385 + k * 6, z: -100 - i * 12, yaw: 0 });
  for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) props.push({ type: 'barrel', x: -250 + k * 1.2, z: -245 + i * 1.2, yaw: 0 });
  for (let lvl = 0; lvl < 3; lvl++) for (let k = 0; k < 4 - lvl; k++) props.push({ type: 'crate', x: -290 + k * 1.3 + lvl * 0.65, z: -228, yOff: lvl * 1.22, yaw: 0 });
  for (let i = 0; i < 6; i++) props.push({ type: 'pin', x: -320 + (i % 3) * 1.2 - (i > 2 ? 0.6 : 0), z: -296 + (i > 2 ? 1.2 : 0), yaw: 0 });
  props.push({ type: 'pin', x: -320, z: -293.6, yaw: 0 });
  // track: tyre walls at outside of corners + pit building
  const tp = track.pts;
  const tn = tp.length;
  for (let i = 0; i < tn; i += 4) {
    const a = tp[(i - 4 + tn) % tn], b = tp[i], c = tp[(i + 4) % tn];
    const h1 = Math.atan2(b[0] - a[0], b[1] - a[1]), h2 = Math.atan2(c[0] - b[0], c[1] - b[1]);
    let dh = h2 - h1;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const yaw = h1 + dh / 2;
    const side = dh > 0 ? -1 : 1; // outside of the corner
    const curve = Math.abs(dh);
    const off = 7 + (curve > 0.12 ? 9 : 5);
    const nx = Math.cos(yaw) * side, nz = -Math.sin(yaw) * side;
    const px = b[0] + nx * off * 1, pz = b[1] + nz * off;
    if (curve > 0.1) S({ kind: 'tirewall', x: px, z: pz, y: ZONES.track.h + 0.5, hx: 0.5, hy: 0.5, hz: 6.5, yaw });
    else if (i % 8 === 0) S({ kind: 'armco', x: b[0] - nx * 9.5, z: b[1] - nz * 9.5, y: ZONES.track.h + 0.4, hx: 0.12, hy: 0.4, hz: 6.2, yaw });
  }
  // grandstand near the start
  const st0 = tp[2], st1 = tp[3];
  const tyaw = Math.atan2(st1[0] - st0[0], st1[1] - st0[1]);
  S({ kind: 'building', x: st0[0] + Math.cos(tyaw) * 26, z: st0[1] - Math.sin(tyaw) * 26, y: ZONES.track.h + 4, hx: 6, hy: 4, hz: 30, yaw: tyaw, style: 9 });
  // off-road jumps & logs
  const ORH = (x, z) => T.heightAt(x, z);
  const dirtRamp = (x, z, yaw, len, height, width) => {
    const ang = Math.atan2(height, len);
    const L = Math.hypot(len, height);
    const cx = x + Math.sin(yaw) * (len / 2), cz = z + Math.cos(yaw) * (len / 2);
    const g = ORH(cx, cz);
    S({ kind: 'dirt', ramp: true, x: cx, z: cz, y: g + height / 2 - 0.4, hx: width / 2, hy: 0.4, hz: L / 2, yaw, pitch: -ang });
  };
  dirtRamp(470, -380, Math.PI / 2, 10, 2.0, 7);
  dirtRamp(395, -300, 0, 9, 1.8, 6);
  dirtRamp(520, -215, -Math.PI / 2, 12, 2.6, 7);
  for (let i = 0; i < 5; i++) S({ kind: 'log', x: 560 + i * 4, z: -300, y: ORH(560 + i * 4, -300) + 0.2, hx: 0.25, hy: 0.25, hz: 3, yaw: 0.2 * i });

  // ---------- trees ----------
  const trees = [];
  const isBlocked = (x, z) => {
    for (const zn of Object.values(ZONES)) if (rectMask(zn, x, z, 0) > 0) return true;
    if (Math.hypot(x - lake.x, z - lake.z) < lake.r + 18) return true;
    return false;
  };
  const nTry = 40000;
  for (let t = 0; t < nTry; t++) {
    const x = (R() * 2 - 1) * 990, z = (R() * 2 - 1) * 990;
    const dens = fbm(n2, x / 260 + 7, z / 260 - 3, 3) + (x < -650 ? 0.35 : 0) + smoothstep(-450, -620, z) * 0.2 + (z > 820 ? 0.3 : 0);
    if (dens < 0.06 || R() > 0.4 + dens) continue;
    if (isBlocked(x, z)) continue;
    const i = Math.round((x + half) / step), j = Math.round((z + half) / step);
    const k = j * RES + i;
    if (minD[k] < roadHW[k] + 9) continue;
    const s = T.surf[k];
    if (s === SURF.SNOW || s === SURF.ROCK || s === SURF.SAND) continue;
    const h = T.heightAt(x, z);
    if (h > 190) continue;
    trees.push({ x, z, y: h, s: 0.75 + R() * 0.6, type: h > 60 || R() < 0.45 ? 0 : 1, rot: R() * 6.28 });
  }
  // park trees in city
  for (const p of parks) if (p.kind === 'park') {
    for (let k = 0; k < 10; k++) trees.push({ x: lerp(p.x0 + 5, p.x1 - 5, R()), z: lerp(p.z0 + 5, p.z1 - 5, R()), y: CZ.h, s: 0.7 + R() * 0.4, type: 1, rot: R() * 6.28 });
  }

  // ---------- spawn points ----------
  const roadSpawn = (r, idx) => {
    const p = r.pts[idx], q = r.pts[(idx + 1) % r.pts.length];
    const yaw = Math.atan2(q[0] - p[0], q[1] - p[1]);
    // drive on the right-hand lane
    const off = r.width * 0.22;
    return { x: p[0] - Math.cos(yaw) * off, z: p[1] + Math.sin(yaw) * off, yaw };
  };
  const spawns = {
    city: { name: 'Новоград, центр', ...roadSpawn(roads.find((r) => r.kind === 'street'), 40) },
    highway: { name: 'Кольцевая трасса', ...roadSpawn(ring, 30) },
    track: { name: 'Кольцо Ветров, старт', ...roadSpawn(track, 0) },
    proving: { name: 'Полигон для краш-тестов', x: -380, z: -80, yaw: Math.PI },
    offroad: { name: 'Карьер (бездорожье)', ...roadSpawn(roads.find((r) => r.kind === 'trail'), 2) },
    mountain: { name: 'Перевал Орлиный', ...roadSpawn(pass, 5) },
    airfield: { name: 'Аэродром, ВПП', x: -600, z: 758, yaw: Math.PI / 2 },
  };
  spawns.track.x = track.pts[0][0];
  spawns.track.z = track.pts[0][1];

  // ---------- time trials ----------
  const gatesFrom = (r, every, startIdx = 0, count = null) => {
    const out = [];
    const n = r.pts.length;
    const total = count ?? Math.floor(n / every);
    for (let g = 1; g <= total; g++) {
      const i = (startIdx + g * every) % n;
      const p = r.pts[i], q = r.pts[(i + 1) % n];
      out.push({ x: p[0], z: p[1], yaw: Math.atan2(q[0] - p[0], q[1] - p[1]), w: r.width + 4 });
    }
    return out;
  };
  const trials = [
    { id: 'lap', name: 'Круг по «Кольцу Ветров»', start: spawns.track, gates: gatesFrom(track, 25, 0, Math.floor(track.pts.length / 25)).concat([{ x: track.pts[0][0], z: track.pts[0][1], yaw: spawns.track.yaw, w: 18 }]) },
    { id: 'hill', name: 'Горный подъём «Орлиный»', start: { ...roadSpawn(pass, 8) }, gates: gatesFrom(pass, 30, 8, Math.floor((pass.pts.length - 12) / 30)) },
    { id: 'quarry', name: 'Спринт по карьеру', start: { ...roadSpawn(roads.find((r) => r.kind === 'trail'), 1) }, gates: gatesFrom(roads.find((r) => r.kind === 'trail'), 14, 1, Math.floor((roads.find((r) => r.kind === 'trail').pts.length - 3) / 14)) },
    { id: 'runway', name: 'Дрэг 800 м (аэродром)', start: { x: -600, z: 758, yaw: Math.PI / 2 }, gates: [{ x: 200, z: 758, yaw: Math.PI / 2, w: 40 }] },
  ];

  return { T, roads, ring, track, pass, runway, buildings, parks, lamps, structures, props, trees, spawns, trials, lake, zones: ZONES, streetXs, streetZs, cityH: CZ.h, minD, roadHW };
}

// register static colliders of the map into a StaticWorld
export function registerStatics(map, statics, onTree) {
  const ids = { trees: [], lamps: [] };
  for (const b of map.buildings) {
    statics.addBox({ x: b.x, y: b.y + b.h / 2, z: b.z, hx: b.w / 2, hy: b.h / 2, hz: b.d / 2, yaw: b.yaw, surface: SURF.CONCRETE, friction: 0.6 });
  }
  for (const s of map.structures) {
    if (s.kind === 'pole') statics.addCylinder({ x: s.x, z: s.z, y0: s.y0, y1: s.y1, r: s.r, surface: SURF.METAL });
    else {
      const surf = s.kind === 'wood' ? SURF.WOOD : s.kind === 'metal' ? SURF.METAL : s.kind === 'dirt' ? SURF.DIRT : s.kind === 'log' ? SURF.WOOD : SURF.CONCRETE;
      const fr = s.kind === 'tirewall' ? 0.9 : 0.6;
      statics.addBox({ x: s.x, y: s.y, z: s.z, hx: s.hx, hy: s.hy, hz: s.hz, yaw: s.yaw || 0, pitch: s.pitch || 0, roll: s.roll || 0, surface: surf, friction: fr, userData: s });
    }
  }
  map.trees.forEach((t, i) => {
    const id = statics.addCylinder({ x: t.x, z: t.z, y0: t.y - 1, y1: t.y + 6 * t.s, r: 0.22 * t.s, surface: SURF.WOOD, breakable: 260 * t.s, userData: { tree: i } });
    ids.trees.push(id);
  });
  map.lamps.forEach((l, i) => {
    const id = statics.addCylinder({ x: l.x, z: l.z, y0: l.y - 0.5, y1: l.y + 7, r: 0.1, surface: SURF.METAL, breakable: 70, userData: { lamp: i } });
    ids.lamps.push(id);
  });
  // invisible boundary walls
  const B = 1010;
  statics.addBox({ x: 0, y: 100, z: -B - 5, hx: B + 20, hy: 300, hz: 5 });
  statics.addBox({ x: 0, y: 100, z: B + 5, hx: B + 20, hy: 300, hz: 5 });
  statics.addBox({ x: -B - 5, y: 100, z: 0, hx: 5, hy: 300, hz: B + 20 });
  statics.addBox({ x: B + 5, y: 100, z: 0, hx: 5, hy: 300, hz: B + 20 });
  return ids;
}
