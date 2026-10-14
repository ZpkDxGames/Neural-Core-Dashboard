import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ownerController,readOwnerConfig,OwnerConfigError,ownerAllowed,SESSION_COOKIE,FLOW_COOKIE,
  csrfToken,parsedCookie,exactOrigin
} from '../lib/auth/owner-core.ts';

const origin='https://neural.example.invalid';
const config={origin,clientId:'synthetic.apps.googleusercontent.com',clientSecret:'synthetic-client-secret-123',
  ownerSub:'123456789012345',redisUrl:'https://redis.example.invalid/',redisToken:'synthetic-storage-token-abc123456789',
  csrfSecret:'synthetic-csrf-key-for-tests-only-012345678901234567890'};
function memoryStore(now=()=>1_000_000) {
  const data=new Map();
  const keyValue=(key)=>{const x=data.get(key);if(x && x.exp>now())return x.value;data.delete(key);return null;};
  return {
    async get(key){return keyValue(key);},
    async take(key){const v=keyValue(key);data.delete(key);return v;},
    async create(key,value,ttl){if(keyValue(key)!==null)return false;data.set(key,{value,exp:now()+ttl*1000});return true;},
    async put(key,value,ttl){data.set(key,{value,exp:now()+ttl*1000});},
    async remove(key){data.delete(key);},
    async increment(key,ttl){const n=(keyValue(key)??0)+1;data.set(key,{value:n,exp:now()+ttl*1000});return n;}
  };
}
function makeProvider(identity={sub:config.ownerSub,email_verified:true}) {
  const calls=[];
  return {calls,
    async authorize(input) {
      calls.push({type:'authorize',...input});
      return 'https://accounts.google.com/o/oauth2/v2/auth?state='+input.state+'&nonce='+input.nonce;
    },
    async exchange(input){
      calls.push({type:'exchange',...input});
      if(new URL(input.currentUrl).searchParams.get('state')!==input.state)throw Error('Mismatched provider state');
      return identity;
    }
  };
}
const request=(url,method='GET',headers={})=>new Request(url,{method,headers});
function extract(response,name){
  const cookies=response.headers.getSetCookie();
  return cookies.map(s=>s.split(';')[0]).find(s=>s.startsWith(name+'=')) ?? '';
}
async function loginStart(controller){
  const start=await controller.start(request(origin+'/api/auth/owner/start'));
  assert.equal(start.status,303);
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const binding=extract(start,FLOW_COOKIE);
  assert.ok(binding);assert.ok(state);
  return {state,binding,start};
}
async function callback(controller,flow,override={}){
  const state=override.state??flow.state;
  return controller.callback(request(origin+'/api/auth/owner/callback?code=synthetic-code&state='+encodeURIComponent(state),
    'GET',{cookie:override.cookie??flow.binding}));
}
test('disabled and partially configured auth are fail closed, require strict HTTPS',()=>{
  assert.equal(readOwnerConfig({}),null);
  assert.equal(readOwnerConfig({NCORE_OWNER_AUTH_ENABLED:'0'}),null);
  assert.throws(()=>readOwnerConfig({NCORE_OWNER_AUTH_ENABLED:'1'}));
  assert.throws(()=>readOwnerConfig({NCORE_OWNER_AUTH_ENABLED:'1',
    NCORE_OWNER_AUTH_ORIGIN:'http://localhost:3000'}),/HTTPS/);
  const configured={
    NCORE_OWNER_AUTH_ENABLED:'1',NCORE_OWNER_AUTH_ORIGIN:origin,
    NCORE_GOOGLE_CLIENT_ID:config.clientId,NCORE_GOOGLE_CLIENT_SECRET:config.clientSecret,
    NCORE_GOOGLE_OWNER_SUB:config.ownerSub,NCORE_AUTH_REDIS_URL:config.redisUrl,
    NCORE_AUTH_REDIS_TOKEN:config.redisToken,NCORE_AUTH_CSRF_SECRET:config.csrfSecret
  };
  assert.deepEqual(readOwnerConfig(configured),config);
  assert.throws(()=>readOwnerConfig({...configured,NCORE_GOOGLE_OWNER_SUB:'owner@example.test'}));
  assert.throws(()=>readOwnerConfig({...configured,NCORE_AUTH_REDIS_URL:'http://redis.example.invalid/'}));
});
test('single owner must match immutable sub and verified email claim',()=>{
  assert.equal(ownerAllowed({sub:config.ownerSub,email_verified:true},config.ownerSub),true);
  assert.equal(ownerAllowed({sub:config.ownerSub,email_verified:false},config.ownerSub),false);
  assert.equal(ownerAllowed({sub:'another-sub',email_verified:true,email:'owner@example.test'},config.ownerSub),false);
  assert.equal(ownerAllowed({sub:config.ownerSub,email_verified:'true'},config.ownerSub),false);
});
test('login binds state/nonce and PKCE verifier, issues only secure host cookies, and keeps private headers',async()=>{
  const p=makeProvider(),controller=ownerController({config,store:memoryStore(),provider:p,clock:()=>1_000_000});
  const flow=await loginStart(controller);
  assert.equal(p.calls[0].state,flow.state);
  assert.ok(p.calls[0].verifier.length>=43);
  assert.ok(p.calls[0].nonce.length>=43);
  assert.equal(p.calls[0].redirectUri,origin+'/api/auth/owner/callback');
  assert.match(flow.start.headers.getSetCookie().join(' '),/Secure; HttpOnly; SameSite=Lax/);
  assert.equal(flow.start.headers.get('cache-control').includes('no-store'),true);
  const callbackResponse=await callback(controller,flow);
  assert.equal(callbackResponse.status,303);
  assert.equal(callbackResponse.headers.get('location'),origin+'/');
  assert.ok(extract(callbackResponse,SESSION_COOKIE));
  assert.equal(p.calls[1].nonce,p.calls[0].nonce);
});
test('login transaction is one-time, cookie bound, state guarded and rejects arbitrary identities',async()=>{
  const p=makeProvider(),controller=ownerController({config,store:memoryStore(),provider:p,clock:()=>1_000_000});
  const flow=await loginStart(controller);
  const bad=await callback(controller,flow,{cookie:FLOW_COOKIE+'=wrong-cookie-value-not-the-binding'});
  assert.equal(bad.status,303); assert.ok(bad.headers.get('location').includes('auth=failed'));
  assert.equal(p.calls.filter(c=>c.type==='exchange').length,0);
  assert.equal((await callback(controller,flow)).headers.get('location'),origin+'/?auth=failed');
  const other=ownerController({config,store:memoryStore(),provider:makeProvider({sub:'999888777666',email_verified:true}),clock:()=>1_000_000});
  const otherFlow=await loginStart(other);
  const denied=await callback(other,otherFlow);
  assert.equal(denied.headers.get('location'),origin+'/?auth=denied');
  assert.equal(extract(denied,SESSION_COOKIE),'');
});
test('session lookup, CSRF, origin checks, rotation, logout and revocation work across instances',async()=>{
  const store=memoryStore(),provider=makeProvider();
  const ctrl=ownerController({config,store,provider,clock:()=>1_000_000});
  const another=ownerController({config,store,provider,clock:()=>1_000_000});
  const login=await callback(ctrl,await loginStart(ctrl));
  const cookie=extract(login,SESSION_COOKIE);
  const getSession=()=>another.session(request(origin+'/api/auth/owner/session','GET',{cookie}));
  const first=await getSession();assert.equal(first.status,200);
  const state=await first.json();assert.equal(state.authenticated,true);
  assert.ok(state.csrf);assert.ok(state.expiresAt);assert.equal('sub' in state,false);
  const unsafe=request(origin+'/api/auth/owner/logout','POST',{cookie,'x-ncore-csrf':state.csrf,origin:'https://evil.invalid'});
  assert.equal((await ctrl.logout(unsafe)).status,403);
  const noCsrf=request(origin+'/api/auth/owner/rotate','POST',{cookie,origin});
  assert.equal((await ctrl.rotate(noCsrf)).status,403);
  const allowedHeaders={cookie,origin,'x-ncore-csrf':state.csrf,'sec-fetch-site':'same-origin'};
  const changed=await ctrl.rotate(request(origin+'/api/auth/owner/rotate','POST',allowedHeaders));
  assert.equal(changed.status,200);
  const next=extract(changed,SESSION_COOKIE);
  assert.notEqual(next,cookie);assert.equal((await getSession()).status,401);
  const nextBody=await changed.json();
  assert.equal((await another.session(request(origin+'/api/auth/owner/session','GET',{cookie:next}))).status,200);
  assert.equal((await another.logout(request(origin+'/api/auth/owner/logout','POST',{
    cookie:next,origin,'x-ncore-csrf':nextBody.csrf
  }))).status,200);
  assert.equal((await ctrl.session(request(origin+'/api/auth/owner/session','GET',{cookie:next}))).status,401);
});
test('session expiration and stale tokens are rejected without refresh or silent re-issue',async()=>{
  let now=10_000_000;
  const ctrl=ownerController({config,store:memoryStore(()=>now),provider:makeProvider(),clock:()=>now});
  const login=await callback(ctrl,await loginStart(ctrl));
  const cookie=extract(login,SESSION_COOKIE);
  now += 8*3600*1000+1;
  const session=await ctrl.session(request(origin+'/api/auth/owner/session','GET',{cookie}));
  assert.equal(session.status,401);assert.ok(session.headers.get('set-cookie').includes('Max-Age=0'));
});
test('rate limiting is enforced across instances with one store',async()=>{
  const store=memoryStore(),provider=makeProvider();
  const a=ownerController({config,store,provider,clock:()=>1_000_000});
  const b=ownerController({config,store,provider,clock:()=>1_000_000});
  for(let i=0;i<80;i++)assert.equal((await (i%2?a:b).start(request(origin+'/api/auth/owner/start'))).status,303);
  assert.equal((await a.start(request(origin+'/api/auth/owner/start'))).status,429);
  assert.equal(provider.calls.length,80);
});
test('Origin and Fetch-Site are both mandatory for state mutation',()=>{
  assert.equal(exactOrigin(request(origin+'/','POST',{origin}),origin),true);
  assert.equal(exactOrigin(request(origin+'/','POST',{origin,'sec-fetch-site':'cross-site'}),origin),false);
  assert.equal(exactOrigin(request(origin+'/','POST',{}),origin),false);
  assert.equal(csrfToken(config.csrfSecret,'x'),csrfToken(config.csrfSecret,'x'));
  assert.notEqual(csrfToken(config.csrfSecret,'x'),csrfToken(config.csrfSecret,'y'));
  assert.equal(parsedCookie(request(origin+'/','GET',{cookie:'hello=abc'}),SESSION_COOKIE),null);
});

