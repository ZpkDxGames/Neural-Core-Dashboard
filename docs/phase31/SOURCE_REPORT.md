# Phase 3.1 source provenance

Read the candidate certification, architecture, security findings, staging checklist, original architectural contracts and attached independent 2026-10-22 review before implementation. Fresh connector reads verified:

| Ref | Verified initial SHA |
|---|---|
| main | `75157ad2d60e337a326a1d459496bedfba4a0fab` |
| preview / PR #6 | `525dcb070c158e6cb485785ba659d0d114b9a30f` |
| PR #4 | `30399e771b1a07a62c882e31327d61530b54eed6` |
| PR #5 | `b73566cc8a6ccae45438c3e7488a413e2bbbbbd0` |
| PR #7 | `87a72ed4a309bf560f164c44757b0ff7937fd5ff` |
| PR #8 | `268038530cfc20dbeec4a6b1404d91e5dd4cddaf` |
| PR #9 baseline | `3e830e0673e09a1802d4a06f591c0ed4d37a7b7c` |

The Phase 3 ZIP passed CRC and all 288 manifest hashes. All 237 source blobs matched the independently fetched GitHub recursive tree and local checkout; its root tree is `af1813f788842414415957066cc1bed7d38dd2f2`. Initial work used isolated local branch `development/neural-brain-v2-phase31-hardening`; final delivery safely advances only PR #9's existing branch with an expected-head lease, preserving its base #8 and earlier drafts. Final exact commit/tree and CI identities are supplied in the delivered certification.

Scope: private assertion parser, recoverable synthetic credential delivery, explicit additive 005 migration, narrowly tightened SQL rotation lifetime, additional tests/evidence capture, Next security patch/lock and documentation. Migrations 001–004, production server/composition, owner/BFF code, all UI components, default-off private runtime, IndexedDB, archive and checkpoint behavior remain unchanged. No frontend redesign or unrelated architecture rewrite is included.

All fixtures, tokens, certificates, databases and identity labels are synthetic. No merge/deployment, live data/migration, environment-setting change, credential provisioning, staging activation or VPS operation is part of this delivery. Local process-scoped test variables configure disposable tools only.
