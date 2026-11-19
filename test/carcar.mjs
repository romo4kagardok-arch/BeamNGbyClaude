import { makeWorld, spawn, run } from './harness.mjs';
const W = makeWorld();
const v = spawn(W, 'sedan', 0, 0, 0);
const o = spawn(W, 'sedan', 0, 25, Math.PI/2);
run(W, 0.5);
v.body.addVelocity(0, 0, 50/3.6);
for (const w of v.wheels) w.omega = 50/3.6 / w.radius;
let i=0;
run(W, 3, (t) => { if (i++ % 6 === 0 && t > 1.2 && t < 2.6) console.log(t.toFixed(2), 'A z', v.body.com[2].toFixed(2), 'vz', v.body.comVel[2].toFixed(2), 'B z', o.body.com[2].toFixed(2), 'vz', o.body.comVel[2].toFixed(2), 'Bx', o.body.com[0].toFixed(2), 'Ay', v.body.com[1].toFixed(2), 'By', o.body.com[1].toFixed(2), 'Bup', o.up[1].toFixed(2)); });
