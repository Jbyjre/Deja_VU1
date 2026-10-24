// Capture the actual app on an isolated simulated farm. No real printer is added.
// node tools/readme-images/capture.js [output-directory]
const {chromium} = require('playwright');
const {spawn} = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const {execFileSync} = require('child_process');
const root = path.resolve(__dirname, '../..');
const out = path.resolve(process.argv.slice(2).find(a=>!a.startsWith('--')) || path.join(__dirname, 'out/captures'));
const port = 8796, base = `http://127.0.0.1:${port}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  fs.mkdirSync(out, {recursive:true});
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dejavu-marketing-'));
  const server = spawn('python3', ['backend/app.py'], {cwd:root,
    env:{...process.env, PORT:String(port), DEJAVU_DATA_DIR:data}, stdio:'ignore'});
  let browser, fake;
  const record = {source:'Actual app, isolated built-in simulated farm',capturedAt:new Date().toISOString(),
    baseCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    workingTree:true,images:[], errors:[]};
  try {
    let ready = false;
    for (let i=0; i<60; i++) {
      if (server.exitCode !== null) throw new Error('Capture server exited');
      try { if ((await fetch(base+'/api/health')).ok) {ready=true; break;} } catch (_) {}
      await wait(200);
    }
    if (!ready) throw new Error('Capture server did not start');
    browser = await chromium.launch({executablePath:process.env.DEJAVU_BROWSER||'/usr/bin/chromium',
      args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
    const ctx = await browser.newContext({viewport:{width:1366,height:1000},deviceScaleFactor:1,
      reducedMotion:'reduce'});
    await ctx.addInitScript(() => localStorage.setItem('dejavu1.setup-seen','1'));
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => record.errors.push(e.message));
    await page.goto(base+'/?dashboard');
    await page.locator('label[for="demo-toggle"]').click();
    await page.locator('#attention').waitFor();
    await page.evaluate(() => document.fonts.ready);
    if (await page.locator('#handoff-dismiss').isVisible()) await page.locator('#handoff-dismiss').click();
    await page.addStyleTag({content:'.live-pill,#handoff{visibility:hidden!important}'});
    async function tab(name) {
      await page.evaluate(n => showTab(n), name); await wait(900);
      await page.evaluate(() => window.scrollTo(0,0));
    }
    async function shot(name, selector, note) {
      const el = page.locator(selector).first();
      await el.waitFor(); await el.scrollIntoViewIfNeeded(); await wait(350);
      await el.screenshot({path:path.join(out,name+'.jpg'),type:'jpeg',quality:92,animations:'disabled',
        style:'.topbar,.live-pill{visibility:hidden!important}'});
      record.images.push({file:name+'.jpg',selector,note:note||'Simulated farm; no physical U1 connected'});
      console.log('captured '+name);
    }
    async function conversion() {
      await page.evaluate(async()=>{await Workshop.openFile('sample_bambu_studio_layout.3mf')});
      if(await page.locator('.sw-source-info').count())await page.locator('.sw-source-info').evaluate(e=>e.open=true);
      await page.locator('#fd-convert').click();await wait(600);
      await page.setViewportSize({width:760,height:1000});
      await shot('converter','#fd-convert-report','Actual supported sample conversion report at 760 px, not a physical print');
      await page.setViewportSize({width:1366,height:1000});
    }
    if(process.argv.includes('--copy-review')){
      await tab('automations');
      await page.getByRole('button',{name:'Tell me when a print finishes',exact:true}).click();
      await shot('automations','#tab-automations','Current automation wording and a sample notification rule; simulated farm');
      await page.locator('#setup-open').click();
      await shot('onboarding-copy','#setup-dialog','Current onboarding wording; simulated-farm review, no physical U1');
      if(record.errors.length)throw new Error(record.errors.join('\n'));
      return;
    }
    if(process.argv.includes('--conversion')){
      await tab('files');await page.locator('#file-samples').click();await wait(800);
      await conversion();
      if(record.errors.length)throw new Error(record.errors.join('\n'));
      return;
    }
    if (!process.argv.includes('--extras')) {
    await page.screenshot({path:path.join(out,'overview.jpg'),type:'jpeg',quality:92});
    record.images.push({file:'overview.jpg',note:'1366 × 1000 viewport; simulated farm'});
    await shot('needs-you','#attention');
    await shot('twin-health-chamber','.now-row');
    await shot('twin-3d-printing','#twin-card','Software model; body size and internal geometry estimated; simulated readings');
    await shot('twin-model','#twin-model','Software model; body size and internal geometry estimated; simulated readings');
    await page.locator('#wf-picks [data-pick="head:T0"]').click();
    await shot('twin-detail','#twin-card');
    await page.locator('#twin-modes button').filter({hasText:'Drawing'}).click();
    await shot('twin-drawing','#twin-card','Software drawing, estimated geometry; simulated readings');
    await page.locator('#wf-views [data-view="front"]').click();
    await shot('twin-front-printing','#twin-card');
    await page.locator('#wf-views [data-view="top"]').click();
    await shot('twin-top-printing','#twin-card');
    await page.locator('#twin-modes button').filter({hasText:'3D model'}).click();
    await tab('fleet');
    await shot('fleet','#tab-fleet > .card');
    await shot('fleet-cards','#fleet-grid');
    await tab('control');
    await shot('control','#tab-control');
    await page.locator('[data-plate-pick]').last().click();
    await shot('skip-object','#ctrl-plate');
    await tab('maintenance'); await shot('care','#tab-maintenance > .card');
    await tab('automations');
    await page.getByRole('button',{name:'Tell me when a print finishes',exact:true}).click();
    await shot('automations','#tab-automations');
    await tab('studio'); await page.locator('#st-test').click(); await wait(1500);
    await shot('photo-studio','#st-preview','Built-in test pattern; software colour/relief preview, not a physical print');
    await tab('files');
    await page.locator('#file-samples').click(); await wait(1200);
    await shot('files','.files-layout');
    await page.evaluate(async () => {await Workshop.openFile('unsafe_example_purge_past_bed.gcode')});
    await page.locator('#fd-print').click();
    await shot('confirm-print-refused','#confirm-dialog','Actual refusal UI, unsafe sample G-code, simulated printer');
    await page.locator('#confirm-cancel').click();
    await page.evaluate(async () => {await Workshop.openFile('two_colour_coaster.gcode')});
    await shot('demo-layer-preview','#file-detail','Built-in sample G-code; simulated demonstration, not a fresh engine run');
    await tab('modules'); await shot('appearance','#appearance-card');
    await tab('games'); await shot('games','#tab-games');
    await page.setViewportSize({width:390,height:844});
    await tab('overview'); await wait(800);
    await page.screenshot({path:path.join(out,'phone.jpg'),type:'jpeg',quality:94});
    record.images.push({file:'phone.jpg',note:'390 × 844 Chromium viewport, not a physical phone; simulated farm'});
    await shot('twin-phone','#twin-card');
    }
    await page.setViewportSize({width:1366,height:1000});
    await tab('overview'); await shot('twin-model','#twin-model','Software model; body size and internal geometry estimated; simulated readings');
    await tab('modules'); await shot('modules','.card:has(#module-list)');
    await tab('maintenance'); await shot('dock-rings','.card:has(#rings)','On-screen state logic; physical ring drivers unfinished');
    await tab('files');
    if (await page.locator('#file-samples').isVisible()) {await page.locator('#file-samples').click();await wait(800);}
    await page.locator('#lp-example').click();await wait(500);
    await shot('layer-planner','#tab-layerplan');
    await conversion();
    await tab('fleet');
    fake=spawn('python3',['-u','-c',"import sys,time;sys.path[:0]=['backend','tests'];from fake_moonraker import FakeMoonraker;f=FakeMoonraker();print(f.url,flush=True);time.sleep(120)"],{cwd:root,stdio:['ignore','pipe','ignore']});
    const fakeURL=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Stand-in did not start')),5000);
      fake.stdout.once('data',b=>{clearTimeout(timer);resolve(b.toString().trim())});
      fake.once('error',reject);
    });
    await page.locator('#fleet-add-url').fill(fakeURL);
    await page.locator('#fleet-add-test').click();
    await page.waitForFunction(()=>document.getElementById('fleet-test-result').textContent.includes('Moonraker'));
    await shot('add-printer','.card:has(#fleet-add-form)','Source-based stand-in Moonraker over loopback; not a physical U1');
    await page.evaluate(async()=>{
      const post=async(url,body)=>{const r=await fetch(url+'?demo=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error('Sandbox capture request failed');};
      await post('/api/sandbox/farm',{count:6,busy_fraction:0.5});
      await post('/api/sandbox/scenario',{preset:'jam'});
      await post('/api/sandbox/step',{seconds:660});
    });
    await wait(900);await shot('sandbox-farm','#tab-fleet > .card');
    await shot('sandbox','#tab-sandbox');
    await tab('studio');await page.locator('#st-test').click();await wait(1200);
    await shot('photo-studio','#st-preview','Built-in test pattern; software colour/relief preview, not a physical print');
    await tab('automations');await page.getByRole('button',{name:'Tell me when a print finishes',exact:true}).click();
    await shot('automations','#tab-automations');
    if (record.errors.length) throw new Error(record.errors.join('\n'));
  } finally {
    if (browser) await browser.close();
    if (fake) fake.kill('SIGTERM');
    server.kill('SIGTERM');
    fs.writeFileSync(path.join(out,'capture-record.json'),JSON.stringify(record,null,2)+'\n');
  }
})().catch(e => {console.error(e);process.exitCode=1});
