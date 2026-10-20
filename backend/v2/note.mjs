import { createHash } from 'node:crypto';
export const LIMITS=Object.freeze({body:200000,file:256000,frontmatter:8192,evidence:32,relations:32,page:50,graphNodes:300,graphEdges:900,response:262144});
export class BrainError extends Error {
  constructor(code,status=422){super(code);this.code=code;this.status=status;}
}
export const fail=(code,status)=>{throw new BrainError(code,status);};
export const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
export const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export function cleanText(value,max,code='INVALID_TEXT'){
  if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value))fail(code);
  return value.normalize('NFC').replace(/\r\n?/g,'\n');
}
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function validateNote(raw){
  if(!obj(raw))fail('INVALID_NOTE');
  const allowed=new Set(['title','body','type','tags','evidence','relations']);
  if(Object.keys(raw).some(k=>!allowed.has(k)))fail('UNKNOWN_NOTE_FIELD');
  const title=cleanText(raw.title,120),body=cleanText(raw.body,LIMITS.body);
  const type=raw.type??'reference';
  if(!['fact','project','decision','reference'].includes(type))fail('INVALID_NOTE_TYPE');
  if(!Array.isArray(raw.tags??[])||(raw.tags??[]).length>16)fail('INVALID_TAGS');
  const tags=[...new Set((raw.tags??[]).map(t=>cleanText(t,40)))].sort();
  if(!Array.isArray(raw.evidence)||raw.evidence.length<1||raw.evidence.length>LIMITS.evidence)fail('EVIDENCE_REQUIRED');
  const evidence=raw.evidence.map(e=>{
    if(!obj(e))fail('INVALID_EVIDENCE');
    if(e.kind==='manual')return {kind:'manual',reason:cleanText(e.reason,500)};
    if(e.kind!=='conversation')fail('UNSUPPORTED_SOURCE_KIND');
    const value={kind:'conversation',conversationId:cleanText(e.conversationId,200),messageId:cleanText(e.messageId,200)};
    if(e.spanStart!==undefined||e.spanEnd!==undefined){
      if(!Number.isSafeInteger(e.spanStart)||!Number.isSafeInteger(e.spanEnd)||e.spanStart<0||e.spanEnd<=e.spanStart)fail('INVALID_EVIDENCE_SPAN');
      Object.assign(value,{spanStart:e.spanStart,spanEnd:e.spanEnd});
    }
    return value;
  });
  if(!Array.isArray(raw.relations??[])||(raw.relations??[]).length>LIMITS.relations)fail('INVALID_RELATIONS');
  const relations=(raw.relations??[]).map(r=>{
    if(!obj(r)||!uuid(r.targetId)||!['related','supports','contradicts','derived-from','link','supersedes'].includes(r.type)||!Number.isInteger(r.evidenceOrdinal)||r.evidenceOrdinal<0||r.evidenceOrdinal>=evidence.length)fail('INVALID_RELATION');
    if(r.confidence!==undefined&&(!Number.isFinite(r.confidence)||r.confidence<0||r.confidence>1))fail('INVALID_CONFIDENCE');
    return {targetId:r.targetId,type:r.type,evidenceOrdinal:r.evidenceOrdinal,...(r.confidence===undefined?{}:{confidence:r.confidence})};
  });
  if(new Set(relations.map(r=>r.targetId+':'+r.type)).size!==relations.length)fail('DUPLICATE_RELATION');
  const value={title,body,type,tags,evidence,relations};
  if(Buffer.byteLength(JSON.stringify(value))>240000)fail('PAYLOAD_TOO_LARGE',413);
  return value;
}
/** Deliberately small YAML 1.2 subset: JSON strings/arrays plus decimal integers.
 * No tags, aliases, anchors, duplicate/unknown keys, objects or implicit booleans.
 * Both emitted flow arrays and Obsidian block-list strings are supported. */
