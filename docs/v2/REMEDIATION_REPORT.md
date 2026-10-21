# Audit remediation review — 2026-10-21

Scope: draft #7 on #6, with dependent dashboard draft #8. No merge, main/preview update, manual deployment, live database operation, credentials, network/DNS change or real provider synchronization.

## Independent reproduction and changes

- F-01: the original method returned the same first 50 of 121 synthetic rows when passed a cursor, with `partial:true` but no next cursor. Reproduced with an isolated query adapter before changes, then replaced with a 167-row mixed-state SQL regression and actual loopback HTTP-to-SQL traversal. The fix adds authorized, current-scope/query/credential-bound signed microsecond keysets, actionable defaults, bounded repeated filters and byte-budget-aware pages. Complete traversal, cross-owner/principal/query/endpoint denial, revocation, ties, anchor status changes and large payloads pass locally.
- F-02: a synthetic original serialization emitted `related_ids` but zero native UUID wikilinks. Newly verified typed relations now emit sorted/deduplicated quoted `brain_links`; aliases and SQL evidence semantics remain intact. Strict parse/round-trip and forged-file reconciliation tests pass. No real Obsidian desktop is available; native graph visibility remains **uncertified**.
- F-03: repeated whole-directory checkpoint pagination is replaced with one capped inventory and a bounded authoritative ledger read, including tombstone/file/hash/drift checks. **Checkpoints above 10,000 records/entries are explicitly blocked**, including a real 100k-file guard experiment. Large-vault certification awaits streaming snapshot work. Operator quiescence is required and is not automatically enforced by a lock.
- F-04: PRIVATE_STAGING_CONTRACTS.md defines a request-bound private mTLS/JWT path, fresh Google owner proof and server-side agent provisioning. Architecture only. A new reviewed schema migration is required for action/session/intent/epoch-bound proofs and expiring credentials; it is not implemented or activated.
- F-05: the dependent dashboard promotes final baseline CI versus historical local measurements, retains both raw files, documents host/browser/Node/sample/bundler differences, and adds matched local measurements. No causal search or bundler performance improvement is claimed from unmatched environments.

## Local checks actually executed

| Suite | Result |
| --- | --- |
| V2 unit/filesystem/HTTP contracts | 15 passed, 0 failed/skipped (original 10 retained) |
| V2 SQL migration/recovery/concurrency | 16 passed, 0 failed/skipped (original 13 retained); PostgreSQL WASM with serialized transactions |
| Combined dashboard original parser/auth/Redis/concepts | 53 passed with an isolated real Redis 7.4 bridge |
| Combined dashboard pure contracts/lifecycle | 32 passed |
| Original backend local | 11 passed, **2 native PostgreSQL cases skipped locally** |
| Combined dashboard browser | 141 passed, no failures/skips/flaky cases; 2.6 minutes; all original assertions retained |
| Advisory audit | 0 known advisories in locked root dependency graph |

Local native PostgreSQL could not be initialized because the isolated runtime maps only UID 0 and cannot chown a service-owned data directory. PostgreSQL WASM is not native concurrency certification. Native PostgreSQL 16 migration, locking, least-privilege and recovery cases must pass at the exact published draft head in GitHub Actions. The first backend source update is `83e7e7e8b6050bff06b51bb3648beb827d91ed49`, [run 39661370431](https://github.com/ZpkDxGames/Neural-Core-Dashboard/actions/runs/39661370431); final heads/results are recorded in the delivery certification and PR bodies after CI completes.

The local offline `npm ci` attempt stopped at an uncached tarball. Subsequent local checks used the existing installed dependency tree from the identical lockfile; CI performs fresh locked installs. No dependency version or lockfile was changed. Strict typecheck/build results and final combined exact-SHA CI are recorded with the dashboard report.

## Physical checkpoint measurement

Raw evidence: `evidence/physical-checkpoint-performance-2026-10-21.json`. Reproduce with `node backend/v2/physical-benchmark.mjs --synthetic-only be98d060c604791ca75da7efd434218a6c686fac OUTPUT.json` from a checkout containing the pinned baseline object.

Three alternating old/new process-isolated trials per fixture, same warm-cache host and actual Markdown files; simulated ledger isolates physical IO. At 1k files median was 439.68 → 405.11 ms (10 → 1 walks); at 10k, 6841.59 → 3628.11 ms (100 → 1 walks). Peak process RSS across 10k trials was 88,068 → 82,984 KiB. These small finite measurements include uncontrolled shared-host load and establish no production guarantee. At 100k actual files the new ledger cap refused before file reads and physical inventory refused at its cap in 45.34 ms. A single old page scanned the directory in 503.53 ms; a complete old/new 100k checkpoint was deliberately not run or certified. Zero filesystem read-block counters reflect warm cache, not zero disk pressure.

## Review and activation blockers

Read REMEDIATION_CONTRACTS.md for exact endpoint/serialization/checkpoint behavior and PRIVATE_STAGING_CONTRACTS.md for future contracts. Default `unavailableVault`, machine API isolation, OIDC/CSRF/session/owner scopes, migration 003 and privacy restrictions are preserved. Raw evidence uses synthetic fixtures only.

Remaining: independent second-pass review; real Obsidian desktop graph check; measured streaming 100k snapshot; private gateway/issuer/provisioning implementation and staging activation; live Google freshness qualification; separately approved encrypted paired restore and VPS capacity checks; real provider consent and real-device QA. No current result certifies those boundaries.
