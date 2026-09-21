/* Deja Vu1 dashboard logic.
 *
 * Asks the Python backend for data and draws it. Plain JavaScript — no
 * framework, no build step, nothing to install.
 *
 * The important rule here: with no printer connected, the backend returns no
 * figures at all. The dashboard shows empty states until the user explicitly
 * turns on demo data, which adds ?demo=1 to every request. Simulated numbers
 * are always badged as such.
 */

/* ---- small helpers ----------------------------------------------------- */

/* Arcade Plus: authoritative offline arcade runtime. Installed after legacy declarations
   Compatibility aliases keep the delayed picker installer safe while the legacy
   declarations remain below this offline-only block. */
const newPacmanPlus = newPacmanArcade;
const newDoodleBreak = newBreakoutDeep;
/* Arcade Plus: authoritative offline arcade runtime. Installed after legacy declarations
   so the public picker has one clean dispatch path and one cleanup owner. */
let plusStop=()=>{};
function plusTools(){const events=[],timers=[];const on=(t,n,f,o)=>{t.addEventListener(n,f,o);events.push(()=>t.removeEventListener(n,f,o));};const every=(f,m)=>{const id=setInterval(f,m);timers.push(id);return id;};plusStop=()=>{events.splice(0).forEach(f=>f());timers.splice(0).forEach(id=>{clearInterval(id);clearTimeout(id);});plusStop=()=>{};};return{on,every};}
function plusFrame(title,help,body,tools){$('game-host').innerHTML=gameShellV2(title,help,body);gameFullscreenV2($('game-host'),tools);}
function plusStats(items){gameStats(items.map(([k,id,a,v])=>`<div class="game-stat"><div class="g-key">${k}</div><div class="g-val ${a?'accent':''}" id="${id}">${v??'0'}</div></div>`).join(''));}
function newFreeCell(){const t=plusTools(),key='dejavu1.freecell.best';plusStats([['Score','fc-score'],['Moves','fc-moves'],['Best','fc-best',true,gameBestV2(key)||'—']]);plusFrame('FreeCell','Click a face-up card, then a destination · A auto-moves a safe card',`<div class="freecell" id="fc-board"><div class="fc-top"><div class="fc-pockets" id="fc-free"></div><div class="fc-foundations" id="fc-found"></div></div><div class="fc-tableau" id="fc-tableau"></div><div class="fc-footer"><button class="btn" id="fc-new">New deal</button><button class="btn" id="fc-auto">Auto move</button><span id="fc-message">Build each suit from ace to king.</span></div></div>`,t);const suits=['♠','♥','♦','♣'],red=new Set(['♥','♦']),ranks=['','A','2','3','4','5','6','7','8','9','10','J','Q','K'];let cols,free,founds,selected,moves,score;const color=c=>red.has(c.s)?'red':'black',label=c=>ranks[c.n]+c.s,shuffle=a=>{for(let i=a.length-1;i;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;},msg=(x,g)=>{$('fc-message').textContent=x;$('fc-message').classList.toggle('good',!!g);};const valid=(p,i)=>p.slice(i).every((c,j,r)=>!j||r[j-1].n===c.n+1&&color(r[j-1])!==color(c));function deal(){const d=shuffle(suits.flatMap(s=>Array.from({length:13},(_,i)=>({s,n:i+1} ))));cols=Array.from({length:8},()=>[]);d.forEach((c,i)=>cols[i%8].push(c));free=[null,null,null,null];founds=suits.map(()=>[]);selected=null;moves=score=0;msg('Build each suit from ace to king.');draw();}const canCol=(c,i)=>{const top=cols[i].at(-1);return top?top.n===c.n+1&&color(top)!==color(c):c.n===13;};const canFound=(c,i)=>{const top=founds[i].at(-1);return c.s===suits[i]&&(top?top.n+1===c.n:c.n===1);};function move(to){if(!selected)return false;const s=selected,card=s.card;let ok=false;if(to.kind==='free'&&s.kind==='column'&&free[to.i]===null&&s.row===cols[s.col].length-1){cols[s.col].pop();free[to.i]=card;ok=true;}else if(to.kind==='column'&&s.kind==='column'&&to.i!==s.col&&valid(cols[s.col],s.row)&&cols[s.col].length-s.row<=Math.max(1,free.filter(Boolean).length+cols.filter(c=>!c.length).length)&&canCol(card,to.i)){cols[to.i].push(...cols[s.col].splice(s.row));ok=true;}else if(to.kind==='column'&&s.kind==='free'&&canCol(card,to.i)){free[s.slot]=null;cols[to.i].push(card);ok=true;}else if(to.kind==='foundation'&&canFound(card,to.i)&&((s.kind==='column'&&s.row===cols[s.col].length-1)||s.kind==='free')){s.kind==='column'?cols[s.col].pop():free[s.slot]=null;founds[to.i].push(card);score+=card.n===1?10:5;ok=true;}if(!ok)return false;selected=null;moves++;if(founds.every(p=>p.length===13)){score+=500;const best=Math.max(gameBestV2(key),score);saveBest(key,best);$('fc-best').textContent=best;msg(`Complete in ${moves} moves · ${score} points`,true);}draw();return true;}function select(card,kind,a,b){if(selected&&move(kind==='column'?{kind:'column',i:a}:{kind:'foundation',i:a}))return;selected=kind==='column'?{card,kind,col:a,row:b}:{card,kind,slot:a};draw();}function auto(){for(let c=0;c<cols.length;c++){const card=cols[c].at(-1),i=suits.indexOf(card?.s);if(card&&canFound(card,i)){selected={card,kind:'column',col:c,row:cols[c].length-1};move({kind:'foundation',i});return;}}for(let i=0;i<4;i++){const card=free[i],f=suits.indexOf(card?.s);if(card&&canFound(card,f)){selected={card,kind:'free',slot:i};move({kind:'foundation',i:f});return;}}msg('No safe auto-move found.');}function draw(){const fh=$('fc-free');fh.innerHTML='';free.forEach((c,i)=>{const b=document.createElement('button');b.className='fc-slot';b.textContent=c?label(c):'FREE';b.onclick=()=>c?select(c,'free',i):move({kind:'free',i});fh.appendChild(b);});const f=$('fc-found');f.innerHTML='';founds.forEach((p,i)=>{const b=document.createElement('button');b.className='fc-slot foundation';b.textContent=p.at(-1)?label(p.at(-1)):suits[i];b.onclick=()=>move({kind:'foundation',i});f.appendChild(b);});const th=$('fc-tableau');th.innerHTML='';cols.forEach((p,c)=>{const col=document.createElement('div');col.className='fc-column';p.forEach((card,i)=>{const b=document.createElement('button');b.className=`fc-card up ${color(card)} ${selected?.card===card?'selected':''}`;b.textContent=label(card);b.style.top=`${i*22}px`;b.onclick=()=>select(card,'column',c,i);col.appendChild(b);});const drop=document.createElement('button');drop.className='fc-drop';drop.textContent='K';drop.onclick=()=>move({kind:'column',i:c});col.appendChild(drop);th.appendChild(col);});$('fc-score').textContent=score;$('fc-moves').textContent=moves;}t.on($('fc-new'),'click',deal);t.on($('fc-auto'),'click',auto);t.on(document,'keydown',e=>{if(e.key.toLowerCase()==='a')auto();});deal();}
function newSnake(){const t=plusTools(),key='dejavu1.snake.best',W=480,N=20,S=24;plusStats([['Score','sn-score'],['Length','sn-length'],['Best','sn-best',true,gameBestV2(key)||'—']]);plusFrame('Snake','Arrow keys / WASD · swipe · speed rises every five apples',`<div class="snake-wrap"><canvas id="sn-canvas" class="arcade-canvas" width="480" height="480"></canvas><div class="snake-actions"><button class="btn primary" id="sn-start">Start run</button><button class="btn" id="sn-pause">Pause</button></div></div>`,t);const c=$('sn-canvas'),x=c.getContext('2d');let snake,dir,next,food,score,run,paused,timer,swipe;const same=(a,b)=>a.x===b.x&&a.y===b.y,place=()=>{let p;do{p={x:Math.floor(Math.random()*N),y:Math.floor(Math.random()*N)}}while(snake.some(s=>same(s,p)));return p;};function start(){clearInterval(timer);snake=[{x:10,y:10},{x:9,y:10},{x:8,y:10}];dir={x:1,y:0};next={...dir};food=place();score=0;run=true;paused=false;timer=t.every(tick,145);draw();}function change(a,b){if(a===-dir.x&&b===-dir.y)return;next={x:a,y:b};if(!run)start();}function tick(){if(!run||paused)return;dir=next;const h={x:(snake[0].x+dir.x+N)%N,y:(snake[0].y+dir.y+N)%N};if(snake.some((s,i)=>i&&same(s,h))){run=false;clearInterval(timer);const best=Math.max(gameBestV2(key),score);saveBest(key,best);$('sn-best').textContent=best;draw();return;}snake.unshift(h);if(same(h,food)){score++;food=place();if(score%5===0){clearInterval(timer);timer=t.every(tick,Math.max(70,145-score*3));}}else snake.pop();draw();}function draw(){x.fillStyle='#091525';x.fillRect(0,0,W,W);x.strokeStyle='rgba(255,255,255,.05)';for(let i=1;i<N;i++){x.beginPath();x.moveTo(i*S,0);x.lineTo(i*S,W);x.moveTo(0,i*S);x.lineTo(W,i*S);x.stroke();}x.fillStyle='#ffcf66';x.beginPath();x.arc(food.x*S+12,food.y*S+12,7,0,7);x.fill();snake?.forEach((s,i)=>{x.fillStyle=i?'#56c982':'#b9f29a';x.fillRect(s.x*S+3,s.y*S+3,S-6,S-6);});$('sn-score').textContent=score;$('sn-length').textContent=snake?.length||0;}t.on(document,'keydown',e=>{const d={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0],KeyW:[0,-1],KeyS:[0,1],KeyA:[-1,0],KeyD:[1,0]}[e.code];if(d){e.preventDefault();change(...d);}if(e.code==='Space'){e.preventDefault();paused=!paused;}});t.on(c,'pointerdown',e=>{swipe={x:e.clientX,y:e.clientY};});t.on(c,'pointerup',e=>{if(!swipe)return;const dx=e.clientX-swipe.x,dy=e.clientY-swipe.y;if(Math.max(Math.abs(dx),Math.abs(dy))>20)change(Math.abs(dx)>Math.abs(dy)?Math.sign(dx):0,Math.abs(dy)>=Math.abs(dx)?Math.sign(dy):0);swipe=null;});t.on($('sn-start'),'click',start);t.on($('sn-pause'),'click',()=>paused=!paused);start();}
function new2048(){const t=plusTools(),key='dejavu1.2048.best';plusStats([['Score','tw-score'],['Best','tw-best',true,gameBestV2(key)||'—'],['Goal','tw-goal',false,'2048']]);plusFrame('2048','Arrow keys / swipe · combine equal tiles · reach 2048',`<div class="twenty-wrap"><div class="twenty-board" id="tw-board"></div><div class="twenty-actions"><button class="btn" id="tw-new">New game</button><button class="btn" id="tw-undo">Undo</button><span id="tw-message">Make your first move.</span></div></div>`,t);let board,score,previous,won,over,startPoint;const idx=(r,c)=>r*4+c,add=()=>{const p=board.map((v,i)=>v?null:i).filter(i=>i!==null);if(p.length){const i=p[Math.floor(Math.random()*p.length)];board[i]=Math.random()<.9?2:4;}},line=a=>{const v=a.filter(Boolean),o=[];for(let i=0;i<v.length;i++){if(v[i]===v[i+1]){o.push(v[i]*2);score+=v[i]*2;i++;}else o.push(v[i]);}return o.concat([0,0,0,0]).slice(0,4);};function fresh(){board=Array(16).fill(0);score=0;previous=null;won=over=false;add();add();draw();}function move(d){if(over)return;const before=board.slice(),old=score,out=Array(16).fill(0);for(let r=0;r<4;r++){let a=d==='up'||d==='down'?[0,1,2,3].map(c=>board[idx(c,r)]):board.slice(r*4,r*4+4);if(d==='right'||d==='down')a.reverse();a=line(a);if(d==='left'||d==='right')a.forEach((v,c)=>out[idx(r,d==='left'?c:3-c)]=v);else a.forEach((v,c)=>out[idx(d==='up'?c:3-c,r)]=v);}if(out.every((v,i)=>v===before[i])){score=old;return;}previous={board:before,score:old,won,over};board=out;add();if(board.some(v=>v>=2048)&&!won){won=true;$('tw-message').textContent='2048 reached — keep going.';}if(board.every(Boolean)&&!board.some((v,i)=>{const r=Math.floor(i/4),c=i%4;return c<3&&v===board[i+1]||r<3&&v===board[i+4];})){over=true;const best=Math.max(gameBestV2(key),score);saveBest(key,best);$('tw-best').textContent=best;$('tw-message').textContent='No moves left — start a new board.';}draw();}function draw(){const h=$('tw-board');h.innerHTML='';board.forEach(v=>{const e=document.createElement('div');e.className=`tw-tile t${v?Math.min(15,Math.log2(v)):0}`;e.textContent=v||'';h.appendChild(e);});$('tw-score').textContent=score;}t.on(document,'keydown',e=>{const d={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[e.key];if(d){e.preventDefault();move(d);}});t.on($('tw-new'),'click',fresh);t.on($('tw-undo'),'click',()=>{if(previous){board=previous.board;score=previous.score;won=previous.won;over=previous.over;previous=null;$('tw-message').textContent='Move undone.';draw();}});t.on($('tw-board'),'pointerdown',e=>{startPoint={x:e.clientX,y:e.clientY};});t.on($('tw-board'),'pointerup',e=>{if(!startPoint)return;const dx=e.clientX-startPoint.x,dy=e.clientY-startPoint.y;if(Math.max(Math.abs(dx),Math.abs(dy))>20)move(Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up');startPoint=null;});t.on(document,'pointercancel',()=>{startPoint=null;});fresh();}
function newSmartPong(){const t=plusTools(),key='dejavu1.pong.smart.best',W=760,H=420,host=$('game-host');plusStats([['You','sp-you'],['CPU','sp-cpu'],['Rally','sp-rally'],['Best','sp-best',true,gameBestV2(key)||'—']]);plusFrame('Pong','Move with mouse, touch, or ↑↓ · first to 7 · edge hits create sharper angles',`<div class="smart-pong"><canvas id="sp-canvas" class="arcade-canvas" width="760" height="420"></canvas><div class="pong-pad"><button class="btn" data-pong="up">▲</button><button class="btn" data-pong="down">▼</button></div><div class="game-overlay" id="sp-overlay"><div class="g-title">PONG</div><div class="g-sub">The CPU reads the ball, but its reaction window gets shorter as the rally grows.</div><button class="btn primary">Serve</button></div></div>`,t);const c=$('sp-canvas'),x=c.getContext('2d');let py=H/2-46,ay=py,ball,you=0,cpu=0,rally=0,run=false,timer,keys={};const reset=()=>{py=H/2-46;ay=py;ball={x:W/2,y:H/2,vx:5,vy:(Math.random()-.5)*4};you=cpu=rally=0;run=true;$('sp-overlay').style.display='none';clearInterval(timer);timer=t.every(tick,16);draw();};const predictY=()=>{if(!ball||ball.vx<=0)return H/2;const targetX=W-42,travel=Math.max(0,(targetX-ball.x)/ball.vx),top=9,bottom=H-9,span=bottom-top,period=span*2;let projected=ball.y+ball.vy*travel;const folded=((projected-top)%period+period)%period;return folded<=span?top+folded:bottom-(folded-span);};
  const chooseTarget=()=>{if(!ball||ball.vx<=0)return H/2-46;const intercept=predictY(),edgeBias=Math.max(-1,Math.min(1,ball.vy/6))*Math.min(18,rally*.7),rallyRead=Math.min(14,rally*.35),noise=(Math.random()-.5)*Math.max(1.2,4.5-rally*.12);return intercept-46+edgeBias+rallyRead+noise;};const serve=d=>{ball={x:W/2,y:H/2,vx:d*(5+Math.min(3,rally*.12)),vy:(Math.random()-.5)*4};};function point(won){won?you++:cpu++;rally=0;if(you>=7||cpu>=7){run=false;clearInterval(timer);const best=Math.max(gameBestV2(key),you);saveBest(key,best);$('sp-best').textContent=best;$('sp-overlay').innerHTML=`<div class="g-title">${you>cpu?'MATCH WON':'MATCH LOST'}</div><div class="g-sub">${you} — ${cpu}</div><button class="btn primary">Rematch</button>`;$('sp-overlay').style.display='flex';}else serve(won?1:-1);}function steer(e){const r=c.getBoundingClientRect();py=Math.max(0,Math.min(H-92,(e.clientY-r.top)/r.height*H-46));}function tick(){if(!run)return;if(keys.ArrowUp||keys.KeyW)py=Math.max(0,py-6);if(keys.ArrowDown||keys.KeyS)py=Math.min(H-92,py+6);ball.x+=ball.vx;ball.y+=ball.vy;if(ball.y<9||ball.y>H-9){ball.y=Math.max(9,Math.min(H-9,ball.y));ball.vy*=-1;}const target=ball.vx>0?chooseTarget():H/2-46;const closing=Math.max(0,Math.min(1,(W-150-ball.x)/Math.max(1,W-150)));const reaction=Math.min(.24,.13+rally*.002+closing*.045);const maxStep=5.2+Math.min(2.4,rally*.08);const error=Math.max(.025,.18-rally*.004);const delta=target-ay;ay+=Math.max(-maxStep,Math.min(maxStep,delta))*reaction+(Math.random()-.5)*error;ay=Math.max(0,Math.min(H-92,ay));if(ball.x<42&&ball.x>22&&ball.y>py-8&&ball.y<py+100&&ball.vx<0){ball.x=42;const hit=(ball.y-(py+46))/46;ball.vx=Math.min(11,Math.abs(ball.vx)*1.04);ball.vy=hit*5.7;rally++;}if(ball.x>W-42&&ball.x<W-22&&ball.y>ay-8&&ball.y<ay+100&&ball.vx>0){ball.x=W-42;const hit=(ball.y-(ay+46))/46;ball.vx=-Math.min(11,Math.abs(ball.vx)*1.04);ball.vy=hit*5.7;rally++;}if(ball.x<-20)point(false);if(ball.x>W+20)point(true);draw();}function draw(){x.fillStyle='#101827';x.fillRect(0,0,W,H);x.setLineDash([8,12]);x.strokeStyle='rgba(255,255,255,.16)';x.beginPath();x.moveTo(W/2,0);x.lineTo(W/2,H);x.stroke();x.setLineDash([]);x.fillStyle='#f7fbff';x.fillRect(22,py,16,92);x.fillStyle='#ff9c66';x.fillRect(W-38,ay,16,92);x.fillStyle='#ffe69b';x.beginPath();x.arc(ball?.x||W/2,ball?.y||H/2,8,0,7);x.fill();$('sp-you').textContent=you;$('sp-cpu').textContent=cpu;$('sp-rally').textContent=rally;}t.on(c,'pointermove',steer);t.on(c,'pointerdown',e=>{steer(e);if(!run)reset();});t.on(document,'keydown',e=>{if(['ArrowUp','ArrowDown','KeyW','KeyS'].includes(e.code))e.preventDefault();keys[e.code]=true;});t.on(document,'keyup',e=>{keys[e.code]=false;});t.on(host.querySelector('.game-overlay button'),'click',reset);document.querySelectorAll('[data-pong]').forEach(b=>t.on(b,'pointerdown',()=>{keys[b.dataset.pong==='up'?'ArrowUp':'ArrowDown']=true;}));document.querySelectorAll('[data-pong]').forEach(b=>t.on(b,'pointerup',()=>{keys[b.dataset.pong==='up'?'ArrowUp':'ArrowDown']=false;}));t.on(document,'pointerup',()=>{keys.ArrowUp=false;keys.ArrowDown=false;});t.on(document,'pointercancel',()=>{keys.ArrowUp=false;keys.ArrowDown=false;});reset();}
function newPacmanLegacy(){const t=plusTools(),key='dejavu1.pacman.smart.best',map=['###################','#........#........#','#.###.###.#.###.###','#o###.###.#.###.##o','#.................#','#.###.#.#####.#.###','#.....#...#...#...#','#####.# ## ## #.#####','#........#........#','#####.# ## ## #.#####','#.........#.........#','#.###.#.#####.#.###','#o..#.....#.....#..o#','###.#.#.#####.#.#.###','#.....#...#...#.....#','#.######## ########.#','###################'];const rows=map.length,cols=21,cell=27,W=567,H=459;plusStats([['Score','pp-score'],['Lives','pp-lives'],['Level','pp-level'],['Best','pp-best',true,gameBestV2(key)||'—']]);plusFrame('Pac-Man','WASD / arrows · use the arrow pad · eat dots, then hunt frightened ghosts',`<div class="pac-wrap"><canvas id="pp-canvas" class="arcade-canvas" width="570" height="510"></canvas><div class="pac-pad"><button class="btn" data-pac="up">▲</button><button class="btn" data-pac="left">◀</button><button class="btn" data-pac="down">▼</button><button class="btn" data-pac="right">▶</button></div><div class="game-overlay" id="pp-overlay"><div class="g-title">PAC-MAN</div><div class="g-sub">Four ghosts use different chase targets. Power pellets reverse the hunt.</div><button class="btn primary">Start chase</button></div></div>`,t);const c=$('pp-canvas'),x=c.getContext('2d'),dirs={left:[0,-1],right:[0,1],up:[-1,0],down:[1,0]};let grid,player,ghosts,score,lives,level,power,run,timer,wanted='left';const walk=(r,col)=>r>=0&&r<rows&&col>=0&&col<cols&&map[r][col]!=='#';const neigh=(r,col)=>['up','left','down','right'].filter(d=>walk(r+dirs[d][0],col+dirs[d][1]));const reset=()=>{grid=map.map(row=>row.split('').map(ch=>ch==='.'||ch==='o'?ch:null));player={r:10,c:1,dir:'left'};ghosts=[{r:8,c:1,dir:'left',color:'#ef5350',mode:'blinky'},{r:8,c:2,dir:'right',color:'#f6a6d5',mode:'pinky'},{r:8,c:3,dir:'up',color:'#55ddea',mode:'inky'},{r:10,c:17,dir:'left',color:'#ffb05a',mode:'clyde'}];score=0;lives=3;level=1;power=0;run=true;$('pp-overlay').style.display='none';clearInterval(timer);timer=t.every(tick,135);draw();};const targetFor=(g)=>g.mode==='blinky'?player:g.mode==='pinky'?{r:player.r+dirs[player.dir][0]*4,c:player.c+dirs[player.dir][1]*4}:g.mode==='inky'?{r:player.r+dirs[player.dir][0]*2,c:player.c+dirs[player.dir][1]*2}:{r:Math.abs(g.r-player.r)+Math.abs(g.c-player.c)>7?player:{r:0,c:0}};const nextStep=(g,target)=>{const q=[{r:g.r,c:g.c}],seen=new Set([`${g.r},${g.c}`]),prev=new Map();while(q.length){const p=q.shift();if(p.r===target.r&&p.c===target.c)break;neigh(p.r,p.c).forEach(d=>{const n={r:p.r+dirs[d][0],c:p.c+dirs[d][1]},k=`${n.r},${n.c}`;if(!seen.has(k)){seen.add(k);prev.set(k,{p,d});q.push(n);}});}let cur={r:Math.max(0,Math.min(rows-1,target.r)),c:Math.max(0,Math.min(cols-1,target.c))};while(prev.has(`${cur.r},${cur.c}`)){const z=prev.get(`${cur.r},${cur.c}`);if(z.p.r===g.r&&z.p.c===g.c)return z.d;cur=z.p;}return g.dir;};function tick(){if(!run)return;const pd=wanted;if(walk(player.r+dirs[pd][0],player.c+dirs[pd][1]))player.dir=pd;if(walk(player.r+dirs[player.dir][0],player.c+dirs[player.dir][1])){player.r+=dirs[player.dir][0];player.c+=dirs[player.dir][1];}const dot=grid[player.r][player.c];if(dot){grid[player.r][player.c]=null;score+=dot==='o'?50:10;if(dot==='o')power=55;}ghosts.forEach(g=>{if(power){const choices=neigh(g.r,g.c);g.dir=choices[Math.floor(Math.random()*choices.length)]||g.dir;}else g.dir=nextStep(g,targetFor(g));if(walk(g.r+dirs[g.dir][0],g.c+dirs[g.dir][1])){g.r+=dirs[g.dir][0];g.c+=dirs[g.dir][1];}if(g.r===player.r&&g.c===player.c){if(power){score+=200;g.r=8;g.c=1;}else{lives--;player={r:10,c:1,dir:'left'};ghosts.forEach((h,i)=>{h.r=8;h.c=1+i;});if(!lives){run=false;clearInterval(timer);const best=Math.max(gameBestV2(key),score);saveBest(key,best);$('pp-best').textContent=best;$('pp-overlay').innerHTML=`<div class="g-title">GAME OVER</div><div class="g-sub">${score} points · level ${level}</div><button class="btn primary">Try again</button>`;$('pp-overlay').style.display='flex';}}}});if(power)power--;if(!grid.flat().some(Boolean)){level++;grid=map.map(row=>row.split('').map(ch=>ch==='.'||ch==='o'?ch:null));player={r:10,c:1,dir:'left'};ghosts.forEach((g,i)=>{g.r=8;g.c=1+i;});}draw();}function draw(){x.fillStyle='#070d1a';x.fillRect(0,0,W,H);for(let r=0;r<rows;r++)for(let col=0;col<cols;col++){if(map[r][col]==='#'){x.fillStyle='#2349ad';x.fillRect(col*cell+2,r*cell+2,cell-4,cell-4);}const v=grid?.[r]?.[col];if(v){x.fillStyle=v==='o'?'#ffdb70':'#f3e7c5';x.beginPath();x.arc(col*cell+15,r*cell+15,v==='o'?7:2,0,7);x.fill();}}const p=player||{r:14,c:9};x.fillStyle='#ffd447';x.beginPath();x.arc(p.c*cell+15,p.r*cell+15,11,0,7);x.fill();ghosts?.forEach(g=>{x.fillStyle=power?'#7190ff':g.color;x.beginPath();x.arc(g.c*cell+15,g.r*cell+15,11,Math.PI,0);x.lineTo(g.c*cell+26,g.r*cell+25);x.lineTo(g.c*cell+20,g.r*cell+20);x.lineTo(g.c*cell+15,g.r*cell+25);x.lineTo(g.c*cell+10,g.r*cell+20);x.lineTo(g.c*cell+4,g.r*cell+25);x.closePath();x.fill();});$('pp-score').textContent=score;$('pp-lives').textContent=lives;$('pp-level').textContent=level;}t.on(document,'keydown',e=>{const d={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',KeyW:'up',KeyS:'down',KeyA:'left',KeyD:'right'}[e.code];if(d){e.preventDefault();wanted=d;}});document.querySelectorAll('[data-pac]').forEach(b=>t.on(b,'pointerdown',()=>{wanted=b.dataset.pac;}));t.on(c,'pointerdown',()=>{if(!run)reset();});t.on($('pp-overlay button'),'click',reset);reset();}
function newBlackjack(){const t=plusTools(),key='dejavu1.blackjack.best',suits=['♠','♥','♦','♣'],ranks=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];plusStats([['Bankroll','bj-bank'],['Shoe','bj-shoe'],['Wins','bj-wins'],['Best','bj-best',true,gameBestV2(key)||'—']]);plusFrame('Blackjack','H hit · S stand · D double · P basic-strategy hint · dealer stands on soft 17',`<div class="blackjack"><div class="bj-table"><div class="bj-hand"><b>DEALER</b><div id="bj-dealer"></div></div><div class="bj-message" id="bj-message">Place your hand.</div><div class="bj-hand"><b>PLAYER</b><div id="bj-player"></div></div></div><div class="bj-controls"><button class="btn primary" id="bj-deal">Deal</button><button class="btn" id="bj-hit">Hit</button><button class="btn" id="bj-stand">Stand</button><button class="btn" id="bj-double">Double</button><button class="btn" id="bj-hint">Hint</button></div></div>`,t);let shoe,hand=[],dealer=[],bank=100,wins=0,wager=10,active=false,doubled=false;const card=()=>{if(shoe.length<24)shoe=freshShoe();return shoe.pop();};const newShoe=()=>suits.flatMap(s=>ranks.map((r,i)=>({s,r,n:Math.min(i+1,10),ace:i===0})));const shuffle=a=>{for(let i=a.length-1;i;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};const freshShoe=()=>shuffle(Array.from({length:6},()=>newShoe()).flat());const value=h=>{let total=h.reduce((n,c)=>n+c.n,0),aces=h.filter(c=>c.ace).length;while(aces&&total+10<=21){total+=10;aces--;}return{total,soft:aces>0};};const face=c=>c.r+c.s;const message=(m,good)=>{$('bj-message').textContent=m;$('bj-message').classList.toggle('good',!!good);};function draw(hole=true){$('bj-player').innerHTML=hand.map(c=>`<span class="bj-card ${c.s==='♥'||c.s==='♦'?'red':''}">${face(c)}</span>`).join('');$('bj-dealer').innerHTML=dealer.map((c,i)=>`<span class="bj-card ${i===1&&hole?'hidden-card':' '}">${i===1&&hole?'?':face(c)}</span>`).join('');$('bj-bank').textContent=bank;$('bj-wins').textContent=wins;$('bj-shoe').textContent=shoe.length;}function finish(){active=false;const p=value(hand).total,d=value(dealer).total,pbj=p===21&&hand.length===2,dbj=d===21&&dealer.length===2;if(p>21){bank-=wager;message('Bust — dealer wins.');}else if(pbj&&!dbj){bank+=wager*1.5;wins++;message('Blackjack — paid 3:2!',true);}else if(dbj&&!pbj){bank-=wager;message('Dealer blackjack.');}else if(d>21||p>d){bank+=wager;wins++;message('You win.',true);}else if(p===d){message('Push — your wager returns.');}else{bank-=wager;message('Dealer wins.');}draw(false);const best=Math.max(gameBestV2(key),bank);saveBest(key,best);$('bj-best').textContent=best;}function dealerTurn(){while(value(dealer).total<17)dealer.push(card());finish();}function deal(){if(bank<=0){bank=100;message('Bankroll reset for a new shoe.');}wager=10;shoe=shoe?.length>24?shoe:freshShoe();hand=[card(),card()];dealer=[card(),card()];doubled=false;active=true;if(value(hand).total===21){message('Blackjack — dealer check.');dealerTurn();}else{message('Your move: hit, stand, or double.');}draw();}function hit(){if(!active)return;hand.push(card());if(value(hand).total>21)finish();else if(value(hand).total===21)dealerTurn();else draw();}function stand(){if(active)dealerTurn();}function dbl(){if(!active||hand.length!==2||bank<wager)return;wager*=2;doubled=true;hit();}function hint(){if(!active)return;const v=value(hand).total,up=dealer[0].n;if(v<=11)message('Basic strategy: hit.');else if(v>=17)message('Basic strategy: stand.');else if(v===12&&up>=4&&up<=6)message('Basic strategy: stand against a weak up-card.');else message(up>=7?'Basic strategy: hit.':'Basic strategy: stand.');}t.on($('bj-deal'),'click',deal);t.on($('bj-hit'),'click',hit);t.on($('bj-stand'),'click',stand);t.on($('bj-double'),'click',dbl);t.on($('bj-hint'),'click',hint);t.on(document,'keydown',e=>{if(e.key.toLowerCase()==='h')hit();if(e.key.toLowerCase()==='s')stand();if(e.key.toLowerCase()==='d')dbl();if(e.key.toLowerCase()==='p')hint();});shoe=freshShoe();draw();}
function newBreakoutLegacy(){const t=plusTools(),key='dejavu1.breakout.doodle.best',W=640,H=430;plusStats([['Score','db-score'],['Level','db-level'],['Lives','db-lives'],['Best','db-best',true,gameBestV2(key)||'—']]);plusFrame('Brick Break','Mouse, touch, or ←→ paddle · angle the rebound · catch powerups and build a combo',`<div class="doodle-break"><canvas id="db-canvas" class="arcade-canvas" width="640" height="430"></canvas><div class="game-overlay" id="db-overlay"><div class="g-title">BRICK BREAK</div><div class="g-sub">A bright, fast doodle-style breakout. Clear the pattern before you run out of lives.</div><button class="btn primary">Launch</button></div></div>`,t);const c=$('db-canvas'),x=c.getContext('2d');let paddle=260,balls,bricks,powers,score,level,lives,combo,run,timer,keys={},pointer=320;const colors=['#ff7a2f','#ffcc66','#65c9ff','#77d68a','#e36bff'];function setup(){bricks=[];const rows=Math.min(4+level,8);for(let r=0;r<rows;r++)for(let col=0;col<10;col++)bricks.push({x:18+col*61,y:36+r*23,w:55,h:17,hp:(r+level>7&&col%3===0)?2:1,max:1});balls=[{x:W/2,y:H-62,vx:3.2+level*.2,vy:-4.6-level*.18,r:7}];powers=[];combo=0;}function start(){score=0;level=1;lives=3;run=true;$('db-overlay').style.display='none';setup();clearInterval(timer);timer=t.every(tick,16);draw();}function hit(){lives--;combo=0;if(lives){balls=[{x:W/2,y:H-62,vx:3.2+level*.2,vy:-4.6-level*.18,r:7}];}else{run=false;clearInterval(timer);const best=Math.max(gameBestV2(key),score);saveBest(key,best);$('db-best').textContent=best;$('db-overlay').innerHTML=`<div class="g-title">RUN OVER</div><div class="g-sub">${score} points · level ${level}</div><button class="btn primary">Play again</button>`;$('db-overlay').style.display='flex';}}function tick(){if(!run)return;const pw=level>3?76:94;if(keys.ArrowLeft||keys.KeyA)paddle=Math.max(paddle-8,0);if(keys.ArrowRight||keys.KeyD)paddle=Math.min(paddle+8,W-pw);paddle=Math.max(0,Math.min(W-pw,pointer-pw/2));balls.forEach(b=>{b.x+=b.vx;b.y+=b.vy;if(b.x<b.r||b.x>W-b.r){b.vx*=-1;b.x=Math.max(b.r,Math.min(W-b.r,b.x));}if(b.y<b.r)b.vy=Math.abs(b.vy);if(b.vy>0&&b.y+b.r>H-34&&b.y<H-18&&b.x>paddle&&b.x<paddle+pw){const hit=(b.x-(paddle+pw/2))/(pw/2);b.vx=hit*6;b.vy=-Math.max(4,Math.hypot(b.vx,b.vy));combo++;}for(const br of bricks){if(!br.hp||b.x+b.r<br.x||b.x-b.r>br.x+br.w||b.y+b.r<br.y||b.y-b.r>br.y+br.h)continue;br.hp--;b.vy*=-1;score+=br.hp?5:10+combo*2;if(!br.hp&&Math.random()<.18)powers.push({x:br.x+br.w/2,y:br.y,kind:Math.random()<.5?'wide':'multi'});break;}});powers.forEach(p=>p.y+=2);powers=powers.filter(p=>{if(p.y>H-42&&p.x>paddle-8&&p.x<paddle+pw+8){if(p.kind==='wide')paddle=Math.max(0,paddle-20);else if(balls.length<3)balls.push({...balls[0],vx:-balls[0].vx});return false;}return p.y<H+20;});if(balls.some(b=>b.y>H+20)){balls=balls.filter(b=>b.y<=H+20);if(!balls.length)hit();}if(bricks.every(b=>!b.hp)){level++;const best=Math.max(gameBestV2(key),level);saveBest(key,best);$('db-best').textContent=best;setup();}draw();}function draw(){x.fillStyle='#101c35';x.fillRect(0,0,W,H);x.fillStyle='rgba(255,255,255,.08)';for(let i=0;i<70;i++)x.fillRect((i*97)%W,(i*53)%H,2,2);bricks?.forEach(b=>{if(!b.hp)return;x.fillStyle=colors[(Math.floor(b.y/23)+Math.floor(b.x/61))%colors.length];x.fillRect(b.x,b.y,b.w,b.h);if(b.hp>1){x.strokeStyle='#fff';x.strokeRect(b.x+3,b.y+3,b.w-6,b.h-6);}});powers?.forEach(p=>{x.fillStyle=p.kind==='wide'?'#5cc16f':'#65c9ff';x.beginPath();x.arc(p.x,p.y,10,0,7);x.fill();x.fillStyle='#102';x.fillText(p.kind==='wide'?'W':'M',p.x-4,p.y+4);});x.fillStyle='#fff';x.fillRect(paddle,H-25,level>3?76:94,12);balls?.forEach(b=>{x.fillStyle='#ffe69b';x.beginPath();x.arc(b.x,b.y,b.r,0,7);x.fill();});$('db-score').textContent=score;$('db-level').textContent=level;$('db-lives').textContent=lives;}t.on(c,'pointermove',e=>{const r=c.getBoundingClientRect();pointer=(e.clientX-r.left)/r.width*W;});t.on(c,'pointerdown',()=>{if(!run)start();});t.on(document,'keydown',e=>{if(['ArrowLeft','ArrowRight','KeyA','KeyD'].includes(e.code))e.preventDefault();keys[e.code]=true;});t.on(document,'keyup',e=>{keys[e.code]=false;});t.on($('db-overlay button'),'click',start);start();}

function newPacmanArcade(){
  const t=plusTools(),key='dejavu1.pacman.deep.best',cols=21,rows=21,cell=26,W=cols*cell,H=rows*cell,host=$('game-host');
  const maze=Array.from({length:rows},(_,r)=>{const row=Array(cols).fill('.');if(r===0||r===rows-1)return Array(cols).fill('#');row[0]=row[cols-1]='#';if(r%4===2)for(let c=2;c<cols-2;c+=4)row[c]='#';if(r%4===1)for(let c=4;c<cols-4;c+=4)row[c]='#';return row;});
  [[1,1],[1,19],[19,1],[19,19]].forEach(([r,c])=>{maze[r][c]='o';});
  const map=maze.map(row=>row.join('')),dirs={up:[-1,0],left:[0,-1],down:[1,0],right:[0,1]},order=['up','left','down','right'];
  plusStats([['Score','ppd-score'],['Lives','ppd-lives'],['Level','ppd-level'],['Best','ppd-best',true,gameBestV2(key)||'—']]);
  plusFrame('Pac-Man','WASD / arrows · arrow pad · eat dots, then turn the hunt around',`<div class="pac-deep"><canvas id="ppd-canvas" class="arcade-canvas" width="${W}" height="${H}" aria-label="Pac-Man maze"></canvas><div class="pac-pad"><button class="btn" data-pacd="up">▲</button><button class="btn" data-pacd="left">◀</button><button class="btn" data-pacd="down">▼</button><button class="btn" data-pacd="right">▶</button></div><div class="pac-actions"><button class="btn" id="ppd-pause">Pause</button><span id="ppd-message">First clear: learn the maze.</span></div><div class="game-overlay" id="ppd-overlay"><div class="g-title">PAC-MAN</div><div class="g-sub">Blinky hunts, Pinky ambushes, Inky sets traps, and Clyde changes his mind.</div><button class="btn primary">Start chase</button></div></div>`,t);
  const canvas=$('ppd-canvas'),ctx=canvas.getContext('2d'),walk=(r,c)=>r>=0&&r<rows&&c>=0&&c<cols&&map[r][c]!=='#',neighbors=(r,c)=>order.filter(d=>walk(r+dirs[d][0],c+dirs[d][1]));
  let grid,player,ghosts,score,lives,level,power,frame,run=false,paused=false,timer,wanted='left',dots,pops=[];
  const spawnPoints=[{r:10,c:9},{r:10,c:11},{r:9,c:9},{r:11,c:9}],corners=[{r:1,c:1},{r:1,c:19},{r:19,c:1},{r:19,c:19}];
  const resetActors=()=>{player={r:10,c:1,dir:'left'};ghosts=spawnPoints.map((p,i)=>({r:p.r,c:p.c,dir:order[(i+1)%4],color:['#ef5350','#f6a6d5','#55ddea','#ffb05a'][i],mode:i,eaten:false}));};
  const resetBoard=()=>{grid=map.map(row=>row.split('').map(ch=>ch==='.'||ch==='o'?ch:null));dots=grid.flat().filter(Boolean).length;resetActors();power=0;frame=0;pops=[];};
  const targetOpen=target=>{if(walk(target.r,target.c))return target;let best={r:10,c:1},distance=Infinity;for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)if(walk(r,c)){const d=Math.abs(r-target.r)+Math.abs(c-target.c);if(d<distance){distance=d;best={r,c};}}return best;};
  const bfs=(start,target)=>{target=targetOpen(target);const queue=[start],prev=new Map([[`${start.r},${start.c}`,null]]);while(queue.length){const p=queue.shift();if(p.r===target.r&&p.c===target.c)break;neighbors(p.r,p.c).forEach(d=>{const n={r:p.r+dirs[d][0],c:p.c+dirs[d][1]},id=`${n.r},${n.c}`;if(!prev.has(id)){prev.set(id,{from:p,dir:d});queue.push(n);}});}let cur=target;while(prev.has(`${cur.r},${cur.c}`)&&prev.get(`${cur.r},${cur.c}`)){const step=prev.get(`${cur.r},${cur.c}`);if(step.from.r===start.r&&step.from.c===start.c)return step.dir;cur=step.from;}return start.dir;};
  const distance=(a,b)=>Math.abs(a.r-b.r)+Math.abs(a.c-b.c);
  const ghostTarget=g=>{const chase=Math.floor(frame/55)%8<5;if(!chase)return corners[g.mode];if(g.mode===0)return player;if(g.mode===1)return{r:player.r+dirs[player.dir][0]*4,c:player.c+dirs[player.dir][1]*4};if(g.mode===2){const ahead={r:player.r+dirs[player.dir][0]*2,c:player.c+dirs[player.dir][1]*2},blinky=ghosts[0];return{r:ahead.r+(ahead.r-blinky.r),c:ahead.c+(ahead.c-blinky.c)};}return distance(g,player)>7?player:corners[2];};
  const frightenedDirection=g=>{const choices=neighbors(g.r,g.c).filter(d=>d!==({up:'down',down:'up',left:'right',right:'left'}[g.dir]));return choices.sort((a,b)=>{const ar=g.r+dirs[a][0],ac=g.c+dirs[a][1],br=g.r+dirs[b][0],bc=g.c+dirs[b][1];return distance({r:br,c:bc},player)-distance({r:ar,c:ac},player);})[0]||g.dir;};
  function message(text,good=false){$('ppd-message').textContent=text;$('ppd-message').classList.toggle('good',good);}
  function begin(){if(!run){if(!lives||frame<0){score=0;lives=3;level=1;}run=true;paused=false;$('ppd-overlay').style.display='none';clearInterval(timer);timer=t.every(tick,125);message('Clear the dots. Power pellets make ghosts edible.');}}
  function finish(){run=false;paused=false;clearInterval(timer);timer=null;const best=Math.max(gameBestV2(key),score);saveBest(key,best);$('ppd-best').textContent=best;$('ppd-overlay').innerHTML=`<div class="g-title">MAZE LOST</div><div class="g-sub">${score.toLocaleString()} points · level ${level}</div><button class="btn primary">Run it back</button>`;$('ppd-overlay').style.display='flex';message('The maze remembers. Try a new route.');}
  function loseLife(){lives--;power=0;if(lives<=0){finish();return;}resetActors();message(`${lives} life${lives===1?'':'s'} left · regroup at the corner`);}
  function tick(){if(!run||paused)return;frame++;const wantedDir=wanted;if(walk(player.r+dirs[wantedDir][0],player.c+dirs[wantedDir][1]))player.dir=wantedDir;if(walk(player.r+dirs[player.dir][0],player.c+dirs[player.dir][1])){player.r+=dirs[player.dir][0];player.c+=dirs[player.dir][1];}const pellet=grid[player.r][player.c];if(pellet){grid[player.r][player.c]=null;dots--;score+=pellet==='o'?50:10;if(pellet==='o'){power=48;message('Power mode · hunt the blue ghosts!',true);pops.push({x:player.c*cell+cell/2,y:player.r*cell+cell/2,text:'+50',life:1});}}ghosts.forEach(g=>{if(g.eaten){g.dir=bfs(g,{r:10,c:10});}else if(power){g.dir=frightenedDirection(g);}else g.dir=bfs(g,ghostTarget(g));if(walk(g.r+dirs[g.dir][0],g.c+dirs[g.dir][1])){g.r+=dirs[g.dir][0];g.c+=dirs[g.dir][1];}if(g.r===player.r&&g.c===player.c){if(power&&!g.eaten){g.eaten=true;score+=200;message('Ghost eaten · +200',true);pops.push({x:g.c*cell+cell/2,y:g.r*cell+cell/2,text:'+200',life:1});}else if(!power&&!g.eaten){loseLife();}}if(g.eaten&&g.r===10&&g.c===10)g.eaten=false;});if(power)power--;if(dots<=0){level++;score+=500;resetBoard();message(`Maze clear · level ${level}`,true);}pops.forEach(sp=>{sp.y-=.6;sp.life-=.035;});pops=pops.filter(sp=>sp.life>0);draw();}
  function draw(){
    ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
    // Arcade maze: stroke only the corridor-facing sides of wall cells so clusters read as continuous blue walls.
    ctx.strokeStyle='#2121de';ctx.lineWidth=2;ctx.lineCap='round';
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      if(map[r][c]!=='#')continue;
      const x0=c*cell,y0=r*cell;
      if(walk(r-1,c)){ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x0+cell,y0);ctx.stroke();}
      if(walk(r+1,c)){ctx.beginPath();ctx.moveTo(x0,y0+cell);ctx.lineTo(x0+cell,y0+cell);ctx.stroke();}
      if(walk(r,c-1)){ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x0,y0+cell);ctx.stroke();}
      if(walk(r,c+1)){ctx.beginPath();ctx.moveTo(x0+cell,y0);ctx.lineTo(x0+cell,y0+cell);ctx.stroke();}
    }
    const blink=Math.floor(frame/9)%2===0;
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      const pellet=grid?.[r]?.[c];if(!pellet)continue;
      const px=c*cell+cell/2,py=r*cell+cell/2;
      if(pellet==='o'){if(blink){ctx.fillStyle='#ffb8ae';ctx.beginPath();ctx.arc(px,py,6,0,Math.PI*2);ctx.fill();}}
      else{ctx.fillStyle='#ffb8ae';ctx.beginPath();ctx.arc(px,py,2.4,0,Math.PI*2);ctx.fill();}
    }
    // Pac-Man: wedge rotated toward travel, chomping while on the move.
    const p=player||{r:10,c:1,dir:'right'};
    const pcx=p.c*cell+cell/2,pcy=p.r*cell+cell/2;
    const facing=Math.atan2(dirs[p.dir][0],dirs[p.dir][1]);
    const mouth=run&&!paused?Math.abs(Math.sin(frame*.32))*.34+.04:.22;
    ctx.save();ctx.translate(pcx,pcy);ctx.rotate(facing);
    ctx.fillStyle='#ffe100';ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,11,mouth,Math.PI*2-mouth);ctx.closePath();ctx.fill();
    ctx.restore();
    // Ghosts: arcade bodies, direction-facing eyes, frightened blue with a white flash as the pellet runs out.
    ghosts?.forEach(g=>{
      const gx=g.c*cell+cell/2,gy=g.r*cell+cell/2;
      const flashing=power>0&&power<14&&Math.floor(frame/4)%2===0;
      if(!g.eaten){
        ctx.fillStyle=flashing?'#f4f4ff':power?'#2121de':g.color;
        ctx.beginPath();ctx.arc(gx,gy-1,10,Math.PI,0);
        ctx.lineTo(gx+10,gy+9);
        ctx.lineTo(gx+6.6,gy+5.5);ctx.lineTo(gx+3.3,gy+9);ctx.lineTo(gx,gy+5.5);ctx.lineTo(gx-3.3,gy+9);ctx.lineTo(gx-6.6,gy+5.5);ctx.lineTo(gx-10,gy+9);
        ctx.closePath();ctx.fill();
      }
      if(g.eaten||!power||flashing){
        const ex=dirs[g.dir][1]*2.6,ey=dirs[g.dir][0]*2.6;
        ctx.fillStyle='#fff';
        ctx.beginPath();ctx.ellipse(gx-4,gy-2,3.1,3.9,0,0,Math.PI*2);ctx.fill();
        ctx.beginPath();ctx.ellipse(gx+4,gy-2,3.1,3.9,0,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#2233dd';
        ctx.beginPath();ctx.arc(gx-4+ex,gy-2+ey,1.9,0,Math.PI*2);ctx.fill();
        ctx.beginPath();ctx.arc(gx+4+ex,gy-2+ey,1.9,0,Math.PI*2);ctx.fill();
      }else{
        ctx.fillStyle='#ffb8ae';
        ctx.fillRect(gx-5,gy-3,2.6,2.6);ctx.fillRect(gx+2.4,gy-3,2.6,2.6);
        ctx.strokeStyle='#ffb8ae';ctx.lineWidth=1.4;ctx.beginPath();
        ctx.moveTo(gx-6,gy+5);ctx.lineTo(gx-3,gy+3);ctx.lineTo(gx,gy+5);ctx.lineTo(gx+3,gy+3);ctx.lineTo(gx+6,gy+5);ctx.stroke();
      }
    });
    // Floating score pops, arcade HUD: READY!, lives bottom-left, level fruit bottom-right.
    ctx.textAlign='center';
    if(!run){ctx.fillStyle='#ffe100';ctx.font='bold 17px monospace';ctx.fillText('READY!',W/2,11.5*cell);}
    ctx.font='bold 13px monospace';
    pops.forEach(sp=>{ctx.globalAlpha=Math.max(0,sp.life);ctx.fillStyle='#7df0ff';ctx.fillText(sp.text,sp.x,sp.y);});
    ctx.globalAlpha=1;ctx.textAlign='left';
    for(let i=0;i<Math.max(0,lives-1);i++){
      ctx.fillStyle='#ffe100';ctx.beginPath();ctx.moveTo(15+i*26,H-9);ctx.arc(15+i*26,H-9,8,.2,Math.PI*2-.2);ctx.closePath();ctx.fill();
    }
    for(let i=0;i<Math.min(level,6);i++){
      const fx=W-16-i*18,fy=H-11;
      ctx.strokeStyle='#4fae4f';ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(fx,fy-9);ctx.quadraticCurveTo(fx+4,fy-13,fx+7,fy-14);ctx.stroke();
      ctx.fillStyle='#e23b2e';ctx.beginPath();ctx.arc(fx-2,fy-4,4.4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(fx+3.4,fy-6.4,4.2,0,Math.PI*2);ctx.fill();
    }
    $('ppd-score').textContent=score.toLocaleString();$('ppd-lives').textContent=lives;$('ppd-level').textContent=level;}
  const keyDown=e=>{const d={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',KeyW:'up',KeyS:'down',KeyA:'left',KeyD:'right'}[e.code];if(d){e.preventDefault();wanted=d;begin();}if(e.code==='Space'){e.preventDefault();paused=!paused;message(paused?'Paused — press Space to resume':'Back in the maze');}};t.on(document,'keydown',keyDown);document.querySelectorAll('[data-pacd]').forEach(button=>t.on(button,'pointerdown',e=>{e.preventDefault();wanted=button.dataset.pacd;begin();}));t.on(document,'pointerup',()=>{});t.on(document,'pointercancel',()=>{});t.on(canvas,'pointerdown',()=>begin());t.on($('ppd-overlay'),'click',e=>{if(e.target.closest('button')){resetBoard();score=0;lives=3;level=1;begin();}});t.on($('ppd-pause'),'click',()=>{if(run){paused=!paused;message(paused?'Paused':'Back in the maze');}});resetBoard();score=0;lives=3;level=1;draw();
}

function newBreakoutDeep(){
  // Breakout fidelity: the first screen follows the original eight-row formation, then expands into Arkanoid-style patterns.
  const t=plusTools(),key='dejavu1.breakout.deep.best',W=720,H=480,host=$('game-host'),colors=['#ff8a5b','#ffcf70','#67c9ff','#77d58d','#c58cff'];
  plusStats([['Score','dbd-score'],['Level','dbd-level'],['Lives','dbd-lives'],['Best','dbd-best',true,gameBestV2(key)||'—']]);
  plusFrame('Brick Break','Drag or ← → · Space launch · P pause · curve the ball off the paddle',`<div class="break-deep"><canvas id="dbd-canvas" class="arcade-canvas" width="${W}" height="${H}" aria-label="Brick Break"></canvas><div class="break-actions"><button class="btn" id="dbd-pause">Pause</button><span id="dbd-message">Clear the formation and protect your lives.</span></div><div class="game-overlay" id="dbd-overlay"><div class="g-title">BRICK BREAK</div><div class="g-sub">Classic paddle physics, layered formations, armored bricks, and useful power capsules.</div><button class="btn primary">Launch ball</button></div></div>`,t);
  const canvas=$('dbd-canvas'),ctx=canvas.getContext('2d');let paddleX=W/2,paddleWidth=112,balls=[],bricks=[],capsules=[],sparks=[],pops=[],score=0,level=1,lives=3,combo=0,status='ready',timer,keys={};
  const setMessage=(text,good=false)=>{$('dbd-message').textContent=text;$('dbd-message').classList.toggle('good',good);};
  const speed=()=>Math.min(9,5+level*.24),width=()=>Math.min(170,paddleWidth+(wideTicks>0?42:0));let wideTicks=0;
  function buildLegacyFormation(){const rows=Math.min(4+Math.floor((level-1)/2),9),pattern=level%3;bricks=[];for(let r=0;r<rows;r++)for(let c=0;c<10;c++){const gap=pattern===1&&r%2===1&&(c===0||c===9),solid=pattern===2&&(r+c)%5===0;if(gap)continue;const hp=level>2&&((r+c+level)%5===0)?2:1;bricks.push({x:24+c*67,y:34+r*24,w:61,h:17,hp,maxHp:hp,color:colors[r%colors.length],solid});}capsules=[];sparks=[];const s=speed();balls=[{x:paddleX,y:H-55,vx:(Math.random()<.5?-1:1)*s*.68,vy:-s,r:7}];wideTicks=0;}
  // Classic Breakout starts with eight colored rows; later rounds borrow Arkanoid's
  // varied formations while preserving a readable first screen.
  function buildLevel(){const rows=level===1?8:Math.min(4+Math.floor((level-1)/2),9),pattern=level%3;bricks=[];const palette=level===1?['#d94330','#d94330','#e88b32','#e88b32','#5aa54b','#5aa54b','#d3b23a','#d3b23a']:colors;for(let r=0;r<rows;r++)for(let c=0;c<10;c++){const gap=level>1&&pattern===1&&r%2===1&&(c===0||c===9);if(gap)continue;const armored=level>2&&((r+c+level)%5===0);bricks.push({x:24+c*67,y:34+r*24,w:61,h:17,hp:armored?2:1,maxHp:armored?2:1,color:palette[r%palette.length],solid:false});}capsules=[];sparks=[];const s=speed();balls=[{x:paddleX,y:H-55,vx:(Math.random()<.5?-1:1)*s*.68,vy:-s,r:7}];wideTicks=0;}
  function resetRun(){score=0;level=1;lives=3;combo=0;status='ready';paddleWidth=112;paddleX=W/2;buildLevel();$('dbd-overlay').innerHTML='<div class="g-title">BRICK BREAK</div><div class="g-sub">Classic paddle physics, layered formations, armored bricks, and useful power capsules.</div><button class="btn primary">Launch ball</button>';$('dbd-overlay').style.display='flex';setMessage('Clear the formation and protect your lives.');draw();}
  function launch(){if(status==='over'||status==='ready'){if(status==='over')resetRun();status='playing';$('dbd-overlay').style.display='none';clearInterval(timer);timer=t.every(tick,16);setMessage('Keep the rally alive · edge hits create sharp returns.');}else if(status==='paused'){status='playing';setMessage('Back in play.');}}
  function gameOver(){status='over';clearInterval(timer);timer=null;const best=Math.max(gameBestV2(key),score);saveBest(key,best);$('dbd-best').textContent=best;$('dbd-overlay').innerHTML=`<div class="g-title">RUN OVER</div><div class="g-sub">${score.toLocaleString()} points · level ${level}</div><button class="btn primary">Play again</button>`;$('dbd-overlay').style.display='flex';setMessage('The wall wins this round.');}
  function loseBall(){lives--;combo=0;if(lives<=0){gameOver();return;}const s=speed();balls=[{x:paddleX,y:H-55,vx:(Math.random()<.5?-1:1)*s*.68,vy:-s,r:7}];setMessage(`${lives} lives left · find the center of the paddle`);}
  function burst(x,y,color='#fff'){for(let i=0;i<8;i++)sparks.push({x,y,vx:(Math.random()-.5)*4,vy:(Math.random()-.5)*4,life:1,color});}
  function applyPower(kind){if(kind==='wide')wideTicks=480;if(kind==='multi'&&balls.length<3){const b=balls[0];balls.push({x:b.x,y:b.y,vx:-b.vx,vy:b.vy,r:7});}if(kind==='slow')balls.forEach(b=>{b.vx*=.72;b.vy*=.72;});if(kind==='life'){lives=Math.min(5,lives+1);}setMessage(kind==='life'?'+1 life':`${kind==='wide'?'Wide paddle':kind==='multi'?'Multi-ball':'Slow motion'} collected`,true);}
  function tick(){if(status!=='playing')return;if(wideTicks>0)wideTicks--;const pw=width(),py=H-32;for(let i=balls.length-1;i>=0;i--){const b=balls[i],oldX=b.x,oldY=b.y;b.x+=b.vx;b.y+=b.vy;(b.trail=b.trail||[]).push({x:b.x,y:b.y});if(b.trail.length>6)b.trail.shift();if(b.x-b.r<0||b.x+b.r>W){b.x=Math.max(b.r,Math.min(W-b.r,b.x));b.vx*=-1;}if(b.y-b.r<0){b.y=b.r;b.vy=Math.abs(b.vy);}if(b.vy>0&&b.y+b.r>=py&&b.y-b.r<=py+14&&b.x>=paddleX-pw/2&&b.x<=paddleX+pw/2){const offset=Math.max(-.92,Math.min(.92,(b.x-paddleX)/(pw/2))),current=Math.max(4.2,Math.hypot(b.vx,b.vy));b.vx=offset*current*.92;b.vy=-Math.sqrt(Math.max(12,current*current-b.vx*b.vx));b.y=py-b.r-1;combo++;if(combo%5===0)setMessage(`Rally ×${combo}`,true);}let hitBrick=null;for(const brick of bricks){if(!brick.hp||b.x+b.r<brick.x||b.x-b.r>brick.x+brick.w||b.y+b.r<brick.y||b.y-b.r>brick.y+brick.h)continue;hitBrick=brick;break;}if(hitBrick){const horizontal=Math.abs(oldX-(hitBrick.x+hitBrick.w/2))>hitBrick.w/2,vertical=Math.abs(oldY-(hitBrick.y+hitBrick.h/2))>hitBrick.h/2;if(horizontal)b.vx*=-1;else b.vy*=-1;hitBrick.hp--;const pts=hitBrick.hp?5:10+Math.min(40,combo*2);score+=pts;hitBrick.flash=6;pops.push({x:hitBrick.x+hitBrick.w/2,y:hitBrick.y,text:'+'+pts,life:1});burst(b.x,b.y,hitBrick.color);if(!hitBrick.hp&&!hitBrick.solid&&Math.random()<.2){const kinds=['wide','multi','slow','life'],kind=kinds[Math.floor(Math.random()*kinds.length)];capsules.push({x:hitBrick.x+hitBrick.w/2,y:hitBrick.y,kind,vy:2.1});}}if(b.y-b.r>H)balls.splice(i,1);}for(let i=capsules.length-1;i>=0;i--){const p=capsules[i];p.y+=p.vy;if(p.y>py-8&&p.y<py+18&&Math.abs(p.x-paddleX)<pw/2+10){applyPower(p.kind);capsules.splice(i,1);}else if(p.y>H+24)capsules.splice(i,1);}sparks.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.life-=.06;});sparks=sparks.filter(p=>p.life>0);bricks.forEach(brick=>{if(brick.flash)brick.flash--;});pops.forEach(sp=>{sp.y-=.7;sp.life-=.04;});pops=pops.filter(sp=>sp.life>0);if(!balls.length)loseBall();if(bricks.every(b=>!b.hp)){level++;const best=Math.max(gameBestV2(key),score);saveBest(key,best);$('dbd-best').textContent=best;buildLevel();setMessage(`Level ${level} · new formation`,true);}draw();}
  function movePaddle(clientX){const rect=canvas.getBoundingClientRect();paddleX=Math.max(width()/2,Math.min(W-width()/2,(clientX-rect.left)/rect.width*W));if(status!=='playing')draw();}
  function draw(){
    // Atari Breakout dressing: flat black field, classic red/orange/green/yellow rows, Vaus-style paddle.
    ctx.fillStyle='#07070b';ctx.fillRect(0,0,W,H);
    ctx.fillStyle='rgba(255,255,255,.12)';
    for(let i=0;i<60;i++)ctx.fillRect((i*83)%W,(i*47)%H,1,1);
    bricks.forEach(brick=>{
      if(!brick.hp)return;
      ctx.fillStyle=brick.color;ctx.fillRect(brick.x,brick.y,brick.w,brick.h);
      ctx.fillStyle='rgba(255,255,255,.3)';ctx.fillRect(brick.x+2,brick.y+2,brick.w-4,3);
      if(brick.maxHp>1){ctx.strokeStyle='rgba(255,255,255,.85)';ctx.lineWidth=2;ctx.strokeRect(brick.x+4,brick.y+4,brick.w-8,brick.h-8);}
      if(brick.flash>0){ctx.fillStyle=`rgba(255,255,255,${(.75*brick.flash/6).toFixed(2)})`;ctx.fillRect(brick.x,brick.y,brick.w,brick.h);}
    });
    const pw=width();
    const bodyGrad=ctx.createLinearGradient(0,H-32,0,H-19);bodyGrad.addColorStop(0,'#f2f5fa');bodyGrad.addColorStop(.5,'#c3cad7');bodyGrad.addColorStop(1,'#8e96a7');
    ctx.fillStyle=bodyGrad;ctx.beginPath();ctx.roundRect(paddleX-pw/2+9,H-32,pw-18,13,6);ctx.fill();
    ctx.fillStyle='#e0523c';
    ctx.beginPath();ctx.roundRect(paddleX-pw/2,H-32,12,13,6);ctx.fill();
    ctx.beginPath();ctx.roundRect(paddleX+pw/2-12,H-32,12,13,6);ctx.fill();
    balls.forEach(b=>{
      (b.trail||[]).forEach((t,i)=>{ctx.globalAlpha=(i+1)/Math.max(1,b.trail.length)*.3;ctx.fillStyle='#fff4c4';ctx.beginPath();ctx.arc(t.x,t.y,b.r*.75,0,Math.PI*2);ctx.fill();});
      ctx.globalAlpha=1;ctx.fillStyle='#fff4c4';ctx.shadowColor='#fff';ctx.shadowBlur=10;ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    });
    capsules.forEach(p=>{const labels={wide:'W',multi:'M',slow:'S',life:'+'};ctx.fillStyle=p.kind==='wide'?'#5cc16f':p.kind==='multi'?'#7fb2ff':p.kind==='life'?'#ffcf70':'#e0475f';ctx.beginPath();ctx.roundRect(p.x-12,p.y-12,24,24,6);ctx.fill();ctx.fillStyle='#102';ctx.font='bold 13px monospace';ctx.fillText(labels[p.kind],p.x-4,p.y+5);});
    sparks.forEach(p=>{ctx.globalAlpha=p.life;ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,3,3);});
    ctx.globalAlpha=1;ctx.font='bold 13px monospace';ctx.textAlign='center';
    pops.forEach(sp=>{ctx.globalAlpha=Math.max(0,sp.life);ctx.fillStyle='#ffe9a8';ctx.fillText(sp.text,sp.x,sp.y);});
    ctx.globalAlpha=1;ctx.textAlign='left';
    $('dbd-score').textContent=score.toLocaleString();$('dbd-level').textContent=level;$('dbd-lives').textContent=lives;}
  const down=e=>{if(['ArrowLeft','ArrowRight','KeyA','KeyD','Space','KeyP'].includes(e.code))e.preventDefault();keys[e.code]=true;if(e.code==='Space')launch();if(e.code==='KeyP'&&status==='playing'){status='paused';setMessage('Paused · press P or the button to resume');}};const up=e=>{keys[e.code]=false;};t.on(document,'keydown',down);t.on(document,'keyup',up);t.on(document,'pointerup',()=>{keys.ArrowLeft=false;keys.ArrowRight=false;});t.on(document,'pointercancel',()=>{keys.ArrowLeft=false;keys.ArrowRight=false;});t.on(canvas,'pointermove',e=>movePaddle(e.clientX));t.on(canvas,'pointerdown',e=>{e.preventDefault();movePaddle(e.clientX);launch();});t.on($('dbd-pause'),'click',()=>{if(status==='playing'){status='paused';setMessage('Paused');}else if(status==='paused')launch();});t.on($('dbd-overlay'),'click',e=>{if(e.target.closest('button')){if(status==='over')resetRun();launch();}});const drive=()=>{if(keys.ArrowLeft||keys.KeyA)paddleX-=8;if(keys.ArrowRight||keys.KeyD)paddleX+=8;paddleX=Math.max(width()/2,Math.min(W-width()/2,paddleX));};t.every(drive,16);resetRun();
}

function installArcadePlus(){const games={skydash:skyDashV2,pong:newSmartPong,mines:newMines,tetris:newTetris,pacman:newPacmanPlus,breakout:newDoodleBreak,blackjack:newBlackjack,asteroids:newAsteroids,snake:newSnake,twenty48:new2048};const legacyStop=stopCurrentGame;gameFullscreenV2=(host,tools)=>{const button=document.createElement('button');button.className='btn small game-fullscreen';button.type='button';button.textContent='⛶ Fullscreen';tools.on(button,'click',()=>{const frame=host.querySelector('.game-frame')||host;if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});else frame.requestFullscreen?.().catch?.(()=>{});});tools.on(document,'fullscreenchange',()=>{button.textContent=document.fullscreenElement?'× Exit fullscreen':'⛶ Fullscreen';});host.querySelector('.game-toolbar').appendChild(button);};stopCurrentGame=()=>{legacyStop();plusStop();gamesCleanupV2?.();gamesCleanupV2=()=>{};activeGame=null;};renderGame=name=>{stopCurrentGame();activeGame=name;(games[name]||games.skydash)();};const picker=$('game-picker');if(picker){const clean=picker.cloneNode(true);picker.replaceWith(clean);clean.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{clean.querySelectorAll('button').forEach(i=>i.classList.toggle('active',i===b));renderGame(b.dataset.game);}));renderGame(clean.querySelector('button.active')?.dataset.game||'skydash');}}
setTimeout(installArcadePlus,50);

