/* The Slicer, the Cut tool and the files for shapes that were edited.
 *
 * Cut: a plane (flat, front or side, tilted if wanted) is placed with a height, the 3D view shows it and the line where it goes through the
 * model, and Cut makes the parts as objects of their own (slicer-model.js cutObject, the geometry is slicer-cut.js). The panel takes the place
 * of the object's numbers while the tool is on.
 *
 * Edited shapes: a cut or split piece holds a shape that is in no file. Before the plate is sliced, and before the project is remembered, each
 * is saved to Files as an STL (cut-<code>.stl, the code follows the shape's bytes, so the same shape is one file) and the object points at it.
 * The engine then slices what is on the plate, not the model the piece came from. */
'use strict';
(() => {
  const { state, q, qa, on, esc, fmt, say, clamp } = SL;
  const M = window.SlicerModel, C = window.SlicerCut;
  const P = () => state.model, S = () => state.view;

  /* ---- edited shapes become files ----------------------------------------------------------------------------------------------- */
  const files = new WeakMap();                       // mesh -> { bytes, key }: the STL is made once for a shape
  const saved = new Map();                           // key -> the name the library gave it, for this visit
  function shapeFile(o) {
    let f = files.get(o.mesh);
    if (!f) { const bytes = C.stlBytes(o.mesh.positions); f = { bytes, key: C.fingerprint(bytes) }; files.set(o.mesh, f); }
    return f;
  }
  async function ensure(objects) {
    for (const o of objects) {
      if (!o.edited) continue;
      const f = shapeFile(o);
      if (o.sourceName && o.srcKey === f.key) continue;
      let name = saved.get(f.key);
      if (!name) {
        const res = await fetch('/api/files/upload?name=' + encodeURIComponent(`cut-${f.key}.stl`), { method: 'POST', body: f.bytes });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `The shape of ${o.name} could not be saved`);
        name = body.name || `cut-${f.key}.stl`;
        saved.set(f.key, name);
      }
      o.sourceName = name; o.srcKey = f.key; o.local = null;
    }
  }
  SL.sources = { ensure, shapeFile };

  /* ---- the Cut tool ------------------------------------------------------------------------------------------------------------- */
  /* `up` is the part on the side the plane's normal points to. Every sentence is whole, one per case, so a translation can word each one. */
  const KINDS = {
    z: { label: 'Flat', tip: 'A flat cut: a top part and a bottom part', up: 'Top part', down: 'Bottom part', tilt: ['X', 'Y'], word: 'Height',
      sizes: (a, b) => `The top part is ${a} mm thick and the bottom part ${b} mm.`,
      both: 'Cut into a top part and a bottom part. Ctrl Z puts the model back.',
      gone: { upper: 'Cut. The top part was removed. Ctrl Z puts the model back.', lower: 'Cut. The bottom part was removed. Ctrl Z puts the model back.' } },
    y: { label: 'Front', tip: 'An upright cut that runs left to right: a back part and a front part', up: 'Back part', down: 'Front part', tilt: ['Z', 'X'], word: 'Position',
      sizes: (a, b) => `The back part is ${a} mm deep and the front part ${b} mm.`,
      both: 'Cut into a back part and a front part. Ctrl Z puts the model back.',
      gone: { upper: 'Cut. The back part was removed. Ctrl Z puts the model back.', lower: 'Cut. The front part was removed. Ctrl Z puts the model back.' } },
    x: { label: 'Side', tip: 'An upright cut that runs front to back: a right part and a left part', up: 'Right part', down: 'Left part', tilt: ['Y', 'Z'], word: 'Position',
      sizes: (a, b) => `The right part is ${a} mm wide and the left part ${b} mm.`,
      both: 'Cut into a right part and a left part. Ctrl Z puts the model back.',
      gone: { upper: 'Cut. The right part was removed. Ctrl Z puts the model back.', lower: 'Cut. The left part was removed. Ctrl Z puts the model back.' } }
  };
  const prefs = { kind: 'z', keepUpper: true, keepLower: true, placeUpper: true, placeLower: false };   // remembered from one cut to the next
  let cs = null, registered = false;                  // the cut being set up: { id, mesh, world, box, kind, a, b, ratio, reach, quad, preview, stamp, timer }

  const normal = () => C.normalFor(cs.kind, cs.a, cs.b);
  const plane = () => ({ n: normal(), d: cs.reach.lo + cs.ratio * (cs.reach.hi - cs.reach.lo) });
  const extent = () => cs.reach.hi - cs.reach.lo;
  const heightNow = () => cs.ratio * extent();

  function load(o) {
    const world = M.worldShape(o), p = world.positions, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { if (p[i + k] < lo[k]) lo[k] = p[i + k]; if (p[i + k] > hi[k]) hi[k] = p[i + k]; }
    cs = { id: o.id, mesh: o.mesh, world, box: { lo, hi }, kind: prefs.kind, a: 0, b: 0, ratio: 0.5, reach: null, quad: null, preview: null, stamp: 0, timer: 0 };
    reach();
  }
  function reach() { cs.reach = C.reach(cs.world.positions, normal()); }

  /* the plane as a square a little larger than the model, for the 3D view */
  function makeQuad() {
    const { n, d } = plane(), { lo, hi } = cs.box, mid = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2);
    const off = n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] - d, c = mid.map((v, k) => v - n[k] * off);
    const pick = Math.abs(n[0]) < 0.6 ? [1, 0, 0] : [0, 1, 0];
    let u = [n[1] * pick[2] - n[2] * pick[1], n[2] * pick[0] - n[0] * pick[2], n[0] * pick[1] - n[1] * pick[0]];
    const ul = Math.hypot(...u); u = u.map(v => v / ul);
    const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const h = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 0.58 + 4;
    const at = (s, t) => [0, 1, 2].map(k => c[k] + u[k] * s * h + v[k] * t * h);
    const corners = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
    const tri = [corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]];
    cs.quad = { corners, pos: new Float32Array(tri.flat()), nrm: new Float32Array(tri.flatMap(() => n)) };
  }

  /* ---- drawing it into the plate view ------------------------------------------------------------------------------------------- */
  const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  function lines(v, m, pts, rgba) {
    if (!pts.length) return;
    const gl = v.gl, prog = v.lineProg, cols = new Float32Array((pts.length / 3) * 4);
    for (let i = 0; i < cols.length; i += 4) cols.set(rgba, i);
    const pos = v.buffer(pts instanceof Float32Array ? pts : new Float32Array(pts)), col = v.buffer(cols), u = n => gl.getUniformLocation(prog, n);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(u('m'), false, m);
    gl.uniform1i(u('hideTravel'), false);
    gl.uniform1f(u('minZ'), -1e8); gl.uniform1f(u('maxZ'), 1e8); gl.uniform1f(u('minLayer'), -1e8); gl.uniform1f(u('maxLayer'), 1e8);
    const lq = gl.getAttribLocation(prog, 'q'); gl.disableVertexAttribArray(lq); gl.vertexAttrib1f(lq, -1);
    const a = v.attrib(prog, 'p', pos, 3), b = v.attrib(prog, 'k', col, 4);
    gl.drawArrays(gl.LINES, 0, pts.length / 3);
    gl.disableVertexAttribArray(a); gl.disableVertexAttribArray(b);
    gl.deleteBuffer(pos); gl.deleteBuffer(col);
  }
  function drawPlane(v, m, light) {
    if (!cs || state.tool !== 'cut' || !cs.quad || state.page === 'preview') return;
    const gl = v.gl, u = v.uniforms(v.objProg, m, light), pos = v.buffer(cs.quad.pos), nrm = v.buffer(cs.quad.nrm);
    const entry = { pos, nrm, col: null, count: 6 };
    gl.depthMask(false);
    v.drawItem(u, entry, { model: I4, nmat: I3, base: v.accent, lit: 0, alpha: 0.24 });            // where the plane is in front of the model
    gl.disable(gl.DEPTH_TEST);
    v.drawItem(u, entry, { model: I4, nmat: I3, base: v.accent, lit: 0, alpha: 0.1 });             // and, fainter, where the model hides it
    const c = cs.quad.corners, edge = [];
    for (let i = 0; i < 4; i++) edge.push(...c[i], ...c[(i + 1) % 4]);
    lines(v, m, edge, [...v.accent, 0.95]);
    if (cs.preview && cs.preview.stamp === cs.stamp) lines(v, m, cs.preview.outline, [1, 0.86, 0.25, 1]);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    gl.deleteBuffer(pos); gl.deleteBuffer(nrm);
  }

  /* the exact line where the plane meets the model is worked out a moment after the plane stops moving */
  function schedule() {
    clearTimeout(cs.timer);
    const stamp = cs.stamp, big = cs.world.positions.length > 3e6;
    cs.timer = setTimeout(() => {
      if (!cs || cs.stamp !== stamp) return;
      const r = C.cut(cs.world.positions, null, plane());
      cs.preview = { stamp, outline: r.outline, area: r.capArea, through: r.upper.length >= 36 && r.lower.length >= 36, issues: r.issues };
      info();
      S() && S().draw();
    }, big ? 320 : 120);
  }

  /* ---- the panel ---------------------------------------------------------------------------------------------------------------- */
  function panel(box, o, kind) {
    if (!registered && S()) { S().overlays.push(drawPlane); registered = true; }
    const fresh = !cs || cs.id !== o.id || cs.mesh !== o.mesh;
    if (fresh) load(o);
    else if (kind === 'transform') { const keep = { ...cs }; load(o); Object.assign(cs, { kind: keep.kind, a: keep.a, b: keep.b, ratio: keep.ratio }); reach(); }
    if (fresh || !q('#sl-cut-go', box)) build(box, o);
    update();
  }
  function leave() {
    if (!cs) return;
    clearTimeout(cs.timer);
    cs = null;
    if (S()) S().draw();
  }

  function build(box, o) {
    const k = KINDS[cs.kind];
    const part = (side, name, keepKey, placeKey) => `<div class="sl-cut-part"><b>${esc(name)}</b>
        <span class="sl-heads" role="group" aria-label="${esc(name)}"><button type="button" class="sl-hc" data-keep="${side}:1" aria-pressed="${prefs[keepKey]}">Keep</button><button type="button" class="sl-hc" data-keep="${side}:0" aria-pressed="${!prefs[keepKey]}">Remove</button></span>
        <label class="sl-switch" title="Turn the part so its flat cut face lies on the plate"><input type="checkbox" data-place="${side}" ${prefs[placeKey] ? 'checked' : ''}><span class="sl-sw" aria-hidden="true"></span>Cut face down</label></div>`;
    box.innerHTML = `
      <div class="sl-ih"><b>Cut</b><span class="sl-cut-name">${esc(o.name)}</span><button type="button" class="sl-ix" id="sl-cut-x" aria-label="Cancel the cut" data-tip="Cancel · Esc">×</button></div>
      <div class="sl-heads" role="group" aria-label="Which way the plane goes">${Object.entries(KINDS).map(([id, v]) =>
        `<button type="button" class="sl-hc" data-kind="${id}" aria-pressed="${id === cs.kind}" data-tip="${esc(v.tip)}">${esc(v.label)}</button>`).join('')}</div>
      <div class="sl-cut-row"><b id="sl-cut-hword">${esc(k.word)}</b><input type="range" id="sl-cut-range" min="0" step="0.1" aria-label="${esc(k.word)}"><input type="number" id="sl-cut-h" step="0.1" aria-label="${esc(k.word)} in millimetres"><i>mm</i></div>
      <div class="sl-cut-row"><b>Tilt</b><label class="sl-cut-t"><span id="sl-cut-al">${k.tilt[0]}</span><input type="number" id="sl-cut-a" min="-89" max="89" step="1" aria-label="Tilt about ${k.tilt[0]}, in degrees"></label>
        <label class="sl-cut-t"><span id="sl-cut-bl">${k.tilt[1]}</span><input type="number" id="sl-cut-b" min="-89" max="89" step="1" aria-label="Tilt about ${k.tilt[1]}, in degrees"></label><i>°</i>
        <button type="button" class="sl-btn sl-mini sl-quiet" id="sl-cut-t0" aria-label="Reset the tilt">Reset</button></div>
      ${part('upper', k.up, 'keepUpper', 'placeUpper')}${part('lower', k.down, 'keepLower', 'placeLower')}
      <p class="sl-hint" id="sl-cut-info" role="status" aria-live="polite"></p>
      <div class="sl-ia"><button type="button" class="sl-btn sl-primary" id="sl-cut-go">Cut</button><button type="button" class="sl-btn" id="sl-cut-no">Cancel</button></div>`;
    bind(box);
  }

  function bind(box) {
    for (const b of qa('[data-kind]', box)) on(b, 'click', () => { prefs.kind = cs.kind = b.dataset.kind; cs.a = cs.b = 0; reach(); build(box, P().get(cs.id)); update(); const again = q(`[data-kind="${cs.kind}"]`, box); if (again) again.focus(); });
    on(q('#sl-cut-range', box), 'input', e => { cs.ratio = extent() > 0 ? clamp(Number(e.target.value) / extent(), 0, 1) : 0; update(true); });
    on(q('#sl-cut-h', box), 'input', e => { const v = Number(e.target.value); if (Number.isFinite(v)) { cs.ratio = extent() > 0 ? clamp(v / extent(), 0, 1) : 0; update(true); } });
    const tilt = (id, key) => on(q(id, box), 'input', e => { const v = Number(e.target.value); if (Number.isFinite(v)) { cs[key] = clamp(v, -89, 89); reach(); update(true); } });
    tilt('#sl-cut-a', 'a'); tilt('#sl-cut-b', 'b');
    on(q('#sl-cut-t0', box), 'click', () => { cs.a = cs.b = 0; reach(); update(); });
    for (const b of qa('[data-keep]', box)) on(b, 'click', () => {
      const [side, keep] = b.dataset.keep.split(':'), key = side === 'upper' ? 'keepUpper' : 'keepLower', other = side === 'upper' ? 'keepLower' : 'keepUpper';
      prefs[key] = keep === '1';
      if (!prefs.keepUpper && !prefs.keepLower) prefs[other] = true;       // at least one part stays
      update();
    });
    for (const c of qa('[data-place]', box)) on(c, 'change', () => { prefs[c.dataset.place === 'upper' ? 'placeUpper' : 'placeLower'] = c.checked; });
    on(q('#sl-cut-go', box), 'click', apply);
    on(q('#sl-cut-no', box), 'click', cancel);
    on(q('#sl-cut-x', box), 'click', cancel);
    on(box, 'keydown', e => {
      if (e.key === 'Enter' && e.target.matches('input[type="number"]')) { e.preventDefault(); apply(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
    });
  }

  /* numbers, words and the plane in the view, from the cut being set up (`moving`: a field or the slider is being used, so leave it alone) */
  function update(moving) {
    if (!cs) return;
    const box = q('#sl-insp');
    cs.stamp++;
    const e = extent(), h = heightNow();
    makeQuad();
    if (box) {
      const range = q('#sl-cut-range', box), num = q('#sl-cut-h', box), a = q('#sl-cut-a', box), b = q('#sl-cut-b', box);
      if (range) { range.max = String(Math.max(0, +e.toFixed(2))); if (moving !== true || document.activeElement !== range) range.value = String(+h.toFixed(2)); }
      if (num && document.activeElement !== num) num.value = String(+h.toFixed(2));
      if (a && document.activeElement !== a) a.value = String(cs.a);
      if (b && document.activeElement !== b) b.value = String(cs.b);
      for (const el of qa('[data-keep]', box)) { const [side, keep] = el.dataset.keep.split(':'); el.setAttribute('aria-pressed', String((side === 'upper' ? prefs.keepUpper : prefs.keepLower) === (keep === '1'))); el.classList.toggle('is-on', el.getAttribute('aria-pressed') === 'true'); }
      for (const el of qa('[data-kind]', box)) el.classList.toggle('is-on', el.dataset.kind === cs.kind);
    }
    info();
    schedule();
    if (S()) S().draw();
  }
  function info() {
    const out = q('#sl-cut-info'), go = q('#sl-cut-go');
    if (!out || !cs) return;
    const k = KINDS[cs.kind], e = extent(), h = heightNow(), edge = h < 0.05 || h > e - 0.05;
    const settled = cs.preview && cs.preview.stamp === cs.stamp ? cs.preview : null;
    const missed = edge || (settled && !settled.through);
    out.className = 'sl-hint' + (missed ? ' sl-warn' : '');
    if (missed) out.innerHTML = '<span>The plane does not go through the model.</span>';
    else {
      // one text per piece, so each is a whole sentence of its own
      const face = settled ? ` <span>Cut face ${esc(fmt(settled.area, 0))} mm².</span>` : '';
      const bad = settled && (settled.issues.openLoops || settled.issues.earFallbacks) ? ' <span>The model has gaps here, so the cut face may not close everywhere.</span>' : '';
      out.innerHTML = `<span>${esc(k.sizes(fmt(e - h, 1), fmt(h, 1)))}</span>${face}${bad}`;
    }
    if (go) go.disabled = !!missed;
  }

  function apply() {
    if (!cs) return;
    const m = P(), id = cs.id;
    const r = (() => {
      try { return m.cutObject(id, { plane: plane(), keep: { upper: prefs.keepUpper, lower: prefs.keepLower }, place: { upper: prefs.placeUpper, lower: prefs.placeLower } }); } catch (e) { say(e.message, 'warn'); return undefined; }
    })();
    if (r === undefined) return;
    if (!r) { say('The plane does not go through the model, so there is nothing to cut.', 'warn'); return; }
    if (state.tool === 'cut') SL.prepare.setTool('cut');                   // pressing the tool again leaves it
    const k = KINDS[prefs.kind];
    say(r.made.length > 1 ? k.both : prefs.keepUpper ? k.gone.lower : k.gone.upper, 'ok');
    if (r.issues.openLoops || r.issues.earFallbacks) say('The model has gaps at the cut, so its flat face may not be closed everywhere. Look at the parts before printing.', 'warn');
    if (r.lostColours) say('The colours painted in the file are not kept in the parts. Each part prints with one head.', 'info');
  }
  function cancel() { if (state.tool === 'cut') SL.prepare.setTool('cut'); }

  SL.cut = { panel, leave, active: () => !!cs };
})();
