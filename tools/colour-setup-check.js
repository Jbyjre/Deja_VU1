#!/usr/bin/env node
/* Browser check of the colour checker's setup window, end to end on this computer.
 *
 *   node tools/colour-setup-check.js [--shots <folder>] [--only wifi|usb|toml]
 *
 * Starts the real server and a stand-in printer (tools/stand-in-printer.py), then the real firmware file as a
 * stand-in Pico (tools/colour_pico_sim.py) that posts over a real socket, and drives the setup window in Chromium:
 * the Wi-Fi details and the file they make, finding the Pico and giving it a head, the channel test, the brightness,
 * the white and dark references and the measured colour. A second stand-in Pico, with no Wi-Fi, is reached through a
 * fake USB port (navigator.serial) to check the USB route and sending the Wi-Fi details down the cable.
 *
 * Everything the sensor "sees" is a model: this proves the chain works, not how close a real sensor comes to a
 * spool's colour. It has not run on a real Pico W, a real router or Windows. Exit code 1 on any failed check. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { if (process.argv.includes('--probe')) process.exit(1); throw e; }

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const shots = flag('--shots');
const only = flag('--only');
if (shots) fs.mkdirSync(shots, { recursive: true });
const failures = [];
const check = (ok, text) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${text}`); if (!ok) failures.push(text); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => { let body = ''; res.on('data', c => (body += c)); res.on('end', () => resolve({ status: res.statusCode, body })); }).on('error', reject);
  });
}
async function startServer() {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dejavu-colour-'));
  const child = spawn('python3', [path.join(ROOT, 'backend', 'app.py')], { cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, PORT: String(port), DEJAVU_DATA_DIR: data, DEJAVU_NO_BROWSER: '1' } });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) {
    try { if ((await get(base + '/api/health')).status === 200) return { base, port, child }; } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  child.kill();
  throw new Error('the server did not answer');
}
function startStandIn() {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [path.join(ROOT, 'tools', 'stand-in-printer.py')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.once('data', d => resolve({ child, url: String(d).trim() }));
    child.once('error', reject);
  });
}
/* The firmware as a process: lines it prints go to `onLine`; `say` writes a line to it. */
function startPico(env, onLine) {
  const child = spawn('python3', [path.join(ROOT, 'tools', 'colour_pico_sim.py')], { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, DV1_SIM_PERIOD: '0.5', ...env } });
  let buffer = '';
  child.stdout.on('data', d => {
    buffer += d;
    let cut;
    while ((cut = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, cut); buffer = buffer.slice(cut + 1); if (onLine) onLine(line); }
  });
  return { child, say: line => child.stdin.write(line + '\n'), spool: name => child.stdin.write('SIM ' + JSON.stringify({ spool: name }) + '\n') };
}

async function probe() {
  try { const b = await chromium.launch({ args: ['--no-sandbox'] }); await b.close(); process.exit(0); } catch (e) { process.exit(1); }
}

