# Phase 3.2 — owner-session revocation semantics

This is source-only remediation on draft PR #9. It authorizes no staging activation, deployment, live migration or credential operation. Phase 3.1 encrypted delivery, bounded recovery and assertion rules remain in force.

## Confirmed race and the effective revocation point

At baseline `108b6357cc8778d570657ebf569c2de0043b1f4e`, logout removed the primary Redis session family. A gateway request could already hold a shared PostgreSQL session lock and finish a sensitive decision afterward. Its final primary-store check could reject the HTTP response, but could not undo that commit. A deterministic control pauses credential activation immediately before COMMIT, deletes the Redis family, releases the transaction and verifies a committed credential and receipt. The control remains as a regression against overstating cross-system atomicity.

The corrected contract is **commit-ordered revocation**:

- PostgreSQL's durable session tombstone COMMIT is the effective fence for private authorization. Sensitive transactions acquire the existing shared session row lock before authorizing and retain it until COMMIT/ROLLBACK. The revoker takes an exclusive lock on the same row. An already admitted transaction may finish before the revoker obtains that lock. Revocation waits for it; it does not retrospectively cancel it.
- Once the revocation transaction commits, later authorizations, cached owner identities, outstanding challenges/grants, consent restoration, bootstrap and completion retries for that family fail. The private engine also rejects an owner identity that omits its session context.
- The owner logout endpoint returns 200 only after a validated SQL fence acknowledgment **and then** primary Redis-family deletion. Consequently, no sensitive decision for that family can commit after a successful coordinated logout. A new Google login creates a distinct family and requires fresh private consent.
- Login replacement retires its prior valid family through the same fence before issuing the replacement session. Token rotation preserves its existing family: it cannot escape a concurrent logout fence.

There is **no distributed transaction or atomic Redis/PostgreSQL COMMIT**. Redis primary checks still deny new gateway admission and discard stale responses. A raw Redis deletion, natural expiry, or an unavailable primary read is not a retroactive cancellation barrier for a transaction that has already been admitted. Administrative revocation must use the coordinated path, or explicitly obtain the same SQL fence before acknowledging completion. Expiry is checked at authorization; it is not a promise that a transaction is asynchronously interrupted at a wall-clock instant.

Already committed decisions, publication outbox work and previously issued agent credentials are not undone by session logout. Agent expiry/revocation is a separate authorization domain. SQL replay/quota records and sanitized denial diagnostics may still be written after a family is fenced; they confer no memory or credential authority.

## Cross-boundary implementation

`ownerController` accepts a server-only family-retirement callback. It receives only hashed family/identity and absolute expiry. CSRF, exact origin, current owner session and family are validated before invoking it. Logout and replacement login await it before deleting the Redis family. No token, proof or cookie enters the private request.

`lib/brain/private/connection.ts` shares the existing pinned TLS 1.3/ES256 transport with the BFF. It sends a new request-bound bootstrap assertion to `POST /v2/private/session/revoke` with an empty JSON body. A positive response must contain schema 3, a valid confirmation time and `{revoked:true, sessionRef:<the exact requested family>}`. 401, 503, timeout and malformed acknowledgments never count as success. Each retry has a new JTI; replay of the same assertion remains 401.

The gateway applies the existing actual-peer mTLS pin, signature/audience/lifetime, method/path/body/certificate binding, shared replay and quota checks. Revocation has a dedicated idempotent authority method rather than ordinary `resolve()`, which correctly rejects an already revoked SQL session. The method validates the primary family and immutable owner registry, inserts a missing family before fencing it, locks the session, checks exact identity/principal/expiry binding, and marks it revoked with consent disabled and a single epoch increment. Concurrent bootstrap cannot recreate a missing tombstone; duplicate revokers preserve its original timestamp and epoch. The normal post-operation primary and pin checks also remain.

Both private capability flags still default off. When either is requested, any private connection field is present, or a connection has already loaded in this process, owner-family retirement requires the SQL callback even if UI capability gates are off. Partial configuration fails closed; disabling the UI is not permission to bypass an existing SQL fence. A deployment with a private gateway must retain this callback/configuration on **every** owner-auth instance. Removing all private configuration from a fresh process while a gateway remains active is an unsupported operator configuration, not a distributed guarantee provided by this code. Qualify the complete deployment before activation.

## Failure and retry semantics

| Failure point | Result and recovery |
|---|---|
| SQL authorization/lock timeout or failed COMMIT | No successful logout; sanitized 503. Redis family is retained so the same authenticated, CSRF-protected request can retry. A rollback leaves no effective SQL fence. |
| SQL COMMIT succeeds, acknowledgment is lost | No success is claimed. SQL already denies the family. Retrying its same immutable binding confirms the existing tombstone without changing epochs or timestamps. |
| SQL fence confirmed, Redis deletion fails | 503; private authorization remains revoked even while the Redis owner-login family exists. Retrying repeats the idempotent SQL fence and Redis deletion. |
| Redis deletion succeeds, response is lost | The family is already invalid and cannot authenticate a new request. A 401 on retry is not fabricated as a new SQL acknowledgment. |
| Process stops between SQL and Redis | SQL denial survives restart. The still-present family permits a bounded caller retry; there is no automatic grant, compensating un-revoke or background loop. |
| Primary store, gateway, TLS/key or database unavailable | No confirmed logout. Existing admission/failure rules apply; dependency outages remain 503, invalid/revoked authentication is 401. |

Bounds remain: gateway concurrency 2, ten-second request/transport deadline, two-second SQL lock and primary/sink waits, five-second SQL statements. Each retry is an explicit request. A long admitted transaction can make revocation time out; the caller must retry and must not interpret 503 as completed revocation. Pending encrypted delivery tokens cannot activate after the SQL fence, and existing bounded cleanup cancels/erases them. Quiet-service cleanup/key/backup retention still requires the previously documented operator process.

## Additive migration 006

No applied migration 001–005 changes. The explicit administrator-only migration runner uses the ledger, prerequisite 005, checksum and transaction/advisory lock, with DDL rollback tests. It has no automatic startup/CLI/environment discovery.

006 removes issuer table-wide session UPDATE and permits only consent, consent epoch and revocation columns. API/PUBLIC gain no privileges. A trigger forbids changes to family/principal/identity/absolute expiry, epoch regression and any alteration of a revoked row. Issuer cannot delete a tombstone, clear revocation, restore consent or extend expiry. Existing proof issuance/consumption functions and their fixed search paths and ACLs remain unchanged. This is not Byzantine isolation from the trusted issuer or administrator; existing trust assumptions remain explicit.
