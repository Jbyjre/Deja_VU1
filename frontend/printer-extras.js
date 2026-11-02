/* Printer page, part two: what a printer's own web page shows beyond moving and heating.
 *
 *  - a temperature chart for every heater and sensor (the last 20 minutes: a real
 *    printer's Moonraker keeps one reading a second; otherwise the chart fills from
 *    the live readings this page sees)
 *  - the bed mesh as a coloured map, with the printer's saved meshes to load or clear
 *  - fans the printer lets you set, its lights, its filament runout sensors, its
 *    output pins (shown, not switched), an endstop check and Snapmaker's automatic
 *    feeding, which the printer's own AUTO_FEEDING macro wires to the right feeder
 *  - settings for the printer's macros, read from each macro's own text
 *  - the printer's own command list (HELP) in the console suggestions
 *  - a file to print, with its preview and Confirm Print, without leaving the page
 *
 * Every reading comes from /api/printer/* (backend/printer_extras.py) and every
 * button goes through runCommand, so a refusal is shown in the printer's words.
 */
'use strict';
window.PrinterExtras = (() => {
  const KEEP_S = 1200;                  // 20 minutes at one reading a second, as Moonraker keeps
  const LINE = { T0: 'oklch(62% 0.17 45)', T1: 'oklch(55% 0.16 255)', T2: 'oklch(58% 0.15 150)',
    T3: 'oklch(56% 0.18 330)', Bed: 'oklch(40% 0.02 265)' };
  const OTHER = ['oklch(60% 0.12 200)', 'oklch(55% 0.12 90)', 'oklch(50% 0.1 20)'];
  let state = null, printerId = null;
  let history = {};                     // label -> { t: [...], target: [...] }, newest last
  let lastSample = 0, chartRange = 10;  // minutes shown
  let macroInfo = {}, helpList = null, feeding = null, mesh = null;

  const busy = s => s && (s.state === 'printing' || s.state === 'paused');
  const canDrive = s => s && s.state && !s.link_lost;
  const pct = v => v == null ? '—' : `${Math.round(v * 100)}%`;
  const read = path => getJSON(api(path)).catch(() => null);
  const live = body => body && !body.error && !body.module_disabled && (body.connected !== false || body.demo);

  /* ---------- temperature chart ---------- */
  function heaters(s) {
    const out = [];
    Object.entries((s && s.toolheads) || {}).forEach(([th, h]) => out.push([th, h.temperature, h.target]));
    if (s && s.bed_temperature != null) out.push(['Bed', s.bed_temperature, s.bed_target]);
    if (s && s.chamber_temperature != null) out.push(['Chamber', s.chamber_temperature, null]);
    ((s && s.tuning && s.tuning.sensors) || []).forEach(x => out.push([x.name, x.temperature, null]));
    return out;
  }
  function sample(s) {
    const now = Date.now();
    if (now - lastSample < 1000) return;
    // Fill a gap (a hidden tab, a slow link) with "no reading", so the line breaks instead of lying.
    const missed = lastSample ? Math.min(KEEP_S, Math.floor((now - lastSample) / 1000) - 1) : 0;
    lastSample = now;
    heaters(s).forEach(([label, t, target]) => {
      const h = history[label] || (history[label] = { t: [], target: [] });
      for (let i = 0; i < missed; i++) { h.t.push(null); h.target.push(null); }
      h.t.push(t == null ? null : Math.round(t * 10) / 10);
      h.target.push(target == null ? null : target);
      if (h.t.length > KEEP_S) { h.t.splice(0, h.t.length - KEEP_S); h.target.splice(0, h.target.length - KEEP_S); }
    });
  }
  async function backfill() {
    const body = await read('/api/printer/temperatures');
    if (!live(body) || !(body.series || []).length) return;
    const fresh = {};
    body.series.forEach(s => { fresh[s.label] = { t: s.temperatures.slice(-KEEP_S), target: (s.targets || s.temperatures.map(() => null)).slice(-KEEP_S) }; });
    // The printer's own store reaches back further than this page has been open, so it replaces what the page took.
    history = fresh;
    lastSample = Date.now();
    drawChart();
  }
  function colour(label, i) { return LINE[label] || OTHER[i % OTHER.length]; }
  function drawChart() {
    const host = $('pp-chart');
    if (!host || host.offsetParent === null) return;
    const span = chartRange * 60;
    const labels = Object.keys(history).filter(l => history[l].t.some(v => v != null));
    if (!labels.length) { host.querySelector('.tc-plot').innerHTML = '<p class="log-empty">The chart starts with the next reading.</p>'; return; }
    const W = Math.max(280, Math.round(host.querySelector('.tc-plot').clientWidth || 600)), H = W < 500 ? 140 : 170, padL = 36, padB = 22;
    let hi = 40, lo = 1e9;
    labels.forEach(l => history[l].t.slice(-span).concat(history[l].target.slice(-span)).forEach(v => { if (v != null && v > 0) { hi = Math.max(hi, v); lo = Math.min(lo, v); } }));
    lo = Math.max(0, Math.floor(Math.min(lo, 20) / 10) * 10);
    hi = Math.ceil((hi + 5) / 25) * 25;
    const x = i => padL + (W - padL - 4) * (i / (span - 1));
    const y = v => 4 + (H - padB - 4) * (1 - (v - lo) / (hi - lo));
    const path = arr => {
      const tail = arr.slice(-span), off = span - tail.length;
      let d = '', pen = false;
      tail.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${x(i + off).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      return d;
    };
    const ticks = [];
    for (let v = lo; v <= hi; v += (hi - lo) > 150 ? 50 : 25) ticks.push(v);
    const grid = ticks.map(v => `<line x1="${padL}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" class="tc-grid"/><text x="${padL - 6}" y="${y(v) + 3}" class="tc-tick" text-anchor="end">${esc(formatTemp(v).replace(/°[CF]/, '°'))}</text>`).join('');
    const mins = [];
    const every = chartRange > 10 ? 5 : W < 500 && chartRange > 5 ? 5 : chartRange > 5 ? 2 : 1;
    for (let m = chartRange; m >= 0; m -= every) mins.push(m);
    const xt = mins.map(m => `<text x="${x(span - 1 - m * 60)}" y="${H - 4}" class="tc-tick" text-anchor="${m === chartRange ? 'start' : m ? 'middle' : 'end'}">${m ? `−${m} min` : 'now'}</text>`).join('');
    const lines = labels.map((l, i) => {
      const h = history[l], c = colour(l, i);
      const target = h.target.some(v => v) ? `<path d="${path(h.target.map(v => v || null))}" class="tc-target" style="stroke:${c}"/>` : '';
      return `${target}<path d="${path(h.t)}" class="tc-line" style="stroke:${c}"><title>${esc(l)}</title></path>`;
    }).join('');
    host.querySelector('.tc-plot').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Temperatures over the last ${chartRange} minutes">${grid}${xt}${lines}</svg>`;
    const key = labels.map((l, i) => {
      const h = history[l], now = [...h.t].reverse().find(v => v != null), tg = h.target[h.target.length - 1];
      return `<span class="tc-key"><i style="background:${colour(l, i)}"></i>${esc(l)} <b>${now == null ? '—' : esc(formatTemp(now))}</b>${tg ? `<span class="tc-to">→ ${esc(formatTemp(tg))}</span>` : ''}</span>`;
    }).join('');
    const legend = host.querySelector('.tc-legend');
    if (legend.dataset.html !== key) { legend.innerHTML = key; legend.dataset.html = key; }
  }
  function buildChart() {
    const host = $('pp-chart');
    if (!host || host.dataset.built) return;
    host.dataset.built = '1';
    host.innerHTML = `<div class="tc-head"><span class="mc-label">Last minutes</span>
      <div class="seg tc-range" role="radiogroup" aria-label="How far back">${[5, 10, 20].map(m => `<button type="button" role="radio" class="pchip" data-range="${m}" aria-checked="${m === chartRange}">${m} min</button>`).join('')}</div></div>
      <div class="tc-plot"></div><div class="tc-legend"></div>
      <p class="field-hint">Solid lines are the temperature, dashed lines the target.</p>`;
    host.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
      chartRange = Number(b.dataset.range);
      host.querySelectorAll('[data-range]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
      drawChart();
    }));
  }

  /* ---------- bed mesh ---------- */
  function meshColour(v, lo, hi) {
    // Blue below the middle, warm above it, pale at the middle: the same idea as a contour map.
    const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1, k = Math.max(-1, Math.min(1, v / m));
    return k < 0 ? `oklch(${(92 + 30 * k).toFixed(0)}% ${(0.13 * -k).toFixed(3)} 250)` : `oklch(${(92 - 26 * k).toFixed(0)}% ${(0.15 * k).toFixed(3)} 45)`;
  }
  function drawMesh() {
    const host = $('pp-mesh-body');
    if (!host) return;
    const s = state, t = (s && s.tuning) || {};
    if (!canDrive(s)) { host.innerHTML = '<p class="log-empty">Waiting for the printer.</p>'; return; }
    if (t.bed_mesh === false || (mesh && mesh.none)) { host.innerHTML = `<p class="field-hint">${esc((mesh && mesh.none) || 'This printer has no bed mesh set up in its configuration.')}</p>`; return; }
    const m = mesh || {};
    const off = busy(s) ? 'disabled' : '';
    let map = '<p class="field-hint">No mesh loaded. Probe the bed, or load one the printer saved.</p>';
    if (m.probed) {
      const rows = m.probed.length, cols = m.probed[0].length;
      // Row 0 is the front of the bed (Y at mesh_min): drawn at the bottom, as you see the bed from the front.
      const cells = m.probed.map((row, r) => row.map((v, c) => `<rect x="${c}" y="${rows - 1 - r}" width="1" height="1" fill="${meshColour(v, m.lowest, m.highest)}"><title>${v.toFixed(3)} mm</title></rect>`).join('')).join('');
      const lo = m.mesh_min || [0, 0], hi = m.mesh_max || [0, 0];
      map = `<div class="mesh-map"><svg viewBox="0 0 ${cols} ${rows}" preserveAspectRatio="none" role="img" aria-label="Bed mesh, ${rows} by ${cols} points, ${m.range.toFixed(3)} mm from lowest to highest">${cells}</svg>
        <span class="mesh-axis mesh-front">Front</span></div>
        <div class="mesh-scale"><span>${m.lowest.toFixed(3)} mm</span><i style="background:linear-gradient(90deg, ${meshColour(m.lowest, m.lowest, m.highest)}, ${meshColour(0, m.lowest, m.highest)}, ${meshColour(m.highest, m.lowest, m.highest)})"></i><span>+${m.highest.toFixed(3)} mm</span></div>
        <p class="mesh-facts"><b>${m.range.toFixed(3)} mm</b> from the lowest to the highest point · ${rows} × ${cols} points · X ${lo[0]} to ${hi[0]}, Y ${lo[1]} to ${hi[1]} mm</p>`;
    }
    const profiles = m.profiles || [];
    host.innerHTML = `${m.demo && m.probed ? '<p class="demo-note">Demo mesh</p>' : ''}${map}
      <div class="mesh-actions">
        <button type="button" class="btn" data-mesh="probe" ${off}>Probe the bed</button>
        ${profiles.length ? `<label class="sr-only" for="pp-mesh-pick">Saved mesh</label><select id="pp-mesh-pick" ${off}>${profiles.map(p => `<option ${p === m.profile ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
          <button type="button" class="btn small" data-mesh="load" ${off}>Load</button>` : ''}
        ${m.profile ? `<button type="button" class="btn small" data-mesh="clear" ${off}>Stop using it</button>` : ''}
      </div>
      <p class="field-hint">${m.profile ? `In use: <b>${esc(m.profile)}</b>.` : 'No mesh in use.'}${busy(s) ? ' Changing the mesh waits until the print ends.' : ''}</p>`;
    host.querySelectorAll('[data-mesh]').forEach(b => b.addEventListener('click', async () => {
      const act = b.dataset.mesh;
      let out;
      if (act === 'probe') {
        if (!confirm('Probe the bed now? The printer homes if it needs to, then touches the bed at many points. Keep the bed clear.')) return;
        out = await runCommand(b, '/api/printer/control/bed-mesh', {}, { sending: 'Probing…', done: 'Bed mesh done', failed: 'Refused' });
      } else {
        out = await runCommand(b, '/api/printer/control/mesh-profile', { action: act, profile: act === 'load' ? $('pp-mesh-pick').value : undefined },
          { sending: act === 'load' ? 'Loading…' : 'Clearing…', done: act === 'load' ? 'Mesh loaded' : 'Mesh cleared', failed: 'Refused' });
      }
      if (out.ok) loadMesh();
    }));
  }
  async function loadMesh() {
    const body = await read('/api/printer/mesh');
    mesh = live(body) ? body : null;
    drawMesh();
  }

  /* ---------- fans, lights, sensors, endstops, feeding ---------- */
  function drawOutputs() {
    const host = $('pp-outputs-body');
    if (!host) return;
    const s = state, t = (s && s.tuning) || {};
    if (!canDrive(s)) { host.innerHTML = '<p class="log-empty">Waiting for the printer.</p>'; delete host.dataset.sig; return; }
    const sig = JSON.stringify([t.fans, t.leds, t.pins, t.runout, t.feeder, feeding, busy(s)]);
    if (host.dataset.sig === sig || host.contains(document.activeElement) && document.activeElement.type === 'range') return;
    host.dataset.sig = sig;
    const fans = t.fans || [], leds = t.leds || [], pins = t.pins || [], runout = t.runout || [];
    const rangeRow = (kind, id, label, value) => `<div class="tn-row"><label for="px-${kind}-${esc(id)}">${esc(label)}</label>
      <input type="range" id="px-${kind}-${esc(id)}" min="0" max="100" step="5" value="${Math.round((value || 0) * 100)}" data-${kind}="${esc(id)}">
      <output>${Math.round((value || 0) * 100)}</output><span class="tn-unit">%</span></div>`;
    const set = fans.filter(f => f.settable), auto = fans.filter(f => !f.settable && f.speed != null);
    const feed = feeding && feeding.heads && feeding.heads.length ? feeding : null;
    host.innerHTML = `
      ${set.length || leds.length ? `<p class="mc-label">Fans and lights</p>${set.map(f => rangeRow('fan', f.id, f.name, f.speed)).join('')}${leds.map(l => rangeRow('led', l.id, l.name, l.color ? Math.max(...l.color) : 0)).join('')}` : ''}
      ${auto.length ? `<p class="field-hint">Running by themselves: ${auto.map(f => `${esc(f.name)} ${pct(f.speed)}`).join(' · ')}</p>` : ''}
      ${runout.length ? `<p class="mc-label">Filament sensors</p><div class="px-sensors">${runout.map(r => `
        <label class="px-sensor"><input type="checkbox" data-runout="${esc(r.id)}" ${r.enabled ? 'checked' : ''}>
          <span>${esc(r.name)}<b class="${r.detected ? 'is-ok' : r.detected === false ? 'is-warn' : ''}">${r.detected ? 'Filament in' : r.detected === false ? 'No filament' : 'Not reported'}</b></span></label>`).join('')}</div>
        <p class="field-hint">A ticked sensor pauses the print when its filament runs out.</p>` : ''}
      ${pins.length ? `<p class="field-hint">The printer's switches: ${pins.map(p => `${esc(p.name)} ${p.value == null ? '—' : p.value >= 1 ? 'on' : p.value <= 0 ? 'off' : pct(p.value)}`).join(' · ')}</p>` : ''}
      ${feed ? `<p class="mc-label">Automatic feeding${feed.demo ? ' (demo)' : ''}</p><div class="mc-list">${feed.heads.map(h => `<button type="button" class="pchip" data-feed="${esc(h.head)}" ${busy(s) ? 'disabled' : ''} title="Runs the printer's ${esc(feed.macro)} macro for ${esc(h.head)}">Feed ${esc(h.head)} <small>${esc(h.module)} feeder, channel ${esc(h.channel)}</small></button>`).join('')}</div>` : ''}
      <p class="mc-label">Endstops</p>
      <div class="px-endstops"><button type="button" class="btn small" id="px-endstops">Check endstops</button><span id="px-endstops-out" class="field-hint"></span></div>
      ${!set.length && !leds.length && !runout.length && !auto.length ? '<p class="field-hint">This printer lists no other fans, lights or filament sensors.</p>' : ''}`;
    host.querySelectorAll('input[type=range]').forEach(r => {
      r.addEventListener('input', () => { r.nextElementSibling.textContent = r.value; });
      r.addEventListener('change', () => {
        const v = Number(r.value), label = r.closest('.tn-row').querySelector('label').textContent;
        if (r.dataset.fan) runCommand(null, '/api/printer/control/fan-generic', { name: r.dataset.fan, percent: v }, { sending: '', done: `${label} set to ${v}%`, failed: 'Refused' });
        // White light at that brightness: every channel the same, so a white-only and a colour light both glow white.
        else runCommand(null, '/api/printer/control/led', { name: r.dataset.led, red: v / 100, green: v / 100, blue: v / 100, white: v / 100 }, { sending: '', done: `${label} set to ${v}%`, failed: 'Refused' });
      });
    });
    host.querySelectorAll('[data-runout]').forEach(c => c.addEventListener('change', () => {
      runCommand(null, '/api/printer/control/runout', { name: c.dataset.runout, enabled: c.checked },
        { sending: '', done: `${c.dataset.runout} ${c.checked ? 'on' : 'off'}`, failed: 'Refused' });
    }));
    host.querySelectorAll('[data-feed]').forEach(b => b.addEventListener('click', () => {
      if (!confirm(`Feed filament into ${b.dataset.feed}? The printer heats that head and pulls filament from its feeder.`)) return;
      runCommand(b, '/api/printer/control/feed', { toolhead: b.dataset.feed }, { sending: 'Feeding…', done: `${b.dataset.feed} fed`, failed: 'Feeding refused' });
    }));
    $('px-endstops').addEventListener('click', async e => {
      const b = e.currentTarget;
      b.disabled = true;
      const body = await read('/api/printer/endstops');
      b.disabled = false;
      const out = $('px-endstops-out');
      if (!live(body)) { out.textContent = (body && body.error) || 'The printer didn\'t answer.'; return; }
      out.innerHTML = (body.endstops || []).map(x => `<span class="px-es ${x.triggered ? 'is-hit' : ''}">${esc(x.name)}: ${x.triggered ? 'pressed' : 'open'}</span>`).join(' ') + (body.demo ? ' <span class="demo-note">demo</span>' : '');
    });
  }
  async function loadFeeding() {
    const t = (state && state.tuning) || {};
    if (!t.feeder) { feeding = null; return; }
    const body = await read('/api/printer/feeding');
    feeding = live(body) ? body : null;
    drawOutputs();
  }

  /* ---------- macro settings ---------- */
  async function loadMacros() {
    const body = await read('/api/printer/macros');
    macroInfo = {};
    if (live(body)) (body.macros || []).forEach(m => { macroInfo[m.name] = m; });
    markMacros();
  }
  function markMacros() {
    document.querySelectorAll('#pp-macros-body [data-macro]').forEach(b => {
      const m = macroInfo[b.dataset.macro];
      b.classList.toggle('has-params', Boolean(m && m.params.length));
      if (m && m.description) b.title = m.description;
    });
  }
  // Called by printer-page.js for a macro button: settings first when the macro reads any.
  function macroClicked(button) {
    const name = button.dataset.macro, info = macroInfo[name];
    const host = $('pp-macros-body');
    const old = host.querySelector('.macro-form');
    if (old) { const same = old.dataset.macro === name; old.remove(); if (same) return true; }
    if (!info || !info.params.length) return false;
    const form = document.createElement('form');
    form.className = 'macro-form';
    form.dataset.macro = name;
    form.innerHTML = `<p class="mc-label">${esc(name.replace(/_/g, ' ').toLowerCase())}</p>
      ${info.description ? `<p class="field-hint">${esc(info.description)}</p>` : ''}
      <div class="macro-fields">${info.params.map(p => `<label>${esc(p.name.replace(/_/g, ' ').toLowerCase())}
        <input type="text" name="${esc(p.name)}" placeholder="${esc(p.default == null ? '' : p.default)}" autocomplete="off" spellcheck="false" pattern="[A-Za-z0-9_.:#+\\-]{1,64}"></label>`).join('')}</div>
      <p class="field-hint">Leave a box empty to use the macro's own default (shown faintly).</p>
      <div class="mc-main"><button class="btn primary small" type="submit">Run ${esc(name.replace(/_/g, ' ').toLowerCase())}</button><button class="btn small" type="button" data-cancel>Close</button></div>`;
    button.closest('.mc-list').after(form);
    form.querySelector('[data-cancel]').onclick = () => form.remove();
    form.addEventListener('submit', e => {
      e.preventDefault();
      const params = {};
      form.querySelectorAll('input').forEach(i => { if (i.value.trim()) params[i.name] = i.value.trim(); });
      if (busy(state) && !confirm(`Run ${name} while the printer is printing?`)) return;
      runCommand(form.querySelector('[type=submit]'), '/api/printer/control/macro', { name, params },
        { sending: 'Running…', done: `${name} ran`, failed: `${name} refused` });
    });
    form.querySelector('input').focus();
    return true;
  }

  /* ---------- the printer's own command list, for the console ---------- */
  async function loadHelp() {
    const body = await read('/api/printer/gcode-help');
    helpList = live(body) ? body.commands || {} : null;
    if (typeof gcodeSuggestions === 'function') gcodeSuggestions(state);
  }
  const helpHints = () => Object.entries(helpList || {}).slice(0, 300);

  /* ---------- print a file from this page ---------- */
  async function drawPrint() {
    const host = $('pp-print-body');
    if (!host) return;
    const data = await read('/api/files');
    const list = ((data && data.files) || []).filter(f => /\.gcode$/i.test(f.name)).slice(0, 6);
    const off = !canDrive(state) || busy(state) ? 'disabled' : '';
    host.innerHTML = `
      <div class="pf-upload"><label class="btn" for="pp-print-file">Choose a G-code file…</label>
        <input type="file" id="pp-print-file" accept=".gcode,.gco,.g" hidden>
        <span class="field-hint">It goes into your file library, then Confirm Print checks it against this printer.</span></div>
      ${list.length ? `<ul class="pf-list">${list.map(f => `<li><span class="pf-name">${esc(f.name)}</span>
        <button type="button" class="btn small" data-preview="${esc(f.name)}">Preview</button>
        <button type="button" class="btn small primary" data-print="${esc(f.name)}" ${off}>Print…</button></li>`).join('')}</ul>`
        : '<p class="field-hint">No G-code files in your library yet.</p>'}
      ${busy(state) ? '<p class="field-hint">Printing waits until this print ends.</p>' : ''}`;
    host.querySelectorAll('[data-preview]').forEach(b => b.addEventListener('click', () => Workshop.openFile(b.dataset.preview, b)));
    host.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => Workshop.openConfirm(b.dataset.print, b)));
    $('pp-print-file').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (typeof tourOn === 'function' && tourOn()) { toast('The online demo prints the sample files only. Run Deja Vu1 at home to print your own.', 'warn'); return; }
      const res = await fetch(`/api/files/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast(`Couldn't add ${file.name}: ${body.error || res.status}`, 'bad', 7000); return; }
      toast(`Added ${body.name}`, 'ok');
      Workshop.loadFiles();
      await drawPrint();
      Workshop.openConfirm(body.name, host);
    });
  }

  /* ---------- wiring ---------- */
  function onState(s) {
    const prev = state;
    state = s;
    const t = (s && s.tuning) || {}, pt = (prev && prev.tuning) || {};
    const changed = Boolean(s) && (!prev || prev.printer_id !== s.printer_id);
    if (s) sample(s);
    if (changed && s) {
      printerId = s.printer_id;
      history = {};
      lastSample = 0;
      macroInfo = {}; helpList = null; feeding = null; mesh = null;
      if (canDrive(s)) { backfill(); loadMacros(); loadHelp(); loadMesh(); loadFeeding(); drawPrint(); }
    } else if (s) {
      if (JSON.stringify(t.macros) !== JSON.stringify(pt.macros)) loadMacros();
      if (t.mesh_profile !== pt.mesh_profile) loadMesh();
      if (t.feeder !== pt.feeder) loadFeeding();
      if (busy(s) !== busy(prev) || canDrive(s) !== canDrive(prev)) { drawPrint(); drawMesh(); }
    }
    drawChart();
    drawOutputs();
    if (!mesh) drawMesh();
    markMacros();
  }
  function init() {
    buildChart();
    window.addEventListener('dv-state', e => drawSafely('The printer page extras', () => onState(e.detail)));
    window.addEventListener('dv-section', () => setTimeout(drawChart, 0));
    window.addEventListener('dv-tab', () => setTimeout(drawChart, 0));
    window.addEventListener('resize', () => drawChart());
    drawMesh();
    drawOutputs();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  return { macroClicked, loadMacros, helpHints, get printer() { return printerId; } };
})();
