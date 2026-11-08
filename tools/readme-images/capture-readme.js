// The five README pictures and the product page's two app pictures, from the actual app on an isolated simulated farm (no real printer is added).
// node tools/readme-images/capture-readme.js [output-directory]
// Default look (Glass, light), demo data on, at 1366 px and 390 px, deviceScaleFactor 2.
const {chromium} = require('playwright');
const {spawn} = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const root = path.resolve(__dirname, '../..');
const out = path.resolve(process.argv[2] || path.join(__dirname, 'out/readme'));
const port = 8797, base = `http://127.0.0.1:${port}`;
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(out, {recursive: true});
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dejavu-readme-'));
  const server = spawn('python3', ['backend/app.py'], {cwd: root,
    env: {...process.env, PORT: String(port), DEJAVU_DATA_DIR: data, DEJAVU_NO_BROWSER: '1'}, stdio: 'ignore'});
  let browser;
  const errors = [];
  try {
    for (let i = 0; i < 60; i++) {
      if (server.exitCode !== null) throw new Error('Capture server exited');
      try { if ((await fetch(base + '/api/health')).ok) break; } catch (_) {}
      await wait(200);
    }
    browser = await chromium.launch({executablePath: process.env.DEJAVU_BROWSER || '/usr/bin/chromium',
      args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader']});
    const ctx = await browser.newContext({viewport: {width: 1366, height: 860}, deviceScaleFactor: 2});
    await ctx.addInitScript(() => localStorage.setItem('dejavu1.setup-seen', '1'));
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/?dashboard');
    await page.locator('label[for="demo-toggle"]').click();
    await page.locator('#attention').waitFor();
    await page.evaluate(() => document.fonts.ready);
    if (await page.locator('#handoff-dismiss').isVisible()) await page.locator('#handoff-dismiss').click();
    // Pop-up messages and the handoff offer come and go; keep them out of the pictures.
    await page.addStyleTag({content: '#handoff,#toasts{visibility:hidden!important}'});
    const tab = async name => {
      await page.evaluate(n => showTab(n), name);
      await wait(1500);
      await page.evaluate(() => window.scrollTo(0, 0));
    };
    const save = async name => {
      await page.screenshot({path: path.join(out, name), type: 'jpeg', quality: 86});
      console.log('saved', name);
    };

    await tab('overview'); await wait(1500);
    await save('readme-overview.jpg');

    // The three printer cards the link-preview card shows (tools/readme-images/img/fleet-cards.jpg).
    await tab('fleet'); await wait(2500);
    const hideOrb = await page.addStyleTag({content: '#orb-dock{visibility:hidden!important}'});
    await page.locator('#fleet-grid').screenshot({path: path.join(out, 'fleet-cards.jpg'), type: 'jpeg', quality: 90});
    await hideOrb.evaluate(node => node.remove());
    console.log('saved fleet-cards.jpg');

    await tab('control'); await wait(2000);
    await page.evaluate(() => {
      const card = document.getElementById('twin-card');
      window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - 24);
    });
    await wait(4000);
    await save('readme-printer.jpg');

    await tab('files');
    await page.locator('#file-samples').click();
    // The first time, making the samples takes about 15 s; the button comes back when it's done.
    await page.waitForFunction(() => !document.getElementById('file-samples').disabled, null, {timeout: 120000});
    await wait(2000);
    await page.evaluate(async () => { await Workshop.openFile('two_benchies_two_colours.gcode'); });
    await wait(4000);
    await page.locator('#file-detail').scrollIntoViewIfNeeded(); await wait(800);
    await save('readme-gcode.jpg');

    await page.evaluate(async () => { await Workshop.openFile('unsafe_example_purge_past_bed.gcode'); });
    await page.locator('#fd-print').click();
    await page.locator('#confirm-dialog').waitFor(); await wait(1500);
    await page.locator('#confirm-dialog').screenshot({path: path.join(out, 'readme-confirm.jpg'), type: 'jpeg', quality: 88});
    console.log('saved readme-confirm.jpg');
    await page.locator('#confirm-cancel').click();

    await page.setViewportSize({width: 390, height: 844});
    await tab('overview'); await wait(1500);
    await save('readme-phone.jpg');

    // The product page's Overview and phone pictures, at the sizes welcome.html declares (1440 × 900, 390 × 844).
    // Same page, so the demo camera is already running; scale 'css' writes one pixel per CSS pixel.
    await page.screenshot({path: path.join(out, 'page-phone.jpg'), type: 'jpeg', quality: 90, scale: 'css'});
    await page.setViewportSize({width: 1440, height: 900});
    await tab('overview'); await wait(3000);
    await page.screenshot({path: path.join(out, 'page-overview.jpg'), type: 'jpeg', quality: 88, scale: 'css'});
    console.log('saved page-overview.jpg, page-phone.jpg');
  } finally {
    if (browser) await browser.close();
    server.kill();
    fs.rmSync(data, {recursive: true, force: true});
    if (errors.length) console.log('page errors:', errors.slice(0, 5));
  }
})().catch(e => { console.error(e); process.exit(1); });