test('invalid Preview auth variables produce stable log-safe error codes without values',()=>{
  const env={
    NCORE_OWNER_AUTH_ENABLED:'1',
    NCORE_OWNER_AUTH_ORIGIN:origin,
    NCORE_GOOGLE_CLIENT_ID:config.clientId,
    NCORE_GOOGLE_CLIENT_SECRET:config.clientSecret,
    NCORE_GOOGLE_OWNER_SUB:config.ownerSub,
    NCORE_AUTH_REDIS_URL:config.redisUrl,
    NCORE_AUTH_REDIS_TOKEN:config.redisToken,
    NCORE_AUTH_CSRF_SECRET:config.csrfSecret,
  };
  for(const [name,value,expectedCode] of [
    ['NCORE_OWNER_AUTH_ORIGIN','https://neural.example.invalid/','OWNER_ORIGIN_HTTPS_REQUIRED'],
    ['NCORE_GOOGLE_CLIENT_ID','bad-client-id','GOOGLE_CLIENT_ID_INVALID'],
    ['NCORE_GOOGLE_CLIENT_SECRET','invalid','GOOGLE_CLIENT_SECRET_MISSING'],
    ['NCORE_GOOGLE_OWNER_SUB','someone@example.test','GOOGLE_OWNER_SUB_INVALID'],
    ['NCORE_AUTH_CSRF_SECRET','short-secret','AUTH_CSRF_SECRET_INVALID'],
    ['NCORE_AUTH_REDIS_TOKEN','bad','AUTH_REDIS_TOKEN_INVALID'],
    ['NCORE_AUTH_REDIS_URL','tcp://secret.example.invalid','AUTH_REDIS_URL_HTTPS_REQUIRED'],
  ]){
    assert.throws(()=>readOwnerConfig({...env,[name]:value}),
      error=>error instanceof OwnerConfigError && error.code===expectedCode && !error.message.includes(value),
      name+' must produce only safe diagnostic code');
  }
});
