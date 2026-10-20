import { hash,fail } from './note.mjs';
/** Offline validation utility, not a backup scheduler. Caller must quiesce writes and
 * pair this with a real database snapshot. No personal content enters the manifest. */
export async function checkpoint(engine,vault,identity,{snapshotId,quiesced=false}={}){
  if(!quiesced||typeof snapshotId!=='string'||!/^[A-Za-z0-9_-]{8,120}$/.test(snapshotId))fail('QUIESCED_SNAPSHOT_REQUIRED');
  const notes=[];let cursor=null;
  do{
    const page=await engine.list(identity,{limit:50,cursor});
    for(const note of page.items){
      const file=await vault.read(identity.ownerId,note.noteId+'.md');
      if(note.pending||!file||file.hash!==note.publishedHash)fail('INCONSISTENT_CHECKPOINT',409);
      notes.push({noteId:note.noteId,revision:note.revision,hash:note.publishedHash});
    }
    cursor=page.nextCursor;
  }while(cursor);
  const known=new Set(notes.map(n=>n.noteId+'.md'));let fileCursor='';
  do{const page=await vault.list(identity.ownerId,fileCursor,100);
    if(page.files.some(name=>!known.has(name)))fail('INCONSISTENT_CHECKPOINT',409);
    fileCursor=page.nextCursor;
  }while(fileCursor);
  const metadata=await engine.tx(async db=>{const p=await engine.authorize(db,identity,'export');
    const pending=(await db.query("SELECT count(*)::int AS n FROM vault_outbox WHERE owner_id=$1 AND state IN ('pending','conflict','failed')",[p.ownerId])).rows[0].n;
    if(pending)fail('UNRESOLVED_PUBLICATIONS',409);
    return {tombstones:(await db.query('SELECT note_id,current_revision FROM vault_notes WHERE owner_id=$1 AND deleted_at IS NOT NULL ORDER BY note_id',[p.ownerId])).rows};
  });
  const manifest={schemaVersion:3,snapshotId,notes,...metadata};
  return {...manifest,sha256:hash(JSON.stringify(manifest))};
}
export function verifyCheckpoint(actual,expected){
  const {sha256,...body}=actual;
  if(hash(JSON.stringify(body))!==sha256||actual.snapshotId!==expected.snapshotId||actual.sha256!==expected.sha256)fail('CHECKPOINT_MISMATCH',409);
  return true;
}
