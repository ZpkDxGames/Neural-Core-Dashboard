# Measured performance and provenance

## Final published baseline versus historical local measurement

The **last certified published baseline**, before this remediation, is `704ec3b443a4de1e060827c61a5779fa1f03f383`, [CI run 39503265020](https://github.com/ZpkDxGames/Neural-Core-Dashboard/actions/runs/39503265020). Do not confuse its final CI measurement with the older checked-in local result. Remediation CI and the new exact published commits are tracked in REMEDIATION_REPORT.md; the table below preserves the original audit’s two runs.

| Run / raw evidence | Host and runtime | Fixture / method | Search p50 / p95 / max | First-load JS gzip |
| --- | --- | --- | --- | ---: |
| Final baseline CI at `704ec3b4`; `evidence/history/browser-performance-ci-704ec3.json` | AMD EPYC 7763; 4 CPUs; 16.77 GB; Node 22.23.3; Chromium 151.0.7922.34; software SwiftShader | 5,000 synthetic conversations/messages; 20 serial searches; Webpack production build | 190.03 / **195.63** / 198.92 ms | 152,811 B |
| Historical local, 2026-10-20 21:28:36Z; `evidence/history/browser-performance-local-2026-10-20.json` | Intel Xeon Platinum 8573C; 9 CPUs; 10.45 GB; Node 24.19.0; Chromium 153.0.8010.0; software SwiftShader | Same source/message/sample counts and search harness; local build commit was not recorded in raw evidence | 222.6 / **3709.9** ms (full samples and maximum in raw JSON) | 152,780 B |

The search harness times filling the input through the rendered matching card, including its **120 ms debounce and Playwright polling**. p95 is nearest-rank `ceil(n × .95) - 1` after sorting all 20 samples. No outliers are discarded. Both runs make zero search network requests. CPU allocation, host, Node/browser versions, concurrent load and scheduling differ. The cause of the local tail is **not isolated**; the difference cannot establish a causal improvement, regression, or a production latency guarantee. The original local report is preserved in `evidence/history/PERFORMANCE_REPORT-local-2026-10-20.md`.

## Matched local before/after remediation

Both runs use the same local host, Node `v24.19.0`, Chromium `153.0.8010.0`, software SwiftShader, the same 5k synthetic fixture, the unchanged 20-search harness, one browser worker and the same Webpack build configuration. Before = verified original `704ec3b4` tree; after = combined remediation source with unchanged browser behavior. Browser/API adapter code was not modified. Raw samples are retained under `evidence/remediation/`.

| Measure | Before | After |
| --- | ---: | ---: |
| Search p50 | 197.51 ms | 195.24 ms |
| Search p95 | 241.97 ms | 203.04 ms |
| Search maximum | 853.68 ms | 723.29 ms |
| First-load JS gzip | 152,151 B | 152,151 B |
| Search network requests | 0 | 0 |

These are two finite samples on shared execution hardware, not controlled CPU isolation. The physical-file benchmark overlapped part of the browser run; background load was not held constant. No browser speed improvement is claimed from the remediation. New CI has different hardware and must be reported separately, not substituted into this matched local comparison.

## Bundled output comparison limitations

The older legacy first-load measurement was **386,444 gzip bytes**, using Next 16.4 Turbopack on the legacy single-page architecture. V2’s final baseline **152,811 bytes** uses Webpack and seven App Router sections, sums gzip sizes for JavaScript actually requested by the initial route, and defers Three.js. The arithmetic difference is 60.5%; it is **not** a bundler-controlled optimization result, a whole-application payload comparison, or a general performance guarantee. A causal claim would require both architectures rebuilt under matched bundler/version/route/cache conditions. No such comparison was performed here.

The idle rAF gap is a scheduling probe, not rendered FPS or field INP. Route-cycle heap deltas and finite software buffer disposal tests do not establish leak freedom or hardware GPU memory budgets. Field Web Vitals, hardware GPU, real mobile hardware and Oracle/Minecraft effects remain unmeasured.

## Physical-file checkpoint measurement

See `../v2/evidence/physical-checkpoint-performance-2026-10-21.json` and `../v2/REMEDIATION_CONTRACTS.md`. The script creates real private Markdown files and alternates three process-isolated old/new trials per size on the same warm-cache fixture, with a simulated bounded ledger to isolate physical IO. No SQL latency is included, and cache/device IO is not controlled. User/system CPU time, process maximum RSS and filesystem block counters are retained per trial. Zero read-block counters reflect the warm filesystem and do not imply zero storage pressure.

| Actual physical files | Old median / directory walks | New median / directory walks | Highest old / new process RSS |
| ---: | ---: | ---: | ---: |
| 1,000 | 439.68 ms / 10 | 405.11 ms / 1 | 53,776 / 53,632 KiB |
| 10,000 | 6841.59 ms / 100 | 3628.11 ms / 1 | 88,068 / 82,984 KiB |
| 100,000 | Full old checkpoint intentionally not run; one old page scanned the directory in 503.53 ms | Full checkpoint refused by 10k ledger cap; physical inventory refused at its 10k entry cap in 45.34 ms | Guard-only measurements in raw JSON; not a complete checkpoint |

The 100k guard timings do not represent 100k checkpoint throughput. **100k physical checkpoint certification stays blocked** pending a measured external-sort/streaming snapshot implementation. Quiescence, encrypted paired restore, live IO/WAL pressure and VPS service interference require separate owner-approved certification.

Reproduction: `node backend/v2/physical-benchmark.mjs --synthetic-only be98d060c604791ca75da7efd434218a6c686fac OUTPUT.json` from a checkout containing that verified baseline object. Temporary files are generated under a dedicated private scratch directory and removed; no live vault is read.

## Historical compact SQL benchmark (separate workload)

Original native PostgreSQL 16 CI, Node 22.23.3, AMD EPYC 7763 / 4 CPUs / 16.77 GB: retrieval p95 was 2.889 / 4.457 / 5.101 ms at 1k / 10k / 100k compact synthetic SQL read models, 30 samples each. Twenty physical publications measured 7.935 ms p95. Earlier PostgreSQL WASM retrieval p95 was 8.286 / 10.594 / 10.294 ms and publication p95 100.1 ms. These are different runtimes/workloads and were never 100k-file checkpoint measurements. See the original CI artifact and final baseline certification; no Oracle capacity claim follows from them.
