import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, randomBytes, sign } from "node:crypto";
import { request } from "node:https";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { privateDatabase } from "./database.mjs";
import { syntheticCertificates } from "./certificates.mjs";
import { PrivateMemoryEngine } from "../../backend/v2/private/engine.mjs";
import {
  PrivateAuthority,
  agentIntent,
} from "../../backend/v2/private/authority.mjs";
import { createPrivateGatewayServer } from "../../backend/v2/private/gateway.mjs";
import { createPrivateTransport } from "../../backend/v2/private/transport.mjs";
import { signAssertion } from "../../backend/v2/private/assertions.mjs";
import { hash } from "../../backend/v2/note.mjs";
import { applyPrivateMigration } from "../../backend/v2/private/migrate.mjs";
import { applyDeliveryMigration } from "../../backend/v2/private/delivery-migrate.mjs";
import { FileVault } from "../../backend/v2/vault.mjs";
import { VaultWorker } from "../../backend/v2/worker.mjs";
let db,
  engine,
  authority,
  certs,
  server,
  transport,
  root,
  worker,
  owner,
  context,
  bootstrap,
  agent,
  agentToken;
const primarySessions = new Map(),
  secrets = new Map(),
  reports = [];
const signing = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  }),
  ownerId = "synthetic-owner",
  ownerToken = "nbv2_" + "x".repeat(43);
const note = () => ({
  title: "SYNTH private memory",
  body: "Synthetic inert evidence " + randomUUID(),
  type: "reference",
  tags: ["synthetic"],
  evidence: [
    { kind: "conversation", conversationId: "chatgpt:phase3", messageId: "m1" },
  ],
  relations: [],
});
const call = (method, path, body, ctx = context) =>
  transport.call(ctx, method, path, body);
