#!/usr/bin/env node
/*
 * The frame walk: the SHELL frame (sidebar of eight places, toolbar edge, instrument strip, docked panes) in a real Chromium.
 * (The file keeps its old name, pagebar-walk.js, because tests and notes point at it.)
 *
 *   node tools/pagebar-walk.js            runs the walk and prints one line per check
 *   node tools/pagebar-walk.js --probe    only says whether Playwright and a Chromium are available
 *   node tools/pagebar-walk.js --shots DIR   also saves a screenshot of each place into DIR
 *
 * It starts its own server on an empty data folder, with demo data on. It checks that nothing sits across the top of the page,
 * that the eight places and their parts open the right screens (old links included), that the sidebar narrows by itself in a
 * working place, that the strip shows every printer and Halt stops the selected one in words (with the two-press setting, the
 * H H shortcut and Restart firmware), that the command bar lists places and actions with their shortcuts, that the dividers move
 * by keyboard and are remembered, that the one twin is docked in the stage of the open place, that Settings searches, that
 * explainer lines are gone for "I know my way around", and that a phone has no sideways scrolling and keeps Halt in reach.
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

async function openPage(browser, base, size, hash, theme) {
  const context = await browser.newContext({ viewport: size });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  if (theme) await page.addInitScript(t => { try { localStorage.setItem('dejavu1.pref.theme', t); } catch (e) { /* storage blocked */ } }, theme);
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
  await page.evaluate(x => { location.hash = '#/' + x; }, id);
  await page.waitForTimeout(600);
};
const demoOn = async page => {
  await page.evaluate(() => {
    const t = document.getElementById('demo-toggle');
    if (t && !t.checked) { t.checked = true; t.dispatchEvent(new Event('change')); }
  });
  await page.waitForTimeout(2500);
};
const text = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; }, sel);

