/* Deja Vu1 dashboard logic.
 *
 * Asks the Python backend for data and draws it. Plain JavaScript — no
 * framework, no build step, nothing to install.
 *
 * The important rule here: with no printer connected, the backend returns no
 * figures at all. The dashboard shows empty states until the user explicitly
 * turns on demo data, which adds ?demo=1 to every request. Simulated numbers
 * are always badged as such.
 */

/* ---- small helpers ----------------------------------------------------- */

const $ = id => document.getElementById(id);

function esc(text) {
  return String(text).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function getJSON(url) {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  return body;
}

async function postJSON(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

const STORE_KEY = 'dejavu1.demo';
let demoOn = localStorage.getItem(STORE_KEY) === '1';

function api(path) {
  return path + (demoOn ? (path.includes('?') ? '&' : '?') + 'demo=1' : '');
}

function hasData(payload) {
  return payload && payload.connected !== undefined
    ? (payload.connected || payload.demo)
    : Boolean(payload);
}

function isModuleDisabled(payload) {
  return Boolean(payload && payload.module_disabled);
}

function moduleDisabledEmpty(name) {
  return EMPTY(`${name} is off`, 'Turn it back on from Modules & devices.');
}

const STATUS_TEXT = { overdue: 'Overdue', due_soon: 'Due soon', ok: 'OK' };

function stagger(nodes, step = 45) {
  nodes.forEach((node, i) => { node.style.animationDelay = `${i * step}ms`; });
}

const EMPTY = (title, sub) => `
  <div class="empty">
    <span class="empty-mark" aria-hidden="true"></span>
    <p class="empty-title">${esc(title)}</p>
    <p class="empty-sub">${esc(sub)}</p>
  </div>`;

/* ---- temperature units --------------------------------------------------
 * A real user-facing preference: stored per-viewer, used everywhere a
 * temperature is displayed. */

const UNIT_KEY = 'dejavu1.units';
let tempUnit = localStorage.getItem(UNIT_KEY) === 'F' ? 'F' : 'C';

function formatTemp(celsius) {
  if (celsius === null || celsius === undefined) return '—';
  const value = tempUnit === 'F' ? (celsius * 9 / 5) + 32 : celsius;
  return `${value.toFixed(0)}°${tempUnit}`;
}

/* ---- accent colour -------------------------------------------------------
 * A real user-facing preference: swaps the CSS custom properties every
 * accent-coloured element already reads from. */

const ACCENTS = [
  { id: 'orange', label: 'Snapmaker Orange', hex: '#ff7a2f', light: '#ff9c66' },
  { id: 'red', label: 'Signal Red', hex: '#c8102e', light: '#e0475f' },
  { id: 'blue', label: 'Sky Blue', hex: '#3b82f6', light: '#6fa8ff' },
  { id: 'green', label: 'Grass Green', hex: '#2f9e44', light: '#5cc16f' },
];
const ACCENT_KEY = 'dejavu1.accent';

function applyAccent(id) {
  const accent = ACCENTS.find(a => a.id === id) || ACCENTS[0];
  document.documentElement.style.setProperty('--accent', accent.hex);
  document.documentElement.style.setProperty('--accent-light', accent.light);
  localStorage.setItem(ACCENT_KEY, accent.id);
  document.querySelectorAll('.accent-swatch').forEach(el => {
    el.classList.toggle('is-active', el.dataset.accent === accent.id);
  });
}

function initPreferences() {
  const host = $('accent-swatches');
  host.innerHTML = ACCENTS.map(a => `
    <button class="accent-swatch" data-accent="${a.id}" aria-label="${esc(a.label)}"
            style="background:${a.hex};"></button>
  `).join('');
  host.querySelectorAll('.accent-swatch').forEach(btn => {
    btn.addEventListener('click', () => applyAccent(btn.dataset.accent));
  });
  applyAccent(localStorage.getItem(ACCENT_KEY) || 'orange');

  const setUnits = (unit) => {
    tempUnit = unit;
    localStorage.setItem(UNIT_KEY, unit);
    $('units-c').classList.toggle('active', unit === 'C');
    $('units-f').classList.toggle('active', unit === 'F');
    loadPrinterControl();
    renderOverviewControl(lastPrinterState);
  };
  $('units-c').addEventListener('click', () => setUnits('C'));
  $('units-f').addEventListener('click', () => setUnits('F'));
  setUnits(tempUnit);
}

/* ---- connection state ---------------------------------------------------*/

async function loadConnection() {
  const data = await getJSON('/api/connection');
  const pill = $('conn');
  const label = $('conn-label');

  if (data.connected) {
    pill.classList.remove('is-demo');
    label.textContent = 'Connected';
    $('foot-state').textContent = 'Connected to Moonraker.';
  } else if (demoOn) {
    pill.classList.add('is-demo');
    label.textContent = 'Demo data';
    $('foot-state').textContent = 'Demo data — no printer connected, nothing is contacted.';
  } else {
    pill.classList.remove('is-demo');
    label.textContent = 'Not connected';
    $('foot-state').textContent = 'No printer connected — nothing is contacted.';
  }

  $('notice').hidden = !(demoOn && !data.connected);
}

/* ---- tabs -----------------------------------------------------------------*/

const TAB_KEY = 'dejavu1.tab';

function initTabs() {
  const tabs = document.querySelectorAll('.navtab');
  const panels = document.querySelectorAll('.tab-panel');

  function show(name) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    panels.forEach(p => { p.hidden = p.id !== `tab-${name}`; });
    localStorage.setItem(TAB_KEY, name);
    if (name === 'games') startCurrentGame();
    else stopCurrentGame();
  }

  tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
  $('overview-pair-btn').addEventListener('click', () => show('modules'));

  show(localStorage.getItem(TAB_KEY) || 'overview');
}

/* ---- status ribbon (always visible) --------------------------------------*/

let lastPrinterState = null;

async function loadStatusRibbon() {
  const data = await getJSON(api('/api/printer'));
  const ribbon = $('status-ribbon');
  const text = $('rb-text');
  const bar = $('rb-bar');
  const fill = $('rb-bar-fill');
  const pct = $('rb-pct');

  if (!hasData(data) || !data.state) {
    ribbon.classList.remove('is-live');
    text.textContent = 'No printer connected.';
    bar.hidden = true;
    pct.hidden = true;
    lastPrinterState = null;
    return;
  }

  lastPrinterState = data;
  const isPrinting = data.state === 'printing';
  ribbon.classList.toggle('is-live', isPrinting);

  if (data.state === 'ready') {
    text.textContent = 'Idle — no print running.';
    bar.hidden = true; pct.hidden = true;
  } else {
    text.textContent = `${data.state === 'paused' ? 'Paused' : 'Printing'} — ${data.current_file || 'unknown file'}`;
    bar.hidden = false; pct.hidden = false;
    fill.style.width = `${Math.round(data.progress * 100)}%`;
    pct.textContent = `${Math.round(data.progress * 100)}%`;
  }

  renderOverviewControl(data);
  renderControlTab(data);
}

/* ---- Module: Maintenance ---------------------------------------------- */

function clearStats() {
  [['stat-hours', 'stat-hours-foot'], ['stat-prints', 'stat-prints-foot'],
   ['stat-filament', 'stat-filament-foot'], ['stat-due', 'stat-due-foot']]
    .forEach(([val, foot]) => {
      $(val).textContent = '—';
      $(foot).textContent = 'No printer';
      const wrap = $(val).closest('.stat');
      wrap.classList.add('is-empty');
      wrap.classList.remove('is-alert');
    });
}

function renderTaskRow(task) {
  return `
    <div class="task ${task.status}">
      <div>
        <div class="task-name">
          ${esc(task.name)}
          <span class="pill">${STATUS_TEXT[task.status]}</span>
        </div>
        <div class="task-desc">${esc(task.description)}</div>
        <div class="bar"><span style="width:${Math.min(task.percent, 100)}%"></span></div>
        <div class="task-meta">${esc(task.reason)} · ${task.percent.toFixed(0)}% · ~${task.est_minutes} min</div>
      </div>
      <button class="btn" data-task="${esc(task.id)}">Mark done</button>
    </div>`;
}

async function loadMaintenance() {
  const data = await getJSON(api('/api/maintenance'));

  if (isModuleDisabled(data)) {
    clearStats();
    $('tasks').innerHTML = moduleDisabledEmpty('Maintenance reminders');
    $('log-wrap').hidden = true;
    $('overview-maintenance').innerHTML = moduleDisabledEmpty('Maintenance reminders');
    return;
  }

  if (!hasData(data) || !data.tasks) {
    clearStats();
    $('tasks').innerHTML = EMPTY('No printer connected',
      'Maintenance reminders appear once print history is available. Turn on demo data to preview them.');
    $('log-wrap').hidden = true;
    $('overview-maintenance').innerHTML = EMPTY('No printer connected', 'Turn on demo data to preview.');
    return;
  }

  const totals = data.totals;
  const unit = data.demo ? 'Simulated' : 'From history';

  $('stat-hours').textContent = totals.total_print_hours.toFixed(0);
  $('stat-hours-foot').textContent = unit;
  $('stat-prints').textContent = totals.total_prints;
  $('stat-prints-foot').textContent = `${totals.failed_prints} failed`;
  $('stat-filament').textContent = (totals.total_filament_grams / 1000).toFixed(1) + ' kg';
  $('stat-filament-foot').textContent = unit;
  $('stat-due').textContent = data.summary.overdue;
  $('stat-due-foot').textContent = `${data.summary.due_soon} due soon`;

  document.querySelectorAll('.stat').forEach(t => t.classList.remove('is-empty'));
  $('stat-due').closest('.stat').classList.toggle('is-alert', data.summary.overdue > 0);

  $('tasks').innerHTML = data.tasks.map(renderTaskRow).join('');
  stagger([...document.querySelectorAll('#tasks .task')]);
  document.querySelectorAll('#tasks .btn').forEach(button => {
    button.addEventListener('click', () => markDone(button));
  });

  // Overview tab gets the top 3 most urgent, read-only.
  $('overview-maintenance').innerHTML = data.tasks.length
    ? data.tasks.slice(0, 3).map(t => `
        <div class="task ${t.status}" style="margin-bottom:9px;">
          <div>
            <div class="task-name">${esc(t.name)} <span class="pill">${STATUS_TEXT[t.status]}</span></div>
            <div class="task-meta">${esc(t.reason)}</div>
          </div>
        </div>`).join('')
    : EMPTY('All caught up', 'Nothing due right now.');

  $('log-wrap').hidden = false;
  loadMaintenanceLog();
}

async function markDone(button) {
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const { ok } = await postJSON(api('/api/maintenance/done'), { task_id: button.dataset.task });
    if (!ok) throw new Error('save failed');
    await loadMaintenance();
  } catch (err) {
    console.error('Could not mark task done:', err);
    button.disabled = false;
    button.textContent = 'Retry';
  }
}

