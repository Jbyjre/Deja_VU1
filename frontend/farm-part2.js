/* farm-part2.js: part 2 of 2 of farm.js, the printers list, farm desk, practice farm and print pipeline. Split
 * out of the one closure farm.js was (18 November 2026) so a session reads only the part it needs. Loaded before
 * farm.js, after farm-part1.js; it hands its names on through FarmPart2. Holds: apPost, decorateModel, init,
 * initAutoPrint, loadAutoPrint, loadJobs, loadModels, onTab, readyAction, renderJobs, renderSlicer, startSlice,
 * testSlice, turnOn, updateSliceButtons, useSlicer
 */
'use strict';
const FarmPart2 = (() => {
  const { ap, bindCause, busy, causeHtml, cmd, enc, failureHtml, initCommand, initHistory, initSandbox,
    loadFileStrip, loadHistory, loadQueues, loadSandbox, name, onFleet, qs, qsa, renderBar, renderReady,
    startPolling, stopPolling, visible } = FarmPart1;

async function loadAutoPrint() {
    const body = $('ap-body'), off = $('ap-off');
    if (!body) return;
    const forPrinter = currentPrinter;
    const data = await getJSON(api('/api/slicer/settings')).catch(() => null);
    if (forPrinter !== currentPrinter) return;
    // No server: its cards already say they need one.
    if (data && data.server_missing) { body.hidden = false; off.hidden = true; $('slice-ready').hidden = true; return; }
    ap.enabled = !isModuleDisabled(data) && !!data;
    $('slice-ready').hidden = !data;
    if (!ap.enabled) {
      ap.settings = null;
      renderReady();
      body.hidden = true; off.hidden = false;
      off.innerHTML = `
        <div class="empty">
          <span class="empty-mark" aria-hidden="true"></span>
          <p class="empty-title">Slicing is off</p>
          <p class="empty-sub">It slices STL and 3MF models with Snapmaker Orca or OrcaSlicer, free programs you install yourself.
            Nothing is downloaded or installed by this dashboard. Turn it on to set it up.</p>
          <button class="btn primary" type="button" id="ap-enable">Turn on slicing</button>
        </div>`;
      $('ap-enable').addEventListener('click', e => turnOn(e.currentTarget));
      return;
    }
    body.hidden = false; off.hidden = true;
    ap.settings = data;
    renderSlicer();
    await Promise.all([loadModels(), loadJobs()]);
    renderReady();
  }

async function turnOn(btn) {
    const r = await busy(btn, 'Turning on…', () => postJSON('/api/modules/auto_print/toggle', { enabled: true }));
    if (r.ok) { toast('Slicing is on. Next, find your slicer program', 'ok'); await loadAutoPrint(); if (typeof loadModules === 'function') loadModules(); }
    else toast(`Couldn't turn it on: ${r.body.error}`, 'bad');
  }

async function readyAction(key, btn) {
    if (key === 'on') return turnOn(btn);
    if (key === 'find') {
      const r = await busy(btn, 'Looking…', () => postJSON(api('/api/slicer/find'), {}));
      ap.found = r.ok ? r.body : { error: r.body.error || `HTTP ${r.status}` };
      return renderReady();
    }
    if (key === 'check') return $('ap-check').click();
    if (key === 'profile-own') {
      const card = document.querySelector('.native-profile');
      card?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return $('np-scan')?.click();
    }
    if (key === 'profile') {
      // One press: Snapmaker's stock presets that fit the fitted heads, saved as the default; then a test slice.
      const r = await busy(btn, 'Setting up…', () => postJSON('/api/slicer/profiles/stock', {}));
      if (!r.ok) { ap.stockError = r.body.error || `HTTP ${r.status}`; renderReady(); return toast(ap.stockError, 'bad', 9000); }
      ap.stockError = '';
      ap.stock = r.body.stock;
      const made = ap.stock.heads_made ? ' Your four heads were set to what the printer reports (or PLA on 0.4 mm nozzles); change them under Profiles and tools.' : '';
      toast(`Using ${ap.stock.presets.process} with ${ap.stock.presets.machine}.${made}`, 'ok', 9000);
      await loadAutoPrint();
      return testSlice();
    }
    if (key === 'test') return testSlice();
  }

  /* Check it all works: slice the sample 3DBenchy with the default profile and wait for the result. */
async function testSlice() {
    if (ap.testing) return;
    ap.testing = 'Adding the sample models…';
    renderReady();
    try {
      if (!ap.models.some(m => m.name === '3dbenchy.stl')) {
        const added = await postJSON('/api/files/samples', {});
        if (!added.ok) throw new Error(added.body.error || 'The sample models could not be added');
        if (window.Workshop) Workshop.loadFiles();
        await loadModels();
      }
      const model = (ap.models.find(m => m.name === '3dbenchy.stl') || ap.models[0] || {}).name;
      if (!model) throw new Error('No model to slice');
      ap.testing = `Slicing ${model}… (usually under a minute)`;
      renderReady();
      const r = await postJSON(api('/api/slicer/slice'), { name: model, profile: null, queue: false });
      if (!r.ok) throw new Error(r.body.error || `HTTP ${r.status}`);
      const id = r.body.id;
      for (let i = 0; i < 150; i++) {
        await new Promise(res => setTimeout(res, 2000));
        await loadJobs();
        const job = ap.jobs.find(j => j.id === id);
        if (!job || ['waiting', 'running'].includes(job.status)) continue;
        if (job.status === 'failed' || job.status === 'cancelled') throw new Error(job.error || 'The test slice failed. Its cause is under Slicing jobs below');
        const f = ((job.report || {}).files || [])[0] || {};
        ap.tested = `Sliced ${model}: ${f.layers || '?'} layers, ${f.estimated_hours == null ? 'time unknown' : Workshop.fmtHours(f.estimated_hours)}, ${f.filament_grams == null ? 'filament unknown' : f.filament_grams.toFixed(1) + ' g'}. Everything works.`;
        toast(ap.tested, 'ok', 8000);
        return;
      }
      throw new Error('The test slice is taking longer than usual. It keeps going; its result shows under Slicing jobs');
    } catch (e) {
      toast(`Test slice: ${e.message}`, 'bad', 9000);
    } finally {
      ap.testing = '';
      renderReady();
    }
  }

async function useSlicer(i, btn) {
    const pick = ap.found && ap.found.found[i];
    if (!pick) return;
    const saved = await apPost('/api/slicer/settings', { slicer_path: pick.path }, btn, 'Saving…');
    if (!saved.ok) return;
    ap.found = null;
    const r = await busy(btn, 'Checking…', () => postJSON('/api/slicer/check', {}));
    if (r.ok) toast(r.body.ok ? r.body.detail : `Check failed: ${r.body.error}`, r.body.ok ? 'ok' : 'bad', 8000);
    await loadAutoPrint();
  }

function renderSlicer() {
    const s = ap.settings, check = s.last_check;
    const status = $('ap-status');
    if (s.problem) status.innerHTML = `<p class="ap-state is-bad"><b>Not ready.</b> ${esc(s.problem)}</p>`;
    else if (check && check.ok) status.innerHTML = `<p class="ap-state is-ok"><b>Ready.</b> ${esc(check.detail)} <small>checked ${esc(check.checked_at.replace('T', ' '))}</small>${check.support ? `<small>${esc(check.support.title)} ${esc(check.support.detail)}</small>` : ''}</p>`;
    else if (check) status.innerHTML = `<div class="ap-state is-bad"><b>The last check failed.</b> ${esc(check.error)}${causeHtml(check.cause)}</div>`;
    else status.innerHTML = '<p class="ap-state"><b>Not checked yet.</b> Save the path, then press "Check slicer".</p>';
    bindCause(status);
    if (document.activeElement !== $('ap-path')) $('ap-path').value = s.slicer_path || '';
    if(document.activeElement!==$('ap-preset-folder'))$('ap-preset-folder').value=s.preset_folder||'';
    $('ap-path').disabled = s.path_source === 'environment';
    $('ap-path-note').textContent = s.path_source === 'environment'
      ? 'Set by DEJAVU_SLICER_PATH when the server was started - change it there.' : '';
    if (document.activeElement !== $('ap-timeout')) $('ap-timeout').value = s.timeout_s;
    paint($('ap-profiles'), s.profiles.length ? s.profiles.map(p => `
      <li class="ap-profile">
        <label class="ap-default"><input type="radio" name="ap-default" value="${esc(p.id)}" ${p.id === s.default_profile ? 'checked' : ''}> Default</label>
        <span><b>${esc(p.name)}</b>
          <small>${esc(p.preset_names.machine)} · ${esc(p.preset_names.process)} · ${p.preset_names.filaments.map(esc).join(', ')}</small>
          ${(p.warnings || []).map(w => `<small class="ap-warn">${esc(w)}</small>`).join('')}</span>
        <button class="btn small" type="button" data-remove-profile="${esc(p.id)}">Remove</button>
      </li>`).join('') : '<li class="log-empty">No profiles yet. A profile is one machine, one process and one to four filament presets.</li>');
    qsa('[name="ap-default"]').forEach(r => r.onchange = () => apPost('/api/slicer/settings', { default_profile: r.value }));
    qsa('[data-remove-profile]').forEach(b => b.onclick = () => apPost(`/api/slicer/profiles/${enc(b.dataset.removeProfile)}/remove`, {}, b, 'Removing…'));
    const sel = $('ap-profile'), keepProfile = sel.value;
    sel.innerHTML = s.profiles.map(p => `<option value="${esc(p.id)}" ${p.id === s.default_profile ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    if (s.profiles.some(p=>p.id===keepProfile)) sel.value=keepProfile;
    updateSliceButtons();
  }

async function apPost(path, body, btn, label) {
    const r = await busy(btn, label || 'Saving…', () => postJSON(path, body));
    if (!r.ok) { toast(r.body.error || `HTTP ${r.status}`, 'bad', 8000); return r; }
    if (r.body.profiles) { ap.settings = r.body; renderSlicer(); } else await loadAutoPrint();
    return r;
  }

async function loadModels() {
    const data = await getJSON('/api/files').catch(() => null);
    ap.models = ((data && data.files) || []).filter(f => f.kind === 'stl' || f.kind === '3mf');
    const sel = $('ap-model'), keep = sel.value;
    sel.innerHTML = ap.models.length
      ? ap.models.map(f => `<option value="${esc(f.name)}" ${f.name === keep ? 'selected' : ''}>${esc(f.name)}</option>`).join('')
      : '<option value="">No STL or 3MF models in the library</option>';
    updateSliceButtons();
    renderReady();
  }

function updateSliceButtons() {
    const ready = ap.settings && !ap.settings.problem && ap.settings.profiles.length && ap.models.length;
    $('ap-slice').disabled = !ready;
    $('ap-slice-queue').disabled = !ready || !liveData();
    const target = currentPrinter || (cmd.fleet[0] && cmd.fleet[0].id);
    $('ap-slice-queue').textContent = target ? `Slice and queue on ${name(target)}` : 'Slice and queue';
    $('ap-queue-note').textContent = liveData() ? '' : 'Queueing needs a printer - with none connected, turn on demo data to queue on a simulated one.';
  }

async function startSlice(queue, btn, model) {
    const body = { name: model || $('ap-model').value, profile: $('ap-profile').value || null, queue };
    const r = await busy(btn, 'Starting…', () => postJSON(api('/api/slicer/slice'), body));
    if (!r.ok) { toast(`Couldn't start slicing: ${r.body.error || r.status}`, 'bad', 8000); return; }
    toast(`Slicing ${r.body.model}…`, 'info');
    await loadJobs();
  }

async function loadJobs() {
    const forPrinter = currentPrinter;
    const data = await getJSON(api('/api/slicer/jobs')).catch(() => null);
    if (forPrinter !== currentPrinter) return;
    if (!data || !data.jobs) return;
    ap.jobs = data.jobs;
    renderJobs();
    const active = ap.jobs.some(j => j.status === 'waiting' || j.status === 'running');
    if (active && !ap.timer) ap.timer = setInterval(loadJobs, 1000);
    if (!active && ap.timer) { clearInterval(ap.timer); ap.timer = null; }
  }

function renderJobs() {
    const WORD = { waiting: 'Waiting', running: 'Slicing', done: 'Sliced', queued: 'Sliced & queued', failed: 'Failed', cancelled: 'Cancelled' };
    paint($('ap-jobs'), ap.jobs.length ? ap.jobs.map(j => {
      const rep = j.report || {}, files = rep.files || [];
      return `<li class="ap-job ${j.status}">
        <div class="ap-job-head"><b>${esc(j.model)}</b><span class="pill">${WORD[j.status]}</span></div>
        <div class="ap-job-step">${j.status === 'failed' ? failureHtml(j) : esc(j.error || j.step)}</div>
        ${files.map(f => `<p class="ap-job-file">→ <button class="chip-btn" type="button" data-open-file="${esc(f.name)}">${esc(f.name)}</button>
          ${f.layers} layers · ${f.estimated_hours==null?'time unknown':Workshop.fmtHours(f.estimated_hours)} · ${f.filament_grams==null?'filament unknown':f.filament_grams.toFixed(1)+' g'} · pre-flight ${esc(f.preflight)}</p>`).join('')}
        <div class="fd-actions">
          ${['waiting','running'].includes(j.status)?`<button class="btn small" data-cancel-slice="${esc(j.id)}">Cancel slice</button>`:''}
          ${['done','queued','cancelled'].includes(j.status)?`<button class="btn small" type="button" data-slice-report="${esc(j.id)}">Copy report</button>`:''}
          ${files.length && j.previous ? `<button class="btn small" type="button" data-diff="${esc(j.previous)}|${esc(files[0].name)}">What changed since ${esc(j.previous)}?</button>` : ''}
          ${rep.command ? `<details class="ap-details"><summary>What ran${rep.seconds != null ? ` (${rep.seconds} s)` : ''}</summary>
            <code>${esc(rep.command.join(' '))}</code>
            ${rep.error_tail || rep.output_tail ? `<pre>${esc((rep.error_tail || rep.output_tail).slice(-600))}</pre>` : ''}</details>` : ''}
        </div>
      </li>`;
    }).join('') : '<li class="log-empty">Nothing sliced yet.</li>');
    qsa('#ap-jobs [data-cancel-slice]').forEach(b => b.onclick = () => apPost('/api/slicer/jobs/'+enc(b.dataset.cancelSlice)+'/cancel', {}, b, 'Stopping…'));
    bindCause($('ap-jobs'));
    window.dispatchEvent(new CustomEvent('dv-slice-jobs', {detail:ap.jobs}));
    qsa('#ap-jobs [data-open-file]').forEach(b => b.onclick = () => { showTab('files'); Workshop.openFile(b.dataset.openFile); });
    qsa('#ap-jobs [data-diff]').forEach(b => b.onclick = () => { const [a, c] = b.dataset.diff.split('|'); Workshop.openDiff(a, c); });
    // Say when a job finishes, once.
    ap.jobs.forEach(j => {
      const before = ap.seen.get(j.id);
      if (before && before !== j.status && ['done', 'queued', 'failed', 'cancelled'].includes(j.status)) {
        toast(j.status === 'failed' ? `Slicing ${j.model} failed: ${j.error}` : `${j.model}: ${j.step}`, j.status === 'failed' ? 'bad' : 'ok', 8000);
        if (window.Workshop) { Workshop.loadFiles(); Workshop.loadQueue(); }
      }
      ap.seen.set(j.id, j.status);
    });
  }

  /* A model opened in Files gets "Slice" next to its other actions. */
function decorateModel(entry) {
    const slot = $('fd-slice-slot');
    if (!slot || !ap.enabled) return;
    slot.innerHTML = `<button class="btn primary" type="button" id="fd-slice">Open in Slicer</button>`;
    $('fd-slice').addEventListener('click', () => { if (window.Slicer) Slicer.open(entry.name); else showTab('slicer'); });
  }

function initAutoPrint() {
    if (!$('tab-autoprint')) return;
    $('slice-ready').addEventListener('click', e => {
      const act = e.target.closest('[data-sr-act]'), use = e.target.closest('[data-sr-use]'), open = e.target.closest('[data-sr-open]');
      if (act) readyAction(act.dataset.srAct, act);
      else if (use) useSlicer(+use.dataset.srUse, use);
      else if (open && window.Workshop) Workshop.openFile(open.dataset.srOpen);
      else if (e.target.closest('[data-sr-type]')) { $('ap-path').scrollIntoView({ block: 'center' }); $('ap-path').focus(); }
    });
    $('ap-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const body = { timeout_s: +$('ap-timeout').value, preset_folder:$('ap-preset-folder').value };
      if (!$('ap-path').disabled) body.slicer_path = $('ap-path').value;
      apPost('/api/slicer/settings', body, qs('button[type="submit"]', e.target));
    });
    $('ap-check').addEventListener('click', async (e) => {
      const r = await busy(e.currentTarget, 'Checking…', () => postJSON('/api/slicer/check', {}));
      if (r.ok) toast(r.body.ok ? r.body.detail : `Check failed: ${r.body.error}`, r.body.ok ? 'ok' : 'bad', 8000);
      loadAutoPrint();
    });
    $('ap-profile-form').addEventListener('submit', (e) => {
      e.preventDefault();
      apPost('/api/slicer/profiles', {
        name: $('ap-p-name').value, machine: $('ap-p-machine').value, process: $('ap-p-process').value,
        filaments: $('ap-p-filaments').value.split('\n').map(x => x.trim()).filter(Boolean),
      }, qs('button[type="submit"]', e.target), 'Checking presets…').then(r => { if (r.ok) e.target.reset(); });
    });
    $('ap-slice').addEventListener('click', (e) => startSlice(false, e.currentTarget));
    $('ap-slice-queue').addEventListener('click', (e) => startSlice(true, e.currentTarget));
  }

  /* ================================================================
   * wiring
   * ================================================================ */

function onTab(tab) {
    if (tab === 'fleet') { loadFileStrip(); loadQueues(); loadHistory(); }
    // Sandbox is part of the Fleet tab, Slicing part of Files.
    if (tab === 'fleet') { loadSandbox(); startPolling(); } else stopPolling();
    if (tab === 'files') loadAutoPrint();
  }

function init() {
    initCommand();
    initHistory();
    initSandbox();
    initAutoPrint();
    window.addEventListener('dv-fleet', (e) => onFleet(e.detail));
    window.addEventListener('dv-tab', (e) => onTab(e.detail));
    window.addEventListener('dv-refresh', () => {
      renderBar();
      const tab = store.get('dejavu1.tab') || 'overview';
      onTab(tab);
      getJSON('/api/slicer/settings').then(d => { ap.enabled = !!d && !isModuleDisabled(d); }).catch(() => {});
    });
    window.addEventListener('dv-model-open', (e) => decorateModel(e.detail));
    window.addEventListener('dv-live-event', (e) => {
      const ev = e.detail;
      if (ev.type === 'queue' || (ev.type === 'print_event' && visible('tab-fleet'))) loadQueues();
      if (ev.type === 'print_event' && visible('tab-fleet') && ['finished', 'failed', 'cancelled'].includes(ev.event)) loadHistory();
      if (ev.type === 'slicer') loadJobs();
      // Sandbox events are the scenario talking - worth a word on any tab,
      // since the point is to watch the rest of the dashboard react.
      if (ev.type === 'sandbox' && ev.printer && !visible('tab-fleet')) {
        toast(`Sandbox: ${ev.printer_name}: ${ev.detail}`, ev.ok ? 'info' : 'warn', 5000);
      }
    });
    getJSON('/api/slicer/settings').then(d => { ap.enabled = !!d && !isModuleDisabled(d); }).catch(() => {});
    onTab(store.get('dejavu1.tab') || 'overview');
  }
  return { init, loadAutoPrint };
})();
