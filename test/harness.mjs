import { Terrain } from '../src/physics/terrain.js';
import { StaticWorld } from '../src/physics/statics.js';
import { PhysicsWorld } from '../src/physics/world.js';
import { Vehicle } from '../src/vehicle/vehicle.js';

export function makeWorld({ wall = false, size = 2048 } = {}) {
  const t = new Terrain(size, 257);
  const s = new StaticWorld(-size / 2, -size / 2, size, 8);
  for (let i = 0; i < t.surf.length; i++) t.surf[i] = 1;
  const w = new PhysicsWorld(t, s);
  return { t, s, w };
}

export function spawn(world, id, x = 0, z = 0, yaw = 0, cfg = {}) {
  const v = new Vehicle(id, cfg);
  v.place(x, 0, z, yaw);
  world.w.addBody(v.body);
  world.w.addController(v);
  return v;
}

export function run(world, seconds, fn) {
  const dt = 1 / 60;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    if (fn) fn(i * dt);
    world.w.step(dt);
  }
}
