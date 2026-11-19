#!/usr/bin/env node
/* The tester fix release's page bugs, in a real browser, one scenario each (the owner's own tester report found them).
 *
 *   node tools/testfix-check.js                 every scenario
 *   node tools/testfix-check.js --only gauge,lost   some of them (gauge, timelapse, keep, aiwidth, camera, lost, limit, freeze)
 *   node tools/testfix-check.js --probe         only says whether Playwright and a Chromium are available
 *
 * Each scenario starts Deja Vu1 (backend/app.py) on a spare port in a temporary data folder and drives the page in Chromium, with the
 * requests it makes answered by the test where the real printer would be needed. Prints one line per check; exits 0 only when
 * every check passed. tests/test_testfix_browser.py runs it. The stand-in printer used by `limit` is tests/fake_moonraker.py
 * (a pretend printer, not a real U1).
 *
 *   gauge      the print-health gauge stops animating when its panel is replaced (no script error)
 *   timelapse  the time-lapse list stays on screen while the switch is flipped and while the printer is slow to answer
 *   keep       Keep a copy here starts a background copy and the row shows its progress
 *   aiwidth    the AI shortcut in the Time-lapses heading never changes the layout of the heading when it is hovered
 *   camera     a saved camera address that fails falls back to the printer's own camera by itself, and says so
 *   lost       losing the server for a moment shows no error, and the page tells the tester only when it lasts
 *   limit      six copies started at once do not hold up the next request (a browser keeps at most six connections to one address)
 *   freeze     an idle printer's page is not frozen by the 3D twin being drawn again and again with nothing new to show
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
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dejavu-testfix-'));
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
    await sleep(200);
  }
  child.kill();
  throw new Error('The server did not answer /api/health within 20 seconds');
}

function startPrinter(delay) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [path.join(ROOT, 'tests', 'fake_moonraker_serve.py'), String(delay)], { cwd: ROOT, stdio: ['pipe', 'pipe', 'ignore'] });
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

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/* A page on a fresh server that reports every script error and every failed promise. */
async function openPage(browser, base, size) {
  const context = await browser.newContext({ viewport: size || { width: 1366, height: 800 }, serviceWorkers: 'block' });
  // A returning tester's browser: the first-run setup has been seen, so it does not cover the page.
  await context.addInitScript(() => {
    try { localStorage.setItem('dejavu1.setup-seen', '1'); } catch (e) { /* no storage */ }
    window.__long = [];
    try { new PerformanceObserver(list => list.getEntries().forEach(e => window.__long.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch (e) { /* not supported */ }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message ? e.message : e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.Workshop && typeof showTab === 'function' && document.readyState === 'complete', null, { timeout: 30000 });
  await sleep(800);
  return { page, errors, context };
}

/* ---- the scenarios ---------------------------------------------------------------------------------------------- */

async function gauge(browser, base) {
  const { page, errors, context } = await openPage(browser, base);
  let calls = 0;
  await page.route('**/api/health*', route => {
    calls += 1;
    if (calls === 1) return route.fulfill({ json: { connected: true, demo: true, score: 30, band: 'poor', deductions: [] } });
    if (calls === 2) return route.fulfill({ json: { connected: true, demo: true, score: 95, band: 'good', deductions: [] } });
    return route.fulfill({ json: { connected: false, demo: false } });          // the next look finds nothing: the gauge is replaced by a note
  });
  await page.evaluate(() => showTab('control'));
  await page.evaluate(() => Workshop.refresh());
  await sleep(1500);
  const built = await page.evaluate(() => !!document.getElementById('g-needle'));
  await page.evaluate(() => Workshop.refresh());       // the score moves, so the gauge starts to animate
  await sleep(60);
  await page.evaluate(() => Workshop.refresh());       // and the panel is replaced while it is still moving
  await sleep(2500);
  const after = await page.evaluate(() => ({ needle: !!document.getElementById('g-needle'), host: (document.getElementById('health-host') || {}).textContent || '' }));
  check(built, 'gauge: the print-health gauge was drawn first');
  check(!after.needle && /No printer connected/.test(after.host), 'gauge: the next answer with no data replaced it with the "no printer" note');
  check(errors.filter(e => /setAttribute|null/.test(e)).length === 0, 'gauge: no script error from the animation after its panel went (' + (errors.join(' | ').slice(0, 160) || 'none') + ')');
  await context.close();
}

async function timelapse(browser, base) {
  const { page, errors, context } = await openPage(browser, base);
  const session = { session: 's1', filename: 'benchy.gcode', frames: 40, started_at: new Date().toISOString(), finished: true, source: 'camera' };
  await page.route('**/api/timelapse', route => route.fulfill({ json: { connected: true, demo: false, sessions: [session], recording: false } }));
  await page.route('**/api/timelapse/printer', async route => {
    await sleep(1500);                              // the printer's Wi-Fi is slow to list its files
    route.fulfill({ json: { connected: true, demo: false, roots: ['camera'], videos: [{ root: 'camera', path: 'run.mp4', size: 5000000, modified: 1700000000 }], saved: [] } });
  });
  await page.route('**/api/timelapse/jobs', route => route.fulfill({ json: { connected: true, demo: false, jobs: [], saved: [] } }));
  await page.evaluate(() => showTab('control'));
  await page.waitForFunction(() => document.querySelectorAll('#timelapse-host .reg-row').length >= 2, null, { timeout: 15000 });
  const rows = () => page.evaluate(() => document.querySelectorAll('#timelapse-host .reg-row').length);
  check(await rows() === 2, 'timelapse: the flipbook and the printer\'s video are listed');
  await page.evaluate(() => {
    window.__min = 99;
    window.__watch = setInterval(() => { window.__min = Math.min(window.__min, document.querySelectorAll('#timelapse-host .reg-row').length); }, 10);
  });
  // The Record time-lapses switch is turned off: the server then refuses time-lapse reads, so the list must not blank.
  await page.evaluate(() => { modGate.off.add('timelapse'); return Workshop.onTab('control'); });
  await sleep(600);
  const off = await page.evaluate(() => ({ note: !document.getElementById('tl-note').hidden, text: document.getElementById('tl-note').textContent, rows: document.querySelectorAll('#timelapse-host .reg-row').length }));
  check(off.rows === 2 && off.note && /switched off/.test(off.text), 'timelapse: with the switch off the list stays and a note says why');
  await page.evaluate(() => { modGate.off.delete('timelapse'); return Workshop.onTab('control'); });
  await sleep(300);                                // the printer's answer is still on its way
  check(await rows() === 2, 'timelapse: switching it on again does not blank the list while the printer is slow to answer');
  await page.evaluate(() => { modGate.off.add('timelapse'); modGate.off.delete('timelapse'); return Workshop.onTab('control'); });
  await sleep(2500);
  const min = await page.evaluate(() => { clearInterval(window.__watch); return window.__min; });
  check(min === 2, 'timelapse: the list never dropped below its two rows while the switch was flipped (lowest ' + min + ')');
  check(await page.evaluate(() => document.getElementById('tl-note').hidden), 'timelapse: the note is gone once it is switched on');
  // A look that fails leaves the list as it is.
  await page.route('**/api/timelapse', route => route.abort('failed'));
  await page.evaluate(() => Workshop.onTab('control'));
  await sleep(2000);
  check(await rows() === 2, 'timelapse: a failed look (the server unreachable) leaves the list on screen');
  check(errors.length === 0, 'timelapse: no script error (' + (errors.join(' | ').slice(0, 160) || 'none') + ')');
  await context.close();
}

async function keep(browser, base) {
  const { page, errors, context } = await openPage(browser, base);
  let phase = 0, saved = [];
  const job = (state, bytes) => ({ id: 'j1', state, bytes, total: 5000000, name: 'run.mp4', root: 'camera', path: 'run.mp4', error: null });
  await page.route('**/api/timelapse', route => route.fulfill({ json: { connected: true, demo: false, sessions: [], recording: false } }));
  await page.route('**/api/timelapse/printer', route => route.fulfill({ json: { connected: true, demo: false, roots: ['camera'], saved,
    videos: [{ root: 'camera', path: 'run.mp4', size: 5000000, modified: 1700000000 }] } }));
  await page.route('**/api/timelapse/jobs', route => {
    let jobs = [];
    if (phase === 1) jobs = [job('running', 2000000)];
    else if (phase === 2) jobs = [job('running', 4000000)];
    else if (phase >= 3) jobs = [job('done', 5000000)];
    if (phase >= 1 && phase < 4) phase += 1;
    route.fulfill({ json: { connected: true, demo: false, jobs, saved } });
  });
  let posted = 0;
  await page.route('**/api/timelapse/keep', route => {
    posted += 1;
    phase = 1;
    setTimeout(() => { saved = [{ name: 'run.mp4', size: 5000000, saved_at: '2026-11-19T10:00:00' }]; }, 2500);
    route.fulfill({ status: 202, json: { job: job('running', 0), running: true } });
  });
  await page.evaluate(() => showTab('control'));
  await sleep(600);
  await page.evaluate(() => Sections.choose('control', 'camera'));
  await page.waitForSelector('#timelapse-host [data-keep-path]', { state: 'visible', timeout: 15000 });
  const began = Date.now();
  await page.click('#timelapse-host [data-keep-path]');
  await page.waitForFunction(() => /Copying \d+%/.test((document.querySelector('#timelapse-host [data-keep-path]') || {}).textContent || ''), null, { timeout: 8000 });
  check(Date.now() - began < 3000, 'keep: the press returned at once and the row shows "Copying" with a percentage');
  check(await page.evaluate(() => document.querySelector('#timelapse-host [data-keep-path]').disabled), 'keep: the button waits while the copy runs');
  await page.click('#timelapse-host [data-keep-path]', { force: true }).catch(() => {});
  check(posted === 1, 'keep: pressing it again while it copies starts no second copy (' + posted + ' started)');
  await page.waitForFunction(() => /Kept on this computer/.test((document.getElementById('tl-printer') || {}).textContent || ''), null, { timeout: 12000 });
  check(true, 'keep: when it is done the copy is listed under "Kept on this computer"');
  check(errors.length === 0, 'keep: no script error (' + (errors.join(' | ').slice(0, 160) || 'none') + ')');
  await context.close();
}

async function aiwidth(browser, base) {
  const { page, context } = await openPage(browser, base);
  await page.evaluate(() => showTab('control'));
  await sleep(600);
  await page.evaluate(() => Sections.choose('control', 'camera'));          // the part that holds the camera and time-lapse cards
  await page.waitForFunction(() => !document.getElementById('timelapse-card').classList.contains('sec-enter'), null, { timeout: 5000 }).catch(() => {});
  await sleep(300);
  // What assistant-part2.js's decorate() adds to a card heading, once an AI is connected.
  await page.evaluate(() => {
    const head = document.querySelector('#timelapse-card .card-head');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ai-ask';
    b.setAttribute('aria-label', 'Find my time-lapses');
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></svg><span>Find my time-lapses</span>';
    head.appendChild(b);
  });
  const boxes = () => page.evaluate(() => {
    const card = document.getElementById('timelapse-card').getBoundingClientRect();           // measured from the card, so a scroll of the page does not count
    const r = sel => { const e = document.querySelector('#timelapse-card ' + sel); const b = e.getBoundingClientRect(); return [Math.round((b.left - card.left) * 10) / 10, Math.round((b.top - card.top) * 10) / 10, Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10]; };
    return { title: r('.card-head h2'), sub: r('.card-sub'), switch: r('.switch'), button: r('.ai-ask') };
  });
  const before = await boxes();
  await page.hover('#timelapse-card .ai-ask');
  await sleep(500);
  const during = await boxes();
  check(JSON.stringify(before.title) === JSON.stringify(during.title) && JSON.stringify(before.sub) === JSON.stringify(during.sub),
    'aiwidth: the heading\'s title and subtitle do not move or rewrap when the shortcut is hovered');
  check(JSON.stringify(before.switch) === JSON.stringify(during.switch), 'aiwidth: the Record time-lapses switch does not move when the shortcut is hovered');
  check(before.button[2] === during.button[2] && before.button[3] === during.button[3], 'aiwidth: the shortcut keeps the size of its icon (' + before.button.join(',') + ' then ' + during.button.join(',') + ')');
  const label = await page.evaluate(() => { const s = document.querySelector('#timelapse-card .ai-ask span'); const cs = getComputedStyle(s); return { opacity: cs.opacity, visibility: cs.visibility }; });
  check(label.opacity === '1' && label.visibility === 'visible', 'aiwidth: its words still appear on hover');
  await context.close();
}

async function camera(browser, base) {
  const { page, errors, context } = await openPage(browser, base);
  await page.route('**/api/camera/settings', route => route.fulfill({ json: { stream_url: 'http://printer.example/webcam/stream.mjpg' } }));
  await page.route('**/api/camera/stream*', route => route.fulfill({ status: 502, json: { error: 'Bad Gateway' } }));
  await page.route('**/api/camera/live*', route => route.fulfill({ status: 502, json: { error: 'Bad Gateway' } }));
  await page.route('**/api/camera/webrtc', route => route.fulfill({ json: { available: false } }));
  await page.route('**/api/camera/snapshot*', route => route.fulfill({ contentType: 'image/png', body: PNG }));
  if (process.env.DEBUG_CAM) page.on('response', r => { if (/camera/.test(r.url())) console.log('   ', r.status(), r.url().replace(/^http:\/\/[^/]+/, '')); });
  await page.evaluate(() => { try { localStorage.removeItem('dejavu1.cam.printer'); } catch (e) { /* no storage */ } showTab('control'); });
  const card = '#pp-camera-card ';
  await page.waitForFunction(sel => /ictures/.test((document.querySelector(sel + '.pcam-mode') || {}).textContent || ''), card, { timeout: 25000 }).catch(() => {});
  await sleep(500);
  const state = await page.evaluate(sel => ({ mode: (document.querySelector(sel + '.pcam-mode') || {}).textContent, note: (document.querySelector(sel + '.pcam-note') || {}).textContent,
    shown: !!document.querySelector(sel + '.pcam-img') && !document.querySelector(sel + '.pcam-img').hidden && !!document.querySelector(sel + '.pcam-img').getAttribute('src') }), card);
  check(/ictures/.test(state.mode || ''), 'camera: with the saved address and the live stream both failing, the picture falls back to still pictures by itself (' + state.mode + ')');
  check(state.shown, 'camera: a picture from the printer\'s own camera is on screen');
  check(/saved camera address and the live stream did not answer/.test(state.note || ''), 'camera: the note says so in a few words (' + (state.note || '') + ')');
  check(!(state.note || '').match(/Check the address/), 'camera: it does not tell the tester to go and fix an address');
  check(errors.length === 0, 'camera: no script error (' + (errors.join(' | ').slice(0, 160) || 'none') + ')');
  await context.close();
}

async function lost(browser, base) {
  const { page, errors, context } = await openPage(browser, base);
  const strip = () => page.evaluate(() => { const el = document.querySelector('.server-lost'); return !!el && !el.hidden; });
  const felt = () => page.evaluate(() => (document.getElementById('tester-felt') || {}).textContent || '');
  check(await felt() === 'Something felt off', 'lost: the note button starts as "Something felt off"');
  // The server stops answering for six seconds (a restart, a wake-up from sleep).
  let down = true;
  await page.route('**/api/**', route => (down ? route.abort('connectionrefused') : route.continue()));
  await page.evaluate(() => { for (const u of ['/api/printer', '/api/files', '/api/queue', '/api/health']) getJSON(u); });      // reads with no catch of their own
  await sleep(6000);
  check(!(await strip()), 'lost: after six seconds the page has said nothing on screen');
  check(await felt() === 'Something felt off', 'lost: the note button did not change to "Something went wrong"');
  down = false;
  await sleep(9000);
  check(!(await strip()), 'lost: it reconnected by itself and still shows no strip');
  check(!errors.some(e => /Failed to fetch|did not answer/i.test(e)), 'lost: no "Failed to fetch" reached the console as an error (' + (errors.join(' | ').slice(0, 200) || 'none') + ')');
  // A longer outage is said once, calmly, and cleared when the server answers again.
  down = true;
  await sleep(17000);
  check(await strip(), 'lost: when it lasts more than ten seconds the page says Deja Vu1 stopped answering');
  check(await felt() === 'Something felt off', 'lost: even then the note button is not an error alert');
  down = false;
  await sleep(6000);
  check(!(await strip()), 'lost: the strip goes away by itself when the server answers again');
  await context.close();
}

async function limit(browser, base, serverUrl) {
  const printer = await startPrinter(0.1);                       // each 4 MB video takes about 6.5 s to send
  try {
    const res = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ name: 'Bench U1', moonraker_url: printer.url });
      const req = http.request(serverUrl + '/api/fleet/registry', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
        let text = '';
        r.on('data', c => (text += c));
        r.on('end', () => resolve({ status: r.statusCode, body: text }));
      });
      req.on('error', reject);
      req.end(body);
    });
    check(res.status === 200, 'limit: the stand-in printer was added');
    let connected = false;
    for (let i = 0; i < 40 && !connected; i++) {
      await sleep(250);
      try { connected = JSON.parse((await get(serverUrl + '/api/connection')).body).connected === true; } catch (e) { /* not yet */ }
    }
    check(connected, 'limit: and it is connected');
    const { page, errors, context } = await openPage(browser, serverUrl);
    const timing = await page.evaluate(async () => {
      const began = performance.now();
      const posts = [1, 2, 3, 4, 5, 6].map(n => fetch('/api/timelapse/keep', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: 'camera', path: 'v' + n + '.mp4' }) }).then(r => ({ status: r.status, at: performance.now() - began })));
      await new Promise(r => setTimeout(r, 400));
      const asked = performance.now();
      const alive = await fetch('/api/app/alive', { cache: 'no-store' }).then(r => r.status);
      const aliveMs = performance.now() - asked;
      const done = await Promise.all(posts);
      return { aliveMs, alive, presses: done.map(d => Math.round(d.at)), statuses: done.map(d => d.status) };
    });
    check(timing.alive === 200 && timing.aliveMs < 1500, 'limit: with six copies started at once the next request still answered at once (' + Math.round(timing.aliveMs) + ' ms)');
    check(Math.max(...timing.presses) < 3000, 'limit: and every Keep press itself returned within 3 s (' + timing.presses.join(', ') + ' ms)');
    check(errors.length === 0, 'limit: no script error (' + (errors.join(' | ').slice(0, 160) || 'none') + ')');
    await context.close();
  } finally {
    printer.child.stdin.end();
    printer.child.kill();
  }
}

