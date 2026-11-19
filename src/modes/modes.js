// Game modes. Each mode sets up vehicles/AI, drives objectives and the mode HUD.
import * as THREE from 'three';
import { AIDriver, makePath, nearestIndex } from '../ai/driver.js';
import { VEHICLES } from '../vehicle/defs.js';
import { clamp, wrapAngle } from '../core/math.js';

export const fmtTime = (t) => {
  if (!isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
};

// ---------- checkpoint gate markers ----------
export class GateMarkers {
  constructor(scene, terrain, gates) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = [];
    const postGeo = new THREE.CylinderGeometry(0.18, 0.18, 6, 8);
    for (const g of gates) {
      const mat = new THREE.MeshStandardMaterial({ color: '#ffd000', emissive: '#ffb000', emissiveIntensity: 0.6, transparent: true, opacity: 0.85 });
      const grp = new THREE.Group();
      const y = terrain.heightAt(g.x, g.z);
      for (const s of [-1, 1]) {
        const p = new THREE.Mesh(postGeo, mat);
        p.position.set(g.x + Math.cos(g.yaw) * s * (g.w / 2), y + 3, g.z - Math.sin(g.yaw) * s * (g.w / 2));
        grp.add(p);
      }
      const banner = new THREE.Mesh(new THREE.BoxGeometry(g.w, 0.7, 0.1), mat);
      banner.position.set(g.x, y + 5.8, g.z);
      banner.rotation.y = g.yaw;
      grp.add(banner);
      this.group.add(grp);
      this.items.push({ grp, mat });
    }
  }
  setActive(i) {
    this.items.forEach((it, k) => {
      it.grp.visible = k === i || k === i + 1;
      it.mat.opacity = k === i ? 0.9 : 0.25;
      it.mat.emissiveIntensity = k === i ? 1.2 : 0.2;
    });
  }
  dispose() {
    this.scene.remove(this.group);
  }
}

function gatePassed(g, x, z, px, pz) {
  // crossing the gate line segment between previous and current position
  const fx = Math.sin(g.yaw), fz = Math.cos(g.yaw);
  const s0 = (px - g.x) * fx + (pz - g.z) * fz;
  const s1 = (x - g.x) * fx + (z - g.z) * fz;
  const lat = Math.abs((x - g.x) * fz - (z - g.z) * fx);
  if (s0 <= 0 && s1 > 0 && lat < g.w / 2 + 1.5) return true;
  return Math.hypot(x - g.x, z - g.z) < Math.min(5, g.w / 2);
}

class Mode {
  constructor(game, opts = {}) {
    this.game = game;
    this.opts = opts;
    this.name = '';
    this.time = 0;
  }
  start() {}
  update() {}
  target() { return null; }
  respawn() {}
  end() {}
  spawnPlayer(x, z, yaw) {
    const g = this.game;
    const sel = g.selectedVehicle();
    const v = g.spawnVehicle(sel.id, sel.cfg, x, z, yaw, { player: true });
    g.setPlayer(v);
    return v;
  }
}

// ---------------- free roam ----------------
export class FreeRoam extends Mode {
  constructor(game, opts) {
    super(game, opts);
    this.name = 'Свободная езда';
  }
  start() {
    const g = this.game;
    const sp = g.map.spawns[this.opts.spawn || 'city'] || g.map.spawns.city;
    this.spawn = sp;
    this.spawnPlayer(sp.x, sp.z, sp.yaw);
    const n = this.opts.traffic ?? 4;
    if (n > 0) spawnTraffic(g, n);
    g.hud.message(this.name + '<br><small>' + sp.name + '</small>', 3);
  }
  respawn() {
    const sp = this.spawn;
    this.game.player.resetTo(sp.x, this.game.map.T.heightAt(sp.x, sp.z), sp.z, sp.yaw);
  }
  update() {
    this.game.hud.setInfo('');
  }
}

