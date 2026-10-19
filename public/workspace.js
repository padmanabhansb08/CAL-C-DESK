/* Approved UX direction: compact match desk, recoverable drafts, evidence beside edits. */
(function(){
  const prior={render,bind,bindReview,review,overview,roster,intake,results,redrawReview,api,finalize,discard,toast,init,go,logout};
  let rosterQuery='',reviewMode='pending',pendingFiles=[],lastRemote='',syncing=false,draftTimer,noticeTimer,draftSaved=true,lastReviewedDraft='',lastDraftJSON='';
  const draftKey='ffk-match-draft-v1';
  let previewURLs=[];
  function clearUploadPreviews(){previewURLs.forEach(url=>URL.revokeObjectURL(url));previewURLs=[];}
  const canvas=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
  function savedDraft(){try{return JSON.parse(localStorage.getItem(draftKey)||'null');}catch{return null;}}
  function remember(){
    if(!draft)return;
    if($('#match-name'))draft.name=$('#match-name').value;
    if($('#match-map'))draft.map=$('#match-map').value;
    const serialized=JSON.stringify(draft);let cropsOmitted=false;
    try{if(serialized!==lastDraftJSON){localStorage.setItem(draftKey,JSON.stringify({version:1,draft,savedAt:new Date().toISOString()}));lastDraftJSON=serialized;}draftSaved=true;}
    catch{try{localStorage.setItem(draftKey,JSON.stringify({version:1,draft},(key,value)=>key==='evidenceCrop'?undefined:value));draftSaved=true;cropsOmitted=true;}catch{draftSaved=false;}}
    const status=$('#draft-status');if(status)status.textContent=draftSaved?(cropsOmitted?'Draft saved · keep original images for evidence':'Draft saved on this device'):'Draft could not be saved — keep this tab open';
  }
  function forget(){lastDraftJSON='';try{localStorage.removeItem(draftKey);}catch{}}
  function valid(row){const team=state.teams.find(t=>t.id===row.teamId);return !!team&&row.players.length===4&&row.players.every(p=>p.playerId&&(p.isSubstitute||team.players.some(x=>x.id===p.playerId))&&p.name.trim()&&Number.isInteger(p.kills)&&p.kills>=0&&p.kills<=99)&&new Set(row.players.map(p=>p.playerId)).size===4&&!draft.rows.some(r=>r!==row&&r.teamId===row.teamId);}
  function cropMarkup(row,index){
    const source=images.find(s=>s.rows?.some(r=>r.placement===row.placement&&r.players[index]?.ocrRegion));
    const observed=source?.rows.find(r=>r.placement===row.placement)?.players[index],region=observed?.ocrRegion;
    if(!source?.image||!region)return row.players[index].evidenceCrop?`<img class="evidence-crop" src="${esc(row.players[index].evidenceCrop)}" alt="Saved screenshot evidence for placement ${row.placement}, player ${index+1}">`:'<span class="crop-empty">No source crop · enter manually or reattach screenshots</span>';
    const image=source.image,sx=(image.naturalWidth||image.width)/region.width,sy=(image.naturalHeight||image.height)/region.height;
    const x=Math.max(0,Math.floor(region.name[0]*sx)),y=Math.max(0,Math.floor(Math.min(region.name[1],region.digits[1])*sy));
    const right=Math.min(image.naturalWidth||image.width,Math.ceil((region.digits[0]+region.digits[2])*sx)),bottom=Math.min(image.naturalHeight||image.height,Math.ceil(Math.max(region.name[1]+region.name[3],region.digits[1]+region.digits[3])*sy));
    const c=canvas(right-x,bottom-y);c.getContext('2d').drawImage(image,x,y,c.width,c.height,0,0,c.width,c.height);
    row.players[index].evidenceCrop=c.toDataURL();
    return `<img class="evidence-crop" src="${row.players[index].evidenceCrop}" alt="Screenshot evidence for placement ${row.placement}, player ${index+1}">`;
  }
  toast=function(message,type){
    const error=type==='error'||/could not|cannot|failed|unable|unavailable|select a|enter |confirm all|different team|missing|refresh|wait for/i.test(message);
    const node=$('#toast');clearTimeout(noticeTimer);node.className=error?'toast-error':'toast-success';node.setAttribute('role',error?'alert':'status');node.replaceChildren();
    const text=document.createElement('span');text.textContent=message;node.append(text);
    const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','Dismiss notification');close.onclick=()=>node.style.display='none';node.append(close);node.style.display='flex';
    if(!error)noticeTimer=setTimeout(()=>node.style.display='none',6000);
  };
  api=async function(path,data){
    if(path==='state'&&data!==undefined){
      const latest=await prior.api('state');if(lastRemote&&JSON.stringify(latest)!==lastRemote)throw Error('Newer changes exist. Refresh workspace before saving; your match draft is kept.');
      const response=await prior.api(path,data);lastRemote=JSON.stringify(data);return response;
    }
    const response=await prior.api(path,data);if(path==='state'||path==='matches/delete')lastRemote=JSON.stringify(response);return response;
  };
  window.refreshWorkspace=async function(manual=false){
    if(busy||syncing||$('#modal')?.open)return;syncing=true;
    try{const latest=await api('state');const changed=JSON.stringify(latest)!==JSON.stringify(state);state=latest;const status=$('#sync-status');if(status)status.textContent='Up to date';if(changed&&!draft&&!$('#modal')?.open)render();else if(changed&&draft&&manual)redrawReview();if(manual)toast('Workspace refreshed');}
    catch(e){const status=$('#sync-status');if(status)status.textContent='Offline · retry refresh';if(manual)toast(e.message,'error');}finally{syncing=false;}
  };
  go=function(next){if(busy)return toast('Wait for screenshot reading to finish.');remember();page=next;render();refreshWorkspace();};
  overview=function(){
    return prior.overview().replace('Every point. Accounted for.','Match desk').replace('From the final zone to the final standings. Your match desk, in one place.','Upload results, check the uncertain fields, and share the standings.').replace('<div class="stats">',`${savedDraft()?'<div class="resume-banner"><div><strong>Unfinished match</strong><p>Your saved draft is ready to continue.</p></div><button class="primary" onclick="resumeMatchDraft()">Resume match →</button></div>':''}<div class="stats">`);
  };
  window.resumeMatchDraft=function(){const stored=savedDraft();if(!stored?.draft)return toast('No saved draft found.');draft=stored.draft;draft.rows.forEach(row=>{if(!valid(row))row.confirmed=false;});page='upload';reviewMode='pending';render();};
  roster=function(){return prior.roster().replace('<div class="team-grid">',`<div class="search-bar"><label for="roster-search">Find a team or player<input id="roster-search" type="search" placeholder="Search name…" value="${esc(rosterQuery)}"></label><span id="roster-count" class="caption"></span></div><p id="roster-empty" hidden>No teams match your search.</p><div class="team-grid">`);};
  intake=function(){
    const reviewed=draft?.rows.filter(r=>r.confirmed).length||0;
    return header('Match workflow',draft?'Check match results':'New match')+`<ol class="workflow"><li class="${draft?'done':'current'}"><b>1</b> Upload</li><li class="${draft?'current':''}"><b>2</b> Check results</li><li class="${reviewed===12?'current':''}"><b>3</b> Save & export</li></ol><details class="panel intake-panel" open><summary>Sources & match settings</summary><div class="form-grid"><label>Match name<input id="match-name" maxlength="70" value="${esc(draft?.name||'Match '+(state.matches.length+1))}"></label><label>Map<select id="match-map">${['Bermuda','Purgatory','Solara','Kalahari','NexTerra','Alpine'].map(map=>`<option ${draft?.map===map?'selected':''}>${map}</option>`).join('')}</select></label></div><div class="dropzone" id="dropzone"><h2>Upload result screenshots</h2><p>Drag images here or choose files. Cover all 12 placements.</p><input id="screenshots" aria-label="Result screenshots" type="file" accept="image/png,image/jpeg,image/webp" multiple ${busy?'disabled':''}><p id="file-summary" class="caption"></p></div><div class="actions"><button id="scan" class="primary" ${busy?'disabled':''}>${busy?'Reading screenshots…':'Read screenshots →'}</button><button id="manual" ${busy?'disabled':''}>Enter manually</button></div><p id="ocr-status" role="status"></p><progress id="ocr-progress" max="1" value="0" hidden></progress><div id="sources" class="screenshot-list"></div><details><summary>Screenshot tips & privacy</summary><p>Use original images and overlapping frames to cover cut-off teams. Adjust panels if detection misses a table. Full screenshots are temporary; corrected digit crops may be saved in this browser after verification.</p></details></details><div id="review">${draft?review():savedDraft()?'<div class="resume-banner"><span>An unfinished match is saved on this device.</span><button onclick="resumeMatchDraft()">Resume match</button></div>':''}</div>`;
  };
  review=function(){
    const confirmed=draft.rows.filter(r=>r.confirmed).length,pending=draft.rows.length-confirmed;
    const sorted=draft.rows.map((r,i)=>({r,i})).filter(({r})=>reviewMode==='all'||!r.confirmed).sort((a,b)=>(valid(a.r)?1:0)-(valid(b.r)?1:0)||a.r.placement-b.r.placement);
    return `<div class="review-toolbar"><div><h2>${pending?pending+' teams to check':'Ready to save'}</h2><p>${confirmed}/12 confirmed · unresolved teams appear first</p></div><div class="actions"><button onclick="setReviewMode('pending')" aria-pressed="${reviewMode==='pending'}">Needs review (${pending})</button><button onclick="setReviewMode('all')" aria-pressed="${reviewMode==='all'}">All teams</button><button onclick="confirmReadyRows()">Confirm complete teams</button></div></div><div class="review-grid">${sorted.map(({r,i})=>`<section class="review-card ${r.confirmed?'':'unresolved'}" id="review-team-${i}"><div class="panel-head"><h3><span class="placement-number">#${r.placement}</span> ${esc(state.teams.find(t=>t.id===r.teamId)?.name||'Identify team')}</h3><span class="badge ${r.confirmed?'badge-success':''}">${r.confirmed?'Confirmed':valid(r)?'Check & confirm':'Needs attention'}</span></div><label>Find registered team<input type="search" data-team-search="${i}" placeholder="Filter teams by name or player"></label><label>Registered team<select data-team="${i}"><option value="">Select team</option>${state.teams.map(t=>`<option value="${t.id}" ${r.teamId===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label>${r.players.map((p,j)=>`<div class="review-player ${p.kills===null||!p.playerId?'field-uncertain':''}"><div class="evidence"><span class="caption">PLAYER ${j+1} · SCREENSHOT</span>${cropMarkup(r,j)}</div><div class="player-row"><label>Player ${j+1}<select data-player="${i},${j}"><option value="">${p.name?'Choose player · '+esc(p.rawName||p.name):'Select player'}</option><option value="__sub" ${p.isSubstitute?'selected':''}>Substitute</option>${(state.teams.find(t=>t.id===r.teamId)?.players||[]).map(x=>`<option value="${x.id}" ${p.playerId===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select>${p.isSubstitute?`<input data-sub-name="${i},${j}" aria-label="Substitute player name" maxlength="90" value="${esc(p.name)}">`:''}</label><label>Kills<input data-kills="${i},${j}" type="number" min="0" max="99" step="1" value="${p.kills??''}" aria-label="Placement ${r.placement}, player ${j+1} kills" ${p.kills===null?'placeholder="?"':''}></label></div></div>`).join('')}${r.warnings.length?`<p class="error caption">${r.warnings.map(esc).join(' · ')}</p>`:''}<button class="${valid(r)?'primary':''}" onclick="confirmRow(${i})">${r.confirmed?'Reconfirm team':'Confirm team result'}</button></section>`).join('')||'<div class="panel empty"><h2>Every team checked</h2><p>Save the verified match to open standings and exports.</p></div>'}</div><div class="save-bar"><div><strong>${confirmed}/12 teams confirmed</strong><span id="draft-status" class="caption">Draft saved on this device</span></div><div class="actions"><button onclick="discard()" class="danger">Discard draft</button><button class="primary" onclick="finalize()" ${confirmed!==12?'disabled':''}>Save match & open results →</button></div></div><details class="review-tools"><summary>More review tools</summary><div class="actions"><button onclick="rematchDraft()">Match names again</button><button onclick="exportOCRExamples()">Export reviewed OCR examples</button></div></details>`;
  };
  window.setReviewMode=function(mode){reviewMode=mode;redrawReview();};
  redrawReview=function(){remember();prior.redrawReview();if(draft){const title=document.querySelector('.heading h1');if(title)title.textContent='Check match results';document.querySelectorAll('.workflow li').forEach((step,i)=>{step.classList.toggle('done',i===0);step.classList.toggle('current',i===(draft.rows.every(r=>r.confirmed)?2:1));});if(lastReviewedDraft!==draft.id){const settings=document.querySelector('.intake-panel');if(settings)settings.open=false;lastReviewedDraft=draft.id;$('#review')?.scrollIntoView({block:'start'});}}};
  results=function(){return prior.results().replace('<div class="form-grid no-print">','<label class="match-search no-print">Find a saved match<input id="match-search" type="search" placeholder="Search match name or map"></label><p id="match-search-count" class="caption no-print"></p><div class="form-grid no-print">');};
  bindReview=function(){
    prior.bindReview();
    document.querySelectorAll('[data-kills],[data-sub-name]').forEach(el=>el.addEventListener('input',()=>{remember();const card=el.closest('.review-card');card?.classList.add('unresolved');const badge=card?.querySelector('.badge');if(badge)badge.textContent='Needs review';const saveButton=document.querySelector('.save-bar .primary');if(saveButton)saveButton.disabled=true;}));
    document.querySelectorAll('[data-team-search]').forEach(el=>el.oninput=()=>{const select=document.querySelector(`[data-team="${el.dataset.teamSearch}"]`),query=el.value.toLowerCase();Array.from(select.options).forEach(option=>{const team=state.teams.find(t=>t.id===option.value);option.hidden=!!team&&!`${team.name} ${team.players.map(p=>p.name).join(' ')}`.toLowerCase().includes(query)&&!option.selected;});});
  };
  bind=function(){
    prior.bind();
    if(page==='results'&&$('#match-search'))$('#match-search').oninput=e=>{const query=e.target.value.toLowerCase();let count=0;Array.from($('#match-select').options).forEach(option=>{const matches=option.value==="__overall__"||option.textContent.toLowerCase().includes(query);option.hidden=!matches;if(matches)count++;});$('#match-search-count').textContent=count?count+' matching views':'No matches found';};
    if(page==='roster'){
      const search=$('#roster-search');const filter=()=>{rosterQuery=search.value;let count=0;document.querySelectorAll('.team-card').forEach(card=>{card.hidden=!card.textContent.toLowerCase().includes(rosterQuery.toLowerCase());if(!card.hidden)count++;});$('#roster-count').textContent=`${count} of ${state.teams.length} teams`;$('#roster-empty').hidden=count>0;};search.oninput=filter;filter();
    }
    if(page==='upload'){
      if(draft)document.querySelector('.intake-panel').open=false;
      const input=$('#screenshots'),drop=$('#dropzone');if(pendingFiles.length){const transfer=new DataTransfer();pendingFiles.forEach(f=>transfer.items.add(f));input.files=transfer.files;}
      const summarize=()=>{
        clearUploadPreviews();pendingFiles=[...input.files];
        $('#file-summary').textContent=pendingFiles.length?(pendingFiles.length>6?'Choose at most 6 screenshots.':''):'PNG, JPG or WebP · up to 6 images · 15 MB each';
        let previews=$('#selected-previews');if(!previews){previews=document.createElement('div');previews.id='selected-previews';previews.className='selected-previews';previews.setAttribute('aria-label','Selected screenshot previews');drop.append(previews);}
        previews.replaceChildren();previews.hidden=!pendingFiles.length;
        pendingFiles.forEach((file,index)=>{
          const url=URL.createObjectURL(file);previewURLs.push(url);
          const figure=document.createElement('figure'),link=document.createElement('a'),image=document.createElement('img'),caption=document.createElement('figcaption'),remove=document.createElement('button');
          link.href=url;link.target='_blank';link.rel='noopener';link.setAttribute('aria-label','Open screenshot '+(index+1)+' preview');
          image.src=url;image.alt='Screenshot '+(index+1)+': '+file.name;image.decoding='async';caption.textContent=file.name;
          image.onerror=()=>{caption.textContent='Preview unavailable: '+file.name;};
          remove.type='button';remove.className='remove-upload';remove.textContent='× Remove image';remove.setAttribute('aria-label','Remove '+file.name);remove.disabled=busy;
          remove.onclick=event=>{
            event.preventDefault();event.stopPropagation();if(busy)return toast('Wait for screenshot reading to finish.');
            const transfer=new DataTransfer();[...input.files].forEach((selected,selectedIndex)=>{if(selectedIndex!==index)transfer.items.add(selected);});
            input.files=transfer.files;if(!input.files.length)input.value='';summarize();
          };
          link.append(image);figure.append(link,caption,remove);previews.append(figure);
        });
      };
      const setSelection=files=>{const transfer=new DataTransfer();files.forEach(file=>transfer.items.add(file));input.files=transfer.files;};
      const addFiles=files=>{
        if(busy){setSelection(pendingFiles);return;}
        const combined=pendingFiles.slice(),key=file=>JSON.stringify([file.name,file.size,file.lastModified,file.type]),seen=new Set(combined.map(key));
        files.forEach(file=>{if(!seen.has(key(file))){combined.push(file);seen.add(key(file));}});
        if(combined.length>6||files.some(file=>!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>15*1024*1024)){
          setSelection(pendingFiles);return toast('You can add up to 6 PNG, JPG or WebP images, each smaller than 15 MB. Remove an image to make room.','error');
        }
        setSelection(combined);summarize();
      };
      input.onchange=()=>addFiles([...input.files]);summarize();
      drop.ondragover=e=>{e.preventDefault();if(!busy)drop.classList.add('drag-active');};drop.ondragleave=()=>drop.classList.remove('drag-active');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('drag-active');addFiles([...e.dataTransfer.files]);};
      ['#match-name','#match-map'].forEach(selector=>$(selector).addEventListener('input',remember));
      const manual=$('#manual').onclick;$('#manual').onclick=()=>{manual();remember();};
    }
  };
  render=function(){remember();clearUploadPreviews();prior.render();const bar=document.querySelector('.topbar');if(bar){const button=document.createElement('button');button.className='sync-button';button.innerHTML='<span id="sync-status">Up to date</span> ↻';button.onclick=()=>refreshWorkspace(true);bar.append(button);}};
  finalize=async function(){remember();if(draft?.rows.some(row=>!valid(row))){draft.rows.forEach(row=>{if(!valid(row))row.confirmed=false;});redrawReview();return toast('Check the flagged teams, registered players and kill counts before saving.','error');}await prior.finalize();if(!draft){forget();pendingFiles=[];}};
  discard=function(){prior.discard();if(!draft){forget();pendingFiles=[];render();}};
  logout=async function(){remember();if(busy)return toast('Wait for reading to finish.');try{await api('logout',{});draft=null;clearImages();pendingFiles=[];await init();}catch(e){toast(e.message,'error');}};
  window.addEventListener('focus',()=>refreshWorkspace());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)remember();else refreshWorkspace();});
  window.addEventListener('pagehide',remember);
  window.isMatchDraftSaved=()=>draftSaved&&!!savedDraft();
  draftTimer=setInterval(()=>{if(draft)remember();},1500);
  // Boot runs after the appearance layer has registered its page renderers.
})();



