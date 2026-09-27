/* Deja Vu1 — running the farm: fleet command center, fleet history, the
 * farm sandbox and the auto-print pipeline.
 *
 * Loaded after workshop.js and uses app.js's helpers ($, esc, api,
 * getJSON, postJSON, toast, EMPTY, isModuleDisabled, moduleDisabledEmpty,
 * showTab) and Workshop's (openFile, openDiff, printerName...). Plain
 * JavaScript, nothing fetched from anywhere but this dashboard's server.
 *
 * Contents
 *   1. fleet command center: select printers, one action for all of them,
 *      each printer's own result; files and queue items dragged between
 *      printers
 *   2. fleet history: prints and material over time, per printer and farm
 *   3. farm sandbox: build a farm, script a scenario, run the clock
 *   4. auto-print pipeline: the OrcaSlicer bridge
 */
'use strict';

const Farm = (() => {
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];
  const enc = encodeURIComponent;
  const visible = (id) => { const el = $(id); return el && !el.hidden; };
  const name = (id) => (window.Workshop ? Workshop.printerName(id) : id);

  /* Every button that asks something of the server: shows what it's doing,
   * and is never left saying "Sending…" when the answer is a failure. */
  async function busy(btn, label, fn) {
    const original = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.dataset.phase = 'sending'; btn.textContent = label; }
    try { return await fn(); }
    finally { if (btn) { btn.disabled = false; delete btn.dataset.phase; btn.textContent = original; } }
  }

  /* ================================================================
   * 1. fleet command center
   * ================================================================ */

  const cmd = { selected: new Set(), fleet: [], queues: {}, queuesAt: 0, files: [], picked: null, cancelArmed: null };

  /* Live data re-renders about once a second. Only touch a region when its
   * content changed, and never while focus is inside it - an open "Move
   * to…" menu or a focused tile must not be pulled out from under you. */
  function setHTML(el, html) {
    if (!el || el.dataset.sig === html || el.contains(document.activeElement)) return;
    el.dataset.sig = html;
    el.innerHTML = html;
  }

  function onFleet(rows) {
    cmd.fleet = rows || [];
    const ids = new Set(cmd.fleet.map(p => p.id));
    [...cmd.selected].forEach(id => { if (!ids.has(id)) cmd.selected.delete(id); });
    qsa('#fleet-grid [data-pick]').forEach(box => {
      box.checked = cmd.selected.has(box.dataset.pick);
      box.closest('.fleet-card').classList.toggle('is-picked', box.checked);
    });
    renderBar();
    if (Date.now() - cmd.queuesAt > 3000) loadQueues(); else renderQueues();
  }

  function renderBar() {
    const bar = $('fc-bar');
    if (!bar) return;
    // Every action on the bar is a printer command, so it needs printer control too.
    bar.hidden = !liveData() || !cmd.fleet.length || cmd.moduleOff || modGate.off.has('printer_control');
    const n = cmd.selected.size;
    $('fc-count').textContent = n ? `${n} of ${cmd.fleet.length} selected` : 'Select printers to command them together';
    qsa('#fc-bar [data-act]').forEach(b => { b.disabled = !n; });
    $('fc-all').textContent = n === cmd.fleet.length ? 'Clear' : 'Select all';
    if (!n) disarmCancel();
  }

  function disarmCancel() {
    const b = $('fc-cancel');
    if (!b) return;
    clearTimeout(cmd.cancelArmed);
    cmd.cancelArmed = null;
    b.textContent = 'Cancel prints';
    b.classList.remove('is-armed');
  }

  async function broadcast(action, btn, params) {
    const printers = [...cmd.selected];
    const words = { preheat: 'Preheating', pause: 'Pausing', resume: 'Resuming', cancel: 'Cancelling', home: 'Homing' }[action];
    const r = await busy(btn, `${words}…`, () => postJSON(api('/api/fleet/broadcast'), { action, printers, params }));
    const host = $('fc-results');
    if (!r.ok) {
      host.innerHTML = `<p class="fc-res-head is-bad">${esc(r.body.error || `HTTP ${r.status}`)}</p>`;
      toast(`${words} not sent: ${r.body.error || r.status}`, 'bad', 7000);
      return;
    }
    const b = r.body;
    host.innerHTML = `
      <p class="fc-res-head ${b.all_ok ? 'is-ok' : b.ok_count ? 'is-partial' : 'is-bad'}">${esc(b.headline)}
        <small>${b.ms} ms · each result read back from the printer</small></p>
      <ul class="fc-res-list">${b.results.map(row => `
        <li class="${row.ok ? 'ok' : 'bad'}">
          <span class="fc-res-icon" aria-hidden="true">${row.ok ? '✓' : '✕'}</span>
          <span class="fc-res-name">${esc(row.name)}</span>
          <span class="fc-res-text">${esc(row.ok ? (row.detail || `Confirmed: now ${row.confirmed_state.state}`) : row.error)}</span>
          <span class="sr-only">${row.ok ? 'succeeded' : 'failed'}</span>
        </li>`).join('')}</ul>`;
    toast(b.headline, b.all_ok ? 'ok' : 'warn', b.all_ok ? 4200 : 8000);
    if (window.Workshop) Workshop.refreshPrinter();
  }

  async function loadQueues() {
    cmd.queuesAt = Date.now();
    if (!liveData()) { cmd.queues = {}; renderQueues(); return; }
    const data = await getJSON(api('/api/fleet/queues')).catch(() => null);
    cmd.queues = (data && data.queues) || {};
    cmd.moduleOff = isModuleDisabled(data);
    cmd.queueOff = !!(data && (data.queue_disabled || data.module_disabled));
    renderBar();
    renderQueues();
  }

  function renderQueues() {
    qsa('#fleet-grid .fleet-card').forEach(card => {
      const id = card.dataset.printer, slot = qs('[data-f="queue"]', card);
      if (!slot) return;
      if (cmd.queueOff) { setHTML(slot, ''); return; }
      const q = cmd.queues[id];
      const waiting = q ? q.items.filter(i => i.status === 'queued' || i.status === 'held') : [];
      const others = cmd.fleet.filter(p => p.id !== id);
      setHTML(slot, `
        <div class="fcq-head"><span>Queue</span><b>${waiting.length ? `${waiting.length} waiting` : 'empty'}</b></div>
        ${waiting.slice(0, 4).map(i => `
          <div class="fcq-item ${i.status}" draggable="true" data-item="${esc(i.id)}" data-from="${esc(id)}" data-file="${esc(i.filename)}">
            <span class="fcq-name" title="${esc(i.note || i.filename)}">${esc(i.filename)}</span>
            <label class="sr-only" for="mv-${esc(i.id)}">Move ${esc(i.filename)} to</label>
            <select id="mv-${esc(i.id)}" data-move="${esc(i.id)}" data-from="${esc(id)}">
              <option value="">Move to…</option>${others.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}
            </select>
          </div>`).join('')}
        ${waiting.length > 4 ? `<p class="fcq-more">+${waiting.length - 4} more in Files</p>` : ''}
        ${cmd.picked ? `<button class="btn small block fcq-here" type="button" data-here="${esc(id)}">Queue ${esc(cmd.picked)} here</button>` : ''}
        <p class="fcq-drop">Drop a file here to queue it</p>`);
    });
  }

  async function route(body, target) {
    const r = await postJSON(api('/api/fleet/route'), { ...body, to: target });
    // The "Queue here" button or "Move to…" menu just used still has focus,
    // and setHTML never redraws a region holding focus - so the queue would
    // keep showing its old contents. Hand focus to the card it sits in.
    const used = document.activeElement;
    const card = used && used.closest && used.closest('#fleet-grid .fleet-card');
    if (card && used.closest('[data-f="queue"]')) { card.tabIndex = -1; card.focus({ preventScroll: true }); }
    if (r.ok) toast(`${r.body.routed} ${r.body.moved_from ? 'moved' : 'queued'} on ${r.body.to_name} — it starts only after its Confirm Print check`, 'ok', 5500);
    else toast(`Couldn't queue it on ${name(target)}: ${r.body.error || r.status}`, 'bad', 7000);
    await loadQueues();
    if (window.Workshop) Workshop.loadQueue();
    return r.ok;
  }

  async function loadFileStrip() {
    const host = $('fc-files');
    if (!host) return;
    if (!liveData()) { host.innerHTML = ''; return; }
    const data = await getJSON('/api/files').catch(() => null);
    if (isModuleDisabled(data)) { host.innerHTML = '<p class="log-empty">The file library is off.</p>'; return; }
    cmd.files = ((data && data.files) || []).filter(f => f.kind === 'gcode');
    host.innerHTML = cmd.files.length ? `
      <span class="fr-label">Send a file</span>
      ${cmd.files.slice(0, 14).map(f => `<button class="chip-btn fc-file ${cmd.picked === f.name ? 'is-picked' : ''}" type="button"
          draggable="true" data-file="${esc(f.name)}" aria-pressed="${cmd.picked === f.name}">${esc(f.name)}</button>`).join('')}
      <span class="fc-files-hint">Drag onto a printer, or tap one and choose "Queue here".</span>`
      : '<p class="log-empty">No G-code in the library yet — add some in Files to send it to a printer from here.</p>';
  }

  function initCommand() {
    const grid = $('fleet-grid');
    if (!grid) return;
    grid.addEventListener('change', (e) => {
      const box = e.target.closest('[data-pick]');
      if (box) {
        if (box.checked) cmd.selected.add(box.dataset.pick); else cmd.selected.delete(box.dataset.pick);
        box.closest('.fleet-card').classList.toggle('is-picked', box.checked);
        renderBar();
        return;
      }
      const mv = e.target.closest('[data-move]');
      if (mv && mv.value) route({ from_printer: mv.dataset.from, item_id: mv.dataset.move }, mv.value);
    });
    grid.addEventListener('click', (e) => {
      const here = e.target.closest('[data-here]');
      if (here && cmd.picked) { route({ filename: cmd.picked }, here.dataset.here).then(ok => { if (ok) { cmd.picked = null; loadFileStrip(); renderQueues(); } }); }
    });
    // Drag and drop: library files and waiting queue items onto any printer.
    document.addEventListener('dragstart', (e) => {
      const file = e.target.closest && e.target.closest('.fc-file');
      const item = e.target.closest && e.target.closest('.fcq-item');
      if (!file && !item) return;
      const payload = file ? { filename: file.dataset.file } : { from_printer: item.dataset.from, item_id: item.dataset.item, label: item.dataset.file };
      e.dataTransfer.setData('application/x-dejavu-route', JSON.stringify(payload));
      e.dataTransfer.setData('text/plain', payload.filename || payload.label);
      e.dataTransfer.effectAllowed = 'move';
      grid.classList.add('is-routing');
    });
    document.addEventListener('dragend', () => { grid.classList.remove('is-routing'); qsa('.fleet-card.is-drop').forEach(c => c.classList.remove('is-drop')); });
    grid.addEventListener('dragover', (e) => {
      const card = e.target.closest('.fleet-card');
      if (!card || !e.dataTransfer.types.includes('application/x-dejavu-route')) return;
      e.preventDefault();
      qsa('.fleet-card.is-drop').forEach(c => c !== card && c.classList.remove('is-drop'));
      card.classList.add('is-drop');
    });
    grid.addEventListener('dragleave', (e) => {
      const card = e.target.closest('.fleet-card');
      if (card && !card.contains(e.relatedTarget)) card.classList.remove('is-drop');
    });
    grid.addEventListener('drop', (e) => {
      const card = e.target.closest('.fleet-card');
      const raw = e.dataTransfer.getData('application/x-dejavu-route');
      if (!card || !raw) return;
      e.preventDefault();
      card.classList.remove('is-drop');
      grid.classList.remove('is-routing');
      const payload = JSON.parse(raw);
      if (payload.from_printer === card.dataset.printer) return;
      delete payload.label;
      route(payload, card.dataset.printer);
    });
    $('fc-files').addEventListener('click', (e) => {
      const f = e.target.closest('.fc-file');
      if (!f) return;
      cmd.picked = cmd.picked === f.dataset.file ? null : f.dataset.file;
      loadFileStrip();
      renderQueues();
    });

    $('fc-all').addEventListener('click', () => {
      if (cmd.selected.size === cmd.fleet.length) cmd.selected.clear();
      else cmd.fleet.forEach(p => cmd.selected.add(p.id));
      onFleet(cmd.fleet);
    });
    qsa('#fc-bar [data-act]').forEach(b => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'cancel') {
        // Cancelling is the one broadcast that can't be undone: it takes a second press.
        if (!cmd.cancelArmed) {
          b.textContent = `Confirm: cancel on ${cmd.selected.size}`;
          b.classList.add('is-armed');
          cmd.cancelArmed = setTimeout(disarmCancel, 4000);
          return;
        }
        disarmCancel();
      }
      if (act === 'preheat') {
        const params = { nozzle: $('fc-nozzle').value, bed: $('fc-bed').value,
                         toolheads: $('fc-tools').value === 'all' ? 'all' : [$('fc-tools').value] };
        broadcast('preheat', b, params);
      } else broadcast(act, b, {});
    }));
  }

  /* ================================================================
   * 2. fleet history
   * ================================================================ */

  // The range and measure you last chose are remembered on this device.
  const hist = { days: [7, 30, 90].includes(+store.get('dejavu1.fh-days')) ? +store.get('dejavu1.fh-days') : 30,
                 metric: store.get('dejavu1.fh-metric') === 'grams' ? 'grams' : 'prints', data: null, tip: null };
  // Outcome colours are status colours, darkened from the dashboard's
  // --ok / --bad so each bar segment keeps 3:1 against the glass; failed
  // bars are also hatched, so outcome never rests on red vs green alone.
  const OUTCOME = [
    { key: 'completed', label: 'Completed', color: '#248a3d' },
    { key: 'error', label: 'Failed', color: '#d70015', hatch: true },
    { key: 'cancelled', label: 'Cancelled', color: '#7c7c80' },
  ];

  async function loadHistory() {
    const host = $('fh-host');
    if (!host) return;
    if (!liveData()) { host.innerHTML = EMPTY('No printer connected', 'Turn on demo data to see the simulated farm\'s history.'); return; }
    const bucket = hist.days > 45 ? 'week' : 'day';
    const data = await getJSON(api(`/api/fleet/history?days=${hist.days}&bucket=${bucket}`)).catch(() => null);
    if (isModuleDisabled(data)) { host.innerHTML = moduleDisabledEmpty('Fleet command center'); return; }
    if (!data || !data.farm) { host.innerHTML = EMPTY('No history', 'The printers didn\'t return any history.'); return; }
    hist.data = data;
    renderHistory();
  }

  const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
  const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  function renderHistory() {
    const d = hist.data, f = d.farm;
    const host = $('fh-host');
    host.innerHTML = `
      <div class="fh-tiles divider-row cols-4">
        <div class="stat"><span class="stat-key">Prints</span><span class="stat-val">${f.prints}</span><span class="stat-foot">last ${d.days} days · ${d.printers.length} printers</span></div>
        <div class="stat"><span class="stat-key">Completed</span><span class="stat-val">${pct(f.completion_rate)}</span><span class="stat-foot">${f.completed} finished cleanly</span></div>
        <div class="stat ${f.error ? 'is-alert' : ''}"><span class="stat-key">Failed</span><span class="stat-val">${pct(f.failure_rate)}</span><span class="stat-foot">${f.error} failed · ${f.cancelled} cancelled</span></div>
        <div class="stat"><span class="stat-key">Material</span><span class="stat-val">${(f.grams / 1000).toFixed(2)} kg</span><span class="stat-foot">${Math.round(f.grams_failed)} g on prints that didn't finish</span></div>
      </div>
      <div class="fh-chart-head">
        <h3 class="fd-h">${hist.metric === 'prints' ? 'Prints' : 'Filament used (g)'} per ${d.bucket}, by outcome</h3>
        <ul class="fh-legend">${OUTCOME.map(o => `<li><span class="fh-key ${o.hatch ? 'hatch' : ''}" style="--c:${o.color}"></span>${o.label}</li>`).join('')}</ul>
      </div>
      <div class="fh-chart" id="fh-chart"></div>
      <div class="fh-table" role="table" aria-label="History per printer">
        <div class="fh-row fh-headrow" role="row">
          <span role="columnheader">Printer</span><span role="columnheader">Prints</span><span role="columnheader">Completed</span>
          <span role="columnheader">Failed</span><span role="columnheader">Material</span><span role="columnheader">Hours</span></div>
        ${d.printers.map(p => row(p.name, p)).join('')}
        ${row('Whole farm', f, true)}
      </div>`;
    drawChart();
  }

  function row(label, p, total) {
    const mats = Object.entries(p.materials || {}).map(([m, g]) => `${m} ${g >= 1000 ? (g / 1000).toFixed(1) + ' kg' : Math.round(g) + ' g'}`).join(' · ');
    return `<div class="fh-row ${total ? 'fh-total' : ''}" role="row">
      <span role="cell">${esc(label)}</span><span role="cell">${p.prints}</span>
      <span role="cell">${pct(p.completion_rate)}</span><span role="cell">${pct(p.failure_rate)}${p.error ? ` <small>(${p.error})</small>` : ''}</span>
      <span role="cell" title="${esc(mats)}">${(p.grams / 1000).toFixed(2)} kg</span><span role="cell">${p.hours.toFixed(0)}</span></div>`;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  function drawChart() {
    const host = $('fh-chart');
    if (!host || !hist.data) return;
    const series = hist.data.farm.series;
    const W = Math.max(280, host.clientWidth), H = 190, L = 40, R = 8, T = 10, B = 26;
    const key = (o) => (hist.metric === 'prints' ? o.key : `grams_${o.key}`);
    const stacks = series.map(b => OUTCOME.map(o => ({ ...o, v: b[key(o)] })));
    const top = niceMax(Math.max(...stacks.map(s => s.reduce((a, x) => a + x.v, 0))));
    const band = (W - L - R) / series.length, bw = Math.max(2, Math.min(28, band * 0.7));
    const y = (v) => T + (H - T - B) * (1 - v / top);
    const ticks = [0, top / 2, top];
    const every = Math.ceil(series.length / Math.max(2, Math.floor((W - L) / 64)));
    let bars = '';
    stacks.forEach((segs, i) => {
      const x = L + i * band + (band - bw) / 2;
      let acc = 0;
      const live = segs.filter(s => s.v > 0);
      live.forEach((s, k) => {
        const y0 = y(acc), y1 = y(acc + s.v);
        acc += s.v;
        const h = Math.max(0, y0 - y1 - (k ? 2 : 0));          // 2px surface gap between stacked segments
        const yTop = y1, r = k === live.length - 1 ? Math.min(3, bw / 2, h) : 0;
        const d = `M${x},${yTop + h} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + bw - r} Q${x + bw},${yTop} ${x + bw},${yTop + r} V${yTop + h} Z`;
        bars += `<path d="${d}" fill="${s.hatch ? 'url(#fh-hatch)' : s.color}"/>`;
      });
      bars += `<rect class="fh-hit" x="${L + i * band}" y="${T}" width="${band}" height="${H - T - B}" data-i="${i}" tabindex="-1"/>`;
    });
    const labels = series.map((b, i) => (i % every === 0
      ? `<text x="${L + i * band + band / 2}" y="${H - 8}" text-anchor="middle">${esc(shortDate(b.bucket))}</text>` : '')).join('');
    host.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
           aria-label="${hist.metric === 'prints' ? 'Prints' : 'Filament'} per ${hist.data.bucket} across the farm; the table below has the same figures">
        <defs><pattern id="fh-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="#d70015"/><rect width="1.6" height="5" fill="#ffd7d5"/></pattern></defs>
        ${ticks.map(t => `<line class="fh-grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>
          <text class="fh-y" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${hist.metric === 'prints' ? t : Math.round(t)}</text>`).join('')}
        ${bars}
        <g class="fh-x">${labels}</g>
      </svg>
      <div class="fh-tip" id="fh-tip" hidden></div>`;
    const tip = $('fh-tip');
    host.querySelectorAll('.fh-hit').forEach(hit => {
      const show = () => {
        const b = series[+hit.dataset.i];
        tip.innerHTML = `<b>${hist.data.bucket === 'week' ? 'Week of ' : ''}${esc(shortDate(b.bucket))}</b>
          ${OUTCOME.map(o => `<span><i class="fh-key ${o.hatch ? 'hatch' : ''}" style="--c:${o.color}"></i>${o.label} ${b[o.key]} · ${Math.round(b[`grams_${o.key}`])} g</span>`).join('')}
          <span>${Math.round(b.grams)} g · ${b.hours.toFixed(1)} h</span>`;
        tip.hidden = false;
        const bx = +hit.getAttribute('x') + band / 2;
        tip.style.left = `${Math.min(W - 150, Math.max(0, bx - 75))}px`;
        qsa('.fh-hit', host).forEach(h => h.classList.toggle('is-on', h === hit));
      };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerleave', () => { tip.hidden = true; hit.classList.remove('is-on'); });
    });
  }

  function initHistory() {
    if (!$('fh-range')) return;
    qsa('#fh-range [data-days]').forEach(x => x.classList.toggle('active', +x.dataset.days === hist.days));
    qsa('#fh-metric [data-metric]').forEach(x => x.classList.toggle('active', x.dataset.metric === hist.metric));
    qsa('#fh-range [data-days]').forEach(b => b.addEventListener('click', () => {
      hist.days = +b.dataset.days;
      store.set('dejavu1.fh-days', String(hist.days));
      qsa('#fh-range button').forEach(x => x.classList.toggle('active', x === b));
      loadHistory();
    }));
    qsa('#fh-metric [data-metric]').forEach(b => b.addEventListener('click', () => {
      hist.metric = b.dataset.metric;
      store.set('dejavu1.fh-metric', hist.metric);
      qsa('#fh-metric button').forEach(x => x.classList.toggle('active', x === b));
      if (hist.data) renderHistory();
    }));
    let raf = 0;
    new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawChart); }).observe($('fh-host'));
  }

  /* ================================================================
   * 3. farm sandbox
   * ================================================================ */

  const sb = { data: null, timer: null, seenLog: '', draft: [] };
  const clock = (sec) => {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  const STATE_HEX = { printing: '#248a3d', paused: '#b58300', error: '#d70015', complete: '#4a8df8', ready: '#7c7c80' };
  const PARAMS = {
    jam: ['toolhead'], runout: ['toolhead'], heater_fault: ['toolhead'], bad_swap: ['toolhead'],
    wear: ['hours'], start_print: ['file', 'accept'], queue_file: ['file'],
  };

  async function loadSandbox() {
    const body = $('sb-body'), off = $('sb-off');
    if (!body) return;
    if (!demoOn) {
      body.hidden = true; off.hidden = false;
      off.innerHTML = EMPTY('The sandbox runs on simulated printers', 'Turn on demo data (top right) to build a farm and run scenarios. It never touches a real printer.');
      stopPolling();
      return;
    }
    const data = await getJSON(api('/api/sandbox')).catch(() => null);
    if (isModuleDisabled(data)) { body.hidden = true; off.hidden = false; off.innerHTML = moduleDisabledEmpty('Farm sandbox'); return; }
    if (!data || !data.farm) return;
    body.hidden = false; off.hidden = true;
    const first = !sb.data;
    sb.data = data;
    renderSandbox(first);
  }

  function startPolling() {
    if (sb.timer) return;
    sb.timer = setInterval(() => { if (visible('tab-fleet')) loadSandbox(); else stopPolling(); }, 1000);
  }
  function stopPolling() { clearInterval(sb.timer); sb.timer = null; }

  function targetOptions(selected) {
    const d = sb.data;
    return Object.entries(d.targets).map(([k, v]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${esc(v)}</option>`).join('')
      + d.farm.map(p => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  }
  const eventOptions = (selected) => Object.entries(sb.data.events)
    .map(([k, v]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${esc(v)}</option>`).join('');

  function renderSandbox(first) {
    const d = sb.data;
    // Farm floor: one tile per printer, flashing when an event lands on it.
    const newest = d.log[0];
    const newKey = newest ? `${newest.time}${newest.printer}${newest.event}${d.log.length}` : '';
    const flash = newKey !== sb.seenLog && !first ? new Set(d.log.slice(0, 3).map(e => e.printer)) : new Set();
    sb.seenLog = newKey;
    setHTML($('sb-floor'), d.farm.map(p => `
      <button class="sb-tile ${p.sandbox ? 'is-sim' : ''} ${p.link_lost ? 'is-lost' : ''} ${flash.has(p.id) ? 'is-flash' : ''}"
              type="button" data-open-printer="${esc(p.id)}" style="--st:${STATE_HEX[p.state] || '#7c7c80'}"
              title="${esc(p.name)}: ${esc(p.message || p.state)}${p.link_lost ? ' - not answering' : ''}">
        <span class="sb-dot" aria-hidden="true"></span>
        <span class="sb-tile-name">${esc(p.name)}</span>
        <span class="sb-tile-state">${p.link_lost ? 'no answer' : esc(p.state)}</span>
      </button>`).join(''));
    $('sb-farm-count').textContent = `${d.farm.length} printers · ${d.sandbox_count} added here (up to ${d.max_printers})`;
    $('sb-teardown').disabled = !d.sandbox_count;

    $('sb-clock').textContent = `+${clock(d.clock_s)}`;
    $('sb-scenario-name').textContent = d.scenario_name ? `${d.scenario_name} · ${d.pending} step(s) to go` : 'No scenario loaded';
    $('sb-play').textContent = d.running ? 'Pause' : 'Play';
    $('sb-play').setAttribute('aria-pressed', d.running);
    qsa('#sb-speed button').forEach(b => b.classList.toggle('active', +b.dataset.speed === d.speed));

    // Timeline: every step as a marker, the clock as a needle.
    const end = Math.max(600, ...d.steps.map(s => s.at_s)) * 1.08;
    $('sb-timeline').innerHTML = `
      <span class="sb-needle" style="left:${Math.min(100, (d.clock_s / end) * 100)}%"></span>
      ${d.steps.map(s => `<span class="sb-mark ${s.fired ? (s.outcome && s.outcome.ok ? 'ok' : 'bad') : ''}"
        style="left:${(s.at_s / end) * 100}%" title="${esc(clock(s.at_s))} ${esc(d.events[s.event])}"></span>`).join('')}`;
    $('sb-steps').innerHTML = d.steps.length ? d.steps.map(s => `
      <li class="${s.fired ? (s.outcome && s.outcome.ok ? 'ok' : 'bad') : 'pending'}">
        <span class="sb-at">+${clock(s.at_s)}</span>
        <span><b>${esc(d.events[s.event])}</b> · ${esc(d.targets[s.printer] || name(s.printer))}
          <small>${s.fired ? esc(s.outcome ? s.outcome.detail : '') : 'waiting'}</small></span>
      </li>`).join('') : '<li class="log-empty">Load a preset or build your own below.</li>';

    $('sb-log').innerHTML = d.log.length ? d.log.map(e => `
      <li class="${e.ok ? 'ok' : 'bad'}">
        <span class="fc-res-icon" aria-hidden="true">${e.ok ? '✓' : '✕'}</span>
        <span class="sb-at">+${clock(e.clock_s)}</span>
        <span><b>${esc(e.printer_name || 'Sandbox')}</b> · ${esc(e.label)}<small>${esc(e.detail)}</small></span>
      </li>`).join('') : '<li class="log-empty">Nothing has happened yet.</li>';

    if (first) {
      $('sb-presets').innerHTML = d.presets.map(p => `
        <div class="sb-preset">
          <b>${esc(p.name)}</b><p>${esc(p.about)}</p>
          <button class="btn small" type="button" data-preset="${esc(p.id)}">Load</button>
        </div>`).join('');
      qsa('[data-preset]', $('sb-presets')).forEach(b => b.addEventListener('click', () => sbPost('/api/sandbox/scenario', { preset: b.dataset.preset }, b, 'Loading…')));
      renderDraft();
    }
    const fe = $('sb-fire-event'), fp = $('sb-fire-printer');
    const keepE = fe.value || 'jam', keepP = fp.value || 'random-printing';
    if (document.activeElement !== fe) fe.innerHTML = eventOptions(keepE);
    if (document.activeElement !== fp) fp.innerHTML = targetOptions(keepP);
  }

  function paramFields(event, p = {}) {
    return (PARAMS[event] || []).map(k => ({
      toolhead: `<label>Toolhead <select data-p="toolhead"><option value="active">Active one</option>
        ${['T0', 'T1', 'T2', 'T3'].map(t => `<option ${p.toolhead === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`,
      hours: `<label>Hours <input type="number" data-p="hours" min="1" max="2000" value="${p.hours || 60}"></label>`,
      file: `<label>File <input type="text" data-p="file" value="${esc(p.file || 'calibration_cube_20mm.gcode')}"></label>`,
      accept: `<label class="sb-check"><input type="checkbox" data-p="accept_warnings" ${p.accept_warnings ? 'checked' : ''}> A person accepts its warnings</label>`,
    }[k])).join('');
  }

  function readParams(scope) {
    const out = {};
    qsa('[data-p]', scope).forEach(el => {
      if (el.type === 'checkbox') out[el.dataset.p] = el.checked;
      else if (el.type === 'number') out[el.dataset.p] = +el.value;
      else if (el.value) out[el.dataset.p] = el.value;
    });
    return out;
  }

  function renderDraft() {
    const host = $('sb-draft');
    host.innerHTML = sb.draft.map((s, i) => `
      <li class="sb-draft-row" data-i="${i}">
        <label>At <input type="number" min="0" max="10080" step="0.5" value="${s.at_s / 60}" data-f="at" aria-label="Minutes from the start"> min</label>
        <label class="sr-only" for="sb-d-ev-${i}">Event</label>
        <select id="sb-d-ev-${i}" data-f="event">${eventOptions(s.event)}</select>
        <label class="sr-only" for="sb-d-pr-${i}">Printer</label>
        <select id="sb-d-pr-${i}" data-f="printer">${targetOptions(s.printer)}</select>
        <span class="sb-params">${paramFields(s.event, s.params)}</span>
        <button class="btn small" type="button" data-f="remove" aria-label="Remove step ${i + 1}">✕</button>
      </li>`).join('') || '<li class="log-empty">No steps yet.</li>';
    $('sb-load-draft').disabled = !sb.draft.length;
  }

  function syncDraft() {
    sb.draft = qsa('.sb-draft-row', $('sb-draft')).map(row => ({
      at_s: Math.round(+qs('[data-f="at"]', row).value * 60),
      event: qs('[data-f="event"]', row).value,
      printer: qs('[data-f="printer"]', row).value,
      params: readParams(row),
    }));
  }

  async function sbPost(path, body, btn, label) {
    const r = await busy(btn, label || 'Working…', () => postJSON(api(path), body));
    if (!r.ok) { toast(r.body.error || `HTTP ${r.status}`, 'bad', 7000); return r; }
    if (r.body.farm) { sb.data = r.body; renderSandbox(false); }
    if (window.Workshop) Workshop.refreshPrinter();
    return r;
  }

  function initSandbox() {
    if (!$('tab-sandbox')) return;
    $('sb-farm-form').addEventListener('submit', (e) => {
      e.preventDefault();
      sbPost('/api/sandbox/farm', { count: +$('sb-count').value, busy_fraction: +$('sb-busy').value / 100 },
        e.submitter || qs('button[type="submit"]', e.target), 'Adding…')
        .then(r => { if (r.ok) toast(`Farm is now ${r.body.farm.length} printers — the Fleet tab shows them all`, 'ok'); });
    });
    $('sb-teardown').addEventListener('click', (e) => sbPost('/api/sandbox/teardown', {}, e.currentTarget, 'Removing…'));
    $('sb-reset').addEventListener('click', (e) => sbPost('/api/sandbox/reset', {}, e.currentTarget, 'Resetting…'));
    $('sb-play').addEventListener('click', (e) => sbPost('/api/sandbox/run', { running: !(sb.data && sb.data.running) }, e.currentTarget, '…'));
    qsa('#sb-speed [data-speed]').forEach(b => b.addEventListener('click', () => sbPost('/api/sandbox/speed', { speed: +b.dataset.speed })));
    qsa('[data-step]').forEach(b => b.addEventListener('click', () => sbPost('/api/sandbox/step', { seconds: +b.dataset.step }, b, 'Running…')));
    $('sb-fire-event').addEventListener('change', () => { $('sb-fire-params').innerHTML = paramFields($('sb-fire-event').value); });
    $('sb-fire').addEventListener('click', async (e) => {
      const r = await sbPost('/api/sandbox/fire', { event: $('sb-fire-event').value, printer: $('sb-fire-printer').value,
        params: readParams($('sb-fire-params')) }, e.currentTarget, 'Firing…');
      if (r.ok) r.body.outcomes.forEach(o => toast(`${o.printer_name || 'Sandbox'}: ${o.detail}`, o.ok ? 'ok' : 'warn', 6000));
    });
    $('sb-add-step').addEventListener('click', () => {
      syncDraft();
      const last = sb.draft[sb.draft.length - 1];
      sb.draft.push({ at_s: last ? last.at_s + 600 : 300, event: 'jam', printer: 'random-printing', params: {} });
      renderDraft();
    });
    $('sb-draft').addEventListener('change', (e) => {
      syncDraft();
      if (e.target.dataset.f === 'event') renderDraft();          // its parameters change with it
    });
    $('sb-draft').addEventListener('click', (e) => {
      if (e.target.dataset.f !== 'remove') return;
      syncDraft();
      sb.draft.splice(+e.target.closest('.sb-draft-row').dataset.i, 1);
      renderDraft();
    });
    $('sb-load-draft').addEventListener('click', (e) => { syncDraft(); sbPost('/api/sandbox/scenario', { steps: sb.draft }, e.currentTarget, 'Loading…'); });
    $('sb-floor').addEventListener('click', (e) => {
      const t = e.target.closest('[data-open-printer]');
      if (t && window.Workshop) Workshop.selectPrinter(t.dataset.openPrinter, t);
    });
  }

  /* ================================================================
   * 4. auto-print pipeline
   * ================================================================ */

  const ap = { settings: null, jobs: [], models: [], timer: null, enabled: false, seen: new Map() };

  async function loadAutoPrint() {
    const body = $('ap-body'), off = $('ap-off');
    if (!body) return;
    const data = await getJSON('/api/slicer/settings').catch(() => null);
    ap.enabled = !isModuleDisabled(data) && !!data;
    if (!ap.enabled) {
      body.hidden = true; off.hidden = false;
      off.innerHTML = `
        <div class="empty">
          <span class="empty-mark" aria-hidden="true"></span>
          <p class="empty-title">The auto-print pipeline is off</p>
          <p class="empty-sub">It slices STL and 3MF models with OrcaSlicer — a separate, free program you install yourself.
            Nothing is downloaded or installed by this dashboard. Turn it on to set it up.</p>
          <button class="btn primary" type="button" id="ap-enable">Turn on auto-print</button>
        </div>`;
      $('ap-enable').addEventListener('click', async (e) => {
        const r = await busy(e.currentTarget, 'Turning on…', () => postJSON('/api/modules/auto_print/toggle', { enabled: true }));
        if (r.ok) { toast('Auto-print is on — now point it at your OrcaSlicer', 'ok'); loadAutoPrint(); if (typeof loadModules === 'function') loadModules(); }
        else toast(`Couldn't turn it on: ${r.body.error}`, 'bad');
      });
      return;
    }
    body.hidden = false; off.hidden = true;
    ap.settings = data;
    renderSlicer();
    await Promise.all([loadModels(), loadJobs()]);
  }

  function renderSlicer() {
    const s = ap.settings, check = s.last_check;
    const status = $('ap-status');
    if (s.problem) status.innerHTML = `<p class="ap-state is-bad"><b>Not ready.</b> ${esc(s.problem)}</p>`;
    else if (check && check.ok) status.innerHTML = `<p class="ap-state is-ok"><b>Ready.</b> ${esc(check.detail)} <small>checked ${esc(check.checked_at.replace('T', ' '))}</small></p>`;
    else if (check) status.innerHTML = `<p class="ap-state is-bad"><b>The last check failed.</b> ${esc(check.error)}</p>`;
    else status.innerHTML = '<p class="ap-state"><b>Not checked yet.</b> Save the path, then press "Check slicer".</p>';
    if (document.activeElement !== $('ap-path')) $('ap-path').value = s.slicer_path || '';
    $('ap-path').disabled = s.path_source === 'environment';
    $('ap-path-note').textContent = s.path_source === 'environment'
      ? 'Set by DEJAVU_SLICER_PATH when the server was started - change it there.' : '';
    if (document.activeElement !== $('ap-timeout')) $('ap-timeout').value = s.timeout_s;
    $('ap-profiles').innerHTML = s.profiles.length ? s.profiles.map(p => `
      <li class="ap-profile">
        <label class="ap-default"><input type="radio" name="ap-default" value="${esc(p.id)}" ${p.id === s.default_profile ? 'checked' : ''}> Default</label>
        <span><b>${esc(p.name)}</b>
          <small>${esc(p.preset_names.machine)} · ${esc(p.preset_names.process)} · ${p.preset_names.filaments.map(esc).join(', ')}</small>
          ${(p.warnings || []).map(w => `<small class="ap-warn">${esc(w)}</small>`).join('')}</span>
        <button class="btn small" type="button" data-remove-profile="${esc(p.id)}">Remove</button>
      </li>`).join('') : '<li class="log-empty">No profiles yet. A profile is one machine, one process and one to four filament presets.</li>';
    qsa('[name="ap-default"]').forEach(r => r.addEventListener('change', () => apPost('/api/slicer/settings', { default_profile: r.value })));
    qsa('[data-remove-profile]').forEach(b => b.addEventListener('click', () => apPost(`/api/slicer/profiles/${enc(b.dataset.removeProfile)}/remove`, {}, b, 'Removing…')));
    const sel = $('ap-profile');
    sel.innerHTML = s.profiles.map(p => `<option value="${esc(p.id)}" ${p.id === s.default_profile ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
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
    const r = await busy(btn, 'Starting…', () => postJSON(queue ? api('/api/slicer/slice') : '/api/slicer/slice', body));
    if (!r.ok) { toast(`Couldn't start slicing: ${r.body.error || r.status}`, 'bad', 8000); return; }
    toast(`Slicing ${r.body.model}…`, 'info');
    await loadJobs();
  }

  async function loadJobs() {
    const data = await getJSON('/api/slicer/jobs').catch(() => null);
    if (!data || !data.jobs) return;
    ap.jobs = data.jobs;
    renderJobs();
    const active = ap.jobs.some(j => j.status === 'waiting' || j.status === 'running');
    if (active && !ap.timer) ap.timer = setInterval(loadJobs, 1000);
    if (!active && ap.timer) { clearInterval(ap.timer); ap.timer = null; }
  }

  function renderJobs() {
    const WORD = { waiting: 'Waiting', running: 'Slicing', done: 'Sliced', queued: 'Sliced & queued', failed: 'Failed' };
    $('ap-jobs').innerHTML = ap.jobs.length ? ap.jobs.map(j => {
      const rep = j.report || {}, files = rep.files || [];
      return `<li class="ap-job ${j.status}">
        <div class="ap-job-head"><b>${esc(j.model)}</b><span class="pill">${WORD[j.status]}</span></div>
        <p class="ap-job-step">${esc(j.error || j.step)}</p>
        ${files.map(f => `<p class="ap-job-file">→ <button class="chip-btn" type="button" data-open-file="${esc(f.name)}">${esc(f.name)}</button>
          ${f.layers} layers · ${Workshop.fmtHours(f.estimated_hours)} · ${f.filament_grams.toFixed(1)} g · pre-flight ${esc(f.preflight)}</p>`).join('')}
        <div class="fd-actions">
          ${files.length && j.previous ? `<button class="btn small" type="button" data-diff="${esc(j.previous)}|${esc(files[0].name)}">What changed since ${esc(j.previous)}?</button>` : ''}
          ${rep.command ? `<details class="ap-details"><summary>What ran${rep.seconds != null ? ` (${rep.seconds} s)` : ''}</summary>
            <code>${esc(rep.command.join(' '))}</code>
            ${rep.error_tail || rep.output_tail ? `<pre>${esc((rep.error_tail || rep.output_tail).slice(-600))}</pre>` : ''}</details>` : ''}
        </div>
      </li>`;
    }).join('') : '<li class="log-empty">Nothing sliced yet.</li>';
    qsa('#ap-jobs [data-open-file]').forEach(b => b.addEventListener('click', () => { showTab('files'); Workshop.openFile(b.dataset.openFile); }));
    qsa('#ap-jobs [data-diff]').forEach(b => b.addEventListener('click', () => { const [a, c] = b.dataset.diff.split('|'); Workshop.openDiff(a, c); }));
    // Say when a job finishes, once.
    ap.jobs.forEach(j => {
      const before = ap.seen.get(j.id);
      if (before && before !== j.status && ['done', 'queued', 'failed'].includes(j.status)) {
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
    slot.innerHTML = `<button class="btn" type="button" id="fd-slice">Slice…</button>`;
    $('fd-slice').addEventListener('click', () => {
      showTab('autoprint');
      setTimeout(() => { $('ap-model').value = entry.name; $('ap-model').focus(); }, 300);
    });
  }

  function initAutoPrint() {
    if (!$('tab-autoprint')) return;
    $('ap-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const body = { timeout_s: +$('ap-timeout').value };
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
    // Sandbox is part of the Fleet tab, Auto-print part of Files.
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
        toast(`Sandbox: ${ev.printer_name} — ${ev.detail}`, ev.ok ? 'info' : 'warn', 5000);
      }
    });
    getJSON('/api/slicer/settings').then(d => { ap.enabled = !!d && !isModuleDisabled(d); }).catch(() => {});
    onTab(store.get('dejavu1.tab') || 'overview');
  }

  init();
  return { loadHistory, loadSandbox, loadAutoPrint, broadcast, state: { cmd, hist, sb, ap } };
})();

window.Farm = Farm;
