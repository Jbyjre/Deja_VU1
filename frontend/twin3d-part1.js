/* twin3d-part1.js: part 1 of 1 of twin3d.js, the twin's shapes, materials, maths and drawing helpers. Split out
 * of the one closure twin3d.js was (18 November 2026) so a session reads only the part it needs. Loaded before
 * twin3d.js, after the scripts before it; it hands its names on through Twin3DPart1. Holds: BED, BG_FS, BODY, DOCK,
 * ENVELOPE, FEED_LOAD_S, FEED_MM_S, FEED_UNLOAD_S, FONT, FS, GANTRY_DY, GB_FS, HEAD, HUB, ID_FS, INK_FS, LEAD_S,
 * MAT, NOMINAL_PRINT_MM_S, NO_LAMP, PLATE, POST_VS, RAIL_Z, SHADOW_FS, SHADOW_VS, SPOOL_R_MM, TIP, VIEWS, VS,
 * activeSpeed, advance, annulus, below, beltRun, box, buildTrack, canvasOf, carriageArt, circle, extrudingAt,
 * feedEvent, feedLength, feedSpeed, feederArt, flowAlpha, geo, headArt, labelArt, lampOf, lathe, lin, logoArt,
 * lookAt, mul, nearest, newFollow, norm, ortho, panel, perspective, plateArt, portsArt, posAt, prism, quadV, rrect,
 * screenArt, sideArt, slab, spoolTurn, srgb, syncFrom, timeAtByte, tri, tube, vert
 */
'use strict';
const Twin3DPart1 = (() => {
  /* ---- the machine, in millimetres ---------------------------------- */
  // The body: x0..x1 by y0..y1 below the shelf, out to yb above it (shelf
  // from zs up, with a curved underside of radius rs). About 456 x 499 x 458.
const BODY = { x0: -93, x1: 363, y0: -95, y1: 355, yb: 404, z0: 8, z1: 466, zs: 352, rs: 49, r: 35 };
const ENVELOPE = { x0: -157, x1: 427, y0: -95, y1: 404, z0: 0, z1: 730 };
const BED = 270, PLATE = { w: 276, d: 293 };
const TIP = 368;
const RAIL_Z = 420;
const GANTRY_DY = -34;
  // Docks sit level with the carriage, as a tool changer's must, so parked
  // heads stay inside the chamber below the rim (as in Snapmaker's picture,
  // where only their tube loops rise above the body).
const DOCK = { y: 304, tip: TIP, xs: [30, 100, 170, 240] };
const HEAD = { w: 54, d: 52, h: 96 };
  // Spool centres [y, z] on the side; how far a spool's centre sits out from the wall; the pocket's depth and radius.
const HUB = { upper: [196, 316], lower: [69, 133], out: 14.5, pocket: 24, R: 110 };
const VIEWS = { iso: [-32, 20], front: [0, 3], top: [0, 89], print: [-22, 40] };

const NO_LAMP = [0, 0, 0];
const srgb = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    return [0, 2, 4].map(i => Math.pow(parseInt(m[1].slice(i, i + 2), 16) / 255, 2.2));
  };
const lin = (r, g, b) => [r, g, b].map(v => Math.pow(v, 2.2));
  /* Materials: linear base colour, roughness, metalness, plus how it's drawn. */
const MAT = {
    body:     { c: lin(.89, .895, .9), r: .38, m: 0 },
    bodyIn:   { c: lin(.1, .1, .105), r: .7, m: 0 },   // the chamber is black in Snapmaker's photos
    pocket:   { c: lin(.84, .845, .85), r: .45, m: 0 },
    lid:      { c: lin(.66, .67, .69), r: .48, m: .05 },   // the grey top frame
    led:      { c: [1, 1, 1], r: .3, m: 0, glow: 1 },
    kraft:    { c: lin(.74, .58, .42), r: .86, m: 0 },   // Snapmaker's cardboard spools
    rim:      { c: lin(.05, .05, .055), r: .45, m: 0 },
    frame:    { c: lin(.07, .07, .075), r: .35, m: 0 },
    glass:    { c: lin(.2, .21, .22), r: .04, m: 0, a: .12, kind: 'glass' },   // clear enough to see the chamber, as in the picture
    bezel:    { c: lin(.04, .04, .045), r: .18, m: 0 },
    screen:   { c: [1, 1, 1], r: .12, m: 0, kind: 'tex', glow: 1 },
    decal:    { c: [1, 1, 1], r: .4, m: 0, kind: 'tex', a: .999 },
    head:     { c: lin(.05, .05, .055), r: .42, m: 0 },
    yellow:   { c: lin(.98, .71, .05), r: .35, m: 0 },
    window:   { c: lin(.7, .71, .73), r: .3, m: 0 },
    steel:    { c: lin(.78, .78, .8), r: .28, m: 1 },
    alu:      { c: lin(.72, .74, .77), r: .32, m: 1 },
    rail:     { c: lin(.2, .21, .23), r: .38, m: .7 },
    carbon:   { c: lin(.07, .07, .08), r: .25, m: .2, kind: 'carbon' },
    // Bronze-brown, sampled from Snapmaker's own photo of the U1 textured PEI plate (sRGB 109, 90, 76).
    pei:      { c: lin(.2, .115, .06), r: .78, m: 0, kind: 'pei' },
    hub:      { c: lin(.93, .935, .94), r: .34, m: 0 },
    tube:     { c: lin(.88, .78, .66), r: .22, m: 0, a: .72, kind: 'clear' },   // beige in the photos
    cable:    { c: lin(.04, .04, .045), r: .45, m: 0 },
    rearGlass: { c: lin(.2, .21, .22), r: .04, m: 0, a: .06, kind: 'glass' },
    rubber:   { c: lin(.03, .03, .03), r: .9, m: 0 },
    extrusion:{ c: lin(.62, .64, .67), r: .42, m: 1, kind: 'brushed' },   // anodised aluminium frame
    motor:    { c: lin(.06, .06, .065), r: .55, m: .2 },
    belt:     { c: lin(.05, .05, .055), r: .7, m: 0 },
    screw:    { c: lin(.8, .8, .82), r: .25, m: 1, kind: 'thread' },
    ghost:    { c: lin(.9, .91, .93), r: .3, m: 0, a: .16, kind: 'ghost' },  // the case, seen through
  };

  /* ---- geometry: interleaved position, normal, uv ------------------- */
function geo() { return { v: [] }; }
function vert(g, p, n, uv = [0, 0]) { g.v.push(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]); }
function tri(g, a, b, c) { vert(g, ...a); vert(g, ...b); vert(g, ...c); }
function quadV(g, a, b, c, d) { tri(g, a, b, c); tri(g, a, c, d); }
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

  /* A rounded rectangle as points with outward normals, counter-clockwise. */
function rrect(w, d, r, seg = 8) {
    r = Math.min(r, w / 2 - 0.01, d / 2 - 0.01);
    const pts = [], cs = [[w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, 90], [-w / 2 + r, -d / 2 + r, 180], [w / 2 - r, -d / 2 + r, 270]];
    for (const [cx, cy, a0] of cs) for (let i = 0; i <= seg; i++) {
      const a = (a0 + 90 * i / seg) * Math.PI / 180;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
    }
    return pts;
  }