const $ = id => document.getElementById(id);

function esc(text) {
  return String(text).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function getJSON(url) {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  return body;
}

async function postJSON(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

const STORE_KEY = 'dejavu1.demo';
let demoOn = localStorage.getItem(STORE_KEY) === '1';

function api(path) {
  return path + (demoOn ? (path.includes('?') ? '&' : '?') + 'demo=1' : '');
}

function hasData(payload) {
  return payload && payload.connected !== undefined
    ? (payload.connected || payload.demo)
    : Boolean(payload);
}

function isModuleDisabled(payload) {
  return Boolean(payload && payload.module_disabled);
}

function moduleDisabledEmpty(name) {
  return EMPTY(`${name} is off`, 'Turn it back on from Modules & devices.');
}

const STATUS_TEXT = { overdue: 'Overdue', due_soon: 'Due soon', ok: 'OK' };

function stagger(nodes, step = 45) {
  nodes.forEach((node, i) => { node.style.animationDelay = `${i * step}ms`; });
}

const EMPTY = (title, sub) => `
  <div class="empty">
    <span class="empty-mark" aria-hidden="true"></span>
    <p class="empty-title">${esc(title)}</p>
    <p class="empty-sub">${esc(sub)}</p>
  </div>`;

/* ---- temperature units --------------------------------------------------
 * A real user-facing preference: stored per-viewer, used everywhere a
 * temperature is displayed. */

const UNIT_KEY = 'dejavu1.units';
let tempUnit = localStorage.getItem(UNIT_KEY) === 'F' ? 'F' : 'C';

function formatTemp(celsius) {
  if (celsius === null || celsius === undefined) return '—';
  const value = tempUnit === 'F' ? (celsius * 9 / 5) + 32 : celsius;
  return `${value.toFixed(0)}°${tempUnit}`;
}

/* ---- accent colour -------------------------------------------------------
 * A real user-facing preference: swaps the CSS custom properties every
 * accent-coloured element already reads from. */

const ACCENTS = [
  { id: 'orange', label: 'Snapmaker Orange', hex: '#ff7a2f', light: '#ff9c66' },
  { id: 'red', label: 'Signal Red', hex: '#c8102e', light: '#e0475f' },
  { id: 'blue', label: 'Sky Blue', hex: '#3b82f6', light: '#6fa8ff' },
  { id: 'green', label: 'Grass Green', hex: '#2f9e44', light: '#5cc16f' },
];
const ACCENT_KEY = 'dejavu1.accent';

function applyAccent(id) {
  const accent = ACCENTS.find(a => a.id === id) || ACCENTS[0];
  document.documentElement.style.setProperty('--accent', accent.hex);
  document.documentElement.style.setProperty('--accent-light', accent.light);
  localStorage.setItem(ACCENT_KEY, accent.id);
  document.querySelectorAll('.accent-swatch').forEach(el => {
    el.classList.toggle('is-active', el.dataset.accent === accent.id);
  });
}

function initPreferences() {
  const host = $('accent-swatches');
  host.innerHTML = ACCENTS.map(a => `
    <button class="accent-swatch" data-accent="${a.id}" aria-label="${esc(a.label)}"
            style="background:${a.hex};"></button>
  `).join('');
  host.querySelectorAll('.accent-swatch').forEach(btn => {
    btn.addEventListener('click', () => applyAccent(btn.dataset.accent));
  });
  applyAccent(localStorage.getItem(ACCENT_KEY) || 'orange');

  const setUnits = (unit) => {
    tempUnit = unit;
    localStorage.setItem(UNIT_KEY, unit);
    $('units-c').classList.toggle('active', unit === 'C');
    $('units-f').classList.toggle('active', unit === 'F');
    loadPrinterControl();
    renderOverviewControl(lastPrinterState);
  };
  $('units-c').addEventListener('click', () => setUnits('C'));
  $('units-f').addEventListener('click', () => setUnits('F'));
  setUnits(tempUnit);
}

/* ---- connection state ---------------------------------------------------*/

async function loadConnection() {
  const data = await getJSON('/api/connection');
  const pill = $('conn');
  const label = $('conn-label');

  if (data.connected) {
    pill.classList.remove('is-demo');
    label.textContent = 'Connected';
    $('foot-state').textContent = 'Connected to Moonraker.';
  } else if (demoOn) {
    pill.classList.add('is-demo');
    label.textContent = 'Demo data';
    $('foot-state').textContent = 'Demo data — no printer connected, nothing is contacted.';
  } else {
    pill.classList.remove('is-demo');
    label.textContent = 'Not connected';
    $('foot-state').textContent = 'No printer connected — nothing is contacted.';
  }

  $('notice').hidden = !(demoOn && !data.connected);
}

/* ---- tabs -----------------------------------------------------------------*/

const TAB_KEY = 'dejavu1.tab';

function initTabs() {
  const tabs = document.querySelectorAll('.navtab');
  const panels = document.querySelectorAll('.tab-panel');

  function show(name) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    panels.forEach(p => { p.hidden = p.id !== `tab-${name}`; });
    localStorage.setItem(TAB_KEY, name);
    if (name === 'games') startCurrentGame();
    else stopCurrentGame();
  }

  tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
  $('overview-pair-btn').addEventListener('click', () => show('modules'));

  show(localStorage.getItem(TAB_KEY) || 'overview');
}

/* ---- status ribbon (always visible) --------------------------------------*/

let lastPrinterState = null;

async function loadStatusRibbon() {
  const data = await getJSON(api('/api/printer'));
  const ribbon = $('status-ribbon');
  const text = $('rb-text');
  const bar = $('rb-bar');
  const fill = $('rb-bar-fill');
  const pct = $('rb-pct');

  if (!hasData(data) || !data.state) {
    ribbon.classList.remove('is-live');
    text.textContent = 'No printer connected.';
    bar.hidden = true;
    pct.hidden = true;
    lastPrinterState = null;
    return;
  }

  lastPrinterState = data;
  const isPrinting = data.state === 'printing';
  ribbon.classList.toggle('is-live', isPrinting);

  if (data.state === 'ready') {
    text.textContent = 'Idle — no print running.';
    bar.hidden = true; pct.hidden = true;
  } else {
    text.textContent = `${data.state === 'paused' ? 'Paused' : 'Printing'} — ${data.current_file || 'unknown file'}`;
    bar.hidden = false; pct.hidden = false;
    fill.style.width = `${Math.round(data.progress * 100)}%`;
    pct.textContent = `${Math.round(data.progress * 100)}%`;
  }

  renderOverviewControl(data);
  renderControlTab(data);
}

/* ---- Module: Maintenance ---------------------------------------------- */

function clearStats() {
  [['stat-hours', 'stat-hours-foot'], ['stat-prints', 'stat-prints-foot'],
   ['stat-filament', 'stat-filament-foot'], ['stat-due', 'stat-due-foot']]
    .forEach(([val, foot]) => {
      $(val).textContent = '—';
      $(foot).textContent = 'No printer';
      const wrap = $(val).closest('.stat');
      wrap.classList.add('is-empty');
      wrap.classList.remove('is-alert');
    });
}

function renderTaskRow(task) {
  return `
    <div class="task ${task.status}">
      <div>
        <div class="task-name">
          ${esc(task.name)}
          <span class="pill">${STATUS_TEXT[task.status]}</span>
        </div>
        <div class="task-desc">${esc(task.description)}</div>
        <div class="bar"><span style="width:${Math.min(task.percent, 100)}%"></span></div>
        <div class="task-meta">${esc(task.reason)} · ${task.percent.toFixed(0)}% · ~${task.est_minutes} min</div>
      </div>
      <button class="btn" data-task="${esc(task.id)}">Mark done</button>
    </div>`;
}

async function loadMaintenance() {
  const data = await getJSON(api('/api/maintenance'));

  if (isModuleDisabled(data)) {
    clearStats();
    $('tasks').innerHTML = moduleDisabledEmpty('Maintenance reminders');
    $('log-wrap').hidden = true;
    $('overview-maintenance').innerHTML = moduleDisabledEmpty('Maintenance reminders');
    return;
  }

  if (!hasData(data) || !data.tasks) {
    clearStats();
    $('tasks').innerHTML = EMPTY('No printer connected',
      'Maintenance reminders appear once print history is available. Turn on demo data to preview them.');
    $('log-wrap').hidden = true;
    $('overview-maintenance').innerHTML = EMPTY('No printer connected', 'Turn on demo data to preview.');
    return;
  }

  const totals = data.totals;
  const unit = data.demo ? 'Simulated' : 'From history';

  $('stat-hours').textContent = totals.total_print_hours.toFixed(0);
  $('stat-hours-foot').textContent = unit;
  $('stat-prints').textContent = totals.total_prints;
  $('stat-prints-foot').textContent = `${totals.failed_prints} failed`;
  $('stat-filament').textContent = (totals.total_filament_grams / 1000).toFixed(1) + ' kg';
  $('stat-filament-foot').textContent = unit;
  $('stat-due').textContent = data.summary.overdue;
  $('stat-due-foot').textContent = `${data.summary.due_soon} due soon`;

  document.querySelectorAll('.stat').forEach(t => t.classList.remove('is-empty'));
  $('stat-due').closest('.stat').classList.toggle('is-alert', data.summary.overdue > 0);

  $('tasks').innerHTML = data.tasks.map(renderTaskRow).join('');
  stagger([...document.querySelectorAll('#tasks .task')]);
  document.querySelectorAll('#tasks .btn').forEach(button => {
    button.addEventListener('click', () => markDone(button));
  });

  // Overview tab gets the top 3 most urgent, read-only.
  $('overview-maintenance').innerHTML = data.tasks.length
    ? data.tasks.slice(0, 3).map(t => `
        <div class="task ${t.status}" style="margin-bottom:9px;">
          <div>
            <div class="task-name">${esc(t.name)} <span class="pill">${STATUS_TEXT[t.status]}</span></div>
            <div class="task-meta">${esc(t.reason)}</div>
          </div>
        </div>`).join('')
    : EMPTY('All caught up', 'Nothing due right now.');

  $('log-wrap').hidden = false;
  loadMaintenanceLog();
}

async function markDone(button) {
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const { ok } = await postJSON(api('/api/maintenance/done'), { task_id: button.dataset.task });
    if (!ok) throw new Error('save failed');
    await loadMaintenance();
  } catch (err) {
    console.error('Could not mark task done:', err);
    button.disabled = false;
    button.textContent = 'Retry';
  }
}

