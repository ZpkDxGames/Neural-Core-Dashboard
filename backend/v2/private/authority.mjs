import { randomBytes, randomUUID } from "node:crypto";
import { PrivateMemoryEngine } from "./engine.mjs";
import { fail, hash, uuid } from "../note.mjs";
import { fields } from "./validation.mjs";
import {
  guardedDatabase,
  checkDeadline,
  boundedDependency,
} from "./deadline.mjs";
const secret = () => randomBytes(32).toString("base64url");
const binding = (p) => p.authorization;
export function agentIntent(input) {
  fields(input, [
    "displayName",
    "role",
    "scopes",
    "expiresInSeconds",
    "idempotencyKey",
  ]);
  if (
    typeof input.displayName !== "string" ||
    input.displayName.length < 1 ||
    input.displayName.length > 120 ||
    /[\p{Cc}\p{Cf}]/u.test(input.displayName) ||
    !["viewer", "contributor", "maintainer"].includes(input.role) ||
    !Array.isArray(input.scopes) ||
    input.scopes.length < 1 ||
    input.scopes.length > 16 ||
    new Set(input.scopes).size !== input.scopes.length ||
    input.scopes.some(
      (x) =>
        ![
          "read",
          "propose",
          "type:fact",
          "type:project",
          "type:decision",
          "type:reference",
        ].includes(x),
    ) ||
    !input.scopes.some((x) => x.startsWith("type:")) ||
    (input.role === "viewer" && input.scopes.includes("propose")) ||
    !Number.isInteger(input.expiresInSeconds) ||
    input.expiresInSeconds < 1 ||
    input.expiresInSeconds > 3600 ||
    typeof input.idempotencyKey !== "string" ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey)
  )
    fail("INVALID_AGENT_GRANT", 400);
  return { ...input, scopes: [...input.scopes].sort() };
}
/** Uses a separately authenticated restricted issuer connection, never the engine login.
 * verifyOnline reads the existing primary session-family store on every operation. */
