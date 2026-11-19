#!/usr/bin/env node
/* Tester mode in a real browser.
 *
 *   node tools/tester-walk.js --zip FILE [--shots DIR]   the walk: a run kept off, then the tester build as shipped, then save the report
 *   node tools/tester-walk.js --overhead [--pages N --pairs N --secs N --reps N] [--same-server]   what recording costs on the Printer page with the 3D twin
 *                                                     (--same-server: one server; the "off" pages run a copy of tester.js whose start() does nothing)
 *   node tools/tester-walk.js --profile [--secs N]       the main-thread time spent inside tester.js, from a CPU profile
 *   node tools/tester-walk.js --probe                    only says whether Playwright and a Chromium are available
 *
 * The walk starts its own servers and a stand-in printer (tests/fake_moonraker.py, a pretend printer, not a real one).
 *   1. A run started with DEJAVU_TESTER=0 (a developer's off): the pages are used, the browser sends nothing to /api/tester and
 *      the routes answer 403.
 *   2. The tester build as shipped (always on, no switch): the first-run setup is clicked through, and no tester pop-up, chip or panel
 *      appears with it; every place is opened, controls are pressed (also double and right presses, a list choice, keys,
 *      the tour), a file is checked and printed on the stand-in printer, paused and cancelled, and three things go wrong on
 *      purpose: a request held back for 2.6 s, a button that freezes the page for 1.4 s, and an error, a failed promise and an
 *      error toast. "Something felt off" saves a tagged note, with the error that just happened.
 *   3. Settings > Tester mode is checked (no switch, no days to pick, the 22 questions' progress, View report, Save tester report), the
 *      questions are opened from there with no round to run out, some of the 22 are answered (only 16 and 17 have a "Didn't try it") and
 *      the zip is saved from the last step (kept at --zip).
 *   4. A phone-sized touch browser taps something, and the server's record says it was a touch.
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

async function startServer(extraEnv = {}) {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dejavu-tester-'));
  const env = { ...process.env, PORT: String(port), DEJAVU_DATA_DIR: data, DEJAVU_NO_BROWSER: '1', ...extraEnv };
  if (!('DEJAVU_TESTER' in extraEnv)) delete env.DEJAVU_TESTER;
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
/* To find what costs frames, a copy of tester.js with one part taken out can be served instead (--variant NAME). */
const VARIANTS = {
  nolong: [["watcher.observe({ entryTypes: ['longtask'] });", ''], ['watchLongTasks();', '']],
  nosample: [['firstSample = setTimeout(sample, 6000);', ''], ['setInterval(sample, SAMPLE_EVERY);', '']],
  nofetch: [['window.fetch = function (input, init) {', 'window.__unusedFetch = function (input, init) {']],
  noflush: [['flushTimer = setInterval(() => { aggFlush(false); flush(false); }, FLUSH_MS);', '']],
  noclick: [["document.addEventListener('click', e => press(e, 0), true);", '']],
  norecorder: [['function start() {\n    on = true;', 'function start() {\n    return;']]
};

