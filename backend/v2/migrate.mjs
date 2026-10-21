import { readFile } from 'node:fs/promises';
import { hash } from './note.mjs';
export async function applyVaultMigration(client){
  const sql=await readFile(new URL('../../db/003_vault_v2.sql',import.meta.url),'utf8'),sha256=hash(sql);
  await client.query('BEGIN');
  try{
    await client.query('SELECT pg_advisory_xact_lock(17620,103)');
    const previous=await client.query('SELECT sha256 FROM schema_migrations WHERE version=3');
    if(previous.rows.length){
      if(previous.rows[0].sha256!==sha256)throw Error('Migration checksum drift');
      await client.query('COMMIT');return {state:'already-applied',sha256};
    }
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations(version,sha256) VALUES(3,$1)',[sha256]);
    await client.query('COMMIT');return {state:'applied',sha256};
  }catch(e){await client.query('ROLLBACK');throw e;}
}
// No CLI entry point, auto-migration or production database default.
