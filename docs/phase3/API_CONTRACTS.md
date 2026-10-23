# Phase 3 API and defensive adapter contracts

All responses are private/no-store with no CORS. BFF responses vary on Cookie; gateway responses vary on Authorization. Errors contain only fixed code identifiers. No request, provider token, family reference, grant, note body, key or credential is logged. Private gateway audit output is limited to action/outcome categories; existing bounded engine audit contains identifiers, not note bodies.

## Browser routes

| Method / `/api/brain/v2/` suffix | Private operation | Conditions |
|---|---|---|
| GET `capability` | GET `/v2/private/session` | Owner session; no memory content; exposes only configured/consented/freshness capability and sync=false |
| POST `consent` | POST `/v2/private/consent` | Exact origin + existing CSRF; `{granted:boolean}`; advances consent epoch |
| GET `notes`, `notes/{uuid}` | GET `/v2/memories[/{uuid}]` | Current session/consent/epochs; published revisions only |
| GET `proposals` | GET `/v2/memories/proposals` | Preserves signed pagination, status/type filters, principal author kind/role, immutable payload hash |
| POST `proposals` | POST `/v2/memories/proposals` | Strict note input, optional noteId/baseRevision, required idempotencyKey; never copies an archive automatically |
| GET `graph` | GET `/v2/graph` | Bounded focus/depth/limit; explicit partial response |
| GET `status` | GET `/v2/sync/status` | Gateway confirmation separate from last worker publication acknowledgment |
| GET `agents` | GET `/v2/agents` | Owner only; principal kind, scopes, expiry and disabled state; never credential hashes |
| POST `review-challenges` | POST `/v2/private/review-challenges` | Exact subject/revision/action/intent digest; fresh-owner action required |
| POST `review-challenges/{uuid}/start` | Distinct Google step-up | CSRF, bound browser cookie/state/nonce/PKCE; qualified freshness required |
| GET `step-up/callback` | POST `…/{uuid}/fresh` | One-use state and browser/session binding; signed same-owner `auth_time`; redirect carries challenge ID only |
| GET `review-challenges/{uuid}` | GET `/v2/private/review-challenges/{uuid}` | Exact decision/subject/revision/hash/preview and durable receipt; never a grant |
| POST `review-challenges/{uuid}/complete` | POST `…/{uuid}/complete` | CSRF and explicit confirmation; fresh challenge; atomic one-use grant + decision + receipt |

All other BFF paths/methods fail. There are no generic browser DELETE/repair/consolidation proxy routes, raw-message retrieval or archive synchronization. Deletion, consolidation and repair use separate action-specific challenges and the same fresh authentication/confirmation path; they cannot reuse a verify grant. Repair requires an explicitly supplied private worker; missing composition fails closed.

Successful machine/BFF envelope: `{schemaVersion:3, confirmedAt:ISO8601, data:…}`. `confirmedAt` acknowledges that response, not Markdown publication or source resolution. Failures are `{error:FIXED_CODE}` with a non-success HTTP status. A failed gateway must never become an empty ready collection.

Proposal queue items retain `proposal_id`, `note_id`, `principal_id`, `base_revision`, `payload`, `payload_hash`, `state`, timestamps and bounded `author` metadata. Review challenge input uses `intentSha256=payload_hash` of the immutable proposed intent, rather than a hash of display text. Existing machine schema-2 routes retain their original envelope and are not public ingress.

## Service assertion

Fixed issuer `neural-brain-owner-bff-staging`, audience `neural-brain-private-gateway-staging`, ES256 P-256, exact pinned kid. Maximum lifetime 60 seconds; the transport uses 45. Future clock tolerance is five seconds; expired assertions are refused without extending their lifetime. The configured certificate pin is SHA-256 hex; JWT `cnf['x5t#S256']` is the standard base64url encoding of that digest.

Claims: `iss,aud,sub,owner,iat,nbf,exp,jti,method,path,request_sha256,principal_epoch,consent_epoch,session_ref,identity_hash,session_expires_at,cnf`. Unknown fields/algorithms/keys fail. The principal/owner are server-configured and matched against the SQL owner identity registry. Session reference is a hash of the existing family identifier; online verification uses the primary family's existing hashed key namespace, without copying a cookie/token to the gateway.

Digest: SHA-256 of UTF-8 `METHOD + newline + canonical target + newline` concatenated with actual body bytes. GET body is empty. Canonical paths contain only fixed route characters and cannot contain percent encoding, duplicate slash, backslash or dot segments. Query key/value pairs use URLSearchParams UTF-8 encoding sorted by key then value, retaining repetitions. Each route rejects unknown keys, duplicate scalar parameters and invalid bounds. Gateway also requires the actual raw target to already be canonical. JWT JTI hashes are consumed atomically in shared SQL until expiry; store outage denies access. Quota storage is also shared SQL.

## Proof and provisioning input

Review decisions: `verify | publish-unverified | reject`. Other memory actions: `delete | consolidate | repair`. Provision operations: `provision-agent | rotate-agent | revoke-agent`. All are bound to the current owner, exact session family and immutable identity, subject, expected revision/epoch, action, intent hash, principal epoch and consent epoch. Grant secrets are issuer-internal random 32-byte values, hash only in PostgreSQL, one use and at most 60 seconds.

For `provision-agent`, `permissionRequest` is exactly `{displayName,role,scopes,expiresInSeconds,idempotencyKey}`. Canonical intent uses that property order and lexically sorted unique scopes; `intentSha256` hashes its JSON UTF-8 bytes. `subjectId` is the proposed synthetic principal UUID; expectedRevision is zero. Rotate/revoke use `{principalId,permissionEpoch[,expiresInSeconds]}` in that order and expectedRevision=current permission epoch. Scope and lifetime restrictions are enforced again by SQL, not only by the browser. Same-key/changed-intent attempts conflict. A delivered credential never appears in the public response.

## Browser adapter

`createSameOriginVault` implements VaultPort, with additional explicit capability/connect/consent, review start/receipt/completion and proposal-edit operations. It is never substituted for the default unavailable port without server capability and user action. It maps snake-case fields, bounds arrays/strings/UUIDs/revisions, validates verified-owner metadata, preserves cursors/partial, omits unreported totals and models an owner actor explicitly. Evidence is marked unresolved and consent unknown; SQL evidence existence does not authorize reading a raw browser message.

Proposal edits preserve the original returned title/type/tags/evidence and typed relations; only an explicit editor submission sends a new body. It does not upload local conversations. Notes, grants, sessions and receipt caches are not persisted to IndexedDB/localStorage. A generation counter and AbortController set discard late responses after disconnect/revocation/offline. Owner session broadcast changes invalidate the private connection. Safe reads may be retried by the user; writes preserve their original idempotency key. An uncertain decision is recovered via its durable receipt before another completion is attempted.

Destructive/recovery action permissionRequest is `{noteId,expectedRevision,consolidateInto}` for delete/consolidate (null target for delete), or `{eventId,expectedRevision,expectedHash}` for repair. Hash the canonical fields in that order; expectedHash is the current outbox expected_hash or null. The issuer derives and checks the intent against current SQL; the worker checks current filesystem bytes before retry. Subject IDs remain UUIDs, action is a separate binding, and the private engine normalizes the legacy internal delete:/consolidate:/repair: prefixes only for that matching action. Completed tombstone receipts never return deleted note bodies.
