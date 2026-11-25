/* The Slicer, part 3b: the list of keys (press ? in the Slicer) and the camera options.
 *
 * The keys follow Snapmaker Orca's own shortcut list, so what a person knows from there works here: the mouse turns, pans and zooms the view
 * the same way, Ctrl 0 to 6 pick the views, 1 to 4 choose a head, A arranges, Q orients, and so on. slicer-prepare.js `onKey` and the scene act
 * on them; this file only says what they are, and keeps the four camera options (zoom to the pointer, swap the buttons, reverse the wheel,
 * orbit speed) that Orca's preferences have. A key Orca has and the Slicer does not (Cut, Boolean, the painting tools) is listed as not built
 * yet, and pressing it says so. */
'use strict';
(() => {
  const { state, ic, q, on, esc, say } = SL;
  const KEY = 'dejavu1.slicer.camera';
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  const CTRL = mac ? '⌘' : 'Ctrl';

  /* [keys, what it does]: a key is one cap, a list of caps pressed together. */
  const GROUPS = [
    { title: 'Mouse', rows: [
      [['Left drag'], 'Turn the view, round the selected model (or all of them)'],
      [[CTRL, 'Left drag'], 'Turn the view round the middle of the screen'],
      [['Right drag'], 'Pan the view (the middle button does too)'],
      [['Wheel'], 'Zoom, towards the pointer'],
      [['Left drag on a model'], 'Move it across the plate'],
      [['Click'], 'Select a model; click the empty plate to select none'],
      [[CTRL, 'Click'], 'Add a model to the selection, or take it out'],
      [['Shift', 'Left drag'], 'Select with a box (Ctrl adds, Alt takes away)'],
      [['Two fingers'], 'Touch: pinch to zoom, drag to pan']] },
    { title: 'View', rows: [
      [[CTRL, '0'], 'Default view'],
      [[CTRL, '1'], 'Top'], [[CTRL, '2'], 'Bottom'], [[CTRL, '3'], 'Front'], [[CTRL, '4'], 'Rear'], [[CTRL, '5'], 'Left'], [[CTRL, '6'], 'Right'],
      [['Z'], 'Fit the view to the selection, or to the plate'],
      [['I'], 'Zoom in'], [['O'], 'Zoom out'],
      [['Tab'], 'Switch between Prepare and Preview'],
      [['Shift', 'Tab'], 'Hide or show the side panels']] },
    { title: 'Models', rows: [
      [['A'], 'Arrange the plate'],
      [['Q'], 'Auto-orient the selection, or every model'],
      [['M'], 'Move'], [['R'], 'Rotate'], [['S'], 'Scale'], [['F'], 'Lay a face on the plate'], [['C'], 'Cut the selection with a plane'], [['U'], 'Measure'],
      [['Arrows'], 'Move the selection 10 mm (Shift 1 mm, Alt 0.1 mm)'],
      [[CTRL, 'Arrows'], 'Move it the way the camera sees it'],
      [['Page up', 'Page down'], 'Raise or lower the selection'],
      [['1', '2', '3', '4'], 'Print the selection with head T0 to T3']] },
    { title: 'Edit', rows: [
      [[CTRL, 'A'], 'Select all'],
      [['Esc'], 'Select none'],
      [['Delete'], 'Delete the selection'],
      [[CTRL, 'D'], 'Delete all'],
      [[CTRL, 'C'], 'Copy'], [[CTRL, 'X'], 'Cut'], [[CTRL, 'V'], 'Paste'], [[CTRL, 'K'], 'Clone the selection (with none selected it is Find)'],
      [[CTRL, 'Z'], 'Undo'], [[CTRL, 'Y'], 'Redo (Ctrl Shift Z does too)'],
      [[CTRL, 'I'], 'Add models']] },
    { title: 'Slice and print', rows: [
      [[CTRL, 'R'], 'Slice the plate'],
      [[CTRL, 'G'], 'Save the G-code'],
      [[CTRL, 'S'], 'Save the plate as a 3MF project'],
      [[CTRL, 'Shift', 'G'], 'Print the plate']] },
    { title: 'Preview', rows: [
      [['Up', 'Down'], 'Move the layer slider'],
      [['Left', 'Right'], 'Move along the layer'],
      [['Shift', 'Arrow'], 'Five times faster (Ctrl does too)'],
      [['Home', 'End'], 'First and last move of the layer'],
      [['L'], 'Show one layer, or a range'],
      [['?'], 'This list']] }
  ];
  const NOT_BUILT = { b: 'Boolean', p: 'Seam painting', h: 'Fuzzy-skin painting', t: 'Text', e: 'Brim ears', y: 'Assemble' };

  const caps = keys => keys.map(k => `<kbd class="sl-kbd">${esc(k)}</kbd>`).join('<span class="sl-kplus" aria-hidden="true">+</span>');

  function close() {
    const c = q('#sl-keys');
    if (c) c.remove();
    document.removeEventListener('keydown', onKeyWhileOpen, true);
    const b = q('#sl-keys-btn');
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  function onKeyWhileOpen(e) {
    if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); close(); }
  }
  function toggleKeys() {
    if (q('#sl-keys')) return close();
    const box = document.createElement('section');
    box.className = 'sl-card sl-keys'; box.id = 'sl-keys'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Keyboard shortcuts');
    box.innerHTML = `<div class="sl-ch"><b>Keyboard and mouse</b><button type="button" class="sl-ix" id="sl-keys-x" aria-label="Close">${ic('x')}</button></div>
      <div class="sl-keys-cols">${GROUPS.map(g => `<section class="sl-keys-g"><h3>${esc(g.title)}</h3><ul>${g.rows.map(([keys, does]) => `<li><span class="sl-keys-do">${esc(does)}</span><span class="sl-keys-k">${caps(keys)}</span></li>`).join('')}</ul></section>`).join('')}</div>
      <p class="sl-hint">The same keys as Snapmaker Orca. Orca's ${Object.values(NOT_BUILT).join(', ')} tools are not in the Slicer yet; their keys say so. If your browser keeps ${CTRL} 0 to 6 for itself, the view buttons at the bottom left do the same.</p>`;
    SL.root().append(box);
    on(q('#sl-keys-x'), 'click', close);
    document.addEventListener('keydown', onKeyWhileOpen, true);
    const b = q('#sl-keys-btn');
    if (b) b.setAttribute('aria-expanded', 'true');
    q('#sl-keys-x').focus();
  }

  /* ---- the four camera options (the ones Snapmaker Orca's preferences have) ---------------------------------------------------------------- */
  const DEFAULTS = { zoomToMouse: true, swap: false, reverse: false, orbit: 1 };
  const prefs = { ...DEFAULTS };
  try {
    const saved = JSON.parse(store.get(KEY) || '{}');
    for (const k of ['zoomToMouse', 'swap', 'reverse']) if (typeof saved[k] === 'boolean') prefs[k] = saved[k];
    if (Number.isFinite(saved.orbit)) prefs.orbit = Math.max(0.25, Math.min(3, saved.orbit));
  } catch (_) { /* a damaged value is the same as none */ }
  const apply = () => { if (state.view) Object.assign(state.view.prefs, prefs); };
  const keep = () => { try { store.set(KEY, JSON.stringify(prefs)); } catch (_) { /* no storage */ } };

  function closeCamera() {
    const c = q('#sl-cam');
    if (c) c.remove();
    document.removeEventListener('pointerdown', awayFromCamera, true);
    const b = q('#sl-cam-btn');
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  function awayFromCamera(e) { if (!e.target.closest('#sl-cam, #sl-cam-btn')) closeCamera(); }
  function toggleCamera() {
    if (q('#sl-cam')) return closeCamera();
    const box = document.createElement('div');
    box.className = 'sl-cam sl-card'; box.id = 'sl-cam'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Camera options');
    const sw = (id, label, checked, hint) => `<label class="sl-switch" title="${esc(hint)}"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span class="sl-sw" aria-hidden="true"></span>${esc(label)}</label>`;
    box.innerHTML = `<div class="sl-ch"><b>Camera</b><button type="button" class="sl-ix" id="sl-cam-x" aria-label="Close">${ic('x')}</button></div>
      ${sw('sl-cam-zoom', 'Zoom to the pointer', prefs.zoomToMouse, 'The wheel zooms towards the pointer instead of the middle of the screen')}
      ${sw('sl-cam-swap', 'Swap turn and pan buttons', prefs.swap, 'The left button pans and the right button turns the view')}
      ${sw('sl-cam-rev', 'Reverse the wheel', prefs.reverse, 'Rolling the wheel forward zooms out')}
      <label class="sl-cam-orbit"><span>Turning speed</span><input type="range" id="sl-cam-orbit" min="0.25" max="3" step="0.05" value="${prefs.orbit}" aria-label="Turning speed"><output id="sl-cam-orbit-o">${prefs.orbit.toFixed(2)}×</output></label>
      <div class="sl-ea"><button type="button" class="sl-btn" id="sl-cam-reset">Back to the usual</button></div>`;
    SL.root().append(box);
    const set = () => { apply(); keep(); };
    on(q('#sl-cam-x'), 'click', closeCamera);
    on(q('#sl-cam-zoom'), 'change', e => { prefs.zoomToMouse = e.target.checked; set(); });
    on(q('#sl-cam-swap'), 'change', e => { prefs.swap = e.target.checked; set(); });
    on(q('#sl-cam-rev'), 'change', e => { prefs.reverse = e.target.checked; set(); });
    on(q('#sl-cam-orbit'), 'input', e => { prefs.orbit = Number(e.target.value); q('#sl-cam-orbit-o').textContent = prefs.orbit.toFixed(2) + '×'; set(); });
    on(q('#sl-cam-reset'), 'click', () => { Object.assign(prefs, DEFAULTS); set(); closeCamera(); toggleCamera(); });
    document.addEventListener('pointerdown', awayFromCamera, true);
    const b = q('#sl-cam-btn');
    if (b) b.setAttribute('aria-expanded', 'true');
  }

  /* what a key does that the Slicer has no tool for yet */
  function notBuilt(key) {
    const name = NOT_BUILT[key];
    if (!name) return false;
    say(`${name} is not in the Slicer yet.`, 'info');
    return true;
  }

  SL.keys = { toggle: toggleKeys, close, toggleCamera, closeCamera, apply, prefs, notBuilt, GROUPS };
})();
