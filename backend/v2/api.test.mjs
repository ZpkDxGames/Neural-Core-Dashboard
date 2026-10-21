import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {makeV2Handler} from './api.mjs';import {BrainError} from './note.mjs';
const token='nbv2_'+'z'.repeat(43),principal={principalId:'synthetic-agent'};
async function fixture(options,fn){
  const engine={async authenticate(t){if(t!==token)throw new BrainError('UNAUTHORIZED',401);return principal;},async list(){return {items:[],nextCursor:null};},async submit(){return {state:'proposed'};},...options.engine};
  const server=createServer(makeV2Handler({...options,engine}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{await fn((path,init={})=>fetch('http://127.0.0.1:'+server.address().port+path,{...init,headers:{authorization:'Bearer '+token,...init.headers}}));}
  finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
test('V2 is absent by default and rejects browser identity and wrong machine tokens',async()=>{
  await fixture({},async request=>assert.equal((await request('/v2/memories')).status,404));
  await fixture({enabled:true},async request=>{
    for(const headers of [{origin:'https://untrusted.invalid'},{cookie:'session=x'},{'sec-fetch-site':'same-origin'}])assert.equal((await request('/v2/memories',{headers})).status,403);
    assert.equal((await request('/v2/memories',{headers:{authorization:'Bearer invalid'}})).status,401);
    const response=await request('/v2/memories');assert.equal(response.headers.get('access-control-allow-origin'),null);assert.equal(response.headers.get('cache-control'),'no-store, private');assert.equal((await response.json()).schemaVersion,2);
  });
});
test('validated JSON, explicit revisions, response budgets and generic error redaction',()=>fixture({enabled:true,engine:{async get(){throw Error('SENSITIVE synthetic connection details');},async list(){return {text:'x'.repeat(300000)};}}},async request=>{
  assert.equal((await request('/v2/memories/proposals',{method:'POST',headers:{'content-type':'text/plain'},body:'{}'})).status,415);
  assert.equal((await request('/v2/memories/proposals',{method:'POST',headers:{'content-type':'application/json'},body:'{'})).status,400);
  assert.equal((await request('/v2/memories/synthetic',{method:'PATCH',headers:{'content-type':'application/json'},body:'{}'})).status,428);
  assert.equal((await request('/v2/memories')).status,413);
  const failed=await request('/v2/memories/synthetic');assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{error:'SERVICE_UNAVAILABLE'});
}));
test('bounded per-principal quota throttles writes without claiming publication',()=>fixture({enabled:true,quota:2},async request=>{
  const r=await request('/v2/memories/proposals',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal((await r.json()).data.state,'proposed');
  await request('/v2/memories');assert.equal((await request('/v2/memories')).status,429);
}));

test('proposal API forwards repeated bounded filters and cursor and rejects ambiguous query parameters',()=>fixture({enabled:true,engine:{async proposals(p,q){assert.deepEqual(p,principal);return q;}}},async request=>{
  const response=await request('/v2/memories/proposals?limit=3&cursor=signed&status=proposed&status=conflict&type=project&type=reference');
  assert.equal(response.status,200);assert.deepEqual((await response.json()).data,{limit:3,cursor:'signed',statuses:['proposed','conflict'],noteTypes:['project','reference']});
  for(const suffix of ['limit=2&limit=3','cursor=x&cursor=y','status=x&status=x&status=x&status=x&status=x','type=x&type=x&type=x&type=x&type=x','q=unsupported','owner=forged','limit=-1'])
    assert.equal((await request('/v2/memories/proposals?'+suffix)).status,400);
}));
