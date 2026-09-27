/* Deja Vu1 — Photo-to-Print Studio.
 *
 * A photo in, a colour-layered relief model out, built from filament
 * colours you own - all of it in this page. The photo is never uploaded;
 * only the finished STL / 3MF is sent to the dashboard's file library.
 *
 * The technique is the well-known "HueForge" one, not an invention here:
 * every filament is slightly see-through, so a thin layer of white over
 * black reads grey and a thick one reads white. Stack colours in bands
 * (darkest at the bottom), make each pixel of the print a column exactly
 * as tall as it needs to be, and the colour you see at that pixel is the
 * top band's colour blended with what shows through from below.
 *
 *   1. model    each layer of filament c, h mm thick, lets through
 *               exp(-3·h / TD_c) of the light (Beer–Lambert: absorption
 *               grows exponentially with thickness; the factor 3 makes the
 *               "transmission distance" TD the thickness that hides ~95%).
 *               Layers are composited top-down in linear light.
 *   2. table    for every possible column height, the colour it shows
 *   3. solve    each pixel takes the height whose colour is closest to
 *               the photo's (distance in OKLab, so "closest" means closest
 *               to the eye)
 *   4. bands    where each colour starts is optimised by coordinate descent
 *               on the total error over a sample of the photo
 *   5. mesh     one column per pixel, joined into a single closed solid,
 *               written as STL or as a 3MF that also carries the tool
 *               changes (Metadata/custom_gcode_per_layer.xml, the layout
 *               OrcaSlicer's own 3MF reader expects - see photo_studio.py)
 *
 * StudioCore (sections 1-5) is plain functions with no DOM, so it can be
 * checked outside a browser; the page (section 6) uses DV3D.parseSTL and
 * DV3D.Viewer from viewer3d.js to preview the result like any other model.
 */
'use strict';

