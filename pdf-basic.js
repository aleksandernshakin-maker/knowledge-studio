import * as pdfjsLib from './vendor/pdfjs/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;

const CMAP_URL = new URL('./vendor/pdfjs/cmaps/', import.meta.url).href;
const STANDARD_FONT_URL = new URL('./vendor/pdfjs/standard_fonts/', import.meta.url).href;
const WASM_URL = new URL('./vendor/pdfjs/wasm/', import.meta.url).href;

function median(values){const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return 12;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function normalize(s){return (s||'').replace(/\s+/g,' ').trim()}
function itemBox(item, viewport){const t=item.transform||[1,0,0,1,0,0];const x=t[4], baseline=t[5];const h=Math.max(Math.abs(t[3]||0),Math.abs(t[0]||0),item.height||0,1);const y=Math.max(0,viewport.height-baseline-h);return {x,y,w:Math.max(item.width||0,1),h}}
function lineify(items,viewport){const glyphs=items.filter(i=>normalize(i.str)).map(i=>({text:normalize(i.str),...itemBox(i,viewport),fontName:i.fontName||'',dir:i.dir||'ltr'}));glyphs.sort((a,b)=>Math.abs(a.y-b.y)>Math.max(a.h,b.h)*.45?a.y-b.y:a.x-b.x);const lines=[];for(const g of glyphs){let line=lines.findLast?.(l=>Math.abs(l.y-g.y)<=Math.max(l.h,g.h)*.5);if(!line){line={items:[],y:g.y,h:g.h};lines.push(line)}line.items.push(g);line.h=Math.max(line.h,g.h)}for(const l of lines){l.items.sort((a,b)=>a.x-b.x);l.x=Math.min(...l.items.map(x=>x.x));l.right=Math.max(...l.items.map(x=>x.x+x.w));l.text=normalize(l.items.map((x,i)=>{if(!i)return x.text;const prev=l.items[i-1],gap=x.x-(prev.x+prev.w);return (gap>Math.max(2,prev.h*.16)?' ':'')+x.text}).join(''));l.fontSize=median(l.items.map(x=>x.h));l.bold=l.items.some(x=>/bold|black|semibold/i.test(x.fontName))}return lines.filter(l=>l.text)}
function splitColumns(lines,width){if(lines.length<8)return [lines];const centers=lines.map(l=>(l.x+l.right)/2);const left=lines.filter((l,i)=>centers[i]<width*.48),right=lines.filter((l,i)=>centers[i]>width*.52);const wide=lines.filter(l=>(l.right-l.x)>width*.62);if(left.length>=3&&right.length>=3&&wide.length<lines.length*.35){const topWide=wide.filter(l=>l.y<Math.min(left[0]?.y??Infinity,right[0]?.y??Infinity));return [topWide,left.filter(l=>!topWide.includes(l)),right.filter(l=>!topWide.includes(l))]}return [lines]}
function pageBlocks(lines,pageIndex,width,height){if(!lines.length)return [];const body=median(lines.filter(l=>l.text.length>30).map(l=>l.fontSize));const groups=splitColumns(lines,width);const out=[];for(const group of groups){for(const l of group){let type='paragraph';const ratio=l.fontSize/body;if((ratio>=1.28||l.bold&&ratio>=1.12)&&l.text.length<150)type='heading';else if(/^(?:[•●▪◦‣⁃]|[-–—*])\s+/.test(l.text)||/^\d+[.)]\s+/.test(l.text))type='bullet';const text=l.text.replace(/^(?:[•●▪◦‣⁃]|[-–—*])\s+/,'');out.push({id:crypto.randomUUID(),type,text,source:{pageIndex,rects:[{x:l.x/width,y:l.y/height,w:(l.right-l.x)/width,h:l.h/height}]},_y:l.y,_x:l.x})}}return out}

export async function analyzePdf(file,onProgress=()=>{}){
 const data=new Uint8Array(await file.arrayBuffer());
 const task=pdfjsLib.getDocument({data,cMapUrl:CMAP_URL,cMapPacked:true,standardFontDataUrl:STANDARD_FONT_URL,wasmUrl:WASM_URL,useWorkerFetch:true});
 const pdf=await task.promise;const pages=[];let total=0;let empty=0;
 for(let p=1;p<=pdf.numPages;p++){
  const page=await pdf.getPage(p),viewport=page.getViewport({scale:1});
  const content=await page.getTextContent({includeMarkedContent:true,disableNormalization:false});
  const lines=lineify(content.items,viewport);const blocks=pageBlocks(lines,p-1,viewport.width,viewport.height);
  if(!blocks.length)empty++;total+=blocks.reduce((n,b)=>n+b.text.length,0);pages.push({pageIndex:p-1,width:viewport.width,height:viewport.height,blocks});
  page.cleanup();onProgress(p/pdf.numPages);
 }
 const likelyScan=total<Math.max(120,pdf.numPages*25)||empty>pdf.numPages*.7;
 const warnings=[];
 if(likelyScan)warnings.push('На многих страницах почти нет извлекаемого текста. Возможно, документ является сканом. OCR в этой версии не выполняется.');
 warnings.push('PDF.js извлекает текст и геометрию без изменения смысла. Заголовки, списки и колонки восстанавливаются эвристически — сложную вёрстку следует проверить.');
 return {pageCount:pdf.numPages,pages,text:pages.flatMap(p=>p.blocks.map(b=>b.text)).join('\n'),likelyScan,confidence:likelyScan?.25:.9,warnings,engine:`PDF.js ${pdfjsLib.version||'6.3.289'}`};
}
export function textToBlocks(input,sourceId){
 const raw=Array.isArray(input?.pages)?input.pages.flatMap(p=>p.blocks):Array.isArray(input)?input:null;
 if(raw?.length)return raw.map(b=>({...b,id:b.id||crypto.randomUUID(),source:{sourceId,pageIndex:b.source?.pageIndex||0,rects:b.source?.rects||[]}}));
 const text=typeof input==='string'?input:(input?.text||'');const lines=text.split(/\n+/).map(normalize).filter(Boolean);
 return lines.length?lines.map(line=>({id:crypto.randomUUID(),type:'paragraph',text:line,source:{sourceId,pageIndex:0,rects:[]}})):[{id:crypto.randomUUID(),type:'paragraph',text:'Текст автоматически извлечь не удалось. Оригинальный PDF сохранён.',source:{sourceId,pageIndex:0,rects:[]}}];
}
