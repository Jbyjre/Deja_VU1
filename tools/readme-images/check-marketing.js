// Check the shipped product page and recorded demo using files from this checkout.
// No app server or external website is required.
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'../../frontend');
const out=path.resolve(process.argv[2]||'/tmp/dejavu-marketing-review');
const origin='http://127.0.0.1:8797';
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.DEJAVU_BROWSER||'/usr/bin/chromium',args:['--no-sandbox']});
 const results={widths:[],errors:[],failedAssets:[]};
 try{
  for(const width of [1366,390]){
   const ctx=await browser.newContext({viewport:{width,height:width===390?844:900},reducedMotion:'reduce'});
   await ctx.route(origin+'/**',async route=>{
    const url=new URL(route.request().url());
    const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:'Not found'});
    await route.fulfill({path:file});
   });
   const p=await ctx.newPage();
   p.on('pageerror',e=>results.errors.push(e.message));
   p.on('response',r=>{if(r.url().includes('/img/')&&r.status()!==200)results.failedAssets.push(r.url());});
   await p.goto(origin+'/welcome.html');
   await p.evaluate(async()=>{await document.fonts.ready;for(const img of document.images){img.loading='eager';await img.decode();}});
   assert.equal(await p.locator('h1').count(),1);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Product page overflow');
   const anchors=await p.locator('a[href^="#"]').evaluateAll(as=>as.map(a=>a.getAttribute('href')).filter(h=>h.length>1));
   for(const hash of anchors)assert.equal(await p.locator(hash).count(),1,'Missing section '+hash);
   for(const img of await p.locator('img').all()){
    assert((await img.getAttribute('alt')||'').length>10,'Image needs a useful alternative');
    assert(await img.evaluate(i=>i.naturalWidth>0),'Image missing');
   }
   await p.screenshot({path:path.join(out,'product-top-'+width+'.png')});
   await p.locator('#inside-title').scrollIntoViewIfNeeded();
   await p.screenshot({path:path.join(out,'product-workspace-'+width+'.png')});
   await p.locator('#honest-title').scrollIntoViewIfNeeded();
   await p.screenshot({path:path.join(out,'product-status-'+width+'.png')});
   await p.locator('#top').scrollIntoViewIfNeeded();
   await p.locator('.hero-cta a').first().click();
   await p.waitForFunction(()=>typeof tourOn==='function'&&tourOn());
   if(await p.locator('#setup-skip').isVisible())await p.locator('#setup-skip').click();
   await p.evaluate(()=>showTab('overview'));
   await p.locator('#attention').waitFor();
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Demo overflow');
   await p.screenshot({path:path.join(out,'demo-'+width+'.png')});
   results.widths.push({width,imagesLoaded:true,sectionLinks:true,demoCTA:true,overflow:false});
   await ctx.close();
  }
  assert.deepEqual(results.errors,[]);assert.deepEqual(results.failedAssets,[]);
 }finally{await browser.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2)+'\n');}
 console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1});
