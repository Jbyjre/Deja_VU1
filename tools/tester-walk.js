#!/usr/bin/env node
/* Tester mode in a real browser.
 *
 *   node tools/tester-walk.js --zip FILE [--shots DIR]   the walk: off, then on, then save the report
 *   node tools/tester-walk.js --overhead [--rounds N]    what recording costs on the Printer page with the 3D twin
 *   node tools/tester-walk.js --probe                    only says whether Playwright and a Chromium are available
 *
 * The walk starts its own server and a stand-in printer (tests/fake_moonraker.py, a pretend printer, not a real one).
 *   1. Tester mode off: the pages are used and the browser sends nothing to /api/tester; the routes answer 403.
 *   2. Tester mode on, switched on in Settings like a person would: every place is opened, controls are pressed, a file
 *      is checked and printed on the stand-in printer, paused and cancelled, and three things go wrong on purpose:
 *      a request held back for 2.6 s, a button that freezes the page for 1.4 s, and an error, a failed promise and an
 *      error toast. "Something felt off" saves a note.
 *   3. Settings > Tester mode: View report opens the viewer, Save tester report downloads the zip (kept at --zip).
 *   4. With --shots, screenshots of the card and the saved report.html (opened from the zip with no network, at 1366 and
 *      390 px, light and dark) go to DIR.
 * Prints one line per check and exits 0 only when every check passed. tests/test_tester_browser.py runs it and then
 * reads the zip.
 *
 * The overhead mode alternates Tester mode off and on in fresh browsers, measures the page's frame time over a stretch that
 * includes a smoothness sample, and the time from a press to the next paint for five twin controls, and prints the medians
 * and the difference in percent. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

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

const get = url =>
  new Promise((resolve, reject) => {
    http
      .get(url, res => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });

async function startServer() {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dejavu-tester-'));
  const env = { ...process.env, PORT: String(port), DEJAVU_DATA_DIR: data, DEJAVU_NO_BROWSER: '1' };
  delete env.DEJAVU_TESTER;
  const child = spawn('python3', [path.join(ROOT, 'backend', 'app.py')], { cwd: ROOT, env, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await get(base + '/api/health')).status === 200) return { base, child, data };
    } catch (e) {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 200));
  }
  child.kill();
  throw new Error('The server did not answer /api/health within 20 seconds');
}

function startStandIn() {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [path.join(ROOT, 'tools', 'stand-in-printer.py')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.once('data', d => resolve({ child, url: String(d).trim() }));
    child.once('error', reject);
    child.once('exit', code => reject(new Error('the stand-in printer exited with ' + code)));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
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

/* A page that reports what it sends to /api/tester and what goes wrong in it. */
async function openPage(browser, base, { width = 1366, theme = 'light', offline = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width <= 720 ? 844 : 900 }, serviceWorkers: 'block', offline });
  const page = await context.newPage();
  const seen = { tester: [], problems: [] };
  page.on('request', r => {
    if (r.url().startsWith(base) && r.url().includes('/api/tester/')) seen.tester.push(r.method() + ' ' + r.url().replace(base, ''));
  });
  page.on('pageerror', e => {
    // Playwright's own script reads navigator.serviceWorker in every frame, and that read throws inside a sandboxed
    // frame such as the report viewer. It is the harness, not the app (it also happens on about:blank).
    if (!/walk: deliberate|Service worker is disabled because the context is sandboxed/.test(e.message)) seen.problems.push('script error: ' + e.message);
  });
  page.on('console', m => {
    // 4xx and 5xx lines are the browser logging answers the walk asked for on purpose (a refused move, a stand-in printer
    // that lacks a feature); they are checked in the report, not here.
    if (m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of [45]\d\d|deliberate/i.test(m.text())) {
      seen.problems.push('console error: ' + m.text());
    }
  });
  await page.goto(base + '/?dashboard', { waitUntil: 'load' });
  await page.waitForSelector('body[data-tab]', { timeout: 15000 });
  await page.keyboard.press('Escape');
  await page.evaluate(t => {
    document.documentElement.dataset.theme = t;
  }, theme);
  return { context, page, seen };
}

