#!/usr/bin/env node
/* The faults the live run on a real U1 found (22 November 2026), in a real browser, one scenario each.
 *
 *   node tools/livefix-check.js                 every scenario
 *   node tools/livefix-check.js --only resume   some of them (resume, bed, dirty)
 *   node tools/livefix-check.js --probe         only says whether Playwright and a Chromium are available
 *
 * Each scenario starts Deja Vu1 (backend/app.py) on a spare port in a temporary data folder, adds the Moonraker stand-in
 * (tests/fake_moonraker_serve.py, a pretend printer, not a real U1) and drives the page in Chromium. Prints one line per check;
 * exits 0 only when every check passed. tests/test_livefix_browser.py runs it.
 *
 *   resume  a U1 that still holds a halted print shows the Saved print card on the Printer screen; Discard asks twice, sends the printer's own
 *           command and the card goes
 *   bed     Confirm Print for a file after a print ended on the bed shows where that print sat and keeps Start print off until the tick
 *   errcard the explain button on a printer's error opens the explanation and never the print tile's own panel, even when the tile repaints
 *           between the press and the release of the mouse
 *   phone   at 390 px on a phone, the buttons a finger presses are at least 32 px high (the live run found 47 under that)
 *   looks   switching the look to Workbench and back to Glass leaves the Printer screen as it was (the twin drawn, the tiles in place)
 *   dirty   a pause the printer raised for a dirty bed shows the printer's own words on the Printer screen, with what to do
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* --shots <folder>: pictures of each scenario at 1366 and 390 px, light and dark, for looking at. */
async function shots(page, name, target) {
  const dir = option('--shots');
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  for (const [label, size] of [['1366', { width: 1366, height: 800 }], ['390', { width: 390, height: 844 }]]) {
    await page.setViewportSize(size);
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate(m => { try { document.documentElement.dataset.theme = m; } catch (e) { /* ignore */ } }, scheme);
      await sleep(500);
      await page.screenshot({ path: path.join(dir, `${name}-${label}-${scheme}.png`) });
    }
  }
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
}

function findChromium(playwright) {
  const candidates = [process.env.DEJAVU_BROWSER, '/usr/bin/chromium', '/opt/pw-browsers/chromium', '/usr/bin/chromium-browser'];
  try {
    candidates.push(playwright.chromium.executablePath());
  } catch (e) {
    /* no bundled browser */
  }
  return candidates.find(p => p && fs.existsSync(p)) || null;
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const request = (method, url, body) =>
  new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(url, { method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, res => {
      let text = '';
      res.on('data', c => (text += c));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (e) {
          /* not JSON */
        }
        resolve({ status: res.statusCode, body: text, json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });

async function startServer() {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dejavu-livefix-'));
  const env = { ...process.env, PORT: String(port), DEJAVU_DATA_DIR: data, DEJAVU_NO_BROWSER: '1' };
  delete env.DEJAVU_TESTER;
  const child = spawn('python3', [path.join(ROOT, 'backend', 'app.py')], { cwd: ROOT, env, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await request('GET', base + '/api/health')).status === 200) return { base, child, data };
    } catch (e) {
      /* not up yet */
    }
    await sleep(200);
  }
  child.kill();
  throw new Error('The server did not answer /api/health within 20 seconds');
}

function startPrinter() {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [path.join(ROOT, 'tests', 'fake_moonraker_serve.py'), '0.05'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'ignore'] });
    child.stdout.once('data', d => resolve({ child, url: String(d).trim(), tell: cmd => child.stdin.write(JSON.stringify(cmd) + '\n') }));
    child.once('error', reject);
    child.once('exit', code => reject(new Error('the stand-in printer exited with ' + code)));
  });
}

const results = { passed: 0, failed: [] };
function check(ok, text) {
  if (ok) {
    results.passed += 1;
    console.log('ok   ' + text);
  } else {
    results.failed.push(text);
    console.log('FAIL ' + text);
  }
}

