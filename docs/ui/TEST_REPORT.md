# Audit remediation verification — 2026-10-21

The original 141 browser cases and all assertions are retained. Local full run: **141 passed, 0 failed/skipped/flaky**, 159 seconds (rounded 2.6 minutes), with 42 route/theme/width axe checks and 77 synthetic screenshots. The current browser adapter remains `unavailableVault`; no remote memory requests or real agents are enabled.

| Check | Local remediation result |
| --- | --- |
| Original parser/auth/Redis + concepts | 53 passed, zero skipped; real isolated Redis 7.4 |
| Original backend | 11 passed, two native PostgreSQL cases skipped locally |
| V2 unit/fs/API | 15 passed (original 10 + 5 new) |
| V2 SQL migration/recovery | 16 passed (original 13 + 3 new), serialized PostgreSQL WASM |
| Brain pure contracts/lifecycle | 32 passed |
| Original complete Chromium browser suite | 141 passed, zero skipped/flaky |
| Strict TypeScript, production Webpack build, token/status lint and parity | passed |
| Locked dependency advisory audit | zero known advisories |
| Physical 1k/10k checkpoints and actual 100k guard | measured; 100k full certification explicitly blocked |

Local checks used the existing dependency tree from the identical lockfile after offline `npm ci` encountered an uncached tarball. Native PostgreSQL 16 locking, migration, rollback, least privilege and restore must be verified by fresh exact-SHA CI. The combined expected CI total is **270**, versus original 262: 53 + 13 + 15 + 16 + 32 + 141. Backend draft has its separate 101-case total and does not add to the combined count. Final exact published SHA, CI URLs, outcomes and downloadable artifacts are reported in the draft PR bodies and delivery certification after CI completes; local WASM results never substitute for native concurrency.

For the audit findings and exact behavior, read `../v2/REMEDIATION_REPORT.md`, `../v2/REMEDIATION_CONTRACTS.md` and `../v2/PRIVATE_STAGING_CONTRACTS.md`. Performance provenance and all unfiltered historical/matched samples are in `PERFORMANCE_REPORT.md` and `evidence/history` / `evidence/remediation`.

Real Obsidian desktop, live Google freshness, private gateway/issuer/provisioning, 100k streaming snapshots, encrypted paired restore, VPS capacity and real-device QA remain uncertified. Main/preview and production are untouched.

---

# Historical pre-remediation report (retained)

# Verification report — development candidate

The final complete production-build browser run passed all 141 cases, with zero failures or skips in 4.4 minutes. Results below refer to tests actually executed. Native combined-candidate CI is attached to the dashboard draft; backend-native results are pinned below.

| Check | Observed result |
| --- | --- |
| Original parser/auth/Redis unit suite plus PR2 concepts | 53 passed, 0 skipped |
| Brain pure contracts/lifecycle/acknowledgements | 32 passed, 0 skipped |
| V2 unit/filesystem/API | 10 passed, 0 skipped |
| V2 PostgreSQL WASM integration | 13 passed, 0 skipped; serialized adapter |
| Original backend local suite | 11 passed, 2 native PostgreSQL tests skipped locally |
| Backend native PostgreSQL 16 CI | 93 passed total, 0 skipped at be98d060; run 39500377649 |
| Strict TypeScript including unchecked indices | passed |
| Production Webpack build | passed |
| Design-token/status/import lint and mandatory F01–F15 manifest | passed |
| Locked dependency audit | 0 known advisories |
| Earlier complete browser pass | 137 passed / 1 timed-out axe audit (138 cases); timed-out case passed a 1.2 s targeted rerun |
| New controlled protocol + software GPU checks | 3 passed; no production fake adapter |
| Final combined 141-case browser run | 141 passed, 0 failed, 0 skipped; 4.4 minutes |

The first visual matrix found link affordance and selected-row contrast issues; both were corrected without disabling axe rules. Final matrix captures are regenerated. Full matrices/raw Playwright results are included in the downloadable review archive and CI artifacts; selected PNGs are committed for review.

See browser-performance.json, software-gpu.json, the baseline metrics and backend scale benchmark for measured data. Software/browser measurements do not establish live VPS or hardware GPU SLAs. Detailed certification blockers are in SECURITY_AND_LIMITATIONS.md.

The final run contains the 42 route/theme/width axe cases, 72 screenshot matrix cases, five additional non-happy-state captures, 9 original owner-auth cases, 24 XSS payloads in a browser test, local import/search/export/delete journeys, controlled protocol coordination, optional software-WebGL lifecycle, and performance/cleanup measurements. All matrix audits reported zero serious/critical axe violations.

Final targeted verification: 15/15 passed (38.2 seconds) after strengthening the XSS corpus to wait for each unique rendered payload marker and aligning duplicate consolidation with the implemented owner-only backend rule. The 12 agent visual/theme/width frames were regenerated; the existing J4 check now asserts the exact role cells. Native benchmark evidence is written outside the browser output directory so Playwright cleanup cannot remove it.

CI exposed an early keyboard event before hydration attached its handler. The shell now exposes interactive readiness after handler registration; keyboard checks wait for that signal, and initial navigation focus does not interrupt an open dialog. Both affected journeys passed five repetitions each (10/10, zero skips) in 25.1 seconds. This resolves the recorded pre-readiness CI failure without removing assertions.
