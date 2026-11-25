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

  /* No printer yet: the Printer screen says so in words and Halt is there, off. */
  await go(page, 'printer');
  const idle = await page.evaluate(() => ({ halt: document.getElementById('strip-halt').disabled, tile: (document.getElementById('tile-job-body').textContent || '').trim() }));
  check(idle.halt && /no printer/i.test(idle.tile), 'With no printer Halt is off and the print tile says so: ' + JSON.stringify(idle));
  await go(page, 'overview');
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

  /* Maintenance is flat rows under a band that filters; Files with nothing in it is one drop zone and a dragged file outlines the surface. */
  await go(page, 'maintenance');
  const mt = await page.evaluate(() => ({ rows: document.querySelectorAll('#tasks .task').length, band: document.querySelectorAll('#mt-band [data-mt]').length,
    flat: getComputedStyle(document.querySelector('#tasks .task')).borderTopLeftRadius === '0px' && getComputedStyle(document.querySelector('#tasks .task')).boxShadow === 'none' }));
  check(mt.rows >= 3 && mt.band === 3 && mt.flat, 'Maintenance: rows with no box, under a band with three filters: ' + JSON.stringify(mt));
  await page.click('#mt-band [data-mt="overdue"]');
  await page.waitForTimeout(250);
  const mtf = await page.evaluate(() => ({ rows: document.querySelectorAll('#tasks .task').length, odd: document.querySelectorAll('#tasks .task:not(.overdue)').length,
    pressed: document.querySelector('#mt-band [data-mt="overdue"]').getAttribute('aria-pressed'), kept: document.activeElement && document.activeElement.dataset.mt }));
  check(mtf.rows > 0 && mtf.rows < mt.rows && mtf.odd === 0 && mtf.pressed === 'true' && mtf.kept === 'overdue', 'Maintenance: Overdue shows only overdue rows and keeps the focus: ' + JSON.stringify(mtf));
  await page.click('#mt-band [data-mt="overdue"]');
  await page.waitForTimeout(250);
  check((await page.evaluate(() => document.querySelectorAll('#tasks .task').length)) === mt.rows, 'Maintenance: pressing the same count again shows every row');
  await go(page, 'files');
  const fe = await page.evaluate(() => ({ zone: !!document.getElementById('file-empty'), layout: getComputedStyle(document.querySelector('.files-layout')).gridTemplateColumns.split(' ').length }));
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['G1 X1\n'], 'walk.gcode'));
    document.getElementById('tab-files').dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  const fd = await page.evaluate(() => ({ outlined: document.documentElement.classList.contains('is-dropping'), label: !document.getElementById('file-drop').hidden }));
  check(fe.zone && fe.layout === 1 && fd.outlined && fd.label, 'Files: an empty library is one drop zone in one column, and a dragged file outlines the surface: ' + JSON.stringify({ fe, fd }));
  await page.evaluate(() => document.getElementById('tab-files').dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: document.body })));

  /* Parts: Printer has seven, a part never opens another place, and All printers is a part of Printer. */
  await go(page, 'printer');
  const parts = await page.evaluate(() => [...document.querySelectorAll('#pb-parts [data-part]')].map(b => b.textContent.trim()));
  check(JSON.stringify(parts) === JSON.stringify(['Control', 'Readings', 'Camera & time-lapses', 'Prints', 'All printers', 'Farm']), 'Printer has its parts in the toolbar edge, without Practice printers: ' + parts.join(' | '));
  await page.evaluate(() => Rail.setPractice(true));
  await page.waitForTimeout(250);
  const withPractice = await page.evaluate(() => [...document.querySelectorAll('#pb-parts [data-part]')].map(b => b.textContent.trim()));
  check(withPractice.length === 7 && withPractice[6] === 'Practice printers', 'Settings turning Practice printers on adds the part: ' + withPractice.join(' | '));
  await page.evaluate(() => Rail.setPractice(false));
  await page.waitForTimeout(250);
  await page.evaluate(() => { location.hash = '#/sandbox'; });
  await page.waitForTimeout(500);
  check((await page.evaluate(() => location.hash)) === '#/printers', 'A link to Practice printers opens All printers while it is off');
  await go(page, 'printer');
  await page.click('#pb-parts [data-part="readings"]');
  await page.waitForTimeout(300);
  let st = await page.evaluate(() => ({ title: document.getElementById('pb-title').textContent, section: Sections.current('control'), sel: document.querySelector('#pb-parts [aria-selected="true"]').textContent }));
  check(st.title === 'Printer' && st.section === 'live' && st.sel === 'Readings', 'Readings is a part of Printer and Printer stays the place: ' + JSON.stringify(st));
  await page.click('#pb-parts [data-part="printers"]');
  await page.waitForTimeout(300);
  st = await page.evaluate(() => ({ title: document.getElementById('pb-title').textContent, tab: document.body.dataset.tab, hash: location.hash }));
  check(st.title === 'Printer' && st.tab === 'fleet' && st.hash === '#/printers', 'All printers is a part of Printer: ' + JSON.stringify(st));

  /* Old links still land on the new home. */
  for (const [old, title, extra] of [['slice', 'Slicer', 'prepare'], ['layers', 'Slicer', 'prepare'], ['preview', 'Slicer', 'preview'], ['queue', 'Files', 'jobs'], ['library', 'Files', 'library'], ['filament', 'Maintenance', 'filament'],
    ['care', 'Maintenance', 'upkeep'], ['prefs', 'Settings', 'look'], ['modules', 'Settings', null], ['desk', 'Printer', 'desk'], ['sandbox', 'Printer', 'printers'], ['fleet', 'Printer', 'printers'],
    ['control', 'Printer', 'control'], ['prepare', 'Slicer', 'prepare'], ['jobs', 'Files', 'jobs']]) {
    await go(page, old);
    const r = await page.evaluate(() => ({ t: document.getElementById('pb-title').textContent.trim(), tab: document.body.dataset.tab, s: Sections.current(document.body.dataset.tab) }));
    check(r.t === title && (extra == null || r.s === extra), `The old link #/${old} lands in ${title}${extra ? ' › ' + extra : ''}: ${JSON.stringify(r)}`);
  }

  /* The sidebar rests as icons in every place, opens over the page when pointed at (or at the window's left edge), closes by itself after the
     pointer leaves (sooner when it clearly went elsewhere), never under a pointer that comes back, and a width someone chose wins. */
  const railNow = () => page.evaluate(() => ({ open: document.documentElement.classList.contains('rail-open'), w: Math.round(document.querySelector('#rail .rail-card').getBoundingClientRect().width),
    main: Math.round(document.getElementById('main').getBoundingClientRect().left) }));
  for (const d of ['overview', 'printer', 'files']) {
    await go(page, d);
    await page.mouse.move(700, 400);
    await page.waitForTimeout(2200);
    const w = await railNow();
    check(!w.open && w.w <= 64, `${d}: the sidebar rests as icons only: ` + JSON.stringify(w));
  }
  await page.hover('#rail .rail-item[data-place="files"]');
  await page.waitForTimeout(700);
  let rw = await railNow();
  check(rw.open && rw.w >= 200 && rw.main < 100, 'Pointing at the sidebar shows its labels over the page without moving it: ' + JSON.stringify(rw));
  await page.mouse.move(700, 400, { steps: 5 });
  await page.waitForTimeout(250);
  rw = await railNow();
  check(rw.open, 'It does not close the instant the pointer leaves: ' + JSON.stringify(rw));
  await page.waitForTimeout(700);
  rw = await railNow();
  check(!rw.open && rw.w <= 64, 'It has closed about a second after the pointer went far away: ' + JSON.stringify(rw));
  await page.hover('#rail .rail-item[data-place="files"]');
  await page.waitForTimeout(400);
  await page.mouse.move(270, 330, { steps: 4 });                      // just beside it: a grace period of 1.5 s
  await page.waitForTimeout(900);
  rw = await railNow();
  check(rw.open, 'Just beside it, it is still open after 0.9 s: ' + JSON.stringify(rw));
  await page.hover('#rail .rail-item[data-place="files"]');          // coming back cancels the close
  await page.waitForTimeout(1900);
  rw = await railNow();
  check(rw.open, 'Coming back within the grace period keeps it open: ' + JSON.stringify(rw));
  await page.mouse.click(700, 30);                                    // a press elsewhere (the empty part of the toolbar) closes it at once
  await page.waitForTimeout(350);
  rw = await railNow();
  check(!rw.open, 'A press outside closes it at once: ' + JSON.stringify(rw));
  await page.mouse.move(3, 300, { steps: 3 });                        // a flick to the window edge opens it
  await page.waitForTimeout(400);
  rw = await railNow();
  check(rw.open, 'A flick to the window edge opens it: ' + JSON.stringify(rw));
  await page.mouse.move(700, 450, { steps: 4 });
  await page.waitForTimeout(3600);
  await page.evaluate(() => Rail.setMode('wide'));
  await go(page, 'files');
  const wide = await page.evaluate(() => document.documentElement.classList.contains('rail-collapsed'));
  check(!wide, 'A sidebar kept open stays open in every place');
  await page.evaluate(() => Rail.setMode('auto'));

  /* No bar along the bottom: a small floating dock holds the orb; the printers are chosen in the sidebar. */
  await go(page, 'overview');
  const dock = await page.evaluate(() => { const r = document.getElementById('strip').getBoundingClientRect(); const cs = getComputedStyle(document.getElementById('strip'));
    return { fixed: cs.position === 'fixed', w: Math.round(r.width), insts: !!document.getElementById('strip-insts'), find: !!document.getElementById('strip-cmd'), orb: !!document.getElementById('orb'),
      surfaceBottom: Math.round(document.getElementById('main').getBoundingClientRect().bottom) }; });
  check(dock.fixed && dock.w < 700 && !dock.insts && !dock.find && dock.orb && dock.surfaceBottom >= 780, 'The strip is a small floating dock with the orb, and the surface runs to the bottom: ' + JSON.stringify(dock));
  await page.click('#rail-switch');
  await page.waitForTimeout(400);
  const menu = await page.evaluate(() => [...document.querySelectorAll('#rail-menu [data-printer]')].map(b => b.textContent.replace(/\s+/g, ' ').trim()));
  check(menu.length === 3 && menu.every(t => /^Demo printer \d/.test(t)), 'The sidebar lists the three demo printers to pick from: ' + JSON.stringify(menu));
  await page.click('#rail-menu [data-printer]:nth-child(2)');
  await page.waitForTimeout(1500);
  const sel = await page.evaluate(() => ({ rail: document.getElementById('rail-printer').textContent, tab: document.body.dataset.tab }));
  check(/Demo printer 2/.test(sel.rail) && sel.tab === 'control', 'Picking a printer in the sidebar selects it and opens its Printer screen: ' + JSON.stringify(sel));
  await page.evaluate(() => Workshop.selectPrinter(document.querySelector('#rail-menu [data-printer]') ? 'u1-workshop' : 'u1-workshop', null, true));
  await page.waitForTimeout(900);

  /* Halt sits on the Printer screen and on no other: one press, says what happened in words, offers Restart firmware. */
  const haltSeen = {};
  for (const d of ['overview', 'slice', 'files', 'models', 'ai', 'maintenance', 'settings', 'printer']) {
    await go(page, d, 400);
    haltSeen[d] = await page.evaluate(() => { const b = document.getElementById('strip-halt'); return !!b && b.offsetParent !== null; });
  }
  check(haltSeen.printer && Object.entries(haltSeen).every(([d, v]) => d === 'printer' || !v), 'Halt is on screen on the Printer screen and nowhere else: ' + JSON.stringify(haltSeen));
  await go(page, 'printer');
  const before = await page.evaluate(() => ({ disabled: document.getElementById('strip-halt').disabled, label: document.getElementById('strip-halt').getAttribute('aria-label') }));
  check(!before.disabled && /^Halt Demo printer 1/.test(before.label), 'Halt names the selected printer: ' + JSON.stringify(before));
  await page.click('#strip-halt');
  await page.waitForTimeout(1500);
  let halted = await page.evaluate(() => ({ note: (document.getElementById('strip-halted').textContent || '').replace(/\s+/g, ' ').trim(), shown: !document.getElementById('strip-halted').hidden, restart: !!document.getElementById('strip-restart') }));
  check(halted.shown && /Demo printer 1 halted: motors and heaters off/.test(halted.note) && halted.restart, 'One press of Halt stops the printer and says so in words, with Restart firmware: ' + JSON.stringify(halted));
  await page.click('#strip-restart');
  await page.waitForTimeout(1800);
  halted = await page.evaluate(() => !document.getElementById('strip-halted').hidden);
  check(!halted, 'Restart firmware puts Halt back');
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

  /* The Printer screen is one room: the 3D scene is a layer behind the sidebar and the toolbar, the cards float over it, nothing is a rail and
     nothing can be dragged. */
  await go(page, 'printer');
  await page.waitForTimeout(600);
  const room = await page.evaluate(() => {
    const r = e => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
    const q = s => document.querySelector(s);
    return { stage: r(q('#p-stage')), pos: getComputedStyle(q('#p-stage')).position, job: r(q('#tile-job')), cam: r(q('#tile-cam')), dock: r(q('#cp-dock')), splits: document.querySelectorAll('#cockpit .split').length,
      tags: [...document.querySelectorAll('#twin-model .t3-tag')].map(t => t.textContent.trim()), win: { w: innerWidth, h: innerHeight } };
  });
  check(room.pos === 'fixed' && room.stage.w === room.win.w && room.stage.h === room.win.h, 'The 3D scene fills the whole window behind everything: ' + JSON.stringify(room.stage));
  check(room.splits === 0 && room.job.l < room.win.w / 2 && room.cam.l > room.win.w / 2 && room.dock.l < room.win.w / 4 && room.dock.t > room.win.h / 3, 'No rails or dividers: the print card floats top left, the camera top right and the tool palette down the left: ' + JSON.stringify({ job: room.job, cam: room.cam, dock: room.dock }));
  check(room.tags.some(t => /^T\d.*\d/.test(t)) && room.tags.some(t => /^Bed.*\d/.test(t)), 'The heads and the bed carry their temperatures on the machine: ' + JSON.stringify(room.tags));
  const frame = await page.evaluate(() => { const i = document.querySelector('#cp-cam-slot .pcam-img:not([hidden])'); const c = document.querySelector('#cp-cam-slot > .card'); return i && c ? { img: i.getBoundingClientRect().width / i.getBoundingClientRect().height, card: c.getBoundingClientRect().width / c.getBoundingClientRect().height, fit: getComputedStyle(i).objectFit } : null; });
  check(!frame || frame.fit === 'contain', 'The camera window shows the whole picture: ' + JSON.stringify(frame));

  /* The one twin lives on the Printer screen only: Overview has none, and a sheet that borrows it hands it back. */
  await go(page, 'overview');
  await page.waitForTimeout(500);
  let twin = await page.evaluate(() => { const c = document.getElementById('twin-card'); return { in: c.parentElement.id, shown: c.offsetParent !== null }; });
  check(twin.in === 'p-stage' && !twin.shown, 'Overview shows no 3D printer: ' + JSON.stringify(twin));
  await go(page, 'printer');
  await page.waitForTimeout(800);
  twin = await page.evaluate(() => { const c = document.getElementById('twin-card'); const r = c.getBoundingClientRect(); return { in: c.parentElement.id, w: Math.round(r.width), h: Math.round(r.height) }; });
  check(twin.in === 'p-stage' && twin.w > 300 && twin.h > 300, 'The twin fills the middle of the Printer screen: ' + JSON.stringify(twin));
  await page.evaluate(() => Cockpit.open('move'));
  await page.waitForTimeout(700);
  const smart = await page.evaluate(() => ({ twinIn: document.getElementById('twin-card').closest('.cp-side') ? 'side' : 'elsewhere', camIn: document.getElementById('pp-camera-card').closest('.cp-side') ? 'side' : 'elsewhere',
    pad: !!document.querySelector('#cp-sheet .cp-main #pp-move'), dlg: document.getElementById('cp-sheet').getAttribute('role') }));
  check(smart.twinIn === 'side' && smart.camIn === 'side' && smart.pad && smart.dlg === 'dialog', 'Move opens a sheet with the pad and brings the 3D printer and the camera beside it: ' + JSON.stringify(smart));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => ({ twin: document.getElementById('twin-card').parentElement.id, cam: document.getElementById('pp-camera-card').parentElement.id, open: Cockpit.isOpen() }));
  check(back.twin === 'p-stage' && back.cam === 'cp-cam-slot' && !back.open, 'Escape closes the sheet and hands the twin and the camera back: ' + JSON.stringify(back));
  const noScroll = await page.evaluate(() => [...document.querySelectorAll('#cockpit .cp-left, #cockpit .cp-right, #cockpit .cp-top')].map(r => { const o = getComputedStyle(r).overflow; return o !== 'auto' && o !== 'scroll'; }));
  check(noScroll.length === 3 && noScroll.every(Boolean), 'The cards over the room do not scroll');

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

  /* A phone: the orb floats above the dock, Halt is on the Printer screen within thumb reach, and nothing scrolls sideways. */
  page = await openPage(browser, base, { width: 390, height: 844 }, '#/overview');
  await demoOn(page);
  for (const d of ['overview', 'printer', 'slice', 'files', 'models', 'ai', 'maintenance', 'settings']) {
    await go(page, d);
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const strip = document.getElementById('strip').getBoundingClientRect(), halt = document.getElementById('strip-halt'), dockBar = document.querySelector('.bottom-nav').getBoundingClientRect();
      const hr = halt.getBoundingClientRect(), here = document.body.dataset.tab === 'control';
      return { over: document.documentElement.scrollWidth - window.innerWidth, haltRight: !here ? halt.offsetParent === null : (hr.right <= window.innerWidth && hr.width >= 40), dock: dockBar.bottom <= window.innerHeight + 1,
        stripAbove: strip.bottom <= dockBar.top + 1 };
    });
    check(m.over <= 0 && m.haltRight && m.dock && m.stripAbove, `${d} on a phone: no sideways scroll, Halt only on the Printer screen, the orb above the dock: ${JSON.stringify(m)}`);
    if (shots) await page.screenshot({ path: path.join(shots, `phone-${d}.png`) });
  }
  const dockNames = await page.evaluate(() => ({ dock: [...document.querySelectorAll('.bottom-nav button')].map(b => b.textContent.trim()), more: [...document.querySelectorAll('#more-sheet .ms-grid button')].map(b => b.querySelector('b').textContent.trim()) }));
  check(JSON.stringify(dockNames.dock) === JSON.stringify(['Overview', 'Printer', 'Slicer', 'Files', 'More']) && dockNames.more.length === 7, 'The phone dock names the places and More holds the rest: ' + JSON.stringify(dockNames));
  check(page.errors.length === 0, 'The page raised no error on a phone: ' + page.errors.slice(0, 2).join(' | '));
  await page.context().close();

  /* The other two looks and the dark theme wear the same frame. */
  for (const [look, theme] of [['workbench', 'light'], ['control', 'dark'], ['glass', 'dark']]) {
    page = await openPage(browser, base, { width: 1366, height: 800 }, '#/printer', theme);
    await page.evaluate(l => DVTheme.setLook(l), look);
    await demoOn(page);
    await page.waitForTimeout(500);
    const l = await page.evaluate(() => {
      const card = getComputedStyle(document.querySelector('#rail .rail-card')), halt = getComputedStyle(document.getElementById('strip-halt'));
      const flat = s => !/blur/.test(s.backdropFilter || s.webkitBackdropFilter || '');
      return { theme: document.documentElement.dataset.theme, look: document.documentElement.dataset.ui, flat: flat(card), halt: halt.backgroundColor };
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
