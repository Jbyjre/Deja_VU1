/* The Slicer, part 2 of 5: the Prepare page. The plate toolbar, the object list, the inspector for the selected object, the problems shown on
 * the plate, the plate tabs, getting models in (the library, a file, a drop, the sample) and the keys. The plate model (slicer-model.js)
 * holds the truth; this part draws it into the scene (slicer-scene.js) and turns presses and gestures into model changes. */
'use strict';
(() => {
  const { state, ic, q, qa, on, esc, fmt, say, headColour, clamp } = SL;
  const M = window.SlicerModel, S = () => state.view, P = () => state.model;
  const MODEL_KINDS = ['stl', '3mf', 'obj'];

  const TOOLS = [
    { group: 'Plate', items: [
      { id: 'add', icon: 'add', label: 'Add models', key: 'Ctrl I', run: () => q('#sl-file').click() },
      { id: 'delete', icon: 'trash', label: 'Delete', key: 'Del', run: () => removeSelected(), needs: 'sel' },
      { id: 'arrange', icon: 'arrange', label: 'Arrange', key: 'A', run: () => SL.arrange(), needs: 'objects' },
      { id: 'orient', icon: 'orient', label: 'Auto-orient', key: 'Q', run: () => SL.orient(), needs: 'sel' }] },
    { group: 'Shape', items: [
      { id: 'move', icon: 'move', label: 'Move', key: 'M', tool: true, needs: 'sel' },
      { id: 'rotate', icon: 'rotate', label: 'Rotate', key: 'R', tool: true, needs: 'sel' },
      { id: 'scale', icon: 'scale', label: 'Scale', key: 'S', tool: true, needs: 'sel' },
      { id: 'face', icon: 'face', label: 'Lay on face', key: 'F', tool: true, needs: 'sel' },
      { id: 'split', icon: 'split', label: 'Split into parts', key: '', run: () => splitSelected(), needs: 'sel' }] },
    { group: 'Check', items: [
      { id: 'measure', icon: 'measure', label: 'Measure', key: 'U', tool: true, needs: 'objects' },
      { id: 'overhang', icon: 'overhang', label: 'Show overhangs', key: '', toggle: true, run: () => toggleOverhang(), needs: 'objects' }] },
    { group: 'History', items: [
      { id: 'undo', icon: 'undo', label: 'Undo', key: 'Ctrl Z', run: () => P().undo() },
      { id: 'redo', icon: 'redo', label: 'Redo', key: 'Ctrl Y', run: () => P().redo() }] }
  ];

  /* [name the scene knows, words, Snapmaker Orca's key, what the button says] */
  const VIEWS = [['iso', 'Default view', 'Ctrl 0', '3D'], ['top', 'Top view', 'Ctrl 1', 'Top'], ['bottom', 'Bottom view', 'Ctrl 2', 'Btm'], ['front', 'Front view', 'Ctrl 3', 'Frt'],
    ['back', 'Rear view', 'Ctrl 4', 'Rear'], ['left', 'Left view', 'Ctrl 5', 'Lft'], ['right', 'Right view', 'Ctrl 6', 'Rgt']];

  /* ---- the page ------------------------------------------------------------------------------------------------------------------ */
  function build() {
    const host = document.getElementById('sl-prepare');
    const tools = TOOLS.map(g => `<div class="sl-tg" role="group" aria-label="${esc(g.group)}">${g.items.map(t =>
      `<button type="button" class="sl-tb" id="sl-t-${t.id}" data-tool="${t.id}" aria-label="${esc(t.label)}" data-tip="${esc(t.label)}${t.key ? ' · ' + esc(t.key) : ''}"${t.tool || t.toggle ? ' aria-pressed="false"' : ''}>${ic(t.icon)}</button>`).join('')}</div>`).join('');
    host.innerHTML = `
      <aside class="sl-dock" id="sl-dock" aria-label="Plate setup">
        <div class="sl-blk" id="sl-blk-printer"></div>
        <div class="sl-blk" id="sl-blk-heads"></div>
        <div class="sl-blk" id="sl-blk-process"></div>
        <div class="sl-blk sl-blk-objects" id="sl-blk-objects">
          <div class="sl-bh"><span class="sl-bt">Objects</span><span class="sl-bs" id="sl-obj-count"></span></div>
          <ul class="sl-objs" id="sl-objs" aria-label="Objects on this plate"></ul>
        </div>
      </aside>
      <div class="sl-toolbar" id="sl-toolbar" role="toolbar" aria-label="Plate tools">${tools}</div>
      <div class="sl-views" id="sl-views" role="group" aria-label="View">
        ${VIEWS.map(([id, label, key, short]) => `<button type="button" class="sl-vb" data-view="${id}" aria-label="${esc(label)}" data-tip="${esc(label)} · ${key}"><span>${esc(short)}</span></button>`).join('')}
        <button type="button" class="sl-vb sl-vfit" id="sl-fit" aria-label="Fit the view" data-tip="Fit the view · Z">${ic('fit')}</button>
        <button type="button" class="sl-vb sl-vopt" id="sl-cam-btn" aria-label="Camera options" aria-expanded="false" data-tip="Camera options">${ic('camera')}</button>
        <button type="button" class="sl-vb" id="sl-keys-btn" aria-label="Keyboard and mouse" aria-expanded="false" data-tip="Keyboard and mouse · ?">${ic('keys')}</button>
      </div>
      <div class="sl-problems" id="sl-problems" aria-live="polite"></div>
      <section class="sl-insp" id="sl-insp" aria-label="Selected object" hidden></section>
      <div class="sl-plates" id="sl-plates" role="tablist" aria-label="Plates"></div>
      <div class="sl-empty" id="sl-empty" hidden></div>
      <div class="sl-note" id="sl-note" role="status" aria-live="polite" hidden></div>
      <input type="file" id="sl-file" hidden multiple accept=".stl,.obj,.3mf,model/stl,model/3mf">
      <div class="sl-drop" id="sl-drop" aria-hidden="true">Drop to put it on the plate</div>`;
    for (const t of TOOLS.flatMap(g => g.items)) {
      const b = q('#sl-t-' + t.id);
      on(b, 'click', () => (t.tool ? setTool(t.id) : t.run && t.run()));
    }
    for (const b of qa('[data-view]')) on(b, 'click', () => { S() && S().setView(b.dataset.view); });
    on(q('#sl-fit'), 'click', () => S() && S().fitSelection());
    on(q('#sl-cam-btn'), 'click', () => SL.keys && SL.keys.toggleCamera());
    on(q('#sl-keys-btn'), 'click', () => SL.keys && SL.keys.toggle());
    on(q('#sl-file'), 'change', e => { addFiles([...e.target.files]); e.target.value = ''; });
    bindDrop();
  }

  /* ---- tools --------------------------------------------------------------------------------------------------------------------- */
  function setTool(id) {
    state.tool = state.tool === id && id !== 'move' ? 'move' : id;
    const v = S();
    if (v) { v.setTool(['move', 'rotate', 'scale'].includes(state.tool) ? state.tool : 'none'); v.pickMode = ['face', 'measure'].includes(state.tool); }
    state.measure = null;
    note(state.tool === 'face' ? 'Click the face that should lie flat on the plate.' : state.tool === 'measure' ? 'Click two points on a model to measure between them.' : '');
    refreshTools();
  }

  function toggleOverhang() {
    state.overhang = !state.overhang;
    S() && S().setOverhang(state.overhang);
    refreshTools();
  }

  function refreshTools() {
    const m = P(), sel = m.selected.size > 0, any = m.onPlate().length > 0;
    for (const t of TOOLS.flatMap(g => g.items)) {
      const b = q('#sl-t-' + t.id);
      if (!b) continue;
      let off = false;
      if (t.needs === 'sel') off = !sel; else if (t.needs === 'objects') off = !any;
      if (t.id === 'undo') off = !m.undoStack.length;
      if (t.id === 'redo') off = !m.redoStack.length;
      if (t.id === 'split') off = !sel;
      b.disabled = off;
      if (t.tool) b.setAttribute('aria-pressed', String(state.tool === t.id));
      if (t.toggle) b.setAttribute('aria-pressed', String(state.overhang));
    }
  }

  let noteTimer = 0;
  function note(text, ms = 0) {
    const n = q('#sl-note');
    if (!n) return;
    n.textContent = text;
    n.hidden = !text;
    clearTimeout(noteTimer);
    if (ms) noteTimer = setTimeout(() => { n.hidden = true; }, ms);
  }

  function removeSelected() {
    const ids = [...P().selected];
    if (ids.length) P().remove(ids);
  }

  function splitSelected() {
    const id = [...P().selected][0];
    if (!id) return;
    const made = P().splitParts(id);
    if (!made.length) note('This model is one solid piece, so there is nothing to split.', 4000);
    else say(`Split into ${made.length} parts.`, 'ok');
  }

  /* The quick arrangement, or the engine's when it is installed (slicer-preview.js asks the engine first). */
  SL.arrange = async function () {
    const m = P();
    const ids = m.selected.size > 1 ? [...m.selected] : undefined;
    if (SL.engineArrange) {
      const done = await SL.engineArrange('arrange', ids);
      if (done) return;
    }
    const res = m.arrange({ ids });
    if (res.failed.length) say(`${res.failed.length} object${res.failed.length > 1 ? 's' : ''} would not fit on this plate. Move ${res.failed.length > 1 ? 'them' : 'it'} to another plate.`, 'warn');
    else note(SL.engineReady && SL.engineReady() ? '' : 'Arranged with the quick arrangement. With the slicing engine installed, the engine arranges.', 5000);
  };
  /* Q turns the selected models; with none selected (or with Shift) it turns every model on the plate, as in Snapmaker Orca. */
  SL.orient = async function (everyModel) {
    const m = P(), ids = m.selected.size && !everyModel ? [...m.selected] : m.onPlate().map(o => o.id);
    if (!ids.length) return;
    if (SL.engineArrange && await SL.engineArrange('orient', ids)) return;
    let moved = 0, shown = null;
    for (const id of ids) { const r = m.autoOrient(id); if (r && r.changed) { moved++; shown = r; } }
    if (!moved) return note('It already stands the way that needs the least support.', 4000);
    note(`Turned to need less support (${Math.round(shown.before.overhang * 100)}% of the surface hung out, now ${Math.round(shown.after.overhang * 100)}%). This is the built-in orienting.`, 6000);
  };

  /* ---- the scene follows the model ------------------------------------------------------------------------------------------------ */
  const TOWER_ID = 990;
  function syncScene(ids) {
    const v = S(), m = P();
    if (!v) return;
    const live = new Set(m.objects.map(o => o.id));
    for (const id of [...v.items.keys()]) if (id !== TOWER_ID && !live.has(id)) v.removeItem(id);
    for (const o of m.objects) {
      const mine = o.plate === m.current;
      if (!v.items.has(o.id)) v.addItem({ id: o.id, mesh: o.mesh, transform: o.transform, color: headColour(o.tool), keepColour: o.keepColour });
      const b = M.boundsOf(o);
      v.setItemTransform(o.id, o.transform, { min: b.min, max: b.max });
      v.setItemColor(o.id, headColour(o.tool));
      const it = v.items.get(o.id);
      it.keepColour = o.keepColour && !!o.mesh.colours && !m.objects.some(x => x.plate === m.current && x.tool !== 0 && false);
      v.setItemHidden(o.id, !mine || o.hidden || o.aside);
      v.setItemOutside(o.id, mine && !o.aside && m.isOutside(o));
    }
    v.select([...m.selected]);
    if (SL.syncTower) SL.syncTower();
  }

  function afterChange(kind, ids) {
    const m = P();
    state.problems = m.problems({ overhangs: true }).concat(SL.towerProblems ? SL.towerProblems() : []);
    syncScene(ids);
    renderObjects();
    renderInspector(kind);
    renderProblems();
    renderPlates();
    renderEmpty();
    refreshTools();
    if (SL.onPlateChanged) SL.onPlateChanged(kind, ids);
    if (kind !== 'init') saveProject();
    const v = S();
    // The view is the person's: it is framed again only for the first model on a plate, a new plate and an emptied one (Snapmaker Orca
    // does not move the camera when models are arranged, copied or deleted).
    if (v && ['add', 'clear', 'plate', 'plates'].includes(kind)) {
      if (kind === 'add' && m.onPlate().length === 1) v.fitSelection(); else if (kind !== 'add') v.fitAll();
    }
  }

  /* ---- gestures from the scene ------------------------------------------------------------------------------------------------------ */
  let drag = null;
  function bindScene() {
    const v = S();
    v.on('select', ({ id, additive, ids, mode }) => {
      const m = P();
      if (ids) {
        // a box dragged on the plate: it replaces the selection, adds to it (Ctrl) or takes away from it (Alt)
        const found = ids.filter(i => m.get(i));
        m.selected = mode === 'add' ? new Set([...m.selected, ...found]) : mode === 'remove' ? new Set([...m.selected].filter(i => !found.includes(i))) : new Set(found);
      } else if (!id) { if (!additive) m.selected = new Set(); }
      else if (additive) { if (m.selected.has(id)) m.selected.delete(id); else m.selected.add(id); }
      else m.selected = new Set([id]);
      v.select([...m.selected]);
      renderObjects(); renderInspector(); refreshTools();
    });
    v.on('hover', hit => {
      qa('.sl-obj', q('#sl-objs')).forEach(li => li.classList.toggle('is-hover', hit.kind === 'item' && Number(li.dataset.id) === hit.id));
    });
    v.on('gesture', g => {
      const m = P(), o = m.get(g.id);
      if (!o) return;
      if (g.phase === 'start') { m.checkpoint(); drag = { id: g.id, start: o.transform.slice(), centre: M.boundsOf(o).centre.slice() }; return; }
      if (g.phase === 'end') {
        if (drag) { const t = o.transform; o._b = null; m.setTransform(o.id, t, { checkpoint: false }); drag = null; }
        return;
      }
      if (!drag) return;
      o.transform = drag.start.slice(); o._b = null; o._o = null;
      if (g.kind === 'move') {
        let d = g.delta.slice();
        if (g.snap && g.handle !== false && g.fromHandle) d = d.map(x => Math.round(x));
        o.transform[9] += d[0]; o.transform[10] += d[1]; o.transform[11] += d[2];
        if (o.transform[11] + (M.boundsOf(o).min[2] - o.transform[11]) < 0) { /* stays free: the problems list says so */ }
      } else if (g.kind === 'rotate') {
        let a = g.angle * 180 / Math.PI;
        if (g.snap) a = Math.round(a / 5) * 5;
        m.around(o, M.rotation(g.axis, a));
        note(`${a > 0 ? '+' : ''}${fmt(a, 0)}°`);
      } else if (g.kind === 'scale') {
        let r = g.ratio;
        if (g.snap) r = Math.round(r * 20) / 20;
        const mx = M.IDENTITY.slice(); mx[0] = mx[4] = mx[8] = Math.max(0.05, r);
        m.around(o, mx);
        note(`${Math.round(Math.max(0.05, r) * 100)}%`);
      }
      const b = M.boundsOf(o);
      v.setItemTransform(o.id, o.transform, { min: b.min, max: b.max });
      v.setItemOutside(o.id, m.isOutside(o));
      fillInspectorNumbers();
    });
    v.on('surface', ({ id, x, y }) => surfaceClick(id, x, y));
  }

  /* a click on a model's surface while Lay on face or Measure is on */
  function surfaceClick(id, x, y) {
    const m = P(), o = m.get(id), v = S();
    if (!o) return;
    const hit = v.surfaceAt(x, y, id, o.mesh, o.transform);
    if (!hit) return;
    if (state.tool === 'face') {
      m.selected = new Set([id]);
      m.layOnFace(id, hit.normal);
      setTool('move');
      note('Laid on that face.', 2500);
      v.fitSelection();
    } else if (state.tool === 'measure') {
      const pts = (state.measure = state.measure || []);
      pts.push(hit.point);
      if (pts.length === 2) {
        const d = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]);
        note(`${fmt(d, 2)} mm  (X ${fmt(pts[1][0] - pts[0][0], 2)}, Y ${fmt(pts[1][1] - pts[0][1], 2)}, Z ${fmt(pts[1][2] - pts[0][2], 2)})`);
        state.measure = null;
      } else note('Now the second point.');
    }
  }

  /* ---- the object list ----------------------------------------------------------------------------------------------------------------- */
  function renderObjects() {
    const m = P(), list = q('#sl-objs'), rows = m.objects.filter(o => o.plate === m.current);
    q('#sl-obj-count').textContent = rows.length ? `Plate ${m.current + 1} · ${rows.length}` : '';
    if (!rows.length) { list.innerHTML = '<li class="sl-obj-empty">Nothing on this plate yet.</li>'; return; }
    list.innerHTML = rows.map(o => {
      const b = M.boundsOf(o), sel = m.selected.has(o.id), c = state.heads[o.tool] ? state.heads[o.tool].hex : '#888888';
      return `<li class="sl-obj${sel ? ' is-sel' : ''}${o.aside ? ' is-aside' : ''}${o.hidden ? ' is-hidden' : ''}" data-id="${o.id}">
        <button type="button" class="sl-ov" data-act="hide" aria-label="${o.hidden ? 'Show' : 'Hide'} ${esc(o.name)}">${ic(o.hidden ? 'eyeoff' : 'eye')}</button>
        <button type="button" class="sl-on" data-act="select" aria-label="Select ${esc(o.name)}" aria-pressed="${sel}"><span class="sl-name">${esc(o.name)}</span><span class="sl-dim">${b.size.map(v => fmt(v, 0)).join(' × ')} mm</span></button>
        <span class="sl-head" style="--c:${esc(c)}" title="Printed by head T${o.tool}">T${o.tool}</span>
        <button type="button" class="sl-ox" data-act="remove" aria-label="Remove ${esc(o.name)}">${ic('x')}</button></li>`;
    }).join('');
  }

  function bindObjects() {
    on(q('#sl-objs'), 'click', e => {
      const li = e.target.closest('.sl-obj'), b = e.target.closest('[data-act]');
      if (!li || !b) return;
      const id = Number(li.dataset.id), m = P(), act = b.dataset.act;
      if (act === 'select') {
        if (e.shiftKey || e.ctrlKey || e.metaKey) { if (m.selected.has(id)) m.selected.delete(id); else m.selected.add(id); } else m.selected = new Set([id]);
        S().select([...m.selected]); renderObjects(); renderInspector(); refreshTools();
      } else if (act === 'hide') m.setHidden(id, !m.get(id).hidden);
      else if (act === 'remove') m.remove([id]);
    });
    on(q('#sl-objs'), 'dblclick', e => {
      const name = e.target.closest('.sl-name');
      if (!name) return;
      const li = name.closest('.sl-obj'), id = Number(li.dataset.id), o = P().get(id);
      const input = document.createElement('input');
      input.className = 'sl-rename'; input.value = o.name; input.maxLength = 120; input.setAttribute('aria-label', 'Name');
      name.replaceWith(input); input.focus(); input.select();
      const done = ok => { if (ok && input.value.trim()) P().rename(id, input.value); else renderObjects(); };
      on(input, 'keydown', k => { if (k.key === 'Enter') done(true); else if (k.key === 'Escape') done(false); });
      on(input, 'blur', () => done(true));
    });
  }

  /* ---- the inspector --------------------------------------------------------------------------------------------------------------- */
  const FIELD = (id, label) => `<label class="sl-f"><span>${label}</span><input type="number" step="any" id="sl-i-${id}" aria-label="${label || id}"></label>`;

  function renderInspector(kind) {
    const m = P(), box = q('#sl-insp');
    const ids = [...m.selected].filter(id => m.get(id) && m.get(id).plate === m.current);
    // Only the numbers changed (a move, a turn, a size): update them where they stand, so a field being typed in keeps its focus and its text.
    if (kind === 'transform' && ids.length === 1 && !box.hidden && box.dataset.obj === String(ids[0]) && q('#sl-i-x')) { fillInspectorNumbers(); return; }
    box.dataset.obj = ids.length === 1 ? String(ids[0]) : '';
    if (ids.length !== 1) {
      box.hidden = ids.length === 0;
      if (ids.length > 1) {
        box.innerHTML = `<div class="sl-ih"><b>${ids.length} objects selected</b></div>
          <div class="sl-ia"><button type="button" class="sl-btn" id="sl-i-arr">${ic('arrange')}Arrange them</button><button type="button" class="sl-btn" id="sl-i-dup">${ic('copy')}Duplicate</button><button type="button" class="sl-btn" id="sl-i-del">${ic('trash')}Remove</button></div>
          <div class="sl-heads" role="group" aria-label="Head for all of them">${headChips(null)}</div>`;
        on(q('#sl-i-arr'), 'click', () => SL.arrange());
        on(q('#sl-i-dup'), 'click', () => m.duplicate(ids, 1));
        on(q('#sl-i-del'), 'click', () => m.remove(ids));
        bindHeadChips(ids);
      }
      setInsets();
      return;
    }
    const o = m.get(ids[0]);
    box.hidden = false;
    const set = o.settings;
    box.innerHTML = `
      <div class="sl-ih"><input class="sl-iname" id="sl-i-name" value="${esc(o.name)}" maxlength="120" aria-label="Name"><button type="button" class="sl-ix" id="sl-i-close" aria-label="Hide the object panel">${ic('down')}</button></div>
      <div class="sl-igrid">
        <div class="sl-irow"><b>Position <i>mm</i></b>${FIELD('x', 'X')}${FIELD('y', 'Y')}${FIELD('z', 'Z')}</div>
        <div class="sl-irow"><b>Size <i>mm</i></b>${FIELD('sx', 'X')}${FIELD('sy', 'Y')}${FIELD('sz', 'Z')}</div>
        <div class="sl-irow"><b>Turn <i>°</i></b>${FIELD('rx', 'X')}${FIELD('ry', 'Y')}${FIELD('rz', 'Z')}</div>
        <div class="sl-irow"><b>Scale <i>%</i></b>${FIELD('pct', '')}<button type="button" class="sl-lock" id="sl-i-lock" aria-pressed="${state.lock !== false}" aria-label="Keep the proportions" data-tip="Keep the proportions">${ic(state.lock === false ? 'unlock' : 'lock')}</button><span class="sl-irest"></span></div>
      </div>
      <div class="sl-heads" role="group" aria-label="Head that prints it">${headChips(o.tool)}</div>
      <div class="sl-iset"><b>This object only</b><div class="sl-iset3">
        <label class="sl-lf"><span>Walls</span><input type="number" min="1" max="20" id="sl-i-walls" placeholder="preset" aria-label="Walls" value="${set.wall_loops ?? ''}"></label>
        <label class="sl-lf"><span>Infill %</span><input type="number" min="0" max="100" id="sl-i-infill" placeholder="preset" aria-label="Infill" value="${set.sparse_infill_density !== undefined ? parseFloat(set.sparse_infill_density) : ''}"></label>
        <label class="sl-lf"><span>Supports</span><select id="sl-i-support" aria-label="Supports"><option value="">Preset</option><option value="1">On</option><option value="0">Off</option></select></label></div></div>
      <div class="sl-ia">
        <button type="button" class="sl-btn" id="sl-i-drop">Drop to plate</button>
        <button type="button" class="sl-btn" id="sl-i-flat">Lay flat</button>
        <button type="button" class="sl-btn" id="sl-i-reset">Reset</button>
        <button type="button" class="sl-btn" id="sl-i-dup" aria-label="Duplicate">${ic('copy')}</button>
        <button type="button" class="sl-btn" id="sl-i-aside" aria-label="${o.aside ? 'Put back on the plate' : 'Set aside'}" data-tip="${o.aside ? 'Put back on the plate' : 'Set aside, off the plate'}">${ic('aside')}</button>
        <span class="sl-mir" role="group" aria-label="Mirror">${['X', 'Y', 'Z'].map((a, i) => `<button type="button" class="sl-btn sl-mini" data-mirror="${i}" aria-label="Mirror ${a}">${a}</button>`).join('')}</span>
      </div>`;
    q('#sl-i-support').value = set.enable_support === undefined ? '' : String(set.enable_support === true || set.enable_support === '1' || set.enable_support === 1 ? 1 : 0);
    bindInspector(o);
    fillInspectorNumbers();
    setInsets();
  }

  function headChips(current) {
    return [0, 1, 2, 3].map(i => {
      const h = state.heads[i] || {}, c = h.hex || '#888888';
      return `<button type="button" class="sl-hc${current === i ? ' is-on' : ''}" data-head="${i}" style="--c:${esc(c)}" aria-pressed="${current === i}" aria-label="Print with head T${i}${h.material ? ', ' + esc(h.material) : ''}"><i></i><span>T${i}</span></button>`;
    }).join('');
  }
  function bindHeadChips(ids) {
    for (const b of qa('.sl-hc', q('#sl-insp'))) on(b, 'click', () => P().setTool(ids, Number(b.dataset.head)));
  }

  function fillInspectorNumbers() {
    const m = P(), id = [...m.selected][0], o = m.get(id);
    if (!o || !q('#sl-i-x')) return;
    const b = M.boundsOf(o), setv = (n, v) => { const el = q('#sl-i-' + n); if (el && document.activeElement !== el) el.value = fmt(v, 2); };
    setv('x', b.centre[0]); setv('y', b.centre[1]); setv('z', b.min[2]);
    setv('sx', b.size[0]); setv('sy', b.size[1]); setv('sz', b.size[2]);
    const src = o.mesh.size || o.mesh.bounds.max.map((v, i) => v - o.mesh.bounds.min[i]);
    const pct = el => { const x = q('#sl-i-pct'); if (x && document.activeElement !== x) x.value = fmt(el, 1); };
    pct(100 * Math.hypot(o.transform[0], o.transform[1], o.transform[2]));
    void src;
  }

  function bindInspector(o) {
    const m = P(), id = o.id, num = n => parseFloat(q('#sl-i-' + n).value);
    on(q('#sl-i-close'), 'click', () => { q('#sl-insp').classList.toggle('is-min'); setInsets(); });
    on(q('#sl-i-name'), 'change', e => m.rename(id, e.target.value));
    const place = () => { const x = num('x'), y = num('y'), z = num('z'); if ([x, y, z].every(Number.isFinite)) m.place(id, { x, y, z }); };
    for (const n of ['x', 'y', 'z']) on(q('#sl-i-' + n), 'change', place);
    const size = axis => () => {
      const v = num('s' + axis);
      if (!(v > 0)) return renderInspector();
      const b = M.boundsOf(m.get(id)), s = b.size.slice();
      try {
        if (state.lock === false) { const r = [1, 1, 1]; r['xyz'.indexOf(axis)] = v / s['xyz'.indexOf(axis)]; m.scaleBy(id, r); }
        else m.scaleBy(id, v / s['xyz'.indexOf(axis)]);
      } catch (e) { say(e.message, 'warn'); }
    };
    for (const a of ['x', 'y', 'z']) on(q('#sl-i-s' + a), 'change', size(a));
    on(q('#sl-i-pct'), 'change', () => {
      const cur = Math.hypot(...m.get(id).transform.slice(0, 3)), want = num('pct') / 100;
      if (!(want > 0)) return renderInspector();
      try { m.scaleBy(id, want / cur); } catch (e) { say(e.message, 'warn'); }
    });
    on(q('#sl-i-lock'), 'click', () => { state.lock = state.lock === false; renderInspector(); });
    for (const [n, axis] of [['rx', 0], ['ry', 1], ['rz', 2]]) on(q('#sl-i-' + n), 'change', () => {
      const d = num(n);
      if (Number.isFinite(d) && d !== 0) { m.rotateBy(id, axis, d); m.drop(id, { checkpoint: false }); }
      q('#sl-i-' + n).value = '0';
    });
    for (const n of ['rx', 'ry', 'rz']) q('#sl-i-' + n).value = '0';
    bindHeadChips([id]);
    on(q('#sl-i-walls'), 'change', e => m.setSetting(id, 'wall_loops', e.target.value === '' ? '' : clamp(parseInt(e.target.value, 10) || 1, 1, 20)));
    on(q('#sl-i-infill'), 'change', e => m.setSetting(id, 'sparse_infill_density', e.target.value === '' ? '' : clamp(parseFloat(e.target.value) || 0, 0, 100)));
    on(q('#sl-i-support'), 'change', e => m.setSetting(id, 'enable_support', e.target.value === '' ? '' : e.target.value === '1'));
    on(q('#sl-i-drop'), 'click', () => m.drop(id));
    on(q('#sl-i-flat'), 'click', () => { try { m.layLargestFace(id); } catch (e) { say(e.message, 'warn'); } });
    on(q('#sl-i-reset'), 'click', () => resetObject(id));
    on(q('#sl-i-dup'), 'click', () => m.duplicate([id], 1));
    on(q('#sl-i-aside'), 'click', () => m.setAside(id, !m.get(id).aside));
    for (const b of qa('[data-mirror]', q('#sl-insp'))) on(b, 'click', () => m.mirror(id, Number(b.dataset.mirror)));
  }

  /* turn and size back to how it came in, where it stands */
  function resetObject(id) {
    const m = P(), o = m.get(id);
    if (!o) return;
    const c = M.boundsOf(o).centre;
    m.checkpoint();
    o.transform = M.IDENTITY.slice(); o._b = null; o._o = null;
    m.centre(o, c[0], c[1]);
    m.changed('transform', [id]);
  }

  /* ---- problems ------------------------------------------------------------------------------------------------------------------- */
  function renderProblems() {
    const box = q('#sl-problems'), list = state.problems.filter(p => p.level !== 'info' || state.showInfo);
    const infos = state.problems.length - list.length;
    if (!state.problems.length) { box.innerHTML = ''; return; }
    const shown = state.allProblems ? list : list.slice(0, 3), more = list.length - shown.length;
    box.innerHTML = shown.map((p, i) => `<div class="sl-pb sl-${p.level}" data-i="${state.problems.indexOf(p)}">
        <span class="sl-pi">${ic(p.level === 'info' ? 'info' : 'warn')}</span><span class="sl-pt">${esc(p.text)}</span>
        ${p.fix ? `<button type="button" class="sl-pf" data-fix="1">${esc(p.fix.label)}</button>` : ''}${p.fix2 ? `<button type="button" class="sl-pf" data-fix="2">${esc(p.fix2.label)}</button>` : ''}</div>`).join('')
      + (more > 0 ? `<button type="button" class="sl-pmore" id="sl-pmore">${more} more</button>` : '')
      + (infos > 0 && !state.showInfo ? `<button type="button" class="sl-pmore" id="sl-pinfo">${infos} hint${infos > 1 ? 's' : ''}</button>` : '');
    for (const row of qa('.sl-pb', box)) {
      const p = state.problems[Number(row.dataset.i)];
      on(row, 'click', e => {
        const fixBtn = e.target.closest('[data-fix]');
        if (fixBtn) return applyFix(p, fixBtn.dataset.fix === '2' ? p.fix2 : p.fix);
        P().selected = new Set(p.ids.filter(id => P().get(id)));
        S().select([...P().selected]); renderObjects(); renderInspector(); refreshTools(); S().fitSelection();
      });
    }
    on(q('#sl-pmore'), 'click', () => { state.allProblems = true; renderProblems(); });
    on(q('#sl-pinfo'), 'click', () => { state.showInfo = true; renderProblems(); });
  }

  function applyFix(p, fix) {
    const m = P(), id = p.ids[0], a = window.U1Plate.AREA;
    if (!fix) return;
    try {
      if (fix.action === 'drop') m.drop(id);
      else if (fix.action === 'arrange') SL.arrange();
      else if (fix.action === 'overhang') { if (!state.overhang) toggleOverhang(); }
      else if (fix.action === 'inches') m.scaleBy(id, 25.4);
      else if (fix.action === 'metres') m.scaleBy(id, 1000);
      else if (fix.action === 'fit') {
        const s = M.boundsOf(m.get(id)).size, r = Math.min((a.x1 - a.x0 - 6) / s[0], (a.y1 - a.y0 - 6) / s[1], (a.z1 - 2) / s[2]);
        m.scaleBy(id, r); m.place(id, { x: (a.x0 + a.x1) / 2, y: (a.y0 + a.y1) / 2, z: 0 });
      } else if (SL.fixAction && SL.fixAction(fix.action)) { /* a tower fix, done in the settings */
      } else if (fix.action === 'inside') {
        const b = M.boundsOf(m.get(id)), x = clamp(b.centre[0], a.x0 + b.size[0] / 2 + 1, a.x1 - b.size[0] / 2 - 1), y = clamp(b.centre[1], a.y0 + b.size[1] / 2 + 1, a.y1 - b.size[1] / 2 - 1);
        m.place(id, { x, y });
      }
    } catch (e) { say(e.message, 'warn'); }
  }

  /* ---- plates ---------------------------------------------------------------------------------------------------------------------- */
  function renderPlates() {
    const m = P(), box = q('#sl-plates');
    const tabs = Array.from({ length: m.plates }, (_, i) => {
      const n = m.onPlate(i).length, on_ = i === m.current;
      return `<button type="button" role="tab" class="sl-pt-tab${on_ ? ' is-on' : ''}" data-plate="${i}" aria-selected="${on_}">Plate ${i + 1}<i>${n}</i></button>`;
    }).join('');
    box.innerHTML = tabs + `<button type="button" class="sl-pt-add" id="sl-pt-add" aria-label="Add a plate" data-tip="Add a plate">${ic('plus')}</button>`
      + (m.plates > 1 ? `<button type="button" class="sl-pt-add" id="sl-pt-del" aria-label="Remove plate ${m.current + 1}" data-tip="Remove this plate">${ic('trash')}</button>` : '');
    for (const b of qa('[data-plate]', box)) on(b, 'click', () => m.showPlate(Number(b.dataset.plate)));
    on(q('#sl-pt-add'), 'click', () => { try { m.addPlate(); } catch (e) { say(e.message, 'warn'); } });
    on(q('#sl-pt-del'), 'click', () => {
      if (m.onPlate().length && !confirm(`Remove plate ${m.current + 1} and the ${m.onPlate().length} object${m.onPlate().length > 1 ? 's' : ''} on it?`)) return;
      m.removePlate(m.current);
    });
  }

  /* ---- the empty plate ------------------------------------------------------------------------------------------------------------- */
  async function loadRecent() {
    try {
      const data = await getJSON('/api/files');
      state.recent = (data.files || []).filter(f => MODEL_KINDS.includes(f.kind)).slice(0, 6);
    } catch (_) { state.recent = state.recent || []; }
    renderEmpty();
  }
  SL.loadRecent = loadRecent;

  function renderEmpty() {
    const box = q('#sl-empty'), m = P();
    const empty = m.objects.filter(o => o.plate === m.current).length === 0;
    box.hidden = !empty || state.page !== 'prepare';
    if (box.hidden) return;
    const recent = (state.recent || []).map(f => `<button type="button" class="sl-chip" data-open="${esc(f.name)}" title="${esc(f.name)}">${ic('cube')}<span>${esc(f.name)}</span></button>`).join('');
    box.innerHTML = `<div class="sl-ei">${ic('add')}</div><h2>Put a model on the plate</h2>
      <p>Drop an STL, 3MF or OBJ here, or choose one.</p>
      <div class="sl-eb"><button type="button" class="sl-btn sl-primary" id="sl-e-add">${ic('plus')}Add models</button><button type="button" class="sl-btn" id="sl-e-sample">${ic('cube')}Try the 3DBenchy</button></div>
      ${recent ? `<div class="sl-er"><span>From your files</span><div class="sl-chips">${recent}</div></div>` : ''}`;
    on(q('#sl-e-add'), 'click', () => q('#sl-file').click());
    on(q('#sl-e-sample'), 'click', e => SL.busy(e.currentTarget, 'Adding…', () => openSample()));
    for (const b of qa('[data-open]', box)) on(b, 'click', () => openFromLibrary(b.dataset.open));
  }

  /* ---- getting models in ------------------------------------------------------------------------------------------------------------ */
  async function addMesh(name, buffer, extra = {}) {
    const mesh = await DV3D.parseModel(buffer, name);
    const m = P();
    if (mesh.plateSource) {
      // A plate saved by this app: its objects come back where they were, from the source files it kept.
      const rows = mesh.plateSource.state.objects;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i], bytes = await mesh.plateSource.read(i, r.name);
        if (!bytes) throw new Error('An original source is missing from this plate.');
        const original = await DV3D.parseModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), r.name);
        const o = m.add({ name: String(r.label || r.name), mesh: original, transform: r.transform, tool: r.tool, settings: r.settings || {}, local: new File([bytes], r.name) }, { checkpoint: i === 0 });
        o.file = r.name;
      }
      return;
    }
    m.add({ name, mesh, sourceName: extra.sourceName || null, local: extra.local || null });
  }

  async function openFromLibrary(name) {
    try {
      const res = await fetch(`/api/files/raw?name=${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `The server said ${res.status}`);
      await addMesh(name, await res.arrayBuffer(), { sourceName: name });
    } catch (e) { say(`Could not open ${name}: ${e.message}`, 'warn'); }
  }
  SL.openFromLibrary = openFromLibrary;

  async function addFiles(files) {
    const ok = files.filter(f => MODEL_KINDS.includes((f.name.split('.').pop() || '').toLowerCase()));
    if (files.length && !ok.length) say('The Slicer takes STL, 3MF and OBJ models.', 'warn');
    for (const f of ok) {
      try { await addMesh(f.name, await f.arrayBuffer(), { local: f }); } catch (e) { say(`Could not read ${f.name}: ${e.message}`, 'warn'); }
    }
  }
  SL.addFiles = addFiles;

  async function openSample() {
    try {
      let list = (await getJSON('/api/files')).files || [];
      if (!list.some(f => f.name === '3dbenchy.stl')) { await postJSON('/api/files/samples', {}); list = (await getJSON('/api/files')).files || []; }
      await openFromLibrary('3dbenchy.stl');
    } catch (e) { say(`Could not add the sample: ${e.message}`, 'warn'); }
  }

  function bindDrop() {
    const rootEl = SL.root();
    let depth = 0;
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
    on(rootEl, 'dragenter', e => { if (hasFiles(e)) { depth++; rootEl.classList.add('is-dropping'); } });
    on(rootEl, 'dragover', e => { if (hasFiles(e)) e.preventDefault(); });
    on(rootEl, 'dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) rootEl.classList.remove('is-dropping'); });
    on(rootEl, 'drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; rootEl.classList.remove('is-dropping');
      addFiles([...e.dataTransfer.files]);
    });
  }

  /* ---- the clipboard: Ctrl C and Ctrl X keep what is needed to put the models back, Ctrl V places copies in a free spot (like Snapmaker Orca) ---- */
  let clip = [];
  function copySelected(cut) {
    const m = P(), rows = [...m.selected].map(id => m.get(id)).filter(Boolean);
    if (!rows.length) return false;
    clip = rows.map(o => ({ ...o, transform: o.transform.slice(), settings: { ...o.settings }, _b: null, _o: null }));
    if (cut) removeSelected();
    note(`${cut ? 'Cut' : 'Copied'} ${rows.length} model${rows.length > 1 ? 's' : ''}. Ctrl V ${cut ? 'puts' : 'places'} ${rows.length > 1 ? 'them' : 'it'} on the plate.`, 3500);
    return true;
  }
  function pasteClip() {
    const m = P();
    if (!clip.length) { note('Nothing is copied yet. Select a model and press Ctrl C.', 3500); return true; }
    m.checkpoint();
    const made = [];
    try {
      for (const src of clip) {
        const o = m.add({ name: src.file, label: src.name, sourceName: src.sourceName, local: src.local, mesh: src.mesh, tool: src.tool, transform: src.transform, settings: src.settings,
          keepColour: src.keepColour }, { checkpoint: false });
        m.placeInFreeSpot(o);
        made.push(o.id);
      }
    } catch (e) { say(e.message, 'warn'); }
    if (made.length) { m.selected = new Set(made); m.changed('duplicate', made); }
    return true;
  }
  function deleteAll() {
    const m = P();
    if (!m.objects.length) return true;
    m.clear();
    note('Deleted every model. Ctrl Z brings them back.', 5000);
    return true;
  }
  function togglePanels() {
    SL.root().classList.toggle('sl-panels-off');
    setInsets();
  }
  const DIGIT = e => { const d = /^(?:Digit|Numpad)(\d)$/.exec(e.code || ''); return d ? Number(d[1]) : null; };

  /* ---- keys ----------------------------------------------------------------------------------------------------------------------- */
  /* Snapmaker Orca's keys (the list the Slicer shows on ? is slicer-keys.js). A key acts only while a field is not being typed in and no
     sheet is open; Escape closes a sheet first. Tab flips Prepare and Preview only while the 3D view has the focus from a mouse press, so a
     person moving round the controls with the keyboard is never caught by it. */
  function typing(e) {
    const t = e.target;
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !(t.type === 'checkbox' || t.type === 'button'));
  }
  function onKey(e) {
    if (document.body.dataset.tab !== 'slicer' || typing(e) || e.defaultPrevented) return;
    if (document.querySelector('#sl-sheet, #sl-engine, #sl-why-card, #sl-keys, dialog[open], .glass-dialog.is-open')) return;
    const m = P(), v = S(), mod = e.ctrlKey || e.metaKey, shift = e.shiftKey, k = e.key.toLowerCase(), ids = [...m.selected];
    const prepare = state.page !== 'preview', digit = DIGIT(e), arrow = /^arrow(left|right|up|down)$/.test(k);
    const nudge = (dx, dy, dz) => {
      if (!ids.length) return false;
      const step = shift ? 1 : e.altKey ? 0.1 : 10;
      let mx = dx, my = dy;
      if (mod && v) { const a = v.planeAxes(); mx = a.right[0] * dx + a.away[0] * dy; my = a.right[1] * dx + a.away[1] * dy; }
      if (!e.repeat) m.checkpoint();        // holding a key is one step to undo, not one for every repeat
      for (const id of ids) m.moveBy(id, [mx * step, my * step, dz * step], { checkpoint: false });
      return true;
    };
    const move = { arrowleft: [-1, 0, 0], arrowright: [1, 0, 0], arrowup: [0, 1, 0], arrowdown: [0, -1, 0], pageup: [0, 0, 1], pagedown: [0, 0, -1] }[k];
    let handled = true;
    if (mod && digit !== null && digit <= 6) v.setView(VIEWS[digit][0]);
    else if (mod && k === 'r' && !shift) SL.preview && SL.preview.sliceKey();
    else if (mod && k === 'g') { if (shift) SL.preview && SL.preview.printKey(); else SL.preview && SL.preview.saveKey(); }
    else if (mod && k === 'i') q('#sl-file').click();
    else if (mod && !prepare) handled = SL.path && SL.path.key ? SL.path.key(e) : false;
    else if (mod) {
      if (k === 'z') { if (shift) m.redo(); else m.undo(); }
      else if (k === 'y') m.redo();
      else if (k === 'a') { m.selected = new Set(m.onPlate().map(o => o.id)); v.select([...m.selected]); renderObjects(); renderInspector(); refreshTools(); }
      else if (k === 'c') handled = copySelected(false);
      else if (k === 'x') handled = copySelected(true);
      else if (k === 'v') handled = pasteClip();
      else if (k === 'k') { if (ids.length) m.duplicate(ids, 1); else handled = false; }
      else if (k === 'd') handled = deleteAll();
      else if (arrow) handled = nudge(...move);
      else handled = false;
    }
    else if (k === '?') { e.stopImmediatePropagation(); SL.keys && SL.keys.toggle(); }
    else if (k === 'i') v.zoomBy(1);
    else if (k === 'o') v.zoomBy(-1);
    else if (k === 'z') v.fitSelection();
    else if (k === 'tab') {
      // only when the mouse gave the 3D view the focus: a keyboard user who tabbed onto it must be able to tab on
      if (e.target !== v.canvas || !v.pointerFocused) handled = false;
      else if (shift) togglePanels();
      else if (window.Sections) Sections.choose('slicer', state.page === 'prepare' ? 'preview' : 'prepare');
    }
    else if (k === 'escape' && q('#sl-cam')) SL.keys.closeCamera();
    else if (!prepare) handled = SL.path && SL.path.key ? SL.path.key(e) : false;
    else if (k === 'delete' || k === 'backspace') removeSelected();
    else if (k === 'a') SL.arrange();
    else if (k === 'q') SL.orient(shift);
    else if (k === 'm') setTool('move');
    else if (k === 'r') setTool('rotate');
    else if (k === 's') setTool('scale');
    else if (k === 'f') setTool('face');
    else if (k === 'u') setTool('measure');
    else if (k === 'escape') { if (state.tool !== 'move') setTool('move'); else { m.selected = new Set(); v.select([]); renderObjects(); renderInspector(); refreshTools(); } }
    else if (k === 'home') v.fitSelection();
    else if (digit !== null && !e.altKey) {
      if (digit >= 1 && digit <= 4) { if (ids.length) m.setTool(ids, digit - 1); else note(`Select a model first, then 1 to 4 chooses its head (T0 to T3).`, 3500); }
      else note('The U1 has four heads, T0 to T3: keys 1 to 4.', 3500);
    }
    else if (move) handled = nudge(...move);
    else if (SL.keys && SL.keys.notBuilt(k)) handled = true;
    else handled = false;
    if (handled) e.preventDefault();
  }

  /* Ctrl K is "Find anything" everywhere else in the app. In the Slicer it clones the selected models, as in Snapmaker Orca, and it keeps finding when
     nothing is selected (the / key and the search box always find). It must run before the app's own handler, so slicer.js binds it first. */
  function onKeyFirst(e) {
    if (document.body.dataset.tab !== 'slicer' || typing(e) || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'k') return;
    if (document.querySelector('#sl-sheet, #sl-engine, #sl-why-card, #sl-keys, dialog[open], .glass-dialog.is-open')) return;
    const m = P();
    if (!m || !m.selected.size || state.page === 'preview') return;
    e.preventDefault(); e.stopImmediatePropagation();
    m.duplicate([...m.selected], 1);
  }

  /* what the camera must leave clear: the dock, the inspector, the toolbar and the bottom row */
  function setInsets() {
    const v = S();
    if (!v) return;
    const stage = SL.root().getBoundingClientRect(), r = id => { const el = q(id); return el && !el.hidden && el.offsetParent !== null ? el.getBoundingClientRect() : null; };
    const dock = r('#sl-dock'), insp = r('#sl-insp');
    const phone = matchMedia('(max-width: 720px)').matches;
    v.insets = phone ? { left: 0, right: 0, top: 0, bottom: 0 } : {
      left: dock ? dock.right - stage.left + 8 : 0,
      right: insp && !q('#sl-insp').classList.contains('is-min') ? stage.right - insp.left + 8 : 0,
      top: 64, bottom: 64 };
    v.applyInsets && v.applyInsets();
  }
  SL.setInsets = setInsets;

  /* ---- the project keeps itself --------------------------------------------------------------------------------------------------------- */
  /* Objects that came from the library are remembered where they stand (their heads, settings and plates too) and put back when the Slicer
     opens again. An object that was only read from a file on this computer has no copy to come back to, so it is left out. */
  const PKEY = 'dejavu1.slicer.project';
  let saveTimer = 0;
  function writeProject() {
    const m = P();
    if (!m) return;
    const rows = m.objects.filter(o => o.sourceName && !o.local).map(o => ({ source: o.sourceName, name: o.name, file: o.file, transform: o.transform, tool: o.tool, settings: o.settings, plate: o.plate, hidden: o.hidden, aside: o.aside }));
    try { store.set(PKEY, JSON.stringify({ v: 1, plates: m.plates, current: m.current, rows })); } catch (_) { /* no storage */ }
  }
  function saveProject() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeProject, 400);
  }
  // A reload or a closed tab right after a change must not lose it, so a waiting save is written the moment the page is left.
  const flushProject = () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; writeProject(); } };
  window.addEventListener('pagehide', flushProject);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushProject(); });
  async function restoreProject() {
    let saved = null;
    try { saved = JSON.parse(store.get(PKEY) || 'null'); } catch (_) { saved = null; }
    if (!saved || saved.v !== 1 || !Array.isArray(saved.rows) || !saved.rows.length || P().objects.length) return 0;
    const m = P();
    let back = 0, lost = 0;
    m.plates = Math.max(1, Math.min(8, saved.plates | 0));
    for (const r of saved.rows) {
      try {
        const res = await fetch(`/api/files/raw?name=${encodeURIComponent(r.source)}`);
        if (!res.ok) { lost++; continue; }
        const mesh = await DV3D.parseModel(await res.arrayBuffer(), r.file || r.source);
        if (!Array.isArray(r.transform) || r.transform.length !== 12) { lost++; continue; }
        m.current = Math.max(0, Math.min(m.plates - 1, r.plate | 0));
        const o = m.add({ name: r.file || r.source, label: r.name, mesh, sourceName: r.source, transform: r.transform, tool: r.tool, settings: r.settings || {} }, { checkpoint: false });
        o.hidden = !!r.hidden; o.aside = !!r.aside; back++;
      } catch (_) { lost++; }
    }
    m.current = Math.max(0, Math.min(m.plates - 1, saved.current | 0));
    m.selected = new Set();
    m.undoStack.length = 0; m.redoStack.length = 0;
    m.changed('plate');
    if (lost) note(`${lost} object${lost > 1 ? 's' : ''} from your last session could not be found in Files and ${lost > 1 ? 'were' : 'was'} left out.`, 7000);
    return back;
  }
  SL.restoreProject = restoreProject;

  SL.prepare = { build, bindScene, bindObjects, saveProject, flushProject, afterChange, renderObjects, renderInspector, renderProblems, renderPlates, renderEmpty, refreshTools, syncScene, onKey, onKeyFirst, setTool, note, toggleOverhang, TOWER_ID };
})();