async function openPage(browser, base, { width = 1366, theme = 'light', offline = false, keepSetup = false, touch = false, variantName = option('--variant') } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width <= 720 ? 844 : 900 }, serviceWorkers: 'block', offline, hasTouch: touch, isMobile: touch });
  const variant = variantName;
  if (variant) {
    if (!VARIANTS[variant]) throw new Error('unknown --variant ' + variant);
    await context.route('**/tester.js', async route => {
      const response = await route.fetch();
      let body = await response.text();
      for (const [from, to] of VARIANTS[variant]) {
        if (!body.includes(from)) throw new Error('variant ' + variant + ': text not found: ' + from);
        body = body.replace(from, to);
      }
      await route.fulfill({ response, body });
    });
  }
  const page = await context.newPage();
  const seen = { tester: [], problems: [], bodies: [] };
  page.on('request', r => {
    if (r.url().startsWith(base) && r.url().includes('/api/tester/')) {
      seen.tester.push(r.method() + ' ' + r.url().replace(base, ''));
      if (r.method() === 'POST') seen.bodies.push(r.postData() || '');
    }
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
  if (!keepSetup) await page.keyboard.press('Escape');
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

const tick = text => console.log('     ' + text);

async function walkOff(browser, offServer, width) {
  // 1. A run a developer keeps out of the record: the pages are used and nothing is sent.
  const off = await openPage(browser, offServer.base, { width });
  for (const id of ['overview', 'printers', 'printer', 'files', 'settings']) await goTo(off.page, id, width);
  await sleep(6000);
  check(off.seen.tester.length === 0, 'DEJAVU_TESTER=0: the browser sent nothing to /api/tester (' + off.seen.tester.length + ' requests)');
  for (const [route, body] of [['/api/tester/events', { events: [{ k: 'click', ctl: '#x' }] }], ['/api/tester/answers', { answers: {} }]]) {
    const answer = await post(off.page, route, body);
    check(answer.status === 403, 'DEJAVU_TESTER=0: ' + route + ' answers 403 (got ' + answer.status + ')');
  }
  const statusOff = await getJson(off.page, '/api/tester/status');
  check(statusOff.status === 403, 'DEJAVU_TESTER=0: /api/tester/status answers 403 (got ' + statusOff.status + ')');
  check(!fs.existsSync(path.join(offServer.data, 'tester')), 'DEJAVU_TESTER=0: no tester folder was written');
  check((await off.page.locator('#tester-felt, #tester-dock').count()) === 0, 'DEJAVU_TESTER=0: no tester buttons are on the screen');
  await off.context.close();
}

async function walk(browser, server, standIn, width) {
  const { base } = server;
  const { context, page, seen } = await openPage(browser, base, { width, keepSetup: true });

  // 2. The tester build as shipped. The first run opens the setup by itself; it is clicked through to step 3 and skipped.
  await page.waitForSelector('#setup-dialog[open]', { timeout: 10000 });
  check(true, 'The first run opens the setup by itself');
  await sleep(1500);
  await page.click('#setup-next');
  await sleep(500);
  await page.click('#setup-next');
  await sleep(500);
  await page.click('#setup-skip');
  await sleep(800);
  check((await page.locator('#tester-felt').count()) === 1, 'Recording is on with no switch: "Something felt off" is on the screen');
  await sleep(4000);
  check((await page.locator('#tester-chip, #tester-hub, #tester-panel').count()) === 0, 'No tester pop-up, chip or panel appears on the first start (setup closed, 4 s later)');
  check((await page.locator('#tester-dock > *').count()) === 1, 'The only tester control on the screen is "Something felt off"');
  if (option('--shots')) await page.screenshot({ path: path.join(option('--shots'), 'first-start-' + width + '.png') });

  await post(page, '/api/fleet/registry', { name: 'Walk stand-in', moonraker_url: standIn.url });
  await sleep(2500);

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
      // A double press, a right press and a press with a key held.
      await page.locator('[data-view="top"]').first().dblclick().catch(() => {});
      await page.locator('[data-view="iso"]').first().click({ button: 'right' }).catch(() => {});
      await page.keyboard.press('Escape');
      await page.locator('[data-twin="zoom-in"]').first().click({ modifiers: ['Shift'] }).catch(() => {});
      await sleep(7500); // long enough for a smoothness sample of the twin
    }
    if (id === 'automations' && (await page.locator('#rf-trigger').count())) {
      await page.locator('#rf-trigger').focus().catch(() => {});          // a choice in a list, made with the keyboard like a person would
      await page.keyboard.press('ArrowDown');
      await sleep(200);
    }
  }
  await page.keyboard.press('Control+k');                              // a shortcut: the finder opens
  await sleep(400);
  await page.keyboard.press('Escape');

  // The quick tour, ended after a few stops.
  await goTo(page, 'settings', width);
  await page.evaluate(() => document.getElementById('guide-replay') && document.getElementById('guide-replay').click());
  await page.waitForSelector('.guide-card', { timeout: 8000 }).catch(() => {});
  for (let i = 0; i < 3; i++) {
    await page.locator('.guide-card [data-act="next"]').click({ timeout: 4000 }).catch(() => {});
    await sleep(600);
  }
  await page.locator('.guide-card [data-act="end"]').click({ timeout: 4000 }).catch(() => {});
  await sleep(800);

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
  check(!!gcode, 'The sample files include a G-code file that Confirm Print lets through');
  if (gcode) {
    const gate = await getJson(page, '/api/print/confirm?file=' + encodeURIComponent(gcode.name));
    check(gate.status === 200, 'Confirm Print answers for a sample file (' + gate.status + ')');
    const start = await post(page, '/api/printer/control/start', { filename: gcode.name, confirmed: true });
    tick('start answered ' + start.status + (start.body && start.body.error ? ': ' + String(start.body.error).slice(0, 120) : ''));
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
    // The wording the app uses for a command it timed but did not read back (the emergency stop).
    if (typeof toast === 'function') toast('Walk: Emergency stop sent (123 ms)', 'ok', 2000);
  });
  await sleep(1200);
  check(await page.locator('#tester-felt.is-alert').count() === 1, 'After an error the note button says "Something went wrong? Tell us"');

  // A tagged note, written right after the error: the note carries the error.
  await page.locator('#tester-felt').click();
  check((await page.locator('#tester-note-error').count()) === 1, 'The note shows the error that just happened');
  await page.locator('[data-tag="slow"]').click();
  await page.locator('#tester-note-text').fill('Pause felt slow (walk note about 192.168.7.7)');
  if (option('--shots')) await page.screenshot({ path: path.join(option('--shots'), 'note-' + width + '.png') });
  await page.locator('#tester-note-save').click();
  await sleep(800);
  check((await page.locator('#tester-note').count()) === 0, 'Saving a note closes the note panel');
  // A note that is only a tag, one tap.
  await page.keyboard.press('Alt+Shift+N');
  await page.locator('[data-tag="good"]').click();
  await page.locator('#tester-note-save').click();
  await sleep(600);
  await page.evaluate(() => window.Tester && window.Tester.flush());
  await sleep(1500);
  check(seen.tester.some(r => r.startsWith('POST /api/tester/events')), 'Tester mode on: the browser sent events');
  const sentText = seen.bodies.join('\n');
  check(sentText.length > 0 && !sentText.includes('192.168.7.7') && sentText.includes('<ip>'),
    'The browser hid the address before it sent anything (' + sentText.length + ' bytes sent)');
  check(/"how":"mouse"/.test(sentText) && /"btn":2/.test(sentText) && /"dbl":true/.test(sentText) && /"mods":"shift"/.test(sentText),
    'Presses carry how they were made: mouse, a right press, a double press and a held key');
  check(/"k":"change"/.test(sentText) && /"idx":\d+/.test(sentText), 'A choice in a list was recorded (its place in the list, never its words)');
  check(/"k":"key","combo":"ctrl-k"/.test(sentText), 'A keyboard shortcut was recorded');
  check(/"ev":"wizard_open"/.test(sentText) && /"ev":"wizard_end"/.test(sentText) && /"ev":"tour_start"/.test(sentText) && /"ev":"tour_end"/.test(sentText),
    'The setup and the tour were recorded step by step');

  // 3. Settings > Tester mode: always on, the plan, the numbers.
  await openTesterCard(page, width);
  await sleep(1500);
  check((await page.locator('#tester-setting').count()) === 0 && (await page.locator('#tester-always').isVisible()), 'The Tester mode card says "Always on" and has no switch');
  check((await page.locator('[data-length], #tester-plan').count()) === 0, 'The card has no days to pick and no round');
  check(/^0 of 22 questions answered/.test((await page.locator('#tester-progress').innerText()).trim()), 'The card says how many of the 22 questions are answered');
  const counts = await page.evaluate(() => ['days', 'actions', 'errors', 'slow'].map(k => +document.getElementById('tester-' + k).textContent));
  check(counts[1] > (width > 720 ? 20 : 5) && counts[2] >= 3 && counts[3] >= 2, 'The card shows what was recorded: days, actions, errors, slow spots = ' + counts.join(', '));
  if (option('--shots')) {
    await page.locator('#tester-card').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(option('--shots'), 'card-on-' + width + '.png') });
  }
  const studyFile = path.join(server.data, 'tester', 'study.json');
  const study = JSON.parse(fs.readFileSync(studyFile, 'utf8'));
  check(study.v === 2 && study.length_days === undefined && study.welcomed === undefined, 'The server keeps no length, no welcome and no end date');

  // The questions open from the card, at any time: there is no round to run out.
  await page.click('#tester-answer');
  await page.waitForSelector('#tester-q[open]', { timeout: 8000 });
  await page.waitForSelector('#tester-q-body .tq-intro', { timeout: 8000 });
  check(/22 questions in 9 short sections/.test(await page.locator('#tester-q-body .tq-intro').innerText()), 'The questions open with "22 questions in 9 short sections"');
  await sleep(300);
  await page.click('#tester-q-next');
  check((await page.locator('[data-q="q1"] [data-choice]').count()) === 0, 'A question that is not optional has no "Didn\u2019t try it" button');
  await page.fill('#tq-q1', 'Linux (the walk)');
  await page.fill('#tq-q2', '3.13');
  await sleep(1200);
  await page.click('#tester-q-next');                                   // section 2: First run
  await page.fill('#tq-q3', 'It said connection refused at 192.168.7.7');
  if (option('--shots')) await page.screenshot({ path: path.join(option('--shots'), 'questions-' + width + '.png') });
  await page.click('#tester-q-next');                                   // section 3: Speed
  await page.fill('#tq-q5', 'Pause');
  await page.click('[data-step="8"]');                                  // Phone and AI: the two optional questions
  await page.waitForSelector('[data-q="q16"]', { timeout: 5000 }).catch(() => {});
  const quick = await page.locator('[data-choice="didnt_try"]').count();
  check(quick === 2, 'Only the phone and AI questions have a one-press "Didn\u2019t try it" (found ' + quick + ')');
  await page.click('[data-q="q16"] [data-choice="didnt_try"]');
  await page.click('[data-step="9"]');                                  // Overall
  await page.fill('#tq-q19', 'The page threw an error on purpose.');
  await page.fill('#tq-q20', 'The walk broke things on purpose (192.168.7.7).');
  await sleep(1500);
  check(((await page.locator('#tester-q-saved-note').innerText()) || '').length > 0, 'Answers are saved as they are typed');
  await page.click('#tester-q-next');
  await page.waitForSelector('.tq-done', { timeout: 8000 });
  const doneText = await page.locator('.tq-done').innerText();
  check(/You answered 7 of 22/.test(doneText), 'The last step counts the answers: ' + (/You answered [^.]*/.exec(doneText) || [''])[0]);
  if (option('--shots')) await page.screenshot({ path: path.join(option('--shots'), 'questions-done-' + width + '.png') });
  const zipPath = option('--zip') || path.join(os.tmpdir(), 'tester-walk.zip');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('[data-q-act="save"]')]);
  await download.saveAs(zipPath);
  check(/^deja-vu1-tester-report-\d{4}-\d{2}-\d{2}\.zip$/.test(download.suggestedFilename()), 'The last step downloads ' + download.suggestedFilename());
  await sleep(1500);
  check(/Saved deja-vu1-tester-report-/.test(await page.locator('#tester-q-saved').innerText()), 'It says where the file went and what to do with it');
  await page.click('#tester-q-close');
  await sleep(800);
  await openTesterCard(page, width);
  await sleep(1500);
  check(/^7 of 22 questions answered\. Report last saved/.test((await page.locator('#tester-progress').innerText()).trim()), 'The card now says 7 of 22 answered and when the report was last saved');

  // View report and Save tester report in Settings still work.
  await openTesterCard(page, width);
  await sleep(1500);
  await page.locator('#tester-view').click();
  await sleep(2500);
  const frame = page.frames().find(f => f.url().includes('/api/tester/report.html'));
  check(!!frame, 'View report opens the report in the viewer');
  if (frame) {
    const headings = await frame.evaluate(() => [...document.querySelectorAll('h2')].map(h => h.textContent));
    check(headings.includes('The short version') && headings.includes('Fix first') && headings.includes('Their answers') && headings.includes('Errors'),
      'The viewer shows the readable report (' + headings.length + ' sections)');
  }
  if (option('--shots')) await page.screenshot({ path: path.join(option('--shots'), 'viewer-' + width + '.png') });
  await page.locator('#tester-close').click();
  const [again] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.locator('#tester-save').click()]);
  check(/^deja-vu1-tester-report-\d{4}-\d{2}-\d{2}\.zip$/.test(again.suggestedFilename()), 'Save tester report in Settings downloads ' + again.suggestedFilename());
  await sleep(500);
  for (const p of seen.problems) check(false, 'the page reported: ' + p);
  await context.close();
  return zipPath;
}

