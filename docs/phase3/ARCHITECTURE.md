# Phase 3 architecture

## Boundaries

The browser owns its existing IndexedDB archive. A new tab-only adapter calls only `/api/brain/v2/*` after an explicit owner action and confirmed remote-memory consent. It has no database URL, private bearer credential, service signing key or owner grant. Archive import/export/delete and the local graph retain their existing paths.

Next.js validates the existing Google owner session and primary session-family record through shared helpers from `owner-core.ts`. Login, PKCE, nonce, state, immutable owner-sub allowlisting, verified email, session rotation, CSRF and family revocation retain their existing behavior. There is no second login authority. Memory step-up has a separate cookie, state namespace and callback; it never creates or replaces the login session.

The BFF uses a fixed-origin HTTPS transport with a server certificate pin, private CA, client certificate and TLS 1.3. It signs an ES256 assertion for each request. The gateway verifies the actual TLS socket and client certificate, pinned issuer/audience/algorithm/key, method, canonical path/query and actual body bytes. Header-based TLS identity and browser owner/proof headers are rejected. No arbitrary URL proxy, redirect following or fallback canary token exists.

The gateway resolves the configured owner principal through an administrator-owned immutable Google-sub hash mapping. It checks the existing primary family store on every request, then current SQL identity, consent, revocation and permission epochs. A bootstrap assertion with zero epochs can only establish/read session capability or change consent. It cannot read notes, proposals, graph, agents or publication status. Normal operations require current nonzero epochs and active consent. Both request start and response delivery check the primary family; writes check SQL authorization again inside their transaction. Revocation linearizes against in-flight SQL operations through shared/exclusive row locks. A transaction committed before revocation may still have an uncertain response; its durable receipt is the recovery boundary.

## Authority and migration 004

001–003 remain byte-for-byte unchanged. `applyPrivateMigration` has no CLI/default URL and requires migration 003, an explicit client, an advisory migration lock and the checksum ledger. A failed ledger insertion rolls back DDL. Historical unbound grants are invalidated and retained as used audit records.

004 adds permission epochs, credential expiry, synthetic-agent constraints, owner identity mapping, private sessions/consent epochs, SQL assertion replay/quota storage and owner challenges. Runtime SQL can select identities and consume grants by updating **only `used_at`**. It cannot insert grants, change their binding columns, create principals, change consent or invoke issuer/admin functions. The separate restricted issuer login can create session/challenge state and execute a fixed-search-path grant function. Synthetic administration requires an already issued, fully bound one-use grant; the SQL function validates session/owner/intent/epochs, fixed agent kind, scope allowlist, type scope, lifetime and current agent epoch. No function accepts an owner role for an agent.

`PrivateMemoryEngine` enforces schema-004 bindings. The old engine also rejects expired/revoked/stale-epoch agent identities when it sees 004 columns, and refuses owner-proof consumption under 004 (`PRIVATE_ENGINE_REQUIRED`). This prevents accidentally mounting the old machine handler as a proof-binding bypass. Original schema-003 regression fixtures remain supported without changing their assertions.

## Owner review

A challenge validates the current proposal, base/current revision, action and immutable proposal hash. It expires after 120 seconds; no more than five active challenges per session are allowed. A separate Google authorization attempt requests `max_age=0` with PKCE S256, state, nonce and account selection. The real `openid-client` adapter requires signed RS256 ID tokens, pinned Google issuer/JWKS and `auth_time`; access additionally checks the same owner and freshness within 120 seconds and the challenge creation boundary. `iat` is insufficient.

The BFF marks the exact challenge fresh over its authenticated private path. The browser then inspects the exact decision, subject, revision, intent digest and inert proposal preview before confirming. A restricted SQL function inserts a random 32-byte grant's SHA-256 hash with at most 60 seconds validity. Grant insertion, atomic consumption, review/outbox mutation and durable challenge receipt commit together. A failed decision rolls all of them back. Neither the plaintext grant nor a machine credential is returned to the browser.

Receipt queries and idempotent completions may recover a committed decision after its challenge expires, while the same current session/consent/epochs still authorize it. An unconsumed expired challenge cannot issue a grant. `pending` acknowledges a database/outbox decision; only the existing worker's filesystem/hash acknowledgment exposes a published revision. TLS interruptions never justify optimistic publication.

## Synthetic agents

Only viewer, contributor and maintainer roles are allowed; scopes are `read`, `propose` and explicit memory types. Viewer cannot propose. Review, delete, export, provision and owner authority are excluded. Initial policy permits one non-revoked synthetic agent per owner, credentials up to one hour and no real provider. Expired/revoked/rotated credentials and stale identity objects are denied at authentication and authorization. Permission changes automatically advance the epoch. Existing proposals remain unverified for owner review after revocation.

Secrets are generated server-side and delivered only to an injected isolated secret sink under a bounded deadline. Public receipts contain a nonsecret handle and expiry. Sink failure or timeout rolls back principal/grant/receipt changes. A late sink write after rollback contains an invalid credential; retries replace the same handle. An uncertain database commit must be reconciled through its receipt before secret delivery is retried. Revocation succeeds independently of sink availability. A provision idempotency key cannot be reused for a different subject, intent or authorization context.

## Bounds and recovery

Gateway concurrency is two; SQL pool recommendation remains two. Bodies are capped at 240,000 bytes, responses at 262,144; JSON rejects duplicate/unsafe keys, invalid UTF-8 and depth over 32. Lists cap at 50, graph at 300 nodes/900 edges/depth three, principal quota at 60 requests per minute, requests at ten seconds. Bootstrap calls count against that quota, so one browser operation can consume two requests. Primary-session and secret-sink dependencies have two-second bounded waits. Transaction wrappers check request deadlines before/after SQL and before commit; statement/lock timeouts remain five/two seconds. No watcher, schedule, embeddings or background synchronization is introduced.

The default Next composition requires both `NCORE_BRAIN_PRIVATE_ENABLED=1` and `NCORE_PRIVATE_STAGING_CERTIFIED=1`, then complete server-only identity/TLS/signing configuration. Fresh authentication additionally requires `NCORE_GOOGLE_FRESH_AUTH_QUALIFIED=1`. These are operator attestations, not proof supplied by code. All remain absent/off in this task. Runtime/key changes require process restart; there is no hot secret rotation endpoint.

The HTTPS gateway has an explicit factory and no listener/configuration side effect. No public ingress or database listener is provisioned. The current production `backend/server.mjs` remains unchanged. Future composition must supply a separately authenticated issuer pool, current family-store verifier, certificate/key pins and synthetic secret sink. Native capacity, cryptographic key custody, network topology and real Google behavior require the staging checklist.
