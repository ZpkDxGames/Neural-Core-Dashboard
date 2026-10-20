import test,{before,after} from 'node:test';import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';import {mkdtemp,rm,writeFile,rename,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {testDatabase} from './test-database.mjs';import {MemoryEngine} from './store.mjs';import {FileVault} from './vault.mjs';import {VaultWorker} from './worker.mjs';
import {hash} from './note.mjs';import {applyVaultMigration} from './migrate.mjs';import {checkpoint,verifyCheckpoint} from './checkpoint.mjs';
let db,engine,vault,worker,root,owner,agent,viewer,other,typed,agent2;
const tokens={owner:'nbv2_'+'a'.repeat(43),agent:'nbv2_'+'b'.repeat(43),viewer:'nbv2_'+'c'.repeat(43),other:'nbv2_'+'d'.repeat(43),typed:'nbv2_'+'e'.repeat(43),agent2:'nbv2_'+'f'.repeat(43)};
const note=(body='Synthetic memory '+randomUUID(),extra={})=>({title:'Synthetic project',body,type:'project',tags:['synthetic'],evidence:[{kind:'conversation',conversationId:'chatgpt:synthetic-v2',messageId:'m1'}],relations:[],...extra});
async function proof(subject,revision,principal=owner){const value=randomBytes(32).toString('base64url');await db.admin.query('INSERT INTO vault_review_grants(proof_hash,owner_id,principal_id,subject_id,expected_revision,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval \'2 minutes\')',[hash(value),principal.ownerId,principal.principalId,subject,revision]);return value;}
async function proposed(n=note(),author=agent,options={}){return engine.submit(author,{note:n,...options},randomUUID());}
async function accepted(n=note(),author=agent){const p=await proposed(n,author);const result=await engine.review(owner,p.proposalId,{decision:'verify',expectedRevision:0,proof:await proof(p.proposalId,0)});return {...p,...result};}
async function published(n=note(),author=agent){const result=await accepted(n,author);assert.equal((await worker.once()).state,'committed');return result;}
before(async()=>{
  db=await testDatabase();engine=new MemoryEngine(db.pool,{cursorKey:'synthetic-cursor-secret-key-with-32-bytes'});
  root=await mkdtemp(join(tmpdir(),'synthetic-v2-integration-'));vault=new FileVault(root);await vault.initialise();worker=new VaultWorker(engine,vault,{retryDelayMs:0});
  for(const [name,role,ownerId,scopes] of [['owner','owner','owner',['read','propose','review','delete','export']],['agent','contributor','owner',['read','propose']],['viewer','viewer','owner',['read']],['other','owner','synthetic-other',['read','propose','review','delete','export']],['typed','contributor','owner',['read','propose','type:reference']],['agent2','contributor','owner',['read','propose']]]){
    await db.admin.query('INSERT INTO vault_principals(principal_id,owner_id,display_name,kind,role,scopes,token_hash) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),ownerId,'SYNTH-'+name,role==='owner'?'owner':'agent',role,scopes,hash(tokens[name])]);
  }
  [owner,agent,viewer,other,typed,agent2]=await Promise.all(['owner','agent','viewer','other','typed','agent2'].map(k=>engine.authenticate(tokens[k])));
  await db.admin.query("INSERT INTO conversations(id,source_id,title,owner_id) VALUES('chatgpt:synthetic-v2','chatgpt','Synthetic source','owner')");
  await db.admin.query("INSERT INTO messages(conversation_id,message_id,role,body) VALUES('chatgpt:synthetic-v2','m1','user','Synthetic evidence for PostgreSQL architecture and testing.')");
});
after(async()=>{await db?.close();if(root)await rm(root,{recursive:true,force:true});});

test('V2 additive migration checksum, least privilege and immutable revisions',async()=>{
  assert.equal((await applyVaultMigration(db.admin)).state,'already-applied');
  const r=await db.admin.query(`SELECT has_table_privilege('neuralcore_api','vault_revisions','UPDATE') AS alters_revision,
    has_table_privilege('neuralcore_api','vault_principals','INSERT') AS grants_identity,
    has_table_privilege('neuralcore_api','vault_review_grants','INSERT') AS forges_proof,
    has_schema_privilege('neuralcore_api','public','CREATE') AS creates_schema`);
  assert.deepEqual(r.rows[0],{alters_revision:false,grants_identity:false,forges_proof:false,creates_schema:false});
  await db.admin.query("UPDATE schema_migrations SET sha256=repeat('0',64) WHERE version=3");await assert.rejects(()=>applyVaultMigration(db.admin),/checksum drift/);
  await db.admin.query('UPDATE schema_migrations SET sha256=$1 WHERE version=3',[hash(await readFile(new URL('../../db/003_vault_v2.sql',import.meta.url),'utf8'))]);
  assert.equal((await applyVaultMigration(db.admin)).state,'already-applied');
});
test('agent scopes, revoked tokens, forged roles and evidence validation fail closed',async()=>{
  await assert.rejects(()=>engine.authenticate('bad'),e=>e.code==='UNAUTHORIZED');
  await assert.rejects(()=>proposed(note(),viewer),e=>e.code==='ROLE_FORBIDDEN');
  await assert.rejects(()=>engine.agents(agent),e=>e.code==='ROLE_FORBIDDEN');
  await assert.rejects(()=>proposed(note(),typed),e=>e.code==='ROLE_FORBIDDEN');
  await assert.rejects(()=>proposed(note('Synthetic',{evidence:[{kind:'manual',reason:'Agent invents manual approval'}]})),e=>e.code==='MANUAL_PROVENANCE_OWNER_REQUIRED');
  await assert.rejects(()=>proposed(note('Synthetic',{evidence:[{kind:'conversation',conversationId:'private-other-source',messageId:'m1'}]})),e=>e.code==='MISSING_EVIDENCE');
  await assert.rejects(()=>proposed(note('Synthetic',{evidence:[{kind:'conversation',conversationId:'chatgpt:synthetic-v2',messageId:'m1',spanStart:0,spanEnd:1000}]})),e=>e.code==='INVALID_EVIDENCE_SPAN');
  await db.admin.query('UPDATE vault_principals SET disabled_at=now() WHERE principal_id=$1',[viewer.principalId]);
  await assert.rejects(()=>engine.list(viewer),e=>e.code==='UNAUTHORIZED');await db.admin.query('UPDATE vault_principals SET disabled_at=NULL WHERE principal_id=$1',[viewer.principalId]);
});
test('idempotent proposals never self-verify and require single-use owner review proof',async()=>{
  const input={note:note()},key=randomUUID();const p=await engine.submit(agent,input,key);
  assert.equal((await engine.submit(agent,input,key)).proposalId,p.proposalId);
  await assert.rejects(()=>engine.submit(agent,{note:note()},key),e=>e.code==='IDEMPOTENCY_CONFLICT');
  await assert.rejects(()=>engine.get(owner,p.noteId),e=>e.code==='NOT_FOUND');
  await assert.rejects(()=>engine.review({...agent,role:'owner',kind:'owner'},p.proposalId,{decision:'verify',expectedRevision:0,proof:'x'.repeat(43)}),e=>e.code==='ROLE_FORBIDDEN');
  await assert.rejects(()=>engine.review(owner,p.proposalId,{decision:'verify',expectedRevision:0}),e=>e.code==='OWNER_PROOF_REQUIRED');
  const ownerProof=await proof(p.proposalId,0);await engine.review(owner,p.proposalId,{decision:'verify',expectedRevision:0,proof:ownerProof});
  await assert.rejects(()=>engine.get(owner,p.noteId),e=>e.code==='NOT_FOUND');assert.equal((await worker.once()).state,'committed');
  const n=await engine.get(owner,p.noteId);assert.equal(n.trust,'verified');assert.equal(n.revision,1);assert.equal(n.selfReported.state,'proposed');
  await assert.rejects(()=>engine.review(owner,p.proposalId,{decision:'reject',expectedRevision:0,proof:ownerProof}),e=>e.code==='PROPOSAL_ALREADY_REVIEWED');
});
test('two competing agent revisions produce one owner commit and one revision conflict',async()=>{
  const original=await published();const options={noteId:original.noteId,baseRevision:1};
  const [a,b]=await Promise.all([proposed(note(),agent,options),proposed(note(),agent2,options)]);
  const pa=await proof(a.proposalId,1),pb=await proof(b.proposalId,1);
  const results=await Promise.allSettled([engine.review(owner,a.proposalId,{decision:'verify',expectedRevision:1,proof:pa}),engine.review(owner,b.proposalId,{decision:'verify',expectedRevision:1,proof:pb})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'REVISION_CONFLICT');
  const loser=results[0].status==='rejected'?a:b;assert.equal((await db.admin.query('SELECT state FROM vault_proposals WHERE proposal_id=$1',[loser.proposalId])).rows[0].state,'conflict');
  await engine.review(owner,loser.proposalId,{decision:'reject',expectedRevision:1,proof:await proof(loser.proposalId,1)});
  assert.equal((await engine.get(owner,original.noteId)).revision,1);await worker.once();assert.equal((await engine.get(owner,original.noteId)).revision,2);
});
test('durable outbox recovers all file/SQL crash windows and double worker replay',async()=>{
  for(const stage of ['before-rename','after-rename','before-acknowledge','after-commit']){
    const p=await accepted(note('Synthetic crash '+stage));let first=true;
    const fault=async at=>{if(at===stage&&first){first=false;throw Error('Synthetic interrupted process');}};
    const w=new VaultWorker(engine,new FileVault(root,{fault}),{fault,retryDelayMs:0});
    const initial=await w.once();assert.ok(['retry','committed'].includes(initial.state));
    await worker.once();const n=await engine.get(owner,p.noteId);assert.equal(n.revision,1);assert.equal((await vault.read('owner',p.noteId+'.md')).hash,n.publishedHash);
    const count=(await db.admin.query('SELECT count(*)::int AS n FROM vault_actions WHERE target_id=$1 AND outcome=\'committed\'',[p.noteId])).rows[0].n;assert.equal(count,1);
  }
  const p=await accepted();await Promise.all([worker.once(),worker.once()]);assert.equal((await engine.get(owner,p.noteId)).revision,1);
});
test('external Obsidian edits are unverified proposals, idempotent, and owner-approved only',async()=>{
  const p=await published(),file=p.noteId+'.md',path=join(await vault.directory('owner'),file);
  const original=await vault.read('owner',file);await writeFile(path,original.text.replace('state: "proposed"','state: "verified"').replace(/\n[^\n]+\n$/,'\nSynthetic external edit [[Example]]\n'),{mode:0o600});
  const found=await worker.reconcile(owner,file);assert.equal(found.code,'EXTERNAL_EDIT_REVIEW');assert.ok(found.proposalId);
  assert.equal((await worker.reconcile(owner,file)).proposalId,found.proposalId);assert.equal((await engine.get(owner,p.noteId)).revision,1);
  await engine.review(owner,found.proposalId,{decision:'publish-unverified',expectedRevision:1,proof:await proof(found.proposalId,1)});
  assert.equal((await worker.once()).state,'committed');const revised=await engine.get(owner,p.noteId);assert.equal(revised.trust,'proposed');assert.equal(revised.revision,2);
  await writeFile(path,original.text,{mode:0o600});assert.equal((await worker.reconcile(owner,file)).code,'EXTERNAL_STALE_REVISION');
  // Restore the current published bytes to permit the remaining fixture checks.
  const r=(await db.admin.query('SELECT markdown FROM vault_revisions WHERE note_id=$1 AND revision=2',[p.noteId])).rows[0];await writeFile(path,r.markdown,{mode:0o600});
});
test('missing, renamed, orphan and malformed files are recorded without deletion or import',async()=>{
  const p=await published(),file=p.noteId+'.md',directory=await vault.directory('owner');
  await rename(join(directory,file),join(directory,'Renamed.md'));
  assert.equal((await worker.reconcile(owner,file)).code,'FILE_MISSING');assert.equal((await worker.reconcile(owner,'Renamed.md')).code,'RENAMED_FILE');
  await rename(join(directory,'Renamed.md'),join(directory,file));
  await writeFile(join(directory,'Malformed.md'),'---\nstate: &anchor\n---\nInvalid',{mode:0o600});assert.match((await worker.reconcile(owner,'Malformed.md')).code,/YAML|FRONTMATTER/);
  const orphan=(await vault.read('owner',file)).text.replace(p.noteId,randomUUID());await writeFile(join(directory,'Orphan.md'),orphan,{mode:0o600});assert.equal((await worker.reconcile(owner,'Orphan.md')).code,'ORPHAN_FILE');
  await rm(join(directory,'Malformed.md'));await rm(join(directory,'Orphan.md'));
});
test('indexed retrieval, signed cursors, owner scopes, graph evidence and index reconstruction',async()=>{
  const a=await published(note('Synthetic lexical postgresql '+randomUUID()));
  const b=await published(note('Synthetic contradiction '+randomUUID(),{relations:[{targetId:a.noteId,type:'contradicts',evidenceOrdinal:0,confidence:.8}]}));
  const graph=await engine.graph(owner,{focus:a.noteId,depth:3,limit:10});assert.equal(graph.nodes.length,2);assert.equal(graph.edges[0].relation_type,'contradicts');assert.equal(graph.edges[0].evidence_ordinal,0);
  assert.equal((await engine.list(owner,{q:'postgresql'})).items.some(n=>n.noteId===a.noteId),true);
  const page=await engine.list(owner,{limit:1});assert.ok(page.nextCursor);
  await assert.rejects(()=>engine.list(owner,{limit:1,cursor:page.nextCursor+'x'}),e=>e.code==='INVALID_CURSOR');
  await assert.rejects(()=>engine.list(other,{cursor:page.nextCursor}),e=>e.code==='INVALID_CURSOR');
  await assert.rejects(()=>engine.get(other,a.noteId),e=>e.code==='NOT_FOUND');assert.equal((await engine.list(other)).items.length,0);
  assert.equal((await engine.list(typed)).items.length,0);await assert.rejects(()=>engine.get(typed,a.noteId),e=>e.code==='ROLE_FORBIDDEN');
  assert.deepEqual((await engine.status(typed)).publication,[]);
  await db.admin.query('DELETE FROM vault_search_documents WHERE note_id=$1',[a.noteId]);assert.equal((await engine.list(owner,{q:'postgresql'})).items.some(n=>n.noteId===a.noteId),false);
  await worker.rebuildIndex(owner);assert.equal((await engine.list(owner,{q:'postgresql'})).items.some(n=>n.noteId===a.noteId),true);
  const d=await proposed(note('Synthetic lexical postgresql '+randomUUID()));void d;
  const same=(await engine.get(owner,a.noteId)).body,duplicate=await proposed(note(same));assert.equal(duplicate.duplicateOf,a.noteId);
  await assert.rejects(async()=>engine.review(owner,duplicate.proposalId,{decision:'verify',expectedRevision:0,proof:await proof(duplicate.proposalId,0)}),e=>e.code==='DUPLICATE_NOTE');
});
test('proposal queue backpressure rejects excess agent work without allocating revisions',async()=>{
  await db.admin.query("INSERT INTO vault_proposals(proposal_id,owner_id,principal_id,base_revision,payload,payload_hash,idempotency_key) SELECT gen_random_uuid(),'owner',$1::uuid,0,$2::jsonb,repeat('a',64),'synth-budget-'||i FROM generate_series(1,100) i",[agent2.principalId,JSON.stringify(note())]);
  try{await assert.rejects(()=>proposed(note(),agent2),e=>e.code==='PROPOSAL_QUEUE_FULL');}finally{await db.admin.query("DELETE FROM vault_proposals WHERE idempotency_key LIKE 'synth-budget-%'");}
});
test('paired checkpoint hashes reject missing/changed vault and mismatched snapshot',async()=>{
  const manifest=await checkpoint(engine,vault,owner,{snapshotId:'synthetic-snapshot-001',quiesced:true});assert.equal(verifyCheckpoint(manifest,manifest),true);
  assert.throws(()=>verifyCheckpoint({...manifest,snapshotId:'wrong'},manifest));
  const first=manifest.notes[0],directory=await vault.directory('owner'),file=join(directory,first.noteId+'.md'),bytes=await readFile(file);
  await rm(file);await assert.rejects(()=>checkpoint(engine,vault,owner,{snapshotId:'synthetic-snapshot-001',quiesced:true}),e=>e.code==='INCONSISTENT_CHECKPOINT');await writeFile(file,bytes,{mode:0o600});
});
test('owner repair of an interrupted missing-file publication requires revision-bound proof',async()=>{
  const p=await published(),edit=await proposed(note(),agent,{noteId:p.noteId,baseRevision:1});
  const ack=await engine.review(owner,edit.proposalId,{decision:'verify',expectedRevision:1,proof:await proof(edit.proposalId,1)});
  await rm(join(await vault.directory('owner'),p.noteId+'.md'));
  assert.equal((await worker.once()).state,'conflict');
  await assert.rejects(()=>worker.repair(agent,ack.eventId,{expectedRevision:2}),e=>e.code==='ROLE_FORBIDDEN');
  await worker.repair(owner,ack.eventId,{expectedRevision:2,proof:await proof('repair:'+ack.eventId,2)});
  assert.equal((await worker.once()).state,'committed');assert.equal((await engine.get(owner,p.noteId)).revision,2);
});
test('explicit owner consolidation tombstones the duplicate without modifying its target',async()=>{
  const target=await published(),source=await published(),before=await engine.get(owner,target.noteId);
  await engine.tombstone(owner,source.noteId,{expectedRevision:1,consolidateInto:target.noteId,proof:await proof('consolidate:'+source.noteId,1)});
  await worker.once();await assert.rejects(()=>engine.get(owner,source.noteId),e=>e.code==='NOT_FOUND');assert.equal((await engine.get(owner,target.noteId)).body,before.body);
});
test('owner tombstones and source deletion remove search/graph/files and cannot resurrect',async()=>{
  const p=await published();await assert.rejects(()=>engine.tombstone(agent,p.noteId,{expectedRevision:1}),e=>e.code==='ROLE_FORBIDDEN');
  await engine.tombstone(owner,p.noteId,{expectedRevision:1,proof:await proof('delete:'+p.noteId,1)});await assert.rejects(()=>engine.get(owner,p.noteId),e=>e.code==='NOT_FOUND');await worker.once();assert.equal(await vault.read('owner',p.noteId+'.md'),null);
  const otherNote=await published();await db.admin.query("DELETE FROM conversations WHERE id='chatgpt:synthetic-v2'");
  await assert.rejects(()=>engine.get(owner,otherNote.noteId),e=>e.code==='NOT_FOUND');assert.equal((await engine.list(owner)).items.length,0);
  await worker.batch({limit:100});assert.equal(await vault.read('owner',otherNote.noteId+'.md'),null);
  await assert.rejects(()=>proposed(note()),e=>e.code==='MISSING_EVIDENCE');
});
