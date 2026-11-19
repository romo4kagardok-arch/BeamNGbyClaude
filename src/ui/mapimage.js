// Renders the generated world into a 2D canvas (used for the minimap and the big map screen).
import { SURF } from '../physics/statics.js';

const SURF_COL = {
  [SURF.GRASS]: [86, 122, 62], [SURF.ASPHALT]: [70, 72, 76], [SURF.DIRT]: [128, 104, 74], [SURF.SAND]: [196, 182, 140],
  [SURF.CONCRETE]: [150, 150, 146], [SURF.ROCK]: [118, 112, 104], [SURF.SNOW]: [235, 238, 242], [SURF.MUD]: [92, 74, 52],
};

export function renderMapImage(map, size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const T = map.T;
  const img = g.createImageData(size, size);
  const half = T.size / 2;
  const tmp = new Float64Array(4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = -half + ((px + 0.5) / size) * T.size, z = -half + ((py + 0.5) / size) * T.size;
      T.sample(x, z, tmp);
      const s = T.surfaceAt(x, z);
      let col = SURF_COL[s] || SURF_COL[0];
      const shade = 0.75 + 0.5 * (tmp[1] * -0.6 + tmp[3] * -0.4 + 0.5) * 0.6;
      const hh = Math.min(1, Math.max(0, (tmp[0] - 0) / 220));
      let r = col[0] * shade * (0.85 + hh * 0.4), gg = col[1] * shade * (0.85 + hh * 0.4), b = col[2] * shade * (0.85 + hh * 0.4);
      const wl = T.waterLevelAt(x, z);
      if (wl !== null && tmp[0] < wl) { r = 40; gg = 90; b = 140; }
      const k = (py * size + px) * 4;
      img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const sc = size / T.size;
  const tx = (x) => (x + half) * sc, tz = (z) => (z + half) * sc;
  // roads
  for (const r of map.roads) {
    g.strokeStyle = r.surface === SURF.DIRT ? '#9c7a52' : r.kind === 'track' ? '#30323a' : r.kind === 'highway' ? '#e0c060' : '#d8d8d8';
    g.lineWidth = Math.max(1.5, r.width * sc * (r.kind === 'highway' ? 1.0 : 0.9));
    g.lineJoin = 'round';
    g.beginPath();
    r.pts.forEach((p, i) => (i ? g.lineTo(tx(p[0]), tz(p[1])) : g.moveTo(tx(p[0]), tz(p[1]))));
    if (r.closed) g.closePath();
    g.stroke();
  }
  // buildings
  g.fillStyle = '#5a5e68';
  for (const b of map.buildings) g.fillRect(tx(b.x - b.w / 2), tz(b.z - b.d / 2), b.w * sc, b.d * sc);
  g.fillStyle = '#3b3d42';
  for (const s of map.structures) if (s.kind !== 'pole') g.fillRect(tx(s.x - s.hx), tz(s.z - s.hz), Math.max(1, s.hx * 2 * sc), Math.max(1, s.hz * 2 * sc));
  // trees (dots)
  g.fillStyle = 'rgba(30,60,28,0.55)';
  for (const t of map.trees) g.fillRect(tx(t.x) - 0.8, tz(t.z) - 0.8, 1.6, 1.6);
  return c;
}

export function mapLabels(map) {
  const out = [];
  for (const z of Object.values(map.zones)) out.push({ x: (z.x0 + z.x1) / 2, z: (z.z0 + z.z1) / 2, text: z.name });
  out.push({ x: 120, z: -820, text: 'Горы' });
  out.push({ x: map.lake.x, z: map.lake.z, text: 'Озеро' });
  return out;
}
