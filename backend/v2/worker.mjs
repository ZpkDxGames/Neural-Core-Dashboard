import { randomUUID } from 'node:crypto';
import { BrainError,fail,hash,parseMarkdown,validateNote } from './note.mjs';

export class VaultWorker {
  constructor(engine,vault,{fault=async()=>{},retryDelayMs=1000,maxAttempts=5}={}){
    this.engine=engine;this.vault=vault;this.fault=fault;this.retryDelayMs=Math.max(0,Math.min(retryDelayMs,60000));this.maxAttempts=Math.max(1,Math.min(maxAttempts,5));
  }
  async once(){
    const candidate=(await this.engine.pool.query("SELECT note_id,event_id FROM vault_outbox WHERE state='pending' AND next_attempt_at<=now() ORDER BY next_attempt_at,event_id LIMIT 1")).rows[0];
    if(!candidate)return {state:'idle'};
    try{
      const result=await this.engine.tx(async db=>{
        // Consistent lock ordering: note -> event. Two workers cannot publish the same note concurrently.
        const n=(await db.query('SELECT * FROM vault_notes WHERE note_id=$1 FOR UPDATE SKIP LOCKED',[candidate.note_id])).rows[0];
        if(!n)return {state:'busy'};
        const event=(await db.query("SELECT * FROM vault_outbox WHERE event_id=$1 AND state='pending' AND next_attempt_at<=now() FOR UPDATE SKIP LOCKED",[candidate.event_id])).rows[0];
        if(!event)return {state:'busy'};
        if(event.operation==='publish'){
          if(n.deleted_at||n.current_revision!==event.revision){
            await db.query("UPDATE vault_outbox SET state='cancelled' WHERE event_id=$1",[event.event_id]);return {state:'cancelled'};
          }
          const r=(await db.query('SELECT * FROM vault_revisions WHERE note_id=$1 AND revision=$2',[n.note_id,event.revision])).rows[0];
          if(!r||hash(r.markdown)!==r.content_hash.trim())fail('REVISION_CORRUPT',409);
          parseMarkdown(r.markdown);
          const publishedHash=await this.vault.publish(n.owner_id,n.canonical_path,r.markdown,event.expected_hash?.trim()??null);
          await this.fault('before-acknowledge');
          await db.query('UPDATE vault_notes SET published_revision=$2,published_hash=$3,title=$4,note_type=$5,body_hash=$6,trust=$7,updated_at=now() WHERE note_id=$1',
            [n.note_id,event.revision,publishedHash,r.payload.title,r.payload.type,hash(r.payload.body),r.verified_by?'verified':'proposed']);
          await db.query(`INSERT INTO vault_search_documents(owner_id,note_id,revision,document) VALUES($1,$2,$3,
            setweight(to_tsvector('simple',$4),'A')||setweight(to_tsvector('simple',$5),'B'))
            ON CONFLICT(note_id) DO UPDATE SET revision=excluded.revision,document=excluded.document`,[n.owner_id,n.note_id,event.revision,r.payload.title+' '+r.payload.tags.join(' '),r.payload.body]);
        }else{
          // A tombstone wins over every queued rewrite. A changed external file is kept for review.
          if(!n.deleted_at)fail('TOMBSTONE_REQUIRED',409);
          let expected=event.expected_hash?.trim()??n.published_hash?.trim()??null;
          const current=await this.vault.read(n.owner_id,n.canonical_path);
          if(current&&current.hash!==expected){
            const pending=(await db.query('SELECT content_hash FROM vault_revisions WHERE note_id=$1 AND revision=$2',[n.note_id,n.current_revision])).rows[0];
            if(current.hash===pending?.content_hash?.trim())expected=current.hash;
          }
          await this.vault.remove(n.owner_id,n.canonical_path,expected);
          await db.query('DELETE FROM vault_search_documents WHERE note_id=$1',[n.note_id]);
        }
        await db.query("UPDATE vault_outbox SET state='committed',committed_at=now(),error_code=NULL WHERE event_id=$1",[event.event_id]);
        await db.query('INSERT INTO vault_actions(action_id,owner_id,action,target_id,outcome) VALUES($1,$2,$3,$4,$5)',[randomUUID(),n.owner_id,event.operation,n.note_id,'committed']);
        return {state:'committed',eventId:event.event_id};
      });
      await this.fault('after-commit');return result;
    }catch(e){
      const conflict=e instanceof BrainError&&e.status===409;
      const code=e instanceof BrainError?e.code:'PUBLICATION_INTERRUPTED';
      const updated=await this.engine.pool.query(`UPDATE vault_outbox SET attempts=attempts+1,error_code=$2,
        state=CASE WHEN $3 THEN 'conflict' WHEN attempts+1>=$4 THEN 'failed' ELSE 'pending' END,
        next_attempt_at=now()+($5::text||' milliseconds')::interval WHERE event_id=$1 AND state='pending' RETURNING state`,[candidate.event_id,code,conflict,this.maxAttempts,this.retryDelayMs]);
      const state=updated.rows[0]?.state??(await this.engine.pool.query('SELECT state FROM vault_outbox WHERE event_id=$1',[candidate.event_id])).rows[0]?.state;
      return {state:state==='pending'?'retry':state,code,eventId:candidate.event_id};
    }
  }
  async batch({limit=16,signal}={}){
    if(!Number.isInteger(limit)||limit<1||limit>100)fail('INVALID_BATCH');
    const results=[];
    for(let i=0;i<limit&&!signal?.aborted;i++){
      const result=await this.once();results.push(result);if(['idle','busy','retry'].includes(result.state))break;
    }
    return results;
  }
  async recordExternal(db,ownerId,fileName,observedHash,code,noteId=null,proposalId=null){
    await db.query(`INSERT INTO vault_external_edits(edit_id,owner_id,note_id,file_name,observed_hash,code,proposal_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner_id,file_name,observed_hash,code) DO NOTHING`,[randomUUID(),ownerId,noteId,fileName,observedHash,code,proposalId]);
    return {code,noteId,proposalId};
  }
  async reconcile(identity,fileName){
    const file=await this.vault.read(identity.ownerId,fileName);
    return this.engine.tx(async db=>{
      const p=await this.engine.authorize(db,identity,'review');
      if(!file){
        const n=(await db.query('SELECT note_id FROM vault_notes WHERE owner_id=$1 AND canonical_path=$2 AND deleted_at IS NULL',[p.ownerId,fileName])).rows[0];
        return this.recordExternal(db,p.ownerId,fileName,hash('missing'),'FILE_MISSING',n?.note_id??null);
      }
      let parsed;
      try{parsed=parseMarkdown(file.text);}catch(e){return this.recordExternal(db,p.ownerId,fileName,file.hash,e instanceof BrainError?e.code:'INVALID_MARKDOWN');}
      const n=(await db.query('SELECT * FROM vault_notes WHERE owner_id=$1 AND note_id=$2 FOR UPDATE',[p.ownerId,parsed.meta.note_id])).rows[0];
      if(!n)return this.recordExternal(db,p.ownerId,fileName,file.hash,'ORPHAN_FILE');
      if(n.deleted_at)return this.recordExternal(db,p.ownerId,fileName,file.hash,'TOMBSTONED_FILE',n.note_id);
      if(n.canonical_path!==fileName)return this.recordExternal(db,p.ownerId,fileName,file.hash,'RENAMED_FILE',n.note_id);
      if(n.published_hash?.trim()===file.hash)return {code:'UNCHANGED',noteId:n.note_id};
      const pending=(await db.query('SELECT content_hash FROM vault_revisions WHERE note_id=$1 AND revision=$2',[n.note_id,n.current_revision])).rows[0];
      if(pending?.content_hash.trim()===file.hash)return {code:'AWAITING_REPLAY',noteId:n.note_id};
      if(parsed.meta.revision!==n.published_revision)return this.recordExternal(db,p.ownerId,fileName,file.hash,'EXTERNAL_STALE_REVISION',n.note_id);
      const prior=(await db.query('SELECT * FROM vault_external_edits WHERE owner_id=$1 AND file_name=$2 AND observed_hash=$3 AND proposal_id IS NOT NULL',[p.ownerId,fileName,file.hash])).rows[0];
      if(prior)return {code:prior.code,noteId:n.note_id,proposalId:prior.proposal_id};
      const published=(await db.query('SELECT payload FROM vault_revisions WHERE note_id=$1 AND revision=$2',[n.note_id,n.published_revision])).rows[0];
      // File metadata cannot grant trust, forge evidence or add relationships. Only its body is proposed.
      const payload=validateNote({...published.payload,body:parsed.body});
      const proposalId=randomUUID();
      await db.query(`INSERT INTO vault_proposals(proposal_id,owner_id,note_id,principal_id,base_revision,payload,payload_hash,idempotency_key,expected_file_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[proposalId,p.ownerId,n.note_id,p.principalId,n.current_revision,JSON.stringify(payload),hash(JSON.stringify(payload)),'external_'+file.hash,file.hash]);
      return this.recordExternal(db,p.ownerId,fileName,file.hash,'EXTERNAL_EDIT_REVIEW',n.note_id,proposalId);
    });
  }
  async repair(identity,eventId,{expectedRevision,proof}){
    return this.engine.tx(async db=>{
      const p=await this.engine.authorize(db,identity,'review');
      const event=(await db.query('SELECT * FROM vault_outbox WHERE owner_id=$1 AND event_id=$2',[p.ownerId,eventId])).rows[0];
      if(!event)fail('NOT_FOUND',404);
      const n=(await db.query('SELECT * FROM vault_notes WHERE note_id=$1 FOR UPDATE',[event.note_id])).rows[0];
      const locked=(await db.query('SELECT * FROM vault_outbox WHERE event_id=$1 FOR UPDATE',[eventId])).rows[0];
      if(n.current_revision!==expectedRevision||!['failed','conflict'].includes(locked.state))fail('REVISION_CONFLICT',409);
      await this.engine.consumeProof(db,p,proof,'repair:'+eventId,expectedRevision);
      const file=await this.vault.read(p.ownerId,n.canonical_path);
      if(file&&file.hash!==n.published_hash?.trim()){
        const desired=(await db.query('SELECT content_hash FROM vault_revisions WHERE note_id=$1 AND revision=$2',[n.note_id,n.current_revision])).rows[0]?.content_hash.trim();
        if(file.hash!==desired)fail('EXTERNAL_REVIEW_REQUIRED',409);
      }
      await db.query("UPDATE vault_outbox SET state='pending',attempts=0,next_attempt_at=now(),expected_hash=$2,error_code=NULL WHERE event_id=$1",[eventId,file?.hash??null]);
      await this.engine.audit(db,p,'repair',eventId,'pending');return {eventId,state:'pending'};
    });
  }
  async rebuildIndex(identity,{limit=50,cursor=null}={}){
    if(!Number.isInteger(limit)||limit<1||limit>50)fail('INVALID_LIMIT');
    return this.engine.tx(async db=>{
      const p=await this.engine.authorize(db,identity,'review');
      const rows=await db.query(`SELECT n.note_id,n.published_revision,r.payload FROM vault_notes n JOIN vault_revisions r ON r.note_id=n.note_id AND r.revision=n.published_revision
        WHERE n.owner_id=$1 AND n.deleted_at IS NULL AND ($2::uuid IS NULL OR n.note_id>$2) ORDER BY n.note_id LIMIT $3`,[p.ownerId,cursor,limit+1]);
      for(const n of rows.rows.slice(0,limit))await db.query(`INSERT INTO vault_search_documents(owner_id,note_id,revision,document) VALUES($1,$2,$3,setweight(to_tsvector('simple',$4),'A')||setweight(to_tsvector('simple',$5),'B'))
        ON CONFLICT(note_id) DO UPDATE SET revision=excluded.revision,document=excluded.document`,[p.ownerId,n.note_id,n.published_revision,n.payload.title+' '+n.payload.tags.join(' '),n.payload.body]);
      await db.query('DELETE FROM vault_search_documents s USING vault_notes n WHERE s.note_id=n.note_id AND n.owner_id=$1 AND n.deleted_at IS NOT NULL',[p.ownerId]);
      return {indexed:Math.min(rows.rows.length,limit),nextCursor:rows.rows.length>limit?rows.rows[limit-1].note_id:null};
    });
  }
}
