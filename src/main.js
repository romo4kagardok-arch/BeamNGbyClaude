// CRUMPLE ZONE — browser soft-body driving sandbox. Entry point and game orchestration.
import * as THREE from 'three';
import { generateMap, registerStatics, MAP_SIZE } from './world/mapgen.js';
import { StaticWorld, SURF } from './physics/statics.js';
import { PhysicsWorld } from './physics/world.js';
import { Vehicle } from './vehicle/vehicle.js';
import { VehicleVisual } from './vehicle/carvisual.js';
import { VEHICLES, defaultConfig } from './vehicle/defs.js';
import { WorldVisual } from './world/worldvisual.js';
import { Environment } from './world/sky.js';
import { Dynamics, PROP_DEFS } from './world/dynamics.js';
import { Particles, DUST_COLORS } from './fx/particles.js';
import { Skidmarks } from './fx/skidmarks.js';
import { AudioEngine } from './audio/audio.js';
import { Input } from './core/input.js';
import { CameraRig, CAM_NAMES } from './core/camera.js';
import { Hud } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { renderMapImage } from './ui/mapimage.js';
import { MODES, FreeRoam } from './modes/modes.js';
import { AIDriver, makePath, nearestIndex } from './ai/driver.js';
import { Editor, expandObject } from './editor/editor.js';
import { clamp } from './core/math.js';

const HARD = new Set([SURF.ASPHALT, SURF.CONCRETE, SURF.CURB, SURF.METAL, SURF.WOOD]);
const LOOSE = new Set([SURF.GRASS, SURF.DIRT, SURF.SAND, SURF.SNOW, SURF.MUD]);

const DEFAULT_SETTINGS = { quality: 'high', resScale: 1, volume: 0.8, fov: 62, showFps: false, autoSlowmo: true, kmh: true, timeOfDay: 13, traffic: 4 };

function load(key, def) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ? { ...def, ...v } : { ...def }; } catch (e) { return { ...def }; }
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

class Game {
  constructor() {
    this.settings = load('cz_settings', DEFAULT_SETTINGS);
    this.garage = {};
    const saved = load('cz_garage', {});
    for (const id of Object.keys(VEHICLES)) this.garage[id] = { ...defaultConfig(id), ...(saved[id] || {}) };
    this.selected = localStorage.getItem('cz_selected') || 'sedan';
    if (!VEHICLES[this.selected]) this.selected = 'sedan';
    this.vehicles = [];
    this.player = null;
    this.mode = null;
    this.modeId = null;
    this.state = 'loading';
    this.brokenStatics = [];
    this.editorLayer = null;
    this.loadingEl = document.getElementById('loading');
  }

  setLoading(text, p) {
    if (!this.loadingEl) return;
    this.loadingEl.querySelector('.load-text').textContent = text;
    this.loadingEl.querySelector('.load-bar i').style.width = Math.round(p * 100) + '%';
  }

