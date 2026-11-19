// On-screen touch controls for phones and tablets.
// Driving: analog steering pad (left thumb), gas / brake / handbrake (right thumb), quick actions.
// Editor and free camera: a fly joystick plus up/down buttons.
import { clamp } from '../core/math.js';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};

// pointer helper: tracks one pointer per element, calls back with start / move / end
function track(node, { down, move, up }) {
  let id = null;
  node.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    id = e.pointerId;
    try { node.setPointerCapture(id); } catch (err) { /* ignore */ }
    e.preventDefault();
    if (down) down(e);
  });
  node.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    e.preventDefault();
    if (move) move(e);
  });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    if (up) up(e);
  };
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('lostpointercapture', end);
}

export class TouchControls {
  constructor(root, input) {
    this.input = input;
    input.touch = this;
    this.state = { steer: 0, gas: 0, brake: 0, hb: 0, fly: [0, 0], upDown: 0 };
    this.mode = 'none';
    this.root = el('div', 'touch-ui', root);
    this.root.hidden = true;

    // ---- driving ----
    this.drive = el('div', 't-drive', this.root);
    const steer = el('div', 't-steer', this.drive);
    el('div', 't-steer-label', steer, '◀ РУЛЬ ▶');
    const track_ = el('div', 't-steer-track', steer);
    this.knob = el('div', 't-steer-knob', track_);
    let x0 = 0;
    const range = () => Math.max(50, Math.min(90, steer.clientWidth * 0.32));
    track(steer, {
      down: (e) => { x0 = e.clientX; this.setSteer(0); steer.classList.add('on'); },
      move: (e) => this.setSteer(clamp(-(e.clientX - x0) / range(), -1, 1)),
      up: () => { this.setSteer(0); steer.classList.remove('on'); },
    });
    const pedals = el('div', 't-pedals', this.drive);
    const hb = el('div', 't-btn t-hb', pedals, '<b>P</b><small>ручник</small>');
    const brake = el('div', 't-btn t-brake', pedals, '<b>ТОРМОЗ</b><small>и назад</small>');
    const gas = el('div', 't-btn t-gas', pedals, '<b>ГАЗ</b>');
    const hold = (node, key) => track(node, {
      down: () => { this.state[key] = 1; node.classList.add('on'); this.buzz(8); },
      up: () => { this.state[key] = 0; node.classList.remove('on'); },
    });
    hold(gas, 'gas');
    hold(brake, 'brake');
    hold(hb, 'hb');
    const quick = el('div', 't-quick', this.drive);
    for (const [action, label] of [['horn', '📯'], ['lights', '💡'], ['slowmo', '⏱'], ['doors', '🚪']]) {
      const b = el('div', 't-mini', quick, label);
      b.dataset.action = action;
      track(b, { down: () => { b.classList.add('on'); if (action === 'horn') this.state.horn = 1; else input.touchActions.add(action); }, up: () => { b.classList.remove('on'); if (action === 'horn') this.state.horn = 0; } });
    }

    // ---- fly (editor / free camera) ----
    this.flyEl = el('div', 't-fly', this.root);
    const stick = el('div', 't-stick', this.flyEl);
    const sk = el('div', 't-stick-knob', stick);
    let c0 = [0, 0];
    track(stick, {
      down: (e) => { const r = stick.getBoundingClientRect(); c0 = [r.left + r.width / 2, r.top + r.height / 2]; },
      move: (e) => {
        const R = 55;
        let dx = (e.clientX - c0[0]) / R, dy = (e.clientY - c0[1]) / R;
        const l = Math.hypot(dx, dy);
        if (l > 1) { dx /= l; dy /= l; }
        this.state.fly = [dx, dy];
        sk.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
      },
      up: () => { this.state.fly = [0, 0]; sk.style.transform = ''; },
    });
    const ud = el('div', 't-updown', this.flyEl);
    const upB = el('div', 't-btn t-small', ud, '▲');
    const dnB = el('div', 't-btn t-small', ud, '▼');
    track(upB, { down: () => { this.state.upDown = 1; }, up: () => { this.state.upDown = 0; } });
    track(dnB, { down: () => { this.state.upDown = -1; }, up: () => { this.state.upDown = 0; } });
  }

  setSteer(v) {
    this.state.steer = v;
    this.knob.style.transform = `translateX(${-v * 46}px)`;
  }

  buzz(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* not allowed */ }
  }

  // 'drive' | 'fly' | 'none'
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.root.hidden = mode === 'none';
    this.drive.hidden = mode !== 'drive';
    this.flyEl.hidden = mode !== 'fly';
    if (mode !== 'drive') { this.state.gas = this.state.brake = this.state.hb = 0; this.setSteer(0); }
    if (mode !== 'fly') { this.state.fly = [0, 0]; this.state.upDown = 0; }
    for (const n of this.root.querySelectorAll('.on')) n.classList.remove('on');
  }
}

// One-finger drag on the 3D view orbits the camera, two fingers pinch to zoom.
export function attachTouchCamera(canvas, input, isActive) {
  const pts = new Map();
  let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || !isActive()) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) input.mouse.left = true;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = Math.hypot(a[0] - b[0], a[1] - b[1]);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = pts.get(e.pointerId);
    if (pts.size === 1) {
      input.mouse.dx += (e.clientX - p[0]) * 1.3;
      input.mouse.dy += (e.clientY - p[1]) * 1.3;
      input.mouse.x = e.clientX;
      input.mouse.y = e.clientY;
    }
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch > 0 && Math.abs(d - pinch) > 12) { input.mouse.wheel += d < pinch ? 1 : -1; pinch = d; }
    }
  });
  const end = (e) => {
    if (!pts.delete(e.pointerId)) return;
    if (pts.size === 0) input.mouse.left = false;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

export function isTouchDevice() {
  try {
    return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 1;
  } catch (e) {
    return false;
  }
}
