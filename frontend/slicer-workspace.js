/* One workspace uses the existing plate editor, tool setup and engine bridge. */
'use strict';
window.DVWorkspace = (() => {
  let active = null;
  const moved = [];
  function relocate(node, target) {
    if (!node) return;
    const anchor = document.createComment('workspace home');
    node.before(anchor); moved.push({node, anchor}); target.append(node);
  }
  function close() {
    if (active) { active.disposed = true; window.removeEventListener('dv-slice-jobs', active.jobs); }
    for (const {node, anchor} of moved.splice(0).reverse()) { anchor.replaceWith(node); }
    active = null;
    $('file-detail').classList.remove('slicer-workspace', 'sw-preview', 'sw-setup', 'sw-gcode');
    $('sw-header').hidden = true; $('sw-objects').hidden = true;
    $('sw-header').replaceChildren(); $('sw-objects').replaceChildren();
    document.querySelectorAll('.sw-inspector,.sw-preview-facts,.sw-setup-host').forEach(n => n.remove());
  }
  function mount(entry, viewer, controls) {
    close();
    const state = active = {entry, viewer, controls, printer:currentPrinter, output:null, job:null, disposed:false, revision:0};
    const panel = $('file-detail'); panel.classList.add('slicer-workspace');
    const head = $('sw-header'); head.hidden = false;
    head.innerHTML = `<div class="sw-flow" role="group" aria-label="Slicing workflow"><button id="sw-prepare" class="sw-step" aria-pressed="true">01 <b>Prepare</b></button><button id="sw-preview" class="sw-step" aria-pressed="false" disabled>02 <b>Preview</b></button><button id="sw-setup" class="sw-step" aria-pressed="false">Profiles & tools</button><button class="sw-mobile sw-step" id="sw-edit-objects">Objects & edit ↓</button><span class="sw-bed">U1 · 270 × 270 × 270 mm</span></div>
      <div class="sw-actionbar"><label>Slice profile<select id="sw-profile"><option value="">Loading profiles…</option></select></label><button class="btn" id="sw-edit-profile">Edit as new</button><button class="btn primary" id="sw-slice">Slice plate</button><button class="btn danger" id="sw-cancel" hidden>Cancel slice</button><p id="sw-job" role="status" aria-live="polite">Choose a profile, then slice your prepared plate.</p></div>`;
    const left = $('sw-objects'); left.hidden = false;
    left.innerHTML = '<div class="sw-panel-title"><h3>Objects</h3><span>Plate 01</span></div><div id="sw-object-actions"></div><div id="sw-object-list"></div><details class="sw-source-info"><summary>Source & import information</summary></details>';
    relocate(controls.querySelector('.plate-heading'), left.querySelector('details'));
    const selectLabel = controls.querySelector('#plate-object').closest('label');
    relocate(selectLabel, $('sw-object-list')); $('plate-object').size = 5;
    relocate($('plate-dimensions'), $('sw-object-list'));
    relocate(controls.querySelector('.plate-toolbar'), $('sw-object-actions'));
    const inspector = document.createElement('div'); inspector.className = 'sw-inspector';
    inspector.innerHTML = '<div class="sw-panel-title"><h3>Object settings</h3><span>mm / degrees</span></div>';
    const side = $('fd-side');
    const source = left.querySelector('details');
    for (const n of [...side.children]) if (n !== controls) relocate(n, source);
    relocate(controls, inspector); side.append(inspector);
    const setup = document.createElement('div'); setup.className = 'sw-setup-host'; setup.hidden = true;
    setup.innerHTML = '<h3>Printer, materials & process</h3><p class="field-hint">Save changes as a new profile. Installed presets stay intact.</p><div id="sw-engine-host"></div><div id="sw-tools-host"></div><div id="sw-process-host"></div>';
    side.append(setup);
    const mode = name => {
      panel.classList.toggle('sw-preview', name === 'preview'); panel.classList.toggle('sw-setup', name === 'setup');
      inspector.hidden = name !== 'prepare'; setup.hidden = name !== 'setup';
      $('plate-object').disabled=name==='preview';
      for (const id of ['prepare','preview','setup']) $('sw-'+id).setAttribute('aria-pressed', String(id === name));
      if (name !== 'preview') {
        $('fd-view-tools').replaceChildren();
        left.querySelector('.gv-display')?.remove();
        document.querySelector('.sw-preview-facts')?.remove();
        DVPlate.active?.redraw();
      }
      side.scrollTop=0;head.scrollIntoView({block:'start'});
      if (name === 'setup') {
        if (!$('sw-tools-host').children.length) {
          relocate($('tool-setup'), $('sw-tools-host'));
          relocate(document.querySelector('.native-profile'), $('sw-process-host'));
          relocate($('ap-status'), $('sw-engine-host')); relocate($('ap-form'), $('sw-engine-host'));
        }
      }
    };
    $('sw-edit-objects').onclick=()=>$('sw-objects').scrollIntoView({block:'start'});
    $('sw-prepare').onclick = () => mode('prepare');
    $('sw-setup').onclick = () => mode('setup');
    $('sw-preview').onclick = () => preview();
    const valid = () => !state.disposed && active === state && state.printer === currentPrinter;
    async function profiles() {
      try {
        const data = await getJSON(api('/api/slicer/settings'));
        if (!valid()) return;
        state.settings = data;
        const select = $('sw-profile'), keep = select.value;
        paint(select, (data?.profiles || []).map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.layer_mode==='per_tool'?' · per-tool heights':''}</option>`).join('') || '<option value="">No saved profiles</option>');
        select.value = (data?.profiles||[]).some(p=>p.id===keep)?keep:data?.default_profile||select.value;
        const setup = data?.module_disabled ? 'Slicing is off.' : data?.problem || (!(data?.profiles?.length) ? 'No slice profile saved yet.' : '');
        $('sw-slice').disabled = !!setup || !DVPlate.active?.canSlice();
        if (setup) {
          // Say why, and offer the way there: the five-step set-up in Files › Slicing.
          $('sw-job').innerHTML = `${esc(setup)} <button class="btn small" type="button" id="sw-setup-link">Set up slicing</button>`;
          $('sw-setup-link').onclick = () => { Sections.choose('files', 'slicing'); $('slice-ready').scrollIntoView({ block: 'start' }); };
        } else if ($('sw-slice').disabled) $('sw-job').textContent = 'Keep every object inside the 270 mm build volume before slicing.';
      } catch (e) { if(valid()) $('sw-job').textContent = e.message; }
    }
    $('sw-edit-profile').onclick = async () => { mode('setup'); await PrintRoom.editProfile($('sw-profile').value); };
    $('sw-slice').onclick = async () => {
      if (!valid()) { $('sw-job').textContent = 'Printer changed. Reopen this plate for the selected printer.'; return; }
      $('sw-slice').disabled = true;
      const revision = state.revision;
      try {
        if(!DVPlate.active?.canSlice())throw new Error('Keep every object inside the 270 mm build volume before slicing.');
        const saved = await DVPlate.active.saveObjects();
        if (!valid() || revision !== state.revision) throw new Error('The plate or printer changed while saving. Slice again with the current settings.');
        const r = await postJSON(api('/api/slicer/slice'), {name:saved.name, profile:$('sw-profile').value});
        if (!valid()) return;
        if (!r.ok) throw new Error(r.body.error || 'Could not start slicing');
        state.job = r.body.id; state.sliceRevision = revision;
        $('sw-job').textContent = r.body.step; $('sw-cancel').hidden = false;
        await Farm.loadAutoPrint();
      } catch (e) { if(valid()) { $('sw-job').textContent=e.message; await profiles(); } }
    };
    $('sw-cancel').onclick = async () => {
      if (!valid() || !state.job) return;
      const r=await postJSON(api('/api/slicer/jobs/'+encodeURIComponent(state.job)+'/cancel'), {});
      if(valid()) $('sw-job').textContent=r.ok?'Stopping the engine…':r.body.error;
    };
    state.jobs = event => {
      if(!valid()) { $('sw-slice').disabled=true; $('sw-job').textContent='Printer changed. Reopen the plate to slice for this printer.'; return; }
      const job=(event.detail||[]).find(j=>j.id===state.job); if(!job) return;
      $('sw-job').textContent=job.error||job.step;
      const running=['waiting','running'].includes(job.status); $('sw-cancel').hidden=!running; $('sw-slice').disabled=running;
      if(!running && job.report?.files?.length) {
        state.output=job.report.files[0]; state.report=job.report;
        $('sw-preview').disabled=state.revision!==state.sliceRevision;
        if(state.revision!==state.sliceRevision) {state.output=null;$('sw-job').textContent+=' · Plate changed since this slice. The output is in the library; slice again for the latest edits.';}
      }
    };
    window.addEventListener('dv-slice-jobs',state.jobs);
    async function preview() {
      if(!valid()||!state.output) return;
      try {
        const r=await fetch('/api/files/analysis?name='+encodeURIComponent(state.output.name));
        const analysis=await r.json(); if(!valid()) return;
        if(!r.ok) throw new Error(analysis.error||'Could not inspect output');
        mode('preview');
        side.querySelector('.sw-preview-facts')?.remove();
        const facts=document.createElement('section'); facts.className='sw-preview-facts';
        const file=state.output;
        facts.innerHTML=`<div class="sw-panel-title"><h3>Slice result</h3><span>${esc(file.preflight)}</span></div><p><b>${esc(file.name)}</b></p><dl><dt>Layers</dt><dd>${esc(file.layers)}</dd><dt>Engine time estimate</dt><dd>${file.estimated_hours==null?'Unknown':esc(Workshop.fmtHours(file.estimated_hours))}</dd><dt>Engine filament estimate</dt><dd>${file.filament_grams==null?'Unknown':esc(file.filament_grams)+' g'}</dd></dl><p class="field-hint">Predictions from the engine. Physical print time and usage vary.</p>${(analysis.preflight?.issues||[]).map(i=>`<p class="ap-warn">${esc(i.message||i.text||i)}</p>`).join('')}<button id="sw-inspect-output" class="btn primary">Open file & Confirm Print</button><div id="sw-movement"></div>`;
        side.append(facts); DVGcode.mount({name:file.name},analysis,viewer,$('sw-movement'));
        if(matchMedia('(min-width:761px)').matches) {
          left.querySelector('.gv-display')?.remove();
          const display=$('fd-view-tools').querySelector('.gv-display');
          if(display)left.append(display);
        }
        $('sw-inspect-output').onclick=()=>Workshop.openFile(file.name);
        if(file.deposition) {
          const evidence=document.createElement('p'); evidence.className='field-hint';
          evidence.textContent='Actual deposition levels: '+file.deposition.tools.map(t=>t.toolhead+' · '+t.deposition_levels+' levels · Z steps '+Object.keys(t.z_steps_mm).join(', ')+' mm').join('; ')+'. '+file.deposition.note;
          facts.append(evidence);
        }
      } catch(e) { if(valid()) $('sw-job').textContent=e.message; }
    }
    state.changed = () => {
      state.revision++;
      if(state.output) { $('sw-preview').disabled=true; state.output=null; $('sw-job').textContent='Plate changed. Slice again to preview these edits.'; }
    };
    $('sw-profile').onchange=state.changed;
    state.refresh=profiles;
    profiles();
    return {changed:state.changed, refreshProfiles:profiles};
  }
  window.addEventListener('dv-refresh',()=>{if(active&&!active.disposed) {
    if(active.printer!==currentPrinter) { $('sw-slice').disabled=true; $('sw-job').textContent='Printer changed. Reopen the plate for this printer.'; }
    else if(!active.job || $('sw-cancel').hidden) active.refresh?.();
  }});
  function previewFile(entry) {
    $('file-detail').classList.add('slicer-workspace','sw-gcode');
    $('sw-header').hidden=false;
    $('sw-header').innerHTML='<div class="sw-flow"><span class="sw-step" aria-current="step">G-code preview</span><span class="sw-bed">File-order layers · requested motion · pre-flight</span></div>';
  }
  return {mount,close,previewFile};
})();
