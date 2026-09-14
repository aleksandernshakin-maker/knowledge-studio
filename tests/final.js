import * as DB from '../db.js';
import {createBackup,inspectBackup,restoreValidatedBackup} from '../backup.js';
import {makeZip,readZip} from '../zip-lite.js';
const frame=document.querySelector('#frame'),out=document.querySelector('#result');
const doc=()=>frame.contentDocument,delay=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(v,m)=>{if(!v)throw Error(m);},log=m=>out.textContent+='PASS '+m+'\n';
async function wait(f,m){for(let i=0;i<600;i++){if(await f())return;await delay(25);}throw Error('Timeout '+m);}
async function route(hash){frame.contentWindow.location.hash=hash;await delay(200);}
async function click(s){assert(doc().querySelector(s),s);doc().querySelector(s).click();await delay(40);}
function fill(s,v){const input=doc().querySelector(s);assert(input,s);input.value=v;input.dispatchEvent(new Event('input',{bubbles:true}));}
async function topic(){const s=await DB.readSnapshot();return s.topics.find(t=>t.title.startsWith('Regression')&&!t.deletedAt&&s.lessons.some(l=>l.id===t.lessonId&&!l.deletedAt&&s.courses.some(c=>c.id===l.courseId&&!c.deletedAt)));}
function run(id,fn){document.querySelector(id).onclick=async()=>{try{assert(location.hostname==='127.0.0.1'&&location.port==='8766','Test origin only');await wait(()=>doc()?.querySelector('.rail'),'boot');await fn();}catch(e){out.textContent+='FAIL '+e.stack+'\n';console.error(e);}};}
run('#recovery',async()=>{
 const t=await topic(),stored=await DB.get('documents',t.documentId),draft=structuredClone(stored);draft.blocks[0].text='Regression stale draft recovered separately';
 localStorage.setItem('ks-draft:'+stored.id,JSON.stringify({topic:t,document:draft,base:stored.updatedAt-1}));
 await route('/edit/'+t.id);await new Promise(resolve=>{frame.addEventListener('load',resolve,{once:true});frame.contentWindow.location.reload();});await wait(()=>doc()?.querySelector('#recover-local'),'stale draft prompt');await click('#recover-local');
 await wait(()=>frame.contentWindow.location.hash.startsWith('#/edit/')&&frame.contentWindow.location.hash!=='#/edit/'+t.id&&!doc().querySelector('#recover-local'),'copy saved');
 assert(JSON.stringify(await DB.get('documents',stored.id))===JSON.stringify(stored),'Original overwritten');log('stale draft restored as separate topic; original unchanged');
 const backup=await createBackup('final'),prepared=await inspectBackup(backup),before=JSON.stringify(await DB.exportRaw());
 const broken={...prepared,data:structuredClone(prepared.data)};broken.data.settings.push({id:'regression-uncloneable',value:()=>{}});
 let failed=false;try{await restoreValidatedBackup(broken);}catch{failed=true;}assert(failed&&JSON.stringify(await DB.exportRaw())===before,'Restore transaction not rolled back');log('restore clear/write transaction abort retains entire library');
 const files=await readZip(backup),manifest=JSON.parse(new TextDecoder().decode(files['manifest.json']));manifest.backupFormatVersion=1;delete manifest.librarySHA256;files['manifest.json']=new TextEncoder().encode(JSON.stringify(manifest));
 await inspectBackup(await makeZip(Object.entries(files).map(([name,data])=>({name,data}))));log('legacy backup v1 compatibility');
 const missing={id:DB.uid('test-source'),assetId:DB.uid('missing'),pageCount:1};await DB.put('pdfSources',missing);
 try{failed=false;try{await createBackup('missing-test');}catch{failed=true;}assert(failed,'Incomplete export accepted');}finally{await DB.del('pdfSources',missing.id);}log('missing original PDF prevents successful backup');
});
run('#prepare',async()=>{
 const t=await topic(),snapshot=await DB.readSnapshot();
 const stable=Object.fromEntries(['courses','lessons','topics','pdfSources','assets','settings'].map(k=>[k,snapshot[k]]));
 sessionStorage.setItem('regression-update',JSON.stringify({topicId:t.id,documentId:t.documentId,stable,marker:'Regression editor update '+Date.now(),cacheKeys:await caches.keys()}));
 await (await caches.open('regression-unrelated-cache')).put('/regression-marker',new Response('keep'));
 await route('/edit/'+t.id);log('snapshot and editor prepared; install a new SW VERSION, then apply');
});
run('#apply',async()=>{
 const saved=JSON.parse(sessionStorage.getItem('regression-update'));assert(saved,'Prepare first');const registration=await navigator.serviceWorker.getRegistration('../');await registration.update();
 await wait(()=>doc().querySelector('#update-release'),'waiting update button');
 fill('[data-block] [data-field="text"]',saved.marker);
 assert(JSON.parse(localStorage.getItem('ks-draft:'+saved.documentId)).document.blocks[0].text===saved.marker,'Draft not durable before update');
 doc().querySelector('#update-release').click();
 await wait(()=>doc()?.querySelector('[data-block] [data-field="text"]')?.value===saved.marker&&!doc()?.querySelector('#update-release'),'update reload');
 await wait(async()=>(await DB.get('documents',saved.documentId)).blocks[0].text===saved.marker,'saved input');log('waiting update applied through UI with freshly typed unsaved input');
});
run('#verify',async()=>{
 const saved=JSON.parse(sessionStorage.getItem('regression-update'));assert(saved,'Prepare first');
 frame.contentWindow.location.reload();await delay(300);await wait(()=>doc()?.querySelector('[data-block] [data-field="text"]')?.value===saved.marker,'editor reload');
 const current=await DB.readSnapshot();for(const [store,rows] of Object.entries(saved.stable)){
  assert(current[store].length===rows.length,'Count changed '+store);
  for(const row of rows){const now=current[store].find(x=>x.id===row.id);assert(now,'Lost '+store+' '+row.id);if(store!=='topics')assert(JSON.stringify(now)===JSON.stringify(row),'Changed '+store);}
 }
 assert((await DB.get('documents',saved.documentId)).blocks[0].text===saved.marker,'Editor input lost');
 assert(await (await (await caches.open('regression-unrelated-cache')).match('/regression-marker')).text()==='keep','Unrelated cache removed');
 const keys=(await caches.keys()).filter(k=>k.startsWith('knowledge-studio:/knowledge-studio/:'));assert(keys.length===1,'Old scoped caches retained');log('reload: data, assets, appearance, input and unrelated cache preserved; active cache '+keys[0]);
 await route('/topic/'+saved.topicId);assert(doc().querySelector('.reader'),'Reader missing');await route('/edit/'+saved.topicId);log('Reader/Editor functional after update (also run this with server stopped)');
});
run('#cover',async()=>{
 await route('/courses');await click('[data-action="edit-course"]');await wait(()=>doc().querySelector('#m-cover-pick'),'course dialog');
 const title=doc().querySelector('#m-title').value;
 const original=doc().createElement;let picker;
 // Capture the detached native file input, then deliver a real File/change event.
 doc().createElement=function(name,...args){const node=original.call(this,name,...args);if(name==='input')picker=node;return node;};
 try{await click('#m-cover-pick');}finally{doc().createElement=original;}
 assert(picker?.type==='file','File picker');const transfer=new DataTransfer();transfer.items.add(new File([await (await fetch('../icon-512.png')).blob()],'cover.png',{type:'image/png'}));picker.files=transfer.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
 await wait(()=>doc().querySelector('.cover-upload-preview')?.naturalWidth===512,'cover decode');await click('#m-save');await wait(()=>!doc().querySelector('#m-save'),'cover save');
 const course=(await DB.all('courses')).find(c=>c.title===title&&!c.deletedAt);assert(course.coverImage.startsWith('data:image/png;base64,'),'Cover not persisted');
 const inspected=await inspectBackup(await createBackup('cover-test'));assert(inspected.data.courses.find(c=>c.id===course.id).coverImage===course.coverImage,'Backup lost cover');
 frame.contentWindow.location.reload();await delay(300);await wait(()=>doc()?.querySelector('img.course-cover-image')?.naturalWidth===512||[...doc()?.images||[]].some(i=>i.src===course.coverImage&&i.naturalWidth===512),'cover reload');log('real course PNG cover decode, save, reload and backup preserved');
});
