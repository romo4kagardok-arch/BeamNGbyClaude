import { generateMap } from '../world/mapgen.js';
import { renderMapImage, mapLabels } from '../ui/mapimage.js';
const t0 = performance.now();
const map = generateMap(7);
const t1 = performance.now();
const c = renderMapImage(map, 1024);
document.body.appendChild(c);
const g = c.getContext('2d');
g.font = '14px sans-serif'; g.fillStyle = '#fff';
for (const l of mapLabels(map)) g.fillText(l.text, (l.x + 1024) / 2 - 30, (l.z + 1024) / 2);
g.fillStyle = '#f0f';
for (const s of Object.values(map.spawns)) { g.beginPath(); g.arc((s.x + 1024) / 2, (s.z + 1024) / 2, 4, 0, 7); g.fill(); }
console.log('gen ms', (t1 - t0).toFixed(0), 'trees', map.trees.length, 'buildings', map.buildings.length, 'roads', map.roads.length, 'structs', map.structures.length);
window.__ready = true;