async function loadMaintenanceLog() {
  const data = await getJSON(api('/api/maintenance/history'));
  const box = $('mlog');
  const history = data.history || [];

  if (!history.length) {
    box.innerHTML = '<p class="log-empty">Nothing logged yet. Mark a task done above and it will appear here.</p>';
    return;
  }

  box.innerHTML = history.map(item => `
    <div class="log-row">
      <span>${esc(item.task_name)}</span>
      <span>${esc(item.completed_at.replace('T', ' ').slice(0, 16))} · ${item.printer_hours_at_completion.toFixed(0)} h</span>
    </div>`).join('');
}

/* ---- Module: LED dock rings --------------------------------------------*/

async function loadRings() {
  const data = await getJSON(api('/api/leds'));

  if (isModuleDisabled(data)) {
    $('rings').innerHTML = moduleDisabledEmpty('Dock status rings');
    $('rings-note').hidden = true;
    return;
  }
  if (!hasData(data) || !data.rings) {
    $('rings').innerHTML = EMPTY('No signal', 'Ring colours follow live printer state.');
    $('rings-note').hidden = true;
    return;
  }

  $('rings').innerHTML = data.rings.map(ring => {
    const effect = ring.effect === 'solid' ? '' : ring.effect;
    const pct = ring.state === 'active' ? `<div class="ring-pct">${Math.round(ring.progress * 100)}%</div>` : '';
    return `
      <div class="ring-cell">
        <div class="ring ${effect}" style="color:${esc(ring.color_hex)}"><div class="ring-core"></div></div>
        <div class="ring-id">${esc(ring.toolhead)}</div>
        <div class="ring-label">${esc(ring.label)}</div>
        ${pct}
      </div>`;
  }).join('');

  stagger([...document.querySelectorAll('.ring-cell')], 60);
  $('rings-note').hidden = false;
}

/* ---- Module: colour check ------------------------------------------------*/

async function loadColorCheck() {
  const data = await getJSON(api('/api/colorcheck'));

  if (isModuleDisabled(data)) {
    $('colorfile').hidden = true;
    $('colors').innerHTML = moduleDisabledEmpty('Right colour loaded?');
    $('colors-note').hidden = true;
    return;
  }
  if (!hasData(data) || !data.checks) {
    $('colorfile').hidden = true;
    $('colors').innerHTML = EMPTY('Nothing to check', 'Needs a print file and a sensor reading.');
    $('colors-note').hidden = true;
    return;
  }

  $('colorfile').textContent = data.filename;
  $('colorfile').hidden = false;

  $('colors').innerHTML = data.checks.map(check => `
    <div class="crow">
      <div class="crow-top">
        <span class="crow-head">Toolhead ${esc(check.toolhead)}</span>
        <span class="verdict ${check.verdict}">${esc(check.verdict)}</span>
      </div>
      <div class="swatches">
        <div class="sw"><span class="chip" style="background:${esc(check.expected_hex)}"></span> expected ${esc(check.expected_color_name)}</div>
        <span class="arrow" aria-hidden="true">→</span>
        <div class="sw"><span class="chip" style="background:${esc(check.detected_hex)}"></span> detected</div>
      </div>
      <div class="crow-msg">${esc(check.message)}</div>
    </div>`).join('');

  stagger([...document.querySelectorAll('.crow')], 70);
  $('colors-note').hidden = false;
}

/* ---- Printer control -----------------------------------------------------*/

function renderControlTab(state) {
  const dot = $('ctrl-state-dot');
  const text = $('ctrl-state-text');
  const sub = $('ctrl-state-sub');
  const pauseResume = $('ctrl-pause-resume');
  const cancel = $('ctrl-cancel');
  const homeButtons = document.querySelectorAll('[data-home]');
  const gcodeInput = $('gcode-input');
  const gcodeSend = $('gcode-send');

  if (!state || !state.state) {
    dot.style.background = '';
    text.textContent = 'No printer connected';
    sub.textContent = '';
    pauseResume.disabled = true;
    pauseResume.textContent = 'Pause';
    cancel.disabled = true;
    homeButtons.forEach(b => b.disabled = true);
    gcodeInput.disabled = true;
    gcodeSend.disabled = true;
    $('ctrl-temps').innerHTML = '';
    $('gcode-log').innerHTML = '';
    return;
  }

  dot.style.background = state.state === 'printing' ? 'var(--ok)' : (state.state === 'paused' ? 'var(--warn)' : 'var(--text-faint)');
  text.textContent = state.state === 'ready' ? 'Idle' : `${state.state[0].toUpperCase()}${state.state.slice(1)} — ${state.current_file || ''}`;
  sub.textContent = state.state === 'ready' ? 'No job running.' : `${Math.round(state.progress * 100)}% · ${state.print_duration_hours.toFixed(1)}h elapsed`;

  pauseResume.disabled = !(state.state === 'printing' || state.state === 'paused');
  pauseResume.textContent = state.state === 'paused' ? 'Resume' : 'Pause';
  pauseResume.onclick = () => controlAction(state.state === 'paused' ? 'resume' : 'pause');

  cancel.disabled = !(state.state === 'printing' || state.state === 'paused');
  cancel.onclick = () => controlAction('cancel');

  homeButtons.forEach(b => {
    b.disabled = false;
    b.onclick = () => {
      const axes = b.dataset.home === 'all' ? ['X', 'Y', 'Z'] : [b.dataset.home];
      postJSON(api('/api/printer/control/home'), { axes }).then(() => loadPrinterControl());
    };
  });

  gcodeInput.disabled = false;
  gcodeSend.disabled = false;
  gcodeSend.onclick = () => sendGcode();
  gcodeInput.onkeydown = (e) => { if (e.key === 'Enter') sendGcode(); };

  $('ctrl-temps').innerHTML = Object.entries(state.toolheads).map(([th, info]) => `
    <div>
      <div class="stat-key">${esc(th)}${th === state.active_toolhead ? ' · active' : ''}</div>
      <div class="stat-val" style="font-size:22px; ${th === state.active_toolhead ? 'color:var(--accent);' : ''}">${formatTemp(info.temperature)}</div>
      <div style="display:flex; gap:6px; margin-top:8px;">
        <input type="number" placeholder="target" data-toolhead="${esc(th)}" style="width:100%; font-size:12px;">
        <button class="btn small" data-set-temp="${esc(th)}">Set</button>
      </div>
    </div>`).join('');

  $('ctrl-temps').querySelectorAll('[data-set-temp]').forEach(btn => {
    btn.addEventListener('click', () => {
      const th = btn.dataset.setTemp;
      const input = $('ctrl-temps').querySelector(`input[data-toolhead="${th}"]`);
      const celsiusValue = tempUnit === 'F'
        ? (parseFloat(input.value) - 32) * 5 / 9
        : parseFloat(input.value);
      if (Number.isNaN(celsiusValue)) return;
      postJSON(api('/api/printer/control/temperature'), { toolhead: th, target: celsiusValue })
        .then(() => loadPrinterControl());
    });
  });
}

