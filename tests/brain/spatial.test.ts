import test from "node:test";
import assert from "node:assert/strict";
import {
  cullViewport,
  segmentIntersectsRect,
  SpatialGrid,
  selectLod,
  type View,
} from "../../lib/brain/spatial.ts";

const view: View = { cx: 0, cy: 0, zoom: 1, width: 400, height: 300 };

test("culling keeps only nodes inside viewport + margin", () => {
  const x = Float32Array.from([0, 190, 260, -300]),
    y = Float32Array.from([0, 140, 0, 0]);
  const out = new Int32Array(4);
  const k = cullViewport(x, y, 4, view, 64, out);
  assert.deepEqual([...out.slice(0, k)], [0, 1, 2]); // 260 -> sx 460 <= 400+64; -300 -> sx -100 < -64
});
test("segment crossing the viewport is kept even if both endpoints are outside", () => {
  assert.equal(segmentIntersectsRect(-100, 150, 500, 150, 400, 300, 0), true);
  assert.equal(segmentIntersectsRect(-100, -100, -50, -50, 400, 300, 0), false);
});
test("grid hit-testing finds nearest and avoids O(n) scans", () => {
  const n = 5000,
    sx = new Float32Array(n),
    sy = new Float32Array(n),
    r = new Float32Array(n).fill(6),
    idx = new Int32Array(n);
  let s = 12345;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < n; i++) {
    sx[i] = rnd() * 1200;
    sy[i] = rnd() * 800;
    idx[i] = i;
  }
  const g = new SpatialGrid(32);
  g.build(sx, sy, idx, n, 1200, 800);
  let hits = 0;
  for (let m = 0; m < 1000; m++) {
    const i = Math.floor(rnd() * n);
    if (g.nearest(sx[i]!, sy[i]!, sx, sy, r, 12) >= 0) hits++;
  }
  assert.equal(hits, 1000);
  assert.ok(
    g.scans / 1000 < 100,
    `avg candidates per query ${g.scans / 1000} must be << n`,
  );
  assert.equal(g.nearest(-50, -50, sx, sy, r, 12), -1);
});
test("coarse hit radius is more forgiving", () => {
  const sx = Float32Array.from([100]),
    sy = Float32Array.from([100]),
    r = Float32Array.from([5]),
    idx = Int32Array.from([0]);
  const g = new SpatialGrid(32);
  g.build(sx, sy, idx, 1, 400, 300);
  assert.equal(g.nearest(115, 100, sx, sy, r, 12), -1);
  assert.equal(g.nearest(115, 100, sx, sy, r, 22), 0);
});
test("LOD thresholds", () => {
  assert.equal(selectLod(50, 3, true), 3);
  assert.equal(selectLod(300, 3, true), 2);
  assert.equal(selectLod(1000, 2, true), 1);
  assert.equal(selectLod(3000, 1, true), 0);
  assert.equal(selectLod(3000, 1, false), 1, "no clusters => floor LOD1");
  assert.equal(selectLod(50, 0, true), 3, "refines multiple levels");
});
test("LOD hysteresis: no flicker around the 100 boundary", () => {
  let l = selectLod(95, 3, true);
  const seq: number[] = [];
  for (const c of [95, 105, 109, 111, 105, 95, 92, 89, 95]) {
    l = selectLod(c, l, true);
    seq.push(l);
  }
  assert.deepEqual(seq, [3, 3, 3, 2, 2, 2, 2, 3, 3]);
});
