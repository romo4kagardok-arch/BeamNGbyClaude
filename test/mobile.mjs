// usage: node test/mobile.mjs <out-prefix> <device name> <steps-json>  (Chromium phone emulation, touch events)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('/opt/node-tools/node_modules/playwright');
const [prefix, deviceName, stepsJson] = process.argv.slice(2);
const steps = JSON.parse(stepsJson);
const d = { ...devices[deviceName] };
delete d.defaultBrowserType;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext(d);
const page = await context.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[t]')) logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n')));
await page.goto('http://127.0.0.1:8123/index.html');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 150000 });
// helper available in steps: touch(selector, type, dx) dispatches a touch pointer event on an element centre
await page.evaluate(() => {
  window.__touch = (sel, type, id, dx = 0, dy = 0) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    const r = el.getBoundingClientRect();
    const ev = new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2 + dy, bubbles: true, cancelable: true, button: 0 });
    el.dispatchEvent(ev);
  };
});
for (const s of steps) {
  if (s.eval) { const r = await page.evaluate(s.eval); if (r !== undefined) logs.push('eval: ' + JSON.stringify(r)); }
  if (s.tap) await page.tap(s.tap);
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.shot) await page.screenshot({ path: `${prefix}-${s.shot}.png` });
}
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
