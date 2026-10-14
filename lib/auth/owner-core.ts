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
export type Flow = { binding: string; nonce: string; verifier: string; state: string };
export type Identity = { sub?: unknown; email_verified?: unknown; email?: unknown };
export type Session = { sub: string; expiresAt: number; issuedAt: number };
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
const PREFIX = 'nc:auth:v1:';
const random = () => randomBytes(32).toString('base64url');
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const key = (category: string, token: string) => PREFIX + category + ':' + digest(token);
const secretPattern = /^[A-Za-z0-9_-]{40,}$/;

export function readOwnerConfig(env: Record<string,string|undefined>): OwnerConfig | null {
  if (env.NCORE_OWNER_AUTH_ENABLED !== '1') return null;
  const origin = env.NCORE_OWNER_AUTH_ORIGIN ?? '';
  let url: URL;
  try { url = new URL(origin); } catch { throw Error('Invalid owner auth origin'); }
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw Error('HTTPS owner auth origin required');
  const clientId = env.NCORE_GOOGLE_CLIENT_ID ?? '';
  const clientSecret = env.NCORE_GOOGLE_CLIENT_SECRET ?? '';
  const ownerSub = env.NCORE_GOOGLE_OWNER_SUB ?? '';
  const redisUrl = env.NCORE_AUTH_REDIS_URL ?? '';
  const redisToken = env.NCORE_AUTH_REDIS_TOKEN ?? '';
  const csrfSecret = env.NCORE_AUTH_CSRF_SECRET ?? '';
  if (!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId) ||
      clientSecret.length < 16 || !/^\d{6,255}$/.test(ownerSub) ||
      !secretPattern.test(csrfSecret) || redisToken.length < 24) throw Error('Incomplete owner auth configuration');
  let redis: URL;
  try { redis = new URL(redisUrl); } catch { throw Error('Invalid auth session store URL'); }
  if (redis.protocol !== 'https:' || redis.username || redis.password || !redis.hostname || redis.pathname !== '/' || redis.search || redis.hash) throw Error('Invalid HTTPS auth session store');
  return { origin, clientId, clientSecret, ownerSub, redisUrl, redisToken, csrfSecret };
}
export function ownerAllowed(identity: Identity, ownerSub: string): boolean {
  return typeof identity.sub === 'string' && identity.sub === ownerSub &&
    identity.email_verified === true; // signed OIDC ID token claims, never an unsigned profile.
}
export function safeEqual(a: string | undefined | null, b: string): boolean {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
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
  const found = cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));
  const value = found?.slice(name.length+1);
  return value && /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : null;
}
function validFlow(flow: Flow | null): flow is Flow {
  return Boolean(flow && typeof flow.binding==='string' && typeof flow.nonce==='string' &&
    typeof flow.verifier==='string' && typeof flow.state==='string');
}

