/* Deja Vu1 dashboard logic.
 *
 * Asks the Python backend for data and draws it. Plain JavaScript - no
 * framework, no build step, nothing to install.
 *
 * The important rule here: with no printer connected, the backend returns no
 * figures at all. The dashboard shows empty states until the user explicitly
 * turns on demo data, which adds ?demo=1 to every request. Simulated numbers
 * are always badged as such.
 */

/* ---- small helpers ----------------------------------------------------- */

const $ = id => document.getElementById(id);

/* Live readings arrive four times a second. Writing the same text or
 * markup back each time still makes the browser re-measure that part of
 * the page (and restarts any animation inside replaced markup), so these
 * only touch the page when the value has actually changed. */
function setText(el, text) {
  if (!el) return;
  text = String(text);
  if (el.textContent !== text) el.textContent = text;
}
function setHTML(el, html) {
  if (!el) return;
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
}
function setVar(el, name, value) {
  if (el && el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* A file name, escaped, that may wrap after "_", "-", "." or a space and nowhere else:
 * "benchy_gear_vase.gcode" breaks before "gcode", never inside a word. */
function escName(text) {
  return esc(text).replace(/([_.\-])(?=[^_.\-])/g, '$1<wbr>');
}

/* Which module owns each data route (the server lists them with the
 * modules), and which modules are off. A route of a switched-off module
 * would only answer 403, which every browser logs as an error, so it isn't
 * asked: the caller gets the same {module_disabled: true} answer at once.
 * The picture refreshes whenever the module list is read, when a module is
 * toggled here, and at least every 20 s, so a module switched on from
 * another device is noticed. */
const modGate = { routes: {}, off: new Set(), at: 0, pending: null, idOf: {}, nameOf: {} };

function noteModules(body) {
  if (!body || !Array.isArray(body.modules)) return;
  modGate.off = new Set(body.modules.filter(m => !m.enabled).map(m => m.id));
  body.modules.forEach(m => { modGate.idOf[m.name] = m.id; modGate.nameOf[m.id] = m.name; });
  if (body.routes) modGate.routes = body.routes;
  modGate.at = Date.now();
  syncModuleBodies();
}

/* Controls that belong to a module ([data-module-body]) hide while it is
 * off, and its [data-module-off] slot says so, with the switch right there:
 * a form that could only answer "module disabled" isn't offered. */
function syncModuleBodies() {
  document.querySelectorAll('[data-module-body]').forEach(el => { el.hidden = modGate.off.has(el.dataset.moduleBody); });
  document.querySelectorAll('[data-module-off]').forEach(el => {
    const off = modGate.off.has(el.dataset.moduleOff);
    el.hidden = !off;
    if (off && !el.firstElementChild) el.innerHTML = moduleDisabledEmpty(modGate.nameOf[el.dataset.moduleOff] || 'This module');
    if (!off) el.innerHTML = '';
  });
}

function freshModules() {
  if (Date.now() - modGate.at < 20000) return null;
  if (!modGate.pending) {
    modGate.pending = fetch('/api/modules').then(r => r.json()).then(noteModules)
      .catch(() => {}).finally(() => { modGate.pending = null; });
  }
  return modGate.pending;
}

/* ---- is the dashboard server here? ----------------------------------------
 * These pages can be published on their own, with no Deja Vu1 server behind
 * them (a static host such as the public Cloudflare link). Then every /api
 * request fails, and without this check each card would quietly show
 * "No printer connected" and offer demo data that can't run. So one request
 * asks first: a JSON answer from /api/health means the server is here; a
 * network error, a 404 or a web page instead means it isn't. After that,
 * requests aren't sent at all - each caller gets the same answer at once. */
const server = { missing: false, checked: null };
const SERVER_MISSING = "The Deja Vu1 server isn't running at this address, so this part can't work here.";

function serverMissing() { return server.missing; }

function serverMissingBody() {
  return { error: SERVER_MISSING, server_missing: true, connected: false, demo: false };
}

async function checkServer() {
  let here = false;
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 8000);
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal: stop.signal });
    here = response.status !== 404 && (response.headers.get('content-type') || '').includes('application/json');
  } catch (_) {
    here = false;
  } finally {
    clearTimeout(timer);
  }
  if (!here) here = await startTour();
  server.missing = !here;
  if (server.missing) showServerMissing();
  return here;
}

/* ---- the online demo -------------------------------------------------------
 * The public Cloudflare link has no server, so instead of an empty dashboard
 * it plays a recording of the simulated farm (frontend/demo/, made by
 * tools/online-demo/record.py): every answer the dashboard asks for, for
 * each of the three simulated printers, and 150 seconds of the live feed on
 * a loop, with a jam halfway. The page answers its own /api requests from
 * the recording. The main printer actions (start, pause, resume, cancel,
 * skip an object, temperatures, homing, console) and the Bambu/MakerWorld
 * converter work in a small in-browser simulation layered over the
 * recording (tourSim, below), labelled as the demo everywhere it shows;
 * other changes say it's a recording. It starts only where no Deja Vu1
 * server answers /api/health, so a real install never plays it and never
 * shows its figures as real. */
const realFetch = window.fetch.bind(window);
const tour = { on: false, rec: null, started: 0, misses: new Set(),
  sim: { printers: {}, added: [], deleted: new Set(), console: {}, queued: {}, logbook: {}, maint: {} } };
const TOUR_SPEED = 12;          // simulated prints run at 12x so a demo visitor sees them move
const TOUR_REFUSED = "This is the online demo: a recording of the demo printers, so nothing here reaches a printer. "
  + "Run Deja Vu1 on your own computer to use this.";
const TOUR_IGNORED = new Set(['demo', 'since', 'v', 't', '_', 'device']);

function tourOn() { return tour.on; }

async function startTour() {
  try {
    const r = await realFetch('demo/recording.json', { cache: 'no-cache' });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return false;
    tour.rec = await r.json();
  } catch (_) {
    return false;
  }
  tour.on = true;
  tour.started = Date.now();
  demoOn = true;
  window.fetch = tourFetch;
  document.documentElement.classList.add('is-tour');
  showTourBar();
  setTimeout(() => {
    const toggle = $('demo-toggle');
    if (toggle) { toggle.checked = true; toggle.disabled = true; toggle.title = 'The online demo always shows the demo printers'; }
    if (window.Workshop) Workshop.reconnect();
  }, 0);
  return true;
}

/* The same key as tools/online-demo/record.py key_for(). */
function tourKey(path, params) {
  const kept = [...params.entries()].filter(([k]) => !TOUR_IGNORED.has(k)).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return path + (kept.length ? '?' + kept.map(([k, v]) => `${k}=${v}`).join('&') : '');
}

function tourReply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function tourFrame() {
  const frames = tour.rec.frames, step = (tour.rec.step || 1) * 1000;
  const n = Math.floor((Date.now() - tour.started) / step);
  return { at: n, i: n % frames.length, loop: Math.floor(n / frames.length), frame: frames[n % frames.length] };
}

