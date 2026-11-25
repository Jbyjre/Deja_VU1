/* workshop-part4.js: part 4 of 5 of workshop.js, the live connection, fleet, files, automations and Liquid Glass
 * 2.0. Split out of the one closure workshop.js was (18 November 2026) so a session reads only the part it needs.
 * Loaded before workshop.js, after workshop-part3.js; it hands its names on through WorkshopPart4. Holds: applyEdit,
 * applyState, convertFile, deleteFile, forgetLocal, gotoLine, loadFiles, loadLines, loadQueue, openConfirm,
 * openDialog, openDiff, openFile, openGcode, openLocalGcode, openModel, refreshPrinter, refreshSoon, renderColours,
 * renderCompare, renderGcodeSide, renderLocalFiles, selectLine, startNext
 */
'use strict';
const WorkshopPart4 = (() => {
  const { REDUCED, demoNeeded, empty, enc, fmtHours, live, printerName, qs, qsa, renderChip, tintRoom, wsState } = WorkshopPart1;
  const { files, loadHealth, modelTools, preflightList, renderPill, renderTwin, setupAR, updateChamberNow } = WorkshopPart2;
  const { HEAD_COUNT, SPRING, closeFile, conversionReport, lerp, localLines, morph, plateSummary, pulseRefraction,
    renderGate, renderQuickActions, reportView } = WorkshopPart3;

  /* Every fresh printer state lands here - from the WebSocket, the polling
   * fallback, or straight back from a control command. */
function applyState(state, fromCommand = false) {
    if (!state || !state.state) return;
    wsState.printerState = state;
    lastPrinterState = state;
    drawSafely('The status bar', () => renderStatusRibbon(state));
    drawSafely('The live pill', () => renderPill(state));
    drawSafely('The 3D twin', () => renderTwin(state));
    drawSafely('The quick Pause and Cancel bar', () => renderQuickActions(state));
    drawSafely('The chamber reading', () => updateChamberNow(state));
    drawSafely('The printer picker', () => renderChip());
    drawSafely('The room tint', () => tintRoom(state));
    drawSafely('The live readout', () => window.dispatchEvent(new CustomEvent('dv-state', { detail: state })));
    if (fromCommand) refreshSoon();
  }

async function refreshPrinter() {
    const state = await getJSON(api('/api/printer')).catch(() => null);
    if (state && state.state) applyState(state);
  }

function refreshSoon() {
    clearTimeout(wsState.refreshTimer);
    wsState.refreshTimer = setTimeout(() => { loadHealth(); loadQueue(); }, 200);
  }

function renderLocalFiles() {
    const grid = $('file-grid');
    files.list = files.local;
    $('file-recent').innerHTML = '';
    const label = qs('.file-upload');
    if (label && label.firstChild.nodeType === 3) label.firstChild.textContent = 'Open a file ';
    grid.innerHTML = `<p class="log-empty file-local-note">Files open here, in your browser only - nothing is uploaded. Keeping a library,
        the pre-flight check, edits, converting and printing need the Deja Vu1 server.</p>` +
      (files.local.length ? files.local.map(f => `<button class="file-card" type="button" data-open-file="${esc(f.name)}">
          <span class="fcd-thumb"><span class="fcd-kind">${esc(f.kind.toUpperCase())}</span></span>
          <span class="fcd-name">${escName(f.name)}</span>
          <span class="fcd-meta">${f.local.size < 1048576 ? `${Math.max(1, Math.round(f.local.size / 1024))} KB` : `${(f.local.size / 1048576).toFixed(1)} MB`}</span>
          <span class="fcd-tags"><span class="kind-tag">${esc(f.kind.toUpperCase())}</span><span class="origin-tag">on this device</span></span>
        </button>`).join('')
        : empty('No file open', 'Choose a G-code, STL, OBJ or 3MF file from this device to see it in 3D.'));
    qsa('[data-open-file]').forEach(b => b.onclick = () => openFile(b.dataset.openFile, b));
  }

  /* Search and sort for the library (MODELS.3). The sort is remembered on this device. */
  const FILE_SORT_KEY = 'dejavu1.files.sort';
  const fileView = { q: '', sort: (() => { try { return localStorage.getItem(FILE_SORT_KEY) || 'new'; } catch (_) { return 'new'; } })() };
  const tinyModel = s => !!(s && s.size_mm && Math.max(...s.size_mm) > 0 && Math.max(...s.size_mm) < 10);

function shownFiles(list) {
    const q = fileView.q.trim().toLowerCase();
    const out = q ? list.filter(f => {
      const s = f.summary || {}, src = f.source || {};
      return [f.name, f.note, src.designer, src.site, src.title, ...(s.materials || [])].filter(Boolean).join(' ').toLowerCase().includes(q);
    }) : list.slice();
    const used = f => (f.last_opened || '') > (f.last_printed || '') ? f.last_opened || '' : f.last_printed || '';
    const hours = f => (f.summary && f.summary.estimated_hours != null) ? f.summary.estimated_hours : -1;
    if (fileView.sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    else if (fileView.sort === 'used') out.sort((a, b) => used(b).localeCompare(used(a)));
    else if (fileView.sort === 'long') out.sort((a, b) => hours(b) - hours(a));
    return out;
  }

function wireFileTools() {
    const q = $('file-q'), sort = $('file-sort');
    if (!q || q.dataset.wired) return;
    q.dataset.wired = '1';
    sort.value = fileView.sort;
    if (sort.value !== fileView.sort) { fileView.sort = 'new'; sort.value = 'new'; }
    q.addEventListener('input', () => { fileView.q = q.value; renderFileGrid(); });
    sort.addEventListener('change', () => {
      fileView.sort = sort.value;
      try { localStorage.setItem(FILE_SORT_KEY, sort.value); } catch (_) {}
      renderFileGrid();
    });
  }

async function loadFiles() {
    const grid = $('file-grid');
    if (!grid) return;
    const data = await getJSON('/api/files').catch(() => null);
    if (data && data.server_missing) { if ($('file-tools')) $('file-tools').hidden = true; renderLocalFiles(); return; }
    if (isModuleDisabled(data)) { grid.innerHTML = moduleDisabledEmpty('Print file library'); $('file-recent').innerHTML = ''; if ($('file-tools')) $('file-tools').hidden = true; return; }
    files.list = (data && data.files) || [];
    if ($('convert-card')) $('convert-card').hidden = modGate.off.has('converter');
    $('file-recent').innerHTML = data && data.recent && data.recent.length
      ? `<span class="fr-label">Recent</span>${data.recent.map(n => `<button class="chip-btn" data-open-file="${esc(n)}" type="button">${esc(n)}</button>`).join('')}` : '';
    wireFileTools();
    renderFileGrid();
  }

function renderFileGrid() {
    const grid = $('file-grid');
    if (!grid) return;
    if ($('file-tools')) $('file-tools').hidden = files.list.length < 2;
    const shown = shownFiles(files.list);
    grid.innerHTML = files.list.length && !shown.length
      ? `<p class="log-empty">No file matches "${esc(fileView.q.trim())}". Try part of its name, a material such as PETG, or a designer.</p>`
      : files.list.length ? shown.map(f => {
      const s = f.summary || {};
      const verdict = s.preflight ? `<span class="pf-badge ${s.preflight}">${{ clear: 'Pre-flight clear', check: 'Check warnings', blocked: 'Blocked' }[s.preflight]}</span>` : '';
      const meta = f.kind === 'gcode'
        ? `${fmtHours(s.estimated_hours)} · ${s.filament_grams != null ? s.filament_grams.toFixed(1) + ' g' : '—'} · ${(s.tools_used || []).join(' ')}`
        : (s.size_mm ? `${s.size_mm.map(v => v.toFixed(s.size_mm.some(x => x < 10) ? 1 : 0)).join(' × ')} mm · ${s.plates > 1 ? `${s.plates} plates` : `${(s.triangles || 0).toLocaleString()} triangles`}` : (s.error || ''));
      const tiny = f.kind !== 'gcode' && tinyModel(s) ? '<span class="pf-badge check">May be in inches</span>' : '';
      return `<button class="file-card" type="button" data-open-file="${esc(f.name)}">
          <span class="fcd-thumb">${s.has_thumbnail ? `<img loading="lazy" alt="" onload="this.classList.toggle('is-tiny', this.naturalWidth <= 64)" src="${tourOn() ? `demo/thumbs/${enc(f.name)}.png` : `/api/files/thumb?name=${enc(f.name)}&v=${enc(f.modified_at || '')}`}">` : `<span class="fcd-kind">${esc(f.kind.toUpperCase())}</span>`}</span>
          <span class="fcd-name">${escName(f.name)}</span>
          <span class="fcd-meta">${esc(meta)}</span>
          <span class="fcd-tags"><span class="kind-tag">${esc(f.kind.toUpperCase())}</span>${verdict}${tiny}${f.origin && f.origin !== 'upload' ? `<span class="origin-tag">${esc({ converted: 'U1 copy', colours: 'U1 colours', prepared: 'prepared plate', download: 'from the web' }[f.origin] || f.origin)}</span>` : ''}</span>
        </button>`;
    }).join('') : `<button type="button" class="file-empty" id="file-empty">
        <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" focusable="false"><path d="M12 16V5m0 0-4 4m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <b>Drop files here</b>
        <span>G-code to print, or STL, OBJ and 3MF models. Press to choose them from this computer, or add the sample files above.</span></button>`;
    const pick = $('file-empty');
    if (pick) pick.onclick = () => $('file-upload').click();
    qsa('[data-open-file]').forEach(b => b.onclick = () => openFile(b.dataset.openFile, b.classList.contains('file-card') ? b : null));
  }

async function openFile(name, fromEl) {
    let entry = files.list.find(f => f.name === name);
    if (!entry) { await loadFiles(); entry = files.list.find(f => f.name === name); }      // made elsewhere (studio, slicer)
    if (!entry) return;
    files.open = entry;
    files.lines = { offset: 0, q: '' };
    files.selectedLine = null;
    if (!entry.local) postJSON('/api/files/opened', { name });
    const panel = $('file-detail');
    const reveal = (instant) => {
      panel.hidden = false;
      panel.scrollIntoView({ behavior: instant || REDUCED.matches ? 'auto' : 'smooth', block: 'start' });
    };
    // Scroll first (instantly), then let the glass morph into the panel's
    // final on-screen position.
    if (fromEl) morph(fromEl, () => panel, () => reveal(true)); else reveal(false);
    $('fd-name').textContent = name;
    let recallHost = $('fd-recall');
    if (!recallHost) {
      recallHost = document.createElement('div');
      recallHost.id = 'fd-recall';
      recallHost.hidden = true;
      $('fd-sub').after(recallHost);
    }
    recallHost.dataset.file = name;
    if (window.Recall && !entry.local) Recall.intoFiles(recallHost, name);   // printed before: how it went
    else recallHost.hidden = true;
    const s = entry.summary || {};
    $('fd-sub').textContent = entry.note || ({ sample: 'Sample file', converted: 'Converted for the Snapmaker U1', edited: 'Edited here', upload: 'Uploaded', download: 'Brought in from the web' }[entry.origin] || '');
    // Where a model came from (models.js), so its designer is always credited.
    const credit = $('fd-source');
    if (credit) { credit.innerHTML = entry.source && window.Models ? Models.sourceHtml(entry.source) : ''; credit.hidden = !credit.innerHTML; }
    if (entry.kind !== 'gcode' && tinyModel(s)) {
      const across = Math.max(...s.size_mm).toFixed(1);
      const warn = `It's only ${across} mm across, so it may have been drawn in inches. Open it in the Slicer and press Scale × 25.4 on its warning.`;
      $('fd-sub').textContent = $('fd-sub').textContent ? `${$('fd-sub').textContent}. ${warn}` : warn;
    }
    $('fd-side').innerHTML = '<p class="log-empty">Reading the file…</p>';
    $('fd-gcode').hidden = entry.kind !== 'gcode';
    $('fd-view-tools').innerHTML = '';
    if (files.viewer) { files.viewer.dispose(); files.viewer = null; }
    // A fresh canvas for every file: a disposed viewer releases its WebGL
    // context, and a canvas can't get a new one after that.
    const oldCanvas = $('fd-canvas');
    const canvas = oldCanvas.cloneNode(false);
    oldCanvas.replaceWith(canvas);
    let viewer = null;
    try { viewer = new DV3D.Viewer(canvas); files.viewer = viewer; }
    catch (err) { $('fd-view-tools').innerHTML = `<p class="log-empty">3D view unavailable in this browser: ${esc(err.message || 'WebGL could not start')}</p>`; }
    reportView();
    if (entry.kind === 'gcode') await openGcode(entry, viewer);
    else await openModel(entry, viewer);
  }

  /* A G-code file from this device: the toolpath and a few plain facts,
   * read in the browser. No verdict - that's the server's pre-flight. */
async function openLocalGcode(entry, viewer) {
    let a;
    try {
      const text = await entry.local.text();
      entry.localLines = text.split(/\r?\n/);
      a = DV3D.parseGcode(text);
    } catch (err) {
      $('fd-side').innerHTML = `<p class="log-empty">Couldn't read this file: ${esc(err.message || err)}</p>`;
      return;
    }
    if (files.open !== entry) return;
    if (viewer && a.toolpath.segments.length) {
      const { zmax } = viewer.setToolpath(a.toolpath.segments, a.colours);
      $('fd-view-tools').innerHTML = `
        <label class="vt-layer">Up to <span id="vt-z">${zmax.toFixed(2)}</span> mm
          <input type="range" id="vt-range" min="0" max="${zmax}" step="0.01" value="${zmax}" aria-label="Show layers up to this height">
        </label>
        <label class="vt-travel"><input type="checkbox" id="vt-travel"> Show travel moves</label>
        ${a.toolpath.downsampled ? `<span class="vt-note">Showing ${a.toolpath.segments.length.toLocaleString()} of ${a.toolpath.total_segments.toLocaleString()} moves</span>` : ''}`;
      $('vt-range').addEventListener('input', (e) => { viewer.setLayerLimit(+e.target.value); $('vt-z').textContent = (+e.target.value).toFixed(2); });
      $('vt-travel').addEventListener('change', (e) => { viewer.showTravel = e.target.checked; viewer.draw(); });
    }
    $('fd-side').innerHTML = `
      <div class="fd-facts divider-row cols-2">
        <div><span class="stat-key">Lines</span><b>${a.lines.toLocaleString()}</b><small>in the file</small></div>
        <div><span class="stat-key">Layers</span><b>${a.layers || '—'}</b><small>heights that print plastic</small></div>
        <div><span class="stat-key">Toolheads</span><b>${a.tools_used.join(' ') || '—'}</b><small>that extrude</small></div>
        <div><span class="stat-key">Footprint</span><b>${a.footprint_mm ? a.footprint_mm.join(' × ') : '—'}</b><small>${a.footprint_mm ? 'mm' : 'no extrusion found'}</small></div>
      </div>
      <p class="log-empty">Read in this browser - the file isn't uploaded. The pre-flight check, time and filament estimates,
        edits and printing need the Deja Vu1 server.</p>
      <div class="fd-actions"><button class="btn" id="fd-forget" type="button">Close and forget</button></div>`;
    $('fd-forget').addEventListener('click', () => forgetLocal(entry.name));
    window.DVGcode?.mount(entry,a,viewer);
    loadLines();
  }

function forgetLocal(name) {
    files.local = files.local.filter(f => f.name !== name);
    closeFile();
    renderLocalFiles();
  }

async function openGcode(entry, viewer) {
    if (entry.local) { await openLocalGcode(entry, viewer); return; }
    const res = await fetch(`/api/files/analysis?name=${enc(entry.name)}`);
    const a = await res.json();
    if (!res.ok) { $('fd-side').innerHTML = `<p class="log-empty">${esc(a.error || 'Could not read the file')}</p>`; return; }
    files.analysis = a;
    if (viewer && a.toolpath) {
      const { zmax } = viewer.setToolpath(a.toolpath.segments, a.meta.filament_colours);
      $('fd-view-tools').innerHTML = `
        <label class="vt-layer">Up to <span id="vt-z">${zmax.toFixed(2)}</span> mm
          <input type="range" id="vt-range" min="0" max="${zmax}" step="0.01" value="${zmax}" aria-label="Show layers up to this height">
        </label>
        <label class="vt-travel"><input type="checkbox" id="vt-travel"> Show travel moves</label>
        ${a.toolpath.downsampled ? `<span class="vt-note">Showing ${a.toolpath.segments.length.toLocaleString()} of ${a.toolpath.total_segments.toLocaleString()} moves</span>` : ''}`;
      $('vt-range').addEventListener('input', (e) => { viewer.setLayerLimit(+e.target.value); $('vt-z').textContent = (+e.target.value).toFixed(2); });
      $('vt-travel').addEventListener('change', (e) => { viewer.showTravel = e.target.checked; viewer.draw(); });
    }
    renderGcodeSide(entry, a);
    window.DVGcode?.mount(entry,a,viewer);
    loadLines();
  }

function renderGcodeSide(entry, a) {
    const verdictText = { clear: 'Pre-flight clear', check: 'Pre-flight: check the warnings', blocked: 'Pre-flight: blocked' }[a.preflight.verdict];
    $('fd-side').innerHTML = `
      <div class="fd-facts divider-row cols-2">
        <div><span class="stat-key">Time</span><b>${fmtHours(a.estimated_hours)}</b><small>${esc(a.estimated_hours_source)}</small></div>
        <div><span class="stat-key">Filament</span><b>${a.filament_grams.toFixed(1)} g</b><small>${esc(a.filament_grams_source)}</small></div>
        <div><span class="stat-key">Layers</span><b>${a.layers}</b><small>${a.footprint_mm ? a.footprint_mm.join(' × ') + ' mm footprint' : ''}</small></div>
        <div><span class="stat-key">Toolheads</span><b>${esc(a.tools_used.join(' ')) || '—'}</b><small>${esc((a.meta.filament_types || []).join(', '))}</small></div>
      </div>
      <h3 class="fd-h pf-head ${a.preflight.verdict}">${verdictText}</h3>
      ${preflightList(a.preflight)}
      <div class="fd-actions">
        <button class="btn primary" id="fd-print" type="button">Print…</button>
        <button class="btn" id="fd-queue" type="button">Add to queue</button>
        <a class="btn" href="/api/files/raw?name=${enc(entry.name)}&download=1">Download</a>
        ${entry.has_original ? '<button class="btn" id="fd-restore" type="button">Restore original</button>' : ''}
        <button class="btn danger" id="fd-delete" type="button">Delete</button>
      </div>
      <div id="fd-compare-host"></div>`;
    $('fd-print').addEventListener('click', (e) => openConfirm(entry.name, e.currentTarget));
    $('fd-queue').addEventListener('click', async (e) => {
      if (!liveData()) { toast('No printer connected. Turn on demo data to queue on a simulated printer', 'warn'); return; }
      const r = await runCommand(e.currentTarget, '/api/queue/add', { filename: entry.name },
        { sending: 'Adding…', done: `Added ${entry.name} to the queue`, failed: 'Could not queue it' });
      if (r.ok) loadQueue();
    });
    $('fd-delete').addEventListener('click', () => deleteFile(entry.name));
    if ($('fd-restore')) $('fd-restore').addEventListener('click', async () => {
      const r = await postJSON('/api/files/restore', { name: entry.name });
      toast(r.ok ? 'Original restored' : `Couldn't restore: ${r.body.error}`, r.ok ? 'ok' : 'bad');
      await loadFiles(); openFile(entry.name);
    });
    renderCompare(entry);
    qsa('[data-goto-line]', $('fd-side')).forEach(b => b.addEventListener('click', () => gotoLine(+b.dataset.gotoLine)));
  }

  /* "Compare settings with…" - rebuilt whenever the library changes, so a
   * file converted a moment ago is already in the list. */
function renderCompare(entry) {
    const host = $('fd-compare-host');
    if (!host) return;
    const others = files.list.filter(f => f.kind === entry.kind && f.name !== entry.name);
    host.innerHTML = others.length ? `<div class="inline-form fd-compare">
        <label class="sr-only" for="fd-compare-with">Compare settings with</label>
        <select id="fd-compare-with">${others.map(o => `<option>${esc(o.name)}</option>`).join('')}</select>
        <button class="btn" id="fd-compare" type="button">Compare settings</button></div>` : '';
    if (others.length) $('fd-compare').addEventListener('click', () => openDiff(entry.name, $('fd-compare-with').value));
  }

async function deleteFile(name) {
    if (!window.confirm(`Delete ${name} from the library?`)) return;
    const r = await postJSON('/api/files/delete', { name });
    toast(r.ok ? `Deleted ${name}` : `Couldn't delete: ${r.body.error}`, r.ok ? 'ok' : 'bad');
    closeFile();
    loadFiles();
  }

async function openModel(entry, viewer) {
    const side = $('fd-side');
    try {
      if(entry.kind==='3mf'&&!entry.local){
        const selection=await getJSON('/api/files/plates?name='+enc(entry.name));
        if(files.open!==entry)return;
        if(selection?.count>1){
          side.innerHTML=`<h3>Choose a plate</h3><p class="field-hint">This project contains ${selection.count} plates. Prepare and slice each separately; the original stays intact.</p><label>Plate<select id="fd-choose-plate">${selection.plates.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.objects)} objects</option>`).join('')}</select></label><button class="btn primary" id="fd-extract-plate">Open selected plate as new</button><p id="fd-plate-status" role="status"></p>`;
          $('fd-view-tools').textContent='Select one plate to load its models.';
          $('fd-extract-plate').onclick=async e=>{e.currentTarget.disabled=true;try{if(typeof tourOn==='function'&&tourOn())throw new Error('Saving a selected plate needs the local Deja Vu1 app. The public demo is a recording.');const r=await postJSON('/api/files/plates/extract',{name:entry.name,plate:$('fd-choose-plate').value});if(files.open!==entry)return;if(!r.ok)throw new Error(r.body.error);await loadFiles();await openFile(r.body.name);}catch(err){if(files.open===entry){$('fd-plate-status').textContent=err.message;e.currentTarget.disabled=false;}}};
          return;
        }
      }
      let buffer;
      if (entry.local) buffer = await entry.local.arrayBuffer();
      else {
        const res = await fetch(`/api/files/raw?name=${enc(entry.name)}`);
        if (!res.ok) throw new Error((await res.json()).error || res.status);
        buffer = await res.arrayBuffer();
      }
      const started = performance.now();
      const mesh = await DV3D.parseModel(buffer, entry.name);
      if (files.open !== entry) return;
      const ms = Math.round(performance.now() - started);
      if (viewer) viewer.setMesh(mesh, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
      const is3mf = entry.kind === '3mf';
      // A project already set up for a Snapmaker printer (one this
      // dashboard converted, or saved by Snapmaker Orca) has nothing to
      // convert; the server refuses it, so the button isn't offered.
      const alreadyU1 = ['converted', 'studio'].includes(entry.origin) || /^snapmaker/i.test(mesh.application || '');
      side.innerHTML = `
        <div class="fd-facts divider-row cols-2">
          <div><span class="stat-key">Size</span><b>${mesh.size.map(v => v.toFixed(1)).join(' × ')}</b><small>mm (X × Y × Z)</small></div>
          <div><span class="stat-key">Triangles</span><b>${mesh.triangles.toLocaleString()}</b><small>read in ${ms} ms</small></div>
          <div><span class="stat-key">Objects</span><b>${mesh.objects}</b><small>${esc(mesh.application || (is3mf ? 'No application named' : 'STL'))}</small></div>
          <div><span class="stat-key">Fits the U1?</span><b>${mesh.size[0] <= 270 && mesh.size[1] <= 270 && mesh.size[2] <= 270 ? 'Yes' : 'No'}</b><small>270 × 270 × 270 mm</small></div>
        </div>
        <p class="log-empty">Open it in the Slicer to arrange it on the plate, slice it and print it.</p>
        ${entry.local ? `<p class="log-empty">Read in this browser - the file isn't uploaded. Converting for the U1 and
          slicing need the Deja Vu1 server.</p>
        <div class="fd-actions"><span id="fd-ar-slot" class="fd-ar-slot"></span>
          <button class="btn" id="fd-forget" type="button">Close and forget</button></div>
        <p class="log-empty fd-ar-note" id="fd-ar-note" hidden></p>` : `
        <div class="fd-actions">
          ${is3mf && !alreadyU1 && !modGate.off.has('converter') ? '<button class="btn primary" id="fd-convert" type="button">Convert for Snapmaker U1</button>' : ''}
          ${is3mf && alreadyU1 ? '<span class="fd-u1-ready">Set up for the Snapmaker U1 - open it in Snapmaker Orca</span>' : ''}
          <span id="fd-slice-slot" class="fd-slice-slot"></span>
          <span id="fd-ar-slot" class="fd-ar-slot"></span>
          <a class="btn" href="/api/files/raw?name=${enc(entry.name)}&download=1">Download</a>
          <button class="btn danger" id="fd-delete" type="button">Delete</button>
        </div>
        <p class="log-empty fd-ar-note" id="fd-ar-note" hidden></p>
        <div id="fd-colours-host"></div>
        <div id="fd-compare-host"></div>
        <div id="fd-convert-report"></div>`}`;
      await modelTools(entry, mesh, viewer, side);
      if (entry.local) {
        $('fd-forget').addEventListener('click', () => forgetLocal(entry.name));
        setupAR(entry, mesh);
        return;
      }
      $('fd-delete').addEventListener('click', () => deleteFile(entry.name));
      if ($('fd-convert')) $('fd-convert').addEventListener('click', (e) => convertFile(entry.name, e.currentTarget));
      if (is3mf && !modGate.off.has('converter')) renderColours(entry);
      renderCompare(entry);
      setupAR(entry, mesh);
      window.dispatchEvent(new CustomEvent('dv-model-open', { detail: entry }));
    } catch (err) {
      side.innerHTML = `<p class="log-empty">Couldn't read this model: ${esc(err.message)}</p>`;
    }
  }
async function renderColours(entry) {
    const host = $('fd-colours-host');
    if (!host) return;
    files.colourPlan = null;
    const data = await getJSON(api(`/api/colours/plan?name=${enc(entry.name)}`)).catch(() => null);
    if (files.open !== entry || !data || !Array.isArray(data.filaments)) return;
    const fil = data.filaments, used = fil.filter(f => f.used);
    // A single-colour project with nothing to decide gets no panel.
    if (fil.length <= 1 && used.length <= 1) return;
    let plan = (data.suggested || []).slice();
    files.colourPlan = fil.length > HEAD_COUNT ? plan : null;
    const swatch = (c, label) => `<span class="cm-swatch${c ? '' : ' is-empty'}" style="--sw:${esc(c || 'transparent')}" aria-hidden="true"></span><span class="sr-only">${esc(label || '')}</span>`;
    const headsOf = () => {
      const heads = [];
      for (let h = 0; h < HEAD_COUNT; h++) {
        const members = fil.filter((f, i) => plan[i] === h);
        const lead = members.slice().sort((a, b) => (b.used - a.used) || (b.painted - a.painted) || (a.n - b.n))[0];
        heads.push({ h, members, lead });
      }
      return heads;
    };
    const draw = () => {
      const heads = headsOf();
      const mixed = heads.filter(x => new Set(x.members.map(f => (f.type || 'PLA').split(/[\s+-]/)[0])).size > 1);
      const missing = fil.filter((f, i) => f.used && plan[i] == null);
      host.innerHTML = `
        <section class="cm" aria-labelledby="cm-title">
          <div class="cm-head">
            <h3 class="fd-h" id="cm-title">Colours on the U1's heads</h3>
            <p class="cm-sub">${esc(data.source_label)} · ${fil.length} filament${fil.length === 1 ? '' : 's'} listed, ${used.length} used by the model</p>
          </div>
          <ol class="cm-heads" aria-label="What each head prints">
            ${heads.map(x => `<li class="cm-headcard${x.lead ? '' : ' is-idle'}">
              <span class="cm-dot" style="--sw:${esc((x.lead && x.lead.colour) || 'transparent')}"></span>
              <span class="cm-hname">Head ${x.h + 1}</span>
              <span class="cm-hwhat">${x.lead ? `${esc(x.lead.name)}${x.lead.type ? ` · ${esc(x.lead.type)}` : ''}` : 'Not used'}</span>
              ${x.members.length > 1 ? `<span class="cm-hfrom">filaments ${x.members.map(f => f.n).join(' + ')}</span>` : ''}
              ${data.loaded && data.loaded[x.h] && data.loaded[x.h].colour ? `<span class="cm-loaded" title="Loaded in the printer now">${swatch(data.loaded[x.h].colour, 'Loaded now')} loaded</span>` : ''}
            </li>`).join('')}
          </ol>
          <div class="cm-rows" role="list">
            ${fil.map((f, i) => `<div class="cm-row${f.used ? '' : ' is-unused'}" role="listitem">
              ${swatch(f.colour, f.name)}
              <span class="cm-fname"><b>Filament ${f.n}</b> ${esc(f.name)}${f.type ? ` · ${esc(f.type)}` : ''}
                <small>${f.used ? (f.painted ? `painted on ${f.painted.toLocaleString()} triangle${f.painted === 1 ? '' : 's'}` : 'used by an object') : 'not used by the model'}</small></span>
              <label class="sr-only" for="cm-sel-${i}">Head for filament ${f.n}</label>
              <select id="cm-sel-${i}" data-i="${i}">
                <option value="">${f.used ? 'Choose a head' : 'Leave out'}</option>
                ${Array.from({ length: HEAD_COUNT }, (_, h) => `<option value="${h}"${plan[i] === h ? ' selected' : ''}>Head ${h + 1}</option>`).join('')}
              </select>
            </div>`).join('')}
          </div>
          ${mixed.length ? `<p class="cm-warn" role="alert">Head ${mixed.map(x => x.h + 1).join(' and ')} would get different materials, which print at different temperatures. Choose another head for one of them.</p>` : ''}
          ${missing.length ? `<p class="cm-warn" role="alert">Filament ${missing.map(f => f.n).join(', ')} is used by the model and needs a head.</p>` : ''}
          ${data.format === 'prusa' ? '<p class="log-empty">Snapmaker Orca opens PrusaSlicer projects with its own filament colours: load the colours above in those heads, or slice it here in Deja Vu1.</p>' : ''}
          ${data.unreadable_paint ? `<p class="log-empty">${data.unreadable_paint} painted triangles couldn't be read and stay as they are.</p>` : ''}
          <div class="cm-actions">
            <button class="btn small" type="button" data-cm="suggest">Group alike colours</button>
            ${data.matched ? '<button class="btn small" type="button" data-cm="match">Match the printer\'s heads</button>' : ''}
            <button class="btn small primary" type="button" data-cm="save"${missing.length ? ' disabled' : ''}>Save a copy with these heads</button>
          </div>
          <p class="cm-status" role="status" aria-live="polite"></p>
        </section>`;
      qsa('select[data-i]', host).forEach(sel => sel.addEventListener('change', () => {
        plan[+sel.dataset.i] = sel.value === '' ? null : +sel.value;
        files.colourPlan = plan.slice();
        draw();
        const again = $(sel.id);
        if (again) again.focus();
      }));
      qsa('[data-cm]', host).forEach(b => b.addEventListener('click', () => onAction(b)));
    };
    const onAction = async b => {
      if (b.dataset.cm === 'suggest' || b.dataset.cm === 'match') {
        plan = ((b.dataset.cm === 'match' ? data.matched : data.suggested) || []).slice();
        files.colourPlan = plan.slice();
        draw();
        toast(b.dataset.cm === 'match' ? 'Each colour now goes to the closest loaded head' : 'Alike colours now share a head', 'ok');
        return;
      }
      if (typeof tourOn === 'function' && tourOn()) { toast('Saving a copy needs the local Deja Vu1 app. The public demo is a recording.', 'warn'); return; }
      b.disabled = true;
      const r = await postJSON('/api/colours/apply', { name: entry.name, plan });
      b.disabled = false;
      const status = qs('.cm-status', host);
      if (!r.ok) {
        if (status) status.textContent = (r.body && r.body.error) || 'The copy could not be saved';
        toast('Colours not saved', 'warn');
        return;
      }
      if (status) status.innerHTML = `Saved as <button class="chip-btn" type="button" data-open-file="${esc(r.body.file.name)}">${esc(r.body.file.name)}</button>. ${esc(r.body.report.summary)}.`;
      toast(`Saved ${r.body.file.name}`, 'ok', 4200, { action: { label: 'Open', run: () => openFile(r.body.file.name) } });
      await loadFiles();
      qsa('[data-open-file]', host).forEach(x => x.onclick = () => openFile(x.dataset.openFile));
    };
    draw();
  }

async function convertFile(name, button, target) {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Converting…';
    const plan = files.open && files.open.name === name ? files.colourPlan : null;
    const r = await postJSON('/api/convert', plan ? { name, plan } : { name });
    button.disabled = false;
    button.textContent = label;
    const host = target || $('fd-convert-report');
    const copyBtn = '<button class="btn small" type="button" data-copy-report>Copy report</button>';
    if (!r.ok) {
      const b = r.body || {};
      host.innerHTML = `
        <div class="convert-fail" role="alert">
          <p class="convert-fail-head">${b.code ? `<b class="convert-code">${esc(b.code)}</b>` : ''}${b.stage ? `<span>${esc(b.stage)}</span>` : ''}</p>
          <p>${esc(b.error || 'Conversion failed')}</p>
          ${b.action ? `<p class="convert-action"><b>Try:</b> ${esc(b.action)}</p>` : ''}
          <div class="convert-actions">${copyBtn}<span class="log-empty">Paste it into a bug report - it has everything needed to look into it.</span></div>
        </div>`;
      toast('Conversion not possible', 'warn');
    } else {
      const rep = r.body.report;
      host.innerHTML = `
        <div class="convert-report">
          <h3 class="fd-h">Converted from ${esc(rep.source_label)}</h3>
          <p>Saved as <button class="chip-btn" data-open-file="${esc(r.body.file.name)}" type="button">${esc(r.body.file.name)}</button>. Printer <b>${esc(rep.printer_profile)}</b>, print profile <b>${esc(rep.print_profile)}</b>, filaments ${rep.filament_profiles.map(esc).join(', ')}.</p>
          ${plateSummary(rep.plates)}
          ${rep.kept.length ? `<p>Kept the creator's own changes: ${rep.kept.map(k => `<code>${esc(k)}</code>`).join(' ')}</p>` : ''}
          ${rep.warnings.length ? `<ul class="pf-list">${rep.warnings.map(w => `<li class="pf-warning">${esc(w)}</li>`).join('')}</ul>` : ''}
          <p class="log-empty">${esc(rep.unverified)}</p>
          <div class="convert-actions">${copyBtn}</div>
        </div>`;
      toast(`Converted. Saved as ${r.body.file.name}`, 'ok');
      await loadFiles();
      if (files.open) renderCompare(files.open);
      qsa('[data-open-file]', host).forEach(b => b.onclick = () => openFile(b.dataset.openFile));
    }
    const text = conversionReport(name, r);
    qsa('[data-copy-report]', host).forEach(b => b.addEventListener('click', async () => {
      const ok = await copyText(text);
      toast(ok ? 'Report copied' : "This browser wouldn't copy it - select the text and copy by hand", ok ? 'ok' : 'warn');
      if (!ok) host.insertAdjacentHTML('beforeend', `<textarea class="convert-report-text" readonly rows="8">${esc(text)}</textarea>`);
    }));
  }

  /* G-code lines: a window of 200 at a time, searchable, with small edits. */
async function loadLines() {
    const host = $('fd-gcode');
    if (!files.open || files.open.kind !== 'gcode') return;
    const { offset, q } = files.lines;
    const data = files.open.local ? localLines(files.open, offset, q)
      : await getJSON(`/api/files/lines?name=${enc(files.open.name)}&offset=${offset}&limit=200${q ? `&q=${enc(q)}` : ''}`);
    if (!data.lines) { host.innerHTML = `<p class="log-empty">${esc(data.error || "Couldn't read the lines")}</p>`; delete host.dataset.built; return; }
    if (!host.dataset.built) {
      host.dataset.built = '1';
      host.innerHTML = `
        <div class="gc-head">
          <h3 class="fd-h">G-code</h3>
          <form class="inline-form" id="gc-search"><label class="sr-only" for="gc-q">Search the file</label>
            <input type="search" id="gc-q" placeholder="Search (M104, T1, PRINT_START…)"><button class="btn small" type="submit">Find</button></form>
          <div class="gc-nav"><button class="btn small" id="gc-prev" type="button">‹ Earlier</button><span id="gc-pos"></span><button class="btn small" id="gc-next" type="button">Later ›</button></div>
        </div>
        <div class="gc-lines" id="gc-lines" role="listbox" aria-label="G-code lines. Choose one to edit it."></div>
        <div class="gc-edit" id="gc-edit" hidden></div>`;
      $('gc-search').addEventListener('submit', (e) => { e.preventDefault(); files.lines = { offset: 0, q: $('gc-q').value.trim() }; loadLines(); });
      $('gc-prev').addEventListener('click', () => { files.lines.offset = Math.max(0, files.lines.offset - 200); loadLines(); });
      $('gc-next').addEventListener('click', () => { files.lines.offset += 200; loadLines(); });
    }
    $('gc-pos').textContent = data.matches != null ? `${data.matches} matching lines` : `Lines ${offset + 1}–${Math.min(data.total, offset + 200)} of ${data.total.toLocaleString()}`;
    $('gc-prev').disabled = !!q || offset === 0;
    $('gc-next').disabled = !!q || offset + 200 >= data.total;
    $('gc-lines').innerHTML = data.lines.map(l => `
      <button class="gc-line ${l.text.trim().startsWith(';') ? 'is-comment' : ''} ${files.selectedLine === l.n ? 'is-selected' : ''}" role="option"
              aria-selected="${files.selectedLine === l.n}" type="button" data-line="${l.n}"><span class="gc-n">${l.n}</span><span class="gc-t">${esc(l.text) || '&nbsp;'}</span></button>`).join('');
    qsa('.gc-line', host).forEach(b => b.addEventListener('click', () => selectLine(+b.dataset.line, b.querySelector('.gc-t').textContent)));
  }

function gotoLine(n) {
    files.lines = { offset: Math.max(0, n - 20), q: '' };
    files.selectedLine = n;
    $('fd-gcode').scrollIntoView({ behavior: REDUCED.matches ? 'auto' : 'smooth', block: 'start' });
    loadLines().then(() => {
      const el = qs(`.gc-line[data-line="${n}"]`);
      if (el) { el.scrollIntoView({ block: 'center' }); selectLine(n, el.querySelector('.gc-t').textContent); }
    });
  }

function selectLine(n, text) {
    files.selectedLine = n;
    qsa('.gc-line').forEach(b => { const on = +b.dataset.line === n; b.classList.toggle('is-selected', on); b.setAttribute('aria-selected', on); });
    const code = text.split(';')[0].trim();
    const params = (code.split(/\s+/).slice(1).map(w => w[0]).filter(c => /[A-Z]/i.test(c))) || [];
    const editable = /^[GM]\d+/i.test(code) && params.length;
    const box = $('gc-edit');
    box.hidden = false;
    if (files.open && files.open.local) {
      box.innerHTML = `<div class="gc-edit-title">Line ${n}: <code>${esc(text.trim() || '(blank)')}</code></div>
        <p class="log-empty">Editing a line (checked first, original kept) needs the Deja Vu1 server - this file is only being viewed here.</p>`;
      return;
    }
    box.innerHTML = `
      <div class="gc-edit-title">Line ${n}: <code>${esc(text.trim() || '(blank)')}</code></div>
      <div class="gc-edit-row">
        ${editable ? `<form class="inline-form" id="gc-set">
          <label class="sr-only" for="gc-param">Value to change</label>
          <select id="gc-param">${[...new Set(params)].map(p => `<option>${esc(p.toUpperCase())}</option>`).join('')}</select>
          <label class="sr-only" for="gc-value">New value</label>
          <input type="number" id="gc-value" step="any" required placeholder="new value">
          <button class="btn small primary" type="submit">Change value</button></form>` : ''}
        ${code ? '<button class="btn small" id="gc-comment" type="button">Comment out</button>' : ''}
        <form class="inline-form" id="gc-insert">
          <label class="sr-only" for="gc-cmd">Command to insert after this line</label>
          <input type="text" id="gc-cmd" required placeholder="Insert after, e.g. M106 S128">
          <button class="btn small" type="submit">Insert</button></form>
      </div>
      <p class="gc-edit-msg" id="gc-edit-msg" role="status"></p>`;
    if ($('gc-set')) $('gc-set').addEventListener('submit', (e) => { e.preventDefault(); applyEdit({ kind: 'set_value', line: n, param: $('gc-param').value, value: $('gc-value').value }); });
    if ($('gc-comment')) $('gc-comment').addEventListener('click', () => applyEdit({ kind: 'comment_out', line: n }));
    $('gc-insert').addEventListener('submit', (e) => { e.preventDefault(); applyEdit({ kind: 'insert', after_line: n, command: $('gc-cmd').value }); });
  }

async function applyEdit(edit) {
    const msg = $('gc-edit-msg');
    msg.className = 'gc-edit-msg';
    msg.textContent = 'Checking the edit…';
    const r = await postJSON('/api/files/edit', { name: files.open.name, edits: [edit] });
    if (!r.ok) { msg.classList.add('is-bad'); msg.textContent = `Not applied: ${r.body.error}`; return; }
    const v = r.body.preflight.verdict;
    msg.classList.add(v === 'blocked' ? 'is-bad' : 'is-ok');
    msg.textContent = `Saved (the original is kept). Pre-flight after the edit: ${{ clear: 'clear', check: 'warnings to check', blocked: 'blocked' }[v]}.`;
    toast('Edit saved. Original kept, pre-flight re-checked', 'ok');
    await loadFiles();
    const name = files.open.name, line = files.selectedLine;
    files.open = files.list.find(f => f.name === name);
    const a = await (await fetch(`/api/files/analysis?name=${enc(name)}`)).json();
    files.analysis = a;
    if (files.viewer && a.toolpath) files.viewer.setToolpath(a.toolpath.segments, a.meta.filament_colours);
    renderGcodeSide(files.open, a);
    await loadLines();
    if (line) {
      const el = qs(`.gc-line[data-line="${line}"]`);
      if (el) selectLine(line, el.querySelector('.gc-t').textContent);
      $('gc-edit-msg').className = msg.className;
      $('gc-edit-msg').textContent = msg.textContent;
    }
  }

async function openDiff(a, b) {
    const dialog = $('diff-dialog');
    $('diff-sub').textContent = `${a}  ↔  ${b}`;
    $('diff-body').innerHTML = '<p class="log-empty">Comparing…</p>';
    openDialog(dialog);
    const res = await fetch(`/api/profiles/diff?a=${enc(a)}&b=${enc(b)}`);
    const d = await res.json();
    if (!res.ok) { $('diff-body').innerHTML = `<p class="log-empty">${esc(d.error)}</p>`; return; }
    const label = { changed: 'Changed', only_a: 'Only in first', only_b: 'Only in second' };
    $('diff-body').innerHTML = `
      <p class="diff-counts"><b>${d.counts.changed}</b> changed · <b>${d.counts.only_a}</b> only in the first · <b>${d.counts.only_b}</b> only in the second · ${d.counts.same} the same</p>
      ${d.rows.length ? `<div class="diff-table" role="table" aria-label="Settings side by side">
        <div class="diff-row diff-headrow" role="row"><span role="columnheader">Setting</span><span role="columnheader">${esc(a)}</span><span role="columnheader">${esc(b)}</span></div>
        ${d.rows.map(r => `<div class="diff-row ${r.status}" role="row">
          <span role="cell" class="diff-key">${esc(r.setting)}<small>${label[r.status]}</small></span>
          <span role="cell" class="diff-a">${r.a == null ? '—' : esc(r.a)}</span>
          <span role="cell" class="diff-b">${r.b == null ? '—' : esc(r.b)}</span></div>`).join('')}
      </div>` : '<p class="pf-ok">Every setting is the same.</p>'}`;
  }

  /* ================================================================
   * 7. Confirm Print gate + queue
   * ================================================================ */

async function openConfirm(filename, fromEl, preloaded, opts = {}) {
    if (!liveData()) { toast('No printer connected. Turn on demo data to print on a simulated printer', 'warn'); return; }
    wsState.confirmFile = filename;
    const dialog = $('confirm-dialog');
    $('confirm-sub').textContent = `${filename} on ${printerName(currentPrinter || (live.fleet[0] || {}).id)}`;
    // Nothing from the file checked before may show, or stay pressable, while this one is checked.
    const health = $('confirm-health');
    health.innerHTML = '<span class="gm-num">–</span><span class="gm-lbl">health</span>';
    health.style.removeProperty('--gm');
    health.removeAttribute('title');
    qs('#confirm-dialog .dialog-panel').style.removeProperty('--glass-tint');
    $('confirm-go').disabled = true;
    $('confirm-go').textContent = 'Start print';
    $('confirm-body').innerHTML = '<p class="log-empty">Checking the file and the printer…</p>';
    openDialog(dialog, fromEl);
    const gate = preloaded || await getJSON(api(`/api/print/confirm?file=${enc(filename)}`)).catch(() => null);
    // A slow answer for a file checked earlier must not replace what the dialog shows now.
    if (wsState.confirmFile !== filename || !dialog.open) return;
    if (!gate) { $('confirm-body').innerHTML = '<p class="log-empty">Could not check this file. Try again.</p>'; return; }
    renderGate(gate);
    if (window.Recall) Recall.intoConfirm($('confirm-body'), filename, opts.repeat);   // its history and what differs now
  }

async function loadQueue() {
    const host = $('queue-host');
    if (!host) return;
    const q = await getJSON(api('/api/queue')).catch(() => null);
    if (isModuleDisabled(q)) { host.innerHTML = moduleDisabledEmpty('Print queue'); return; }
    if (!q || !hasData(q)) { host.innerHTML = demoNeeded('the print queue'); return; }
    const waiting = q.items.filter(i => i.status === 'queued' || i.status === 'held');
    $('qa-next').hidden = !waiting.length;
    const bed = q.bed || { state: 'clear' };
    const who = printerName(q.printer);
    const ended = bed.ended_at ? bed.ended_at.slice(11, 16) : '';
    const how = { finished: 'It finished', failed: 'It failed', cancelled: 'It was cancelled' }[bed.outcome] || 'It ended';
    host.innerHTML = `
      ${bed.state === 'awaiting_clear' ? `<div class="bed-hold" role="status">
        <p><b>Take ${esc(bed.file || 'the last print')} off the bed</b>
          <small>${how} on ${esc(who)}${ended ? ` at ${esc(ended)}` : ''}. Nothing in this queue starts on ${esc(who)} until you confirm.</small></p>
        <button class="btn primary" id="bed-clear" type="button" data-job="${esc(bed.job_key || '')}"
                aria-label="Part removed, bed clear: ${esc(who)}, ${esc(bed.file || 'the last print')}">Part removed, bed clear
          <small>${esc(who)} · ${esc(bed.file || 'the last print')}</small></button>
      </div>` : ''}
      <label class="switch queue-auto" for="queue-auto">
        <span class="switch-label">Start the next file when a print finishes and you say the bed is clear</span>
        <input type="checkbox" id="queue-auto" ${q.auto_advance ? 'checked' : ''}>
        <span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>
      </label>
      ${q.items.length ? `<ol class="queue-list">${q.items.map((i, n) => `
        <li class="queue-item ${i.status}">
          <div class="qi-main"><span class="qi-name">${esc(i.filename)}</span>
            <span class="pill qi-status">${{ queued: 'Waiting', held: 'Held', starting: 'Starting…', started: 'Printing', done: 'Done' }[i.status] || esc(i.status)}</span></div>
          ${i.note ? `<div class="qi-note">${esc(i.note)}</div>` : ''}
          ${i.status === 'queued' || i.status === 'held' ? `<div class="qi-tools">
            <button class="btn small" data-q="up" data-id="${i.id}" type="button" ${n === 0 ? 'disabled' : ''} aria-label="Move ${esc(i.filename)} up">↑</button>
            <button class="btn small" data-q="down" data-id="${i.id}" type="button" aria-label="Move ${esc(i.filename)} down">↓</button>
            <button class="btn small" data-q="remove" data-id="${i.id}" type="button">Remove</button></div>` : ''}
        </li>`).join('')}</ol>` : '<p class="log-empty">Nothing queued. Open a G-code file and choose "Add to queue".</p>'}
      <div class="fd-actions">
        <button class="btn primary" id="queue-start" type="button" ${waiting.length ? '' : 'disabled'}>Start next</button>
        <button class="btn" id="queue-clear" type="button">Clear finished</button>
      </div>`;
    $('queue-auto').addEventListener('change', async (e) => {
      const r = await postJSON(api('/api/queue/auto'), { enabled: e.target.checked });
      toast(r.ok ? (e.target.checked ? 'The queue will start the next file after each print (after its check)' : 'The queue will wait for you') : `Couldn't change it: ${r.body.error}`, r.ok ? 'ok' : 'bad');
      loadQueue();
    });
    qsa('[data-q]', host).forEach(b => b.addEventListener('click', async () => {
      const path = b.dataset.q === 'remove' ? '/api/queue/remove' : '/api/queue/move';
      await postJSON(api(path), { id: b.dataset.id, direction: b.dataset.q });
      loadQueue();
    }));
    $('queue-start').addEventListener('click', (e) => startNext(e.currentTarget));
    const clear = $('bed-clear');
    if (clear) clear.addEventListener('click', async (e) => {
      const r = await runCommand(e.currentTarget, '/api/queue/bed-clear', { job_key: clear.dataset.job },
        { sending: 'Saving…', done: `Bed clear on ${who}`, failed: 'Not saved' });
      if (r.ok && r.result.body.next && r.result.body.next.started) toast(`Queue started ${r.result.body.next.started.filename}`, 'ok');
      else if (r.ok && r.result.body.next && r.result.body.next.held) toast(`Queue is holding ${r.result.body.next.held.filename}: ${r.result.body.next.held.note}`, 'warn', 8000);
      loadQueue();
    });
    $('queue-clear').addEventListener('click', async () => { await postJSON(api('/api/queue/clear-done'), {}); loadQueue(); });
  }

async function startNext(button) {
    const r = await runCommand(button, '/api/queue/start-next', {}, { sending: 'Checking…', done: 'Queue checked', failed: 'Queue failed' });
    if (r.ok) {
      const body = r.result.body;
      if (body.held && body.gate && body.gate.verdict === 'confirm') openConfirm(body.held.filename, button, body.gate);
      else if (body.held) toast(`Held ${body.held.filename}: ${body.held.note}`, 'warn', 8000);
    }
    loadQueue();
  }

  /* Dialogs are glass laid over glass: they get the "deep" filter, and the
   * page behind them is marked so the layer underneath refracts more. */
function openDialog(dialog, fromEl) {
    if (dialog.open) return;
    document.body.classList.add('has-glass-dialog');
    dialog.showModal();
    const panel = qs('.dialog-panel', dialog);
    if (fromEl && !REDUCED.matches) {
      const a = fromEl.getBoundingClientRect(), b = panel.getBoundingClientRect();
      const sx = a.width / b.width, sy = a.height / b.height;
      const dx = a.left + a.width / 2 - (b.left + b.width / 2), dy = a.top + a.height / 2 - (b.top + b.height / 2);
      pulseRefraction();
      panel.animate(SPRING.map(t => ({
        transform: `translate(${lerp(dx, 0, t)}px, ${lerp(dy, 0, t)}px) scale(${lerp(sx, 1, t)}, ${lerp(sy, 1, t)})`,
        borderRadius: `${lerp(14, 26, t)}px`, opacity: Math.min(1, t * 2.2),
      })), { duration: 620, easing: 'linear' });
    }
  }
  return { applyState, convertFile, loadFiles, loadQueue, openConfirm, openDialog, openDiff, openFile,
    refreshPrinter, renderLocalFiles, startNext };
})();
