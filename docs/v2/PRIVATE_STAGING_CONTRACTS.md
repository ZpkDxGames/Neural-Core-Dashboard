# Private gateway, owner proof and provisioning — architecture only

Status: **not implemented, not activated, not deployment approval**. The default `unavailableVault` adapter continues to make no network requests. The machine V2 API remains disabled/unbound and rejects browser headers/cookies. This document fixes proposed staging contracts; it does not add an endpoint or authorize private/live data access.

## Boundaries and identities

Owner browser → same-origin Next.js BFF → private authenticated gateway → loopback engine → PostgreSQL/outbox/private vault. Browser archive import/storage remains local and separately consented. Google sign-in never implies remote memory access or archive transfer. The existing local canary token is excluded from this path and never given to Next.js/Vercel.

A separately approved staging network must admit only the BFF workload to a gateway over TLS 1.3 with mutual TLS. No public database port or generic localhost proxy. Before implementation, prove the selected hosting/tunnel path supports private connectivity and client certificates; otherwise stop with remote capability unavailable. No DNS, Caddy, Cloudflare, firewall or credential changes are part of this remediation.

BFF credentials and gateway credentials are distinct. BFF signs a request-bound ES256 JWT with a fixed pinned issuer/audience/algorithm/key set; private keys stay server-side. Gateway verifies both the configured mTLS client identity and JWT certificate binding. Each request requires:

```json
{
  "iss":"neural-brain-owner-bff-staging",
  "aud":"neural-brain-private-gateway-staging",
  "sub":"opaque-server-mapped-principal-uuid",
  "owner":"server-mapped-owner",
  "iat":0,"nbf":0,"exp":60,"jti":"random-128-bit-reference",
  "method":"GET","path":"/v2/memories/proposals",
  "request_sha256":"sha256(method + newline + canonical path/query + newline + body bytes)",
  "principal_epoch":1,"consent_epoch":1,
  "session_ref":"opaque-server-side-revocation-reference",
  "cnf":{"x5t#S256":"configured-client-certificate-thumbprint"}
}
```

Numeric time values above illustrate a maximum 60-second lifetime, not actual tokens. Canonical query: UTF-8 URL-encoded key/value pairs sorted by key then value, duplicates preserved; reject noncanonical paths, encoded slashes/dot segments, unknown query fields and duplicate scalar fields before signing. Digest actual bytes; GET has an empty body. Gateway permits ≤5 seconds clock skew, atomically consumes `jti` until expiry, denies replay/mismatch and rechecks principal/consent epochs and session revocation online. A failed authorization store fails closed; no cached positive session grants during an outage. Any future short revocation cache requires separate review.

The gateway resolves identity from a trusted server registry and current SQL state, never from a browser owner/role/scopes header. Delegated scopes are intersected with registry scopes and current consent. Backend runtime keeps DML-only grants; identity/proof provisioning stays outside `neuralcore_api`. Tokens, session refs and proofs never appear in logs, URLs or browser storage. Logs contain sanitized request ID, action category and outcome only; bounded private audit contains IDs, not note bodies.

## BFF and adapter contracts

All proposed BFF routes are `/api/brain/v2/*`, same-origin, owner-session-only, `Cache-Control: no-store, private`, `Vary: Cookie`, no CORS. Preserve existing immutable Google `sub` allowlist, verified-email requirement, PKCE/state/nonce/JWKS validation, session-family revocation, Secure/HttpOnly cookie and CSRF/origin defenses. Session reads are primary; mutations require exact origin plus existing CSRF header/cookie binding. Reject cross-site and oversized/ambiguous input. This plan does not relax the existing auth controller.

| Proposed browser route | Private operation | Contract |
| --- | --- | --- |
| GET `/proposals` | GET `/v2/memories/proposals` | F-01 filters/cursor; map snake-case fields defensively |
| GET `/notes`, `/notes/{uuid}` | bounded memories list/detail | Published revisions only; never pending bytes |
| GET `/graph` | bounded graph | ≤300 nodes, ≤900 edges; disclose partial view |
| GET `/status` | sync status | Per-layer confirmations; login ≠ connected/synced |
| POST `/review-challenges` | issuer challenge | CSRF + owner session; exact subject/revision/decision |
| POST `/review-challenges/{id}/complete` | proof issue + private review | Step-up + confirmation; return actual backend acknowledgement |

Request body limit 240,000 bytes, response cap 262,144 bytes, list cap 50, per-principal quota 60/minute, gateway/engine max two concurrent requests, request deadline ten seconds. Retry only safe reads or an idempotent operation with unchanged key/payload; a review with an uncertain acknowledgement is queried before retry, never optimistically removed from UI. A gateway outage maps to an unavailable/error envelope, never an empty successful page.

Adapter outputs are `VaultPort`/`DataEnvelope` in `lib/brain/{ports,types}.ts`, distinct from machine payloads. Preserve `nextCursor`, map explicit `partial` to a partial envelope, and omit unreported totals. SQL evidence IDs do not imply browser-resolvable raw messages: mark resolution unknown unless a separately consented source adapter verifies it. Origin is remote only after authenticated confirmation. Agent registry access remains owner-only. Browser role names currently exclude `owner`; a future adapter must explicitly model owner actors without mislabelling them as agents. Schema changes require adapter contract and parity tests, not unsafe casts.

No adapter is selected until the private capability is explicitly configured, the owner has granted remote-memory consent and a fresh session has been validated. Consent revocation disables requests immediately, cancels in-flight responses, clears tab-only caches and invalidates gateway consent epoch. Do not add persistent drafts/activity stores, provider account scraping or automatic archive sync.

## Google step-up and one-use review grants

Proposed challenge input:

