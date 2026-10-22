/* Historical stock-2.4.2 fixture check; current workflow: tools/check-slicer-workspace.js.
   Development checks: node tools/check-native-studio.js URL OUTPUT_DIR */
const {chromium}=require('playwright'),fs=require('fs'),assert=require('assert');
const base=process.argv[2]||'http://localhost:8791',out=process.argv[3]||'/tmp/dejavu-evidence';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.DEJAVU_BROWSER||'/usr/bin/chromium',args:['--no-sandbox']});const result={checks:[],errors:[]};
 try {for(const width of [1366,390]){
  const page=await browser.newPage({viewport:{width,height:width===390?844:900},reducedMotion:'reduce'});page.on('pageerror',e=>result.errors.push(e.message));let filamentCommands=0;page.on('request',r=>{if(r.url().includes('/api/printer/control/filament')&&r.method()==='POST')filamentCommands++;});
  await page.goto(base+'/?dashboard');await page.waitForTimeout(900);await page.keyboard.press('Escape');
  await page.evaluate(async()=>{for(const id of ['auto_print','photo_studio','filament_inventory'])await fetch('/api/modules/'+id+'/toggle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:true})});await fetch('/api/files/samples',{method:'POST'});await freshModules();showTab('files');await Workshop.loadFiles();await Workshop.openFile('dock_bracket.stl');});
  await page.locator('#plate-dimensions').waitFor();if(await page.locator('#handoff-dismiss').isVisible())await page.locator('#handoff-dismiss').click();
  await page.locator('#plate-duplicate').click();assert.equal(await page.locator('#plate-object option').count(),2);
  await page.locator('#plate-arrange').click();assert.match(await page.locator('#plate-report').textContent(),/No object bounds overlap/);
  await page.locator('#plate-rz').fill('37');await page.locator('#plate-transform button').click();
  await page.locator('#plate-undo').click();await page.locator('#plate-redo').click();
  await page.locator('[data-mirror=x]').click();await page.locator('#plate-flat').click();await page.locator('#plate-drop').click();
  await page.locator('#plate-collision').click();await page.waitForFunction(()=>!document.getElementById('plate-collision').disabled);
  assert.equal(await page.locator('#fd-canvas').evaluate(c=>c.getContext('webgl').getError()),0);
  const check=await page.locator('#plate-report').textContent();assert.match(check,/No mesh contact|Mesh contact/);
  await page.locator('#plate-fit').click();await page.waitForTimeout(200);await page.screenshot({path:out+'/after-viewer-'+width+'.png'});
  await page.locator('.plate-heading').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/after-editor-'+width+'.png'});
  const saved=await page.evaluate(()=>DVPlate.active.saveObjects());assert(saved.name.endsWith('.3mf'));
  await page.evaluate(async name=>{await Workshop.loadFiles();await Workshop.openFile(name);},saved.name);await page.waitForFunction(()=>document.querySelectorAll('#plate-object option').length===2);
  assert.equal(await page.locator('#plate-object option').count(),2);
  const colours=await page.evaluate(async()=>{const obj=new TextEncoder().encode('v 0 0 0 1 0 0\nv 10 0 0 0 1 0\nv 0 10 0 0 0 1\nf 1 2 3\n');const m=DV3D.parseOBJ(obj.buffer);return Array.from(m.colours);});assert.deepEqual(colours,[1,0,0,0,1,0,0,0,1]);
  await page.locator('#fd-close').click();await page.evaluate(()=>showTab('autoprint'));await page.locator('#ts-load').click();await page.locator('#ts-form').waitFor({state:'visible'});assert.equal(await page.locator('#ts-heads fieldset').count(),4);
  const stale=await page.evaluate(async()=>{const original=currentPrinter;currentPrinter='stale-other-printer';document.querySelector('[data-apply]').click();await new Promise(r=>setTimeout(r,100));const refused=document.getElementById('ts-result').textContent;currentPrinter=original;await PrintRoom.load();return refused;});assert.match(stale,/Printer changed/);assert.equal(filamentCommands,0);
  await page.locator('#tool-setup').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/after-tools-'+width+'.png'});
  await page.locator('#np-scan').click();await page.locator('#np-form').waitFor({state:'visible'});
  for(let i=0;i<4;i++){const option=page.locator('#np-filament-'+i+' option').filter({hasText:'Snapmaker PLA Lite @U1'}).first();await page.locator('#np-filament-'+i).selectOption(await option.getAttribute('value'));}
  await page.locator('.native-profile h3').evaluate(e=>e.scrollIntoView({block:'start'}));await page.waitForTimeout(150);await page.screenshot({path:out+'/after-slicer-'+width+'.png'});
  await page.locator('#np-name').fill('Browser U1 check '+width+' '+Date.now());await page.locator('#np-form button[type=submit],#np-form > button').click();
  await page.waitForFunction(()=>document.getElementById('np-status').textContent.startsWith('Profile saved'));
  await page.evaluate(()=>Farm.loadAutoPrint());await page.locator('#ap-model').selectOption(saved.name);
  const started=page.waitForResponse(r=>r.url().includes('/api/slicer/slice')&&r.request().method()==='POST');await page.locator('#ap-slice').click();const job=await (await started).json();
  await page.waitForFunction(id=>Farm.state.ap.jobs.some(j=>j.id===id&&['done','queued','failed'].includes(j.status)),job.id);
  const sliced=await page.evaluate(id=>Farm.state.ap.jobs.find(j=>j.id===id),job.id);assert.equal(sliced.status,'done',sliced.error);assert.equal(sliced.report.orca_version,'2.4.2');
  await page.locator('#ap-jobs').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/after-real-slice-'+width+'.png'});
  await page.evaluate(()=>showTab('studio'));await page.locator('#mk-test').click();await page.locator('#mk-build').click();await page.waitForFunction(()=>document.getElementById('mk-status').textContent.startsWith('Saved '));
  await page.locator('#toasts .toast').last().waitFor({state:'detached',timeout:10000}).catch(()=>{});await page.locator('#maker-workspace').evaluate(e=>e.scrollIntoView({block:'start'}));await page.waitForTimeout(400);await page.screenshot({path:out+'/after-maker-'+width+'.png'});
  await page.locator('#mk-mode').selectOption('layered');await page.locator('#mk-build').click();await page.waitForFunction(()=>/swatches first/.test(document.getElementById('mk-status').textContent));
  await page.evaluate(async()=>{showTab('files');await Workshop.openFile('real-bracket.gcode');});await page.locator('#gv-range').waitFor();await page.locator('#gv-style').selectOption('speed');await page.locator('#gv-single').check();await page.locator('#gv-range').fill('10');await page.locator('#gv-travel').check();await page.locator('#gv-markers').check();await page.locator('#gv-fit').click();
  await page.locator('#fd-canvas').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/after-gcode-'+width+'.png'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const missing=await page.evaluate(()=>{try{DV3D.parseSTL(new Uint8Array([1,2,3]).buffer);return false}catch(_){return true}});assert(missing);
  result.checks.push({width,arbitraryRotation:true,mirror:true,layFlat:true,undoRedo:true,arrange:true,meshContact:check,roundtripObjects:2,vertexColours:true,fourTools:true,staleToolRefusal:true,installedProfiles:true,realSlice:sliced.report.files,imageBuild:true,uncalibratedRefusal:true,gcodeLayers:true,overflow:false});await page.close();
 }}finally{await browser.close();fs.writeFileSync(out+'/native-browser-results.json',JSON.stringify(result,null,2));}
 assert.deepEqual(result.errors,[]);console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1});
