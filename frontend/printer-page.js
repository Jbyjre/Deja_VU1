/* Printer page and Overview cards.
 *
 * The Printer tab (data-tab "control") is one printer's own page: the twin with
 * the camera and the movement pad beside it, then temperatures, extruding,
 * tuning, the printer's own buttons and the console. Overview is a page of
 * cards about what is happening now. Both draw from the live state that
 * workshop.js hands out (dv-state for the selected printer, dv-fleet for all).
 *
 * Every control goes through runCommand (app.js): the button says what is being
 * sent, the server checks the values and sends standard Klipper G-code, and the
 * printer's own answer (or refusal, in words) is what the page then shows.
 */
'use strict';
window.PrinterPage = (() => {
  const PRESET_KEY = 'dejavu1.presets';
  const STEP_KEY = 'dejavu1.jogstep';
  // Starting points people can change in Preferences: the usual nozzle and bed
  // temperatures printed on most spools of these materials.
  const DEFAULT_PRESETS = [
    { name: 'PLA', nozzle: 210, bed: 60 },
    { name: 'PETG', nozzle: 240, bed: 80 },
    { name: 'TPU', nozzle: 225, bed: 50 },
  ];
  const STEPS = [0.1, 1, 10, 100];
  const WORD = { printing: 'Printing', paused: 'Paused', error: 'Stopped', complete: 'Finished', ready: 'Ready' };
  let state = null, fleet = [];

  const num = (v, d = 0) => v == null || !isFinite(v) ? '—' : Number(v).toFixed(d);
  const busy = s => s && (s.state === 'printing' || s.state === 'paused');
  const canDrive = s => s && s.state && !s.link_lost;

  function presets() {
    try {
      const saved = JSON.parse(store.get(PRESET_KEY) || 'null');
      if (Array.isArray(saved) && saved.length) return saved.slice(0, 6);
    } catch (e) { /* a damaged value falls back to the defaults */ }
    return DEFAULT_PRESETS;
  }

  /* Hours as people say them: 0:45 is "45 min", 2.5 is "2 h 30 min". */
  function hoursWords(h) {
    if (h == null || !isFinite(h)) return '';
    const m = Math.max(0, Math.round(h * 60));
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  }

  /* ---- the camera view ------------------------------------------------------
   * One small player per place (Overview card, beside the twin). It uses the
   * camera stream address when one is saved (real video through the relay),
   * otherwise asks the printer for one picture after another, as soon as the
   * last has arrived, instead of waiting a fixed second and a half. It runs only
   * while it can be seen, and stops when the tab or the browser is hidden. */
  const cams = [];
  function initCam(host) {
    host.innerHTML = `<div class="pcam-frame" data-mode="off">
        <img class="pcam-img" alt="Live picture from the selected printer's camera" hidden>
        <span class="pcam-empty">Camera off</span>
        <span class="pcam-mode" role="status"></span>
        <button class="pcam-toggle" type="button" aria-pressed="false">Turn camera on</button>
      </div><p class="pcam-note" hidden></p>`;
    const saved = store.get(`dejavu1.cam.${host.dataset.cam}`);
    const cam = { host, run: 0, on: saved ? saved !== 'off' : store.get('dejavu1.pref.cam') !== 'off', url: null, timer: 0 };
    cam.frame = host.querySelector('.pcam-frame');
    cam.img = host.querySelector('.pcam-img');
    cam.mode = host.querySelector('.pcam-mode');
    cam.note = host.querySelector('.pcam-note');
    cam.toggle = host.querySelector('.pcam-toggle');
    cam.toggle.addEventListener('click', () => {
      cam.on = !cam.on;
      store.set(`dejavu1.cam.${host.dataset.cam}`, cam.on ? 'on' : 'off');
      syncCam(cam);
    });
    cams.push(cam);
    return cam;
  }
  const visible = el => el && el.offsetParent !== null && !document.hidden;
  function stopCam(cam, why) {
    cam.run++;
    clearTimeout(cam.timer);
    cam.img.onload = cam.img.onerror = null;
    cam.img.removeAttribute('src');
    cam.img.hidden = true;
    if (cam.url) { URL.revokeObjectURL(cam.url); cam.url = null; }
    cam.frame.dataset.mode = 'off';
    setText(cam.host.querySelector('.pcam-empty'), why || 'Camera off');
    setText(cam.toggle, 'Turn camera on');
    cam.toggle.setAttribute('aria-pressed', 'false');
  }
  function note(cam, text) {
    cam.note.hidden = !text;
    setText(cam.note, text || '');
  }
  async function startCam(cam) {
    const run = ++cam.run;
    setText(cam.toggle, 'Turn camera off');
    cam.toggle.setAttribute('aria-pressed', 'true');
    cam.frame.dataset.mode = 'connecting';
    setText(cam.mode, 'Connecting…');
    setText(cam.host.querySelector('.pcam-empty'), 'Connecting…');
    note(cam, '');
    if (tourOn()) { stopCam(cam, 'No live camera in the online demo'); note(cam, 'This public demo is a recording. Run your own copy to see your printer.'); return; }
    const settings = await getJSON('/api/camera/settings').catch(() => null);
    if (run !== cam.run) return;
    if (settings && settings.error && /module/i.test(settings.error)) { stopCam(cam, 'Camera switched off'); note(cam, 'Turn the Camera module on in Settings → Features.'); return; }
    if (settings && settings.stream_url) {
      cam.frame.dataset.mode = 'stream';
      setText(cam.mode, 'Live video');
      cam.img.onload = () => { if (run === cam.run) cam.img.hidden = false; };
      cam.img.onerror = () => { if (run === cam.run) { stopCam(cam, 'The camera stream stopped'); note(cam, 'Check the address under Camera & time-lapses, then turn it on again.'); } };
      cam.img.src = `/api/camera/stream?t=${Date.now()}`;
      return;
    }
    cam.frame.dataset.mode = 'pictures';
    let shown = 0, began = performance.now();
    const next = async () => {
      if (run !== cam.run) return;
      if (!visible(cam.host)) { stopCam(cam, 'Paused while hidden'); return; }
      const asked = performance.now();
      try {
        const r = await fetch(api(`/api/camera/snapshot?t=${Date.now()}`));
        if (!r.ok || (r.headers.get('Content-Type') || '').includes('json')) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || (d.connected === false ? 'No printer connected.' : 'The camera did not answer.'));
        }
        const blob = await r.blob();
        if (run !== cam.run) return;
        const url = URL.createObjectURL(blob);
        const pic = new Image();
        pic.src = url;
        await pic.decode().catch(() => {});
        if (run !== cam.run) { URL.revokeObjectURL(url); return; }
        cam.img.src = url;
        cam.img.hidden = false;
        if (cam.url) URL.revokeObjectURL(cam.url);
        cam.url = url;
        shown++;
        const secs = (performance.now() - began) / 1000;
        const rate = shown > 2 && secs > 0 ? `${(shown / secs).toFixed(1)} pictures a second` : 'Pictures';
        setText(cam.mode, blob.type.includes('svg') ? 'Demo picture, not a photo' : rate);
        // Ask again as soon as this one is up: at most five a second, so a fast
        // printer camera can't flood the Wi-Fi.
        cam.timer = setTimeout(next, Math.max(0, 200 - (performance.now() - asked)));
      } catch (e) {
        if (run !== cam.run) return;
        stopCam(cam, 'Camera not answering');
        note(cam, `${e.message || e} Add a camera address under Printer → Camera & time-lapses if your printer has one.`);
      }
    };
    next();
  }
  function syncCam(cam) {
    const want = cam.on && visible(cam.host);
    const running = cam.frame.dataset.mode !== 'off';
    if (want && !running) startCam(cam);
    else if (!want && running) stopCam(cam, cam.on ? 'Paused while hidden' : 'Camera off');
  }
  const syncCams = () => cams.forEach(syncCam);

  /* ---- Overview cards ----------------------------------------------------- */
  function renderNow(s) {
    const body = $('ov-now-body');
    if (!body) return;
    if (!s || !s.state) {
      const away = unreachablePrinter();
      paint(body, `<div class="ov-quiet"><p class="ov-big">${esc(away ? unreachableWords(away)[0] : 'No printer connected')}</p>
        <p class="card-sub">${esc(away ? unreachableWords(away)[1] : 'Add your printer under Printers, or turn on demo data to look around.')}</p></div>`);
      setText($('ov-now-sub'), 'The selected printer');
      return;
    }
    setText($('ov-now-sub'), s.printer_name || 'The selected printer');
    const head = s.active_toolhead && s.toolheads ? s.toolheads[s.active_toolhead] : null;
    const pct = Math.round((s.progress || 0) * 100);
    const left = hoursLeft(s);
    const layer = s.layer && s.layer.current && s.layer.total ? `Layer ${s.layer.current} of ${s.layer.total}` : '';
    const lines = busy(s) || s.state === 'complete'
      ? `<p class="ov-file">${esc(s.current_file || 'Current print')}</p>
         <div class="ov-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
         <p class="ov-facts"><b>${pct}%</b>${left != null && s.state !== 'complete' ? ` · ${esc(hoursWords(left))} left · done ${esc(doneAt(left) || '')}` : ''}${layer ? ` · ${esc(layer)}` : ''}</p>`
      : s.state === 'error'
        ? `<p class="ov-file">${esc(s.state_message || 'The printer stopped with an error')}</p>`
        : `<p class="ov-file">Ready for a print</p><p class="ov-facts">${esc(readyLine(s))}</p>`;
    paint(body, `<div class="ov-state" data-state="${esc(s.link_lost ? 'lost' : s.state)}">
        <span class="ov-dot" aria-hidden="true"></span><span class="ov-word">${esc(s.link_lost ? 'No live link' : WORD[s.state] || s.state)}</span>
        ${head ? `<span class="ov-head"><i style="background:${esc(head.filament_color_hex || '#ccc')}"></i>${esc(s.active_toolhead)}</span>` : ''}
      </div>${lines}${nowFigures(s, head)}`);
  }
  /* The figures someone glances at: the head and bed against their targets, speed,
     fan and flow as the printer reports them. A figure it doesn't report is left out. */
  function nowFigures(s, head) {
    const t = s.tuning || {};
    const pct = v => v == null ? null : `${Math.round(v * 100)}%`;
    const cells = [
      head ? [`${s.active_toolhead} nozzle`, `${formatTemp(head.temperature)}${head.target_temperature ? ` → ${formatTemp(head.target_temperature)}` : ''}`] : null,
      ['Bed', `${s.bed_temperature != null ? formatTemp(s.bed_temperature) : '—'}${s.bed_target ? ` → ${formatTemp(s.bed_target)}` : ''}`],
      s.chamber_temperature != null ? ['Chamber', formatTemp(s.chamber_temperature)] : null,
      pct(t.speed_factor) ? ['Speed', pct(t.speed_factor)] : null,
      pct(t.part_fan) ? ['Part fan', pct(t.part_fan)] : null,
      pct(t.extrude_factor) ? ['Flow', pct(t.extrude_factor)] : null,
    ].filter(Boolean);
    return `<dl class="ov-figs">${cells.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  }
  function readyLine(s) {
    const hot = Object.entries(s.toolheads || {}).filter(([, t]) => (t.target_temperature || 0) > 0).map(([th]) => th);
    const loaded = Object.values(s.toolheads || {}).filter(t => t.filament_loaded).length;
    const bits = [];
    if (hot.length) bits.push(`Heating ${hot.join(', ')}`);
    else bits.push('Heaters off');
    if (s.toolheads) bits.push(`${loaded} of ${Object.keys(s.toolheads).length} heads loaded`);
    if (s.homed_axes === 'xyz') bits.push('homed');
    return bits.join(' · ');
  }
  function tempRow(label, now, target, colour) {
    const pct = target > 0 && now != null ? Math.max(0, Math.min(100, (now / target) * 100)) : 0;
    return `<li class="ot-row">
      <span class="ot-label">${colour ? `<i style="background:${esc(colour)}"></i>` : ''}${esc(label)}</span>
      <span class="ot-bar" aria-hidden="true"><span style="width:${pct.toFixed(0)}%"></span></span>
      <span class="ot-val"><b>${now != null ? formatTemp(now) : '—'}</b>${target > 0 ? ` <small>→ ${formatTemp(target)}</small>` : ' <small>off</small>'}</span>
    </li>`;
  }
  function renderTemps(s) {
    const body = $('ov-temps-body');
    if (!body) return;
    if (!s || !s.toolheads) { paint(body, '<p class="log-empty">No readings yet.</p>'); return; }
    const rows = Object.entries(s.toolheads).map(([th, t]) =>
      tempRow(`${th}${th === s.active_toolhead ? ' · on the toolhead' : ''}`, t.temperature, t.target_temperature, t.filament_color_hex));
    rows.push(tempRow('Bed', s.bed_temperature, s.bed_target));
    if (s.chamber_temperature != null) rows.push(tempRow('Chamber', s.chamber_temperature, 0));
    paint(body, `<ul class="ot-list">${rows.join('')}</ul>`);
  }
  function renderPrinters() {
    const list = $('ov-printers-list');
    if (!list) return;
    $('ov-printers')?.classList.toggle('is-single', fleet.length <= 1);
    if (!fleet.length) { paint(list, '<li class="log-empty">No printers yet. Add one under Printers.</li>'); return; }
    paint(list, fleet.map(p => {
      const pct = Math.round((p.progress || 0) * 100);
      const word = p.link_lost ? 'No live link' : WORD[p.state] || p.state;
      return `<li><button type="button" class="ov-prow" data-open-printer="${esc(p.id)}" data-state="${esc(p.link_lost ? 'lost' : p.state)}">
        <span class="ov-dot" aria-hidden="true"></span>
        <span class="ov-pname">${esc(p.name)}</span>
        <span class="ov-pword">${esc(word)}${busy(p) ? ` · ${pct}%` : ''}</span>
        ${p.remaining_hours != null && busy(p) ? `<span class="ov-pleft">${esc(hoursWords(p.remaining_hours))} left</span>` : '<span class="ov-pleft"></span>'}
      </button></li>`;
    }).join(''));
  }

  /* ---- Printer page ------------------------------------------------------- */
  function renderHead(s) {
    setText($('pp-name'), (s && s.printer_name) || 'Printer');
    const estop = $('pp-estop');
    if (estop && estop.dataset.phase !== 'sending') estop.disabled = !canDrive(s);
  }

  function step() {
    const v = parseFloat(store.get(STEP_KEY));
    return STEPS.includes(v) ? v : 10;
  }
  function buildMove() {
    const host = $('pp-move-body');
    if (!host || host.dataset.built) return;
    host.dataset.built = '1';
    const arrow = (axis, dir, label, cls) =>
      `<button type="button" class="jog ${cls}" data-jog="${axis}" data-dir="${dir}" aria-label="Move ${axis} ${dir > 0 ? 'plus' : 'minus'}${axis === 'Z' ? (dir > 0 ? ', away from the bed' : ', toward the bed') : ''}">${label}</button>`;
    host.innerHTML = `
      <div class="jog-steps" role="radiogroup" aria-label="Step size">
        ${STEPS.map(v => `<button type="button" role="radio" data-step="${v}" aria-checked="false">${v} mm</button>`).join('')}
      </div>
      <div class="jog-pads">
        <div class="jog-xy" role="group" aria-label="Move X and Y">
          ${arrow('Y', 1, '↑', 'up')}${arrow('X', -1, '←', 'left')}
          <span class="jog-centre" aria-hidden="true">XY</span>
          ${arrow('X', 1, '→', 'right')}${arrow('Y', -1, '↓', 'down')}
        </div>
        <div class="jog-z" role="group" aria-label="Move Z (the bed)">
          ${arrow('Z', 1, 'Z +', 'up')}<span class="jog-centre" aria-hidden="true">Z</span>${arrow('Z', -1, 'Z −', 'down')}
        </div>
      </div>
      <p class="jog-pos" id="pp-pos" aria-live="off"></p>
      <form class="jog-goto" id="pp-goto">
        <label>X <input type="number" step="0.1" inputmode="decimal" name="x" aria-label="Go to X, mm"></label>
        <label>Y <input type="number" step="0.1" inputmode="decimal" name="y" aria-label="Go to Y, mm"></label>
        <label>Z <input type="number" step="0.1" inputmode="decimal" name="z" aria-label="Go to Z, mm"></label>
        <button class="btn small" type="submit">Go</button>
      </form>
      <div class="jog-nudge" id="pp-nudge" role="group" aria-label="Nudge the nozzle height">
        <span>Nozzle height</span>
        <button type="button" class="btn small" data-nudge="-0.05">−0.05</button>
        <button type="button" class="btn small" data-nudge="-0.01">−0.01</button>
        <button type="button" class="btn small" data-nudge="0.01">+0.01</button>
        <button type="button" class="btn small" data-nudge="0.05">+0.05</button>
        <span class="jog-offset" id="pp-offset"></span>
      </div>`;
    const syncStep = () => host.querySelectorAll('[data-step]').forEach(b => b.setAttribute('aria-checked', String(parseFloat(b.dataset.step) === step())));
    host.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => { store.set(STEP_KEY, b.dataset.step); syncStep(); }));
    syncStep();
    host.querySelectorAll('[data-jog]').forEach(b => b.addEventListener('click', () => {
      // Z+ opens the gap between nozzle and bed; Z− closes it.
      const distance = step() * parseInt(b.dataset.dir, 10);
      runCommand(b, '/api/printer/control/jog', { axis: b.dataset.jog, distance },
        { sending: '…', done: `Moved ${b.dataset.jog} ${distance > 0 ? '+' : ''}${distance} mm`, failed: 'Move refused' });
    }));
    $('pp-goto').addEventListener('submit', e => {
      e.preventDefault();
      const f = new FormData(e.target), body = {};
      ['x', 'y', 'z'].forEach(k => { const v = f.get(k); if (v !== '' && v != null) body[k] = parseFloat(v); });
      runCommand(e.target.querySelector('button'), '/api/printer/control/move', body,
        { sending: 'Going…', done: 'Moved', failed: 'Move refused' });
    });
    host.querySelectorAll('[data-nudge]').forEach(b => b.addEventListener('click', () =>
      runCommand(b, '/api/printer/control/z-nudge', { delta: parseFloat(b.dataset.nudge) },
        { sending: '…', done: `Nozzle ${parseFloat(b.dataset.nudge) > 0 ? 'raised' : 'lowered'} ${Math.abs(b.dataset.nudge)} mm`, failed: 'Nudge refused' })));
  }
  function renderMove(s) {
    buildMove();
    const host = $('pp-move-body');
    if (!host) return;
    const moving = canDrive(s) && !busy(s);
    host.querySelectorAll('[data-jog], #pp-goto button').forEach(b => {
      if (b.dataset.phase !== 'sending') b.disabled = !moving || (s.homed_axes != null && !s.homed_axes.includes((b.dataset.jog || 'x').toLowerCase()));
    });
    host.querySelectorAll('[data-nudge]').forEach(b => { if (b.dataset.phase !== 'sending') b.disabled = !canDrive(s); });
    const pos = s && s.toolhead_position;
    const homed = s && s.homed_axes;
    setText($('pp-pos'), pos ? `X ${num(pos[0], 1)} · Y ${num(pos[1], 1)} · Z ${num(pos[2], 2)} mm`
      + (homed != null ? ` · ${homed === 'xyz' ? 'all homed' : homed ? `homed ${homed.toUpperCase()}` : 'not homed: press Home all'}` : '') : 'No position yet');
    const off = s && s.tuning && s.tuning.z_offset;
    setText($('pp-offset'), off ? `${off > 0 ? '+' : ''}${off} mm` : '');
    const sub = $('pp-move-sub');
    if (sub) setText(sub, !canDrive(s) ? 'Waiting for the printer' : busy(s) ? 'While it prints, only the nozzle height nudge works'
      : homed === 'xyz' || homed == null ? 'Pick a step, then press an arrow. Watch the camera.' : 'Home first, then move by the step you pick');
  }

  function buildExtrude() {
    const host = $('pp-extrude-body');
    if (!host || host.dataset.built) return;
    host.dataset.built = '1';
    host.innerHTML = `
      <p class="ex-head" id="pp-ex-head"></p>
      <div class="ex-pick" id="pp-ex-pick" role="group" aria-label="Pick up a head"></div>
      <div class="ex-row"><span>Length</span>
        ${[5, 10, 25, 50].map(v => `<button type="button" class="pchip" data-len="${v}">${v} mm</button>`).join('')}
        <input type="number" id="pp-ex-len" min="1" max="100" step="1" value="10" inputmode="decimal" aria-label="Length, mm"></div>
      <div class="ex-row"><span>Speed</span>
        ${[2, 5, 10].map(v => `<button type="button" class="pchip" data-speed="${v}">${v} mm/s</button>`).join('')}
        <input type="number" id="pp-ex-speed" min="0.5" max="15" step="0.5" value="5" inputmode="decimal" aria-label="Speed, mm per second"></div>
      <div class="ex-go">
        <button type="button" class="btn" id="pp-retract">Retract</button>
        <button type="button" class="btn primary" id="pp-extrude-go">Extrude</button>
      </div>
      <p class="field-hint" id="pp-ex-why"></p>`;
    host.querySelectorAll('[data-len]').forEach(b => b.addEventListener('click', () => { $('pp-ex-len').value = b.dataset.len; }));
    host.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => { $('pp-ex-speed').value = b.dataset.speed; }));
    const go = (b, sign) => runCommand(b, '/api/printer/control/extrude',
      { length: sign * Math.abs(parseFloat($('pp-ex-len').value)), speed: parseFloat($('pp-ex-speed').value) },
      { sending: sign > 0 ? 'Extruding…' : 'Retracting…', done: sign > 0 ? 'Extruded' : 'Retracted', failed: 'Refused' });
    $('pp-extrude-go').addEventListener('click', e => go(e.currentTarget, 1));
    $('pp-retract').addEventListener('click', e => go(e.currentTarget, -1));
  }
  function renderExtrude(s) {
    buildExtrude();
    if (!$('pp-extrude-body')) return;
    const active = s && s.active_toolhead;
    const head = active && s.toolheads ? s.toolheads[active] : null;
    const hot = head && (head.can_extrude === true || (head.can_extrude == null && (head.temperature || 0) >= 170));
    setText($('pp-ex-head'), !s || !s.state ? 'No printer' : head
      ? `${active} is on the toolhead · ${formatTemp(head.temperature)}${hot ? '' : ' (too cold to extrude)'}` : 'No head is on the toolhead');
    const why = !canDrive(s) ? '' : s.state === 'printing' ? 'Pause the print to extrude.' : !head ? 'Pick up a head first.'
      : !hot ? `Heat ${active} under Temperatures first. Klipper won't extrude below its minimum temperature.` : '';
    setText($('pp-ex-why'), why);
    ['pp-extrude-go', 'pp-retract'].forEach(id => { const b = $(id); if (b.dataset.phase !== 'sending') b.disabled = !canDrive(s) || !!why; });
    const pick = $('pp-ex-pick');
    const heads = Object.keys((s && s.toolheads) || {});
    const sig = heads.join() + active + (busy(s) ? 'b' : '');
    if (pick.dataset.sig !== sig) {
      pick.dataset.sig = sig;
      pick.innerHTML = heads.map(th => `<button type="button" class="pchip${th === active ? ' is-on' : ''}" data-pick="${esc(th)}" ${th === active || busy(s) ? 'disabled' : ''}>${th === active ? `${esc(th)} on` : `Pick up ${esc(th)}`}</button>`).join('');
      pick.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
        if (!confirm(`Change to ${b.dataset.pick}? The printer parks the current head and picks up ${b.dataset.pick}.`)) return;
        runCommand(b, '/api/printer/control/tool', { toolhead: b.dataset.pick },
          { sending: 'Changing…', done: `${b.dataset.pick} picked up`, failed: 'Head change refused', expect: st => st.active_toolhead === b.dataset.pick });
      }));
    }
  }

  function slider(id, label, min, max, stepSize, unit, path, key) {
    return `<div class="tn-row" data-tune="${id}">
      <label for="pp-${id}">${label}</label>
      <input type="range" id="pp-${id}" min="${min}" max="${max}" step="${stepSize}" data-path="${path}" data-key="${key}">
      <output for="pp-${id}" id="pp-${id}-out"></output><span class="tn-unit">${unit}</span>
    </div>`;
  }
  function buildTune() {
    const host = $('pp-tune-body');
    if (!host || host.dataset.built) return;
    host.dataset.built = '1';
    host.innerHTML = `
      ${slider('speed', 'Speed', 10, 300, 5, '%', '/api/printer/control/speed', 'percent')}
      ${slider('flow', 'Flow', 50, 150, 1, '%', '/api/printer/control/flow', 'percent')}
      ${slider('fan', 'Part fan', 0, 100, 5, '%', '/api/printer/control/fan', 'percent')}
      <form class="tn-form" id="pp-pa"><label for="pp-pa-val">Pressure advance <span id="pp-pa-head"></span></label>
        <input type="number" id="pp-pa-val" min="0" max="1" step="0.001" inputmode="decimal">
        <button class="btn small" type="submit">Set</button></form>
      <form class="tn-form" id="pp-limits"><label>Max speed <input type="number" id="pp-vel" min="1" step="10" inputmode="numeric" aria-label="Max speed, mm/s"> mm/s</label>
        <label>Acceleration <input type="number" id="pp-acc" min="1" step="100" inputmode="numeric" aria-label="Max acceleration, mm/s²"> mm/s²</label>
        <button class="btn small" type="submit">Set</button></form>
      <p class="field-hint" id="pp-tune-note"></p>`;
    host.querySelectorAll('input[type=range]').forEach(r => {
      r.addEventListener('input', () => { r.dataset.touched = '1'; setText($(`${r.id}-out`), r.value); });
      // Sent when you let go, not on every pixel of the drag.
      r.addEventListener('change', () => {
        runCommand(null, r.dataset.path, { [r.dataset.key]: parseFloat(r.value) },
          { sending: '', done: `${r.closest('.tn-row').querySelector('label').textContent} set to ${r.value}%`, failed: 'Refused' })
          .finally(() => { delete r.dataset.touched; });
      });
    });
    $('pp-pa').addEventListener('submit', e => {
      e.preventDefault();
      const th = state && state.active_toolhead;
      if (!th) { toast('Pick up a head first: pressure advance is set per head', 'warn'); return; }
      runCommand(e.target.querySelector('button'), '/api/printer/control/pressure-advance',
        { toolhead: th, value: parseFloat($('pp-pa-val').value) }, { sending: 'Setting…', done: `Pressure advance for ${th} set`, failed: 'Refused' });
    });
    $('pp-limits').addEventListener('submit', e => {
      e.preventDefault();
      runCommand(e.target.querySelector('button'), '/api/printer/control/limits',
        { velocity: $('pp-vel').value, accel: $('pp-acc').value }, { sending: 'Setting…', done: 'Limits set', failed: 'Refused' });
    });
  }
  function renderTune(s) {
    buildTune();
    const host = $('pp-tune-body');
    if (!host) return;
    const t = (s && s.tuning) || {};
    const put = (id, v) => {
      const r = $(`pp-${id}`);
      if (!r) return;
      r.disabled = !canDrive(s) || v == null;
      if (r.dataset.touched || document.activeElement === r || v == null) { if (v == null) setText($(`pp-${id}-out`), '—'); return; }
      const val = String(Math.round(v * 100));
      if (r.value !== val) r.value = val;
      setText($(`pp-${id}-out`), val);
    };
    put('speed', t.speed_factor);
    put('flow', t.extrude_factor);
    put('fan', t.part_fan);
    const th = s && s.active_toolhead;
    const pa = th && s.toolheads[th] ? s.toolheads[th].pressure_advance : null;
    setText($('pp-pa-head'), th ? `(${th})` : '');
    if (document.activeElement !== $('pp-pa-val')) $('pp-pa-val').value = pa != null ? pa : '';
    if (document.activeElement !== $('pp-vel') && t.max_velocity != null) $('pp-vel').value = Math.round(t.max_velocity);
    if (document.activeElement !== $('pp-acc') && t.max_accel != null) $('pp-acc').value = Math.round(t.max_accel);
    host.querySelectorAll('form button').forEach(b => { if (b.dataset.phase !== 'sending') b.disabled = !canDrive(s); });
    setText($('pp-tune-note'), t.part_fan_rpm ? `Part fan at ${Math.round(t.part_fan_rpm)} rpm.` : '');
  }

  function renderMacros(s) {
    const host = $('pp-macros-body');
    if (!host) return;
    const t = (s && s.tuning) || {};
    const sig = JSON.stringify([t.macros, t.bed_mesh, t.mesh_profile, canDrive(s), busy(s)]);
    if (host.dataset.sig === sig) return;
    host.dataset.sig = sig;
    if (!canDrive(s)) { host.innerHTML = '<p class="log-empty">Waiting for the printer.</p>'; return; }
    const off = busy(s) ? 'disabled' : '';
    host.innerHTML = `
      <div class="mc-main">
        ${t.bed_mesh !== false ? `<button type="button" class="btn" data-act="bed-mesh" ${off}>Probe the bed (bed mesh)</button>` : ''}
        <button type="button" class="btn" data-act="motors-off" ${off}>Motors off</button>
      </div>
      ${t.mesh_profile ? `<p class="field-hint">Bed mesh in use: <b>${esc(t.mesh_profile)}</b></p>` : ''}
      ${(t.macros || []).length ? `<p class="mc-label">Your printer's macros</p>
        <div class="mc-list">${t.macros.map(m => `<button type="button" class="pchip" data-macro="${esc(m)}">${esc(m.replace(/_/g, ' ').toLowerCase())}</button>`).join('')}</div>`
        : '<p class="field-hint">This printer lists no macros of its own.</p>'}
      ${busy(s) ? '<p class="field-hint">Probing and motors off wait until the print ends.</p>' : ''}`;
    host.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const mesh = b.dataset.act === 'bed-mesh';
      if (mesh && !confirm('Probe the bed now? The printer homes if it needs to, then touches the bed at many points. Keep the bed clear.')) return;
      runCommand(b, `/api/printer/control/${b.dataset.act}`, {},
        { sending: mesh ? 'Probing…' : 'Turning off…', done: mesh ? 'Bed mesh done' : 'Motors off', failed: 'Refused' });
    }));
    host.querySelectorAll('[data-macro]').forEach(b => b.addEventListener('click', () => {
      if (busy(state) && !confirm(`Run ${b.dataset.macro} while the printer is printing?`)) return;
      runCommand(b, '/api/printer/control/macro', { name: b.dataset.macro },
        { sending: 'Running…', done: `${b.dataset.macro} ran`, failed: `${b.dataset.macro} refused` });
    }));
  }

  function renderHeaters(s) {
    const pre = $('pp-presets');
    if (pre && !pre.dataset.built) {
      pre.dataset.built = '1';
      const list = presets();
      pre.innerHTML = list.map((p, i) => `<button type="button" class="pchip" data-preset="${i}" title="${esc(p.name)}: nozzle ${p.nozzle} °C, bed ${p.bed} °C">${esc(p.name)}</button>`).join('')
        + '<button type="button" class="pchip" data-preset="off">Cool down</button>';
      pre.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', async () => {
        const st = state;
        if (!canDrive(st)) return;
        const heads = Object.keys(st.toolheads || {});
        if (b.dataset.preset === 'off') {
          for (const th of heads) await runCommand(null, '/api/printer/control/temperature', { toolhead: th, target: 0 }, { sending: '', done: `${th} off`, failed: `${th} refused` });
          await runCommand(b, '/api/printer/control/bed-temperature', { target: 0 }, { sending: 'Cooling…', done: 'Bed off', failed: 'Bed refused' });
          return;
        }
        const p = presets()[parseInt(b.dataset.preset, 10)];
        const th = st.active_toolhead || heads[0];
        await runCommand(null, '/api/printer/control/temperature', { toolhead: th, target: p.nozzle }, { sending: '', done: `${th} heating to ${formatTemp(p.nozzle)}`, failed: `${th} refused` });
        await runCommand(b, '/api/printer/control/bed-temperature', { target: p.bed }, { sending: 'Heating…', done: `Bed heating to ${formatTemp(p.bed)}`, failed: 'Bed refused' });
      }));
    }
    const bed = $('pp-bed');
    if (!bed) return;
    if (!bed.dataset.built) {
      bed.dataset.built = '1';
      bed.innerHTML = `<span class="stat-key">Bed</span><b id="pp-bed-now">—</b><span class="stat-foot" id="pp-bed-target"></span>
        <form id="pp-bed-form" class="inline-form"><label class="sr-only" for="pp-bed-in">Bed target temperature</label>
        <input type="number" id="pp-bed-in" inputmode="decimal" placeholder="target"><button class="btn small" type="submit">Set</button></form>`;
      $('pp-bed-form').addEventListener('submit', e => {
        e.preventDefault();
        const raw = parseFloat($('pp-bed-in').value);
        if (Number.isNaN(raw)) { toast('Type a bed temperature first', 'warn'); return; }
        const c = tempUnit === 'F' ? (raw - 32) * 5 / 9 : raw;
        runCommand(e.target.querySelector('button'), '/api/printer/control/bed-temperature', { target: c },
          { sending: 'Setting…', done: `Bed target set to ${formatTemp(c)}`, failed: 'Bed refused' }).then(r => { if (r.ok) $('pp-bed-in').value = ''; });
      });
    }
    setText($('pp-bed-now'), s && s.bed_temperature != null ? formatTemp(s.bed_temperature) : '—');
    setText($('pp-bed-target'), s && s.bed_target ? `target ${formatTemp(s.bed_target)}` : 'heater off');
    const extra = s && s.tuning ? [...(s.tuning.sensors || []), ...(s.tuning.fans || []).filter(f => f.temperature != null)] : [];
    let more = $('pp-sensors');
    if (!more) { more = document.createElement('p'); more.id = 'pp-sensors'; more.className = 'pp-sensors field-hint'; bed.after(more); }
    setText(more, [
      ...extra.map(x => `${x.name} ${formatTemp(x.temperature)}`),
      ...((s && s.tuning && s.tuning.fans) || []).filter(f => f.speed != null).map(f => `${f.name} ${Math.round(f.speed * 100)}%`),
    ].join(' · '));
  }

  function renderPage(s) {
    renderHead(s);
    renderMove(s);
    renderHeaters(s);
    renderExtrude(s);
    renderTune(s);
    renderMacros(s);
  }

  /* Preferences tab: the choices above, kept in this browser. */
  function initPrefs() {
    const start = $('pref-start'), stepSel = $('pref-step'), camBox = $('pref-cam'), cel = $('pref-celebrate');
    if (!start) return;
    start.value = store.get('dejavu1.pref.start') || 'last';
    start.onchange = () => { store.set('dejavu1.pref.start', start.value); toast('Saved: Deja Vu1 opens there next time', 'ok'); };
    stepSel.value = String(step());
    stepSel.onchange = () => { store.set(STEP_KEY, stepSel.value); const host = $('pp-move-body'); host && host.querySelectorAll('[data-step]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.step === stepSel.value))); };
    camBox.checked = store.get('dejavu1.pref.cam') !== 'off';
    camBox.onchange = () => { store.set('dejavu1.pref.cam', camBox.checked ? 'on' : 'off'); cams.forEach(c => { store.set(`dejavu1.cam.${c.host.dataset.cam}`, camBox.checked ? 'on' : 'off'); c.on = camBox.checked; }); syncCams(); };
    cel.checked = store.get('dejavu1.pref.celebrate') !== 'off';
    cel.onchange = () => store.set('dejavu1.pref.celebrate', cel.checked ? 'on' : 'off');
    const draw = list => {
      $('pref-presets').innerHTML = list.map((p, i) => `<div class="pref-preset" data-i="${i}">
        <label>Name <input type="text" maxlength="12" value="${esc(p.name)}" data-k="name"></label>
        <label>Nozzle °C <input type="number" min="0" max="300" step="1" value="${esc(p.nozzle)}" data-k="nozzle"></label>
        <label>Bed °C <input type="number" min="0" max="120" step="1" value="${esc(p.bed)}" data-k="bed"></label></div>`).join('');
    };
    draw(presets());
    $('pref-presets-save').onclick = () => {
      const list = [...document.querySelectorAll('#pref-presets .pref-preset')].map(row => {
        const v = k => row.querySelector(`[data-k="${k}"]`).value;
        return { name: v('name').trim(), nozzle: Number(v('nozzle')), bed: Number(v('bed')) };
      }).filter(p => p.name);
      const bad = list.find(p => !(p.nozzle >= 0 && p.nozzle <= 300 && p.bed >= 0 && p.bed <= 120));
      if (bad) { toast(`${bad.name}: nozzle 0 to 300 °C, bed 0 to 120 °C`, 'warn'); return; }
      store.set(PRESET_KEY, JSON.stringify(list));
      const pre = $('pp-presets'); if (pre) { delete pre.dataset.built; renderHeaters(state); }
      toast('Warm-up buttons saved', 'ok');
    };
    $('pref-presets-reset').onclick = () => { store.set(PRESET_KEY, ''); draw(DEFAULT_PRESETS); const pre = $('pp-presets'); if (pre) { delete pre.dataset.built; renderHeaters(state); } };
  }

  function init() {
    initPrefs();
    document.querySelectorAll('.pcam[data-cam]').forEach(initCam);
    document.addEventListener('click', e => {
      const open = e.target.closest('[data-open-printer]');
      if (open) {
        if (window.Workshop && Workshop.selectPrinter && open.dataset.openPrinter !== currentPrinter) Workshop.selectPrinter(open.dataset.openPrinter);
        else showTab('control');
        return;
      }
      if (e.target.closest('[data-go-printer]')) showTab('control');
      const tab = e.target.closest('[data-open-tab]');
      if (tab) showTab(tab.dataset.openTab);
    });
    $('pp-estop')?.addEventListener('click', e => {
      if (!confirm('Emergency stop? Every motor and heater stops at once and any print is lost. The printer then needs a firmware restart.')) return;
      runCommand(e.currentTarget, '/api/printer/control/estop', {}, { sending: 'Stopping…', done: 'Emergency stop sent', failed: 'Emergency stop failed' });
    });
    window.addEventListener('dv-state', e => {
      state = e.detail;
      drawSafely('Right now', () => renderNow(state));
      drawSafely('Temperatures', () => renderTemps(state));
      drawSafely('The printer page', () => renderPage(state));
    });
    window.addEventListener('dv-fleet', e => { fleet = e.detail || []; drawSafely('Your printers', renderPrinters); });
    window.addEventListener('dv-tab', () => setTimeout(syncCams, 0));
    window.addEventListener('dv-section', () => setTimeout(syncCams, 0));
    document.addEventListener('visibilitychange', syncCams);
    setTimeout(syncCams, 0);
    renderNow(null);
    renderTemps(null);
    renderPrinters();
    renderPage(null);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  return { presets, DEFAULT_PRESETS, PRESET_KEY, hoursWords, syncCams };
})();
