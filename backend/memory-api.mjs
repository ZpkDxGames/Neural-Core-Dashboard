import { StorageError } from './memory-store.mjs';
const JSON_HEADERS = { 'content-type':'application/json; charset=utf-8','cache-control':'no-store, private','x-content-type-options':'nosniff','referrer-policy':'no-referrer','vary':'Authorization' };
const respond = (res,status,data) => { res.writeHead(status,JSON_HEADERS); res.end(JSON.stringify(data)); };
function page(url) {
  const raw=url.searchParams.get('limit')??'25';
  if (!/^\d{1,3}$/.test(raw)) throw new StorageError(400,'INVALID_LIMIT');
  const limit=Number(raw);
  if (limit<1||limit>50) throw new StorageError(400,'INVALID_LIMIT');
  return {limit,cursor:url.searchParams.get('cursor')||null};
}
async function body(req) {
  const type=req.headers['content-type'];
  if (type !== 'application/json' && type !== 'application/json; charset=utf-8') throw new StorageError(415,'JSON_REQUIRED');
  if (req.headers['content-encoding'] && req.headers['content-encoding']!=='identity') throw new StorageError(415,'COMPRESSION_NOT_SUPPORTED');
  const declared=req.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared)>524288)) throw new StorageError(413,'PAYLOAD_TOO_LARGE');
  let size=0;const chunks=[];
  for await (const chunk of req) {
    size+=chunk.length;
    if (size>524288) throw new StorageError(413,'PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!size) throw new StorageError(400,'EMPTY_BODY');
  let parsed;
  try { parsed=JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new StorageError(400,'INVALID_JSON'); }
  if (!parsed || typeof parsed!=='object' || Array.isArray(parsed)) throw new StorageError(422,'INVALID_OBJECT');
  return parsed;
}
/** Internal machine-only local API; no CORS, cookies, browser owner token or external listener.
    It must be behind a separately reviewed and approved authenticated BFF before remote use. */
export function makeMemoryRouter(store,{validCredential,maxActive=2}) {
  let active=0;
  return async (req,res,url) => {
    if (!url.pathname.startsWith('/v1/')) return false;
    // This rejects browser-auth attempts even if a token was somehow leaked to the browser.
    if (req.headers.origin || req.headers.cookie || req.headers['sec-fetch-site']) { respond(res,403,{error:'BROWSER_ACCESS_DENIED'}); return true; }
    if (!validCredential(req.headers.authorization)) { respond(res,401,{error:'UNAUTHORIZED'});return true; }
    if (active>=maxActive) { respond(res,429,{error:'BUSY'});return true; }
    active++;
    try {
      const p=url.pathname, m=req.method;
      let result;
      if (p==='/v1/imports' && m==='POST') {
        result=await store.importBatch(await body(req),req.headers['idempotency-key']);
        respond(res,result.replayed?200:201,result);return true;
      }
      if (p==='/v1/conversations' && m==='GET') {
        result=await store.conversations({...page(url),provider:url.searchParams.get('provider')||''});
      } else if (p.startsWith('/v1/conversations/') && m==='GET') {
        result=await store.conversation(decodeURIComponent(p.slice('/v1/conversations/'.length)),page(url));
      } else if (p.startsWith('/v1/conversations/') && m==='DELETE') {
        if(req.headers['x-confirm-deletion']!=='delete-server-only') throw new StorageError(409,'CONFIRM_SERVER_DELETION');
        result=await store.deleteConversation(decodeURIComponent(p.slice('/v1/conversations/'.length)));
      } else if (p==='/v1/memories' && m==='GET') {
        result=await store.memories({...page(url),q:url.searchParams.get('q')||''});
      } else if (p==='/v1/memories' && m==='POST') {
        const data=await body(req);
        if(data.verified===true && req.headers['x-owner-decision']!=='verify') throw new StorageError(403,'EXPLICIT_VERIFICATION_REQUIRED');
        result=await store.updateMemory(null,data);
        respond(res,201,result);return true;
      } else if (p.startsWith('/v1/memories/') && m==='PATCH') {
        const data=await body(req);
        if(data.verified===true && req.headers['x-owner-decision']!=='verify') throw new StorageError(403,'EXPLICIT_VERIFICATION_REQUIRED');
        const revision=Number(req.headers['if-match']);
        result=await store.updateMemory(decodeURIComponent(p.slice('/v1/memories/'.length)),data,revision);
      } else if (p.startsWith('/v1/memories/') && m==='DELETE') {
        if(req.headers['x-confirm-deletion']!=='delete-server-only') throw new StorageError(409,'CONFIRM_SERVER_DELETION');
        result=await store.deleteMemory(decodeURIComponent(p.slice('/v1/memories/'.length)));
      } else if (p==='/v1/sync/status' && m==='GET') {
        result=await store.status();
      } else {
        respond(res,404,{error:'NOT_FOUND'});return true;
      }
      respond(res,200,result);return true;
    } catch(e) {
      if (e instanceof StorageError) respond(res,e.status,{error:e.code});
      else respond(res,503,{error:'SERVICE_UNAVAILABLE'});
      return true;
    } finally {active--; }
  };
}
