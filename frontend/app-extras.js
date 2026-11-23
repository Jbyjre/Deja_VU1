/* Deja Vu1 dashboard, part 6 of 7: optional extras, pairing, notifications, updates, print cost, the smart home
 * bridges, the games loader and the moving highlight.
 * Loaded right after app-print.js (index.html keeps the order). The parts share one global scope: names from
 * earlier parts are used here as is, and code that runs at load only calls what is already defined above.
 */
/* ---- Optional extras ---------------------------------------------------- *
 * Settings > Optional extras lists only what needs something outside Deja Vu1: a program you
 * install, a device, another service. The parts of Deja Vu1 itself have no switch, and the few
 * ordinary settings (camera, time-lapses, continue on another device) switch in their own card. */

async function loadModules() {
  const data = await getJSON('/api/modules');
  const host = $('module-list');
  const list = (data.modules || []).filter(m => m.kind === 'extra');
  if (!host || !list.length) return;
  const ids = list.map(m => m.id).join(',');
  // Built once; after that a reload only moves the switches that changed, so turning an extra
  // on or off never makes the list jump, flash or fold back up.
  if (host.dataset.ids === ids) {
    list.forEach(m => {
      const input = host.querySelector(`[data-module="${CSS.escape(m.id)}"]`);
      if (input && !input.disabled && input.checked !== m.enabled) input.checked = m.enabled;
      const row = input && input.closest('.modrow');
      if (row) row.classList.toggle('is-on', m.enabled);
    });
    modCounts(host);
    return;
  }
  host.dataset.ids = ids;
  const groups = [['optional', 'Needs a program or service'], ['hardware_pending', 'Needs extra hardware']];
  const row = m => `
    <div class="modrow well ${m.enabled ? 'is-on' : ''}" data-mod-row="${esc(m.id)}">
      <div class="mod-text">
        <div class="mod-name">${esc(m.name)}</div>
        <div class="mod-desc">${esc(m.description)}</div>
      </div>
      <span class="mod-saving" aria-live="polite"></span>
      <label class="switch" style="gap:0;">
        <input type="checkbox" ${m.enabled ? 'checked' : ''} data-module="${esc(m.id)}" aria-label="${esc(m.name)}">
        <span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>
      </label>
    </div>`;
  host.innerHTML = `
    <div class="mod-tools"><span class="mod-count" id="mod-count"></span></div>
    ${groups.map(([status, title]) => {
      const ms = list.filter(m => (m.status === 'hardware_pending' ? 'hardware_pending' : 'optional') === status);
      return ms.length ? `<section class="mod-group" data-group="${status}"><h3 class="mod-group-title">${title}</h3>${ms.map(row).join('')}</section>` : '';
    }).join('')}`;
  modCounts(host);

  // The switch moves at once and says "Saving…" while the server saves it;
  // if the server says no, it goes back and says why.
  host.querySelectorAll('[data-module]').forEach(input => {
    input.addEventListener('change', async () => {
      const want = input.checked, rowEl = input.closest('.modrow'), note = rowEl.querySelector('.mod-saving');
      input.disabled = true;
      rowEl.classList.toggle('is-on', want);
      note.textContent = 'Saving…';
      const { ok, body } = await postJSON(api(`/api/modules/${input.dataset.module}/toggle`), { enabled: want });
      input.disabled = false;
      if (!ok) {
        input.checked = !want;
        rowEl.classList.toggle('is-on', !want);
        note.textContent = '';
        const label = input.getAttribute('aria-label'), why = body.error || 'the server refused';
        toast(want ? `Couldn't turn ${label} on: ${why}` : `Couldn't turn ${label} off: ${why}`, 'bad', 6000);
        return;
      }
      note.textContent = want ? 'On' : 'Off';
      setTimeout(() => { if (I18n.same(note.textContent, want ? 'On' : 'Off')) note.textContent = ''; }, 1600);
      modCounts(host);
      refreshAll();
    });
  });
}
function modCounts(host) {
  const all = host.querySelectorAll('[data-module]'), on = [...all].filter(i => i.checked).length;
  setText($('mod-count'), `${on} of ${all.length} on`);
}

