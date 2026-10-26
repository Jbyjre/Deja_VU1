// Films every shot of the promo from the real app, running the built-in simulated farm.
// Each shot gets a freshly started server (so the farm starts from the same state) and a
// fresh browser. Usage: node shots.js [shot ...]   (no names = all shots)
const r = require('./rec');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs'), os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const PORT = +(process.env.APP_PORT || 8791);
// Version 16: the home-network address the phone scenes show (see rec.js `alias`).
const HOME = 'http://192.168.1.23:8000';
let server = null;

async function restartServer() {
  if (server) { server.kill('SIGTERM'); await new Promise(res => server.once('exit', res)); }
  // Version 6: every shot gets its own empty data folder, so nothing it changes (spools, modules,
  // maintenance) carries into the next shot or into the app's real backend/data/.
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dejavu-film-'));
  server = spawn('python3', ['backend/app.py'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DEJAVU_DATA_DIR: data }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { const res = await fetch(`http://localhost:${PORT}/api/modules`); if (res.ok) return; } catch (e) {}
    await new Promise(res => setTimeout(res, 200));
  }
  throw new Error('server did not start');
}
// A tab button, clicked on film (the cursor travels to it and the click is logged for the sound).
const TAB = name => `.navtab[data-tab="${name}"]`;
async function tab(st, name) { await st.page.locator(`[data-tab="${name}"]`).first().click(); await r.settle(st, 1200); }
async function samples(st) {
  await tab(st, 'files');
  await st.page.locator('#file-samples').click();
  await r.settle(st, 4500);
}
// Brings a file card (or a button that opened below the fold) into view: the Files tab is a
// grid of picture cards, so most samples start below the visible area.
async function intoView(st, sel, filmed) {
  const b = await r.box(st, sel);
  if (b.y > 120 && b.y + b.height < st.height - 60) return;
  if (filmed) await r.scrollBy(st, b.y - st.height * .45, 380);
  else { await r.scrollBy(st, b.y - st.height * .5, 1); await r.settle(st, 900); }
}
const sleep = ms => new Promise(res => setTimeout(res, ms));

// Version 3: every action is quicker (cursor moves of about a third of a second), so the
// footage itself feels fast; the edit then only has to hold each moment for a beat.
const MV = 480, PA = 200;   // cursor travel and the pause before a click, in ms (v8: brisker than v5-v7's 620 / 260)
// Stills for "and plenty more" (screenshots of the real panels, not film), written to
// footage/<folder>/<name>.png in a 16:10 frame (the card's shape) around each panel.
// Version 17: `also` names another element (a help note that opened beside its card) the frame
// takes in as well, and `minW` lets a narrow card have a narrower frame (no half a neighbour).
// The frame now stays inside the page (version 16's converter still ran past its end into blank
// grey), and a panel taller than the frame starts just under the top bar, which is hidden.
async function stillShooter(st, folder) {
  const out = path.join(process.env.FOOTAGE_DIR || path.join(__dirname, '..', 'footage'), folder);
  fs.mkdirSync(out, { recursive: true });
  // Panels only: the floating pieces (progress pill, message orb and its bubbles, the hand-off bar)
  // and the film's cursor are hidden while the stills are taken.
  await st.page.addStyleTag({ content: '#live-pill, .orb-dock, #handoff, #__cur, .topbar { visibility: hidden !important; }' });
  return async (name, tabName, sel, before, also, minW = 760) => {
    await st.page.evaluate(t => showTab(t), tabName); await r.settle(st, 1200);
    // a note that opens beside its card is opened once the card is in view (scrolling closes it)
    if (before && !also) { await before(); await r.settle(st, 1500); }
    const el = st.page.locator(sel).first();
    if (!(await el.isVisible().catch(() => false))) { console.log('still', name, 'NOT FOUND', sel); return; }
    await el.scrollIntoViewIfNeeded(); await st.page.evaluate(() => scrollBy(0, -90)); await r.settle(st, 900);
    if ((await el.boundingBox()).height + 24 > (st.width - 16) * 10 / 16) {
      await el.evaluate(e => scrollTo(0, e.getBoundingClientRect().top + scrollY - 100)); await r.settle(st, 900);
    }
    if (before && also) { await before(); await r.settle(st, 1500); }
    // A 16:10 frame (the card's shape) around the panel; CDP's clip is in page coordinates.
    let b = await el.boundingBox();
    if (also) {
      const a = await st.page.locator(also).first().boundingBox();
      if (a) { const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
        b = { x: x0, y: y0, width: Math.max(a.x + a.width, b.x + b.width) - x0, height: Math.max(a.y + a.height, b.y + b.height) - y0 }; }
    }
    const [sy, docH] = await st.page.evaluate(() => [scrollY, document.documentElement.scrollHeight]);
    const w = Math.min(st.width - 16, Math.max(b.width + 24, minW)), h = Math.round(w * 10 / 16);
    const x = Math.min(Math.max(8, b.x + b.width / 2 - w / 2), st.width - 8 - w);
    const y = b.height + 24 > h ? b.y - 12 : b.y + b.height / 2 - h / 2;
    const clip = { x, y: Math.max(0, Math.min(y + sy, docH - h)), width: w, height: h };
    // only what is in the window is painted: bring the whole frame into it first
    if (clip.y < sy || clip.y + h > sy + st.height) {
      await st.page.evaluate(top => scrollTo(0, top), clip.y - (st.height - h) / 2); await r.settle(st, 900);
    }
    await r.still(st, path.join(out, name + '.png'), clip);
    console.log('still', name, Math.round(clip.width), 'x', Math.round(clip.height), 'panel', Math.round(b.width), 'x', Math.round(b.height));
  };
}

