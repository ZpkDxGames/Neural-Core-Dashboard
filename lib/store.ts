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
