import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export class StorageError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const err = (status, code) => { throw new StorageError(status, code); };
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function validateImport(value) {
  if (!value || !Array.isArray(value.conversations) || !value.conversations.length || value.conversations.length > 25) err(422,'INVALID_IMPORT');
  const seen = new Set();
  let messages = 0;
  const conversations = value.conversations.map((c) => {
    if (!c || !['chatgpt','claude','gemini','generic'].includes(c.provider)) err(422,'INVALID_PROVIDER');
    if (typeof c.id !== 'string' || c.id.length < 3 || c.id.length > 256 || !c.id.startsWith(c.provider + ':') || /[\u0000-\u001f]/.test(c.id)) err(422,'INVALID_ID');
    if (seen.has(c.id)) err(409,'DUPLICATE_ID');
    seen.add(c.id);
    if (typeof c.title !== 'string' || c.title.length > 500) err(422,'INVALID_TITLE');
    if (!Array.isArray(c.messages) || !c.messages.length || c.messages.length > 250) err(422,'INVALID_MESSAGES');
    const ids = new Set();
    const parsed = c.messages.map((m) => {
      messages++;
      if (!m || typeof m.id !== 'string' || m.id.length < 1 || m.id.length > 256 || /[\u0000-\u001f]/.test(m.id) || ids.has(m.id)) err(422,'INVALID_MESSAGE_ID');
      ids.add(m.id);
      if (!['user','assistant','other'].includes(m.role) || typeof m.text !== 'string' || !m.text.trim() || Buffer.byteLength(m.text,'utf8') > 50000) err(422,'INVALID_MESSAGE');
      return { id: m.id, role: m.role, text: m.text, at: timestamp(m.at) };
    });
    return { id:c.id, provider:c.provider, sourceRecordId:c.id.slice(c.provider.length+1),
      title:c.title, createdAt:timestamp(c.createdAt), updatedAt:timestamp(c.updatedAt), messages:parsed };
  });
  if (messages > 1000) err(413,'TOO_MANY_MESSAGES');
  return { conversations, messages };
}

function timestamp(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d\d-\d\dT/.test(value)) err(422,'INVALID_DATE');
  const t = Date.parse(value);
  if (!Number.isFinite(t) || new Date(t).toISOString() !== value) err(422,'INVALID_DATE');
  return value;
}

