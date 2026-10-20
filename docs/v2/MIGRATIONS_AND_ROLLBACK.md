# Migration 003 and rollback

Migration `db/003_vault_v2.sql` is additive. Versions 001 and 002 are unchanged. `applyVaultMigration(client)` requires the existing checksum ledger, takes an advisory transaction lock, verifies version 3's SHA-256 on replay, and atomically applies DDL plus its ledger row. No API/server imports the migrator. There is no automatic startup migration, production connection default or operational CLI.

New objects: principal registry; notes; proposals; owner review grants; immutable revisions; source evidence; typed relations; publication outbox; external edit journal; GIN search projection; sanitized action audit; source-deletion withdrawal trigger. Existing `neuralcore_api` gets explicit least-privilege DML. PUBLIC receives no access. The API cannot insert identities/proofs or update/delete revision history.

## Disposable verification

Use a new loopback-only `ncore_v2_test` database and an administrator connection. Never point test URLs at Oracle or an existing database. The test harness checks the exact disposable database name and rejects a previously populated V2 schema. Set `NCORE_V2_TEST_URL` and `NCORE_V2_API_URL` with synthetic local credentials, then run:

```sh
node --test backend/v2/integration.test.mjs
```

The harness applies 001, checksum-tracked 002 and 003. GitHub CI creates a disposable PostgreSQL 16 service. Local `NCORE_V2_PGLITE_PACKAGE` is explicitly test-only, using a disposable PostgreSQL WASM instance; it does not replace or duplicate application persistence.

## Operator activation prerequisites

1. Review exact commits, migration hash, passing native PostgreSQL CI, isolated restore and permissions.
2. Approve an encrypted paired snapshot, private directory ownership, free space and resource envelope.
3. Separately approve a staging-only composition root and narrow authenticated ingress/owner delegation design. The current canary token must never be put in Vercel.
4. Provision principal credential hashes and short-lived owner-proof issuer through a separately reviewed admin path. Agent scope grants must be explicit. Do not provision real integrations from this development task.
5. Apply only after explicit owner authorization, with a dedicated migration admin. Runtime roles never migrate.

## Rollback

Default rollback is code/capability rollback: keep V2 unbound/off, stop only its separately authorized worker, retain legacy v1 and browser-local reads, and preserve additive tables/ledger for analysis. Existing live services and credentials are unchanged by this candidate.

Do not run a destructive down migration against real data. Before any future data rollback, quiesce publication and editor writes, restore a known encrypted PostgreSQL+vault pair into a **new isolated** environment, verify manifest/schema/hash/tombstone consistency, and obtain owner approval before selecting that restored state. Never restore only Markdown and let old files resurrect tombstones.

For disposable tests only, dropping the entire disposable database and recreating it proves clean reapplication; the CI database/service is discarded after verification. Historical migration files are never edited to simulate rollback.
