/* The Slicer's 3D scene: the plate with several objects on it, each with its own position, turn and size.
 *
 * It extends the shared viewer (viewer3d.js), which already draws the U1's plate, the room, the camera and the toolpath view, and adds
 * what a slicer needs on top:
 *   - items: every object has its own graphics buffers and a matrix, so moving one never rebuilds a mesh;
 *   - picking: the scene is drawn again in flat colours (one per object, one per handle) into a hidden picture and one pixel is read,
 *     so what is under the pointer is exact and costs the same for ten objects as for one;
 *   - drag to move on the plate, a ring to turn, a corner to scale, an arrow to move along one axis;
 *   - hover and selection (a clean outline, not a box), a red tint and a red footprint for anything outside the printable area,
 *     the overhang view, and the prime tower as a see-through block;
 *   - camera views (top, front, sides, the corner view) that glide.
 * It knows nothing about files or settings: the plate model (slicer-model.js) tells it what to draw and listens for gestures. */
'use strict';
window.SliceScene = (() => {
  const TAU = Math.PI * 2;
  const v3 = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: a => Math.hypot(a[0], a[1], a[2]),
    norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  };

  /* ---- matrices (column-major, as the graphics card wants them) ---------------------------------------------------------------- */
  const mat = {
    identity: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    /* an object's transform is 12 numbers, the way plate_project.py keeps it: three rows of the turn and scale, then the move */
    fromTransform(t) { return [t[0], t[1], t[2], 0, t[3], t[4], t[5], 0, t[6], t[7], t[8], 0, t[9], t[10], t[11], 1]; },
    translate(x, y, z) { const m = mat.identity(); m[12] = x; m[13] = y; m[14] = z; return m; },
    scale(x, y, z) { const m = mat.identity(); m[0] = x; m[5] = y; m[10] = z; return m; },
    mul(a, b) {
      const o = new Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      return o;
    },
    /* the matrix that turns normals: the inverse of the 3x3 part, turned over (so a mirrored or stretched object is still lit right) */
    normal(m) {
      const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
      const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
      const det = a * A + b * B + c * C || 1;
      return [A / det, B / det, C / det, -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det,
        (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det];
    },
    invert(m) {
      const r = Array.from({ length: 4 }, (_, i) => [m[i], m[4 + i], m[8 + i], m[12 + i], i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0, i === 3 ? 1 : 0]);
      for (let c = 0; c < 4; c++) {
        let best = c;
        for (let k = c + 1; k < 4; k++) if (Math.abs(r[k][c]) > Math.abs(r[best][c])) best = k;
        if (Math.abs(r[best][c]) < 1e-14) return null;
        [r[c], r[best]] = [r[best], r[c]];
        const p = r[c][c];
        r[c] = r[c].map(v => v / p);
        for (let k = 0; k < 4; k++) if (k !== c) { const f = r[k][c]; r[k] = r[k].map((v, j) => v - f * r[c][j]); }
      }
      const out = new Array(16);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) out[j * 4 + i] = r[i][4 + j];
      return out;
    }
  };

  /* ---- the camera's own maths ---------------------------------------------------------------------------------------------------- */
  function lookAt(eye, target, up) {
    const z = v3.norm(v3.sub(eye, target)), x = v3.norm(v3.cross(up, z)), y = v3.cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3.dot(x, eye), -v3.dot(y, eye), -v3.dot(z, eye), 1];
  }
  /* a lens with no perspective: parallel lines stay parallel, so a top view is a true plan */
  function orthographic(halfW, halfH, near, far) {
    return [1 / halfW, 0, 0, 0, 0, 1 / halfH, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1];
  }
  /* The camera sits on a ball round its target: yaw turns it round the vertical, pitch lifts it, dist is its distance. */
  const eyeOf = (target, dist, yaw, pitch) => [target[0] + dist * Math.cos(pitch) * Math.cos(yaw), target[1] + dist * Math.cos(pitch) * Math.sin(yaw), target[2] + dist * Math.sin(pitch)];
  /* the camera's right, up and forward directions for a yaw and pitch */
  function basisOf(yaw, pitch) {
    const f = [-Math.cos(pitch) * Math.cos(yaw), -Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch)];
    const right = v3.norm(v3.cross(f, [0, 0, 1])), up = v3.cross(right, f);
    return { f, right, up };
  }
  const MAX_PITCH = 1.5533;      // 89 degrees: straight above or below, without the up direction flipping
  const ORBIT_PER_PIXEL = 0.8 * Math.PI / 180;   // a turn per pixel of drag
  const ZOOM_STEP = 0.1;         // one wheel notch changes the distance by a tenth
  const CAMERA_DEFAULTS = { zoomToMouse: true, swap: false, reverse: false, orbit: 1 };

  /* ---- shapes for the handles --------------------------------------------------------------------------------------------------- */
  function shape() {
    const pos = [], nrm = [];
    const tri = (a, b, c) => {
      const n = v3.norm(v3.cross(v3.sub(b, a), v3.sub(c, a)));
      pos.push(...a, ...b, ...c); nrm.push(...n, ...n, ...n);
    };
    return { pos, nrm, tri, done: () => ({ pos: new Float32Array(pos), nrm: new Float32Array(nrm), count: pos.length / 3 }) };
  }
  /* a tube from a to b, radius r */
  function tube(s, a, b, r, seg = 10) {
    const u = v3.norm(v3.sub(b, a)), w = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const p = v3.norm(v3.cross(u, w)), q = v3.cross(u, p);
    const ring = k => v3.add(v3.mul(p, Math.cos(k * TAU / seg) * r), v3.mul(q, Math.sin(k * TAU / seg) * r));
    for (let k = 0; k < seg; k++) {
      const x = ring(k), y = ring(k + 1);
      s.tri(v3.add(a, x), v3.add(b, x), v3.add(b, y)); s.tri(v3.add(a, x), v3.add(b, y), v3.add(a, y));
    }
  }
  function cone(s, base, tip, r, seg = 12) {
    const u = v3.norm(v3.sub(tip, base)), w = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const p = v3.norm(v3.cross(u, w)), q = v3.cross(u, p);
    const ring = k => v3.add(base, v3.add(v3.mul(p, Math.cos(k * TAU / seg) * r), v3.mul(q, Math.sin(k * TAU / seg) * r)));
    for (let k = 0; k < seg; k++) { s.tri(ring(k), ring(k + 1), tip); s.tri(ring(k + 1), ring(k), base); }
  }
  function box(s, min, max) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const f = (a, b, c, d) => { s.tri(a, b, c); s.tri(a, c, d); };
    f([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); f([x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]);
    f([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); f([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]);
    f([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); f([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]);
  }
  /* a ring (torus) of radius R, tube radius r, lying round `axis` (0 x, 1 y, 2 z) */
  function ring(s, axis, R, r, seg = 56, side = 8) {
    const basis = [[[0, 1, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0]], [[1, 0, 0], [0, 1, 0]]][axis];
    const at = (t, k) => {
      const dir = v3.add(v3.mul(basis[0], Math.cos(t)), v3.mul(basis[1], Math.sin(t)));
      const out = v3.cross(basis[0], basis[1]);
      const c = v3.mul(dir, R), a = k * TAU / side;
      return v3.add(c, v3.add(v3.mul(dir, Math.cos(a) * r), v3.mul(out, Math.sin(a) * r)));
    };
    for (let i = 0; i < seg; i++) for (let k = 0; k < side; k++) {
      const t0 = i * TAU / seg, t1 = (i + 1) * TAU / seg;
      s.tri(at(t0, k), at(t1, k), at(t1, k + 1)); s.tri(at(t0, k), at(t1, k + 1), at(t0, k + 1));
    }
  }

  const VS = `attribute vec3 p; attribute vec3 n; attribute vec3 k; uniform mat4 vp; uniform mat4 model; uniform mat3 nmat; uniform float grow;
    varying vec3 vn; varying vec3 vw; varying vec3 vk;
    void main(){ vec3 nn = normalize(nmat * n); vec3 w = (model * vec4(p, 1.0)).xyz + nn * grow; vn = nn; vw = w; vk = k; gl_Position = vp * vec4(w, 1.0); }`;
  /* Lit like the rest of the app's 3D: sky and bounce light, a key light with a soft glint and a cool rim. `lit` 0 is a flat colour (the
     handles, the picking pass); `over` paints faces that hang over (steeper than 45 degrees) red, the overhang view. */
  const FS = `precision mediump float; varying vec3 vn; varying vec3 vw; varying vec3 vk;
    uniform vec3 base; uniform float colored; uniform vec3 tint; uniform float tintAmt; uniform float alpha; uniform vec3 eye; uniform vec3 l; uniform float lit; uniform float over;
    void main(){
      vec3 col = mix(base, vk, colored);
      vec3 nn = normalize(vn), v = normalize(eye - vw);
      if (dot(nn, v) < 0.0) nn = -nn;
      if (over > 0.5 && vn.z < -0.7071) col = mix(col, vec3(0.93, 0.27, 0.27), 0.78);
      col = mix(col, tint, tintAmt);
      if (lit < 0.5) { gl_FragColor = vec4(col, alpha); return; }
      vec3 L = normalize(l), h = normalize(L + v);
      float diff = max(dot(nn, L), 0.0), hemi = 0.5 + 0.5 * nn.z;
      vec3 amb = mix(vec3(0.20, 0.21, 0.24), vec3(0.64, 0.66, 0.72), hemi);
      float spec = pow(max(dot(nn, h), 0.0), 40.0) * 0.3;
      float rim = pow(1.0 - max(dot(nn, v), 0.0), 3.0) * 0.2;
      gl_FragColor = vec4(col * (amb * 0.85 + diff * 0.8) + vec3(spec) + rim * vec3(0.55, 0.68, 0.9), alpha); }`;

  /* The toolpath: one ribbon per move, drawn with instancing, coloured on the graphics card. Each move is an instance of a four-corner strip that
     runs from its start to its end and is as wide as the line the slicer wrote. Hiding a layer, a line type or the moves after the slider is
     one test in the vertex shader, so a print of a million moves still turns smoothly. */
  const PATH_VS = `attribute vec2 q; attribute vec3 p0; attribute vec3 p1; attribute vec4 a; attribute vec4 c;
    uniform mat4 vp; uniform float mode; uniform vec3 fcol[16]; uniform vec3 tcol[4]; uniform float fshow[16]; uniform vec2 rng; uniform float minL; uniform float maxL; uniform float limit; uniform float showTravel;
    varying vec3 vc; varying float vedge;
    vec3 ramp(float t){ t = clamp(t, 0.0, 1.0); vec3 c1 = vec3(0.16, 0.34, 0.86), c2 = vec3(0.12, 0.74, 0.58), c3 = vec3(0.96, 0.84, 0.2), c4 = vec3(0.93, 0.26, 0.22);
      return t < 0.33 ? mix(c1, c2, t / 0.33) : t < 0.66 ? mix(c2, c3, (t - 0.33) / 0.33) : mix(c3, c4, (t - 0.66) / 0.34); }
    void main(){
      float extr = floor(a.x / 256.0), rest = a.x - extr * 256.0, tl = floor(rest / 32.0), ft = rest - tl * 32.0;
      float layer = a.y, speed = a.z, ord = a.w, w = c.x * 2.55, h = c.y * 2.55;
      float vis = 1.0;
      if (layer < minL || layer > maxL) vis = 0.0;
      if (layer >= maxL && ord > limit) vis = 0.0;
      if (extr < 0.5 && showTravel < 0.5) vis = 0.0;
      if (extr > 0.5 && fshow[int(ft)] < 0.5) vis = 0.0;
      vec3 col;
      if (extr < 0.5) col = vec3(0.5, 0.56, 0.68);
      else if (mode < 0.5) col = fcol[int(ft)];
      else if (mode < 1.5) col = tcol[int(tl)];
      else if (mode < 2.5) col = ramp((speed - rng.x) / max(rng.y - rng.x, 0.001));
      else if (mode < 3.5) col = ramp((w * h * speed - rng.x) / max(rng.y - rng.x, 0.001));
      else if (mode < 4.5) col = ramp((h - rng.x) / max(rng.y - rng.x, 0.001));
      else col = ramp((w - rng.x) / max(rng.y - rng.x, 0.001));
      vec2 d = p1.xy - p0.xy; float l = length(d); vec2 dir = l > 1e-6 ? d / l : vec2(1.0, 0.0); vec2 nrm = vec2(-dir.y, dir.x);
      float width = extr > 0.5 ? max(w, 0.2) : 0.14;
      vec3 pos = mix(p0, p1, q.x);
      pos.xy += nrm * q.y * width * 0.5 + dir * (q.x * 2.0 - 1.0) * width * 0.25;
      if (extr > 0.5) pos.z -= h * 0.5;
      vc = col; vedge = abs(q.y);
      gl_Position = vis > 0.5 ? vp * vec4(pos, 1.0) : vec4(2.0, 2.0, 2.0, 1.0); }`;
  const PATH_FS = `precision mediump float; varying vec3 vc; varying float vedge; void main(){ gl_FragColor = vec4(vc * (1.0 - 0.30 * vedge * vedge), 1.0); }`;
  const FEATURE_COLOURS = [[1.0, 0.55, 0.2], [0.93, 0.78, 0.2], [0.35, 0.45, 0.95], [0.85, 0.28, 0.25], [0.7, 0.2, 0.2], [0.78, 0.35, 0.85], [0.55, 0.55, 0.62], [0.2, 0.7, 0.9], [0.4, 0.75, 0.4],
    [0.6, 0.6, 0.35], [0.7, 0.5, 0.3], [0.2, 0.75, 0.6], [0.35, 0.55, 0.5], [0.75, 0.7, 0.8], [0.5, 0.5, 0.55], [0.6, 0.6, 0.6]];

  const BED = 270;
  const AXIS = [[0.93, 0.36, 0.36], [0.35, 0.78, 0.45], [0.33, 0.58, 0.98]];
  const PICK_BASE = 1000;      // handles are 1000 and up; objects are 1 to 999
  const HANDLES = { moveX: 1001, moveY: 1002, moveZ: 1003, moveXY: 1004, rotX: 1011, rotY: 1012, rotZ: 1013, scaleAll: 1021 };

  class SliceScene extends DV3D.Viewer {
    bindInput() { /* the scene has its own (bindScene), which tells an object from the empty plate */ }

    constructor(canvas) {
      super(canvas);
      const gl = this.gl;
      this.items = new Map();
      this.listeners = {};
      this.mode = 'prepare';          // 'prepare' draws the objects, 'preview' draws the toolpath
      this.tool = 'move';             // which handles show on the selected object: move, rotate, scale or none
      this.selected = new Set();
      this.hover = null;
      this.showVolume = true;
      this.overhang = false;
      this.accent = [0.26, 0.56, 1];
      this.objProg = this.program(VS, FS);
      this.pathProg = this.program(PATH_VS, PATH_FS);
      this.inst = gl.getExtension('ANGLE_instanced_arrays');
      this.pathBuf = null;
      this.pathView = { mode: 0, minL: 0, maxL: 1e9, limit: 1e12, showTravel: false, fshow: new Array(16).fill(1), range: [0, 1], tools: [[0.95, 0.52, 0.2], [0.3, 0.6, 0.95], [0.35, 0.75, 0.45], [0.88, 0.32, 0.4]] };
      this.quad = this.buffer(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]));
      this.handles = this.buildHandles();
      this.shadowOf = null;
      this.pick = null;
      this.gesture = null;
      this.anim = null;
      this.cursorFor = '';
      this.pickMode = false;          // a click on a surface is reported (Lay on face, Measure) instead of starting a drag
      this.insets = { left: 0, right: 0, top: 0, bottom: 0 };
      this.free = null;
      this.ortho = false;             // the six flat views look through a lens with no perspective; any turn of the view brings the perspective one back
      this.prefs = { ...CAMERA_DEFAULTS };   // zoom to the pointer, swap the buttons, reverse the wheel, orbit speed: Snapmaker Orca's four camera options
      this.rubber = null;             // the rectangle being dragged to select several objects
      this.pointerFocused = false;    // the 3D view has the keyboard because of a mouse press (never because Tab landed on it)
      this.bindScene();
      this.fitPlate(false);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.draw();
    }

    /* ---- events ----------------------------------------------------------------------------------------------------------------- */
    on(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); return this; }
    emit(name, detail) { for (const fn of this.listeners[name] || []) fn(detail); }

    /* ---- items ------------------------------------------------------------------------------------------------------------------ */
    /* item: { id (1 to 999), mesh: { positions, normals, colours?, bounds }, transform (12), color [r,g,b], keepColour, fixedSize } */
    addItem(item) {
      this.removeItem(item.id);
      const m = item.mesh;
      const entry = {
        id: item.id, color: item.color || [0.78, 0.8, 0.84], keepColour: !!item.keepColour && !!m.colours, hidden: false, ghost: !!item.ghost,
        pos: this.buffer(m.positions), nrm: this.buffer(m.normals), col: m.colours ? this.buffer(m.colours) : null, count: m.positions.length / 3,
        local: { min: m.bounds.min.slice(), max: m.bounds.max.slice() }, transform: item.transform.slice(), outside: false, fixedSize: !!item.fixedSize,
        label: item.label || '', bounds: null
      };
      this.items.set(item.id, entry);
      this.setItemTransform(item.id, item.transform);
      return entry;
    }

    removeItem(id) {
      const it = this.items.get(id);
      if (!it) return;
      for (const k of ['pos', 'nrm', 'col']) if (it[k]) this.gl.deleteBuffer(it[k]);
      this.items.delete(id);
      this.selected.delete(id);
      this.draw();
    }

    clearItems() { for (const id of [...this.items.keys()]) this.removeItem(id); }

    setItemTransform(id, t, bounds) {
      const it = this.items.get(id);
      if (!it) return;
      it.transform = t.slice();
      it.model = mat.fromTransform(t);
      it.nmat = mat.normal(it.model);
      it.bounds = bounds || this.boundsOf(it);
      this.draw();
    }

    /* the box round an object where it stands now, from the corners of its own box: never smaller than the object */
    boundsOf(it) {
      const { min, max } = it.local, m = it.model, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < 8; i++) {
        const x = i & 1 ? max[0] : min[0], y = i & 2 ? max[1] : min[1], z = i & 4 ? max[2] : min[2];
        for (let c = 0; c < 3; c++) {
          const v = x * m[c] + y * m[4 + c] + z * m[8 + c] + m[12 + c];
          lo[c] = Math.min(lo[c], v); hi[c] = Math.max(hi[c], v);
        }
      }
      return { min: lo, max: hi };
    }

    setItemColor(id, rgb) { const it = this.items.get(id); if (it) { it.color = rgb; this.draw(); } }
    setItemOutside(id, flag) { const it = this.items.get(id); if (it && it.outside !== !!flag) { it.outside = !!flag; this.draw(); } }
    setItemHidden(id, flag) { const it = this.items.get(id); if (it) { it.hidden = !!flag; this.draw(); } }

    select(ids) { this.selected = new Set(ids); this.draw(); }
    setTool(tool) { this.tool = tool; this.draw(); }
    setMode(mode) { this.mode = mode; this.draw(); }
    setOverhang(on) { this.overhang = !!on; this.draw(); }

    /* ---- camera ----------------------------------------------------------------------------------------------------------------- */
    animateTo(to, ms = 320) {
      const from = { yaw: this.yaw, pitch: this.pitch, dist: this.dist, target: this.target.slice() };
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) ms = 0;
      // turn the short way round
      let dy = to.yaw !== undefined ? ((to.yaw - from.yaw + Math.PI) % TAU + TAU) % TAU - Math.PI : 0;
      const start = performance.now();
      const step = now => {
        const t = ms ? Math.min(1, (now - start) / ms) : 1, e = 1 - Math.pow(1 - t, 3);
        if (to.yaw !== undefined) this.yaw = from.yaw + dy * e;
        if (to.pitch !== undefined) this.pitch = from.pitch + (to.pitch - from.pitch) * e;
        if (to.dist !== undefined) this.dist = from.dist + (to.dist - from.dist) * e;
        if (to.target) this.target = from.target.map((v, i) => v + (to.target[i] - v) * e);
        this.render();
        this.anim = t < 1 ? requestAnimationFrame(step) : 0;
      };
      if (this.anim) cancelAnimationFrame(this.anim);
      this.anim = requestAnimationFrame(step);
    }

    /* The corner view is the one a slicer opens on; the others look straight down, up or along an axis, through the flat lens, like Snapmaker
       Orca's (its Top, Bottom, Front, Rear, Left and Right). The flat views look level, so a model's height reads true. */
    setView(name) {
      const c = [BED / 2, BED / 2, 40];
      const views = {
        iso: { yaw: -Math.PI / 2, pitch: Math.PI / 4 }, top: { yaw: -Math.PI / 2, pitch: MAX_PITCH }, front: { yaw: -Math.PI / 2, pitch: 0 },
        back: { yaw: Math.PI / 2, pitch: 0 }, left: { yaw: Math.PI, pitch: 0 }, right: { yaw: 0, pitch: 0 }, bottom: { yaw: -Math.PI / 2, pitch: -MAX_PITCH }
      };
      const v = views[name] || views.iso;
      this.ortho = name !== 'iso' && !!views[name];
      this.animateTo({ yaw: v.yaw, pitch: v.pitch, dist: this.fitDistance(), target: c });
    }

    /* The window is the canvas, but panels float over its edges. The free area is what is left; the plate is centred in it and sized to it. */
    applyInsets() {
      const c = this.canvas.getBoundingClientRect(), root = document.getElementById('sl-root');
      // On a phone the picture is a block of its own at the top of the page: the whole canvas is free.
      if (!root || !c.width || matchMedia('(max-width: 720px)').matches) { this.free = null; this.draw(); return; }
      const r = root.getBoundingClientRect(), i = this.insets;
      this.free = { x0: r.left - c.left + i.left, y0: r.top - c.top + i.top, x1: r.right - c.left - i.right, y1: r.bottom - c.top - i.bottom };
      this.draw();
    }

    /* the flat lens: the same size at the target as the perspective one, so changing lens does not make the plate jump */
    orthoMatrix() {
      const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
      this.eye = eyeOf(this.target, this.dist, this.yaw, this.pitch);
      const halfH = this.dist * Math.tan(0.4);
      return mat.mul(orthographic(halfH * w / h, halfH, -1500, 4000), lookAt(this.eye, this.target, [0, 0, 1]));
    }

    matrix() {
      const m = this.ortho ? this.orthoMatrix() : Array.from(super.matrix()), f = this.free, w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
      if (!f) return m;
      const tx = ((f.x0 + f.x1) / 2 - w / 2) / (w / 2), ty = -((f.y0 + f.y1) / 2 - h / 2) / (h / 2);
      for (const k of [0, 4, 8, 12]) { m[k] += tx * m[k + 3]; m[k + 1] += ty * m[k + 3]; }
      return m;
    }

    fitDistance(size = 360) {
      const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1, f = this.free || { x0: 0, y0: 0, x1: w, y1: h };
      const freeW = Math.max(120, f.x1 - f.x0), freeH = Math.max(120, f.y1 - f.y0), t = Math.tan(0.4);
      const byH = (size * 1.08 / 2) / (t * freeH / h), byW = (size * 1.08 / 2) / (t * (w / h) * freeW / w);
      return Math.max(120, byH, byW);
    }

    fitPlate(animate = true) {
      const to = { dist: this.fitDistance(), target: [BED / 2, BED / 2, 30] };
      if (animate) this.animateTo(to); else { this.dist = to.dist; this.target = to.target; this.yaw = -Math.PI / 2; this.pitch = Math.PI / 4; this.ortho = false; }
    }

    /* frame every object on the plate (or the plate itself when it is empty) */
    fitAll() { const keep = this.selected; this.selected = new Set(); this.fitSelection(); this.selected = keep; }

    /* frame the selected objects, or every object, or the plate */
    fitSelection() {
      const ids = this.selected.size ? [...this.selected] : [...this.items.keys()];
      const rows = ids.map(id => this.items.get(id)).filter(it => it && !it.hidden && !it.ghost);
      if (!rows.length) return this.fitPlate();
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const it of rows) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], it.bounds.min[c]); hi[c] = Math.max(hi[c], it.bounds.max[c]); }
      const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 30);
      this.animateTo({ dist: this.fitDistance(size * 1.35), target: lo.map((v, i) => (v + hi[i]) / 2) });
    }

    /* ---- the ray under the pointer ------------------------------------------------------------------------------------------------ */
    rayAt(clientX, clientY) {
      const r = this.canvas.getBoundingClientRect();
      const x = ((clientX - r.left) / r.width) * 2 - 1, y = 1 - ((clientY - r.top) / r.height) * 2;
      const inv = mat.invert(this.matrix());
      const at = z => {
        const v = [x, y, z, 1], o = [0, 0, 0, 0];
        for (let i = 0; i < 4; i++) o[i] = inv[i] * v[0] + inv[4 + i] * v[1] + inv[8 + i] * v[2] + inv[12 + i] * v[3];
        return [o[0] / o[3], o[1] / o[3], o[2] / o[3]];
      };
      const near = at(-1), far = at(1);
      return { o: near, d: v3.norm(v3.sub(far, near)) };
    }

    planePoint(ray, z) {
      if (Math.abs(ray.d[2]) < 1e-6) return null;
      const t = (z - ray.o[2]) / ray.d[2];
      return t > 0 ? v3.add(ray.o, v3.mul(ray.d, t)) : null;
    }

    /* where a ray first enters a box, or null */
    boxHit(ray, b) {
      let t0 = 0, t1 = Infinity;
      for (let c = 0; c < 3; c++) {
        if (Math.abs(ray.d[c]) < 1e-9) { if (ray.o[c] < b.min[c] || ray.o[c] > b.max[c]) return null; continue; }
        let a = (b.min[c] - ray.o[c]) / ray.d[c], z = (b.max[c] - ray.o[c]) / ray.d[c];
        if (a > z) [a, z] = [z, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, z);
        if (t0 > t1) return null;
      }
      return v3.add(ray.o, v3.mul(ray.d, t0));
    }

    /* how far along an axis line (through a, direction u) the pointer's ray comes nearest to it: the closest point between two lines */
    axisParam(ray, a, u) {
      const w0 = v3.sub(a, ray.o), b = v3.dot(u, ray.d), d = v3.dot(u, w0), e = v3.dot(ray.d, w0), den = 1 - b * b;
      if (Math.abs(den) < 1e-6) return 0;
      return (b * e - d) / den;
    }

    /* ---- handles ------------------------------------------------------------------------------------------------------------------ */
    buildHandles() {
      const g = {}, make = fn => { const s = shape(); fn(s); return s.done(); };
      const gl = this.gl, up = s => ({ ...s, pos: this.buffer(s.pos), nrm: this.buffer(s.nrm) });
      // an arrow of length 1 along +x, +y or +z; handles are drawn at a size that follows the distance to the camera
      for (const [axis, name] of [[0, 'moveX'], [1, 'moveY'], [2, 'moveZ']]) {
        const end = [0, 0, 0]; end[axis] = 1;
        const mid = [0, 0, 0]; mid[axis] = 0.78;
        g[name] = up(make(s => { tube(s, [0, 0, 0], mid, 0.045); cone(s, mid, end, 0.12); }));
      }
      g.moveXY = up(make(s => box(s, [0.28, 0.28, -0.02], [0.62, 0.62, 0.02])));
      for (const [axis, name] of [[0, 'rotX'], [1, 'rotY'], [2, 'rotZ']]) g[name] = up(make(s => ring(s, axis, 1, 0.032)));
      g.scaleAll = up(make(s => box(s, [-0.07, -0.07, -0.07], [0.07, 0.07, 0.07])));
      g.cube = up(make(s => box(s, [0, 0, 0], [1, 1, 1])));
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      return g;
    }

    /* which handles show, where, and how big: bigger when the camera is far, so they stay the same size on screen */
    handleSet() {
      if (this.mode !== 'prepare' || this.selected.size !== 1 || this.tool === 'none' || this.gesture?.kind === 'orbit') return [];
      const it = this.items.get([...this.selected][0]);
      if (!it || it.hidden || it.ghost) return [];
      const b = it.bounds, c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      const s = this.dist * 0.11, out = [];
      const at = (name, origin, scale) => out.push({ name, id: HANDLES[name], origin, scale, colour: null });
      if (this.tool === 'move') {
        at('moveX', c, s); at('moveY', c, s); if (!it.fixedSize) at('moveZ', c, s); at('moveXY', c, s);
        out[0].colour = AXIS[0]; out[1].colour = AXIS[1]; if (!it.fixedSize) out[2].colour = AXIS[2];
        out[out.length - 1].colour = [0.95, 0.85, 0.35];
      } else if (this.tool === 'rotate' && !it.fixedSize) {
        const R = Math.max(s * 0.95, Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) * 0.62);
        at('rotX', c, R); at('rotY', c, R); at('rotZ', c, R);
        out[0].colour = AXIS[0]; out[1].colour = AXIS[1]; out[2].colour = AXIS[2];
      } else if (this.tool === 'scale' && !it.fixedSize) {
        at('scaleAll', [b.max[0], b.max[1], b.max[2]], s * 0.9);
        out[0].colour = [0.95, 0.85, 0.35];
      }
      return out;
    }

    /* ---- drawing ------------------------------------------------------------------------------------------------------------------ */
    render() {
      super.render();                       // the room, the plate, a toolpath if there is one
      const gl = this.gl, canvas = this.canvas;
      if (!canvas.width || !canvas.height) return;
      const m = this.matrix(), light = [Math.cos(this.yaw + 0.6), Math.sin(this.yaw + 0.6), 0.8];
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      if (this.mode === 'prepare') {
        this.drawFootprints(m);
        this.drawItems(m, light, false);
        this.drawOutlines(m, light);
        this.drawHandles(m, light, false);
      } else if (this.pathBuf) this.drawPath(m);
    }

    uniforms(prog, m, light) {
      const gl = this.gl, u = n => gl.getUniformLocation(prog, n);
      gl.useProgram(prog);
      gl.uniformMatrix4fv(u('vp'), false, m);
      gl.uniform3fv(u('eye'), this.eye);
      gl.uniform3fv(u('l'), light);
      return u;
    }

    drawItem(u, it, opts) {
      const gl = this.gl, prog = this.objProg;
      gl.uniformMatrix4fv(u('model'), false, opts.model || it.model);
      gl.uniformMatrix3fv(u('nmat'), false, opts.nmat || it.nmat);
      gl.uniform1f(u('grow'), opts.grow || 0);
      gl.uniform3fv(u('base'), opts.base || it.color);
      gl.uniform3fv(u('tint'), opts.tint || [0, 0, 0]);
      gl.uniform1f(u('tintAmt'), opts.tintAmt || 0);
      gl.uniform1f(u('alpha'), opts.alpha === undefined ? 1 : opts.alpha);
      gl.uniform1f(u('lit'), opts.lit === undefined ? 1 : opts.lit);
      gl.uniform1f(u('over'), opts.over ? 1 : 0);
      const painted = !!opts.colored && !!it.col;
      gl.uniform1f(u('colored'), painted ? 1 : 0);
      const locs = [this.attrib(prog, 'p', it.pos, 3), this.attrib(prog, 'n', it.nrm, 3)];
      const k = gl.getAttribLocation(prog, 'k');
      if (painted) locs.push(this.attrib(prog, 'k', it.col, 3)); else { gl.disableVertexAttribArray(k); gl.vertexAttrib3f(k, 1, 1, 1); }
      gl.drawArrays(gl.TRIANGLES, 0, it.count);
      for (const l of locs) gl.disableVertexAttribArray(l);
    }

    drawItems(m, light, picking) {
      const gl = this.gl, u = this.uniforms(this.objProg, m, light);
      for (const it of this.items.values()) {
        if (it.hidden) continue;
        const sel = this.selected.has(it.id), hov = this.hover === it.id;
        if (it.ghost) {
          gl.depthMask(false);
          this.drawItem(u, it, { alpha: 0.28, lit: 0, base: it.color });
          gl.depthMask(true);
          continue;
        }
        const tint = it.outside ? [0.9, 0.25, 0.25] : this.accent;
        const amt = it.outside ? 0.55 : sel ? 0.14 : hov ? 0.08 : 0;
        this.drawItem(u, it, { colored: it.keepColour, tint, tintAmt: amt, over: this.overhang });
      }
    }

    drawOutlines(m, light) {
      if (!this.selected.size) return;
      const gl = this.gl, u = this.uniforms(this.objProg, m, light);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
      for (const id of this.selected) {
        const it = this.items.get(id);
        if (!it || it.hidden || it.ghost) continue;
        const grow = Math.max(0.35, this.dist * 0.0022);
        this.drawItem(u, it, { grow, lit: 0, base: it.outside ? [0.95, 0.3, 0.3] : this.accent });
      }
      gl.disable(gl.CULL_FACE);
    }

    drawHandles(m, light, picking) {
      const set = this.handleSet();
      if (!set.length) return;
      const gl = this.gl, u = this.uniforms(this.objProg, m, light);
      gl.disable(gl.DEPTH_TEST);
      for (const h of set) {
        const g = this.handles[h.name];
        const model = mat.mul(mat.translate(...h.origin), mat.scale(h.scale, h.scale, h.scale));
        const hot = this.hover === h.id || this.gesture?.handle === h.id;
        const entry = { pos: g.pos, nrm: g.nrm, col: null, count: g.count };
        this.drawItem(u, entry, { model, nmat: mat.normal(model), base: picking ? this.idColour(h.id) : (h.colour || [1, 1, 1]), lit: picking ? 0 : 1,
          tint: [1, 1, 1], tintAmt: hot && !picking ? 0.45 : 0, alpha: h.name === 'moveXY' && !picking ? 0.7 : 1 });
      }
      gl.enable(gl.DEPTH_TEST);
    }

    /* a red outline of the footprint under an object that is not wholly on the plate, and the faint shadow of every object */
    drawFootprints(m) {
      const gl = this.gl;
      const lines = [], cols = [];
      for (const it of this.items.values()) {
        if (it.hidden || it.ghost || !it.bounds) continue;
        const b = it.bounds;
        if (it.outside) {
          const z = 0.12, x0 = b.min[0], x1 = b.max[0], y0 = b.min[1], y1 = b.max[1];
          const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
          for (let i = 0; i < 4; i++) {
            const a = corners[i], c = corners[(i + 1) % 4];
            lines.push(a[0], a[1], z, c[0], c[1], z); cols.push(1, 0.3, 0.3, 0.95, 1, 0.3, 0.3, 0.95);
          }
        }
      }
      if (this.outsideEdge) {
        const z = 0.14, e = this.outsideEdge;
        for (let i = 0; i < 4; i++) {
          const a = e[i], c = e[(i + 1) % 4];
          lines.push(a[0], a[1], z, c[0], c[1], z); cols.push(1, 0.3, 0.3, 0.9, 1, 0.3, 0.3, 0.9);
        }
      }
      if (!lines.length) return;
      const pos = this.buffer(new Float32Array(lines)), col = this.buffer(new Float32Array(cols));
      gl.useProgram(this.lineProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProg, 'm'), false, m);
      gl.uniform1i(gl.getUniformLocation(this.lineProg, 'hideTravel'), false);
      gl.uniform1f(gl.getUniformLocation(this.lineProg, 'minZ'), -1e8); gl.uniform1f(gl.getUniformLocation(this.lineProg, 'maxZ'), 1e8);
      gl.uniform1f(gl.getUniformLocation(this.lineProg, 'minLayer'), -1e8); gl.uniform1f(gl.getUniformLocation(this.lineProg, 'maxLayer'), 1e8);
      const lq = gl.getAttribLocation(this.lineProg, 'q'); gl.disableVertexAttribArray(lq); gl.vertexAttrib1f(lq, -1);
      const a = this.attrib(this.lineProg, 'p', pos, 3), b = this.attrib(this.lineProg, 'k', col, 4);
      gl.drawArrays(gl.LINES, 0, lines.length / 3);
      gl.disableVertexAttribArray(a); gl.disableVertexAttribArray(b);
      gl.deleteBuffer(pos); gl.deleteBuffer(col);
    }

    /* ---- picking ------------------------------------------------------------------------------------------------------------------ */
    idColour(id) { return [(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255]; }

    ensurePickTarget() {
      const gl = this.gl, w = this.canvas.width, h = this.canvas.height;
      if (this.pick && this.pick.w === w && this.pick.h === h) return this.pick;
      if (this.pick) { gl.deleteFramebuffer(this.pick.fb); gl.deleteTexture(this.pick.tex); gl.deleteRenderbuffer(this.pick.rb); }
      const tex = gl.createTexture(), rb = gl.createRenderbuffer(), fb = gl.createFramebuffer();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.pick = { fb, tex, rb, w, h };
      return this.pick;
    }

    /* what is under the pointer: { kind: 'handle' | 'item' | 'none', id } */
    pickAt(clientX, clientY) {
      if (this.mode !== 'prepare') return { kind: 'none', id: 0 };
      const gl = this.gl, canvas = this.canvas, r = canvas.getBoundingClientRect();
      if (!canvas.width) return { kind: 'none', id: 0 };
      const px = Math.floor((clientX - r.left) * canvas.width / r.width), py = Math.floor(canvas.height - (clientY - r.top) * canvas.height / r.height);
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return { kind: 'none', id: 0 };
      const t = this.ensurePickTarget(), m = this.matrix();
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.SCISSOR_TEST); gl.scissor(px, py, 1, 1);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
      const u = this.uniforms(this.objProg, m, [0, 0, 1]);
      for (const it of this.items.values()) {
        if (it.hidden || it.ghost) continue;
        this.drawItem(u, it, { base: this.idColour(it.id), lit: 0 });
      }
      this.drawHandles(m, [0, 0, 1], true);
      const out = new Uint8Array(4);
      gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.enable(gl.BLEND);
      const id = out[0] | (out[1] << 8) | (out[2] << 16);
      if (!id) return { kind: 'none', id: 0 };
      return id >= PICK_BASE ? { kind: 'handle', id } : { kind: 'item', id };
    }

    /* ---- the pointer ----------------------------------------------------------------------------------------------------------------- */
    bindScene() {
      const c = this.canvas, pointers = new Map();
      let hoverQueued = 0, last = null;
      c.style.touchAction = 'none';
      const setHover = hit => {
        const next = hit.kind === 'none' ? null : hit.id;
        if (next !== this.hover) { this.hover = next; this.emit('hover', hit); this.draw(); }
        const cursor = hit.kind === 'handle' ? 'pointer' : hit.kind === 'item' ? 'grab' : '';
        if (cursor !== this.cursorFor) { this.cursorFor = cursor; c.style.cursor = cursor; }
      };
      const down = e => {
        if (pointers.size === 0) { this.pointerFocused = true; c.focus?.({ preventScroll: true }); }
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { c.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ }
        if (this.rubber) this.endRubber();
        if (pointers.size > 1) { this.gesture = { kind: 'touch' }; return; }      // two fingers: pinch to zoom, drag to pan
        // Snapmaker Orca: the left button turns the view, the right and middle buttons pan it ("swap" exchanges them). An object under
        // the left button is dragged instead; shift and a drag over the empty plate draws a box that selects what it touches.
        const left = e.button === 0, swap = this.prefs.swap, prepare = this.mode === 'prepare';
        const turnWithThis = swap ? !left && e.button !== 1 : false, panWithThis = swap ? e.button === 1 : !left;
        const wantsPan = panWithThis || (e.shiftKey && !prepare && left);
        const hit = wantsPan || turnWithThis ? { kind: 'none', id: 0 } : this.pickAt(e.clientX, e.clientY);
        last = { x: e.clientX, y: e.clientY, moved: false };
        if (prepare && left && hit.kind === 'handle') this.startHandle(hit.id, e);
        else if (prepare && left && hit.kind === 'item' && this.pickMode) { this.gesture = { kind: 'none' }; this.emit('surface', { id: hit.id, x: e.clientX, y: e.clientY }); }
        else if (prepare && left && hit.kind === 'item') this.startDrag(hit.id, e);
        else if (prepare && left && e.shiftKey && !swap) this.startRubber(e);
        else if (left && swap && !wantsPan) this.gesture = { kind: 'pan', downOnEmpty: hit.kind === 'none' };
        else this.gesture = { kind: wantsPan ? 'pan' : 'orbit', downOnEmpty: left && !wantsPan && hit.kind === 'none', centre: e.ctrlKey || e.metaKey };
      };
      const move = e => {
        const prev = pointers.get(e.pointerId);
        if (!prev) {
          if (!hoverQueued && !this.gesture) {
            hoverQueued = requestAnimationFrame(() => { hoverQueued = 0; setHover(this.pickAt(e.clientX, e.clientY)); });
          }
          return;
        }
        if (last && Math.hypot(e.clientX - last.x, e.clientY - last.y) > 3) last.moved = true;
        if (pointers.size >= 2) {
          // two fingers: the distance between them zooms, the point halfway between them pans
          const mid = pts => ({ x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 });
          const before = [...pointers.values()], d0 = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y), m0 = mid(before);
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const after = [...pointers.values()], d1 = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y), m1 = mid(after);
          this.panBetween(m0, m1);
          if (d0 > 1 && d1 > 1) this.zoomTo(this.dist * d0 / d1, m1.x, m1.y);
          return;
        }
        const g = this.gesture, here = { x: e.clientX, y: e.clientY };
        if (g && g.kind === 'handle') this.moveHandle(e);
        else if (g && g.kind === 'drag') this.moveDrag(e);
        else if (g && g.kind === 'rubber') this.moveRubber(e);
        else if (g && g.kind === 'pan') this.panBetween(prev, here);
        else if (g && g.kind === 'orbit') this.orbitBy(here.x - prev.x, here.y - prev.y, g.centre);
        pointers.set(e.pointerId, here);
      };
      const up = e => {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        const g = this.gesture;
        if (pointers.size === 0 && g) {
          if (g.kind === 'handle' || g.kind === 'drag') this.endGesture();
          else if (g.kind === 'rubber') this.finishRubber(e, last && last.moved);
          else if (g.downOnEmpty && last && !last.moved) { this.emit('select', { id: 0, additive: e.shiftKey || e.ctrlKey || e.metaKey }); }
          this.gesture = null;
          this.draw();
        } else if (pointers.size === 0) this.gesture = null;
      };
      c.addEventListener('blur', () => { this.pointerFocused = false; });
      c.addEventListener('pointerdown', down);
      c.addEventListener('pointermove', move);
      c.addEventListener('pointerleave', () => { if (!this.gesture) setHover({ kind: 'none', id: 0 }); });
      c.addEventListener('contextmenu', e => e.preventDefault());
      this.docUp = up;
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
      c.addEventListener('wheel', e => {
        e.preventDefault();
        // One notch of a mouse wheel is one step; a trackpad sends many small ones, which add up to the same distance.
        // A pinch on a trackpad arrives as a wheel with Ctrl held and small steps, so it counts for more.
        const notches = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaMode === 2 ? e.deltaY : e.deltaY / (e.ctrlKey ? 25 : 100);
        this.zoomBy(this.prefs.reverse ? notches : -notches, e.clientX, e.clientY);
      }, { passive: false });
    }

    /* ---- moving the camera, the way Snapmaker Orca does ---------------------------------------------------------------------------- */
    eyePosition() { return eyeOf(this.target, this.dist, this.yaw, this.pitch); }

    /* where the view turns: the selected objects' middle, else the middle of every object on the plate, else the plate's middle */
    pivot() {
      if (this.mode !== 'prepare') return this.target.slice();
      const pick = [...this.selected].map(id => this.items.get(id)).filter(it => it && !it.hidden && !it.ghost);
      const rows = pick.length ? pick : [...this.items.values()].filter(it => !it.hidden && !it.ghost);
      if (!rows.length) return [BED / 2, BED / 2, 0];
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const it of rows) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], it.bounds.min[k]); hi[k] = Math.max(hi[k], it.bounds.max[k]); }
      return lo.map((v, k) => (v + hi[k]) / 2);
    }

    /* Turn the view by a drag of dx, dy pixels about `pivot` (the screen's middle with Ctrl): the pivot stays where it is on the screen. */
    orbitBy(dx, dy, aroundCentre) {
      const k = ORBIT_PER_PIXEL * (this.prefs.orbit > 0 ? this.prefs.orbit : 1);
      const pivot = aroundCentre ? this.target.slice() : this.pivot();
      const b0 = basisOf(this.yaw, this.pitch), rel = v3.sub(pivot, this.eyePosition());
      const c = [v3.dot(rel, b0.right), v3.dot(rel, b0.up), v3.dot(rel, b0.f)];
      this.yaw -= dx * k;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + dy * k));
      const b1 = basisOf(this.yaw, this.pitch);
      const eye = v3.sub(pivot, v3.add(v3.add(v3.mul(b1.right, c[0]), v3.mul(b1.up, c[1])), v3.mul(b1.f, c[2])));
      this.target = this.keepTarget(v3.add(eye, v3.mul(b1.f, this.dist)));
      this.ortho = false;
      this.draw();
    }

    /* the point on the plane through the target that faces the camera, under a pointer ray */
    viewPoint(ray) {
      const f = basisOf(this.yaw, this.pitch).f, denom = v3.dot(ray.d, f);
      if (Math.abs(denom) < 1e-6) return null;
      return v3.add(ray.o, v3.mul(ray.d, v3.dot(v3.sub(this.target, ray.o), f) / denom));
    }

    /* the scene follows the pointer: what was under `a` is under `b` afterwards */
    panBetween(a, b) {
      const p0 = this.viewPoint(this.rayAt(a.x, a.y)), p1 = this.viewPoint(this.rayAt(b.x, b.y));
      if (!p0 || !p1) return;
      this.target = this.keepTarget(v3.add(this.target, v3.sub(p0, p1)));
      this.draw();
    }

    /* the camera's right and away directions along the plate: Ctrl and an arrow move a model the way the camera sees it */
    planeAxes() {
      const b = basisOf(this.yaw, this.pitch), flat = a => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
      return { right: flat(b.right), away: flat(b.f) };
    }

    /* the target stays near the plate, so the view can never be lost */
    keepTarget(t) { return t.map(v => Math.max(-BED, Math.min(2 * BED, v))); }

    /* a new distance, keeping what is under the pointer where it is (or the screen's middle when no pointer is given) */
    zoomTo(dist, clientX, clientY) {
      const next = Math.max(30, Math.min(1500, dist));
      const follow = this.prefs.zoomToMouse && Number.isFinite(clientX);
      const before = follow ? this.viewPoint(this.rayAt(clientX, clientY)) : null;
      this.dist = next;
      if (before) {
        const after = this.viewPoint(this.rayAt(clientX, clientY));
        if (after) this.target = this.keepTarget(v3.add(this.target, v3.sub(before, after)));
      }
      this.draw();
    }

    /* Orca's step: one notch in, a tenth closer; at most four notches in one go. Positive notches zoom in. */
    zoomBy(notches, clientX, clientY) {
      const n = Math.max(-4, Math.min(4, notches));
      this.zoomTo(this.dist * (1 - n * ZOOM_STEP), clientX, clientY);
    }

    /* ---- selecting with a box ------------------------------------------------------------------------------------------------------- */
    startRubber(e) {
      this.gesture = { kind: 'rubber', x0: e.clientX, y0: e.clientY, remove: e.altKey, add: e.ctrlKey || e.metaKey };
    }
    moveRubber(e) {
      const g = this.gesture, host = this.canvas.parentElement, hr = host.getBoundingClientRect();
      if (!this.rubber) {
        this.rubber = document.createElement('div');
        this.rubber.className = 'sl-rubber';
        this.rubber.setAttribute('aria-hidden', 'true');
        host.appendChild(this.rubber);
      }
      const x = Math.min(g.x0, e.clientX) - hr.left, y = Math.min(g.y0, e.clientY) - hr.top;
      Object.assign(this.rubber.style, { left: x + 'px', top: y + 'px', width: Math.abs(e.clientX - g.x0) + 'px', height: Math.abs(e.clientY - g.y0) + 'px' });
      this.rubber.classList.toggle('is-remove', !!g.remove);
    }
    endRubber() { if (this.rubber) { this.rubber.remove(); this.rubber = null; } }
    finishRubber(e, moved) {
      const g = this.gesture;
      this.endRubber();
      if (!moved) return;
      const x0 = Math.min(g.x0, e.clientX), x1 = Math.max(g.x0, e.clientX), y0 = Math.min(g.y0, e.clientY), y1 = Math.max(g.y0, e.clientY);
      const ids = [];
      for (const [id, it] of this.items) {
        if (it.hidden || it.ghost) continue;
        let lx = Infinity, hx = -Infinity, ly = Infinity, hy = -Infinity;
        for (let k = 0; k < 8; k++) {
          const s = this.toScreen([k & 1 ? it.bounds.max[0] : it.bounds.min[0], k & 2 ? it.bounds.max[1] : it.bounds.min[1], k & 4 ? it.bounds.max[2] : it.bounds.min[2]]);
          lx = Math.min(lx, s[0]); hx = Math.max(hx, s[0]); ly = Math.min(ly, s[1]); hy = Math.max(hy, s[1]);
        }
        if (hx >= x0 && lx <= x1 && hy >= y0 && ly <= y1) ids.push(id);
      }
      this.emit('select', { ids, mode: g.remove ? 'remove' : g.add ? 'add' : 'replace' });
    }

    /* the object is pressed: it is selected now, and dragging moves it across the plate */
    startDrag(id, e) {
      const it = this.items.get(id);
      if (!it) return;
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      this.emit('select', { id, additive });
      const ray = this.rayAt(e.clientX, e.clientY), hit = this.boxHit(ray, it.bounds) || [(it.bounds.min[0] + it.bounds.max[0]) / 2, (it.bounds.min[1] + it.bounds.max[1]) / 2, it.bounds.min[2]];
      this.gesture = { kind: 'drag', id, plane: hit[2], grab: this.planePoint(ray, hit[2]) || hit, started: false, additive };
      this.canvas.style.cursor = 'grabbing';
    }

    moveDrag(e) {
      const g = this.gesture, ray = this.rayAt(e.clientX, e.clientY), p = this.planePoint(ray, g.plane);
      if (!p) return;
      const dx = p[0] - g.grab[0], dy = p[1] - g.grab[1];
      if (!g.started && Math.hypot(dx, dy) < 1.2) return;
      if (!g.started) { g.started = true; this.emit('gesture', { phase: 'start', kind: 'move', id: g.id }); }
      this.emit('gesture', { phase: 'move', kind: 'move', id: g.id, delta: [dx, dy, 0], snap: !e.altKey });
    }

    startHandle(handle, e) {
      const id = [...this.selected][0], it = this.items.get(id);
      if (!it) return;
      const b = it.bounds, c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      const ray = this.rayAt(e.clientX, e.clientY);
      const g = { kind: 'handle', handle, id, centre: c, started: false, ray0: ray };
      if (handle >= HANDLES.moveX && handle <= HANDLES.moveZ) {
        g.axis = [0, 0, 0]; g.axis[handle - HANDLES.moveX] = 1;
        g.t0 = this.axisParam(ray, c, g.axis);
      } else if (handle === HANDLES.moveXY) {
        g.plane = c[2]; g.p0 = this.planePoint(ray, c[2]);
      } else if (handle >= HANDLES.rotX && handle <= HANDLES.rotZ) {
        g.rot = handle - HANDLES.rotX;
        g.n = [0, 0, 0]; g.n[g.rot] = 1;
        g.a0 = this.ringAngle(ray, c, g.rot);
      } else if (handle === HANDLES.scaleAll) {
        const s = this.toScreen(c);
        g.screen0 = s; g.d0 = Math.max(12, Math.hypot(e.clientX - s[0], e.clientY - s[1]));
      }
      this.gesture = g;
      this.draw();
    }

    toScreen(p) {
      const m = this.matrix(), r = this.canvas.getBoundingClientRect();
      const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      return [r.left + (x / w * 0.5 + 0.5) * r.width, r.top + (1 - (y / w * 0.5 + 0.5)) * r.height];
    }

    /* the angle of the pointer round a ring's axis, measured in the ring's own plane */
    ringAngle(ray, c, axis) {
      const n = [0, 0, 0]; n[axis] = 1;
      const denom = v3.dot(ray.d, n);
      if (Math.abs(denom) < 1e-5) return null;
      const t = v3.dot(v3.sub(c, ray.o), n) / denom;
      if (t < 0) return null;
      const p = v3.sub(v3.add(ray.o, v3.mul(ray.d, t)), c);
      const u = [[0, 1, 0], [0, 0, 1], [1, 0, 0]][axis], w = [[0, 0, 1], [1, 0, 0], [0, 1, 0]][axis];
      return Math.atan2(v3.dot(p, w), v3.dot(p, u));
    }

    moveHandle(e) {
      const g = this.gesture, ray = this.rayAt(e.clientX, e.clientY);
      let detail = null;
      if (g.axis) {
        const t = this.axisParam(ray, g.centre, g.axis);
        detail = { kind: 'move', delta: v3.mul(g.axis, t - g.t0), snap: !e.altKey, fromHandle: true };
      } else if (g.plane !== undefined) {
        const p = this.planePoint(ray, g.plane);
        if (!p || !g.p0) return;
        detail = { kind: 'move', delta: [p[0] - g.p0[0], p[1] - g.p0[1], 0], snap: !e.altKey, fromHandle: true };
      } else if (g.rot !== undefined) {
        const a = this.ringAngle(ray, g.centre, g.rot);
        if (a === null || g.a0 === null) return;
        let d = a - g.a0;
        d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
        detail = { kind: 'rotate', axis: g.rot, angle: d, snap: !e.altKey, centre: g.centre };
      } else if (g.screen0) {
        const d = Math.hypot(e.clientX - g.screen0[0], e.clientY - g.screen0[1]);
        detail = { kind: 'scale', ratio: Math.max(0.05, d / g.d0), centre: g.centre, snap: !e.altKey };
      }
      if (!detail) return;
      if (!g.started) { g.started = true; this.emit('gesture', { phase: 'start', kind: detail.kind, id: g.id }); }
      this.emit('gesture', { phase: 'move', id: g.id, ...detail });
    }

    endGesture() {
      const g = this.gesture;
      if (g && g.started) this.emit('gesture', { phase: 'end', kind: g.kind === 'drag' ? 'move' : 'handle', id: g.id });
      this.canvas.style.cursor = this.cursorFor;
    }

    /* the point on an object's surface under the pointer, from the triangles of the selected object (used by Lay on face and Measure) */
    surfaceAt(clientX, clientY, id, mesh, transform) {
      const ray = this.rayAt(clientX, clientY), t = transform, p = mesh.positions;
      const W = i => [p[i] * t[0] + p[i + 1] * t[3] + p[i + 2] * t[6] + t[9], p[i] * t[1] + p[i + 1] * t[4] + p[i + 2] * t[7] + t[10], p[i] * t[2] + p[i + 1] * t[5] + p[i + 2] * t[8] + t[11]];
      let best = null;
      for (let i = 0; i < p.length; i += 9) {
        const a = W(i), b = W(i + 3), c = W(i + 6), e1 = v3.sub(b, a), e2 = v3.sub(c, a), h = v3.cross(ray.d, e2), det = v3.dot(e1, h);
        if (Math.abs(det) < 1e-12) continue;
        const f = 1 / det, s = v3.sub(ray.o, a), u = f * v3.dot(s, h);
        if (u < 0 || u > 1) continue;
        const q = v3.cross(s, e1), v = f * v3.dot(ray.d, q);
        if (v < 0 || u + v > 1) continue;
        const d = f * v3.dot(e2, q);
        if (d > 1e-6 && (!best || d < best.t)) best = { t: d, tri: i / 9, point: v3.add(ray.o, v3.mul(ray.d, d)), normal: v3.norm(v3.cross(e1, e2)), a, b, c };
      }
      return best;
    }

    /* ---- the toolpath ------------------------------------------------------------------------------------------------------------------- */
    /* data: what slicer-gcode-worker.js returns (n, p, a, c). Takes the arrays; the caller must not keep using them. */
    setPath(data) {
      this.clearPath();
      if (!this.inst) throw new Error('This browser cannot draw the preview (it lacks instanced drawing).');
      const gl = this.gl, mk = (arr, target = gl.ARRAY_BUFFER) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, arr, gl.STATIC_DRAW); return b; };
      this.pathBuf = { n: data.n, p: mk(data.p), a: mk(data.a), c: mk(data.c), layers: data.layers };
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.draw();
    }
    clearPath() {
      const gl = this.gl, b = this.pathBuf;
      if (b) { gl.deleteBuffer(b.p); gl.deleteBuffer(b.a); gl.deleteBuffer(b.c); }
      this.pathBuf = null; this.draw();
    }
    setPathView(v) { Object.assign(this.pathView, v); this.draw(); }

    drawPath(m) {
      const gl = this.gl, ext = this.inst, prog = this.pathProg, b = this.pathBuf, v = this.pathView;
      gl.useProgram(prog);
      const u = n => gl.getUniformLocation(prog, n);
      gl.uniformMatrix4fv(u('vp'), false, m);
      gl.uniform1f(u('mode'), v.mode); gl.uniform2f(u('rng'), v.range[0], v.range[1]);
      gl.uniform1f(u('minL'), v.minL - 0.5); gl.uniform1f(u('maxL'), v.maxL + 0.5); gl.uniform1f(u('limit'), v.limit); gl.uniform1f(u('showTravel'), v.showTravel ? 1 : 0);
      gl.uniform3fv(u('fcol'), new Float32Array(FEATURE_COLOURS.flat())); gl.uniform3fv(u('tcol'), new Float32Array(v.tools.flat())); gl.uniform1fv(u('fshow'), new Float32Array(v.fshow));
      const at = n => gl.getAttribLocation(prog, n);
      const q = at('q'), p0 = at('p0'), p1 = at('p1'), a = at('a'), c = at('c');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.enableVertexAttribArray(q); gl.vertexAttribPointer(q, 2, gl.FLOAT, false, 0, 0); ext.vertexAttribDivisorANGLE(q, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.p);
      gl.enableVertexAttribArray(p0); gl.vertexAttribPointer(p0, 3, gl.FLOAT, false, 24, 0); ext.vertexAttribDivisorANGLE(p0, 1);
      gl.enableVertexAttribArray(p1); gl.vertexAttribPointer(p1, 3, gl.FLOAT, false, 24, 12); ext.vertexAttribDivisorANGLE(p1, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.a); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 4, gl.FLOAT, false, 0, 0); ext.vertexAttribDivisorANGLE(a, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.c); gl.enableVertexAttribArray(c); gl.vertexAttribPointer(c, 4, gl.UNSIGNED_BYTE, true, 0, 0); ext.vertexAttribDivisorANGLE(c, 1);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
      ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, b.n);
      for (const l of [q, p0, p1, a, c]) { ext.vertexAttribDivisorANGLE(l, 0); gl.disableVertexAttribArray(l); }
      gl.enable(gl.BLEND);
    }

    dispose() {
      this.clearItems();
      this.clearPath();
      super.dispose();
    }
  }

  return { SliceScene, mat, v3, HANDLES, FEATURE_COLOURS };
})();
