/* Checks for frontend/slicer-model.js, run in Node (tests/test_slicer_model.py runs this file and fails when any line fails). */
'use strict';
const assert = require('assert');
const path = require('path');
const M = require(path.join(__dirname, '..', 'frontend', 'slicer-model.js'));
const { PlateModel, boundsOf } = M;

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); } catch (e) { failures.push(name); console.log('FAIL ' + name + ': ' + e.message); }
}

/* a box as flat triangles, from (0,0,0) to (w,d,h) */
function boxMesh(w, d, h, at = [0, 0, 0]) {
  const [x0, y0, z0] = at, [x1, y1, z1] = [x0 + w, y0 + d, z0 + h], pos = [], nrm = [];
  const quad = (a, b, c, e, n) => { for (const p of [a, b, c, a, c, e]) { pos.push(...p); nrm.push(...n); } };
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
  quad([x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [0, 0, -1]);
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
  quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [0, 1, 0]);
  quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]);
  quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [-1, 0, 0]);
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), bounds: { min: [x0, y0, z0], max: [x1, y1, z1] }, warnings: [] };
}
/* a mesh made of two boxes that do not touch */
function twoBoxes() {
  const a = boxMesh(10, 10, 10), b = boxMesh(20, 20, 5, [40, 0, 0]);
  return { positions: Float32Array.from([...a.positions, ...b.positions]), normals: Float32Array.from([...a.normals, ...b.normals]), bounds: { min: [0, 0, 0], max: [60, 20, 10] }, warnings: [] };
}
/* a shape wide at the top and narrow at the bottom, so its sides hang out */
function funnel() {
  const pos = [], nrm = [];
  const tri = (a, b, c) => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n); pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) nrm.push(n[0] / l, n[1] / l, n[2] / l); };
  const bot = [[-2, -2, 0], [2, -2, 0], [2, 2, 0], [-2, 2, 0]], top = [[-20, -20, 10], [20, -20, 10], [20, 20, 10], [-20, 20, 10]];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; tri(bot[i], bot[j], top[j]); tri(bot[i], top[j], top[i]); }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), bounds: { min: [-20, -20, 0], max: [20, 20, 10] }, warnings: [] };
}
const row = (name, mesh, extra = {}) => ({ name, mesh, ...extra });
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} is not near ${b}`);
const overlaps = (m, i, j) => { const p = boundsOf(m.objects[i]), q = boundsOf(m.objects[j]); return [0, 1].every(k => Math.min(p.max[k], q.max[k]) - Math.max(p.min[k], q.min[k]) > 0); };

check('a new object sits in the middle of the printable area, on the plate', () => {
  const m = new PlateModel(), o = m.add(row('cube.stl', boxMesh(20, 20, 20)));
  const b = boundsOf(o);
  near(b.centre[0], 135.5); near(b.centre[1], 136); near(b.min[2], 0);
  assert.deepStrictEqual([...m.selected], [o.id]);
});

check('a second object is placed clear of the first, not on top of it', () => {
  const m = new PlateModel();
  m.add(row('a.stl', boxMesh(40, 40, 10))); m.add(row('b.stl', boxMesh(40, 40, 10)));
  assert.ok(!overlaps(m, 0, 1));
  assert.ok(m.problems().every(p => p.kind !== 'overlap'));
});

check('turning an object keeps its middle where it was', () => {
  const m = new PlateModel(), o = m.add(row('a.stl', boxMesh(30, 10, 10))), before = boundsOf(o).centre.slice();
  m.rotateBy(o.id, 2, 90);
  const b = boundsOf(o);
  near(b.size[0], 10, 1e-4); near(b.size[1], 30, 1e-4);
  near(b.centre[0], before[0], 1e-4); near(b.centre[1], before[1], 1e-4);
});

check('scaling is about the middle and a bad size is refused', () => {
  const m = new PlateModel(), o = m.add(row('a.stl', boxMesh(20, 20, 20))), c = boundsOf(o).centre.slice();
  m.scaleBy(o.id, 2);
  const b = boundsOf(o);
  near(b.size[0], 40, 1e-4); near(b.centre[0], c[0], 1e-4);
  assert.throws(() => m.scaleBy(o.id, 0), /above zero/);
  assert.throws(() => m.scaleBy(o.id, -3), /above zero/);
});

check('laying an object on a face puts that face on the plate', () => {
  const m = new PlateModel(), o = m.add(row('a.stl', boxMesh(10, 20, 30)));
  m.layOnFace(o.id, [1, 0, 0]);             // the face that looks along +x goes down
  const b = boundsOf(o);
  near(b.min[2], 0, 1e-4); near(b.size[2], 10, 1e-4);
});

check('the largest face goes down by itself', () => {
  const m = new PlateModel(), o = m.add(row('a.stl', boxMesh(40, 30, 5)));
  m.rotateBy(o.id, 0, 90);                  // stand it on its edge
  assert.ok(boundsOf(o).size[2] > 20);
  m.layLargestFace(o.id);
  near(boundsOf(o).size[2], 5, 1e-3); near(boundsOf(o).min[2], 0, 1e-3);
});

check('undo and redo bring back what was there, including a removed object', () => {
  const m = new PlateModel(), o = m.add(row('a.stl', boxMesh(20, 20, 20)));
  const x0 = boundsOf(o).centre[0];
  m.moveBy(o.id, [30, 0, 0]);
  near(boundsOf(m.get(o.id)).centre[0], x0 + 30);
  assert.ok(m.undo());
  near(boundsOf(m.get(o.id)).centre[0], x0);
  assert.ok(m.redo());
  near(boundsOf(m.get(o.id)).centre[0], x0 + 30);
  m.remove([o.id]);
  assert.strictEqual(m.objects.length, 0);
  m.undo();
  assert.strictEqual(m.objects.length, 1);
});

check('arrange fits every object inside the plate with a gap and nothing overlapping', () => {
  const m = new PlateModel();
  for (let i = 0; i < 9; i++) m.add(row(`o${i}.stl`, boxMesh(30 + i * 3, 25 + (i % 3) * 8, 10)));
  const res = m.arrange({ gap: 6 });
  assert.strictEqual(res.failed.length, 0);
  for (let i = 0; i < 9; i++) {
    const b = boundsOf(m.objects[i]);
    assert.ok(b.min[0] >= 0.5 && b.max[0] <= 270.5 && b.min[1] >= 1 && b.max[1] <= 271, `object ${i} is outside`);
    for (let j = i + 1; j < 9; j++) assert.ok(!overlaps(m, i, j), `${i} and ${j} overlap`);
  }
  assert.ok(m.canSlice());
});

check('arrange keeps a gap between neighbours', () => {
  const m = new PlateModel();
  for (let i = 0; i < 4; i++) m.add(row(`o${i}.stl`, boxMesh(50, 50, 10)));
  m.arrange({ gap: 8 });
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const p = boundsOf(m.objects[i]), q = boundsOf(m.objects[j]);
    const gapX = Math.max(q.min[0] - p.max[0], p.min[0] - q.max[0]), gapY = Math.max(q.min[1] - p.max[1], p.min[1] - q.max[1]);
    assert.ok(Math.max(gapX, gapY) >= 7.99, `gap ${Math.max(gapX, gapY)} between ${i} and ${j}`);
  }
});

check('objects that cannot fit are named, not squeezed in', () => {
  const m = new PlateModel();
  for (let i = 0; i < 4; i++) m.add(row(`big${i}.stl`, boxMesh(150, 150, 10)));
  const res = m.arrange();
  assert.ok(res.failed.length >= 1 && res.placed + res.failed.length === 4);
});

check('arranging leaves the prime tower\'s place clear', () => {
  const m = new PlateModel();
  m.tower = { x: 135.5, y: 136, w: 35, d: 35 };
  for (let i = 0; i < 3; i++) m.add(row(`o${i}.stl`, boxMesh(40, 40, 10)));
  m.arrange();
  for (const o of m.objects) { const b = boundsOf(o); assert.ok(!m.rectHit(b.centre[0], b.centre[1], b.size, m.tower), 'an object is on the tower'); }
});

check('arranging some objects leaves the others where they were', () => {
  const m = new PlateModel(), a = m.add(row('a.stl', boxMesh(30, 30, 10))), b = m.add(row('b.stl', boxMesh(30, 30, 10))), c = m.add(row('c.stl', boxMesh(30, 30, 10)));
  const keep = boundsOf(a).centre.slice();
  m.arrange({ ids: [b.id, c.id] });
  near(boundsOf(m.get(a.id)).centre[0], keep[0], 1e-6); near(boundsOf(m.get(a.id)).centre[1], keep[1], 1e-6);
  assert.ok(!overlaps(m, 0, 1) && !overlaps(m, 0, 2) && !overlaps(m, 1, 2));
});

check('problems: over the edge, too big, tiny, floating, overlapping', () => {
  const m = new PlateModel();
  const a = m.add(row('edge.stl', boxMesh(20, 20, 20))); m.place(a.id, { x: 268 });
  const b = m.add(row('huge.stl', boxMesh(300, 20, 20)));
  const c = m.add(row('tiny.stl', boxMesh(3, 3, 3)));
  const d = m.add(row('float.stl', boxMesh(20, 20, 20))); m.place(d.id, { z: 12 });
  const kinds = m.problems().map(p => p.kind + ':' + p.ids[0]);
  assert.ok(kinds.includes('outside:' + a.id), kinds.join());
  assert.ok(kinds.includes('toobig:' + b.id));
  assert.ok(kinds.includes('tiny:' + c.id));
  assert.ok(kinds.includes('floating:' + d.id));
  assert.strictEqual(m.canSlice(), false);
  const e = new PlateModel(), p = e.add(row('p.stl', boxMesh(30, 30, 30))), q = e.add(row('q.stl', boxMesh(30, 30, 30)));
  e.place(q.id, { x: boundsOf(e.get(p.id)).centre[0] + 10, y: boundsOf(e.get(p.id)).centre[1] });
  assert.ok(e.problems().some(x => x.kind === 'overlap'));
});

check('an inch-sized model is caught and the fix scales it by 25.4', () => {
  const m = new PlateModel(), o = m.add(row('small.stl', boxMesh(2, 2, 2)));
  const p = m.problems().find(x => x.kind === 'tiny');
  assert.ok(p && p.fix.action === 'inches' && p.fix2.action === 'metres');
  m.scaleBy(o.id, 25.4);
  assert.ok(!m.problems().some(x => x.kind === 'tiny'));
});

check('an overhanging shape is flagged as needing supports; a plain box is not', () => {
  const m = new PlateModel();
  m.add(row('funnel.stl', funnel()));
  assert.ok(m.problems().some(p => p.kind === 'overhang'));
  const b = new PlateModel(); b.add(row('box.stl', boxMesh(20, 20, 20)));
  assert.ok(!b.problems().some(p => p.kind === 'overhang'));
});


/* a T: a wide slab on top of a narrow post, standing on its post (a lot of overhang as it stands) */
function tShape() {
  const a = boxMesh(8, 8, 20, [16, 16, 0]), b = boxMesh(40, 40, 6, [0, 0, 20]);
  return { positions: Float32Array.from([...a.positions, ...b.positions]), normals: Float32Array.from([...a.normals, ...b.normals]), bounds: { min: [0, 0, 0], max: [40, 40, 26] }, warnings: [] };
}
check('auto-orient turns an object that stands on a post so it needs less support', () => {
  const m = new PlateModel(), o = m.add(row('t.stl', tShape()));
  const before = M.orientationScore(o, o.transform).overhang;
  assert.ok(before > 0.1, 'stands with a big overhang: ' + before);
  const r = m.autoOrient(o.id);
  assert.ok(r.changed, 'it was turned');
  const after = M.orientationScore(o, o.transform).overhang;
  assert.ok(after < before / 2, `the overhang went from ${before.toFixed(2)} to ${after.toFixed(2)}`);
  near(boundsOf(o).min[2], 0, 1e-3);
  assert.ok(m.undo(), 'and it can be undone'); near(M.orientationScore(m.get(o.id), m.get(o.id).transform).overhang, before, 1e-6);
});

check('auto-orient leaves a box alone: it already stands flat', () => {
  const m = new PlateModel(), o = m.add(row('b.stl', boxMesh(30, 20, 10)));
  const t = o.transform.slice();
  assert.strictEqual(m.autoOrient(o.id).changed, false);
  assert.deepStrictEqual(o.transform, t);
});

check('splitting a model into its parts makes one object per part', () => {
  const m = new PlateModel(), o = m.add(row('pair.stl', twoBoxes()));
  const made = m.splitParts(o.id);
  assert.strictEqual(made.length, 2);
  assert.strictEqual(m.objects.length, 2);
  assert.deepStrictEqual(m.objects.map(x => x.mesh.positions.length / 9).sort(), [12, 12]);
  assert.deepStrictEqual(new PlateModel().splitParts(999), []);
  const single = new PlateModel(), s = single.add(row('one.stl', boxMesh(5, 5, 5)));
  assert.deepStrictEqual(single.splitParts(s.id), [], 'a single piece is not split');
});

check('a plate holds at most 32 objects', () => {
  const m = new PlateModel();
  for (let i = 0; i < 32; i++) m.add(row(`o${i}.stl`, boxMesh(2, 2, 2)));
  assert.throws(() => m.add(row('one-more.stl', boxMesh(2, 2, 2))), /at most 32/);
});

check('plates: add, move an object to another, remove one', () => {
  const m = new PlateModel(), a = m.add(row('a.stl', boxMesh(20, 20, 20)));
  m.addPlate();
  assert.strictEqual(m.plates, 2); assert.strictEqual(m.current, 1);
  assert.strictEqual(m.onPlate().length, 0);
  m.showPlate(0);
  m.moveToPlate([a.id], 1);
  assert.strictEqual(m.onPlate(0).length, 0); assert.strictEqual(m.onPlate(1).length, 1);
  m.removePlate(1);
  assert.strictEqual(m.plates, 1); assert.strictEqual(m.objects.length, 0);
});

check('the heads in use decide whether a prime tower is needed', () => {
  const m = new PlateModel(), a = m.add(row('a.stl', boxMesh(20, 20, 20))), b = m.add(row('b.stl', boxMesh(20, 20, 20)));
  assert.strictEqual(m.needsTower(), false);
  m.setTool([b.id], 2);
  assert.deepStrictEqual(m.heads(), [0, 2]);
  assert.strictEqual(m.needsTower(), true);
  m.setAside(b.id, true);
  assert.strictEqual(m.needsTower(), false, 'an object set aside is not on the plate');
});

check('the rows the server saves carry the source file, the label, the transform, the head and the settings', () => {
  const m = new PlateModel(), o = m.add(row('cube.stl', boxMesh(20, 20, 20), { sourceName: 'source-ab12.stl', tool: 3 }));
  m.setSetting(o.id, 'wall_loops', 4);
  const r = m.rows()[0];
  assert.strictEqual(r.name, 'source-ab12.stl'); assert.strictEqual(r.label, 'cube.stl'); assert.strictEqual(r.tool, 3);
  assert.strictEqual(r.transform.length, 12); assert.strictEqual(r.settings.wall_loops, 4);
  m.setSetting(o.id, 'wall_loops', '');
  assert.deepStrictEqual(m.rows()[0].settings, {});
});

check('sizing an object to exact millimetres works with the proportions locked', () => {
  const m = new PlateModel(), o = m.add(row('a.stl', boxMesh(20, 10, 5)));
  m.sizeTo(o.id, [40, undefined, undefined], true);
  const s = boundsOf(o).size;
  near(s[0], 40, 1e-3); near(s[1], 20, 1e-3); near(s[2], 10, 1e-3);
});

check('mirroring flips the shape without moving its middle', () => {
  const m = new PlateModel(), o = m.add(row('a.stl', boxMesh(20, 10, 5))), c = boundsOf(o).centre.slice();
  m.mirror(o.id, 0);
  near(boundsOf(o).centre[0], c[0], 1e-4); near(boundsOf(o).size[0], 20, 1e-4);
});

/* ---- edited shapes: split and cut ---- */
const Cut = require(path.join(__dirname, '..', 'frontend', 'slicer-cut.js'));
const volumeOf = o => Cut.volume(M.worldShape(o).positions);
function openEdges(positions) {          // directed edges with no partner going the other way
  const k = (p, i) => [0, 1, 2].map(c => Math.round(p[i + c] * 1e4)).join(',');
  const edges = new Map();
  for (let t = 0; t < positions.length; t += 9) for (let e = 0; e < 3; e++) {
    const a = k(positions, t + e * 3), b = k(positions, t + ((e + 1) % 3) * 3);
    if (a !== b) edges.set(a + '>' + b, (edges.get(a + '>' + b) || 0) + 1);
  }
  let bad = 0;
  for (const [id, n] of edges) { const [a, b] = id.split('>'); if (n !== 1 || edges.get(b + '>' + a) !== 1) bad++; }
  return bad;
}
const cutSpec = (plane, keep = {}, place = {}) => ({ plane, keep: { upper: true, lower: true, ...keep }, place });

check('split pieces are edited shapes with no file yet, and the rows never name the file they came from', () => {
  const m = new PlateModel(), o = m.add(row('pair.stl', twoBoxes(), { sourceName: 'pair-src.stl' }));
  const made = m.splitParts(o.id);
  for (const id of made) { const p = m.get(id); assert.strictEqual(p.edited, true); assert.strictEqual(p.sourceName, null); assert.strictEqual(p.local, null); }
  assert.deepStrictEqual(m.rows().map(r => r.name), ['', ''], 'no name until the shape is saved as a file');
  m.get(made[0]).sourceName = 'cut-aa.stl';
  assert.strictEqual(m.rows()[0].name, 'cut-aa.stl');
  const whole = new PlateModel(), w = whole.add(row('cube.stl', boxMesh(5, 5, 5), { sourceName: 'cube-src.stl' }));
  assert.strictEqual(w.edited, false); assert.strictEqual(whole.rows()[0].name, 'cube-src.stl', 'an untouched model still names its own file');
});

check('rows can leave out hidden objects, even when a shown one is the same file', () => {
  const m = new PlateModel(), a = m.add(row('cube.stl', boxMesh(5, 5, 5), { sourceName: 'same.stl' })), b = m.add(row('cube.stl', boxMesh(5, 5, 5), { sourceName: 'same.stl' }));
  m.setHidden(b.id, true);
  assert.strictEqual(m.rows().length, 2); assert.strictEqual(m.rows(undefined, { visibleOnly: true }).length, 1);
  assert.strictEqual(a.hidden, false);
});

check('cutting a box makes two edited parts, sized and stood on the plate, with the volume kept', () => {
  const m = new PlateModel(), o = m.add(row('cube.stl', boxMesh(20, 30, 40), { sourceName: 'cube-src.stl' })), before = volumeOf(o);
  const r = m.cutObject(o.id, cutSpec({ n: [0, 0, 1], d: 15 }, {}, { upper: true }));
  assert.ok(r && r.made.length === 2 && m.objects.length === 2);
  const up = m.objects.find(x => /\(upper\)/.test(x.name)), lo = m.objects.find(x => /\(lower\)/.test(x.name));
  near(boundsOf(lo).size[2], 15, 1e-3); near(boundsOf(up).size[2], 25, 1e-3);
  near(boundsOf(lo).min[2], 0, 1e-4); near(boundsOf(up).min[2], 0, 1e-4);
  near(volumeOf(up) + volumeOf(lo), before, before * 1e-5);
  assert.ok(up.edited && lo.edited && up.sourceName === null && lo.sourceName === null);
  assert.deepStrictEqual(up.transform.slice(0, 9).map(v => Math.round(v)), [1, 0, 0, 0, 1, 0, 0, 0, 1], 'the top part already faces its cut down, so it is only lowered onto the plate');
  assert.ok(m.selected.has(up.id) && m.selected.has(lo.id), 'the parts are selected');
  assert.strictEqual(openEdges(M.worldShape(up).positions), 0); assert.strictEqual(openEdges(M.worldShape(lo).positions), 0);
  assert.ok(m.problems().every(p => p.kind !== 'overlap'), 'the two parts are clear of each other');
});

check('a painted model is cut and split into parts that carry no colours, and the result says so', () => {
  const mesh = boxMesh(20, 30, 40); mesh.colours = new Float32Array(mesh.positions.length).fill(0.5);
  const m = new PlateModel(), o = m.add(row('painted.3mf', mesh));
  const r = m.cutObject(o.id, cutSpec({ n: [0, 0, 1], d: 15 }));
  assert.strictEqual(r.lostColours, true);
  assert.ok(m.objects.every(x => !x.mesh.colours && x.keepColour === false), 'the view shows what will print');
  const pair = twoBoxes(); pair.colours = new Float32Array(pair.positions.length).fill(0.3);
  const s = new PlateModel(), p = s.add(row('pair.3mf', pair));
  s.splitParts(p.id);
  assert.ok(s.objects.every(x => !x.mesh.colours && x.keepColour === false));
  s.undo();
  assert.ok(s.objects[0].mesh.colours, 'undo brings the colours back with the whole model');
  const plain = new PlateModel(), q = plain.add(row('plain.stl', boxMesh(20, 30, 40)));
  assert.strictEqual(plain.cutObject(q.id, cutSpec({ n: [0, 0, 1], d: 15 })).lostColours, false);
});

check('one undo puts the whole model back, with its own file', () => {
  const m = new PlateModel(), o = m.add(row('cube.stl', boxMesh(20, 30, 40), { sourceName: 'cube-src.stl' }));
  m.cutObject(o.id, cutSpec({ n: [0, 0, 1], d: 15 }));
  assert.strictEqual(m.objects.length, 2);
  m.undo();
  assert.strictEqual(m.objects.length, 1); assert.strictEqual(m.objects[0].id, o.id); assert.strictEqual(m.objects[0].edited, false);
  assert.strictEqual(m.rows()[0].name, 'cube-src.stl');
  m.redo();
  assert.strictEqual(m.objects.length, 2);
});

check('cutting with one part removed keeps only the other one, where it stood', () => {
  const m = new PlateModel(), o = m.add(row('cube.stl', boxMesh(20, 30, 40)));
  const top = boundsOf(o).max[2], r = m.cutObject(o.id, cutSpec({ n: [0, 0, 1], d: 15 }, { lower: false }));
  assert.ok(r && r.made.length === 1 && m.objects.length === 1);
  near(boundsOf(m.objects[0]).size[2], 25, 1e-3); near(boundsOf(m.objects[0]).max[2], top, 1e-4);
  assert.strictEqual(m.cutObject(m.objects[0].id, cutSpec({ n: [0, 0, 1], d: 15 }, { lower: false, upper: false })), null, 'cutting away both parts is refused');
});

check('a plane that misses the model changes nothing and is not an undo step', () => {
  const m = new PlateModel(), o = m.add(row('cube.stl', boxMesh(20, 30, 40))), undo = m.undoStack.length, version = m.version;
  assert.strictEqual(m.cutObject(o.id, cutSpec({ n: [0, 0, 1], d: 400 })), null);
  assert.strictEqual(m.cutObject(o.id, cutSpec({ n: [0, 0, 1], d: 40 })), null, 'a plane along the top face only touches it');
  assert.strictEqual(m.cutObject(999, cutSpec({ n: [0, 0, 1], d: 5 })), null);
  assert.strictEqual(m.undoStack.length, undo); assert.strictEqual(m.version, version); assert.strictEqual(m.objects.length, 1);
});

check('a mirrored, turned and scaled model is cut into closed parts with the right volume', () => {
  const m = new PlateModel(), o = m.add(row('a.stl', boxMesh(20, 10, 30)));
  m.mirror(o.id, 0); m.rotateBy(o.id, 2, 33); m.scaleBy(o.id, 1.5);
  const before = Math.abs(volumeOf(o));
  assert.ok(volumeOf(o) > 0, 'the model stays outward-facing after the mirror');
  const n = Cut.normalFor('x', 20, -15), c = boundsOf(o).centre, r = m.cutObject(o.id, cutSpec({ n, d: n[0] * c[0] + n[1] * c[1] + n[2] * c[2] }));
  assert.ok(r, 'it was cut');
  assert.ok(m.objects.length === 2 && m.objects.every(x => openEdges(M.worldShape(x).positions) === 0), 'both parts are closed');
  near(m.objects.reduce((s, x) => s + volumeOf(x), 0), before, before * 1e-4);
});

check('a part cut at a tilt and placed cut face down stands on a flat face as large as the cut', () => {
  const m = new PlateModel(), o = m.add(row('cube.stl', boxMesh(30, 30, 30))), n = Cut.normalFor('z', 25, 10), c = boundsOf(o).centre;
  const r = m.cutObject(o.id, cutSpec({ n, d: n[0] * c[0] + n[1] * c[1] + n[2] * c[2] }, {}, { upper: true, lower: true }));
  assert.ok(r && r.made.length === 2);
  for (const part of m.objects) {
    const w = M.worldShape(part).positions;
    let flat = 0;
    for (let t = 0; t < w.length; t += 9) {
      const z = [w[t + 2], w[t + 5], w[t + 8]], ux = w[t + 3] - w[t], uy = w[t + 4] - w[t + 1], vx = w[t + 6] - w[t], vy = w[t + 7] - w[t + 1];
      const cz = ux * vy - uy * vx;                                       // z part of the facing; negative: the face looks down
      if (z.every(v => Math.abs(v) < 1e-3) && cz < 0) flat += Math.abs(cz) / 2;
    }
    assert.ok(Math.abs(flat - r.capArea) < r.capArea * 0.01, `${part.name}: ${flat.toFixed(1)} mm² on the plate, the cut is ${r.capArea.toFixed(1)}`);
  }
});

check('a plate at the limit refuses a cut that would add an object, and changes nothing', () => {
  const m = new PlateModel();
  for (let i = 0; i < M.MAX_PER_PLATE; i++) m.add(row('c' + i + '.stl', boxMesh(2, 2, 2), { transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, (i % 8) * 30, Math.floor(i / 8) * 30, 0] }));
  const id = m.objects[0].id;
  assert.throws(() => m.cutObject(id, cutSpec({ n: [0, 0, 1], d: 1 })), /at most 32/);
  assert.strictEqual(m.objects.length, M.MAX_PER_PLATE);
  assert.ok(m.cutObject(id, cutSpec({ n: [0, 0, 1], d: 1 }, { upper: false })), 'removing a part keeps the count, so that cut is allowed');
});

check('pasting or duplicating an edited part keeps it an edited shape', () => {
  const m = new PlateModel(), o = m.add(row('cube.stl', boxMesh(20, 30, 40), { sourceName: 'cube-src.stl' }));
  m.cutObject(o.id, cutSpec({ n: [0, 0, 1], d: 15 }));
  const copy = m.duplicate([m.objects[0].id], 1);
  assert.strictEqual(m.get(copy[0]).edited, true);
  const pasted = m.add(row('x.stl', m.objects[0].mesh, { edited: m.objects[0].edited, srcKey: m.objects[0].srcKey }));
  assert.strictEqual(pasted.edited, true);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