function renderOverviewControl(state) {
  const host = $('overview-control');
  if (!host) return;
  if (!state || !state.state) {
    host.innerHTML = EMPTY('No printer connected', 'Turn on demo data to preview.');
    return;
  }
  host.innerHTML = `
    <div class="card-sub" style="margin-bottom:8px;">${state.state === 'ready' ? 'Idle' : `${esc(state.current_file || '')}`}</div>
    <div class="bar" style="margin-bottom:14px;"><span style="width:${Math.round(state.progress * 100)}%"></span></div>
    <div style="display:flex; gap:8px;">
      <button class="btn primary" id="ov-pause-resume" style="flex:1;">${state.state === 'paused' ? 'Resume' : 'Pause'}</button>
      <button class="btn danger" id="ov-cancel" style="flex:1;">Cancel</button>
    </div>`;
  const pauseResume = $('ov-pause-resume');
  const cancel = $('ov-cancel');
  if (pauseResume) {
    pauseResume.disabled = !(state.state === 'printing' || state.state === 'paused');
    pauseResume.onclick = () => controlAction(state.state === 'paused' ? 'resume' : 'pause');
  }
  if (cancel) {
    cancel.disabled = !(state.state === 'printing' || state.state === 'paused');
    cancel.onclick = () => controlAction('cancel');
  }
}

async function controlAction(action) {
  await postJSON(api(`/api/printer/control/${action}`), {});
  await loadPrinterControl();
}

async function sendGcode() {
  const input = $('gcode-input');
  const command = input.value.trim();
  if (!command) return;
  input.value = '';
  await postJSON(api('/api/printer/control/gcode'), { command });
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
    <div class="c-detail">ok — ${esc(entry.kind)}</div>`).join('') || '<span class="c-detail">No commands sent yet.</span>';
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

/* ---- Filament inventory --------------------------------------------------*/

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
  host.innerHTML = spools.length ? spools.map(s => `
    <div class="spool-row">
      <span class="spool-swatch" style="background:${esc(s.color_hex || '#888')}"></span>
      <span class="spool-name">${esc(s.color_name)} ${esc(s.material)}</span>
      <span class="spool-grams ${s.grams_remaining < 80 ? 'is-low' : ''}">${s.grams_remaining.toFixed(0)} g</span>
      <button class="btn small" data-remove-spool="${esc(s.id)}">Remove</button>
    </div>`).join('') : EMPTY('No spools tracked', 'Add one below.');

  host.querySelectorAll('[data-remove-spool]').forEach(btn => {
    btn.addEventListener('click', () => {
      postJSON(api(`/api/filament/spools/${btn.dataset.removeSpool}/remove`), {}).then(loadFilament);
    });
  });

  const idle = data.idle_spools || [];
  if (idle.length) {
    idleNote.hidden = false;
    idleNote.textContent = `${idle[0].color_name} has been loaded ${idle[0].days_loaded.toFixed(0)} days — worth checking it hasn't absorbed moisture.`;
  } else {
    idleNote.hidden = true;
  }
}

function initSpoolForm() {
  $('spool-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const material = $('spool-material').value.trim() || 'PLA';
    const colorName = $('spool-color-name').value.trim() || 'Unnamed';
    const colorHex = $('spool-color-hex').value;
    const grams = parseFloat($('spool-grams').value) || 0;
    await postJSON(api('/api/filament/spools'), {
      material, color_name: colorName, color_hex: colorHex, grams_remaining: grams,
    });
    e.target.reset();
    $('spool-color-hex').value = '#ff7a2f';
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
      rows.push(`<div class="crow" style="border-left:3px solid var(--ok);">Safe to print — maintenance, dock, and colour all check out.</div>`);
    } else {
      sanityData.reasons.forEach(msg => rows.push(`<div class="crow" style="border-left:3px solid var(--bad);">${esc(msg)}</div>`));
    }
  }

  if (isModuleDisabled(compareData) && !rows.length) {
    host.innerHTML = moduleDisabledEmpty('What changed?');
    return;
  }
  if (hasData(compareData) && compareData.has_history) {
    compareData.likely_causes.forEach(msg => rows.push(`<div class="crow" style="border-left:3px solid var(--bad);">${esc(msg)}</div>`));
    compareData.differences.forEach(msg => rows.push(`<div class="crow" style="border-left:3px solid var(--warn);">${esc(msg)}</div>`));
  }

  host.innerHTML = rows.length ? rows.join('') : EMPTY('Nothing to check yet', 'Needs a printer connection and print history for this file.');
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

/* ---- Modules ---------------------------------------------------------- */

async function loadModules() {
  const data = await getJSON('/api/modules');
  const host = $('module-list');
  const statusBadge = { ready: 'badge-live', hardware_pending: 'badge-sim', optional: 'badge-optional' };
  const statusLabel = { ready: 'Ready today', hardware_pending: 'Hardware pending', optional: 'Optional' };

  host.innerHTML = (data.modules || []).map(m => `
    <div class="modrow well" style="margin-bottom:8px; border-radius:14px;">
      <div style="flex:1;">
        <div class="mod-name">${esc(m.name)} <span class="badge ${statusBadge[m.status] || 'badge-sim'}">${statusLabel[m.status] || m.status}</span></div>
        <div class="mod-desc">${esc(m.description)}</div>
      </div>
      <label class="switch" style="gap:0;">
        <input type="checkbox" ${m.enabled ? 'checked' : ''} data-module="${esc(m.id)}">
        <span class="switch-track ${m.enabled ? 'is-on' : ''}" aria-hidden="true"><span class="switch-knob"></span></span>
      </label>
    </div>`).join('');

  host.querySelectorAll('[data-module]').forEach(input => {
    input.addEventListener('change', async () => {
      await postJSON(api(`/api/modules/${input.dataset.module}/toggle`), { enabled: input.checked });
      refreshAll();
    });
  });
}

/* ---- Pairing ------------------------------------------------------------*/

async function loadDevices() {
  const data = await getJSON('/api/pairing/devices');
  const devices = data.devices || [];
  const host = $('device-list');
  const count = $('device-count');

  host.innerHTML = devices.length ? devices.map(d => `
    <div class="log-row">
      <span>${esc(d.name)}</span>
      <span>
        <span style="margin-right:8px;">${esc(d.paired_at.slice(0, 10))}</span>
        <button class="btn small" data-unpair="${esc(d.id)}">Unpair</button>
      </span>
    </div>`).join('') : '<p class="log-empty">No devices paired yet.</p>';

  host.querySelectorAll('[data-unpair]').forEach(btn => {
    btn.addEventListener('click', () => {
      postJSON(api(`/api/pairing/devices/${btn.dataset.unpair}/unpair`), {}).then(loadDevices);
    });
  });

  if (devices.length) {
    count.hidden = false;
    count.textContent = `${devices.length} device${devices.length === 1 ? '' : 's'} paired`;
  } else {
    count.hidden = true;
  }
}

function initPairing() {
  $('generate-code-btn').addEventListener('click', async () => {
    const { body } = await postJSON('/api/pairing/code', {});
    $('pairing-code-display').style.display = 'block';
    $('pairing-code-text').textContent = (body.code || '').replace(/(\d{3})(\d{3})/, '$1 $2');
  });

  $('redeem-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const codeInput = $('redeem-code');
    const code = codeInput.value.replace(/\s/g, '');
    const { ok, body } = await postJSON('/api/pairing/redeem', { code, device_name: navigator.userAgent.includes('Mobile') ? 'Phone' : 'Browser' });
    if (ok) {
      codeInput.value = '';
      $('pairing-code-display').style.display = 'none';
      loadDevices();
    } else {
      codeInput.setCustomValidity(body.error || 'Could not pair');
      codeInput.reportValidity();
      codeInput.setCustomValidity('');
    }
  });
}

/* ---- Notifications --------------------------------------------------- */

async function loadNotificationSettings() {
  const data = await getJSON('/api/notifications/settings');
  if (isModuleDisabled(data) || !data) return;
  $('notif-ntfy').value = data.ntfy_topic || '';
  $('notif-discord').value = data.discord_webhook_url || '';
  $('notif-telegram-token').value = data.telegram_bot_token || '';
  $('notif-telegram-chat').value = data.telegram_chat_id || '';
  $('notif-quiet-start').value = data.quiet_hours_start ?? 22;
  $('notif-quiet-end').value = data.quiet_hours_end ?? 7;
}