export function spawnTraffic(g, n) {
  const ring = g.map.ring;
  const ids = ['sedan', 'hatch', 'suv', 'pickup', 'sedan', 'hatch', 'truck', 'sport'];
  const paths = [makePath(ring.pts, { closed: true, offset: 4.6, speedLimit: 24, mu: 0.6 }), makePath(ring.pts, { closed: true, offset: 4.6, reverse: true, speedLimit: 24, mu: 0.6 })];
  const p = g.player ? g.player.body.com : [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const path = paths[i % 2];
    // distribute along the path, away from the player
    let idx = Math.floor(((i + 0.5) / n) * path.n);
    for (let k = 0; k < 20; k++) {
      const q = path.pts[idx];
      if (Math.hypot(q[0] - p[0], q[1] - p[2]) > 60) break;
      idx = (idx + 37) % path.n;
    }
    const a = path.pts[idx], b = path.pts[(idx + 1) % path.n];
    const id = ids[i % ids.length];
    const cfg = { color: ['#c9c9cc', '#e8e8e8', '#1a1a1a', '#7a1f1f', '#2c3e50', '#d4b483', '#0f3d91'][i % 7] };
    const v = g.spawnVehicle(id, cfg, a[0], a[1], Math.atan2(b[0] - a[0], b[1] - a[1]), { ai: true });
    v.ai = new AIDriver(v, { role: 'traffic', path, skill: 0.75 + Math.random() * 0.15, maxSpeed: 22 + Math.random() * 6 });
    v.ai.idx = idx;
    v.lightsOn = g.env.night > 0.4;
  }
}

// ---------------- crash test ----------------
export const CRASH_SCENARIOS = {
  wall50: { name: 'Стена — 50 км/ч', x: -500, z: -120, yaw: Math.PI, speed: 50, focus: [-500, -295] },
  wall80: { name: 'Стена — 80 км/ч', x: -500, z: -100, yaw: Math.PI, speed: 80, focus: [-500, -295] },
  wall130: { name: 'Стена — 130 км/ч', x: -500, z: -70, yaw: Math.PI, speed: 130, focus: [-500, -295] },
  pole: { name: 'Столб — 60 км/ч', x: -470, z: -120, yaw: Math.PI, speed: 60, focus: [-470, -270] },
  offset: { name: 'Смещённый удар (40%) — 64 км/ч', x: -406.9, z: -110, yaw: Math.PI, speed: 64, focus: [-406, -290], offsetCar: true },
  headon: { name: 'Лобовое: две машины по 60 км/ч', x: -350, z: -80, yaw: Math.PI, speed: 60, other: { x: -350, z: -270, yaw: 0, speed: 60 }, focus: [-350, -175] },
  tbone: { name: 'Удар в бок — 60 км/ч', x: -320, z: -80, yaw: Math.PI, speed: 60, parked: { x: -320, z: -200, yaw: Math.PI / 2 }, focus: [-320, -200] },
  rollover: { name: 'Опрокидывание на трамплине — 75 км/ч', x: -229.2, z: -110, yaw: Math.PI, speed: 75, focus: [-230, -190] },
  jump: { name: 'Прыжок с большой рампы — 105 км/ч', x: -270, z: -62, yaw: Math.PI, speed: 105, focus: [-270, -130], noStop: true },
  loop: { name: 'Мёртвая петля — 92 км/ч', x: -364.25, z: -180, yaw: Math.PI, speed: 92, focus: [-360, -260], noStop: true },
  drop: { name: 'Падение с 25 м', x: -380, z: -160, yaw: Math.PI, speed: 0, drop: 25, focus: [-380, -160] },
  pileup: { name: 'Таран колонны — 90 км/ч', x: -440, z: -60, yaw: Math.PI, speed: 90, row: { x: -440, z0: -170, n: 3 }, focus: [-440, -190] },
};