const post = (page, url, body) =>
  page.evaluate(
    async ([u, b]) => {
      const res = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    },
    [url, body]
  );
const getJson = (page, url) =>
  page.evaluate(async u => {
    const res = await fetch(u);
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }, url);

async function goTo(page, id, width) {
  if (width > 720) {
    const link = page.locator('a.rail-item[data-dest="' + id + '"]');
    if (await link.count()) {
      await link.first().click();
      await sleep(450);
      return;
    }
  }
  await page.evaluate(h => {
    location.hash = '#/' + h;
  }, id);
  await sleep(450);
}

async function openTesterCard(page, width) {
  await goTo(page, 'settings', width);
  const part = page.locator('button:has-text("Tester mode")').first();
  await part.click();
  await sleep(500);
}

/* ---- the walk ---------------------------------------------------------------------------------------- */

async function walk(browser, server, standIn, width) {
  const { base } = server;
  // 1. Off: the pages are used and nothing is sent.
  const off = await openPage(browser, base, { width });
  await post(off.page, '/api/fleet/registry', { name: 'Walk stand-in', moonraker_url: standIn.url });
  await sleep(1500);
  for (const id of ['overview', 'printers', 'printer', 'files', 'settings']) await goTo(off.page, id, width);
  await sleep(1500);
  check(off.seen.tester.length === 0, 'Tester mode off: the browser sent nothing to /api/tester (' + off.seen.tester.length + ' requests)');
  const statusOff = await getJson(off.page, '/api/tester/status');
  check(statusOff.status === 403, 'Tester mode off: /api/tester/status answers 403 (got ' + statusOff.status + ')');
  const eventsOff = await post(off.page, '/api/tester/events', { events: [{ k: 'click', ctl: '#x' }] });
  check(eventsOff.status === 403, 'Tester mode off: /api/tester/events answers 403 (got ' + eventsOff.status + ')');
  check(!fs.existsSync(path.join(server.data, 'tester')), 'Tester mode off: no tester folder was written');
  await off.context.close();

  // 2. On, switched on in Settings like a person would.
  const { context, page, seen } = await openPage(browser, base, { width });
  await sleep(1500);
  await openTesterCard(page, width);
  const card = await page.locator('#tester-card').count();
  check(card === 1, 'Settings has the Tester mode card');
  await page.locator('label[for="tester-setting"]').click();
  await page.waitForSelector('#tester-felt', { timeout: 8000 }).catch(() => {});
  check((await page.locator('#tester-felt').count()) === 1, 'Switching it on shows "Something felt off" on the screen');
  check(await page.locator('#tester-live').isVisible(), 'The counts and buttons appear once it is on');

  const places = ['overview', 'printers', 'printer', 'files', 'slice', 'queue', 'filament', 'maintenance', 'ai', 'settings', 'prefs', 'automations'];
  for (const id of places) {
    await goTo(page, id, width);
    if (id === 'printer') {
      for (const sel of ['[data-view="front"]', '[data-view="top"]', '[data-view="iso"]', '[data-twin="zoom-in"]', '[data-twin="zoom-out"]', '[data-mode="drawing"]', '[data-mode="model"]']) {
        const el = page.locator(sel).first();
        if (await el.count()) {
          await el.click().catch(() => {});
          await sleep(150);
        }
      }
      await sleep(7500); // long enough for a smoothness sample of the twin
    }
  }

  // A file, Confirm Print, a print on the stand-in printer, pause, cancel.
  await post(page, '/api/files/samples', {});
  const files = await getJson(page, '/api/files');
  let gcode = null;
  for (const f of ((files.body && files.body.files) || []).filter(f => /\.gcode$/i.test(f.name || ''))) {
    const verdict = await getJson(page, '/api/print/confirm?file=' + encodeURIComponent(f.name));
    if (verdict.body && verdict.body.verdict && verdict.body.verdict !== 'blocked') {
      gcode = f;
      break;
    }
  }
  check(!!gcode, 'The sample files include a G-code file that Confirm Print lets through')
  if (gcode) {
    const gate = await getJson(page, '/api/print/confirm?file=' + encodeURIComponent(gcode.name));
    check(gate.status === 200, 'Confirm Print answers for a sample file (' + gate.status + ')');
    const start = await post(page, '/api/printer/control/start', { filename: gcode.name, confirmed: true });
    console.log('     start answered ' + start.status + (start.body && start.body.error ? ': ' + String(start.body.error).slice(0, 120) : ''));
    await sleep(3500);
    await goTo(page, 'printer', width);
    await sleep(1200);
    const pause = page.locator('#ctrl-pause-resume');
    if ((await pause.count()) && (await pause.isEnabled())) {
      await pause.click();
      await sleep(2500);
      await pause.click().catch(() => {});
      await sleep(2500);
    }
    await post(page, '/api/printer/control/cancel', {});
    await sleep(1500);
    // The same refusal a person would meet: moving the head during a print is refused with the printer's words.
    await post(page, '/api/printer/control/home', { axes: ['X'] });
  }

  // Three things go wrong on purpose.
  await page.route('**/api/maintenance/snooze', async route => {
    await sleep(2600);
    await route.continue();
  });
  await post(page, '/api/maintenance/snooze', { task_id: 'nozzle', days: 1 });
  await page.route('**/api/maintenance/snooze', route => route.continue());
  await goTo(page, 'printer', width);
  await page.evaluate(() => {
    const target = document.querySelector('[data-view="front"]');
    if (target) target.addEventListener('click', () => { const t = performance.now(); while (performance.now() - t < 1400); }, true);
  });
  await page.locator('[data-view="front"]').first().click();
  await sleep(2500);
  await page.evaluate(() => {
    setTimeout(() => { throw new Error('walk: deliberate error'); }, 10);
    Promise.reject(new Error('walk: deliberate rejection'));
    if (typeof toast === 'function') toast('Walk: deliberate error toast at 192.168.7.7', 'bad', 3000);
  });
  await sleep(1200);

  // A note.
  await page.locator('#tester-felt').click();
  await page.locator('#tester-note-text').fill('Pause felt slow (walk note about 192.168.7.7)');
  if (option('--shots')) await page.screenshot({ path: path.join(option('--shots'), 'note-' + width + '.png') });
  await page.locator('#tester-note-save').click();
  await sleep(800);
  check((await page.locator('#tester-note').count()) === 0, 'Saving a note closes the note panel');
  await page.evaluate(() => window.Tester && window.Tester.flush());
  await sleep(1500);
  check(seen.tester.some(r => r.startsWith('POST /api/tester/events')), 'Tester mode on: the browser sent events');

  // 3. The card, the viewer, the zip.
  await openTesterCard(page, width);
  await sleep(1500);
  const counts = await page.evaluate(() => ['days', 'actions', 'errors', 'slow'].map(k => +document.getElementById('tester-' + k).textContent));
  check(counts[1] > (width > 720 ? 20 : 5) && counts[2] >= 3 && counts[3] >= 2, 'The card shows what was recorded: days, actions, errors, slow spots = ' + counts.join(', '));
  await page.locator('#tester-view').click();
  await sleep(2500);
  const frame = page.frames().find(f => f.url().includes('/api/tester/report.html'));
  check(!!frame, 'View report opens the report in the viewer');
  if (frame) {
    const headings = await frame.evaluate(() => [...document.querySelectorAll('h2')].map(h => h.textContent));
    check(headings.includes('The short version') && headings.includes('Errors'), 'The viewer shows the readable report (' + headings.length + ' sections)');
  }
  if (option('--shots')) await page.screenshot({ path: path.join(option('--shots'), 'viewer-' + width + '.png') });
  await page.locator('#tester-close').click();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.locator('#tester-save').click()]);
  const zipPath = option('--zip') || path.join(os.tmpdir(), 'tester-walk.zip');
  await download.saveAs(zipPath);
  check(/^deja-vu1-tester-report-\d{4}-\d{2}-\d{2}\.zip$/.test(download.suggestedFilename()), 'Save tester report downloads ' + download.suggestedFilename());
  await sleep(500);
  if (option('--shots')) {
    await page.locator('#tester-card').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(option('--shots'), 'card-on-' + width + '.png') });
  }
  for (const p of seen.problems) check(false, 'the page reported: ' + p);
  await context.close();
  return zipPath;
}

