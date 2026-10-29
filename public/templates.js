/* Custom scoreboard artwork, kept in this browser. Saved match data is never changed.
   Place the results table by dragging on the preview (or with the arrow keys); exact percentages stay
   available under "Exact position". */
(function(){
 const key='ffk-export-templates-v1';
 function list(){try{return JSON.parse(localStorage.getItem(key)||'[]');}catch{return [];}}
 function store(items){localStorage.setItem(key,JSON.stringify(items));}
 function remove(id){store(list().filter(t=>t.id!==id));}
 function usage(){const bytes=(localStorage.getItem(key)||'').length*2;return bytes>1e6?(bytes/1e6).toFixed(1)+' MB':Math.max(1,Math.round(bytes/1e3))+' KB';}
 function exportAll(){const blob=new Blob([JSON.stringify({format:'ffk-templates-v1',templates:list()})],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='ffk-scoreboard-templates.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
 async function importFile(file){
  if(file.size>40*1024*1024)throw Error('The file is too large.');
  const data=JSON.parse(await file.text()),incoming=Array.isArray(data?.templates)?data.templates:[];
  const valid=incoming.filter(t=>t&&typeof t.name==='string'&&typeof t.image==='string'&&t.image.startsWith('data:image/')&&['x','y','width','height'].every(k=>Number.isFinite(t[k])));
  if(!valid.length)throw Error('No templates were found in this file.');
  const items=list();valid.forEach(t=>{const clean={id:String(t.id||'custom-'+Date.now()),name:t.name.slice(0,60),image:t.image,x:t.x,y:t.y,width:t.width,height:t.height};const i=items.findIndex(x=>x.id===clean.id);if(i<0)items.push(clean);else items[i]=clean;});
  try{store(items);}catch{throw Error('Browser storage is full. Delete a template first.');}
  return valid.length;
 }
 let revision=0;
 function open(template,onBack){
  let artwork=template?.image||'',preview=null,artImage=null;
  const box={x:template?.x??5,y:template?.y??25,width:template?.width??65,height:template?.height??65};
  modal(`<div class="panel-head"><h2>${template?'Use template':'Add template'}</h2><button type="button" id="template-back">Back</button></div><p>Upload blank scoreboard artwork, then drag on the preview to place the results table. Drag the box to move it and its corner to resize it, or use the arrow keys (Shift + arrows resizes).</p>
   <form id="template-editor"><label>Template name<input name="title" maxlength="60" required value="${esc(template?.name||'')}" placeholder="e.g. FFK weekly finals"></label><label>Artwork · PNG, JPG or WebP, up to 15 MB<input id="template-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
   <details class="template-exact"><summary>Exact position</summary><div class="template-position">${[['x','Left'],['y','Top'],['width','Width'],['height','Height']].map(([name,label])=>`<label>${label} %<input name="${name}" type="number" step="0.5" min="${name==='width'||name==='height'?10:0}" max="100" value="${box[name]}" required></label>`).join('')}</div></details></form>
   <p id="template-error" class="error" role="alert"></p>
   <div class="template-stage" hidden><canvas id="template-preview" tabindex="0" role="application" aria-label="Template preview. Arrow keys move the results table; Shift and arrow keys resize it." aria-describedby="template-position-status"></canvas><p id="template-position-status" class="caption" aria-live="polite"></p></div>
   <div class="actions"><button type="button" class="primary" id="template-save" disabled>Save template</button><button type="button" id="template-png" disabled>Download PNG</button><button type="button" id="template-pdf" disabled>Download PDF</button></div>`,{wide:true});
  $('#template-back').onclick=onBack;
  const form=$('#template-editor'),canvas=$('#template-preview'),stage=document.querySelector('.template-stage'),status=$('#template-position-status');
  const clamp=()=>{box.width=Math.min(100,Math.max(10,box.width));box.height=Math.min(100,Math.max(10,box.height));box.x=Math.min(100-box.width,Math.max(0,box.x));box.y=Math.min(100-box.height,Math.max(0,box.y));['x','y','width','height'].forEach(k=>{box[k]=Math.round(box[k]*2)/2;form.elements[k].value=box[k];});status.textContent=`Table at ${box.x}% from the left, ${box.y}% from the top, ${box.width}% wide, ${box.height}% high.`;};
  function values(){return {id:template?.id||'custom-'+Date.now(),name:form.elements.title.value.trim(),image:artwork,...box};}
  let pending=0;
  function schedule(){cancelAnimationFrame(pending);pending=requestAnimationFrame(update);}
  async function update(){
   const token=++revision;preview=null;['save','png','pdf'].forEach(k=>$('#template-'+k).disabled=true);if(!artwork)return;
   try{const data=values();if(!form.elements.title.value.trim())throw Error('Enter a template name.');const off=document.createElement('canvas');await draw(off,data);if(token!==revision||!$('#template-preview'))return;
    canvas.width=off.width;canvas.height=off.height;const ctx=canvas.getContext('2d');ctx.drawImage(off,0,0);
    const x=box.x/100*off.width,y=box.y/100*off.height,w=box.width/100*off.width,h=box.height/100*off.height,line=Math.max(2,off.width/400);
    ctx.strokeStyle='#68e7f3';ctx.lineWidth=line;ctx.setLineDash([line*4,line*3]);ctx.strokeRect(x,y,w,h);ctx.setLineDash([]);ctx.fillStyle='#68e7f3';const handle=Math.max(10,off.width/90);ctx.fillRect(x+w-handle,y+h-handle,handle,handle);
    stage.hidden=false;preview=off;$('#template-error').textContent='';['save','png','pdf'].forEach(k=>$('#template-'+k).disabled=false);
   }catch(e){if($('#template-error'))$('#template-error').textContent=e.message;}
  }
  form.oninput=e=>{if(['x','y','width','height'].includes(e.target.name)){box[e.target.name]=Number(e.target.value);if(Number.isFinite(box[e.target.name])){clamp();}}schedule();};form.onsubmit=e=>e.preventDefault();
  // Direct manipulation on the preview.
  const pointer=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width*100,y:(e.clientY-r.top)/r.height*100};};
  let drag=null;
  canvas.onpointerdown=e=>{if(!artwork)return;const p=pointer(e),corner=Math.abs(p.x-(box.x+box.width))<3&&Math.abs(p.y-(box.y+box.height))<4,inside=p.x>=box.x&&p.x<=box.x+box.width&&p.y>=box.y&&p.y<=box.y+box.height;
   drag={mode:corner?'resize':inside?'move':'draw',start:p,origin:{...box}};canvas.setPointerCapture(e.pointerId);canvas.focus({preventScroll:true});};
  canvas.onpointermove=e=>{const p=pointer(e);if(!drag){const corner=Math.abs(p.x-(box.x+box.width))<3&&Math.abs(p.y-(box.y+box.height))<4,inside=p.x>=box.x&&p.x<=box.x+box.width&&p.y>=box.y&&p.y<=box.y+box.height;canvas.style.cursor=corner?'nwse-resize':inside?'move':'crosshair';return;}
   const dx=p.x-drag.start.x,dy=p.y-drag.start.y,o=drag.origin;
   if(drag.mode==='move'){box.x=o.x+dx;box.y=o.y+dy;}else if(drag.mode==='resize'){box.width=o.width+dx;box.height=o.height+dy;}else{box.x=Math.min(drag.start.x,p.x);box.y=Math.min(drag.start.y,p.y);box.width=Math.abs(dx);box.height=Math.abs(dy);}
   clamp();schedule();};
  canvas.onpointerup=()=>{drag=null;};
  canvas.onkeydown=e=>{const step=e.altKey?0.5:1,d={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];if(!d)return;e.preventDefault();if(e.shiftKey){box.width+=d[0];box.height+=d[1];}else{box.x+=d[0];box.y+=d[1];}clamp();schedule();};
  $('#template-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>15*1024*1024){$('#template-error').textContent='Choose a PNG, JPG or WebP under 15 MB.';return;}try{const url=URL.createObjectURL(file);try{const image=new Image();image.src=url;await image.decode();const c=document.createElement('canvas'),scale=Math.min(1,2000/Math.max(image.width,image.height));c.width=Math.round(image.width*scale);c.height=Math.round(image.height*scale);const ctx=c.getContext('2d');ctx.fillStyle='#0b0b0c';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(image,0,0,c.width,c.height);artwork=c.toDataURL('image/jpeg',.9);}finally{URL.revokeObjectURL(url);}if(!form.elements.title.value)form.elements.title.value=file.name.replace(/\.[^.]+$/,'');clamp();await update();}catch{$('#template-error').textContent='Could not read this image. Try another file.';}};
  $('#template-save').onclick=()=>{if(!preview)return;try{const data=values(),items=list(),index=items.findIndex(t=>t.id===data.id);if(index<0)items.push(data);else items[index]=data;store(items);onBack();toast('Template saved in this browser');}catch{$('#template-error').textContent='Browser storage is full. Delete an old template (Export → Manage saved templates) or use smaller artwork; your existing templates are unchanged.';}};
  function download(format){if(!preview)return;const name=(values().name||'FFK-template').replace(/[^a-z0-9]/gi,'-');if(format==='png'){const link=document.createElement('a');link.download=name+'.png';link.href=preview.toDataURL('image/png');link.click();}else{const url=URL.createObjectURL(scoreboardPDF(preview)),link=document.createElement('a');link.href=url;link.download=name+'.pdf';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}}
  $('#template-png').onclick=()=>download('png');$('#template-pdf').onclick=()=>download('pdf');clamp();if(artwork)update();
 }
 async function draw(canvas,data){
  const image=new Image();image.src=data.image;await image.decode();if(document.fonts)await document.fonts.ready;canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const match=resultMatch(),rows=(window.resultTeamRows?resultTeamRows(match):rankedRows(match)).map(r=>{const s=score(r);return {name:r.teamName,place:s.placement,kills:s.kills,total:s.total,wins:match.isOverall?r.wins:r.placement===1?1:0,matches:match.isOverall?r.matches:state.matches.indexOf(match)+1,rank:r.rank};}),x=data.x/100*canvas.width,y=data.y/100*canvas.height,w=data.width/100*canvas.width,h=data.height/100*canvas.height,rh=h/(rows.length+1),fractions=[0,.07,.4,.51,.64,.77,.9,1],font=Math.max(9,Math.min(rh*.5,w/40));
  ctx.fillStyle='#0b0b0c';ctx.fillRect(x,y,w,h);ctx.textBaseline='middle';
  const headers=['POS','TEAM','MATCH','PLACE','KILLS','TOTAL','WINS'];
  function row(values,index){const top=y+index*rh;ctx.fillStyle=index===0?'#8e0a0f':index%2?'#151213':'#0b0b0c';ctx.fillRect(x,top,w,rh);values.forEach((value,c)=>{ctx.save();const left=x+fractions[c]*w,width=(fractions[c+1]-fractions[c])*w;ctx.beginPath();ctx.rect(left,top,width,rh);ctx.clip();ctx.fillStyle=index===1?'#b8962e':'#fff';let size=font;ctx.font=`700 ${size}px sans-serif`;while(ctx.measureText(String(value)).width>width-8&&size>6){size--;ctx.font=`700 ${size}px sans-serif`;}let text=String(value);while(text.length>1&&ctx.measureText(text).width>width-8)text=text.slice(0,-2)+'…';ctx.textAlign=c===1?'left':'center';ctx.fillText(text,c===1?left+4:left+width/2,top+rh/2);ctx.restore();});}
  row(headers,0);rows.forEach((r,i)=>row([r.rank??i+1,r.name,r.matches??1,r.place,r.kills,r.total,r.wins],i+1));return canvas;
 }
 window.WarTemplates={list,open,draw,remove,usage,exportAll,importFile};
})();
