#!/usr/bin/env node
/* Walk Deja Vu1 in a real browser the way a person would, and fail on what a person would notice.
 *
 *   node tools/browser-walk.js                 starts its own server, walks, runs the workflows, prints a table
 *   node tools/browser-walk.js --url http://localhost:8000   uses a server that is already running
 *   node tools/browser-walk.js --out DIR       keeps a screenshot per place and the report in DIR
 *   node tools/browser-walk.js --quick         one width (1366 px) and demo data only
 *   node tools/browser-walk.js --probe         only says whether Playwright and a Chromium are available
 *   --places-only, --flows-only, --flow "text" pick a part (a workflow whose title has that text)
 *
 * Places: every place in the sidebar (read from frontend/rail.js, so a new place is walked by itself) at
 * 1366 px and 390 px, in light and dark, with demo data and with none. For each visit it checks:
 *   - the screen opens (the page's data-tab matches the place)
 *   - no uncaught script error and no console error
 *   - no request answered with a server error (500 and up) or dropped
 *   - the page does not scroll sideways
 *   - no stray "undefined", "NaN" or "[object Object]" in the visible text
 *   - with no demo data, no data route invents a connected printer
 * Workflows (demo data, both widths): import a file through the file picker; open every sample G-code file
 * in Confirm Print and check the verdict is complete and that "blocked" really disables Start; a slow answer
 * for an earlier file must not replace the one on screen; add to and remove from the queue; open a model;
 * the slicer set-up card; the phone pairing sheet.
 * Needs Playwright for Node and a Chromium (DEJAVU_BROWSER names the file if it is somewhere unusual).
 * Exit code 0 only when every check passed; the cause of each failure is printed. */
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

/* The places, read from the sidebar's own table so the walk can't drift from the app. */
function readPlaces() {
  const src = fs.readFileSync(path.join(ROOT, 'frontend', 'rail.js'), 'utf8');
  const block = src.slice(src.indexOf('const DEST = ['), src.indexOf('].map(([id, label, tab, part, group])'));
  const rows = [...block.matchAll(/\['([a-z]+)',\s*'([^']+)',\s*'([a-z]+)',\s*(null|'[a-z]+'),\s*'([a-z]+)'\]/g)];
  return rows.map(m => ({ id: m[1], label: m[2], tab: m[3], part: m[4] === 'null' ? null : m[4].slice(1, -1) }));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, res => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });
}

async function startServer() {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dejavu-walk-'));
  const env = { ...process.env, PORT: String(port), DEJAVU_DATA_DIR: data, DEJAVU_NO_BROWSER: '1' };
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

const BAD_TEXT = /\bundefined\b|\bNaN\b|\[object Object\]/;
/* Console errors that come from the sandbox, not from the app. */
const IGNORED_CONSOLE = [/favicon/i, /Failed to load resource: the server responded with a status of 40[134]/];

/* One browser window with the listeners every check needs. `where` names what is being done, for the report. */
async function openSession(browser, base, cfg) {
  const { width, demo, theme } = cfg;
  const context = await browser.newContext({
    viewport: { width, height: width <= 720 ? 844 : 900 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const session = { context, page, problems: [], where: '(start)' };
  const note = text => session.problems.push({ place: session.where, text });
  session.note = note;
  session.check = (ok, text) => {
    if (!ok) note(text);
  };
  page.on('pageerror', e => note('script error: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !IGNORED_CONSOLE.some(re => re.test(m.text()))) note('console error: ' + m.text());
  });
  page.on('requestfailed', r => {
    if (r.url().startsWith(base) && !/ERR_ABORTED/.test(r.failure() ? r.failure().errorText : '')) {
      note('request failed: ' + r.url().replace(base, ''));
    }
  });
  page.on('response', async r => {
    const url = r.url();
    if (!url.startsWith(base)) return;
    if (r.status() >= 500) note('server error ' + r.status() + ': ' + url.replace(base, ''));
    if (!demo && url.startsWith(base + '/api/') && r.status() === 200 && /\/api\/(printer|state|status|live)/.test(url)) {
      try {
        const body = await r.json();
        if (body && body.connected === true) note('invented a connected printer with no demo data: ' + url.replace(base, ''));
      } catch (e) {
        /* not JSON: nothing to check */
      }
    }
  });
  await page.goto(base + '/?dashboard', { waitUntil: 'load' });
  await page.waitForSelector('body[data-tab]', { timeout: 15000 });
  await page.keyboard.press('Escape');
  if (demo) {
    await page.evaluate(() => {
      const t = document.getElementById('demo-toggle');
      if (t && !t.checked) t.click();
    });
    await page.waitForTimeout(600);
  }
  await page.evaluate(t => {
    document.documentElement.dataset.theme = t;
  }, theme);
  return session;
}

async function walkPlaces(browser, base, places, cfg, out, results) {
  const s = await openSession(browser, base, cfg);
  const { page } = s;
  for (const place of places) {
    s.where = place.id;
    await page.evaluate(id => {
      location.hash = '#/' + id;
    }, place.id);
    await page.waitForFunction(tab => document.body.dataset.tab === tab, place.tab, { timeout: 8000 }).catch(() => {
      s.note('the screen "' + place.tab + '" did not open');
    });
    await page.waitForTimeout(450);
    await page.keyboard.press('Escape');
    const facts = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      text: document.body.innerText
    }));
    if (facts.overflow > 1) s.note('scrolls sideways by ' + facts.overflow + ' px');
    const bad = facts.text.match(BAD_TEXT);
    if (bad) {
      const at = facts.text.indexOf(bad[0]);
      s.note('stray text "' + bad[0] + '" near: ' + facts.text.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, ' '));
    }
    if (out) {
      const name = [place.id, cfg.width, cfg.demo ? 'demo' : 'empty', cfg.theme].join('-') + '.png';
      await page.screenshot({ path: path.join(out, name) });
    }
  }
  await s.context.close();
  for (const p of s.problems) results.failures.push({ config: cfg, ...p });
  results.checked += places.length;
}

