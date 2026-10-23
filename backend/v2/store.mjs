import { randomUUID,createHmac,timingSafeEqual } from 'node:crypto';
import { BrainError,fail,hash,uuid,validateNote,serializeNote,LIMITS } from './note.mjs';

const mapPrincipal=row=>({principalId:row.principal_id,ownerId:row.owner_id,displayName:row.display_name,kind:row.kind,role:row.role,scopes:row.scopes,credentialHash:row.token_hash.trim(),...(row.permission_epoch!==undefined?{permissionEpoch:row.permission_epoch}:{})});
const types=p=>p.scopes.filter(s=>s.startsWith('type:')).map(s=>s.slice(5));
const assertType=(p,type)=>{if(types(p).length&&!types(p).includes(type))fail('ROLE_FORBIDDEN',403);};
export const summary=row=>({noteId:row.note_id,title:row.payload.title,type:row.payload.type,tags:row.payload.tags,revision:row.published_revision,
  trust:row.verified_by?'verified':'proposed',publishedHash:row.published_hash?.trim(),verifiedBy:row.verified_by??undefined,verifiedAt:row.verified_at??undefined,
  updatedAt:row.updated_at,pending:row.current_revision>row.published_revision});

/** SQL coordination and projections only. File IO belongs to VaultWorker.
 * pool is injected (max=2 recommended), no environment/network defaults. */