/* ---- Pairing ------------------------------------------------------------*/

async function loadDevices() {
  const data = await getJSON('/api/pairing/devices');
  const devices = data.devices || [];
  const host = $('device-list');

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
}

/* While a code is on screen, the other device redeems it somewhere else, so
 * this one looks for it: every 2 s until a new device appears or the code
 * expires. Without this the code stayed up and the list said "No devices
 * paired yet" until the page was reloaded, as if pairing had failed. */
let pairingWatch = null;
function watchForPairing() {
  clearInterval(pairingWatch);
  const known = getJSON('/api/pairing/devices').then(d => new Set((d.devices || []).map(x => x.id))).catch(() => null);
  // A code lasts 10 minutes (pairing.py CODE_TTL_MINUTES). Counted here, not
  // read from the server's clock, whose time zone this device may not share.
  const until = Date.now() + 10 * 60 * 1000;
  pairingWatch = setInterval(async () => {
    if (Date.now() > until) {
      clearInterval(pairingWatch);
      $('pairing-code-display').style.display = 'none';
      toast('The pairing code expired - make a new one when you are ready', 'info', 5000);
      return;
    }
    const data = await getJSON('/api/pairing/devices').catch(() => null);
    const seen = await known;
    if (!seen) return;                      // couldn't read the starting list
    const added = ((data && data.devices) || []).filter(d => !seen.has(d.id));
    if (!added.length) return;
    clearInterval(pairingWatch);
    $('pairing-code-display').style.display = 'none';
    toast(`${added.map(d => d.name).join(', ')} paired`, 'ok');
    loadDevices();
  }, 2000);
}

async function loadDeviceLock() {
  const box = $('device-lock');
  if (!box) return;
  const st = await getJSON('/api/pairing/status').catch(() => null);
  if (!st || st.error) { box.disabled = true; return; }
  box.checked = !!st.lock;
  box.disabled = !(st.this_computer || st.paired);
  $('device-lock-note').textContent = box.disabled ? 'Change the lock from the computer running Deja Vu1, or from a paired device.'
    : st.lock ? `On. ${st.this_computer ? 'This computer' : `This device (${st.device})`} keeps access; others need a pairing code.` : '';
}

