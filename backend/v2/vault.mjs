import { constants } from 'node:fs';
import { lstat,realpath,mkdir,open,rename,unlink,opendir } from 'node:fs/promises';
import { resolve,join,isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrainError,fail,hash,LIMITS } from './note.mjs';

const fileName=name=>{
  if(typeof name!=='string'||name.length>160||!/^[a-zA-Z0-9][a-zA-Z0-9 _-]*\.md$/.test(name)||/^(con|prn|aux|nul|com\d|lpt\d)\./i.test(name))fail('UNSAFE_PATH');
  return name;
};
async function syncDirectory(path){const fd=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await fd.sync();}finally{await fd.close();}}
/** Dedicated private root. No watchers, executables, plugins or network activity.
 * Threat model: the vault directory belongs exclusively to this process/owner.
 * An adversary able to replace directory ancestors as the service OS user is out of scope. */
export class FileVault {
  constructor(root,{fault=async()=>{}}={}){
    if(!isAbsolute(root)||resolve(root)!==root)fail('UNSAFE_ROOT');
    this.root=root;this.fault=fault;
  }
  async initialise(){
    await mkdir(this.root,{recursive:true,mode:0o700});
    if(await realpath(this.root)!==this.root)fail('SYMLINK_ROOT');
    const stat=await lstat(this.root);
    if(!stat.isDirectory()||(stat.mode&0o077)!==0)fail('INSECURE_ROOT_MODE');
  }
  async directory(ownerId){
    if(typeof ownerId!=='string'||!ownerId||ownerId.length>120)fail('INVALID_OWNER');
    const directory=join(this.root,hash(ownerId).slice(0,32));
    await mkdir(directory,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    const stat=await lstat(directory);
    if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)fail('UNSAFE_DIRECTORY');
    return directory;
  }
  async read(ownerId,name){
    const directory=await this.directory(ownerId),path=join(directory,fileName(name));let fd;
    try{
      fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
      const stat=await fd.stat();
      if(!stat.isFile()||stat.nlink!==1||stat.size>LIMITS.file||(stat.mode&0o077)!==0)fail('UNSAFE_FILE');
      const bytes=await fd.readFile();
      if(bytes.length>LIMITS.file)fail('PAYLOAD_TOO_LARGE',413);
      let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('INVALID_UTF8');}
      return {text,hash:hash(text)};
    }catch(e){if(e.code==='ENOENT')return null;if(e.code==='ELOOP')fail('SYMLINK_FILE');throw e;}
    finally{await fd?.close();}
  }
  async publish(ownerId,name,text,expectedHash){
    if(Buffer.byteLength(text)>LIMITS.file)fail('PAYLOAD_TOO_LARGE',413);
    const desired=hash(text),before=await this.read(ownerId,name);
    if(before?.hash===desired)return desired; // crash after rename, before SQL acknowledgement
    if((before?.hash??null)!==expectedHash)fail('EXTERNAL_EDIT_CONFLICT',409);
    const directory=await this.directory(ownerId),temp=join(directory,'.publish-'+randomUUID()+'.tmp');let fd;
    try{
      fd=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      await fd.writeFile(text,'utf8');await fd.sync();await fd.close();fd=null;
      await this.fault('before-rename');
      // Recheck immediately before rename; external editors must reconcile, never last-write-win.
      if(((await this.read(ownerId,name))?.hash??null)!==expectedHash)fail('EXTERNAL_EDIT_CONFLICT',409);
      await rename(temp,join(directory,fileName(name)));await syncDirectory(directory);
      await this.fault('after-rename');
      return desired;
    }finally{await fd?.close();await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  }
  async remove(ownerId,name,expectedHash){
    const before=await this.read(ownerId,name);if(!before)return;
    if(before.hash!==expectedHash)fail('EXTERNAL_EDIT_CONFLICT',409);
    const directory=await this.directory(ownerId);await unlink(join(directory,fileName(name)));await syncDirectory(directory);
  }
  /** Offline, one-walk inventory. Intentionally refuses >10k directory entries.
   * This bounded in-memory sort is not a 100k streaming checkpoint implementation. */
  async inventory(ownerId,{quiesced=false,maxEntries=10000,maxNameBytes=4*1024*1024}={}){
    if(quiesced!==true)fail('QUIESCED_SNAPSHOT_REQUIRED');
    if(!Number.isInteger(maxEntries)||maxEntries<1||maxEntries>10000||!Number.isInteger(maxNameBytes)||maxNameBytes<1||maxNameBytes>4*1024*1024)fail('INVALID_INVENTORY_BUDGET');
    const directory=await this.directory(ownerId),before=await this.inventoryStamp(ownerId),dir=await opendir(directory);
    const files=[];let scanned=0,estimatedBytes=0;
    for await(const entry of dir){
      if(++scanned>maxEntries)fail('CHECKPOINT_ENTRY_BUDGET',413);
      if(/^\.publish-/.test(entry.name))fail('VAULT_NOT_QUIESCENT',409);
      if(!entry.name.endsWith('.md'))continue;
      fileName(entry.name);
      if(!entry.isFile()||entry.isSymbolicLink())fail('UNSAFE_FILE');
      estimatedBytes+=Buffer.byteLength(entry.name)*2+64;
      if(estimatedBytes>maxNameBytes)fail('CHECKPOINT_MEMORY_BUDGET',413);
      files.push(entry.name);
    }
    const stamp=await this.inventoryStamp(ownerId);
    if(stamp!==before)fail('VAULT_NOT_QUIESCENT',409);
    return {files:files.sort(),stamp,scanned,estimatedNameBytes:estimatedBytes};
  }
  async inventoryStamp(ownerId){
    const stat=await lstat(await this.directory(ownerId),{bigint:true});
    return [stat.dev,stat.ino,stat.mtimeNs,stat.ctimeNs].join(':');
  }
  async list(ownerId,after='',limit=50){
    if(!Number.isInteger(limit)||limit<1||limit>100)fail('INVALID_LIMIT');
    const directory=await this.directory(ownerId),dir=await opendir(directory);
    // Bounded memory top-K selection, including when directory order is not lexical.
    const selected=[];let scanned=0;
    for await(const entry of dir){
      if(++scanned>100000)fail('DIRECTORY_SCAN_BUDGET',413);
      if(!entry.name.endsWith('.md')||entry.name<=after)continue;
      fileName(entry.name);
      if(entry.isSymbolicLink()||!entry.isFile())fail('UNSAFE_FILE');
      selected.push(entry.name);selected.sort();if(selected.length>limit+1)selected.pop();
    }
    return {files:selected.slice(0,limit),nextCursor:selected.length>limit?selected[limit-1]:null};
  }
  async cleanTemporary(ownerId,{olderThanMs=3600000,limit=16,now=Date.now()}={}){
    const directory=await this.directory(ownerId),dir=await opendir(directory);let removed=0;
    for await(const entry of dir){
      if(removed>=limit)break;
      if(!/^\.publish-[a-f0-9-]{36}\.tmp$/.test(entry.name))continue;
      const path=join(directory,entry.name),stat=await lstat(path);
      if(stat.isFile()&&stat.nlink===1&&now-stat.mtimeMs>olderThanMs){await unlink(path);removed++;}
    }
    return {removed};
  }
}