const KEYS=new Set(['brain_schema','note_id','revision','type','state','created_at','updated_at','agent_origin','source_refs','related_ids','tags']);
export function parseMarkdown(text){
  if(typeof text!=='string'||Buffer.byteLength(text)>LIMITS.file||text.includes('\0')||text.includes('\ufffd'))fail('INVALID_MARKDOWN');
  const canonical=text.replace(/\r\n?/g,'\n');
  if(!canonical.startsWith('---\n'))fail('FRONTMATTER_REQUIRED');
  const end=canonical.indexOf('\n---\n',4);
  if(end<0||Buffer.byteLength(canonical.slice(0,end))>LIMITS.frontmatter)fail('INVALID_FRONTMATTER');
  const meta=Object.create(null);let listKey=null;
  for(const line of canonical.slice(4,end).split('\n')){
    if(!line.trim())continue;
    const item=/^  - (".*")$/.exec(line);
    if(item&&listKey){try{meta[listKey].push(JSON.parse(item[1]));}catch{fail('INVALID_YAML');}continue;}
    const pair=/^([a-z_]+):(?: (.*))?$/.exec(line);
    if(!pair||!KEYS.has(pair[1])||Object.hasOwn(meta,pair[1]))fail('INVALID_YAML');
    const [,key,value='']=pair;listKey=null;
    if(value===''){meta[key]=[];listKey=key;continue;}
    try{
      if(/^\d{1,10}$/.test(value))meta[key]=Number(value);
      else if(value.startsWith('"')||value.startsWith('['))meta[key]=JSON.parse(value);
      else if(/^[a-z][a-z0-9_-]{0,39}$/.test(value))meta[key]=value;
      else fail('INVALID_YAML');
    }catch{fail('INVALID_YAML');}
  }
  if(meta.brain_schema!==1||!uuid(meta.note_id)||!Number.isSafeInteger(meta.revision)||meta.revision<1)fail('INVALID_NOTE_IDENTITY');
  if(meta.type!==undefined&&!['fact','project','decision','reference'].includes(meta.type))fail('INVALID_NOTE_TYPE');
  if(meta.state!==undefined&&!['proposed','reviewed','verified','rejected'].includes(meta.state))fail('INVALID_FILE_STATE');
  for(const key of ['created_at','updated_at'])if(meta[key]!==undefined&&(typeof meta[key]!=='string'||!/^\d{4}-\d\d-\d\dT/.test(meta[key])||!Number.isFinite(Date.parse(meta[key]))))fail('INVALID_TIMESTAMP');
  if(meta.agent_origin!==undefined&&(typeof meta.agent_origin!=='string'||meta.agent_origin.length>120))fail('INVALID_AGENT_ORIGIN');
  for(const key of ['source_refs','related_ids','tags'])if(meta[key]!==undefined&&(!Array.isArray(meta[key])||meta[key].length>32||meta[key].some(x=>typeof x!=='string'||Buffer.byteLength(x)>240)))fail('INVALID_YAML_ARRAY');
  if(meta.related_ids?.some(id=>!uuid(id)))fail('INVALID_RELATED_ID');
  return {meta,body:cleanText(canonical.slice(end+5),LIMITS.body),hash:hash(canonical),text:canonical};
}
export function serializeNote({noteId,revision,payload,createdAt,updatedAt,agentOrigin}){
  const meta={brain_schema:1,note_id:noteId,revision,type:payload.type,state:'proposed',created_at:createdAt,updated_at:updatedAt,agent_origin:agentOrigin,
    source_refs:payload.evidence.map(e=>e.kind==='manual'?'manual:owner':`conversation:${e.conversationId}/message:${e.messageId}`),related_ids:payload.relations.map(r=>r.targetId),tags:payload.tags};
  const text='---\n'+Object.entries(meta).map(([k,v])=>k+': '+JSON.stringify(v)).join('\n')+'\n---\n'+payload.body.replace(/\n*$/,'')+'\n';
  parseMarkdown(text);return text;
}
export function wikilinks(body){
  // Ignore fenced/inline code. No embedding/transclusion or recursive traversal.
  const plain=body.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`/g,'');
  return [...plain.matchAll(/!?\[\[([^\]\n]{1,180})\]\]/g)].slice(0,128).map(m=>{const [title,alias]=m[1].split('|');return {title:title.trim(),label:(alias??title).trim(),embedded:m[0].startsWith('!')};});
}