const StudioCore = (() => {
  /* ---------------- 1. colour ---------------- */

  const hexRGB = (hex) => {
    const v = parseInt(String(hex).replace('#', ''), 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
  };
  const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const toSRGB = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  // OKLab (Björn Ottosson, 2020) from linear sRGB.
  function oklab(r, g, b) {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  const luminance = (hex) => { const [r, g, b] = hexRGB(hex).map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

  /* ---------------- 2. the stack ---------------- */

  /* Which colour prints layer j (0-based, counting the base layers). */
  function colourAt(j, plan) {
    const extra = j - plan.baseLayers;
    let c = 0;
    for (let i = 1; i < plan.starts.length; i++) if (extra >= plan.starts[i]) c = i;
    return c;
  }

  /* The colour (linear RGB) a column of `layers` layers shows. */
  function simulate(layers, plan) {
    const alpha = (c, h) => 1 - Math.exp(-3 * h / Math.max(0.05, plan.colours[c].td));
    const lin = plan.colours.map(c => hexRGB(c.hex).map(toLin));
    const out = [0, 0, 0];
    let trans = 1;
    for (let j = layers - 1; j >= 0 && trans > 1e-4; j--) {
      const c = colourAt(j, plan), a = alpha(c, j === 0 ? plan.firstLayerH : plan.layerH);
      for (let k = 0; k < 3; k++) out[k] += trans * a * lin[c][k];
      trans *= 1 - a;
    }
    // Light that gets through every layer is counted as lost, not as a
    // bright backing: front-lit prints are seen by what they reflect, and
    // inventing a light wall behind them would flatter thin bases.
    return out;
  }

  function table(plan) {
    const rows = [];
    for (let n = 0; n <= plan.maxLayers; n++) {
      const lin = simulate(plan.baseLayers + n, plan);
      rows.push({ lin, lab: oklab(...lin) });
    }
    return rows;
  }

  /* ---------------- 3. solve ---------------- */

  /* target: Float32Array of OKLab triples. Returns layer counts per pixel. */
  function solve(target, rows) {
    const n = target.length / 3, heights = new Uint8Array(n);
    let total = 0;
    for (let p = 0; p < n; p++) {
      const L = target[p * 3], A = target[p * 3 + 1], B = target[p * 3 + 2];
      let best = 0, bestD = Infinity;
      for (let h = 0; h < rows.length; h++) {
        const q = rows[h].lab, dL = L - q[0], dA = A - q[1], dB = B - q[2];
        const d = dL * dL + dA * dA + dB * dB;
        if (d < bestD) { bestD = d; best = h; }
      }
      heights[p] = best;
      total += Math.sqrt(bestD);
    }
    return { heights, meanDeltaE: n ? (total / n) * 100 : 0 };
  }

  function errorOf(sample, plan) {
    const rows = table(plan);
    let total = 0;
    for (let p = 0; p < sample.length; p += 3) {
      let bestD = Infinity;
      for (let h = 0; h < rows.length; h++) {
        const q = rows[h].lab, dL = sample[p] - q[0], dA = sample[p + 1] - q[1], dB = sample[p + 2] - q[2];
        const d = dL * dL + dA * dA + dB * dB;
        if (d < bestD) bestD = d;
      }
      total += Math.sqrt(bestD);
    }
    return total;
  }

  /* ---------------- 4. bands ---------------- */

  function evenStarts(k, maxLayers) {
    return Array.from({ length: k }, (_, i) => Math.round(i * maxLayers / k));
  }

  /* Move each colour's start layer up or down while it lowers the total
   * error; repeat until nothing improves. starts[0] is always 0 (the first
   * colour is the base). Deterministic, so the same photo gives the same plan. */
  function optimiseStarts(target, plan, sampleSize = 2500) {
    const n = target.length / 3, step = Math.max(1, Math.floor(n / sampleSize));
    const sample = [];
    for (let p = 0; p < n; p += step) sample.push(target[p * 3], target[p * 3 + 1], target[p * 3 + 2]);
    const s = new Float32Array(sample);
    let starts = plan.starts.slice();
    let best = errorOf(s, { ...plan, starts });
    for (let round = 0; round < 40; round++) {
      let improved = false;
      for (let i = 1; i < starts.length; i++) {
        for (const delta of [-2, -1, 1, 2]) {
          const next = starts.slice();
          next[i] += delta;
          const lo = next[i - 1] + 1, hi = i + 1 < next.length ? next[i + 1] - 1 : plan.maxLayers;
          if (next[i] < lo || next[i] > hi) continue;
          const e = errorOf(s, { ...plan, starts: next });
          if (e < best - 1e-9) { best = e; starts = next; improved = true; }
        }
      }
      if (!improved) break;
    }
    return starts;
  }

  /* ---------------- 5. mesh ---------------- */

  /* A closed solid: one column per pixel, `grid.w` × `grid.h` pixels of
   * `grid.pitch` mm, column tops at zTop(height). Tops and bottoms are one
   * quad per pixel; the walls between neighbouring columns are split at
   * every height that meets them (no T-junctions), so the solid is closed
   * and every edge is met by as many faces from one side as the other.
   * The one place more than two faces meet is where two taller columns
   * touch only corner to corner - four faces along that line, like two
   * cubes touching along an edge, which slicers read as them touching.
   * Row 0 of the photo is its top, so it goes at the back (largest Y). */
  function buildMesh(grid, zOfCell) {
    const { w, h, pitch } = grid;
    const tris = [];
    const X = (i) => +(i * pitch).toFixed(4), Y = (j) => +((h - j) * pitch).toFixed(4);
    const Z = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : zOfCell(i, j));
    const tri = (a, b, c) => tris.push(a, b, c);
    const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };      // a b c d counter-clockwise from outside
    // Heights meeting at grid corner (i, j): the four cells around it.
    const cornerZs = (i, j) => [Z(i - 1, j - 1), Z(i, j - 1), Z(i - 1, j), Z(i, j)];

    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const z = Z(i, j);
        const p00 = [X(i), Y(j + 1)], p10 = [X(i + 1), Y(j + 1)], p11 = [X(i + 1), Y(j)], p01 = [X(i), Y(j)];
        quad([...p00, z], [...p10, z], [...p11, z], [...p01, z]);          // top, facing +Z
        quad([...p00, 0], [...p01, 0], [...p11, 0], [...p10, 0]);          // bottom, facing -Z
      }
    }
    /* A wall on the edge from corner P to corner Q, between heights lo and
     * hi, facing `out`. Each side carries every height that meets it. */
    const wall = (P, Q, cp, cq, lo, hi, flip) => {
      const inner = (zs) => [...new Set(zs.filter(z => z > lo && z < hi))].sort((a, b) => a - b);
      const left = [lo, ...inner(cp), hi], right = [lo, ...inner(cq), hi];
      // Fan the strip between the two sides: walk up both, always
      // advancing the side whose next point is lower.
      let a = 0, b = 0;
      const pa = (k) => [P[0], P[1], left[k]], pb = (k) => [Q[0], Q[1], right[k]];
      while (a < left.length - 1 || b < right.length - 1) {
        const advanceA = b >= right.length - 1 || (a < left.length - 1 && left[a + 1] <= right[b + 1]);
        const t = advanceA ? [pa(a), pb(b), pa(a + 1)] : [pa(a), pb(b), pb(b + 1)];
        if (advanceA) a++; else b++;
        if (flip) tri(t[0], t[2], t[1]); else tri(t[0], t[1], t[2]);
      }
    };
    // Vertical edges between columns i-1 and i (x = X(i)), for every row.
    for (let j = 0; j < h; j++) {
      for (let i = 0; i <= w; i++) {
        const zl = Z(i - 1, j), zr = Z(i, j);
        if (zl === zr) continue;
        const P = [X(i), Y(j + 1)], Q = [X(i), Y(j)];
        // Unflipped faces +X: right for a taller left column. Flip otherwise.
        wall(P, Q, cornerZs(i, j + 1), cornerZs(i, j), Math.min(zl, zr), Math.max(zl, zr), zr > zl);
      }
    }
    // Horizontal edges between rows j-1 and j (y = Y(j)), for every column.
    for (let j = 0; j <= h; j++) {
      for (let i = 0; i < w; i++) {
        const zb = Z(i, j - 1), zf = Z(i, j);         // back (larger Y) and front
        // Unflipped faces -Y (the front): right for a taller back column.
        if (zb === zf) continue;
        const P = [X(i), Y(j)], Q = [X(i + 1), Y(j)];
        wall(P, Q, cornerZs(i, j), cornerZs(i + 1, j), Math.min(zb, zf), Math.max(zb, zf), zf > zb);
      }
    }
    return tris;             // flat list of [x, y, z] points, three per triangle
  }

  function normal(a, b, c) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1;
    return n.map(x => x / l);
  }

  function toSTL(tris, label = 'Deja Vu1 Photo-to-Print Studio') {
    const count = tris.length / 3;
    const buf = new ArrayBuffer(84 + count * 50), view = new DataView(buf);
    const head = new TextEncoder().encode(label.slice(0, 79));
    new Uint8Array(buf, 0, head.length).set(head);
    view.setUint32(80, count, true);
    let o = 84;
    for (let t = 0; t < tris.length; t += 3) {
      for (const v of [normal(tris[t], tris[t + 1], tris[t + 2]), tris[t], tris[t + 1], tris[t + 2]]) {
        view.setFloat32(o, v[0], true); view.setFloat32(o + 4, v[1], true); view.setFloat32(o + 8, v[2], true);
        o += 12;
      }
      o += 2;
    }
    return buf;
  }

  /* The 3MF core model, with shared (indexed) vertices. */
  function modelXML(tris) {
    const index = new Map(), verts = [], faces = [];
    for (let t = 0; t < tris.length; t += 3) {
      const ids = [0, 1, 2].map(k => {
        const p = tris[t + k], key = `${p[0]},${p[1]},${p[2]}`;
        let id = index.get(key);
        if (id === undefined) { id = verts.length; index.set(key, id); verts.push(p); }
        return id;
      });
      faces.push(ids);
    }
    const f = (v) => +v.toFixed(4);
    return '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n'
      + '<metadata name="Application">Deja Vu1 Photo-to-Print Studio</metadata>\n'
      + '<resources><object id="1" type="model"><mesh><vertices>\n'
      + verts.map(p => `<vertex x="${f(p[0])}" y="${f(p[1])}" z="${f(p[2])}"/>`).join('\n')
      + '\n</vertices><triangles>\n'
      + faces.map(t => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('\n')
      + '\n</triangles></mesh></object></resources>\n<build><item objectid="1"/></build>\n</model>\n';
  }

  /* Tool changes in OrcaSlicer's layout: type 2 is CustomGCode::ToolChange,
   * extruder is 1-based, top_z is the top of the first layer in the new
   * colour. The first colour needs no change: it's what the print starts with. */
  function swapsXML(swaps) {
    return '<?xml version="1.0" encoding="utf-8"?>\n<custom_gcodes_per_layer>\n<plate>\n<plate_info id="1"/>\n'
      + swaps.map(s => `<layer top_z="${s.topZ.toFixed(3)}" type="2" extruder="${s.extruder}" color="${s.hex}" extra="" gcode="tool_change"/>`).join('\n')
      + '\n<mode value="MultiAsSingle"/>\n</plate>\n</custom_gcodes_per_layer>\n';
  }

  /* ---- a minimal ZIP writer (3MF is a ZIP): stored, or deflated when the
   * browser has CompressionStream. CRC-32 per the ZIP spec (APPNOTE 4.4.7). */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  async function deflateRaw(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { return null; }
  }
  async function zip(files) {
    const enc = new TextEncoder(), local = [], central = [];
    // Every entry is stamped 1980-01-01 00:00, the earliest valid MS-DOS
    // date (APPNOTE 4.4.6) - an all-zero date would mean month 0, day 0.
    const DOS_DATE = (1 << 5) | 1;
    let offset = 0;
    for (const [name, content] of files) {
      const data = typeof content === 'string' ? enc.encode(content) : content;
      const packed = await deflateRaw(data);
      const method = packed && packed.length < data.length ? 8 : 0;
      const body = method ? packed : data;
      const nameBytes = enc.encode(name), crc = crc32(data);
      const header = new DataView(new ArrayBuffer(30));
      header.setUint32(0, 0x04034b50, true); header.setUint16(4, 20, true); header.setUint16(8, method, true);
      header.setUint16(12, DOS_DATE, true);
      header.setUint32(14, crc, true); header.setUint32(18, body.length, true); header.setUint32(22, data.length, true);
      header.setUint16(26, nameBytes.length, true);
      local.push(new Uint8Array(header.buffer), nameBytes, body);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(10, method, true);
      cd.setUint16(14, DOS_DATE, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, body.length, true); cd.setUint32(24, data.length, true);
      cd.setUint16(28, nameBytes.length, true); cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), nameBytes);
      offset += 30 + nameBytes.length + body.length;
    }
    const cdSize = central.reduce((s, b) => s + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...local, ...central, new Uint8Array(end.buffer)], { type: 'model/3mf' });
  }

  async function to3MF(tris, swaps) {
    const files = [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/></Types>\n'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n'],
      ['3D/3dmodel.model', modelXML(tris)],
    ];
    if (swaps.length) files.push(['Metadata/custom_gcode_per_layer.xml', swapsXML(swaps)]);
    return zip(files);
  }

  /* Heights for a solved image, and the tool changes that go with them. */
  function zTop(layers, plan) { return +(plan.firstLayerH + (layers - 1) * plan.layerH).toFixed(4); }
  function swapPlan(plan) {
    return plan.starts.slice(1).map((start, i) => {
      const layerIndex = plan.baseLayers + start;              // 0-based: the first layer in the new colour
      return { colour: i + 1, extruder: i + 2, toolhead: `T${i + 1}`, hex: plan.colours[i + 1].hex.toUpperCase(),
               name: plan.colours[i + 1].name, layer: layerIndex + 1, topZ: zTop(layerIndex + 1, plan) };
    });
  }

  return { hexRGB, toLin, toSRGB, clamp01, oklab, luminance, colourAt, simulate, table, solve, errorOf,
           evenStarts, optimiseStarts, buildMesh, toSTL, modelXML, swapsXML, crc32, zip, to3MF, zTop, swapPlan };
})();

