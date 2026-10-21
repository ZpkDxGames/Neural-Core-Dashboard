import test from "node:test";
import assert from "node:assert/strict";
import { computeWindow } from "../../lib/brain/windowed.ts";
test("renders a bounded number of rows for huge lists", () => {
  const w = computeWindow({
    scrollTop: 36_000,
    viewportH: 800,
    rowH: 72,
    count: 100_000,
    overscan: 6,
  });
  assert.ok(w.end - w.start <= 60);
  assert.equal(w.offsetTop, w.start * 72);
  assert.equal(w.totalH, 7_200_000);
});
test("clamps at both ends", () => {
  assert.equal(
    computeWindow({
      scrollTop: -50,
      viewportH: 400,
      rowH: 72,
      count: 10,
      overscan: 6,
    }).start,
    0,
  );
  assert.equal(
    computeWindow({
      scrollTop: 1e9,
      viewportH: 400,
      rowH: 72,
      count: 10,
      overscan: 6,
    }).end,
    10,
  );
});
