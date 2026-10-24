// Renders the README explainer boards and the social card from the HTML in
// this folder. Needs Playwright with a Chromium (not a dependency of
// Deja Vu1 itself). Run from the repository root:
//   node tools/readme-images/render.js
// Writes PNGs into tools/readme-images/out/; resize and copy them as
// described in README.md in this folder.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const here = __dirname;
const out = path.join(here, 'out');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({executablePath:process.env.DEJAVU_BROWSER||'/usr/bin/chromium',args:['--no-sandbox']});
  try {
  // Fulfil loopback requests from disk: managed browsers can block file://.
  // No listening socket or application/demo server is needed.
  const root=path.resolve(here,'../..'),origin='http://127.0.0.1:8794';
  async function localPage(viewport,deviceScaleFactor=1){
    const context=await browser.newContext({viewport,deviceScaleFactor});
    await context.route(origin+'/**',async route=>{
      const file=path.resolve(root,'.'+decodeURIComponent(new URL(route.request().url()).pathname));
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.abort();
      await route.fulfill({path:file});
    });
    return context.newPage();
  }
  if(!process.argv.includes('--campaign')){
  const page = await localPage({ width: 1200, height: 900 },4/3);
  await page.goto(origin+'/tools/readme-images/boards.html');
  await page.evaluate(() => document.fonts.ready);
  for (const id of ['b-problem', 'b-confirm', 'b-arch', 'b-features', 'b-numbers']) {
    await page.locator('#' + id).screenshot({ path: path.join(out, id + '.png') });
    await page.locator('#' + id).screenshot({ path: path.join(out, id + '.jpg'),type:'jpeg',quality:90 });
    console.log('wrote', id + '.png');
  }
  const vision=await page.context().newCDPSession(page);
  for(const type of ['protanopia','deuteranopia','tritanopia']){
    await vision.send('Emulation.setEmulatedVisionDeficiency',{type});
    await page.locator('#b-features').screenshot({path:path.join(out,'palette-'+type+'.png')});
  }
  await vision.send('Emulation.setEmulatedVisionDeficiency',{type:'none'});
  }
  for (const [w, h] of [[1200, 630], [1280, 640]]) {
    const card = await localPage({ width: w, height: h });
    await card.goto(origin+'/tools/readme-images/card.html'+`?w=${w}&h=${h}`);
    await card.waitForFunction(()=>window.cardReady===true);
    await card.screenshot({ path: path.join(out, `card-${w}x${h}.png`) });
    console.log(`wrote card-${w}x${h}.png`);
  }
  const cards=JSON.parse(fs.readFileSync(path.join(here,'campaign.json'),'utf8'));
  const results=[];
  for(const [shape,width,height] of [['landscape',1600,900],['square',1080,1080],['portrait',1080,1350],['feed',1200,628]]){
    const p=await localPage({width,height});
    for(const card of cards){
      await p.goto(origin+'/tools/readme-images/campaign.html?id='+card.id);
      await p.waitForFunction(()=>window.cardReady===true);
      const issues=await p.evaluate(()=>{
        const errors=[];
        for(const id of ['title','body','evidence','limit','cta']){
          const e=document.getElementById(id),r=e.getBoundingClientRect();
          if(r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight)errors.push(id+' outside image');
        }
        if(document.documentElement.scrollHeight>innerHeight||document.documentElement.scrollWidth>innerWidth)errors.push('overflow');
        const img=document.getElementById('image');if(!img.naturalWidth)errors.push('missing image');
        const proof=document.querySelector('.proof').getBoundingClientRect(),foot=document.querySelector('footer').getBoundingClientRect();
        if(proof.bottom>foot.top-5)errors.push('evidence overlaps action');
        if(document.getElementById('body').getBoundingClientRect().bottom>proof.top-12)errors.push('body overlaps evidence');
        const cta=document.getElementById('cta').getBoundingClientRect(),destination=document.getElementById('destination').getBoundingClientRect();
        if(cta.right>destination.left-10)errors.push('action overlaps destination');
        const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);
        const luminance=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
        for(const selector of ['#title','#title .accent','#body','#evidence','#limit','#cta','#destination','.edition']){
          const e=document.querySelector(selector),fg=rgb(getComputedStyle(e).color);
          let parent=e,bg;
          while(parent){const value=getComputedStyle(parent).backgroundColor;if(value!=='rgba(0, 0, 0, 0)'&&value!=='transparent'){bg=rgb(value);break}parent=parent.parentElement;}
          if(!bg)bg=[7,17,31];
          const a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
          if(ratio<(selector.startsWith('#title')?3:4.5))errors.push(selector+' palette contrast '+ratio.toFixed(2));
        }
        return errors;
      });
      if(issues.length)throw new Error(card.id+' '+shape+': '+issues.join(', '));
      const file=card.id+'-'+shape+'.png';
      await p.screenshot({path:path.join(out,file)});
      const bytes=fs.statSync(path.join(out,file)).size;
      if(bytes>5_000_000)throw new Error(file+' exceeds the reviewed 5 MB feed limit');
      results.push({file,width,height,bytes,alt:card.alt,caption:card.caption,evidence:card.evidence,limit:card.limit,
        stage:card.stage,purpose:card.purpose,primaryText:card.primaryText});
      console.log('wrote '+file);
    }
    await p.context().close();
  }
  fs.writeFileSync(path.join(out,'campaign-manifest.json'),JSON.stringify(results,null,2)+'\n');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
