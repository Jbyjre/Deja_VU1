/* Reads a sliced G-code file into the arrays the Preview draws, off the page's thread. Nothing is sent anywhere.
 *
 * It keeps every move (up to MAX_SEGMENTS), with what the slicer wrote about it: the line type (";TYPE:"), the line width and layer height
 * (";WIDTH:", ";HEIGHT:"), the layer (";LAYER_CHANGE") and the head (T0 to T3). Times are nominal: the length of a move divided by its
 * requested speed, with no acceleration, heating or pauses, and the Preview says so. The slicer's own estimates (its header comments) are
 * passed along as they are. It is not Confirm Print's check (backend/gcode_tools.py) and claims nothing about safety.
 *
 * Reply: { n, p: Float32Array(6n), a: Float32Array(4n), c: Uint8Array(4n), layers, features, tools, bounds, markers, meta, totals, capped } with a = [feature + 32 x head
 * + 256 x extruding, layer, speed mm/s, order] and c = [width x 100, height x 100, 0, 0]. */
'use strict';
const MAX_SEGMENTS = 2500000;
const FEATURE_WORDS = ['outer wall', 'inner wall', 'overhang wall', 'sparse infill', 'internal solid infill', 'top surface', 'bottom surface', 'bridge', 'gap infill',
  'skirt', 'brim', 'support', 'support interface', 'prime tower', 'custom', 'other'];
const KEEP = ['estimated printing time (normal mode)', 'total filament used [g]', 'filament used [g]', 'filament used [mm]', 'filament used [cm3]', 'total filament cost', 'filament cost', 'total layer number',
  'nozzle_diameter', 'layer_height', 'filament_colour', 'filament_type', 'total estimated time'];

class Grow {
  constructor(Type, per) { this.Type = Type; this.per = per; this.cap = 1 << 16; this.n = 0; this.buf = new Type(this.cap * per); }
  ensure() {
    if (this.n < this.cap) return;
    this.cap *= 2;
    const next = new this.Type(this.cap * this.per);
    next.set(this.buf);
    this.buf = next;
  }
  done() { return this.buf.slice(0, this.n * this.per); }
}

function featureIndex(name) {
  const t = name.toLowerCase();
  for (let i = 0; i < FEATURE_WORDS.length - 1; i++) if (t.includes(FEATURE_WORDS[i])) return i;
  if (t.includes('wipe tower')) return 13;
  if (t.includes('internal bridge')) return 7;
  return 15;
}