const owner='owner'; // Single-owner canary, remote identity intentionally NOT active.
export class MemoryStore {
  constructor(pool, signingKey) { this.pool=pool; this.signingKey=signingKey; }
  cursor(data) {
    const payload=Buffer.from(JSON.stringify(data)).toString('base64url');
    const sig=createHmac('sha256',this.signingKey).update(payload).digest('base64url');
    return payload+'.'+sig;
  }
  decode(cursor) {
    if (!cursor) return null;
    if (typeof cursor !== 'string' || cursor.length > 1024) err(400,'INVALID_CURSOR');
    const parts=cursor.split('.');
    if (parts.length!==2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) err(400,'INVALID_CURSOR');
    const expected=createHmac('sha256',this.signingKey).update(parts[0]).digest();
    const actual=Buffer.from(parts[1],'base64url');
    if (actual.length!==expected.length || !timingSafeEqual(actual,expected)) err(400,'INVALID_CURSOR');
    try {
      const data=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
      if (!data || typeof data.id!=='string' || typeof data.ts!=='string' || typeof data.provider!=='string') err(400,'INVALID_CURSOR');
      return data;
    } catch { err(400,'INVALID_CURSOR'); }
  }
  async transaction(work) {
    const db=await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SET LOCAL statement_timeout='3000ms'");
      const value=await work(db);
      await db.query('COMMIT');
      return value;
    } catch(e) { await db.query('ROLLBACK').catch(()=>{}); throw e; }
    finally { db.release(); }
  }
  async importBatch(raw,key) {
    const parsed=validateImport(raw);
    if (typeof key!=='string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) err(400,'INVALID_IDEMPOTENCY_KEY');
    const hash=digest(parsed);
    return this.transaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[owner+':'+key]);
      const prior=await db.query('SELECT payload_sha256,imported_count,message_count FROM import_requests WHERE owner_id=$1 AND idempotency_key=$2',[owner,key]);
      if (prior.rows.length) {
        if (prior.rows[0].payload_sha256!==hash) err(409,'IDEMPOTENCY_CONFLICT');
        return {imported:prior.rows[0].imported_count,messages:prior.rows[0].message_count,replayed:true};
      }
      for (const c of parsed.conversations) {
        const deleted=await db.query('SELECT 1 FROM deleted_conversations WHERE owner_id=$1 AND conversation_id=$2',[owner,c.id]);
        if (deleted.rowCount) err(409,'DELETION_CONFLICT');
        const h=digest(c);
        await db.query('INSERT INTO conversations(id,source_id,source_record_id,owner_id,title,created_at,updated_at,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING',[c.id,c.provider,c.sourceRecordId,owner,c.title,c.createdAt,c.updatedAt,h]);
        const row=await db.query('SELECT owner_id,source_id,content_hash FROM conversations WHERE id=$1',[c.id]);
        if (row.rows.length!==1 || row.rows[0].owner_id!==owner || row.rows[0].source_id!==c.provider || row.rows[0].content_hash!==h) err(409,'SOURCE_CONFLICT');
        for (const m of c.messages) {
          await db.query('INSERT INTO messages(conversation_id,message_id,role,body,written_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(conversation_id,message_id) DO NOTHING',[c.id,m.id,m.role,m.text,m.at]);
        }
      }
      await db.query('INSERT INTO import_requests(owner_id,idempotency_key,payload_sha256,imported_count,message_count) VALUES($1,$2,$3,$4,$5)',[owner,key,hash,parsed.conversations.length,parsed.messages]);
      return { imported:parsed.conversations.length,messages:parsed.messages,replayed:false };
    });
  }
  async conversations({limit,cursor,provider}) {
    const after=this.decode(cursor);
    const source=provider||'';
    if (source && !['chatgpt','claude','gemini','generic'].includes(source)) err(400,'INVALID_PROVIDER');
    if (after && after.provider!==source) err(400,'INVALID_CURSOR');
    const rows=await this.pool.query(`SELECT id,source_id AS provider,title,created_at,updated_at,received_at
      FROM conversations WHERE owner_id=$1 AND deleted_at IS NULL
      AND ($2::text='' OR source_id=$2)
      AND ($3::timestamptz IS NULL OR (received_at,id)<($3::timestamptz,$4::text))
      ORDER BY received_at DESC,id DESC LIMIT $5`,[owner,source,after?.ts??null,after?.id??'',limit+1]);
    const items=rows.rows.slice(0,limit);
    const last=items.at(-1);
    return {items,nextCursor:rows.rows.length>limit&&last?this.cursor({id:last.id,ts:new Date(last.received_at).toISOString(),provider:source}):null};
  }
  async conversation(id,{limit,cursor}) {
    const record=await this.pool.query('SELECT id,source_id AS provider,title,created_at,updated_at FROM conversations WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL',[id,owner]);
    if (!record.rows.length) err(404,'NOT_FOUND');
    if (cursor && (typeof cursor!=='string' || cursor.length>256)) err(400,'INVALID_CURSOR');
    const messages=await this.pool.query('SELECT message_id AS id,role,body AS text,written_at AS at FROM messages WHERE conversation_id=$1 AND ($2::text IS NULL OR message_id>$2) ORDER BY message_id ASC LIMIT $3',[id,cursor||null,limit+1]);
    const items=messages.rows.slice(0,limit);
    return {conversation:record.rows[0],messages:items,nextCursor:messages.rows.length>limit?items.at(-1).id:null};
  }
  async memories({limit,cursor,q}) {
    const after=this.decode(cursor);
    if (after && after.provider!=='memory') err(400,'INVALID_CURSOR');
    if (q && (q.length>100 || /[\u0000-\u001f]/.test(q))) err(400,'INVALID_QUERY');
    const rows=await this.pool.query(`SELECT id,node_type,label,description,confidence,verified,revision,updated_at
      FROM memory_nodes WHERE owner_id=$1 AND ($2::text='' OR label ILIKE '%'||$2||'%')
      AND ($3::timestamptz IS NULL OR (updated_at,id)<($3::timestamptz,$4::text))
      ORDER BY updated_at DESC,id DESC LIMIT $5`,[owner,q||'',after?.ts??null,after?.id??'',limit+1]);
    const items=rows.rows.slice(0,limit),last=items.at(-1);
    return {items,nextCursor:rows.rows.length>limit&&last?this.cursor({id:last.id,ts:new Date(last.updated_at).toISOString(),provider:'memory'}):null};
  }
  async updateMemory(id,raw,revision=null) {
    if (!raw || typeof raw!=='object') err(422,'INVALID_MEMORY');
    const {nodeType,label,description,confidence,verified,evidence,edges}=raw;
    if (typeof nodeType!=='string' || !/^[a-z][a-z_-]{1,39}$/.test(nodeType) ||
        typeof label!=='string' || !label.trim() || label.length>250 ||
        (description!==null && description!==undefined && (typeof description!=='string'||description.length>4000)) ||
        (confidence!==null && confidence!==undefined && (typeof confidence!=='number'||confidence<0||confidence>1)) ||
        typeof verified!=='boolean' || !Array.isArray(evidence) || !evidence.length || evidence.length>50 ||
        !Array.isArray(edges) || edges.length>30) err(422,'INVALID_MEMORY');
    if (revision!==null && (!Number.isSafeInteger(revision)||revision<1)) err(422,'INVALID_REVISION');
    const uniq=new Set();
    for(const ev of evidence) {
      if (!ev || typeof ev.conversationId!=='string' || typeof ev.messageId!=='string' || !ev.messageId || uniq.has(ev.conversationId+'\0'+ev.messageId)) err(422,'INVALID_EVIDENCE');
      uniq.add(ev.conversationId+'\0'+ev.messageId);
    }
    for (const edge of edges) {
      if (!edge || typeof edge.targetId!=='string' || edge.targetId===id || typeof edge.relation!=='string' || !/^[a-z][a-z_-]{1,39}$/.test(edge.relation) || typeof edge.confidence!=='number' || edge.confidence<0 || edge.confidence>1) err(422,'INVALID_EDGE');
    }
    return this.transaction(async(db)=>{
      for(const ev of evidence) {
        const found=await db.query(`SELECT 1 FROM messages m JOIN conversations c ON c.id=m.conversation_id
          WHERE c.owner_id=$1 AND c.deleted_at IS NULL AND m.conversation_id=$2 AND m.message_id=$3`,[owner,ev.conversationId,ev.messageId]);
        if (!found.rowCount) err(422,'MISSING_EVIDENCE');
      }
      for(const edge of edges) {
        const found=await db.query('SELECT 1 FROM memory_nodes WHERE id=$1 AND owner_id=$2',[edge.targetId,owner]);
        if (!found.rowCount) err(422,'MISSING_EDGE_TARGET');
      }
      let storedId=id;
      if (revision===null) {
        storedId=randomUUID();
        await db.query('INSERT INTO memory_nodes(id,owner_id,node_type,label,description,confidence,verified) VALUES($1,$2,$3,$4,$5,$6,$7)',[storedId,owner,nodeType,label,description??null,confidence??null,verified]);
      } else {
        const result=await db.query('UPDATE memory_nodes SET node_type=$3,label=$4,description=$5,confidence=$6,verified=$7,revision=revision+1,updated_at=now() WHERE id=$1 AND owner_id=$2 AND revision=$8 RETURNING revision',[id,owner,nodeType,label,description??null,confidence??null,verified,revision]);
        if (!result.rowCount) err(409,'REVISION_CONFLICT');
        await db.query('DELETE FROM memory_evidence WHERE node_id=$1',[id]);
        await db.query('DELETE FROM memory_edges WHERE source_id=$1',[id]);
      }
      for(const ev of evidence) await db.query('INSERT INTO memory_evidence(node_id,conversation_id,message_id) VALUES($1,$2,$3)',[storedId,ev.conversationId,ev.messageId]);
      for(const edge of edges) await db.query('INSERT INTO memory_edges(source_id,target_id,relation,confidence) VALUES($1,$2,$3,$4)',[storedId,edge.targetId,edge.relation,edge.confidence]);
      return {id:storedId,revision:revision===null?1:revision+1};
    });
  }
  async deleteConversation(id) {
    return this.transaction(async(db)=>{
      const locked=await db.query('SELECT source_id FROM conversations WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,owner]);
      if (!locked.rowCount) err(404,'NOT_FOUND');
      const affected=await db.query('SELECT DISTINCT node_id FROM memory_evidence WHERE conversation_id=$1',[id]);
      await db.query('INSERT INTO deleted_conversations(owner_id,conversation_id,source_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[owner,id,locked.rows[0].source_id]);
      await db.query('DELETE FROM conversations WHERE id=$1 AND owner_id=$2',[id,owner]);
      for(const row of affected.rows) {
        await db.query('DELETE FROM memory_nodes WHERE id=$1 AND owner_id=$2 AND NOT EXISTS(SELECT 1 FROM memory_evidence WHERE node_id=$1)',[row.node_id,owner]);
      }
      return {deleted:true,scope:'server-only',tombstoned:true};
    });
  }
  async deleteMemory(id) {
    const row=await this.pool.query('DELETE FROM memory_nodes WHERE id=$1 AND owner_id=$2 RETURNING id',[id,owner]);
    if (!row.rowCount) err(404,'NOT_FOUND');
    return {deleted:true,scope:'server-only'};
  }
  async status() {
    const r=await this.pool.query(`SELECT
      (SELECT count(*) FROM conversations WHERE owner_id=$1 AND deleted_at IS NULL)::integer AS conversations,
      (SELECT count(*) FROM memory_nodes WHERE owner_id=$1)::integer AS memories,
      (SELECT max(committed_at) FROM import_requests WHERE owner_id=$1) AS last_import_at,
      (SELECT count(*) FROM deleted_conversations WHERE owner_id=$1)::integer AS tombstones`,[owner]);
    return {mode:'local-canary',schemaVersion:2,...r.rows[0]};
  }
}
