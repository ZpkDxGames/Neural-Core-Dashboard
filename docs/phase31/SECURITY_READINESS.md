# Phase 3.1 security-readiness inspection

This is the implementation author's evidence-backed readiness pass, **not a substitute for the requested next independent security audit**. The attached 2026-10-22 independent review supplied the two primary work items.

| Boundary | Inspection and evidence | Disposition |
|---|---|---|
| Issuer/API/admin SQL | Migrations 003–005, fixed-search-path security-definer functions, API `UPDATE(used_at)` only; native role-denial and immutable delivery-field tests | API cannot mint grants, provision principals, alter consent or read custody ciphertext. Issuer remains a trusted workload, not Byzantine isolated from itself. |
| Owner proof | Fresh signed Google identity, action/subject/revision/intent/session/identity/epoch bounds, existing one-use SQL consumption, rollback and concurrent receipt tests | No freshness or single-use relaxation. Expired unfinished deliveries cannot activate. |
| Agent scopes and revocation | Existing proposal-only/read/type/role/expiry/epoch/cursor tests plus pending-rotation rollback/revocation/recovery tests | No owner or review escalation; pending tokens never become active through failed transactions. |
| SQL rotation intent | Global one-hour cap did not restrict a shorter approved TTL in 004 | Corrected in 005; direct restricted-issuer negative regression retains proof and prior credential. |
| Concurrent SQL rotation/revocation | Expected epoch was read before the target row lock | 005 rechecks epoch/enabled state on the locked row; native two-session barrier regression requires one commit and one stale rejection. |
| BFF session/CSRF/origin/consent | Shared `owner-access.ts`, rechecks, existing BFF/owner auth and all original browser cases | No BFF or owner login implementation changed. No generic proxy or browser proof/credential path. |
| Gateway mTLS/assertion | TLS 1.3 actual peer pin, ES256, exact issuer/audience/method/path/body/session binding, SQL JTI/quota | Malformed signed confirmation/JSON objects now explicitly 401. Genuine SQL outage stays 503. |
| Retry/concurrency | Durable intent before sink, no open transaction during sink call, row-locked receipt/activation, unique pending principal delivery | Duplicate concurrent completions converge. Lost commit/sink acknowledgments and process interruption covered. |
| Secrets and key custody | Random credential; digest plus authenticated ciphertext only; terminal erasure; primary family checks before/after delivery | No plaintext in receipts, SQL audit or diagnostics. Real sink fencing and key custody require separate operational qualification. |
| Dependencies | Initial locked Next 16.4.0 advisory audit exposed critical security advisories | Pin Next 16.4.2 with regenerated lock; root and backend audit gates retained. No unrelated dependency refresh. |

Official dependency reference: https://nextjs.org/blog/nextjs-security-update-october-14-2026 (patched releases and advisory links). Source inclusion in an affected package range establishes a patch requirement; it does not establish exploitation or that every vulnerable feature is exercised here.

Independent review should focus on 005 ACLs/function replacement, encrypted intent authentication and erasure, receipt/epoch ordering and concurrency, key lifecycle, and the sink's idempotency/fencing contract. Further hardening of the trusted issuer into a separately verifying OIDC authority is a larger design question already recorded in Phase 3; it is not implemented here.

No real Google qualification, primary production Redis/session verification, real secret-manager adapter, key registration, network/mTLS hosting, private staging, paired encrypted SQL/vault recovery, >10k checkpoint, Obsidian Desktop, hardware/mobile/manual screen reader or shared-VPS capacity certification is implied. Keep the existing default-off gates and follow the updated staging checklist only after a separate owner decision.
