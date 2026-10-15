import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { makeHandler } from './core-server.mjs';
import { MemoryStore,StorageError,validateImport } from './memory-store.mjs';

const token='ab'.repeat(48);
async function app(t,{enabled=true,store={}}={}) {
  const server=createServer(makeHandler({token,memoryEnabled:enabled,memoryStore:store,probe:async()=>{}}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return 'http://127.0.0.1:'+server.address().port;
}
const headers={ authorization:'Bearer '+token };
const fixture={conversations:[{id:'chatgpt:synthetic-one',provider:'chatgpt',title:'Synthetic test',createdAt:null,updatedAt:null,messages:[{id:'m1',role:'user',text:'Synthetic demonstration only',at:null}]}]};
test('validation enforces provider scoped identity, real messages and duplicate rejection',()=>{
  const parsed=validateImport(fixture);
  assert.equal(parsed.messages,1);
  assert.throws(()=>validateImport({...fixture,conversations:[fixture.conversations[0],fixture.conversations[0]]}), e=>e.code==='DUPLICATE_ID');
  assert.throws(()=>validateImport({conversations:[{...fixture.conversations[0],provider:'claude'}]}),e=>e.code==='INVALID_ID');
  assert.throws(()=>validateImport({conversations:[{...fixture.conversations[0],messages:[{id:'a',role:'user',text:'',at:null}]}]}),e=>e.code==='INVALID_MESSAGE');
  assert.throws(()=>validateImport({conversations:[{...fixture.conversations[0],messages:Array(251).fill(fixture.conversations[0].messages[0])}]}),e=>e.code==='INVALID_MESSAGES');
});
test('malicious or tampered pagination cursors are rejected before SQL',()=>{
  const store=new MemoryStore({query:()=>{throw Error('must not query')}},token);
  const cursor=store.cursor({id:'x',ts:new Date().toISOString(),provider:''});
  assert.equal(store.decode(cursor).id,'x');
  assert.throws(()=>store.decode(cursor+'X'),e=>e.code==='INVALID_CURSOR');
  assert.throws(()=>store.decode('!'),e=>e.code==='INVALID_CURSOR');
});
test('default disabled gate and canary health contract stay intact',async t=>{
  const origin=await app(t,{enabled:false,store:{status:async()=>({})}});
  assert.equal((await fetch(origin+'/healthz')).status,200);
  assert.equal((await fetch(origin+'/v1/sync/status',{headers})).status,404);
  assert.equal((await fetch(origin+'/readyz')).status,401);
});
test('private routes reject anonymous, wrong bearer, browser origin/cookies and never allow CORS',async t=>{
  let calls=0;const origin=await app(t,{store:{status:async()=>{calls++;return {mode:'local-canary'};}}});
  for(const hs of [{},{authorization:'Bearer '+('cd'.repeat(48))},{...headers,origin:'https://attacker.example'},{...headers,cookie:'x=y'},{...headers,'sec-fetch-site':'same-origin'}]){
    const r=await fetch(origin+'/v1/sync/status',{headers:hs});
    assert.ok([401,403].includes(r.status));
    assert.equal(r.headers.get('access-control-allow-origin'),null);
    assert.match(r.headers.get('cache-control'),/no-store/);
  }
  assert.equal(calls,0);
  assert.equal((await fetch(origin+'/v1/sync/status',{headers})).status,200);
  assert.equal(calls,1);
});
test('import refuses unsupported media, excessive declared body, owner verification and deletion without explicit confirmation',async t=>{
  const origin=await app(t,{store:{importBatch:async()=>({imported:1,replayed:false}),updateMemory:async()=>({id:'x'}),deleteConversation:async()=>({deleted:true})}});
  const p=(path,method,hs={},bodyValue='{}')=>fetch(origin+path,{method,headers:{...headers,...hs},body:bodyValue});
  assert.equal((await p('/v1/imports','POST',{'content-type':'text/plain'})).status,415);
  assert.equal((await p('/v1/imports','POST',{'content-type':'application/json'},'x')).status,400);
  assert.equal((await p('/v1/imports','POST',{'content-type':'application/json'},' '.repeat(524289))).status,413);
  assert.equal((await p('/v1/memories','POST',{'content-type':'application/json'},JSON.stringify({verified:true}))).status,403);
  const d=await fetch(origin+'/v1/conversations/chatgpt:synthetic-one',{method:'DELETE',headers});
  assert.equal(d.status,409);
});
test('all private backend exceptions are generic and do not expose data',async t=>{
  const origin=await app(t,{store:{status:async()=>{throw Error('private conversation body and DB password');}}});
  const r=await fetch(origin+'/v1/sync/status',{headers});
  assert.equal(r.status,503);
  assert.equal(await r.text(),'{"error":"SERVICE_UNAVAILABLE"}');
});
test('bounded list, normalized writes and HTTP contracts preserve authorized response only',async t=>{
  let received;
  const origin=await app(t,{store:{
    conversations:async args=>{received=args;return {items:[],nextCursor:null};},
    importBatch:async (v,key)=>{received={v,key};return {imported:1,messages:1,replayed:false};}
  }});
  assert.equal((await fetch(origin+'/v1/conversations?limit=51',{headers})).status,400);
  assert.equal((await fetch(origin+'/v1/conversations?limit=3&provider=claude',{headers})).status,200);
  assert.equal(received.limit,3);assert.equal(received.provider,'claude');
  const r=await fetch(origin+'/v1/imports',{method:'POST',headers:{...headers,'content-type':'application/json','idempotency-key':'synthetic-key-0001'},body:JSON.stringify(fixture)});
  assert.equal(r.status,201);assert.equal(received.key,'synthetic-key-0001');
});
