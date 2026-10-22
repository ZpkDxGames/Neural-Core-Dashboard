# Neural Brain V2 — Phase 3 private integration candidate

Development-only, synthetic qualification. No staging activation, merge or production approval.

This candidate extends the exact reviewed PR #8 tree (`268038530cfc20dbeec4a6b1404d91e5dd4cddaf`), which includes PR #7 (`87a72ed4a309bf560f164c44757b0ff7937fd5ff`). It preserves their dependency chain and all earlier drafts. Start with ARCHITECTURE.md, API_CONTRACTS.md, SECURITY_FINDINGS.md, TEST_REPORT.md and STAGING_ACTIVATION_CHECKLIST.md in this directory.

Implemented: additive migration 004; same-origin owner BFF; TLS 1.3 mutual certificate verification and pinned ES256 service assertions; durable replay/quota storage; online owner-family revocation; explicit session-bound consent; one-use action/intent/revision/session/identity/epoch grants; signed Google freshness validation; scoped synthetic-agent provisioning/rotation/revocation; a defensive in-memory adapter; opt-in private notes, evidence, proposal review and graph views.

**Default state remains unavailable.** Both server capability gates are absent/off, the production server does not bind V2, no agent/provider is connected, and no archive synchronization is introduced. Do not set qualification flags based on these synthetic results. Real Google behavior and private hosting remain unqualified.

The source and evidence are packaged together. Historical reports under docs/v2 and docs/ui describe earlier phases; this directory describes the new work. The 10,000-entry checkpoint safeguard is unchanged. Real Obsidian Desktop behavior, large-vault snapshots, paired encrypted recovery and shared-VPS capacity remain separate gates.
