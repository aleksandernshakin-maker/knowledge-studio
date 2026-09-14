import * as DB from '../db.js';
import {createBackup,inspectBackup,restoreValidatedBackup} from '../backup.js';
const frame=document.querySelector('#frame'),output=document.querySelector('#result');
const doc=()=>frame.contentDocument,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(value,message)=>{if(!value)throw new Error(message);};
async function wait(check,label){for(let i=0;i<400;i++){if(await check())return;await delay(25);}throw new Error('Timeout '+label);}
async function route(path){frame.contentWindow.location.hash=path;await delay(180);await wait(()=>doc().querySelector('.rail'),'route');}
async function click(selector){const button=doc().querySelector(selector);assert(button,'Missing '+selector);button.click();await delay(30);}
function fill(selector,value){const input=doc().querySelector(selector);assert(input,selector);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
const log=message=>output.textContent+='PASS '+message+'\n';
document.querySelector('#run').onclick=async()=>{
 document.querySelector('#run').disabled=true;output.textContent='';
 try{
  assert(location.hostname==='127.0.0.1'&&location.port==='8766','Dedicated regression origin required');
  await wait(()=>doc()?.querySelector('.rail'),'boot');
  const courses=await DB.all('courses'),lessons=await DB.all('lessons');
  const topic=(await DB.all('topics')).find(t=>!t.deletedAt&&t.title.startsWith('Regression')&&lessons.some(l=>l.id===t.lessonId&&!l.deletedAt&&courses.some(c=>c.id===l.courseId&&!c.deletedAt)));
  assert(topic,'Run main suite first');let document=await DB.get('documents',topic.documentId);
  await route('/edit/'+topic.id);fill('[data-block] [data-field="text"]','Regression autosave after reload');
  await wait(()=>doc().querySelector('#save-state')?.textContent==='Сохранено','autosave');frame.contentWindow.location.reload();await delay(200);await wait(()=>doc().querySelector('[data-block] [data-field="text"]')?.value==='Regression autosave after reload','editor reload');log('autosave and reload while editing');
  document=await DB.get('documents',topic.documentId);const originalText=document.blocks[0].text;
  // Simulate an interrupted renderer with a durable draft, without modifying the stored document.
  const draft=structuredClone(document);draft.blocks[0].text='Regression recovered crash draft';
  localStorage.setItem('ks-draft:'+document.id,JSON.stringify({topic,document:draft,base:document.updatedAt}));
  frame.contentWindow.location.reload();await delay(200);await wait(()=>doc().querySelector('[data-block] [data-field="text"]')?.value==='Regression recovered crash draft','draft recovery');await click('[data-action="save-now"]');await wait(()=>doc().querySelector('#save-state')?.textContent==='Сохранено','draft save');log('interrupted-session draft recovery and persistence');
  document=await DB.get('documents',topic.documentId);let conflict=false;try{await DB.saveDocument(topic,document,document.updatedAt-1);}catch{conflict=true;}assert(conflict,'Stale write accepted');assert((await DB.get('documents',document.id)).updatedAt===document.updatedAt,'Conflict modified document');log('stale-write conflict rejected without overwriting document');
  await route('/settings');
  for(const mode of ['paper','sepia','oled']){
   const select=doc().querySelector('#reader-theme');select.value=mode;select.dispatchEvent(new Event('change',{bubbles:true}));await wait(async()=>(await DB.setting('appearance')).readerTheme===mode,'Reader setting');
   await route('/topic/'+topic.id);const style=frame.contentWindow.getComputedStyle(doc().querySelector('.reader'));assert(style.backgroundImage==='none','Global theme overrides reader '+mode);assert(style.color===({paper:'rgb(42, 36, 29)',sepia:'rgb(53, 41, 31)',oled:'rgb(245, 245, 245)'})[mode],'Reader text contrast '+mode);await route('/settings');
  }
  log('Paper/Sepia/OLED override global theme predictably');
  if(!doc().body.classList.contains('reduce-motion'))await click('[data-action="toggle-motion"]');await wait(()=>doc().body.classList.contains('reduce-motion'),'reduced motion');await route('/library');assert(frame.contentWindow.getComputedStyle(doc().querySelector('.art-svg')).animationName==='none','Reduced motion animation');log('Reduced Motion disables atmospheric animation');
  await click('[data-action="new-course"]');await wait(()=>doc().querySelector('[role="dialog"]'),'modal');const dialog=doc().querySelector('[role="dialog"]');assert(dialog.getAttribute('aria-modal')==='true','Dialog semantics');assert(dialog.contains(doc().activeElement),'Dialog autofocus');
  const nodes=[...dialog.querySelectorAll('button,input,select,textarea,a[href]')].filter(n=>!n.disabled&&!n.hidden&&n.type!=='hidden');const last=nodes.at(-1);last.focus();last.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));assert(dialog.contains(doc().activeElement),'Focus escaped dialog');doc().activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert(!doc().querySelector('[role="dialog"]'),'Escape close');log('dialog semantics, autofocus, focus containment and Escape');
  const descriptor=Object.getOwnPropertyDescriptor(navigator,'storage'),assetId=DB.uid('test-fallback');
  try{Object.defineProperty(navigator,'storage',{configurable:true,value:{}});await DB.saveBlob(assetId,new Blob(['Regression fallback bytes']));await DB.put('assets',{...await DB.get('assets',assetId),kind:'pdf'});assert(await (await DB.loadBlob(assetId)).text()==='Regression fallback bytes','Fallback lost Blob');}
  finally{if(descriptor)Object.defineProperty(navigator,'storage',descriptor);else delete navigator.storage;}
  await DB.del('assets',assetId);log('actual IndexedDB Blob fallback survives metadata update');
  const backup=await createBackup('additional-regression'),prepared=await inspectBackup(backup),snapshot=JSON.stringify(await DB.exportRaw());
  const broken={...prepared,data:structuredClone(prepared.data)};broken.data.documents.push({});let rejected=false;try{await restoreValidatedBackup(broken);}catch{rejected=true;}assert(rejected&&JSON.stringify(await DB.exportRaw())===snapshot,'Invalid restore touched database');log('invalid restore rejected before writing current library');
  const course=courses.find(c=>!c.deletedAt&&c.title.startsWith('Regression'));
  await route('/course/'+course.id);const originalLessons=(await DB.all('lessons')).filter(l=>l.courseId===course.id&&!l.deletedAt);
  if(originalLessons.length<2){await click('[data-action="new-lesson"]');fill('#m-title','Regression extra lesson');await click('#m-save');await wait(()=>!doc().querySelector('#m-save'),'lesson creation');}
  await route('/course/'+course.id);const rows=doc().querySelectorAll('[data-drag="lesson"]'),movingId=rows[0].dataset.id;rows[0].querySelector('[aria-label="Ниже"]').click();await delay(150);assert(doc().querySelectorAll('[data-drag="lesson"]')[1].dataset.id===movingId,'Lesson reorder');log('lesson reorder persisted');
  await route('/lesson/'+topic.lessonId);const originalTopics=(await DB.all('topics')).filter(t=>t.lessonId===topic.lessonId&&!t.deletedAt);
  if(originalTopics.length<2){await click('[data-action="new-topic"]');fill('#m-title','Regression extra topic');await click('#m-save');await wait(()=>!doc().querySelector('#m-save'),'new topic');}
  await route('/lesson/'+topic.lessonId);const topicRows=doc().querySelectorAll('[data-drag="topic"]'),topicMove=topicRows[0].dataset.id;topicRows[0].querySelector('[aria-label="Ниже"]').click();await delay(150);assert(doc().querySelectorAll('[data-drag="topic"]')[1].dataset.id===topicMove,'Topic reorder');
  const target=doc().querySelectorAll('[data-drag="topic"]')[1];target.querySelector('[data-action="topic-menu"]').click();await delay(30);await click('#del');await wait(()=>!doc().querySelector('#del'),'topic delete');assert((await DB.get('topics',topicMove)).deletedAt,'Topic deletion');await route('/trash');await click(`[data-action="restore"][data-id="${topicMove}"]`);await wait(async()=>!(await DB.get('topics',topicMove)).deletedAt,'topic restore');log('topic reorder, delete and restore');
  const extra=(await DB.all('lessons')).find(l=>l.title==='Regression extra lesson'&&!l.deletedAt);if(extra){await route('/lesson/'+extra.id);await click('[data-action="edit-lesson"]');await click('#m-delete');await wait(async()=>!!(await DB.get('lessons',extra.id)).deletedAt,'lesson delete');await route('/trash');await click(`[data-action="restore"][data-id="${extra.id}"]`);await wait(async()=>!(await DB.get('lessons',extra.id)).deletedAt,'lesson restore');}log('lesson delete and restore');
  const keys=await caches.keys();assert(keys.some(k=>k.startsWith('knowledge-studio:/knowledge-studio/:')),'Scoped cache');
  const cache=await caches.open('regression-unrelated-cache');await cache.put('/regression-marker',new Response('keep'));log('unrelated origin cache seeded for SW update test');
  output.textContent+='PASS additional suite complete\n';
 }catch(error){output.textContent+='FAIL '+error.stack;console.error(error);}
 finally{document.querySelector('#run').disabled=false;}
};
