# Measured performance

These are synthetic development measurements, not live VPS SLAs. Raw JSON includes machine/browser/fixture context and outliers. Browser runs use software graphics; baseline and V2 builds use different bundlers and route architecture.

| Measure | Observed |
| --- | --- |
| Initial route JS gzip, baseline | 386,444 bytes |
| Initial route JS gzip, V2 | 152,780 bytes (60.5% lower) |
| 5,000-source IndexedDB seed transaction | 413.1 ms |
| 20 local searches, p50 / p95 | 222.6 / 3709.9 ms (includes 120 ms debounce and Playwright polling) |
| Search requests | Zero |
| Graph window | Showing 1,157 of 5,000 source conversations · 1,171 nodes · 3,484 links · Reset |
| Idle rAF frame-gap p50 / p95 / max | 16.7 / 16.8 / 16.8 ms |
| Main-thread tasks >50 ms during sampled pan/zoom interval | 0 |
| Ten graph/library cycles | Two canvases removed each exit; forced-GC heap delta 1,099,960 bytes |

The rAF sampling is an idle scheduling probe, not a claim of sustained rendered FPS or field INP. Heap changed during route warmup; this finite run does not prove absence of all memory leaks. Three lazy chunk paths were derived from the production loadable manifest and absent from Overview and 2D graph requests. Three software creation/disposal cycles released 12/12 created attribute buffers; context fallback released 16/16, preserving selection. Hardware GPU memory and per-frame draw-call budgets remain unqualified.

## Memory-engine scale (disposable PostgreSQL WASM)

| Notes in compact SQL read model | Query p50 ms | Query p95 ms | SQL table bytes |
| --- | --- | --- | --- |
| 1,000 | 5.265 | 8.286 | 1,884,160 |
| 10,000 | 6.769 | 10.594 | 14,049,280 |
| 100,000 | 7.409 | 10.294 | 131,629,056 |

Thirty bounded lexical queries per scale point. Twenty real Markdown publications: p50 12.4 ms; p95 100.1 ms. Compact projections intentionally bypass full ingestion to isolate retrieval. This does not certify 100k physical Markdown files, a filesystem watcher, production WAL, real VPS IO or Minecraft impact. The native CI scale benchmark is retained in its evidence artifact.
