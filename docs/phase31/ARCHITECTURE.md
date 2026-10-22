# Phase 3.1 — credential delivery and assertion hardening

Source-only development on draft PR #9. No activation, merge, deployment, live migration or credential operation is authorized. Phase 3 remains the integration architecture; this document supersedes its sink/transaction ordering and adds explicit migration 005.

## Recoverable credential delivery

The workflow is a small durable saga, not an atomic transaction spanning a database and a secret manager:

1. Lock and validate the current owner/session/consent/epoch-bound fresh challenge. Prepare a random credential, its SHA-256 digest and an AES-256-GCM encrypted delivery intent. Commit the intent and bounded attempt count **before** calling the sink. No agent is inserted or rotated at this point.
2. Recheck the primary owner family, decrypt the committed intent, and call the injected sink outside a SQL transaction. Retries reuse the exact credential, delivery ID, expiry and generation. The sink wait remains two seconds and respects the request deadline.
3. Recheck the primary family, then lock the challenge and delivery. Issue and consume the existing action-specific bound grant. Activate the principal/rotation, erase the pending ciphertext, and store the owner receipt in one transaction. Only its successful commit authorizes the new credential. Two concurrent completions converge on one receipt.

A preparation commit failure performs no external write. Sink success followed by SQL failure leaves a committed, encrypted, inactive intent rather than an untracked orphan. After rollback its delivered token cannot authenticate. A restart with the same custody key can retry the exact intent. An uncertain successful activation commit is recovered from its receipt without redelivery. Lost sink acknowledgments repeat the same idempotent delivery. Rotation preserves the previous committed SQL credential until the replacement activates; a failed activation can temporarily leave the sink holding the pending, unusable replacement, so consumers must check authentication/receipt state and retry rather than infer readiness from a sink write.

Every call reloads authorization. Consent/session expiry, revocation, stale permission epochs and the original 120-second challenge/freshness bounds still deny activation. A completed challenge can return its durable receipt after expiry; an expired unfinished challenge cannot activate a pending token. Revocation neither decrypts a delivery nor calls the sink, and cancels/scrubs pending rotation intents atomically with revocation. A late sink write cannot reverse SQL revocation.

## Custody and sink contract

`PrivateAuthority` accepts an optional injected `deliveryKey`. By default it derives a purpose-separated 256-bit AES key with HKDF-SHA256 from the existing server-only cursor master (`neural-brain-v2` salt, `agent-delivery-v1` context). This introduces no environment variable or production composition. A distinct high-entropy master may be injected by separately approved composition. Key ID is a digest, never a key. AAD binds delivery ID, owner, principal, credential digest and exact expiry. The ciphertext exists only in issuer-readable `vault_agent_deliveries.sealed`; neither the API login nor browser can read it. Successful activation or cancellation erases it from the current row; database backup/WAL retention remains an operator custody concern.

Keep the same master through pending-intent recovery. Draining/cancelling pending jobs before key rotation is mandatory; this implementation has no automatic key ring or online key-rotation endpoint. Missing/wrong keys and tampered ciphertext fail closed with `DELIVERY_KEY_UNAVAILABLE`. Never silently regenerate a token for an existing intent. Key loss is visible and requires cancellation/new owner authorization after expiry, not a fallback key.

The injected sink's `write({handle, deliveryId, generation, token, expiresAt, signal})` must:

- Durably upsert by delivery ID and reject reuse with different bytes/expiry.
- Atomically fence the stable principal handle by the monotonically increasing SQL generation; an old delayed write cannot overwrite a newer rotation. The generation is a decimal string, compared as a bigint, not a floating-point number.
- Acknowledge only durable custody, handle repeated writes, honor cancellation, and never log arguments or errors containing secrets.
- Apply expiry/retention to invalid orphan material and support a separately reviewed purge process. No generic delete is attempted because deleting a stable handle could erase a newer credential.

The test sink implements durable-contract semantics in memory, including late-write fencing. No real secret-manager adapter or hosting integration is provisioned/certified. Before staging, the chosen sink must demonstrate these semantics across its own restart. Older simple injected writers still work for immediate synthetic happy-path tests; they are insufficient for staging qualification.

## Bounds, cleanup and diagnostics

One pending delivery per principal; five committed preparation attempts per challenge. A caller retry is explicit; no background loop or schedule exists. `cleanupDeliveries()` processes at most ten expired, cancelled-authority or stale pending intents using `FOR UPDATE SKIP LOCKED`, erases ciphertext and records a fixed outcome. It is invoked by completion and is available to explicitly injected maintenance composition. No daemon was activated. After a quiet service stops receiving completions, a separately approved operator must run bounded cleanup; SQL denial/expiry still protects pending tokens meanwhile.

Fixed diagnostics are `READY`, `SINK_UNAVAILABLE`, `ACTIVATION_UNCONFIRMED`, `DELIVERED`, `CANCELLED`, and `KEY_UNAVAILABLE`. No provider error text, token, encrypted plaintext, proof or session payload is persisted in diagnostics/audit. Request failures remain non-success envelopes; a diagnostics-storage failure does not become success. Exhausted retries return `DELIVERY_RETRY_LIMIT`; investigate and let expiry/cancellation erase the intent before a newly authorized request.

## SQL boundaries and additional evidenced correction

005 is additive and checksum-ledgered, with an explicit administrator client and rollback tests. Applied migrations 001–004 are unchanged. Runtime/API privileges remain unchanged. Issuer may select/insert delivery rows and update only ciphertext/status/attempt/outcome columns; it cannot rewrite delivery identity/digest/expiry or directly update principals, insert grants, change grant bindings, or mint an owner. Existing restricted admin functions remain unavailable to the API and PUBLIC.

Readiness inspection found that 004's SQL rotation function checked the one-hour global cap but did not enforce the shorter lifetime approved in the rotation intent. 005 replaces only that function body to enforce the approved lifetime too; its signature, owner, fixed search path and existing ACL remain. A native regression attempts a 600-second rotation under a 120-second grant and verifies refusal without consuming the proof or changing the old credential. The BFF previously computed the requested lifetime correctly; this correction tightens the separate SQL issuer boundary.

## Assertions and errors

JWT segments must be canonical base64url. Header/payload parsing reuses the bounded duplicate-member/unsafe-key/invalid-UTF-8 rejecting JSON parser. Both must be objects. Confirmation must be an object with exactly one own `x5t#S256` member, a 43-character base64url string equal to the actual pinned TLS peer digest. Missing, null, scalar, array, extra-member and malformed confirmation payloads return `INVALID_ASSERTION` / HTTP 401.

Signature/ES256 key, issuer, audience, lifetime, session/epoch, request method/path/body, certificate pin and SQL JTI replay checks are retained. Invalid authentication is distinct from SQL/key/configuration outages (503). The review's specific null-to-TypeError scenario was not reproduced: the former mismatch expression already short-circuited for null. Explicit shape validation still removes reliance on that expression ordering, and real mTLS negative cases enforce the desired HTTP contract. Duplicate signed JSON claims were accepted by the former generic JSON parser; they are now rejected deterministically.