/* 4. A phone-sized touch browser: a tap is recorded as a touch. */
async function walkTouch(browser, server) {
  const { context, page } = await openPage(browser, server.base, { width: 390, touch: true });
  await sleep(1500);
  await page.locator('#thumb-dock [data-tab="printers"], #thumb-dock a, #thumb-dock button').first().tap().catch(() => {});
  await sleep(600);
  await page.evaluate(() => window.Tester && window.Tester.flush());
  await sleep(1500);
  const dir = path.join(server.data, 'tester');
  const text = fs.readdirSync(dir).filter(n => /^events-.*\.jsonl$/.test(n)).map(n => fs.readFileSync(path.join(dir, n), 'utf8')).join('\n');
  check(/"how":"touch"/.test(text), 'A tap on a phone-sized touch screen is recorded as a touch');
  check(/"device":"phone"/.test(text), 'A narrow window is recorded as a phone');
  await context.close();
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
 * stretch includes one smoothness sample, the recorder's most active moment), then press five twin controls and time
 * every press from the click to the next paint. */
const metricsOf = async cdp => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));

async function stretch(page, mode, secs, cdp) {
  // The page was opened on a server with recording on, or one started with DEJAVU_TESTER=0 (off). Check it is as asked.
  await sleep(1800);
  const state = await page.evaluate(() => !!(window.Tester && window.Tester.isOn()));
  if (state !== (mode === 'on') && !option('--variant')) throw new Error('Tester mode was ' + (state ? 'on' : 'off') + ' when ' + mode + ' was asked for');
  const m0 = await metricsOf(cdp);
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
  const m1 = await metricsOf(cdp);
  // Main-thread seconds spent per second of the stretch: all tasks, script, layout, style recalculation, in the page's renderer.
  const busy = Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].map(k => [k, (m1[k] - m0[k]) / secs]));
  await page.evaluate(() => {
    window.__paints = [];
  });
  const clicks = [];
  if (flag('--frames-only')) return { frames, clicks: [0], busy };
  for (const sel of ['[data-view="front"]', '[data-view="top"]', '[data-view="iso"]', '[data-twin="zoom-in"]', '[data-twin="zoom-out"]']) {
    for (let i = 0; i < +(option('--reps') || 1); i++) {
      const before = await page.evaluate(() => window.__paints.length);
      await page.locator(sel).first().click();
      await sleep(300);
      const paints = await page.evaluate(() => window.__paints.slice());
      if (paints.length > before) clicks.push(paints[paints.length - 1]);
    }
  }
  return { frames, clicks, busy };
}

