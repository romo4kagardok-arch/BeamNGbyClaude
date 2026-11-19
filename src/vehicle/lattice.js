// Builds the node-beam lattice (physics skeleton) of a vehicle from its BodyShape.
import { SoftBodyBuilder } from '../physics/softbody.js';

export const ZONE = { FRONT: 1, REAR: 2, LEFT: 4, RIGHT: 8, ROOF: 16, ENGINE: 32, MID: 64 };
export const LEVEL = { BOTTOM: 0, BELT: 1, ROOF: 2, MIDSIDE: 3, CARGO: 4, CENTERTOP: 5 };

export function buildLattice(def, shape) {
  const B = new SoftBodyBuilder();
  const heavy = def.mass > 4000;
  const r = heavy ? 0.2 : 0.14;
  const spacing = heavy ? 0.62 : shape.length < 4.2 ? 0.42 : 0.46;
  const z0 = shape.zRear + r * 0.7, z1 = shape.zFront - r * 0.7;
  const count = Math.max(6, Math.round((z1 - z0) / spacing) + 1);
  const mf = def.mass / 1350;
  const stations = [];
  const roles = []; // per node: {level, station, side}
  const zFire = (() => {
    // firewall: where the cabin starts (front of greenhouse) or front axle region
    if (shape.roofRange) return Math.min(shape.roofRange[1] - 0.15, shape.zFA + 0.2);
    return shape.zFA;
  })();
  const zRearWall = shape.roofRange ? Math.max(shape.roofRange[0] + 0.35, shape.zRA - 0.25) : shape.zRA;

  const engineZ = def.engineZ === 'rear' ? shape.zRear + 1.2 : def.engineZ === 'mid' ? shape.zRA + 0.6 : shape.zFA + 0.15;

  for (let s = 0; s < count; s++) {
    const z = z0 + ((z1 - z0) * s) / (count - 1);
    const hw = Math.max(0.3, shape.halfWidth(z) - r * 0.85);
    let yb = shape.bottom(z) + r * 0.85;
    let yt = shape.top(z) - r * 0.85;
    const inBed = shape.bed && z > shape.bed.z0 - 0.05 && z < shape.bed.z1;
    if (inBed) yt = shape.bed.top - r * 0.85;
    if (yt < yb + 0.18) yt = yb + 0.18;
    const st = { z, nodes: {} };
    let zone = 0;
    if (z > zFire) zone |= ZONE.FRONT;
    else if (z < zRearWall) zone |= ZONE.REAR;
    else zone |= ZONE.MID;
    const add = (name, x, y, level, w, extraZone = 0) => {
      let zz = zone | extraZone;
      if (x > 0.2) zz |= ZONE.LEFT;
      if (x < -0.2) zz |= ZONE.RIGHT;
      const idx = B.addNode(x, y, z, w, r, { friction: 0.55, tag: zz });
      roles[idx] = { level, station: s, side: x > 0.2 ? 1 : x < -0.2 ? -1 : 0, name };
      st.nodes[name] = idx;
      return idx;
    };
    add('BL', hw, yb, LEVEL.BOTTOM, 1.35);
    add('BC', 0, yb, LEVEL.BOTTOM, 1.2);
    add('BR', -hw, yb, LEVEL.BOTTOM, 1.35);
    add('TL', hw * 0.97, yt, LEVEL.BELT, 1.0);
    add('TR', -hw * 0.97, yt, LEVEL.BELT, 1.0);
    const roofY = shape.roofAt(z);
    const cargo = shape.cargo && z >= shape.cargo.z0 - 0.05 && z <= shape.cargo.z1 + 0.05 ? shape.cargo : null;
    let topY = null, topHw = 0;
    if (cargo) {
      topY = cargo.top - r * 0.85;
      topHw = hw;
    } else if (roofY !== null && roofY - shape.top(z) > 0.28) {
      topY = roofY - r * 0.85;
      topHw = Math.max(0.25, shape.halfWidth(z) * shape.roofWidth - r * 0.7);
    }
    if (!inBed) add('TC', 0, inBed ? shape.bed.floor : yt + shape.crown * 0.5, LEVEL.CENTERTOP, 0.75);
    else add('TC', 0, shape.bed.floor - r * 0.5, LEVEL.CENTERTOP, 0.75);
    if (topY !== null) {
      if (topY - yt > 1.0) {
        const ym = (topY + yt) / 2;
        const hm = (hw + topHw) / 2;
        add('ML', hm, ym, LEVEL.MIDSIDE, 0.5);
        add('MR', -hm, ym, LEVEL.MIDSIDE, 0.5);
      }
      add('RL', topHw, topY, LEVEL.ROOF, cargo ? 0.6 : 0.45, ZONE.ROOF);
      add('RR', -topHw, topY, LEVEL.ROOF, cargo ? 0.6 : 0.45, ZONE.ROOF);
      if (topHw > 0.8 || cargo) add('RC', 0, topY + 0.02, LEVEL.ROOF, 0.4, ZONE.ROOF);
    }
    stations.push(st);
  }

  // engine mass
  const eng = def._engineMass || 180;
  let engNodes = [];
  for (let i = 0; i < B.nodes.length; i++) {
    const n = B.nodes[i];
    if (Math.abs(n.z - engineZ) < spacing * 1.3 && roles[i].level !== LEVEL.ROOF && roles[i].level !== LEVEL.MIDSIDE) engNodes.push(i);
  }
  for (const i of engNodes) {
    B.nodes[i].mass += (eng / engNodes.length) / (def.mass / B.nodes.length);
    B.nodes[i].tag |= ZONE.ENGINE;
  }
  // normalise masses to vehicle mass
  let wsum = 0;
  for (const n of B.nodes) wsum += n.mass;
  for (const n of B.nodes) n.mass = (n.mass / wsum) * def.mass;

  // beams: connect nodes within same and adjacent stations
  const kBase = 3.2e6 * mf;
  const damp = 2600 * mf;
  const beamParams = (a, b) => {
    const ra = roles[a], rb = roles[b];
    const na = B.nodes[a], nb = B.nodes[b];
    const zm = (na.z + nb.z) / 2;
    const front = zm > zFire, rear = zm < zRearWall;
    const crumple = front || rear;
    const bothBottom = ra.level === LEVEL.BOTTOM && rb.level === LEVEL.BOTTOM;
    const roof = ra.level === LEVEL.ROOF || rb.level === LEVEL.ROOF || ra.level === LEVEL.MIDSIDE || rb.level === LEVEL.MIDSIDE;
    let yieldStrain, breakStretch = 0.55, kb = kBase;
    const lateral = Math.abs(na.z - nb.z) < 0.05 && Math.abs(na.x - nb.x) > 0.3;
    if (bothBottom) yieldStrain = crumple ? 0.0062 : 0.024;
    else if (roof) yieldStrain = 0.0068;
    else if (crumple) yieldStrain = 0.0029;
    else yieldStrain = lateral ? 0.0042 : 0.0085;
    if (crumple && !bothBottom) breakStretch = 0.4;
    // the very ends (bumpers) are softer
    const endDist = Math.min(shape.zFront - zm, zm - shape.zRear);
    if (endDist < 0.35) {
      yieldStrain *= 0.7;
      kb *= 0.8;
    }
    if (def.reinforced && front) yieldStrain *= 1.6;
    return { kBase: kb, damping: damp, yieldStrain, breakStretch, minRatio: 0.2 };
  };
  const N = B.nodes.length;
  const stationOf = (i) => roles[i].station;
  for (let a = 0; a < N; a++) {
    for (let b = a + 1; b < N; b++) {
      const ds = Math.abs(stationOf(a) - stationOf(b));
      if (ds > 1) {
        // long rails along bottom & belt to resist bending
        if (ds === 2 && roles[a].level === roles[b].level && roles[a].side === roles[b].side && (roles[a].level === LEVEL.BOTTOM || roles[a].level === LEVEL.BELT || roles[a].level === LEVEL.ROOF)) {
          const p = beamParams(a, b);
          p.kBase *= 0.6;
          B.addBeam(a, b, p);
        }
        continue;
      }
      B.addBeam(a, b, beamParams(a, b));
    }
  }

  const body = B.build();
  return { body, stations, roles, radius: r, spacing, zFire, zRearWall, engineZ };
}
