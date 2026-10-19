/* Only explicitly edited kill counts from a successfully saved, confirmed match become labels. */
(function(root){
  const base=(root.WarDigitTemplates||[]).slice();
  function database(){return new Promise((resolve,reject)=>{const request=indexedDB.open('ffk-reviewed-ocr',1);request.onupgradeneeded=()=>request.result.createObjectStore('examples',{keyPath:'id'});request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('OCR example storage is busy in another tab.'));request.onsuccess=()=>resolve(request.result);});}
  async function examples(){const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('examples','readonly'),request=tx.objectStore('examples').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}}
  function eligible(records){
    const matches=new Map();for(const record of records){if(!matches.has(record.label))matches.set(record.label,new Set());matches.get(record.label).add(record.matchId);}
    // Two independent confirmed matches must support a label before its saved crops influence OCR.
    return records.filter(r=>matches.get(r.label).size>=2).map(r=>({label:r.label,...r.feature}));
  }
  async function load(){const records=await examples();root.WarDigitTemplates=base.concat(eligible(records));return records.length;}
  function capture(match,sources,createCanvas){
    const records=[];
    for(const row of match.rows){if(!row.confirmed)continue;row.players.forEach((player,index)=>{
      if(!player.killEdited||!Number.isInteger(player.kills)||player.kills<0||player.kills>99)return;
      const candidates=[];
      for(const source of sources){
        const original=source.image,observed=source.rows?.find(r=>r.placement===row.placement)?.players[index],region=observed?.ocrRegion;
        if(!original||!region||observed.kills===player.kills)continue;
        const canvas=createCanvas(region.width,region.height);canvas.getContext('2d').drawImage(original,0,0,canvas.width,canvas.height);
        const prepared=root.WarOCR.prepare(canvas,region.digits,'digits',createCanvas,1),feature=root.WarOCR.digitFeature(prepared.canvas);
        if(!feature||prepared.ink<3)continue;
        canvas.ocrOriginal=original;const crop=root.WarOCR.originalRegion(canvas,region.digits),raw=createCanvas(crop.box[2],crop.box[3]);raw.getContext('2d').drawImage(crop.source,...crop.box,0,0,raw.width,raw.height);
        candidates.push({id:match.id+':'+row.placement+':'+index,matchId:match.id,placement:row.placement,player:index,label:player.kills,previous:observed.kills,feature,crop:raw.toDataURL('image/png'),source:source.fileKey,reviewedAt:match.created,ink:prepared.ink});
      }
      // One crop per corrected field; overlapping frames are not independent training examples.
      candidates.sort((a,b)=>b.ink-a.ink);if(candidates[0])records.push(candidates[0]);
    });}
    return records;
  }
  async function store(records){if(!records.length)return 0;const db=await database();try{await new Promise((resolve,reject)=>{const tx=db.transaction('examples','readwrite'),table=tx.objectStore('examples');records.forEach(r=>table.put(r));const request=table.getAll();request.onsuccess=()=>{const all=request.result.sort((a,b)=>String(b.reviewedAt).localeCompare(String(a.reviewedAt)));all.slice(500).forEach(r=>table.delete(r.id));};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Could not save OCR examples.'));});}finally{db.close();}await load();return records.length;}
  async function download(){const records=await examples();const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,kind:'reviewed-kill-crops',examples:records},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='ffk-reviewed-ocr-examples.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return records.length;}
  const api={load,capture,store,download,eligible};if(typeof module!=='undefined')module.exports=api;else root.WarOCRLearning=api;
})(typeof window!=='undefined'?window:globalThis);