  async init() {
    const app = document.getElementById('app');
    this.setLoading('Инициализация графики…', 0.05);
    await nextFrame();
    const q = this.settings.quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: q !== 'low', powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    app.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.1, 5000);
    this.setLoading('Генерация мира: рельеф, дороги, город…', 0.15);
    await nextFrame();
    this.map = generateMap(7);
    this.setLoading('Статическая геометрия и физика…', 0.35);
    await nextFrame();
    this.statics = new StaticWorld(-MAP_SIZE / 2 - 50, -MAP_SIZE / 2 - 50, MAP_SIZE + 100, 8);
    registerStatics(this.map, this.statics);
    this.world = new PhysicsWorld(this.map.T, this.statics);
    this.world.onStaticBreak = (c) => this.onStaticBreak(c);
    this.setLoading('Небо и освещение…', 0.45);
    await nextFrame();
    this.env = new Environment(this.renderer, this.scene, q);
    this.setLoading('Построение мира (меши, деревья, здания)…', 0.55);
    await nextFrame();
    this.worldVisual = new WorldVisual(this.map, this.scene, q);
    this.setLoading('Карта…', 0.75);
    await nextFrame();
    this.mapImage = renderMapImage(this.map, 1024);
    this.dynamics = new Dynamics(this.scene, this.world, this.map.T);
    this.particles = new Particles(this.scene);
    this.skidmarks = new Skidmarks(this.scene);
    this.input = new Input();
    this.cam = new CameraRig(this.camera, this.map.T);
    this.cam.baseFov = this.settings.fov;
    this.audio = new AudioEngine();
    this.audio.volume = this.settings.volume;
    this.hud = new Hud(document.getElementById('ui'), this.mapImage, MAP_SIZE);
    this.hud.showFps = this.settings.showFps;
    this.menu = new Menu(document.getElementById('ui'), this);
    this.hud.onButton = (id) => {
      this.audio.init();
      if (this.state !== 'play') return;
      if (id === 'pause') { if (!this.paused) this.menu.openPause(); return; }
      if (this.paused || !this.player) return;
      if (id === 'repair') { this.player.repair(); this.hud.message('Автомобиль восстановлен', 1.2); }
      if (id === 'reset') { this.mode && this.mode.respawn(); this.cam.snap(this.player); }
      if (id === 'camera') { const m = this.cam.mode === 'free' ? (this.cam.setMode('chase'), 'chase') : this.cam.next(); this.hud.message('Камера: ' + CAM_NAMES[m], 1); }
    };
    this.editor = new Editor(this);
    this.setLoading('Синтез звуков двигателей…', 0.8);
    await nextFrame();
    this.audio.prepare();
    this.setLoading('Объекты полигона…', 0.9);
    await nextFrame();
    this.spawnMapProps();
    this.applyQuality();
    this.setTimeOfDay(this.settings.timeOfDay);
    window.addEventListener('resize', () => this.onResize());
    this.onResize();
    this.renderer.domElement.addEventListener('mousedown', () => { this.canvasMouse = true; this.audio.init(); });
    window.addEventListener('mouseup', () => { this.canvasMouse = false; });
    window.addEventListener('keydown', () => this.audio.init(), { once: false });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.audio.suspend(); else this.audio.resume(); });
    this.setLoading('Готово', 1);
    this.menu.openMain();
    if (this.loadingEl) this.loadingEl.classList.add('done');
    this.last = performance.now();
    this.renderer.setAnimationLoop((t) => this.frame(t));
    window.__game = this;
    window.__ready = true;
  }

  // ---------------- settings ----------------
  saveSettings() { localStorage.setItem('cz_settings', JSON.stringify(this.settings)); }
  saveGarage() { localStorage.setItem('cz_garage', JSON.stringify(this.garage)); }
  resetGarage(id) { this.garage[id] = defaultConfig(id); this.saveGarage(); this.refreshShowcase(); }
  selectVehicle(id) { this.selected = id; localStorage.setItem('cz_selected', id); this.refreshShowcase(); }
  selectedVehicle() { return { id: this.selected, cfg: { ...this.garage[this.selected] } }; }

  applyQuality() {
    const q = this.settings.quality;
    const pr = Math.min(window.devicePixelRatio || 1, q === 'low' ? 1 : q === 'medium' ? 1.25 : 2) * this.settings.resScale;
    this.renderer.setPixelRatio(pr);
    const shadows = q !== 'low';
    this.renderer.shadowMap.enabled = shadows;
    this.env.sun.castShadow = shadows;
    const size = q === 'ultra' ? 4096 : q === 'high' ? 2048 : 1024;
    if (this.env.sun.shadow.mapSize.x !== size) {
      this.env.sun.shadow.mapSize.set(size, size);
      if (this.env.sun.shadow.map) { this.env.sun.shadow.map.dispose(); this.env.sun.shadow.map = null; }
    }
    this.particles.quality = q === 'low' ? 0.4 : q === 'medium' ? 0.7 : 1;
    this.scene.fog.far = q === 'low' ? 1100 : q === 'medium' ? 1700 : 2400;
    this.camera.far = this.scene.fog.far + 400;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.onResize();
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  setTimeOfDay(hrs) {
    this.settings.timeOfDay = hrs;
    this.env.setTime(hrs);
    this.worldVisual.setNight(this.env.night);
    for (const v of this.vehicles) v.lightsOn = this.env.night > 0.35;
  }

  cameraName() { return CAM_NAMES[this.cam.mode] || this.cam.mode; }

  // ---------------- world objects ----------------
  spawnMapProps() {
    for (const p of this.map.props) this.dynamics.spawnProp(p.type, p.x, null, p.z, p.yaw, { yOff: p.yOff || 0, persistent: true });
  }

  resetWorldObjects() {
    this.dynamics.clear();
    for (const c of this.brokenStatics) c.enabled = true;
    this.brokenStatics = [];
    this.worldVisual.showAllTrees();
    this.worldVisual.showAllLamps();
    this.skidmarks.clear();
    this.particles.clear();
    this.spawnMapProps();
  }

  onStaticBreak(c) {
    const ud = c.userData || {};
    this.brokenStatics.push(c);
    const push = c.hitDir || [1, 0];
    if (ud.tree !== undefined) {
      const t = this.map.trees[ud.tree];
      this.worldVisual.hideTree(ud.tree);
      const grp = new THREE.Group();
      const m = new THREE.Mesh(this.worldVisual.treeGeos[t.type], this.worldVisual.treeMat);
      m.scale.set(t.s, t.s, t.s);
      m.rotation.y = t.rot;
      m.castShadow = true;
      grp.add(m);
      this.dynamics.spawnFallen('tree', t.x, t.y, t.z, t.s, grp, push);
      this.audio.thud(0.8, [t.x, t.y + 1, t.z]);
    } else if (ud.lamp !== undefined) {
      const l = this.map.lamps[ud.lamp];
      this.worldVisual.hideLamp(ud.lamp);
      const grp = new THREE.Group();
      const g = this.worldVisual.lampGeometry();
      const m = new THREE.Mesh(g.body, this.worldVisual.lampMat);
      const hd = new THREE.Mesh(g.head, this.worldVisual.lampHeadMat);
      for (const x of [m, hd]) { x.rotation.y = l.side === 1 ? -Math.PI / 2 : 0; x.castShadow = true; grp.add(x); }
      this.dynamics.spawnFallen('lamp', l.x, l.y, l.z, 1, grp, push);
      this.audio.impact(9, [l.x, l.y + 1, l.z], true);
    }
  }

  groundAt(x, z) {
    let y = this.map.T.heightAt(x, z);
    const hit = { nx: 0, ny: 0, nz: 0, collider: null };
    const t = this.statics.raycast(x, y + 40, z, 0, -1, 0, 45, hit);
    if (t < Infinity) y = Math.max(y, y + 40 - t);
    return y;
  }

  makePropPreview(type) {
    // static preview mesh for the editor (same as dynamic prop visual)
    const it = this.dynamics.spawnProp(type, 0, -500, 0, 0);
    const obj = it.obj;
    this.dynamics.remove(it);
    obj.matrixAutoUpdate = true;
    obj.matrix.identity();
    return obj;
  }

  // ---------------- vehicles ----------------
  spawnVehicle(id, cfg, x, z, yaw, opts = {}) {
    const base = { ...defaultConfig(id), ...(cfg || {}) };
    if (base.engine && !VEHICLES[id].engines.includes(base.engine)) base.engine = VEHICLES[id].engine;
    const v = new Vehicle(id, base);
    const y = opts.y ?? this.groundAt(x, z);
    v.place(x, y, z, yaw);
    this.world.addBody(v.body);
    this.world.addController(v);
    v.visual = new VehicleVisual(v, this.scene);
    if (opts.player) v.visual.enableHeadlights(true);
    v.lightsOn = this.env.night > 0.35;
    v.isPlayerCar = !!opts.player;
    this.vehicles.push(v);
    return v;
  }

  removeVehicle(v) {
    this.world.removeBody(v.body);
    this.world.removeController(v);
    v.visual.dispose();
    this.audio.removeVehicleVoice(v);
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    if (this.player === v) this.player = null;
  }

  clearVehicles() {
    for (const v of [...this.vehicles]) this.removeVehicle(v);
    this.player = null;
  }

  setPlayer(v) {
    if (this.player && this.player !== v) {
      this.audio.removeVehicleVoice(this.player);
      if (!this.player.ai) this.player.driverless = true;
    }
    this.player = v;
    v.driverless = false;
    v.ai = null;
    v.isPlayerCar = true;
    this.audio.removeVehicleVoice(v);
    if (this.audio.ready) this.audio.createVehicleVoice(v, false);
    if (!v.visual.hasSpots) v.visual.enableHeadlights(true);
    this.cam.snap(v);
    if (this.cam.mode === 'free' && this.state === 'play') this.cam.setMode('chase');
  }

  swapPlayerVehicle() {
    const old = this.player;
    if (!old) return;
    const c = old.body.com;
    const yaw = old.yaw;
    this.removeVehicle(old);
    const sel = this.selectedVehicle();
    const v = this.spawnVehicle(sel.id, sel.cfg, c[0], c[2], yaw, { player: true });
    this.setPlayer(v);
    if (this.mode && this.mode.racers) this.mode.racers[0].v = v;
  }

  teleportPlayer(x, z, yaw) {
    if (!this.player) return;
    this.player.resetTo(x, this.groundAt(x, z), z, yaw);
    this.cam.snap(this.player);
  }

  repairAll() { for (const v of this.vehicles) v.repair(); }

  // ---------------- modes ----------------
  endMode() {
    if (this.mode) this.mode.end();
    this.mode = null;
    this.clearVehicles();
    this.removeEditorLayer();
    this.menu.showSandboxPanel(false);
    this.world.timeScale = 1;
    this.world.gravity = -9.81;
    this.world.paused = false;
    this.resetWorldObjects();
  }

  startMode(id, opts = {}) {
    this.menu.clear();
    this.menu.closeResults();
    this.endMode();
    this.state = 'play';
    this.modeId = id;
    this.modeOpts = opts;
    this.setTimeOfDay(this.settings.timeOfDay);
    this.cam.setMode('chase');
    this.mode = new MODES[id](this, opts);
    this.mode.start();
    this.modeName = this.mode.name;
    this.hud.show(true);
    this.audio.init();
  }

  restartMode() {
    this.menu.closeResults();
    if (this.modeId === 'editorTest') return this.startEditorTest(this.editorScene);
    this.startMode(this.modeId, this.modeOpts);
  }

  setPaused(p) {
    this.paused = p;
    if (p) this.audio.suspend(); else this.audio.resume();
  }

  enterMenu() {
    if (this.state !== 'menu') {
      this.editor.close();
      this.endMode();
      this.state = 'menu';
      this.modeId = null;
      this.hud.show(false);
      this.setTimeOfDay(this.settings.timeOfDay);
      this.refreshShowcase();
    }
    this.paused = false;
  }

  refreshShowcase() {
    if (this.state !== 'menu') return;
    if (this.showcase) this.removeVehicle(this.showcase);
    const sel = this.selectedVehicle();
    const x = -150, z = 752;
    this.showcase = this.spawnVehicle(sel.id, sel.cfg, x, z, 2.2, {});
    this.showcase.driverless = true;
    this.showT = this.showT || 0;
  }

  recolorShowcase(c) {
    if (this.showcase) this.showcase.visual.setColor(c);
  }

  // ---------------- editor ----------------
  openEditor() {
    this.menu.clear();
    this.endMode();
    this.state = 'editor';
    this.modeId = null;
    this.hud.show(false);
    this.setTimeOfDay(this.settings.timeOfDay);
    this.editor.open();
  }

  removeEditorLayer() {
    const L = this.editorLayer;
    if (!L) return;
    for (const id of L.ids) this.statics.remove(id);
    this.scene.remove(L.group);
    this.editorLayer = null;
  }

  startEditorTest(scene) {
    this.editor.close();
    this.endMode();
    this.editorScene = scene;
    this.state = 'play';
    this.modeId = 'editorTest';
    const L = { ids: [], group: new THREE.Group() };
    const mats = this.worldVisual.structureMaterials();
    let spawn = null;
    for (const o of scene.objects) {
      if (o.type === 'spawn') { spawn = o; continue; }
      const ex = expandObject(o, this.map.T);
      for (const s of ex.structures) {
        if (s.kind === 'pole') L.ids.push(this.statics.addCylinder({ x: s.x, z: s.z, y0: s.y0, y1: s.y1, r: s.r, surface: SURF.METAL }));
        else L.ids.push(this.statics.addBox({ x: s.x, y: s.y, z: s.z, hx: s.hx, hy: s.hy, hz: s.hz, yaw: s.yaw || 0, pitch: s.pitch || 0, roll: s.roll || 0, surface: s.kind === 'wood' ? SURF.WOOD : s.kind === 'dirt' ? SURF.DIRT : s.kind === 'metal' ? SURF.METAL : SURF.CONCRETE, friction: s.kind === 'tirewall' ? 0.9 : 0.6, userData: s }));
        const m = new THREE.Mesh(this.worldVisual.structureGeometry(s), mats[s.kind] || mats.concrete);
        m.castShadow = m.receiveShadow = true;
        L.group.add(m);
      }
      for (const p of ex.props) this.dynamics.spawnProp(p.type, p.x, null, p.z, p.yaw, { yOff: p.yOff });
    }
    this.scene.add(L.group);
    this.editorLayer = L;
    const camPos = this.editor.game.cam.free.pos;
    const sp = spawn ? { x: spawn.x, z: spawn.z, yaw: spawn.yaw } : { x: camPos.x, z: camPos.z, yaw: this.cam.free.yaw };
    const game = this;
    this.mode = {
      name: 'Тест сцены «' + (scene.name || '') + '»',
      start() {},
      update() { game.hud.setInfo(''); },
      respawn() { game.player.resetTo(sp.x, game.groundAt(sp.x, sp.z), sp.z, sp.yaw); },
      end() {},
      target() { return null; },
    };
    this.modeName = this.mode.name;
    const sel = this.selectedVehicle();
    const v = this.spawnVehicle(sel.id, sel.cfg, sp.x, sp.z, sp.yaw, { player: true });
    this.setPlayer(v);
    this.cam.setMode('chase');
    this.hud.show(true);
    this.hud.message('Тест-драйв сцены<br><small>Esc → «Вернуться в редактор»</small>', 3);
  }

  backToEditor() {
    this.endMode();
    this.state = 'editor';
    this.modeId = null;
    this.hud.show(false);
    this.editor.open();
  }

  // ---------------- sandbox ----------------
  spawnPointAhead(dist = 12) {
    const p = this.player;
    const R = p.body.R, c = p.body.com;
    return { x: c[0] + R[2] * dist, z: c[2] + R[8] * dist, yaw: p.yaw };
  }

  sandboxSpawnVehicle(id, aiMode) {
    if (!this.player) return;
    const s = this.spawnPointAhead(14);
    const color = VEHICLES[id].police ? VEHICLES[id].color : ['#c9c9cc', '#7a1f1f', '#2c3e50', '#f2c400', '#1f7a3a'][Math.floor(Math.random() * 5)];
    const v = this.spawnVehicle(id, { color }, s.x, s.z, s.yaw + (aiMode === 'parked' ? Math.PI / 2 : Math.PI), {});
    v.sandbox = true;
    if (aiMode === 'parked') v.driverless = true;
    else if (aiMode === 'drive') {
      const P = makePath(this.map.ring.pts, { closed: true, offset: 4.6, speedLimit: 30, mu: 0.8 });
      v.ai = new AIDriver(v, { role: 'traffic', path: P, maxSpeed: 28 });
    } else {
      v.ai = new AIDriver(v, { role: 'police', target: this.player, maxSpeed: aiMode === 'ram' ? 60 : 30, aggro: aiMode === 'ram' ? 1.6 : 0.8 });
      if (v.def.police) v.sirenOn = true;
    }
  }

  sandboxSpawnProp(type) {
    if (!this.player) return;
    const s = this.spawnPointAhead(9 + Math.random() * 3);
    this.dynamics.spawnProp(type, s.x + (Math.random() - 0.5) * 2, null, s.z + (Math.random() - 0.5) * 2, s.yaw, { awake: true, yOff: 0.3 });
  }

  sandboxClear() {
    for (const v of [...this.vehicles]) if (v !== this.player) this.removeVehicle(v);
    this.dynamics.clear(['debris', 'wheel']);
    for (const it of [...this.dynamics.items]) if (it.kind === 'prop' && !it.persistent) this.dynamics.remove(it);
  }

  switchVehicle() {
    if (this.vehicles.length < 2 || !this.player) return;
    const i = this.vehicles.indexOf(this.player);
    const next = this.vehicles[(i + 1) % this.vehicles.length];
    const old = this.player;
    old.input.throttle = 0; old.input.steerDirect = 0;
    this.setPlayer(next);
    old.driverless = true;
    this.hud.message('Вы управляете: ' + next.def.name, 1.5);
  }

  // Debug/test helper: advance the game by `seconds` with fixed 60 Hz steps without rendering.
  simulate(seconds, keys = []) {
    for (const k of keys) this.input.down.add(k);
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) {
      this.input.pollPad();
      if (this.state === 'play') this.updatePlay(1 / 60);
      else if (this.state === 'menu') this.updateMenu(1 / 60);
      this.input.endFrame();
    }
    for (const k of keys) this.input.down.delete(k);
    const p = this.player;
    return p ? { kmh: Math.round(p.fwdSpeed * 3.6), gear: p.gear, rpm: Math.round(p.rpm), dmg: Math.round(p.damage.total * 100), pos: p.body.com.map((x) => Math.round(x)) } : null;
  }

  // ---------------- per-frame ----------------
  frame(t) {
    const dt = Math.min(0.05, Math.max(0.0005, (t - this.last) / 1000));
    this.last = t;
    this.input.pollPad();
    if (this.state === 'play') this.updatePlay(dt);
    else if (this.state === 'menu') this.updateMenu(dt);
    else if (this.state === 'editor') this.updateEditor(dt);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  updateMenu(dt) {
    this.world.step(dt);
    for (const v of this.vehicles) v.visual.update(dt, []);
    this.dynamics.update(dt);
    this.showT = (this.showT || 0) + dt;
    if (this.showcase) {
      const c = this.showcase.body.com;
      const a = this.showT * 0.18;
      const L = this.showcase.shape.length;
      const d = L * 1.45 + 3.2;
      this.camera.position.set(c[0] + Math.sin(a) * d, c[1] + 1.2 + L * 0.12, c[2] + Math.cos(a) * d);
      // look slightly left of the car so it sits right of the menu column
      const rx = Math.cos(a), rz = -Math.sin(a);
      const off = this.menu.screen && this.menu.screen.classList.contains('garage-panel') ? -0.2 : L * 0.1 + 0.3;
      this.camera.lookAt(c[0] - rx * off, c[1] + 0.1, c[2] - rz * off);
      if (this.camera.fov !== 50) { this.camera.fov = 50; this.camera.updateProjectionMatrix(); }
      this.env.update(new THREE.Vector3(c[0], c[1], c[2]));
    }
    this.particles.update(dt, this.map.T);
  }

  updateEditor(dt) {
    this.cam.update(dt, null, this.input, true);
    this.editor.update(dt, this.input);
    this.env.update(this.camera.position);
    if (this.input.keyPressed('F1')) this.menu.toggleHelpOverlay();
  }

  handleActions() {
    const I = this.input, p = this.player;
    if (I.pressed('pause')) {
      if (this.menu.helpEl) this.menu.toggleHelpOverlay();
      else if (this.menu.modal) this.menu.closeResults();
      else if (this.paused) { this.menu.clear(); this.setPaused(false); }
      else this.menu.openPause();
      return;
    }
    if (this.paused || this.menu.modal) return;
    if (I.pressed('help')) this.menu.toggleHelpOverlay();
    if (I.pressed('fps')) { this.hud.showFps = !this.hud.showFps; this.settings.showFps = this.hud.showFps; this.saveSettings(); }
    if (I.pressed('camera')) { const m = this.cam.mode === 'free' ? (this.cam.setMode('chase'), 'chase') : this.cam.next(); this.hud.message('Камера: ' + CAM_NAMES[m], 1); }
    if (I.pressed('freeCam')) {
      if (this.cam.mode === 'free') this.cam.setMode('chase');
      else { this.cam.startFree(this.camera); this.hud.message('Свободная камера: ПКМ+мышь, WASD, Q/E (машина не управляется)', 2.5); }
    }
    if (I.pressed('slowmo')) { this.world.timeScale = this.world.timeScale < 1 ? 1 : 0.25; this.hud.message(this.world.timeScale < 1 ? 'Замедление ×0.25' : 'Нормальная скорость', 1); }
    if (I.pressed('map') && (this.modeId === 'free' || this.modeId === 'sandbox' || this.modeId === 'editorTest')) { this.setPaused(true); this.menu.openMap(); }
    if (I.pressed('switchCar') && (this.modeId === 'sandbox' || this.modeId === 'free')) this.switchVehicle();
    if (!p) return;
    if (I.pressed('repair')) { p.repair(); this.hud.message('Автомобиль восстановлен', 1.2); }
    if (I.pressed('reset')) { this.mode && this.mode.respawn(); this.cam.snap(this.player); }
    if (I.pressed('lights')) { p.lightsOn = !p.lightsOn; }
    if (I.pressed('shiftUp')) { if (p.auto) { p.auto = false; this.hud.message('Ручная коробка', 1); } p.input.shiftUp = true; }
    if (I.pressed('shiftDown')) { if (p.auto) { p.auto = false; this.hud.message('Ручная коробка', 1); } p.input.shiftDown = true; }
    if (I.pressed('gearMode')) { p.auto = !p.auto; if (p.auto && p.gear <= 0) p.gear = 1; this.hud.message(p.auto ? 'Автомат' : 'Механика (Q/E)', 1); }
    if (I.pressed('doors')) p.visual.toggle('doors');
    if (I.pressed('hood')) p.visual.toggle('hood');
    if (I.pressed('trunk')) p.visual.toggle('trunk');
    if (I.pressed('hazard')) p.hazard = !p.hazard;
    if (I.pressed('abs')) { p.cfg.abs = !p.cfg.abs; this.hud.message('ABS ' + (p.cfg.abs ? 'вкл' : 'выкл'), 1); }
    if (I.pressed('tcs')) { p.cfg.tcs = !p.cfg.tcs; this.hud.message('Антипробуксовка ' + (p.cfg.tcs ? 'вкл' : 'выкл'), 1); }
    if (I.pressed('siren') && p.def.police) { p.sirenOn = !p.sirenOn; this.audio.siren(p, p.sirenOn); }
  }

  updatePlay(dt) {
    this.handleActions();
    if (this.paused) return;
    const p = this.player;
    const freeCam = this.cam.mode === 'free';
    if (p && !p.playerOverride) {
      const d = this.menu.modal || freeCam ? { throttle: 0, brake: 0, steer: 0, handbrake: 0, steerDirect: null, horn: false } : this.input.drive(dt);
      p.input.throttle = d.throttle;
      p.input.brake = d.brake;
      p.input.steer = d.steer;
      p.input.steerDirect = d.steerDirect;
      p.input.handbrake = d.handbrake;
      if (d.horn !== !!p.hornOn) { p.hornOn = d.horn; this.audio.horn(p, d.horn); }
    }
    for (const v of this.vehicles) {
      if (v.ai && !v.frozen) v.ai.update(dt, this);
      if (v.frozen) { v.input.throttle = 0; v.input.brake = 1; v.input.handbrake = 1; v.input.steerDirect = 0; }
      if (v.sirenOn && this.audio.ready && this.audio.voices.has(v) && !this.audio.voices.get(v).siren) this.audio.siren(v, true);
    }
    if (this.mode) this.mode.update(dt);
    this.world.step(dt);
    this.postPhysics(dt);
    if (freeCam) this.cam.updateFree(dt, this.input);
    else this.cam.update(dt, p, this.input, this.canvasMouse && !this.menu.modal);
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    this.audio.setListener(this.camera.position, f);
    this.env.update(p ? new THREE.Vector3(p.body.com[0], p.body.com[1], p.body.com[2]) : this.camera.position);
    this.hud.update(dt, this);
  }

  postPhysics(dt) {
    const ts = this.world.timeScale * (this.world.paused ? 0 : 1);
    const simDt = dt * ts;
    this.manageVoices();
    for (const v of this.vehicles) {
      v.visual.lightsOn = v.lightsOn;
      const vevents = [];
      v.visual.update(dt, vevents);
      for (const e of v.events) vevents.push(e);
      v.events.length = 0;
      this.handleEvents(v, vevents);
      if (simDt > 0) this.vehicleFx(v, simDt);
    }
    // impacts of props / debris
    this.dynamics.forEachAwake((it) => {
      const im = it.body.impact;
      if (im.speed > 3) this.audio.impact(im.speed * (it.body.totalMass > 200 ? 0.8 : 0.45), [im.x, im.y, im.z], it.kind !== 'prop');
    });
    this.dynamics.update(dt);
    this.particles.update(simDt, this.map.T);
    this.skidmarks.update();
  }

  manageVoices() {
    if (!this.audio.ready) return;
    const cam = this.camera.position;
    const others = this.vehicles.filter((v) => v !== this.player).map((v) => [v, Math.hypot(v.body.com[0] - cam.x, v.body.com[2] - cam.z)]).sort((a, b) => a[1] - b[1]);
    others.forEach(([v, d], i) => {
      const want = i < 4 && d < 220;
      const has = this.audio.voices.has(v);
      if (want && !has) this.audio.createVehicleVoice(v, true);
      else if (!want && has) this.audio.removeVehicleVoice(v);
    });
    if (this.player && !this.audio.voices.has(this.player)) this.audio.createVehicleVoice(this.player, false);
  }

  handleEvents(v, events) {
    const isP = v === this.player;
    for (const e of events) {
      switch (e.type) {
        case 'wheelOff': {
          const w = e.wheel;
          this.dynamics.spawnWheel(v, w);
          this.particles.sparks(w.center[0], w.center[1], w.center[2], v.body.comVel[0], 1, v.body.comVel[2], 25);
          this.audio.impact(12, w.center, true);
          if (isP) this.hud.message('Колесо оторвано!', 1.5, 'warn');
          break;
        }
        case 'partOff': {
          if (e.part.detached) break;
          const info = v.visual.detachPart(e.part);
          this.dynamics.spawnPart(info, v.body);
          const c = v.body.com;
          this.audio.impact(8, c, true);
          break;
        }
        case 'glassBreak':
        case 'glassCrack':
        case 'lightBreak': {
          const geo = e.entry.mesh.geometry;
          geo.computeBoundingSphere();
          const s = geo.boundingSphere.center;
          const wp = new THREE.Vector3(s.x, s.y, s.z).applyMatrix4(v.visual.root.matrix);
          const vel = v.body.comVel;
          if (e.type === 'glassBreak') { this.particles.glass(wp.x, wp.y, wp.z, vel[0], vel[1] + 1, vel[2], 70); this.audio.glass([wp.x, wp.y, wp.z]); }
          else if (e.type === 'lightBreak') { this.particles.glass(wp.x, wp.y, wp.z, vel[0], vel[1], vel[2], 14); this.audio.glass([wp.x, wp.y, wp.z]); }
          else this.audio.glass([wp.x, wp.y, wp.z]);
          break;
        }
        case 'engineDead':
          if (isP) this.hud.message('Двигатель уничтожен', 2, 'warn');
          break;
        case 'shift':
          if (isP) this.audio.shift();
          break;
        case 'blowoff':
          if (isP) this.audio.blowoff(e.amount);
          break;
        case 'repair':
          v.visual.repair();
          for (let i = 0; i < v.wheels.length; i++) this.skidmarks.break(v.body.id * 10 + i);
          break;
      }
    }
  }

  vehicleFx(v, dt) {
    const b = v.body;
    const pf = this.particles;
    const rate = dt * 60;
    let squeal = 0, loose = 0, onRoad = 0;
    const speed = v.speed;
    for (let i = 0; i < v.wheels.length; i++) {
      const w = v.wheels[i];
      const key = b.id * 10 + i;
      if (!w.contact || w.detached) { this.skidmarks.break(key); continue; }
      const cp = w.contactPoint;
      const hard = HARD.has(w.surface), isLoose = LOOSE.has(w.surface);
      const slip = w.slip;
      const sl = Math.hypot(w.hz, w.hx) || 1;
      const side = [w.hz / sl, 0, -w.hx / sl];
      if (hard) {
        onRoad++;
        const s = clamp((slip - 2.2) / 7, 0, 1);
        squeal = Math.max(squeal, s * clamp(w.load / w.staticLoad, 0.3, 1.5));
        if (s > 0.05) this.skidmarks.add(key, cp, side, w.width * 0.45, 0.12 + s * 0.5, [0.04, 0.04, 0.045]);
        else this.skidmarks.add(key, cp, side, 0, 0, null);
        if (slip > 5) pf.tyreSmoke(cp[0], cp[1], cp[2], b.comVel[0], b.comVel[2], clamp((slip - 5) / 10, 0, 1) * rate * 0.9);
      } else if (isLoose) {
        loose = Math.max(loose, 1);
        const col = DUST_COLORS[[0, 0, 2, 3, 0, 0, 4, 0, 0, 5][w.surface] || 1] || DUST_COLORS[1];
        const amt = clamp(speed / 25 + slip / 8, 0, 1.2) * (w.surface === SURF.GRASS ? 0.45 : 1);
        pf.dust(cp[0], cp[1], cp[2], b.comVel[0], b.comVel[2], amt * rate * 0.3, col);
        if (slip > 1.5 || speed > 3) this.skidmarks.add(key, cp, side, w.width * 0.45, clamp(0.08 + slip * 0.04, 0, 0.35), w.surface === SURF.SNOW ? [0.75, 0.78, 0.82] : [0.18, 0.13, 0.08]);
        else this.skidmarks.add(key, cp, side, 0, 0, null);
      }
    }
    // scraping body
    const sc = b.scrape;
    let scrape = 0;
    if (sc.amount > 0) {
      scrape = clamp(sc.amount * 12, 0, 1.5);
      if ((HARD.has(sc.surface) || sc.surface === 8) && sc.speed > 3) {
        if (Math.random() < scrape * rate) pf.sparks(sc.x, sc.y, sc.z, b.comVel[0] * 0.8, 0.5, b.comVel[2] * 0.8, 3 + scrape * 6);
      } else if (LOOSE.has(sc.surface)) pf.dust(sc.x, sc.y, sc.z, b.comVel[0], b.comVel[2], scrape * rate, DUST_COLORS[2]);
    }
    // impacts
    const im = b.impact;
    if (im.speed > 2) {
      const metal = im.surface === 8 || im.surface === SURF.METAL || im.surface === SURF.CONCRETE || im.surface === SURF.ASPHALT;
      this.audio.impact(im.speed, [im.x, im.y, im.z], im.surface !== SURF.WOOD && im.surface !== SURF.GRASS && im.surface !== SURF.DIRT);
      if (im.speed > 5 && metal) pf.sparks(im.x, im.y, im.z, b.comVel[0] * 0.5, 1, b.comVel[2] * 0.5, Math.min(40, im.speed * 2));
      if (im.speed > 10) pf.debrisBits(im.x, im.y, im.z, b.comVel[0], 1, b.comVel[2], Math.min(30, im.speed));
      if (v === this.player) this.cam.addShake(Math.min(1, im.speed / 18));
      if (LOOSE.has(im.surface)) for (let k = 0; k < 6; k++) pf.dust(im.x, im.y, im.z, b.comVel[0], b.comVel[2], 1, DUST_COLORS[2]);
    }
    // engine smoke / fire
    if (v.engineDamage > 0.2 || !v.engineAlive) {
      const p = b.toWorld(0, v.shape.top(v.shape.zFA + 0.2) + 0.05, v.lattice.engineZ, [0, 0, 0]);
      pf.engineSmoke(p[0], p[1], p[2], b.comVel[0], b.comVel[2], !v.engineAlive || v.engineDamage > 0.6, clamp(v.engineDamage, 0.2, 1) * rate * 0.5);
      if (!v.engineAlive && v.damage.engine > 0.95) pf.fire(p[0], p[1], p[2], 0.5 * rate);
    }
    // exhaust
    if (v.engineAlive && !v.electric && speed < 8) {
      const ep = b.toWorld(-0.45, v.shape.bottom(v.shape.zRear + 0.2) + 0.06, v.shape.zRear - 0.05, [0, 0, 0]);
      pf.exhaust(ep[0], ep[1], ep[2], -b.R[2] * 2, -b.R[8] * 2, (0.08 + v.controls.throttle * 0.5) * rate);
    }
    // water
    if (b.waterImmersion > 0.05 && speed > 2) pf.splash(b.com[0], b.com[1], b.com[2], b.comVel[0], b.comVel[2], Math.min(6, speed * 0.4) * rate);
    // audio
    if (this.audio.ready && this.audio.voices.has(v)) {
      this.audio.updateVehicle(v, { squeal: clamp(squeal, 0, 1.2), speed, loose, onRoad: onRoad > 0, scrape, water: b.waterImmersion > 0.05 ? clamp(speed / 6, 0, 1) : 0, volume: 1 });
    }
  }
}

const game = new Game();
game.init().catch((e) => {
  console.error(e);
  const el = document.getElementById('loading');
  if (el) el.querySelector('.load-text').textContent = 'Ошибка: ' + e.message;
});
