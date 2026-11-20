/* panes.js: docked panes and the dividers between them (the SHELL building blocks "Pane", "Divider" and "Stage").
 *
 * A screen that is one connected surface is a grid of panes. This file builds that grid for Overview (the printer in 3D with
 * its readings, and a side pane) and for the Printer screen's Control part (a left pane of heads, bed and tuning; the twin in the
 * middle with the console under it; a right pane of the camera and the move pad), by moving the cards that already exist into
 * panes. Moving a node keeps its id, its listeners and what draws into it, so nothing that reads a card by id changes. A card
 * that sat inside a wrapper carrying data-module-body keeps that switch (it is copied onto the card), so a screen whose module is
 * off still hides it. The twin is one shared instance: its card is docked into the stage of whichever of Overview and Printer is
 * open, so there is never a second copy to draw.
 *
 * A divider is a W3C window splitter: role="separator" with aria-orientation and aria-valuenow, min and max; the arrow keys move it
 * 12 px (48 px with Shift), Home and End go to the limits, and Enter collapses the pane it sizes and restores it. Mouse and touch
 * drag it. Sizes are kept in this browser (dejavu1.layout.*) and Panes.reset() puts the defaults back (Settings › Look and layout).
 * On a phone the dividers go and the panes stack under the stage.
 */
