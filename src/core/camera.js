// Camera controller: chase, far chase, hood, driver, orbit, cinematic and free-fly cameras.
import * as THREE from 'three';
import { clamp, lerp, wrapAngle, damp } from './math.js';

export const CAM_MODES = ['chase', 'far', 'hood', 'driver', 'orbit', 'cinematic'];
export const CAM_NAMES = { chase: 'Сзади', far: 'Дальняя', hood: 'Капот', driver: 'Из салона', orbit: 'Орбита', cinematic: 'Кино', free: 'Свободная' };

export class CameraRig {
  constructor(camera, terrain) {
    this.cam = camera;
    this.terrain = terrain;
    this.mode = 'chase';
    this.yaw = 0;
    this.pitch = 0.18;
    this.orbitYaw = 0;
    this.orbitPitch = 0.25;
    this.orbitDist = 9;
    this.userYaw = 0;
    this.userPitch = 0;
    this.userTimer = 0;
    this.zoom = 1;
    this.pos = new THREE.Vector3(0, 10, 0);
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.cine = null;
    this.free = { pos: new THREE.Vector3(0, 40, 0), yaw: 0, pitch: -0.4 };
    this.baseFov = 62;
  }

  setMode(m) {
    this.mode = m;
    this.cine = null;
  }

  next() {
    const i = CAM_MODES.indexOf(this.mode);
    this.setMode(CAM_MODES[(i + 1) % CAM_MODES.length]);
    return this.mode;
  }

  addShake(a) {
    this.shake = Math.min(1.2, this.shake + a);
  }

  snap(vehicle) {
    const R = vehicle.body.R;
    this.yaw = Math.atan2(R[2], R[8]);
    this.userYaw = this.userPitch = 0;
    const c = vehicle.body.com;
    this.pos.set(c[0] - Math.sin(this.yaw) * 7, c[1] + 2.5, c[2] - Math.cos(this.yaw) * 7);
  }

