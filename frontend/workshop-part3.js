/* workshop-part3.js: part 3 of 5 of workshop.js, the live connection, fleet, files, automations and Liquid Glass
 * 2.0. Split out of the one closure workshop.js was (18 November 2026) so a session reads only the part it needs.
 * Loaded before workshop.js, after workshop-part2.js; it hands its names on through WorkshopPart3. Holds: ACTIONS,
 * DEVICE_KEY, HEAD_COUNT, PRESETS, PRESSABLE, SPRING, TRIGGERS, aiOn, cam, closeFile, closeMenu, closePeer,
 * conversionReport, currentTab, deviceId, deviceName, flipbookVideo, gmenu, initBlobResize, initCameraForm,
 * initDemoTools, initDockStack, initGlassMenu, initHoldToCancel, initPressGlow, initScrollEdge, initSwap, lerp,
 * loadCamera, loadForecast, loadPrinterVideos, loadRuleLog, loadSideBySide, localLines, morph, moveTabBlob,
 * openMenu, placeBlob, plateSummary, playWebRTC, pulseRefraction, renderGate, renderQuickActions, reportView,
 * sensorLine, sentence, setCamMode, showMjpeg, springCurve, startCamera, stopCamera, streamProblem, syncNav,
 * tlForget, tlKeep, tlReset, watchCamera, within
 */