// Events replay each time round the loop, with fresh ids so the dashboard
// treats them as new.
function tourEvents(since) {
  const { at, loop } = tourFrame(), len = tour.rec.frames.length, out = [];
  [loop - 1, loop].forEach(l => {
    if (l < 0) return;
    tour.rec.events.forEach(({ frame, event }) => {
      const id = l * 100000 + event.id;
      // Stamped with the time it happens in this playback, not when it was recorded.
      const when = new Date(tour.started + (l * len + frame) * (tour.rec.step || 1) * 1000);
      const local = new Date(when.getTime() - when.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
      if (l * len + frame <= at && id > since) out.push({ ...event, id, time: local });
    });
  });
  return out;
}

async function tourText(name) {
  const r = await realFetch(`demo/files/${encodeURIComponent(name)}`);
  return r.ok ? r.text() : null;
}

async function tourGet(url) {
  const path = url.pathname, q = url.searchParams;
  const printer = q.get('printer') || tour.rec.default_printer;
  if (path === '/api/live/snapshot') return tourReply({ seq: tourFrame().at, t: Date.now() / 1000, state: tourState(printer), event_id: 0, time_scale: 1 });
  if (path === '/api/printer') return tourReply({ ...tourState(printer), connected: true, demo: true });
  if (path === '/api/fleet') return tourReply({ printers: tourFrame().frame.fleet.map(tourFleetCard) });
  if (path === '/api/printer/control/console') return tourReply({ log: tourConsole(printer), connected: true, demo: true });
  if (path === '/api/fleet/queues' || path === '/api/queue') {
    const rec = tour.rec.get[tourKey(path, new URLSearchParams({ printer }))];
    if (rec !== undefined) {
      const body = JSON.parse(JSON.stringify(tour.rec.bodies[rec].body));
      const extra = pid => (tour.sim.queued[pid] || []);
      if (path === '/api/queue' && Array.isArray(body.items)) body.items = body.items.concat(extra(printer));
      if (path === '/api/fleet/queues' && body.queues) Object.entries(body.queues).forEach(([pid, q]) => { q.items = (q.items || []).concat(extra(pid)); });
      return tourReply(body, tour.rec.bodies[rec].status);
    }
  }
  if (path === '/api/maintenance' || path === '/api/maintenance/history') {
    // "Mark done" in the online demo: the recorded task starts its count again here.
    const rec = tour.rec.get[tourKey(path, new URLSearchParams({ printer }))];
    const done = tour.sim.maint[printer] || [];
    if (rec !== undefined && done.length) {
      const body = JSON.parse(JSON.stringify(tour.rec.bodies[rec].body));
      if (path === '/api/maintenance/history') {
        body.history = done.slice().reverse().concat(body.history || []);
      } else if (Array.isArray(body.tasks)) {
        body.tasks.forEach(t => {
          const d = done.find(x => x.task_id === t.id);
          if (!d) return;
          const reset = r => r.replace(/^[\d.]+ of/, '0 of');
          Object.assign(t, { status: 'ok', percent: 0, last_done_at: d.completed_at, reason: reset(t.reason || ''),
            all_reasons: (t.all_reasons || []).map(reset), usage_since: { days_since: 0, hours_since: 0, prints_since: 0 } });
        });
        body.summary = { overdue: 0, due_soon: 0, ok: 0 };
        body.tasks.forEach(t => { body.summary[t.status] = (body.summary[t.status] || 0) + 1; });
      }
      return tourReply(body, tour.rec.bodies[rec].status);
    }
  }
  if (path === '/api/logbook') {
    const mine = (tour.sim.logbook[printer] || []).slice().reverse(), q = (url.searchParams.get('q') || '').toLowerCase().split(/\s+/).filter(Boolean);
    const rows = mine.filter(e => q.every(w => (e.problem + ' ' + e.fix).toLowerCase().includes(w)));
    return tourReply({ printer, entries: rows, open: rows.filter(e => !e.fix).length, connected: true, demo: true });
  }
  if (path === '/api/files') {
    const base = tour.rec.get[tourKey(path, new URLSearchParams({ printer }))];
    if (base !== undefined) {
      const body = JSON.parse(JSON.stringify(tour.rec.bodies[base].body));
      if (Array.isArray(body.files)) {
        body.files = body.files.filter(f => !tour.sim.deleted.has(f.name)).concat(tour.sim.added.filter(f => !body.files.some(b => b.name === f.name)));
      }
      return tourReply(body, tour.rec.bodies[base].status);
    }
  }
  if (path === '/api/live/events') return tourReply({ events: tourEvents(+(q.get('since') || 0)) });
  if (path === '/api/files/raw') return realFetch(`demo/files/${encodeURIComponent(q.get('name') || '')}`);
  if (path === '/api/files/thumb') return realFetch(`demo/thumbs/${encodeURIComponent(q.get('name') || '')}.png`);
  if (path === '/api/files/lines') {
    // The same answer as gcode_tools.view_lines on the server.
    const text = await tourText(q.get('name') || '');
    if (text === null) return tourReply({ error: 'File not found' }, 404);
    const lines = text.split(/\r\n|\r|\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const offset = Math.max(0, +(q.get('offset') || 0)), limit = Math.max(1, Math.min(1000, +(q.get('limit') || 200)));
    const find = (q.get('q') || '').toLowerCase();
    if (find) {
      const hits = [];
      lines.forEach((l, i) => { if (l.toLowerCase().includes(find)) hits.push(i); });
      return tourReply({ total: lines.length, matches: hits.length, lines: hits.slice(0, limit).map(i => ({ n: i + 1, text: lines[i] })) });
    }
    return tourReply({ total: lines.length, offset, lines: lines.slice(offset, offset + limit).map((text, i) => ({ n: offset + i + 1, text })) });
  }
  const params = new URLSearchParams(q);
  params.set('printer', printer);
  const hit = tour.rec.get[tourKey(path, params)];
  if (hit === undefined) tour.misses.add(tourKey(path, params));
  if (hit === undefined) return tourReply({ error: "This part isn't in the online demo's recording", connected: false, demo: false }, 404);
  const { status, body } = await tourBody(hit);
  return tourReply(body, status);
}

/* Large recorded answers live in their own files (record.py, LARGE). */
const tourLarge = new Map();
async function tourBody(hit) {
  const { status, body } = tour.rec.bodies[hit];
  if (!body || !body.__file__) return { status, body };
  if (!tourLarge.has(hit)) tourLarge.set(hit, realFetch('demo/' + body.__file__).then(r => r.json()));
  return { status, body: await tourLarge.get(hit) };
}
async function tourAnswerFull(key) {
  const hit = tour.rec.get[key];
  return hit === undefined ? null : tourBody(hit);
}

/* ---- the online demo's simulation ------------------------------------------
 * A thin layer of changes over the recorded state, one per printer: a print
 * started here, a pause, a cancel, a skipped object, new heater targets.
 * Everything it shows says "online demo"; nothing leaves the browser. */
function tourAnswer(key) {
  const hit = tour.rec.get[key];
  return hit === undefined ? null : tour.rec.bodies[hit];
}
function tourLog(pid, text) {
  const list = tour.sim.console[pid] || (tour.sim.console[pid] = []);
  const t = new Date();
  list.push({ time: t.toTimeString().slice(0, 8), detail: text, kind: 'online demo' });
  if (list.length > 60) list.shift();
}
function tourConsole(pid) {
  const rec = tourAnswer(tourKey('/api/printer/control/console', new URLSearchParams({ printer: pid })));
  const base = rec && Array.isArray(rec.body.log) ? rec.body.log : [];
  return base.concat(tour.sim.console[pid] || []);
}
function tourState(pid) {
  const base = tourFrame().frame.state[pid];
  const sim = tour.sim.printers[pid];
  if (!base || !sim) return base;
  const now = Date.now();
  const st = JSON.parse(JSON.stringify(sim.frozen || base));
  if (sim.targets) {
    Object.entries(sim.targets).forEach(([th, target]) => {
      const head = st.toolheads && st.toolheads[th];
      if (!head) return;
      const from = sim.tempFrom[th] ?? head.temperature, secs = (now - sim.tempAt) / 1000;
      head.target_temperature = target;
      head.temperature = Math.round((target + (from - target) * Math.exp(-secs / 9)) * 10) / 10;
    });
  }
  if (sim.mode === 'printing' && sim.file) {
    const elapsedH = (now - sim.startedAt) / 3600000 * TOUR_SPEED + (sim.doneBefore || 0);
    const progress = Math.min(1, elapsedH / sim.totalHours);
    Object.assign(st, { state: progress >= 1 ? 'complete' : 'printing', current_file: sim.file, progress,
      print_duration_hours: Math.round(elapsedH * 1000) / 1000,
      state_message: progress >= 1 ? `Finished ${sim.file} (online demo)` : `Printing layer ${Math.max(1, Math.ceil(progress * sim.layers))} of ${sim.layers} · online demo, ${TOUR_SPEED}× speed`,
      layer: { current: Math.max(1, Math.ceil(progress * sim.layers)), total: sim.layers }, active_toolhead: sim.tool || 'T0' });
    st.objects = { list: sim.objects || [], excluded: sim.excluded || [], current: (sim.objects || []).find(o => !(sim.excluded || []).includes(o.name))?.name || null };
    const th = st.toolheads && st.toolheads[st.active_toolhead];
    if (th) { th.status = 'active'; th.target_temperature = th.target_temperature || 220; }
    st.bed_target = 60;
    if (progress >= 1 && !sim.finishedLogged) { sim.finishedLogged = true; tourLog(pid, `// Print finished: ${sim.file} (online demo)`); }
  } else if (sim.mode === 'paused') {
    Object.assign(st, { state: 'paused', state_message: 'Paused from the online demo' });
    if (sim.excluded && st.objects) st.objects.excluded = sim.excluded.slice();
  } else if (sim.mode === 'ready') {
    Object.assign(st, { state: 'ready', state_message: sim.message || 'Ready', current_file: null, progress: 0, active_toolhead: null,
      layer: { current: 0, total: 0 }, print_duration_hours: 0 });
    delete st.objects;
    Object.entries(st.toolheads || {}).forEach(([name, h]) => { if (h.status === 'active') h.status = 'docked'; if (!sim.targets || !(name in sim.targets)) h.target_temperature = 0; });
  } else if (sim.excluded && st.objects) {
    st.objects.excluded = [...new Set([...(st.objects.excluded || []), ...sim.excluded])];
  }
  return st;
}
function tourFleetCard(card) {
  if (!tour.sim.printers[card.id]) return card;
  const st = tourState(card.id), out = { ...card };
  Object.assign(out, { state: st.state, state_message: st.state_message, current_file: st.current_file, progress: st.progress,
    active_toolhead: st.active_toolhead });
  if (st.state === 'printing' && tour.sim.printers[card.id].totalHours) {
    out.remaining_hours = Math.max(0, tour.sim.printers[card.id].totalHours * (1 - st.progress));
  } else if (st.state !== 'printing') out.remaining_hours = null;
  return out;
}
function tourSimFor(pid) {
  return tour.sim.printers[pid] || (tour.sim.printers[pid] = { tempFrom: {}, tempAt: Date.now() });
}
function tourDone(pid, extra = {}) {
  return tourReply({ ok: true, online_demo: true, ...extra, confirmed_state: tourState(pid), server_ms: 0, connected: true, demo: true });
}
async function tourControl(action, pid, body) {
  const live = tourState(pid), sim = tourSimFor(pid);
  if (action === 'pause') {
    if (live.state !== 'printing') return tourReply({ error: `Nothing to pause: the printer is ${live.state}` }, 409);
    sim.frozen = JSON.parse(JSON.stringify(live));
    if (sim.mode === 'printing') sim.doneBefore = live.print_duration_hours;
    sim.mode = 'paused'; tourLog(pid, 'PAUSE'); tourLog(pid, '// Print paused (online demo)');
    return tourDone(pid);
  }
  if (action === 'resume') {
    if (live.state !== 'paused') return tourReply({ error: `Nothing to resume: the printer is ${live.state}` }, 409);
    sim.frozen = null;
    if (sim.file) { sim.mode = 'printing'; sim.startedAt = Date.now(); } else sim.mode = 'recorded';
    if (!sim.file && tourFrame().frame.state[pid].state === 'paused') {
      // A print that was paused in the recording: carry on from where it stopped.
      sim.file = live.current_file; sim.totalHours = Math.max(0.2, (live.print_duration_hours || 1) / Math.max(0.05, live.progress || 0.5));
      sim.doneBefore = live.print_duration_hours || 0; sim.layers = (live.layer && live.layer.total) || 100; sim.startedAt = Date.now();
      sim.objects = live.objects ? live.objects.list : []; sim.mode = 'printing';
    }
    tourLog(pid, 'RESUME'); tourLog(pid, '// Print resumed (online demo)');
    return tourDone(pid);
  }
  if (action === 'cancel') {
    if (!['printing', 'paused'].includes(live.state)) return tourReply({ error: `Nothing to cancel: the printer is ${live.state}` }, 409);
    Object.assign(sim, { mode: 'ready', frozen: null, file: null, message: 'Print cancelled from the online demo' });
    tourLog(pid, 'CANCEL_PRINT'); tourLog(pid, '// Print cancelled (online demo)');
    return tourDone(pid);
  }
  if (action === 'restart') {
    if (live.state !== 'error') return tourReply({ error: "The printer isn't reporting an error, so there is nothing to restart for" }, 400);
    Object.assign(sim, { mode: 'ready', frozen: null, file: null, message: 'Firmware restarted (online demo)' });
    tourLog(pid, 'FIRMWARE_RESTART'); tourLog(pid, '// Firmware restarted (online demo)');
    return tourDone(pid);
  }
  if (action === 'exclude') {
    const name = String(body.name || '');
    const objs = live.objects && live.objects.list || [];
    if (!objs.some(o => o.name === name)) return tourReply({ error: `No object called ${name} on this plate` }, 400);
    sim.excluded = [...new Set([...(sim.excluded || []), name])];
    if (sim.frozen && sim.frozen.objects) sim.frozen.objects.excluded = sim.excluded.slice();
    tourLog(pid, `EXCLUDE_OBJECT NAME=${name}`);
    return tourDone(pid);
  }
  if (action === 'temperature') {
    const th = String(body.toolhead || ''), target = Number(body.target);
    if (!(target >= 0 && target <= (th === 'bed' ? 110 : 300))) return tourReply({ error: 'Target must be between 0 and 300 °C (bed 110 °C)' }, 400);
    if (th === 'bed') { tourLog(pid, `M140 S${target}`); return tourDone(pid); }
    if (!live.toolheads || !live.toolheads[th]) return tourReply({ error: `No toolhead ${th}` }, 400);
    sim.targets = { ...(sim.targets || {}) };
    Object.keys(sim.targets).forEach(k => { sim.tempFrom[k] = live.toolheads[k].temperature; });
    sim.tempFrom[th] = live.toolheads[th].temperature; sim.tempAt = Date.now(); sim.targets[th] = target;
    tourLog(pid, `SET_HEATER_TEMPERATURE HEATER=${th} TARGET=${target}`);
    return tourDone(pid);
  }
  if (action === 'home') { tourLog(pid, `G28 ${(body.axes || ['X', 'Y', 'Z']).join(' ')}`); tourLog(pid, '// Homed (online demo)'); return tourDone(pid); }
  if (action === 'gcode') {
    const cmd = String(body.command || '').trim().slice(0, 200);
    if (!cmd) return tourReply({ error: 'Type a command first' }, 400);
    tourLog(pid, cmd); tourLog(pid, 'ok (online demo: nothing was sent to a printer)');
    return tourDone(pid);
  }
  if (action === 'start') {
    const name = String(body.filename || '');
    if (!['ready', 'complete', 'cancelled', 'standby'].includes(live.state)) return tourReply({ error: `The printer is busy (${live.state}${live.current_file ? ` ${live.current_file}` : ''})` }, 409);
    const gate = tourAnswer(tourKey('/api/print/confirm', new URLSearchParams({ file: name, printer: pid })));
    if (gate && gate.body && gate.body.verdict === 'blocked') return tourReply({ error: 'Confirm Print blocked this file: ' + (gate.body.blocking || []).join('; ') }, 409);
    if (!body.confirmed) return tourReply({ error: 'Review Confirm Print first' }, 409);
    const an = await tourAnswerFull(tourKey('/api/files/analysis', new URLSearchParams({ name, printer: pid })));
    const a = an && an.body || {};
    Object.assign(sim, { mode: 'printing', frozen: null, file: name, startedAt: Date.now(), doneBefore: 0, finishedLogged: false,
      totalHours: Math.max(0.05, a.estimated_hours || 0.5), layers: a.layers || 100, excluded: [],
      tool: (a.tools_used && a.tools_used[0]) || 'T0',
      objects: (a.objects || []).map(o => ({ name: o.name, center: o.center, polygon: o.polygon })) });
    tourLog(pid, `SDCARD_PRINT_FILE FILENAME="${name}"`); tourLog(pid, `// Print started (online demo, ${TOUR_SPEED}× speed)`);
    return tourDone(pid);
  }
  return null;
}
function tourConvert(body) {
  const name = String(body.name || '');
  const rec = (tour.rec.posts || {})['/api/convert?name=' + name];
  if (!rec) return tourReply({ error: 'In the online demo the converter runs on the sample MakerWorld, Bambu Studio and Elegoo projects. '
    + 'Run Deja Vu1 at home to convert your own files.', code: 'ONLINE_DEMO', stage: 'Online demo' }, 409);
  if (rec.status === 200 && rec.body.file) {
    const entry = (tour.rec.converted || {})[rec.body.file.name];
    if (entry && !tour.sim.added.some(f => f.name === entry.name)) tour.sim.added.push(entry);
    tour.sim.deleted.delete(rec.body.file.name);
  }
  return tourReply(rec.body, rec.status);
}

async function tourPost(url, body) {
  if (url.pathname === '/api/tools/layer-plan' && typeof planLayers === 'function') {
    try { return tourReply(planLayers(JSON.parse(body || '{}'))); }
    catch (err) { return tourReply({ error: err.message }, 400); }
  }
  let parsed = {};
  try { parsed = JSON.parse(body || '{}'); } catch (_) { parsed = {}; }
  const pid = url.searchParams.get('printer') || (typeof currentPrinter !== 'undefined' && currentPrinter) || tour.rec.default_printer;
  const control = url.pathname.match(/^\/api\/printer\/control\/(pause|resume|cancel|exclude|temperature|home|gcode|start)$/);
  if (control) {
    const answer = await tourControl(control[1], pid, parsed);
    if (answer) { if (window.Workshop && Workshop.refreshPrinter) setTimeout(() => Workshop.refreshPrinter(), 50); return answer; }
  }
  if (url.pathname === '/api/convert') return tourConvert(parsed);
  if (url.pathname === '/api/maintenance/done') {
    const rec = tour.rec.get[tourKey('/api/maintenance', new URLSearchParams({ printer: pid }))];
    const task = rec !== undefined && (tour.rec.bodies[rec].body.tasks || []).find(t => t.id === parsed.task_id);
    if (!task) return tourReply({ error: 'That task is not on this printer' }, 400);
    const list = (tour.sim.maint[pid] || (tour.sim.maint[pid] = [])).filter(x => x.task_id !== task.id);
    list.push({ task_id: task.id, task_name: `${task.name} (online demo)`, printer_hours_at_completion: null,
      completed_at: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19) });
    tour.sim.maint[pid] = list;
    return tourReply({ ok: true, online_demo: true });
  }
  if (url.pathname.startsWith('/api/logbook')) {
    const list = tour.sim.logbook[pid] || (tour.sim.logbook[pid] = []);
    if (url.pathname === '/api/logbook/add') {
      const problem = String(parsed.problem || '').trim().slice(0, 600);
      if (!problem) return tourReply({ error: 'Say what happened' }, 400);
      const e = { id: 'demo' + Date.now(), at: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19), print_hours: null, problem, fix: String(parsed.fix || '').trim().slice(0, 600), tags: [], auto: false, demo: true };
      list.push(e);
      return tourReply(e);
    }
    const m = url.pathname.match(/^\/api\/logbook\/([^/]+)\/(fix|delete)$/), at = m ? list.findIndex(e => e.id === decodeURIComponent(m[1])) : -1;
    if (at < 0) return tourReply({ error: 'That logbook entry no longer exists' }, 404);
    if (m[2] === 'fix') { list[at].fix = String(parsed.fix || '').trim().slice(0, 600); return tourReply(list[at]); }
    list.splice(at, 1);
    return tourReply({ deleted: m[1] });
  }
  if (url.pathname === '/api/fleet/route') {
    const to = String(parsed.to || ''), name = String(parsed.filename || '');
    const target = tour.rec.printers.includes(to) ? to : null;
    if (!target) return tourReply({ error: 'Choose one of the demo printers' }, 400);
    if (!(tour.rec.files || []).includes(name) && !tour.sim.added.some(f => f.name === name)) return tourReply({ error: `${name} isn't in the demo library` }, 400);
    const list = tour.sim.queued[target] || (tour.sim.queued[target] = []);
    list.push({ id: 'demo-' + Date.now(), filename: name, status: 'queued', note: 'online demo', added_at: new Date().toISOString().slice(0, 19), online_demo: true });
    return tourReply({ routed: name, to: target, online_demo: true });
  }
  if (url.pathname === '/api/slicer/find') return tourReply({ error: 'The online demo runs in your browser, so there is no computer here to search. In Deja Vu1 on your computer, this looks in your Applications, Downloads and program folders.', online_demo: true }, 409);
  if (url.pathname === '/api/files/opened') return tourReply({ ok: true, online_demo: true });
  if (url.pathname === '/api/files/delete') {
    const name = String(parsed.name || '');
    tour.sim.deleted.add(name); tour.sim.added = tour.sim.added.filter(f => f.name !== name);
    return tourReply({ ok: true, online_demo: true, deleted: name });
  }
  return tourReply({ error: TOUR_REFUSED, online_demo: true }, 409);
}