export class PrivateAuthority {
  constructor({
    engine,
    issuerPool,
    verifyOnline,
    secretSink,
    clock = () => Date.now(),
  }) {
    if (typeof verifyOnline !== "function")
      fail("SESSION_VALIDATOR_REQUIRED", 503);
    this.engine = engine;
    this.issuerPool = issuerPool;
    this.verifyOnline = verifyOnline;
    this.secretSink = secretSink;
    this.clock = clock;
  }
  async tx(fn) {
    const c = await this.issuerPool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL statement_timeout='5000ms'");
      await c.query("SET LOCAL lock_timeout='2000ms'");
      const result = await fn(guardedDatabase(c));
      checkDeadline();
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  async online(claims) {
    const result = await boundedDependency((signal) =>
      this.verifyOnline({
        sessionRef: claims.session_ref,
        identityHash: claims.identity_hash,
        signal,
      }),
    );
    if (
      !result ||
      !Number.isSafeInteger(result.expiresAt) ||
      Math.floor(result.expiresAt / 1000) !== claims.session_expires_at ||
      result.expiresAt <= this.clock()
    )
      fail("NO_OWNER_SESSION", 401);
  }
  async resolve(claims, { bootstrap = false } = {}) {
    await this.online(claims);
    const row = (
      await this.engine.tx((db) =>
        db.query(
          `SELECT p.* FROM vault_principals p JOIN vault_owner_identities i ON i.principal_id=p.principal_id
   WHERE i.identity_hash=$1 AND p.principal_id=$2 AND p.owner_id=$3 AND p.kind='owner' AND p.role='owner' AND p.disabled_at IS NULL`,
          [claims.identity_hash, claims.sub, claims.owner],
        ),
      )
    ).rows[0];
    if (
      !row ||
      (row.credential_expires_at &&
        new Date(row.credential_expires_at) <= new Date(this.clock()))
    )
      fail("UNAUTHORIZED", 401);
    if (bootstrap) {
      if (claims.principal_epoch !== 0 || claims.consent_epoch !== 0)
        fail("INVALID_BOOTSTRAP", 403);
      await this.tx(async (db) => {
        await db.query(
          `INSERT INTO vault_private_sessions(session_ref_hash,principal_id,identity_hash,expires_at) VALUES($1,$2,$3,to_timestamp($4)) ON CONFLICT(session_ref_hash) DO NOTHING`,
          [
            claims.session_ref,
            row.principal_id,
            claims.identity_hash,
            claims.session_expires_at,
          ],
        );
      });
    }
    const s = (
      await this.engine.tx((db) =>
        db.query(
          "SELECT * FROM vault_private_sessions WHERE session_ref_hash=$1",
          [claims.session_ref],
        ),
      )
    ).rows[0];
    if (
      !s ||
      s.revoked_at ||
      s.principal_id !== row.principal_id ||
      s.identity_hash.trim() !== claims.identity_hash ||
      Math.floor(new Date(s.expires_at).getTime() / 1000) !==
        claims.session_expires_at ||
      new Date(s.expires_at) <= new Date(this.clock())
    )
      fail("NO_OWNER_SESSION", 401);
    if (
      !bootstrap &&
      (!s.consented ||
        claims.principal_epoch !== row.permission_epoch ||
        claims.consent_epoch !== s.consent_epoch)
    )
      fail("CONSENT_REQUIRED", 403);
    return {
      principalId: row.principal_id,
      ownerId: row.owner_id,
      credentialHash: row.token_hash.trim(),
      permissionEpoch: row.permission_epoch,
      authorization: {
        sessionRef: claims.session_ref,
        identityHash: claims.identity_hash,
        principalEpoch: row.permission_epoch,
        consentEpoch: s.consent_epoch,
      },
      consented: s.consented,
      sessionExpiresAt: claims.session_expires_at,
    };
  }
  context(p) {
    return {
      principalId: p.principalId,
      ownerId: p.ownerId,
      ...p.authorization,
      sessionExpiresAt: p.sessionExpiresAt,
      consented: p.consented,
    };
  }
  async consent(p, granted) {
    if (typeof granted !== "boolean") fail("INVALID_CONSENT", 400);
    return this.tx(async (db) => {
      const s = (
        await db.query(
          "SELECT * FROM vault_private_sessions WHERE session_ref_hash=$1 FOR UPDATE",
          [binding(p).sessionRef],
        )
      ).rows[0];
      if (
        !s ||
        s.revoked_at ||
        new Date(s.expires_at) <= new Date(this.clock())
      )
        fail("NO_OWNER_SESSION", 401);
      const r = await db.query(
        "UPDATE vault_private_sessions SET consented=$2,consent_epoch=consent_epoch+1 WHERE session_ref_hash=$1 RETURNING consent_epoch",
        [binding(p).sessionRef, granted],
      );
      return { consented: granted, consentEpoch: r.rows[0].consent_epoch };
    });
  }
  async challenge(p, input) {
    fields(
      input,
      [
        "subjectId",
        "expectedRevision",
        "decision",
        "intentSha256",
        "permissionRequest",
      ],
      ["subjectId", "expectedRevision", "decision", "intentSha256"],
    );
    if (
      !uuid(input.subjectId) ||
      ![
        "verify",
        "publish-unverified",
        "reject",
        "provision-agent",
        "rotate-agent",
        "revoke-agent",
      ].includes(input.decision) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      !/^[0-9a-f]{64}$/.test(input.intentSha256)
    )
      fail("INVALID_CHALLENGE", 400);
    return this.tx(async (db) => {
      const owner = await this.engine.authorize(db, p, "review");
      if (owner.role !== "owner") fail("ROLE_FORBIDDEN", 403);
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1),106)", [
        binding(p).sessionRef,
      ]);
      const count = (
        await db.query(
          "SELECT count(*)::int AS n FROM vault_owner_challenges WHERE session_ref_hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()",
          [binding(p).sessionRef],
        )
      ).rows[0].n;
      if (count >= 5) fail("CHALLENGE_LIMIT", 429);
      let intent;
      if (["verify", "publish-unverified", "reject"].includes(input.decision)) {
        if (input.permissionRequest !== undefined)
          fail("INVALID_CHALLENGE", 400);
        const row = (
          await db.query(
            "SELECT * FROM vault_proposals WHERE owner_id=$1 AND proposal_id=$2 FOR SHARE",
            [owner.ownerId, input.subjectId],
          )
        ).rows[0];
        if (!row || !["proposed", "conflict"].includes(row.state))
          fail("PROPOSAL_UNAVAILABLE", 409);
        if (
          row.base_revision !== input.expectedRevision ||
          row.payload_hash.trim() !== input.intentSha256
        )
          fail("STALE_INTENT", 409);
        const current = (
          await db.query(
            "SELECT current_revision,published_revision,deleted_at FROM vault_notes WHERE owner_id=$1 AND note_id=$2",
            [p.ownerId, row.note_id],
          )
        ).rows[0];
        if (
          input.decision !== "reject" &&
          current &&
          (current.deleted_at ||
            current.current_revision !== input.expectedRevision ||
            (!row.expected_file_hash &&
              current.published_revision !== input.expectedRevision))
        )
          fail("REVISION_CONFLICT", 409);
        intent = {
          proposalId: input.subjectId,
          decision: input.decision,
          expectedRevision: input.expectedRevision,
        };
      } else if (input.decision === "provision-agent") {
        if (input.expectedRevision !== 0) fail("INVALID_AGENT_GRANT", 400);
        intent = agentIntent(input.permissionRequest);
        if (hash(JSON.stringify(intent)) !== input.intentSha256)
          fail("STALE_INTENT", 409);
      } else {
        fields(
          input.permissionRequest,
          ["principalId", "permissionEpoch", "expiresInSeconds"],
          ["principalId", "permissionEpoch"],
        );
        await db.query("SELECT vault_lock_authorization($1,NULL)", [
          input.subjectId,
        ]);
        const a = (
          await db.query(
            "SELECT * FROM vault_principals WHERE principal_id=$1 AND owner_id=$2 AND synthetic AND kind='agent'",
            [input.subjectId, p.ownerId],
          )
        ).rows[0];
        if (
          !a ||
          a.disabled_at ||
          input.permissionRequest.principalId !== input.subjectId ||
          input.expectedRevision !== a.permission_epoch ||
          input.permissionRequest.permissionEpoch !== a.permission_epoch
        )
          fail("STALE_INTENT", 409);
        intent = input.permissionRequest;
        if (
          input.decision === "rotate-agent" &&
          (!Number.isInteger(intent.expiresInSeconds) ||
            intent.expiresInSeconds < 1 ||
            intent.expiresInSeconds > 3600)
        )
          fail("INVALID_AGENT_GRANT", 400);
        if (hash(JSON.stringify(intent)) !== input.intentSha256)
          fail("STALE_INTENT", 409);
      }
      if (input.decision === "provision-agent") {
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
          [p.ownerId, intent.idempotencyKey],
        );
        const prior = (
          await db.query(
            "SELECT * FROM vault_owner_challenges WHERE owner_id=$1 AND action='provision-agent' AND intent->>'idempotencyKey'=$2",
            [p.ownerId, intent.idempotencyKey],
          )
        ).rows[0];
        if (prior) {
          if (
            prior.subject_id !== input.subjectId ||
            prior.intent_hash.trim() !== input.intentSha256 ||
            prior.session_ref_hash.trim() !== binding(p).sessionRef ||
            prior.consent_epoch !== binding(p).consentEpoch ||
            prior.principal_epoch !== binding(p).principalEpoch ||
            (!prior.receipt &&
              new Date(prior.expires_at) <= new Date(this.clock()))
          )
            fail("IDEMPOTENCY_CONFLICT", 409);
          return {
            challengeId: prior.challenge_id,
            expiresAt: new Date(prior.expires_at).toISOString(),
            decision: prior.action,
            subjectId: prior.subject_id,
            expectedRevision: prior.expected_revision,
            intentSha256: prior.intent_hash.trim(),
            state: prior.receipt
              ? "confirmed"
              : prior.fresh_at
                ? "confirmation-required"
                : "fresh-auth-required",
          };
        }
      }
      const id = randomUUID(),
        a = binding(p);
      const inserted = await db.query(
        `INSERT INTO vault_owner_challenges(challenge_id,owner_id,principal_id,session_ref_hash,identity_hash,action,subject_id,expected_revision,intent_hash,principal_epoch,consent_epoch,intent,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()+interval '120 seconds') RETURNING expires_at`,
        [
          id,
          p.ownerId,
          p.principalId,
          a.sessionRef,
          a.identityHash,
          input.decision,
          input.subjectId,
          input.expectedRevision,
          input.intentSha256,
          a.principalEpoch,
          a.consentEpoch,
          JSON.stringify(intent),
        ],
      );
      const expiresAt = new Date(inserted.rows[0].expires_at).toISOString();
      return {
        challengeId: id,
        expiresAt,
        decision: input.decision,
        subjectId: input.subjectId,
        expectedRevision: input.expectedRevision,
        intentSha256: input.intentSha256,
        state: "fresh-auth-required",
      };
    });
  }
  async lockedChallenge(db, p, id) {
    if (!uuid(id)) fail("INVALID_CHALLENGE", 400);
    await this.engine.authorize(db, p, "review");
    const c = (
      await db.query(
        "SELECT * FROM vault_owner_challenges WHERE challenge_id=$1 AND principal_id=$2 AND session_ref_hash=$3 FOR UPDATE",
        [id, p.principalId, binding(p).sessionRef],
      )
    ).rows[0];
    if (
      !c ||
      (!c.receipt && new Date(c.expires_at) <= new Date(this.clock())) ||
      c.principal_epoch !== binding(p).principalEpoch ||
      c.consent_epoch !== binding(p).consentEpoch ||
      c.identity_hash.trim() !== binding(p).identityHash
    )
      fail("CHALLENGE_EXPIRED", 403);
    return c;
  }
  async fresh(p, id, { identityHash, authTime }) {
    if (
      identityHash !== binding(p).identityHash ||
      !Number.isSafeInteger(authTime) ||
      authTime > Math.floor(this.clock() / 1000) + 5 ||
      authTime < Math.floor(this.clock() / 1000) - 120
    )
      fail("STEP_UP_UNAVAILABLE", 403);
    return this.tx(async (db) => {
      const c = await this.lockedChallenge(db, p, id);
      if (
        c.consumed_at ||
        c.fresh_at ||
        authTime < Math.floor(new Date(c.created_at).getTime() / 1000) - 5
      )
        fail("STEP_UP_REPLAY", 409);
      await db.query(
        "UPDATE vault_owner_challenges SET fresh_at=to_timestamp($2) WHERE challenge_id=$1",
        [id, authTime],
      );
      return { challengeId: id, state: "confirmation-required" };
    });
  }
  async receipt(p, id) {
    return this.tx(async (db) => {
      const c = await this.lockedChallenge(db, p, id);
      let preview;
      if (["verify", "publish-unverified", "reject"].includes(c.action)) {
        const proposal = (
          await db.query(
            "SELECT payload,payload_hash FROM vault_proposals WHERE proposal_id=$1 AND owner_id=$2",
            [c.subject_id, p.ownerId],
          )
        ).rows[0];
        if (!proposal || proposal.payload_hash.trim() !== c.intent_hash.trim())
          fail("STALE_INTENT", 409);
        preview = {
          title: proposal.payload.title,
          body: proposal.payload.body,
        };
      }
      return {
        challengeId: id,
        state: c.receipt
          ? "confirmed"
          : c.fresh_at
            ? "confirmation-required"
            : "fresh-auth-required",
        decision: c.action,
        subjectId: c.subject_id,
        expectedRevision: c.expected_revision,
        intentSha256: c.intent_hash.trim(),
        preview,
        receipt: c.receipt ?? undefined,
      };
    });
  }
  async complete(p, id) {
    return this.tx(async (db) => {
      const c = await this.lockedChallenge(db, p, id);
      if (c.receipt) return { ...c.receipt, replayed: true };
      const proof = secret();
      await db.query("SELECT vault_issue_bound_grant($1,$2)", [
        id,
        hash(proof),
      ]);
      let receipt;
      const e = new PrivateMemoryEngine(this.engine.pool, {
        cursorKey: this.engine.cursorKey,
      });
      e.tx = (fn) => fn(db);
      if (["verify", "publish-unverified", "reject"].includes(c.action))
        receipt = await e.review(p, c.subject_id, {
          decision: c.action,
          expectedRevision: c.expected_revision,
          proof,
        });
      else {
        await e.authorize(db, p, "review");
        if (
          c.action !== "revoke-agent" &&
          (!this.secretSink || typeof this.secretSink.write !== "function")
        )
          fail("SECRET_SINK_UNAVAILABLE", 503);
        const token = "nbv2_" + secret(),
          handle = "synthetic-agent:" + c.subject_id,
          expiry = new Date(
            this.clock() + (c.intent.expiresInSeconds ?? 60) * 1000,
          );
        await db.query(
          "SELECT vault_apply_synthetic_agent($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            c.action,
            p.ownerId,
            c.subject_id,
            c.intent.displayName ?? "",
            c.intent.role ?? "viewer",
            c.intent.scopes ?? [],
            hash(token),
            expiry,
            hash(proof),
            binding(p).sessionRef,
          ],
        );
        // Secret custody is server-to-server only. Failed delivery rolls back DB+proof+receipt.
        if (c.action !== "revoke-agent")
          await boundedDependency((signal) =>
            this.secretSink.write({
              handle,
              token,
              expiresAt: expiry.toISOString(),
              signal,
            }),
          );
        receipt = {
          principalId: c.subject_id,
          credentialHandle: handle,
          state: c.action === "revoke-agent" ? "revoked" : "provisioned",
          ...(c.action !== "revoke-agent"
            ? { expiresAt: expiry.toISOString() }
            : {}),
          synthetic: true,
        };
      }
      await db.query(
        "UPDATE vault_owner_challenges SET consumed_at=clock_timestamp(),receipt=$2 WHERE challenge_id=$1",
        [id, JSON.stringify(receipt)],
      );
      return { ...receipt, replayed: false };
    });
  }
}
