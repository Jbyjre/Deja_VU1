/* Deja Vu1 dashboard, part 2 of 7: the online demo's simulation.
 * Loaded right after app.js (index.html keeps the order). The parts share one global scope: names from
 * earlier parts are used here as is, and code that runs at load only calls what is already defined above.
 */
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
    if (sim.bedTarget != null) st.bed_target = sim.bedTarget;
    if (progress >= 1 && !sim.finishedLogged) { sim.finishedLogged = true; tourLog(pid, `// Print finished: ${sim.file} (online demo)`); }
  } else if (sim.mode === 'paused') {
    Object.assign(st, { state: 'paused', state_message: 'Paused from the online demo' });
    if (sim.excluded && st.objects) st.objects.excluded = sim.excluded.slice();
  } else if (sim.mode === 'ready') {
    Object.assign(st, { state: 'ready', state_message: sim.message || 'Ready', current_file: null, progress: 0, active_toolhead: null,
      layer: { current: 0, total: 0 }, print_duration_hours: 0 });
    delete st.objects;
    if (sim.parked) st.toolhead_position = sim.parked.slice();
    Object.entries(st.toolheads || {}).forEach(([name, h]) => { if (h.status === 'active') h.status = 'docked'; if (!sim.targets || !(name in sim.targets)) h.target_temperature = 0; });
  } else if (sim.mode === 'error') {
    // Halt: like the real server's M112, the printer is shut down with its heaters off until its firmware restarts.
    Object.assign(st, { state: 'error', state_message: sim.message || 'Emergency stop: Klipper is shut down. Restart the firmware to go on',
      current_file: null, progress: 0, active_toolhead: null, layer: { current: 0, total: 0 }, print_duration_hours: 0, bed_target: 0 });
    delete st.objects;
    Object.values(st.toolheads || {}).forEach(h => { h.target_temperature = 0; if (h.status === 'active') h.status = 'docked'; });
  } else if (sim.excluded && st.objects) {
    st.objects.excluded = [...new Set([...(st.objects.excluded || []), ...sim.excluded])];
  }
  if (sim.mode === 'printing' || sim.mode === 'ready' || sim.mode === 'error') { delete st.problem; delete st.problems; }
  tourTuning(st, sim.tuning);
  return st;
}
function tourTuning(st, tune) {
  if (!tune || !st.tuning) return;
  (st.tuning.leds || []).forEach(l => { if (l.id in tune.led && Array.isArray(l.color)) l.color = [l.color[0], l.color[1], l.color[2], tune.led[l.id]]; });
  (st.tuning.fans || []).forEach(f => { if (f.id in tune.fan) f.speed = tune.fan[f.id]; });
  if (typeof tune.part === 'number') st.tuning.part_fan = tune.part;
  (st.tuning.runout || []).forEach(r => { if (r.id in tune.runout) r.enabled = tune.runout[r.id]; });
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
    // Cancel parks the head just above where it was, as the printer's own cancel does, instead of letting it
    // carry on along the recorded print.
    const at = live.toolhead_position || [135, 135, 0];
    Object.assign(sim, { mode: 'ready', frozen: null, file: null, message: 'Print cancelled from the online demo',
      parked: [at[0], at[1], Math.min(270, (at[2] || 0) + 10)] });
    tourLog(pid, 'CANCEL_PRINT'); tourLog(pid, '// Print cancelled (online demo)');
    return tourDone(pid);
  }
  if (action === 'restart') {
    if (live.state !== 'error') return tourReply({ error: "The printer isn't reporting an error, so there is nothing to restart for" }, 400);
    Object.assign(sim, { mode: 'ready', frozen: null, file: null, message: 'Firmware restarted (online demo)' });
    tourLog(pid, 'FIRMWARE_RESTART'); tourLog(pid, '// Firmware restarted (online demo)');
    return tourDone(pid);
  }
  if (action === 'estop') {
    Object.assign(sim, { mode: 'error', frozen: null, file: null, targets: {}, bedTarget: 0,
      message: 'Emergency stop: Klipper is shut down. Restart the firmware to go on (online demo)' });
    tourLog(pid, 'M112'); tourLog(pid, '// Halt (online demo): the simulated printer is shut down until its firmware restarts');
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
    if (th === 'bed') { sim.bedTarget = target; tourLog(pid, `M140 S${target}`); return tourDone(pid); }
    if (!live.toolheads || !live.toolheads[th]) return tourReply({ error: `No toolhead ${th}` }, 400);
    sim.targets = { ...(sim.targets || {}) };
    Object.keys(sim.targets).forEach(k => { sim.tempFrom[k] = live.toolheads[k].temperature; });
    sim.tempFrom[th] = live.toolheads[th].temperature; sim.tempAt = Date.now(); sim.targets[th] = target;
    tourLog(pid, `SET_HEATER_TEMPERATURE HEATER=${th} TARGET=${target}`);
    return tourDone(pid);
  }
  const HANDS_ON = {
    jog: b => `G91 · G1 ${b.axis}${b.distance} · G90`, move: b => `G90 · G1 ${['x', 'y', 'z'].filter(k => b[k] != null).map(k => k.toUpperCase() + b[k]).join(' ')}`,
    'z-nudge': b => `SET_GCODE_OFFSET Z_ADJUST=${b.delta} MOVE=1`, extrude: b => `M83 · G1 E${b.length}`,
    speed: b => `M220 S${b.percent}`, flow: b => `M221 S${b.percent}`, fan: b => `M106 S${Math.round((b.percent || 0) * 2.55)}`,
    'pressure-advance': b => `SET_PRESSURE_ADVANCE ADVANCE=${b.value}`, limits: b => `SET_VELOCITY_LIMIT VELOCITY=${b.velocity} ACCEL=${b.accel}`,
    'motors-off': () => 'M84', 'bed-mesh': () => 'BED_MESH_CALIBRATE', tool: b => String(b.toolhead || ''),
    macro: b => [String(b.name || ''), ...Object.entries(b.params || {}).map(([k, v]) => `${k}=${v}`)].join(' '),
    'fan-generic': b => `SET_FAN_SPEED FAN=${b.name} SPEED=${((b.percent || 0) / 100).toFixed(2)}`,
    led: b => `SET_LED LED=${b.name} WHITE=${Number(b.white || 0).toFixed(2)}`,
    runout: b => `SET_FILAMENT_SENSOR SENSOR=${b.name} ENABLE=${b.enabled ? 1 : 0}`,
    'mesh-profile': b => b.action === 'load' ? `BED_MESH_PROFILE LOAD=${b.profile}` : 'BED_MESH_CLEAR',
    feed: b => `AUTO_FEEDING EXTRUDER=${String(b.toolhead || 'T0').slice(1)}`,
    'bed-temperature': b => `SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=${b.target}`,
  };
  if (HANDS_ON[action]) {
    // What a visitor sets on the lights, fans and sensors shows in the state (and so in the 3D twin) like a real printer's.
    const tune = sim.tuning || (sim.tuning = { led: {}, fan: {}, runout: {} });
    const name = String((body || {}).name || '');
    if (action === 'led') tune.led[name] = Math.max(0, Math.min(1, Number(body.white) || 0));
    if (action === 'fan-generic') tune.fan[name] = Math.max(0, Math.min(1, (Number(body.percent) || 0) / 100));
    if (action === 'fan') tune.part = Math.max(0, Math.min(1, (Number(body.percent) || 0) / 100));
    if (action === 'runout') tune.runout[name] = !!body.enabled;
    const moves = ['jog', 'move', 'motors-off', 'bed-mesh', 'tool', 'mesh-profile', 'feed'];
    if (moves.includes(action) && ['printing', 'paused'].includes(live.state)) return tourReply({ error: 'Not while a print is running or paused - it would move the head through the print' }, 400);
    tourLog(pid, HANDS_ON[action](body || {}));
    tourLog(pid, 'ok (online demo: nothing was sent to a printer)');
    return tourDone(pid);
  }
  if (action === 'home') {
    if (['printing', 'paused'].includes(live.state)) return tourReply({ error: 'Not while a print is running or paused - it would drive the head through the print' }, 400);
    tourLog(pid, `G28 ${(body.axes || ['X', 'Y', 'Z']).join(' ')}`); tourLog(pid, '// Homed (online demo)'); return tourDone(pid);
  }
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
/* The fleet bar (Printers): Pause, Resume, Home, Preheat and Cancel on every ticked printer, each one the
 * same simulated command as on its own Printer page, with the same words the real answer uses. */