function circle(r, seg = 32) {
    return Array.from({ length: seg }, (_, i) => { const a = i / seg * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r, Math.cos(a), Math.sin(a)]; });
  }
  /* Extrude a 2D outline from z0 to z1 with rounded (filleted) top and
   * bottom edges of radius `bevel`. Smooth normals all round. `inward`
   * turns it inside out (the inner walls of the body). */
function slab(g, pts, at, z0, z1, { bevel = 0, steps = 4, top = true, bottom = true, inward = false, topBevel = bevel, botBevel = bevel, skip = null } = {}) {
    const [ox, oy] = at, rings = [];
    const add = (k, z, nr, nz) => rings.push({ k, z, nr, nz });
    if (botBevel > 0) for (let i = 0; i <= steps; i++) { const t = (i / steps) * Math.PI / 2; add(botBevel * (1 - Math.sin(t)), z0 + botBevel - botBevel * Math.cos(t), Math.sin(t), -Math.cos(t)); }
    else add(0, z0, 1, 0);
    if (topBevel > 0) for (let i = 0; i <= steps; i++) { const t = (i / steps) * Math.PI / 2; add(topBevel * (1 - Math.cos(t)), z1 - topBevel + topBevel * Math.sin(t), Math.cos(t), Math.sin(t)); }
    else add(0, z1, 1, 0);
    const P = (p, ring) => [ox + p[0] - p[2] * ring.k, oy + p[1] - p[3] * ring.k, ring.z];
    const N = (p, ring) => { const n = norm([p[2] * ring.nr, p[3] * ring.nr, ring.nz]); return inward ? [-n[0], -n[1], -n[2]] : n; };
    const n = pts.length;
    for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < n; i++) {
      if (skip && skip(i, r)) continue;
      const p = pts[i], q = pts[(i + 1) % n], A = rings[r], B = rings[r + 1];
      const a = [P(p, A), N(p, A)], b = [P(q, A), N(q, A)], c = [P(q, B), N(q, B)], d = [P(p, B), N(p, B)];
      if (inward) quadV(g, a, d, c, b); else quadV(g, a, b, c, d);
    }
    const cap = (ring, up) => {
      const cx = ox, cy = oy, z = ring.z, nz = up ? 1 : -1;
      for (let i = 0; i < n; i++) {
        const p = P(pts[i], ring), q = P(pts[(i + 1) % n], ring);
        const c = [[cx, cy, z], [0, 0, nz]], a = [p, [0, 0, nz]], b = [q, [0, 0, nz]];
        if (up !== inward) tri(g, c, a, b); else tri(g, c, b, a);
      }
    };
    if (top) cap(rings[rings.length - 1], true);
    if (bottom) cap(rings[0], false);
    return g;
  }
  /* A flat ring between two outlines with the same number of points. */
function annulus(g, outer, inner, at, z, nz = 1) {
    const n = outer.length;
    for (let i = 0; i < n; i++) {
      const o0 = outer[i], o1 = outer[(i + 1) % n], i0 = inner[i], i1 = inner[(i + 1) % n];
      const P = p => [at[0] + p[0], at[1] + p[1], z], N = [0, 0, nz];
      if (nz > 0) quadV(g, [P(o0), N], [P(o1), N], [P(i1), N], [P(i0), N]);
      else quadV(g, [P(o0), N], [P(i0), N], [P(i1), N], [P(o1), N]);
    }
    return g;
  }
  /* Spin a profile [[radius, along], ...] round an axis through `c`. */
function lathe(g, prof, c, axis = 'x', seg = 40) {
    const put = (r, a, t) => {
      const u = Math.cos(a) * r, v = Math.sin(a) * r;
      return axis === 'x' ? [c[0] + t, c[1] + u, c[2] + v] : axis === 'y' ? [c[0] + u, c[1] + t, c[2] + v] : [c[0] + u, c[1] + v, c[2] + t];
    };
    const nrm = (a, nr, nt) => { const u = Math.cos(a) * nr, v = Math.sin(a) * nr; return axis === 'x' ? [nt, u, v] : axis === 'y' ? [u, nt, v] : [u, v, nt]; };
    for (let j = 0; j < prof.length - 1; j++) {
      const [r0, t0] = prof[j], [r1, t1] = prof[j + 1], dt = t1 - t0, dr = r1 - r0, l = Math.hypot(dt, dr) || 1;
      const nr = dt / l, nt = -dr / l;
      for (let i = 0; i < seg; i++) {
        const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
        quadV(g, [put(r0, a0, t0), nrm(a0, nr, nt)], [put(r0, a1, t0), nrm(a1, nr, nt)], [put(r1, a1, t1), nrm(a1, nr, nt)], [put(r1, a0, t1), nrm(a0, nr, nt)]);
      }
    }
    return g;
  }
  /* A tube along a smooth curve through `pts` (Catmull-Rom), radius r. */
function tube(g, pts, r, sides = 10, per = 8, along = false) {
    const path = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let s = 0; s < per; s++) {
        const t = s / per, t2 = t * t, t3 = t2 * t;
        path.push([0, 1, 2].map(k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
      }
    }
    path.push(pts[pts.length - 1]);
    // With `along`, UV.x is the distance from the start in mm: the filament overlay scrolls its dashes by it.
    const acc = [0];
    for (let i = 1; i < path.length; i++) acc.push(acc[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]));
    let prevN = null;
    const rings = path.map((p, i) => {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
      const T = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      let Nn = prevN || (Math.abs(T[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
      const d = Nn[0] * T[0] + Nn[1] * T[1] + Nn[2] * T[2];
      Nn = norm([Nn[0] - T[0] * d, Nn[1] - T[1] * d, Nn[2] - T[2] * d]); prevN = Nn;
      const B = [T[1] * Nn[2] - T[2] * Nn[1], T[2] * Nn[0] - T[0] * Nn[2], T[0] * Nn[1] - T[1] * Nn[0]];
      return Array.from({ length: sides }, (_, s) => {
        const a2 = s / sides * Math.PI * 2, c = Math.cos(a2), sn = Math.sin(a2);
        const n = [Nn[0] * c + B[0] * sn, Nn[1] * c + B[1] * sn, Nn[2] * c + B[2] * sn];
        const vertex = [[p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r], n];
        if (along) vertex.push([acc[i], 0]);
        return vertex;
      });
    });
    for (let i = 0; i < rings.length - 1; i++) for (let s = 0; s < sides; s++) {
      const s1 = (s + 1) % sides;
      quadV(g, rings[i][s], rings[i][s1], rings[i + 1][s1], rings[i + 1][s]);
    }
    return g;
  }
  /* A flat textured rectangle: centre, its two half-axes, its normal. */
function panel(g, c, u, v, n, uv = [0, 0, 1, 1]) {
    const P = (a, b) => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b, c[2] + u[2] * a + v[2] * b];
    quadV(g, [P(-1, -1), n, [uv[0], uv[3]]], [P(1, -1), n, [uv[2], uv[3]]], [P(1, 1), n, [uv[2], uv[1]]], [P(-1, 1), n, [uv[0], uv[1]]]);
    return g;
  }
function box(g, x0, y0, z0, x1, y1, z1, bevel = 1.2) {
    return slab(g, rrect(x1 - x0, y1 - y0, bevel, 2), [(x0 + x1) / 2, (y0 + y1) / 2], z0, z1, { bevel, steps: 2 });
  }
  /* The outline of an object on the plate (from the file), 1 mm tall. */
function prism(g, poly) {
    let area = 0;
    poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; area += p[0] * q[1] - q[0] * p[1]; });
    const pts = area < 0 ? poly.slice().reverse() : poly;
    const n = pts.length, cx = pts.reduce((s, p) => s + p[0], 0) / n, cy = pts.reduce((s, p) => s + p[1], 0) / n;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1, N = [dy / l, -dx / l, 0];
      quadV(g, [[p[0], p[1], 0], N], [[q[0], q[1], 0], N], [[q[0], q[1], 1], N], [[p[0], p[1], 1], N]);
      tri(g, [[cx, cy, 1], [0, 0, 1]], [[p[0], p[1], 1], [0, 0, 1]], [[q[0], q[1], 1], [0, 0, 1]]);
    }
    return g;
  }

  /* ---- textures drawn on canvases ------------------------------------ */
