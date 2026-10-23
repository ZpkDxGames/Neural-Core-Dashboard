import * as oidc from 'openid-client';
import { createHash } from 'node:crypto';
import { ownerController, readOwnerConfig, AuthDependencyError } from './owner-core.ts';
import { createAuthRedis, createOwnerStore } from './owner-store.ts';
import type { AuthEvent, OwnerConfig, OidcProvider } from './owner-core.ts';

// Offline protocol tests use the library's documented customFetch hook.
// Production always uses normal HTTPS fetch and the fixed Google issuer.
export function createGoogleProvider(config:OwnerConfig, customFetch?:oidc.CustomFetch, fresh=false):OidcProvider {
  let pending:Promise<oidc.Configuration>|null=null;
  const client=()=>{
    if(!pending)pending=oidc.discovery(new URL('https://accounts.google.com'),config.clientId,
      {client_secret:config.clientSecret,id_token_signed_response_alg:'RS256'},undefined,
      {timeout:8,...(customFetch?{[oidc.customFetch]:customFetch}:{})}).then(cfg=>{
        if(cfg.serverMetadata().issuer!=='https://accounts.google.com')throw Error('Unexpected issuer');
        oidc.enableNonRepudiationChecks(cfg);
        return cfg;
      }).catch(()=>{pending=null;throw new AuthDependencyError('GOOGLE_PROVIDER_UNAVAILABLE');});
    return pending;
  };
  return {
    async authorize({state,nonce,verifier,redirectUri}){
      const cfg=await client();
      return oidc.buildAuthorizationUrl(cfg,{
        redirect_uri:redirectUri,response_type:'code',scope:'openid email',state,nonce,
        code_challenge:await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method:'S256',prompt:'select_account',...(fresh?{max_age:'0'}:{})
      }).toString();
    },
    async exchange({state,nonce,verifier,redirectUri,currentUrl}){
      const cfg=await client();
      try {
        const current=new URL(currentUrl);
        if(current.origin+current.pathname!==redirectUri)throw Error('Callback mismatch');
        const tokens=await oidc.authorizationCodeGrant(cfg,new URL(currentUrl),{
          pkceCodeVerifier:verifier,expectedState:state,expectedNonce:nonce,idTokenExpected:true,...(fresh?{maxAge:120}:{})
        },{redirect_uri:redirectUri});
        const claims=tokens.claims();
        if(!claims || typeof claims.sub!=='string')throw Error('Missing subject');
        return {sub:claims.sub,email_verified:claims.email_verified,...(fresh?{auth_time:claims.auth_time}:{})};
      }catch{throw new AuthDependencyError('GOOGLE_EXCHANGE_REJECTED');}
    }
  };
}

let cached:{fingerprint:string;provider:OidcProvider;store:ReturnType<typeof createOwnerStore>}|null=null;
export function loadOwnerServices() {
  const config=readOwnerConfig(process.env);
  if(!config)return null;
  const fingerprint=createHash('sha256').update(JSON.stringify(config)).digest('hex');
  if(cached?.fingerprint!==fingerprint)cached={fingerprint,provider:createGoogleProvider(config),store:createOwnerStore(createAuthRedis(config))};
  return {config,store:cached.store,provider:cached.provider};
}

export async function loadOwnerController(report?:(event:AuthEvent)=>void){
 const services=loadOwnerServices();
 if(!services)return null;
 const {privateRevocationRequired,revokePrivateOwnerSession}=await import('../brain/private/connection.ts');
 return ownerController({...services,report,...(privateRevocationRequired()?{revokeOwnerSession:revokePrivateOwnerSession}:{})});
}
