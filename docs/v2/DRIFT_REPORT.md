# Source verification — 2026-10-20

The connected GitHub account reports push access to this public repository. The full supplied ZIP was extracted; all ten architecture checksums match. The master directive, architecture, UI skill, six reference playbooks, UI specification and verification fixtures were inspected before implementation.

| Ref | Verified SHA | PR / base |
| --- | --- | --- |
| main | 75157ad2d60e337a326a1d459496bedfba4a0fab | foundation |
| preview | 525dcb070c158e6cb485785ba659d0d114b9a30f | same source as PR 6 |
| development/evidence-linked-knowledge | 636b7ef3d4ca3a88f2fbcd055c14cf9ce40abaa5 | draft 2 → main |
| ops/oracle-vps-capacity-gate | 2373d95b6255c252812ee3c2854bff61815908a0 | draft 3 → main |
| ops/private-core-local-canary | 30399e771b1a07a62c882e31327d61530b54eed6 | draft 4 → main |
| ops/encrypted-backup-recovery-canary | b73566cc8a6ccae45438c3e7488a413e2bbbbbd0 | draft 5 → draft 4 |
| development/persistent-memory-phase-1b | 525dcb070c158e6cb485785ba659d0d114b9a30f | draft 6 → draft 5 |

No branch-head drift from the consolidated planning package was observed. Five existing PRs remain open/draft. Recent PR 6 commit checks report successful GitHub verification; this is historical CI evidence, not live certification. The connector does not permit the deployments collection; current deployed source and live Google login were not independently verified. No Vercel setting was read or changed.

## Base and isolation

Backend branch `development/neural-brain-v2-hybrid` starts at PR 6's verified head. UI branch `development/neural-brain-v2-ui` will depend on that backend branch. PR 2 is a sibling, not an ancestor: its deterministic concept catalog, evidence extraction, graph construction and tests will be ported explicitly, without merging unrelated old page/auth code. Existing main/preview and stacked PRs are preserved.

The old `app/api/v1/ingest` and `lib/db.ts` are absent. The browser has no Oracle/vault read or write path. v1 loopback API, PostgreSQL migrations 001/002, OIDC logic, consent transfer rules and encrypted backup scripts are retained. UI-only restrictions in Claude's skill apply to the UI commit boundary; the consolidated master directive separately authorizes the isolated backend additions.

## Baseline actually executed

Runtime: Node 24.19.0, npm 11.9.0; locked Next 16.4.0, React 19, TypeScript 5.9. Locked installs completed for root and backend.

| Command | Result |
| --- | --- |
| `npm ci --no-audit --no-fund` | pass, 119 packages |
| `npm ci --prefix backend --no-audit --no-fund` | pass, 14 packages |
| `npm test` with isolated Redis 7.4.0 | 48 passed, zero skipped |
| `node --test backend/*.test.mjs` | 11 passed, 2 PostgreSQL tests skipped locally |
| `npm run typecheck` | pass after the install finished |
| `npm run build` | pass |
| `NCORE_TEST_CHROMIUM=/tmp/neural-chromium npm run test:auth-ui` | 9 passed |

The first typecheck/build overlapped the dependency installation and could not find their executables; rerunning after install passed. Native PostgreSQL cannot run as an unprivileged user in this execution sandbox (UID/group switching denied). V2 SQL is exercised locally on disposable PostgreSQL WASM/PGlite 0.5.10 with API-role privileges. Its serialized transaction adapter does not certify native concurrent locking. Required native PostgreSQL 16 tests are added to GitHub CI. The standard Playwright browser download was invalid; a registry-distributed Chromium executable was used instead. Screenshots use synthetic/demo data and software SwiftShader graphics.

Six baseline screenshots and measured browser payload/hardware metadata are in `docs/v2/evidence/baseline`. No live VPS, private database, archive, token, credential or production service was accessed.
