// Procedural audio: every sound is synthesised at start-up (no audio files).
// Engines use a looped recording-like buffer of combustion pulses whose playback rate follows RPM.
import { clamp, lerp, rng } from '../core/math.js';

const SR = 44100;
const ENGINE_BASE_RPM = 1500;

const ENGINE_PROFILES = {
  i3: { cyl: 3, res: [150, 380, 1050], decay: 0.009, noise: 0.25, uneven: 0.08, amp: [1, 0.9, 0.95], rasp: 0.3 },
  i4: { cyl: 4, res: [170, 420, 1300], decay: 0.008, noise: 0.22, uneven: 0.05, amp: [1, 0.92, 0.96, 0.9], rasp: 0.35 },
  v6: { cyl: 6, res: [130, 340, 900], decay: 0.008, noise: 0.18, uneven: 0.06, amp: [1, 0.85, 0.95, 0.88, 0.97, 0.83], rasp: 0.25 },
  v8: { cyl: 8, res: [95, 240, 640], decay: 0.011, noise: 0.16, uneven: 0.22, amp: [1, 0.6, 0.95, 0.7, 1, 0.55, 0.9, 0.75], rasp: 0.45 },
  diesel: { cyl: 6, res: [110, 290, 2600], decay: 0.007, noise: 0.35, uneven: 0.05, amp: [1, 0.9, 1, 0.95, 1, 0.9], rasp: 0.2, clatter: 0.5 },
  bigdiesel: { cyl: 8, res: [70, 180, 2200], decay: 0.012, noise: 0.3, uneven: 0.08, amp: [1, 0.85, 0.95, 0.8, 1, 0.9, 0.85, 0.8], rasp: 0.2, clatter: 0.6 },
};

function biquadLP(data, cutoff, q = 0.7) {
  const w = (2 * Math.PI * cutoff) / SR;
  const alpha = Math.sin(w) / (2 * q);
  const cs = Math.cos(w);
  const b0 = (1 - cs) / 2, b1 = 1 - cs, b2 = (1 - cs) / 2, a0 = 1 + alpha, a1 = -2 * cs, a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    data[i] = y;
  }
}
function biquadBP(data, f, q) {
  const w = (2 * Math.PI * f) / SR;
  const alpha = Math.sin(w) / (2 * q);
  const cs = Math.cos(w);
  const b0 = alpha, b2 = -alpha, a0 = 1 + alpha, a1 = -2 * cs, a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}
function normalize(d, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
  return d;
}
// fade loop boundaries so loops are click-free
function loopFade(d, n = 300) {
  for (let i = 0; i < n; i++) {
    const a = i / n;
    const j = d.length - n + i;
    const mixed = d[j] * (1 - a) + d[i] * a;
    d[j] = mixed;
  }
}

function engineBuffer(profile, onLoad, seed) {
  const R = rng(seed);
  const cycles = 12;
  const cycleLen = Math.round((SR * 120) / ENGINE_BASE_RPM);
  const len = cycleLen * cycles;
  const d = new Float32Array(len);
  const P = profile;
  const pulseLen = Math.round(SR * P.decay * 7);
  for (let c = 0; c < cycles; c++) {
    for (let k = 0; k < P.cyl; k++) {
      const jitter = (R() - 0.5) * 0.02 + (k % 2 ? P.uneven * 0.25 : 0);
      const t0 = Math.round(c * cycleLen + ((k + jitter) / P.cyl) * cycleLen);
      const amp = P.amp[k % P.amp.length] * (0.85 + R() * 0.3) * (onLoad ? 1 : 0.55);
      const ph = R() * 6.28;
      for (let i = 0; i < pulseLen; i++) {
        const t = i / SR;
        const env = Math.exp(-t / P.decay) * (1 - Math.exp(-t / 0.0006));
        let s = Math.sin(2 * Math.PI * P.res[0] * t + ph) * 1.0;
        s += Math.sin(2 * Math.PI * P.res[1] * t + ph * 1.7) * (onLoad ? 0.55 : 0.3);
        s += Math.sin(2 * Math.PI * P.res[2] * t) * (onLoad ? 0.25 : 0.08) * Math.exp(-t / (P.decay * 0.4));
        s += (R() * 2 - 1) * P.noise * (onLoad ? 1 : 0.6);
        d[(t0 + i) % len] += s * env * amp;
      }
      if (P.clatter) {
        for (let i = 0; i < 160; i++) d[(t0 + Math.round(cycleLen / P.cyl / 2) + i) % len] += (R() * 2 - 1) * P.clatter * Math.exp(-i / 30) * 0.5;
      }
    }
  }
  // exhaust low body
  biquadLP(d, onLoad ? 3200 : 1600, 0.8);
  if (P.rasp && onLoad) for (let i = 0; i < len; i++) d[i] = Math.tanh(d[i] * (1 + P.rasp * 2));
  return normalize(d, 0.8);
}

