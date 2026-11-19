// Vehicle simulation: soft-body chassis + raycast suspension + slip-based tyre model + engine/gearbox.
import { VEHICLES, ENGINES, TIRES, SUSPENSIONS, torqueAt, defaultConfig } from './defs.js';
import { BodyShape } from './shape.js';
import { buildLattice, ZONE, LEVEL } from './lattice.js';
import { StaticWorld, SURF_PROPS } from '../physics/statics.js';
import { clamp, lerp, quatFromYaw } from '../core/math.js';

const TWO_PI = Math.PI * 2;
const RPM2W = TWO_PI / 60;
const tmp4 = new Float64Array(4);
const hitInfo = { nx: 0, ny: 1, nz: 0, collider: null };

function magic(x, B, C) {
  return Math.sin(C * Math.atan(B * x));
}

export class Vehicle {
  constructor(id, cfg = null) {
    this.id = id;
    this.def = VEHICLES[id];
    this.cfg = Object.assign(defaultConfig(id), cfg || {});
    const def = this.def;
    this.engine = ENGINES[this.cfg.engine] || ENGINES[def.engine];
    this.tire = TIRES[this.cfg.tires] || TIRES.street;
    this.susp = SUSPENSIONS[this.cfg.suspension] || SUSPENSIONS.standard;
    this.shape = new BodyShape(def.shape);
    const lat = buildLattice({ ...def, _engineMass: this.engine.mass }, this.shape);
    this.lattice = lat;
    this.body = lat.body;
    this.body.owner = this;
    this.body.dragCoef = (0.6 * (def.cd || 0.35) * (def.area || 2.2)) / def.mass / 1;
    this.mass = def.mass;
    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, shiftUp: false, shiftDown: false };
    this.electric = !!this.engine.electric;
    this.gears = this.electric ? [1] : def.gears;
    this.final = this.electric ? 8.5 : def.final;
    this.reverseRatio = this.electric ? 1 : def.reverse;
    this.gear = 1;
    this.auto = this.cfg.transmission !== 'manual';
    this.rpm = this.engine.idle || 0;
    this.engineW = this.rpm * RPM2W;
    this.shiftTimer = 0;
    this.reverseHold = 0;
    this.clutchLocked = false;
    this.boost = 0;
    this.engineLoad = 0;
    this.engineAlive = true;
    this.engineDamage = 0;
    this.engineRunning = true;
    this.steerAngle = 0;
    this.speed = 0;
    this.fwdSpeed = 0;
    this.events = [];
    this.damage = { total: 0, front: 0, rear: 0, left: 0, right: 0, roof: 0, engine: 0 };
    this.lightsOn = false;
    this.hornOn = false;
    this.absActive = false;
    this.tcsActive = false;
    this.maxG = 0;
    this.accel = [0, 0, 0];
    this._prevVel = [0, 0, 0];
    this.sirenOn = false;
    this.ai = null;
    this.driverless = false;
    this.buildWheels();
  }

  buildWheels() {
    const s = this.shape, def = this.def, body = this.body, lat = this.lattice;
    const scale = this.cfg.wheelScale || 1;
    const r = s.wheelRadius * scale;
    const susp = this.susp;
    const heavy = def.mass > 4000;
    const travel = (heavy ? 0.24 : 0.27) * (susp.travel || 1);
    const sStatic = (heavy ? 0.14 : 0.17) + (susp.lift || 0);
    const sMax = sStatic + travel * 0.5 + (susp.lift || 0) * 0.5;
    // static load split from COM
    const com = body.restCom;
    const zF = s.zFA, zR = s.zRA;
    const fracFront = clamp((com[2] - zR) / (zF - zR), 0.2, 0.8);
    this.wheels = [];
    const axles = [
      { z: zF, front: true, frac: fracFront },
      { z: zR, front: false, frac: 1 - fracFront },
    ];
    const drive = this.cfg.drive || def.drive;
    for (const ax of axles) {
      for (const side of [1, -1]) {
        const x = (side * s.track) / 2;
        const load = (def.mass * 9.81 * ax.frac) / 2;
        const xStatic = sMax - sStatic;
        const k = (load / Math.max(0.04, xStatic)) * susp.stiff;
        const cornerMass = load / 9.81;
        const crit = 2 * Math.sqrt(k * cornerMass);
        const wheelMass = heavy ? 60 : 16 + r * 10;
        const w = {
          index: this.wheels.length,
          front: ax.front,
          side,
          rest: [x, s.wheelRadius, ax.z],
          mount: [x, s.wheelRadius + sStatic, ax.z],
          radius: r,
          width: s.tireWidth,
          sMax,
          sStatic,
          travel,
          k,
          cBump: crit * 0.28 * susp.damp,
          cReb: crit * 0.42 * susp.damp,
          kBump: k * 5,
          arbK: k * 0.45 * susp.arb * (ax.front ? 1.0 : 0.7),
          staticLoad: load,
          cornerMass,
          inertia: 0.65 * wheelMass * r * r,
          steer: ax.front,
          driven: drive === 'AWD' || (drive === 'FWD' && ax.front) || (drive === 'RWD' && !ax.front),
          brakeMax: ax.front ? def.brake[0] : def.brake[1],
          handbrake: !ax.front,
          omega: 0,
          spin: 0,
          comp: 0,
          compPrev: 0,
          contact: false,
          s: sMax,
          load: 0,
          slip: 0,
          slipLat: 0,
          slipLong: 0,
          surface: 0,
          detached: false,
          toe: 0,
          camber: 0,
          center: [0, 0, 0],
          contactPoint: [0, 0, 0],
          normal: [0, 1, 0],
          driveTorque: 0,
          fx: 0,
          fy: 0,
          absTimer: 0,
          steerAngle: 0,
          mountW: [],
          contactW: [],
          offset: [0, 0, 0],
          dirt: 0,
        };
        this.computeWheelWeights(w);
        this.wheels.push(w);
      }
    }
    this.drivenCount = this.wheels.filter((w) => w.driven).length;
  }

  computeWheelWeights(w) {
    const body = this.body, lat = this.lattice;
    // find the two stations bracketing the axle
    const st = lat.stations;
    let i0 = 0;
    for (let i = 0; i < st.length - 1; i++) if (st[i].z <= w.rest[2] && st[i + 1].z >= w.rest[2]) i0 = i;
    const sA = st[i0], sB = st[Math.min(i0 + 1, st.length - 1)];
    const fz = clamp((w.rest[2] - sA.z) / Math.max(1e-3, sB.z - sA.z), 0, 1);
    const sideL = w.side > 0;
    const low = [sideL ? sA.nodes.BL : sA.nodes.BR, sideL ? sB.nodes.BL : sB.nodes.BR];
    const up = [sideL ? sA.nodes.TL : sA.nodes.TR, sideL ? sB.nodes.TL : sB.nodes.TR];
    const rest = body.rest;
    const yL = lerp(rest[low[0] * 3 + 1], rest[low[1] * 3 + 1], fz);
    const yU = lerp(rest[up[0] * 3 + 1], rest[up[1] * 3 + 1], fz);
    const ym = w.mount[1];
    const aM = clamp((yU - ym) / (yU - yL), -0.5, 1.5);
    const rollFactor = 0.55;
    const yc = lerp(ym, 0, rollFactor);
    const aC = (yU - yc) / (yU - yL);
    w.mountW = [
      [low[0], aM * (1 - fz)], [low[1], aM * fz],
      [up[0], (1 - aM) * (1 - fz)], [up[1], (1 - aM) * fz],
    ];
    w.contactW = [
      [low[0], aC * (1 - fz)], [low[1], aC * fz],
      [up[0], (1 - aC) * (1 - fz)], [up[1], (1 - aC) * fz],
    ];
    // offset between weighted node centroid and mount point (design space)
    let cx = 0, cy = 0, cz = 0;
    for (const [n, wt] of w.mountW) {
      cx += rest[n * 3] * wt; cy += rest[n * 3 + 1] * wt; cz += rest[n * 3 + 2] * wt;
    }
    w.offset = [w.mount[0] - cx, w.mount[1] - cy, w.mount[2] - cz];
    w.mountNodes = [low[0], low[1], up[0], up[1]];
  }

  // ---------------- placement / repair ----------------
  place(x, y, z, yaw, terrain = null) {
    const q = quatFromYaw(yaw);
    const rc = this.body.restCom;
    let gy = y;
    if (terrain && y === null) gy = terrain.heightAt(x, z);
    this.body.placeAt([x, gy + rc[1] + 0.06, z], q);
    this.body.computeFrame();
    for (const w of this.wheels) {
      w.omega = 0;
      w.comp = w.compPrev = w.sMax - w.sStatic;
    }
    this.gear = 1;
    this.shiftTimer = 0;
  }

  repair() {
    const b = this.body;
    b.computeFrame();
    const R = b.R;
    const yaw = Math.atan2(R[2], R[8]);
    const c = b.com;
    b.repair([c[0], c[1] + 0.6, c[2]], quatFromYaw(yaw));
    for (const w of this.wheels) {
      w.detached = false;
      w.omega = 0;
      w.toe = 0;
      w.camber = 0;
    }
    this.engineAlive = true;
    this.engineDamage = 0;
    this.engineRunning = true;
    this.gear = 1;
    this.flood = 0;
    this.body.buoyancy = 1.25;
    this.damage = { total: 0, front: 0, rear: 0, left: 0, right: 0, roof: 0, engine: 0 };
    this.events.push({ type: 'repair' });
  }

  resetTo(x, y, z, yaw) {
    const b = this.body;
    b.bRest.set(b.bRest0);
    b.bBroken.fill(0);
    b.brokenCount = 0;
    b.plasticEnergy = 0;
    for (const w of this.wheels) {
      w.detached = false;
      w.toe = 0;
      w.camber = 0;
    }
    this.engineAlive = true;
    this.engineDamage = 0;
    this.engineRunning = true;
    this.flood = 0;
    this.body.buoyancy = 1.25;
    this.damage = { total: 0, front: 0, rear: 0, left: 0, right: 0, roof: 0, engine: 0 };
    this.place(x, y, z, yaw);
    this.events.push({ type: 'repair' });
  }

  get forward() {
    const R = this.body.R;
    return [R[2], R[5], R[8]];
  }
  get up() {
    const R = this.body.R;
    return [R[1], R[4], R[7]];
  }
  get position() {
    return this.body.com;
  }
  get yaw() {
    const R = this.body.R;
    return Math.atan2(R[2], R[8]);
  }

  // ---------------- per-frame control logic ----------------
  prepareFrame(dt) {
    const inp = this.input, c = this.controls;
    const b = this.body;
    const R = b.R, v = b.comVel;
    this.fwdSpeed = v[0] * R[2] + v[1] * R[5] + v[2] * R[8];
    this.speed = Math.hypot(v[0], v[1], v[2]);
    // throttle/brake mapping incl. automatic reverse
    let thr = inp.throttle, brk = inp.brake;
    if (this.auto) {
      if (this.gear >= 0) {
        if (inp.brake > 0.1 && inp.throttle < 0.1 && this.fwdSpeed < 0.6 && !this.frozen) {
          this.reverseHold += dt;
          if (this.reverseHold > 0.2) {
            this.gear = -1;
            this.reverseHold = 0;
          }
        } else this.reverseHold = 0;
      } else {
        thr = inp.brake;
        brk = inp.throttle;
        if (inp.throttle > 0.1 && inp.brake < 0.1 && this.fwdSpeed > -0.6) {
          this.reverseHold += dt;
          if (this.reverseHold > 0.12) {
            this.gear = 1;
            this.reverseHold = 0;
          }
        } else this.reverseHold = 0;
      }
      if (this.gear === 0) this.gear = 1;
    } else {
      if (inp.shiftUp) this.shift(this.gear + 1);
      if (inp.shiftDown) this.shift(this.gear - 1);
    }
    inp.shiftUp = inp.shiftDown = false;
    // smooth pedals
    const pedalRate = 6;
    c.throttle += clamp(thr - c.throttle, -pedalRate * dt * 1.5, pedalRate * dt);
    c.brake += clamp(brk - c.brake, -pedalRate * dt * 2, pedalRate * dt * 1.5);
    c.handbrake = inp.handbrake;
    if (this.driverless) {
      c.throttle = 0;
      c.brake = 0.3;
      c.handbrake = 1;
    }
    // steering with speed sensitivity
    const target = clamp(inp.steer, -1, 1);
    const rate = Math.abs(target) < Math.abs(c.steer) || target * c.steer < 0 ? 4.5 : 2.6;
    c.steer += clamp(target - c.steer, -rate * dt, rate * dt);
    if (inp.steerDirect !== undefined && inp.steerDirect !== null) c.steer = clamp(inp.steerDirect, -1, 1);
    const vs = Math.abs(this.fwdSpeed);
    const maxSteer = ((this.def.steer || 34) * Math.PI) / 180;
    const lim = maxSteer / (1 + (vs * vs) / (24 * 24));
    this.steerAngle = c.steer * Math.max(lim, maxSteer * 0.12);
    // automatic gearbox
    if (this.auto && this.gear > 0 && this.shiftTimer <= 0 && !this.electric) {
      const red = this.engine.redline;
      const up = red * (0.6 + 0.33 * c.throttle);
      const down = red * (0.28 + 0.2 * c.throttle);
      let spinning = false;
      for (const w of this.wheels) if (w.driven && w.contact && w.slipLong > 0.25) spinning = true;
      if (this.rpm > up && this.gear < this.gears.length && !spinning) this.shift(this.gear + 1);
      else if (this.rpm < down && this.gear > 1) this.shift(this.gear - 1);
    }
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    // turbo spool
    if (this.engine.turbo) {
      const target = this.engine.turbo === 'sc' ? clamp(this.rpm / this.engine.redline, 0, 1) * c.throttle : clamp((this.rpm - 1500) / 2500, 0, 1) * c.throttle;
      const prev = this.boost;
      this.boost += (target - this.boost) * (1 - Math.exp(-(target > this.boost ? 2.2 : 6) * dt));
      if (prev > 0.6 && c.throttle < 0.2 && this.engine.turbo !== 'sc' && !this._bov) {
        this.events.push({ type: 'blowoff', amount: prev });
        this._bov = true;
      }
      if (c.throttle > 0.5) this._bov = false;
    }
    // water: hydrolock and gradual flooding
    const imm = this.body.waterImmersion;
    if (imm > 0.02) {
      this.flood = Math.min(1, (this.flood || 0) + dt * (0.02 + imm * 0.08));
      this.body.buoyancy = 1.25 * (1 - this.flood * 0.75);
      if (imm > 0.45 && this.engineAlive && !this.electric) {
        this.engineAlive = false;
        this.events.push({ type: 'engineDead', reason: 'water' });
      }
    }
    // acceleration (for G meter)
    const ax = (v[0] - this._prevVel[0]) / Math.max(dt, 1e-3), ay = (v[1] - this._prevVel[1]) / Math.max(dt, 1e-3), az = (v[2] - this._prevVel[2]) / Math.max(dt, 1e-3);
    this._prevVel[0] = v[0]; this._prevVel[1] = v[1]; this._prevVel[2] = v[2];
    this.accel[0] = lerp(this.accel[0], ax, 0.3); this.accel[1] = lerp(this.accel[1], ay, 0.3); this.accel[2] = lerp(this.accel[2], az, 0.3);
    const g = Math.hypot(this.accel[0], this.accel[1], this.accel[2]) / 9.81;
    if (g > this.maxG) this.maxG = g;
  }

  shift(g) {
    const n = this.gears.length;
    g = clamp(g, -1, n);
    if (g === this.gear) return;
    this.gear = g;
    this.shiftTimer = this.auto ? 0.16 : 0.12;
    this.events.push({ type: 'shift', gear: g });
  }

  gearRatio() {
    if (this.gear === 0) return 0;
    if (this.gear < 0) return -this.reverseRatio * this.final;
    return this.gears[this.gear - 1] * this.final;
  }

  engineTorque(rpm, throttle) {
    const e = this.engine;
    let t = torqueAt(e, Math.max(rpm, e.idle || 0)) * throttle;
    if (e.turbo) t *= 0.62 + 0.38 * this.boost;
    t *= 1 - this.engineDamage * 0.75;
    const fr = e.electric ? 0.03 : 0.11;
    const peak = e.torque.reduce((m, p) => Math.max(m, p[1]), 0);
    const friction = peak * fr * (0.25 + (0.75 * rpm) / e.redline) * (1 - throttle);
    if (rpm > e.redline) t = Math.min(t, 0);
    return t - friction;
  }

  updatePowertrain(h) {
    const e = this.engine, c = this.controls;
    let n = 0, wsum = 0;
    for (const w of this.wheels) if (w.driven && !w.detached) { n++; wsum += w.omega; }
    const ratio = this.gearRatio();
    let throttle = this.engineAlive && this.engineRunning ? c.throttle : 0;
    if (this.shiftTimer > 0 && !this.electric) throttle = 0;
    // traction control
    if (this.cfg.tcs) {
      // traction + stability control: wheelspin and oversteer (rear sliding more than front) cut the throttle
      let maxSlip = 0, fl = 0, rl = 0, nf = 0, nr = 0;
      for (const w of this.wheels) {
        if (!w.contact) continue;
        if (w.driven) maxSlip = Math.max(maxSlip, w.slipLong);
        if (w.front) { fl += w.slipLat; nf++; } else { rl += w.slipLat; nr++; }
      }
      const over = nf && nr && this.speed > 4 ? rl / nr - fl / nf : 0;
      this.tcsActive = (maxSlip > 0.18 || over > 0.05) && throttle > 0.1;
      if (maxSlip > 0.18) throttle *= clamp(1 - (maxSlip - 0.18) * 4, 0.15, 1);
      if (over > 0.05) throttle *= clamp(1 - (over - 0.05) * 9, 0.05, 1);
    }
    const idleW = (e.idle || 0) * RPM2W;
    const redW = e.redline * RPM2W;
    let total = 0;
    this.clutchLocked = false;
    if (!this.engineAlive || !this.engineRunning) {
      this.engineW = Math.max(0, this.engineW - 300 * h);
      if (ratio !== 0 && n > 0 && this.engineW > 0) {
        // dead engine still drags
      }
    } else if (ratio === 0 || n === 0 || (this.shiftTimer > 0 && !this.electric)) {
      const tq = this.engineTorque(this.engineW / RPM2W, throttle);
      this.engineW += (tq / e.inertia) * h * 0.6;
      if (!this.electric && this.engineW < idleW) this.engineW += (idleW - this.engineW) * 0.02;
      if (this.engineW > redW * 1.02) this.engineW = redW * 1.02;
      if (this.engineW < 0) this.engineW = 0;
    } else {
      const wAvg = wsum / n;
      const wg = wAvg * ratio;
      if (this.electric || wg > idleW * 1.08) {
        this.engineW = Math.max(wg, 0);
        this.clutchLocked = true;
        const tq = this.engineTorque(this.engineW / RPM2W, throttle);
        total = tq * ratio * 0.9;
      } else {
        // clutch slipping (launch / crawling)
        const launch = Math.min(e.redline * 0.42, 3200) * RPM2W;
        const target = idleW + throttle * (launch - idleW);
        this.engineW += (target - this.engineW) * Math.min(1, 9 * h);
        const tq = this.engineTorque(this.engineW / RPM2W, Math.max(throttle, 0));
        if (throttle > 0.02) total = Math.max(0, tq) * ratio * 0.9;
        else if (this.auto && c.brake < 0.05) total = torqueAt(e, e.idle) * 0.12 * ratio; // creep
      }
    }
    this.rpm = this.engineW / RPM2W;
    this.engineLoad = throttle;
    const per = n > 0 ? total / n : 0;
    // simple torque-sensing split: open differential with slight bias towards slower wheel
    for (const w of this.wheels) w.driveTorque = w.driven && !w.detached ? per : 0;
    if (n > 1) {
      let wmin = Infinity;
      for (const w of this.wheels) if (w.driven && !w.detached) wmin = Math.min(wmin, Math.abs(w.omega));
      for (const w of this.wheels) {
        if (!w.driven || w.detached) continue;
        const excess = Math.abs(w.omega) - wmin;
        if (excess > 3) w.driveTorque *= clamp(1 - (excess - 3) * 0.04, 0.45, 1);
      }
    }
  }

  // ---------------- per-substep physics ----------------
  preSubstep(h, world) {
    const b = this.body;
    if (!b.enabled) return;
    b.computeFrame(1);
    const R = b.R;
    const upx = R[1], upy = R[4], upz = R[7];
    const fwx = R[2], fwy = R[5], fwz = R[8];
    const lfx = R[0], lfy = R[3], lfz = R[6];
    this.updatePowertrain(h);
    const pos = b.pos, vel = b.vel, force = b.force;
    const terrain = world.terrain;
    const cands = b.staticCandidates;
    const c = this.controls;
    const wb = this.shape.wheelbase, tr = this.shape.track;
    // ---- pass 1: geometry ----
    for (const w of this.wheels) {
      if (w.detached) { w.contact = false; continue; }
      // mount position & velocity
      let mx = 0, my = 0, mz = 0, vx = 0, vy = 0, vz = 0;
      for (let i = 0; i < 4; i++) {
        const [nd, wt] = w.mountW[i];
        const k = nd * 3;
        mx += pos[k] * wt; my += pos[k + 1] * wt; mz += pos[k + 2] * wt;
        vx += vel[k] * wt; vy += vel[k + 1] * wt; vz += vel[k + 2] * wt;
      }
      const o = w.offset;
      mx += R[0] * o[0] + R[1] * o[1] + R[2] * o[2];
      my += R[3] * o[0] + R[4] * o[1] + R[5] * o[2];
      mz += R[6] * o[0] + R[7] * o[1] + R[8] * o[2];
      w.mx = mx; w.my = my; w.mz = mz;
      w.vx = vx; w.vy = vy; w.vz = vz;
      // steering (Ackermann)
      let delta = 0;
      if (w.steer && Math.abs(this.steerAngle) > 1e-4) {
        const Rt = wb / Math.tan(Math.abs(this.steerAngle));
        const inner = (this.steerAngle > 0) === (w.side > 0);
        delta = Math.atan(wb / (Rt + (inner ? -tr / 2 : tr / 2))) * Math.sign(this.steerAngle);
      }
      delta += w.toe;
      w.steerAngle = delta;
      const sd = Math.sin(delta), cd = Math.cos(delta);
      const hx = lfx * sd + fwx * cd, hy = lfy * sd + fwy * cd, hz = lfz * sd + fwz * cd;
      w.hx = hx; w.hy = hy; w.hz = hz;
      // ground probe with 3 rays approximating the tyre circle
      const r = w.radius;
      const maxT = w.sMax + r;
      let bestS = w.sMax, hit = false, nx = 0, ny = 1, nz = 0, surf = 0, hitCol = null;
      for (let ri = 0; ri < 3; ri++) {
        const off = (ri - 1) * 0.62 * r;
        const ox = mx + hx * off, oy = my + hy * off, oz = mz + hz * off;
        // terrain: fixed-point iteration along the suspension axis
        let t = Infinity;
        if (terrain) {
          let tt = 0;
          let ok = false;
          const dy = -upy;
          if (dy < -0.25) {
            for (let it = 0; it < 4; it++) {
              const px = ox - upx * tt, pz = oz - upz * tt;
              const hgt = terrain.heightAt(px, pz);
              tt = (oy - hgt) / -dy;
            }
            ok = true;
          }
          if (ok && tt < maxT && tt > -r) {
            t = tt;
          }
        }
        let fromStatic = false;
        if (cands.length) {
          const ts = StaticWorld.raycastList(cands, ox + upx * 0.3, oy + upy * 0.3, oz + upz * 0.3, -upx, -upy, -upz, maxT + 0.3, hitInfo) - 0.3;
          if (ts < t) { t = ts; fromStatic = true; }
        }
        if (t < maxT) {
          const so = t - Math.sqrt(r * r - off * off);
          if (so < bestS) {
            bestS = so;
            hit = true;
            if (fromStatic) {
              nx = hitInfo.nx; ny = hitInfo.ny; nz = hitInfo.nz;
              surf = hitInfo.collider.surface;
              hitCol = hitInfo.collider;
            } else {
              const px = ox - upx * t, pz = oz - upz * t;
              terrain.sample(px, pz, tmp4);
              nx = tmp4[1]; ny = tmp4[2]; nz = tmp4[3];
              surf = terrain.surfaceAt(px, pz);
            }
          }
        }
      }
      w.bottomed = hit && bestS < 0.002;
      if (bestS < 0) bestS = 0;
      w.compPrev = w.comp;
      w.contact = hit && bestS < w.sMax;
      w.s = w.contact ? bestS : Math.min(w.sMax, w.s + 2.5 * h * 3);
      w.comp = w.sMax - w.s;
      w.nx = nx; w.ny = ny; w.nz = nz;
      w.surface = surf;
      w.hitCol = hit ? hitCol : null;
      w.center[0] = mx - upx * w.s; w.center[1] = my - upy * w.s; w.center[2] = mz - upz * w.s;
    }
    // ---- anti-roll bars ----
    for (let a = 0; a < this.wheels.length; a += 2) {
      const wl = this.wheels[a], wr = this.wheels[a + 1];
      if (!wr) continue;
      wl.arbF = wr.arbF = 0;
      if (wl.detached || wr.detached || !wl.contact || !wr.contact) continue;
      const d = (wl.comp - wr.comp) * wl.arbK;
      wl.arbF = d;
      wr.arbF = -d;
    }
    // ---- pass 2: forces ----
    const downforce = this.def.downforce ? 0.6 * this.def.downforce * (this.def.area || 2) * this.speed * this.speed : 0;
    for (const w of this.wheels) {
      if (w.detached) continue;
      const r = w.radius;
      const driven = w.driven;
      const Ieff = w.inertia + (driven && this.clutchLocked ? (this.engine.inertia * this.gearRatio() ** 2) / Math.max(1, this.drivenCount) : 0);
      let Fs = 0, Fx = 0, Fy = 0;
      let fx = 0, fy = 0, fz = 0; // tyre force world
      if (w.contact) {
        let xdot = (w.comp - w.compPrev) / h;
        if (xdot > 12) xdot = 12; else if (xdot < -6) xdot = -6;
        // progressive damper (digressive at high speed), dissipative bump stop with hysteresis
        const cd = xdot > 0 ? w.cBump : w.cReb;
        const ax = Math.abs(xdot);
        const damper = ax < 0.4 ? cd * xdot : Math.sign(xdot) * cd * (0.4 + (ax - 0.4) * 0.55);
        Fs = w.k * w.comp + damper + (w.arbF || 0);
        const bumpStart = w.sMax - 0.06;
        if (w.comp > bumpStart) {
          const pen = w.comp - bumpStart;
          Fs += w.kBump * pen * (xdot >= 0 ? 1 : 0.3) + (xdot > 0 ? xdot * w.cBump * 3 : 0);
        }
        if (w.bottomed) {
          // suspension fully bottomed: inelastic hard stop through the chassis (no stored energy)
          const vn = w.vx * upx + w.vy * upy + w.vz * upz;
          if (vn < 0) Fs += Math.min((-vn * w.cornerMass) / h, w.cornerMass * 9.81 * 90);
        }
        if (Fs < 0) Fs = 0;
        const nx = w.nx, ny = w.ny, nz = w.nz;
        const cosN = Math.max(0, upx * nx + upy * ny + upz * nz);
        const Fz = Fs * cosN;
        w.load = Fz;
        // contact frame
        let hx = w.hx, hy = w.hy, hz = w.hz;
        const hn = hx * nx + hy * ny + hz * nz;
        hx -= nx * hn; hy -= ny * hn; hz -= nz * hn;
        const hl = Math.hypot(hx, hy, hz) || 1;
        hx /= hl; hy /= hl; hz /= hl;
        const lx = ny * hz - nz * hy, ly = nz * hx - nx * hz, lz = nx * hy - ny * hx;
        const vLong = w.vx * hx + w.vy * hy + w.vz * hz;
        const vLat = w.vx * lx + w.vy * ly + w.vz * lz;
        const sp = SURF_PROPS[w.surface] || SURF_PROPS[0];
        const loose = w.surface === 0 || w.surface === 2 || w.surface === 3 || w.surface === 9 || w.surface === 6;
        let mu = this.tire.grip * sp.grip * (loose ? this.tire.loose : 1);
        const loadRatio = Fz / w.staticLoad;
        mu *= clamp(1.06 - 0.08 * loadRatio, 0.7, 1.08);
        const mEff = w.cornerMass * 0.85;
        // longitudinal
        const sv = w.omega * r - vLong;
        const denom = Math.max(Math.abs(vLong), 1.0);
        const kappa = sv / denom;
        const FxC = mu * Fz * magic(kappa, this.tire.Bx, this.tire.Cx);
        const mSlip = 1 / (1 / mEff + (r * r) / Ieff);
        const FxNeed = (sv * mSlip) / h;
        Fx = Math.abs(FxC) < Math.abs(FxNeed) ? FxC : FxNeed;
        // lateral
        const alpha = Math.atan2(vLat, denom);
        const FyC = -mu * Fz * magic(alpha, this.tire.B, this.tire.C);
        const FyNeed = (-vLat * mEff) / h;
        Fy = Math.abs(FyC) < Math.abs(FyNeed) ? FyC : FyNeed;
        // friction ellipse
        const lim = mu * Fz + 1e-6;
        const m2 = (Fx * Fx) / (lim * lim) + (Fy * Fy) / (lim * lim * 1.0);
        if (m2 > 1) {
          const s = 1 / Math.sqrt(m2);
          Fx *= s; Fy *= s;
        }
        // rolling resistance
        const rr = sp.roll * Fz;
        Fx -= clamp(vLong / 0.3, -1, 1) * rr;
        w.slipLong = Math.abs(kappa);
        w.slipLat = Math.abs(alpha);
        w.slip = Math.max(Math.abs(sv), Math.abs(vLat));
        w.vLong = vLong;
        w.fx = Fx; w.fy = Fy;
        fx = hx * Fx + lx * Fy;
        fy = hy * Fx + ly * Fy;
        fz = hz * Fx + lz * Fy;
        // loop guide: banked corkscrew loops steer the car along the plate centreline
        const hc = w.hitCol;
        if (hc && hc.userData && hc.userData.loop) {
          const ax = hc.ax;
          const sideDot = lfx * ax[0] + lfy * ax[1] + lfz * ax[2];
          const off = (w.center[0] - hc.x) * ax[0] + (w.center[1] - hc.y) * ax[1] + (w.center[2] - hc.z) * ax[2] - w.side * this.shape.track * 0.5 * sideDot;
          const vl = w.vx * ax[0] + w.vy * ax[1] + w.vz * ax[2];
          let G = -(off * 9 + vl * 5) * w.cornerMass;
          const gl = w.cornerMass * 14;
          if (G > gl) G = gl; else if (G < -gl) G = -gl;
          fx += ax[0] * G; fy += ax[1] * G; fz += ax[2] * G;
        }
        w.contactPoint[0] = w.center[0] - nx * r; w.contactPoint[1] = w.center[1] - ny * r; w.contactPoint[2] = w.center[2] - nz * r;
        // wheel spin
        w.omega += ((w.driveTorque - Fx * r) / Ieff) * h;
      } else {
        w.load = 0;
        w.slip = 0;
        w.slipLong = 0;
        w.slipLat = 0;
        w.fx = w.fy = 0;
        w.omega += (w.driveTorque / Ieff) * h;
        w.omega *= 1 - 0.3 * h;
      }
      // brakes (with electronic brake-force distribution: rear brake follows rear axle load)
      let Tb = c.brake * w.brakeMax;
      if (!w.front && w.contact) Tb *= clamp(w.load / w.staticLoad, 0.35, 1.1);
      if (this.cfg.abs && c.brake > 0.2 && w.contact && Math.abs(w.vLong || 0) > 2.5) {
        const k = (w.omega * r - w.vLong) / Math.max(Math.abs(w.vLong), 1);
        if (k < -0.14) { Tb *= 0.15; this.absActive = true; }
      }
      if (w.handbrake && c.handbrake > 0) Tb += c.handbrake * 4000 * (this.mass / 1400);
      if (!this.engineRunning && !this.driverless) Tb += 0;
      const dw = (Tb / Ieff) * h;
      if (Math.abs(w.omega) <= dw) w.omega = 0;
      else w.omega -= Math.sign(w.omega) * dw;
      if (w.omega > 400) w.omega = 400; else if (w.omega < -400) w.omega = -400;
      w.spin += w.omega * h;
      // apply forces to nodes
      if (w.contact) {
        const sx = upx * Fs, sy = upy * Fs, sz = upz * Fs;
        for (let i = 0; i < 4; i++) {
          const [nd, wt] = w.mountW[i];
          const k = nd * 3;
          force[k] += sx * wt; force[k + 1] += sy * wt; force[k + 2] += sz * wt;
          const [nd2, wt2] = w.contactW[i];
          const k2 = nd2 * 3;
          force[k2] += fx * wt2; force[k2 + 1] += fy * wt2; force[k2 + 2] += fz * wt2;
        }
      }
      if (downforce > 0) {
        const df = downforce / 4;
        for (let i = 0; i < 4; i++) {
          const [nd, wt] = w.mountW[i];
          const k = nd * 3;
          force[k] -= upx * df * wt; force[k + 1] -= upy * df * wt; force[k + 2] -= upz * df * wt;
        }
      }
    }
  }

  // ---------------- per-frame damage evaluation ----------------
  finishFrame(dt) {
    const b = this.body;
    if (b.frameDeform <= 0 && !this._dmgDirty) return;
    this._dmgDirty = false;
    // node displacement in design space
    const n = b.n;
    const loc = this._loc || (this._loc = new Float64Array(3));
    const zones = { front: [0, 0], rear: [0, 0], left: [0, 0], right: [0, 0], roof: [0, 0], engine: [0, 0] };
    let total = 0;
    // reference: mean displacement of the (stiff) cabin nodes removes the shift of the best-fit frame
    const disp = this._disp || (this._disp = new Float64Array(n * 3));
    let mx = 0, my = 0, mz = 0, mc = 0;
    for (let i = 0; i < n; i++) {
      b.localNode(i, loc);
      const k = i * 3;
      disp[k] = loc[0] - b.rest[k]; disp[k + 1] = loc[1] - b.rest[k + 1]; disp[k + 2] = loc[2] - b.rest[k + 2];
      if (b.tag[i] & ZONE.MID) { mx += disp[k]; my += disp[k + 1]; mz += disp[k + 2]; mc++; }
    }
    if (mc) { mx /= mc; my /= mc; mz /= mc; }
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      disp[k] -= mx; disp[k + 1] -= my; disp[k + 2] -= mz;
    }
    this.relDisp = disp;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const d = Math.hypot(disp[k], disp[k + 1], disp[k + 2]);
      const t = b.tag[i];
      total += d;
      if (t & ZONE.FRONT) { zones.front[0] += d; zones.front[1]++; }
      if (t & ZONE.REAR) { zones.rear[0] += d; zones.rear[1]++; }
      if (t & ZONE.LEFT) { zones.left[0] += d; zones.left[1]++; }
      if (t & ZONE.RIGHT) { zones.right[0] += d; zones.right[1]++; }
      if (t & ZONE.ROOF) { zones.roof[0] += d; zones.roof[1]++; }
      if (t & ZONE.ENGINE) { zones.engine[0] += d; zones.engine[1]++; }
    }
    const zdm = (z, s) => (z[1] ? clamp(z[0] / z[1] / s, 0, 1) : 0);
    const D = this.damage;
    D.front = Math.max(D.front, zdm(zones.front, 0.35));
    D.rear = Math.max(D.rear, zdm(zones.rear, 0.35));
    D.left = Math.max(D.left, zdm(zones.left, 0.25));
    D.right = Math.max(D.right, zdm(zones.right, 0.25));
    D.roof = Math.max(D.roof, zdm(zones.roof, 0.3));
    // plastic deformation of beams relative to original
    let dev = 0, sum = 0;
    for (let i = 0; i < b.m; i++) {
      dev += Math.abs(b.bRest[i] - b.bRest0[i]) + (b.bBroken[i] ? b.bRest0[i] : 0);
      sum += b.bRest0[i];
    }
    D.total = clamp(dev / sum / 0.06, 0, 1);
    const eng = zdm(zones.engine, 0.42);
    D.engine = Math.max(D.engine, eng);
    if (D.engine > 0.3) {
      this.engineDamage = clamp((D.engine - 0.3) / 0.55, 0, 1);
      if (this.engineDamage >= 0.98 && this.engineAlive) {
        this.engineAlive = false;
        this.events.push({ type: 'engineDead' });
      }
    }
    // wheel mounts
    for (const w of this.wheels) {
      if (w.detached) continue;
      let dx = 0, dy = 0, dz = 0, brokenCnt = 0;
      for (const [nd, wt] of w.mountW) {
        const k = nd * 3;
        dx += disp[k] * wt; dy += disp[k + 1] * wt; dz += disp[k + 2] * wt;
      }
      for (const nd of w.mountNodes) brokenCnt += this.countBrokenAt(nd);
      const mountDisp = Math.hypot(dx, dy, dz);
      w.toe = clamp(-dx * w.side * 1.4 + dz * 0.2, -0.25, 0.25) * (w.front ? 1 : 0.6);
      w.camber = clamp(dx * w.side * 2, -0.4, 0.4);
      if (mountDisp > 0.27 || brokenCnt > 10) {
        w.detached = true;
        w.contact = false;
        this.events.push({ type: 'wheelOff', wheel: w });
      }
    }
  }

  countBrokenAt(node) {
    const b = this.body;
    let c = 0;
    for (let i = 0; i < b.m; i++) if (b.bBroken[i] && (b.bA[i] === node || b.bB[i] === node)) c++;
    return c;
  }

  postSubstep() {}
}
