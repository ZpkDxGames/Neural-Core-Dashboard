import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { applyMigration } from './migrate.mjs';
import { MemoryStore,StorageError } from './memory-store.mjs';

const adminUrl=process.env.NCORE_TEST_ADMIN_URL;
const apiUrl=process.env.NCORE_TEST_API_URL;
const enabled=Boolean(adminUrl&&apiUrl);
if(enabled && (!adminUrl.includes('ncore_phase1b_test')||!apiUrl.includes('ncore_phase1b_test'))) {
  throw Error('Refusing to test against any database without the exact disposable ncore_phase1b_test name');
}
const fixture={conversations:[{id:'chatgpt:synthetic-42',provider:'chatgpt',title:'Synthetic unit record',createdAt:null,updatedAt:null,messages:[{id:'m-42',role:'user',text:'Synthetic assertion evidence',at:null}]}]};
test('PostgreSQL migration and memory CRUD run against disposable database', {skip:!enabled}, async()=>{
  const admin=new pg.Client({connectionString:adminUrl});
  await admin.connect();
  try {
    const first=await applyMigration(admin);
    assert.equal(first.state,'applied');
    const again=await applyMigration(admin);
    assert.equal(again.state,'already-applied');
    const perms=await admin.query(`SELECT
      has_table_privilege('neuralcore_api','conversations','INSERT') AS can_insert,
      has_table_privilege('neuralcore_api','schema_migrations','SELECT') AS sees_migrations,
      has_schema_privilege('neuralcore_api','public','CREATE') AS can_create`);
    assert.equal(perms.rows[0].can_insert,true);
    assert.equal(perms.rows[0].sees_migrations,false);
    assert.equal(perms.rows[0].can_create,false);
    const pool=new pg.Pool({connectionString:apiUrl,max:2});
    try{
      const store=new MemoryStore(pool,'ci-synthetic-cursor-key-32-bytes-000000');
      const key='ci-test-idempotent-import-42';
      const a=await store.importBatch(fixture,key);
      assert.equal(a.imported,1);assert.equal(a.replayed,false);
      const b=await store.importBatch(fixture,key);
      assert.equal(b.replayed,true);
      const status=await store.status();
      assert.equal(status.conversations,1);
      const page=await store.conversations({limit:1,cursor:null,provider:'chatgpt'});
      assert.equal(page.items[0].id,'chatgpt:synthetic-42');
      const record=await store.conversation('chatgpt:synthetic-42',{limit:2,cursor:null});
      assert.equal(record.messages[0].text,'Synthetic assertion evidence');
      await assert.rejects(()=>store.importBatch({...fixture,conversations:[{...fixture.conversations[0],title:'Changed'}]},key),e=>e.code==='IDEMPOTENCY_CONFLICT');
      await assert.rejects(()=>store.importBatch({...fixture,conversations:[{...fixture.conversations[0],title:'Changed'}]},'synthetic-other-key-0002'),e=>e.code==='SOURCE_CONFLICT');
      assert.equal((await store.status()).conversations,1);
      await assert.rejects(()=>store.updateMemory(null,{nodeType:'fact',label:'Unproven',description:null,confidence:.6,verified:false,evidence:[{conversationId:'chatgpt:synthetic-42',messageId:'not-real'}],edges:[]}),e=>e.code==='MISSING_EVIDENCE');
      const m=await store.updateMemory(null,{nodeType:'fact',label:'Evidence backed',description:'Synthetic fact only',confidence:.99,verified:false,evidence:[{conversationId:'chatgpt:synthetic-42',messageId:'m-42'}],edges:[]});
      assert.equal(m.revision,1);
      await assert.rejects(()=>store.updateMemory(m.id,{nodeType:'fact',label:'Stale revision',verified:false,evidence:[{conversationId:'chatgpt:synthetic-42',messageId:'m-42'}],edges:[]},999),e=>e.code==='REVISION_CONFLICT');
      const revised=await store.updateMemory(m.id,{nodeType:'fact',label:'Revised',verified:true,evidence:[{conversationId:'chatgpt:synthetic-42',messageId:'m-42'}],edges:[]},1);
      assert.equal(revised.revision,2);
      const memories=await store.memories({limit:10,cursor:null,q:'Revised'});
      assert.equal(memories.items.length,1);
      const removed=await store.deleteConversation('chatgpt:synthetic-42');
      assert.equal(removed.tombstoned,true);
      assert.equal((await store.status()).memories,0); // provenance removed, orphan is purged
      await assert.rejects(()=>store.importBatch(fixture,'synthetic-reimport-key-42'),e=>e.code==='DELETION_CONFLICT');
      const cleanup=await admin.query('SELECT COUNT(*)::integer AS n FROM messages');
      assert.equal(cleanup.rows[0].n,0);
    } finally {await pool.end();}
  } finally {await admin.end();}
});
