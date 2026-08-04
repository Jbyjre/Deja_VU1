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

/* Escape text before putting it on the page, so a stray < or & can't break
 * the layout. */
function esc(text) {
  return String(text).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function getJSON(url) {
  const response = await fetch(url);
  if (!response.ok && response.status !== 409) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

/* Demo mode is remembered between visits, so a reload doesn't wipe the state
 * you were looking at. */
const STORE_KEY = 'dejavu1.demo';
let demoOn = localStorage.getItem(STORE_KEY) === '1';

/* Every data request carries the demo flag when it is switched on. */
function api(path) {
  return path + (demoOn ? (path.includes('?') ? '&' : '?') + 'demo=1' : '');
}

/* True when the payload actually carries figures. */
function hasData(payload) {
  return payload && payload.connected !== undefined
    ? (payload.connected || payload.demo)
    : Boolean(payload);
}

const STATUS_TEXT = { overdue: 'Overdue', due_soon: 'Due soon', ok: 'OK' };

/* Staggers the reveal of a freshly drawn list. */
function stagger(nodes, step = 45) {
  nodes.forEach((node, i) => { node.style.animationDelay = `${i * step}ms`; });
}

const EMPTY = (title, sub) => `
  <div class="empty">
    <span class="empty-mark" aria-hidden="true"></span>
    <p class="empty-title">${esc(title)}</p>
    <p class="empty-sub">${esc(sub)}</p>
  </div>`;


/* ---- connection state -------------------------------------------------- */

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
    $('foot-state').textContent =
      'Demo data — no printer connected, nothing is contacted.';
  } else {
    pill.classList.remove('is-demo');
    label.textContent = 'Not connected';
    $('foot-state').textContent = 'No printer connected — nothing is contacted.';
  }

  $('notice').hidden = !(demoOn && !data.connected);
}


/* ---- Module 1: Maintenance --------------------------------------------- */

function clearStats() {
  const blanks = [
    ['stat-hours', 'stat-hours-foot'],
    ['stat-prints', 'stat-prints-foot'],
    ['stat-filament', 'stat-filament-foot'],
    ['stat-due', 'stat-due-foot'],
  ];
  blanks.forEach(([val, foot]) => {
    $(val).textContent = '—';
    $(foot).textContent = 'No printer';
    const tile = $(val).closest('.stat');
    tile.classList.add('is-empty');
    tile.classList.remove('is-alert');
  });
}

async function loadMaintenance() {
  const data = await getJSON(api('/api/maintenance'));

  if (!hasData(data) || !data.tasks) {
    clearStats();
    $('tasks').innerHTML = EMPTY(
      'No printer connected',
      'Maintenance reminders appear once print history is available. ' +
      'Turn on demo data to preview them.');
    $('log-wrap').hidden = true;
    return;
  }

  const totals = data.totals;
  const unit = data.demo ? 'Simulated' : 'From history';

  $('stat-hours').textContent = totals.total_print_hours.toFixed(0);
  $('stat-hours-foot').textContent = unit;
  $('stat-prints').textContent = totals.total_prints;
  $('stat-prints-foot').textContent =
    `${totals.failed_prints} failed`;
  $('stat-filament').textContent =
    (totals.total_filament_grams / 1000).toFixed(1) + ' kg';
  $('stat-filament-foot').textContent = unit;
  $('stat-due').textContent = data.summary.overdue;
  $('stat-due-foot').textContent = `${data.summary.due_soon} due soon`;

  document.querySelectorAll('.stat').forEach(t => t.classList.remove('is-empty'));
  $('stat-due').closest('.stat')
    .classList.toggle('is-alert', data.summary.overdue > 0);

  $('tasks').innerHTML = data.tasks.map(task => `
    <div class="task ${task.status}">
      <div>
        <div class="task-name">
          ${esc(task.name)}
          <span class="pill">${STATUS_TEXT[task.status]}</span>
        </div>
        <div class="task-desc">${esc(task.description)}</div>
        <div class="bar"><span style="width:${Math.min(task.percent, 100)}%"></span></div>
        <div class="task-meta">
          ${esc(task.reason)} · ${task.percent.toFixed(0)}% · ~${task.est_minutes} min
        </div>
      </div>
      <button class="btn" data-task="${esc(task.id)}">Mark done</button>
    </div>
  `).join('');

  stagger([...document.querySelectorAll('#tasks .task')]);

  document.querySelectorAll('#tasks .btn').forEach(button => {
    button.addEventListener('click', () => markDone(button));
  });

  $('log-wrap').hidden = false;
  loadMaintenanceLog();
}

