/* Layer inspection uses file coordinates and requested speeds, never invented timings. */
'use strict';
window.DVGcode = {mount(entry,a,viewer){
  if(!viewer||!a.toolpath)return;
  const path=a.toolpath,segments=path.segments;
  const zs=a.layer_heights?.length?a.layer_heights:[...new Set(segments.filter(s=>s[7]===1).map(s=>s[5]))].sort((a,b)=>a-b);
  if(!zs.length)return;
  viewer.setToolpath(segments,a.meta?.filament_colours||a.colours,path);
  const tools=document.getElementById('fd-view-tools');
  tools.innerHTML=`<div class="gcode-toolbar"><label class="vt-layer">Layer <output id="gv-layer">${zs.length}</output> / ${zs.length}<input id="gv-range" type="range" min="0" max="${zs.length-1}" value="${zs.length-1}" step="1" aria-label="Preview layer"></label><span id="gv-height" class="plate-dimensions"></span><label><input type="checkbox" id="gv-single"> This layer only</label><label><input type="checkbox" id="gv-travel"> Travel moves</label><label><input type="checkbox" id="gv-markers"> Retractions & tool changes</label><label>Colour by<select id="gv-style"><option value="tool">Toolhead</option>${segments.some(s=>s.length>8)?'<option value="speed">Requested speed</option><option value="feature">Feature type</option>':''}</select></label><label>Show tool<select id="gv-tool"><option value="-1">All tools</option>${[0,1,2,3].map(i=>`<option value="${i}">T${i}</option>`).join('')}</select></label><button class="btn" id="gv-prev">Previous layer</button><button class="btn" id="gv-next">Next layer</button><p id="gv-legend" class="field-hint"></p></div>`;
  const $g=id=>document.getElementById(id);
  const layer=()=>{const n=Number($g('gv-range').value);$g('gv-layer').value=String(n+1);$g('gv-height').textContent=`Z ${zs[n].toFixed(3)} mm`;viewer.lowerLimit=$g('gv-single').checked?zs[n]-.001:-Infinity;viewer.setLayerLimit(zs[n]);};
  $g('gv-range').oninput=layer;$g('gv-single').onchange=layer;
  $g('gv-travel').onchange=e=>{viewer.showTravel=e.target.checked;viewer.draw();};
  $g('gv-markers').onchange=e=>{viewer.showMarkers=e.target.checked;viewer.draw();};
  const style=()=>{viewer.setPathStyle($g('gv-style').value,Number($g('gv-tool').value));$g('gv-legend').textContent=$g('gv-style').value==='speed'?'Blue is slower, red is faster. Speeds are the file’s requests; acceleration and firmware limits change actual speed.':$g('gv-style').value==='feature'?(path.feature_names||[]).map((x,i)=>`${i+1}: ${x}`).join(' · '):'Tool colours come from the file. Yellow dots mark tool changes; pink dots mark retractions.';};
  $g('gv-style').onchange=style;$g('gv-tool').onchange=style;
  $g('gv-prev').onclick=()=>{$g('gv-range').value=Math.max(0,Number($g('gv-range').value)-1);layer();};
  $g('gv-next').onclick=()=>{$g('gv-range').value=Math.min(zs.length-1,Number($g('gv-range').value)+1);layer();};
  const detail=document.createElement('details');detail.className='log';
  detail.innerHTML=`<summary>Movement evidence & events</summary><p>${esc(a.nominal_motion_note||'This browser preview does not compute print time or filament weight.')}${Number.isFinite(a.nominal_motion_seconds)?' · '+esc(a.nominal_motion_seconds)+' seconds of nominal motion.':''}</p><p>${path.downsampled?'The drawing is sampled; the server checks every instruction.':'The drawing includes every movement segment.'} ${path.markers_capped?'Event markers are capped at 10,000.':''}</p><ol>${(path.markers||[]).slice(0,100).map(m=>`<li>${esc(m.kind==='toolchange'?'Tool change':'Retraction')} · T${esc(m.tool)} · line ${esc(m.line)} · Z ${esc(m.position[2])} mm</li>`).join('')}</ol>`;
  document.getElementById('fd-side').append(detail);layer();style();
}};
