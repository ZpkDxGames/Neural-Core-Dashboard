# Phase 1b authentication stabilization audit — 2026-10-15

## Scope and runtime evidence

Repository: ZpkDxGames/Neural-Core-Dashboard. Starting development and Preview HEAD: `7053e93ebde8f78f93dba15b1ea2a2762063e89f`. Draft PR #6 remains stacked on `ops/encrypted-backup-recovery-canary`. Production Git/main and deployed source remain `75157ad2d60e337a326a1d459496bedfba4a0fab`.

Vercel project `neural-core-dashboard`, project ID `prj_srwcAU740BMJm2kRSUcEuUK7ExOE`, owning scope `zpkdxgames-projects`. The MCP connection lists the project but returns HTTP 403 for scoped project/deployment inspection: “Not authorized: Trying to access resource under scope zpkdxgames-projects.” No authenticated CLI is available. The already signed-in, user-authorized Work browser provides read access to the correct project.

The original live Preview deployment is `dpl_D7UWEv2pvSpEq9thB4Wsu29a2D7Y`, Ready, branch `preview`, commit `7053e93`. Its stable address is https://neural-core-dashboard-git-preview-zpkdxgames-projects.vercel.app and its immutable URL is https://neural-core-dashboard-oxetpin02-zpkdxgames-projects.vercel.app. The Vercel UI shows all eight required authentication variable names with Preview + branch `preview` scope. Separate Production entries also already exist. Values were not revealed or changed; their correctness, distinctness and Google redirect registration cannot be inferred from the names.

**Confirmed failure:** opening the deployed Settings reproduces “Authentication service unavailable.” The correlated sanitized function log for `/api/auth/owner/session` reports `[neural-core/owner-auth] OWNER_ORIGIN_HTTPS_REQUIRED` at approximately 2026-10-15 14:08 UTC. This configuration exception occurs before Redis construction or Google discovery. The old validator combines HTTPS, credentials and exact string-to-origin equality in one condition. It rejects a legitimate HTTPS root URL with a trailing slash as well as unsafe HTTP or embedded credentials. The log confirms the broken configuration boundary; it does **not** disclose which private value or exact formatting variant is present. No claim is made that Google or Redis was responsible for that initial failure.

## Implemented changes and security findings

| Finding | Correction / disposition |
|---|---|
| Fragile origin comparison and ambiguous log | Canonicalize a root HTTPS URL with optional trailing slash and edge whitespace. Continue rejecting HTTP, credentials, paths, query, fragment and backslashes. Distinct path and Preview branch/hostname diagnostics. No origin inference from forwarded headers. |
| Different deployments can reuse the same Redis key namespace | Version-2 namespace includes a hash of canonical origin, Google client ID and immutable owner subject. It never logs those values. Old Preview sessions no longer authenticate; records expire naturally. No credentials are rotated. |
| Rate-limit INCR and EXPIRE could be separated by a crash | Single Redis Lua operation increments and ensures fixed-window expiry, including repair of a counter missing its TTL. |
| Replica reads may lag shared revocation | Auth lookups use a primary/write EVAL with PEXPIRE preserving the remaining TTL. They do not use GET/EVAL_RO or extend the absolute eight-hour session lifetime. Actual multi-region provider behavior remains a live certification gate. |
| SDK retries can replay a destructive GETDEL or ambiguous write | Upstash SDK updated from 1.36.4 to pinned 1.39.0. Five-second operation timeout; automatic pipelining disabled; explicit `retry: { retries: 0 }`. Wire tests found that `retry: false` still attempts twice in this SDK. |
| Rotation/logout and stale-response races | A login creates a TTL-bound session family. Rotation consumes the old token and retains the family; logout revokes the family. A logout already validated during rotation revokes the replacement too. A request that finds an already-consumed token returns 401 and must recheck. GET session and losing rotation responses do not clear a newer browser cookie. |
| Incomplete Redis record validation | Validate subject, finite integer issue/expiry times, maximum absolute lifetime, random family format, active family and matching expiry. Pending logins have an application expiry as well as Redis TTL. Duplicate auth cookies fail closed. |
| Authentication failures lacked usable diagnostics | Server-defined event codes and opaque per-request references; browser receives only safe failure categories. No raw exceptions, tokens, account identity, cookies, callback query or environment values are logged. Callback failures return safe UI markers rather than raw provider errors. |
| Account/redirect trust | Pinned Google issuer; authorization code + PKCE S256; one-time state and browser binding; expected nonce; RS256 ID-token signature/JWKS verification; issuer/audience/expiry/authorized-party checks; exact `sub` + verified-email allowlist. No email-based account matching or identity/token exposure. |
| UI could misrepresent failed sign-out or stale status | Explicit disabled/configuration/storage/wrong-host states; bounded loading; support reference; callback cancellation/rejection feedback; session expiry/focus checks; cross-tab rechecks; failed sign-out never claims success. Callback opens Settings. Mobile wrapping preserves the existing design. |

