#!/usr/bin/env node
/*
 * The first-run walk: the setup screens a new user sees, in a real Chromium.
 *
 *   node tools/setup-walk.js            runs the walk and prints one line per check
 *   node tools/setup-walk.js --probe    only says whether Playwright and a Chromium are available
 *   node tools/setup-walk.js --shots DIR   also saves a screenshot of each step into DIR
 *
 * It starts its own server on an empty data folder and a stand-in printer (tools/stand-in-printer.py, a pretend
 * printer, not a real one). It checks that an address typed on the printer step is kept, that a bad address is
 * explained and can be skipped, that replaying setup does not add the printer twice, that a phone gets its own
 * short list of steps, that a browser blocking saved settings does not bring the setup back on every reload,
 * and that the printer step and the background picker are laid out with room around their parts.
 */
'use strict';
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
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dejavu-setup-'));
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

const LAPTOP = { viewport: { width: 1366, height: 800 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function visit(browser, server, options, init) {
  // A visit has chosen English already, so the steps below are the same ones as before translations existed; the language visits
  // at the end of the walk start with nothing chosen.
  const { freshLanguage, ...contextOptions } = options;
  const context = await browser.newContext(contextOptions);
  if (!freshLanguage) await context.addInitScript(() => { try { localStorage.setItem('dejavu1.lang', 'en'); } catch (e) { /* blocked */ } });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 200)));
  await page.goto(server.base + '/');
  await page.waitForSelector('#setup-dialog[open]', { timeout: 15000 });
  return page;
}
const stepText = page => page.textContent('#setup-step');
const printerCount = async server => JSON.parse((await get(server.base + '/api/fleet/registry')).body).printers.length;
const toStep = async (page, n) => {
  for (let i = 1; i < n; i++) await page.click('#setup-next');
};

