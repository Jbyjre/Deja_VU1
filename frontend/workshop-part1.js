/* workshop-part1.js: part 1 of 5 of workshop.js, the live connection, fleet, files, automations and Liquid Glass
 * 2.0. Split out of the one closure workshop.js was (18 November 2026) so a session reads only the part it needs.
 * Loaded before workshop.js, after the scripts before it; it hands its names on through WorkshopPart1. Holds:
 * BUCKETS, EASE_RATE, PHONE, REDUCED, SOON_HOURS, SPRING_W, STATE_COLOR, STATE_HEX, STATE_WORD, TAB_LABEL, WF,
 * applyTwinOptions, attention, attentionItems, attentionSummary, attrs, badge, boxSolid, demoNeeded, describeProbe,
 * dockX, downloadDrawing, drawDims, ease, empty, enc, findPrinters, fmtHours, frame, headSolid, hull, hullOf,
 * isLive, live, loadRegistry, markView, money, pathOf, printerName, prismSolid, projector, qs, qsa,
 * refreshAttentionQueues, renderAttention, renderChip, renderChips, renderPick, renderSync, ringSVG, setPath,
 * showTest, since, smooth, sortEdges, springStep, syncTwinPrint, tintRoom, tween, twin, twinFeed, twinFx,
 * twinMoveTo, wsState
 */