/* The server with the stand-in printer added, and a page that reports every script error. */
async function openPage(browser, base, printerUrl, size, device) {
  const added = await request('POST', base + '/api/fleet/registry', { name: 'Bench U1', moonraker_url: printerUrl });
  if (added.status !== 200) throw new Error('could not add the stand-in printer: ' + added.body);
  const id = added.json.id;
  for (let i = 0; i < 60; i++) {
    const h = await request('GET', base + '/api/printer?printer=' + id);
    if (h.json && h.json.state) break;
    await sleep(250);
  }
  const context = await browser.newContext(device ? { ...device, serviceWorkers: 'block' } : { viewport: size || { width: 1366, height: 800 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('dejavu1.setup-seen', '1');
    } catch (e) {
      /* no storage */
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message ? e.message : e)));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
  });
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.Workshop && typeof showTab === 'function' && document.readyState === 'complete', null, { timeout: 30000 });
  await sleep(800);
  await page.evaluate(pid => Workshop.selectPrinter(pid, null, true), id);
  await page.evaluate(() => showTab('control'));
  await sleep(500);
  return { page, errors, context, id };
}

/* ---- the scenarios ---------------------------------------------------------------------------------------------- */

async function resume(browser, base, printer) {
  const { page, errors, context, id } = await openPage(browser, base, printer.url);
  const card = () => page.evaluate(() => (document.querySelector('#cp-saved [data-resume-discard]') ? document.querySelector('#cp-saved .rs-card').textContent : ''));
  check(!(await card()), 'resume: a printer that holds nothing shows no Saved print card');
  printer.tell({ set: ['virtual_sdcard', { pl_env_valid: true }] });
  await page.waitForFunction(() => !!document.querySelector('#cp-saved [data-resume-discard]'), null, { timeout: 15000 });
  const text = await card();
  check(/still holds a halted print/.test(text) && /on the bed/.test(text), 'resume: the card says the printer still holds a halted print and can restart it onto the bed');
  let said = false;
  for (let i = 0; i < 40 && !said; i++) {
    const fleet = await request('GET', base + '/api/fleet');
    said = !!(fleet.json && (fleet.json.printers || []).some(p => p.resume_saved === true));
    if (!said) await sleep(250);
  }
  check(said, 'resume: the fleet row says so too, for the Needs you list');
  await shots(page, 'resume');
  await page.click('#cp-saved [data-resume-discard]');
  check(/Press again to discard/.test(await page.textContent('#cp-saved [data-resume-discard]')), 'resume: the first press only arms the button');
  check((await card()) !== '', 'resume: and the card stays until the second press');
  await page.click('#cp-saved [data-resume-discard]');
  await page.waitForFunction(() => !document.querySelector('#cp-saved [data-resume-discard]'), null, { timeout: 15000 });
  check(true, 'resume: the second press sent the discard and the card went once the printer said it holds nothing');
  check(errors.length === 0, 'resume: no script error (' + (errors.join(' | ').slice(0, 160) || 'none') + ')');
  await context.close();
}

async function dirty(browser, base, printer) {
  const { page, errors, context } = await openPage(browser, base, printer.url);
  printer.tell({ print: 'benchy.gcode' });
  await sleep(600);
  printer.tell({ raise: [2, 532, 0, 1, 'detected dirty bed'] });
  await page.waitForFunction(() => /dirty bed/.test((document.querySelector('#tile-job-body .eh-strip') || {}).textContent || ''), null, { timeout: 15000 });
  const text = await page.evaluate(() => document.querySelector('#tile-job-body .eh-strip').textContent);
  check(/detected dirty bed/.test(text) && /press Resume/.test(text), 'dirty: the Printer screen shows the printer\'s own words ("detected dirty bed") and what to do');
  await shots(page, 'dirty');
  check(errors.length === 0, 'dirty: no script error (' + (errors.join(' | ').slice(0, 160) || 'none') + ')');
  await context.close();
}