function initNotifications() {
  $('notif-save').addEventListener('click', async () => {
    await postJSON('/api/notifications/settings', {
      ntfy_topic: $('notif-ntfy').value.trim(),
      discord_webhook_url: $('notif-discord').value.trim(),
      telegram_bot_token: $('notif-telegram-token').value.trim(),
      telegram_chat_id: $('notif-telegram-chat').value.trim(),
      quiet_hours_start: parseInt($('notif-quiet-start').value, 10) || 0,
      quiet_hours_end: parseInt($('notif-quiet-end').value, 10) || 0,
    });
    const btn = $('notif-save');
    const original = btn.textContent;
    btn.textContent = 'Saved';
    setTimeout(() => { btn.textContent = original; }, 1500);
  });

  $('notif-test').addEventListener('click', async () => {
    const btn = $('notif-test');
    const original = btn.textContent;
    btn.textContent = 'Sending…';
    await postJSON('/api/notifications/test', { message: 'Test notification from Deja Vu1' });
    btn.textContent = 'Sent';
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
}

/* ---- Updates ------------------------------------------------------------*/

async function loadUpdates() {
  const data = await getJSON(api('/api/updates'));
  const host = $('updates-body');
  if (isModuleDisabled(data)) {
    host.textContent = 'Updates module is off.';
    return;
  }
  if (!hasData(data) || !data.packages) {
    host.textContent = 'Turn on demo data, or connect a printer, to check for updates.';
    return;
  }
  if (data.updates_available === 0) {
    host.textContent = 'Everything is up to date.';
  } else {
    const names = data.packages.filter(p => p.update_available).map(p => p.name).join(', ');
    host.textContent = `Update available: ${names}.`;
  }
}

/* ---- Print cost ---------------------------------------------------------*/

async function loadCost() {
  const host = $('cost-body');
  const [current, history] = await Promise.all([
    getJSON(api('/api/cost/current')),
    getJSON(api('/api/cost/history')),
  ]);

  if (isModuleDisabled(current)) {
    host.innerHTML = moduleDisabledEmpty('Print cost calculator');
    return;
  }

  const rows = [];
  if (hasData(current) && current.total_cost !== undefined) {
    rows.push(`
      <div class="crow" style="border-left:3px solid var(--accent);">
        <strong>This print, so far:</strong> $${current.cost_so_far.toFixed(2)}
        (est. total once done: $${current.total_cost.toFixed(2)}) — ${Math.round(current.progress * 100)}% complete
      </div>`);
  }

  if (hasData(history) && history.jobs && history.jobs.length) {
    rows.push(...history.jobs.slice(0, 5).map(job => `
      <div class="log-row">
        <span>${esc(job.filename)}</span>
        <span>$${job.total_cost.toFixed(2)} · ${esc(job.filament_type)} ${job.filament_grams.toFixed(0)}g</span>
      </div>`));
  }

  host.innerHTML = rows.length ? rows.join('') : EMPTY('No cost data yet', 'Turn on demo data, or connect a printer, to see estimates.');
}

function initCostSettings() {
  getJSON('/api/cost/settings').then(data => {
    if (!data || isModuleDisabled(data)) return;
    $('cost-electricity').value = data.electricity_rate_per_kwh ?? '';
    $('cost-watts').value = data.printer_watts ?? '';
  });

  $('cost-save-btn').addEventListener('click', async () => {
    const material = $('cost-material').value.trim();
    const price = parseFloat($('cost-price').value);
    const updates = {
      electricity_rate_per_kwh: parseFloat($('cost-electricity').value) || 0,
      printer_watts: parseFloat($('cost-watts').value) || 0,
    };
    if (material && !Number.isNaN(price)) {
      updates.filament_price_per_kg = { [material]: price };
    }
    await postJSON('/api/cost/settings', updates);
    const btn = $('cost-save-btn');
    const original = btn.textContent;
    btn.textContent = 'Saved';
    setTimeout(() => { btn.textContent = original; }, 1500);
    loadCost();
  });
}

/* ---- Smart home bridges: WLED + Home Assistant ---------------------------*/

function initBridges() {
  getJSON('/api/wled/settings').then(data => {
    if (data && !isModuleDisabled(data)) $('wled-host').value = data.host || '';
  });
  getJSON('/api/homeassistant/settings').then(data => {
    if (data && !isModuleDisabled(data)) {
      $('ha-url').value = data.base_url || '';
      $('ha-token').value = data.token || '';
    }
  });

  $('wled-save-btn').addEventListener('click', async () => {
    await postJSON('/api/wled/settings', { host: $('wled-host').value.trim() });
    $('wled-status').textContent = 'Saved.';
  });

  $('wled-test-btn').addEventListener('click', async () => {
    $('wled-status').textContent = 'Testing…';
    const { body } = await postJSON('/api/wled/test', {});
    $('wled-status').textContent = body.ok ? 'WLED device reachable.' : `Could not reach it: ${body.error || 'unknown error'}`;
  });

  $('wled-push-btn').addEventListener('click', async () => {
    $('wled-status').textContent = 'Pushing…';
    const { body } = await postJSON('/api/wled/push', {});
    $('wled-status').textContent = body.ok
      ? `Pushed ${body.segments_sent} ring(s) to WLED.`
      : `Push failed: ${body.error || 'unknown error'}`;
  });

  $('ha-save-btn').addEventListener('click', async () => {
    await postJSON('/api/homeassistant/settings', {
      base_url: $('ha-url').value.trim(), token: $('ha-token').value.trim(),
    });
    $('ha-status').textContent = 'Saved.';
  });

  $('ha-push-btn').addEventListener('click', async () => {
    $('ha-status').textContent = 'Pushing…';
    const { body } = await postJSON('/api/homeassistant/push', {});
    $('ha-status').textContent = body.ok
      ? 'Pushed sensors to Home Assistant.'
      : `Push failed: ${body.error || 'unknown error'}`;
  });
}

/* ==========================================================================
   Games — 6 of them, no printer theming. Only one runs at a time; switching
   games or tabs stops whichever loop is active.
   ========================================================================== */

let activeGame = null;
let gameLoopHandle = null;

function stopCurrentGame() {
  if (gameLoopHandle) { clearInterval(gameLoopHandle); gameLoopHandle = null; }
  document.removeEventListener('keydown', mergeKeyHandler);
  document.removeEventListener('keydown', beaconKeyDownHandler);
  document.removeEventListener('keyup', beaconKeyUpHandler);
  activeGame = null;
}

function readBest(key) {
  try { const v = localStorage.getItem(key); return v ? parseInt(v, 10) : null; }
  catch (e) { return null; }
}
function saveBest(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (e) { /* ignore */ }
}

function startCurrentGame() {
  const active = document.querySelector('#game-picker button.active');
  renderGame(active ? active.dataset.game : 'skydash');
}

function initGames() {
  document.querySelectorAll('#game-picker button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#game-picker button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderGame(btn.dataset.game);
    });
  });
}

function renderGame(name) {
  stopCurrentGame();
  activeGame = name;
  const games = {
    skydash: initSkyDash, echomaze: initEchoMaze, beacon: initBeacon,
    stacker: initStacker, merge: initMerge, breakout: initBreakout,
  };
  (games[name] || initSkyDash)();
}

/* ---- Game 1: Sky Dash (flappy-style, no printer theming) --------------- */

