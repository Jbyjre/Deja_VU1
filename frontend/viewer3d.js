/* Deja Vu1 — 3D engine shared by the file viewer and the G-code inspector.
 *
 * Plain JavaScript and raw WebGL: no library, no build step.
 *   - parseSTL: binary or ASCII STL
 *   - parse3MF: unzips the 3MF with the browser's own DecompressionStream
 *     ("deflate-raw"), reads 3D/3dmodel.model and follows <component>s into
 *     3D/Objects/*.model parts (how Bambu Studio / Orca-family slicers store
 *     objects), applying every transform — the same rules as the server's
 *     backend/mesh_tools.py
 *   - Viewer: one small renderer for both triangle meshes and G-code
 *     toolpaths (coloured line segments), with the U1's 270 x 270 mm bed,
 *     orbit / zoom by mouse or touch, and a layer limit for scrubbing.
 */
'use strict';

const DV3D = (() => {
  const BED = 270;

  /* ---------------- parsing ---------------- */

  function parseSTL(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength >= 84) {
      const count = view.getUint32(80, true);
      if (84 + count * 50 === buffer.byteLength) {
        const pos = new Float32Array(count * 9);
        for (let i = 0; i < count; i++) {
          const base = 84 + i * 50 + 12;
          for (let k = 0; k < 9; k++) pos[i * 9 + k] = view.getFloat32(base + k * 4, true);
        }
        return finishMesh(pos, { objects: 1 });
      }
    }
    const text = new TextDecoder().decode(buffer);
    if (!text.includes('facet')) throw new Error('Not a readable STL file');
    const nums = [];
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    let m;
    while ((m = re.exec(text))) nums.push(+m[1], +m[2], +m[3]);
    if (!nums.length || nums.length % 9) throw new Error('STL has an incomplete triangle');
    return finishMesh(new Float32Array(nums), { objects: 1 });
  }

  async function unzip(buffer, wanted) {
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a 3MF file (no zip directory)');
    const entries = view.getUint16(eocd + 10, true);
    let ptr = view.getUint32(eocd + 16, true);
    const files = {};
    for (let n = 0; n < entries; n++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error('Damaged zip directory');
      const method = view.getUint16(ptr + 10, true);
      const csize = view.getUint32(ptr + 20, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const local = view.getUint32(ptr + 42, true);
      const name = new TextDecoder().decode(new Uint8Array(buffer, ptr + 46, nameLen));
      if (csize === 0xffffffff || local === 0xffffffff) throw new Error('Very large (ZIP64) 3MF files are not supported yet');
      files[name.toLowerCase()] = { name, method, csize, local };
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    const read = async (key) => {
      const f = files[key.replace(/^\//, '').toLowerCase()];
      if (!f) return null;
      const nl = view.getUint16(f.local + 26, true);
      const el = view.getUint16(f.local + 28, true);
      const data = new Uint8Array(buffer, f.local + 30 + nl + el, f.csize);
      if (f.method === 0) return data;
      if (f.method !== 8) throw new Error('Unsupported zip compression');
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip 3MF files');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    };
    return { read, names: Object.values(files).map(f => f.name) };
  }

  const NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
  const PNS = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';

  function matrix(text) {
    if (!text) return null;
    const v = text.trim().split(/\s+/).map(Number);
    return v.length === 12 ? v : null;
  }
  function compose(a, b) {           // apply a, then b (row-vector 4x3)
    if (!a) return b;
    if (!b) return a;
    const out = [];
    for (let r = 0; r < 4; r++) {
      const w = r === 3 ? 1 : 0;
      for (let c = 0; c < 3; c++) {
        out.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c] + w * b[9 + c]);
      }
    }
    return out;
  }

  async function parse3MF(buffer) {
    const zip = await unzip(buffer);
    const parts = {};
    const load = async (path) => {
      const key = path.replace(/^\//, '').toLowerCase();
      if (!parts[key]) {
        const bytes = await zip.read(key);
        if (!bytes) throw new Error(`3MF refers to a missing part: ${path}`);
        parts[key] = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
      }
      return parts[key];
    };
    const main = '3D/3dmodel.model';
    const root = await load(main);
    const meta = {};
    for (const m of root.getElementsByTagNameNS(NS, 'metadata')) meta[m.getAttribute('name')] = m.textContent;
    const chunks = [];
    let total = 0;
    const objectsIn = (doc) => {
      const map = {};
      for (const o of doc.getElementsByTagNameNS(NS, 'object')) map[o.getAttribute('id')] = o;
      return map;
    };
    const emit = async (path, id, t, depth) => {
      if (depth > 8) throw new Error('3MF components nest too deeply');
      const obj = objectsIn(await load(path))[id];
      if (!obj) throw new Error(`3MF object ${id} is missing`);
      const mesh = obj.getElementsByTagNameNS(NS, 'mesh')[0];
      if (mesh && mesh.parentNode === obj) {
        const vs = mesh.getElementsByTagNameNS(NS, 'vertex');
        const verts = new Float32Array(vs.length * 3);
        for (let i = 0; i < vs.length; i++) {
          let x = +vs[i].getAttribute('x'), y = +vs[i].getAttribute('y'), z = +vs[i].getAttribute('z');
          if (t) {
            const nx = x * t[0] + y * t[3] + z * t[6] + t[9];
            const ny = x * t[1] + y * t[4] + z * t[7] + t[10];
            z = x * t[2] + y * t[5] + z * t[8] + t[11]; x = nx; y = ny;
          }
          verts[i * 3] = x; verts[i * 3 + 1] = y; verts[i * 3 + 2] = z;
        }
        const ts = mesh.getElementsByTagNameNS(NS, 'triangle');
        const pos = new Float32Array(ts.length * 9);
        for (let i = 0; i < ts.length; i++) {
          const a = +ts[i].getAttribute('v1') * 3, b = +ts[i].getAttribute('v2') * 3, c = +ts[i].getAttribute('v3') * 3;
          pos.set(verts.subarray(a, a + 3), i * 9);
          pos.set(verts.subarray(b, b + 3), i * 9 + 3);
          pos.set(verts.subarray(c, c + 3), i * 9 + 6);
        }
        chunks.push(pos);
        total += pos.length;
      }
      const comps = obj.getElementsByTagNameNS(NS, 'component');
      for (const comp of comps) {
        const p = comp.getAttributeNS(PNS, 'path') || path;
        await emit(p, comp.getAttribute('objectid'), compose(matrix(comp.getAttribute('transform')), t), depth + 1);
      }
    };
    const build = root.getElementsByTagNameNS(NS, 'item');
    const items = build.length ? [...build] : Object.keys(objectsIn(root)).map(id => ({ getAttribute: k => (k === 'objectid' ? id : null) }));
    for (const item of items) await emit(main, item.getAttribute('objectid'), matrix(item.getAttribute('transform')), 0);
    const all = new Float32Array(total);
    let off = 0;
    for (const c of chunks) { all.set(c, off); off += c.length; }
    return finishMesh(all, { objects: items.length, application: meta.Application || '', title: meta.Title || '' });
  }

  function finishMesh(pos, info) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (pos[i + k] < min[k]) min[k] = pos[i + k];
        if (pos[i + k] > max[k]) max[k] = pos[i + k];
      }
    }
    const normals = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 9) {
      const ux = pos[i + 3] - pos[i], uy = pos[i + 4] - pos[i + 1], uz = pos[i + 5] - pos[i + 2];
      const vx = pos[i + 6] - pos[i], vy = pos[i + 7] - pos[i + 1], vz = pos[i + 8] - pos[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 3; k++) { normals[i + k * 3] = nx; normals[i + k * 3 + 1] = ny; normals[i + k * 3 + 2] = nz; }
    }
    return { positions: pos, normals, triangles: pos.length / 9, bounds: { min, max },
             size: max.map((v, i) => +(v - min[i]).toFixed(2)), ...info };
  }

  async function parseModel(buffer, name) {
    const lower = name.toLowerCase();
    if (lower.endsWith('.stl')) return parseSTL(buffer);
    if (lower.endsWith('.3mf')) return parse3MF(buffer);
    throw new Error('Only STL and 3MF models can be shown');
  }

  /* ---------------- tiny matrix helpers ---------------- */

  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function lookAt(eye, target, up) {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
            -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
            -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
            -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1];
  }
  function multiply(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }

  /* ---------------- the renderer ---------------- */

  const MESH_VS = `attribute vec3 p; attribute vec3 n; uniform mat4 m; varying vec3 vn; varying float vz;
    void main(){ vn = n; vz = p.z; gl_Position = m * vec4(p, 1.0); }`;
  const MESH_FS = `precision mediump float; varying vec3 vn; varying float vz; uniform vec3 c; uniform vec3 l;
    void main(){ float d = abs(dot(normalize(vn), l)); gl_FragColor = vec4(c * (0.38 + 0.62 * d), 1.0); }`;
  const LINE_VS = `attribute vec3 p; attribute vec4 k; uniform mat4 m; varying vec4 vk;
    void main(){ vk = k; gl_Position = m * vec4(p, 1.0); }`;
  const LINE_FS = `precision mediump float; varying vec4 vk; void main(){ gl_FragColor = vk; }`;

  function hexToRGB(hex, fallback = [1, 0.48, 0.18]) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return fallback;
    const v = parseInt(m[1], 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
  }

  class Viewer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl', { antialias: true, alpha: true, preserveDrawingBuffer: false });
      if (!gl) throw new Error('WebGL is not available in this browser');
      this.gl = gl;
      this.mesh = null;
      this.lines = null;
      this.limit = Infinity;
      this.showTravel = false;
      this.color = [1, 0.48, 0.18];
      this.yaw = -0.9; this.pitch = 0.62; this.dist = 380;
      this.target = [BED / 2, BED / 2, 0];
      this.meshProg = this.program(MESH_VS, MESH_FS);
      this.lineProg = this.program(LINE_VS, LINE_FS);
      this.bed = this.buildBed();
      this.bindInput();
      this.resizeObserver = new ResizeObserver(() => this.draw());
      this.resizeObserver.observe(canvas);
      this.draw();
    }

    program(vs, fs) {
      const gl = this.gl;
      const make = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      return p;
    }

    buffer(data) {
      const gl = this.gl, b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return b;
    }

    buildBed() {
      const pos = [], col = [];
      const push = (x1, y1, x2, y2, a) => { pos.push(x1, y1, 0, x2, y2, 0); col.push(.3, .34, .42, a, .3, .34, .42, a); };
      for (let i = 0; i <= BED; i += 27) { push(i, 0, i, BED, i % 135 ? .16 : .34); push(0, i, BED, i, i % 135 ? .16 : .34); }
      return { pos: this.buffer(new Float32Array(pos)), col: this.buffer(new Float32Array(col)), count: pos.length / 3 };
    }

    setMesh(mesh, colorHex) {
      const gl = this.gl;
      this.clear();
      // Sit the model on the bed, centred, as a slicer would place it.
      const b = mesh.bounds;
      const dx = BED / 2 - (b.min[0] + b.max[0]) / 2, dy = BED / 2 - (b.min[1] + b.max[1]) / 2, dz = -b.min[2];
      const pos = new Float32Array(mesh.positions.length);
      for (let i = 0; i < pos.length; i += 3) {
        pos[i] = mesh.positions[i] + dx; pos[i + 1] = mesh.positions[i + 1] + dy; pos[i + 2] = mesh.positions[i + 2] + dz;
      }
      this.mesh = { pos: this.buffer(pos), nrm: this.buffer(mesh.normals), count: pos.length / 3 };
      this.color = hexToRGB(colorHex);
      this.frame([BED / 2, BED / 2, mesh.size[2] / 2], Math.max(...mesh.size));
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.draw();
    }

    /* segments: [x1,y1,z1,x2,y2,z2,tool,extruding] from the server's analysis */
    setToolpath(segments, colours) {
      this.clear();
      const n = segments.length;
      const pos = new Float32Array(n * 6), col = new Float32Array(n * 8);
      // Very dark filament (black) would vanish against the dark viewer, so
      // on screen only it is lifted toward grey; the file is untouched.
      const visible = (c) => { const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return l < 0.22 ? c.map(v => v + (0.42 - l)) : c; };
      const palette = [0, 1, 2, 3].map(i => visible(hexToRGB(colours && colours[i], [[1, .48, .18], [.2, .5, .95], [.2, .7, .35], [.85, .2, .3]][i])));
      this.zAt = new Float32Array(n);
      let zmax = 0, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i++) {
        const s = segments[i];
        pos.set([s[0], s[1], s[2], s[3], s[4], s[5]], i * 6);
        const ext = s[7] === 1;
        const c = ext ? palette[s[6]] || palette[0] : [.45, .5, .6];
        const a = ext ? 1 : .22;
        col.set([c[0], c[1], c[2], a, c[0], c[1], c[2], a], i * 8);
        if (ext) {
          zmax = Math.max(zmax, s[5]);
          for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], s[k], s[k + 3]); max[k] = Math.max(max[k], s[k], s[k + 3]); }
        }
        this.zAt[i] = zmax;               // highest printed Z so far: file order is print order
      }
      this.travelMask = segments.map(s => s[7] === 1);
      this.lines = { pos: this.buffer(pos), col: this.buffer(col), count: n * 2, zmax };
      if (isFinite(min[0])) this.frame([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (max[2]) / 2],
        Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]));
      this.limit = Infinity;
      this.draw();
      return { zmax };
    }

    setLayerLimit(z) { this.limit = z; this.draw(); }

    frame(center, size) {
      this.target = center;
      this.dist = Math.max(60, size * 2.6);
    }

    clear() {
      const gl = this.gl;
      for (const obj of [this.mesh, this.lines]) {
        if (!obj) continue;
        for (const key of ['pos', 'nrm', 'col']) if (obj[key]) gl.deleteBuffer(obj[key]);
      }
      this.mesh = null; this.lines = null;
    }

    matrix() {
      const { canvas } = this;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const e = [
        this.target[0] + this.dist * Math.cos(this.pitch) * Math.cos(this.yaw),
        this.target[1] + this.dist * Math.cos(this.pitch) * Math.sin(this.yaw),
        this.target[2] + this.dist * Math.sin(this.pitch),
      ];
      return multiply(perspective(0.8, w / Math.max(1, h), 1, 4000), lookAt(e, this.target, [0, 0, 1]));
    }

    attrib(prog, name, buf, size) {
      const gl = this.gl, loc = gl.getAttribLocation(prog, name);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      return loc;
    }

    draw() {
      if (this.pending) return;
      this.pending = requestAnimationFrame(() => { this.pending = 0; this.render(); });
    }

    render() {
      const gl = this.gl, canvas = this.canvas;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (!w || !h) return;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const m = this.matrix();

      gl.useProgram(this.lineProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProg, 'm'), false, m);
      const lp = this.attrib(this.lineProg, 'p', this.bed.pos, 3);
      const lk = this.attrib(this.lineProg, 'k', this.bed.col, 4);
      gl.drawArrays(gl.LINES, 0, this.bed.count);

      if (this.lines) {
        this.attrib(this.lineProg, 'p', this.lines.pos, 3);
        this.attrib(this.lineProg, 'k', this.lines.col, 4);
        let count = this.lines.count / 2;
        if (isFinite(this.limit)) {
          let lo = 0, hi = count;                       // zAt only ever rises: binary search
          while (lo < hi) { const mid = (lo + hi) >> 1; if (this.zAt[mid] <= this.limit + 1e-6) lo = mid + 1; else hi = mid; }
          count = lo;
        }
        gl.lineWidth(1);
        if (this.showTravel) gl.drawArrays(gl.LINES, 0, count * 2);
        else {
          // Draw extrusion runs only, skipping travel moves in contiguous batches.
          let start = -1;
          for (let i = 0; i <= count; i++) {
            const ext = i < count && this.travelMask[i];
            if (ext && start < 0) start = i;
            if (!ext && start >= 0) { gl.drawArrays(gl.LINES, start * 2, (i - start) * 2); start = -1; }
          }
        }
      }
      gl.disableVertexAttribArray(lk);

      if (this.mesh) {
        gl.useProgram(this.meshProg);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.meshProg, 'm'), false, m);
        gl.uniform3fv(gl.getUniformLocation(this.meshProg, 'c'), this.color);
        const l = [Math.cos(this.yaw + 0.6), Math.sin(this.yaw + 0.6), 0.8];
        const ll = Math.hypot(...l);
        gl.uniform3fv(gl.getUniformLocation(this.meshProg, 'l'), l.map(v => v / ll));
        const mp = this.attrib(this.meshProg, 'p', this.mesh.pos, 3);
        const mn = this.attrib(this.meshProg, 'n', this.mesh.nrm, 3);
        gl.drawArrays(gl.TRIANGLES, 0, this.mesh.count);
        gl.disableVertexAttribArray(mn);
        gl.disableVertexAttribArray(mp);
      }
      gl.disableVertexAttribArray(lp);
    }

    /* Orbit and zoom. The canvas has touch-action:none (see workshop.css) and
       the release listeners are on the document, so a finger sliding off the
       canvas mid-drag can never leave it stuck in "dragging". */
    bindInput() {
      const c = this.canvas;
      const pointers = new Map();
      let pinch = 0;
      const down = (e) => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        c.setPointerCapture?.(e.pointerId);
      };
      const move = (e) => {
        const prev = pointers.get(e.pointerId);
        if (!prev) return;
        if (pointers.size === 1) {
          this.yaw -= (e.clientX - prev.x) * 0.008;
          this.pitch = Math.max(-0.2, Math.min(1.5, this.pitch + (e.clientY - prev.y) * 0.008));
        }
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinch) this.dist = Math.max(30, Math.min(1500, this.dist * pinch / d));
          pinch = d;
        }
        this.draw();
      };
      const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0; };
      c.addEventListener('pointerdown', down);
      c.addEventListener('pointermove', move);
      this.docUp = up;
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.dist = Math.max(30, Math.min(1500, this.dist * (1 + Math.sign(e.deltaY) * 0.1)));
        this.draw();
      }, { passive: false });
      c.addEventListener('keydown', (e) => {
        const step = { ArrowLeft: [-.12, 0], ArrowRight: [.12, 0], ArrowUp: [0, .08], ArrowDown: [0, -.08] }[e.key];
        if (step) { e.preventDefault(); this.yaw += step[0]; this.pitch = Math.max(-0.2, Math.min(1.5, this.pitch + step[1])); this.draw(); }
        if (e.key === '+' || e.key === '=') { this.dist *= 0.9; this.draw(); }
        if (e.key === '-') { this.dist *= 1.1; this.draw(); }
      });
    }

    dispose() {
      this.clear();
      this.resizeObserver.disconnect();
      document.removeEventListener('pointerup', this.docUp);
      document.removeEventListener('pointercancel', this.docUp);
      const lose = this.gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  }

  return { parseSTL, parse3MF, parseModel, Viewer, BED };
})();
