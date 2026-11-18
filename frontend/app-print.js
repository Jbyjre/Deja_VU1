/* Deja Vu1 dashboard, part 5 of 7: skipping one object on the plate, watch-only mode, the filament inventory and
 * "what changed".
 * Loaded right after app-modules.js (index.html keeps the order). The parts share one global scope: names from
 * earlier parts are used here as is, and code that runs at load only calls what is already defined above.
 */
/* ---- Objects on the plate: skip one, keep the rest ------------------------
 * Klipper's exclude_object lists what the file labelled. The list is the
 * control (real buttons, keyboard and screen-reader friendly); the map
 * shows where each one is on the bed. Skipping asks twice, because it
 * can't be undone for this print. */
const plateUI = { selected: null, confirmUntil: 0, sig: '' };

function plateShape(o) {
  if (o.polygon && o.polygon.length >= 3) return o.polygon;
  if (o.center) {
    const [x, y] = o.center, r = 6;
    return [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
  }
  return null;
}

function renderPlate(state) {
  const card = $('ctrl-plate');
  if (!card) return;
  const running = state && (state.state === 'printing' || state.state === 'paused');
  card.hidden = !running;
  if (!running) { plateUI.selected = null; plateUI.sig = ''; return; }
  const plate = state.objects;
  const body = $('plate-body');
  if (!plate || !plate.list.length) {
    if (plateUI.sig !== 'none') {
      plateUI.sig = 'none';
      body.hidden = true;
      $('plate-sub').textContent = 'This print doesn\'t label its objects, so none can be skipped. Turn on '
        + '"Label objects" in the slicer (Snapmaker\'s U1 profiles have it on) for the next one.';
    }
    return;
  }
  body.hidden = false;
  const excluded = new Set(plate.excluded);
  const live = plate.list.filter(o => !excluded.has(o.name));
  if (plateUI.selected && (!plate.list.some(o => o.name === plateUI.selected) || excluded.has(plateUI.selected))) plateUI.selected = null;
  const confirming = plateUI.selected && Date.now() < plateUI.confirmUntil;
  const sig = JSON.stringify([plate.list.map(o => o.name), plate.excluded, plate.current, plateUI.selected, confirming]);
  if (sig === plateUI.sig) return;
  plateUI.sig = sig;
  $('plate-sub').textContent = `${live.length} of ${plate.list.length} still printing. If one fails, skip just that one - the rest keep going.`;

  const short = (n) => n.replace(/_ID_\d+_COPY_\d+$/i, '').replace(/\.(STL|3MF|STEP|OBJ)$/i, '');
  const copies = (n) => { const m = n.match(/_ID_(\d+)_COPY_(\d+)$/i); return m ? `#${+m[1] + 1}${+m[2] ? `.${+m[2] + 1}` : ''}` : ''; };
  // Klipper upper-cases names; show them the way a person would write them.
  const words = (s) => { const w = s.replace(/_/g, ' ').toLowerCase().trim(); return w ? w[0].toUpperCase() + w.slice(1) : s; };
  const label = (n) => `${words(short(n))} ${copies(n)}`.trim();

  // The map is a top-view drawing, like the digital twin: the bed in a
  // heavy line, a 30 mm grid, each object outlined with a numbered balloon
  // that matches the list, skipped ones section-hatched, and the bed's
  // size dimensioned. Bed Y points away from you; SVG's points down.
  const grid = [30, 60, 90, 120, 150, 180, 210, 240].map(v =>
    `<line x1="${v}" y1="0" x2="${v}" y2="270"/><line x1="0" y1="${v}" x2="270" y2="${v}"/>`).join('');
  const number = new Map(plate.list.map((o, i) => [o.name, i + 1]));
  const shapes = plate.list.map(o => {
    const pts = plateShape(o);
    if (!pts) return '';
    const cls = excluded.has(o.name) ? 'is-skipped' : o.name === plate.current ? 'is-current' : '';
    const sel = o.name === plateUI.selected ? ' is-selected' : '';
    const xs = pts.map(p => p[0]), ys = pts.map(p => 270 - p[1]);
    const bx = Math.max(...xs) + 2, by = Math.min(...ys) - 2;
    return `<g class="plate-part ${cls}${sel}" data-plate-obj="${esc(o.name)}"><title>${esc(label(o.name))}</title>
      <polygon class="plate-obj" points="${pts.map(([x, y]) => `${x},${270 - y}`).join(' ')}"/>
      <circle class="plate-balloon" cx="${bx + 5}" cy="${by - 5}" r="6.5"/><text class="plate-num" x="${bx + 5}" y="${by - 2.4}" text-anchor="middle">${number.get(o.name)}</text></g>`;
  }).join('');
  const arrow = (x1, y1, x2, y2) => `<line class="plate-dim" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-start="url(#plate-arrow)" marker-end="url(#plate-arrow)"/>`;
  $('plate-map').innerHTML = `<title id="plate-map-title">The 270 by 270 mm bed, seen from above, with each object on it</title>
    <defs><pattern id="plate-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="5" class="plate-hatch-line"/></pattern>
      <marker id="plate-arrow" viewBox="0 0 8 3" refX="8" refY="1.5" markerWidth="8" markerHeight="3" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
      <path d="M0 0L8 1.5L0 3z" class="plate-arrowhead"/></marker></defs>
    <rect class="plate-sheet" x="-29" y="-5" width="306" height="320"/>
    <rect class="plate-bed" x="0" y="0" width="270" height="270"/>
    <g class="plate-grid">${grid}</g>${shapes}
    <path class="plate-ext" d="M0 273V292M270 273V292M-3 0H-22M-3 270H-22"/>
    ${arrow(0, 288, 270, 288)}<text class="plate-dimtext" x="135" y="285" text-anchor="middle">270</text>
    ${arrow(-18, 0, -18, 270)}<text class="plate-dimtext" x="-21" y="135" text-anchor="middle" transform="rotate(-90 -21 135)">270</text>
    <path class="plate-axis" d="M6 264h16M6 264v-16"/><text class="plate-axis-t" x="25" y="267">X</text><text class="plate-axis-t" x="3" y="244">Y</text>
    <text class="plate-front" x="135" y="306" text-anchor="middle">front</text>`;

  $('plate-list').innerHTML = plate.list.map(o => {
    const skipped = excluded.has(o.name), current = o.name === plate.current;
    return `<li><button type="button" class="plate-item${o.name === plateUI.selected ? ' is-selected' : ''}${skipped ? ' is-skipped' : ''}"
        data-plate-pick="${esc(o.name)}" ${skipped ? 'disabled' : ''} aria-pressed="${o.name === plateUI.selected}">
      <span class="plate-dot ${skipped ? 'is-skipped' : current ? 'is-current' : ''}" aria-hidden="true">${plate.list.indexOf(o) + 1}</span>
      <span class="plate-name">${esc(label(o.name))}</span>
      <span class="plate-state">${skipped ? 'skipped' : current ? 'printing now' : 'waiting'}</span></button></li>`;
  }).join('');

  const action = $('plate-action');
  if (!plateUI.selected) {
    action.innerHTML = `<p class="log-empty">${live.length > 1 ? 'Choose an object to skip it.' : 'Only one object is left - Cancel stops the whole print.'}</p>`;
  } else {
    const n = plateUI.selected;
    action.innerHTML = `<p class="plate-confirm-text">${confirming
      ? `Skip <b>${esc(label(n))}</b> for the rest of this print? It can't be brought back.`
      : `<b>${esc(label(n))}</b> selected.`}</p>
      <div class="plate-buttons">
        <button class="btn danger" type="button" id="plate-skip">${confirming ? 'Yes, skip it' : 'Skip this object'}</button>
        <button class="btn" type="button" id="plate-clear">${confirming ? 'Keep printing it' : 'Done'}</button>
      </div>`;
    $('plate-clear').onclick = () => { plateUI.selected = null; plateUI.confirmUntil = 0; renderPlate(lastPrinterState); };
    $('plate-skip').onclick = async (e) => {
      if (Date.now() >= plateUI.confirmUntil) {
        plateUI.confirmUntil = Date.now() + 6000;
        renderPlate(lastPrinterState);
        setTimeout(() => renderPlate(lastPrinterState), 6100);   // the question times out by itself
        $('plate-skip').focus();
        return;
      }
      plateUI.confirmUntil = 0;
      const r = await runCommand(e.currentTarget, '/api/printer/control/exclude', { name: n }, {
        sending: 'Skipping…', done: `Skipping ${label(n)}`, failed: `Skipping ${label(n)} failed`,
        expect: s => ((s.objects || {}).excluded || []).includes(n),
      });
      if (r.ok) plateUI.selected = null;
      plateUI.sig = '';
      renderPlate(lastPrinterState);
    };
  }
  const pick = (name) => {
    if (excluded.has(name)) return;
    plateUI.selected = plateUI.selected === name ? null : name;
    plateUI.confirmUntil = 0;
    renderPlate(lastPrinterState);
    const btn = document.querySelector(`[data-plate-pick="${CSS.escape(name)}"]`);
    if (btn) btn.focus();
  };
  document.querySelectorAll('[data-plate-pick]').forEach(b => { b.onclick = () => pick(b.dataset.platePick); });
  document.querySelectorAll('[data-plate-obj]').forEach(p => { p.onclick = () => pick(p.dataset.plateObj); });
}

/* Pause and Cancel only while there is a print to pause or cancel; otherwise the next step. */
function showIdleActions(runButtons, idleButton, active) {
  runButtons.forEach(b => { if (b && b.dataset.phase !== 'sending' && b.hidden !== !active) b.hidden = !active; });
  if (idleButton && idleButton.hidden !== active) idleButton.hidden = active;
}
document.addEventListener('click', e => {
  const go = e.target.closest && e.target.closest('[data-go-card]');
  if (!go) return;
  showTab('control');
  setTimeout(() => { const card = $(go.dataset.goCard); if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
});

function renderOverviewControl(state) {
  const host = $('overview-control');
  if (!host) return;
  if (!state || !state.state) {
    host.innerHTML = noPrinterEmpty('Turn on demo data to preview.');
    host.dataset.built = '';
    return;
  }
  if (!host.dataset.built) {
    host.dataset.built = '1';
    host.innerHTML = `
      <div class="card-sub" style="margin-bottom:8px;" id="ov-file"></div>
      <div class="bar" style="margin-bottom:14px;"><span id="ov-bar"></span></div>
      <div style="display:flex; gap:8px;" id="ov-run">
        <button class="btn primary" id="ov-pause-resume" style="flex:1;">Pause</button>
        <button class="btn danger" id="ov-cancel" style="flex:1;">Cancel</button>
      </div>
      <div class="ov-idle" id="ov-idle" hidden>
        <button class="btn primary" type="button" data-go-card="pp-print">Print a file…</button>
        <button class="btn" type="button" data-go-card="pp-heaters">Warm up…</button>
      </div>
      <div class="ov-restart" id="ov-restart-row" hidden>
        <p class="field-hint" id="ov-error"></p>
        <button class="btn" id="ov-restart" type="button">Restart firmware to clear the error</button>
      </div>`;
  }
  // A printer stopped with an error recovers with Klipper's firmware restart,
  // offered only then (a restart at any other time would end a print).
  // A printer the dashboard can't reach isn't "stopped with an error": a
  // restart couldn't reach it either, so the card says what is wrong instead.
  const lost = !!state.link_lost;
  const errored = state.state === 'error' && !lost;
  $('ov-restart-row').hidden = !errored && !lost;
  $('ov-restart').hidden = !errored;
  if (lost) {
    setText($('ov-error'), linkLostWords(state));
  } else if (errored) {
    setText($('ov-error'), state.state_message ? `Stopped: ${state.state_message}. Fix the cause first, then restart.` : 'The printer stopped with an error.');
    $('ov-restart').onclick = () => { if (confirm('Restart the printer\'s firmware (FIRMWARE_RESTART)? Do it once the cause of the error is fixed.')) controlAction('restart', $('ov-restart')); };
  }
  const running = (state.state === 'printing' || state.state === 'paused') && !lost;
  setText($('ov-file'), running || state.state === 'complete' ? (state.current_file || '') : 'Ready for a print');
  const barWidth = `${Math.round((state.progress || 0) * 100)}%`;
  if ($('ov-bar').style.width !== barWidth) $('ov-bar').style.width = barWidth;
  const pauseResume = $('ov-pause-resume');
  const cancel = $('ov-cancel');
  if (pauseResume.dataset.phase !== 'sending') {
    if (pauseResume.disabled !== !running) pauseResume.disabled = !running;
    setText(pauseResume, state.state === 'paused' ? 'Resume' : 'Pause');
  }
  pauseResume.onclick = () => controlAction(state.state === 'paused' ? 'resume' : 'pause', pauseResume);
  if (cancel.dataset.phase !== 'sending' && cancel.disabled !== !running) cancel.disabled = !running;
  cancel.onclick = () => confirmCancel(cancel);
  const active = running || lost || state.state === 'error';
  if ($('ov-run').hidden !== !active) $('ov-run').hidden = !active;
  if ($('ov-idle').hidden !== active) $('ov-idle').hidden = active;
  const bar = $('ov-bar').parentElement;
  if (bar.hidden !== !active && state.state !== 'complete') bar.hidden = !active && state.state !== 'complete';
}

const CONTROL_LABELS = {
  pause: { sending: 'Pausing…', done: 'Paused', failed: 'Pause failed', expect: s => s.state === 'paused' },
  resume: { sending: 'Resuming…', done: 'Resumed', failed: 'Resume failed', expect: s => s.state === 'printing' },
  cancel: { sending: 'Cancelling…', done: 'Print cancelled', failed: 'Cancel failed', expect: s => s.state === 'ready' },
  restart: { sending: 'Restarting…', done: 'Firmware restarted', failed: 'Restart failed', expect: s => s.state !== 'error' },
};

/* A real printer the dashboard has lost (or never reached), in words. */
function linkLostWords(state) {
  const name = state.printer_name || 'The printer';
  if (state.never_connected) {
    return `${name} hasn't answered yet${state.state_message ? ` (${state.state_message})` : ''}. ` +
      'Check it is switched on and that this computer can reach its network. The dashboard keeps trying, and looks for it at a new address by itself.';
  }
  const at = state.link_lost_at && new Date(state.link_lost_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `No live link to ${name}${at ? ` since ${at}` : ''}. Its last reading is shown. ` +
    'Controls come back when it answers; the dashboard keeps trying.';
}

/* Cancelling a print can't be undone, so one click (or a stray tap on a
 * phone) only arms the button; a second press within 4 s cancels. The fleet
 * bar and the quick-action bar already ask the same way. */
function confirmCancel(button) {
  if (button.dataset.armed) {
    clearTimeout(Number(button.dataset.armed));
    delete button.dataset.armed;
    button.classList.remove('is-armed');
    button.textContent = button.dataset.label;
    controlAction('cancel', button);
    return;
  }
  button.dataset.label = button.textContent;
  button.textContent = 'Press again to cancel';
  button.classList.add('is-armed');
  button.dataset.armed = String(setTimeout(() => {
    delete button.dataset.armed;
    button.classList.remove('is-armed');
    button.textContent = button.dataset.label;
  }, 4000));
}

async function controlAction(action, button) {
  const outcome = await runCommand(button, `/api/printer/control/${action}`, {}, CONTROL_LABELS[action]);
  loadPrinterConsole();
  return outcome;
}

/* Console helpers: Up and Down bring back earlier commands (kept in this browser,
 * newest first, at most 50), and the box suggests the printer's own macros and the
 * common commands with what each does. */
const GCODE_HINTS = [
  ['G28', 'Home all axes'], ['G28 X Y', 'Home X and Y'], ['G28 Z', 'Home Z'], ['M84', 'Motors off'],
  ['G90', 'Absolute moves'], ['G91', 'Relative moves'], ['G1 Z10 F600', 'Move Z to 10 mm'],
  ['M104 S210', 'Nozzle to 210 °C'], ['M140 S60', 'Bed to 60 °C'], ['M106 S255', 'Part fan full'], ['M107', 'Part fan off'],
  ['M220 S100', 'Speed 100%'], ['M221 S100', 'Flow 100%'], ['BED_MESH_CALIBRATE', 'Measure the bed'],
  ['SET_PRESSURE_ADVANCE ADVANCE=0.04', 'Pressure advance'], ['QUERY_ENDSTOPS', 'Endstop states'],
  ['GET_POSITION', 'Where the head is'], ['STATUS', 'Klipper status'], ['HELP', 'Every command the printer knows']
];
let gcodeHistory = null, gcodeAt = -1;
function gcodeHistoryList() {
  if (!gcodeHistory) {
    try { gcodeHistory = JSON.parse(localStorage.getItem('dejavu1.gcode.history') || '[]'); } catch (_) { gcodeHistory = []; }
    if (!Array.isArray(gcodeHistory)) gcodeHistory = [];
  }
  return gcodeHistory;
}
function rememberGcode(command) {
  const list = gcodeHistoryList().filter(c => c !== command);
  list.unshift(command);
  gcodeHistory = list.slice(0, 50);
  gcodeAt = -1;
  try { localStorage.setItem('dejavu1.gcode.history', JSON.stringify(gcodeHistory)); } catch (_) { /* a convenience only */ }
}
function gcodeKeys(e) {
  if (e.key === 'Enter') { sendGcode(); return; }
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const list = gcodeHistoryList();
  if (!list.length) return;
  e.preventDefault();
  gcodeAt = Math.max(-1, Math.min(list.length - 1, gcodeAt + (e.key === 'ArrowUp' ? 1 : -1)));
  e.currentTarget.value = gcodeAt < 0 ? '' : list[gcodeAt];
}
function gcodeSuggestions(state) {
  const input = $('gcode-input');
  let list = $('gcode-hints');
  if (!list) {
    list = document.createElement('datalist');
    list.id = 'gcode-hints';
    input.after(list);
    input.setAttribute('list', 'gcode-hints');
  }
  const macros = ((state && state.tuning && state.tuning.macros) || []).map(m => [typeof m === 'string' ? m : m.name, 'Printer macro']);
  // The printer's own HELP list (printer-extras.js) comes after the common commands.
  const own = window.PrinterExtras ? PrinterExtras.helpHints() : [];
  const html = [...macros, ...GCODE_HINTS, ...gcodeHistoryList().slice(0, 10).map(c => [c, 'Sent before']), ...own]
    .filter((h, i, all) => h[0] && all.findIndex(x => x[0] === h[0]) === i)
    .map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
  if (list.dataset.html !== html) { list.innerHTML = html; list.dataset.html = html; }
}

async function sendGcode() {
  const input = $('gcode-input');
  const command = input.value.trim();
  if (!command) return;
  rememberGcode(command);
  const outcome = await runCommand($('gcode-send'), '/api/printer/control/gcode', { command },
    { sending: 'Sending…', done: `Sent ${command}`, failed: `${command} failed` });
  if (outcome.ok) input.value = '';
  await loadPrinterConsole();
}

async function loadPrinterConsole() {
  const data = await getJSON(api('/api/printer/control/console'));
  if (isModuleDisabled(data) || !hasData(data) || !data.log) {
    $('gcode-log').innerHTML = '';
    return;
  }
  $('gcode-log').innerHTML = [...data.log].reverse().map(entry => `
    <div><span class="c-cmd">&gt; ${esc(entry.detail)}</span></div>
    <div class="c-detail ${entry.kind === 'error' ? 'is-failed' : ''}">${entry.kind === 'error' ? 'failed' : 'ok'}: ${esc(entry.kind)}</div>`).join('') || '<span class="c-detail">No commands sent yet.</span>';
}

async function loadPrinterControl() {
  const data = await getJSON(api('/api/printer'));
  if (isModuleDisabled(data)) {
    renderControlTab(null);
    $('ctrl-temps').innerHTML = moduleDisabledEmpty('Printer control');
    return;
  }
  if (!hasData(data) || !data.state) {
    renderControlTab(null);
    return;
  }
  renderControlTab(data);
  loadPrinterConsole();
}

/* ---- Watch-only mode -----------------------------------------------------*/

/* The server refuses every command to a real printer while it is on; this only
   shows it (top bar label, Settings switch). Checked with the update watcher. */
function showWatchOnly(w) {
  const on = !!(w && w.on);
  const pill = $('watch-only-pill'), box = $('watch-only-setting'), note = $('watch-only-note');
  if (pill) pill.hidden = !on;
  if (box) { box.checked = on; box.disabled = !!(w && w.forced); }
  if (note && w) note.textContent = w.forced
    ? 'Switched on when Deja Vu1 started (DEJAVU_WATCH_ONLY), so it stays on until Deja Vu1 starts without it.'
    : on ? 'On. Pause, Cancel, Move, Heat, Start and the console are refused by the server. Emergency stop still works. Demo printers stay playable.'
      : 'The server refuses the commands itself, so no screen, rule or queue can send one. Demo printers stay playable.';
  document.documentElement.classList.toggle('is-watch-only', on);
}

function initWatchOnly() {
  const box = $('watch-only-setting');
  if (!box) return;
  box.addEventListener('change', async () => {
    const want = box.checked;
    const r = await postJSON('/api/app/watch-only', { on: want });
    if (!r.ok) { box.checked = !want; toast(`Not changed: ${r.body.error || `HTTP ${r.status}`}`, 'warn', 7000); return; }
    showWatchOnly(r.body);
    toast(want ? 'Watch-only mode on: nothing that moves, heats or prints reaches your printers' : 'Watch-only mode off', want ? 'ok' : 'info', 6000);
  });
  const pill = $('watch-only-pill');
  if (pill) pill.addEventListener('click', () => {
    showTab('modules');
    $('watch-only-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  getJSON('/api/app/watch-only').then(showWatchOnly).catch(() => {});
}

/* ---- Filament inventory --------------------------------------------------*/

/* A spool's weight in words, with how far to trust it: "Weight unknown" is
   never shown as 0 g, and an estimate carries a ≈. Used by workshop.js too. */
function spoolWeight(s) {
  if (!s || s.grams_remaining == null) return '<span class="spool-grams is-unknown" title="Nobody has weighed this spool yet, so nothing treats it as empty or full">Weight unknown</span>';
  const g = Math.round(s.grams_remaining);
  const from = s.weight_from === 'spoolman' ? 'Spoolman\'s count' : 'an estimate';
  if (s.weight_source === 'weighed') return `<span class="spool-grams ${g < 80 ? 'is-low' : ''}" title="Weighed on a scale">${g} g <small>weighed</small></span>`;
  return `<span class="spool-grams ${g < 80 ? 'is-low' : ''}" title="From ${from}${s.used_since_weighed ? `, ${s.used_since_weighed} g printed since` : ''}">≈ ${g} g</span>`;
}

async function loadFilament() {
  const data = await getJSON('/api/filament');
  const host = $('spool-list');
  const idleNote = $('spool-idle-note');

  if (isModuleDisabled(data)) {
    host.innerHTML = moduleDisabledEmpty('Filament inventory');
    idleNote.hidden = true;
    return;
  }

  const spools = data.spools || [];
  if (data.spoolman && data.spoolman.url && !$('spoolman-url').value) $('spoolman-url').value = data.spoolman.url;
  host.innerHTML = spools.length ? spools.map(s => `
    <div class="spool-row">
      <span class="spool-swatch" style="background:${esc(s.color_hex || '#888')}"></span>
      <span class="spool-name">${esc(s.color_name)} ${esc(s.material)}${s.spoolman_id ? ` <small class="spool-src" title="Imported from Spoolman (spool ${esc(s.spoolman_id)})">Spoolman</small>` : ''}</span>
      ${spoolWeight(s)}
      <button class="btn small" type="button" data-weigh-spool="${esc(s.id)}" aria-expanded="false">Weigh</button>
      <button class="btn small" data-remove-spool="${esc(s.id)}">Remove</button>
    </div>
    <form class="spool-weigh" data-weigh-form="${esc(s.id)}" hidden>
      <label for="weigh-${esc(s.id)}">Filament left on ${esc(s.color_name)} ${esc(s.material)}, without the empty spool</label>
      <input type="number" id="weigh-${esc(s.id)}" min="0" max="100000" step="1" inputmode="decimal" placeholder="Grams" required>
      <button class="btn small primary" type="submit">Save weight</button>
      <button class="btn small" type="button" data-weigh-unknown>I don't know</button>
    </form>`).join('') : EMPTY('No spools tracked', 'Add one below.');

  host.querySelectorAll('[data-weigh-spool]').forEach(btn => {
    btn.addEventListener('click', () => {
      const form = host.querySelector(`[data-weigh-form="${CSS.escape(btn.dataset.weighSpool)}"]`);
      form.hidden = !form.hidden;
      btn.setAttribute('aria-expanded', String(!form.hidden));
      if (!form.hidden) form.querySelector('input').focus();
    });
  });
  host.querySelectorAll('[data-weigh-form]').forEach(form => {
    const save = async grams => {
      const r = await postJSON(api(`/api/filament/spools/${encodeURIComponent(form.dataset.weighForm)}/grams`),
        { grams_remaining: grams, weight_source: 'weighed' });
      if (!r.ok) { toast(`Weight not saved: ${r.body.error || `HTTP ${r.status}`}`, 'warn', 6000); return; }
      toast(grams == null ? 'Weight set back to unknown' : `Saved ${Math.round(grams)} g, weighed`, 'ok');
      loadFilament();
    };
    form.addEventListener('submit', e => { e.preventDefault(); save(parseFloat(form.querySelector('input').value)); });
    form.querySelector('[data-weigh-unknown]').addEventListener('click', () => save(null));
  });

  host.querySelectorAll('[data-remove-spool]').forEach(btn => {
    btn.addEventListener('click', () => {
      postJSON(api(`/api/filament/spools/${btn.dataset.removeSpool}/remove`), {}).then(loadFilament);
    });
  });

  loadCharges(spools);

  const idle = data.idle_spools || [];
  if (idle.length) {
    idleNote.hidden = false;
    idleNote.textContent = `${idle[0].color_name} has been loaded ${idle[0].days_loaded.toFixed(0)} days. Worth checking it hasn't absorbed moisture.`;
  } else {
    idleNote.hidden = true;
  }
}

/* Finished prints and the roll each was charged to, with the one correction:
   move a charge to the roll that really printed it. */
async function loadCharges(spools) {
  const wrap = $('spool-charges-wrap');
  if (!wrap) return;
  const data = await getJSON(api('/api/filament/charges')).catch(() => null);
  const charges = (data && data.charges) || [];
  wrap.hidden = !charges.length;
  if (!charges.length) return;
  const others = id => spools.filter(s => s.id !== id)
    .map(s => `<option value="${esc(s.id)}">${esc(s.color_name)} ${esc(s.material)}</option>`).join('');
  $('spool-charges').innerHTML = charges.slice(0, 8).map(c => `
    <div class="charge-row${c.assignment_changed && c.assignment_changed.length ? ' is-changed' : ''}">
      <span class="charge-what"><b>${esc(c.file || 'A print')}</b> · ${esc(c.toolhead || '')} · ${c.grams} g from ${esc(c.spool)}
        <small>${c.moved_to ? `moved to ${esc(c.moved_to_name || c.moved_to)}` : c.basis === 'assigned at start' ? 'the roll assigned when it started' : 'the nearest matching spool'}${c.assignment_changed && c.assignment_changed.length ? ', changed during the print' : ''}</small></span>
      ${c.moved_to || spools.length < 2 ? '' : `<label class="sr-only" for="mv-${esc(c.id)}">Move this charge to</label>
        <select id="mv-${esc(c.id)}" data-move-charge="${esc(c.id)}"><option value="">Move to another roll…</option>${others(c.spool_id)}</select>`}
    </div>`).join('');
  $('spool-charges').querySelectorAll('[data-move-charge]').forEach(sel => {
    sel.addEventListener('change', async () => {
      if (!sel.value) return;
      const r = await postJSON(api(`/api/filament/charges/${encodeURIComponent(sel.dataset.moveCharge)}/move`), { spool_id: sel.value });
      if (!r.ok) { toast(`Charge not moved: ${r.body.error || `HTTP ${r.status}`}`, 'warn', 6000); sel.value = ''; return; }
      toast(`Moved ${r.body.grams} g to ${r.body.moved_to_name}`, 'ok');
      loadFilament();
    });
  });
}

/* A spool from a photo. With an AI connected it reads the label and adds the spool itself; without one, the
 * colour is measured from the middle of the photo (bright glare and dark shadow left out) and the form fills in. */
const COLOUR_NAMES = [['Red', 0], ['Orange', 28], ['Yellow', 52], ['Lime', 85], ['Green', 125], ['Teal', 170], ['Blue', 215],
  ['Purple', 270], ['Pink', 320], ['Red', 360]];
function colourFromPhoto(img) {
  const c = document.createElement('canvas'), n = 80;
  c.width = n; c.height = n;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, n, n);
  const px = g.getImageData(n * 0.3, n * 0.3, n * 0.4, n * 0.4).data;
  let r = 0, gr = 0, b = 0, k = 0;
  for (let i = 0; i < px.length; i += 4) {
    const hi = Math.max(px[i], px[i + 1], px[i + 2]), lo = Math.min(px[i], px[i + 1], px[i + 2]);
    if (hi > 245 && lo > 230) continue;              // glare
    if (hi < 18) continue;                            // deep shadow
    r += px[i]; gr += px[i + 1]; b += px[i + 2]; k++;
  }
  if (!k) { for (let i = 0; i < px.length; i += 4) { r += px[i]; gr += px[i + 1]; b += px[i + 2]; k++; } }
  [r, gr, b] = [r / k, gr / k, b / k].map(Math.round);
  const hex = '#' + [r, gr, b].map(v => v.toString(16).padStart(2, '0')).join('');
  const max = Math.max(r, gr, b) / 255, min = Math.min(r, gr, b) / 255, l = (max + min) / 2, d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let name;
  if (sat < 0.16) name = l > 0.82 ? 'White' : l < 0.18 ? 'Black' : 'Grey';
  else {
    let h = max === r / 255 ? ((gr - b) / 255 / d) % 6 : max === gr / 255 ? (b - r) / 255 / d + 2 : (r - gr) / 255 / d + 4;
    h = (h * 60 + 360) % 360;
    name = COLOUR_NAMES.reduce((best, c) => (Math.abs(c[1] - h) < Math.abs(best[1] - h) ? c : best))[0];
    if (name === 'Orange' && l < 0.32) name = 'Brown';
  }
  return { hex, name };
}

function initSpoolForm() {
  $('spool-photo').addEventListener('click', async () => {
    if (!window.Assistant || !Assistant.pickPhoto) return;
    const aiOn = document.documentElement.classList.contains('ai-on');
    const got = await Assistant.pickPhoto(true);
    if (!got) return;
    if (aiOn) {
      Assistant.ask('This is a photo of a filament spool or its label. Read the material, the colour (its name and a hex code close to it), the brand and the weight left if it shows. Then add it to my filament shelf with spool_add. Say what you could not read.', null, got.data);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const { hex, name } = colourFromPhoto(img);
      $('spool-color-hex').value = hex;
      if (!$('spool-color-name').value.trim()) $('spool-color-name').value = name;
      if (!$('spool-material').value.trim()) $('spool-material').value = 'PLA';
      $('spool-material').focus();
      toast(`Colour taken from the photo: ${name} (${hex}). Check the material and grams, then press Add spool.`, 'info', 7000);
    };
    img.src = got.data;
  });
  $('spool-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const material = $('spool-material').value.trim() || 'PLA';
    const colorName = $('spool-color-name').value.trim() || 'Unnamed';
    const colorHex = $('spool-color-hex').value;
    // An empty field is "not known", never 0 g (which would mean an empty roll).
    const typed = $('spool-grams').value.trim();
    const grams = typed === '' ? null : parseFloat(typed);
    const r = await postJSON(api('/api/filament/spools'), {
      material, color_name: colorName, color_hex: colorHex, grams_remaining: grams,
      weight_source: grams == null ? null : ($('spool-weighed').checked ? 'weighed' : 'estimated'),
    });
    // A refused spool keeps what was typed, and says why.
    if (!r.ok) { toast(`Spool not added: ${r.body.error || `HTTP ${r.status}`}`, 'warn', 6000); return; }
    e.target.reset();
    $('spool-color-hex').value = '#ff7a2f';
    toast(`Added ${r.body.color_name} ${r.body.material}`, 'ok');
    loadFilament();
  });
  $('spoolman-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const out = $('spoolman-result');
    btn.disabled = true; btn.textContent = 'Importing…';
    const r = await postJSON(api('/api/filament/spoolman'), { url: $('spoolman-url').value });
    btn.disabled = false; btn.textContent = 'Import spools';
    if (!r.ok) { out.textContent = `Not imported: ${r.body.error || `HTTP ${r.status}`}`; out.classList.add('is-bad'); return; }
    const b = r.body;
    out.classList.remove('is-bad');
    out.textContent = `${b.found} spool${b.found === 1 ? '' : 's'} in Spoolman: ${b.added} added, ${b.updated} updated.`
      + (b.unknown_weight ? ` ${b.unknown_weight} had no weight in Spoolman, so ${b.unknown_weight === 1 ? 'it shows' : 'they show'} Weight unknown: set it there or weigh ${b.unknown_weight === 1 ? 'it' : 'them'} here.` : '')
      + (b.repaired_unknown ? ` ${b.repaired_unknown} saved as 0 g by an older import ${b.repaired_unknown === 1 ? 'is' : 'are'} back to Weight unknown.` : '')
      + (b.not_added_full ? ` ${b.not_added_full} didn't fit - the inventory is full.` : '')
      + (b.skipped.length ? ` Skipped: ${b.skipped.join('; ')}.` : '');
    toast(`Spoolman: ${b.added} added, ${b.updated} updated`, 'ok');
    loadFilament();
  });
}

/* ---- What changed? / repeat last settings --------------------------------*/

async function loadCompare() {
  const [compareData, sanityData] = await Promise.all([
    getJSON(api('/api/compare')),
    getJSON(api('/api/sanity')),
  ]);
  const host = $('compare-body');
  const rows = [];

  if (hasData(sanityData) && !isModuleDisabled(sanityData) && sanityData.reasons) {
    if (sanityData.safe_to_print) {
      rows.push(`<div class="crow" style="border-left:3px solid var(--ok);">${(sanityData.colour_compared ?? sanityData.colour_measured) === false
        ? 'Safe to print: maintenance and docks check out. No optical colour comparison; Confirm Print still compares the file with what the printer reports loaded.'
        : 'Safe to print: maintenance, dock, and colour all check out.'}</div>`);
    } else {
      sanityData.reasons.forEach(msg => rows.push(`<div class="crow" style="border-left:3px solid var(--bad);">${esc(msg)}</div>`));
    }
  }

  if (isModuleDisabled(compareData) && !rows.length) {
    paint(host, moduleDisabledEmpty('What changed?'));
    return;
  }
  if (hasData(compareData) && compareData.has_history) {
    compareData.likely_causes.forEach(msg => rows.push(`<div class="crow" style="border-left:3px solid var(--bad);">${esc(msg)}</div>`));
    compareData.differences.forEach(msg => rows.push(`<div class="crow" style="border-left:3px solid var(--warn);">${esc(msg)}</div>`));
  }

  paint(host, rows.length ? rows.join('') : EMPTY('Nothing to check yet', 'Needs a printer connection and print history for this file.'));
}

function initRepeatSettings() {
  $('repeat-settings-btn').addEventListener('click', async () => {
    const data = await getJSON(api('/api/compare/repeat'));
    const host = $('repeat-settings-body');
    if (isModuleDisabled(data)) {
      host.innerHTML = moduleDisabledEmpty('What changed?');
      return;
    }
    if (!hasData(data) || data.error) {
      host.innerHTML = `<p class="log-empty">${esc(data.error || 'No successful history for this file yet.')}</p>`;
      return;
    }
    host.innerHTML = `
      <div class="log-row"><span>Filament</span><span>${esc(data.filament_color_name)} ${esc(data.filament_type)}</span></div>
      <div class="log-row"><span>Toolheads used</span><span>${esc(data.toolheads_used.join(', '))}</span></div>
      <div class="log-row"><span>From</span><span>${esc(data.printed_at.slice(0, 10))}</span></div>`;
  });
}