function initSkyDash() {
  const BEST_KEY = 'dejavu1.skydash.best';
  const W = 640, H = 380, GRAVITY = 0.55, FLAP = -8, X = 90, R = 13;
  // Difficulty ramps with score: faster obstacles, a tighter gap to thread.
  const speedFor = (score) => Math.min(3 + score * 0.12, 7.5);
  const gapFor = (score) => Math.max(128 - score * 2, 86);

  $('game-stats').innerHTML = `
    <div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="sd-score">0</div></div>
    <div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="sd-best">${readBest(BEST_KEY) ?? '—'}</div></div>`;

  $('game-host').innerHTML = `
    <div class="game-surface sky-dash" id="sd-surface" style="width:${W}px; max-width:100%; height:${H}px;">
      <div class="sd-avatar" id="sd-avatar"></div>
      <div class="game-overlay" id="sd-overlay"><div class="g-title">Sky Dash</div><div class="g-sub">Click to start — click again to flap</div></div>
    </div>`;

  let state = { status: 'idle', y: H / 2, v: 0, obstacles: [], score: 0 };

  function draw() {
    $('sd-avatar').style.top = `${state.y - R}px`;
    $('sd-avatar').style.left = `${X - R}px`;
    $('sd-avatar').style.transform = `rotate(${Math.max(-25, Math.min(45, state.v * 4))}deg)`;

    document.querySelectorAll('.sd-obstacle').forEach(el => el.remove());
    const surface = $('sd-surface');
    const gap = gapFor(state.score);
    state.obstacles.forEach(o => {
      const top = document.createElement('div');
      top.className = 'sd-obstacle top';
      top.style.left = `${o.x}px`; top.style.top = '0px'; top.style.height = `${Math.max(0, o.gapY - gap / 2)}px`;
      surface.appendChild(top);
      const bottom = document.createElement('div');
      bottom.className = 'sd-obstacle bottom';
      bottom.style.left = `${o.x}px`; bottom.style.top = `${o.gapY + gap / 2}px`; bottom.style.height = `${Math.max(0, H - (o.gapY + gap / 2))}px`;
      surface.appendChild(bottom);
    });

    $('sd-score').textContent = state.score;
    const overlay = $('sd-overlay');
    if (state.status === 'playing') { overlay.style.display = 'none'; }
    else {
      overlay.style.display = 'flex';
      overlay.innerHTML = state.status === 'over'
        ? `<div class="g-title">Crashed</div><div class="g-sub">Score ${state.score} — click to try again</div>`
        : `<div class="g-title">Sky Dash</div><div class="g-sub">Click to start — click again to flap</div>`;
    }
  }

  function tick() {
    if (state.status !== 'playing') return;
    const speed = speedFor(state.score);
    const gap = gapFor(state.score);
    state.v += GRAVITY;
    state.y += state.v;

    state.obstacles = state.obstacles.map(o => ({ ...o, x: o.x - speed })).filter(o => o.x > -60);
    const last = state.obstacles[state.obstacles.length - 1];
    if (!last || last.x < W - 260) state.obstacles.push({ x: W, gapY: 90 + Math.random() * (H - 180), passed: false });

    let collided = state.y - R < 0 || state.y + R > H;
    state.obstacles = state.obstacles.map(o => {
      if (!o.passed && o.x + 50 < X) { state.score += 1; return { ...o, passed: true }; }
      return o;
    });
    state.obstacles.forEach(o => {
      if (o.x < X + R && o.x + 50 > X - R) {
        if (state.y - R < o.gapY - gap / 2 || state.y + R > o.gapY + gap / 2) collided = true;
      }
    });

    if (collided) {
      state.status = 'over';
      clearInterval(gameLoopHandle); gameLoopHandle = null;
      const best = Math.max(readBest(BEST_KEY) ?? 0, state.score);
      saveBest(BEST_KEY, best);
      $('sd-best').textContent = best;
    }
    draw();
  }

  $('sd-surface').addEventListener('click', () => {
    if (state.status !== 'playing') {
      state = { status: 'playing', y: H / 2, v: 0, obstacles: [], score: 0 };
      gameLoopHandle = setInterval(tick, 30);
    } else {
      state.v = FLAP;
    }
    draw();
  });

  draw();
}

/* ---- Game 2: Echo Maze (real CSS 3D room-by-room maze) ------------------*/

function initEchoMaze() {
  const BEST_KEY = 'dejavu1.echomaze.best';
  const N = 7;   // bigger maze than before — more rooms that all look the same
  const FACINGS = ['N', 'E', 'S', 'W'];
  const DELTA = { N: [-1, 0], E: [0, 1], S: [1, 0], W: [0, -1] };

  function generate() {
    const cells = Array.from({ length: N }, () => Array.from({ length: N }, () => ({ N: true, E: true, S: true, W: true })));
    const visited = Array.from({ length: N }, () => new Array(N).fill(false));
    const DIRS = [{ n: 'N', dr: -1, dc: 0, o: 'S' }, { n: 'E', dr: 0, dc: 1, o: 'W' }, { n: 'S', dr: 1, dc: 0, o: 'N' }, { n: 'W', dr: 0, dc: -1, o: 'E' }];
    function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
    function carve(r, c) {
      visited[r][c] = true;
      for (const d of shuffle(DIRS.slice())) {
        const nr = r + d.dr, nc = c + d.dc;
        if (nr < 0 || nr >= N || nc < 0 || nc >= N || visited[nr][nc]) continue;
        cells[r][c][d.n] = false; cells[nr][nc][d.o] = false;
        carve(nr, nc);
      }
    }
    carve(0, 0);
    return cells;
  }

  let maze = { grid: generate(), row: 0, col: 0, rotation: 0, steps: 0, won: false, visited: new Set(['0,0']) };

  $('game-host').innerHTML = `
    <div style="display:flex; gap:24px; align-items:flex-start; flex-wrap:wrap;">
      <div style="flex:1; min-width:260px;">
        <p class="card-sub" style="margin-bottom:12px; max-width:34ch;">Every room looks the same as the last — on purpose. The map only remembers rooms you've actually been in. Find the glowing exit.</p>
        <div class="maze-viewport" id="em-viewport">
          <div class="maze-cube" id="em-cube">
            <div class="maze-wall" id="em-wall-N"></div>
            <div class="maze-wall" id="em-wall-E"></div>
            <div class="maze-wall" id="em-wall-S"></div>
            <div class="maze-wall" id="em-wall-W"></div>
          </div>
          <div class="game-overlay" id="em-overlay" style="display:none;"></div>
        </div>
        <div style="display:flex; justify-content:center; gap:10px; margin-top:18px;">
          <button class="btn" id="em-left">↰ Turn left</button>
          <button class="btn primary" id="em-forward">Move forward</button>
          <button class="btn" id="em-right">Turn right ↱</button>
        </div>
      </div>
      <div style="flex:0 0 150px;">
        <p class="card-sub" style="text-align:center; margin-bottom:8px;">Map</p>
        <div class="maze-map cols-${N}" id="em-map" style="display:grid;"></div>
        <button class="btn block" id="em-new" style="margin-top:12px;">New maze</button>
      </div>
    </div>`;

  $('game-stats').innerHTML = `
    <div class="game-stat"><div class="g-key">Steps</div><div class="g-val" id="em-steps">0</div></div>
    <div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="em-best">${readBest(BEST_KEY) ?? '—'}</div></div>`;

  function draw() {
    const cell = maze.grid[maze.row][maze.col];
    $('em-cube').style.transform = `rotateY(${-maze.rotation}deg)`;
    FACINGS.forEach(dir => {
      const wall = $(`em-wall-${dir}`);
      wall.classList.toggle('solid', Boolean(cell[dir]));
      wall.classList.toggle('open', !cell[dir]);
    });
    document.getElementById('em-wall-N').style.transform = 'rotateY(0deg) translateZ(110px)';
    document.getElementById('em-wall-E').style.transform = 'rotateY(90deg) translateZ(110px)';
    document.getElementById('em-wall-S').style.transform = 'rotateY(180deg) translateZ(110px)';
    document.getElementById('em-wall-W').style.transform = 'rotateY(-90deg) translateZ(110px)';

    $('em-steps').textContent = maze.steps;
    const idx = ((Math.round(maze.rotation / 90) % 4) + 4) % 4;
    const facing = FACINGS[idx];
    $('em-forward').disabled = Boolean(cell[facing]) || maze.won;

    const map = $('em-map');
    map.style.gridTemplateColumns = `repeat(${N}, 1fr)`;
    map.innerHTML = '';
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const cellEl = document.createElement('div');
        const seen = maze.visited.has(`${r},${c}`);
        const isExit = r === N - 1 && c === N - 1;
        cellEl.className = 'mc'
          + (r === maze.row && c === maze.col ? ' here' : '')
          + (isExit && seen ? ' exit' : '')
          + (!seen ? ' unseen' : '');
        map.appendChild(cellEl);
      }
    }

    const overlay = $('em-overlay');
    overlay.style.display = maze.won ? 'flex' : 'none';
    if (maze.won) overlay.innerHTML = `<div class="g-title">You escaped</div><div class="g-sub">${maze.steps} steps — New maze to go again</div>`;
  }

  $('em-left').addEventListener('click', () => { if (!maze.won) { maze.rotation -= 90; draw(); } });
  $('em-right').addEventListener('click', () => { if (!maze.won) { maze.rotation += 90; draw(); } });
  $('em-forward').addEventListener('click', () => {
    if (maze.won) return;
    const idx = ((Math.round(maze.rotation / 90) % 4) + 4) % 4;
    const facing = FACINGS[idx];
    const cell = maze.grid[maze.row][maze.col];
    if (cell[facing]) return;
    const [dr, dc] = DELTA[facing];
    maze.row += dr; maze.col += dc; maze.steps += 1;
    maze.visited.add(`${maze.row},${maze.col}`);
    if (maze.row === N - 1 && maze.col === N - 1) {
      maze.won = true;
      const best = Math.min(readBest(BEST_KEY) ?? Infinity, maze.steps);
      saveBest(BEST_KEY, best);
      $('em-best').textContent = best;
    }
    draw();
  });
  $('em-new').addEventListener('click', () => {
    maze = { grid: generate(), row: 0, col: 0, rotation: 0, steps: 0, won: false, visited: new Set(['0,0']) };
    draw();
  });

  draw();
}