async function walk(browser, server, shots) {
  const base = server.base;
  let page = await openPage(browser, base, { width: 1366, height: 800 }, '#/overview');

  /* No printer yet: Halt is there and off, and the strip says so in words. */
  const idle = await page.evaluate(() => ({ halt: document.getElementById('strip-halt').disabled, empty: (document.getElementById('strip-insts').textContent || '').trim() }));
  check(idle.halt && /no printer/i.test(idle.empty), 'With no printer Halt is off and the strip says so: ' + JSON.stringify(idle));
  await demoOn(page);

  /* Nothing across the top: no bar, and the toolbar edge is the first row of the working surface. */
  const top = await page.evaluate(() => {
    const el = document.elementFromPoint(683, 3);
    const bar = document.getElementById('topbar');
    return { at: el ? (el.id || el.className || el.tagName) : null, inSurface: !!bar.closest('main.wrap'), barTop: Math.round(bar.getBoundingClientRect().top),
      surfaceTop: Math.round(document.getElementById('main').getBoundingClientRect().top) };
  });
  check(top.inSurface && top.barTop === top.surfaceTop && !/topbar|brand|pb-/.test(String(top.at)), 'No bar across the top; the toolbar edge is the surface\'s first row: ' + JSON.stringify(top));

  /* The eight places, in order, and the More group. */
  const names = await page.evaluate(() => ({
    main: [...document.querySelectorAll('#rail .rail-list:not(#rail-tools) .rail-item, #rail .rail-foot .rail-item')].map(a => a.querySelector('.rail-label').textContent.trim()),
    more: [...document.querySelectorAll('#rail-tools .rail-item')].map(a => a.querySelector('.rail-label').textContent.trim())
  }));
  check(JSON.stringify(names.main) === JSON.stringify(['Overview', 'Printer', 'Slicer', 'Files', 'Models', 'AI', 'Maintenance', 'Settings']),
    'The sidebar lists the eight places: ' + names.main.join(', '));
  check(JSON.stringify(names.more) === JSON.stringify(['Automations', 'Photo studio', 'Games']), 'The More group holds Automations, Photo studio and Games: ' + names.more.join(', '));

  /* Every place opens and names itself in the toolbar edge. */
  for (const [dest, title] of [['overview', 'Overview'], ['printer', 'Printer'], ['slice', 'Slicer'], ['files', 'Files'], ['models', 'Models'], ['ai', 'AI'],
    ['maintenance', 'Maintenance'], ['settings', 'Settings'], ['automations', 'Automations'], ['studio', 'Photo studio'], ['games', 'Games']]) {
    await go(page, dest);
    const got = await page.evaluate(() => ({ t: document.getElementById('pb-title').textContent.trim(), cur: (document.querySelector('#rail [aria-current="page"] .rail-label') || {}).textContent }));
    check(got.t === title && got.cur === title, `#/${dest} opens ${title} and the sidebar marks it: ${JSON.stringify(got)}`);
    if (shots) await page.screenshot({ path: path.join(shots, `${dest}.png`) });
  }

  /* Parts: Printer has seven, a part never opens another place, and All printers is a part of Printer. */
  await go(page, 'printer');
  const parts = await page.evaluate(() => [...document.querySelectorAll('#pb-parts [data-part]')].map(b => b.textContent.trim()));
  check(JSON.stringify(parts) === JSON.stringify(['Control', 'Readings', 'Camera & time-lapses', 'History', 'All printers', 'Farm', 'Practice printers']), 'Printer has its parts in the toolbar edge: ' + parts.join(' | '));
  await page.click('#pb-parts [data-part="readings"]');
  await page.waitForTimeout(300);
  let st = await page.evaluate(() => ({ title: document.getElementById('pb-title').textContent, section: Sections.current('control'), sel: document.querySelector('#pb-parts [aria-selected="true"]').textContent }));
  check(st.title === 'Printer' && st.section === 'live' && st.sel === 'Readings', 'Readings is a part of Printer and Printer stays the place: ' + JSON.stringify(st));
  await page.click('#pb-parts [data-part="printers"]');
  await page.waitForTimeout(300);
  st = await page.evaluate(() => ({ title: document.getElementById('pb-title').textContent, tab: document.body.dataset.tab, hash: location.hash }));
  check(st.title === 'Printer' && st.tab === 'fleet' && st.hash === '#/printers', 'All printers is a part of Printer: ' + JSON.stringify(st));

  /* Old links still land on the new home. */
  for (const [old, title, extra] of [['slice', 'Slicer', 'slicing'], ['layers', 'Slicer', 'layers'], ['queue', 'Files', 'jobs'], ['library', 'Files', 'library'], ['filament', 'Maintenance', 'filament'],
    ['care', 'Maintenance', 'upkeep'], ['prefs', 'Settings', 'look'], ['modules', 'Settings', null], ['desk', 'Printer', 'desk'], ['sandbox', 'Printer', 'sandbox'], ['fleet', 'Printer', 'printers'],
    ['control', 'Printer', 'control'], ['prepare', 'Slicer', 'slicing'], ['jobs', 'Files', 'jobs']]) {
    await go(page, old);
    const r = await page.evaluate(() => ({ t: document.getElementById('pb-title').textContent.trim(), tab: document.body.dataset.tab, s: Sections.current(document.body.dataset.tab) }));
    check(r.t === title && (extra == null || r.s === extra), `The old link #/${old} lands in ${title}${extra ? ' › ' + extra : ''}: ${JSON.stringify(r)}`);
  }

  /* The sidebar narrows by itself in a working place, a chosen width wins, and [ toggles. */
  await go(page, 'overview');
  let w = await page.evaluate(() => ({ narrow: document.documentElement.classList.contains('rail-collapsed'), w: Math.round(document.querySelector('#rail .rail-card').getBoundingClientRect().width) }));
  check(!w.narrow && w.w >= 200, 'Overview keeps the full sidebar: ' + JSON.stringify(w));
  await go(page, 'printer');
  await page.waitForTimeout(400);
  w = await page.evaluate(() => ({ narrow: document.documentElement.classList.contains('rail-collapsed'), w: Math.round(document.querySelector('#rail .rail-card').getBoundingClientRect().width) }));
  check(w.narrow && w.w <= 64, 'Printer narrows the sidebar by itself: ' + JSON.stringify(w));
  await page.hover('#rail .rail-item[data-place="files"]');
  await page.waitForTimeout(400);
  w = await page.evaluate(() => ({ w: Math.round(document.querySelector('#rail .rail-card').getBoundingClientRect().width), main: Math.round(document.getElementById('main').getBoundingClientRect().left) }));
  check(w.w >= 200 && w.main < 100, 'A narrow sidebar shows its labels over the page without moving it: ' + JSON.stringify(w));
  await page.mouse.move(700, 400);
  await page.evaluate(() => Rail.setMode('wide'));
  await go(page, 'files');
  w = await page.evaluate(() => document.documentElement.classList.contains('rail-collapsed'));
  check(!w, 'A width the person chose beats the place\'s own');
  await page.evaluate(() => Rail.setMode('auto'));

  /* The strip: one instrument per printer; selecting one selects it everywhere. */
  await go(page, 'overview');
  const strip = await page.evaluate(() => [...document.querySelectorAll('#strip-insts .inst')].map(b => ({ label: b.textContent.replace(/\s+/g, ' ').trim(), on: b.getAttribute('aria-pressed'), named: !b.hasAttribute('aria-label') })));
  check(strip.length === 3 && strip.every(s => /^Demo printer \d/.test(s.label) && s.named) && strip.filter(s => s.on === 'true').length === 1,
    'The strip has an instrument for each of the three demo printers, each named by the text it shows: ' + JSON.stringify(strip.map(s => s.label)));
  await page.click('#strip-insts .inst:nth-child(2)');
  await page.waitForTimeout(1200);
  const sel = await page.evaluate(() => ({ pressed: [...document.querySelectorAll('#strip-insts .inst')].findIndex(b => b.getAttribute('aria-pressed') === 'true'), rail: document.getElementById('rail-printer').textContent }));
  check(sel.pressed === 1 && /Demo printer 2/.test(sel.rail), 'Clicking an instrument selects that printer in the strip and the sidebar: ' + JSON.stringify(sel));
  await page.click('#strip-insts .inst:nth-child(1)');
  await page.waitForTimeout(900);

  /* Halt: one press, says what happened in words, offers Restart firmware. */
  await go(page, 'overview');
  const before = await page.evaluate(() => ({ disabled: document.getElementById('strip-halt').disabled, label: document.getElementById('strip-halt').getAttribute('aria-label') }));
  check(!before.disabled && /^Halt Demo printer 1/.test(before.label), 'Halt names the selected printer: ' + JSON.stringify(before));
  await page.click('#strip-halt');
  await page.waitForTimeout(1500);
  let halted = await page.evaluate(() => ({ note: (document.getElementById('strip-halted').textContent || '').replace(/\s+/g, ' ').trim(), shown: !document.getElementById('strip-halted').hidden, restart: !!document.getElementById('strip-restart') }));
  check(halted.shown && /Demo printer 1 halted: motors and heaters off/.test(halted.note) && halted.restart, 'One press of Halt stops the printer and says so in words, with Restart firmware: ' + JSON.stringify(halted));
  await page.click('#strip-restart');
  await page.waitForTimeout(1800);
  halted = await page.evaluate(() => !document.getElementById('strip-halted').hidden);
  check(!halted, 'Restart firmware puts the strip back');
  /* The two-key shortcut, with the focus on the page. */
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('h');
  await page.keyboard.press('h');
  await page.waitForTimeout(1500);
  halted = await page.evaluate(() => !document.getElementById('strip-halted').hidden);
  check(halted, 'H then H halts the selected printer');
  await page.click('#strip-restart');
  await page.waitForTimeout(1800);
  /* Ask before Halt: the first press only arms the button. */
  await page.evaluate(() => localStorage.setItem('dejavu1.pref.haltAsk', 'on'));
  await page.click('#strip-halt');
  await page.waitForTimeout(300);
  const armed = await page.evaluate(() => ({ word: document.querySelector('#strip-halt .halt-word').textContent, shown: !document.getElementById('strip-halted').hidden }));
  check(armed.word === 'Press again' && !armed.shown, 'With Ask before Halt on, the first press asks: ' + JSON.stringify(armed));
  await page.click('#strip-halt');
  await page.waitForTimeout(1500);
  halted = await page.evaluate(() => !document.getElementById('strip-halted').hidden);
  check(halted, 'The second press halts');
  await page.click('#strip-restart');
  await page.waitForTimeout(1800);
  await page.evaluate(() => localStorage.setItem('dejavu1.pref.haltAsk', 'off'));

  /* The command bar: Ctrl K, with the shortcut shown beside each result. */
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(300);
  await page.keyboard.type('halt');
  await page.waitForTimeout(300);
  let bar = await page.evaluate(() => ({ open: !document.getElementById('feature-results').hidden, rows: [...document.querySelectorAll('#feature-results .fx-item')].map(li => li.textContent.replace(/\s+/g, ' ').trim()) }));
  check(bar.open && bar.rows.some(r => /Halt the selected printer.*H\s*H/.test(r)), 'Ctrl K opens the command bar and Halt shows its shortcut: ' + JSON.stringify(bar.rows.slice(0, 3)));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('slicer');
  await page.waitForTimeout(300);
  bar = await page.evaluate(() => [...document.querySelectorAll('#feature-results .fx-item')].map(li => li.textContent.replace(/\s+/g, ' ').trim()));
  check(bar.some(r => /^Slicer.*Alt\s*3/.test(r)) && bar.some(r => /Slicer › Layer heights/.test(r)), 'The command bar lists the place with its keys and its parts: ' + JSON.stringify(bar.slice(0, 4)));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  st = await text(page, '#pb-title');
  check(st === 'Slicer', 'Enter on a place opens it: ' + st);

  /* Dividers: W3C window splitter keys, remembered per browser. */
  await go(page, 'printer');
  await page.waitForTimeout(500);
  const split = '#cockpit .split.v1';
  const props = async () => page.evaluate(s => { const e = document.querySelector(s); return { role: e.getAttribute('role'), o: e.getAttribute('aria-orientation'), now: +e.getAttribute('aria-valuenow'), label: e.getAttribute('aria-label') }; }, split);
  let p = await props();
  check(p.role === 'separator' && p.o === 'vertical' && p.now === 300 && /heads/i.test(p.label), 'The divider is a labelled separator: ' + JSON.stringify(p));
  await page.focus(split);
  await page.keyboard.press('ArrowRight');
  let q = await props();
  await page.keyboard.press('Shift+ArrowRight');
  const q2 = await props();
  check(q.now === 312 && q2.now === 360, 'Arrow keys move the divider 12 px, Shift+arrow 48 px: ' + q.now + ', ' + q2.now);
  await page.keyboard.press('Home');
  q = await props();
  check(q.now === 220, 'Home goes to the smallest size: ' + q.now);
  await page.keyboard.press('Enter');
  q = await props();
  const hidden = await page.evaluate(() => Math.round(document.querySelector('#cockpit .p-left').getBoundingClientRect().width));
  check(q.now === 0 && hidden === 0, 'Enter collapses the pane: ' + JSON.stringify({ now: q.now, width: hidden }));
  await page.keyboard.press('Enter');
  q = await props();
  check(q.now === 220, 'Enter restores it: ' + q.now);
  await page.reload();
  await page.waitForTimeout(1500);
  await go(page, 'printer');
  q = await props();
  check(q.now === 220, 'The size is kept in this browser: ' + q.now);
  const box = await page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, split);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y, { steps: 5 });
  await page.mouse.up();
  q = await props();
  check(q.now >= 270 && q.now <= 290, 'Dragging with the mouse moves it: ' + q.now);
  await page.evaluate(() => Panes.reset());
  q = await props();
  check(q.now === 300, 'Reset layout puts the default size back: ' + q.now);

  /* The one twin is docked in the stage of the open place. */
  await go(page, 'overview');
  await page.waitForTimeout(800);
  let twin = await page.evaluate(() => { const c = document.getElementById('twin-card'); const r = c.getBoundingClientRect(); return { in: c.parentElement.id, w: Math.round(r.width), h: Math.round(r.height) }; });
  check(twin.in === 'ov-stage' && twin.w > 300 && twin.h > 200, 'Overview opens on the printer in 3D: ' + JSON.stringify(twin));
  await go(page, 'printer');
  await page.waitForTimeout(800);
  twin = await page.evaluate(() => { const c = document.getElementById('twin-card'); const r = c.getBoundingClientRect(); return { in: c.parentElement.id, w: Math.round(r.width), h: Math.round(r.height) }; });
  check(twin.in === 'p-stage' && twin.w > 300 && twin.h > 200, 'The same twin sits in the Printer stage: ' + JSON.stringify(twin));

  /* Settings: groups, search, demo data out of the way. */
  await go(page, 'settings');
  const set = await page.evaluate(() => ({ groups: [...document.querySelectorAll('.set-groups button')].map(b => b.textContent.trim()),
    demoSwitchShown: !!document.querySelector('label[for=demo-toggle]').offsetParent }));
  check(set.groups.length === 8 && set.groups[0] === 'Printers & connection' && set.groups.includes('Advanced') && !set.demoSwitchShown, 'Settings lists its groups and no demo switch sits in the toolbar: ' + JSON.stringify(set));
  await page.fill('#set-search', 'demo');
  await page.waitForTimeout(400);
  const found = await page.evaluate(() => [...document.querySelectorAll('#set-body > :not(.sec-off):not(.set-miss)')].map(c => c.id || c.className.slice(0, 20)));
  check(found.includes('demo-card') && !found.includes('phone-install-card'), 'Searching Settings finds the demo card from any group and leaves out cards that do not mention it: ' + JSON.stringify(found));
  await page.fill('#set-search', '');
  await page.waitForTimeout(300);
  await page.click('.set-groups button[data-group="advanced"]');
  await page.waitForTimeout(300);
  const adv = await page.evaluate(() => ({ demo: !!document.getElementById('demo-card') && !document.getElementById('demo-card').classList.contains('sec-off'), sw: !!document.getElementById('demo-setting') }));
  check(adv.demo && adv.sw, 'Demo data lives in Settings › Advanced: ' + JSON.stringify(adv));

  /* Words: no explainer lines for "I know my way around"; short hints for "New to 3D printing". */
  const blurbs = async () => page.evaluate(() => [...document.querySelectorAll('.card-sub:not([id]), .field-hint:not([id]):not(.keep):not([role="status"]):not([aria-live])')].filter(e => e.offsetParent !== null).length);
  let counts = {};
  for (const d of ['overview', 'printer', 'settings', 'files', 'maintenance']) { await go(page, d); counts[d] = await blurbs(); }
  check(Object.values(counts).every(n => n === 0), 'No explainer lines for "I know my way around": ' + JSON.stringify(counts));
  await page.evaluate(() => DVTheme.setExperience('new'));
  await go(page, 'files');
  const hints = await blurbs();
  check(hints > 0, '"New to 3D printing" keeps short hints: ' + hints);
  await page.evaluate(() => DVTheme.setExperience('know'));

  /* No sideways scroll, in light and dark, and the page raised no error so far. */
  check(page.errors.length === 0, 'The page raised no error on a computer: ' + page.errors.slice(0, 2).join(' | '));
  await page.context().close();

  /* A phone: the strip keeps Halt in thumb reach above the dock, and nothing scrolls sideways. */
  page = await openPage(browser, base, { width: 390, height: 844 }, '#/overview');
  await demoOn(page);
  for (const d of ['overview', 'printer', 'slice', 'files', 'models', 'ai', 'maintenance', 'settings']) {
    await go(page, d);
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const strip = document.getElementById('strip').getBoundingClientRect(), halt = document.getElementById('strip-halt').getBoundingClientRect(), dock = document.querySelector('.bottom-nav').getBoundingClientRect();
      return { over: document.documentElement.scrollWidth - window.innerWidth, haltIn: halt.right <= window.innerWidth && halt.bottom <= dock.top + 1 && halt.width >= 40, dock: dock.bottom <= window.innerHeight + 1, stripAbove: strip.bottom <= dock.top + 1 };
    });
    check(m.over <= 0 && m.haltIn && m.dock && m.stripAbove, `${d} on a phone: no sideways scroll, Halt above the dock: ${JSON.stringify(m)}`);
    if (shots) await page.screenshot({ path: path.join(shots, `phone-${d}.png`) });
  }
  const dock = await page.evaluate(() => ({ dock: [...document.querySelectorAll('.bottom-nav button')].map(b => b.textContent.trim()), more: [...document.querySelectorAll('#more-sheet .ms-grid button')].map(b => b.querySelector('b').textContent.trim()) }));
  check(JSON.stringify(dock.dock) === JSON.stringify(['Overview', 'Printer', 'Slicer', 'Files', 'More']) && dock.more.length === 7, 'The phone dock names the places and More holds the rest: ' + JSON.stringify(dock));
  check(page.errors.length === 0, 'The page raised no error on a phone: ' + page.errors.slice(0, 2).join(' | '));
  await page.context().close();

  /* The other two looks and the dark theme wear the same frame. */
  for (const [look, theme] of [['workbench', 'light'], ['control', 'dark'], ['glass', 'dark']]) {
    page = await openPage(browser, base, { width: 1366, height: 800 }, '#/printer', theme);
    await page.evaluate(l => DVTheme.setLook(l), look);
    await demoOn(page);
    await page.waitForTimeout(500);
    const l = await page.evaluate(() => {
      const card = getComputedStyle(document.querySelector('#rail .rail-card')), strip = getComputedStyle(document.getElementById('strip')), halt = getComputedStyle(document.getElementById('strip-halt'));
      const flat = s => !/blur/.test(s.backdropFilter || s.webkitBackdropFilter || '');
      return { theme: document.documentElement.dataset.theme, look: document.documentElement.dataset.ui, flat: flat(card) && flat(strip), halt: halt.backgroundColor };
    });
    const solid = look !== 'glass';
    check(l.theme === theme && l.look === look && (!solid || l.flat) && l.halt === 'rgb(200, 16, 46)', `${look} (${theme}) keeps the frame, flat where it should be, Halt stays #c8102e: ` + JSON.stringify(l));
    check(page.errors.length === 0, `${look} (${theme}) raised no error: ` + page.errors.slice(0, 2).join(' | '));
    if (shots) await page.screenshot({ path: path.join(shots, `look-${look}-${theme}.png`) });
    await page.context().close();
  }
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
