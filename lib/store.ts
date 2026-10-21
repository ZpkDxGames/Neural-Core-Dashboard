import type { Conversation } from './types';
const DB_NAME = 'neural-core-local-v1';
const STORE = 'conversations';
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
export async function saveConversations(conversations: Conversation[]): Promise<number> {
  const db=await openDB();
  try {
    return await new Promise<number>((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'); const store=tx.objectStore(STORE);
      for(const c of conversations)store.put(c);
      tx.oncomplete=()=>resolve(conversations.length);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  } finally { db.close(); }
}
export async function readConversations(limit=1500): Promise<{items: Conversation[]; total: number}> {
  const db=await openDB();
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly');const store=tx.objectStore(STORE);
      const items: Conversation[]=[]; let total=0;
      const request=store.openCursor();
      request.onsuccess=()=>{
        const c=request.result;
        if(c){total++;if(items.length<limit)items.push(c.value as Conversation);c.continue();}
        else resolve({items,total});
      };
      request.onerror=()=>reject(request.error);
    });
  } finally {db.close();}
}
export async function clearLocalConversations(): Promise<void> {
  const db=await openDB();
  try {await new Promise<void>((resolve,reject)=>{const t=db.transaction(STORE,'readwrite');t.objectStore(STORE).clear();t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);});}
  finally {db.close();}
}
/** Additive operation; same database/schema and transaction ownership as existing imports.
 * Count and deletion share one write transaction, including across browser tabs. */
export async function deleteLocalConversations(ids: string[]|null):Promise<number>{
  if(ids&&ids.length>50)throw Error('Deletion selection exceeds 50 records');
  const db=await openDB();
  try{return await new Promise<number>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);let count=0;
    if(ids===null){const req=store.count();req.onsuccess=()=>{count=req.result;store.clear();};}
    else for(const id of new Set(ids)){const req=store.getKey(id);req.onsuccess=()=>{if(req.result!==undefined){count++;store.delete(id);}};}
    tx.oncomplete=()=>resolve(count);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
}
/** Bounded presentation read. count() covers the whole archive; values stop at
 * the record/heap budget instead of scanning or retaining an unbounded archive. */
export async function readConversationWindow(maxRecords=50000,maxBytes=32*1024*1024):Promise<{items:Conversation[];total:number}>{
  const db=await openDB();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readonly'),store=tx.objectStore(STORE),items:Conversation[]=[];let total=0,bytes=0;
    const count=store.count();count.onsuccess=()=>{total=count.result;};
    const cursor=store.openCursor();cursor.onsuccess=()=>{const current=cursor.result;if(!current)return;const c=current.value as Conversation;
      const estimate=256+2*(c.id.length+c.title.length)+c.messages.reduce((n,m)=>n+256+2*m.text.length,0);
      if(items.length>=maxRecords||bytes+estimate>maxBytes)return;
      items.push(c);bytes+=estimate;current.continue();
    };
    tx.oncomplete=()=>resolve({items,total});tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
}