/* report.html from the zip, opened with no network, looks right at both widths in both themes. */
async function shots(browser, zipPath, dir) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tester-zip-'));
  const done = spawnSync('python3', ['-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zipPath, out]);
  check(done.status === 0, 'The zip extracts');
  for (const width of [1366, 390]) {
    for (const scheme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: width <= 720 ? 844 : 900 }, colorScheme: scheme, offline: true });
      const page = await context.newPage();
      const outside = [];
      page.on('request', r => {
        if (!r.url().startsWith('file:')) outside.push(r.url());
      });
      await page.goto('file://' + path.join(out, 'report.html'));
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check(outside.length === 0, 'report.html opened from the zip asks for nothing outside (' + width + ' px, ' + scheme + ')');
      check(!sideways, 'report.html does not scroll sideways (' + width + ' px, ' + scheme + ')');
      await page.screenshot({ path: path.join(dir, 'report-' + width + '-' + scheme + '.png') });
      if (width === 1366 && scheme === 'light') await page.screenshot({ path: path.join(dir, 'report-full-1366-light.png'), fullPage: true });
      await context.close();
    }
  }
  fs.rmSync(out, { recursive: true, force: true });
}

/* ---- the cost of recording -------------------------------------------------------------------------- */

const median = a => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = a => {
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / Math.max(1, a.length - 1));
};

