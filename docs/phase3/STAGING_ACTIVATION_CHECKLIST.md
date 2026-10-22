# Private staging activation — separate owner approval required

No item below has been activated by this development phase. Record a concrete configuration diff, source SHA, reviewers, rollback owner and evidence before requesting activation approval. A missing qualification is a no-go.

## 1. Source and isolation

- [ ] Independently review migration 004, issuer/admin functions, BFF, gateway, adapter and source/test report. Reconfirm the exact heads and dependency chain #4 → #5 → #6 → #7 → #8 → Phase 3; do not merge implicitly.
- [ ] Present a private staging origin/host/port list and a resource envelope. Use a fresh synthetic database, synthetic vault, synthetic owner/provider identities where possible, and a separate secret sink. No production data, shared Oracle migration or Minecraft load test.
- [ ] Obtain explicit owner approval for the stated staging changes only, including any network/credential/Google registration changes. Approval for this source phase is insufficient.

## 2. Network and certificate custody

- [ ] Prove the selected Next.js hosting path supports outbound private HTTPS with client certificates and TLS 1.3. If it cannot, keep remote capability unavailable and redesign the hosting path under review.
- [ ] Permit only the intended BFF workload to the gateway. No public database port, arbitrary proxy or canary-token forwarding. Record permitted DNS/ingress rules and rollback without applying unrelated firewall/Caddy/Cloudflare changes.
- [ ] Provision staging-only CA/server/client certificates and a distinct P-256 assertion key through approved custody. Confirm key files are private, readable only by the workload, absent from bundles/logs and never pasted in chat/PRs.
- [ ] Configure server certificate pin, client identity pins, issuer/audience/kid, origin and hostname checks. Test wrong CA, valid-but-unpinned identity, TLS 1.2, missing certificate, changed body/path, revoked pins/key, replay and expired assertions.
- [ ] Record certificate/key rotation and revocation procedure. Restart the BFF for configuration/key changes; no unreviewed hot reload endpoint.

## 3. Database and roles

- [ ] Take a separately approved synthetic pre-migration backup. Apply 001–004 only to the disposable staging database through the administrator's checksum-ledger workflow. Check rollback and all earlier migration hashes.
- [ ] Use distinct API and issuer logins; issuer receives only reviewed membership. API must not insert principals/grants, mutate grant binding columns, change consent or invoke issuer/admin functions. Confirm UPDATE(used_at) only and immutable revisions.
- [ ] Administrator maps the intended immutable Google subject's hash to the pinned owner principal. Do not trust a browser owner/role header or an email string as identity.
- [ ] Supply an online primary session-family verifier using the existing auth namespace. Verify real logout/rotation/expiration/store outage with independent requests and no positive cache. Check concurrent revocation/decision linearization and epoch changes.

## 4. Existing login and fresh Google authentication

- [ ] Verify the current owner login configuration and actual deployed source. Earlier phase reports are historical, not proof of current Google or Redis readiness.
- [ ] Register/review the exact staging callback `/api/brain/v2/step-up/callback` in the intended Google web client, preserving existing callbacks, only after approval.
- [ ] In a real owner browser, perform a new memory challenge requesting max_age=0, PKCE, nonce and state. Privately inspect verified signed auth_time and confirm a fresh authentication interaction and same immutable owner. Do not log the ID token or claims.
- [ ] Reject a non-owner, mismatched account, old/missing auth_time, old login session, reused state, wrong browser cookie, nonce/state/PKCE mismatch, old challenge, changed intent/revision, epoch downgrade and revoked session.
- [ ] Leave `NCORE_GOOGLE_FRESH_AUTH_QUALIFIED` absent/off until real behavior passes. If Google does not provide qualifying freshness, issue no owner grant; do not replace it with iat or a successful account chooser.

## 5. Controlled capability and consent

- [ ] Supply the reviewed server-only origin, owner mapping, TLS/key file paths, server pin and assertion kid. Credentials must never use NEXT_PUBLIC variables.
- [ ] Keep `NCORE_BRAIN_PRIVATE_ENABLED` and `NCORE_PRIVATE_STAGING_CERTIFIED` absent/off until the owner approves this exact activation. Both are explicit operator gates, not certification inferred by code.
- [ ] Confirm the default build uses unavailableVault and sends no private requests. After enabling staging only, login must still leave the browser disconnected and archive synchronization off.
- [ ] Explicitly consent, connect, read a synthetic published note, inspect unresolved source evidence and graph, propose an edit, perform fresh review and confirm the exact intent. Show database pending separately from file/projection acknowledgment.
- [ ] Revoke consent during an in-flight response, disconnect, take the tab offline and log out from another tab. Confirm late responses are discarded and caches cleared. Reload must require an explicit connection action; no automatic archive transfer.

## 6. Synthetic provisioning and recovery

- [ ] Use one synthetic agent, one explicit type scope, allowed read/propose scopes and credential expiry ≤1 hour. Deny owner/review/delete/export/provision rights, viewer proposals and cross-type access.
- [ ] Deliver the secret directly to the isolated server-side sink. Test sink timeout/failure, late delivery, lost database acknowledgment, same-key retry and changed-intent conflict. Receipts expose only metadata and a nonsecret handle.
- [ ] Test rotation, expiry, role downgrade and revocation against independent HTTP requests and cached identity objects. Revocation must work while the sink is unavailable. Outstanding proposals must remain unverified.
- [ ] Interrupt review before/after SQL commit and worker publication; query the durable receipt before retry. Check two concurrent decisions, rollback, worker replay, file conflict and publication acknowledgment.
- [ ] Preserve the 10,000-entry checkpoint gate. Separately obtain approval for a quiesced matching SQL+vault+manifest encrypted snapshot and isolated restore, including tombstone/no-resurrection validation and off-VPS key custody. SQL-only restore is insufficient.

## 7. Stop conditions and rollback

- [ ] Stop on any owner mismatch, stale/missing freshness, replay acceptance, credential leakage, unauthorized scope, unconfirmed success, noncanonical request acceptance, unrelated service impact or resource threshold breach.
- [ ] Disable the two BFF capability gates; restart that workload; disconnect tabs. Revoke staging session consent, workload certificate/key and synthetic credentials. Preserve sanitized receipts/audit for reconciliation. No destructive schema rollback or production data manipulation.
- [ ] Reconfirm production settings, main/preview, private services and remote synchronization remain unchanged. Real providers, production migration, shared-VPS load checks, merge and deployment each require their own later go/no-go.