async function loadMaintenanceLog() {
  const data = await getJSON(api('/api/maintenance/history'));
  const box = $('mlog');
  const history = data.history || [];

  if (!history.length) {
    box.innerHTML = '<p class="log-empty">Nothing logged yet. Mark a task done above and it will appear here.</p>';
    return;
  }

  box.innerHTML = history.map(item => `
    <div class="log-row">
      <span>${esc(item.task_name)}</span>
      <span>${esc(item.completed_at.replace('T', ' ').slice(0, 16))} · ${item.printer_hours_at_completion.toFixed(0)} h</span>
    </div>`).join('');
}

/* ---- Module: LED dock rings --------------------------------------------*/

async function loadRings() {
  const data = await getJSON(api('/api/leds'));

  if (isModuleDisabled(data)) {
    $('rings').innerHTML = moduleDisabledEmpty('Dock status rings');
    $('rings-note').hidden = true;
    return;
  }
  if (!hasData(data) || !data.rings) {
    $('rings').innerHTML = EMPTY('No signal', 'Ring colours follow live printer state.');
    $('rings-note').hidden = true;
    return;
  }

  $('rings').innerHTML = data.rings.map(ring => {
    const effect = ring.effect === 'solid' ? '' : ring.effect;
    const pct = ring.state === 'active' ? `<div class="ring-pct">${Math.round(ring.progress * 100)}%</div>` : '';
    return `
      <div class="ring-cell">
        <div class="ring ${effect}" style="color:${esc(ring.color_hex)}"><div class="ring-core"></div></div>
        <div class="ring-id">${esc(ring.toolhead)}</div>
        <div class="ring-label">${esc(ring.label)}</div>
        ${pct}
      </div>`;
  }).join('');

  stagger([...document.querySelectorAll('.ring-cell')], 60);
  $('rings-note').hidden = false;
}

/* ---- Module: colour check ------------------------------------------------*/

async function loadColorCheck() {
  const data = await getJSON(api('/api/colorcheck'));

  if (isModuleDisabled(data)) {
    $('colorfile').hidden = true;
    $('colors').innerHTML = moduleDisabledEmpty('Right colour loaded?');
    $('colors-note').hidden = true;
    return;
  }
  if (!hasData(data) || !data.checks) {
    $('colorfile').hidden = true;
    $('colors').innerHTML = EMPTY('Nothing to check', 'Needs a print file and a sensor reading.');
    $('colors-note').hidden = true;
    return;
  }

  $('colorfile').textContent = data.filename;
  $('colorfile').hidden = false;

  $('colors').innerHTML = data.checks.map(check => `
    <div class="crow">
      <div class="crow-top">
        <span class="crow-head">Toolhead ${esc(check.toolhead)}</span>
        <span class="verdict ${check.verdict}">${esc(check.verdict)}</span>
      </div>
      <div class="swatches">
        <div class="sw"><span class="chip" style="background:${esc(check.expected_hex)}"></span> expected ${esc(check.expected_color_name)}</div>
        <span class="arrow" aria-hidden="true">→</span>
        <div class="sw"><span class="chip" style="background:${esc(check.detected_hex)}"></span> detected</div>
      </div>
      <div class="crow-msg">${esc(check.message)}</div>
    </div>`).join('');

  stagger([...document.querySelectorAll('.crow')], 70);
  $('colors-note').hidden = false;
}

/* ---- Printer control -----------------------------------------------------*/

function renderControlTab(state) {
  const dot = $('ctrl-state-dot');
  const text = $('ctrl-state-text');
  const sub = $('ctrl-state-sub');
  const pauseResume = $('ctrl-pause-resume');
  const cancel = $('ctrl-cancel');
  const homeButtons = document.querySelectorAll('[data-home]');
  const gcodeInput = $('gcode-input');
  const gcodeSend = $('gcode-send');

  if (!state || !state.state) {
    dot.style.background = '';
    text.textContent = 'No printer connected';
    sub.textContent = '';
    pauseResume.disabled = true;
    pauseResume.textContent = 'Pause';
    cancel.disabled = true;
    homeButtons.forEach(b => b.disabled = true);
    gcodeInput.disabled = true;
    gcodeSend.disabled = true;
    $('ctrl-temps').innerHTML = '';
    $('gcode-log').innerHTML = '';
    return;
  }

  dot.style.background = state.state === 'printing' ? 'var(--ok)' : (state.state === 'paused' ? 'var(--warn)' : 'var(--text-faint)');
  text.textContent = state.state === 'ready' ? 'Idle' : `${state.state[0].toUpperCase()}${state.state.slice(1)} — ${state.current_file || ''}`;
  sub.textContent = state.state === 'ready' ? 'No job running.' : `${Math.round(state.progress * 100)}% · ${state.print_duration_hours.toFixed(1)}h elapsed`;

  pauseResume.disabled = !(state.state === 'printing' || state.state === 'paused');
  pauseResume.textContent = state.state === 'paused' ? 'Resume' : 'Pause';
  pauseResume.onclick = () => controlAction(state.state === 'paused' ? 'resume' : 'pause');

  cancel.disabled = !(state.state === 'printing' || state.state === 'paused');
  cancel.onclick = () => controlAction('cancel');

  homeButtons.forEach(b => {
    b.disabled = false;
    b.onclick = () => {
      const axes = b.dataset.home === 'all' ? ['X', 'Y', 'Z'] : [b.dataset.home];
      postJSON(api('/api/printer/control/home'), { axes }).then(() => loadPrinterControl());
    };
  });

  gcodeInput.disabled = false;
  gcodeSend.disabled = false;
  gcodeSend.onclick = () => sendGcode();
  gcodeInput.onkeydown = (e) => { if (e.key === 'Enter') sendGcode(); };

  $('ctrl-temps').innerHTML = Object.entries(state.toolheads).map(([th, info]) => `
    <div>
      <div class="stat-key">${esc(th)}${th === state.active_toolhead ? ' · active' : ''}</div>
      <div class="stat-val" style="font-size:22px; ${th === state.active_toolhead ? 'color:var(--accent);' : ''}">${formatTemp(info.temperature)}</div>
      <div style="display:flex; gap:6px; margin-top:8px;">
        <input type="number" placeholder="target" data-toolhead="${esc(th)}" style="width:100%; font-size:12px;">
        <button class="btn small" data-set-temp="${esc(th)}">Set</button>
      </div>
    </div>`).join('');

  $('ctrl-temps').querySelectorAll('[data-set-temp]').forEach(btn => {
    btn.addEventListener('click', () => {
      const th = btn.dataset.setTemp;
      const input = $('ctrl-temps').querySelector(`input[data-toolhead="${th}"]`);
      const celsiusValue = tempUnit === 'F'
        ? (parseFloat(input.value) - 32) * 5 / 9
        : parseFloat(input.value);
      if (Number.isNaN(celsiusValue)) return;
      postJSON(api('/api/printer/control/temperature'), { toolhead: th, target: celsiusValue })
        .then(() => loadPrinterControl());
    });
  });
}

function renderOverviewControl(state) {
  const host = $('overview-control');
  if (!host) return;
  if (!state || !state.state) {
    host.innerHTML = EMPTY('No printer connected', 'Turn on demo data to preview.');
    return;
  }
  host.innerHTML = `
    <div class="card-sub" style="margin-bottom:8px;">${state.state === 'ready' ? 'Idle' : `${esc(state.current_file || '')}`}</div>
    <div class="bar" style="margin-bottom:14px;"><span style="width:${Math.round(state.progress * 100)}%"></span></div>
    <div style="display:flex; gap:8px;">
      <button class="btn primary" id="ov-pause-resume" style="flex:1;">${state.state === 'paused' ? 'Resume' : 'Pause'}</button>
      <button class="btn danger" id="ov-cancel" style="flex:1;">Cancel</button>
    </div>`;
  const pauseResume = $('ov-pause-resume');
  const cancel = $('ov-cancel');
  if (pauseResume) {
    pauseResume.disabled = !(state.state === 'printing' || state.state === 'paused');
    pauseResume.onclick = () => controlAction(state.state === 'paused' ? 'resume' : 'pause');
  }
  if (cancel) {
    cancel.disabled = !(state.state === 'printing' || state.state === 'paused');
    cancel.onclick = () => controlAction('cancel');
  }
}

async function controlAction(action) {
  await postJSON(api(`/api/printer/control/${action}`), {});
  await loadPrinterControl();
}

async function sendGcode() {
  const input = $('gcode-input');
  const command = input.value.trim();
  if (!command) return;
  input.value = '';
  await postJSON(api('/api/printer/control/gcode'), { command });
  await loadPrinterConsole();
}

async function loadPrinterConsole() {
  const data = await getJSON(api('/api/printer/control/console'));
  if (isModuleDisabled(data) || !hasData(data) || !data.log) {
    $('gcode-log').innerHTML = '';
    return;
  }
  $('gcode-log').innerHTML = [...data.log].reverse().map(entry => `
    <div><span class="c-cmd">&gt; ${esc(entry.detail)}</span></div>
    <div class="c-detail">ok — ${esc(entry.kind)}</div>`).join('') || '<span class="c-detail">No commands sent yet.</span>';
}

async function loadPrinterControl() {
  const data = await getJSON(api('/api/printer'));
  if (isModuleDisabled(data)) {
    renderControlTab(null);
    $('ctrl-temps').innerHTML = moduleDisabledEmpty('Printer control');
    return;
  }
  if (!hasData(data) || !data.state) {
    renderControlTab(null);
    return;
  }
  renderControlTab(data);
  loadPrinterConsole();
}

/* ---- Filament inventory --------------------------------------------------*/

async function loadFilament() {
  const data = await getJSON('/api/filament');
  const host = $('spool-list');
  const idleNote = $('spool-idle-note');

  if (isModuleDisabled(data)) {
    host.innerHTML = moduleDisabledEmpty('Filament inventory');
    idleNote.hidden = true;
    return;
  }

  const spools = data.spools || [];
  host.innerHTML = spools.length ? spools.map(s => `
    <div class="spool-row">
      <span class="spool-swatch" style="background:${esc(s.color_hex || '#888')}"></span>
      <span class="spool-name">${esc(s.color_name)} ${esc(s.material)}</span>
      <span class="spool-grams ${s.grams_remaining < 80 ? 'is-low' : ''}">${s.grams_remaining.toFixed(0)} g</span>
      <button class="btn small" data-remove-spool="${esc(s.id)}">Remove</button>
    </div>`).join('') : EMPTY('No spools tracked', 'Add one below.');

  host.querySelectorAll('[data-remove-spool]').forEach(btn => {
    btn.addEventListener('click', () => {
      postJSON(api(`/api/filament/spools/${btn.dataset.removeSpool}/remove`), {}).then(loadFilament);
    });
  });

  const idle = data.idle_spools || [];
  if (idle.length) {
    idleNote.hidden = false;
    idleNote.textContent = `${idle[0].color_name} has been loaded ${idle[0].days_loaded.toFixed(0)} days — worth checking it hasn't absorbed moisture.`;
  } else {
    idleNote.hidden = true;
  }
}

function initSpoolForm() {
  $('spool-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const material = $('spool-material').value.trim() || 'PLA';
    const colorName = $('spool-color-name').value.trim() || 'Unnamed';
    const colorHex = $('spool-color-hex').value;
    const grams = parseFloat($('spool-grams').value) || 0;
    await postJSON(api('/api/filament/spools'), {
      material, color_name: colorName, color_hex: colorHex, grams_remaining: grams,
    });
    e.target.reset();
    $('spool-color-hex').value = '#ff7a2f';
    loadFilament();
  });
}

/* ---- What changed? / repeat last settings --------------------------------*/

async function loadCompare() {
  const [compareData, sanityData] = await Promise.all([
    getJSON(api('/api/compare')),
    getJSON(api('/api/sanity')),
  ]);
  const host = $('compare-body');
  const rows = [];

  if (hasData(sanityData) && !isModuleDisabled(sanityData) && sanityData.reasons) {
    if (sanityData.safe_to_print) {
      rows.push(`<div class="crow" style="border-left:3px solid var(--ok);">Safe to print — maintenance, dock, and colour all check out.</div>`);
    } else {
      sanityData.reasons.forEach(msg => rows.push(`<div class="crow" style="border-left:3px solid var(--bad);">${esc(msg)}</div>`));
    }
  }

  if (isModuleDisabled(compareData) && !rows.length) {
    host.innerHTML = moduleDisabledEmpty('What changed?');
    return;
  }
  if (hasData(compareData) && compareData.has_history) {
    compareData.likely_causes.forEach(msg => rows.push(`<div class="crow" style="border-left:3px solid var(--bad);">${esc(msg)}</div>`));
    compareData.differences.forEach(msg => rows.push(`<div class="crow" style="border-left:3px solid var(--warn);">${esc(msg)}</div>`));
  }

  host.innerHTML = rows.length ? rows.join('') : EMPTY('Nothing to check yet', 'Needs a printer connection and print history for this file.');
}

function initRepeatSettings() {
  $('repeat-settings-btn').addEventListener('click', async () => {
    const data = await getJSON(api('/api/compare/repeat'));
    const host = $('repeat-settings-body');
    if (isModuleDisabled(data)) {
      host.innerHTML = moduleDisabledEmpty('What changed?');
      return;
    }
    if (!hasData(data) || data.error) {
      host.innerHTML = `<p class="log-empty">${esc(data.error || 'No successful history for this file yet.')}</p>`;
      return;
    }
    host.innerHTML = `
      <div class="log-row"><span>Filament</span><span>${esc(data.filament_color_name)} ${esc(data.filament_type)}</span></div>
      <div class="log-row"><span>Toolheads used</span><span>${esc(data.toolheads_used.join(', '))}</span></div>
      <div class="log-row"><span>From</span><span>${esc(data.printed_at.slice(0, 10))}</span></div>`;
  });
}

/* ---- Modules ---------------------------------------------------------- */

async function loadModules() {
  const data = await getJSON('/api/modules');
  const host = $('module-list');
  const statusBadge = { ready: 'badge-live', hardware_pending: 'badge-sim', optional: 'badge-optional' };
  const statusLabel = { ready: 'Ready today', hardware_pending: 'Hardware pending', optional: 'Optional' };

  host.innerHTML = (data.modules || []).map(m => `
    <div class="modrow well" style="margin-bottom:8px; border-radius:14px;">
      <div style="flex:1;">
        <div class="mod-name">${esc(m.name)} <span class="badge ${statusBadge[m.status] || 'badge-sim'}">${statusLabel[m.status] || m.status}</span></div>
        <div class="mod-desc">${esc(m.description)}</div>
      </div>
      <label class="switch" style="gap:0;">
        <input type="checkbox" ${m.enabled ? 'checked' : ''} data-module="${esc(m.id)}">
        <span class="switch-track ${m.enabled ? 'is-on' : ''}" aria-hidden="true"><span class="switch-knob"></span></span>
      </label>
    </div>`).join('');

  host.querySelectorAll('[data-module]').forEach(input => {
    input.addEventListener('change', async () => {
      await postJSON(api(`/api/modules/${input.dataset.module}/toggle`), { enabled: input.checked });
      refreshAll();
    });
  });
}

/* ---- Pairing ------------------------------------------------------------*/

async function loadDevices() {
  const data = await getJSON('/api/pairing/devices');
  const devices = data.devices || [];
  const host = $('device-list');
  const count = $('device-count');

  host.innerHTML = devices.length ? devices.map(d => `
    <div class="log-row">
      <span>${esc(d.name)}</span>
      <span>
        <span style="margin-right:8px;">${esc(d.paired_at.slice(0, 10))}</span>
        <button class="btn small" data-unpair="${esc(d.id)}">Unpair</button>
      </span>
    </div>`).join('') : '<p class="log-empty">No devices paired yet.</p>';

  host.querySelectorAll('[data-unpair]').forEach(btn => {
    btn.addEventListener('click', () => {
      postJSON(api(`/api/pairing/devices/${btn.dataset.unpair}/unpair`), {}).then(loadDevices);
    });
  });

  if (devices.length) {
    count.hidden = false;
    count.textContent = `${devices.length} device${devices.length === 1 ? '' : 's'} paired`;
  } else {
    count.hidden = true;
  }
}