/* One fresh page on the server for `mode`, settled on the Printer page with the 3D twin, then one timed stretch. */
async function oneStretch(browser, servers, mode, secs) {
  // --same-server: both kinds of page use one server; the "off" page runs a copy of tester.js whose start() does nothing.
  const variantName = flag('--same-server') && mode === 'off' ? 'norecorder' : option('--variant');
  const { context, page } = await openPage(browser, servers[mode].base, { width: 1366, variantName });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.evaluate(() => {
    const t = document.getElementById('demo-toggle');
    if (t && !t.checked) t.click();
    location.hash = '#/printer';
  });
  // A steady workload: the twin turning slowly draws every frame the same way, so a small cost shows above the noise.
  if (flag('--spin')) await page.locator('#twin-spin').click();
  if (flag('--hide-felt')) await page.addStyleTag({ content: '#tester-dock, #tester-note, #tester-panel { display: none !important; }' });   // to see whether the glass pills cost frames
  await sleep(6000);
  await page.evaluate(() => {
    window.__paints = [];
    // Capture phase on window: it runs before the recorder's own listener, so the press is timed from the start.
    window.addEventListener('click', () => {
      const t0 = performance.now();
      requestAnimationFrame(() => setTimeout(() => window.__paints.push(performance.now() - t0), 0));
    }, true);
  });
  const result = await stretch(page, mode, secs, cdp);
  await context.close();
  return result;
}

