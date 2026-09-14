const result=document.querySelector('#result');
const assert=(value,message)=>{if(!value)throw new Error(message);};
const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
document.querySelector('#run').onclick=async()=>{
 try{
  assert(location.hostname==='127.0.0.1'&&['8767','8768'].includes(location.port),'Dedicated migration-test origin only');
  const databases=await indexedDB.databases();assert(!databases.some(d=>d.name==='knowledge-studio'),'This migration test requires a fresh test origin; existing databases are never erased');
  const opening=indexedDB.open('knowledge-studio',3);opening.onupgradeneeded=()=>opening.result.createObjectStore('courses',{keyPath:'id'});
  const legacy=await request(opening),tx=legacy.transaction('courses','readwrite');tx.objectStore('courses').put({id:'legacy-course',title:'Regression legacy course',sortKey:'000001'});await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=reject;});
  let blocked=false,oldVersionChange=false;legacy.onversionchange=()=>{oldVersionChange=true;};
  addEventListener('ks-storage-blocked',()=>{blocked=true;legacy.close();},{once:true});
  const DB=await import('../db.js');const connection=await DB.db();assert(connection.version===4,'Migration version');assert(blocked&&oldVersionChange,'blocked notification');assert(connection.objectStoreNames.length===DB.STORES.length,'All stores');assert((await DB.get('courses','legacy-course')).title==='Regression legacy course','Legacy record preserved');
  result.textContent+='PASS schema 3 → 4, blocked handling, old record retained, all 12 stores\n';
  let changed=false;addEventListener('ks-storage-versionchange',()=>changed=true,{once:true});
  const future=await request(indexedDB.open('knowledge-studio',5));assert(changed,'versionchange closes connection');future.close();
  let rejected=false;try{await DB.db();}catch(error){rejected=error.name==='VersionError';}assert(rejected,'No destructive downgrade');
  result.textContent+='PASS versionchange closes connection; newer schema safely rejects downgrade\n';
 }catch(error){result.textContent+='FAIL '+error.stack;console.error(error);}
};
