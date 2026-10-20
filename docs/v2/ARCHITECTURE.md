# Neural Brain V2 development candidate

`backend/v2` is independent of Next.js and exports a PostgreSQL memory engine, a private filesystem vault, a bounded worker and an optional internal HTTP handler. The existing server does not import or activate V2. No production listener or browser adapter is added.

## Authority and publication

PostgreSQL stores immutable proposed/published revision snapshots, authenticated principals, owner review proofs, source evidence, typed relations, tombstones, audit and an outbox. Markdown is the published human-readable representation; database search/graph rows are derived from its acknowledged revision. A pending revision never replaces the committed read model.

An agent's authenticated identity is resolved from a hashed 256-bit bearer credential in the private principal registry. Every operation reloads identity/scopes and revocation from the database. Owner scope is never accepted from request bodies. Agents propose; owner decisions additionally consume a short-lived, single-use proof bound to the owner principal, subject and expected revision. Identity and proof provisioning remain admin/step-up-service operations, without public endpoints. Plaintext credentials do not belong in SQL files, URLs, logs, browser bundles or this repository.

Approval locks the note and appends its immutable revision plus outbox event in one SQL transaction. A worker locks note then event; writes a private same-filesystem temporary file, fsyncs it, atomically renames and fsyncs the directory; then acknowledges the hash and updates the search projection in SQL. This is a recoverable saga, **not an atomic SQL/filesystem transaction**. Hash equality makes a crash after rename replayable. A crash before acknowledgement leaves the prior revision visible. Failed jobs have bounded retries and sanitized error codes. Tombstones take precedence over queued writes.

## Notes and reconciliation

`contracts.ts` defines versioned internal contracts. Notes use stable UUIDs and UUID filenames; titles do not determine identity. Safe Obsidian `aliases` expose the display title for ordinary title wikilinks while UUID filenames remain stable. Aliases are untrusted data, never YAML aliases/anchors or a verification mechanism. The YAML subset accepts scalar strings/integers and string arrays (flow or block-list syntax), rejects aliases/tags/objects/unknown or duplicate keys, and bounds field/file/body sizes. Metadata is self-reported; `state: verified` is never an owner decision. Wikilinks are parsed without transclusion or executing content. Only explicit, evidence-bearing typed relations enter the authoritative graph; unresolved title wikilinks remain references until disambiguated by an owner proposal.

Owner-scoped reconciliation records changed, malformed, missing, renamed, orphan and tombstoned files. Body edits become proposals carrying the observed file hash, not implicit facts. An owner may approve an external edit as a new revision, cancelling a superseded pending publication. `repair()` permits an owner with a separate proof to retry a conflicted/failed publication against the newly observed file hash. Renames are surfaced for review; the implementation keeps UUID canonical filenames rather than silently changing identity or importing unknown files.

The directory must be private and exclusively owned by the service/owner. Symlinks, hardlinks, insecure permission bits, traversal and invalid UTF-8 fail closed. The worker rechecks bytes immediately before rename. Arbitrary external filesystem writers do not participate in PostgreSQL locks: simultaneous uncooperative editor writes in the final check/rename window are an OS-level coordination limitation. Staging certification must use an exclusive writer policy or a coordinated editor copy/mount. No claim of filesystem compare-and-swap across arbitrary external processes is made.

## Retrieval, permissions and budgets

Every SQL read filters owner and optional `type:*` scopes. API roles cannot create principals, insert owner proofs or mutate immutable revisions. Pending proposals are capped at 100 per principal and 1,000 per owner; publication backlog is capped at 1,000. Stale proposals retain a durable conflict state and can be explicitly rejected without changing the winning revision.

No RLS multitenancy claim is made: this remains a private single-owner service, with application-enforced scopes and separate credential boundaries. A future public/multitenant gateway requires independent review.

PostgreSQL full-text GIN projection uses weighted title/tags and body, deterministic score/UUID ordering, signed query/principal-scoped keyset cursors and a maximum 50-row page. Graph breadth-first expansion is bounded to depth 3, 300 nodes and 900 evidence-bearing edges. The response budget is 256 KiB; over-budget responses fail explicitly. The engine uses no embeddings, vector extension, model calls, tools or background inference. All imported/model text is inert, untrusted content.

Recommended pool maximum is two. Internal HTTP limits two active requests, a bounded per-principal minute quota, 240 KiB JSON bodies and ten-second request deadlines. SQL statement/lock timeouts are five/two seconds. Worker batches are capped at 100 and default to 16, with no unbounded watcher or automatic schedule. Embeddings and remote synchronization remain absent/off.

## Deletion and recovery

Owner deletion hides a curated note immediately, drops its projection and queues physical deletion. Source deletion through existing v1 tables cascades evidence, tombstones dependent notes and queues file withdrawal. Tombstones reject subsequent publication/reimport of that identity. Historical revisions remain private in PostgreSQL for separately decided retention; APIs never return tombstoned content. Browser archive deletion, vault deletion, original provider deletion and backup expiry are separate boundaries.

`checkpoint.mjs` verifies published file hashes, schema version, tombstones and an externally supplied snapshot identity while writes are quiesced. It detects missing/changed files and mismatched pairs. It is not a backup scheduler or proof that a real `pg_dump` was taken. Actual encrypted DB+vault snapshot/restore, retention, AGE key handling and shared-VPS load effects require separate operator certification. Existing encrypted DB backup code is preserved.

## Browser boundary

The rebuilt UI wraps existing IndexedDB/import logic and consumes a default unavailable vault port. It may show explicit synthetic demonstrations with a persistent demo banner. No fake/test adapter is reachable from production, and no UI feature can enable synchronization or grant owner permissions. Existing Google OIDC routes remain independent and unchanged.
