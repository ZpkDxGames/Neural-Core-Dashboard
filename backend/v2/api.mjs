import { BrainError,fail,LIMITS } from './note.mjs';
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store, private','x-content-type-options':'nosniff','referrer-policy':'no-referrer','vary':'Authorization'};
function send(res,status,value){let data=JSON.stringify(value);if(Buffer.byteLength(data)>LIMITS.response){status=413;data='{"error":"RESPONSE_BUDGET_EXCEEDED"}';}res.writeHead(status,headers);res.end(data);}
async function body(req){
  if(!/^application\/json(?:; charset=utf-8)?$/.test(req.headers['content-type']??''))fail('JSON_REQUIRED',415);
  if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')fail('COMPRESSION_NOT_SUPPORTED',415);
  const declared=req.headers['content-length'];if(declared&&(!/^\d+$/.test(declared)||Number(declared)>240000))fail('PAYLOAD_TOO_LARGE',413);
  let bytes=0;const chunks=[];
  for await(const chunk of req){bytes+=chunk.length;if(bytes>240000)fail('PAYLOAD_TOO_LARGE',413);chunks.push(chunk);}
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{fail('INVALID_JSON',400);}
  if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_OBJECT');return value;
}
const revision=req=>{const value=req.headers['if-match'];if(typeof value!=='string'||!/^\d{1,9}$/.test(value))fail('EXPECTED_REVISION_REQUIRED',428);return Number(value);};
const query=url=>{
  const raw=url.searchParams.get('limit')??'25';if(!/^\d{1,3}$/.test(raw))fail('INVALID_LIMIT',400);
  return {limit:Number(raw),cursor:url.searchParams.get('cursor'),q:url.searchParams.get('q')??''};
};
const proposalQuery=url=>{
  const allowed=new Set(['limit','cursor','status','type']);
  if([...url.searchParams.keys()].some(k=>!allowed.has(k))||['limit','cursor'].some(k=>url.searchParams.getAll(k).length>1))fail('INVALID_QUERY',400);
  const statuses=url.searchParams.getAll('status'),noteTypes=url.searchParams.getAll('type');
  if(statuses.length>4||noteTypes.length>4)fail('INVALID_QUERY',400);
  const {limit,cursor}=query(url);
  return {limit,cursor,...(statuses.length?{statuses}:{}),noteTypes};
};
/** No listener, global token or environment gate. Production server does not import this module.
 * A future approved local composition root must explicitly enable it and supply the engine. */
export function makeV2Handler({engine,enabled=false,maxActive=2,quota=60,clock=()=>Date.now()}={}){
  let active=0;const windows=new Map();
  return async(req,res)=>{
    const addr=req.socket.remoteAddress;
    if(!enabled)return send(res,404,{error:'NOT_FOUND'});
    if(addr!=='127.0.0.1'&&addr!=='::ffff:127.0.0.1')return send(res,403,{error:'LOOPBACK_ONLY'});
    if(req.headers.origin||req.headers.cookie||req.headers['sec-fetch-site'])return send(res,403,{error:'BROWSER_ACCESS_DENIED'});
    if(active>=Math.max(1,Math.min(2,maxActive)))return send(res,429,{error:'BUSY'});
    active++;
    let timer;
    try{
      timer=setTimeout(()=>req.destroy(),10000);timer.unref();
      const auth=req.headers.authorization,match=typeof auth==='string'?/^Bearer (nbv2_[A-Za-z0-9_-]{43})$/.exec(auth):null;
      const p=await engine.authenticate(match?.[1]);
      const now=clock(),window=Math.floor(now/60000),last=windows.get(p.principalId);
      if(windows.size>=1000&&!windows.has(p.principalId)){for(const [key,value] of windows)if(value.window!==window)windows.delete(key);if(windows.size>=1000)fail('RATE_LIMITED',429);}
      const count=last?.window===window?last.count+1:1;windows.set(p.principalId,{window,count});if(count>quota)fail('RATE_LIMITED',429);
      const url=new URL(req.url,'http://localhost'),path=url.pathname,method=req.method;
      let result,status=200;
      if(path==='/v2/memories/proposals'&&method==='POST'){result=await engine.submit(p,await body(req),req.headers['idempotency-key']);status=result.replayed?200:201;}
      else if(path==='/v2/memories/proposals'&&method==='GET')result=await engine.proposals(p,proposalQuery(url));
      else if(/^\/v2\/proposals\/[^/]+\/review$/.test(path)&&method==='POST'){
        const input=await body(req);result=await engine.review(p,path.split('/')[3],{decision:input.decision,expectedRevision:revision(req),proof:req.headers['x-owner-proof']});
      }
      else if(path==='/v2/memories'&&method==='GET')result=await engine.list(p,query(url));
      else if(/^\/v2\/memories\/[^/]+$/.test(path)&&method==='GET')result=await engine.get(p,decodeURIComponent(path.split('/')[3]));
      else if(/^\/v2\/memories\/[^/]+$/.test(path)&&method==='PATCH'){result=await engine.submit(p,{noteId:decodeURIComponent(path.split('/')[3]),baseRevision:revision(req),note:await body(req)},req.headers['idempotency-key']);status=201;}
      else if(/^\/v2\/memories\/[^/]+$/.test(path)&&method==='DELETE'){
        if(req.headers['x-confirm-deletion']!=='delete-vault-note')fail('CONFIRM_DELETION',409);
        result=await engine.tombstone(p,decodeURIComponent(path.split('/')[3]),{expectedRevision:revision(req),proof:req.headers['x-owner-proof']});
      }
      else if(path==='/v2/graph'&&method==='GET')result=await engine.graph(p,{...query(url),focus:url.searchParams.get('focus'),depth:Number(url.searchParams.get('depth')??'1')});
      else if(path==='/v2/agents'&&method==='GET')result=await engine.agents(p);
      else if(path==='/v2/sync/status'&&method==='GET')result=await engine.status(p);
      else if(path==='/v2/export'&&method==='GET')result=await engine.exportPage(p,query(url));
      else return send(res,404,{error:'NOT_FOUND'});
      send(res,status,{schemaVersion:2,confirmedAt:new Date(now).toISOString(),data:result});
    }catch(e){send(res,e instanceof BrainError?e.status:503,{error:e instanceof BrainError?e.code:'SERVICE_UNAVAILABLE'});}
    finally{active--;clearTimeout(timer);}
  };
}
