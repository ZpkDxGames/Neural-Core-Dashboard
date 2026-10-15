// Admin-only forward migration runner; intentionally NOT imported by the API runtime.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migration = resolve(here, '../db/002_phase_1b.sql');
const sql = readFileSync(migration, 'utf8');
const sha256 = createHash('sha256').update(sql).digest('hex');
export function migrationDigest() { return sha256; }

export async function applyMigration(client) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(17620, 102)');
    await client.query('CREATE TABLE IF NOT EXISTS public.schema_migrations (version integer PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const previous = await client.query('SELECT sha256 FROM public.schema_migrations WHERE version=2');
    if (previous.rows.length) {
      if (previous.rows[0].sha256 !== sha256) throw new Error('Migration checksum drift; no changes applied');
      await client.query('COMMIT');
      return { state: 'already-applied', sha256 };
    }
    await client.query(sql);
    await client.query('INSERT INTO public.schema_migrations(version,sha256) VALUES(2,$1)', [sha256]);
    await client.query('COMMIT');
    return { state: 'applied', sha256 };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--apply' || process.env.NCORE_MIGRATION_BACKUP_VERIFIED !== 'YES') {
    console.error('Requires --apply and explicit NCORE_MIGRATION_BACKUP_VERIFIED=YES after encrypted backup and isolated recovery gate.');
    process.exitCode = 2;
  } else if (process.env.PGUSER === 'neuralcore_api') {
    console.error('Run migrations with a separate PostgreSQL administrator, never neuralcore_api.');
    process.exitCode = 2;
  } else {
    const client = new pg.Client({
      connectionString: process.env.NCORE_MIGRATION_DATABASE_URL || undefined,
      host: process.env.PGHOST || '/var/run/postgresql',
      database: process.env.PGDATABASE || 'neuralcore',
      user: process.env.PGUSER || 'postgres',
      connectionTimeoutMillis: 3000, statement_timeout: 15000
    });
    try { await client.connect(); console.info(await applyMigration(client)); }
    catch (error) { console.error(error instanceof Error ? error.message : 'Migration failed'); process.exitCode = 1; }
    finally { await client.end().catch(() => {}); }
  }
}
