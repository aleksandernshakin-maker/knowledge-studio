let docs=[];
self.onmessage=event=>{
 const {type,payload}=event.data;
 if(type==='INDEX'){docs=payload||[];postMessage({type:'READY',count:docs.length});return;}
 if(type!=='SEARCH')return;
 const terms=(payload||'').trim().toLocaleLowerCase('ru').split(/\s+/).filter(Boolean);
 if(!terms.length){postMessage({type:'RESULTS',results:[]});return;}
 const results=[];
 for(const doc of docs){
  const title=doc.title.toLocaleLowerCase('ru'),body=doc.body.toLocaleLowerCase('ru'),hay=[title,doc.course,doc.lesson,body].join(' ').toLocaleLowerCase('ru');
  if(!terms.every(term=>hay.includes(term)))continue;
  const score=terms.reduce((n,term)=>n+(title.includes(term)?8:0)+hay.split(term).length-1,0),at=Math.max(0,...terms.map(term=>body.indexOf(term))),start=Math.max(0,at-70);
  results.push({...doc,score,snippet:(start?'…':'')+doc.body.slice(start,start+220)});
 }
 results.sort((a,b)=>b.score-a.score);postMessage({type:'RESULTS',results});
};
