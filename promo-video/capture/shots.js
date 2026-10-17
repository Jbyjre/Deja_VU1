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
const sleep = ms => new Promise(res => setTimeout(res, ms));

const SHOTS = {
  // Overview: Needs you, then a jam fired from the sandbox arrives live.
  async overview_jam() {
    const st = await r.open(); await r.demoOn(st);
    await st.page.mouse.move(1000, 640); st.mx = 1000; st.my = 640;
    r.start(st, 'overview_jam');
    await r.wait(st, 250);
    await r.move(st, 760, 470, 500);
    await r.wait(st, 300);
    await r.move(st, 1180, 650, 450);
    await r.api(st, '/api/sandbox/fire?demo=1', { event: 'jam', printer: 'u1-workshop' });
    await sleep(700); r.mark(st, 'jam');
    await r.wait(st, 1900);
    await r.move(st, 760, 410, 500);
    await r.wait(st, 1300);
    r.stop(st); return st;
  },
  // Files: open the unsafe example, press Print..., Confirm Print refuses with reasons.
  async confirm_refuse() {
    const st = await r.open(); await r.demoOn(st); await samples(st);
    await st.page.mouse.move(900, 560); st.mx = 900; st.my = 560;
    r.start(st, 'confirm_refuse');
    await r.wait(st, 200);
    await r.click(st, 'text=unsafe_example_purge_past_bed.gcode', 500, 80);
    await r.wait(st, 1000);
    await r.click(st, '#fd-print', 500, 80); r.mark(st, 'print');
    await r.wait(st, 1500); r.mark(st, 'dialog');
    await r.move(st, ...(await r.center(st, '#confirm-go')), 500);
    await r.wait(st, 1300);
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
    await r.wait(st, 150);
    await r.move(st, s.x + s.width - 6, s.y + s.height / 2, 450);
    await st.page.mouse.down(); await r.frame(st);
    await r.move(st, s.x + 4, s.y + s.height / 2, 500);
    await r.wait(st, 120);
    await r.move(st, s.x + s.width - 2, s.y + s.height / 2, 1900);
    await st.page.mouse.up(); await r.frame(st);
    const c = await r.box(st, '#fd-canvas');
    await r.move(st, c.x + c.width * .62, c.y + c.height * .55, 400);
    await st.page.mouse.down(); await r.frame(st);
    await r.move(st, c.x + c.width * .36, c.y + c.height * .5, 1000);
    await st.page.mouse.up();
    await r.wait(st, 400);
    r.stop(st); return st;
  },
  // Overview: the digital twin, print health and chamber climate, live.
  async twin() {
    const st = await r.open(); await r.demoOn(st);
    await r.scrollTo(st, '#twin-card', 140, 1);
    await r.settle(st, 1500);
    await st.page.evaluate(() => { document.getElementById('__cur').style.opacity = '0'; });
    r.start(st, 'twin');
    await r.wait(st, 3600);
    r.stop(st); return st;
  },
  // Fleet: 27 printers (3 built in + 24 added in the sandbox), select all, pause, read each result.
  async fleet() {
    const st = await r.open(); await r.demoOn(st);
    await r.api(st, '/api/sandbox/farm?demo=1', { count: 24, busy_fraction: 0.5 });
    await tab(st, 'fleet');
    await r.settle(st, 4000);
    await st.page.mouse.move(1100, 600); st.mx = 1100; st.my = 600;
    r.start(st, 'fleet');
    await r.wait(st, 150);
    await r.scrollTo(st, '.fleet-card >> nth=0', 380, 800);
    await r.scrollBy(st, 1100, 1000);
    await r.wait(st, 100);
    await r.scrollTo(st, '#tab-fleet', 150, 900);   // back up, so the command bar is in place (it sticks under the header lower down)
    await r.wait(st, 150);
    await r.click(st, '#fc-all', 500, 80); r.mark(st, 'all');
    await r.wait(st, 450);
    await r.click(st, '#fc-bar [data-act="pause"]', 500, 80); r.mark(st, 'pause');
    await sleep(2500);
    await r.wait(st, 1500); r.mark(st, 'results');
    await r.move(st, 1240, 760, 500);
    await r.wait(st, 900);
    r.stop(st); return st;
  },
  // Files: a Bambu Studio (MakerWorld) project, converted for the U1 in one click.
  async convert() {
    const st = await r.open(); await r.demoOn(st); await samples(st);
    await st.page.mouse.move(900, 560); st.mx = 900; st.my = 560;
    r.start(st, 'convert');
    await r.wait(st, 150);
    await r.click(st, 'text=sample_bambu_studio_layout.3mf', 500, 80);
    await r.wait(st, 900);
    await r.click(st, '#fd-convert', 500, 80);
    await sleep(2500);
    await r.wait(st, 1500);
    r.stop(st); return st;
  },
  // Photo-to-Print Studio: the built-in test pattern becomes a layered relief.
  async studio() {
    const st = await r.open(); await r.demoOn(st); await tab(st, 'studio');
    await st.page.mouse.move(700, 700); st.mx = 700; st.my = 700;
    r.start(st, 'studio');
    await r.wait(st, 150);
    await r.click(st, '#st-test', 500, 80);
    for (let i = 0; i < 6; i++) { await sleep(400); await r.wait(st, 200); }
    await r.wait(st, 1000);
    r.stop(st); return st;
  },
  // Automations: a ready-made rule in one click.
  async automations() {
    const st = await r.open(); await r.demoOn(st); await tab(st, 'automations');
    await st.page.mouse.move(800, 700); st.mx = 800; st.my = 700;
    r.start(st, 'automations');
    await r.wait(st, 150);
    await r.click(st, 'text=Tell me when a print finishes', 500, 80);
    await r.wait(st, 1600);
    r.stop(st); return st;
  },
  // Care: maintenance, two overdue.
  async care() {
    const st = await r.open(); await r.demoOn(st); await tab(st, 'maintenance');
    await st.page.mouse.move(1150, 700); st.mx = 1150; st.my = 700;
    r.start(st, 'care');
    await r.wait(st, 150);
    await r.move(st, 820, 500, 700);
    await r.wait(st, 1300);
    r.stop(st); return st;
  },
  // Phone: the thumb-first layout, the bottom bar, and Hold to cancel (released early, so nothing is cancelled).
  async phone() {
    const st = await r.open({ width: 390, height: 844, dpr: 3, mobile: true });
    await st.page.locator('label[for=demo-toggle]').click({ force: true });
    await r.settle(st, 3500);
    await st.page.mouse.move(250, 600); st.mx = 250; st.my = 600;
    r.start(st, 'phone');
    await r.wait(st, 250);
    await r.scrollBy(st, 330, 800);
    await r.wait(st, 200);
    await r.click(st, '.bottom-nav [data-tab="fleet"]', 500, 80);
    await r.wait(st, 900);
    await r.scrollBy(st, 280, 800);
    await r.wait(st, 200);
    await r.click(st, '.bottom-nav [data-tab="overview"]', 500, 80);
    await r.wait(st, 500);
    const [x, y] = await r.center(st, '#qa-cancel');
    await r.move(st, x, y, 500);
    (st.clicks = st.clicks || []).push(+(st.n / st.fps).toFixed(3));
    await st.page.mouse.down(); await r.wait(st, 750); await st.page.mouse.up();
    await r.wait(st, 800);
    r.stop(st); return st;
  },
  // Games: Sky Dash, actually played.
  async games() {
    const st = await r.open(); await r.demoOn(st); await tab(st, 'games');
    await st.page.mouse.move(800, 760); st.mx = 800; st.my = 760;
    r.start(st, 'games');
    await r.wait(st, 150);
    await r.click(st, 'text=Start flight', 500, 80);
    for (let i = 0; i < 5; i++) { await r.wait(st, 650); await st.page.keyboard.press('Space'); }   // 0.65 s flaps fly clean (tested)
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
