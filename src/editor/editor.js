// Scene editor: place ramps, blocks, walls, poles, loops and props, save scenes, test-drive them.
import * as THREE from 'three';
import { PROP_DEFS } from '../world/dynamics.js';
import { teardropLoop } from '../core/math.js';

export const EDITOR_TYPES = {
  ramp: { name: 'Трамплин', params: { len: [12, 3, 40, 0.5], height: [2.5, 0.3, 10, 0.1], width: [6, 2, 16, 0.5] }, mat: 'wood' },
  kicker: { name: 'Кикер (крутой)', params: { len: [5, 2, 12, 0.5], height: [2, 0.5, 6, 0.1], width: [4, 2, 12, 0.5] }, mat: 'metal' },
  landing: { name: 'Посадочная горка', params: { len: [18, 6, 40, 0.5], height: [3, 0.5, 10, 0.1], width: [7, 3, 16, 0.5] }, mat: 'wood' },
  box: { name: 'Бетонный блок', params: { sx: [2, 0.4, 20, 0.2], sy: [1, 0.3, 10, 0.1], sz: [2, 0.4, 20, 0.2], raise: [0, 0, 15, 0.1] }, mat: 'concrete' },
  wall: { name: 'Стена', params: { len: [16, 2, 60, 1], height: [2.5, 0.5, 8, 0.1], thick: [1, 0.3, 4, 0.1] }, mat: 'concrete' },
  pole: { name: 'Столб', params: { r: [0.18, 0.08, 1, 0.02], height: [6, 1, 20, 0.5] }, mat: 'pole' },
  platform: { name: 'Платформа', params: { sx: [8, 2, 30, 0.5], sz: [10, 2, 40, 0.5], height: [3, 0.5, 15, 0.1] }, mat: 'metal' },
  bump: { name: 'Лежачий полицейский', params: { width: [8, 2, 16, 0.5], height: [0.15, 0.05, 0.5, 0.01] }, mat: 'hazard' },
  quarter: { name: 'Четверть-трубы', params: { radius: [8, 3, 20, 0.5], width: [8, 3, 16, 0.5] }, mat: 'metal' },
  loop: { name: 'Мёртвая петля', params: { radius: [10, 6, 18, 0.5], width: [7, 4, 12, 0.5] }, mat: 'metal' },
  tirewall: { name: 'Стена из шин', params: { len: [12, 2, 40, 1] }, mat: 'tirewall' },
  spawn: { name: 'Точка старта', params: {}, mat: null },
};
for (const [k, d] of Object.entries(PROP_DEFS)) EDITOR_TYPES['prop_' + k] = { name: d.name + ' (подвижный)', params: {}, prop: k };

const MATS = ['wood', 'metal', 'concrete', 'dirt', 'hazard', 'tirewall', 'barrier'];