/* ---- Game 3: Beacon Run (continuous free-roam 3D world) -----------------
 * Echo Maze snaps between rooms on a grid. This one doesn't: the player has
 * a real (x, y) position and a facing angle that both change continuously,
 * the same rotate-by-negative-yaw-around-the-camera trick Echo Maze uses,
 * just generalized from 90-degree room snaps to a free-roam world:
 *   world.transform = rotateZ(-yaw) translate3d(-px, -py, 0)
 * translate3d runs first (moves the world so the player is at the origin),
 * then rotateZ turns that around the camera to match which way they're
 * facing — so beacons the player hasn't reached yet visibly slide and spin
 * past as they walk and turn, instead of the room simply swapping out.
 * --------------------------------------------------------------------- */

let beaconKeyDownHandler = () => {};
let beaconKeyUpHandler = () => {};

function initBeacon() {
  const BEST_KEY = 'dejavu1.beacon.best';
  const MOVE_SPEED = 3.2, TURN_SPEED = 2.6, COLLECT_RADIUS = 42, WORLD_HALF = 900;
  const BASE_TIME = 45, BASE_BEACONS = 6;

  $('game-stats').innerHTML = `
    <div class="game-stat"><div class="g-key">Level</div><div class="g-val" id="bc-level">1</div></div>
    <div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="bc-score">0</div></div>
    <div class="game-stat"><div class="g-key">Best level</div><div class="g-val accent" id="bc-best">${readBest(BEST_KEY) ?? '—'}</div></div>`;

  $('game-host').innerHTML = `
    <p class="card-sub" style="margin-bottom:12px; max-width:48ch;">Walk into every glowing beacon before the clock runs out — free movement, not room-by-room. WASD or arrow keys, or hold the buttons below.</p>
    <div class="beacon-viewport" id="bc-viewport">
      <div class="beacon-hud"><span id="bc-hud-left">Beacons: 0/0</span><span id="bc-hud-right">Time: —</span></div>
      <div class="beacon-horizon">
        <div class="beacon-world" id="bc-world">
          <div class="beacon-ground"></div>
        </div>
      </div>
      <div class="beacon-reticle" aria-hidden="true"></div>
      <div class="game-overlay" id="bc-overlay"><div class="g-title">Beacon Run</div><div class="g-sub">Click to start — WASD / arrows to move and turn</div></div>
    </div>
    <div class="beacon-controls">
      <button class="btn" id="bc-turnl" data-hold="turnL">↺ Turn</button>
      <button class="btn primary" id="bc-fwd" data-hold="fwd">▲ Forward</button>
      <button class="btn" id="bc-back" data-hold="back">▼ Back</button>
      <button class="btn" id="bc-turnr" data-hold="turnR">Turn ↻</button>
    </div>`;

  const keys = {};
  let state = { status: 'idle' };

  const randRange = (a, b) => a + Math.random() * (b - a);

  function spawnBeacons(count) {
    const beacons = [];
    let tries = 0;
    while (beacons.length < count && tries < count * 50) {
      tries++;
      const x = randRange(-WORLD_HALF * 0.85, WORLD_HALF * 0.85);
      const y = randRange(-WORLD_HALF * 0.85, WORLD_HALF * 0.85);
      if (Math.hypot(x, y) < 90) continue;
      if (beacons.some(b => Math.hypot(b.x - x, b.y - y) < 100)) continue;
      beacons.push({ x, y, got: false });
    }
    return beacons;
  }

  function spawnPillars(count) {
    return Array.from({ length: count }, () => ({
      x: randRange(-WORLD_HALF * 0.7, WORLD_HALF * 0.7),
      y: randRange(-WORLD_HALF * 0.7, WORLD_HALF * 0.7),
    }));
  }

  function renderStatics() {
    const world = $('bc-world');
    world.querySelectorAll('.beacon-marker, .beacon-pillar').forEach(el => el.remove());
    state.beacons.forEach((b, i) => {
      const el = document.createElement('div');
      el.className = 'beacon-marker';
      el.dataset.index = i;
      world.appendChild(el);
    });
    state.pillars.forEach(() => {
      const el = document.createElement('div');
      el.className = 'beacon-pillar';
      world.appendChild(el);
    });
    positionStatics();
  }

  function positionStatics() {
    const markers = $('bc-world').querySelectorAll('.beacon-marker');
    state.beacons.forEach((b, i) => {
      const el = markers[i];
      if (!el) return;
      el.style.display = b.got ? 'none' : '';
      el.style.transform = `translate3d(${b.x}px, ${b.y}px, 0)`;
    });
    const pillars = $('bc-world').querySelectorAll('.beacon-pillar');
    state.pillars.forEach((p, i) => {
      const el = pillars[i];
      if (el) el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    });
  }

  function newLevel(level) {
    const count = Math.min(BASE_BEACONS + (level - 1) * 2, 16);
    const carriedScore = state.score || 0;
    state = {
      status: 'playing',
      level,
      score: carriedScore,
      px: 0, py: 0, yaw: 0,
      beacons: spawnBeacons(count),
      pillars: spawnPillars(3 + Math.min(level, 5)),
      timeLeft: Math.max(BASE_TIME - (level - 1) * 2, 22),
      collected: 0,
    };
    renderStatics();
  }

  function draw() {
    if (state.status === 'idle') {
      $('bc-world').style.transform = 'translate3d(0,0,0)';
      $('bc-overlay').style.display = 'flex';
      return;
    }
    $('bc-world').style.transform = `rotateZ(${-state.yaw}deg) translate3d(${-state.px}px, ${-state.py}px, 0)`;
    $('bc-level').textContent = state.level;
    $('bc-score').textContent = state.score;
    $('bc-hud-left').textContent = `Beacons: ${state.collected}/${state.beacons.length}`;
    $('bc-hud-right').textContent = `Time: ${Math.max(Math.ceil(state.timeLeft), 0)}s`;

    const overlay = $('bc-overlay');
    overlay.style.display = state.status === 'playing' ? 'none' : 'flex';
    if (state.status === 'over') {
      overlay.innerHTML = `<div class="g-title">Out of time</div><div class="g-sub">Reached level ${state.level}, score ${state.score} — click to try again</div>`;
    }
  }

  function tick() {
    if (state.status !== 'playing') return;

    const turn = (keys.turnR ? 1 : 0) - (keys.turnL ? 1 : 0);
    const move = (keys.fwd ? 1 : 0) - (keys.back ? 1 : 0);
    state.yaw += turn * TURN_SPEED;
    const yawRad = state.yaw * Math.PI / 180;
    state.px += move * Math.sin(yawRad) * MOVE_SPEED;
    state.py += -move * Math.cos(yawRad) * MOVE_SPEED;
    state.px = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, state.px));
    state.py = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, state.py));

    state.beacons.forEach(b => {
      if (b.got) return;
      if (Math.hypot(b.x - state.px, b.y - state.py) < COLLECT_RADIUS) {
        b.got = true;
        state.collected += 1;
        state.score += 10;
      }
    });

    state.timeLeft -= 0.03;

    if (state.collected === state.beacons.length) {
      const best = Math.max(readBest(BEST_KEY) ?? 0, state.level);
      saveBest(BEST_KEY, best);
      $('bc-best').textContent = best;
      newLevel(state.level + 1);
    } else if (state.timeLeft <= 0) {
      state.status = 'over';
      clearInterval(gameLoopHandle); gameLoopHandle = null;
      const best = Math.max(readBest(BEST_KEY) ?? 0, state.level);
      saveBest(BEST_KEY, best);
      $('bc-best').textContent = best;
    } else {
      positionStatics();
    }
    draw();
  }

  function start() {
    newLevel(1);
    gameLoopHandle = setInterval(tick, 30);
    draw();
  }

  $('bc-viewport').addEventListener('click', () => {
    if (state.status !== 'playing') start();
  });

  document.querySelectorAll('[data-hold]').forEach(btn => {
    const key = btn.dataset.hold;
    const down = (e) => { e.preventDefault(); keys[key] = true; };
    const up = () => { keys[key] = false; };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('pointercancel', up);
  });

  const KEY_MAP = { KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back',
    KeyA: 'turnL', ArrowLeft: 'turnL', KeyD: 'turnR', ArrowRight: 'turnR' };
  beaconKeyDownHandler = (e) => { if (KEY_MAP[e.code]) { e.preventDefault(); keys[KEY_MAP[e.code]] = true; } };
  beaconKeyUpHandler = (e) => { if (KEY_MAP[e.code]) keys[KEY_MAP[e.code]] = false; };
  document.addEventListener('keydown', beaconKeyDownHandler);
  document.addEventListener('keyup', beaconKeyUpHandler);

  draw();
}