function canvasOf(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
const FONT = '"Instrument Sans", system-ui, sans-serif';
const logoArt = () => canvasOf(512, 96, (x, w, h) => {
    x.clearRect(0, 0, w, h); x.fillStyle = 'rgba(70,72,78,.9)'; x.font = `500 64px ${FONT}`; x.textBaseline = 'middle'; x.fillText('snapmaker', 8, h / 2 + 4);
  });
const labelArt = () => canvasOf(1024, 64, (x, w, h) => {
    x.fillStyle = '#e9eaec'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#3b3e44'; x.font = `600 30px ${FONT}`; x.textBaseline = 'middle'; x.textAlign = 'center';
    x.fillText('BUILD VOLUME   |   270 × 270 × 270 mm', w / 2, h / 2 + 2);
    x.fillStyle = '#f2b51b'; [w - 120, w - 80].forEach(cx => { x.beginPath(); x.arc(cx, h / 2, 13, 0, 7); x.fill(); });
  });
  /* The build plate's markings, as on Snapmaker's photo of the U1 textured PEI plate: a white
   * line on each of the four tabs along the back, the wordmark faintly in the middle, and the
   * plate's name with its materials and a hot-surface sign at the front. Back edge at the top. */
const plateArt = () => canvasOf(552, 586, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.strokeStyle = 'rgba(255,255,255,.92)'; x.lineWidth = 5; x.lineCap = 'round';
    [[0.06, 0.2], [0.305, 0.45], [0.55, 0.695], [0.795, 0.94]].forEach(([a, b]) => { x.beginPath(); x.moveTo(a * w, 0.022 * h); x.lineTo(b * w, 0.022 * h); x.stroke(); });
    x.fillStyle = 'rgba(255,240,228,.1)'; x.font = `500 58px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('snapmaker', w / 2, h / 2);
    x.fillStyle = 'rgba(255,255,255,.9)'; x.font = `600 15px ${FONT}`; x.textAlign = 'left';
    const y = 0.965 * h; x.fillText('PEI Coated PLATE', 0.29 * w, y);
    x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 1.5; x.strokeRect(0.53 * w, y - 9, 0.21 * w, 18);
    x.font = `500 12px ${FONT}`; x.fillText('PLA/ABS/PETG/TPU', 0.54 * w, y + 1);
    x.beginPath(); x.moveTo(0.25 * w, y - 9); x.lineTo(0.25 * w - 10, y + 8); x.lineTo(0.25 * w + 10, y + 8); x.closePath(); x.stroke();
  });
  /* The floor of the side pocket: vent holes in a fine grid where the two
   * spools leave it bare, as in the photos. Mapped over the side's y and z. */
const sideArt = () => canvasOf(1024, Math.round(1024 * (BODY.z1 - BODY.z0) / (BODY.y1 - BODY.y0)), (x, w, h) => {
    x.clearRect(0, 0, w, h);
    const k = w / (BODY.y1 - BODY.y0), kz = h / (BODY.z1 - BODY.z0), toPx = (y, z) => [(y - BODY.y0) * k, (BODY.z1 - z) * kz];
    const [ax, ay] = toPx(...HUB.upper), [bx, by] = toPx(...HUB.lower), R = (HUB.R - 4) * k;
    const ang = Math.atan2(by - ay, bx - ax);
    x.save();
    x.beginPath(); x.arc(ax, ay, R, ang + Math.PI / 2, ang + Math.PI * 1.5); x.arc(bx, by, R, ang - Math.PI / 2, ang + Math.PI / 2); x.closePath(); x.clip();
    // A soft shade where the wall meets the floor.
    x.lineWidth = 10 * k; x.strokeStyle = 'rgba(0,0,0,.08)'; x.stroke();
    const step = 5.5 * k, r = 1.25 * k, keep = (px, py) => Math.hypot(px - ax, py - ay) > 103 * k && Math.hypot(px - bx, py - by) > 103 * k;
    x.fillStyle = 'rgba(28,30,34,.62)';
    for (let py = 0; py < h; py += step) for (let px = (Math.round(py / step) % 2) * step / 2; px < w; px += step) {
      if (keep(px, py)) { x.beginPath(); x.arc(px, py, r, 0, 7); x.fill(); }
    }
    x.restore();
  });
const feederArt = () => canvasOf(256, 320, (x, w, h) => {
    x.fillStyle = '#eceef0'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#2a2c30'; x.font = `600 46px ${FONT}`; x.textBaseline = 'middle';
    [[1, 95], [2, 225]].forEach(([n, y]) => { x.fillText(`${n}·`, 46, y); x.beginPath(); x.arc(170, y, 22, 0, 7); x.fill(); });
    x.beginPath(); x.arc(120, 160, 16, 0, 7); x.lineWidth = 6; x.strokeStyle = '#2a2c30'; x.stroke();
  });
  /* A docked head's front: yellow edges, a status window with three lights,
   * a round button and the yellow hot-surface label low down. */
const headArt = () => canvasOf(128, 256, (x, w, h) => {
    x.fillStyle = '#121214'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#f4b417'; x.fillRect(0, 0, 8, h); x.fillRect(w - 8, 0, 8, h);
    x.fillStyle = '#2a2c31'; x.fillRect(34, 26, 60, 26);
    x.fillStyle = '#7ee08a'; [50, 64, 78].forEach(cx => { x.beginPath(); x.arc(cx, 39, 3.4, 0, 7); x.fill(); });
    x.strokeStyle = '#8c8f95'; x.lineWidth = 4; x.beginPath(); x.arc(64, 92, 12, 0, 7); x.stroke();
    x.fillStyle = '#a8abb1'; x.fillRect(44, 126, 40, 8);
    x.fillStyle = '#f4b417'; x.beginPath(); x.moveTo(64, 168); x.lineTo(92, 214); x.lineTo(36, 214); x.closePath(); x.fill();
    x.strokeStyle = '#121214'; x.lineWidth = 3; x.beginPath(); x.moveTo(64, 180); x.lineTo(84, 209); x.lineTo(44, 209); x.closePath(); x.stroke();
    x.beginPath(); x.moveTo(56, 204); x.quadraticCurveTo(60, 196, 56, 190); x.moveTo(64, 204); x.quadraticCurveTo(68, 196, 64, 190); x.moveTo(72, 204); x.quadraticCurveTo(76, 196, 72, 190); x.lineWidth = 2.5; x.stroke();
  });
  /* The carriage's front: white, the wordmark, and the orange fan. */
const carriageArt = () => canvasOf(256, 384, (x, w, h) => {
    x.fillStyle = '#eef0f2'; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(70,72,78,.85)'; x.font = `500 34px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('snapmaker', w / 2, 92);
    const cx = w / 2, cy = 236;
    x.fillStyle = '#d9dcdf'; x.beginPath(); x.arc(cx, cy, 82, 0, 7); x.fill();
    x.fillStyle = '#f39a12'; x.beginPath(); x.arc(cx, cy, 72, 0, 7); x.fill();
    x.strokeStyle = 'rgba(150,70,0,.55)'; x.lineWidth = 4;
    for (let i = 0; i < 24; i++) { const t = i / 24 * Math.PI * 2; x.beginPath(); x.moveTo(cx + Math.cos(t) * 40, cy + Math.sin(t) * 40); x.lineTo(cx + Math.cos(t + .35) * 70, cy + Math.sin(t + .35) * 70); x.stroke(); }
    x.fillStyle = '#ffb53a'; x.beginPath(); x.arc(cx, cy, 36, 0, 7); x.fill();
  });
  /* The back's lower corner: USB, network, the red switch and the socket. */