// Expand an editor object into static structures (same format as map.structures) and dynamic props
export function expandObject(o, terrain) {
  const p = o.params || {};
  const T = EDITOR_TYPES[o.type];
  const mat = o.mat || T.mat;
  const g = terrain.heightAt(o.x, o.z) + (o.dy || 0);
  const out = { structures: [], props: [] };
  const S = (s) => out.structures.push(s);
  const fx = Math.sin(o.yaw), fz = Math.cos(o.yaw);
  const ramp = (len, height, width, x0, z0, base, dir = 1) => {
    const ang = Math.atan2(height, len);
    const L = Math.hypot(len, height);
    const th = 0.5;
    const cx = x0 + fx * (len / 2) * dir, cz = z0 + fz * (len / 2) * dir;
    S({ kind: mat, ramp: true, x: cx, z: cz, y: base + height / 2 - (th / 2) * Math.cos(ang), hx: width / 2, hy: th / 2, hz: L / 2, yaw: o.yaw, pitch: -ang * dir });
    if (height > 0.7) {
      const ex = x0 + fx * (len - 0.35) * dir, ez = z0 + fz * (len - 0.35) * dir;
      S({ kind: mat, x: ex, z: ez, y: base + height / 2 - 0.25, hx: width / 2, hy: Math.max(0.1, height / 2 - 0.25), hz: 0.35, yaw: o.yaw });
    }
  };
  switch (o.type) {
    case 'ramp':
    case 'kicker':
      ramp(p.len, p.height, p.width, o.x - fx * p.len / 2, o.z - fz * p.len / 2, g);
      break;
    case 'landing': {
      // rises toward the far end, then a downslope: we model the downslope only (approach from the high side)
      const ang = Math.atan2(p.height, p.len);
      const L = Math.hypot(p.len, p.height);
      S({ kind: mat, ramp: true, x: o.x, z: o.z, y: g + p.height / 2 - 0.25, hx: p.width / 2, hy: 0.25, hz: L / 2, yaw: o.yaw, pitch: ang });
      S({ kind: mat, x: o.x - fx * (p.len / 2 - 0.4), z: o.z - fz * (p.len / 2 - 0.4), y: g + p.height / 2 - 0.25, hx: p.width / 2, hy: Math.max(0.1, p.height / 2 - 0.25), hz: 0.4, yaw: o.yaw });
      break;
    }
    case 'box':
      S({ kind: mat, x: o.x, z: o.z, y: g + p.sy / 2 + p.raise, hx: p.sx / 2, hy: p.sy / 2, hz: p.sz / 2, yaw: o.yaw });
      break;
    case 'wall':
      S({ kind: mat, x: o.x, z: o.z, y: g + p.height / 2, hx: p.len / 2, hy: p.height / 2, hz: p.thick / 2, yaw: o.yaw });
      break;
    case 'tirewall':
      S({ kind: 'tirewall', x: o.x, z: o.z, y: g + 0.5, hx: p.len / 2, hy: 0.5, hz: 0.5, yaw: o.yaw });
      break;
    case 'pole':
      S({ kind: 'pole', x: o.x, z: o.z, y0: g - 0.5, y1: g + p.height, r: p.r });
      break;
    case 'platform':
      S({ kind: mat, x: o.x, z: o.z, y: g + p.height - 0.25, hx: p.sx / 2, hy: 0.25, hz: p.sz / 2, yaw: o.yaw });
      S({ kind: 'concrete', x: o.x, z: o.z, y: g + (p.height - 0.5) / 2, hx: p.sx / 2 - 0.4, hy: Math.max(0.1, (p.height - 0.5) / 2), hz: p.sz / 2 - 0.4, yaw: o.yaw });
      break;
    case 'bump':
      S({ kind: 'hazard', x: o.x, z: o.z, y: g + p.height - 0.3, hx: p.width / 2, hy: 0.3, hz: 0.35, yaw: o.yaw, pitch: 0 });
      break;
    case 'quarter': {
      const n = 12, R = p.radius;
      for (let k = 0; k < n; k++) {
        const a = ((k + 0.5) / n) * (Math.PI / 2);
        const seg = 2 * R * Math.sin(Math.PI / 4 / n) + 0.15;
        const along = Math.sin(a) * R, up = R - Math.cos(a) * R;
        S({ kind: mat, x: o.x + fx * along, z: o.z + fz * along, y: g + up - 0.25 * Math.cos(a), hx: p.width / 2, hy: 0.25, hz: seg / 2, yaw: o.yaw, pitch: -a });
      }
      break;
    }
    case 'loop': {
      const w = p.width;
      const rx = Math.cos(o.yaw), rz = -Math.sin(o.yaw);
      const segs = teardropLoop(p.radius * 1.8, p.radius * 0.65, 64);
      const startAlong = -segs[segs.length - 1].along / 2;
      for (const sg of segs) {
        const f = sg.theta / (Math.PI * 2);
        const shift = f * (w + 1.5) - (w + 1.5) / 2;
        const along = startAlong + sg.along + Math.sin(sg.theta) * 0.3;
        S({ kind: mat, loop: true, x: o.x + fx * along + rx * shift, z: o.z + fz * along + rz * shift, y: g + sg.up - Math.cos(sg.theta) * 0.3, hx: w / 2, hy: 0.3, hz: sg.len / 2 + 0.18, yaw: o.yaw, pitch: -sg.theta });
      }
      break;
    }
    default:
      if (T && T.prop) out.props.push({ type: T.prop, x: o.x, z: o.z, yaw: o.yaw, yOff: o.dy || 0 });
  }
  return out;
}

