import test,{before,after} from 'node:test';import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';import {mkdtemp,rm,writeFile,rename,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {testDatabase} from './test-database.mjs';import {MemoryEngine} from './store.mjs';import {FileVault} from './vault.mjs';import {VaultWorker} from './worker.mjs';
import {hash} from './note.mjs';import {createServer} from 'node:http';import {makeV2Handler} from './api.mjs';import {applyVaultMigration} from './migrate.mjs';import {checkpoint,verifyCheckpoint} from './checkpoint.mjs';
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
test('mixed proposal queue uses microsecond keysets, actionable defaults, signed scopes and bounded payload pages',async()=>{
  const principalId=randomUUID(),token='nbv2_'+'g'.repeat(43);
  await db.admin.query('INSERT INTO vault_principals(principal_id,owner_id,display_name,kind,role,scopes,token_hash) VALUES($1,$2,$3,$4,$5,$6,$7)',[principalId,other.ownerId,'SYNTH queue agent','agent','contributor',['read','type:reference'],hash(token)]);
  const scoped=await engine.authenticate(token);
  const states=['accepted','rejected','proposed','conflict'];
  const expected=[];
  try{
    // Old historical rows sort before all reviewable work. A millisecond-only cursor
    // loses many of these distinct timestamps; ties also exercise the UUID key.
    for(let i=0;i<167;i++){
      const proposalId=randomUUID(),state=states[i%4],kind=i%3?'reference':'project',author=i%2?principalId:other.principalId;
      await db.admin.query(`INSERT INTO vault_proposals(proposal_id,owner_id,note_id,principal_id,base_revision,payload,payload_hash,idempotency_key,state,created_at)
        VALUES($1,$2,$3,$4,0,$5,repeat('a',64),$6,$7,'2026-10-21T00:00:00Z'::timestamptz+($8::int*interval '1 microsecond'))`,
        [proposalId,other.ownerId,randomUUID(),author,JSON.stringify(note('Synthetic queue '+i,{type:kind})), 'pagination-'+i,state,Math.floor(i/2)]);
      expected.push({proposalId,state,kind,author});
    }
    const collect=async(who,options={})=>{const result=[];let cursor=null,first;
      do{const page=await engine.proposals(who,{limit:7,...options,cursor});first??=page;
        assert.ok(page.items.length<=7);assert.equal(page.partial,Boolean(page.nextCursor));result.push(...page.items);cursor=page.nextCursor;
        assert.ok(result.length<=167);
      }while(cursor);return {result,first};};
    const queue=await collect(other);assert.equal(queue.result.length,expected.filter(x=>['proposed','conflict'].includes(x.state)).length);
    assert.equal(new Set(queue.result.map(x=>x.proposal_id)).size,queue.result.length);
    const all=await collect(other,{statuses:states});assert.equal(all.result.length,167);assert.equal(new Set(all.result.map(x=>x.proposal_id)).size,167);
    for(const [i,item] of all.result.entries())if(i)assert.ok(new Date(item.created_at)>=new Date(all.result[i-1].created_at));
    const server=createServer(makeV2Handler({engine,enabled:true}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try{
      const base='http://127.0.0.1:'+server.address().port+'/v2/memories/proposals';let cursor=null,firstCursor;const ids=[];
      do{
        const url=new URL(base);url.searchParams.set('limit','13');for(const state of states)url.searchParams.append('status',state);if(cursor)url.searchParams.set('cursor',cursor);
        const response=await fetch(url,{headers:{authorization:'Bearer '+tokens.other}});assert.equal(response.status,200);
        const body=await response.json();assert.equal(body.schemaVersion,2);assert.equal(body.data.partial,Boolean(body.data.nextCursor));
        ids.push(...body.data.items.map(x=>x.proposal_id));cursor=body.data.nextCursor;firstCursor??=cursor;
      }while(cursor);
      assert.deepEqual(new Set(ids),new Set(expected.map(x=>x.proposalId)));assert.equal(ids.length,167);
      const cross=new URL(base);cross.searchParams.set('limit','13');for(const state of states)cross.searchParams.append('status',state);cross.searchParams.set('cursor',firstCursor);
      assert.equal((await fetch(cross,{headers:{authorization:'Bearer '+tokens.owner}})).status,400);
    }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}

    const references=await collect(scoped,{statuses:states});assert.deepEqual(new Set(references.result.map(x=>x.proposal_id)),new Set(expected.filter(x=>x.author===principalId&&x.kind==='reference').map(x=>x.proposalId)));
    const filtered=await collect(other,{noteTypes:['project'],statuses:['conflict']});assert.equal(filtered.result.length,expected.filter(x=>x.kind==='project'&&x.state==='conflict').length);
    const cursor=queue.first.nextCursor;assert.ok(cursor);
    for(const [who,options] of [[owner,{}],[scoped,{}],[other,{statuses:states}],[other,{noteTypes:['project']}],[other,{limit:8}]])
      await assert.rejects(()=>engine.proposals(who,{limit:7,cursor,...options}),e=>e.code==='INVALID_CURSOR');
    await assert.rejects(()=>engine.list(other,{limit:7,cursor}),e=>e.code==='INVALID_CURSOR');
    await assert.rejects(()=>engine.proposals(other,{limit:7,cursor:cursor+'x'}),e=>e.code==='INVALID_CURSOR');
    await db.admin.query("UPDATE vault_principals SET scopes=ARRAY['read','type:project'] WHERE principal_id=$1",[principalId]);
    await assert.rejects(()=>engine.proposals(scoped,{limit:7,statuses:states,cursor:references.first.nextCursor}),e=>e.code==='INVALID_CURSOR');
    await db.admin.query('UPDATE vault_principals SET disabled_at=now() WHERE principal_id=$1',[principalId]);
    await assert.rejects(()=>engine.proposals(scoped),e=>e.code==='UNAUTHORIZED');
    await db.admin.query("UPDATE vault_principals SET disabled_at=NULL,scopes=ARRAY['read','type:reference'] WHERE principal_id=$1",[principalId]);
    for(const options of [{limit:51},{statuses:[]},{statuses:['pending']},{statuses:states.concat('proposed')},{noteTypes:['*']},{noteTypes:'reference'}])
      await assert.rejects(()=>engine.proposals(other,options),e=>['INVALID_QUERY','INVALID_LIMIT'].includes(e.code));
    // A reviewed/deleted anchor does not invalidate chronological keyset progress.
    await db.admin.query("UPDATE vault_proposals SET state='rejected' WHERE proposal_id=$1",[queue.first.items.at(-1).proposal_id]);
    const continued=await engine.proposals(other,{limit:7,cursor});assert.ok(continued.items.length);assert.ok(continued.items.every(x=>!queue.first.items.some(y=>x.proposal_id===y.proposal_id)));
    // An old row returning to conflict is reached on refresh, not a historical-first page.
    await db.admin.query("UPDATE vault_proposals SET state='conflict' WHERE proposal_id=$1",[expected[0].proposalId]);
    assert.equal((await engine.proposals(other,{limit:7})).items[0].proposal_id,expected[0].proposalId);
    await db.admin.query('UPDATE vault_proposals SET payload=$1 WHERE owner_id=$2',[JSON.stringify(note('Synthetic large '.padEnd(180000,'x'),{type:'reference'})),other.ownerId]);
    const big=await collect(other,{statuses:states});assert.equal(big.result.length,167);assert.equal(big.first.items.length,1);assert.ok(Buffer.byteLength(JSON.stringify(big.first))<262144);
  }finally{
    await db.admin.query("DELETE FROM vault_proposals WHERE owner_id=$1 AND idempotency_key LIKE 'pagination-%'",[other.ownerId]);
    await db.admin.query('DELETE FROM vault_principals WHERE principal_id=$1',[principalId]);
  }
});
test('verified graph projection remains SQL-owned after forged file links, aliases and evidence metadata',async()=>{
  const target=await published(),unrelated=await published();
  const source=await published(note('Synthetic approved links',{relations:[{targetId:target.noteId,type:'supports',evidenceOrdinal:0,confidence:.7}]}));
  const file=source.noteId+'.md',original=await vault.read('owner',file),path=join(await vault.directory('owner'),file);
  const {parseMarkdown}=await import('./note.mjs');assert.deepEqual(parseMarkdown(original.text).meta.brain_links,['[['+target.noteId+']]']);
  // A syntactically valid but forged property and body link must not create SQL edges.
  const changed=original.text.replaceAll(target.noteId,unrelated.noteId).replace('source_refs: [','source_refs: [').replace('state: "proposed"','state: "verified"')+'\n[['+unrelated.noteId+']]\n';
  await writeFile(path,changed,{mode:0o600});const edit=await worker.reconcile(owner,file);assert.equal(edit.code,'EXTERNAL_EDIT_REVIEW');
  const payload=(await db.admin.query('SELECT payload FROM vault_proposals WHERE proposal_id=$1',[edit.proposalId])).rows[0].payload;
  assert.deepEqual(payload.relations,[{targetId:target.noteId,type:'supports',evidenceOrdinal:0,confidence:.7}]);
  assert.deepEqual(payload.evidence,note().evidence);
  await engine.review(owner,edit.proposalId,{decision:'publish-unverified',expectedRevision:1,proof:await proof(edit.proposalId,1)});await worker.once();
  const next=parseMarkdown((await vault.read('owner',file)).text);assert.deepEqual(next.meta.brain_links,[]);assert.equal((await engine.get(owner,source.noteId)).trust,'proposed');
  const edges=await engine.graph(owner,{focus:source.noteId,depth:1});assert.equal(edges.edges.length,1);assert.equal(edges.edges[0].target_id,target.noteId);
});
test('checkpoint rejects tombstone resurrection, scoped exports, missing SQL projections and quiescence drift',async()=>{
  const target=await published(),file=target.noteId+'.md',bytes=(await vault.read('owner',file)).text;
  const originalList=engine.list;engine.list=()=>{throw Error('Checkpoint must use bounded authoritative ledger, not the search projection');};
  try{
    await db.admin.query('DELETE FROM vault_search_documents WHERE note_id=$1',[target.noteId]);
    const full=await checkpoint(engine,vault,owner,{snapshotId:'synthetic-checkpoint-full',quiesced:true});assert.ok(full.notes.some(x=>x.noteId===target.noteId));
    await assert.rejects(()=>checkpoint(engine,vault,owner,{snapshotId:'synthetic-checkpoint-full',quiesced:'true'}),e=>e.code==='QUIESCED_SNAPSHOT_REQUIRED');
    await db.admin.query("UPDATE vault_principals SET scopes=array_append(scopes,'type:project') WHERE principal_id=$1",[owner.principalId]);
    await assert.rejects(()=>checkpoint(engine,vault,owner,{snapshotId:'synthetic-checkpoint-full',quiesced:true}),e=>e.code==='FULL_VAULT_SCOPE_REQUIRED');
    await db.admin.query("UPDATE vault_principals SET scopes=array_remove(scopes,'type:project') WHERE principal_id=$1",[owner.principalId]);
    await engine.tombstone(owner,target.noteId,{expectedRevision:1,proof:await proof('delete:'+target.noteId,1)});await worker.once();
    await writeFile(join(await vault.directory('owner'),file),bytes,{mode:0o600});
    await assert.rejects(()=>checkpoint(engine,vault,owner,{snapshotId:'synthetic-checkpoint-full',quiesced:true}),e=>e.code==='TOMBSTONED_FILE');await rm(join(await vault.directory('owner'),file));
    const valid=await checkpoint(engine,vault,owner,{snapshotId:'synthetic-checkpoint-full',quiesced:true});assert.ok(valid.tombstones.some(x=>x.note_id===target.noteId));
    const originalStamp=vault.inventoryStamp.bind(vault);let calls=0;vault.inventoryStamp=async who=>{const value=await originalStamp(who);return ++calls>2?value+'-drift':value;};
    try{await assert.rejects(()=>checkpoint(engine,vault,owner,{snapshotId:'synthetic-checkpoint-full',quiesced:true}),e=>e.code==='VAULT_NOT_QUIESCENT');}finally{vault.inventoryStamp=originalStamp;}
    const forged={...valid,notes:[...valid.notes,{noteId:target.noteId,revision:1,hash:hash(bytes)}]};const {sha256,...rest}=forged;forged.sha256=hash(JSON.stringify(rest));
    assert.throws(()=>verifyCheckpoint(forged,forged),e=>e.code==='CHECKPOINT_MISMATCH');
    await worker.rebuildIndex(owner);
  }finally{engine.list=originalList;}
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
