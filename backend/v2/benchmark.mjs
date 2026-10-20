// Synthetic read-model benchmark. Not a server, scheduler, activation or VPS load test.
import {writeFile,mkdtemp,rm} from 'node:fs/promises';import {tmpdir,cpus,totalmem} from 'node:os';import {join} from 'node:path';import {performance} from 'node:perf_hooks';
import {randomUUID,randomBytes} from 'node:crypto';import {testDatabase} from './test-database.mjs';import {MemoryEngine} from './store.mjs';import {FileVault} from './vault.mjs';import {VaultWorker} from './worker.mjs';import {hash} from './note.mjs';
const target=process.argv[2];if(!target)throw Error('Output JSON path required');
const database=await testDatabase(),root=await mkdtemp(join(tmpdir(),'synthetic-benchmark-'));
const report={runtime:database.runtime,node:process.version,cpu:cpus()[0].model,cpus:cpus().length,systemMemory:totalmem(),fixture:'synthetic compact published PostgreSQL read models; file publication measured separately',points:[]};
const quantile=(samples,p)=>[...samples].sort((a,b)=>a-b)[Math.min(samples.length-1,Math.floor(samples.length*p))];
try{
  const principal=randomUUID(),proposal=randomUUID(),token='nbv2_'+randomBytes(32).toString('base64url');
  await database.admin.query("INSERT INTO vault_principals(principal_id,owner_id,display_name,kind,role,scopes,token_hash) VALUES($1,'synthetic-bench','SYNTH benchmark','owner','owner',ARRAY['read','propose','review','delete','export'],$2)",[principal,hash(token)]);
  const base={title:'Synthetic benchmark',body:'Synthetic benchmark fixture',type:'reference',tags:['synthetic'],evidence:[{kind:'manual',reason:'Synthetic owner-authored benchmark'}],relations:[]};
  await database.admin.query("INSERT INTO vault_proposals(proposal_id,owner_id,principal_id,base_revision,payload,payload_hash,idempotency_key,state) VALUES($1,'synthetic-bench',$2,0,$3,$4,'synthetic-benchmark','accepted')",[proposal,principal,JSON.stringify(base),hash(JSON.stringify(base))]);
  const engine=new MemoryEngine(database.pool,{cursorKey:'synthetic-benchmark-cursor-key-32-bytes'}),identity=await engine.authenticate(token);
  let previous=0;
  for(const count of [1000,10000,100000]){
    const start=performance.now(),from=previous+1;
    await database.admin.query(`INSERT INTO vault_notes(note_id,owner_id,canonical_path,current_revision,published_revision,published_hash,title,note_type,body_hash)
      SELECT ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'synthetic-bench',i::text||'.md',1,1,repeat('f',64),'SYNTH note '||i,'reference',repeat('e',64) FROM generate_series($1::int,$2::int) i`,[from,count]);
    await database.admin.query(`INSERT INTO vault_revisions(owner_id,note_id,revision,base_revision,content_hash,markdown,payload,principal_id,proposal_id)
      SELECT 'synthetic-bench',('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,1,0,repeat('f',64),'SYNTH fixture',
      jsonb_build_object('title','SYNTH note '||i,'body','Synthetic PostgreSQL benchmark needle'||(i%1000),'type','reference','tags',jsonb_build_array('synthetic'),'evidence',jsonb_build_array(),'relations',jsonb_build_array()),$3::uuid,$4::uuid
      FROM generate_series($1::int,$2::int) i`,[from,count,principal,proposal]);
    await database.admin.query(`INSERT INTO vault_search_documents(owner_id,note_id,revision,document)
      SELECT 'synthetic-bench',note_id,1,to_tsvector('simple',payload->>'title'||' '||(payload->>'body')) FROM vault_revisions WHERE owner_id='synthetic-bench' AND NOT EXISTS(SELECT 1 FROM vault_search_documents s WHERE s.note_id=vault_revisions.note_id)`);
    await database.admin.query('ANALYZE vault_search_documents');await database.admin.query('ANALYZE vault_notes');
    const ingestMs=performance.now()-start,samples=[];let responseBytes=0;
    for(let i=0;i<30;i++){const t=performance.now();const response=await engine.list(identity,{q:'needle'+(i%5),limit:25});samples.push(performance.now()-t);responseBytes=Math.max(responseBytes,Buffer.byteLength(JSON.stringify(response)));}
    const graph=await engine.graph(identity,{limit:300});
    const disk=(await database.admin.query("SELECT sum(pg_total_relation_size(oid))::text AS bytes FROM pg_class WHERE relname LIKE 'vault_%' AND relkind='r'")).rows[0].bytes;
    report.points.push({notes:count,added:count-previous,ingestMs,querySamples:samples.length,p50Ms:quantile(samples,.5),p95Ms:quantile(samples,.95),p99Ms:quantile(samples,.99),maxResponseBytes:responseBytes,overviewNodes:graph.nodes.length,overviewPartial:graph.partial,sqlTableBytes:disk,processRss:process.memoryUsage().rss});
    previous=count;
  }
  const vault=new FileVault(root);await vault.initialise();const worker=new VaultWorker(engine,vault);const publication=[];
  for(let i=0;i<20;i++){
    const p=await engine.submit(identity,{note:{...base,body:'Synthetic publication sample '+i}},randomUUID()),proof=randomBytes(32).toString('base64url');
    await database.admin.query("INSERT INTO vault_review_grants(proof_hash,owner_id,principal_id,subject_id,expected_revision,expires_at) VALUES($1,'synthetic-bench',$2,$3,0,now()+interval '2 minutes')",[hash(proof),principal,p.proposalId]);
    await engine.review(identity,p.proposalId,{decision:'publish-unverified',expectedRevision:0,proof});const t=performance.now();const ack=await worker.once();if(ack.state!=='committed')throw Error('Publication benchmark failed');publication.push(performance.now()-t);
  }
  report.publication={samples:20,p50Ms:quantile(publication,.5),p95Ms:quantile(publication,.95)};
  report.notMeasured=['100k physical Markdown-file reconciliation','native concurrent locks when using PostgreSQL WASM','real VPS CPU/IO and Minecraft impact','production WAL growth'];
  await writeFile(target,JSON.stringify(report,null,2));console.log(JSON.stringify({points:report.points,publication:report.publication}));
}finally{await database.close();await rm(root,{recursive:true,force:true});}
