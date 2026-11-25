/* Cutting a model with a plane, and the bytes of a model whose shape was edited. No graphics and no network, so Node can test it alone
 * (tests/slicer_cut_check.js, run by tests/test_slicer_cut.py).
 *
 * cut() takes the triangles of a model where it stands (millimetres, three corners of three numbers each) and a plane, and returns the part
 * above the plane and the part below it. Each part gets a flat face where the plane went through the model, closed with triangles, so the
 * part is a solid the slicing engine can read. The plane is moved by up to 5 microns when it would pass through a corner of the model, so every
 * triangle is clearly on one side or crosses it and no sliver of zero thickness is made.
 *
 * Plane: { n: [x, y, z] (a unit vector, pointing to the "upper" side), d } holds the points p where  n . p = d.
 * The corners and the cap are written in the same triangle order the model uses (counter-clockwise seen from outside, like STL). */
'use strict';
(function (root) {
  const KEY = 1e5;                         // matching of cut points: a hundredth of a micron
  const SHIFTS = [0, 0.002, -0.002, 0.005, -0.005];
  const CLEAR = 1e-4;                      // a corner closer than this to the plane counts as on it
  const key = p => Math.round(p[0] * KEY) + ',' + Math.round(p[1] * KEY) + ',' + Math.round(p[2] * KEY);
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

  /* ---- the plane ------------------------------------------------------------------------------------------------------------- */
  function turn(v, axis, degrees) {
    const r = degrees * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), [x, y, z] = v;
    if (axis === 0) return [x, c * y - s * z, s * y + c * z];
    if (axis === 1) return [c * x + s * z, y, -s * x + c * z];
    return [c * x - s * y, s * x + c * y, z];
  }
  /* the plane's normal: 'z' is a flat cut, 'x' and 'y' stand upright; a and b tilt it (degrees) about the two world axes that lie in the plane */
  function normalFor(kind, a = 0, b = 0) {
    let n;
    if (kind === 'x') n = turn(turn([1, 0, 0], 1, a), 2, b);
    else if (kind === 'y') n = turn(turn([0, 1, 0], 2, a), 0, b);
    else n = turn(turn([0, 0, 1], 0, a), 1, b);
    return unit(n);
  }
  /* the lowest and highest value of n . p over the triangles: how far the model reaches along the normal */
  function reach(positions, n) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const s = n[0] * positions[i] + n[1] * positions[i + 1] + n[2] * positions[i + 2];
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    return { lo, hi };
  }

  /* ---- numbers about a triangle soup ----------------------------------------------------------------------------------------------- */
  function volume(p) {
    let v = 0;
    for (let i = 0; i < p.length; i += 9) {
      v += p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6]);
    }
    return v / 6;
  }
  function makeMesh(positions, colours) {
    const pos = positions instanceof Float32Array ? positions : Float32Array.from(positions);
    const n = new Float32Array(pos.length), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 9) {
      const ux = pos[i + 3] - pos[i], uy = pos[i + 4] - pos[i + 1], uz = pos[i + 5] - pos[i + 2];
      const vx = pos[i + 6] - pos[i], vy = pos[i + 7] - pos[i + 1], vz = pos[i + 8] - pos[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 3; k++) { n[i + k * 3] = nx; n[i + k * 3 + 1] = ny; n[i + k * 3 + 2] = nz; }
    }
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { if (pos[i + k] < lo[k]) lo[k] = pos[i + k]; if (pos[i + k] > hi[k]) hi[k] = pos[i + k]; }
    return { positions: pos, normals: n, colours: colours ? (colours instanceof Float32Array ? colours : Float32Array.from(colours)) : null, triangles: pos.length / 9,
      bounds: { min: lo, max: hi }, size: hi.map((v, i) => +(v - lo[i]).toFixed(2)), warnings: [] };
  }

  /* ---- the cut ------------------------------------------------------------------------------------------------------------------ */
  function cut(positions, colours, plane) {
    const n = unit(plane.n), count = positions.length / 3, dist = new Float64Array(count);
    let d = plane.d, shifted = 0;
    for (const shift of SHIFTS) {
      let nearest = Infinity;
      for (let i = 0; i < count; i++) {
        const s = n[0] * positions[3 * i] + n[1] * positions[3 * i + 1] + n[2] * positions[3 * i + 2] - (plane.d + shift);
        dist[i] = s;
        if (Math.abs(s) < nearest) nearest = Math.abs(s);
      }
      shifted = shift; d = plane.d + shift;
      if (nearest > CLEAR) break;
    }
    const vert = i => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
    const tint = i => colours ? [colours[3 * i], colours[3 * i + 1], colours[3 * i + 2]] : null;
    const up = [], lo = [], upC = colours ? [] : null, loC = colours ? [] : null, segs = [];
    const push = (to, toC, pts, cols) => {
      for (let k = 0; k < 3; k++) { to.push(pts[k][0], pts[k][1], pts[k][2]); if (toC) toC.push(cols[k][0], cols[k][1], cols[k][2]); }
    };
    /* where an edge crosses the plane: worked out from the end that sorts first, so the two triangles that share the edge get the same point to the last digit */
    const crossing = (a, b) => {
      const pa = vert(a), pb = vert(b);
      const swap = pa[0] !== pb[0] ? pa[0] > pb[0] : pa[1] !== pb[1] ? pa[1] > pb[1] : pa[2] > pb[2];
      const [i, j, p, q] = swap ? [b, a, pb, pa] : [a, b, pa, pb];
      const t = dist[i] / (dist[i] - dist[j]);
      const point = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), p[2] + t * (q[2] - p[2])];
      let c = null;
      if (colours) { const ci = tint(i), cj = tint(j); c = [ci[0] + t * (cj[0] - ci[0]), ci[1] + t * (cj[1] - ci[1]), ci[2] + t * (cj[2] - ci[2])]; }
      return { point, c };
    };
    for (let t = 0; t < count; t += 3) {
      const above = [dist[t] > 0, dist[t + 1] > 0, dist[t + 2] > 0];
      if (above[0] === above[1] && above[1] === above[2]) {
        push(above[0] ? up : lo, above[0] ? upC : loC, [vert(t), vert(t + 1), vert(t + 2)], colours ? [tint(t), tint(t + 1), tint(t + 2)] : null);
        continue;
      }
      const a = above[0] === above[1] ? 2 : above[0] === above[2] ? 1 : 0, b = (a + 1) % 3, c = (a + 2) % 3;
      const pab = crossing(t + a, t + b), pca = crossing(t + c, t + a);
      const va = vert(t + a), vb = vert(t + b), vc = vert(t + c), ta = tint(t + a), tb = tint(t + b), tc = tint(t + c);
      const loneSide = above[a] ? [up, upC] : [lo, loC], otherSide = above[a] ? [lo, loC] : [up, upC];
      push(loneSide[0], loneSide[1], [va, pab.point, pca.point], colours ? [ta, pab.c, pca.c] : null);
      push(otherSide[0], otherSide[1], [pab.point, vb, vc], colours ? [pab.c, tb, tc] : null);
      push(otherSide[0], otherSide[1], [pab.point, vc, pca.point], colours ? [pab.c, tc, pca.c] : null);
      // the cut edge, entering to leaving as the triangle's corners are walked round: loops of these face the way the upper part's flat face must
      const from = above[a] ? pca : pab, to = above[a] ? pab : pca;
      const fk = key(from.point), tk = key(to.point);
      if (fk !== tk) segs.push({ a: from.point, b: to.point, ac: from.c, ak: fk, bk: tk });
    }
    const made = capFace(segs, n, !!colours);
    const issues = { openLoops: made.open, earFallbacks: made.fallbacks };
    // The flat face's triangles are counter-clockwise seen from +n, which is outward for the lower part; the upper part gets them reversed.
    for (let i = 0; i < made.tris.length; i++) {
      const [A, B, C, ca, cb, cc] = made.tris[i];
      push(up, upC, [A, C, B], colours ? [ca, cc, cb] : null);
      push(lo, loC, [A, B, C], colours ? [ca, cb, cc] : null);
    }
    const upper = Float32Array.from(up), lower = Float32Array.from(lo);
    // the line where the plane goes through the model, as pairs of points (the Slicer draws it on the model while the plane is being placed)
    const outline = new Float32Array(segs.length * 6);
    segs.forEach((s, i) => outline.set([s.a[0], s.a[1], s.a[2], s.b[0], s.b[1], s.b[2]], i * 6));
    return { upper, lower, outline, upperColours: upC ? Float32Array.from(upC) : null, lowerColours: loC ? Float32Array.from(loC) : null,
      upperVolume: volume(upper), lowerVolume: Math.abs(volume(lower)), capArea: made.area, capTriangles: made.tris.length, shifted, issues, normal: n, d };
  }

  /* ---- the flat face: chain the cut edges into loops, find which loops are holes, triangulate each outline with its holes ---------------- */
  function capFace(segs, n, hasColour) {
    const byStart = new Map();
    segs.forEach((s, i) => { (byStart.get(s.ak) || byStart.set(s.ak, []).get(s.ak)).push(i); });
    const used = new Uint8Array(segs.length), loops = [];
    let open = 0;
    for (let first = 0; first < segs.length; first++) {
      if (used[first]) continue;
      const loop = [], startKey = segs[first].ak;
      let at = first, closed = false;
      for (;;) {
        used[at] = 1; loop.push(at);
        if (segs[at].bk === startKey) { closed = true; break; }
        let next = -1;
        for (const c of byStart.get(segs[at].bk) || []) if (!used[c]) { next = c; break; }
        if (next < 0) break;
        at = next;
      }
      if (closed && loop.length >= 3) loops.push(loop); else open++;
    }
    if (!loops.length) return { tris: [], area: 0, open, fallbacks: 0 };
    // a flat frame on the plane (u, v, n is right-handed)
    const pick = Math.abs(n[0]) < 0.6 ? [1, 0, 0] : [0, 1, 0], u = unit(cross3(n, pick)), v = cross3(n, u);
    const rings = loops.map(loop => loop.map(i => {
      const p = segs[i].a;
      return { x: u[0] * p[0] + u[1] * p[1] + u[2] * p[2], y: v[0] * p[0] + v[1] * p[1] + v[2] * p[2], p, c: segs[i].ac };
    }));
    const areas = rings.map(signedArea), outer = [];
    // how deep each loop sits inside the others: even is an outline, odd is a hole in the outline one level up
    const inside = (a, b) => within(rings[a][0], rings[b]);
    const depth = rings.map((_, i) => rings.reduce((k, _r, j) => k + (j !== i && Math.abs(areas[j]) > Math.abs(areas[i]) && inside(i, j) ? 1 : 0), 0));
    const parent = rings.map((_, i) => {
      if (depth[i] % 2 === 0) return -1;
      let best = -1;
      rings.forEach((_r, j) => { if (j !== i && depth[j] === depth[i] - 1 && Math.abs(areas[j]) > Math.abs(areas[i]) && inside(i, j) && (best < 0 || Math.abs(areas[j]) < Math.abs(areas[best]))) best = j; });
      return best;
    });
    rings.forEach((_, i) => { if (depth[i] % 2 === 0) outer.push(i); });
    const tris = [];
    let area = 0, fallbacks = 0;
    for (const o of outer) {
      const holes = rings.map((_, i) => i).filter(i => parent[i] === o);
      const ring = ccw(rings[o], true), cutouts = holes.map(h => ccw(rings[h], false));
      area += Math.abs(areas[o]) - holes.reduce((s, h) => s + Math.abs(areas[h]), 0);
      const flat = joinHoles(ring, cutouts);
      const out = earClip(flat);
      fallbacks += out.fallbacks;
      for (const [i, j, k] of out.tris) tris.push([flat[i].p, flat[j].p, flat[k].p, flat[i].c, flat[j].c, flat[k].c]);
    }
    return { tris, area, open, fallbacks };
  }
  function signedArea(r) {
    let s = 0;
    for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a.x * b.y - b.x * a.y; }
    return s / 2;
  }
  /* an outline runs counter-clockwise (positive area), a hole clockwise, as the triangulation expects */
  function ccw(r, wantPositive) { return (signedArea(r) > 0) === wantPositive ? r.slice() : r.slice().reverse(); }
  function within(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const same = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

  /* Each hole is joined to the outline by a double edge to the nearest corner it can see: the result is one ring with no holes (some corners twice). */
  function joinHoles(outline, holes) {
    let ring = outline.slice();
    const order = holes.map(h => ({ h, right: Math.max(...h.map(p => p.x)) })).sort((a, b) => b.right - a.right);
    const pending = holes.slice();
    for (const { h } of order) {
      let mi = 0;
      h.forEach((p, i) => { if (p.x > h[mi].x) mi = i; });
      const m = h[mi];
      const edges = [];
      const addEdges = r => { for (let i = 0; i < r.length; i++) edges.push([r[i], r[(i + 1) % r.length]]); };
      addEdges(ring);
      for (const other of pending) if (other !== h) addEdges(other);
      addEdges(h);
      const candidates = ring.map((p, i) => ({ i, dd: (p.x - m.x) ** 2 + (p.y - m.y) ** 2 })).sort((a, b) => a.dd - b.dd);
      let pick = -1;
      for (const { i } of candidates) {
        const p = ring[i];
        const mid = { x: (p.x + m.x) / 2, y: (p.y + m.y) / 2 };
        if (!within(mid, ring) || within(mid, h)) continue;
        let blocked = false;
        for (const [e0, e1] of edges) {
          if (same(e0, m) || same(e1, m) || same(e0, p) || same(e1, p)) continue;
          const o1 = orient(m, p, e0), o2 = orient(m, p, e1), o3 = orient(e0, e1, m), o4 = orient(e0, e1, p);
          if (o1 * o2 < 0 && o3 * o4 < 0) { blocked = true; break; }
        }
        if (!blocked) { pick = i; break; }
      }
      if (pick < 0) pick = candidates[0].i;       // nothing is visible (a damaged outline): join to the nearest anyway rather than lose the hole
      ring = ring.slice(0, pick + 1).concat(h.slice(mi), h.slice(0, mi), [h[mi], ring[pick]], ring.slice(pick + 1));
      pending.splice(pending.indexOf(h), 1);
    }
    return ring;
  }

  /* Ear clipping on one counter-clockwise ring. Only corners that bend inward can sit inside an ear, so only those are tested. */
  function earClip(P) {
    const m = P.length, tris = [];
    if (m < 3) return { tris, fallbacks: 0 };
    const prev = Array.from({ length: m }, (_, i) => (i + m - 1) % m), next = Array.from({ length: m }, (_, i) => (i + 1) % m);
    const turnAt = i => orient(P[prev[i]], P[i], P[next[i]]);
    let scale = 0;
    for (const p of P) scale = Math.max(scale, Math.abs(p.x), Math.abs(p.y));
    const tiny = 1e-12 * Math.max(1, scale * scale);
    const reflex = new Set();
    for (let i = 0; i < m; i++) if (turnAt(i) <= tiny) reflex.add(i);
    const blocks = (a, b, c) => {
      for (const r of reflex) {
        if (r === a || r === b || r === c) continue;
        const p = P[r];
        if (same(p, P[a]) || same(p, P[b]) || same(p, P[c])) continue;
        if (orient(P[a], P[b], p) >= 0 && orient(P[b], P[c], p) >= 0 && orient(P[c], P[a], p) >= 0) return true;
      }
      return false;
    };
    let left = m, at = 0, fallbacks = 0;
    const remove = v => {
      const p = prev[v], q = next[v];
      next[p] = q; prev[q] = p; left--; reflex.delete(v);
      for (const w of [p, q]) { if (turnAt(w) <= tiny) reflex.add(w); else reflex.delete(w); }
    };
    while (left > 3) {
      let found = -1, v = at;
      for (let step = 0; step < left; step++, v = next[v]) {
        if (turnAt(v) > tiny && !blocks(prev[v], v, next[v])) { found = v; break; }
      }
      if (found < 0) {                               // no clean ear: take the sharpest convex corner, or drop a flat one, so the loop always ends
        fallbacks++;
        let best = -1, bestTurn = -Infinity;
        v = at;
        for (let step = 0; step < left; step++, v = next[v]) { const t = turnAt(v); if (t > bestTurn) { bestTurn = t; best = v; } }
        found = best;
      }
      // A flat corner (three points in a line) still gets its triangle of no area: leaving it out would open a gap between its neighbours' edges.
      const a = prev[found], c = next[found];
      tris.push([a, found, c]);
      at = c;
      remove(found);
    }
    const a = at, b = next[a], c = next[b];
    tris.push([a, b, c]);
    return { tris, fallbacks };
  }

  /* ---- a model whose shape was edited has to reach the engine as a file ------------------------------------------------------- */
  /* binary STL: an 80-byte header, the count, then each triangle as its normal, three corners and two spare bytes (millimetres) */
  function stlBytes(positions) {
    const count = positions.length / 9, buffer = new ArrayBuffer(84 + count * 50), view = new DataView(buffer);
    const head = 'DejaVu1-edited-model-mm';          // the 80-byte header of an STL is a comment; no spaces, so it is not taken for a sentence on screen
    for (let i = 0; i < head.length; i++) view.setUint8(i, head.charCodeAt(i));
    view.setUint32(80, count, true);
    for (let t = 0; t < count; t++) {
      const o = 84 + t * 50, p = positions.subarray(t * 9, t * 9 + 9);
      const ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2], vx = p[6] - p[0], vy = p[7] - p[1], vz = p[8] - p[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      view.setFloat32(o, nx / l, true); view.setFloat32(o + 4, ny / l, true); view.setFloat32(o + 8, nz / l, true);
      for (let k = 0; k < 9; k++) view.setFloat32(o + 12 + k * 4, p[k], true);
    }
    return new Uint8Array(buffer);
  }
  /* a short name for the bytes: two 32-bit hashes, so the same edit uploaded twice is one file */
  function fingerprint(bytes) {
    let h1 = 0x811c9dc5, h2 = 0x01000193 ^ bytes.length;
    for (let i = 0; i < bytes.length; i++) {
      h1 = Math.imul(h1 ^ bytes[i], 16777619) >>> 0;
      h2 = Math.imul(h2 + bytes[i] + i, 2246822519) >>> 0;
      h2 ^= h2 >>> 15;
    }
    return (h1.toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
  }

  root.SlicerCut = { cut, normalFor, reach, volume, makeMesh, stlBytes, fingerprint, capFace };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SlicerCut;
})(typeof window !== 'undefined' ? window : globalThis);