const postServer = (base, route, body) =>
  new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(data);
  });

async function overhead(browser, servers) {
  const pages = +(option('--pages') || 3), pairs = +(option('--pairs') || 5), secs = +(option('--secs') || 9);
  const rows = [];
  const fh = { off: [], on: [] }, ch = { off: [], on: [] };
  for (let p = 0; p < pages; p++) {
    for (let k = 0; k < pairs; k++) {
      const order = (p + k) % 2 ? ['on', 'off'] : ['off', 'on'];
      const pair = {};
      for (const mode of order) {
        const r = await oneStretch(browser, servers, mode, secs);
        pair[mode] = { busy: r.busy, frame_mean: mean(r.frames), frame_median: median(r.frames), frame_p95: r.frames.slice().sort((a, b) => a - b)[Math.floor(r.frames.length * 0.95)],
          click_mean: mean(r.clicks), click_median: median(r.clicks), frames: r.frames.length, presses: r.clicks.length };
        fh[mode].push(...r.frames);
        ch[mode].push(...r.clicks);
      }
      rows.push({ page: p + 1, pair: k + 1, order: order.join('>'), off: pair.off, on: pair.on });
      console.log(JSON.stringify({ page: p + 1, pair: k + 1, order: order.join('>'),
        frame_mean_ms: [+pair.off.frame_mean.toFixed(1), +pair.on.frame_mean.toFixed(1)], click_mean_ms: [+pair.off.click_mean.toFixed(0), +pair.on.click_mean.toFixed(0)],
        main_thread_busy_s_per_s: [+pair.off.busy.TaskDuration.toFixed(4), +pair.on.busy.TaskDuration.toFixed(4)] }));
    }
  }
  const pct = (a, b) => ((b - a) / a) * 100;
  const se = a => sd(a) / Math.sqrt(a.length);
  const frameDiffs = rows.map(r => pct(r.off.frame_mean, r.on.frame_mean));
  const clickDiffs = rows.map(r => pct(r.off.click_mean, r.on.click_mean));
  const busyDiffs = {};
  for (const k of ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration']) {
    busyDiffs[k] = { off_mean: mean(rows.map(r => r.off.busy[k])), on_mean: mean(rows.map(r => r.on.busy[k])),
      paired_difference_ms_per_s: { mean: mean(rows.map(r => (r.on.busy[k] - r.off.busy[k]) * 1000)), standard_error: se(rows.map(r => (r.on.busy[k] - r.off.busy[k]) * 1000)) },
      paired_difference_percent: { mean: mean(rows.map(r => pct(r.off.busy[k], r.on.busy[k]))), standard_error: se(rows.map(r => pct(r.off.busy[k], r.on.busy[k]))) } };
  }
  const out = {
    main_thread_seconds_per_second: busyDiffs,
    method: 'a fresh page per stretch, on a server started with DEJAVU_TESTER=0 (off) and on a normal one (on), alternating ' + secs + ' s stretches on the Printer page (demo data, 3D twin), ' + pairs + ' pairs per block',
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

/* The CPU time the recorder itself uses: a V8 profile of the page over a busy stretch with Tester mode on, adding up the time
 * the main thread spent in tester.js. It does not depend on the twin's frame-time noise, so it can show a small cost. */
async function profile(browser, server) {
  const secs = +(option('--secs') || 60);
  const { context, page } = await openPage(browser, server.base, { width: 1366 });
  await page.evaluate(() => {
    const t = document.getElementById('demo-toggle');
    if (t && !t.checked) t.click();
    location.hash = '#/printer';
  });
  await sleep(5000);
  check(await page.evaluate(() => !!(window.Tester && window.Tester.isOn())), 'profile: Tester mode is recording');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  const began = Date.now();
  let presses = 0;
  while (Date.now() - began < secs * 1000) {
    for (const sel of ['[data-view="front"]', '[data-view="top"]', '[data-view="iso"]', '[data-twin="zoom-in"]', '[data-twin="zoom-out"]']) {
      await page.locator(sel).first().click();
      presses += 1;
      await sleep(700);
    }
  }
  const { profile: prof } = await cdp.send('Profiler.stop');
  const wallMs = Date.now() - began;
  const byId = new Map(prof.nodes.map(n => [n.id, n]));
  let total = 0, busy = 0, recorder = 0;
  const byFunction = {};
  prof.samples.forEach((id, i) => {
    const dt = (prof.timeDeltas[i] || 0) / 1000;
    const n = byId.get(id);
    const fn = n.callFrame.functionName || '(anonymous)';
    total += dt;
    if (!/^\((idle|program|root)\)$/.test(fn)) busy += dt;
    if (/\/tester\.js$/.test(n.callFrame.url || '')) {
      recorder += dt;
      byFunction[fn] = (byFunction[fn] || 0) + dt;
    }
  });
  const out = { seconds: wallMs / 1000, presses, profile_ms: +total.toFixed(1), main_thread_busy_ms: +busy.toFixed(1), tester_js_ms: +recorder.toFixed(2),
    tester_js_share_of_busy_percent: +((recorder / busy) * 100).toFixed(3), tester_js_share_of_wall_percent: +((recorder / wallMs) * 100).toFixed(3),
    tester_js_by_function_ms: Object.fromEntries(Object.entries(byFunction).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => [k, +v.toFixed(2)])) };
  console.log(JSON.stringify(out, null, 2));
  if (option('--json')) fs.writeFileSync(option('--json'), JSON.stringify(out, null, 2));
  await context.close();
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
  const offServer = flag('--profile') || flag('--same-server') ? null : await startServer({ DEJAVU_TESTER: '0' });
  let standIn = null;
  const browser = await playwright.chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  try {
    if (flag('--overhead')) {
      await overhead(browser, { on: server, off: offServer || server });
    } else if (flag('--profile')) {
      await profile(browser, server);
    } else {
      standIn = await startStandIn();
      let zipPath = null;
      const width = option('--width') ? +option('--width') : 1366;
      await walkOff(browser, offServer, width);
      zipPath = await walk(browser, server, standIn, width);
      await walkTouch(browser, server);
      if (shotDir) await shots(browser, zipPath, shotDir);
    }
  } finally {
    await browser.close();
    if (standIn) standIn.child.kill();
    server.child.kill();
    fs.rmSync(server.data, { recursive: true, force: true });
    if (offServer) {
      offServer.child.kill();
      fs.rmSync(offServer.data, { recursive: true, force: true });
    }
  }
  console.log((results.failed.length ? 'FAILED' : 'PASSED') + ': ' + results.passed + ' checks passed, ' + results.failed.length + ' failed');
  process.exit(results.failed.length ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