function tourFetch(input, init) {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
  const method = ((init && init.method) || 'GET').toUpperCase();
  return Promise.resolve(method === 'GET' ? tourGet(url) : tourPost(url, init && init.body));
}

function showTourBar() {
  if ($('tour-bar')) return;
  const bar = document.createElement('section');
  bar.id = 'tour-bar';
  bar.className = 'server-banner tour-bar liquid-glass';
  bar.setAttribute('aria-label', 'Online demo');
  const r = tour.rec, minutes = Math.round(r.frames.length * (r.step || 1) / 6) / 10;
  bar.innerHTML = `<span class="notice-mark" aria-hidden="true">i</span>
    <div class="sbn-body">
      <p><strong>Online demo.</strong> <span class="notice-long">A recording of ${r.printers.length} demo printers that loops every
        ${minutes} minutes, and one jams halfway. Click anything: what would change something says so,
        because nothing here reaches a printer.</span><span class="notice-short">${r.printers.length} demo printers, recorded. Nothing here reaches a printer.</span></p>
      <p><a href="https://github.com/Jbyjre/Deja_VU1/blob/main/docs/getting-started.md">Run it with your own printer</a>
        &middot; <a href="welcome.html">What Deja Vu1 is</a></p>
    </div>`;
  const anchor = $('server-banner');
  if (anchor) anchor.before(bar); else document.body.prepend(bar);
}

