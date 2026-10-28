/* Fixed-layout extraction. Isolate names and yellow digits before recognizing text. */
(function(root){
  // Normalize only comparison keys: original roster/display names are never rewritten.
  const lookalikes={'а':'a','α':'a','е':'e','ε':'e','ο':'o','о':'o','р':'p','ρ':'p','с':'c','ϲ':'c','х':'x','χ':'x','і':'i','ι':'i','ј':'j','κ':'k','к':'k','м':'m','μ':'m','т':'t','τ':'t','ν':'v','υ':'y','у':'y','ѕ':'s'};
  const normalize=s=>String(s||'').normalize('NFKD').toLowerCase().replace(/\p{M}/gu,'').replace(/[аαеεοорρсϲхχіιјκкмμтτνυуѕ]/gu,c=>lookalikes[c]).replace(/ffk/g,'').replace(/[^\p{L}\p{N}]/gu,'');
  function digitFeature(canvas){const ctx=canvas.getContext('2d'),{width:w,height:h}=canvas,d=ctx.getImageData(0,0,w,h).data;let x0=w,y0=h,x1=-1,y1=-1;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(d[(y*w+x)*4]<130){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}if(x1<x0)return null;const values=[];for(let y=0;y<24;y++)for(let x=0;x<16;x++){const sx=Math.min(x1,Math.round(x0+(x+.5)*(x1-x0)/16)),sy=Math.min(y1,Math.round(y0+(y+.5)*(y1-y0)/24));values.push(Math.round((255-d[(sy*w+sx)*4])/255*100));}return {aspect:(x1-x0+1)/(y1-y0+1),values};}
  function templateDigit(canvas,templates){const f=digitFeature(canvas);if(!f||!templates?.length)return null;const bestByValue=new Map();for(const t of templates){const distance=f.values.reduce((n,v,i)=>n+Math.abs(v-t.values[i])/100,0)/384+Math.abs(f.aspect-t.aspect)*.2;const old=bestByValue.get(t.label);if(old===undefined||distance<old)bestByValue.set(t.label,distance);}const ranked=[...bestByValue].sort((a,b)=>a[1]-b[1]);return ranked[0][1]<.18&&(ranked[1]?.[1]??1)-ranked[0][1]>.07?{value:Number(ranked[0][0]),distance:ranked[0][1]}:null;}
  function similarity(a,b){a=normalize(a);b=normalize(b);if(!a||!b)return 0;let row=Array.from({length:a.length+1},(_,i)=>i);for(let i=1;i<=b.length;i++){const next=[i];for(let j=1;j<=a.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(b[i-1]===a[j-1]?0:1));row=next;}
    let result=1-row[a.length]/Math.max(a.length,b.length);
    // Ignore decorative prefixes and numeric suffixes, without changing stored roster names.
    if(b.length>=3){let previous=new Array(a.length+1).fill(0);for(let i=1;i<=b.length;i++){const next=[i];for(let j=1;j<=a.length;j++)next[j]=Math.min(next[j-1]+1,previous[j]+1,previous[j-1]+(b[i-1]===a[j-1]?0:1));previous=next;}const distance=Math.min(...previous);result=Math.max(result,1-distance/b.length);}
    // Decorative digits are a fallback, with a penalty so meaningful IDs still win.
    const lettersA=a.replace(/\p{N}/gu,''),lettersB=b.replace(/\p{N}/gu,'');
    if(lettersB.length>=4&&lettersA.includes(lettersB))result=Math.max(result,.9);
    return result;}
  function prepare(source,box,mode,createCanvas,variant=0){
    const [x,y,w,h]=box,scale=4,pad=16,raw=createCanvas(w,h),ctx=raw.getContext('2d');
    ctx.drawImage(source,x,y,w,h,0,0,w,h);
    const pixels=ctx.getImageData(0,0,w,h);let count=0,minX=w,minY=h,maxX=0,maxY=0;
    for(let i=0;i<pixels.data.length;i+=4){const r=pixels.data[i],g=pixels.data[i+1],b=pixels.data[i+2];
      const foreground=mode==='digits'?r>(variant===2?95:155)&&g>(variant===2?75:125)&&r-b>(variant===2?45:75)&&g-b>(variant===2?35:60):b>65;
      if(foreground){count++;const x=(i/4)%w,y=Math.floor(i/4/w);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
      const value=mode==='digits'?(variant?(foreground?0:255):255-Math.max(0,Math.min(255,(Math.min(r,g)-b-45)*4))):255-Math.max(0,Math.min(255,(b-(variant?15:35))*2.5));
      pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=value;pixels.data[i+3]=255;
    }
    ctx.putImageData(pixels,0,0);const tight=mode==='digits'&&count>2,sx=tight?Math.max(0,minX-1):0,sy=tight?Math.max(0,minY-1):0,sw=tight?Math.min(w-sx,maxX-minX+3):w,sh=tight?Math.min(h-sy,maxY-minY+3):h;
    const out=createCanvas(sw*scale+pad*2,sh*scale+pad*2),outCtx=out.getContext('2d');outCtx.fillStyle='white';outCtx.fillRect(0,0,out.width,out.height);outCtx.imageSmoothingEnabled=true;outCtx.drawImage(raw,sx,sy,sw,sh,pad,pad,sw*scale,sh*scale);return {canvas:out,ink:count};
  }
  function originalRegion(source,box){
    if(!source.ocrOriginal)return {source,box};
    const original=source.ocrOriginal,sx=(original.naturalWidth||original.width)/source.width,sy=(original.naturalHeight||original.height)/source.height;
    const x=Math.max(0,Math.floor(box[0]*sx)),y=Math.max(0,Math.floor(box[1]*sy));
    return {source:original,box:[x,y,Math.min((original.naturalWidth||original.width)-x,Math.ceil((box[0]+box[2])*sx)-x),Math.min((original.naturalHeight||original.height)-y,Math.ceil((box[1]+box[3])*sy)-y)]};
  }
  function prepareOriginal(source,box,mode,createCanvas,variant=0){const region=originalRegion(source,box);return prepare(region.source,region.box,mode,createCanvas,variant);}
  async function originalDigit(worker,source,box,createCanvas){
    if(!source.ocrOriginal||(source.ocrOriginal.naturalWidth||source.ocrOriginal.width)<=source.width)return null;
    const votes=[];
    for(const segmentation of ['7','8','10']){await worker.setParameters({tessedit_pageseg_mode:segmentation,tessedit_char_whitelist:'0123456789'});votes.push((await worker.recognize(prepareOriginal(source,box,'digits',createCanvas,segmentation==='10'?1:0).canvas.toDataURL())).data);}
    const counts=new Map();votes.filter(v=>/^\d{1,2}$/.test(v.text.trim())&&v.confidence>=60).forEach(v=>counts.set(Number(v.text.trim()),(counts.get(Number(v.text.trim()))||0)+1));
    const winner=[...counts].sort((a,b)=>b[1]-a[1])[0];return winner&&winner[1]>=2?winner[0]:null;
  }
  function smallDigitConsensus(votes){
    const valid=votes.filter(v=>/^\d{1,2}$/.test(v.text.trim())&&v.confidence>=45);
    const values=new Set(valid.map(v=>Number(v.text.trim())));
    if(values.size!==1||valid.length<2)return null;
    const value=Number(valid[0].text.trim());return value===0||value===1?value:null;
  }
  async function retrySmallDigit(worker,source,box,createCanvas,previous){
    const votes=[...previous];
    // A tighter, lower-threshold crop preserves thin 1s and faint zero outlines.
    for(const segmentation of ['10','8']){
      const crop=prepareOriginal(source,box,'digits',createCanvas,2);
      if(crop.ink<3)return null;
      await worker.setParameters({tessedit_pageseg_mode:segmentation,tessedit_char_whitelist:'0123456789'});
      votes.push((await worker.recognize(crop.canvas.toDataURL())).data);
    }
    return smallDigitConsensus(votes);
  }
  async function read(worker,source,box,mode,createCanvas,variant=0){const p=(mode==='name'&&source.ocrOriginal&&(source.ocrOriginal.naturalWidth||source.ocrOriginal.width)>source.width?prepareOriginal:prepare)(source,box,mode,createCanvas,variant);if(p.ink<3)return {text:'',confidence:0};await worker.setParameters({tessedit_pageseg_mode:mode==='rank'?'6':'7',tessedit_char_whitelist:mode==='digits'||mode==='rank'?'0123456789':''});const {data}=await worker.recognize(p.canvas.toDataURL(),{},mode==='rank'?{blocks:true,text:true}:undefined);if(!data.words&&data.blocks)data.words=data.blocks.flatMap(b=>(b.paragraphs||[]).flatMap(p=>(p.lines||[]).flatMap(l=>l.words||[])));return data;}
  // Match distinctive roster words, ignoring clan tags and decorative OCR fragments.
  function rosterSimilarity(observed,registered){
    const identity=value=>normalize(value).replace(/^ko(?=[a-z]{3})/,'');
    const a=identity(observed),b=identity(registered);
    if(!a||!b||a==='ko'||a==='ffk')return 0;
    if(a===b)return 1;
    const words=String(observed||'').split(/[^\p{L}\p{N}]+/u).map(normalize).filter(Boolean);
    if(b.length>=3&&words.includes(b))return .98;
    if(b.length>=4&&a.includes(b))return .96;
    // Short names need a complete word, or only a small clan-tag remnant.
    if(b.length<=3){
      // A single trailing OCR digit is common on decorated short names (Ram0?).
      // Require an isolated token; RAMBO and meaningful IDs such as RAM123 stay distinct.
      if(b.length===3&&words.some(word=>word.length===4&&word.startsWith(b)&&/\d$/.test(word)))return .94;
      return b.length===3&&a.endsWith(b)&&a.length-b.length<=2?.94:0;
    }
    return Math.min(.89,similarity(a,b));
  }
  function playerSimilarity(observed,player){const key=normalize(observed);return key.length>=4&&(player.ocrAliases||[]).some(alias=>normalize(alias)===key)?1:rosterSimilarity(observed,player.name);}
  function rowSimilarity(row,player){return row.identityEdited?(row.isSubstitute?0:row.playerId===player.id?1:-1):playerSimilarity(row.rawName||row.name,player);}
  function assignment(players,team){let best={score:-1,indices:[]};function visit(i,used,sum,indices){if(i===4){if(sum>best.score)best={score:sum,indices:[...indices]};return;}team.players.forEach((p,j)=>{if(!used.has(j)){used.add(j);visit(i+1,used,sum+rowSimilarity(players[i],p),[...indices,j]);used.delete(j);}});}visit(0,new Set(),0,[]);return {...best,score:best.score/4,team};}
  function matchTeam(players,teams,options={}){const ranked=teams.map(t=>assignment(players,t)).filter(t=>t.indices.length===4).sort((a,b)=>b.score-a.score),best=ranked[0];if(!best)return {teamId:'',players};const scores=best.indices.map((j,i)=>rowSimilarity(players[i],best.team.players[j]));const strong=scores.filter(x=>x>=.7).length;const anchors=scores.filter(x=>x>=.94).length;const trusted=teams.length===1&&options.trustedTeamId===best.team.id;const valid=trusted||((best.score>=.58&&strong>=2||best.score>=.45&&anchors>=2)&&best.score-(ranked[1]?.score||0)>=.12);
    if(valid)players.forEach((p,i)=>{if(p.identityEdited)return;const found=best.team.players[best.indices[i]];p.rawName=p.rawName||p.name;p.matchScore=scores[i];const alternatives=best.team.players.filter((_,j)=>j!==best.indices[i]).map(other=>playerSimilarity(p.rawName||p.name,other));if(scores[i]>=.7&&scores[i]-Math.max(0,...alternatives)>=.12){p.playerId=found.id;p.name=found.name;p.isSubstitute=false;}});
    return {teamId:valid?best.team.id:'',players,matchConfidence:best.score};
  }
  function rememberAliases(teams,rows){
    let count=0;
    for(const row of rows){if(!row.confirmed)continue;const team=teams.find(t=>t.id===row.teamId);if(!team)continue;
      for(const p of row.players){
        if(!p.identityEdited||p.isSubstitute||!p.rawName)continue;
        const player=team.players.find(x=>x.id===p.playerId),raw=p.rawName.trim().slice(0,90),key=normalize(raw);
        if(!player||key.length<4||key===normalize(player.name))continue;
        // Keep conflicting corrections unresolved rather than teaching the wrong identity.
        if(team.players.some(other=>other.id!==player.id&&(normalize(other.name)===key||(other.ocrAliases||[]).some(a=>normalize(a)===key))))continue;
        const aliases=player.ocrAliases||[];if(aliases.some(a=>normalize(a)===key))continue;
        player.ocrAliases=[...aliases,raw].slice(-12);count++;
      }
    }
    return count;
  }
  function playerRegion(panel,i){const left=panel.side===0,column=i%2?panel.second:panel.first,cy=i<2?panel.top:panel.bottom,gap=panel.second.x-panel.first.x,killX=Math.floor(column.x0-4),nameX=Math.round(column.x-gap*(left?.52:.67)),height=Math.round(Math.max(25,(panel.bottom-panel.top)*.75));const line=column.lines.find(l=>Math.abs(l.y-cy)<8);const digits=line?[line.x0-2,line.y0-2,line.x1-line.x0+5,line.y1-line.y0+5]:[Math.floor(column.x0-2),Math.round(cy-height/2),Math.ceil(column.x1-column.x0+5),height];return {name:[nameX,Math.round(cy-height/2),killX-nameX-3,height],digits};}
  async function adaptiveExtract(worker,source,teams,createCanvas,onProgress,layout,options){
    const rows=[],panels=layout.panels;
    let comparison=[];
    if(options.compare){onProgress('Comparing detected text with the local OCR engine…',0);try{const boxes=panels.flatMap(p=>Array.from({length:4},(_,i)=>{const r=playerRegion(p,i);return [r.name,r.digits];}).flat());comparison=await options.compare(source.toDataURL('image/png'),boxes);}catch(e){layout.comparisonError=e.message;}}
    // Infer the right-column sequence only from recognized placement labels.
    const recognized=[];
    for(const panel of panels.filter(p=>p.side===1)){
      const result=await read(worker,source,panel.rankBox,'rank',createCanvas),value=Number(result.text.trim());
      if(Number.isInteger(value)&&value>=6&&value<=12)recognized.push({panel,value});
    }
    const rightPanels=panels.filter(p=>p.side===1),offsets=recognized.map(r=>r.value-rightPanels.indexOf(r.panel)),counts=new Map();offsets.forEach(o=>counts.set(o,(counts.get(o)||0)+1));const offsetsRanked=[...counts].sort((a,b)=>b[1]-a[1]);const firstRank=offsetsRanked[0]?.[1]>=2&&offsetsRanked[0][1]>(offsetsRanked[1]?.[1]||0)?offsetsRanked[0][0]:null;
    for(let ai=0;ai<panels.length;ai++){
      const panel=panels[ai],left=panel.side===0,rank=left?panels.filter(p=>p.side===0).indexOf(panel)+1:firstRank!==null?firstRank+rightPanels.indexOf(panel):recognized.find(r=>r.panel===panel)?.value;
      if(!rank||rank>12)continue;
      const players=[];
      for(let i=0;i<4;i++){
        onProgress(`Detected placement ${rank} · player ${i+1}`, (ai*4+i)/(panels.length*4));
        const region=playerRegion(panel,i),nameBox=region.name,digitBox=region.digits;
        let name=await read(worker,source,nameBox,'name',createCanvas);if(name.confidence<65){const alt=await read(worker,source,nameBox,'name',createCanvas,1);if(alt.confidence>name.confidence)name=alt;}
        const secondName=comparison[(ai*4+i)*2];if(secondName?.confidence>=.8&&secondName.confidence*100>name.confidence)name={text:secondName.text,confidence:secondName.confidence*100};
        const votes=[];for(const segmentation of ['7','8','10']){await worker.setParameters({tessedit_pageseg_mode:segmentation,tessedit_char_whitelist:'0123456789'});votes.push((await worker.recognize(prepare(source,digitBox,'digits',createCanvas,segmentation==='10'?1:0).canvas.toDataURL())).data);}
        const counts=new Map();votes.filter(v=>/^\d{1,2}$/.test(v.text.trim())).forEach(v=>counts.set(v.text.trim(),(counts.get(v.text.trim())||0)+1));const winner=[...counts].sort((a,b)=>b[1]-a[1])[0];
        const shape=templateDigit(prepare(source,digitBox,'digits',createCanvas,1).canvas,root.WarDigitTemplates),ocrValue=winner&&winner[1]>=2&&votes.some(v=>v.text.trim()===winner[0]&&v.confidence>=45)?Number(winner[0]):null;
        // On new layouts, a disagreement between the two methods requires review.
        let kills=shape&&ocrValue!==null&&shape.value!==ocrValue?null:ocrValue??shape?.value??null;
        // Original pixels may resolve abstentions, but cannot override conflicting evidence.
        if(kills===null&&!shape&&ocrValue===null){const original=await originalDigit(worker,source,digitBox,createCanvas);if(original!==null&&!votes.some(v=>/^\d{1,2}$/.test(v.text.trim())&&v.confidence>=45&&Number(v.text.trim())!==original))kills=original;}
        if(kills===null&&!shape&&ocrValue===null)kills=await retrySmallDigit(worker,source,digitBox,createCanvas,votes);
        const second=comparison[(ai*4+i)*2+1];if(second?.confidence>=.9&&/^\d{1,2}$/.test(second.text.trim())){const alternative=Number(second.text.trim());kills=kills!==null&&kills!==alternative?null:alternative;}
        players.push({name:name.text.replace(/\s+/g,' ').trim(),playerId:'',kills,killConfidence:Math.max(...votes.map(v=>v.confidence)),ocrRegion:{name:nameBox,digits:digitBox,width:source.width,height:source.height}});
      }
      rows.push({placement:rank,...matchTeam(players,teams)});
    }
    rows.layout={mode:'detected',comparison:comparison.length>0,comparisonError:layout.comparisonError,panels:panels.map(p=>({side:p.side,top:p.top,bottom:p.bottom,rankBox:p.rankBox})),width:source.width,height:source.height};return rows;
  }
  async function extract(worker,source,teams,createCanvas,onProgress=()=>{},options={}){
    const native=createCanvas(1392,Math.round((source.naturalHeight||source.height)*1392/(source.naturalWidth||source.width)));native.getContext('2d').drawImage(source,0,0,native.width,native.height);
    native.ocrOriginal=source;
    const detector=typeof module!=='undefined'?require('./layout.js'):root.WarLayout;
    const layout=detector.detect(native,options.bounds);
    if(options.bounds){
      const manual=options.bounds,columns=layout.columns;if(columns.length!==4)throw Error(layout.reason);
      layout.panels=layout.panels.filter(p=>{const b=manual[p.side],center=(p.top+p.bottom)/2;return !b||(center>=b.y&&center<=b.y+b.height&&p.first.x>=b.x&&p.second.x<=b.x+b.width);});
    }
    const familiar=!options.bounds&&layout.columns.length===4&&Math.abs(layout.columns[0].x-387)<12&&Math.abs(layout.columns[1].x-657)<12&&layout.panels.some(p=>p.side===0&&Math.abs(p.top-179)<8)&&Math.abs(native.height-791)<12;
    if(!familiar){if(!layout.panels.length)throw Error(layout.reason||'Result panels could not be located. Adjust the panel bounds and retry.');return adaptiveExtract(worker,native,teams,createCanvas,onProgress,layout,options);}
    const normalized=createCanvas(1392,790);normalized.getContext('2d').drawImage(source,0,0,1392,790);normalized.ocrOriginal=source;source=normalized;
    const anchors=Array.from({length:5},(_,i)=>({rank:i+1,top:[179,266,354,442,530][i],left:true}));
    // Read only the placement column. Names and kill counts cannot pollute its text.
    const ranks=await read(worker,source,[781,154,40,427],'rank',createCanvas),observed=[];
    for(const w of ranks.words||[]){const rank=Number(w.text.trim()),cy=154+((w.bbox.y0+w.bbox.y1)/2-16)/4;if(Number.isInteger(rank)&&rank>=6&&rank<=12)observed.push({rank,cy});}
    const steps=[];observed.forEach((a,i)=>observed.slice(i+1).forEach(b=>{const step=(b.cy-a.cy)/(b.rank-a.rank);if(step>65&&step<85)steps.push(step);}));
    if(steps.length){steps.sort((a,b)=>a-b);const step=steps[Math.floor(steps.length/2)],bases=observed.map(o=>o.cy-(o.rank-6)*step).sort((a,b)=>a-b),base=bases[Math.floor(bases.length/2)];for(let rank=6;rank<=12;rank++){const cy=base+(rank-6)*step;if(cy>=190&&cy<=550)anchors.push({rank,top:cy-16,left:false});}}
    else for(const o of observed)if(o.cy>=190&&o.cy<=550)anchors.push({rank:o.rank,top:o.cy-16,left:false});
    const unique=anchors.filter((a,i)=>anchors.findIndex(b=>a.rank===b.rank)===i),rows=[];
    for(let ai=0;ai<unique.length;ai++){
      const a=unique[ai],players=[];
      for(let pi=0;pi<4;pi++){
        onProgress(`Placement ${a.rank} · player ${pi+1}`, (ai*4+pi)/(unique.length*4));
        const right=pi%2===1,cy=Math.round(a.top+(pi<2?0:a.left?36:32));
        const nameX=a.left?(right?521:245):(right?1046:838),killX=a.left?(right?649:376):(right?1167:968),killWidth=a.left?(right?19:22):20;
        const nameBox=[nameX,cy-13,killX-nameX-3,27],digitBox=[killX,cy-13,killWidth,27];
        let name=await read(worker,source,nameBox,'name',createCanvas);
        if(name.confidence<60||normalize(name.text).length<3){const alternate=await read(worker,source,nameBox,'name',createCanvas,1);if(alternate.confidence>name.confidence)name=alternate;}
        const number=await read(worker,source,digitBox,'digits',createCanvas),votes=[number];
        for(const segmentation of ['8','10']){await worker.setParameters({tessedit_pageseg_mode:segmentation,tessedit_char_whitelist:'0123456789'});votes.push((await worker.recognize(prepare(source,digitBox,'digits',createCanvas,segmentation==='10'?1:0).canvas.toDataURL())).data);}
        const candidates=votes.filter(v=>/^\d{1,2}$/.test(v.text.trim())),counts=new Map();candidates.forEach(v=>counts.set(v.text.trim(),(counts.get(v.text.trim())||0)+1));const winner=[...counts].sort((a,b)=>b[1]-a[1])[0];
        const shape=templateDigit(prepare(source,digitBox,'digits',createCanvas,1).canvas,root.WarDigitTemplates)||(!a.left?templateDigit(prepare(source,digitBox,'digits',createCanvas,2).canvas,root.WarDigitTemplates):null);
        let kills=shape?shape.value:winner&&winner[1]>=2&&candidates.some(v=>v.text.trim()===winner[0]&&v.confidence>=45)?Number(winner[0]):null;
        if(kills===null&&!shape)kills=await retrySmallDigit(worker,source,digitBox,createCanvas,votes);
        players.push({name:name.text.replace(/\s+/g,' ').trim(),playerId:'',kills,killConfidence:number.confidence,ocrRegion:{name:nameBox,digits:digitBox,width:source.width,height:source.height}});
      }
      rows.push({placement:a.rank,...matchTeam(players,teams)});
    }
    rows.layout={mode:'reference',panels:layout.panels.map(p=>({side:p.side,top:p.top,bottom:p.bottom,rankBox:p.rankBox})),width:1392,height:790};return rows;
  }
  // Convert a /api/ocr/scan response (server-side OCR + reasoning) into the rows the review screen uses.
  function fromServerScan(scan){
    const rows=[];
    for(const panel of scan.panels||[]){
      if(!Number.isInteger(panel.placement)||panel.placement<1||panel.placement>12)continue;
      const players=[0,1,2,3].map(i=>{
        const c=panel.cells[i];
        if(!c)return {name:'',playerId:'',kills:null,killConfidence:0};
        const matched=!!c.playerId;
        const player={name:matched?c.playerName:c.name,playerId:c.playerId||'',kills:c.kills,killConfidence:Math.round((c.killsConf||0)*100),rawName:c.rawName||c.name,matchScore:c.matchScore,serverRead:true,
          ocrRegion:{name:c.boxes.name,digits:c.boxes.digits,width:scan.width,height:scan.height}};
        if(matched)player.isSubstitute=false;
        return player;
      });
      rows.push({placement:panel.placement,teamId:panel.team?.id||'',players,matchConfidence:panel.team?.score||0,warnings:[]});
    }
    rows.layout={mode:'server',panels:(scan.panels||[]).map(p=>({side:p.side,top:p.top,bottom:p.bottom})),width:scan.width,height:scan.height,warnings:scan.warnings||[]};
    return rows;
  }
  function merge(existing,incoming){
    if(!existing._read){Object.assign(existing,incoming,{_read:true});return;}
    if(existing.teamId&&incoming.teamId&&existing.teamId!==incoming.teamId){existing.teamId='';existing.warnings.push('Screenshots disagree on team identity');}
    else if(!existing.teamId&&incoming.teamId&&!existing.warnings.some(w=>w.includes('identity')))existing.teamId=incoming.teamId;
    incoming.players.forEach((p,i)=>{const old=existing.players[i],key=`Screenshots disagree on player ${i+1} kills`;
      if(old.kills!==null&&p.kills!==null&&old.kills!==p.kills){
        // Two screenshots disagree. A much more confident reading wins; otherwise leave it for review.
        const a=old.killConfidence||0,b=p.killConfidence||0;
        if(Math.abs(a-b)>=25&&Math.max(a,b)>=85){if(b>a){old.kills=p.kills;old.killConfidence=b;old.ocrRegion=p.ocrRegion||old.ocrRegion;}}
        else{old.kills=null;if(!existing.warnings.includes(key))existing.warnings.push(key);}
      }
      else if(old.kills===null&&!existing.warnings.includes(key)){old.kills=p.kills;old.killConfidence=p.killConfidence;if(p.ocrRegion)old.ocrRegion=p.ocrRegion;}
      // Two independent screenshots agreeing is stronger evidence than either alone.
      else if(old.kills!==null&&old.kills===p.kills&&p.serverRead)old.killConfidence=Math.min(100,Math.max(old.killConfidence||0,p.killConfidence||0)+10);
      if(p.playerId&&(!old.playerId||(p.matchScore||0)>(old.matchScore||0))){old.playerId=p.playerId;old.name=p.name;old.matchScore=p.matchScore;}
    });
  }
  const api={fromServerScan,prepare,prepareOriginal,originalRegion,extract,matchTeam,merge,similarity,rosterSimilarity,playerSimilarity,rememberAliases,smallDigitConsensus,digitFeature,templateDigit,playerRegion};if(typeof module!=='undefined')module.exports=api;else root.WarOCR=api;
})(typeof window!=='undefined'?window:globalThis);