/* ---- Workflows ---- */

async function loadSamples(page) {
  await page.evaluate(async () => {
    await fetch('/api/files/samples?demo=1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  });
}

async function openFileNamed(page, name) {
  await page.evaluate(async n => {
    location.hash = '#/files';
    await Workshop.loadFiles();
    await Workshop.openFile(n);
  }, name);
  await page.locator('#fd-name').filter({ hasText: name }).waitFor({ timeout: 8000 });
}

async function readDialog(page) {
  return page.evaluate(() => {
    const text = id => (document.getElementById(id) || {}).innerText || '';
    const dialog = document.getElementById('confirm-dialog');
    return {
      open: !!(dialog && dialog.open),
      sub: text('confirm-sub'),
      health: text('confirm-health').replace(/\s+/g, ' ').trim(),
      body: text('confirm-body').replace(/\s+/g, ' ').trim(),
      banner: ((document.querySelector('#confirm-body .gate-banner') || {}).className || '').replace('gate-banner', '').trim(),
      goDisabled: document.getElementById('confirm-go').disabled,
      overflow: dialog ? dialog.scrollWidth - dialog.clientWidth : 0
    };
  });
}

async function closeConfirm(page) {
  await page.evaluate(() => document.getElementById('confirm-cancel').click());
  await page.waitForTimeout(250);
}

async function sampleGcodeNames(page) {
  return page.evaluate(async () => {
    const r = await (await fetch('/api/files?demo=1')).json();
    return (r.files || r).map(f => f.name).filter(n => /\.gcode$/.test(n));
  });
}

const FLOWS = [
  ['import a file through the file picker', async (s, ctx) => {
    const { page } = s;
    await page.evaluate(() => {
      location.hash = '#/files';
    });
    const name = 'walk_import_' + ctx.width + '.gcode';
    const file = path.join(ctx.tmp, name);
    fs.writeFileSync(file, '; generated by the browser walk\n; filament_colour = #ff8800\nG28\nG1 X20 Y20 Z0.2 E1\nG1 X40 Y20 E2\nM104 S0\n');
    await page.waitForTimeout(400);
    await page.setInputFiles('#file-upload', file);
    await page.waitForFunction(n => document.body.innerText.includes(n), name, { timeout: 10000 }).catch(() => {});
    s.check(await page.evaluate(n => document.body.innerText.includes(n), name), 'an uploaded file did not appear in Files');
  }],

  ['Confirm Print on every sample G-code file', async s => {
    const { page } = s;
    const names = await sampleGcodeNames(page);
    s.check(names.length >= 4, 'fewer than 4 sample G-code files (' + names.length + ')');
    for (const name of names) {
      s.where = 'Confirm Print: ' + name;
      await openFileNamed(page, name);
      await page.locator('#fd-print').first().click();
      await page.locator('#confirm-body .gate-banner').waitFor({ timeout: 20000 }).catch(() => {});
      const d = await readDialog(page);
      s.check(d.open, 'the dialog did not open');
      s.check(/^(blocked|confirm|clear)$/.test(d.banner), 'no verdict after 20 s (still: ' + d.body.slice(0, 60) + ')');
      s.check(/^\d{1,3}\s*health$/i.test(d.health), 'health is not a number: "' + d.health + '"');
      s.check(d.goDisabled === (d.banner === 'blocked'), 'Start is ' + (d.goDisabled ? 'disabled' : 'enabled') + ' on a "' + d.banner + '" verdict');
      s.check(d.overflow <= 1, 'the dialog scrolls sideways by ' + d.overflow + ' px');
      if (/unsafe/.test(name)) {
        s.check(d.banner === 'blocked', 'the unsafe sample is not blocked');
        s.check(/build volume/i.test(d.body), 'the unsafe sample does not say why (build volume)');
      }
      await closeConfirm(page);
    }
  }],

  ['a slow Confirm Print answer for an earlier file stays out of the dialog', async s => {
    const { page } = s;
    const [a, b] = ['3dbenchy_pla.gcode', 'hex_coaster_three_colour.gcode'];
    await page.route('**/api/print/confirm?**', async route => {
      if (route.request().url().includes(a)) await new Promise(r => setTimeout(r, 2500));
      await route.continue();
    });
    const open = async name => {
      await openFileNamed(page, name);
      await page.locator('#fd-print').first().click();
    };
    await open(b);
    await page.locator('#confirm-body .gate-banner').waitFor({ timeout: 20000 });
    const settled = await readDialog(page);
    await closeConfirm(page);
    await open(a);
    await page.waitForTimeout(300);
    const waiting = await readDialog(page);
    s.check(/^[–-]\s*health$/i.test(waiting.health) && waiting.goDisabled, 'while checking, the dialog still shows an earlier verdict: "' + waiting.health + '"');
    await closeConfirm(page);
    await open(b);
    await page.locator('#confirm-body .gate-banner').waitFor({ timeout: 20000 });
    await page.waitForTimeout(2800);
    const after = await readDialog(page);
    s.check(after.sub.startsWith(b) && after.health === settled.health && after.body === settled.body, 'a late answer for ' + a + ' replaced the verdict for ' + b);
    await closeConfirm(page);
    await page.unroute('**/api/print/confirm?**');
  }],

  ['add to and remove from the queue', async s => {
    const { page } = s;
    await openFileNamed(page, '3dbenchy_pla.gcode');
    await page.locator('#fd-queue').click();
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      location.hash = '#/queue';
    });
    await page.locator('.queue-item').first().waitFor({ timeout: 8000 }).catch(() => {});
    const added = await page.locator('.queue-item').filter({ hasText: '3dbenchy_pla.gcode' }).count();
    s.check(added >= 1, 'the file did not appear in the queue');
    for (let i = 0; i < 10 && (await page.locator('.queue-item [data-q="remove"]').count()); i++) {
      await page.locator('.queue-item [data-q="remove"]').first().click();
      await page.waitForTimeout(500);
    }
    s.check((await page.locator('.queue-item').count()) === 0, 'Remove did not empty the queue');
  }],

  ['open a model', async s => {
    const { page } = s;
    await openFileNamed(page, 'spur_gear_24t.stl');
    await page.waitForFunction(() => /Object settings/.test(document.getElementById('fd-side').innerText), null, { timeout: 15000 }).catch(() => {});
    const side = await page.evaluate(() => document.getElementById('fd-side').innerText);
    s.check(/Object settings/.test(side), 'the model panel did not finish loading: "' + side.slice(0, 50).replace(/\s+/g, ' ') + '"');
    s.check(await page.evaluate(() => !!document.getElementById('fd-canvas')), 'no 3D view');
  }],

  ['the slicer set-up card', async s => {
    const { page } = s;
    await page.evaluate(() => {
      location.hash = '#/slice';
    });
    await page.waitForTimeout(900);
    const info = await page.evaluate(() => {
      const e = document.getElementById('slice-ready');
      return { visible: !!(e && e.offsetParent), buttons: e ? e.querySelectorAll('button').length : 0, text: e ? e.innerText : '' };
    });
    s.check(info.visible && info.text.length > 60, 'the slicer set-up card is empty or hidden');
    s.check(info.buttons >= 1, 'the slicer set-up card offers no button');
  }],

  ['the phone pairing sheet', async s => {
    const { page } = s;
    await page.evaluate(() => {
      location.hash = '#/settings';
    });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      const e = document.getElementById('phone-connect-btn');
      if (e && window.Sections && Sections.reveal) Sections.reveal(e);
    });
    const button = page.locator('#phone-connect-btn');
    if (!(await button.isVisible().catch(() => false))) return; // the phone layout hides it; the phone has its own install card
    await button.click();
    await page.waitForTimeout(1500);
    const sheet = await page.evaluate(() => {
      const d = [...document.querySelectorAll('dialog')].find(x => x.open);
      return d ? { text: d.innerText.replace(/\s+/g, ' ').trim(), art: d.querySelectorAll('svg,img,canvas').length } : null;
    });
    s.check(!!sheet, 'the pairing sheet did not open');
    if (sheet) s.check(sheet.art > 0 || /home network|Wi-?Fi|same network/i.test(sheet.text), 'the pairing sheet shows neither a code nor an explanation');
  }]
];

