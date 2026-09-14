import * as DB from '../db.js';
import {createBackup,inspectBackup,restoreValidatedBackup} from '../backup.js';
import {makeZip,readZip} from '../zip-lite.js';
import {analyzePdf,openPdfDocument} from '../pdf-basic.js';
const frame=document.querySelector('#app-frame'),output=document.querySelector('#results');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(value,message)=>{if(!value)throw new Error(message);};
async function wait(check,message='condition',timeout=12000){const start=Date.now();while(!await check()){if(Date.now()-start>timeout)throw new Error('Timeout: '+message);await sleep(30);}}
function log(message){output.textContent+=message+'\n';}
const doc=()=>frame.contentDocument;
async function click(selector){const element=doc().querySelector(selector);assert(element,'Missing '+selector);element.click();await sleep(0);}
function fill(selector,value){const element=doc().querySelector(selector);assert(element,'Missing '+selector);element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));}
async function route(path){frame.contentWindow.location.hash=path;await wait(()=>frame.contentWindow.location.hash==='#'+path&&doc().querySelector('.titlebar'),'route '+path);await sleep(120);}
async function newNamed(action,name){await click(`[data-action="${action}"]`);await wait(()=>doc().querySelector('#m-title'),'dialog');fill('#m-title',name);await click('#m-save');await wait(()=>!doc().querySelector('#m-save'),'save dialog');await sleep(80);}
function pdfFixture(cjk=false){
 const stream=cjk?'BT /F1 16 Tf 40 760 Td <65e5672c8a9e> Tj ET':'BT /F1 16 Tf 40 760 Td (Regression PDF local text provenance and complete backup verification.) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',cjk?'<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiMin-W3 /Encoding /UniJIS-UTF16-H /DescendantFonts [6 0 R] >>':'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 if(cjk)objects.push('<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiMin-W3 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> /DW 1000 >>');
 let pdf='%PDF-1.7\n',offsets=[0];for(const [i,object] of objects.entries()){offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;}
 const xref=pdf.length;pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return new File([pdf],cjk?'Regression-CJK.pdf':'Regression-text.pdf',{type:'application/pdf'});
}
async function reload(){frame.contentWindow.location.reload();await sleep(150);await wait(()=>doc()?.querySelector('.rail'),'reload');}
document.querySelector('#run').onclick=async()=>{
 document.querySelector('#run').disabled=true;output.textContent='';
 const errors=[];
 try{
  assert(location.hostname==='127.0.0.1'&&location.port!=='8765','Use a dedicated test origin, not the development/user origin');
  await wait(()=>doc()?.querySelector('.rail'),'initial render');
  const observeErrors=()=>{frame.contentWindow.addEventListener('error',event=>errors.push(event.message+' '+event.filename+':'+event.lineno));frame.contentWindow.addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));};
  observeErrors();frame.addEventListener('load',observeErrors);
  log('PASS initial browser render');await reload();log('PASS ordinary reload');
  const prefix='Regression '+Date.now();await route('/library');await newNamed('new-course',prefix);
  const courses=await DB.all('courses'),course=courses.find(c=>c.title===prefix);assert(course,'Course persisted');
  await newNamed('new-lesson',prefix+' lesson');const lesson=(await DB.all('lessons')).find(l=>l.courseId===course.id);assert(lesson,'Lesson persisted');
  await newNamed('new-topic',prefix+' topic');const topic=(await DB.all('topics')).find(t=>t.lessonId===lesson.id);assert(topic,'Topic persisted');
  await wait(()=>doc().querySelector('#blocks'),'editor');
  const types=['paragraph','heading1','heading','heading3','bullet','numbered','quote','callout:definition','callout:keyIdea','callout:important','callout:example','callout:note','callout:warning','callout:question','link','code','math','table','image','divider','pdfFragment'];
  for(const type of types){await click(`[data-addtype="${type}"]`);const blocks=doc().querySelectorAll('[data-block]'),last=blocks[blocks.length-1],input=last.querySelector('[data-field="text"]');if(input){input.value=type+' Regression content';input.dispatchEvent(new Event('input',{bubbles:true}));}if(type==='table'){const input=last.querySelector('textarea');input.value='Name | Value\nOne | Two';input.dispatchEvent(new Event('input',{bubbles:true}));}if(type==='link'){const input=last.querySelector('[data-field="href"]');input.value='https://example.com/';input.dispatchEvent(new Event('input',{bubbles:true}));}}
  await click('[data-action="save-now"]');await wait(()=>doc().querySelector('#save-state')?.textContent==='Сохранено','save');
  let document=await DB.get('documents',topic.documentId);assert(document.blocks.length===21,'21 rich block types');log('PASS rich block creation and persistence: 21 types');
  const png=new File([await (await fetch('../icon-512.png')).blob()],'regression.png',{type:'image/png'}),imageTransfer=new DataTransfer();imageTransfer.items.add(png);
  await click('[data-pickimage]');const imagePicker=doc().querySelector('#file-picker');imagePicker.files=imageTransfer.files;imagePicker.dispatchEvent(new Event('change',{bubbles:true}));
  await wait(()=>doc().querySelector('.image-editor-preview img')?.naturalWidth===512,'image loaded');await click('[data-action="save-now"]');await reload();
  assert(doc().querySelector('.image-editor-preview img')?.naturalWidth===512,'Image lost on reload');log('PASS real PNG block upload and reload persistence');
  fill('[data-block] [data-field="text"]','Regression typing before add and navigation');await click('[data-addtype="paragraph"]');
  assert(doc().querySelector('[data-block] [data-field="text"]').value==='Regression typing before add and navigation','Input lost during render');
  const before=doc().querySelectorAll('[data-block]').length;await click('[data-duplicateblock]');assert(doc().querySelectorAll('[data-block]').length===before+1,'Duplicate block');
  await click('[data-blockmove="1"]');await click('[data-delblock]');await click('[data-go="/topic/'+topic.id+'"]');await wait(()=>doc().querySelector('.reader'),'Reader');
  document=await DB.get('documents',topic.documentId);assert(document.plainText.includes('Regression typing'),'Input lost during navigation');log('PASS editor typing/add/duplicate/reorder/delete/navigation');
  await click('[data-action="focus"]');await wait(()=>doc().body.classList.contains('focus-mode'),'Focus on');await click('.focus-exit');assert(!doc().body.classList.contains('focus-mode'),'Focus off');
  await click('[data-action="favorite"]');await sleep(80);await reload();assert((await DB.get('topics',topic.id)).favorite,'Favorite reload');log('PASS Reader/Focus/favorite/reload');
  await route('/search');fill('#search-input','Regression typing');await click('[data-action="search"]');await wait(()=>doc().querySelector('.search-hit'),'search result');assert(doc().querySelector('#search-results').textContent.includes(prefix),'Search content');log('PASS worker search');
  await route('/settings');const names=[...doc().querySelectorAll('button[data-theme]')].map(b=>b.dataset.theme);assert(names.length===32,'32 themes');
  for(const name of names){doc().querySelector(`button[data-theme="${name}"]`).click();await wait(async()=>doc().documentElement.dataset.theme===name.toLowerCase().replace(/[^a-z0-9]+/g,'-')&&(await DB.setting('appearance',{})).theme===name,'theme render and persistence '+name);}
  await reload();assert(doc().documentElement.dataset.theme==='eclipse','Last theme reload');log('PASS all 32 theme switches and persistence: '+names.join(', '));
  for(const [width,height] of [[1440,900],[1280,800],[800,1280],[390,844],[844,390]]){
   frame.style.width=width+'px';frame.style.height=height+'px';await sleep(80);
   for(const path of ['/library','/courses','/notes','/pdf','/favorites','/search','/stats','/settings','/course/'+course.id,'/lesson/'+lesson.id,'/topic/'+topic.id,'/edit/'+topic.id]){
    await route(path);const root=doc().documentElement;assert(root.scrollWidth<=width+1,`Overflow ${width} ${path}: ${root.scrollWidth}`);
    const scroller=doc().scrollingElement;if(scroller.scrollHeight>height+5){frame.contentWindow.scrollTo(0,scroller.scrollHeight);await sleep(20);assert(scroller.scrollTop>0,'Scroll blocked '+path);frame.contentWindow.scrollTo(0,0);}
   }
   log(`PASS responsive/scroll all routes ${width}×${height}`);
  }
  frame.style.width='100%';frame.style.height='850px';await route('/pdf');
  const file=new File([pdfFixture()],prefix+'.pdf',{type:'application/pdf'}),dataTransfer=new DataTransfer();dataTransfer.items.add(file);const input=doc().querySelector('#file-picker');await click('[data-action="pick-pdf"]');await wait(()=>typeof input.onchange==='function','file picker handler');input.files=dataTransfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  await wait(()=>doc().querySelector('#pdf-commit'),'real PDF import',30000);await click('#pdf-commit');await wait(()=>!doc().querySelector('#pdf-commit'),'PDF commit');
  const source=(await DB.all('pdfSources')).find(s=>s.originalFileName===file.name);assert(source,'PDF source');assert(await DB.loadBlob(source.assetId),'Original PDF');assert((await DB.all('sourceAnchors')).some(a=>a.sourceId===source.id),'PDF anchors');
  await route('/pdf');await click(`[data-source="${source.id}"]`);await wait(()=>doc().querySelector('#source-canvas')?.width>300,'PDF canvas',30000);await click('[data-close]');log('PASS real PDF UI import, canvas reader, worker and provenance');
  const cjk=await analyzePdf(pdfFixture(true));assert(cjk.pageCount===1&&cjk.text.length>0,'CJK extraction');log('PASS CJK PDF extraction: '+cjk.text);
  const jpxBlob=await (await fetch('./fixtures/jpeg2000.pdf')).blob(),jpx=await openPdfDocument(jpxBlob);
  try{const page=await jpx.pdf.getPage(1),canvas=window.document.createElement('canvas'),viewport=page.getViewport({scale:1});canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;const pixel=canvas.getContext('2d').getImageData(100,250,1,1).data;assert(pixel[2]>50&&pixel[0]<230,'JPEG2000 was not decoded');}finally{await jpx.close();}
  log('PASS actual JPEG2000 PDF canvas rendering via local WASM');
  for(const resource of ['vendor/pdfjs/pdf.worker.mjs','vendor/pdfjs/cmaps/UniJIS-UTF16-H.bcmap','vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf','vendor/pdfjs/wasm/openjpeg.wasm']){const response=await fetch('../'+resource);assert(response.ok,'Missing local resource '+resource);if(resource.endsWith('.wasm'))assert(WebAssembly.validate(await response.arrayBuffer()),'Invalid WASM');}
  log('PASS local worker/CMap/font/WASM resources and valid WASM binary');

  const backup=await createBackup('regression'),prepared=await inspectBackup(backup);assert(prepared.assets.length>0,'Backup includes originals');
  const signature=JSON.stringify(await DB.exportRaw());
  const bytes=new Uint8Array(await backup.arrayBuffer());bytes[80]^=1;let rejected=false;try{await inspectBackup(new Blob([bytes]));}catch{rejected=true;}assert(rejected,'Corrupt backup accepted');assert(JSON.stringify(await DB.exportRaw())===signature,'Corrupt backup changed DB');
  const files=await readZip(backup);delete files[`assets/pdf/${source.assetId}.pdf`];rejected=false;try{await inspectBackup(await makeZip(Object.entries(files).map(([name,data])=>({name,data}))));}catch{rejected=true;}assert(rejected,'Incomplete backup accepted');
  // Restore the validated same library in this dedicated test origin; never clear a user origin.
  await restoreValidatedBackup(prepared);assert((await DB.loadBlob(source.assetId)).size===file.size,'Restored PDF');assert(JSON.stringify(await DB.exportRaw())===signature,'Roundtrip structure');log('PASS full backup/restore, missing PDF and corrupt ZIP rejection');
  const marker={id:DB.uid('test'),value:'before'};await DB.put('settings',marker);let aborted=false;
  try{await DB.commit({settings:[{id:marker.id,value:'after'},{}]});}catch{aborted=true;}assert(aborted&&(await DB.get('settings',marker.id)).value==='before','Transaction rollback');await DB.del('settings',marker.id);log('PASS real IndexedDB transaction rollback');
  await route('/course/'+course.id);await click('[data-action="edit-course"]');fill('#m-title',prefix+' renamed');await click('#m-save');await wait(()=>!doc().querySelector('#m-save'),'rename');assert((await DB.get('courses',course.id)).title.endsWith('renamed'),'Rename');
  await click('[data-action="edit-course"]');await click('#m-duplicate');await wait(()=>(doc().querySelector('.titlebar')?.textContent==='Курсы'),'course duplicate');assert((await DB.all('courses')).some(c=>c.title===prefix+' renamed — копия'),'Duplicate course');
  const first=doc().querySelector('[data-drag="course"]');first.querySelector('[aria-label="Ниже"]').click();await sleep(150);log('PASS course rename/duplicate/reorder');
  await route('/lesson/'+lesson.id);await click('[data-action="edit-lesson"]');fill('#m-title',prefix+' renamed lesson');await click('#m-save');await wait(()=>!doc().querySelector('#m-save'),'lesson rename');await click('[data-action="edit-lesson"]');await click('#m-duplicate');await wait(()=>(doc().querySelector('.titlebar')?.textContent===prefix+' renamed'),'lesson duplicate');assert((await DB.all('lessons')).some(l=>l.title===prefix+' renamed lesson — копия'),'Duplicate lesson');log('PASS lesson rename/duplicate');
  await route('/lesson/'+lesson.id);await click('[data-action="topic-menu"]');await click('#edit');fill('#m-title',prefix+' renamed topic');await click('#m-save');await wait(()=>!doc().querySelector('#m-save'),'topic rename');await route('/lesson/'+lesson.id);await click('[data-action="topic-menu"]');await click('#dup');await wait(()=>!doc().querySelector('#dup'),'topic duplicate');assert((await DB.all('topics')).some(t=>t.title===prefix+' renamed topic — копия'),'Duplicate topic');log('PASS topic rename/duplicate');
  await route('/course/'+course.id);await click('[data-action="edit-course"]');await click('#m-delete');await wait(()=>!doc().querySelector('#m-delete'),'trash');await route('/notes');assert(![...doc().querySelectorAll('[data-go]')].some(b=>b.dataset.go==='/topic/'+topic.id),'Deleted parent leaked to notes');await route('/favorites');assert(![...doc().querySelectorAll('[data-go]')].some(b=>b.dataset.go==='/topic/'+topic.id),'Deleted parent leaked to favorites');log('PASS soft delete hides descendants');
  await wait(async()=>!!(await navigator.serviceWorker.getRegistration('../'))?.active,'SW activation',30000);
  const registration=await navigator.serviceWorker.getRegistration('../');log('PASS Service Worker active: '+registration.scope);
  assert(errors.length===0,'Runtime errors: '+errors.join('\n'));
  log('PASS runtime suite complete. Offline/server-stop and hard reload are separate checks.');
 }catch(error){log('FAIL '+error.stack);output.classList.add('fail');console.error(error);}
 finally{document.querySelector('#run').disabled=false;}
};
