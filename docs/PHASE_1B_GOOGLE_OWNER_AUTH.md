# Phase 1b — Google OIDC owner authentication (Preview)

> Current stabilization findings, runtime evidence and certification gates: [2026-10-15 audit](PHASE_1B_AUTH_STABILIZATION_AUDIT_2026-10-15.md). The sections below preserve the original architecture/provisioning proposal; the owner has since configured the existing Preview environment. Production release and remote synchronization remain unapproved.

**Status:** implementation in draft [PR #6](https://github.com/ZpkDxGames/Neural-Core-Dashboard/pull/6). This is source and synthetic test authorization only. **The user has approved Upstash Redis free tier as the session-store provider; account/database creation and credentials remain an owner-controlled setup step. No production Vercel configuration, Google OAuth client provisioning, remote sync, DNS, Caddy, or Oracle changes are authorized.**

## Architecture decision ADR-1B-02

- Identity: Google OpenID Connect authorization-code flow with **PKCE S256**, per-request **state** and **nonce**, implemented with `openid-client 6.8.8`. The library validates signed Google ID tokens (JWKS), issuer, client audience, expiry, expected nonce, code verifier and callback state. Only the exact allowlisted Google **`sub`** with `email_verified=true` can establish a session. Email is never the account primary key; there is no signup.
- Identity web surface: `/api/auth/owner/start`, `callback`, `session`, `logout`, `rotate` in Next.js, server-side only. Disabled unless `NCORE_OWNER_AUTH_ENABLED=1` **and** every setting passes validation. Unconfigured deployment returns `503 AUTH_NOT_CONFIGURED` and remains local-only.
- Sessions: separate **session-only** Redis-compatible REST store (`@upstash/redis`, Upstash free tier approved; not provisioned). This is NOT a second conversation or memory database. Redis contains five-minute OIDC pending transactions and eight-hour revocable sessions (hashed random bearer IDs as keys). Redis receives no conversations, memory nodes, message excerpts, email claims or Google tokens. Flow records contain only state, nonce, verifier and hashed browser cookie binding; TTL 300 seconds. Logout deletes the shared session record. Rotation atomically consumes the old key with GETDEL before issuing a new session cookie (fail closed on storage error).
- Cookies: randomized opaque `__Host-nc-owner` and `__Host-nc-google-flow` cookies, `Secure; HttpOnly; SameSite=Lax; Path=/`, no localStorage or `NEXT_PUBLIC_*` secrets. Auth endpoints emit `Cache-Control: no-store, private`, restrictive CSP, no CORS permission.
- CSRF: mutation requests require exact allowed `Origin`, safe Fetch Metadata policy and header `X-NCore-CSRF` computed via HMAC of session token using server-only secret; token is retrieved from authenticated `GET /session`. No CSRF header => 403, even when cookie is valid. Login callback requires both single-use state and same-browser flow binding.
- Rate limit: shared server-side 80 auth starts per ten-minute window; does not trust spoofable IP headers. This is a conservative pre-staging default, not a substitute for edge rate-limiting.
- No persistent user-data access: these endpoints ONLY issue and manage login sessions. They do not proxy requests to Oracle, expose API ports, store private archives, or enable dashboard synchronization. Existing `NCORE_MEMORY_API_ENABLED` stays 0.

## Preparation and configuration (template; DO NOT add live values yet)

The operator must obtain a Google OAuth Web Application client ID and secret, with exact approved redirect URI `https://APPROVED_DASHBOARD_HOST/api/auth/owner/callback`. The application must be approved for exactly the desired trusted origin, with testing/consent-screen audience configured intentionally. Verify the owner's `sub` from a **cryptographically verified** ID token in a controlled setup, not from an email guess or JWT decoder. Never paste identity tokens or secrets into a public PR.

A persistent session-only REST Redis URL/token would also need to be selected and approved. Do not create this resource or add secrets to Vercel without owner confirmation; production scale, third-party retention/residency, and free-plan availability are part of the decision. All example values below are placeholders, not credentials:

```dotenv
# Enabled only for an explicitly approved isolated staging environment
NCORE_OWNER_AUTH_ENABLED=0
NCORE_OWNER_AUTH_ORIGIN=https://APPROVED_DASHBOARD_HOST
NCORE_GOOGLE_CLIENT_ID=GOOGLE_OAUTH_WEB_CLIENT_ID.apps.googleusercontent.com
NCORE_GOOGLE_CLIENT_SECRET=SERVER_ONLY_GOOGLE_SECRET
NCORE_GOOGLE_OWNER_SUB=VERIFIED_GOOGLE_ACCOUNT_SUB
NCORE_AUTH_REDIS_URL=https://APPROVED_SESSION_STORE_HOST/
NCORE_AUTH_REDIS_TOKEN=SERVER_ONLY_SESSION_STORE_CREDENTIAL
NCORE_AUTH_CSRF_SECRET=SERVER_ONLY_RANDOM_32_PLUS_BYTES_BASE64URL
```

**Production hold:** No values added to Vercel, no production deployment, no external endpoint changes; all `NCORE_OWNER_AUTH_*` absent in production must remain a strict 503. `NCORE_GOOGLE_OWNER_SUB` is a validated immutable Google subject, NOT an email and NOT the older Oracle bearer token. Use separate credentials for each preview/staging origin and each OAuth redirect URI; reject untrusted preview URLs with configuration mismatch.

## Isolated test scope

`tests/owner-auth.test.mjs` tests the controller with fake Google responses and a TTL-aware fake multi-instance store. It covers disabled/malformed config, account `sub` and `email_verified`, PKCE state/nonce plumbing, callback binding and replay, no-session unauthorized access, safe cookies, login flooding, CSRF/origin rejection, rotation, logout, revocation and expiry. This **does not** simulate a real Google-issued signed JWT, OAuth consent screen, actual multi-region Redis failures or Next.js browser behavior. Those require dedicated staging tests after credentials/store approval.

Build only in GitHub CI with synthetic identities. Run `npm ci && npm test && npm run typecheck && npm run build`; `npm ci --prefix backend && node --test backend/*.test.mjs`. No production integration smoke tests were performed.

## Next security gates requiring separate approval

1. Upstash Redis free tier is approved for session storage; owner must create an isolated staging database and review the chosen region, privacy/data-retention settings, and credentials before configuring staging. Never commit REST URL or token.
2. Approve exact dashboard staging origin and Google OAuth callback origin; provision Google credentials only in private provider dashboard.
3. Perform end-to-end Google login in **approved staging** and verify wrong accounts, revoked sessions, malicious origin, replay and OAuth-denied behavior.
4. Review owner-authorized HTTPS BFF→Oracle ingress separately. **No network changes, remote-memory read/write or cloud sync permitted by this auth approval.**
5. Validate browser E2E, disaster recovery of sessions (revocation on loss), uptime budgets, audit/rate-limit metrics and production go/no-go. Sessions are intentionally invalidated after session-store loss instead of silently recreated.

## Security boundaries

A successful Google owner login **does not** grant direct PostgreSQL access or automatically sync any browser archive. The canary's machine token is never a browser-login credential. Vercel will need an independently reviewed protected BFF protocol and dedicated ingress in a later permissioned stage. Logs never include Google tokens, code verifier, session cookies, subject, CSRF tokens, credentials or conversation data.

References: Google OpenID Connect ID token validation documentation and `openid-client` v6 APIs; reviewed October 2026.
