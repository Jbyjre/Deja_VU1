/* Developer-only comparison against our own previous viewer. No app dependency.
   node tools/benchmark-viewer.js OUTPUT_JSON [BASE_COMMIT] */
const fs=require('fs'),{execFileSync}=require('child_process'),{chromium}=require('playwright');
(async()=>{
 const before=execFileSync('git',['show',(process.argv[3]||'15e6a41')+':frontend/viewer3d.js'],{encoding:'utf8'}),after=fs.readFileSync('frontend/viewer3d.js','utf8');
 const browser=await chromium.launch({executablePath:process.env.DEJAVU_BROWSER||'/usr/bin/chromium',args:['--no-sandbox']});const rows=[];
 try{for(const width of [1366,390])for(const [version,code] of [['before',before],['after',after]]){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.setContent('<canvas style="width:'+Math.min(900,width-32)+'px;height:420px"></canvas>');
  await page.addScriptTag({content:code+'\nwindow.BenchmarkViewer=DV3D.Viewer;'});
  const data=await page.evaluate(async()=>{
   const v=new BenchmarkViewer(document.querySelector('canvas')),gl=v.gl;
   const n=200000,pos=new Float32Array(n*9),normals=new Float32Array(n*9);
   for(let i=0;i<n;i++){const x=(i%500)*.2,y=Math.floor(i/500)*.2,z=10+Math.sin(x)*2;pos.set([x,y,z,x+.18,y,z,x,y+.18,z],i*9);normals.set([0,0,1,0,0,1,0,0,1],i*9);}
   const stats=values=>{values.sort((a,b)=>a-b);return {meanMs:values.reduce((a,b)=>a+b,0)/values.length,p95Ms:values[Math.floor(values.length*.95)]};};
   const frames=async count=>{const times=[],intervals=[];let previous;for(let i=0;i<count;i++){v.yaw+=.01;const start=performance.now();v.render();gl.finish();times.push(performance.now()-start);const now=await new Promise(requestAnimationFrame);if(previous!==undefined)intervals.push(now-previous);previous=now;}return {renderCall:stats(times),animationFrame:stats(intervals)};};
   let start=performance.now();v.setMesh({positions:pos,normals,bounds:{min:[0,0,8],max:[100,80,12]},size:[100,80,4]},'#ff8822');gl.finish();const meshUploadMs=performance.now()-start;
   await frames(3);const meshFrames=await frames(30);
   const segments=Array.from({length:60000},(_,i)=>[i%250,Math.floor(i/250),.2+i/10000,i%250+.5,Math.floor(i/250)+.5,.2+i/10000,i%4,i%2]);
   start=performance.now();v.setToolpath(segments,['#000000','#ffffff','#ff0000','#0000ff']);gl.finish();const toolpathUploadMs=performance.now()-start;
   await frames(2);const toolpathFrames=await frames(60),error=gl.getError();const debug=gl.getExtension('WEBGL_debug_renderer_info'),renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);return {renderer,triangles:n,segments:segments.length,meshUploadMs,meshFrames,toolpathUploadMs,toolpathFrames,webglError:error};
  });rows.push({width,version,...data});await page.close();
 }}finally{await browser.close();}
 const result={method:'Chromium cloud browser: timed render calls including gl.finish and requestAnimationFrame intervals, after warm-up. Same generated geometry and viewport before/after; 30 mesh frames and 60 toolpath frames. Viewports simulate sizes, not physical phones.',baseline:process.argv[3]||'15e6a41',rows};fs.writeFileSync(process.argv[2]||'/tmp/dejavu-evidence/performance-comparison.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1});
