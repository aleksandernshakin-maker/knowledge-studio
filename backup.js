import * as DB from './db.js';
import {makeZip,readZip} from './zip-lite.js';

const text=new TextDecoder('utf-8',{fatal:true});
const idOK=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]+$/.test(id);
export function validateLibrary(data){
 if(!data||typeof data!=='object')throw new Error('Нет библиотеки');
 const maps={};
 for(const name of DB.LIBRARY_STORES){
  if(!Array.isArray(data[name]))throw new Error(`Отсутствует раздел ${name}`);
  maps[name]=new Map();
  for(const row of data[name]){
   if(!row||!idOK(row.id)||maps[name].has(row.id))throw new Error(`Некорректный или повторный ID: ${name}`);
   maps[name].set(row.id,row);
  }
 }
 for(const row of [...data.courses,...data.lessons,...data.topics]){
  if(typeof row.title!=='string'||(row.sortKey!=null&&typeof row.sortKey!=='string'))throw new Error('Некорректное название или порядок');
 }
 for(const lesson of data.lessons)if(!maps.courses.has(lesson.courseId))throw new Error('Урок без курса');
 for(const topic of data.topics){
  if(!maps.lessons.has(topic.lessonId)||!maps.documents.has(topic.documentId))throw new Error('Тема без урока или документа');
 }
 const types=new Set(['paragraph','heading1','heading','heading3','bullet','numbered','quote','callout','link','code','math','table','image','divider','pdfFragment']);
 for(const doc of data.documents){
  if(doc.schemaVersion!=null&&doc.schemaVersion!==1)throw new Error('Неизвестная версия документа');
  if(!maps.topics.has(doc.topicId)||maps.topics.get(doc.topicId).documentId!==doc.id||!Array.isArray(doc.blocks))throw new Error('Нарушена связь документа');
  const ids=new Set();
  for(const block of doc.blocks){
   if(!block||!idOK(block.id)||ids.has(block.id)||!types.has(block.type))throw new Error('Некорректный блок');
   ids.add(block.id);
   for(const field of ['text','href','src','alt'])if(block[field]!=null&&typeof block[field]!=='string')throw new Error('Некорректное содержимое блока');
   if(block.type==='table'&&(!Array.isArray(block.rows)||block.rows.some(r=>!Array.isArray(r)||r.some(c=>typeof c!=='string'))))throw new Error('Некорректная таблица');
   if(block.source?.sourceId&&!maps.pdfSources.has(block.source.sourceId))throw new Error('Отсутствует PDF-источник блока');
  }
 }
 for(const source of data.pdfSources)if(!idOK(source.assetId)||!Number.isInteger(source.pageCount)||source.pageCount<0)throw new Error('Некорректный PDF-источник');
 for(const anchor of data.sourceAnchors){
  const topic=maps.topics.get(anchor.topicId);
  if(!topic||!maps.pdfSources.has(anchor.sourceId)||!maps.documents.get(topic.documentId).blocks.some(b=>b.id===anchor.blockId))throw new Error('Некорректная привязка PDF');
 }
 const appearance=maps.settings.get('appearance')?.value;
 if(appearance!=null&&(typeof appearance!=='object'||Array.isArray(appearance)||typeof appearance.theme!=='string'))throw new Error('Некорректные настройки');
 return data;
}
async function digest(blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function createBackup(appVersion){
 const snapshot=await DB.readSnapshot();
 const data=Object.fromEntries(DB.LIBRARY_STORES.map(name=>[name,snapshot[name]]));
 validateLibrary(data);
 const entries=[{name:'data/library.json',data:new Blob([JSON.stringify(data)])}],assets=[];
 for(const assetId of new Set(data.pdfSources.map(s=>s.assetId))){
  const metadata=snapshot.assets.find(a=>a.id===assetId)||{id:assetId};
  const blob=await DB.loadBlob(assetId,metadata);
  if(!blob)throw new Error(`Оригинал PDF ${assetId} отсутствует. Полный backup невозможен.`);
  const name=`assets/pdf/${assetId}.pdf`;
  const {blob:ignored,...safeMetadata}=metadata;
  assets.push({id:assetId,name,size:blob.size,sha256:await digest(blob),metadata:safeMetadata});entries.push({name,data:blob});
 }
 const manifest={format:'knowledge-studio-backup',backupFormatVersion:2,schemaVersion:4,createdAt:new Date().toISOString(),appVersion,assets,librarySHA256:await digest(entries[0].data)};
 entries.unshift({name:'manifest.json',data:new Blob([JSON.stringify(manifest)])});
 return makeZip(entries);
}
export async function inspectBackup(blob){
 const files=await readZip(blob);
 if(!files['manifest.json']||!files['data/library.json'])throw new Error('Неполный backup');
 const manifest=JSON.parse(text.decode(files['manifest.json']));
 if(manifest.format!=='knowledge-studio-backup'||![1,2].includes(manifest.backupFormatVersion)||manifest.schemaVersion!==4)throw new Error('Неподдерживаемая версия backup');
 const data=validateLibrary(JSON.parse(text.decode(files['data/library.json']))),assets=[];
 if(manifest.backupFormatVersion===2&&await digest(new Blob([files['data/library.json']]))!==manifest.librarySHA256)throw new Error('Нарушена целостность библиотеки');
 for(const assetId of new Set(data.pdfSources.map(s=>s.assetId))){
  const bytes=files[`assets/pdf/${assetId}.pdf`];if(!bytes)throw new Error(`В backup отсутствует PDF ${assetId}`);
  const original=new Blob([bytes],{type:'application/pdf'}),info=manifest.assets?.find(a=>a.id===assetId);
  if(manifest.backupFormatVersion===2&&(!info||info.size!==bytes.length||info.sha256!==await digest(original)))throw new Error('Нарушена целостность PDF');
  // Stage originals in memory; commit them with the library in one IDB transaction.
  // Old OPFS files remain untouched, including on quota failure or transaction abort.
  assets.push({...info?.metadata,id:assetId,backend:'idb',path:assetId,blob:original,mime:'application/pdf',byteSize:original.size});
 }
 return {manifest,data,assets};
}
export async function restoreValidatedBackup(backup){
 validateLibrary(backup.data);
 await DB.commit({...backup.data,assets:backup.assets},{replace:true});
}
