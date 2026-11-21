#!/usr/bin/env node
/* The error code window (frontend/errorhelp.js), in a real browser.
 *
 *   node tools/errorhelp-check.js            every check
 *   node tools/errorhelp-check.js --probe    only says whether Playwright and a Chromium are available
 *
 * Starts Deja Vu1 (backend/app.py) on a spare port in a temporary data folder, turns on demo data and drives Demo printer 2, which is paused on one of
 * Snapmaker's codes (0002-0523-0000-0038). The wiki and YouTube are never asked: the guide is answered by this script (including a block that tries to
 * run script, which must show as plain text), and requests to YouTube are counted. Prints one line per check; exits 0 only when all passed.
 * tests/test_error_help_browser.py runs it.
 *
 *   strip      the print tile names the problem and carries a button; pressing it opens the window and not the tile's own sheet
 *   window     the code is shown as four groups, the details are Snapmaker's words as the server holds them, and the source is named
 *   guide      a guide's blocks appear, a picture from another host is dropped, and text that looks like markup stays text
 *   video      nothing from YouTube loads until the button is pressed; then one player opens with the start time and a referrer policy
 *   lookup     the search finds codes by words and by number and opens one
 *   care       the Maintenance tab has the lookup card and the logbook entry for the incident with its button
 *   phone      at 390 px the window has no sideways scroll
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findChromium(playwright) {
  const candidates = [process.env.DEJAVU_BROWSER, '/usr/bin/chromium', '/opt/pw-browsers/chromium', '/usr/bin/chromium-browser'];
  try { candidates.push(playwright.chromium.executablePath()); } catch (e) { /* no bundled browser */ }
  return candidates.find(p => p && fs.existsSync(p)) || null;
}
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const get = url => new Promise((resolve, reject) => {
  http.get(url, res => { let body = ''; res.on('data', c => (body += c)); res.on('end', () => resolve({ status: res.statusCode, body })); }).on('error', reject);
});
async function startServer() {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dejavu-errorhelp-'));
  const env = { ...process.env, PORT: String(port), DEJAVU_DATA_DIR: data, DEJAVU_NO_BROWSER: '1', DEJAVU_TESTER: '0' };
  const child = spawn('python3', [path.join(ROOT, 'backend', 'app.py')], { cwd: ROOT, env, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) {
    try { if ((await get(base + '/api/health')).status === 200) return { base, child }; } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  child.kill();
  throw new Error('The server did not answer /api/health within 20 seconds');
}

const results = { passed: 0, failed: [] };
const check = (ok, what) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + what);
  if (ok) results.passed++; else results.failed.push(what);
};

const GUIDE = {
  ok: true, from: 'wiki', stale: false,
  guide: {
    slug: 'troubleshooting/printing_anomaly', title: 'U1 Tangled Filament Detected', url: 'https://wiki.snapmaker.com/en/snapmaker_u1/troubleshooting/printing_anomaly',
    fetched: '2026-11-21T12:00:00', codes: [], source: 'Snapmaker Wiki',
    videos: [{ id: 'agm4H0GITqE', title: 'U1 Video Guide: Auto Loading Failure Troubleshooting', start: 615 }],
    blocks: [
      { t: 'h', l: 1, x: 'Procedure', id: 'p' },
      { t: 'p', r: [{ x: 'Open the lid. ' }, { x: '<img src=x onerror="window.__pwned=1">', b: true }] },
      { t: 'img', src: 'https://wiki.snapmaker.com/u1/example.jpg', alt: 'a picture from the wiki' },
      { t: 'img', src: 'https://evil.example/tracker.png', alt: 'not from the wiki' },
      { t: 'list', o: false, i: [{ d: 0, r: [{ x: 'Pull the tube out' }] }] }
    ]
  }
};