function initPairing() {
  $('generate-code-btn').addEventListener('click', async () => {
    const { body } = await postJSON('/api/pairing/code', {});
    $('pairing-code-display').style.display = 'block';
    $('pairing-code-text').textContent = (body.code || '').replace(/(\d{3})(\d{3})/, '$1 $2');
  });

  $('redeem-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const codeInput = $('redeem-code');
    const code = codeInput.value.replace(/\s/g, '');
    const { ok, body } = await postJSON('/api/pairing/redeem', { code, device_name: navigator.userAgent.includes('Mobile') ? 'Phone' : 'Browser' });
    if (ok) {
      codeInput.value = '';
      $('pairing-code-display').style.display = 'none';
      loadDevices();
    } else {
      codeInput.setCustomValidity(body.error || 'Could not pair');
      codeInput.reportValidity();
      codeInput.setCustomValidity('');
    }
  });
}

/* ---- Notifications --------------------------------------------------- */

async function loadNotificationSettings() {
  const data = await getJSON('/api/notifications/settings');
  if (isModuleDisabled(data) || !data) return;
  $('notif-ntfy').value = data.ntfy_topic || '';
  $('notif-discord').value = data.discord_webhook_url || '';
  $('notif-telegram-token').value = data.telegram_bot_token || '';
  $('notif-telegram-chat').value = data.telegram_chat_id || '';
  $('notif-quiet-start').value = data.quiet_hours_start ?? 22;
  $('notif-quiet-end').value = data.quiet_hours_end ?? 7;
}

function initNotifications() {
  $('notif-save').addEventListener('click', async () => {
    await postJSON('/api/notifications/settings', {
      ntfy_topic: $('notif-ntfy').value.trim(),
      discord_webhook_url: $('notif-discord').value.trim(),
      telegram_bot_token: $('notif-telegram-token').value.trim(),
      telegram_chat_id: $('notif-telegram-chat').value.trim(),
      quiet_hours_start: parseInt($('notif-quiet-start').value, 10) || 0,
      quiet_hours_end: parseInt($('notif-quiet-end').value, 10) || 0,
    });
    const btn = $('notif-save');
    const original = btn.textContent;
    btn.textContent = 'Saved';
    setTimeout(() => { btn.textContent = original; }, 1500);
  });

  $('notif-test').addEventListener('click', async () => {
    const btn = $('notif-test');
    const original = btn.textContent;
    btn.textContent = 'Sending…';
    await postJSON('/api/notifications/test', { message: 'Test notification from Deja Vu1' });
    btn.textContent = 'Sent';
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
}

/* ---- Updates ------------------------------------------------------------*/

async function loadUpdates() {
  const data = await getJSON(api('/api/updates'));
  const host = $('updates-body');
  if (isModuleDisabled(data)) {
    host.textContent = 'Updates module is off.';
    return;
  }
  if (!hasData(data) || !data.packages) {
    host.textContent = 'Turn on demo data, or connect a printer, to check for updates.';
    return;
  }
  if (data.updates_available === 0) {
    host.textContent = 'Everything is up to date.';
  } else {
    const names = data.packages.filter(p => p.update_available).map(p => p.name).join(', ');
    host.textContent = `Update available: ${names}.`;
  }
}

/* ---- Print cost ---------------------------------------------------------*/

async function loadCost() {
  const host = $('cost-body');
  const [current, history] = await Promise.all([
    getJSON(api('/api/cost/current')),
    getJSON(api('/api/cost/history')),
  ]);

  if (isModuleDisabled(current)) {
    host.innerHTML = moduleDisabledEmpty('Print cost calculator');
    return;
  }

  const rows = [];
  if (hasData(current) && current.total_cost !== undefined) {
    rows.push(`
      <div class="crow" style="border-left:3px solid var(--accent);">
        <strong>This print, so far:</strong> $${current.cost_so_far.toFixed(2)}
        (est. total once done: $${current.total_cost.toFixed(2)}) — ${Math.round(current.progress * 100)}% complete
      </div>`);
  }

  if (hasData(history) && history.jobs && history.jobs.length) {
    rows.push(...history.jobs.slice(0, 5).map(job => `
      <div class="log-row">
        <span>${esc(job.filename)}</span>
        <span>$${job.total_cost.toFixed(2)} · ${esc(job.filament_type)} ${job.filament_grams.toFixed(0)}g</span>
      </div>`));
  }

  host.innerHTML = rows.length ? rows.join('') : EMPTY('No cost data yet', 'Turn on demo data, or connect a printer, to see estimates.');
}

function initCostSettings() {
  getJSON('/api/cost/settings').then(data => {
    if (!data || isModuleDisabled(data)) return;
    $('cost-electricity').value = data.electricity_rate_per_kwh ?? '';
    $('cost-watts').value = data.printer_watts ?? '';
  });

  $('cost-save-btn').addEventListener('click', async () => {
    const material = $('cost-material').value.trim();
    const price = parseFloat($('cost-price').value);
    const updates = {
      electricity_rate_per_kwh: parseFloat($('cost-electricity').value) || 0,
      printer_watts: parseFloat($('cost-watts').value) || 0,
    };
    if (material && !Number.isNaN(price)) {
      updates.filament_price_per_kg = { [material]: price };
    }
    await postJSON('/api/cost/settings', updates);
    const btn = $('cost-save-btn');
    const original = btn.textContent;
    btn.textContent = 'Saved';
    setTimeout(() => { btn.textContent = original; }, 1500);
    loadCost();
  });
}

/* ---- Smart home bridges: WLED + Home Assistant ---------------------------*/

function initBridges() {
  getJSON('/api/wled/settings').then(data => {
    if (data && !isModuleDisabled(data)) $('wled-host').value = data.host || '';
  });
  getJSON('/api/homeassistant/settings').then(data => {
    if (data && !isModuleDisabled(data)) {
      $('ha-url').value = data.base_url || '';
      $('ha-token').value = data.token || '';
    }
  });

  $('wled-save-btn').addEventListener('click', async () => {
    await postJSON('/api/wled/settings', { host: $('wled-host').value.trim() });
    $('wled-status').textContent = 'Saved.';
  });

  $('wled-test-btn').addEventListener('click', async () => {
    $('wled-status').textContent = 'Testing…';
    const { body } = await postJSON('/api/wled/test', {});
    $('wled-status').textContent = body.ok ? 'WLED device reachable.' : `Could not reach it: ${body.error || 'unknown error'}`;
  });

  $('wled-push-btn').addEventListener('click', async () => {
    $('wled-status').textContent = 'Pushing…';
    const { body } = await postJSON('/api/wled/push', {});
    $('wled-status').textContent = body.ok
      ? `Pushed ${body.segments_sent} ring(s) to WLED.`
      : `Push failed: ${body.error || 'unknown error'}`;
  });

  $('ha-save-btn').addEventListener('click', async () => {
    await postJSON('/api/homeassistant/settings', {
      base_url: $('ha-url').value.trim(), token: $('ha-token').value.trim(),
    });
    $('ha-status').textContent = 'Saved.';
  });

  $('ha-push-btn').addEventListener('click', async () => {
    $('ha-status').textContent = 'Pushing…';
    const { body } = await postJSON('/api/homeassistant/push', {});
    $('ha-status').textContent = body.ok
      ? 'Pushed sensors to Home Assistant.'
      : `Push failed: ${body.error || 'unknown error'}`;
  });
}

/* ==========================================================================
   While You Wait — six fresh offline arcade games

   Rebuilt from the rules of Asteroids, Pong, Minesweeper, Guideline Tetris,
   Pac-Man, and Klondike. This section owns every game timer and listener;
   it never reads printer state and never calls the network.
   ========================================================================== */
let activeGame = null;
let gameStop = () => {};
const gameBest = key => { try { return Number(localStorage.getItem(key)) || 0; } catch (_) { return 0; } };
const setGameBest = (key, value) => { try { localStorage.setItem(key, String(value)); } catch (_) {} };
function gameTools() {
  const clean = [], timers = [];
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); clean.push(() => target.removeEventListener(type, fn, opts)); };
  const every = (fn, ms) => { const id = setInterval(fn, ms); timers.push(id); return id; };
  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
  gameStop = () => { clean.splice(0).forEach(fn => fn()); timers.splice(0).forEach(clearTimeout); gameStop = () => {}; };
  return { on, every, later };
}
function gameFrame(title, help, content) { return `<div class="arcade-frame"><div class="arcade-head"><div><b>${title}</b><span>${help}</span></div></div>${content}</div>`; }
function gameStats(html) { $('game-stats').innerHTML = html; }
function gameFull(host, tools) {
  const button = document.createElement('button'); button.className = 'btn small arcade-full'; button.type = 'button'; button.textContent = '⛶ Fullscreen';
  tools.on(button, 'click', () => { const frame = host.querySelector('.arcade-frame'); if (document.fullscreenElement) document.exitFullscreen?.().catch?.(() => {}); else frame?.requestFullscreen?.().catch?.(() => {}); });
  tools.on(document, 'fullscreenchange', () => { button.textContent = document.fullscreenElement ? '× Exit fullscreen' : '⛶ Fullscreen'; });
  host.querySelector('.arcade-head').appendChild(button);
}
function gameCanvas(host, id, width, height) { const canvas = host.querySelector(`#${id}`); canvas.width = width; canvas.height = height; return [canvas, canvas.getContext('2d')]; }
function stopCurrentGame() { gameStop(); activeGame = null; }
function renderGame(name) { stopCurrentGame(); activeGame = name; ({ asteroids: newAsteroids, pong: newPong, mines: newMines, tetris: newTetris, pacman: newPacman, solitaire: newSolitaire }[name] || newAsteroids)(); }
function startCurrentGame() { const button = document.querySelector('#game-picker button.active'); renderGame(button?.dataset.game || 'asteroids'); }
function initGames() { document.querySelectorAll('#game-picker button').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('#game-picker button').forEach(item => item.classList.toggle('active', item === button)); renderGame(button.dataset.game); })); }
/* The legacy block below is shadowed after script evaluation so only the new arcade runtime is reachable. */
setTimeout(() => {
  stopCurrentGame = () => { gameStop(); activeGame = null; };
  renderGame = name => { stopCurrentGame(); activeGame = name; ({ asteroids: newAsteroids, pong: newPong, mines: newMines, tetris: newTetris, pacman: newPacman, solitaire: newSolitaire }[name] || newAsteroids)(); };
  const picker = $('game-picker');
  if (picker) {
    const cleanPicker = picker.cloneNode(true); picker.replaceWith(cleanPicker);
    cleanPicker.querySelectorAll('button').forEach(button => button.addEventListener('click', () => { cleanPicker.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button)); renderGame(button.dataset.game); }));
    renderGame(cleanPicker.querySelector('button.active')?.dataset.game || 'asteroids');
  }
}, 0);
function arcadeShell(host, title, help, body, stats, tools) { gameStats(stats); host.innerHTML = gameFrame(title, help, body); gameFull(host, tools); }

