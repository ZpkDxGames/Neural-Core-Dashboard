import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { applyMigration } from './migrate.mjs';

const url=process.env.NCORE_TEST_INVALID_URL;
if(url && !url.includes('ncore_phase1b_invalid_test'))throw Error('Refusing to access non-disposable database');
test('failed evidence validation rolls back the entire migration', {skip:!url},async()=>{
  const db=new pg.Client({connectionString:url});
  await db.connect();
  try {
    await assert.rejects(()=>applyMigration(db),/foreign key constraint|violates/i);
    const column=await db.query("SELECT count(*)::integer AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='conversations' AND column_name='content_hash'");
    assert.equal(column.rows[0].n,0);
    const ledger=await db.query("SELECT to_regclass('public.schema_migrations') AS present");
    assert.equal(ledger.rows[0].present,null);
    const evidence=await db.query('SELECT count(*)::integer AS n FROM memory_evidence');
    assert.equal(evidence.rows[0].n,1); // Original invalid data retained for operator repair
  } finally {await db.end();}
});