'use strict';
const WorkshopPart3 = (() => {
  const { REDUCED, empty, enc, fmtHours, money, printerName, qs, qsa, since } = WorkshopPart1;
  const { ar, files, loadHealth } = WorkshopPart2;

function closeFile() {
    if (ar.handle) ar.handle.end();
    $('file-detail').hidden = true;
    files.open = null;
    if (files.viewer) { files.viewer.dispose(); files.viewer = null; }
    reportView();
  }

  /* A plain-text report of one conversion, to paste into a bug report. */
function conversionReport(name, r) {
    const b = r.body || {};
    const lines = ['Deja Vu1 - conversion report', `When: ${new Date().toISOString()}`, `File: ${name}`,
                   `Browser: ${navigator.userAgent}`];
    if (!r.ok) {
      lines.push(`Result: failed`, `Code: ${b.code || 'none'}`, `Stage: ${b.stage || 'unknown'}`,
                 `Message: ${b.error || `HTTP ${r.status}`}`);
      if (b.action) lines.push(`Suggested: ${b.action}`);
    } else {
      const rep = b.report;
      lines.push('Result: converted', `Saved as: ${b.file.name}`, `Source: ${rep.source_label} (${rep.application || 'no application name'})`,
                 `Original printer: ${rep.original_printer}`, `Printer profile: ${rep.printer_profile}`,
                 `Print profile: ${rep.print_profile} (layer height ${rep.layer_height})`,
                 `Filament profiles: ${rep.filament_profiles.join(', ')}`,
                 `Kept settings: ${rep.kept.join(', ') || 'none'}`);
      if (rep.plates) lines.push(`Plates: ${rep.plates.count}, moved ${rep.plates.moved.join(', ') || 'none'}, left as they were ${rep.plates.skipped.join(', ') || 'none'}`);
      rep.warnings.forEach(w => lines.push(`Warning: ${w}`));
      (rep.removed_parts || []).forEach(p => lines.push(`Removed: ${p}`));
    }
    return lines.join('\n');
  }

function plateSummary(plates) {
    if (!plates || !plates.count) return '';
    if (!plates.moved.length) return '';
    const n = plates.count;
    return `<p>${n === 1 ? 'The plate was' : `All ${n} plates were`}${plates.skipped.length ? ` (except ${plates.skipped.map(esc).join(', ')})` : ''}
      re-placed on the U1's 270 mm bed, each object keeping its spot, height and turn${n > 1 ? ' - so every plate opens where it belongs in Snapmaker Orca' : ''}.</p>`;
  }

  /* Colours on the heads: which of the project's filaments the model uses,
   * and which of the U1's four heads prints each one. The server suggests
   * a plan (alike colours share a head, unused ones are dropped, or each
   * colour goes to the closest loaded head); the person can change any row.
   * Convert and "Save a copy" both use the plan shown. */
const HEAD_COUNT = 4;

  // The same answer as the server's gcode_tools.view_lines, for a local file.
function localLines(entry, offset, q) {
    const lines = entry.localLines || [];
    if (q) {
      const needle = q.toLowerCase(), hits = [];
      lines.forEach((l, i) => { if (l.toLowerCase().includes(needle)) hits.push(i); });
      return { total: lines.length, matches: hits.length, lines: hits.slice(0, 200).map(i => ({ n: i + 1, text: lines[i] })) };
    }
    return { total: lines.length, offset, lines: lines.slice(offset, offset + 200).map((text, i) => ({ n: offset + i + 1, text })) };
  }

  /* What the colour sensor reads, apart from the file's colour and the printer's report. Advice only. */
function sensorLine(m) {
    const chip = /^#[0-9a-f]{6}$/i.test(m.hex || '')
      ? `<span class="chip" style="background:${esc(m.hex)}" title="What the colour sensor reads"></span>` : '';
    const against = { match: 'matches the file', close: 'close to the file', mismatch: 'far from the file' }[m.versus_file];
    const words = m.hex
      ? `Colour sensor reads ${esc(m.hex)}${m.simulated ? ' (simulated)' : ''}${against ? `, ${against}` : ''}`
      : 'Colour sensor: no current colour';
    return `<span class="gf-sensor">${chip}<span>${words}</span></span>`;
  }

/* A print that ended on this bed may still be there. A small map of the plate shows where it sat (the sliced file's own extent, known only
   while that file is still in the library) against where this print goes, and the tick below it is what the start waits for. */
function bedBlock(b) {
    const W = 270, box = (v, cls) => v ? `<rect class="${cls}" x="${v[0].toFixed(1)}" y="${(W - v[3]).toFixed(1)}" width="${(v[2] - v[0]).toFixed(1)}" height="${(v[3] - v[1]).toFixed(1)}" rx="2"></rect>` : '';
    const l = b.leftover_box, name = b.file || 'the last print';
    const where = l ? `${name} sat at X ${Math.round(l[0])} to ${Math.round(l[2])} mm, Y ${Math.round(l[1])} to ${Math.round(l[3])} mm${b.overlaps ? '. This print overlaps it.' : '.'}`
      : `Where ${name} sat isn't known: its file is no longer in your library.`;
    const map = l || b.this_box ? `<svg class="gate-bed-map" viewBox="0 0 ${W} ${W}" role="img" aria-label="${esc(where)}"><rect class="plate" x="0" y="0" width="${W}" height="${W}" rx="6"></rect>${box(l, 'left')}${box(b.this_box, 'this')}</svg>` : '';
    return `<div class="gate-bed">${map}<div class="gate-bed-text"><p>${esc(where)}</p>${l && b.this_box ? '<p class="field-hint">Dashed: where it sat. Solid: where this print goes.</p>' : ''}
      <label class="gate-bed-tick"><input type="checkbox" id="confirm-bed-clear"> <span>I looked at the bed and it is clear</span></label></div></div>`;
  }

function renderGate(gate) {
    const go = $('confirm-go');
    const panel = qs('#confirm-dialog .dialog-panel');
    if (gate.error) { $('confirm-body').innerHTML = `<p class="log-empty">${esc(gate.error)}</p>`; go.disabled = true; return; }
    const tint = { blocked: '#ff3b30', confirm: '#ffcc00', clear: '#34c759' }[gate.verdict];
    panel.style.setProperty('--glass-tint', tint);
    const banner = { blocked: 'This print can\'t start', confirm: 'Read these before starting', clear: 'Everything checks out' }[gate.verdict];
    go.disabled = gate.verdict === 'blocked';
    go.textContent = gate.verdict === 'confirm' ? 'I\'ve read these, start print' : 'Start print';
    $('confirm-health').innerHTML = `<span class="gm-num">${gate.health.score}</span><span class="gm-lbl">health</span>`;
    $('confirm-health').style.setProperty('--gm', { good: 'var(--ok)', fair: 'var(--warn)', poor: 'var(--bad)', blocked: 'var(--bad)' }[gate.health.band]);
    $('confirm-health').title = gate.health.band === 'blocked' ? 'Health is held below fair while this print can\'t start' : '';
    const fil = gate.filament.map(f => `
      <div class="gate-fil ${f.status}${f.material_mismatch ? ' mismatch' : ''}">
        <span class="gf-th">${esc(f.toolhead)}</span>
        <span class="chip" style="background:${esc(f.expected_hex || '#ccc')}" title="File expects"></span>
        <span class="arrow" aria-hidden="true">→</span>
        <span class="chip" style="background:${esc(f.loaded_hex || 'transparent')}" title="Loaded"></span>
        <span class="gf-text">${esc(f.loaded_name || 'nothing loaded')} ${f.material_mismatch ? `· ${esc(f.loaded_material || '')} loaded, the file needs ${esc(f.expected_material)}` : f.expected_material ? `· ${esc(f.expected_material)}` : ''}</span>
        <span class="gf-status">${f.material_mismatch ? 'Wrong material' : ({ match: 'Match', close: 'Close', mismatch: 'Wrong colour', not_loaded: 'Not loaded', missing_toolhead: 'No such toolhead', no_colour_in_file: 'No colour in file', unknown: 'Not reported', unknown_colour: 'Colour not reported' }[f.status] || esc(f.status))}</span>
        ${f.measured ? sensorLine(f.measured) : ''}
      </div>`).join('');
    $('confirm-body').innerHTML = `
      <div class="gate-banner ${gate.verdict}">${banner}</div>
      ${gate.blocking.length ? `<ul class="pf-list">${gate.blocking.map(b => `<li class="pf-error">${esc(b)}</li>`).join('')}</ul>` : ''}
      ${(gate.fixes || []).length ? `<div class="gate-fixes" role="group" aria-label="Ways to fix this">${gate.fixes.map(f => `<button class="btn small" type="button" data-fix="${esc(f.kind)}"${f.model ? ` data-fix-model="${esc(f.model)}"` : ''}>${esc(f.label)}</button>`).join('')}</div>` : ''}
      ${gate.warnings.length ? `<ul class="pf-list">${gate.warnings.map(w => `<li class="pf-warning">${esc(w)}</li>`).join('')}</ul>` : ''}
      ${gate.info.length ? `<ul class="pf-list">${gate.info.map(w => `<li class="pf-info">${esc(w)}</li>`).join('')}</ul>` : ''}
      ${gate.bed_check ? bedBlock(gate.bed_check) : ''}
      <div class="gate-grid divider-row cols-4">
        <div><span class="stat-key">Time</span><b>${fmtHours(gate.estimated_hours)}</b></div>
        <div><span class="stat-key">Filament</span><b>${gate.filament_grams.toFixed(1)} g</b></div>
        <div><span class="stat-key">Cost</span><b>${money(gate.cost.total_cost)}</b></div>
        <div><span class="stat-key">Pre-flight</span><b>${{ clear: 'Clear', check: 'Warnings', blocked: 'Blocked' }[gate.preflight.verdict]}</b></div>
      </div>
      ${gate.preflight.checked_against && gate.preflight.checked_against !== 'Snapmaker U1'
        ? `<p class="field-hint">Checked against this printer's own report: ${esc(gate.preflight.checked_against)}.</p>` : ''}
      <h3 class="fd-h">Filament, as the printer reports it loaded</h3>
      ${fil || '<p class="log-empty">The file doesn\'t say which toolheads it uses.</p>'}
      ${gate.spools ? `<h3 class="fd-h">Spool weight</h3>${gate.spools.map(s => `<p class="gate-spool ${s.status}">${esc(s.toolhead)}: ${s.status === 'no_spool' ? 'no matching spool in your inventory' : s.status === 'unknown_weight' ? `${esc(s.spool)}: weight unknown, so there's no check that ${Math.round(s.grams_needed)} g is left` : `${esc(s.spool)}: ${s.weight_source === 'weighed' ? '' : '≈ '}${s.grams_remaining} g now, about ${s.grams_after} g after this print`}</p>`).join('')}` : ''}`;
    // A print that ended here may still be on the bed: the start waits for the tick.
    const tick = $('confirm-bed-clear');
    if (tick) {
      go.disabled = true;
      tick.addEventListener('change', () => { go.disabled = gate.verdict === 'blocked' || !tick.checked; });
    }
  }

  /* ================================================================
   * 8. automations
   * ================================================================ */

const TRIGGERS = {
    temperature: 'A temperature crosses a line',
    state: 'A print starts, pauses, finishes…',
    progress: 'A print reaches a percentage',
    time_left: 'A print has only so many minutes left',
    layer: 'A print reaches a layer',
    error: 'The printer reports an error',
    link_lost: 'The printer stops answering',
    filament_mismatch: 'The loaded filament doesn\'t match the file',
    maintenance_overdue: 'Maintenance becomes overdue',
  };
const ACTIONS = { notify: 'Send a notification', pause: 'Pause the print', cool_down: 'Turn the heaters off',
    macro: 'Run one of the printer\'s macros', light: 'Set the light colour (WLED)', home_assistant: 'Set a Home Assistant sensor' };
  // Worked examples, grouped by what people ask for most. Each fills the form; nothing saves until Save rule.
const PRESETS = [
    { group: 'Know what is happening', label: 'Tell me when a print finishes', rule: { trigger: { type: 'state', event: 'finished' }, action: { type: 'notify', message: 'Print finished', priority: 'normal' } } },
    { group: 'Know what is happening', label: '10 minutes left: get ready', rule: { trigger: { type: 'time_left', value: 10 }, action: { type: 'notify', message: 'About 10 minutes left', priority: 'normal' } } },
    { group: 'Know what is happening', label: 'Halfway there', rule: { trigger: { type: 'progress', value: 50 }, action: { type: 'notify', message: 'Print is halfway', priority: 'normal' } } },
    { group: 'Know what is happening', label: 'Check the first layers at layer 3', rule: { trigger: { type: 'layer', value: 3 }, action: { type: 'notify', message: 'Layer 3: check the first layers stuck', priority: 'normal' } } },
    { group: 'Catch problems', label: 'Urgent message on a printer error', rule: { trigger: { type: 'error' }, action: { type: 'notify', message: 'The printer stopped with an error', priority: 'high' } } },
    { group: 'Catch problems', label: 'Tell me if the printer stops answering', rule: { trigger: { type: 'link_lost' }, action: { type: 'notify', message: 'The printer stopped answering', priority: 'high' } } },
    { group: 'Catch problems', label: 'Alert on wrong filament', rule: { trigger: { type: 'filament_mismatch' }, action: { type: 'notify', message: 'Wrong filament loaded', priority: 'high' } } },
    { group: 'Look after the printer', label: 'Heaters off after a cancelled print', rule: { trigger: { type: 'state', event: 'cancelled' }, action: { type: 'cool_down' } } },
    { group: 'Look after the printer', label: 'Tell me when maintenance is due', rule: { trigger: { type: 'maintenance_overdue', task: 'any' }, action: { type: 'notify', message: 'Maintenance is due', priority: 'normal' } } },
    { group: 'Look after the printer', label: 'Pause if the nozzle passes 260°C', rule: { trigger: { type: 'temperature', sensor: 'active_nozzle', op: 'above', value: 260 }, action: { type: 'pause' } } },
    { group: 'Lights', label: 'Amber light when paused', rule: { trigger: { type: 'state', event: 'paused' }, action: { type: 'light', color: '#ffaa00' } } },
    // Only offered while an AI is connected (html.ai-on): the AI looks through the camera when the trigger fires.
    { group: 'Your AI', ai: true, label: 'AI checks the first layers (pauses a failure)', rule: { trigger: { type: 'layer', value: 3 }, action: { type: 'ai_look', pause: true } } },
    { group: 'Your AI', ai: true, label: 'AI looks at the halfway point', rule: { trigger: { type: 'progress', value: 50 }, action: { type: 'ai_look', pause: false } } },
  ];
const aiOn = () => document.documentElement.classList.contains('ai-on');

function sentence(rule) {
    const t = rule.trigger, a = rule.action;
    const when = t.type === 'temperature' ? `${t.sensor.replace('_', ' ')} ${t.op === 'above' ? 'goes above' : 'drops below'} ${formatTemp(t.value)}`
      : t.type === 'progress' ? `a print reaches ${t.value}%` : t.type === 'time_left' ? `a print has ${t.value} minutes or less left`
      : t.type === 'layer' ? `a print reaches layer ${t.value}` : t.type === 'error' ? 'the printer reports an error'
      : t.type === 'link_lost' ? 'the printer stops answering'
      : t.type === 'state' ? `a print ${t.event}` : t.type === 'filament_mismatch' ? 'the loaded filament doesn\'t match' : `maintenance${t.task && t.task !== 'any' ? ` (${t.task.replace('_', ' ')})` : ''} is overdue`;
    const then = a.type === 'notify' ? `send "${a.message}"` : a.type === 'light' ? `set the light to <span class="chip" style="background:${esc(a.color)}"></span>` : a.type === 'home_assistant' ? `set ${esc(a.entity_id)} to "${esc(a.state)}"`
      : a.type === 'cool_down' ? 'turn the heaters off' : a.type === 'macro' ? `run ${a.name}`
      : a.type === 'ai_look' ? `have my AI look through the camera${a.pause ? ' and pause a clear failure' : ''}` : 'pause the print';
    const cond = { always: '', while_printing: ' while printing', outside_quiet_hours: ' outside quiet hours' }[rule.condition];
    return `When ${esc(when)}${cond}, ${a.type === 'light' ? then : esc(then)}${rule.printer !== 'any' ? ` on ${esc(printerName(rule.printer))}` : ''}.`;
  }

async function loadRuleLog() {
    const host = $('rule-log');
    if (!host) return;
    const data = await getJSON('/api/automations/log').catch(() => null);
    if (isModuleDisabled(data)) { host.innerHTML = moduleDisabledEmpty('Automations'); return; }
    const log = (data && data.log) || [];
    host.innerHTML = log.length ? log.map(e => `
      <div class="rl-row ${e.ok ? 'ok' : 'bad'}">
        <span class="rl-mark" aria-hidden="true"></span>
        <div><div class="rl-title">${esc(e.rule_name)} <small>${e.manual ? 'test run' : esc(printerName(e.printer))} · ${since(e.time)}</small></div>
          <div class="rl-text">${e.trigger ? esc(e.trigger) + ' → ' : ''}${esc(e.ok ? e.detail : e.error)}</div></div>
      </div>`).join('') : '<p class="log-empty">Nothing has fired yet.</p>';
  }

  /* ================================================================
   * 9. smaller panels
   * ================================================================ */

function initSwap() {
    $('swap-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!demoOn && !realOn) { toast('No printer connected. Turn on demo data to try this on a simulated printer', 'warn'); return; }
      const body = { kind: $('swap-kind').value, toolhead: $('swap-toolhead').value, nozzle: $('swap-nozzle').value, note: $('swap-note').value };
      const r = await runCommand(e.submitter || null, '/api/maintenance/swap', body,
        { sending: 'Recording…', done: 'Swap recorded, recalibration is now due', failed: 'Not recorded' });
      if (r.ok) {
        if (r.result.body.tool_setup) toast(r.result.body.tool_setup, 'info', 7000);
        $('swap-note').value = '';
        loadMaintenance(); loadHealth();
        if (window.PrintRoom && PrintRoom.load) PrintRoom.load();
      }
    });
  }

async function loadForecast() {
    const host = $('forecast-body');
    if (!host) return;
    const data = await getJSON(api('/api/filament/forecast')).catch(() => null);
    if (isModuleDisabled(data)) { host.innerHTML = '<p class="log-empty">Turn on Filament inventory to see this.</p>'; return; }
    if (!data || !hasData(data)) { host.innerHTML = '<p class="log-empty">Needs print history. Turn on demo data to preview.</p>'; return; }
    host.innerHTML = data.spools.map(s => `
      <div class="spool-row">
        <span class="spool-swatch" style="background:${esc(s.color_hex)}"></span>
        <span class="spool-name">${esc(s.color_name)} ${esc(s.material)}</span>
        ${spoolWeight(s)}
        <span class="spool-grams">${s.prints_left != null ? `≈ ${s.prints_left} prints` : s.grams_remaining == null ? 'weigh it to count prints' : 'no history yet'}</span>
      </div>
      <p class="log-empty fc-note">${s.avg_grams_per_print ? `Your ${s.similar_prints} finished ${esc(s.color_name)} ${esc(s.material)} prints averaged ${s.avg_grams_per_print} g.` : 'No finished prints in this colour and material yet.'}${s.used_since_weighed ? ` ${s.used_since_weighed} g used since it was last weighed.` : ''}</p>`).join('');
  }

async function loadSideBySide() {
    const host = $('side-by-side-body');
    if (!host) return;
    const data = await getJSON(api('/api/compare/side-by-side')).catch(() => null);
    if (!data || isModuleDisabled(data) || !hasData(data) || !data.has_history) { host.innerHTML = ''; return; }
    host.innerHTML = `<div class="diff-table compact" role="table" aria-label="This job next to the last clean run">
      <div class="diff-row diff-headrow" role="row"><span role="columnheader">Recorded</span><span role="columnheader">Last clean run</span><span role="columnheader">Now</span></div>
      ${data.rows.map(r => `<div class="diff-row ${r.changed ? 'changed' : 'same'}" role="row"><span role="cell" class="diff-key">${esc(r.field)}</span><span role="cell">${esc(r.last_clean)}</span><span role="cell">${esc(r.now)}</span></div>`).join('')}
    </div>`;
  }

  /* Camera: MJPEG through this dashboard is the default. If the optional
   * low-latency module is on and go2rtc is set up, WebRTC is tried first
   * (the browser's own RTCPeerConnection, signalled through this server)
   * and anything that goes wrong falls back to MJPEG, saying which is on. */
const cam = { built: false, mjpeg: '', webrtc: false, pc: null, run: 0, watch: null };
async function loadCamera() {
    const host = $('camera-host');
    if (!host) return;
    const s = await getJSON('/api/camera/settings').catch(() => null);
    if (isModuleDisabled(s)) { host.innerHTML = moduleDisabledEmpty('Camera bridge'); cam.built = false; $('webrtc-setup').hidden = true; return; }
    $('camera-url').value = (s && s.stream_url) || '';
    const w = await getJSON('/api/camera/webrtc/settings').catch(() => null);
    const webrtcModule = Boolean(w && !isModuleDisabled(w) && w.go2rtc_url !== undefined);
    $('webrtc-setup').hidden = !webrtcModule;
    if (webrtcModule) { $('webrtc-url').value = w.go2rtc_url; $('webrtc-stream').value = w.stream; }
    cam.mjpeg = (s && s.stream_url) || '';
    cam.webrtc = webrtcModule && Boolean(w.go2rtc_url && w.stream) && typeof RTCPeerConnection === 'function';
    if (!cam.mjpeg && !cam.webrtc) {
      host.innerHTML = empty('No separate camera set', 'The printer\'s own camera shows on the Printer screen. Add an address above only to use a different camera.');
      cam.built = false;
      return;
    }
    if (!cam.built) {
      host.innerHTML = `<div class="camera-frame">
          <video id="camera-video" class="camera-img" playsinline muted autoplay hidden aria-label="Printer camera, low latency"></video>
          <img id="camera-img" alt="Printer camera" class="camera-img" hidden>
          <span class="cam-mode" id="cam-mode" data-tint role="status">Connecting…</span>
        </div>
        <p class="log-empty cam-why" id="cam-why" hidden></p>
        <div class="fd-actions"><button class="btn small" id="camera-reload" type="button">Reconnect</button>
        <span class="log-empty">Over Wi-Fi, MJPEG delay can slowly build up. Reconnect resets it.</span></div>`;
      $('camera-reload').addEventListener('click', () => { stopCamera(); startCamera(); });
      cam.built = true;
    }
    if (document.querySelector('#tab-control:not([hidden]) #camera-card:not(.sec-off)')) { stopCamera(); startCamera(); }
  }

function setCamMode(mode, why) {
    const pill = $('cam-mode'), note = $('cam-why');
    if (!pill) return;
    pill.dataset.mode = mode;
    pill.textContent = { webrtc: 'Low latency · WebRTC', mjpeg: 'MJPEG', connecting: 'Connecting…', none: 'No camera',
                         trouble: 'Camera not answering', frozen: 'Picture frozen' }[mode];
    note.hidden = !why;
    note.textContent = why || '';
  }

function showMjpeg(why) {
    const img = $('camera-img'), video = $('camera-video');
    if (!img) return;
    video.hidden = true;
    if (!cam.mjpeg) { img.hidden = true; setCamMode('none', `${why} There's no MJPEG address to fall back to. Add one above.`); return; }
    img.hidden = false;
    const run = cam.run;
    const note = why ? `Using the normal camera feed: ${why}` : '';
    img.onload = () => { if (run === cam.run && $('cam-mode').dataset.mode === 'trouble') setCamMode('mjpeg', note); };
    img.onerror = async () => { if (run === cam.run) setCamMode('trouble', `${await streamProblem()} The Printer page shows the printer\'s own camera instead. Reconnect to try this address again.`); };
    img.src = `/api/camera/stream?t=${Date.now()}`;
    setCamMode('mjpeg', note);
    watchCamera(run, note);
  }

  /* An <img> can't read why its stream failed, so ask the relay once: when
   * the camera can't be reached it answers at once with the reason in words.
   * If it starts streaming instead, the request is dropped straight away. */
async function streamProblem() {
    const stop = new AbortController();
    try {
      const r = await fetch(`/api/camera/stream?t=${Date.now()}`, { signal: stop.signal });
      if (!r.ok) { const b = await r.json().catch(() => ({})); const why = b.error || `The relay answered ${r.status}`; return /[.?!]$/.test(why) ? why : `${why}.`; }
      return 'The picture stopped loading.';
    } catch (e) {
      return 'The dashboard server could not be reached.';
    } finally { stop.abort(); }
  }

  /* The relay's watchdog counts frames (camera.py). While the picture is on
   * screen, read it every 5 s and say so when no new frame has arrived for
   * a while - a frozen MJPEG image otherwise looks exactly like a live one. */
function watchCamera(run, note) {
    clearInterval(cam.watch);
    cam.watch = setInterval(async () => {
      if (run !== cam.run) { clearInterval(cam.watch); return; }
      const s = await getJSON('/api/camera').catch(() => null);
      if (!s || run !== cam.run || s.frozen === undefined) return;
      const mode = $('cam-mode') && $('cam-mode').dataset.mode;
      if (s.frozen && mode !== 'trouble') {
        setCamMode('frozen', `No new picture for ${Math.round(s.seconds_since_last_frame)} s, so what's shown may be out of date. Reconnect to try again.`);
      } else if (!s.frozen && mode === 'frozen') {
        setCamMode('mjpeg', note);
      }
    }, 5000);
  }

async function startCamera() {
    const run = ++cam.run;
    if (!cam.webrtc) { showMjpeg(''); return; }
    setCamMode('connecting', '');
    try {
      await playWebRTC($('camera-video'), run);
      if (run !== cam.run) return;
      $('camera-img').hidden = true;
      $('camera-img').removeAttribute('src');
      $('camera-video').hidden = false;
      setCamMode('webrtc', '');
    } catch (err) {
      if (run !== cam.run) return;
      closePeer();
      showMjpeg(`the low-latency camera couldn't connect (${err.message || err}).`);
    }
  }

function closePeer() {
    if (cam.pc) { try { cam.pc.close(); } catch (e) { /* already closed */ } cam.pc = null; }
    const video = $('camera-video');
    if (video) { video.srcObject = null; }
  }

function within(ms, promise, what) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(what)), ms); })])
      .finally(() => clearTimeout(timer));
  }