function newAsteroids() {
  const tools = gameTools(), key = 'dejavu1.asteroids.best', W = 760, H = 440, host = $('game-host');
  /* Classic-fidelity pass, tuned against the 1979 arcade original: all-large
     waves (4, 6, 8, 10, capped at 11), large -> medium -> small splitting,
     20/50/100 scoring with an extra ship every 10,000, big and small saucers
     whose aim sharpens as the score climbs, a hyperspace that can kill you,
     a respawn that waits for a clear center, and touch pads for mobile. */
  arcadeShell(host, 'Asteroids', 'Rotate with the arrows, thrust, and shoot · H hyperspaces at a risk · saucers hunt you as you score', '<canvas id="arcade-asteroids" class="arcade-canvas" aria-label="Asteroids"></canvas><div class="pong-pad"><button class="btn" data-ast="ccw">↺</button><button class="btn" data-ast="fire">◉</button><button class="btn" data-ast="cw">↻</button><button class="btn" data-ast="thrust">▲</button><button class="btn" data-ast="hyper">H</button></div><div class="arcade-overlay" id="asteroids-overlay"><b>ASTEROIDS</b><span>Momentum, wraparound, splitting rocks — and saucers that learn your position.</span><button class="btn primary">Launch</button></div>', `<div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="as-score">0</div></div><div class="game-stat"><div class="g-key">Ships</div><div class="g-val" id="as-lives">3</div></div><div class="game-stat"><div class="g-key">Wave</div><div class="g-val" id="as-wave">1</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="as-best">${gameBest(key) || '—'}</div></div>`, tools);
  const [canvas, ctx] = gameCanvas(host, 'arcade-asteroids', W, H);
  let ship = null, rocks = [], shots = [], sparks = [], saucer = null, saucerTimer = null, score = 0, lives = 3, wave = 1, nextExtra = 10000, playing = false, loop = null, respawnWait = 0;
  const keys = {};
  const wrap = o => { o.x = (o.x + W) % W; o.y = (o.y + H) % H; };
  const makeRock = (x, y, size = 3, speedScale = 1) => ({ x, y, size, r: size * 13, vx: (Math.random() - .5) * 2.2 * speedScale, vy: (Math.random() - .5) * 2.2 * speedScale, spin: (Math.random() - .5) * .05, angle: Math.random() * 6.28, points: Array.from({ length: 9 }, (_, i) => .78 + Math.random() * .35 + Math.sin(i * 2.7) * .04) });
  /* Every wave opens with large rocks only, spread away from the ship, and
     drifts a little faster each wave — the original ramp. */
  const waveRocks = count => { rocks = []; const px = ship ? ship.x : W / 2, py = ship ? ship.y : H / 2; for (let i = 0; i < count; i++) { let x, y; do { x = Math.random() * W; y = Math.random() * H; } while (Math.hypot(x - px, y - py) < 150); rocks.push(makeRock(x, y, 3, 1 + wave * .06)); } };
  const spawnSaucer = () => { const small = score >= 40000 || Math.random() < .35; const fromLeft = Math.random() < .5; saucer = { x: fromLeft ? -22 : W + 22, y: 40 + Math.random() * (H - 80), vx: (small ? 1.9 : 1.1) * (fromLeft ? 1 : -1), vy: (Math.random() - .5) * .9, small, r: small ? 12 : 18, cd: 60 }; };
  const scheduleSaucer = () => { if (saucerTimer) return; saucerTimer = tools.later(() => { saucerTimer = null; if (playing && !saucer) spawnSaucer(); }, 12000 + Math.random() * 9000); };
  function reset() { ship = { x: W / 2, y: H / 2, a: -Math.PI / 2, vx: 0, vy: 0, inv: 120 }; rocks = []; shots = []; sparks = []; saucer = null; score = 0; lives = 3; wave = 1; nextExtra = 10000; respawnWait = 0; playing = true; $('asteroids-overlay').style.display = 'none'; clearInterval(loop); loop = tools.every(tick, 16); waveRocks(4); scheduleSaucer(); }
  function burst(x, y, color = '#ffcf66', count = 12) { for (let i = 0; i < count; i++) sparks.push({ x, y, vx: (Math.random() - .5) * 5, vy: (Math.random() - .5) * 5, life: 1, color }); }
  function awardPoints(points) { score += points; if (score >= nextExtra) { lives++; nextExtra += 10000; burst(W / 2, 24, '#9ef0b1', 14); } }
  /* Four shots in flight, matching the arcade cabinet's shot limit. */
  function fire() { if (!playing || !ship || shots.filter(s => !s.hostile).length >= 4) return; shots.push({ x: ship.x + Math.cos(ship.a) * 15, y: ship.y + Math.sin(ship.a) * 15, vx: ship.vx + Math.cos(ship.a) * 9, vy: ship.vy + Math.sin(ship.a) * 9, life: 60 }); }
  /* Hyperspace is the classic gamble: a small chance of self-destruct, and
     you can rematerialize right on top of a rock. */
  function hyperspace() { if (!playing || !ship) return; burst(ship.x, ship.y, '#65c9ff', 14); ship.x = Math.random() * W; ship.y = Math.random() * H; ship.vx = ship.vy = 0; if (Math.random() < .06) { hitShip(true); return; } ship.inv = 40; }
  function loseGame() { playing = false; clearInterval(loop); loop = null; const best = Math.max(gameBest(key), score); setGameBest(key, best); $('as-best').textContent = best; $('asteroids-overlay').innerHTML = `<b>FIELD LOST</b><span>${score.toLocaleString()} points · wave ${wave}</span><button class="btn primary">Retry</button>`; $('asteroids-overlay').style.display = 'flex'; }
  function hitShip(force) { if (ship.inv > 0 && !force) return; burst(ship.x, ship.y, '#ff806e', 26); ship = null; lives--; if (lives <= 0) { loseGame(); return; } respawnWait = 90; }
  function tick() {
    if (!playing) return;
    if (ship) {
      if (keys.ArrowLeft || keys.KeyA) ship.a -= .082;
      if (keys.ArrowRight || keys.KeyD) ship.a += .082;
      if (keys.ArrowUp || keys.KeyW) { ship.vx += Math.cos(ship.a) * .12; ship.vy += Math.sin(ship.a) * .12; burst(ship.x - Math.cos(ship.a) * 11, ship.y - Math.sin(ship.a) * 11, '#ff9c66', 1); }
      ship.vx *= .991; ship.vy *= .991; ship.x += ship.vx; ship.y += ship.vy; wrap(ship);
      if (ship.inv) ship.inv--;
    } else if (respawnWait > 0) {
      /* Classic respawn discipline: never drop a new ship into danger. */
      respawnWait--;
      if (respawnWait === 0) {
        const danger = rocks.some(r => Math.hypot(W / 2 - r.x, H / 2 - r.y) < r.r + 90) || (saucer && Math.hypot(W / 2 - saucer.x, H / 2 - saucer.y) < 120);
        if (danger) respawnWait = 30; else ship = { x: W / 2, y: H / 2, a: -Math.PI / 2, vx: 0, vy: 0, inv: 150 };
      }
    }
    shots.forEach(s => { s.x += s.vx; s.y += s.vy; s.life--; wrap(s); });
    shots = shots.filter(s => s.life > 0);
    rocks.forEach(r => { r.x += r.vx; r.y += r.vy; r.angle += r.spin; wrap(r); });
    if (saucer) {
      saucer.x += saucer.vx; saucer.y += saucer.vy;
      if (Math.random() < .012) saucer.vy = (Math.random() - .5) * 1.2;
      if (saucer.y < 24 || saucer.y > H - 24) { saucer.y = Math.max(24, Math.min(H - 24, saucer.y)); saucer.vy *= -1; }
      saucer.cd--;
      /* The small saucer leads its shots; its accuracy tightens with score,
         becoming near-hitscan deep into a run, exactly like the original. */
      if (saucer.cd <= 0) {
        saucer.cd = saucer.small ? 34 : 80;
        let angle;
        const aimChance = Math.min(1, .12 + score / 60000);
        if (saucer.small && ship && Math.random() < aimChance) angle = Math.atan2(ship.y - saucer.y, ship.x - saucer.x) + (Math.random() - .5) * Math.max(.05, .5 - score / 80000);
        else angle = Math.random() * Math.PI * 2;
        shots.push({ x: saucer.x, y: saucer.y, vx: Math.cos(angle) * 5.2, vy: Math.sin(angle) * 5.2, life: 70, hostile: true });
      }
      if ((saucer.x < -30 && saucer.vx < 0) || (saucer.x > W + 30 && saucer.vx > 0)) { saucer = null; scheduleSaucer(); }
    }
    for (let si = shots.length - 1; si >= 0; si--) {
      const s = shots[si];
      let consumed = false;
      for (let ri = rocks.length - 1; ri >= 0; ri--) {
        const r = rocks[ri];
        if (Math.hypot(s.x - r.x, s.y - r.y) < r.r) {
          shots.splice(si, 1); rocks.splice(ri, 1);
          awardPoints(r.size === 3 ? 20 : r.size === 2 ? 50 : 100);
          burst(r.x, r.y);
          if (r.size > 1) { const childSpeed = 1 + wave * .06 + (3 - r.size) * .25; rocks.push(makeRock(r.x, r.y, r.size - 1, childSpeed), makeRock(r.x, r.y, r.size - 1, childSpeed)); }
          if (!rocks.length && !saucer) { wave++; $('as-wave').textContent = wave; waveRocks(Math.min(4 + (wave - 1) * 2, 11)); }
          consumed = true;
          break;
        }
      }
      if (consumed) continue;
      if (saucer && Math.hypot(s.x - saucer.x, s.y - saucer.y) < saucer.r + 3) { shots.splice(si, 1); awardPoints(saucer.small ? 1000 : 200); burst(saucer.x, saucer.y, '#ff8e68', 22); saucer = null; scheduleSaucer(); continue; }
      if (s.hostile && ship && Math.hypot(s.x - ship.x, s.y - ship.y) < 12) { shots.splice(si, 1); hitShip(); }
    }
    if (ship) {
      rocks.forEach(r => { if (Math.hypot(ship.x - r.x, ship.y - r.y) < r.r + 8) hitShip(); });
      if (ship && saucer && Math.hypot(ship.x - saucer.x, ship.y - saucer.y) < saucer.r + 10) hitShip();
    }
    sparks.forEach(p => { p.x += p.vx; p.y += p.vy; p.life -= .04; });
    sparks = sparks.filter(p => p.life > 0);
    draw();
  }
  function draw() {
    ctx.fillStyle = '#07111e'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    for (let i = 0; i < 55; i++) ctx.fillRect((i * 137) % W, (i * 71) % H, 1, 1);
    if (ship) {
      ctx.save(); ctx.translate(ship.x, ship.y); ctx.rotate(ship.a);
      ctx.globalAlpha = ship.inv && Math.floor(ship.inv / 6) % 2 ? .25 : 1;
      ctx.strokeStyle = '#f4f7ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-11, -10); ctx.lineTo(-7, 0); ctx.lineTo(-11, 10); ctx.closePath(); ctx.stroke();
      ctx.restore(); ctx.globalAlpha = 1;
    }
    rocks.forEach(r => {
      ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(r.angle);
      ctx.strokeStyle = r.size === 3 ? '#9eb7ca' : r.size === 2 ? '#d1a96d' : '#ff8e68';
      ctx.beginPath();
      r.points.forEach((p, i) => { const a = i * Math.PI * 2 / r.points.length; const x = Math.cos(a) * r.r * p, y = Math.sin(a) * r.r * p; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath(); ctx.stroke(); ctx.restore();
    });
    if (saucer) {
      ctx.save(); ctx.translate(saucer.x, saucer.y);
      ctx.strokeStyle = saucer.small ? '#ff6e6e' : '#d1a96d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 0, saucer.r, saucer.r * .55, 0, 0, 7);
      ctx.moveTo(-saucer.r, 0); ctx.lineTo(saucer.r, 0);
      ctx.moveTo(-saucer.r * .45, -saucer.r * .55); ctx.lineTo(saucer.r * .45, -saucer.r * .55);
      ctx.stroke(); ctx.restore();
    }
    shots.forEach(s => { ctx.fillStyle = s.hostile ? '#ff8e68' : '#ffe69b'; ctx.beginPath(); ctx.arc(s.x, s.y, 2.2, 0, 7); ctx.fill(); });
    sparks.forEach(p => { ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 3, 3); });
    ctx.globalAlpha = 1;
    $('as-score').textContent = score.toLocaleString();
    $('as-lives').textContent = lives;
  }
  /* Hold-to-move pads register on pointerdown; a document-wide pointerup and
     pointercancel release them, so a finger sliding off a button cannot leave
     thrust or rotation stuck on. */
  const padMap = { ccw: 'ArrowLeft', cw: 'ArrowRight', thrust: 'ArrowUp', fire: 'Space', hyper: 'KeyH' };
  document.querySelectorAll('[data-ast]').forEach(button => { button.style.touchAction = 'none'; });
  document.querySelectorAll('[data-ast]').forEach(button => {
    const code = padMap[button.dataset.ast];
    tools.on(button, 'pointerdown', e => {
      e.preventDefault();
      if (code === 'Space') { if (playing) fire(); else reset(); return; }
      if (code === 'KeyH') { hyperspace(); return; }
      keys[code] = true;
    });
  });
  const releasePads = () => { keys.ArrowLeft = keys.ArrowRight = keys.ArrowUp = false; };
  tools.on(document, 'pointerup', releasePads);
  tools.on(document, 'pointercancel', releasePads);
  const input = event => {
    if (event.code === 'Space') { event.preventDefault(); if (event.type === 'keydown') { if (playing) fire(); else reset(); } return; }
    if (event.code === 'KeyH') { if (event.type === 'keydown') hyperspace(); return; }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyD', 'KeyS'].includes(event.code)) { event.preventDefault(); keys[event.code] = event.type === 'keydown'; }
  };
  tools.on(document, 'keydown', input);
  tools.on(document, 'keyup', input);
  tools.on(canvas, 'pointerdown', () => { if (!playing) reset(); else fire(); });
  tools.on(host.querySelector('.arcade-overlay button'), 'click', reset);
  ship = { x: W / 2, y: H / 2, a: -Math.PI / 2, vx: 0, vy: 0, inv: 0 };
  waveRocks(4);
  draw();
}

function newPong() {
  const tools = gameTools(), key = 'dejavu1.pong.best', W = 760, H = 420, host = $('game-host');
  arcadeShell(host, 'Pong', 'Move the left paddle · first to 11 · angle comes from where you hit', '<canvas id="arcade-pong" class="arcade-canvas"></canvas><div class="arcade-overlay" id="pong-overlay"><b>PONG</b><span>Beat the adaptive opponent. Center hits stay flat; edge hits cut sharp angles.</span><button class="btn primary">Serve</button></div>', `<div class="game-stat"><div class="g-key">You</div><div class="g-val" id="po-you">0</div></div><div class="game-stat"><div class="g-key">Rally</div><div class="g-val" id="po-rally">0</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="po-best">${gameBest(key) || '—'}</div></div>`, tools);
  const [canvas, ctx] = gameCanvas(host, 'arcade-pong', W, H); let p = H / 2 - 45, ai = p, ball, you = 0, them = 0, rally = 0, playing = false, loop;
  function reset() { p = H / 2 - 45; ai = p; ball = { x: W / 2, y: H / 2, vx: 5, vy: (Math.random() - .5) * 4 }; you = them = rally = 0; playing = true; $('pong-overlay').style.display = 'none'; loop = tools.every(tick, 16); }
  function serve(direction) { ball = { x: W / 2, y: H / 2, vx: direction * (5 + Math.min(2, rally * .08)), vy: (Math.random() - .5) * 4 }; }
  function point(won) { if (won) you++; else them++; rally = 0; if (you >= 11 || them >= 11) { playing = false; clearInterval(loop); const best = Math.max(gameBest(key), you); setGameBest(key, best); $('po-best').textContent = best; $('pong-overlay').innerHTML = `<b>${you > them ? 'MATCH WON' : 'MATCH LOST'}</b><span>${you} — ${them}</span><button class="btn primary">Rematch</button>`; $('pong-overlay').style.display = 'flex'; } else serve(won ? 1 : -1); }
  function tick() { if (!playing) return; ball.x += ball.vx; ball.y += ball.vy; if (ball.y < 10 || ball.y > H - 10) ball.vy *= -1; const target = ball.vx > 0 ? ball.y - 42 : H / 2 - 45; ai += Math.max(-3.8, Math.min(3.8, target - ai)) * .08; if (ball.x < 38 && ball.x > 22 && ball.y > p - 8 && ball.y < p + 98 && ball.vx < 0) { ball.x = 38; const impact = (ball.y - (p + 45)) / 45; ball.vx = Math.min(9, Math.abs(ball.vx) * 1.045); ball.vy = impact * 5.2; rally++; } if (ball.x > W - 38 && ball.x < W - 22 && ball.y > ai - 8 && ball.y < ai + 98 && ball.vx > 0) { ball.x = W - 38; const impact = (ball.y - (ai + 45)) / 45; ball.vx = -Math.min(9, Math.abs(ball.vx) * 1.045); ball.vy = impact * 5.2; rally++; } if (ball.x < -20) point(false); if (ball.x > W + 20) point(true); draw(); }
  function draw() { ctx.fillStyle = '#101827'; ctx.fillRect(0, 0, W, H); ctx.setLineDash([8, 12]); ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.beginPath(); ctx.moveTo(W/2, 0); ctx.lineTo(W/2, H); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#f8fbff'; ctx.fillRect(22, p, 16, 90); ctx.fillStyle = '#ff9c66'; ctx.fillRect(W - 38, ai, 16, 90); ctx.fillStyle = '#ffe69b'; ctx.beginPath(); ctx.arc(ball?.x || W/2, ball?.y || H/2, 8, 0, 7); ctx.fill(); $('po-you').textContent = you; $('po-rally').textContent = rally; }
  const steer = event => { const rect = canvas.getBoundingClientRect(); p = Math.max(0, Math.min(H - 90, (event.clientY - rect.top) / rect.height * H - 45)); }; tools.on(canvas, 'pointermove', steer); tools.on(canvas, 'pointerdown', () => { if (!playing) reset(); }); tools.on(host.querySelector('.arcade-overlay button'), 'click', reset); draw();
}

function newMines() {
  const tools = gameTools(), key = 'dejavu1.mines.best', S = 9, M = 10, host = $('game-host');
  arcadeShell(host, 'Minesweeper', 'Reveal safe ground · right-click or long-press to flag · clear every non-mine tile', '<div class="mine-layout"><div class="mine-board" id="mine-board"></div><div class="mine-side"><div class="mine-face" id="mine-face">🙂</div><p id="mine-message">First reveal is always safe.</p><button class="btn" id="mine-new">New field</button></div></div>', `<div class="game-stat"><div class="g-key">Mines</div><div class="g-val" id="mi-count">10</div></div><div class="game-stat"><div class="g-key">Time</div><div class="g-val" id="mi-time">0</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="mi-best">${gameBest(key) || '—'}</div></div>`, tools);
  const board = $('mine-board'); let cells, started, over, flags, seconds, timer;
  function newGame() { cells = Array.from({ length: S * S }, () => ({ mine: false, open: false, flag: false, n: 0 })); started = over = false; flags = seconds = 0; clearInterval(timer); board.innerHTML = ''; for (let i = 0; i < S * S; i++) { const button = document.createElement('button'); button.className = 'mine-cell'; button.dataset.i = i; board.appendChild(button); } draw(); }
  const neighbors = i => { const r = Math.floor(i / S), c = i % S, out = []; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if ((dr || dc) && rr >= 0 && rr < S && cc >= 0 && cc < S) out.push(rr * S + cc); } return out; };
  function plant(first) { const safe = new Set([first, ...neighbors(first)]), choices = [...Array(S * S).keys()].filter(i => !safe.has(i)); for (let i = choices.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [choices[i], choices[j]] = [choices[j], choices[i]]; } choices.slice(0, M).forEach(i => cells[i].mine = true); cells.forEach((cell, i) => { cell.n = neighbors(i).filter(n => cells[n].mine).length; }); started = true; timer = tools.every(() => { seconds++; $('mi-time').textContent = seconds; }, 1000); }
  function reveal(i) { if (over || cells[i].flag || cells[i].open) return; if (!started) plant(i); cells[i].open = true; if (cells[i].mine) { over = true; cells.forEach(c => { if (c.mine) c.open = true; }); $('mine-face').textContent = '💥'; $('mine-message').textContent = 'Field lost — start another sweep.'; clearInterval(timer); draw(); return; } if (!cells[i].n) neighbors(i).forEach(reveal); const safe = cells.filter(c => !c.mine && c.open).length; if (safe === S * S - M) { over = true; clearInterval(timer); const best = gameBest(key); if (!best || seconds < best) { setGameBest(key, seconds); $('mi-best').textContent = seconds; } $('mine-face').textContent = '😎'; $('mine-message').textContent = 'Clear field. Clean sweep.'; } draw(); }
  function flag(i) { if (over || cells[i].open) return; cells[i].flag = !cells[i].flag; flags += cells[i].flag ? 1 : -1; draw(); }
  function draw() { [...board.children].forEach((button, i) => { const c = cells[i]; button.className = `mine-cell ${c.open ? 'open' : ''} ${c.flag ? 'flag' : ''} ${c.mine && c.open ? 'mine' : ''}`; button.textContent = c.flag ? '⚑' : c.open ? (c.mine ? '✹' : c.n || '') : ''; button.style.setProperty('--n', c.n); }); $('mi-count').textContent = M - flags; }
  tools.on(board, 'click', e => { const cell = e.target.closest('.mine-cell'); if (cell) reveal(Number(cell.dataset.i)); }); tools.on(board, 'contextmenu', e => { e.preventDefault(); const cell = e.target.closest('.mine-cell'); if (cell) flag(Number(cell.dataset.i)); }); tools.on($('mine-new'), 'click', newGame); newGame();
}

function newTetris() {
  const tools = gameTools(), key = 'dejavu1.tetris.best', W = 300, H = 600, host = $('game-host'), shapes = [ [[1,1,1,1]], [[1,0,0],[1,1,1]], [[0,0,1],[1,1,1]], [[1,1],[1,1]], [[0,1,1],[1,1,0]], [[0,1,0],[1,1,1]], [[1,1,0],[0,1,1]] ], colors = ['#52d6ff','#527cff','#ff9f52','#ffd452','#57d88a','#bd75ee','#ee5c6f'];
  arcadeShell(host, 'Tetris', '← → move · ↑ rotate · ↓ soft drop · Space hard drop · C hold', '<div class="tetris-layout"><canvas id="arcade-tetris" class="tetris-canvas"></canvas><aside class="tetris-side"><b>NEXT</b><div id="te-next"></div><b>HOLD</b><div id="te-hold">—</div><button class="btn" id="te-new">New stack</button></aside></div>', `<div class="game-stat"><div class="g-key">Lines</div><div class="g-val" id="te-lines">0</div></div><div class="game-stat"><div class="g-key">Level</div><div class="g-val" id="te-level">1</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="te-best">${gameBest(key) || '—'}</div></div>`, tools);
  const [canvas, ctx] = gameCanvas(host, 'arcade-tetris', W, H), C = 30; let board, bag, next, current, hold, usedHold, lines, score, over, loop, fall;
  const clone = shape => shape.map(row => row.slice()); const piece = id => ({ id, shape: clone(shapes[id]), x: 3, y: 0 }); const shuffle = a => { for (let i = a.length - 1; i; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
  function drawNext() { $('te-next').innerHTML = ''; const p = document.createElement('div'); p.className = 'tetromino-preview'; next.slice(0, 3).forEach(id => { const s = document.createElement('span'); s.textContent = ['I','J','L','O','S','T','Z'][id]; s.style.color = colors[id]; p.appendChild(s); }); $('te-next').appendChild(p); $('te-hold').textContent = hold == null ? '—' : ['I','J','L','O','S','T','Z'][hold]; }
  function take() { if (!bag.length) bag = shuffle([0,1,2,3,4,5,6]); return bag.pop(); } function collide(p, dx = 0, dy = 0, shape = p.shape) { return shape.some((row, r) => row.some((v, c) => v && (p.x + c + dx < 0 || p.x + c + dx >= 10 || p.y + r + dy >= 20 || board[p.y + r + dy]?.[p.x + c + dx]))); }
  function rotate(p) { const s = p.shape, r = s[0].map((_, i) => s.map(row => row[i]).reverse()); if (!collide(p, 0, 0, r)) p.shape = r; else if (!collide(p, -1, 0, r)) { p.x--; p.shape = r; } else if (!collide(p, 1, 0, r)) { p.x++; p.shape = r; } }
  function lock() { current.shape.forEach((row, r) => row.forEach((v, c) => { if (v) board[current.y + r][current.x + c] = current.id + 1; })); const cleared = board.filter(row => row.every(Boolean)).length; board = board.filter(row => !row.every(Boolean)); while (board.length < 20) board.unshift(Array(10).fill(0)); const pts = [0,100,300,500,800][cleared] || 0; score += pts * Math.max(1, Math.floor(lines / 10) + 1); lines += cleared; current = piece(next.shift()); next.push(take()); usedHold = false; if (collide(current)) { over = true; clearInterval(loop); const best = Math.max(gameBest(key), score); setGameBest(key, best); $('te-best').textContent = best; } drawNext(); }
  function drop(hard = false) { if (over) return; let moved = 0; while (!collide(current, 0, 1)) { current.y++; moved++; if (!hard) break; } if (hard) score += moved * 2; if (!hard && collide(current, 0, 1)) lock(); else if (hard) lock(); }
  function start() { board = Array.from({ length: 20 }, () => Array(10).fill(0)); bag = []; next = [take(),take(),take(),take(),take(),take()]; hold = null; usedHold = false; lines = score = 0; over = false; current = piece(next.shift()); next.push(take()); clearInterval(loop); fall = 650; loop = tools.every(() => drop(), fall); drawNext(); draw(); }
  function draw() { ctx.fillStyle = '#0d1624'; ctx.fillRect(0,0,W,H); ctx.strokeStyle = 'rgba(255,255,255,.05)'; for (let x=0;x<=10;x++){ctx.beginPath();ctx.moveTo(x*C,0);ctx.lineTo(x*C,H);ctx.stroke();} for (let y=0;y<=20;y++){ctx.beginPath();ctx.moveTo(0,y*C);ctx.lineTo(W,y*C);ctx.stroke();} const ghost = { ...current, shape: clone(current.shape) }; while (!collide(ghost,0,1)) ghost.y++; const drawPiece = (p, alpha = 1) => { ctx.globalAlpha = alpha; p.shape.forEach((row,r)=>row.forEach((v,c)=>{if(v){ctx.fillStyle=colors[p.id];ctx.fillRect((p.x+c)*C+2,(p.y+r)*C+2,C-4,C-4);}}));ctx.globalAlpha=1;}; board?.forEach((row,r)=>row.forEach((v,c)=>{if(v){ctx.fillStyle=colors[v-1];ctx.fillRect(c*C+2,r*C+2,C-4,C-4);}})); if(current&&!over) drawPiece(ghost,.16); if(current) drawPiece(current); $('te-lines').textContent=lines; $('te-level').textContent=Math.max(1,Math.floor(lines/10)+1); }
  const onKey = e => { if (['ArrowLeft','ArrowRight','ArrowDown','ArrowUp','Space','KeyC'].includes(e.code)) e.preventDefault(); if(e.code==='ArrowLeft'&&!collide(current,-1))current.x--; if(e.code==='ArrowRight'&&!collide(current,1))current.x++; if(e.code==='ArrowDown')drop(); if(e.code==='ArrowUp')rotate(current); if(e.code==='Space')drop(true); if(e.code==='KeyC'&&!usedHold){const id=current.id;if(hold==null){hold=id;current=piece(next.shift());next.push(take());}else{const swap=hold;hold=id;current=piece(swap);}usedHold=true;drawNext();} draw(); }; tools.on(document,'keydown',onKey); tools.on($('te-new'),'click',start); tools.on(canvas,'pointerdown',start); start();
}

function newPacman() {
  const tools = gameTools(), key = 'dejavu1.pacman.best', W = 570, H = 630, host = $('game-host'), map = ['###################','#........#........#','#.###.###.#.###.###','#o###.###.#.###.##o','#.................#','#.###.#.#####.#.###','#.....#...#...#...#','#####.### # ###.#####','    #.#       #.#    ','#####.# ## ## #.#####','#.........#.........#','#####.#.#####.#.#####','    #.#...#...#.#    ','#######.###.#######','#.................#','#.###.###.#.###.###','#o..#.....#.....#..o#','###.#.#.#####.#.#.###','#.....#...#...#.....#','#.######## ########.#','###################'];
  arcadeShell(host, 'Pac-Man', 'Arrow keys / WASD · eat every dot · power pellets turn the ghosts blue', `<canvas id="arcade-pacman" class="arcade-canvas"></canvas><div class="arcade-overlay" id="pac-overlay"><b>MAZE CHASE</b><span>Four personalities, one hungry maze.</span><button class="btn primary">Start run</button></div>`, `<div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="pa-score">0</div></div><div class="game-stat"><div class="g-key">Lives</div><div class="g-val" id="pa-lives">3</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="pa-best">${gameBest(key) || '—'}</div></div>`, tools);
  const [canvas,ctx]=gameCanvas(host,'arcade-pacman',W,H), rows=map.length, cols=19, cell=30; let grid, player, ghosts, score, lives, power, dots, playing, loop, wanted='left';
  const walk=(r,c)=>{const cc=(c+cols)%cols;return r>=0&&r<rows&&map[r][cc]!=='#'&&map[r][cc]!==' ';}; const pos=(r,c)=>({x:c*cell+cell/2,y:r*cell+cell/2});
  function reset() { grid=map.map(row=>row.padEnd(cols,' ').split('').map(ch=>ch==='.'||ch==='o'?ch:null)); dots=grid.flat().filter(Boolean).length; score=0;lives=3;power=0; player={r:16,c:9,dir:'left'}; ghosts=[{r:10,c:8,dir:'left',color:'#ef5350',mode:0},{r:10,c:9,dir:'right',color:'#f6a6d5',mode:1},{r:10,c:10,dir:'up',color:'#55ddea',mode:2},{r:12,c:9,dir:'left',color:'#ffb05a',mode:3}];playing=true;$('pac-overlay').style.display='none';loop=tools.every(tick,130); }
  const dirs={left:[0,-1],right:[0,1],up:[-1,0],down:[1,0]}; const turn=(r,c,d)=>walk(r+dirs[d][0],c+dirs[d][1]);
  function bfs(start,target) { const q=[start], prev=new Map([[`${start.r},${start.c}`,null]]); while(q.length){const p=q.shift();if(p.r===target.r&&p.c===target.c)break;for(const d of ['up','left','down','right']){const n={r:p.r+dirs[d][0],c:(p.c+dirs[d][1]+cols)%cols},k=`${n.r},${n.c}`;if(walk(n.r,n.c)&&!prev.has(k)){prev.set(k,{...p,d});q.push(n);}}}let p=target;while(prev.has(`${p.r},${p.c}`)&&prev.get(`${p.r},${p.c}`)){const z=prev.get(`${p.r},${p.c}`);if(z.r===start.r&&z.c===start.c)return z.d;p=z;}return null;}
  function loseLife(){lives--;if(!lives){playing=false;clearInterval(loop);const best=Math.max(gameBest(key),score);setGameBest(key,best);$('pa-best').textContent=best;$('pac-overlay').innerHTML=`<b>GAME OVER</b><span>${score} points</span><button class="btn primary">Try again</button>`;$('pac-overlay').style.display='flex';}else{player={r:16,c:9,dir:'left'};ghosts.forEach((g,i)=>Object.assign(g,{r:10,c:8+i%3}));}}
  function tick(){if(!playing)return; if(turn(player.r,player.c,wanted))player.dir=wanted;if(turn(player.r,player.c,player.dir)){player.r+=dirs[player.dir][0];player.c=(player.c+dirs[player.dir][1]+cols)%cols;}const item=grid[player.r][player.c];if(item){grid[player.r][player.c]=null;dots--;score+=item==='o'?50:10;if(item==='o')power=45;}ghosts.forEach((g,i)=>{if(power){const options=['up','left','down','right'].filter(d=>walk(g.r+dirs[d][0],g.c+dirs[d][1]));g.dir=options[Math.floor(Math.random()*options.length)];}else{const target=i===0?player:i===1?{r:player.r+dirs[player.dir][0]*4,c:player.c+dirs[player.dir][1]*4}:i===2?{r:player.r+dirs[player.dir][0]*2,c:player.c+dirs[player.dir][1]*2}:{r:player.r,c:player.c};g.dir=bfs(g,{r:Math.max(0,Math.min(rows-1,target.r)),c:(target.c+cols)%cols})||g.dir;}if(walk(g.r+dirs[g.dir][0],g.c+dirs[g.dir][1])){g.r+=dirs[g.dir][0];g.c=(g.c+dirs[g.dir][1]+cols)%cols;}if(g.r===player.r&&g.c===player.c){if(power){score+=200;g.r=10;g.c=9;}else loseLife();}});if(power)power--;if(!dots){playing=false;clearInterval(loop);score+=500;const best=Math.max(gameBest(key),score);setGameBest(key,best);$('pa-best').textContent=best;$('pac-overlay').innerHTML=`<b>MAZE CLEARED</b><span>${score} points</span><button class="btn primary">Next maze</button>`;$('pac-overlay').style.display='flex';}draw();}
  function draw(){ctx.fillStyle='#070d1a';ctx.fillRect(0,0,W,H);for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){if(map[r][c]==='#'){ctx.fillStyle='#203f9c';ctx.fillRect(c*cell+2,r*cell+2,cell-4,cell-4);}const v=grid[r][c];if(v){ctx.fillStyle=v==='o'?'#ffdb70':'#f3e7c5';ctx.beginPath();ctx.arc(c*cell+15,r*cell+15,v==='o'?7:2,0,7);ctx.fill();}}const pp=pos(player.r,player.c);ctx.fillStyle='#ffd447';ctx.beginPath();ctx.arc(pp.x,pp.y,11,0,7);ctx.fill();ghosts.forEach(g=>{const p=pos(g.r,g.c);ctx.fillStyle=power?'#6a88ff':g.color;ctx.beginPath();ctx.arc(p.x,p.y,11,Math.PI,0);ctx.lineTo(p.x+11,p.y+10);ctx.lineTo(p.x+5,p.y+6);ctx.lineTo(p.x,p.y+10);ctx.lineTo(p.x-5,p.y+6);ctx.lineTo(p.x-11,p.y+10);ctx.closePath();ctx.fill();});$('pa-score').textContent=score;$('pa-lives').textContent=lives;}
  const onKey=e=>{const d={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',KeyA:'left',KeyD:'right',KeyW:'up',KeyS:'down'}[e.code];if(d){e.preventDefault();wanted=d;} };tools.on(document,'keydown',onKey);tools.on(host.querySelector('.arcade-overlay button'),'click',reset);tools.on(canvas,'pointerdown',()=>{if(!playing)reset();});reset();
}

function newSolitaire() {
  const tools=gameTools(), key='dejavu1.solitaire.best', host=$('game-host'); arcadeShell(host,'Klondike','Click a face-up card, then click a legal destination · double-click sends to foundation','<div class="solitaire" id="solitaire-board"><div class="sol-top"><button class="card-slot" id="so-stock">▣</button><button class="card-slot" id="so-waste">—</button><div class="foundations" id="so-foundations"></div></div><div class="tableau" id="so-tableau"></div><div class="sol-actions"><button class="btn" id="so-new">New deal</button><span id="so-message"></span></div></div>',`<div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="so-score">0</div></div><div class="game-stat"><div class="g-key">Moves</div><div class="g-val" id="so-moves">0</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="so-best">${gameBest(key)||'—'}</div></div>`,tools);
  const suits=['♠','♥','♦','♣'], red=new Set(['♥','♦']); let stock,waste,tableau,found,selected,moves,won;
  const deck=()=>suits.flatMap(s=>Array.from({length:13},(_,i)=>({s,n:i+1,up:false,id:`${s}${i+1}`}))); const label=c=>`${c.n===1?'A':c.n===11?'J':c.n===12?'Q':c.n===13?'K':c.n}${c.s}`; const color=c=>red.has(c.s)?'red':'black';
  function deal(){let d=deck();for(let i=d.length-1;i;i--){const j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]];}tableau=Array.from({length:7},()=>[]);for(let col=0;col<7;col++)for(let r=0;r<=col;r++){const c=d.pop();c.up=r===col;tableau[col].push(c);}stock=d.map(c=>({...c,up:false}));waste=[];found=Array.from({length:4},()=>[]);selected=null;moves=0;won=false;draw();}
  function canTableau(card,col){const pile=tableau[col], top=pile[pile.length-1];return top?top.up&&top.n===card.n+1&&color(top)!==color(card):card.n===13;}
  function canFoundation(card,i){const pile=found[i],top=pile[pile.length-1];return card.s===suits[i]&&(top?top.n+1===card.n:card.n===1);}
  function flip(pile){if(pile.length&&!pile[pile.length-1].up){pile[pile.length-1].up=true;scoreChange(5);}}
  function scoreChange(n){$('so-score').textContent=Number($('so-score').textContent)+n;}
  function moveCard(card,from,to){if(from.type==='tableau'){const pile=tableau[from.i],idx=pile.indexOf(card);tableau[from.i]=pile.slice(0,idx);tableau[to.i].push(...pile.slice(idx));flip(tableau[from.i]);}else if(from.type==='waste')waste.pop();to.type==='foundation'?found[to.i].push(card):tableau[to.i].push(card);moves++;selected=null;draw();}
  function clickCard(card,from){if(!card.up)return;if(selected){if(from.type==='tableau'&&canTableau(selected.card,from.i))moveCard(selected.card,selected.from,{type:'tableau',i:from.i});else if(from.type==='foundation'&&canFoundation(selected.card,from.i))moveCard(selected.card,selected.from,{type:'foundation',i:from.i});else if(from.type==='waste'&&canFoundation(selected.card,from.i))moveCard(selected.card,selected.from,{type:'foundation',i:from.i});else selected=null;}else selected={card,from};draw();}
  function draw(){const tab=$('so-tableau');tab.innerHTML='';tableau.forEach((pile,i)=>{const col=document.createElement('div');col.className='sol-col';pile.forEach((c,j)=>{const b=document.createElement('button');b.className=`playing-card ${c.up?'up':'down'} ${color(c)}`;b.textContent=c.up?label(c):'◆';b.style.top=`${j*25}px`;b.onclick=()=>clickCard(c,{type:'tableau',i});col.appendChild(b);});const drop=document.createElement('button');drop.className='sol-drop';drop.textContent='K';drop.onclick=()=>{if(selected&&canTableau(selected.card,i))moveCard(selected.card,selected.from,{type:'tableau',i});};col.appendChild(drop);tab.appendChild(col);});const fs=$('so-foundations');fs.innerHTML='';found.forEach((pile,i)=>{const b=document.createElement('button');b.className='card-slot';b.textContent=pile.length?label(pile[pile.length-1]):suits[i];b.onclick=()=>{if(selected&&canFoundation(selected.card,i))moveCard(selected.card,selected.from,{type:'foundation',i});};fs.appendChild(b);});$('so-waste').textContent=waste.length?label(waste[waste.length-1]):'—';$('so-stock').textContent=stock.length?'▣':'↻';$('so-moves').textContent=moves;if(found.every(p=>p.length===13)){won=true;$('so-message').textContent='Deck complete';const best=Math.max(gameBest(key),Number($('so-score').textContent));setGameBest(key,best);$('so-best').textContent=best;}}
  tools.on($('so-stock'),'click',()=>{if(stock.length)waste.push(stock.pop());else{stock=waste.reverse().map(c=>({...c,up:false}));waste=[];}draw();});tools.on($('so-waste'),'click',()=>{if(waste.length)clickCard(waste[waste.length-1],{type:'waste'});});tools.on($('so-new'),'click',deal);deal();
}


let gamesCleanupV2 = () => {};
let gameToastTimeoutsV2 = [];
function gamesToolsV2() {
  const events = [], intervals = [], timeouts = [];
  const on = (target, type, handler, options) => { target.addEventListener(type, handler, options); events.push(() => target.removeEventListener(type, handler, options)); };
  const every = (handler, ms) => { const id = setInterval(handler, ms); intervals.push(id); return id; };
  const later = (handler, ms) => { const id = setTimeout(handler, ms); timeouts.push(id); return id; };
  gamesCleanupV2 = () => { events.splice(0).forEach(remove => remove()); intervals.splice(0).forEach(id => clearInterval(id)); timeouts.splice(0).forEach(id => clearTimeout(id)); gameToastTimeoutsV2.splice(0).forEach(id => clearTimeout(id)); };
  return { on, every, later };
}
const gameBestV2 = key => readBest(key) || 0;
const randomV2 = max => Math.floor(Math.random() * max);
function gameShellV2(title, help, body) { return `<div class="game-frame"><div class="game-toolbar"><div><strong>${title}</strong><span>${help}</span></div></div>${body}</div>`; }
function gameToastV2(host, text, kind = '') { const toast = document.createElement('div'); toast.className = `game-toast ${kind}`; toast.textContent = text; host.appendChild(toast); const timeout = setTimeout(() => toast.remove(), 850); gameToastTimeoutsV2.push(timeout); }
function gameFullscreenV2(host, tools) {
  const button = document.createElement('button'); button.className = 'btn small game-fullscreen'; button.type = 'button'; button.textContent = '⛶ Fullscreen';
  tools.on(button, 'click', () => { const target = host.querySelector('.game-frame') || host; if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; } const request = target.requestFullscreen?.(); request?.catch?.(() => {}); });
  tools.on(document, 'fullscreenchange', () => { button.textContent = document.fullscreenElement ? '× Exit fullscreen' : '⛶ Fullscreen'; });
  host.querySelector('.game-toolbar').appendChild(button);
}
const stopLegacyGamesV2 = stopCurrentGame;
stopCurrentGame = () => { stopLegacyGamesV2(); gamesCleanupV2(); gamesCleanupV2 = () => {}; };
renderGame = name => { stopCurrentGame(); activeGame = name; const games = { skydash: skyDashV2, echomaze: echoMazeV2, beacon: blockWorldV2, stacker: blockStackerV2, merge: mergePuzzleV2, breakout: brickBreakV2 }; (games[name] || skyDashV2)(); };

/* Sky Dash: persistent one-button flight with forgiving hitboxes and streaks. */
function skyDashV2() {
  const tools = gamesToolsV2(), BEST_KEY = 'dejavu1.skydash.best', W = 680, H = 390;
  $('game-stats').innerHTML = `<div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="s2-score">0</div></div><div class="game-stat"><div class="g-key">Streak</div><div class="g-val" id="s2-streak">0</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="s2-best">${gameBestV2(BEST_KEY) || '—'}</div></div>`;
  $('game-host').innerHTML = gameShellV2('Sky Dash', 'Tap, click, or press Space to flap · thread the pipes', `<div class="game-stage game-surface sky-v2" id="s2-stage"><div class="sky-sun"></div><div class="sky-clouds"></div><div class="sky-bird" id="s2-bird">◆</div><div class="sky-pops" id="s2-pops"></div><div class="game-overlay" id="s2-overlay"><div class="g-title">Sky Dash</div><div class="g-sub">Find your rhythm, then keep a clean streak through the gates.</div><button class="btn primary" type="button">Start flight</button></div></div>`);
  const stage = $('s2-stage'), bird = $('s2-bird'); let status = 'ready', y = H / 2, velocity = 0, score = 0, streak = 0, pipes = [], timer = null;
  gameFullscreenV2($('game-host'), tools);
  function draw() {
    bird.style.top = `${y / H * 100}%`; bird.style.transform = `translateY(-50%) rotate(${Math.max(-25, Math.min(65, velocity * 4))}deg)`;
    stage.querySelectorAll('.sky-pipe').forEach(el => el.remove());
    pipes.forEach(pipe => [['top', 0, pipe.gap - pipe.size / 2], ['bottom', pipe.gap + pipe.size / 2, H]].forEach(([side, top, bottom]) => { const el = document.createElement('i'); el.className = `sky-pipe ${side}`; el.style.left = `${pipe.x / W * 100}%`; el.style.top = `${top / H * 100}%`; el.style.height = `${Math.max(0, (bottom - top) / H * 100)}%`; stage.appendChild(el); }));
    $('s2-score').textContent = score; $('s2-streak').textContent = streak; const overlay = $('s2-overlay'); overlay.style.display = status === 'playing' ? 'none' : 'flex';
    if (status === 'dead') overlay.innerHTML = `<div class="g-title">Flight ended</div><div class="g-sub">${score} gates · ${streak > 1 ? `a ${streak}-gate streak` : 'start a clean streak'}</div><button class="btn primary" type="button">Fly again</button>`;
  }
  function start() { status = 'playing'; y = H / 2; velocity = 0; score = 0; streak = 0; pipes = []; timer = tools.every(tick, 20); flap(); }
  function flap() { if (status !== 'playing') start(); velocity = -8.5; bird.classList.add('is-flapping'); tools.later(() => bird.classList.remove('is-flapping'), 110); draw(); }
  function tick() {
    velocity = Math.min(11, velocity + .48); y += velocity; const speed = Math.min(7, 3.5 + score * .1); pipes = pipes.map(pipe => ({ ...pipe, x: pipe.x - speed })).filter(pipe => pipe.x > -68); const last = pipes[pipes.length - 1];
    if (!last || last.x < W - 250) pipes.push({ x: W, gap: 108 + Math.random() * 144, size: Math.max(92, 150 - score * 1.5), passed: false }); let hit = y < 14 || y > H - 14;
    pipes.forEach(pipe => { if (!pipe.passed && pipe.x + 55 < 92) { pipe.passed = true; score++; streak++; if (streak > 2) gameToastV2($('s2-pops'), `Clean line ×${streak}`, 'sky-toast'); } if (pipe.x < 107 && pipe.x + 55 > 75 && (y < pipe.gap - pipe.size / 2 + 9 || y > pipe.gap + pipe.size / 2 - 9)) hit = true; });
    if (hit) { status = 'dead'; clearInterval(timer); timer = null; const best = Math.max(gameBestV2(BEST_KEY), score); saveBest(BEST_KEY, best); $('s2-best').textContent = best; } draw();
  }
  const input = event => { if (event.type === 'keydown' && event.code !== 'Space') return; event.preventDefault(); flap(); }; tools.on(stage, 'pointerdown', input); tools.on(document, 'keydown', input); draw();
}

/* Echo Maze: a first-person CSS room, memory map, and BFS pursuer. */
function echoMazeV2() {
  const tools = gamesToolsV2(), BEST_KEY = 'dejavu1.echomaze.bestlevel'; let size = 9, level = 1, grid, player, echo, facing = 0, steps = 0, status = 'ready';
  const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]], cellKey = (r, c) => `${r},${c}`;
  $('game-stats').innerHTML = `<div class="game-stat"><div class="g-key">Level</div><div class="g-val" id="e2-level">1</div></div><div class="game-stat"><div class="g-key">Steps</div><div class="g-val" id="e2-steps">0</div></div><div class="game-stat"><div class="g-key">Echo distance</div><div class="g-val" id="e2-echo">—</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="e2-best">${gameBestV2(BEST_KEY) || '—'}</div></div>`;
  $('game-host').innerHTML = gameShellV2('Echo Maze', 'WASD / arrows move · turn in the 3D room · escape the Echo', `<div class="maze-layout"><div><div class="game-stage game-surface maze-v2" id="e2-stage"><div class="maze-camera"><div class="maze-room" id="e2-room"><div class="maze-ceiling"></div><div class="maze-floor"></div><div class="maze-wall3d front" id="e2-front"></div><div class="maze-wall3d left" id="e2-left"></div><div class="maze-wall3d right" id="e2-right"></div><div class="maze-beacon">◆</div></div></div><div class="maze-vignette"></div><div class="game-overlay" id="e2-overlay"><div class="g-title">Echo Maze</div><div class="g-sub">Reach the green beacon. The red Echo uses the shortest route through every opening.</div><button class="btn primary" type="button">Enter maze</button></div></div><div class="maze-controls"><button class="btn" data-maze-action="left">↶ Turn left</button><button class="btn primary" data-maze-action="forward">Move forward</button><button class="btn" data-maze-action="right">Turn right ↷</button></div></div><aside class="maze-side"><div class="maze-map-v2" id="e2-map"></div><div class="maze-legend">● You &nbsp; ◆ Exit &nbsp; ■ Echo</div><button class="btn" id="e2-new" type="button">New maze</button></aside></div>`);
  const stage = $('e2-stage'), map = $('e2-map'), room = $('e2-room'); gameFullscreenV2($('game-host'), tools);
  function generate() { grid = Array.from({ length: size }, () => Array.from({ length: size }, () => ({ walls: [1, 1, 1, 1], seen: false }))); const visited = new Set(); function carve(r, c) { visited.add(cellKey(r, c)); [[0, 1, 1, 3], [1, 0, 2, 0], [-1, 0, 0, 2], [0, -1, 3, 1]].sort(() => Math.random() - .5).forEach(([dr, dc, wall, opposite]) => { const nr = r + dr, nc = c + dc; if (nr < 0 || nr >= size || nc < 0 || nc >= size || visited.has(cellKey(nr, nc))) return; grid[r][c].walls[wall] = 0; grid[nr][nc].walls[opposite] = 0; carve(nr, nc); }); } carve(0, 0); player = { r: 0, c: 0 }; echo = { r: size - 1, c: 0 }; facing = 0; steps = 0; status = 'ready'; grid[0][0].seen = true; draw(); }
  function nextEchoStep(from, target) { const queue = [from], came = new Map([[cellKey(from.r, from.c), null]]); while (queue.length) { const current = queue.shift(); if (current.r === target.r && current.c === target.c) break; grid[current.r][current.c].walls.forEach((wall, direction) => { if (wall) return; const nr = current.r + DIRS[direction][0], nc = current.c + DIRS[direction][1], next = cellKey(nr, nc); if (nr >= 0 && nr < size && nc >= 0 && nc < size && !came.has(next)) { came.set(next, current); queue.push({ r: nr, c: nc }); } }); } let current = target; if (!came.has(cellKey(current.r, current.c))) return from; while (came.get(cellKey(current.r, current.c))) { const parent = came.get(cellKey(current.r, current.c)); if (parent.r === from.r && parent.c === from.c) return current; current = parent; } return current; }
  function draw() { const current = grid[player.r][player.c], left = (facing + 3) % 4, right = (facing + 1) % 4; [['e2-front', current.walls[facing]], ['e2-left', current.walls[left]], ['e2-right', current.walls[right]]].forEach(([id, solid]) => $(id).classList.toggle('open', !solid)); const distance = Math.abs(player.r - echo.r) + Math.abs(player.c - echo.c); room.classList.toggle('danger', status === 'playing' && distance <= 3); $('e2-level').textContent = level; $('e2-steps').textContent = steps; $('e2-echo').textContent = status === 'won' ? 'escaped' : `${distance} rooms`; map.innerHTML = ''; grid.forEach((row, r) => row.forEach((cell, c) => { const dot = document.createElement('i'); dot.className = !cell.seen ? 'fog' : r === player.r && c === player.c ? 'you' : r === echo.r && c === echo.c ? 'echo' : r === size - 1 && c === size - 1 ? 'goal' : ''; map.appendChild(dot); })); const overlay = $('e2-overlay'); overlay.style.display = status === 'playing' ? 'none' : 'flex'; if (status === 'won') overlay.innerHTML = `<div class="g-title">Beacon found</div><div class="g-sub">${steps} steps · level ${level} cleared</div><button class="btn primary" type="button">Next level</button>`; }
  function begin() { if (status === 'ready') { status = 'playing'; draw(); } }
  function move(direction) { if (status === 'won') { level = Math.min(12, level + 1); size = Math.min(12, 8 + level); generate(); begin(); return; } begin(); if (direction === 'left') { facing = (facing + 3) % 4; draw(); return; } if (direction === 'right') { facing = (facing + 1) % 4; draw(); return; } const cell = grid[player.r][player.c]; if (cell.walls[facing]) { gameToastV2(stage, 'A wall blocks the way', 'maze-toast'); return; } player.r += DIRS[facing][0]; player.c += DIRS[facing][1]; grid[player.r][player.c].seen = true; steps++; echo = nextEchoStep(echo, player); if (echo.r === player.r && echo.c === player.c) { gameToastV2(stage, 'The Echo caught you — back to the entrance', 'maze-toast'); player = { r: 0, c: 0 }; echo = { r: size - 1, c: 0 }; } if (player.r === size - 1 && player.c === size - 1) { status = 'won'; const best = Math.max(gameBestV2(BEST_KEY), level); saveBest(BEST_KEY, best); $('e2-best').textContent = best; } draw(); }
  const onKey = event => { const direction = { ArrowUp: 'forward', ArrowDown: 'back', ArrowLeft: 'left', ArrowRight: 'right', w: 'forward', s: 'back', a: 'left', d: 'right' }[event.key]; if (!direction) return; event.preventDefault(); if (direction === 'back') { facing = (facing + 2) % 4; move('forward'); } else move(direction); }; tools.on(document, 'keydown', onKey); tools.on(stage, 'pointerdown', event => { if (event.target.closest('.game-overlay')) move('forward'); }); document.querySelectorAll('[data-maze-action]').forEach(button => tools.on(button, 'click', () => move(button.dataset.mazeAction))); tools.on($('e2-new'), 'click', generate); generate();
}