const SHOTS = {
  // Overview: Needs you, then a jam fired from the sandbox arrives live.
  async overview_jam() {
    const st = await r.open(); await r.demoOn(st);
    await st.page.mouse.move(1000, 640); st.mx = 1000; st.my = 640;
    r.start(st, 'overview_jam');
    await r.wait(st, 800);
    await r.move(st, 760, 470, MV);
    await r.wait(st, 500);
    await r.api(st, '/api/sandbox/fire?demo=1', { event: 'jam', printer: 'u1-workshop' });
    await sleep(700); r.mark(st, 'jam');
    await r.wait(st, 1600);
    await r.move(st, 1222, 410, MV);
    r.mark(st, 'row');
    await r.wait(st, 1800);
    r.stop(st); return st;
  },
  // Files: open the unsafe example, press Print..., Confirm Print refuses with reasons.
  async confirm_refuse() {
    const st = await r.open(); await r.demoOn(st); await samples(st);
    await st.page.mouse.move(900, 560); st.mx = 900; st.my = 560;
    await intoView(st, 'text=unsafe_example_purge_past_bed.gcode', false);
    r.start(st, 'confirm_refuse');
    await r.wait(st, 120);
    await r.click(st, 'text=unsafe_example_purge_past_bed.gcode', MV, PA);
    await r.wait(st, 650);
    await intoView(st, '#fd-print', true);
    await r.click(st, '#fd-print', MV, PA); r.mark(st, 'print');
    await r.wait(st, 1100); r.mark(st, 'dialog');
    await r.move(st, ...(await r.center(st, '#confirm-go')), MV);
    await r.wait(st, 1000);
    r.stop(st); return st;
  },
  // Files: the two-colour coaster in 3D, scrubbed layer by layer, then turned.
  async coaster_3d() {
    const st = await r.open(); await r.demoOn(st); await samples(st);
    await st.page.locator('text=hex_coaster_three_colour.gcode').first().click();
    await r.settle(st, 6000);
    const s = await r.box(st, '#vt-range');
    await st.page.mouse.move(s.x + s.width - 120, s.y + 90); st.mx = s.x + s.width - 120; st.my = s.y + 90;
    r.start(st, 'coaster_3d');
    await r.wait(st, 100);
    await r.move(st, s.x + s.width - 6, s.y + s.height / 2, 300);
    await st.page.mouse.down(); await r.frame(st);
    await r.move(st, s.x + 4, s.y + s.height / 2, 380);
    await r.wait(st, 80);
    await r.move(st, s.x + s.width - 2, s.y + s.height / 2, 1300);
    await st.page.mouse.up(); await r.frame(st);
    r.mark(st, 'turn');
    const c = await r.box(st, '#fd-canvas');
    await r.move(st, c.x + c.width * .62, c.y + c.height * .55, 300);
    await st.page.mouse.down(); await r.frame(st);
    await r.move(st, c.x + c.width * .34, c.y + c.height * .5, 750);
    await st.page.mouse.up();
    await r.wait(st, 300);
    r.stop(st); return st;
  },
  // Overview: the digital twin (a live engineering drawing), switched 3D -> Front -> Top -> 3D.
  async twin() {
    const st = await r.open(); await r.demoOn(st);
    await r.scrollTo(st, '#twin-card', 120, 1);
    await r.settle(st, 1500);
    const [x0, y0] = await r.center(st, '#twin-host');
    await st.page.mouse.move(x0 + 160, y0 + 120); st.mx = x0 + 160; st.my = y0 + 120;
    r.start(st, 'twin');
    await r.wait(st, 900);
    // Version 6: the 3D view stays on screen longer than the flat views. The cursor grabs the
    // drawing and turns it slowly (the twin can be orbited by dragging), then lets go.
    await r.move(st, x0 + 90, y0 + 40, MV);
    await r.wait(st, 200); r.mark(st, 'orbit');
    (st.clicks = st.clicks || []).push(+(st.n / st.fps).toFixed(3));
    await st.page.mouse.down(); await r.frame(st);
    await r.move(st, x0 - 150, y0 + 55, 1700);
    await r.move(st, x0 - 40, y0 + 30, 900);
    await st.page.mouse.up(); await r.frame(st); r.mark(st, 'orbited');
    await r.wait(st, 900);
    await r.click(st, '#wf-views [data-view="front"]', MV, PA); r.mark(st, 'front');
    await r.wait(st, 1300);
    await r.click(st, '#wf-views [data-view="top"]', 400, PA); r.mark(st, 'top');
    await r.wait(st, 1300);
    await r.click(st, '#wf-views [data-view="iso"]', 400, PA); r.mark(st, 'iso');
    await r.move(st, x0 + 170, y0 + 150, MV);
    await r.wait(st, 1600);
    r.stop(st); return st;
  },
  // Control: Skip one object. Pick a part on the plate, skip it, confirm; the rest keep printing.
  async skip_object() {
    const st = await r.open(); await r.demoOn(st);
    await st.page.mouse.move(1000, 560); st.mx = 1000; st.my = 560;
    r.start(st, 'skip_object');
    await r.wait(st, 300);
    await r.click(st, TAB('control'), MV, PA); r.mark(st, 'tab');
    await r.wait(st, 900);
    await r.scrollTo(st, '#ctrl-plate', 110, 900);
    await r.wait(st, 300); r.mark(st, 'plate');
    await r.click(st, '[data-plate-pick="' + (await st.page.locator('[data-plate-pick]').nth(1).getAttribute('data-plate-pick')) + '"]', MV, PA); r.mark(st, 'pick');
    await r.wait(st, 1000);
    await r.click(st, '#plate-skip', MV, PA); r.mark(st, 'ask');
    await r.wait(st, 1000);
    await r.click(st, '#plate-skip', 300, PA); r.mark(st, 'skip');
    await sleep(1200);
    await r.wait(st, 1800); r.mark(st, 'done');
    await r.move(st, 900, 700, MV);
    await r.wait(st, 500);
    r.stop(st); return st;
  },
  // Fleet: 27 printers (3 built in + 24 added in the sandbox), live. The cursor glides over the
  // cards and rests on a printing one (its ring, file and "done at" time).
  async fleet() {
    const st = await r.open(); await r.demoOn(st);
    await r.api(st, '/api/sandbox/farm?demo=1', { count: 24, busy_fraction: 0.5 });
    await r.settle(st, 2500);
    await st.page.mouse.move(700, 520); st.mx = 700; st.my = 520;
    r.start(st, 'fleet');
    await r.wait(st, 300);
    await r.click(st, TAB('fleet'), MV, PA); r.mark(st, 'tab');
    await r.wait(st, 900);
    await r.scrollTo(st, '.fleet-card >> nth=0', 380, 1000);
    r.mark(st, 'cards');
    await r.wait(st, 1100);
    await r.scrollTo(st, '.fleet-card[data-printer="sim-08"]', 330, 1100);
    r.mark(st, 'sandbox');
    const [x, y] = await r.center(st, '.fleet-card[data-printer="sim-08"] .ring-svg');
    await r.move(st, x + 40, y + 30, 750);
    r.mark(st, 'hover');
    await r.wait(st, 1700);
    const [x2, y2] = await r.center(st, '.fleet-card[data-printer="sim-09"] .ring-svg');
    await r.move(st, x2 + 40, y2 + 30, 750);
    r.mark(st, 'hover2');
    await r.wait(st, 1500);
    r.stop(st); return st;
  },
  // Confirm Print, the happy path: an idle printer, a sliced file, every check passes, Start print.
  async confirm_ok() {
    const st = await r.open(); await r.demoOn(st);
    await r.api(st, '/api/sandbox/farm?demo=1', { count: 24, busy_fraction: 0.5 });
    await tab(st, 'fleet'); await r.settle(st, 3000);
    await st.page.evaluate(() => { const c = document.querySelector('.fleet-card[data-printer="sim-04"]');
      [...c.querySelectorAll('button')].find(x => /^Open/.test(x.textContent.trim())).click(); });
    await r.settle(st, 3000);
    await st.page.evaluate(() => scrollTo(0, 0)); await r.settle(st, 500);
    await samples(st);
    // Version 16: the 3DBenchy (the owner: the Benchy instead of the block and the cube).
    const CUBE = '.fcd-name:text("3dbenchy_pla.gcode") >> visible=true';
    await intoView(st, CUBE, false);
    await st.page.mouse.move(900, 560); st.mx = 900; st.my = 560;
    r.start(st, 'confirm_ok');
    await r.wait(st, 300);
    await r.click(st, CUBE, 450, 100); r.mark(st, 'open');
    await r.wait(st, 1300);
    await intoView(st, '#fd-print', true);
    await r.click(st, '#fd-print', MV, PA); r.mark(st, 'print');
    await r.wait(st, 2300); r.mark(st, 'dialog');
    console.log('confirm says:', (await st.page.textContent('#confirm-body')).replace(/\s+/g, ' ').slice(0, 160));
    await r.click(st, '#confirm-go', MV, 400); r.mark(st, 'start');
    await sleep(800);
    await r.wait(st, 2200);
    r.stop(st); return st;
  },
  // Files: a Bambu Studio (MakerWorld) project, converted for the U1 in one click.
  async convert() {
    // Version 12: opening a project now lands in the slicing workspace, and conversion sits in its
    // "Source & import information" section, so the file opens before filming and the cursor opens
    // that section on film.
    const st = await r.open(); await r.demoOn(st); await samples(st);
    await intoView(st, 'text=sample_bambu_studio_layout.3mf', false);
    await st.page.locator('text=sample_bambu_studio_layout.3mf').first().click();
    await r.settle(st, 6000);
    await intoView(st, '.sw-source-info summary', false);
    await st.page.mouse.move(700, 400); st.mx = 700; st.my = 400;
    r.start(st, 'convert');
    await r.wait(st, 200);
    await r.click(st, '.sw-source-info summary', MV, PA); r.mark(st, 'open');
    await r.wait(st, 500);
    await intoView(st, '#fd-convert', true);
    await r.click(st, '#fd-convert', MV, PA); r.mark(st, 'convert');
    await sleep(2500);
    await r.wait(st, 700);
    await intoView(st, '#fd-convert-report', true);
    const rb = await r.box(st, '#fd-convert-report');
    await r.move(st, rb.x + 120, rb.y + 22, 700); r.mark(st, 'report');
    await r.wait(st, 2000);
    r.stop(st); return st;
  },
  // Version 12: the slicing workspace (Prepare). The four heads are given filament colours first
  // (saved tool choices, as the owner would set them), the bracket opens on the plate, then on
  // film: duplicate it, put the copy on head T1, apply, arrange. No slice is shown: slicing needs
  // a separately installed engine, which the filming machine does not have.
  async prepare() {
    const st = await r.open(); await r.demoOn(st);
    console.log('heads saved:', await st.page.evaluate(async () => {
      await postJSON('/api/modules/filament_inventory/toggle', { enabled: true });
      const H = (t, c, m) => ({ toolhead: t, color_hex: c, material: m, nozzle: 0.4, height: 0.2 });
      const r = await postJSON(api('/api/tools/assignments'), { heads: [H('T0', '#e8572a', 'PLA'), H('T1', '#2f6fde', 'PETG'), H('T2', '#f2f2ee', 'PLA'), H('T3', '#2b2b2e', 'PLA')] });
      return (await getJSON(api('/api/tools/assignments'))).heads.map(h => h.toolhead + h.color_hex).join(' ');
    }));
    await samples(st);
    await intoView(st, '.fcd-name:text("3dbenchy.stl") >> visible=true', false);
    await st.page.locator('.fcd-name:text("3dbenchy.stl") >> visible=true').first().click();
    await r.settle(st, 6000);
    await st.page.locator('#plate-colour').uncheck();
    await st.page.locator('button:has-text("Apply object settings")').first().click();
    await r.settle(st, 1200);
    await st.page.evaluate(() => scrollTo(0, document.querySelector('#sw-header').getBoundingClientRect().top + scrollY - 100));
    await r.settle(st, 1200);
    await st.page.mouse.move(700, 600); st.mx = 700; st.my = 600;
    r.start(st, 'prepare');
    await r.wait(st, 300);
    await r.click(st, 'button:has-text("Duplicate")', MV, PA); r.mark(st, 'dup');
    await r.wait(st, 500);
    await r.click(st, '#plate-tool', MV, PA);
    await st.page.locator('#plate-tool').selectOption('1'); await r.frame(st); r.mark(st, 'tool');
    await r.wait(st, 250);
    await r.click(st, 'button:has-text("Apply object settings")', MV, PA); r.mark(st, 'blue');
    await r.wait(st, 600);
    await r.click(st, '#plate-arrange', MV, PA); r.mark(st, 'arrange');
    await r.wait(st, 1100);
    await r.move(st, 900, 780, MV);
    await r.wait(st, 1200);
    r.stop(st); return st;
  },
  // Version 14 (V1 re-cut to 60 s): the fleet shot, opened by the app's live background. The
  // cursor drifts through the empty page margin (the Dots part and swirl around it), clicks an
  // empty spot (a ripple runs out through the dots), then goes on exactly as `fleet` does.
  async fleet_bg() {
    const st = await r.open(); await r.demoOn(st);
    await r.api(st, '/api/sandbox/farm?demo=1', { count: 24, busy_fraction: 0.5 });
    await r.settle(st, 2500);
    await st.page.mouse.move(1380, 260); st.mx = 1380; st.my = 260;
    r.start(st, 'fleet_bg');
    await r.wait(st, 200);
    await r.move(st, 1350, 470, 650); r.mark(st, 'drift');
    await r.move(st, 1395, 640, 600);
    await r.move(st, 1350, 560, 450);
    await r.wait(st, 120);
    await r.press(st); r.mark(st, 'ripple');
    await r.wait(st, 900);
    await r.click(st, TAB('fleet'), MV, PA); r.mark(st, 'tab');
    await r.wait(st, 900);
    await r.scrollTo(st, '.fleet-card >> nth=0', 380, 1000);
    r.mark(st, 'cards');
    await r.wait(st, 1100);
    await r.scrollTo(st, '.fleet-card[data-printer="sim-08"]', 330, 1100);
    r.mark(st, 'sandbox');
    const [x, y] = await r.center(st, '.fleet-card[data-printer="sim-08"] .ring-svg');
    await r.move(st, x + 40, y + 30, 750);
    r.mark(st, 'hover');
    await r.wait(st, 1700);
    const [x2, y2] = await r.center(st, '.fleet-card[data-printer="sim-09"] .ring-svg');
    await r.move(st, x2 + 40, y2 + 30, 750);
    r.mark(st, 'hover2');
    await r.wait(st, 1500);
    r.stop(st); return st;
  },
  // Version 14: the new digital twin (frontend/twin3d.js), both ways it is drawn. The cursor comes
  // in over the background, turns the 3D model by hand and lets go (it glides to a stop), clicks
  // head T0 (it lights up and its live details open), then switches to Drawing: the same model in
  // the same view, drawn as an engineering drawing, then the Front view with its sizes. "Show the
  // case" is switched on before filming so the drawing shows the whole printer, as the model does,
  // and the front view marks the estimated body size with "≈".
  async twin3d() {
    const st = await r.open(); await r.demoOn(st);
    await st.page.evaluate(() => scrollTo(0, document.querySelector('#twin-card').getBoundingClientRect().top + scrollY - 110));
    await r.settle(st, 1200);
    console.log('twin engine:', await st.page.evaluate(() => {
      const box = document.getElementById('wf-outer'); box.checked = true; box.dispatchEvent(new Event('change'));
      return document.getElementById('twin-card').dataset.twinEngine;
    }));
    await r.settle(st, 1500);
    const m = await r.box(st, '#twin-model');
    await st.page.mouse.move(60, 600); st.mx = 60; st.my = 600;
    r.start(st, 'twin3d');
    await r.wait(st, 300);
    await r.move(st, 110, 420, 500);
    const gx = m.x + m.width * .62, gy = m.y + m.height * .5;
    await r.move(st, gx, gy, 600);
    await r.wait(st, 100);
    // The drag speeds up to the moment of letting go, so the model keeps turning and glides to a stop.
    (st.clicks = st.clicks || []).push(+(st.n / st.fps).toFixed(3));
    await st.page.mouse.down(); r.mark(st, 'grab'); await r.frame(st);
    // A short flick (about 44 degrees by hand, then about 28 more as it glides): from the angled
    // view, past the front, to the side with the touchscreen and spools.
    const n = Math.round(.6 * st.fps);
    for (let i = 1; i <= n; i++) {
      const k = Math.pow(i / n, 2.2);
      await st.page.mouse.move(gx - 110 * k, gy + 14 * Math.sin(Math.PI * i / n)); await r.frame(st);
    }
    st.mx = gx - 110; st.my = gy;
    await st.page.mouse.up(); r.mark(st, 'release'); await r.frame(st);
    await r.wait(st, 1150);
    // The head labels are redrawn whenever the live state moves anything, and under the filming
    // clock several state updates arrive during one filmed frame, so a press and release a frame
    // apart land on two different label elements and no click fires. Aim at the label where it is
    // now, then press and release in the same instant (the cursor still shows its click ring).
    const tag = '#twin-model .t3-tag[data-id="head:T0"]';
    await r.move(st, ...(await r.center(st, tag)), 450);
    await r.wait(st, 150);
    const [tx, ty] = await r.center(st, tag);
    await st.page.mouse.move(tx, ty); st.mx = tx; st.my = ty;
    (st.clicks = st.clicks || []).push(+(st.n / st.fps).toFixed(3));
    await st.page.mouse.down(); await st.page.mouse.up(); r.mark(st, 'pick');
    await r.frame(st); await r.frame(st);
    console.log('picked:', await st.page.evaluate(() => !document.getElementById('wf-detail').hidden));
    await r.wait(st, 1300);
    await r.click(st, '#twin-modes [data-mode="drawing"]', 450, 200); r.mark(st, 'drawing');
    await r.wait(st, 1400);
    await r.click(st, '#wf-views [data-view="front"]', 400, 150); r.mark(st, 'front');
    await r.wait(st, 1400);
    await r.move(st, 1360, 520, 700);
    await r.wait(st, 400);
    r.stop(st); return st;
  },
  // Version 15 (V2 updated): the same twin story as `twin3d`, tighter, for a 4.5-bar feature at
  // 144 BPM: in over the dots, the flick and glide, head T0's details, then the drawing (held, no
  // Front view; the caption carries the estimate note).
  async twin3d_tight() {
    const st = await r.open(); await r.demoOn(st);
    await st.page.evaluate(() => scrollTo(0, document.querySelector('#twin-card').getBoundingClientRect().top + scrollY - 110));
    await r.settle(st, 1200);
    console.log('twin engine:', await st.page.evaluate(() => {
      const box = document.getElementById('wf-outer'); box.checked = true; box.dispatchEvent(new Event('change'));
      return document.getElementById('twin-card').dataset.twinEngine;
    }));
    await r.settle(st, 1500);
    const m = await r.box(st, '#twin-model');
    await st.page.mouse.move(70, 560); st.mx = 70; st.my = 560;
    r.start(st, 'twin3d_tight');
    await r.wait(st, 200);
    await r.move(st, 120, 430, 420);
    const gx = m.x + m.width * .62, gy = m.y + m.height * .5;
    await r.move(st, gx, gy, 480);
    await r.wait(st, 80);
    (st.clicks = st.clicks || []).push(+(st.n / st.fps).toFixed(3));
    await st.page.mouse.down(); r.mark(st, 'grab'); await r.frame(st);
    const n = Math.round(.6 * st.fps);
    for (let i = 1; i <= n; i++) {
      const k = Math.pow(i / n, 2.2);
      await st.page.mouse.move(gx - 110 * k, gy + 14 * Math.sin(Math.PI * i / n)); await r.frame(st);
    }
    st.mx = gx - 110; st.my = gy;
    await st.page.mouse.up(); r.mark(st, 'release'); await r.frame(st);
    await r.wait(st, 1000);
    // aim at the label where it is now; press and release in one instant (see `twin3d`)
    const tag = '#twin-model .t3-tag[data-id="head:T0"]';
    await r.move(st, ...(await r.center(st, tag)), 350);
    await r.wait(st, 120);
    const [tx, ty] = await r.center(st, tag);
    await st.page.mouse.move(tx, ty); st.mx = tx; st.my = ty;
    (st.clicks = st.clicks || []).push(+(st.n / st.fps).toFixed(3));
    await st.page.mouse.down(); await st.page.mouse.up(); r.mark(st, 'pick');
    await r.frame(st); await r.frame(st);
    console.log('picked:', await st.page.evaluate(() => !document.getElementById('wf-detail').hidden));
    await r.wait(st, 1150);
    await r.click(st, '#twin-modes [data-mode="drawing"]', 350, 150); r.mark(st, 'drawing');
    await r.wait(st, 1300);
    await r.move(st, 1360, 520, 700);
    await r.wait(st, 800);
    r.stop(st); return st;
  },
  // Photo-to-Print Studio: the built-in test pattern becomes a layered relief.
  async studio() {
    const st = await r.open(); await r.demoOn(st);
    await st.page.mouse.move(700, 520); st.mx = 700; st.my = 520;
    r.start(st, 'studio');
    await r.wait(st, 300);
    await r.click(st, TAB('studio'), MV, PA); r.mark(st, 'tab');
    await r.wait(st, 900);
    await r.click(st, '#st-test', MV, PA); r.mark(st, 'test');
    for (let i = 0; i < 8; i++) { await sleep(400); await r.wait(st, 250); }
    await r.move(st, 1050, 420, 900); r.mark(st, 'result');
    await r.wait(st, 2000);
    r.stop(st); return st;
  },
  // Version 6: the "And there's more" features each get their own shot. Each starts on the
  // Overview and clicks its way to the feature, like a person would.
  // Automations: a ready-made rule in one click, then saved.
  async automations() {
    const st = await r.open(); await r.demoOn(st);
    await st.page.mouse.move(820, 520); st.mx = 820; st.my = 520;
    r.start(st, 'automations');
    await r.wait(st, 300);
    await r.click(st, TAB('automations'), MV, PA); r.mark(st, 'tab');
    await r.wait(st, 800);
    await r.click(st, 'text=Tell me when a print finishes', MV, PA); r.mark(st, 'template');
    await r.wait(st, 1100);
    await intoView(st, '#rule-form button:has-text("Save rule")', true);
    await r.click(st, '#rule-form button:has-text("Save rule")', MV, PA); r.mark(st, 'save');
    await sleep(800);
    await r.wait(st, 1500);
    r.stop(st); return st;
  },
  // Care: maintenance from print history; one overdue task marked done.
  async care() {
    const st = await r.open(); await r.demoOn(st);
    await st.page.mouse.move(820, 520); st.mx = 820; st.my = 520;
    r.start(st, 'care');
    await r.wait(st, 300);
    await r.click(st, TAB('maintenance'), MV, PA); r.mark(st, 'tab');
    await r.wait(st, 900);
    await r.move(st, 700, 470, MV); r.mark(st, 'overdue');
    await r.wait(st, 900);
    await r.click(st, '#tasks button', MV, PA); r.mark(st, 'done');
    await sleep(600);
    await r.wait(st, 1600);
    r.stop(st); return st;
  },
  // Filament: the inventory switched on, its spools, and how many prints each one has left.
  async filament() {
    const st = await r.open(); await r.demoOn(st); await tab(st, 'maintenance');
    await r.scrollTo(st, '#tab-filament', 30, 1); await r.settle(st, 900);
    const card = '#tab-filament .card:has(#spool-list) button:has-text("Turn on")';
    await intoView(st, card, false);
    await st.page.mouse.move(900, 600); st.mx = 900; st.my = 600;
    r.start(st, 'filament');
    await r.wait(st, 300);
    await r.click(st, card, MV, PA); r.mark(st, 'on');
    await sleep(800);
    await r.wait(st, 1000); r.mark(st, 'spools');
    await intoView(st, '#forecast-wrap summary', true);
    await r.click(st, '#forecast-wrap summary', MV, PA); r.mark(st, 'forecast');
    await sleep(600);
    await r.wait(st, 500);
    await intoView(st, '#forecast-body', true);
    await r.wait(st, 300);
    await r.move(st, 640, 520, MV);
    await r.wait(st, 1300);
    r.stop(st); return st;
  },
  // Version 14: the inventory now starts empty (no spools are invented), so for the "and plenty
  // more" still three spools are entered before filming, as an owner would, through the page's own
  // postJSON (module switched on first). On film: the cursor opens how long each spool will last.
  async filament_v14() {
    const st = await r.open(); await r.demoOn(st);
    console.log('spools:', await st.page.evaluate(async () => {
      await postJSON('/api/modules/filament_inventory/toggle', { enabled: true });
      for (const [m, n, c, g] of [['PLA', 'Snapmaker Orange', '#e8572a', 820], ['PETG', 'Blue', '#2f6fde', 640], ['PLA', 'White', '#f2f2ee', 310]])
        await postJSON(api('/api/filament/spools'), { material: m, color_name: n, color_hex: c, grams_remaining: g });
      return (await getJSON(api('/api/filament/spools'))).spools?.length;
    }));
    await tab(st, 'maintenance');
    await r.scrollTo(st, '#tab-filament', 30, 1); await r.settle(st, 1500);
    await intoView(st, '#forecast-wrap summary', false);
    await st.page.mouse.move(1340, 520); st.mx = 1340; st.my = 520;
    r.start(st, 'filament_v14');
    await r.wait(st, 300);
    await r.move(st, 600, 420, MV); r.mark(st, 'spools');
    await r.wait(st, 500);
    await r.click(st, '#forecast-wrap summary', MV, PA); r.mark(st, 'forecast');
    await sleep(600);
    await r.wait(st, 700);
    await r.move(st, 1330, 640, 800);
    await r.wait(st, 900);
    r.stop(st); return st;
  },
  // Print cost: filament plus electricity, for the print running now and for past prints.
  async cost() {
    const st = await r.open(); await r.demoOn(st);
    await st.page.mouse.move(820, 560); st.mx = 820; st.my = 560;
    r.start(st, 'cost');
    await r.wait(st, 400);
    await r.scrollTo(st, '#cost-body', 330, 1300); r.mark(st, 'card');
    await r.wait(st, 300);
    const [x, y] = await r.center(st, '#cost-body');
    await r.move(st, x - 120, y - 70, MV); r.mark(st, 'now');
    await r.wait(st, 1200);
    await r.move(st, x + 380, y + 40, 900); r.mark(st, 'past');
    await r.wait(st, 1300);
    r.stop(st); return st;
  },
  // Home Assistant: the bridge switched on and its address typed in.
  async ha() {
    const st = await r.open(); await r.demoOn(st); await tab(st, 'modules');
    const card = 'section.card:has(#ha-url) button:has-text("Turn on")';
    await intoView(st, card, false);
    await st.page.mouse.move(900, 560); st.mx = 900; st.my = 560;
    r.start(st, 'ha');
    await r.wait(st, 300);
    await r.click(st, card, MV, PA); r.mark(st, 'on');
    await sleep(600);
    await r.wait(st, 700);
    await r.click(st, '#ha-url', MV, PA); r.mark(st, 'field');
    await r.wait(st, 150);
    await r.type(st, 'http://homeassistant.local:8123', 62); r.mark(st, 'typed');
    await r.wait(st, 300);
    await r.move(st, ...(await r.center(st, '#ha-push-btn')), MV);
    await r.wait(st, 1000);
    r.stop(st); return st;
  },
  // Phone: the thumb-first layout, the bottom bar, and Hold to cancel (released early, so nothing is cancelled).
  async phone() {
    const st = await r.open({ width: 390, height: 844, dpr: 3, mobile: true });
    await st.page.locator('label[for=demo-toggle]').click({ force: true });
    await r.settle(st, 3500);
    await st.page.mouse.move(250, 600); st.mx = 250; st.my = 600;
    r.start(st, 'phone');
    await r.wait(st, 150);
    await r.scrollBy(st, 330, 900);
    await r.wait(st, 100);
    await r.click(st, '.bottom-nav [data-tab="fleet"]', MV, PA);
    await r.wait(st, 650);
    await r.scrollBy(st, 280, 900);
    await r.wait(st, 100);
    await r.click(st, '.bottom-nav [data-tab="overview"]', MV, PA);
    await r.wait(st, 350);
    const [x, y] = await r.center(st, '#qa-cancel');
    await r.move(st, x, y, MV);
    (st.clicks = st.clicks || []).push(+(st.n / st.fps).toFixed(3));
    await st.page.mouse.down(); await r.wait(st, 750); await st.page.mouse.up();
    await r.wait(st, 600);
    r.stop(st); return st;
  },
  // Games: Sky Dash, actually played (every Space press is logged as a keystroke).
  async games() {
    const st = await r.open(); await r.demoOn(st);
    await st.page.mouse.move(820, 520); st.mx = 820; st.my = 520;
    r.start(st, 'games');
    await r.wait(st, 300);
    await r.click(st, TAB('games'), MV, PA); r.mark(st, 'tab');
    await r.wait(st, 900);
    await r.click(st, 'text=Start flight', MV, PA);
    for (let i = 0; i < 5; i++) { await r.wait(st, 633); await r.key(st, 'Space'); }   // 0.65 s flaps fly clean (tested)
    await r.wait(st, 200);
    r.stop(st); return st;
  },
  // ===== version 16 (16:9 only): what changed in the app =====
  // The quick tour (frontend/guide.js): the welcome callout is already up (started off camera, as
  // setup's "Start the tour" would), then on film: Show me, and the glass callout glides from Needs
  // you to the 3D twin, over to the Printers screen, then to Files.
  async tour_v16() {
    const st = await r.open(); await r.demoOn(st);
    await st.page.evaluate(() => { scrollTo(0, 0); Guide.everything(); });
    await r.settle(st, 1200);
    const go = '.guide-card [data-act=next]';
    await st.page.mouse.move(980, 700); st.mx = 980; st.my = 700;
    r.start(st, 'tour_v16');
    await r.wait(st, 250);
    await r.click(st, go, MV, PA); r.mark(st, 'needs');
    await r.wait(st, 1250);
    await r.click(st, go, MV, PA); r.mark(st, 'twin');
    await r.wait(st, 1250);
    await r.click(st, go, MV, PA); r.mark(st, 'fleet');
    await r.wait(st, 1250);
    await r.click(st, go, MV, PA); r.mark(st, 'files');
    await r.wait(st, 1300);
    console.log('tour at:', await st.page.textContent('#guide-title'));
    r.stop(st); return st;
  },
  // Your phone, the computer's side: Connect your phone opens the sheet with its QR code; the phone
  // scans it (here the script redeems the code as an iPhone would, the moment the phone shot shows
  // it arriving) and the sheet says it is connected. Filmed under a home-network address so the
  // sheet shows the address a phone would really open.
  async phone_qr() {
    const st = await r.open({ alias: HOME, url: HOME + '/?dashboard' }); await r.demoOn(st);
    await intoView(st, '#overview-pair-btn', false);
    await st.page.mouse.move(700, 420); st.mx = 700; st.my = 420;
    r.start(st, 'phone_qr');
    await r.wait(st, 250);
    await r.click(st, '#overview-pair-btn', MV, PA); r.mark(st, 'sheet');
    await sleep(600); await r.wait(st, 900);
    const code = (await st.page.textContent('.phone-code')).replace(/\s/g, '');
    console.log('sheet shows:', await st.page.textContent('.phone-address code'), 'code', code);
    await r.move(st, 760, 640, 600);
    await r.wait(st, 300);
    await fetch(`http://localhost:${PORT}/api/pairing/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, device_name: 'iPhone' }) });
    r.mark(st, 'scanned');
    for (let i = 0; i < 200 && !(await st.page.$('.phone-status.is-done')); i++) await r.frame(st);
    r.mark(st, 'paired');
    await r.wait(st, 1600);
    r.stop(st); return st;
  },
  // Your phone, the phone's side: it opens the link from the code (?pair=), pairs itself and lands
  // on the dashboard (no setup), saying so.
  async phone_paired() {
    const link = await (await fetch(`http://localhost:${PORT}/api/pairing/link`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base: HOME }) })).json();
    const st = await r.open({ width: 390, height: 844, dpr: 3, mobile: true, alias: HOME, url: `${HOME}/?pair=${link.code}`,
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    await st.page.locator('label[for=demo-toggle]').click({ force: true });
    await r.settle(st, 1800);
    await st.page.mouse.move(250, 600); st.mx = 250; st.my = 600;
    r.start(st, 'phone_paired');
    await r.wait(st, 1200);
    await r.scrollBy(st, 300, 900);
    await r.wait(st, 1500);
    console.log('phone says:', await st.page.evaluate(() => [...document.querySelectorAll('.orb-bubble')].map(b => b.textContent.trim().slice(0, 60)).join(' | ')));
    r.stop(st); return st;
  },
  // Stills for "and plenty more" (screenshots of the real panels, not film): the farm desk, mixed
  // layer heights, the converter, live telemetry, automations and version & updates.
  // Version 17: "and plenty more" shows what changed since version 16: Away from home (your phone
  // from any network; this filming machine has no Tailscale, so the card shows its real first
  // step), the version card (v0.11.0, updates that install every time) and a help note opened
  // on a card. The farm desk, the converter and automations stay.
  async stills_v17() {
    const st = await r.open(); await r.demoOn(st);
    const shoot = await stillShooter(st, 'stills_v17');
    await shoot('desk', 'fleet', '#tab-desk');
    await shoot('convert', 'files', '#convert-card', async () => {
      await st.page.locator('#cv-sample').click();
      for (let i = 0; i < 40 && !(await st.page.locator('#cv-report .convert-report').count()); i++) await sleep(500);
      await r.settle(st, 1200);
    });
    await shoot('automations', 'automations', '#rule-list', async () => {
      await st.page.locator('text=Tell me when a print finishes').first().click();
      await r.settle(st, 800);
      await st.page.locator('#rule-form button:has-text("Save rule")').first().click();
    });
    await shoot('away', 'modules', '#remote-card', null, null, 590);
    await shoot('updates', 'modules', '#version-card');
    await shoot('help', 'overview', '#attention', async () => {
      await st.page.locator('#attention .xp-btn').first().click();
    }, '.xp-pop');
    return st;
  },
  async stills_v16() {
    const st = await r.open(); await r.demoOn(st);
    const shoot = await stillShooter(st, 'stills_v16');
    await shoot('desk', 'fleet', '#tab-desk');
    await shoot('layers', 'files', '#tab-layerplan');
    await shoot('convert', 'files', '#convert-card', async () => {
      await st.page.locator('#cv-sample').click();
      for (let i = 0; i < 40 && !(await st.page.locator('#cv-report .convert-report').count()); i++) await sleep(500);
      await r.settle(st, 1200);
    });
    await shoot('telemetry', 'overview', '#telemetry');
    await shoot('automations', 'automations', '#rule-list', async () => {
      await st.page.locator('text=Tell me when a print finishes').first().click();
      await r.settle(st, 800);
      await st.page.locator('#rule-form button:has-text("Save rule")').first().click();
    });
    // The process settings only show once a slicing engine is installed (not on the filming
    // machine), so the version card, how the app keeps itself current, takes their place.
    await shoot('updates', 'modules', '#version-card');
    return st;
  },
};

(async () => {
  const want = process.argv.slice(2);
  const names = want.length ? want : Object.keys(SHOTS);
  for (const name of names) {
    const t0 = Date.now();
    await restartServer();
    let st;
    try { st = await SHOTS[name](); }
    catch (e) { console.error(name, 'FAILED:', e.message); }
    finally { if (st) await st.browser.close(); }
    console.log(name, 'took', Math.round((Date.now() - t0) / 1000), 's');
  }
  if (server) server.kill('SIGTERM');
})();