async function playWebRTC(video, run) {
    const pc = new RTCPeerConnection();
    cam.pc = pc;
    pc.addTransceiver('video', { direction: 'recvonly' });
    const track = new Promise((resolve) => pc.addEventListener('track', (e) => {
      video.srcObject = e.streams[0] || new MediaStream([e.track]);
      resolve();
    }, { once: true }));
    const connected = new Promise((resolve, reject) => pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'connected') resolve();
      if (pc.connectionState === 'failed') reject(new Error('the network path to go2rtc failed'));
    }));
    await pc.setLocalDescription(await pc.createOffer());
    // go2rtc's /api/webrtc takes one complete offer, so gather our
    // network candidates first (briefly - whatever is found is sent).
    await within(3000, new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') resolve();
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') resolve(); });
    }), 'gathering').catch(() => {});
    const r = await postJSON('/api/camera/webrtc/offer', { type: 'offer', sdp: pc.localDescription.sdp });
    if (!r.ok) throw new Error(r.body.error || `the dashboard answered ${r.status}`);
    await pc.setRemoteDescription(r.body);
    await within(8000, Promise.all([track, connected]), 'no video arrived within 8 seconds');
    await video.play().catch(() => {});
    pc.addEventListener('connectionstatechange', () => {
      if (run === cam.run && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        closePeer();
        showMjpeg('the low-latency connection dropped.');
      }
    });
  }