/* Block World: a genuinely large chunk-loaded voxel valley. */
function blockWorldV2() {
  const tools = gamesToolsV2(), BEST_KEY = 'dejavu1.beacon.best', WORLD_W = 120, WORLD_H = 84, CHUNK = 8, VIEW_W = 31, VIEW_H = 21;
  let x = 60, y = 42, facing = { x: 0, y: -1 }, wood = 0, stone = 0, ore = 0, gatheredWood = 0, gatheredOre = 0, builtCount = 0, selected = 'wood', status = 'ready', frame = 0, keys = {}, resources = new Map(), removed = new Set(), built = new Map(), loadedChunks = new Set(), critters = [];
  const key = (a, b) => `${a},${b}`; const hash = (a, b) => { const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return value - Math.floor(value); };
  $('game-stats').innerHTML = `<div class="game-stat"><div class="g-key">Valley</div><div class="g-val">120 × 84</div></div><div class="game-stat"><div class="g-key">Wood</div><div class="g-val" id="w2-wood">0</div></div><div class="game-stat"><div class="g-key">Ore</div><div class="g-val" id="w2-ore">0</div></div><div class="game-stat"><div class="g-key">Best day</div><div class="g-val accent" id="w2-best">${gameBestV2(BEST_KEY) || '—'}</div></div>`;
  $('game-host').innerHTML = gameShellV2('Block World', '120 × 84 valley · WASD / arrows · Space mine · E build', `<div class="world-layout"><div class="game-stage game-surface block-world-v2" id="w2-stage"><div class="world-grid" id="w2-grid"></div><div class="world-player">◆</div><div class="world-crosshair">+</div><div class="world-hud" id="w2-hud">Day 1 · Morning · Grassland</div><div class="game-overlay" id="w2-overlay"><div class="g-title">Block World</div><div class="g-sub">A real valley to wander: streamed chunks, persistent resources, buildable shelters, and wildlife that reacts when you get close.</div><button class="btn primary" type="button">Enter the valley</button></div></div><aside class="world-panel"><div class="world-card"><b>Inventory</b><span>🪵 <em id="w2-wood">0</em> wood</span><span>◆ <em id="w2-ore">0</em> ore</span><span>▣ <em id="w2-stone">0</em> stone</span></div><div class="world-card"><b>Daily quest</b><span id="w2-quest">Gather 3 wood · 3 ore · build 3 blocks</span><div class="quest-bar"><i id="w2-quest-fill"></i></div></div><div class="world-actions"><button class="btn" id="w2-mine" type="button">⛏ Mine ahead</button><button class="btn primary" id="w2-build" type="button">▣ Build <span id="w2-selected">wood</span></button></div><div class="world-hotbar"><button class="selected" data-material="wood">🪵 wood</button><button data-material="stone">▣ stone</button><button data-material="torch">✦ torch</button></div><div class="touch-pad"><button data-world-move="up">▲</button><button data-world-move="left">◀</button><button data-world-move="down">▼</button><button data-world-move="right">▶</button></div><p class="world-help">WASD / arrows move · Space mine · E build · Q torch</p></aside></div>`);
  const stage = $('w2-stage'), gridHost = $('w2-grid'); gameFullscreenV2($('game-host'), tools);
  function terrain(wx, wy) { const wave = Math.sin(wx * .15) + Math.cos(wy * .12) + Math.sin((wx + wy) * .07); if (wave < -1.35) return 'water'; if (wave < -.65) return 'sand'; if (wave > 1.45) return 'stone'; if (hash(wx, wy) > .73) return 'forest'; return 'grass'; }
  function nodeAt(wx, wy) { const nodeKey = key(wx, wy); if (removed.has(nodeKey) || built.has(nodeKey)) return null; if (!resources.has(nodeKey)) { let kind = null; if ((wx === 59 && wy === 42) || (wx === 61 && wy === 42) || (terrain(wx, wy) === 'forest' && hash(wx + 9, wy - 3) < .23)) kind = 'wood'; else if ((wx === 60 && wy === 41) || (terrain(wx, wy) === 'stone' && hash(wx - 5, wy + 8) < .28)) kind = 'ore'; else if ((wx === 60 && wy === 43) || (terrain(wx, wy) === 'stone' && hash(wx + 4, wy + 4) < .2)) kind = 'stone'; resources.set(nodeKey, kind); } return resources.get(nodeKey); }
  function ensureChunks() { const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK); for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) loadedChunks.add(key(cx + dx, cy + dy)); }
  function draw() { ensureChunks(); const centerX = Math.floor(x), centerY = Math.floor(y), minX = Math.max(0, Math.min(WORLD_W - VIEW_W, centerX - 15)), minY = Math.max(0, Math.min(WORLD_H - VIEW_H, centerY - 10)); gridHost.innerHTML = ''; for (let wy = minY; wy < minY + VIEW_H; wy++) for (let wx = minX; wx < minX + VIEW_W; wx++) { const cell = document.createElement('i'), pos = { left: (wx - minX) / VIEW_W * 100, top: (wy - minY) / VIEW_H * 100 }; cell.className = `world-cell ${terrain(wx, wy)}${built.has(key(wx, wy)) ? ` built ${built.get(key(wx, wy))}` : ''}`; cell.style.left = `${pos.left}%`; cell.style.top = `${pos.top}%`; gridHost.appendChild(cell); const node = nodeAt(wx, wy); if (node) { const resource = document.createElement('i'); resource.className = `world-resource ${node}`; resource.style.left = `${pos.left + 1}%`; resource.style.top = `${pos.top + 1}%`; gridHost.appendChild(resource); } } critters.forEach(critter => { if (critter.x < minX - 1 || critter.x > minX + VIEW_W || critter.y < minY - 1 || critter.y > minY + VIEW_H) return; const creature = document.createElement('i'); creature.className = 'world-critter'; creature.style.left = `${(critter.x - minX) / VIEW_W * 100 + 1}%`; creature.style.top = `${(critter.y - minY) / VIEW_H * 100 + 1}%`; gridHost.appendChild(creature); }); const day = Math.max(1, Math.floor(frame / 720) + 1), evening = frame % 720 >= 360, quest = Math.min(1, (Math.min(gatheredWood, 3) + Math.min(gatheredOre, 3) + Math.min(builtCount, 3)) / 9); $('w2-wood').textContent = wood; $('w2-ore').textContent = ore; $('w2-stone').textContent = stone; $('w2-selected').textContent = selected; $('w2-quest-fill').style.width = `${quest * 100}%`; $('w2-quest').textContent = quest >= 1 ? 'Quest complete · build a landmark next' : `Gather ${Math.max(0, 3 - gatheredWood)} wood · ${Math.max(0, 3 - gatheredOre)} ore · build ${Math.max(0, 3 - builtCount)} blocks`; $('w2-hud').textContent = `Day ${day} · ${evening ? 'Evening' : 'Morning'} · ${terrain(centerX, centerY)} · chunks ${loadedChunks.size}`; stage.classList.toggle('night', evening); if (quest >= 1) { const best = Math.max(gameBestV2(BEST_KEY), day); saveBest(BEST_KEY, best); $('w2-best').textContent = best; } }
  function target() { return { x: Math.max(0, Math.min(WORLD_W - 1, Math.round(x + facing.x))), y: Math.max(0, Math.min(WORLD_H - 1, Math.round(y + facing.y))) }; }
  function mine() { if (status !== 'playing') return; const spot = target(), nodeKey = key(spot.x, spot.y); if (built.has(nodeKey)) { const kind = built.get(nodeKey); built.delete(nodeKey); if (kind === 'wood') wood++; else if (kind === 'stone') stone++; else ore++; gameToastV2(stage, `Removed ${kind} block`); draw(); return; } const kind = nodeAt(spot.x, spot.y); if (!kind) { gameToastV2(stage, 'Face a glowing tree, vein, or stone'); return; } removed.add(nodeKey); resources.set(nodeKey, null); if (kind === 'wood') { wood++; gatheredWood++; } else if (kind === 'ore') { ore++; gatheredOre++; } else stone++; gameToastV2(stage, `+1 ${kind}`, 'world-toast'); draw(); }
  function build() { if (status !== 'playing') return; const spot = target(), nodeKey = key(spot.x, spot.y); if (terrain(spot.x, spot.y) === 'water' || built.has(nodeKey) || nodeAt(spot.x, spot.y)) { gameToastV2(stage, 'That block is occupied'); return; } const cost = selected === 'wood' ? wood : selected === 'stone' ? stone : ore; if (cost < 1) { gameToastV2(stage, `Need ${selected} to build`); return; } if (selected === 'wood') wood--; else if (selected === 'stone') stone--; else ore--; built.set(nodeKey, selected); builtCount++; gameToastV2(stage, `${selected} block placed`, 'world-toast'); draw(); }
  function start() { if (status === 'playing') return; status = 'playing'; critters = [{ x: 55, y: 39, dx: 1, dy: 0, t: 20 }, { x: 66, y: 45, dx: -1, dy: 0, t: 40 }, { x: 74, y: 35, dx: 0, dy: 1, t: 70 }, { x: 42, y: 52, dx: 1, dy: 0, t: 10 }]; draw(); tools.every(tick, 45); }
  function tick() { if (status !== 'playing') return; frame++; const dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0); if (dx || dy) { const length = Math.hypot(dx, dy); facing = { x: Math.round(dx / length), y: Math.round(dy / length) }; const nx = Math.max(1, Math.min(WORLD_W - 2, x + dx / length * .22)), ny = Math.max(1, Math.min(WORLD_H - 2, y + dy / length * .22)); if (terrain(Math.round(nx), Math.round(ny)) !== 'water') { x = nx; y = ny; } } critters.forEach(critter => { if (--critter.t <= 0) { critter.dx = randomV2(3) - 1; critter.dy = randomV2(3) - 1; critter.t = 30 + randomV2(60); } const awayX = critter.x - x, awayY = critter.y - y, distance = Math.hypot(awayX, awayY); if (distance < 4) { critter.x += Math.sign(awayX) * .12 || .08; critter.y += Math.sign(awayY) * .12 || .08; } else { critter.x += critter.dx * .035; critter.y += critter.dy * .035; } critter.x = Math.max(1, Math.min(WORLD_W - 2, critter.x)); critter.y = Math.max(1, Math.min(WORLD_H - 2, critter.y)); }); if (frame % 2 === 0) draw(); }
  const keyMap = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' }, onKey = event => { if (keyMap[event.code]) { event.preventDefault(); keys[keyMap[event.code]] = true; } if (event.code === 'Space') { event.preventDefault(); mine(); } if (event.code === 'KeyE') { event.preventDefault(); build(); } if (event.code === 'KeyQ') { selected = 'torch'; draw(); } }, offKey = event => { if (keyMap[event.code]) keys[keyMap[event.code]] = false; }, release = () => { keys = {}; };
  tools.on(document, 'keydown', onKey); tools.on(document, 'keyup', offKey); tools.on(document, 'pointerup', release); tools.on(document, 'pointercancel', release); tools.on(stage, 'pointerdown', event => { if (event.target.closest('.game-overlay')) start(); }); tools.on($('w2-mine'), 'click', mine); tools.on($('w2-build'), 'click', build); document.querySelectorAll('[data-material]').forEach(button => tools.on(button, 'click', () => { selected = button.dataset.material; document.querySelectorAll('[data-material]').forEach(item => item.classList.toggle('selected', item === button)); draw(); })); document.querySelectorAll('[data-world-move]').forEach(button => { const direction = button.dataset.worldMove, down = event => { event.preventDefault(); keys[direction] = true; }, up = () => { keys[direction] = false; }; tools.on(button, 'pointerdown', down); tools.on(button, 'pointerup', up); tools.on(button, 'pointercancel', up); tools.on(button, 'pointerleave', up); }); draw();
}

/* Block Stacker: swing, clip, lean, and three chances to recover. */
function blockStackerV2() {
  const tools = gamesToolsV2(), BEST_KEY = 'dejavu1.stacker.best', W = 360; let blocks = [], moving = null, height = 0, combo = 0, misses = 0, status = 'ready', timer = null;
  $('game-stats').innerHTML = `<div class="game-stat"><div class="g-key">Height</div><div class="g-val" id="t2-height">0</div></div><div class="game-stat"><div class="g-key">Combo</div><div class="g-val" id="t2-combo">0</div></div><div class="game-stat"><div class="g-key">Misses</div><div class="g-val" id="t2-misses">0 / 3</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="t2-best">${gameBestV2(BEST_KEY) || '—'}</div></div>`;
  $('game-host').innerHTML = gameShellV2('Block Stacker', 'Click, tap, or press Space · perfect alignment builds the tower', `<div class="game-stage game-surface stack-v2" id="t2-stage"><div class="stack-skyline"></div><div class="stack-crane" id="t2-crane"></div><div class="stack-tower" id="t2-tower"></div><div class="game-overlay" id="t2-overlay"><div class="g-title">Block Stacker</div><div class="g-sub">The crane swings. Drop three clean floors to steady your tower.</div><button class="btn primary" type="button">Start stacking</button></div></div>`);
  const stage = $('t2-stage'), tower = $('t2-tower'); gameFullscreenV2($('game-host'), tools); const colors = ['#ff9c66', '#7fb2ff', '#5cc16f', '#e0475f', '#f2c14e'];
  function spawn() { moving = { x: 0, w: blocks.length ? blocks[blocks.length - 1].w : 108, dir: 1 }; }
  function draw() { tower.innerHTML = ''; blocks.slice(-15).forEach((block, index) => { const el = document.createElement('i'); el.className = block.perfect ? 'perfect' : ''; el.style.left = `${block.x / W * 100}%`; el.style.width = `${block.w / W * 100}%`; el.style.bottom = `${index * 27}px`; el.style.background = block.color; tower.appendChild(el); }); if (moving && status === 'playing') { const el = document.createElement('i'); el.className = 'stack-moving'; el.style.left = `${moving.x / W * 100}%`; el.style.width = `${moving.w / W * 100}%`; el.style.bottom = `${Math.min(height, 14) * 27}px`; el.style.background = colors[height % colors.length]; tower.appendChild(el); $('t2-crane').style.left = `${(moving.x + moving.w / 2) / W * 100}%`; } $('t2-height').textContent = height; $('t2-combo').textContent = combo; $('t2-misses').textContent = `${misses} / 3`; $('t2-overlay').style.display = status === 'playing' ? 'none' : 'flex'; if (status === 'dead') $('t2-overlay').innerHTML = `<div class="g-title">Tower tilted</div><div class="g-sub">Height ${height} · combo ${combo} · ${misses} misses</div><button class="btn primary" type="button">Try again</button>`; }
  function start() { if (timer) clearInterval(timer); blocks = []; moving = null; height = 0; combo = 0; misses = 0; status = 'playing'; spawn(); timer = tools.every(tick, 20); draw(); }
  function tick() { if (status !== 'playing' || !moving) return; moving.x += moving.dir * (4.2 + height * .28); if (moving.x <= 0 || moving.x + moving.w >= W) moving.dir *= -1; draw(); }
  function drop() { if (status !== 'playing') { start(); return; } const previous = blocks[blocks.length - 1]; if (!previous) blocks.push({ x: moving.x, w: moving.w, color: colors[0], perfect: true }); else { const overlap = Math.min(previous.x + previous.w, moving.x + moving.w) - Math.max(previous.x, moving.x); if (overlap < 8) { misses++; combo = 0; if (misses >= 3) { status = 'dead'; clearInterval(timer); timer = null; const best = Math.max(gameBestV2(BEST_KEY), height); saveBest(BEST_KEY, best); $('t2-best').textContent = best; } else { gameToastV2(stage, `${3 - misses} chances left`); spawn(); } draw(); return; } const perfect = overlap >= moving.w - 9; combo = perfect ? combo + 1 : 0; blocks.push({ x: perfect ? previous.x : Math.max(previous.x, moving.x), w: perfect ? moving.w : overlap, color: colors[height % colors.length], perfect }); if (perfect) gameToastV2(stage, combo > 1 ? `Perfect ×${combo}` : 'Perfect!', 'stack-toast'); } height++; spawn(); draw(); }
  const action = event => { if (event.type === 'keydown' && event.code !== 'Space') return; event.preventDefault(); drop(); }; tools.on(stage, 'pointerdown', action); tools.on(document, 'keydown', action); draw();
}

/* Merge Puzzle: faithful 2048 rules, touch swipe, hint, and undo. */
function mergePuzzleV2() {
  const tools = gamesToolsV2(), BEST_KEY = 'dejavu1.merge.best', N = 4; let grid = [], score = 0, undo = null, over = false, won = false;
  const empty = () => Array.from({ length: N }, () => Array(N).fill(0));
  $('game-stats').innerHTML = `<div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="q2-score">0</div></div><div class="game-stat"><div class="g-key">Largest</div><div class="g-val" id="q2-max">2</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="q2-best">${gameBestV2(BEST_KEY) || '—'}</div></div>`;
  $('game-host').innerHTML = gameShellV2('Merge Puzzle', 'Swipe or use arrows · keep your largest tile in a corner', `<div class="merge-v2"><div class="merge-board" id="q2-board"></div><div class="merge-controls"><button class="btn" data-merge-direction="up">↑</button><button class="btn" data-merge-direction="left">←</button><button class="btn" data-merge-direction="down">↓</button><button class="btn" data-merge-direction="right">→</button></div><div class="merge-tools"><button class="btn" id="q2-undo" type="button">↩ Undo</button><button class="btn" id="q2-hint" type="button">💡 Hint</button><button class="btn primary" id="q2-new" type="button">New run</button></div><div class="merge-message" id="q2-message"></div></div>`);
  const board = $('q2-board'); gameFullscreenV2($('game-host'), tools);
  function addTile() { const spaces = []; grid.forEach((row, r) => row.forEach((value, c) => { if (!value) spaces.push([r, c]); })); if (spaces.length) { const [r, c] = spaces[randomV2(spaces.length)]; grid[r][c] = Math.random() < .9 ? 2 : 4; } }
  function collapse(values) { const compact = values.filter(Boolean), result = [], gained = []; for (let i = 0; i < compact.length; i++) { if (compact[i] === compact[i + 1]) { result.push(compact[i] * 2); gained.push(compact[i] * 2); i++; } else result.push(compact[i]); } while (result.length < N) result.push(0); return { result, gained }; }
  function simulate(direction) { const next = empty(), gains = []; for (let index = 0; index < N; index++) { const values = []; for (let step = 0; step < N; step++) { const r = direction === 'up' ? step : direction === 'down' ? N - 1 - step : index; const c = direction === 'left' ? step : direction === 'right' ? N - 1 - step : index; values.push(grid[r][c]); } const line = collapse(values); gains.push(...line.gained); line.result.forEach((value, step) => { const r = direction === 'up' ? step : direction === 'down' ? N - 1 - step : index; const c = direction === 'left' ? step : direction === 'right' ? N - 1 - step : index; next[r][c] = value; }); } return { next, gained: gains.reduce((a, b) => a + b, 0), changed: JSON.stringify(next) !== JSON.stringify(grid) }; }
  function hasMoves() { return grid.some((row, r) => row.some((value, c) => !value || grid[r + 1]?.[c] === value || row[c + 1] === value)); }
  function evaluate(candidate) { let spaces = 0, smooth = 0, max = 0; candidate.forEach((row, r) => row.forEach((value, c) => { if (!value) spaces++; max = Math.max(max, value); if (value && candidate[r]?.[c + 1]) smooth -= Math.abs(Math.log2(value) - Math.log2(candidate[r][c + 1])); if (value && candidate[r + 1]?.[c]) smooth -= Math.abs(Math.log2(value) - Math.log2(candidate[r + 1][c])); })); const corners = [candidate[0][0], candidate[0][3], candidate[3][0], candidate[3][3]]; return spaces * 8 + smooth * 2 + (corners.includes(max) ? max * .5 : 0); }
  function move(direction) { if (over) return; const result = simulate(direction); if (!result.changed) return; undo = { grid: grid.map(row => row.slice()), score }; grid = result.next; score += result.gained; addTile(); saveBest(BEST_KEY, Math.max(gameBestV2(BEST_KEY), score)); if (grid.some(row => row.includes(2048))) won = true; over = !hasMoves(); draw(); }
  function draw() { board.innerHTML = ''; grid.forEach(row => row.forEach(value => { const tile = document.createElement('i'); tile.className = value ? `tile t${Math.min(15, Math.log2(value))}` : ''; tile.textContent = value || ''; board.appendChild(tile); })); $('q2-score').textContent = score; $('q2-max').textContent = Math.max(...grid.flat()); $('q2-best').textContent = gameBestV2(BEST_KEY) || '—'; $('q2-undo').disabled = !undo; const message = $('q2-message'); message.textContent = over ? `No more moves · score ${score}` : won ? '2048 reached — keep going for a bigger tile.' : ''; message.classList.toggle('is-win', won); }
  function newGame() { grid = empty(); score = 0; undo = null; over = false; won = false; addTile(); addTile(); draw(); }
  const onKey = event => { const direction = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[event.key]; if (direction) { event.preventDefault(); move(direction); } }; tools.on(document, 'keydown', onKey); document.querySelectorAll('[data-merge-direction]').forEach(button => tools.on(button, 'click', () => move(button.dataset.mergeDirection))); tools.on($('q2-undo'), 'click', () => { if (undo && !over) { grid = undo.grid; score = undo.score; undo = null; draw(); } }); tools.on($('q2-new'), 'click', newGame); tools.on($('q2-hint'), 'click', () => { const directions = ['up', 'left', 'down', 'right']; const best = directions.map(direction => ({ direction, result: simulate(direction) })).filter(item => item.result.changed).sort((a, b) => evaluate(b.result.next) - evaluate(a.result.next))[0]; if (!best) return; board.classList.remove('hint'); void board.offsetWidth; board.classList.add('hint'); gameToastV2(board, `Try ${best.direction}`, 'merge-toast'); });
  let startX = 0, startY = 0; tools.on(board, 'pointerdown', event => { startX = event.clientX; startY = event.clientY; }); tools.on(board, 'pointerup', event => { const dx = event.clientX - startX, dy = event.clientY - startY; if (Math.max(Math.abs(dx), Math.abs(dy)) >= 24) move(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up'); }); newGame();
}

/* Brick Break: paddle physics, lives, armored bricks, and capsules. */
function brickBreakV2() {
  const tools = gamesToolsV2(), BEST_KEY = 'dejavu1.breakout.best', W = 520, H = 380, COLS = 10; let paddleX = W / 2, paddleWidth = 94, balls = [], bricks = [], capsules = [], lives = 3, score = 0, level = 1, status = 'ready', timer = null, wideTicks = 0;
  const powerups = [{ kind: 'wide', label: 'W', color: '#34c759' }, { kind: 'multi', label: 'M', color: '#7fb2ff' }, { kind: 'slow', label: 'S', color: '#e0475f' }];
  $('game-stats').innerHTML = `<div class="game-stat"><div class="g-key">Level</div><div class="g-val" id="b2-level">1</div></div><div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="b2-score">0</div></div><div class="game-stat"><div class="g-key">Lives</div><div class="g-val" id="b2-lives">3</div></div><div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="b2-best">${gameBestV2(BEST_KEY) || '—'}</div></div>`;
  $('game-host').innerHTML = gameShellV2('Brick Break', 'Drag the paddle · catch capsules · armored bricks take two hits', `<div class="game-stage game-surface brick-v2" id="b2-stage"><div class="brick-paddle" id="b2-paddle"></div><div class="game-overlay" id="b2-overlay"><div class="g-title">Brick Break</div><div class="g-sub">Keep the ball alive, use the walls, and clear the pattern.</div><button class="btn primary" type="button">Launch ball</button></div></div>`);
  const stage = $('b2-stage'); gameFullscreenV2($('game-host'), tools);
  function setupLevel() { bricks = []; const rows = Math.min(4 + level, 8); for (let row = 0; row < rows; row++) for (let col = 0; col < COLS; col++) bricks.push({ x: col * W / COLS + 3, y: 24 + row * 22, w: W / COLS - 6, h: 17, hp: (row + level) % 4 === 0 ? 2 : 1 }); const speed = 4.4 + level * .2; balls = [{ x: W / 2, y: H - 52, vx: speed * .7, vy: -speed }]; capsules = []; wideTicks = 0; }
  function effectiveWidth() { return wideTicks > 0 ? Math.min(paddleWidth * 1.5, 180) : paddleWidth; }
  function draw() { stage.querySelectorAll('.brick,.brick-ball,.brick-capsule').forEach(el => el.remove()); bricks.forEach(brick => { if (!brick.hp) return; const el = document.createElement('i'); el.className = `brick ${brick.hp > 1 ? 'armored' : ''}`; el.style.left = `${brick.x / W * 100}%`; el.style.top = `${brick.y / H * 100}%`; el.style.width = `${brick.w / W * 100}%`; el.style.height = `${brick.h / H * 100}%`; stage.appendChild(el); }); balls.forEach(ball => { const el = document.createElement('i'); el.className = 'brick-ball'; el.style.left = `${ball.x / W * 100}%`; el.style.top = `${ball.y / H * 100}%`; stage.appendChild(el); }); capsules.forEach(capsule => { const el = document.createElement('i'); el.className = 'brick-capsule'; el.textContent = capsule.label; el.style.left = `${capsule.x / W * 100}%`; el.style.top = `${capsule.y / H * 100}%`; el.style.background = capsule.color; stage.appendChild(el); }); const width = effectiveWidth(); $('b2-paddle').style.left = `${(paddleX - width / 2) / W * 100}%`; $('b2-paddle').style.width = `${width / W * 100}%`; $('b2-paddle').classList.toggle('wide', wideTicks > 0); $('b2-level').textContent = level; $('b2-score').textContent = score; $('b2-lives').textContent = lives; $('b2-overlay').style.display = status === 'playing' ? 'none' : 'flex'; if (status === 'dead') $('b2-overlay').innerHTML = `<div class="g-title">Wall rebuilt</div><div class="g-sub">Level ${level} · score ${score}</div><button class="btn primary" type="button">Launch again</button>`; }
  function steer(event) { const rect = stage.getBoundingClientRect(), width = effectiveWidth(); paddleX = Math.max(width / 2, Math.min(W - width / 2, (event.clientX - rect.left) / rect.width * W)); draw(); }
  function applyPower(kind) { if (kind === 'wide') wideTicks = 500; if (kind === 'multi' && balls.length && balls.length < 3) { const source = balls[0]; balls.push({ x: source.x, y: source.y, vx: -source.vx, vy: source.vy }); } if (kind === 'slow') balls.forEach(ball => { ball.vx *= .65; ball.vy *= .65; }); const power = powerups.find(item => item.kind === kind); if (power) gameToastV2(stage, `${power.label} power-up`, 'break-toast'); }
  function tick() { if (status !== 'playing') return; if (wideTicks > 0) wideTicks--; const width = effectiveWidth(), paddleY = H - 25; for (let index = balls.length - 1; index >= 0; index--) { const ball = balls[index]; ball.x += ball.vx; ball.y += ball.vy; if (ball.x < 6 || ball.x > W - 6) { ball.x = Math.max(6, Math.min(W - 6, ball.x)); ball.vx *= -1; } if (ball.y < 6) { ball.y = 6; ball.vy *= -1; } if (ball.vy > 0 && ball.y > paddleY - 8 && ball.y < paddleY + 10 && ball.x > paddleX - width / 2 && ball.x < paddleX + width / 2) { const offset = (ball.x - paddleX) / (width / 2); const speed = Math.hypot(ball.vx, ball.vy); ball.vx = offset * speed * .9; ball.vy = -Math.max(3.4, speed * .85); } let struck = false; for (const brick of bricks) { if (struck || !brick.hp || ball.x + 6 < brick.x || ball.x - 6 > brick.x + brick.w || ball.y + 6 < brick.y || ball.y - 6 > brick.y + brick.h) continue; brick.hp--; ball.vy *= -1; score += brick.hp ? 5 : 10; struck = true; if (!brick.hp && Math.random() < .2) { const power = powerups[randomV2(powerups.length)]; capsules.push({ x: brick.x + brick.w / 2, y: brick.y, label: power.label, color: power.color, kind: power.kind }); } } if (ball.y > H + 12) balls.splice(index, 1); } for (let index = capsules.length - 1; index >= 0; index--) { const capsule = capsules[index]; capsule.y += 2.1; if (capsule.y > H - 42 && capsule.y < H - 12 && Math.abs(capsule.x - paddleX) < width / 2 + 10) { applyPower(capsule.kind); capsules.splice(index, 1); } else if (capsule.y > H + 20) capsules.splice(index, 1); } if (!balls.length) { lives--; if (lives > 0) { const speed = 4.4 + level * .2; balls = [{ x: paddleX, y: H - 52, vx: speed * .7, vy: -speed }]; gameToastV2(stage, `${lives} lives left`); } else { status = 'dead'; clearInterval(timer); timer = null; const best = Math.max(gameBestV2(BEST_KEY), level); saveBest(BEST_KEY, best); $('b2-best').textContent = best; } } else if (bricks.every(brick => !brick.hp)) { level++; const best = Math.max(gameBestV2(BEST_KEY), level); saveBest(BEST_KEY, best); $('b2-best').textContent = best; setupLevel(); gameToastV2(stage, `Level ${level}`, 'break-toast'); } draw(); }
  function start() { if (timer) clearInterval(timer); status = 'playing'; lives = 3; score = 0; level = 1; setupLevel(); timer = tools.every(tick, 16); draw(); }
  tools.on(stage, 'pointermove', steer); tools.on(stage, 'pointerdown', event => { event.preventDefault(); if (status !== 'playing') start(); steer(event); }); draw();
}

/* ---- the moving specular highlight -------------------------------------*/
let gameLoopHandle = null;

function stopCurrentGame() {
  if (gameLoopHandle) { clearInterval(gameLoopHandle); gameLoopHandle = null; }
  document.removeEventListener('keydown', mergeKeyHandler);
  document.removeEventListener('keydown', beaconKeyDownHandler);
  document.removeEventListener('keyup', beaconKeyUpHandler);
  document.removeEventListener('pointerup', beaconPointerUpHandler);
  document.removeEventListener('pointercancel', beaconPointerUpHandler);
  activeGame = null;
}

function readBest(key) {
  try { const v = localStorage.getItem(key); return v ? parseInt(v, 10) : null; }
  catch (e) { return null; }
}
function saveBest(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (e) { /* ignore */ }
}

function startCurrentGame() {
  const active = document.querySelector('#game-picker button.active');
  renderGame(active ? active.dataset.game : 'skydash');
}

function initGames() {
  document.querySelectorAll('#game-picker button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#game-picker button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderGame(btn.dataset.game);
    });
  });
}