async function challenge(proposal, decision = "verify") {
  const row = (
    await db.admin.query("SELECT * FROM vault_proposals WHERE proposal_id=$1", [
      proposal.proposalId,
    ])
  ).rows[0];
  const r = await call("POST", "/v2/private/review-challenges", {
    subjectId: proposal.proposalId,
    expectedRevision: row.base_revision,
    decision,
    intentSha256: row.payload_hash.trim(),
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data;
}
async function fresh(c) {
  const r = await call(
    "POST",
    "/v2/private/review-challenges/" + c.challengeId + "/fresh",
    {
      identityHash: context.identityHash,
      authTime: Math.floor(Date.now() / 1000),
    },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
}
async function proposal() {
  const r = await engine.submit(owner, { note: note() }, randomUUID());
  return r;
}
async function complete(c) {
  return call(
    "POST",
    "/v2/private/review-challenges/" + c.challengeId + "/complete",
    {},
  );
}
before(async () => {
  db = await privateDatabase();
  certs = await syntheticCertificates();
  engine = new PrivateMemoryEngine(db.pool, {
    cursorKey: "synthetic-phase3-only-cursor-key-123456",
  });
  const principalId = randomUUID(),
    sessionRef = hash("synthetic-session-family"),
    identityHash = hash("synthetic-immutable-google-owner"),
    expiresAt = Math.floor(Date.now() / 1000) * 1000 + 3600000;
  await db.admin.query(
    "INSERT INTO vault_principals(principal_id,owner_id,display_name,kind,role,scopes,token_hash) VALUES($1,$2,'SYNTH Owner','owner','owner',ARRAY['read','propose','review','delete','export'],$3)",
    [principalId, ownerId, hash(ownerToken)],
  );
  await db.admin.query(
    "INSERT INTO vault_owner_identities(identity_hash,principal_id) VALUES($1,$2)",
    [identityHash, principalId],
  );
  await db.admin.query(
    "INSERT INTO conversations(id,source_id,title,owner_id) VALUES('chatgpt:phase3','chatgpt','SYNTH source',$1)",
    [ownerId],
  );
  await db.admin.query(
    "INSERT INTO messages(conversation_id,message_id,role,body) VALUES('chatgpt:phase3','m1','user','Synthetic source evidence only')",
  );
  primarySessions.set(sessionRef, { expiresAt });
  bootstrap = {
    principalId,
    ownerId,
    sessionRef,
    identityHash,
    sessionExpiresAt: Math.floor(expiresAt / 1000),
    principalEpoch: 0,
    consentEpoch: 0,
  };
  authority = new PrivateAuthority({
    engine,
    issuerPool: db.issuerPool,
    verifyOnline: async ({ sessionRef }) =>
      primarySessions.get(sessionRef) ?? null,
    secretSink: {
      async write(v) {
        secrets.set(v.handle, v.token);
      },
    },
  });
  server = createPrivateGatewayServer({
    tls: certs.server,
    engine,
    authority,
    keys: { synthetic: signing.publicKey },
    allowedClientThumbprints: new Set([certs.client.thumbprint]),
    enabled: true,
    report: (x) => reports.push(x),
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  transport = createPrivateTransport({
    origin: "https://127.0.0.1:" + server.address().port,
    tls: certs.client,
    signingKey: signing.privateKey,
    kid: "synthetic",
    allowedServerThumbprints: new Set([certs.server.thumbprint]),
  });
  context = (await call("GET", "/v2/private/session", undefined, bootstrap))
    .body.data;
  root = await mkdtemp(join(tmpdir(), "phase3-synthetic-vault-"));
  const vault = new FileVault(root);
  await vault.initialise();
  worker = new VaultWorker(engine, vault, { retryDelayMs: 0 });
  authority.worker = worker;
});
beforeEach(async () => {
  await db.admin.query("DELETE FROM vault_private_quota");
  await db.admin.query(
    "UPDATE vault_owner_challenges SET expires_at=now()-interval '1 second' WHERE consumed_at IS NULL",
  );
});
after(async () => {
  transport?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  await certs?.close();
  await db?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

test("migration 004 rollback, checksum ledger and runtime least privilege", async () => {
  assert.equal(
    (await applyPrivateMigration(db.admin)).state,
    "already-applied",
  );
  const row = (
    await db.admin
      .query(`SELECT has_table_privilege('neuralcore_api','vault_review_grants','INSERT') AS grants,
 has_table_privilege('neuralcore_api','vault_principals','INSERT') AS provisions,
 has_table_privilege('neuralcore_api','vault_private_sessions','UPDATE') AS consents,
 has_function_privilege('neuralcore_api','vault_issue_bound_grant(uuid,text)','EXECUTE') AS issues,
 has_function_privilege('neuralcore_api','vault_apply_synthetic_agent(text,text,uuid,text,text,text[],text,timestamptz,text,text)','EXECUTE') AS admin`)
  ).rows[0];
  assert.deepEqual(row, {
    grants: false,
    provisions: false,
    consents: false,
    issues: false,
    admin: false,
  });
  const columns = (
    await db.admin.query(
      "SELECT has_column_privilege('neuralcore_api','vault_review_grants','action','UPDATE') AS alters_action,has_column_privilege('neuralcore_api','vault_review_grants','used_at','UPDATE') AS consumes",
    )
  ).rows[0];
  assert.deepEqual(columns, { alters_action: false, consumes: true });
  await db.admin.query(
    "UPDATE schema_migrations SET sha256=repeat('0',64) WHERE version=4",
  );
  await assert.rejects(() => applyPrivateMigration(db.admin), /checksum drift/);
  await db.admin.query(
    "UPDATE schema_migrations SET sha256=$1 WHERE version=4",
    [
      hash(
        await readFile(
          new URL("../../db/004_private_integration.sql", import.meta.url),
          "utf8",
        ),
      ),
    ],
  );
});
test("memory access is consent gated; owner service assertions cannot manufacture authority", async () => {
  assert.equal((await call("GET", "/v2/memories")).status, 403);
  assert.equal(
    (
      await call("GET", "/v2/private/session", undefined, {
        ...bootstrap,
        ownerId: "other-owner",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call("GET", "/v2/private/session", undefined, {
        ...bootstrap,
        identityHash: hash("wrong-owner"),
      })
    ).status,
    401,
  );
  assert.equal(
    (await call("POST", "/v2/private/consent", { granted: true }, bootstrap))
      .status,
    200,
  );
  context = (await call("GET", "/v2/private/session", undefined, bootstrap))
    .body.data;
  owner = {
    principalId: context.principalId,
    ownerId,
    credentialHash: hash(ownerToken),
    permissionEpoch: context.principalEpoch,
    authorization: {
      sessionRef: context.sessionRef,
      identityHash: context.identityHash,
      principalEpoch: context.principalEpoch,
      consentEpoch: context.consentEpoch,
    },
  };
  assert.equal((await call("GET", "/v2/memories")).status, 200);
});
test("real TLS 1.3 boundary denies absent/unpinned certificates, body mismatch and JWT replay", async () => {
  const origin = "https://127.0.0.1:" + server.address().port,
    path = "/v2/memories",
    body = Buffer.alloc(0),
    token = signAssertion({
      key: signing.privateKey,
      kid: "synthetic",
      context,
      method: "GET",
      target: path,
      body,
      thumbprint: certs.client.thumbprint,
    });
  const raw = (tls, assertion = token, target = path, version = "TLSv1.3") =>
    new Promise((resolve, reject) => {
      const req = request(
        origin + target,
        {
          ...tls,
          method: "GET",
          minVersion: version,
          maxVersion: version,
          rejectUnauthorized: true,
          headers: { authorization: "Bearer " + assertion },
        },
        (res) => {
          const chunks = [];
          res.on("data", (x) => chunks.push(x));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              body: JSON.parse(Buffer.concat(chunks)),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
  await assert.rejects(() => raw({ ca: certs.ca }));
  assert.equal((await raw(certs.other)).status, 401);
  await assert.rejects(() => raw(certs.client, token, path, "TLSv1.2"));
  assert.equal((await raw(certs.client)).status, 200);
  const replay = await raw(certs.client);
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error, "ASSERTION_REPLAY");
  assert.equal(
    (await raw(certs.client, token, "/v2/memories?q=changed")).status,
    401,
  );
  const wrongPin = createPrivateTransport({
    origin,
    tls: certs.client,
    signingKey: signing.privateKey,
    kid: "synthetic",
    allowedServerThumbprints: new Set(["0".repeat(64)]),
  });
  try {
    await assert.rejects(() => wrongPin.call(context, "GET", path));
  } finally {
    wrongPin.close();
  }
});
test("owner decision requires fresh action/revision/intent/session/epoch binding and durable acknowledgement", async () => {
  const p = await proposal(),
    c = await challenge(p);
  assert.notEqual((await complete(c)).status, 200);
  assert.equal(
    (await engine.proposals(owner)).items.find(
      (x) => x.proposal_id === p.proposalId,
    ).state,
    "proposed",
  );
  const old = await call(
    "POST",
    "/v2/private/review-challenges/" + c.challengeId + "/fresh",
    {
      identityHash: context.identityHash,
      authTime: Math.floor(Date.now() / 1000) - 121,
    },
  );
  assert.equal(old.status, 403);
  assert.equal(
    (
      await call(
        "POST",
        "/v2/private/review-challenges/" + c.challengeId + "/fresh",
        {
          identityHash: hash("wrong"),
          authTime: Math.floor(Date.now() / 1000),
        },
      )
    ).status,
    403,
  );
  await fresh(c);
  const r = await complete(c);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.state, "pending");
  await assert.rejects(
    () => engine.get(owner, p.noteId),
    (e) => e.code === "NOT_FOUND",
  );
  const again = await complete(c);
  assert.equal(again.body.data.replayed, true);
  assert.equal(again.body.data.eventId, r.body.data.eventId);
  const receipt = await call(
    "GET",
    "/v2/private/review-challenges/" + c.challengeId,
  );
  assert.equal(receipt.body.data.state, "confirmed");
  assert.equal((await worker.once()).state, "committed");
  const published = await call("GET", "/v2/memories/" + p.noteId);
  assert.equal(published.body.data.trust, "verified");
  assert.equal(
    (
      await db.admin.query(
        "SELECT count(*)::int AS n FROM vault_revisions WHERE note_id=$1",
        [p.noteId],
      )
    ).rows[0].n,
    1,
  );
});
test("one-use bound grants cannot be replayed for a different action, intent, revision, session or permission epoch", async () => {
  const p = await proposal(),
    c = await challenge(p);
  await fresh(c);
  const proof = randomBytes(32).toString("base64url");
  await db.issuerPool.query("SELECT vault_issue_bound_grant($1,$2)", [
    c.challengeId,
    hash(proof),
  ]);
  const row = (
    await db.admin.query(
      "SELECT payload_hash FROM vault_proposals WHERE proposal_id=$1",
      [p.proposalId],
    )
  ).rows[0];
  for (const [identity, opts] of [
    [owner, { action: "reject", intentHash: row.payload_hash.trim() }],
    [owner, { action: "verify", intentHash: "0".repeat(64) }],
    [
      {
        ...owner,
        authorization: {
          ...owner.authorization,
          sessionRef: hash("other-session"),
        },
      },
      { action: "verify", intentHash: row.payload_hash.trim() },
    ],
  ])
    await assert.rejects(
      () =>
        engine.tx((db) =>
          engine.consumeProof(db, identity, proof, p.proposalId, 0, opts),
        ),
      (e) => e.code === "OWNER_PROOF_INVALID",
    );
  await assert.rejects(
    () =>
      engine.review(owner, p.proposalId, {
        decision: "verify",
        expectedRevision: 1,
        proof,
      }),
    (e) => e.code === "REVISION_CONFLICT",
  );
  const ack = await engine.review(owner, p.proposalId, {
    decision: "verify",
    expectedRevision: 0,
    proof,
  });
  assert.equal(ack.state, "pending");
  await worker.once();
  await assert.rejects(
    () =>
      engine.tx((db) =>
        engine.consumeProof(db, owner, proof, p.proposalId, 0, {
          action: "verify",
          intentHash: row.payload_hash.trim(),
        }),
      ),
    (e) => e.code === "OWNER_PROOF_INVALID",
  );
});
test("consent revocation cancels old epochs, outstanding grants and stale decisions; primary session outage fails closed", async () => {
  const p = await proposal(),
    c = await challenge(p);
  await fresh(c);
  const old = { ...context };
  assert.equal(
    (await call("POST", "/v2/private/consent", { granted: false }, bootstrap))
      .status,
    200,
  );
  assert.equal((await complete(c)).status, 403);
  assert.equal((await call("GET", "/v2/memories", undefined, old)).status, 403);
  await call("POST", "/v2/private/consent", { granted: true }, bootstrap);
  context = (await call("GET", "/v2/private/session", undefined, bootstrap))
    .body.data;
  owner.authorization.consentEpoch = context.consentEpoch;
  assert.equal((await complete(c)).status, 403);
  const original = authority.verifyOnline;
  authority.verifyOnline = async () => {
    throw Error("Synthetic primary storage outage");
  };
  try {
    assert.equal((await call("GET", "/v2/memories")).status, 503);
  } finally {
    authority.verifyOnline = original;
  }
  const saved = primarySessions.get(context.sessionRef);
  primarySessions.delete(context.sessionRef);
  assert.equal((await call("GET", "/v2/memories")).status, 401);
  primarySessions.set(context.sessionRef, saved);
});
test("concurrent review completion returns one durable receipt and uncertain acknowledgement can be queried", async () => {
  const p = await proposal(),
    c = await challenge(p);
  await fresh(c);
  const results = await Promise.all([complete(c), complete(c)]);
  assert.ok(
    results.every((x) => x.status === 200),
    JSON.stringify(results),
  );
  assert.equal(results[0].body.data.eventId, results[1].body.data.eventId);
  assert.equal(results.filter((x) => !x.body.data.replayed).length, 1);
  assert.equal(
    (await call("GET", "/v2/private/review-challenges/" + c.challengeId)).body
      .data.receipt.state,
    "pending",
  );
  await worker.once();
});
test("review rollback does not consume proof or receipt after an evidence failure", async () => {
  const p = await proposal(),
    c = await challenge(p);
  await fresh(c);
  await db.admin.query(
    "UPDATE messages SET body='' WHERE conversation_id='chatgpt:phase3'",
  );
  // Force a real SQL failure after grant insertion without weakening evidence assertions.
  const prior = engine.validateEvidence;
  const original = PrivateMemoryEngine.prototype.validateEvidence;
  PrivateMemoryEngine.prototype.validateEvidence = async () => {
    throw Error("SYNTHETIC_PUBLICATION_FAILURE");
  };
  try {
    assert.equal((await complete(c)).status, 503);
  } finally {
    PrivateMemoryEngine.prototype.validateEvidence = original;
    engine.validateEvidence = prior;
  }
  const row = (
    await db.admin.query(
      "SELECT consumed_at,receipt FROM vault_owner_challenges WHERE challenge_id=$1",
      [c.challengeId],
    )
  ).rows[0];
  assert.equal(row.receipt, null);
  assert.equal(row.consumed_at, null);
  await db.admin.query(
    "UPDATE messages SET body='Synthetic source evidence only' WHERE conversation_id='chatgpt:phase3'",
  );
  assert.equal((await complete(c)).status, 200);
  await worker.once();
});
test("scoped synthetic provisioning, secret-delivery rollback, idempotent retry, expiry, rotation and revocation", async () => {
  const principalId = randomUUID(),
    intent = agentIntent({
      displayName: "SYNTH controlled agent",
      role: "contributor",
      scopes: ["read", "propose", "type:reference"],
      expiresInSeconds: 3600,
      idempotencyKey: "synthetic-provision-only",
    });
  const result = await call("POST", "/v2/private/review-challenges", {
    subjectId: principalId,
    expectedRevision: 0,
    decision: "provision-agent",
    intentSha256: hash(JSON.stringify(intent)),
    permissionRequest: intent,
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const c = result.body.data;
  await fresh(c);
  const original = authority.secretSink;
  authority.secretSink = {
    async write() {
      throw Error("Synthetic sink failure");
    },
  };
  try {
    assert.equal((await complete(c)).status, 503);
  } finally {
    authority.secretSink = original;
  }
  assert.equal(
    (
      await db.admin.query(
        "SELECT 1 FROM vault_principals WHERE principal_id=$1",
        [principalId],
      )
    ).rows.length,
    0,
  );
  const done = await complete(c);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.data.state, "provisioned");
  assert.equal(JSON.stringify(done.body).includes("nbv2_"), false);
  agentToken = secrets.get(done.body.data.credentialHandle);
  agent = await engine.authenticate(agentToken);
  assert.equal(agent.role, "contributor");
  assert.equal((await complete(c)).body.data.replayed, true);
  const p = await engine.submit(agent, { note: note() }, randomUUID());
  await assert.rejects(
    () =>
      engine.review({ ...agent, role: "owner", kind: "owner" }, p.proposalId, {
        decision: "verify",
        expectedRevision: 0,
        proof: "x".repeat(43),
      }),
    (e) => e.code === "ROLE_FORBIDDEN",
  );
  await assert.rejects(
    () =>
      engine.submit(
        agent,
        { note: { ...note(), type: "project" } },
        randomUUID(),
      ),
    (e) => e.code === "ROLE_FORBIDDEN",
  );
  const { createServer } = await import("node:http"),
    { makeV2Handler } = await import("../../backend/v2/api.mjs");
  const machine = createServer(makeV2Handler({ engine, enabled: true }));
  await new Promise((r) => machine.listen(0, "127.0.0.1", r));
  try {
    const url = "http://127.0.0.1:" + machine.address().port + "/v2/memories";
    assert.equal(
      (await fetch(url, { headers: { authorization: "Bearer " + agentToken } }))
        .status,
      200,
    );
    assert.equal(
      (
        await fetch(url + "/proposals", {
          method: "POST",
          headers: {
            authorization: "Bearer " + agentToken,
            "content-type": "application/json",
            "idempotency-key": "synthetic-machine-proposal",
          },
          body: JSON.stringify({ note: note() }),
        })
      ).status,
      201,
    );
  } finally {
    machine.closeAllConnections();
    await new Promise((r) => machine.close(r));
  }
  await db.admin.query(
    "UPDATE vault_principals SET role='viewer',scopes=ARRAY['read','type:reference'] WHERE principal_id=$1",
    [principalId],
  );
  await assert.rejects(
    () => engine.list(agent),
    (e) => e.code === "UNAUTHORIZED",
  );
  const viewer = await engine.authenticate(agentToken);
  await assert.rejects(
    () => engine.submit(viewer, { note: note() }, randomUUID()),
    (e) => e.code === "ROLE_FORBIDDEN",
  );
  await db.admin.query(
    "UPDATE vault_principals SET role='contributor',scopes=ARRAY['read','propose','type:reference'] WHERE principal_id=$1",
    [principalId],
  );
  await db.admin.query(
    "UPDATE vault_principals SET credential_expires_at=now()-interval '1 second' WHERE principal_id=$1",
    [principalId],
  );
  await assert.rejects(
    () => engine.authenticate(agentToken),
    (e) => e.code === "UNAUTHORIZED",
  );
  await db.admin.query(
    "UPDATE vault_principals SET credential_expires_at=now()+interval '1 hour' WHERE principal_id=$1",
    [principalId],
  );
  await db.admin.query("UPDATE vault_principals SET scopes=ARRAY['propose','type:reference'] WHERE principal_id=$1",[principalId]);
  const proposerOnly=await engine.authenticate(agentToken);
  await assert.rejects(()=>engine.list(proposerOnly),e=>e.code==='ROLE_FORBIDDEN');
  assert.equal((await engine.submit(proposerOnly,{note:note()},randomUUID())).state,'proposed');
  await db.admin.query("UPDATE vault_principals SET scopes=ARRAY['read','propose','type:reference'] WHERE principal_id=$1",[principalId]);
  for (const decision of ["rotate-agent", "revoke-agent"]) {
    const priorCursor =
      decision === "rotate-agent"
        ? (
            await engine.list(await engine.authenticate(agentToken), {
              limit: 1,
            })
          ).nextCursor
        : null;
    const epoch = (
        await db.admin.query(
          "SELECT permission_epoch FROM vault_principals WHERE principal_id=$1",
          [principalId],
        )
      ).rows[0].permission_epoch,
      intent = {
        principalId,
        permissionEpoch: epoch,
        ...(decision === "rotate-agent" ? { expiresInSeconds: 300 } : {}),
      };
    const r = await call("POST", "/v2/private/review-challenges", {
      subjectId: principalId,
      expectedRevision: epoch,
      decision,
      intentSha256: hash(JSON.stringify(intent)),
      permissionRequest: intent,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await fresh(r.body.data);
    assert.equal((await complete(r.body.data)).status, 200);
    await assert.rejects(
      () => engine.list(agent),
      (e) => e.code === "UNAUTHORIZED",
    );
    if (decision === "rotate-agent") {
      await assert.rejects(
        () => engine.authenticate(agentToken),
        (e) => e.code === "UNAUTHORIZED",
      );
      agentToken = secrets.get(done.body.data.credentialHandle);
      agent = await engine.authenticate(agentToken);
      assert.ok(priorCursor);
      await assert.rejects(
        () => engine.list(agent, { limit: 1, cursor: priorCursor }),
        (e) => e.code === "INVALID_CURSOR",
      );
    }
  }
  await assert.rejects(
    () => engine.authenticate(agentToken),
    (e) => e.code === "UNAUTHORIZED",
  );
  assert.equal(
    (
      await db.admin.query(
        "SELECT state FROM vault_proposals WHERE proposal_id=$1",
        [p.proposalId],
      )
    ).rows[0].state,
    "proposed",
  );
});
test("strict query validation, per-principal quotas and redacted gateway errors", async () => {
  for (const target of [
    "/v2/memories?limit=1&limit=2",
    "/v2/memories?unexpected=1",
    "/v2/memories/proposals?role=owner",
    "/v2/graph?depth=9",
  ])
    assert.equal((await call("GET", target)).status, 400);
  await db.admin.query("DELETE FROM vault_private_quota");
  await db.admin.query(
    "INSERT INTO vault_private_quota(principal_id,minute,count) VALUES($1,$2,60)",
    [context.principalId, Math.floor(Date.now() / 60000)],
  );
  assert.equal((await call("GET", "/v2/memories")).status, 429);
  await db.admin.query("DELETE FROM vault_private_quota");
  assert.equal(JSON.stringify(reports).includes(ownerToken), false);
  assert.equal(
    JSON.stringify(reports).includes("Synthetic inert evidence"),
    false,
  );
  assert.equal(
    reports.every((x) => Object.keys(x).sort().join(",") === "action,outcome"),
    true,
  );
});

test("complete synthetic browser BFF → mTLS gateway → signed Google step-up → PostgreSQL/outbox/vault journey", async () => {
  const { ownerController } = await import("../../lib/auth/owner-core.ts"),
    { ownerAccess } = await import("../../lib/auth/owner-access.ts"),
    { createPrivateBff } = await import("../../lib/brain/private/bff.ts"),
    { createGoogleProvider } = await import("../../lib/auth/owner-runtime.ts");
  const {
    config,
    origin,
    memoryStore,
    provider,
    login,
    cookie,
    request: authRequest,
  } = await import("../helpers/owner-fixture.mjs");
  const { sign } = await import("node:crypto"),
    authStore = memoryStore(),
    controller = ownerController({ config, store: authStore, provider }),
    signed = await login(controller),
    access = ownerAccess(config, authStore),
    pid = randomUUID(),
    oid = "synthetic-bff-owner";
  await db.admin.query(
    "INSERT INTO vault_principals(principal_id,owner_id,display_name,kind,role,scopes,token_hash) VALUES($1,$2,'SYNTH BFF Owner','owner','owner',ARRAY['read','propose','review','delete','export'],$3)",
    [pid, oid, hash("nbv2_" + "z".repeat(43))],
  );
  const req = (path, method = "GET", body, extra = {}) =>
    new Request(origin + "/api/brain/v2/" + path, {
      method,
      headers: {
        cookie: signed.cookie,
        ...(method === "POST"
          ? {
              origin,
              "x-ncore-csrf": signed.body.csrf,
              "content-type": "application/json",
            }
          : {}),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const authorized = await access.read(req("capability"));
  await db.admin.query(
    "INSERT INTO vault_owner_identities(identity_hash,principal_id) VALUES($1,$2)",
    [authorized.identityHash, pid],
  );
  const previousValidator = authority.verifyOnline;
  authority.verifyOnline = async (value) =>
    value.sessionRef === authorized.sessionRef
      ? access.verifyFamily(value)
      : previousValidator(value);
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 }),
    jwk = {
      ...pair.publicKey.export({ format: "jwk" }),
      kid: "synthetic-e2e",
      alg: "RS256",
      use: "sig",
    };
  let nonce;
  const google = createGoogleProvider(
    config,
    async (url, init) => {
      if (String(url).includes("/.well-known/"))
        return Response.json({
          issuer: "https://accounts.google.com",
          authorization_endpoint:
            "https://accounts.google.com/o/oauth2/v2/auth",
          token_endpoint: "https://oauth2.googleapis.com/token",
          jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: [
            "client_secret_post",
            "client_secret_basic",
          ],
        });
      if (String(url).includes("/certs")) return Response.json({ keys: [jwk] });
      assert.equal(
        new URLSearchParams(init.body).get("grant_type"),
        "authorization_code",
      );
      const now = Math.floor(Date.now() / 1000),
        h = Buffer.from(
          JSON.stringify({ alg: "RS256", kid: jwk.kid }),
        ).toString("base64url"),
        p = Buffer.from(
          JSON.stringify({
            iss: "https://accounts.google.com",
            aud: config.clientId,
            sub: config.ownerSub,
            nonce,
            iat: now,
            auth_time: now,
            exp: now + 300,
            email_verified: true,
          }),
        ).toString("base64url");
      return Response.json({
        access_token: "synthetic-e2e-access",
        token_type: "Bearer",
        expires_in: 300,
        id_token:
          h +
          "." +
          p +
          "." +
          sign(
            "RSA-SHA256",
            Buffer.from(h + "." + p),
            pair.privateKey,
          ).toString("base64url"),
      });
    },
    true,
  );
  const bff = createPrivateBff({
    access,
    transport,
    identity: { principalId: pid, ownerId: oid },
    store: authStore,
    provider: google,
    stepUpQualified: true,
    origin,
  });
  try {
    assert.equal((await bff(req("notes"))).status, 403);
    assert.equal(
      (await bff(req("consent", "POST", { granted: true }))).status,
      200,
    );
    const submitted = await bff(
      req("proposals", "POST", {
        idempotencyKey: "synthetic-bff-proposal",
        note: {
          ...note(),
          evidence: [
            { kind: "manual", reason: "Synthetic owner-authored fixture" },
          ],
        },
      }),
    );
    assert.equal(submitted.status, 200, await submitted.clone().text());
    const proposed = (await submitted.json()).data;
    const queue = await bff(req("proposals?limit=25"));
    assert.equal(queue.status, 200);
    const row = (await queue.json()).data.items[0];
    assert.equal(row.proposal_id, proposed.proposalId);
    assert.equal(row.author.kind, "owner");
    const challengeResponse = await bff(
      req("review-challenges", "POST", {
        subjectId: row.proposal_id,
        expectedRevision: 0,
        decision: "verify",
        intentSha256: row.payload_hash,
      }),
    );
    assert.equal(
      challengeResponse.status,
      200,
      await challengeResponse.clone().text(),
    );
    const c = (await challengeResponse.json()).data;
    const start = await bff(
      req("review-challenges/" + c.challengeId + "/start", "POST", {}),
    );
    assert.equal(start.status, 200, await start.clone().text());
    const url = new URL((await start.json()).data.authorizationUrl);
    assert.equal(url.searchParams.get("max_age"), "0");
    nonce = url.searchParams.get("nonce");
    const done = await bff(
      req(
        "step-up/callback?state=" +
          url.searchParams.get("state") +
          "&code=synthetic-code",
        "GET",
        undefined,
        {
          cookie:
            signed.cookie + "; " + cookie(start, "__Host-nc-memory-stepup"),
        },
      ),
    );
    assert.equal(done.status, 303);
    assert.match(
      done.headers.get("location"),
      new RegExp("/agents\\?review=" + c.challengeId + "$"),
    );
    const preview = await bff(req("review-challenges/" + c.challengeId));
    assert.equal(
      (await preview.json()).data.preview.title,
      "SYNTH private memory",
    );
    const ack = await bff(
      req("review-challenges/" + c.challengeId + "/complete", "POST", {}),
    );
    assert.equal(ack.status, 200, await ack.clone().text());
    assert.equal((await ack.json()).data.state, "pending");
    assert.equal((await bff(req("notes/" + proposed.noteId))).status, 404);
    await worker.once();
    const published = await bff(req("notes/" + proposed.noteId));
    assert.equal(published.status, 200);
    assert.equal((await published.json()).data.trust, "verified");
    const logout = await controller.logout(
      authRequest("logout", "POST", {
        cookie: signed.cookie,
        origin,
        "x-ncore-csrf": signed.body.csrf,
      }),
    );
    assert.equal(logout.status, 200);
    assert.equal((await bff(req("notes"))).status, 401);
  } finally {
    authority.verifyOnline = previousValidator;
  }
});

test("lost completion response is recovered from a durable receipt; expired challenge cannot issue a grant", async () => {
  const p = await proposal(),
    c = await challenge(p);
  await fresh(c);
  const original = authority.complete.bind(authority);
  authority.complete = async (...args) => {
    await original(...args);
    throw Error("Synthetic lost acknowledgement");
  };
  try {
    assert.equal((await complete(c)).status, 503);
  } finally {
    authority.complete = original;
  }
  const recovered = await call(
    "GET",
    "/v2/private/review-challenges/" + c.challengeId,
  );
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.data.receipt.state, "pending");
  await db.admin.query(
    "UPDATE vault_owner_challenges SET expires_at=now()-interval '1 second' WHERE challenge_id=$1",
    [c.challengeId],
  );
  assert.equal((await complete(c)).body.data.replayed, true);
  await worker.once();
  const expired = await challenge(await proposal());
  await db.admin.query(
    "UPDATE vault_owner_challenges SET expires_at=now()-interval '1 second' WHERE challenge_id=$1",
    [expired.challengeId],
  );
  assert.equal((await complete(expired)).status, 403);
});

test("request deadline rolls back SQL and expired grants cannot promote a proposal", async () => {
  const { privateRequestScope } =
    await import("../../backend/v2/private/deadline.mjs");
  const target = randomUUID();
  await assert.rejects(
    () =>
      privateRequestScope.run({ deadlineAt: Date.now() + 5000 }, () =>
        engine.tx(async (client) => {
          await client.query(
            "INSERT INTO vault_actions(action_id,owner_id,principal_id,action,target_id,outcome) VALUES($1,$2,$3,'synthetic-deadline',$4,'pending')",
            [randomUUID(), ownerId, context.principalId, target],
          );
          privateRequestScope.getStore().deadlineAt = Date.now() - 1;
        }),
      ),
    (e) => e.code === "PRIVATE_REQUEST_TIMEOUT",
  );
  assert.equal(
    (
      await db.admin.query("SELECT 1 FROM vault_actions WHERE target_id=$1", [
        target,
      ])
    ).rows.length,
    0,
  );
  const proposed = await proposal(),
    c = await challenge(proposed);
  await fresh(c);
  const proof = randomBytes(32).toString("base64url");
  await db.issuerPool.query("SELECT vault_issue_bound_grant($1,$2)", [
    c.challengeId,
    hash(proof),
  ]);
  await db.admin.query(
    "UPDATE vault_review_grants SET issued_at=now()-interval '120 seconds',expires_at=now()-interval '61 seconds' WHERE proof_hash=$1",
    [hash(proof)],
  );
  await assert.rejects(
    () =>
      engine.review(owner, proposed.proposalId, {
        decision: "verify",
        expectedRevision: 0,
        proof,
      }),
    (e) => e.code === "OWNER_PROOF_INVALID",
  );
  assert.equal(
    (
      await db.admin.query(
        "SELECT state FROM vault_proposals WHERE proposal_id=$1",
        [proposed.proposalId],
      )
    ).rows[0].state,
    "proposed",
  );
});

test("fresh action-specific deletion, consolidation and interrupted-publication repair preserve V2 capabilities under 004", async () => {
  const publish = async () => {
    const p = await proposal(),
      c = await challenge(p);
    await fresh(c);
    const r = await complete(c);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await worker.once();
    return { ...p, revision: 1 };
  };
  const target = await publish(),
    source = await publish();
  const decide = async (action, subjectId, revision, intent) => {
    const r = await call("POST", "/v2/private/review-challenges", {
      subjectId,
      expectedRevision: revision,
      decision: action,
      intentSha256: hash(JSON.stringify(intent)),
      permissionRequest: intent,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await fresh(r.body.data);
    const ack = await complete(r.body.data);
    assert.equal(ack.status, 200, JSON.stringify(ack.body));
    return ack;
  };
  const consolidated = await decide("consolidate", source.noteId, 1, {
    noteId: source.noteId,
    expectedRevision: 1,
    consolidateInto: target.noteId,
  });
  assert.equal(consolidated.body.data.state, "pending");
  await worker.once();
  await assert.rejects(
    () => engine.get(owner, source.noteId),
    (e) => e.code === "NOT_FOUND",
  );
  assert.equal((await engine.get(owner, target.noteId)).revision, 1);
  const p = await engine.submit(
      owner,
      { noteId: target.noteId, baseRevision: 1, note: note() },
      randomUUID(),
    ),
    c = await challenge(p);
  await fresh(c);
  const pending = await complete(c);
  assert.equal(pending.status, 200);
  await rm(join(await worker.vault.directory(ownerId), target.noteId + ".md"));
  assert.equal((await worker.once()).state, "conflict");
  const event = (
    await db.admin.query("SELECT * FROM vault_outbox WHERE event_id=$1", [
      pending.body.data.eventId,
    ])
  ).rows[0];
  await decide("repair", event.event_id, 2, {
    eventId: event.event_id,
    expectedRevision: 2,
    expectedHash: event.expected_hash?.trim() ?? null,
  });
  assert.equal((await worker.once()).state, "committed");
  assert.equal((await engine.get(owner, target.noteId)).revision, 2);
  const deleted = await decide("delete", target.noteId, 2, {
    noteId: target.noteId,
    expectedRevision: 2,
    consolidateInto: null,
  });
  assert.equal(deleted.body.data.tombstoned, true);
  await worker.once();
  await assert.rejects(
    () => engine.get(owner, target.noteId),
    (e) => e.code === "NOT_FOUND",
  );
});

// Phase 3.1 additions. Every original test/assertion above is preserved.
function fencedSink() {
  const handles = new Map(),
    deliveries = new Map(),
    writes = [];
  return {
    handles,
    deliveries,
    writes,
    async write(v) {
      const prior = deliveries.get(v.deliveryId);
      if (prior && prior !== hash(v.token))
        throw Error("SYNTHETIC_DELIVERY_CONFLICT");
      deliveries.set(v.deliveryId, hash(v.token));
      const current = handles.get(v.handle);
      if (!current || BigInt(current.generation) <= BigInt(v.generation))
        handles.set(v.handle, { ...v });
      writes.push({ ...v });
    },
  };
}
async function hardeningFixture() {
  const principalId = randomUUID(),
    ownerId = "synthetic-hardening-" + randomUUID(),
    sessionRef = hash(randomUUID()),
    identityHash = hash(randomUUID()),
    sessionExpiresAt = Math.floor(Date.now() / 1000) + 3600,
    sink = fencedSink();
  await db.admin.query(
    "INSERT INTO vault_principals(principal_id,owner_id,display_name,kind,role,scopes,token_hash) VALUES($1,$2,'SYNTH hardening owner','owner','owner',ARRAY['read','propose','review','delete','export'],$3)",
    [principalId, ownerId, hash(randomUUID())],
  );
  await db.admin.query("INSERT INTO vault_owner_identities VALUES($1,$2)", [
    identityHash,
    principalId,
  ]);
  primarySessions.set(sessionRef, { expiresAt: sessionExpiresAt * 1000 });
  const a = new PrivateAuthority({
    engine,
    issuerPool: db.issuerPool,
    secretSink: sink,
    verifyOnline: async ({ sessionRef }) =>
      primarySessions.get(sessionRef) ?? null,
  });
  const claims = {
    sub: principalId,
    owner: ownerId,
    identity_hash: identityHash,
    session_ref: sessionRef,
    session_expires_at: sessionExpiresAt,
    principal_epoch: 0,
    consent_epoch: 0,
  };
  const initial = await a.resolve(claims, { bootstrap: true });
  await a.consent(initial, true);
  const p = await a.resolve({
    ...claims,
    principal_epoch: 1,
    consent_epoch: 2,
  });
  return { a, p, sink, subject: randomUUID() };
}
async function agentChallenge(f, action = "provision-agent", patch = {}) {
  const epoch =
    action === "provision-agent"
      ? 0
      : (
          await db.admin.query(
            "SELECT permission_epoch FROM vault_principals WHERE principal_id=$1",
            [f.subject],
          )
        ).rows[0].permission_epoch;
  const intent =
    action === "provision-agent"
      ? agentIntent({
          displayName: "SYNTH hardening agent",
          role: "contributor",
          scopes: ["read", "propose", "type:reference"],
          expiresInSeconds: 300,
          idempotencyKey: randomUUID(),
          ...patch,
        })
      : {
          principalId: f.subject,
          permissionEpoch: epoch,
          ...(action === "rotate-agent" ? { expiresInSeconds: 120 } : {}),
          ...patch,
        };
  const input = {
    subjectId: f.subject,
    expectedRevision: epoch,
    decision: action,
    intentSha256: hash(JSON.stringify(intent)),
    permissionRequest: intent,
  };
  const c = await f.a.challenge(f.p, input);
  await f.a.fresh(f.p, c.challengeId, {
    identityHash: f.p.authorization.identityHash,
    authTime: Math.floor(Date.now() / 1000),
  });
  return { ...c, input };
}
const deliveryRow = async (id) =>
  (
    await db.admin.query(
      "SELECT * FROM vault_agent_deliveries WHERE delivery_id=$1",
      [id],
    )
  ).rows[0];
const principalRows = async (f) =>
  (
    await db.admin.query(
      "SELECT * FROM vault_principals WHERE principal_id=$1",
      [f.subject],
    )
  ).rows;
function failTransaction(pool, stage, afterCommit = false, sqlFailure = false) {
  let armed = true;
  return {
    async connect() {
      const c = await pool.connect();
      let matches = false;
      return {
        async query(sql, args) {
          if (
            (stage === "prepare" &&
              sql.startsWith("INSERT INTO vault_agent_deliveries")) ||
            (stage === "activate" &&
              sql.startsWith("SELECT vault_apply_synthetic_agent"))
          ) {
            matches = true;
            if (sqlFailure && armed) {
              armed = false;
              throw Error("SYNTHETIC_SQL_FAILURE");
            }
          }
          if (sql === "COMMIT" && matches && armed) {
            armed = false;
            if (afterCommit) await c.query(sql, args);
            throw Error(
              afterCommit
                ? "SYNTHETIC_LOST_COMMIT_ACK"
                : "SYNTHETIC_COMMIT_FAILURE",
            );
          }
          return c.query(sql, args);
        },
        release: (e) => c.release(e),
      };
    },
  };
}
test("005 migration ledger rollback, checksum and new custody fields preserve least privilege", async () => {
  assert.equal(
    (await applyDeliveryMigration(db.admin)).state,
    "already-applied",
  );
  const privileges = (
    await db.admin.query(`SELECT
    has_table_privilege('neuralcore_api','vault_agent_deliveries','SELECT') AS reads,
    has_table_privilege('neuralcore_api','vault_agent_deliveries','INSERT') AS inserts,
    has_column_privilege('neuralcore_issuer','vault_agent_deliveries','credential_hash','UPDATE') AS rewrites,
    has_column_privilege('neuralcore_issuer','vault_agent_deliveries','sealed','UPDATE') AS erases,
    has_table_privilege('neuralcore_issuer','vault_principals','UPDATE') AS elevates,
    has_table_privilege('neuralcore_issuer','vault_review_grants','INSERT') AS mints`)
  ).rows[0];
  assert.deepEqual(privileges, {
    reads: false,
    inserts: false,
    rewrites: false,
    erases: true,
    elevates: false,
    mints: false,
  });
  await assert.rejects(
    () => db.pool.query("SELECT sealed FROM vault_agent_deliveries"),
    /permission denied/,
  );
  await db.admin.query(
    "UPDATE schema_migrations SET sha256=repeat('0',64) WHERE version=5",
  );
  await assert.rejects(
    () => applyDeliveryMigration(db.admin),
    /checksum drift/,
  );
  await db.admin.query(
    "UPDATE schema_migrations SET sha256=$1 WHERE version=5",
    [
      hash(
        await readFile(
          new URL("../../db/005_agent_delivery.sql", import.meta.url),
          "utf8",
        ),
      ),
    ],
  );
});
test("delivery-intent COMMIT failure performs no sink write and creates no authority", async () => {
  const f = await hardeningFixture(),
    c = await agentChallenge(f);
  f.a.issuerPool = failTransaction(db.issuerPool, "prepare");
  await assert.rejects(
    () => f.a.complete(f.p, c.challengeId),
    /SYNTHETIC_COMMIT_FAILURE/,
  );
  assert.equal(f.sink.writes.length, 0);
  assert.equal((await principalRows(f)).length, 0);
  assert.equal(await deliveryRow(c.challengeId), undefined);
  f.a.issuerPool = db.issuerPool;
  assert.equal((await f.a.complete(f.p, c.challengeId)).state, "provisioned");
});
test("sink success followed by SQL COMMIT failure leaves only an inactive recoverable encrypted intent", async () => {
  const f = await hardeningFixture(),
    c = await agentChallenge(f);
  f.a.issuerPool = failTransaction(db.issuerPool, "activate");
  await assert.rejects(
    () => f.a.complete(f.p, c.challengeId),
    /SYNTHETIC_COMMIT_FAILURE/,
  );
  assert.equal(f.sink.writes.length, 1);
  const token = f.sink.writes[0].token;
  await assert.rejects(
    () => engine.authenticate(token),
    (e) => e.status === 401,
  );
  assert.equal((await principalRows(f)).length, 0);
  const pending = await deliveryRow(c.challengeId);
  assert.equal(pending.state, "pending");
  assert.equal(pending.last_outcome, "ACTIVATION_UNCONFIRMED");
  assert.ok(pending.sealed);
  assert.equal(JSON.stringify(pending).includes(token), false);
  const grant = (
    await db.admin.query(
      "SELECT receipt,consumed_at FROM vault_owner_challenges WHERE challenge_id=$1",
      [c.challengeId],
    )
  ).rows[0];
  assert.deepEqual(grant, { receipt: null, consumed_at: null });
  // A new process instance reuses the same injected key, ciphertext, handle and token.
  const restarted = new PrivateAuthority({
    engine,
    issuerPool: db.issuerPool,
    secretSink: f.sink,
    verifyOnline: f.a.verifyOnline,
  });
  assert.equal(
    (await restarted.complete(f.p, c.challengeId)).state,
    "provisioned",
  );
  assert.equal(f.sink.writes[1].token, token);
  assert.equal(f.sink.deliveries.size, 1);
  assert.equal((await principalRows(f)).length, 1);
  assert.equal((await engine.authenticate(token)).principalId, f.subject);
  assert.equal((await deliveryRow(c.challengeId)).sealed, null);
});
test("SQL activation statement failure after sink success rolls back grant and never authorizes the delivered token", async () => {
  const f = await hardeningFixture(),
    c = await agentChallenge(f);
  f.a.issuerPool = failTransaction(db.issuerPool, "activate", false, true);
  await assert.rejects(
    () => f.a.complete(f.p, c.challengeId),
    /SYNTHETIC_SQL_FAILURE/,
  );
  await assert.rejects(
    () => engine.authenticate(f.sink.writes[0].token),
    (e) => e.status === 401,
  );
  assert.equal((await principalRows(f)).length, 0);
  f.a.issuerPool = db.issuerPool;
  assert.equal((await f.a.complete(f.p, c.challengeId)).state, "provisioned");
});
test("lost intent commit acknowledgment retries one delivery record without duplicate authority", async () => {
  const f = await hardeningFixture(),
    c = await agentChallenge(f);
  f.a.issuerPool = failTransaction(db.issuerPool, "prepare", true);
  await assert.rejects(
    () => f.a.complete(f.p, c.challengeId),
    /SYNTHETIC_LOST_COMMIT_ACK/,
  );
  assert.equal(f.sink.writes.length, 0);
  assert.ok((await deliveryRow(c.challengeId)).sealed);
  f.a.issuerPool = db.issuerPool;
  assert.equal((await f.a.complete(f.p, c.challengeId)).state, "provisioned");
  assert.equal(f.sink.deliveries.size, 1);
  assert.equal((await principalRows(f)).length, 1);
});
test("lost activation commit acknowledgment recovers its receipt without redelivery or duplicate grants", async () => {
  const f = await hardeningFixture(),
    c = await agentChallenge(f);
  f.a.issuerPool = failTransaction(db.issuerPool, "activate", true);
  await assert.rejects(
    () => f.a.complete(f.p, c.challengeId),
    /SYNTHETIC_LOST_COMMIT_ACK/,
  );
  f.a.issuerPool = db.issuerPool;
  assert.equal((await f.a.complete(f.p, c.challengeId)).replayed, true);
  assert.equal(f.sink.writes.length, 1);
  assert.equal((await principalRows(f)).length, 1);
  assert.equal((await deliveryRow(c.challengeId)).sealed, null);
  assert.equal(
    (
      await db.admin.query(
        "SELECT count(*)::int AS n FROM vault_review_grants WHERE subject_id=$1 AND used_at IS NOT NULL",
        [f.subject],
      )
    ).rows[0].n,
    1,
  );
});
test("lost sink acknowledgment replays identical secret and delivery identity before activation", async () => {
  const f = await hardeningFixture(),
    c = await agentChallenge(f),
    sink = f.sink;
  f.a.secretSink = {
    async write(v) {
      await sink.write(v);
      throw Error("SYNTHETIC_LOST_SINK_ACK " + v.token);
    },
  };
  await assert.rejects(
    () => f.a.complete(f.p, c.challengeId),
    (e) =>
      e.code === "SECRET_DELIVERY_UNAVAILABLE" && !e.message.includes("nbv2_"),
  );
  await assert.rejects(
    () => engine.authenticate(sink.writes[0].token),
    (e) => e.status === 401,
  );
  f.a.secretSink = sink;
  await f.a.complete(f.p, c.challengeId);
  assert.equal(sink.writes[0].token, sink.writes[1].token);
  assert.equal(sink.writes[0].deliveryId, sink.writes[1].deliveryId);
  assert.equal((await deliveryRow(c.challengeId)).attempts, 2);
});
test("delivery timeout, retry and a late old write remain idempotent and generation fenced across rotation", async () => {
  const f = await hardeningFixture(),
    c = await agentChallenge(f),
    sink = f.sink;
  let late, captured;
  f.a.secretSink = {
    write(v) {
      captured = v;
      return new Promise((r) => {
        late = async () => {
          await sink.write(v);
          r();
        };
      });
    },
  };
  await assert.rejects(
    () => f.a.complete(f.p, c.challengeId),
    (e) => e.code === "SECRET_DELIVERY_UNAVAILABLE",
  );
  assert.equal(captured.signal.aborted, true);
  await assert.rejects(
    () => engine.authenticate(captured.token),
    (e) => e.status === 401,
  );
  f.a.secretSink = sink;
  const first = await f.a.complete(f.p, c.challengeId),
    rotate = await agentChallenge(f, "rotate-agent");
  await f.a.complete(f.p, rotate.challengeId);
  const current = sink.handles.get(first.credentialHandle).token;
  await late();
  assert.equal(sink.handles.get(first.credentialHandle).token, current);
  assert.equal((await engine.authenticate(current)).principalId, f.subject);
  await assert.rejects(
    () => engine.authenticate(captured.token),
    (e) => e.status === 401,
  );
});
test("concurrent duplicate provisioning and request-key replay create exactly one authority and receipt", async () => {
  const f = await hardeningFixture(),
    c = await agentChallenge(f);
  assert.equal((await f.a.challenge(f.p, c.input)).challengeId, c.challengeId);
  const results = await Promise.all([
    f.a.complete(f.p, c.challengeId),
    f.a.complete(f.p, c.challengeId),
  ]);
  assert.equal(results.filter((x) => !x.replayed).length, 1);
  assert.equal(results[0].principalId, results[1].principalId);
  assert.equal((await principalRows(f)).length, 1);
  assert.equal(f.sink.deliveries.size, 1);
  await assert.rejects(
    () => f.a.challenge(f.p, { ...c.input, subjectId: randomUUID() }),
    (e) => e.code === "IDEMPOTENCY_CONFLICT",
  );
});
test("failed rotation preserves the old committed credential; retry activates one new credential and erases ciphertext", async () => {
  const f = await hardeningFixture(),
    c = await agentChallenge(f);
  const initial = await f.a.complete(f.p, c.challengeId),
    old = f.sink.handles.get(initial.credentialHandle).token;
  const rotate = await agentChallenge(f, "rotate-agent");
  f.a.issuerPool = failTransaction(db.issuerPool, "activate");
  await assert.rejects(
    () => f.a.complete(f.p, rotate.challengeId),
    /SYNTHETIC_COMMIT_FAILURE/,
  );
  const pending = f.sink.handles.get(initial.credentialHandle).token;
  assert.equal((await engine.authenticate(old)).principalId, f.subject);
  await assert.rejects(
    () => engine.authenticate(pending),
    (e) => e.status === 401,
  );
  f.a.issuerPool = db.issuerPool;
  await f.a.complete(f.p, rotate.challengeId);
  await assert.rejects(
    () => engine.authenticate(old),
    (e) => e.status === 401,
  );
  assert.equal((await engine.authenticate(pending)).principalId, f.subject);
  assert.equal((await deliveryRow(rotate.challengeId)).sealed, null);
});
test("revocation cancels pending rotation during sink outage and cannot be undone by a late write", async () => {
  const f = await hardeningFixture(),
    c = await agentChallenge(f);
  const initial = await f.a.complete(f.p, c.challengeId),
    old = f.sink.handles.get(initial.credentialHandle).token;
  const rotate = await agentChallenge(f, "rotate-agent");
  let candidate;
  f.a.secretSink = {
    async write(v) {
      candidate = v;
      throw Error("SYNTHETIC_SINK_DOWN");
    },
  };
  await assert.rejects(() => f.a.complete(f.p, rotate.challengeId));
  const revoke = await agentChallenge(f, "revoke-agent");
  assert.equal((await f.a.complete(f.p, revoke.challengeId)).state, "revoked");
  assert.equal((await deliveryRow(rotate.challengeId)).state, "cancelled");
  assert.equal((await deliveryRow(rotate.challengeId)).sealed, null);
  await f.sink.write(candidate);
  for (const token of [old, candidate.token])
    await assert.rejects(
      () => engine.authenticate(token),
      (e) => e.status === 401,
    );
  await assert.rejects(() => f.a.complete(f.p, rotate.challengeId));
});
test("expired or consent-revoked pending deliveries are boundedly cancelled and ciphertext is erased", async () => {
  for (const reason of ["expiry", "consent"]) {
    const f = await hardeningFixture(),
      c = await agentChallenge(f);
    f.a.secretSink = {
      async write() {
        throw Error("SYNTHETIC_SINK_DOWN");
      },
    };
    await assert.rejects(() => f.a.complete(f.p, c.challengeId));
    if (reason === "expiry")
      await db.admin.query(
        "UPDATE vault_owner_challenges SET expires_at=now()-interval '1 second' WHERE challenge_id=$1",
        [c.challengeId],
      );
    else await f.a.consent(f.p, false);
    const cleaned = await f.a.cleanupDeliveries();
    assert.ok(cleaned.rows.length <= 10);
    assert.equal((await deliveryRow(c.challengeId)).state, "cancelled");
    assert.equal((await deliveryRow(c.challengeId)).sealed, null);
    assert.equal((await principalRows(f)).length, 0);
  }
});
test("crash between intent commit and delivery recovers deterministically; missing key and exhausted attempts fail closed", async () => {
  const f = await hardeningFixture(),
    c = await agentChallenge(f);
  await f.a.prepareAgentDelivery(f.p, c.challengeId); // Intent committed, process exits before calling sink.
  const restarted = new PrivateAuthority({
    engine,
    issuerPool: db.issuerPool,
    secretSink: f.sink,
    verifyOnline: f.a.verifyOnline,
  });
  assert.equal(
    (await restarted.complete(f.p, c.challengeId)).state,
    "provisioned",
  );
  const g = await hardeningFixture(),
    d = await agentChallenge(g);
  await g.a.prepareAgentDelivery(g.p, d.challengeId);
  const wrongKey = new PrivateAuthority({
    engine,
    issuerPool: db.issuerPool,
    secretSink: g.sink,
    verifyOnline: g.a.verifyOnline,
    deliveryKey: "changed-synthetic-delivery-key-123456",
  });
  await assert.rejects(
    () => wrongKey.complete(g.p, d.challengeId),
    (e) => e.code === "DELIVERY_KEY_UNAVAILABLE",
  );
  assert.equal(g.sink.writes.length, 0);
  assert.equal((await principalRows(g)).length, 0);
  assert.equal(
    (await deliveryRow(d.challengeId)).last_outcome,
    "KEY_UNAVAILABLE",
  );
  await db.admin.query(
    "UPDATE vault_agent_deliveries SET attempts=5 WHERE delivery_id=$1",
    [d.challengeId],
  );
  await assert.rejects(
    () => g.a.complete(g.p, d.challengeId),
    (e) => e.code === "DELIVERY_RETRY_LIMIT",
  );
  assert.equal(g.sink.writes.length, 0);
});
test("actual mTLS gateway maps malformed signed confirmation/JSON claims to 401 while SQL outage remains 503", async () => {
  const path = "/v2/private/session",
    token = signAssertion({
      key: signing.privateKey,
      kid: "synthetic",
      context: bootstrap,
      method: "GET",
      target: path,
      thumbprint: certs.client.thumbprint,
    });
  const original = JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
  const signed = (payload) => {
    const input =
      token.split(".")[0] +
      "." +
      Buffer.from(
        typeof payload === "string" ? payload : JSON.stringify(payload),
      ).toString("base64url");
    return (
      input +
      "." +
      sign("sha256", Buffer.from(input), {
        key: signing.privateKey,
        dsaEncoding: "ieee-p1363",
      }).toString("base64url")
    );
  };
  const raw = (jwt) =>
    new Promise((resolve, reject) => {
      const req = request(
        "https://127.0.0.1:" + server.address().port + path,
        {
          ...certs.client,
          minVersion: "TLSv1.3",
          maxVersion: "TLSv1.3",
          headers: { authorization: "Bearer " + jwt },
        },
        (res) => {
          const bytes = [];
          res.on("data", (b) => bytes.push(b));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              body: JSON.parse(Buffer.concat(bytes)),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
  for (const cnf of [
    undefined,
    null,
    false,
    1,
    "pin",
    [],
    {},
    { "x5t#S256": null },
    { "x5t#S256": [] },
    { "x5t#S256": original.cnf["x5t#S256"], extra: true },
  ]) {
    const c = { ...original, cnf };
    if (cnf === undefined) delete c.cnf;
    const rejected = await raw(signed(c));
    assert.equal(rejected.status, 401);
    assert.deepEqual(rejected.body, { error: "INVALID_ASSERTION" });
  }
  for (const payload of [
    "null",
    "[]",
    JSON.stringify(original).replace('"cnf":{', '"cnf":null,"cnf":{'),
  ])
    assert.equal((await raw(signed(payload))).status, 401);
  const previous = engine.tx;
  engine.tx = async () => {
    throw Error("SYNTHETIC_SQL_OUTAGE");
  };
  try {
    assert.equal((await raw(token)).status, 503);
  } finally {
    engine.tx = previous;
  }
});
test("primary session revocation after sink success prevents credential activation", async () => {
  const f = await hardeningFixture(),
    c = await agentChallenge(f);
  f.a.secretSink = {
    async write(v) {
      await f.sink.write(v);
      primarySessions.delete(f.p.authorization.sessionRef);
    },
  };
  await assert.rejects(
    () => f.a.complete(f.p, c.challengeId),
    (e) => e.code === "NO_OWNER_SESSION",
  );
  assert.equal((await principalRows(f)).length, 0);
  await assert.rejects(
    () => engine.authenticate(f.sink.writes[0].token),
    (e) => e.status === 401,
  );
});
test("SQL issuer cannot expand a fresh rotation grant beyond its reviewed lifetime", async () => {
  const f = await hardeningFixture(),
    c = await agentChallenge(f);
  const initial = await f.a.complete(f.p, c.challengeId),
    old = f.sink.handles.get(initial.credentialHandle).token;
  const rotate = await agentChallenge(f, "rotate-agent"),
    proof = randomBytes(32).toString("base64url");
  await db.issuerPool.query("SELECT vault_issue_bound_grant($1,$2)", [
    rotate.challengeId,
    hash(proof),
  ]);
  await assert.rejects(
    () =>
      db.issuerPool.query(
        "SELECT vault_apply_synthetic_agent($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          "rotate-agent",
          f.p.ownerId,
          f.subject,
          "",
          "viewer",
          [],
          hash("nbv2_" + randomBytes(32).toString("base64url")),
          new Date(Date.now() + 600000),
          hash(proof),
          f.p.authorization.sessionRef,
        ],
      ),
    /STALE_INTENT/,
  );
  assert.equal((await engine.authenticate(old)).principalId, f.subject);
  assert.equal(
    (
      await db.admin.query(
        "SELECT used_at FROM vault_review_grants WHERE proof_hash=$1",
        [hash(proof)],
      )
    ).rows[0].used_at,
    null,
  );
});

test("concurrent restricted SQL rotations recheck the approved epoch after the principal row lock", async () => {
  const f = await hardeningFixture(),
    c = await agentChallenge(f);
  await f.a.complete(f.p, c.challengeId);
  const rotations = [
    await agentChallenge(f, "rotate-agent"),
    await agentChallenge(f, "rotate-agent"),
  ];
  const proofs = rotations.map(() => randomBytes(32).toString("base64url"));
  const tokens = rotations.map(
    () => "nbv2_" + randomBytes(32).toString("base64url"),
  );
  for (let i = 0; i < 2; i++)
    await db.issuerPool.query("SELECT vault_issue_bound_grant($1,$2)", [
      rotations[i].challengeId,
      hash(proofs[i]),
    ]);
  const apply = (i) =>
    db.issuerPool.query(
      "SELECT vault_apply_synthetic_agent($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        "rotate-agent",
        f.p.ownerId,
        f.subject,
        "",
        "viewer",
        [],
        hash(tokens[i]),
        new Date(Date.now() + 60000),
        hash(proofs[i]),
        f.p.authorization.sessionRef,
      ],
    );
  let results;
  if (db.runtime.startsWith("native")) {
    // Force both transactions past the former unlocked EXISTS check before either can update.
    await db.admin.query("BEGIN");
    await db.admin.query(
      "SELECT 1 FROM vault_principals WHERE principal_id=$1 FOR UPDATE",
      [f.subject],
    );
    const pending = [apply(0), apply(1)];
    let blocked = false;
    try {
      const until = Date.now() + 2000;
      while (Date.now() < until) {
        await db.admin.query("SELECT pg_stat_clear_snapshot()");
        const n = (
          await db.admin.query(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT vault_apply_synthetic_agent%' ",
          )
        ).rows[0].n;
        if (n === 2) {
          blocked = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
    } finally {
      await db.admin.query("COMMIT");
    }
    results = await Promise.allSettled(pending);
    assert.equal(
      blocked,
      true,
      "both independent issuer sessions reached the principal lock",
    );
  } else {
    // Serialized WASM cannot establish the native locking claim; CI above must do so.
    results = [
      ...(await Promise.allSettled([apply(0)])),
      ...(await Promise.allSettled([apply(1)])),
    ];
  }
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.match(
    results.find((x) => x.status === "rejected").reason.message,
    /STALE_INTENT/,
  );
  const success = results.findIndex((x) => x.status === "fulfilled");
  assert.equal(
    (await engine.authenticate(tokens[success])).principalId,
    f.subject,
  );
  await assert.rejects(
    () => engine.authenticate(tokens[1 - success]),
    (e) => e.status === 401,
  );
});

test("PostgreSQL deferred constraint rejects COMMIT after sink success without activating the credential", async () => {
  const f = await hardeningFixture(),
    c = await agentChallenge(f);
  await db.admin
    .query(`CREATE FUNCTION phase31_deferred_agent_failure() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
    BEGIN IF NEW.principal_id::text=TG_ARGV[0] THEN RAISE EXCEPTION 'SYNTHETIC_DATABASE_COMMIT_FAILURE'; END IF; RETURN NULL; END $$`);
  // Fixture UUID is generated locally; there is no user-provided SQL identifier/value.
  await db.admin
    .query(`CREATE CONSTRAINT TRIGGER phase31_deferred_agent_failure AFTER INSERT ON vault_principals
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION phase31_deferred_agent_failure('${f.subject}')`);
  try {
    await assert.rejects(
      () => f.a.complete(f.p, c.challengeId),
      /SYNTHETIC_DATABASE_COMMIT_FAILURE/,
    );
  } finally {
    await db.admin.query(
      "DROP TRIGGER phase31_deferred_agent_failure ON vault_principals",
    );
    await db.admin.query("DROP FUNCTION phase31_deferred_agent_failure()");
  }
  assert.equal(f.sink.writes.length, 1);
  const token = f.sink.writes[0].token;
  await assert.rejects(
    () => engine.authenticate(token),
    (e) => e.status === 401,
  );
  assert.equal((await principalRows(f)).length, 0);
  assert.equal((await deliveryRow(c.challengeId)).state, "pending");
  assert.equal(
    (
      await db.admin.query(
        "SELECT receipt FROM vault_owner_challenges WHERE challenge_id=$1",
        [c.challengeId],
      )
    ).rows[0].receipt,
    null,
  );
  assert.equal((await f.a.complete(f.p, c.challengeId)).state, "provisioned");
  assert.equal(f.sink.writes[1].token, token);
  assert.equal((await deliveryRow(c.challengeId)).sealed, null);
});

// Phase 3.2 additions. All 332 baseline cases are retained unchanged.
function transactionBarrier(pool, match, { beforeCommit = false } = {}) {
  let reached, release;
  const entered = new Promise((r) => (reached = r));
  const gate = new Promise((r) => (release = r));
  let armed = true;
  return {
    entered,
    release,
    pool: {
      async connect() {
        const client = await pool.connect();
        let selected = false;
        return {
          async query(sql, args) {
            if (match(sql, args)) selected = true;
            if (beforeCommit && selected && armed && sql === "COMMIT") {
              armed = false;
              reached();
              await gate;
            }
            const result = await client.query(sql, args);
            if (!beforeCommit && selected && armed) {
              armed = false;
              reached();
              await gate;
            }
            return result;
          },
          release: (...args) => client.release(...args),
        };
      },
    },
  };
}
test("raw Redis invalidation is not a PostgreSQL commit fence: deterministic precommit control", async () => {
  const f = await hardeningFixture(),
    c = await agentChallenge(f);
  const barrier = transactionBarrier(
    db.issuerPool,
    (sql) => sql.includes("SET consumed_at="),
    { beforeCommit: true },
  );
  f.a.issuerPool = barrier.pool;
  const completion = f.a.complete(f.p, c.challengeId);
  try {
    await barrier.entered;
    primarySessions.delete(f.p.authorization.sessionRef);
  } finally {
    barrier.release();
  }
  assert.equal((await completion).state, "provisioned");
  assert.equal(
    (await engine.authenticate(f.sink.writes[0].token)).principalId,
    f.subject,
  );
  assert.equal((await principalRows(f)).length, 1);
  assert.ok(
    (
      await db.admin.query(
        "SELECT receipt FROM vault_owner_challenges WHERE challenge_id=$1",
        [c.challengeId],
      )
    ).rows[0].receipt,
  );
});

const revocationClaims = (p) => ({
  sub: p.principalId,
  owner: p.ownerId,
  session_ref: p.authorization.sessionRef,
  identity_hash: p.authorization.identityHash,
  session_expires_at: p.sessionExpiresAt,
  principal_epoch: 0,
  consent_epoch: 0,
});
const revocationContext = (p) => ({
  principalId: p.principalId,
  ownerId: p.ownerId,
  sessionRef: p.authorization.sessionRef,
  identityHash: p.authorization.identityHash,
  sessionExpiresAt: p.sessionExpiresAt,
  principalEpoch: 0,
  consentEpoch: 0,
});
async function assertSessionWaiter() {
  // WASM serializes clients; only native PostgreSQL can prove independent lock contention.
  if (!db.runtime.startsWith("native")) return;
  const until = Date.now() + 1500;
  while (Date.now() < until) {
    await db.admin.query("SELECT pg_stat_clear_snapshot()");
    const row = (
      await db.admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock'
      AND query LIKE 'SELECT * FROM vault_private_sessions WHERE session_ref_hash=%FOR UPDATE'`)
    ).rows[0];
    if (row.n > 0) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(
    "Independent session revoker did not block on the held authorization lock",
  );
}
async function reviewFixture() {
  const f = await hardeningFixture();
  const proposed = await engine.submit(
    f.p,
    {
      note: {
        ...note(),
        evidence: [{ kind: "manual", reason: "SYNTH revocation fixture" }],
      },
    },
    randomUUID(),
  );
  const row = (
    await db.admin.query("SELECT * FROM vault_proposals WHERE proposal_id=$1", [
      proposed.proposalId,
    ])
  ).rows[0];
  const c = await f.a.challenge(f.p, {
    subjectId: proposed.proposalId,
    expectedRevision: 0,
    decision: "verify",
    intentSha256: row.payload_hash.trim(),
  });
  await f.a.fresh(f.p, c.challengeId, {
    identityHash: f.p.authorization.identityHash,
    authTime: Math.floor(Date.now() / 1000),
  });
  return { ...f, c, proposed };
}
async function assertNoDecision(f) {
  assert.equal(
    (
      await db.admin.query(
        "SELECT state FROM vault_proposals WHERE proposal_id=$1",
        [f.proposed.proposalId],
      )
    ).rows[0].state,
    "proposed",
  );
  assert.equal(
    (
      await db.admin.query(
        "SELECT receipt FROM vault_owner_challenges WHERE challenge_id=$1",
        [f.c.challengeId],
      )
    ).rows[0].receipt,
    null,
  );
  assert.equal(
    (
      await db.admin.query(
        "SELECT count(*)::int AS n FROM vault_review_grants WHERE session_ref_hash=$1",
        [f.p.authorization.sessionRef],
      )
    ).rows[0].n,
    0,
  );
}
test("revocation before SQL authorization rejects cached owner context, pending grants and every sensitive action with 401", async () => {
  const f = await reviewFixture();
  const proof = randomBytes(32).toString("base64url");
  await db.issuerPool.query("SELECT vault_issue_bound_grant($1,$2)", [
    f.c.challengeId,
    hash(proof),
  ]);
  assert.equal((await f.a.revokeSession(revocationClaims(f.p))).revoked, true);
  // Redis intentionally remains present: the SQL fence alone must deny every cached identity.
  assert.ok(primarySessions.has(f.p.authorization.sessionRef));
  for (const scope of ["read", "propose", "review", "delete", "export"])
    await assert.rejects(
      () => engine.tx((client) => engine.authorize(client, f.p, scope)),
      (e) => e.code === "NO_OWNER_SESSION" && e.status === 401,
    );
  await assert.rejects(
    () => f.a.complete(f.p, f.c.challengeId),
    (e) => e.status === 401,
  );
  await assert.rejects(
    () =>
      db.issuerPool.query("SELECT vault_issue_bound_grant($1,$2)", [
        f.c.challengeId,
        hash(randomUUID()),
      ]),
    /STALE_AUTHORIZATION/,
  );
  await assert.rejects(
    () =>
      engine.review(f.p, f.proposed.proposalId, {
        decision: "verify",
        expectedRevision: 0,
        proof,
      }),
    (e) => e.status === 401,
  );
  assert.equal(
    (
      await db.admin.query(
        "SELECT used_at FROM vault_review_grants WHERE proof_hash=$1",
        [hash(proof)],
      )
    ).rows[0].used_at,
    null,
  );
  assert.equal(
    (
      await db.admin.query(
        "SELECT state FROM vault_proposals WHERE proposal_id=$1",
        [f.proposed.proposalId],
      )
    ).rows[0].state,
    "proposed",
  );
});
test("a private owner identity cannot omit its session context to bypass the revocation fence", async () => {
  const f = await reviewFixture(),
    { authorization, ...unbound } = f.p;
  await f.a.revokeSession(revocationClaims(f.p));
  for (const scope of ["read", "propose", "review", "delete", "export"])
    await assert.rejects(
      () => engine.tx((client) => engine.authorize(client, unbound, scope)),
      (e) => e.code === "NO_OWNER_SESSION" && e.status === 401,
    );
  await assertNoDecision(f);
});
for (const phase of ["during execution", "immediately before commit"]) {
  test(
    "SQL session revocation " +
      phase +
      " drains the admitted decision before acknowledging its fence",
    async () => {
      const f = await reviewFixture();
      const barrier = transactionBarrier(
        db.issuerPool,
        (sql) =>
          phase === "during execution"
            ? sql.startsWith("SELECT vault_issue_bound_grant")
            : sql.includes("SET consumed_at="),
        { beforeCommit: phase !== "during execution" },
      );
      f.a.issuerPool = barrier.pool;
      const completion = f.a.finishCompletion(f.p, f.c.challengeId, null);
      let revoked = false,
        revocation;
      try {
        await barrier.entered;
        revocation = f.a.revokeSession(revocationClaims(f.p)).then((r) => {
          revoked = true;
          return r;
        });
        await assertSessionWaiter();
        assert.equal(revoked, false);
        assert.ok(primarySessions.has(f.p.authorization.sessionRef));
      } finally {
        barrier.release();
      }
      assert.equal((await completion).state, "pending");
      assert.equal((await revocation).revoked, true);
      const s = (
        await db.admin.query(
          "SELECT * FROM vault_private_sessions WHERE session_ref_hash=$1",
          [f.p.authorization.sessionRef],
        )
      ).rows[0];
      assert.ok(s.revoked_at);
      assert.equal(s.consented, false);
      await assert.rejects(
        () => f.a.finishCompletion(f.p, f.c.challengeId, null),
        (e) => e.status === 401,
      );
      assert.equal(
        (
          await db.admin.query(
            "SELECT count(*)::int AS n FROM vault_revisions WHERE note_id=$1",
            [f.proposed.noteId],
          )
        ).rows[0].n,
        1,
      );
    },
  );
}
test("a revocation transaction holding the session lock wins before a later authorization and cannot be bypassed by bootstrap", async () => {
  const f = await reviewFixture();
  const barrier = transactionBarrier(
    db.issuerPool,
    (sql) => sql.startsWith("UPDATE vault_private_sessions SET revoked_at="),
    { beforeCommit: true },
  );
  f.a.issuerPool = barrier.pool;
  const revoking = f.a.revokeSession(revocationClaims(f.p));
  let operation;
  try {
    await barrier.entered;
    operation = engine
      .tx((client) => engine.authorize(client, f.p, "review"))
      .then(
        () => null,
        (e) => e,
      );
  } finally {
    barrier.release();
  }
  await revoking;
  assert.equal((await operation).status, 401);
  await assert.rejects(
    () => f.a.resolve(revocationClaims(f.p), { bootstrap: true }),
    (e) => e.status === 401,
  );
  await assert.rejects(
    () => f.a.consent(f.p, true),
    (e) => e.status === 401,
  );
  await assertNoDecision(f);
});
test("revocation after a committed decision does not undo its receipt or outbox, and denies replay under the retired family", async () => {
  const f = await reviewFixture(),
    committed = await f.a.complete(f.p, f.c.challengeId);
  await f.a.revokeSession(revocationClaims(f.p));
  assert.equal(committed.state, "pending");
  const receipt = (
    await db.admin.query(
      "SELECT receipt FROM vault_owner_challenges WHERE challenge_id=$1",
      [f.c.challengeId],
    )
  ).rows[0].receipt;
  const { replayed, ...decision } = committed;
  assert.equal(replayed, false);
  assert.deepEqual(receipt, decision);
  assert.equal(
    (
      await db.admin.query(
        "SELECT count(*)::int AS n FROM vault_outbox WHERE event_id=$1",
        [committed.eventId],
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    () => f.a.complete(f.p, f.c.challengeId),
    (e) => e.status === 401,
  );
});
test("revocation during delivered-credential retry prevents activation and bounded cleanup erases the pending ciphertext", async () => {
  const f = await hardeningFixture(),
    c = await agentChallenge(f);
  f.a.issuerPool = failTransaction(db.issuerPool, "activate");
  await assert.rejects(
    () => f.a.complete(f.p, c.challengeId),
    /SYNTHETIC_COMMIT_FAILURE/,
  );
  const token = f.sink.writes[0].token;
  f.a.issuerPool = db.issuerPool;
  await f.a.revokeSession(revocationClaims(f.p));
  await assert.rejects(
    () => f.a.complete(f.p, c.challengeId),
    (e) => e.status === 401,
  );
  await assert.rejects(
    () => engine.authenticate(token),
    (e) => e.status === 401,
  );
  assert.equal((await principalRows(f)).length, 0);
  const row = await deliveryRow(c.challengeId);
  assert.equal(row.state, "cancelled");
  assert.equal(row.sealed, null);
});
test("gateway revocation is idempotent after lost acknowledgment, binds the family and rejects replay and malformed input", async () => {
  const f = await hardeningFixture(),
    ctx = revocationContext(f.p);
  const result = await call("POST", "/v2/private/session/revoke", {}, ctx);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.data, {
    revoked: true,
    sessionRef: ctx.sessionRef,
  });
  const epoch = (
    await db.admin.query(
      "SELECT consent_epoch FROM vault_private_sessions WHERE session_ref_hash=$1",
      [ctx.sessionRef],
    )
  ).rows[0].consent_epoch;
  assert.equal(
    (await call("POST", "/v2/private/session/revoke", {}, ctx)).status,
    200,
  );
  assert.equal(
    (
      await db.admin.query(
        "SELECT consent_epoch FROM vault_private_sessions WHERE session_ref_hash=$1",
        [ctx.sessionRef],
      )
    ).rows[0].consent_epoch,
    epoch,
  );
  assert.equal(
    (await call("GET", "/v2/private/session", undefined, ctx)).status,
    401,
  );
  assert.equal(
    (
      await call(
        "POST",
        "/v2/private/session/revoke",
        { sessionRef: hash("forged") },
        ctx,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "POST",
        "/v2/private/session/revoke",
        {},
        { ...ctx, identityHash: hash("forged") },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await call(
        "POST",
        "/v2/private/session/revoke",
        {},
        { ...ctx, principalEpoch: 1 },
      )
    ).status,
    403,
  );
  const target = "/v2/private/session/revoke",
    body = Buffer.from("{}");
  const jwt = signAssertion({
    key: signing.privateKey,
    kid: "synthetic",
    context: ctx,
    method: "POST",
    target,
    body,
    thumbprint: certs.client.thumbprint,
  });
  const raw = () =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: server.address().port,
          path: target,
          method: "POST",
          ...certs.client,
          minVersion: "TLSv1.3",
          maxVersion: "TLSv1.3",
          headers: {
            authorization: "Bearer " + jwt,
            "content-type": "application/json",
            "content-length": body.length,
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  assert.equal(await raw(), 200);
  assert.equal(await raw(), 401);
});
test("revoking a not-yet-bootstrapped family creates a permanent SQL tombstone", async () => {
  const f = await hardeningFixture(),
    claims = { ...revocationClaims(f.p), session_ref: hash(randomUUID()) };
  primarySessions.set(claims.session_ref, {
    expiresAt: claims.session_expires_at * 1000,
  });
  await f.a.revokeSession(claims);
  await assert.rejects(
    () => f.a.resolve(claims, { bootstrap: true }),
    (e) => e.status === 401,
  );
  await f.a.revokeSession(claims);
  assert.ok(
    (
      await db.admin.query(
        "SELECT revoked_at FROM vault_private_sessions WHERE session_ref_hash=$1",
        [claims.session_ref],
      )
    ).rows[0].revoked_at,
  );
});
test("006 rollback/checksum, column privileges and monotonic tombstones prevent SQL resurrection", async () => {
  const { applySessionMigration } =
    await import("../../backend/v2/private/session-migrate.mjs");
  assert.equal(
    (await applySessionMigration(db.admin)).state,
    "already-applied",
  );
  const f = await hardeningFixture(),
    ref = f.p.authorization.sessionRef;
  const rights = (
    await db.admin.query(`SELECT
    has_column_privilege('neuralcore_issuer','vault_private_sessions','expires_at','UPDATE') AS expiry,
    has_column_privilege('neuralcore_issuer','vault_private_sessions','identity_hash','UPDATE') AS identity,
    has_column_privilege('neuralcore_issuer','vault_private_sessions','revoked_at','UPDATE') AS revokes,
    has_table_privilege('neuralcore_api','vault_private_sessions','UPDATE') AS api,
    has_table_privilege('neuralcore_issuer','vault_private_sessions','DELETE') AS deletes,
    has_function_privilege('neuralcore_issuer','vault_preserve_session_fence()','EXECUTE') AS trigger`)
  ).rows[0];
  assert.deepEqual(rights, {
    expiry: false,
    identity: false,
    revokes: true,
    api: false,
    deletes: false,
    trigger: false,
  });
  await assert.rejects(
    () =>
      db.issuerPool.query(
        "UPDATE vault_private_sessions SET expires_at=expires_at+interval '1 hour' WHERE session_ref_hash=$1",
        [ref],
      ),
    /permission denied/,
  );
  await f.a.revokeSession(revocationClaims(f.p));
  for (const sql of [
    "SET revoked_at=NULL",
    "SET consented=true",
    "SET consent_epoch=consent_epoch-1",
  ])
    await assert.rejects(
      () =>
        db.issuerPool.query(
          "UPDATE vault_private_sessions " + sql + " WHERE session_ref_hash=$1",
          [ref],
        ),
      /SESSION_REVOKED|SESSION_BINDING_IMMUTABLE/,
    );
  await db.admin.query(
    "UPDATE schema_migrations SET sha256=repeat('0',64) WHERE version=6",
  );
  await assert.rejects(() => applySessionMigration(db.admin), /checksum drift/);
  await db.admin.query(
    "UPDATE schema_migrations SET sha256=$1 WHERE version=6",
    [
      hash(
        await readFile(
          new URL("../../db/006_session_revocation.sql", import.meta.url),
          "utf8",
        ),
      ),
    ],
  );
});

test("a genuine PostgreSQL revocation COMMIT failure is 503 and rolls back the fence; retry remains possible", async () => {
  const f = await reviewFixture(),
    ctx = revocationContext(f.p);
  await db.admin
    .query(`CREATE FUNCTION synthetic_revoke_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.session_ref_hash='${ctx.sessionRef}' AND NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'SYNTHETIC_REVOCATION_COMMIT_FAILURE'; END IF; RETURN NEW; END $$`);
  await db.admin
    .query(`CREATE CONSTRAINT TRIGGER synthetic_revoke_commit_failure AFTER UPDATE ON vault_private_sessions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_revoke_commit_failure()`);
  try {
    const result = await call("POST", "/v2/private/session/revoke", {}, ctx);
    assert.equal(result.status, 503);
    assert.equal(result.body.error, "PRIVATE_SERVICE_UNAVAILABLE");
    assert.equal(
      (
        await db.admin.query(
          "SELECT revoked_at FROM vault_private_sessions WHERE session_ref_hash=$1",
          [ctx.sessionRef],
        )
      ).rows[0].revoked_at,
      null,
    );
    await engine.tx((client) => engine.authorize(client, f.p, "review"));
    await assertNoDecision(f);
  } finally {
    await db.admin.query(
      "DROP TRIGGER synthetic_revoke_commit_failure ON vault_private_sessions",
    );
    await db.admin.query("DROP FUNCTION synthetic_revoke_commit_failure()");
  }
  assert.equal(
    (await call("POST", "/v2/private/session/revoke", {}, ctx)).status,
    200,
  );
});
test("lost SQL revocation commit acknowledgment fails closed; concurrent HTTP retries converge on one immutable fence", async () => {
  const f = await hardeningFixture(),
    ctx = revocationContext(f.p),
    original = authority.issuerPool;
  let lost = false;
  authority.issuerPool = {
    async connect() {
      const client = await original.connect();
      let revokes = false;
      return {
        async query(sql, args) {
          if (sql.startsWith("UPDATE vault_private_sessions SET revoked_at="))
            revokes = true;
          const result = await client.query(sql, args);
          if (sql === "COMMIT" && revokes && !lost) {
            lost = true;
            throw Error("SYNTHETIC_LOST_REVOCATION_ACK");
          }
          return result;
        },
        release: (e) => client.release(e),
      };
    },
  };
  try {
    assert.equal(
      (await call("POST", "/v2/private/session/revoke", {}, ctx)).status,
      503,
    );
  } finally {
    authority.issuerPool = original;
  }
  assert.equal(lost, true);
  const before = (
    await db.admin.query(
      "SELECT * FROM vault_private_sessions WHERE session_ref_hash=$1",
      [ctx.sessionRef],
    )
  ).rows[0];
  assert.ok(before.revoked_at);
  await assert.rejects(
    () => engine.tx((client) => engine.authorize(client, f.p, "review")),
    (e) => e.status === 401,
  );
  const results = await Promise.all([
    call("POST", "/v2/private/session/revoke", {}, ctx),
    call("POST", "/v2/private/session/revoke", {}, ctx),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200],
  );
  const after = (
    await db.admin.query(
      "SELECT * FROM vault_private_sessions WHERE session_ref_hash=$1",
      [ctx.sessionRef],
    )
  ).rows[0];
  assert.equal(after.consent_epoch, before.consent_epoch);
  assert.equal(
    new Date(after.revoked_at).getTime(),
    new Date(before.revoked_at).getTime(),
  );
});
test("real owner logout drains an in-flight decision across Redis, pinned mTLS and SQL before returning success", async () => {
  const { ownerController } = await import("../../lib/auth/owner-core.ts");
  const { ownerAccess } = await import("../../lib/auth/owner-access.ts");
  const { revokeSessionWith } =
    await import("../../lib/brain/private/connection.ts");
  const {
    config: baseConfig,
    origin,
    memoryStore,
    provider: baseProvider,
    login,
    request: authRequest,
  } = await import("../helpers/owner-fixture.mjs");
  const config = { ...baseConfig, ownerSub: "987654321" + Date.now() },
    store = memoryStore();
  const provider = {
    ...baseProvider,
    async exchange() {
      return { sub: config.ownerSub, email_verified: true };
    },
  };
  const pid = randomUUID(),
    oid = "synthetic-coordinated-logout-" + randomUUID(),
    identity = { principalId: pid, ownerId: oid };
  await db.admin.query(
    "INSERT INTO vault_principals(principal_id,owner_id,display_name,kind,role,scopes,token_hash) VALUES($1,$2,'SYNTH coordinated logout','owner','owner',ARRAY['read','propose','review','delete','export'],$3)",
    [pid, oid, hash(randomUUID())],
  );
  await db.admin.query("INSERT INTO vault_owner_identities VALUES($1,$2)", [
    hash(config.ownerSub),
    pid,
  ]);
  const controller = ownerController({
    config,
    store,
    provider,
    revokeOwnerSession: (session) =>
      revokeSessionWith(transport, identity, session),
  });
  const signed = await login(controller),
    access = ownerAccess(config, store);
  const auth = await access.read(
    authRequest("session", "GET", { cookie: signed.cookie }),
  );
  const previous = authority.verifyOnline;
  authority.verifyOnline = (value) => access.verifyFamily(value);
  const ctx = {
    ...identity,
    sessionRef: auth.sessionRef,
    identityHash: auth.identityHash,
    sessionExpiresAt: Math.floor(auth.expiresAt / 1000),
    principalEpoch: 0,
    consentEpoch: 0,
  };
  try {
    assert.equal(
      (await call("POST", "/v2/private/consent", { granted: true }, ctx))
        .status,
      200,
    );
    const current = (await call("GET", "/v2/private/session", undefined, ctx))
      .body.data;
    const cached = {
      principalId: pid,
      ownerId: oid,
      credentialHash: (
        await db.admin.query(
          "SELECT token_hash FROM vault_principals WHERE principal_id=$1",
          [pid],
        )
      ).rows[0].token_hash.trim(),
      permissionEpoch: current.principalEpoch,
      authorization: {
        sessionRef: auth.sessionRef,
        identityHash: auth.identityHash,
        principalEpoch: current.principalEpoch,
        consentEpoch: current.consentEpoch,
      },
    };
    const proposed = await engine.submit(
      cached,
      {
        note: {
          ...note(),
          evidence: [{ kind: "manual", reason: "SYNTH real logout race" }],
        },
      },
      randomUUID(),
    );
    const row = (
      await db.admin.query(
        "SELECT payload_hash FROM vault_proposals WHERE proposal_id=$1",
        [proposed.proposalId],
      )
    ).rows[0];
    const c = (
      await call(
        "POST",
        "/v2/private/review-challenges",
        {
          subjectId: proposed.proposalId,
          expectedRevision: 0,
          decision: "verify",
          intentSha256: row.payload_hash.trim(),
        },
        current,
      )
    ).body.data;
    assert.ok(c.challengeId);
    assert.equal(
      (
        await call(
          "POST",
          "/v2/private/review-challenges/" + c.challengeId + "/fresh",
          {
            identityHash: auth.identityHash,
            authTime: Math.floor(Date.now() / 1000),
          },
          current,
        )
      ).status,
      200,
    );
    const original = authority.issuerPool,
      barrier = transactionBarrier(
        original,
        (sql) => sql.includes("SET consumed_at="),
        { beforeCommit: true },
      );
    authority.issuerPool = barrier.pool;
    const completion = call(
      "POST",
      "/v2/private/review-challenges/" + c.challengeId + "/complete",
      {},
      current,
    );
    let logoutPending,
      finished = false;
    try {
      await barrier.entered;
      logoutPending = controller
        .logout(
          authRequest("logout", "POST", {
            cookie: signed.cookie,
            origin,
            "x-ncore-csrf": signed.body.csrf,
          }),
        )
        .then((r) => {
          finished = true;
          return r;
        });
      await assertSessionWaiter();
      assert.equal(finished, false);
      assert.ok(await access.verifyFamily(auth));
    } finally {
      barrier.release();
      authority.issuerPool = original;
    }
    const decision = await completion;
    assert.ok(
      [200, 401].includes(decision.status),
      JSON.stringify(decision.body),
    );
    if (decision.status === 401)
      assert.equal(decision.body.error, "NO_OWNER_SESSION");
    const logout = await logoutPending;
    assert.equal(logout.status, 200, await logout.clone().text());
    assert.equal(await access.verifyFamily(auth), null);
    assert.ok(
      (
        await db.admin.query(
          "SELECT revoked_at FROM vault_private_sessions WHERE session_ref_hash=$1",
          [auth.sessionRef],
        )
      ).rows[0].revoked_at,
    );
    assert.equal(
      (
        await db.admin.query(
          "SELECT count(*)::int AS n FROM vault_revisions WHERE note_id=$1",
          [proposed.noteId],
        )
      ).rows[0].n,
      1,
    );
    await assert.rejects(
      () => engine.tx((client) => engine.authorize(client, cached, "review")),
      (e) => e.status === 401,
    );
    assert.equal(
      (await call("GET", "/v2/private/session", undefined, ctx)).status,
      401,
    );
  } finally {
    authority.verifyOnline = previous;
  }
});
