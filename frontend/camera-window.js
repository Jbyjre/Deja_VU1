/* One camera window you control (FLOW.3).
 *
 * Every camera view in the app (the Printer page, Overview, the Printer room's tile) has a "pop out" button. It opens
 * this one floating window with the same live picture: drag it by its title bar (or move it with the arrow keys), drag
 * its corner to resize it, zoom in with the buttons, the mouse wheel or two fingers and drag the picture to look around,
 * pin it so it stays over every screen (the Slicer included), show it full screen, or save a picture. While it is open
 * the other camera views wait, so the printer's camera sends one picture stream, not two.
 *
 * The picture comes from printer-page.js (attachCam), so the window shows the same thing the Printer page would: the
 * camera address you saved, WebRTC, the printer's own camera or single pictures, and says in words when the printer
 * stops answering. Where and how big it is, the zoom and the pin are remembered in this browser.
 */
'use strict';
window.CameraWindow = (() => {
  const KEY = 'dejavu1.camwin';
  const MIN_W = 240, MIN_H = 170, ZOOM_MAX = 6, EDGE = 8;
  let win = null, cam = null, open = false, openedOn = '';
  let zoom = 1, panX = 0, panY = 0, fleet = [];

  const read = () => { try { return JSON.parse(store.get(KEY) || '{}') || {}; } catch (_) { return {}; } };
  const remember = patch => store.set(KEY, JSON.stringify({ ...read(), ...patch }));
  const screenNow = () => document.body.dataset.tab || '';
  const isOpen = () => open;

  const ICON = {
    snap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  };

  /* ---- where it sits -------------------------------------------------------------------------------------------- */
  // The top of whatever the app keeps fixed along the bottom of a phone screen (the tab bar, the print bar), so the
  // window opens above it instead of over its buttons.
  function bottomBars() {
    const vw = window.innerWidth, vh = window.innerHeight;
    let top = vh;
    for (const y of [vh - 6, vh - 70, vh - 140]) {
      for (const el of document.elementsFromPoint(vw / 2, y)) {
        for (let n = el; n && n !== document.body; n = n.parentElement) {
          if (n === win) break;
          const pos = getComputedStyle(n).position;
          if (pos !== 'fixed' && pos !== 'sticky') continue;
          const r = n.getBoundingClientRect();
          if (r.bottom >= vh - 40 && r.height < vh / 2 && r.width > vw / 2) top = Math.min(top, r.top);
          break;
        }
      }
    }
    return top;
  }
  function defaultBox() {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (vw < 600) {
      const w = vw - EDGE * 2, h = Math.round(w * 0.62) + 44;
      return { w, h, x: EDGE, y: Math.max(EDGE, bottomBars() - h - EDGE) };
    }
    const w = Math.min(420, Math.round(vw * 0.32)), h = Math.round(w * 0.625) + 44;
    return { w, h, x: vw - w - 20, y: vh - h - 20 };
  }
  function clampBox(b) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.max(MIN_W, Math.min(b.w, vw - EDGE * 2)), h = Math.max(MIN_H, Math.min(b.h, vh - EDGE * 2));
    return { w, h, x: Math.max(EDGE, Math.min(b.x, vw - w - EDGE)), y: Math.max(EDGE, Math.min(b.y, vh - h - EDGE)) };
  }
  function place(box, keep = true) {
    const b = clampBox(box);
    Object.assign(win.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
    if (keep) remember({ box: b });
    return b;
  }
  const boxNow = () => { const r = win.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };

  /* ---- zoom and looking around ---------------------------------------------------------------------------------- */
  function frame() { return win && win.querySelector('.pcam-frame'); }
  function applyZoom() {
    const f = frame();
    if (!f) return;
    const r = f.getBoundingClientRect(), maxX = (zoom - 1) * r.width / 2, maxY = (zoom - 1) * r.height / 2;
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
    f.style.setProperty('--cw-zoom', zoom.toFixed(3));
    f.style.setProperty('--cw-x', `${panX.toFixed(1)}px`);
    f.style.setProperty('--cw-y', `${panY.toFixed(1)}px`);
    f.classList.toggle('cw-zoomed', zoom > 1.001);
    setText(win.querySelector('[data-cw="fit"]'), `${Math.round(zoom * 100)}%`);
    win.querySelector('[data-cw="out"]').disabled = zoom <= 1.001;
    win.querySelector('[data-cw="in"]').disabled = zoom >= ZOOM_MAX - 0.001;
    remember({ zoom });
  }
  // Zoom toward a point (in the frame's own pixels from its centre), so what is under the pointer stays under it.
  function zoomTo(next, cx = 0, cy = 0) {
    next = Math.max(1, Math.min(ZOOM_MAX, next));
    const k = next / zoom;
    panX = cx - (cx - panX) * k;
    panY = cy - (cy - panY) * k;
    zoom = next;
    applyZoom();
  }
  function fromCentre(f, x, y) { const r = f.getBoundingClientRect(); return [x - r.left - r.width / 2, y - r.top - r.height / 2]; }

  function wireZoom() {
    const f = frame();
    f.addEventListener('wheel', e => {
      e.preventDefault();
      const [cx, cy] = fromCentre(f, e.clientX, e.clientY);
      zoomTo(zoom * Math.exp(-e.deltaY * 0.0015), cx, cy);
    }, { passive: false });
    f.addEventListener('dblclick', e => {
      if (e.target.closest('button')) return;
      if (zoom > 1.001) { zoom = 1; panX = panY = 0; applyZoom(); return; }
      const [cx, cy] = fromCentre(f, e.clientX, e.clientY);
      zoomTo(2.5, cx, cy);
    });
    const points = new Map();
    let start = null;
    f.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      points.set(e.pointerId, [e.clientX, e.clientY]);
      f.setPointerCapture(e.pointerId);
      start = { zoom, panX, panY, points: new Map(points) };
    });
    f.addEventListener('pointermove', e => {
      if (!points.has(e.pointerId) || !start) return;
      points.set(e.pointerId, [e.clientX, e.clientY]);
      if (points.size === 2 && start.points.size === 2) {         // two fingers: pinch to zoom
        const [a0, b0] = [...start.points.values()], [a1, b1] = [...points.values()];
        const d0 = Math.hypot(a0[0] - b0[0], a0[1] - b0[1]) || 1, d1 = Math.hypot(a1[0] - b1[0], a1[1] - b1[1]);
        const [cx, cy] = fromCentre(f, (a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2);
        zoom = start.zoom; panX = start.panX; panY = start.panY;
        zoomTo(start.zoom * d1 / d0, cx, cy);
      } else if (points.size === 1 && zoom > 1.001) {             // one finger or the mouse: look around
        const [x0, y0] = start.points.get(e.pointerId) || [e.clientX, e.clientY];
        panX = start.panX + e.clientX - x0;
        panY = start.panY + e.clientY - y0;
        applyZoom();
      }
    });
    const lift = e => { points.delete(e.pointerId); start = points.size ? { zoom, panX, panY, points: new Map(points) } : null; };
    f.addEventListener('pointerup', lift);
    f.addEventListener('pointercancel', lift);
  }

  /* ---- moving and resizing -------------------------------------------------------------------------------------- */
  function drag(handle, onMove) {
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0 || (e.target !== handle && e.target.closest('button') && e.target.closest('button') !== handle)) return;
      e.preventDefault();
      const from = boxNow(), x0 = e.clientX, y0 = e.clientY;
      handle.setPointerCapture(e.pointerId);
      win.classList.add('cw-moving');
      const move = ev => { place(onMove(from, ev.clientX - x0, ev.clientY - y0), false); applyZoom(); };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        win.classList.remove('cw-moving');
        place(boxNow());
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }
  function keyMove(e) {
    const step = e.shiftKey ? 60 : 20, b = boxNow();
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!moves[e.key]) return;
    e.preventDefault();
    if (e.altKey) place({ ...b, w: b.w + moves[e.key][0], h: b.h + moves[e.key][1] });   // Alt + arrows: resize
    else place({ ...b, x: b.x + moves[e.key][0], y: b.y + moves[e.key][1] });
    applyZoom();
  }

  /* ---- the buttons ---------------------------------------------------------------------------------------------- */
  function setPin(on) {
    const b = win.querySelector('[data-cw="pin"]');
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? 'Pinned: it stays over every screen. Press to unpin.' : 'Pin it over every screen, the Slicer included';
    win.classList.toggle('cw-pinned', on);
    remember({ pin: on });
  }
  const pinned = () => win && win.querySelector('[data-cw="pin"]').getAttribute('aria-pressed') === 'true';

  async function snapshot(button) {
    const stamp = new Date(), two = n => String(n).padStart(2, '0');
    const name = `camera-${stamp.getFullYear()}-${two(stamp.getMonth() + 1)}-${two(stamp.getDate())}-${two(stamp.getHours())}${two(stamp.getMinutes())}${two(stamp.getSeconds())}`;
    button.disabled = true;
    let blob = null, ext = 'png';
    const media = [...win.querySelectorAll('.pcam-video, .pcam-img')].find(m => !m.hidden && (m.videoWidth || m.naturalWidth));
    if (media) {
      try {
        const c = document.createElement('canvas');
        c.width = media.videoWidth || media.naturalWidth;
        c.height = media.videoHeight || media.naturalHeight;
        c.getContext('2d').drawImage(media, 0, 0, c.width, c.height);
        blob = await new Promise(done => c.toBlob(done, 'image/png'));
      } catch (_) { blob = null; }                               // a picture from another address can't be copied
    }
    if (!blob) {
      try {
        const r = await fetch(api(`/api/camera/snapshot?t=${Date.now()}`));
        const type = r.headers.get('Content-Type') || '';
        if (r.ok && !type.includes('json')) { blob = await r.blob(); ext = type.includes('svg') ? 'svg' : type.includes('png') ? 'png' : 'jpg'; }
      } catch (_) { blob = null; }
    }
    button.disabled = false;
    if (!blob) { toast('No picture to save yet: the camera isn’t showing anything.', 'warn'); return; }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = `${name}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Camera picture saved to your downloads', 'ok');
  }
  function fullScreen() {
    const f = frame();
    if (document.fullscreenElement) { document.exitFullscreen?.().catch?.(() => {}); return; }
    const request = f.requestFullscreen?.();
    if (request && request.catch) request.catch(() => toast('This browser didn’t allow full screen here.', 'warn'));
  }

  /* ---- building it once ----------------------------------------------------------------------------------------- */
  function build() {
    win = document.createElement('section');
    win.className = 'camwin';
    win.id = 'camwin';
    win.hidden = true;
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-label', 'Camera window');
    win.innerHTML = `<div class="camwin-bar">
        <button type="button" class="camwin-grip" title="Drag to move. Arrow keys move it, Alt and the arrow keys resize it.">
          <span class="camwin-title">Camera</span><span class="camwin-where"></span></button>
        <div class="camwin-tools">
          <button type="button" data-cw="out" aria-label="Zoom out" title="Zoom out">−</button>
          <button type="button" data-cw="fit" aria-label="Fit the whole picture" title="Fit the whole picture (or double-click it)">100%</button>
          <button type="button" data-cw="in" aria-label="Zoom in" title="Zoom in (or use the mouse wheel or two fingers)">+</button>
          <button type="button" data-cw="pin" aria-pressed="false" aria-label="Pin over every screen">${ICON.pin}</button>
          <button type="button" data-cw="snap" aria-label="Save a picture" title="Save a picture">${ICON.snap}</button>
          <button type="button" data-cw="full" aria-label="Full screen" title="Full screen">${ICON.full}</button>
          <button type="button" data-cw="close" aria-label="Close the camera window" title="Close (the other camera views come back)">${ICON.close}</button>
        </div>
      </div>
      <div class="pcam camwin-cam" data-cam="window"></div>
      <div class="camwin-size" aria-hidden="true" title="Drag to resize"></div>`;
    document.body.appendChild(win);
    win.addEventListener('click', e => {
      const b = e.target.closest('[data-cw]');
      if (!b) return;
      const act = b.dataset.cw;
      if (act === 'in') zoomTo(zoom * 1.4);
      else if (act === 'out') zoomTo(zoom / 1.4);
      else if (act === 'fit') { zoom = 1; panX = panY = 0; applyZoom(); }
      else if (act === 'pin') setPin(!pinned());
      else if (act === 'snap') snapshot(b);
      else if (act === 'full') fullScreen();
      else if (act === 'close') close();
    });
    win.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !document.fullscreenElement) { e.preventDefault(); close(); }
    });
    const grip = win.querySelector('.camwin-grip');
    grip.addEventListener('keydown', keyMove);
    drag(grip, (b, dx, dy) => ({ ...b, x: b.x + dx, y: b.y + dy }));
    drag(win.querySelector('.camwin-size'), (b, dx, dy) => ({ ...b, w: b.w + dx, h: b.h + dy }));
    cam = window.PrinterPage && PrinterPage.attachCam ? PrinterPage.attachCam(win.querySelector('.camwin-cam')) : null;
    wireZoom();
    document.addEventListener('fullscreenchange', () => {
      const b = win.querySelector('[data-cw="full"]'), on = document.fullscreenElement === frame();
      b.setAttribute('aria-label', on ? 'Leave full screen' : 'Full screen');
      b.title = on ? 'Leave full screen (or press Esc)' : 'Full screen';
    });
    window.addEventListener('resize', () => { if (open) { place(boxNow()); applyZoom(); } });
  }

  function printerName() {
    const p = fleet.length > 1 ? fleet.find(x => x && x.id === currentPrinter) : null;     // one printer needs no name
    return p && p.name ? String(p.name) : '';
  }
  const nameIt = () => { if (win) setText(win.querySelector('.camwin-where'), printerName() ? ` · ${printerName()}` : ''); };

  function show(focus = true) {
    if (!win) build();
    const saved = read();
    win.hidden = false;
    open = true;
    openedOn = screenNow();
    place(saved.box || defaultBox());
    zoom = Math.max(1, Math.min(ZOOM_MAX, +saved.zoom || 1));
    panX = panY = 0;
    applyZoom();
    setPin(!!saved.pin);
    nameIt();
    remember({ open: true });
    if (cam && !cam.on) { cam.on = true; store.set('dejavu1.cam.window', 'on'); }
    if (window.PrinterPage && PrinterPage.syncCams) setTimeout(PrinterPage.syncCams, 0);
    if (focus) win.querySelector('.camwin-grip').focus({ preventScroll: true });
  }
  function close() {
    if (!win || !open) return;
    if (document.fullscreenElement && win.contains(document.fullscreenElement)) document.exitFullscreen?.().catch?.(() => {});
    win.hidden = true;
    open = false;
    remember({ open: false });
    if (window.PrinterPage && PrinterPage.syncCams) setTimeout(PrinterPage.syncCams, 0);
  }

  // Unpinned, the window belongs to the screen it was opened on; pinned, it stays over every screen.
  window.addEventListener('dv-tab', () => {
    if (!open) return;
    if (!pinned() && screenNow() !== openedOn) close();
  });
  window.addEventListener('dv-printer', nameIt);
  window.addEventListener('dv-fleet', e => { fleet = Array.isArray(e.detail) ? e.detail : []; nameIt(); });

  function init() {
    const saved = read();
    if (saved.open && saved.pin && !tourOn()) show(false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else setTimeout(init, 0);

  return { open: () => show(true), close, isOpen };
})();
