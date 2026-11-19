// Keyboard + gamepad input. Produces analog driving axes and edge-triggered actions.
import { clamp } from './math.js';

export const ACTIONS = {
  repair: ['KeyR'],
  reset: ['KeyT'],
  camera: ['KeyC'],
  horn: ['KeyH'],
  lights: ['KeyL'],
  shiftUp: ['KeyE'],
  shiftDown: ['KeyQ'],
  gearMode: ['KeyM'],
  doors: ['KeyO'],
  hood: ['KeyU'],
  trunk: ['KeyK'],
  slowmo: ['KeyJ'],
  pause: ['Escape', 'KeyP'],
  help: ['F1'],
  siren: ['KeyN'],
  hazard: ['KeyZ'],
  switchCar: ['Tab'],
  map: ['KeyB'],
  freeCam: ['KeyV'],
  abs: ['KeyX'],
  tcs: ['KeyG'],
  fps: ['F2'],
};

export class Input {
  constructor() {
    this.down = new Set();
    this.edges = new Set();
    this.enabled = true;
    this.steerKb = 0;
    this.mouse = { dx: 0, dy: 0, wheel: 0, left: false, right: false, x: 0, y: 0 };
    this.pad = null;
    this.padPrev = [];
    this.padActions = new Set();
    this.padUsed = false;
    const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT');
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if (['Tab', 'F1', 'F2', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.edges.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('mousemove', (e) => {
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    window.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('gamepadconnected', () => { this.padUsed = true; });
  }

  pressed(action) {
    const codes = ACTIONS[action];
    if (codes && codes.some((c) => this.edges.has(c))) return true;
    return this.padActions.has(action);
  }
  key(code) { return this.down.has(code); }
  keyPressed(code) { return this.edges.has(code); }

  pollPad() {
    this.padActions.clear();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pad = null;
    for (const p of pads) if (p && p.connected) { this.pad = p; break; }
    if (!this.pad) return;
    const b = this.pad.buttons;
    const was = (i) => this.padPrev[i];
    const now = (i) => b[i] && b[i].pressed;
    const map = { 3: 'repair', 8: 'camera', 9: 'pause', 4: 'shiftDown', 5: 'shiftUp', 2: 'horn', 12: 'lights', 13: 'doors', 14: 'slowmo', 15: 'map', 1: 'reset', 10: 'siren' };
    for (const [i, a] of Object.entries(map)) if (now(+i) && !was(+i)) { this.padActions.add(a); this.padUsed = true; }
    this.padPrev = b.map((x) => x.pressed);
  }

  // driving axes
  drive(dt) {
    let thr = 0, brk = 0, hb = 0;
    const k = this.down;
    if (k.has('KeyW') || k.has('ArrowUp')) thr = 1;
    if (k.has('KeyS') || k.has('ArrowDown')) brk = 1;
    if (k.has('Space')) hb = 1;
    let target = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) target += 1;
    if (k.has('KeyD') || k.has('ArrowRight')) target -= 1;
    // keyboard steering is smoothed in the vehicle; here we pass the raw target
    let steer = target;
    let steerDirect = null;
    const hornHeld = k.has('KeyH');
    if (this.pad) {
      const ax = this.pad.axes;
      const b = this.pad.buttons;
      const sx = Math.abs(ax[0]) > 0.08 ? ax[0] : 0;
      if (sx !== 0) { steerDirect = -Math.sign(sx) * Math.pow(Math.abs(sx), 1.4); this.padUsed = true; }
      const rt = b[7] ? b[7].value : 0, lt = b[6] ? b[6].value : 0;
      if (rt > 0.02) thr = Math.max(thr, rt);
      if (lt > 0.02) brk = Math.max(brk, lt);
      if (b[0] && b[0].pressed) hb = 1;
    }
    return { throttle: thr, brake: brk, steer, handbrake: hb, steerDirect, horn: hornHeld || !!(this.pad && this.pad.buttons[2] && this.pad.buttons[2].pressed) };
  }

  padLook() {
    if (!this.pad) return [0, 0];
    const ax = this.pad.axes;
    const x = Math.abs(ax[2] || 0) > 0.12 ? ax[2] : 0, y = Math.abs(ax[3] || 0) > 0.12 ? ax[3] : 0;
    return [x, y];
  }

  endFrame() {
    this.edges.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
  }
}

export const CONTROLS_HELP = [
  ['W / ↑', 'Газ'], ['S / ↓', 'Тормоз / задний ход'], ['A D / ← →', 'Руль'], ['Пробел', 'Ручник'],
  ['R', 'Починить и поставить на колёса'], ['T', 'Вернуть на старт'], ['C', 'Камера'], ['Мышь (ЛКМ)', 'Обзор камерой, колесо — зум'],
  ['Q / E', 'Передача вниз / вверх (ручная КПП)'], ['M', 'Автомат / механика'], ['H', 'Сигнал'], ['L', 'Фары'],
  ['O / U / K', 'Двери / капот / багажник'], ['J', 'Замедление времени'], ['N', 'Сирена (полиция)'], ['Z', 'Аварийка'],
  ['X / G', 'ABS / антипробуксовка'], ['B', 'Карта (телепорт)'], ['V', 'Свободная камера'], ['Tab', 'Пересесть в другую машину'],
  ['Esc / P', 'Пауза'], ['F2', 'FPS'],
  ['Геймпад', 'RT газ, LT тормоз, стик руль, A ручник, Y ремонт, LB/RB передачи, Back камера, Start пауза'],
];
