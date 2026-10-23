import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { deliveryCipher } from "../../backend/v2/private/delivery.mjs";
import { hash } from "../../backend/v2/note.mjs";
test("encrypted delivery survives restart, binds metadata, and rejects tampering or lost key without plaintext errors", () => {
  const master = randomBytes(32).toString("base64url"),
    cipher = deliveryCipher(master),
    token = "nbv2_" + randomBytes(32).toString("base64url");
  const job = {
    delivery_id: randomUUID(),
    subject_id: randomUUID(),
    owner_id: "synthetic",
    credential_hash: hash(token),
    expires_at: new Date(Date.now() + 60000),
  };
  job.sealed = cipher.seal(token, job);
  assert.equal(JSON.stringify(job).includes(token), false);
  assert.equal(
    deliveryCipher(master).open(JSON.parse(JSON.stringify(job))),
    token,
  );
  for (const patch of [
    { subject_id: randomUUID() },
    { delivery_id: randomUUID() },
    { owner_id: "other" },
    { credential_hash: "a".repeat(64) },
    { expires_at: new Date(Date.now() + 120000) },
    { sealed: { ...job.sealed, tag: "a".repeat(22) } },
    { sealed: { ...job.sealed, extra: token } },
    { sealed: null },
  ])
    assert.throws(
      () => cipher.open({ ...job, ...patch }),
      (e) =>
        e.code === "DELIVERY_KEY_UNAVAILABLE" && !e.message.includes(token),
    );
  assert.throws(
    () => deliveryCipher("x".repeat(32)).open(job),
    (e) => e.code === "DELIVERY_KEY_UNAVAILABLE",
  );
});
