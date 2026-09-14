
const DB_NAME='knowledge-studio'; const DB_VERSION=4;
let dbp;
export function uid(prefix='id'){return `${prefix}-${crypto.randomUUID()}`}
export function now(){return Date.now()}
export const STORES=['courses','lessons','topics','documents','assets','pdfSources','sourceAnchors','favorites','recent','trash','settings','revisions'];
export const LIBRARY_STORES=STORES.filter(n=>n!=='assets');
export async function db(){
 if(dbp)return dbp;
 dbp=new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB_NAME,DB_VERSION);
  request.onupgradeneeded=()=>{for(const name of STORES)if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'id'});};
  request.onblocked=()=>globalThis.dispatchEvent?.(new CustomEvent('ks-storage-blocked'));
  request.onerror=()=>{dbp=null;reject(request.error)};
  request.onsuccess=()=>{
   const connection=request.result;
   connection.onversionchange=()=>{connection.close();dbp=null;globalThis.dispatchEvent?.(new CustomEvent('ks-storage-versionchange'))};
   connection.onclose=()=>{dbp=null};
   if(STORES.some(name=>!connection.objectStoreNames.contains(name))){connection.close();dbp=null;reject(new Error('Неполная структура базы. Существующие данные сохранены.'));return;}
   resolve(connection);
  };
 });
 return dbp;
}
// Enqueue every request synchronously: IndexedDB aborts the whole operation on failure.
export async function commit(changes,{replace=false}={}){
 const names=Object.keys(changes);if(!names.length)return;
 for(const name of names){if(!STORES.includes(name)||!Array.isArray(changes[name]))throw new Error('Некорректная операция хранения');}
 const connection=await db();
 return new Promise((resolve,reject)=>{
  const transaction=connection.transaction(names,'readwrite');
  transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(transaction.error||new Error('Запись отменена'));transaction.onerror=()=>{};
  try{for(const name of names){const store=transaction.objectStore(name);if(replace)store.clear();for(const row of changes[name])store.put(row);}}
  catch(error){transaction.abort();reject(error);}
 });
}
export async function readSnapshot(names=STORES){
 const connection=await db();return new Promise((resolve,reject)=>{
  const transaction=connection.transaction(names,'readonly'),result={};
  transaction.oncomplete=()=>resolve(result);transaction.onabort=()=>reject(transaction.error||new Error('Чтение отменено'));
  for(const name of names){const request=transaction.objectStore(name).getAll();request.onsuccess=()=>result[name]=request.result;}
 });
}
export async function get(store,id){const d=await db();return new Promise((res,rej)=>{const r=d.transaction(store).objectStore(store).get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
export async function all(store){const d=await db();return new Promise((res,rej)=>{const r=d.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
export async function put(store,val){const d=await db();return new Promise((res,rej)=>{const t=d.transaction(store,'readwrite');t.objectStore(store).put(val);t.oncomplete=()=>res(val);t.onabort=()=>rej(t.error||new Error('Запись отменена'));t.onerror=()=>{}})}
export async function del(store,id){const d=await db();return new Promise((res,rej)=>{const t=d.transaction(store,'readwrite');t.objectStore(store).delete(id);t.oncomplete=res;t.onabort=()=>rej(t.error||new Error('Запись отменена'));t.onerror=()=>{}})}
export async function bulkPut(store,vals){if(!vals.length)return;const d=await db();return new Promise((res,rej)=>{const t=d.transaction(store,'readwrite');const os=t.objectStore(store);for(const v of vals)os.put(v);t.oncomplete=res;t.onabort=()=>rej(t.error||new Error('Запись отменена'));t.onerror=()=>{}})}
export async function clear(store){const d=await db();return new Promise((res,rej)=>{const t=d.transaction(store,'readwrite');t.objectStore(store).clear();t.oncomplete=res;t.onabort=()=>rej(t.error||new Error('Запись отменена'));t.onerror=()=>{}})}
export async function setting(id,fallback){return (await get('settings',id))?.value ?? fallback}
export async function setSetting(id,value){return put('settings',{id,value,updatedAt:now()})}
export async function saveBlob(assetId,blob){
 const previous=await get('assets',assetId);
 // Immutable OPFS names prevent a failed overwrite from damaging the existing original.
 if(navigator.storage?.getDirectory){
  const path=uid('binary');let dir,writer;
  try{
   const root=await navigator.storage.getDirectory();dir=await root.getDirectoryHandle('knowledge-studio',{create:true});
   const file=await dir.getFileHandle(path,{create:true});writer=await file.createWritable();
   await writer.write(blob);await writer.close();
   await put('assets',{...previous,id:assetId,backend:'opfs',path,blob:undefined,mime:blob.type,byteSize:blob.size,createdAt:previous?.createdAt||now()});
   return {backend:'opfs',path};
  }catch(error){await writer?.abort().catch(()=>{});await dir?.removeEntry(path).catch(()=>{});if(error.name==='QuotaExceededError')throw error;}
 }
 await put('assets',{...previous,id:assetId,backend:'idb',path:assetId,blob,mime:blob.type,byteSize:blob.size,createdAt:previous?.createdAt||now()});
 return {backend:'idb',path:assetId};
}
export async function loadBlob(assetId,snapshotAsset){
 const asset=snapshotAsset===undefined?await get('assets',assetId):snapshotAsset;if(asset?.blob instanceof Blob)return asset.blob;
 if(navigator.storage?.getDirectory){try{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('knowledge-studio');return await (await dir.getFileHandle(asset?.path||assetId)).getFile();}catch(error){if(error.name!=='NotFoundError')throw error;}}
 return null;
}
export async function deleteBlob(assetId){
 const asset=await get('assets',assetId);
 if(navigator.storage?.getDirectory){try{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('knowledge-studio');await dir.removeEntry(asset?.path||assetId);}catch(error){if(error.name!=='NotFoundError')throw error;}}
 await del('assets',assetId);
}
export async function snapshotDocument(doc,reason='auto'){const rev={id:uid('rev'),documentId:doc.id,reason,createdAt:now(),data:structuredClone(doc)};await put('revisions',rev);const allr=(await all('revisions')).filter(x=>x.documentId===doc.id).sort((a,b)=>b.createdAt-a.createdAt);for(const r of allr.slice(12))await del('revisions',r.id)}
export async function exportRaw(){return readSnapshot(LIBRARY_STORES)}

export async function saveDocument(topic,document,expectedUpdatedAt){
 const connection=await db();
 return new Promise((resolve,reject)=>{
  const tx=connection.transaction(['topics','documents','revisions','sourceAnchors'],'readwrite');
  let failure,result;
  tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(failure||tx.error||new Error('Сохранение отменено'));
  const docs=tx.objectStore('documents'),request=docs.get(document.id);
  request.onsuccess=()=>{
   const previous=request.result;
   if(previous&&expectedUpdatedAt!==previous.updatedAt){failure=new Error('Тема изменена в другой вкладке. Ваш ввод сохранён как локальный черновик.');tx.abort();return;}
   result={...document,revision:(previous?.revision||0)+1,updatedAt:Math.max(now(),(previous?.updatedAt||0)+1)};
   if(previous)tx.objectStore('revisions').put({id:uid('rev'),documentId:document.id,reason:'edit',createdAt:now(),data:previous});
   docs.put(result);tx.objectStore('topics').put({...topic,updatedAt:result.updatedAt});
   const anchors=tx.objectStore('sourceAnchors'),allAnchors=anchors.getAll();
   allAnchors.onsuccess=()=>{
    for(const anchor of allAnchors.result)if(anchor.topicId===topic.id)anchors.delete(anchor.id);
    for(const block of result.blocks)if(block.source?.sourceId)anchors.put({id:uid('anchor'),topicId:topic.id,blockId:block.id,sourceId:block.source.sourceId,pageIndex:block.source.pageIndex||0,rects:block.source.rects||[]});
   };
   const revisions=tx.objectStore('revisions'),allRevisions=revisions.getAll();
   allRevisions.onsuccess=()=>{for(const row of allRevisions.result.filter(r=>r.documentId===document.id).sort((a,b)=>b.createdAt-a.createdAt).slice(12))revisions.delete(row.id);};
  };
 });
}
