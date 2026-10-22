import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, randomBytes } from "node:crypto";
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