function parse(text) {
  const P = new Grow(Float32Array, 6), A = new Grow(Float32Array, 4), C = new Grow(Uint8Array, 4);
  const names = new Map(), meta = {}, markers = [], layers = [], toolsSeen = new Set();
  const totals = { timeByFeature: new Float64Array(16), lengthByFeature: new Float64Array(16), extrudedByTool: [0, 0, 0, 0], travel: 0, toolChanges: 0, retractions: 0 };
  let x = 0, y = 0, z = 0, e = 0, absolute = true, absE = false, f = 1800, tool = 0, feature = 15, layer = -1, width = 0.42, height = 0.2, order = 0, capped = false;
  let sawMarker = false, layerStartZ = -1, firstExtrusion = false, lastLayerOrder = 0, layerTime = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];

  const closeLayer = () => { if (layer >= 0 && layers[layer]) { layers[layer].last = order - 1; layers[layer].time = layerTime; } layerTime = 0; };
  const openLayer = zNow => { closeLayer(); layer++; layers[layer] = { z: zNow, first: order, last: order, time: 0 }; };
  const add = (x0, y0, z0, x1, y1, z1, extruding, w, h) => {
    if (A.n >= MAX_SEGMENTS) { capped = true; return; }
    P.ensure(); A.ensure(); C.ensure();
    const i = P.n * 6;
    P.buf[i] = x0; P.buf[i + 1] = y0; P.buf[i + 2] = z0; P.buf[i + 3] = x1; P.buf[i + 4] = y1; P.buf[i + 5] = z1;
    const j = A.n * 4;
    A.buf[j] = feature + 32 * tool + 256 * (extruding ? 1 : 0); A.buf[j + 1] = Math.max(0, layer); A.buf[j + 2] = f / 60; A.buf[j + 3] = order;
    const k = C.n * 4;
    C.buf[k] = Math.min(255, Math.round(w * 100)); C.buf[k + 1] = Math.min(255, Math.round(h * 100)); C.buf[k + 2] = 0; C.buf[k + 3] = 0;
    P.n++; A.n++; C.n++; order++;
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0), t = f > 0 ? len / (f / 60) : 0;
    layerTime += t;
    if (extruding) { totals.timeByFeature[feature] += t; totals.lengthByFeature[feature] += len; for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], c === 0 ? Math.min(x0, x1) : c === 1 ? Math.min(y0, y1) : Math.min(z0, z1)); hi[c] = Math.max(hi[c], c === 0 ? Math.max(x0, x1) : c === 1 ? Math.max(y0, y1) : Math.max(z0, z1)); } }
    else totals.travel += len;
  };

  const lines = text.length;
  let at = 0;
  while (at < lines) {
    let end = text.indexOf('\n', at);
    if (end < 0) end = lines;
    let a = at;
    at = end + 1;
    while (a < end && (text.charCodeAt(a) === 32 || text.charCodeAt(a) === 9)) a++;
    if (a >= end) continue;
    const first = text.charCodeAt(a);
    if (first === 59) {                                   // ';' a comment
      const c = text.slice(a + 1, Math.min(end, a + 160)).trim();
      if (c.startsWith('TYPE:')) { const n = c.slice(5).trim(); feature = featureIndex(n); names.set(feature, n); }
      else if (c.startsWith('LAYER_CHANGE')) { sawMarker = true; openLayer(z); }
      else if (c.startsWith('WIDTH:')) width = parseFloat(c.slice(6)) || width;
      else if (c.startsWith('HEIGHT:')) height = parseFloat(c.slice(7)) || height;
      else if (c.startsWith('Z:')) { const zz = parseFloat(c.slice(2)); if (Number.isFinite(zz) && layers[layer]) layers[layer].z = zz; }
      else {
        const eq = c.indexOf(' = ');
        if (eq > 0) { const key = c.slice(0, eq).trim(); if (KEEP.includes(key)) meta[key] = c.slice(eq + 3).trim().slice(0, 240); }
      }
      continue;
    }
    let semi = text.indexOf(';', a);
    const stop = semi > 0 && semi < end ? semi : end;
    const body = text.slice(a, stop).trim();
    if (!body) continue;
    const parts = body.split(/\s+/), cmd = parts[0].toUpperCase();
    if (cmd === 'G0' || cmd === 'G1' || cmd === 'G2' || cmd === 'G3') {
      let nx = x, ny = y, nz = z, ne = e, ci = 0, cj = 0;
      for (let k = 1; k < parts.length; k++) {
        const w0 = parts[k].charCodeAt(0), v = parseFloat(parts[k].slice(1));
        if (!Number.isFinite(v)) continue;
        if (w0 === 88 || w0 === 120) nx = absolute ? v : x + v;
        else if (w0 === 89 || w0 === 121) ny = absolute ? v : y + v;
        else if (w0 === 90 || w0 === 122) nz = absolute ? v : z + v;
        else if (w0 === 69 || w0 === 101) ne = absE ? v : e + v;
        else if (w0 === 70 || w0 === 102) f = v;
        else if (w0 === 73 || w0 === 105) ci = v;
        else if (w0 === 74 || w0 === 106) cj = v;
      }
      const de = ne - e, extruding = de > 1e-9 && (nx !== x || ny !== y);
      if (de < -1e-9) totals.retractions++;
      if (extruding && !firstExtrusion) { firstExtrusion = true; if (layer < 0) openLayer(nz); }
      if (extruding && !sawMarker && nz > layerStartZ + 0.001 && layer >= 0) { layerStartZ = nz; openLayer(nz); }
      if (extruding && layerStartZ < 0) layerStartZ = nz;
      if (extruding) totals.extrudedByTool[tool] += de;
      if (cmd === 'G2' || cmd === 'G3') {
        const cx = x + ci, cy = y + cj, r = Math.hypot(ci, cj);
        let a0 = Math.atan2(y - cy, x - cx), a1 = Math.atan2(ny - cy, nx - cx);
        if (cmd === 'G2') { if (a1 >= a0) a1 -= Math.PI * 2; } else if (a1 <= a0) a1 += Math.PI * 2;
        const steps = Math.max(2, Math.min(48, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 24))));
        let px = x, py = y, pz = z;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps, ang = a0 + (a1 - a0) * t, qx = s === steps ? nx : cx + r * Math.cos(ang), qy = s === steps ? ny : cy + r * Math.sin(ang), qz = z + (nz - z) * t;
          add(px, py, pz, qx, qy, qz, extruding, width, height); px = qx; py = qy; pz = qz;
        }
      } else if (nx !== x || ny !== y || nz !== z) add(x, y, z, nx, ny, nz, extruding, width, height);
      x = nx; y = ny; z = nz; e = ne;
    } else if (cmd === 'G90') absolute = true;
    else if (cmd === 'G91') absolute = false;
    else if (cmd === 'M82') absE = true;
    else if (cmd === 'M83') absE = false;
    else if (cmd === 'G92') { for (let k = 1; k < parts.length; k++) if (parts[k][0] === 'E' || parts[k][0] === 'e') e = parseFloat(parts[k].slice(1)) || 0; }
    else if (cmd.length >= 2 && cmd.charCodeAt(0) === 84 && /^T\d+$/.test(cmd)) {
      const t = parseInt(cmd.slice(1), 10);
      if (t >= 0 && t < 4) { if (t !== tool && firstExtrusion) { totals.toolChanges++; if (markers.length < 4000) markers.push({ at: [x, y, z], tool: t, layer: Math.max(0, layer) }); } tool = t; toolsSeen.add(t); }
    }
  }
  closeLayer();
  if (!layers.length && A.n) layers.push({ z, first: 0, last: A.n - 1, time: 0 });
  void lastLayerOrder;
  const features = [...names.entries()].map(([i, n]) => ({ index: i, name: n, time: totals.timeByFeature[i], length: totals.lengthByFeature[i] })).sort((p, q) => p.index - q.index);
  return { n: A.n, p: P.done(), a: A.done(), c: C.done(), layers, features, tools: [...toolsSeen].sort(), bounds: { min: lo, max: hi }, markers, meta, capped,
    totals: { toolChanges: totals.toolChanges, retractions: totals.retractions, travel: totals.travel, extrudedByTool: totals.extrudedByTool, timeNominal: layers.reduce((s, l) => s + (l.time || 0), 0) } };
}

self.onmessage = ev => {
  const { id, buffer } = ev.data;
  try {
    const out = parse(new TextDecoder().decode(buffer));
    self.postMessage({ id, ok: true, ...out }, [out.p.buffer, out.a.buffer, out.c.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
