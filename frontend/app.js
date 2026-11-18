/* The dashboard logic is split into seven files, loaded in this order by index.html: app.js, app-demo.js,
 * app-shell.js, app-modules.js, app-print.js, app-extras.js, app-start.js.
 * They are classic scripts sharing one global scope, so a name defined in an earlier file is used in a later one
 * as is.
 * This file: small helpers, the server check and the online demo's routing.
 */
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
const modGate = { routes: {}, off: new Set(), at: 0, pending: null, idOf: {}, nameOf: {}, kindOf: {} };

function noteModules(body) {
  if (!body || !Array.isArray(body.modules)) return;
  modGate.off = new Set(body.modules.filter(m => !m.enabled).map(m => m.id));
  body.modules.forEach(m => { modGate.idOf[m.name] = m.id; modGate.nameOf[m.id] = m.name; modGate.kindOf[m.id] = m.kind; });
  if (body.routes) modGate.routes = body.routes;
  modGate.at = Date.now();
  syncModuleBodies();
  syncSettingSwitches();
}

/* The few features that are ordinary settings (the camera, time-lapses, continue on another
 * device) have their switch in their own card: <input data-setting-module="camera">. */
function syncSettingSwitches() {
  document.querySelectorAll('[data-setting-module]').forEach(input => {
    if (!input.disabled) input.checked = !modGate.off.has(input.dataset.settingModule);
  });
}
document.addEventListener('change', async e => {
  const input = e.target.closest && e.target.closest('[data-setting-module]');
  if (!input) return;
  const id = input.dataset.settingModule, want = input.checked, name = input.dataset.settingName || 'This setting';
  input.disabled = true;
  const { ok, body } = await postJSON(api(`/api/modules/${id}/toggle`), { enabled: want });
  input.disabled = false;
  if (!ok) {
    input.checked = !want;
    toast(`Couldn't change ${name.toLowerCase()}: ${body.error || 'the server refused'}`, 'bad', 6000);
    return;
  }
  if (want) modGate.off.delete(id); else modGate.off.add(id);
  syncModuleBodies();
  toast(`${name} is ${want ? 'on' : 'off'}`, 'ok', 2200);
  refreshAll();
});

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
  sim: { printers: {}, added: [], deleted: new Set(), console: {}, queued: {}, logbook: {}, maint: {}, bedClear: {} } };
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
      // "Part removed, bed clear" in the online demo: the recorded hold clears here.
      const cleared = (q, pid) => { if (q.bed && q.bed.state === 'awaiting_clear' && tour.sim.bedClear[pid] === q.bed.job_key) q.bed = { state: 'clear', file: q.bed.file }; };
      if (path === '/api/queue' && Array.isArray(body.items)) { body.items = body.items.concat(extra(printer)); cleared(body, printer); }
      if (path === '/api/fleet/queues' && body.queues) Object.entries(body.queues).forEach(([pid, q]) => { q.items = (q.items || []).concat(extra(pid)); cleared(q, pid); });
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
  if (path === '/api/print/preview') {
    // The layers of whatever file is on the plate here: a print started in the demo is drawn from its own
    // G-code, like the recorded one, not from the recording's.
    const file = tourState(printer).current_file;
    if (!file) return tourReply({ file: null, reason: 'Nothing is printing' });
    const hit = tour.rec.get[tourKey(path, new URLSearchParams({ printer, file }))];
    if (hit === undefined) return tourReply({ file, reason: `the online demo holds no copy of ${file}` });
    const { status, body } = await tourBody(hit);
    return tourReply(body, status);
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
