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

## Not implemented / not certified

- Owner OIDC login, server session persistence/rotation/revocation, live CSRF flow, approved HTTPS ingress or BFF remote proxy; **owner security-architecture choice is a hard hold**.
- Browser E2E of real login/sync/conflict/offline, export/retention orchestration and full evidence graph integration.
- Global DB storage-growth quota, production-like concurrent load and latency/PSI/WAL budget certification.
- Synthetic AGE-encrypted restoration with representative memory records; only prior empty-database recovery has operator verified exit code 0, and CI uses an unencrypted synthetic PG dump.
- Oracle production migration, memory API activation, live TPS/MSPT measurements, Vercel production deployment, and any network/Caddy modifications.

See `docs/PHASE_1B_ARCHITECTURE_AND_ROLLOUT.md` for precise security and migration hold points.