async function markDone(button) {
  button.disabled = true;
  button.textContent = 'Saving…';

  try {
    const response = await fetch(api('/api/maintenance/done'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: button.dataset.task })
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
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
    box.innerHTML = '<p class="log-empty">Nothing logged yet. ' +
                    'Mark a task done above and it will appear here.</p>';
    return;
  }

  box.innerHTML = history.map(item => `
    <div class="log-row">
      <span>${esc(item.task_name)}</span>
      <span>${esc(item.completed_at.replace('T', ' ').slice(0, 16))}
            · ${item.printer_hours_at_completion.toFixed(0)} h</span>
    </div>
  `).join('');
}


/* ---- Module 2: LED dock rings ------------------------------------------ */

async function loadRings() {
  const data = await getJSON(api('/api/leds'));

  if (!hasData(data) || !data.rings) {
    $('rings').innerHTML = EMPTY(
      'No signal', 'Ring colours follow live printer state.');
    $('rings-note').hidden = true;
    return;
  }

  $('rings').innerHTML = data.rings.map(ring => {
    const effect = ring.effect === 'solid' ? '' : ring.effect;
    const pct = ring.state === 'active'
      ? `<div class="ring-pct">${Math.round(ring.progress * 100)}%</div>`
      : '';

    return `
      <div class="ring-cell">
        <div class="ring ${effect}" style="color:${esc(ring.color_hex)}">
          <div class="ring-core"></div>
        </div>
        <div class="ring-id">${esc(ring.toolhead)}</div>
        <div class="ring-label">${esc(ring.label)}</div>
        ${pct}
      </div>
    `;
  }).join('');

  stagger([...document.querySelectorAll('.ring-cell')], 60);
  $('rings-note').hidden = false;
}


/* ---- Module 3: Colour check -------------------------------------------- */

async function loadColorCheck() {
  const data = await getJSON(api('/api/colorcheck'));

  if (!hasData(data) || !data.checks) {
    $('colorfile').hidden = true;
    $('colors').innerHTML = EMPTY(
      'Nothing to check', 'Needs a print file and a sensor reading.');
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
        <div class="sw">
          <span class="chip" style="background:${esc(check.expected_hex)}"></span>
          expected ${esc(check.expected_color_name)}
        </div>
        <span class="arrow" aria-hidden="true">→</span>
        <div class="sw">
          <span class="chip" style="background:${esc(check.detected_hex)}"></span>
          detected
        </div>
      </div>
      <div class="crow-msg">${esc(check.message)}</div>
    </div>
  `).join('');

  stagger([...document.querySelectorAll('.crow')], 70);
  $('colors-note').hidden = false;
}


/* ---- the moving specular highlight -------------------------------------
 * Each glass panel gets --mx/--my set to where the pointer is over it, which
 * moves the bright glint in the CSS. Skipped entirely when the visitor has
 * asked for reduced motion. */

function trackHighlights() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let queued = false;
  document.addEventListener('pointermove', event => {
    if (queued) return;
    queued = true;

    requestAnimationFrame(() => {
      document.querySelectorAll('.liquid-glass').forEach(el => {
        const box = el.getBoundingClientRect();
        const margin = 70;   // start moving just before the pointer arrives
        const near =
          event.clientX >= box.left - margin && event.clientX <= box.right + margin &&
          event.clientY >= box.top - margin && event.clientY <= box.bottom + margin;
        if (!near) return;

        el.style.setProperty('--mx', `${((event.clientX - box.left) / box.width) * 100}%`);
        el.style.setProperty('--my', `${((event.clientY - box.top) / box.height) * 100}%`);
      });
      queued = false;
    });
  }, { passive: true });
}


/* ---- start up ----------------------------------------------------------- */

async function refreshAll() {
  try {
    await loadConnection();
    await Promise.all([loadMaintenance(), loadRings(), loadColorCheck()]);
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
trackHighlights();
refreshAll();

/* Re-poll the two live-ish panels, but only while demo data is on — with no
 * printer there is nothing to poll for. */
setInterval(() => {
  if (demoOn) { loadRings(); loadColorCheck(); }
}, 5000);
