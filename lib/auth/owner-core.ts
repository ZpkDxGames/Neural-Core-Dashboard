import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type OwnerConfig = {
  origin: string;
  clientId: string;
  clientSecret: string;
  ownerSub: string;
  redisUrl: string;
  redisToken: string;
  csrfSecret: string;
};
export type Flow = { binding: string; nonce: string; verifier: string; state: string; expiresAt: number };
export type Identity = { sub?: unknown; email_verified?: unknown; email?: unknown; auth_time?: unknown };
export type Session = { sub: string; expiresAt: number; issuedAt: number; family: string };
export type OwnerSessionRevocation = { sessionRef: string; identityHash: string; expiresAt: number };
type Family = { sub: string; expiresAt: number };
export type AuthEvent = 'AUTH_STORAGE_UNAVAILABLE' | 'GOOGLE_PROVIDER_UNAVAILABLE' |
  'GOOGLE_EXCHANGE_REJECTED' | 'CALLBACK_REJECTED' | 'ACCOUNT_REJECTED' | 'LOGIN_RATE_LIMITED' | 'AUTH_REVOCATION_UNAVAILABLE';
export class AuthDependencyError extends Error {
  readonly code: AuthEvent;
  constructor(code: AuthEvent) { super(code); this.code=code; this.name='AuthDependencyError'; }
}
export type Store = {
  get<T>(key: string): Promise<T | null>;
  take<T>(key: string): Promise<T | null>;
  create(key: string, value: unknown, ttlSeconds: number): Promise<boolean>;
  put(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  remove(key: string): Promise<void>;
  increment(key: string, ttlSeconds: number): Promise<number>;
};
export type OidcProvider = {
  authorize(input: { state: string; nonce: string; verifier: string; redirectUri: string }): Promise<string>;
  exchange(input: { state: string; nonce: string; verifier: string; redirectUri: string; currentUrl: string }): Promise<Identity>;
};

const LOGIN_TTL = 300;
const SESSION_TTL = 8 * 3600;
const LIMIT_WINDOW = 600;
const LIMIT = 80;
const PREFIX = 'nc:auth:v2:';
const random = () => randomBytes(32).toString('base64url');
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const secretPattern = /^[A-Za-z0-9_-]{40,}$/;

/** Stable diagnostic identifier only; does not embed configuration values or secrets. */
export class OwnerConfigError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = 'OwnerConfigError';
  }
}

