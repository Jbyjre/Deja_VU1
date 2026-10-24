/* Deja Vu1 - the digital twin: a detailed 3D model of the Snapmaker U1.
 *
 * Plain JavaScript and WebGL 2, no library. One scene, drawn two ways:
 *   - Model: shaded like a product photo. Studio lighting with reflections,
 *     soft shadows, glossy white plastic, smoked glass, metal, carbon fibre
 *     and a textured PEI plate.
 *   - Drawing: an engineering drawing made from the same geometry: ink edges
 *     found from depth and surface direction, an orthographic view, the build
 *     volume as a phantom line, live dimensions, balloons and a title block.
 * Both follow the live printer: the head on the gantry, the bed dropping as
 * Z rises, idle heads in the rear docks, the spools in the loaded colours,
 * the parts growing on the plate, the touchscreen showing the printer's state.
 *
 * Where the shapes come from:
 * - Snapmaker's official product picture of the U1 (shipped with Snapmaker's
 *   Orca slicer profile): the white rounded body with a black rim around the
 *   open top, the framed smoked-glass door with its handle and hinge screws,
 *   the touchscreen above the door right of centre, the wordmark, the side panel's tilted oval
 *   with two spool drums and perforated vents, the side feeder marked 1 and 2,
 *   four black toolheads with yellow accents parked at the back inside the
 *   chamber (level with the carriage; only their loops rise above), each with a
 *   tall loop of filament tube, and the bed's "BUILD VOLUME" strip.
 * - Snapmaker's slicer profile: a 276 x 293 mm textured PEI plate and a
 *   270 mm print height. Snapmaker's spec: 584 x 499 x 730 mm overall.
 * - Reviews: CoreXY, carbon-fibre rods on the X axis, docks at the rear,
 *   two spools a side.
 * - Estimated from the picture (labelled so in the card): the body is about
 *   390 x 460 x 480 mm, so the spool drums make up the 584 mm width and the
 *   tube loops the 730 mm height. Dock spacing, which side feeds which head,
 *   and the inside layout are drawn by eye.
 *
 * Coordinates are the printer's own millimetres (X right, Y back, Z up); the
 * bed's printable corner is 0, 0. WebGL's axes are used only in the shaders.
 */
'use strict';

