# Security policy — Neural Core

Neural Core is a public, local-first personal knowledge dashboard. Never upload actual conversations, confidential logs, tokens, private AGE keys, encrypted archive plaintext or passwords to this repository or CI.

## Existing deployment boundary

The dashboard's local import persists in browser IndexedDB. There is no active browser-to-Oracle synchronization or owner login. A local import never sends content to a server.

The prior Vercel `/api/v1/ingest` route and `lib/db.ts` are removed in Phase 1b to prevent an accidental second data store. The sole backend is the loopback-only Node server on the existing Oracle canary.

Phase 1b adds machine-authenticated developer routes that are **off by default** (set `NCORE_MEMORY_API_ENABLED=1` only in an approved isolated local testing environment). Those routes are not a substitute for owner sessions. Never put the existing canary bearer token in a browser, Vercel, `NEXT_PUBLIC_*`, localStorage or repository.

Before any remote ingress: approve an OIDC/passkey owner identity and allowlist; implement server-side session revocation, CSRF and same-origin validation; approve a dedicated HTTPS entry point with separately scoped, short-lived backend credentials. Do not reuse PlexonPanel ingress, expose PostgreSQL TCP, weaken systemd sandbox or modify Minecraft.

## Vulnerability disclosure

Do not include private user conversation excerpts, credentials, backups or screenshots of personal data in issues or PR discussions. Refer to `docs/PHASE_1B_ARCHITECTURE_AND_ROLLOUT.md` for gates and limitations.
