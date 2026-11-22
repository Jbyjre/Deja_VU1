/* The Snapmaker U1's build plate, drawn once and used by the model views (Files, the Photo studio and the Slicer). The printer's own 3D twin draws its bed itself and does not use this.
 *
 * Facts, and where they come from (read from the engine's own files on 21 November 2026, nothing copied):
 *   - the printable area is 270 x 270 mm, from x 0.5 to 270.5 and y 1 to 271, and 270.05 mm tall: Snapmaker's U1 machine profile
 *     (`printable_area`, `printable_height`, Snapmaker Orca 2.4.1);
 *   - the plate itself is a 0.5 mm sheet, 276 mm wide and 293 mm deep, with a straight back edge, straight sides and a narrower front edge
 *     that widens through gentle chamfers: measured from the outline of the engine's bed model. The outline below is that measurement.
 * The look is Deja Vu1's own: a dark textured sheet, the printable area marked with corner brackets and a ruler, the maker's name in the
 * middle where the real plate carries it, and a FRONT mark. The name is shown because it is the printer's own plate, which says nothing
 * about who made this app. Snapmaker's drawing files are AGPL-3.0 and are never copied here. */
'use strict';
window.U1Plate = (() => {
  const AREA = { x0: 0.5, y0: 1, x1: 270.5, y1: 271, z1: 270.05 };
  const CENTRE = [(AREA.x0 + AREA.x1) / 2, (AREA.y0 + AREA.y1) / 2];
  const SHEET = { w: 276, d: 293, t: 0.5 };
  // The sheet's outline, in mm from its centre, going round from the front left corner.
  const OUTLINE = [[-138, -134], [-136.83, -136.83], [-134, -138], [-71.92, -146.5], [71.92, -146.5], [134, -138], [136.83, -136.83],
    [138, -134], [138, 142.5], [136.83, 145.33], [134, 146.5], [-134, 146.5], [-136.83, 145.33], [-138, 142.5]];
  const TEX = 2048;
  // The texture covers the sheet's bounding box: u across its width, v from its front edge to its back edge.
  const uvOf = (x, y) => [(x - (CENTRE[0] - SHEET.w / 2)) / SHEET.w, (y - (CENTRE[1] - SHEET.d / 2)) / SHEET.d];

  const outline = () => OUTLINE.map(([x, y]) => [CENTRE[0] + x, CENTRE[1] + y]);

  /* Triangles for the sheet: its top face (a fan, the outline is convex) and its 0.5 mm side. Top at z 0. */
  function geometry() {
    const ring = outline(), pos = [], nrm = [], uv = [];
    const tri = (a, b, c, n) => {
      for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]); uv.push(...uvOf(p[0], p[1])); }
    };
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      tri([CENTRE[0], CENTRE[1], 0], [p[0], p[1], 0], [q[0], q[1], 0], [0, 0, 1]);
      const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1, n = [dy / len, -dx / len, 0];
      tri([p[0], p[1], 0], [p[0], p[1], -SHEET.t], [q[0], q[1], -SHEET.t], n);
      tri([p[0], p[1], 0], [q[0], q[1], -SHEET.t], [q[0], q[1], 0], n);
    }
    return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), count: pos.length / 3 };
  }

  /* The printable box as line segments (x1,y1,z1,x2,y2,z2 ...): the four posts and the top frame, drawn faintly so the height is felt
     without a cage in the way. */
  function volumeLines() {
    const { x0, y0, x1, y1, z1 } = AREA, out = [];
    const seg = (a, b) => out.push(...a, ...b);
    const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = c[i], [bx, by] = c[(i + 1) % 4];
      seg([ax, ay, z1], [bx, by, z1]);
      const L = 16;                                    // a post is drawn as a bracket at its foot and its head, not a full line
      seg([ax, ay, 0], [ax, ay, L]); seg([ax, ay, z1 - L], [ax, ay, z1]);
    }
    return new Float32Array(out);
  }

  const inside = (min, max, tol = 0.001) => min[0] >= AREA.x0 - tol && min[1] >= AREA.y0 - tol && min[2] >= -tol &&
    max[0] <= AREA.x1 + tol && max[1] <= AREA.y1 + tol && max[2] <= AREA.z1 + tol;

  /* ---- the texture --------------------------------------------------------------------------------------------------------- */
  let canvas = null, drawn = 0;
  const state = { version: 0 };

  function paint(ctx) {
    const kx = TEX / SHEET.w, ky = TEX / SHEET.d;
    const left = CENTRE[0] - SHEET.w / 2, front = CENTRE[1] - SHEET.d / 2;
    // sheet millimetres, y up: (0,0) is the sheet's front left corner
    ctx.setTransform(kx, 0, 0, -ky, 0, TEX);
    const base = ctx.createRadialGradient(SHEET.w / 2, SHEET.d / 2, 10, SHEET.w / 2, SHEET.d / 2, 200);
    base.addColorStop(0, '#32363e'); base.addColorStop(0.7, '#272a31'); base.addColorStop(1, '#1b1d22');
    ctx.fillStyle = base; ctx.fillRect(0, 0, SHEET.w, SHEET.d);
    // fine matte grain, the way textured PEI looks: many tiny light and dark specks, the same every time
    let seed = 20261121;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 90000; i++) {
      const x = rnd() * SHEET.w, y = rnd() * SHEET.d, light = rnd() > 0.5;
      ctx.fillStyle = light ? `rgba(255,255,255,${0.025 + rnd() * 0.05})` : `rgba(0,0,0,${0.06 + rnd() * 0.1})`;
      ctx.fillRect(x, y, 0.28 + rnd() * 0.3, 0.28 + rnd() * 0.3);
    }
    const ax0 = AREA.x0 - left, ax1 = AREA.x1 - left, ay0 = AREA.y0 - front, ay1 = AREA.y1 - front;
    // the ruler grid: a line every 10 mm, a little stronger every 50
    ctx.lineWidth = 0.16;
    for (let d = 10; d < 270; d += 10) {
      ctx.strokeStyle = d % 50 ? 'rgba(190,205,230,0.075)' : 'rgba(190,205,230,0.2)';
      ctx.beginPath(); ctx.moveTo(ax0 + d, ay0); ctx.lineTo(ax0 + d, ay1); ctx.moveTo(ax0, ay0 + d); ctx.lineTo(ax1, ay0 + d); ctx.stroke();
    }
    // the printable area's edge, and a bracket at each corner
    ctx.strokeStyle = 'rgba(190,205,230,0.34)'; ctx.lineWidth = 0.3; ctx.strokeRect(ax0, ay0, ax1 - ax0, ay1 - ay0);
    ctx.strokeStyle = 'rgba(150,200,255,0.95)'; ctx.lineWidth = 0.9; ctx.lineCap = 'round';
    const L = 16;
    for (const [cx, cy, sx, sy] of [[ax0, ay0, 1, 1], [ax1, ay0, -1, 1], [ax1, ay1, -1, -1], [ax0, ay1, 1, -1]]) {
      ctx.beginPath(); ctx.moveTo(cx + sx * L, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * L); ctx.stroke();
    }
    // numbers along the front and the left edge, every 50 mm, in the mono face
    ctx.save(); ctx.scale(1, -1);
    ctx.fillStyle = 'rgba(200,215,240,0.5)'; ctx.font = '500 3.6px "IBM Plex Mono", ui-monospace, monospace'; ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    for (let d = 0; d <= 250; d += 50) ctx.fillText(String(d), ax0 + d + (d === 0 ? 3 : 0), -(ay0 - 5.2));
    ctx.textAlign = 'left';
    for (let d = 50; d <= 250; d += 50) ctx.fillText(String(d), ax0 + 3, -(ay0 + d - 1));
    // the printer's name in the middle, where the real plate carries it: lower case, light, spaced
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.9px';
    ctx.font = '600 14.5px "Instrument Sans", "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText('snapmaker', SHEET.w / 2 + 0.5, -(SHEET.d / 2) - 0.5);
    ctx.fillStyle = 'rgba(244,247,252,0.92)'; ctx.fillText('snapmaker', SHEET.w / 2, -(SHEET.d / 2));
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    // FRONT, with a small chevron, on the narrow edge nearest you
    ctx.fillStyle = 'rgba(200,215,240,0.55)'; ctx.font = '600 3.8px "IBM Plex Mono", ui-monospace, monospace';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.2px';
    ctx.fillText('FRONT', SHEET.w / 2, -(ay0 - 8.6));
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.restore();
    ctx.strokeStyle = 'rgba(200,215,240,0.55)'; ctx.lineWidth = 0.5; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(SHEET.w / 2 - 3.2, ay0 - 5.2); ctx.lineTo(SHEET.w / 2, ay0 - 2.6); ctx.lineTo(SHEET.w / 2 + 3.2, ay0 - 5.2); ctx.stroke();
    // the origin: a small cross where X and Y are zero
    ctx.strokeStyle = 'rgba(150,200,255,0.9)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(ax0 - 2, ay0); ctx.lineTo(ax0 + 2, ay0); ctx.moveTo(ax0, ay0 - 2); ctx.lineTo(ax0, ay0 + 2); ctx.stroke();
  }

  /* The drawn plate, as a canvas the 3D views upload as a texture. Drawn once; again when the fonts arrive. */
  function texture() {
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = TEX;
      paint(canvas.getContext('2d'));
      state.version++;
      drawn = 1;
      const fonts = document.fonts;
      if (fonts && fonts.load) {
        Promise.all(['600 14px "Instrument Sans"', '500 4px "IBM Plex Mono"', '600 4px "IBM Plex Mono"'].map(f => fonts.load(f))).then(() => {
          canvas.getContext('2d').setTransform(1, 0, 0, 1, 0, 0); paint(canvas.getContext('2d')); state.version++; drawn = 2;
          window.dispatchEvent(new CustomEvent('dv-plate'));
        }).catch(() => {});
      }
    }
    return canvas;
  }

  /* The room behind the plate: the app's own scene colours, turned into RGB by the browser, for the light and the dark look. */
  const cache = {};
  function roomColours() {
    const style = getComputedStyle(document.documentElement);
    const key = document.documentElement.dataset.theme + '|' + style.getPropertyValue('--room-top') + style.getPropertyValue('--room-bot');
    if (cache.key === key) return cache.value;
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const rgb = (token, fallback) => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000';
      try { ctx.fillStyle = style.getPropertyValue(token).trim() || fallback; } catch (e) { ctx.fillStyle = fallback; }
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0] / 255, d[1] / 255, d[2] / 255];
    };
    cache.key = key;
    cache.value = { top: rgb('--room-top', '#e8eef5'), bottom: rgb('--room-bot', '#c7d2de') };
    return cache.value;
  }

  return { AREA, CENTRE, SHEET, OUTLINE, outline, geometry, volumeLines, inside, texture, roomColours, state, uvOf };
})();