export class CrashTest extends Mode {
  constructor(game, opts) {
    super(game, opts);
    this.name = 'Краш-тест';
  }
  start() {
    const g = this.game;
    const sc = CRASH_SCENARIOS[this.opts.scenario || 'wall50'];
    this.sc = sc;
    this.name = 'Краш-тест: ' + sc.name;
    const y = g.map.T.heightAt(sc.x, sc.z);
    const v = this.spawnPlayer(sc.x, sc.z, sc.yaw);
    if (sc.drop) {
      v.place(sc.x, y + sc.drop, sc.z, sc.yaw);
      v.body.computeFrame();
    }
    this.others = [];
    if (sc.other) {
      const sel = g.selectedVehicle();
      const o = g.spawnVehicle(this.opts.otherId || sel.id, { color: '#c9c9cc' }, sc.other.x, sc.other.z, sc.other.yaw, { ai: true });
      this.others.push({ v: o, speed: sc.other.speed, x: sc.other.x, z: sc.other.z, yaw: sc.other.yaw });
    }
    if (sc.parked) {
      const o = g.spawnVehicle(this.opts.otherId || 'sedan', { color: '#e8e8e8' }, sc.parked.x, sc.parked.z, sc.parked.yaw, { ai: true });
      o.driverless = true;
    }
    if (sc.row) {
      const ids = ['sedan', 'hatch', 'suv'];
      for (let i = 0; i < sc.row.n; i++) {
        const o = g.spawnVehicle(ids[i % 3], { color: ['#c9c9cc', '#7a1f1f', '#2c3e50'][i] }, sc.row.x, sc.row.z0 - i * 6.5, sc.yaw, { ai: true });
        o.driverless = true;
      }
    }
    this.phase = sc.speed > 0 ? 'launch' : 'drop';
    this.impactT = -1;
    this.impactSpeed = 0;
    this.peakG = 0;
    this.stopT = 0;
    this.resultShown = false;
    v.maxG = 0;
    g.cam.setMode(this.opts.cam || 'chase');
    if (sc.speed > 0) {
      // launch at speed (like a crash-test sled) to keep the run-up short
      const s = sc.speed / 3.6;
      v.body.addVelocity(Math.sin(sc.yaw) * s * 0.85, 0, Math.cos(sc.yaw) * s * 0.85);
      for (const w of v.wheels) w.omega = (s * 0.85) / w.radius;
      for (const o of this.others) {
        o.v.body.addVelocity(Math.sin(o.yaw) * o.speed / 3.6 * 0.85, 0, Math.cos(o.yaw) * o.speed / 3.6 * 0.85);
        for (const w of o.v.wheels) w.omega = (o.speed / 3.6 * 0.85) / w.radius;
      }
    }
    g.hud.message(sc.name, 2.5);
  }
  respawn() {
    this.game.restartMode();
  }
  holdLane(v, speed, x, z, yaw) {
    const c = v.body.com;
    // project ahead on the lane line
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const along = (c[0] - x) * fx + (c[2] - z) * fz;
    const tx = x + fx * (along + 25), tz = z + fz * (along + 25);
    const ai = this._ai || (this._ai = new AIDriver(v, { role: 'none' }));
    ai.v = v;
    const st = ai.steerTo(tx, tz);
    const err = speed / 3.6 - v.fwdSpeed;
    v.input.throttle = clamp(err * 0.6 + 0.2, 0, 1);
    v.input.brake = 0;
    v.input.steerDirect = st.steer;
  }
  update(dt) {
    const g = this.game, v = g.player, sc = this.sc;
    if (!v) return;
    this.time += dt;
    const kmh = Math.abs(v.fwdSpeed) * 3.6;
    if (this.phase === 'launch' || this.phase === 'drop') {
      if (this.phase === 'launch') {
        this.holdLane(v, sc.speed, sc.x, sc.z, sc.yaw);
        for (const o of this.others) this.holdLane(o.v, o.speed, o.x, o.z, o.yaw);
        v.playerOverride = true;
      }
      // auto slow-motion just before impact
      if (g.settings.autoSlowmo && sc.focus && this.phase === 'launch') {
        const d = Math.hypot(v.body.com[0] - sc.focus[0], v.body.com[2] - sc.focus[1]);
        if (d < 14 + kmh * 0.05 && !sc.noStop) g.world.timeScale = 0.25;
      }
      if (v.body.impact.speed > 3 || (this.phase === 'drop' && v.body.impact.speed > 1)) {
        this.phase = 'impact';
        this.impactT = this.time;
        this.impactSpeed = this.phase === 'drop' ? v.speed * 3.6 : Math.max(kmh, this.lastKmh || 0);
        v.maxG = 0;
        v.playerOverride = false;
        v.input.throttle = 0; v.input.steerDirect = null;
        for (const o of this.others) { o.v.input.throttle = 0; o.v.input.steerDirect = null; o.v.driverless = true; }
      }
      this.lastKmh = kmh;
      if (this.phase === 'drop') this.impactSpeedDrop = v.speed * 3.6;
    } else if (this.phase === 'impact') {
      const since = this.time - this.impactT;
      if (since < 1.2) this.peakG = Math.max(this.peakG, v.maxG);
      if (since > 2.0 && g.world.timeScale < 1 && g.settings.autoSlowmo) g.world.timeScale = 1;
      if (Math.abs(v.fwdSpeed) < 0.6) this.stopT += dt; else this.stopT = 0;
      if (!this.resultShown && ((this.stopT > 1.2 && since > 1.5) || since > (sc.noStop ? 6 : 8))) {
        this.resultShown = true;
        this.showResults();
      }
    }
    const lines = [`<b>${sc.name}</b>`];
    if (this.phase === 'launch') lines.push(`Разгон: ${Math.round(kmh)} / ${sc.speed} км/ч`);
    else if (this.phase === 'drop') lines.push('Свободное падение…');
    else lines.push(`Скорость удара: ${Math.round(this.impactSpeed)} км/ч · Пиковая перегрузка: ${this.peakG.toFixed(1)} g · Повреждения: ${Math.round(v.damage.total * 100)}%`);
    g.hud.setInfo(lines.join('<br>'));
  }
  showResults() {
    const g = this.game, v = g.player;
    let maxD = 0;
    if (v.relDisp) for (let i = 0; i < v.body.n; i++) maxD = Math.max(maxD, Math.hypot(v.relDisp[i * 3], v.relDisp[i * 3 + 1], v.relDisp[i * 3 + 2]));
    const lost = v.wheels.filter((w) => w.detached).length;
    const parts = v.visual ? [...v.visual.parts.values()].filter((p) => p.detached).length : 0;
    const glass = v.visual ? v.visual.panels.filter((p) => p.kind === 'glass' && p.broken).length : 0;
    const rating = v.damage.total < 0.15 ? 'Лёгкие повреждения' : v.damage.total < 0.35 ? 'Средние повреждения' : v.damage.total < 0.6 ? 'Тяжёлые повреждения' : 'Тотальное уничтожение';
    g.menu.showResults('Результаты краш-теста', [
      ['Сценарий', this.sc.name],
      ['Автомобиль', v.def.name],
      ['Скорость в момент удара', Math.round(this.impactSpeed || this.impactSpeedDrop || 0) + ' км/ч'],
      ['Пиковая перегрузка', this.peakG.toFixed(1) + ' g'],
      ['Максимальная деформация', (maxD * 100).toFixed(0) + ' см'],
      ['Общие повреждения', Math.round(v.damage.total * 100) + '%  (' + rating + ')'],
      ['Двигатель', v.engineAlive ? Math.round((1 - v.engineDamage) * 100) + '%' : 'уничтожен'],
      ['Оторвано деталей / колёс', parts + ' / ' + lost],
      ['Разбито стёкол', String(glass)],
    ], [
      ['Повторить', () => g.restartMode()],
      ['Другой сценарий', () => g.menu.openCrashMenu()],
      ['Продолжить', () => g.menu.closeResults()],
    ]);
  }
  end() {
    this.game.world.timeScale = 1;
  }
  target() {
    return this.sc && this.sc.focus ? { x: this.sc.focus[0], z: this.sc.focus[1] } : null;
  }
}

