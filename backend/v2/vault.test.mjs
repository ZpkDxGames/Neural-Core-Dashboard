import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,symlink,link,writeFile,chmod} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {FileVault} from './vault.mjs';import {hash} from './note.mjs';
const name='550e8400-e29b-41d4-a716-446655440000.md';
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'synthetic-vault-'));try{const vault=new FileVault(root);await vault.initialise();await fn(vault,root);}finally{await rm(root,{recursive:true,force:true});}}
test('atomic publication, idempotent replay, and tombstone deletion',()=>fixture(async vault=>{
  await vault.publish('synthetic',name,'Synthetic first\n',null);assert.equal((await vault.read('synthetic',name)).hash,hash('Synthetic first\n'));
  await vault.publish('synthetic',name,'Synthetic first\n',null);
  await assert.rejects(()=>vault.publish('synthetic',name,'Changed\n',hash('wrong')),e=>e.code==='EXTERNAL_EDIT_CONFLICT');
  await vault.remove('synthetic',name,hash('Synthetic first\n'));assert.equal(await vault.read('synthetic',name),null);
}));
test('path traversal, symlinks, hardlinks, modes and invalid UTF-8 fail closed',()=>fixture(async(vault,root)=>{
  for(const unsafe of ['../private.md','/private.md','.private.md','CON.md','a/b.md'])await assert.rejects(()=>vault.read('synthetic',unsafe));
  const directory=await vault.directory('synthetic');await writeFile(join(root,'outside'),'Synthetic',{mode:0o600});
  await symlink(join(root,'outside'),join(directory,'symlink.md'));await assert.rejects(()=>vault.read('synthetic','symlink.md'));
  await link(join(root,'outside'),join(directory,'hardlink.md'));await assert.rejects(()=>vault.read('synthetic','hardlink.md'));
  await writeFile(join(directory,name),Buffer.from([0xff]),{mode:0o600});await assert.rejects(()=>vault.read('synthetic',name),e=>e.code==='INVALID_UTF8');
  await chmod(join(directory,name),0o644);await assert.rejects(()=>vault.read('synthetic',name),e=>e.code==='UNSAFE_FILE');
}));
test('crashes before/after rename are replayable without duplicate files',()=>fixture(async(vault,root)=>{
  for(const stage of ['before-rename','after-rename']){
    let once=true;const worker=new FileVault(root,{fault:async at=>{if(at===stage&&once){once=false;throw Error('Synthetic crash');}}});
    const target=stage+'.md';await assert.rejects(()=>worker.publish('synthetic',target,'Synthetic\n',null));
    await worker.publish('synthetic',target,'Synthetic\n',null);assert.equal((await worker.read('synthetic',target)).text,'Synthetic\n');
  }
  const list=await vault.list('synthetic','',1);assert.equal(list.files.length,1);assert.ok(list.nextCursor);
}));

test('offline inventory is deterministic, single-walk and enforces quiescence, names and memory budgets',()=>fixture(async(vault)=>{
  const dir=await vault.directory('synthetic');
  for(const file of ['Z.md','A.md','M.md'])await writeFile(join(dir,file),'Synthetic',{mode:0o600});
  const inventory=await vault.inventory('synthetic',{quiesced:true});assert.deepEqual(inventory.files,['A.md','M.md','Z.md']);assert.equal(inventory.scanned,3);
  await assert.rejects(()=>vault.inventory('synthetic'),e=>e.code==='QUIESCED_SNAPSHOT_REQUIRED');
  await assert.rejects(()=>vault.inventory('synthetic',{quiesced:true,maxEntries:2}),e=>e.code==='CHECKPOINT_ENTRY_BUDGET');
  await assert.rejects(()=>vault.inventory('synthetic',{quiesced:true,maxNameBytes:10}),e=>e.code==='CHECKPOINT_MEMORY_BUDGET');
  await assert.rejects(()=>vault.inventory('synthetic',{quiesced:true,maxEntries:100000}),e=>e.code==='INVALID_INVENTORY_BUDGET');
  await writeFile(join(dir,'.publish-synthetic.tmp'),'Synthetic',{mode:0o600});
  await assert.rejects(()=>vault.inventory('synthetic',{quiesced:true}),e=>e.code==='VAULT_NOT_QUIESCENT');
}));
test('offline inventory rejects unsafe Markdown entries and detects directory drift',()=>fixture(async(vault,root)=>{
  const dir=await vault.directory('synthetic');await writeFile(join(root,'outside'),'Synthetic',{mode:0o600});
  await symlink(join(root,'outside'),join(dir,'unsafe.md'));
  await assert.rejects(()=>vault.inventory('synthetic',{quiesced:true}),e=>e.code==='UNSAFE_FILE');await rm(join(dir,'unsafe.md'));
  const original=vault.inventoryStamp.bind(vault);let calls=0;
  vault.inventoryStamp=async ownerId=>{const stamp=await original(ownerId);return ++calls===1?stamp:stamp+'-changed';};
  await assert.rejects(()=>vault.inventory('synthetic',{quiesced:true}),e=>e.code==='VAULT_NOT_QUIESCENT');
}));
