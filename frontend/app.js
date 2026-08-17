/* Deja Vu1 dashboard logic.
 *
 * Plain JavaScript — no framework, no build step, nothing to install.
 * Simulated figures are only requested when demo mode is explicitly enabled.
 */

const $ = id => document.getElementById(id);

function esc(text) {
  return String(text).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function getJSON(url, timeoutMs = 4500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok && response.status !== 409) {
      throw new Error(`${url} returned ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

const STORE_KEY = 'dejavu1.demo';
let demoOn = localStorage.getItem(STORE_KEY) === '1';
let refreshGeneration = 0;

function api(path) {
  return path + (demoOn ? (path.includes('?') ? '&' : '?') + 'demo=1' : '');
}

function hasData(payload) {
  return payload && payload.connected !== undefined
    ? (payload.connected || payload.demo)
    : Boolean(payload);
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

function moduleError(targetId, title) {
  $(targetId).innerHTML = EMPTY(
    `${title} unavailable`,
    'This panel could not refresh. The rest of the dashboard is still working.'
  );
}

async function loadConnection() {
  const data = await getJSON('/api/connection');
  const pill = $('conn');
  const label = $('conn-label');

  pill.classList.toggle('is-connected', Boolean(data.connected));

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

function clearStats(message = 'No printer') {
  const blanks = [
    ['stat-hours', 'stat-hours-foot'],
    ['stat-prints', 'stat-prints-foot'],
    ['stat-filament', 'stat-filament-foot'],
    ['stat-due', 'stat-due-foot'],
  ];
  blanks.forEach(([val, foot]) => {
    $(val).textContent = '—';
    $(foot).textContent = message;
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
  $('stat-prints-foot').textContent = `${totals.failed_prints} failed`;
  $('stat-filament').textContent =
    (totals.total_filament_grams / 1000).toFixed(1) + ' kg';
  $('stat-filament-foot').textContent = unit;
  $('stat-due').textContent = data.summary.overdue;
  $('stat-due-foot').textContent = `${data.summary.due_soon} due soon`;

  document.querySelectorAll('.stat').forEach(t => t.classList.remove('is-empty'));
  $('stat-due').closest('.stat')
    .classList.toggle('is-alert', data.summary.overdue > 0);

  $('tasks').innerHTML = data.tasks.map(task => `
    <div class="task ${esc(task.status)}">
      <div>
        <div class="task-name">
          ${esc(task.name)}
          <span class="pill">${esc(STATUS_TEXT[task.status] || task.status)}</span>
        </div>
        <div class="task-desc">${esc(task.description)}</div>
        <div class="bar" role="progressbar" aria-label="${esc(task.name)} maintenance interval"
             aria-valuemin="0" aria-valuemax="100"
             aria-valuenow="${Math.min(Math.round(task.percent), 100)}">
          <span style="width:${Math.min(task.percent, 100)}%"></span>
        </div>
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
  await loadMaintenanceLog();
}

async function markDone(button) {
  button.disabled = true;
  button.textContent = 'Saving…';

  try {
    const response = await fetch(api('/api/maintenance/done'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
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

async function loadRings() {
  const data = await getJSON(api('/api/leds'));

  if (!hasData(data) || !data.rings) {
    $('rings').innerHTML = EMPTY(
      'No signal', 'Ring colours follow live printer state.');
    $('rings-note').hidden = true;
    return;
  }

  $('rings').innerHTML = data.rings.map(ring => {
    const effect = ring.effect === 'solid' ? '' : esc(ring.effect);
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
        <span class="verdict ${esc(check.verdict)}">${esc(check.verdict)}</span>
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

async function refreshAll() {
  const generation = ++refreshGeneration;
  const jobs = [
    ['connection', loadConnection],
    ['maintenance', loadMaintenance],
    ['rings', loadRings],
    ['colors', loadColorCheck]
  ];

  const results = await Promise.allSettled(jobs.map(([, job]) => job()));
  if (generation !== refreshGeneration) return;

  const failures = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') return;
    const name = jobs[index][0];
    failures.push(name);
    console.error(`${name} refresh failed:`, result.reason);

    if (name === 'maintenance') {
      clearStats('Unavailable');
      moduleError('tasks', 'Maintenance');
      $('log-wrap').hidden = true;
    } else if (name === 'rings') {
      moduleError('rings', 'Dock status');
      $('rings-note').hidden = true;
    } else if (name === 'colors') {
      moduleError('colors', 'Colour check');
      $('colorfile').hidden = true;
      $('colors-note').hidden = true;
    }
  });

  if (failures.includes('connection')) {
    $('conn-label').textContent = 'Backend offline';
    $('foot-state').textContent = 'Could not reach the backend.';
  } else if (failures.length) {
    $('foot-state').textContent =
      `Connected, but ${failures.length} panel${failures.length === 1 ? '' : 's'} failed to refresh.`;
  }

  $('stamp').textContent = new Date().toLocaleTimeString([], {
    hour: 'numeric', minute: '2-digit', second: '2-digit'
  });
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

setInterval(() => {
  if (!document.hidden && demoOn) {
    Promise.allSettled([loadRings(), loadColorCheck()]);
  }
}, 5000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshAll();
});