async function open(browser, base, size, dark) {
  const context = await browser.newContext({ viewport: size, serviceWorkers: 'block' });
  await context.addInitScript(d => {
    try {
      localStorage.setItem('dejavu1.setup-seen', '1');
      localStorage.setItem('dejavu1.printer', 'u1-studio');
      if (d) localStorage.setItem('dejavu1.pref.theme', 'dark');
    } catch (e) { /* no storage */ }
  }, !!dark);
  const page = await context.newPage();
  const errors = [], youtube = [];
  page.on('pageerror', e => errors.push(String(e && e.message ? e.message : e)));
  page.on('request', r => { if (/youtube|ytimg|googlevideo/.test(r.url())) youtube.push(r.url()); });
  await context.route(/youtube-nocookie\.com|youtube\.com/, route => route.fulfill({ contentType: 'text/html', body: '<html><body>player</body></html>' }));
  await context.route('**/api/errors/guide*', route => route.fulfill({ json: GUIDE }));
  await context.route('https://wiki.snapmaker.com/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }));
  await page.goto(base + '/?nointro#/printer', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.ErrorHelp && typeof showTab === 'function' && document.readyState === 'complete', null, { timeout: 30000 });
  await page.evaluate(() => { const t = document.getElementById('demo-toggle'); if (t && !t.checked) { t.checked = true; t.dispatchEvent(new Event('change')); } });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { try { selectPrinter('u1-studio'); } catch (e) { /* no printer list yet */ } });
  await page.mouse.move(Math.round(size.width * 0.6), 300);
  await page.waitForTimeout(2000);
  return { context, page, errors, youtube };
}