// ---------------- race ----------------
export class Race extends Mode {
  constructor(game, opts) {
    super(game, opts);
    this.name = 'Гонка';
  }
  start() {
    const g = this.game;
    const tr = g.map.track;
    this.laps = this.opts.laps || 3;
    const nOpp = this.opts.opponents ?? 3;
    this.path = makePath(tr.pts, { closed: true, mu: 1.05, speedLimit: 75, brake: 7.5 });
    const P = this.path;
    const sel = g.selectedVehicle();
    // grid behind start line
    const slots = [];
    for (let i = 0; i < nOpp + 1; i++) {
      const back = 10 + Math.floor(i / 2) * 9;
      let idx = P.n - Math.round(back / 3);
      idx = ((idx % P.n) + P.n) % P.n;
      const a = P.pts[idx], b = P.pts[(idx + 1) % P.n];
      const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
      const side = i % 2 ? 1 : -1;
      slots.push({ x: a[0] - Math.cos(yaw) * side * 3, z: a[1] + Math.sin(yaw) * side * 3, yaw, idx });
    }
    this.racers = [];
    const playerSlot = slots[nOpp];
    const pv = this.spawnPlayer(playerSlot.x, playerSlot.z, playerSlot.yaw);
    this.racers.push({ v: pv, name: 'Вы', lap: -1, idx: playerSlot.idx, last: playerSlot.idx, progress: 0, finished: -1, lapStart: 0, best: Infinity, sector: 0 });
    const pool = this.opts.mixed ? ['sport', 'sedan', 'hatch', 'police', 'suv'] : [sel.id];
    const names = ['Вихрь', 'Гром', 'Комета', 'Ураган', 'Метеор'];
    const colors = ['#f2c400', '#1f7a3a', '#6b2d8f', '#0aa5c2', '#ff3b8b'];
    for (let i = 0; i < nOpp; i++) {
      const s = slots[i];
      const id = pool[i % pool.length];
      const v = g.spawnVehicle(id, { color: colors[i], engine: id === sel.id ? sel.cfg.engine : undefined, tires: 'sport' }, s.x, s.z, s.yaw, { ai: true });
      v.ai = new AIDriver(v, { role: 'racer', path: P, skill: (this.opts.difficulty ?? 0.92) - i * 0.025 + Math.random() * 0.02, lateral: (i % 2 ? 1.5 : -1.5), maxSpeed: 80 });
      v.ai.idx = s.idx;
      v.ai.lastIdx = s.idx;
      v.ai.enabled = false;
      this.racers.push({ v, name: names[i], lap: -1, idx: s.idx, last: s.idx, progress: 0, finished: -1, lapStart: 0, best: Infinity, ai: true });
    }
    this.countdown = 3.99;
    this.raceTime = 0;
    this.finished = false;
    this.lastBeep = 4;
    for (const r of this.racers) r.v.frozen = true;
  }
  respawn() {
    // put the player back on the track at the nearest point
    const g = this.game, v = g.player, P = this.path;
    const r = this.racers[0];
    const a = P.pts[r.idx], b = P.pts[(r.idx + 2) % P.n];
    v.resetTo(a[0], g.map.T.heightAt(a[0], a[1]), a[1], Math.atan2(b[0] - a[0], b[1] - a[1]));
  }
  trackProgress(r) {
    const P = this.path, c = r.v.body.com;
    r.idx = nearestIndex(P, c[0], c[2], r.idx, 30);
    if (r.last > P.n * 0.85 && r.idx < P.n * 0.15) {
      r.lap++;
      const lapT = this.raceTime - r.lapStart;
      if (r.lap >= 1) r.best = Math.min(r.best, lapT);
      r.lapStart = this.raceTime;
      if (r === this.racers[0] && r.lap >= 1 && r.lap <= this.laps) this.game.hud.message(r.lap === this.laps ? 'Финиш!' : `Круг ${r.lap + 1} / ${this.laps}` + (isFinite(r.best) ? `<br><small>Лучший круг ${fmtTime(r.best)}</small>` : ''), 2);
      if (r.lap >= this.laps && r.finished < 0) r.finished = this.raceTime;
    }
    if (r.last < P.n * 0.15 && r.idx > P.n * 0.85) r.lap--;
    r.last = r.idx;
    r.progress = r.lap * P.total + P.dist[r.idx];
  }
  update(dt) {
    const g = this.game;
    if (this.countdown > 0) {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown);
      if (c < this.lastBeep && c > 0) { this.lastBeep = c; g.audio.beep(false); g.hud.message(String(c), 0.9, 'big'); }
      if (this.countdown <= 0) {
        g.audio.beep(true);
        g.hud.message('СТАРТ!', 1.2, 'big');
        for (const r of this.racers) { r.v.frozen = false; if (r.ai) r.v.ai.enabled = true; }
      }
    } else if (!this.finished) this.raceTime += dt;
    for (const r of this.racers) {
      // starting grid sits behind the line: first crossing counts as lap 0 start
      this.trackProgress(r);
    }
    const order = [...this.racers].sort((a, b) => {
      if (a.finished >= 0 && b.finished >= 0) return a.finished - b.finished;
      if (a.finished >= 0) return -1;
      if (b.finished >= 0) return 1;
      return b.progress - a.progress;
    });
    const me = this.racers[0];
    const pos = order.indexOf(me) + 1;
    if (me.finished >= 0 && !this.finished) {
      this.finished = true;
      setTimeout(() => this.showResults(), 2500);
    }
    // AI that finished cruise slowly
    for (const r of this.racers) if (r.ai && r.finished >= 0) r.v.ai.speedFactor = 0.4;
    const lap = clamp(me.lap + 1, 1, this.laps);
    // r.lap is -1 on the grid (behind the line), 0 during the first lap
    g.hud.setInfo(this.countdown > 0 ? '<b>Приготовьтесь…</b>' : `<b>Позиция ${pos} / ${this.racers.length}</b> · Круг ${lap} / ${this.laps}<br>Время ${fmtTime(this.raceTime)} · Круг ${fmtTime(this.raceTime - me.lapStart)} · Лучший ${fmtTime(me.best)}`);
    this.order = order;
  }
  showResults() {
    const g = this.game;
    const rows = this.order.map((r, i) => [`${i + 1}. ${r.name} (${r.v.def.name})`, r.finished >= 0 ? fmtTime(r.finished) + (isFinite(r.best) ? ` · круг ${fmtTime(r.best)}` : '') : 'не финишировал']);
    g.menu.showResults('Итоги гонки', rows, [['Ещё раз', () => g.restartMode()], ['Главное меню', () => g.menu.openMain()], ['Продолжить', () => g.menu.closeResults()]]);
  }
  target() {
    const P = this.path, r = this.racers && this.racers[0];
    if (!r) return null;
    const p = P.pts[(r.idx + 25) % P.n];
    return { x: p[0], z: p[1] };
  }
}

