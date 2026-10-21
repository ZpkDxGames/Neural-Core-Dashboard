# AGENTS.md — Neural Brain V2 Project Agent Contract

Applies to architecture/design/implementation tasks for Neural Brain V2. Explicit user instructions and real current repository evidence override this planning document when they differ, except privacy and safety invariants requiring explicit authorization.

## Read first
`MANIFEST.md`, `SOURCE_AUDIT.md`, `ARCHITECTURE_V2.md`, `MEMORY_DATA_CONTRACTS.md`, `SECURITY_AND_MIGRATION.md`, and `QA_AND_PERFORMANCE_PLAN.md`.

## Before touching code
1. Identify latest `main`, `preview`, PR #4/#5/#6 heads, and actual deployment refs. Do not assume this package's 2026-10-19 SHAs are still current.
2. Inspect recent merged or draft work to reconcile source drift; never reintroduce removed Vercel ingest/second DB code.
3. Confirm exact work scope, branch base and CI baseline.
4. Work in a new isolated feature branch; preserve existing source state and maintain human-reviewable commits.
5. Use only synthetic memories, conversations, agent identifiers and screenshots in public CI and PRs.

## Preserve behavior
- Local-first consent gating, imported archive preview, IndexedDB ownership, import/export/delete affordances, truthful sync status.
- OIDC/CSRF/authorization/revocation defenses, loopback canary, schema ledger and recovery guardrails.
- Evidence-backed memory claims and explicit owner verification decisions.
- No public access to Oracle database, private vault, machine credentials, or owner data.

## Implementation standards
- Narrow responsibilities; typed API contracts, no duplicated auth logic; bounded read/writes; idempotency; safe atomic storage.
- Async workers and bounded queues, deterministic retries, visibility/observability with sanitized logs.
- Graceful shutdown, no orphaned processes, no uncontrolled file watchers or heavy CPU on shared VPS.
- Structured UI states (loading, empty, error, conflict, offline, partial, archived, consent-required); keyboard and screen-reader support.
- Browser page screenshots in both light/dark when designed, at mobile/tablet/desktop sizes, using synthetic data only.
- Test actual features, not just static strings or mocked success responses.

## Hard prohibitions
DO NOT merge to main, push production, redeploy, edit secrets or Vercel Production, run migrations on Oracle, enable `NCORE_MEMORY_API_ENABLED`, expose Caddy/DB ports, change DNS/firewall, or modify Minecraft/PlexonPanel services without a separate explicit owner go/no-go. Do not treat local successful tests or existing design documents as runtime certification. Do not claim to have run tests, installed tools or visually verified screens that you did not actually perform.

## Required implementation report
Commit/branch/PR links; touched-file summary; preserved contracts; commands and exact outcomes; screenshots and QA results; benchmark baselines vs new numbers; pending risks; precise rollout blockers; no secrets or personal data.
