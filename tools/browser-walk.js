#!/usr/bin/env node
/* Walk Deja Vu1 in a real browser the way a person would, and fail on what a person would notice.
 *
 *   node tools/browser-walk.js                 starts its own server, walks, runs the workflows, prints a table
 *   node tools/browser-walk.js --url http://localhost:8000   uses a server that is already running
 *   node tools/browser-walk.js --out DIR       keeps a screenshot per place and the report in DIR
 *   node tools/browser-walk.js --quick         one width (1366 px) and demo data only
 *   node tools/browser-walk.js --probe         only says whether Playwright and a Chromium are available
 *   --places-only, --flows-only, --flow "text" pick a part (a workflow whose title has that text)
 *   --axe                                     also run axe-core (WCAG 2.2 AA and best practice) on every place;
 *                                             needs `npm install axe-core` where Node can find it
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
 * the slicer set-up card; the phone pairing sheet; the colour sensor on a stand-in printer (tools/stand-in-printer.py):
 * assign it, record a white reference with the real button, and see the sensor beside the file's and the printer's
 * colours in Confirm Print; text from files, printers, spools and notes shows as plain text (script payloads are
 * planted in each, after a control that proves the check can see an injection).
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
  /* A stand-in printer answers only part of Moonraker: its 502s for features it lacks are not the app's fault. */
  const ignored = cfg.standIn ? IGNORED_CONSOLE.concat([/status of 502/]) : IGNORED_CONSOLE;
  page.on('console', m => {
    if (m.type() === 'error' && !ignored.some(re => re.test(m.text()))) note('console error: ' + m.text());
  });
  page.on('requestfailed', r => {
    if (r.url().startsWith(base) && !/ERR_ABORTED/.test(r.failure() ? r.failure().errorText : '')) {
      note('request failed: ' + r.url().replace(base, ''));
    }
  });
  page.on('response', async r => {
    const url = r.url();
    if (!url.startsWith(base)) return;
    if (r.status() >= 500 && !(cfg.standIn && r.status() === 502)) note('server error ' + r.status() + ': ' + url.replace(base, ''));
    if (!demo && !cfg.standIn && url.startsWith(base + '/api/') && r.status() === 200 && /\/api\/(printer|state|status|live)/.test(url)) {
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

let axeSource = null;

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
    if (axeSource) {
      await page.addScriptTag({ content: axeSource });
      const found = await page.evaluate(async () => {
        const r = await axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
          resultTypes: ['violations']
        });
        return r.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length, target: v.nodes[0].target.join(' ') }));
      });
      for (const v of found) s.note('accessibility [' + v.impact + '] ' + v.id + ' on ' + v.count + ' element(s), first: ' + v.target);
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