async function walk(browser, server, address, shots) {
  const shot = async (page, name) => {
    if (shots) await page.screenshot({ path: path.join(shots, name + '.png') });
  };

  // A laptop: every step opens, the printer step has room around its parts, the picker's checkbox is not stretched.
  let page = await visit(browser, server, LAPTOP);
  check(/Step 1 of 9/.test(await stepText(page)), 'A laptop sees nine setup steps');
  await page.click('#setup-next');
  await shot(page, 'step2-make-it-yours');
  const box = await page.locator('#setup-content [data-surprises]').boundingBox();
  check(box && box.height <= 30, 'The "Little surprises" checkbox keeps its own size (' + (box && Math.round(box.height)) + ' px tall)');
  await page.click('#setup-next');
  await shot(page, 'step3-your-printer');
  const gap = await page.evaluate(() => {
    const lead = document.querySelector('#setup-content .setup-lead').getBoundingClientRect();
    const choices = document.querySelector('#setup-content .setup-choices').getBoundingClientRect();
    return Math.round(choices.top - lead.bottom);
  });
  check(gap >= 12, 'The demo and printer choices sit ' + gap + ' px below the paragraph above them');
  check((await page.getAttribute('#setup-real', 'aria-pressed')) === 'true' && (await page.getAttribute('#setup-demo', 'aria-pressed')) === 'false',
    'The chosen printer option says it is pressed');

  // An address that was typed but not tested is connected by Continue, not thrown away.
  await page.fill('#setup-url', address);
  await page.click('#setup-next');
  await page.waitForFunction(() => /Step 4 of 9/.test(document.getElementById('setup-step').textContent), null, { timeout: 15000 }).catch(() => {});
  check(/Step 4 of 9/.test(await stepText(page)), 'Continue with a typed printer address connects it and moves on');
  check((await printerCount(server)) === 1, 'The printer is in the list once');
  await page.click('#setup-back');
  check((await page.textContent('#setup-content')).includes('Added: My U1') && (await page.isHidden('#setup-connect')),
    'Back on the printer step it says the printer is added instead of asking again');
  check(page.errors.length === 0, 'No script errors on a laptop' + (page.errors.length ? ': ' + page.errors[0] : ''));
  await page.context().close();

  // Replaying setup with the same printer uses it and adds nothing; Enter in the address field connects.
  page = await visit(browser, server, LAPTOP);
  await toStep(page, 3);
  await page.fill('#setup-url', address);
  await page.press('#setup-url', 'Enter');
  await page.waitForFunction(() => /Printer added|Connection test passed/.test(document.getElementById('setup-status').textContent), null, { timeout: 15000 }).catch(() => {});
  check(/Connection test passed/.test(await page.textContent('#setup-status')), 'Enter in the address field connects, and a printer already in the list is reused');
  check((await printerCount(server)) === 1, 'Replaying setup does not add the printer a second time');
  await page.context().close();

  // A bad address stays on the step with the reason in words; a second Continue skips it.
  page = await visit(browser, server, LAPTOP);
  await toStep(page, 3);
  await page.fill('#setup-url', '127.0.0.1:1');
  await page.click('#setup-next');
  await page.waitForFunction(() => /refused|Press Continue again/.test(document.getElementById('setup-status').textContent), null, { timeout: 15000 }).catch(() => {});
  const status = await page.textContent('#setup-status');
  check(/Step 3 of 9/.test(await stepText(page)) && /Press Continue again to skip/.test(status), 'A bad address stays on the step and says how to go on: ' + status.slice(0, 60));
  await page.click('#setup-next');
  check(/Step 4 of 9/.test(await stepText(page)), 'Continue a second time skips the printer');
  await page.context().close();

  // Enter in the name field goes on.
  page = await visit(browser, server, LAPTOP);
  await page.fill('#setup-name', 'Sam');
  await page.press('#setup-name', 'Enter');
  check(/Step 2 of 9/.test(await stepText(page)), 'Enter in the name field goes to the next step');
  await page.context().close();

  // A phone: five steps, none about showing a code for a phone or the desktop app.
  page = await visit(browser, server, PHONE);
  const seen = [];
  for (let i = 0; i < 7; i++) {
    seen.push((await stepText(page)).replace(/^Step \d+ of \d+ · /, ''));
    if ((await page.textContent('#setup-next')) === 'Finish setup') break;
    await page.click('#setup-next');
  }
  await shot(page, 'phone-last-step');
  check(seen.join(',') === 'Welcome,Make it yours,Your printer,The tour,Home Screen', 'A phone sees five steps ending with the Home Screen step: ' + seen.join(', '));
  check(!(await page.textContent('#setup-content')).includes('Show the code to scan'), 'The phone is not asked to scan a code for a phone');
  check(page.errors.length === 0, 'No script errors on a phone' + (page.errors.length ? ': ' + page.errors[0] : ''));
  await page.context().close();

  // A browser that blocks saved settings: setup still closes for good where the tab can remember, and nothing throws.
  const blockLocal = () => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  page = await visit(browser, server, LAPTOP, blockLocal);
  await page.fill('#setup-name', 'Sam');
  check(/only kept until this tab closes/.test(await page.textContent('#setup-status')), 'With saved settings blocked, the name field says it is kept only for this tab');
  await page.click('#setup-skip');
  await page.reload();
  await page.waitForTimeout(1500);
  check(!(await page.evaluate(() => document.getElementById('setup-dialog').open)), 'With localStorage blocked, setup stays closed after a reload');
  check(page.errors.length === 0, 'No script errors with localStorage blocked');
  await page.context().close();

  // The Language step: first, while a translation is installed and none was chosen; a language other than the one on screen is saved
  // and the page reloads in it; the browser's own language is suggested, never applied by itself.
  page = await visit(browser, server, { ...LAPTOP, freshLanguage: true });
  check(/Step 1 of 10 · Language/.test(await stepText(page)), 'A first visit sees a Language step first, ten steps in all: ' + (await stepText(page)));
  const labels = await page.$$eval('[data-setup-lang]', els => els.map(e => e.textContent.trim()));
  check(labels.includes('English') && labels.includes('Español (Spanish)'), 'It offers English and Spanish by their own names: ' + labels.join(' | '));
  check(!(await page.textContent('#setup-content')).includes('Your browser is set to'), 'With an English browser it suggests nothing');
  await shot(page, 'language-step');
  await page.click('[data-setup-lang="es"]');
  await page.waitForFunction(() => /Paso 1 de 9/.test((document.getElementById('setup-step') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  check(/Paso 1 de 9/.test(await stepText(page)), 'Choosing Spanish reloads the page in Spanish, and setup goes on at its first step: ' + (await stepText(page)));
  check((await page.evaluate(() => localStorage.getItem('dejavu1.lang'))) === 'es', 'The choice is saved in this browser');
  check((await page.textContent('#setup-content')).includes('Configura tu espacio de trabajo'), 'The welcome step is in Spanish');
  await shot(page, 'welcome-in-spanish');
  check(page.errors.length === 0, 'No script errors in Spanish' + (page.errors.length ? ': ' + page.errors[0] : ''));
  await page.context().close();

  page = await visit(browser, server, { ...LAPTOP, freshLanguage: true, locale: 'es-ES' });
  const hint = await page.textContent('#setup-content');
  check(/Your browser is set to Spanish/.test(hint) && (await page.getAttribute('[data-setup-lang="es"]', 'class')).includes('primary'),
    'A Spanish browser sees Spanish suggested, but English still on screen until it is pressed');
  check((await page.evaluate(() => localStorage.getItem('dejavu1.lang'))) === null, 'Nothing is saved until a language is pressed');
  await page.click('#setup-next');
  check(/Step 2 of 10 · Welcome/.test(await stepText(page)) && (await page.evaluate(() => localStorage.getItem('dejavu1.lang'))) === 'en',
    'Continue stays in English and remembers it');
  await page.reload();
  await page.waitForSelector('#setup-dialog[open]', { timeout: 15000 });
  check(/Step 1 of 9/.test(await stepText(page)), 'After a language was chosen the Language step does not come back');
  await page.context().close();
}

(async () => {
  let playwright;
  try {
    playwright = require('playwright');
  } catch (e) {
    console.error('Playwright for Node is not installed.');
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
  const shots = option('--shots');
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const server = await startServer();
  const standIn = await startStandIn();
  const browser = await playwright.chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  try {
    await walk(browser, server, standIn.url.replace(/^http:\/\//, ''), shots);
  } catch (e) {
    results.failed.push('The walk stopped: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
    console.log('FAIL ' + results.failed[results.failed.length - 1]);
  } finally {
    await browser.close();
    server.child.kill();
    standIn.child.kill();
    fs.rmSync(server.data, { recursive: true, force: true });
  }
  console.log(results.failed.length ? `FAILED: ${results.failed.length} of ${results.passed + results.failed.length} checks` : `PASSED: ${results.passed} checks`);
  process.exit(results.failed.length ? 1 : 0);
})();
