/* workshop-part2.js: part 2 of 5 of workshop.js, the live connection, fleet, files, automations and Liquid Glass
 * 2.0. Split out of the one closure workshop.js was (18 November 2026) so a session reads only the part it needs.
 * Loaded before workshop.js, after workshop-part1.js; it hands its names on through WorkshopPart2. Holds: HEAD_KEY,
 * LOCAL_MAX_BYTES, SETTLE_S, ar, buildTwin, choose, drawSpark, drawTags, drawTwin, drawnPosition, files, gaugeSVG,
 * kindOf, lastSeenHead, loadChamber, loadHealth, modelTools, pageStart, preflightList, queueTwin, rememberHead,
 * renderPill, renderTwin, setTwinMode, setView, settled, setupAR, startAR, updateChamberNow, zoomDrawing
 */
'use strict';
const WorkshopPart2 = (() => {
  const { BUCKETS, STATE_HEX, STATE_WORD, WF, applyTwinOptions, attrs, boxSolid, demoNeeded, dockX,
    downloadDrawing, drawDims, empty, fmtHours, headSolid, hullOf, markView, pathOf, prismSolid, projector,
    renderChips, renderPick, renderSync, setPath, smooth, sortEdges, syncTwinPrint, tween, twin, wsState } = WorkshopPart1;

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
        <button type="button" class="btn small twin-move" id="twin-move" aria-pressed="false" data-model-only
          title="Drag across the model to move the real head there. Home first.">Move head</button>
        <button type="button" class="btn small" id="twin-home" data-model-only data-module-body="printer_control">Home all</button>
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
            <label><input type="checkbox" data-opt="sound"> Click when a head docks</label>
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
      <div class="twin-readout" id="twin-readout"></div>
      <div class="twin-readout twin-extras" id="twin-extras" aria-live="off"></div>`;
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
    $('twin-move').addEventListener('click', () => {
      twin.moveOn = !twin.moveOn;
      applyTwinOptions();
      if (twin.moveOn) toast('Drag across the model and let go: the real head moves there. Press Move head again to turn the model instead.', 'info', 6000);
    });
    $('twin-home').addEventListener('click', e => {
      const st = twin.state;
      if (st && (st.state === 'printing' || st.state === 'paused')) { toast('Homing waits until the print finishes or is cancelled', 'warn'); return; }
      runCommand(e.currentTarget, '/api/printer/control/home', { axes: ['X', 'Y', 'Z'] }, { sending: 'Homing…', done: 'Homed XYZ', failed: 'Homing failed' });
    });
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
        if (twin.visible && twin.stale) { twin.stale = false; twin.sig = null; queueTwin(); }
      });
      twin.watch.observe($('twin-card'));
    }
    twin.built = true;
    setTwinMode(twin.mode);
  }

  /* Model or drawing. The model needs WebGL; without it the drawing stays. */
  /* Both modes are drawn by twin3d.js (WebGL 2) from one detailed model;
   * without WebGL 2 the SVG line drawing below takes over. */
function setTwinMode(mode) {
    if (!twin.model && twin.built && typeof Twin3D !== 'undefined') {
      twin.model = Twin3D.create($('twin-model'), { onPick: id => choose(id) });
      twin.sig = null;
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

function zoomDrawing(f) {
    twin.zoom = Math.max(0.6, Math.min(5, twin.zoom * f));
    drawTwin();
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
    // (a real graphics card). Where it costs more (software drawing) it leaves the page most of the
    // time: a 40 ms drawing waits 120 ms before the next, and a slow one waits two and a half times its
    // own cost (up to three seconds), so the page keeps at least 70% of the time however slow drawing is.
    // (The wait used to shrink again above 750 ms, which left a page with one-second drawings frozen three quarters of the time.)
    const draw = () => {
      const cost = twin.model ? twin.model.drawCost() : 0;
      const gap = cost < 8 ? 0 : cost < 100 ? Math.max(30, cost * 3) : Math.min(cost * 2.5, 3000);
      if (performance.now() - (twin.drawnAt || 0) < gap) { requestAnimationFrame(draw); return; }
      twin.queued = false;
      if (twin.model) {
        // A reading arrives four times a second, so an idle printer was drawn again and again with nothing new to show. Where drawing
        // is slow (a browser with graphics acceleration off) each of those drawings froze the page for up to a second. Draw again only
        // when something the picture shows has changed, or while it follows a print or something is moving.
        const sig = twinSignature(twin.state, twin.pos);
        if (sig === twin.sig && !twin.model.moving() && !twin.model.syncInfo()) { renderChips(); renderSync(null); return; }
        twin.sig = sig;
        // The drawing itself happens a frame later and takes `cost`: count the gap from its end.
        twin.drawnAt = performance.now() + cost;
        twin.model.update(twin.state, twin.pos, { pos: twin.posKind });
        renderChips();
        const sync = twin.model.syncInfo();
        renderSync(sync);
        if (((sync && !sync.paused) || twin.model.moving()) && !matchMedia('(prefers-reduced-motion: reduce)').matches) queueTwin();
      } else drawTwin();
    };
    requestAnimationFrame(draw);
  }

/* What the 3D twin shows that comes from the printer's reading: where the head is (to half a millimetre), the state and progress,
 * the heads' colours, materials and temperatures (as the touchscreen shows them) and the bed. When none of it differs from the last
 * drawing there is nothing new to draw. */
function twinSignature(state, pos) {
  const st = state || {};
  const heads = Object.entries(st.toolheads || {}).map(([k, d]) => [k, d.filament_color_hex, d.filament_material, d.filament_loaded, Math.round(d.temperature || 0), Math.round(d.target || 0)]);
  const bed = st.bed || {};
  return JSON.stringify([(pos || []).map(v => Math.round(v * 2) / 2), st.state, Math.round((st.progress || 0) * 200), st.active_toolhead, st.printer_id, st.printer_name,
    st.current_file, st.layer && st.layer.current, st.link_lost, st.machine && st.machine.label, Math.round(bed.temp || 0), Math.round(bed.target || 0), heads]);
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
    if (twin.state && twin.state.printer_id !== state.printer_id) { twin.pick = null; twin.job = null; twin.jobAt = 0; twin.held = null; twin.homing = null; }
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
    // The printer's own numbers only once it has homed: before that Klipper reports a position it made up.
    const where = twin.posKind === 'exact' ? `X${nb}${x.toFixed(1)} · Y${nb}${y.toFixed(1)} · Z${nb}${twin.zKnown ? z.toFixed(2) + nb + 'mm' : 'not homed'}`
      : twin.posKind === 'homing' ? 'Homing · drawn moving as the printer reports, from where it was'
        : twin.posKind === 'last' ? 'Not homed · drawn where it was last seen' : 'Not homed · position unknown';
    const running = state.state === 'printing' || state.state === 'paused';
    setText($('twin-readout'), where + (active ? ` · ${active}${nb}active` : '') +
      (running && layer.total ? ` · layer${nb}${layer.current}/${layer.total}` : ''));
    // What else the printer reports that the model shows: the chamber light, the fans and the homed axes.
    const tune = state.tuning || {}, pct = v => `${Math.round(v * 100)}%`;
    const led = (tune.leds || []).find(l => /cavity|chamber/i.test(l.id || '')) || (tune.leds || [])[0];
    const light = led && Array.isArray(led.color) ? Math.max(...led.color.map(v => +v || 0)) : null;
    const cavity = (tune.fans || []).find(f => /cavity|chamber/i.test(f.id || ''));
    const homedNow = typeof state.homed_axes === 'string' ? state.homed_axes : null;
    const parts = [];
    if (light !== null) parts.push(`Chamber light ${light > 0.02 ? pct(light) : 'off'}`);
    if (typeof tune.part_fan === 'number') parts.push(`Part fan ${pct(tune.part_fan)}`);
    if (cavity && typeof cavity.speed === 'number') parts.push(`Chamber fan ${pct(cavity.speed)}`);
    if (homedNow !== null && homedNow.length < 3) parts.push('Homed: ' + ['x', 'y', 'z'].map(a => `${a.toUpperCase()} ${homedNow.includes(a) ? '✓' : '–'}`).join(' '));
    setText($('twin-extras'), parts.join(' · '));
    // A real printer that hasn't homed doesn't know where its head is, and a dropped link
    // means the drawing shows the last reading: both said in words, never drawn as live.
    const unhomed = typeof state.homed_axes === 'string' && state.homed_axes.length < 3;
    // A real printer's reading can go quiet with the link still open: say it, never draw it as live.
    const age = state.reading_age_s, quiet = typeof age === 'number' && age >= 5 && state.state === 'printing';
    setText($('twin-sub'), `${state.printer_name || 'Printer'} · ${STATE_WORD[state.state] || state.state}` +
      (state.link_lost ? ' · no live link, last reading shown'
        : quiet ? ` · no new reading from the printer for ${Math.round(age)} s`
          : state.reading_directly ? ' · reading the printer directly (its own updates stopped)'
            : unhomed ? ' · not homed, position unknown' : ''));
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
    const pid = state.printer_id || '';
    // Not homed, the printer doesn't know where its head is, and nor does Klipper. The head is drawn where it
    // was last really seen (kept in this browser per printer, so a reload doesn't throw it to the middle of
    // the bed); only a printer never seen homed gets a placeholder, and the tag says so.
    if (!twin.held) {
      const last = lastSeenHead(pid);
      twin.held = last ? last.slice() : [null, null, null];
      twin.seen = last ? [true, true, true] : [false, false, false];
    }
    const held = twin.held, seen = twin.seen;
    // While an axis homes, its reading is a made-up frame: follow the real motion from where it was instead.
    const H = typeof Twin3D !== 'undefined' && Twin3D.homing;
    const hm = H ? H.followHoming(twin.homing || (twin.homing = H.newHoming()),
      raw.map((v, i) => homed.includes('xyz'[i]) ? v : NaN), lo, hi, held, performance.now()) : null;
    let exact = true;
    const out = raw.map((v, i) => {
      const ok = homed.includes('xyz'[i]) && Number.isFinite(v);
      if (ok) { held[i] = Math.min(hi[i], Math.max(lo[i], hm && hm.pos[i] != null ? hm.pos[i] : v)); seen[i] = true; }
      else {
        exact = false;
        if (held[i] == null) held[i] = i === 2 ? hi[i] / 2 : (lo[i] + hi[i]) / 2;
      }
      return held[i];
    });
    // The head's place on the bed needs X and Y; Z (the bed's height) homes last and is only a number.
    const flat = homed.includes('x') && homed.includes('y') && Number.isFinite(raw[0]) && Number.isFinite(raw[1]);
    const homing = !!(hm && hm.homing.some(Boolean));
    twin.posKind = homing ? 'homing' : flat ? 'exact' : seen[0] && seen[1] ? 'last' : 'unknown';
    twin.zKnown = exact && !(hm && hm.homing[2]);
    if (flat && !homing) rememberHead(pid, out);
    return out;
  }
const HEAD_KEY = 'dejavu1.twin-last-head';
function lastSeenHead(pid) {
    try {
      const v = (JSON.parse(localStorage.getItem(HEAD_KEY) || '{}') || {})[pid];
      return Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v : null;
    } catch (e) { return null; }
  }
function rememberHead(pid, pos) {
    if (!pid || performance.now() - (twin.headSavedAt || 0) < 3000) return;
    twin.headSavedAt = performance.now();
    try {
      const all = JSON.parse(localStorage.getItem(HEAD_KEY) || '{}') || {};
      all[pid] = pos.map(v => Math.round(v * 10) / 10);
      const ids = Object.keys(all);
      if (ids.length > 24) delete all[ids[0]];
      localStorage.setItem(HEAD_KEY, JSON.stringify(all));
    } catch (e) { /* not remembered */ }
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
    // One failed or empty answer replaces the gauge with a note. Its animation must stop with it: it looks up the needle on every frame,
    // and with the needle gone that was a script error (the page lost the server, and the next frame threw).
    if (!data || !hasData(data) || data.score == null) { smooth.delete('gauge'); host.innerHTML = demoNeeded('print health'); host.dataset.built = ''; return; }
    if (!host.dataset.built || !$('g-needle')) {
      host.dataset.built = '1';
      host.innerHTML = `<div class="gauge-wrap">${gaugeSVG()}<div class="g-num"><span id="g-score">—</span><small id="g-band"></small></div></div>
        <ul class="g-deductions" id="g-deductions"></ul>`;
    }
    const arcLen = Math.PI * 80;
    const fill = $('g-fill');
    fill.style.strokeDasharray = `${arcLen}`;
    // "blocked" is red whatever the number: the score never overrules Confirm Print.
    const color = data.band === 'good' ? 'var(--ok)' : (data.band === 'fair' ? 'var(--warn)' : 'var(--bad)');
    fill.style.stroke = color;
    tween('gauge', data.score, (v) => {
      const needle = $('g-needle');
      if (!needle) { smooth.delete('gauge'); return; }        // the panel was replaced while this was running
      fill.style.strokeDashoffset = `${arcLen * (1 - v / 100)}`;
      needle.setAttribute('transform', `rotate(${-90 + v * 1.8} 100 100)`);
      setText($('g-score'), Math.round(v));
    });
    host.setAttribute('aria-label', `Print health ${data.score} out of 100, ${data.band === 'blocked' ? 'can\'t start' : data.band}`);
    $('g-band').textContent = { good: 'Good', fair: 'Fair', poor: 'Needs attention', blocked: 'Can\'t start' }[data.band];
    $('g-deductions').innerHTML = (data.deductions || []).length
      ? data.deductions.map(d => `<li><b>${d.points}</b> ${esc(d.reason)}</li>`).join('')
      : '<li class="ok">Nothing is pulling the score down.</li>';
  }

  /* Chamber climate: a read-only reading, where Klipper reports one. */
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
    wsState.chamberHistory = settled(data.history.map(s => ({ t: s.t, c: s.chamber, b: s.bed }))
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
    const last = wsState.chamberHistory[wsState.chamberHistory.length - 1];
    const now = Date.now() / 1000;
    if (now - pageStart < SETTLE_S && !last) return;
    if (!last || now - last.t >= 5) {
      wsState.chamberHistory.push({ t: now, c: state.chamber_temperature, b: state.bed_temperature });
      if (wsState.chamberHistory.length > 360) wsState.chamberHistory.shift();
      drawSpark();
    }
  }

function drawSpark() {
    const svg = $('ch-spark');
    if (!svg || !wsState.chamberHistory.length) return;
    const vals = wsState.chamberHistory.flatMap(s => [s.c, s.b]).filter(v => v != null);
    const lo = Math.floor(Math.min(...vals) - 2), hi = Math.ceil(Math.max(...vals) + 2);
    const t0 = wsState.chamberHistory[0].t, t1 = Math.max(t0 + 1, wsState.chamberHistory[wsState.chamberHistory.length - 1].t);
    const path = (key) => wsState.chamberHistory.map((s, i) =>
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

function preflightList(pre) {
    const rows = [...pre.errors.map(e => ({ ...e, lvl: 'error' })), ...pre.warnings.map(w => ({ ...w, lvl: 'warning' }))];
    if (!rows.length) return '<p class="pf-ok">No problems found in any move.</p>';
    return `<ul class="pf-list">${rows.map(r => `<li class="pf-${r.lvl}">
        <span>${esc(r.message)}${r.more_like_this ? ` <em>(+${r.more_like_this} more like this)</em>` : ''}</span>
        ${r.line ? `<button class="chip-btn" type="button" data-goto-line="${r.line}">Line ${r.line}</button>` : ''}
      </li>`).join('')}</ul>`;
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

function modelTools(entry, original, viewer, side) {
    if (window.DVPlate) return DVPlate.mount(entry, original, viewer, side);
  }
  return { LOCAL_MAX_BYTES, ar, files, kindOf, loadChamber, loadHealth, modelTools, preflightList, renderPill,
    renderTwin, setupAR, updateChamberNow };
})();
