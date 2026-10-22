# Phase 3 performance and resource provenance

The existing 5,000-source/20-search Playwright harness was run against the unchanged reviewed #8 baseline and this candidate on the same local host/runtime, using Webpack production builds, Chromium 153 software SwiftShader and Node 24.19.0. All 20 latency samples (including the first slow sample), byte counts, graph frame gaps, heap samples, host metadata and fixture settings are retained in `evidence/browser-{before,after}-local.json`. Final exact source/CI provenance is recorded after delivery.

The harness includes 120 ms debounce and Playwright polling; p95 is nearest-rank, not a server latency percentile. It confirms zero search network requests, lazy optional 3D chunks and canvas teardown through ten route cycles. No cache flush or exclusive hardware isolation was applied. Finite samples and shared-host load prevent causal latency or field-SLA claims. Historical docs/ui figures used other hosts/versions and remain historical; they are not silently replaced by these values.

The default-off browser includes a small additional adapter/provider payload. Measured bytes and latency are summarized from the retained JSON after the last run. The gateway adds a capability handshake before each browser operation to obtain current principal/consent epochs; this deliberately adds a private request and consumes quota. No positive revocation cache or background polling is introduced. Bodies/responses, SQL pool/concurrency, request/dependency deadlines, queue/list/graph bounds and the 10k checkpoint safeguard are described in ARCHITECTURE.md.

This phase does not measure live Oracle/PostgreSQL WAL, private network latency, certificate service latency, shared-VPS CPU/IO/pressure, Minecraft TPS/MSPT, real phone rendering, 100k physical checkpoints or encrypted paired restores. Source changes make no capacity claim for those systems.

## Matched local samples

| Measurement | Reviewed #8 | Phase 3 |
|---|---:|---:|
| Initial JS gzip bytes | 152891 | 157788 |
| Search p50 (ms) | 192.67 | 193.67 |
| Search p95 (ms) | 225.33 | 222.14 |
| Search maximum (ms) | 665.99 | 661.09 |

Default-off initial JS adds 4,897 gzip bytes (3.20%) in this pair. Search requests remained local in both samples. These samples characterize finite test runs; the p95 difference is not an isolated causal speedup. No sample was removed.
