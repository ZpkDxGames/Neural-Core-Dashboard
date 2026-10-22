import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  signAssertion,
  verifyAssertion,
  canonicalTarget,
  requestDigest,
} from "../../backend/v2/private/assertions.mjs";
import { strictJSON } from "../../backend/v2/private/validation.mjs";
import { agentIntent } from "../../backend/v2/private/authority.mjs";
const pair = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }),
  context = {
    principalId: randomUUID(),
    ownerId: "synthetic-owner",
    principalEpoch: 1,
    consentEpoch: 2,
    sessionRef: "a".repeat(64),
    identityHash: "b".repeat(64),
    sessionExpiresAt: 2000,
  };
const base = {
  key: pair.privateKey,
  kid: "synthetic-key",
  context,
  method: "POST",
  target: "/v2/private/review-challenges",
  body: Buffer.from('{"decision":"verify"}'),
  thumbprint: "c".repeat(64),
  now: 1000,
};
const check = (token, extra = {}) =>
  verifyAssertion({
    token,
    keys: { "synthetic-key": pair.publicKey },
    method: base.method,
    target: base.target,
    body: base.body,
    thumbprint: base.thumbprint,
    now: 1001,
    ...extra,
  });
test("ES256 service assertions bind exact request, workload identity and <=60 second lifetime", () => {
  const token = signAssertion(base),
    c = check(token);
  assert.equal(c.sub, context.principalId);
  assert.equal(c.exp - c.iat, 45);
  for (const extra of [
    { method: "GET" },
    { target: "/v2/memories" },
    { body: Buffer.from("{}") },
    { thumbprint: "d".repeat(64) },
    { now: 1100 },
    { now: 990 },
    { keys: {} },
  ])
    assert.throws(() => check(token, extra));
  assert.throws(() => check(token.slice(0, -2) + "xx"));
  assert.throws(() => signAssertion({ ...base, ttl: 61 }));
  const bad = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  assert.throws(() => signAssertion({ ...base, key: bad.privateKey }));
});
test("canonical query preserves repeated values while rejecting path confusion and ambiguous JSON", () => {
  assert.equal(
    canonicalTarget(
      "/v2/memories/proposals?type=reference&limit=2&status=conflict&status=proposed",
    ),
    "/v2/memories/proposals?limit=2&status=conflict&status=proposed&type=reference",
  );
  for (const target of [
    "/v2/../admin",
    "/v2/%2e%2e/admin",
    "/v2/memories%2fsecret",
    "//host/v2",
    "/v2//memories",
    "/v2/memories#x",
    "/v2\\memories",
    "https://other.invalid/v2",
  ])
    assert.throws(() => canonicalTarget(target));
  for (const s of [
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    '{"a":{"x":1,"x":2}}',
    '{"__proto__":{}}',
    '{"x":1e999}',
    '{"x":1,}',
    "[]",
  ])
    assert.throws(() => strictJSON(Buffer.from(s)));
  assert.deepEqual(strictJSON(Buffer.from('{"x":["valid\\\"",3,true,null]}')), {
    x: ['valid"', 3, true, null],
  });
  assert.notEqual(
    requestDigest("POST", "/v2/memories", Buffer.from("{}")),
    requestDigest("POST", "/v2/memories", Buffer.from("{ }")),
  );
});
test("synthetic agent grants deny owner roles, privilege escalation, unscoped types and long credentials", () => {
  const good = {
    displayName: "SYNTH agent",
    role: "contributor",
    scopes: ["read", "propose", "type:reference"],
    expiresInSeconds: 3600,
    idempotencyKey: "synthetic-key",
  };
  assert.deepEqual(agentIntent(good), {
    ...good,
    scopes: [...good.scopes].sort(),
  });
  for (const patch of [
    { role: "owner" },
    { scopes: ["read", "review", "type:fact"] },
    { scopes: ["read", "propose"] },
    { scopes: ["read", "read", "type:fact"] },
    { role: "viewer" },
    { expiresInSeconds: 3601 },
    { kind: "owner" },
    { displayName: "bad\u202e" },
  ])
    assert.throws(() => agentIntent({ ...good, ...patch }));
});
