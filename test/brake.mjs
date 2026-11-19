import { makeWorld, spawn, run } from './harness.mjs';
for (const abs of [true, false]) {
  const W = makeWorld();
  const v = spawn(W, 'sedan', 0, 0, 0, { abs, engine: 'v6' });
  run(W, 1);
  v.input.throttle = 1;
  run(W, 12, () => { if (v.fwdSpeed > 27.8) v.input.throttle = 0; });
  const sp = v.fwdSpeed; const p0 = [...v.body.com];
  v.input.throttle = 0; v.input.brake = 1;
  let i = 0;
  run(W, 4, (t) => { if (i++ % 20 === 0 && v.fwdSpeed > 1) console.log(t.toFixed(2), (v.fwdSpeed*3.6).toFixed(1), v.wheels.map(w => `${w.load.toFixed(0)}/${w.fx.toFixed(0)}/${(w.omega*w.radius).toFixed(1)}`).join(' ')); });
  console.log('abs', abs, 'from', (sp*3.6).toFixed(0), 'dist', Math.hypot(v.body.com[0]-p0[0], v.body.com[2]-p0[2]).toFixed(1));
}
