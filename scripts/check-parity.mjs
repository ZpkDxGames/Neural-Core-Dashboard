import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
const manifest = JSON.parse(
  await readFile("tests/parity/manifest.json", "utf8"),
);
assert.equal(manifest.features.length, 15);
assert.equal(new Set(manifest.features.map((f) => f.id)).size, 15);
for (const feature of manifest.features) {
  const source = await readFile("tests/browser/" + feature.spec, "utf8");
  assert.ok(source.includes(feature.test), feature.id + " missing test");
  assert.ok(
    !/\btest\.(skip|fixme|only)\b/.test(source),
    feature.id + " skipped or exclusive test",
  );
}
for (const file of await readdir("tests/browser"))
  if (file.endsWith(".spec.mjs"))
    assert.ok(
      !/\btest\.(skip|fixme|only)\b/.test(
        await readFile("tests/browser/" + file, "utf8"),
      ),
      file + " skipped or exclusive test",
    );
console.log(
  "PASS all 15 source-derived parity entries have mandatory, non-skipped specs",
);