'use strict';
const WorkshopPart1 = (() => {
  /* State the parts of this file share (one object, so every file sees the same values). */
const wsState = {
    animating: false,
    lastFrame: 0,
    printerState: null,
    roomKey: null,
    refreshTimer: null,
    registry: [],
    chamberHistory: [],
    confirmFile: null,
    dismissedOffer: 0,
    lastCelebrated: null,
    lastBurst: 0
  };
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
const smooth = new Map();
function tween(key, target, apply, spring) {
    const entry = smooth.get(key);
    if (entry) { entry.target = target; entry.apply = apply; }
    else smooth.set(key, { value: target, target, apply, spring: !!spring });
    if (!entry) apply(target);
    if (!wsState.animating) { wsState.animating = true; wsState.lastFrame = performance.now(); requestAnimationFrame(frame); }
  }
function frame(now) {
    const dt = Math.min(0.1, (now - wsState.lastFrame) / 1000);
    wsState.lastFrame = now;
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
    if (moving) requestAnimationFrame(frame); else wsState.animating = false;
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

function badge() {
    // The fleet card's "Live" label only while a live feed is really running.
    const fleetBadge = $('fleet-live-badge');
    if (fleetBadge) fleetBadge.hidden = !isLive();
    const el = $('rb-live');
    if (!el) return;
    el.hidden = live.mode === 'off';
    el.dataset.mode = live.mode;
  }

  /* The light behind the glass takes the colours of the filament loaded on
   * the printer you're looking at (theme.css, --fil-a / --fil-b): the active
   * toolhead's first, then the most colourful of the rest. Black, white and
   * greys have no colour to give, so they're skipped, and with nothing
   * colourful loaded the room keeps its default light. */
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
    if (key === wsState.roomKey) return;
    wsState.roomKey = key;
    const root = document.documentElement.style;
    if (first) root.setProperty('--fil-a', first); else root.removeProperty('--fil-a');
    if (second) root.setProperty('--fil-b', second); else root.removeProperty('--fil-b');
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
    chip.hidden = !liveData() && !wsState.registry.length;
    const id = currentPrinter || (live.fleet[0] && live.fleet[0].id);
    const row = live.fleet.find(p => p.id === id);
    const added = wsState.registry.find(p => p.id === id) || (wsState.registry.length === 1 && wsState.registry[0]);
    $('printer-chip-name').textContent = row ? row.name
      : (wsState.printerState && wsState.printerState.printer_name) || (added && added.name) || 'Printer';
    const state = row ? row.state : (wsState.printerState && wsState.printerState.state);
    chip.style.setProperty('--pc-color', STATE_HEX[state] || '#8e8e93');
  }

function ringSVG(progress, color, size = 58) {
    const r = 15.5, c = 2 * Math.PI * r;
    return `<svg class="ring-svg" viewBox="0 0 36 36" width="${size}" height="${size}" aria-hidden="true">
      <circle cx="18" cy="18" r="${r}" class="rs-track"/>
      <circle cx="18" cy="18" r="${r}" class="rs-fill" style="stroke:${color};stroke-dasharray:${c};stroke-dashoffset:${c * (1 - progress)}"/>
    </svg>`;
  }

  /* ================================================================
   * Needs you: the whole farm, ranked by what wants a person
   * ================================================================
   * Read straight from the fleet rows the server already sends (their
   * alerts, state and time left) plus each printer's queue. Nothing here
   * is inferred beyond that: a fault is a fault the printer reported, a
   * queue is files really waiting. */

const attention = { queues: {}, queuesAt: 0, queueOff: false };
const TAB_LABEL = { control: 'Printer', files: 'Files', maintenance: 'Maintenance' };
const SOON_HOURS = 0.25;

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
      if (p.resume_saved) {
        // After a Halt or a power cut the U1 keeps the print and can restart it by itself, onto whatever is on the bed.
        add(0, 'error', `${p.name} still holds a halted print`, 'It can restart that print by itself. Clear the bed, then discard it on the Printer screen', 'control');
      }
      if (p.state === 'paused') {
        // A pause the printer raised itself names what is wrong (its code and Snapmaker's title for it); one pressed by hand does not.
        const why = p.problem ? `: ${p.problem.title || `printer error ${p.problem.code}`}` : '';
        add(1, 'warning', `${p.name} is paused${why}`, `${p.problem ? `${p.problem.code} · ` : ''}${p.current_file || 'Current print'} · ${Math.round(p.progress * 100)}% done`, 'control');
      }
      const q = attention.queues[p.id];
      const bed = q && q.bed;
      if (bed && bed.state === 'awaiting_clear' && p.state !== 'printing') {
        add(1, 'warning', `${p.name}: take ${bed.file || 'the last print'} off the bed`, 'Nothing queued starts there until you press Part removed, bed clear', 'files');
      } else if (p.state === 'complete') {
        add(1, 'done', `${p.name} finished ${p.current_file || 'its print'}`, 'Ready for the next print once the bed is clear', 'control');
      }
      const waiting = q ? q.items.filter(i => i.status === 'queued' || i.status === 'held').length : 0;
      // While the bed waits to be cleared, that item above is the one to act on.
      if (p.state === 'ready' && waiting && !p.link_lost && !(bed && bed.state === 'awaiting_clear')) {
        add(2, 'warning', `${p.name} is idle with ${waiting} file${waiting === 1 ? '' : 's'} waiting`, 'Start the next one from Files', 'files');
      }
      (p.alerts || []).filter(a => a.level === 'warning' && a.text !== 'Paused').forEach(a =>
        add(3, 'warning', `${p.name}: ${a.text}`, 'See what is due in Maintenance', 'maintenance'));
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
    if (idle) parts.push(`${idle} ready`);
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

async function loadRegistry() {
    const host = $('fleet-registry');
    const data = await getJSON('/api/fleet/registry').catch(() => ({}));
    if (isModuleDisabled(data)) { host.innerHTML = moduleDisabledEmpty('Printer fleet'); return; }
    wsState.registry = data.printers || [];
    addedPrinters = wsState.registry;
    // The add form stays folded until asked for (Add a printer stays small and expandable).
    const form = $('add-printer-form');
    if (form) setText(qs('summary', form), wsState.registry.length ? 'Add another printer' : 'Add your printer');
    host.innerHTML = wsState.registry.length ? wsState.registry.map(p => `
      <div class="reg-row">
        <span class="reg-name">${esc(p.name)}</span>
        <code class="reg-url">${esc(p.moonraker_url)}</code>
        <span class="pill reg-pill ${p.connected ? 'is-ok' : 'is-bad'}" role="status">${esc(p.link || (p.connected ? 'Connected' : 'Not connected'))}</span>
        <button class="btn small" data-reg-details="${esc(p.id)}" type="button" aria-expanded="false">Details</button>
        <button class="btn small" data-reg-remove="${esc(p.id)}" type="button">Remove</button>
        ${!p.connected && p.network_hint ? `<p class="reg-hint" role="note">${esc(p.network_hint.words)}</p>` : ''}
        <div class="reg-details" id="reg-details-${esc(p.id)}" hidden></div>
      </div>`).join('') : '<p class="field-hint">None added yet. Until you add one, the demo printers show what Deja Vu1 does.</p>';
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

async function findPrinters(btn, wider) {
    const label = btn.textContent;
    qsa('#fleet-find, #fleet-find-wider').forEach(b => { b.disabled = true; });
    btn.textContent = 'Looking…';
    $('fleet-find-note').textContent = wider
      ? 'Looking on this computer\'s networks, the address ranges home routers often use and your Tailscale network: about 20 seconds.'
      : 'Asking the network, then trying port 7125 on each address - a few seconds.';
    const r = await postJSON('/api/printers/discover', { wider: !!wider });
    qsa('#fleet-find, #fleet-find-wider').forEach(b => { b.disabled = false; });
    btn.textContent = label;
    const list = $('fleet-found');
    if (!r.ok) { $('fleet-find-note').textContent = r.body.error || 'Couldn\'t look'; list.hidden = true; return; }
    const found = r.body.printers || [];
    $('fleet-find-note').textContent = `${found.length ? `Found ${found.length}` : 'Found nothing'} in ${r.body.seconds} s (${(r.body.how || []).join('; ')}).`
      + (found.length ? '' : r.body.wider
        ? ' Check the printer is on. If it is on another network, type its address below, or see how to reach it from anywhere in Away from home.'
        : ' Check the printer is on, press Look further, or type its address below.');
    list.hidden = !found.length;
    list.innerHTML = found.map((p, i) => `<li class="found">
      <span class="found-main"><b>${esc(p.name || p.ip)}</b>${p.u1 ? '<span class="found-tag">U1</span>' : ''}
        <small>http://${esc(p.ip)}:${p.port} · ${esc(p.where && p.where !== 'this network' ? `found on ${p.where}` : p.source)}${p.serial ? ` · serial ${esc(p.serial)}` : ''}</small>
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
    // asking for an API key the user has never seen.
    $('fleet-login').hidden = !r.needs_key;
    if (r.url) $('fleet-add-url').value = r.url;
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
      const d = { case: 'closed', print: true, rest: true, tags: true, spin: false, sound: false };
      try { const o = JSON.parse(localStorage.getItem('dejavu1.twin-view') || '{}'); return { ...d, ...(o && typeof o === 'object' ? o : {}) }; } catch (e) { return d; }
    })(),
    printKey: null, printNote: null, printTries: 0, printRetry: 0,
    // How well the head's place is known: exact (homed), last (drawn where it was last seen), unknown.
    posKind: 'exact', seen: null,
  };
const BUCKETS = ['grid', 'env', 'frame', 'trail', 'hid', 'part-hid', 'vis', 'part', 'head', 'fault',
    'skip', 'sel-hid', 'sel', 'dim', 'axis'];

  /* A drag let go on the twin in move mode: the same checked move as the Move card. */
function twinMoveTo(pt) {
    const st = twin.state;
    if (!st || st.link_lost) { toast('The printer is not answering', 'warn'); return; }
    if (st.state === 'printing' || st.state === 'paused') { toast('Moving waits until the print finishes or is cancelled: it would drive the head through the print', 'warn', 6000); return; }
    const homed = st.homed_axes;
    if (typeof homed === 'string' && !(homed.includes('x') && homed.includes('y'))) { toast('Home X and Y first (Home all, beside Move head)', 'warn', 6000); return; }
    runCommand($('twin-move'), '/api/printer/control/move', { x: pt.x, y: pt.y },
      { sending: 'Moving…', done: `Head moving to X ${pt.x} · Y ${pt.y}`, failed: 'Move refused' });
  }

function applyTwinOptions() {
    const o = twin.view3d;
    try { localStorage.setItem('dejavu1.twin-view', JSON.stringify(o)); } catch (e) { /* not remembered */ }
    document.querySelectorAll('#twin-case button').forEach(b => { const on = b.dataset.case === o.case; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll('#twin-more input[data-opt]').forEach(i => { i.checked = !!o[i.dataset.opt]; });
    const mv = $('twin-move');
    if (mv) { mv.setAttribute('aria-pressed', String(!!twin.moveOn)); setText(mv, twin.moveOn ? 'Moving head · done' : 'Move head'); }
    if (twin.model && twin.model.setMoveMode) twin.model.setMoveMode(twin.moveOn ? twinMoveTo : null);
    const spin = $('twin-spin');
    if (spin) { spin.setAttribute('aria-pressed', String(!!o.spin)); spin.classList.toggle('active', !!o.spin); setText(spin.querySelector('span'), o.spin ? 'Turning · stop' : 'Turn slowly'); }
    if (twin.model) { twin.model.setCaseMode(o.case); twin.model.setOptions({ print: o.print, rest: o.rest, tags: o.tags, spin: o.spin, sound: o.sound }); }
  }

  /* Feed pressed and accepted on a head: its filament starts moving in the tube and its spool turns. */
function twinFx() { return twin.model && twin.model.fxInfo ? twin.model.fxInfo() : null; }
function twinFeed(head) {
    if (twin.model && twin.model.feed) twin.model.feed(head, 'load');
  }

  /* The print on the plate, from its own G-code (backend/print_preview.py),
   * fetched once per printer and file. Without it the twin falls back to the
   * objects' outlines. */
async function syncTwinPrint(state) {
    const on = state && ['printing', 'paused', 'complete'].includes(state.state) && state.current_file;
    const key = on ? `${state.printer_id}|${state.current_file}` : '';
    if (key === twin.printKey) return;
    twin.printKey = key;
    clearTimeout(twin.printRetry);
    if (!key) { twin.printNote = null; twin.printTries = 0; if (twin.model) twin.model.setPrint(null); return; }
    twin.printNote = { text: 'Reading the file’s layers from the printer…', kind: 'ok' };
    // A read that failed may work in a moment (the printer was busy, or still reading a big file):
    // ask again after 5 s, then a little longer each time, never more than a minute apart.
    const retry = secs => {
      const wait = Math.min(60, Math.max(3, secs || 5) * Math.pow(1.6, Math.min(twin.printTries++, 6)));
      clearTimeout(twin.printRetry);
      twin.printRetry = setTimeout(() => { if (twin.printKey === key) { twin.printKey = null; syncTwinPrint(twin.state); } }, wait * 1000);
    };
    try {
      const data = await getJSON(api('/api/print/preview'));
      if (twin.printKey !== key || !twin.model) return;
      const ok = data && data.file === state.current_file && data.layers;
      twin.model.setPrint(ok ? data : null);
      if (ok) { twin.printNote = data.note ? { text: data.note, kind: 'warn' } : null; twin.printTries = 0; }
      else {
        const why = String((data && (data.reason || data.error)) || 'the printer has not sent it yet').replace(/[.\s]+$/, '');
        twin.printNote = { text: `Showing the objects’ outlines, not the print itself: ${why}.${data && data.retry_s ? ' Trying again.' : ''}`, kind: 'warn' };
        if (data && data.retry_s) retry(data.retry_s);
      }
    } catch (e) {
      if (twin.printKey !== key) return;
      twin.printNote = { text: 'Showing the objects’ outlines, not the print itself: the file’s layers could not be loaded. Trying again.', kind: 'warn' };
      retry(5);
    }
  }

function markView(name) {
    twin.view = name;
    document.querySelectorAll('#wf-views button').forEach(b => {
      const on = b.dataset.view === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
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

  /* One line under the twin: is it in step with the printer? Updated twice a second. */
function renderSync(sync) {
    const el = $('twin-sync'), note = twin.printNote;
    if (!el || (performance.now() - (twin.syncAt || 0) < 500 && !!(sync || note) === !el.hidden)) return;
    twin.syncAt = performance.now();
    el.hidden = !(sync || note);
    if (!sync) {
      // Not following a file: say why the print isn't drawn from its layers (loading, or the reason it can't be).
      if (note) {
        el.dataset.kind = note.kind;
        const t = $('twin-sync-text');
        if (t.textContent !== note.text) t.textContent = note.text;
      }
      return;
    }
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
  return { BUCKETS, REDUCED, STATE_COLOR, STATE_HEX, STATE_WORD, WF, applyTwinOptions, attention, attrs, badge,
    boxSolid, demoNeeded, dockX, downloadDrawing, drawDims, empty, enc, findPrinters, fmtHours, headSolid, hullOf,
    isLive, live, loadRegistry, markView, money, pathOf, printerName, prismSolid, projector, qs, qsa,
    renderAttention, renderChip, renderChips, renderPick, renderSync, ringSVG, setPath, showTest, since, smooth,
    sortEdges, syncTwinPrint, tintRoom, tween, twin, twinFeed, twinFx, wsState };
})();