/* ---- Game 4: Block Stacker ------------------------------------------- */

function initStacker() {
  const BEST_KEY = 'dejavu1.stacker.best';
  const W = 300, H = 420, BLOCK_H = 26, VISIBLE_ROWS = Math.floor(H / BLOCK_H);

  $('game-stats').innerHTML = `
    <div class="game-stat"><div class="g-key">Height</div><div class="g-val" id="st-height">0</div></div>
    <div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="st-best">${readBest(BEST_KEY) ?? '—'}</div></div>`;

  $('game-host').innerHTML = `
    <div class="game-surface stacker" id="st-surface" style="width:${W}px; max-width:100%; height:${H}px;">
      <div class="game-overlay" id="st-overlay"><div class="g-title">Block Stacker</div><div class="g-sub">Click to start — click to drop each block</div></div>
    </div>`;

  const COLORS = ['#ff9c66', '#7fb2ff', '#5cc16f', '#e0475f'];
  let blocks = [];       // placed blocks, bottom to top
  let moving = null;
  let level = 0;
  let status = 'idle';

  function draw() {
    const surface = $('st-surface');
    surface.querySelectorAll('.stacker-block').forEach(el => el.remove());
    const visible = blocks.slice(-VISIBLE_ROWS);
    visible.forEach((b, i) => {
      const el = document.createElement('div');
      el.className = 'stacker-block';
      el.style.left = `${b.x}px`; el.style.width = `${b.width}px`;
      el.style.bottom = `${i * BLOCK_H}px`;
      el.style.background = b.color;
      surface.appendChild(el);
    });
    if (moving && status === 'playing') {
      const el = document.createElement('div');
      el.className = 'stacker-block';
      el.style.left = `${moving.x}px`; el.style.width = `${moving.width}px`;
      el.style.bottom = `${Math.min(level, VISIBLE_ROWS - 1) * BLOCK_H}px`;
      el.style.background = moving.color;
      surface.appendChild(el);
    }
    $('st-height').textContent = level;
    const overlay = $('st-overlay');
    overlay.style.display = status === 'playing' ? 'none' : 'flex';
    if (status === 'over') overlay.innerHTML = `<div class="g-title">Missed</div><div class="g-sub">Height ${level} — click to try again</div>`;
  }

  function spawnMoving() {
    const prev = blocks[blocks.length - 1];
    const width = prev ? prev.width : 90;
    moving = { x: 0, width, dir: 1, color: COLORS[level % COLORS.length] };
  }

  function tick() {
    if (status !== 'playing' || !moving) return;
    // Speeds up as the tower gets taller, and the margin for a clean drop
    // (blocks shrink toward the overlap already) gets less forgiving.
    const speed = Math.min(4 + level * 0.35, 11);
    moving.x += moving.dir * speed;
    if (moving.x <= 0 || moving.x + moving.width >= W) moving.dir *= -1;
    moving.x = Math.max(0, Math.min(W - moving.width, moving.x));
    draw();
  }

  function drop() {
    const prev = blocks[blocks.length - 1];
    if (!prev) {
      blocks.push({ x: moving.x, width: moving.width, color: moving.color });
    } else {
      const left = Math.max(prev.x, moving.x);
      const right = Math.min(prev.x + prev.width, moving.x + moving.width);
      const overlap = right - left;
      if (overlap <= 4) {
        status = 'over';
        clearInterval(gameLoopHandle); gameLoopHandle = null;
        const best = Math.max(readBest(BEST_KEY) ?? 0, level);
        saveBest(BEST_KEY, best);
        $('st-best').textContent = best;
        draw();
        return;
      }
      blocks.push({ x: left, width: overlap, color: moving.color });
    }
    level += 1;
    spawnMoving();
    draw();
  }

  $('st-surface').addEventListener('click', () => {
    if (status !== 'playing') {
      blocks = []; level = 0; status = 'playing';
      spawnMoving();
      gameLoopHandle = setInterval(tick, 20);
    } else {
      drop();
    }
    draw();
  });

  draw();
}

/* ---- Game 5: Merge Puzzle (2048-style) --------------------------------- */

let mergeKeyHandler = () => {};

function initMerge() {
  const BEST_KEY = 'dejavu1.merge.best';
  const SIZE = 4;

  $('game-stats').innerHTML = `
    <div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="mg-score">0</div></div>
    <div class="game-stat"><div class="g-key">Best</div><div class="g-val accent" id="mg-best">${readBest(BEST_KEY) ?? '—'}</div></div>`;

  $('game-host').innerHTML = `
    <p class="card-sub" style="text-align:center; margin-bottom:14px;">Arrow keys to play, or use the buttons below on touch.</p>
    <div class="merge-board" id="mg-board"></div>
    <div style="display:flex; justify-content:center; gap:8px; margin-top:16px; flex-wrap:wrap;">
      <button class="btn" id="mg-up">↑</button>
      <button class="btn" id="mg-down">↓</button>
      <button class="btn" id="mg-left">←</button>
      <button class="btn" id="mg-right">→</button>
      <button class="btn primary" id="mg-new">New game</button>
    </div>
    <div class="game-overlay" id="mg-overlay" style="display:none; position:static; margin-top:14px; background:none; backdrop-filter:none;"></div>`;

  const TILE_COLORS = { 2: '#f0f1f5', 4: '#ffe8d5', 8: '#ffd0a8', 16: '#ffb17a', 32: '#ff9c66', 64: '#ff7a2f',
    128: '#e0475f', 256: '#c8102e', 512: '#7fb2ff', 1024: '#3b82f6', 2048: '#34c759' };

  let grid = [];
  let score = 0;
  let over = false;

  function emptyGrid() { return Array.from({ length: SIZE }, () => new Array(SIZE).fill(0)); }

  function addRandomTile() {
    const empties = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (grid[r][c] === 0) empties.push([r, c]);
    if (!empties.length) return;
    const [r, c] = empties[Math.floor(Math.random() * empties.length)];
    // The higher the score climbs, the more often a 4 shows up instead of a
    // 2 — harder to plan around, same as the real game gets harder late.
    const twoChance = Math.max(0.9 - score / 15000, 0.68);
    grid[r][c] = Math.random() < twoChance ? 2 : 4;
  }

  function newGame() {
    grid = emptyGrid(); score = 0; over = false;
    addRandomTile(); addRandomTile();
    draw();
  }

  function slideRow(row) {
    const values = row.filter(v => v !== 0);
    const merged = [];
    let gained = 0;
    for (let i = 0; i < values.length; i++) {
      if (i < values.length - 1 && values[i] === values[i + 1]) {
        merged.push(values[i] * 2);
        gained += values[i] * 2;
        i++;
      } else {
        merged.push(values[i]);
      }
    }
    while (merged.length < SIZE) merged.push(0);
    return { row: merged, gained };
  }

  function rotateGrid(g) {
    const result = emptyGrid();
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) result[c][SIZE - 1 - r] = g[r][c];
    return result;
  }

  function move(direction) {
    if (over) return;
    let working = grid;
    let rotations = { left: 0, up: 1, right: 2, down: 3 }[direction];
    for (let i = 0; i < rotations; i++) working = rotateGrid(working);

    let moved = false;
    let gainedTotal = 0;
    const result = working.map(row => {
      const before = row.join(',');
      const { row: after, gained } = slideRow(row);
      if (after.join(',') !== before) moved = true;
      gainedTotal += gained;
      return after;
    });

    for (let i = 0; i < (4 - rotations) % 4; i++) working = rotateGrid(result);
    const final = rotations === 0 ? result : working;

    if (moved) {
      grid = final;
      score += gainedTotal;
      addRandomTile();
      if (!hasMoves()) over = true;
      draw();
      if (over) {
        const best = Math.max(readBest(BEST_KEY) ?? 0, score);
        saveBest(BEST_KEY, best);
        $('mg-best').textContent = best;
      }
    }
  }

  function hasMoves() {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] === 0) return true;
      if (c < SIZE - 1 && grid[r][c] === grid[r][c + 1]) return true;
      if (r < SIZE - 1 && grid[r][c] === grid[r + 1][c]) return true;
    }
    return false;
  }

  function draw() {
    const board = $('mg-board');
    board.innerHTML = '';
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const value = grid[r][c];
      const cell = document.createElement('div');
      cell.className = 'merge-cell';
      if (value) {
        cell.textContent = value;
        cell.style.background = TILE_COLORS[value] || '#1c1c1e';
        cell.style.color = value <= 4 ? 'var(--text)' : '#fff';
      }
      board.appendChild(cell);
    }
    $('mg-score').textContent = score;
    const overlay = $('mg-overlay');
    overlay.style.display = over ? 'flex' : 'none';
    if (over) overlay.innerHTML = `<div class="g-title">No more moves</div><div class="g-sub">Score ${score}</div>`;
  }

  mergeKeyHandler = (e) => {
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (map[e.key]) { e.preventDefault(); move(map[e.key]); }
  };
  document.addEventListener('keydown', mergeKeyHandler);

  $('mg-up').addEventListener('click', () => move('up'));
  $('mg-down').addEventListener('click', () => move('down'));
  $('mg-left').addEventListener('click', () => move('left'));
  $('mg-right').addEventListener('click', () => move('right'));
  $('mg-new').addEventListener('click', newGame);

  newGame();
}

