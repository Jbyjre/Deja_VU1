/* The plate model behind the Slicer: the objects on a plate, where each stands, how it is turned and scaled, which head prints it, and
 * every check that says what is wrong with the plate before it is sliced. No graphics and no network here, so it can be tested alone
 * (tests/test_slicer_model.py runs it in Node).
 *
 * An object's transform is 12 numbers, as the server's plate_project.py keeps it: three rows (the turn and size) and a
 * move, applied as  point' = point x rows + move. Moves and turns are made about the middle of the object's box.
 *
 * What it does not do: slicing, and the engine's own arranging and orienting (the server asks the engine for those). The packing
 * here is the quick arrangement used until the engine is installed or when it cannot answer, and it says so. */
'use strict';
(function (root) {
  const DEFAULT_AREA = { x0: 0.5, y0: 1, x1: 270.5, y1: 271, z1: 270.05 };
  const area = () => (root.U1Plate && root.U1Plate.AREA) || DEFAULT_AREA;
  const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  const MAX_PER_PLATE = 32;            // the server's limit for one plate (plate_project.py)
  const MAX_PLATES = 8;
  const MAX_UNDO = 60;

  /* ---- maths on the 12 numbers ------------------------------------------------------------------------------------------------- */
  function compose(a, b) {
    const out = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) out.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c] + (r === 3 ? b[9 + c] : 0));
    return out;
  }
  const point = (m, p) => [0, 1, 2].map(c => p[0] * m[c] + p[1] * m[3 + c] + p[2] * m[6 + c] + m[9 + c]);
  function rotation(axis, degrees) {
    const m = IDENTITY.slice(), a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    if (axis === 0) { m[4] = c; m[5] = s; m[7] = -s; m[8] = c; }
    if (axis === 1) { m[0] = c; m[2] = -s; m[6] = s; m[8] = c; }
    if (axis === 2) { m[0] = c; m[1] = s; m[3] = -s; m[4] = c; }
    return m;
  }
  /* turn `from` onto `to` (unit vectors) by the shortest way: the matrix rows */
  function between(from, to) {
    const d = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
    let ax = [from[1] * to[2] - from[2] * to[1], from[2] * to[0] - from[0] * to[2], from[0] * to[1] - from[1] * to[0]];
    const len = Math.hypot(...ax);
    if (len < 1e-9) {
      if (d > 0) return IDENTITY.slice();
      const perp = Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      ax = [from[1] * perp[2] - from[2] * perp[1], from[2] * perp[0] - from[0] * perp[2], from[0] * perp[1] - from[1] * perp[0]];
      const l = Math.hypot(...ax); ax = ax.map(v => v / l);
      return axisAngle(ax, Math.PI);
    }
    return axisAngle(ax.map(v => v / len), Math.acos(Math.max(-1, Math.min(1, d))));
  }
  function axisAngle([x, y, z], a) {
    const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    return [t * x * x + c, t * x * y + s * z, t * x * z - s * y, t * x * y - s * z, t * y * y + c, t * y * z + s * x, t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0];
  }

  /* the box round an object where it stands: exact, from its vertices (cached for the transform it was worked out for) */
  function boundsOf(o) {
    const key = o.transform.join(',');
    if (o._b && o._b.key === key) return o._b.value;
    const p = o.mesh.positions, m = o.transform, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
      const v = p[i] * m[k] + p[i + 1] * m[3 + k] + p[i + 2] * m[6 + k] + m[9 + k];
      if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v;
    }
    const value = { min: lo, max: hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], centre: lo.map((v, i) => (v + hi[i]) / 2) };
    o._b = { key, value };
    return value;
  }

  /* how much of the surface faces down more than 45 degrees, where the object stands, and the lowest such face above the plate:
     the signal that supports may be needed. Weighted by area, from the triangles. */
  function overhangShare(o) {
    const key = o.transform.join(',');
    if (o._o && o._o.key === key) return o._o.value;
    const p = o.mesh.positions, m = o.transform, b = boundsOf(o);
    let total = 0, down = 0;
    for (let i = 0; i < p.length; i += 9) {
      const a = point(m, [p[i], p[i + 1], p[i + 2]]), bb = point(m, [p[i + 3], p[i + 4], p[i + 5]]), c = point(m, [p[i + 6], p[i + 7], p[i + 8]]);
      const u = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], area2 = Math.hypot(...n);
      if (area2 < 1e-12) continue;
      total += area2;
      const highest = Math.max(a[2], bb[2], c[2]);
      if (n[2] / area2 < -0.7071 && highest > b.min[2] + 0.4) down += area2;     // a face lying on the plate is not an overhang
    }
    const value = total ? down / total : 0;
    o._o = { key, value };
    return value;
  }

  /* How good is standing the object this way? The share of its surface that hangs out (steeper than 45 degrees, off the plate), the share
     that lies flat on the plate, and how tall it is. Computed for a transform without changing the object. */
  function orientationScore(o, transform) {
    const p = o.mesh.positions, m = transform;
    let lo = Infinity;
    const W = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) {
      W[i] = p[i] * m[0] + p[i + 1] * m[3] + p[i + 2] * m[6] + m[9]; W[i + 1] = p[i] * m[1] + p[i + 1] * m[4] + p[i + 2] * m[7] + m[10]; W[i + 2] = p[i] * m[2] + p[i + 1] * m[5] + p[i + 2] * m[8] + m[11];
      if (W[i + 2] < lo) lo = W[i + 2];
    }
    let hi = -Infinity, total = 0, down = 0, flat = 0;
    for (let i = 2; i < W.length; i += 3) if (W[i] > hi) hi = W[i];
    for (let i = 0; i < W.length; i += 9) {
      const ux = W[i + 3] - W[i], uy = W[i + 4] - W[i + 1], uz = W[i + 5] - W[i + 2], vx = W[i + 6] - W[i], vy = W[i + 7] - W[i + 1], vz = W[i + 8] - W[i + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, a = Math.hypot(nx, ny, nz);
      if (a < 1e-12) continue;
      total += a;
      if (nz / a < -0.7071) { if (Math.max(W[i + 2], W[i + 5], W[i + 8]) > lo + 0.4) down += a; else flat += a; }
    }
    return { overhang: total ? down / total : 0, contact: total ? flat / total : 0, height: hi - lo };
  }
  /* ---- packing: the quick arrangement (MaxRects, best short side) ------------------------------------------------------------------ */
  function pack(items, width, depth, gap, blocked) {
    let free = [{ x: 0, y: 0, w: width, h: depth }];
    const cut = (rects, b) => {
      const out = [];
      for (const r of rects) {
        if (b.x >= r.x + r.w || b.x + b.w <= r.x || b.y >= r.y + r.h || b.y + b.h <= r.y) { out.push(r); continue; }
        if (b.x > r.x) out.push({ x: r.x, y: r.y, w: b.x - r.x, h: r.h });
        if (b.x + b.w < r.x + r.w) out.push({ x: b.x + b.w, y: r.y, w: r.x + r.w - b.x - b.w, h: r.h });
        if (b.y > r.y) out.push({ x: r.x, y: r.y, w: r.w, h: b.y - r.y });
        if (b.y + b.h < r.y + r.h) out.push({ x: r.x, y: b.y + b.h, w: r.w, h: r.y + r.h - b.y - b.h });
      }
      return out.filter((r, i) => !out.some((q, j) => i !== j && q.x <= r.x && q.y <= r.y && q.x + q.w >= r.x + r.w && q.y + q.h >= r.y + r.h && (q.w * q.h > r.w * r.h || j < i)));
    };
    for (const b of blocked || []) free = cut(free, b);
    const placed = [], failed = [];
    const order = items.slice().sort((a, b) => Math.max(b.w, b.d) - Math.max(a.w, a.d) || b.w * b.d - a.w * a.d);
    for (const it of order) {
      let best = null;
      for (const turn of [false, true]) {
        const w = (turn ? it.d : it.w) + gap, h = (turn ? it.w : it.d) + gap;
        for (const r of free) {
          if (w > r.w + 1e-9 || h > r.h + 1e-9) continue;
          const score = [Math.min(r.w - w, r.h - h), Math.max(r.w - w, r.h - h)];
          if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) best = { x: r.x, y: r.y, w, h, turn, score };
        }
      }
      if (!best) { failed.push(it.id); continue; }
      placed.push({ id: it.id, x: best.x, y: best.y, w: best.w - gap, h: best.h - gap, turn: best.turn });
      for (let i = 0; i < 1; i++) free = cut(free, { x: best.x, y: best.y, w: best.w, h: best.h });
    }
    return { placed, failed };
  }

  /* The flat faces of an object, as the directions they face (in the world, where it stands now), largest first. */
  function flatFaces(o, limit = 12) {
    const p = o.mesh.positions, m = o.transform, planes = new Map();
    for (let i = 0; i < p.length; i += 9) {
      const a = point(m, [p[i], p[i + 1], p[i + 2]]), b = point(m, [p[i + 3], p[i + 4], p[i + 5]]), c = point(m, [p[i + 6], p[i + 7], p[i + 8]]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n);
      if (l < 1e-9) continue;
      const unit = n.map(x => x / l), d = unit[0] * a[0] + unit[1] * a[1] + unit[2] * a[2];
      const key = unit.map(x => Math.round(x * 5000)).join(',') + ',' + Math.round(d * 100), cur = planes.get(key) || { unit, area: 0 };
      cur.area += l; planes.set(key, cur);
    }
    return [...planes.values()].sort((x, y) => y.area - x.area).slice(0, limit);
  }
  /* ---- the plate ---------------------------------------------------------------------------------------------------------------- */
  class PlateModel {
    constructor(opts = {}) {
      this.objects = [];
      this.selected = new Set();
      this.plates = 1;
      this.current = 0;
      this.nextId = 1;
      this.undoStack = [];
      this.redoStack = [];
      this.tower = null;            // { x, y, w, d } where the prime tower stands (in mm), when two or more heads are used
      this.onChange = opts.onChange || (() => {});
      this.version = 0;
    }

    changed(kind, ids) { this.version++; this.onChange(kind, ids || []); }

    get(id) { return this.objects.find(o => o.id === id) || null; }
    onPlate(n = this.current) { return this.objects.filter(o => o.plate === n && !o.aside); }
    heads() { return [...new Set(this.onPlate().map(o => o.tool))].sort(); }
    needsTower() { return this.heads().length > 1; }

    /* ---- undo ---------------------------------------------------------------------------------------------------------------- */
    snapshot() {
      return { objects: this.objects.map(o => ({ ...o, transform: o.transform.slice(), settings: { ...o.settings }, _b: null, _o: null })), plates: this.plates, current: this.current,
        selected: [...this.selected], nextId: this.nextId, tower: this.tower ? { ...this.tower } : null };
    }
    restoreFrom(s) {
      this.objects = s.objects.map(o => ({ ...o, transform: o.transform.slice(), settings: { ...o.settings } }));
      this.plates = s.plates; this.current = Math.min(s.current, s.plates - 1); this.selected = new Set(s.selected.filter(id => this.get(id)));
      this.tower = s.tower ? { ...s.tower } : null;
    }
    checkpoint() {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    undo() {
      if (!this.undoStack.length) return false;
      this.redoStack.push(this.snapshot());
      this.restoreFrom(this.undoStack.pop());
      this.changed('undo');
      return true;
    }
    redo() {
      if (!this.redoStack.length) return false;
      this.undoStack.push(this.snapshot());
      this.restoreFrom(this.redoStack.pop());
      this.changed('redo');
      return true;
    }

    /* ---- adding and removing ----------------------------------------------------------------------------------------------------- */
    /* row: { name, label?, sourceName?, local?, mesh, tool?, transform?, settings?, keepColour? }. Returns the object. */
    add(row, opts = {}) {
      if (this.onPlate().length >= MAX_PER_PLATE) throw new Error(`A plate holds at most ${MAX_PER_PLATE} objects. Add another plate for the rest`);
      if (opts.checkpoint !== false) this.checkpoint();
      const o = { id: this.nextId++, name: row.label || row.name, file: row.name, sourceName: row.sourceName || null, local: row.local || null, mesh: row.mesh,
        tool: Number.isInteger(row.tool) ? row.tool : 0, transform: (row.transform || IDENTITY).slice(), settings: { ...(row.settings || {}) },
        keepColour: row.keepColour !== false, hidden: false, aside: false, plate: this.current, _b: null, _o: null };
      this.objects.push(o);
      if (!row.transform) {
        this.centre(o);
        if (this.onPlate().length > 1) this.placeInFreeSpot(o);
      }
      this.selected = new Set([o.id]);
      this.changed('add', [o.id]);
      return o;
    }

    remove(ids) {
      const set = new Set(ids);
      if (!this.objects.some(o => set.has(o.id))) return;
      this.checkpoint();
      this.objects = this.objects.filter(o => !set.has(o.id));
      for (const id of set) this.selected.delete(id);
      this.changed('remove', [...set]);
    }

    clear() { this.checkpoint(); this.objects = []; this.selected.clear(); this.changed('clear'); }

    duplicate(ids, copies = 1) {
      const made = [];
      this.checkpoint();
      for (const id of ids) {
        const src = this.get(id);
        if (!src) continue;
        for (let i = 0; i < copies; i++) {
          if (this.onPlate(src.plate).length >= MAX_PER_PLATE) break;
          const o = { ...src, id: this.nextId++, transform: src.transform.slice(), settings: { ...src.settings }, _b: null, _o: null, name: src.name };
          this.objects.push(o);
          this.placeInFreeSpot(o);
          made.push(o.id);
        }
      }
      this.selected = new Set(made);
      this.changed('duplicate', made);
      return made;
    }

    /* ---- placing --------------------------------------------------------------------------------------------------------------------- */
    centre(o, x, y) {
      const a = area(), b = boundsOf(o);
      const tx = x === undefined ? (a.x0 + a.x1) / 2 : x, ty = y === undefined ? (a.y0 + a.y1) / 2 : y;
      o.transform[9] += tx - b.centre[0]; o.transform[10] += ty - b.centre[1]; o.transform[11] -= b.min[2];
      o._b = null;
    }

    around(o, m) {
      const b = boundsOf(o), c = b.centre, to = IDENTITY.slice(), back = IDENTITY.slice();
      to[9] = -c[0]; to[10] = -c[1]; to[11] = -c[2]; back[9] = c[0]; back[10] = c[1]; back[11] = c[2];
      o.transform = compose(compose(compose(o.transform, to), m), back);
      o._b = null; o._o = null;
    }

    /* the nearest free place for an object, trying the middle first and spiralling out; falls back to the middle */
    placeInFreeSpot(o) {
      const a = area(), others = this.onPlate(o.plate).filter(q => q !== o && !q.hidden), gap = 5, b = boundsOf(o);
      const hit = (x, y) => others.some(q => {
        const r = boundsOf(q);
        return Math.abs(x - r.centre[0]) < (b.size[0] + r.size[0]) / 2 + gap && Math.abs(y - r.centre[1]) < (b.size[1] + r.size[1]) / 2 + gap;
      });
      const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2, step = 10;
      for (let ring = 0; ring < 28; ring++) {
        for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
          const x = cx + i * step, y = cy + j * step;
          if (x - b.size[0] / 2 < a.x0 || x + b.size[0] / 2 > a.x1 || y - b.size[1] / 2 < a.y0 || y + b.size[1] / 2 > a.y1) continue;
          if (this.tower && this.rectHit(x, y, b.size, this.tower)) continue;
          if (!hit(x, y)) { this.centre(o, x, y); return true; }
        }
      }
      this.centre(o);
      return false;
    }
    rectHit(x, y, size, t) { return Math.abs(x - t.x) < (size[0] + t.w) / 2 && Math.abs(y - t.y) < (size[1] + t.d) / 2; }

    /* The quick arrangement: every object on the plate, packed with a gap, centred. Turns objects a quarter turn about Z when that fits better.
       `ids` limits it to some objects (the rest stay where they are and are kept clear of). */
    arrange(opts = {}) {
      const a = area(), gap = opts.gap === undefined ? 6 : opts.gap, plate = opts.plate === undefined ? this.current : opts.plate;
      const all = this.onPlate(plate).filter(o => !o.hidden);
      const movers = opts.ids ? all.filter(o => opts.ids.includes(o.id)) : all;
      const fixed = all.filter(o => !movers.includes(o));
      const W = a.x1 - a.x0, D = a.y1 - a.y0, edge = 2;
      const blocked = fixed.map(o => { const b = boundsOf(o); return { x: b.min[0] - a.x0 - gap, y: b.min[1] - a.y0 - gap, w: b.size[0] + 2 * gap, h: b.size[1] + 2 * gap }; });
      if (this.tower && plate === this.current) blocked.push({ x: this.tower.x - this.tower.w / 2 - a.x0 - gap, y: this.tower.y - this.tower.d / 2 - a.y0 - gap, w: this.tower.w + 2 * gap, h: this.tower.d + 2 * gap });
      const items = movers.map(o => { const b = boundsOf(o); return { id: o.id, w: b.size[0], d: b.size[1] }; });
      const { placed, failed } = pack(items, W - 2 * edge, D - 2 * edge, gap, blocked.map(r => ({ ...r, x: r.x - edge, y: r.y - edge })));
      if (!placed.length && !failed.length) return { placed: 0, failed: [] };
      this.checkpoint();
      // centre what was packed (when nothing else is fixed), so the arrangement sits in the middle of the plate
      let dx = 0, dy = 0;
      if (!fixed.length && !(this.tower && plate === this.current) && placed.length) {
        const minX = Math.min(...placed.map(p => p.x)), maxX = Math.max(...placed.map(p => p.x + p.w)), minY = Math.min(...placed.map(p => p.y)), maxY = Math.max(...placed.map(p => p.y + p.h));
        dx = ((W - 2 * edge) - (maxX - minX)) / 2 - minX; dy = ((D - 2 * edge) - (maxY - minY)) / 2 - minY;
      }
      for (const p of placed) {
        const o = this.get(p.id);
        if (p.turn) this.around(o, rotation(2, 90));
        const b = boundsOf(o);
        this.centre(o, a.x0 + edge + dx + p.x + b.size[0] / 2, a.y0 + edge + dy + p.y + b.size[1] / 2);
      }
      this.changed('arrange', placed.map(p => p.id));
      return { placed: placed.length, failed };
    }

    /* ---- changing one object ---------------------------------------------------------------------------------------------------- */
    setTransform(id, t, opts = {}) {
      const o = this.get(id);
      if (!o) return;
      if (opts.checkpoint !== false) this.checkpoint();
      o.transform = t.slice(); o._b = null; o._o = null;
      this.changed('transform', [id]);
    }

    moveBy(id, d, opts = {}) {
      const o = this.get(id);
      if (!o) return;
      if (opts.checkpoint !== false) this.checkpoint();
      o.transform[9] += d[0]; o.transform[10] += d[1]; o.transform[11] += d[2]; o._b = null;
      this.changed('transform', [id]);
    }

    /* put an object's middle (x, y) and its underside (z) at exact values, the way the number boxes do */
    place(id, p, opts = {}) {
      const o = this.get(id);
      if (!o) return;
      if (opts.checkpoint !== false) this.checkpoint();
      const b = boundsOf(o);
      if (p.x !== undefined) o.transform[9] += p.x - b.centre[0];
      if (p.y !== undefined) o.transform[10] += p.y - b.centre[1];
      if (p.z !== undefined) o.transform[11] += p.z - b.min[2];
      o._b = null;
      this.changed('transform', [id]);
    }

    rotateBy(id, axis, degrees, opts = {}) {
      const o = this.get(id);
      if (!o) return;
      if (opts.checkpoint !== false) this.checkpoint();
      this.around(o, rotation(axis, degrees));
      this.changed('transform', [id]);
    }

    /* scale about the middle: one ratio for all axes, or [x, y, z] */
    scaleBy(id, ratio, opts = {}) {
      const o = this.get(id), r = Array.isArray(ratio) ? ratio : [ratio, ratio, ratio];
      if (!o || r.some(v => !(v > 0) || v > 1000)) throw new Error('A size needs a number above zero');
      if (opts.checkpoint !== false) this.checkpoint();
      const m = IDENTITY.slice(); m[0] = r[0]; m[4] = r[1]; m[8] = r[2];
      this.around(o, m);
      this.changed('transform', [id]);
    }

    /* set the size in mm along the plate's axes (for a model that was turned, this scales its box) */
    sizeTo(id, size, lock = true) {
      const o = this.get(id);
      if (!o) return;
      const b = boundsOf(o), ratio = size.map((v, i) => (v > 0 && b.size[i] > 1e-9 ? v / b.size[i] : 1));
      this.scaleBy(id, lock ? [ratio.find((r, i) => size[i] !== undefined && Math.abs(r - 1) > 1e-9) || 1].flatMap(r => [r, r, r]) : ratio);
    }

    mirror(id, axis) {
      const o = this.get(id);
      if (!o) return;
      this.checkpoint();
      const m = IDENTITY.slice(); m[axis * 4] = -1;
      this.around(o, m);
      this.changed('transform', [id]);
    }

    drop(id, opts = {}) {
      const o = this.get(id);
      if (!o) return;
      if (opts.checkpoint !== false) this.checkpoint();
      o.transform[11] -= boundsOf(o).min[2]; o._b = null;
      this.changed('transform', [id]);
    }

    /* turn an object so a face with this outward normal (in the world, where it stands now) lies flat on the plate */
    layOnFace(id, normal) {
      const o = this.get(id);
      if (!o) return;
      this.checkpoint();
      const n = Math.hypot(...normal) || 1;
      this.around(o, between(normal.map(v => v / n), [0, 0, -1]));
      o.transform[11] -= boundsOf(o).min[2]; o._b = null;
      this.changed('transform', [id]);
    }

    /* the largest flat face, by area, goes down */
    layLargestFace(id) {
      const o = this.get(id);
      if (!o) return;
      const p = o.mesh.positions, m = o.transform, planes = new Map();
      let best = null, area2 = 0;
      for (let i = 0; i < p.length; i += 9) {
        const a = point(m, [p[i], p[i + 1], p[i + 2]]), b = point(m, [p[i + 3], p[i + 4], p[i + 5]]), c = point(m, [p[i + 6], p[i + 7], p[i + 8]]);
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n);
        if (l < 1e-9) continue;
        const unit = n.map(x => x / l), d = unit[0] * a[0] + unit[1] * a[1] + unit[2] * a[2];
        const key = unit.map(x => Math.round(x * 5000)).join(',') + ',' + Math.round(d * 100), sum = (planes.get(key) || 0) + l;
        planes.set(key, sum);
        if (sum > area2) { area2 = sum; best = unit; }
      }
      if (!best) throw new Error('This model has no flat face to lay down');
      this.layOnFace(id, best);
    }

    /* Stand the object the way that needs the least support: tries each large flat face and each of the six directions as the one that goes
       down, scores them (the share of the surface that hangs out, rewarded for a big flat base, a little for being low) and keeps the best. */
    autoOrient(id) {
      const o = this.get(id);
      if (!o) return null;
      const b0 = boundsOf(o), dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], cands = [...flatFaces(o).map(f => f.unit), ...dirs];
      const centre = b0.centre, to = IDENTITY.slice(), back = IDENTITY.slice();
      to[9] = -centre[0]; to[10] = -centre[1]; to[11] = -centre[2]; back[9] = centre[0]; back[10] = centre[1]; back[11] = centre[2];
      const trial = n => compose(compose(compose(o.transform, to), between(n, [0, 0, -1])), back);
      const score = t => { const r = orientationScore(o, t); return r.overhang - 0.18 * r.contact + 0.0004 * r.height; };
      const now = score(o.transform);
      let best = null, bestScore = Infinity;
      for (const n of cands) { const t = trial(n), sc = score(t); if (sc < bestScore - 1e-9) { bestScore = sc; best = t; } }
      if (!best || bestScore >= now - 1e-6) return { changed: false, before: orientationScore(o, o.transform) };
      this.checkpoint();
      const before = orientationScore(o, o.transform);
      o.transform = best; o._b = null; o._o = null;
      o.transform[11] -= boundsOf(o).min[2]; o._b = null;
      this.changed('transform', [id]);
      return { changed: true, before, after: orientationScore(o, o.transform) };
    }
    setTool(ids, tool) {
      this.checkpoint();
      for (const id of ids) { const o = this.get(id); if (o) o.tool = tool; }
      this.changed('tool', ids);
    }
    setSetting(id, key, value) {
      const o = this.get(id);
      if (!o) return;
      this.checkpoint();
      if (value === '' || value === null || value === undefined) delete o.settings[key]; else o.settings[key] = value;
      this.changed('settings', [id]);
    }
    rename(id, name) { const o = this.get(id); if (o && name.trim()) { this.checkpoint(); o.name = name.trim().slice(0, 120); this.changed('rename', [id]); } }
    setHidden(id, flag) { const o = this.get(id); if (o) { o.hidden = !!flag; this.changed('hidden', [id]); } }
    setAside(id, flag) { const o = this.get(id); if (o) { this.checkpoint(); o.aside = !!flag; if (!flag) this.placeInFreeSpot(o); this.changed('aside', [id]); } }

    /* split an object into the separate pieces it is made of: each becomes an object of its own, where it stands */
    splitParts(id) {
      const o = this.get(id);
      if (!o) return [];
      const parts = connectedParts(o.mesh);
      if (parts.length < 2) return [];
      this.checkpoint();
      const made = [];
      const index = this.objects.indexOf(o);
      const pieces = parts.map((mesh, i) => ({ ...o, id: this.nextId++, name: `${o.name} part ${i + 1}`, mesh, transform: o.transform.slice(), settings: { ...o.settings }, _b: null, _o: null }));
      this.objects.splice(index, 1, ...pieces);
      this.selected = new Set(pieces.map(p => p.id));
      for (const p of pieces) made.push(p.id);
      this.changed('split', made);
      return made;
    }

    /* ---- plates ------------------------------------------------------------------------------------------------------------------ */
    addPlate() {
      if (this.plates >= MAX_PLATES) throw new Error(`A project holds at most ${MAX_PLATES} plates`);
      this.checkpoint();
      this.plates++; this.current = this.plates - 1;
      this.changed('plates');
      return this.current;
    }
    removePlate(n) {
      if (this.plates <= 1) return;
      this.checkpoint();
      this.objects = this.objects.filter(o => o.plate !== n);
      for (const o of this.objects) if (o.plate > n) o.plate--;
      this.plates--; this.current = Math.min(this.current, this.plates - 1);
      this.selected = new Set([...this.selected].filter(id => this.get(id)));
      this.changed('plates');
    }
    showPlate(n) { this.current = Math.max(0, Math.min(this.plates - 1, n)); this.selected = new Set([...this.selected].filter(id => this.get(id)?.plate === this.current)); this.changed('plate'); }
    moveToPlate(ids, n) {
      this.checkpoint();
      for (const id of ids) { const o = this.get(id); if (o) { o.plate = n; this.placeInFreeSpot(o); } }
      this.changed('plates', ids);
    }

    /* ---- what is wrong with the plate ------------------------------------------------------------------------------------------------- */
    /* [{ kind, level: 'error' | 'warn' | 'info', ids, text, fix? }] for the plate being shown */
    problems(opts = {}) {
      const a = area(), out = [], mine = this.onPlate().filter(o => !o.hidden);
      for (const o of mine) {
        const b = boundsOf(o), s = b.size;
        const outside = b.min[0] < a.x0 - 0.01 || b.min[1] < a.y0 - 0.01 || b.max[0] > a.x1 + 0.01 || b.max[1] > a.y1 + 0.01;
        if (s[0] > a.x1 - a.x0 + 0.01 || s[1] > a.y1 - a.y0 + 0.01 || s[2] > a.z1 + 0.01) {
          out.push({ kind: 'toobig', level: 'error', ids: [o.id], text: `${o.name} is ${s.map(v => v.toFixed(0)).join(' × ')} mm, bigger than the U1 can print (270 × 270 × 270).`,
            fix: { label: 'Scale to fit', action: 'fit' } });
        } else if (outside) {
          out.push({ kind: 'outside', level: 'error', ids: [o.id], text: `${o.name} hangs over the edge of the printable area.`, fix: { label: 'Move onto the plate', action: 'inside' } });
        } else if (b.max[2] > a.z1 + 0.01) {
          out.push({ kind: 'tall', level: 'error', ids: [o.id], text: `${o.name} is taller than the U1 can print (${a.z1.toFixed(0)} mm).`, fix: { label: 'Scale to fit', action: 'fit' } });
        }
        if (Math.max(...s) < 10 && Math.max(...s) > 0) {
          out.push({ kind: 'tiny', level: 'warn', ids: [o.id], text: `${o.name} is only ${Math.max(...s).toFixed(1)} mm across. It may have been drawn in inches or metres.`,
            fix: { label: 'Scale × 25.4', action: 'inches' }, fix2: { label: 'Scale × 1000', action: 'metres' } });
        }
        if (b.min[2] > 0.05) out.push({ kind: 'floating', level: 'warn', ids: [o.id], text: `${o.name} floats ${b.min[2].toFixed(1)} mm above the plate.`, fix: { label: 'Drop to plate', action: 'drop' } });
        else if (b.min[2] < -0.05) out.push({ kind: 'below', level: 'warn', ids: [o.id], text: `${o.name} goes ${(-b.min[2]).toFixed(1)} mm below the plate.`, fix: { label: 'Drop to plate', action: 'drop' } });
        const share = opts.overhangs === false ? 0 : overhangShare(o);
        if (share > 0.08) out.push({ kind: 'overhang', level: 'info', ids: [o.id], text: `${o.name}: about ${Math.round(share * 100)}% of its surface hangs out more than 45°. It will probably need supports.`,
          fix: { label: 'Show overhangs', action: 'overhang' } });
        for (const w of (o.mesh.warnings || [])) out.push({ kind: 'mesh', level: 'info', ids: [o.id], text: `${o.name}: ${w}` });
      }
      for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) {
        const p = boundsOf(mine[i]), q = boundsOf(mine[j]);
        if ([0, 1, 2].every(k => Math.min(p.max[k], q.max[k]) - Math.max(p.min[k], q.min[k]) > 0.2)) {
          out.push({ kind: 'overlap', level: 'warn', ids: [mine[i].id, mine[j].id], text: `${mine[i].name} and ${mine[j].name} overlap.`, fix: { label: 'Arrange', action: 'arrange' } });
        }
      }
      if (this.needsTower() && this.tower) {
        const t = this.tower;
        for (const o of mine) { const b = boundsOf(o); if (Math.abs(t.x - b.centre[0]) < (t.w + b.size[0]) / 2 && Math.abs(t.y - b.centre[1]) < (t.d + b.size[1]) / 2) out.push({ kind: 'tower', level: 'warn', ids: [o.id], text: `${o.name} is in the way of the prime tower.`, fix: { label: 'Arrange', action: 'arrange' } }); }
      }
      return out;
    }

    isOutside(o) {
      const a = area(), b = boundsOf(o);
      return b.min[0] < a.x0 - 0.01 || b.min[1] < a.y0 - 0.01 || b.max[0] > a.x1 + 0.01 || b.max[1] > a.y1 + 0.01 || b.max[2] > a.z1 + 0.01;
    }
    canSlice() { return this.onPlate().length > 0 && !this.onPlate().some(o => !o.hidden && this.isOutside(o)); }

    /* what the server needs to save this plate as a project: one row per object (see plate_project.py) */
    rows(plate = this.current) {
      return this.onPlate(plate).map(o => ({ name: o.sourceName || o.file, label: o.name, transform: o.transform, tool: o.tool, settings: o.settings }));
    }
  }

  /* the separate shells of a mesh: triangles that share a corner belong together. Returns a mesh for each shell (positions, normals, bounds). */
  function connectedParts(mesh) {
    const p = mesh.positions, n = p.length / 9, parent = Array.from({ length: n }, (_, i) => i);
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const seen = new Map();
    for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
      const i = t * 9 + k * 3, key = Math.round(p[i] * 1000) + ',' + Math.round(p[i + 1] * 1000) + ',' + Math.round(p[i + 2] * 1000);
      const other = seen.get(key);
      if (other === undefined) seen.set(key, t); else { const a = find(t), b = find(other); if (a !== b) parent[a] = b; }
    }
    const groups = new Map();
    for (let t = 0; t < n; t++) { const r = find(t); (groups.get(r) || groups.set(r, []).get(r)).push(t); }
    const parts = [...groups.values()].sort((a, b) => b.length - a.length);
    return parts.map(tris => {
      const pos = new Float32Array(tris.length * 9), nrm = new Float32Array(tris.length * 9), col = mesh.colours ? new Float32Array(tris.length * 9) : null;
      tris.forEach((t, j) => { pos.set(p.subarray(t * 9, t * 9 + 9), j * 9); nrm.set(mesh.normals.subarray(t * 9, t * 9 + 9), j * 9); if (col) col.set(mesh.colours.subarray(t * 9, t * 9 + 9), j * 9); });
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i + k]); hi[k] = Math.max(hi[k], pos[i + k]); }
      return { positions: pos, normals: nrm, colours: col, bounds: { min: lo, max: hi }, size: hi.map((v, i) => v - lo[i]), warnings: [] };
    });
  }

  root.SlicerModel = { orientationScore, flatFaces, PlateModel, compose, point, rotation, between, boundsOf, overhangShare, pack, connectedParts, IDENTITY, MAX_PER_PLATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SlicerModel;
})(typeof window !== 'undefined' ? window : globalThis);