/* One stretch on the Printer page with Tester mode as asked: wait for it to settle, time every frame for `secs` seconds (the
 * stretch includes one smoothness sample, the recorder's most active moment), then press five twin controls twice each and time
 * every press from the click to the next paint. */
async function stretch(page, mode, secs) {
  await post(page, '/api/modules/tester/toggle', { enabled: mode === 'on' });
  await sleep(1800);
  const state = await page.evaluate(() => !!(window.Tester && window.Tester.isOn()));
  if (state !== (mode === 'on')) throw new Error('Tester mode was ' + (state ? 'on' : 'off') + ' when ' + mode + ' was asked for');
  const frames = await page.evaluate(
    ms =>
      new Promise(resolve => {
        const times = [];
        let last = performance.now();
        const began = last;
        const tick = now => {
          times.push(now - last);
          last = now;
          if (now - began < ms) requestAnimationFrame(tick);
          else resolve(times.slice(2));
        };
        requestAnimationFrame(tick);
      }),
    secs * 1000
  );
  await page.evaluate(() => {
    window.__paints = [];
  });
  const clicks = [];
  for (const sel of ['[data-view="front"]', '[data-view="top"]', '[data-view="iso"]', '[data-twin="zoom-in"]', '[data-twin="zoom-out"]']) {
    for (let i = 0; i < 2; i++) {
      const before = await page.evaluate(() => window.__paints.length);
      await page.locator(sel).first().click();
      await sleep(300);
      const paints = await page.evaluate(() => window.__paints.slice());
      if (paints.length > before) clicks.push(paints[paints.length - 1]);
    }
  }
  return { frames, clicks };
}