function stopCamera() {
    cam.run++;
    clearInterval(cam.watch);
    closePeer();
    const img = $('camera-img');
    if (img) img.removeAttribute('src');
  }

  /* The printer's own recordings (the U1 keeps them in its read-only camera folder) and the copies kept here.
   * They are drawn into a box of their own and replaced only when they changed, so a refresh, a slow answer from the printer (its Wi-Fi
   * can take many seconds) or a switch being flipped never blanks the list. Keeping a copy is a background job on the server: the
   * press returns at once and the row shows its progress, so a long copy never holds a connection (a browser allows six to one address). */
const tlPrinter = { data: null, jobs: [], busy: false, poll: 0, host: null, key: '' };

const tlSize = n => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const tlWhen = t => (t ? new Date(t * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

function tlJobFor(v) { return tlPrinter.jobs.find(j => j.state === 'running' && j.root === v.root && j.path === v.path); }

function tlKeepLabel(job) {
    if (!job) return 'Keep a copy here';
    return job.total ? `Copying ${Math.min(99, Math.round(job.bytes / job.total * 100))}%` : 'Copying…';
  }

function tlPrinterHTML(data) {
    const videos = (data.videos || []).slice(0, 12);
    const failed = tlPrinter.jobs.filter(j => j.state === 'failed').slice(0, 3);
    return `<h3>On the printer</h3>${videos.length ? videos.map(v => {
      const job = tlJobFor(v);
      return `<div class="reg-row"><span class="reg-name">${esc(v.path.split('/').pop())}</span><span class="log-empty">${esc(tlWhen(v.modified))} · ${esc(tlSize(v.size))}</span>
        <span class="tl-acts"><button class="btn small" type="button" data-play-video="${esc(api(`/api/timelapse/printer-video?root=${enc(v.root)}&path=${enc(v.path)}`))}" data-play-download="${esc(api(`/api/timelapse/printer-video?download=1&root=${enc(v.root)}&path=${enc(v.path)}`))}" data-play-name="${esc(v.path.split('/').pop())}">Play</button>
        <button class="btn small" type="button" data-keep-root="${esc(v.root)}" data-keep-path="${esc(v.path)}"${job ? ` disabled aria-busy="true" title="${esc(tlSize(job.bytes))} of ${esc(tlSize(job.total) || 'unknown size')}"` : ''}>${esc(tlKeepLabel(job))}</button></span></div>`;
    }).join('')
      : `<p class="log-empty">${(data.roots || []).length ? 'The printer has no recorded videos right now.' : 'This printer’s firmware lists no video folder. Deja Vu1’s own flipbooks above still work.'}</p>`}
      ${failed.map(j => `<p class="field-hint tl-failed" role="status">Not kept: ${esc(j.name)}. ${esc(j.error || '')}</p>`).join('')}
      ${(data.saved || []).length ? `<h3>Kept on this computer</h3>${data.saved.map(v => `<div class="reg-row"><span class="reg-name">${esc(v.name)}</span><span class="log-empty">${esc(tlSize(v.size))}</span>
        <span class="tl-acts"><button class="btn small" type="button" data-play-video="${esc(api('/api/timelapse/video?name=' + enc(v.name)))}" data-play-download="${esc(api('/api/timelapse/video?download=1&name=' + enc(v.name)))}" data-play-name="${esc(v.name)}">Play</button>
        <a class="btn small" href="${esc(api('/api/timelapse/video?download=1&name=' + enc(v.name)))}">Download</a>
        <button class="btn small" type="button" data-forget-video="${esc(v.name)}">Remove</button></span></div>`).join('')}` : ''}
      <p class="field-hint">The printer keeps only its latest recordings, so keep the ones you want. A video from a print that stopped early may not play if the printer never finished writing it; the flipbook of that print above still has its frames.</p>`;
  }

function tlReset() {
    tlPrinter.data = null;
    tlPrinter.jobs = [];
  }

function tlDrawPrinter() {
    const box = tlPrinter.host && tlPrinter.host.querySelector('#tl-printer');
    if (box && tlPrinter.data) setHTML(box, tlPrinterHTML(tlPrinter.data));
  }

async function loadPrinterVideos(host, force) {
    if (tlPrinter.busy && !force) return;
    tlPrinter.busy = true;
    try {
      const [data, jobs] = await Promise.all([getJSON(api('/api/timelapse/printer')).catch(() => null), getJSON(api('/api/timelapse/jobs')).catch(() => null)]);
      if (!data || data.demo || (!data.videos && !data.saved) || !host.isConnected) return;    // what is drawn stays as it is
      tlPrinter.host = host;
      tlPrinter.data = data;
      if (jobs && Array.isArray(jobs.jobs)) tlPrinter.jobs = jobs.jobs;
      tlDrawPrinter();
      if (tlPrinter.jobs.some(j => j.state === 'running')) tlWatchCopies();
    } finally { tlPrinter.busy = false; }
  }

/* Watch the copies the server is making, once a second while any runs; say how each ended, then refresh the kept list once. */
function tlWatchCopies() {
    if (tlPrinter.poll) return;
    const tick = async () => {
      tlPrinter.poll = 0;
      const r = await getJSON(api('/api/timelapse/jobs')).catch(() => null);
      if (!r || !Array.isArray(r.jobs)) { tlPrinter.poll = setTimeout(tick, 3000); return; }     // the server may be restarting: look again
      const before = tlPrinter.jobs;
      tlPrinter.jobs = r.jobs;
      r.jobs.forEach(j => {
        const was = before.find(b => b.id === j.id);
        if (was && was.state === 'running' && j.state !== 'running') toast(j.state === 'done' ? `Kept ${j.name} on this computer` : `Not kept: ${j.error}`, j.state === 'done' ? 'ok' : 'bad');
      });
      tlDrawPrinter();
      if (r.jobs.some(j => j.state === 'running')) tlPrinter.poll = setTimeout(tick, 1000);
      else if (tlPrinter.host) loadPrinterVideos(tlPrinter.host, true);
    };
    tlPrinter.poll = setTimeout(tick, 500);
  }

async function tlKeep(btn) {
    btn.disabled = true;
    btn.textContent = 'Starting…';
    const r = await postJSON(api('/api/timelapse/keep'), { root: btn.dataset.keepRoot, path: btn.dataset.keepPath });
    if (!r.ok) { toast(`Not kept: ${r.body.error}`, 'bad'); btn.disabled = false; btn.textContent = 'Keep a copy here'; return; }
    if (r.body.job) tlPrinter.jobs = [r.body.job, ...tlPrinter.jobs.filter(j => j.id !== r.body.job.id)];
    tlDrawPrinter();
    tlWatchCopies();
    if (window.Activity) Activity.refresh();
  }

async function tlForget(btn) {
    const r = await postJSON(api('/api/timelapse/forget'), { name: btn.dataset.forgetVideo });
    if (r.ok && tlPrinter.host) loadPrinterVideos(tlPrinter.host, true);
  }

  /* A flipbook as a video file, made in this browser (no encoder is installed): each frame is drawn onto a
   * canvas while the browser records it, at the flipbook's 12 frames a second. */
async function flipbookVideo(session, name, btn) {
    const data = await getJSON(api(`/api/timelapse/frames?session=${enc(session)}`)).catch(() => null);
    if (!data || !data.frames || data.frames.length < 2) { toast('Not enough frames for a video yet', 'warn'); return; }
    btn.disabled = true;
    const label = btn.textContent;
    try {
      const imgs = await Promise.all(data.frames.map(n => new Promise((ok, no) => {
        const img = new Image();
        img.onload = () => ok(img); img.onerror = () => no(new Error('A frame could not be read'));
        img.src = api(`/api/timelapse/frame?session=${enc(session)}&name=${enc(n)}`);
      })));
      const w = Math.min(1280, imgs[0].naturalWidth || 960), h = Math.round(w * ((imgs[0].naturalHeight || 540) / (imgs[0].naturalWidth || 960)));
      const canvas = document.createElement('canvas');
      canvas.width = w - (w % 2); canvas.height = h - (h % 2);
      const ctx = canvas.getContext('2d');
      const type = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
      if (!type) throw new Error('This browser can’t record video');
      const rec = new MediaRecorder(canvas.captureStream(12), { mimeType: type, videoBitsPerSecond: 6e6 });
      const parts = [];
      rec.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
      const done = new Promise(r => { rec.onstop = r; });
      rec.start();
      for (let i = 0; i < imgs.length; i++) {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(imgs[i], 0, 0, canvas.width, canvas.height);
        btn.textContent = `Making ${Math.round((i + 1) / imgs.length * 100)}%`;
        await new Promise(r => setTimeout(r, 1000 / 12));
      }
      rec.stop();
      await done;
      const blob = new Blob(parts, { type: type.split(';')[0] });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(name || 'print').replace(/\.[a-z0-9]+$/i, '')}-timelapse.${type.includes('mp4') ? 'mp4' : 'webm'}`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`Saved ${a.download}`, 'ok');
    } catch (e) {
      toast(`Couldn’t make the video: ${e.message}`, 'bad');
    } finally { btn.disabled = false; btn.textContent = label; }
  }


function initDemoTools() {
    qsa('#demo-speed [data-speed]').forEach(b => b.addEventListener('click', async () => {
      const r = await postJSON(api('/api/demo/time-scale'), { scale: +b.dataset.speed });
      if (!r.ok) { toast(`Couldn't change speed: ${r.body.error}`, 'bad'); return; }
      qsa('#demo-speed button').forEach(x => x.classList.toggle('active', x === b));
      toast(`${printerName(currentPrinter)} now runs at ${b.textContent.toLowerCase()}`, 'ok');
    }));
    $('demo-fail-btn').addEventListener('click', async () => {
      const action = $('demo-fail-action').value;
      const r = await postJSON(api('/api/demo/fail-next'), { action, message: 'Klippy reported an error (simulated failure)' });
      toast(r.ok ? `The next "${action}" on ${printerName(currentPrinter)} will fail. Watch how it's reported` : `Couldn't arm it: ${r.body.error}`, r.ok ? 'warn' : 'bad', 6000);
    });
    $('demo-reset-btn').addEventListener('click', async () => {
      const r = await postJSON(api('/api/demo/reset'), {});
      toast(r.ok ? 'Simulated printers restarted' : `Couldn't restart: ${r.body.error}`, r.ok ? 'ok' : 'bad');
      refreshAll();
    });
  }