Cookies remain `__Host-`, Secure, HttpOnly, SameSite=Lax, Path=/ with no Domain. Mutations require exact request origin, Origin header, acceptable Fetch-Site and HMAC CSRF. Endpoints retain private no-store headers, no permissive CORS, no-referrer and anti-framing policy. Google tokens remain server-side and are not persisted. Redis stores only ephemeral authentication transactions/session metadata, never memory content.

A shared 80-start/10-minute quota is retained. It can temporarily deny new logins after deliberate flooding; it is not an edge abuse-prevention substitute. Current credentials and Google consent/redirect settings are owner-controlled, unverified configuration. No new service, credential rotation or environment update is part of this source change.

## Verification

- Baseline: 21 tests passed before changes.
- Expanded controller/protocol/REST/route suite: 47 passed locally; one separate real-Redis test requires `NCORE_TEST_REDIS_PORT` and runs in CI.
- OIDC tests exercise **actual openid-client** with generated RSA signatures and synthetic discovery/token/JWKS HTTP responses: valid flow, PKCE wire fields, bad signatures, issuer/audience/nonce/expiry/authorized-party/subject, exchange errors, state/hostname mismatch and discovery recovery.
- Redis tests exercise **actual @upstash/redis REST serialization**, JSON round trips, SET NX EX, GETDEL, EVAL, quota, expiry, failure sanitization and no retries.
- CI now supplies isolated loopback Redis 7.4. A local synthetic REST bridge runs the real Lua, concurrent counters, TTL preservation, expiration and two-client rotation/revocation against Redis. It never contacts live Upstash or reads deployment secrets.
- Browser regression suite: **9 passed locally**. Covers disabled and guest states, safe configuration errors/retry, wrong-account callback, failed and successful logout, mobile layout, wrong-host rejection, CSRF replacement on refresh and cross-tab revocation recheck.
- TypeScript, optimized Next.js build and 11 existing backend contract tests pass. Existing local archive/sync-policy tests remain active. Build smoke verifies all disabled auth endpoints and client bundles exclude server-secret identifiers.

Synthetic signed tokens and browser response doubles are not real Google-owner login certification. A single-region CI Redis instance is not evidence of live Upstash failover or multi-region revocation behavior.

## Deployment and operator certification

The implementation may advance only the development branch and fast-forward `preview` after successful CI. Do not merge PR #6, move main, change Production variables, provision anything, enable memory synchronization or touch VPS/DNS/Caddy/Minecraft/PlexonPanel.

Use the stable Preview hostname for login, not the engineering branch or immutable deployment URL. The canonical callback must be that exact origin plus `/api/auth/owner/callback`, registered in the existing Google Web OAuth client. If the new precise diagnostic still reports a configuration failure, obtain explicit owner confirmation before correcting any sensitive environment setting. Never copy a credential or private subject into a PR, screenshot or report.

Before certification, on the updated exact Preview commit:

1. Verify `/session` gives signed-out status on the canonical origin and login reaches Google's account chooser with the intended callback.
2. Complete a real owner login. Confirm only a server session cookie is stored; no Google tokens/identity values are exposed to the page or logs.
3. Choose a non-owner account and confirm rejection, cancellation and a fresh retry.
4. Refresh the session; verify the old cookie is rejected. Sign out; verify the old and refreshed session are rejected from a second independent request/client, including after another function instance handles it.
5. Verify expiry, outage/recovery and Upstash revocation propagation/failover in an owner-approved test. Do not disrupt the live session store or rotate credentials without confirmation.
6. Reconfirm main/Production are unchanged and synchronization remains off. Only then consider a separately authorized production rollout.

**Certification status: NOT production-ready. Real Google owner login and deployed session revocation have not yet passed.**