async function bed(browser, base, printer) {
  await request('POST', base + '/api/files/samples', {});
  const { page, errors, context, id } = await openPage(browser, base, printer.url);
  const name = '3dbenchy_pla.gcode';
  const started = await request('POST', base + '/api/printer/control/start?printer=' + id, { filename: name, confirmed: true });
  check(started.status === 200, 'bed: a print starts on the stand-in printer (' + started.status + ')');
  printer.tell({ finish: 1 });
  for (let i = 0; i < 40; i++) {
    const q = await request('GET', base + '/api/queue?printer=' + id);
    if (q.json && q.json.bed && q.json.bed.state === 'awaiting_clear') break;
    await sleep(250);
  }
  printer.tell({ set: ['print_stats', { state: 'standby' }] });
  await sleep(800);
  await page.evaluate(n => Workshop.openConfirm(n), name);
  await page.waitForFunction(() => !!document.querySelector('#confirm-bed-clear'), null, { timeout: 15000 });
  const info = await page.evaluate(() => ({
    text: document.querySelector('.gate-bed').textContent,
    map: !!document.querySelector('.gate-bed-map .left') && !!document.querySelector('.gate-bed-map .this'),
    go: document.getElementById('confirm-go').disabled,
  }));
  check(/sat at X/.test(info.text) && /overlaps it/.test(info.text), 'bed: Confirm Print says where the last print sat and that this one overlaps it');
  check(info.map, 'bed: the plate map draws both places');
  check(info.go, 'bed: Start print is off until the bed is ticked');
  await shots(page, 'bed');
  await page.check('#confirm-bed-clear');
  check(await page.evaluate(() => !document.getElementById('confirm-go').disabled), 'bed: ticking it turns Start print on');
  await page.uncheck('#confirm-bed-clear');
  check(await page.evaluate(() => document.getElementById('confirm-go').disabled), 'bed: and unticking turns it off again');
  await page.check('#confirm-bed-clear');
  await page.click('#confirm-go');
  await page.waitForFunction(() => document.getElementById('confirm-dialog').hidden || !document.getElementById('confirm-dialog').open, null, { timeout: 15000 }).catch(() => null);
  const after = await request('GET', base + '/api/printer?printer=' + id);
  check(after.json && after.json.state === 'printing', 'bed: with the tick the print started (' + (after.json && after.json.state) + ')');
  check(errors.length === 0, 'bed: no script error (' + (errors.join(' | ').slice(0, 160) || 'none') + ')');
  await context.close();
}

async function errcard(browser, base, printer) {
  const { page, errors, context } = await openPage(browser, base, printer.url);
  printer.tell({ print: 'benchy.gcode' });
  await sleep(600);
  printer.tell({ raise: [2, 532, 0, 1, 'detected dirty bed'] });
  await page.waitForSelector('#tile-job-body [data-errhelp]', { timeout: 15000 });
  const box = await page.locator('#tile-job-body [data-errhelp]').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.evaluate(() => { window.__ev = []; for (const n of ['pointerdown', 'mousedown', 'mouseup', 'click']) document.addEventListener(n, e => window.__ev.push(n + ':' + (e.target.id || e.target.className || e.target.tagName) + (e.target.closest && e.target.closest('[data-errhelp]') ? '(errhelp)' : '')), true); });
  await page.mouse.move(x, y);
  await page.mouse.down();
  // The tile repaints while the button is held down, as it does whenever the printer reports a new figure.
  await page.evaluate(() => { const b = document.getElementById('tile-job-body'); b.dataset.sig = ''; b.innerHTML = b.innerHTML.replace('Paused', 'Paused '); });
  await page.mouse.up();
  await sleep(250);
  if (flag('--debug')) console.log(JSON.stringify(await page.evaluate(() => window.__ev)));
  const seen = await page.evaluate(() => ({
    explain: !!(document.getElementById('eh-body') && document.getElementById('eh-body').closest('dialog') && document.getElementById('eh-body').closest('dialog').open),
    tile: window.Cockpit ? Cockpit.isOpen() : null,
  }));
  check(seen.explain, 'errcard: pressing the explain button opens the explanation even though the tile repainted under the mouse');
  check(seen.tile === false, 'errcard: and the print tile\'s own panel stays shut');
  // A press on something else straight afterwards must arrive: only the click that belongs to the first press is dropped.
  await page.locator('#eh-close').click();
  await sleep(150);
  check(await page.evaluate(() => !document.getElementById('eh-body').closest('dialog').open), 'errcard: a press on the window\'s Close button right after opening it is not swallowed');
  check(errors.length === 0, 'errcard: no script error (' + (errors.join(' | ').slice(0, 160) || 'none') + ')');
  await context.close();
}

