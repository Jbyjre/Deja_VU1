/* Bounded geometry checks off the UI thread. No network or printer access. */
'use strict';
const EPS = 1e-7,
  MAX_TRIANGLES = 250000;
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const triangle = (p, t) => [
  Array.from(p.subarray(t * 9, t * 9 + 3)),
  Array.from(p.subarray(t * 9 + 3, t * 9 + 6)),
  Array.from(p.subarray(t * 9 + 6, t * 9 + 9))
];
function tree(p) {
  if (p.length % 9 || p.length / 9 > MAX_TRIANGLES)
    throw new Error(
      `Detailed geometry checks support at most ${MAX_TRIANGLES.toLocaleString()} triangles per object. The full model remains available to the slicer.`
    );
  const ids = Array.from({ length: p.length / 9 }, (_, i) => i);
  function node(start, end) {
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++)
      for (let v = 0; v < 3; v++)
        for (let k = 0; k < 3; k++) {
          const x = p[ids[i] * 9 + v * 3 + k];
          min[k] = Math.min(min[k], x);
          max[k] = Math.max(max[k], x);
        }
    const out = { min, max, start, end };
    if (end - start <= 12) return out;
    const ranges = max.map((v, k) => v - min[k]),
      axis = ranges.indexOf(Math.max(...ranges));
    // A local median sort is bounded by the worker's triangle cap. Mesh arrays
    // are shared by every node; leaf ranges reference one index array.
    const sorted = ids
      .slice(start, end)
      .sort(
        (a, b) =>
          p[a * 9 + axis] +
          p[a * 9 + 3 + axis] +
          p[a * 9 + 6 + axis] -
          (p[b * 9 + axis] + p[b * 9 + 3 + axis] + p[b * 9 + 6 + axis])
      );
    for (let i = 0; i < sorted.length; i++) ids[start + i] = sorted[i];
    const mid = (start + end) >> 1;
    out.left = node(start, mid);
    out.right = node(mid, end);
    return out;
  }
  return { p, ids, root: node(0, ids.length) };
}
const boxes = (a, b) => [0, 1, 2].every(k => a.max[k] >= b.min[k] - EPS && b.max[k] >= a.min[k] - EPS);
function trianglesTouch(a, b) {
  const ae = [sub(a[1], a[0]), sub(a[2], a[1]), sub(a[0], a[2])],
    be = [sub(b[1], b[0]), sub(b[2], b[1]), sub(b[0], b[2])],
    an = cross(ae[0], ae[1]),
    bn = cross(be[0], be[1]);
  if (dot(an, an) < EPS * EPS || dot(bn, bn) < EPS * EPS) return false;
  const axes = [an, bn, ...ae.flatMap(x => be.map(y => cross(x, y)))];
  if (dot(cross(an, bn), cross(an, bn)) < EPS * EPS * dot(an, an) * dot(bn, bn))
    axes.push(...ae.map(e => cross(an, e)), ...be.map(e => cross(bn, e)));
  for (const axis of axes) {
    const length = Math.hypot(...axis);
    if (length < EPS) continue;
    const n = axis.map(x => x / length),
      ap = a.map(v => dot(v, n)),
      bp = b.map(v => dot(v, n));
    if (Math.max(...ap) < Math.min(...bp) - EPS || Math.max(...bp) < Math.min(...ap) - EPS) return false;
  }
  return true;
}
function contact(a, b) {
  let tests = 0;
  const stack = [[a.root, b.root]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (!boxes(x, y)) continue;
    if (x.left) {
      stack.push([x.left, y], [x.right, y]);
      continue;
    }
    if (y.left) {
      stack.push([x, y.left], [x, y.right]);
      continue;
    }
    for (let i = x.start; i < x.end; i++)
      for (let j = y.start; j < y.end; j++) {
        if (++tests > 2000000)
          throw new Error('These meshes need too many contact comparisons. Use the slicer’s geometry checks.');
        if (trianglesTouch(triangle(a.p, a.ids[i]), triangle(b.p, b.ids[j]))) return true;
      }
  }
  return false;
}
function rayTriangle(origin, direction, tri) {
  const e1 = sub(tri[1], tri[0]),
    e2 = sub(tri[2], tri[0]),
    p = cross(direction, e2),
    det = dot(e1, p);
  if (Math.abs(det) < EPS) return null;
  const tvec = sub(origin, tri[0]),
    u = dot(tvec, p) / det;
  if (u < -EPS || u > 1 + EPS) return null;
  const q = cross(tvec, e1),
    v = dot(direction, q) / det;
  if (v < -EPS || u + v > 1 + EPS) return null;
  const t = dot(e2, q) / det;
  return t > EPS ? t : null;
}
function rayBox(o, d, n) {
  let lo = 0,
    hi = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < EPS) {
      if (o[k] < n.min[k] || o[k] > n.max[k]) return false;
    } else {
      const a = (n.min[k] - o[k]) / d[k],
        b = (n.max[k] - o[k]) / d[k];
      lo = Math.max(lo, Math.min(a, b));
      hi = Math.min(hi, Math.max(a, b));
      if (hi < lo) return false;
    }
  }
  return true;
}
function hits(t, o, d) {
  const stack = [t.root],
    out = [];
  while (stack.length) {
    const n = stack.pop();
    if (!rayBox(o, d, n)) continue;
    if (n.left) {
      stack.push(n.left, n.right);
      continue;
    }
    for (let i = n.start; i < n.end; i++) {
      const h = rayTriangle(o, d, triangle(t.p, t.ids[i]));
      if (h !== null) out.push(h);
    }
  }
  out.sort((a, b) => a - b);
  return out.filter((v, i) => !i || Math.abs(v - out[i - 1]) > 1e-5);
}
function inside(point, t) {
  const d = [0.811107, 0.324443, 0.486664];
  return hits(t, point, d).length % 2 === 1;
}
self.onmessage = e => {
  const { id, type } = e.data;
  try {
    if (type === 'contact') {
      const trees = e.data.meshes.map(tree),
        pairs = [];
      for (let i = 0; i < trees.length; i++)
        for (let j = i + 1; j < trees.length; j++) {
          const a = trees[i],
            b = trees[j];
          if (
            boxes(a.root, b.root) &&
            (contact(a, b) || inside(Array.from(a.p.subarray(0, 3)), b) || inside(Array.from(b.p.subarray(0, 3)), a))
          )
            pairs.push([i, j]);
        }
      self.postMessage({ id, pairs });
    } else if (type === 'select') {
      const { origin, direction } = e.data.ray;
      let object = null,
        distance = Infinity;
      e.data.meshes.forEach((mesh, i) => {
        const found = hits(tree(mesh), origin, direction);
        if (found.length && found[0] < distance) {
          object = i;
          distance = found[0];
        }
      });
      self.postMessage({ id, object });
    } else if (type === 'pick') {
      const t = tree(e.data.mesh),
        { origin, direction } = e.data.ray,
        found = hits(t, origin, direction);
      self.postMessage({ id, point: found.length ? origin.map((v, i) => v + direction[i] * found[0]) : null });
    } else throw new Error('Unknown geometry check');
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
