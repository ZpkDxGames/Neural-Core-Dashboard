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
