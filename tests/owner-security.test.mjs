import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerController,readOwnerConfig,parsedCookie,AuthDependencyError} from '../lib/auth/owner-core.ts';
import {origin,config,environment,memoryStore,provider,request,begin,finish,login,cookie} from './helpers/owner-fixture.mjs';
const controller=(options={})=>ownerController({config,store:memoryStore(),provider,...options});

test('origin canonicalization allows only harmless HTTPS root slash and edge whitespace',()=>{
  for(const input of [origin,origin+'/', '  '+origin+'/\n'])assert.equal(readOwnerConfig({...environment,NCORE_OWNER_AUTH_ORIGIN:input}).origin,origin);
  for(const input of ['http://neural.example.invalid',origin+'/api/auth/owner/callback',origin+'/../',origin+'?x=1',origin+'#x','https://user:secret@neural.example.invalid','https://neural.example.invalid\\path'])assert.throws(()=>readOwnerConfig({...environment,NCORE_OWNER_AUTH_ORIGIN:input}));
});
test('Preview branch and hostname mismatches fail closed while local and Production configs are independent',()=>{
  const preview={...environment,VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'preview',VERCEL_BRANCH_URL:new URL(origin).hostname};
  assert.equal(readOwnerConfig(preview).origin,origin);
  assert.throws(()=>readOwnerConfig({...preview,VERCEL_GIT_COMMIT_REF:'development/other'}),/AUTH_PREVIEW_BRANCH_MISMATCH/);
  assert.throws(()=>readOwnerConfig({...preview,VERCEL_BRANCH_URL:'wrong.example.invalid'}),/AUTH_PREVIEW_ORIGIN_MISMATCH/);
  assert.equal(readOwnerConfig({...preview,NCORE_OWNER_AUTH_ENABLED:'0'}),null);
  assert.equal(readOwnerConfig({...environment,VERCEL_ENV:'production'}).origin,origin);
});
test('all routes reject mismatched request origin without touching dependencies',async()=>{
  const ctrl=controller({store:new Proxy({},{get(){throw Error('Must not access store');}})});
  for(const action of ['start','callback','session','rotate','logout'])assert.equal((await ctrl[action](new Request('https://wrong.invalid/api/auth/owner/'+action,{method:['rotate','logout'].includes(action)?'POST':'GET'}))).status,409);
});
test('storage errors fail closed and expose only a public category',async()=>{
  const events=[],store=new Proxy({},{get(){return async()=>{throw Error('secret-token=private-identity');};}});
  const ctrl=controller({store,report:event=>events.push(event)});
  for(const action of ['start','session','rotate','logout']){
    const r=await ctrl[action](request(action,['rotate','logout'].includes(action)?'POST':'GET',{cookie:'__Host-nc-owner='+'x'.repeat(43)}));
    assert.equal(r.status,503);assert.equal((await r.text()).includes('private-identity'),false);
  }
  assert.deepEqual([...new Set(events)],['AUTH_STORAGE_UNAVAILABLE']);
});
test('callback cancel, duplicates, expiration and exchange failures issue no session and cannot replay',async()=>{
  let now=Date.now();const store=memoryStore(()=>now),ctrl=controller({store,clock:()=>now});
  const cancelled=await begin(ctrl);
  assert.equal((await ctrl.callback(request('callback?state='+cancelled.state+'&error=access_denied','GET',{cookie:cancelled.binding}))).headers.get('location'),origin+'/?auth=cancelled');
  assert.equal((await finish(ctrl,cancelled)).headers.get('location'),origin+'/?auth=failed');
  const dup=await begin(ctrl);const response=await ctrl.callback(request('callback?state='+dup.state+'&state='+dup.state+'&code=a','GET',{cookie:dup.binding}));
  assert.equal(cookie(response,'__Host-nc-owner'),'');
  const expired=await begin(ctrl);now+=301000;
  assert.equal((await finish(ctrl,expired)).headers.get('location'),origin+'/?auth=failed');
  for(const failure of ['AUTH_STORAGE_UNAVAILABLE','GOOGLE_EXCHANGE_REJECTED']){
    const failing=controller({provider:{...provider,async exchange(){throw new AuthDependencyError(failure);}}});
    const flow=await begin(failing),r=await finish(failing,flow);
    assert.equal(r.headers.get('location'),origin+'/?auth='+(failure==='AUTH_STORAGE_UNAVAILABLE'?'unavailable':'failed'));
    assert.equal(cookie(r,'__Host-nc-owner'),'');
    assert.equal((await finish(failing,flow)).headers.get('location'),origin+'/?auth=failed');
  }
});
test('concurrent callbacks and rotations each have exactly one successful consumer',async()=>{
  const store=memoryStore(),ctrl=controller({store}),flow=await begin(ctrl);
  const callbacks=await Promise.all([finish(ctrl,flow),finish(ctrl,flow)]);
  assert.equal(callbacks.filter(r=>cookie(r,'__Host-nc-owner')).length,1);
  const active=await login(ctrl),headers={cookie:active.cookie,origin,'x-ncore-csrf':active.body.csrf};
  const rotations=await Promise.all([ctrl.rotate(request('rotate','POST',headers)),ctrl.rotate(request('rotate','POST',headers))]);
  assert.deepEqual(rotations.map(r=>r.status).sort(),[200,401]);
  assert.equal(rotations.find(r=>r.status===401).headers.get('set-cookie'),null);
  assert.equal((await ctrl.session(request('session','GET',{cookie:active.cookie}))).status,401);
});
test('logout validated before a concurrent rotation revokes its replacement family',async()=>{
  const store=memoryStore(),ctrl=controller({store}),active=await login(ctrl);
  const originalGet=store.get.bind(store);let entered,release;
  const enteredPromise=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});let delay=true;
  store.get=async key=>{const value=await originalGet(key);if(delay&&key.includes(':family:')){delay=false;entered();await gate;}return value;};
  const headers={cookie:active.cookie,origin,'x-ncore-csrf':active.body.csrf};
  const loggingOut=ctrl.logout(request('logout','POST',headers));await enteredPromise;
  const rotated=await ctrl.rotate(request('rotate','POST',headers));assert.equal(rotated.status,200);
  release();assert.equal((await loggingOut).status,200);
  assert.equal((await ctrl.session(request('session','GET',{cookie:cookie(rotated,'__Host-nc-owner')}))).status,401);
});
test('relogin revokes the prior session and origin scopes isolate shared Redis',async()=>{
  const store=memoryStore(),ctrl=controller({store}),active=await login(ctrl);
  const renewed=await finish(ctrl,await begin(ctrl),{cookie:(await begin(ctrl)).binding});
  assert.equal(cookie(renewed,'__Host-nc-owner'),'');
  const flow=await begin(ctrl);const relogin=await finish(ctrl,flow,{cookie:flow.binding+'; '+active.cookie});
  assert.ok(cookie(relogin,'__Host-nc-owner'));
  assert.equal((await ctrl.session(request('session','GET',{cookie:active.cookie}))).status,401);
  const otherOrigin='https://production.example.invalid',other=controller({store,config:{...config,origin:otherOrigin}});
  const cross=await other.session(new Request(otherOrigin+'/api/auth/owner/session',{headers:{cookie:cookie(relogin,'__Host-nc-owner')}}));
  assert.equal(cross.status,401);
});
test('corrupt session records and duplicate host cookies cannot authenticate',async()=>{
  assert.equal(parsedCookie(request('session','GET',{cookie:'__Host-nc-owner='+'a'.repeat(43)+'; __Host-nc-owner='+'b'.repeat(43)}),'__Host-nc-owner'),null);
  for(const mutation of [s=>({...s,issuedAt:undefined}),s=>({...s,issuedAt:NaN}),s=>({...s,issuedAt:Date.now()+100000}),s=>({...s,family:123}),s=>({...s,expiresAt:s.issuedAt+9*3600000})]){
    const store=memoryStore(),ctrl=controller({store}),active=await login(ctrl),get=store.get.bind(store);
    store.get=async k=>{const value=await get(k);return value&&k.includes(':session:')?mutation(value):value;};
    assert.equal((await ctrl.session(request('session','GET',{cookie:active.cookie}))).status,401);
  }
});
test('failed logout never acknowledges revocation; retry succeeds and rejects the old session',async()=>{
  const store=memoryStore(),ctrl=controller({store}),active=await login(ctrl),remove=store.remove;
  store.remove=async()=>{throw new AuthDependencyError('AUTH_STORAGE_UNAVAILABLE');};
  const headers={cookie:active.cookie,origin,'x-ncore-csrf':active.body.csrf};
  const failed=await ctrl.logout(request('logout','POST',headers));assert.equal(failed.status,503);assert.equal(failed.headers.get('set-cookie'),null);
  assert.equal((await ctrl.session(request('session','GET',{cookie:active.cookie}))).status,200);
  store.remove=remove;assert.equal((await ctrl.logout(request('logout','POST',headers))).status,200);
  assert.equal((await ctrl.session(request('session','GET',{cookie:active.cookie}))).status,401);
});
test('session rotation storage failure consumes the old token and fails closed',async()=>{
  const store=memoryStore(),ctrl=controller({store}),active=await login(ctrl);
  store.create=async()=>{throw new AuthDependencyError('AUTH_STORAGE_UNAVAILABLE');};
  const rotated=await ctrl.rotate(request('rotate','POST',{cookie:active.cookie,origin,'x-ncore-csrf':active.body.csrf}));
  assert.equal(rotated.status,503);assert.equal(cookie(rotated,'__Host-nc-owner'),'');
  assert.equal((await ctrl.session(request('session','GET',{cookie:active.cookie}))).status,401);
});
