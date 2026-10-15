export const origin='https://neural.example.invalid';
export const config={origin,clientId:'synthetic.apps.googleusercontent.com',clientSecret:'synthetic-client-secret-123',ownerSub:'123456789012345',redisUrl:'https://redis.example.invalid/',redisToken:'synthetic-storage-token-abc123456789',csrfSecret:'synthetic-csrf-key-for-tests-only-012345678901234567890'};
export const environment={NCORE_OWNER_AUTH_ENABLED:'1',NCORE_OWNER_AUTH_ORIGIN:origin,NCORE_GOOGLE_CLIENT_ID:config.clientId,NCORE_GOOGLE_CLIENT_SECRET:config.clientSecret,NCORE_GOOGLE_OWNER_SUB:config.ownerSub,NCORE_AUTH_REDIS_URL:config.redisUrl,NCORE_AUTH_REDIS_TOKEN:config.redisToken,NCORE_AUTH_CSRF_SECRET:config.csrfSecret};
export function memoryStore(now=()=>Date.now()){
  const data=new Map();
  const value=k=>{const x=data.get(k);if(x&&x.exp>now())return x.value;data.delete(k);return null;};
  return {data,async get(k){return value(k);},async take(k){const x=value(k);data.delete(k);return x;},async create(k,v,ttl){if(value(k)!==null)return false;data.set(k,{value:v,exp:now()+ttl*1000});return true;},async put(k,v,ttl){data.set(k,{value:v,exp:now()+ttl*1000});},async remove(k){data.delete(k);},async increment(k,ttl){const old=data.get(k),n=(value(k)??0)+1;data.set(k,{value:n,exp:old?.exp??now()+ttl*1000});return n;}};
}
export const provider={async authorize(i){return 'https://accounts.google.com/o/oauth2/v2/auth?state='+i.state;},async exchange(){return {sub:config.ownerSub,email_verified:true};}};
export const request=(path,method='GET',headers={})=>new Request(origin+'/api/auth/owner/'+path,{method,headers});
export const cookie=(r,name)=>r.headers.getSetCookie().map(x=>x.split(';')[0]).find(x=>x.startsWith(name+'='))??'';
export async function begin(ctrl){const r=await ctrl.start(request('start'));return {state:new URL(r.headers.get('location')).searchParams.get('state'),binding:cookie(r,'__Host-nc-google-flow')};}
export async function finish(ctrl,flow,extra={}){return ctrl.callback(request('callback?state='+flow.state+'&code=synthetic-code','GET',{cookie:flow.binding,...extra}));}
export async function login(ctrl){const r=await finish(ctrl,await begin(ctrl));const c=cookie(r,'__Host-nc-owner');const session=await ctrl.session(request('session','GET',{cookie:c}));return {cookie:c,body:await session.json()};}
