// Procedurally drawn canvas textures for the world (no external image files).
import * as THREE from 'three';
import { rng } from '../core/math.js';

function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = opts.aniso ?? 8;
  if (!opts.linear) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function noiseFill(g, w, h, base, amp, seed, size = 1) {
  const R = rng(seed);
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const n = (R() - 0.5) * amp;
    img.data[i * 4] = base[0] + n;
    img.data[i * 4 + 1] = base[1] + n;
    img.data[i * 4 + 2] = base[2] + n;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  if (size > 1) {
    g.globalAlpha = 0.5;
    g.drawImage(g.canvas, 0, 0, w / size, h / size, 0, 0, w, h);
    g.globalAlpha = 1;
  }
}

let cache = null;
export function worldTextures() {
  if (cache) return cache;
  const R = rng(99);
  const asphaltBase = (g, w, h, seed) => {
    noiseFill(g, w, h, [78, 79, 82], 34, seed);
    for (let i = 0; i < 260; i++) {
      const v = R() < 0.5 ? 40 : 120;
      g.fillStyle = `rgba(${v},${v},${v + 2},${0.05 + R() * 0.08})`;
      const r = 2 + R() * 14;
      g.beginPath();
      g.arc(R() * w, R() * h, r, 0, 7);
      g.fill();
    }
    // tyre wear lanes
    g.fillStyle = 'rgba(30,30,32,0.12)';
  };
  cache = {
    // 2-lane road: u across (0..1), v along (repeat every 12 m)
    road2: canvasTex(256, 512, (g, w, h) => {
      asphaltBase(g, w, h, 1);
      g.fillStyle = 'rgba(25,25,27,0.18)';
      g.fillRect(w * 0.18, 0, w * 0.1, h); g.fillRect(w * 0.72, 0, w * 0.1, h);
      g.fillStyle = '#e8e8e0';
      g.fillRect(w * 0.03, 0, 5, h); g.fillRect(w * 0.97 - 5, 0, 5, h);
      g.fillStyle = '#f0f0e8';
      g.fillRect(w * 0.5 - 3, 0, 6, h * 0.45);
    }),
    road4: canvasTex(512, 512, (g, w, h) => {
      asphaltBase(g, w, h, 2);
      g.fillStyle = '#e8e8e0';
      g.fillRect(w * 0.025, 0, 6, h); g.fillRect(w * 0.975 - 6, 0, 6, h);
      g.fillStyle = '#e8c840';
      g.fillRect(w * 0.5 - 9, 0, 6, h); g.fillRect(w * 0.5 + 3, 0, 6, h);
      g.fillStyle = '#f0f0e8';
      g.fillRect(w * 0.26 - 3, 0, 6, h * 0.3); g.fillRect(w * 0.74 - 3, 0, 6, h * 0.3);
    }),
    track: canvasTex(256, 512, (g, w, h) => {
      noiseFill(g, w, h, [62, 63, 66], 26, 3);
      g.fillStyle = 'rgba(15,15,15,0.25)';
      g.fillRect(w * 0.3, 0, w * 0.25, h);
      g.fillStyle = '#f2f2f2';
      g.fillRect(w * 0.02, 0, 6, h); g.fillRect(w * 0.98 - 6, 0, 6, h);
    }),
    runway: canvasTex(512, 512, (g, w, h) => {
      noiseFill(g, w, h, [128, 128, 124], 26, 4);
      g.strokeStyle = 'rgba(60,60,60,0.5)';
      for (let y = 0; y < h; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      for (let x = 0; x < w; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      g.fillStyle = '#f4f4f4';
      g.fillRect(w * 0.5 - 4, 0, 8, h * 0.5);
      g.fillRect(w * 0.03, 0, 8, h); g.fillRect(w * 0.97 - 8, 0, 8, h);
    }),
    street: canvasTex(256, 512, (g, w, h) => {
      asphaltBase(g, w, h, 5);
      g.fillStyle = '#e8e8e0';
      g.fillRect(w * 0.5 - 2, 0, 4, h * 0.4);
      g.fillStyle = '#9a9a96';
      g.fillRect(0, 0, w * 0.04, h); g.fillRect(w * 0.96, 0, w * 0.04, h);
    }),
    dirt: canvasTex(256, 256, (g, w, h) => {
      noiseFill(g, w, h, [122, 98, 70], 40, 6);
      for (let i = 0; i < 400; i++) {
        g.fillStyle = `rgba(${90 + R() * 60},${70 + R() * 50},${50 + R() * 30},0.5)`;
        g.fillRect(R() * w, R() * h, 2 + R() * 4, 2 + R() * 4);
      }
      g.fillStyle = 'rgba(70,55,40,0.25)';
      g.fillRect(w * 0.2, 0, w * 0.15, h); g.fillRect(w * 0.65, 0, w * 0.15, h);
    }),
    detail: canvasTex(512, 512, (g, w, h) => {
      noiseFill(g, w, h, [200, 200, 200], 70, 7);
      for (let i = 0; i < 3000; i++) {
        const v = 150 + R() * 105;
        g.fillStyle = `rgba(${v},${v},${v},0.35)`;
        g.fillRect(R() * w, R() * h, 1 + R() * 3, 3 + R() * 6);
      }
    }),
    concrete: canvasTex(256, 256, (g, w, h) => {
      noiseFill(g, w, h, [168, 166, 160], 26, 8);
      g.strokeStyle = 'rgba(80,80,80,0.6)';
      g.lineWidth = 2;
      g.strokeRect(0, 0, w, h);
      for (let i = 0; i < 30; i++) {
        g.fillStyle = `rgba(90,88,84,${R() * 0.15})`;
        g.beginPath(); g.arc(R() * w, R() * h, 4 + R() * 20, 0, 7); g.fill();
      }
    }),
    wood: canvasTex(256, 256, (g, w, h) => {
      noiseFill(g, w, h, [150, 110, 66], 30, 9);
      for (let y = 0; y < h; y += 32) {
        g.fillStyle = 'rgba(60,40,20,0.7)';
        g.fillRect(0, y, w, 3);
        for (let k = 0; k < 6; k++) {
          g.strokeStyle = `rgba(90,60,30,${0.3 + R() * 0.3})`;
          g.beginPath(); g.moveTo(0, y + 6 + k * 4); g.bezierCurveTo(w / 3, y + 4 + k * 4 + R() * 6, w * 0.6, y + 8 + k * 4 - R() * 6, w, y + 6 + k * 4); g.stroke();
        }
      }
    }),
    metal: canvasTex(256, 256, (g, w, h) => {
      noiseFill(g, w, h, [120, 124, 128], 20, 10);
      g.fillStyle = 'rgba(60,62,66,0.8)';
      for (let x = 0; x < w; x += 32) for (let y = 0; y < h; y += 32) {
        g.fillRect(x + 12, y + 6, 8, 3); g.fillRect(x + 12, y + 22, 8, 3);
      }
    }),
    hazard: canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#f2c400'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#111';
      for (let i = -4; i < 8; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 16 + h, h); g.lineTo(i * 32 + h, h); g.fill(); }
    }),
    tires: canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#121212'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
        const cx = x * 32 + 16 + (y % 2) * 16, cy = y * 32 + 16;
        g.fillStyle = '#262626'; g.beginPath(); g.arc(cx, cy, 15, 0, 7); g.fill();
        g.fillStyle = '#0a0a0a'; g.beginPath(); g.arc(cx, cy, 7, 0, 7); g.fill();
      }
      g.fillStyle = 'rgba(220,30,30,0.85)'; g.fillRect(0, h * 0.42, w, h * 0.16);
    }),
    curb: canvasTex(128, 32, (g, w, h) => {
      g.fillStyle = '#d42020'; g.fillRect(0, 0, w / 2, h);
      g.fillStyle = '#f2f2f2'; g.fillRect(w / 2, 0, w / 2, h);
    }),
    checker: canvasTex(128, 32, (g, w, h) => {
      for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#fafafa';
        g.fillRect(x * 8, y * 8, 8, 8);
      }
    }),
    sidewalk: canvasTex(256, 256, (g, w, h) => {
      noiseFill(g, w, h, [150, 148, 142], 18, 11);
      g.strokeStyle = 'rgba(90,90,86,0.7)';
      for (let x = 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let y = 0; y <= h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    }),
    crate: canvasTex(256, 256, (g, w, h) => {
      noiseFill(g, w, h, [170, 128, 76], 28, 12);
      g.strokeStyle = '#6b4a24'; g.lineWidth = 18;
      g.strokeRect(9, 9, w - 18, h - 18);
      g.beginPath(); g.moveTo(9, 9); g.lineTo(w - 9, h - 9); g.stroke();
      g.lineWidth = 3;
      for (let y = 40; y < h; y += 44) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    }),
  };
  cache.facades = [0, 1, 2, 3, 4].map((style) => facadeTexture(style));
  cache.facadeEmissive = [0, 1, 2, 3, 4].map((style) => facadeTexture(style, true));
  return cache;
}

