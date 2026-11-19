import { makeWorld, spawn, run } from './harness.mjs';
const id = process.argv[2] || 'sedan';
const speeds = (process.argv[3] || '50,100').split(',').map(Number);
const kind = process.argv[4] || 'wall';
for (const kmh of speeds) {
  const W = makeWorld();
  if (kind === 'wall') W.s.addBox({ x: 0, y: 1.5, z: 40, hx: 6, hy: 1.5, hz: 1 });
  if (kind === 'pole') W.s.addCylinder({ x: 0, z: 40, y0: -1, y1: 6, r: 0.15 });
  const v = spawn(W, id, 0, 0, 0);
  let other = null;
  if (kind === 'car') { other = spawn(W, process.argv[5] || 'sedan', 0, 40, Math.PI/2); other.driverless = true; }
  run(W, 0.5);
  const target = kmh / 3.6;
  // launch at speed directly (crash-test sled)
  v.body.addVelocity(0, 0, target);
  for (const w of v.wheels) w.omega = target / w.radius;
  let maxDec = 0, prevV = v.body.comVel[2], tImpact = -1;
  const frontRest = v.shape.zFront;
  let i = 0;
  const t0 = performance.now();
  run(W, 4, (t) => {
    const vz = v.body.comVel[2];
    const dec = (prevV - vz) * 60 / 9.81;
    if (dec > maxDec) maxDec = dec;
    if (dec > 2 && tImpact < 0) tImpact = t;
    prevV = vz;
  });
  const t1 = performance.now();
  v.body.computeFrame();
  // max crush: front-most node local z vs rest
  let maxFront = -Infinity; const loc = [0,0,0];
  let maxDisp = 0;
  for (let n = 0; n < v.body.n; n++) {
    v.body.localNode(n, loc);
    maxFront = Math.max(maxFront, loc[2]);
    maxDisp = Math.max(maxDisp, Math.hypot(loc[0]-v.body.rest[n*3], loc[1]-v.body.rest[n*3+1], loc[2]-v.body.rest[n*3+2]));
  }
  let restFront = -Infinity; for (let n = 0; n < v.body.n; n++) restFront = Math.max(restFront, v.body.rest[n*3+2]);
  console.log(`${id} ${kind} ${kmh}km/h: crush ${(restFront - maxFront).toFixed(2)}m maxDisp ${maxDisp.toFixed(2)} peakG ${maxDec.toFixed(1)} dmg ${(v.damage.total*100).toFixed(0)}% front ${(v.damage.front*100).toFixed(0)}% eng ${(v.damage.engine*100).toFixed(0)}% broken ${v.body.brokenCount} wheelsOff ${v.wheels.filter(w=>w.detached).length} alive ${v.engineAlive} rebound ${(v.body.comVel[2]).toFixed(2)} up ${v.up[1].toFixed(2)} ms ${(t1-t0).toFixed(0)}`);
  if (other) console.log('   other dmg', (other.damage.total*100).toFixed(0), '% left', (other.damage.left*100).toFixed(0), 'right', (other.damage.right*100).toFixed(0), 'vel', other.body.comVel.map(x=>x.toFixed(1)).join(','));
}