function noiseBuffer(seconds, kind, seed) {
  const R = rng(seed);
  const len = Math.round(SR * seconds);
  let d = new Float32Array(len);
  if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (R() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  } else if (kind === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = R() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
  } else if (kind === 'squeal') {
    let ph = 0, ph2 = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const f = 1050 + 120 * Math.sin(t * 7.3) + 60 * Math.sin(t * 23.1);
      ph += (2 * Math.PI * f) / SR;
      ph2 += (2 * Math.PI * f * 1.51) / SR;
      d[i] = Math.sin(ph) * 0.5 + Math.sin(ph2) * 0.2 + (R() * 2 - 1) * 0.3;
    }
    d = biquadBP(d, 1150, 2.5);
  } else if (kind === 'gravel') {
    for (let i = 0; i < len; i++) d[i] = (R() * 2 - 1) * 0.3 + (R() < 0.004 ? (R() * 2 - 1) * 2.5 : 0);
    biquadLP(d, 2400, 0.7);
  } else if (kind === 'scrape') {
    for (let i = 0; i < len; i++) d[i] = (R() * 2 - 1) * (0.5 + 0.5 * Math.sin(i / 300 + R())) + (R() < 0.01 ? (R() * 2 - 1) * 2 : 0);
    const a = biquadBP(d, 2300, 3), b = biquadBP(d, 3900, 4), c = biquadBP(d, 900, 2);
    for (let i = 0; i < len; i++) d[i] = a[i] + b[i] * 0.7 + c[i] * 0.5;
  } else if (kind === 'water') {
    for (let i = 0; i < len; i++) d[i] = (R() * 2 - 1);
    biquadLP(d, 900, 0.5);
  }
  loopFade(d, 2000);
  return normalize(d, 0.8);
}

function impactBuffer(heavy, seed) {
  const R = rng(seed);
  const len = Math.round(SR * (heavy ? 1.5 : 0.7));
  const d = new Float32Array(len);
  // modal metal resonances
  const modes = heavy ? 18 : 10;
  for (let m = 0; m < modes; m++) {
    const f = 120 + R() * R() * 4200;
    const dec = 0.05 + R() * (heavy ? 0.5 : 0.25);
    const a = (0.3 + R()) / (1 + f / 1500);
    const ph = R() * 6.28;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      d[i] += Math.sin(2 * Math.PI * f * t + ph) * Math.exp(-t / dec) * a;
    }
  }
  // crunch noise
  const crunchLen = Math.round(SR * (heavy ? 0.6 : 0.12));
  for (let i = 0; i < crunchLen; i++) {
    const t = i / SR;
    const burst = heavy ? (Math.sin(t * 60) > 0.3 ? 1 : 0.4) : 1;
    d[i] += (R() * 2 - 1) * Math.exp(-t / (heavy ? 0.18 : 0.04)) * 1.4 * burst;
  }
  // thump
  for (let i = 0; i < Math.round(SR * 0.3); i++) {
    const t = i / SR;
    d[i] += Math.sin(2 * Math.PI * (70 - t * 80) * t) * Math.exp(-t / 0.08) * (heavy ? 2.2 : 1.2);
  }
  return normalize(d, 0.95);
}

