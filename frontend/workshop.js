/* Deja Vu1 - live connection, fleet, files, automations and Liquid Glass 2.0.
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
  // A ready printer is "on and waiting", drawn in the page's own ink, never a dim grey.
  const STATE_COLOR = { printing: 'var(--ok)', paused: 'var(--warn)', error: 'var(--bad)', complete: 'var(--accent)', ready: 'var(--ink-ready)' };
  const STATE_HEX = { printing: '#34c759', paused: '#ffcc00', error: '#ff3b30', complete: '#4a8df8', ready: '#1d1d1f' };
  const STATE_WORD = { printing: 'Printing', paused: 'Paused', error: 'Error', complete: 'Finished', ready: 'Ready' };

  /* Continuous visuals ease toward each new reading instead of jumping.
   * This is the easing Block World already uses for movement (initBeacon
   * in app.js: each frame, velocity closes a fixed fraction - ACCEL = 0.18
   * - of the gap to its target), made frame-rate independent so a 120 Hz
   * screen and a 60 Hz one move at the same speed. */
  const EASE_RATE = 0.18;
  function ease(current, target, dt) {
    if (REDUCED.matches) return target;
    const k = 1 - Math.pow(1 - EASE_RATE, dt * 60);
    return current + (target - current) * k;
  }
  /* The twin's nozzle gets a critically damped spring instead: readings
   * come four times a second (Klipper's 250 ms status timer), and plain
   * easing reaches each one in about 80 ms and waits, so a moving head
   * stepped. The spring keeps position and speed continuous, trails the
   * printer by about 2/SPRING_W seconds at a steady speed, and never runs
   * past the reading (a critically damped follower doesn't overshoot when
   * the head stops). Solved exactly per frame, so a long frame can't make it
   * unstable. */
  const SPRING_W = 7;
  function springStep(e, dt) {
    if (REDUCED.matches) { e.value = e.target.slice(); e.vel = e.target.map(() => 0); return false; }
    const w = SPRING_W, decay = Math.exp(-w * dt);
    let moving = false;
    e.vel = e.vel || e.value.map(() => 0);
    e.value = e.value.map((x, i) => {
      const err = x - e.target[i], v = e.vel[i], c = v + w * err;
      const nerr = (err + c * dt) * decay;
      e.vel[i] = (v - w * c * dt) * decay;
      if (Math.abs(nerr) > 0.02 || Math.abs(e.vel[i]) > 0.05) moving = true;
      return e.target[i] + nerr;
    });
    if (!moving) { e.value = e.target.slice(); e.vel = e.target.map(() => 0); }
    return moving;
  }
  const smooth = new Map();          // key -> {value, target, apply, spring, vel}
  let animating = false, lastFrame = 0;
  function tween(key, target, apply, spring) {
    const entry = smooth.get(key);
    if (entry) { entry.target = target; entry.apply = apply; }
    else smooth.set(key, { value: target, target, apply, spring: !!spring });
    if (!entry) apply(target);
    if (!animating) { animating = true; lastFrame = performance.now(); requestAnimationFrame(frame); }
  }
  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    let moving = false;
    for (const e of smooth.values()) {
      if (e.spring && Array.isArray(e.target)) {
        if (springStep(e, dt)) moving = true;
      } else if (Array.isArray(e.target)) {
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
  function demoNeeded(what) {
    return serverMissing() ? needsServerEmpty(what) : empty(`No printer connected`, `Connect your printer in Set up & help, or turn on demo data to explore ${what}.`);
  }

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
    if (!liveData()) { live.mode = 'off'; badge(); tintRoom({}); return; }
    // The online demo plays a recording through the same requests polling
    // makes (app.js, "the online demo"); there is no server to open a socket to.
    if (!('WebSocket' in window) || tourOn()) { startPolling(); return; }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // demo=1 only when demo data is on: a real printer's live feed must
    // never be asked for (or labelled as) simulated data.
    const params = demoOn ? ['demo=1', 'fleet=1'] : ['fleet=1'];
    if (currentPrinter) params.push(`printer=${enc(currentPrinter)}`);
    let ws;
    try { ws = new WebSocket(`${proto}://${location.host}/api/live?${params.join('&')}`); }
    catch (e) { startPolling(); return; }
    live.ws = ws;
    ws.onopen = () => { clearInterval(live.poll); live.poll = null; live.mode = 'ws'; live.retries = 0; badge(); };
    ws.onmessage = (e) => {
      if (live.ws !== ws) return;
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (!msg.type) { live.mode = 'off'; badge(); return; }          // {"connected":false,"demo":false}
      if (msg.type === 'state' && msg.printer === (currentPrinter || msg.printer)) {
        live.lastAt = performance.now();
        applyState(msg.state);
      } else if (msg.type === 'fleet') {
        drawSafely('Your printers', () => renderFleet(msg.printers));
      } else if (msg.type === 'event') {
        live.lastEvent = Math.max(live.lastEvent, msg.event.id);
        onEvent(msg.event);
      }
    };
    ws.onclose = () => {
      if (live.ws !== ws || live.closing) return;
      live.ws = null;
      if (!liveData()) { live.mode = 'off'; badge(); return; }
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
      if (!liveData()) { clearInterval(live.poll); live.mode = 'off'; badge(); return; }
      const snap = await getJSON(api('/api/live/snapshot')).catch(() => null);
      if (snap && snap.state) { live.lastAt = performance.now(); applyState(snap.state); }
      const ev = await getJSON(api(`/api/live/events?since=${live.lastEvent}`)).catch(() => null);
      (ev && ev.events || []).forEach(e => { live.lastEvent = Math.max(live.lastEvent, e.id); onEvent(e); });
      if (tick++ % 2 === 0) {
        const fleet = await getJSON(api('/api/fleet')).catch(() => null);
        if (fleet && fleet.printers) drawSafely('Your printers', () => renderFleet(fleet.printers));
      }
      // Polling started because the WebSocket failed - often just a server
      // restart or a Wi-Fi blip. Try it again every 30 s; if it opens, it
      // stops this polling (ws.onopen).
      if (tick % 30 === 0 && 'WebSocket' in window && !live.ws && !tourOn()) connect();
    };
    once();
    live.poll = setInterval(once, 1000);
  }

  function badge() {
    // The fleet card's "Live" label only while a live feed is really running.
    const fleetBadge = $('fleet-live-badge');
    if (fleetBadge) fleetBadge.hidden = !isLive();
    const el = $('rb-live');
    if (!el) return;
    el.hidden = live.mode === 'off';
    el.dataset.mode = live.mode;
  }
  setInterval(() => {
    if (!isLive()) return;
    const age = (performance.now() - live.lastAt) / 1000;
    const how = live.mode === 'ws' ? 'Live' : tourOn() ? 'Recording' : 'Polling 1 s';
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
    drawSafely('The status bar', () => renderStatusRibbon(state));
    drawSafely('The live pill', () => renderPill(state));
    drawSafely('The 3D twin', () => renderTwin(state));
    drawSafely('The quick Pause and Cancel bar', () => renderQuickActions(state));
    drawSafely('The chamber reading', () => updateChamberNow(state));
    drawSafely('The printer picker', () => renderChip());
    drawSafely('The room tint', () => tintRoom(state));
    drawSafely('The live readout', () => window.dispatchEvent(new CustomEvent('dv-state', { detail: state })));
    if (fromCommand) refreshSoon();
  }

  /* The light behind the glass takes the colours of the filament loaded on
   * the printer you're looking at (theme.css, --fil-a / --fil-b): the active
   * toolhead's first, then the most colourful of the rest. Black, white and
   * greys have no colour to give, so they're skipped, and with nothing
   * colourful loaded the room keeps its default light. */
  let roomKey = null;
  function tintRoom(state) {
    const chroma = (hex) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
      if (!m) return 0;
      const v = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
      return (Math.max(...v) - Math.min(...v)) / 255;
    };
    const heads = state.toolheads || {};
    const active = state.active_toolhead && heads[state.active_toolhead];
    const ranked = Object.values(heads)
      .map(t => t.filament_color_hex)
      .filter(hex => chroma(hex) > 0.28)
      .sort((a, b) => chroma(b) - chroma(a));
    const first = active && chroma(active.filament_color_hex) > 0.28 ? active.filament_color_hex : ranked[0];
    const second = ranked.find(hex => hex !== first);
    const key = `${first || ''}|${second || ''}`;
    if (key === roomKey) return;
    roomKey = key;
    const root = document.documentElement.style;
    if (first) root.setProperty('--fil-a', first); else root.removeProperty('--fil-a');
    if (second) root.setProperty('--fil-b', second); else root.removeProperty('--fil-b');
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
    window.dispatchEvent(new CustomEvent('dv-live-event', { detail: event }));
    if (event.type === 'print_event') {
      const mine = !currentPrinter || event.printer === currentPrinter;
      const word = { started: 'started', finished: 'finished', failed: 'failed', paused: 'paused', resumed: 'resumed', cancelled: 'cancelled' }[event.event];
      if (event.event === 'finished' && event.summary) celebrate(event);
      else toast(`${event.printer_name}: print ${word}${event.file ? `: ${event.file}` : ''}`,
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
    chip.hidden = !liveData() && !registry.length;
    const id = currentPrinter || (live.fleet[0] && live.fleet[0].id);
    const row = live.fleet.find(p => p.id === id);
    const added = registry.find(p => p.id === id) || (registry.length === 1 && registry[0]);
    $('printer-chip-name').textContent = row ? row.name
      : (printerState && printerState.printer_name) || (added && added.name) || 'Printer';
    const state = row ? row.state : (printerState && printerState.state);
    chip.style.setProperty('--pc-color', STATE_HEX[state] || '#8e8e93');
  }

  /* The chip's caret promised a list, so it opens one: every printer with
   * its state, picked without leaving the tab you're on. With one printer
   * (or none) there's nothing to choose, and it opens the Fleet tab. */
  function openPrinterMenu(chip, fromKeyboard) {
    if (live.fleet.length < 2) { showTab('fleet'); return; }
    const current = currentPrinter || live.fleet[0].id;
    const items = live.fleet.map(p => ({
      value: p.id, current: p.id === current,
      html: `<span class="gm-dot" style="background:${STATE_HEX[p.state] || '#8e8e93'}" aria-hidden="true"></span>
             <span class="gm-label">${esc(p.name)}</span><span class="gm-note">${esc(STATE_WORD[p.state] || p.state || '')}${p.link_lost ? ' · no link' : ''}</span>`,
    }));
    items.push({ value: '__fleet', html: '<span class="gm-label">All printers</span><span class="gm-note">Fleet tab</span>', divider: true });
    openMenu(chip, items, (id) => {
      if (id === '__fleet') showTab('fleet');
      else if (id !== current) selectPrinter(id, null, true);
    }, 'Printers', fromKeyboard);
  }

  function selectPrinter(id, fromEl, stay) {
    currentPrinter = id;
    store.set(PRINTER_KEY, id);
    if (live.ws && live.ws.readyState === 1) live.ws.send(JSON.stringify({ type: 'subscribe', printer: id, fleet: true }));
    else reconnect();
    renderChip();
    qsa('.fleet-card').forEach(c => c.classList.toggle('is-selected', c.dataset.printer === id));
    // From the chip's menu you stay where you were; the tab reloads for the
    // printer you picked. From a fleet card you go to that printer's own page.
    if (stay) { refreshAll(); onTab(currentTab()); toast(`Now showing ${printerName(id)}`, 'info', 2200); return; }
    const go = () => { showTab('control'); refreshAll(); };
    if (fromEl) morph(fromEl, () => qs('#tab-control .pp-stage') || qs('#tab-control'), go);
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
    drawSafely('Needs you', () => renderAttention(live.fleet));
    // The remembered printer can be gone (removed, or a sandbox printer torn
    // down). Every request would then ask for an unknown printer and every
    // panel would say nothing is connected, so fall back to the default.
    if (currentPrinter && live.fleet.length && !live.fleet.some(p => p.id === currentPrinter)) {
      currentPrinter = '';
      store.set(PRINTER_KEY, '');
      reconnect();
      refreshAll();
      return;
    }
    renderChip();
    const grid = $('fleet-grid');
    if (!grid) return;
    if (!liveData()) { grid.innerHTML = demoNeeded('the fleet'); grid.dataset.ids = ''; return; }
    const ids = live.fleet.map(p => p.id).join(',');
    if (grid.dataset.ids !== ids) {
      grid.dataset.ids = ids;
      grid.innerHTML = live.fleet.map(p => `
        <article class="fleet-card liquid-glass" data-tint data-printer="${esc(p.id)}">
          <div class="fc-head">
            <label class="fc-pick" title="Select for fleet commands">
              <input type="checkbox" data-pick="${esc(p.id)}" aria-label="Select ${esc(p.name)} for fleet commands">
            </label>
            <h3 class="fc-name">${esc(p.name)}${p.sandbox ? ' <span class="fc-sim">sandbox</span>' : ''}</h3>
            <span class="fc-state" data-f="state"></span>
          </div>
          <p class="fc-kind" data-f="machine" hidden></p>
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
          <div class="fc-queue" data-f="queue"></div>
          <button class="btn block fc-open" type="button" data-open="${esc(p.id)}">Open ${esc(p.name)}</button>
          ${p.web_url && /^https?:\/\//.test(p.web_url) ? `<a class="fc-web" href="${esc(p.web_url)}" target="_blank" rel="noopener noreferrer">Printer's own page (Fluidd) ↗</a>` : ''}
        </article>`).join('');
      qsa('[data-open]', grid).forEach(btn => btn.addEventListener('click', () => selectPrinter(btn.dataset.open, btn.closest('.fleet-card'))));
    }
    live.fleet.forEach(p => {
      const card = qs(`.fleet-card[data-printer="${CSS.escape(p.id)}"]`, grid);
      if (!card) return;
      const f = (k) => qs(`[data-f="${k}"]`, card);
      card.classList.toggle('is-selected', p.id === (currentPrinter || live.fleet[0].id));
      setVar(card, '--glass-tint', p.state === 'printing' && p.active_color ? p.active_color : p.state === 'ready' ? '#ffffff' : STATE_HEX[p.state] || '#ffffff');
      // Any printer but a U1 says what it is, from its own report (machines.py).
      const kind = f('machine'), other = p.machine && !p.machine.reference;
      kind.hidden = !other;
      if (other) { setText(kind, `${p.machine.label} · untested type`); kind.title = p.machine.note || ''; }
      const st = f('state');
      setText(st, STATE_WORD[p.state] || p.state);
      setVar(st, '--dot', STATE_COLOR[p.state] || '');
      // The ring is drawn once and then only its arc moves, so its CSS
      // transition can glide between readings instead of jumping.
      const ring = f('ring'), progress = Math.max(0, Math.min(1, p.progress || 0));
      if (!ring.firstElementChild) ring.innerHTML = `${ringSVG(progress, STATE_HEX[p.state])}<span class="fc-pct"></span>`;
      const arc = qs('.rs-fill', ring), circ = 2 * Math.PI * 15.5;
      setVar(arc, 'stroke', STATE_HEX[p.state] || '#8e8e93');
      setVar(arc, 'stroke-dashoffset', String(circ * (1 - progress)));
      setText(qs('.fc-pct', ring), p.state === 'ready' ? 'Ready' : `${Math.round(progress * 100)}%`);
      setText(f('file'), p.current_file || (p.state === 'error' ? p.state_message : 'Ready for a print'));
      setText(f('meta'), p.remaining_hours != null
        ? `${fmtHours(p.remaining_hours)} left · done ${doneAt(p.remaining_hours)}` : (p.state_message || ''));
      setHTML(f('docks'), Object.entries(p.docks || {}).map(([th, d]) => `
        <span class="fc-dock ${d.status}" title="${esc(th)}: ${esc(d.status)}">
          <span class="fc-dock-chip" style="background:${esc(d.color)}"></span>${esc(th)}
        </span>`).join(''));
      setHTML(f('temps'), `
        <span>Nozzle <b>${p.nozzle_temperature != null ? formatTemp(p.nozzle_temperature) : '—'}</b></span>
        <span>Bed <b>${formatTemp(p.bed_temperature)}</b></span>
        <span>Chamber <b>${p.chamber_temperature != null ? formatTemp(p.chamber_temperature) : '—'}</b></span>
        <span>Health <b>${p.health ?? '—'}</b></span>`);
      const alerts = p.alerts || [];
      setHTML(f('alerts'), alerts.length
        ? alerts.map(a => `<li class="fc-alert ${esc(a.level)}">${esc(a.text)}</li>`).join('')
        : '<li class="fc-alert ok">No alerts</li>');
      card.classList.toggle('is-stale', !!p.link_lost);
    });
    // The fleet command center (farm.js) adds selection, queues and drop targets.
    window.dispatchEvent(new CustomEvent('dv-fleet', { detail: live.fleet }));
  }

  /* ================================================================
   * Needs you: the whole farm, ranked by what wants a person
   * ================================================================
   * Read straight from the fleet rows the server already sends (their
   * alerts, state and time left) plus each printer's queue. Nothing here
   * is inferred beyond that: a fault is a fault the printer reported, a
   * queue is files really waiting. */

  const attention = { queues: {}, queuesAt: 0, queueOff: false };
  const TAB_LABEL = { control: 'Printer', files: 'Files', maintenance: 'Care' };
  const SOON_HOURS = 0.25;   // "about to finish" means within 15 minutes

  async function refreshAttentionQueues() {
    if (Date.now() - attention.queuesAt < 15000) return;
    attention.queuesAt = Date.now();
    const data = await getJSON(api('/api/fleet/queues')).catch(() => null);
    attention.queueOff = !data || isModuleDisabled(data) || !!data.queue_disabled;
    attention.queues = (!attention.queueOff && data.queues) || {};
  }

  function attentionItems(printers) {
    const items = [];
    printers.forEach(p => {
      const add = (rank, level, title, sub, go) => items.push({ rank, level, title, sub, go, id: p.id, name: p.name });
      // Faults the printer reported: dock errors, a printer error, lost link.
      (p.alerts || []).filter(a => a.level === 'error').forEach(a => {
        const said = p.state_message && p.state_message !== a.text ? p.state_message : '';
        const detail = [said, p.current_file ? `during ${p.current_file}` : ''].filter(Boolean).join(' · ') || 'see it in Control';
        add(0, 'error', `${p.name}: ${a.text}`, detail[0].toUpperCase() + detail.slice(1), 'control');
      });
      if (p.state === 'paused') {
        add(1, 'warning', `${p.name} is paused`, `${p.current_file || 'Current print'} · ${Math.round(p.progress * 100)}% done`, 'control');
      } else if (p.state === 'complete') {
        add(1, 'done', `${p.name} finished ${p.current_file || 'its print'}`, 'Ready for the next print once the bed is clear', 'control');
      }
      const q = attention.queues[p.id];
      const waiting = q ? q.items.filter(i => i.status === 'queued' || i.status === 'held').length : 0;
      if (p.state === 'ready' && waiting && !p.link_lost) {
        add(2, 'warning', `${p.name} is idle with ${waiting} file${waiting === 1 ? '' : 's'} waiting`, 'Start the next one from Files', 'files');
      }
      (p.alerts || []).filter(a => a.level === 'warning' && a.text !== 'Paused').forEach(a =>
        add(3, 'warning', `${p.name}: ${a.text}`, 'See what is due in Care', 'maintenance'));
      if (p.state === 'printing' && p.remaining_hours != null && p.remaining_hours <= SOON_HOURS) {
        add(4, 'info', `${p.name} finishes in ${fmtHours(p.remaining_hours)}`, `${p.current_file || 'Current print'} · done ${doneAt(p.remaining_hours)}`, 'control');
      }
    });
    return items.sort((a, b) => a.rank - b.rank);
  }

  function attentionSummary(printers) {
    const printing = printers.filter(p => p.state === 'printing');
    const next = printing.filter(p => p.remaining_hours != null).sort((a, b) => a.remaining_hours - b.remaining_hours)[0];
    const parts = [];
    if (printing.length) parts.push(`${printing.length} printing`);
    const idle = printers.filter(p => p.state === 'ready').length;
    if (idle) parts.push(`${idle} idle`);
    const head = parts.length ? parts.join(', ') : `${printers.length} printer${printers.length === 1 ? '' : 's'}`;
    return next ? `${head} · next one done ${doneAt(next.remaining_hours)} (${next.name})` : head;
  }

  function renderAttention(printers) {
    const card = $('attention');
    if (!card) return;
    if (!liveData() || !printers.length) { card.hidden = true; return; }
    card.hidden = false;
    refreshAttentionQueues();
    const items = attentionItems(printers);
    const worst = items.length ? items[0].level : 'clear';
    card.dataset.level = worst;
    $('attention-count').textContent = items.length ? String(items.length) : '';
    $('attention-sub').textContent = items.length
      ? `${items.length} thing${items.length === 1 ? '' : 's'} across ${printers.length} printer${printers.length === 1 ? '' : 's'} · ${attentionSummary(printers)}`
      : `All clear · ${attentionSummary(printers)}`;
    paint($('attention-list'), items.length ? items.slice(0, 6).map(it => `
      <li class="att-item ${it.level}">
        <span class="att-dot" aria-hidden="true"></span>
        <span class="att-text"><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></span>
        <button class="btn small" type="button" data-att-printer="${esc(it.id)}" data-att-tab="${esc(it.go)}"
                aria-label="Open ${esc(it.name)} in ${esc(TAB_LABEL[it.go])}">${esc(TAB_LABEL[it.go])}</button>
      </li>`).join('') + (items.length > 6 ? `<li class="att-more">+${items.length - 6} more on the Fleet tab</li>` : '')
      : `<li class="att-item clear"><span class="att-dot" aria-hidden="true"></span>
          <span class="att-text"><b>Nothing needs you right now</b><small>Faults, paused or finished prints, idle printers with work waiting and overdue care show up here as they happen.</small></span></li>`);
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-att-printer]');
    if (!btn) return;
    const id = btn.dataset.attPrinter, tab = btn.dataset.attTab;
    if (id !== (currentPrinter || (live.fleet[0] && live.fleet[0].id))) selectPrinter(id, null, true);
    showTab(tab);
  });

  let registry = [];
  async function loadRegistry() {
    const host = $('fleet-registry');
    const data = await getJSON('/api/fleet/registry').catch(() => ({}));
    if (isModuleDisabled(data)) { host.innerHTML = moduleDisabledEmpty('Printer fleet'); return; }
    registry = data.printers || [];
    addedPrinters = registry;
    host.innerHTML = registry.length ? registry.map(p => `
      <div class="reg-row">
        <span class="reg-name">${esc(p.name)}</span>
        <code class="reg-url">${esc(p.moonraker_url)}</code>
        <span class="pill reg-pill ${p.connected ? 'is-ok' : 'is-bad'}" role="status">${esc(p.link || (p.connected ? 'Connected' : 'Not connected'))}</span>
        <button class="btn small" data-reg-details="${esc(p.id)}" type="button" aria-expanded="false">Details</button>
        <button class="btn small" data-reg-remove="${esc(p.id)}" type="button">Remove</button>
        <div class="reg-details" id="reg-details-${esc(p.id)}" hidden></div>
      </div>`).join('') : '<p class="log-empty">No printers added yet.</p>';
    qsa('[data-reg-details]', host).forEach(b => b.addEventListener('click', async () => {
      const box = $(`reg-details-${b.dataset.regDetails}`);
      const open = box.hidden;
      box.hidden = !open;
      b.setAttribute('aria-expanded', String(open));
      if (!open) return;
      box.textContent = 'Loading…';
      const d = await getJSON(`/api/printers/diagnostics?printer=${enc(b.dataset.regDetails)}`).catch(() => null);
      if (!d || d.error) { box.textContent = (d && d.error) || 'Couldn\'t load the connection details.'; return; }
      const facts = [
        ['Connection', d.connected ? `open since ${d.connected_at || '?'}` : `closed: ${d.last_error || 'connecting…'}`],
        ['Klipper', d.klippy_state || '—'],
        ['Toolheads', (d.toolheads || []).join(', ') || '—'],
        ['Chamber sensor', d.chamber_sensor || 'none reported'],
        ['Print history', d.history_error ? `couldn't read it: ${d.history_error}` : `${d.history_jobs ?? 0} jobs`],
      ];
      const log = (d.log || []).slice(0, 14).map(e => `<li><span class="reg-t">${esc((e.t || '').slice(11))}</span> ${esc(e.method || '')} ${esc(e.path || '')}${e.status ? ` → ${esc(e.status)}` : ''}${e.error ? ` <strong class="reg-err">${esc(e.error)}</strong>` : ''}</li>`).join('');
      box.innerHTML = `<dl class="reg-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        <p class="reg-log-head">Last exchanges with its Moonraker (newest first)</p><ol class="reg-log">${log || '<li>Nothing yet.</li>'}</ol>`;
    }));
    qsa('[data-reg-remove]', host).forEach(b => b.addEventListener('click', async () => {
      const r = await postJSON(`/api/fleet/registry/${enc(b.dataset.regRemove)}/remove`, {});
      toast(r.ok ? 'Printer removed' : `Couldn't remove: ${r.body.error}`, r.ok ? 'ok' : 'bad');
      loadRegistry();
    }));
    renderChip();
  }

  /* ---- finding and testing printers (backend/discovery.py) ---- */
  function describeProbe(r) {
    if (r.ok && !r.error) return `Moonraker ${r.moonraker_version || ''} answered, Klipper is ready${r.u1 ? ', and it reports Snapmaker\'s U1 objects' : ''}${r.toolheads ? ` · ${r.toolheads} toolhead${r.toolheads === 1 ? '' : 's'}` : ''}.`;
    return r.error || 'No answer';
  }

  async function findPrinters(btn) {
    btn.disabled = true; btn.textContent = 'Looking…';
    $('fleet-find-note').textContent = 'Asking the network, then trying port 7125 on each address - a few seconds.';
    const r = await postJSON('/api/printers/discover', {});
    btn.disabled = false; btn.textContent = 'Find printers on my network';
    const list = $('fleet-found');
    if (!r.ok) { $('fleet-find-note').textContent = r.body.error || 'Couldn\'t look'; list.hidden = true; return; }
    const found = r.body.printers || [];
    $('fleet-find-note').textContent = `${found.length ? `Found ${found.length}` : 'Found nothing'} in ${r.body.seconds} s (${(r.body.how || []).join('; ')}).`
      + (found.length ? '' : ' Check the printer is on and on the same network, or type its address below.');
    list.hidden = !found.length;
    list.innerHTML = found.map((p, i) => `<li class="found">
      <span class="found-main"><b>${esc(p.name || p.ip)}</b>${p.u1 ? '<span class="found-tag">U1</span>' : ''}
        <small>http://${esc(p.ip)}:${p.port} · ${esc(p.source)}</small>
        <small class="${p.ok && !p.error ? 'is-ok' : 'is-warn'}">${esc(describeProbe(p))}</small></span>
      ${p.added ? '<span class="found-added">Added</span>' : `<button class="btn small" type="button" data-use="${i}">Use this</button>`}</li>`).join('');
    list.querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', () => {
      const p = found[+b.dataset.use];
      $('fleet-add-url').value = `http://${p.ip}:${p.port}`;
      if (!$('fleet-add-name').value) $('fleet-add-name').value = (p.name || `U1 ${p.ip.split('.').pop()}`).slice(0, 40);
      if (p.needs_key) $('fleet-add-key').focus(); else $('fleet-add-name').focus();
      showTest(p);
    }));
  }

  function showTest(r) {
    const out = $('fleet-test-result');
    out.hidden = false;
    out.className = `test-result ${r.ok && !r.error ? 'is-ok' : 'is-warn'}`;
    out.textContent = describeProbe(r);
    // A printer behind a web-page sign-in: offer that sign-in instead of
    // asking for an API key the owner has never seen.
    $('fleet-login').hidden = !r.needs_key;
    if (r.url) $('fleet-add-url').value = r.url;
  }

  function initFleet() {
    $('printer-chip').addEventListener('click', (e) => openPrinterMenu(e.currentTarget, e.detail === 0));
    $('fleet-find').addEventListener('click', (e) => findPrinters(e.currentTarget));
    $('fleet-add-test').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Testing…';
      const r = await postJSON('/api/printers/test', { moonraker_url: $('fleet-add-url').value, api_key: $('fleet-add-key').value });
      btn.disabled = false; btn.textContent = 'Test';
      // The address that answered (tidied, or on Moonraker's own port) is the one to add.
      if (r.ok && r.body.url && (r.body.ok || r.body.needs_key)) $('fleet-add-url').value = r.body.url;
      showTest(r.ok ? r.body : { ok: false, error: r.body.error });
    });
    $('fleet-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter || e.target.querySelector('button');
      btn.disabled = true; btn.textContent = 'Signing in…';
      const r = await postJSON('/api/printers/login', { moonraker_url: $('fleet-add-url').value,
        username: $('fleet-login-user').value, password: $('fleet-login-pass').value });
      $('fleet-login-pass').value = '';
      btn.disabled = false; btn.textContent = 'Sign in';
      if (!r.ok) { showTest({ ok: false, needs_key: true, error: r.body.error }); return; }
      $('fleet-add-key').value = r.body.api_key;
      const t = await postJSON('/api/printers/test', { moonraker_url: r.body.url, api_key: r.body.api_key });
      showTest(t.ok ? t.body : { ok: false, error: t.body.error });
      if (t.ok && t.body.ok) toast('Signed in. The printer\'s key is filled in: press Add printer', 'ok', 6000);
    });
    $('fleet-add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submit = e.submitter || e.target.querySelector('button[type=submit]');
      const label = submit ? submit.textContent : '';
      if (submit) { submit.disabled = true; submit.textContent = 'Checking the address…'; }
      // Add the address that really answers (a pasted web-page address becomes Moonraker's).
      // A printer that is switched off is still added; it connects when it comes on.
      const t = await postJSON('/api/printers/test',
        { moonraker_url: $('fleet-add-url').value, api_key: $('fleet-add-key').value });
      if (t.ok && t.body.url && (t.body.ok || t.body.needs_key)) $('fleet-add-url').value = t.body.url;
      if (submit) { submit.disabled = false; submit.textContent = label; }
      const r = await postJSON('/api/fleet/registry', { name: $('fleet-add-name').value, moonraker_url: $('fleet-add-url').value,
                                                         api_key: $('fleet-add-key').value });
      if (r.ok) { toast(`${r.body.name} added, connecting to it now`, 'ok', 5000); e.target.reset(); $('fleet-login').hidden = true; }
      else toast(`Couldn't add it: ${r.body.error}`, 'bad', 6000);
      loadRegistry();
      // Show the connection opening (or why it can't) without a reload.
      if (r.ok) [2000, 5000, 10000, 20000].forEach(ms => setTimeout(() => { loadRegistry(); refreshAll(); }, ms));
    });
  }

  /* ================================================================
   * 4. overview: digital twin, health gauge, chamber
   * ================================================================ */

  /* The digital twin is a live engineering drawing: one ink, ISO line
   * weights, hidden edges dashed, real dimensions, a sheet border and a
   * title block, projected from the printer's own millimetres and redrawn
   * as it moves. Click (or tap) a toolhead, a balloon, a part or the bed
   * for its details.
   *
   * Where each fact comes from:
   * - The 270 x 270 x 270 mm build volume (Snapmaker's spec page), drawn
   *   as a phantom line - the drafting symbol for a travel limit.
   * - The bed DROPS as Z rises and the toolhead stays at the top. The U1's
   *   bed rides a timing belt (Snapmaker's wiki: removing the transport
   *   screws "releases the tension between the timing belt and the heated
   *   bed"), so Z is the bed going down, as on most enclosed CoreXY printers.
   * - CoreXY: the X beam slides along two Y rails; the head rides the beam.
   * - Four docks on the rear beam (Snapmaker's wiki: the docking bracket
   *   "is located on the rear beam"). Klipper keeps each dock's exact
   *   position in the printer's own config, not in anything Moonraker
   *   reports, so the docks are spread evenly across the width: right
   *   order and side, approximate spacing.
   * - The parts are the file's own object outlines (Klipper's
   *   exclude_object, the same data as Skip one object), extruded from the
   *   bed to the nozzle. Skipped ones stop growing and are crossed out.
   * - Nozzle size and the swap counters in a toolhead's details come from
   *   the U1's firmware (u1-klipper extruder.get_status), when it reports
   *   them. */
  const WF = {
    BED: 270,                       // build volume, mm, each way
    TOP: 270,                       // world height of the nozzle tip
    DOCK_Y: 312,                    // rear beam, behind the bed
    HEAD: { w: 42, d: 44, h: 54, cone: 9 },
    VIEWS: { iso: [-34, 27], front: [0, 0], top: [0, 90], print: [-30, 32] },
    VIEW_WORD: { iso: 'Angled', front: 'Front', top: 'Top', print: 'Print' },
    // The whole machine (Snapmaker's published outer size, 584 x 499 x 730 mm),
    // in the drawing's frame: the nozzle tip is at Z 270 here and 600 mm
    // above the floor on the real printer, so the floor is at Z -330.
    OUTER: { x0: -157, x1: 427, y0: -95, y1: 404, z0: -330, z1: 400 },
    PX_PER_MM: 96 / 25.4,           // CSS pixels in a millimetre
  };
  const twin = {
    built: false, yaw: WF.VIEWS.iso[0], pitch: WF.VIEWS.iso[1], view: 'iso',
    pos: [135, 135, 0], state: null, trail: [], trailZ: null, job: null, jobAt: 0,
    w: 0, h: 0, queued: false, label: '', paths: {}, pick: null,
    // Shaded model or engineering drawing (kept in this browser), the
    // drawing's zoom and pan, and whether it shows the outer size.
    mode: (() => { try { return localStorage.getItem('dejavu1.twin-mode') === 'drawing' ? 'drawing' : 'model'; } catch (e) { return 'model'; } })(),
    zoom: 1, panX: 0, panY: 0, outer: false, model: null,
    // The 3D model's options (kept in this browser): case on, see-through or
    // off; the print; what's left of it; head labels; a slow turntable.
    view3d: (() => {
      const d = { case: 'closed', print: true, rest: true, tags: true, spin: false };
      try { const o = JSON.parse(localStorage.getItem('dejavu1.twin-view') || '{}'); return { ...d, ...(o && typeof o === 'object' ? o : {}) }; } catch (e) { return d; }
    })(),
    printKey: null, printNote: '',
  };
  const BUCKETS = ['grid', 'env', 'frame', 'trail', 'hid', 'part-hid', 'vis', 'part', 'head', 'fault',
    'skip', 'sel-hid', 'sel', 'dim', 'axis'];

  function buildTwin() {
    const host = $('twin-host');
    host.innerHTML = `
      <div class="twin-tools" role="toolbar" aria-label="Twin view tools">
        <button type="button" class="btn small" data-twin="zoom-out" aria-label="Zoom out">−</button>
        <button type="button" class="btn small" data-twin="zoom-in" aria-label="Zoom in">+</button>
        <button type="button" class="btn small" data-twin="reset">Reset view</button>
        <button type="button" class="btn small twin-spin" id="twin-spin" aria-pressed="false" data-model-only
          title="Turns the model slowly so you can see it from every side. Drag to stop and look around.">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v2.8h-2.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>Turn slowly</span></button>
        <div class="pill-toggle twin-case" id="twin-case" role="group" aria-label="Case" data-model-only>
          <button type="button" data-case="closed" aria-pressed="true" class="active">Case on</button>
          <button type="button" data-case="glass" aria-pressed="false">See-through</button>
          <button type="button" data-case="open" aria-pressed="false">Case off</button>
        </div>
        <details class="twin-more" id="twin-more" data-model-only>
          <summary class="btn small">Show</summary>
          <div class="twin-more-panel" role="group" aria-label="What the model shows">
            <label><input type="checkbox" data-opt="print"> The print, in its colours</label>
            <label><input type="checkbox" data-opt="rest"> What's left to print, faintly</label>
            <label><input type="checkbox" data-opt="tags"> Head labels</label>
          </div>
        </details>
        <label class="twin-outer" data-drawing-only><input type="checkbox" id="wf-outer"> <span>Outer size</span></label>
        <button type="button" class="btn small" data-twin="download" data-drawing-only>Download drawing</button>
        <span class="twin-hint" id="twin-hint"></span>
      </div>
      <div class="twin-model" id="twin-model"></div>
      <div class="wf" id="wf">
        <svg class="wf-svg" id="wf-svg" role="img" tabindex="0" aria-roledescription="drawing"
             aria-describedby="twin-readout" aria-label="Line drawing of the printer" shape-rendering="geometricPrecision">
          <defs><marker id="wf-arrow" viewBox="0 0 10 4" refX="10" refY="2" markerWidth="10" markerHeight="4"
            markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 2L0 4z" class="wf-arrowhead"/></marker></defs>
          <g class="wf-ink">${BUCKETS.map(k => `<path class="wf-${k}" data-k="${k}"/>`).join('')}</g>
          <g class="wf-dims" id="wf-dims"></g>
          <g class="wf-hits" id="wf-hits"></g>
          <g class="wf-hits"><polygon id="wf-hit-on"><title></title></polygon></g>
          <g class="wf-tags" id="wf-tags"></g>
          <g class="wf-tags" id="wf-on">
            <path class="wf-leader" id="wf-on-leader"/>
            <g class="wf-balloon on" id="wf-on-balloon"><circle r="10.5"/><text text-anchor="middle"></text><rect class="wf-swatch" width="7" height="7"/></g>
            <text class="wf-note" id="wf-on-temp"></text>
            <circle class="wf-tip" id="wf-tip" r="2.5"/>
          </g>
          <g class="wf-sheet" id="wf-sheet" aria-hidden="true"></g>
        </svg>
      </div>
      <div class="wf-picks" id="wf-picks" role="group" aria-label="Show details for"></div>
      <div class="wf-detail" id="wf-detail" hidden></div>
      <div class="twin-readout" id="twin-readout"></div>`;
    const svg = $('wf-svg');
    twin.model = null;
    twin.paths = {};
    svg.querySelectorAll('path[data-k]').forEach(p => { twin.paths[p.dataset.k] = p; });
    twin.w = 0;

    // A press that moves is a turn; one that doesn't is a click on a part.
    let drag = null;
    svg.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, yaw: twin.yaw, pitch: twin.pitch, moved: false, target: e.target };
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      if (!drag.moved) { drag.moved = true; svg.setPointerCapture?.(e.pointerId); }
      setView(drag.yaw + (e.clientX - drag.x) * 0.5, drag.pitch + (e.clientY - drag.y) * 0.4, null, true);
    });
    svg.addEventListener('pointerup', () => {
      if (drag && !drag.moved) {
        const hit = drag.target.closest && drag.target.closest('[data-pick]');
        choose(hit ? hit.dataset.pick : null);
      }
      drag = null;
    });
    ['pointercancel', 'lostpointercapture'].forEach(type => svg.addEventListener(type, () => { drag = null; }));
    svg.addEventListener('dblclick', () => { twin.zoom = 1; twin.panX = twin.panY = 0; setView(...WF.VIEWS.iso, 'iso'); });
    svg.addEventListener('wheel', (e) => { e.preventDefault(); zoomDrawing(Math.exp(-e.deltaY * 0.0012)); }, { passive: false });
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { choose(null); return; }
      const turn = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] }[e.key];
      if (!turn) return;
      e.preventDefault();
      setView(twin.yaw + turn[0], twin.pitch + turn[1], null, true);
    });
    // The view and mode buttons live in the card's header (index.html), wired once.
    document.querySelectorAll('#wf-views button').forEach(b => {
      if (b.dataset.wired) return;
      b.dataset.wired = '1';
      b.addEventListener('click', () => setView(...WF.VIEWS[b.dataset.view], b.dataset.view));
    });
    document.querySelectorAll('#twin-modes button').forEach(b => {
      if (b.dataset.wired) return;
      b.dataset.wired = '1';
      b.addEventListener('click', () => setTwinMode(b.dataset.mode));
    });
    host.querySelector('.twin-tools').addEventListener('click', (e) => {
      const b = e.target.closest('[data-twin]');
      if (!b) return;
      const act = b.dataset.twin;
      if (act === 'zoom-in') twin.model ? twin.model.zoomBy(1.25) : zoomDrawing(1.25);
      if (act === 'zoom-out') twin.model ? twin.model.zoomBy(0.8) : zoomDrawing(0.8);
      if (act === 'reset') { twin.zoom = 1; twin.panX = twin.panY = 0; setView(...WF.VIEWS.iso, 'iso'); }
      if (act === 'download') twin.model ? twin.model.download(`${(twin.state && twin.state.printer_name || 'printer').replace(/[^\w.-]+/g, '_')}-drawing.png`) : downloadDrawing();
    });
    // The model's options, kept in this browser.
    document.querySelectorAll('#twin-case button').forEach(b => b.addEventListener('click', () => { twin.view3d.case = b.dataset.case; applyTwinOptions(); }));
    document.querySelectorAll('#twin-more input[data-opt]').forEach(i => i.addEventListener('change', () => { twin.view3d[i.dataset.opt] = i.checked; applyTwinOptions(); }));
    $('twin-spin').addEventListener('click', () => {
      twin.view3d.spin = !twin.view3d.spin;
      applyTwinOptions();
      if (twin.view3d.spin && matchMedia('(prefers-reduced-motion: reduce)').matches) toast('Your system asks for reduced motion, so the model stays still', 'info');
    });
    document.addEventListener('click', (e) => { const d = $('twin-more'); if (d && d.open && !d.contains(e.target)) d.open = false; });
    $('wf-outer').addEventListener('change', (e) => { twin.outer = e.target.checked; if (twin.model) twin.model.setCase(twin.outer); else drawTwin(true); });
    $('wf-picks').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (b) choose(twin.pick === b.dataset.pick ? null : b.dataset.pick);
    });
    $('wf-detail').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'close') choose(null);
      if (b.dataset.act === 'control') showTab('control');
      if (b.dataset.act === 'skip' && typeof plateUI !== 'undefined') {
        plateUI.selected = b.dataset.name; plateUI.confirmUntil = 0; plateUI.sig = '';
        showTab('control');
      }
    });
    // The drawing works in CSS pixels (so its labels stay a readable size
    // on a phone), which means it is redrawn when the card changes width.
    if (window.ResizeObserver) new ResizeObserver(() => drawTwin(true)).observe($('wf'));
    // Draw only while the twin can be seen. A print moves the heads about 30 times a second, and
    // drawing the 3D model each time cost a whole CPU core in software WebGL even on another
    // screen or scrolled out of view. Readings that arrive meanwhile are kept, and the twin
    // catches up the moment it comes back into view.
    if (window.IntersectionObserver && !twin.watch) {
      twin.watch = new IntersectionObserver(entries => {
        twin.visible = entries.some(e => e.isIntersecting);
        if (twin.visible && twin.stale) { twin.stale = false; queueTwin(); }
      });
      twin.watch.observe($('twin-card'));
    }
    twin.built = true;
    setTwinMode(twin.mode);
  }

  function applyTwinOptions() {
    const o = twin.view3d;
    try { localStorage.setItem('dejavu1.twin-view', JSON.stringify(o)); } catch (e) { /* not remembered */ }
    document.querySelectorAll('#twin-case button').forEach(b => { const on = b.dataset.case === o.case; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll('#twin-more input[data-opt]').forEach(i => { i.checked = !!o[i.dataset.opt]; });
    const spin = $('twin-spin');
    if (spin) { spin.setAttribute('aria-pressed', String(!!o.spin)); spin.classList.toggle('active', !!o.spin); setText(spin.querySelector('span'), o.spin ? 'Turning · stop' : 'Turn slowly'); }
    if (twin.model) { twin.model.setCaseMode(o.case); twin.model.setOptions({ print: o.print, rest: o.rest, tags: o.tags, spin: o.spin }); }
  }

  /* The print on the plate, from its own G-code (backend/print_preview.py),
   * fetched once per printer and file. Without it the twin falls back to the
   * objects' outlines. */
  async function syncTwinPrint(state) {
    const on = state && ['printing', 'paused', 'complete'].includes(state.state) && state.current_file;
    const key = on ? `${state.printer_id}|${state.current_file}` : '';
    if (key === twin.printKey) return;
    twin.printKey = key;
    if (!key) { if (twin.model) twin.model.setPrint(null); return; }
    try {
      const data = await getJSON(api('/api/print/preview'));
      if (twin.printKey !== key || !twin.model) return;
      twin.model.setPrint(data && data.file === state.current_file && data.layers ? data : null);
      twin.printNote = data && (data.reason || data.note) || '';
    } catch (e) {
      if (twin.printKey === key) { twin.printKey = ''; twin.printNote = ''; }
    }
  }

  /* Model or drawing. The model needs WebGL; without it the drawing stays. */
  /* Both modes are drawn by twin3d.js (WebGL 2) from one detailed model;
   * without WebGL 2 the SVG line drawing below takes over. */
  function setTwinMode(mode) {
    if (!twin.model && twin.built && typeof Twin3D !== 'undefined') {
      twin.model = Twin3D.create($('twin-model'), { onPick: id => choose(id) });
      if (twin.model) { twin.model.onViewChange(name => markView(name)); twin.printKey = null; applyTwinOptions(); syncTwinPrint(twin.state); }
    }
    if (mode === 'model' && !twin.model) mode = 'drawing';
    twin.mode = mode;
    try { localStorage.setItem('dejavu1.twin-mode', mode); } catch (e) { /* the choice just isn't remembered */ }
    const card = $('twin-card');
    if (card) { card.dataset.twinMode = mode; card.dataset.twinEngine = twin.model ? '3d' : 'svg'; }
    if (twin.model) twin.model.setStyle(mode);
    const outerLabel = document.querySelector('.twin-outer span');
    if (outerLabel) outerLabel.textContent = twin.model ? 'Show the case' : 'Outer size';
    document.querySelectorAll('#twin-modes button').forEach(b => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const hint = $('twin-hint');
    const touch = matchMedia('(pointer: coarse)').matches;
    if (hint) hint.textContent = touch
      ? 'Swipe sideways to turn · + and − zoom · tap a part for details'
      : mode === 'model'
        ? 'Drag to turn · right-drag to move · scroll to zoom · click a head for details'
        : 'Drag to turn · scroll to zoom · click a part for details';
    if (twin.model) twin.model.select(twin.pick);
    if (mode === 'drawing' && !twin.model) drawTwin(true); else queueTwin();
  }

  function markView(name) {
    twin.view = name;
    document.querySelectorAll('#wf-views button').forEach(b => {
      const on = b.dataset.view === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function zoomDrawing(f) {
    twin.zoom = Math.max(0.6, Math.min(5, twin.zoom * f));
    drawTwin();
  }

  /* The drawing as a stand-alone SVG file, with its line styles inlined
   * (they normally come from workshop.css). */
  function downloadDrawing() {
    const svg = $('wf-svg');
    if (!svg) return;
    const copy = svg.cloneNode(true);
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.querySelectorAll('.wf-hits').forEach(g => g.remove());
    const rules = [];
    for (const sheet of document.styleSheets) {
      let list = [];
      try { list = sheet.cssRules || []; } catch (e) { continue; }
      for (const r of list) if (r.selectorText && /\.wf-/.test(r.selectorText) && !/hover|focus|active/.test(r.selectorText)) rules.push(r.cssText);
    }
    const ink = getComputedStyle($('wf'));
    const vars = ['--ink', '--ink-mid', '--ink-light', '--ink-faint', '--pick', '--fault', '--paper-solid', '--font-mono', '--font-sans']
      .map(k => `${k}:${ink.getPropertyValue(k)}`).join(';');
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = `svg{${vars};background:#fff;font-family:${ink.getPropertyValue('--font-mono') || 'monospace'}}${rules.join('')}`;
    copy.insertBefore(style, copy.firstChild);
    const blob = new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(twin.state && twin.state.printer_name || 'printer').replace(/[^\w.-]+/g, '_')}-drawing.svg`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* Turn to a view. `now` skips the glide (dragging follows the finger). */
  function setView(yaw, pitch, name, now) {
    pitch = Math.max(0, Math.min(90, pitch));
    markView(name);
    if (name && twin.model) twin.model.setView(name);
    if (now) { twin.yaw = yaw; twin.pitch = pitch; smooth.delete('wf-view'); drawTwin(); return; }
    // Take the short way round, so 3D -> Front turns 34 degrees, not 326.
    const start = yaw + (((twin.yaw - yaw) % 360) + 540) % 360 - 180;
    smooth.set('wf-view', { value: [start, twin.pitch], target: [start, twin.pitch], apply: () => {} });
    tween('wf-view', [yaw, pitch], ([y, p]) => { twin.yaw = y; twin.pitch = p; queueTwin(); });
  }

  /* Readings arriving together (position, view) draw once, after them,
   * at most about 30 times a second: smooth for a machine moving at
   * printing speed, and it leaves the rest of the page its frames
   * (measured: drawing every frame cost the Overview ~2 fps more on a
   * slowed CPU). Dragging draws straight away (setView). */
  function queueTwin() {
    if (twin.visible === false) { twin.stale = true; return; }   // out of sight: catch up when seen
    if (twin.queued) return;
    twin.queued = true;
    // Whole display frames are skipped until 30 ms have passed since the last drawing: every
    // other frame on a 60 Hz screen. (A 32 ms timer before the frame usually overshot to the
    // third frame, so a print moved the heads about 20 times a second, unevenly.)
    // Following a print's G-code the twin draws every frame where the model costs little to draw
    // (a real graphics card). Where it costs more (software drawing) it leaves the page at least
    // two thirds of the time: a 40 ms drawing waits 120 ms before the next, and a very slow one
    // draws no more than about once a second.
    const draw = () => {
      const cost = twin.model ? twin.model.drawCost() : 0;
      const gap = cost < 8 ? 0 : Math.min(Math.max(1000 - cost, 250), Math.max(30, cost * 3));
      if (performance.now() - (twin.drawnAt || 0) < gap) { requestAnimationFrame(draw); return; }
      twin.queued = false;
      if (twin.model) {
        // The drawing itself happens a frame later and takes `cost`: count the gap from its end.
        twin.drawnAt = performance.now() + cost;
        twin.model.update(twin.state, twin.pos);
        renderChips();
        const sync = twin.model.syncInfo();
        renderSync(sync);
        if (sync && !sync.paused && !matchMedia('(prefers-reduced-motion: reduce)').matches) queueTwin();
      } else drawTwin();
    };
    requestAnimationFrame(draw);
  }

  /* One line under the twin: is it in step with the printer? Updated twice a second. */
  function renderSync(sync) {
    const el = $('twin-sync');
    if (!el || (performance.now() - (twin.syncAt || 0) < 500 && !!sync === !el.hidden)) return;
    twin.syncAt = performance.now();
    el.hidden = !sync;
    if (!sync) return;
    const clock = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
    const where = `${clock(sync.play)} of ${clock(sync.total)} into the file`;
    let kind = 'ok', text;
    if (sync.offPath) { kind = 'warn'; text = 'A move outside the file (a tool change, a purge or a park): showing where the nozzle is now'; }
    else if (sync.paused) { kind = 'warn'; text = `Paused ${where}`; }
    else if (sync.live) text = `In step with the printer, ${where}${sync.error_mm != null ? ` (within ${sync.error_mm < 0.1 ? '0.1' : sync.error_mm.toFixed(1)} mm)` : ''}`;
    else text = `Following the file from where the printer is reading, ${where}`;
    el.dataset.kind = kind;
    const t = $('twin-sync-text');
    if (t.textContent !== text) t.textContent = text;
  }

  /* ---- solids, in printer millimetres (X right, Y back, Z up) ----------
   * Each solid is a list of edges, and each edge knows the outward normals
   * of the two faces it joins. From the view direction, an edge between
   * two faces turned away from you is hidden: drawn thin and dashed, the
   * way a drawing shows the far side of a part. */
  function boxSolid(x0, y0, z0, x1, y1, z1) {
    const X = [[-1, 0, 0], [1, 0, 0]], Y = [[0, -1, 0], [0, 1, 0]], Z = [[0, 0, -1], [0, 0, 1]];
    const xs = [x0, x1], ys = [y0, y1], zs = [z0, z1], edges = [];
    for (const j of [0, 1]) for (const k of [0, 1]) {
      edges.push({ a: [x0, ys[j], zs[k]], b: [x1, ys[j], zs[k]], n: [Y[j], Z[k]] });   // along X
      edges.push({ a: [xs[j], y0, zs[k]], b: [xs[j], y1, zs[k]], n: [X[j], Z[k]] });   // along Y
      edges.push({ a: [xs[j], ys[k], z0], b: [xs[j], ys[k], z1], n: [X[j], Y[k]] });   // along Z
    }
    return edges;
  }
  /* A polygon on the bed, extruded from z0 to z1. */
  function prismSolid(poly, z0, z1) {
    let area = 0;
    poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; area += p[0] * q[1] - q[0] * p[1]; });
    const pts = area < 0 ? poly.slice().reverse() : poly;      // counter-clockwise, seen from above
    const n = pts.length, side = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
      side.push([dy / len, -dx / len, 0]);
    }
    const every = n <= 16 ? 1 : Math.ceil(n / 8), edges = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      edges.push({ a: [p[0], p[1], z0], b: [q[0], q[1], z0], n: [side[i], [0, 0, -1]] });
      edges.push({ a: [p[0], p[1], z1], b: [q[0], q[1], z1], n: [side[i], [0, 0, 1]] });
      if (i % every === 0) edges.push({ a: [p[0], p[1], z0], b: [p[0], p[1], z1], n: [side[(i - 1 + n) % n], side[i]] });
    }
    return edges;
  }
  /* A toolhead: body, the coupling plate the dock seats into, the nozzle. */
  function headSolid(x, y, zTip) {
    const { w, d, h, cone } = WF.HEAD, hw = w / 2, hd = d / 2, base = zTip + cone;
    const edges = boxSolid(x - hw, y - hd, base, x + hw, y + hd, base + h)
      .concat(boxSolid(x - hw + 7, y - hd + 7, base + h, x + hw - 7, y + hd - 7, base + h + 5));
    const c = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
    c.forEach(([dx, dy], i) => {
      const [ex, ey] = c[(i + 1) % 4];
      edges.push({ a: [x, y, zTip], b: [x + dx, y + dy, base] }, { a: [x + dx, y + dy, base], b: [x + ex, y + ey, base] });
    });
    return edges;
  }
  function dockX(i, n) { return WF.BED * (i + 0.5) / n; }

  /* ---- projection: orthographic, turned by yaw, tipped by pitch ---- */
  function projector() {
    const yaw = twin.yaw * Math.PI / 180, pitch = twin.pitch * Math.PI / 180;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const C = [135, 165, 150];
    const raw = (x, y, z) => {
      const px = x - C[0], py = y - C[1], pz = z - C[2];
      const x1 = px * cy - py * sy, y1 = px * sy + py * cy;
      return [x1, -(pz * cp + y1 * sp)];
    };
    // Fit the machine (build volume, rails, docks, balloons) to the sheet,
    // leaving the bottom strip for the title block.
    const pts = [], O = WF.OUTER;
    if (twin.outer) { for (const x of [O.x0 - 20, O.x1 + 20]) for (const y of [O.y0 - 10, O.y1 + 10]) for (const z of [O.z0, O.z1]) pts.push(raw(x, y, z)); }
    else for (const x of [-26, 296]) for (const y of [-22, 346]) for (const z of [0, WF.TOP + 104]) pts.push(raw(x, y, z));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    // Front and top views carry an X dimension under the drawing.
    const padX = 22, padTop = 18, padBottom = twin.view === 'front' || twin.view === 'top' ? 70 : 46;
    const s = twin.zoom * Math.min((twin.w - 2 * padX) / (Math.max(...xs) - Math.min(...xs)),
      (twin.h - padTop - padBottom) / (Math.max(...ys) - Math.min(...ys)));
    const ox = twin.w / 2 - s * (Math.max(...xs) + Math.min(...xs)) / 2 + twin.panX;
    const oy = padTop + (twin.h - padTop - padBottom) / 2 - s * (Math.max(...ys) + Math.min(...ys)) / 2 + twin.panY;
    // Snap to the half pixel, so 1 px lines land on whole device pixels.
    const snap = v => Math.round(v - 0.5) + 0.5;
    const P = (x, y, z) => { const r = raw(x, y, z); return [snap(ox + s * r[0]), snap(oy + s * r[1])]; };
    // Toward the viewer, in printer coordinates: a face whose outward
    // normal points this way is seen.
    const eye = [-sy * cp, -cy * cp, sp];
    const facing = n => n[0] * eye[0] + n[1] * eye[1] + n[2] * eye[2] > 1e-6;
    return { P, s, facing };
  }

  /* Split a solid's edges into seen and hidden. */
  function sortEdges(edges, facing, seen, hidden) {
    for (const e of edges) {
      const out = !e.n || facing(e.n[0]) || facing(e.n[1]);
      (out ? seen : hidden).push(e);
    }
  }
  function pathOf(edges, P) {
    let d = '';
    for (const e of edges) {
      const a = P(...e.a), b = P(...e.b);
      if (a[0] === b[0] && a[1] === b[1]) continue;
      d += `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
    }
    return d;
  }
  function setPath(key, d) {
    const p = twin.paths[key];
    if (p && p.getAttribute('d') !== d) p.setAttribute('d', d);
  }
  /* The outline (convex hull) of some projected points: a click target. */
  function hull(points) {
    const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
    for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
    return lower.slice(0, -1).concat(upper.slice(0, -1)).map(q => q.join(',')).join(' ');
  }
  const hullOf = (edges, P) => hull(edges.flatMap(e => [P(...e.a), P(...e.b)]));

  /* Set attributes (and text) only when they change. */
  function attrs(el, values) {
    if (!el) return;
    for (const [k, v] of Object.entries(values)) {
      if (k === 'text') { if (el.textContent !== v) el.textContent = v; }
      else if (el.getAttribute(k) !== String(v)) el.setAttribute(k, v);
    }
  }

  function drawTwin(measure) {
    const svg = $('wf-svg');
    if (!svg || !twin.state) return;
    if (measure || !twin.w) {
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return;              // a hidden tab: drawn when it is shown
      twin.w = Math.round(r.width); twin.h = Math.round(r.height);
      svg.setAttribute('viewBox', `0 0 ${twin.w} ${twin.h}`);
    }
    twin.drawnAt = performance.now();
    const st = twin.state, [x, y, z] = twin.pos, T = WF.TOP, B = WF.BED;
    const { P, s, facing } = projector();
    const bedZ = T - Math.max(0, Math.min(B, z));
    const heads = Object.entries(st.toolheads || {});
    const active = st.toolheads && st.toolheads[st.active_toolhead] ? st.active_toolhead : null;
    const pick = twin.pick || '';
    const out = Object.fromEntries(BUCKETS.map(k => [k, []]));
    const hits = [];

    // Build volume (phantom line), the frame's top rails and rear beam.
    out.env = boxSolid(0, 0, 0, B, B, T);
    if (twin.outer) { const O = WF.OUTER; out.env.push(...boxSolid(O.x0, O.y0, O.z0, O.x1, O.y1, O.z1)); }
    const rz = T + WF.HEAD.cone + WF.HEAD.h * 0.7, by = WF.DOCK_Y, bz = T + WF.HEAD.cone;
    out.frame.push(
      { a: [-24, -20, rz], b: [-24, by + 34, rz] }, { a: [294, -20, rz], b: [294, by + 34, rz] },
      { a: [-24, -20, rz], b: [294, -20, rz] },
      { a: [-24, y - 5, rz], b: [294, y - 5, rz] }, { a: [-24, y + 5, rz], b: [294, y + 5, rz] });
    sortEdges(boxSolid(-24, by + 26, bz + 10, 294, by + 34, bz + 22), facing, out.frame, out.hid);

    // The bed plate at its height, with a 45 mm grid on its surface.
    const bedEdges = boxSolid(-6, -6, bedZ - 9, B + 6, B + 6, bedZ);
    sortEdges(bedEdges, facing, pick === 'bed' ? out.sel : out.vis, pick === 'bed' ? out['sel-hid'] : out.hid);
    if (facing([0, 0, 1])) for (let g = 45; g < B; g += 45) out.grid.push({ a: [g, 0, bedZ], b: [g, B, bedZ] }, { a: [0, g, bedZ], b: [B, g, bedZ] });
    hits.push(['bed', hullOf(bedEdges, P), 'The bed']);

    // The parts: each object's outline, from the bed to the nozzle.
    const printing = ['printing', 'paused'].includes(st.state);
    const plate = st.objects && Array.isArray(st.objects.list) ? st.objects : null;
    if (plate && printing) {
      const excluded = new Set(plate.excluded || []);
      for (const o of plate.list) {
        const poly = Array.isArray(o.polygon) && o.polygon.length >= 3 ? o.polygon : null;
        if (!poly) continue;
        const skipped = excluded.has(o.name);
        const edges = prismSolid(poly, bedZ, skipped ? bedZ + Math.min(z, 2) : T);
        const id = `obj:${o.name}`;
        if (pick === id) sortEdges(edges, facing, out.sel, out['sel-hid']);
        else if (skipped) out.skip.push(...edges);
        else sortEdges(edges, facing, out.part, out['part-hid']);
        if (skipped) {
          const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
          const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), zt = bedZ + Math.min(z, 2);
          out.skip.push({ a: [x0, y0, zt], b: [x1, y1, zt] }, { a: [x0, y1, zt], b: [x1, y0, zt] });
        }
        hits.push([id, hullOf(edges, P), o.name]);
      }
    }

    // Where the nozzle has just been, on the layer it is printing.
    if (twin.trail.length > 1 && printing) {
      for (let i = 1; i < twin.trail.length; i++) {
        out.trail.push({ a: [twin.trail[i - 1][0], twin.trail[i - 1][1], T], b: [twin.trail[i][0], twin.trail[i][1], T] });
      }
    }

    // Docks on the rear beam; a parked head sits in its dock.
    heads.forEach(([name, d], i) => {
      const dx = dockX(i, heads.length);
      out.frame.push({ a: [dx - 27, by + 26, bz], b: [dx - 27, by + 26, bz + 46] }, { a: [dx + 27, by + 26, bz], b: [dx + 27, by + 26, bz + 46] },
        { a: [dx - 27, by + 26, bz], b: [dx - 27, by + 10, bz] }, { a: [dx + 27, by + 26, bz], b: [dx + 27, by + 26 - 16, bz] });
      if (name === active) return;
      const edges = headSolid(dx, by, T), id = `head:${name}`;
      const seen = pick === id ? out.sel : (d.status === 'error' ? out.fault : out.vis);
      sortEdges(edges, facing, seen, pick === id ? out['sel-hid'] : out.hid);
      hits.push([id, hullOf(edges, P), name]);
    });
    // The head on the carriage (or the empty carriage).
    const onHit = $('wf-hit-on');
    if (active) {
      const edges = headSolid(x, y, T), id = `head:${active}`;
      sortEdges(edges, facing, pick === id ? out.sel : out.head, pick === id ? out['sel-hid'] : out.hid);
      attrs(onHit, { points: hullOf(edges, P), 'data-pick': id, style: '' });
      if (onHit.firstChild.textContent !== active) onHit.firstChild.textContent = active;
    } else {
      attrs(onHit, { points: '', style: 'display:none' });
      sortEdges(boxSolid(x - 20, y - 12, rz - 6, x + 20, y + 12, rz + 6), facing, out.vis, out.hid);
    }

    // A small axis mark at the bed's origin corner.
    const o = [0, 0, bedZ];
    out.axis.push({ a: o, b: [24, 0, bedZ] }, { a: o, b: [0, 24, bedZ] }, { a: o, b: [0, 0, bedZ + 24] });

    for (const k of BUCKETS) if (k !== 'dim') setPath(k, pathOf(out[k], P));
    drawDims(P, { x, y, z, bedZ });
    setHTML($('wf-hits'), hits.map(([id, pts, title]) =>
      `<polygon data-pick="${esc(id)}" points="${pts}"><title>${esc(title)}</title></polygon>`).join(''));
    drawTags(P, { x, y, z, heads, active, s });
  }

  /* Dimensions, drawn the drafting way: extension lines with a gap at the
   * part, a thin dimension line with filled arrowheads, the figure upright
   * (unidirectional) beside it. Z in 3D; X and Z from the front; X and Y
   * from the top. */
  function drawDims(P, { x, y, z, bedZ }) {
    const T = WF.TOP, B = WF.BED, v = twin.view, dims = [];
    const dim = (a, b, off, label) => {
      const pa = P(...a), pb = P(...b);
      const da = P(a[0] + off[0], a[1] + off[1], a[2] + off[2]), db = P(b[0] + off[0], b[1] + off[1], b[2] + off[2]);
      const len = Math.hypot(db[0] - da[0], db[1] - da[1]);
      const ext = (p, d) => {
        const ux = d[0] - p[0], uy = d[1] - p[1], l = Math.hypot(ux, uy) || 1;
        return `M${(p[0] + ux / l * 3).toFixed(1)} ${(p[1] + uy / l * 3).toFixed(1)}L${(d[0] + ux / l * 4).toFixed(1)} ${(d[1] + uy / l * 4).toFixed(1)}`;
      };
      const mx = (da[0] + db[0]) / 2, my = (da[1] + db[1]) / 2;
      dims.push(`<path class="wf-ext" d="${ext(pa, da)}${ext(pb, db)}"/>`);
      if (len >= 22) dims.push(`<path class="wf-dimline" d="M${da[0]} ${da[1]}L${db[0]} ${db[1]}" marker-start="url(#wf-arrow)" marker-end="url(#wf-arrow)"/>`);
      const horiz = Math.abs(db[0] - da[0]) > Math.abs(db[1] - da[1]);
      dims.push(`<text class="wf-dimtext" x="${(mx + (horiz ? 0 : 7)).toFixed(1)}" y="${(my + (horiz ? -5 : 3.5)).toFixed(1)}" text-anchor="${horiz ? 'middle' : 'start'}">${label}</text>`);
    };
    const nb = ' ';
    if (v !== 'top') dim([B + 6, 0, bedZ], [B + 6, 0, T], [26, 0, 0], `Z${nb}${z.toFixed(2)}`);
    if (v === 'front') dim([0, 0, 0], [x, 0, 0], [0, 0, -22], `X${nb}${x.toFixed(1)}`);
    if (v === 'top') dim([0, -6, T], [x, -6, T], [0, -30, 0], `X${nb}${x.toFixed(1)}`);
    if (v === 'top') dim([0, 0, T], [0, y, T], [-34, 0, 0], `Y${nb}${y.toFixed(1)}`);
    // The machine's outer size (Snapmaker's published figures).
    if (twin.outer) {
      const O = WF.OUTER;
      if (v === 'front') { dim([O.x0, O.y0, O.z0], [O.x1, O.y0, O.z0], [0, 0, -40], `584${nb}mm`); dim([O.x0, O.y0, O.z0], [O.x0, O.y0, O.z1], [-40, 0, 0], `730${nb}mm`); }
      if (v === 'top') { dim([O.x0, O.y0, O.z1], [O.x1, O.y0, O.z1], [0, -40, 0], `584${nb}mm`); dim([O.x1, O.y0, O.z1], [O.x1, O.y1, O.z1], [40, 0, 0], `499${nb}mm`); }
    }
    setHTML($('wf-dims'), dims.join(''));
  }

  /* Balloons name the toolheads, the drafting way: a circle with the
   * item's name, a leader to the part, a swatch of its filament. Then the
   * sheet's border and title block. */
  function drawTags(P, { x, y, z, heads, active, s }) {
    const st = twin.state, T = WF.TOP, nb = ' ', pick = twin.pick || '';
    const tags = [];
    // Close together (a phone, or the docks seen end-on), each filament
    // swatch moves under its balloon instead of beside it.
    const spots = heads.map((_, i) => P(dockX(i, heads.length), WF.DOCK_Y + 30, T + WF.HEAD.cone + 70));
    const crowded = spots.some((p, i) => i && Math.hypot(p[0] - spots[i - 1][0], p[1] - spots[i - 1][1]) < 40);
    const balloon = (cx, cy, name, d, cls) => {
      const id = `head:${name}`, on = pick === id ? ' is-picked' : '';
      const sx = crowded ? cx - 3.5 : cx + 12.5, sy = crowded ? cy + 12.5 : cy - 3.5;
      return `<g class="wf-balloon ${cls}${on}" data-pick="${esc(id)}">` +
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="10.5"/>` +
        `<text x="${cx.toFixed(1)}" y="${(cy + 3.5).toFixed(1)}" text-anchor="middle">${esc(name)}</text>` +
        `<rect class="wf-swatch" x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="7" height="7" style="fill:${esc(d.filament_color_hex || '#ffffff')}"/></g>`;
    };
    heads.forEach(([name, d], i) => {
      const p = spots[i];
      const cls = d.status === 'error' ? 'fault' : (name === active ? 'out' : '');
      tags.push(balloon(p[0], p[1] - 4, name, d, cls));
      const hot = d.target_temperature > 0 || d.temperature >= 50;
      const note = d.status === 'error' ? 'FAULT' : (hot && name !== active ? `${Math.round(d.temperature)}°` : '');
      if (note) tags.push(`<text class="wf-note ${cls}" x="${p[0].toFixed(1)}" y="${(p[1] - 19).toFixed(1)}" text-anchor="middle">${note}</text>`);
    });
    setHTML($('wf-tags'), tags.join(''));
    // The head on the carriage moves every frame, so its leader, balloon
    // and figure are kept as elements and updated in place: rebuilt each
    // frame, a click could land on one just as it was replaced. The leader
    // runs from the nozzle tip down and to the left (the Z dimension owns
    // the right).
    const tip = P(x, y, T);
    attrs($('wf-tip'), { cx: tip[0], cy: tip[1] });
    const d = active ? st.toolheads[active] : null, hide = d ? '' : 'display:none';
    const right = tip[0] < twin.w * 0.3;
    const bx = tip[0] + (right ? 36 : -36), byy = Math.min(twin.h - 62, tip[1] + 30);
    attrs($('wf-on-leader'), { d: `M${tip[0]} ${tip[1]}L${(bx + (right ? -10.5 : 10.5)).toFixed(1)} ${byy.toFixed(1)}`, style: hide });
    const g = $('wf-on-balloon');
    attrs(g, { style: hide, class: `wf-balloon on${active && pick === `head:${active}` ? ' is-picked' : ''}`, 'data-pick': active ? `head:${active}` : '' });
    attrs(g.children[0], { cx: bx.toFixed(1), cy: byy.toFixed(1) });
    attrs(g.children[1], { x: bx.toFixed(1), y: (byy + 3.5).toFixed(1), text: active || '' });
    attrs(g.children[2], { x: (bx + 12.5).toFixed(1), y: (byy - 3.5).toFixed(1), style: `fill:${d ? (d.filament_color_hex || '#ffffff') : '#ffffff'}` });
    attrs($('wf-on-temp'), {
      x: (bx + (right ? 24 : -14)).toFixed(1), y: (byy + 3.5).toFixed(1), 'text-anchor': right ? 'start' : 'end',
      text: d && d.temperature >= 50 ? `${Math.round(d.temperature)}°` : '',
    });

    // Sheet: a border, and a title block in the bottom-right corner.
    const layer = st.layer || { current: 0, total: 0 };
    const scale = Math.max(1, Math.round(WF.PX_PER_MM / s));
    const cells = [
      ['Printer', st.printer_name || 'Printer'], ['View', twin.view ? WF.VIEW_WORD[twin.view] : 'Turned'],
      ['Scale', `1:${scale}`], ['Layer', layer.total ? `${layer.current}/${layer.total}` : '-'],
    ];
    const W = twin.w, H = twin.h, bw = Math.min(W - 16, 300), bh = 30, bx0 = W - 8 - bw, by0 = H - 8 - bh;
    const cw = [0.34, 0.2, 0.2, 0.26].map(f => f * bw);
    let cx = bx0, cellSvg = '';
    cells.forEach(([k, val], i) => {
      cellSvg += `<text class="wf-tb-k" x="${(cx + 5).toFixed(1)}" y="${by0 + 11}">${k}</text>` +
        `<text class="wf-tb-v" x="${(cx + 5).toFixed(1)}" y="${by0 + 24}">${esc(String(val)).slice(0, 26)}</text>`;
      cx += cw[i];
      if (i < 3) cellSvg += `<path class="wf-tb-line" d="M${Math.round(cx) + 0.5} ${by0}V${by0 + bh}"/>`;
    });
    setHTML($('wf-sheet'), `<rect class="wf-border" x="3.5" y="3.5" width="${W - 7}" height="${H - 7}"/>` +
      `<rect class="wf-tb" x="${bx0 + 0.5}" y="${by0 + 0.5}" width="${bw}" height="${bh}"/>${cellSvg}`);

    renderChips();

    // A sentence for screen readers, changed only when its words change.
    const skipped = st.objects && Array.isArray(st.objects.excluded) ? st.objects.excluded.length : 0;
    const parkedNames = heads.filter(([n]) => n !== active).map(([n, d]) => d.status === 'error' ? `${n} (fault)` : n);
    const label = `Line drawing of ${st.printer_name || 'the printer'}, ${(STATE_WORD[st.state] || st.state).toLowerCase()}. ` +
      (active ? `${active} is on the carriage at X ${Math.round(x)}, Y ${Math.round(y)}, Z ${z.toFixed(1)} millimetres. ` : 'No toolhead is picked up. ') +
      (parkedNames.length ? `Parked in the rear docks: ${parkedNames.join(', ')}. ` : '') +
      (skipped ? `${skipped} object${skipped === 1 ? '' : 's'} skipped. ` : '') +
      'Drag, or use the arrow keys, to turn it; pick a part for its details.';
    if (label !== twin.label) { twin.label = label; $('wf-svg').setAttribute('aria-label', label); }
  }

  /* The buttons under the twin (the keyboard and screen-reader way to
   * pick), and the details of whatever is picked. Shared by both modes. */
  function renderChips() {
    const st = twin.state, pick = twin.pick || '';
    if (!st || !$('wf-picks')) return;
    const heads = Object.entries(st.toolheads || {});
    setHTML($('wf-picks'), heads.map(([n, d]) => `<button type="button" class="wf-pick${pick === `head:${n}` ? ' is-on' : ''}${d.status === 'error' ? ' is-fault' : ''}"
      data-pick="head:${esc(n)}" aria-pressed="${pick === `head:${n}`}"><i style="background:${esc(d.filament_color_hex || '#ffffff')}"></i>${esc(n)}</button>`).join('') +
      `<button type="button" class="wf-pick${pick === 'bed' ? ' is-on' : ''}" data-pick="bed" aria-pressed="${pick === 'bed'}">Bed</button>`);
    renderPick();
  }

  /* ---- picking a part ---------------------------------------------- */
  function choose(id) {
    twin.pick = id || null;
    if (twin.model) twin.model.select(twin.pick);
    if (id && id.startsWith('head:') && Date.now() - twin.jobAt > 10000) {
      twin.jobAt = Date.now();
      getJSON(api('/api/printer/job')).then(j => { twin.job = j && !j.error ? j : null; renderPick(); }).catch(() => {});
    }
    queueTwin();
  }

  function renderPick() {
    const box = $('wf-detail'), st = twin.state;
    if (!box || !st) return;
    const id = twin.pick || '';
    let html = '';
    const row = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    const deg = v => (typeof v === 'number' ? `${Math.round(v)}°C` : '—');
    if (id.startsWith('head:')) {
      const name = id.slice(5), d = (st.toolheads || {})[name];
      if (!d) { twin.pick = null; box.hidden = true; return; }
      const where = d.status === 'error' ? 'Fault at its dock' : name === st.active_toolhead ? 'On the carriage' : 'Parked in its dock';
      const swaps = d.swaps == null ? 'not reported by this printer'
        : `${d.swaps.toLocaleString()}${d.swap_retries != null ? ` · ${d.swap_retries} retried` : ''}${d.swap_errors != null ? ` · ${d.swap_errors} failed` : ''}`;
      const needs = ((twin.job && twin.job.required_filament) || []).filter(r => r.toolhead === name);
      const job = !st.current_file ? 'No print running'
        : needs.length ? needs.map(r => `${esc(r.expected_color_name || 'a colour')} ${esc(r.expected_material || '')}`.trim()).join(', ')
        : twin.job ? 'Not used by this print' : 'Checking…';
      html = `<div class="wf-detail-head"><span class="wf-detail-swatch" style="background:${esc(d.filament_color_hex || '#ffffff')}"></span>
          <b>${esc(name)}</b><span class="wf-detail-sub">${where}</span>
          <button type="button" class="wf-x" data-act="close" aria-label="Close details">✕</button></div>
        <dl class="wf-facts">
          ${row('Filament', d.filament_loaded === false ? 'None loaded' : esc(d.filament_color_name || 'Unknown'))}
          ${row('Temperature', `${deg(d.temperature)}${d.target_temperature ? ` → ${deg(d.target_temperature)}` : ''}`)}
          ${row('Nozzle', d.nozzle_diameter ? `${d.nozzle_diameter} mm` : 'not reported by this printer')}
          ${row('Swaps', swaps)}
          ${row('This print', job)}
        </dl>
        <div class="wf-actions"><button type="button" class="btn small" data-act="control">Open printer</button></div>`;
    } else if (id.startsWith('obj:')) {
      const name = id.slice(4), plate = st.objects || {}, o = (plate.list || []).find(v => v.name === name);
      if (!o) { twin.pick = null; box.hidden = true; return; }
      const skipped = (plate.excluded || []).includes(name);
      const xs = (o.polygon || []).map(p => p[0]), ys = (o.polygon || []).map(p => p[1]);
      const size = xs.length ? `${(Math.max(...xs) - Math.min(...xs)).toFixed(1)} × ${(Math.max(...ys) - Math.min(...ys)).toFixed(1)} mm` : '—';
      // Klipper upper-cases names; show them the way a person would write them.
      const plain = name.replace(/_ID_(\d+)_COPY_(\d+)$/i, '').replace(/\.(STL|3MF|STEP|OBJ)$/i, '').replace(/_/g, ' ').toLowerCase().trim();
      const copy = name.match(/_ID_(\d+)_COPY_\d+$/i);
      const shown = `${plain ? plain[0].toUpperCase() + plain.slice(1) : name}${copy ? ` #${+copy[1] + 1}` : ''}`;
      html = `<div class="wf-detail-head"><b>${esc(shown)}</b><span class="wf-detail-sub">${skipped ? 'Skipped' : name === plate.current ? 'Printing now' : 'Waiting'}</span>
          <button type="button" class="wf-x" data-act="close" aria-label="Close details">✕</button></div>
        <dl class="wf-facts">${row('Footprint', size)}${row('Height so far', skipped ? '—' : `${twin.pos[2].toFixed(2)} mm`)}</dl>
        ${skipped ? '' : `<div class="wf-actions"><button type="button" class="btn small" data-act="skip" data-name="${esc(name)}">Skip it in Control…</button></div>`}`;
    } else if (id === 'bed') {
      html = `<div class="wf-detail-head"><b>Bed</b><span class="wf-detail-sub">${WF.BED} × ${WF.BED} mm</span>
          <button type="button" class="wf-x" data-act="close" aria-label="Close details">✕</button></div>
        <dl class="wf-facts">${row('Temperature', `${deg(st.bed_temperature)}${st.bed_target ? ` → ${deg(st.bed_target)}` : ''}`)}
          ${row('Below the nozzle', `${twin.pos[2].toFixed(2)} mm`)}${row('Chamber', deg(st.chamber_temperature))}</dl>
        <div class="wf-actions"><button type="button" class="btn small" data-act="control">Open printer</button></div>`;
    }
    if (box.hidden !== !html) box.hidden = !html;
    setHTML(box, html);
  }

  function renderTwin(state) {
    const host = $('twin-host');
    if (!host) return;
    const views = $('wf-views');
    if (!state) {
      const away = unreachablePrinter();
      setText($('twin-sub'), away ? unreachableWords(away)[0] : 'Waiting for a printer connection');
      host.innerHTML = demoNeeded('the digital twin'); twin.built = false; twin.state = null; twin.pick = null; twin.model = null; twin.printKey = null;
      if (views) views.hidden = true;
      if ($('twin-modes')) $('twin-modes').hidden = true;
      return;
    }
    if (views && views.hidden) views.hidden = false;
    if ($('twin-modes') && $('twin-modes').hidden) $('twin-modes').hidden = false;
    if (!twin.built) buildTwin();
    if (twin.state && twin.state.printer_id !== state.printer_id) { twin.pick = null; twin.job = null; twin.jobAt = 0; twin.held = null; }
    if (twin.state && twin.state.current_file !== state.current_file) { twin.job = null; twin.jobAt = 0; }
    twin.state = state;
    if (twin.model) syncTwinPrint(state);
    const [x, y, z] = state.toolhead_position || [135, 135, 0];
    const [dx, dy, dz] = drawnPosition(state, [x, y, z]);
    // A new layer (or no print running) starts a fresh trail.
    if (twin.trailZ === null || Math.abs(z - twin.trailZ) > 0.05 || state.state !== 'printing') { twin.trail = []; twin.trailZ = z; }
    tween('twin-head', [dx, dy, dz], (pos) => {
      twin.pos = pos;
      if (twin.state && twin.state.state === 'printing') {
        const last = twin.trail[twin.trail.length - 1];
        if (!last || Math.hypot(pos[0] - last[0], pos[1] - last[1]) > 0.6) twin.trail.push([pos[0], pos[1]]);
        if (twin.trail.length > 90) twin.trail.shift();
      }
      queueTwin();
    }, true);
    queueTwin();
    // The twin is a U1. Any other printer gets what it said about itself instead of the wrong machine.
    const m = state.machine, other = !!(m && !m.reference);
    $('twin-card').classList.toggle('is-other-printer', other);
    $('twin-other').hidden = !other;
    if (other) paint($('twin-other'), `<p class="twin-other-kind">${esc(m.label)}</p>
      <dl><dt>Heads</dt><dd>${esc(m.heads)}</dd><dt>Nozzle</dt><dd>${m.nozzle_mm ? esc(m.nozzle_mm) + ' mm' : 'not reported'}</dd>
      <dt>Position</dt><dd>X ${esc(twin.pos ? twin.pos[0].toFixed(1) : '…')} · Y ${esc(twin.pos ? twin.pos[1].toFixed(1) : '…')} · Z ${esc(twin.pos ? twin.pos[2].toFixed(2) : '…')} mm</dd></dl>
      <p class="field-hint">The 3D twin models the Snapmaker U1 only, so it isn't drawn for this printer. ${esc(m.note || '')}</p>`);
    const active = state.toolheads && state.toolheads[state.active_toolhead] ? state.active_toolhead : null;
    setVar($('twin-card'), '--glass-tint', active ? state.toolheads[active].filament_color_hex : '#9aa3b5');
    const layer = state.layer || { current: 0, total: 0 };
    // Non-breaking spaces inside each reading, so a narrow card wraps
    // between readings ("Z 33.20 mm") and never inside one.
    const nb = ' ';
    setText($('twin-readout'), `X${nb}${x.toFixed(1)} · Y${nb}${y.toFixed(1)} · Z${nb}${z.toFixed(2)}${nb}mm` +
      (active ? ` · ${active}${nb}active` : '') + (layer.total ? ` · layer${nb}${layer.current}/${layer.total}` : ''));
    // A real printer that hasn't homed doesn't know where its head is, and a dropped link
    // means the drawing shows the last reading: both said in words, never drawn as live.
    const unhomed = typeof state.homed_axes === 'string' && state.homed_axes.length < 3;
    setText($('twin-sub'), `${state.printer_name || 'Printer'} · ${STATE_WORD[state.state] || state.state}` +
      (state.link_lost ? ' · no live link, last reading shown' : unhomed ? ' · not homed, position unknown' : ''));
  }

  /* Where the twin draws the head. While an axis homes, Klipper reports a
   * position it has made up for that axis (homing sets one before the move),
   * so a homing head was drawn flying out of the machine. An axis that isn't
   * homed holds where it was last drawn, and every axis stays inside the
   * printer's reported limits; once homed, the spring glides it to the real
   * place. The readout under the twin still shows the printer's own numbers. */
  function drawnPosition(state, raw) {
    const m = state.machine || {};
    const lo = Array.isArray(m.min_mm) && m.min_mm.length === 3 ? m.min_mm : [0, 0, 0];
    const hi = Array.isArray(m.max_mm) && m.max_mm.length === 3 ? m.max_mm : [270, 270, 270];
    const homed = typeof state.homed_axes === 'string' ? state.homed_axes : 'xyz';
    const held = twin.held || (twin.held = [null, null, null]);
    return raw.map((v, i) => {
      const ok = homed.includes('xyz'[i]) && Number.isFinite(v);
      if (ok) held[i] = Math.min(hi[i], Math.max(lo[i], v));
      else if (held[i] == null) held[i] = i === 2 ? hi[i] / 2 : (lo[i] + hi[i]) / 2;
      return held[i];
    });
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
      setText($('g-score'), Math.round(v));
    });
    host.setAttribute('aria-label', `Print health ${data.score} out of 100, ${data.band}`);
    $('g-band').textContent = { good: 'Good', fair: 'Fair', poor: 'Needs attention' }[data.band];
    $('g-deductions').innerHTML = (data.deductions || []).length
      ? data.deductions.map(d => `<li><b>${d.points}</b> ${esc(d.reason)}</li>`).join('')
      : '<li class="ok">Nothing is pulling the score down.</li>';
  }

  /* Chamber climate: a read-only reading, where Klipper reports one. */
  let chamberHistory = [];
  // The first 5 seconds of a recording are left out: right after the link to the
  // printer opens, the first readings can be off and pulled the graph out of shape.
  const SETTLE_S = 5;
  const pageStart = Date.now() / 1000;
  const settled = list => list.length ? list.filter(s => s.t >= list[0].t + SETTLE_S) : list;
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
    chamberHistory = settled(data.history.map(s => ({ t: s.t, c: s.chamber, b: s.bed }))
      .filter(s => s.c != null && isFinite(s.c)));
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
    tween('chamber', state.chamber_temperature, (v) => setText(val, formatTemp(v)));
    const last = chamberHistory[chamberHistory.length - 1];
    const now = Date.now() / 1000;
    if (now - pageStart < SETTLE_S && !last) return;
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
    // Say how much the line actually covers: right after opening the page
    // it holds a few minutes, not the 30 the window grows to.
    const mins = Math.round((t1 - t0) / 60);
    $('ch-sub').textContent = mins >= 29 ? 'Last 30 minutes'
      : mins < 1 ? 'Recording: the line fills in over 30 minutes'
      : `Last ${mins} min · fills in to 30`;
  }

  /* ================================================================
   * 5. the live print pill
   * ================================================================ */

  /* The status ribbon at the top of the page already carries the print's
   * progress, so the floating pill only appears once the ribbon has been
   * scrolled out of view - otherwise the two say the same thing and the
   * pill sits on top of whatever is in the bottom-right corner. */
  if ('IntersectionObserver' in window && $('printer-chip')) {
    new IntersectionObserver(([entry]) => document.body.classList.toggle('ribbon-in-view', entry.isIntersecting))
      .observe($('printer-chip'));
  }

  function renderPill(state) {
    const pill = $('live-pill');
    const show = ['printing', 'paused', 'complete'].includes(state.state);
    if (pill.hidden !== !show) pill.hidden = !show;
    if (!show) return;
    const pct = Math.round(state.progress * 100);
    const left = hoursLeft(state);
    const active = state.active_toolhead;
    const head = active && state.toolheads ? state.toolheads[active] : null;
    setVar(pill, '--glass-tint', (head && head.filament_color_hex) || STATE_HEX[state.state]);
    if (pill.dataset.state !== state.state) pill.dataset.state = state.state;
    const title = `${state.printer_name ? state.printer_name + ' · ' : ''}${state.state === 'complete' ? 'Done' : pct + '%'}`;
    const sub = state.state === 'paused' ? `Paused: ${state.current_file || ''}` :
      state.state === 'complete' ? `${state.current_file || ''} finished`
      : left != null ? `${fmtHours(left)} left · done ${doneAt(left)}` : (state.current_file || '');
    setText($('lp-title'), title);
    setText($('lp-sub'), sub);
    if (pill.title !== (state.current_file || '')) pill.title = state.current_file || '';
    const c = 2 * Math.PI * 15.5;
    tween('pill', state.progress, (v) => {
      $('lp-fill').style.strokeDashoffset = `${c * (1 - v)}`;
      $('qa-status-fill').style.transform = `scaleX(${v})`;
    });
    setVar($('lp-fill'), 'stroke-dasharray', String(c));
    const label = `${state.printer_name || 'Printer'}: ${STATE_WORD[state.state]}, ${pct} percent` +
      `${state.current_file ? `, ${state.current_file}` : ''}${left != null ? `, done about ${doneAt(left)}` : ''}. Open printer control.`;
    if (pill.getAttribute('aria-label') !== label) {
      pill.setAttribute('aria-label', label);
      $('qa-status').setAttribute('aria-label', label);
    }
    // The phone dock's status line carries the same reading.
    setText($('qa-status-text'), `${title} · ${sub}`);
  }

  /* ================================================================
   * 6. files
   * ================================================================ */

  const files = { list: [], local: [], viewer: null, open: null, analysis: null, lines: { offset: 0, q: '' }, selectedLine: null };

  /* Without the server there's no library, but a file from this device can
   * still be looked at: it's read here, in the browser, and never sent
   * anywhere. The same 64 MB limit as the library (file_library.MAX_BYTES). */
  const LOCAL_MAX_BYTES = 64 * 1024 * 1024;
  const kindOf = (name) => /\.obj$/i.test(name) ? 'obj' : /\.stl$/i.test(name) ? 'stl' : /\.3mf$/i.test(name) ? '3mf' : /\.(gcode|gco|g)$/i.test(name) ? 'gcode' : null;

  function renderLocalFiles() {
    const grid = $('file-grid');
    files.list = files.local;
    $('file-recent').innerHTML = '';
    const label = qs('.file-upload');
    if (label && label.firstChild.nodeType === 3) label.firstChild.textContent = 'Open a file ';
    grid.innerHTML = `<p class="log-empty file-local-note">Files open here, in your browser only - nothing is uploaded. Keeping a library,
        the pre-flight check, edits, converting and printing need the Deja Vu1 server.</p>` +
      (files.local.length ? files.local.map(f => `<button class="file-card" type="button" data-open-file="${esc(f.name)}">
          <span class="fcd-thumb"><span class="fcd-kind">${esc(f.kind.toUpperCase())}</span></span>
          <span class="fcd-name">${escName(f.name)}</span>
          <span class="fcd-meta">${f.local.size < 1048576 ? `${Math.max(1, Math.round(f.local.size / 1024))} KB` : `${(f.local.size / 1048576).toFixed(1)} MB`}</span>
          <span class="fcd-tags"><span class="kind-tag">${esc(f.kind.toUpperCase())}</span><span class="origin-tag">on this device</span></span>
        </button>`).join('')
        : empty('No file open', 'Choose a G-code, STL, OBJ or 3MF file from this device to see it in 3D.'));
    qsa('[data-open-file]').forEach(b => b.onclick = () => openFile(b.dataset.openFile, b));
  }

  function openLocalFiles(list) {
    let last = null;
    for (const file of list) {
      const kind = kindOf(file.name);
      if (!kind) { toast(`${file.name} isn't a G-code, STL, OBJ or 3MF file`, 'warn'); continue; }
      if (file.size > LOCAL_MAX_BYTES) { toast(`${file.name} is over 64 MB - too big to open here`, 'warn'); continue; }
      files.local = files.local.filter(f => f.name !== file.name);
      files.local.unshift({ name: file.name, kind, local: file, origin: 'local', note: 'On this device - not uploaded' });
      last = file.name;
    }
    renderLocalFiles();
    if (last) openFile(last);
  }

  async function loadFiles() {
    const grid = $('file-grid');
    if (!grid) return;
    const data = await getJSON('/api/files').catch(() => null);
    if (data && data.server_missing) { renderLocalFiles(); return; }
    if (isModuleDisabled(data)) { grid.innerHTML = moduleDisabledEmpty('Print file library'); $('file-recent').innerHTML = ''; return; }
    files.list = (data && data.files) || [];
    if ($('convert-card')) $('convert-card').hidden = modGate.off.has('converter');
    $('file-recent').innerHTML = data && data.recent && data.recent.length
      ? `<span class="fr-label">Recent</span>${data.recent.map(n => `<button class="chip-btn" data-open-file="${esc(n)}" type="button">${esc(n)}</button>`).join('')}` : '';
    grid.innerHTML = files.list.length ? files.list.map(f => {
      const s = f.summary || {};
      const verdict = s.preflight ? `<span class="pf-badge ${s.preflight}">${{ clear: 'Pre-flight clear', check: 'Check warnings', blocked: 'Blocked' }[s.preflight]}</span>` : '';
      const meta = f.kind === 'gcode'
        ? `${fmtHours(s.estimated_hours)} · ${s.filament_grams != null ? s.filament_grams.toFixed(1) + ' g' : '—'} · ${(s.tools_used || []).join(' ')}`
        : (s.size_mm ? `${s.size_mm.map(v => v.toFixed(0)).join(' × ')} mm · ${(s.triangles || 0).toLocaleString()} triangles` : (s.error || ''));
      return `<button class="file-card" type="button" data-open-file="${esc(f.name)}">
          <span class="fcd-thumb">${s.has_thumbnail ? `<img loading="lazy" alt="" onload="this.classList.toggle('is-tiny', this.naturalWidth <= 64)" src="${tourOn() ? `demo/thumbs/${enc(f.name)}.png` : `/api/files/thumb?name=${enc(f.name)}&v=${enc(f.modified_at || '')}`}">` : `<span class="fcd-kind">${esc(f.kind.toUpperCase())}</span>`}</span>
          <span class="fcd-name">${escName(f.name)}</span>
          <span class="fcd-meta">${esc(meta)}</span>
          <span class="fcd-tags"><span class="kind-tag">${esc(f.kind.toUpperCase())}</span>${verdict}${f.origin && f.origin !== 'upload' ? `<span class="origin-tag">${esc({ converted: 'U1 copy', colours: 'U1 colours', prepared: 'prepared plate' }[f.origin] || f.origin)}</span>` : ''}</span>
        </button>`;
    }).join('') : empty('No files yet', 'Add your own G-code, STL, OBJ or 3MF files, or the sample files to try things out.');
    qsa('[data-open-file]').forEach(b => b.onclick = () => openFile(b.dataset.openFile, b.classList.contains('file-card') ? b : null));
  }

  async function uploadFiles(list) {
    if (serverMissing()) { openLocalFiles(list); return; }
    for (const file of list) {
      const res = await fetch(`/api/files/upload?name=${enc(file.name)}`, { method: 'POST', body: file });
      const body = await res.json().catch(() => ({}));
      toast(res.ok ? `Added ${body.name}` : `Couldn't add ${file.name}: ${body.error || res.status}`, res.ok ? 'ok' : 'bad', 6000);
    }
    loadFiles();
  }

  /* The converter card: upload (or take the sample), open it, convert it, show the report. */
  async function convertFromCard(name, button) {
    await loadFiles();
    if (!files.list.some(f => f.name === name)) { $('cv-note').textContent = `Couldn't find ${name} in the library.`; return; }
    await convertFile(name, button, $('cv-report'));
    $('cv-report').hidden = false;
  }

  function initConverterCard() {
    const card = $('convert-card');
    if (!card) return;
    $('cv-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (typeof tourOn === 'function' && tourOn()) {
        $('cv-note').textContent = 'The online demo converts the sample projects only. Run Deja Vu1 at home to convert your own files.';
        return;
      }
      if (!/\.3mf$/i.test(file.name)) { $('cv-note').textContent = 'Choose a .3mf project file.'; return; }
      $('cv-note').textContent = `Adding ${file.name}…`;
      const res = await fetch(`/api/files/upload?name=${enc(file.name)}`, { method: 'POST', body: file });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { $('cv-note').textContent = `Couldn't add ${file.name}: ${body.error || res.status}`; return; }
      $('cv-note').textContent = `Converting ${body.name}…`;
      await convertFromCard(body.name, $('cv-sample'));
      $('cv-note').textContent = `${body.name}: report below. Open the U1 copy from the report or the library.`;
    });
    $('cv-sample').addEventListener('click', async (e) => {
      const btn = e.currentTarget, name = 'sample_makerworld_three_plates.3mf';
      try {
        if (!files.list.some(f => f.name === name)) await postJSON('/api/files/samples', {});
        $('cv-note').textContent = 'Converting the sample: a 3DBenchy and a gear on plate 1, a vase on plate 2, another Benchy on plate 3…';
        await convertFromCard(name, btn);
        $('cv-note').textContent = 'Sample converted: report below. Open the U1 copy to prepare and slice a plate.';
      } catch (err) { $('cv-note').textContent = err.message; }
    });
  }

  function initFiles() {
    initConverterCard();
    $('file-upload').addEventListener('change', (e) => { uploadFiles([...e.target.files]); e.target.value = ''; });
    $('file-samples').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Adding… (about 15 s the first time)';
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
    window.DVWorkspace?.close();
    if(window.DVPlate?.active){window.DVPlate.active.dispose();window.DVPlate.active=null;}
    if (ar.handle) ar.handle.end();
    $('file-detail').hidden = true;
    files.open = null;
    if (files.viewer) { files.viewer.dispose(); files.viewer = null; }
    reportView();
  }

  async function openFile(name, fromEl) {
    window.DVWorkspace?.close();
    if(window.DVPlate?.active){window.DVPlate.active.dispose();window.DVPlate.active=null;}
    let entry = files.list.find(f => f.name === name);
    if (!entry) { await loadFiles(); entry = files.list.find(f => f.name === name); }      // made elsewhere (studio, slicer)
    if (!entry) return;
    files.open = entry;
    files.lines = { offset: 0, q: '' };
    files.selectedLine = null;
    if (!entry.local) postJSON('/api/files/opened', { name });
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

  /* A G-code file from this device: the toolpath and a few plain facts,
   * read in the browser. No verdict - that's the server's pre-flight. */
  async function openLocalGcode(entry, viewer) {
    let a;
    try {
      const text = await entry.local.text();
      entry.localLines = text.split(/\r?\n/);
      a = DV3D.parseGcode(text);
    } catch (err) {
      $('fd-side').innerHTML = `<p class="log-empty">Couldn't read this file: ${esc(err.message || err)}</p>`;
      return;
    }
    if (files.open !== entry) return;
    if (viewer && a.toolpath.segments.length) {
      const { zmax } = viewer.setToolpath(a.toolpath.segments, a.colours);
      $('fd-view-tools').innerHTML = `
        <label class="vt-layer">Up to <span id="vt-z">${zmax.toFixed(2)}</span> mm
          <input type="range" id="vt-range" min="0" max="${zmax}" step="0.01" value="${zmax}" aria-label="Show layers up to this height">
        </label>
        <label class="vt-travel"><input type="checkbox" id="vt-travel"> Show travel moves</label>
        ${a.toolpath.downsampled ? `<span class="vt-note">Showing ${a.toolpath.segments.length.toLocaleString()} of ${a.toolpath.total_segments.toLocaleString()} moves</span>` : ''}`;
      $('vt-range').addEventListener('input', (e) => { viewer.setLayerLimit(+e.target.value); $('vt-z').textContent = (+e.target.value).toFixed(2); });
      $('vt-travel').addEventListener('change', (e) => { viewer.showTravel = e.target.checked; viewer.draw(); });
    }
    $('fd-side').innerHTML = `
      <div class="fd-facts divider-row cols-2">
        <div><span class="stat-key">Lines</span><b>${a.lines.toLocaleString()}</b><small>in the file</small></div>
        <div><span class="stat-key">Layers</span><b>${a.layers || '—'}</b><small>heights that print plastic</small></div>
        <div><span class="stat-key">Toolheads</span><b>${a.tools_used.join(' ') || '—'}</b><small>that extrude</small></div>
        <div><span class="stat-key">Footprint</span><b>${a.footprint_mm ? a.footprint_mm.join(' × ') : '—'}</b><small>${a.footprint_mm ? 'mm' : 'no extrusion found'}</small></div>
      </div>
      <p class="log-empty">Read in this browser - the file isn't uploaded. The pre-flight check, time and filament estimates,
        edits and printing need the Deja Vu1 server.</p>
      <div class="fd-actions"><button class="btn" id="fd-forget" type="button">Close and forget</button></div>`;
    $('fd-forget').addEventListener('click', () => forgetLocal(entry.name));
    window.DVGcode?.mount(entry,a,viewer);
    loadLines();
  }

  function forgetLocal(name) {
    files.local = files.local.filter(f => f.name !== name);
    closeFile();
    renderLocalFiles();
  }

  async function openGcode(entry, viewer) {
    if (entry.local) { await openLocalGcode(entry, viewer); return; }
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
    window.DVGcode?.mount(entry,a,viewer);
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
        <div><span class="stat-key">Toolheads</span><b>${esc(a.tools_used.join(' ')) || '—'}</b><small>${esc((a.meta.filament_types || []).join(', '))}</small></div>
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
      if (!liveData()) { toast('No printer connected. Turn on demo data to queue on a simulated printer', 'warn'); return; }
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
    // Without the server there's no module switch to read; AR runs in the
    // browser alone, so it's offered on the same terms as anything else here.
    const mods = await getJSON('/api/modules').catch(() => null);
    if (!serverMissing() && (!mods || !(mods.modules || []).some(m => m.id === 'ar_preview' && m.enabled))) return;
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
      if(entry.kind==='3mf'&&!entry.local){
        const selection=await getJSON('/api/files/plates?name='+enc(entry.name));
        if(files.open!==entry)return;
        if(selection?.count>1){
          side.innerHTML=`<h3>Choose a plate</h3><p class="field-hint">This project contains ${selection.count} plates. Prepare and slice each separately; the original stays intact.</p><label>Plate<select id="fd-choose-plate">${selection.plates.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.objects)} objects</option>`).join('')}</select></label><button class="btn primary" id="fd-extract-plate">Open selected plate as new</button><p id="fd-plate-status" role="status"></p>`;
          $('fd-view-tools').textContent='Select one plate to load its models.';
          $('fd-extract-plate').onclick=async e=>{e.currentTarget.disabled=true;try{if(typeof tourOn==='function'&&tourOn())throw new Error('Saving a selected plate needs the local Deja Vu1 app. The public demo is a recording.');const r=await postJSON('/api/files/plates/extract',{name:entry.name,plate:$('fd-choose-plate').value});if(files.open!==entry)return;if(!r.ok)throw new Error(r.body.error);await loadFiles();await openFile(r.body.name);}catch(err){if(files.open===entry){$('fd-plate-status').textContent=err.message;e.currentTarget.disabled=false;}}};
          return;
        }
      }
      let buffer;
      if (entry.local) buffer = await entry.local.arrayBuffer();
      else {
        const res = await fetch(`/api/files/raw?name=${enc(entry.name)}`);
        if (!res.ok) throw new Error((await res.json()).error || res.status);
        buffer = await res.arrayBuffer();
      }
      const started = performance.now();
      const mesh = await DV3D.parseModel(buffer, entry.name);
      if (files.open !== entry) return;
      const ms = Math.round(performance.now() - started);
      if (viewer) viewer.setMesh(mesh, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
      const is3mf = entry.kind === '3mf';
      // A project already set up for a Snapmaker printer (one this
      // dashboard converted, or saved by Snapmaker Orca) has nothing to
      // convert; the server refuses it, so the button isn't offered.
      const alreadyU1 = ['converted', 'studio'].includes(entry.origin) || /^snapmaker/i.test(mesh.application || '');
      side.innerHTML = `
        <div class="fd-facts divider-row cols-2">
          <div><span class="stat-key">Size</span><b>${mesh.size.map(v => v.toFixed(1)).join(' × ')}</b><small>mm (X × Y × Z)</small></div>
          <div><span class="stat-key">Triangles</span><b>${mesh.triangles.toLocaleString()}</b><small>read in ${ms} ms</small></div>
          <div><span class="stat-key">Objects</span><b>${mesh.objects}</b><small>${esc(mesh.application || (is3mf ? 'No application named' : 'STL'))}</small></div>
          <div><span class="stat-key">Fits the U1?</span><b>${mesh.size[0] <= 270 && mesh.size[1] <= 270 && mesh.size[2] <= 270 ? 'Yes' : 'No'}</b><small>270 × 270 × 270 mm</small></div>
        </div>
        <p class="log-empty">Models need slicing (in Snapmaker Orca) before they can be printed.</p>
        ${entry.local ? `<p class="log-empty">Read in this browser - the file isn't uploaded. Converting for the U1 and
          slicing need the Deja Vu1 server.</p>
        <div class="fd-actions"><span id="fd-ar-slot" class="fd-ar-slot"></span>
          <button class="btn" id="fd-forget" type="button">Close and forget</button></div>
        <p class="log-empty fd-ar-note" id="fd-ar-note" hidden></p>` : `
        <div class="fd-actions">
          ${is3mf && !alreadyU1 && !modGate.off.has('converter') ? '<button class="btn primary" id="fd-convert" type="button">Convert for Snapmaker U1</button>' : ''}
          ${is3mf && alreadyU1 ? '<span class="fd-u1-ready">Set up for the Snapmaker U1 - open it in Snapmaker Orca</span>' : ''}
          <span id="fd-slice-slot" class="fd-slice-slot"></span>
          <span id="fd-ar-slot" class="fd-ar-slot"></span>
          <a class="btn" href="/api/files/raw?name=${enc(entry.name)}&download=1">Download</a>
          <button class="btn danger" id="fd-delete" type="button">Delete</button>
        </div>
        <p class="log-empty fd-ar-note" id="fd-ar-note" hidden></p>
        <div id="fd-colours-host"></div>
        <div id="fd-compare-host"></div>
        <div id="fd-convert-report"></div>`}`;
      await modelTools(entry, mesh, viewer, side);
      if (entry.local) {
        $('fd-forget').addEventListener('click', () => forgetLocal(entry.name));
        setupAR(entry, mesh);
        return;
      }
      $('fd-delete').addEventListener('click', () => deleteFile(entry.name));
      if ($('fd-convert')) $('fd-convert').addEventListener('click', (e) => convertFile(entry.name, e.currentTarget));
      if (is3mf && !modGate.off.has('converter')) renderColours(entry);
      renderCompare(entry);
      setupAR(entry, mesh);
      window.dispatchEvent(new CustomEvent('dv-model-open', { detail: entry }));
    } catch (err) {
      side.innerHTML = `<p class="log-empty">Couldn't read this model: ${esc(err.message)}</p>`;
    }
  }

  function modelTools(entry, original, viewer, side) {
    if (window.DVPlate) return DVPlate.mount(entry, original, viewer, side);
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
  async function renderColours(entry) {
    const host = $('fd-colours-host');
    if (!host) return;
    files.colourPlan = null;
    const data = await getJSON(api(`/api/colours/plan?name=${enc(entry.name)}`)).catch(() => null);
    if (files.open !== entry || !data || !Array.isArray(data.filaments)) return;
    const fil = data.filaments, used = fil.filter(f => f.used);
    // A single-colour project with nothing to decide gets no panel.
    if (fil.length <= 1 && used.length <= 1) return;
    let plan = (data.suggested || []).slice();
    files.colourPlan = fil.length > HEAD_COUNT ? plan : null;
    const swatch = (c, label) => `<span class="cm-swatch${c ? '' : ' is-empty'}" style="--sw:${esc(c || 'transparent')}" aria-hidden="true"></span><span class="sr-only">${esc(label || '')}</span>`;
    const headsOf = () => {
      const heads = [];
      for (let h = 0; h < HEAD_COUNT; h++) {
        const members = fil.filter((f, i) => plan[i] === h);
        const lead = members.slice().sort((a, b) => (b.used - a.used) || (b.painted - a.painted) || (a.n - b.n))[0];
        heads.push({ h, members, lead });
      }
      return heads;
    };
    const draw = () => {
      const heads = headsOf();
      const mixed = heads.filter(x => new Set(x.members.map(f => (f.type || 'PLA').split(/[\s+-]/)[0])).size > 1);
      const missing = fil.filter((f, i) => f.used && plan[i] == null);
      host.innerHTML = `
        <section class="cm" aria-labelledby="cm-title">
          <div class="cm-head">
            <h3 class="fd-h" id="cm-title">Colours on the U1's heads</h3>
            <p class="cm-sub">${esc(data.source_label)} · ${fil.length} filament${fil.length === 1 ? '' : 's'} listed, ${used.length} used by the model</p>
          </div>
          <ol class="cm-heads" aria-label="What each head prints">
            ${heads.map(x => `<li class="cm-headcard${x.lead ? '' : ' is-idle'}">
              <span class="cm-dot" style="--sw:${esc((x.lead && x.lead.colour) || 'transparent')}"></span>
              <span class="cm-hname">Head ${x.h + 1}</span>
              <span class="cm-hwhat">${x.lead ? `${esc(x.lead.name)}${x.lead.type ? ` · ${esc(x.lead.type)}` : ''}` : 'Not used'}</span>
              ${x.members.length > 1 ? `<span class="cm-hfrom">filaments ${x.members.map(f => f.n).join(' + ')}</span>` : ''}
              ${data.loaded && data.loaded[x.h] && data.loaded[x.h].colour ? `<span class="cm-loaded" title="Loaded in the printer now">${swatch(data.loaded[x.h].colour, 'Loaded now')} loaded</span>` : ''}
            </li>`).join('')}
          </ol>
          <div class="cm-rows" role="list">
            ${fil.map((f, i) => `<div class="cm-row${f.used ? '' : ' is-unused'}" role="listitem">
              ${swatch(f.colour, f.name)}
              <span class="cm-fname"><b>Filament ${f.n}</b> ${esc(f.name)}${f.type ? ` · ${esc(f.type)}` : ''}
                <small>${f.used ? (f.painted ? `painted on ${f.painted.toLocaleString()} triangle${f.painted === 1 ? '' : 's'}` : 'used by an object') : 'not used by the model'}</small></span>
              <label class="sr-only" for="cm-sel-${i}">Head for filament ${f.n}</label>
              <select id="cm-sel-${i}" data-i="${i}">
                <option value="">${f.used ? 'Choose a head' : 'Leave out'}</option>
                ${Array.from({ length: HEAD_COUNT }, (_, h) => `<option value="${h}"${plan[i] === h ? ' selected' : ''}>Head ${h + 1}</option>`).join('')}
              </select>
            </div>`).join('')}
          </div>
          ${mixed.length ? `<p class="cm-warn" role="alert">Head ${mixed.map(x => x.h + 1).join(' and ')} would get different materials, which print at different temperatures. Choose another head for one of them.</p>` : ''}
          ${missing.length ? `<p class="cm-warn" role="alert">Filament ${missing.map(f => f.n).join(', ')} is used by the model and needs a head.</p>` : ''}
          ${data.format === 'prusa' ? '<p class="log-empty">Snapmaker Orca opens PrusaSlicer projects with its own filament colours: load the colours above in those heads, or slice it here in Deja Vu1.</p>' : ''}
          ${data.unreadable_paint ? `<p class="log-empty">${data.unreadable_paint} painted triangles couldn't be read and stay as they are.</p>` : ''}
          <div class="cm-actions">
            <button class="btn small" type="button" data-cm="suggest">Group alike colours</button>
            ${data.matched ? '<button class="btn small" type="button" data-cm="match">Match the printer\'s heads</button>' : ''}
            <button class="btn small primary" type="button" data-cm="save"${missing.length ? ' disabled' : ''}>Save a copy with these heads</button>
          </div>
          <p class="cm-status" role="status" aria-live="polite"></p>
        </section>`;
      qsa('select[data-i]', host).forEach(sel => sel.addEventListener('change', () => {
        plan[+sel.dataset.i] = sel.value === '' ? null : +sel.value;
        files.colourPlan = plan.slice();
        draw();
        const again = $(sel.id);
        if (again) again.focus();
      }));
      qsa('[data-cm]', host).forEach(b => b.addEventListener('click', () => onAction(b)));
    };
    const onAction = async b => {
      if (b.dataset.cm === 'suggest' || b.dataset.cm === 'match') {
        plan = ((b.dataset.cm === 'match' ? data.matched : data.suggested) || []).slice();
        files.colourPlan = plan.slice();
        draw();
        toast(b.dataset.cm === 'match' ? 'Each colour now goes to the closest loaded head' : 'Alike colours now share a head', 'ok');
        return;
      }
      if (typeof tourOn === 'function' && tourOn()) { toast('Saving a copy needs the local Deja Vu1 app. The public demo is a recording.', 'warn'); return; }
      b.disabled = true;
      const r = await postJSON('/api/colours/apply', { name: entry.name, plan });
      b.disabled = false;
      const status = qs('.cm-status', host);
      if (!r.ok) {
        if (status) status.textContent = (r.body && r.body.error) || 'The copy could not be saved';
        toast('Colours not saved', 'warn');
        return;
      }
      if (status) status.innerHTML = `Saved as <button class="chip-btn" type="button" data-open-file="${esc(r.body.file.name)}">${esc(r.body.file.name)}</button>. ${esc(r.body.report.summary)}.`;
      toast(`Saved ${r.body.file.name}`, 'ok', 4200, { action: { label: 'Open', run: () => openFile(r.body.file.name) } });
      await loadFiles();
      qsa('[data-open-file]', host).forEach(x => x.onclick = () => openFile(x.dataset.openFile));
    };
    draw();
  }

  async function convertFile(name, button, target) {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Converting…';
    const plan = files.open && files.open.name === name ? files.colourPlan : null;
    const r = await postJSON('/api/convert', plan ? { name, plan } : { name });
    button.disabled = false;
    button.textContent = label;
    const host = target || $('fd-convert-report');
    const copyBtn = '<button class="btn small" type="button" data-copy-report>Copy report</button>';
    if (!r.ok) {
      const b = r.body || {};
      host.innerHTML = `
        <div class="convert-fail" role="alert">
          <p class="convert-fail-head">${b.code ? `<b class="convert-code">${esc(b.code)}</b>` : ''}${b.stage ? `<span>${esc(b.stage)}</span>` : ''}</p>
          <p>${esc(b.error || 'Conversion failed')}</p>
          ${b.action ? `<p class="convert-action"><b>Try:</b> ${esc(b.action)}</p>` : ''}
          <div class="convert-actions">${copyBtn}<span class="log-empty">Paste it into a bug report - it has everything needed to look into it.</span></div>
        </div>`;
      toast('Conversion not possible', 'warn');
    } else {
      const rep = r.body.report;
      host.innerHTML = `
        <div class="convert-report">
          <h3 class="fd-h">Converted from ${esc(rep.source_label)}</h3>
          <p>Saved as <button class="chip-btn" data-open-file="${esc(r.body.file.name)}" type="button">${esc(r.body.file.name)}</button>. Printer <b>${esc(rep.printer_profile)}</b>, print profile <b>${esc(rep.print_profile)}</b>, filaments ${rep.filament_profiles.map(esc).join(', ')}.</p>
          ${plateSummary(rep.plates)}
          ${rep.kept.length ? `<p>Kept the creator's own changes: ${rep.kept.map(k => `<code>${esc(k)}</code>`).join(' ')}</p>` : ''}
          ${rep.warnings.length ? `<ul class="pf-list">${rep.warnings.map(w => `<li class="pf-warning">${esc(w)}</li>`).join('')}</ul>` : ''}
          <p class="log-empty">${esc(rep.unverified)}</p>
          <div class="convert-actions">${copyBtn}</div>
        </div>`;
      toast(`Converted. Saved as ${r.body.file.name}`, 'ok');
      await loadFiles();
      if (files.open) renderCompare(files.open);
      qsa('[data-open-file]', host).forEach(b => b.onclick = () => openFile(b.dataset.openFile));
    }
    const text = conversionReport(name, r);
    qsa('[data-copy-report]', host).forEach(b => b.addEventListener('click', async () => {
      const ok = await copyText(text);
      toast(ok ? 'Report copied' : "This browser wouldn't copy it - select the text and copy by hand", ok ? 'ok' : 'warn');
      if (!ok) host.insertAdjacentHTML('beforeend', `<textarea class="convert-report-text" readonly rows="8">${esc(text)}</textarea>`);
    }));
  }

  /* G-code lines: a window of 200 at a time, searchable, with small edits. */
  async function loadLines() {
    const host = $('fd-gcode');
    if (!files.open || files.open.kind !== 'gcode') return;
    const { offset, q } = files.lines;
    const data = files.open.local ? localLines(files.open, offset, q)
      : await getJSON(`/api/files/lines?name=${enc(files.open.name)}&offset=${offset}&limit=200${q ? `&q=${enc(q)}` : ''}`);
    if (!data.lines) { host.innerHTML = `<p class="log-empty">${esc(data.error || "Couldn't read the lines")}</p>`; delete host.dataset.built; return; }
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
    if (files.open && files.open.local) {
      box.innerHTML = `<div class="gc-edit-title">Line ${n}: <code>${esc(text.trim() || '(blank)')}</code></div>
        <p class="log-empty">Editing a line (checked first, original kept) needs the Deja Vu1 server - this file is only being viewed here.</p>`;
      return;
    }
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
    toast('Edit saved. Original kept, pre-flight re-checked', 'ok');
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
    if (!liveData()) { toast('No printer connected. Turn on demo data to print on a simulated printer', 'warn'); return; }
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
    go.textContent = gate.verdict === 'confirm' ? 'I\'ve read these, start print' : 'Start print';
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
      ${gate.preflight.checked_against && gate.preflight.checked_against !== 'Snapmaker U1'
        ? `<p class="field-hint">Checked against this printer's own report: ${esc(gate.preflight.checked_against)}.</p>` : ''}
      <h3 class="fd-h">Filament, as the printer reports it loaded</h3>
      ${fil || '<p class="log-empty">The file doesn\'t say which toolheads it uses.</p>'}
      ${gate.spools ? `<h3 class="fd-h">Spool weight</h3>${gate.spools.map(s => `<p class="gate-spool ${s.status}">${esc(s.toolhead)}: ${s.status === 'no_spool' ? 'no matching spool in your inventory' : `${esc(s.spool)}: ${s.grams_remaining} g now, about ${s.grams_after} g after this print`}</p>`).join('')}` : ''}`;
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
            <span class="pill qi-status">${{ queued: 'Waiting', held: 'Held', starting: 'Starting…', started: 'Printing', done: 'Done' }[i.status] || esc(i.status)}</span></div>
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
        : a === 'light' ? `<input type="color" id="rf-color" value="#ffaa00" aria-label="Light colour"> <span class="log-empty">Sent to the WLED strip set up in Settings</span>`
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
      if (!demoOn) { toast('No printer connected. Turn on demo data to try this on a simulated printer', 'warn'); return; }
      const r = await runCommand(e.submitter || null, '/api/maintenance/swap', { kind: $('swap-kind').value, toolhead: $('swap-toolhead').value },
        { sending: 'Recording…', done: 'Swap recorded, recalibration is now due', failed: 'Not recorded' });
      if (r.ok) { loadMaintenance(); loadHealth(); }
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
      host.innerHTML = empty('No camera set up', 'Add the printer camera\'s MJPEG address above. Nothing is simulated here, so the demo has no camera.');
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
    img.onerror = async () => { if (run === cam.run) setCamMode('trouble', `${await streamProblem()} Reconnect to try again.`); };
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

  async function loadTimelapse() {
    const host = $('timelapse-host');
    if (!host) return;
    const data = await getJSON(api('/api/timelapse')).catch(() => null);
    if (isModuleDisabled(data)) { host.innerHTML = moduleDisabledEmpty('Time-lapse flipbook'); return; }
    if (!data || !hasData(data)) { host.innerHTML = demoNeeded('time-lapses'); return; }
    host.innerHTML = data.sessions.length ? data.sessions.map(s => `
      <div class="reg-row">
        <span class="reg-name">${esc(s.filename || 'print')}</span>
        <span class="log-empty">${s.frames} frames · ${since(s.started_at)}${s.finished ? '' : ' · recording'} · ${esc(s.source)}${s.last_error ? ' · '+esc(s.last_error) : ''}</span>
        <button class="btn small" data-flip="${esc(s.session)}" type="button" ${s.frames ? '' : 'disabled'}>Play</button>
      </div>`).join('') : '<p class="log-empty">No time-lapses yet. One is recorded during every print.</p>';
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
    return 'Computer';
  })();
  let dismissedOffer = 0;

  function currentTab() { return store.get('dejavu1.tab') || 'overview'; }
  // The full camera (Printer → Camera & time-lapses) runs only while its part is open.
  window.addEventListener('dv-section', e => {
    if (e.detail.tab !== 'control') return;
    if (e.detail.key === 'camera' || e.detail.key === 'all') loadCamera(); else stopCamera();
  });

  function reportView() {
    if (modGate.off.has('handoff')) return;      // switched off: nothing to report, and no refused request
    postJSON('/api/handoff', { device_id: deviceId, device_name: deviceName,
      view: { printer: currentPrinter, tab: currentTab(), file: files.open ? files.open.name : null } }).catch(() => {});
  }

  async function checkHandoff() {
    const el = $('handoff');
    const data = await getJSON(`/api/handoff?device=${enc(deviceId)}`).catch(() => null);
    const offer = data && data.offer;
    const same = offer && offer.tab === currentTab() && (offer.printer || '') === currentPrinter && !offer.file;
    if (!offer || same || offer.at <= dismissedOffer || offer.seconds_ago > 600) { el.hidden = true; return; }
    // In words: "Your iPhone was on Files · U1 Workshop · benchy.gcode".
    const tabName = (typeof TAB_NAMES !== 'undefined' && TAB_NAMES[offer.tab]) || offer.tab;
    const where = [tabName, offer.printer ? printerName(offer.printer) : null, offer.file].filter(Boolean).join(' · ');
    const text = `Your ${offer.device_name} was on ${where}. Open the same here?`;
    $('handoff-text').textContent = text;
    const go = async () => {
      el.hidden = true;
      dismissedOffer = offer.at;
      if (offer.printer && offer.printer !== currentPrinter) selectPrinter(offer.printer);
      if (offer.tab) showTab(offer.tab);
      if (offer.file) { await loadFiles(); openFile(offer.file); }
    };
    $('handoff-go').onclick = go;
    $('handoff-dismiss').onclick = () => { el.hidden = true; dismissedOffer = offer.at; };
    if (!el.hidden) return;
    el.hidden = false;
    // The offer waits a few seconds, then moves into the notification orb (button and all), so it
    // doesn't sit over the page; pointing at it or tabbing into it keeps it where it is.
    clearTimeout(checkHandoff.fold);
    const fold = () => {
      if (el.hidden || el.matches(':hover') || el.contains(document.activeElement)) { if (!el.hidden) checkHandoff.fold = setTimeout(fold, 3000); return; }
      el.hidden = true;
      dismissedOffer = offer.at;
      toast(text, 'info', 3000, { action: { label: 'Open here', run: go } });
    };
    checkHandoff.fold = setTimeout(fold, 9000);
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
    // The sheet's own tools: what the computer shows in the strip under the
    // header (search, Camera, Set up & help) and the line under the tab bar.
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-more]');
      if (!b) return;
      setSheet(false);
      const act = b.dataset.more;
      if (act === 'camera') { showTab('control'); window.Sections && Sections.reveal($('pp-camera-card')); $('pp-camera-card').scrollIntoView({ block: 'start' }); }
      else if (act === 'help') $('setup-replay').click();
      else if (act === 'tips') { if (window.Guide && Guide.has(currentTab())) Guide.screen(currentTab()); else toast('This screen has no extra tips', 'info'); }
      else if (act === 'install' && window.Phone) Phone.install();
    });
    $('qa-next').addEventListener('click', (e) => startNext(e.currentTarget));
    $('live-pill').addEventListener('click', () => showTab('control'));
    $('qa-status').addEventListener('click', () => showTab('control'));
    initHoldToCancel();
    initDockStack();
    syncNav(currentTab());
    nav.dataset.ready = '1';
  }

  /* On a phone the print pill and the "continue here" offer join the thumb
   * dock's own column, so they stack above the dock by its real height
   * instead of by guessed pixel offsets (which broke as soon as the quick
   * actions appeared or disappeared). Wider screens float them as before.
   * The page's bottom padding follows the dock's height the same way, so
   * the end of every tab can always be scrolled clear of it. */
  function initDockStack() {
    const dock = $('thumb-dock'), pill = $('live-pill'), offer = $('handoff');
    const finder = qs('.feature-finder'), finderHome = qs('.launch-strip');
    const phone = window.matchMedia('(max-width: 720px)');
    const place = () => {
      if (phone.matches) dock.prepend(offer, pill);
      else dock.before(pill, offer);
      // On a phone the search lives at the top of the More sheet.
      if (finder && finderHome) {
        if (phone.matches) $('ms-search').append(finder);
        else if (!finderHome.contains(finder)) finderHome.querySelector('div').after(finder);
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

  /* Scroll edge: the top bar frosts harder once content is under it. The two
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
    // The background joins in: a burst in the print's filament colour.
    if (typeof Backdrop !== 'undefined') Backdrop.celebrate();
    const dialog = $('celebrate-dialog');
    qs('.dialog-panel', dialog).style.setProperty('--glass-tint', s.color || '#4a8df8');
    qs('.dialog-panel', dialog).style.setProperty('--cel', s.color || '#4a8df8');
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
    if (name === 'control') { loadCamera(); loadTimelapse(); } else stopCamera();
    if (name === 'maintenance') { loadForecast(); loadSideBySide(); }   // Filament & colour lives here
    window.dispatchEvent(new CustomEvent('dv-tab', { detail: name }));
    reportView();
  }

  async function refresh() {
    $('demo-tools-card').hidden = !demoOn;
    // The empty cards name an added printer that isn't answering, so its list comes first.
    const reg = liveData() ? null : loadRegistry();
    if (!liveData()) {
      await reg;
      printerState = null;
      $('live-pill').hidden = true;
      $('quick-actions').hidden = true;
      renderTwin(null);
      renderFleet([]);
    }
    await Promise.all([loadHealth(), loadChamber(), loadFiles(), loadQueue(), reg || loadRegistry(),
      loadRules(), loadRuleLog(), loadForecast(), loadSideBySide(), loadTimelapse()]);
    if (liveData()) refreshPrinter();
    renderChip();
    window.dispatchEvent(new CustomEvent('dv-refresh'));
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
    initGlassMenu();
    initDialogs();
    honourReducedMotion();
    connect();
    refresh();
    onTab(currentTab());
    reportView();
    setInterval(reportView, 20000);
    setInterval(checkHandoff, 15000);
    setTimeout(checkHandoff, 3000);
    setInterval(() => { if (liveData()) { loadHealth(); loadChamber(); } }, 15000);
    window.addEventListener('resize', () => moveTabBlob(currentTab()));
  }

  return { init, refresh, applyState, refreshPrinter, reconnect, onTab, isLive, selectPrinter, morph,
           openFile, openDiff, loadQueue, loadFiles, printerName, fmtHours, openDialog, closeDialog, tween };
})();

window.Workshop = Workshop;
Workshop.init();
