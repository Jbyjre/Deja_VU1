/* cockpit.js: the Printer screen as a stage with glance tiles around it and sheets that open from them.
 *
 * The printer in 3D is the room: it fills the window behind the sidebar and the toolbar, and everything else floats in it as glass. The heads, the
 * bed and the chamber carry their own temperatures (tags drawn on the machine by twin3d.js); a card top left says how the print stands, the camera
 * is a window top right, and a dock of buttons along the bottom opens the rest. Nothing scrolls: a press opens a sheet (deck.js) with the deep
 * controls. A sheet is made smart by what it brings along: Move, Extrude, Tune and the printer's buttons dock the 3D
 * printer and the camera beside the controls, so the effect of every press is in view.
 *
 * The cards that already exist (#pp-move, #pp-heaters, #pp-extrude and the rest) are moved, not rebuilt. The twin and the camera are one
 * shared instance each: a sheet that wants them takes them from the stage and the camera tile and hands them back when it closes.
 *
 * Halt (strip.js owns what it does) sits on the stage, and only here: it is on screen while you are looking at the printer, and not on
 * Overview, in the Slicer or anywhere else. The twin turns by itself while the Printer screen is open and stops under the pointer.
 */
(() => {
  const $ = id => document.getElementById(id);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const SAFE_HEX = /^#[0-9a-f]{6}$/i;
  const ICON = {
    move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
    extrude: 'M12 3v9M8 8l4 4 4-4M7 15h10M9 18h6M10.5 21h3',
    temps: 'M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0zM12 9v7',
    fans: 'M12 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M12 10.5C12 6 14 4 16.5 5c2 .9 1 4.5-4.5 5.5M13.5 12c4.5 0 6.5 2 5.5 4.5-.9 2-4.5 1-5.5-4.5M12 13.5c0 4.5-2 6.5-4.5 5.5-2-.9-1-4.5 4.5-5.5M10.5 12c-4.5 0-6.5-2-5.5-4.5.9-2 4.5-1 5.5 4.5',
    mesh: 'M4 8l8-4 8 4-8 4zM4 12l8 4 8-4M4 16l8 4 8-4',
    macros: 'M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM16 13v6M13 16h6',
    console: 'M4 5h16v14H4zM7.5 10l3 2.5-3 2.5M12.5 15h4',
    print: 'M7 4h10v5H7zM5 9h14v8h-3v3H8v-3H5zM8 14h8',
    tune: 'M5 6h14M5 12h14M5 18h14M9 4v4M15 10v4M8 16v4',
    camera: 'M4 8h3l1.5-2h7L17 8h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    twin: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  };

  /* What each sheet holds (main) and what it brings in beside it (side), by card id. */
  const SHEETS = {
    twin: { title: 'Digital twin', main: ['twin-card'], side: [], icon: ICON.twin },
    job: { title: 'This print', main: ['cp-job', 'ctrl-plate'], side: ['twin-card', 'pp-camera-card'], icon: ICON.print },
    temps: { title: 'Temperatures', main: ['pp-heaters'], side: ['pp-camera-card'], icon: ICON.temps },
    move: { title: 'Move', main: ['pp-move'], side: ['twin-card', 'pp-camera-card'], icon: ICON.move },
    extrude: { title: 'Extrude and load', main: ['pp-extrude'], side: ['twin-card', 'pp-camera-card'], icon: ICON.extrude },
    tune: { title: 'Tune', main: ['pp-tune'], side: ['twin-card', 'pp-camera-card'], icon: ICON.tune },
    outputs: { title: 'Fans, lights and sensors', main: ['pp-outputs'], side: ['pp-camera-card'], icon: ICON.fans },
    mesh: { title: 'Bed mesh', main: ['pp-mesh'], side: [], icon: ICON.mesh },
    macros: { title: "Printer's own buttons", main: ['pp-macros'], side: ['twin-card', 'pp-camera-card'], icon: ICON.macros },
    console: { title: 'G-code console', main: ['pp-console'], side: ['pp-camera-card'], icon: ICON.console },
    print: { title: 'Print a file', main: ['pp-print'], side: [], icon: ICON.print },
    camera: { title: 'Camera', main: ['pp-camera-card'], side: [], icon: ICON.camera },
  };
  const DOCK = [['temps', 'Temperatures'], ['move', 'Move'], ['extrude', 'Extrude'], ['outputs', 'Fans & lights'], ['mesh', 'Bed mesh'], ['macros', 'Buttons'], ['console', 'Console'], ['print', 'Print']];
  const svg = d => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;

  let grid = null, deck = null, state = null;
  const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };
  const temp = v => (v == null || !isFinite(v) ? '—' : (typeof formatTemp === 'function' ? formatTemp(v) : `${Math.round(v)}°`));
  const hex = v => (typeof v === 'string' && SAFE_HEX.test(v) ? v : '');
  const words = h => { const m = Math.max(0, Math.round(h * 60)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`; };

  /* ---- building the screen ---- */
  function build() {
    const panel = $('tab-control');
    if (!panel || panel.dataset.cockpit) return;
    panel.dataset.cockpit = '1';
    const put = window.Panes && Panes.put ? Panes.put : (id, into) => { const el = $(id); if (el && into) into.append(el); };
    grid = document.createElement('div');
    grid.className = 'cockpit cp';
    grid.id = 'cockpit';
    grid.innerHTML = `
      <div class="cp-hold" id="cp-hold" aria-hidden="true"></div>
      <section class="stage cp-stage" id="p-stage" aria-label="The printer in 3D"></section>
      <div class="cp-top" id="cp-top">
        <div class="cp-who" id="cp-who"></div>
        <div class="cp-halt" id="cp-halt"><p class="cp-halted" id="strip-halted" role="status" hidden></p>
          <button class="halt" id="strip-halt" type="button" disabled aria-label="Halt the selected printer: stops every motor and heater at once"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/></svg><span class="halt-word">Halt</span><kbd class="halt-key" aria-hidden="true"></kbd></button></div>
      </div>
      <aside class="cp-left" id="cp-left" aria-label="The print">
        <div class="tile tile-job" id="tile-job">
          <button type="button" class="tile-main" id="tile-job-open" data-open="job" aria-haspopup="dialog"><span class="tile-h">This print</span><span class="tile-body" id="tile-job-body"></span></button>
          <button type="button" class="tile-tune" id="tile-tune" data-open="tune" aria-haspopup="dialog" aria-label="Tune speed, flow and fan"><span class="tile-body" id="tile-tune-body"></span></button>
        </div>
      </aside>
      <aside class="cp-right" id="cp-right" aria-label="The camera">
        <div class="tile tile-cam" id="tile-cam"><button type="button" class="tile-cam-open" data-open="camera" aria-haspopup="dialog"><span class="tile-h">Camera</span><span class="tile-more">Open large</span></button><div class="tile-cam-slot" id="cp-cam-slot" data-open="camera" data-open-only="plain"></div></div>
      </aside>
      <button type="button" class="cp-twin-open" id="twin-open" data-open="twin">Press the printer to open it</button>
      <nav class="cp-dock" id="cp-dock" aria-label="Printer controls">${DOCK.map(([n, label]) =>
        `<button type="button" class="dk-btn" data-open="${n}" data-module-body="printer_control" aria-haspopup="dialog" aria-label="${label}" title="${label}">${svg(SHEETS[n].icon)}<span>${label}</span></button>`).join('')}</nav>`;
    const head = $('pp-head');
    if (head) head.after(grid); else panel.prepend(grid);
    const hold = $('cp-hold'), stage = $('p-stage');

    // The state line (dot, name, state) moves out of the old head card; its buttons move into the "This print" sheet.
    const who = head && head.querySelector('.pp-who');
    if (who) $('cp-who').append(who);
    if (head) head.classList.add('cp-head-spent');

    // The panel the "This print" sheet shows; the old head's Pause, Cancel and Print buttons live in it.
    const job = document.createElement('section');
    job.className = 'card cp-job';
    job.id = 'cp-job';
    job.innerHTML = '<div class="cp-job-body" id="cp-job-body"></div><div class="cp-job-actions" id="cp-job-actions"></div>';
    hold.append(job);
    const actions = head && head.querySelector('.pp-actions');
    if (actions) $('cp-job-actions').append(actions);

    ['pp-heaters', 'pp-move', 'pp-extrude', 'pp-tune', 'pp-outputs', 'pp-mesh', 'pp-macros', 'pp-console', 'pp-print', 'ctrl-plate'].forEach(id => put(id, hold));
    put('pp-camera-card', $('cp-cam-slot'));
    panel.querySelectorAll('.pp-stage, .pp-side, .grid-2').forEach(el => { if (!el.querySelector('.card')) el.remove(); });
    panel.querySelectorAll(':scope > div[data-module-body]').forEach(el => { if (!el.children.length) el.remove(); });

    deck = Deck.create({
      id: 'cp', root: grid, sheets: SHEETS, hold,
      always: ['pp-camera-card', 'twin-card'],
      skip: (o, e) => o.id === 'cp-cam-slot' && e.target.closest('button, a, input, select'),
      onOpen: name => { if (name === 'twin') spin(false); store.set('dejavu1.cockpit.hinted', '1'); grid.classList.add('twin-hinted'); paint(state); },
      onClose: () => autoSpin(),
    });
    [...hold.children].forEach(c => c.id && deck.remember(c.id));
    deck.remember('pp-camera-card', $('cp-cam-slot'));
    deck.remember('twin-card', stage);
    if (window.Panes && Panes.dock) Panes.dock();
    stageGestures(stage);
  }

  /* A computer that draws 3D in software (no graphics acceleration): the twin turning by itself would keep the page busy all the time, so there
   * it stays still until it is moved. Read from the twin's own drawing context; decided once there is a canvas to ask. */
  let soft = null;
  function software() {
    if (soft !== null) return soft;
    const c = document.querySelector('#twin-model canvas');
    if (!c) return false;
    try {
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
      soft = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || '') : '');
    } catch (e) { soft = false; }
    return soft;
  }

  /* ---- the stage: the twin turns by itself, stops under the pointer, and a press opens it ---- */
  let spunByUs = false, autoOn = false;
  const spinning = () => { const b = $('twin-spin'); return !!b && b.getAttribute('aria-pressed') === 'true'; };
  function spin(on) {
    const b = $('twin-spin');
    if (!b || reduced.matches || spinning() === on || (on && software())) return;
    b.click();
  }
  const open = (name, from) => { if (deck) deck.open(name, from); };
  const close = () => { if (deck) deck.close(); };
  const isOpen = () => !!deck && deck.isOpen();
  function stageGestures(stage) {
    if (store.get('dejavu1.cockpit.hinted')) grid.classList.add('twin-hinted');
    let down = null;
    stage.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    stage.addEventListener('pointerup', e => {
      if (!down || isOpen() || e.target.closest('button, a, input, select, summary, label')) { down = null; return; }
      const still = Math.abs(e.clientX - down.x) < 5 && Math.abs(e.clientY - down.y) < 5 && Date.now() - down.t < 400;
      down = null;
      if (still && e.target.closest('.t3-tag')) open('temps', e.target.closest('.t3-tag'));          // a reading on the machine opens its depth
      else if (still && e.target.closest('#twin-card')) open('twin', stage);
    });
    stage.addEventListener('pointerenter', () => { if (!isOpen() && spinning()) { spunByUs = true; spin(false); } });
    stage.addEventListener('pointerleave', () => { if (spunByUs && !isOpen()) { spunByUs = false; spin(true); } });
    window.addEventListener('dv-tab', autoSpin);
    autoSpin();
  }
  // It turns only on the Printer screen: leaving it stops the turning this file started, so every other place stays still and cheap.
  function autoSpin() {
    if (document.body.dataset.tab !== 'control') {
      if (isOpen()) close();
      if (autoOn) { autoOn = false; spunByUs = false; spin(false); }
      return;
    }
    setTimeout(() => {
      const stage = $('p-stage');
      if (document.body.dataset.tab !== 'control' || isOpen() || (stage && stage.matches(':hover')) || spinning()) return;
      spin(true);
      autoOn = spinning();
    }, 900);
  }

  /* ---- the tiles ---- */
  const fill = (body, html) => { if (body && body.dataset.sig !== html) { body.dataset.sig = html; body.innerHTML = html; } };
  function paintTune(s) {
    const t = (s && s.tuning) || {};
    const pct = v => (v == null || !isFinite(v) ? '—' : `${Math.round(v * 100)}%`);
    fill($('tile-tune-body'), s ? `<span class="tn"><i>Speed</i><b>${pct(t.speed_factor)}</b></span><span class="tn"><i>Flow</i><b>${pct(t.extrude_factor)}</b></span><span class="tn"><i>Part fan</i><b>${pct(t.part_fan)}</b></span>`
      : '<span class="tile-empty">Speed, flow and fan</span>');
  }
  function jobHtml(s, full) {
    if (!s || !s.state) return '<span class="tile-empty">No printer connected</span>';
    const pct = Math.round((s.progress || 0) * 100);
    if (s.link_lost) return '<span class="jb-state is-bad">Not answering</span><span class="jb-line">Showing its last report</span>';
    if (s.state === 'printing' || s.state === 'paused') {
      const left = typeof hoursLeft === 'function' ? hoursLeft(s) : null;
      const done = left != null && typeof doneAt === 'function' ? doneAt(left) : '';
      const layer = s.layer && s.layer.total ? `Layer ${s.layer.current || '—'} of ${s.layer.total}` : '';
      const why = full && typeof etaWords === 'function' ? etaWords(s) : '';
      const file = s.current_file ? esc(s.current_file) : 'Current print';
      return `<span class="jb-file" title="${file}">${file}</span>
        <span class="jb-pct"><b>${pct}</b><small>%</small><em>${s.state === 'paused' ? 'Paused' : 'Printing'}</em></span>
        <span class="jb-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Print progress"><i style="width:${pct}%"></i></span>
        <span class="jb-line">${left != null ? `${esc(words(left))} left${done ? ` · done ${esc(done)}` : ''}` : 'Time left: not known yet'}</span>
        ${layer ? `<span class="jb-line jb-dim">${esc(layer)}</span>` : ''}${why ? `<span class="jb-why">${esc(why)}</span>` : ''}`;
    }
    if (s.state === 'complete') return `<span class="jb-state is-ok">Finished</span><span class="jb-line jb-file">${esc(s.current_file || '')}</span>`;
    if (s.state === 'error') return `<span class="jb-state is-bad">Needs attention</span><span class="jb-line">${esc(s.state_message || '')}</span>`;
    return '<span class="jb-state">Ready</span><span class="jb-line jb-dim">Nothing is printing</span>';
  }
  function paintJob(s) {
    fill($('tile-job-body'), jobHtml(s, false));
    if (deck && deck.current() === 'job') fill($('cp-job-body'), jobHtml(s, true));
  }
  function paint(s) {
    state = s;
    paintTune(s);
    paintJob(s);
    if (grid) grid.dataset.state = (s && s.state) || '';
  }

  function init() {
    build();
    if (!grid) return;
    window.addEventListener('dv-state', e => { if (e.detail) paint(e.detail); });
    window.addEventListener('dv-printer', () => paint(state));
    window.addEventListener('dv-section', () => { if (isOpen()) close(); });
    paint(null);
  }
  window.Cockpit = { open, close, isOpen, spin, software, sheets: () => Object.keys(SHEETS) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
