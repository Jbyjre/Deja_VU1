// README pictures for the round that renamed the demo printers ("Demo printer 1/2/3"), shortened
// the tour (nine stops, glass callouts) and added Connect your phone (a QR code). Retakes the
// pictures that showed the old names or the old tour, and adds phone-connect.jpg.
// Run with the app on PORT (default 8791):  PORT=8791 python3 backend/app.py  then  node this-file.js
// Writes JPGs into docs/img/ (needs Playwright and ffmpeg). Simulated farm; no printer connected.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const port = process.env.PORT || 8791;
const base = `http://127.0.0.1:${port}`;
const out = path.resolve(__dirname, '../../docs/img');
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dv-shots5-'));
// The phone sheet shows the address a phone would open. This machine may have none, so the
// browser opens the app under an example home address and its requests are sent here (as the
// launch film's filming does, promo-video/capture/rec.js `alias`).
const HOME = 'http://192.168.1.23:8000';
const wait = ms => new Promise(r => setTimeout(r, ms));
const jpg = (png, file, max = 1600) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-vf', `scale=min(${max}\\,iw):-2`, '-q:v', '3', path.join(out, file)]);

async function open(browser, { width = 1366, height = 1000, scale = 2, url = `${base}/?dashboard`, alias = false, mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, isMobile: mobile, hasTouch: mobile });
  if (alias) await ctx.route(u => u.href.startsWith(HOME), r => r.continue({ url: base + r.request().url().slice(HOME.length),
    headers: { ...r.request().headers(), 'x-forwarded-host': new URL(HOME).host } }));
  await ctx.addInitScript(() => { try { localStorage.setItem('dejavu1.setup-seen', '1'); localStorage.setItem('dejavu1.demo', '1'); localStorage.setItem('dejavu1.seen-version', '0.8.0'); } catch (_) {} });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await wait(1500);
  await page.evaluate(() => { const t = document.getElementById('demo-toggle'); if (t && !t.checked) document.querySelector('label[for=demo-toggle]').click(); });
  await wait(1500);
  await page.evaluate(() => document.querySelectorAll('.handoff, #toasts .orb-bubble-wrap').forEach(n => n.remove()));
  return page;
}
const hideFloating = page => page.evaluate(() => document.querySelectorAll('.handoff, .live-pill, .orb-dock').forEach(n => { n.style.visibility = 'hidden'; }));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.DEJAVU_BROWSER || undefined, args: ['--no-sandbox'] });
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  await post('/api/files/samples');
  for (const id of ['auto_print', 'filament_inventory', 'print_queue', 'maintenance', 'cost_calculator', 'converter']) await post(`/api/modules/${id}/toggle`, { enabled: true });
  for (const [f, to] of [['3dbenchy_pla.gcode', 'u1-garage'], ['hex_coaster_three_colour.gcode', 'u1-garage'], ['benchy_gear_vase_skip_one.gcode', 'u1-workshop']]) await post('/api/fleet/route?demo=1', { filename: f, to });

  // Panels, as elements (the floating pill and orb hidden; the top bar too, so it can't overlap).
  const panels = [
    ['fleet.jpg', 'fleet', () => document.getElementById('fleet-grid').closest('section')],
    ['farm-desk.jpg', 'fleet', () => document.getElementById('tab-desk')],
    ['telemetry.jpg', 'overview', () => document.getElementById('telemetry'), 6000],
    ['twin-health-chamber.jpg', 'overview', () => document.querySelector('.now-row'), 3000],
    ['twin-detail.jpg', 'overview', () => { document.querySelector('#wf-picks [data-pick="head:T0"]')?.click(); return document.getElementById('twin-card'); }, 3000],
  ];
  for (const [file, tab, find, settle] of panels) {
    const page = await open(browser);
    await page.evaluate(t => showTab(t), tab);
    await wait(settle || 1500);
    await page.evaluate(() => document.querySelectorAll('.topbar').forEach(n => { n.style.visibility = 'hidden'; }));
    await hideFloating(page);
    const el = await page.evaluateHandle(find);
    await wait(1200);
    const png = path.join(tmp, file + '.png');
    await el.asElement().screenshot({ path: png });
    jpg(png, file); console.log('wrote', file);
    await page.context().close();
  }

  // Overview: the top 640 px of an 1100 px window at 1.45x (header, tabs, ribbon, Needs you).
  { const page = await open(browser, { width: 1100, height: 640, scale: 1.45 });
    await hideFloating(page); await wait(800);
    const png = path.join(tmp, 'overview.png'); await page.screenshot({ path: png });
    jpg(png, 'overview.jpg'); console.log('wrote overview.jpg'); await page.context().close(); }

  // Phone: the Overview at 390 x 844.
  { const page = await open(browser, { width: 390, height: 844, scale: 2, mobile: true });
    await wait(800);
    const png = path.join(tmp, 'phone.png'); await page.screenshot({ path: png });
    jpg(png, 'phone.jpg', 760); console.log('wrote phone.jpg'); await page.context().close(); }

  // The quick tour, at its 3D twin stop: 1280 x 860 at 2x (wide enough for the callout to sit beside it).
  { const page = await open(browser, { width: 1280, height: 860 });
    await hideFloating(page);
    await page.evaluate(() => Guide.everything({ startAt: 2 }));
    await wait(2200);
    const png = path.join(tmp, 'tour.png'); await page.screenshot({ path: png });
    jpg(png, 'tour.jpg'); console.log('wrote tour.jpg'); await page.context().close(); }

  // Confirm Print refusing the unsafe example.
  { const page = await open(browser);
    await page.evaluate(() => showTab('files')); await wait(1500);
    await page.locator('.fcd-name:text("unsafe_example_purge_past_bed.gcode") >> visible=true').first().click();
    await wait(2500);
    await page.locator('#fd-print').click(); await wait(2500);
    await hideFloating(page);
    const png = path.join(tmp, 'confirm.png');
    await page.locator('#confirm-dialog').screenshot({ path: png });
    jpg(png, 'confirm-print-refused.jpg'); console.log('wrote confirm-print-refused.jpg'); await page.context().close(); }

  // New: Connect your phone, the sheet with its QR code, under the example home address.
  { const page = await open(browser, { width: 1100, height: 820, alias: true, url: `${HOME}/?dashboard` });
    await page.evaluate(() => Phone.open()); await wait(1800);
    await hideFloating(page);
    const png = path.join(tmp, 'phone-connect.png');
    await page.locator('.phone-sheet').screenshot({ path: png });
    jpg(png, 'phone-connect.jpg'); console.log('wrote phone-connect.jpg'); await page.context().close(); }

  await browser.close();
})();