const FACADE = [
  { wall: [176, 160, 140], win: [40, 52, 66], frame: [230, 225, 215], cols: 4, rows: 4 },
  { wall: [120, 128, 136], win: [70, 98, 122], frame: [70, 74, 80], cols: 3, rows: 4, glassy: true },
  { wall: [150, 82, 64], win: [36, 44, 54], frame: [210, 200, 186], cols: 3, rows: 3 },
  { wall: [212, 206, 190], win: [52, 64, 78], frame: [160, 150, 132], cols: 5, rows: 4 },
  { wall: [60, 74, 92], win: [110, 150, 180], frame: [40, 48, 60], cols: 2, rows: 4, glassy: true },
];

// one tile = 4 window columns x 4 floors; mapped with u = metres / 14, v = metres / 12.8
function facadeTexture(style, emissive = false) {
  const F = FACADE[style];
  const R = rng(500 + style * 13 + (emissive ? 7 : 0));
  return canvasTex(256, 256, (g, w, h) => {
    if (emissive) {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    } else {
      noiseFill(g, w, h, F.wall, 18, 20 + style);
    }
    const cw = w / F.cols, rh = h / F.rows;
    for (let cx = 0; cx < F.cols; cx++) for (let ry = 0; ry < F.rows; ry++) {
      const x = cx * cw, y = ry * rh;
      const mx = F.glassy ? cw * 0.06 : cw * 0.2, my = F.glassy ? rh * 0.08 : rh * 0.22;
      if (emissive) {
        const lit = R() < 0.35;
        if (lit) {
          const warm = R() < 0.7;
          g.fillStyle = warm ? `rgb(${230 + R() * 25},${180 + R() * 40},${110 + R() * 40})` : `rgb(${170},${200},${235})`;
          g.fillRect(x + mx, y + my, cw - mx * 2, rh - my * 1.6);
        }
      } else {
        g.fillStyle = `rgb(${F.frame.join(',')})`;
        g.fillRect(x + mx - 3, y + my - 3, cw - mx * 2 + 6, rh - my * 1.6 + 6);
        const v = R() * 30;
        g.fillStyle = `rgb(${F.win[0] + v},${F.win[1] + v},${F.win[2] + v})`;
        g.fillRect(x + mx, y + my, cw - mx * 2, rh - my * 1.6);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(x + mx, y + my, (cw - mx * 2) * 0.4, rh - my * 1.6);
      }
    }
  });
}