async function looks(browser, base, printer) {
  const { page, errors, context } = await openPage(browser, base, printer.url);
  await sleep(2500);
  const look = () => page.evaluate(() => {
    const c = document.querySelector('#p-stage canvas'), r = c ? c.getBoundingClientRect() : null;
    let lit = 0;
    try {
      const probe = document.createElement('canvas'); probe.width = 64; probe.height = 48;
      const g = probe.getContext('2d'); g.drawImage(c, 0, 0, 64, 48);
      const d = g.getImageData(0, 0, 64, 48).data;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 20 && (d[i] + d[i + 1] + d[i + 2]) < 700) lit += 1;
    } catch (e) { lit = -1; }
    const tags = document.querySelectorAll('.t3-tag').length;
    return { canvas: !!c, w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0, tags, lit,
      tile: !!document.querySelector('#tile-job-body') && document.querySelector('#tile-job-body').textContent.trim().length > 0,
      palette: document.querySelectorAll('#cp-dock .dk-btn').length };
  });
  const first = await look();
  // As a person does it: Settings, Look & layout, Workbench, Glass, and then the Printer screen.
  await page.evaluate(() => showTab('prefs'));
  await sleep(600);
  await page.evaluate(() => DVTheme.setLook('workbench'));
  await sleep(1200);
  await page.evaluate(() => showTab('control'));
  await sleep(1500);
  const mid = await look();
  await page.evaluate(() => showTab('prefs'));
  await sleep(600);
  await page.evaluate(() => DVTheme.setLook('glass'));
  await sleep(1200);
  await page.evaluate(() => showTab('control'));
  await sleep(2500);
  const last = await look();
  if (flag('--debug')) console.log(JSON.stringify({ first, mid, last }));
  await shots(page, 'looks');
  check(first.canvas && first.tags > 0 && first.tile && first.palette > 0, 'looks: the Printer screen starts drawn (twin, tags, tile, palette)');
  check(last.canvas && last.w === first.w && last.h === first.h, 'looks: back on Glass the twin has the size it had');
  check(last.tags === first.tags && last.tile && last.palette === first.palette, 'looks: and its tags, tile and palette are back');
  check(last.lit > 0 && (first.lit < 0 || last.lit > first.lit * 0.5), 'looks: and the twin is drawn, not blank (' + last.lit + ' of ' + first.lit + ' lit pixels)');
  check(errors.length === 0, 'looks: no script error (' + (errors.join(' | ').slice(0, 160) || 'none') + ')');
  await context.close();
}

async function phone(browser, base, printer, playwright) {
  const { page, errors, context } = await openPage(browser, base, printer.url, null, playwright.devices['iPhone 13']);
  printer.tell({ print: 'benchy.gcode' });
  await sleep(1200);
  const small = tab => page.evaluate(async t => {
    showTab(t);
    await new Promise(r => setTimeout(r, 900));
    const found = [];
    document.querySelectorAll('.btn.small, .pb-actions .btn, .chip-btn').forEach(b => {
      const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
      if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && b.offsetParent !== null && r.height < 32) found.push((b.id || b.className || b.textContent).toString().slice(0, 40) + ' in #' + ((b.closest('[id]') || {}).id || '') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + b.textContent.trim().slice(0, 20) + '"');
    });
    return found;
  }, tab);
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches && innerWidth <= 720);
  check(coarse, 'phone: the browser is a phone (coarse pointer, 390 px wide)');
  for (const tab of ['overview', 'control', 'files', 'prefs']) {
    const found = await small(tab);
    check(found.length === 0, `phone: no small button under 32 px high on ${tab} (${found.slice(0, 4).join('; ') || 'none'})`);
  }
  check(errors.length === 0, 'phone: no script error (' + (errors.join(' | ').slice(0, 160) || 'none') + ')');
  await context.close();
}

const SCENARIOS = { resume, bed, dirty, errcard, looks, phone };

(async () => {
  let playwright;
  try {
    playwright = require('playwright');
  } catch (e) {
    console.log('SKIP Playwright is not installed');
    process.exit(flag('--probe') ? 1 : 0);
  }
  const executablePath = findChromium(playwright);
  if (!executablePath) {
    console.log('SKIP no Chromium found');
    process.exit(flag('--probe') ? 1 : 0);
  }
  if (flag('--probe')) {
    console.log('ok   Playwright and Chromium are available');
    process.exit(0);
  }
  const only = (option('--only') || '').split(',').filter(Boolean);
  const browser = await playwright.chromium.launch({ executablePath, args: ['--no-sandbox'] });
  for (const [name, fn] of Object.entries(SCENARIOS)) {
    if (only.length && !only.includes(name)) continue;
    let server = null;
    let printer = null;
    try {
      server = await startServer();
      printer = await startPrinter();
      await fn(browser, server.base, printer, playwright);
    } catch (e) {
      check(false, name + ': the scenario stopped: ' + (e && e.message ? e.message : e));
    } finally {
      if (printer) {
        printer.child.stdin.end();
        printer.child.kill();
      }
      if (server) server.child.kill();
    }
  }
  await browser.close();
  console.log(results.failed.length ? `\n${results.failed.length} failed, ${results.passed} passed` : `\n${results.passed} checks passed`);
  process.exit(results.failed.length ? 1 : 0);
})();