async function overhead(browser, server) {
  const pages = +(option('--pages') || 3), pairs = +(option('--pairs') || 5), secs = +(option('--secs') || 9);
  const rows = [];
  const fh = { off: [], on: [] }, ch = { off: [], on: [] };
  for (let p = 0; p < pages; p++) {
    const { context, page } = await openPage(browser, server.base, { width: 1366 });
    await page.evaluate(() => {
      const t = document.getElementById('demo-toggle');
      if (t && !t.checked) t.click();
      location.hash = '#/printer';
    });
    await sleep(6000);
    await page.evaluate(() => {
      window.__paints = [];
      // Capture phase on window: it runs before the recorder's own listener, so the press is timed from the start.
      window.addEventListener('click', () => {
        const t0 = performance.now();
        requestAnimationFrame(() => setTimeout(() => window.__paints.push(performance.now() - t0), 0));
      }, true);
    });
    for (let k = 0; k < pairs; k++) {
      const order = (p + k) % 2 ? ['on', 'off'] : ['off', 'on'];
      const pair = {};
      for (const mode of order) {
        const r = await stretch(page, mode, secs);
        pair[mode] = { frame_mean: mean(r.frames), frame_median: median(r.frames), frame_p95: r.frames.slice().sort((a, b) => a - b)[Math.floor(r.frames.length * 0.95)],
          click_mean: mean(r.clicks), click_median: median(r.clicks), frames: r.frames.length, presses: r.clicks.length };
        fh[mode].push(...r.frames);
        ch[mode].push(...r.clicks);
      }
      rows.push({ page: p + 1, pair: k + 1, order: order.join('>'), off: pair.off, on: pair.on });
      console.log(JSON.stringify({ page: p + 1, pair: k + 1, order: order.join('>'),
        frame_mean_ms: [+pair.off.frame_mean.toFixed(1), +pair.on.frame_mean.toFixed(1)], click_mean_ms: [+pair.off.click_mean.toFixed(0), +pair.on.click_mean.toFixed(0)] }));
    }
    await context.close();
  }
  const pct = (a, b) => ((b - a) / a) * 100;
  const frameDiffs = rows.map(r => pct(r.off.frame_mean, r.on.frame_mean));
  const clickDiffs = rows.map(r => pct(r.off.click_mean, r.on.click_mean));
  const se = a => sd(a) / Math.sqrt(a.length);
  const out = {
    method: 'one page per block, Tester mode switched off and on in alternating ' + secs + ' s stretches on the Printer page (demo data, 3D twin), ' + pairs + ' pairs per page',
    pages, pairs_per_page: pairs, pairs: rows.length,
    frame_time_ms: { off_mean: mean(fh.off), on_mean: mean(fh.on), off_median: median(fh.off), on_median: median(fh.on), frames: [fh.off.length, fh.on.length],
      difference_percent_of_means: pct(mean(fh.off), mean(fh.on)), paired_difference_percent: { mean: mean(frameDiffs), standard_error: se(frameDiffs), median: median(frameDiffs) } },
    click_to_paint_ms: { off_mean: mean(ch.off), on_mean: mean(ch.on), off_median: median(ch.off), on_median: median(ch.on), presses: [ch.off.length, ch.on.length],
      difference_percent_of_means: pct(mean(ch.off), mean(ch.on)), paired_difference_percent: { mean: mean(clickDiffs), standard_error: se(clickDiffs), median: median(clickDiffs) } }
  };
  console.log(JSON.stringify(out, null, 2));
  if (option('--json')) fs.writeFileSync(option('--json'), JSON.stringify({ rows, out }, null, 2));
  return out;
}

/* ---- main ------------------------------------------------------------------------------------------- */

(async () => {
  let playwright;
  try {
    playwright = require('playwright');
  } catch (e) {
    console.error('Playwright for Node is not installed (npm install playwright).');
    process.exit(2);
  }
  const exe = findChromium(playwright);
  if (!exe) {
    console.error('No Chromium found. Set DEJAVU_BROWSER to the file.');
    process.exit(2);
  }
  if (flag('--probe')) {
    console.log('ready: ' + exe);
    process.exit(0);
  }
  const shotDir = option('--shots');
  if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
  const server = await startServer();
  let standIn = null;
  const browser = await playwright.chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  try {
    if (flag('--overhead')) {
      await overhead(browser, server);
    } else {
      standIn = await startStandIn();
      let zipPath = null;
      for (const width of (option('--width') ? [+option('--width')] : [1366])) zipPath = await walk(browser, server, standIn, width);
      if (shotDir) await shots(browser, zipPath, shotDir);
    }
  } finally {
    await browser.close();
    if (standIn) standIn.child.kill();
    server.child.kill();
    fs.rmSync(server.data, { recursive: true, force: true });
  }
  console.log((results.failed.length ? 'FAILED' : 'PASSED') + ': ' + results.passed + ' checks passed, ' + results.failed.length + ' failed');
  process.exit(results.failed.length ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