function initCameraForm() {
    $('camera-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await postJSON('/api/camera/settings', { stream_url: $('camera-url').value.trim() });
      toast(r.ok ? 'Camera address saved' : `Not saved: ${r.body.error}`, r.ok ? 'ok' : 'bad');
      loadCamera();
    });
    $('camera-find').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Looking…';
      const r = await postJSON(api('/api/camera/find'), {});
      btn.disabled = false; btn.textContent = 'Find my printer\'s camera';
      if (r.ok) { $('camera-url').value = r.body.stream_url; toast('Found the printer\'s camera and saved its address', 'ok'); loadCamera(); }
      else toast(r.body.error || 'No camera answered', 'bad', 9000);
    });
    $('webrtc-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await postJSON('/api/camera/webrtc/settings', { go2rtc_url: $('webrtc-url').value.trim(), stream: $('webrtc-stream').value.trim() });
      toast(r.ok ? (r.body.go2rtc_url ? 'go2rtc address saved, trying the low-latency camera' : 'Low-latency camera cleared') : `Not saved: ${r.body.error}`, r.ok ? 'ok' : 'bad', 5000);
      if (r.ok) loadCamera();
    });
  }

  /* Continue on another device: every open dashboard says what it's
   * looking at; another device can pick up exactly there. */