const portsArt = () => canvasOf(128, 384, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = '#1b1c1f'; x.fillRect(16, 20, 40, 26); x.fillRect(72, 18, 40, 32);
    x.fillStyle = '#e8b21a'; x.fillRect(24, 28, 24, 8);
    x.fillStyle = '#1b1c1f'; x.fillRect(30, 150, 68, 84);
    x.fillStyle = '#d0262b'; x.fillRect(40, 162, 48, 60);
    x.fillStyle = '#1b1c1f'; x.beginPath(); x.roundRect ? x.roundRect(18, 258, 92, 106, 8) : x.rect(18, 258, 92, 106); x.fill();
    x.fillStyle = '#3a3c41'; x.fillRect(38, 284, 52, 56);
    x.fillStyle = '#111'; [[50, 312], [64, 302], [78, 312]].forEach(([px, py]) => x.fillRect(px - 3, py - 8, 6, 16));
  });
  /* The touchscreen, redrawn from the printer's state. */
function screenArt(c, st) {
    const x = c.getContext('2d'), w = c.width, h = c.height;
    x.fillStyle = '#0d1424'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#1b2438'; x.fillRect(0, 0, w, 34);
    x.fillStyle = '#c8d3ea'; x.font = `600 18px ${FONT}`; x.textBaseline = 'middle';
    const now = new Date();
    x.fillText(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 14, 18);
    x.textAlign = 'right'; x.fillText(st && st.printer_name ? String(st.printer_name).slice(0, 22) : 'U1', w - 14, 18); x.textAlign = 'left';
    for (let i = 0; i < 3; i++) { x.fillStyle = '#1b2438'; x.fillRect(12, 50 + i * 62, 54, 52); x.fillStyle = '#5a6a8c'; x.fillRect(29, 66 + i * 62, 20, 20); }
    const heads = st && st.toolheads ? Object.entries(st.toolheads).slice(0, 4) : [];
    heads.forEach(([name, d], i) => {
      const cx = 118 + i * 96, on = st.active_toolhead === name;
      x.fillStyle = /^#[0-9a-f]{6}$/i.test(d.filament_color_hex || '') ? d.filament_color_hex : '#888';
      x.beginPath(); x.arc(cx, 78, 22, 0, 7); x.fill();
      if (on) { x.strokeStyle = '#ffffff'; x.lineWidth = 4; x.beginPath(); x.arc(cx, 78, 28, 0, 7); x.stroke(); }
      x.fillStyle = '#c8d3ea'; x.font = `600 16px ${FONT}`; x.textAlign = 'center';
      x.fillText(`${name} ${d.temperature != null ? Math.round(d.temperature) + '°' : ''}`, cx, 122); x.textAlign = 'left';
    });
    const word = st ? ({ printing: 'Printing', paused: 'Paused', error: 'Needs attention', complete: 'Finished', ready: 'Ready' }[st.state] || st.state) : 'Ready';
    x.fillStyle = '#ffffff'; x.font = `700 26px ${FONT}`; x.fillText(word, 92, 170);
    const pct = st && st.progress != null ? Math.round(st.progress * (st.progress <= 1 ? 100 : 1)) : null;
    if (st && (st.state === 'printing' || st.state === 'paused') && pct != null) {
      x.fillStyle = '#26324c'; x.fillRect(92, 196, w - 120, 12);
      x.fillStyle = st.state === 'paused' ? '#ffcc00' : '#3f8cff'; x.fillRect(92, 196, (w - 120) * Math.min(1, pct / 100), 12);
      x.fillStyle = '#c8d3ea'; x.font = `600 18px ${FONT}`; x.fillText(`${pct}%  ·  ${String(st.current_file || '').slice(0, 26)}`, 92, 232);
    } else {
      x.fillStyle = '#3f8cff'; x.beginPath(); x.roundRect ? x.roundRect(w - 150, h - 70, 120, 46, 23) : x.rect(w - 150, h - 70, 120, 46); x.fill();
      x.fillStyle = '#fff'; x.font = `700 20px ${FONT}`; x.textAlign = 'center'; x.fillText('Start', w - 90, h - 46); x.textAlign = 'left';
    }
  }

  /* ---- matrices ----------------------------------------------------- */
function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
function ortho(l, r, b, t, n, f) { return [2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]; }
function lookAt(e, c, up) {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2], l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx; l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1];
  }
function mul(a, b) {
    const o = new Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; }
    return o;
  }

  /* ---- shaders ------------------------------------------------------ */
const VS = `#version 300 es
  in vec3 aPos; in vec3 aNor; in vec2 aUV;
  uniform mat4 uVP; uniform mat4 uLVP; uniform vec3 uT; uniform vec3 uS; uniform float uRot;
  out vec3 vP; out vec3 vN; out vec2 vUV; out vec4 vL; out vec3 vW;
  void main() {
    float cr = cos(uRot), sr = sin(uRot);
    vec3 q = vec3(aPos.x, aPos.y * cr - aPos.z * sr, aPos.y * sr + aPos.z * cr);
    vec3 qn = vec3(aNor.x, aNor.y * cr - aNor.z * sr, aNor.y * sr + aNor.z * cr);
    vec3 p = q * uS + uT; vW = p;
    vP = vec3(p.x, p.z, -p.y);
    vec3 n = qn / uS; vN = normalize(vec3(n.x, n.z, -n.y));
    vUV = aUV; vL = uLVP * vec4(vP, 1.0);
    gl_Position = uVP * vec4(vP, 1.0);
  }`;
