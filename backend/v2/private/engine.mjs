import { MemoryEngine } from "../store.mjs";
import { fail, hash } from "../note.mjs";
import { guardedDatabase, checkDeadline } from "./deadline.mjs";
/** Schema 004 composition. No legacy unbound proof is accepted by this engine. */
export class PrivateMemoryEngine extends MemoryEngine {
  async tx(fn) {
    return super.tx(async (db) => {
      const value = await fn(guardedDatabase(db));
      checkDeadline();
      return value;
    });
  }
  async authenticate(token) {
    // Authentication checks the current credential/expiry/epoch; action scopes
    // are enforced by authorize(). A proposal-only agent need not hold read.
    return super.authenticate(token);
  }

  async authorize(db, identity, scope) {
    await db.query("SELECT vault_lock_authorization($1,$2)", [
      identity?.principalId,
      identity?.authorization?.sessionRef ?? null,
    ]);
    const r = await db.query(
      "SELECT * FROM vault_principals WHERE principal_id=$1",
      [identity?.principalId],
    );
    const row = r.rows[0];
    if (
      !row ||
      row.disabled_at ||
      (row.credential_expires_at &&
        new Date(row.credential_expires_at) <= new Date()) ||
      (row.kind === "agent" && !row.credential_expires_at) ||
      (identity.permissionEpoch !== undefined &&
        identity.permissionEpoch !== row.permission_epoch)
    )
      fail("UNAUTHORIZED", 401);
    if (row.kind === "owner" && !identity.authorization)
      fail("NO_OWNER_SESSION", 401);
    const p = await super.authorize(db, identity, scope);
    if (identity.authorization) {
      const a = identity.authorization,
        s = (
          await db.query(
            "SELECT * FROM vault_private_sessions WHERE session_ref_hash=$1",
            [a.sessionRef],
          )
        ).rows[0];
      if (
        !s ||
        s.principal_id !== p.principalId ||
        s.revoked_at ||
        new Date(s.expires_at) <= new Date() ||
        s.identity_hash.trim() !== a.identityHash
      )
        fail("NO_OWNER_SESSION", 401);
      if (
        !s.consented ||
        s.consent_epoch !== a.consentEpoch ||
        row.permission_epoch !== a.principalEpoch
      )
        fail("STALE_AUTHORIZATION", 403);
    }
    return {
      ...p,
      permissionEpoch: row.permission_epoch,
      authorization: identity.authorization,
    };
  }
  async agents(identity) {
    return this.tx(async (db) => {
      const p = await this.authorize(db, identity, "read");
      if (p.role !== "owner") fail("ROLE_FORBIDDEN", 403);
      return (
        await db.query(
          "SELECT principal_id,display_name,kind,role,scopes,disabled_at,credential_expires_at,permission_epoch,synthetic FROM vault_principals WHERE owner_id=$1 ORDER BY principal_id LIMIT 50",
          [p.ownerId],
        )
      ).rows;
    });
  }
  async consumeProof(
    db,
    p,
    proof,
    subject,
    expected,
    { action, intentHash } = {},
  ) {
    if (["delete", "consolidate", "repair"].includes(action)) {
      const prefix = action + ":";
      if (typeof subject !== "string" || !subject.startsWith(prefix))
        fail("OWNER_PROOF_INVALID", 403);
      subject = subject.slice(prefix.length);
    }
    const a = p.authorization;
    if (
      !a ||
      typeof proof !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(proof) ||
      !action ||
      !intentHash
    )
      fail("OWNER_PROOF_REQUIRED", 403);
    const r = await db.query(
      `UPDATE vault_review_grants SET used_at=clock_timestamp() WHERE proof_hash=$1 AND owner_id=$2 AND principal_id=$3 AND subject_id=$4 AND expected_revision=$5
   AND action=$6 AND intent_hash=$7 AND session_ref_hash=$8 AND identity_hash=$9 AND principal_epoch=$10 AND consent_epoch=$11
   AND used_at IS NULL AND expires_at>clock_timestamp() AND issued_at<=clock_timestamp() AND expires_at<=issued_at+interval '60 seconds' RETURNING proof_hash`,
      [
        hash(proof),
        p.ownerId,
        p.principalId,
        subject,
        expected,
        action,
        intentHash,
        a.sessionRef,
        a.identityHash,
        a.principalEpoch,
        a.consentEpoch,
      ],
    );
    if (!r.rows.length) fail("OWNER_PROOF_INVALID", 403);
  }
}
