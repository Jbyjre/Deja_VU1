/* The Slicer, part 1 of 5: the shared namespace `SL`, its state, the icons and the small helpers every other part uses.
 *
 * Parts, in load order: slicer-ui.js (this), slicer-prepare.js (the Prepare page: toolbar, objects, inspector, problems, plates, files),
 * slicer-settings.js (printer, heads and process in the dock, and the settings sheet), slicer-preview.js (slicing, the Preview page,
 * printing), slicer.js (starts it all when the screen opens). The scene is slicer-scene.js and the plate model slicer-model.js. */
'use strict';
window.SL = (() => {
  /* Icons: drawn here, 24 px grid, strokes only, so they take the text colour and every look. */
  const ICONS = {
    add: 'M12 3 4.5 7v9L12 20l7.5-4V7zM4.5 7 12 11l7.5-4M12 11v9',
    plus: 'M12 5v14M5 12h14',
    trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5',
    arrange: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
    orient: 'M12 3v9M8.5 8.5 12 12l3.5-3.5M4 15c0 2.5 3.6 4.5 8 4.5s8-2 8-4.5',
    move: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
    rotate: 'M20 11a8 8 0 1 0-2.4 5.7M20 4v7h-7',
    scale: 'M4 20 20 4M14 4h6v6M10 20H4v-6',
    face: 'M5 5h14v9H5zM3 18h18M6 21h12',
    split: 'M3 4h8v8H3zM13 12h8v8h-8zM11 8h3a2 2 0 0 1 2 2v2',
    cut: 'M3 14l9 5 9-5M3 14l9-5 9 5M6 12V6l6-3 6 3v6',
    measure: 'M3 17 17 3l4 4L7 21zM8 12l2 2M11 9l2 2M14 6l2 2',
    undo: 'M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 12h-2',
    redo: 'M15 7l5 5-5 5M20 12H10a6 6 0 0 0 0 12h2',
    cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12 4 7.5',
    fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
    overhang: 'M4 20h16M6 20V6l12 14zM9 15h4',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    eyeoff: 'M3 3l18 18M10.6 6.2A9.6 9.6 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.4 7.6A17 17 0 0 0 2 12s4 7 10 7a9.5 9.5 0 0 0 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2',
    sliders: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6',
    refresh: 'M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4',
    play: 'M7 5l12 7-12 7z',
    pause: 'M8 5v14M16 5v14',
    download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
    printer: 'M7 8V4h10v4M6 17H4v-7h16v7h-2M7 14h10v6H7z',
    check: 'M5 12.5l4.5 4.5L19 7',
    x: 'M6 6l12 12M18 6 6 18',
    warn: 'M12 4 3 20h18zM12 10v4.5M12 17v.5',
    copy: 'M8 8h11v11H8zM5 16V5h11',
    layers: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5',
    down: 'M6 9l6 6 6-6',
    right: 'M9 6l6 6-6 6',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l5 5',
    aside: 'M4 5h10v10H4zM14 9h6v10h-6zM9 19h5',
    lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
    unlock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 5.6-1.5',
    reset: 'M4 12a8 8 0 1 1 3 6.2M4 19v-5h5',
    save: 'M5 4h12l3 3v13H5zM8 4v6h8V4M8 20v-6h8v6',
    folder: 'M3 6h6l2 2h10v11H3z',
    back: 'M15 6l-6 6 6 6',
    info: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 11v5M12 8v.5',
    spool: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    tower: 'M9 21l1.5-15h3L15 21M8 21h8M10 9h4M9.6 13h4.8',
    send: 'M4 12l16-8-6 16-3-7z',
    queue: 'M4 6h16M4 12h16M4 18h10',
    ruler: 'M3 8h18v8H3zM7 8v3M11 8v4M15 8v3M19 8v4'
  };
  const ic = (name, cls = '') => `<svg class="sl-ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${ICONS[name] || ''}"/></svg>`;

  const state = {
    model: null, view: null, ready: false, page: 'prepare', tool: 'move', overhang: false,
    engine: null, slicer: null, catalog: null, schema: null,
    heads: [], printer: null,
    preset: { machine: null, process: null, filaments: [] }, overrides: {}, speed: 100, layerMode: 'shared', headHeights: [0, 0, 0, 0],
    slice: { state: 'idle', job: null, result: null, stale: false, error: null, cause: null },
    problems: [], recent: [],
    measure: null
  };

  const root = () => document.getElementById('sl-root');
  const q = (sel, scope) => (scope || root()).querySelector(sel);
  const qa = (sel, scope) => [...(scope || root()).querySelectorAll(sel)];
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);
  const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') : '–');
  const mm = n => fmt(n, 1) + ' mm';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const hexRGB = (hex, fallback = [0.78, 0.8, 0.84]) => {
    const m = /^#?([0-9a-f]{6})/i.exec(hex || '');
    if (!m) return fallback;
    const v = parseInt(m[1], 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
  };
  const timeWords = hours => {
    if (!(hours > 0)) return '–';
    const m = Math.round(hours * 60), h = Math.floor(m / 60);
    return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
  };
  const say = (text, kind = 'info') => { try { toast(text, kind === 'bad' ? 'warn' : kind); } catch (_) { /* no toast yet */ } };
  const demo = () => typeof tourOn === 'function' && tourOn();

  /* A press on a button that runs a promise: the button says what is happening and cannot be pressed twice. */
  async function busy(btn, words, fn) {
    if (btn.disabled) return;
    const was = btn.innerHTML;
    btn.disabled = true;
    if (words) btn.textContent = words;
    try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = was; }
  }

  /* The four heads' colour for an object assigned to head i. */
  const headColour = i => hexRGB((state.heads[i] || {}).hex, [[0.95, 0.52, 0.2], [0.3, 0.6, 0.95], [0.35, 0.75, 0.45], [0.88, 0.32, 0.4]][i % 4]);

  return { ICONS, ic, state, root, q, qa, on, fmt, mm, clamp, hexRGB, timeWords, say, demo, busy, headColour, esc: s => esc(String(s ?? '')) };
})();
