# Build and rollout status — Phase 1b (2026-10-14 UTC)

**Draft PR:** [#6](https://github.com/ZpkDxGames/Neural-Core-Dashboard/pull/6), stacked on unmerged encrypted-backup draft #5. No merge, production redeploy or VPS changes.

## Last fully inspected verification checkpoint

[GitHub Actions run #38500789798](https://github.com/ZpkDxGames/Neural-Core-Dashboard/actions/runs/38500789798) **SUCCESS** at commit `d5efe67187809feda5f4c81856a875c8451d6013`. Unit suite **9 passed / 0 failed**, backend suite **13 passed / 0 failed**. PostgreSQL 16 synthetic integration including additive migration, DML privilege tests, idempotency, evidence CRUD, deletion, synthetic dump/isolated restore and atomic invalid-provenance rollback was included. Typecheck, Next build, backup sandbox checks all passed.

Subsequent source-only edits on the branch add the indexed owner/provider pagination path and a safe disabled-by-default config template. **Check the newest commit SHA and CI checks independently before merging; this document's checkpoint does not automatically certify later changes.**

## Implemented in source

- Versioned transaction-safe migrations with checksum ledger and least-privilege DML grants.
- Loopback-only Node API storage routes gated by `NCORE_MEMORY_API_ENABLED=1` (OFF by default).
- Idempotent, source-scoped import; bounded retrieval; evidence-backed memory node/edge updates with revision conflict handling and hard deletion/tombstones.
- Local import preview; no background or automatic browser data transfer.
- Removal of unsafe old optional Vercel PostgreSQL ingestion, preserved IndexedDB storage.
- Committed `package-lock.json` and `backend/package-lock.json`, and CI `npm ci`.

## Authentication development (Google OIDC now approved and implemented in source)

- Google OIDC authorization-code + PKCE, state, nonce, verified ID token signature via JWKS, exact owner `sub` allowlist and verified-email claim.
- Opaque random secure HttpOnly sessions through a **proposed** separate REST Redis store, TTL expiration, rotation, explicit logout/revocation and CSRF/Origin/Fetch-Site validation.
- `app/api/auth/owner/[action]` supports start, callback, session, rotate and logout, but returns HTTP 503 when auth environment is unconfigured. **No live Google credentials, Redis store or OIDC setup installed.**
- Dashboard Settings shows local and owner-login status independently; no browser-to-Oracle requests.
- CI on commit `5d019586da7ed9dce02f67c3654069f5ba0939ae`: [successful run #38503831988](https://github.com/ZpkDxGames/Neural-Core-Dashboard/actions/runs/38503831988); **19 frontend/auth tests passed, 13 backend tests passed, 0 failures**; built Next app default-off smoke, browser-bundle secret exclusion, locked installs, isolated PostgreSQL restore, typecheck and build all passed.

## Not implemented / not certified

- Real Google OAuth registration, verified owner `sub` provisioning, third-party persistent session store credentials, real signed Google callback/E2E and approved HTTPS staging origin; **these are separate setup/authorization holds**.
- Production remote BFF ingress or authenticated Oracle API delegation; **no production sync or exposure is authorized**.
- Browser E2E of real login/sync/conflict/offline, export/retention orchestration and full evidence graph integration.
- Global DB storage-growth quota, production-like concurrent load and latency/PSI/WAL budget certification.
- Synthetic AGE-encrypted restoration with representative memory records; only prior empty-database recovery has operator verified exit code 0, and CI uses an unencrypted synthetic PG dump.
- Oracle production migration, memory API activation, live TPS/MSPT measurements, Vercel production deployment, and any network/Caddy modifications.

See `docs/PHASE_1B_ARCHITECTURE_AND_ROLLOUT.md` for precise security and migration hold points.
