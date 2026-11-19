import { makeWorld, spawn, run } from './harness.mjs';
const id = process.argv[2] || 'truck', h = +(process.argv[3] || 10);
const W = makeWorld();
const v = spawn(W, id, 0, 0, 0);
v.driverless = true;
run(W, 0.5);
for (let i = 0; i < v.body.n; i++) v.body.pos[i*3+1] += h;
v.body.prev.set(v.body.pos);
run(W, 1.4);
for (let s = 0; s < 120; s++) {
  W.w.prepareFrame(0.001); W.w.substep(0.001); W.w.finishFrame(0.001);
  if (s % 4 === 0) {
    let miny = 1e9, maxy=-1e9; for (let i = 0; i < v.body.n; i++) { miny = Math.min(miny, v.body.pos[i*3+1]); maxy=Math.max(maxy, v.body.pos[i*3+1]); }
    let ke = 0; for (let i = 0; i < v.body.n; i++) { const k=i*3; ke += 0.5*v.body.mass[i]*(v.body.vel[k]**2+v.body.vel[k+1]**2+v.body.vel[k+2]**2); }
    console.log(s, 'vy', v.body.comVel[1].toFixed(2), 'miny', miny.toFixed(3), 'maxy', maxy.toFixed(2), 's', v.wheels.map(w=>w.s.toFixed(3)).join(','), 'load', v.wheels.map(w=>(w.load/1000).toFixed(0)).join(','), 'KE', (ke/1000).toFixed(1), 'pl', v.body.plasticEnergy.toFixed(2));
  }
}
