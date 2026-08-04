/* Deja Vu1 dashboard logic.
 *
 * This file asks the Python backend for data and draws it on the page.
 * Plain JavaScript — no framework, no build step, nothing to install.
 */

/* Small helper: fetch a URL and return the parsed JSON. */
async function getJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

/* Escape text before putting it on the page, so a stray < or & can't break
 * the layout. */
function esc(text) {
  return String(text).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const STATUS_TEXT = { overdue: 'Overdue', due_soon: 'Due soon', ok: 'OK' };


/* ---- Module 1: Maintenance (live data) --------------------------------- */

async function loadMaintenance() {
  const data = await getJSON('/api/maintenance');

  // Top summary strip.
  document.getElementById('stat-hours').textContent    = data.totals.total_print_hours.toFixed(0);
  document.getElementById('stat-prints').textContent   = data.totals.total_prints;
  document.getElementById('stat-filament').textContent =
    (data.totals.total_filament_grams / 1000).toFixed(1) + ' kg';
  document.getElementById('stat-due').textContent      = data.summary.overdue;

  // One row per maintenance task.
  document.getElementById('tasks').innerHTML = data.tasks.map(task => `
    <div class="task ${task.status}">
      <div>
        <div class="task-name">
          ${esc(task.name)}
          <span class="pill ${task.status}">${STATUS_TEXT[task.status]}</span>
        </div>
        <div class="task-desc">${esc(task.description)}</div>
        <div class="bar"><span style="width:${Math.min(task.percent, 100)}%"></span></div>
        <div class="task-meta">
          ${esc(task.reason)} · ${task.percent.toFixed(0)}% · about ${task.est_minutes} min
        </div>
      </div>
      <button class="btn" data-task="${esc(task.id)}">Mark done</button>
    </div>
  `).join('');

  // Wire up every "Mark done" button.
  document.querySelectorAll('#tasks .btn').forEach(button => {
    button.addEventListener('click', () => markDone(button));
  });

  loadMaintenanceLog();
}

/* Tell the backend a task was just completed, then redraw. */
async function markDone(button) {
  button.disabled = true;
  button.textContent = 'Saving…';

  try {
    await fetch('/api/maintenance/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: button.dataset.task })
    });
    await loadMaintenance();
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Retry';
  }
}

async function loadMaintenanceLog() {
  const { history } = await getJSON('/api/maintenance/history');
  const box = document.getElementById('mlog');

  if (!history.length) {
    box.innerHTML = '<p class="muted">Nothing logged yet. ' +
                    'Mark a task done above and it will appear here.</p>';
    return;
  }

  box.innerHTML = history.map(item => `
    <div class="log-row">
      <span>${esc(item.task_name)}</span>
      <span>${esc(item.completed_at.replace('T', ' ').slice(0, 16))}
            · at ${item.printer_hours_at_completion.toFixed(0)} h</span>
    </div>
  `).join('');
}


/* ---- Module 2: LED dock rings (simulated) ------------------------------ */

async function loadRings() {
  const data = await getJSON('/api/leds');

  document.getElementById('rings').innerHTML = data.rings.map(ring => {
    // "solid" needs no animation class; pulse and blink do.
    const effect = ring.effect === 'solid' ? '' : ring.effect;
    const progress = ring.state === 'active'
      ? `<br>${Math.round(ring.progress * 100)}%`
      : '';

    return `
      <div class="ring-cell">
        <div class="ring ${effect}" style="color:${esc(ring.color_hex)}">
          <div class="ring-core"></div>
        </div>
        <div class="ring-id">${esc(ring.toolhead)}</div>
        <div class="ring-label">${esc(ring.label)}${progress}</div>
      </div>
    `;
  }).join('');
}


/* ---- Module 3: Color check (simulated) --------------------------------- */

async function loadColorCheck() {
  const data = await getJSON('/api/colorcheck');

  document.getElementById('colorfile').textContent = data.filename;

  document.getElementById('colors').innerHTML = data.checks.map(check => `
    <div class="crow">
      <div class="crow-top">
        <span class="crow-head">Toolhead ${esc(check.toolhead)}</span>
        <span class="verdict ${check.verdict}">${esc(check.verdict)}</span>
      </div>
      <div class="swatches">
        <div class="sw">
          <span class="chip" style="background:${esc(check.expected_hex)}"></span>
          expected ${esc(check.expected_color_name)}
        </div>
        <span class="arrow">→</span>
        <div class="sw">
          <span class="chip" style="background:${esc(check.detected_hex)}"></span>
          detected
        </div>
      </div>
      <div class="crow-msg">${esc(check.message)}</div>
    </div>
  `).join('');
}


/* ---- Start up ---------------------------------------------------------- */

async function refreshAll() {
  try {
    await Promise.all([loadMaintenance(), loadRings(), loadColorCheck()]);
    document.getElementById('stamp').textContent =
      'updated ' + new Date().toLocaleTimeString();
  } catch (err) {
    console.error('Dashboard failed to load:', err);
  }
}

refreshAll();

// Re-poll the LED and color modules every 5 seconds so the page feels live.
setInterval(() => { loadRings(); loadColorCheck(); }, 5000);
