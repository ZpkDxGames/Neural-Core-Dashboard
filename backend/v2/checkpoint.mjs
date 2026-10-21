import { hash,fail,uuid } from './note.mjs';
export const CHECKPOINT_LIMITS=Object.freeze({entries:10000,manifestBytes:4*1024*1024});
/** Offline validation, NOT a backup scheduler or write lock. quiesced=true attests
 * that the operator stopped every SQL/vault writer and editor for the entire run.
 * Drift checks fail closed but cannot detect an in-place edit after its hash read.
 * 100k certification is blocked until a measured streaming snapshot replaces this cap. */
export async function checkpoint(engine,vault,identity,{snapshotId,quiesced=false}={}){
  if(quiesced!==true||typeof snapshotId!=='string'||!/^[A-Za-z0-9_-]{8,120}$/.test(snapshotId))fail('QUIESCED_SNAPSHOT_REQUIRED');
  const snapshot=()=>engine.tx(async db=>{
    const p=await engine.authorize(db,identity,'export');
    if(p.scopes.some(s=>s.startsWith('type:')))fail('FULL_VAULT_SCOPE_REQUIRED',403);
    const unresolved=await db.query("SELECT 1 FROM vault_outbox WHERE owner_id=$1 AND state IN ('pending','conflict','failed') LIMIT 1",[p.ownerId]);
    if(unresolved.rows.length)fail('UNRESOLVED_PUBLICATIONS',409);
    return (await db.query(`SELECT note_id,canonical_path,current_revision,published_revision,published_hash,deleted_at
      FROM vault_notes WHERE owner_id=$1 ORDER BY note_id LIMIT $2`,[p.ownerId,CHECKPOINT_LIMITS.entries+1])).rows;
  });
  const rows=await snapshot();
  if(rows.length>CHECKPOINT_LIMITS.entries)fail('CHECKPOINT_ENTRY_BUDGET',413);
  const inventory=await vault.inventory(identity.ownerId,{quiesced:true});
  const known=new Set(inventory.files),notes=[],tombstones=[];
  for(const n of rows){
    if(!uuid(n.note_id)||n.canonical_path!==n.note_id+'.md')fail('INCONSISTENT_CHECKPOINT',409);
    if(n.deleted_at){
      if(known.has(n.canonical_path))fail('TOMBSTONED_FILE',409);
      tombstones.push({note_id:n.note_id,current_revision:n.current_revision});continue;
    }
    if(!known.delete(n.canonical_path)||!n.published_revision||n.current_revision!==n.published_revision)fail('INCONSISTENT_CHECKPOINT',409);
    const file=await vault.read(identity.ownerId,n.canonical_path);
    if(!file||file.hash!==n.published_hash?.trim())fail('INCONSISTENT_CHECKPOINT',409);
    notes.push({noteId:n.note_id,revision:n.published_revision,hash:file.hash});
  }
  if(known.size)fail('INCONSISTENT_CHECKPOINT',409);
  if(await vault.inventoryStamp(identity.ownerId)!==inventory.stamp||JSON.stringify(await snapshot())!==JSON.stringify(rows))fail('VAULT_NOT_QUIESCENT',409);
  const manifest={schemaVersion:3,snapshotId,notes,tombstones};
  if(Buffer.byteLength(JSON.stringify(manifest))>CHECKPOINT_LIMITS.manifestBytes)fail('CHECKPOINT_MEMORY_BUDGET',413);
  return {...manifest,sha256:hash(JSON.stringify(manifest))};
}
export function verifyCheckpoint(actual,expected){
  if(!actual||actual.schemaVersion!==3||!Array.isArray(actual.notes)||!Array.isArray(actual.tombstones)||
    actual.notes.length+actual.tombstones.length>CHECKPOINT_LIMITS.entries||Buffer.byteLength(JSON.stringify(actual))>CHECKPOINT_LIMITS.manifestBytes)fail('CHECKPOINT_MISMATCH',409);
  const live=actual.notes.map(n=>n.noteId),dead=actual.tombstones.map(n=>n.note_id),ids=[...live,...dead];
  if(ids.some(id=>!uuid(id))||new Set(ids).size!==ids.length||
    live.some((id,i)=>i&&id<=live[i-1])||dead.some((id,i)=>i&&id<=dead[i-1])||
    actual.notes.some(n=>!Number.isSafeInteger(n.revision)||n.revision<1||!/^[a-f0-9]{64}$/.test(n.hash))||
    actual.tombstones.some(n=>!Number.isSafeInteger(n.current_revision)||n.current_revision<0))fail('CHECKPOINT_MISMATCH',409);
  const {sha256,...body}=actual;
  if(hash(JSON.stringify(body))!==sha256||actual.snapshotId!==expected.snapshotId||actual.sha256!==expected.sha256)fail('CHECKPOINT_MISMATCH',409);
  return true;
}
