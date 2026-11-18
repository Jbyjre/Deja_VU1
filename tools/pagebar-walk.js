#!/usr/bin/env node
/*
 * The page bar walk: the slim bar at the top of every screen except Overview, in a real Chromium.
 *
 *   node tools/pagebar-walk.js            runs the walk and prints one line per check
 *   node tools/pagebar-walk.js --probe    only says whether Playwright and a Chromium are available
 *   node tools/pagebar-walk.js --shots DIR   also saves a screenshot of the bar on each place into DIR
 *
 * It starts its own server on an empty data folder, with demo data on. It checks that a link to a screen never
 * flashes the Overview look, that every sidebar place shows its own name, parts and buttons in the bar, that the
 * ? note, the search and the buttons work, that Emergency stop still asks first and sends nothing when refused, and
 * that a phone gets the short bar without sideways scrolling.
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
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      })
      .on('error', reject);
  });

async function startServer() {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dejavu-pagebar-'));
  // Tester mode off for this run: its welcome panel would sit over the bar.
  const env = { ...process.env, PORT: String(port), DEJAVU_DATA_DIR: data, DEJAVU_NO_BROWSER: '1', DEJAVU_TESTER: '0' };
  const child = spawn('python3', [path.join(ROOT, 'backend', 'app.py')], { cwd: ROOT, env, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await get(base + '/api/health')) === 200) return { base, child, data };
    } catch (e) {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 200));
  }
  child.kill();
  throw new Error('The server did not answer /api/health within 20 seconds');
}

const results = { passed: 0, failed: [] };
function check(ok, message) {
  if (ok) results.passed++;
  else results.failed.push(message);
  console.log((ok ? 'ok   ' : 'FAIL ') + message);
}

async function openPage(browser, base, size, hash) {
  const context = await browser.newContext({ viewport: size });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  // Every value data-page takes from the first moment on, to catch a flash of the wrong look.
  await page.addInitScript(() => {
    window.__looks = [];
    const watch = () => {
      if (!document.documentElement || window.__watching) return;
      window.__watching = true;
      window.__looks.push(document.documentElement.dataset.page || 'unset');
      new MutationObserver(() => window.__looks.push(document.documentElement.dataset.page)).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-page']
      });
    };
    watch();
    new MutationObserver(watch).observe(document, { childList: true, subtree: true });
  });
  await page.goto(base + '/' + (hash || ''));
  await page.waitForTimeout(1200);
  const skip = await page.$('text=Skip setup');
  if (skip && (await skip.isVisible())) {
    await skip.click();
    await page.waitForTimeout(500);
  }
  return page;
}

const go = async (page, id) => {
  await page.evaluate(x => {
    location.hash = '#/' + x;
  }, id);
  await page.waitForTimeout(700);
};

async function walk(browser, server, shots) {
  /* A link to a screen: the look is right from the first moment. */
  let page = await openPage(browser, server.base, { width: 1366, height: 800 }, '#/printer');
  const looks = await page.evaluate(() => window.__looks);
  check(looks.length > 0 && !looks.includes('overview'), 'A link to Printer never shows the Overview look: ' + JSON.stringify(looks));

  /* No printer yet: the bar's Emergency stop copies the screen's own button, which is off. */
  await go(page, 'printer');
  const idle = await page.evaluate(() => {
    const b = document.querySelector('#pb-actions [data-pb="estop"]');
    return b && { text: b.textContent, disabled: b.disabled };
  });
  check(idle && idle.text === 'Emergency stop' && idle.disabled, 'With no printer the bar\'s Emergency stop is shown and off: ' + JSON.stringify(idle));

  await page.evaluate(() => {
    const t = document.getElementById('demo-toggle');
    if (t && !t.checked) t.click();
  });
  await page.waitForTimeout(2500);

  /* Overview keeps the banner; nothing else does. */
  await go(page, 'overview');
  const ov = await page.evaluate(() => ({
    brand: document.querySelector('.brand').offsetParent !== null,
    bar: document.querySelector('.pb-page').offsetParent !== null,
    intro: getComputedStyle(document.getElementById('tab-intro')).display !== 'none',
    old: !!document.querySelector('.launch-strip, #notice')
  }));
  check(ov.brand && !ov.bar, 'Overview shows the banner and not the page bar');
  check(!ov.intro && !ov.old, 'The intro line, the greeting row and the demo banner are gone from the page');

  /* Every place: its name, its parts and the part that is open. */
  const places = await page.evaluate(() => Rail.destinations.filter(d => d.id !== 'overview').map(d => ({ id: d.id, label: d.label, tab: d.tab, part: d.part })));
  let wrong = [];
  for (const d of places) {
    await go(page, d.id);
    const got = await page.evaluate(() => {
      const bar = document.querySelector('#pb-tabs .sec-bar:not([hidden])');
      const open = bar && bar.querySelector('button[aria-pressed="true"]');
      const tab = Rail.destinations.find(x => x.id === location.hash.slice(2).split('/')[0]).tab;
      return {
        expected: Sections.current(tab) || null,
        look: document.documentElement.dataset.page,
        title: document.getElementById('pb-title').textContent,
        shown: document.querySelector('.pb-page').offsetParent !== null,
        banner: document.querySelector('.brand').offsetParent !== null,
        bars: document.querySelectorAll('#pb-tabs .sec-bar:not([hidden])').length,
        open: open ? open.dataset.sec : null
      };
    });
    // A screen has parts when the app lists them, even where the sidebar names the screen without one.
    const fine = got.look === 'page' && got.title === d.label && got.shown && !got.banner && got.bars === (got.expected ? 1 : 0) && got.open === got.expected && (!d.part || got.open === d.part);
    if (!fine) wrong.push(d.id + ' ' + JSON.stringify(got));
    if (shots) await page.screenshot({ path: path.join(shots, 'bar-' + d.id + '.png'), clip: { x: 0, y: 0, width: 1366, height: 180 } });
  }
  check(wrong.length === 0, 'All ' + places.length + ' places show their name, their parts and the open part in the bar' + (wrong.length ? ': ' + wrong.slice(0, 3).join(' | ') : ''));

  /* The ? note: what the screen is for. */
  await go(page, 'files');
  await page.click('#pb-help');
  await page.waitForTimeout(250);
  const note = await page.evaluate(() => {
    const e = document.getElementById('tab-intro');
    const r = e.getBoundingClientRect();
    return {
      shown: getComputedStyle(e).display !== 'none',
      says: /library|files/i.test(e.textContent),
      tips: !!e.querySelector('[data-tips]'),
      inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
      pressed: document.getElementById('pb-help').getAttribute('aria-expanded')
    };
  });
  check(note.shown && note.says && note.tips && note.inside && note.pressed === 'true', 'The ? button opens the screen\'s note, with its tips button, inside the window: ' + JSON.stringify(note));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check(
    await page.evaluate(() => getComputedStyle(document.getElementById('tab-intro')).display === 'none' && document.activeElement.id === 'pb-help'),
    'Escape closes the note and gives focus back to the ? button'
  );
  await page.click('#pb-help');
  await page.mouse.click(700, 600);
  await page.waitForTimeout(150);
  check(await page.evaluate(() => getComputedStyle(document.getElementById('tab-intro')).display === 'none'), 'A press elsewhere closes the note');

  /* Search opens over the bar. */
  await page.click('#feature-search');
  await page.keyboard.type('twin');
  await page.waitForTimeout(500);
  const found = await page.evaluate(() => ({
    width: Math.round(document.getElementById('feature-search').getBoundingClientRect().width),
    results: document.querySelectorAll('#feature-results .fx-item').length
  }));
  check(found.width > 250 && found.results > 0, 'The search opens wider over the bar and finds results: ' + JSON.stringify(found));
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement.blur());

  /* A tab in the bar changes the part of the screen. */
  await go(page, 'printer');
  await page.click('#sec-control button[data-sec="live"]');
  await page.waitForTimeout(400);
  check(
    await page.evaluate(() => document.querySelector('#sec-control button[aria-pressed="true"]').dataset.sec === 'live' && document.getElementById('twin-card').classList.contains('sec-off')),
    'A tab in the bar opens that part of the Printer screen'
  );
  await page.click('#sec-control button[data-sec="control"]');
  await page.waitForTimeout(300);

  /* Emergency stop asks first, and a refusal sends nothing. */
  const posts = [];
  page.on('request', r => {
    if (r.method() === 'POST' && /\/control\/estop/.test(r.url())) posts.push(r.url());
  });
  let asked = null;
  page.once('dialog', d => {
    asked = d.message();
    d.dismiss();
  });
  const live = await page.evaluate(() => document.querySelector('#pb-actions [data-pb="estop"]').disabled);
  check(live === false, 'With a printer the bar\'s Emergency stop is on');
  await page.click('#pb-actions [data-pb="estop"]');
  await page.waitForTimeout(500);
  check(!!asked && /^Emergency stop\?/.test(asked) && posts.length === 0, 'Emergency stop asks first, and saying no sends nothing: ' + JSON.stringify(asked && asked.slice(0, 40)));
  check(await page.evaluate(() => getComputedStyle(document.getElementById('pp-estop')).display === 'none'), 'The card\'s own Emergency stop steps aside on a computer, so there is one');

  /* The other main buttons. */
  await go(page, 'printers');
  await page.click('#pb-actions [data-pb="add-printer"]');
  await page.waitForTimeout(400);
  check(await page.evaluate(() => document.getElementById('add-printer-form').open && document.activeElement.id === 'fleet-add-name'), 'Add printer opens the form and puts the cursor in the name');
  await go(page, 'files');
  const chooser = page.waitForEvent('filechooser', { timeout: 3000 }).then(() => true, () => false);
  await page.click('#pb-actions [data-pb="add-files"]');
  check(await chooser, 'Add files opens the file chooser');

  /* The sidebar's name goes home. */
  await page.click('#rail-brand');
  await page.waitForTimeout(500);
  check(await page.evaluate(() => location.hash.startsWith('#/overview')), 'The name at the top of the sidebar goes to Overview');
  check(page.errors.length === 0, 'No script errors on a laptop: ' + page.errors.slice(0, 2).join(' | '));
  await page.context().close();

  /* A phone: short bar, state in a small label, nothing scrolls sideways, the card keeps its own Emergency stop. */
  page = await openPage(browser, server.base, { width: 390, height: 844 }, '#/printer');
  await page.evaluate(() => {
    const t = document.getElementById('demo-toggle');
    if (t && !t.checked) t.click();
  });
  await page.waitForTimeout(2500);
  for (const id of ['printer', 'files', 'settings']) {
    await go(page, id);
    const ph = await page.evaluate(() => {
      const box = el => {
        const r = el.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth;
      };
      return {
        title: document.getElementById('pb-title').textContent,
        fits: box(document.querySelector('.topbar')) && box(document.getElementById('pb-help')) && box(document.querySelector('.pb-page')),
        sideways: document.documentElement.scrollWidth > innerWidth,
        demo: getComputedStyle(document.getElementById('conn')).display !== 'none',
        estop: getComputedStyle(document.getElementById('pp-estop')).display !== 'none'
      };
    });
    check(ph.title.length > 0 && ph.fits && !ph.sideways && ph.demo, 'On a phone the ' + id + ' bar fits, shows Simulated and does not scroll sideways: ' + JSON.stringify(ph));
    if (id === 'printer') check(ph.estop, 'On a phone the Printer screen keeps its own Emergency stop');
    if (shots) await page.screenshot({ path: path.join(shots, 'phone-' + id + '.png'), clip: { x: 0, y: 0, width: 390, height: 260 } });
  }
  check(page.errors.length === 0, 'No script errors on a phone: ' + page.errors.slice(0, 2).join(' | '));
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
  const browser = await playwright.chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  try {
    await walk(browser, server, shots);
  } catch (e) {
    results.failed.push('The walk stopped: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
    console.log('FAIL ' + results.failed[results.failed.length - 1]);
  } finally {
    await browser.close();
    server.child.kill();
    fs.rmSync(server.data, { recursive: true, force: true });
  }
  console.log(results.failed.length ? `FAILED: ${results.failed.length} of ${results.passed + results.failed.length} checks` : `PASSED: ${results.passed} checks`);
  process.exit(results.failed.length ? 1 : 0);
})();
