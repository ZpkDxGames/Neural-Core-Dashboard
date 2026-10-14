import * as oidc from 'openid-client';
import { Redis } from '@upstash/redis';
import { ownerController, readOwnerConfig } from './owner-core';
import type { Store, OidcProvider } from './owner-core';

let oidcConfig: Promise<oidc.Configuration> | null = null;
function googleClient(clientId: string, secret: string): Promise<oidc.Configuration> {
  if (!oidcConfig) {
    oidcConfig = oidc.discovery(new URL('https://accounts.google.com'),clientId,secret).then(cfg=>{
      cfg.timeout = 8;
      if(cfg.serverMetadata().issuer!=='https://accounts.google.com')throw Error('Unexpected issuer');
      return cfg;
    }).catch(error=>{oidcConfig=null;throw error;});
  }
  return oidcConfig;
}
export async function loadOwnerController() {
  const config=readOwnerConfig(process.env);
  if(!config)return null;
  const redis=new Redis({url:config.redisUrl,token:config.redisToken,automaticDeserialization:true});
  const store:Store={
    async get<T>(k:string){return redis.get<T>(k);},
    async take<T>(k:string){return redis.getdel<T>(k);},
    async create(k:string,v:unknown,ttlSeconds:number){return (await redis.set(k,v,{ex:ttlSeconds,nx:true}))==='OK';},
    async put(k:string,v:unknown,ttlSeconds:number){await redis.set(k,v,{ex:ttlSeconds});},
    async remove(k:string){await redis.del(k);},
    async increment(k:string,ttlSeconds:number){
      const count=await redis.incr(k);
      if(count===1)await redis.expire(k,ttlSeconds);
      return count;
    }
  };
  const provider:OidcProvider={
    async authorize({state,nonce,verifier,redirectUri}){
      const cfg=await googleClient(config.clientId,config.clientSecret);
      return oidc.buildAuthorizationUrl(cfg,{
        redirect_uri:redirectUri,response_type:'code',scope:'openid email',
        state,nonce,
        code_challenge:await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method:'S256',prompt:'select_account'
      }).toString();
    },
    async exchange({state,nonce,verifier,redirectUri,currentUrl}){
      const cfg=await googleClient(config.clientId,config.clientSecret);
      const tokens=await oidc.authorizationCodeGrant(cfg,new URL(currentUrl),{
        pkceCodeVerifier:verifier,expectedState:state,expectedNonce:nonce,idTokenExpected:true
      },{redirect_uri:redirectUri});
      const claims=oidc.getValidatedIdTokenClaims(tokens);
      if(!claims || typeof claims.sub!=='string')throw Error('No verified ID token subject');
      return {sub:claims.sub,email_verified:claims.email_verified,email:claims.email};
    }
  };
  return ownerController({config,store,provider});
}