if (typeof module !== 'undefined') module.exports = StudioCore;

/* ---------------- 6. the page ---------------- */

const Studio = (() => {
  if (typeof document === 'undefined') return null;
  const C = StudioCore;
  const MAX_COLOURS = 4;            // one per U1 toolhead: tool changes, not manual swaps
  const s = {
    image: null, imageName: 'photo', palette: null, stack: [], auto: true, starts: null,
    result: null, viewer: null, busy: false, loaded: false,
  };
  const val = (id) => $(id).value;
  const num = (id) => +$(id).value;

  function settings() {
    return { widthMM: num('st-width'), detail: num('st-detail'), layerH: num('st-layer'),
             firstLayerH: num('st-first'), baseLayers: num('st-base'), maxLayers: num('st-max') };
  }

  /* ---- colours ---- */

  function chip(c, action) {
    return `<button class="st-chip" type="button" data-${action}="${esc(c.hex)}" data-name="${esc(c.name)}"
      data-td="${c.td_mm}" title="${action === 'add' ? 'Add' : 'Remove'} ${esc(c.name)}">
      <span class="st-swatch" style="background:${esc(c.hex)}"></span>${esc(c.name)}</button>`;
  }

  function renderPalette() {
    const p = s.palette;
    const host = $('st-palette');
    const owned = p.colours.length ? `<p class="st-label">Your spools</p><div class="st-chips">${p.colours.map(c => chip(c, 'add')).join('')}</div>` : '';
    host.innerHTML = `${owned}
      <p class="st-label">${p.colours.length ? 'Other colours' : 'Colours to try'}</p>
      <div class="st-chips">${p.suggestions.map(c => chip(c, 'add')).join('')}</div>
      <form class="st-custom" id="st-custom">
        <label>Your own <input type="color" id="st-custom-hex" value="#3b82f6" aria-label="Colour"></label>
        <label class="sr-only" for="st-custom-name">Colour name</label>
        <input type="text" id="st-custom-name" placeholder="e.g. Galaxy blue" maxlength="30">
        <button class="btn small" type="submit">Add</button>
      </form>
      <p class="log-empty">${esc(p.note)}</p>`;
    host.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () =>
      addColour({ hex: b.dataset.add, name: b.dataset.name, td: +b.dataset.td })));
    $('st-custom').addEventListener('submit', (e) => {
      e.preventDefault();
      const hex = val('st-custom-hex');
      addColour({ hex, name: val('st-custom-name').trim() || hex.toUpperCase(), td: estimateTD(hex) });
    });
  }

  // Same curve as photo_studio.estimate_td, so a custom colour gets the same kind of estimate.
  const estimateTD = (hex) => Math.round((0.4 + 3.6 * Math.sqrt(C.luminance(hex))) * 10) / 10;

  function addColour(c) {
    if (s.stack.length >= MAX_COLOURS) { toast(`At most ${MAX_COLOURS} colours - one per U1 toolhead`, 'warn'); return; }
    if (s.stack.some(x => x.hex.toLowerCase() === c.hex.toLowerCase())) { toast(`${c.name} is already in the stack`, 'info'); return; }
    s.stack.push({ ...c });
    sortStack();
  }

  // Darkest at the bottom: light colours only show over something darker.
  function sortStack() {
    s.stack.sort((a, b) => C.luminance(a.hex) - C.luminance(b.hex));
    s.starts = null;
    renderStack();
  }

  function renderStack() {
    const host = $('st-stack');
    host.innerHTML = s.stack.length ? s.stack.map((c, i) => `
      <li class="st-layer">
        <span class="st-swatch big" style="background:${esc(c.hex)}"></span>
        <span class="st-layer-name"><b>T${i}</b> ${esc(c.name)}<small>${i === 0 ? 'base - bottom of the stack' : i === s.stack.length - 1 ? 'top' : ''}</small></span>
        <label class="st-td">TD <input type="number" min="0.1" max="20" step="0.1" value="${c.td}" data-td-index="${i}"
          aria-label="Transmission distance of ${esc(c.name)} in mm"> mm</label>
        <button class="btn small" type="button" data-remove="${i}" aria-label="Remove ${esc(c.name)}">✕</button>
      </li>`).reverse().join('')
      : '<li class="log-empty">Add two to four colours, dark and light. They stack darkest first.</li>';
    host.querySelectorAll('[data-td-index]').forEach(inp => inp.addEventListener('change', () => {
      s.stack[+inp.dataset.tdIndex].td = Math.min(20, Math.max(0.1, +inp.value || 1));
    }));
    host.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
      s.stack.splice(+b.dataset.remove, 1); s.starts = null; renderStack();
    }));
    $('st-build').disabled = s.stack.length < 2 || !s.image;
    buildHint();
  }

  /* A disabled button says why it's disabled. */
  function buildHint() {
    const hint = !s.image ? 'Choose a photo first.'
      : s.stack.length < 2 ? 'Add at least two colours to build - pick them under "Add colours".' : '';
    $('st-build-hint').textContent = hint;
    // The same words beside the preview, which is where you're looking.
    const inPreview = $('st-preview-hint');
    if (inPreview) { inPreview.textContent = s.image ? hint : ''; inPreview.hidden = !(s.image && hint); }
  }

  /* ---- the photo ---- */

  async function loadImage(file) {
    if (!file || !/^image\//.test(file.type)) { toast('Choose an image file (JPEG, PNG, WebP…)', 'warn'); return; }
    try {
      s.image = await createImageBitmap(file);
    } catch (e) { toast(`Couldn't read that image: ${e.message || 'unsupported format'}`, 'bad'); return; }
    s.imageName = file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 60) || 'photo';
    $('st-name').value = `${s.imageName}-relief`;
    photoReady();
  }

  async function testPattern() {
    const cv = document.createElement('canvas');
    cv.width = 320; cv.height = 240;
    const g = cv.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 320, 0);
    bg.addColorStop(0, '#111'); bg.addColorStop(1, '#eee');
    g.fillStyle = bg; g.fillRect(0, 0, 320, 240);
    const r = g.createRadialGradient(160, 120, 10, 160, 120, 110);
    r.addColorStop(0, '#fff'); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, 320, 240);
    g.fillStyle = '#000'; g.font = 'bold 90px sans-serif'; g.textAlign = 'center'; g.fillText('U1', 160, 150);
    s.image = await createImageBitmap(cv);
    s.imageName = 'test-pattern';
    $('st-name').value = 'test-pattern-relief';
    photoReady();
  }

  function photoReady() {
    const cv = $('st-original');
    const ratio = s.image.height / s.image.width;
    cv.width = 360; cv.height = Math.round(360 * ratio);
    cv.getContext('2d').drawImage(s.image, 0, 0, cv.width, cv.height);
    $('st-drop').classList.add('has-photo');
    $('st-preview').classList.remove('is-empty');
    $('st-drop-text').textContent = `${s.imageName} · ${s.image.width} × ${s.image.height} px`;
    renderStack();
    if (s.stack.length >= 2) build();
  }

  /* ---- build ---- */

  function gridFor(set) {
    const w = Math.round(set.detail);
    const h = Math.max(1, Math.min(240, Math.round(w * s.image.height / s.image.width)));
    return { w, h, pitch: set.widthMM / w };
  }

  function targetLab(grid) {
    const cv = document.createElement('canvas');
    cv.width = grid.w; cv.height = grid.h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(s.image, 0, 0, grid.w, grid.h);
    const px = g.getImageData(0, 0, grid.w, grid.h).data;
    const out = new Float32Array(grid.w * grid.h * 3);
    for (let p = 0, q = 0; p < px.length; p += 4, q += 3) {
      const a = px[p + 3] / 255;          // transparent areas read as white paper
      const lab = C.oklab(...[0, 1, 2].map(k => C.toLin((px[p + k] / 255) * a + (1 - a))));
      out[q] = lab[0]; out[q + 1] = lab[1]; out[q + 2] = lab[2];
    }
    return out;
  }

  function validate(set, grid) {
    if (!s.image) return 'Choose a photo first';
    if (s.stack.length < 2) return 'Add at least two colours';
    if (!(set.widthMM >= 20 && set.widthMM <= 250)) return 'Width must be between 20 and 250 mm';
    if (grid.h * grid.pitch > 250) return `At this width the print would be ${(grid.h * grid.pitch).toFixed(0)} mm deep - make it narrower`;
    if (!(set.maxLayers >= s.stack.length + 2)) return `Allow at least ${s.stack.length + 2} colour layers`;
    return null;
  }

  async function build() {
    if (s.busy) return;
    const set = settings();
    const grid = s.image ? gridFor(set) : null;
    const problem = validate(set, grid);
    if (problem) { toast(problem, 'warn'); return; }
    s.busy = true;
    const btn = $('st-build');
    btn.disabled = true; btn.textContent = 'Building…';
    $('st-status').textContent = 'Working out each pixel\'s colour stack…';
    await new Promise(r => setTimeout(r, 30));          // let the button repaint first
    try {
      const started = performance.now();
      const target = targetLab(grid);
      const colours = s.stack.map(c => ({ ...c }));
      let plan = { ...set, colours, starts: C.evenStarts(colours.length, set.maxLayers) };
      if (s.auto || !s.starts || s.starts.length !== colours.length) plan.starts = C.optimiseStarts(target, plan);
      else plan.starts = s.starts.slice();
      s.starts = plan.starts.slice();
      const rows = C.table(plan);
      const { heights, meanDeltaE } = C.solve(target, rows);
      const zOf = (i, j) => C.zTop(plan.baseLayers + heights[j * grid.w + i], plan);
      const tris = C.buildMesh(grid, zOf);
      const stl = C.toSTL(tris);
      s.result = { plan, grid, heights, rows, tris, stl, meanDeltaE, ms: Math.round(performance.now() - started) };
      renderResult();
    } catch (err) {
      console.error(err);
      toast(`Couldn't build the model: ${err.message}`, 'bad', 7000);
      $('st-status').textContent = '';
    } finally {
      s.busy = false;
      btn.textContent = 'Build model';
      btn.disabled = s.stack.length < 2 || !s.image;
      buildHint();
    }
  }

  function renderResult() {
    const r = s.result, { plan, grid } = r;
    // "As printed": the modelled colour of every column, one pixel each.
    const cv = $('st-printed');
    cv.width = grid.w; cv.height = grid.h;
    const g = cv.getContext('2d');
    const img = g.createImageData(grid.w, grid.h);
    for (let p = 0; p < r.heights.length; p++) {
      const lin = r.rows[r.heights[p]].lin;
      for (let k = 0; k < 3; k++) img.data[p * 4 + k] = Math.round(C.clamp01(C.toSRGB(lin[k])) * 255);
      img.data[p * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);

    const tallest = Math.max(...r.heights);
    const height = C.zTop(plan.baseLayers + tallest, plan);
    const match = r.meanDeltaE < 5 ? 'close' : r.meanDeltaE < 10 ? 'fair' : 'rough';
    $('st-metrics').innerHTML = `
      <div class="stat"><span class="stat-key">Size</span><span class="stat-val">${(grid.w * grid.pitch).toFixed(0)} × ${(grid.h * grid.pitch).toFixed(0)}</span><span class="stat-foot">mm, ${height.toFixed(2)} mm tall</span></div>
      <div class="stat"><span class="stat-key">Columns</span><span class="stat-val">${grid.w} × ${grid.h}</span><span class="stat-foot">${grid.pitch.toFixed(2)} mm each</span></div>
      <div class="stat"><span class="stat-key">Triangles</span><span class="stat-val">${(r.tris.length / 3).toLocaleString()}</span><span class="stat-foot">built in ${r.ms} ms</span></div>
      <div class="stat"><span class="stat-key">Colour match</span><span class="stat-val">${match}</span><span class="stat-foot">average ΔE ${r.meanDeltaE.toFixed(1)} (OKLab ×100)</span></div>`;
    renderLadder();
    $('st-status').textContent = '';
    $('st-save-row').hidden = false;
    show3D();
  }

  /* The swap ladder: the stack as it will print, bottom colour first, with
   * the layer each colour starts on - editable when auto is off. */
  function renderLadder() {
    const r = s.result, { plan } = r;
    const total = plan.baseLayers + plan.maxLayers;
    const swaps = C.swapPlan(plan);
    const bands = plan.colours.map((c, i) => {
      const from = i === 0 ? 0 : plan.baseLayers + plan.starts[i];
      const to = i + 1 < plan.colours.length ? plan.baseLayers + plan.starts[i + 1] : total;
      return { c, i, from, to };
    }).reverse();
    $('st-ladder').innerHTML = `
      <div class="st-ladder-col" aria-hidden="true">${bands.map(b =>
        `<span style="flex:${Math.max(1, b.to - b.from)};background:${esc(b.c.hex)}"></span>`).join('')}</div>
      <ol class="st-ladder-steps">${bands.map(b => `
        <li>
          <span class="st-swatch" style="background:${esc(b.c.hex)}"></span>
          <span><b>T${b.i} · ${esc(b.c.name)}</b>
            <small>${b.i === 0 ? `layers 1–${b.to} (the base and the darkest tones)`
              : `from layer ${b.from + 1} · ${C.zTop(b.from + 1, plan).toFixed(2)} mm`}</small></span>
          ${b.i === 0 ? '' : `<label class="st-start">start at colour layer
            <input type="number" min="1" max="${plan.maxLayers}" value="${plan.starts[b.i]}" data-start="${b.i}" ${s.auto ? 'disabled' : ''}
              aria-label="Colour layer where ${esc(b.c.name)} starts"></label>`}
        </li>`).join('')}</ol>`;
    $('st-ladder').querySelectorAll('[data-start]').forEach(inp => inp.addEventListener('change', () => {
      const i = +inp.dataset.start, next = s.starts.slice();
      next[i] = Math.round(+inp.value);
      const ok = next.every((v, k) => k === 0 || (v > next[k - 1] && v <= plan.maxLayers));
      if (!ok) { toast('Each colour has to start above the one below it', 'warn'); inp.value = s.starts[i]; return; }
      s.starts = next;
      build();
    }));
    $('st-plan-text').textContent = `Slice with a ${plan.firstLayerH.toFixed(2)} mm first layer and ${plan.layerH.toFixed(2)} mm layers, `
      + `or the colour changes land on the wrong layers. Load ${plan.colours.map((c, i) => `${c.name} in T${i}`).join(', ')}.`
      + (swaps.length ? ` Tool changes: ${swaps.map(w => `${w.toolhead} at layer ${w.layer} (${w.topZ.toFixed(2)} mm)`).join(', ')}.` : '');
  }

  function show3D() {
    const r = s.result;
    if (!s.viewer) {
      try { s.viewer = new DV3D.Viewer($('st-canvas')); }
      catch (e) { $('st-view-note').textContent = `3D view unavailable in this browser: ${e.message}`; return; }
    }
    const mesh = DV3D.parseSTL(r.stl);
    const bands = r.plan.colours.map((c, i) => ({
      hex: c.hex,
      // Bottom of the colour's first layer, nudged up so a column that ends
      // exactly there keeps the colour below on its top face.
      z: i === 0 ? -1 : C.zTop(r.plan.baseLayers + r.plan.starts[i], r.plan) + 0.001,
    }));
    s.viewer.setMesh(mesh, r.plan.colours[0].hex, bands);
  }

  /* ---- save ---- */

  /* Straight to this device, for when there's no file library to save to. */
  function download(body, name) {
    const url = URL.createObjectURL(new Blob([body], { type: name.endsWith('.stl') ? 'model/stl' : 'model/3mf' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function save(kind, btn) {
    const r = s.result;
    if (!r) return;
    const base = val('st-name').trim().replace(/[^A-Za-z0-9 ._()+-]/g, '_').replace(/\.(stl|3mf)$/i, '') || 'photo-relief';
    const name = `${base}.${kind}`;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = serverMissing() ? 'Preparing…' : 'Saving…';
    let body = null;
    try {
      body = kind === 'stl' ? r.stl : await C.to3MF(r.tris, C.swapPlan(r.plan));
      if (serverMissing()) {
        download(body, name);
        $('st-saved').textContent = `Downloaded ${name} to this device. To keep it in a file library and print it, run the Deja Vu1 server.`;
        return;
      }
      const note = `${(r.grid.w * r.grid.pitch).toFixed(0)}×${(r.grid.h * r.grid.pitch).toFixed(0)} mm, `
        + `${r.plan.colours.map((c, i) => `T${i} ${c.name}`).join(' → ')}; slice at ${r.plan.layerH} mm layers, `
        + `${r.plan.firstLayerH} mm first layer`;
      let res;
      try { res = await fetch(`/api/studio/save?name=${encodeURIComponent(name)}&note=${encodeURIComponent(note)}`, { method: 'POST', body }); }
      catch (_) { throw new Error("couldn't reach the dashboard server"); }
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `the dashboard answered ${res.status}`);
      toast(`Saved ${out.file.name} to your file library${out.swaps && out.swaps.length ? ` with ${out.swaps.length} tool change(s)` : ''}`, 'ok', 6000);
      $('st-saved').innerHTML = `Saved <button class="chip-btn" type="button" id="st-open-saved">${esc(out.file.name)}</button> - open it in Files to view, convert or slice it.`;
      $('st-open-saved').addEventListener('click', () => { showTab('files'); if (window.Workshop) Workshop.openFile(out.file.name); });
    } catch (err) {
      toast(`Not saved: ${err.message}`, 'bad', 7000);
      // The model is still here: offer it to this device instead.
      if (body) {
        $('st-saved').innerHTML = `Not saved to the file library (${esc(err.message)}). <button class="chip-btn" type="button" id="st-download">Download ${esc(name)} instead</button>`;
        $('st-download').addEventListener('click', () => download(body, name));
      }
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  }

  /* ---- wiring ---- */

  /* The colours to try when the dashboard server can't be reached: the same
   * six the server suggests (mock_moonraker.FILAMENT_COLORS, TD estimated by
   * photo_studio.estimate_td). Suggestions only - nothing claims you own them. */
  const BUILT_IN = [
    { name: 'Black', hex: '#1C1C1E' }, { name: 'White', hex: '#F2F2F0' },
    { name: 'Snapmaker Orange', hex: '#F26A1B' }, { name: 'Signal Red', hex: '#C8102E' },
    { name: 'Sky Blue', hex: '#3B82F6' }, { name: 'Grass Green', hex: '#2F9E44' },
  ];
  function builtInPalette(why) {
    return { source: 'built-in', colours: [],
             suggestions: BUILT_IN.map(c => ({ ...c, td_mm: estimateTD(c.hex), td_source: 'estimate' })),
             note: `${why} Pick colours yourself; nothing here claims you own them.` };
  }

  async function load() {
    let data = await getJSON('/api/studio/palette').catch(() => null);
    const body = $('st-body'), off = $('st-off');
    if (isModuleDisabled(data)) { body.hidden = true; off.hidden = false; off.innerHTML = moduleDisabledEmpty('Photo-to-Print Studio'); return; }
    body.hidden = false; off.hidden = true;
    // No server, or an answer without colours: the studio itself runs here,
    // so it carries on with its own suggestions rather than an empty palette.
    if (!data || !Array.isArray(data.suggestions) || !Array.isArray(data.colours)) {
      data = builtInPalette(data && data.server_missing
        ? 'Your filament inventory is on the Deja Vu1 server, which isn\'t running at this address.'
        : 'Couldn\'t read your filament inventory from the dashboard server.');
    }
    if (serverMissing()) {
      $('st-save-3mf').textContent = 'Download 3MF with tool changes';
      $('st-save-stl').textContent = 'Download STL';
    }
    s.palette = data;
    renderPalette();
    if (!s.loaded) {
      s.loaded = true;
      // Start with the darkest and lightest you own (or of the suggestions).
      const pool = data.colours.length >= 2 ? data.colours : data.suggestions;
      const sorted = pool.slice().sort((a, b) => C.luminance(a.hex) - C.luminance(b.hex));
      [sorted[0], sorted[sorted.length - 1]].forEach(c => addColour({ hex: c.hex, name: c.name, td: c.td_mm }));
    }
    renderStack();
  }

  function init() {
    if (!$('tab-studio')) return;
    const input = $('st-file');
    input.addEventListener('change', () => { if (input.files[0]) loadImage(input.files[0]); input.value = ''; });
    const drop = $('st-drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); loadImage(e.dataTransfer.files[0]); });
    $('st-test').addEventListener('click', testPattern);
    $('st-build').addEventListener('click', build);
    $('st-auto').addEventListener('change', (e) => { s.auto = e.target.checked; if (s.result) renderLadder(); if (s.auto && s.result) build(); });
    $('st-save-3mf').addEventListener('click', (e) => save('3mf', e.currentTarget));
    $('st-save-stl').addEventListener('click', (e) => save('stl', e.currentTarget));
    window.addEventListener('dv-tab', (e) => { if (e.detail === 'studio') load(); });
    window.addEventListener('dv-refresh', () => { if (!$('tab-studio').hidden) load(); });
    if (!$('tab-studio').hidden) load();
  }

  init();
  return { build, state: s };
})();