function initPairing() {
  if ($('device-lock')) {
    loadDeviceLock();
    $('device-lock').addEventListener('change', async (e) => {
      const on = e.target.checked;
      if (on && !confirm('Only paired devices will be able to use this dashboard. Any phone or computer you haven\'t paired will be asked for a code. Switch the lock on?')) { e.target.checked = false; return; }
      const { ok, body } = await postJSON('/api/pairing/lock', { on });
      if (!ok) { e.target.checked = !on; toast(body.error || 'The lock was not changed', 'bad'); }
      else toast(on ? 'Device lock on' : 'Device lock off', 'ok');
      loadDeviceLock();
    });
  }
  $('phone-connect-btn').addEventListener('click', () => window.Phone && Phone.open());
  $('generate-code-btn').addEventListener('click', async () => {
    const { ok, body } = await postJSON('/api/pairing/code', {});
    if (!ok) { toast(`Couldn't make a code: ${body.error || 'unknown error'}`, 'bad'); return; }
    $('pairing-code-display').style.display = 'block';
    $('pairing-code-text').textContent = (body.code || '').replace(/(\d{3})(\d{3})/, '$1 $2');
    watchForPairing();
  });

  $('redeem-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const codeInput = $('redeem-code');
    const code = codeInput.value.replace(/\s/g, '');
    const { ok, body } = await postJSON('/api/pairing/redeem', { code, device_name: navigator.userAgent.includes('Mobile') ? 'Phone' : 'Browser' });
    if (ok) {
      clearInterval(pairingWatch);
      codeInput.value = '';
      $('pairing-code-display').style.display = 'none';
      toast('Paired - this device is now on the list', 'ok');
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
  // A long random ntfy name: anyone who knows a name can read its messages, so it must not be guessable.
  $('notif-ntfy-make')?.addEventListener('click', () => {
    const bytes = new Uint8Array(9);
    crypto.getRandomValues(bytes);
    $('notif-ntfy').value = 'dejavu1-' + [...bytes].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
    toast('Subscribe to this exact name in the ntfy app, then press Save and Send test', 'info', 7000);
  });
  $('notif-save').addEventListener('click', async () => {
    const { ok, body } = await postJSON('/api/notifications/settings', {
      ntfy_topic: $('notif-ntfy').value.trim(),
      discord_webhook_url: $('notif-discord').value.trim(),
      telegram_bot_token: $('notif-telegram-token').value.trim(),
      telegram_chat_id: $('notif-telegram-chat').value.trim(),
      quiet_hours_start: parseInt($('notif-quiet-start').value, 10) || 0,
      quiet_hours_end: parseInt($('notif-quiet-end').value, 10) || 0,
    });
    const btn = $('notif-save');
    const original = btn.textContent;
    if (!ok) {
      // Say what was wrong (e.g. a mistyped Discord address) - never "Saved".
      btn.textContent = 'Not saved';
      toast(`Notification settings not saved: ${body.error || 'unknown error'}`, 'bad', 7000);
    } else {
      btn.textContent = 'Saved';
      loadNotificationSettings();
    }
    setTimeout(() => { btn.textContent = original; }, 1500);
  });

  $('notif-test').addEventListener('click', async () => {
    const btn = $('notif-test');
    const original = btn.textContent;
    btn.textContent = 'Sending…';
    const { ok, body } = await postJSON('/api/notifications/test', { message: 'Test notification from Deja Vu1' });
    const results = Object.entries((body && body.results) || {});
    const failed = results.filter(([, r]) => !r.ok);
    if (!ok) {
      btn.textContent = 'Not sent';
      toast(`Test not sent: ${body.error || 'unknown error'}`, 'bad', 7000);
    } else if (!results.length) {
      btn.textContent = 'Nothing set up';
      toast('Add an ntfy topic, Discord webhook or Telegram bot first, then save.', 'warn', 6000);
    } else if (failed.length) {
      btn.textContent = 'Failed';
      toast(`Couldn't send to ${failed.map(([name, r]) => `${name} (${r.error || 'error'})`).join(', ')}`, 'bad', 8000);
    } else {
      btn.textContent = 'Sent';
    }
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
  if (!data.packages.length && data.note) {
    host.textContent = data.note;
  } else if (data.updates_available === 0) {
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
    paint(host, moduleDisabledEmpty('Print cost calculator'));
    return;
  }

  const rows = [];
  if (hasData(current) && current.total_cost !== undefined) {
    rows.push(`
      <div class="crow" style="border-left:3px solid var(--accent);">
        <strong>This print, so far:</strong> $${current.cost_so_far.toFixed(2)}
        (est. total once done: $${current.total_cost.toFixed(2)}), ${Math.round(current.progress * 100)}% complete
      </div>`);
  }

  if (hasData(history) && history.jobs && history.jobs.length) {
    rows.push(...history.jobs.slice(0, 5).map(job => `
      <div class="log-row">
        <span>${esc(job.filename)}</span>
        <span>$${job.total_cost.toFixed(2)} · ${esc(job.filament_type)} ${job.filament_grams.toFixed(0)}g</span>
      </div>`));
  }

  paint(host, rows.length ? rows.join('') : EMPTY('No cost data yet', 'Turn on demo data, or connect a printer, to see estimates.'));
}

/* The prices already set, so you can see what PLA costs before changing it. */
function showCostPrices(data) {
  const hint = $('cost-prices');
  if (!hint || !data || !data.filament_price_per_kg) return;
  const list = Object.entries(data.filament_price_per_kg).map(([m, p]) => `${m} $${Number(p).toFixed(2)}`).join(' · ');
  hint.textContent = list ? `Prices now (per kg): ${list}` : '';
}

function initCostSettings() {
  getJSON('/api/cost/settings').then(data => {
    if (!data || isModuleDisabled(data)) return;
    $('cost-electricity').value = data.electricity_rate_per_kwh ?? '';
    $('cost-watts').value = data.printer_watts ?? '';
    showCostPrices(data);
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
    const r = await postJSON('/api/cost/settings', updates);
    if (!r.ok) { toast(`Prices not saved: ${r.body.error || `HTTP ${r.status}`}`, 'bad', 6000); return; }
    showCostPrices(r.body);
    $('cost-material').value = '';
    $('cost-price').value = '';
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
    const { ok, body } = await postJSON('/api/wled/settings', { host: $('wled-host').value.trim() });
    $('wled-status').textContent = ok ? 'Saved.' : `Not saved: ${body.error || 'unknown error'}`;
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
    const { ok, body } = await postJSON('/api/homeassistant/settings', {
      base_url: $('ha-url').value.trim(), token: $('ha-token').value.trim(),
    });
    // The server never sends the saved token back, only a masked stand-in;
    // saving that stand-in unchanged keeps the real token.
    if (ok) $('ha-token').value = body.token || '';
    $('ha-status').textContent = ok ? 'Saved.' : `Not saved: ${body.error || 'unknown error'}`;
  });

  $('ha-push-btn').addEventListener('click', async () => {
    $('ha-status').textContent = 'Pushing…';
    const { body } = await postJSON('/api/homeassistant/push', {});
    $('ha-status').textContent = body.ok
      ? `Pushed ${body.entities || ''} sensors to Home Assistant.`.replace('  ', ' ')
      : `Push failed: ${body.error || 'unknown error'}`;
  });
}

/* ---- Games: loaded the first time the Games tab opens ---------------------
 * The arcade lives in games.js and its six other parts (GAME_PARTS below), so
 * the dashboard starts without it. These two stand-ins are replaced by the
 * real ones when the arcade loads. */
/* The arcade is seven files, loaded one after another in this order (each one's header says what it holds). A part
 * that has run stays loaded: after a failed part, a retry loads only the parts still missing, because running a part
 * twice would declare its names twice. */
const GAME_PARTS = ['games.js', 'games-classic.js', 'games-arcade.js', 'games-shell.js', 'games-puzzle.js', 'games-v2.js',
  'games-world.js'];
const gamePartsLoaded = new Set();
let gamesLoading = null;
function loadGamePart(file) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = file;
    s.onload = () => { gamePartsLoaded.add(file); resolve(); };
    s.onerror = () => { s.remove(); reject(new Error(`${file} did not load`)); };
    document.head.appendChild(s);
  });
}
function loadGames() {
  if (!gamesLoading) {
    gamesLoading = GAME_PARTS.filter(file => !gamePartsLoaded.has(file))
      .reduce((ready, file) => ready.then(() => loadGamePart(file)), Promise.resolve())
      .catch(err => { gamesLoading = null; throw err; });
  }
  return gamesLoading;
}
function startCurrentGame() {
  const host = $('game-host');
  if (host && !host.childElementCount) host.innerHTML = '<p class="log-empty is-loading">Loading the arcade…</p>';
  loadGames().then(() => setTimeout(() => {
    // games.js has replaced this function and its own installers have run;
    // start a game unless one already started for the open tab.
    if (!$('tab-games').hidden && !activeGame) startCurrentGame();
  }, 120)).catch(() => { if (host) host.innerHTML = '<p class="log-empty">The games could not load. Reload the page to try again.</p>'; });
}
function stopCurrentGame() { /* nothing is running until games.js loads */ }

/* ---- the moving specular highlight -------------------------------------*/

function trackHighlights() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let queued = false;
  document.addEventListener('pointermove', event => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      // Measure every panel first, then write. Writing between
      // measurements made the browser lay the page out again for each
      // panel, on every pointer move.
      const margin = 70;
      const near = [];
      document.querySelectorAll('.liquid-glass').forEach(el => {
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height) return;            // on a hidden tab
        if (event.clientX >= box.left - margin && event.clientX <= box.right + margin &&
            event.clientY >= box.top - margin && event.clientY <= box.bottom + margin) near.push([el, box]);
      });
      near.forEach(([el, box]) => {
        el.style.setProperty('--mx', `${Math.round(((event.clientX - box.left) / box.width) * 100)}%`);
        el.style.setProperty('--my', `${Math.round(((event.clientY - box.top) / box.height) * 100)}%`);
      });
      queued = false;
    });
  }, { passive: true });
}
