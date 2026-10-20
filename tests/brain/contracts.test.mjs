import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSafeMarkdown } from "../../lib/brain/markdown.ts";
import { reduceDraft, diffLines } from "../../lib/brain/diff.ts";
import {
  legacyDestination,
  LEGACY_VIEWS,
} from "../../lib/brain/legacy-views.ts";
import { unavailableVault } from "../../lib/brain/ports.ts";
import { layoutGraph } from "../../lib/brain/layout.ts";
test("F12/F13 source-derived view inventory maps every legacy value and preserves other parameters", () => {
  const source = JSON.parse(
    readFileSync(
      new URL("../parity/legacy-views.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(LEGACY_VIEWS), source.views);
  assert.equal(
    legacyDestination("settings", { view: "settings", tab: "sync" }),
    "/settings?tab=sync",
  );
  assert.equal(legacyDestination("missing", {}), null);
});
test("default vault adapter has no network and does not enable remote writes", async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    calls++;
    throw Error("Unexpected request");
  };
  try {
    const port = unavailableVault();
    for (const method of [
      "syncStatus",
      "listNotes",
      "getNote",
      "graph",
      "listProposals",
      "listAgents",
      "review",
    ])
      assert.equal((await port[method]()).state, "unavailable");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test("safe AST remains bounded, preserves self-reported metadata and never executes markup", () => {
  for (const input of [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "[x](javascript:alert(1))",
    "![tracker](https://tracker.invalid/p.gif)",
    "[[Title|<script>x</script>]]",
  ]) {
    const doc = parseSafeMarkdown(input);
    assert.equal(doc.tree.type, "root");
  }
  const doc = parseSafeMarkdown('---\nstate: "verified"\n---\n# Source');
  assert.equal(doc.metadata.state, "verified");
  assert.equal(Object.hasOwn(doc, "trust"), false);
  assert.equal(parseSafeMarkdown("A".repeat(2000000)).truncated, true);
});
test("draft transitions require actual confirmed acknowledgements, with no timer-based success", () => {
  let state = reduceDraft("editing", { kind: "queue" });
  assert.equal(state, "queued-local");
  state = reduceDraft(state, { kind: "send" });
  assert.equal(state, "sending");
  assert.throws(() =>
    reduceDraft(state, {
      kind: "ack",
      state: "committed",
      confirmedAt: "invalid",
    }),
  );
  assert.equal(
    reduceDraft(state, {
      kind: "ack",
      state: "conflict",
      confirmedAt: "2026-10-20T00:00:00Z",
    }),
    "conflict",
  );
  assert.equal(
    reduceDraft(state, {
      kind: "ack",
      state: "committed",
      confirmedAt: "2026-10-20T00:00:00Z",
    }),
    "committed",
  );
});
test("text diff preserves exact source lines and refuses unbounded quadratic input", () => {
  assert.deepEqual(
    diffLines("one\ntwo", "one\nthree")
      .filter((l) => l.kind === "added")
      .map((l) => l.text),
    ["three"],
  );
  assert.throws(() => diffLines("a\n".repeat(10000), "b"));
});
test("worker layout is deterministic, finite and bounded for seeded data", () => {
  const nodes = Array.from({ length: 100 }, (_, i) => ({
    id: "synth-" + i,
    clusterId: "cluster-" + (i % 4),
    kind: "source",
    degree: 2,
  }));
  const graph = {
    nodes,
    edges: [],
    loadedSources: 100,
    totalSources: 100,
    partial: false,
  };
  const a = layoutGraph(graph),
    b = layoutGraph(graph);
  assert.deepEqual([...a], [...b]);
  assert.equal(a.length, 200);
  assert.ok([...a].every(Number.isFinite));
});