function serverReady() {
  if (!server.checked) server.checked = checkServer();
  return server.checked;
}

async function getJSON(url) {
  if (!await serverReady()) return serverMissingBody();
  const path = url.split('?')[0];
  if (path !== '/api/modules') {
    await freshModules();
    const owner = modGate.routes[path];
    if (owner && modGate.off.has(owner)) return { error: 'Module disabled', module_disabled: true };
  }
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && body.pairing_required) showPairGate();
  if (path === '/api/modules') noteModules(body);
  return body;
}

/* The device lock (backend/pairing.py): an unpaired device is asked for a
 * pairing code instead of being shown empty screens. Pairing sets the
 * device's key as a cookie, then the page reloads with access. */
let pairGateShown = false;
function showPairGate() {
  const dlg = $('pair-gate');
  if (!dlg || pairGateShown) return;
  pairGateShown = true;
  if (!dlg.open) { try { dlg.showModal(); } catch (_) { dlg.setAttribute('open', ''); } }
  dlg.addEventListener('cancel', e => e.preventDefault());
  $('pair-gate-form').onsubmit = async (e) => {
    e.preventDefault();
    const code = $('pair-gate-code').value.replace(/\s/g, '');
    $('pair-gate-go').disabled = true;
    const r = await fetch('/api/pairing/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, device_name: $('pair-gate-name').value.trim() || (navigator.userAgent.includes('Mobile') ? 'Phone' : 'Browser') }) })
      .then(async res => ({ ok: res.ok, body: await res.json().catch(() => ({})) })).catch(() => ({ ok: false, body: {} }));
    $('pair-gate-go').disabled = false;
    if (r.ok) { $('pair-gate-error').textContent = 'Paired. Opening the dashboard…'; location.reload(); return; }
    $('pair-gate-error').textContent = r.body.error || 'That code did not work. Check it and try again.';
  };
}

async function postJSON(url, payload) {
  if (!await serverReady()) return { ok: false, status: 0, body: serverMissingBody() };
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  } catch (_) {
    // The server stopped, or Wi-Fi dropped. Report it like any refusal so
    // no button is left saying "Sending…" forever.
    return { ok: false, status: 0, body: { error: "Couldn't reach the dashboard server - is it still running?" } };
  }
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && body.pairing_required) showPairGate();
  const toggled = url.split('?')[0].match(/^\/api\/modules\/([\w-]+)\/toggle$/);
  if (toggled && response.ok) {
    if (payload && payload.enabled) modGate.off.delete(toggled[1]); else modGate.off.add(toggled[1]);
    syncModuleBodies();
  }
  return { ok: response.ok, status: response.status, body };
}

/* localStorage can throw (private browsing in some browsers, or site data
 * blocked). Remembered choices are a convenience, so a failure here must
 * never stop the dashboard loading. */
const store = {
  get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* not remembered */ } },
};

const STORE_KEY = 'dejavu1.demo';
let demoOn = store.get(STORE_KEY) === '1';

/* A real printer (added by address) with its connection open. Live figures
 * come from either source: demo data, or a connected printer. */
let realOn = false;
function liveData() { return demoOn || realOn; }

/* Which printer the whole dashboard is looking at. Every request carries
 * ?printer=<id>, and the server answers every module for that printer. */
const PRINTER_KEY = 'dejavu1.printer';
let currentPrinter = store.get(PRINTER_KEY) || '';

function api(path) {
  const params = [];
  if (demoOn) params.push('demo=1');
  if (currentPrinter) params.push(`printer=${encodeURIComponent(currentPrinter)}`);
  return params.length ? path + (path.includes('?') ? '&' : '?') + params.join('&') : path;
}

/* ---- announcements --------------------------------------------------------
 * One polite live region for toasts, so screen-reader users hear the same
 * "Paused - confirmed" or "Pause failed" a sighted user sees. */

/* Copy text for a bug report. navigator.clipboard only exists on https://
 * and localhost, and a phone on the LAN reaches this over plain http, so
 * fall back to the old select-and-copy - and say so if both are refused. */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch (_) { /* fall through to the fallback */ }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
  area.remove();
  return ok;
}

function toast(message, kind = 'info', ms = 4200, options) {
  // The notification orb (orb.js) shows and keeps every message when it is loaded.
  if (window.Orb) return Orb.notify(message, kind, ms, options);
  const host = $('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast liquid-glass is-${kind}`;
  el.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 400); }, ms);
}

/* ---- honest commands --------------------------------------------------------
 * Every control action follows the same three steps, and never skips one:
 *   1. the button says what is being sent, straight away ("Pausing…")
 *   2. the server sends the command, then re-reads the printer
 *   3. the button shows what the printer now actually reports - or the
 *      failure, in words, if the printer refused or the request failed.
 * The UI never flips to "Paused" because the button was pressed; only
 * because the printer said so. */

async function runCommand(button, path, body, labels) {
  const original = button ? button.textContent : '';
  const started = performance.now();
  if (button) {
    button.disabled = true;
    button.dataset.phase = 'sending';
    button.textContent = labels.sending;
  }
  let result;
  try {
    result = await postJSON(api(path), body || {});
  } catch (err) {
    result = { ok: false, status: 0, body: { error: 'Could not reach the dashboard server' } };
  }
  const ms = Math.round(performance.now() - started);
  if (button) delete button.dataset.phase;
  if (!result.ok) {
    const why = result.body.error || `HTTP ${result.status}`;
    if (button) { button.textContent = original; button.disabled = false; button.dataset.phase = 'failed'; setTimeout(() => delete button.dataset.phase, 2400); }
    toast(`${labels.failed}: ${why}`, 'bad', 7000);
    if (window.Workshop) Workshop.refreshPrinter();
    return { ok: false, result };
  }
  const state = result.body.confirmed_state;
  const confirmed = !labels.expect || (state && labels.expect(state));
  if (state && window.Workshop) Workshop.applyState(state, true);
  if (button) { button.textContent = original; button.disabled = false; button.dataset.phase = confirmed ? 'done' : 'failed'; setTimeout(() => delete button.dataset.phase, 1600); }
  // "Confirmed by the printer" only when the printer's own state was read
  // back and checked - saving a rule or a queue entry is not a printer act.
  if (confirmed && labels.expect && state) toast(`${labels.done}: confirmed by the printer in ${ms} ms`, 'ok');
  else if (confirmed) toast(`${labels.done} (${ms} ms)`, 'ok');
  else toast(`${labels.done.split(' ')[0]} sent, but the printer now reports "${state ? state.state : 'unknown'}"`, 'warn', 7000);
  return { ok: true, result, confirmed };
}