async function tourBroadcast(body) {
  const action = String(body.action || ''), ids = Array.isArray(body.printers) ? body.printers.map(String) : [];
  const params = body.params || {};
  if (!['preheat', 'pause', 'resume', 'cancel', 'home'].includes(action)) return tourReply({ error: `Unknown action: ${action}` }, 400);
  if (!ids.length) return tourReply({ error: 'No printers to send it to' }, 400);
  const started = performance.now(), results = [];
  for (const pid of ids) {
    const name = (tourState(pid) || {}).printer_name || pid;
    let calls = [[action, action === 'home' ? { axes: ['X', 'Y', 'Z'] } : {}]];
    if (action === 'preheat') {
      const heads = Object.keys((tourState(pid) || {}).toolheads || {});
      const want = params.toolheads === 'all' ? heads : (Array.isArray(params.toolheads) ? params.toolheads : ['T0']);
      calls = want.map(th => ['temperature', { toolhead: th, target: Number(params.nozzle) }]).concat([['temperature', { toolhead: 'bed', target: Number(params.bed) }]]);
    }
    const row = { id: pid, name, ok: true, kind: 'done' };
    for (const [a, b] of calls) {
      const res = await tourControl(a, pid, b);
      const out = res ? await res.clone().json().catch(() => ({})) : {};
      if (!res || res.status >= 400) { Object.assign(row, { ok: false, kind: 'refused', error: out.error || TOUR_REFUSED }); break; }
    }
    if (row.ok) {
      row.confirmed_state = tourState(pid);
      if (action === 'preheat') {
        const st = row.confirmed_state, shown = calls.filter(c => c[1].toolhead !== 'bed').map(c => `${c[1].toolhead} ${Number(c[1].target).toFixed(0)}°C`);
        row.detail = 'Targets now ' + shown.concat([`bed ${Number(st.bed_target || params.bed || 0).toFixed(0)}°C`]).join(', ');
      }
    }
    results.push(row);
  }
  const ok = results.filter(r => r.ok), failed = results.filter(r => !r.ok), word = action[0].toUpperCase() + action.slice(1);
  const headline = !failed.length ? `${word}: all ${ok.length} printer(s) confirmed`
    : !ok.length ? `${word}: none of the ${failed.length} printer(s) did it`
      : `${word}: ${ok.length} of ${results.length} confirmed; failed on ${failed.map(r => r.name).join(', ')}`;
  return tourReply({ action, results, ok_count: ok.length, failed_count: failed.length, all_ok: !failed.length, headline,
    ms: Math.round((performance.now() - started) * 10) / 10, online_demo: true });
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
  const control = url.pathname.match(/^\/api\/printer\/control\/(pause|resume|cancel|exclude|temperature|home|gcode|start|restart|jog|move|z-nudge|extrude|speed|flow|fan|pressure-advance|limits|motors-off|bed-mesh|macro|tool|estop|bed-temperature|fan-generic|led|runout|mesh-profile|feed)$/);
  if (control) {
    const answer = await tourControl(control[1], pid, parsed);
    if (answer) { if (window.Workshop && Workshop.refreshPrinter) setTimeout(() => Workshop.refreshPrinter(), 50); return answer; }
  }
  if (url.pathname === '/api/convert') return tourConvert(parsed);
  if (url.pathname === '/api/fleet/broadcast') {
    const answer = await tourBroadcast(parsed);
    if (window.Workshop && Workshop.refreshPrinter) setTimeout(() => Workshop.refreshPrinter(), 50);
    return answer;
  }
  if (url.pathname === '/api/queue/bed-clear') {
    tour.sim.bedClear[pid] = parsed.job_key;
    return tourReply({ bed: { state: 'clear' }, printer: pid, items: [], auto_advance: false, connected: true, demo: true });
  }
  if (url.pathname === '/api/app/watch-only') return tourReply({ error: 'The online demo has no real printers to protect. Watch-only mode works in the copy you install.' }, 400);
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
  if (url.pathname === '/api/slicer/report') return tourReply({ error: 'The online demo runs in your browser and has no slicer, so there is no slicing report to make. In Deja Vu1 on your computer, this report says what ran, where it stopped and why.', online_demo: true }, 409);
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

/* Losing the server for a moment (an update restarting it, the computer waking up, the Wi-Fi blinking) is not an error the person
 * needs to see. A read is asked once more after a short wait; if that fails too it fails as a ServerLost, which every caller that
 * already says "no data" on a failed read handles as before, and which no page shows as an error. The page's watcher
 * (watchServer, app-start.js) is told at once, and it says so only if the outage lasts. */
class ServerLost extends Error {
  constructor(url) { super('Deja Vu1 did not answer'); this.name = 'ServerLost'; this.quiet = true; this.url = url; }
}
const NETWORK_LOSS = /failed to fetch|networkerror|network error|load failed|network connection was lost|err_connection|err_network|err_internet/i;
const isNetworkLoss = e => !!e && (e.quiet === true || (e instanceof TypeError && NETWORK_LOSS.test(e.message || '')));
let lostCheckAt = 0;
function checkServerSoon() {
  if (Date.now() - lostCheckAt < 2000 || typeof watchServer !== 'function') return;
  lostCheckAt = Date.now();
  setTimeout(watchServer, 300);
}
async function fetchRead(url) {
  try { return await fetch(url); } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    await new Promise(r => setTimeout(r, 700));
    try { return await fetch(url); } catch (again) {
      if (again && again.name === 'AbortError') throw again;
      checkServerSoon();
      throw new ServerLost(url);
    }
  }
}
window.addEventListener('unhandledrejection', e => { if (isNetworkLoss(e.reason)) { e.preventDefault(); checkServerSoon(); } });

async function getJSON(url) {
  if (!await serverReady()) return serverMissingBody();
  const path = url.split('?')[0];
  if (path !== '/api/modules') {
    await freshModules();
    const owner = modGate.routes[path];
    if (owner && modGate.off.has(owner)) return { error: 'Module disabled', module_disabled: true };
  }
  const response = await fetchRead(url);
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
    // A command may have reached the printer before the reply was lost, so say what isn't known.
    const control = /\/api\/printer\/(control|command|pause|resume|cancel|home)/.test(String(url));
    return { ok: false, status: 0, lost: true, body: { error: control
      ? 'Deja Vu1 didn\u2019t answer, so it isn\u2019t known whether the printer got this. Check the printer before sending it again'
      : 'Deja Vu1 didn\u2019t answer. It may be restarting; try again in a moment' } };
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
