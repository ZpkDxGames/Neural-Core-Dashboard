import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import {
  signAssertion,
  verifyAssertion,
} from "../../backend/v2/private/assertions.mjs";

const pair = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const options = {
  key: pair.privateKey,
  kid: "synthetic",
  now: 1000,
  context: {
    principalId: randomUUID(),
    ownerId: "synthetic",
    principalEpoch: 1,
    consentEpoch: 1,
    sessionRef: "a".repeat(64),
    identityHash: "b".repeat(64),
    sessionExpiresAt: 2000,
  },
  method: "GET",
  target: "/v2/private/session",
  body: Buffer.alloc(0),
  thumbprint: "c".repeat(64),
};
const valid = signAssertion(options);
export const malformedConfirmationClaims = [
  undefined,
  null,
  false,
  true,
  0,
  1,
  "",
  "pin",
  [],
  ["pin"],
  {},
  { "x5t#S256": null },
  { "x5t#S256": 7 },
  { "x5t#S256": [] },
  { "x5t#S256": {} },
  { "x5t#S256": "" },
  { "x5t#S256": "c".repeat(64) },
  { "x5t#S256": "!".repeat(43) },
  { "x5t#S256": "c".repeat(43) },
  {
    "x5t#S256": Buffer.from("c".repeat(64), "hex").toString("base64url"),
    extra: true,
  },
];
// Exports contain only synthetic malformed shapes; no generated key is exported.
export function resignAssertion(token, key, claims, header) {
  const parts = token.split(".");
  const input =
    (header === undefined
      ? parts[0]
      : Buffer.from(
          typeof header === "string" ? header : JSON.stringify(header),
        ).toString("base64url")) +
    "." +
    Buffer.from(
      typeof claims === "string" ? claims : JSON.stringify(claims),
    ).toString("base64url");
  return (
    input +
    "." +
    sign("sha256", Buffer.from(input), {
      key,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url")
  );
}
const check = (token, extra = {}) =>
  verifyAssertion({
    ...options,
    token,
    keys: { synthetic: pair.publicKey },
    now: 1001,
    ...extra,
  });
test("every missing, null, scalar, array, wrong-type and extra-member cnf is a deterministic 401", () => {
  for (const cnf of malformedConfirmationClaims) {
    const claims = JSON.parse(Buffer.from(valid.split(".")[1], "base64url"));
    if (cnf === undefined) delete claims.cnf;
    else claims.cnf = cnf;
    assert.throws(
      () => check(resignAssertion(valid, pair.privateKey, claims)),
      (e) => e.code === "INVALID_ASSERTION" && e.status === 401,
    );
  }
});
test("signed malformed JWT objects, duplicate/unsafe members and invalid UTF-8 all reject as 401", () => {
  const c = JSON.parse(Buffer.from(valid.split(".")[1], "base64url"));
  for (const claims of [
    null,
    true,
    1,
    [],
    "null",
    JSON.stringify(c).replace('"cnf":{', '"cnf":null,"cnf":{'),
    JSON.stringify(c).replace('"x5t#S256":', '"__proto__":{},"x5t#S256":'),
    JSON.stringify(c).replace('"owner":"synthetic"', '"owner":""'),
    JSON.stringify(c).replace('"principal_epoch":1', '"principal_epoch":"1"'),
  ])
    assert.throws(
      () => check(resignAssertion(valid, pair.privateKey, claims)),
      (e) => e.status === 401,
    );
  for (const header of [
    null,
    true,
    [],
    { alg: "none", typ: "JWT", kid: "synthetic" },
    '{"alg":"none","alg":"ES256","typ":"JWT","kid":"synthetic"}',
  ])
    assert.throws(
      () => check(resignAssertion(valid, pair.privateKey, c, header)),
      (e) => e.status === 401,
    );
  assert.throws(
    () => check(valid.replace(/.$/, "=")),
    (e) => e.status === 401,
  );
  assert.throws(
    () => check("_w._w._w"),
    (e) => e.status === 401,
  );
});
test("assertion rejection preserves signature, issuer, audience, expiry and all request bindings", () => {
  const c = JSON.parse(Buffer.from(valid.split(".")[1], "base64url"));
  for (const patch of [
    { iss: "other" },
    { aud: [c.aud] },
    { exp: 1001 },
    { nbf: 999 },
    { jti: "" },
    { method: "POST" },
    { path: "/v2/memories" },
    { request_sha256: "0".repeat(64) },
    { identity_hash: 3 },
    { session_ref: null },
    { session_expires_at: 0 },
    { unexpected: true },
  ])
    assert.throws(
      () => check(resignAssertion(valid, pair.privateKey, { ...c, ...patch })),
      (e) => e.status === 401,
    );
  assert.throws(
    () =>
      check(valid, { keys: { synthetic: "invalid configured server key" } }),
    (e) => e.status !== 401,
  );
  assert.equal(check(valid).sub, c.sub);
});