async function main() {
  let playwright;
  try { playwright = require('playwright'); } catch (e) { console.error('Playwright for Node is not installed'); process.exit(2); }
  const executablePath = findChromium(playwright);
  if (!executablePath) { console.error('No Chromium was found (set DEJAVU_BROWSER)'); process.exit(2); }
  if (flag('--probe')) process.exit(0);
  const browser = await playwright.chromium.launch({ executablePath, args: ['--no-sandbox'] });
  const server = await startServer();
  try {
    const known = JSON.parse((await get(server.base + '/api/errors/code?code=0002-0523-0000-0038')).body);
    const { context, page, errors, youtube } = await open(browser, server.base, { width: 1366, height: 800 });

    // strip
    const strip = await page.evaluate(() => { const b = document.querySelector('#tile-job-body .eh-strip'); return b ? b.innerText.replace(/\s+/g, ' ') : ''; });
    check(/Printing Anomaly/.test(strip) && /0002-0523-0000-0038/.test(strip) && /What does this mean/.test(strip), 'strip: the print tile names the problem and has the button: ' + strip);
    await page.locator('#tile-job-body [data-errhelp]').first().click();
    await page.waitForSelector('.eh-dialog[open] .eh-code', { timeout: 8000 });
    const sheet = await page.evaluate(() => [...document.querySelectorAll('.cp-sheet')].some(s => !s.hidden && getComputedStyle(s).display !== 'none'));
    check(!sheet, "strip: pressing it did not also open the tile's own sheet");

    // window
    const groups = await page.evaluate(() => [...document.querySelectorAll('.eh-dialog .eh-seg b')].map(b => b.textContent));
    check(JSON.stringify(groups) === JSON.stringify(['0002', '0523', '0000', '0038']), 'window: the four groups of the code: ' + groups.join(' '));
    const said = await page.evaluate(() => (document.querySelector('.eh-said blockquote') || {}).textContent || '');
    check(said.trim() === known.details, "window: the details are Snapmaker's words exactly as the server holds them");
    const source = await page.evaluate(() => (document.querySelector('.eh-said figcaption') || {}).textContent || '');
    check(/U1 error code reference table, read /.test(source), 'window: the source and the day it was read are named: ' + source);

    // video, before and after the press
    const clipsBefore = await page.evaluate(() => document.querySelectorAll('.eh-dialog .eh-video').length);
    check(clipsBefore >= 1 && youtube.length === 0 && (await page.evaluate(() => document.querySelectorAll('.eh-dialog iframe').length)) === 0,
      'video: the window shows ' + clipsBefore + ' video button(s) and has asked YouTube for nothing');

    // guide
    await page.locator('[data-guide]').first().click();
    await page.waitForSelector('.eh-article', { timeout: 8000 });
    const article = await page.evaluate(() => ({
      text: document.querySelector('.eh-article').innerText, imgs: [...document.querySelectorAll('.eh-article img')].map(i => i.src),
      pwned: window.__pwned === 1, listItems: document.querySelectorAll('.eh-article li').length, links: [...document.querySelectorAll('.eh-dialog a')].every(a => a.rel.includes('noopener'))
    }));
    check(/Procedure/.test(article.text) && article.listItems === 1, 'guide: the guide appears with its heading and list');
    check(article.imgs.length === 1 && /wiki\.snapmaker\.com/.test(article.imgs[0]), 'guide: a picture from another host is dropped: ' + article.imgs.join(', '));
    check(!article.pwned && article.text.includes('<img src=x onerror='), 'guide: markup in a guide stays plain text and runs nothing');
    check(article.links, 'guide: every link opens with noopener');

    // the video press
    await page.locator('.eh-dialog .eh-play').first().scrollIntoViewIfNeeded();
    await page.locator('.eh-dialog .eh-play').first().click();
    await page.waitForSelector('.eh-dialog iframe', { timeout: 5000 });
    const frame = await page.evaluate(() => { const f = document.querySelector('.eh-dialog iframe'); return { src: f.src, policy: f.referrerPolicy, count: document.querySelectorAll('.eh-dialog iframe').length }; });
    check(/^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}\?autoplay=1/.test(frame.src) && frame.count === 1, 'video: one player opens from the press: ' + frame.src);
    check(frame.policy === 'strict-origin-when-cross-origin', 'video: the player carries a referrer policy (YouTube refuses without one): ' + frame.policy);

    // lookup
    await page.fill('#eh-q', 'filament runout');
    await page.waitForSelector('.eh-row', { timeout: 8000 });
    const rows = await page.evaluate(() => [...document.querySelectorAll('.eh-row code')].map(c => c.textContent));
    check(rows.length >= 4 && rows.every(c => /^\d{4}(-\d{4}){3}$/.test(c)), 'lookup: words find codes: ' + rows.slice(0, 2).join(', '));
    await page.locator('.eh-row').first().click();
    await page.waitForSelector('.eh-code', { timeout: 8000 });
    check(await page.evaluate(() => document.querySelector('.eh-title').textContent) === 'Filament Anomaly', 'lookup: a result opens its explanation');
    await page.click('#eh-close');

    // care
    await page.evaluate(() => { location.hash = '#/maintenance'; });
    await page.waitForSelector('#error-codes', { timeout: 8000 });
    await page.waitForTimeout(1500);
    const care = await page.evaluate(() => ({ card: !!document.getElementById('error-codes'), chip: document.querySelectorAll('#logbook .eh-strip [data-errhelp]').length,
      now: (document.getElementById('eh-card-now') || {}).hidden === false }));
    check(care.card && care.chip >= 1 && care.now, 'care: the lookup card, the live problem and the logbook entry with its button: ' + JSON.stringify(care));
    check(errors.length === 0, 'no script errors on the way: ' + errors.join(' | '));
    await context.close();

    // phone
    for (const dark of [false, true]) {
      const phone = await open(browser, server.base, { width: 390, height: 844 }, dark);
      await phone.page.locator('[data-errhelp]:visible').first().click();
      await phone.page.waitForSelector('.eh-dialog[open] .eh-code', { timeout: 8000 });
      const wide = await phone.page.evaluate(() => { const b = document.getElementById('eh-body'); return { scroll: b.scrollWidth, client: b.clientWidth, win: document.documentElement.scrollWidth, view: window.innerWidth }; });
      check(wide.scroll <= wide.client + 1 && wide.win <= wide.view + 1, 'phone: no sideways scroll at 390 px' + (dark ? ' in dark' : '') + ': ' + JSON.stringify(wide));
      await phone.context.close();
    }
  } catch (e) {
    check(false, 'the check stopped: ' + (e && e.message ? e.message.split('\n')[0] : e));
  } finally {
    server.child.kill();
    await browser.close();
  }
  console.log('\n' + results.passed + ' checks passed, ' + results.failed.length + ' failed');
  if (results.failed.length) {
    console.log(results.failed.map(f => '  - ' + f).join('\n'));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