async function addPrinter(printer, serverUrl) {
  const res = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ name: 'Bench U1', moonraker_url: printer.url });
    const req = http.request(serverUrl + '/api/fleet/registry', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let text = '';
      r.on('data', c => (text += c));
      r.on('end', () => resolve({ status: r.statusCode, body: text }));
    });
    req.on('error', reject);
    req.end(body);
  });
  let connected = false;
  for (let i = 0; i < 40 && !connected; i++) {
    await sleep(250);
    try { connected = JSON.parse((await get(serverUrl + '/api/connection')).body).connected === true; } catch (e) { /* not yet */ }
  }
  return res.status === 200 && connected;
}

async function freeze(browser, base, serverUrl) {
  const printer = await startPrinter(0.01);
  try {
    check(await addPrinter(printer, serverUrl), 'freeze: the stand-in printer (not printing) is added and connected');
    const { page, errors, context } = await openPage(browser, serverUrl);
    await page.evaluate(() => showTab('control'));
    const drawn = await page.waitForFunction(() => { const c = document.querySelector('#twin-card canvas'); return c && c.width > 10; }, null, { timeout: 30000 }).then(() => true, () => false);
    check(drawn, 'freeze: the 3D twin is on the Printer screen');
    await sleep(6000);                                        // the first drawings are not what is measured
    await page.evaluate(() => { window.__long.length = 0; });
    await sleep(10000);
    const long = await page.evaluate(() => window.__long.slice());
    const total = long.reduce((a, c) => a + c, 0);
    // Where drawing is slow (software graphics, which this browser uses) the twin drew again with nothing new to show: 10 freezes, about 4 s in ten.
    check(long.length <= 1 && total < 1000, 'freeze: ten idle seconds on the Printer screen cost ' + long.length + ' freezes over 200 ms, ' + total + ' ms in all');
    check(errors.length === 0, 'freeze: no script error (' + (errors.join(' | ').slice(0, 160) || 'none') + ')');
    await context.close();
  } finally {
    printer.child.stdin.end();
    printer.child.kill();
  }
}