// ---------------- time trial ----------------
export class TimeTrial extends Mode {
  constructor(game, opts) {
    super(game, opts);
    this.name = 'Испытание на время';
  }
  start() {
    const g = this.game;
    const tr = g.map.trials.find((t) => t.id === this.opts.trial) || g.map.trials[0];
    this.trial = tr;
    this.name = 'Заезд: ' + tr.name;
    this.spawnPlayer(tr.start.x, tr.start.z, tr.start.yaw);
    this.markers = new GateMarkers(g.scene, g.map.T, tr.gates);
    this.gi = 0;
    this.markers.setActive(0);
    this.started = false;
    this.t = 0;
    this.done = false;
    this.splits = [];
    this.prev = [tr.start.x, tr.start.z];
    const key = 'cz_best_' + tr.id + '_' + g.selectedVehicle().id;
    this.key = key;
    this.best = parseFloat(localStorage.getItem(key) || 'Infinity');
    this.countdown = 2.99;
    this.lastBeep = 3;
    g.player.frozen = true;
  }
  respawn() {
    const g = this.game;
    const tr = this.trial;
    // back to the last gate passed
    const last = this.gi > 0 ? tr.gates[this.gi - 1] : { x: tr.start.x, z: tr.start.z, yaw: tr.start.yaw };
    g.player.resetTo(last.x, g.map.T.heightAt(last.x, last.z), last.z, last.yaw);
    this.prev = [last.x, last.z];
  }
  update(dt) {
    const g = this.game, v = g.player;
    if (this.countdown > 0) {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown);
      if (c < this.lastBeep && c > 0) { this.lastBeep = c; g.audio.beep(); g.hud.message(String(c), 0.9, 'big'); }
      if (this.countdown <= 0) { g.audio.beep(true); g.hud.message('ВПЕРЁД!', 1, 'big'); v.frozen = false; this.started = true; }
    }
    if (this.started && !this.done) this.t += dt;
    const c = v.body.com;
    const tr = this.trial;
    if (!this.done && this.gi < tr.gates.length) {
      const gt = tr.gates[this.gi];
      if (gatePassed(gt, c[0], c[2], this.prev[0], this.prev[1])) {
        this.splits.push(this.t);
        this.gi++;
        g.audio.beep(this.gi === tr.gates.length);
        if (this.gi >= tr.gates.length) {
          this.done = true;
          this.markers.setActive(-5);
          const rec = this.t < this.best;
          if (rec) { this.best = this.t; localStorage.setItem(this.key, String(this.t)); }
          g.hud.message((rec ? 'НОВЫЙ РЕКОРД!<br>' : 'Финиш!<br>') + fmtTime(this.t), 4, 'big');
          setTimeout(() => g.menu.showResults('Испытание завершено', [['Трасса', tr.name], ['Автомобиль', v.def.name], ['Время', fmtTime(this.t)], ['Рекорд', fmtTime(this.best)], ['Повреждения', Math.round(v.damage.total * 100) + '%']], [['Ещё раз', () => g.restartMode()], ['Главное меню', () => g.menu.openMain()], ['Продолжить', () => g.menu.closeResults()]]), 2000);
        } else {
          this.markers.setActive(this.gi);
          g.hud.message(`Чекпоинт ${this.gi} / ${tr.gates.length}<br><small>${fmtTime(this.t)}</small>`, 1.2);
        }
      }
    }
    this.prev = [c[0], c[2]];
    g.hud.setInfo(`<b>${tr.name}</b><br>Время ${fmtTime(this.t)} · Чекпоинт ${Math.min(this.gi + 1, tr.gates.length)} / ${tr.gates.length} · Рекорд ${fmtTime(this.best)}`);
  }
  target() {
    const g = this.trial && this.trial.gates[this.gi];
    return g ? { x: g.x, z: g.z } : null;
  }
  end() {
    if (this.markers) this.markers.dispose();
  }
}

