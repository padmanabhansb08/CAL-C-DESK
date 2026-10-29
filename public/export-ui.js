/* Exports. "Export" always means the view on screen (teams, players or a graph) as PNG, PDF or CSV.
   Scoreboard artwork is a separate, clearly named option for team standings. */
const LABELS_KEY='ffk-export-labels-v1';
function savedLabels(match){try{return JSON.parse(localStorage.getItem(LABELS_KEY)||'{}')[match.id]||match.posterOptions||{};}catch{return match.posterOptions||{};}}
// Saved per match in this browser, whichever download button is used.
function rememberLabels(match,labels){try{const all=JSON.parse(localStorage.getItem(LABELS_KEY)||'{}');all[match.id]=labels;localStorage.setItem(LABELS_KEY,JSON.stringify(all));}catch{}}
function posterRows(match){return teamRowsFor(match).slice(0,12).map(r=>{const s=score(r);return {name:r.teamName,place:s.placement,kills:s.kills,total:s.total,wins:match.isOverall?r.wins:r.placement===1?1:0,matches:match.isOverall?r.matches:undefined,rank:r.rank};});}
function teamRowsFor(match){return window.resultTeamRows?resultTeamRows(match):rankedRows(match);}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function downloadCanvas(canvas,name,format){if(format==='pdf')downloadBlob(scoreboardPDF(canvas),name+'.pdf');else{const link=document.createElement('a');link.download=name+'.png';link.href=canvas.toDataURL('image/png');link.click();}}

let posterRevision=0;
function posterOptions(){const f=$('#poster-form');return {date:f.date.value?f.date.value.slice(8,10)+'/'+f.date.value.slice(5,7)+'/'+f.date.value.slice(2,4):'',week:f.week.value.trim(),match:f.match.value.trim(),highlight:Number(f.highlight.value)};}
async function updatePoster(){const revision=++posterRevision,buttons=['#poster-download','#poster-pdf'].map(s=>$(s));buttons.forEach(b=>b.disabled=true);const m=resultMatch();try{const offscreen=document.createElement('canvas');const options=posterOptions();if(m.isOverall)options.note=(m.rows.length>12?'TOP 12 OF '+m.rows.length+' TEAMS / ':'')+'OVERALL / '+m.matchCount+' MATCHES / INCLUDES HOST ADJUSTMENTS';await WarScoreboard.render(offscreen,posterRows(m),options);if(revision!==posterRevision||!$('#poster-canvas'))return;const visible=$('#poster-canvas');visible.width=offscreen.width;visible.height=offscreen.height;visible.getContext('2d').drawImage(offscreen,0,0);buttons.forEach(b=>b.disabled=false);$('#poster-error').textContent='';}catch(e){if($('#poster-error'))$('#poster-error').textContent='Could not generate graphic: '+e.message;}}
function openPoster(){
  const m=resultMatch();if(!m)return toast('Save a verified match before creating the scoreboard.','error');
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(m.created)),opts=savedLabels(m);
  modal(`<div class="panel-head"><h2>${m.isOverall?'Overall scoreboard artwork':'Scoreboard artwork'}</h2><button type="button" onclick="openExportChooser()">Back</button></div><p>${m.isOverall?'Overall totals across all '+m.matchCount+' saved matches. '+(m.rows.length>12?'The artwork has room for the top 12 of '+m.rows.length+' teams. Use “Full table” in Export for every team. ':''):'Team standings for this match on the FFK artwork. '}PLACE = placement points. FINISH = kills. TOTAL includes host adjustments.</p>
    <form id="poster-form" class="form-grid"><label>Event date<input name="date" type="date" required value="${esc(opts.isoDate||date)}"></label><label>Week label<input name="week" value="${esc(opts.week||'03')}" maxlength="12"></label><label>Match label<input name="match" value="${esc(opts.match||(m.isOverall?'ALL':String(state.matches.indexOf(m)+1).padStart(2,'0')))}" maxlength="6"></label><label>Red highlighted teams<select name="highlight">${[0,4,6,12].map(n=>`<option value="${n}" ${(opts.highlight??6)===n?'selected':''}>${n===0?'None':'Top '+n}</option>`).join('')}</select></label></form>
    <div class="poster-preview"><canvas id="poster-canvas" aria-label="Live scoreboard artwork preview"></canvas></div><p id="poster-error" class="error" role="alert"></p>
    <div class="actions"><button type="button" class="primary" id="poster-download" disabled>Download PNG ↓</button><button type="button" id="poster-pdf" disabled>Download PDF ↓</button></div><p class="caption">2364 × 1194 pixels · Labels are remembered for this match in this browser.</p>`,{wide:true,className:'brand-dialog'});
  $('#poster-form').oninput=updatePoster;$('#poster-form').onsubmit=e=>e.preventDefault();
  const download=format=>{downloadCanvas($('#poster-canvas'),fileStem(m)+'-FFK-scoreboard',format);rememberLabels(m,{...posterOptions(),isoDate:$('#poster-form').date.value});};
  $('#poster-download').onclick=()=>download('png');$('#poster-pdf').onclick=()=>download('pdf');updatePoster();
}
function downloadPosterPDF(){const canvas=$('#poster-canvas');if(canvas?.width)downloadCanvas(canvas,fileStem(resultMatch())+'-FFK-scoreboard','pdf');}

