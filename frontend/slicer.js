/* The Slicer, part 5 of 5: starts it all when the screen opens, creates the 3D scene once, and follows the parts (Prepare, Preview), the
 * theme and the size of the window. Everything else is in slicer-ui.js, slicer-prepare.js, slicer-settings.js and slicer-preview.js. */
'use strict';
(() => {
  const { state, q, on } = SL;
  let built = false, observer = null;

  /* the app's accent colour as RGB, converted by the browser */
  function cssRGB(token, fallback) {
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    try { ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback; } catch (_) { ctx.fillStyle = fallback; }
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255];
  }

  function createScene() {
    const canvas = document.getElementById('sl-canvas');
    try { state.view = new SliceScene.SliceScene(canvas); } catch (e) {
      document.getElementById('sl-stage').innerHTML = `<p class="sl-nogl">The 3D view needs WebGL, and this browser did not give it (${SL.esc(e.message)}). Try another browser or turn on hardware acceleration.</p>`;
      return;
    }
    const v = state.view;
    v.accent = cssRGB('--accent', '#4a8fff');
    window.addEventListener('dv-theme', () => { v.accent = cssRGB('--accent', '#4a8fff'); v.draw(); });
    window.addEventListener('dv-ui', () => { v.accent = cssRGB('--accent', '#4a8fff'); v.draw(); });
    SL.prepare.bindScene();
    observer = new ResizeObserver(() => { SL.setInsets(); });
    observer.observe(SL.root());
    for (const id of ['#sl-dock', '#sl-insp']) { const el = q(id); if (el) observer.observe(el); }
    v.setMode(state.page === 'preview' ? 'preview' : 'prepare');
  }

  function ensure() {
    if (built) return;
    built = true;
    state.model = new SlicerModel.PlateModel({ onChange: (kind, ids) => SL.prepare.afterChange(kind, ids) });
    SL.root().insertAdjacentHTML('beforeend', '<div class="sl-go" id="sl-go"></div>');
    SL.prepare.build();
    SL.prepare.bindObjects();
    if (SL.settings) SL.settings.build();
    if (SL.preview) SL.preview.build();
    createScene();
    SL.prepare.afterChange('init', []);
    SL.restoreProject && SL.restoreProject().then(n => { if (n && state.view) state.view.fitAll(); });
    window.dispatchEvent(new CustomEvent('dv-slicer-ready'));
  }

  function onShow() {
    ensure();
    state.page = (window.Sections && Sections.current('slicer')) || 'prepare';
    if (state.view) { state.view.setMode(state.page === 'preview' ? 'preview' : 'prepare'); requestAnimationFrame(() => { SL.setInsets(); state.view.fitPlate(false); state.view.draw(); }); }
    SL.loadRecent && SL.loadRecent();
    SL.settings && SL.settings.refresh && SL.settings.refresh();
    SL.prepare.renderEmpty();
  }

  function onPart(key) {
    state.page = key === 'preview' ? 'preview' : 'prepare';
    if (!built) return;
    if (SL.sheet) SL.sheet.close();
    if (SL.settings) SL.settings.closeEngine();
    const why = q('#sl-why-card'); if (why) why.remove();
    if (state.view) state.view.setMode(state.page);
    SL.prepare.renderEmpty();
    if (SL.preview && SL.preview.onPage) SL.preview.onPage(state.page);
    requestAnimationFrame(SL.setInsets);
  }

  window.addEventListener('dv-tab', e => { if (e.detail && e.detail.tab === 'slicer') onShow(); });
  window.addEventListener('dv-section', e => { if (e.detail && e.detail.tab === 'slicer') onPart(e.detail.key); });
  document.addEventListener('keydown', e => { if (built) SL.prepare.onKey(e); });
  // A model opened from Files lands on the plate (Files calls Slicer.open).
  window.Slicer = {
    ensure,
    /* open a library file on the plate and show the Slicer */
    async open(name) {
      if (typeof showTab === 'function') showTab('slicer');
      if (window.Sections) Sections.choose('slicer', 'prepare');
      ensure();
      await SL.openFromLibrary(name);
    },
    /* a file that was read only in this browser (Files keeps it as a File) */
    async openLocal(file) {
      if (typeof showTab === 'function') showTab('slicer');
      if (window.Sections) Sections.choose('slicer', 'prepare');
      ensure();
      await SL.addFiles([file]);
    },
    get state() { return state; }
  };
  void on;
})();
