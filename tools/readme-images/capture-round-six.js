// README pictures for 0.16.0: the calmer printer cards, the Printer page's new readings
// (temperature chart, fans, lights and sensors, bed mesh), the grouped Modules card and Overview.
// Run with the app on PORT (default 8791):  PORT=8791 python3 backend/app.py  then  node this-file.js
// Writes JPGs into docs/img/ (needs Playwright and ffmpeg). Simulated farm; no printer connected.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const port = process.env.PORT || 8791;
const base = `http://127.0.0.1:${port}`;
const out = path.resolve(__dirname, '../../docs/img');
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dv-shots6-'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const jpg = (png, file, max = 1600) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-vf', `scale=min(${max}\\,iw):-2`, '-q:v', '3', path.join(out, file)]);

async function open(browser, { width = 1366, height = 1000, scale = 2 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  await ctx.addInitScript(() => { try { localStorage.setItem('dejavu1.setup-seen', '1'); localStorage.setItem('dejavu1.demo', '1'); localStorage.setItem('dejavu1.seen-version', '99.0.0'); } catch (_) {} });
  const page = await ctx.newPage();
  await page.goto(`${base}/?dashboard`, { waitUntil: 'load' });
  // The "continue on another device" offer can appear at any moment; it is not part of these screens.
  await page.addStyleTag({ content: '.handoff { display: none !important; }' });
  await wait(1500);
  await page.evaluate(() => { const t = document.getElementById('demo-toggle'); if (t && !t.checked) document.querySelector('label[for=demo-toggle]').click(); });
  await wait(1500);
  await page.evaluate(() => document.querySelectorAll('.handoff, #toasts .orb-bubble-wrap').forEach(n => n.remove()));
  return page;
}
const hideFloating = page => page.evaluate(() => document.querySelectorAll('.handoff, .live-pill, .orb-dock, .topbar, #toasts').forEach(n => { n.style.visibility = 'hidden'; }));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.DEJAVU_BROWSER || undefined, args: ['--no-sandbox'] });
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  await post('/api/files/samples');

  // Your printers: the card with the three demo printers.
  { const page = await open(browser);
    await page.evaluate(() => showTab('fleet')); await wait(2500); await hideFloating(page);
    const png = path.join(tmp, 'fleet.png');
    await page.locator('#fleet-grid').evaluateHandle(n => n.closest('section')).then(h => h.asElement().screenshot({ path: png }));
    jpg(png, 'fleet.jpg'); console.log('wrote fleet.jpg'); await page.context().close(); }

  // The Printer page for the idle demo printer: temperatures with the chart, then fans, lights,
  // sensors and the bed mesh (a saved mesh loaded first so the map shows).
  { const page = await open(browser);
    await page.evaluate(() => Workshop.selectPrinter('u1-garage')); await wait(2500);
    await page.evaluate(() => showTab('control')); await wait(1500);
    await post('/api/printer/control/mesh-profile?demo=1&printer=u1-garage', { action: 'load', profile: 'default' });
    // Warm a head and the bed so the chart shows them rising towards their targets.
    await post('/api/printer/control/temperature?demo=1&printer=u1-garage', { toolhead: 'T0', target: 210 });
    await post('/api/printer/control/bed-temperature?demo=1&printer=u1-garage', { target: 60 });
    await page.evaluate(() => { Workshop.refreshPrinter(); document.querySelector('#pp-chart [data-range="5"]').click(); });
    await wait(60000);   // a minute of readings
    await hideFloating(page);
    const top = await page.locator('#pp-heaters').boundingBox();
    await page.evaluate(y => window.scrollTo(0, y - 20), top.y + await page.evaluate(() => window.scrollY));
    await wait(800);
    const a = await page.locator('#pp-heaters').boundingBox(), b = await page.locator('#pp-mesh').boundingBox();
    const png = path.join(tmp, 'control.png');
    await page.setViewportSize({ width: 1366, height: Math.ceil(b.y + b.height + 40) });
    await wait(800);
    const a2 = await page.locator('#pp-heaters').boundingBox(), b2 = await page.locator('#pp-mesh').boundingBox();
    await page.screenshot({ path: png, clip: { x: a2.x - 8, y: a2.y - 8, width: a2.width + 16, height: b2.y + b2.height - a2.y + 16 } });
    jpg(png, 'control.jpg'); console.log('wrote control.jpg', Math.round(a.height), Math.round(b.height)); await page.context().close(); }

  // Settings, Modules: grouped, with its count and search box.
  { const page = await open(browser, { width: 1366, height: 1000 });
    await page.evaluate(() => { showTab('modules'); document.getElementById('module-list').scrollIntoView(); }); await wait(1500);
    await hideFloating(page);
    const png = path.join(tmp, 'modules.png');
    await page.locator('#module-list').evaluateHandle(n => n.closest('section')).then(h => h.asElement().screenshot({ path: png }));
    jpg(png, 'modules.jpg', 554); console.log('wrote modules.jpg'); await page.context().close(); }

  // Overview: the top 640 px of an 1100 px window at 1.45x (header, tabs, Needs you).
  { const page = await open(browser, { width: 1100, height: 640, scale: 1.45 });
    await page.evaluate(() => document.querySelectorAll('.handoff, .live-pill, .orb-dock').forEach(n => { n.style.visibility = 'hidden'; }));
    await wait(800);
    const png = path.join(tmp, 'overview.png'); await page.screenshot({ path: png });
    jpg(png, 'overview.jpg'); console.log('wrote overview.jpg'); await page.context().close(); }

  await browser.close();
})();
