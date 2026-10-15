import test from 'node:test';
import assert from 'node:assert/strict';
import {Redis} from '@upstash/redis';
import {createOwnerStore,createAuthRedis,READ_PRIMARY,INCREMENT} from '../lib/auth/owner-store.ts';
import {config} from './helpers/owner-fixture.mjs';

test('actual Upstash SDK REST wire format round-trips JSON, NX/TTL, GETDEL, primary reads and atomic quota',async()=>{
  const original=globalThis.fetch,commands=[],data=new Map();let now=1000;
  const value=k=>{const record=data.get(k);if(record&&record.exp>now)return record.v;data.delete(k);return null;};
  globalThis.fetch=async(url,init)=>{
    assert.equal(String(url),'https://redis.example.invalid');
    assert.equal(new Headers(init.headers).get('authorization'),'Bearer '+config.redisToken);
    const command=JSON.parse(init.body);commands.push(command);let result=null;
    const [op,...args]=command;
    if(op==='set'){
      const [k,v,...flags]=args,ex=flags.findIndex(f=>String(f).toLowerCase()==='ex'),nx=flags.some(f=>String(f).toLowerCase()==='nx');
      assert.notEqual(ex,-1);assert.ok(Number(flags[ex+1])>0);
      if(!nx||value(k)===null){data.set(k,{v,exp:now+Number(flags[ex+1])*1000});result='OK';}
    }else if(op==='getdel'){result=value(args[0]);data.delete(args[0]);}
    else if(op==='del'){result=data.delete(args[0])?1:0;}
    else if(op==='eval'){
      const [script,numKeys,k,...rest]=args;assert.equal(numKeys,1);
      if(script===READ_PRIMARY)result=value(k);
      else {assert.equal(script,INCREMENT);const old=data.get(k);result=Number(value(k)??0)+1;data.set(k,{v:result,exp:old?.exp??now+Number(rest[0])*1000});}
    }else assert.fail('Unexpected Redis command '+op);
    return Response.json({result},{headers:{'upstash-sync-token':'synthetic-sync'}});
  };
  try{
    const store=createOwnerStore(createAuthRedis(config)),record={sub:'synthetic',expiresAt:10000};
    assert.equal(await store.create('session',record,5),true);
    assert.equal(await store.create('session',record,5),false);
    assert.deepEqual(await store.get('session'),record);
    assert.deepEqual(await store.take('session'),record);
    assert.equal(await store.take('session'),null);
    assert.equal(await store.increment('quota',600),1);now+=1000;
    assert.equal(await store.increment('quota',600),2);now+=600000;
    assert.equal(await store.increment('quota',600),1);
    await store.put('expired',record,1);now+=1001;assert.equal(await store.get('expired'),null);
    await store.remove('quota');
    assert.ok(commands.some(c=>c[0]==='getdel'));
    assert.ok(commands.some(c=>c[0]==='eval'&&c[1]===READ_PRIMARY));
  }finally{globalThis.fetch=original;}
});
test('Upstash client does not retry ambiguous writes and sanitizes provider failures',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('private-Upstash-token');};
  try{
    const store=createOwnerStore(createAuthRedis(config));
    await assert.rejects(()=>store.take('flow'),e=>e.code==='AUTH_STORAGE_UNAVAILABLE'&&!e.message.includes('private-'));
    assert.equal(calls,1);
    await assert.rejects(()=>store.create('session',{},5),e=>e.code==='AUTH_STORAGE_UNAVAILABLE');assert.equal(calls,2);
  }finally{globalThis.fetch=original;}
});
