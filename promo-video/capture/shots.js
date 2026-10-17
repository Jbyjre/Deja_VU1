// Films every shot of the promo from the real app, running the built-in simulated farm.
// Each shot gets a freshly started server (so the farm starts from the same state) and a
// fresh browser. Usage: node shots.js [shot ...]   (no names = all shots)
const r = require('./rec');
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PORT = +(process.env.APP_PORT || 8791);
let server = null;

async function restartServer() {
  if (server) { server.kill('SIGTERM'); await new Promise(res => server.once('exit', res)); }
  server = spawn('python3', ['backend/app.py'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { const res = await fetch(`http://localhost:${PORT}/api/modules`); if (res.ok) return; } catch (e) {}
    await new Promise(res => setTimeout(res, 200));
  }
  throw new Error('server did not start');
}
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
const MV = 620, PA = 260;   // cursor travel and the pause before a click, in ms (v5: calm, tutorial pace)
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
    await st.page.locator('text=two_colour_coaster.gcode').first().click();
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
    await r.wait(st, 1500);
    await r.click(st, '#wf-views [data-view="front"]', MV, PA); r.mark(st, 'front');
    await r.wait(st, 1500);
    await r.click(st, '#wf-views [data-view="top"]', 400, PA); r.mark(st, 'top');
    await r.wait(st, 1500);
    await r.click(st, '#wf-views [data-view="iso"]', 400, PA); r.mark(st, 'iso');
    await r.move(st, x0 + 170, y0 + 150, MV);
    await r.wait(st, 1200);
    r.stop(st); return st;
  },
  // Control: Skip one object. Pick a part on the plate, skip it, confirm; the rest keep printing.
  async skip_object() {
    const st = await r.open(); await r.demoOn(st); await tab(st, 'control');
    await r.scrollTo(st, '#ctrl-plate', 110, 1);
    await r.settle(st, 1500);
    await st.page.mouse.move(1000, 560); st.mx = 1000; st.my = 560;
    r.start(st, 'skip_object');
    await r.wait(st, 150);
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
    await tab(st, 'fleet');
    await r.settle(st, 4000);
    await st.page.mouse.move(1100, 600); st.mx = 1100; st.my = 600;
    r.start(st, 'fleet');
    await r.wait(st, 700);
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
    const CUBE = '.fcd-name:text("calibration_cube_20mm.gcode") >> visible=true';
    await intoView(st, CUBE, false);
    await st.page.mouse.move(900, 560); st.mx = 900; st.my = 560;
    r.start(st, 'confirm_ok');
    await r.wait(st, 300);
    await r.click(st, CUBE, 450, 100); r.mark(st, 'open');
    await r.wait(st, 1300);
    await intoView(st, '#fd-print', true);
    await r.click(st, '#fd-print', MV, PA); r.mark(st, 'print');
    await r.wait(st, 2300); r.mark(st, 'dialog');
    await r.click(st, '#confirm-go', MV, 400); r.mark(st, 'start');
    await sleep(800);
    await r.wait(st, 2200);
    r.stop(st); return st;
  },
  // Files: a Bambu Studio (MakerWorld) project, converted for the U1 in one click.
  async convert() {
    const st = await r.open(); await r.demoOn(st); await samples(st);
    await st.page.mouse.move(900, 560); st.mx = 900; st.my = 560;
    await intoView(st, 'text=sample_bambu_studio_layout.3mf', false);
    r.start(st, 'convert');
    await r.wait(st, 100);
    await r.click(st, 'text=sample_bambu_studio_layout.3mf', MV, PA);
    await r.wait(st, 600);
    await intoView(st, '#fd-convert', true);
    await r.click(st, '#fd-convert', MV, PA); r.mark(st, 'convert');
    await sleep(2500);
    await r.wait(st, 900);
    const rb = await r.box(st, '#fd-convert-report');
    await r.move(st, rb.x + 120, rb.y + 22, 800); r.mark(st, 'report');
    await r.wait(st, 2000);
    r.stop(st); return st;
  },
  // Photo-to-Print Studio: the built-in test pattern becomes a layered relief.
  async studio() {
    const st = await r.open(); await r.demoOn(st); await tab(st, 'studio');
    await st.page.mouse.move(700, 700); st.mx = 700; st.my = 700;
    r.start(st, 'studio');
    await r.wait(st, 100);
    await r.click(st, '#st-test', MV, PA); r.mark(st, 'test');
    for (let i = 0; i < 8; i++) { await sleep(400); await r.wait(st, 250); }
    await r.move(st, 1050, 420, 900); r.mark(st, 'result');
    await r.wait(st, 2000);
    r.stop(st); return st;
  },
  // Automations: a ready-made rule in one click.
  async automations() {
    const st = await r.open(); await r.demoOn(st); await tab(st, 'automations');
    await st.page.mouse.move(800, 700); st.mx = 800; st.my = 700;
    r.start(st, 'automations');
    await r.wait(st, 100);
    await r.click(st, 'text=Tell me when a print finishes', MV, PA);
    await r.wait(st, 1300);
    r.stop(st); return st;
  },
  // Care: maintenance, two overdue.
  async care() {
    const st = await r.open(); await r.demoOn(st); await tab(st, 'maintenance');
    await st.page.mouse.move(1150, 700); st.mx = 1150; st.my = 700;
    r.start(st, 'care');
    await r.wait(st, 100);
    await r.move(st, 820, 500, 450);
    await r.wait(st, 1100);
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
    const st = await r.open(); await r.demoOn(st); await tab(st, 'games');
    await st.page.mouse.move(800, 760); st.mx = 800; st.my = 760;
    r.start(st, 'games');
    await r.wait(st, 100);
    await r.click(st, 'text=Start flight', MV, PA);
    for (let i = 0; i < 5; i++) { await r.wait(st, 633); await r.key(st, 'Space'); }   // 0.65 s flaps fly clean (tested)
    await r.wait(st, 200);
    r.stop(st); return st;
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