  update(dt, vehicle, input, mouseActive) {
    const cam = this.cam;
    if (this.mode === 'free') return this.updateFree(dt, input);
    if (!vehicle) return;
    const b = vehicle.body;
    const R = b.R;
    const c = b.com;
    const size = Math.max(4, vehicle.shape.length);
    const fwd = new THREE.Vector3(R[2], R[5], R[8]);
    const up = new THREE.Vector3(R[1], R[4], R[7]);
    // mouse look
    if (mouseActive && (input.mouse.left || input.mouse.right)) {
      this.userYaw -= input.mouse.dx * 0.005;
      this.userPitch = clamp(this.userPitch + input.mouse.dy * 0.004, -0.5, 1.2);
      this.userTimer = 2.5;
    }
    const [px, py] = input.padLook();
    if (px || py) {
      this.userYaw -= px * dt * 2.5;
      this.userPitch = clamp(this.userPitch + py * dt * 1.5, -0.5, 1.2);
      this.userTimer = 1.2;
    }
    if (input.mouse.wheel) this.zoom = clamp(this.zoom * (1 + input.mouse.wheel * 0.1), 0.45, 3.5);
    this.userTimer -= dt;
    if (this.userTimer < 0 && this.mode !== 'orbit') {
      this.userYaw = damp(this.userYaw, 0, 2.5, dt);
      this.userPitch = damp(this.userPitch, 0, 2.5, dt);
    }
    const speed = vehicle.speed;
    let fov = this.baseFov;
    if (this.mode === 'chase' || this.mode === 'far') {
      // follow heading (projected), slight velocity look-ahead
      let targetYaw = Math.atan2(fwd.x, fwd.z);
      const v = b.comVel;
      if (vehicle.fwdSpeed < -2) targetYaw = Math.atan2(fwd.x, fwd.z);
      if (Math.abs(fwd.y) > 0.9) targetYaw = this.yaw; // pointing straight up/down
      const dy = wrapAngle(targetYaw - this.yaw);
      this.yaw += dy * (1 - Math.exp(-dt * (speed > 2 ? 4.5 : 2.5)));
      const far = this.mode === 'far';
      const dist = (far ? size * 2.4 : size * 1.25 + 2.2) * this.zoom;
      const height = far ? size * 0.85 : size * 0.32 + 0.9;
      const yaw = this.yaw + this.userYaw;
      const pitch = Math.atan2(height, dist) + this.userPitch;
      const target = new THREE.Vector3(c[0], c[1] + (far ? 1 : 0.9), c[2]);
      const want = new THREE.Vector3(
        target.x - Math.sin(yaw) * Math.cos(pitch) * Math.hypot(dist, height),
        target.y + Math.sin(pitch) * Math.hypot(dist, height),
        target.z - Math.cos(yaw) * Math.cos(pitch) * Math.hypot(dist, height),
      );
      const g = this.terrain.heightAt(want.x, want.z) + 0.6;
      if (want.y < g) want.y = g;
      // keep the distance stiff (prevents lag at high speed), smooth the rest
      this.pos.lerp(want, 1 - Math.exp(-dt * 12));
      const ground = this.terrain.heightAt(this.pos.x, this.pos.z) + 0.5;
      if (this.pos.y < ground) this.pos.y = ground;
      cam.position.copy(this.pos);
      this.look.copy(target);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      fov = this.baseFov + Math.min(14, speed * 0.18);
    } else if (this.mode === 'hood' || this.mode === 'driver') {
      const sh = vehicle.shape;
      const driver = this.mode === 'driver';
      const ws = sh.p.glass && sh.p.glass.ws ? sh.p.glass.ws[1] : sh.zFA;
      const local = driver
        ? [vehicle.def.shape.style === 'bus' ? 0.6 : 0.36, sh.top(ws - 1.0) + (vehicle.mass > 4000 ? 0.9 : 0.38), ws - 0.95]
        : [0, sh.top(sh.zFront - 0.6) + 0.42, ws + 0.1];
      const p = b.toWorld(local[0], local[1], local[2], [0, 0, 0]);
      cam.position.set(p[0], p[1], p[2]);
      const ly = this.userYaw, lp = -this.userPitch * 0.6;
      const dir = fwd.clone().applyAxisAngle(up, ly);
      const right = new THREE.Vector3().crossVectors(dir, up).normalize();
      dir.applyAxisAngle(right, lp);
      cam.up.copy(up);
      cam.lookAt(p[0] + dir.x * 10, p[1] + dir.y * 10, p[2] + dir.z * 10);
      fov = driver ? 72 : 68;
    } else if (this.mode === 'orbit') {
      if (mouseActive && (input.mouse.left || input.mouse.right)) {
        this.orbitYaw -= input.mouse.dx * 0.006;
        this.orbitPitch = clamp(this.orbitPitch + input.mouse.dy * 0.005, -0.1, 1.4);
      }
      this.orbitYaw -= px * dt * 2;
      this.orbitDist = clamp(size * 1.6 * this.zoom, 3, 60);
      const t = new THREE.Vector3(c[0], c[1] + 0.5, c[2]);
      const d = this.orbitDist;
      cam.position.set(t.x + Math.sin(this.orbitYaw) * Math.cos(this.orbitPitch) * d, t.y + Math.sin(this.orbitPitch) * d, t.z + Math.cos(this.orbitYaw) * Math.cos(this.orbitPitch) * d);
      const g = this.terrain.heightAt(cam.position.x, cam.position.z) + 0.4;
      if (cam.position.y < g) cam.position.y = g;
      cam.up.set(0, 1, 0);
      cam.lookAt(t);
    } else if (this.mode === 'cinematic') {
      const pc = new THREE.Vector3(c[0], c[1], c[2]);
      if (!this.cine || this.cine.distanceTo(pc) > 70 || this.cineTimer > 9) {
        const v = b.comVel;
        const vl = Math.hypot(v[0], v[2]);
        const dir = vl > 2 ? new THREE.Vector3(v[0] / vl, 0, v[2] / vl) : new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
        const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar((Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 8));
        const ahead = Math.min(55, 12 + vl * 2.2);
        this.cine = pc.clone().addScaledVector(dir, ahead).add(side);
        this.cine.y = this.terrain.heightAt(this.cine.x, this.cine.z) + 1.2 + Math.random() * 3;
        this.cineTimer = 0;
      }
      this.cineTimer = (this.cineTimer || 0) + dt;
      cam.position.copy(this.cine);
      cam.up.set(0, 1, 0);
      cam.lookAt(pc.x, pc.y + 0.5, pc.z);
      fov = clamp(40 - this.cine.distanceTo(pc) * 0.2, 18, 45);
    }
    if (this.shake > 0.001) {
      const s = this.shake * 0.15;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-dt * 6);
    }
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = lerp(cam.fov, fov, 1 - Math.exp(-dt * 3));
      cam.updateProjectionMatrix();
    }
  }

  startFree(fromCam) {
    this.free.pos.copy(fromCam.position);
    const d = new THREE.Vector3();
    fromCam.getWorldDirection(d);
    this.free.yaw = Math.atan2(d.x, d.z);
    this.free.pitch = Math.asin(clamp(d.y, -1, 1));
    this.setMode('free');
  }

  updateFree(dt, input) {
    const f = this.free;
    if (input.mouse.right || input.mouse.left && input.key('AltLeft')) {
      f.yaw -= input.mouse.dx * 0.004;
      f.pitch = clamp(f.pitch - input.mouse.dy * 0.004, -1.5, 1.5);
    }
    const [px, py] = input.padLook();
    f.yaw -= px * dt * 2;
    f.pitch = clamp(f.pitch - py * dt * 1.5, -1.5, 1.5);
    const dir = new THREE.Vector3(Math.sin(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch), Math.cos(f.yaw) * Math.cos(f.pitch));
    const right = new THREE.Vector3(-Math.cos(f.yaw), 0, Math.sin(f.yaw));
    let sp = input.key('ShiftLeft') || input.key('ShiftRight') ? 80 : 22;
    const m = new THREE.Vector3();
    if (input.key('KeyW') || input.key('ArrowUp')) m.add(dir);
    if (input.key('KeyS') || input.key('ArrowDown')) m.sub(dir);
    if (input.key('KeyD') || input.key('ArrowRight')) m.add(right);
    if (input.key('KeyA') || input.key('ArrowLeft')) m.sub(right);
    if (input.key('KeyE') || input.key('PageUp')) m.y += 1;
    if (input.key('KeyQ') || input.key('PageDown')) m.y -= 1;
    if (input.pad) {
      const ax = input.pad.axes;
      if (Math.abs(ax[1]) > 0.1) m.addScaledVector(dir, -ax[1]);
      if (Math.abs(ax[0]) > 0.1) m.addScaledVector(right, ax[0]);
    }
    f.pos.addScaledVector(m, sp * dt);
    const g = this.terrain.heightAt(f.pos.x, f.pos.z) + 0.8;
    if (f.pos.y < g) f.pos.y = g;
    this.cam.position.copy(f.pos);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(f.pos.clone().add(dir));
    if (Math.abs(this.cam.fov - 65) > 0.1) { this.cam.fov = 65; this.cam.updateProjectionMatrix(); }
  }
}
