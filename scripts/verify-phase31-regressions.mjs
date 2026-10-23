import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = new URL("../", import.meta.url);
const baseline = JSON.parse(await readFile(new URL("docs/phase32/PHASE31_TEST_BASELINE.json", root), "utf8"));
for (const entry of baseline.files) {
  const bytes = await readFile(new URL(entry.path, root));
  assert.ok(bytes.length >= entry.bytes, `Original test truncated: ${entry.path}`);
  const original = entry.prefix ? bytes.subarray(0, entry.bytes) : bytes;
  assert.equal(createHash("sha256").update(original).digest("hex"), entry.sha256, `Original test changed: ${entry.path}`);
}
const result = { baseline: baseline.baseline, originalCases: baseline.tests,
  originalBrowserCases: baseline.originalBrowserCases, verifiedFiles: baseline.files.length,
  unchangedOriginalIntegrationPrefix: true, outcome: "passed" };
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