function hasData(payload) {
  return payload && payload.connected !== undefined
    ? (payload.connected || payload.demo)
    : Boolean(payload);
}

function isModuleDisabled(payload) {
  return Boolean(payload && payload.module_disabled);
}

/* Every switched-off panel, old or new, reads the same way: which module,
 * where its switch lives, and the switch itself. */
function moduleDisabledEmpty(name) {
  const id = modGate.idOf[name];
  return `
  <div class="empty is-off">
    <span class="empty-mark" aria-hidden="true"></span>
    <p class="empty-title">${esc(name)}</p>
    <p class="empty-sub">Switched off in Settings → Modules.</p>
    ${id ? `<button class="btn small" type="button" data-turn-on="${esc(id)}">Turn on</button>` : ''}
  </div>`;
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest && e.target.closest('[data-turn-on]');
  if (!btn || btn.disabled) return;
  const id = btn.dataset.turnOn;
  btn.disabled = true;
  btn.textContent = 'Turning on…';
  const { ok, body } = await postJSON(api(`/api/modules/${id}/toggle`), { enabled: true });
  if (!ok) {
    btn.disabled = false;
    btn.textContent = 'Turn on';
    toast(`Couldn't turn it on: ${body.error || 'the server refused'}`, 'bad', 6000);
    return;
  }
  toast(`${modGate.nameOf[id] || 'Module'} is on`, 'ok', 2200);
  await refreshAll();
  if (window.showTab) window.showTab(store.get(TAB_KEY) || 'overview');
});

const STATUS_TEXT = { overdue: 'Overdue', due_soon: 'Due soon', ok: 'OK' };

function stagger(nodes, step = 45) {
  nodes.forEach((node, i) => { node.style.animationDelay = `${i * step}ms`; });
}

/* Panels on the five-second refresh used to rebuild their rows every time,
 * so each row replayed its entrance animation and the panel visibly
 * flickered. paint() leaves an unchanged panel alone, and once a panel has
 * shown its rows it marks itself settled, which turns the entrance
 * animation off for later updates (style.css, .is-settled). Returns true
 * when it painted for the first time, so callers stagger only then. */
const painted = new WeakMap();
function paint(host, html) {
  if (!host || painted.get(host) === html) return false;
  const first = !painted.has(host);
  host.classList.toggle('is-settled', !first);
  host.innerHTML = html;
  painted.set(host, html);
  return first;
}

const EMPTY = (title, sub) => {
  // Every "No printer connected" card names an added printer that isn't answering instead.
  const away = title === 'No printer connected' && unreachablePrinter();
  if (away) [title, sub] = unreachableWords(away);
  return `
  <div class="empty">
    <span class="empty-mark" aria-hidden="true"></span>
    <p class="empty-title">${esc(title)}</p>
    <p class="empty-sub">${esc(sub)}</p>
  </div>`;
};

/* ---- temperature units --------------------------------------------------
 * A real user-facing preference: stored per-viewer, used everywhere a
 * temperature is displayed. */

const UNIT_KEY = 'dejavu1.units';
let tempUnit = store.get(UNIT_KEY) === 'F' ? 'F' : 'C';

function formatTemp(celsius) {
  if (celsius === null || celsius === undefined) return '—';
  const value = tempUnit === 'F' ? (celsius * 9 / 5) + 32 : celsius;
  return `${value.toFixed(0)}°${tempUnit}`;
}

/* When a print should finish, as a time on the clock rather than a duration:
 * "4:12 PM", "tomorrow 1:05 AM", or "Sat 9:40 AM" further out. Empty when
 * there is no estimate. The estimate is the one used everywhere else here
 * (elapsed time scaled by progress), so it is only as good as that. */
function doneAt(hoursLeft) {
  if (hoursLeft == null || !isFinite(hoursLeft) || hoursLeft < 0) return '';
  const at = new Date(Date.now() + hoursLeft * 3600e3);
  const clock = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(at) - day(new Date())) / 864e5);
  if (days === 0) return clock;
  if (days === 1) return `tomorrow ${clock}`;
  return `${at.toLocaleDateString([], { weekday: 'short' })} ${clock}`;
}

/* Time left from a printer state: elapsed time scaled by progress, the same
 * estimate the fleet uses (backend/fleet.py). Null when there isn't one. */
function hoursLeft(state) {
  const p = state && state.progress, elapsed = state && state.print_duration_hours;
  return state && state.state === 'printing' && p > 0 && p < 1 && elapsed != null ? elapsed / p - elapsed : null;
}

/* ---- the browser tab mirrors the print -------------------------------------
 * With the dashboard in a background tab, its title and icon still say how
 * the print is going: "46% · Demo printer 1", "Paused · …", "Finished · …".
 * The icon draws the same progress ring. Both change only when what they
 * show changes, not on every live update. */
const BASE_TITLE = document.title;
const tabMirror = { title: null, icon: null };
function mirrorInTab(data) {
  const s = data && data.state;
  const name = (data && data.printer_name) || 'Printer';
  const pct = s ? Math.round((data.progress || 0) * 100) : 0;
  const lead = { printing: `${pct}%`, paused: 'Paused', complete: 'Finished', error: 'Needs attention' }[s];
  const title = lead ? `${lead} · ${name} · Deja Vu1` : BASE_TITLE;
  if (title !== tabMirror.title) { document.title = title; tabMirror.title = title; }

  // Redrawn per whole percent, not per live update.
  const key = `${s}|${pct}|${document.documentElement.style.getPropertyValue('--accent')}`;
  if (key === tabMirror.icon) return;
  tabMirror.icon = key;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4a8df8';
  const color = { paused: '#d9a400', error: '#e5483e', complete: '#2fa84f' }[s] || accent;
  const frac = s === 'printing' || s === 'paused' ? Math.max(0.02, pct / 100) : s === 'complete' ? 1 : 0;
  const c = 2 * Math.PI * 12;
  const ring = frac
    ? `<circle cx='16' cy='16' r='12' fill='none' stroke='${color}' stroke-opacity='.22' stroke-width='5'/>` +
      `<circle cx='16' cy='16' r='12' fill='none' stroke='${color}' stroke-width='5' stroke-linecap='round' stroke-dasharray='${(c * frac).toFixed(1)} ${c.toFixed(1)}' transform='rotate(-90 16 16)'/>`
    : `<circle cx='16' cy='16' r='12' fill='none' stroke='${color}' stroke-width='4'/>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>${ring}<circle cx='16' cy='16' r='5' fill='${color}'/></svg>`;
  const link = document.querySelector('link[rel="icon"]');
  if (link) link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/* ---- accent colour -------------------------------------------------------
 * A real user-facing preference: swaps the CSS custom properties every
 * accent-coloured element already reads from. */

// Blue is the default. Each accent carries its own text-on-fill colour
// ("on") and text colour, measured for WCAG AA against it.
const ACCENTS = [
  { id: 'blue', label: 'Sky Blue', hex: '#4a8df8', light: '#7db2ff', on: '#04122b', text: '#1d5fc8' },
  { id: 'orange', label: 'Snapmaker Orange', hex: '#ff7a2f', light: '#ff9c66', on: '#2a1200', text: '#a8430a' },
  { id: 'red', label: 'Signal Red', hex: '#c8102e', light: '#d42640', on: '#ffffff', text: '#a50d26' },
  { id: 'green', label: 'Grass Green', hex: '#2f9e44', light: '#5cc16f', on: '#04200c', text: '#1d6d31' },
];
// Only a colour you picked is remembered. (The old key was written on every
// load, so every browser had "orange" stored whether or not it was chosen;
// a deliberate red or green there is still honoured.)
const ACCENT_KEY = 'dejavu1.accent-choice';
const OLD_ACCENT_KEY = 'dejavu1.accent';

function applyAccent(id) {
  const accent = ACCENTS.find(a => a.id === id) || ACCENTS[0];
  document.documentElement.style.setProperty('--accent', accent.hex);
  document.documentElement.style.setProperty('--accent-light', accent.light);
  document.documentElement.style.setProperty('--on-accent', accent.on);
  document.documentElement.style.setProperty('--accent-text', accent.text);
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
    btn.addEventListener('click', () => { applyAccent(btn.dataset.accent); store.set(ACCENT_KEY, btn.dataset.accent); });
  });
  const old = store.get(OLD_ACCENT_KEY);
  applyAccent(store.get(ACCENT_KEY) || (old === 'red' || old === 'green' ? old : 'blue'));

  const setUnits = (unit) => {
    tempUnit = unit;
    store.set(UNIT_KEY, unit);
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
  if (data.server_missing) return;          // showServerMissing() has said so already
  const pill = $('conn');
  const label = $('conn-label');
  const wasReal = realOn;
  realOn = !!data.connected || (data.printers || []).some(p => p.connected);
  // A printer connecting (or dropping) while the page is open: open or
  // close the live connection to match, without waiting for a reload.
  if (wasReal !== realOn && window.Workshop) setTimeout(() => Workshop.reconnect(), 0);

  if (data.connected) {
    pill.classList.remove('is-demo');
    label.textContent = 'Connected';
    $('foot-state').textContent = 'Connected to Moonraker.';
  } else if (demoOn) {
    pill.classList.add('is-demo');
    label.textContent = 'Simulated';
    $('foot-state').textContent = 'Demo data: no printer connected, nothing is contacted.';
  } else {
    pill.classList.remove('is-demo');
    label.textContent = 'Not connected';
    $('foot-state').textContent = (data.printers || []).length
      ? data.message : 'No printer connected. Nothing is contacted.';
  }

  $('notice').hidden = !(demoOn && !data.connected);
}

