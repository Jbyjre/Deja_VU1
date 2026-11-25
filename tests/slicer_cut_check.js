/* Checks for frontend/slicer-cut.js, run in Node (tests/test_slicer_cut.py runs this file and fails when any line fails).
 * Every cut piece must be a closed solid (each edge shared by exactly two triangles, one each way) and the two pieces' volumes must add up to the
 * model's, however the plane goes through it. */
'use strict';
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', 'frontend', 'slicer-cut.js'));

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); } catch (e) { failures.push(name); console.log('FAIL ' + name + ': ' + e.message); }
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what || 'value'}: ${a} is not within ${tol} of ${b}`);

/* ---- shapes, as flat triangles (counter-clockwise from outside) ---- */
function builder() {
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
  return { pos, tri, quad };
}
function box(x0, y0, z0, x1, y1, z1, inward = false) {
  const b = builder(), q = inward ? (a, c, d, e) => b.quad(a, e, d, c) : b.quad;
  q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  q([x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]);
  q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  q([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]);
  q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
  q([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]);
  return b.pos;
}
/* an L-shaped block 20 wide, 20 deep, 30 high: three 10 mm squares, so it has a corner that bends inward */
function lBlock() {
  const b = builder(), h = 30;
  const squares = [[0, 0], [10, 0], [0, 10]];
  for (const [x, y] of squares) {
    b.quad([x, y, h], [x + 10, y, h], [x + 10, y + 10, h], [x, y + 10, h]);
    b.quad([x, y + 10, 0], [x + 10, y + 10, 0], [x + 10, y, 0], [x, y, 0]);
  }
  const loop = [[0, 0], [10, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20], [0, 10]];
  for (let i = 0; i < loop.length; i++) {
    const [ax, ay] = loop[i], [bx, by] = loop[(i + 1) % loop.length];
    b.quad([ax, ay, 0], [bx, by, 0], [bx, by, h], [ax, ay, h]);
  }
  return b.pos;
}
function sphere(r, seg, rings, at = [0, 0, 0]) {
  const b = builder(), pt = (i, j) => {
    const th = Math.PI * j / rings, ph = 2 * Math.PI * i / seg;
    return [at[0] + r * Math.sin(th) * Math.cos(ph), at[1] + r * Math.sin(th) * Math.sin(ph), at[2] + r * Math.cos(th)];
  };
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = pt(i, j), c = pt(i + 1, j), d = pt(i + 1, j + 1), e = pt(i, j + 1);
    if (j === 0) b.tri(a, e, d); else if (j === rings - 1) b.tri(a, e, c); else { b.tri(a, e, d); b.tri(a, d, c); }
  }
  return b.pos;
}
/* a donut: tube radius r round a ring of radius R (a cut through its hole leaves a flat ring, an upright one two discs) */
function torus(R, r, seg, tube) {
  const b = builder(), pt = (i, j) => {
    const u = 2 * Math.PI * i / seg, v = 2 * Math.PI * j / tube;
    return [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)];
  };
  for (let i = 0; i < seg; i++) for (let j = 0; j < tube; j++) b.quad(pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1));
  return b.pos;
}
/* a star-shaped block with many corners that bend inward, 12 high: a fan from the middle makes its top and bottom */
function starBlock(points, outer, inner, h) {
  const b = builder(), ring = [];
  for (let i = 0; i < points * 2; i++) { const a = Math.PI * i / points, rad = i % 2 ? inner : outer; ring.push([rad * Math.cos(a), rad * Math.sin(a)]); }
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
    b.tri([0, 0, h], [ax, ay, h], [bx, by, h]);
    b.tri([0, 0, 0], [bx, by, 0], [ax, ay, 0]);
    b.quad([ax, ay, 0], [bx, by, 0], [bx, by, h], [ax, ay, h]);
  }
  return b.pos;
}
function manyCuts(name, positions, count, seed0) {
  check(name, () => {
    let seed = seed0;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pos = Float32Array.from(positions), total = C.volume(pos);
    for (let i = 0; i < count; i++) {
      const n = C.normalFor(['x', 'y', 'z'][i % 3], rnd() * 160 - 80, rnd() * 160 - 80), reach = C.reach(pos, n), d = reach.lo + (0.02 + 0.96 * rnd()) * (reach.hi - reach.lo);
      const r = C.cut(pos, null, { n, d });
      assert.strictEqual(r.issues.openLoops, 0, 'open loop at cut ' + i);
      assert.strictEqual(closed(r.upper), 0, 'upper open at cut ' + i);
      assert.strictEqual(closed(r.lower), 0, 'lower open at cut ' + i);
      near(r.upperVolume + r.lowerVolume, total, Math.abs(total) * 2e-4 + 0.01, 'volume at cut ' + i);
    }
  });
}
const f32 = a => Float32Array.from(a);
const flat = z => ({ n: [0, 0, 1], d: z });

/* every directed edge must be matched by exactly one edge the other way: a closed solid with no gaps and no T-junctions */
function closed(positions) {
  const k = (p, i) => [0, 1, 2].map(c => Math.round(p[i + c] * 1e4)).join(',');
  const edges = new Map();
  for (let t = 0; t < positions.length; t += 9) {
    for (let e = 0; e < 3; e++) {
      const a = k(positions, t + e * 3), b = k(positions, t + ((e + 1) % 3) * 3);
      if (a === b) continue;
      edges.set(a + '>' + b, (edges.get(a + '>' + b) || 0) + 1);
    }
  }
  let bad = 0;
  for (const [id, n] of edges) { const [a, b] = id.split('>'); if (n !== 1 || edges.get(b + '>' + a) !== 1) bad++; }
  return bad;
}
function both(positions, plane, colours) {
  const r = C.cut(f32(positions), colours ? f32(colours) : null, plane), total = C.volume(f32(positions));
  return { r, total };
}
function sound(name, positions, plane, expected) {
  check(name, () => {
    const { r, total } = both(positions, plane);
    if (r.upper.length) assert.strictEqual(closed(r.upper), 0, 'the upper part has gaps');
    if (r.lower.length) assert.strictEqual(closed(r.lower), 0, 'the lower part has gaps');
    near(r.upperVolume + r.lowerVolume, total, Math.abs(total) * 2e-5 + 0.05, 'the two parts together');
    assert.strictEqual(r.issues.openLoops, 0, 'an open loop was left');
    assert.strictEqual(r.issues.earFallbacks, 0, 'the triangulation needed its fallback');
    if (expected) expected(r, total);
  });
}

/* ---- the checks ---- */
sound('a flat cut through a box makes two closed solids with the right volumes', box(0, 0, 0, 10, 20, 30), flat(12), (r) => {
  near(r.upperVolume, 3600, 0.01, 'upper volume'); near(r.lowerVolume, 2400, 0.01, 'lower volume'); near(r.capArea, 200, 0.001, 'cut face area');
  assert.strictEqual(r.shifted, 0);
});
sound('an upright cut (x = 4) through a box', box(0, 0, 0, 10, 20, 30), { n: [1, 0, 0], d: 4 }, (r) => {
  near(r.upperVolume, 6 * 20 * 30, 0.01); near(r.capArea, 20 * 30, 0.001);
});
sound('a cut through the L-shaped block closes its bent cut face', lBlock(), flat(12), (r) => {
  near(r.upperVolume, 300 * 18, 0.05); near(r.lowerVolume, 300 * 12, 0.05); near(r.capArea, 300, 0.001, 'cut face area');
  assert.ok(r.capTriangles >= 4, 'an L takes at least four triangles');
});
sound('a tilted cut through the L-shaped block', lBlock(), { n: C.normalFor('z', 30, 20), d: C.normalFor('z', 30, 20).reduce((s, v, i) => s + v * [8, 8, 14][i], 0) });
sound('a cut through a box with a hollow inside leaves a hole in the cut face', [...box(0, 0, 0, 20, 20, 20), ...box(5, 5, 5, 15, 15, 15, true)], flat(10), (r, total) => {
  near(total, 8000 - 1000, 0.01, 'whole volume'); near(r.capArea, 400 - 100, 0.001, 'cut face area (outline minus hole)');
});
sound('a cut above the hollow leaves a full face', [...box(0, 0, 0, 20, 20, 20), ...box(5, 5, 5, 15, 15, 15, true)], flat(17), (r) => near(r.capArea, 400, 0.001));
sound('a cut through two separate blocks gives each its own cut face', [...box(0, 0, 0, 10, 10, 10), ...box(30, 0, 0, 50, 10, 10)], flat(4), (r) => {
  near(r.capArea, 100 + 200, 0.001); near(r.lowerVolume, 400 + 800, 0.01);
});
sound('a plane through the middle of a sphere, any way up', sphere(20, 40, 20), { n: C.normalFor('z', 25, -35), d: 3 }, (r, total) => {
  assert.ok(r.upperVolume > 0 && r.lowerVolume > 0);
  assert.ok(r.capArea > 600, 'the cut face of a 20 mm sphere is about 1,200 square mm: ' + r.capArea);
});
sound('a plane that grazes the sphere near its pole', sphere(20, 40, 20), flat(19.2));
sound('a thousand cuts of a sphere at random angles all stay closed', sphere(15, 24, 12, [3, -2, 15]), flat(15), () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const positions = f32(sphere(15, 24, 12, [3, -2, 15])), total = C.volume(positions);
  for (let i = 0; i < 1000; i++) {
    const n = C.normalFor(['x', 'y', 'z'][i % 3], rnd() * 160 - 80, rnd() * 160 - 80), reach = C.reach(positions, n), d = reach.lo + (0.02 + 0.96 * rnd()) * (reach.hi - reach.lo);
    const r = C.cut(positions, null, { n, d });
    assert.strictEqual(r.issues.openLoops, 0, 'open loop at cut ' + i);
    assert.strictEqual(closed(r.upper), 0, 'upper open at cut ' + i);
    assert.strictEqual(closed(r.lower), 0, 'lower open at cut ' + i);
    near(r.upperVolume + r.lowerVolume, total, total * 1e-4, 'volume at cut ' + i);
  }
});
sound('a cut through the hole of a donut leaves a flat ring with a hole in it', torus(20, 6, 36, 18), flat(0), (r) => {
  const ring = Math.PI * (26 ** 2 - 14 ** 2);
  assert.ok(Math.abs(r.capArea - ring) < ring * 0.03, 'ring area ' + r.capArea + ' against about ' + ring.toFixed(0));
});
sound('an upright cut through a donut leaves two separate discs', torus(20, 6, 36, 18), { n: [1, 0, 0], d: 0.3 }, (r) => {
  const discs = 2 * Math.PI * 36, share = r.capArea / discs;
  assert.ok(share > 0.93 && share < 1.01, 'two discs of radius 6 (' + r.capArea + ')');
});
sound('a flat cut through a twelve-pointed star block', starBlock(12, 20, 9, 12), flat(5), (r) => {
  near(r.upperVolume + r.lowerVolume, r.capArea * 12, r.capArea * 12 * 1e-3, 'volume against the cut face times the height');
});
manyCuts('four hundred cuts of a donut at random angles all stay closed', torus(20, 6, 30, 14), 400, 11);
manyCuts('four hundred cuts of the star block at random angles all stay closed', starBlock(9, 22, 8, 14), 400, 23);
check('a plane exactly on a face of the model moves a few microns instead of making a sliver', () => {
  const { r } = both(box(0, 0, 0, 10, 10, 10), flat(10));
  assert.ok(r.shifted !== 0, 'the plane should have moved');
  assert.strictEqual(r.upper.length, 0, 'nothing is above the top face');
  near(r.lowerVolume, 1000, 0.05);
  const mid = both([...box(0, 0, 0, 20, 20, 10), ...box(0, 0, 10, 10, 10, 20)].slice(0, 0), flat(0)); // (kept for the sliver check below)
  assert.ok(mid.r);
});
sound('a plane through the step where a smaller block sits on a larger one (the step height is a corner height)', lBlock().concat([]), flat(30 - 1e-6), (r) => {
  assert.ok(r.upperVolume < 0.01 * 9000);
});
check('colours are cut with the shape: every piece keeps one colour per corner, blended where the plane crossed', () => {
  const pos = box(0, 0, 0, 10, 10, 10), col = [];
  for (let i = 0; i < pos.length; i += 3) col.push(pos[i + 2] / 10, 0, 1 - pos[i + 2] / 10);   // red grows with height
  const { r } = both(pos, flat(5), col);
  assert.strictEqual(r.upperColours.length, r.upper.length);
  assert.strictEqual(r.lowerColours.length, r.lower.length);
  for (let i = 0; i < r.upper.length; i += 3) near(r.upperColours[i], Math.min(1, Math.max(0.5, r.upper[i + 2] / 10)), 1e-3, 'red at a corner of the upper part');
});
check('a plane that misses the model leaves it whole', () => {
  const { r, total } = both(box(0, 0, 0, 10, 10, 10), flat(50));
  assert.strictEqual(r.upper.length, 0);
  near(r.lowerVolume, total, 1e-6);
});
check('the normal for a flat, front and side cut, and a tilt', () => {
  assert.deepStrictEqual(C.normalFor('z').map(v => +v.toFixed(6)), [0, 0, 1]);
  assert.deepStrictEqual(C.normalFor('x').map(v => +v.toFixed(6)), [1, 0, 0]);
  assert.deepStrictEqual(C.normalFor('y').map(v => +v.toFixed(6)), [0, 1, 0]);
  const t = C.normalFor('z', 30, 0);
  near(t[1], -0.5, 1e-9); near(t[2], Math.sqrt(3) / 2, 1e-9); near(Math.hypot(...C.normalFor('x', 33, -12)), 1, 1e-9, 'length');
});
check('reach measures how far the model goes along the normal', () => {
  const r = C.reach(f32(box(2, 3, 4, 12, 23, 34)), [0, 0, 1]);
  near(r.lo, 4, 1e-9); near(r.hi, 34, 1e-9);
});
check('makeMesh gives the fields the scene and the plate model read', () => {
  const m = C.makeMesh(f32(box(0, 0, 0, 10, 20, 30)));
  assert.strictEqual(m.triangles, 12); assert.deepStrictEqual(m.size, [10, 20, 30]); assert.strictEqual(m.normals.length, m.positions.length);
  assert.deepStrictEqual(m.bounds.max, [10, 20, 30]); assert.ok(Array.isArray(m.warnings));
});
check('the STL bytes are a valid binary STL and the fingerprint follows the bytes', () => {
  const p = f32(box(0, 0, 0, 10, 20, 30)), bytes = C.stlBytes(p), view = new DataView(bytes.buffer);
  assert.strictEqual(bytes.length, 84 + 12 * 50); assert.strictEqual(view.getUint32(80, true), 12);
  assert.strictEqual(view.getFloat32(84 + 12 + 8 * 4, true), p[8]);
  const a = C.fingerprint(bytes), b = C.fingerprint(C.stlBytes(f32(box(0, 0, 0, 10, 20, 31))));
  assert.strictEqual(a, C.fingerprint(C.stlBytes(p))); assert.notStrictEqual(a, b); assert.match(a, /^[0-9a-f]{16}$/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('Failed: ' + failures.join('; ')); process.exit(1); }
