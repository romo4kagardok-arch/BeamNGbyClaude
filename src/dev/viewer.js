import * as THREE from 'three';
import { Vehicle } from '../vehicle/vehicle.js';
import { VehicleVisual } from '../vehicle/carvisual.js';
import { Terrain } from '../physics/terrain.js';
import { StaticWorld } from '../physics/statics.js';
import { PhysicsWorld } from '../physics/world.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fc4e8');
const cam = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 500);
scene.add(new THREE.HemisphereLight('#dfefff', '#665544', 1.2));
const sun = new THREE.DirectionalLight('#ffffff', 2.5);
sun.position.set(20, 30, 15);
sun.castShadow = true;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 });
scene.add(sun);
const pm = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.background = new THREE.Color('#9fc4e8');
const g = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: '#555' }));
g.rotation.x = -Math.PI / 2; g.position.y = -5; envScene.add(g);
scene.environment = pm.fromScene(envScene, 0.04).texture;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#777' }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

const params = new URLSearchParams(location.search);
const ids = (params.get('ids') || 'sedan,hatch,sport,suv,pickup,truck,bus,police').split(',');
const t = new Terrain(512, 65);
const world = new PhysicsWorld(t, new StaticWorld(-256, -256, 512, 8));
const cars = [];
let x = 0;
ids.forEach((id, i) => {
  const v = new Vehicle(id);
  const w = v.shape.width;
  x += i ? w / 2 + 1.2 : 0;
  v.place(x, 0, 0, Number(params.get('yaw') || 0.0));
  world.addBody(v.body); world.addController(v);
  const vis = new VehicleVisual(v, scene);
  cars.push({ v, vis });
  x += w / 2 + 1.2;
});
const doors = params.get('open');
const crash = Number(params.get('crash') || 0);
if (crash) {
  const kind = params.get('kind') || 'wall';
  if (kind === 'wall') world.statics.addBox({ x: 0, y: 1.5, z: 12, hx: 30, hy: 1.5, hz: 0.5 });
  if (kind === 'pole') for (const c of cars) world.statics.addCylinder({ x: c.v.body.com[0] + 0.3, z: 12, y0: -1, y1: 6, r: 0.15 });
  const wallM = new THREE.Mesh(new THREE.BoxGeometry(60, 3, 1), new THREE.MeshStandardMaterial({ color: '#888' }));
  wallM.position.set(0, 1.5, 12);
  if (kind === 'wall') scene.add(wallM);
  for (const c of cars) { c.v.body.addVelocity(0, 0, crash / 3.6); for (const w of c.v.wheels) w.omega = crash / 3.6 / w.radius; }
  const ev = [];
  for (let i = 0; i < 150; i++) {
    world.step(1 / 60);
    for (const c of cars) {
      const e2 = [];
      c.vis.update(1 / 60, e2);
      for (const e of e2) { ev.push(e); if (e.type === 'partOff') { const d = c.vis.detachPart(e.part); d.group.matrix.copy(c.vis.root.matrix); d.group.matrixAutoUpdate = false; scene.add(d.group); } }
    }
  }
  console.log('events', ev.map(e => e.type).join(','));
}
for (let i = 0; i < 30; i++) world.step(1 / 60);
if (doors) for (const c of cars) { c.vis.toggle('doors'); c.vis.toggle('hood'); c.vis.toggle('trunk'); }
for (let i = 0; i < 60; i++) { for (const c of cars) c.vis.update(1 / 60, []); }
const cx = x / 2;
const cz = crash ? 8 : 0;
const view = params.get('view') || 'front';
const dist = Number(params.get('dist') || Math.max(10, x * 0.9));
if (view === 'front') cam.position.set(cx + dist * 0.35, dist * 0.35, cz + dist * 0.8);
if (view === 'quarter') cam.position.set(cx + dist * 0.7, dist * 0.4, cz + dist * 0.15);
if (view === 'rear') cam.position.set(cx - dist * 0.35, dist * 0.3, -dist * 0.8);
if (view === 'side') cam.position.set(cx + dist, 1.6, 0.0);
if (view === 'top') cam.position.set(cx, dist, 0.01);
cam.lookAt(cx, 0.8, cz);
renderer.render(scene, cam);
window.__ready = true;
