/* The Slicer, part 4 of 5: slicing, the Slice and Print buttons, and the Preview page.
 *
 * Slice plate: the plate is saved as a project (the same file Files keeps), the working profile is rebuilt from the sidebar so the engine's
 * own refusals come back in words, and the engine slices it. The job is followed until it ends; what comes back is the G-code in the
 * library with the engine's own time and filament figures. Anything changed afterwards marks the slice out of date at once. The Preview
 * (slicer-path.js draws it) reads that G-code. Print plate hands the file to Confirm Print, exactly as Files does. */
'use strict';
(() => {
  const { state, ic, q, qa, on, esc, fmt, say, timeWords } = SL;
  const sl = state.slice;
  let poll = 0, ticker = 0, startedAt = 0;

  /* ---- saving the plate as a project ------------------------------------------------------------------------------------------------- */
  async function savePlate(plate) {
    if (SL.demo()) throw new Error('Slicing needs the local Deja Vu1 app. The public demo is a recording.');
    const m = state.model, rows = m.onPlate(plate).filter(o => !o.hidden);
    if (!rows.length) throw new Error('Put a model on the plate first.');
    for (const o of rows) {
      if (!o.local) continue;
      const ext = (o.file.split('.').pop() || 'stl').toLowerCase();
      const name = 'source-' + Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('') + '.' + ext;
      const res = await fetch('/api/files/upload?name=' + encodeURIComponent(name), { method: 'POST', body: o.local });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `${o.file} could not be saved`);
      o.sourceName = body.name; o.local = null;
    }
    const r = await postJSON('/api/files/plate', { objects: m.rows(plate).filter(row => rows.some(o => (o.sourceName || o.file) === row.name)) });
    if (!r.ok) throw new Error(r.body.error || 'The plate could not be saved');
    return r.body.name;
  }

  /* ---- slicing -------------------------------------------------------------------------------------------------------------------------- */
  const STAGES = [['prepare', 'Checking'], ['slice', 'Slicing'], ['save', 'Saving']];
  function stageOf(step) {
    const t = String(step || '').toLowerCase();
    if (/slicing with|time limit/.test(t)) return 1;
    if (/sliced|saving|queue/.test(t)) return 2;
    return 0;
  }

  async function slicePlate() {
    if (sl.state === 'saving' || sl.state === 'slicing') return;
    const m = state.model;
    if (!m.canSlice()) return say('Fix what the plate shows in red first.', 'warn');
    sl.state = 'saving'; sl.error = null; sl.cause = null; sl.result = null; sl.stale = false; sl.step = 'Saving the plate'; sl.stage = 0;
    renderGo();
    try {
      const file = await savePlate();
      sl.step = 'Checking the settings'; renderGo();
      const profile = await SL.ensureProfile();
      sl.state = 'slicing'; sl.step = 'Starting the engine'; startedAt = Date.now(); renderGo();
      const r = await postJSON('/api/slicer/slice', { name: file, profile });
      if (window.Activity) Activity.refresh();                        // the tray shows the slice at once
      if (!r.ok) throw new Error(r.body.error || 'The engine could not start');
      sl.job = r.body; sl.plateFile = file; sl.plateVersion = m.version;
      clearInterval(poll); clearInterval(ticker);
      poll = setInterval(followJob, 700);
      ticker = setInterval(renderGo, 1000);
    } catch (e) { endSlice({ status: 'failed', error: e.message }); }
  }

  async function followJob() {
    if (!sl.job) return;
    let jobs;
    try { jobs = (await getJSON('/api/slicer/jobs')).jobs || []; } catch (_) { return; }
    const job = jobs.find(j => j.id === sl.job.id);
    if (!job) return;
    sl.job = job; sl.step = job.step; sl.stage = stageOf(job.step);
    if (['done', 'failed', 'cancelled', 'queued'].includes(job.status)) endSlice(job); else renderGo();
  }

  async function endSlice(job) {
    clearInterval(poll); clearInterval(ticker);
    if (job.status === 'failed') {
      sl.state = 'failed'; sl.error = job.error || 'The slice failed'; sl.cause = job.cause || null; renderGo(); return;
    }
    if (job.status === 'cancelled') { sl.state = 'idle'; sl.error = null; renderGo(); return; }
    const file = job.report && job.report.files && job.report.files[0];
    sl.state = 'done'; sl.result = file ? { name: file.name, layers: file.layers, hours: file.estimated_hours, grams: file.filament_grams, preflight: file.preflight, report: job.report } : null;
    sl.stale = state.model.version !== sl.plateVersion;
    renderGo();
    if (sl.result && SL.path) { await SL.path.load(sl.result.name); }
    if (window.Sections) Sections.choose('slicer', 'preview');
  }

  async function cancelSlice() {
    if (sl.job) await postJSON(`/api/slicer/jobs/${sl.job.id}/cancel`, {});
    if (sl.state === 'saving') { sl.state = 'idle'; renderGo(); }
  }

  function markStale() {
    if (sl.state === 'done' && !sl.stale) { sl.stale = true; renderGo(); }
  }
  SL.onPlateChanged = (kind) => { if (['transform', 'add', 'remove', 'tool', 'settings', 'arrange', 'duplicate', 'split', 'clear', 'undo', 'redo', 'aside', 'hidden', 'rename'].includes(kind)) markStale(); renderGo(); };

  /* ---- the buttons ------------------------------------------------------------------------------------------------------------------------- */
  function renderGo() {
    const box = q('#sl-go');
    if (!box) return;
    const m = state.model, count = m.onPlate().filter(o => !o.hidden).length;
    const engine = state.engine, haveEngine = SL.engineReady();
    let info = '', buttons = '';
    if (sl.state === 'saving' || sl.state === 'slicing') {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      info = `<span class="sl-go-info"><b>${esc(STAGES[Math.min(sl.stage || 0, 2)][1])}…${sl.state === 'slicing' && startedAt ? ' ' + secs + ' s' : ''}</b><span>${esc(sl.step || '')}</span></span>`;
      buttons = `<button type="button" class="sl-btn" id="sl-cancel">Cancel</button>`;
    } else if (sl.state === 'failed') {
      info = `<span class="sl-go-info"><b class="sl-bad">The slice did not finish</b><span>${esc(String(sl.error || '').slice(0, 220))}</span></span>`;
      buttons = `<button type="button" class="sl-btn" id="sl-why">Why?</button><button type="button" class="sl-btn sl-primary" id="sl-slice">Slice again</button>`;
    } else if (state.page === 'preview') {
      const r = sl.result;
      info = r ? `<span class="sl-go-info"><b>${esc(timeWords(r.hours))} · ${r.grams ? fmt(r.grams, 1) + ' g' : '–'}</b><span>${sl.stale ? 'The plate changed since this slice.' : esc(r.layers + ' layers')}</span></span>` : '<span class="sl-go-info"><span>Nothing sliced yet.</span></span>';
      buttons = r ? `<button type="button" class="sl-btn" id="sl-back">${ic('back')}Prepare</button>${sl.stale ? '<button type="button" class="sl-btn sl-primary" id="sl-slice">Slice again</button>' : `<button type="button" class="sl-btn" id="sl-more">More…</button><button type="button" class="sl-btn sl-primary" id="sl-print">${ic('printer')}Print plate</button>`}`
        : `<button type="button" class="sl-btn" id="sl-back">${ic('back')}Prepare</button>`;
    } else {
      // A model bigger than the U1, or hanging over the plate's edge, cannot be sliced: the button says so instead of doing nothing (22 November 2026).
      const blocked = count > 0 && !m.canSlice();
      const why = blocked ? ((m.problems({ overhangs: false }).find(p => p.level === 'error') || {}).text || 'A model is outside the printable area.') : '';
      info = blocked ? `<span class="sl-go-info"><b class="sl-bad">Can't slice yet</b><span id="sl-go-why">${esc(why)}</span></span>`
        : count ? `<span class="sl-go-info"><b>${count} object${count > 1 ? 's' : ''}</b><span>${sl.state === 'done' && !sl.stale && sl.result ? 'Sliced: ' + esc(timeWords(sl.result.hours)) : 'Plate ' + (m.current + 1) + (haveEngine ? '' : ' · no engine yet')}</span></span>` : '';
      buttons = sl.state === 'done' && sl.result ? `<button type="button" class="sl-btn" id="sl-view">Preview</button>` : '';
      buttons += `<button type="button" class="sl-btn sl-primary" id="sl-slice"${count && !blocked ? '' : ' disabled'}${blocked ? ` title="${esc(why)}" aria-describedby="sl-go-why"` : ''}>${ic('layers')}Slice plate</button>`;
    }
    box.innerHTML = info + buttons;
    box.hidden = state.page === 'preview' && sl.state === 'idle' && !sl.result ? false : false;
    on(q('#sl-slice'), 'click', onSliceClick);
    on(q('#sl-cancel'), 'click', cancelSlice);
    on(q('#sl-back'), 'click', () => window.Sections && Sections.choose('slicer', 'prepare'));
    on(q('#sl-view'), 'click', () => window.Sections && Sections.choose('slicer', 'preview'));
    on(q('#sl-why'), 'click', explainFailure);
    on(q('#sl-print'), 'click', printPlate);
    on(q('#sl-more'), 'click', e => moreMenu(e.currentTarget));
    void engine;
  }

  SL.engineReady = () => !!(state.engine && (state.engine.installed || (state.work && state.work.data && state.work.data.engine && state.work.data.engine.path)));

  async function onSliceClick() {
    if (!state.model.canSlice()) {
      const why = (state.model.problems({ overhangs: false }).find(p => p.level === 'error') || {}).text;
      return say(`${why || 'A model is outside the printable area.'} Use Scale to fit or move it onto the plate.`, 'warn');
    }
    if (!SL.engineReady()) { SL.settings.openEngine(); return say('The slicing engine is not installed yet.', 'info'); }
    slicePlate();
  }

  /* The engine's own words for what stopped it, and the help report (the same one Files offers). */
  function explainFailure() {
    const c = sl.cause, box = document.createElement('section');
    box.className = 'sl-card'; box.id = 'sl-why-card'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Why the slice failed');
    box.innerHTML = `<div class="sl-ch"><b>${esc((c && c.title) || 'The slice did not finish')}</b><button type="button" class="sl-ix" id="sl-why-x" aria-label="Close">${ic('x')}</button></div>
      <p class="sl-es">${esc((c && c.explanation) || sl.error || '')}</p>
      ${c && c.fixes && c.fixes.length ? `<ul class="sl-fixes">${c.fixes.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      <div class="sl-ea"><button type="button" class="sl-btn" id="sl-why-copy">Copy the help report</button></div>`;
    const old = q('#sl-why-card'); if (old) old.remove();
    SL.root().append(box);
    on(q('#sl-why-x'), 'click', () => box.remove());
    on(q('#sl-why-copy'), 'click', async ev => SL.busy(ev.currentTarget, 'Preparing…', async () => {
      const r = await postJSON('/api/slicer/report', { job: sl.job && sl.job.id });
      try { await navigator.clipboard.writeText(JSON.stringify(r.body, null, 2)); say('The help report is on the clipboard.', 'ok'); } catch (_) { say('The report could not be copied. Open Files › Slicing to read it.', 'warn'); }
    }));
  }

  /* ---- printing ---------------------------------------------------------------------------------------------------------------------------- */
  function printPlate() {
    const r = sl.result;
    if (!r) return;
    // Confirm Print is the one place a print starts: it checks the file against this printer and says no in words.
    if (typeof Workshop !== 'undefined' && Workshop.openConfirm) Workshop.openConfirm(r.name);
    else if (typeof openConfirm === 'function') openConfirm(r.name);
    else say('Open the file in Files to print it.', 'info');
  }

  function moreMenu(anchor) {
    const old = q('#sl-menu'); if (old) { old.remove(); return; }
    const r = sl.result, menu = document.createElement('div');
    menu.className = 'sl-menu'; menu.id = 'sl-menu'; menu.setAttribute('role', 'menu');
    menu.innerHTML = `<a role="menuitem" class="sl-mi" href="/api/files/raw?name=${encodeURIComponent(r.name)}&download=1" download>${ic('download')}Save the G-code</a>
      <button type="button" role="menuitem" class="sl-mi" id="sl-m-queue">${ic('queue')}Add to the queue</button>
      <button type="button" role="menuitem" class="sl-mi" id="sl-m-files">${ic('folder')}Show it in Files</button>`;
    q('#sl-go').append(menu);
    on(q('#sl-m-queue'), 'click', async () => { menu.remove(); const res = await postJSON(api('/api/queue/add'), { file: r.name }); say(res.ok ? 'Added to the queue.' : (res.body.error || 'It could not be queued'), res.ok ? 'ok' : 'warn'); });
    on(q('#sl-m-files'), 'click', () => { menu.remove(); if (window.Rail) Rail.goDest('files'); });
    const away = e => { if (!menu.contains(e.target) && e.target !== anchor) { menu.remove(); document.removeEventListener('pointerdown', away, true); } };
    document.addEventListener('pointerdown', away, true);
  }

  /* ---- the Preview page's own dock is built in slicer-path.js; here only the page switch ---------------------------------------------------- */
  function build() {
    const host = document.getElementById('sl-preview');
    host.innerHTML = '<div class="sl-pv-root" id="sl-pv"></div>';
    if (SL.path && SL.path.build) SL.path.build(q('#sl-pv'));
  }

  function onPage(page) {
    renderGo();
    if (SL.path && SL.path.onPage) SL.path.onPage(page);
  }

  /* the keys Ctrl R, Ctrl G and Ctrl Shift G (Snapmaker Orca's Slice plate, Export plate sliced file and Print plate) */
  function ready() {
    if (sl.state === 'saving' || sl.state === 'slicing') { say('The plate is being sliced.', 'info'); return null; }
    if (!sl.result || sl.stale) { say('Slice the plate first (Ctrl R).', 'info'); return null; }
    return sl.result;
  }
  function sliceKey() { if (sl.state !== 'saving' && sl.state !== 'slicing' && state.model.onPlate().some(o => !o.hidden)) onSliceClick(); }
  function printKey() { if (ready()) printPlate(); }
  function saveKey() {
    const r = ready();
    if (!r) return;
    const a = document.createElement('a');
    a.href = `/api/files/raw?name=${encodeURIComponent(r.name)}&download=1`; a.download = r.name;
    document.body.append(a); a.click(); a.remove();
  }

  SL.preview = { build, renderGo, markStale, onPage, slicePlate, savePlate, sliceKey, printKey, saveKey };
})();