function renderGame(name) {
  stopCurrentGame();
  activeGame = name;
  const games = {
    skydash: initSkyDash, echomaze: initEchoMaze, beacon: initBeacon,
    stacker: initStacker, merge: initMerge, breakout: initBreakout,
  };
  (games[name] || initSkyDash)();
}

/* ---- Game 1: Sky Dash (flappy-style, no printer theming) --------------- */

function initSkyDash() {
  const BEST_KEY = 'dejavu1.skydash.best';
  const W = 640, H = 380, GRAVITY = 0.55, FLAP = -8, X = 90, R = 13;
  // The visual body stays R, but what actually collides is a couple of
  // pixels smaller — the classic "forgiving hitbox" trick that makes a near
  // miss feel fair instead of feeling like the game lied about the sprite.
  const COLLIDE_R = R - 4;
  // Difficulty ramps with score: faster obstacles, a tighter gap to thread.
  const speedFor = (score) => Math.min(3 + score * 0.12, 7.5);
  const gapFor = (score) => Math.max(128 - score * 2, 86);
  // Past a score threshold, some gaps drift up and down instead of sitting
  // still — real variety instead of just "everything gets faster."
  const moverChanceFor = (score) => Math.min(Math.max((score - 10) * 0.03, 0), 0.55);
  const ZONES = [
    { at: 0, name: 'Calm Skies' }, { at: 12, name: 'Crosswinds' },
    { at: 26, name: 'Turbulence' }, { at: 45, name: 'Storm Front' },
    { at: 70, name: 'Jet Stream' },
  ];
  const zoneFor = (score) => ZONES.slice().reverse().find(z => score >= z.at).name;
  const CLOSE_CALL_MARGIN = 12;

  $('game-stats').innerHTML = `
    <div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="sd-score">0</div></div>
    <div class="game-stat"><div class="g-key">Zone</div><div class="g-val" id="sd-zone" style="font-size:15px;">${ZONES[0].name}</div></div>
    <div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="sd-best">${readBest(BEST_KEY) ?? '—'}</div></div>`;

  $('game-host').innerHTML = `
    <div class="game-surface sky-dash" id="sd-surface" style="width:${W}px; max-width:100%; height:${H}px;">
      <div class="sd-avatar" id="sd-avatar"></div>
      <div class="sd-popups" id="sd-popups"></div>
      <div class="game-overlay" id="sd-overlay"><div class="g-title">Sky Dash</div><div class="g-sub">Click to start — click again to flap</div></div>
    </div>`;

  let state = { status: 'idle', y: H / 2, v: 0, squash: 0, obstacles: [], score: 0, time: 0 };

  function popup(text) {
    const host = $('sd-popups');
    const el = document.createElement('div');
    el.className = 'sd-popup';
    el.textContent = text;
    el.style.left = `${X + 24}px`;
    el.style.top = `${state.y - 24}px`;
    host.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }

  function draw() {
    const scaleX = 1 + state.squash * 0.22, scaleY = 1 - state.squash * 0.16;
    $('sd-avatar').style.top = `${state.y - R}px`;
    $('sd-avatar').style.left = `${X - R}px`;
    $('sd-avatar').style.transform =
      `rotate(${Math.max(-25, Math.min(45, state.v * 4))}deg) scale(${scaleX}, ${scaleY})`;

    document.querySelectorAll('.sd-obstacle').forEach(el => el.remove());
    const surface = $('sd-surface');
    const gap = gapFor(state.score);
    state.obstacles.forEach(o => {
      const gapY = obstacleGapY(o);
      const top = document.createElement('div');
      top.className = 'sd-obstacle top' + (o.mover ? ' mover' : '');
      top.style.left = `${o.x}px`; top.style.top = '0px'; top.style.height = `${Math.max(0, gapY - gap / 2)}px`;
      surface.appendChild(top);
      const bottom = document.createElement('div');
      bottom.className = 'sd-obstacle bottom' + (o.mover ? ' mover' : '');
      bottom.style.left = `${o.x}px`; bottom.style.top = `${gapY + gap / 2}px`; bottom.style.height = `${Math.max(0, H - (gapY + gap / 2))}px`;
      surface.appendChild(bottom);
    });

    $('sd-score').textContent = state.score;
    $('sd-zone').textContent = zoneFor(state.score);
    const overlay = $('sd-overlay');
    if (state.status === 'playing') { overlay.style.display = 'none'; }
    else {
      overlay.style.display = 'flex';
      overlay.innerHTML = state.status === 'over'
        ? `<div class="g-title">Crashed</div><div class="g-sub">Score ${state.score} in ${zoneFor(state.score)} — click to try again</div>`
        : `<div class="g-title">Sky Dash</div><div class="g-sub">Click to start — click again to flap</div>`;
    }
  }

  // A moving obstacle's gap drifts up/down over time on a sine wave, seeded
  // per-obstacle so several on screen never move in lockstep.
  function obstacleGapY(o) {
    if (!o.mover) return o.gapY;
    return o.gapY + Math.sin(state.time * 0.05 + o.phase) * o.amplitude;
  }

  function tick() {
    if (state.status !== 'playing') return;
    state.time += 1;
    const speed = speedFor(state.score);
    const gap = gapFor(state.score);
    state.v += GRAVITY;
    state.v = Math.min(state.v, 11);
    state.y += state.v;
    state.squash *= 0.8;

    state.obstacles = state.obstacles.map(o => ({ ...o, x: o.x - speed })).filter(o => o.x > -60);
    const last = state.obstacles[state.obstacles.length - 1];
    if (!last || last.x < W - 260) {
      const makeMover = Math.random() < moverChanceFor(state.score);
      const gapY = 100 + Math.random() * (H - 200);
      state.obstacles.push({
        x: W, gapY, passed: false,
        mover: makeMover,
        amplitude: makeMover ? 30 + Math.random() * 40 : 0,
        phase: Math.random() * Math.PI * 2,
      });
    }

    let collided = state.y - COLLIDE_R < 0 || state.y + COLLIDE_R > H;
    state.obstacles.forEach(o => {
      if (o.passed || o.x + 50 >= X) return;
      o.passed = true;
      state.score += 1;
      const gapY = obstacleGapY(o);
      const clearance = Math.min(state.y - (gapY - gap / 2), (gapY + gap / 2) - state.y);
      if (clearance < CLOSE_CALL_MARGIN) {
        state.score += 2;
        popup('Close call! +2');
      }
    });
    state.obstacles.forEach(o => {
      if (o.x < X + COLLIDE_R && o.x + 50 > X - COLLIDE_R) {
        const gapY = obstacleGapY(o);
        if (state.y - COLLIDE_R < gapY - gap / 2 || state.y + COLLIDE_R > gapY + gap / 2) collided = true;
      }
    });

    if (collided) {
      state.status = 'over';
      clearInterval(gameLoopHandle); gameLoopHandle = null;
      const best = Math.max(readBest(BEST_KEY) ?? 0, state.score);
      saveBest(BEST_KEY, best);
      $('sd-best').textContent = best;
    }
    draw();
  }

  $('sd-surface').addEventListener('click', () => {
    if (state.status !== 'playing') {
      state = { status: 'playing', y: H / 2, v: 0, squash: 0, obstacles: [], score: 0, time: 0 };
    } else {
      state.v = FLAP;
      state.squash = 1;
    }
    if (!gameLoopHandle) gameLoopHandle = setInterval(tick, 30);
    draw();
  });

  draw();
}

/* ---- Game 2: Echo Maze (real CSS 3D room-by-room maze) ------------------*/

function initEchoMaze() {
  // Best is now the deepest level reached rather than a raw step count —
  // once a hunting pursuer and growing mazes exist, "fewest steps" from the
  // old scoring model can't be compared across different maze sizes, so
  // this evolves to a level-based best like Block World and Brick Break use.
  const BEST_KEY = 'dejavu1.echomaze.bestlevel';
  const FACINGS = ['N', 'E', 'S', 'W'];
  const DELTA = { N: [-1, 0], E: [0, 1], S: [1, 0], W: [0, -1] };
  const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const MIN_N = 7, MAX_N = 10;
  const sizeForLevel = (lvl) => Math.min(MIN_N + (lvl - 1), MAX_N);
  const key = (r, c) => `${r},${c}`;

  function generate(n) {
    const cells = Array.from({ length: n }, () => Array.from({ length: n }, () => ({ N: true, E: true, S: true, W: true })));
    const seen = Array.from({ length: n }, () => new Array(n).fill(false));
    function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
    function carve(r, c) {
      seen[r][c] = true;
      for (const dir of shuffle(FACINGS.slice())) {
        const [dr, dc] = DELTA[dir];
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= n || nc < 0 || nc >= n || seen[nr][nc]) continue;
        cells[r][c][dir] = false; cells[nr][nc][OPPOSITE[dir]] = false;
        carve(nr, nc);
      }
    }
    carve(0, 0);
    return cells;
  }

  // Breadth-first search over the maze graph — genuine pathfinding, not a
  // straight-line chase, so the pursuer actually reasons about walls the
  // same way the player has to.
  function bfsDistances(grid, n, start) {
    const dist = Array.from({ length: n }, () => new Array(n).fill(-1));
    dist[start.row][start.col] = 0;
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      const cell = grid[cur.row][cur.col];
      for (const dir of FACINGS) {
        if (cell[dir]) continue;
        const [dr, dc] = DELTA[dir];
        const nr = cur.row + dr, nc = cur.col + dc;
        if (nr < 0 || nr >= n || nc < 0 || nc >= n || dist[nr][nc] !== -1) continue;
        dist[nr][nc] = dist[cur.row][cur.col] + 1;
        queue.push({ row: nr, col: nc });
      }
    }
    return dist;
  }

  function bfsNextStep(grid, n, from, to) {
    if (from.row === to.row && from.col === to.col) return null;
    const cameFrom = new Map([[key(from.row, from.col), null]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      if (cur.row === to.row && cur.col === to.col) break;
      const cell = grid[cur.row][cur.col];
      for (const dir of FACINGS) {
        if (cell[dir]) continue;
        const [dr, dc] = DELTA[dir];
        const nr = cur.row + dr, nc = cur.col + dc;
        if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
        const k = key(nr, nc);
        if (cameFrom.has(k)) continue;
        cameFrom.set(k, cur);
        queue.push({ row: nr, col: nc });
      }
    }
    if (!cameFrom.has(key(to.row, to.col))) return null;
    let cur = { row: to.row, col: to.col };
    while (cameFrom.get(key(cur.row, cur.col)) && !(cameFrom.get(key(cur.row, cur.col)).row === from.row && cameFrom.get(key(cur.row, cur.col)).col === from.col)) {
      cur = cameFrom.get(key(cur.row, cur.col));
    }
    return cur;
  }

  function popup(text) {
    const host = $('em-viewport');
    const el = document.createElement('div');
    el.className = 'em-popup';
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  function newMaze(lvl) {
    const n = sizeForLevel(lvl);
    const grid = generate(n);
    const start = { row: 0, col: 0 };
    const exit = { row: n - 1, col: n - 1 };
    const distFromStart = bfsDistances(grid, n, start);
    // The pursuer's lair is the room farthest from the entrance (excluding
    // the exit itself, so it can never simply camp the way out).
    let lairDist = -1, lair = { row: n - 1, col: 0 };
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (r === exit.row && c === exit.col) continue;
      if (distFromStart[r][c] > lairDist) { lairDist = distFromStart[r][c]; lair = { row: r, col: c }; }
    }
    return {
      n, grid, row: 0, col: 0, rotation: 0, steps: 0, won: false, caught: 0,
      visited: new Set([key(0, 0)]), lair, pursuer: { ...lair },
    };
  }

  let level = 1;
  let maze = newMaze(level);

  $('game-host').innerHTML = `
    <div style="display:flex; gap:24px; align-items:flex-start; flex-wrap:wrap;">
      <div style="flex:1; min-width:260px;">
        <p class="card-sub" style="margin-bottom:12px; max-width:38ch;">Every room looks the same as the last — on purpose. The map only remembers rooms you've been in. Something is hunting you through the walls you can't see — find the glowing exit before it finds you.</p>
        <div class="maze-viewport" id="em-viewport">
          <div class="maze-cube" id="em-cube">
            <div class="maze-wall" id="em-wall-N"></div>
            <div class="maze-wall" id="em-wall-E"></div>
            <div class="maze-wall" id="em-wall-S"></div>
            <div class="maze-wall" id="em-wall-W"></div>
          </div>
          <div class="game-overlay" id="em-overlay" style="display:none;"></div>
        </div>
        <div style="display:flex; justify-content:center; gap:10px; margin-top:18px;">
          <button class="btn" id="em-left">↰ Turn left</button>
          <button class="btn primary" id="em-forward">Move forward</button>
          <button class="btn" id="em-right">Turn right ↱</button>
        </div>
      </div>
      <div style="flex:0 0 150px;">
        <p class="card-sub" style="text-align:center; margin-bottom:8px;">Map</p>
        <div class="maze-map" id="em-map" style="display:grid;"></div>
        <button class="btn block" id="em-new" style="margin-top:12px;">New maze</button>
      </div>
    </div>`;

  $('game-stats').innerHTML = `
    <div class="game-stat"><div class="g-key">Level</div><div class="g-val" id="em-level">1</div></div>
    <div class="game-stat"><div class="g-key">Steps</div><div class="g-val" id="em-steps">0</div></div>
    <div class="game-stat"><div class="g-key">Echo</div><div class="g-val" id="em-echo">—</div></div>
    <div class="game-stat"><div class="g-key">Best level</div><div class="g-val accent" id="em-best">${readBest(BEST_KEY) ?? '—'}</div></div>`;

  function draw() {
    const cell = maze.grid[maze.row][maze.col];
    $('em-cube').style.transform = `rotateY(${-maze.rotation}deg)`;
    FACINGS.forEach(dir => {
      const wall = $(`em-wall-${dir}`);
      wall.classList.toggle('solid', Boolean(cell[dir]));
      wall.classList.toggle('open', !cell[dir]);
    });
    $('em-wall-N').style.transform = 'rotateY(0deg) translateZ(110px)';
    $('em-wall-E').style.transform = 'rotateY(90deg) translateZ(110px)';
    $('em-wall-S').style.transform = 'rotateY(180deg) translateZ(110px)';
    $('em-wall-W').style.transform = 'rotateY(-90deg) translateZ(110px)';

    $('em-level').textContent = maze.n - MIN_N + 1;
    $('em-steps').textContent = maze.steps;
    const idx = ((Math.round(maze.rotation / 90) % 4) + 4) % 4;
    const facing = FACINGS[idx];
    $('em-forward').disabled = Boolean(cell[facing]) || maze.won;

    const echoDist = bfsDistances(maze.grid, maze.n, maze.pursuer)[maze.row][maze.col];
    $('em-echo').textContent = maze.won ? '—' : `${echoDist} room${echoDist === 1 ? '' : 's'}`;
    const viewport = $('em-viewport');
    viewport.classList.toggle('em-danger', !maze.won && echoDist <= 2);

    const map = $('em-map');
    map.style.gridTemplateColumns = `repeat(${maze.n}, 1fr)`;
    map.innerHTML = '';
    for (let r = 0; r < maze.n; r++) {
      for (let c = 0; c < maze.n; c++) {
        const cellEl = document.createElement('div');
        const seen = maze.visited.has(key(r, c));
        const isExit = r === maze.n - 1 && c === maze.n - 1;
        const isPursuer = seen && r === maze.pursuer.row && c === maze.pursuer.col;
        cellEl.className = 'mc'
          + (r === maze.row && c === maze.col ? ' here' : '')
          + (isExit && seen ? ' exit' : '')
          + (!seen ? ' unseen' : '')
          + (isPursuer ? ' pursuer' : '');
        map.appendChild(cellEl);
      }
    }

    const overlay = $('em-overlay');
    overlay.style.display = maze.won ? 'flex' : 'none';
    if (maze.won) {
      const best = Math.max(readBest(BEST_KEY) ?? 0, maze.n - MIN_N + 1);
      saveBest(BEST_KEY, best);
      $('em-best').textContent = best;
      overlay.innerHTML = `<div class="g-title">You escaped</div><div class="g-sub">${maze.steps} steps, ${maze.caught} close call${maze.caught === 1 ? '' : 's'} — click New maze for a bigger one</div>`;
    }
  }

  function movePursuer() {
    const step = bfsNextStep(maze.grid, maze.n, maze.pursuer, { row: maze.row, col: maze.col });
    if (step) maze.pursuer = step;
    if (maze.pursuer.row === maze.row && maze.pursuer.col === maze.col) {
      maze.caught += 1;
      maze.steps += 5;
      maze.row = 0; maze.col = 0; maze.rotation = 0;
      maze.pursuer = { ...maze.lair };
      popup('The Echo caught you — back to the start');
    }
  }

  $('em-left').addEventListener('click', () => { if (!maze.won) { maze.rotation -= 90; draw(); } });
  $('em-right').addEventListener('click', () => { if (!maze.won) { maze.rotation += 90; draw(); } });
  $('em-forward').addEventListener('click', () => {
    if (maze.won) return;
    const idx = ((Math.round(maze.rotation / 90) % 4) + 4) % 4;
    const facing = FACINGS[idx];
    const cell = maze.grid[maze.row][maze.col];
    if (cell[facing]) return;
    const [dr, dc] = DELTA[facing];
    maze.row += dr; maze.col += dc; maze.steps += 1;
    maze.visited.add(key(maze.row, maze.col));
    if (maze.row === maze.n - 1 && maze.col === maze.n - 1) {
      maze.won = true;
    } else {
      movePursuer();
    }
    draw();
  });
  $('em-new').addEventListener('click', () => {
    if (maze.won) level = Math.min(level + 1, MAX_N - MIN_N + 1);
    maze = newMaze(level);
    draw();
  });

  draw();
}

/* ---- Game 3: Block World (continuous free-roam 3D voxel world) ----------
 * Echo Maze snaps between rooms on a grid. This one doesn't: the player has
 * a real (x, y) position and a facing angle that both change continuously,
 * the same rotate-by-negative-yaw-around-the-camera trick Echo Maze uses,
 * just generalized from 90-degree room snaps to a free-roam world:
 *   world.transform = rotateZ(-yaw) translate3d(-px, -py, 0)
 * translate3d runs first (moves the world so the player is at the origin),
 * then rotateZ turns that around the camera to match which way they're
 * facing — so the terrain the player hasn't reached yet visibly slides and
 * spins past as they walk and turn, instead of a room simply swapping out.
 *
 * Minecraft-inspired, not a clone: a blocky, deterministically-generated
 * chunk (flat-topped voxels, elevation via translateZ, real rotated CSS
 * side faces only where a tile is actually taller than its neighbor — the
 * same "only draw exposed faces" idea real voxel engines use, just done by
 * hand for a couple dozen tiles instead of a renderer). Walk into ore or
 * trees to mine/chop them, then spend wood to place your own blocks. There
 * is no jump and no collision with terrain height — the player always
 * walks at a fixed height, so a hill is climbed by walking onto it rather
 * than jumped up, a deliberate simplification for a browser mini-game.
 * --------------------------------------------------------------------- */

let beaconKeyDownHandler = () => {};
let beaconKeyUpHandler = () => {};
let beaconPointerUpHandler = () => {};

function initBeacon() {
  const BEST_KEY = 'dejavu1.beacon.best';
  const MOVE_SPEED = 3.4, TURN_SPEED = 2.6, COLLECT_RADIUS = 58;
  const ACCEL = 0.18, TURN_ACCEL = 0.25;
  const BASE_TIME = 55;
  const GRID = 9, HALF = 4, BLOCK = 110, BLOCK_H = 46;
  const WORLD_HALF = HALF * BLOCK + BLOCK * 0.4;
  const CRITTER_WANDER_SPEED = 0.55, CRITTER_FLEE_SPEED = 2.7, CRITTER_FLEE_RADIUS = 150;

  const TIERS = [
    { top: '#8bc97e', side: '#6b9a5c' },   // grass
    { top: '#b7bcc4', side: '#8f959e' },   // stone
    { top: '#eef2f6', side: '#c7cdd6' },   // snow cap
  ];
  const BUILT_COLORS = {
    wood: { top: 'var(--accent-light)', side: 'var(--accent)' },
    torch: { top: '#fff3c4', side: '#e0a83c' },
  };

  $('game-stats').innerHTML = `
    <div class="game-stat"><div class="g-key">Level</div><div class="g-val" id="bc-level">1</div></div>
    <div class="game-stat"><div class="g-key">Wood</div><div class="g-val" id="bc-wood">0</div></div>
    <div class="game-stat"><div class="g-key">Ore</div><div class="g-val" id="bc-ore">0</div></div>
    <div class="game-stat"><div class="g-key">Best level</div><div class="g-val accent" id="bc-best">${readBest(BEST_KEY) ?? '—'}</div></div>`;

  $('game-host').innerHTML = `
    <p class="card-sub" style="margin-bottom:12px; max-width:52ch;">Mine every glowing ore vein and tree in the chunk before time runs out. Spend wood on a plain block, or 3 ore on a glowing torch. Something skittish shares the chunk with you — it keeps its distance unless you crowd it. WASD or arrow keys to move and turn, E to place wood, Q for a torch.</p>
    <div class="beacon-viewport" id="bc-viewport">
      <div class="beacon-hud"><span id="bc-hud-left">Resources: 0/0</span><span id="bc-hud-right">Time: —</span></div>
      <div class="beacon-horizon">
        <div class="beacon-world" id="bc-world">
          <div class="beacon-ground"></div>
        </div>
      </div>
      <div class="beacon-reticle" aria-hidden="true"></div>
      <div class="game-overlay" id="bc-overlay"><div class="g-title">Block World</div><div class="g-sub">Click to start — WASD / arrows to move and turn</div></div>
    </div>
    <div class="beacon-controls">
      <button class="btn" id="bc-turnl" data-hold="turnL">↺ Turn</button>
      <button class="btn primary" id="bc-fwd" data-hold="fwd">▲ Forward</button>
      <button class="btn" id="bc-back" data-hold="back">▼ Back</button>
      <button class="btn" id="bc-turnr" data-hold="turnR">Turn ↻</button>
      <button class="btn" id="bc-place">⬛ Place (1 wood)</button>
      <button class="btn" id="bc-torch">🔥 Torch (3 ore)</button>
    </div>`;

  const keys = {};
  let state = { status: 'idle' };

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Cheap deterministic pseudo-noise (no external library): three
  // out-of-phase sine/cosine waves combined, seeded per level so each
  // level is a fresh but reproducible-looking chunk, not literal Perlin
  // noise but enough to cluster into hills instead of pure random static.
  function noise(col, row, seed) {
    const v = Math.sin((col + seed) * 0.9) + Math.cos((row + seed * 1.7) * 0.9)
      + Math.sin((col + row + seed * 2.3) * 0.5);
    return (v + 3) / 6;
  }

  function buildTerrain(level) {
    const seed = level * 13.37;
    const tiles = new Map();
    for (let col = -HALF; col <= HALF; col++) {
      for (let row = -HALF; row <= HALF; row++) {
        const n = noise(col, row, seed);
        const tier = n > 0.72 ? 2 : n > 0.5 ? 1 : 0;
        tiles.set(`${col},${row}`, { col, row, x: col * BLOCK, y: row * BLOCK, tier, h: tier * BLOCK_H });
      }
    }
    return tiles;
  }

  function placeResources(tiles, oreCount, woodCount) {
    const candidates = shuffle([...tiles.values()].filter(t => Math.hypot(t.col, t.row) > 1.5));
    return [
      ...candidates.slice(0, oreCount).map(t => ({ x: t.x, y: t.y, h: t.h, kind: 'ore', got: false, el: null })),
      ...candidates.slice(oreCount, oreCount + woodCount).map(t => ({ x: t.x, y: t.y, h: t.h, kind: 'wood', got: false, el: null })),
    ];
  }

  // A small, low-stakes wandering creature: it ambles in a random direction
  // until the player gets close, then flees directly away — a simple
  // reactive state machine (wander vs. flee), not a scripted path.
  function spawnCritter(tiles) {
    const candidates = [...tiles.values()].filter(t => Math.hypot(t.col, t.row) > 2);
    const t = candidates[Math.floor(Math.random() * candidates.length)] || { x: 0, y: 0 };
    return { x: t.x, y: t.y, dx: 1, dy: 0, wanderTimer: 0 };
  }

  function updateCritter() {
    const c = state.critter;
    if (!c) return;
    const toPlayerX = state.px - c.x, toPlayerY = state.py - c.y;
    const dist = Math.hypot(toPlayerX, toPlayerY) || 1;
    if (dist < CRITTER_FLEE_RADIUS) {
      c.x -= (toPlayerX / dist) * CRITTER_FLEE_SPEED;
      c.y -= (toPlayerY / dist) * CRITTER_FLEE_SPEED;
      c.wanderTimer = 0;
    } else {
      c.wanderTimer -= 1;
      if (c.wanderTimer <= 0) {
        const angle = Math.random() * Math.PI * 2;
        c.dx = Math.cos(angle); c.dy = Math.sin(angle);
        c.wanderTimer = 50 + Math.random() * 70;
      }
      c.x += c.dx * CRITTER_WANDER_SPEED;
      c.y += c.dy * CRITTER_WANDER_SPEED;
    }
    c.x = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, c.x));
    c.y = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, c.y));
  }

  // One flat top face plus real rotated CSS side faces, but only toward a
  // neighbor that's actually lower — the same "don't draw a face nothing
  // will ever occlude" idea a voxel engine uses, applied to ~80 tiles by
  // hand instead of by a renderer.
  function renderVoxel(host, x, y, h, neighborH, colors) {
    const top = document.createElement('div');
    top.className = 'voxel-top';
    top.style.width = top.style.height = `${BLOCK}px`;
    top.style.marginLeft = top.style.marginTop = `${-BLOCK / 2}px`;
    top.style.background = colors.top;
    top.style.transform = `translate3d(${x}px, ${y}px, ${h}px)`;
    host.appendChild(top);

    const sides = [
      { dx: 0, dy: 1, w: BLOCK, hh: null, rot: 'rotateX(90deg)' },   // south
      { dx: 0, dy: -1, w: BLOCK, hh: null, rot: 'rotateX(90deg)' },  // north
      { dx: 1, dy: 0, w: null, hh: BLOCK, rot: 'rotateY(90deg)' },   // east
      { dx: -1, dy: 0, w: null, hh: BLOCK, rot: 'rotateY(90deg)' },  // west
    ];
    sides.forEach(s => {
      const nh = neighborH(s.dx, s.dy);
      if (nh === null || nh >= h) return;
      const face = document.createElement('div');
      face.className = 'voxel-side';
      const faceH = h - nh;
      face.style.width = `${s.w ?? faceH}px`;
      face.style.height = `${s.hh ?? faceH}px`;
      face.style.marginLeft = `${-(s.w ?? faceH) / 2}px`;
      face.style.marginTop = `${-(s.hh ?? faceH) / 2}px`;
      face.style.background = colors.side;
      face.style.transform =
        `translate3d(${x + s.dx * BLOCK / 2}px, ${y + s.dy * BLOCK / 2}px, ${(h + nh) / 2}px) ${s.rot}`;
      host.appendChild(face);
    });
  }

  function renderTerrain() {
    const world = $('bc-world');
    world.querySelectorAll('.voxel-top, .voxel-side').forEach(el => el.remove());
    state.tiles.forEach(t => {
      const neighborH = (dx, dy) => {
        const n = state.tiles.get(`${t.col + dx},${t.row + dy}`);
        return n ? n.h : null;
      };
      renderVoxel(world, t.x, t.y, t.h, neighborH, TIERS[t.tier]);
    });
  }

  function renderResources() {
    const world = $('bc-world');
    world.querySelectorAll('.voxel-ore, .voxel-wood').forEach(el => el.remove());
    state.resources.forEach(r => {
      const el = document.createElement('div');
      el.className = r.kind === 'ore' ? 'voxel-ore' : 'voxel-wood';
      world.appendChild(el);
      r.el = el;
    });
    positionResources();
  }

  // Collected resources get a scale-and-fade animation (see .collected in
  // CSS) instead of vanishing instantly — a small "you got that" beat.
  // Once collected, a resource's element is left alone rather than repositioned.
  function positionResources() {
    state.resources.forEach(r => {
      if (r.got || !r.el) return;
      r.el.style.transform = `translate3d(${r.x}px, ${r.y}px, ${r.h + 30}px)`;
    });
  }

  function renderCritter() {
    const world = $('bc-world');
    world.querySelectorAll('.voxel-critter').forEach(el => el.remove());
    const wrap = document.createElement('div');
    wrap.className = 'voxel-critter';
    wrap.innerHTML = '<div class="voxel-critter-body"></div>';
    world.appendChild(wrap);
    positionCritter();
  }

  function positionCritter() {
    if (!state.critter) return;
    const el = document.querySelector('#bc-world .voxel-critter');
    if (!el) return;
    el.style.transform = `translate3d(${state.critter.x}px, ${state.critter.y}px, 20px)`;
  }

  function renderBuilt() {
    const world = $('bc-world');
    world.querySelectorAll('.voxel-built').forEach(el => el.remove());
    state.built.forEach(b => {
      const wrap = document.createElement('div');
      wrap.className = 'voxel-built' + (b.kind === 'torch' ? ' voxel-built-torch' : '');
      renderVoxel(wrap, b.x, b.y, BLOCK_H, (dx, dy) => (dx === 0 && dy === 0 ? null : 0), BUILT_COLORS[b.kind] || BUILT_COLORS.wood);
      world.appendChild(wrap);
    });
  }

  function popup(text) {
    const host = $('bc-viewport');
    const el = document.createElement('div');
    el.className = 'bc-popup';
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => el.remove(), 750);
  }

  function newLevel(level) {
    const oreCount = Math.min(4 + level, 11);
    const woodCount = Math.min(3 + Math.floor(level / 2), 9);
    const carried = { wood: state.wood || 0, ore: state.ore || 0 };
    const tiles = buildTerrain(level);
    state = {
      status: 'playing',
      level,
      wood: carried.wood,
      ore: carried.ore,
      px: 0, py: 0, yaw: 0, speed: 0, turnRate: 0,
      tiles,
      resources: placeResources(tiles, oreCount, woodCount),
      built: [],
      critter: spawnCritter(tiles),
      timeLeft: Math.max(BASE_TIME - (level - 1) * 2, 28),
      collected: 0,
      goal: oreCount + woodCount,
    };
    renderTerrain();
    renderResources();
    renderBuilt();
    renderCritter();
  }

  function draw() {
    if (state.status === 'idle') {
      $('bc-world').style.transform = 'translate3d(0,0,0)';
      $('bc-overlay').style.display = 'flex';
      return;
    }
    $('bc-world').style.transform = `rotateZ(${-state.yaw}deg) translate3d(${-state.px}px, ${-state.py}px, 0)`;
    $('bc-level').textContent = state.level;
    $('bc-wood').textContent = state.wood;
    $('bc-ore').textContent = state.ore;
    $('bc-hud-left').textContent = `Resources: ${state.collected}/${state.goal}`;
    $('bc-hud-right').textContent = `Time: ${Math.max(Math.ceil(state.timeLeft), 0)}s`;

    const overlay = $('bc-overlay');
    overlay.style.display = state.status === 'playing' ? 'none' : 'flex';
    if (state.status === 'over') {
      overlay.innerHTML = `<div class="g-title">Out of time</div><div class="g-sub">Reached level ${state.level} — ${state.wood} wood, ${state.ore} ore — click to try again</div>`;
    }
  }

  function place() {
    if (state.status !== 'playing' || state.wood < 1) return;
    state.wood -= 1;
    const yawRad = state.yaw * Math.PI / 180;
    state.built.push({
      x: state.px + Math.sin(yawRad) * 95,
      y: state.py - Math.cos(yawRad) * 95,
      kind: 'wood',
    });
    renderBuilt();
    draw();
  }

  function placeTorch() {
    if (state.status !== 'playing' || state.ore < 3) return;
    state.ore -= 3;
    const yawRad = state.yaw * Math.PI / 180;
    state.built.push({
      x: state.px + Math.sin(yawRad) * 95,
      y: state.py - Math.cos(yawRad) * 95,
      kind: 'torch',
    });
    renderBuilt();
    draw();
  }

  function tick() {
    if (state.status !== 'playing') return;

    // Acceleration instead of an instant fixed speed — held input eases
    // toward its target velocity each tick, so starting and stopping (and
    // turning) reads as real momentum rather than a toggle switch.
    const turnInput = (keys.turnR ? 1 : 0) - (keys.turnL ? 1 : 0);
    const moveInput = (keys.fwd ? 1 : 0) - (keys.back ? 1 : 0);
    state.turnRate += (turnInput * TURN_SPEED - state.turnRate) * TURN_ACCEL;
    state.speed += (moveInput * MOVE_SPEED - state.speed) * ACCEL;
    state.yaw += state.turnRate;
    const yawRad = state.yaw * Math.PI / 180;
    state.px += Math.sin(yawRad) * state.speed;
    state.py += -Math.cos(yawRad) * state.speed;
    state.px = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, state.px));
    state.py = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, state.py));

    state.resources.forEach(r => {
      if (r.got) return;
      if (Math.hypot(r.x - state.px, r.y - state.py) < COLLECT_RADIUS) {
        r.got = true;
        state.collected += 1;
        if (r.kind === 'ore') state.ore += 1; else state.wood += 1;
        if (r.el) r.el.classList.add('collected');
        popup(r.kind === 'ore' ? '+1 Ore' : '+1 Wood');
      }
    });
    positionResources();
    updateCritter();
    positionCritter();

    state.timeLeft -= 0.03;

    if (state.collected === state.goal) {
      const best = Math.max(readBest(BEST_KEY) ?? 0, state.level);
      saveBest(BEST_KEY, best);
      $('bc-best').textContent = best;
      newLevel(state.level + 1);
    } else if (state.timeLeft <= 0) {
      state.status = 'over';
      clearInterval(gameLoopHandle); gameLoopHandle = null;
      const best = Math.max(readBest(BEST_KEY) ?? 0, state.level);
      saveBest(BEST_KEY, best);
      $('bc-best').textContent = best;
    }
    draw();
  }

  function start() {
    newLevel(1);
    gameLoopHandle = setInterval(tick, 30);
    draw();
  }

  $('bc-viewport').addEventListener('click', () => {
    if (state.status !== 'playing') start();
  });
  $('bc-place').addEventListener('click', place);
  $('bc-torch').addEventListener('click', placeTorch);

  document.querySelectorAll('[data-hold]').forEach(btn => {
    const key = btn.dataset.hold;
    const down = (e) => { e.preventDefault(); keys[key] = true; };
    const up = () => { keys[key] = false; };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('pointercancel', up);
  });
  // On touch, a finger can slide off a small button while still held down —
  // pointerleave won't always catch that. A document-wide release clears
  // every held key so a stray touch never leaves movement stuck on.
  beaconPointerUpHandler = () => { Object.keys(keys).forEach(k => { keys[k] = false; }); };
  document.addEventListener('pointerup', beaconPointerUpHandler);
  document.addEventListener('pointercancel', beaconPointerUpHandler);

  const KEY_MAP = { KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back',
    KeyA: 'turnL', ArrowLeft: 'turnL', KeyD: 'turnR', ArrowRight: 'turnR' };
  beaconKeyDownHandler = (e) => {
    if (KEY_MAP[e.code]) { e.preventDefault(); keys[KEY_MAP[e.code]] = true; }
    else if (e.code === 'KeyE') { e.preventDefault(); place(); }
    else if (e.code === 'KeyQ') { e.preventDefault(); placeTorch(); }
  };
  beaconKeyUpHandler = (e) => { if (KEY_MAP[e.code]) keys[KEY_MAP[e.code]] = false; };
  document.addEventListener('keydown', beaconKeyDownHandler);
  document.addEventListener('keyup', beaconKeyUpHandler);

  draw();
}

