/* Native preparation tools. Stored choices and physical readings are shown separately. */
'use strict';
window.PrintRoom = (() => {
  const getJSON = path => window.getJSON ? window.getJSON(api(path)) : fetch(api(path)).then(r=>r.json());
  const post = (path, body) => postJSON(api(path), body);
  let loadedFor = '', busy = false;
  const materials = ['PLA','PETG','ABS','ASA','TPU','PVA','PA','PC'];
  function mount() {
    const host = document.createElement('section');
    host.id = 'tool-setup'; host.className = 'card liquid-glass';
    host.innerHTML = `<div class="card-head"><div><span class="eyebrow">PREPARE · FOUR PHYSICAL HEADS</span><h2>Tools & filaments</h2><p class="card-sub">One saved setup for this printer, used when preparing and checking a print.</p></div></div>
      <p id="ts-note" role="status">Choose a printer, then load its saved choices.</p><button class="btn" id="ts-load">Load this printer’s setup</button>
      <form id="ts-form" hidden><div id="ts-heads" class="tool-setup-grid"></div><div class="fd-actions"><button class="btn primary">Save preparation choices</button><button type="button" class="btn" id="ts-guard">Check feeder compatibility</button></div></form><p id="ts-result" role="status" aria-live="polite"></p>`;
    $('tab-autoprint').insertBefore(host,$('ap-off'));
    $('ts-load').onclick = load;
    $('ts-form').onsubmit = async e => {e.preventDefault();const r=await post('/api/tools/assignments',{heads:rows()});$('ts-result').textContent=r.ok?'Saved for this printer. Nozzle choices describe your setup; they do not change hardware.':r.body.error;};
    $('ts-guard').onclick = async()=>{const d=await getJSON('/api/tools/compatibility');$('ts-result').textContent=d?.note?d.note+' '+d.addons.map(a=>a.name+': '+(a.detected?'detected; verify its own configuration':'not detected')).join(' · '):'Connect a printer or enable Demo data to inspect capabilities.';};
    window.addEventListener('dv-refresh',()=>{if(loadedFor&&loadedFor!==currentPrinter){loadedFor='';$('ts-form').hidden=true;$('ts-note').textContent='Printer changed. Load its saved setup before editing.';}});
  }
  function rows(){return [...document.querySelectorAll('#ts-heads fieldset')].map(f=>({toolhead:f.dataset.tool,color_hex:f.querySelector('[name=color]').value,material:f.querySelector('[name=material]').value,nozzle:Number(f.querySelector('[name=nozzle]').value),height:Number(f.querySelector('[name=height]').value),spool_id:f.querySelector('[name=spool]').value}));}
  async function load(){if(busy)return;busy=true;try{
    const [saved,state,inventory]=await Promise.all([getJSON('/api/tools/assignments'),getJSON('/api/printer'),getJSON('/api/filament')]);
    if(!saved?.heads)throw new Error('Enable Filament inventory in Settings → Modules to save tool choices.');
    loadedFor=currentPrinter;
    const spools=inventory?.spools||[];
    paint($('ts-heads'),[0,1,2,3].map(i=>{const th='T'+i,d=state?.toolheads?.[th]||{},h=saved.heads.find(x=>x.toolhead===th)||{color_hex:d.filament_color_hex||'#808080',material:d.filament_material||'PLA',nozzle:d.nozzle_diameter||.4,height:.2};return `<fieldset data-tool="${esc(th)}"><legend>${esc(th)}</legend><p class="field-hint">Printer: ${esc(d.filament_color_hex||'colour unknown')} · ${esc(d.filament_material||'material unknown')} · ${esc(d.nozzle_diameter??'nozzle unknown')} mm</p>
      <label>Spool<select name="spool"><option value="">Choose by hand</option>${spools.map(s=>`<option value="${esc(s.id)}" ${s.id===h.spool_id?'selected':''}>${esc(s.material)} · ${esc(s.color_name)}</option>`).join('')}</select></label>
      <label>Colour<input type="color" name="color" value="${esc(h.color_hex)}"></label><label>Material<select name="material">${materials.map(m=>`<option ${m===h.material?'selected':''}>${esc(m)}</option>`).join('')}</select></label>
      <label>Fitted nozzle, mm<select name="nozzle">${[.2,.4,.6,.8].map(n=>`<option value="${n}" ${n===h.nozzle?'selected':''}>${n}</option>`).join('')}</select></label><label>Layer height, mm<input name="height" type="number" min=".04" max=".56" step=".01" value="${esc(h.height)}" required></label><button class="btn" type="button" data-apply="${esc(th)}">Apply colour & material to ${esc(th)}</button></fieldset>`;}).join(''));
    $('ts-form').hidden=false;$('ts-note').textContent=saved.note+' Grey is an editable starting choice when colour is unknown.';
    document.querySelectorAll('#ts-heads [name=spool]').forEach(el=>el.onchange=()=>{const s=spools.find(s=>s.id===el.value),f=el.closest('fieldset');if(s){f.querySelector('[name=color]').value=s.color_hex;if(materials.includes(s.material))f.querySelector('[name=material]').value=s.material;}});
    document.querySelectorAll('[data-apply]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const r=await post('/api/printer/control/filament',rows().find(h=>h.toolhead===b.dataset.apply));$('ts-result').textContent=r.ok?`${b.dataset.apply}: printer confirmed colour and material.`:(r.body.error||'Connect a printer or enable Demo data.');}finally{b.disabled=false;}});
  }catch(e){$('ts-note').textContent=e.message;}finally{busy=false;}}
  mount();return {load,rows};
})();