const DEVICE_KEY = 'dejavu1.device';
const deviceId = store.get(DEVICE_KEY) || (() => {
    const id = `dev-${Math.random().toString(36).slice(2, 10)}`;
    store.set(DEVICE_KEY, id);
    return id;
  })();
const deviceName = (() => {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows PC';
    return 'other computer';
  })();

function currentTab() { return store.get('dejavu1.tab') || 'overview'; }

function reportView() {
    if (modGate.off.has('handoff')) return;      // switched off: nothing to report, and no refused request
    postJSON('/api/handoff', { device_id: deviceId, device_name: deviceName,
      view: { printer: currentPrinter, tab: currentTab(), file: files.open ? files.open.name : null } }).catch(() => {});
  }

  /* ================================================================
   * 10. phone layout
   * ================================================================ */

function renderQuickActions(state) {
    const bar = $('quick-actions');
    const running = state.state === 'printing' || state.state === 'paused';
    if (bar.hidden !== !running) bar.hidden = !running;
    // With the link down a press can't reach the printer: the bar stays, its buttons wait.
    const reachable = running && !state.link_lost;
    const qaCancel = $('qa-cancel');
    if (qaCancel && qaCancel.disabled !== !reachable) qaCancel.disabled = !reachable;
    const pause = $('qa-pause');
    if (pause.dataset.phase !== 'sending') {
      setText(pause, state.state === 'paused' ? 'Resume' : 'Pause');
      if (pause.disabled !== !reachable) pause.disabled = !reachable;
    }
    pause.onclick = () => controlAction(state.state === 'paused' ? 'resume' : 'pause', pause);
  }

  /* Hold-to-cancel: cancelling a print can't be undone, so on a phone it
   * takes a deliberate 1.2 s press. touch-action:none stops the browser
   * turning the press into a scroll, and the release listeners are on the
   * whole document, so a finger that slides off the button mid-hold always
   * ends the hold (pointerleave alone would miss that). */