/* ---- no server: a browser-only preview ----------------------------------
 * One banner says what's missing and what still works. Every card that
 * needs the server keeps its heading (so you can see what the dashboard
 * does) and says so in one line, instead of an empty box or an offer of
 * demo data that can't run. Demo data is switched off, not hidden: the
 * simulated printers live on the server too. */
const RUN_IT_URL = 'https://github.com/Jbyjre/Deja_VU1#how-to-run-it';
const BROWSER_ONLY = '[data-browser-only], [data-module-off], #sb-off, #ap-off, #demo-tools-card, #file-detail';

function needsServerNote(what) {
  return `<p class="needs-server-note">${what ? `${esc(what)} needs` : 'Needs'} the Deja Vu1 server, which isn't running at this address.
    <a href="${RUN_IT_URL}" target="_blank" rel="noopener">How to run it</a></p>`;
}

function needsServerEmpty(what) {
  return `
  <div class="empty is-off">
    <span class="empty-mark" aria-hidden="true"></span>
    <p class="empty-title">Needs the Deja Vu1 server</p>
    <p class="empty-sub">${esc(what ? `${what[0].toUpperCase()}${what.slice(1)} runs` : 'This runs')} on the server, which isn't running at this address.
      <a href="${RUN_IT_URL}" target="_blank" rel="noopener">How to run it</a></p>
  </div>`;
}

/* Printers added by address, from the dashboard's own list (/api/fleet/registry,
 * loaded by workshop.js): names and link words, never printer figures. */
let addedPrinters = [];

/* The added printer this screen is waiting for, when none of them answers. With
 * demo data off, "No printer connected" would read as if it had been removed. */
function unreachablePrinter() {
  if (demoOn || serverMissing() || !addedPrinters.length || addedPrinters.some(p => p.connected)) return null;
  return addedPrinters.find(p => p.id === currentPrinter) || addedPrinters[0];
}

async function loadAddedPrinters() {
  const data = await getJSON('/api/fleet/registry').catch(() => null);
  if (data && Array.isArray(data.printers)) addedPrinters = data.printers;
}

/* [title, sub] for a printer that was added but isn't answering. */
function unreachableWords(p) {
  const why = String(p.link || '').replace(/^Not connected:\s*/i, '').replace(/[.\s]+$/, '');
  if (!why || /^connecting/i.test(why)) {
    return [`Connecting to ${p.name}…`, 'This takes a few seconds once it is switched on.'];
  }
  return [`${p.name} isn't answering`,
    `${why}. Check it is switched on and on the same network. The dashboard keeps trying by itself.`];
}

/* "No printer" wording, unless there's no server to have a printer at all. */
function noPrinterEmpty(sub, what) {
  return serverMissing() ? needsServerEmpty(what) : EMPTY('No printer connected', sub);
}

function showServerMissing() {
  document.body.classList.add('no-server');
  $('server-banner').hidden = false;
  $('notice').hidden = true;

  const toggle = $('demo-toggle');
  demoOn = false;                       // the remembered choice is kept for when the server is back
  toggle.checked = false;
  toggle.disabled = true;
  toggle.closest('.switch').title = 'Demo data runs on the Deja Vu1 server, which isn\'t running at this address.';
  toggle.setAttribute('aria-describedby', 'server-banner-text');

  const pill = $('conn');
  pill.classList.remove('is-demo');
  pill.classList.add('is-offline');
  $('conn-label').textContent = 'No server';
  $('printer-chip').hidden = true;
  $('foot-state').textContent = 'Browser-only preview: the Deja Vu1 server isn\'t running at this address.';
  $('rb-text').textContent = 'Browser-only preview - no printer or demo farm without the server.';

  document.querySelectorAll('.tab-panel section.card').forEach(card => {
    if (card.matches(BROWSER_ONLY) || card.querySelector(':scope > .needs-server-note')) return;
    card.classList.add('needs-server');
    const head = card.querySelector(':scope > .card-head');
    if (head) head.insertAdjacentHTML('afterend', needsServerNote());
    else card.insertAdjacentHTML('afterbegin', needsServerNote(card.dataset.serverWhat || card.querySelector('h2')?.textContent.trim()));
  });
  if (window.Workshop) Workshop.reconnect();
}

function initServerBanner() {
  document.querySelectorAll('#server-banner [data-go]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.go)));
  $('server-retry').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Checking…';
    let here = false;
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      here = r.status !== 404 && (r.headers.get('content-type') || '').includes('application/json');
    } catch (_) { here = false; }
    if (here) { location.reload(); return; }
    btn.disabled = false; btn.textContent = 'Check again';
    toast('Still no server at this address.', 'warn');
  });
}

/* ---- tabs -----------------------------------------------------------------*/

const TAB_KEY = 'dejavu1.tab';
/* One plain sentence per tab, shown under the tab bar, so a first-time
   visitor knows what each section is for before reading it. */
const TAB_NAMES = { overview: 'Overview', fleet: 'Printers', control: 'Control', files: 'Files', studio: 'Photo studio',
  automations: 'Automations', maintenance: 'Care', modules: 'Settings', games: 'Games' };
const TAB_INTROS = {
  overview: 'What needs you, then the printer you picked: its live 3D model, controls and health.',
  fleet: 'All your printers side by side. Add a printer here, or practise on pretend ones.',
  control: 'Drive the printer you picked: pause, skip a failed object, temperatures and moving the head. If the printer says no, you see why.',
  files: 'Your print files. Look inside them, prepare and slice models, and queue prints. Every print gets checked before it starts.',
  studio: 'Turn a photo into a colour print, using the filaments you have loaded.',
  automations: '“When this happens, do that” rules, like a message when a print finishes. They run on this computer, not in the cloud.',
  maintenance: 'Keep the printer in shape: upkeep reminders from real print hours, a logbook, and your spools.',
  modules: 'Updates, how the dashboard looks, which features are on, your phone and messages.',
  games: 'Something to play while a print runs. Nothing here touches a printer.',
};

/* ---- sections: one part of a busy screen at a time -------------------------
   Screens with many cards open on their first part, with a row of buttons
   for the others and "Everything" for the old long page. Cards are sorted
   by their title (or id), so a card another script adds later lands in its
   part; a card no rule names joins the first part, so nothing is ever lost.
   Anything that scrolls to a card in a hidden part (search, tours, "Slice…"
   buttons) opens that part first. */
const SECTIONS = {
  overview: [
    ['now', 'Right now', ['#attention', '#twin-card', 'printer control', 'print health', 'use this dashboard']],
    ['live', 'Live readings', ['#telemetry', 'chamber climate']],
    ['history', 'History & upkeep', ['.stats', '#insights-card', 'maintenance', 'print cost']],
  ],
  fleet: [
    ['printers', 'Your printers', ['your printers', 'add a printer']],
    ['desk', 'Farm desk', ['#tab-desk', 'farm history']],
    ['sandbox', 'Practice farm', ['#tab-sandbox']],
  ],
  files: [
    ['library', 'Your files', ['#orca-import', '#convert-card', 'file library', 'print queue', '#file-detail']],
    ['slicing', 'Slicing', ['#tab-autoprint']],
    ['layers', 'Layer heights', ['#tab-layerplan']],
  ],
  maintenance: [
    ['upkeep', 'Upkeep', ['maintenance', '#logbook', 'swapped a nozzle']],
    ['filament', 'Filament & colour', ['#tab-filament']],
  ],
  modules: [
    ['copy', 'This copy', ['your space', '#phone-install-card', '#version-card', '#desktop-card', '#about-card', '#memory-card', 'printer firmware', '#demo-tools-card']],
    ['look', 'Look & feel', ['#appearance-card', 'preferences']],
    ['features', 'Features', ['modules', 'print cost pricing']],
    ['phone', 'Phone & away', ['paired devices', '#remote-card']],
    ['alerts', 'Alerts & smart home', ['notifications', 'wled bridge', 'home assistant bridge']],
    ['camera', 'Camera', ['camera', 'time-lapses']],
  ],
};
const SECTION_KEY = 'dejavu1.section.';
// Fixed ids for each screen's row of parts, so tours can point at them.
const SECTION_BAR_IDS = { overview: 'sec-overview', fleet: 'sec-fleet', files: 'sec-files', maintenance: 'sec-maintenance', modules: 'sec-modules' };

