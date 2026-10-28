// Screenshots for the README pictures added or changed in the October 2026
// "technical tools" round. Run with the app on PORT (default 8791) and Demo
// data available:  PORT=8791 python3 backend/app.py  then  node this-file.js
// Writes JPGs into docs/img/ (needs Playwright and ffmpeg for JPG output).
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const port = process.env.PORT || 8791;
const out = path.resolve(__dirname, '../../docs/img');
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dv-shots-'));

const shots = [
  // [file, tab, selector, prepare (in page), width]
  ['layer-planner.jpg', 'files', '.lp-card', () => document.getElementById('lp-example').click(), 1366],
  ['converter.jpg', 'files', '#convert-card', async () => { document.getElementById('cv-sample').click(); for (let i = 0; i < 60 && !document.querySelector('#cv-report .convert-report'); i++) await new Promise(r => setTimeout(r, 500)); }, 1366],
  ['farm-desk.jpg', 'fleet', '#tab-desk', null, 1366],
  ['telemetry.jpg', 'overview', '#telemetry', () => new Promise(r => setTimeout(r, 6000)), 1366],
  ['twin-detail.jpg', 'overview', '#twin-card', () => new Promise(r => setTimeout(r, 3000)), 1366],
  ['process-settings.jpg', 'files', '#np-settings', async () => { document.getElementById('np-scan').click(); await new Promise(r => setTimeout(r, 1500)); document.querySelector('[data-tab=Speed]')?.click(); }, 1366],
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.DEJAVU_BROWSER || undefined, args: ['--no-sandbox'] });
  const base = `http://127.0.0.1:${port}`;
  // Samples, every module on, and a few queued files so the Farm desk has a day to plan.
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  await post('/api/files/samples');
  for (const id of ['auto_print', 'filament_inventory', 'print_queue', 'maintenance', 'cost_calculator', 'converter']) await post(`/api/modules/${id}/toggle`, { enabled: true });
  for (const [f, to] of [['3dbenchy_pla.gcode', 'u1-garage'], ['hex_coaster_three_colour.gcode', 'u1-garage'], ['benchy_gear_vase_skip_one.gcode', 'u1-workshop']]) await post('/api/fleet/route?demo=1', { filename: f, to });
  // ONLY=converter.jpg,twin-detail.jpg retakes just those.
  const only = (process.env.ONLY || '').split(',').filter(Boolean);
  for (const [file, tab, sel, prep, width] of shots.filter(s => !only.length || only.includes(s[0]))) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 2 });
    await page.goto(`${base}/?dashboard`, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { const s = document.getElementById('setup-skip'); if (s && s.offsetParent) s.click(); });
    await page.evaluate(() => { const t = document.getElementById('demo-toggle'); if (t && !t.checked) document.querySelector('label[for=demo-toggle]').click(); });
    await page.waitForTimeout(800);
    await page.evaluate(t => showTab(t), tab);
    await page.waitForTimeout(1500);
    if (prep) await page.evaluate(prep);
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelectorAll('.handoff, .topbar, .live-pill, #toasts').forEach(n => { n.style.visibility = 'hidden'; }));
    const el = await page.$(sel);
    const png = path.join(tmp, file.replace('.jpg', '.png'));
    await el.screenshot({ path: png });
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-vf', 'scale=min(1600\\,iw):-2', '-q:v', '3', path.join(out, file)]);
    console.log('wrote', file);
    await page.close();
  }
  await browser.close();
})();
