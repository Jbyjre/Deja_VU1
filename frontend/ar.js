/* View on your desk: an STL/3MF model placed at real size through the
 * phone's camera, with WebXR (immersive-ar + hit-test).
 *
 * Uses the same parsed geometry as the 3D viewer (DV3D.parseModel output:
 * millimetres, Z up) and turns it into metres, Y up, as WebXR expects.
 * Raw WebGL, no libraries. Works on Android/WebXR browsers; iOS Safari has
 * no equivalent, and WebXR only runs on a secure (https) address.
 */
const DVAR = (() => {
  const MODE = 'immersive-ar';
  const UNSUPPORTED_NOTE = 'Works on Android/WebXR browsers; iOS Safari has no equivalent.';

  /* What this browser can do, in words for the page. */
  async function support() {
    if (!('xr' in navigator) || !navigator.xr || typeof navigator.xr.isSessionSupported !== 'function') {
      return { ok: false, reason: window.isSecureContext ? 'This browser has no WebXR.' : 'WebXR needs a secure (https) address.' };
    }
    try {
      return (await navigator.xr.isSessionSupported(MODE))
        ? { ok: true, reason: '' }
        : { ok: false, reason: 'This browser or device can\'t place things in AR.' };
    } catch (err) {
      return { ok: false, reason: `AR check failed: ${err.message || err}` };
    }
  }

  /* mm, Z up  ->  metres, Y up, centred on X/Z with the base at y = 0.
   * (x, y, z) -> (x, z, -y) is a proper rotation, so triangle winding and
   * normals stay correct. */
  function toARGeometry(mesh) {
    const b = mesh.bounds, src = mesh.positions, n = mesh.normals;
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, z0 = b.min[2];
    const pos = new Float32Array(src.length), nrm = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      pos[i] = (src[i] - cx) / 1000;
      pos[i + 1] = (src[i + 2] - z0) / 1000;
      pos[i + 2] = -(src[i + 1] - cy) / 1000;
      nrm[i] = n[i]; nrm[i + 1] = n[i + 2]; nrm[i + 2] = -n[i + 1];
    }
    return { positions: pos, normals: nrm, count: src.length / 3, sizeMetres: mesh.size.map(v => v / 1000) };
  }

  function multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }

  const VS = `attribute vec3 p; attribute vec3 n; uniform mat4 pv; uniform mat4 m; varying vec3 vn;
    void main(){ vn = mat3(m) * n; gl_Position = pv * m * vec4(p, 1.0); }`;
  const FS = `precision mediump float; varying vec3 vn; uniform vec3 c; uniform float lit;
    void main(){ float d = abs(dot(normalize(vn), normalize(vec3(0.35, 1.0, 0.45))));
      gl_FragColor = vec4(c * mix(1.0, 0.55 + 0.45 * d, lit), 1.0); }`;

  function program(gl) {
    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, make(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, make(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  /* A flat ring on the detected surface: "the model will land here". */
  function ring(inner, outer, steps = 48) {
    const pos = [], nrm = [];
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(c * outer, 0, s * outer, c * inner, 0, s * inner);
      nrm.push(0, 1, 0, 0, 1, 0);
    }
    return { positions: new Float32Array(pos), normals: new Float32Array(nrm), count: pos.length / 3 };
  }

  function rgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
    const v = m ? parseInt(m[1], 16) : 0xff7a2f;
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
  }

  /* Starts AR. Must be called from a tap (browsers require a user gesture).
   * opts: { color, overlay (element for dom-overlay), onStatus(text, state), onEnd() }
   * Resolves to { end() } once the session is running. */
  async function start(mesh, opts = {}) {
    const say = (text, state) => {
      if (text === state_.text) return;
      state_.text = text; state_.status = state;
      if (opts.onStatus) opts.onStatus(text, state);
    };
    const geo = toARGeometry(mesh);
    const init = { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'] };
    if (opts.overlay) init.domOverlay = { root: opts.overlay };
    const session = await navigator.xr.requestSession(MODE, init);
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { xrCompatible: true, alpha: true, antialias: true });
    let hitSource = null;
    const cleanup = () => {
      if (hitSource && hitSource.cancel) { try { hitSource.cancel(); } catch (e) { /* already gone */ } }
      state_.running = false;
      if (opts.onEnd) opts.onEnd();
    };
    try {
      if (!gl) throw new Error('WebGL is not available');
      session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
      const refSpace = await session.requestReferenceSpace('local');
      const viewerSpace = await session.requestReferenceSpace('viewer');
      hitSource = await session.requestHitTestSource({ space: viewerSpace });

      const prog = program(gl);
      const loc = { p: gl.getAttribLocation(prog, 'p'), n: gl.getAttribLocation(prog, 'n'),
        pv: gl.getUniformLocation(prog, 'pv'), m: gl.getUniformLocation(prog, 'm'),
        c: gl.getUniformLocation(prog, 'c'), lit: gl.getUniformLocation(prog, 'lit') };
      const upload = (g) => {
        const buf = (data) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
        return { pos: buf(g.positions), nrm: buf(g.normals), count: g.count };
      };
      const model = upload(geo), marker = upload(ring(0.045, 0.06));
      const colour = rgb(opts.color);
      const draw = (obj, pv, m, mode, c, lit) => {
        gl.uniformMatrix4fv(loc.pv, false, pv);
        gl.uniformMatrix4fv(loc.m, false, m);
        gl.uniform3fv(loc.c, c);
        gl.uniform1f(loc.lit, lit);
        gl.bindBuffer(gl.ARRAY_BUFFER, obj.pos); gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, obj.nrm); gl.enableVertexAttribArray(loc.n); gl.vertexAttribPointer(loc.n, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(mode, 0, obj.count);
      };

      let surface = null, placed = null;
      session.addEventListener('select', () => {
        if (!surface) { say('No surface found yet: move the phone slowly over the desk', 'searching'); return; }
        placed = Float32Array.from(surface);
        say(`Placed at real size: ${geo.sizeMetres.map(v => (v * 100).toFixed(1)).join(' × ')} cm. Tap again to move it.`, 'placed');
      });
      session.addEventListener('end', cleanup, { once: true });

      const onFrame = (time, frame) => {
        session.requestAnimationFrame(onFrame);
        const layer = session.renderState.baseLayer;
        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const hits = frame.getHitTestResults(hitSource);
        const hitPose = hits.length ? hits[0].getPose(refSpace) : null;
        surface = hitPose ? hitPose.transform.matrix : null;
        if (!placed) say(surface ? 'Tap to place the model here' : 'Point at your desk and move the phone slowly', surface ? 'surface' : 'searching');
        const pose = frame.getViewerPose(refSpace);
        state_.frames++;
        state_.drew = [];
        if (!pose) return;
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(prog);
        for (const view of pose.views) {
          const vp = layer.getViewport(view);
          gl.viewport(vp.x, vp.y, vp.width, vp.height);
          const pv = multiply(view.projectionMatrix, view.transform.inverse.matrix);
          if (surface && !placed) { draw(marker, pv, surface, gl.TRIANGLE_STRIP, [1, 1, 1], 0); state_.drew.push('marker'); }
          if (placed) { draw(model, pv, placed, gl.TRIANGLES, colour, 1); state_.drew.push('model'); }
        }
      };
      state_.running = true; state_.frames = 0; state_.text = ''; state_.triangles = geo.count / 3;
      state_.gl = gl;
      session.requestAnimationFrame(onFrame);
      say('Point at your desk and move the phone slowly', 'searching');
      return { end: () => session.end(), session };
    } catch (err) {
      try { await session.end(); } catch (e) { /* already ended */ }
      throw err;
    }
  }

  /* Read-only view of the last session, for the page and for tests. */
  const state_ = { running: false, frames: 0, drew: [], status: '', text: '', triangles: 0, gl: null };

  return { support, start, toARGeometry, UNSUPPORTED_NOTE, state: state_ };
})();
