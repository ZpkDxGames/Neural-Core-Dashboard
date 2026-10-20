import test from "node:test";
import assert from "node:assert/strict";
import { classifyUrl, neutralizeBidi } from "../../lib/brain/links.ts";

const blocked = [
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  " javascript:alert(1)",
  "java\nscript:alert(1)",
  "java\tscript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "blob:https://x/uuid",
  "about:blank",
  "//evil.example/x",
  "https://user:pass@evil.example/",
  "https://exa\u200Bmple.com/",
  "https://example.com/\u202Eevil",
  "ftp://example.com/x",
  "\u0001https://example.com",
  "https://exa mple.com",
];
test("dangerous or ambiguous URLs are blocked", () => {
  for (const u of blocked)
    assert.equal(classifyUrl(u).kind, "blocked", JSON.stringify(u));
});
test("allowed schemes", () => {
  const a = classifyUrl("HTTPS://Example.com/a?b=1");
  assert.equal(a.kind, "external");
  if (a.kind === "external") {
    assert.equal(a.insecure, false);
    assert.equal(a.url.hostname, "example.com");
  }
  const b = classifyUrl("http://example.com");
  if (b.kind === "external") assert.equal(b.insecure, true);
  else assert.fail();
  const m = classifyUrl("mailto:a@example.com");
  if (m.kind === "external") assert.equal(m.mailto, true);
  else assert.fail();
});
test("IDN hosts are flagged", () => {
  const u = classifyUrl("https://exämple.com/");
  if (u.kind === "external") assert.equal(u.idn, true);
  else assert.fail();
});
test("anchors are namespaced; relative paths are unresolved", () => {
  assert.deepEqual(classifyUrl("#intro"), { kind: "anchor", id: "nb-intro" });
  assert.equal(classifyUrl("#a b").kind, "blocked");
  assert.equal(classifyUrl("../secret.md").kind, "unresolved");
});
test("fuzz: never throws, never returns external for non-allowed schemes", () => {
  let s = 99;
  const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32;
  const alphabet = "abcXYZ:/.#@\\ \u200B\u202E%0129-_?&=\n\t";
  for (let i = 0; i < 20000; i++) {
    let str = "";
    const len = Math.floor(rnd() * 40);
    for (let k = 0; k < len; k++)
      str += alphabet[Math.floor(rnd() * alphabet.length)];
    const v = classifyUrl(str);
    if (v.kind === "external")
      assert.ok(["https:", "http:", "mailto:"].includes(v.url.protocol), str);
  }
});
test("bidi controls are replaced with a visible marker", () => {
  assert.equal(neutralizeBidi("a\u202Eb\u2066c"), "a\uFFFDb\uFFFDc");
});
