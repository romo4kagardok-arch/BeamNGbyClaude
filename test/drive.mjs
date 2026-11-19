import { makeWorld, spawn, run } from './harness.mjs';
const ids = (process.argv[2] || 'sedan,hatch,sport,suv,pickup,truck,bus,police').split(',');
for (const id of ids) {
  const W = makeWorld();
  const v = spawn(W, id, 0, -800, 0);
  const t0 = performance.now();
  run(W, 2);
  const settlePl = v.body.plasticEnergy;
  v.input.throttle = 1;
  let t100 = -1, vmax = 0;
  run(W, 40, (t) => { if (t100 < 0 && v.fwdSpeed > 27.78) t100 = t; vmax = Math.max(vmax, v.fwdSpeed); });
  const accPl = v.body.plasticEnergy;
  // slalom at ~60
  v.input.throttle = 0; v.input.brake = 1;
  run(W, 10, () => { if (v.fwdSpeed < 16.7) { v.input.brake = 0; v.input.throttle = 0.3; } });
  let maxRoll = 0;
  run(W, 8, (t) => { v.input.steer = Math.sin(t * 2.0) * 0.8; v.input.throttle = v.fwdSpeed < 16.7 ? 0.5 : 0; maxRoll = Math.max(maxRoll, Math.abs(v.body.R[3])); });
  const t1 = performance.now();
  console.log(`${id.padEnd(7)} m=${v.mass} nodes=${v.body.n} beams=${v.body.m} settlePlastic=${settlePl.toFixed(3)} 0-100=${t100.toFixed(1)}s vmax=${(vmax*3.6).toFixed(0)} accelPl=${(accPl-settlePl).toFixed(3)} slalomRoll=${maxRoll.toFixed(2)} up=${v.up[1].toFixed(2)} totalPl=${v.body.plasticEnergy.toFixed(3)} cpu=${((t1-t0)/60).toFixed(1)}ms/s`);
}