function initHoldToCancel() {
    const btn = $('qa-cancel');
    const HOLD_MS = 1200;
    let timer = null, pointer = null;
    const label = btn.querySelector('.hold-label');
    const reset = () => {
      clearTimeout(timer); timer = null; pointer = null;
      btn.classList.remove('is-holding');
      if (btn.dataset.phase !== 'sending') label.textContent = 'Hold to cancel';
    };
    btn.addEventListener('pointerdown', (e) => {
      if (btn.disabled || btn.dataset.phase === 'sending') return;
      e.preventDefault();
      pointer = e.pointerId;
      btn.classList.add('is-holding');
      label.textContent = 'Keep holding…';
      timer = setTimeout(async () => {
        btn.classList.remove('is-holding');
        timer = null;
        label.textContent = 'Cancelling…';
        await controlAction('cancel', null);
        label.textContent = 'Hold to cancel';
      }, HOLD_MS);
    });
    const release = (e) => {
      if (pointer === null || (e.pointerId !== undefined && e.pointerId !== pointer)) return;
      if (timer) toast('Hold the button to cancel the print', 'info', 2200);
      reset();
    };
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', release);
    // Keyboard and switch users: activate, then confirm in words.
    btn.addEventListener('click', (e) => {
      if (e.detail !== 0) return;               // a pointer press is handled above
      if (window.confirm('Cancel the print? This can\'t be undone.')) controlAction('cancel', null);
    });
  }

  /* On a phone the print pill and the "continue here" offer join the thumb
   * dock's own column, so they stack above the dock by its real height
   * instead of by guessed pixel offsets (which broke as soon as the quick
   * actions appeared or disappeared). Wider screens float them as before.
   * The page's bottom padding follows the dock's height the same way, so
   * the end of every tab can always be scrolled clear of it. */
function initDockStack() {
    const dock = $('thumb-dock'), pill = $('live-pill'), offer = $('handoff');
    const finder = qs('.feature-finder'), finderHome = qs('.topbar-right');
    const phone = window.matchMedia('(max-width: 720px)');
    const place = () => {
      if (phone.matches) dock.prepend(offer, pill);
      else {
        dock.before(pill);
        // On a computer the "continue here" offer is a small sheet above the orb, in the floating dock.
        const floating = $('strip');
        if (floating) floating.prepend(offer); else dock.before(offer);
      }
      // On a phone the search lives at the top of the More sheet.
      if (finder && finderHome) {
        if (phone.matches) $('ms-search').append(finder);
        else if (!finderHome.contains(finder)) finderHome.prepend(finder);
      }
    };
    phone.addEventListener('change', place);
    place();
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => {
        document.body.style.setProperty('--dock-h', `${Math.ceil(dock.getBoundingClientRect().height)}px`);
      }).observe(dock);
    }
  }

function syncNav(name) {
    qsa('.bottom-nav [data-tab]').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === name);
      if (b.dataset.tab === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const inMore = qsa('#more-sheet [data-tab]').some(b => b.dataset.tab === name);
    $('bn-more').classList.toggle('active', inMore);
    moveTabBlob(name);
  }

  /* ================================================================
   * 11. Liquid Glass 2.0
   * ================================================================ */

  /* A spring, solved numerically and sampled into keyframes: the shape
   * overshoots a little and settles, the way a physical sheet would. */
function springCurve(stiffness = 190, damping = 19, samples = 48) {
    const out = [];
    let x = 0, v = 0;
    const dt = 1 / 120, total = 0.62, per = Math.round(total / dt / samples);
    for (let s = 0; s <= samples; s++) {
      out.push(x);
      for (let k = 0; k < per; k++) { const a = stiffness * (1 - x) - damping * v; v += a * dt; x += v * dt; }
    }
    out[out.length - 1] = 1;
    return out;
  }
const SPRING = springCurve();
const lerp = (a, b, t) => a + (b - a) * t;

  /* Animate the displacement scale of both refraction filters with the
   * same spring, so glass "bends harder" while it is moving. */
function pulseRefraction(duration = 620) {
    const maps = [qs('#lg-deep-map'), qs('#lg-distort feDisplacementMap')].filter(Boolean);
    // The resting scale is read once and kept: a second pulse starting
    // while one is still running must not take the bent value as its base,
    // or quick taps would ratchet the refraction up for good.
    maps.forEach(m => { if (!m.dataset.restScale) m.dataset.restScale = m.getAttribute('scale'); });
    const base = maps.map(m => +m.dataset.restScale);
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const bump = Math.sin(Math.PI * t) * (1 - t * 0.4);
      maps.forEach((m, i) => m.setAttribute('scale', (base[i] * (1 + bump * 1.6)).toFixed(1)));
      if (t < 1) requestAnimationFrame(step); else maps.forEach((m, i) => m.setAttribute('scale', base[i]));
    };
    requestAnimationFrame(step);
  }

  /* Morph: a glass sheet lifts off `fromEl` and deforms - position, size
   * and corner radius together, on the spring - into the bounds of the
   * target, which then appears in its place. */
function morph(fromEl, getTarget, done) {
    if (REDUCED.matches || !fromEl || !fromEl.getBoundingClientRect) { done && done(); if (getTarget) getTarget(); return; }
    const a = fromEl.getBoundingClientRect();
    const ra = parseFloat(getComputedStyle(fromEl).borderRadius) || 18;
    done && done();
    const target = getTarget && getTarget();
    if (!target) return;
    const b = target.getBoundingClientRect();
    const rb = parseFloat(getComputedStyle(target).borderRadius) || 26;
    if (!b.width || !b.height) return;
    const ghost = document.createElement('div');
    ghost.className = 'morph-ghost liquid-glass';
    ghost.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ghost);
    const frames = SPRING.map(t => ({
      left: `${lerp(a.left, b.left, t)}px`, top: `${lerp(a.top, b.top, t)}px`,
      width: `${Math.max(8, lerp(a.width, b.width, t))}px`, height: `${Math.max(8, lerp(a.height, b.height, t))}px`,
      borderRadius: `${lerp(ra, rb, t)}px`, opacity: t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15 * 0.2,
    }));
    frames[frames.length - 1].opacity = 0;
    target.classList.add('is-morph-target');
    pulseRefraction();
    const anim = ghost.animate(frames, { duration: 620, easing: 'linear', fill: 'forwards' });
    anim.onfinish = () => { ghost.remove(); target.classList.remove('is-morph-target'); };
  }

  /* The tab bars' active "lens" slides between tabs on the same spring:
   * the desktop bar's orange lens and the phone dock's clear one. */
