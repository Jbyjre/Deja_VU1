/* Development-only browser checks. No browser package is needed to run the app.
   DEJAVU_BROWSER=/usr/bin/chromium node tools/check-launch-ui.js URL OUTPUT_DIR */
const {chromium}=require('playwright');
const fs=require('fs');
const assert=require('assert');
const base=process.argv[2]||'http://127.0.0.1:8791';
const out=process.argv[3]||'/tmp/dejavu-ui-check';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.DEJAVU_BROWSER||'/usr/bin/chromium',args:['--no-sandbox']});
 const result={base,checks:[],frames:[],errors:[]};
 try {
  for(const width of [1366,390]) {
   const context=await browser.newContext({viewport:{width,height:width===390?844:900},reducedMotion:'reduce'});
   const page=await context.newPage(); const requests=[];
   page.on('request',r=>requests.push(r.url()+' '+(r.postData()||'')));
   page.on('pageerror',e=>result.errors.push(e.message));
   await page.goto(base+'/?dashboard');
   await page.locator('#setup-dialog[open]').waitFor();
   await page.screenshot({path:`${out}/onboarding-${width}.png`});
   const name='PRIVACY_SENTINEL_<img src=x onerror=alert(1)>';
   await page.locator('#setup-name').fill(name);
   // Name has a forty-character limit; the live greeting must still be literal text.
   const saved=await page.locator('#setup-name').inputValue();
   assert.equal(await page.locator('#private-greeting').textContent(),'Hello, '+saved);
   assert.equal(await page.locator('#private-greeting img').count(),0);
   await page.locator('#setup-next').click();
   await page.locator('#setup-demo').click();
   await page.locator('#setup-next').click();
   assert.equal(await page.locator('#setup-dialog').evaluate(d=>d.matches(':modal')),false);
   await page.getByRole('button',{name:'Pause & cancel',exact:true}).click();
   assert.equal(await page.locator('[data-tab="control"].setup-highlight').count(),1);
   await page.screenshot({path:`${out}/tour-${width}.png`});
   await page.locator('#setup-next').click();
   assert.match(await page.locator('#setup-content').textContent(),/computer/);
   await page.locator('#setup-next').click();
   await page.locator('#setup-next').click();
   await page.evaluate(()=>showTab('modules'));
   await page.locator('#private-delete').click();
   assert.equal(await page.evaluate(()=>localStorage.getItem('dejavu1.private-name')),null);
   await page.locator('#setup-replay').click();
   await page.keyboard.press('Escape');
   assert.equal(await page.locator('#setup-dialog').evaluate(d=>d.open),false);
   await page.keyboard.press('Control+k');
   await page.locator('#feature-search').fill('camera');
   await page.locator('#feature-results button').click();
   assert.equal(await page.locator('.stock-camera').evaluate(d=>d.open),true);
   await page.locator('#camera-open').scrollIntoViewIfNeeded();
   await page.evaluate(()=>{showTab('overview');window.scrollTo(0,0);});
   await page.waitForTimeout(1200);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:`${out}/after-demo-${width}.png`});
   // Match the original empty-state screenshots, with demo switched off.
   if(await page.locator('#demo-toggle').isChecked())await page.locator('label[for="demo-toggle"]').click();
   await page.waitForTimeout(1200);
   assert.equal(await page.locator('#attention').isVisible(),false);
   assert.equal(await page.locator('#twin-sub').textContent(),'Waiting for a printer connection');
   await page.screenshot({path:`${out}/after-${width}.png`});
   const mesh=await page.evaluate(()=>{
    const obj=new TextEncoder().encode('v 0 0 0\nv 10 0 0\nv 0 20 0\nf -3 -2 -1\n');
    const original=DV3D.parseOBJ(obj.buffer),scaled=DV3D.transformMesh(original,2,'x');
    const roundtrip=DV3D.parseSTL(DV3D.exportSTL(scaled));
    let refused=false;try{DV3D.parseOBJ(new TextEncoder().encode('v 0 0 0\nf 1 1 1 1').buffer);}catch(_){refused=true;}
    return {original:original.size,scaled:scaled.size,restored:roundtrip.size,refused};
   });
   assert.deepEqual(mesh.original,[10,20,0]);assert.deepEqual(mesh.scaled,[20,0,40]);
   assert.deepEqual(mesh.restored,mesh.scaled);assert(mesh.refused);
   assert(!requests.some(r=>r.includes('PRIVACY_SENTINEL')),'Private name leaked in a request');
   result.checks.push({width,nameEscaped:true,nameDeleted:true,nameAbsentFromRequests:true,tourReplay:true,keyboard:true,search:true,overflow:false,mesh});
   // Measure regular animation, separately from reduced-motion accessibility checks.
   await page.emulateMedia({reducedMotion:'no-preference'});
   const frames=await page.evaluate(()=>new Promise(resolve=>{let prev,values=[];function frame(now){if(prev)values.push(now-prev);prev=now;if(values.length<120)requestAnimationFrame(frame);else{values.sort((a,b)=>a-b);resolve({mean:values.reduce((a,b)=>a+b)/values.length,p95:values[Math.floor(values.length*.95)]});}}requestAnimationFrame(frame);}));
   result.frames.push({width,...frames});
   await page.evaluate(()=>navigator.serviceWorker.ready);
   await context.setOffline(true);
   await page.goto(base+'/?offline-check');
   assert.match(await page.locator('h1').textContent(),/out of reach/);
   result.checks.push({width,offlineExplanation:true});
   await context.close();
  }
  assert.deepEqual(result.errors,[]);
 } finally {fs.writeFileSync(out+'/browser-results.json',JSON.stringify(result,null,2));await browser.close();}
 console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;});
