// Test-only adapter. Never imported by the application or worker.
import {readFile} from 'node:fs/promises';import pg from 'pg';
import {applyMigration} from '../migrate.mjs';import {applyVaultMigration} from './migrate.mjs';
export async function testDatabase(){
  let admin,pool,close,runtime;
  if(process.env.NCORE_V2_PGLITE_PACKAGE){
    const {PGlite}=await import(process.env.NCORE_V2_PGLITE_PACKAGE);const db=new PGlite();await db.waitReady;
    let tail=Promise.resolve();
    const acquire=async()=>{let release;const prior=tail;tail=new Promise(r=>{release=r;});await prior;return release;};
    const query=async(sql,args)=>args?.length?db.query(sql,args):/^\s*(BEGIN;|--|CREATE TABLE IF NOT EXISTS sources)/.test(sql)?db.exec(sql).then(r=>r.at(-1)):db.query(sql);
    admin={query};
    pool={
      async connect(){const unlock=await acquire();return {async query(sql,args){const result=await query(sql,args);if(sql==='BEGIN')await db.query('SET LOCAL ROLE neuralcore_api');return result;},release:unlock};},
      async query(sql,args){const unlock=await acquire();try{await db.query('SET ROLE neuralcore_api');return await query(sql,args);}finally{await db.query('RESET ROLE');unlock();}}
    };
    close=()=>db.close();runtime='PostgreSQL WASM (PGlite); transactions serialized by test adapter';
  }else{
    const url=process.env.NCORE_V2_TEST_URL;
    if(!url||!['/ncore_v2_test','/ncore_v2_benchmark_test'].includes(new URL(url).pathname)||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw Error('Disposable loopback ncore_v2_test URL required. No live database defaults.');
    admin=new pg.Client({connectionString:url});await admin.connect();
    const {rows}=await admin.query("SELECT current_database() AS name,to_regclass('public.vault_notes') AS populated");
    if(!['ncore_v2_test','ncore_v2_benchmark_test'].includes(rows[0].name)||rows[0].populated)throw Error('A fresh disposable ncore_v2_test is required');
    pool=new pg.Pool({connectionString:process.env.NCORE_V2_API_URL,max:2,connectionTimeoutMillis:2000});
    if(!process.env.NCORE_V2_API_URL||new URL(process.env.NCORE_V2_API_URL).pathname!==new URL(url).pathname)throw Error('Disposable API role URL required');
    close=async()=>{await pool.end();await admin.end();};runtime='native PostgreSQL via node-postgres; max 2 connections';
  }
  // One ephemeral cluster only. Production migrations never create identities.
  await admin.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='neuralcore_api') THEN CREATE ROLE neuralcore_api LOGIN PASSWORD 'synthetic-v2-only'; END IF; END $$");
  const initial=await readFile(new URL('../../db/001_init.sql',import.meta.url),'utf8');
  if(process.env.NCORE_V2_PGLITE_PACKAGE){const result=await admin.query(initial);void result;}else await admin.query(initial);
  await applyMigration(admin);await applyVaultMigration(admin);
  return {admin,pool,close,runtime};
}
