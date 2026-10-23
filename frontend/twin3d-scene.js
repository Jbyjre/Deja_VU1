/* Deja Vu1 - the parts of the Snapmaker U1 for the 3D twin (twin3d.js).
 *
 * Every shape, in the printer's millimetres (X right, Y back, Z up), laid
 * out as in Snapmaker's official product picture. Where a size isn't
 * published it is estimated from that picture and the published figures
 * (see the note at the top of twin3d.js). `build` returns two lists: the
 * parts that never move (`statics`) and the shapes that are moved by the
 * live printer state (`dynamic`), each built at its own origin.
 */
'use strict';

const Twin3DScene = (() => {
  function build(k) {
    const { geo, slab, annulus, lathe, tube, panel, box, rrect, circle, BODY, PLATE, TIP, RAIL_Z, DOCK, HEAD, HUB } = k;
    const statics = [];
    const add = (g, mat, o = {}) => statics.push({ g, mat, ...o });
    const cx = (BODY.x0 + BODY.x1) / 2, cy = (BODY.y0 + BODY.y1) / 2;
    const W = BODY.x1 - BODY.x0, D = BODY.y1 - BODY.y0, R = 30, SEG = 10, BB = 8, TB = 4;
    const DOOR = { x0: 0, x1: 296, z0: 22, z1: 352 };

    /* Turn a shape built flat (u across, v up, w out of the face) to face
     * the front, a side or the top. */
    function orient(g, c, U, V, Wv) {
      const out = geo(), v = g.v;
      for (let i = 0; i < v.length; i += 8) {
        const [x, y, z, nx, ny, nz, s, t] = v.slice(i, i + 8);
        out.v.push(c[0] + U[0] * x + V[0] * y + Wv[0] * z, c[1] + U[1] * x + V[1] * y + Wv[1] * z, c[2] + U[2] * x + V[2] * y + Wv[2] * z,
          U[0] * nx + V[0] * ny + Wv[0] * nz, U[1] * nx + V[1] * ny + Wv[1] * nz, U[2] * nx + V[2] * ny + Wv[2] * nz, s, t);
      }
      return out;
    }
    const FRONT = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
    const LEFT = [[0, -1, 0], [0, 0, 1], [-1, 0, 0]], RIGHT = [[0, 1, 0], [0, 0, 1], [1, 0, 0]];
    const flat = (w, h, r, t0, t1, opt = {}) => slab(geo(), rrect(w, h, r, 6), [0, 0], t0, t1, { bevel: Math.min(1.5, (t1 - t0) / 2), steps: 2, ...opt });

    /* ---- the body: white shell, black rim round the open top ---- */
    const outer = rrect(W, D, R, SEG), frontSeg = 3 * (SEG + 1) - 1;
    {
      // The shell, minus its flat front where the door opening is cut.
      const g = geo(), steps = 4;
      slab(g, outer, [cx, cy], BODY.z0, BODY.z1, { top: false, bottom: true, botBevel: BB, topBevel: TB, steps, skip: (i, r) => i === frontSeg && r === steps });
      add(g, 'body', { shell: true });
      const y = BODY.y0, n = [0, -1, 0], q = (x0, x1, z0, z1) => panel(geo(), [(x0 + x1) / 2, y, (z0 + z1) / 2], [(x1 - x0) / 2, 0, 0], [0, 0, (z1 - z0) / 2], n);
      const fx0 = BODY.x0 + R, fx1 = BODY.x1 - R, zb = BODY.z0 + BB, zt = BODY.z1 - TB;
      [[fx0, DOOR.x0, zb, zt], [DOOR.x1, fx1, zb, zt], [DOOR.x0, DOOR.x1, DOOR.z1, zt], [DOOR.x0, DOOR.x1, zb, DOOR.z0]]
        .forEach(([a, b, c, d]) => { if (b > a && d > c) add(q(a, b, c, d), 'body', { shell: true }); });
      // The opening's edges (the wall's thickness).
      const j = geo(), t = 14;
      const jamb = (a, b, c, d, nn) => { j.v.push(...[a, b, c, a, c, d].flatMap(p => [...p, ...nn, 0, 0])); };
      jamb([DOOR.x0, y, DOOR.z0], [DOOR.x0, y + t, DOOR.z0], [DOOR.x0, y + t, DOOR.z1], [DOOR.x0, y, DOOR.z1], [1, 0, 0]);
      jamb([DOOR.x1, y, DOOR.z1], [DOOR.x1, y + t, DOOR.z1], [DOOR.x1, y + t, DOOR.z0], [DOOR.x1, y, DOOR.z0], [-1, 0, 0]);
      jamb([DOOR.x0, y, DOOR.z1], [DOOR.x0, y + t, DOOR.z1], [DOOR.x1, y + t, DOOR.z1], [DOOR.x1, y, DOOR.z1], [0, 0, -1]);
      jamb([DOOR.x1, y, DOOR.z0], [DOOR.x1, y + t, DOOR.z0], [DOOR.x0, y + t, DOOR.z0], [DOOR.x0, y, DOOR.z0], [0, 0, 1]);
      add(j, 'bodyIn', { shell: true });
    }
    const inner = rrect(W - 28, D - 28, R - 14, SEG), rimOuter = rrect(W - 2 * TB, D - 2 * TB, R - TB, SEG);
    add(annulus(geo(), rimOuter, inner, [cx, cy], BODY.z1), 'rim', { lining: true });
    // Inside: a black lip under the rim, dark walls (no front wall: the door is there), a floor.
    add(slab(geo(), inner, [cx, cy], BODY.z1 - 22, BODY.z1, { top: false, bottom: false, inward: true }), 'rim', { lining: true });
    add(slab(geo(), inner, [cx, cy], 40, BODY.z1 - 22, { top: false, bottom: false, inward: true, skip: (i) => i === frontSeg }), 'bodyIn', { lining: true });
    add(slab(geo(), inner, [cx, cy], 34, 40, { top: true, bottom: false }), 'bodyIn', { lining: true });
    // Rubber feet.
    for (const [fx, fy] of [[BODY.x0 + 40, BODY.y0 + 40], [BODY.x1 - 40, BODY.y0 + 40], [BODY.x0 + 40, BODY.y1 - 40], [BODY.x1 - 40, BODY.y1 - 40]]) {
      add(slab(geo(), circle(16, 20), [fx, fy], 0, BODY.z0, { bevel: 2, steps: 2 }), 'rubber', { lining: true });
    }

    /* ---- the front: door, touchscreen, wordmark ---- */
    const dc = [(DOOR.x0 + DOOR.x1) / 2, BODY.y0, (DOOR.z0 + DOOR.z1) / 2], dw = DOOR.x1 - DOOR.x0, dh = DOOR.z1 - DOOR.z0;
    {
      const frame = geo();
      slab(frame, rrect(dw, dh, 12, 6), [0, 0], -1, 4, { top: false, bottom: false });
      annulus(frame, rrect(dw, dh, 12, 6), rrect(dw - 14, dh - 14, 7, 6), [0, 0], 4);
      add(orient(frame, dc, ...FRONT), 'frame', { shell: true });
      add(orient(flat(dw - 12, dh - 12, 8, 0.5, 2.5), dc, ...FRONT), 'glass', { shell: true });
      // The handle on the right edge, and the hinge screws on the left.
      add(orient(slab(geo(), rrect(14, 62, 6, 6), [0, 0], 4, 20, { bevel: 4, steps: 3 }), [DOOR.x1 - 7, BODY.y0, dc[2] + 6], ...FRONT), 'frame', { shell: true });
      for (const z of [DOOR.z1 - 10, DOOR.z1 - 10, DOOR.z0 + 10, DOOR.z0 + 10].map((z, i) => [z, i % 2 ? 22 : 10])) {
        add(orient(slab(geo(), circle(2.6, 12), [0, 0], 4, 5.5, { bevel: 0.6, steps: 2 }), [DOOR.x0 + z[1], BODY.y0, z[0]], ...FRONT), 'rubber', { shell: true });
      }
    }
    const scr = { x: 264, z: 408, w: 88, h: 64 };
    add(orient(slab(geo(), rrect(scr.w, scr.h, 6, 6), [0, 0], 0, 4, { bevel: 1.2, steps: 2 }), [scr.x, BODY.y0, scr.z], ...FRONT), 'bezel', { shell: true });
    add(panel(geo(), [scr.x + 2, BODY.y0 - 4.2, scr.z], [37, 0, 0], [0, 0, 26], [0, -1, 0]), 'screen', { tex: 'screen', shell: true });
    add(panel(geo(), [42, BODY.y0 - 0.4, 412], [40, 0, 0], [0, 0, 7.5], [0, -1, 0]), 'decal', { tex: 'logo', kind: 'tex', shell: true });

    /* ---- the sides: the oval, vents, spool drums, feeders ---- */
    for (const side of [-1, 1]) {
      const wx = side < 0 ? BODY.x0 : BODY.x1, axes = side < 0 ? LEFT : RIGHT;
      add(panel(geo(), [wx + side * 0.4, cy, (BODY.z0 + BODY.z1) / 2], [0, D / 2, 0], [0, 0, (BODY.z1 - BODY.z0) / 2], [side, 0, 0]), 'decal', { tex: 'side', kind: 'tex', shell: true });
      // Spool drums: a flange on the wall and a slightly tapered drum.
      for (const [hy, hz] of [HUB.upper, HUB.lower]) {
        const prof = [[0, 0], [40, 0], [40, 3.5], [34, 5.5], [32, 12], [30, 92], [27, 96], [0, 96]].map(([r, t]) => [r, side * t]);
        add(lathe(geo(), prof, [wx, hy, hz], 'x', 40), 'hub', { shell: true });
        add(box(geo(), wx + side * 88 - 3, hy - 4, hz + 26, wx + side * 88 + 3, hy + 4, hz + 31), 'rubber', { shell: true });
      }
      // The feeder at the back of each side: white face, black back.
      const fx0 = side < 0 ? wx - 50 : wx, fx1 = side < 0 ? wx : wx + 50;
      add(box(geo(), fx0, 298, 150, fx1, 338, 222, 5), 'body', { shell: true });
      add(box(geo(), side < 0 ? wx - 46 : wx, 336, 152, side < 0 ? wx : wx + 46, 352, 220, 4), 'cable', { shell: true });
      add(panel(geo(), [wx + side * 50.5, 318, 186], [0, side * -19, 0], [0, 0, 31], [side, 0, 0]), 'decal', { tex: 'feeder', kind: 'tex', shell: true });
      // Two filament tubes from the feeder up the side and over the rim.
      for (const dy of [-6, 6]) {
        const x = wx + side * 26;
        add(tube(geo(), [[x, 318 + dy, 222], [x + side * 6, 322 + dy, 300], [wx + side * 4, 330 + dy, 470], [wx - side * 20, 334 + dy, BODY.z1 + 14], [wx - side * 40, 336 + dy, BODY.z1 - 10]], 2.4, 10, 8), 'tube', { shell: true });
      }
    }

    /* ---- inside: rails, the Z column, guide rods, docks ---- */
    add(box(geo(), -46, -60, RAIL_Z - 9, -30, 335, RAIL_Z + 9, 2), 'rail');
    add(box(geo(), 300, -60, RAIL_Z - 9, 316, 335, RAIL_Z + 9, 2), 'rail');
    add(box(geo(), 116, 322, 40, 154, 348, BODY.z1 - 24, 3), 'rail');
    for (const rx of [-12, 282]) add(lathe(geo(), [[5, 40], [5, BODY.z1 - 30]], [rx, 330, 0], 'z', 16), 'carbon');
    add(box(geo(), -30, 342, DOCK.tip + 62, 300, 352, DOCK.tip + 104, 2), 'rail');
    DOCK.xs.forEach(x => add(box(geo(), x - 24, 336, DOCK.tip + 70, x + 24, 344, DOCK.tip + 96, 2), 'cable'));

    /* ---- the shapes the printer state moves ---- */
    const dynamic = {};
    const dyn = (name, g) => { dynamic[name] = { g }; };
    const pc = [135, 135.5];
    dyn('plate', slab(geo(), rrect(PLATE.w, PLATE.d, 6, 4), pc, -5, 0, { bevel: 0.8, steps: 2 }));
    dyn('heater', slab(geo(), rrect(PLATE.w + 4, PLATE.d + 4, 8, 4), pc, -14, -5, { bevel: 1, steps: 2 }));
    dyn('label', panel(geo(), [135, pc[1] - PLATE.d / 2 - 0.6, -2.6], [118, 0, 0], [0, 0, 2.4], [0, -1, 0]));
    {
      const g = geo();
      box(g, -6, 270, -32, 276, 336, -14, 2);
      box(g, 112, 300, -40, 158, 324, -14, 2);
      dyn('carrier', g);
    }
    {
      const g = geo();
      for (const dz of [-7, 7]) lathe(g, [[4.5, -170], [4.5, 170]], [135, 0, RAIL_Z + dz], 'x', 16);
      dyn('xbeam', g);
    }
    dyn('ycar', (() => { const g = geo(); box(g, -50, -20, RAIL_Z - 14, -26, 20, RAIL_Z + 14, 3); box(g, 296, -20, RAIL_Z - 14, 320, 20, RAIL_Z + 14, 3); return g; })());
    dyn('carriage', slab(geo(), rrect(72, 40, 10, 6), [0, 6], RAIL_Z - 22, RAIL_Z + 24, { bevel: 5, steps: 3 }));
    // A toolhead, its nozzle tip at the origin.
    dyn('head', slab(geo(), rrect(HEAD.w, HEAD.d, 7, 6), [0, 0], 16, HEAD.h, { bevel: 4, steps: 3 }));
    dyn('headFace', panel(geo(), [0, -HEAD.d / 2 - 0.35, 56], [22, 0, 0], [0, 0, 39], [0, -1, 0]));
    {
      const g = geo();
      box(g, -HEAD.w / 2 + 1, -12, HEAD.h - 1, -HEAD.w / 2 + 13, 6, HEAD.h + 9, 2.5);           // the lever on top
      box(g, -HEAD.w / 2 - 0.4, -HEAD.d / 2 - 0.5, 22, -HEAD.w / 2 + 3, -HEAD.d / 2 + 6, 92, 0.8);  // the stripe down the front edge
      dyn('headYellow', g);
    }
    dyn('headLed', panel(geo(), [0, -HEAD.d / 2 - 0.5, 86], [5, 0, 0], [0, 0, 1.6], [0, -1, 0]));
    dyn('nozzle', lathe(geo(), [[0.5, 0], [2.6, 3], [3.6, 7], [5.5, 7.5], [5.5, 12]], [0, 0, 0], 'z', 24));
    dyn('block', box(geo(), -11, -12, 9, 11, 12, 17, 3));
    // A 1 kg spool on a drum, its axis along X through the origin.
    {
      const g = geo();
      lathe(g, [[84, -32], [84, 32]], [0, 0, 0], 'x', 64);
      lathe(g, [[36, -32], [84, -32]], [0, 0, 0], 'x', 64);
      lathe(g, [[84, 32], [36, 32]], [0, 0, 0], 'x', 64);
      dyn('spoolCore', g);
    }
    {
      const g = geo();
      for (const s of [-1, 1]) lathe(g, [[29, s * 32], [100, s * 32], [100, s * 35.5], [29, s * 35.5], [29, s * 32]], [0, 0, 0], 'x', 64);
      lathe(g, [[30, -32], [30, 32]], [0, 0, 0], 'x', 40);
      dyn('spoolFlange', g);
    }
    dyn('blob', box(geo(), 80, 80, 0, 190, 190, 1, 0.3));
    void TIP;
    return { statics, dynamic, DOOR };
  }
  return { build };
})();
