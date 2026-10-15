// Runs only against an isolated loopback Redis supplied by CI, never Upstash or
// deployment credentials. A local REST bridge exercises the actual Upstash SDK.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Redis} from '@upstash/redis';
import {createOwnerStore} from '../lib/auth/owner-store.ts';
import {ownerController} from '../lib/auth/owner-core.ts';
import {config,provider,login,request,origin,cookie} from './helpers/owner-fixture.mjs';
function decode(buffer,offset=0){
  const end=buffer.indexOf('\r\n',offset);if(end<0)return null;
  const type=String.fromCharCode(buffer[offset]),text=buffer.subarray(offset+1,end).toString(),next=end+2;
  if(type==='+')return [text,next];if(type==='-')throw Error('Synthetic Redis returned an error');
  if(type===':')return [Number(text),next];
  if(type==='$'){const length=Number(text);if(length===-1)return [null,next];if(buffer.length<next+length+2)return null;return [buffer.subarray(next,next+length).toString(),next+length+2];}
  if(type==='*'){const size=Number(text);let cursor=next;const result=[];for(let i=0;i<size;i++){const parsed=decode(buffer,cursor);if(!parsed)return null;result.push(parsed[0]);cursor=parsed[1];}return [result,cursor];}
  throw Error('Unexpected synthetic Redis protocol');
}
function command(port,args){return new Promise((resolve,reject)=>{
  const socket=net.connect({host:'127.0.0.1',port}),parts=args.map(x=>Buffer.from(String(x)));let data=Buffer.alloc(0);
  socket.setTimeout(5000,()=>socket.destroy(Error('Synthetic Redis timeout')));
  socket.on('error',reject);socket.on('connect',()=>socket.write(Buffer.concat([Buffer.from('*'+parts.length+'\r\n'),...parts.flatMap(b=>[Buffer.from('$'+b.length+'\r\n'),b,Buffer.from('\r\n')])])));
  socket.on('data',chunk=>{data=Buffer.concat([data,chunk]);try{const parsed=decode(data);if(parsed){socket.end();resolve(parsed[0]);}}catch(e){socket.destroy();reject(e);}});
});}
const port=Number(process.env.NCORE_TEST_REDIS_PORT);
test('isolated real Redis executes auth Lua, expiration, races and shared revocation through REST SDK',{skip:!port},async()=>{
  assert.ok(Number.isInteger(port)&&port>1024&&port<65536);
  const prefix='synthetic-auth-test:'+randomUUID()+':',keys=[];
  const bridge=createServer(async(req,res)=>{
    try{let text='';for await(const chunk of req)text+=chunk;
      assert.equal(req.headers.authorization,'Bearer synthetic-ci-token');
      const args=JSON.parse(text);const result=await command(port,args);
      const encode=v=>typeof v==='string'&&v!=='OK'?Buffer.from(v).toString('base64'):Array.isArray(v)?v.map(encode):v;
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({result:encode(result)}));
    }catch{res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'SYNTHETIC_BRIDGE_FAILURE'}));}
  });
  await new Promise(r=>bridge.listen(0,'127.0.0.1',r));
  const client=()=>createOwnerStore(new Redis({url:'http://127.0.0.1:'+bridge.address().port,token:'synthetic-ci-token',retry:{retries:0},enableAutoPipelining:false,enableTelemetry:false}));
  const isolated=store=>({
    ...store,
    get:k=>store.get(prefix+k),take:k=>store.take(prefix+k),
    create:(k,v,t)=>{keys.push(prefix+k);return store.create(prefix+k,v,t);},
    put:(k,v,t)=>{keys.push(prefix+k);return store.put(prefix+k,v,t);},
    remove:k=>store.remove(prefix+k),
    increment:(k,t)=>{keys.push(prefix+k);return store.increment(prefix+k,t);}
  });
  try{
    const a=isolated(client()),b=isolated(client());
    await a.put('record',{value:'synthetic'},2);
    const ttlBefore=await command(port,['PTTL',prefix+'record']);
    assert.deepEqual(await b.get('record'),{value:'synthetic'});
    assert.ok(await command(port,['PTTL',prefix+'record'])<=ttlBefore);
    const taken=await Promise.all([a.take('record'),b.take('record')]);assert.equal(taken.filter(Boolean).length,1);
    await command(port,['SET',prefix+'quota',0]);keys.push(prefix+'quota');
    const counts=await Promise.all(Array.from({length:30},(_,i)=>(i%2?a:b).increment('quota',2)));
    assert.deepEqual(counts.sort((x,y)=>x-y),Array.from({length:30},(_,i)=>i+1));assert.ok(await command(port,['TTL',prefix+'quota'])>0);
    const ca=ownerController({config,store:a,provider}),cb=ownerController({config,store:b,provider}),active=await login(ca);
    const rotated=await cb.rotate(request('rotate','POST',{cookie:active.cookie,origin,'x-ncore-csrf':active.body.csrf}));
    assert.equal(rotated.status,200);assert.equal((await ca.session(request('session','GET',{cookie:active.cookie}))).status,401);
    const next=cookie(rotated,'__Host-nc-owner'),body=await rotated.json();
    assert.equal((await ca.logout(request('logout','POST',{cookie:next,origin,'x-ncore-csrf':body.csrf}))).status,200);
    assert.equal((await cb.session(request('session','GET',{cookie:next}))).status,401);
    await a.put('short',{value:'synthetic'},1);await new Promise(r=>setTimeout(r,1100));assert.equal(await b.get('short'),null);
  }finally{
    if(keys.length)await command(port,['DEL',...new Set(keys)]);
    bridge.closeAllConnections();await new Promise(r=>bridge.close(r));
  }
});
