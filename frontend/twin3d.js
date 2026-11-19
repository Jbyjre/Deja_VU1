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
 * - Snapmaker's product photos of the production U1 (front, both sides, back
 *   and three-quarter views on Snapmaker's own shop and product pages,
 *   October 2026) and the picture shipped with Snapmaker's Orca slicer
 *   profile: the white body with rounded corners and a grey top frame held
 *   by four screws; the black-framed glass door with its handle; the
 *   touchscreen above the door, its right edge in line with the door's; the
 *   wordmark above the door's left edge; on each side a tilted, recessed oval
 *   with two spools on white hubs (upper spool towards the back, lower towards
 *   the front) and perforated vents between them; a feeder on each side near
 *   the back (white front, black back, marked 1 and 2); a shelf across the top
 *   of the back with a curved underside, where the filament tubes come out and
 *   hang down to the feeders; a large see-through opening low in the back
 *   (whether it is glazed could not be confirmed) and the power socket, switch,
 *   USB and network ports beside it; four black toolheads with yellow edges and
 *   a hazard label, docked at the back with their tops level with the frame;
 *   from each a tall loop of tube that leaves the head, rises and drops back
 *   into the shelf; the white carriage with an orange fan, in front of the head
 *   it carries; the textured plate's "BUILD VOLUME" strip.
 * - Snapmaker's slicer profile: a 276 x 293 mm textured PEI plate and a
 *   270 mm print height. Snapmaker's shop photo of that plate (checked
 *   2 November 2026): bronze-brown fine grain, a white line on each of the four
 *   tabs at the back, the wordmark faintly in the middle and "PEI Coated PLATE"
 *   with its materials at the front. Snapmaker's spec: 584 x 499 x 730 mm overall.
 * - Reviews: CoreXY, carbon-fibre rods on the X axis, docks at the rear,
 *   two spools a side.
 * - Measured from the photos, scaled by the published 499 mm depth (so
 *   estimates, labelled so in the card): a body about 456 mm wide and 458 mm
 *   tall (the front is square), 450 mm deep plus a 49 mm shelf; the spool
 *   pockets 24 mm deep, which is how two 1 kg spools a side fit in the 584 mm
 *   width; spool, feeder, screen, wordmark and door positions. Dock spacing,
 *   the gantry heights and the inside layout are drawn by eye.
 *
 * Coordinates are the printer's own millimetres (X right, Y back, Z up); the
 * bed's printable corner is 0, 0. WebGL's axes are used only in the shaders.
 */
'use strict';

