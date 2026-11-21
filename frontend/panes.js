/* panes.js: the building blocks the working screens share: moving a card into a pane without losing its switch, the divider between
 * two panes, and keeping the one 3D twin docked where it is shown.
 *
 * A screen made of panes (Settings, Models, Files) is a grid of panes; the Printer screen and Overview are built from tiles and sheets
 * (cockpit.js, overview.js, deck.js). Moving a node keeps its id, its listeners and what draws into it, so nothing that reads a card by id
 * changes. A card that sat inside a wrapper carrying data-module-body keeps that switch (it is copied onto the card), so a screen whose
 * module is off still hides it. The twin is one shared instance: its card is docked into the stage of the Printer screen, and a sheet
 * that needs it borrows it and hands it back.
 *
 * A divider is a W3C window splitter: role="separator" with aria-orientation and aria-valuenow, min and max; the arrow keys move it
 * 12 px (48 px with Shift), Home and End go to the limits, and Enter collapses the pane it sizes and restores it. Mouse and touch
 * drag it, one move per display frame; whatever follows the pane's size is told once, when it is let go. Sizes are kept in this browser (dejavu1.layout.*) and Panes.reset() puts the defaults back (Settings › Look and layout).
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
    // The twin and the camera follow their pane, but a resize on every pointer move made dragging rough: while a divider is being dragged nothing
    // is told (the 3D picture keeps its shape, centred, while the pane moves: see html.is-resizing in cockpit.css), and once it is let go the
    // twin and the camera are told at once and draw one frame at the new size.
    const announce = now => { if (now) window.dispatchEvent(new Event('resize')); };
    function set(v, remember, live) {
      v = Math.round(Math.max(0, Math.min(limit(), v)));
      host.style.setProperty(prop, `${v}px`);
      el.setAttribute('aria-valuenow', String(v));
      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', String(Math.round(limit())));
      el.dataset.collapsed = v === 0 ? 'true' : 'false';
      if (remember) store.set(KEY + name, String(v));
      announce(!live);
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
      let raf = 0, latest = from;
      const move = ev => {
        latest = from + sign * ((axis === 'y' ? ev.clientY : ev.clientX) - start) * (axis === 'y' ? -1 : 1);
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; set(latest, false, true); });     // once per frame, whatever the mouse sends
      };
      const up = () => {
        cancelAnimationFrame(raf);
        raf = 0;
        el.releasePointerCapture(e.pointerId);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        el.classList.remove('dragging');
        document.documentElement.classList.remove('is-resizing');
        set(latest, true);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    el.addEventListener('dblclick', () => set(def, true));
    splitters.push({ el, set, def, name });
    return el;
  }

  /* The twin lives in the stage of the Printer screen (cockpit.js). A sheet that borrowed it keeps it until the sheet closes. */
  function dock() {
    const card = $('twin-card');
    const slot = $('p-stage');
    if (!card || !slot) return;
    if (card.parentElement !== slot && !card.closest('.cp-sheet')) {
      slot.prepend(card);
      window.dispatchEvent(new Event('resize'));
    }
    card.dataset.stage = 'printer';
  }

  function reset() {
    Object.keys(localStorage).filter(k => k.startsWith(KEY)).forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* private window */ } });
    if (window.Deck) Deck.closeAll();
    splitters.forEach(s => s.set(s.def, false));
  }

  /* A region that scrolls must be reachable from the keyboard (WCAG 2.1.1): the screens and the panes take a tab stop. */
  function scrollers() {
    document.querySelectorAll('.wrap > .tab-panel, .pane, .tm-scroll').forEach(el => {
      if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
      if (el.classList.contains('tab-panel') && !el.hasAttribute('aria-label')) {
        el.setAttribute('role', 'region');
        el.setAttribute('aria-label', (typeof TAB_NAMES !== 'undefined' && TAB_NAMES[el.id.replace(/^tab-/, '')]) || 'Screen');
      }
    });
  }

  const unfold = el => (window.Deck ? Deck.unfold(el) : false);
  const expandTwin = on => { if (window.Cockpit) { if (on) Cockpit.open('twin'); else Cockpit.close(); } };

  function init() {
    scrollers();
    setTimeout(scrollers, 1500);               // panes that settings.js and others add after the page loads
    dock();
    window.addEventListener('dv-tab', () => { dock(); scrollers(); });
  }
  window.Panes = { reset, dock, put, splitter, unfold, expandTwin, layoutKeys: () => splitters.map(s => s.name) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
