/* Deja Vu1 dashboard, part 4 of 7: maintenance, LED dock rings, the colour check and printer control.
 * Loaded right after app-shell.js (index.html keeps the order). The parts share one global scope: names from
 * earlier parts are used here as is, and code that runs at load only calls what is already defined above.
 */
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
  const snoozed = task.snoozed_until
    ? ` · <b>snoozed until ${esc(new Date(task.snoozed_until).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))}</b>` : '';
  return `
    <div class="task ${task.status}">
      <div class="task-main">
        <div class="task-name">
          ${esc(task.name)}
          <span class="pill">${STATUS_TEXT[task.status]}</span>
        </div>
        <div class="task-desc" title="${esc(task.description)}">${esc(task.description)}</div>
      </div>
      <div class="task-gauge">
        <div class="task-meta" title="${esc(task.reason)}"><span>${esc(task.reason)}</span> · ${task.percent.toFixed(0)}% · ~${task.est_minutes} min${snoozed}</div>
        <div class="bar"><span style="width:${Math.min(task.percent, 100)}%"></span></div>
      </div>
      <div class="task-actions">
        <button class="btn" data-task="${esc(task.id)}">Mark done</button>
        ${task.status !== 'ok' && !task.snoozed_until ? `<select class="task-snooze" data-snooze="${esc(task.id)}" aria-label="Remind me later about ${esc(task.name)}">
          <option value="">Not now…</option><option value="1">Remind me tomorrow</option><option value="3">In 3 days</option><option value="7">In a week</option></select>` : ''}
      </div>
    </div>`;
}

// The band above the list: how many jobs are overdue, coming due and fine (press one to show only those) and the printer's totals.
const mtState = { filter: '', data: null };
function maintenanceBand(data) {
  const n = { overdue: 0, due_soon: 0, ok: 0 };
  data.tasks.forEach(t => { n[t.status] = (n[t.status] || 0) + 1; });
  const cell = (key, label, count) => `<button type="button" class="ro ro-btn ${key}${count ? '' : ' is-zero'}" data-mt="${key}" aria-pressed="${mtState.filter === key}">
      <span>${label}</span><b>${count}</b></button>`;
  const t = data.totals;
  return cell('overdue', 'Overdue', n.overdue) + cell('due_soon', 'Due soon', n.due_soon) + cell('ok', 'OK', n.ok)
    + `<div class="ro"><span>Print hours</span><b>${t.total_print_hours.toFixed(0)}</b></div>`
    + `<div class="ro"><span>Prints</span><b>${t.total_prints}</b></div>`
    + `<div class="ro"><span>Filament</span><b>${(t.total_filament_grams / 1000).toFixed(1)} kg</b></div>`;
}

document.addEventListener('click', e => {
  const b = e.target.closest('#mt-band [data-mt]');
  if (!b) return;
  const key = b.dataset.mt;
  mtState.filter = mtState.filter === key ? '' : key;
  renderTasks();
  const again = $('mt-band').querySelector(`[data-mt="${key}"]`);   // the band was redrawn: keep the keyboard where it was
  if (again) again.focus();
});

function renderTasks() {
  const data = mtState.data;
  if (!data) return;
  const shown = mtState.filter ? data.tasks.filter(t => t.status === mtState.filter) : data.tasks;
  $('tasks').innerHTML = shown.length ? shown.map(renderTaskRow).join('') : EMPTY('Nothing here', 'No jobs in this group. Press the same number again to see them all.');
  stagger([...document.querySelectorAll('#tasks .task')]);
  document.querySelectorAll('#tasks .btn[data-task]').forEach(button => {
    button.addEventListener('click', () => markDone(button));
  });
  // Not now: the task stays listed here, but leaves Needs you and the alerts until then.
  document.querySelectorAll('#tasks [data-snooze]').forEach(sel => sel.addEventListener('change', async () => {
    if (!sel.value) return;
    const r = await postJSON(api('/api/maintenance/snooze'), { task_id: sel.dataset.snooze, days: +sel.value });
    if (r.ok) toast(`Snoozed: it comes back ${sel.value === '1' ? 'tomorrow' : `in ${sel.value} days`}, and stays listed here`, 'ok');
    else toast(`Couldn't snooze it: ${r.body.error || r.status}`, 'bad');
    loadMaintenance();
  }));
  paint($('mt-band'), maintenanceBand(data));
  $('mt-band').hidden = false;
}