function glassBuffer(seed) {
  const R = rng(seed);
  const len = Math.round(SR * 1.2);
  const d = new Float32Array(len);
  for (let i = 0; i < Math.round(SR * 0.08); i++) d[i] += (R() * 2 - 1) * Math.exp(-i / (SR * 0.02));
  const hp = biquadBP(d, 5000, 0.8);
  for (let i = 0; i < len; i++) d[i] = hp[i];
  for (let k = 0; k < 70; k++) {
    const t0 = Math.round(R() * R() * SR * 0.9);
    const f = 2500 + R() * 6000;
    const a = 0.1 + R() * 0.3;
    for (let i = 0; i < Math.round(SR * 0.05); i++) {
      if (t0 + i >= len) break;
      d[t0 + i] += Math.sin((2 * Math.PI * f * i) / SR) * Math.exp(-i / (SR * 0.008)) * a;
    }
  }
  return normalize(d, 0.9);
}

function clickBuffer(freq, dur, seed) {
  const R = rng(seed);
  const len = Math.round(SR * dur);
  const d = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    d[i] = (Math.sin(2 * Math.PI * freq * t) * 0.6 + (R() * 2 - 1) * 0.4) * Math.exp(-t / (dur * 0.25));
  }
  return normalize(d, 0.8);
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volume = 0.8;
    this.voices = new Map();
    this.buffers = {};
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ sampleRate: SR });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    const mk = (data) => {
      const b = ctx.createBuffer(1, data.length, SR);
      b.copyToChannel(data, 0);
      return b;
    };
    const B = this.buffers;
    B.engine = {};
    for (const [k, p] of Object.entries(ENGINE_PROFILES)) B.engine[k] = { on: mk(engineBuffer(p, true, 11 + k.length)), off: mk(engineBuffer(p, false, 29 + k.length)) };
    B.road = mk(noiseBuffer(3, 'brown', 3));
    B.wind = mk(noiseBuffer(3, 'pink', 4));
    B.squeal = mk(noiseBuffer(2, 'squeal', 5));
    B.gravel = mk(noiseBuffer(2.5, 'gravel', 6));
    B.scrape = mk(noiseBuffer(2, 'scrape', 7));
    B.water = mk(noiseBuffer(2, 'water', 8));
    B.impactL = [mk(impactBuffer(false, 1)), mk(impactBuffer(false, 2)), mk(impactBuffer(false, 3))];
    B.impactH = [mk(impactBuffer(true, 4)), mk(impactBuffer(true, 5)), mk(impactBuffer(true, 6))];
    B.glass = [mk(glassBuffer(1)), mk(glassBuffer(2))];
    B.clunk = mk(clickBuffer(140, 0.12, 9));
    B.thud = mk(clickBuffer(55, 0.3, 10));
    B.blip = mk(clickBuffer(880, 0.15, 11));
    B.blipHi = mk(clickBuffer(1320, 0.4, 12));
    B.bov = (() => { const d = noiseBuffer(0.5, 'pink', 13); for (let i = 0; i < d.length; i++) d[i] *= Math.exp(-i / (SR * 0.12)); return mk(biquadBP(d, 2500, 1)); })();
    this.ready = true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  // p, f: {x,y,z} position and forward direction of the camera
  setListener(p, f) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }

  loop(buffer, dest, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.loopStart = 0;
    s.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    s.connect(g).connect(dest);
    s.start(this.ctx.currentTime, Math.random() * buffer.duration * 0.9);
    return { src: s, gain: g };
  }

  // Creates the continuous sound set of one vehicle
  createVehicleVoice(vehicle, spatial) {
    if (!this.ready) return null;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 1;
    let panner = null;
    if (spatial) {
      panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 7;
      panner.maxDistance = 400;
      panner.rolloffFactor = 1.3;
      out.connect(panner).connect(this.master);
    } else out.connect(this.master);
    const e = vehicle.engine;
    const voice = { vehicle, out, panner, spatial };
    if (e.electric) {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = 'sine'; o2.type = 'triangle';
      const g = ctx.createGain(); g.gain.value = 0;
      const g2 = ctx.createGain(); g2.gain.value = 0.25;
      o1.connect(g); o2.connect(g2).connect(g);
      g.connect(out);
      o1.start(); o2.start();
      voice.ev = { o1, o2, g };
    } else {
      const prof = this.buffers.engine[e.sound] ? e.sound : 'i4';
      const bufs = this.buffers.engine[prof];
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2000;
      filter.Q.value = 0.8;
      const eg = ctx.createGain();
      eg.gain.value = 0.9;
      filter.connect(eg).connect(out);
      voice.on = this.loop(bufs.on, filter);
      voice.off = this.loop(bufs.off, filter);
      voice.filter = filter;
      voice.engGain = eg;
      if (e.turbo) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        const g = ctx.createGain(); g.gain.value = 0;
        o.connect(g).connect(out);
        o.start();
        voice.turbo = { o, g };
      }
    }
    voice.squeal = this.loop(this.buffers.squeal, out);
    voice.road = this.loop(this.buffers.road, out);
    voice.gravel = this.loop(this.buffers.gravel, out);
    voice.scrape = this.loop(this.buffers.scrape, out);
    if (!spatial) {
      voice.wind = this.loop(this.buffers.wind, out);
      voice.water = this.loop(this.buffers.water, out);
    }
    this.voices.set(vehicle, voice);
    return voice;
  }

  removeVehicleVoice(vehicle) {
    const v = this.voices.get(vehicle);
    if (!v) return;
    try {
      for (const k of ['on', 'off', 'squeal', 'road', 'gravel', 'scrape', 'wind', 'water']) if (v[k]) v[k].src.stop();
      if (v.ev) { v.ev.o1.stop(); v.ev.o2.stop(); }
      if (v.turbo) v.turbo.o.stop();
      if (v.horn) this.horn(vehicle, false);
      if (v.siren) this.siren(vehicle, false);
    } catch (e) { /* already stopped */ }
    v.out.disconnect();
    this.voices.delete(vehicle);
  }

  updateVehicle(vehicle, info) {
    const v = this.voices.get(vehicle);
    if (!v || !this.ctx) return;
    const t = this.ctx.currentTime;
    const tc = 0.03;
    const veh = vehicle;
    const rpm = veh.rpm;
    const thr = veh.controls.throttle;
    const alive = veh.engineAlive && veh.engineRunning;
    const vol = info.volume ?? 1;
    if (v.panner) {
      const p = veh.body.com;
      if (v.panner.positionX) {
        v.panner.positionX.setTargetAtTime(p[0], t, 0.03); v.panner.positionY.setTargetAtTime(p[1], t, 0.03); v.panner.positionZ.setTargetAtTime(p[2], t, 0.03);
      } else v.panner.setPosition(p[0], p[1], p[2]);
    }
    v.out.gain.setTargetAtTime(vol, t, 0.05);
    if (v.ev) {
      const f = 40 + rpm * 0.09;
      v.ev.o1.frequency.setTargetAtTime(f, t, tc);
      v.ev.o2.frequency.setTargetAtTime(f * 2.02, t, tc);
      v.ev.g.gain.setTargetAtTime(alive ? (0.03 + thr * 0.09) * Math.min(1, rpm / 600) : 0, t, tc);
    } else if (v.on) {
      const rate = Math.max(0.05, rpm / ENGINE_BASE_RPM);
      v.on.src.playbackRate.setTargetAtTime(rate, t, tc);
      v.off.src.playbackRate.setTargetAtTime(rate, t, tc);
      const load = alive ? thr : 0;
      const level = alive ? 0.32 + 0.25 * (rpm / veh.engine.redline) : Math.max(0, rpm / 2000) * 0.2;
      v.on.gain.gain.setTargetAtTime(level * (0.25 + 0.75 * load), t, tc);
      v.off.gain.gain.setTargetAtTime(level * (0.75 - 0.5 * load), t, tc);
      v.filter.frequency.setTargetAtTime(600 + load * 3200 + rpm * 0.4, t, tc);
      if (v.turbo) {
        v.turbo.o.frequency.setTargetAtTime(1800 + veh.boost * 3200 + rpm * 0.2, t, tc);
        v.turbo.g.gain.setTargetAtTime(veh.boost * 0.018, t, tc);
      }
    }
    v.squeal.gain.gain.setTargetAtTime(info.squeal * 0.35, t, tc);
    v.squeal.src.playbackRate.setTargetAtTime(0.9 + Math.min(0.3, info.speed / 100), t, tc);
    v.road.gain.gain.setTargetAtTime(Math.min(1, info.speed / 30) * 0.22 * (info.onRoad ? 1 : 0.5), t, tc);
    v.road.src.playbackRate.setTargetAtTime(0.6 + Math.min(1, info.speed / 40) * 0.8, t, tc);
    v.gravel.gain.gain.setTargetAtTime(info.loose * Math.min(1, info.speed / 15) * 0.35, t, tc);
    v.scrape.gain.gain.setTargetAtTime(Math.min(1, info.scrape) * 0.55, t, 0.02);
    if (v.wind) v.wind.gain.gain.setTargetAtTime(Math.min(1, (info.speed / 55) ** 2) * 0.3, t, 0.1);
    if (v.water) v.water.gain.gain.setTargetAtTime(info.water * 0.5, t, 0.1);
  }

  oneShot(buffer, gain, rate = 1, pos = null) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(g);
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 8;
      p.rolloffFactor = 1.2;
      if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; } else p.setPosition(pos[0], pos[1], pos[2]);
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    s.start();
  }

  impact(speed, pos, metal = true) {
    if (!this.ready || speed < 1.5) return;
    const now = this.ctx.currentTime;
    if (this._lastImpact && now - this._lastImpact < 0.06 && speed < this._lastImpactSpeed * 1.5) return;
    this._lastImpact = now;
    this._lastImpactSpeed = speed;
    const heavy = speed > 9;
    const list = heavy ? this.buffers.impactH : this.buffers.impactL;
    const b = list[Math.floor(Math.random() * list.length)];
    const g = Math.min(1.4, (speed / 14) ** 1.2) * (metal ? 1 : 0.6);
    this.oneShot(b, g, (metal ? 0.9 : 0.6) + Math.random() * 0.25, pos);
  }

  glass(pos) {
    if (!this.ready) return;
    const b = this.buffers.glass[Math.floor(Math.random() * 2)];
    this.oneShot(b, 0.7, 0.9 + Math.random() * 0.2, pos);
  }
  shift() { if (this.ready) this.oneShot(this.buffers.clunk, 0.25, 1 + Math.random() * 0.2); }
  thud(i, pos) { if (this.ready) this.oneShot(this.buffers.thud, Math.min(1, i), 0.8 + Math.random() * 0.3, pos); }
  blowoff(a) { if (this.ready) this.oneShot(this.buffers.bov, 0.25 * a, 1); }
  beep(hi = false) { if (this.ready) this.oneShot(hi ? this.buffers.blipHi : this.buffers.blip, 0.4, 1); }

  horn(vehicle, on) {
    const v = this.voices.get(vehicle);
    if (!v || !this.ctx) return;
    const ctx = this.ctx;
    if (on && !v.horn) {
      const big = vehicle.mass > 4000;
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = o2.type = 'sawtooth';
      o1.frequency.value = big ? 220 : 392; o2.frequency.value = big ? 277 : 494;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
      const g = ctx.createGain(); g.gain.value = 0.0;
      g.gain.setTargetAtTime(0.14, ctx.currentTime, 0.01);
      o1.connect(f); o2.connect(f); f.connect(g).connect(v.out);
      o1.start(); o2.start();
      v.horn = { o1, o2, g };
    } else if (!on && v.horn) {
      const h = v.horn;
      h.g.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      setTimeout(() => { try { h.o1.stop(); h.o2.stop(); } catch (e) { /* noop */ } }, 120);
      v.horn = null;
    }
  }

  siren(vehicle, on) {
    const v = this.voices.get(vehicle);
    if (!v || !this.ctx) return;
    const ctx = this.ctx;
    if (on && !v.siren) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.28;
      const lg = ctx.createGain(); lg.gain.value = 380;
      lfo.connect(lg).connect(o.frequency);
      o.frequency.value = 950;
      const g = ctx.createGain(); g.gain.value = 0.12;
      o.connect(g).connect(v.out);
      o.start(); lfo.start();
      v.siren = { o, lfo, g };
    } else if (!on && v.siren) {
      try { v.siren.o.stop(); v.siren.lfo.stop(); } catch (e) { /* noop */ }
      v.siren = null;
    }
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
}