export class MemoryEngine {
  constructor(pool,{cursorKey}={}){
    if(typeof cursorKey!=='string'||cursorKey.length<32)fail('CURSOR_KEY_REQUIRED');
    this.pool=pool;this.cursorKey=cursorKey;
  }
  async tx(fn){
    const db=await this.pool.connect();
    try{await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='5000ms'");await db.query("SET LOCAL lock_timeout='2000ms'");
      const result=await fn(db);await db.query('COMMIT');return result;
    }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
  }
  async authenticate(token){
    if(typeof token!=='string'||!/^nbv2_[A-Za-z0-9_-]{43}$/.test(token))fail('UNAUTHORIZED',401);
    const r=await this.pool.query('SELECT * FROM vault_principals WHERE token_hash=$1 AND disabled_at IS NULL',[hash(token)]);
    if(r.rows.length!==1||r.rows[0].credential_expires_at&&new Date(r.rows[0].credential_expires_at)<=new Date()||r.rows[0]?.permission_epoch!==undefined&&r.rows[0].kind==='agent'&&!r.rows[0].credential_expires_at)fail('UNAUTHORIZED',401);return mapPrincipal(r.rows[0]);
  }
  async authorize(db,identity,scope){
    if(!identity||!uuid(identity.principalId)||typeof identity.credentialHash!=='string')fail('UNAUTHORIZED',401);
    const r=await db.query('SELECT * FROM vault_principals WHERE principal_id=$1 AND token_hash=$2 AND disabled_at IS NULL',[identity.principalId,identity.credentialHash]);
    if(r.rows.length!==1||r.rows[0].owner_id!==identity.ownerId)fail('UNAUTHORIZED',401);
    const row=r.rows[0];
    if(row.credential_expires_at&&new Date(row.credential_expires_at)<=new Date()||row.permission_epoch!==undefined&&row.kind==='agent'&&!row.credential_expires_at||identity.permissionEpoch!==undefined&&identity.permissionEpoch!==row.permission_epoch)fail('UNAUTHORIZED',401);
    const p=mapPrincipal(row);
    if(!p.scopes.includes(scope)||(scope==='propose'&&p.role==='viewer')||(['review','delete','export'].includes(scope)&&p.role!=='owner'))fail('ROLE_FORBIDDEN',403);
    return p;
  }
  async audit(db,p,action,targetId,outcome){
    await db.query('INSERT INTO vault_actions(action_id,owner_id,principal_id,action,target_id,outcome) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),p.ownerId,p.principalId,action,targetId,outcome]);
  }
  async validateEvidence(db,p,note){
    for(const e of note.evidence){
      if(e.kind==='manual'){if(p.kind!=='owner')fail('MANUAL_PROVENANCE_OWNER_REQUIRED',403);continue;}
      const r=await db.query(`SELECT m.body FROM messages m JOIN conversations c ON c.id=m.conversation_id
        WHERE c.owner_id=$1 AND c.deleted_at IS NULL AND m.conversation_id=$2 AND m.message_id=$3 FOR KEY SHARE OF m,c`,[p.ownerId,e.conversationId,e.messageId]);
      if(r.rows.length!==1)fail('MISSING_EVIDENCE');
      if(e.spanEnd!==undefined&&e.spanEnd>r.rows[0].body.length)fail('INVALID_EVIDENCE_SPAN');
    }
    for(const r of note.relations){
      const found=await db.query('SELECT note_type FROM vault_notes WHERE owner_id=$1 AND note_id=$2 AND deleted_at IS NULL AND published_revision>0',[p.ownerId,r.targetId]);
      if(!found.rows.length)fail('RELATION_TARGET_UNAVAILABLE');assertType(p,found.rows[0].note_type);
    }
  }
  async submit(identity,{noteId=null,baseRevision=0,note},key){
    if(typeof key!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(key))fail('IDEMPOTENCY_KEY_REQUIRED');
    if(noteId!==null&&!uuid(noteId))fail('INVALID_NOTE_ID');
    if(!Number.isSafeInteger(baseRevision)||baseRevision<0)fail('EXPECTED_REVISION_REQUIRED',428);
    const payload=validateNote(note),fingerprint=hash(JSON.stringify({noteId,baseRevision,payload}));
    return this.tx(async db=>{
      const p=await this.authorize(db,identity,'propose');assertType(p,payload.type);
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[p.ownerId+':'+p.principalId,key]);
      const prior=await db.query('SELECT * FROM vault_proposals WHERE owner_id=$1 AND principal_id=$2 AND idempotency_key=$3',[p.ownerId,p.principalId,key]);
      if(prior.rows.length){if(prior.rows[0].payload_hash.trim()!==fingerprint)fail('IDEMPOTENCY_CONFLICT',409);return {proposalId:prior.rows[0].proposal_id,noteId:prior.rows[0].note_id,state:prior.rows[0].state,replayed:true};}
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1),104)',[p.ownerId]);
      const ownerQueue=(await db.query("SELECT count(*)::int AS n FROM (SELECT 1 FROM vault_proposals WHERE owner_id=$1 AND state IN ('proposed','conflict') LIMIT 1000) q",[p.ownerId])).rows[0].n;
      const agentQueue=(await db.query("SELECT count(*)::int AS n FROM (SELECT 1 FROM vault_proposals WHERE owner_id=$1 AND principal_id=$2 AND state IN ('proposed','conflict') LIMIT 100) q",[p.ownerId,p.principalId])).rows[0].n;
      if(ownerQueue>=1000||agentQueue>=100)fail('PROPOSAL_QUEUE_FULL',429);
      await this.validateEvidence(db,p,payload);
      if(noteId){
        const n=await db.query('SELECT * FROM vault_notes WHERE note_id=$1 AND owner_id=$2 FOR UPDATE',[noteId,p.ownerId]);
        if(!n.rows.length||n.rows[0].deleted_at)fail('NOT_FOUND',404);assertType(p,n.rows[0].note_type);
        if(n.rows[0].current_revision!==baseRevision||n.rows[0].published_revision!==baseRevision)fail('REVISION_CONFLICT',409);
      }else if(baseRevision!==0)fail('REVISION_CONFLICT',409);
      const duplicate=await db.query('SELECT note_id,note_type FROM vault_notes WHERE owner_id=$1 AND body_hash=$2 AND deleted_at IS NULL ORDER BY note_id LIMIT 1',[p.ownerId,hash(payload.body)]);
      const duplicateId=duplicate.rows.find(n=>!types(p).length||types(p).includes(n.note_type))?.note_id??null;
      const proposalId=randomUUID(),assigned=noteId??randomUUID();
      await db.query(`INSERT INTO vault_proposals(proposal_id,owner_id,note_id,principal_id,base_revision,payload,payload_hash,idempotency_key,duplicate_of)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[proposalId,p.ownerId,assigned,p.principalId,baseRevision,JSON.stringify(payload),fingerprint,key,duplicateId]);
      await this.audit(db,p,'proposal',proposalId,'proposed');
      return {proposalId,noteId:assigned,state:'proposed',duplicateOf:duplicateId,replayed:false};
    });
  }
  async consumeProof(db,p,proof,subject,expected){
    if(p.permissionEpoch!==undefined)fail('PRIVATE_ENGINE_REQUIRED',403);
    if(typeof proof!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(proof))fail('OWNER_PROOF_REQUIRED',403);
    const r=await db.query(`UPDATE vault_review_grants SET used_at=now() WHERE proof_hash=$1 AND owner_id=$2 AND principal_id=$3
      AND subject_id=$4 AND expected_revision=$5 AND used_at IS NULL AND expires_at>now() RETURNING proof_hash`,[hash(proof),p.ownerId,p.principalId,subject,expected]);
    if(!r.rows.length)fail('OWNER_PROOF_INVALID',403);
  }
  async review(identity,proposalId,{decision,expectedRevision,proof}){
    if(!uuid(proposalId)||!['verify','publish-unverified','reject'].includes(decision)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('INVALID_REVIEW');
    return this.tx(async db=>{
      const p=await this.authorize(db,identity,'review');
      const proposed=await db.query('SELECT * FROM vault_proposals WHERE owner_id=$1 AND proposal_id=$2 FOR UPDATE',[p.ownerId,proposalId]);
      if(!proposed.rows.length)fail('NOT_FOUND',404);
      const proposal=proposed.rows[0],payload=validateNote(proposal.payload);assertType(p,payload.type);
      if(proposal.state!=='proposed'&&proposal.state!=='conflict')fail('PROPOSAL_ALREADY_REVIEWED',409);
      if(expectedRevision!==proposal.base_revision)fail('REVISION_CONFLICT',409);
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1),103)',[proposal.note_id]);
      let n=(await db.query('SELECT * FROM vault_notes WHERE owner_id=$1 AND note_id=$2 FOR UPDATE',[p.ownerId,proposal.note_id])).rows[0];
      if(decision!=='reject'&&n&&(n.deleted_at||n.current_revision!==expectedRevision||(!proposal.expected_file_hash&&n.published_revision!==expectedRevision)))fail('REVISION_CONFLICT',409);
      if(!n&&expectedRevision!==0)fail('REVISION_CONFLICT',409);
      await this.consumeProof(db,p,proof,proposalId,expectedRevision,{action:decision,intentHash:proposal.payload_hash.trim()});
      if(decision==='reject'){
        await db.query("UPDATE vault_proposals SET state='rejected',reviewed_at=now() WHERE proposal_id=$1",[proposalId]);
        await this.audit(db,p,'review',proposalId,'rejected');return {proposalId,state:'rejected'};
      }
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1),105)',[p.ownerId]);
      const queue=(await db.query("SELECT count(*)::int AS n FROM (SELECT 1 FROM vault_outbox WHERE owner_id=$1 AND state IN ('pending','failed','conflict') LIMIT 1000) q",[p.ownerId])).rows[0].n;
      if(queue>=1000)fail('PUBLICATION_QUEUE_FULL',429);
      await this.validateEvidence(db,p,payload);
      if(!n){
        // An exact duplicate must be consolidated explicitly; never auto-promote it.
        const duplicate=await db.query('SELECT note_id FROM vault_notes WHERE owner_id=$1 AND body_hash=$2 AND deleted_at IS NULL LIMIT 1',[p.ownerId,hash(payload.body)]);
        if(duplicate.rows.length)fail('DUPLICATE_NOTE',409);
        await db.query('INSERT INTO vault_notes(note_id,owner_id,canonical_path,title,note_type,body_hash) VALUES($1,$2,$3,$4,$5,$6)',[proposal.note_id,p.ownerId,proposal.note_id+'.md',payload.title,payload.type,hash(payload.body)]);
        n=(await db.query('SELECT * FROM vault_notes WHERE note_id=$1 FOR UPDATE',[proposal.note_id])).rows[0];
      }
      const now=new Date().toISOString(),revision=expectedRevision+1;
      const markdown=serializeNote({noteId:n.note_id,revision,payload,createdAt:new Date(n.created_at).toISOString(),updatedAt:now,agentOrigin:proposal.principal_id,approvedRelations:decision==='verify'});
      const contentHash=hash(markdown),verified=decision==='verify';
      await db.query(`INSERT INTO vault_revisions(owner_id,note_id,revision,base_revision,content_hash,markdown,payload,principal_id,proposal_id,verified_by,verified_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[p.ownerId,n.note_id,revision,expectedRevision,contentHash,markdown,JSON.stringify(payload),proposal.principal_id,proposalId,verified?p.principalId:null,verified?now:null]);
      for(let i=0;i<payload.evidence.length;i++){
        const e=payload.evidence[i];
        await db.query('INSERT INTO vault_evidence(owner_id,note_id,revision,ordinal,source_kind,conversation_id,message_id,manual_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.ownerId,n.note_id,revision,i,e.kind,e.conversationId??null,e.messageId??null,e.reason??null]);
      }
      for(const r of payload.relations){
        if(r.targetId===n.note_id)fail('SELF_RELATION');
        await db.query('INSERT INTO vault_relations(owner_id,source_id,source_revision,target_id,relation_type,evidence_ordinal,confidence) VALUES($1,$2,$3,$4,$5,$6,$7)',[p.ownerId,n.note_id,revision,r.targetId,r.type,r.evidenceOrdinal,r.confidence??null]);
      }
      await db.query('UPDATE vault_notes SET current_revision=$2 WHERE note_id=$1',[n.note_id,revision]);
      await db.query("UPDATE vault_proposals SET state='accepted',reviewed_at=now() WHERE proposal_id=$1",[proposalId]);
      const eventId=randomUUID();
      if(proposal.expected_file_hash)await db.query("UPDATE vault_outbox SET state='cancelled' WHERE note_id=$1 AND operation='publish' AND state IN ('pending','conflict','failed')",[n.note_id]);
      await db.query("INSERT INTO vault_outbox(event_id,owner_id,note_id,revision,operation,expected_hash) VALUES($1,$2,$3,$4,'publish',$5)",[eventId,p.ownerId,n.note_id,revision,proposal.expected_file_hash??n.published_hash]);
      await this.audit(db,p,'review',proposalId,decision);
      return {proposalId,noteId:n.note_id,revision,eventId,state:'pending'};
    }).catch(async error=>{
      if(error instanceof BrainError&&error.code==='REVISION_CONFLICT')await this.tx(async db=>{const p=await this.authorize(db,identity,'review');await db.query("UPDATE vault_proposals SET state='conflict' WHERE owner_id=$1 AND proposal_id=$2 AND state='proposed'",[p.ownerId,proposalId]);});
      throw error;
    });
  }
  encodeCursor(data){const value=Buffer.from(JSON.stringify(data)).toString('base64url');return value+'.'+createHmac('sha256',this.cursorKey).update(value).digest('base64url');}
  decodeCursor(cursor,scope){
    if(!cursor)return null;
    if(typeof cursor!=='string'||cursor.length>1024)fail('INVALID_CURSOR',400);
    const [v,signature,...rest]=cursor.split('.'),expected=createHmac('sha256',this.cursorKey).update(v).digest('base64url');
    if(rest.length||!signature||signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))fail('INVALID_CURSOR',400);
    try{const data=JSON.parse(Buffer.from(v,'base64url').toString());if(data.scope!==scope||!uuid(data.id)||!Number.isFinite(data.rank))fail('INVALID_CURSOR',400);return data;}catch{fail('INVALID_CURSOR',400);}
  }
  async list(identity,{limit=25,cursor=null,q=''}={}){
    if(!Number.isInteger(limit)||limit<1||limit>LIMITS.page||typeof q!=='string'||q.length>200)fail('INVALID_QUERY',400);
    return this.tx(async db=>{
      const p=await this.authorize(db,identity,'read'),scope=hash(JSON.stringify(['notes-v2',p.ownerId,p.principalId,p.credentialHash,p.role,p.permissionEpoch??null,p.authorization?.sessionRef??null,p.authorization?.consentEpoch??null,[...p.scopes].sort(),q,limit]));
      const after=this.decodeCursor(cursor,scope);
      const r=await db.query(`WITH ranked AS (
        SELECT n.*,r.payload,r.verified_by,r.verified_at,
        CASE WHEN $2='' THEN 0::real ELSE ts_rank_cd(s.document,plainto_tsquery('simple',$2)) END AS rank
        FROM vault_notes n JOIN vault_revisions r ON r.note_id=n.note_id AND r.revision=n.published_revision
        JOIN vault_search_documents s ON s.note_id=n.note_id AND s.revision=n.published_revision
        WHERE n.owner_id=$1 AND n.deleted_at IS NULL AND (cardinality($3::text[])=0 OR n.note_type=ANY($3))
        AND ($2='' OR s.document@@plainto_tsquery('simple',$2)))
        SELECT * FROM ranked WHERE ($4::uuid IS NULL OR rank<$5::real OR (rank=$5::real AND note_id>$4)) ORDER BY rank DESC,note_id LIMIT $6`,[p.ownerId,q,types(p),after?.id??null,after?.rank??0,limit+1]);
      const more=r.rows.length>limit,rows=r.rows.slice(0,limit),last=rows.at(-1);
      return {items:rows.map(summary),nextCursor:more?this.encodeCursor({scope,id:last.note_id,rank:Number(last.rank)}):null,partial:more};
    });
  }
  async get(identity,noteId){
    if(!uuid(noteId))fail('NOT_FOUND',404);
    return this.tx(async db=>{
      const p=await this.authorize(db,identity,'read');
      const r=await db.query(`SELECT n.*,r.payload,r.markdown,r.verified_by,r.verified_at FROM vault_notes n
        JOIN vault_revisions r ON r.note_id=n.note_id AND r.revision=n.published_revision
        WHERE n.owner_id=$1 AND n.note_id=$2 AND n.deleted_at IS NULL`,[p.ownerId,noteId]);
      if(!r.rows.length)fail('NOT_FOUND',404);const n=r.rows[0];assertType(p,n.note_type);
      const backlinks=await db.query(`SELECT e.source_id,e.relation_type,e.evidence_ordinal FROM vault_relations e
        JOIN vault_notes s ON s.note_id=e.source_id AND s.published_revision=e.source_revision
        WHERE e.owner_id=$1 AND e.target_id=$2 AND s.deleted_at IS NULL AND (cardinality($3::text[])=0 OR s.note_type=ANY($3))
        ORDER BY e.source_id LIMIT 50`,[p.ownerId,noteId,types(p)]);
      const outgoing=await db.query(`SELECT e.target_id,e.relation_type,e.confidence,e.evidence_ordinal FROM vault_relations e
        JOIN vault_notes t ON t.note_id=e.target_id WHERE e.owner_id=$1 AND e.source_id=$2 AND e.source_revision=$3
        AND t.deleted_at IS NULL AND t.published_revision>0 AND (cardinality($4::text[])=0 OR t.note_type=ANY($4)) ORDER BY e.target_id LIMIT 32`,[p.ownerId,noteId,n.published_revision,types(p)]);
      return {...summary(n),body:n.payload.body,evidence:n.payload.evidence,relations:outgoing.rows,backlinks:backlinks.rows,
        selfReported:{state:'proposed'},contentIsUntrusted:true};
    });
  }
  async tombstone(identity,noteId,{expectedRevision,proof,consolidateInto=null}){
    if(!uuid(noteId)||(consolidateInto!==null&&!uuid(consolidateInto))||!Number.isSafeInteger(expectedRevision))fail('INVALID_DELETION');
    return this.tx(async db=>{
      const p=await this.authorize(db,identity,'delete');
      const n=(await db.query('SELECT * FROM vault_notes WHERE owner_id=$1 AND note_id=$2 FOR UPDATE',[p.ownerId,noteId])).rows[0];
      if(!n)fail('NOT_FOUND',404);if(n.deleted_at){if(p.permissionEpoch!==undefined)await this.consumeProof(db,p,proof,(consolidateInto?'consolidate:':'delete:')+noteId,expectedRevision,{action:consolidateInto?'consolidate':'delete',intentHash:hash(JSON.stringify({noteId,expectedRevision,consolidateInto}))});return {noteId,tombstoned:true,replayed:true};}
      if(n.current_revision!==expectedRevision||n.published_revision!==expectedRevision)fail('REVISION_CONFLICT',409);
      if(consolidateInto){
        const target=(await db.query('SELECT * FROM vault_notes WHERE owner_id=$1 AND note_id=$2 AND deleted_at IS NULL AND published_revision>0',[p.ownerId,consolidateInto])).rows[0];
        if(!target||target.note_id===noteId)fail('INVALID_CONSOLIDATION');
      }
      await this.consumeProof(db,p,proof,(consolidateInto?'consolidate:':'delete:')+noteId,expectedRevision,{action:consolidateInto?'consolidate':'delete',intentHash:hash(JSON.stringify({noteId,expectedRevision,consolidateInto}))});
      await db.query('UPDATE vault_notes SET deleted_at=now(),trust=\'rejected\',consolidated_into=$3 WHERE owner_id=$1 AND note_id=$2',[p.ownerId,noteId,consolidateInto]);
      await db.query('DELETE FROM vault_search_documents WHERE note_id=$1',[noteId]);
      await db.query("UPDATE vault_outbox SET state='cancelled' WHERE note_id=$1 AND state='pending' AND operation='publish'",[noteId]);
      await db.query("INSERT INTO vault_outbox(event_id,owner_id,note_id,revision,operation) VALUES($1,$2,$3,$4,'delete') ON CONFLICT(note_id,revision,operation) DO NOTHING",[randomUUID(),p.ownerId,noteId,n.current_revision]);
      await this.audit(db,p,consolidateInto?'consolidate':'delete',noteId,'tombstoned');return {noteId,tombstoned:true,publication:'pending',replayed:false};
    });
  }
  async graph(identity,{focus=null,depth=1,limit=150,cursor=null}={}){
    if(![1,2,3].includes(depth)||!Number.isInteger(limit)||limit<1||limit>LIMITS.graphNodes)fail('INVALID_GRAPH_QUERY',400);
    if(!focus){
      const page=await this.list(identity,{limit:Math.min(limit,50),cursor});
      const edges=await this.tx(async db=>{const p=await this.authorize(db,identity,'read');
        return (await db.query(`SELECT e.source_id,e.target_id,e.relation_type,e.confidence,e.evidence_ordinal FROM vault_relations e
          JOIN vault_notes n ON n.note_id=e.source_id AND n.published_revision=e.source_revision
          WHERE e.owner_id=$1 AND e.source_id=ANY($2::uuid[]) AND e.target_id=ANY($2::uuid[]) ORDER BY e.source_id,e.target_id LIMIT 900`,[p.ownerId,page.items.map(n=>n.noteId)])).rows;
      });
      return {nodes:page.items,edges,nextCursor:page.nextCursor,partial:page.partial,reason:page.partial?'BOUNDED_OVERVIEW':undefined};
    }
    await this.get(identity,focus);
    return this.tx(async db=>{
      const p=await this.authorize(db,identity,'read'),ids=new Set([focus]);let frontier=[focus],truncated=false;
      // Iterative breadth-first search: no unbounded recursive CTE or cyclic expansion.
      for(let hop=0;hop<depth&&frontier.length;hop++){
        const r=await db.query(`SELECT e.source_id,e.target_id FROM vault_relations e
          JOIN vault_notes s ON s.note_id=e.source_id AND s.published_revision=e.source_revision
          JOIN vault_notes t ON t.note_id=e.target_id AND t.published_revision>0
          WHERE e.owner_id=$1 AND s.deleted_at IS NULL AND t.deleted_at IS NULL
          AND (cardinality($3::text[])=0 OR (s.note_type=ANY($3) AND t.note_type=ANY($3)))
          AND (e.source_id=ANY($2::uuid[]) OR e.target_id=ANY($2::uuid[])) ORDER BY e.source_id,e.target_id LIMIT 901`,[p.ownerId,frontier,types(p)]);
        truncated ||= r.rows.length>900;const next=[];
        for(const e of r.rows.slice(0,900))for(const id of [e.source_id,e.target_id])if(!ids.has(id)){if(ids.size>=limit){truncated=true;continue;}ids.add(id);next.push(id);}
        frontier=next;
      }
      const values=[...ids];
      const nodes=await db.query(`SELECT n.*,r.payload,r.verified_by,r.verified_at FROM vault_notes n JOIN vault_revisions r ON r.note_id=n.note_id AND r.revision=n.published_revision
        WHERE n.owner_id=$1 AND n.note_id=ANY($2::uuid[]) AND n.deleted_at IS NULL ORDER BY n.note_id`,[p.ownerId,values]);
      const edges=await db.query(`SELECT e.source_id,e.target_id,e.relation_type,e.confidence,e.evidence_ordinal,e.source_revision FROM vault_relations e
        JOIN vault_notes n ON n.note_id=e.source_id AND n.published_revision=e.source_revision
        WHERE e.owner_id=$1 AND e.source_id=ANY($2::uuid[]) AND e.target_id=ANY($2::uuid[]) ORDER BY e.source_id,e.target_id LIMIT 901`,[p.ownerId,values]);
      return {nodes:nodes.rows.map(summary),edges:edges.rows.slice(0,900),partial:truncated||edges.rows.length>900,nextCursor:null};
    });
  }
  async status(identity){
    return this.tx(async db=>{const p=await this.authorize(db,identity,'read');
      const r=await db.query(`SELECT o.state,count(*)::int AS count,max(o.committed_at) AS last_confirmed_at FROM vault_outbox o JOIN vault_notes n ON n.note_id=o.note_id
        WHERE o.owner_id=$1 AND (cardinality($2::text[])=0 OR n.note_type=ANY($2)) GROUP BY o.state`,[p.ownerId,types(p)]);
      return {publication:r.rows,confirmedAt:new Date().toISOString(),gateway:'internal-only',remoteSynchronization:false};
    });
  }
  /** Oldest-first live review queue. Immutable microsecond timestamp + UUID keyset;
   * refreshed traversal is required for older records entering a filtered state. */
  async proposals(identity,{limit=25,cursor=null,statuses=['proposed','conflict'],noteTypes=[]}={}){
    const filter=(values,allowed)=>{
      if(!Array.isArray(values)||values.length>allowed.length||values.some(v=>!allowed.includes(v)))fail('INVALID_QUERY',400);
      return [...new Set(values)].sort();
    };
    if(!Number.isInteger(limit)||limit<1||limit>LIMITS.page)fail('INVALID_LIMIT',400);
    const states=filter(statuses,['proposed','conflict','accepted','rejected']);
    const requestedTypes=filter(noteTypes,['fact','project','decision','reference']);
    if(!states.length)fail('INVALID_QUERY',400);
    return this.tx(async db=>{
      const p=await this.authorize(db,identity,'read');
      const scope=hash(JSON.stringify(['proposals-v1',p.ownerId,p.principalId,p.credentialHash,p.role,p.permissionEpoch??null,p.authorization?.sessionRef??null,p.authorization?.consentEpoch??null,[...p.scopes].sort(),states,requestedTypes,limit]));
      const after=this.decodeCursor(cursor,scope);
      if(after&&(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(after.at)||!Number.isFinite(Date.parse(after.at))))fail('INVALID_CURSOR',400);
      const result=await db.query(`SELECT proposal_id,note_id,principal_id,base_revision,payload,payload_hash,state,duplicate_of,created_at,
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
        FROM vault_proposals WHERE owner_id=$1 AND state=ANY($2::text[])
        AND NOT EXISTS(SELECT 1 FROM vault_notes withdrawn WHERE withdrawn.note_id=vault_proposals.note_id AND withdrawn.deleted_at IS NOT NULL)
        AND (cardinality($3::text[])=0 OR payload->>'type'=ANY($3))
        AND (cardinality($4::text[])=0 OR payload->>'type'=ANY($4))
        AND ($5::boolean OR principal_id=$6)
        AND ($7::uuid IS NULL OR (created_at,proposal_id)>($8::timestamptz,$7::uuid))
        ORDER BY created_at,proposal_id LIMIT $9`,
        [p.ownerId,states,types(p),requestedTypes,['owner','maintainer'].includes(p.role),p.principalId,after?.id??null,after?.at??null,limit+1]);
      // Large individual payloads must not make later reviews unreachable through a 413.
      const items=[];let bytes=2,last;
      for(const row of result.rows.slice(0,limit)){
        const {cursor_at,...item}=row,size=Buffer.byteLength(JSON.stringify(item))+1;
        if(bytes+size>LIMITS.response-4096)break;
        bytes+=size;items.push(item);last={id:row.proposal_id,at:cursor_at};
      }
      if(result.rows.length&&!items.length)fail('RESPONSE_BUDGET_EXCEEDED',413);
      const partial=result.rows.length>items.length;
      return {items,nextCursor:partial?this.encodeCursor({scope,...last,rank:0}):null,partial};
    });
  }
  async agents(identity){return this.tx(async db=>{const p=await this.authorize(db,identity,'read');if(p.role!=='owner')fail('ROLE_FORBIDDEN',403);return (await db.query('SELECT principal_id,display_name,kind,role,scopes,disabled_at FROM vault_principals WHERE owner_id=$1 ORDER BY principal_id LIMIT 50',[p.ownerId])).rows;});}
  async exportPage(identity,options){await this.tx(db=>this.authorize(db,identity,'export'));const page=await this.list(identity,{...options,limit:1});
    return {...page,items:await Promise.all(page.items.map(n=>this.get(identity,n.noteId)))};
  }
}