async function loadMaintenance() {
  const data = await getJSON(api('/api/maintenance'));

  if (isModuleDisabled(data)) {
    clearStats();
    $('tasks').innerHTML = moduleDisabledEmpty('Maintenance reminders');
    $('mt-band').hidden = true;
    $('log-wrap').hidden = true;
    paint($('overview-maintenance'), moduleDisabledEmpty('Maintenance reminders'));
    return;
  }

  if (!hasData(data) || !data.tasks) {
    clearStats();
    $('tasks').innerHTML = EMPTY('No printer connected',
      'Maintenance reminders appear once print history is available. Turn on demo data to preview them.');
    $('mt-band').hidden = true;
    $('log-wrap').hidden = true;
    paint($('overview-maintenance'), noPrinterEmpty('Turn on demo data to preview.', 'maintenance'));
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
  $('stat-due-foot').textContent = `${data.summary.due_soon} due soon` + (data.summary.snoozed ? ` · ${data.summary.snoozed} snoozed` : '');

  document.querySelectorAll('.stat').forEach(t => t.classList.remove('is-empty'));
  $('stat-due').closest('.stat').classList.toggle('is-alert', data.summary.overdue > 0);

  mtState.data = data;
  renderTasks();

  // Overview tab gets the top 3 most urgent, read-only.
  paint($('overview-maintenance'), data.tasks.length
    ? data.tasks.filter(t => !t.snoozed_until).slice(0, 3).map(t => `
        <div class="task ${t.status}" style="margin-bottom:9px;">
          <div>
            <div class="task-name">${esc(t.name)} <span class="pill">${STATUS_TEXT[t.status]}</span></div>
            <div class="task-meta">${esc(t.reason)}</div>
          </div>
        </div>`).join('')
    : EMPTY('All caught up', 'Nothing due right now.'));

  $('log-wrap').hidden = false;
  loadMaintenanceLog();
}

async function markDone(button) {
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const { ok, status, body } = await postJSON(api('/api/maintenance/done'), { task_id: button.dataset.task });
    if (!ok) throw new Error(body.error || (body.connected === false ? 'No printer connected' : `the dashboard answered ${status}`));
    await loadMaintenance();
    toast('Marked done: its counter starts again from now', 'ok', 2600);
  } catch (err) {
    console.error('Could not mark task done:', err);
    toast(`Couldn't mark it done: ${err.message}`, 'bad', 6000);
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
      <span>${esc(item.completed_at.replace('T', ' ').slice(0, 16))}${typeof item.printer_hours_at_completion === 'number' ? ` · ${item.printer_hours_at_completion.toFixed(0)} h` : ''}</span>
    </div>`).join('');
}

/* ---- Module: LED dock rings --------------------------------------------*/

async function loadRings() {
  const data = await getJSON(api('/api/leds'));

  if (isModuleDisabled(data)) {
    paint($('rings'), moduleDisabledEmpty('Dock status rings'));
    $('rings-note').hidden = true;
    return;
  }
  if (!hasData(data) || !data.rings) {
    paint($('rings'), EMPTY('No signal', 'Ring colours follow live printer state.'));
    $('rings-note').hidden = true;
    return;
  }

  const firstPaint = paint($('rings'), data.rings.map(ring => {
    const effect = ring.effect === 'solid' ? '' : ring.effect;
    const pct = ring.state === 'active' ? `<div class="ring-pct">${Math.round(ring.progress * 100)}%</div>` : '';
    return `
      <div class="ring-cell">
        <div class="ring ${effect}" style="color:${esc(ring.color_hex)}"><div class="ring-core"></div></div>
        <div class="ring-id">${esc(ring.toolhead)}</div>
        <div class="ring-label">${esc(ring.label)}</div>
        ${pct}
      </div>`;
  }).join(''));

  if (firstPaint) stagger([...document.querySelectorAll('.ring-cell')], 60);
  $('rings-note').hidden = false;
}

/* ---- Module: colour check ------------------------------------------------*/

/* One listener for the calibration buttons: they are redrawn with every refresh. */
function bindCalibration() {
  const host = $('colors');
  if (host.dataset.calBound) return;
  host.dataset.calBound = '1';
  host.addEventListener('click', async e => {
    const button = e.target.closest('[data-cal]');
    if (!button) return;
    const step = button.dataset.cal;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = step === 'clear' ? 'Forgetting…' : 'Recording…';
    const done = { white: 'White reference recorded', dark: 'Dark reference recorded', clear: 'References forgotten' };
    const r = await postJSON(api('/api/colorcheck/calibration'), { toolhead: button.dataset.head, step });
    toast(r.ok ? `${done[step]} for ${button.dataset.head}` : (r.body && r.body.error) || 'The sensor refused that', r.ok ? 'ok' : 'bad');
    button.disabled = false;
    button.textContent = label;
    loadColorCheck();
  });
}

async function loadColorCheck() {
  const printer = currentPrinter;
  const data = await getJSON(api('/api/colorcheck')).catch(() => null);
  if (printer !== currentPrinter) return;
  if (!data) {
    $('colour-sensor-state').textContent = 'No reading';
    $('colorfile').hidden = true;
    paint($('colors'), EMPTY('Colour readings unavailable', 'Check the dashboard connection. Previous readings are not current.'));
    $('colors-note').hidden = true;
    return;
  }
  $('colour-sensor-state').textContent = data.simulated ? 'Demo readings' : 'No sensor';

  if (isModuleDisabled(data)) {
    $('colour-sensor-state').textContent = 'Off';
    $('colorfile').hidden = true;
    paint($('colors'), moduleDisabledEmpty('Right colour loaded?'));
    $('colors-note').hidden = true;
    return;
  }
  if (data.overall === 'sensor_readings' && data.sensors?.length) {
    const expanded = new Set([...document.querySelectorAll('#colors .sensor-details[open]')].map(d => d.dataset.head));
    const focusedHead = document.activeElement?.closest('#colors .sensor-details')?.dataset.head;
    const labels = {
      no_reading: 'No reading',
      stale: 'Old reading',
      unreadable: "Couldn't read",
      uncalibrated: 'Needs calibration',
      low_confidence: 'Low confidence',
      reading: 'Colour received'
    };
    $('colour-sensor-state').textContent = data.hardware_connected ? 'Sensor reporting' : 'Waiting for sensor';
    $('colorfile').hidden = true;
    paint($('colors'), data.sensors.map(sensor => {
      const colour = sensor.status === 'reading' && /^#[0-9a-f]{6}$/i.test(sensor.detected_hex || '')
        ? `<div class="sw"><span class="chip" style="background:${esc(sensor.detected_hex)}"></span> ${esc(sensor.detected_hex)} reported by sensor</div>`
        : '';
      const reading = sensor.reading;
      const age = sensor.age_s == null ? '' : ` · ${Math.floor(sensor.age_s)} s ago`;
      const cal = sensor.calibration;
      const head = esc(sensor.toolhead);
      const calibration = !cal ? '' : cal.supported
        ? `<div class="cal-row"><p class="crow-msg">${esc(cal.message)}${cal.id ? ` Calibration ${esc(cal.id)}.` : ''}</p>
          <div class="cal-actions">
            <button class="btn small" type="button" data-cal="white" data-head="${head}">Record white reference</button>
            <button class="btn small" type="button" data-cal="dark" data-head="${head}">Record dark reference</button>
            ${cal.has_white || cal.has_dark ? `<button class="btn small" type="button" data-cal="clear" data-head="${head}">Forget references</button>` : ''}
          </div></div>`
        : `<p class="crow-msg">${esc(cal.message)}</p>`;
      return `<div class="crow">
        <div class="crow-top"><span class="crow-head">Head ${head}</span>
          <span class="badge">${esc(labels[sensor.status] || 'No reading')}</span></div>
        ${colour}
        <p class="crow-msg">${esc(sensor.message)}</p>
        ${calibration}
        <details class="sensor-details" data-head="${esc(sensor.toolhead)}"${expanded.has(sensor.toolhead) ? ' open' : ''}><summary>Reading details${esc(age)}</summary>
          <p>${esc(sensor.sensor_model)} · Hub ${esc(sensor.device_id)} · Channel ${esc(sensor.channel_id)} · Sensor ${esc(sensor.sensor_id)}</p>
          ${reading ? `<p>Captured ${esc(new Date(reading.captured_at * 1000).toLocaleString())}.
            ${sensor.status === 'stale' ? 'Previous sample, no longer current.' : ''}</p>
            <p>Received ${esc(new Date(reading.received_at * 1000).toLocaleString())}.</p>
            <p>Raw values: ${esc(JSON.stringify(reading.raw))}</p>
            <p>Quality flags: ${esc(reading.quality_flags.join(', ') || 'None reported')}</p>
            ${reading.calibrated ? `<p>${reading.calibrated.source === 'deja-vu1' ? 'Calibrated by Deja Vu1' : 'Calibration reported by sensor'}:
              ${esc(reading.calibrated.calibration_id)}. Confidence ${esc(reading.calibrated.confidence)}, a display setting and not a measured accuracy.</p>` : ''}` : ''}
        </details>
      </div>`;
    }).join(''));
    if (focusedHead) {
      [...document.querySelectorAll('#colors .sensor-details')]
        .find(d => d.dataset.head === focusedHead)?.querySelector('summary').focus({ preventScroll: true });
    }
    bindCalibration();
    $('colors-note').textContent = data.note;
    $('colors-note').hidden = false;
    return;
  }
  if (data.overall === 'no_sensor') {
    $('colorfile').hidden = true;
    paint($('colors'), EMPTY('No colour sensor fitted', data.note || 'Nothing was measured.'));
    $('colors-note').hidden = true;
    return;
  }
  if (!hasData(data) || !data.checks || !data.checks.length) {
    $('colorfile').hidden = true;
    paint($('colors'), EMPTY('Nothing to check', 'Needs a print file and a sensor reading.'));
    $('colors-note').hidden = true;
    return;
  }

  $('colorfile').textContent = data.filename;
  $('colorfile').hidden = false;

  const firstPaint = paint($('colors'), data.checks.map(check => `
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
    </div>`).join(''));

  if (firstPaint) stagger([...document.querySelectorAll('#colors .crow')], 70);
  $('colors-note').textContent = 'Detected values are demo data.';
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
  const temps = $('ctrl-temps');

  renderPlate(state);
  if (!state || !state.state) {
    dot.style.background = '';
    const away = unreachablePrinter();
    text.textContent = away ? unreachableWords(away)[0] : 'No printer connected';
    sub.textContent = away ? unreachableWords(away)[1] : '';
    pauseResume.disabled = true;
    pauseResume.textContent = 'Pause';
    cancel.disabled = true;
    pauseResume.hidden = cancel.hidden = true;
    if ($('pp-go-print')) $('pp-go-print').hidden = true;
    homeButtons.forEach(b => b.disabled = true);
    gcodeInput.disabled = true;
    gcodeSend.disabled = true;
    temps.innerHTML = '';
    temps.dataset.built = '';
    $('gcode-log').innerHTML = '';
    return;
  }

  const lost = !!state.link_lost;
  const running = (state.state === 'printing' || state.state === 'paused') && !lost;
  const dotColor = state.state === 'printing' ? 'var(--ok)' : (state.state === 'paused' ? 'var(--warn)' : (state.state === 'error' ? 'var(--bad)' : 'var(--ink-ready)'));
  if (dot.style.background !== dotColor) dot.style.background = dotColor;
  setText(text, state.state === 'ready' ? 'Ready for a print' : `${state.state[0].toUpperCase()}${state.state.slice(1)}: ${state.current_file || state.state_message || ''}`);
  setText(sub, lost ? linkLostWords(state) : running ? `${Math.round(state.progress * 100)}% · ${(state.print_duration_hours || 0).toFixed(1)}h elapsed` : (state.state === 'complete' ? 'Finished.' : 'Waiting for your next print.'));

  // A button that is mid-send keeps its "Pausing…" until the printer answers.
  if (pauseResume.dataset.phase !== 'sending') {
    if (pauseResume.disabled !== !running) pauseResume.disabled = !running;
    setText(pauseResume, state.state === 'paused' ? 'Resume' : 'Pause');
  }
  pauseResume.onclick = () => controlAction(state.state === 'paused' ? 'resume' : 'pause', pauseResume);
  if (cancel.dataset.phase !== 'sending' && cancel.disabled !== !running) cancel.disabled = !running;
  cancel.onclick = () => confirmCancel(cancel);
  // Idle offers what comes next instead of two greyed-out buttons (idle must never look down).
  showIdleActions([pauseResume, cancel], $('pp-go-print'), running || lost || state.state === 'error');

  const busy = state.state === 'printing' || state.state === 'paused';
  const homeBlocked = busy || lost;
  const homeTitle = lost ? 'The printer is not answering' : busy ? 'Not while a print is running or paused' : '';
  // Said on the card too: a tooltip never shows on a phone.
  const homeWhy = $('home-why');
  const showWhy = busy && !lost;
  if (homeWhy && homeWhy.hidden !== !showWhy) homeWhy.hidden = !showWhy;
  homeButtons.forEach(b => {
    // Homing mid-print would drive the toolhead through the print; the
    // server refuses it too, but the button shouldn't offer it.
    if (b.dataset.phase !== 'sending' && b.disabled !== homeBlocked) b.disabled = homeBlocked;
    if (b.title !== homeTitle) b.title = homeTitle;
    b.onclick = () => {
      const axes = b.dataset.home === 'all' ? ['X', 'Y', 'Z'] : [b.dataset.home];
      runCommand(b, '/api/printer/control/home', { axes }, { sending: 'Homing…', done: `Homed ${axes.join('')}`, failed: 'Homing failed' })
        .then(loadPrinterConsole);
    };
  });

  if (gcodeInput.disabled) gcodeInput.disabled = false;
  if (gcodeSend.disabled) gcodeSend.disabled = false;
  gcodeSend.onclick = () => sendGcode();
  gcodeInput.onkeydown = gcodeKeys;
  gcodeSuggestions(state);

  // Build the temperature row once, then only update the numbers - four
  // live updates a second must never wipe out a target being typed.
  const heads = Object.keys(state.toolheads);
  if (temps.dataset.built !== heads.join(',')) {
    temps.dataset.built = heads.join(',');
    temps.innerHTML = heads.map(th => `
      <div>
        <div class="stat-key" data-temp-key="${esc(th)}">${esc(th)}</div>
        <div class="stat-val" style="font-size:22px;" data-temp-val="${esc(th)}">—</div>
        <div class="stat-foot" data-temp-target="${esc(th)}"></div>
        <div class="temp-set" style="display:flex; gap:6px; margin-top:8px;">
          <label class="sr-only" for="target-${esc(th)}">${esc(th)} target temperature</label>
          <input type="number" inputmode="decimal" placeholder="°C" id="target-${esc(th)}" data-toolhead="${esc(th)}" style="width:100%; font-size:12px;">
          <button class="btn small" data-set-temp="${esc(th)}">Set</button>
        </div>
      </div>`).join('');
    temps.querySelectorAll('[data-set-temp]').forEach(btn => {
      btn.addEventListener('click', () => {
        const th = btn.dataset.setTemp;
        const input = temps.querySelector(`input[data-toolhead="${th}"]`);
        const celsiusValue = tempUnit === 'F' ? (parseFloat(input.value) - 32) * 5 / 9 : parseFloat(input.value);
        if (Number.isNaN(celsiusValue)) { toast('Type a target temperature first', 'warn'); return; }
        runCommand(btn, '/api/printer/control/temperature', { toolhead: th, target: celsiusValue }, {
          sending: 'Setting…', done: `${th} target set to ${formatTemp(celsiusValue)}`, failed: `Setting ${th} failed`,
          // Real printers are sent targets to 0.1 °C (a °F entry rarely lands on one).
          expect: s => Math.abs(s.toolheads[th].target_temperature - celsiusValue) < 0.051,
        }).then(r => { if (r.ok) input.value = ''; });
      });
    });
  }
  heads.forEach(th => {
    const info = state.toolheads[th];
    const active = th === state.active_toolhead;
    setText(temps.querySelector(`[data-temp-key="${th}"]`), `${th}${active ? ' · active' : ''}${info.status === 'error' ? ' · error' : ''}`);
    const val = temps.querySelector(`[data-temp-val="${th}"]`);
    setText(val, formatTemp(info.temperature));
    const valColor = active ? 'var(--accent-text)' : '';
    if (val.style.color !== valColor) val.style.color = valColor;
    setText(temps.querySelector(`[data-temp-target="${th}"]`), info.target_temperature ? `target ${formatTemp(info.target_temperature)}` : 'heater off');
  });
}