async function runFlows(browser, base, cfg, tmp, results, filter) {
  const s = await openSession(browser, base, cfg);
  await loadSamples(s.page);
  for (const [title, fn] of FLOWS) {
    if (filter && !title.toLowerCase().includes(filter.toLowerCase())) continue;
    s.where = 'flow: ' + title;
    try {
      await fn(s, { width: cfg.width, tmp });
    } catch (e) {
      s.note('the flow stopped: ' + String(e.message).split('\n')[0]);
    }
    results.flows += 1;
  }
  await s.context.close();
  for (const p of s.problems) results.failures.push({ config: cfg, ...p });
}

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
  const places = readPlaces();
  if (places.length < 10) {
    console.error('Read only ' + places.length + ' places from frontend/rail.js; the walk cannot trust its table.');
    process.exit(2);
  }
  const out = option('--out');
  if (out) fs.mkdirSync(out, { recursive: true });
  const given = option('--url');
  const server = given ? { base: given.replace(/\/$/, '') } : await startServer();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dejavu-walk-files-'));
  const browser = await playwright.chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const results = { checked: 0, flows: 0, failures: [], places: places.map(p => p.id) };
  const widths = flag('--quick') ? [1366] : [1366, 390];
  const matrix = [];
  for (const width of widths) {
    for (const demo of flag('--quick') ? [true] : [true, false]) {
      for (const theme of ['light', 'dark']) matrix.push({ width, demo, theme });
    }
  }
  try {
    if (!flag('--flows-only')) for (const cfg of matrix) await walkPlaces(browser, server.base, places, cfg, out, results);
    if (!flag('--places-only')) {
      for (const width of widths) await runFlows(browser, server.base, { width, demo: true, theme: 'light' }, tmp, results, option('--flow'));
    }
  } finally {
    await browser.close();
    if (server.child) server.child.kill();
    if (server.data) fs.rmSync(server.data, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (out) fs.writeFileSync(path.join(out, 'browser-walk.json'), JSON.stringify(results, null, 2));
  const seen = new Set();
  for (const f of results.failures) {
    const key = [f.place, f.text].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const c = f.config;
    console.log('FAIL ' + f.place + ' (' + c.width + ' px, ' + (c.demo ? 'demo' : 'no demo') + ', ' + c.theme + '): ' + f.text);
  }
  console.log(
    (results.failures.length ? 'FAILED' : 'PASSED') + ': ' + places.length + ' places, ' + results.checked + ' visits, ' +
      results.flows + ' workflow runs, ' + seen.size + ' distinct problems'
  );
  process.exit(results.failures.length ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