/* ---- Game 4: Block Stacker ------------------------------------------- */

function initStacker() {
  const BEST_KEY = 'dejavu1.stacker.best';
  const W = 300, H = 420, BLOCK_H = 26, VISIBLE_ROWS = Math.floor(H / BLOCK_H);
  // A drop this close to fully flush with the block below counts as
  // "perfect" — the classic tower-game reward: no shrinkage, a combo tick,
  // and a snap to dead-flush alignment instead of the exact pixel offset.
  const PERFECT_MARGIN = 6;

  $('game-stats').innerHTML = `
    <div class="game-stat"><div class="g-key">Height</div><div class="g-val" id="st-height">0</div></div>
    <div class="game-stat"><div class="g-key">Combo</div><div class="g-val" id="st-combo">0</div></div>
    <div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="st-best">${readBest(BEST_KEY) ?? '—'}</div></div>`;

  $('game-host').innerHTML = `
    <div class="game-surface stacker" id="st-surface" style="width:${W}px; max-width:100%; height:${H}px;">
      <div class="game-overlay" id="st-overlay"><div class="g-title">Block Stacker</div><div class="g-sub">Click to start — click to drop each block</div></div>
    </div>`;

  const COLORS = ['#ff9c66', '#7fb2ff', '#5cc16f', '#e0475f'];
  let blocks = [];       // placed blocks, bottom to top
  let moving = null;
  let level = 0;
  let combo = 0;
  let status = 'idle';

  function popup(text) {
    const host = $('st-surface');
    const el = document.createElement('div');
    el.className = 'stacker-popup';
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }

  function draw() {
    const surface = $('st-surface');
    surface.querySelectorAll('.stacker-block').forEach(el => el.remove());
    const visible = blocks.slice(-VISIBLE_ROWS);
    visible.forEach((b, i) => {
      const el = document.createElement('div');
      el.className = 'stacker-block' + (b.perfect ? ' perfect' : '');
      el.style.left = `${b.x}px`; el.style.width = `${b.width}px`;
      el.style.bottom = `${i * BLOCK_H}px`;
      el.style.background = b.color;
      surface.appendChild(el);
    });
    if (moving && status === 'playing') {
      const el = document.createElement('div');
      el.className = 'stacker-block';
      el.style.left = `${moving.x}px`; el.style.width = `${moving.width}px`;
      el.style.bottom = `${Math.min(level, VISIBLE_ROWS - 1) * BLOCK_H}px`;
      el.style.background = moving.color;
      surface.appendChild(el);
    }
    $('st-height').textContent = level;
    $('st-combo').textContent = combo;
    const overlay = $('st-overlay');
    overlay.style.display = status === 'playing' ? 'none' : 'flex';
    if (status === 'over') overlay.innerHTML = `<div class="g-title">Missed</div><div class="g-sub">Height ${level}, best combo this run ${combo} — click to try again</div>`;
  }

  function spawnMoving() {
    const prev = blocks[blocks.length - 1];
    const width = prev ? prev.width : 90;
    moving = { x: 0, width, dir: 1, color: COLORS[level % COLORS.length] };
  }

  function tick() {
    if (status !== 'playing' || !moving) return;
    // Speeds up as the tower gets taller, and the margin for a clean drop
    // (blocks shrink toward the overlap already) gets less forgiving.
    const speed = Math.min(4 + level * 0.35, 11);
    moving.x += moving.dir * speed;
    if (moving.x <= 0 || moving.x + moving.width >= W) moving.dir *= -1;
    moving.x = Math.max(0, Math.min(W - moving.width, moving.x));
    draw();
  }

  function drop() {
    const prev = blocks[blocks.length - 1];
    if (!prev) {
      blocks.push({ x: moving.x, width: moving.width, color: moving.color, perfect: true });
    } else {
      const left = Math.max(prev.x, moving.x);
      const right = Math.min(prev.x + prev.width, moving.x + moving.width);
      const overlap = right - left;
      if (overlap <= 4) {
        status = 'over';
        clearInterval(gameLoopHandle); gameLoopHandle = null;
        const best = Math.max(readBest(BEST_KEY) ?? 0, level);
        saveBest(BEST_KEY, best);
        $('st-best').textContent = best;
        draw();
        return;
      }
      if (overlap >= moving.width - PERFECT_MARGIN) {
        combo += 1;
        blocks.push({ x: prev.x, width: moving.width, color: moving.color, perfect: true });
        popup(combo > 1 ? `Perfect! x${combo}` : 'Perfect!');
      } else {
        combo = 0;
        blocks.push({ x: left, width: overlap, color: moving.color, perfect: false });
      }
    }
    level += 1;
    spawnMoving();
    draw();
  }

  $('st-surface').addEventListener('click', () => {
    if (status !== 'playing') {
      blocks = []; level = 0; combo = 0; status = 'playing';
      spawnMoving();
      gameLoopHandle = setInterval(tick, 20);
    } else {
      drop();
    }
    draw();
  });

  draw();
}

/* ---- Game 5: Merge Puzzle (2048-style) --------------------------------- */

let mergeKeyHandler = () => {};

function initMerge() {
  const BEST_KEY = 'dejavu1.merge.best';
  const SIZE = 4;
  const DIRECTIONS = ['up', 'down', 'left', 'right'];

  $('game-stats').innerHTML = `
    <div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="mg-score">0</div></div>
    <div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="mg-best">${readBest(BEST_KEY) ?? '—'}</div></div>`;

  $('game-host').innerHTML = `
    <p class="card-sub" style="text-align:center; margin-bottom:14px;">Arrow keys to play, or use the buttons below on touch. Hint suggests a move; Undo steps back once.</p>
    <div class="merge-board" id="mg-board"></div>
    <div style="display:flex; justify-content:center; gap:8px; margin-top:16px; flex-wrap:wrap;">
      <button class="btn mg-dirbtn" id="mg-up">↑</button>
      <button class="btn mg-dirbtn" id="mg-down">↓</button>
      <button class="btn mg-dirbtn" id="mg-left">←</button>
      <button class="btn mg-dirbtn" id="mg-right">→</button>
    </div>
    <div style="display:flex; justify-content:center; gap:8px; margin-top:8px; flex-wrap:wrap;">
      <button class="btn" id="mg-hint">💡 Hint</button>
      <button class="btn" id="mg-undo">↩ Undo</button>
      <button class="btn primary" id="mg-new">New game</button>
    </div>
    <div class="game-overlay" id="mg-overlay" style="display:none; position:static; margin-top:14px; background:none; backdrop-filter:none;"></div>`;

  const TILE_COLORS = { 2: '#f0f1f5', 4: '#ffe8d5', 8: '#ffd0a8', 16: '#ffb17a', 32: '#ff9c66', 64: '#ff7a2f',
    128: '#e0475f', 256: '#c8102e', 512: '#7fb2ff', 1024: '#3b82f6', 2048: '#34c759' };

  let grid = [];
  let score = 0;
  let over = false;
  let spawnPos = null;
  let undoState = null;

  function emptyGrid() { return Array.from({ length: SIZE }, () => new Array(SIZE).fill(0)); }
  function cloneGrid(g) { return g.map(row => row.slice()); }

  function addRandomTile(g, scoreForOdds) {
    const empties = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (g[r][c] === 0) empties.push([r, c]);
    if (!empties.length) return null;
    const [r, c] = empties[Math.floor(Math.random() * empties.length)];
    // The higher the score climbs, the more often a 4 shows up instead of a
    // 2 — harder to plan around, same as the real game gets harder late.
    const twoChance = Math.max(0.9 - scoreForOdds / 15000, 0.68);
    g[r][c] = Math.random() < twoChance ? 2 : 4;
    return [r, c];
  }

  function newGame() {
    grid = emptyGrid(); score = 0; over = false; undoState = null;
    addRandomTile(grid, 0); spawnPos = addRandomTile(grid, 0);
    draw();
  }

  function slideRow(row) {
    const values = row.filter(v => v !== 0);
    const merged = [];
    let gained = 0;
    for (let i = 0; i < values.length; i++) {
      if (i < values.length - 1 && values[i] === values[i + 1]) {
        merged.push(values[i] * 2);
        gained += values[i] * 2;
        i++;
      } else {
        merged.push(values[i]);
      }
    }
    while (merged.length < SIZE) merged.push(0);
    return { row: merged, gained };
  }

  function rotateGrid(g) {
    const result = emptyGrid();
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) result[c][SIZE - 1 - r] = g[r][c];
    return result;
  }

  // Pure: simulates a move on any grid without touching game state, so it
  // can be reused both for the real move and for the hint's what-if search.
  function simulateMove(sourceGrid, direction) {
    let working = sourceGrid;
    const rotations = { left: 0, up: 1, right: 2, down: 3 }[direction];
    for (let i = 0; i < rotations; i++) working = rotateGrid(working);

    let moved = false;
    let gainedTotal = 0;
    const result = working.map(row => {
      const before = row.join(',');
      const { row: after, gained } = slideRow(row);
      if (after.join(',') !== before) moved = true;
      gainedTotal += gained;
      return after;
    });

    for (let i = 0; i < (4 - rotations) % 4; i++) working = rotateGrid(result);
    const final = rotations === 0 ? result : working;
    return { grid: final, moved, gained: gainedTotal };
  }

  function move(direction) {
    if (over) return;
    const { grid: final, moved, gained } = simulateMove(grid, direction);
    if (moved) {
      undoState = { grid: cloneGrid(grid), score };
      grid = final;
      score += gained;
      spawnPos = addRandomTile(grid, score);
      if (!hasMoves()) over = true;
      draw();
      if (over) {
        const best = Math.max(readBest(BEST_KEY) ?? 0, score);
        saveBest(BEST_KEY, best);
        $('mg-best').textContent = best;
      }
    }
  }

  function undo() {
    if (!undoState || over) return;
    grid = undoState.grid;
    score = undoState.score;
    undoState = null;
    spawnPos = null;
    draw();
  }

  // A small heuristic search (empty cells, "smoothness" between neighbors,
  // and keeping the biggest tile cornered) — not full lookahead, but real
  // evaluation of the resulting board rather than a coin flip between
  // directions that happen to be legal.
  function evaluateGrid(g) {
    let empty = 0, monotonicity = 0, maxVal = 0;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      if (g[r][c] === 0) empty++;
      maxVal = Math.max(maxVal, g[r][c]);
    }
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE - 1; c++) {
      if (g[r][c] && g[r][c + 1]) monotonicity -= Math.abs(Math.log2(g[r][c]) - Math.log2(g[r][c + 1]));
    }
    for (let c = 0; c < SIZE; c++) for (let r = 0; r < SIZE - 1; r++) {
      if (g[r][c] && g[r + 1][c]) monotonicity -= Math.abs(Math.log2(g[r][c]) - Math.log2(g[r + 1][c]));
    }
    const corners = [g[0][0], g[0][SIZE - 1], g[SIZE - 1][0], g[SIZE - 1][SIZE - 1]];
    const cornerBonus = corners.includes(maxVal) ? maxVal : 0;
    return empty * 8 + monotonicity * 2 + cornerBonus * 0.5;
  }

  function hint() {
    if (over) return;
    let best = null, bestScore = -Infinity;
    DIRECTIONS.forEach(dir => {
      const { grid: g, moved } = simulateMove(grid, dir);
      if (!moved) return;
      const s = evaluateGrid(g);
      if (s > bestScore) { bestScore = s; best = dir; }
    });
    document.querySelectorAll('.mg-dirbtn').forEach(b => b.classList.remove('suggested'));
    if (best) {
      const btn = $(`mg-${best}`);
      btn.classList.add('suggested');
      setTimeout(() => btn.classList.remove('suggested'), 1300);
    }
  }

  function hasMoves() {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] === 0) return true;
      if (c < SIZE - 1 && grid[r][c] === grid[r][c + 1]) return true;
      if (r < SIZE - 1 && grid[r][c] === grid[r + 1][c]) return true;
    }
    return false;
  }

  function draw() {
    const board = $('mg-board');
    board.innerHTML = '';
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const value = grid[r][c];
      const cell = document.createElement('div');
      cell.className = 'merge-cell' + (spawnPos && spawnPos[0] === r && spawnPos[1] === c ? ' spawn' : '');
      if (value) {
        cell.textContent = value;
        cell.style.background = TILE_COLORS[value] || '#1c1c1e';
        cell.style.color = value <= 4 ? 'var(--text)' : '#fff';
      }
      board.appendChild(cell);
    }
    $('mg-score').textContent = score;
    $('mg-undo').disabled = !undoState;
    const overlay = $('mg-overlay');
    overlay.style.display = over ? 'flex' : 'none';
    if (over) overlay.innerHTML = `<div class="g-title">No more moves</div><div class="g-sub">Score ${score}</div>`;
  }

  mergeKeyHandler = (e) => {
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (map[e.key]) { e.preventDefault(); move(map[e.key]); }
    else if (e.key === 'h' || e.key === 'H') { hint(); }
    else if (e.key === 'z' || e.key === 'Z') { undo(); }
  };
  document.addEventListener('keydown', mergeKeyHandler);

  $('mg-up').addEventListener('click', () => move('up'));
  $('mg-down').addEventListener('click', () => move('down'));
  $('mg-left').addEventListener('click', () => move('left'));
  $('mg-right').addEventListener('click', () => move('right'));
  $('mg-hint').addEventListener('click', hint);
  $('mg-undo').addEventListener('click', undo);
  $('mg-new').addEventListener('click', newGame);

  newGame();
}

/* ---- Game 6: Brick Break (breakout, with level progression) ------------ */

function initBreakout() {
  const BEST_KEY = 'dejavu1.breakout.best';
  const W = 480, H = 360, PADDLE_W_BASE = 80, PADDLE_H = 12, BALL_R = 6;
  const COLS = 8, BRICK_H = 18, ROWS_MAX = 7;
  const MAX_BALLS = 3, WIDE_TICKS = 480, POWERUP_CHANCE = 0.16;
  const POWERUP_TYPES = [
    { kind: 'multi', label: 'Multi-ball!', letter: 'M', color: '#7fb2ff' },
    { kind: 'wide', label: 'Paddle grow!', letter: 'W', color: '#34c759' },
    { kind: 'slow', label: 'Slowed down!', letter: 'S', color: '#e0475f' },
  ];

  $('game-stats').innerHTML = `
    <div class="game-stat"><div class="g-key">Level</div><div class="g-val" id="bo-level">1</div></div>
    <div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="bo-score">0</div></div>
    <div class="game-stat"><div class="g-key">Best level</div><div class="g-val accent" id="bo-best">${readBest(BEST_KEY) ?? '—'}</div></div>`;

  $('game-host').innerHTML = `
    <div class="game-surface breakout" id="bo-surface" style="width:${W}px; max-width:100%; height:${H}px;">
      <div class="bo-paddle" id="bo-paddle" style="width:${PADDLE_W_BASE}px;"></div>
      <div class="game-overlay" id="bo-overlay"><div class="g-title">Brick Break</div><div class="g-sub">Move the mouse to steer — click to launch. Tougher bricks take two hits; falling capsules are worth catching.</div></div>
    </div>`;

  const BRICK_W = W / COLS;
  const COLORS = ['#ff9c66', '#ffcc66', '#7fb2ff', '#5cc16f', '#e0475f', '#34c759', '#a78bfa'];

  // Every level shrinks the paddle a little and speeds the ball up, on top
  // of one more row of bricks, up to ROWS_MAX — it keeps going instead of
  // stopping the moment the board clears.
  let level = 1;
  let paddleW = PADDLE_W_BASE;
  let paddleX = W / 2 - paddleW / 2;
  let balls = [];
  let bricks = [];
  let powerups = [];
  let wideTicks = 0;
  let score = 0;
  let status = 'idle';

  function ballSpeedMultiplier() {
    return 1 + (level - 1) * 0.14;
  }

  function effectivePaddleW() {
    return wideTicks > 0 ? Math.min(paddleW * 1.4, W * 0.55) : paddleW;
  }

  function popup(text) {
    const host = $('bo-surface');
    const el = document.createElement('div');
    el.className = 'bo-popup';
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => el.remove(), 750);
  }

  // Past level 2, some bricks need two hits — a crack shows after the
  // first, distinct from a one-hit brick instead of just "more health".
  function resetBricks(forLevel) {
    const rows = Math.min(3 + Math.floor((forLevel - 1) / 1), ROWS_MAX);
    const toughChance = Math.min(Math.max((forLevel - 2) * 0.07, 0), 0.35);
    bricks = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < COLS; c++) {
      const hp = Math.random() < toughChance ? 2 : 1;
      bricks.push({ x: c * BRICK_W, y: r * BRICK_H + 10, w: BRICK_W - 4, h: BRICK_H - 4, color: COLORS[r % COLORS.length], hp, maxHp: hp, alive: true });
    }
  }

  function setupLevel(forLevel) {
    level = forLevel;
    paddleW = Math.max(PADDLE_W_BASE - (level - 1) * 4, 40);
    paddleX = Math.max(0, Math.min(W - paddleW, paddleX));
    wideTicks = 0;
    powerups = [];
    resetBricks(level);
    const speed = 3.4 * ballSpeedMultiplier();
    balls = [{ x: W / 2, y: H - 40, vx: speed * 0.7, vy: -speed }];
  }

  function draw() {
    const surface = $('bo-surface');
    surface.querySelectorAll('.bo-brick, .bo-ball, .bo-powerup').forEach(el => el.remove());
    bricks.forEach(b => {
      if (!b.alive) return;
      const el = document.createElement('div');
      el.className = 'bo-brick' + (b.hp < b.maxHp ? ' cracked' : '');
      el.style.left = `${b.x + 2}px`; el.style.top = `${b.y}px`;
      el.style.width = `${b.w}px`; el.style.height = `${b.h}px`;
      el.style.background = b.color;
      surface.appendChild(el);
    });
    balls.forEach(b => {
      const el = document.createElement('div');
      el.className = 'bo-ball';
      el.style.left = `${b.x - BALL_R}px`; el.style.top = `${b.y - BALL_R}px`;
      surface.appendChild(el);
    });
    powerups.forEach(p => {
      const el = document.createElement('div');
      el.className = 'bo-powerup';
      el.style.left = `${p.x - 11}px`; el.style.top = `${p.y - 11}px`;
      el.style.background = p.color;
      el.textContent = p.letter;
      surface.appendChild(el);
    });
    const effW = effectivePaddleW();
    $('bo-paddle').style.left = `${paddleX}px`;
    $('bo-paddle').style.width = `${effW}px`;
    $('bo-paddle').style.bottom = '10px';
    $('bo-paddle').classList.toggle('wide', wideTicks > 0);
    $('bo-level').textContent = level;
    $('bo-score').textContent = score;

    const overlay = $('bo-overlay');
    overlay.style.display = status === 'playing' ? 'none' : 'flex';
    if (status === 'over') overlay.innerHTML = `<div class="g-title">Game over</div><div class="g-sub">Reached level ${level}, score ${score} — click to try again</div>`;
  }

  function applyPowerup(type) {
    if (type === 'multi') {
      if (balls.length < MAX_BALLS && balls.length) {
        const src = balls[0];
        balls.push({ x: src.x, y: src.y, vx: -src.vx || (Math.random() < 0.5 ? -2.4 : 2.4), vy: src.vy });
      }
    } else if (type === 'wide') {
      wideTicks = WIDE_TICKS;
      paddleX = Math.max(0, Math.min(W - effectivePaddleW(), paddleX));
    } else if (type === 'slow') {
      balls.forEach(b => { b.vx *= 0.6; b.vy *= 0.6; });
    }
    const meta = POWERUP_TYPES.find(p => p.kind === type);
    if (meta) popup(meta.label);
  }

  function tick() {
    if (status !== 'playing') return;
    if (wideTicks > 0) wideTicks -= 1;
    const effW = effectivePaddleW();
    const paddleY = H - 10 - PADDLE_H;

    for (let i = balls.length - 1; i >= 0; i--) {
      const ball = balls[i];
      ball.x += ball.vx; ball.y += ball.vy;

      if (ball.x - BALL_R < 0 || ball.x + BALL_R > W) ball.vx *= -1;
      if (ball.y - BALL_R < 0) ball.vy *= -1;

      if (ball.y + BALL_R >= paddleY && ball.y + BALL_R <= paddleY + PADDLE_H + 6 &&
          ball.x >= paddleX && ball.x <= paddleX + effW && ball.vy > 0) {
        const hitPos = (ball.x - paddleX) / effW - 0.5;
        const speed = 3.4 * ballSpeedMultiplier();
        ball.vx = hitPos * speed * 2.2;
        ball.vy = -Math.abs(speed);
      }

      bricks.forEach(b => {
        if (!b.alive) return;
        if (ball.x + BALL_R > b.x && ball.x - BALL_R < b.x + b.w && ball.y + BALL_R > b.y && ball.y - BALL_R < b.y + b.h) {
          b.hp -= 1;
          ball.vy *= -1;
          if (b.hp <= 0) {
            b.alive = false;
            score += 10;
            if (Math.random() < POWERUP_CHANCE) {
              const meta = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
              powerups.push({ x: b.x + b.w / 2, y: b.y, vy: 1.7, kind: meta.kind, letter: meta.letter, color: meta.color });
            }
          } else {
            score += 4;
          }
        }
      });

      if (ball.y - BALL_R > H) balls.splice(i, 1);
    }

    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.y += p.vy;
      if (p.y - 11 >= paddleY - 4 && p.y - 11 <= paddleY + PADDLE_H + 6 && p.x >= paddleX && p.x <= paddleX + effW) {
        applyPowerup(p.kind);
        powerups.splice(i, 1);
      } else if (p.y > H) {
        powerups.splice(i, 1);
      }
    }

    if (!balls.length) {
      status = 'over';
      clearInterval(gameLoopHandle); gameLoopHandle = null;
      const best = Math.max(readBest(BEST_KEY) ?? 0, level);
      saveBest(BEST_KEY, best);
      $('bo-best').textContent = best;
    } else if (bricks.every(b => !b.alive)) {
      // Cleared the board — advance instead of stopping. Score carries over.
      setupLevel(level + 1);
      const best = Math.max(readBest(BEST_KEY) ?? 0, level);
      saveBest(BEST_KEY, best);
      $('bo-best').textContent = best;
    }
    draw();
  }

  $('bo-surface').addEventListener('pointermove', (e) => {
    const rect = $('bo-surface').getBoundingClientRect();
    const effW = effectivePaddleW();
    paddleX = Math.max(0, Math.min(W - effW, e.clientX - rect.left - effW / 2));
    if (status !== 'playing') draw();
  });

  $('bo-surface').addEventListener('click', () => {
    if (status !== 'playing') {
      score = 0; status = 'playing';
      setupLevel(1);
      gameLoopHandle = setInterval(tick, 16);
    }
  });

  setupLevel(1);
  draw();
}

/* ---- the moving specular highlight -------------------------------------*/

function trackHighlights() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let queued = false;
  document.addEventListener('pointermove', event => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      document.querySelectorAll('.liquid-glass').forEach(el => {
        const box = el.getBoundingClientRect();
        const margin = 70;
        const near = event.clientX >= box.left - margin && event.clientX <= box.right + margin &&
                     event.clientY >= box.top - margin && event.clientY <= box.bottom + margin;
        if (!near) return;
        el.style.setProperty('--mx', `${((event.clientX - box.left) / box.width) * 100}%`);
        el.style.setProperty('--my', `${((event.clientY - box.top) / box.height) * 100}%`);
      });
      queued = false;
    });
  }, { passive: true });
}

/* ---- start up ------------------------------------------------------------*/

async function refreshAll() {
  try {
    await loadConnection();
    await Promise.all([
      loadMaintenance(), loadRings(), loadColorCheck(), loadStatusRibbon(),
      loadFilament(), loadCompare(), loadModules(), loadDevices(),
      loadUpdates(), loadPrinterControl(), loadCost(),
    ]);
    $('stamp').textContent = new Date().toLocaleTimeString();
  } catch (err) {
    console.error('Dashboard failed to load:', err);
    $('foot-state').textContent = 'Could not reach the backend.';
  }
}

function initDemoToggle() {
  const toggle = $('demo-toggle');
  toggle.checked = demoOn;
  toggle.addEventListener('change', () => {
    demoOn = toggle.checked;
    localStorage.setItem(STORE_KEY, demoOn ? '1' : '0');
    refreshAll();
  });
}

initDemoToggle();
initTabs();
initPreferences();
initSpoolForm();
initRepeatSettings();
initPairing();
initNotifications();
initCostSettings();
initBridges();
initGames();
trackHighlights();
refreshAll();
loadNotificationSettings();

setInterval(() => {
  if (demoOn) { loadRings(); loadColorCheck(); loadStatusRibbon(); loadCost(); }
}, 5000);