// ---------------- chase ----------------
export class Chase extends Mode {
  constructor(game, opts) {
    super(game, opts);
    this.variant = opts.variant || 'escape';
    this.name = this.variant === 'escape' ? 'Погоня: уйти от полиции' : 'Погоня: задержать нарушителя';
  }
  start() {
    const g = this.game;
    const ring = g.map.ring;
    const P = makePath(ring.pts, { closed: true, offset: 3, speedLimit: 50, mu: 0.95 });
    this.path = P;
    const i0 = 40;
    const a = P.pts[i0], b = P.pts[i0 + 1];
    const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
    this.cops = [];
    this.time = 0;
    this.limit = this.variant === 'escape' ? 150 : 180;
    this.bustT = 0;
    this.escapeT = 0;
    this.over = false;
    if (this.variant === 'escape') {
      this.spawnPlayer(a[0], a[1], yaw);
      const n = this.opts.cops ?? 3;
      for (let k = 0; k < n; k++) {
        const j = (i0 - 18 - k * 9 + P.n) % P.n;
        const p = P.pts[j], q = P.pts[(j + 1) % P.n];
        const cop = g.spawnVehicle('police', {}, p[0] + (k % 2 ? 2 : -2), p[1], Math.atan2(q[0] - p[0], q[1] - p[1]), { ai: true });
        cop.ai = new AIDriver(cop, { role: 'police', target: g.player, maxSpeed: 58, aggro: 1 + k * 0.15 });
        cop.ai.avoidSide = k % 2 ? 1 : -1;
        cop.sirenOn = true;
        g.audio.siren(cop, true);
        this.cops.push(cop);
      }
      g.hud.message('Уйдите от погони!<br><small>Продержитесь 2:30 или оторвитесь на 350 м</small>', 3.5);
    } else {
      const sel = g.selectedVehicle();
      const j = (i0 - 14 + P.n) % P.n;
      const p = P.pts[j], q = P.pts[(j + 1) % P.n];
      const v = g.spawnVehicle('police', { ...sel.cfg, color: '#1a1a1a', engine: 'v8' }, p[0], p[1], Math.atan2(q[0] - p[0], q[1] - p[1]), { player: true });
      g.setPlayer(v);
      v.sirenOn = true;
      g.audio.siren(v, true);
      const s = g.spawnVehicle(this.opts.suspect || 'sport', { color: '#ff6a00' }, a[0], a[1], yaw, { ai: true });
      s.ai = new AIDriver(s, { role: 'racer', path: P, skill: 0.88, speedFactor: 1, maxSpeed: 46 });
      s.ai.idx = i0;
      this.suspect = s;
      this.stopT = 0;
      g.hud.message('Задержите нарушителя!<br><small>Таранить разрешено</small>', 3.5);
    }
  }
  respawn() {
    const g = this.game, v = g.player;
    const c = v.body.com;
    const P = this.path;
    const i = nearestIndex(P, c[0], c[2]);
    const a = P.pts[i], b = P.pts[(i + 1) % P.n];
    v.resetTo(a[0], g.map.T.heightAt(a[0], a[1]), a[1], Math.atan2(b[0] - a[0], b[1] - a[1]));
  }
  update(dt) {
    const g = this.game, v = g.player;
    if (this.over) return;
    this.time += dt;
    const c = v.body.com;
    if (this.variant === 'escape') {
      let nearest = Infinity;
      for (const cop of this.cops) nearest = Math.min(nearest, Math.hypot(cop.body.com[0] - c[0], cop.body.com[2] - c[2]));
      const slow = Math.abs(v.fwdSpeed) < 2.5;
      if ((slow && nearest < 14) || !v.engineAlive || v.wheels.filter((w) => w.detached).length >= 2) this.bustT += dt; else this.bustT = Math.max(0, this.bustT - dt * 0.5);
      if (nearest > 350) this.escapeT += dt; else this.escapeT = 0;
      const left = this.limit - this.time;
      if (this.bustT > 4) return this.finish(false, 'Вас задержали!');
      if (left <= 0 || this.escapeT > 8) return this.finish(true, this.escapeT > 8 ? 'Вы оторвались от погони!' : 'Вы продержались!');
      g.hud.setInfo(`<b>Уйдите от полиции</b><br>Осталось ${fmtTime(Math.max(0, left))} · Ближайший патруль: ${isFinite(nearest) ? Math.round(nearest) + ' м' : '—'}` + (this.bustT > 0.3 ? `<br><b class="warn">ЗАДЕРЖАНИЕ ${Math.ceil(4 - this.bustT)}…</b>` : '') + (this.escapeT > 0 ? `<br><b class="ok">Отрыв ${Math.ceil(8 - this.escapeT)}…</b>` : ''));
    } else {
      const s = this.suspect;
      const d = Math.hypot(s.body.com[0] - c[0], s.body.com[2] - c[2]);
      const disabled = !s.engineAlive || s.wheels.some((w) => w.detached) || s.damage.total > 0.45;
      if ((Math.abs(s.fwdSpeed) < 2 && d < 25) || disabled) this.stopT += dt; else this.stopT = Math.max(0, this.stopT - dt);
      if (disabled) s.ai.speedFactor = 0.15;
      if (this.stopT > 4) return this.finish(true, 'Нарушитель задержан!');
      if (this.time > this.limit) return this.finish(false, 'Нарушитель скрылся');
      g.hud.setInfo(`<b>Задержите нарушителя</b><br>Дистанция ${Math.round(d)} м · Повреждения нарушителя ${Math.round(s.damage.total * 100)}% · Осталось ${fmtTime(this.limit - this.time)}` + (this.stopT > 0.3 ? `<br><b class="ok">Задержание ${Math.ceil(4 - this.stopT)}…</b>` : ''));
    }
  }
  finish(win, text) {
    const g = this.game;
    this.over = true;
    g.hud.message(text, 3, win ? 'big ok' : 'big warn');
    for (const cop of this.cops) cop.ai.maxSpeed = 5;
    setTimeout(() => g.menu.showResults(win ? 'Победа!' : 'Поражение', [['Режим', this.name], ['Итог', text], ['Время', fmtTime(this.time)], ['Повреждения', Math.round(g.player.damage.total * 100) + '%']], [['Ещё раз', () => g.restartMode()], ['Главное меню', () => g.menu.openMain()], ['Продолжить', () => g.menu.closeResults()]]), 1800);
  }
  target() {
    if (this.variant === 'pursuit' && this.suspect) return { x: this.suspect.body.com[0], z: this.suspect.body.com[2] };
    return null;
  }
}

// ---------------- sandbox ----------------
export class Sandbox extends Mode {
  constructor(game, opts) {
    super(game, opts);
    this.name = 'Песочница';
  }
  start() {
    const g = this.game;
    const sp = g.map.spawns[this.opts.spawn || 'proving'];
    this.spawn = sp;
    this.spawnPlayer(sp.x, sp.z, sp.yaw);
    g.menu.showSandboxPanel(true);
    g.hud.message('Песочница<br><small>Панель слева: техника, объекты, физика</small>', 3);
  }
  respawn() {
    const sp = this.spawn;
    this.game.player.resetTo(sp.x, this.game.map.T.heightAt(sp.x, sp.z), sp.z, sp.yaw);
  }
  update() {
    this.game.hud.setInfo('');
  }
  end() {
    this.game.menu.showSandboxPanel(false);
  }
}

export const MODES = { free: FreeRoam, crash: CrashTest, race: Race, trial: TimeTrial, chase: Chase, sandbox: Sandbox };