export class Editor {
  constructor(game) {
    this.game = game;
    this.objects = [];
    this.group = new THREE.Group();
    this.selected = null;
    this.tool = 'ramp';
    this.panel = null;
    this.helper = null;
    this.raycaster = new THREE.Raycaster();
    this.dragging = false;
    this.sceneName = 'Моя сцена';
    this.active = false;
    this.history = [];
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
  }

  open() {
    const g = this.game;
    this.active = true;
    g.scene.add(this.group);
    this.rebuildAll();
    this.buildPanel();
    g.cam.startFree(g.camera);
    if (!this._camPlaced) {
      const sp = g.map.spawns.proving;
      g.cam.free.pos.set(sp.x, g.map.T.heightAt(sp.x, sp.z) + 30, sp.z + 40);
      g.cam.free.yaw = Math.PI;
      g.cam.free.pitch = -0.55;
      this._camPlaced = true;
    }
    g.renderer.domElement.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    g.hud.message('Редактор сцен<br><small>ЛКМ — поставить/выбрать · ПКМ+мышь — обзор · WASD/QE — полёт · Shift — быстро</small>', 4);
  }

  close() {
    const g = this.game;
    this.active = false;
    g.scene.remove(this.group);
    if (this.panel) { this.panel.remove(); this.panel = null; }
    if (this.helper) { g.scene.remove(this.helper); this.helper = null; }
    g.renderer.domElement.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
  }

  // ---------- object management ----------
  defaultParams(type) {
    const p = {};
    for (const [k, v] of Object.entries(EDITOR_TYPES[type].params)) p[k] = v[0];
    return p;
  }

  add(type, x, z, yaw = 0) {
    const o = { id: Math.random().toString(36).slice(2, 9), type, x, z, yaw, dy: 0, params: this.defaultParams(type), mat: EDITOR_TYPES[type].mat };
    this.objects.push(o);
    this.buildObject(o);
    this.select(o);
    return o;
  }

  remove(o) {
    const i = this.objects.indexOf(o);
    if (i >= 0) this.objects.splice(i, 1);
    if (o._mesh) this.group.remove(o._mesh);
    if (this.selected === o) this.select(null);
  }

