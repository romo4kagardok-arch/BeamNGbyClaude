// usage: node test/play.mjs <out-prefix> <script-json>
// Loads the game, runs a list of steps: {eval: "js"}, {keys: ["KeyW"], ms: 2000}, {shot: "name"}, {wait: ms}
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const [prefix, stepsJson, w = 1280, h = 720] = process.argv.slice(2);
const steps = JSON.parse(stepsJson);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (!m.text().includes('GPU stall')) logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
await page.goto('http://127.0.0.1:8123/index.html');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
for (const s of steps) {
  if (s.eval) { const r = await page.evaluate(s.eval); if (r !== undefined) logs.push('eval: ' + JSON.stringify(r)); }
  if (s.keys) { for (const k of s.keys) await page.keyboard.down(k); await page.waitForTimeout(s.ms || 1000); for (const k of s.keys) await page.keyboard.up(k); }
  if (s.press) await page.keyboard.press(s.press);
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.shot) await page.screenshot({ path: `${prefix}-${s.shot}.png` });
}
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