// A plain, complete table image (every row), used for the full standings and the player leaderboard.
async function tableCanvas({title,subtitle,headers,rows,widths,align}){
  if(document.fonts)await document.fonts.ready;
  const scale=2,width=1200,rowH=38,top=118,height=top+rowH*(rows.length+1)+56,canvas=document.createElement('canvas');canvas.width=width*scale;canvas.height=height*scale;
  const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.fillStyle='#0b0b0c';ctx.fillRect(0,0,width,height);
  ctx.fillStyle='#e50914';ctx.fillRect(40,36,8,52);ctx.fillStyle='#fff';ctx.textBaseline='middle';ctx.font='800 34px "Barlow Condensed", sans-serif';ctx.fillText(String(title).toUpperCase(),62,52);
  ctx.fillStyle='#b8b3b3';ctx.font='500 17px "DM Sans", sans-serif';ctx.fillText(subtitle,62,80);
  const total=widths.reduce((a,b)=>a+b,0),cols=[];let x=40;widths.forEach(w=>{const cw=w/total*(width-80);cols.push([x,cw]);x+=cw;});
  const cell=(text,[cx,cw],y,i,font,color)=>{ctx.save();ctx.beginPath();ctx.rect(cx,y,cw,rowH);ctx.clip();ctx.font=font;ctx.fillStyle=color;const pad=10,right=align?.[i]==='right',value=fitText(ctx,String(text),cw-pad*2);ctx.textAlign=right?'right':'left';ctx.fillText(value,right?cx+cw-pad:cx+pad,y+rowH/2);ctx.restore();};
  ctx.fillStyle='#8e0a0f';ctx.fillRect(40,top,width-80,rowH);headers.forEach((h,i)=>cell(h,cols[i],top,i,'700 16px "Barlow Condensed", sans-serif','#fff'));
  rows.forEach((row,r)=>{const y=top+rowH*(r+1);ctx.fillStyle=r%2?'#151213':'#1c1819';ctx.fillRect(40,y,width-80,rowH);row.forEach((v,i)=>cell(v,cols[i],y,i,(i===row.length-1?'700':'500')+' 17px "DM Sans", sans-serif',i===row.length-1?'#ffcd2e':'#fff'));});
  ctx.fillStyle='#8f8a8a';ctx.font='500 13px "DM Sans", sans-serif';ctx.textAlign='left';ctx.fillText('FFK WAR DESK · '+new Date().toLocaleDateString('en-IN'),40,height-26);
  return canvas;
}
// Shrinks nothing; trims with an ellipsis so text never leaves its cell.
function fitText(ctx,text,max){if(ctx.measureText(text).width<=max)return text;let s=text;while(s.length>1&&ctx.measureText(s+'…').width>max)s=s.slice(0,-1);return s+'…';}
async function graphCanvas(){
  const svg=document.querySelector('#export-graph svg');if(!svg)throw Error('Open the graph first.');
  const clone=svg.cloneNode(true),box=svg.viewBox.baseVal,w=box.width||svg.clientWidth,h=box.height||svg.clientHeight;
  clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width',w);clone.setAttribute('height',h);clone.removeAttribute('style');
  clone.insertAdjacentHTML('afterbegin',`<rect x="0" y="0" width="${w}" height="${h}" fill="#0b0b0c"/><style>text{font-family:"DM Sans",Arial,sans-serif}</style>`);
  const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(clone));await image.decode();
  const scale=2,canvas=document.createElement('canvas');canvas.width=w*scale;canvas.height=h*scale;const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.drawImage(image,0,0,w,h);return canvas;
}
async function viewCanvas(){
  const match=resultMatch(),overall=match.isOverall,subtitle=overall?`Overall · ${match.matchCount} saved matches · ${match.rows.length} teams`:`${match.map}${match.stage?' · Set '+match.stage:''} · ${new Date(match.created).toLocaleDateString('en-IN')}`;
  if(tab==='teams'){
    const rows=teamRowsFor(match);
    return tableCanvas({title:overall?'Overall points table':match.name,subtitle,headers:overall?['#','Team','Played','Wins','Kills','Place','Adj.','Points']:['#','Team','Finish','Kills','Place','Adj.','Points'],widths:overall?[6,34,9,9,9,9,9,11]:[6,40,10,10,10,10,12],align:overall?[0,0,'right','right','right','right','right','right']:[0,0,'right','right','right','right','right'],
      rows:rows.map(r=>{const s=score(r);return overall?[r.rank,r.teamName,r.matches,r.wins,s.kills,s.placement,s.adjustment,s.total]:[r.rank,r.teamName,'#'+r.placement,s.kills,s.placement,s.adjustment,s.total];})});
  }
  if(tab==='players'){const rows=resultPlayerRows(match);return tableCanvas({title:(overall?'Overall':match.name)+' · players',subtitle,headers:['#','Player','Team','Kills'],widths:[6,40,40,14],align:[0,0,0,'right'],rows:rows.map(p=>[p.rank,p.name+(p.isSubstitute?' (sub)':''),p.teamName,p.kills])});}
  return graphCanvas();
}
async function exportView(format){
  const match=resultMatch(),button=document.activeElement;if(button?.tagName==='BUTTON')button.disabled=true;
  try{const canvas=await viewCanvas();downloadCanvas(canvas,fileStem(match)+'-'+tab,format);toast(viewLabel(tab)+' downloaded as '+format.toUpperCase());}
  catch(e){toast('Could not export this view: '+e.message,'error');}
  finally{if(button?.isConnected)button.disabled=false;}
}
function openExportChooser(){
  const match=resultMatch();if(!match)return;const view=viewLabel(tab),teams=tab==='teams';
  const custom=WarTemplates.list(),usage=WarTemplates.usage();
  modal(`<div class="panel-head"><div><span class="caption">${esc(match.isOverall?'Overall points table':match.name)}</span><h2>Export ${esc(view.toLowerCase())}</h2></div><button type="button" onclick="closeModal()">Close</button></div>
    <section class="export-data export-view"><div><strong>${esc(view)}${teams&&match.isOverall?` · all ${match.rows.length} teams`:''}</strong><p>Exactly what is on screen${tab==='players'?', every player':teams?', every team':''}.</p></div><div class="actions"><button type="button" class="primary" data-export="png">${uiIcon('image',{size:'sm'})} <span>PNG</span></button><button type="button" data-export="pdf">${uiIcon('download',{size:'sm'})} <span>PDF</span></button><button type="button" id="choose-csv">${uiIcon('download',{size:'sm'})} <span>CSV</span></button></div></section>
    <h3 class="export-section-title">Scoreboard artwork${teams?'':' · team standings'}</h3>
    ${teams?'':`<p class="caption">Artwork always shows team standings, not the ${esc(view.toLowerCase())}.</p>`}
    <div class="export-templates"><button type="button" class="export-template" id="choose-original"><img src="assets/scoreboard-reference.png" alt=""><span><strong>FFK scoreboard artwork</strong><small>${match.isOverall&&match.rows.length>12?'Top 12 of '+match.rows.length+' teams':'Team standings'} · PNG or PDF</small></span>${uiIcon('chevron_right',{size:'sm'})}</button>
    ${custom.map(t=>`<div class="export-template-row"><button type="button" class="export-template" data-custom-template="${esc(t.id)}"><img src="${esc(t.image)}" alt=""><span><strong>${esc(t.name)}</strong><small>Saved in this browser · team standings</small></span>${uiIcon('chevron_right',{size:'sm'})}</button><button type="button" class="danger template-delete" data-delete-template="${esc(t.id)}" aria-label="Delete template ${esc(t.name)}">${uiIcon('delete',{size:'sm'})}</button></div>`).join('')}
    <button type="button" class="export-template add-template" id="choose-add"><span class="export-layout-preview add-template-preview" aria-hidden="true">${uiIcon('add',{size:'md'})}</span><span><strong>Add template</strong><small>Upload artwork and place the results table</small></span>${uiIcon('chevron_right',{size:'sm'})}</button></div>
    <details class="template-tools"><summary>Manage saved templates${custom.length?' · '+custom.length:''}</summary><p class="caption">${custom.length} template${custom.length===1?'':'s'} using about ${usage} of this browser’s storage. Move them to another browser with a template file.</p><div class="actions"><button type="button" id="templates-export" ${custom.length?'':'disabled'}>Save template file</button><label class="button-like">Load template file<input type="file" id="templates-import" accept="application/json,.json" class="native-file-input"></label></div></details>`,{width:'min(780px,96vw)',className:'brand-dialog'});
  document.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>exportView(b.dataset.export));
  $('#choose-csv').onclick=()=>downloadCSV();
  $('#choose-original').onclick=()=>openPoster();
  $('#choose-add').onclick=()=>WarTemplates.open(null,openExportChooser);
  document.querySelectorAll('[data-custom-template]').forEach(b=>b.onclick=()=>WarTemplates.open(WarTemplates.list().find(t=>t.id===b.dataset.customTemplate),openExportChooser));
  document.querySelectorAll('[data-delete-template]').forEach(b=>b.onclick=async()=>{const t=WarTemplates.list().find(x=>x.id===b.dataset.deleteTemplate);closeModal();if(t&&await confirmAction({title:'Delete template?',message:`“${t.name}” will be removed from this browser.`,accept:'Delete template',cancel:'Keep template'})){WarTemplates.remove(t.id);toast('Template deleted');}openExportChooser();});
  $('#templates-export').onclick=()=>WarTemplates.exportAll();
  $('#templates-import').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const n=await WarTemplates.importFile(file);toast(n+' template'+(n===1?'':'s')+' loaded');openExportChooser();}catch(error){toast('Could not load templates: '+error.message,'error');}};
}