/* The colour sensor on a stand-in printer: calibrate with the real button, see it in Confirm Print. */
async function sensorFlow(s, standIn) {
  const { page } = s;
  const post = (url, body, raw) => page.evaluate(async ([u, b, r]) => {
    const res = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: r || JSON.stringify(b || {}) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }, [url, body, raw]);
  const bands = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'];
  const blue = [0.35, 0.6, 0.55, 0.3, 0.1, 0.05, 0.04, 0.04];
  let id = null;
  try {
    id = (await post('/api/fleet/registry', { name: 'Walk stand-in', moonraker_url: standIn })).body.id;
    s.check(!!id, 'the stand-in printer could not be added');
    await post('/api/modules/color_check/toggle', { enabled: true });
    const q = '?printer=' + id;
    const bind = { toolhead: 'T0', device_id: 'pico-1', channel_id: 'inlet-0', sensor_id: 'as7341-1', sensor_model: 'AS7341' };
    s.check((await post('/api/colorcheck/sensors' + q, { version: 1, simulated: false, bindings: [bind] })).status === 200, 'the sensor could not be assigned');
    const send = ratio => post('/api/colorcheck/readings' + q, {
      version: 1, simulated: false, device_id: 'pico-1', channel_id: 'inlet-0', sensor_id: 'as7341-1', sensor_model: 'AS7341',
      captured_at: Date.now() / 1000, quality_flags: [], calibrated: null,
      raw: Object.fromEntries(bands.map((n, i) => [n, 1000 * (Array.isArray(ratio) ? ratio[i] : ratio)]))
    });
    await post('/api/files/upload?name=walk_sensor.gcode', null, '; filament_colour = #ff0000\n; filament_type = PLA\nG28\nT0\nG1 X20 Y20 Z0.2 E1\nM104 S0\n');
    await page.evaluate(() => {
      const t = document.getElementById('demo-toggle');
      if (t && t.checked) t.click();
    });
    await page.evaluate(pid => Workshop.selectPrinter(pid), id);
    await page.waitForTimeout(1000);
    await send(1);
    await page.evaluate(() => {
      location.hash = '#/filament';
    });
    await page.waitForTimeout(800);
    await page.evaluate(() => Sections.reveal(document.getElementById('colors')));
    await page.locator('#colors [data-cal="white"]').waitFor({ timeout: 10000 });
    await page.waitForFunction(() => /needs calibration/i.test(document.getElementById('colors').innerText), null, { timeout: 15000 }).catch(() => {});
    s.check(/needs calibration/i.test(await page.locator('#colors').innerText()), 'a sensor with only raw counts does not say it needs calibration');
    await send(1);
    await page.locator('#colors [data-cal="white"]').click();
    await page.waitForFunction(() => /Calibration dv1-/.test(document.getElementById('colors').innerText), null, { timeout: 10000 }).catch(() => {});
    s.check(/Calibration dv1-/.test(await page.locator('#colors').innerText()), 'the white reference was not recorded from the button');
    await send(blue);
    await page.waitForTimeout(300);
    await page.evaluate(() => Workshop.loadFiles && Workshop.loadFiles());
    await page.waitForFunction(() => /#0075c9/i.test(document.getElementById('colors').innerText), null, { timeout: 8000 }).catch(() => {});
    s.check(/#0075c9/i.test(await page.locator('#colors').innerText()), 'a calibrated blue sample did not show as #0075c9');
    await page.evaluate(async () => {
      location.hash = '#/files';
      await Workshop.loadFiles();
      await Workshop.openFile('walk_sensor.gcode');
    });
    await page.locator('#fd-print').first().click();
    await page.locator('#confirm-body .gate-banner').waitFor({ timeout: 20000 });
    const gate = await page.locator('#confirm-body').innerText();
    s.check(/Colour sensor reads #0075c9, far from the file/.test(gate), 'Confirm Print does not show the sensor beside the file and printer colours');
    s.check(/not as proof/.test(gate), 'the sensor warning does not say it is not proof');
    await closeConfirm(page);
  } finally {
    if (id) await post('/api/fleet/registry/' + id + '/remove', {});
  }
}

/* Text from files, printers, spools and notes must show as text. Plants script payloads, walks every place. */
const PAYLOADS = [
  '<img src=x onerror="window.__xss=(window.__xss||0)+1">',
  '"><svg onload=window.__xss=(window.__xss||0)+100>',
  "'><script>window.__xss=(window.__xss||0)+10000</script>"
];

async function injectionFlow(s, places, standIns) {
  const { page } = s;
  const probe = () => page.evaluate(() => ({
    ran: window.__xss || 0,
    planted: document.querySelectorAll('img[src="x"],[onerror*="__xss"],[onload*="__xss"],[onmouseover*="__xss"]').length,
    first: ((document.querySelector('img[src="x"],[onerror*="__xss"],[onload*="__xss"],[onmouseover*="__xss"]') || {}).outerHTML || '').slice(0, 120)
  }));
  // Control: the detector must see a payload that really is injected, or its silence means nothing.
  await page.evaluate(p => document.body.insertAdjacentHTML('beforeend', p), PAYLOADS[0]);
  await page.waitForTimeout(300);
  const control = await probe();
  s.check(control.ran > 0 || control.planted > 0, 'the injection check cannot see a payload it planted itself');
  await page.reload();
  await page.waitForSelector('body[data-tab]');
  await page.keyboard.press('Escape');
  const post = (url, body, raw) => page.evaluate(async ([u, b, r]) => {
    const res = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: r || JSON.stringify(b || {}) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }, [url, body, raw]);
  const [p1, p2, p3] = PAYLOADS;
  s.check(standIns.length === 2, 'two stand-in printers are needed');
  const printers = [];
  try {
    await post('/api/logbook/add', { problem: p1, fix: p2, tags: [p3, 'walk'] });
    await post('/api/filament/spools', { material: p1, color_name: p2, color_hex: '#ff0000', grams_remaining: 500, weight_source: 'weighed' });
    await post('/api/filament/spools', { material: 'PLA', color_name: p1, color_hex: '#00ff00', grams_remaining: 100, weight_source: 'estimated' });
    // Two connected stand-ins, so the fleet cards, the header chip and the sidebar's printer menu all draw names.
    for (const [name, url] of [[p1, standIns[0]], [p2, standIns[1]]]) {
      printers.push((await post('/api/fleet/registry', { name, moonraker_url: url })).body.id);
    }
    s.check(printers.every(Boolean), 'the stand-in printers could not be added');
    const gcode = '; generated by ' + p1 + '\n; filament_colour = #ff0000"onmouseover="window.__xss=9;' + p2 + '\n; filament_type = ' + p3 + '\nG28\nG1 X10 Y10 Z0.2 E1\nM104 S0\n';
    await post('/api/files/upload?name=' + encodeURIComponent(p1 + '.gcode'), null, gcode);
    await post('/api/files/upload?name=plain_walk.gcode', null, gcode);
    await page.reload();
    await page.waitForSelector('body[data-tab]');
    await page.keyboard.press('Escape');
    for (const place of places) {
      s.where = 'text as text: ' + place.id;
      await page.evaluate(id => {
        location.hash = '#/' + id;
      }, place.id);
      await page.waitForTimeout(450);
      if (place.id === 'files') {
        await page.evaluate(async () => {
          await Workshop.loadFiles();
          await Workshop.openFile('plain_walk.gcode');
        });
        await page.waitForTimeout(500);
      }
      // Screens show one part at a time: ask for all of them so every list is drawn.
      await page.evaluate(() => {
        const all = document.querySelector('.tab-panel:not([hidden]) .sec-bar .sec-all');
        if (all) all.click();
      });
      await page.waitForTimeout(500);
      const seen = await probe();
      s.check(seen.ran === 0 && seen.planted === 0, 'planted text ran or became markup (' + JSON.stringify(seen) + ')');
    }
    // The sidebar's printer menu only draws its rows when it is opened.
    s.where = 'text as text: the printer menu';
    const menuButton = page.locator('#rail-switch');
    if (await menuButton.isVisible().catch(() => false)) {
      await menuButton.click();
      await page.waitForTimeout(500);
      const seen = await probe();
      s.check(seen.ran === 0 && seen.planted === 0, 'planted text ran or became markup (' + JSON.stringify(seen) + ')');
      await page.keyboard.press('Escape');
    } else {
      s.note('with two printers the sidebar shows no printer menu button');
    }
  } finally {
    for (const id of printers) if (id) await post('/api/fleet/registry/' + id + '/remove', {});
  }
}

async function runInjectionFlow(browser, base, places, cfg, results) {
  const s = await openSession(browser, base, { ...cfg, demo: false, standIn: true });
  s.where = 'flow: text from files, printers, spools and notes shows as text';
  const standIns = [];
  try {
    for (let i = 0; i < 2; i++) standIns.push(await startStandIn());
    await injectionFlow(s, places, standIns.map(x => x.url));
  } catch (e) {
    s.note('the flow stopped: ' + String(e.message).split('\n')[0]);
  } finally {
    for (const x of standIns) x.child.kill();
  }
  results.flows += 1;
  await s.context.close();
  for (const p of s.problems) results.failures.push({ config: cfg, ...p });
}

function startStandIn() {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [path.join(ROOT, 'tools', 'stand-in-printer.py')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.once('data', d => resolve({ child, url: String(d).trim() }));
    child.once('error', reject);
    child.once('exit', code => reject(new Error('the stand-in printer exited with ' + code)));
  });
}

async function runSensorFlow(browser, base, cfg, results) {
  const s = await openSession(browser, base, { ...cfg, demo: false, standIn: true });
  s.where = 'flow: the colour sensor on a stand-in printer';
  let standIn = null;
  try {
    standIn = await startStandIn();
    await sensorFlow(s, standIn.url);
  } catch (e) {
    s.note('the flow stopped: ' + String(e.message).split('\n')[0]);
  } finally {
    if (standIn) standIn.child.kill();
  }
  results.flows += 1;
  await s.context.close();
  for (const p of s.problems) results.failures.push({ config: cfg, ...p });
}

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
  if (flag('--axe')) {
    try {
      axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
    } catch (e) {
      console.error('axe-core is not installed (npm install axe-core).');
      process.exit(2);
    }
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
      const wanted = option('--flow');
      if (!wanted || 'text'.includes(wanted.toLowerCase()) || wanted.toLowerCase().includes('text')) {
        await runInjectionFlow(browser, server.base, places, { width: 1366, theme: 'light' }, results);
      }
      if (!wanted || 'colour sensor'.includes(wanted.toLowerCase()) || wanted.toLowerCase().includes('sensor')) {
        for (const width of widths) await runSensorFlow(browser, server.base, { width, demo: false, theme: 'light' }, results);
      }
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
