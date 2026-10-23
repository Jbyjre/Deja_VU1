/* Native preparation tools. Stored choices and physical readings are shown separately. */
'use strict';
window.PrintRoom = (() => {
  const getJSON = path => window.getJSON ? window.getJSON(api(path)) : fetch(api(path)).then(r=>r.json());
  const post = (path, body) => postJSON(api(path), body);
  let loadedFor = null, busy = false;
  const materials = ['PLA','PETG','ABS','ASA','TPU','PVA','PA','PC'];
  function mount() {
    const host = document.createElement('section');
    host.id = 'tool-setup'; host.className = 'card liquid-glass';
    host.innerHTML = `<div class="card-head"><div><span class="eyebrow">PREPARE · FOUR PHYSICAL HEADS</span><h2>Tools & filaments</h2><p class="card-sub">One saved setup for this printer, used when preparing and checking a print.</p></div></div>
      <p id="ts-note" role="status">Choose a printer, then load its saved choices.</p><button class="btn" id="ts-load">Load this printer’s setup</button>
      <form id="ts-form" hidden><div id="ts-heads" class="tool-setup-grid"></div><section class="ts-stack-wrap" aria-labelledby="ts-stack-title"><h3 id="ts-stack-title">Layer heights · per head</h3><p class="field-hint">Every head prints a whole number of base layers per pass. Leave all on ×1 for an ordinary single-height print; a process profile set to “Mixed” uses these heights.</p><div id="ts-stack"></div></section><div class="fd-actions"><button class="btn primary">Save preparation choices</button><button type="button" class="btn" id="ts-guard">Check feeder compatibility</button></div></form><p id="ts-result" role="status" aria-live="polite"></p>`;
    $('tab-autoprint').insertBefore(host,$('ap-off'));
    $('ts-load').onclick = load;
    $('ts-form').onsubmit = async e => {e.preventDefault();try{const printer=currentPrinter;const r=await post('/api/tools/assignments',{heads:rows()});if(printer!==currentPrinter)return;$('ts-result').textContent=r.ok?'Saved for this printer. Nozzle choices describe your setup; they do not change hardware.':r.body.error;}catch(e){$('ts-result').textContent=e.message;}};
    $('ts-guard').onclick = async()=>{const d=await getJSON('/api/tools/compatibility');$('ts-result').textContent=d?.note?d.note+' '+d.addons.map(a=>a.name+': '+(a.detected?'detected; verify its own configuration':'not detected')).join(' · '):'Connect a printer or enable Demo data to inspect capabilities.';};
    window.addEventListener('dv-refresh',()=>{if(loadedFor!==null&&loadedFor!==currentPrinter)invalidate();});
  }
  function invalidate(){loadedFor=null;$('ts-form').hidden=true;$('ts-note').textContent='Printer changed. Load its saved setup before editing.';}
  function rows(){if(loadedFor===null||loadedFor!==currentPrinter){invalidate();throw new Error('Printer changed. Load its saved setup before editing.');}return [...document.querySelectorAll('#ts-heads fieldset')].map(f=>({toolhead:f.dataset.tool,color_hex:f.querySelector('[name=color]').value,material:f.querySelector('[name=material]').value,nozzle:Number(f.querySelector('[name=nozzle]').value),height:Number(f.querySelector('[name=height]').value),spool_id:f.querySelector('[name=spool]').value}));}
  async function load(){if(busy)return;busy=true;const forPrinter=currentPrinter;loadedFor=null;$('ts-form').hidden=true;try{
    const [saved,state,inventory]=await Promise.all([getJSON('/api/tools/assignments'),getJSON('/api/printer'),getJSON('/api/filament')]);
    if(!saved?.heads)throw new Error('Enable Filament inventory in Settings → Modules to save tool choices.');
    if(forPrinter!==currentPrinter)throw new Error('Printer changed while loading. Load its saved setup again.');
    loadedFor=currentPrinter;
    const spools=inventory?.spools||[];
    paint($('ts-heads'),[0,1,2,3].map(i=>{const th='T'+i,d=state?.toolheads?.[th]||{},h=saved.heads.find(x=>x.toolhead===th)||{color_hex:d.filament_color_hex||'#808080',material:d.filament_material||'PLA',nozzle:d.nozzle_diameter||.4,height:.2};return `<fieldset data-tool="${esc(th)}"><legend>${esc(th)}</legend><p class="field-hint">Printer: ${esc(d.filament_color_hex||'colour unknown')} · ${esc(d.filament_material||'material unknown')} · ${esc(d.nozzle_diameter??'nozzle unknown')} mm</p>
      <label>Spool<select name="spool"><option value="">Choose by hand</option>${spools.map(s=>`<option value="${esc(s.id)}" ${s.id===h.spool_id?'selected':''}>${esc(s.material)} · ${esc(s.color_name)}</option>`).join('')}</select></label>
      <label>Colour<input type="color" name="color" value="${esc(h.color_hex)}"></label><label>Material<select name="material">${materials.map(m=>`<option ${m===h.material?'selected':''}>${esc(m)}</option>`).join('')}</select></label>
      <label>Fitted nozzle, mm<select name="nozzle">${[.2,.4,.6,.8].map(n=>`<option value="${n}" ${n===h.nozzle?'selected':''}>${n}</option>`).join('')}</select></label><input name="height" type="hidden" value="${esc(h.height)}"><button class="btn" type="button" data-apply="${esc(th)}">Apply colour & material to ${esc(th)}</button></fieldset>`;}).join(''));
    $('ts-form').hidden=false;$('ts-note').textContent=saved.note+' Grey is an editable starting choice when colour is unknown.';
    mountStack();
    document.querySelectorAll('#ts-heads [name=spool]').forEach(el=>el.onchange=()=>{const s=spools.find(s=>s.id===el.value),f=el.closest('fieldset');if(s){f.querySelector('[name=color]').value=s.color_hex;if(materials.includes(s.material))f.querySelector('[name=material]').value=s.material;}});
    document.querySelectorAll('[data-apply]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const printer=currentPrinter;const r=await post('/api/printer/control/filament',rows().find(h=>h.toolhead===b.dataset.apply));if(printer!==currentPrinter)return;$('ts-result').textContent=r.ok?`${b.dataset.apply}: printer confirmed colour and material.`:(r.body.error||'Connect a printer or enable Demo data.');}catch(e){$('ts-result').textContent=e.message;}finally{b.disabled=false;}});
  }catch(e){$('ts-note').textContent=e.message;}finally{busy=false;}}
  let stack=null;
  function stackHeads(){return [...document.querySelectorAll('#ts-heads fieldset')].map(f=>({toolhead:f.dataset.tool,nozzle:Number(f.querySelector('[name=nozzle]').value),color:f.querySelector('[name=color]').value,height:Number(f.querySelector('[name=height]').value)||.2}));}
  function mountStack(){
    if(!window.LayerStack)return;
    const start=LayerStack.fromHeights(stackHeads());
    stack=LayerStack.mount($('ts-stack'),{heads:start.heads,base:start.base,onChange:write});
    write(stack.get());
    document.querySelectorAll('#ts-heads [name=nozzle],#ts-heads [name=color],#ts-heads [name=spool]').forEach(el=>el.addEventListener('change',()=>stack.set({heads:stackHeads().map(h=>({nozzle:h.nozzle,color:h.color}))})));
  }
  function write(st){st.heads.forEach(h=>{const f=document.querySelector(`#ts-heads fieldset[data-tool="${h.toolhead}"] [name=height]`);if(f)f.value=h.height;});}

  /* Process settings, laid out like OrcaSlicer's process tabs. Drawn from
     GET /api/slicer/schema (backend/process_settings.py), so the editor and
     the server's checks use one table. Blank = inherit the chosen preset. */
  function SettingsEditor(host){
    const PRETTY={'normal(auto)':'Normal (auto)','tree(auto)':'Tree (auto)','normal(manual)':'Normal (manual)','tree(manual)':'Tree (manual)',no_brim:'No brim',outer_only:'Outer only',inner_only:'Inner only',outer_and_inner:'Outer and inner',auto_brim:'Auto',brim_ears:'Mouse ears','no ironing':'No ironing',topmost:'Topmost surface only',tree_slim:'Tree slim',tree_strong:'Tree strong',tree_hybrid:'Tree hybrid',adaptivecubic:'Adaptive cubic',supportcubic:'Support cubic','3dhoneycomb':'3D honeycomb','tri-hexagon':'Tri-hexagon',alignedrectilinear:'Aligned rectilinear',monotonicline:'Monotonic line',hilbertcurve:'Hilbert curve',archimedeanchords:'Archimedean chords',octagramspiral:'Octagram spiral','rectilinear-grid':'Rectilinear grid',rectilinear_interlaced:'Rectilinear interlaced','by layer':'By layer','by object':'By object',allwalls:'All walls','inner wall/outer wall':'Inner, then outer','outer wall/inner wall':'Outer, then inner','inner-outer-inner wall':'Inner, outer, inner'};
    const nice=v=>PRETTY[v]||String(v).charAt(0).toUpperCase()+String(v).slice(1);
    let schema=null,preset={},presetName='',tab='Quality',simple=false,query='';
    const ready=getJSON('/api/slicer/schema').then(d=>{schema=d&&d.options?d:null;render();}).catch(()=>{host.innerHTML='<p class="field-hint">The settings list could not be loaded.</p>';});
    const shown=v=>Array.isArray(v)?v[0]:v;
    function control(o){
      const id=o.key==='layer_height'?'np-layer':'pe-'+o.key,inh=preset[o.key],hint=inh==null?'Inherit':String(shown(inh));
      const common=`id="${id}" data-option="${esc(o.key)}" data-type="${esc(o.type)}"`;
      if(o.type==='bool'){const on=String(shown(inh))==='1'||shown(inh)===true;return `<select ${common}><option value="">${inh==null?'Inherit':'Inherit · '+(on?'on':'off')}</option><option value="1">On</option><option value="0">Off</option></select>`;}
      if(o.type==='enum')return `<select ${common}><option value="">${inh==null?'Inherit':'Inherit · '+esc(nice(shown(inh)))}</option>${o.choices.map(c=>`<option value="${esc(c)}">${esc(nice(c))}</option>`).join('')}</select>`;
      if(o.type==='speed_or_percent')return `<input ${common} type="text" inputmode="decimal" placeholder="${esc(hint)}" pattern="\\s*\\d+(\\.\\d+)?\\s*%?\\s*" autocomplete="off">`;
      return `<input ${common} type="number" step="${o.type==='int'?1:'any'}" min="${o.min}" max="${o.max}" placeholder="${esc(hint)}" inputmode="decimal">`;
    }
    function render(){
      if(!schema)return;
      const saved=values(true);
      const opts=schema.options.filter(o=>!simple||o.simple);
      const q=query.trim().toLowerCase(),hits=q?opts.filter(o=>(o.label+' '+o.key+' '+o.section+' '+o.tab).toLowerCase().includes(q)):opts.filter(o=>o.tab===tab);
      const sections=[];hits.forEach(o=>{const name=q?`${o.tab} › ${o.section}`:o.section;let s=sections.find(x=>x.name===name);if(!s)sections.push(s={name,opts:[]});s.opts.push(o);});
      const counts=Object.fromEntries(schema.tabs.map(t=>[t,schema.options.filter(o=>o.tab===t&&saved[o.key]!==undefined).length]));
      host.innerHTML=`<div class="pe-bar">
        <div class="pe-tabs" role="tablist" aria-label="Setting groups">${schema.tabs.map(t=>`<button type="button" role="tab" id="pe-tab-${t}" aria-selected="${!q&&t===tab}" aria-controls="pe-panel" data-tab="${t}">${t}${counts[t]?`<b class="pe-count" aria-label="${counts[t]} changed">${counts[t]}</b>`:''}</button>`).join('')}</div>
        <div class="pe-tools"><label class="pe-find"><span class="sr-only">Find a setting</span><input type="search" id="pe-find" placeholder="Find a setting: seam, ironing, jerk…" value="${esc(query)}" autocomplete="off"></label>
        <div class="seg pe-mode" role="radiogroup" aria-label="How many settings to show"><button type="button" role="radio" data-simple="1" aria-checked="${simple}">Simple</button><button type="button" role="radio" data-simple="0" aria-checked="${!simple}">Advanced</button></div></div></div>
        <div class="pe-status"><span>${presetName?`Based on <b>${esc(presetName)}</b>`:'Choose a starting process to see its values'} · <span id="pe-changed">${Object.keys(saved).length}</span> changed</span><button type="button" class="btn small" id="pe-reset-all" ${Object.keys(saved).length?'':'disabled'}>Reset all</button></div>
        <div id="pe-panel" role="tabpanel" ${q?'':`aria-labelledby="pe-tab-${tab}"`} class="pe-panel">${sections.length?sections.map(sec=>`<fieldset class="pe-sec"><legend>${esc(sec.name)}</legend>${sec.opts.map(o=>`<div class="pe-row" data-key="${esc(o.key)}"><label for="${o.key==='layer_height'?'np-layer':'pe-'+esc(o.key)}">${esc(o.label)}<code class="pe-key">${esc(o.key)}</code></label><span class="pe-ctl">${control(o)}${o.unit?`<span class="pe-unit">${esc(o.unit)}</span>`:''}</span><button type="button" class="pe-reset" data-reset="${esc(o.key)}" aria-label="Reset ${esc(o.label)} to the preset" title="Use the preset’s value">↺</button>${o.tip?`<small class="pe-tip">${esc(o.tip)}</small>`:''}</div>`).join('')}</fieldset>`).join(''):`<p class="field-hint">No setting matches “${esc(query)}”.</p>`}</div>
        <p class="field-hint">${esc(schema.note)}</p>`;
      setValues(saved,true);bind();
      if($('np-mode')?.value==='per_tool'&&$('np-layer'))$('np-layer').readOnly=true;
    }
    function mark(el){const row=el.closest('.pe-row');if(row)row.classList.toggle('is-set',el.value!=='');const n=Object.keys(values(true)).length;const c=$('pe-changed');if(c)c.textContent=n;const r=$('pe-reset-all');if(r)r.disabled=!n;}
    function bind(){
      host.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;query='';render();host.querySelector(`[data-tab="${tab}"]`)?.focus();});
      host.querySelector('.pe-tabs').onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;const i=schema.tabs.indexOf(tab);tab=schema.tabs[(i+(e.key==='ArrowRight'?1:schema.tabs.length-1))%schema.tabs.length];query='';render();host.querySelector(`[data-tab="${tab}"]`)?.focus();};
      const find=$('pe-find');find.oninput=()=>{query=find.value;const at=find.selectionStart;render();const again=$('pe-find');again.focus();again.setSelectionRange(at,at);};
      host.querySelectorAll('[data-simple]').forEach(b=>b.onclick=()=>{simple=b.dataset.simple==='1';render();});
      host.querySelectorAll('[data-option]').forEach(el=>{el.addEventListener('input',()=>mark(el));el.addEventListener('change',()=>mark(el));});
      host.querySelectorAll('[data-reset]').forEach(b=>b.onclick=()=>{const el=host.querySelector(`[data-option="${b.dataset.reset}"]`);if(el&&!el.readOnly){el.value='';mark(el);}});
      $('pe-reset-all').onclick=()=>{kept={};host.querySelectorAll('[data-option]').forEach(el=>{if(!el.readOnly){el.value='';mark(el);}});};
    }
    let kept={};
    /* Values typed so far. Settings hidden by the current tab or filter are kept too. */
    function values(raw){
      const out={...kept};
      host.querySelectorAll('[data-option]').forEach(el=>{const k=el.dataset.option;if(el.value===''){delete out[k];return;}if(el.readOnly&&!raw)return;out[k]=el.value;});
      kept={...out};
      if(raw)return out;
      const typed={};for(const [k,v] of Object.entries(out)){const o=schema&&schema.options.find(x=>x.key===k);if(!o)continue;if(k==='layer_height'&&$('np-layer')?.readOnly)continue;typed[k]=o.type==='bool'?v==='1':o.type==='enum'||o.type==='speed_or_percent'?String(v).trim():Number(v);}
      return typed;
    }
    function setValues(map,quiet){
      if(!quiet)kept={};
      Object.entries(map||{}).forEach(([k,v])=>{kept[k]=typeof v==='boolean'?(v?'1':'0'):String(v).replace(/%$/,'')});
      host.querySelectorAll('[data-option]').forEach(el=>{if(el.dataset.option in kept){el.value=kept[el.dataset.option];}mark(el);});
    }
    return {ready,values:()=>values(false),setValues:map=>{ready.then(()=>setValues(map));},
      setPreset(options,name){preset=options||{};presetName=name||'';ready.then(render);}};
  }
  let editProfile = async () => {};
  function profiles() {
    const advanced=document.createElement('details');advanced.className='log';advanced.innerHTML='<summary>Exported preset files · advanced recovery</summary>';
    const old=$('ap-profile-form');old.before(advanced);advanced.append(old);
    const host=document.createElement('section');host.className='native-profile';
    const materialFields=[['nozzle_temperature','Nozzle, °C',170,320],['nozzle_temperature_initial_layer','First-layer nozzle, °C',170,320],['hot_plate_temp','Smooth plate bed, °C',0,110],['hot_plate_temp_initial_layer','First-layer smooth bed, °C',0,110],['filament_flow_ratio','Flow ratio',.5,1.5],['filament_max_volumetric_speed','Max flow, mm³/s',1,50],['fan_min_speed','Minimum fan, %',0,100],['fan_max_speed','Maximum fan, %',0,100]];
    host.innerHTML=`<span class="eyebrow">INSTALLED PRESETS · PRIVATE WORKING COPIES</span><h3>Process profile</h3><p class="field-hint">Choose a starting preset. Blank values inherit that preset; numbers below are sent to the engine. Save your fitted tools first.</p><button class="btn" id="np-scan">Find installed U1 profiles</button><p id="np-status" role="status" aria-live="polite"></p>
    <form id="np-form" class="ap-form" hidden><label>Profile name<input id="np-name" required maxlength="60" placeholder="Everyday PLA · my U1"></label><label>Printer preset<select id="np-machine"></select></label><label>Starting process<select id="np-process"></select></label>
    <label>Layer heights<select id="np-mode"><option value="shared">Same height on every head</option><option value="per_tool">Mixed: each head’s height from Tools &amp; filaments</option></select></label><p id="np-coordination" class="field-hint" role="status"></p><div id="np-stack" hidden></div>
    <label class="np-review"><input id="np-nozzle-variant" type="checkbox">I reviewed using the fitted nozzles with this U1 variant’s startup, line widths and tool-change settings.</label>
    <label class="np-review"><input id="np-variant" type="checkbox">I reviewed material temperatures and flow for another U1 nozzle variant.</label>
    <details open><summary>Materials · T0–T3</summary><div id="np-filaments"></div><p class="field-hint">Blank overrides use the selected material preset. Smooth plate temperature overrides apply only when the engine selects that plate type. The engine’s cooling enable/disable rules still apply.</p></details>
    <section class="pe" id="np-settings" aria-label="Process settings"></section>
    <p class="field-hint">Temperature and flow changes can invalidate measured colour recipes. These settings never command heaters directly. Save as new keeps your previous profile for recovery.</p><button class="btn primary">Save a new profile</button></form>`;
    advanced.before(host);let entries=[],preparedHeads=[],loadedPrinter=null;const editor=SettingsEditor($('np-settings'));
    const fill=(el,list)=>{el.innerHTML=list.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');};
    let profileStack=null,thick={mode:'fixed',tolerance:80};
    function coordination(){const separate=$('np-mode').value==='per_tool';if($('np-layer'))$('np-layer').readOnly=separate;$('np-stack').hidden=!separate;
      if(!separate){$('np-coordination').textContent='Every head prints the layer height under Quality & shells. The per-head heights in Tools & filaments are not used.';return;}
      if(!preparedHeads.length||!window.LayerStack){$('np-coordination').textContent='Save the four heads in Tools & filaments first; their layer heights are used here.';return;}
      const start=LayerStack.fromHeights(preparedHeads.map(h=>({toolhead:h.toolhead,nozzle:h.nozzle,color:h.color_hex,height:h.height})));
      profileStack=LayerStack.mount($('np-stack'),{heads:start.heads,base:start.base,lockHeads:true,showMode:true,mode:thick.mode,tolerance:thick.tolerance,onChange:st=>{thick={mode:st.mode,tolerance:st.tolerance};}});
      editor.ready.then(()=>{const l=$('np-layer');if(l){l.value=start.base;l.closest('.pe-row')?.classList.add('is-set');}});
      $('np-coordination').textContent='The base layer becomes the process layer height. Change a head’s multiple in Tools & filaments. The server checks the same rules again on save; inspect the sliced preview before printing.';}
    function processValues(){const p=entries.find(x=>x.id===$('np-process').value);editor.setPreset(p?.options||{},p?.name||'');coordination();}
    function materialValues(i){const f=entries.find(x=>x.id===$('np-filament-'+i).value);for(const el of document.querySelectorAll(`[data-material-head="${i}"]`)){const v=f?.material_options?.[el.dataset.materialOption];el.value=v==null?'':Number(Array.isArray(v)?v[0]:v);}}
    const filter=()=>{const m=entries.find(x=>x.id===$('np-machine').value),allowed=x=>!x.compatible_printers.length||x.compatible_printers.includes(m?.name),processes=entries.filter(x=>x.type==='process'&&allowed(x));fill($('np-process'),processes);const standard=processes.find(p=>p.name.includes('0.20')&&p.name.includes('Standard'));if(standard)$('np-process').value=standard.id;processValues();const fs=entries.filter(x=>x.type==='filament'&&(allowed(x)||($('np-variant').checked&&x.compatible_printers.every(n=>n.startsWith('Snapmaker U1 (')))));for(let i=0;i<4;i++){fill($('np-filament-'+i),fs.filter(f=>!preparedHeads[i]||String(f.material).toUpperCase()===preparedHeads[i].material));materialValues(i);}};
    $('np-filaments').innerHTML=[0,1,2,3].map(i=>`<fieldset><legend>T${i}</legend><label>Material preset<select id="np-filament-${i}" required></select></label><details><summary>Temperature, flow & cooling overrides</summary><div class="profile-options">${materialFields.map(([key,label,min,max])=>`<label>${esc(label)}<input type="number" min="${min}" max="${max}" step="any" data-material-head="${i}" data-material-option="${esc(key)}" placeholder="Inherited"></label>`).join('')}</div></details></fieldset>`).join('');
    for(let i=0;i<4;i++)$('np-filament-'+i).onchange=()=>materialValues(i);
    $('np-machine').onchange=filter;$('np-variant').onchange=filter;$('np-process').onchange=processValues;$('np-mode').onchange=coordination;
    async function scan(){const printer=currentPrinter;const [d,tools]=await Promise.all([getJSON('/api/slicer/catalog'),getJSON('/api/tools/assignments')]);if(printer!==currentPrinter)return false;const save=$('np-form').querySelector('.btn.primary');if(!d?.available){$('np-status').textContent=(d?.problem||d?.error||'Enable Auto-print, install an engine and check its path.')+' The settings below are shown for reference; saving a profile needs the engine’s presets.';$('np-form').hidden=false;$('np-form').classList.add('is-preview');if(save){save.disabled=true;save.textContent='Saving needs an installed engine';}editor.setPreset({},'');return false;}$('np-form').classList.remove('is-preview');if(save){save.disabled=false;save.textContent='Save a new profile';}loadedPrinter=printer;preparedHeads=(tools?.heads||[]).slice().sort((a,b)=>a.toolhead.localeCompare(b.toolhead));entries=d.presets;const machines=entries.filter(x=>x.type==='machine');fill($('np-machine'),machines);const nozzles=preparedHeads.map(h=>h.nozzle).sort().join(','),match=machines.find(m=>(m.nozzles||[]).map(Number).sort().join(',')===nozzles);if(match)$('np-machine').value=match.id;filter();$('np-form').hidden=false;$('np-status').textContent='Installed presets loaded. Review the effective values, then save as new.';return true;}
    $('np-scan').onclick=scan;
    editProfile=async id=>{const data=await getJSON('/api/slicer/settings'),profile=data?.profiles?.find(p=>p.id===id);if(!profile){$('np-status').textContent='Choose a saved installed profile first.';return;}if(!profile.preset_selection){$('np-status').textContent='This profile uses exported files. Recreate it from installed presets, or edit those exported files in the engine.';return;}if(!await scan())return;$('np-name').value=(profile.name+' copy').slice(0,60);$('np-machine').value=profile.preset_selection.machine;$('np-variant').checked=!!profile.allow_material_variant;$('np-nozzle-variant').checked=!!profile.allow_nozzle_variant;filter();$('np-process').value=profile.preset_selection.process;processValues();for(let i=0;i<4;i++){$('np-filament-'+i).value=profile.preset_selection.filaments[i];materialValues(i);}editor.setValues(profile.options||{});for(const el of document.querySelectorAll('[data-material-head]')){const override=profile.material_options?.[Number(el.dataset.materialHead)]?.[el.dataset.materialOption];if(override!=null)el.value=override;}$('np-mode').value=profile.layer_mode||'shared';thick={mode:profile.layer_plan?.thick_mode||'fixed',tolerance:profile.layer_plan?.thick_tolerance??80};coordination();$('np-status').textContent='Editing a copy. The previous profile stays available.';};
    $('np-form').onsubmit=async e=>{e.preventDefault();if(loadedPrinter!==currentPrinter){$('np-status').textContent='Printer changed. Reload its tools and presets.';return;}const printer=currentPrinter,options=editor.values();
      const material_options=[0,1,2,3].map(i=>Object.fromEntries([...document.querySelectorAll(`[data-material-head="${i}"]`)].filter(el=>el.value!=='').map(el=>[el.dataset.materialOption,Number(el.value)])));
      const r=await post('/api/slicer/profiles/from-installed',{name:$('np-name').value,machine:$('np-machine').value,process:$('np-process').value,allow_material_variant:$('np-variant').checked,allow_nozzle_variant:$('np-nozzle-variant').checked,filaments:[0,1,2,3].map(i=>$('np-filament-'+i).value),options,material_options,expected_tools:preparedHeads,layer_mode:$('np-mode').value,thick_mode:thick.mode,thick_tolerance:thick.tolerance});if(printer!==currentPrinter)return;const saved=r.body?.profiles?.find(p=>p.id===r.body.default_profile);$('np-status').textContent=r.ok?'Profile saved. '+(saved?.layer_mode==='per_tool'?'Base layer '+saved.layer_plan.grid+' mm. '+saved.layer_plan.heads.map(h=>h.toolhead+' ×'+h.every).join(' · ')+' · '+(saved.layer_plan.thick_mode||'fixed')+' thick regions. Inspect the sliced preview before printing.':'Select it and slice your prepared plate.'):r.body.error;if(r.ok)window.dispatchEvent(new CustomEvent('dv-refresh'));
    };
  }
  mount();profiles();return {load,rows,editProfile:(...args)=>editProfile(...args)};
})();