function placeBlob(bar, btn, instant) {
    if (!bar || !btn) return;
    let blob = qs('.tab-blob', bar);
    if (!blob) { blob = document.createElement('span'); blob.className = 'tab-blob'; blob.setAttribute('aria-hidden', 'true'); bar.prepend(blob); }
    const to = { x: btn.offsetLeft, w: btn.offsetWidth };
    if (!to.w) return;                          // bar not laid out (hidden at this width)
    const from = blob.dataset.x ? { x: +blob.dataset.x, w: +blob.dataset.w } : to;
    blob.dataset.x = to.x; blob.dataset.w = to.w;
    blob.style.width = `${to.w}px`;
    blob.style.top = `${btn.offsetTop}px`;       // the bar can wrap to a second row
    blob.style.height = `${btn.offsetHeight}px`;
    blob.getAnimations().forEach(a => a.cancel());
    if (instant || REDUCED.matches || (from.x === to.x && from.w === to.w)) { blob.style.transform = `translateX(${to.x}px)`; return; }
    blob.style.transform = `translateX(${to.x}px)`;
    blob.animate(SPRING.map(t => ({ transform: `translateX(${lerp(from.x, to.x, t)}px) scaleX(${lerp(from.w, to.w, t) / to.w})` })),
                 { duration: 560, easing: 'linear' });
  }
function moveTabBlob(name, instant) {
    const bar = $('tabbar');
    placeBlob(bar, bar && qs(`.navtab[data-tab="${name}"]`, bar), instant);
    placeBlob(qs('.bottom-nav'), qs('.bottom-nav button.active'), instant);
  }

  /* The shared glass menu. Built fresh each time it opens and never touched
   * by live updates, so a refresh can't close or reshuffle it under your
   * pointer. Closes on a pick, a click or tap outside, Escape, scrolling
   * the page a long way, or a resize; arrow keys, Home and End move through
   * it. The button that opened it gets focus back only when a keyboard
   * opened it. */
const gmenu = { btn: null, keyboard: false };
function closeMenu(refocus) {
    const el = $('glass-menu');
    if (!el || el.hidden) return;
    el.hidden = true;
    if (gmenu.btn) { gmenu.btn.setAttribute('aria-expanded', 'false'); if (refocus) gmenu.btn.focus(); }
    gmenu.btn = null;
  }
function openMenu(btn, items, onPick, label, fromKeyboard) {
    const el = $('glass-menu');
    if (gmenu.btn === btn) { closeMenu(fromKeyboard); return; }   // second press closes it
    closeMenu(false);
    el.setAttribute('aria-label', label);
    el.innerHTML = items.map(it => `${it.divider ? '<hr class="gm-divider">' : ''}<button type="button" role="menuitem" class="gm-item"
      data-value="${esc(it.value)}"${it.current ? ' aria-current="true"' : ''}>${it.html}</button>`).join('');
    qsa('.gm-item', el).forEach(b => b.addEventListener('click', () => { const v = b.dataset.value; closeMenu(gmenu.keyboard); onPick(v); }));
    el.hidden = false;
    gmenu.btn = btn; gmenu.keyboard = !!fromKeyboard;
    btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect(), vw = document.documentElement.clientWidth;
    const left = Math.max(12, Math.min(r.right - el.offsetWidth, vw - el.offsetWidth - 12));
    el.style.left = `${left + window.scrollX}px`;
    el.style.top = `${r.bottom + window.scrollY + 8}px`;
    el.style.transformOrigin = `${r.left + r.width / 2 - left}px 0`;
    if (fromKeyboard) (qs('.gm-item[aria-current]', el) || qs('.gm-item', el)).focus();
  }
function initGlassMenu() {
    const el = $('glass-menu');
    if (!el) return;
    document.addEventListener('pointerdown', (e) => {
      if (!el.hidden && !el.contains(e.target) && !(gmenu.btn && gmenu.btn.contains(e.target))) closeMenu(false);
    });
    document.addEventListener('keydown', (e) => {
      if (el.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); return; }
      const items = qsa('.gm-item', el);
      const i = items.indexOf(document.activeElement);
      const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      items[(to + items.length) % items.length].focus();
    });
    el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget) && e.relatedTarget !== gmenu.btn && e.relatedTarget) closeMenu(false); });
    window.addEventListener('resize', () => closeMenu(false));
    let openedAt = 0;
    new MutationObserver(() => { openedAt = window.scrollY; }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('scroll', () => { if (!el.hidden && Math.abs(window.scrollY - openedAt) > 240) closeMenu(false); }, { passive: true });
  }

  /* Press feedback: record where the finger landed so the bloom of light
   * (workshop.css section 5) spreads from that exact point. */
const PRESSABLE = '.btn, .chip-btn, .printer-chip, .qa-btn, .navtab, .bottom-nav button, .more-sheet button, .file-card';
function initPressGlow() {
    document.addEventListener('pointerdown', (e) => {
      const el = e.target.closest && e.target.closest(PRESSABLE);
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--px', `${e.clientX - r.left}px`);
      el.style.setProperty('--py', `${e.clientY - r.top}px`);
    }, { passive: true });
  }

  /* Scroll edge: the toolbar edge (.topbar) frosts harder once content is under it. The two
   * thresholds stop it flickering when the page rests right at the edge. */
function initScrollEdge() {
    let on = false, queued = false, tucked = false, lastY = window.scrollY;
    const phone = window.matchMedia('(max-width: 720px)');
    const bar = qs('.topbar');
    const check = () => {
      queued = false;
      const y = window.scrollY;
      if (!on && y > 12) { on = true; document.body.classList.add('is-scrolled'); }
      else if (on && y < 4) { on = false; document.body.classList.remove('is-scrolled'); }
      // On a phone the bar tucks away while you scroll down a page and
      // returns the moment you scroll back up, so it isn't holding a sixth
      // of the screen the whole time. Never while it holds focus (the
      // printer menu is open, or a keyboard user is in it).
      const dy = y - lastY;
      if (Math.abs(dy) < 8 && y > 4) return;
      lastY = y;
      const tuck = phone.matches && dy > 0 && y > 160 && !bar.matches(':focus-within');
      if (tuck !== tucked) { tucked = tuck; document.body.classList.toggle('is-tucked', tuck); }
    };
    bar.addEventListener('focusin', () => { tucked = false; document.body.classList.remove('is-tucked'); });
    window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(check); } }, { passive: true });
    check();
  }

  /* Keep both lenses on their tab when the window is resized or rotated. */
function initBlobResize() {
    let timer;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => moveTabBlob(currentTab(), true), 120);
    });
  }
  return { ACTIONS, HEAD_COUNT, PRESETS, SPRING, TRIGGERS, aiOn, closeFile, conversionReport, currentTab, deviceId,
    flipbookVideo, initBlobResize, initCameraForm, initDemoTools, initDockStack, initGlassMenu,
    initHoldToCancel, initPressGlow, initScrollEdge, initSwap, lerp, loadCamera, loadForecast, loadPrinterVideos,
    loadRuleLog, loadSideBySide, localLines, morph, moveTabBlob, openMenu, plateSummary, pulseRefraction,
    renderGate, renderQuickActions, reportView, sentence, stopCamera, syncNav, tlForget, tlKeep, tlReset };
})();
