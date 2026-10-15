import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {createGoogleProvider} from '../lib/auth/owner-runtime.ts';
import {config,origin} from './helpers/owner-fixture.mjs';
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
const foreign=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...pair.publicKey.export({format:'jwk'}),kid:'synthetic-key',alg:'RS256',use:'sig'};
const baseInput={state:'synthetic-state',nonce:'synthetic-nonce',verifier:'synthetic-verifier-'+'x'.repeat(43),redirectUri:origin+'/api/auth/owner/callback',currentUrl:origin+'/api/auth/owner/callback?state=synthetic-state&code=synthetic-code'};
function setup(override={},options={}){
  const calls=[];
  const customFetch=async(url,init)=>{
    calls.push({url:String(url),init});
    if(String(url).includes('/.well-known/')){
      if(options.discoveryFailure)throw Error('private-provider-detail');
      return Response.json({issuer:options.issuer??'https://accounts.google.com',authorization_endpoint:'https://accounts.google.com/o/oauth2/v2/auth',token_endpoint:'https://oauth2.googleapis.com/token',jwks_uri:'https://www.googleapis.com/oauth2/v3/certs',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_post','client_secret_basic']});
    }
    if(String(url).includes('/certs'))return Response.json({keys:[jwk]});
    if(options.tokenError)return Response.json({error:'invalid_grant',error_description:'private-token-detail'},{status:400});
    const now=Math.floor(Date.now()/1000);
    const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'synthetic-key',typ:'JWT'})).toString('base64url');
    const body=Buffer.from(JSON.stringify({iss:'https://accounts.google.com',aud:config.clientId,sub:config.ownerSub,iat:now,exp:now+300,nonce:baseInput.nonce,email_verified:true,...override})).toString('base64url');
    const signature=sign('RSA-SHA256',Buffer.from(header+'.'+body),options.wrongKey?foreign.privateKey:pair.privateKey).toString('base64url');
    return Response.json({access_token:'synthetic-access-token',token_type:'Bearer',expires_in:300,id_token:header+'.'+body+'.'+signature});
  };
  return {provider:createGoogleProvider(config,customFetch),calls};
}
test('real openid-client performs code flow, PKCE S256 and signed JWKS verification with synthetic provider',async()=>{
  const {provider,calls}=setup();
  const authorization=new URL(await provider.authorize(baseInput));
  assert.equal(authorization.origin,'https://accounts.google.com');
  assert.equal(authorization.searchParams.get('response_type'),'code');
  assert.equal(authorization.searchParams.get('scope'),'openid email');
  assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');
  assert.equal(authorization.searchParams.get('code_challenge'),createHash('sha256').update(baseInput.verifier).digest('base64url'));
  assert.equal(authorization.searchParams.get('nonce'),baseInput.nonce);
  assert.deepEqual(await provider.exchange(baseInput),{sub:config.ownerSub,email_verified:true});
  assert.ok(calls.some(c=>c.url.includes('/certs')));
  const body=new URLSearchParams(calls.find(c=>c.url.includes('/token')).init.body);
  assert.equal(body.get('code_verifier'),baseInput.verifier);
  assert.equal(body.get('redirect_uri'),baseInput.redirectUri);
  assert.equal(body.get('grant_type'),'authorization_code');
});
for(const [name,claims,options,input] of [
  ['invalid signature',{}, {wrongKey:true}],
  ['wrong issuer',{iss:'https://attacker.invalid'}],
  ['wrong audience',{aud:'wrong.apps.googleusercontent.com'}],
  ['wrong nonce',{nonce:'replayed-nonce'}],
  ['expired token',{exp:Math.floor(Date.now()/1000)-3600}],
  ['wrong authorized party',{aud:[config.clientId,'another-client'],azp:'another-client'}],
  ['missing ID subject',{sub:undefined}],
  ['token exchange rejection',{}, {tokenError:true}],
  ['state mismatch',{}, {},{...baseInput,currentUrl:baseInput.currentUrl.replace('synthetic-state','wrong-state')}],
  ['callback hostname mismatch',{}, {},{...baseInput,currentUrl:baseInput.currentUrl.replace(origin,'https://attacker.invalid')}]
])test('real OIDC adapter rejects '+name,async()=>{
  const {provider}=setup(claims,options);
  await assert.rejects(()=>provider.exchange(input??baseInput),error=>error.code==='GOOGLE_EXCHANGE_REJECTED'&&!error.message.includes('private-'));
});
test('discovery failure is sanitized and next attempt retries discovery',async()=>{
  const {provider,calls}=setup({}, {discoveryFailure:true});
  for(let i=0;i<2;i++)await assert.rejects(()=>provider.authorize(baseInput),e=>e.code==='GOOGLE_PROVIDER_UNAVAILABLE');
  assert.equal(calls.length,2);
});
test('discovered issuer is pinned',async()=>{
  const {provider}=setup({}, {issuer:'https://attacker.invalid'});
  await assert.rejects(()=>provider.authorize(baseInput),e=>e.code==='GOOGLE_PROVIDER_UNAVAILABLE');
});