const ALL = { gauge, timelapse, keep, aiwidth, camera, lost, limit, freeze };

async function main() {
  let playwright;
  try {
    playwright = require('playwright');
  } catch (e) {
    console.error('Playwright for Node is not installed');
    process.exit(2);
  }
  const executablePath = findChromium(playwright);
  if (!executablePath) {
    console.error('No Chromium found (set DEJAVU_BROWSER)');
    process.exit(2);
  }
  if (flag('--probe')) process.exit(0);
  const only = option('--only') ? option('--only').split(',') : Object.keys(ALL);
  const browser = await playwright.chromium.launch({ executablePath, args: ['--no-sandbox'] });
  let server = null;
  try {
    for (const name of only) {
      if (!ALL[name]) {
        check(false, 'unknown scenario ' + name);
        continue;
      }
      console.log('--- ' + name);
      server = await startServer();
      try {
        await ALL[name](browser, server.base, server.base);
      } catch (e) {
        check(false, name + ': the scenario stopped: ' + (e && e.message ? e.message : e));
      } finally {
        server.child.kill();
      }
    }
  } finally {
    await browser.close();
  }
  console.log('\n' + results.passed + ' checks passed, ' + results.failed.length + ' failed');
  if (results.failed.length) {
    console.log(results.failed.map(f => '  - ' + f).join('\n'));
    process.exit(1);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