/* ---- Game 6: Brick Break (breakout, with level progression) ------------ */

function initBreakout() {
  const BEST_KEY = 'dejavu1.breakout.best';
  const W = 480, H = 360, PADDLE_W_BASE = 80, PADDLE_H = 12, BALL_R = 6;
  const COLS = 8, BRICK_H = 18, ROWS_MAX = 7;

  $('game-stats').innerHTML = `
    <div class="game-stat"><div class="g-key">Level</div><div class="g-val" id="bo-level">1</div></div>
    <div class="game-stat"><div class="g-key">Score</div><div class="g-val" id="bo-score">0</div></div>
    <div class="game-stat"><div class="g-key">Best level</div><div class="g-val accent" id="bo-best">${readBest(BEST_KEY) ?? '—'}</div></div>`;

  $('game-host').innerHTML = `
    <div class="game-surface breakout" id="bo-surface" style="width:${W}px; max-width:100%; height:${H}px;">
      <div class="bo-paddle" id="bo-paddle" style="width:${PADDLE_W_BASE}px;"></div>
      <div class="bo-ball" id="bo-ball"></div>
      <div class="game-overlay" id="bo-overlay"><div class="g-title">Brick Break</div><div class="g-sub">Move the mouse to steer — click to launch</div></div>
    </div>`;

  const BRICK_W = W / COLS;
  const COLORS = ['#ff9c66', '#ffcc66', '#7fb2ff', '#5cc16f', '#e0475f', '#34c759', '#a78bfa'];

  // Every level shrinks the paddle a little and speeds the ball up, on top
  // of one more row of bricks, up to ROWS_MAX — it keeps going instead of
  // stopping the moment the board clears.
  let level = 1;
  let paddleW = PADDLE_W_BASE;
  let paddleX = W / 2 - paddleW / 2;
  let ball = { x: W / 2, y: H - 40, vx: 2.4, vy: -3 };
  let bricks = [];
  let score = 0;
  let status = 'idle';

  function ballSpeedMultiplier() {
    return 1 + (level - 1) * 0.14;
  }

  function resetBricks(forLevel) {
    const rows = Math.min(3 + Math.floor((forLevel - 1) / 1), ROWS_MAX);
    bricks = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < COLS; c++) {
      bricks.push({ x: c * BRICK_W, y: r * BRICK_H + 10, w: BRICK_W - 4, h: BRICK_H - 4, color: COLORS[r % COLORS.length], alive: true });
    }
  }

  function setupLevel(forLevel) {
    level = forLevel;
    paddleW = Math.max(PADDLE_W_BASE - (level - 1) * 4, 40);
    $('bo-paddle').style.width = `${paddleW}px`;
    paddleX = Math.max(0, Math.min(W - paddleW, paddleX));
    resetBricks(level);
    const speed = 3.4 * ballSpeedMultiplier();
    ball = { x: W / 2, y: H - 40, vx: speed * 0.7, vy: -speed };
  }

  function draw() {
    const surface = $('bo-surface');
    surface.querySelectorAll('.bo-brick').forEach(el => el.remove());
    bricks.forEach(b => {
      if (!b.alive) return;
      const el = document.createElement('div');
      el.className = 'bo-brick';
      el.style.left = `${b.x + 2}px`; el.style.top = `${b.y}px`;
      el.style.width = `${b.w}px`; el.style.height = `${b.h}px`;
      el.style.background = b.color;
      surface.appendChild(el);
    });
    $('bo-paddle').style.left = `${paddleX}px`;
    $('bo-paddle').style.bottom = '10px';
    $('bo-ball').style.left = `${ball.x - BALL_R}px`;
    $('bo-ball').style.top = `${ball.y - BALL_R}px`;
    $('bo-level').textContent = level;
    $('bo-score').textContent = score;

    const overlay = $('bo-overlay');
    overlay.style.display = status === 'playing' ? 'none' : 'flex';
    if (status === 'over') overlay.innerHTML = `<div class="g-title">Game over</div><div class="g-sub">Reached level ${level}, score ${score} — click to try again</div>`;
  }

  function tick() {
    if (status !== 'playing') return;
    ball.x += ball.vx; ball.y += ball.vy;

    if (ball.x - BALL_R < 0 || ball.x + BALL_R > W) ball.vx *= -1;
    if (ball.y - BALL_R < 0) ball.vy *= -1;

    const paddleY = H - 10 - PADDLE_H;
    if (ball.y + BALL_R >= paddleY && ball.y + BALL_R <= paddleY + PADDLE_H + 6 &&
        ball.x >= paddleX && ball.x <= paddleX + paddleW && ball.vy > 0) {
      const hitPos = (ball.x - paddleX) / paddleW - 0.5;
      const speed = 3.4 * ballSpeedMultiplier();
      ball.vx = hitPos * speed * 2.2;
      ball.vy = -Math.abs(speed);
    }

    bricks.forEach(b => {
      if (!b.alive) return;
      if (ball.x + BALL_R > b.x && ball.x - BALL_R < b.x + b.w && ball.y + BALL_R > b.y && ball.y - BALL_R < b.y + b.h) {
        b.alive = false;
        ball.vy *= -1;
        score += 10;
      }
    });

    if (ball.y - BALL_R > H) {
      status = 'over';
      clearInterval(gameLoopHandle); gameLoopHandle = null;
      const best = Math.max(readBest(BEST_KEY) ?? 0, level);
      saveBest(BEST_KEY, best);
      $('bo-best').textContent = best;
    } else if (bricks.every(b => !b.alive)) {
      // Cleared the board — advance instead of stopping. Score carries over.
      setupLevel(level + 1);
      const best = Math.max(readBest(BEST_KEY) ?? 0, level);
      saveBest(BEST_KEY, best);
      $('bo-best').textContent = best;
    }
    draw();
  }

  $('bo-surface').addEventListener('pointermove', (e) => {
    const rect = $('bo-surface').getBoundingClientRect();
    paddleX = Math.max(0, Math.min(W - paddleW, e.clientX - rect.left - paddleW / 2));
    if (status !== 'playing') draw();
  });

  $('bo-surface').addEventListener('click', () => {
    if (status !== 'playing') {
      score = 0; status = 'playing';
      setupLevel(1);
      gameLoopHandle = setInterval(tick, 16);
    }
  });

  setupLevel(1);
  draw();
}

/* ---- the moving specular highlight -------------------------------------*/

function trackHighlights() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let queued = false;
  document.addEventListener('pointermove', event => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      document.querySelectorAll('.liquid-glass').forEach(el => {
        const box = el.getBoundingClientRect();
        const margin = 70;
        const near = event.clientX >= box.left - margin && event.clientX <= box.right + margin &&
                     event.clientY >= box.top - margin && event.clientY <= box.bottom + margin;
        if (!near) return;
        el.style.setProperty('--mx', `${((event.clientX - box.left) / box.width) * 100}%`);
        el.style.setProperty('--my', `${((event.clientY - box.top) / box.height) * 100}%`);
      });
      queued = false;
    });
  }, { passive: true });
}

/* ---- start up ------------------------------------------------------------*/

async function refreshAll() {
  try {
    await loadConnection();
    await Promise.all([
      loadMaintenance(), loadRings(), loadColorCheck(), loadStatusRibbon(),
      loadFilament(), loadCompare(), loadModules(), loadDevices(),
      loadUpdates(), loadPrinterControl(), loadCost(),
    ]);
    $('stamp').textContent = new Date().toLocaleTimeString();
  } catch (err) {
    console.error('Dashboard failed to load:', err);
    $('foot-state').textContent = 'Could not reach the backend.';
  }
}

function initDemoToggle() {
  const toggle = $('demo-toggle');
  toggle.checked = demoOn;
  toggle.addEventListener('change', () => {
    demoOn = toggle.checked;
    localStorage.setItem(STORE_KEY, demoOn ? '1' : '0');
    refreshAll();
  });
}

initDemoToggle();
initTabs();
initPreferences();
initSpoolForm();
initRepeatSettings();
initPairing();
initNotifications();
initCostSettings();
initBridges();
initGames();
trackHighlights();
refreshAll();
loadNotificationSettings();

setInterval(() => {
  if (demoOn) { loadRings(); loadColorCheck(); loadStatusRibbon(); loadCost(); }
}, 5000);
