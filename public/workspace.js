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
    const status=$('#draft-status');if(status)status.textContent=draftSaved?(cropsOmitted?'Saved automatically':'Saved automatically'):'Draft could not be saved — keep this tab open';
  }
  function forget(){lastDraftJSON='';try{localStorage.removeItem(draftKey);}catch{}}
  window.clearDraftAfterWarReset=function(){forget();pendingFiles=[];clearUploadPreviews();lastReviewedDraft='';reviewMode='pending';};
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
  api=async function(path,data,options){
    if(path==='state'&&data!==undefined){
      const latest=await prior.api('state');if(lastRemote&&JSON.stringify(latest)!==lastRemote)throw Error('Newer changes exist. Refresh workspace before saving; your match draft is kept.');
      const response=await prior.api(path,data);lastRemote=JSON.stringify(data);return response;
    }
    const response=await prior.api(path,data,options);if(path==='state'||path==='matches/delete')lastRemote=JSON.stringify(response);return response;
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
  roster=function(){return prior.roster().replace(/<div class="team-grid[^"]*">/,match=>`<div class="search-bar"><label for="roster-search">Find a team or player<input id="roster-search" type="search" placeholder="Search name…" value="${esc(rosterQuery)}"></label><span id="roster-count" class="caption"></span></div><p id="roster-empty" hidden>No teams match your search.</p>${match}`);};
  intake=function(){
    const reviewed=draft?.rows.filter(r=>r.confirmed).length||0;
    return header('Match workflow',draft?'Check match results':'New match')+`<ol class="workflow"><li class="${draft?'done':'current'}"><b>1</b> Upload</li><li class="${draft?'current':''}"><b>2</b> Check results</li><li class="${reviewed===12?'current':''}"><b>3</b> Save & export</li></ol><details class="panel intake-panel" open><summary>Match details</summary><div class="form-grid"><label>Match name<input id="match-name" maxlength="70" value="${esc(draft?.name||'Match '+(state.matches.length+1))}"></label><label>Map<select id="match-map">${['Bermuda','NexTerra','Purgatory','Kalahari','Solara','Alpine'].map(map=>`<option ${draft?.map===map?'selected':''}>${map}</option>`).join('')}</select></label></div><div class="dropzone" id="dropzone"><h2>Add match screenshots</h2><p>Choose screenshots showing all 12 teams.</p><input id="screenshots" aria-label="Result screenshots" type="file" accept="image/png,image/jpeg,image/webp" multiple ${busy?'disabled':''}><p id="file-summary" class="caption"></p></div><div class="actions"><button id="scan" class="primary" ${busy?'disabled':''}>${busy?'Preparing results…':'Get results →'}</button><button id="manual" ${busy?'disabled':''}>Enter manually</button></div><p id="ocr-status" role="status"></p><progress id="ocr-progress" max="1" value="0" hidden></progress><div id="sources" class="screenshot-list"></div></details><div id="review">${draft?review():savedDraft()?'<div class="resume-banner"><span>An unfinished match is saved on this device.</span><button onclick="resumeMatchDraft()">Resume match</button></div>':''}</div>`;
  };
  redrawReview=function(){remember();prior.redrawReview();if(draft){const title=document.querySelector('.heading h1');if(title)title.textContent='Check match results';document.querySelectorAll('.workflow li').forEach((step,i)=>{step.classList.toggle('done',i===0);step.classList.toggle('current',i===(draft.rows.every(r=>r.confirmed)?2:1));});if(lastReviewedDraft!==draft.id){const settings=document.querySelector('.intake-panel');if(settings)settings.open=false;lastReviewedDraft=draft.id;$('#review')?.scrollIntoView({block:'start'});}}};
  results=function(){return prior.results().replace('<div class="form-grid no-print">','<label class="match-search no-print">Find a saved match<input id="match-search" type="search" placeholder="Search match name or map"></label><p id="match-search-count" class="caption no-print"></p><div class="form-grid no-print">');};
  // ---- Results check: one compact row per placement, screenshot evidence always beside the numbers, keyboard-first.
  let hideConfirmed=false,lastBulk=null;
  const reduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const shortName=name=>String(name||'').replace(/^FFK\s+/i,'').trim()||String(name||'');
  const teamOf=r=>state.teams.find(t=>t.id===r.teamId);
  const ICON={
    confirmed:'<svg class="desk-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.5 12.4l3 3 6-6.6" fill="none" stroke="var(--desk-bg,#101012)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ready:'<svg class="desk-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 12.4l3 3 6-6.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check:'<svg class="desk-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2L22.2 20.6H1.8z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M12 9.6v4.9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.4" r="1.25" fill="currentColor"/></svg>'
  };
  const LABEL={confirmed:'Confirmed',ready:'Looks right',check:'Check'};
  function problems(r){
    const out=[],team=teamOf(r);
    if(!team)out.push('Pick the team');
    else if(draft.rows.some(x=>x!==r&&x.teamId===r.teamId))out.push('This team is also at another place');
    if(team){
      const unmatched=r.players.filter(p=>!p.playerId).length;if(unmatched)out.push(unmatched===1?'1 player not matched':unmatched+' players not matched');
      const ids=r.players.map(p=>p.playerId).filter(Boolean);if(new Set(ids).size!==ids.length)out.push('Same player picked twice');
      if(r.players.some(p=>p.isSubstitute&&!p.name.trim()))out.push('Substitute needs a name');
    }
    const missing=r.players.filter(p=>!Number.isInteger(p.kills)).length;if(missing)out.push(missing===1?'1 kill count missing':missing+' kill counts missing');
    if(r.warnings.some(w=>/disagree/i.test(w)))out.push('Screenshots disagree');
    const subs=r.players.filter(p=>p.isSubstitute).length;if(subs)out.push((subs===1?'1 substitute':subs+' substitutes')+': make sure it is not a roster player');
    if(!out.length&&rowStatus(r)==='look')out.push('Low-confidence reading: compare with the screenshot');
    return out;
  }
  function stateOf(r){if(r.confirmed)return 'confirmed';return valid(r)&&rowStatus(r)==='ready'&&!r.players.some(p=>p.isSubstitute)?'ready':'check';}
  function rowSum(r){const complete=r.players.every(p=>Number.isInteger(p.kills)),kills=complete?r.players.reduce((n,p)=>n+p.kills,0):null;return {kills,points:kills===null?null:kills+(points[r.placement-1]||0)};}
  function counts(){const c={confirmed:0,ready:0,check:0};draft.rows.forEach(r=>c[stateOf(r)]++);return c;}
  function evidence(r,j){const p=r.players[j];return p.evidenceCrop?`<img class="evidence-crop" src="${esc(p.evidenceCrop)}" alt="Screenshot of placement ${r.placement}, player ${j+1}">`:cropMarkup(r,j);}
  function deskPlayer(r,i,j,team){
    const p=r.players[j],missing=!Number.isInteger(p.kills),unmatched=!!team&&!p.playerId;
    const options=(team?.players||[]).map(x=>`<option value="${x.id}" ${p.playerId===x.id?'selected':''}>${esc(shortName(x.name))}</option>`).join('');
    return `<div class="desk-player${missing?' is-missing':''}${unmatched?' is-unmatched':''}">
      <div class="desk-crop">${evidence(r,j)}${p.rawName?`<span class="desk-read">Read: ${esc(p.rawName)}</span>`:''}</div>
      <div class="desk-fields">
        <label class="desk-name"><span class="sr-only">Placement ${r.placement}, player ${j+1}</span><select data-player="${i},${j}" ${team?'':'disabled'}><option value="">${team?'Pick player…':'Pick the team first'}</option>${options}<option value="__sub" ${p.isSubstitute?'selected':''}>Substitute (not on roster)</option></select></label>
        <label class="desk-kills"><input data-kills="${i},${j}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off" enterkeyhint="done" value="${p.kills??''}" placeholder="?" aria-label="Placement ${r.placement}, player ${j+1} kills" aria-invalid="${missing}"><span aria-hidden="true">kills</span></label>
      </div>
      ${p.isSubstitute?`<label class="desk-sub">Substitute name<input data-sub-name="${i},${j}" maxlength="90" value="${esc(p.name)}"></label>`:''}
    </div>`;
  }
  function rowHead(r,i){
    const s=stateOf(r),team=teamOf(r),sum=rowSum(r),open=s!=='confirmed';
    const taken=new Set(draft.rows.filter(o=>o!==r&&o.confirmed&&o.teamId).map(o=>o.teamId));
    const teamOptions=state.teams.filter(t=>!taken.has(t.id)||t.id===r.teamId).map(t=>`<option value="${t.id}" ${r.teamId===t.id?'selected':''}>${esc(shortName(t.name))}</option>`).join('');
    return `<div class="desk-row-head">
      <span class="desk-place">#${r.placement}</span>
      <span class="desk-status desk-status-${s}">${ICON[s]}<span>${LABEL[s]}</span></span>
      ${open?`<label class="desk-team"><span class="sr-only">Team that finished #${r.placement}</span><select data-team="${i}"><option value="">Pick the team…</option>${teamOptions}</select></label>`:`<strong class="desk-team-name">${esc(team?.name||'No team')}</strong>`}
      <span class="desk-sum"><span><b>${sum.kills??'–'}</b> kills</span><span><b>${sum.points??'–'}</b> pts</span></span>
      ${s==='confirmed'?`<button type="button" class="desk-edit" data-edit="${i}" aria-label="Change placement ${r.placement}">Change</button>`:`<button type="button" class="desk-confirm${s==='ready'?' is-ready':''}" data-confirm="${i}" aria-label="Confirm placement ${r.placement}">Confirm</button>`}
    </div>${s==='check'?`<p class="desk-why">${problems(r).map(esc).join(' · ')}</p>`:''}`;
  }
  function deskRow(r,i){
    const s=stateOf(r),team=teamOf(r);
    const body=s==='confirmed'
      ?`<p class="desk-summary">${r.players.map(p=>`<span>${esc(shortName(p.name)||'?')} <b>${p.kills??'?'}</b></span>`).join('')}</p>`
      :`<div class="desk-players">${r.players.map((_,j)=>deskPlayer(r,i,j,team)).join('')}</div>`;
    return `<section class="desk-row desk-${s}" id="review-team-${i}" data-row="${i}" aria-label="Placement ${r.placement}" ${hideConfirmed&&s==='confirmed'?'hidden':''}>${rowHead(r,i)}${body}</section>`;
  }
  function deskBar(){
    const c=counts(),total=draft.rows.length,all=c.confirmed===total;
    return `<div class="desk-progress"><h2>${all?'All 12 teams confirmed':'Check results'}</h2>
        <p class="desk-chips"><span class="desk-chip desk-status-check">${ICON.check}${c.check} to check</span><span class="desk-chip desk-status-ready">${ICON.ready}${c.ready} look right</span><span class="desk-chip desk-status-confirmed">${ICON.confirmed}${c.confirmed} confirmed</span></p>
        <div class="desk-meter" role="progressbar" aria-label="Teams confirmed" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${c.confirmed}"><span style="width:${c.confirmed/total*100}%"></span></div></div>
      <div class="desk-actions">
        ${c.ready?`<button type="button" class="primary" id="desk-confirm-ready">Confirm ${c.ready} that look${c.ready===1?'s':''} right</button>`:''}
        ${lastBulk?'<button type="button" id="desk-undo-bulk">Undo</button>':''}
        ${c.check?'<button type="button" id="desk-next-check">Next to check →</button>':''}
        <label class="desk-toggle"><input type="checkbox" id="desk-hide-confirmed" ${hideConfirmed?'checked':''}> Hide confirmed</label>
        <details class="desk-more"><summary>More</summary><div><button type="button" onclick="rematchDraft()">Match names again</button><button type="button" onclick="exportOCRExamples()">Export reviewed OCR examples</button></div></details>
      </div>`;
  }
  function saveBar(){
    const c=counts(),total=draft.rows.length,left=total-c.confirmed;
    return `<div><strong>${c.confirmed}/${total} teams confirmed</strong><span id="draft-status" class="caption">Saved automatically on this device</span></div><div class="actions"><button type="button" onclick="discard()" class="danger">Discard draft</button><button type="button" class="primary" onclick="finalize()" ${left?'disabled':''}>${left?`Save results · ${left} to confirm`:'Save results →'}</button></div>`;
  }
  review=function(){
    return `<div class="desk-review" id="desk-review"><div class="desk-bar">${deskBar()}</div>
      <p class="desk-tip">Type kills straight in and compare each number with the screenshot beside it. <span class="desk-keys"><kbd>Enter</kbd> confirms a team and moves to the next one · <kbd>↑</kbd><kbd>↓</kbd> change a kill count.</span></p>
      <div class="desk-rows">${draft.rows.map(deskRow).join('')}</div>
      <div class="save-bar desk-save">${saveBar()}</div></div>`;
  };
  window.setReviewMode=function(mode){hideConfirmed=mode==='pending';redrawReview();};
  // Live updates while typing: refresh the row header, totals and progress without rebuilding the inputs.
  function refreshRow(i){
    const row=document.getElementById('review-team-'+i);if(!row)return;
    const r=draft.rows[i],s=stateOf(r);
    row.className='desk-row desk-'+s;
    const holder=document.createElement('div');holder.innerHTML=rowHead(r,i);
    row.querySelector('.desk-row-head')?.replaceWith(holder.querySelector('.desk-row-head'));
    row.querySelector('.desk-why')?.remove();const why=holder.querySelector('.desk-why');if(why)row.querySelector('.desk-row-head').after(why);
    bindRow(row);refreshBars();
  }
  function refreshBars(){const bar=document.querySelector('.desk-bar');if(bar){bar.innerHTML=deskBar();bindBar();}const save=document.querySelector('.desk-save');if(save)save.innerHTML=saveBar();}
  function scrollToRow(row){row.scrollIntoView({block:'center',behavior:reduceMotion()?'auto':'smooth'});}
  function focusNeed(i){
    const r=draft.rows[i],row=document.getElementById('review-team-'+i);if(!row)return;row.hidden=false;
    let target;if(!r.teamId)target=row.querySelector('[data-team]');
    else{const j=r.players.findIndex(p=>!p.playerId),k=r.players.findIndex(p=>!Number.isInteger(p.kills));target=row.querySelector(j>=0?`[data-player="${i},${j}"]`:`[data-kills="${i},${k>=0?k:0}"]`);}
    scrollToRow(row);(target||row.querySelector('button'))?.focus({preventScroll:true});
  }
  function focusNext(i){
    const n=draft.rows.length,order=Array.from({length:n},(_,k)=>(i+1+k)%n),next=order.find(k=>!draft.rows[k].confirmed);
    if(next===undefined){const save=document.querySelector('.desk-save .primary');save?.scrollIntoView({block:'center'});save?.focus({preventScroll:true});return;}
    focusNeed(next);
  }
  function confirmAndNext(i){
    const r=draft.rows[i];if(r.confirmed)return focusNext(i);
    if(!valid(r)){refreshRow(i);toast(`Placement ${r.placement}: ${problems(r).join(', ').toLowerCase()||'check the team, players and kills'}.`,'error');return focusNeed(i);}
    r.confirmed=true;r.warnings=[];lastBulk=null;redrawReview();focusNext(i);
  }
  function redrawKeeping(selector){redrawReview();const el=selector&&document.querySelector(selector);if(el)el.focus({preventScroll:true});}
  function bindBar(){
    const ready=$('#desk-confirm-ready');if(ready)ready.onclick=()=>{const done=[];draft.rows.forEach((r,i)=>{if(stateOf(r)==='ready'){r.confirmed=true;r.warnings=[];done.push(i);}});lastBulk=done;redrawReview();toast(done.length+' team'+(done.length===1?'':'s')+' confirmed.'+(counts().check?' Now check the ones marked “Check”.':''));const first=draft.rows.findIndex(r=>!r.confirmed);if(first>=0)focusNeed(first);};
    const undo=$('#desk-undo-bulk');if(undo)undo.onclick=()=>{(lastBulk||[]).forEach(i=>{draft.rows[i].confirmed=false;});const n=lastBulk?.length||0;lastBulk=null;redrawReview();toast(n+' confirmation'+(n===1?'':'s')+' undone.');};
    const next=$('#desk-next-check');if(next)next.onclick=()=>{const i=draft.rows.findIndex(r=>stateOf(r)==='check');if(i>=0)focusNeed(i);};
    const hide=$('#desk-hide-confirmed');if(hide)hide.onchange=()=>{hideConfirmed=hide.checked;redrawReview();};
  }
  function bindRow(row){
    row.querySelectorAll('[data-confirm]').forEach(el=>el.onclick=()=>confirmAndNext(+el.dataset.confirm));
    row.querySelectorAll('[data-edit]').forEach(el=>el.onclick=()=>{const i=+el.dataset.edit;draft.rows[i].confirmed=false;lastBulk=null;redrawKeeping(`[data-kills="${i},0"]`);});
    row.querySelectorAll('[data-team]').forEach(el=>el.onchange=()=>{
      const i=+el.dataset.team,r=draft.rows[i];r.teamId=el.value;r.confirmed=false;
      r.players.forEach(p=>{p.playerId='';p.isSubstitute=false;p.identityEdited=false;p.name=p.rawName||p.name;});
      const team=teamOf(r);if(team)WarOCR.matchTeam(r.players,[team],{trustedTeamId:team.id});applySubstitutes(r);lastBulk=null;redrawReview();focusNeed(i);
    });
    row.querySelectorAll('[data-player]').forEach(el=>el.onchange=()=>{
      const [i,j]=el.dataset.player.split(',').map(Number),r=draft.rows[i],chosen=teamOf(r)?.players.find(p=>p.id===el.value),player=r.players[j];
      player.rawName=player.rawName||player.name;player.identityEdited=!!chosen||el.value==='__sub';player.playerId=chosen?.id||'';if(chosen)player.matchScore=1;else delete player.matchScore;player.isSubstitute=false;player.name=chosen?.name||player.rawName||player.name;
      if(el.value==='__sub'){player.playerId='';applySubstitutes(r);}
      r.confirmed=false;lastBulk=null;redrawKeeping(el.value==='__sub'?`[data-sub-name="${i},${j}"]`:`[data-kills="${i},${j}"]`);
    });
    row.querySelectorAll('[data-sub-name]').forEach(el=>el.oninput=()=>{const [i,j]=el.dataset.subName.split(',').map(Number),player=draft.rows[i].players[j];player.rawName=player.rawName||player.name;player.name=el.value.trim();player.identityEdited=true;draft.rows[i].confirmed=false;refreshRow(i);});
    row.querySelectorAll('[data-kills]').forEach(el=>{
      const [i,j]=el.dataset.kills.split(',').map(Number);
      const set=value=>{const p=draft.rows[i].players[j];p.kills=value;p.killEdited=true;if(value!==null)p.killConfidence=100;draft.rows[i].confirmed=false;el.setAttribute('aria-invalid',String(value===null));el.closest('.desk-player')?.classList.toggle('is-missing',value===null);refreshRow(i);};
      el.oninput=()=>{const digits=el.value.replace(/\D/g,'').slice(0,2);if(digits!==el.value)el.value=digits;set(digits===''?null:Math.min(99,Number(digits)));};
      el.onfocus=()=>el.select();
      el.onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();const now=Number.isInteger(draft.rows[i].players[j].kills)?draft.rows[i].players[j].kills:0,value=Math.max(0,Math.min(99,now+(e.key==='ArrowUp'?1:-1)));el.value=String(value);set(value);}};
    });
    row.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&e.target.matches('input,select')){e.preventDefault();confirmAndNext(+row.dataset.row);}};
  }
  bindReview=function(){
    const root=$('#desk-review');if(!root)return;
    bindBar();root.querySelectorAll('.desk-row').forEach(bindRow);
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
        $('#file-summary').textContent=pendingFiles.length?`${pendingFiles.length} of 6 images added · drop more images to add them`:'PNG, JPG or WebP · up to 6 images · 15 MB each';
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
        const combined=[...pendingFiles,...files];
        if(combined.length>6||files.some(file=>!(['image/png','image/jpeg','image/webp'].includes(file.type)||(!file.type&&/\.(png|jpe?g|webp)$/i.test(file.name)))||file.size>15*1024*1024)){
          setSelection(pendingFiles);return toast('You can add up to 6 PNG, JPG or WebP images, each smaller than 15 MB. Remove an image to make room.','error');
        }
        setSelection(combined);summarize();
      };
      input.onchange=()=>addFiles([...input.files]);summarize();
      drop.ondragover=e=>{e.preventDefault();if(!busy)drop.classList.add('drag-active');};drop.ondragleave=()=>drop.classList.remove('drag-active');drop.ondrop=e=>{e.preventDefault();e.stopPropagation();drop.classList.remove('drag-active');const items=Array.from(e.dataTransfer.items||[]).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);addFiles(items.length?items:Array.from(e.dataTransfer.files||[]));};
      ['#match-name','#match-map'].forEach(selector=>$(selector).addEventListener('input',remember));
      const manual=$('#manual').onclick;$('#manual').onclick=async()=>{await manual();remember();};
    }
  };
  render=function(){remember();clearUploadPreviews();prior.render();const bar=document.querySelector('.topbar');if(bar){const button=document.createElement('button');button.className='sync-button';button.innerHTML='<span id="sync-status">Up to date</span> ↻';button.onclick=()=>refreshWorkspace(true);bar.append(button);}};
  finalize=async function(){remember();if(draft?.rows.some(row=>!valid(row))){draft.rows.forEach(row=>{if(!valid(row))row.confirmed=false;});redrawReview();return toast('Check the flagged teams, registered players and kill counts before saving.','error');}await prior.finalize();if(!draft){forget();pendingFiles=[];}};
  discard=async function(){await prior.discard();if(!draft){forget();pendingFiles=[];render();}};
  logout=async function(){remember();if(busy)return toast('Wait for reading to finish.');try{await api('logout',{});draft=null;clearImages();pendingFiles=[];await init();}catch(e){toast(e.message,'error');}};
  window.addEventListener('focus',()=>refreshWorkspace());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)remember();else refreshWorkspace();});
  window.addEventListener('pagehide',remember);
  window.isMatchDraftSaved=()=>draftSaved&&!!savedDraft();
  draftTimer=setInterval(()=>{if(draft)remember();},1500);
  // Boot runs after the appearance layer has registered its page renderers.
})();



