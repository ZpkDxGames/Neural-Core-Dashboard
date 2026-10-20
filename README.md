# Neural Brain V2 — development candidate

A local-first Next.js knowledge dashboard with an independently maintained PostgreSQL + Obsidian-compatible Markdown memory engine. This branch is a review candidate, not a production release.

## Available in the dashboard

- Overview, graph, knowledge library, agent workspace, sources, activity, and settings routes, with dark/light themes and responsive keyboard-accessible navigation.
- ChatGPT active-branch, Claude, and normalized Generic/Gemini JSON import with preview and explicit storage consent. IndexedDB persistence, stable-ID export round trips, exact-count deletion and cited context copy remain local to the browser.
- Bounded worker-based search and graph layout; lexical topic concepts retain exact source excerpts. These rules do not verify facts.
- Default 2D Canvas graph, accessible list/hierarchy, and an explicitly selected lazy Three.js sphere with context-loss fallback and resource cleanup.
- Safe Markdown AST preview, provenance views and tab-memory drafts. Synthetic note/conflict examples require explicit opt-in and remain labelled.
- Existing Google owner session, CSRF, logout/retry and cross-tab behavior. Signing in does not enable synchronization.

## Independent memory engine

`backend/v2` provides evidence-bearing proposals, scoped agent identities, immutable revisions, one-use owner review proofs, signed retrieval cursors, transactional outbox publication, external-edit conflicts, recovery, deduplication/consolidation and tombstones. Migration 003 is additive; 001/002 and existing v1/backup foundations are retained.

The V2 handler is **not bound to a listener**, is disabled by default and is not imported by the current private server. No browser gateway, remote synchronization or real agent integration is enabled. The old Vercel `/api/v1/ingest` route is absent. Do not place private database credentials or canary tokens in Vercel.

## Local development and verification

Use Node 22+ and the lockfile:

```sh
npm ci
npm ci --prefix backend
npm run dev
```

Open http://localhost:3000. No environment file is needed for browser-local use. Browser archives require consent before storage; clearing browser data removes them. Exports remain under the user's control.

```sh
npm test
npm run test:brain
npm run test:vault
npm run lint
node scripts/check-parity.mjs
npm run typecheck
npm run build
npx playwright install chromium
npm run test:auth-ui
```

The original unit suite requires an isolated Redis instance for full coverage. Native backend/V2 integration tests require fresh disposable loopback PostgreSQL databases; follow the migration document and CI workflow. Never point tests at an existing or live database. The supported production build uses Webpack and a DOM-free Markdown entity decoder for workers.

## Review and activation

- [Source drift and baseline](docs/v2/DRIFT_REPORT.md)
- [Memory engine architecture](docs/v2/ARCHITECTURE.md)
- [Migration and rollback](docs/v2/MIGRATIONS_AND_ROLLBACK.md)
- [Dashboard architecture](docs/ui/ARCHITECTURE.md)
- [Feature parity](docs/ui/PARITY_FINDINGS.md)
- [Implementation and owner review items](docs/ui/IMPLEMENTATION_REPORT.md)
- [Verification and performance](docs/ui/TEST_REPORT.md)

Backend workstream: `development/neural-brain-v2-hybrid`, stacked on draft #6. Dashboard: `development/neural-brain-v2-ui`, stacked on the backend. Development drafts must not be merged or deployed without a separate owner decision.

Production activation requires approved private ingress, owner proof issuance, scoped real credentials, capacity and retention policy, encrypted paired database/vault restore certification, live auth testing, and staged rollout/rollback verification. No live infrastructure operation is part of this candidate.

Semantic/vector search, browser capture, automatic platform context injection, Gemini Takeout, live agent synchronization, independent security review and real-device/screen-reader certification remain outside the verified candidate. Never automatically promote agent text or frontmatter claims into established facts.