export function ownerController({config, store, provider, clock = Date.now}: {
  config:OwnerConfig; store:Store; provider:OidcProvider; clock?:()=>number
}) {
  const callback = config.origin + '/api/auth/owner/callback';
  const authorizedSession = async(req:Request) => {
    const token=parsedCookie(req,SESSION_COOKIE);
    if (!token) return null;
    const saved=await store.get<Session>(key('session',token));
    if (!saved || saved.sub!==config.ownerSub ||
      !Number.isSafeInteger(saved.expiresAt) || saved.expiresAt<=clock() ||
      saved.issuedAt>clock()) return null;
    return {token,saved};
  };
  const requireCsrf = (req:Request, token:string): boolean => exactOrigin(req,config.origin) &&
      safeEqual(req.headers.get('x-ncore-csrf'),csrfToken(config.csrfSecret,token));
  return {
    async start(req:Request): Promise<Response> {
      if(req.method!=='GET')return result(405,{error:'METHOD_NOT_ALLOWED'});
      try{
        // A shared, bounded server-side quota; no spoofable X-Forwarded-For trust.
        const attempts=await store.increment(PREFIX+'login-rate',LIMIT_WINDOW);
        if(attempts>LIMIT)return result(429,{error:'RATE_LIMITED'});
        const state=random(),nonce=random(),verifier=random(),binding=random();
        const flow:Flow={state,nonce,verifier,binding:digest(binding)};
        if(!await store.create(key('flow',state),flow,LOGIN_TTL))return result(503,{error:'AUTH_UNAVAILABLE'});
        const url=await provider.authorize({state,nonce,verifier,redirectUri:callback});
        const target=new URL(url);
        if(target.protocol!=='https:' || target.hostname!=='accounts.google.com' || target.username || target.password) throw Error('Unsafe provider redirect');
        const response=redirect(target.toString(),cookieHeader(FLOW_COOKIE,binding,LOGIN_TTL));
        // OAuth state must never be leaked through Referer.
        return response;
      }catch{return result(503,{error:'AUTH_UNAVAILABLE'},[CLEAR_FLOW]);}
    },
    async callback(req:Request): Promise<Response> {
      if(req.method!=='GET')return result(405,{error:'METHOD_NOT_ALLOWED'});
      const url=new URL(req.url);
      const state=url.searchParams.get('state'), binding=parsedCookie(req,FLOW_COOKIE);
      if(!state || !/^[A-Za-z0-9_-]{40,128}$/.test(state) || !binding)
        return redirect(config.origin+'/?auth=failed',CLEAR_FLOW);
      let flow:Flow|null;
      try{flow=await store.take<Flow>(key('flow',state));}
      catch{return result(503,{error:'AUTH_UNAVAILABLE'},[CLEAR_FLOW]);}
      if(!validFlow(flow) || !safeEqual(digest(binding),flow.binding) || !safeEqual(state,flow.state))
        return redirect(config.origin+'/?auth=failed',CLEAR_FLOW);
      try {
        if(url.origin!==config.origin || !url.searchParams.get('code') || url.searchParams.has('error'))
          return redirect(config.origin+'/?auth=failed',CLEAR_FLOW);
        const identity=await provider.exchange({state,nonce:flow.nonce,verifier:flow.verifier,redirectUri:callback,currentUrl:url.toString()});
        if(!ownerAllowed(identity,config.ownerSub))return redirect(config.origin+'/?auth=denied',CLEAR_FLOW);
        const token=random(), now=clock(), expiresAt=now+SESSION_TTL*1000;
        if(!await store.create(key('session',token),{sub:config.ownerSub,issuedAt:now,expiresAt},SESSION_TTL))
          return result(503,{error:'AUTH_UNAVAILABLE'},[CLEAR_FLOW]);
        const headers=noStore();headers.set('Location',config.origin+'/');
        headers.append('Set-Cookie',CLEAR_FLOW);
        headers.append('Set-Cookie',cookieHeader(SESSION_COOKIE,token,SESSION_TTL));
        return new Response(null,{status:303,headers});
      }catch{return redirect(config.origin+'/?auth=failed',CLEAR_FLOW);}
    },
    async session(req:Request):Promise<Response> {
      if(req.method!=='GET')return result(405,{error:'METHOD_NOT_ALLOWED'});
      try{
        const record=await authorizedSession(req);
        if(!record)return result(401,{authenticated:false},[CLEAR_SESSION]);
        return result(200,{authenticated:true,provider:'google',expiresAt:new Date(record.saved.expiresAt).toISOString(),
          csrf:csrfToken(config.csrfSecret,record.token)});
      }catch{return result(503,{error:'AUTH_UNAVAILABLE'});}
    },
    async logout(req:Request):Promise<Response> {
      if(req.method!=='POST')return result(405,{error:'METHOD_NOT_ALLOWED'});
      try {
        const record=await authorizedSession(req);
        if(!record)return result(401,{error:'UNAUTHORIZED'},[CLEAR_SESSION]);
        if(!requireCsrf(req,record.token))return result(403,{error:'CSRF_DENIED'});
        await store.remove(key('session',record.token));
        return result(200,{loggedOut:true},[CLEAR_SESSION]);
      }catch{return result(503,{error:'AUTH_UNAVAILABLE'});}
    },
    async rotate(req:Request):Promise<Response> {
      if(req.method!=='POST')return result(405,{error:'METHOD_NOT_ALLOWED'});
      try {
        const record=await authorizedSession(req);
        if(!record)return result(401,{error:'UNAUTHORIZED'},[CLEAR_SESSION]);
        if(!requireCsrf(req,record.token))return result(403,{error:'CSRF_DENIED'});
        // Expire old token before issuing new; fail closed on store outage.
        const taken=await store.take<Session>(key('session',record.token));
        if(!taken || taken.sub!==config.ownerSub || taken.expiresAt<=clock())
          return result(401,{error:'UNAUTHORIZED'},[CLEAR_SESSION]);
        const ttl=Math.ceil((taken.expiresAt-clock())/1000);
        if(ttl<=0)return result(401,{error:'UNAUTHORIZED'},[CLEAR_SESSION]);
        const next=random();
        if(!await store.create(key('session',next),{...taken,issuedAt:clock()},ttl))
          return result(503,{error:'AUTH_UNAVAILABLE'},[CLEAR_SESSION]);
        const headers=noStore();headers.set('Content-Type','application/json; charset=utf-8');
        headers.append('Set-Cookie',cookieHeader(SESSION_COOKIE,next,ttl));
        return new Response(JSON.stringify({rotated:true,csrf:csrfToken(config.csrfSecret,next)}),{status:200,headers});
      }catch{return result(503,{error:'AUTH_UNAVAILABLE'});}
    }
  };
}