```json
{"subjectId":"proposal UUID","expectedRevision":3,"decision":"verify","intentSha256":"hash of immutable proposal payload"}
```

Validate current owner, consent, scopes, proposal visibility/status/base revision and intent hash before creating a challenge. `decision` is exactly `verify`, `publish-unverified` or `reject`; challenge TTL is 120 seconds and at most five challenges may be active per session. Store only hashes of opaque references. Bind challenge to session family, immutable Google subject, principal/consent epochs, exact action/subject/revision/intent and expiry. The browser cannot select an owner or machine principal.

Reuse PKCE/state/browser binding/nonce and pinned Google JWKS/issuer checks for a distinct step-up authorization attempt. Request `max_age=0` and account selection; **require a signed `auth_time` within 120 seconds** and the same allowlisted `sub`. `iat`, a successful account chooser or an old session alone does not prove fresh authentication. If Google/configuration does not supply qualifying freshness, keep issuance disabled and report `STEP_UP_UNAVAILABLE`; staging must qualify this behavior, without weakening it to a silent session refresh. Consume state/challenge atomically; step-up cannot replace the current session on a failed/mismatched identity.

The private issuer generates 32 random bytes (base64url 43 characters), stores SHA-256 only, and issues a ≤60-second one-use grant. **Current schema 003 binds only principal/owner/subject/revision/expiry. It cannot fully enforce decision, session, intent or epochs.** Before staging, add and review a new checksum-ledger migration 004 with `action`, `intent_hash`, `session_ref_hash`, `principal_epoch`, `consent_epoch`, a strict expiry bound and a restricted grant-insertion function/issuer role. Never edit applied migration 003. Extend atomic consumption to check all bindings in the same review transaction. The engine API role must still be unable to insert grants or principals or mutate immutable revisions.

Keep the grant secret between issuer/BFF/gateway/loopback service; return only an opaque challenge/receipt to the browser. A browser-supplied `x-owner-proof` is never forwarded. Consume proof and review atomically so rollback cannot acknowledge a mutation that failed. Return confirmed publication state from the engine (`pending` is not vault committed). Deletion, repair, consolidation and provisioning require separate action-specific challenges, never reuse a verify grant. Rate-limit challenges, issuances and failed completions; audit only IDs/outcomes.

## Controlled agent provisioning

Proposed private admin `POST /admin/agent-grants` requires fresh owner step-up bound to `provision-agent`, approved consent and an immutable permission request:

```json
{"displayName":"Synthetic staging agent","role":"contributor","scopes":["read","propose","type:reference"],"expiresInSeconds":3600,"idempotencyKey":"opaque-at-least-8-chars"}
```

Allow `viewer`, `contributor`, `maintainer`; never `owner` or `kind:owner`. Scope allowlist is `read`, `propose` and explicit `type:fact|project|decision|reference`; no review/delete/export/provision rights for agents. Viewer cannot propose. A grant cannot exceed owner policy; require at least one explicit type scope in initial staging, ≤16 total scopes, ≤1-hour staging credential lifetime and one explicitly simulated agent initially. Provider integrations are absent.

Migration 004 must add credential expiry and principal permission epoch, enforced on every authentication/authorization. Generate the existing `nbv2_` + 32-random-byte token shape privately; store hash only. Provisioning API returns principal metadata, scopes, expiry and a nonsecret credential handle. Deliver its secret directly to the synthetic agent’s isolated server-side secret sink, never via the browser, PR, localStorage or logs. No provider account or credential is provisioned by this document.

Rotation inserts a new credential epoch and revokes the old credential, outstanding cursors, delegated tokens and pending grants atomically. Revocation must work during concurrent requests; freeze outstanding proposals for review rather than publishing them. A separate admin role/function performs provisioning; runtime SQL cannot mint a principal or elevate itself. Tests must cover confused-deputy requests, duplicate/expired grants, role/scope downgrades, revocation races, partial secret-delivery failure and idempotent recovery.

## Implementation stages and gates

1. Review this threat model, action bindings, hosting/private path and expiry/consent policy. Keep all runtime gates off; add no network changes.
2. In disposable local infrastructure, implement migration 004 + scoped issuer/admin functions, request-bound gateway verification, fresh owner step-up and simulated provisioning. Extend existing OIDC/CSRF/revocation tests with wrong owner/audience/cert/digest/intent, replay, expired freshness, outages and downgrade races. No source/proof text may reach logs.
3. Implement defensive adapter mapping behind opt-in configuration, still defaulting to `unavailableVault`. Test end-to-end signed owner review to durable acknowledgement and delayed publication, offline/cancellation/revocation and evidence privacy with synthetic fixtures. Preserve 141 original browser cases and add gateway journeys.
4. Present exact commit/CI, config diff, ports/hosts, secret custody and rollback procedure. **Separate owner approval is required before isolated staging activation.** Private connectivity and Google behavior must be proven in staging before any real provider access.
5. **Separately approved paired encrypted recovery:** stop all writers/editors, snapshot matching SQL+vault+manifest under off-VPS key custody, encrypt both, restore to a disposable isolated pair, verify revisions/hash/evidence/tombstones and deny resurrection. Existing SQL-only restore is insufficient; current >10k checkpoint gate remains.
6. **Separately approved VPS capacity work:** propose a disposable resource envelope and stop thresholds, then measure cgroup CPU/RSS/IO/pressure/PostgreSQL WAL and actual Minecraft TPS/MSPT. No current budget is inferred or changed. Real providers, merge, deployment and production migration each require a later explicit owner go/no-go.

No live recovery, Oracle access, public ingress, provider sync, credential/network/DNS change or Minecraft/PlexonPanel operation is authorized here.
