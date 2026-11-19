// In-game HUD drawn with 2D canvases + DOM overlays.
import { clamp } from '../core/math.js';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};

function dmgColor(d) {
  d = clamp(d, 0, 1);
  if (d < 0.02) return 'rgba(80,200,120,0.85)';
  const r = Math.round(lerp3(80, 240, 240, d)), g = Math.round(lerp3(200, 200, 40, d)), b = Math.round(lerp3(120, 60, 40, d));
  return `rgba(${r},${g},${b},0.9)`;
}
function lerp3(a, b, c, t) {
  return t < 0.5 ? a + (b - a) * t * 2 : b + (c - b) * (t - 0.5) * 2;
}

export class Hud {
  constructor(root, mapImage, mapSize) {
    this.root = el('div', 'hud hidden', root);
    this.mapImage = mapImage;
    this.mapSize = mapSize;
    this.gauges = el('canvas', 'hud-gauges', this.root);
    this.gauges.width = 440; this.gauges.height = 220;
    this.dmg = el('canvas', 'hud-damage', this.root);
    this.dmg.width = 150; this.dmg.height = 230;
    this.mini = el('canvas', 'hud-minimap', this.root);
    this.mini.width = 210; this.mini.height = 210;
    this.status = el('div', 'hud-status', this.root);
    this.info = el('div', 'hud-info', this.root);
    this.msg = el('div', 'hud-msg', this.root);
    this.hint = el('div', 'hud-hint', this.root, 'F1 — управление · Esc — пауза · R — ремонт · C — камера');
    this.fpsEl = el('div', 'hud-fps hidden', this.root);
    this.msgTimer = 0;
    this.showFps = false;
    this.frames = 0;
    this.fpsT = 0;
    this.lastDmgKey = '';
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  message(text, dur = 2.5, cls = '') {
    this.msg.innerHTML = text;
    this.msg.className = 'hud-msg show ' + cls;
    this.msgTimer = dur;
  }

  setInfo(html) {
    if (this._info !== html) { this.info.innerHTML = html; this._info = html; }
    this.info.style.display = html ? 'block' : 'none';
  }

  update(dt, game) {
    const v = game.player;
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.msg.className = 'hud-msg';
    }
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT > 0.5) {
      this.fpsEl.textContent = `${Math.round(this.frames / this.fpsT)} FPS · физика ${game.world.substepsLastFrame} подшагов · тел ${game.world.bodies.length}`;
      this.frames = 0; this.fpsT = 0;
    }
    this.fpsEl.classList.toggle('hidden', !this.showFps);
    if (!v) return;
    this.drawGauges(v, game);
    this.drawDamage(v);
    this.drawMinimap(v, game);
    const st = [];
    st.push(game.modeName || '');
    st.push('Камера: ' + game.cameraName());
    if (game.world.timeScale < 1) st.push('<b class="warn">ЗАМЕДЛЕНИЕ ×' + game.world.timeScale + '</b>');
    if (game.world.paused) st.push('<b class="warn">ПАУЗА ФИЗИКИ</b>');
    const s = st.filter(Boolean).join(' · ');
    if (s !== this._st) { this.status.innerHTML = s; this._st = s; }
  }

  drawGauges(v, game) {
    const g = this.gauges.getContext('2d');
    const W = this.gauges.width, H = this.gauges.height;
    g.clearRect(0, 0, W, H);
    const kmh = Math.abs(v.fwdSpeed) * 3.6;
    const maxKmh = v.mass > 4000 ? 160 : v.def.shape.style === 'sport' || v.def.police ? 320 : 240;
    const red = v.engine.redline;
    const maxRpm = Math.ceil((red * 1.12) / 1000) * 1000;
    const dial = (cx, cy, r, val, max, majors, label, redFrom, fmt) => {
      g.save();
      g.translate(cx, cy);
      g.fillStyle = 'rgba(8,10,14,0.88)';
      g.beginPath(); g.arc(0, 0, r + 8, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.15)'; g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, r + 8, 0, Math.PI * 2); g.stroke();
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      if (redFrom !== null) {
        g.strokeStyle = 'rgba(230,40,40,0.85)'; g.lineWidth = 6;
        g.beginPath(); g.arc(0, 0, r - 4, a0 + (a1 - a0) * (redFrom / max), a1); g.stroke();
      }
      for (let i = 0; i <= majors; i++) {
        const a = a0 + ((a1 - a0) * i) / majors;
        g.strokeStyle = '#e8e8e8'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(Math.cos(a) * (r - 12), Math.sin(a) * (r - 12)); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); g.stroke();
        g.fillStyle = '#cfd6df'; g.font = '11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(fmt((max * i) / majors), Math.cos(a) * (r - 24), Math.sin(a) * (r - 24));
        if (i < majors) for (let k = 1; k < 4; k++) {
          const b = a + ((a1 - a0) / majors) * (k / 4);
          g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.4)';
          g.beginPath(); g.moveTo(Math.cos(b) * (r - 6), Math.sin(b) * (r - 6)); g.lineTo(Math.cos(b) * r, Math.sin(b) * r); g.stroke();
        }
      }
      const t = clamp(val / max, 0, 1.05);
      const a = a0 + (a1 - a0) * t;
      g.strokeStyle = '#ff4a2a'; g.lineWidth = 3.5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-Math.cos(a) * 12, -Math.sin(a) * 12); g.lineTo(Math.cos(a) * (r - 8), Math.sin(a) * (r - 8)); g.stroke();
      g.fillStyle = '#222'; g.beginPath(); g.arc(0, 0, 7, 0, 7); g.fill();
      g.fillStyle = '#9aa4b0'; g.font = '10px sans-serif'; g.fillText(label, 0, r * 0.42);
      g.restore();
    };
    dial(110, 112, 92, v.rpm, maxRpm, maxRpm / 1000, '×1000 об/мин', red, (x) => Math.round(x / 1000));
    dial(330, 112, 92, kmh, maxKmh, maxKmh > 200 ? 8 : 8, 'км/ч', null, (x) => Math.round(x));
    // digital speed + gear
    g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(Math.round(kmh)), 330, 160);
    const gear = v.gear < 0 ? 'R' : v.gear === 0 ? 'N' : String(v.gear);
    g.font = 'bold 34px sans-serif';
    g.fillStyle = v.gear < 0 ? '#ffb020' : '#fff';
    g.fillText(gear, 110, 160);
    g.font = '11px sans-serif';
    g.fillStyle = '#9aa4b0';
    g.fillText(v.auto ? 'АВТОМАТ' : 'МЕХАНИКА', 110, 190);
    // indicators
    const ind = [];
    if (v.controls.handbrake > 0) ind.push(['P', '#ff4040']);
    if (v.absActive && v.controls.brake > 0.2) ind.push(['ABS', '#ffb020']);
    if (v.tcsActive) ind.push(['TCS', '#ffb020']);
    if (v.lightsOn) ind.push(['ФАРЫ', '#4ad0ff']);
    if (!v.engineAlive) ind.push(['ДВИГ', '#ff3030']);
    else if (v.engineDamage > 0.05) ind.push(['ДВИГ', '#ffb020']);
    if (v.engine.turbo) ind.push(['BOOST ' + Math.round(v.boost * 100) + '%', '#8fd']);
    g.font = 'bold 11px sans-serif';
    ind.forEach((it, i) => { g.fillStyle = it[1]; g.fillText(it[0], 220, 30 + i * 16); });
    v.absActive = false;
  }

  drawDamage(v) {
    const D = v.damage;
    const key = [D.front, D.rear, D.left, D.right, D.roof, D.engine, D.total, ...v.wheels.map((w) => w.detached)].map((x) => (typeof x === 'number' ? x.toFixed(2) : x)).join(',');
    if (key === this.lastDmgKey) return;
    this.lastDmgKey = key;
    const g = this.dmg.getContext('2d');
    const W = this.dmg.width, H = this.dmg.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(8,10,14,0.65)';
    g.beginPath(); g.roundRect(0, 0, W, H, 10); g.fill();
    const cx = W / 2, top = 28, bw = 64, bh = 150;
    const x0 = cx - bw / 2;
    const zone = (x, y, w, h, d) => { g.fillStyle = dmgColor(d); g.beginPath(); g.roundRect(x, y, w, h, 6); g.fill(); };
    zone(x0, top, bw, 34, D.front);
    zone(x0, top + bh - 34, bw, 34, D.rear);
    zone(x0, top + 38, 14, bh - 76, D.left);
    zone(x0 + bw - 14, top + 38, 14, bh - 76, D.right);
    zone(x0 + 18, top + 52, bw - 36, bh - 104, D.roof);
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.5;
    g.beginPath(); g.roundRect(x0, top, bw, bh, 12); g.stroke();
    // wheels
    const wpos = [[x0 - 10, top + 20], [x0 + bw + 2, top + 20], [x0 - 10, top + bh - 46], [x0 + bw + 2, top + bh - 46]];
    v.wheels.forEach((w, i) => {
      const p = wpos[i] || wpos[0];
      g.fillStyle = w.detached ? 'rgba(255,40,40,0.95)' : 'rgba(220,220,220,0.8)';
      g.fillRect(p[0], p[1], 8, 26);
      if (w.detached) { g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0] + 8, p[1] + 26); g.stroke(); }
    });
    g.fillStyle = '#fff'; g.font = 'bold 12px sans-serif'; g.textAlign = 'center';
    g.fillText('ПОВРЕЖДЕНИЯ', cx, 16);
    g.font = 'bold 18px sans-serif';
    g.fillStyle = dmgColor(D.total);
    g.fillText(Math.round(D.total * 100) + '%', cx, top + bh + 26);
    g.font = '11px sans-serif'; g.fillStyle = v.engineAlive ? dmgColor(D.engine) : '#ff3030';
    g.fillText(v.engineAlive ? 'Двигатель ' + Math.round((1 - v.engineDamage) * 100) + '%' : 'ДВИГАТЕЛЬ ЗАГЛОХ', cx, top + bh + 44);
  }

  drawMinimap(v, game) {
    const g = this.mini.getContext('2d');
    const W = this.mini.width;
    const img = this.mapImage;
    const scale = img.width / this.mapSize; // px per metre on map image
    const zoom = 1.6; // screen px per image px
    const c = v.body.com;
    const yaw = v.yaw;
    g.save();
    g.clearRect(0, 0, W, W);
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#20262c'; g.fillRect(0, 0, W, W);
    g.translate(W / 2, W / 2);
    g.rotate(Math.PI + yaw);
    g.scale(zoom, zoom);
    const px = (c[0] + this.mapSize / 2) * scale, pz = (c[2] + this.mapSize / 2) * scale;
    g.drawImage(img, -px, -pz);
    // others
    for (const o of game.vehicles) {
      if (o === v) continue;
      const ox = (o.body.com[0] + this.mapSize / 2) * scale - px, oz = (o.body.com[2] + this.mapSize / 2) * scale - pz;
      g.fillStyle = o.def.police ? '#4a8cff' : o.ai && o.ai.role === 'racer' ? '#ffcc33' : '#e0e0e0';
      g.beginPath(); g.arc(ox, oz, 3.2 / zoom * 1.4, 0, 7); g.fill();
    }
    const tgt = game.mode && game.mode.target ? game.mode.target() : null;
    if (tgt) {
      let tx = (tgt.x + this.mapSize / 2) * scale - px, tz = (tgt.z + this.mapSize / 2) * scale - pz;
      const d = Math.hypot(tx, tz);
      const lim = (W / 2 - 10) / zoom;
      if (d > lim) { tx *= lim / d; tz *= lim / d; }
      g.fillStyle = '#ffd400';
      g.strokeStyle = '#000';
      g.beginPath(); g.arc(tx, tz, 5 / zoom * 1.2, 0, 7); g.fill(); g.stroke();
    }
    g.restore();
    // player arrow
    g.fillStyle = '#ff5030';
    g.strokeStyle = '#fff';
    g.beginPath(); g.moveTo(W / 2, W / 2 - 9); g.lineTo(W / 2 + 6, W / 2 + 7); g.lineTo(W / 2, W / 2 + 3); g.lineTo(W / 2 - 6, W / 2 + 7); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center';
    const nx = W / 2 + Math.sin(Math.PI + yaw) * (W / 2 - 12), ny = W / 2 - Math.cos(Math.PI + yaw) * (W / 2 - 12);
    g.fillText('С', nx, ny + 4);
  }
}