async function main() {
  if (args.includes('--probe')) return probe();
  const server = await startServer();
  const standIn = await startStandIn();
  const children = [server.child, standIn.child];
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block',
      acceptDownloads: true });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.base }).catch(() => {});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('script error: ' + e.message));
    const refused = [];
    page.on('response', r => { if (r.status() === 400) refused.push(r.request().method() + ' ' + r.url().replace(server.base, '').split('?')[0]); });
    page.on('console', m => { if (m.type() === 'error' && !/favicon|status of 40[134]|status of 502/.test(m.text())) errors.push('console: ' + m.text()); });

    const post = (url, body) => page.evaluate(async ([u, b]) => {
      const res = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    }, [url, body]);
    const getJson = url => page.evaluate(async u => (await fetch(u)).json(), url);

    // A returning person's browser: the first-run setup has been seen, so it does not cover the page.
    await page.addInitScript(() => { try { localStorage.setItem('dejavu1.setup-seen', '1'); } catch (e) { /* no storage */ } });
    /* A fake USB port wired to a stand-in Pico process: what the page writes goes to the process, its lines come back. */
    await page.addInitScript(() => {
      window.__serialQueue = [];
      let push = null;
      window.__serialPush = text => { if (push) push(new TextEncoder().encode(text)); else window.__serialQueue.push(text); };
      const port = {
        getInfo: () => ({ usbVendorId: 0x239A, usbProductId: 0x8120 }),
        readable: null, writable: null,
        async open() {
          this.readable = new ReadableStream({ start(controller) { push = chunk => controller.enqueue(chunk); window.__serialQueue.splice(0).forEach(t => window.__serialPush(t)); } });
          this.writable = new WritableStream({ write: chunk => window.__serialWrite(new TextDecoder().decode(chunk)) });
        },
        async setSignals() {}, async close() { this.readable = null; this.writable = null; },
      };
      Object.defineProperty(navigator, 'serial', { value: { getPorts: async () => [], requestPort: async () => port, addEventListener() {} }, configurable: true });
    });
    let usbPico = null;
    let usbBuffer = '';
    await page.exposeFunction('__serialWrite', text => { usbBuffer += text; let cut; while ((cut = usbBuffer.indexOf('\n')) >= 0) { if (usbPico) usbPico.say(usbBuffer.slice(0, cut)); usbBuffer = usbBuffer.slice(cut + 1); } });

    await page.goto(server.base + '/?nointro', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof Workshop !== 'undefined' && typeof ColourSetup !== 'undefined', null, { timeout: 30000 });
    const id = (await post('/api/fleet/registry', { name: 'Check stand-in', moonraker_url: standIn.url })).body.id;
    check(!!id, 'the stand-in printer was added');
    await post('/api/modules/color_check/toggle', { enabled: true });
    await page.evaluate(() => { const t = document.getElementById('demo-toggle'); if (t && t.checked) t.click(); });
    await page.evaluate(pid => Workshop.selectPrinter(pid), id);
    await page.waitForTimeout(1200);
    const q = '?printer=' + id;
    const openCard = async () => {
      await page.evaluate(() => { location.hash = '#/filament'; });
      await page.waitForTimeout(600);
      await page.evaluate(() => Sections.reveal(document.getElementById('colors')));
    };

    if (!only || only === 'toml') {
      const out = await page.evaluate(() => ({
        tricky: ColourSetup.tomlString('pa"ss\\w\nrd é'),
        file: ColourSetup.tomlFor({ ssid: 'Home Net', password: 'p"w\\', servers: ['192.168.1.23:8000', 'laptop.local:8000'], printer: 'abc', code: '' }),
        bad: ColourSetup.problems({ ssid: '', password: 'short', servers: [], printer: '', code: 'x' }).length,
        good: ColourSetup.problems({ ssid: 'Home', password: '12345678', servers: ['1.2.3.4:8000'], printer: 'p', code: '' }).length,
        long: ColourSetup.problems({ ssid: 'x'.repeat(33), password: '', servers: ['a'], printer: 'p' })[0],
      }));
      check(out.tricky === '"pa\\"ss\\\\w\\u000ard é"', 'a password with a quote, a backslash, a newline and an accent is written as a TOML string');
      check(out.file.includes('CIRCUITPY_WIFI_PASSWORD = "p\\"w\\\\"') && out.file.includes('DV1_SERVER = "192.168.1.23:8000, laptop.local:8000"') && !out.file.includes('DV1_PAIR_CODE'), 'settings.toml holds the name, password, addresses and printer');
      check(out.bad === 5 && out.good === 0, 'incomplete Wi-Fi details are listed in words and complete ones are not');
      check(/32 characters/.test(out.long), 'a Wi-Fi name over 32 bytes is refused in words');
    }

    if (!only || only === 'wifi') {
      /* The Pico on Wi-Fi: it posts before it is assigned, so the app lists it. */
      const wifiPico = startPico({ CIRCUITPY_WIFI_SSID: 'HomeNet', CIRCUITPY_WIFI_PASSWORD: 'correct-horse',
        DV1_SERVER: '127.0.0.1:' + server.port, DV1_PRINTER: id }, null);
      children.push(wifiPico.child);
      wifiPico.spool('none');
      await openCard();
      await page.waitForFunction(() => /waiting/i.test(document.getElementById('colors').innerText), null, { timeout: 30000 }).catch(() => {});
      check(/waiting/i.test(await page.locator('#colors').innerText()), 'the card says a colour checker is waiting before it has a head');
      if (shots && process.env.CHECK_DEBUG) await page.screenshot({ path: path.join(shots, 'debug-card.png') });
      if (process.env.CHECK_DEBUG) console.log(await page.evaluate(() => JSON.stringify({ hash: location.hash, bar: document.getElementById('colour-setup-bar').hidden, state: document.getElementById('colour-sensor-state').textContent, colors: document.getElementById('colors').innerText.slice(0, 160), vis: !!document.getElementById('colour-setup-open').offsetParent, tab: document.querySelector('.tab-panel.active, .tab-panel:not([hidden])') && document.querySelector('.tab-panel.active, .tab-panel:not([hidden])').id })));
      await page.locator('#colour-setup-open').click();
      await page.locator('#colour-setup[open]').waitFor();
      check(await page.locator('#cs-ssid').isVisible(), 'the setup window opens with the Wi-Fi details first');

      /* Step 1: the details and the four ways. */
      await page.fill('#cs-ssid', 'HomeNet');
      await page.fill('#cs-pass', 'correct-horse');
      await page.fill('#cs-address-typed', '127.0.0.1:' + server.port);
      await page.waitForTimeout(300);
      const preview = await page.locator('#cs-toml').innerText();
      check(/CIRCUITPY_WIFI_SSID = "HomeNet"/.test(preview) && !/correct-horse/.test(preview) && new RegExp(`DV1_PRINTER = "${id}"`).test(preview), 'the preview shows the lines with the password hidden');
      await page.check('#cs-showpass');
      check(/correct-horse/.test(await page.locator('#cs-toml').innerText()), 'the password shows when asked');
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#cs-download').click()]);
      const text = fs.readFileSync(await download.path(), 'utf8');
      check(download.suggestedFilename() === 'settings.toml' && text.includes('CIRCUITPY_WIFI_PASSWORD = "correct-horse"') && text.includes(`DV1_SERVER = "127.0.0.1:${server.port}"`), 'the download is settings.toml with the real password and address');
      await page.locator('#cs-copy').click();
      await page.waitForTimeout(300);
      const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
      check(clip === null || clip.includes('CIRCUITPY_WIFI_SSID = "HomeNet"'), 'copy puts the same lines on the clipboard');
      await page.fill('#cs-ssid', '');
      await page.waitForTimeout(200);
      check(await page.locator('#cs-download').isDisabled() && /Wi-Fi name/.test(await page.locator('#cs-problems').innerText()), 'with the Wi-Fi name missing the buttons are off and the words say why');
      await page.fill('#cs-ssid', 'HomeNet');
      check(!await server.child.killed && (JSON.stringify(await getJson('/api/colorcheck/sensors' + q))).indexOf('correct-horse') < 0, 'the password never reached the server');

      /* Step 2: the Pico announces itself and is given a head. */
      await page.locator('#cs-find-live [data-cs-assign]').waitFor({ timeout: 40000 });
      const found = await page.locator('#cs-find-live').innerText();
      check(/Wi-Fi, signal -58 dBm/.test(found) && /pico-deadbeef00000001/.test(found), 'the found Pico shows how it connects and its signal');
      if (shots) await page.screenshot({ path: path.join(shots, 'colour-setup-1366-found.png') });
      await page.locator('#cs-find-live [data-cs-assign]').click();
      await page.locator('#cs-find-live [data-cs-pick]').waitFor({ timeout: 20000 });
      check(/Head T0/.test(await page.locator('#cs-find-live').innerText()), 'the Pico is assigned to head T0');

      /* Step 3: the channel test. */
      await page.waitForFunction(() => document.querySelectorAll('#cs-bars .cs-bar').length === 8, null, { timeout: 20000 });
      check(true, 'eight band bars are drawn from the latest reading');
      await page.locator('[data-cs-test="start"]').click();
      wifiPico.spool('none');
      await page.locator('[data-cs-test="dark"]').click();
      await page.locator('[data-cs-test="light"]').waitFor({ timeout: 30000 });
      wifiPico.spool('white');
      await page.waitForTimeout(1500);
      await page.locator('[data-cs-test="light"]').click();
      await page.waitForFunction(() => /reacted/i.test(document.getElementById('cs-test-live').innerText), null, { timeout: 30000 });
      check(/All eight bands/.test(await page.locator('#cs-test-live').innerText()), 'the channel test passes when every band reacts');
      wifiPico.spool('none');
      await page.locator('[data-cs-test="start"]').click();
      await page.locator('[data-cs-test="dark"]').click();
      await page.locator('[data-cs-test="light"]').waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);
      await page.locator('[data-cs-test="light"]').click();
      await page.waitForFunction(() => /did not react/i.test(document.getElementById('cs-test-live').innerText), null, { timeout: 30000 });
      check(/did not react/.test(await page.locator('#cs-test-live').innerText()), 'the channel test names the bands that did not move');

      /* Step 4: brightness, by command through the app to the Wi-Fi sensor. */
      wifiPico.spool('white');
      await page.waitForTimeout(1200);
      await page.locator('[data-cs-gain="auto"]').click();
      await page.waitForFunction(() => /keeps the brightest channel/i.test(document.getElementById('cs-gain-live').innerText), null, { timeout: 60000 });
      check(/keeps the brightest channel/.test(await page.locator('#cs-gain-live').innerText()), 'Find the right brightness reaches the Wi-Fi sensor and its answer comes back');

      /* Step 5: references, then a colour. */
      await page.waitForTimeout(2500);
      await page.locator('[data-cs-cal="white"]').click();
      await page.waitForFunction(() => /Calibrated against a white reference/i.test(document.getElementById('cs-cal-live').innerText), null, { timeout: 30000 });
      check(true, 'the white reference is recorded from the Wi-Fi sensor');
      wifiPico.spool('orange');
      await page.waitForFunction(() => /measured on head T0/.test(document.getElementById('cs-done-live').innerText), null, { timeout: 40000 });
      const hex = (await page.locator('#cs-done-live strong').first().innerText()).trim();
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
      check(/^#[0-9a-f]{6}$/.test(hex) && r > b + 80 && r > g, `an orange spool reads as an orange (${hex})`);
      if (shots) await page.screenshot({ path: path.join(shots, 'colour-setup-1366-measured.png') });

      /* A changed brightness drops the colour and says why. */
      const before = (await getJson('/api/colorcheck/sensors' + q)).sensors[0].reading.settings.gain;
      const other = before === 4 ? 8 : 4;
      await post('/api/colorcheck/command' + q, { toolhead: 'T0', cmd: 'set', gain: other });
      await page.waitForFunction(() => /settings changed/i.test(document.getElementById('cs-cal-live').innerText), null, { timeout: 40000 });
      check(new RegExp(`gain ${before}.*gain ${other}`).test(await page.locator('#cs-cal-live').innerText()), 'after the gain changes the window says what changed and that the white reference must be recorded again');
      await post('/api/colorcheck/command' + q, { toolhead: 'T0', cmd: 'set', gain: before });
      await page.waitForFunction(() => /Calibrated against a white reference/i.test(document.getElementById('cs-cal-live').innerText), null, { timeout: 40000 });
      check(true, 'putting the gain back brings the calibration back');
      await page.locator('#colour-setup-close').click();
      await openCard();
      await page.waitForFunction(() => /Head T0/i.test(document.getElementById('colors').innerText), null, { timeout: 30000 }).catch(() => {});
      check(/Head T0/i.test(await page.locator('#colors').innerText()), 'the card shows the head with the sensor');
      if (shots) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#colour-setup-open').click();
        await page.locator('#colour-setup[open]').waitFor();
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(shots, 'colour-setup-390.png') });
        await page.locator('#colour-setup-close').click();
        await page.setViewportSize({ width: 1366, height: 900 });
      }
      wifiPico.child.kill();
    }

    if (!only || only === 'usb') {
      /* The USB route: a second Pico, no Wi-Fi, reached through the fake port. */
      await post('/api/colorcheck/sensors' + q, { version: 1, simulated: false, bindings: [] });
      usbPico = startPico({ DV1_SIM_UID: '00000000000000aa', DV1_PRINTER: id, CIRCUITPY_WIFI_SSID: '' }, line => { page.evaluate(t => window.__serialPush(t), line + '\n').catch(() => {}); });
      children.push(usbPico.child);
      usbPico.spool('white');
      await openCard();
      await page.locator('#colour-setup-open').click();
      await page.locator('#colour-setup[open]').waitFor();
      await page.locator('.cs-way summary', { hasText: 'USB cable' }).click();
      await page.locator('#cs-usb-connect').click();
      await page.waitForFunction(() => ColourBridge.state.hello && ColourBridge.state.hello.device_id === 'pico-00000000000000aa', null, { timeout: 20000 });
      check(true, 'the page connects to the Pico over USB and it says hello');
      check(/No Wi-Fi saved on it/.test(await page.locator('#cs-usb-live').innerText()), 'the window says the Pico has no Wi-Fi saved');
      await page.locator('#cs-find-live [data-cs-assign]').waitFor({ timeout: 30000 });
      check(/USB cable/.test(await page.locator('#cs-find-live').innerText()), 'a USB Pico is listed as found, with how it connects');
      await page.locator('#cs-find-live [data-cs-assign]').click();
      await page.locator('#cs-find-live [data-cs-pick]').waitFor({ timeout: 20000 });
      /* Send the Wi-Fi details down the cable: the Pico keeps them and joins. */
      await page.fill('#cs-ssid', 'HomeNet');
      await page.fill('#cs-pass', 'correct-horse');
      await page.fill('#cs-address-typed', '127.0.0.1:' + server.port);
      await page.waitForFunction(() => !document.getElementById('cs-send').disabled, null, { timeout: 5000 });
      await page.locator('#cs-send').click();
      await page.waitForFunction(() => /Works:/.test(document.getElementById('cs-usb-result').innerText), null, { timeout: 60000 });
      check(!/correct-horse/.test(await page.locator('#cs-usb-result').innerText()), 'sending Wi-Fi details over USB reports the result and never repeats the password');
      await page.waitForFunction(() => /Wi-Fi saved: HomeNet/.test(document.getElementById('cs-usb-live').innerText), null, { timeout: 15000 });
      check(true, 'the Pico reports the Wi-Fi it saved (name only) and joined it');
      /* A command over the cable is answered at once. */
      await page.locator('[data-cs-gain="auto"]').click();
      await page.waitForFunction(() => /keeps the brightest channel/i.test(document.getElementById('cs-gain-live').innerText), null, { timeout: 40000 });
      check(true, 'Find the right brightness over USB is answered by the Pico');
      const view = await getJson('/api/colorcheck/sensors' + q);
      check(view.sensors.length === 1 && view.sensors[0].reading.captured_at > 1.7e9, 'USB readings are stamped on the app\'s clock in whole seconds');
      check(Number.isInteger(view.sensors[0].reading.captured_at), 'the capture time is a whole number of seconds');
      usbPico.child.kill();
    }

    if (refused.length) console.log('answers of 400 seen by the page: ' + refused.join(', '));
    check(errors.length === 0, 'no script or console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } finally {
    await browser.close();
    children.forEach(c => { try { c.kill(); } catch (e) { /* gone */ } });
  }
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll colour setup checks passed');
  process.exit(failures.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
