# Neural Core Phase 1b — Architecture, migration and deployment hold

**Stage:** source-only development, draft PR stacked on encrypted-recovery PR #5. This is NOT owner approval to deploy or enable remote sync.

## Verified starting point (2026-10-14 UTC)

- `main`: `75157ad2d60e337a326a1d459496bedfba4a0fab`
- `ops/private-core-local-canary`: `30399e771b1a07a62c882e31327d61530b54eed6` (draft #4)
- `ops/encrypted-backup-recovery-canary`: `b73566cc8a6ccae45438c3e7488a413e2bbbbbd0` (draft #5).
- Prior operator-observed Oracle: PostgreSQL 16 Unix socket only, Node HTTP on `127.0.0.1:4765` only; shared neural-core slice 1 GiB/0.5 OCPU, API 320 MiB cap. Six tables empty except four providers; encrypted AGE dump tested in isolated recovery DB (exit 0). These are **handoff evidence**, NOT freshly measured by this branch.
- No connected SSH or Oracle production deployment performed.

## Source decisions

1. `backend/server.mjs` + `backend/memory-store.mjs` are the **only** server-side storage implementation. Removed the unsafe optional Next.js `/api/v1/ingest` endpoint and `lib/db.ts` pool; no second database remains. The dashboard retains local IndexedDB.
2. Opt-in internal routes require `NCORE_MEMORY_API_ENABLED=1` **and** exact machine bearer **and** loopback requester. Disabled by default. A request with Origin, cookies or browser Sec-Fetch-Site is rejected. No Access-Control-Allow-Origin; no cross-origin browser reads.
3. Browser-to-VPS access **does not exist** in this branch. The local canary bearer is not a browser-login credential and must never be copied to Vercel.
4. Imports use transactional, source-scoped IDs, stable original IDs when known, content digests and explicit Idempotency-Key. Identical retries are no-ops; differing edits/conflicts fail closed instead of overwriting another archive. Each request max 512 KiB, 25 conversations, 1000 total messages, 250 messages/conversation, 50 KiB UTF-8/message. Read pagination max 50.
5. Memory assertions require actual message evidence in the same owner's source. `verified=true` requires a distinct intentional owner-decision header in the local machine API, **not** automated classification. Revisions use optimistic concurrency.
6. Delete of conversation hard-deletes messages and cascaded evidence while retaining small ID-only tombstones; evidence-less affected memory nodes are removed. Tombstones reject silent reimport. Server deletion never deletes IndexedDB and vice versa; backups may retain prior deleted data.
7. No automatic extraction, embeddings, provider account access, or uploads are added.

## Trust boundary / chosen pending design

```
Browser (local IndexedDB; explicit user opt-in)
  → Vercel BFF [FUTURE: owner login + CSRF + secure server session]
  → approved authenticated HTTPS ingress [FUTURE: dedicated, not PlexonPanel]
  → Oracle loopback HTTP (machine auth boundary)
  → PostgreSQL 16 peer-authenticated Unix socket
```

**Owner approved Google OIDC as the identity provider (2026-10-14);** use authorization code + PKCE and a strict verified Google sub allowlist, with a strict verified `sub` allowlist, rotating HttpOnly/Secure/SameSite cookie session, persistent server-side hashed session IDs/revocation, Origin/CSRF validation on state changes, and rate-limited login/logout. BFF should authenticate each request and issue narrow, short-lived machine assertions to a protected private ingress. Avoid copying the current canary token into Vercel; rotate and scope service identity only during an approved setup. Remote API should not trust browser headers as proof of owner login. No wildcard credentialed CORS, no public registration, no fallback owner bypass.

**Explicit approval still needed:** exact verified owner Google `sub`, Google OAuth client provisioning, a session-store vendor and retention policy, approved dashboard origin(s), a dedicated HTTPS hostname or trusted tunnel, TLS termination and service-to-service credential strategy, Caddy/firewall/DNS/Vercel changes. Google OIDC code is implemented but disabled, as documented in `docs/PHASE_1B_GOOGLE_OWNER_AUTH.md`. No production exposure or owner-auth activation until these are chosen and independently tested.

## Migration operator gate — NOT YET APPROVED FOR LIVE USE

On a fresh disposable DB first, run schema `db/001_init.sql`, provision `neuralcore_api` with no superuser and run `node backend/migrate.mjs --apply` as separate migration admin with the admin database connection. The runner wraps DDL + checksum ledger in one transaction and refuses a mismatched checksum. `002` preserves six original tables and builds seven additive changes: owner metadata, source records, revisions/hashes, provenance FK, pagination indexes, imports ledger and deletion tombstones. Existing inconsistent memory evidence will fail validation and roll back the whole migration; do not quietly discard it.

For a **future separately approved** Oracle migration: verify a new encrypted backup, checksum, private-key decrypt and isolated restore; validate role access; stop if service limits, schema or real counts differ. Example syntax only, NOT to execute now:

```bash
# Run from verified pinned checkout as dedicated migration administrator (not neuralcore_api).
sudo -u postgres env PGHOST=/var/run/postgresql PGDATABASE=neuralcore \
  NCORE_MIGRATION_BACKUP_VERIFIED=YES \
  /usr/bin/node backend/migrate.mjs --apply
```

This modifies the live DB and therefore requires an explicit go/no-go. A failed migration must roll back, then restore *only into a separate test database* and inspect; never restore over production without a separately approved disaster-recovery plan.

The active service remains unchanged; never set `NCORE_MEMORY_API_ENABLED=1` in production until application and backup recovery are certified. Keep the API bound to `127.0.0.1:4765`, PostgreSQL TCP off, service accounts and cgroup/sandbox as installed. No Caddy, firewall, other systemd unit or Minecraft modifications.

## Internal routes — developer contract (local only)

Every non-health personal route requires exact bearer token + loopback and rejects browser request headers. `/healthz` public locally and `/readyz` bearer-gated retain their original responses.

- `POST /v1/imports`: JSON `{conversations:[{id,provider,title,createdAt,updatedAt,messages:[{id,role,text,at}]}]}` + `Idempotency-Key`; 201 new / 200 replay / 409 conflicting.
- `GET /v1/conversations?limit=25&provider=chatgpt&cursor=...`: stable descending receipt timestamp + ID, signed cursor.
- `GET /v1/conversations/:id?limit=25&cursor=...`: bounded messages.
- `GET /v1/memories?limit=25&q=...`: bounded search of user-approved node labels; never inferred facts.
- `POST /v1/memories`: `{nodeType,label,description,confidence,verified,evidence:[{conversationId,messageId}],edges:[{targetId,relation,confidence}]}`.
- `PATCH /v1/memories/:id`: same full representation + `If-Match: <revision>` (full replacement, not JSON Patch).
- `DELETE /v1/conversations/:id` and `DELETE /v1/memories/:id`: `X-Confirm-Deletion: delete-server-only` required.
- `GET /v1/sync/status`: server counts, schema version, last committed import; does not imply browser sync.
- For `verified=true`, caller must additionally send `X-Owner-Decision: verify`. This is a request-level explicit marker for a trusted local operator, *not* remotely sufficient proof of owner identity.

## Verification and unfinished gates

CI uses synthetic PostgreSQL 16, a disposable `ncore_phase1b_test`, migration twice (checksum idempotency), least privilege, CRUD/replay/conflict, provenance and deletion; HTTP security, pagination, failed-open tests, frontend unit/typecheck/build and backup sandbox contract. No personal archives are test inputs.

**Still required:** live approved Google login and session-store staging certification, browser E2E, real provider failure-injection; actual PostgreSQL backup-with-synthetic-content → encrypted archive → Windows private-key decrypt → isolated restoration with relationships and checked rollback; session/CSRF/OIDC browser E2E; signed/rotatable ingress credentials; committed npm lockfiles and dependency audit; load tests with p95/p99/PSI/WAL budget; live TPS/MSPT measurements; staged artifact checksum and rollback rehearsal; operator approval. Synthetic CI is not Oracle certification.

## Ownership / stop conditions

Developers may modify this branch and CI using synthetic data. **Only the owner** approves OIDC account/domain/provider, network ingress, Vercel secrets, live database migration, enabling memory routes, or changing backup schedule. Never publish secrets, AGE identity, personal archives, or memory contents.