const FS = `#version 300 es
  precision highp float;
  in vec3 vP; in vec3 vN; in vec2 vUV; in vec4 vL; in vec3 vW;
  uniform vec3 uBase; uniform float uRough; uniform float uMetal; uniform float uAlpha; uniform float uGlow;
  uniform int uKind; uniform sampler2D uTex; uniform sampler2D uShadow; uniform vec3 uEye; uniform float uSel; uniform vec3 uBg;
  uniform vec3 uKey; uniform vec3 uFill; uniform vec4 uFoot;
  uniform vec2 uClip; uniform float uLayerH; uniform vec3 uBgTop; uniform vec3 uBgBot; uniform vec2 uRes; uniform float uPlay; uniform float uFlow; uniform vec3 uLamp;
  out vec4 outColor;
  const float PI = 3.14159265;
  /* The studio backdrop: lighter above, a soft vignette. The floor uses
     the same colour per pixel, so it melts into the backdrop with no edge. */
  vec3 backdrop(vec2 fc) {
    vec2 q = fc / uRes;
    vec3 c = mix(uBgBot, uBgTop, smoothstep(0.0, 1.0, q.y));
    float v = length((q - vec2(0.5, 0.56)) * vec2(1.0, 0.85));
    return c * (1.0 - 0.09 * smoothstep(0.3, 0.95, v));
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  /* A photo studio: a soft overhead box, a strip light each side, a pale
     sweep behind and a grey floor. Rougher surfaces see it more blurred. */
  vec3 env(vec3 d, float r) {
    float w = mix(0.015, 0.45, r);
    vec3 c = mix(vec3(0.46, 0.48, 0.52), vec3(0.92, 0.94, 0.97), smoothstep(-0.15, 0.85, d.y));
    c += vec3(2.6) * smoothstep(0.86 - w, 0.93 + w * 0.2, d.y);
    c += vec3(1.7) * smoothstep(0.82 - w, 0.88, dot(d, normalize(vec3(-0.92, 0.3, 0.25))));
    c += vec3(1.1) * smoothstep(0.84 - w, 0.9, dot(d, normalize(vec3(0.85, 0.22, 0.48))));
    c = mix(c, vec3(0.28, 0.285, 0.3), smoothstep(0.0, -0.25, d.y));
    return c;
  }
  float shadowAt(vec4 l, float bias) {
    vec3 p = l.xyz / l.w * 0.5 + 0.5;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
    float s = 0.0, t = 1.0 / float(textureSize(uShadow, 0).x);
    // Nine taps, spread wide, for a soft edge at a modest cost.
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
      float d = texture(uShadow, p.xy + vec2(i, j) * t * 2.2).r;
      s += p.z - bias > d ? 0.0 : 1.0;
    }
    return s / 9.0;
  }
  float ggx(float nh, float a) { float a2 = a * a; float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
  vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
  void main() {
    // The print grows to the nozzle's height (mode 1); its rest is drawn above (mode 2).
    // Following the G-code (uPlay >= 0), each bit of wall appears the moment
    // the file lays it: vUV.x is when, in seconds, and vUV.y marks it timed.
    bool timed = uPlay >= 0.0 && vUV.y > 0.5;
    if (uClip.x > 0.5 && uClip.x < 1.5 && (timed ? vUV.x > uPlay : vW.z > uClip.y)) discard;
    if (uClip.x > 1.5 && (timed ? vUV.x <= uPlay : vW.z <= uClip.y)) discard;
    vec3 N = normalize(vN), V = normalize(uEye - vP);
    if (uKind == 6) {
      // The floor: only the shadow and a soft contact darkening show.
      float sh = shadowAt(vL, 0.002);
      vec2 q = (vW.xy - uFoot.xy) / uFoot.zw;
      float ao = 1.0 - smoothstep(0.55, 1.15, length(q));
      vec3 c = backdrop(gl_FragCoord.xy) * (1.0 - 0.26 * (1.0 - sh) * (1.0 - smoothstep(0.7, 1.6, length(q))) - 0.22 * ao);
      outColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0); return;
    }
    if (dot(N, V) < 0.0) N = -N;
    vec3 base = uBase; float rough = uRough, alpha = uAlpha;
    if (uKind == 1) { vec4 t = texture(uTex, vUV); base = pow(t.rgb, vec3(2.2)); alpha = t.a * uAlpha; if (alpha < 0.02) discard; }
    // Fine surface patterns fade to their average where a cell is smaller than a
    // pixel; without it the bed's speckle crawled and flickered as the view turned.
    // The plate's fine grain: gentle, and already faded to its average before a grain shrinks to a pixel.
    if (uKind == 2) { vec2 q = vW.xy * 1.6; float aa = clamp(max(fwidth(q.x), fwidth(q.y)) * 2.0 - 0.25, 0.0, 1.0);
      float n = mix(hash(floor(q)), 0.5, aa); base *= 0.92 + 0.16 * n; rough = 0.72 + 0.12 * n; }
    if (uKind == 3) { float r = length(vW.yz - vec2(0.0)); }
    if (uKind == 4) { float l = fract(vW.z / 1.4); base *= 0.9 + 0.1 * smoothstep(0.1, 0.5, l) * smoothstep(0.9, 0.5, l); }
    if (uKind == 5) { float k = (vW.x + vW.y + vW.z) * 1.7, aa = clamp(fwidth(k) * 0.6 - 0.3, 0.0, 1.0);
      float w = mix(abs(sin(k)), 0.637, aa); base *= 0.85 + 0.3 * w; }
    if (uKind == 7) { float rr = length(vW.yz - uFoot.xy); base *= 0.86 + 0.14 * smoothstep(0.3, 0.7, fract(rr / 1.75)); }
    if (uKind == 9) {
      // Printed plastic: a faint ridge per layer, fading out where layers
      // are finer than a pixel (no shimmer when zoomed out).
      float t = vW.z / uLayerH, f = fract(t), aa = clamp(fwidth(t) * 1.4, 0.0, 1.0);
      float ridge = smoothstep(0.0, 0.3, f) * smoothstep(1.0, 0.7, f);
      base *= mix(0.8 + 0.2 * ridge, 0.92, aa); rough = 0.48;
    }
    if (uKind == 11) { float k = vW.z * 3.0, aa = clamp(fwidth(k) * 1.5 - 0.5, 0.0, 1.0);
      float n = mix(hash(vec2(floor(k + vW.x * 0.02), floor((vW.x + vW.y) * 0.5))), 0.5, aa); base *= 0.93 + 0.1 * n; }
    if (uKind == 12) { base *= 0.72 + 0.28 * smoothstep(0.15, 0.85, abs(fract(vW.z / 2.0) * 2.0 - 1.0)); }
    if (uKind == 13) {
      // Filament moving in its tube: short bright dashes, scrolled along the tube by uFlow (mm run so far).
      float d = fract((vUV.x - uFlow) / 9.0);
      alpha = smoothstep(0.0, 0.1, d) * smoothstep(0.62, 0.4, d) * uAlpha;
      if (alpha < 0.03) discard;
      base += vec3(0.05);
    }
    if (uKind == 14) {
      // A belt: a tooth pattern (stylised, 5 mm apart) that has run uFlow mm along the strand.
      float t = ((uFoot.x > 0.5 ? vW.y : vW.x) - uFlow) / 5.0, f = fract(t), aa = clamp(fwidth(t) * 1.5, 0.0, 1.0);
      float tooth = smoothstep(0.0, 0.12, f) * smoothstep(0.62, 0.5, f);
      base += vec3(0.075) * tooth * (1.0 - aa);
    }
    vec3 F0 = mix(vec3(0.04), base, uMetal);
    vec3 col = vec3(0.0);
    float sh = shadowAt(vL, 0.0025);
    vec3 lights[2]; lights[0] = uKey; lights[1] = uFill;
    float pow2[2]; pow2[0] = 2.4; pow2[1] = 0.7;
    float a = max(0.04, rough * rough);
    for (int i = 0; i < 2; i++) {
      vec3 L = normalize(lights[i]), H = normalize(L + V);
      float nl = max(dot(N, L), 0.0), nh = max(dot(N, H), 0.0), vh = max(dot(V, H), 0.0);
      vec3 F = F0 + (1.0 - F0) * pow(1.0 - vh, 5.0);
      float k = (rough + 1.0) * (rough + 1.0) / 8.0;
      float G = (nl / (nl * (1.0 - k) + k)) * (max(dot(N, V), 0.0) / (max(dot(N, V), 0.0) * (1.0 - k) + k));
      vec3 spec = F * ggx(nh, a) * G / max(4.0 * nl * max(dot(N, V), 0.0), 0.001);
      vec3 diff = (1.0 - F) * (1.0 - uMetal) * base / PI;
      float s = i == 0 ? sh : 1.0;
      col += (diff + spec) * nl * pow2[i] * s * PI;
    }
    vec3 R = reflect(-V, N);
    vec3 Fv = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    col += (1.0 - uMetal) * base * env(N, 1.0) * 0.36 * (0.55 + 0.45 * sh);
    col += Fv * env(R, rough) * mix(0.55, 1.0, sh) * (uKind == 0 && uMetal < 0.5 ? 0.55 : 0.9);
    // The chamber light (the printer's cavity LED), on what sits inside the case.
    col += (base + vec3(0.03)) * uLamp * 2.6;
    if (uGlow > 0.0) col = mix(col, base * 1.25, uGlow);
    // Picked: a blue glow round its edges, so its own colour stays true.
    if (uSel > 0.0) { float fr = pow(1.0 - max(dot(N, V), 0.0), 2.0); col = col * (1.0 + 0.1 * uSel) + vec3(0.1, 0.32, 1.0) * (0.12 + 0.75 * fr) * uSel; }
    // The plastic just laid reads a touch brighter: fresh, still warm. Following
    // the G-code it fades over the last few seconds behind the nozzle.
    if (uKind == 9 && uClip.x > 0.5 && uClip.x < 1.5) {
      if (timed) { float age = uPlay - vUV.x; if (age < 3.0) col += (base * 0.35 + vec3(0.03)) * (1.0 - age / 3.0); }
      else if (vW.z > uClip.y - uLayerH * 1.01) col += base * 0.35 + vec3(0.03);
    }
    if (uKind == 10) { // the case, see-through: an outline of light, no body
      float f = pow(1.0 - max(dot(N, V), 0.0), 3.0);
      col = mix(col, env(R, 0.25), 0.55);
      alpha = clamp(uAlpha + f * 0.42, 0.0, 0.75);
    }
    if (uKind == 8) { // glass: mostly reflection, a little tint
      float f = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
      col = base * 0.35 + env(R, 0.03) * (0.06 + 0.88 * f);
      alpha = clamp(uAlpha + f * 0.45, 0.0, 1.0);
    }
    outColor = vec4(pow(aces(col * 0.95), vec3(1.0 / 2.2)), alpha);
  }`;
