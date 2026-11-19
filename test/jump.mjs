import { makeWorld, spawn, run } from './harness.mjs';
for (const id of ['sedan','hatch','sport','suv','pickup','truck','bus']) {
  for (const h of [1.5, 4, 10]) {
    const W = makeWorld();
    const v = spawn(W, id, 0, 0, 0);
    v.driverless = true;
    run(W, 0.5);
    for (let i = 0; i < v.body.n; i++) v.body.pos[i*3+1] += h;
    v.body.prev.set(v.body.pos);
    run(W, 3);
    console.log(id, 'drop', h, 'm: dmg', (v.damage.total*100).toFixed(1), '% maxDisp-plastic', v.body.plasticEnergy.toFixed(3), 'wheelsOff', v.wheels.filter(w=>w.detached).length, 'comY', v.body.com[1].toFixed(2), 'restComY', v.body.restCom[1].toFixed(2));
  }
}
