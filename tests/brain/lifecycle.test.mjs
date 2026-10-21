import test from "node:test";
import assert from "node:assert/strict";
import {
  GpuScope,
  teardownRenderer,
  watchContextLoss,
} from "../../lib/brain/gpu.ts";
import {
  ReviewCoordinator,
  DraftCoordinator,
} from "../../lib/brain/coordination.ts";
test("GPU resources are disposed once and renderer/context/canvas are released", () => {
  let disposed = 0,
    renderer = 0,
    lost = 0,
    removed = 0;
  const scope = new GpuScope(),
    item = {
      dispose() {
        disposed++;
      },
    };
  scope.track(item);
  scope.track(item);
  teardownRenderer(
    {
      dispose() {
        renderer++;
      },
      forceContextLoss() {
        lost++;
      },
      domElement: {
        remove() {
          removed++;
        },
      },
    },
    scope,
  );
  scope.disposeAll();
  assert.deepEqual(
    [disposed, renderer, lost, removed, scope.size],
    [1, 1, 1, 1, 0],
  );
  assert.throws(() =>
    scope.track({
      dispose() {
        disposed++;
      },
    }),
  );
  assert.equal(disposed, 2);
});
test("context loss is cancelled, restoration clears timeout, repeat loss falls back and cleanup detaches", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const canvas = new EventTarget();
  let lost = 0,
    restored = 0,
    fallback = 0,
    now = 100;
  const cleanup = watchContextLoss(
    canvas,
    {
      onLost() {
        lost++;
      },
      onRestored() {
        restored++;
      },
      onFallback() {
        fallback++;
      },
    },
    () => now,
  );
  const event = new Event("webglcontextlost", { cancelable: true });
  canvas.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  canvas.dispatchEvent(new Event("webglcontextrestored"));
  t.mock.timers.tick(4000);
  assert.equal(fallback, 0);
  now += 100;
  canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
  assert.equal(fallback, 1);
  cleanup();
  canvas.dispatchEvent(new Event("webglcontextlost"));
  assert.deepEqual([lost, restored, fallback], [2, 1, 1]);
});
test("review queue preserves the row until matching confirmed ack, rejects roles and revision conflicts", async () => {
  let finish;
  const queue = new ReviewCoordinator(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    true,
  );
  queue.items = [{ id: "synth-a" }];
  const request = queue.decide(
    "synth-a",
    "verify",
    2,
    true,
    new AbortController().signal,
  );
  assert.equal(queue.items.length, 1);
  assert.equal(queue.pending, "synth-a");
  finish({
    origin: "demo",
    state: "error",
    error: { code: "REVISION_CONFLICT" },
  });
  await request;
  assert.equal(queue.items.length, 1);
  assert.equal(queue.error, "REVISION_CONFLICT");
  const next = queue.decide(
    "synth-a",
    "reject",
    2,
    true,
    new AbortController().signal,
  );
  finish({
    origin: "demo",
    state: "ready",
    confirmedAt: "2026-10-20T00:00:00Z",
    data: { id: "synth-a" },
  });
  await next;
  assert.equal(queue.items.length, 0);
  await assert.rejects(
    () =>
      new ReviewCoordinator(async () => {}, false).decide(
        "x",
        "verify",
        0,
        true,
        new AbortController().signal,
      ),
    /ROLE_FORBIDDEN/,
  );
});
test("offline draft stays local; publication requires response provenance and actual ack", () => {
  const draft = new DraftCoordinator();
  draft.queue();
  draft.sending(false);
  assert.equal(draft.state, "queued-local");
  draft.sending(true);
  assert.equal(draft.state, "sending");
  draft.acknowledge({
    origin: "remote",
    state: "ready",
    data: { state: "committed" },
  });
  assert.equal(draft.state, "sending");
  for (const state of ["accepted", "publishing", "committed"]) {
    draft.acknowledge({
      origin: "demo",
      state: "ready",
      confirmedAt: "2026-10-20T00:00:00Z",
      data: { state },
    });
    assert.equal(draft.state, state);
  }
});
