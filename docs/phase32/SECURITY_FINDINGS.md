# Phase 3.2 security-readiness findings

This is an implementation-author readiness pass for another independent audit, not that independent audit itself.

1. **Confirmed authorization race:** a Redis-only logout could acknowledge deletion while an already admitted SQL decision later committed. The deterministic precommit control demonstrates this. Corrected with the SQL session fence and coordinated owner logout/replacement-login ordering described in ARCHITECTURE.md. The contract permits a transaction holding the shared lock to finish before effective revocation; it promises no later decision commit after successful coordinated logout.
2. **Potential fence resurrection at the issuer boundary:** the issuer previously held table-wide UPDATE on private sessions. 006 narrows columns and makes revocation/bindings monotonic. Role tests attempt expiry extension, revocation clearing, consent restoration and epoch regression and require denial. Existing API/PUBLIC restrictions remain.
3. **Unbound owner context:** a private-engine owner identity could omit `authorization`, skipping session checks for read/propose operations. Owner proof consumption already required binding for sensitive decisions. The private engine now consistently rejects an unbound owner context with HTTP-equivalent 401; synthetic machine agents retain their separate scope/expiry/epoch authorization.
4. **Authentication classification:** a missing, revoked, expired or identity-mismatched SQL session is now `NO_OWNER_SESSION` / 401. Consent/epoch conflicts remain authorization failures / 403. Database, primary-store, key, transport and uncertain revocation acknowledgments remain unavailable / 503. Raw exception/provider text is never returned or logged by the new path.

## Boundary verification

| Boundary | Evidence required from this candidate's exact-head CI |
|---|---|
| SQL admission and commit order | Independent native API/issuer transactions, held shared session lock, observed `pg_stat_activity` lock waiter, release, committed decision then fenced session; inverse ordering denies later authorization. |
| SQL permissions | Original 003–005 least-privilege, immutable grant/custody tests plus 006 column/trigger rights, rollback/checksum and resurrection attempts. |
| Proof single use | Original action/subject/revision/intent/family/identity/epochs, atomic consumption/receipt and concurrent completion tests; outstanding grant denied after the fence. |
| Credential recovery | All Phase 3.1 timeout, rollback/COMMIT, sink/SQL lost acknowledgment, duplicate delivery, generation fencing, rotation/revocation and erasure tests; additional fenced retry denial/cleanup. |
| Private gateway | Actual authorized TLS 1.3 client/server pins, ES256 assertions, strict confirmation claims, audience/expiry/method/path/body, shared JTI replay/quota. Revocation route is equally protected and has no browser identity/proof override. |
| Owner/BFF | Original OIDC state/nonce/PKCE, immutable subject, CSRF/origin/consent suites; new logout/relogin/rotation retry contracts and actual owner session → mTLS → SQL journey. |
| Regression | Preserve all 332 baseline cases, including all original 141 Playwright tests. Append security cases; verify baseline test bytes and integration prefix. No removed/weakened/skipped original tests. |

## Audit inputs and holds

Fresh GitHub source at `108b6357cc8778d570657ebf569c2de0043b1f4e` was inspected before edits. The two available uploaded review files both contain the earlier **Phase 3** review of `3e830e0`; neither is the requested Phase 3.1 independent review. A title/content search and recent-upload inventory found no Phase 3.1 review. The missing review is an explicit audit-input gap; no statement here claims it was read or that all of its findings were addressed. The current user directive and source-supported race define this remediation. Reconcile that review when supplied before independent sign-off.

Real Google freshness, real primary Redis failover/revocation, private hosting/ingress and key custody, actual durable sink fencing, paired encrypted SQL/vault restore, shared-VPS capacity, Obsidian Desktop, >10k checkpoint and hardware/manual accessibility remain unqualified. Do not activate staging from source/CI success. A private deployment lacking the owner-auth SQL callback on any instance is a stop condition. No merge, deployment, live migration, environment change, real credential action or Oracle/VPS modification is included.