const SHADOW_VS = `#version 300 es
  in vec3 aPos; in vec2 aUV; uniform mat4 uLVP; uniform vec3 uT; uniform vec3 uS; uniform float uRot; out float vZ; out vec2 vT;
  void main() { float cr = cos(uRot), sr = sin(uRot); vec3 q = vec3(aPos.x, aPos.y * cr - aPos.z * sr, aPos.y * sr + aPos.z * cr); vec3 p = q * uS + uT; vZ = p.z; vT = aUV; gl_Position = uLVP * vec4(p.x, p.z, -p.y, 1.0); }`;
const SHADOW_FS = `#version 300 es
  precision highp float; in float vZ; in vec2 vT; uniform vec2 uClip; uniform float uPlay; out vec4 o;
  void main() { if (uClip.x > 0.5 && ((uPlay >= 0.0 && vT.y > 0.5) ? vT.x > uPlay : vZ > uClip.y)) discard; o = vec4(1.0); }`;
  /* The drawing's first pass: surface direction and part id, per pixel. */
const GB_FS = `#version 300 es
  precision highp float;
  in vec3 vN; in vec3 vW; in vec2 vUV; uniform float uId; uniform vec2 uClip; uniform float uPlay; out vec4 o;
  void main() { if (uClip.x > 0.5 && ((uPlay >= 0.0 && vUV.y > 0.5) ? vUV.x > uPlay : vW.z > uClip.y)) discard; o = vec4(normalize(vN) * 0.5 + 0.5, uId / 255.0); }`;
  /* Picking: each pickable part paints its id. */
const ID_FS = `#version 300 es
  precision highp float; in vec3 vW; in vec2 vUV; uniform float uId; uniform vec2 uClip; uniform float uPlay; out vec4 o;
  void main() { if (uClip.x > 0.5 && ((uPlay >= 0.0 && vUV.y > 0.5) ? vUV.x > uPlay : vW.z > uClip.y)) discard; o = vec4(uId / 255.0, 0.0, 0.0, 1.0); }`;
const BG_FS = `#version 300 es
  precision highp float; uniform vec3 uBgTop; uniform vec3 uBgBot; uniform vec2 uRes; out vec4 o;
  void main() {
    vec2 q = gl_FragCoord.xy / uRes;
    vec3 c = mix(uBgBot, uBgTop, smoothstep(0.0, 1.0, q.y));
    c *= 1.0 - 0.09 * smoothstep(0.3, 0.95, length((q - vec2(0.5, 0.56)) * vec2(1.0, 0.85)));
    o = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
  }`;
