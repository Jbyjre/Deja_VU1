#!/usr/bin/env node
/* The Slicer (frontend/slicer*.js), in a real browser.
 *
 *   node tools/slicer-check.js                       every check
 *   node tools/slicer-check.js --shots <folder>      also writes pictures at 1366 and 390 px, light and dark
 *   node tools/slicer-check.js --probe               only says whether Playwright and a Chromium are available
 *
 * Starts Deja Vu1 (backend/app.py) on a spare port in a temporary data folder with the stand-in engine (tools/stand-in-engine.py), turns on
 * demo data and drives the screen the way a person would. The real engine is never needed and nothing leaves this computer. Prints one line per
 * check; exits 0 only when all passed. tests/test_slicer_browser.py runs it.
 *
 *   screen     the Slicer opens with Prepare and Preview in the toolbar edge; old links (#/slice, #/layers, #/prepare) open it
 *   plate      the 3D view shows the U1's plate in the app's own room colours (not the old blue box)
 *   objects    a model comes on the plate, the object list and the object panel show it with its real size, undo and redo work
 *   tools      turning, dragging, laying on a face, arranging and orienting do what they say
 *   problems   an object over the edge is named and its fix works; a head change brings up the prime tower
 *   settings   the dock's dials, the speed slider and the full sheet (search, Simple and Advanced) change the working profile
 *   slice      Slice plate runs the stand-in engine and opens the Preview with its legend, sliders and figures
 *   preview    colouring, hiding a line type, the layer slider and play work; changing the plate marks the slice out of date
 *   files      a model opened in Files opens in the Slicer
 *   phone      at 390 px nothing scrolls sideways and Slice plate is reachable
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
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
const post = (url, data) => new Promise((resolve, reject) => {
  const body = JSON.stringify(data || {});
  const req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
    let out = ''; res.on('data', c => (out += c)); res.on('end', () => resolve({ status: res.statusCode, body: out }));
  });
  req.on('error', reject); req.end(body);
});

async function startServer() {
  const port = await freePort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dejavu-slicer-'));
  const engine = path.join(tmp, 'engine');
  execFileSync('python3', [path.join(ROOT, 'tools', 'stand-in-engine.py'), '--make-engine', engine], { stdio: 'ignore' });
  const env = { ...process.env, PORT: String(port), DEJAVU_DATA_DIR: path.join(tmp, 'data'), DEJAVU_NO_BROWSER: '1', DEJAVU_TESTER: '0', DEJAVU_SLICER_PATH: path.join(engine, 'bin', 'snapmaker-orca') };
  const child = spawn('python3', [path.join(ROOT, 'backend', 'app.py')], { cwd: ROOT, env, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) {
    try { if ((await get(base + '/api/health')).status === 200) return { base, child, tmp }; } catch (e) { /* not up yet */ }
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

async function open(browser, base, size, dark, hash = '#/slicer') {
  const context = await browser.newContext({ viewport: size, serviceWorkers: 'block' });
  await context.addInitScript(d => {
    try {
      localStorage.setItem('dejavu1.setup-seen', '1');
      localStorage.setItem('dejavu1.printer', 'u1-studio');
      if (d) localStorage.setItem('dejavu1.pref.theme', 'dark');
    } catch (e) { /* no storage */ }
  }, !!dark);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message ? e.message : e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|net::ERR/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
  await page.goto(base + '/?nointro' + hash, { waitUntil: 'domcontentloaded' });
  const onSlicer = /slicer/.test(hash);
  await page.waitForFunction(w => window.SL && (!w || (SL.state && SL.state.model && SL.state.view)) && typeof showTab === 'function' && document.readyState === 'complete', onSlicer, { timeout: 40000 });
  await page.evaluate(() => { const t = document.getElementById('demo-toggle'); if (t && !t.checked) { t.checked = true; t.dispatchEvent(new Event('change')); } });
  await page.waitForTimeout(1800);
  if (onSlicer) await page.waitForFunction(() => SL.state.work && SL.state.work.data, null, { timeout: 15000 }).catch(() => {});
  return { context, page, errors };
}

const model = page => page.evaluate(() => {
  const m = SL.state.model, B = SlicerModel.boundsOf;
  return m.onPlate().map(o => { const b = B(o); return { id: o.id, name: o.name, tool: o.tool, c: b.centre.map(v => +v.toFixed(2)), s: b.size.map(v => +v.toFixed(2)), min: b.min.map(v => +v.toFixed(2)), max: b.max.map(v => +v.toFixed(2)) }; });
});

