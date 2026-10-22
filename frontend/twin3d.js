/* Deja Vu1 - the digital twin as a shaded 3D model of the Snapmaker U1.
 *
 * Plain JavaScript and raw WebGL, no library. The Overview's twin card shows
 * either this model or the engineering drawing (workshop.js drawTwin); both
 * read the same live state, so the head, the bed and the parts move together.
 *
 * What is measured and what is drawn by eye:
 * - Measured (Snapmaker's published figures): outer size 584 x 499 x 730 mm,
 *   build volume 270 x 270 x 270 mm, four toolheads that park on the rear
 *   beam, a touchscreen on the front, four spools clipped to the sides (two
 *   each side, each side with its own feeder), a bed that drops as Z rises.
 * - Drawn by eye: the colours, panel tints, where exactly the screen and
 *   spools sit, the dock spacing, and which side feeds which head. The card
 *   says so under the model.
 *
 * Coordinates are the printer's own millimetres (X right, Y back, Z up),
 * turned into WebGL's (x, y up, z towards you) only in the vertex shader.
 */
'use strict';

const Twin3D = (() => {
  const OUT = { x0: -157, x1: 427, y0: -95, y1: 404, z0: 0, z1: 730 };   // 584 x 499 x 730
  const BED = 270, TIP = 600, BASE = 110, DOCK_Y = 330;
  const HEAD = { w: 42, d: 44, h: 54, cone: 9 };
  const COL = {
    frame: [0.17, 0.18, 0.21], base: [0.86, 0.87, 0.89], baseDark: [0.24, 0.25, 0.28],
    glass: [0.62, 0.74, 0.86], smoke: [0.42, 0.47, 0.55], rail: [0.7, 0.72, 0.76], beam: [0.3, 0.32, 0.36],
    plate: [0.13, 0.14, 0.16], plateMark: [0.3, 0.32, 0.36], heater: [0.62, 0.64, 0.68],
    head: [0.2, 0.21, 0.24], headFace: [0.9, 0.91, 0.93], nozzle: [0.82, 0.62, 0.3], hub: [0.75, 0.77, 0.8],
    screen: [0.05, 0.07, 0.1], screenUi: [0.32, 0.6, 1], led: [1, 0.98, 0.92], floor: [0, 0, 0],
  };
  const VIEWS = { iso: [-34, 24], front: [0, 4], top: [0, 88] };

  const VS = `
    attribute vec3 aPos; attribute vec3 aNor;
    uniform mat4 uVP; uniform vec3 uOffset; uniform vec3 uScale;
    varying vec3 vN; varying vec3 vP;
    void main() {
      vec3 p = aPos * uScale + uOffset;
      vP = vec3(p.x, p.z, -p.y);
      vN = normalize(vec3(aNor.x, aNor.z, -aNor.y));
      gl_Position = uVP * vec4(vP, 1.0);
    }`;
  const FS = `
    precision mediump float;
    varying vec3 vN; varying vec3 vP;
    uniform vec3 uColor; uniform float uAlpha; uniform vec3 uEye; uniform float uGlow; uniform int uMode;
    uniform vec4 uShadow;
    void main() {
      if (uMode == 1) {
        // A soft contact shadow on the floor under the printer.
        vec2 q = (vP.xz - uShadow.xy) / uShadow.zw;
        float a = 1.0 - smoothstep(0.35, 1.0, length(q));
        gl_FragColor = vec4(0.0, 0.0, 0.0, a * 0.28);
        return;
      }
      vec3 N = normalize(vN);
      vec3 V = normalize(uEye - vP);
      if (dot(N, V) < 0.0) N = -N;
      vec3 L = normalize(vec3(-0.45, 0.85, 0.55));
      vec3 L2 = normalize(vec3(0.6, 0.3, -0.7));
      float hemi = 0.5 + 0.5 * N.y;
      vec3 ambient = mix(vec3(0.42, 0.42, 0.46), vec3(0.78, 0.82, 0.9), hemi);
      float diff = max(dot(N, L), 0.0), back = max(dot(N, L2), 0.0) * 0.25;
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 40.0) * 0.32;
      float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.22;
      vec3 c = uColor * (ambient * 0.62 + diff * 0.62 + back) + vec3(spec + rim * 0.6);
      c = mix(c, uColor * 1.15 + 0.1, uGlow);
      gl_FragColor = vec4(c, uAlpha);
    }`;

  /* ---- geometry: triangles with flat normals, in printer millimetres ---- */
  function geo() { return { p: [], n: [] }; }
  function quad(g, a, b, c, d, n) { g.p.push(...a, ...b, ...c, ...a, ...c, ...d); for (let i = 0; i < 6; i++) g.n.push(...n); }
  function box(g, x0, y0, z0, x1, y1, z1) {
    const P = (x, y, z) => [x, y, z];
    quad(g, P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), [0, -1, 0]);
    quad(g, P(x1, y1, z0), P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), [0, 1, 0]);
    quad(g, P(x0, y1, z0), P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), [-1, 0, 0]);
    quad(g, P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1), [1, 0, 0]);
    quad(g, P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), [0, 0, 1]);
    quad(g, P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0), P(x0, y0, z0), [0, 0, -1]);
    return g;
  }
  /* A cylinder along X, Y or Z. */
  function cyl(g, c, r, len, axis, seg = 28, caps = true) {
    const pt = (a, along) => {
      const u = Math.cos(a) * r, v = Math.sin(a) * r;
      if (axis === 'x') return [c[0] + along, c[1] + u, c[2] + v];
      if (axis === 'y') return [c[0] + u, c[1] + along, c[2] + v];
      return [c[0] + u, c[1] + v, c[2] + along];
    };
    const nrm = a => { const u = Math.cos(a), v = Math.sin(a); return axis === 'x' ? [0, u, v] : axis === 'y' ? [u, 0, v] : [u, v, 0]; };
    const ax = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2, h = len / 2;
      const p00 = pt(a0, -h), p01 = pt(a0, h), p10 = pt(a1, -h), p11 = pt(a1, h);
      g.p.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
      const n0 = nrm(a0), n1 = nrm(a1);
      g.n.push(...n0, ...n1, ...n1, ...n0, ...n1, ...n0);
      if (caps) {
        const c0 = axis === 'x' ? [c[0] - h, c[1], c[2]] : axis === 'y' ? [c[0], c[1] - h, c[2]] : [c[0], c[1], c[2] - h];
        const c1 = axis === 'x' ? [c[0] + h, c[1], c[2]] : axis === 'y' ? [c[0], c[1] + h, c[2]] : [c[0], c[1], c[2] + h];
        g.p.push(...c1, ...p01, ...p11, ...c0, ...p10, ...p00);
        for (let k = 0; k < 3; k++) g.n.push(...ax);
        for (let k = 0; k < 3; k++) g.n.push(-ax[0], -ax[1], -ax[2]);
      }
    }
    return g;
  }
  /* A cone from a circle at z0 (radius r0) to z1 (radius r1), along Z. */
  function cone(g, x, y, z0, r0, z1, r1, seg = 20) {
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const p = (a, r, z) => [x + Math.cos(a) * r, y + Math.sin(a) * r, z];
      const A = p(a0, r0, z0), B = p(a1, r0, z0), C = p(a1, r1, z1), D = p(a0, r1, z1);
      const s = (r0 - r1) / (z1 - z0);
      const n = a => { const v = [Math.cos(a), Math.sin(a), s]; const l = Math.hypot(...v); return v.map(k => k / l); };
      g.p.push(...A, ...B, ...C, ...A, ...C, ...D);
      g.n.push(...n(a0), ...n(a1), ...n(a1), ...n(a0), ...n(a1), ...n(a0));
    }
    return g;
  }
  /* A polygon on the bed (an object's outline), 1 mm tall: scaled to height. */
  function prism(g, poly) {
    let area = 0;
    poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; area += p[0] * q[1] - q[0] * p[1]; });
    const pts = area < 0 ? poly.slice().reverse() : poly;
    const n = pts.length, cx = pts.reduce((s, p) => s + p[0], 0) / n, cy = pts.reduce((s, p) => s + p[1], 0) / n;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
      quad(g, [p[0], p[1], 0], [q[0], q[1], 0], [q[0], q[1], 1], [p[0], p[1], 1], [dy / l, -dx / l, 0]);
      // Fan caps from the middle: fine for the convex-ish outlines Klipper reports.
      g.p.push(cx, cy, 1, p[0], p[1], 1, q[0], q[1], 1); g.n.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    }
    return g;
  }

  /* A toolhead with its nozzle tip at the origin. */
  function headGeo() {
    const g = geo(), { w, d, h, cone: cn } = HEAD, hw = w / 2, hd = d / 2;
    box(g, -hw, -hd, cn, hw, hd, cn + h);
    box(g, -hw + 6, -hd + 6, cn + h, hw - 6, hd - 6, cn + h + 6);
    return g;
  }
  function headFaceGeo() { const g = geo(), { w, d, cone: cn } = HEAD; return box(g, -w / 2 + 4, -d / 2 - 1.2, cn + 18, w / 2 - 4, -d / 2, cn + 42); }
  function headStripeGeo() { const g = geo(), { w, d, cone: cn } = HEAD; return box(g, -w / 2 - 0.6, -d / 2 - 0.6, cn + 4, w / 2 + 0.6, d / 2 + 0.6, cn + 9); }
  function nozzleGeo() { const g = geo(); cone(g, 0, 0, 0, 0.6, HEAD.cone, 5.5); return g; }

  /* ---- the machine ---- */
  const dockX = (i, n) => BED * (i + 0.5) / n;
  function staticParts() {
    const { x0, x1, y0, y1, z1 } = OUT, parts = [];
    const add = (g, color, extra = {}) => parts.push({ g, color, ...extra });
    // Base: the lower body that holds the electronics, with a darker top lip.
    add(box(geo(), x0 + 4, y0 + 4, 0, x1 - 4, y1 - 4, BASE - 8), COL.base);
    add(box(geo(), x0, y0, BASE - 8, x1, y1, BASE), COL.baseDark);
    // Feet.
    for (const [fx, fy] of [[x0 + 40, y0 + 40], [x1 - 40, y0 + 40], [x0 + 40, y1 - 40], [x1 - 40, y1 - 40]]) add(cyl(geo(), [fx, fy, -6], 18, 12, 'z'), COL.frame);
    // Touchscreen on the front of the base (placement by eye).
    add(box(geo(), 220, y0 - 3, 22, 360, y0 + 2, 92), COL.screen, { pick: 'screen' });
    add(box(geo(), 230, y0 - 3.6, 30, 300, y0 - 2.8, 50), COL.screenUi, { glow: 0.85 });
    add(box(geo(), 306, y0 - 3.6, 30, 350, y0 - 2.8, 84), [0.85, 0.88, 0.95], { glow: 0.55 });
    // Frame: four corner posts and the top ring.
    const post = 30;
    for (const [px, py] of [[x0, y0], [x1 - post, y0], [x0, y1 - post], [x1 - post, y1 - post]]) add(box(geo(), px, py, BASE, px + post, py + post, z1), COL.frame);
    add(box(geo(), x0, y0, z1 - 26, x1, y0 + post, z1), COL.frame);
    add(box(geo(), x0, y1 - post, z1 - 26, x1, y1, z1), COL.frame);
    add(box(geo(), x0, y0, z1 - 26, x0 + post, y1, z1), COL.frame);
    add(box(geo(), x1 - post, y0, z1 - 26, x1, y1, z1), COL.frame);
    // Light bar under the top ring.
    add(box(geo(), x0 + 60, y0 + 34, z1 - 32, x1 - 60, y0 + 44, z1 - 27), COL.led, { glow: 1 });
    // Y rails on each side, the rear dock beam, Z guide rods at the back.
    const railZ = TIP + 74;
    add(box(geo(), -52, -40, railZ - 8, -36, 370, railZ + 8), COL.rail);
    add(box(geo(), 306, -40, railZ - 8, 322, 370, railZ + 8), COL.rail);
    add(box(geo(), -52, DOCK_Y + 26, TIP + 52, 322, DOCK_Y + 40, TIP + 70), COL.beam);
    for (const rx of [-20, 290]) add(cyl(geo(), [rx, 360, (BASE + z1) / 2], 6, z1 - BASE - 40, 'z', 16), COL.rail);
    // Four docks on the rear beam (even spacing; real spacing is in the printer's config).
    for (let i = 0; i < 4; i++) {
      const dx = dockX(i, 4);
      add(box(geo(), dx - 28, DOCK_Y + 20, TIP + 30, dx - 24, DOCK_Y + 30, TIP + 70), COL.beam);
      add(box(geo(), dx + 24, DOCK_Y + 20, TIP + 30, dx + 28, DOCK_Y + 30, TIP + 70), COL.beam);
    }
    // Spool holders: two on each side, outside the side panels, with a feeder each side.
    for (const side of [-1, 1]) {
      const sx = side < 0 ? x0 - 2 : x1 + 2;
      add(box(geo(), side < 0 ? sx - 54 : sx, 20, 530, side < 0 ? sx : sx + 54, 290, 560), COL.baseDark, { pick: side < 0 ? 'feeder-left' : 'feeder-right' });
      for (const sy of [70, 240]) add(cyl(geo(), [sx + side * 40, sy, 420], 22, 70, 'x', 20), COL.hub);
    }
    return parts;
  }
  /* Glass panels, drawn after everything else so the inside shows through. */
  function glassParts() {
    const { x0, x1, y0, y1, z1 } = OUT, t = 2, parts = [];
    const add = (g, color, alpha) => parts.push({ g, color, alpha });
    add(box(geo(), x0 + 30, y0, BASE, x1 - 30, y0 + t, z1 - 26), COL.glass, 0.1);       // front door
    add(box(geo(), x0, y0 + 30, BASE, x0 + t, y1 - 30, z1 - 26), COL.smoke, 0.13);      // left
    add(box(geo(), x1 - t, y0 + 30, BASE, x1, y1 - 30, z1 - 26), COL.smoke, 0.13);      // right
    add(box(geo(), x0 + 30, y1 - t, BASE, x1 - 30, y1, z1 - 26), COL.smoke, 0.32);      // back
    add(box(geo(), x0 + 30, y0 + 30, z1 - 4, x1 - 30, y1 - 30, z1 - 2), COL.smoke, 0.12); // lid
    add(box(geo(), x1 - 70, y0 - 12, 360, x1 - 60, y0 - 2, 520), COL.rail, 0.95);         // door handle
    return parts;
  }

  /* ---- matrices ---- */
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function lookAt(e, c, up) {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2], l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx; l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1];
  }
  function mul(a, b) {
    const o = new Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s;
    }
    return o;
  }
  const hexRgb = (hex, fb = [0.6, 0.6, 0.62]) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255) : fb;
  };

  /* ---- the viewer ---- */
  function create(host, { onPick } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'twin3d';
    wrap.innerHTML = `<canvas class="twin3d-canvas" tabindex="0" role="img" aria-label="3D model of the printer. Drag to turn, scroll or pinch to zoom."></canvas><div class="twin3d-tags" aria-hidden="true"></div>`;
    host.appendChild(wrap);
    const canvas = wrap.querySelector('canvas'), tags = wrap.querySelector('.twin3d-tags');
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) { wrap.remove(); return null; }

    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { wrap.remove(); return null; }
    gl.useProgram(prog);
    const A = { pos: gl.getAttribLocation(prog, 'aPos'), nor: gl.getAttribLocation(prog, 'aNor') };
    const U = Object.fromEntries(['uVP', 'uOffset', 'uScale', 'uColor', 'uAlpha', 'uEye', 'uGlow', 'uMode', 'uShadow'].map(k => [k, gl.getUniformLocation(prog, k)]));
    gl.enableVertexAttribArray(A.pos); gl.enableVertexAttribArray(A.nor);
    gl.enable(gl.DEPTH_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const upload = g => {
      const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.p), gl.STATIC_DRAW);
      const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.n), gl.STATIC_DRAW);
      return { pb, nb, count: g.p.length / 3 };
    };
    const free = m => { gl.deleteBuffer(m.pb); gl.deleteBuffer(m.nb); };
    // Merge the static machine by colour: a few draw calls instead of dozens.
    const merged = new Map();
    staticParts().forEach(p => {
      const k = `${p.color.join()}|${p.glow || 0}`;
      if (!merged.has(k)) merged.set(k, { g: geo(), color: p.color, glow: p.glow || 0 });
      const m = merged.get(k); m.g.p.push(...p.g.p); m.g.n.push(...p.g.n);
    });
    const machine = [...merged.values()].map(m => ({ ...upload(m.g), color: m.color, glow: m.glow }));
    const glass = glassParts().map(p => ({ ...upload(p.g), color: p.color, alpha: p.alpha }));
    const floor = upload(box(geo(), OUT.x0 - 260, OUT.y0 - 260, -7, OUT.x1 + 260, OUT.y1 + 260, -6));
    const meshes = {
      head: upload(headGeo()), face: upload(headFaceGeo()), stripe: upload(headStripeGeo()), nozzle: upload(nozzleGeo()),
      plate: upload(box(geo(), -8, -8, -6, BED + 8, BED + 8, 0)),
      heater: upload(box(geo(), -2, -2, -22, BED + 2, BED + 2, -6)),
      arms: upload(box(geo(), -28, 230, -26, 298, 372, -12)),
      carriage: upload(box(geo(), -26, -10, -8, 26, 10, 8)),
      xbeam: upload(box(geo(), -44, -9, -8, 314, 9, 8)),
      grid: (() => { const g = geo(); for (let k = 45; k < BED; k += 45) { box(g, k - 0.6, 0, 0, k + 0.6, BED, 0.4); box(g, 0, k - 0.6, 0, BED, k + 0.6, 0.4); } return upload(g); })(),
      spoolFlange: upload(cyl(geo(), [0, 0, 0], 100, 8, 'x', 40)),
      spoolCore: upload(cyl(geo(), [0, 0, 0], 82, 52, 'x', 40, false)),
    };
    let parts = [], partsKey = '';

    const cam = { yaw: VIEWS.iso[0], pitch: VIEWS.iso[1], zoom: 1, tx: 0, ty: 0 };
    let state = null, pos = [135, 135, 0], selected = '', W = 0, H = 0, queued = false, labels = [];

    function resize() {
      const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      if (!r.width || !r.height) return false;
      W = r.width; H = r.height;
      const w = Math.round(W * dpr), h = Math.round(H * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      return true;
    }
    function matrices() {
      const centre = [135, 360, -150];                      // GL: x, y up, z = -Y
      const yaw = cam.yaw * Math.PI / 180, pitch = cam.pitch * Math.PI / 180;
      // Far enough back that the whole machine, spools included (about
      // 800 x 760 mm seen from the front), fits the card at zoom 1.
      const t = Math.tan(15 * Math.PI / 180);
      const dist = Math.max(470 / t, 470 / (t * (W / H))) / cam.zoom;
      const dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
      // Pan moves the point the camera looks at, across the screen.
      const right = [Math.cos(yaw), 0, -Math.sin(yaw)], up = [-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch)];
      const target = centre.map((c, i) => c + right[i] * cam.tx + up[i] * cam.ty);
      const eye = target.map((c, i) => c + dir[i] * dist);
      const VP = mul(perspective(30 * Math.PI / 180, W / H, 60, 6000), lookAt(eye, target, [0, 1, 0]));
      return { VP, eye };
    }
    const project = (VP, x, y, z) => {
      const p = [x, z, -y, 1], o = [0, 0, 0, 0];
      for (let j = 0; j < 4; j++) o[j] = VP[j] * p[0] + VP[4 + j] * p[1] + VP[8 + j] * p[2] + VP[12 + j] * p[3];
      return [(o[0] / o[3] * 0.5 + 0.5) * W, (1 - (o[1] / o[3] * 0.5 + 0.5)) * H, o[3]];
    };

    function draw(m, color, { offset = [0, 0, 0], scale = [1, 1, 1], alpha = 1, glow = 0 } = {}) {
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pb); gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.nb); gl.vertexAttribPointer(A.nor, 3, gl.FLOAT, false, 0, 0);
      gl.uniform3fv(U.uOffset, offset); gl.uniform3fv(U.uScale, scale);
      gl.uniform3fv(U.uColor, color); gl.uniform1f(U.uAlpha, alpha); gl.uniform1f(U.uGlow, glow);
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
    }
    const lift = (c, k) => c.map(v => Math.min(1, v + (1 - v) * k));

    function render() {
      queued = false;
      if (!state || !resize()) return;
      const { VP, eye } = matrices();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(U.uVP, false, new Float32Array(VP)); gl.uniform3fv(U.uEye, eye);
      gl.uniform1i(U.uMode, 0); gl.disable(gl.BLEND); gl.depthMask(true);

      const [x, y, z] = pos, bedTop = TIP - Math.max(0, Math.min(BED, z));
      const heads = Object.entries(state.toolheads || {});
      const active = state.toolheads && state.toolheads[state.active_toolhead] ? state.active_toolhead : null;
      const printing = ['printing', 'paused'].includes(state.state);

      machine.forEach(m => draw(m, m.color, { glow: m.glow }));
      // Bed: build plate, heater, the arms that carry it.
      const bedSel = selected === 'bed' ? 0.25 : 0;
      draw(meshes.heater, COL.heater, { offset: [0, 0, bedTop] });
      draw(meshes.arms, COL.beam, { offset: [0, 0, bedTop] });
      const heat = state.bed && state.bed.target > 0 ? Math.min(1, (state.bed.temp || 0) / 110) : 0;
      draw(meshes.plate, lift(COL.plate, bedSel + heat * 0.06), { offset: [0, 0, bedTop], glow: bedSel });
      draw(meshes.grid, COL.plateMark, { offset: [0, 0, bedTop] });
      // X beam and the carriage at the head's Y.
      draw(meshes.xbeam, COL.beam, { offset: [0, y, TIP + 74] });
      draw(meshes.carriage, COL.rail, { offset: [x, y, TIP + 74] });

      // The parts on the plate, grown to the current height.
      const plate = state.objects && Array.isArray(state.objects.list) ? state.objects : null;
      const key = plate && printing ? JSON.stringify(plate.list.map(o => o.polygon)) : '';
      if (key !== partsKey) {
        parts.forEach(p => free(p.mesh)); parts = []; partsKey = key;
        if (plate && printing) plate.list.forEach(o => { if (Array.isArray(o.polygon) && o.polygon.length >= 3) parts.push({ name: o.name, mesh: upload(prism(geo(), o.polygon)) }); });
      }
      const activeColour = active ? hexRgb(state.toolheads[active].filament_color_hex) : [0.6, 0.6, 0.62];
      if (parts.length) {
        const excluded = new Set((plate && plate.excluded) || []), h = Math.max(0.6, Math.min(BED, z));
        parts.forEach(p => {
          const skip = excluded.has(p.name), sel = selected === `obj:${p.name}`;
          draw(p.mesh, skip ? [0.55, 0.55, 0.58] : activeColour, { offset: [0, 0, bedTop], scale: [1, 1, skip ? Math.min(h, 2) : h], glow: sel ? 0.35 : 0 });
        });
      } else if (printing) {
        // No outlines from the file: a simple block where the print is.
        draw(meshes.plate, activeColour, { offset: [80, 80, bedTop + 0.01], scale: [110 / (BED + 16), 110 / (BED + 16), Math.max(0.1, Math.min(BED, z)) / 6] });
      }

      // Heads: parked in their docks, the active one on the carriage.
      labels = [];
      heads.forEach(([name, d], i) => {
        const on = name === active, sel = selected === `head:${name}`;
        const hx = on ? x : dockX(i, heads.length), hy = on ? y : DOCK_Y, colour = hexRgb(d.filament_color_hex);
        const fault = d.status === 'error';
        const o = [hx, hy, TIP];
        draw(meshes.head, fault ? [0.55, 0.12, 0.1] : COL.head, { offset: o, glow: sel ? 0.3 : 0 });
        draw(meshes.face, COL.headFace, { offset: o, glow: sel ? 0.2 : 0 });
        draw(meshes.stripe, colour, { offset: o, glow: 0.35 });
        draw(meshes.nozzle, COL.nozzle, { offset: o });
        labels.push({ id: `head:${name}`, text: name, colour: d.filament_color_hex || '#999999', at: project(VP, hx, hy, TIP + HEAD.cone + HEAD.h + 22), head: project(VP, hx, hy, TIP + HEAD.cone + HEAD.h / 2), on, fault });
      });

      // Spools: T0/T1 on the left, T2/T3 on the right (an assumption, stated in the card).
      heads.slice(0, 4).forEach(([name, d], i) => {
        const left = i < 2, sx = left ? OUT.x0 - 42 : OUT.x1 + 42, sy = i % 2 ? 240 : 70;
        const colour = hexRgb(d.filament_color_hex);
        draw(meshes.spoolCore, colour, { offset: [sx, sy, 420], glow: selected === `head:${name}` ? 0.3 : 0 });
        draw(meshes.spoolFlange, [0.16, 0.17, 0.19], { offset: [sx - 30, sy, 420] });
        draw(meshes.spoolFlange, [0.16, 0.17, 0.19], { offset: [sx + 30, sy, 420] });
      });

      // Floor shadow, then glass (no depth writes, so it never hides what's behind it).
      gl.enable(gl.BLEND); gl.depthMask(false);
      gl.uniform1i(U.uMode, 1);
      gl.uniform4f(U.uShadow, 135, -155, 420, 380);
      draw(floor, COL.floor);
      gl.uniform1i(U.uMode, 0);
      glass.forEach(m => draw(m, m.color, { alpha: m.alpha }));
      gl.depthMask(true); gl.disable(gl.BLEND);

      // Name tags over the heads, in HTML so they stay crisp. A tag that
      // would sit on top of another moves up above it.
      const placed = [];
      labels.slice().sort((a, b) => b.at[1] - a.at[1]).forEach(l => {
        const w = l.on ? 104 : 46, h = 22;
        let y = l.at[1];
        for (let tries = 0; tries < 6; tries++) {
          const hit = placed.find(p => Math.abs(p.x - l.at[0]) < (p.w + w) / 2 && Math.abs(p.y - y) < h);
          if (!hit) break;
          y = hit.y - h - 2;
        }
        l.at = [l.at[0], y, l.at[2]];
        placed.push({ x: l.at[0], y, w });
      });
      const html = labels.map(l => `<span class="t3-tag${l.on ? ' on' : ''}${l.fault ? ' fault' : ''}${selected === l.id ? ' sel' : ''}" data-id="${esc(l.id)}" style="left:${l.at[0].toFixed(1)}px;top:${l.at[1].toFixed(1)}px"><i style="background:${/^#[0-9a-f]{6}$/i.test(l.colour) ? l.colour : '#999'}"></i>${esc(l.text)}${l.on ? ' · printing' : ''}</span>`).join('');
      if (tags.innerHTML !== html) tags.innerHTML = html;
    }
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(render); } };

    /* ---- interaction: drag to turn, right-drag or two fingers to pan,
     *      wheel or pinch to zoom, double-click to reset, click to pick ---- */
    const touches = new Map();
    let drag = null;
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture?.(e.pointerId);
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, tx: cam.tx, ty: cam.ty, pan: e.button === 2 || e.shiftKey, moved: false, zoom: cam.zoom, spread: 0 };
      if (touches.size === 2) { const [a, b] = [...touches.values()]; drag.spread = Math.hypot(a.x - b.x, a.y - b.y); drag.mid = [(a.x + b.x) / 2, (a.y + b.y) / 2]; }
    });
    canvas.addEventListener('pointermove', e => {
      if (!drag || !touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2 && drag.spread) {
        const [a, b] = [...touches.values()], spread = Math.hypot(a.x - b.x, a.y - b.y);
        cam.zoom = Math.max(0.6, Math.min(4, drag.zoom * spread / drag.spread));
        drag.moved = true; queue(); return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      if (drag.pan) { const k = 1.6 / cam.zoom; cam.tx = drag.tx - dx * k; cam.ty = drag.ty + dy * k; }
      else { cam.yaw = drag.yaw - dx * 0.4; cam.pitch = Math.max(-5, Math.min(89, drag.pitch + dy * 0.3)); }
      viewChanged(null); queue();
    });
    const end = e => {
      touches.delete(e.pointerId);
      if (drag && !drag.moved && e.type === 'pointerup') pick(e);
      if (!touches.size) drag = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { e.preventDefault(); cam.zoom = Math.max(0.6, Math.min(4, cam.zoom * Math.exp(-e.deltaY * 0.0012))); queue(); }, { passive: false });
    canvas.addEventListener('dblclick', () => setView('iso'));
    canvas.addEventListener('keydown', e => {
      const k = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, 6], ArrowDown: [0, -6] }[e.key];
      if (k) { e.preventDefault(); cam.yaw += k[0]; cam.pitch = Math.max(-5, Math.min(89, cam.pitch + k[1])); viewChanged(null); queue(); }
      if (e.key === '+' || e.key === '=') { cam.zoom = Math.min(4, cam.zoom * 1.2); queue(); }
      if (e.key === '-') { cam.zoom = Math.max(0.6, cam.zoom / 1.2); queue(); }
      if (e.key === 'Escape') onPick && onPick(null);
    });
    tags.addEventListener('click', e => { const t = e.target.closest('.t3-tag'); if (t && onPick) onPick(t.dataset.id || null); });

    /* Clicking picks the nearest head (by its tag) or the bed (by its outline on screen). */
    function pick(e) {
      if (!onPick || !state) return;
      const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      let best = null, bd = 34;
      labels.forEach(l => { const d = Math.hypot(l.head[0] - px, l.head[1] - py); if (d < bd) { bd = d; best = l.id; } });
      if (!best) {
        const { VP } = matrices(), bedTop = TIP - Math.max(0, Math.min(BED, pos[2]));
        const c = [[0, 0], [BED, 0], [BED, BED], [0, BED]].map(([bx, by]) => project(VP, bx, by, bedTop));
        let inside = false;
        for (let i = 0, j = 3; i < 4; j = i++) {
          const [xi, yi] = c[i], [xj, yj] = c[j];
          if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) best = 'bed';
      }
      onPick(best);
    }

    let viewChanged = () => {};
    const glide = { raf: 0 };
    function setView(name) {
      const [ty, tp] = VIEWS[name] || VIEWS.iso;
      const from = { yaw: cam.yaw, pitch: cam.pitch, zoom: cam.zoom, tx: cam.tx, ty: cam.ty };
      const to = { yaw: from.yaw + ((((ty - from.yaw) % 360) + 540) % 360 - 180), pitch: tp, zoom: 1, tx: 0, ty: 0 };
      cancelAnimationFrame(glide.raf);
      viewChanged(name);
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { Object.assign(cam, to); queue(); return; }
      const t0 = performance.now();
      const step = now => {
        const k = Math.min(1, (now - t0) / 450), e = 1 - Math.pow(1 - k, 3);
        for (const key of Object.keys(to)) cam[key] = from[key] + (to[key] - from[key]) * e;
        render();
        if (k < 1) glide.raf = requestAnimationFrame(step);
      };
      glide.raf = requestAnimationFrame(step);
    }

    const ro = window.ResizeObserver ? new ResizeObserver(queue) : null;
    ro && ro.observe(canvas);

    return {
      el: wrap,
      update(s, p) { state = s; if (p) pos = p; queue(); },
      select(id) { selected = id || ''; queue(); },
      setView,
      onViewChange(fn) { viewChanged = fn; },
      zoomBy(f) { cam.zoom = Math.max(0.6, Math.min(4, cam.zoom * f)); queue(); },
      destroy() { ro && ro.disconnect(); wrap.remove(); },
    };
  }

  return { create, OUTER: OUT };
})();