window.Sections = (() => {
  const chosen = {};
  const UNIT = 'section.card, section.stats, .tab-sub';
  const unitsOf = panel => [...panel.querySelectorAll(UNIT)].filter(u => !u.parentElement.closest(UNIT));
  const titleOf = u => (u.querySelector('h2')?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const matches = (u, rule, title) => rule[0] === '#' ? u.id === rule.slice(1)
    : rule[0] === '.' ? u.classList.contains(rule.slice(1)) : title.startsWith(rule);
  function groupOf(tab, unit) {
    const title = titleOf(unit);
    const hit = SECTIONS[tab].find(([, , rules]) => rules.some(r => matches(unit, r, title)));
    return (hit || SECTIONS[tab][0])[0];
  }
  function apply(tab) {
    const panel = $(`tab-${tab}`), groups = SECTIONS[tab];
    if (!panel || !groups) return;
    const now = chosen[tab];
    panel.classList.toggle('sec-one', now !== 'all');
    const units = unitsOf(panel);
    const wrappers = new Set();
    units.forEach(u => {
      u.classList.toggle('sec-off', now !== 'all' && groupOf(tab, u) !== now);
      for (let p = u.parentElement; p && p !== panel; p = p.parentElement) wrappers.add(p);
    });
    // A grid or column whose every card is in another part goes too, so no gap is left.
    wrappers.forEach(w => w.classList.toggle('sec-off', units.some(u => w.contains(u)) && units.every(u => !w.contains(u) || u.classList.contains('sec-off'))));
    // A two-column row left with one card gives it the whole width.
    panel.querySelectorAll('.grid-2').forEach(g => g.classList.toggle('sec-single',
      [...g.children].filter(c => !c.hidden && !c.classList.contains('sec-off')).length === 1));
    panel.querySelectorAll('.sec-bar button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sec === now)));
  }
  function choose(tab, key, remember = true) {
    if (!SECTIONS[tab] || (key !== 'all' && !SECTIONS[tab].some(([k]) => k === key))) return;
    const panel = $(`tab-${tab}`), was = new Set(unitsOf(panel).filter(u => u.classList.contains('sec-off')));
    chosen[tab] = key;
    if (remember) store.set(SECTION_KEY + tab, key);
    apply(tab);
    // Only the cards that just appeared fade in; the 5-second refresh never replays it.
    unitsOf(panel).filter(u => was.has(u) && !u.classList.contains('sec-off')).forEach(u => {
      u.classList.remove('sec-enter'); void u.offsetWidth; u.classList.add('sec-enter');
      const done = e => { if (e.target === u) { u.classList.remove('sec-enter'); u.removeEventListener('animationend', done); } };
      u.addEventListener('animationend', done);
    });
  }
  /* Opens the part that holds `el`, so it can be seen. */
  function reveal(el) {
    const panel = el?.closest?.('.tab-panel');
    const tab = panel?.id.replace(/^tab-/, '');
    if (!tab || !SECTIONS[tab] || !el.closest('.sec-off')) return;
    const unit = el.matches(UNIT) && !el.parentElement.closest(UNIT) ? el : unitsOf(panel).find(u => u.contains(el));
    if (unit) choose(tab, groupOf(tab, unit));
  }
  function init() {
    for (const tab of Object.keys(SECTIONS)) {
      const panel = $(`tab-${tab}`);
      if (!panel) continue;
      const saved = store.get(SECTION_KEY + tab);
      chosen[tab] = saved === 'all' || SECTIONS[tab].some(([k]) => k === saved) ? saved : SECTIONS[tab][0][0];
      const bar = document.createElement('nav');
      bar.className = 'sec-bar'; bar.id = SECTION_BAR_IDS[tab]; bar.setAttribute('aria-label', `Parts of ${TAB_NAMES[tab] || tab}`);
      bar.innerHTML = `<div class="sec-track">${[...SECTIONS[tab], ['all', 'Everything']].map(([k, label]) =>
        `<button type="button" data-sec="${k}" aria-pressed="false"${k === 'all' ? ' class="sec-all"' : ''}>${esc(label)}</button>`).join('')}</div>`;
      bar.addEventListener('click', e => {
        const b = e.target.closest('button[data-sec]');
        if (!b) return;
        choose(tab, b.dataset.sec);
        b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
      panel.prepend(bar);
      apply(tab);
      // Cards drawn later (telemetry, logbook, the farm desk…) are sorted as they arrive.
      let queued = 0;
      new MutationObserver(records => {
        if (queued || !records.some(r => [...r.addedNodes].some(n => n.nodeType === 1 && n.matches(UNIT)))) return;
        queued = requestAnimationFrame(() => { queued = 0; apply(tab); });
      }).observe(panel, { childList: true, subtree: true });
    }
    // Every way of jumping to a card (search, tours, links) goes through scrollIntoView.
    const scrollTo = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
      if (this.closest && this.closest('.sec-off')) reveal(this);
      return scrollTo.apply(this, args);
    };
  }
  return { init, reveal, choose, current: tab => chosen[tab] };
})();

function initTabs() {
  Sections.init();
  const tabs = document.querySelectorAll('.navtab[data-tab]');
  const panels = document.querySelectorAll('.tab-panel');

  // Sections folded into another tab: their old names (a remembered tab,
  // a "Slice…" button, another device's handoff) open the parent tab and
  // scroll to the section.
  const FOLDED = { sandbox: 'fleet', autoprint: 'files', filament: 'maintenance' };

  function show(requested) {
    const name = FOLDED[requested] || requested;
    tabs.forEach(t => {
      t.classList.toggle('active', t.dataset.tab === name);
      if (t.dataset.tab === name) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    panels.forEach(p => { p.hidden = p.id !== `tab-${name}`; });
    store.set(TAB_KEY, name);
    document.body.dataset.tab = name;
    const intro = $('tab-intro');
    if (intro && TAB_INTROS[name]) intro.innerHTML = `<strong>${esc(TAB_NAMES[name] || name)}</strong> ${esc(TAB_INTROS[name])}`
      + (window.Guide && Guide.has(name) ? ` <button type="button" class="tips-btn" data-tips="${esc(name)}"><span aria-hidden="true">✦</span> Show me this screen</button>` : '');
    if (name === 'games') startCurrentGame();
    else stopCurrentGame();
    if (window.Workshop) Workshop.onTab(name);
    // A folded section's old name opens its part; after a short wait (the
    // cards above it fill in first) it scrolls there, so it doesn't slide away.
    if (FOLDED[requested]) {
      Sections.reveal($(`tab-${requested}`)?.querySelector('h2') || $(`tab-${requested}`));
      setTimeout(() => $(`tab-${requested}`)?.scrollIntoView({ block: 'start' }), 350);
    }
  }
  window.showTab = show;

  tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
  $('overview-pair-btn').addEventListener('click', () => window.Phone && Phone.open());

  show(store.get(TAB_KEY) || 'overview');
}

/* ---- status ribbon (always visible) --------------------------------------*/

let lastPrinterState = null;

async function loadStatusRibbon() {
  renderStatusRibbon(await getJSON(api('/api/printer')));
}

function renderStatusRibbon(data) {
  const ribbon = $('status-ribbon');
  const text = $('rb-text');
  const bar = $('rb-bar');
  const fill = $('rb-bar-fill');
  const pct = $('rb-pct');

  if (!hasData(data) || !data.state) {
    ribbon.classList.remove('is-live');
    const away = unreachablePrinter();
    text.textContent = serverMissing() ? 'Browser-only preview - no printer or demo farm without the server.'
      : away ? `${unreachableWords(away)[0]}. Retrying by itself.` : 'No printer connected.';
    bar.hidden = true;
    pct.hidden = true;
    $('rb-done').hidden = true;
    lastPrinterState = null;
    mirrorInTab(null);
    renderOverviewControl(null);
    return;
  }

  lastPrinterState = data;
  mirrorInTab(data);
  const isPrinting = data.state === 'printing';
  ribbon.classList.toggle('is-live', isPrinting);

  if (data.state === 'ready' || data.state === 'error') {
    setText(text, data.state === 'error' ? `Error: ${data.state_message || ''}` : 'Idle: no print running.');
    bar.hidden = true; pct.hidden = true; $('rb-done').hidden = true;
  } else {
    const word = { paused: 'Paused', complete: 'Finished' }[data.state] || 'Printing';
    const who = data.printer_name ? data.printer_name + ' · ' : '';
    setText(text, `${who}${word}: ${data.current_file || 'unknown file'}` + (data.link_lost ? ' · no live link, last reading' : ''));
    bar.hidden = false; pct.hidden = false;
    // Eases like the other progress visuals (Workshop.tween: each frame
    // closes a fixed fraction of the gap), so switching printers glides.
    const setFill = v => { fill.style.width = `${(v * 100).toFixed(2)}%`; };
    if (window.Workshop && Workshop.tween) Workshop.tween('ribbon', data.progress, setFill); else setFill(data.progress);
    setText(pct, `${Math.round(data.progress * 100)}%`);
    const finish = doneAt(hoursLeft(data));
    setText($('rb-done'), finish ? `done ${finish}` : '');
    $('rb-done').hidden = !finish;
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
    paint($('overview-maintenance'), moduleDisabledEmpty('Maintenance reminders'));
    return;
  }

  if (!hasData(data) || !data.tasks) {
    clearStats();
    $('tasks').innerHTML = EMPTY('No printer connected',
      'Maintenance reminders appear once print history is available. Turn on demo data to preview them.');
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
  $('stat-due-foot').textContent = `${data.summary.due_soon} due soon`;

  document.querySelectorAll('.stat').forEach(t => t.classList.remove('is-empty'));
  $('stat-due').closest('.stat').classList.toggle('is-alert', data.summary.overdue > 0);

  $('tasks').innerHTML = data.tasks.map(renderTaskRow).join('');
  stagger([...document.querySelectorAll('#tasks .task')]);
  document.querySelectorAll('#tasks .btn').forEach(button => {
    button.addEventListener('click', () => markDone(button));
  });

  // Overview tab gets the top 3 most urgent, read-only.
  paint($('overview-maintenance'), data.tasks.length
    ? data.tasks.slice(0, 3).map(t => `
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

async function loadColorCheck() {
  const data = await getJSON(api('/api/colorcheck'));

  if (isModuleDisabled(data)) {
    $('colorfile').hidden = true;
    paint($('colors'), moduleDisabledEmpty('Right colour loaded?'));
    $('colors-note').hidden = true;
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
  const dotColor = state.state === 'printing' ? 'var(--ok)' : (state.state === 'paused' ? 'var(--warn)' : (state.state === 'error' ? 'var(--bad)' : 'var(--text-faint)'));
  if (dot.style.background !== dotColor) dot.style.background = dotColor;
  setText(text, state.state === 'ready' ? 'Idle' : `${state.state[0].toUpperCase()}${state.state.slice(1)}: ${state.current_file || state.state_message || ''}`);
  setText(sub, lost ? linkLostWords(state) : running ? `${Math.round(state.progress * 100)}% · ${(state.print_duration_hours || 0).toFixed(1)}h elapsed` : (state.state === 'complete' ? 'Finished.' : 'No job running.'));

  // A button that is mid-send keeps its "Pausing…" until the printer answers.
  if (pauseResume.dataset.phase !== 'sending') {
    if (pauseResume.disabled !== !running) pauseResume.disabled = !running;
    setText(pauseResume, state.state === 'paused' ? 'Resume' : 'Pause');
  }
  pauseResume.onclick = () => controlAction(state.state === 'paused' ? 'resume' : 'pause', pauseResume);
  if (cancel.dataset.phase !== 'sending' && cancel.disabled !== !running) cancel.disabled = !running;
  cancel.onclick = () => confirmCancel(cancel);

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
  gcodeInput.onkeydown = (e) => { if (e.key === 'Enter') sendGcode(); };

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
        <div style="display:flex; gap:6px; margin-top:8px;">
          <label class="sr-only" for="target-${esc(th)}">${esc(th)} target temperature</label>
          <input type="number" inputmode="decimal" placeholder="target" id="target-${esc(th)}" data-toolhead="${esc(th)}" style="width:100%; font-size:12px;">
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
      <div style="display:flex; gap:8px;">
        <button class="btn primary" id="ov-pause-resume" style="flex:1;">Pause</button>
        <button class="btn danger" id="ov-cancel" style="flex:1;">Cancel</button>
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
  setText($('ov-file'), running || state.state === 'complete' ? (state.current_file || '') : 'Idle');
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
      'Check it is switched on and on the same network. The dashboard keeps trying by itself.';
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

async function sendGcode() {
  const input = $('gcode-input');
  const command = input.value.trim();
  if (!command) return;
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
  if (data.spoolman && data.spoolman.url && !$('spoolman-url').value) $('spoolman-url').value = data.spoolman.url;
  host.innerHTML = spools.length ? spools.map(s => `
    <div class="spool-row">
      <span class="spool-swatch" style="background:${esc(s.color_hex || '#888')}"></span>
      <span class="spool-name">${esc(s.color_name)} ${esc(s.material)}${s.spoolman_id ? ` <small class="spool-src" title="Imported from Spoolman (spool ${esc(s.spoolman_id)})">Spoolman</small>` : ''}</span>
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
    idleNote.textContent = `${idle[0].color_name} has been loaded ${idle[0].days_loaded.toFixed(0)} days. Worth checking it hasn't absorbed moisture.`;
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
    const r = await postJSON(api('/api/filament/spools'), {
      material, color_name: colorName, color_hex: colorHex, grams_remaining: grams,
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
      + (b.unknown_weight ? ` ${b.unknown_weight} had no weight in Spoolman - set it there or weigh them here.` : '')
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
      rows.push(`<div class="crow" style="border-left:3px solid var(--ok);">${sanityData.colour_measured === false
        ? 'Safe to print: maintenance and docks check out. Colour wasn’t measured (no sensor fitted); Confirm Print still compares the file with what the printer reports loaded.'
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
        <input type="checkbox" ${m.enabled ? 'checked' : ''} data-module="${esc(m.id)}" aria-label="${esc(m.name)}">
        <span class="switch-track ${m.enabled ? 'is-on' : ''}" aria-hidden="true"><span class="switch-knob"></span></span>
      </label>
    </div>`).join('')
    // A phone shows the first few; the rest are one tap away (theme.css).
    + `<button type="button" class="btn block mod-more" aria-expanded="false">Show all ${(data.modules || []).length} modules</button>`;
  host.querySelector('.mod-more').addEventListener('click', e => {
    const open = host.classList.toggle('is-open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
    e.currentTarget.textContent = open ? 'Show fewer' : `Show all ${(data.modules || []).length} modules`;
  });

  // The switch stays where you put it but dims while the server saves it;
  // if the server says no, it goes back and says why.
  host.querySelectorAll('[data-module]').forEach(input => {
    input.addEventListener('change', async () => {
      const want = input.checked;
      input.disabled = true;
      const { ok, body } = await postJSON(api(`/api/modules/${input.dataset.module}/toggle`), { enabled: want });
      if (!ok) {
        input.checked = !want;
        input.disabled = false;
        toast(`Couldn't turn ${input.getAttribute('aria-label')} ${want ? 'on' : 'off'}: ${body.error || 'the server refused'}`, 'bad', 6000);
        return;
      }
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
 * The arcade lives in games.js (two thirds of what this file used to be), so
 * the dashboard starts without it. These two stand-ins are replaced by the
 * real ones when games.js loads. */
let gamesLoading = null;
function loadGames() {
  if (!gamesLoading) gamesLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'games.js';
    s.onload = resolve;
    s.onerror = () => { gamesLoading = null; s.remove(); reject(new Error('games.js did not load')); };
    document.head.appendChild(s);
  });
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

/* ---- start up ------------------------------------------------------------*/

/* These same files are also published as a plain website (wrangler.jsonc ->
 * Cloudflare), with no Python server behind them. There the dashboard has
 * nothing to show, so it hands over to the product page. Only a 404 for
 * /api/modules means "no Deja Vu1 server here" (a static host answers
 * that for any file it doesn't have); a server that is down or unreachable
 * keeps the dashboard and its "Could not reach the backend" message.
 * ?demo (the online demo: a recording of the simulated farm, see "the
 * online demo" above) and ?dashboard skip the hand-over. */
if (!['dashboard', 'demo'].some(k => new URLSearchParams(location.search).has(k))) {
  fetch('/api/modules', { cache: 'no-store' })
    .then(r => { if (r.status === 404) location.replace('welcome.html'); })
    .catch(() => {});
}

async function refreshAll() {
  try {
    await loadConnection();
    // Before the cards draw: an added printer that isn't answering is named in them.
    if (!liveData()) await loadAddedPrinters();
    await Promise.all([
      loadMaintenance(), loadRings(), loadColorCheck(), loadStatusRibbon(),
      loadFilament(), loadCompare(), loadModules(), loadDevices(),
      loadUpdates(), loadPrinterControl(), loadCost(),
    ]);
    if (window.Workshop) await Workshop.refresh();
    $('stamp').textContent = new Date().toLocaleTimeString();
  } catch (err) {
    console.error('Dashboard failed to load:', err);
    $('foot-state').textContent = 'Could not reach the backend.';
  }
}

/* Segmented controls mark the chosen option with .active; screen readers
 * need that as aria-pressed. One observer keeps the two in step for every
 * .pill-toggle, whichever code changed it. */
function initPressedSync() {
  const sync = b => b.setAttribute('aria-pressed', String(b.classList.contains('active')));
  const watch = new MutationObserver(records => records.forEach(r => { if (r.target.tagName === 'BUTTON') sync(r.target); }));
  document.querySelectorAll('.pill-toggle').forEach(group => {
    group.querySelectorAll('button').forEach(sync);
    watch.observe(group, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
}

function initDemoToggle() {
  const toggle = $('demo-toggle');
  toggle.checked = demoOn;
  toggle.addEventListener('change', () => {
    demoOn = toggle.checked;
    store.set(STORE_KEY, demoOn ? '1' : '0');
    if (window.Workshop) Workshop.reconnect();
    refreshAll();
  });
}

serverReady();
initServerBanner();
initDemoToggle();
initPressedSync();
initTabs();
initPreferences();
initSpoolForm();
initRepeatSettings();
initPairing();
initNotifications();
initCostSettings();
initBridges();
// initGames() now runs inside games.js when the Games tab first opens.
trackHighlights();
refreshAll();
loadNotificationSettings();

// Printer state itself arrives live (workshop.js, every 250 ms over the
// WebSocket). These slower panels only need a periodic refresh.
setInterval(() => {
  loadConnection().catch(() => {});
  if (liveData()) {
    loadRings(); loadColorCheck(); loadCost();
    if (!window.Workshop || !Workshop.isLive()) loadStatusRibbon();
  }
}, 5000);
