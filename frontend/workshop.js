/* Deja Vu1 — live connection, fleet, files, automations and Liquid Glass 2.0.
 *
 * Loaded after app.js and viewer3d.js, and uses app.js's helpers ($, esc,
 * api, getJSON, postJSON, runCommand, toast, render* functions). Plain
 * JavaScript, nothing to install, nothing fetched from anywhere but this
 * dashboard's own server.
 *
 * Contents
 *   1. small helpers + easing (the Block World movement pattern)
 *   2. the live connection: WebSocket, with a 1 s polling fallback
 *   3. printer selection, fleet overview, the printer chip
 *   4. overview: digital twin, print health gauge, chamber climate
 *   5. the live print pill (follows you across tabs)
 *   6. files: library, 3D + G-code viewer, edits, convert, compare
 *   7. Confirm Print gate and the print queue
 *   8. automations
 *   9. maintenance swap, filament forecast, side-by-side, camera,
 *      time-lapse, demo tools, handoff
 *  10. phone layout: bottom nav, quick actions, hold-to-cancel
 *  11. Liquid Glass 2.0: morphing, depth, tint, ambient motion
 */
'use strict';

const Workshop = (() => {
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');
  const PHONE = window.matchMedia('(max-width: 720px)');

  /* ================================================================
   * 1. helpers
   * ================================================================ */

  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];
  const enc = encodeURIComponent;
  const fmtHours = (h) => {
    if (h == null || !isFinite(h)) return '—';
    const mins = Math.round(h * 60);
    return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
  };
  const money = (v) => `$${Number(v || 0).toFixed(2)}`;
  const since = (iso) => {
    if (!iso) return '';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  };
  const STATE_COLOR = { printing: 'var(--ok)', paused: 'var(--warn)', error: 'var(--bad)', complete: 'var(--accent)', ready: 'var(--text-faint)' };
  const STATE_HEX = { printing: '#34c759', paused: '#ffcc00', error: '#ff3b30', complete: '#ff7a2f', ready: '#8e8e93' };
  const STATE_WORD = { printing: 'Printing', paused: 'Paused', error: 'Error', complete: 'Finished', ready: 'Idle' };

  /* Continuous visuals ease toward each new reading instead of jumping.
   * This is the easing Block World already uses for movement (initBeacon
   * in app.js: each frame, velocity closes a fixed fraction — ACCEL = 0.18
   * — of the gap to its target), made frame-rate independent so a 120 Hz
   * screen and a 60 Hz one move at the same speed. */
  const EASE_RATE = 0.18;
  function ease(current, target, dt) {
    if (REDUCED.matches) return target;
    const k = 1 - Math.pow(1 - EASE_RATE, dt * 60);
    return current + (target - current) * k;
  }
  const smooth = new Map();          // key -> {value, target, apply}
  let animating = false, lastFrame = 0;
  function tween(key, target, apply) {
    const entry = smooth.get(key);
    if (entry) { entry.target = target; entry.apply = apply; }
    else smooth.set(key, { value: target, target, apply });
    if (!entry) apply(target);
    if (!animating) { animating = true; lastFrame = performance.now(); requestAnimationFrame(frame); }
  }
  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    let moving = false;
    for (const e of smooth.values()) {
      if (Array.isArray(e.target)) {
        e.value = e.value.map((v, i) => ease(v, e.target[i], dt));
        if (e.value.some((v, i) => Math.abs(v - e.target[i]) > 0.02)) moving = true;
        else e.value = e.target.slice();
      } else {
        e.value = ease(e.value, e.target, dt);
        if (Math.abs(e.value - e.target) > 0.001) moving = true;
        else e.value = e.target;
      }
      e.apply(e.value);
    }
    if (moving) requestAnimationFrame(frame); else animating = false;
  }

  function empty(title, sub) { return EMPTY(title, sub); }
  function demoNeeded(what) { return empty(`No printer connected`, `Turn on demo data to see ${what} on the simulated printers.`); }

  /* ================================================================
   * 2. the live connection
   * ================================================================ */

  const live = { ws: null, mode: 'off', retries: 0, poll: null, lastAt: 0, lastEvent: 0, closing: false, fleet: [] };

  function isLive() { return live.mode === 'ws' || live.mode === 'poll'; }

  function reconnect() {
    live.closing = true;
    if (live.ws) { try { live.ws.close(); } catch (e) { /* already closed */ } }
    live.ws = null;
    clearInterval(live.poll);
    live.poll = null;
    live.retries = 0;
    live.closing = false;
    connect();
  }

  function connect() {
    if (!demoOn) { live.mode = 'off'; badge(); return; }
    if (!('WebSocket' in window)) { startPolling(); return; }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const params = ['demo=1', 'fleet=1'];
    if (currentPrinter) params.push(`printer=${enc(currentPrinter)}`);
    let ws;
    try { ws = new WebSocket(`${proto}://${location.host}/api/live?${params.join('&')}`); }
    catch (e) { startPolling(); return; }
    live.ws = ws;
    ws.onopen = () => { live.mode = 'ws'; live.retries = 0; badge(); };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (!msg.type) { live.mode = 'off'; badge(); return; }          // {"connected":false,"demo":false}
      if (msg.type === 'state' && msg.printer === (currentPrinter || msg.printer)) {
        live.lastAt = performance.now();
        applyState(msg.state);
      } else if (msg.type === 'fleet') {
        renderFleet(msg.printers);
      } else if (msg.type === 'event') {
        live.lastEvent = Math.max(live.lastEvent, msg.event.id);
        onEvent(msg.event);
      }
    };
    ws.onclose = () => {
      if (live.ws !== ws || live.closing) return;
      live.ws = null;
      if (!demoOn) { live.mode = 'off'; badge(); return; }
      live.retries += 1;
      if (live.retries >= 3) { startPolling(); return; }
      live.mode = 'reconnecting'; badge();
      setTimeout(() => { if (!live.ws && live.mode !== 'poll') connect(); }, 600 * live.retries);
    };
  }

  /* Fallback when a WebSocket can't be opened (an old proxy, a strict
   * network): ask the same live cache once a second instead. Slower to
   * notice changes, but the numbers are the same. */
  function startPolling() {
    live.mode = 'poll'; badge();
    clearInterval(live.poll);
    let tick = 0;
    const once = async () => {
      if (!demoOn) { clearInterval(live.poll); live.mode = 'off'; badge(); return; }
      const snap = await getJSON(api('/api/live/snapshot')).catch(() => null);
      if (snap && snap.state) { live.lastAt = performance.now(); applyState(snap.state); }
      const ev = await getJSON(api(`/api/live/events?since=${live.lastEvent}`)).catch(() => null);
      (ev && ev.events || []).forEach(e => { live.lastEvent = Math.max(live.lastEvent, e.id); onEvent(e); });
      if (tick++ % 2 === 0) {
        const fleet = await getJSON(api('/api/fleet')).catch(() => null);
        if (fleet && fleet.printers) renderFleet(fleet.printers);
      }
    };
    once();
    live.poll = setInterval(once, 1000);
  }

  function badge() {
    const el = $('rb-live');
    if (!el) return;
    el.hidden = live.mode === 'off';
    el.dataset.mode = live.mode;
  }
  setInterval(() => {
    if (!isLive()) return;
    const age = (performance.now() - live.lastAt) / 1000;
    const how = live.mode === 'ws' ? 'Live' : 'Polling 1 s';
    $('rb-live-text').textContent = live.lastAt ? `${how} · ${age < 1 ? age.toFixed(1) : Math.round(age)} s` : how;
    $('rb-live').classList.toggle('is-stale', age > 3);
  }, 250);

  /* Every fresh printer state lands here - from the WebSocket, the polling
   * fallback, or straight back from a control command. */
  let printerState = null;
  function applyState(state, fromCommand = false) {
    if (!state || !state.state) return;
    printerState = state;
    lastPrinterState = state;
    renderStatusRibbon(state);
    renderPill(state);
    renderTwin(state);
    renderQuickActions(state);
    updateChamberNow(state);
    renderChip();
    if (fromCommand) refreshSoon();
  }

  async function refreshPrinter() {
    const state = await getJSON(api('/api/printer')).catch(() => null);
    if (state && state.state) applyState(state);
  }

  let refreshTimer = null;
  function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { loadHealth(); loadQueue(); }, 200);
  }

  function onEvent(event) {
    if (event.type === 'print_event') {
      const mine = !currentPrinter || event.printer === currentPrinter;
      const word = { started: 'started', finished: 'finished', failed: 'failed', paused: 'paused', resumed: 'resumed', cancelled: 'cancelled' }[event.event];
      if (event.event === 'finished' && event.summary) celebrate(event);
      else toast(`${event.printer_name}: print ${word}${event.file ? ` — ${event.file}` : ''}`,
                 event.event === 'failed' ? 'bad' : 'info');
      if (mine) { loadHealth(); loadQueue(); loadTimelapse(); }
    } else if (event.type === 'automation') {
      toast(`Rule "${event.rule_name}": ${event.ok ? event.detail : event.error}`, event.ok ? 'ok' : 'warn', 6500);
      loadRuleLog();
      loadRules();
    } else if (event.type === 'queue') {
      if (event.started) toast(`Queue started ${event.started.filename}`, 'ok');
      if (event.held) toast(`Queue is holding ${event.held.filename}: ${event.held.note}`, 'warn', 8000);
      loadQueue();
    }
  }

  /* ================================================================
   * 3. printers: selection, fleet overview, chip
   * ================================================================ */

  function printerName(id) {
    const hit = live.fleet.find(p => p.id === id);
    return hit ? hit.name : (id || 'Default printer');
  }

  function renderChip() {
    const chip = $('printer-chip');
    if (!chip) return;
    chip.hidden = !demoOn && !registry.length;
    const id = currentPrinter || (live.fleet[0] && live.fleet[0].id);
    const row = live.fleet.find(p => p.id === id);
    $('printer-chip-name').textContent = row ? row.name : (printerState && printerState.printer_name) || 'Printer';
    const state = row ? row.state : (printerState && printerState.state);
    chip.style.setProperty('--pc-color', STATE_HEX[state] || '#8e8e93');
  }

  function selectPrinter(id, fromEl) {
    currentPrinter = id;
    localStorage.setItem(PRINTER_KEY, id);
    if (live.ws && live.ws.readyState === 1) live.ws.send(JSON.stringify({ type: 'subscribe', printer: id, fleet: true }));
    else reconnect();
    renderChip();
    qsa('.fleet-card').forEach(c => c.classList.toggle('is-selected', c.dataset.printer === id));
    const go = () => { showTab('overview'); refreshAll(); };
    if (fromEl) morph(fromEl, () => qs('#tab-overview .live-row') || qs('#tab-overview'), go);
    else go();
    reportView();
  }

  function ringSVG(progress, color, size = 58) {
    const r = 15.5, c = 2 * Math.PI * r;
    return `<svg class="ring-svg" viewBox="0 0 36 36" width="${size}" height="${size}" aria-hidden="true">
      <circle cx="18" cy="18" r="${r}" class="rs-track"/>
      <circle cx="18" cy="18" r="${r}" class="rs-fill" style="stroke:${color};stroke-dasharray:${c};stroke-dashoffset:${c * (1 - progress)}"/>
    </svg>`;
  }

  function renderFleet(printers) {
    live.fleet = printers || [];
    renderChip();
    const grid = $('fleet-grid');
    if (!grid) return;
    if (!demoOn) { grid.innerHTML = demoNeeded('the fleet'); grid.dataset.ids = ''; return; }
    const ids = live.fleet.map(p => p.id).join(',');
    if (grid.dataset.ids !== ids) {
      grid.dataset.ids = ids;
      grid.innerHTML = live.fleet.map(p => `
        <article class="fleet-card liquid-glass" data-tint data-printer="${esc(p.id)}">
          <div class="fc-head">
            <h3 class="fc-name">${esc(p.name)}</h3>
            <span class="fc-state" data-f="state"></span>
          </div>
          <div class="fc-main">
            <div class="fc-ring" data-f="ring"></div>
            <div class="fc-info">
              <div class="fc-file" data-f="file"></div>
              <div class="fc-meta" data-f="meta"></div>
            </div>
          </div>
          <div class="fc-docks" data-f="docks" aria-label="Toolhead docks"></div>
          <div class="fc-temps" data-f="temps"></div>
          <ul class="fc-alerts" data-f="alerts"></ul>
          <button class="btn block fc-open" type="button" data-open="${esc(p.id)}">Open ${esc(p.name)}</button>
        </article>`).join('');
      qsa('[data-open]', grid).forEach(btn => btn.addEventListener('click', () => selectPrinter(btn.dataset.open, btn.closest('.fleet-card'))));
    }
    live.fleet.forEach(p => {
      const card = qs(`.fleet-card[data-printer="${CSS.escape(p.id)}"]`, grid);
      if (!card) return;
      const f = (k) => qs(`[data-f="${k}"]`, card);
      card.classList.toggle('is-selected', p.id === (currentPrinter || live.fleet[0].id));
      card.style.setProperty('--glass-tint', p.state === 'printing' && p.active_color ? p.active_color : STATE_HEX[p.state] || '#ffffff');
      const st = f('state');
      st.textContent = STATE_WORD[p.state] || p.state;
      st.style.setProperty('--dot', STATE_COLOR[p.state]);
      f('ring').innerHTML = `${ringSVG(p.progress, STATE_HEX[p.state])}<span class="fc-pct">${Math.round(p.progress * 100)}%</span>`;
      f('file').textContent = p.current_file || (p.state === 'error' ? p.state_message : 'No job');
      f('meta').textContent = p.remaining_hours != null ? `${fmtHours(p.remaining_hours)} left` : (p.state_message || '');
      f('docks').innerHTML = Object.entries(p.docks).map(([th, d]) => `
        <span class="fc-dock ${d.status}" title="${esc(th)}: ${esc(d.status)}">
          <span class="fc-dock-chip" style="background:${esc(d.color)}"></span>${esc(th)}
        </span>`).join('');
      f('temps').innerHTML = `
        <span>Nozzle <b>${p.nozzle_temperature != null ? formatTemp(p.nozzle_temperature) : '—'}</b></span>
        <span>Bed <b>${formatTemp(p.bed_temperature)}</b></span>
        <span>Chamber <b>${p.chamber_temperature != null ? formatTemp(p.chamber_temperature) : '—'}</b></span>
        <span>Health <b>${p.health}</b></span>`;
      f('alerts').innerHTML = p.alerts.length
        ? p.alerts.map(a => `<li class="fc-alert ${a.level}">${esc(a.text)}</li>`).join('')
        : '<li class="fc-alert ok">No alerts</li>';
    });
  }

  let registry = [];
  async function loadRegistry() {
    const host = $('fleet-registry');
    const data = await getJSON('/api/fleet/registry').catch(() => ({}));
    if (isModuleDisabled(data)) { host.innerHTML = moduleDisabledEmpty('Printer fleet'); return; }
    registry = data.printers || [];
    host.innerHTML = registry.length ? registry.map(p => `
      <div class="reg-row">
        <span class="reg-name">${esc(p.name)}</span>
        <code class="reg-url">${esc(p.moonraker_url)}</code>
        <span class="pill reg-pill">Not connected</span>
        <button class="btn small" data-reg-remove="${esc(p.id)}" type="button">Remove</button>
      </div>`).join('') : '<p class="log-empty">No printers added yet.</p>';
    qsa('[data-reg-remove]', host).forEach(b => b.addEventListener('click', async () => {
      const r = await postJSON(`/api/fleet/registry/${enc(b.dataset.regRemove)}/remove`, {});
      toast(r.ok ? 'Printer removed' : `Couldn't remove: ${r.body.error}`, r.ok ? 'ok' : 'bad');
      loadRegistry();
    }));
    renderChip();
  }

  function initFleet() {
    $('printer-chip').addEventListener('click', () => showTab('fleet'));
    $('fleet-add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await postJSON('/api/fleet/registry', { name: $('fleet-add-name').value, moonraker_url: $('fleet-add-url').value });
      if (r.ok) { toast(`${r.body.name} added — it will show as connected once a real Moonraker link exists`, 'ok', 6000); e.target.reset(); }
      else toast(`Couldn't add it: ${r.body.error}`, 'bad', 6000);
      loadRegistry();
    });
  }

  /* ================================================================
   * 4. overview: digital twin, health gauge, chamber
   * ================================================================ */

  /* The digital twin is plain CSS 3D — the same preserve-3d scene
   * technique as Echo Maze and Block World in the games tab, not WebGL:
   * a tilted bed, the part growing layer by layer, the gantry and the
   * toolhead at its reported X/Y/Z, and the four docks with their ring
   * colours. Drag to turn it. */
  const TWIN_PX = 200 / 270;       // 200 px across a 270 mm bed
  const twin = { yaw: -28, built: false };

  function buildTwin() {
    const host = $('twin-host');
    host.innerHTML = `
      <div class="twin-scene" id="twin-scene" aria-label="Digital twin of the printer. Drag to turn." role="img">
        <div class="twin-world" id="twin-world">
          <div class="twin-bed"></div>
          <div class="twin-part" id="twin-part">
            <i class="tp-top"></i><i class="tp-f"></i><i class="tp-b"></i><i class="tp-l"></i><i class="tp-r"></i>
          </div>
          <div class="twin-gantry" id="twin-gantry"></div>
          <div class="twin-head" id="twin-head">
            <i class="th-top"></i><i class="th-f"></i><i class="th-b"></i><i class="th-l"></i><i class="th-r"></i>
          </div>
          <div class="twin-docks" id="twin-docks"></div>
        </div>
      </div>
      <div class="twin-readout" id="twin-readout"></div>`;
    const scene = $('twin-scene');
    let drag = null;
    scene.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, yaw: twin.yaw }; scene.setPointerCapture?.(e.pointerId); });
    scene.addEventListener('pointermove', (e) => {
      if (!drag) return;
      twin.yaw = drag.yaw + (e.clientX - drag.x) * 0.5;
      $('twin-world').style.setProperty('--yaw', `${twin.yaw}deg`);
    });
    // Released anywhere - a finger can leave the scene mid-drag.
    const release = () => { drag = null; };
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', release);
    twin.built = true;
  }

  function renderTwin(state) {
    const host = $('twin-host');
    if (!host) return;
    if (!state) { host.innerHTML = demoNeeded('the digital twin'); twin.built = false; return; }
    if (!twin.built) buildTwin();
    const world = $('twin-world');
    world.style.setProperty('--yaw', `${twin.yaw}deg`);
    const [x, y, z] = state.toolhead_position || [135, 135, 0];
    tween('twin-head', [x, y, z], ([hx, hy, hz]) => {
      const head = $('twin-head'), gantry = $('twin-gantry');
      if (!head) return;
      head.style.transform = `translate3d(${hx * TWIN_PX}px, ${hy * TWIN_PX}px, ${hz * TWIN_PX + 10}px)`;
      gantry.style.transform = `translate3d(0, ${hy * TWIN_PX}px, ${hz * TWIN_PX + 22}px)`;
    });
    const layer = state.layer || { current: 0, total: 0 };
    const frac = layer.total ? Math.min(1, layer.current / layer.total) : 0;
    const active = state.active_toolhead;
    const color = active ? state.toolheads[active].filament_color_hex : '#9aa3b5';
    const part = $('twin-part');
    const printing = ['printing', 'paused', 'complete'].includes(state.state);
    part.hidden = !printing;
    part.style.setProperty('--part-color', color);
    tween('twin-part-h', printing ? Math.max(2, frac * 70) : 0, (h) => part.style.setProperty('--part-h', `${h}px`));
    $('twin-card').style.setProperty('--glass-tint', color);
    $('twin-docks').innerHTML = Object.entries(state.toolheads).map(([th, d]) => `
      <div class="twin-dock ${d.status}" style="--ring:${d.status === 'error' ? '#ff3b30' : (d.status === 'active' ? '#34c759' : '#f5f5f7')};--fil:${esc(d.filament_color_hex)}">
        <span class="td-ring"></span><span class="td-label">${esc(th)}</span>
      </div>`).join('');
    $('twin-readout').textContent = `X ${x.toFixed(1)} · Y ${y.toFixed(1)} · Z ${z.toFixed(2)} mm` +
      (active ? ` · ${active} active` : '') + (layer.total ? ` · layer ${layer.current}/${layer.total}` : '');
    $('twin-sub').textContent = `${state.printer_name || 'Printer'} · ${STATE_WORD[state.state] || state.state}`;
  }

  /* Print health: one animated dial. */
  function gaugeSVG() {
    return `<svg class="gauge" viewBox="0 0 200 120" aria-hidden="true">
      <path class="g-track" d="M20 100 A80 80 0 0 1 180 100"/>
      <path class="g-fill" id="g-fill" d="M20 100 A80 80 0 0 1 180 100"/>
      <line class="g-needle" id="g-needle" x1="100" y1="100" x2="100" y2="42"/>
      <circle class="g-hub" cx="100" cy="100" r="6"/>
    </svg>`;
  }

  async function loadHealth() {
    const host = $('health-host');
    if (!host) return;
    const data = await getJSON(api('/api/health')).catch(() => null);
    if (!data || !hasData(data) || data.score == null) { host.innerHTML = demoNeeded('print health'); host.dataset.built = ''; return; }
    if (!host.dataset.built) {
      host.dataset.built = '1';
      host.innerHTML = `<div class="gauge-wrap">${gaugeSVG()}<div class="g-num"><span id="g-score">—</span><small id="g-band"></small></div></div>
        <ul class="g-deductions" id="g-deductions"></ul>`;
    }
    const arcLen = Math.PI * 80;
    const fill = $('g-fill');
    fill.style.strokeDasharray = `${arcLen}`;
    const color = data.band === 'good' ? 'var(--ok)' : (data.band === 'fair' ? 'var(--warn)' : 'var(--bad)');
    fill.style.stroke = color;
    tween('gauge', data.score, (v) => {
      fill.style.strokeDashoffset = `${arcLen * (1 - v / 100)}`;
      $('g-needle').setAttribute('transform', `rotate(${-90 + v * 1.8} 100 100)`);
      $('g-score').textContent = Math.round(v);
    });
    host.setAttribute('aria-label', `Print health ${data.score} out of 100, ${data.band}`);
    $('g-band').textContent = { good: 'Good', fair: 'Fair', poor: 'Needs attention' }[data.band];
    $('g-deductions').innerHTML = data.deductions.length
      ? data.deductions.map(d => `<li><b>${d.points}</b> ${esc(d.reason)}</li>`).join('')
      : '<li class="ok">Nothing is pulling the score down.</li>';
  }

  /* Chamber climate: a read-only reading, where Klipper reports one. */
  let chamberHistory = [];
  async function loadChamber() {
    const host = $('chamber-host');
    if (!host) return;
    const data = await getJSON(api('/api/chamber')).catch(() => null);
    if (isModuleDisabled(data)) { host.innerHTML = moduleDisabledEmpty('Chamber climate'); host.dataset.built = ''; return; }
    if (!data || !hasData(data)) { host.innerHTML = demoNeeded('chamber climate'); host.dataset.built = ''; return; }
    if (!data.reported) {
      host.innerHTML = empty('Not reported by this printer', 'Klipper reports a chamber reading when the machine has a chamber sensor configured.');
      host.dataset.built = '';
      return;
    }
    chamberHistory = data.history.map(s => ({ t: s.t, c: s.chamber, b: s.bed }));
    if (!host.dataset.built) {
      host.dataset.built = '1';
      host.innerHTML = `<div class="ch-now"><span id="ch-val">—</span><small>chamber</small></div>
        <svg class="spark" id="ch-spark" viewBox="0 0 300 80" preserveAspectRatio="none" role="img" aria-label="Chamber temperature over the last 30 minutes"></svg>
        <div class="ch-legend"><span class="lg-c">Chamber</span><span class="lg-b">Bed</span><span id="ch-range"></span></div>`;
    }
    drawSpark();
  }

  function updateChamberNow(state) {
    const val = $('ch-val');
    if (!val || state.chamber_temperature == null) return;
    tween('chamber', state.chamber_temperature, (v) => { val.textContent = formatTemp(v); });
    const last = chamberHistory[chamberHistory.length - 1];
    const now = Date.now() / 1000;
    if (!last || now - last.t >= 5) {
      chamberHistory.push({ t: now, c: state.chamber_temperature, b: state.bed_temperature });
      if (chamberHistory.length > 360) chamberHistory.shift();
      drawSpark();
    }
  }

  function drawSpark() {
    const svg = $('ch-spark');
    if (!svg || !chamberHistory.length) return;
    const vals = chamberHistory.flatMap(s => [s.c, s.b]).filter(v => v != null);
    const lo = Math.floor(Math.min(...vals) - 2), hi = Math.ceil(Math.max(...vals) + 2);
    const t0 = chamberHistory[0].t, t1 = Math.max(t0 + 1, chamberHistory[chamberHistory.length - 1].t);
    const path = (key) => chamberHistory.map((s, i) =>
      `${i ? 'L' : 'M'}${((s.t - t0) / (t1 - t0) * 300).toFixed(1)} ${(80 - (s[key] - lo) / (hi - lo) * 76 - 2).toFixed(1)}`).join(' ');
    svg.innerHTML = `<path class="sp-b" d="${path('b')}"/><path class="sp-c" d="${path('c')}"/>`;
    $('ch-range').textContent = `${formatTemp(lo)} – ${formatTemp(hi)}`;
  }

  /* ================================================================
   * 5. the live print pill
   * ================================================================ */

  function renderPill(state) {
    const pill = $('live-pill');
    const show = ['printing', 'paused', 'complete'].includes(state.state);
    pill.hidden = !show;
    if (!show) return;
    const pct = Math.round(state.progress * 100);
    const elapsed = state.print_duration_hours || 0;
    const left = state.progress > 0 && state.progress < 1 ? elapsed / state.progress - elapsed : null;
    const active = state.active_toolhead;
    pill.style.setProperty('--glass-tint', active ? state.toolheads[active].filament_color_hex : STATE_HEX[state.state]);
    pill.dataset.state = state.state;
    $('lp-title').textContent = `${state.printer_name ? state.printer_name + ' · ' : ''}${state.state === 'complete' ? 'Done' : pct + '%'}`;
    $('lp-sub').textContent = state.state === 'paused' ? `Paused — ${state.current_file || ''}` :
      state.state === 'complete' ? `${state.current_file || ''} finished` : `${state.current_file || ''} · ${fmtHours(left)} left`;
    const c = 2 * Math.PI * 15.5;
    tween('pill', state.progress, (v) => { $('lp-fill').style.strokeDashoffset = `${c * (1 - v)}`; });
    $('lp-fill').style.strokeDasharray = `${c}`;
    pill.setAttribute('aria-label', `${state.printer_name || 'Printer'}: ${STATE_WORD[state.state]}, ${pct} percent. Open printer control.`);
  }

  /* ================================================================
   * 6. files
   * ================================================================ */

  const files = { list: [], viewer: null, open: null, analysis: null, lines: { offset: 0, q: '' }, selectedLine: null };

  async function loadFiles() {
    const grid = $('file-grid');
    if (!grid) return;
    const data = await getJSON('/api/files').catch(() => null);
    if (isModuleDisabled(data)) { grid.innerHTML = moduleDisabledEmpty('Print file library'); $('file-recent').innerHTML = ''; return; }
    files.list = (data && data.files) || [];
    $('file-recent').innerHTML = data && data.recent && data.recent.length
      ? `<span class="fr-label">Recent</span>${data.recent.map(n => `<button class="chip-btn" data-open-file="${esc(n)}" type="button">${esc(n)}</button>`).join('')}` : '';
    grid.innerHTML = files.list.length ? files.list.map(f => {
      const s = f.summary || {};
      const verdict = s.preflight ? `<span class="pf-badge ${s.preflight}">${{ clear: 'Pre-flight clear', check: 'Check warnings', blocked: 'Blocked' }[s.preflight]}</span>` : '';
      const meta = f.kind === 'gcode'
        ? `${fmtHours(s.estimated_hours)} · ${s.filament_grams != null ? s.filament_grams.toFixed(1) + ' g' : '—'} · ${(s.tools_used || []).join(' ')}`
        : (s.size_mm ? `${s.size_mm.map(v => v.toFixed(0)).join(' × ')} mm · ${(s.triangles || 0).toLocaleString()} triangles` : (s.error || ''));
      return `<button class="file-card" type="button" data-open-file="${esc(f.name)}">
          <span class="fcd-thumb">${s.has_thumbnail ? `<img loading="lazy" alt="" onload="this.classList.toggle('is-tiny', this.naturalWidth <= 64)" src="/api/files/thumb?name=${enc(f.name)}&v=${enc(f.modified_at || '')}">` : `<span class="fcd-kind">${esc(f.kind.toUpperCase())}</span>`}</span>
          <span class="fcd-name">${esc(f.name)}</span>
          <span class="fcd-meta">${esc(meta)}</span>
          <span class="fcd-tags"><span class="kind-tag">${esc(f.kind.toUpperCase())}</span>${verdict}${f.origin && f.origin !== 'upload' ? `<span class="origin-tag">${esc(f.origin)}</span>` : ''}</span>
        </button>`;
    }).join('') : empty('No files yet', 'Add your own G-code, STL or 3MF files, or the sample files to try things out.');
    qsa('[data-open-file]').forEach(b => b.onclick = () => openFile(b.dataset.openFile, b.classList.contains('file-card') ? b : null));
  }

  async function uploadFiles(list) {
    for (const file of list) {
      const res = await fetch(`/api/files/upload?name=${enc(file.name)}`, { method: 'POST', body: file });
      const body = await res.json().catch(() => ({}));
      toast(res.ok ? `Added ${body.name}` : `Couldn't add ${file.name}: ${body.error || res.status}`, res.ok ? 'ok' : 'bad', 6000);
    }
    loadFiles();
  }

  function initFiles() {
    $('file-upload').addEventListener('change', (e) => { uploadFiles([...e.target.files]); e.target.value = ''; });
    $('file-samples').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Adding…';
      const r = await postJSON('/api/files/samples', {});
      btn.disabled = false; btn.textContent = 'Add sample files';
      toast(r.ok ? (r.body.added.length ? `Added ${r.body.added.length} sample files` : 'The sample files are already here') : `Couldn't add samples: ${r.body.error}`, r.ok ? 'ok' : 'bad');
      loadFiles();
    });
    const lib = qs('.files-library');
    const drop = $('file-drop');
    lib.addEventListener('dragover', (e) => { e.preventDefault(); drop.hidden = false; });
    lib.addEventListener('dragleave', (e) => { if (!lib.contains(e.relatedTarget)) drop.hidden = true; });
    lib.addEventListener('drop', (e) => { e.preventDefault(); drop.hidden = true; uploadFiles([...e.dataTransfer.files]); });
    $('fd-close').addEventListener('click', closeFile);
    $('ar-exit').addEventListener('click', () => { if (ar.handle) ar.handle.end(); else $('ar-overlay').hidden = true; });
  }

  function closeFile() {
    if (ar.handle) ar.handle.end();
    $('file-detail').hidden = true;
    files.open = null;
    if (files.viewer) { files.viewer.dispose(); files.viewer = null; }
    reportView();
  }

  async function openFile(name, fromEl) {
    const entry = files.list.find(f => f.name === name);
    if (!entry) return;
    files.open = entry;
    files.lines = { offset: 0, q: '' };
    files.selectedLine = null;
    postJSON('/api/files/opened', { name });
    const panel = $('file-detail');
    const reveal = (instant) => {
      panel.hidden = false;
      panel.scrollIntoView({ behavior: instant || REDUCED.matches ? 'auto' : 'smooth', block: 'start' });
    };
    // Scroll first (instantly), then let the glass morph into the panel's
    // final on-screen position.
    if (fromEl) morph(fromEl, () => panel, () => reveal(true)); else reveal(false);
    $('fd-name').textContent = name;
    const s = entry.summary || {};
    $('fd-sub').textContent = entry.note || ({ sample: 'Sample file', converted: 'Converted for the Snapmaker U1', edited: 'Edited here', upload: 'Uploaded' }[entry.origin] || '');
    $('fd-side').innerHTML = '<p class="log-empty">Reading the file…</p>';
    $('fd-gcode').hidden = entry.kind !== 'gcode';
    $('fd-view-tools').innerHTML = '';
    if (files.viewer) { files.viewer.dispose(); files.viewer = null; }
    // A fresh canvas for every file: a disposed viewer releases its WebGL
    // context, and a canvas can't get a new one after that.
    const oldCanvas = $('fd-canvas');
    const canvas = oldCanvas.cloneNode(false);
    oldCanvas.replaceWith(canvas);
    let viewer = null;
    try { viewer = new DV3D.Viewer(canvas); files.viewer = viewer; }
    catch (err) { $('fd-view-tools').innerHTML = `<p class="log-empty">3D view unavailable in this browser: ${esc(err.message || 'WebGL could not start')}</p>`; }
    reportView();
    if (entry.kind === 'gcode') await openGcode(entry, viewer);
    else await openModel(entry, viewer);
  }

  async function openGcode(entry, viewer) {
    const res = await fetch(`/api/files/analysis?name=${enc(entry.name)}`);
    const a = await res.json();
    if (!res.ok) { $('fd-side').innerHTML = `<p class="log-empty">${esc(a.error || 'Could not read the file')}</p>`; return; }
    files.analysis = a;
    if (viewer && a.toolpath) {
      const { zmax } = viewer.setToolpath(a.toolpath.segments, a.meta.filament_colours);
      $('fd-view-tools').innerHTML = `
        <label class="vt-layer">Up to <span id="vt-z">${zmax.toFixed(2)}</span> mm
          <input type="range" id="vt-range" min="0" max="${zmax}" step="0.01" value="${zmax}" aria-label="Show layers up to this height">
        </label>
        <label class="vt-travel"><input type="checkbox" id="vt-travel"> Show travel moves</label>
        ${a.toolpath.downsampled ? `<span class="vt-note">Showing ${a.toolpath.segments.length.toLocaleString()} of ${a.toolpath.total_segments.toLocaleString()} moves</span>` : ''}`;
      $('vt-range').addEventListener('input', (e) => { viewer.setLayerLimit(+e.target.value); $('vt-z').textContent = (+e.target.value).toFixed(2); });
      $('vt-travel').addEventListener('change', (e) => { viewer.showTravel = e.target.checked; viewer.draw(); });
    }
    renderGcodeSide(entry, a);
    loadLines();
  }

  function preflightList(pre) {
    const rows = [...pre.errors.map(e => ({ ...e, lvl: 'error' })), ...pre.warnings.map(w => ({ ...w, lvl: 'warning' }))];
    if (!rows.length) return '<p class="pf-ok">No problems found in any move.</p>';
    return `<ul class="pf-list">${rows.map(r => `<li class="pf-${r.lvl}">
        <span>${esc(r.message)}${r.more_like_this ? ` <em>(+${r.more_like_this} more like this)</em>` : ''}</span>
        ${r.line ? `<button class="chip-btn" type="button" data-goto-line="${r.line}">Line ${r.line}</button>` : ''}
      </li>`).join('')}</ul>`;
  }

  function renderGcodeSide(entry, a) {
    const verdictText = { clear: 'Pre-flight clear', check: 'Pre-flight: check the warnings', blocked: 'Pre-flight: blocked' }[a.preflight.verdict];
    $('fd-side').innerHTML = `
      <div class="fd-facts divider-row cols-2">
        <div><span class="stat-key">Time</span><b>${fmtHours(a.estimated_hours)}</b><small>${esc(a.estimated_hours_source)}</small></div>
        <div><span class="stat-key">Filament</span><b>${a.filament_grams.toFixed(1)} g</b><small>${esc(a.filament_grams_source)}</small></div>
        <div><span class="stat-key">Layers</span><b>${a.layers}</b><small>${a.footprint_mm ? a.footprint_mm.join(' × ') + ' mm footprint' : ''}</small></div>
        <div><span class="stat-key">Toolheads</span><b>${a.tools_used.join(' ') || '—'}</b><small>${(a.meta.filament_types || []).join(', ')}</small></div>
      </div>
      <h3 class="fd-h pf-head ${a.preflight.verdict}">${verdictText}</h3>
      ${preflightList(a.preflight)}
      <div class="fd-actions">
        <button class="btn primary" id="fd-print" type="button">Print…</button>
        <button class="btn" id="fd-queue" type="button">Add to queue</button>
        <a class="btn" href="/api/files/raw?name=${enc(entry.name)}&download=1">Download</a>
        ${entry.has_original ? '<button class="btn" id="fd-restore" type="button">Restore original</button>' : ''}
        <button class="btn danger" id="fd-delete" type="button">Delete</button>
      </div>
      <div id="fd-compare-host"></div>`;
    $('fd-print').addEventListener('click', (e) => openConfirm(entry.name, e.currentTarget));
    $('fd-queue').addEventListener('click', async (e) => {
      if (!demoOn) { toast('No printer connected — turn on demo data to queue on a simulated printer', 'warn'); return; }
      const r = await runCommand(e.currentTarget, '/api/queue/add', { filename: entry.name },
        { sending: 'Adding…', done: `Added ${entry.name} to the queue`, failed: 'Could not queue it' });
      if (r.ok) loadQueue();
    });
    $('fd-delete').addEventListener('click', () => deleteFile(entry.name));
    if ($('fd-restore')) $('fd-restore').addEventListener('click', async () => {
      const r = await postJSON('/api/files/restore', { name: entry.name });
      toast(r.ok ? 'Original restored' : `Couldn't restore: ${r.body.error}`, r.ok ? 'ok' : 'bad');
      await loadFiles(); openFile(entry.name);
    });
    renderCompare(entry);
    qsa('[data-goto-line]', $('fd-side')).forEach(b => b.addEventListener('click', () => gotoLine(+b.dataset.gotoLine)));
  }

  /* "Compare settings with…" - rebuilt whenever the library changes, so a
   * file converted a moment ago is already in the list. */
  function renderCompare(entry) {
    const host = $('fd-compare-host');
    if (!host) return;
    const others = files.list.filter(f => f.kind === entry.kind && f.name !== entry.name);
    host.innerHTML = others.length ? `<div class="inline-form fd-compare">
        <label class="sr-only" for="fd-compare-with">Compare settings with</label>
        <select id="fd-compare-with">${others.map(o => `<option>${esc(o.name)}</option>`).join('')}</select>
        <button class="btn" id="fd-compare" type="button">Compare settings</button></div>` : '';
    if (others.length) $('fd-compare').addEventListener('click', () => openDiff(entry.name, $('fd-compare-with').value));
  }

  async function deleteFile(name) {
    if (!window.confirm(`Delete ${name} from the library?`)) return;
    const r = await postJSON('/api/files/delete', { name });
    toast(r.ok ? `Deleted ${name}` : `Couldn't delete: ${r.body.error}`, r.ok ? 'ok' : 'bad');
    closeFile();
    loadFiles();
  }

  /* View on your desk (AR). The button appears only where the browser
   * says it can place things in AR; everywhere else, one plain line
   * says why. */
  const ar = { handle: null };
  async function setupAR(entry, mesh) {
    const slot = $('fd-ar-slot'), note = $('fd-ar-note');
    if (!slot || typeof DVAR === 'undefined') return;
    const mods = await getJSON('/api/modules').catch(() => null);
    if (!mods || !(mods.modules || []).some(m => m.id === 'ar_preview' && m.enabled)) return;
    const can = await DVAR.support();
    if (files.open !== entry || !document.body.contains(slot)) return;
    if (!can.ok) {
      note.hidden = false;
      note.textContent = `View on your desk (AR) isn't available here: ${can.reason} ${DVAR.UNSUPPORTED_NOTE}`;
      return;
    }
    slot.innerHTML = '<button class="btn" id="fd-ar" type="button">View on your desk</button>';
    $('fd-ar').addEventListener('click', (e) => startAR(mesh, e.currentTarget));
  }

  async function startAR(mesh, btn) {
    const overlay = $('ar-overlay');
    const reset = () => { overlay.hidden = true; ar.handle = null; btn.disabled = false; btn.textContent = 'View on your desk'; };
    btn.disabled = true;
    btn.textContent = 'Starting AR…';
    $('ar-status').textContent = 'Starting AR…';
    overlay.hidden = false;
    try {
      ar.handle = await DVAR.start(mesh, {
        color: getComputedStyle(document.documentElement).getPropertyValue('--accent'),
        overlay,
        onStatus: (text) => { $('ar-status').textContent = text; },
        onEnd: reset,
      });
      btn.textContent = 'AR is running';
    } catch (err) {
      reset();
      toast(`AR couldn't start: ${err.message || err}`, 'bad', 6000);
    }
  }

  async function openModel(entry, viewer) {
    const side = $('fd-side');
    try {
      const res = await fetch(`/api/files/raw?name=${enc(entry.name)}`);
      if (!res.ok) throw new Error((await res.json()).error || res.status);
      const started = performance.now();
      const mesh = await DV3D.parseModel(await res.arrayBuffer(), entry.name);
      const ms = Math.round(performance.now() - started);
      if (viewer) viewer.setMesh(mesh, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
      const is3mf = entry.kind === '3mf';
      side.innerHTML = `
        <div class="fd-facts divider-row cols-2">
          <div><span class="stat-key">Size</span><b>${mesh.size.map(v => v.toFixed(1)).join(' × ')}</b><small>mm (X × Y × Z)</small></div>
          <div><span class="stat-key">Triangles</span><b>${mesh.triangles.toLocaleString()}</b><small>read in ${ms} ms</small></div>
          <div><span class="stat-key">Objects</span><b>${mesh.objects}</b><small>${esc(mesh.application || (is3mf ? 'No application named' : 'STL'))}</small></div>
          <div><span class="stat-key">Fits the U1?</span><b>${mesh.size[0] <= 270 && mesh.size[1] <= 270 && mesh.size[2] <= 270 ? 'Yes' : 'No'}</b><small>270 × 270 × 270 mm</small></div>
        </div>
        <p class="log-empty">Models need slicing (in Snapmaker Orca) before they can be printed.</p>
        <div class="fd-actions">
          ${is3mf ? '<button class="btn primary" id="fd-convert" type="button">Convert for Snapmaker U1</button>' : ''}
          <span id="fd-ar-slot" class="fd-ar-slot"></span>
          <a class="btn" href="/api/files/raw?name=${enc(entry.name)}&download=1">Download</a>
          <button class="btn danger" id="fd-delete" type="button">Delete</button>
        </div>
        <p class="log-empty fd-ar-note" id="fd-ar-note" hidden></p>
        <div id="fd-compare-host"></div>
        <div id="fd-convert-report"></div>`;
      $('fd-delete').addEventListener('click', () => deleteFile(entry.name));
      if ($('fd-convert')) $('fd-convert').addEventListener('click', (e) => convertFile(entry.name, e.currentTarget));
      renderCompare(entry);
      setupAR(entry, mesh);
    } catch (err) {
      side.innerHTML = `<p class="log-empty">Couldn't read this model: ${esc(err.message)}</p>`;
    }
  }

  async function convertFile(name, button) {
    button.disabled = true;
    button.textContent = 'Converting…';
    const r = await postJSON('/api/convert', { name });
    button.disabled = false;
    button.textContent = 'Convert for Snapmaker U1';
    const host = $('fd-convert-report');
    if (!r.ok) { host.innerHTML = `<p class="convert-fail">${esc(r.body.error)}</p>`; toast('Conversion not possible', 'warn'); return; }
    const rep = r.body.report;
    host.innerHTML = `
      <div class="convert-report">
        <h3 class="fd-h">Converted from ${esc(rep.source_label)}</h3>
        <p>Saved as <button class="chip-btn" data-open-file="${esc(r.body.file.name)}" type="button">${esc(r.body.file.name)}</button>. Printer <b>${esc(rep.printer_profile)}</b>, print profile <b>${esc(rep.print_profile)}</b>, filaments ${rep.filament_profiles.map(esc).join(', ')}.</p>
        ${rep.kept.length ? `<p>Kept the creator's own changes: ${rep.kept.map(k => `<code>${esc(k)}</code>`).join(' ')}</p>` : ''}
        ${rep.warnings.length ? `<ul class="pf-list">${rep.warnings.map(w => `<li class="pf-warning">${esc(w)}</li>`).join('')}</ul>` : ''}
        <p class="log-empty">${esc(rep.unverified)}</p>
      </div>`;
    toast(`Converted — saved as ${r.body.file.name}`, 'ok');
    await loadFiles();
    if (files.open) renderCompare(files.open);
    qsa('[data-open-file]', host).forEach(b => b.onclick = () => openFile(b.dataset.openFile));
  }

  /* G-code lines: a window of 200 at a time, searchable, with small edits. */
  async function loadLines() {
    const host = $('fd-gcode');
    if (!files.open || files.open.kind !== 'gcode') return;
    const { offset, q } = files.lines;
    const url = `/api/files/lines?name=${enc(files.open.name)}&offset=${offset}&limit=200${q ? `&q=${enc(q)}` : ''}`;
    const data = await getJSON(url);
    if (!host.dataset.built) {
      host.dataset.built = '1';
      host.innerHTML = `
        <div class="gc-head">
          <h3 class="fd-h">G-code</h3>
          <form class="inline-form" id="gc-search"><label class="sr-only" for="gc-q">Search the file</label>
            <input type="search" id="gc-q" placeholder="Search (M104, T1, PRINT_START…)"><button class="btn small" type="submit">Find</button></form>
          <div class="gc-nav"><button class="btn small" id="gc-prev" type="button">‹ Earlier</button><span id="gc-pos"></span><button class="btn small" id="gc-next" type="button">Later ›</button></div>
        </div>
        <div class="gc-lines" id="gc-lines" role="listbox" aria-label="G-code lines. Choose one to edit it."></div>
        <div class="gc-edit" id="gc-edit" hidden></div>`;
      $('gc-search').addEventListener('submit', (e) => { e.preventDefault(); files.lines = { offset: 0, q: $('gc-q').value.trim() }; loadLines(); });
      $('gc-prev').addEventListener('click', () => { files.lines.offset = Math.max(0, files.lines.offset - 200); loadLines(); });
      $('gc-next').addEventListener('click', () => { files.lines.offset += 200; loadLines(); });
    }
    $('gc-pos').textContent = data.matches != null ? `${data.matches} matching lines` : `Lines ${offset + 1}–${Math.min(data.total, offset + 200)} of ${data.total.toLocaleString()}`;
    $('gc-prev').disabled = !!q || offset === 0;
    $('gc-next').disabled = !!q || offset + 200 >= data.total;
    $('gc-lines').innerHTML = data.lines.map(l => `
      <button class="gc-line ${l.text.trim().startsWith(';') ? 'is-comment' : ''} ${files.selectedLine === l.n ? 'is-selected' : ''}" role="option"
              aria-selected="${files.selectedLine === l.n}" type="button" data-line="${l.n}"><span class="gc-n">${l.n}</span><span class="gc-t">${esc(l.text) || '&nbsp;'}</span></button>`).join('');
    qsa('.gc-line', host).forEach(b => b.addEventListener('click', () => selectLine(+b.dataset.line, b.querySelector('.gc-t').textContent)));
  }

  function gotoLine(n) {
    files.lines = { offset: Math.max(0, n - 20), q: '' };
    files.selectedLine = n;
    $('fd-gcode').scrollIntoView({ behavior: REDUCED.matches ? 'auto' : 'smooth', block: 'start' });
    loadLines().then(() => {
      const el = qs(`.gc-line[data-line="${n}"]`);
      if (el) { el.scrollIntoView({ block: 'center' }); selectLine(n, el.querySelector('.gc-t').textContent); }
    });
  }

  function selectLine(n, text) {
    files.selectedLine = n;
    qsa('.gc-line').forEach(b => { const on = +b.dataset.line === n; b.classList.toggle('is-selected', on); b.setAttribute('aria-selected', on); });
    const code = text.split(';')[0].trim();
    const params = (code.split(/\s+/).slice(1).map(w => w[0]).filter(c => /[A-Z]/i.test(c))) || [];
    const editable = /^[GM]\d+/i.test(code) && params.length;
    const box = $('gc-edit');
    box.hidden = false;
    box.innerHTML = `
      <div class="gc-edit-title">Line ${n}: <code>${esc(text.trim() || '(blank)')}</code></div>
      <div class="gc-edit-row">
        ${editable ? `<form class="inline-form" id="gc-set">
          <label class="sr-only" for="gc-param">Value to change</label>
          <select id="gc-param">${[...new Set(params)].map(p => `<option>${esc(p.toUpperCase())}</option>`).join('')}</select>
          <label class="sr-only" for="gc-value">New value</label>
          <input type="number" id="gc-value" step="any" required placeholder="new value">
          <button class="btn small primary" type="submit">Change value</button></form>` : ''}
        ${code ? '<button class="btn small" id="gc-comment" type="button">Comment out</button>' : ''}
        <form class="inline-form" id="gc-insert">
          <label class="sr-only" for="gc-cmd">Command to insert after this line</label>
          <input type="text" id="gc-cmd" required placeholder="Insert after, e.g. M106 S128">
          <button class="btn small" type="submit">Insert</button></form>
      </div>
      <p class="gc-edit-msg" id="gc-edit-msg" role="status"></p>`;
    if ($('gc-set')) $('gc-set').addEventListener('submit', (e) => { e.preventDefault(); applyEdit({ kind: 'set_value', line: n, param: $('gc-param').value, value: $('gc-value').value }); });
    if ($('gc-comment')) $('gc-comment').addEventListener('click', () => applyEdit({ kind: 'comment_out', line: n }));
    $('gc-insert').addEventListener('submit', (e) => { e.preventDefault(); applyEdit({ kind: 'insert', after_line: n, command: $('gc-cmd').value }); });
  }

  async function applyEdit(edit) {
    const msg = $('gc-edit-msg');
    msg.className = 'gc-edit-msg';
    msg.textContent = 'Checking the edit…';
    const r = await postJSON('/api/files/edit', { name: files.open.name, edits: [edit] });
    if (!r.ok) { msg.classList.add('is-bad'); msg.textContent = `Not applied: ${r.body.error}`; return; }
    const v = r.body.preflight.verdict;
    msg.classList.add(v === 'blocked' ? 'is-bad' : 'is-ok');
    msg.textContent = `Saved (the original is kept). Pre-flight after the edit: ${{ clear: 'clear', check: 'warnings to check', blocked: 'blocked' }[v]}.`;
    toast('Edit saved — original kept, pre-flight re-checked', 'ok');
    await loadFiles();
    const name = files.open.name, line = files.selectedLine;
    files.open = files.list.find(f => f.name === name);
    const a = await (await fetch(`/api/files/analysis?name=${enc(name)}`)).json();
    files.analysis = a;
    if (files.viewer && a.toolpath) files.viewer.setToolpath(a.toolpath.segments, a.meta.filament_colours);
    renderGcodeSide(files.open, a);
    await loadLines();
    if (line) {
      const el = qs(`.gc-line[data-line="${line}"]`);
      if (el) selectLine(line, el.querySelector('.gc-t').textContent);
      $('gc-edit-msg').className = msg.className;
      $('gc-edit-msg').textContent = msg.textContent;
    }
  }

  async function openDiff(a, b) {
    const dialog = $('diff-dialog');
    $('diff-sub').textContent = `${a}  ↔  ${b}`;
    $('diff-body').innerHTML = '<p class="log-empty">Comparing…</p>';
    openDialog(dialog);
    const res = await fetch(`/api/profiles/diff?a=${enc(a)}&b=${enc(b)}`);
    const d = await res.json();
    if (!res.ok) { $('diff-body').innerHTML = `<p class="log-empty">${esc(d.error)}</p>`; return; }
    const label = { changed: 'Changed', only_a: 'Only in first', only_b: 'Only in second' };
    $('diff-body').innerHTML = `
      <p class="diff-counts"><b>${d.counts.changed}</b> changed · <b>${d.counts.only_a}</b> only in the first · <b>${d.counts.only_b}</b> only in the second · ${d.counts.same} the same</p>
      ${d.rows.length ? `<div class="diff-table" role="table" aria-label="Settings side by side">
        <div class="diff-row diff-headrow" role="row"><span role="columnheader">Setting</span><span role="columnheader">${esc(a)}</span><span role="columnheader">${esc(b)}</span></div>
        ${d.rows.map(r => `<div class="diff-row ${r.status}" role="row">
          <span role="cell" class="diff-key">${esc(r.setting)}<small>${label[r.status]}</small></span>
          <span role="cell" class="diff-a">${r.a == null ? '—' : esc(r.a)}</span>
          <span role="cell" class="diff-b">${r.b == null ? '—' : esc(r.b)}</span></div>`).join('')}
      </div>` : '<p class="pf-ok">Every setting is the same.</p>'}`;
  }

  /* ================================================================
   * 7. Confirm Print gate + queue
   * ================================================================ */

  let confirmFile = null;
  async function openConfirm(filename, fromEl, preloaded) {
    if (!demoOn) { toast('No printer connected — turn on demo data to print on a simulated printer', 'warn'); return; }
    confirmFile = filename;
    const dialog = $('confirm-dialog');
    $('confirm-sub').textContent = `${filename} on ${printerName(currentPrinter || (live.fleet[0] || {}).id)}`;
    $('confirm-body').innerHTML = '<p class="log-empty">Checking the file and the printer…</p>';
    openDialog(dialog, fromEl);
    const gate = preloaded || await getJSON(api(`/api/print/confirm?file=${enc(filename)}`));
    renderGate(gate);
  }

  function renderGate(gate) {
    const go = $('confirm-go');
    const panel = qs('#confirm-dialog .dialog-panel');
    if (gate.error) { $('confirm-body').innerHTML = `<p class="log-empty">${esc(gate.error)}</p>`; go.disabled = true; return; }
    const tint = { blocked: '#ff3b30', confirm: '#ffcc00', clear: '#34c759' }[gate.verdict];
    panel.style.setProperty('--glass-tint', tint);
    const banner = { blocked: 'This print can\'t start', confirm: 'Read these before starting', clear: 'Everything checks out' }[gate.verdict];
    go.disabled = gate.verdict === 'blocked';
    go.textContent = gate.verdict === 'confirm' ? 'I\'ve read these — start print' : 'Start print';
    $('confirm-health').innerHTML = `<span class="gm-num">${gate.health.score}</span><span class="gm-lbl">health</span>`;
    $('confirm-health').style.setProperty('--gm', { good: 'var(--ok)', fair: 'var(--warn)', poor: 'var(--bad)' }[gate.health.band]);
    const fil = gate.filament.map(f => `
      <div class="gate-fil ${f.status}">
        <span class="gf-th">${esc(f.toolhead)}</span>
        <span class="chip" style="background:${esc(f.expected_hex || '#ccc')}" title="File expects"></span>
        <span class="arrow" aria-hidden="true">→</span>
        <span class="chip" style="background:${esc(f.loaded_hex || 'transparent')}" title="Loaded"></span>
        <span class="gf-text">${esc(f.loaded_name || 'nothing loaded')} ${f.expected_material ? `· ${esc(f.expected_material)}` : ''}</span>
        <span class="gf-status">${{ match: 'Match', close: 'Close', mismatch: 'Wrong colour', not_loaded: 'Not loaded', missing_toolhead: 'No such toolhead', no_colour_in_file: 'No colour in file' }[f.status] || esc(f.status)}</span>
      </div>`).join('');
    $('confirm-body').innerHTML = `
      <div class="gate-banner ${gate.verdict}">${banner}</div>
      ${gate.blocking.length ? `<ul class="pf-list">${gate.blocking.map(b => `<li class="pf-error">${esc(b)}</li>`).join('')}</ul>` : ''}
      ${gate.warnings.length ? `<ul class="pf-list">${gate.warnings.map(w => `<li class="pf-warning">${esc(w)}</li>`).join('')}</ul>` : ''}
      ${gate.info.length ? `<ul class="pf-list">${gate.info.map(w => `<li class="pf-info">${esc(w)}</li>`).join('')}</ul>` : ''}
      <div class="gate-grid divider-row cols-4">
        <div><span class="stat-key">Time</span><b>${fmtHours(gate.estimated_hours)}</b></div>
        <div><span class="stat-key">Filament</span><b>${gate.filament_grams.toFixed(1)} g</b></div>
        <div><span class="stat-key">Cost</span><b>${money(gate.cost.total_cost)}</b></div>
        <div><span class="stat-key">Pre-flight</span><b>${{ clear: 'Clear', check: 'Warnings', blocked: 'Blocked' }[gate.preflight.verdict]}</b></div>
      </div>
      <h3 class="fd-h">Filament — as the printer reports it loaded</h3>
      ${fil || '<p class="log-empty">The file doesn\'t say which toolheads it uses.</p>'}
      ${gate.spools ? `<h3 class="fd-h">Spool weight</h3>${gate.spools.map(s => `<p class="gate-spool ${s.status}">${esc(s.toolhead)}: ${s.status === 'no_spool' ? 'no matching spool in your inventory' : `${esc(s.spool)} — ${s.grams_remaining} g now, about ${s.grams_after} g after this print`}</p>`).join('')}` : ''}`;
  }

  function initConfirm() {
    $('confirm-cancel').addEventListener('click', () => closeDialog($('confirm-dialog')));
    $('confirm-go').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const name = confirmFile;
      const r = await runCommand(btn, '/api/printer/control/start', { filename: name, confirmed: true }, {
        sending: 'Starting…', done: `Started ${name}`, failed: 'Start refused',
        expect: s => s.state === 'printing' && s.current_file === name,
      });
      if (r.ok) { closeDialog($('confirm-dialog')); showTab('overview'); loadQueue(); }
      else if (r.result.body.gate) renderGate(r.result.body.gate);        // things changed: show why
    });
  }

  async function loadQueue() {
    const host = $('queue-host');
    if (!host) return;
    const q = await getJSON(api('/api/queue')).catch(() => null);
    if (isModuleDisabled(q)) { host.innerHTML = moduleDisabledEmpty('Print queue'); return; }
    if (!q || !hasData(q)) { host.innerHTML = demoNeeded('the print queue'); return; }
    const waiting = q.items.filter(i => i.status === 'queued' || i.status === 'held');
    $('qa-next').hidden = !waiting.length;
    host.innerHTML = `
      <label class="switch queue-auto" for="queue-auto">
        <span class="switch-label">Start the next file when a print finishes</span>
        <input type="checkbox" id="queue-auto" ${q.auto_advance ? 'checked' : ''}>
        <span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>
      </label>
      ${q.items.length ? `<ol class="queue-list">${q.items.map((i, n) => `
        <li class="queue-item ${i.status}">
          <div class="qi-main"><span class="qi-name">${esc(i.filename)}</span>
            <span class="pill qi-status">${{ queued: 'Waiting', held: 'Held', started: 'Printing', done: 'Done' }[i.status]}</span></div>
          ${i.note ? `<div class="qi-note">${esc(i.note)}</div>` : ''}
          ${i.status === 'queued' || i.status === 'held' ? `<div class="qi-tools">
            <button class="btn small" data-q="up" data-id="${i.id}" type="button" ${n === 0 ? 'disabled' : ''} aria-label="Move ${esc(i.filename)} up">↑</button>
            <button class="btn small" data-q="down" data-id="${i.id}" type="button" aria-label="Move ${esc(i.filename)} down">↓</button>
            <button class="btn small" data-q="remove" data-id="${i.id}" type="button">Remove</button></div>` : ''}
        </li>`).join('')}</ol>` : '<p class="log-empty">Nothing queued. Open a G-code file and choose "Add to queue".</p>'}
      <div class="fd-actions">
        <button class="btn primary" id="queue-start" type="button" ${waiting.length ? '' : 'disabled'}>Start next</button>
        <button class="btn" id="queue-clear" type="button">Clear finished</button>
      </div>`;
    $('queue-auto').addEventListener('change', async (e) => {
      const r = await postJSON(api('/api/queue/auto'), { enabled: e.target.checked });
      toast(r.ok ? (e.target.checked ? 'The queue will start the next file after each print (after its check)' : 'The queue will wait for you') : `Couldn't change it: ${r.body.error}`, r.ok ? 'ok' : 'bad');
      loadQueue();
    });
    qsa('[data-q]', host).forEach(b => b.addEventListener('click', async () => {
      const path = b.dataset.q === 'remove' ? '/api/queue/remove' : '/api/queue/move';
      await postJSON(api(path), { id: b.dataset.id, direction: b.dataset.q });
      loadQueue();
    }));
    $('queue-start').addEventListener('click', (e) => startNext(e.currentTarget));
    $('queue-clear').addEventListener('click', async () => { await postJSON(api('/api/queue/clear-done'), {}); loadQueue(); });
  }

  async function startNext(button) {
    const r = await runCommand(button, '/api/queue/start-next', {}, { sending: 'Checking…', done: 'Queue checked', failed: 'Queue failed' });
    if (r.ok) {
      const body = r.result.body;
      if (body.held && body.gate && body.gate.verdict === 'confirm') openConfirm(body.held.filename, button, body.gate);
      else if (body.held) toast(`Held ${body.held.filename}: ${body.held.note}`, 'warn', 8000);
    }
    loadQueue();
  }

  /* ================================================================
   * 8. automations
   * ================================================================ */

  const TRIGGERS = {
    temperature: 'A temperature crosses a line',
    state: 'A print starts, pauses, finishes…',
    filament_mismatch: 'The loaded filament doesn\'t match the file',
    maintenance_overdue: 'Maintenance becomes overdue',
  };
  const ACTIONS = { notify: 'Send a notification', light: 'Set the light colour (WLED)', home_assistant: 'Set a Home Assistant sensor', pause: 'Pause the print' };
  const PRESETS = [
    { label: 'Pause if the nozzle passes 260°C', rule: { trigger: { type: 'temperature', sensor: 'active_nozzle', op: 'above', value: 260 }, action: { type: 'pause' } } },
    { label: 'Tell me when a print finishes', rule: { trigger: { type: 'state', event: 'finished' }, action: { type: 'notify', message: 'Print finished', priority: 'normal' } } },
    { label: 'Amber light when paused', rule: { trigger: { type: 'state', event: 'paused' }, action: { type: 'light', color: '#ffaa00' } } },
    { label: 'Alert on wrong filament', rule: { trigger: { type: 'filament_mismatch' }, action: { type: 'notify', message: 'Wrong filament loaded', priority: 'high' } } },
  ];

  function ruleForm() {
    const form = $('rule-form');
    const printers = live.fleet.length ? live.fleet : [];
    form.innerHTML = `
      <div class="rf-presets" role="group" aria-label="Start from an example">${PRESETS.map((p, i) => `<button class="chip-btn" type="button" data-preset="${i}">${esc(p.label)}</button>`).join('')}</div>
      <fieldset class="rf-step"><legend>When</legend>
        <label class="sr-only" for="rf-trigger">Trigger</label>
        <select id="rf-trigger">${Object.entries(TRIGGERS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
        <div class="rf-params" id="rf-tparams"></div>
      </fieldset>
      <fieldset class="rf-step"><legend>Only if</legend>
        <label class="sr-only" for="rf-condition">Condition</label>
        <select id="rf-condition"><option value="always">Any time</option><option value="while_printing">The printer is printing</option><option value="outside_quiet_hours">It's outside quiet hours</option></select>
      </fieldset>
      <fieldset class="rf-step"><legend>Then</legend>
        <label class="sr-only" for="rf-action">Action</label>
        <select id="rf-action">${Object.entries(ACTIONS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
        <div class="rf-params" id="rf-aparams"></div>
      </fieldset>
      <fieldset class="rf-step"><legend>On</legend>
        <label class="sr-only" for="rf-printer">Printer</label>
        <select id="rf-printer"><option value="any">Any printer</option>${printers.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
        <label class="rf-inline" for="rf-cooldown">at most once every <input type="number" id="rf-cooldown" value="60" min="0" max="86400" style="width:80px"> seconds</label>
      </fieldset>
      <label class="sr-only" for="rf-name">Rule name (optional)</label>
      <input type="text" id="rf-name" placeholder="Name (optional)" maxlength="80">
      <p class="log-empty" id="rf-demo-note"></p>
      <button class="btn primary block" type="submit" id="rf-save">Save rule</button>`;
    const tparams = () => {
      const t = $('rf-trigger').value, host = $('rf-tparams');
      host.innerHTML = t === 'temperature' ? `
          <select id="rf-sensor" aria-label="Which temperature"><option value="active_nozzle">Active nozzle</option><option>T0</option><option>T1</option><option>T2</option><option>T3</option><option value="bed">Bed</option><option value="chamber">Chamber</option></select>
          <select id="rf-op" aria-label="Above or below"><option value="above">goes above</option><option value="below">drops below</option></select>
          <input type="number" id="rf-value" value="240" aria-label="Temperature in °C" style="width:90px"> °C`
        : t === 'state' ? `<select id="rf-event" aria-label="Print event">${['started', 'paused', 'resumed', 'finished', 'failed', 'cancelled'].map(e => `<option>${e}</option>`).join('')}</select>`
          : t === 'maintenance_overdue' ? `<select id="rf-task" aria-label="Maintenance task"><option value="any">Any task</option><option value="nozzle_check">Nozzle check</option><option value="bed_level">Bed levelling</option><option value="belt_tension">Belt tension</option><option value="lubrication">Lubrication</option><option value="dock_alignment">Dock alignment</option><option value="fan_clean">Fan cleaning</option><option value="calibration">Recalibration</option></select>` : '';
    };
    const aparams = () => {
      const a = $('rf-action').value, host = $('rf-aparams');
      host.innerHTML = a === 'notify' ? `<input type="text" id="rf-message" placeholder="Message" value="Check the printer" aria-label="Notification message"><select id="rf-priority" aria-label="Priority"><option value="normal">Normal (respects quiet hours)</option><option value="high">Urgent (always sends)</option></select>`
        : a === 'light' ? `<input type="color" id="rf-color" value="#ffaa00" aria-label="Light colour"> <span class="log-empty">Sent to the WLED strip in Modules &amp; devices</span>`
          : a === 'home_assistant' ? `<input type="text" id="rf-entity" value="sensor.dejavu1_alert" aria-label="Entity"> <input type="text" id="rf-state" value="on" aria-label="State" style="width:90px">`
            : '<span class="log-empty">Pauses the print on the printer that triggered the rule.</span>';
    };
    $('rf-trigger').addEventListener('change', tparams);
    $('rf-action').addEventListener('change', aparams);
    tparams(); aparams();
    $('rf-demo-note').textContent = demoOn ? 'Demo data is on, so this rule will only watch the simulated printers, and anything it sends is marked "[Demo data]".' : 'This rule will watch real, connected printers.';
    qsa('[data-preset]', form).forEach(b => b.addEventListener('click', () => {
      const p = PRESETS[+b.dataset.preset].rule;
      $('rf-trigger').value = p.trigger.type; tparams();
      if (p.trigger.sensor) { $('rf-sensor').value = p.trigger.sensor; $('rf-op').value = p.trigger.op; $('rf-value').value = p.trigger.value; }
      if (p.trigger.event) $('rf-event').value = p.trigger.event;
      $('rf-action').value = p.action.type; aparams();
      if (p.action.message) { $('rf-message').value = p.action.message; $('rf-priority').value = p.action.priority; }
      if (p.action.color) $('rf-color').value = p.action.color;
      $('rf-name').value = PRESETS[+b.dataset.preset].label;
    }));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const t = $('rf-trigger').value, a = $('rf-action').value;
      const trigger = { type: t };
      if (t === 'temperature') Object.assign(trigger, { sensor: $('rf-sensor').value, op: $('rf-op').value, value: +$('rf-value').value });
      if (t === 'state') trigger.event = $('rf-event').value;
      if (t === 'maintenance_overdue') trigger.task = $('rf-task').value;
      const action = { type: a };
      if (a === 'notify') Object.assign(action, { message: $('rf-message').value, priority: $('rf-priority').value });
      if (a === 'light') action.color = $('rf-color').value;
      if (a === 'home_assistant') Object.assign(action, { entity_id: $('rf-entity').value, state: $('rf-state').value });
      const rule = { name: $('rf-name').value, trigger, action, condition: $('rf-condition').value, printer: $('rf-printer').value, cooldown_s: +$('rf-cooldown').value };
      const r = await runCommand($('rf-save'), demoOn ? '/api/automations?demo=1' : '/api/automations', { rule },
        { sending: 'Saving…', done: 'Rule saved', failed: 'Rule not saved' });
      if (r.ok) { $('rf-name').value = ''; loadRules(); }
    };
  }

  function sentence(rule) {
    const t = rule.trigger, a = rule.action;
    const when = t.type === 'temperature' ? `${t.sensor.replace('_', ' ')} ${t.op === 'above' ? 'goes above' : 'drops below'} ${formatTemp(t.value)}`
      : t.type === 'state' ? `a print ${t.event}` : t.type === 'filament_mismatch' ? 'the loaded filament doesn\'t match' : `maintenance${t.task && t.task !== 'any' ? ` (${t.task.replace('_', ' ')})` : ''} is overdue`;
    const then = a.type === 'notify' ? `send "${a.message}"` : a.type === 'light' ? `set the light to <span class="chip" style="background:${esc(a.color)}"></span>` : a.type === 'home_assistant' ? `set ${esc(a.entity_id)} to "${esc(a.state)}"` : 'pause the print';
    const cond = { always: '', while_printing: ' while printing', outside_quiet_hours: ' outside quiet hours' }[rule.condition];
    return `When ${esc(when)}${cond}, ${a.type === 'light' ? then : esc(then)}${rule.printer !== 'any' ? ` on ${esc(printerName(rule.printer))}` : ''}.`;
  }

  async function loadRules() {
    const host = $('rule-list');
    if (!host) return;
    const data = await getJSON('/api/automations').catch(() => null);
    if (isModuleDisabled(data)) { host.innerHTML = moduleDisabledEmpty('Automations'); return; }
    const rules = (data && data.rules) || [];
    host.innerHTML = rules.length ? rules.map(r => `
      <div class="rule-row ${r.enabled ? '' : 'is-off'}">
        <div class="rr-main">
          <div class="rr-name">${esc(r.name)} ${r.demo ? '<span class="badge badge-sim">Demo</span>' : ''}</div>
          <div class="rr-text">${sentence(r)}</div>
          <div class="rr-meta">${r.fire_count ? `Fired ${r.fire_count} time${r.fire_count > 1 ? 's' : ''}, last ${since(r.last_fired_at)}` : 'Hasn\'t fired yet'}</div>
        </div>
        <div class="rr-tools">
          <label class="switch" title="${r.enabled ? 'On' : 'Off'}"><span class="sr-only">Rule on</span>
            <input type="checkbox" data-rule-toggle="${esc(r.id)}" ${r.enabled ? 'checked' : ''}>
            <span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span></label>
          <button class="btn small" data-rule-test="${esc(r.id)}" type="button">Test</button>
          <button class="btn small danger" data-rule-delete="${esc(r.id)}" type="button">Delete</button>
        </div>
      </div>`).join('') : '<p class="log-empty">No rules yet. Pick an example above to start.</p>';
    qsa('[data-rule-toggle]', host).forEach(c => c.addEventListener('change', async () => {
      const r = await postJSON(`/api/automations/${enc(c.dataset.ruleToggle)}/update`, { changes: { enabled: c.checked } });
      if (!r.ok) toast(`Couldn't change it: ${r.body.error}`, 'bad');
      loadRules();
    }));
    qsa('[data-rule-test]', host).forEach(b => b.addEventListener('click', async () => {
      const original = b.textContent;
      b.disabled = true; b.textContent = 'Running…';
      const r = await postJSON(api(`/api/automations/${enc(b.dataset.ruleTest)}/test`), {});
      b.disabled = false; b.textContent = original;
      if (!r.ok) toast(`Test not run: ${r.body.error}`, 'bad');
      else toast(r.body.ok ? `Test: ${r.body.detail}` : `Test ran, action failed: ${r.body.error}`, r.body.ok ? 'ok' : 'warn', 7000);
      loadRuleLog();
      if (window.Workshop) refreshPrinter();
    }));
    qsa('[data-rule-delete]', host).forEach(b => b.addEventListener('click', async () => {
      const r = await postJSON(`/api/automations/${enc(b.dataset.ruleDelete)}/delete`, {});
      toast(r.ok ? 'Rule deleted' : `Couldn't delete: ${r.body.error}`, r.ok ? 'ok' : 'bad');
      loadRules();
    }));
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
      if (!demoOn) { toast('No printer connected — turn on demo data to try this on a simulated printer', 'warn'); return; }
      const r = await runCommand(e.submitter || null, '/api/maintenance/swap', { kind: $('swap-kind').value, toolhead: $('swap-toolhead').value },
        { sending: 'Recording…', done: 'Swap recorded — recalibration is now due', failed: 'Not recorded' });
      if (r.ok) { loadMaintenance(); loadHealth(); }
    });
  }

  async function loadForecast() {
    const host = $('forecast-body');
    if (!host) return;
    const data = await getJSON(api('/api/filament/forecast')).catch(() => null);
    if (isModuleDisabled(data)) { host.innerHTML = '<p class="log-empty">Turn on Filament inventory to see this.</p>'; return; }
    if (!data || !hasData(data)) { host.innerHTML = '<p class="log-empty">Needs print history — turn on demo data to preview.</p>'; return; }
    host.innerHTML = data.spools.map(s => `
      <div class="spool-row">
        <span class="spool-swatch" style="background:${esc(s.color_hex)}"></span>
        <span class="spool-name">${esc(s.color_name)} ${esc(s.material)}</span>
        <span class="spool-grams">${s.grams_remaining.toFixed(0)} g</span>
        <span class="spool-grams">${s.prints_left != null ? `≈ ${s.prints_left} prints` : 'no history yet'}</span>
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
  const cam = { built: false, mjpeg: '', webrtc: false, pc: null, run: 0 };
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
      host.innerHTML = empty('No camera set up', 'Add the printer camera\'s MJPEG address above. Nothing is simulated here — the demo has no camera.');
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
        <span class="log-empty">Over Wi-Fi, MJPEG delay can slowly build up — Reconnect resets it.</span></div>`;
      $('camera-reload').addEventListener('click', () => { stopCamera(); startCamera(); });
      cam.built = true;
    }
    if (document.querySelector('#tab-modules:not([hidden])')) { stopCamera(); startCamera(); }
  }

  function setCamMode(mode, why) {
    const pill = $('cam-mode'), note = $('cam-why');
    if (!pill) return;
    pill.dataset.mode = mode;
    pill.textContent = { webrtc: 'Low latency · WebRTC', mjpeg: 'MJPEG', connecting: 'Connecting…', none: 'No camera' }[mode];
    note.hidden = !why;
    note.textContent = why || '';
  }

  function showMjpeg(why) {
    const img = $('camera-img'), video = $('camera-video');
    if (!img) return;
    video.hidden = true;
    if (!cam.mjpeg) { img.hidden = true; setCamMode('none', `${why} There's no MJPEG address to fall back to — add one above.`); return; }
    img.hidden = false;
    img.src = `/api/camera/stream?t=${Date.now()}`;
    setCamMode('mjpeg', why ? `Using the normal camera feed: ${why}` : '');
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
    closePeer();
    const img = $('camera-img');
    if (img) img.removeAttribute('src');
  }

  async function loadTimelapse() {
    const host = $('timelapse-host');
    if (!host) return;
    const data = await getJSON(api('/api/timelapse')).catch(() => null);
    if (isModuleDisabled(data)) { host.innerHTML = moduleDisabledEmpty('Time-lapse flipbook'); return; }
    if (!data || !hasData(data)) { host.innerHTML = demoNeeded('time-lapses'); return; }
    host.innerHTML = data.sessions.length ? data.sessions.map(s => `
      <div class="reg-row">
        <span class="reg-name">${esc(s.filename || 'print')}</span>
        <span class="log-empty">${s.frames} frames · ${since(s.started_at)}${s.finished ? '' : ' · recording'}${s.source === 'simulated' ? ' · simulated' : ''}</span>
        <button class="btn small" data-flip="${esc(s.session)}" type="button" ${s.frames ? '' : 'disabled'}>Play</button>
      </div>`).join('') : '<p class="log-empty">No time-lapses yet — one is recorded during every print.</p>';
    qsa('[data-flip]', host).forEach(b => b.addEventListener('click', () => playFlipbook(b.dataset.flip)));
  }

  const flip = { frames: [], i: 0, timer: null };
  async function playFlipbook(session) {
    const dialog = $('flip-dialog');
    const data = await getJSON(api(`/api/timelapse/frames?session=${enc(session)}`));
    if (!data.frames || !data.frames.length) { toast('No frames in that time-lapse yet', 'warn'); return; }
    flip.frames = data.frames.map(n => {
      const img = new Image();
      img.src = api(`/api/timelapse/frame?session=${enc(session)}&name=${enc(n)}`);
      return img;
    });
    flip.i = 0;
    $('flip-sub').textContent = `${session} · ${flip.frames.length} frames, played at 12 per second in your browser`;
    const scrub = $('flip-scrub');
    scrub.max = flip.frames.length - 1;
    const show = () => { $('flip-img').src = flip.frames[flip.i].src; scrub.value = flip.i; $('flip-count').textContent = `${flip.i + 1} / ${flip.frames.length}`; };
    const play = () => { clearInterval(flip.timer); flip.timer = setInterval(() => { flip.i = (flip.i + 1) % flip.frames.length; show(); }, 1000 / 12); $('flip-play').textContent = 'Pause'; };
    const stop = () => { clearInterval(flip.timer); flip.timer = null; $('flip-play').textContent = 'Play'; };
    $('flip-play').onclick = () => (flip.timer ? stop() : play());
    scrub.oninput = () => { stop(); flip.i = +scrub.value; show(); };
    dialog.addEventListener('close', stop, { once: true });
    show();
    openDialog(dialog);
    if (!REDUCED.matches) play(); else stop();
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
      toast(r.ok ? `The next "${action}" on ${printerName(currentPrinter)} will fail — watch how it's reported` : `Couldn't arm it: ${r.body.error}`, r.ok ? 'warn' : 'bad', 6000);
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
    $('webrtc-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await postJSON('/api/camera/webrtc/settings', { go2rtc_url: $('webrtc-url').value.trim(), stream: $('webrtc-stream').value.trim() });
      toast(r.ok ? (r.body.go2rtc_url ? 'go2rtc address saved — trying the low-latency camera' : 'Low-latency camera cleared') : `Not saved: ${r.body.error}`, r.ok ? 'ok' : 'bad', 5000);
      if (r.ok) loadCamera();
    });
  }

  /* Continue on another device: every open dashboard says what it's
   * looking at; another device can pick up exactly there. */
  const DEVICE_KEY = 'dejavu1.device';
  const deviceId = localStorage.getItem(DEVICE_KEY) || (() => {
    const id = `dev-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  })();
  const deviceName = (() => {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows PC';
    return 'Computer';
  })();
  let dismissedOffer = 0;

  function currentTab() { return localStorage.getItem('dejavu1.tab') || 'overview'; }

  function reportView() {
    postJSON('/api/handoff', { device_id: deviceId, device_name: deviceName,
      view: { printer: currentPrinter, tab: currentTab(), file: files.open ? files.open.name : null } }).catch(() => {});
  }

  async function checkHandoff() {
    const el = $('handoff');
    const data = await getJSON(`/api/handoff?device=${enc(deviceId)}`).catch(() => null);
    const offer = data && data.offer;
    const same = offer && offer.tab === currentTab() && (offer.printer || '') === currentPrinter && !offer.file;
    if (!offer || same || offer.at <= dismissedOffer || offer.seconds_ago > 600) { el.hidden = true; return; }
    const where = [offer.printer ? printerName(offer.printer) : null, offer.tab, offer.file].filter(Boolean).join(' · ');
    $('handoff-text').textContent = `Continue from your ${offer.device_name}: ${where}`;
    el.hidden = false;
    $('handoff-go').onclick = async () => {
      el.hidden = true;
      dismissedOffer = offer.at;
      if (offer.printer && offer.printer !== currentPrinter) selectPrinter(offer.printer);
      if (offer.tab) showTab(offer.tab);
      if (offer.file) { await loadFiles(); openFile(offer.file); }
    };
    $('handoff-dismiss').onclick = () => { el.hidden = true; dismissedOffer = offer.at; };
  }

  /* ================================================================
   * 10. phone layout
   * ================================================================ */

  function renderQuickActions(state) {
    const bar = $('quick-actions');
    const running = state.state === 'printing' || state.state === 'paused';
    bar.hidden = !running;
    const pause = $('qa-pause');
    if (pause.dataset.phase !== 'sending') {
      pause.textContent = state.state === 'paused' ? 'Resume' : 'Pause';
      pause.disabled = !running;
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

  function initPhone() {
    const nav = qs('.bottom-nav');
    const sheet = $('more-sheet');
    const more = $('bn-more');
    const setSheet = (open) => { sheet.hidden = !open; more.setAttribute('aria-expanded', String(open)); };
    qsa('[data-tab]', $('thumb-dock')).forEach(b => b.addEventListener('click', () => { showTab(b.dataset.tab); setSheet(false); }));
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', () => setSheet(sheet.hidden));
    // The sheet closes the way a popover should: tap anywhere else, or Escape.
    document.addEventListener('pointerdown', (e) => {
      if (!sheet.hidden && !sheet.contains(e.target) && !more.contains(e.target)) setSheet(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !sheet.hidden) { setSheet(false); more.focus(); }
    });
    $('qa-next').addEventListener('click', (e) => startNext(e.currentTarget));
    $('live-pill').addEventListener('click', () => showTab('control'));
    initHoldToCancel();
    syncNav(currentTab());
    nav.dataset.ready = '1';
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
    const base = maps.map(m => +m.getAttribute('scale'));
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
    blob.getAnimations().forEach(a => a.cancel());
    if (instant || REDUCED.matches || (from.x === to.x && from.w === to.w)) { blob.style.transform = `translateX(${to.x}px)`; return; }
    blob.style.transform = `translateX(${to.x}px)`;
    blob.animate(SPRING.map(t => ({ transform: `translateX(${lerp(from.x, to.x, t)}px) scaleX(${lerp(from.w, to.w, t) / to.w})` })),
                 { duration: 560, easing: 'linear' });
  }
  function moveTabBlob(name, instant) {
    const bar = $('tabbar');
    const btn = bar && qs(`.navtab[data-tab="${name}"]`, bar);
    placeBlob(bar, btn, instant);
    // Nine tabs scroll sideways; bring the active one into view without
    // moving the page itself.
    if (btn && (btn.offsetLeft < bar.scrollLeft || btn.offsetLeft + btn.offsetWidth > bar.scrollLeft + bar.clientWidth)) {
      bar.scrollTo({ left: btn.offsetLeft - 24, behavior: instant || REDUCED.matches ? 'auto' : 'smooth' });
    }
    placeBlob(qs('.bottom-nav'), qs('.bottom-nav button.active'), instant);
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

  /* Scroll edge: the top bar frosts harder once content is under it. The two
   * thresholds stop it flickering when the page rests right at the edge. */
  function initScrollEdge() {
    let on = false, queued = false;
    const check = () => {
      queued = false;
      const y = window.scrollY;
      if (!on && y > 12) { on = true; document.body.classList.add('is-scrolled'); }
      else if (on && y < 4) { on = false; document.body.classList.remove('is-scrolled'); }
    };
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

  /* Dialogs are glass laid over glass: they get the "deep" filter, and the
   * page behind them is marked so the layer underneath refracts more. */
  function openDialog(dialog, fromEl) {
    if (dialog.open) return;
    document.body.classList.add('has-glass-dialog');
    dialog.showModal();
    const panel = qs('.dialog-panel', dialog);
    if (fromEl && !REDUCED.matches) {
      const a = fromEl.getBoundingClientRect(), b = panel.getBoundingClientRect();
      const sx = a.width / b.width, sy = a.height / b.height;
      const dx = a.left + a.width / 2 - (b.left + b.width / 2), dy = a.top + a.height / 2 - (b.top + b.height / 2);
      pulseRefraction();
      panel.animate(SPRING.map(t => ({
        transform: `translate(${lerp(dx, 0, t)}px, ${lerp(dy, 0, t)}px) scale(${lerp(sx, 1, t)}, ${lerp(sy, 1, t)})`,
        borderRadius: `${lerp(14, 26, t)}px`, opacity: Math.min(1, t * 2.2),
      })), { duration: 620, easing: 'linear' });
    }
  }
  function closeDialog(dialog) { dialog.close(); }
  function initDialogs() {
    qsa('dialog.glass-dialog').forEach(d => {
      qsa('[data-close]', d).forEach(b => b.addEventListener('click', () => d.close()));
      d.addEventListener('close', () => { if (!qs('dialog[open]')) document.body.classList.remove('has-glass-dialog'); });
      d.addEventListener('click', (e) => { if (e.target === d) d.close(); });      // tap outside the panel
    });
  }

  /* The celebration: the live pill's glass grows into the summary card. */
  let lastCelebrated = null;
  function celebrate(event) {
    if (lastCelebrated === event.id) return;
    lastCelebrated = event.id;
    const s = event.summary;
    $('celebrate-title').textContent = `${event.printer_name}: print finished`;
    $('celebrate-sub').textContent = s.file;
    $('celebrate-stats').innerHTML = `
      <div><span class="stat-key">Time</span><b>${fmtHours(s.hours)}</b></div>
      <div><span class="stat-key">Filament</span><b>${Number(s.grams).toFixed(1)} g ${esc(s.material)}</b></div>
      <div><span class="stat-key">Cost</span><b>${money(s.cost.total_cost)}</b></div>`;
    const dialog = $('celebrate-dialog');
    qs('.dialog-panel', dialog).style.setProperty('--glass-tint', s.color || '#ff7a2f');
    qs('.dialog-panel', dialog).style.setProperty('--cel', s.color || '#ff7a2f');
    $('celebrate-timelapse').onclick = async () => {
      dialog.close();
      const data = await getJSON(api(`/api/timelapse?printer=${enc(event.printer)}`));
      const session = data.sessions && data.sessions[0];
      if (session) playFlipbook(session.session); else toast('No time-lapse was recorded for this print', 'warn');
    };
    const pill = $('live-pill');
    openDialog(dialog, pill && !pill.hidden ? pill : null);
  }

  /* Ambient motion is CSS (workshop.css). SVG's own <animate> isn't covered
   * by the CSS reduced-motion rule, so pause it here when asked. */
  function honourReducedMotion() {
    const svg = qs('svg.lg-defs');
    const apply = () => { if (svg && svg.pauseAnimations) (REDUCED.matches ? svg.pauseAnimations() : svg.unpauseAnimations()); };
    apply();
    REDUCED.addEventListener?.('change', apply);
  }

  /* ================================================================
   * wiring
   * ================================================================ */

  function onTab(name) {
    syncNav(name);
    if (name === 'fleet') loadRegistry();
    if (name === 'files') { loadFiles(); loadQueue(); }
    if (name === 'automations') { ruleForm(); loadRules(); loadRuleLog(); }
    if (name === 'modules') { loadCamera(); loadTimelapse(); } else stopCamera();
    if (name === 'filament') { loadForecast(); loadSideBySide(); }
    reportView();
  }

  async function refresh() {
    $('demo-tools-card').hidden = !demoOn;
    if (!demoOn) {
      printerState = null;
      $('live-pill').hidden = true;
      $('quick-actions').hidden = true;
      renderTwin(null);
      renderFleet([]);
    }
    await Promise.all([loadHealth(), loadChamber(), loadFiles(), loadQueue(), loadRegistry(),
      loadRules(), loadRuleLog(), loadForecast(), loadSideBySide(), loadTimelapse()]);
    if (demoOn) refreshPrinter();
    renderChip();
  }

  function init() {
    initFleet();
    initFiles();
    initConfirm();
    initSwap();
    initDemoTools();
    initCameraForm();
    initPhone();
    initPressGlow();
    initScrollEdge();
    initBlobResize();
    initDialogs();
    honourReducedMotion();
    connect();
    refresh();
    onTab(currentTab());
    reportView();
    setInterval(reportView, 20000);
    setInterval(checkHandoff, 15000);
    setTimeout(checkHandoff, 3000);
    setInterval(() => { if (demoOn) { loadHealth(); loadChamber(); } }, 15000);
    window.addEventListener('resize', () => moveTabBlob(currentTab()));
  }

  return { init, refresh, applyState, refreshPrinter, reconnect, onTab, isLive, selectPrinter, morph };
})();

window.Workshop = Workshop;
Workshop.init();
