/* Deja Vu1 - the parts of the Snapmaker U1 for the 3D twin (twin3d.js).
 *
 * Every shape, in the printer's millimetres (X right, Y back, Z up), laid
 * out as in Snapmaker's product photos of the production U1. Where a size
 * isn't published it is measured from those photos or estimated (see the
 * note at the top of twin3d.js). `build` returns two lists: the parts that
 * never move (`statics`) and the shapes that are moved by the live printer
 * state (`dynamic`), each built at its own origin.
 */
'use strict';

const Twin3DScene = (() => {
  function build(k) {
    const { geo, slab, annulus, lathe, tube, panel, box, rrect, circle, quadV, tri, norm, BODY, PLATE, TIP, RAIL_Z, DOCK, HEAD, HUB } = k;
    const statics = [];
    const add = (g, mat, o = {}) => statics.push({ g, mat, ...o });
    const { x0, x1, y0, y1, yb, z0, z1, zs, rs } = BODY;
    const cx = (x0 + x1) / 2, W = x1 - x0, R = BODY.r, SEG = 10, BB = 8, LID = 8, TB = 4, WT = HUB.pocket + 2;
    const zb = z0 + BB, zt = z1 - LID;   // the white walls run from zb to zt; the grey frame sits above
    const DOOR = { x0: -34, x1: 304, z0: 24, z1: 356 };
    const WIN = { x0: -15, x1: 285, z0: 42, z1: 296 };   // the opening in the back
    // The straight edges of a rounded rectangle from rrect(): back, left, front, right.
    const BACK = SEG, LEFTS = 2 * SEG + 1, FRONTS = 3 * SEG + 2, RIGHTS = 4 * SEG + 3;
    const shift = (pts, dx, dy) => pts.map(p => [p[0] + dx, p[1] + dy, p[2], p[3]]);

    /* How far back the body reaches at height z: the lower back, then a
     * quarter-round curving out under the shelf, then the shelf. */
    const fc = zs - rs;
    const backAt = z => z <= fc ? y1 : z >= zs ? yb : yb - Math.sqrt(Math.max(0, rs * rs - (z - fc) * (z - fc)));
    const slope = z => (backAt(Math.min(zs, z + 0.05)) - backAt(Math.max(fc, z - 0.05))) / 0.1;

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
    const flat = (w, h, r, t0, t1, opt = {}) => slab(geo(), rrect(w, h, r, 6), [0, 0], t0, t1, { bevel: Math.min(1.5, (t1 - t0) / 2), steps: 2, ...opt });
    // An axis-aligned flat rectangle with its normal.
    const rect = (g, a, b, c, d, n) => { quadV(g, [a, n], [b, n], [c, n], [d, n]); return g; };

    /* ---- the body: white shell, grey frame on top ---- */
    {
      /* Rings of the outline up the body, each band joined ring to ring.
       * The front, the sides and the lower back are left out here and built
       * flat below, with the door, the spool pockets and the back opening. */
      const g = geo();
      const ring = (z, k = 0, nr = 1, nz = 0, curved = false) => {
        const D = backAt(z) - y0, pts = shift(rrect(W, D, R, SEG), cx, y0 + D / 2), s = curved ? slope(Math.max(fc + 0.06, Math.min(zs - 0.06, z))) : 0;
        return pts.map((p, i) => {
          const back = p[1] > y0 + D / 2;   // the back corners move with the curve
          const n = norm([p[2] * nr, p[3] * nr, nz - (back ? p[3] * nr * Math.min(40, s) : 0)]);
          return [[p[0] - p[2] * k, p[1] - p[3] * k, z], n];
        });
      };
      const band = (rings, skip) => {
        for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < rings[r].length; i++) {
          if (skip.includes(i)) continue;
          const j = (i + 1) % rings[r].length;
          quadV(g, rings[r][i], rings[r][j], rings[r + 1][j], rings[r + 1][i]);
        }
      };
      const steps = 4, bottom = [];
      for (let i = 0; i <= steps; i++) { const t = (i / steps) * Math.PI / 2; bottom.push(ring(z0 + BB - BB * Math.cos(t), BB * (1 - Math.sin(t)), Math.sin(t), -Math.cos(t))); }
      band(bottom, []);
      // The underside, a flat plate inside the bottom ring.
      const base = bottom[0];
      for (let i = 0; i < base.length; i++) tri(g, [[cx, (y0 + y1) / 2, z0], [0, 0, -1]], [base[(i + 1) % base.length][0], [0, 0, -1]], [base[i][0], [0, 0, -1]]);
      band([ring(zb), ring(fc)], [BACK, LEFTS, FRONTS, RIGHTS]);
      const curve = [];
      for (let i = 0; i <= 12; i++) curve.push(ring(fc + rs * Math.sin(i / 12 * Math.PI / 2), 0, 1, 0, true));
      band(curve, [LEFTS, FRONTS, RIGHTS]);
      band([ring(zs), ring(zt)], [LEFTS, FRONTS, RIGHTS]);
      add(g, 'body', { shell: true });

      // The flat front, around the door.
      const f = geo(), fy = y0, nF = [0, -1, 0];
      const q = (g2, xa, xb, za, zc, y, n) => rect(g2, [xa, y, za], [xb, y, za], [xb, y, zc], [xa, y, zc], n);
      const fx0 = x0 + R, fx1 = x1 - R;
      q(f, fx0, DOOR.x0, zb, zt, fy, nF); q(f, DOOR.x1, fx1, zb, zt, fy, nF);
      q(f, DOOR.x0, DOOR.x1, DOOR.z1, zt, fy, nF); q(f, DOOR.x0, DOOR.x1, zb, DOOR.z0, fy, nF);
      // The lower back, around the opening.
      const nB = [0, 1, 0];
      q(f, fx0, WIN.x0, zb, fc, y1, nB); q(f, WIN.x1, fx1, zb, fc, y1, nB);
      q(f, WIN.x0, WIN.x1, WIN.z1, fc, y1, nB); q(f, WIN.x0, WIN.x1, zb, WIN.z0, y1, nB);
      add(f, 'body', { shell: true });

      // The openings' edges (the wall's thickness), dark as the chamber.
      const j = geo();
      const jambs = (o, y, t, s) => {
        const ya = y, yc = y + s * t;
        rect(j, [o.x0, ya, o.z0], [o.x0, yc, o.z0], [o.x0, yc, o.z1], [o.x0, ya, o.z1], [1, 0, 0]);
        rect(j, [o.x1, ya, o.z1], [o.x1, yc, o.z1], [o.x1, yc, o.z0], [o.x1, ya, o.z0], [-1, 0, 0]);
        rect(j, [o.x0, ya, o.z1], [o.x0, yc, o.z1], [o.x1, yc, o.z1], [o.x1, ya, o.z1], [0, 0, -1]);
        rect(j, [o.x1, ya, o.z0], [o.x1, yc, o.z0], [o.x0, yc, o.z0], [o.x0, ya, o.z0], [0, 0, 1]);
      };
      jambs(DOOR, y0, WT, 1); jambs(WIN, y1, WT, -1);
      add(j, 'bodyIn', { shell: true });
    }

    /* ---- the sides: a recessed oval with the spools, vents, the feeder ----
     * The flat side face is built as a ring of quads between its outline and
     * the pocket's edge, along rays from the pocket's centre (both shapes are
     * convex, so no ray crosses another), plus a strip where the side follows
     * the shelf back. */
    const [uy, uz] = HUB.upper, [ly, lz] = HUB.lower, SR = HUB.R, P = HUB.pocket;
    const pc = [(uy + ly) / 2, (uz + lz) / 2];
    const nearest = (y, z) => {   // nearest point on the line between the two hubs
      const dy = uy - ly, dz = uz - lz, t = Math.max(0, Math.min(1, ((y - ly) * dy + (z - lz) * dz) / (dy * dy + dz * dz)));
      return [ly + dy * t, lz + dz * t];
    };
    const inPocket = (y, z) => { const [a, b] = nearest(y, z); return Math.hypot(y - a, z - b) <= SR; };
    const inFace = (y, z) => z >= zb && z <= zt && y >= y0 + R && y <= y1 - R;   // the part below the shelf's reach
    const edge = (inside, th) => {   // bisect along the ray for the boundary
      let lo = 0, hi = 900;
      for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (inside(pc[0] + Math.cos(th) * m, pc[1] + Math.sin(th) * m)) lo = m; else hi = m; }
      return [pc[0] + Math.cos(th) * lo, pc[1] + Math.sin(th) * lo];
    };
    const N = 192, rim = [], out = [];
    for (let i = 0; i < N; i++) { const th = i / N * Math.PI * 2; rim.push(edge(inPocket, th)); out.push(edge(inFace, th)); }
    for (const side of [-1, 1]) {
      const wx = side < 0 ? x0 : x1, nS = [side, 0, 0], fx = wx - side * P;
      const face = geo(), walls = geo(), floor = geo();
      for (let i = 0; i < N; i++) {
        const a = rim[i], b = rim[(i + 1) % N], c = out[(i + 1) % N], d = out[i];
        rect(face, [wx, a[0], a[1]], [wx, b[0], b[1]], [wx, c[0], c[1]], [wx, d[0], d[1]], nS);
        // The pocket wall faces in, towards the line between the hubs.
        const [na, nb] = [a, b].map(p => { const q = nearest(p[0], p[1]); return norm([0, q[0] - p[0], q[1] - p[1]]); });
        quadV(walls, [[wx, a[0], a[1]], na], [[wx, b[0], b[1]], nb], [[fx, b[0], b[1]], nb], [[fx, a[0], a[1]], na]);
        tri(floor, [[fx, pc[0], pc[1]], nS], [[fx, a[0], a[1]], nS], [[fx, b[0], b[1]], nS]);
      }
      const zk = Array.from({ length: 15 }, (_, i) => fc + rs * Math.sin(i / 14 * Math.PI / 2)).concat(zt);
      for (let i = 0; i < zk.length - 1; i++) {
        const za = zk[i], zc = zk[i + 1];
        rect(face, [wx, y1 - R, za], [wx, backAt(za) - R, za], [wx, backAt(zc) - R, zc], [wx, y1 - R, zc], nS);
      }
      add(face, 'body', { shell: true });
      add(walls, 'pocket', { shell: true });
      add(floor, 'body', { shell: true });
      // Vent holes on the pocket floor (a decal laid just above it).
      add(panel(geo(), [fx + side * 0.4, (y0 + y1) / 2, (z0 + z1) / 2], [0, (y1 - y0) / 2, 0], [0, 0, (z1 - z0) / 2], nS), 'decal', { tex: 'side', kind: 'tex', shell: true });
      // The spool hubs: a foot on the pocket floor, a white post, a rounded cap.
      for (const [hy, hz] of [HUB.upper, HUB.lower]) {
        const prof = [[0, -P], [40, -P], [40, -P + 3], [27, -P + 5], [26, 48], [28, 52], [27, 57], [21, 61.5], [11, 64], [0, 64]].map(([r, t]) => [r, side * t]);
        add(lathe(geo(), prof, [wx, hy, hz], 'x', 40), 'hub', { shell: true });
      }
      // The feeder near the back: white front, black back, its face marked 1 and 2.
      const o0 = side < 0 ? wx - 36 : wx, o1 = side < 0 ? wx : wx + 36;
      add(box(geo(), o0, 256, 122, o1, 292, 178, 4), 'body', { shell: true });
      add(box(geo(), o0, 290, 124, o1, 323, 176, 4), 'cable', { shell: true });
      add(panel(geo(), [wx + side * 36.4, 274, 150], [0, side * -17, 0], [0, 0, 21], nS), 'decal', { tex: 'feeder', kind: 'tex', shell: true });
    }

    /* ---- the top: the grey frame with a screw in each corner ---- */
    {
      const D = yb - y0;
      add(slab(geo(), rrect(W, D, R, SEG), [cx, y0 + D / 2], zt, z1, { top: false, bottom: false, topBevel: TB, botBevel: 0, steps: 3 }), 'lid', { shell: true });
    }
    const RI = R - WT + 4, inner = shift(rrect(W - 2 * WT, (y1 - y0) - 2 * WT, RI, SEG), cx, (y0 + y1) / 2);
    const lidIn = shift(rrect(W - 2 * TB, (yb - y0) - 2 * TB, R - TB, SEG), cx, (y0 + yb) / 2);
    add(annulus(geo(), lidIn, inner, [0, 0], z1), 'lid', { shell: true });
    for (const [sx, sy] of [[x0 + 16, y0 + 16], [x1 - 16, y0 + 16], [x0 + 16, yb - 16], [x1 - 16, yb - 16]]) {
      add(slab(geo(), circle(4.5, 16), [sx, sy], z1 - 0.2, z1 + 0.9, { bevel: 0.5, steps: 2 }), 'rubber', { shell: true });
    }
    // Inside: a black lip under the frame, black walls with the door and the back opening, a floor.
    const innerAt = shift(inner, -cx, -(y0 + y1) / 2), ic = [cx, (y0 + y1) / 2];
    add(slab(geo(), innerAt, ic, z1 - 22, z1, { top: false, bottom: false, inward: true }), 'rim', { lining: true });
    add(slab(geo(), innerAt, ic, 40, z1 - 22, { top: false, bottom: false, inward: true, skip: (i) => i === FRONTS || i === BACK }), 'bodyIn', { lining: true });
    {
      const g = geo(), yi = y1 - WT, n = [0, -1, 0], ix0 = x0 + WT + RI, ix1 = x1 - WT - RI;
      const q = (xa, xb, za, zc) => rect(g, [xa, yi, za], [xb, yi, za], [xb, yi, zc], [xa, yi, zc], n);
      q(ix0, WIN.x0, 40, z1 - 22); q(WIN.x1, ix1, 40, z1 - 22); q(WIN.x0, WIN.x1, WIN.z1, z1 - 22); q(WIN.x0, WIN.x1, 40, WIN.z0);
      const yf = y0 + WT, nf = [0, 1, 0];
      const qf = (xa, xb, za, zc) => rect(g, [xa, yf, za], [xb, yf, za], [xb, yf, zc], [xa, yf, zc], nf);
      qf(ix0, DOOR.x0, 40, z1 - 22); qf(DOOR.x1, ix1, 40, z1 - 22); qf(DOOR.x0, DOOR.x1, DOOR.z1, z1 - 22); qf(DOOR.x0, DOOR.x1, 40, DOOR.z0);
      add(g, 'bodyIn', { lining: true });
    }
    add(slab(geo(), innerAt, ic, 34, 40, { top: true, bottom: false }), 'bodyIn', { lining: true });
    // Two light bars on the back wall, below the docked heads (as in Snapmaker's close-ups).
    for (const [a, b] of [[18, 112], [158, 252]]) add(box(geo(), a, y1 - WT - 4, 350, b, y1 - WT, 357, 1.5), 'led', { lining: true, glow: 0.85 });
    // Rubber feet.
    for (const [fx, fy] of [[x0 + 44, y0 + 44], [x1 - 44, y0 + 44], [x0 + 44, y1 - 44], [x1 - 44, y1 - 44]]) {
      add(slab(geo(), circle(16, 20), [fx, fy], 0, z0, { bevel: 2, steps: 2 }), 'rubber', { lining: true });
    }

    /* ---- the front: door, touchscreen, wordmark ---- */
    const dc = [(DOOR.x0 + DOOR.x1) / 2, y0, (DOOR.z0 + DOOR.z1) / 2], dw = DOOR.x1 - DOOR.x0, dh = DOOR.z1 - DOOR.z0;
    {
      const frame = geo();
      slab(frame, rrect(dw, dh, 12, 6), [0, 0], -1, 4, { top: false, bottom: false });
      annulus(frame, rrect(dw, dh, 12, 6), rrect(dw - 18, dh - 18, 7, 6), [0, 0], 4);
      add(orient(frame, dc, ...FRONT), 'frame', { shell: true });
      add(orient(flat(dw - 12, dh - 12, 8, 0.5, 2.5), dc, ...FRONT), 'glass', { shell: true });
      // The handle on the right edge, and the hinge screws on the left.
      add(orient(slab(geo(), rrect(14, 62, 6, 6), [0, 0], 4, 20, { bevel: 4, steps: 3 }), [DOOR.x1 - 7, y0, dc[2] + 6], ...FRONT), 'frame', { shell: true });
      for (const z of [DOOR.z1 - 10, DOOR.z1 - 10, DOOR.z0 + 10, DOOR.z0 + 10].map((z, i) => [z, i % 2 ? 22 : 10])) {
        add(orient(slab(geo(), circle(2.6, 12), [0, 0], 4, 5.5, { bevel: 0.6, steps: 2 }), [DOOR.x0 + z[1], y0, z[0]], ...FRONT), 'rubber', { shell: true });
      }
    }
    // The screen's right edge lines up with the door's, as in the photos.
    const scr = { x: DOOR.x1 - 50, z: 410, w: 100, h: 66 };
    add(orient(slab(geo(), rrect(scr.w, scr.h, 6, 6), [0, 0], 0, 4, { bevel: 1.2, steps: 2 }), [scr.x, y0, scr.z], ...FRONT), 'bezel', { shell: true });
    add(panel(geo(), [scr.x + 2, y0 - 4.2, scr.z], [40, 0, 0], [0, 0, 25], [0, -1, 0]), 'screen', { tex: 'screen', shell: true });
    add(panel(geo(), [DOOR.x0 + 64, y0 - 0.4, 436], [64, 0, 0], [0, 0, 12], [0, -1, 0]), 'decal', { tex: 'logo', kind: 'tex', shell: true });

    /* ---- the back: the opening, the ports, the tubes down to the feeders ---- */
    {
      const wc = [(WIN.x0 + WIN.x1) / 2, y1, (WIN.z0 + WIN.z1) / 2], ww = WIN.x1 - WIN.x0, wh = WIN.z1 - WIN.z0;
      const BACKF = [[-1, 0, 0], [0, 0, 1], [0, 1, 0]];
      const fr = geo();
      annulus(fr, rrect(ww, wh, 8, 6), rrect(ww - 10, wh - 10, 5, 6), [0, 0], 1.5);
      add(orient(fr, wc, ...BACKF), 'frame', { shell: true });
      add(orient(flat(ww - 6, wh - 6, 6, 0.2, 1.2), wc, ...BACKF), 'rearGlass', { shell: true });
      add(panel(geo(), [x1 - R - 22, y1 + 0.4, 92], [-16, 0, 0], [0, 0, 48], [0, 1, 0]), 'decal', { tex: 'ports', kind: 'tex', shell: true });
    }
    /* Each head's tube leaves the shelf's back face and hangs down, round
     * the back corner, into its feeder's black end: heads 1 and 2 to the
     * left feeder, 3 and 4 to the right (as numbered on the spools). */
    DOCK.xs.forEach((hx, i) => {
      const s = i < 2 ? -1 : 1, fx = (s < 0 ? x0 : x1) + s * 18, tz = i % 2 ? 140 : 160;
      const pts = [[hx, yb - 3, z1 - 22], [hx + s * 6, yb + 12, z1 - 52], [hx * 0.55 + fx * 0.45, yb + 14, zs - 70],
        [hx * 0.2 + fx * 0.8, y1 + 34, 210], [fx, y1 + 4, tz + 14], [fx, 336, tz], [fx, 321, tz]];
      add(tube(geo(), pts, 2.6, 10, 8), 'tube', { shell: true });
    });

    /* ---- inside: rails, the Z column, guide rods, docks ---- */
    add(box(geo(), -64, -70, RAIL_Z - 9, -48, 326, RAIL_Z + 9, 2), 'rail');
    add(box(geo(), 318, -70, RAIL_Z - 9, 334, 326, RAIL_Z + 9, 2), 'rail');
    add(box(geo(), 116, 310, 40, 154, 328, 360, 3), 'rail');
    for (const rx of [-12, 282]) add(lathe(geo(), [[5, 40], [5, z1 - 40]], [rx, 318, 0], 'z', 16), 'carbon');
    add(box(geo(), -40, 326, DOCK.tip + 56, 310, 330, DOCK.tip + 92, 1.5), 'rail');
    DOCK.xs.forEach(x => add(box(geo(), x - 24, 321, DOCK.tip + 62, x + 24, 326, DOCK.tip + 88, 1.5), 'cable'));

    /* ---- the frame and drive, seen when the case is taken off ----
     * Not in Snapmaker's photos (the case hides them), so their sizes are
     * typical of a CoreXY machine this size, drawn where they must be for the
     * parts above to work: posts in the corners, the two XY motors at the
     * back, belts along both sides, idlers at the front, a lead screw and
     * its motor behind the bed. Estimates, like the inside layout. */
    {
      const frame = (g) => add(g, 'extrusion', { frame: true });
      const post = (x, y) => frame(box(geo(), x - 10, y - 10, 40, x + 10, y + 10, z1 - 10, 1.5));
      [[-56, -66], [326, -66], [-56, 314], [326, 314]].forEach(([x, y]) => post(x, y));
      // Rings of extrusion at the bottom and under the rails.
      for (const z of [40, RAIL_Z - 26]) {
        frame(box(geo(), -46, -76, z, 316, -56, z + 20, 1.5));
        frame(box(geo(), -46, 304, z, 316, 324, z + 20, 1.5));
        if (z === 40) {
          frame(box(geo(), -66, -56, z, -46, 304, z + 20, 1.5));
          frame(box(geo(), 316, -56, z, 336, 304, z + 20, 1.5));
        }
      }
      // A base plate the frame stands on.
      add(box(geo(), -80, -82, 22, 350, 340, 40, 2), 'alu', { frame: true });
      // CoreXY motors at the back corners, shafts up into the belt pulleys.
      for (const x of [-56, 326]) {
        add(box(geo(), x - 21, 278, RAIL_Z - 54, x + 21, 320, RAIL_Z - 8, 2.5), 'motor', { frame: true });
        add(box(geo(), x - 21.5, 277.5, RAIL_Z - 14, x + 21.5, 320.5, RAIL_Z - 8, 1.5), 'alu', { frame: true });
        add(lathe(geo(), [[2.5, RAIL_Z - 8], [2.5, RAIL_Z], [8, RAIL_Z], [8, RAIL_Z + 14], [2.5, RAIL_Z + 14], [2.5, RAIL_Z + 18]], [x, 299, 0], 'z', 24), 'steel', { frame: true });
        // Idler at the front of the same side.
        add(lathe(geo(), [[2.5, RAIL_Z], [8, RAIL_Z], [8, RAIL_Z + 14], [2.5, RAIL_Z + 14]], [x, -50, 0], 'z', 24), 'alu', { frame: true });
        // Two belt strands along the side, at their two heights.
        for (const [dx, z] of [[-8.6, RAIL_Z + 3], [8.6, RAIL_Z + 9]]) add(box(geo(), x + dx - 0.8, -50, z - 3, x + dx + 0.8, 299, z + 3, 0.4), 'belt', { frame: true });
      }
      // The lead screw behind the bed and its motor underneath.
      add(lathe(geo(), [[4, 60], [4, 372]], [135, 305, 0], 'z', 20), 'screw', { frame: true });
      add(box(geo(), 114, 284, 60, 156, 326, 104, 2.5), 'motor', { frame: true });
      add(box(geo(), 113.5, 283.5, 98, 156.5, 326.5, 104, 1.5), 'alu', { frame: true });
      add(lathe(geo(), [[9, 364], [9, 380]], [135, 305, 0], 'z', 20), 'alu', { frame: true });
    }

    /* ---- the shapes the printer state moves ---- */
    const dynamic = {};
    const dyn = (name, g) => { dynamic[name] = { g }; };
    const bc = [135, 135.5];
    dyn('plate', slab(geo(), rrect(PLATE.w, PLATE.d, 6, 4), bc, -5, 0, { bevel: 0.8, steps: 2 }));
    dyn('heater', slab(geo(), rrect(PLATE.w + 4, PLATE.d + 4, 8, 4), bc, -14, -5, { bevel: 1, steps: 2 }));
    dyn('label', panel(geo(), [135, bc[1] - PLATE.d / 2 - 0.6, -2.6], [118, 0, 0], [0, 0, 2.4], [0, -1, 0]));
    {
      const g = geo();
      box(g, -6, 270, -32, 276, 322, -14, 2);
      box(g, 112, 296, -40, 158, 314, -14, 2);
      dyn('carrier', g);
    }
    // The gantry, built round y = 0 and placed in front of the head it carries.
    {
      const g = geo();
      for (const dz of [-16, 16]) lathe(g, [[4.5, -189], [4.5, 189]], [135, 0, RAIL_Z + dz], 'x', 16);
      dyn('xbeam', g);
    }
    // The belt between the two rods: two strands into the carriage.
    dyn('xbelt', (() => { const g = geo(); for (const z of [RAIL_Z - 4.5, RAIL_Z + 4.5]) box(g, -54, 5, z - 2.5, 324, 6.6, z + 2.5, 0.4); return g; })());
    dyn('ycar', (() => { const g = geo(); box(g, -68, -22, RAIL_Z - 26, -44, 22, RAIL_Z + 26, 3); box(g, 314, -22, RAIL_Z - 26, 338, 22, RAIL_Z + 26, 3); return g; })());
    // The carriage: a white block, taller than wide, the head clipped on behind.
    dyn('carriage', slab(geo(), rrect(58, 36, 9, 6), [0, 0], RAIL_Z - 44, RAIL_Z + 40, { bevel: 6, steps: 3 }));
    dyn('carriageFace', panel(geo(), [0, -18.4, RAIL_Z - 2], [26, 0, 0], [0, 0, 39], [0, -1, 0]));
    // A toolhead, its nozzle tip at the origin.
    dyn('head', slab(geo(), rrect(HEAD.w, HEAD.d, 7, 6), [0, 0], 16, HEAD.h, { bevel: 4, steps: 3 }));
    dyn('headFace', panel(geo(), [0, -HEAD.d / 2 - 0.35, 56], [22, 0, 0], [0, 0, 39], [0, -1, 0]));
    {
      const g = geo();
      lathe(g, [[0, HEAD.h - 1], [6.5, HEAD.h - 1], [6.5, HEAD.h + 5], [5, HEAD.h + 7], [0, HEAD.h + 7]], [-HEAD.w / 2 + 9, -HEAD.d / 2 + 9, 0], 'z', 20);   // the knob on top
      box(g, -HEAD.w / 2 - 0.4, -HEAD.d / 2 - 0.5, 22, -HEAD.w / 2 + 3, -HEAD.d / 2 + 6, 92, 0.8);   // the stripes down the front edges
      box(g, HEAD.w / 2 - 3, -HEAD.d / 2 - 0.5, 22, HEAD.w / 2 + 0.4, -HEAD.d / 2 + 6, 92, 0.8);
      dyn('headYellow', g);
    }
    dyn('headLed', panel(geo(), [0, -HEAD.d / 2 - 0.5, 86], [5, 0, 0], [0, 0, 1.6], [0, -1, 0]));
    dyn('nozzle', lathe(geo(), [[0.5, 0], [2.6, 3], [3.6, 7], [5.5, 7.5], [5.5, 12]], [0, 0, 0], 'z', 24));
    dyn('block', box(geo(), -11, -12, 9, 11, 12, 17, 3));
    // A 1 kg spool on a hub, its axis along X through the origin.
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
    // The filament from each feeder's front to its spool (coloured live).
    [0, 1, 2, 3].forEach(i => {
      const s = i < 2 ? -1 : 1, wx = s < 0 ? x0 : x1, up = i % 2 === 0, fx = wx + s * 18, sx = wx + s * HUB.out;
      const to = up ? [sx, uy + 34, uz - 77] : [sx, ly + 82, lz + 16];
      dyn(`strand${i}`, tube(geo(), [[fx, 255, up ? 162 : 138], [(fx + sx) / 2, (255 + to[1]) / 2, ((up ? 162 : 138) + to[2]) / 2], to], 0.9, 6, 6));
    });
    dyn('blob', box(geo(), 80, 80, 0, 190, 190, 1, 0.3));
    return { statics, dynamic, DOOR };
  }
  return { build };
})();