const Twin3D = (() => {
  /* ---- the machine, in millimetres ---------------------------------- */
  const BODY = { x0: -60, x1: 330, y0: -95, y1: 365, z0: 8, z1: 488, r: 46 };   // about 390 x 460 x 480
  const ENVELOPE = { x0: -157, x1: 427, y0: -95, y1: 404, z0: 0, z1: 730 };      // 584 x 499 x 730 published
  const BED = 270, PLATE = { w: 276, d: 293 };
  const TIP = 375;                    // nozzle tip height when Z is 0
  const RAIL_Z = 452;                 // the gantry
  // Docks sit level with the carriage, as a tool changer's must, so parked
  // heads stay inside the chamber below the rim (as in Snapmaker's picture,
  // where only their tube loops rise above the body).
  const DOCK = { y: 316, tip: TIP, xs: [18, 76, 134, 192] };
  const HEAD = { w: 54, d: 52, h: 96 };
  const HUB = { upper: [245, 341], lower: [115, 142] };   // side-panel spool positions: [y, z]
  const VIEWS = { iso: [-32, 20], front: [0, 3], top: [0, 89], print: [-22, 40] };

  const srgb = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    return [0, 2, 4].map(i => Math.pow(parseInt(m[1].slice(i, i + 2), 16) / 255, 2.2));
  };
  const lin = (r, g, b) => [r, g, b].map(v => Math.pow(v, 2.2));
  /* Materials: linear base colour, roughness, metalness, plus how it's drawn. */
  const MAT = {
    body:     { c: lin(.89, .895, .9), r: .38, m: 0 },
    bodyIn:   { c: lin(.46, .47, .49), r: .8, m: 0 },   // the chamber reads lit in the picture
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
    pei:      { c: lin(.2, .2, .21), r: .75, m: 0, kind: 'pei' },
    hub:      { c: lin(.93, .935, .94), r: .3, m: 0, a: .88, kind: 'clear' },
    tube:     { c: lin(.86, .87, .95), r: .2, m: 0, a: .7, kind: 'clear' },
    cable:    { c: lin(.04, .04, .045), r: .45, m: 0 },
    flange:   { c: lin(.06, .06, .07), r: .3, m: 0, a: .82, kind: 'clear' },
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
  function tube(g, pts, r, sides = 10, per = 8) {
    const path = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let s = 0; s < per; s++) {
        const t = s / per, t2 = t * t, t3 = t2 * t;
        path.push([0, 1, 2].map(k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
      }
    }
    path.push(pts[pts.length - 1]);
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
        return [[p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r], n];
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
  /* The side panel: a tilted oval groove with two triangles of vent holes. */
  const sideArt = () => canvasOf(1024, 1068, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    const k = w / (BODY.y1 - BODY.y0), kz = h / (BODY.z1 - BODY.z0), toPx = (y, z) => [(y - BODY.y0) * k, (BODY.z1 - z) * kz];
    const [ax, ay] = toPx(...HUB.upper), [bx, by] = toPx(...HUB.lower), R = 112 * k;
    const ang = Math.atan2(by - ay, bx - ax);
    const stadium = (r) => { x.beginPath(); x.arc(ax, ay, r, ang + Math.PI / 2, ang + Math.PI * 1.5); x.arc(bx, by, r, ang - Math.PI / 2, ang + Math.PI / 2); x.closePath(); };
    x.lineWidth = 5; x.strokeStyle = 'rgba(0,0,0,.16)'; stadium(R); x.stroke();
    x.lineWidth = 3; x.strokeStyle = 'rgba(255,255,255,.75)'; stadium(R - 4); x.stroke();
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    x.fillStyle = 'rgba(0,0,0,.28)';
    for (const side of [-1, 1]) for (let r = 0; r < 9; r++) for (let c = 0; c <= r; c++) {
      const u = (c - r / 2) * 11, v = r * 11, px = mx + side * 38 * Math.cos(ang) + u * Math.cos(ang + Math.PI / 2) * 1 + (side > 0 ? v : -v) * Math.cos(ang) * .2;
      const py = my + (side > 0 ? -1 : 1) * (60 + v) + u * .2;
      x.beginPath(); x.arc(px, py, 2.6, 0, 7); x.fill();
    }
  });
  const feederArt = () => canvasOf(256, 320, (x, w, h) => {
    x.fillStyle = '#eceef0'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#2a2c30'; x.font = `600 46px ${FONT}`; x.textBaseline = 'middle';
    [[1, 95], [2, 225]].forEach(([n, y]) => { x.fillText(`${n}·`, 46, y); x.beginPath(); x.arc(170, y, 22, 0, 7); x.fill(); });
    x.beginPath(); x.arc(120, 160, 16, 0, 7); x.lineWidth = 6; x.strokeStyle = '#2a2c30'; x.stroke();
  });
  const headArt = () => canvasOf(128, 256, (x, w, h) => {
    x.fillStyle = '#121214'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#b9bbc0'; x.fillRect(30, 30, 68, 34);
    x.fillStyle = '#4b4d52'; x.fillRect(46, 40, 36, 14);
    x.strokeStyle = '#8c8f95'; x.lineWidth = 5; x.beginPath(); x.arc(64, 112, 15, 0, 7); x.stroke();
    x.fillStyle = '#f4b417'; x.fillRect(0, 0, 9, h);
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
  uniform mat4 uVP; uniform mat4 uLVP; uniform vec3 uT; uniform vec3 uS;
  out vec3 vP; out vec3 vN; out vec2 vUV; out vec4 vL; out vec3 vW;
  void main() {
    vec3 p = aPos * uS + uT; vW = p;
    vP = vec3(p.x, p.z, -p.y);
    vec3 n = aNor / uS; vN = normalize(vec3(n.x, n.z, -n.y));
    vUV = aUV; vL = uLVP * vec4(vP, 1.0);
    gl_Position = uVP * vec4(vP, 1.0);
  }`;
  const FS = `#version 300 es
  precision highp float;
  in vec3 vP; in vec3 vN; in vec2 vUV; in vec4 vL; in vec3 vW;
  uniform vec3 uBase; uniform float uRough; uniform float uMetal; uniform float uAlpha; uniform float uGlow;
  uniform int uKind; uniform sampler2D uTex; uniform sampler2D uShadow; uniform vec3 uEye; uniform float uSel; uniform vec3 uBg;
  uniform vec3 uKey; uniform vec3 uFill; uniform vec4 uFoot;
  uniform vec2 uClip; uniform float uLayerH; uniform vec3 uBgTop; uniform vec3 uBgBot; uniform vec2 uRes;
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
    if (uClip.x > 0.5 && uClip.x < 1.5 && vW.z > uClip.y) discard;
    if (uClip.x > 1.5 && vW.z <= uClip.y) discard;
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
    if (uKind == 2) { float n = hash(floor(vW.xy * 1.6)); base *= 0.82 + 0.36 * n; rough = 0.62 + 0.25 * n; }
    if (uKind == 3) { float r = length(vW.yz - vec2(0.0)); }
    if (uKind == 4) { float l = fract(vW.z / 1.4); base *= 0.9 + 0.1 * smoothstep(0.1, 0.5, l) * smoothstep(0.9, 0.5, l); }
    if (uKind == 5) { float w = abs(sin((vW.x + vW.y + vW.z) * 1.7)); base *= 0.85 + 0.3 * w; }
    if (uKind == 7) { float rr = length(vW.yz - uFoot.xy); base *= 0.86 + 0.14 * smoothstep(0.3, 0.7, fract(rr / 1.75)); }
    if (uKind == 9) {
      // Printed plastic: a faint ridge per layer, fading out where layers
      // are finer than a pixel (no shimmer when zoomed out).
      float t = vW.z / uLayerH, f = fract(t), aa = clamp(fwidth(t) * 1.4, 0.0, 1.0);
      float ridge = smoothstep(0.0, 0.3, f) * smoothstep(1.0, 0.7, f);
      base *= mix(0.8 + 0.2 * ridge, 0.92, aa); rough = 0.48;
    }
    if (uKind == 11) { float n = hash(vec2(floor(vW.z * 3.0 + vW.x * 0.02), floor((vW.x + vW.y) * 0.5))); base *= 0.93 + 0.1 * n; }
    if (uKind == 12) { base *= 0.72 + 0.28 * smoothstep(0.15, 0.85, abs(fract(vW.z / 2.0) * 2.0 - 1.0)); }
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
    if (uGlow > 0.0) col = mix(col, base * 1.25, uGlow);
    // Picked: a blue glow round its edges, so its own colour stays true.
    if (uSel > 0.0) { float fr = pow(1.0 - max(dot(N, V), 0.0), 2.0); col = col * (1.0 + 0.1 * uSel) + vec3(0.1, 0.32, 1.0) * (0.12 + 0.75 * fr) * uSel; }
    // The layer being laid now reads a touch brighter: fresh, still warm plastic.
    if (uKind == 9 && uClip.x > 0.5 && uClip.x < 1.5 && vW.z > uClip.y - uLayerH * 1.01) col += base * 0.35 + vec3(0.03);
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
  in vec3 aPos; uniform mat4 uLVP; uniform vec3 uT; uniform vec3 uS; out float vZ;
  void main() { vec3 p = aPos * uS + uT; vZ = p.z; gl_Position = uLVP * vec4(p.x, p.z, -p.y, 1.0); }`;
  const SHADOW_FS = `#version 300 es
  precision highp float; in float vZ; uniform vec2 uClip; out vec4 o;
  void main() { if (uClip.x > 0.5 && vZ > uClip.y) discard; o = vec4(1.0); }`;
  /* The drawing's first pass: surface direction and part id, per pixel. */
  const GB_FS = `#version 300 es
  precision highp float;
  in vec3 vN; in vec3 vW; uniform float uId; uniform vec2 uClip; out vec4 o;
  void main() { if (uClip.x > 0.5 && vW.z > uClip.y) discard; o = vec4(normalize(vN) * 0.5 + 0.5, uId / 255.0); }`;
  /* Picking: each pickable part paints its id. */
  const ID_FS = `#version 300 es
  precision highp float; in vec3 vW; uniform float uId; uniform vec2 uClip; out vec4 o;
  void main() { if (uClip.x > 0.5 && vW.z > uClip.y) discard; o = vec4(uId / 255.0, 0.0, 0.0, 1.0); }`;
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
  function create(host, { onPick } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'twin3d';
    wrap.innerHTML = `<canvas class="twin3d-canvas" tabindex="0" role="img" aria-label="3D model of the printer. Drag to turn, scroll or pinch to zoom."></canvas>
      <svg class="twin3d-ink" aria-hidden="true"></svg><div class="twin3d-tags" aria-hidden="true"></div>`;
    host.appendChild(wrap);
    const canvas = wrap.querySelector('canvas'), tags = wrap.querySelector('.twin3d-tags'), inkSvg = wrap.querySelector('.twin3d-ink');
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) { wrap.remove(); return null; }
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');

    const compile = (vs, fs) => {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
      }
      gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aNor'); gl.bindAttribLocation(p, 2, 'aUV');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i), name = info.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, info.name); }
      return { p, u };
    };
    let P;
    try {
      P = { main: compile(VS, FS), shadow: compile(SHADOW_VS, SHADOW_FS), gbuf: compile(VS, GB_FS), id: compile(VS, ID_FS), ink: compile(POST_VS, INK_FS), bg: compile(POST_VS, BG_FS) };
    } catch (err) { console.warn('Twin3D:', err.message); wrap.remove(); return null; }

    const upload = (g) => {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.v), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
      gl.bindVertexArray(null);
      // Its middle, for drawing see-through parts back to front.
      let sx = 0, sy = 0, sz = 0;
      const n = g.v.length / 8;
      for (let i = 0; i < g.v.length; i += 8) { sx += g.v[i]; sy += g.v[i + 1]; sz += g.v[i + 2]; }
      return { vao, buf, count: n, centre: n ? [sx / n, sy / n, sz / n] : [0, 0, 0] };
    };
    const free = m => { if (m) { gl.deleteBuffer(m.buf); gl.deleteVertexArray(m.vao); } };
    const texture = (cv, old) => {
      const t = old || gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
      return t;
    };

    /* ---- build the machine once ---- */
    if (typeof Twin3DScene === 'undefined') { wrap.remove(); return null; }
    const S = Twin3DScene.build({ geo, slab, annulus, lathe, tube, panel, box, rrect, circle, BODY, BED, PLATE, TIP, RAIL_Z, DOCK, HEAD, HUB });
    const parts = S.statics.map(p => ({ ...p, mesh: upload(p.g) }));
    const dyn = Object.fromEntries(Object.entries(S.dynamic).map(([k, p]) => [k, { ...p, mesh: upload(p.g) }]));
    const tex = {
      logo: texture(logoArt()), label: texture(labelArt()), side: texture(sideArt()), feeder: texture(feederArt()), head: texture(headArt()),
    };
    const screenCanvas = canvasOf(512, 320, () => {});
    tex.screen = texture(screenCanvas);
    const floor = upload(panel(geo(), [135, 135, -0.5], [4000, 0, 0], [0, 4000, 0], [0, 0, 1]));

    /* Shadow map: one key light from front-left, above. */
    const SH = 2048;
    const shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SH, SH);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const shadowFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const KEY = norm([-0.38, 1.0, 0.42]), FILL = norm([0.8, 0.35, 0.5]);   // GL axes: x, y up, z towards the front
    const lightVP = (() => {
      const c = [135, 330, -150], e = [c[0] + KEY[0] * 1500, c[1] + KEY[1] * 1500, c[2] + KEY[2] * 1500];
      return mul(ortho(-1000, 1000, -1000, 1000, 200, 3200), lookAt(e, c, [0, 1, 0]));
    })();

    /* Offscreen targets for picking and the drawing (resized with the canvas). */
    const target = { w: 0, h: 0 };
    const gbTex = gl.createTexture(), gbDepth = gl.createTexture(), gbFb = gl.createFramebuffer();
    function sizeTargets(w, h) {
      if (target.w === w && target.h === h) return;
      target.w = w; target.h = h;
      gl.bindTexture(gl.TEXTURE_2D, gbTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D, gbDepth); gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, gbFb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gbTex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, gbDepth, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // focus: 0 frames the whole machine, 1 the print on the plate (the Print view).
    const cam = { yaw: VIEWS.iso[0], pitch: VIEWS.iso[1], zoom: 1, tx: 0, ty: 0, vyaw: 0, vpitch: 0, focus: 0 };
    let state = null, pos = [135, 135, 0], selected = '', W = 0, H = 0, queued = false, style = 'model', showCase = false;
    // The model's own options: the case closed, see-through or off; the
    // print on the plate (and, faintly, what is still to come); name tags.
    let caseMode = 'closed', showPrint = true, showRest = true, showTags = true;
    let print = null, printMeshes = [], pickNames = [];
    let partsMeshes = [], partsKey = '', loopMeshes = {}, loopKey = '', screenKey = '', shadowKey = '', labels = [], viewName = 'iso';
    let viewChanged = () => {};

    function resize() {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      // The drawing renders at twice the pixels, so its ink lines come out smooth.
      const dpr = style === 'drawing' ? Math.max(2, Math.min(3, devicePixelRatio || 1)) : Math.min(2, devicePixelRatio || 1);
      W = r.width; H = r.height;
      const w = Math.round(W * dpr), h = Math.round(H * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      return true;
    }
    /* The box the view has to show. */
    function bounds() {
      if (style === 'drawing' && !showCase) return { x0: -70, x1: 340, y0: -40, y1: 370, z0: 60, z1: 540 };
      return ENVELOPE;
    }
    /* Where the Print view looks: the middle of what's printed so far, on
     * the bed wherever the bed has dropped to. */
    function printFocus() {
      const z = Math.max(0, Math.min(BED, pos[2])), bedTop = TIP - z;
      const h = print ? Math.min(print.top, Math.max(z, 8)) : Math.max(z, 20);
      const c = print ? print.centre : [135, 135];
      return [c[0], bedTop + h * 0.5, -c[1]];
    }
    function matrices() {
      const b = bounds(), box = [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, -(b.y0 + b.y1) / 2];
      const fp = printFocus(), centre = box.map((c, i) => c + (fp[i] - c) * cam.focus);
      const yaw = cam.yaw * Math.PI / 180, pitch = cam.pitch * Math.PI / 180;
      const dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
      const right = [Math.cos(yaw), 0, -Math.sin(yaw)], up = [-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch)];
      const target = centre.map((c, i) => c + right[i] * cam.tx + up[i] * cam.ty);
      const radius = Math.hypot(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0) / 2;
      const aspect = W / H;
      if (style === 'drawing') {
        // Orthographic: fit the projected box, leaving room for the title block.
        const view = lookAt(target.map((c, i) => c + dir[i] * 2000), target, Math.abs(pitch) > 1.5 ? [-Math.sin(yaw), 0, -Math.cos(yaw)] : [0, 1, 0]);
        let mx = 0, my = 0;
        for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) {
          const p = [x, z, -y, 1], v = [0, 1, 2].map(j => view[j] * p[0] + view[4 + j] * p[1] + view[8 + j] * p[2] + view[12 + j]);
          mx = Math.max(mx, Math.abs(v[0])); my = Math.max(my, Math.abs(v[1]));
        }
        const room = showCase ? 86 : 56;
        // Wide sheets keep a column on the left for the parts list.
        const reserve = W >= 1000 ? 404 : W >= 640 ? 196 : 0, wd = Math.max(1, W - reserve), aspectEff = wd / H;
        const half = Math.max(mx * 1.1 / aspectEff, my * 1.1 + room) / cam.zoom, k = 2 * half / H;
        const VP = mul(ortho(-(reserve + wd / 2) * k, (wd / 2) * k, -half - room / cam.zoom, half - room / cam.zoom, 1, 4000), view);
        return { VP, eye: target.map((c, i) => c + dir[i] * 2000), pxPerMm: H / (2 * half), dir };
      }
      const fov = 26 * Math.PI / 180;
      const dist = Math.max(radius / Math.sin(fov / 2), radius / Math.sin(Math.atan(Math.tan(fov / 2) * aspect))) * 0.8 / cam.zoom;
      const eye = target.map((c, i) => c + dir[i] * dist);
      return { VP: mul(perspective(fov, aspect, 40, 8000), lookAt(eye, target, [0, 1, 0])), eye, dir };
    }
    const project = (VP, x, y, z) => {
      const p = [x, z, -y, 1], o = [0, 0, 0, 0];
      for (let j = 0; j < 4; j++) o[j] = VP[j] * p[0] + VP[4 + j] * p[1] + VP[8 + j] * p[2] + VP[12 + j] * p[3];
      return [(o[0] / o[3] * 0.5 + 0.5) * W, (1 - (o[1] / o[3] * 0.5 + 0.5)) * H, o[3]];
    };

    /* ---- the print: its own G-code's outside walls, per toolhead ----
     * From /api/print/preview (backend/print_preview.py): each path is
     * [layer, object, x0, y0, then steps] in hundredths of a millimetre.
     * Walls become upright ribbons one layer tall; top surfaces lie flat.
     * One mesh per toolhead and object, so each takes its head's colour
     * and a skipped object can be greyed out. */
    function setPrint(data) {
      printMeshes.forEach(m => free(m.mesh)); printMeshes = []; print = null;
      if (!data || !data.tools || !Array.isArray(data.layers) || !data.layers.length) { queue(); return; }
      const L = data.layers, k = data.unit_mm || 0.01, groups = new Map();
      const group = (tool, obj) => { const key = `${tool}|${obj}`; if (!groups.has(key)) groups.set(key, { tool, obj, g: geo() }); return groups.get(key).g; };
      let hMin = Infinity, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      const grow = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
      for (const [tool, sets] of Object.entries(data.tools)) {
        for (const path of sets.walls || []) {
          const layer = L[path[0]]; if (!layer) continue;
          const z1 = layer.z, z0 = z1 - (layer.h || 0.2), g = group(tool, path[1]);
          hMin = Math.min(hMin, layer.h || 0.2);
          let x = path[2] * k, y = path[3] * k;
          grow(x, y);
          for (let i = 4; i + 1 < path.length; i += 2) {
            const nx = x + path[i] * k, ny = y + path[i + 1] * k, dx = nx - x, dy = ny - y, l = Math.hypot(dx, dy);
            grow(nx, ny);
            if (l > 1e-4) { const n = [dy / l, -dx / l, 0]; quadV(g, [[x, y, z0], n], [[nx, ny, z0], n], [[nx, ny, z1], n], [[x, y, z1], n]); }
            x = nx; y = ny;
          }
        }
        for (const path of sets.fill || []) {
          const layer = L[path[0]]; if (!layer) continue;
          const z = layer.z, g = group(tool, path[1]), up = [0, 0, 1], w = 0.24;
          let x = path[2] * k, y = path[3] * k;
          for (let i = 4; i + 1 < path.length; i += 2) {
            const nx = x + path[i] * k, ny = y + path[i + 1] * k, dx = nx - x, dy = ny - y, l = Math.hypot(dx, dy);
            if (l > 1e-4) { const ox = -dy / l * w, oy = dx / l * w; quadV(g, [[x - ox, y - oy, z], up], [[nx - ox, ny - oy, z], up], [[nx + ox, ny + oy, z], up], [[x + ox, y + oy, z], up]); }
            x = nx; y = ny;
          }
        }
      }
      groups.forEach(({ tool, obj, g }) => { if (g.v.length) printMeshes.push({ tool, obj, mesh: upload(g) }); });
      print = { file: data.file, layers: L, objects: data.objects || [], colours: data.file_colours || [], layerH: isFinite(hMin) ? hMin : 0.2, top: L[L.length - 1].z,
        centre: isFinite(x0) ? [(x0 + x1) / 2, (y0 + y1) / 2] : [135, 135], size: isFinite(x0) ? Math.max(x1 - x0, y1 - y0, L[L.length - 1].z) : 60 };
      queue();
    }

    /* ---- what moves: everything that depends on the printer's state ---- */
    function liveScene() {
      const st = state || {}, [x, y, z] = pos, bedTop = TIP - Math.max(0, Math.min(BED, z));
      const heads = Object.entries(st.toolheads || {});
      const active = st.toolheads && st.toolheads[st.active_toolhead] ? st.active_toolhead : null;
      const printing = ['printing', 'paused'].includes(st.state);
      const items = [];
      const add = (mesh, mat, o = {}) => items.push({ mesh, mat, t: o.t || [0, 0, 0], s: o.s || [1, 1, 1], id: o.id || 0, tex: o.tex, sel: o.sel || 0, glow: o.glow, colour: o.colour, kind: o.kind, shell: o.shell, lining: o.lining, loop: o.loop, alpha: o.alpha, clip: o.clip, layerH: o.layerH, printed: o.printed, rest: o.rest, body: o.body, tool: o.tool });
      // Bed: plate, its label strip, heater, carrier.
      const bedId = 2, bedSel = selected === 'bed' ? 1 : 0, heat = st.bed && st.bed.target > 0 ? Math.min(1, (st.bed.temp || 0) / 110) : 0;
      add(dyn.carrier.mesh, MAT.rail, { t: [0, 0, bedTop], id: bedId, sel: bedSel });
      add(dyn.heater.mesh, MAT.alu, { t: [0, 0, bedTop], id: bedId, sel: bedSel, colour: heat > 0.3 ? lin(.85, .6, .45) : null });
      add(dyn.plate.mesh, MAT.pei, { t: [0, 0, bedTop], id: bedId, sel: bedSel });
      add(dyn.label.mesh, MAT.decal, { t: [0, 0, bedTop], id: bedId, tex: tex.label, sel: bedSel });
      // Gantry: the X rods at the head's Y, its two Y carriages, the carriage.
      add(dyn.xbeam.mesh, MAT.carbon, { t: [0, y, 0] });
      add(dyn.ycar.mesh, MAT.rail, { t: [0, y, 0] });
      add(dyn.xbelt.mesh, MAT.belt, { t: [0, y, 0] });
      add(dyn.carriage.mesh, MAT.body, { t: [x, y, 0] });
      // The parts, grown to the current height.
      const plate = st.objects && Array.isArray(st.objects.list) ? st.objects : null;
      const finished = st.state === 'complete';
      const real = print && print.file === st.current_file && (printing || finished);
      const key = plate && printing && !real ? JSON.stringify(plate.list.map(o => o.polygon)) : '';
      if (key !== partsKey) {
        partsMeshes.forEach(p => free(p.mesh)); partsMeshes = []; partsKey = key;
        if (key) plate.list.forEach(o => { if (Array.isArray(o.polygon) && o.polygon.length >= 3) partsMeshes.push({ name: o.name, mesh: upload(prism(geo(), o.polygon)) }); });
      }
      const activeColour = active ? (srgb(st.toolheads[active].filament_color_hex) || lin(.6, .6, .62)) : lin(.6, .6, .62);
      pickNames = [];
      if (real) {
        // The real print: each head's walls in the colour loaded in it (the
        // file's own colour if the head reports none), up to the layer being
        // printed; the rest of the print faintly above, if asked for.
        const L = print.layers, cur = st.layer && st.layer.current ? Math.min(L.length, st.layer.current) : 0;
        const clipZ = finished ? print.top + 1 : cur ? L[cur - 1].z + 0.001 : Math.max(0.2, z) + 0.001;
        const excluded = new Set((plate && plate.excluded) || []);
        pickNames = print.objects.slice();
        if (showPrint) printMeshes.forEach(m => {
          const head = st.toolheads && st.toolheads[m.tool], name = print.objects[m.obj];
          const colour = (head && srgb(head.filament_color_hex)) || srgb(print.colours[+String(m.tool).slice(1)]) || lin(.6, .6, .62);
          const skip = name && excluded.has(name);
          const id = m.obj >= 0 ? 40 + m.obj : 0, sel = name && selected === `obj:${name}` ? 1 : 0;
          add(m.mesh, { c: skip ? lin(.55, .55, .57) : colour, r: .5, m: 0, kind: 'print' }, { t: [0, 0, bedTop], id, sel, clip: [1, bedTop + clipZ], layerH: print.layerH, printed: true, tool: +String(m.tool).slice(1) || 0 });
          if (showRest && !finished && !skip) add(m.mesh, { ...MAT.ghost, c: colour, a: .1 }, { t: [0, 0, bedTop], clip: [2, bedTop + clipZ], rest: true });
        });
      } else if (partsMeshes.length) {
        pickNames = partsMeshes.map(p => p.name);
        const excluded = new Set((plate && plate.excluded) || []), h = Math.max(0.6, Math.min(BED, z));
        partsMeshes.forEach((p, i) => {
          const skip = excluded.has(p.name);
          if (showPrint) add(p.mesh, { c: skip ? lin(.6, .6, .62) : activeColour, r: .55, m: 0, kind: 'layers' }, { t: [0, 0, bedTop], s: [1, 1, skip ? Math.min(h, 2) : h], id: 40 + i, sel: selected === `obj:${p.name}` ? 1 : 0 });
        });
      } else if (printing && showPrint) {
        add(dyn.blob.mesh, { c: activeColour, r: .55, m: 0, kind: 'layers' }, { t: [0, 0, bedTop], s: [1, 1, Math.max(0.6, Math.min(BED, z))] });
      }
      // Heads: parked in their docks, the active one on the carriage.
      labels = [];
      heads.forEach(([name, d], i) => {
        const on = name === active, id = 10 + i, sel = selected === `head:${name}` ? 1 : 0;
        const hx = on ? x : DOCK.xs[i % 4], hy = on ? y - 30 : DOCK.y, tipZ = on ? TIP : DOCK.tip;
        const fault = d.status === 'error', colour = srgb(d.filament_color_hex) || lin(.6, .6, .62);
        const hot = (d.temperature || 0) > 60;
        const t = [hx, hy, tipZ], body = on;   // the working head's body turns to glass in the Print view
        add(dyn.head.mesh, fault ? { ...MAT.head, c: lin(.42, .06, .05) } : MAT.head, { t, id, sel, body });
        add(dyn.headFace.mesh, MAT.decal, { t, id, sel, tex: tex.head, body });
        add(dyn.headYellow.mesh, MAT.yellow, { t, id, sel, body });
        add(dyn.headLed.mesh, { c: fault ? lin(1, .2, .15) : on ? lin(.35, .7, 1) : lin(.4, .95, .5), r: .3, m: 0 }, { t, id, glow: 0.9, body });
        add(dyn.nozzle.mesh, MAT.steel, { t, id });
        add(dyn.block.mesh, { c: hot ? lin(.95, .45, .18) : lin(.16, .16, .17), r: .5, m: 0 }, { t, id, glow: hot ? Math.min(0.55, ((d.temperature || 0) - 60) / 300) : 0 });
        // Filament loop: from the top of the head up and back down to the rear wall.
        const lk = `${name}|${Math.round(hx)}|${Math.round(hy)}|${tipZ}|${d.filament_color_hex}`;
        if (!loopMeshes[name] || loopMeshes[name].key !== lk) {
          if (loopMeshes[name]) ['ptfe', 'cable', 'fil', 'clips'].forEach(k => free(loopMeshes[name][k]));
          // As in Snapmaker's picture: a tall upside-down U that leaves the
          // top of the head on one side and returns on the other, a white
          // filament tube and a black cable side by side, held by clips.
          const z0 = tipZ + HEAD.h + 2, top = 724, half = 17;
          const route = (dy, lean) => {
            const pts = [];
            for (let k = 0; k <= 16; k++) {
              const a = Math.PI * k / 16, sx = -Math.cos(a), up = Math.sin(a);
              const zz = z0 + (top - z0) * Math.pow(up, 0.55);
              pts.push([hx + sx * (half + lean * up), hy + dy + 6 * up, zz]);
            }
            return pts;
          };
          const clips = geo();
          for (const k of [3, 13]) {
            const a = Math.PI * k / 16, up = Math.sin(a), zz = z0 + (top - z0) * Math.pow(up, 0.55), x = hx - Math.cos(a) * (half + 3 * up);
            box(clips, x - 4, hy - 9 + 6 * up, zz - 5, x + 4, hy + 9 + 6 * up, zz + 5, 1.5);
          }
          loopMeshes[name] = { key: lk, ptfe: upload(tube(geo(), route(-4, 3), 3.1, 12, 8)), fil: upload(tube(geo(), route(-4, 3), 0.9, 6, 8)), cable: upload(tube(geo(), route(4, 3), 2.7, 10, 8)), clips: upload(clips) };
        }
        const lm = loopMeshes[name];
        // The loops count as part of the case in the drawing: they would
        // otherwise run off the top of a sheet sized for the mechanism.
        add(lm.cable, MAT.cable, { id, lining: true, loop: true });
        add(lm.fil, { c: colour, r: .4, m: 0 }, { id, lining: true, loop: true });
        add(lm.ptfe, MAT.tube, { id, lining: true, loop: true });
        add(lm.clips, MAT.cable, { id, lining: true, loop: true });
        const at = style === 'drawing' ? [hx, hy, tipZ + HEAD.h + 14] : [hx, hy, tipZ + HEAD.h + 24];
        labels.push({ id: `head:${name}`, text: name, colour: d.filament_color_hex || '#999999', at, centre: [hx, hy, tipZ + HEAD.h / 2], on, fault, hot, temp: d.temperature });
      });
      // Spools on the side drums, in the loaded colours (T0, T1 left; T2, T3 right: by eye).
      heads.slice(0, 4).forEach(([name, d], i) => {
        const left = i < 2, hub = i % 2 ? HUB.lower : HUB.upper, sx = left ? BODY.x0 - 58 : BODY.x1 + 58;
        const colour = srgb(d.filament_color_hex) || lin(.6, .6, .62), sel = selected === `head:${name}` ? 1 : 0;
        add(dyn.spoolCore.mesh, { c: colour, r: .5, m: 0, kind: 'spool' }, { t: [sx, hub[0], hub[1]], id: 20 + i, sel, colour: null, footOverride: [hub[0], hub[1]] });
        add(dyn.spoolFlange.mesh, MAT.flange, { t: [sx, hub[0], hub[1]], id: 20 + i, sel });
      });
      return { items, bedTop, active };
    }

    function screenUpdate() {
      const st = state || {};
      const key = JSON.stringify([st.state, st.progress, st.active_toolhead, st.printer_name, st.current_file, Object.values(st.toolheads || {}).map(d => [d.filament_color_hex, Math.round(d.temperature || 0)]), new Date().getMinutes()]);
      if (key === screenKey) return;
      screenKey = key; screenArt(screenCanvas, st); texture(screenCanvas, tex.screen);
    }

    /* ---- drawing it ---- */
    function setMat(u, mat, it) {
      const c = it.colour || mat.c;
      gl.uniform3fv(u.uBase, c); gl.uniform1f(u.uRough, mat.r); gl.uniform1f(u.uMetal, mat.m);
      gl.uniform1f(u.uAlpha, it.alpha != null ? it.alpha : mat.a != null ? mat.a : 1);
      gl.uniform1f(u.uGlow, it.glow != null ? it.glow : mat.glow || 0);
      const kind = { tex: 1, pei: 2, spool: 7, layers: 4, carbon: 5, glass: 8, clear: 0, print: 9, ghost: 10, brushed: 11, thread: 12 }[it.kind || mat.kind] || 0;
      gl.uniform1i(u.uKind, it.tex ? 1 : kind);
      if (it.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, it.tex); gl.uniform1i(u.uTex, 0); }
      gl.uniform1f(u.uSel, it.sel || 0);
      if (kind === 7) gl.uniform4f(u.uFoot, it.t[1], it.t[2], 0, 0);
      gl.uniform1f(u.uLayerH, it.layerH || 0.2);
    }
    function drawItem(prog, it) {
      gl.uniform3fv(prog.u.uT, it.t); gl.uniform3fv(prog.u.uS, it.s);
      if (prog.u.uClip) gl.uniform2f(prog.u.uClip, it.clip ? it.clip[0] : 0, it.clip ? it.clip[1] : 0);
      gl.bindVertexArray(it.mesh.vao); gl.drawArrays(gl.TRIANGLES, 0, it.mesh.count);
    }
    function allItems(live) {
      const st = parts.map(p => ({ mesh: p.mesh, mat: MAT[p.mat], t: [0, 0, 0], s: [1, 1, 1], id: p.id || 0, tex: p.tex ? tex[p.tex] : null, shell: p.shell, lining: p.lining, frame: p.frame, kind: p.kind, glow: p.glow, sel: p.pick && selected === p.pick ? 1 : 0 }));
      return st.concat(live.items);
    }
    /* The model's case: closed as on the desk, see-through (an outline of
     * light), or off (the frame, drive and print in the open). */
    function withCase(items) {
      // Close up on the print, a closed case would only show its own wall:
      // it turns to glass for as long as the Print view is on.
      const close = cam.focus > 0.5, mode = caseMode === 'closed' && close ? 'glass' : caseMode;
      if (mode === 'closed' && !close) return items;
      const out = [];
      for (const it of items) {
        if (close && it.body) { if (!it.tex) out.push({ ...it, mat: { ...MAT.ghost, c: lin(.2, .2, .22), a: .2 }, kind: 'ghost', glow: 0 }); continue; }
        const chamber = it.lining && !it.loop;
        if (mode === 'open' && (it.shell || chamber)) continue;
        if (mode === 'glass') {
          if (chamber) continue;
          if (it.shell) {
            if (it.tex && it.tex !== tex.screen) continue;
            if (!it.tex) { out.push({ ...it, mat: MAT.ghost, kind: 'ghost', colour: null }); continue; }
          }
        }
        out.push(it);
      }
      return out;
    }

    function render() {
      queued = false;
      if (!state || !resize()) return;
      screenUpdate();
      const live = liveScene(), all = allItems(live);
      const M = matrices();
      if (style === 'drawing') { renderDrawing(M, all, live); return; }
      const items = withCase(all);
      const opaque = items.filter(it => !(it.mat.a != null && it.mat.a < 1));
      const clear = items.filter(it => it.mat.a != null && it.mat.a < 1);
      inkSvg.innerHTML = '';
      // Shadows: only when something that casts one has moved.
      const sk = JSON.stringify([pos.map(v => Math.round(v)), state.state, partsKey.length, Object.keys(loopMeshes).map(k => loopMeshes[k].key),
        caseMode, cam.focus > 0.5, showPrint, print && print.file, state.layer && state.layer.current]);
      if (sk !== shadowKey) {
        shadowKey = sk;
        gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb); gl.viewport(0, 0, SH, SH);
        gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
        gl.useProgram(P.shadow.p); gl.uniformMatrix4fv(P.shadow.u.uLVP, false, lightVP);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);
        opaque.forEach(it => drawItem(P.shadow, it));
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // The studio backdrop, then the scene over it.
      const bgTop = lin(.968, .972, .98), bgBot = lin(.885, .892, .905);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.useProgram(P.bg.p);
      gl.uniform3fv(P.bg.u.uBgTop, bgTop); gl.uniform3fv(P.bg.u.uBgBot, bgBot); gl.uniform2f(P.bg.u.uRes, canvas.width, canvas.height);
      gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
      const u = P.main.u; gl.useProgram(P.main.p);
      gl.uniformMatrix4fv(u.uVP, false, M.VP); gl.uniformMatrix4fv(u.uLVP, false, lightVP);
      gl.uniform3fv(u.uEye, M.eye); gl.uniform3fv(u.uKey, KEY); gl.uniform3fv(u.uFill, FILL);
      gl.uniform3fv(u.uBgTop, bgTop); gl.uniform3fv(u.uBgBot, bgBot); gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, shadowTex); gl.uniform1i(u.uShadow, 1);
      // The floor first, then everything solid.
      gl.uniform1i(u.uKind, 6); gl.uniform4f(u.uFoot, 135, 135, 330, 300);
      gl.uniform3fv(u.uT, [0, 0, 0]); gl.uniform3fv(u.uS, [1, 1, 1]); gl.uniform2f(u.uClip, 0, 0);
      gl.bindVertexArray(floor.vao); gl.drawArrays(gl.TRIANGLES, 0, floor.count);
      opaque.forEach(it => { setMat(u, it.mat, it); drawItem(P.main, it); });
      // See-through things last, farthest first, without hiding what's behind.
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      const eye = M.eye, dist = it => { const c = it.mesh.centre || [0, 0, 0]; return Math.hypot(c[0] + it.t[0] - eye[0], c[2] + it.t[2] - eye[1], -(c[1] + it.t[1]) - eye[2]); };
      clear.sort((a, b) => dist(b) - dist(a)).forEach(it => { setMat(u, it.mat, it); drawItem(P.main, it); });
      gl.depthMask(true); gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
      renderTags(M);
    }

    function renderTags(M) {
      const placed = [];
      const list = labels.map(l => ({ ...l, p: project(M.VP, ...l.at) })).sort((a, b) => b.p[1] - a.p[1]);
      list.forEach(l => {
        const w = l.on ? 104 : 46, h = 22;
        let y = l.p[1];
        for (let tries = 0; tries < 6; tries++) {
          const hit = placed.find(p => Math.abs(p.x - l.p[0]) < (p.w + w) / 2 && Math.abs(p.y - y) < h);
          if (!hit) break;
          y = hit.y - h - 2;
        }
        l.p = [l.p[0], y]; placed.push({ x: l.p[0], y, w });
      });
      const html = !showTags ? '' : list.map(l => `<span class="t3-tag${l.on ? ' on' : ''}${l.fault ? ' fault' : ''}${selected === l.id ? ' sel' : ''}" data-id="${esc(l.id)}" style="left:${l.p[0].toFixed(1)}px;top:${l.p[1].toFixed(1)}px"><i style="background:${/^#[0-9a-f]{6}$/i.test(l.colour) ? l.colour : '#999'}"></i>${esc(l.text)}${l.on ? ' · printing' : ''}</span>`).join('');
      if (tags.innerHTML !== html) tags.innerHTML = html;
    }

    /* ---- the engineering drawing ---- */
    function renderDrawing(M, items, live) {
      tags.innerHTML = '';
      sizeTargets(canvas.width, canvas.height);
      // Pass 1: surface direction, part id and depth for every visible solid.
      // The case, door and spools are left out unless "Show the case" is on,
      // so the mechanism inside reads clearly.
      gl.bindFramebuffer(gl.FRAMEBUFFER, gbFb); gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.5, 0.5, 1, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.useProgram(P.gbuf.p); gl.uniformMatrix4fv(P.gbuf.u.uVP, false, M.VP);
      const ids = new Map(); let next = 1;
      const idOf = it => {
        if (it.printed) return 200 + Math.max(0, Math.min(3, it.tool || 0));
        const k = it.id || `m${items.indexOf(it)}`; if (!ids.has(k)) ids.set(k, 1 + (next++ % 190)); return ids.get(k);
      };
      items.forEach(it => {
        if (it.mat.kind === 'glass' || it.rest) return;
        if (!showCase && (it.shell || it.lining || it.id >= 20 && it.id < 30)) return;
        gl.uniform1f(P.gbuf.u.uId, idOf(it));
        drawItem(P.gbuf, it);
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // Pass 2: ink.
      gl.viewport(0, 0, canvas.width, canvas.height); gl.disable(gl.DEPTH_TEST);
      gl.useProgram(P.ink.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, gbTex); gl.uniform1i(P.ink.u.uG, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, gbDepth); gl.uniform1i(P.ink.u.uD, 1);
      const px = Math.max(1, canvas.width / W * 0.6);
      gl.uniform2f(P.ink.u.uPx, px / canvas.width, px / canvas.height);
      gl.uniform1f(P.ink.u.uDepthK, 1.0);
      const heads = state.toolheads || {}, toolCol = [];
      for (let t = 0; t < 4; t++) { const hc = srgb((heads[`T${t}`] || {}).filament_color_hex) || [0.6, 0.6, 0.62]; toolCol.push(...hc.map(c => Math.pow(c, 1 / 2.2))); }
      gl.uniform3fv(P.ink.u.uToolCol, toolCol);
      const selKey = selected === 'bed' ? 2 : selected.startsWith('head:') ? 10 + Object.keys(state.toolheads || {}).indexOf(selected.slice(5)) : selected.startsWith('obj:') ? 40 + pickNames.indexOf(selected.slice(4)) : -1;
      gl.uniform1f(P.ink.u.uSelId, ids.has(selKey) ? ids.get(selKey) : -1);
      gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3);
      drawSheet(M, live);
    }

    /* The sheet over the ink, as SVG so its text stays sharp: a zoned
     * border, the build volume as a phantom line, the plate's centre lines,
     * live dimensions, the heads' balloons, numbered item balloons with
     * leaders, a parts list, notes and a title block. Narrow screens drop the
     * parts list and notes before anything else. */
    function drawSheet(M, live) {
      const P2 = (x, y, z) => project(M.VP, x, y, z);
      const f1 = v => v.toFixed(1);
      const line = (a, b, cls) => { const p = P2(...a), q = P2(...b); return `<line class="${cls}" x1="${f1(p[0])}" y1="${f1(p[1])}" x2="${f1(q[0])}" y2="${f1(q[1])}"/>`; };
      const T = live.bedTop, out = [], st = state || {}, nb = '\u00a0', [x, y, z] = pos, v = viewName;
      // The 270 mm cube the nozzle can reach, as a phantom (dash-dot) line.
      const c = [[0, 0], [BED, 0], [BED, BED], [0, BED]];
      for (let i = 0; i < 4; i++) {
        const [a, b] = [c[i], c[(i + 1) % 4]];
        out.push(line([...a, TIP - BED], [...b, TIP - BED], 'ph'), line([...a, TIP], [...b, TIP], 'ph'), line([...a, TIP - BED], [...a, TIP], 'ph'));
      }
      // The plate's centre lines (chain lines), and the nozzle's position on it.
      out.push(line([135, -12, T], [135, 282, T], 'cl'), line([-12, 135, T], [282, 135, T], 'cl'));
      const tip = P2(x, y, T);
      out.push(`<circle class="mk" cx="${f1(tip[0])}" cy="${f1(tip[1])}" r="3.5"/><line class="mk" x1="${f1(tip[0] - 7)}" y1="${f1(tip[1])}" x2="${f1(tip[0] + 7)}" y2="${f1(tip[1])}"/><line class="mk" x1="${f1(tip[0])}" y1="${f1(tip[1] - 7)}" x2="${f1(tip[0])}" y2="${f1(tip[1] + 7)}"/>`);
      const dim = (a, b, off, label) => {
        const pa = P2(...a), pb = P2(...b), da = P2(a[0] + off[0], a[1] + off[1], a[2] + off[2]), db = P2(b[0] + off[0], b[1] + off[1], b[2] + off[2]);
        const horiz = Math.abs(db[0] - da[0]) > Math.abs(db[1] - da[1]), mx = (da[0] + db[0]) / 2, my = (da[1] + db[1]) / 2;
        out.push(`<line class="ext" x1="${f1(pa[0])}" y1="${f1(pa[1])}" x2="${f1(da[0])}" y2="${f1(da[1])}"/><line class="ext" x1="${f1(pb[0])}" y1="${f1(pb[1])}" x2="${f1(db[0])}" y2="${f1(db[1])}"/>`,
          `<line class="dl" x1="${f1(da[0])}" y1="${f1(da[1])}" x2="${f1(db[0])}" y2="${f1(db[1])}" marker-start="url(#t3a)" marker-end="url(#t3a)"/>`,
          `<text class="dt" x="${f1(mx + (horiz ? 0 : 7))}" y="${f1(my + (horiz ? -5 : 4))}" text-anchor="${horiz ? 'middle' : 'start'}">${label}</text>`);
      };
      if (v !== 'top') dim([BED + 8, 0, T], [BED + 8, 0, TIP], [40, 0, 0], `Z${nb}${z.toFixed(2)}`);
      if (v === 'front') dim([0, 0, T], [x, 0, T], [0, 0, -34], `X${nb}${x.toFixed(1)}`);
      if (v === 'top') { dim([0, -8, TIP], [x, -8, TIP], [0, -40, 0], `X${nb}${x.toFixed(1)}`); dim([0, 0, TIP], [0, y, TIP], [-46, 0, 0], `Y${nb}${y.toFixed(1)}`); }
      // The print's height so far, against its full height (from its own file).
      const pr = print && print.file === st.current_file ? print : null;
      if (pr && v !== 'top' && ['printing', 'paused', 'complete'].includes(st.state)) {
        const L = pr.layers, cur = st.layer && st.layer.current ? Math.min(L.length, st.layer.current) : 0;
        const done = st.state === 'complete' ? pr.top : cur ? L[cur - 1].z : Math.min(z, pr.top);
        const px0 = pr.centre[0] - pr.size / 2 - 6;
        dim([px0, pr.centre[1], T], [px0, pr.centre[1], T + done], [-30, 0, 0], `${done.toFixed(1)}/${pr.top.toFixed(1)}`);
      }
      // The case's size: estimated from Snapmaker's picture, hence the ≈.
      if (showCase && v === 'front') { dim([BODY.x0, BODY.y0, 0], [BODY.x1, BODY.y0, 0], [0, 0, -46], `≈390${nb}mm`); dim([BODY.x0, BODY.y0, 0], [BODY.x0, BODY.y0, BODY.z1], [-150, 0, 0], `≈488${nb}mm`); }
      if (showCase && v === 'top') { dim([BODY.x0, BODY.y0, BODY.z1], [BODY.x1, BODY.y0, BODY.z1], [0, -40, 0], `≈390${nb}mm`); dim([BODY.x1, BODY.y0, BODY.z1], [BODY.x1, BODY.y1, BODY.z1], [110, 0, 0], `≈460${nb}mm`); }
      // The heads' balloons: the drafting way of naming parts.
      labels.forEach(l => {
        const p = P2(...l.at), sw = /^#[0-9a-f]{6}$/i.test(l.colour) ? l.colour : '#999';
        const cls = l.fault ? ' fault' : selected === l.id ? ' sel' : '';
        out.push(`<g class="bal${cls}" data-id="${esc(l.id)}"><circle cx="${f1(p[0])}" cy="${f1(p[1] - 14)}" r="11"/><text x="${f1(p[0])}" y="${f1(p[1] - 10.5)}" text-anchor="middle">${esc(l.text)}</text><rect x="${f1(p[0] + 13)}" y="${f1(p[1] - 18)}" width="7" height="7" style="fill:${sw}"/></g>`);
        if (l.fault || (l.hot && !l.on)) out.push(`<text class="note${l.fault ? ' fault' : ''}" x="${f1(p[0])}" y="${f1(p[1] - 30)}" text-anchor="middle">${l.fault ? 'FAULT' : Math.round(l.temp) + '°'}</text>`);
      });

      // Item balloons with leaders, matching the parts list.
      const heads = Object.entries(st.toolheads || {});
      const loaded = heads.map(([n, d]) => `${n}${nb}${String(d.filament_color_name || d.filament_material || '').slice(0, 12)}`.trim()).join(', ');
      const items = [
        { n: 1, what: 'Toolhead', qty: heads.length || 4, note: loaded || 'Tool changer, four heads', at: [DOCK.xs[3], DOCK.y, DOCK.tip + HEAD.h], pick: null },
        { n: 2, what: 'Build plate, PEI', qty: 1, note: `${PLATE.w}${nb}×${nb}${PLATE.d}`, at: [BED, 8, T], pick: 'bed' },
        { n: 3, what: 'X beam, carbon', qty: 2, note: 'Moves in Y with the gantry', at: [BED - 20, y, RAIL_Z + 7] },
        { n: 4, what: 'Frame extrusion ≈', qty: 10, note: '20×20, typical, not measured', at: [304, -68, 250], inside: true },
        { n: 5, what: 'XY motors ≈', qty: 2, note: 'CoreXY, position estimated', at: [304, 303, 421], inside: true },
        { n: 6, what: 'Z screw, motor ≈', qty: 1, note: 'Position estimated', at: [135, 305, 150], inside: true },
      ];
      if (pr) items.push({ n: 7, what: 'Print', qty: pr.objects.length || 1, note: `${String(pr.file).slice(0, 26)}, ${pr.layers.length} layers, ${pr.top.toFixed(1)}${nb}mm`, at: [pr.centre[0] + pr.size / 2, pr.centre[1], T + Math.min(pr.top, z) * 0.6] });
      const placedB = [];
      items.forEach(it => {
        if (it.inside && showCase) return;
        const a = P2(...it.at);
        if (a[0] < 0 || a[0] > W || a[1] < 0 || a[1] > H) return;
        const sx = a[0] > W / 2 ? 1 : -1;
        let bx = a[0] + sx * 46, by = a[1] - 30;
        for (let k = 0; k < 6 && placedB.some(p => Math.hypot(p[0] - bx, p[1] - by) < 24); k++) by -= 24;
        placedB.push([bx, by]);
        const d = Math.hypot(bx - a[0], by - a[1]) || 1, ex = bx - (bx - a[0]) / d * 9.5, ey = by - (by - a[1]) / d * 9.5;
        out.push(`<g class="item${it.pick && selected === it.pick ? ' sel' : ''}"${it.pick ? ` data-id="${it.pick}"` : ''}><line class="ld" x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(ex)}" y2="${f1(ey)}"/><circle class="dot" cx="${f1(a[0])}" cy="${f1(a[1])}" r="1.8"/><circle cx="${f1(bx)}" cy="${f1(by)}" r="9.5"/><text x="${f1(bx)}" y="${f1(by + 3.6)}" text-anchor="middle">${it.n}</text></g>`);
      });

      // Zoned border: numbers along the top and bottom, letters down the sides.
      const m = 14, cols = Math.max(4, Math.round(W / 130)), rows = Math.max(3, Math.round(H / 120));
      let zone = `<rect class="border" x="3.5" y="3.5" width="${W - 7}" height="${H - 7}"/><rect class="frame" x="${m + 0.5}" y="${m + 0.5}" width="${W - 2 * m - 1}" height="${H - 2 * m - 1}"/>`;
      for (let i = 0; i < cols; i++) {
        const cx = m + (W - 2 * m) * (i + 0.5) / cols, xx = Math.round(m + (W - 2 * m) * i / cols) + 0.5;
        if (i) zone += `<line class="zt" x1="${xx}" y1="3.5" x2="${xx}" y2="${m}"/><line class="zt" x1="${xx}" y1="${H - m}" x2="${xx}" y2="${H - 3.5}"/>`;
        zone += `<text class="zn" x="${f1(cx)}" y="${m - 3.5}" text-anchor="middle">${i + 1}</text><text class="zn" x="${f1(cx)}" y="${H - 4.5}" text-anchor="middle">${i + 1}</text>`;
      }
      for (let j = 0; j < rows; j++) {
        const cy = m + (H - 2 * m) * (j + 0.5) / rows, yy = Math.round(m + (H - 2 * m) * j / rows) + 0.5, ch = String.fromCharCode(65 + j);
        if (j) zone += `<line class="zt" x1="3.5" y1="${yy}" x2="${m}" y2="${yy}"/><line class="zt" x1="${W - m}" y1="${yy}" x2="${W - 3.5}" y2="${yy}"/>`;
        zone += `<text class="zn" x="${m / 2 + 1.5}" y="${f1(cy + 3)}" text-anchor="middle">${ch}</text><text class="zn" x="${W - m / 2 - 1.5}" y="${f1(cy + 3)}" text-anchor="middle">${ch}</text>`;
      }

      // Title block: two rows of cells, with the third-angle projection symbol.
      const layer = st.layer || { current: 0, total: 0 }, scale = Math.max(1, Math.round((96 / 25.4) / M.pxPerMm));
      const wide = W >= 560, bw = Math.min(W - 2 * m - 8, wide ? 430 : 300), rh = 24, bx0 = W - m - 4 - bw, by0 = H - m - 4 - rh * 2;
      const today = new Date().toISOString().slice(0, 10);
      const viewWord = { iso: 'Angled', front: 'Front', top: 'Top', print: 'Print' }[v] || 'Turned';
      const row1 = wide ? [['Title', 'U1 general arrangement, live', .46], ['Dwg no.', 'DV1-U1-GA-01', .26], ['Sheet', '1 of 1', .12], ['Rev', 'Live', .16]]
                        : [['Title', 'U1 arrangement, live', .62], ['Dwg no.', 'DV1-GA-01', .38]];
      const row2 = wide ? [['Printer', st.printer_name || 'Printer', .3], ['View', viewWord, .14], ['Scale', `1:${scale}`, .12], ['Units', 'mm', .1], ['Layer', layer.total ? `${layer.current}/${layer.total}` : '-', .16], ['Date', today, .18]]
                        : [['Printer', st.printer_name || 'Printer', .4], ['View', viewWord, .2], ['Scale', `1:${scale}`, .18], ['Layer', layer.total ? `${layer.current}/${layer.total}` : '-', .22]];
      let tb = `<rect class="tb" x="${bx0 + 0.5}" y="${by0 + 0.5}" width="${bw}" height="${rh * 2}"/><line class="tl" x1="${bx0}" y1="${by0 + rh + 0.5}" x2="${bx0 + bw}" y2="${by0 + rh + 0.5}"/>`;
      [[row1, by0], [row2, by0 + rh]].forEach(([cells, yy]) => {
        let cx = bx0;
        cells.forEach(([k, val, f], i) => {
          const w = f * bw, max = Math.max(4, Math.floor((w - 8) / 6.4));
          tb += `<text class="tk" x="${f1(cx + 4)}" y="${yy + 9}">${k}</text><text class="tv" x="${f1(cx + 4)}" y="${yy + 20}">${esc(String(val).slice(0, max))}</text>`;
          cx += w; if (i < cells.length - 1) tb += `<line class="tl" x1="${Math.round(cx) + 0.5}" y1="${yy}" x2="${Math.round(cx) + 0.5}" y2="${yy + rh}"/>`;
        });
      });
      // Third-angle projection symbol, left of the title block.
      const sx0 = bx0 - 52, sy0 = by0 + 10;
      if (wide) tb += `<g class="proj"><line x1="${sx0}" y1="${sy0 + 14}" x2="${sx0 + 46}" y2="${sy0 + 14}"/><line x1="${sx0 + 32}" y1="${sy0}" x2="${sx0 + 32}" y2="${sy0 + 28}"/><path d="M${sx0 + 2} ${sy0 + 8}L${sx0 + 20} ${sy0 + 5}L${sx0 + 20} ${sy0 + 23}L${sx0 + 2} ${sy0 + 20}Z"/><circle cx="${sx0 + 32}" cy="${sy0 + 14}" r="9"/><circle cx="${sx0 + 32}" cy="${sy0 + 14}" r="5"/></g>`;

      // Parts list, top left, and notes, bottom left, when there's room.
      let bom = '';
      if (W >= 640) {
        const full = W >= 1000, cw = full ? [24, 150, 34, 172] : [20, 132, 26], tw = cw.reduce((a, b) => a + b, 0), bx = m + 8, by = m + 8, lh = 15;
        const rowsB = items.map(it => full ? [it.n, it.what, it.qty, it.note] : [it.n, it.what, it.qty]);
        bom += `<g class="bom"><rect class="tb" x="${bx + 0.5}" y="${by + 0.5}" width="${tw}" height="${lh * (rowsB.length + 1)}"/>`;
        [full ? ['Item', 'Description', 'Qty', 'Notes'] : ['Item', 'Description', 'Qty']].concat(rowsB).forEach((r, i) => {
          let cx = bx;
          r.forEach((val, j) => {
            const max = Math.floor((cw[j] - 6) / 6.1);
            bom += `<text class="${i ? 'bv' : 'tk'}" x="${cx + 4}" y="${by + lh * i + 11}">${esc(String(val)).slice(0, max)}</text>`;
            cx += cw[j]; if (j < cw.length - 1) bom += `<line class="tl" x1="${cx + 0.5}" y1="${by}" x2="${cx + 0.5}" y2="${by + lh * (rowsB.length + 1)}"/>`;
          });
          if (i) bom += `<line class="tl" x1="${bx}" y1="${by + lh * i + 0.5}" x2="${bx + tw}" y2="${by + lh * i + 0.5}"/>`;
        });
        bom += '</g>';
      }
      if (W >= 860) {
        const notes = ['Notes', '1. Dimensions in mm. Live: positions follow the printer.', '2. ≈ estimated from Snapmaker\'s product picture and specs.', '3. Frame, motors and lead screw: typical, not measured.', '4. Phantom line: the 270 mm build volume.'];
        bom += `<g class="notes">${notes.map((t, i) => `<text class="${i ? 'nv' : 'tk'}" x="${m + 10}" y="${H - m - 8 - (notes.length - 1 - i) * 13}">${esc(t)}</text>`).join('')}</g>`;
      }

      inkSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      inkSvg.innerHTML = `<defs><marker id="t3a" viewBox="0 0 10 4" refX="10" refY="2" markerWidth="10" markerHeight="4" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 2L0 4z"/></marker></defs>` +
        out.join('') + zone + bom + tb;
    }

    /* ---- picking: draw ids into an offscreen buffer and read one pixel ---- */
    function pickAt(px, py) {
      if (!state) return null;
      resize(); sizeTargets(canvas.width, canvas.height);
      const live = liveScene(), all = allItems(live), M = matrices();
      const items = style === 'drawing' ? all : withCase(all);
      gl.bindFramebuffer(gl.FRAMEBUFFER, gbFb); gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
      gl.useProgram(P.id.p); gl.uniformMatrix4fv(P.id.u.uVP, false, M.VP);
      items.forEach(it => {
        if (style === 'drawing' && !showCase && (it.shell || it.lining || it.id >= 20 && it.id < 30)) return;
        if (it.mat.kind === 'glass' || it.rest || (it.mat.a != null && it.mat.a < 0.5)) return;
        gl.uniform1f(P.id.u.uId, it.id || 0); drawItem(P.id, it);
      });
      const out = new Uint8Array(4), k = canvas.width / W;
      gl.readPixels(Math.round(px * k), Math.round(canvas.height - py * k), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const id = out[0], names = Object.keys(state.toolheads || {});
      if (id === 2) return 'bed';
      if (id >= 10 && id < 14) return names[id - 10] ? `head:${names[id - 10]}` : null;
      if (id >= 20 && id < 24) return names[id - 20] ? `head:${names[id - 20]}` : null;
      if (id >= 40 && pickNames[id - 40]) return `obj:${pickNames[id - 40]}`;
      return null;
    }

    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(render); } };

    /* ---- interaction: drag to turn (with a little glide after), right-drag
     *      or Shift-drag to move, wheel or pinch to zoom, double-click to
     *      reset, click to pick ---- */
    const touches = new Map();
    let drag = null, spin = 0;
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture?.(e.pointerId);
      cancelAnimationFrame(spin); cam.vyaw = cam.vpitch = 0;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, lt: performance.now(), yaw: cam.yaw, pitch: cam.pitch, tx: cam.tx, ty: cam.ty, pan: e.button === 2 || e.shiftKey, moved: false, zoom: cam.zoom, spread: 0 };
      if (touches.size === 2) { const [a, b] = [...touches.values()]; drag.spread = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    canvas.addEventListener('pointermove', e => {
      if (!drag || !touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2 && drag.spread) {
        const [a, b] = [...touches.values()];
        cam.zoom = Math.max(0.6, Math.min(8, drag.zoom * Math.hypot(a.x - b.x, a.y - b.y) / drag.spread));
        drag.moved = true; queue(); return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      const now = performance.now(), dt = Math.max(8, now - drag.lt);
      if (drag.pan) { const k = 1.4 / cam.zoom; cam.tx = drag.tx - dx * k; cam.ty = drag.ty + dy * k; }
      else {
        cam.vyaw = -(e.clientX - drag.lx) * 0.4 / dt * 16; cam.vpitch = (e.clientY - drag.ly) * 0.3 / dt * 16;
        cam.yaw = drag.yaw - dx * 0.4; cam.pitch = Math.max(-8, Math.min(89, drag.pitch + dy * 0.3));
        viewName = null; viewChanged(null);
      }
      drag.lx = e.clientX; drag.ly = e.clientY; drag.lt = now;
      queue();
    });
    const end = e => {
      touches.delete(e.pointerId);
      if (drag && !drag.moved && e.type === 'pointerup' && onPick) {
        const t = e.target.closest && e.target.closest('[data-id]');
        if (!t) { const r = canvas.getBoundingClientRect(); onPick(pickAt(e.clientX - r.left, e.clientY - r.top)); }
      } else if (drag && drag.moved && !drag.pan && !matchMedia('(prefers-reduced-motion: reduce)').matches && (Math.abs(cam.vyaw) > 0.2 || Math.abs(cam.vpitch) > 0.2)) {
        // Let it glide to a stop, like turning a real object.
        const glide = () => {
          cam.vyaw *= 0.92; cam.vpitch *= 0.88;
          cam.yaw += cam.vyaw; cam.pitch = Math.max(-8, Math.min(89, cam.pitch + cam.vpitch));
          render();
          if (Math.abs(cam.vyaw) > 0.03 || Math.abs(cam.vpitch) > 0.03) spin = requestAnimationFrame(glide);
        };
        spin = requestAnimationFrame(glide);
      }
      if (!touches.size) drag = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { e.preventDefault(); cam.zoom = Math.max(0.6, Math.min(8, cam.zoom * Math.exp(-e.deltaY * 0.0012))); queue(); }, { passive: false });
    canvas.addEventListener('dblclick', () => setView('iso'));
    canvas.addEventListener('keydown', e => {
      const k = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, 6], ArrowDown: [0, -6] }[e.key];
      if (k) { e.preventDefault(); cam.yaw += k[0]; cam.pitch = Math.max(-8, Math.min(89, cam.pitch + k[1])); viewName = null; viewChanged(null); queue(); }
      if (e.key === '+' || e.key === '=') { cam.zoom = Math.min(8, cam.zoom * 1.2); queue(); }
      if (e.key === '-') { cam.zoom = Math.max(0.6, cam.zoom / 1.2); queue(); }
      if (e.key === 'Escape' && onPick) onPick(null);
    });
    const tagClick = e => { const t = e.target.closest('[data-id]'); if (t && onPick) onPick(t.dataset.id || null); };
    tags.addEventListener('click', tagClick);
    inkSvg.addEventListener('click', tagClick);

    const glideTo = { raf: 0 };
    function setView(name) {
      const [ty, tp] = VIEWS[name] || VIEWS.iso;
      const from = { yaw: cam.yaw, pitch: cam.pitch, zoom: cam.zoom, tx: cam.tx, ty: cam.ty, focus: cam.focus };
      // Close enough that the print fills about half the view.
      const close = name === 'print', fit = close ? Math.max(3, Math.min(7.5, 300 / ((print && print.size) || 60))) : 1;
      const to = { yaw: from.yaw + ((((ty - from.yaw) % 360) + 540) % 360 - 180), pitch: tp, zoom: fit, tx: 0, ty: 0, focus: close ? 1 : 0 };
      cancelAnimationFrame(glideTo.raf); cancelAnimationFrame(spin);
      viewName = name; viewChanged(name);
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { Object.assign(cam, to); queue(); return; }
      const t0 = performance.now();
      const step = now => {
        const k = Math.min(1, (now - t0) / 500), e = 1 - Math.pow(1 - k, 3);
        for (const key of Object.keys(to)) cam[key] = from[key] + (to[key] - from[key]) * e;
        render();
        if (k < 1) glideTo.raf = requestAnimationFrame(step);
      };
      glideTo.raf = requestAnimationFrame(step);
    }

    /* A slow turntable, when asked for: stops while you drag, never runs
     * with reduced motion, and draws at most 30 times a second. */
    let spinOn = false, spinRaf = 0, spinLast = 0, spinDrawn = 0;
    function setSpin(on) {
      spinOn = !!on && !matchMedia('(prefers-reduced-motion: reduce)').matches;
      cancelAnimationFrame(spinRaf);
      if (spinOn) { spinLast = performance.now(); spinRaf = requestAnimationFrame(turn); }
    }
    function turn(now) {
      if (!spinOn || !wrap.isConnected) return;
      if (!drag && document.visibilityState === 'visible') {
        cam.yaw -= (now - spinLast) * 0.005;
        if (viewName) { viewName = null; viewChanged(null); }
        if (now - spinDrawn > 32) { spinDrawn = now; render(); }
      }
      spinLast = now;
      spinRaf = requestAnimationFrame(turn);
    }

    const ro = window.ResizeObserver ? new ResizeObserver(queue) : null;
    ro && ro.observe(canvas);
    const minute = setInterval(() => { if (state) queue(); }, 30000);

    return {
      el: wrap,
      update(s, p) { state = s; if (p) pos = p; queue(); },
      select(id) { selected = id || ''; queue(); },
      setView,
      setStyle(s) { style = s === 'drawing' ? 'drawing' : 'model'; wrap.dataset.style = style; canvas.setAttribute('aria-label', style === 'drawing' ? 'Engineering drawing of the printer. Drag to turn, scroll to zoom.' : '3D model of the printer. Drag to turn, scroll or pinch to zoom.'); queue(); },
      setCase(on) { showCase = !!on; queue(); },
      setCaseMode(m) { caseMode = ['closed', 'glass', 'open'].includes(m) ? m : 'closed'; shadowKey = ''; queue(); },
      setPrint,
      /* print: the part on the plate; rest: what's still to print, faintly;
       * tags: the heads' name tags; spin: the turntable. */
      setOptions(o = {}) {
        if ('print' in o) showPrint = !!o.print;
        if ('rest' in o) showRest = !!o.rest;
        if ('tags' in o) showTags = !!o.tags;
        if ('spin' in o) setSpin(o.spin);
        shadowKey = ''; queue();
      },
      printInfo() { return print ? { file: print.file, layers: print.layers.length, top: print.top, objects: print.objects.slice() } : null; },
      onViewChange(fn) { viewChanged = fn; },
      zoomBy(f) { cam.zoom = Math.max(0.6, Math.min(8, cam.zoom * f)); queue(); },
      /* A picture of what's on screen, with the drawing's labels baked in. */
      async download(filename) {
        render();
        const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
        const x = out.getContext('2d'); x.drawImage(canvas, 0, 0);
        const overlay = style === 'drawing' ? inkSvg : null;
        if (overlay) {
          const copy = overlay.cloneNode(true);
          copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); copy.setAttribute('width', W); copy.setAttribute('height', H);
          const css = getComputedStyle(overlay);
          const s = document.createElementNS('http://www.w3.org/2000/svg', 'style');
          s.textContent = `line,rect{fill:none;stroke:#23262c;stroke-width:1}.ph{stroke:#8b9099;stroke-dasharray:14 3 2 3}.cl{stroke:#8b9099;stroke-dasharray:18 3 3 3}.ext,.dl,.tl,.zt{stroke:#6b7079}.frame{stroke-width:1.4}marker path{fill:#6b7079}text{font:600 11px ${css.fontFamily};fill:#23262c}.tk{font-size:8px;fill:#6b7079;text-transform:uppercase;letter-spacing:.06em}.zn{font-size:8.5px;fill:#6b7079}.tv{font-size:10.5px}.bv,.nv{font-size:9px;font-weight:500}.bal circle,.item circle{fill:#fff;stroke:#23262c}.item .dot{fill:#23262c;stroke:none}.item .ld{stroke:#4a4f58;stroke-width:.8}.item text{font-size:10px}.mk{stroke:#2f6fe0;fill:none;stroke-width:1.2}.proj path,.proj circle{fill:none;stroke:#23262c}.proj line{stroke:#6b7079;stroke-dasharray:8 2 2 2}.fault text,.note.fault{fill:#b3261e}`;
          copy.insertBefore(s, copy.firstChild);
          const img = new Image();
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(copy));
          await img.decode().catch(() => {});
          x.drawImage(img, 0, 0, out.width, out.height);
        }
        out.toBlob(blob => {
          if (!blob) return;
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename || 'printer.png';
          document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        }, 'image/png');
      },
      destroy() { ro && ro.disconnect(); clearInterval(minute); spinOn = false; cancelAnimationFrame(spinRaf); printMeshes.forEach(m => free(m.mesh)); wrap.remove(); },
    };
  }

  return { create, ENVELOPE, BODY };
})();