const POST_VS = `#version 300 es
  out vec2 vUV; void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
  /* The drawing's ink: an edge wherever depth jumps, the surface turns
     sharply, or one part meets another. Picked parts ink blue, faults red. */
const INK_FS = `#version 300 es
  precision highp float;
  in vec2 vUV; uniform sampler2D uG; uniform sampler2D uD; uniform vec2 uPx; uniform float uSelId; uniform float uFaultMask[8]; uniform float uDepthK; uniform vec3 uToolCol[4];
  out vec4 o;
  float depthAt(vec2 uv) { return texture(uD, uv).r; }
  void main() {
    vec4 g = texture(uG, vUV); float d = depthAt(vUV);
    float edge = 0.0, idEdge = 0.0, idHere = floor(g.a * 255.0 + 0.5), selEdge = 0.0, faultEdge = 0.0;
    for (int i = 0; i < 8; i++) {
      vec2 off = vec2(i == 0 ? 1.0 : i == 1 ? -1.0 : i == 4 ? 1.0 : i == 5 ? -1.0 : i == 6 ? 1.0 : i == 7 ? -1.0 : 0.0,
                      i == 2 ? 1.0 : i == 3 ? -1.0 : i == 4 ? 1.0 : i == 5 ? -1.0 : i == 6 ? -1.0 : i == 7 ? 1.0 : 0.0) * uPx;
      vec4 g2 = texture(uG, vUV + off); float d2 = depthAt(vUV + off);
      float dz = abs(d2 - d) * uDepthK;
      float nn = dot(g.rgb * 2.0 - 1.0, g2.rgb * 2.0 - 1.0);
      float id2 = floor(g2.a * 255.0 + 0.5);
      float e = max(smoothstep(0.004, 0.012, dz), smoothstep(0.88, 0.6, nn));
      // The print (ids 200 and up, one per head): its outline only, not every layer's wall.
      if (idHere > 199.5 && id2 == idHere) e = smoothstep(0.03, 0.08, dz);
      if (id2 != idHere) e = 1.0;
      if (d >= 0.9999 && d2 >= 0.9999) e = 0.0;
      edge = max(edge, e);
      if (e > 0.5 && (idHere == uSelId || id2 == uSelId) && uSelId > 0.5) selEdge = 1.0;
    }
    vec3 paper = vec3(1.0);
    vec3 fill = d < 0.9999 ? mix(vec3(0.955), vec3(0.985), clamp(g.b * 1.2 - 0.1, 0.0, 1.0)) : paper;
    if (d < 0.9999 && idHere > 199.5 && idHere < 203.5) fill = mix(vec3(1.0), uToolCol[int(idHere - 200.0)], 0.55);   // the print, washed in its colour
    if (d < 0.9999 && idHere == uSelId && uSelId > 0.5) fill = mix(fill, vec3(0.82, 0.88, 1.0), 0.6);
    vec3 ink = selEdge > 0.5 ? vec3(0.16, 0.36, 0.92) : vec3(0.13, 0.14, 0.17);
    o = vec4(mix(fill, ink, edge), 1.0);
  }`;

  /* ---- the viewer --------------------------------------------------- */
  /* ---- following the print's own G-code ------------------------------
   * The timeline (backend/print_preview.py) says, for points through the
   * file, which byte they end at, when they happen (seconds of nominal
   * print time) and where the nozzle is. Each reading from the printer
   * gives the byte it has read up to (Klipper's file_position) and, on a
   * real printer, where the nozzle is right now (motion_report
   * live_position). The nozzle is looked for along the path just before
   * the byte read, which pins down the exact moment in the file; between
   * readings the playhead runs along the G-code at the speed the printer
   * has been keeping, and each reading pulls it back into step over a
   * third of a second (a jump only when it is more than a few seconds
   * out). Moves the file doesn't hold (a tool change, homing, a pause
   * park) don't match the path: then the nozzle simply follows the
   * printer's live position until it rejoins the path. */
const newFollow = () => ({ track: null, on: false, play: 0, rate: 1, pending: 0, last: 0, prevM: null, prevW: 0, tRead: 0, off: false,
                             live: null, pos: [135, 135, 0], started: false, err: null, paused: false, matched: 0, readings: 0 });
function buildTrack(tl, along, k) {
    if (!tl || !Array.isArray(tl.track) || tl.track.length < 10 || !(tl.bytes > 0)) return null;
    const n = Math.floor(tl.track.length / 5), B = new Float64Array(n), T = new Float64Array(n);
    const pts = new Float64Array(n * 4 + along.length);
    let b = 0, t = 0, x = 0, y = 0, z = 0;
    for (let i = 0; i < n; i++) {
      b += tl.track[i * 5]; t += tl.track[i * 5 + 1]; x += tl.track[i * 5 + 2]; y += tl.track[i * 5 + 3]; z += tl.track[i * 5 + 4];
      B[i] = b; T[i] = t / 1000;
      pts[i * 4] = t / 1000; pts[i * 4 + 1] = x * k; pts[i * 4 + 2] = y * k; pts[i * 4 + 3] = z * k;
    }
    pts.set(along, n * 4);
    // Every point in time order, keyframes and path points together.
    const m = pts.length / 4, order = new Uint32Array(m);
    for (let i = 0; i < m; i++) order[i] = i;
    order.sort((a, c) => pts[a * 4] - pts[c * 4]);
    const P = { T: new Float64Array(m), X: new Float32Array(m), Y: new Float32Array(m), Z: new Float32Array(m) };
    for (let i = 0; i < m; i++) { const o = order[i] * 4; P.T[i] = pts[o]; P.X[i] = pts[o + 1]; P.Y[i] = pts[o + 2]; P.Z[i] = pts[o + 3]; }
    // Stretches of extrusion, sent as [gap, length, gap, length, ...] in milliseconds: when the file has
    // the nozzle laying plastic (the glow at its tip), as opposed to travelling.
    let ex = null;
    if (Array.isArray(tl.extrusion) && tl.extrusion.length >= 2) {
      const runs = Math.floor(tl.extrusion.length / 2), S = new Float64Array(runs), E = new Float64Array(runs);
      let at = 0;
      for (let i = 0; i < runs; i++) { at += tl.extrusion[i * 2]; S[i] = at / 1000; at += tl.extrusion[i * 2 + 1]; E[i] = at / 1000; }
      ex = { S, E };
    }
    return { B, T, P, ex, bytes: tl.bytes, seconds: tl.seconds || T[n - 1] };
  }
  // Is the file extruding at time t (seconds)? null when the file's extrusion isn't known.
function extrudingAt(tr, t) {
    if (!tr || !tr.ex) return null;
    const i = below(tr.ex.S, t);
    return i >= 0 && t <= tr.ex.E[i];
  }
  // The last index whose value is <= v.
const below = (arr, v) => { let lo = 0, hi = arr.length - 1; if (hi < 0 || v < arr[0]) return -1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (arr[mid] <= v) lo = mid; else hi = mid - 1; } return lo; };
function timeAtByte(tr, byte) {
    const i = below(tr.B, byte);
    if (i < 0) return 0;
    if (i >= tr.B.length - 1) return tr.T[tr.T.length - 1];
    const f = (byte - tr.B[i]) / Math.max(1, tr.B[i + 1] - tr.B[i]);
    return tr.T[i] + (tr.T[i + 1] - tr.T[i]) * Math.max(0, Math.min(1, f));
  }
function posAt(tr, t) {
    const P = tr.P, i = below(P.T, t);
    if (i < 0) return [P.X[0], P.Y[0], P.Z[0]];
    if (i >= P.T.length - 1) return [P.X[i], P.Y[i], P.Z[i]];
    const span = P.T[i + 1] - P.T[i], f = span > 1e-6 ? Math.max(0, Math.min(1, (t - P.T[i]) / span)) : 1;
    return [P.X[i] + (P.X[i + 1] - P.X[i]) * f, P.Y[i] + (P.Y[i + 1] - P.Y[i]) * f, P.Z[i] + (P.Z[i + 1] - P.Z[i]) * f];
  }
  // Where along the path, between two times, the nozzle at p is: {t, d (mm)}. Height counts four times over.
function nearest(tr, p, t0, t1) {
    const P = tr.P;
    let i = Math.max(0, below(P.T, t0)), best = null;
    const last = Math.min(P.T.length - 1, Math.max(i + 1, below(P.T, t1) + 1));
    for (; i < last; i++) {
      const ax = P.X[i], ay = P.Y[i], az = P.Z[i], bx = P.X[i + 1] - ax, by = P.Y[i + 1] - ay, bz = (P.Z[i + 1] - az) * 4;
      const px = p[0] - ax, py = p[1] - ay, pz = (p[2] - az) * 4, ll = bx * bx + by * by + bz * bz;
      const f = ll > 1e-9 ? Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / ll)) : 0;
      const d = Math.hypot(px - bx * f, py - by * f, pz - bz * f);
      // Ties go to the later point: the printer is as far on as it can be.
      if (!best || d <= best.d + 1e-6) best = { d, t: P.T[i] + (P.T[i + 1] - P.T[i]) * f };
    }
    return best;
  }
const LEAD_S = 0.8;
function syncFrom(follow, st, file, now) {
    const tr = follow.track;
    const printing = st && ['printing', 'paused'].includes(st.state);
    if (!tr || !st || file !== st.current_file || !printing) { follow.on = false; return; }
    const sync = st.sync || {};
    const byte = typeof sync.file_position === 'number' && sync.file_size === tr.bytes ? sync.file_position
      : (typeof st.progress === 'number' ? st.progress * tr.bytes : null);
    if (byte == null) { follow.on = false; return; }
    const tRead = timeAtByte(tr, byte);
    let m = null;
    follow.readings++;
    follow.hasLive = Array.isArray(sync.live);
    if (follow.hasLive) {
      const hit = nearest(tr, sync.live, tRead - 12, tRead + 0.5);
      if (hit && hit.d < 2.5) { m = hit.t; follow.off = false; follow.matched++; follow.err = hit.d; }
      else { follow.off = true; follow.live = sync.live.slice(0, 3); follow.err = hit ? hit.d : null; }
    } else {
      m = Math.max(0, tRead - (st.real ? LEAD_S : 0)); follow.off = false; follow.err = null;
    }
    follow.tRead = tRead;
    follow.paused = st.state === 'paused';
    follow.on = true;
    if (m == null) return;
    if (!follow.started || Math.abs(m - follow.play) > 5) {
      follow.play = m; follow.pending = 0; follow.started = true; follow.prevM = null;
      follow.pos = posAt(tr, m);
    } else {
      follow.pending = m - follow.play;
    }
    // The pace the printer keeps against the file's own (acceleration, speed factor, limits).
    if (follow.prevM != null && !follow.paused) {
      const dw = (now - follow.prevW) / 1000;
      if (dw > 0.15 && dw < 5) {
        // A real printer keeps within a few times the file's own pace; a simulated one (the online demo runs
        // prints at 12x so a visitor sees them move) may go much faster.
        const r = Math.max(0, Math.min(st.real ? 3 : 20, (m - follow.prevM) / dw));
        follow.rate += 0.3 * (r - follow.rate);
      }
    }
    follow.prevM = m; follow.prevW = now;
  }
function advance(follow, now) {
    const tr = follow.track, dt = Math.min(0.25, Math.max(0, (now - (follow.last || now)) / 1000));
    follow.last = now;
    if (!tr || !follow.on) return;
    if (follow.off && follow.live) {
      const a = 1 - Math.exp(-dt / 0.12);
      follow.pos = follow.pos.map((v, i) => v + (follow.live[i] - v) * a);
      return;
    }
    if (!follow.paused) follow.play += follow.rate * dt;
    const c = follow.pending * (1 - Math.exp(-dt / 0.3));
    follow.play += c; follow.pending -= c;
    follow.play = Math.max(0, Math.min(follow.play, follow.tRead + 0.05));
    follow.pos = posAt(tr, follow.play);
  }

  /* ---- what the filament, spools, belts and lights do, from the printer's own readings ----
   * Pure functions (tests/test_twin_fx.py runs them in Node). The printer reports the extruder's speed, each
   * head's filament sensor, the chamber LED and where the head is; it reports no feeder speed, so a load or
   * an unload is drawn as a smooth push or pull of a typical size, begun by the sensor changing (or by the
   * Feed button) and never longer than a few seconds. */
const FEED_MM_S = 25, FEED_LOAD_S = 7, FEED_UNLOAD_S = 6, SPOOL_R_MM = 65, NOMINAL_PRINT_MM_S = 2;
  // A head's filament sensor changed: filament arrived (a load) or left (an unload).
function feedEvent(was, now) {
    if (was === false && now === true) return 'load';
    if (was === true && now === false) return 'unload';
    return null;
  }
const feedLength = mode => (mode === 'load' ? FEED_LOAD_S : FEED_UNLOAD_S);
  // Filament speed (mm/s, positive toward the nozzle) t seconds into a feed: eases in, runs, eases out.
function feedSpeed(mode, t) {
    const len = feedLength(mode);
    if (!(t >= 0) || t > len) return 0;
    return (mode === 'load' ? 1 : -1) * FEED_MM_S * Math.min(1, Math.sin(Math.PI * t / len) * 1.6);
  }
  // The working head's filament speed: the printer's own reading when it gives one; else a typical 2 mm/s
  // while a print is laying plastic (the simulated printers give no reading).
function activeSpeed(st, extruding) {
    if (typeof st.extruder_velocity === 'number') return st.extruder_velocity;
    return extruding ? NOMINAL_PRINT_MM_S : 0;
  }
const flowAlpha = v => (Math.abs(v) > 0.05 ? Math.min(0.92, 0.35 + Math.abs(v) / 8) : 0);
const spoolTurn = (v, dt) => v * dt / SPOOL_R_MM;
  // How far each CoreXY belt has run: the two motors' displacements, A = x + y and B = x - y (mm).
const beltRun = (x, y) => ({ a: x + y, b: x - y });
  // The chamber light from the LED the printer reports (RGBW, 0 to 1): a tint scaled by its strength, or null.
function lampOf(st) {
    const leds = (st && st.tuning && st.tuning.leds) || [];
    const led = leds.find(l => /cavity|chamber/i.test(l.id || '')) || leds[0];
    if (!led || !Array.isArray(led.color)) return null;
    const [r, g, b, w] = led.color.map(v => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : 0));
    const k = Math.max(r, g, b, w);
    if (k < 0.02) return null;
    return { k, rgb: [Math.min(1, r + w) * 0.45 * k, Math.min(1, g + w) * 0.42 * k, Math.min(1, b + w) * 0.36 * k] };
  }
  return { BED, BG_FS, BODY, DOCK, ENVELOPE, FS, GANTRY_DY, GB_FS, HEAD, HUB, ID_FS, INK_FS, MAT, NO_LAMP, PLATE,
    POST_VS, RAIL_Z, SHADOW_FS, SHADOW_VS, TIP, VIEWS, VS, activeSpeed, advance, annulus, beltRun, box, buildTrack,
    canvasOf, carriageArt, circle, extrudingAt, feedEvent, feedLength, feedSpeed, feederArt, flowAlpha, geo,
    headArt, labelArt, lampOf, lathe, lin, logoArt, lookAt, mul, nearest, newFollow, norm, ortho, panel,
    perspective, plateArt, portsArt, posAt, prism, quadV, rrect, screenArt, sideArt, slab, spoolTurn, srgb,
    syncFrom, timeAtByte, tri, tube };
})();