export function readOwnerConfig(env: Record<string,string|undefined>): OwnerConfig | null {
  if (env.NCORE_OWNER_AUTH_ENABLED !== '1') return null;
  const configuredOrigin = (env.NCORE_OWNER_AUTH_ORIGIN ?? '').trim();
  let url: URL;
  try { url = new URL(configuredOrigin); } catch { throw new OwnerConfigError('OWNER_ORIGIN_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new OwnerConfigError('OWNER_ORIGIN_HTTPS_REQUIRED');
  if (!/^https:\/\/[^\s/?#\\]+\/?$/i.test(configuredOrigin) || url.pathname !== '/' || url.search || url.hash)
    throw new OwnerConfigError('OWNER_ORIGIN_PATH_NOT_ALLOWED');
  const origin = url.origin;
  // Branch-scoped secrets must never turn on login on an unrelated Preview branch.
  if (env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF && env.VERCEL_GIT_COMMIT_REF !== 'preview')
    throw new OwnerConfigError('AUTH_PREVIEW_BRANCH_MISMATCH');
  if (env.VERCEL_ENV === 'preview' && env.VERCEL_BRANCH_URL && new URL('https://'+env.VERCEL_BRANCH_URL).origin !== origin)
    throw new OwnerConfigError('AUTH_PREVIEW_ORIGIN_MISMATCH');
  const clientId = env.NCORE_GOOGLE_CLIENT_ID ?? '';
  const clientSecret = env.NCORE_GOOGLE_CLIENT_SECRET ?? '';
  const ownerSub = env.NCORE_GOOGLE_OWNER_SUB ?? '';
  const redisUrl = env.NCORE_AUTH_REDIS_URL ?? '';
  const redisToken = env.NCORE_AUTH_REDIS_TOKEN ?? '';
  const csrfSecret = env.NCORE_AUTH_CSRF_SECRET ?? '';
  if (!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId))
    throw new OwnerConfigError('GOOGLE_CLIENT_ID_INVALID');
  if (clientSecret.length < 16)
    throw new OwnerConfigError('GOOGLE_CLIENT_SECRET_MISSING');
  if (!/^\d{6,255}$/.test(ownerSub))
    throw new OwnerConfigError('GOOGLE_OWNER_SUB_INVALID');
  if (!secretPattern.test(csrfSecret))
    throw new OwnerConfigError('AUTH_CSRF_SECRET_INVALID');
  if (redisToken.length < 24)
    throw new OwnerConfigError('AUTH_REDIS_TOKEN_INVALID');
  let redis: URL;
  try { redis = new URL(redisUrl); } catch { throw new OwnerConfigError('AUTH_REDIS_URL_INVALID'); }
  if (redis.protocol !== 'https:' || redis.username || redis.password || !redis.hostname || redis.pathname !== '/' || redis.search || redis.hash)
    throw new OwnerConfigError('AUTH_REDIS_URL_HTTPS_REQUIRED');
  return { origin, clientId, clientSecret, ownerSub, redisUrl, redisToken, csrfSecret };
}
export function ownerAllowed(identity: Identity, ownerSub: string): boolean {
  return typeof identity.sub === 'string' && identity.sub === ownerSub &&
    identity.email_verified === true; // signed OIDC ID token claims, never an unsigned profile.
}
export function safeEqual(a: string | undefined | null, b: string): boolean {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  const left=Buffer.from(a,'utf8'), right=Buffer.from(b,'utf8');
  return left.length===right.length && timingSafeEqual(left,right);
}
export function csrfToken(secret: string, sessionToken: string): string {
  return createHmac('sha256',secret).update('csrf:' + sessionToken).digest('base64url');
}
export function cookieHeader(name: string, token: string, maxAge: number): string {
  return `${name}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
export const SESSION_COOKIE = '__Host-nc-owner';
export const FLOW_COOKIE = '__Host-nc-google-flow';
export const CLEAR_SESSION = cookieHeader(SESSION_COOKIE, '', 0);
export const CLEAR_FLOW = cookieHeader(FLOW_COOKIE, '', 0);
export function noStore(): Headers {
  return new Headers({
    'Cache-Control':'no-store, private, max-age=0',
    'Pragma':'no-cache',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
    'X-Frame-Options':'DENY'
  });
}
function result(status: number, value: Record<string,unknown>, cookies: string[]=[]): Response {
  const headers=noStore(); headers.set('Content-Type','application/json; charset=utf-8');
  for (const cookie of cookies) headers.append('Set-Cookie',cookie);
  return new Response(JSON.stringify(value),{status,headers});
}
function redirect(location: string, cookie: string | null = null): Response {
  const headers=noStore(); headers.set('Location',location);
  if(cookie) headers.append('Set-Cookie',cookie);
  return new Response(null,{status:303,headers});
}
export function exactOrigin(req: Request, origin: string): boolean {
  const header = req.headers.get('origin');
  const fetchSite = req.headers.get('sec-fetch-site');
  return header === origin && (!fetchSite || fetchSite === 'same-origin');
}
export function parsedCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get('cookie') ?? '';
  const matches = cookie.split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
  if(matches.length !== 1)return null;
  const found = matches[0];
  const value = found?.slice(name.length+1);
  return value && /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : null;
}
function validFlow(flow: Flow | null, now: number): flow is Flow {
  return Boolean(flow && typeof flow.binding==='string' && typeof flow.nonce==='string' &&
    typeof flow.verifier==='string' && typeof flow.state==='string' &&
    Number.isSafeInteger(flow.expiresAt) && flow.expiresAt>now);
}

export const ownerStorePrefix=(config:OwnerConfig):string=>PREFIX+digest(config.origin+'|'+config.clientId+'|'+config.ownerSub)+':';
export const ownerStoreKey=(config:OwnerConfig,category:string,token:string):string=>ownerStorePrefix(config)+category+':'+digest(token);
export async function readAuthorizedOwnerSession(req:Request,config:OwnerConfig,store:Store,clock=Date.now){
    const token=parsedCookie(req,SESSION_COOKIE);
    if (!token) return null;
    const saved=await store.get<Session>(ownerStoreKey(config,'session',token));
    if (!saved || saved.sub!==config.ownerSub ||
      !Number.isSafeInteger(saved.expiresAt) || saved.expiresAt<=clock() ||
      !Number.isSafeInteger(saved.issuedAt) || saved.issuedAt>clock() ||
      saved.issuedAt<0 || saved.expiresAt-saved.issuedAt>SESSION_TTL*1000 ||
      typeof saved.family!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(saved.family)) return null;
    const family=await store.get<Family>(ownerStoreKey(config,'family',saved.family));
    if(!family || family.sub!==config.ownerSub || family.expiresAt!==saved.expiresAt)return null;
    return {token,saved};

}

export function ownerController({config, store, provider, clock = Date.now, report = ()=>{}, revokeOwnerSession}: {
  config:OwnerConfig; store:Store; provider:OidcProvider; clock?:()=>number; report?:(event:AuthEvent)=>void;
  revokeOwnerSession?:(session:OwnerSessionRevocation)=>Promise<void>
}) {
  const prefix = PREFIX + digest(config.origin+'|'+config.clientId+'|'+config.ownerSub) + ':';
  const key = (category:string,token:string) => prefix+category+':'+digest(token);
  const callback = config.origin + '/api/auth/owner/callback';
  const onOrigin = (req:Request) => new URL(req.url).origin===config.origin;
  const unavailable = (error:unknown, cookies:string[]=[]) => {
    const event=error instanceof AuthDependencyError ? error.code : 'AUTH_STORAGE_UNAVAILABLE';
    report(event);
    return result(503,{error:'AUTH_UNAVAILABLE',reason:event==='AUTH_REVOCATION_UNAVAILABLE'?'revocation':event==='AUTH_STORAGE_UNAVAILABLE'?'storage':'provider'},cookies);
  };
  const authorizedSession = (req:Request) => readAuthorizedOwnerSession(req,config,store,clock);
  const retireSession = async (saved:Session) => {
    // Success means the private SQL fence committed before primary-family deletion.
    // Leave Redis available for a retry if SQL or its acknowledgment is unavailable.
    if(revokeOwnerSession)try {
      await revokeOwnerSession({sessionRef:digest(saved.family),identityHash:digest(saved.sub),expiresAt:saved.expiresAt});
    }catch {throw new AuthDependencyError('AUTH_REVOCATION_UNAVAILABLE');}
    await store.remove(key('family',saved.family));
  };
  const requireCsrf = (req:Request, token:string): boolean => exactOrigin(req,config.origin) &&
      safeEqual(req.headers.get('x-ncore-csrf'),csrfToken(config.csrfSecret,token));
  return {
    async start(req:Request): Promise<Response> {
      if(req.method!=='GET')return result(405,{error:'METHOD_NOT_ALLOWED'});
      if(!onOrigin(req))return result(409,{error:'AUTH_ORIGIN_MISMATCH'});
      if(req.headers.get('sec-fetch-site')==='cross-site')return result(403,{error:'CSRF_DENIED'});
      try{
        // A shared, bounded server-side quota; no spoofable X-Forwarded-For trust.
        const attempts=await store.increment(prefix+'login-rate',LIMIT_WINDOW);
        if(attempts>LIMIT){report('LOGIN_RATE_LIMITED');const response=result(429,{error:'RATE_LIMITED'});response.headers.set('Retry-After',String(LIMIT_WINDOW));return response;}
        const state=random(),nonce=random(),verifier=random(),binding=random();
        const flow:Flow={state,nonce,verifier,binding:digest(binding),expiresAt:clock()+LOGIN_TTL*1000};
        if(!await store.create(key('flow',state),flow,LOGIN_TTL))throw new AuthDependencyError('AUTH_STORAGE_UNAVAILABLE');
        const url=await provider.authorize({state,nonce,verifier,redirectUri:callback});
        const target=new URL(url);
        if(target.protocol!=='https:' || target.hostname!=='accounts.google.com' || target.username || target.password) throw new AuthDependencyError('GOOGLE_PROVIDER_UNAVAILABLE');
        const response=redirect(target.toString(),cookieHeader(FLOW_COOKIE,binding,LOGIN_TTL));
        // OAuth state must never be leaked through Referer.
        return response;
      }catch(error){return unavailable(error,[CLEAR_FLOW]);}
    },
    async callback(req:Request): Promise<Response> {
      if(req.method!=='GET')return result(405,{error:'METHOD_NOT_ALLOWED'});
      if(!onOrigin(req))return result(409,{error:'AUTH_ORIGIN_MISMATCH'});
      const url=new URL(req.url);
      const state=url.searchParams.get('state'), binding=parsedCookie(req,FLOW_COOKIE);
      if(url.searchParams.getAll('state').length!==1 || url.searchParams.getAll('code').length>1 ||
        url.searchParams.getAll('error').length>1 || !state || !/^[A-Za-z0-9_-]{40,128}$/.test(state) || !binding)
        return redirect(config.origin+'/?auth=failed',CLEAR_FLOW);
      let flow:Flow|null;
      try{flow=await store.take<Flow>(key('flow',state));}
      catch(error){unavailable(error);return redirect(config.origin+'/?auth=unavailable',CLEAR_FLOW);}
      if(!validFlow(flow,clock()) || !safeEqual(digest(binding),flow.binding) || !safeEqual(state,flow.state))
        return redirect(config.origin+'/?auth=failed',CLEAR_FLOW);
      try {
        if(url.searchParams.has('error'))return redirect(config.origin+'/?auth=cancelled',CLEAR_FLOW);
        if(!url.searchParams.get('code'))
          return redirect(config.origin+'/?auth=failed',CLEAR_FLOW);
        const identity=await provider.exchange({state,nonce:flow.nonce,verifier:flow.verifier,redirectUri:callback,currentUrl:url.toString()});
        if(!ownerAllowed(identity,config.ownerSub)){report('ACCOUNT_REJECTED');return redirect(config.origin+'/?auth=denied',CLEAR_FLOW);}
        const old=await authorizedSession(req);
        if(old)await retireSession(old.saved);
        const token=random(), family=random(), now=clock(), expiresAt=now+SESSION_TTL*1000;
        // Family is created once at login. Rotation never recreates it, so a concurrent
        // logout also revokes a replacement token which has not yet been delivered.
        if(!await store.create(key('family',family),{sub:config.ownerSub,expiresAt},SESSION_TTL))
          throw new AuthDependencyError('AUTH_STORAGE_UNAVAILABLE');
        if(!await store.create(key('session',token),{sub:config.ownerSub,issuedAt:now,expiresAt,family},SESSION_TTL))
          throw new AuthDependencyError('AUTH_STORAGE_UNAVAILABLE');
        const headers=noStore();headers.set('Location',config.origin+'/?auth=signed-in');
        headers.append('Set-Cookie',CLEAR_FLOW);
        headers.append('Set-Cookie',cookieHeader(SESSION_COOKIE,token,SESSION_TTL));
        return new Response(null,{status:303,headers});
      }catch(error){
        const event=error instanceof AuthDependencyError?error.code:'GOOGLE_EXCHANGE_REJECTED';
        report(event);
        return redirect(config.origin+'/?auth='+(event==='AUTH_STORAGE_UNAVAILABLE'||event==='GOOGLE_PROVIDER_UNAVAILABLE'||event==='AUTH_REVOCATION_UNAVAILABLE'?'unavailable':'failed'),CLEAR_FLOW);
      }
    },
    async session(req:Request):Promise<Response> {
      if(req.method!=='GET')return result(405,{error:'METHOD_NOT_ALLOWED'});
      if(!onOrigin(req))return result(409,{error:'AUTH_ORIGIN_MISMATCH'});
      try{
        const record=await authorizedSession(req);
        // Read requests never set cookies: a stale parallel response cannot erase a
        // freshly rotated session cookie. Expired records are rejected server-side.
        if(!record)return result(401,{authenticated:false});
        return result(200,{authenticated:true,provider:'google',expiresAt:new Date(record.saved.expiresAt).toISOString(),
          csrf:csrfToken(config.csrfSecret,record.token)});
      }catch(error){return unavailable(error);}
    },
    async logout(req:Request):Promise<Response> {
      if(req.method!=='POST')return result(405,{error:'METHOD_NOT_ALLOWED'});
      if(!onOrigin(req))return result(409,{error:'AUTH_ORIGIN_MISMATCH'});
      try {
        const record=await authorizedSession(req);
        if(!record)return result(401,{error:'UNAUTHORIZED'});
        if(!requireCsrf(req,record.token))return result(403,{error:'CSRF_DENIED'});
        await retireSession(record.saved);
        return result(200,{loggedOut:true},[CLEAR_SESSION]);
      }catch(error){return unavailable(error);}
    },
    async rotate(req:Request):Promise<Response> {
      if(req.method!=='POST')return result(405,{error:'METHOD_NOT_ALLOWED'});
      if(!onOrigin(req))return result(409,{error:'AUTH_ORIGIN_MISMATCH'});
      try {
        const record=await authorizedSession(req);
        if(!record)return result(401,{error:'UNAUTHORIZED'});
        if(!requireCsrf(req,record.token))return result(403,{error:'CSRF_DENIED'});
        // Expire old token before issuing new; fail closed on store outage.
        const taken=await store.take<Session>(key('session',record.token));
        if(!taken || taken.sub!==config.ownerSub || taken.expiresAt<=clock())
          return result(401,{error:'UNAUTHORIZED'});
        const ttl=Math.ceil((taken.expiresAt-clock())/1000);
        if(ttl<=0)return result(401,{error:'UNAUTHORIZED'});
        const next=random();
        if(!await store.create(key('session',next),{...taken,issuedAt:clock()},ttl))
          throw new AuthDependencyError('AUTH_STORAGE_UNAVAILABLE');
        const headers=noStore();headers.set('Content-Type','application/json; charset=utf-8');
        headers.append('Set-Cookie',cookieHeader(SESSION_COOKIE,next,ttl));
        return new Response(JSON.stringify({rotated:true,csrf:csrfToken(config.csrfSecret,next)}),{status:200,headers});
      }catch(error){return unavailable(error);}
    }
  };
}