  buildObject(o) {
    const g = this.game;
    if (o._mesh) this.group.remove(o._mesh);
    const grp = new THREE.Group();
    const T = EDITOR_TYPES[o.type];
    if (o.type === 'spawn') {
      const y = g.map.T.heightAt(o.x, o.z);
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.2, 4).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#30e070', emissive: '#10a040', emissiveIntensity: 0.6 }));
      m.position.set(o.x, y + 1.2, o.z);
      m.rotation.y = o.yaw;
      grp.add(m);
    } else if (T.prop) {
      const ex = expandObject(o, g.map.T);
      for (const pr of ex.props) {
        const m = g.makePropPreview(pr.type);
        m.position.set(pr.x, g.map.T.heightAt(pr.x, pr.z) + 0.5 + (pr.yOff || 0), pr.z);
        m.rotation.y = pr.yaw;
        grp.add(m);
      }
    } else {
      const ex = expandObject(o, g.map.T);
      const mats = g.worldVisual.structureMaterials();
      for (const s of ex.structures) {
        const geo = g.worldVisual.structureGeometry(s);
        const mesh = new THREE.Mesh(geo, mats[s.kind] || mats.concrete);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        grp.add(mesh);
      }
    }
    grp.userData.obj = o;
    o._mesh = grp;
    this.group.add(grp);
  }

  rebuildAll() {
    this.group.clear();
    for (const o of this.objects) this.buildObject(o);
  }

  select(o) {
    const g = this.game;
    this.selected = o;
    if (this.helper) { g.scene.remove(this.helper); this.helper = null; }
    if (o && o._mesh) {
      this.helper = new THREE.BoxHelper(o._mesh, 0xffd000);
      g.scene.add(this.helper);
    }
    this.renderProps();
  }

  // ---------- input ----------
  pickGround(mx, my) {
    const g = this.game;
    const r = g.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((mx - r.left) / r.width) * 2 - 1, -((my - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, g.camera);
    // object hit first
    const hits = this.raycaster.intersectObjects(this.group.children, true);
    let obj = null;
    if (hits.length) {
      let p = hits[0].object;
      while (p && !p.userData.obj) p = p.parent;
      if (p) obj = p.userData.obj;
    }
    // terrain via ray march on heightfield
    const o = this.raycaster.ray.origin, d = this.raycaster.ray.direction;
    const T = g.map.T;
    let t = 0, pt = null;
    for (let i = 0; i < 4000; i++) {
      t += 0.5 + t * 0.004;
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y < T.heightAt(x, z)) { pt = new THREE.Vector3(x, y, z); break; }
    }
    return { obj, point: pt, objDist: hits.length ? hits[0].distance : Infinity, groundDist: pt ? t : Infinity };
  }

  onMouseDown(e) {
    if (!this.active || e.button !== 0) return;
    const hit = this.pickGround(e.clientX, e.clientY);
    if (hit.obj && hit.objDist <= hit.groundDist + 1) {
      this.select(hit.obj);
      this.dragging = true;
      this.dragOffset = hit.point ? [hit.obj.x - hit.point.x, hit.obj.z - hit.point.z] : [0, 0];
      return;
    }
    if (!hit.point) return;
    if (this.tool === 'select') { this.select(null); return; }
    const yaw = this.game.cam.free.yaw;
    this.add(this.tool, hit.point.x, hit.point.z, Math.round(yaw / (Math.PI / 12)) * (Math.PI / 12));
  }

  onMouseUp() {
    this.dragging = false;
  }

  update(dt, input) {
    if (!this.active) return;
    const o = this.selected;
    if (this.dragging && o) {
      const hit = this.pickGround(input.mouse.x, input.mouse.y);
      if (hit.point) {
        o.x = hit.point.x + this.dragOffset[0];
        o.z = hit.point.z + this.dragOffset[1];
        this.buildObject(o);
        this.select(o);
      }
    }
    if (o) {
      let changed = false;
      if (input.keyPressed('KeyR') || input.keyPressed('Period')) { o.yaw += Math.PI / 12; changed = true; }
      if (input.keyPressed('KeyF') || input.keyPressed('Comma')) { o.yaw -= Math.PI / 12; changed = true; }
      if (input.keyPressed('Delete') || input.keyPressed('Backspace')) { this.remove(o); return; }
      if (input.keyPressed('KeyX') && (input.key('ControlLeft') || input.key('ControlRight'))) { this.remove(o); return; }
      if (input.keyPressed('KeyD') && (input.key('ControlLeft') || input.key('ControlRight'))) {
        const c = this.add(o.type, o.x + 3, o.z + 3, o.yaw);
        c.params = { ...o.params }; c.mat = o.mat; c.dy = o.dy;
        this.buildObject(c); this.select(c);
      }
      if (input.keyPressed('PageUp')) { o.dy = (o.dy || 0) + 0.5; changed = true; }
      if (input.keyPressed('PageDown')) { o.dy = (o.dy || 0) - 0.5; changed = true; }
      if (changed) { this.buildObject(o); this.select(o); }
    }
    if (input.keyPressed('Escape')) this.select(null);
  }

  // ---------- UI ----------
  buildPanel() {
    if (this.panel) this.panel.remove();
    const p = document.createElement('div');
    p.className = 'editor-panel';
    p.innerHTML = `
      <h3>Редактор сцен</h3>
      <div class="ed-sec"><b>Инструмент</b><div class="ed-tools"></div></div>
      <div class="ed-sec ed-props"></div>
      <div class="ed-sec"><b>Сцена</b>
        <input class="ed-name" value="${this.sceneName}">
        <div class="ed-row"><button class="btn small" data-a="save">Сохранить</button><button class="btn small" data-a="new">Новая</button></div>
        <select class="ed-list" size="5"></select>
        <div class="ed-row"><button class="btn small" data-a="load">Загрузить</button><button class="btn small" data-a="del">Удалить</button></div>
        <div class="ed-row"><button class="btn small" data-a="export">Экспорт JSON</button><button class="btn small" data-a="import">Импорт</button></div>
        <input type="file" class="ed-file" accept=".json" style="display:none">
      </div>
      <div class="ed-sec"><button class="btn primary" data-a="test">▶ Тест-драйв</button><button class="btn" data-a="exit">Выйти в меню</button></div>
      <div class="hint">ЛКМ по земле — поставить · ЛКМ по объекту — выбрать/тащить · R/F — поворот · PgUp/PgDn — высота · Del — удалить · Ctrl+D — копия · ПКМ+мышь — обзор · WASD, Q/E — полёт</div>`;
    document.body.appendChild(p);
    this.panel = p;
    const tools = p.querySelector('.ed-tools');
    const mk = (k, name) => {
      const b = document.createElement('button');
      b.className = 'btn small tool' + (this.tool === k ? ' active' : '');
      b.textContent = name;
      b.onclick = () => { this.tool = k; tools.querySelectorAll('.tool').forEach((x) => x.classList.remove('active')); b.classList.add('active'); };
      tools.appendChild(b);
    };
    mk('select', 'Выбор');
    for (const [k, t] of Object.entries(EDITOR_TYPES)) mk(k, t.name);
    p.addEventListener('click', (e) => {
      const a = e.target.dataset && e.target.dataset.a;
      if (!a) return;
      this.game.audio.init();
      if (a === 'save') this.save();
      if (a === 'new') { for (const o of [...this.objects]) this.remove(o); }
      if (a === 'load') this.load(p.querySelector('.ed-list').value);
      if (a === 'del') this.deleteScene(p.querySelector('.ed-list').value);
      if (a === 'export') this.exportJSON();
      if (a === 'import') p.querySelector('.ed-file').click();
      if (a === 'test') this.game.startEditorTest(this.serialize());
      if (a === 'exit') { this.close(); this.game.menu.openMain(); }
    });
    p.querySelector('.ed-file').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      f.text().then((txt) => {
        try { this.deserialize(JSON.parse(txt)); this.game.hud.message('Сцена импортирована', 2); } catch (err) { this.game.hud.message('Ошибка импорта: ' + err.message, 3, 'warn'); }
      });
    });
    p.querySelector('.ed-name').addEventListener('input', (e) => { this.sceneName = e.target.value; });
    this.refreshList();
    this.renderProps();
  }

  renderProps() {
    if (!this.panel) return;
    const box = this.panel.querySelector('.ed-props');
    box.innerHTML = '';
    const o = this.selected;
    if (!o) { box.innerHTML = '<b>Свойства</b><div class="hint">Ничего не выбрано</div>'; return; }
    const T = EDITOR_TYPES[o.type];
    const title = document.createElement('b');
    title.textContent = 'Свойства: ' + T.name;
    box.appendChild(title);
    const addSlider = (label, val, min, max, step, fn) => {
      const l = document.createElement('label');
      l.className = 'field';
      l.innerHTML = `<span>${label}: <i>${(+val).toFixed(2)}</i></span>`;
      const inp = document.createElement('input');
      Object.assign(inp, { type: 'range', min, max, step, value: val });
      inp.oninput = () => { fn(+inp.value); l.querySelector('i').textContent = (+inp.value).toFixed(2); this.buildObject(o); this.select(o); };
      l.appendChild(inp);
      box.appendChild(l);
    };
    const labels = { len: 'Длина', height: 'Высота', width: 'Ширина', sx: 'Размер X', sy: 'Размер Y', sz: 'Размер Z', raise: 'Подъём', thick: 'Толщина', r: 'Радиус', radius: 'Радиус' };
    for (const [k, [def, min, max, step]] of Object.entries(T.params)) addSlider(labels[k] || k, o.params[k] ?? def, min, max, step, (v) => (o.params[k] = v));
    addSlider('Поворот°', (o.yaw * 180) / Math.PI, -180, 180, 5, (v) => (o.yaw = (v * Math.PI) / 180));
    addSlider('Смещение по высоте', o.dy || 0, -5, 20, 0.1, (v) => (o.dy = v));
    if (T.mat && !T.prop && o.type !== 'pole' && o.type !== 'tirewall') {
      const sel = document.createElement('select');
      for (const m of MATS) { const op = document.createElement('option'); op.value = m; op.textContent = { wood: 'Дерево', metal: 'Металл', concrete: 'Бетон', dirt: 'Грунт', hazard: 'Полосатый', tirewall: 'Шины', barrier: 'Светлый бетон' }[m]; op.selected = o.mat === m; sel.appendChild(op); }
      sel.onchange = () => { o.mat = sel.value; this.buildObject(o); this.select(o); };
      box.appendChild(sel);
    }
    const del = document.createElement('button');
    del.className = 'btn small danger';
    del.textContent = 'Удалить объект';
    del.onclick = () => this.remove(o);
    box.appendChild(del);
  }

  scenes() {
    try { return JSON.parse(localStorage.getItem('cz_scenes') || '{}'); } catch (e) { return {}; }
  }

  refreshList() {
    const list = this.panel && this.panel.querySelector('.ed-list');
    if (!list) return;
    list.innerHTML = '';
    for (const [name, s] of Object.entries(this.scenes())) {
      const op = document.createElement('option');
      op.value = name;
      op.textContent = `${name} (${s.objects.length})`;
      list.appendChild(op);
    }
  }

  serialize() {
    return { name: this.sceneName, version: 1, objects: this.objects.map((o) => ({ type: o.type, x: +o.x.toFixed(2), z: +o.z.toFixed(2), yaw: +o.yaw.toFixed(4), dy: o.dy || 0, params: o.params, mat: o.mat })) };
  }

  deserialize(data) {
    for (const o of [...this.objects]) this.remove(o);
    this.sceneName = data.name || 'Сцена';
    if (this.panel) this.panel.querySelector('.ed-name').value = this.sceneName;
    for (const d of data.objects || []) {
      if (!EDITOR_TYPES[d.type]) continue;
      const o = { id: Math.random().toString(36).slice(2, 9), type: d.type, x: d.x, z: d.z, yaw: d.yaw || 0, dy: d.dy || 0, params: { ...this.defaultParams(d.type), ...(d.params || {}) }, mat: d.mat || EDITOR_TYPES[d.type].mat };
      this.objects.push(o);
      this.buildObject(o);
    }
    this.select(null);
  }

  save() {
    const all = this.scenes();
    all[this.sceneName] = this.serialize();
    localStorage.setItem('cz_scenes', JSON.stringify(all));
    this.refreshList();
    this.game.hud.message('Сцена «' + this.sceneName + '» сохранена', 2);
  }

  load(name) {
    const s = this.scenes()[name];
    if (!s) return;
    this.deserialize(s);
    this.game.hud.message('Загружено: ' + name, 2);
  }

  deleteScene(name) {
    const all = this.scenes();
    if (!all[name]) return;
    delete all[name];
    localStorage.setItem('cz_scenes', JSON.stringify(all));
    this.refreshList();
  }

  exportJSON() {
    const blob = new Blob([JSON.stringify(this.serialize(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (this.sceneName || 'scene').replace(/[^\wа-яё -]/gi, '_') + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
