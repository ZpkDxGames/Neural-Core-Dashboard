# Phase 3 test report — development checkpoint

This report distinguishes original regression coverage, synthetic integration, native CI and real staging. No live security or production certification is claimed.

## Local execution

- Fresh locked root and backend dependency installs completed. Strict TypeScript and optimized Next.js/Webpack production builds passed.
- Original unit/auth/protocol/real Redis suite: **53 passed, 0 failed/skipped**, using an isolated Redis 7.0.15 process.
- Original Brain contracts/lifecycle: **32 passed, 0 failed/skipped**. V2 parser/filesystem/API: **15 passed, 0 failed/skipped**. V2 PostgreSQL-WASM integration: **16 passed, 0 failed/skipped**, serialized by its explicit test adapter.
- Original complete Playwright suite: **141 passed**, no original assertion changed, including owner authentication, XSS, responsive/theme coverage, axe accessibility checks, local storage/import/export, worker/protocol coordination, lazy software WebGL lifecycle and performance measurement.
- New private unit/adapter/BFF/actual signed OIDC/session/deadline contracts: **21 passed, 0 failed/skipped**.
- New private integration: **13 passed, 0 failed/skipped** using actual loopback TLS 1.3/mutual certificates, real PostgreSQL semantics in WASM, separate simulated SQL roles, physical synthetic Markdown files and actual signed RSA OIDC tokens. This adapter serializes transactions and cannot certify native concurrent scheduling; CI must do that separately.
- Private browser journeys use a separately gated server with explicit synthetic HTTP fixtures, not real Google/remote infrastructure. Results/evidence are retained alongside this report. They test consent, revocation, inert note/evidence rendering, failed freshness, gateway failure, graph and credential-expiry UI, plus serious/critical axe checks.
- Token/status lint, parity, dependency audit and client-secret exclusion are included in the final checkpoint/CI evidence. Earlier dependency-only local native-backend execution reported 11 passed and 2 native cases skipped; these require native CI and are not represented as local passes.

Local Node is 24.19.0; Chromium is 153.0.8010.0 from a scratch-only test runtime, with software SwiftShader. The normal Playwright CDN archive was unusable in this environment; no project dependency or browser assertion was changed to bypass it. Native PostgreSQL could not initialize under this session's single mapped root UID; no system identity/security bypass was used. Disposable WASM local results are labelled accordingly. GitHub CI uses native PostgreSQL 16, Redis and its installed Chromium runtime.

## Coverage and meaningful failures corrected

The tests reject wrong certificates/CA/pins/TLS version, wrong issuer/audience/algorithm/key/request digest, replay, unknown/duplicate queries, duplicate/unsafe JSON fields, missing/expired owner session, revoked consent, epoch changes, unauthorized role/type, missing/stale/mismatched signed freshness, expired or replayed/cross-action/cross-session grants and stale decisions. They exercise SQL migration checksum/rollback/least privilege, two concurrent completions, lost acknowledgment/receipt recovery, grant/decision rollback, deadline rollback, synthetic sink failure, HTTP synthetic-agent read/propose, scope downgrade, expiry, rotation and revocation. The original V2 suite retains worker crash-window, competing-revision, tombstone, source-deletion and checkpoint tests.

An early local run caught a strict SQL expiry check comparing a JavaScript-generated timestamp with the earlier transaction timestamp; challenge expiry now comes from the same SQL timestamp as creation. Another found that SELECT FOR SHARE would require excess runtime UPDATE privileges; a narrow fixed-search-path lock function now obtains authorization locks without granting those privileges. The added graph browser test originally selected both layers of the renderer as one Playwright locator; it now asserts the expected two canvases and inspects visibility explicitly. These were corrected, not skipped or removed.

## Native CI and delivery

The workflow retains the complete original regression suite and adds a fresh `ncore_phase3_test` database with distinct API and issuer logins. It runs private contracts, real TLS/SQL/OIDC/outbox/vault integration and the opt-in browser suite. Exact commit/run IDs and final outcomes are appended after remote execution. Until then this is a local source checkpoint, not a native CI pass.

All fixtures, certificates, accounts, memory content and credentials are synthetic. Certificates/private keys are generated under temporary directories and removed; they are not packaged. No original tests were deleted or weakened. No live user data, real account step-up, deployment, production migration, VPS service or provider was used.
