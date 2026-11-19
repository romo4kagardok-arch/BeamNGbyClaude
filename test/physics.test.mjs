import { makeWorld, spawn, run } from './harness.mjs';

const id = process.argv[2] || 'sedan';
const W = makeWorld();
const v = spawn(W, id, 0, 0, 0);
console.log('nodes', v.body.n, 'beams', v.body.m, 'mass', v.mass, 'restCom', v.body.restCom.map(x=>x.toFixed(2)).join(','));
let t0 = performance.now();
run(W, 2);
let t1 = performance.now();
console.log('settle: com y', v.body.com[1].toFixed(3), 'dmg', v.damage.total.toFixed(4), 'plastic', v.body.plasticEnergy.toFixed(4),
  'comps', v.wheels.map(w=>w.comp.toFixed(3)).join(' '), 'ms/sim-s', ((t1-t0)/2).toFixed(1));
// accelerate
v.input.throttle = 1;
let log = [];
run(W, 10, (t) => { if (Math.abs(t % 1) < 1/60) log.push(`${t.toFixed(0)}s ${(v.fwdSpeed*3.6).toFixed(0)}kmh g${v.gear} ${v.rpm.toFixed(0)}rpm`); });
console.log(log.join(' | '));
console.log('after accel dmg', v.damage.total.toFixed(4), 'plastic', v.body.plasticEnergy.toFixed(4), 'pos z', v.body.com[2].toFixed(1), 'x', v.body.com[0].toFixed(2));
// steer
v.input.throttle = 0.4; v.input.steer = 0.5;
let yaw0 = v.yaw;
run(W, 3);
console.log('after steer: yaw change', ((v.yaw - yaw0)*180/Math.PI).toFixed(1), 'speed', (v.speed*3.6).toFixed(0), 'up.y', v.up[1].toFixed(3), 'plastic', v.body.plasticEnergy.toFixed(4));
v.input.steer = 0; v.input.throttle = 0;
run(W, 2);
// brake
const sp = v.fwdSpeed; const p0 = [...v.body.com];
v.input.brake = 1;
let tb = 0;
run(W, 8, (t) => { if (v.fwdSpeed > 0.5) tb = t; });
console.log('brake from', (sp*3.6).toFixed(0), 'kmh: dist', Math.hypot(v.body.com[0]-p0[0], v.body.com[2]-p0[2]).toFixed(1), 'm time', tb.toFixed(2), 'gear', v.gear, 'plastic', v.body.plasticEnergy.toFixed(4));