const Twin3D = (() => {
  /* The rest of this closure lives in twin3d-part1.js (loaded before this file). */
  const { BED, BG_FS, BODY, DOCK, ENVELOPE, FS, GANTRY_DY, GB_FS, HEAD, HUB, ID_FS, INK_FS, MAT, NO_LAMP, PLATE,
    POST_VS, RAIL_Z, SHADOW_FS, SHADOW_VS, TIP, VIEWS, VS, activeSpeed, advance, annulus, beltRun, box, buildTrack,
    canvasOf, carriageArt, circle, extrudingAt, feedEvent, feedLength, feedSpeed, feederArt, flowAlpha, geo,
    headArt, labelArt, lampOf, lathe, lin, logoArt, lookAt, mul, nearest, newFollow, norm, ortho, panel,
    perspective, plateArt, portsArt, posAt, prism, quadV, rrect, screenArt, sideArt, slab, spoolTurn, srgb,
    syncFrom, timeAtByte, tri, tube } = Twin3DPart1;

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
    const S = Twin3DScene.build({ geo, slab, annulus, lathe, tube, panel, box, rrect, circle, quadV, tri, norm, BODY, BED, PLATE, TIP, RAIL_Z, DOCK, HEAD, HUB });
    const parts = S.statics.map(p => ({ ...p, mesh: upload(p.g) }));
    const dyn = Object.fromEntries(Object.entries(S.dynamic).map(([k, p]) => [k, { ...p, mesh: upload(p.g) }]));
    const tex = {
      logo: texture(logoArt()), label: texture(labelArt()), plate: texture(plateArt()), side: texture(sideArt()), feeder: texture(feederArt()), head: texture(headArt()), carriage: texture(carriageArt()), ports: texture(portsArt()),
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
    // How well the dashboard knows where the head is: "exact" (homed), "homing" (an axis is homing and is drawn
    // from its reported motion), "last" (not homed, drawn where it was last seen) or "unknown" (not homed and
    // never seen). The head's tag says so.
    let posKind = 'exact';
    // Filament, spools and heads in motion, per head name: how far the filament has run (mm), the spool's turn
    // (radians), its speed now, a feed in progress, the last filament-sensor reading, and how far a head is
    // from its dock (0) to the carriage (1).
    const fx = { t: 0, dt: 0, phase: {}, spin: {}, v: {}, feed: {}, det: {}, place: {}, busy: false, pulse: 1 };
    let soundOn = false, audio = null;
    const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    // The model's own options: the case closed, see-through or off; the
    // print on the plate (and, faintly, what is still to come); name tags.
    let caseMode = 'closed', showPrint = true, showRest = true, showTags = true;
    let print = null, printMeshes = [], pickNames = [];
    let partsMeshes = [], partsKey = '', loopMeshes = {}, loopKey = '', screenKey = '', shadowKey = '', labels = [], viewName = 'iso';
    let viewChanged = () => {};

    // How many of the canvas's pixels are drawn, 1 at full size. Where drawing is slow (software graphics, a weak driver) each draw ended in
    // a main-thread stall of up to a second that froze the whole page; drawing fewer pixels costs about that much less, and the browser
    // stretches the picture to the same size. It steps down when a draw is measured slow and back up after a quiet spell (see render).
    let quality = 1, qualityAt = 0;
    function resize() {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      // The drawing renders at twice the pixels, so its ink lines come out smooth.
      const dpr = style === 'drawing' ? Math.max(2, Math.min(3, devicePixelRatio || 1)) : Math.min(2, devicePixelRatio || 1);
      W = r.width; H = r.height;
      const k = style === 'drawing' ? 1 : quality;
      const w = Math.max(2, Math.round(W * dpr * k)), h = Math.max(2, Math.round(H * dpr * k));
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
      printMeshes.forEach(m => free(m.mesh)); printMeshes = []; print = null; follow.track = null; follow.on = false;
      if (!data || !data.tools || !Array.isArray(data.layers) || !data.layers.length) { queue(); return; }
      const L = data.layers, k = data.unit_mm || 0.01, groups = new Map();
      const group = (tool, obj) => { const key = `${tool}|${obj}`; if (!groups.has(key)) groups.set(key, { tool, obj, g: geo() }); return groups.get(key).g; };
      let hMin = Infinity, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      const grow = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
      // The nozzle's way along the drawn paths, finer than the timeline's keyframes:
      // [seconds, x, y, z] per point, merged with the track below.
      const along = [];
      const timesOf = (list, i) => (Array.isArray(list) && Array.isArray(list[i]) ? list[i] : null);
      for (const [tool, sets] of Object.entries(data.tools)) {
        (sets.walls || []).forEach((path, pi) => {
          const layer = L[path[0]]; if (!layer) return;
          const z1 = layer.z, z0 = z1 - (layer.h || 0.2), g = group(tool, path[1]), tt = timesOf(sets.walls_t, pi);
          hMin = Math.min(hMin, layer.h || 0.2);
          let x = path[2] * k, y = path[3] * k, t = tt ? tt[0] / 1000 : 0, on = tt ? 1 : 0;
          grow(x, y);
          if (tt) along.push(t, x, y, z1);
          for (let i = 4, j = 1; i + 1 < path.length; i += 2, j++) {
            const nx = x + path[i] * k, ny = y + path[i + 1] * k, dx = nx - x, dy = ny - y, l = Math.hypot(dx, dy);
            const nt = tt ? t + (tt[j] || 0) / 1000 : 0;
            grow(nx, ny);
            if (l > 1e-4) { const n = [dy / l, -dx / l, 0], a = [t, on], b = [nt, on]; quadV(g, [[x, y, z0], n, a], [[nx, ny, z0], n, b], [[nx, ny, z1], n, b], [[x, y, z1], n, a]); }
            if (tt) along.push(nt, nx, ny, z1);
            x = nx; y = ny; t = nt;
          }
        });
        (sets.fill || []).forEach((path, pi) => {
          const layer = L[path[0]]; if (!layer) return;
          const z = layer.z, g = group(tool, path[1]), up = [0, 0, 1], w = 0.24, tt = timesOf(sets.fill_t, pi);
          let x = path[2] * k, y = path[3] * k, t = tt ? tt[0] / 1000 : 0, on = tt ? 1 : 0;
          if (tt) along.push(t, x, y, z);
          for (let i = 4, j = 1; i + 1 < path.length; i += 2, j++) {
            const nx = x + path[i] * k, ny = y + path[i + 1] * k, dx = nx - x, dy = ny - y, l = Math.hypot(dx, dy);
            const nt = tt ? t + (tt[j] || 0) / 1000 : 0;
            if (l > 1e-4) { const ox = -dy / l * w, oy = dx / l * w, a = [t, on], b = [nt, on]; quadV(g, [[x - ox, y - oy, z], up, a], [[nx - ox, ny - oy, z], up, b], [[nx + ox, ny + oy, z], up, b], [[x + ox, y + oy, z], up, a]); }
            if (tt) along.push(nt, nx, ny, z);
            x = nx; y = ny; t = nt;
          }
        });
      }
      groups.forEach(({ tool, obj, g }) => { if (g.v.length) printMeshes.push({ tool, obj, mesh: upload(g) }); });
      print = { file: data.file, layers: L, objects: data.objects || [], colours: data.file_colours || [], layerH: isFinite(hMin) ? hMin : 0.2, top: L[L.length - 1].z,
        centre: isFinite(x0) ? [(x0 + x1) / 2, (y0 + y1) / 2] : [135, 135], size: isFinite(x0) ? Math.max(x1 - x0, y1 - y0, L[L.length - 1].z) : 60 };
      follow.track = buildTrack(data.timeline, along, k);
      follow.started = false;
      queue();
    }

    const follow = newFollow();
    const following = () => follow.on && !!follow.track && !!print;

    /* ---- what moves: everything that depends on the printer's state ---- */
    // A short click for a head docking or leaving its dock (synthesised; off until switched on in Show).
    function click(kind) {
      if (!soundOn) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audio = audio || new AC();
        if (audio.state === 'suspended') audio.resume();
        const t0 = audio.currentTime, attach = kind === 'attach', len = Math.floor(audio.sampleRate * 0.012);
        const tick = audio.createBufferSource(), buf = audio.createBuffer(1, len, audio.sampleRate), data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
        tick.buffer = buf;
        const hp = audio.createBiquadFilter(), gain = audio.createGain();
        hp.type = 'highpass'; hp.frequency.value = attach ? 2200 : 1500; gain.gain.value = attach ? 0.5 : 0.3;
        tick.connect(hp); hp.connect(gain); gain.connect(audio.destination); tick.start(t0);
        const osc = audio.createOscillator(), og = audio.createGain();
        osc.type = 'sine'; osc.frequency.setValueAtTime(attach ? 170 : 130, t0); osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.09);
        og.gain.setValueAtTime(attach ? 0.45 : 0.25, t0); og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.11);
        osc.connect(og); og.connect(audio.destination); osc.start(t0); osc.stop(t0 + 0.12);
        if (attach) {   // the gate closing on the coupling: a second, lighter tick
          const t2 = audio.createBufferSource(); t2.buffer = buf;
          const g2 = audio.createGain(); g2.gain.value = 0.25; t2.connect(hp); hp.connect(g2); g2.connect(audio.destination); t2.start(t0 + 0.07);
        }
      } catch (e) { soundOn = false; }
    }

    /* Moves the filament, the spools and the docking heads on by the time since the last frame. */
    function stepFx(st, active, extruding, now) {
      const dt = fx.t ? Math.min(0.1, Math.max(0, (now - fx.t) / 1000)) : 0;
      fx.t = now; fx.dt = dt;
      const still = reducedMotion();
      const names = Object.keys(st.toolheads || {});
      let busy = false;
      names.forEach((name, i) => {
        const head = st.toolheads[name];
        const sensor = ((st.tuning && st.tuning.runout) || []).find(r => r.id === `e${i}_filament`);
        const det = sensor && typeof sensor.detected === 'boolean' ? sensor.detected : (typeof head.filament_loaded === 'boolean' ? head.filament_loaded : null);
        const event = feedEvent(fx.det[name], det);
        if (det !== null) fx.det[name] = det;
        if (event) fx.feed[name] = { mode: event, t0: now };
        let v = 0;
        const feed = fx.feed[name];
        if (feed) {
          const age = (now - feed.t0) / 1000;
          if (age > feedLength(feed.mode)) delete fx.feed[name]; else v = feedSpeed(feed.mode, age);
        }
        if (!v && name === active) v = activeSpeed(st, extruding);
        fx.v[name] = v;
        if (!still) {
          fx.phase[name] = (fx.phase[name] || 0) + v * dt;
          fx.spin[name] = (fx.spin[name] || 0) + spoolTurn(v, dt);
        }
        if (Math.abs(v) > 0.01 && !still) busy = true;
      });
      // A feed starts at speed zero and builds up, so it keeps the picture moving from its first moment.
      // A head that reports a fault pulses its LED, so the picture keeps moving while one does.
      fx.pulse = !still && names.some(n => st.toolheads[n].status === 'error') ? 0.5 + 0.5 * Math.sin(now / 230) : 1;
      fx.busy = busy || (!still && (Object.keys(fx.feed).length > 0 || fx.pulse !== 1));
    }
    // Where a head is drawn: in its dock, on the carriage, or sliding between them while the carriage is at the dock.
    function placeOf(name, i, on, x, y) {
      const dock = [DOCK.xs[i % 4], DOCK.y];
      let p = fx.place[name];
      if (!p) p = fx.place[name] = { t: on ? 1 : 0, moving: false };
      const target = on ? 1 : 0;
      if (p.t !== target) {
        // The carriage is at the dock when a head is picked up or put down: only then does it slide. Anywhere else
        // (the reading came late, a page just opened) it changes place at once rather than fly across the bed.
        const near = Math.hypot(x - dock[0], y - dock[1]) < 70;
        if (!near || !fx.dt || reducedMotion()) { p.t = target; p.moving = false; }
        else { p.t += Math.sign(target - p.t) * Math.min(Math.abs(target - p.t), fx.dt / 0.35); p.moving = true; fx.busy = true; }
        if (p.t === target && p.moving) { p.moving = false; click(on ? 'attach' : 'detach'); }
      }
      const e = p.t * p.t * (3 - 2 * p.t);
      return { x: dock[0] + (x - dock[0]) * e, y: dock[1] + (y - dock[1]) * e, z: DOCK.tip + (TIP - DOCK.tip) * e + Math.sin(Math.PI * p.t) * 10 };
    }

    function liveScene() {
      const st = state || {}, synced = following(), [x, y, z] = synced ? follow.pos : pos, bedTop = TIP - Math.max(0, Math.min(BED, z));
      const heads = Object.entries(st.toolheads || {});
      const active = st.toolheads && st.toolheads[st.active_toolhead] ? st.active_toolhead : null;
      const printing = ['printing', 'paused'].includes(st.state);
      const items = [];
      const add = (mesh, mat, o = {}) => items.push({ mesh, mat, t: o.t || [0, 0, 0], s: o.s || [1, 1, 1], id: o.id || 0, tex: o.tex, sel: o.sel || 0, glow: o.glow, colour: o.colour, kind: o.kind, shell: o.shell, lining: o.lining, loop: o.loop, alpha: o.alpha, clip: o.clip, play: o.play, layerH: o.layerH, printed: o.printed, rest: o.rest, body: o.body, tool: o.tool, rot: o.rot, flow: o.flow, lamp: o.lamp, axisY: o.axisY });
      // Bed: plate, its label strip, heater, carrier.
      const bedId = 2, bedSel = selected === 'bed' ? 1 : 0, heat = st.bed && st.bed.target > 0 ? Math.min(1, (st.bed.temp || 0) / 110) : 0;
      add(dyn.carrier.mesh, MAT.rail, { t: [0, 0, bedTop], id: bedId, sel: bedSel });
      add(dyn.heater.mesh, MAT.alu, { t: [0, 0, bedTop], id: bedId, sel: bedSel, colour: heat > 0.3 ? lin(.85, .6, .45) : null });
      add(dyn.plate.mesh, MAT.pei, { t: [0, 0, bedTop], id: bedId, sel: bedSel });
      add(dyn.label.mesh, MAT.decal, { t: [0, 0, bedTop], id: bedId, tex: tex.label, sel: bedSel });
      add(dyn.plateArt.mesh, MAT.decal, { t: [0, 0, bedTop], id: bedId, tex: tex.plate, sel: bedSel });
      // Gantry: the X rods, its two Y carriages, the carriage, all just in
      // front of the head they carry (the nozzle itself is at x, y). In the
      // Print view the rods and carriage turn to glass, like the head's body.
      const gy = y + GANTRY_DY;
      add(dyn.xbeam.mesh, MAT.carbon, { t: [0, gy, 0], body: true });
      add(dyn.ycar.mesh, MAT.rail, { t: [0, gy, 0] });
      // The belts run as the head moves: A is x + y and B is x - y (CoreXY). Stylised teeth, exact displacement.
      const run = beltRun(x, y);
      add(dyn.xbeltLo.mesh, MAT.belt, { t: [0, gy, 0], body: true, kind: 'belt', flow: run.a });
      add(dyn.xbeltHi.mesh, MAT.belt, { t: [0, gy, 0], body: true, kind: 'belt', flow: run.b });
      [[-56, run.a], [326, run.b]].forEach(([bx, r]) => [[-8.6, RAIL_Z + 3, r], [8.6, RAIL_Z + 9, -r]].forEach(([dx, bz, phase]) =>
        add(dyn.sbelt.mesh, MAT.belt, { t: [bx + dx, 0, bz], kind: 'belt', flow: phase, axisY: true })));
      add(dyn.carriage.mesh, MAT.body, { t: [x, gy, 0], body: true });
      add(dyn.carriageFace.mesh, MAT.decal, { t: [x, gy, 0], tex: tex.carriage, body: true });
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
        const clipZ = finished ? print.top + 1 : synced ? Math.max(0.2, z) + 0.001 : cur ? L[cur - 1].z + 0.001 : Math.max(0.2, z) + 0.001;
        const play = synced && !finished ? follow.play : null;
        // A U1 can print a file's T1 on another head (extruder_map); colour by the head that prints it.
        const physical = tool => (st.extruder_map && st.extruder_map[tool]) || tool;
        const excluded = new Set((plate && plate.excluded) || []);
        pickNames = print.objects.slice();
        if (showPrint) printMeshes.forEach(m => {
          const head = st.toolheads && st.toolheads[physical(m.tool)], name = print.objects[m.obj];
          const colour = (head && srgb(head.filament_color_hex)) || srgb(print.colours[+String(m.tool).slice(1)]) || lin(.6, .6, .62);
          const skip = name && excluded.has(name);
          const id = m.obj >= 0 ? 40 + m.obj : 0, sel = name && selected === `obj:${name}` ? 1 : 0;
          add(m.mesh, { c: skip ? lin(.55, .55, .57) : colour, r: .5, m: 0, kind: 'print' }, { t: [0, 0, bedTop], id, sel, clip: [1, bedTop + clipZ], play, layerH: print.layerH, printed: true, tool: +String(physical(m.tool)).slice(1) || 0 });
          if (showRest && !finished && !skip) add(m.mesh, { ...MAT.ghost, c: colour, a: .1 }, { t: [0, 0, bedTop], clip: [2, bedTop + clipZ], play, rest: true });
        });
      } else if (partsMeshes.length) {
        // The file's layers aren't known (yet): the objects' outlines stand in, see-through so nobody mistakes
        // them for the print itself.
        pickNames = partsMeshes.map(p => p.name);
        const excluded = new Set((plate && plate.excluded) || []), h = Math.max(0.6, Math.min(BED, z));
        partsMeshes.forEach((p, i) => {
          const skip = excluded.has(p.name);
          if (showPrint) add(p.mesh, { c: skip ? lin(.6, .6, .62) : activeColour, r: .55, m: 0, a: .42, kind: 'layers' }, { t: [0, 0, bedTop], s: [1, 1, skip ? Math.min(h, 2) : h], id: 40 + i, sel: selected === `obj:${p.name}` ? 1 : 0 });
        });
      } else if (printing && showPrint) {
        add(dyn.blob.mesh, { c: activeColour, r: .55, m: 0, a: .42, kind: 'layers' }, { t: [0, 0, bedTop], s: [1, 1, Math.max(0.6, Math.min(BED, z))] });
      }
      // Is plastic coming out? The printer's own word when the file isn't being followed (or has left its path),
      // otherwise the file's: that is the path being drawn. A running print with no word either way counts as laying.
      let extruding = false;
      if (st.state === 'printing' && active) {
        const fileSays = synced && !follow.off ? extrudingAt(follow.track, follow.play) : null;
        const printerSays = st.sync && typeof st.sync.extruding === 'boolean' ? st.sync.extruding : null;
        extruding = fileSays !== null ? fileSays : printerSays !== null ? printerSays : true;
      }
      const note = st.state === 'printing' ? 'printing' : st.state === 'paused' ? 'paused' : 'on carriage';
      // Filament, spools and docking heads move on; the chamber light is the printer's own LED.
      stepFx(st, active, extruding, performance.now());
      const lamp = lampOf(st);
      const printerSpeed = typeof st.extruder_velocity === 'number' ? st.extruder_velocity : 0;
      // Heads: parked in their docks, the active one on the carriage.
      labels = [];
      heads.forEach(([name, d], i) => {
        const on = name === active, id = 10 + i, sel = selected === `head:${name}` ? 1 : 0;
        const pl = placeOf(name, i, on, x, y), hx = pl.x, hy = pl.y, tipZ = pl.z;
        const fault = d.status === 'error', colour = srgb(d.filament_color_hex) || lin(.6, .6, .62);
        const hot = (d.temperature || 0) > 60;
        const t = [hx, hy, tipZ], body = on;   // the working head's body turns to glass in the Print view
        add(dyn.head.mesh, fault ? { ...MAT.head, c: lin(.42, .06, .05) } : MAT.head, { t, id, sel, body });
        add(dyn.headFace.mesh, MAT.decal, { t, id, sel, tex: tex.head, body });
        add(dyn.headYellow.mesh, MAT.yellow, { t, id, sel, body });
        add(dyn.headLed.mesh, { c: fault ? lin(1, .2, .15) : on ? lin(.35, .7, 1) : lin(.4, .95, .5), r: .3, m: 0 }, { t, id, glow: fault ? 0.3 + 0.7 * fx.pulse : 0.9, body });
        add(dyn.nozzle.mesh, MAT.steel, { t, id });
        add(dyn.block.mesh, { c: hot ? lin(.95, .45, .18) : lin(.16, .16, .17), r: .5, m: 0 }, { t, id, glow: hot ? Math.min(0.55, ((d.temperature || 0) - 60) / 300) : 0 });
        if (on && extruding && !fault) {
          // Plastic coming out of the nozzle: a bright bead at the tip, warmed from the filament's own colour.
          const warm = colour.map((v, k) => Math.min(1, v * 0.85 + [0.25, 0.12, 0.03][k]));
          add(dyn.bead.mesh, { c: warm, r: .3, m: 0 }, { t, glow: 1, rest: true });   // rest: left out of the engineering drawing
          add(dyn.halo.mesh, { c: warm, r: .5, m: 0, a: .26 }, { t, glow: 0.9, rest: true });
        }
        // Tube loop: from the top of the head up and back down into the shelf at the back.
        const lk = `${name}|${Math.round(hx)}|${Math.round(hy)}|${tipZ}|${d.filament_color_hex}`;
        if (!loopMeshes[name] || loopMeshes[name].key !== lk) {
          if (loopMeshes[name]) ['ptfe', 'cable', 'fil', 'flow', 'clips', 'stems'].forEach(k => free(loopMeshes[name][k]));
          // As in Snapmaker's photos: a black sleeve straight up from the head,
          // then a beige filament tube and a black cable side by side, held by
          // clips, in a tall loop (wider at the top) that turns back over the
          // body and drops through a sleeve into the shelf above its dock.
          const z0 = tipZ + HEAD.h + 2, top = 724, ex = DOCK.xs[i % 4], ey = (BODY.y1 + BODY.yb) / 2 + 4, ez = BODY.z1, h = top - z0;
          const path = [[hx, hy, z0], [hx, hy, z0 + 72], [hx * 0.85 + ex * 0.15, hy - 24, z0 + h * 0.7], [(hx + ex) / 2, (hy + ey) / 2 - 8, top],
            [hx * 0.15 + ex * 0.85, ey + 34, ez + (top - ez) * 0.62], [ex, ey, ez + 86], [ex, ey, ez - 6]];
          const route = dx => path.map(p => [p[0] + dx, p[1], p[2]]);
          const clips = geo();
          for (const p of [path[1], path[2], path[4], path[5]]) box(clips, p[0] - 7.5, p[1] - 4.5, p[2] - 4, p[0] + 7.5, p[1] + 4.5, p[2] + 4, 1.5);
          const stems = geo();
          tube(stems, [path[0], [hx, hy, z0 + 36], path[1]], 4.8, 12, 4);
          tube(stems, [[ex, ey, ez + 86], [ex, ey, ez + 40], [ex, ey, ez - 6]], 4.8, 12, 4);
          loopMeshes[name] = { key: lk, ptfe: upload(tube(geo(), route(-3.6), 3.1, 12, 8)), fil: upload(tube(geo(), route(-3.6), 0.9, 6, 8)), flow: upload(tube(geo(), route(-3.6), 2.3, 8, 6, true)), cable: upload(tube(geo(), route(3.6), 2.7, 10, 8)), clips: upload(clips), stems: upload(stems) };
        }
        const lm = loopMeshes[name];
        // The loops count as part of the case in the drawing: they would
        // otherwise run off the top of a sheet sized for the mechanism.
        add(lm.cable, MAT.cable, { id, lining: true, loop: true });
        add(lm.fil, { c: colour, r: .4, m: 0 }, { id, lining: true, loop: true });
        // Filament on the move: bright dashes in this head's colour that run toward the nozzle while it feeds or
        // prints, and back while it retracts or unloads, at the speed the printer reports.
        const fk = flowAlpha(fx.v[name] || 0);
        if (fk > 0) {
          const run = -(fx.phase[name] || 0), flowMat = { c: colour, r: .3, m: 0, a: .96, kind: 'flow' };
          add(lm.flow, flowMat, { id, lining: true, loop: true, rest: true, flow: run, alpha: fk, glow: .7 });
          if (dyn[`sflow${i}`]) add(dyn[`sflow${i}`].mesh, flowMat, { id: 20 + i, shell: true, rest: true, flow: run, alpha: fk, glow: .7 });
        }
        // Plastic coming out of a nozzle that isn't printing is a purge: the printer's own extruder speed says so.
        if (on && !fault && printerSpeed > 0.3 && st.state !== 'printing' && st.state !== 'paused') {
          add(dyn.purge.mesh, { c: colour, r: .35, m: 0 }, { t, glow: .25, rest: true });
        }
        add(lm.ptfe, MAT.tube, { id, lining: true, loop: true });
        add(lm.clips, MAT.cable, { id, lining: true, loop: true });
        add(lm.stems, MAT.cable, { id, lining: true, loop: true });
        const at = style === 'drawing' ? [hx, hy, tipZ + HEAD.h + 14] : [hx, hy, tipZ + HEAD.h + 24];
        // The working head's tag says what it is doing, or how sure the dashboard is of where it is.
        const say = !on ? '' : posKind === 'unknown' ? 'position unknown' : posKind === 'last' ? 'last known position' : posKind === 'homing' ? 'homing' : note;
        labels.push({ id: `head:${name}`, text: name, colour: d.filament_color_hex || '#999999', at, centre: [hx, hy, tipZ + HEAD.h / 2], on, fault, hot, temp: d.temperature, say });
      });
      if (lamp) items.forEach(it => { if (!it.lining && !it.shell && !it.rest) it.lamp = lamp.rgb; });
      // Spools on the side hubs, in the loaded colours: T0, T1 left (spools 1 and 2), T2, T3 right (3 and 4),
      // the first of each pair on the upper hub, as Snapmaker numbers them. The filament runs to the feeder.
      heads.slice(0, 4).forEach(([name, d], i) => {
        const left = i < 2, hub = i % 2 ? HUB.lower : HUB.upper, sx = left ? BODY.x0 - HUB.out : BODY.x1 + HUB.out;
        const colour = srgb(d.filament_color_hex) || lin(.6, .6, .62), sel = selected === `head:${name}` ? 1 : 0;
        const turn = fx.spin[name] || 0;   // the spool turns as filament leaves it (or goes back on)
        add(dyn.spoolCore.mesh, { c: colour, r: .5, m: 0, kind: 'spool' }, { t: [sx, hub[0], hub[1]], id: 20 + i, sel, colour: null, footOverride: [hub[0], hub[1]], rot: turn });
        add(dyn.spoolFlange.mesh, MAT.kraft, { t: [sx, hub[0], hub[1]], id: 20 + i, sel, rot: turn });
        add(dyn.spoolMarks.mesh, MAT.rim, { t: [sx, hub[0], hub[1]], id: 20 + i, sel, rot: turn });
        add(dyn[`strand${i}`].mesh, { c: colour, r: .4, m: 0 }, { id: 20 + i, shell: true });
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
      const kind = { tex: 1, pei: 2, spool: 7, layers: 4, carbon: 5, glass: 8, clear: 0, print: 9, ghost: 10, brushed: 11, thread: 12, flow: 13, belt: 14 }[it.kind || mat.kind] || 0;
      gl.uniform1i(u.uKind, it.tex ? 1 : kind);
      if (it.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, it.tex); gl.uniform1i(u.uTex, 0); }
      gl.uniform1f(u.uSel, it.sel || 0);
      if (kind === 7) gl.uniform4f(u.uFoot, it.t[1], it.t[2], 0, 0);
      gl.uniform1f(u.uLayerH, it.layerH || 0.2);
      gl.uniform1f(u.uFlow, it.flow || 0);
      gl.uniform3fv(u.uLamp, it.lamp || NO_LAMP);
      if (kind === 14) gl.uniform4f(u.uFoot, it.axisY ? 1 : 0, 0, 0, 0);
    }
    function drawItem(prog, it) {
      gl.uniform3fv(prog.u.uT, it.t); gl.uniform3fv(prog.u.uS, it.s);
      if (prog.u.uRot) gl.uniform1f(prog.u.uRot, it.rot || 0);
      if (prog.u.uClip) gl.uniform2f(prog.u.uClip, it.clip ? it.clip[0] : 0, it.clip ? it.clip[1] : 0);
      if (prog.u.uPlay) gl.uniform1f(prog.u.uPlay, it.play != null ? it.play : -1);
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

    // What a drawing really costs: until the next frame can start, less one frame's time. Software
    // graphics does its work in the browser's GPU process, which the script's own clock never sees.
    let drawMs = 0;
    function render() {
      const began = performance.now();
      draw();
      requestAnimationFrame(() => { drawMs = drawMs * 0.7 + Math.max(0, performance.now() - began - 17) * 0.3; adaptQuality(); });
    }
    // Aim for draws of about 60 ms or less. A slow measure (over 120 ms, averaged over a few draws so one hiccup does not count) draws
    // fewer pixels from the next frame on; draws that stay cheap (under 25 ms for 8 seconds) bring the pixels back a step at a time.
    function adaptQuality() {
      if (style === 'drawing') return;
      const now = performance.now();
      if (drawMs > 120 && quality > 0.34) { quality = Math.max(0.34, quality * 0.7); qualityAt = now; }
      else if (drawMs < 25 && quality < 1 && now - qualityAt > 8000) { quality = Math.min(1, quality / 0.85); qualityAt = now; }
    }
    function draw() {
      queued = false;
      if (!state || !resize()) return;
      if (following()) advance(follow, performance.now());
      screenUpdate();
      const live = liveScene(), all = allItems(live);
      const M = matrices();
      if (style === 'drawing') { renderDrawing(M, all, live); return; }
      const items = withCase(all);
      const opaque = items.filter(it => !(it.mat.a != null && it.mat.a < 1));
      const clear = items.filter(it => it.mat.a != null && it.mat.a < 1);
      inkSvg.innerHTML = '';
      // Shadows: only when something that casts one has moved.
      // Following the G-code the head moves every frame; the shadow only needs redoing as it moves on.
      const shadowPos = following() ? follow.pos.map(v => Math.round(v / 4)).concat(Math.round(follow.play / 2)) : pos.map(v => Math.round(v));
      const sk = JSON.stringify([shadowPos, state.state, partsKey.length, Object.keys(loopMeshes).map(k => loopMeshes[k].key),
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
      // The dark theme gets a dark studio; the printer and the print keep their own colours.
      const night = document.documentElement.getAttribute('data-theme') === 'dark';
      const bgTop = night ? lin(.2, .23, .28) : lin(.968, .972, .98), bgBot = night ? lin(.085, .105, .135) : lin(.885, .892, .905);
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
      gl.uniform3fv(u.uT, [0, 0, 0]); gl.uniform3fv(u.uS, [1, 1, 1]); gl.uniform2f(u.uClip, 0, 0); gl.uniform1f(u.uPlay, -1);
      gl.uniform1f(u.uRot, 0); gl.uniform1f(u.uFlow, 0); gl.uniform3fv(u.uLamp, NO_LAMP);
      gl.bindVertexArray(floor.vao); gl.drawArrays(gl.TRIANGLES, 0, floor.count);
      opaque.forEach(it => { setMat(u, it.mat, it); drawItem(P.main, it); });
      // See-through things last, farthest first, without hiding what's behind.
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      const eye = M.eye, dist = it => { const c = it.mesh.centre || [0, 0, 0]; return Math.hypot(c[0] + it.t[0] - eye[0], c[2] + it.t[2] - eye[1], -(c[1] + it.t[1]) - eye[2]) - (it.kind === 'flow' ? 8 : 0); };   // filament dashes draw after the tube round them
      clear.sort((a, b) => dist(b) - dist(a)).forEach(it => { setMat(u, it.mat, it); drawItem(P.main, it); });
      gl.depthMask(true); gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
      renderTags(M);
    }

    function renderTags(M) {
      const placed = [];
      const list = labels.map(l => ({ ...l, p: project(M.VP, ...l.at) })).sort((a, b) => b.p[1] - a.p[1]);
      list.forEach(l => {
        const w = l.on ? 30 + 7.2 * (l.text.length + (l.say ? 3 + l.say.length : 0)) : 46, h = 22;
        let y = l.p[1];
        for (let tries = 0; tries < 6; tries++) {
          const hit = placed.find(p => Math.abs(p.x - l.p[0]) < (p.w + w) / 2 && Math.abs(p.y - y) < h);
          if (!hit) break;
          y = hit.y - h - 2;
        }
        l.p = [l.p[0], y]; placed.push({ x: l.p[0], y, w });
      });
      const html = !showTags ? '' : list.map(l => `<span class="t3-tag${l.on ? ' on' : ''}${l.fault ? ' fault' : ''}${selected === l.id ? ' sel' : ''}" data-id="${esc(l.id)}" style="left:${l.p[0].toFixed(1)}px;top:${l.p[1].toFixed(1)}px"><i style="background:${/^#[0-9a-f]{6}$/i.test(l.colour) ? l.colour : '#999'}"></i>${esc(l.text)}${l.say ? ' · ' + esc(l.say) : ''}</span>`).join('');
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
      if (showCase && v === 'front') { dim([BODY.x0, BODY.y0, 0], [BODY.x1, BODY.y0, 0], [0, 0, -46], `≈${BODY.x1 - BODY.x0}${nb}mm`); dim([BODY.x0, BODY.y0, 0], [BODY.x0, BODY.y0, BODY.z1], [-150, 0, 0], `≈${BODY.z1}${nb}mm`); }
      if (showCase && v === 'top') { dim([BODY.x0, BODY.y0, BODY.z1], [BODY.x1, BODY.y0, BODY.z1], [0, -40, 0], `≈${BODY.x1 - BODY.x0}${nb}mm`); dim([BODY.x1, BODY.y0, BODY.z1], [BODY.x1, BODY.yb, BODY.z1], [110, 0, 0], `≈${BODY.yb - BODY.y0}${nb}mm`); }
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
    window.addEventListener('dv-theme', () => queue());

    /* ---- interaction: drag to turn (with a little glide after), right-drag
     *      or Shift-drag to move, wheel or pinch to zoom, double-click to
     *      reset, click to pick ---- */
    const touches = new Map();
    let drag = null, spin = 0;

    /* Moving the real head from the twin. With move mode on, a drag across the
     * model carries a target over the nozzle's plane (the head moves in X and Y
     * at the nozzle tip's height; the bed moves in Z), labelled with its X and Y
     * and kept inside the printer. Letting go hands the point to the page, which
     * sends it through the same checked move command as the Move card. */
    let moveFn = null, moveDrag = null;
    const marker = document.createElement('div');
    marker.className = 'twin-move-marker'; marker.hidden = true; marker.setAttribute('aria-hidden', 'true');
    wrap.appendChild(marker);
    function invert(m) {
      const o = new Array(16);
      o[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
      o[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
      o[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
      o[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
      o[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
      o[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
      o[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
      o[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
      o[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
      o[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
      o[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
      o[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
      o[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
      o[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
      o[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
      o[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
      const det = m[0] * o[0] + m[1] * o[4] + m[2] * o[8] + m[3] * o[12];
      return Math.abs(det) < 1e-12 ? null : o.map(v => v / det);
    }
    const apply4 = (m, v) => [0, 1, 2, 3].map(i => m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i] * v[3]);
    // Model millimetres (x, y, z up) are drawn as GL (x, z, -y).
    function nozzlePlanePoint(clientX, clientY) {
      const r = canvas.getBoundingClientRect(), inv = invert(matrices().VP);
      if (!inv || !r.width) return null;
      const nx = (clientX - r.left) / r.width * 2 - 1, ny = 1 - (clientY - r.top) / r.height * 2;
      const at = z => { const o = apply4(inv, [nx, ny, z, 1]); return o.map(c => c / o[3]); };
      const a = at(-1), b = at(1), t = (TIP - a[1]) / (b[1] - a[1]);
      if (!Number.isFinite(t) || t < 0) return null;
      const m = (state && state.machine) || {}, lo = m.min_mm || [0, 0, 0], hi = m.max_mm || [270, 270, 270];
      const x = Math.min(hi[0], Math.max(lo[0], a[0] + t * (b[0] - a[0])));
      const y = Math.min(hi[1], Math.max(lo[1], -(a[2] + t * (b[2] - a[2]))));
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    }
    function showMarker(pt) {
      const c = apply4(matrices().VP, [pt[0], TIP, -pt[1], 1]);
      marker.style.left = `${((c[0] / c[3]) * 0.5 + 0.5) * W}px`;
      marker.style.top = `${(1 - ((c[1] / c[3]) * 0.5 + 0.5)) * H}px`;
      marker.dataset.label = `X ${pt[0].toFixed(1)} · Y ${pt[1].toFixed(1)}`;
      marker.hidden = false;
    }

    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture?.(e.pointerId);
      if (moveFn && e.button === 0 && !e.shiftKey && !touches.size && style === 'model') {
        const pt = nozzlePlanePoint(e.clientX, e.clientY);
        if (pt) { moveDrag = { id: e.pointerId, pt }; cancelAnimationFrame(spin); showMarker(pt); return; }
      }
      cancelAnimationFrame(spin); cam.vyaw = cam.vpitch = 0;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, lt: performance.now(), yaw: cam.yaw, pitch: cam.pitch, tx: cam.tx, ty: cam.ty, pan: e.button === 2 || e.shiftKey, moved: false, zoom: cam.zoom, spread: 0 };
      if (touches.size === 2) { const [a, b] = [...touches.values()]; drag.spread = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    canvas.addEventListener('pointermove', e => {
      if (moveDrag && e.pointerId === moveDrag.id) {
        const pt = nozzlePlanePoint(e.clientX, e.clientY);
        if (pt) { moveDrag.pt = pt; showMarker(pt); }
        return;
      }
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
      if (moveDrag && e.pointerId === moveDrag.id) {
        const pt = moveDrag.pt;
        moveDrag = null;
        setTimeout(() => { marker.hidden = true; }, 900);
        if (e.type === 'pointerup' && moveFn) moveFn({ x: pt[0], y: pt[1] });
        return;
      }
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
      update(s, p, how) {
        if (state && s && s.printer_id !== state.printer_id) { fx.phase = {}; fx.spin = {}; fx.v = {}; fx.feed = {}; fx.det = {}; fx.place = {}; }
        if (s !== state) syncFrom(follow, s, print && print.file, performance.now());
        state = s; if (p) pos = p;
        if (how && how.pos) posKind = how.pos;
        queue();
      },
      /* Following the G-code: whether it is, and how well (for the card's
       * sync note). drift: seconds between the playhead and the last reading. */
      drawCost() { return drawMs; },
      drawQuality() { return quality; },
      /* True while filament, a spool or a head is moving: the card keeps redrawing (at the pace it can afford). */
      moving() { return fx.busy; },
      syncInfo() {
        if (!following()) return null;
        return { play: follow.play, total: follow.track.seconds, rate: follow.rate, offPath: follow.off, paused: follow.paused,
                 live: !!follow.hasLive, error_mm: follow.err, drift: follow.pending, matched: follow.matched, readings: follow.readings };
      },
      select(id) { selected = id || ''; queue(); },
      /* A feed begun from outside (the Feed button): 'load' pushes filament toward the nozzle, 'unload' draws it back. */
      feed(head, mode) { if (head) { fx.feed[head] = { mode: mode === 'unload' ? 'unload' : 'load', t0: performance.now() }; fx.busy = true; queue(); } },
      /* What is moving now, for the card's note and for tests. */
      fxInfo() { return { speeds: { ...fx.v }, feeding: Object.keys(fx.feed), busy: fx.busy, sound: soundOn, places: Object.fromEntries(Object.entries(fx.place).map(([k, p]) => [k, +p.t.toFixed(2)])) }; },
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
        if ('sound' in o) { soundOn = !!o.sound; if (soundOn) click('detach'); }
        if ('spin' in o) setSpin(o.spin);
        shadowKey = ''; queue();
      },
      printInfo() { return print ? { file: print.file, layers: print.layers.length, top: print.top, objects: print.objects.slice() } : null; },
      onViewChange(fn) { viewChanged = fn; },
      /* fn({x, y}) is called when a drag in move mode is let go; null turns move mode off. */
      setMoveMode(fn) { moveFn = typeof fn === 'function' ? fn : null; wrap.classList.toggle('is-moving-head', !!moveFn); if (!moveFn) marker.hidden = true; },
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

  /* Homing, followed as it really moves. At the start of a homing move Klipper declares the axis homed at a
   * position it makes up, past the far end of the axis (the endstop plus or minus 1.5 times the travel,
   * kinematics home() in Klipper), then counts the real motion from there. Drawn as read, the bed dropped to the
   * bottom the moment Home was pressed while the real one had not moved. Those made-up numbers are a constant
   * offset from the real place, so the twin keeps drawing the axis where it was and moves it by what the printer
   * reports it moved. The offset ends when Klipper sets a real position again (a sudden jump back inside the
   * axis), when the reading inside the axis stays still for 2 s, or after 3 minutes. */
const HOMING_STILL_MS = 2000, HOMING_MAX_MS = 180000, HOMING_JUMP_MM_S = 250;
function newHoming() { return { last: [null, null, null], at: 0, off: [null, null, null], since: [0, 0, 0], still: [0, 0, 0] }; }
function followHoming(h, raw, lo, hi, drawn, now) {
    const pos = [], homing = [], dt = Math.max(0.05, (now - h.at) / 1000);
    for (let i = 0; i < 3; i++) {
      const v = raw[i];
      if (!Number.isFinite(v)) { pos.push(null); homing.push(false); continue; }
      const span = Math.max(1, hi[i] - lo[i]), slack = Math.max(5, span * 0.05);
      const outside = v < lo[i] - slack || v > hi[i] + slack;
      const last = h.last[i], step = last == null ? 0 : Math.abs(v - last);
      if (h.off[i] == null && outside) {
        const was = drawn && Number.isFinite(drawn[i]) ? drawn[i] : last != null && !(last < lo[i] - slack || last > hi[i] + slack) ? last : (lo[i] + hi[i]) / 2;
        h.off[i] = Math.min(hi[i], Math.max(lo[i], was)) - v; h.since[i] = now; h.still[i] = now;
      } else if (h.off[i] != null) {
        if (step > 0.05) h.still[i] = now;
        const jumped = step > span * 0.3 && step / dt > HOMING_JUMP_MM_S;
        if (!outside && (jumped || now - h.still[i] >= HOMING_STILL_MS)) h.off[i] = null;
        else if (now - h.since[i] >= HOMING_MAX_MS) h.off[i] = null;
      }
      h.last[i] = v;
      if (h.off[i] == null) { pos.push(v); homing.push(false); }
      else { pos.push(Math.min(hi[i], Math.max(lo[i], v + h.off[i]))); homing.push(true); }
    }
    h.at = now;
    return { pos, homing };
  }

return { create, ENVELOPE, BODY, sync: { newFollow, buildTrack, timeAtByte, posAt, nearest, syncFrom, advance, extrudingAt },
           fx: { feedEvent, feedSpeed, feedLength, activeSpeed, flowAlpha, spoolTurn, beltRun, lampOf },
           homing: { newHoming, followHoming, HOMING_STILL_MS } };
})();