async function main() {
  let playwright;
  try { playwright = require('playwright'); } catch (e) { console.error('Playwright for Node is not installed'); process.exit(2); }
  const executablePath = findChromium(playwright);
  if (!executablePath) { console.error('No Chromium was found (set DEJAVU_BROWSER)'); process.exit(2); }
  if (flag('--probe')) process.exit(0);
  const shots = opt('--shots');
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await playwright.chromium.launch({ executablePath, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const server = await startServer();
  try {
    await post(server.base + '/api/files/samples', {});
    for (let i = 0; i < 60; i++) { const l = JSON.parse((await get(server.base + '/api/files')).body); if ((l.files || []).some(f => f.name === '3dbenchy.stl')) break; await sleep(500); }

    /* ---- screen ---- */
    const { context, page, errors } = await open(browser, server.base, { width: 1366, height: 800 });
    const edge = await page.evaluate(() => ({ title: document.querySelector('#topbar')?.innerText.replace(/\s+/g, ' '), tabs: [...document.querySelectorAll('#pb-parts [role="tab"]')].map(b => b.textContent.trim()),
      active: document.querySelector('.rail [aria-current="page"]')?.getAttribute('aria-label') || '', tab: document.body.dataset.tab }));
    check(edge.tab === 'slicer' && /Slicer/.test(edge.title || ''), `the Slicer opens: ${edge.title}`);
    check(['Prepare', 'Preview'].every(t => edge.tabs.includes(t)), `the toolbar edge has Prepare and Preview: ${edge.tabs.join(' | ')}`);
    for (const old of ['slice', 'layers', 'prepare']) {
      await page.goto(server.base + '/?nointro#/' + old); await page.waitForTimeout(500);
      const t = await page.evaluate(() => document.body.dataset.tab);
      check(t === 'slicer', `the old link #/${old} opens the Slicer`);
    }
    await page.goto(server.base + '/?nointro#/slicer'); await page.waitForTimeout(800);

    /* ---- plate ---- */
    await page.waitForTimeout(800);
    const plate = await page.evaluate(() => {
      const v = SL.state.view, c = document.getElementById('sl-canvas'), gl = v.gl;
      v.render();
      const px = (x, y) => { const o = new Uint8Array(4); gl.readPixels(Math.round(x * c.width), Math.round((1 - y) * c.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, o); return [...o]; };
      const room = U1Plate.roomColours();
      return { corner: px(0.5, 0.02), room: room.top.map(x => Math.round(x * 255)), floor: room.bottom.map(x => Math.round(x * 255)), area: U1Plate.AREA, sheet: U1Plate.SHEET };
    });
    const near = (a, b, e = 14) => a.every((v, i) => Math.abs(v - b[i]) <= e);
    check(near(plate.corner.slice(0, 3), plate.room, 40) || near(plate.corner.slice(0, 3), plate.floor, 40), `the view's background is the app's own room (${plate.corner.slice(0, 3)} vs ${plate.room}), not the old navy`);
    check(!near(plate.corner.slice(0, 3), [60, 65, 75], 10), 'the old blue-grey background colour is gone');
    check(plate.area.x1 - plate.area.x0 === 270 && plate.area.y1 - plate.area.y0 === 270 && plate.sheet.w === 276 && plate.sheet.d === 293, 'the plate has the measured sizes: 270 x 270 printable, a 276 x 293 sheet');

    /* ---- objects ---- */
    const empty = await page.evaluate(() => !document.getElementById('sl-empty').hidden);
    check(empty, 'an empty plate offers to add a model');
    await page.evaluate(() => SL.openFromLibrary('3dbenchy.stl'));
    await page.waitForFunction(() => SL.state.model.onPlate().length === 1, null, { timeout: 15000 });
    await page.waitForTimeout(600);
    let objs = await model(page);
    check(objs.length === 1 && Math.abs(objs[0].s[0] - 60) < 0.5 && Math.abs(objs[0].s[2] - 48) < 0.5, `the model is on the plate with its real size: ${objs[0] && objs[0].s}`);
    check(Math.abs(objs[0].c[0] - 135.5) < 0.6 && Math.abs(objs[0].c[1] - 136) < 0.6 && Math.abs(objs[0].min[2]) < 0.01, `it sits in the middle of the printable area, on the plate: ${objs[0].c} z ${objs[0].min[2]}`);
    const ui = await page.evaluate(() => ({ list: document.querySelectorAll('#sl-objs .sl-obj').length, name: document.querySelector('#sl-objs .sl-name')?.textContent, x: document.getElementById('sl-i-x')?.value, sx: document.getElementById('sl-i-sx')?.value, insp: !document.getElementById('sl-insp').hidden }));
    check(ui.list === 1 && /3dbenchy/.test(ui.name) && ui.insp && Math.abs(parseFloat(ui.x) - 135.5) < 1 && Math.abs(parseFloat(ui.sx) - 60) < 1, `the list and the object panel show it: ${JSON.stringify(ui)}`);
    await page.evaluate(() => SL.state.model.moveBy(SL.state.model.objects[0].id, [20, 0, 0]));
    let moved = (await model(page))[0].c[0];
    await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
    check(Math.abs((await model(page))[0].c[0] - 135.5) < 0.6 && Math.abs(moved - 155.5) < 0.6, 'undo puts an object back where it was');
    await page.keyboard.press('Control+y'); await page.waitForTimeout(200);
    check(Math.abs((await model(page))[0].c[0] - 155.5) < 0.6, 'redo moves it again');
    await page.evaluate(() => SL.state.model.place(SL.state.model.objects[0].id, { x: 135.5, y: 136 }));

    /* ---- tools ---- */
    await page.fill('#sl-i-rz', '90'); await page.dispatchEvent('#sl-i-rz', 'change'); await page.waitForTimeout(300);
    let s = (await model(page))[0].s;
    check(Math.abs(s[0] - 31) < 0.6 && Math.abs(s[1] - 60) < 0.6, `Turn Z 90° swaps the footprint: ${s}`);
    await page.click('#sl-t-rotate'); await page.waitForTimeout(200);
    check(await page.evaluate(() => document.getElementById('sl-t-rotate').getAttribute('aria-pressed') === 'true' && SL.state.view.tool === 'rotate'), 'the Rotate tool shows its rings');
    await page.click('#sl-t-move');
    // dragging the model across the plate
    // a point on the model's body, away from the handles at its middle: found the way the page finds it, by asking what is under the pointer
    const where = await page.evaluate(() => {
      const v = SL.state.view, o = SL.state.model.objects[0], b = SlicerModel.boundsOf(o), c = v.toScreen(b.centre);
      for (let r = 14; r < 160; r += 6) for (let a = 0; a < 6.28; a += 0.4) {
        const x = c[0] + Math.cos(a) * r, y = c[1] + Math.sin(a) * r, hit = v.pickAt(x, y);
        if (hit.kind === 'item') return { x, y };
      }
      return { x: c[0], y: c[1] };
    });
    await page.mouse.move(where.x, where.y); await page.mouse.down(); await page.mouse.move(where.x + 60, where.y + 20, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(400);
    const dragged = (await model(page))[0].c;
    check(Math.hypot(dragged[0] - 135.5, dragged[1] - 136) > 3, `dragging the model moves it across the plate: now ${dragged}`);
    await page.evaluate(() => { SL.state.model.place(SL.state.model.objects[0].id, { x: 135.5, y: 136 }); });
    await page.evaluate(() => SL.state.model.layOnFace(SL.state.model.objects[0].id, [0, 1, 0]));
    s = (await model(page))[0];
    check(Math.abs(s.min[2]) < 0.01, 'laying on a face puts it on the plate');
    await page.evaluate(() => { const m = SL.state.model; m.undo(); });
    await page.evaluate(async () => { await SL.openFromLibrary('twisted_vase.stl'); await SL.openFromLibrary('spur_gear_24t.stl'); });
    await page.waitForFunction(() => SL.state.model.onPlate().length === 3, null, { timeout: 15000 });
    await page.click('#sl-t-arrange'); await page.waitForTimeout(500);
    objs = await model(page);
    const inside = objs.every(o => o.min[0] >= 0.5 && o.max[0] <= 270.5 && o.min[1] >= 1 && o.max[1] <= 271);
    const clear = objs.every((a, i) => objs.every((b, j) => i >= j || a.max[0] <= b.min[0] || b.max[0] <= a.min[0] || a.max[1] <= b.min[1] || b.max[1] <= a.min[1]));
    check(objs.length === 3 && inside && clear, 'Arrange puts three objects inside the printable area, clear of each other');
    await page.evaluate(() => { const m = SL.state.model; m.selected = new Set([m.objects[0].id]); m.rotateBy(m.objects[0].id, 0, 90); m.drop(m.objects[0].id); SL.state.view.select([m.objects[0].id]); });
    const before = await page.evaluate(() => SlicerModel.orientationScore(SL.state.model.objects[0], SL.state.model.objects[0].transform).overhang);
    await page.evaluate(() => SL.orient()); await page.waitForTimeout(400);
    const after = await page.evaluate(() => SlicerModel.orientationScore(SL.state.model.objects[0], SL.state.model.objects[0].transform).overhang);
    check(after <= before + 1e-9, `Auto-orient does not make the overhang worse (${before.toFixed(2)} to ${after.toFixed(2)})`);

    /* ---- problems and the prime tower ---- */
    await page.evaluate(() => { const m = SL.state.model; m.place(m.objects[2].id, { x: 285 }); });
    await page.waitForTimeout(300);
    const prob = await page.evaluate(() => [...document.querySelectorAll('#sl-problems .sl-pb')].map(r => r.innerText.replace(/\s+/g, ' ')));
    check(prob.some(t => /over the edge/i.test(t) && /Move onto the plate/.test(t)), `an object over the edge is named with its fix: ${prob[0]}`);
    await page.click('#sl-problems .sl-pf'); await page.waitForTimeout(400);
    check((await model(page)).every(o => o.max[0] <= 270.5), 'the fix moves it back inside');
    await page.evaluate(() => { const m = SL.state.model; m.setTool([m.objects[1].id], 1); });
    await page.waitForTimeout(500);
    check(await page.evaluate(() => SL.state.view.items.has(990) && !!SL.state.model.tower), 'two heads bring up the prime tower on the plate');
    await page.evaluate(() => { const m = SL.state.model; m.setTool([m.objects[1].id], 0); });

    /* ---- settings ---- */
    const heads = await page.evaluate(() => document.querySelectorAll('#sl-blk-heads .sl-hrow').length);
    check(heads === 4, 'the dock lists the four heads');
    const posted = [];
    page.on('request', r => { if (r.method() === 'POST' && /\/api\/slicer\/working$/.test(r.url())) posted.push(r.postData()); });
    await page.fill('[data-quick="wall_loops"]', '5'); await page.dispatchEvent('[data-quick="wall_loops"]', 'change');
    await page.waitForTimeout(1500);
    check(posted.some(p => /"wall_loops":5/.test(p || '')), 'changing Walls in the dock rebuilds the working profile with 5 walls');
    await page.evaluate(() => { const r = document.getElementById('sl-spd'); r.value = 80; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(1500);
    check(posted.some(p => /outer_wall_speed/.test(p || '')), 'the speed slider scales the preset’s speeds');
    await page.click('#sl-all'); await page.waitForSelector('#sl-sheet');
    check(await page.evaluate(() => document.querySelectorAll('#sl-sheet .sl-s-row').length > 0 && document.querySelector('#sl-sheet .sl-s-help')?.textContent.length > 20), 'the settings sheet lists settings with a plain-words note beside each');
    await page.fill('#sl-s-search', 'tower'); await page.waitForTimeout(300);
    const found = await page.evaluate(() => [...document.querySelectorAll('#sl-sheet .sl-s-name')].map(n => n.textContent));
    check(found.some(n => /Prime tower/.test(n)) && found.some(n => /Tower wall/.test(n)) && found.some(n => /Internal ribs/.test(n)), `search finds the tower settings: ${found.slice(0, 5).join(', ')}`);
    await page.fill('#sl-s-search', ''); await page.click('[data-mode="advanced"]'); await page.click('[data-tab="Strength"]');
    const adv = await page.evaluate(() => document.querySelectorAll('#sl-sheet .sl-s-row').length);
    check(adv > 8, `Advanced shows every Strength setting (${adv})`);
    await page.fill('#sl-sheet [data-k="infill_direction"]', '45'); await page.dispatchEvent('#sl-sheet [data-k="infill_direction"]', 'change'); await page.waitForTimeout(1200);
    check(await page.evaluate(() => SL.state.overrides.infill_direction === 45) && await page.evaluate(() => !!document.querySelector('#sl-sheet .sl-s-row.is-changed')), 'a changed setting is marked, and can be put back');
    await page.click('#sl-sheet [data-reset="infill_direction"]');
    check(await page.evaluate(() => !('infill_direction' in SL.state.overrides)), 'its reset button puts it back to the preset');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    check(await page.evaluate(() => !document.getElementById('sl-sheet')), 'Escape closes the sheet');
    await page.evaluate(() => { SL.state.overrides = {}; SL.state.speed = 100; SL.settings.save(); SL.settings.render(); });

    /* ---- engine card ---- */
    await page.click('#sl-engine-btn'); await page.waitForSelector('#sl-engine');
    const card = await page.evaluate(() => document.getElementById('sl-engine').innerText.replace(/\s+/g, ' '));
    check(/open source/.test(card) && /AGPL-3\.0/.test(card) && /Source/.test(card), 'the engine card says what the engine is and links its source and licence');
    await page.keyboard.press('Escape');

    /* ---- slice ---- */
    await page.evaluate(() => { const m = SL.state.model; m.remove(m.objects.slice(1).map(o => o.id)); m.setTool([m.objects[0].id], 0); });
    await page.waitForTimeout(300);
    if (shots) await page.screenshot({ path: path.join(shots, 'prepare-1366-light.png') });
    await page.click('#sl-slice');
    await page.waitForFunction(() => SL.state.slice.state === 'done' || SL.state.slice.state === 'failed', null, { timeout: 90000 });
    const sl = await page.evaluate(() => ({ state: SL.state.slice.state, err: SL.state.slice.error, result: SL.state.slice.result && { layers: SL.state.slice.result.layers, hours: SL.state.slice.result.hours, grams: SL.state.slice.result.grams } }));
    check(sl.state === 'done' && sl.result && sl.result.layers === 60, `Slice plate runs the engine and finishes: ${JSON.stringify(sl.result || sl.err)}`);
    await page.waitForFunction(() => document.body.dataset.tab === 'slicer' && Sections.current('slicer') === 'preview', null, { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => SL.pathState && SL.pathState.data, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    const pv = await page.evaluate(() => ({ part: Sections.current('slicer'), legend: [...document.querySelectorAll('#sl-pdock .sl-lg span')].map(x => x.textContent), time: document.querySelector('#sl-pdock .sl-fig')?.textContent, layers: document.getElementById('sl-ls') && !document.getElementById('sl-ls').hidden, heads: document.querySelectorAll('#sl-pdock .sl-sub').length }));
    check(pv.part === 'preview' && pv.legend.length >= 4 && /Outer wall/.test(pv.legend.join()) && /Prime tower/.test(pv.legend.join()), `the Preview opens with the line types: ${pv.legend.join(', ')}`);
    check(/min|h/.test(pv.time || '') && pv.layers && pv.heads === 2, `it shows the time, the layer slider and each head's filament: ${pv.time}`);
    check(await page.evaluate(() => { const v = SL.state.view; return !!v.pathBuf && v.pathBuf.n > 1000; }), 'the whole toolpath is on the graphics card');
    if (shots) await page.screenshot({ path: path.join(shots, 'preview-1366-light.png') });

    /* ---- preview ---- */
    await page.selectOption('#sl-pv-mode', '2'); await page.waitForTimeout(300);
    check(await page.evaluate(() => !!document.querySelector('#sl-pdock .sl-grad') && SL.state.view.pathView.mode === 2), 'colouring by speed shows a gradient legend');
    await page.selectOption('#sl-pv-mode', '0'); await page.waitForTimeout(200);
    await page.click('#sl-pdock .sl-lg[data-f]'); await page.waitForTimeout(200);
    check(await page.evaluate(() => SL.state.view.pathView.fshow.some(x => x === 0)), 'pressing a line type hides it');
    await page.click('#sl-pdock .sl-lg.is-off'); await page.waitForTimeout(150);
    await page.focus('#sl-th-top'); const top0 = await page.evaluate(() => SL.pathState.max);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200);
    check(await page.evaluate(t => SL.pathState.max === t - 2 && SL.state.view.pathView.maxL === t - 3, top0), 'the layer slider answers the arrow keys');
    await page.keyboard.press('End');
    await page.click('#sl-play'); await page.waitForTimeout(400);
    check(await page.evaluate(() => SL.pathState.playing === true || SL.pathState.max >= 1), 'play starts the print going layer by layer');
    await page.evaluate(() => { if (SL.pathState.playing) document.getElementById('sl-play').click(); });
    await page.evaluate(() => Sections.choose('slicer', 'prepare')); await page.waitForTimeout(300);
    await page.evaluate(() => { const m = SL.state.model; m.moveBy(m.objects[0].id, [10, 0, 0]); });
    await page.waitForTimeout(300);
    check(await page.evaluate(() => SL.state.slice.stale === true), 'changing the plate marks the slice out of date');
    check(errors.length === 0, `no script errors on the Slicer: ${errors.slice(0, 2).join(' | ')}`);
    await context.close();

    /* ---- files hands over ---- */
    {
      const c2 = await open(browser, server.base, { width: 1366, height: 800 }, false, '#/files');
      await c2.page.evaluate(() => { try { localStorage.removeItem('dejavu1.slicer.project'); } catch (e) { /* none */ } });
      await c2.page.click('[data-open-file="3dbenchy.stl"]', { timeout: 20000 }).catch(() => {});
      await c2.page.waitForSelector('#fd-slice', { timeout: 15000 }).catch(() => {});
      check(await c2.page.evaluate(() => !!document.getElementById('fd-slice') && /Open in Slicer/.test(document.getElementById('fd-slice').textContent)), 'a model opened in Files offers Open in Slicer');
      await c2.page.click('#fd-slice').catch(() => {});
      await c2.page.waitForFunction(() => document.body.dataset.tab === 'slicer' && window.SL && SL.state.model && SL.state.model.onPlate().length >= 1, null, { timeout: 20000 }).catch(() => {});
      check(await c2.page.evaluate(() => document.body.dataset.tab === 'slicer' && SL.state.model.onPlate().some(o => /3dbenchy/.test(o.name))), 'it opens in the Slicer with the model on the plate');
      await c2.context.close();
    }

    /* ---- the project keeps itself ---- */
    {
      const c3 = await open(browser, server.base, { width: 1366, height: 800 });
      await c3.page.evaluate(async () => { await SL.openFromLibrary('3dbenchy.stl'); const m = SL.state.model; m.place(m.objects[0].id, { x: 100, y: 90 }); m.setTool([m.objects[0].id], 2); });
      await c3.page.waitForFunction(() => { try { return /"tool":2/.test(localStorage.getItem('dejavu1.slicer.project') || ''); } catch (e) { return false; } }, null, { timeout: 15000 }).catch(() => {});
      await c3.page.reload({ waitUntil: 'domcontentloaded' });
      await c3.page.waitForFunction(() => window.SL && SL.state.model && SL.state.model.onPlate().length === 1, null, { timeout: 25000 }).catch(() => {});
      const back = await model(c3.page);
      check(back.length === 1 && Math.abs(back[0].c[0] - 100) < 1 && Math.abs(back[0].c[1] - 90) < 1 && back[0].tool === 2, `the plate comes back after a reload, where it was, on the same head: ${JSON.stringify(back[0] && { c: back[0].c, tool: back[0].tool })}`);
      await c3.context.close();
    }

    /* ---- dark, and the phone ---- */
    for (const [label, size, dark] of [['1366-dark', { width: 1366, height: 800 }, true], ['390-light', { width: 390, height: 844 }, false], ['390-dark', { width: 390, height: 844 }, true]]) {
      const c = await open(browser, server.base, size, dark);
      await c.page.evaluate(() => SL.openFromLibrary('3dbenchy.stl'));
      await c.page.waitForTimeout(1800);
      const m = await c.page.evaluate(() => ({ sideways: document.documentElement.scrollWidth > window.innerWidth + 2, slice: (() => { const b = document.getElementById('sl-slice'); if (!b) return null; const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, inside: r.left >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1 }; })(),
        dark: document.documentElement.dataset.theme }));
      check(!m.sideways, `${label}: nothing scrolls sideways`);
      check(m.slice && m.slice.inside && m.slice.w >= 24 && m.slice.h >= 24, `${label}: Slice plate is reachable and big enough: ${JSON.stringify(m.slice)}`);
      if (dark) check(m.dark === 'dark', `${label}: the dark look is on`);
      if (shots) await c.page.screenshot({ path: path.join(shots, `prepare-${label}.png`) });
      await c.context.close();
    }
  } finally {
    await browser.close();
    server.child.kill();
  }
  console.log(`\n${results.passed} passed, ${results.failed.length} failed`);
  process.exit(results.failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