(() => {
  const $ = id => document.getElementById(id);
  const KEY = 'dejavu1.layout.';
  const PHONE = window.matchMedia('(max-width: 720px)');
  const read = (name, fallback) => { const v = parseFloat(store.get(KEY + name)); return Number.isFinite(v) ? v : fallback; };
  const splitters = [];

  /* Moves a card into a pane without losing the switch its wrapper carried. */
  function put(id, into) {
    const el = $(id);
    if (!el || !into) return;
    const wrap = el.closest('[data-module-body]');
    if (wrap && wrap !== el && !el.dataset.moduleBody) el.dataset.moduleBody = wrap.dataset.moduleBody;
    into.append(el);
  }
  function pane(cls, label) {
    const el = document.createElement('div');
    el.className = `pane ${cls}`;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', label);
    return el;
  }

  /* ---- the divider ---- */
  // opts: { host, vars, prop, axis: 'x'|'y', sign: 1 when dragging towards the end grows the pane, label, min, max, def, name, grid }
  function splitter(opts) {
    const { host, prop, axis, sign, label, min, max, def, name } = opts;
    const el = document.createElement('div');
    el.className = `split ${axis === 'y' ? 'h' : 'v'} ${opts.cls || ''}`.trim();
    el.setAttribute('role', 'separator');
    el.setAttribute('aria-orientation', axis === 'y' ? 'horizontal' : 'vertical');
    el.setAttribute('aria-label', label);
    el.tabIndex = 0;
    let before = null;                       // the size before a collapse
    const limit = () => {
      const room = (axis === 'y' ? host.clientHeight : host.clientWidth) - (opts.keep || 320);
      return Math.max(min, Math.min(max, room));
    };
    const get = () => { const v = parseFloat(host.style.getPropertyValue(prop)); return Number.isFinite(v) ? v : def; };
    function set(v, remember) {
      v = Math.round(Math.max(0, Math.min(limit(), v)));
      host.style.setProperty(prop, `${v}px`);
      el.setAttribute('aria-valuenow', String(v));
      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', String(Math.round(limit())));
      el.dataset.collapsed = v === 0 ? 'true' : 'false';
      if (remember) store.set(KEY + name, String(v));
      window.dispatchEvent(new Event('resize'));          // the twin and the camera follow their pane
    }
    // The host is not on the page yet, so it has no size to limit by: the saved or default size goes in as it is.
    const first = Math.max(0, Math.min(max, read(name, def)));
    host.style.setProperty(prop, `${first}px`);
    el.setAttribute('aria-valuenow', String(first));
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', String(max));
    el.dataset.collapsed = first === 0 ? 'true' : 'false';
    el.addEventListener('keydown', e => {
      const step = e.shiftKey ? 48 : 12;
      const grow = axis === 'y' ? 'ArrowUp' : (sign > 0 ? 'ArrowRight' : 'ArrowLeft');
      const shrink = axis === 'y' ? 'ArrowDown' : (sign > 0 ? 'ArrowLeft' : 'ArrowRight');
      if (e.key === grow) set(get() + step, true);
      else if (e.key === shrink) set(get() - step, true);
      else if (e.key === 'Home') set(min, true);
      else if (e.key === 'End') set(limit(), true);
      else if (e.key === 'Enter') { if (get() > 0) { before = get(); set(0, true); } else set(before || def, true); }
      else return;
      e.preventDefault();
    });
    el.addEventListener('pointerdown', e => {
      if (e.button || PHONE.matches) return;
      e.preventDefault();
      const start = axis === 'y' ? e.clientY : e.clientX;
      const from = get();
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      document.documentElement.classList.add('is-resizing');
      const move = ev => set(from + sign * ((axis === 'y' ? ev.clientY : ev.clientX) - start) * (axis === 'y' ? -1 : 1), false);
      const up = () => {
        el.releasePointerCapture(e.pointerId);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        el.classList.remove('dragging');
        document.documentElement.classList.remove('is-resizing');
        set(get(), true);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    el.addEventListener('dblclick', () => set(def, true));
    splitters.push({ el, set, def, name });
    return el;
  }

  /* ---- Overview: the printer in 3D, its readings under it, and a side pane ---- */
  function buildOverview() {
    const panel = $('tab-overview');
    if (!panel || panel.dataset.panes) return;
    panel.dataset.panes = '1';
    const grid = document.createElement('div');
    grid.className = 'panes ov-panes';
    grid.id = 'ov-panes';
    const main = pane('ov-main', 'The selected printer');
    const stage = document.createElement('div');
    stage.className = 'stage';
    stage.id = 'ov-stage';
    stage.setAttribute('aria-label', 'The selected printer in 3D');
    main.append(stage);
    const side = pane('ov-side', 'Needs you, printers and totals');
    const divider = splitter({ host: grid, prop: '--side', axis: 'x', sign: -1, label: 'Resize the side pane', min: 260, max: 560, def: 360, name: 'overview.side', keep: 420 });
    grid.append(main, divider, side);
    panel.prepend(grid);
    // The readings under the stage; the rest of Overview goes in the side pane, most urgent first.
    put('ov-now', main);
    ['attention', 'ov-printers', 'ov-camera', 'ov-temps', 'ov-quick', 'ov-upkeep'].forEach(id => put(id, side));
    const stats = panel.querySelector(':scope > .stats');
    if (stats) side.append(stats);
    const pair = panel.querySelector(':scope > .pair-card');
    if (pair) side.append(pair);
    panel.querySelectorAll(':scope > .ov-grid').forEach(g => { if (!g.children.length) g.remove(); });
  }

  /* ---- Printer › Control: the cockpit ---- */
  function buildCockpit() {
    const panel = $('tab-control');
    if (!panel || panel.dataset.panes) return;
    panel.dataset.panes = '1';
    const grid = document.createElement('div');
    grid.className = 'panes cockpit';
    grid.id = 'cockpit';
    const left = pane('p-left', 'Heads, bed and tuning');
    const stage = document.createElement('div');
    stage.className = 'stage';
    stage.id = 'p-stage';
    stage.setAttribute('aria-label', 'The printer in 3D');
    const bottom = pane('p-bottom', 'Console');
    const right = pane('p-right', 'Camera, move and files');
    const v1 = splitter({ host: grid, prop: '--left', axis: 'x', sign: 1, label: 'Resize the heads and bed pane', min: 220, max: 480, def: 300, name: 'printer.left', cls: 'v1', keep: 560 });
    const v2 = splitter({ host: grid, prop: '--right', axis: 'x', sign: -1, label: 'Resize the camera and move pane', min: 240, max: 520, def: 330, name: 'printer.right', cls: 'v2', keep: 560 });
    const h = splitter({ host: grid, prop: '--bottom', axis: 'y', sign: 1, label: 'Resize the console', min: 90, max: 420, def: 170, name: 'printer.bottom', cls: 'h', keep: 360 });
    grid.append(left, v1, stage, v2, right, h, bottom);
    const head = $('pp-head');
    if (head) head.after(grid); else panel.prepend(grid);
    ['pp-heaters', 'pp-extrude', 'pp-tune', 'pp-outputs'].forEach(id => put(id, left));
    ['pp-camera-card', 'pp-move', 'pp-macros', 'pp-mesh', 'pp-print', 'ctrl-plate'].forEach(id => put(id, right));
    put('pp-console', bottom);
    const side = panel.querySelector('.pp-side');
    if (side && !side.children.length) side.remove();
    const old = panel.querySelector('.pp-stage');
    if (old && !old.querySelector('.card')) old.remove();
    dock();
  }

  /* The twin lives in the stage of the place that is open. */
  function dock() {
    const card = $('twin-card');
    if (!card) return;
    const tab = document.body.dataset.tab;
    const slot = tab === 'overview' ? $('ov-stage') : tab === 'control' ? $('p-stage') : null;
    if (slot && card.parentElement !== slot) {
      slot.prepend(card);
      window.dispatchEvent(new Event('resize'));
    }
    card.dataset.stage = tab === 'overview' ? 'overview' : 'printer';
  }

  function reset() {
    Object.keys(localStorage).filter(k => k.startsWith(KEY)).forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* private window */ } });
    splitters.forEach(s => s.set(s.def, false));
  }

  /* A region that scrolls must be reachable from the keyboard (WCAG 2.1.1): the screens and the panes take a tab stop. */
  function scrollers() {
    document.querySelectorAll('.wrap > .tab-panel, .pane').forEach(el => {
      if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
      if (el.classList.contains('tab-panel') && !el.hasAttribute('aria-label')) {
        el.setAttribute('role', 'region');
        el.setAttribute('aria-label', (typeof TAB_NAMES !== 'undefined' && TAB_NAMES[el.id.replace(/^tab-/, '')]) || 'Screen');
      }
    });
  }

  function init() {
    buildOverview();
    scrollers();
    setTimeout(scrollers, 1500);               // panes that settings.js and others add after the page loads
    buildCockpit();
    dock();
    window.addEventListener('dv-tab', dock);
  }
  window.Panes = { reset, dock, put, splitter, layoutKeys: () => splitters.map(s => s.name) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
