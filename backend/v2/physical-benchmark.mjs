// Offline synthetic-only measurement. Creates/removes ONLY its own temporary vault.
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir,cpus,totalmem} from 'node:os';import {join} from 'node:path';
import {execFileSync} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';
import {FileVault} from './vault.mjs';import {checkpoint} from './checkpoint.mjs';import {hash,serializeNote} from './note.mjs';
const id=i=>i.toString(16).padStart(8,'0')+'-0000-4000-8000-000000000000';
const text=i=>serializeNote({noteId:id(i),revision:1,payload:{title:'Synthetic physical fixture '+i,body:'Synthetic physical snapshot benchmark only.',type:'reference',tags:['synthetic'],evidence:[{kind:'manual',reason:'Synthetic benchmark'}],relations:[]},createdAt:'2026-10-21T00:00:00Z',updatedAt:'2026-10-21T00:00:00Z',agentOrigin:'synthetic'});
const identity={ownerId:'synthetic-benchmark',principalId:'synthetic',scopes:['export'],role:'owner'};
async function measure(root,count,mode,legacy){
  const {FileVault:LegacyVault}=await import(pathToFileURL(join(legacy,'vault.mjs')));
  const {checkpoint:legacyCheckpoint}=await import(pathToFileURL(join(legacy,'checkpoint.mjs')));
  let walks=0,reads=0;const Class=mode==='legacy'?LegacyVault:FileVault;
  class MeasuredVault extends Class{async read(...args){reads++;return super.read(...args);}async list(...args){walks++;return super.list(...args);}async inventory(...args){walks++;return super.inventory(...args);}}
  const vault=new MeasuredVault(root);
  // Deliberately no SQL timing: bounded in-memory ledger isolates real physical IO.
  const rows=Array.from({length:Math.min(count,10001)},(_,i)=>({note_id:id(i+1),canonical_path:id(i+1)+'.md',current_revision:1,published_revision:1,published_hash:hash(text(i+1)),deleted_at:null}));
  const engine={authorize:async()=>identity,tx:fn=>fn({query:async(sql,args)=>({rows:sql.includes('SELECT count')?[{n:0}]:sql.includes('canonical_path')?rows.slice(0,args[1]):[]})}),
    list:async({},{limit,cursor})=>{const start=cursor?Number(cursor):0;return {items:rows.slice(start,start+limit).map(n=>({noteId:n.note_id,revision:1,publishedHash:n.published_hash,pending:false})),nextCursor:start+limit<count?String(start+limit):null};}};
  const start=performance.now(),cpu=process.cpuUsage();let result;
  try{
    if(mode==='inventory'){const value=await vault.inventory(identity.ownerId,{quiesced:true});result={entries:value.files.length};}
    else if(mode==='legacy-one-page'){walks++;await LegacyVault.prototype.list.call(vault,identity.ownerId,'',100);result={singlePage:true};}
    else{const manifest=await (mode==='legacy'?legacyCheckpoint:checkpoint)(engine,vault,identity,{snapshotId:'synthetic-physical-checkpoint',quiesced:true});result={notes:manifest.notes.length,manifestBytes:Buffer.byteLength(JSON.stringify(manifest))};}
  }catch(e){result={error:e.code??e.message};}
  const usage=process.resourceUsage();return {...result,elapsedMs:performance.now()-start,cpuMicroseconds:process.cpuUsage(cpu),directoryWalks:walks,fileReads:reads,maxRssKiB:usage.maxRSS,fsReadBlocks:usage.fsRead,fsWriteBlocks:usage.fsWrite};
}
if(process.argv[2]==='--measure'){
  console.log(JSON.stringify(await measure(process.argv[3],Number(process.argv[4]),process.argv[5],process.argv[6])));
}else{
  if(process.argv[2]!=='--synthetic-only'||!/^[a-f0-9]{40}$/.test(process.argv[3]??''))throw Error('Usage: node backend/v2/physical-benchmark.mjs --synthetic-only VERIFIED_BASELINE_SHA OUTPUT.json');
  const baseline=process.argv[3],output=process.argv[4],scratch=await mkdtemp(join(tmpdir(),'synthetic-physical-benchmark-'));
  const report={at:new Date().toISOString(),baseline,method:'Three alternating process-isolated legacy/current trials per size on the same warm-cache fixture. Real files, simulated ledger, no SQL latency. No cache flushing or outlier exclusion. 100k full checkpoint deliberately blocked.',runtime:{node:process.version,cpu:cpus()[0]?.model,cpus:cpus().length,memory:totalmem()},samples:[]};
  try{
    const legacy=join(scratch,'legacy');await mkdir(legacy);
    for(const file of ['vault.mjs','checkpoint.mjs']){
      const source=execFileSync('git',['show',baseline+':backend/v2/'+file],{encoding:'utf8',maxBuffer:1000000}).replaceAll("'./note.mjs'",JSON.stringify(new URL('./note.mjs',import.meta.url).href));
      await writeFile(join(legacy,file),source,{mode:0o600});
    }
    for(const count of [1000,10000,100000]){
      const root=join(scratch,String(count)),vault=new FileVault(root);await vault.initialise();const directory=await vault.directory(identity.ownerId),start=performance.now();
      for(let offset=1;offset<=count;offset+=16)await Promise.all(Array.from({length:Math.min(16,count-offset+1)},(_,j)=>writeFile(join(directory,id(offset+j)+'.md'),text(offset+j),{mode:0o600})));
      const fixtureMs=performance.now()-start,trials=[];
      const modes=count<=10000?['legacy','current','current','legacy','legacy','current']:['current','inventory','legacy-one-page'];
      for(const mode of modes){const value=JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),'--measure',root,String(count),mode,legacy],{encoding:'utf8',maxBuffer:1000000,timeout:120000}));trials.push({mode,...value});}
      report.samples.push({physicalFiles:count,fixtureCreationMs:fixtureMs,trials});console.log(JSON.stringify(report.samples.at(-1)));
      await rm(root,{recursive:true,force:true});
    }
    await writeFile(output,JSON.stringify(report,null,2)+'\n');
  }finally{await rm(scratch,{recursive:true,force:true});}
}
