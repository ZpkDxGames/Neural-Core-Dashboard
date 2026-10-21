# Neural Brain V2 dashboard implementation

Seven App Router sections replace the single-page dashboard. Graphite/light tokens, compact/comfortable density, reduced motion, keyboard navigation, command palette, responsive rail/mobile navigation, native dialogs and local error boundaries are implemented. No third-party font, image, analytics or gateway requests are added. System fonts avoid new font licenses and downloads.

## Supported sources of truth

Browser archive operations use the original IndexedDB schema and parser. Parsing, analysis, search, layout and Markdown AST work run in cancellable workers with resource limits. Storage consent precedes every persistent import; success follows transaction completion. Unsent drafts live only in tab memory (20 drafts, 200k characters each). No new activity/draft store is introduced.

The remote port remains unavailable and makes zero requests. Vault note, conflict comparison and graph examples appear only after explicit demo opt-in and remain synthetic/unverified. No real agent is provisioned or displayed as connected. Backend and browser contracts are distinct adapter contracts; an approved ingress and owner proof design must be reviewed before connecting them.

The graph preserves lexical source evidence from PR2, deterministic topic rules and provider identities. The default Canvas renderer uses grid hit testing, culling, LOD, typed buffers and bounded layout. Lists/hierarchy expose equivalent node information in pages of 50. The optional vanilla Three sphere imports only after an explicit successful graphics probe; it uses owned buffers/materials, disposal, visibility/reduced-motion controls and context-loss fallback. The old React Three scene is replaced, preserving its functions.

## Dependencies and build

Added unified/remark-parse/remark-gfm for an AST-to-React allowlist, and axe-core Playwright for rendered accessibility checks. No HTML-enabling plugin or UI kit. Removed the unused React Three Fiber/Drei packages after replacing their renderer with the existing vanilla Three dependency. The lockfile audit reports zero known advisories. Webpack is selected because its worker bundling supports the required dependency graph. `next.config.ts` selects the installed Markdown decoder's DOM-free entry; no headers, CSP, hosts, auth setting or environment variable is changed. This is a routine implementation choice authorized by the consolidated full-stack directive; it does not add ingress.

The renderer never inserts HTML strings or loads Markdown images. Link schemes, credentials and external destinations are validated; external navigation requires confirmation. Frontmatter is labelled self-reported and never creates a verified badge. All new TypeScript participates in strict mode and unchecked-index checking.

## Review boundaries

UI branch `development/neural-brain-v2-ui` depends on backend branch `development/neural-brain-v2-hybrid` (draft #7). The base retains migrations 001/002, backup scripts, v1 API and auth behavior. No changes are merged into main or preview. There is no production composition root or listener for V2, real synchronization, secret change, VPS operation or manually initiated deployment.

Browser tests include a separately injected test document for deferred review/publication acknowledgements; it imports the real coordination state machines. No fake adapter or test route is shipped in production. Current production-facing conflict/draft UI remains honestly unavailable. These tests certify protocol coordination, not a deployed owner review flow.

## Owner review and certification list (verbatim from UI_DESIGN_SPEC §11B–C)

### B. Implementation decisions needing owner review

1. Font choice and licences (Instrument Sans, Newsreader, JetBrains Mono as committed OFL `woff2`).
2. Local-first guest use vs gating the whole shell behind owner login (design preserves guest local use; "owner-only" applies to remote data).
3. New local persistence: activity log, persistent drafts, any new IndexedDB store.
4. `STALE_AFTER_MS` (90 s), poll interval (30 s ± jitter), and the behaviour of "never confirmed = stale".
5. Graph caps, LOD thresholds, frame-governor thresholds, response-size budget, and JS budgets (all provisional).
6. 2D Canvas as the default graph with the 3D Sphere opt-in (a departure from the current sphere-centred look).
7. Adding the Markdown AST stack and `@axe-core/playwright`; `d3-force` only if measurement demands.
8. Conflict resolution semantics: atomic "accept A + reject B" endpoint, step-up auth UX, and whether manual merge produces a new proposal.
9. Backend additions the UI needs but the contract lacks: list totals (K6/K7), proposals listing/filter fields, agent registry, audit/events feed, graph cluster aggregates and positions policy, sync-status field names, error-code registry.
10. Retention/backup disclosure wording and whether a retention period may be stated.
11. Whether the demo network stays available in production builds, and its wording.
12. Single-key shortcuts default (off) and the global shortcut set.
13. Additional UI languages and the message-catalogue approach.
14. Treatment of PR #2 features (merge order or re-implementation) and whether Gemini-normalized import gets a first-class provider card.
15. Whether the skill folder itself is published in the public repository (it contains no private data).

### C. What cannot be certified in design-only work

- Any runtime behaviour of Oracle, PostgreSQL, the vault worker, the gateway, backups/restore, or Minecraft/PlexonPanel impact.
- Live Google owner login, CSRF/session revocation on Preview or Production (PR #6 records these as unverified).
- Real `/v2` payload shapes, error codes, latency, pagination semantics.
- Rendered visual quality, real contrast on rendered pages, font rendering, layout at real devices (iOS Safari, low-end Android, high-DPI Windows), forced-colours appearance.
- Colour-vision accessibility with real users (only a simulation was run); screen-reader behaviour (NVDA, JAWS, VoiceOver, TalkBack).
- All performance, memory, GPU-leak and battery budgets; WebGL behaviour across drivers.
- Compilation/behaviour of code blocks marked "not executed" in `IMPLEMENTATION_EXAMPLES.md` §13; compatibility with the installed Next/React/three versions.
- Security of the Markdown pipeline under a full independent review; CSP compatibility.
- Parity with the legacy dashboard (requires reading and running the real source).
- Any statement about the current state of `main` or PR #5 beyond what was fetched.
