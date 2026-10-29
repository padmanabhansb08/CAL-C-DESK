/* Approved UX direction: compact match desk, recoverable drafts, evidence beside edits. */
(function(){
  const prior={render,bind,redrawReview,api,finalize,discard};
  let reviewMode='pending',pendingFiles=[],lastRemote='',syncing=false,draftTimer,draftSaved=true,lastReviewedDraft='',lastDraftJSON='';
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
  const outsideSet=row=>!!(draft?.stage&&row.teamId&&window.WarTournament&&!WarTournament.availableTeams(state,draft.stage).some(t=>t.id===row.teamId));
  function valid(row){const team=state.teams.find(t=>t.id===row.teamId);return !!team&&!outsideSet(row)&&row.players.length===4&&row.players.every(p=>p.playerId&&(p.isSubstitute||team.players.some(x=>x.id===p.playerId))&&p.name.trim()&&Number.isInteger(p.kills)&&p.kills>=0&&p.kills<=99)&&new Set(row.players.map(p=>p.playerId)).size===4&&!draft.rows.some(r=>r!==row&&r.teamId===row.teamId);}
  function cropMarkup(row,index){
    const source=images.find(s=>s.rows?.some(r=>r.placement===row.placement&&r.players[index]?.ocrRegion));
    const observed=source?.rows.find(r=>r.placement===row.placement)?.players[index],region=observed?.ocrRegion;
    if(!source?.image||!region)return row.players[index].evidenceCrop?`<img class="evidence-crop" src="${esc(row.players[index].evidenceCrop)}" alt="Saved screenshot evidence for placement ${row.placement}, player ${index+1}">`:'<span class="crop-empty">No screenshot</span>';
    const image=source.image,sx=(image.naturalWidth||image.width)/region.width,sy=(image.naturalHeight||image.height)/region.height;
    const x=Math.max(0,Math.floor(region.name[0]*sx)),y=Math.max(0,Math.floor(Math.min(region.name[1],region.digits[1])*sy));
    const right=Math.min(image.naturalWidth||image.width,Math.ceil((region.digits[0]+region.digits[2])*sx)),bottom=Math.min(image.naturalHeight||image.height,Math.ceil(Math.max(region.name[1]+region.name[3],region.digits[1]+region.digits[3])*sy));
    const c=canvas(right-x,bottom-y);c.getContext('2d').drawImage(image,x,y,c.width,c.height,0,0,c.width,c.height);
    row.players[index].evidenceCrop=c.toDataURL();
    return `<img class="evidence-crop" src="${row.players[index].evidenceCrop}" alt="Screenshot evidence for placement ${row.placement}, player ${index+1}">`;
  }
  api=async function(path,data,options){
    if(path==='state'&&data!==undefined){
      const latest=await prior.api('state');if(lastRemote&&JSON.stringify(latest)!==lastRemote)throw Error('Newer changes exist. Refresh workspace before saving; your match draft is kept.');
      const response=await prior.api(path,data);lastRemote=JSON.stringify(data);return response;
    }
    const response=await prior.api(path,data,options);if(path==='state'||path==='matches/delete')lastRemote=JSON.stringify(response);return response;
  };
  window.refreshWorkspace=async function(manual=false){
    if(busy||syncing||$('#modal')?.open)return;syncing=true;
    // Read without adopting yet: if a dialog opened or an operation started while the request was in flight,
    // keep the objects the open dialog is editing (the next refresh picks the changes up).
    try{const latest=await prior.api('state');if($('#modal')?.open||busy)return;lastRemote=JSON.stringify(latest);const changed=JSON.stringify(latest)!==JSON.stringify(state);state=latest;const status=$('#sync-status');if(status)status.textContent='Up to date';if(changed&&!draft&&!$('#modal')?.open)render();else if(changed&&draft&&manual)redrawReview();if(manual)toast('Workspace refreshed');}
    catch(e){const status=$('#sync-status');if(status)status.textContent=e.expired?'Signed out':'Offline · retry refresh';if(manual&&!e.expired)toast(e.message,'error');}finally{syncing=false;}
  };
  go=function(next){if(busy)return toast('Wait for screenshot reading to finish.','warning');remember();page=next;render();refreshWorkspace();};
  window.resumeMatchDraft=function(){const stored=savedDraft();if(!stored?.draft)return toast('No saved draft found.','error');draft=stored.draft;draft.rows.forEach(row=>{if(!valid(row))row.confirmed=false;});page='upload';reviewMode='pending';render();};
  const MAPS=['Bermuda','NexTerra','Purgatory','Kalahari','Solara','Alpine'];
  function stagePicker(stage){
    const w=state.war||WarTournament.initial(),locked=set=>!!w.qualified?.[set];
    return `<label class="war-intake">Tournament set<select id="war-stage" ${draft?'disabled':''} aria-describedby="comfort-set-context"><option value="" ${stage?'':'selected'}>Practice / unassigned</option>${['A','B','C'].map(set=>`<option value="${set}" ${stage===set?'selected':''}>Set ${set}${set==='C'?' · Semi-final':''}${locked(set)?' · Locked':set==='C'&&WarTournament.members(w,'C').length!==12?' · Awaiting qualifiers':''}</option>`).join('')}</select></label>`;
  }
  intake=function(){
    const reviewed=draft?.rows.filter(r=>r.confirmed).length||0;
    return header('Match workflow',draft?'Check match results':'New match')+`<ol class="workflow"><li class="${draft?'done':'current'}"><b>1</b> Upload</li><li class="${draft?'current':''}"><b>2</b> Check results</li><li class="${reviewed===12?'current':''}"><b>3</b> Save & export</li></ol>
      <details class="panel intake-panel comfort-intake" ${draft?'':'open'}><summary>${draft?'Match setup & screenshots':'Set up this match'}</summary>
      <p class="comfort-intake-intro">Choose the tournament set and map, then add the final result screenshots.</p>
      <div class="form-grid comfort-match-fields">${stagePicker(draft?.stage||'')}<label>Match name<input id="match-name" maxlength="70" value="${esc(draft?.name||'Match '+(state.matches.length+1))}" placeholder="For example, Set A · Match 1"></label><label>Map<select id="match-map" aria-label="Map played in this match">${MAPS.map(map=>`<option ${draft?.map===map?'selected':''}>${map}</option>`).join('')}</select></label></div>
      <div class="comfort-set-context" id="comfort-set-context" role="status"></div>
      <div class="dropzone" id="dropzone"><label for="screenshots" class="upload-picker"><span class="upload-symbol">${uiIcon('upload_file',{size:'lg'})}</span><strong>Add your match screenshots</strong><span>Drop images here or click to choose</span></label><p class="comfort-upload-help">Cover all 12 placements. Overlapping screenshots are okay.</p><input id="screenshots" class="native-file-input" aria-label="Result screenshots" type="file" accept="image/png,image/jpeg,image/webp" multiple ${busy?'disabled':''}><p id="file-summary" class="caption"></p><div id="selected-previews" class="selected-previews" aria-label="Selected screenshot previews" hidden></div></div>
      <div class="actions comfort-intake-actions"><button type="button" id="scan" class="primary brand-main-action" disabled>Read screenshots →</button></div><p class="comfort-file-status" id="comfort-file-status" aria-live="polite"></p>
      <div class="comfort-manual-path"><span>No screenshots?</span><button type="button" id="manual" class="plain-action comfort-manual" ${busy?'disabled':''}>Enter results by hand</button></div>
      <p id="ocr-status" role="status"></p><progress id="ocr-progress" max="1" value="0" hidden></progress></details>
      <div id="review">${draft?review():savedDraft()?'<div class="resume-banner"><span>An unfinished match is saved on this device.</span><button type="button" onclick="resumeMatchDraft()">Resume match</button></div>':''}</div>`;
  };
  // Intake behaviour: the set explains itself, the map follows the match number, and the read button
  // says how many screenshots it will read.
  function setContext(){
    const context=$('#comfort-set-context');if(!context)return;
    const set=$('#war-stage')?.value,w=state.war;let text='Practice match · saved results stay outside the tournament standings.';
    if(set){
      const count=w?(set==='C'?(w.qualified?.A?.length||0)+(w.qualified?.B?.length||0):(w.groups?.[set]?.length||0)):0;
      text='Set '+set+(set==='C'?' · Semi-final':' · Qualifier')+' · Battle Royale · '+(set==='C'?'Top 4 advance to CS finals.':'Top 6 advance to Set C.');
      if(set!=='C'&&count!==12)text+=' The 12 teams in your first saved points table become this set’s team list.';
      if(set==='C'&&count!==12)text+=' Confirm the top 6 from Set A and Set B first.';
      if(w?.qualified?.[set])text+=' Qualification is locked.';
    }
    context.textContent=text;context.classList.toggle('is-practice',!set);
  }
  function syncMap(){
    if(draft||!window.WarGuide)return;const map=$('#match-map'),name=$('#match-name'),set=$('#war-stage')?.value||'';if(!map||!name)return;
    const explicit=name.value.match(/(?:^|\s)Match\s+(\d+)$/i),number=explicit?Number(explicit[1]):state.matches.filter(m=>set?m.stage===set:true).length+1,key=set+':'+number;
    if(map.dataset.rotationKey===key)return;map.value=WarGuide.mapForMatch(number);map.dataset.rotationKey=key;
  }
  function uploadStatus(){
    const input=$('#screenshots'),scan=$('#scan'),status=$('#comfort-file-status');if(!input||!scan)return;
    const count=input.files?.length||0;scan.disabled=busy||count===0;scan.textContent=busy?'Reading your screenshots…':count?'Read '+count+' screenshot'+(count===1?'':'s')+' →':'Read screenshots →';
    if(status)status.textContent=count?'Ready when you are. You’ll check the results before saving.':'Choose your screenshots to continue.';
    $('#dropzone')?.classList.toggle('has-screenshots',count>0);
  }
  window.refreshUploadStatus=uploadStatus;
  redrawReview=function(){remember();prior.redrawReview();showSources();if(draft){const title=document.querySelector('.heading h1');if(title)title.textContent='Check match results';document.querySelectorAll('.workflow li').forEach((step,i)=>{step.classList.toggle('done',i===0);step.classList.toggle('current',i===(draft.rows.every(r=>r.confirmed)?2:1));});if(lastReviewedDraft!==draft.id){const settings=document.querySelector('.intake-panel');if(settings)settings.open=false;lastReviewedDraft=draft.id;$('#review')?.scrollIntoView({block:'start'});}}};
  // ---- Results check: one compact row per placement, screenshot evidence always beside the numbers, keyboard-first.
  // oneAtATime: show only the current placement (the default on phones, where twelve full rows make a
  // ten-thousand-pixel page). The jump list and progress stay pinned above it.
  let hideConfirmed=false,lastBulk=null,lastConfirmed=null,oneAtATime=null,currentRow=0;
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
    else if(outsideSet(r))out.push('This team is not playing in Set '+draft.stage);
    if(team){
      const unmatched=r.players.filter(p=>!p.playerId).length;if(unmatched)out.push(unmatched===1?'1 player not matched':unmatched+' players not matched');
      const ids=r.players.map(p=>p.playerId).filter(Boolean);if(new Set(ids).size!==ids.length)out.push('Same player picked twice');
      if(r.players.some(p=>p.isSubstitute&&!p.name.trim()))out.push('Substitute needs a name');
    }
    const missing=r.players.filter(p=>!Number.isInteger(p.kills)).length;if(missing)out.push(missing===1?'1 kill count missing':missing+' kill counts missing');
    if(r.warnings.some(w=>/disagree/i.test(w)))out.push('Screenshots disagree');
    (r.flags||[]).forEach(f=>out.push(f.text));
    r.players.forEach((p,j)=>{if(p.kills>HIGH_KILLS&&!(r.flags||[]).some(f=>f.code==='high_kills'&&f.player===j))out.push(`Player ${j+1}: ${p.kills} kills is unusually high`);});
    const subs=r.players.filter(p=>p.isSubstitute).length;if(subs)out.push((subs===1?'1 substitute':subs+' substitutes')+': make sure it is not a roster player');
    if(!out.length&&rowStatus(r)==='look')out.push('Low-confidence reading: compare with the screenshot');
    return out;
  }
  function stateOf(r){if(r.confirmed)return 'confirmed';return valid(r)&&rowStatus(r)==='ready'&&!r.players.some(p=>p.isSubstitute)?'ready':'check';}
  function rowSum(r){const complete=r.players.every(p=>Number.isInteger(p.kills)),kills=complete?r.players.reduce((n,p)=>n+p.kills,0):null;return {kills,points:kills===null?null:kills+(points[r.placement-1]||0)};}
  function counts(){const c={confirmed:0,ready:0,check:0};draft.rows.forEach(r=>c[stateOf(r)]++);return c;}
  // The screenshot crop for one player. When the screenshot is still loaded, the crop opens it full size
  // with that row outlined.
  function liveSource(r,j){const index=images.findIndex(s=>s.rows?.some(x=>x.placement===r.placement&&x.players[j]?.ocrRegion));return index<0?null:{index,region:images[index].rows.find(x=>x.placement===r.placement).players[j].ocrRegion};}
  function evidence(r,j){
    const p=r.players[j],crop=p.evidenceCrop?`<img class="evidence-crop" src="${esc(p.evidenceCrop)}" alt="Screenshot of placement ${r.placement}, player ${j+1}">`:cropMarkup(r,j),live=liveSource(r,j);
    return live?`<button type="button" class="evidence-open" data-evidence="${draft.rows.indexOf(r)},${j}" aria-label="Open the screenshot at placement ${r.placement}, player ${j+1}">${crop}</button>`:crop;
  }
  window.openEvidence=(i,j)=>{const live=liveSource(draft.rows[i],j);if(live)openSource(live.index,live.region);};
  function deskPlayer(r,i,j,team){
    const p=r.players[j],missing=!Number.isInteger(p.kills),unmatched=!!team&&!p.playerId;
    const options=(team?.players||[]).map(x=>`<option value="${x.id}" ${p.playerId===x.id?'selected':''}>${esc(shortName(x.name))}</option>`).join('');
    const manual=draft.entry==='manual';
    return `<div class="desk-player${missing?' is-missing':''}${unmatched?' is-unmatched':''}${manual?' is-manual':''}">
      ${manual?'':`<div class="desk-crop">${evidence(r,j)}${p.rawName?`<span class="desk-read">Read: ${esc(p.rawName)}</span>`:''}</div>`}
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
    // A tournament set only offers its own teams, on every render (typing kills rebuilds this header).
    const allowed=draft.stage&&window.WarTournament?new Set(WarTournament.availableTeams(state,draft.stage).map(t=>t.id)):null;
    const teamOptions=state.teams.filter(t=>(!taken.has(t.id)&&(!allowed||allowed.has(t.id)))||t.id===r.teamId).map(t=>`<option value="${t.id}" ${r.teamId===t.id?'selected':''}>${esc(shortName(t.name))}</option>`).join('');
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
    return `<section class="desk-row desk-${s}" id="review-team-${i}" data-row="${i}" aria-label="Placement ${r.placement}" ${rowHidden(i)?'hidden':''}>${rowHead(r,i)}${body}</section>`;
  }
  const rowHidden=i=>oneAtATime?i!==currentRow:hideConfirmed&&draft.rows[i].confirmed;
  function jumpList(){
    return `<nav class="desk-jump" aria-label="Go to a placement">${draft.rows.map((r,i)=>{const s=stateOf(r);return `<button type="button" data-jump="${i}" class="desk-jump-${s}${i===currentRow?' is-current':''}" ${i===currentRow?'aria-current="true"':''} aria-label="Placement ${r.placement}: ${LABEL[s]}">${r.placement}</button>`;}).join('')}</nav>`;
  }
  function deskBar(){
    const c=counts(),total=draft.rows.length,all=c.confirmed===total;
    return `<div class="desk-progress"><h2>${all?'All 12 teams confirmed':'Check results'}</h2><p class="desk-recent" role="status">${lastConfirmed!==null&&draft.rows[lastConfirmed]?.confirmed?`Confirmed #${draft.rows[lastConfirmed].placement} <button type="button" class="link-button" id="desk-undo-one">Undo</button>`:''}</p>
        <p class="desk-chips"><span class="desk-chip desk-status-check">${ICON.check}${c.check} to check</span><span class="desk-chip desk-status-ready">${ICON.ready}${c.ready} look right</span><span class="desk-chip desk-status-confirmed">${ICON.confirmed}${c.confirmed} confirmed</span></p>
        <div class="desk-meter" role="progressbar" aria-label="Teams confirmed" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${c.confirmed}"><span style="width:${c.confirmed/total*100}%"></span></div></div>
      <div class="desk-actions">
        ${c.ready?`<button type="button" class="primary" id="desk-confirm-ready">Confirm ${c.ready} that look${c.ready===1?'s':''} right</button>`:''}
        ${lastBulk?'<button type="button" id="desk-undo-bulk">Undo</button>':''}
        ${c.check?'<button type="button" id="desk-next-check">Next to check →</button>':''}
        <label class="desk-toggle"><input type="checkbox" id="desk-one" ${oneAtATime?'checked':''}> One team at a time</label>
        ${oneAtATime?'':`<label class="desk-toggle"><input type="checkbox" id="desk-hide-confirmed" ${hideConfirmed?'checked':''}> Hide confirmed</label>`}
        <details class="desk-more"><summary>More</summary><div><button type="button" onclick="rematchDraft()">Match names again</button><button type="button" onclick="exportOCRExamples()">Export reviewed OCR examples</button></div></details>
      </div>${jumpList()}`;
  }
  function saveBar(){
    const c=counts(),total=draft.rows.length,left=total-c.confirmed;
    return `<div><strong>${c.confirmed}/${total} teams confirmed</strong><span id="draft-status" class="caption">Saved automatically on this device</span></div><div class="actions"><button type="button" onclick="discard()" class="danger">Discard draft</button><button type="button" class="primary" onclick="finalize()" ${left?'disabled':''}>${left?`Save results · ${left} to confirm`:'Save results →'}</button></div>`;
  }
  review=function(){
    if(oneAtATime===null){oneAtATime=matchMedia('(max-width: 760px)').matches;const first=draft.rows.findIndex(r=>!r.confirmed);currentRow=first<0?0:first;}
    const manual=draft.entry==='manual';
    return `<div class="desk-review${manual?' desk-review--manual':''}" id="desk-review"><div class="desk-bar">${deskBar()}</div>
      ${manual?'':'<section class="source-tray" id="sources" aria-label="Screenshots for this match" hidden></section>'}
      <p class="desk-tip">${manual?'Entering results by hand: pick each team and its players, then type the kills.':'Type kills straight in and compare each number with the screenshot beside it. Select a screenshot crop to see the whole screenshot.'} <span class="desk-keys"><kbd>Enter</kbd> confirms a team and moves to the next one · <kbd>↑</kbd><kbd>↓</kbd> change a kill count.</span></p>
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
  // Show the current placement (and only it, in one-at-a-time mode) and mark it in the jump list.
  function showRow(i){
    currentRow=i;document.querySelectorAll('.desk-row').forEach(row=>row.hidden=rowHidden(+row.dataset.row));
    document.querySelectorAll('[data-jump]').forEach(b=>{const on=+b.dataset.jump===i;b.classList.toggle('is-current',on);if(on)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');});
  }
  function focusNeed(i){
    showRow(i);const r=draft.rows[i],row=document.getElementById('review-team-'+i);if(!row)return;row.hidden=false;
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
    r.confirmed=true;r.warnings=[];lastBulk=null;lastConfirmed=i;redrawReview();focusNext(i);
    // A short highlight shows where the desk moved to (skipped when motion is reduced).
    const next=document.getElementById('review-team-'+currentRow);if(next&&currentRow!==i&&!reduceMotion()){next.classList.add('is-arriving');setTimeout(()=>next.classList.remove('is-arriving'),700);}
  }
  function redrawKeeping(selector){redrawReview();const el=selector&&document.querySelector(selector);if(el)el.focus({preventScroll:true});}
  function bindBar(){
    const ready=$('#desk-confirm-ready');if(ready)ready.onclick=()=>{const done=[];draft.rows.forEach((r,i)=>{if(stateOf(r)==='ready'){r.confirmed=true;r.warnings=[];done.push(i);}});lastBulk=done;lastConfirmed=null;redrawReview();toast(done.length+' team'+(done.length===1?'':'s')+' confirmed.'+(counts().check?' Now check the ones marked “Check”.':''));const first=draft.rows.findIndex(r=>!r.confirmed);if(first>=0)focusNeed(first);};
    const undo=$('#desk-undo-bulk');if(undo)undo.onclick=()=>{(lastBulk||[]).forEach(i=>{draft.rows[i].confirmed=false;});const n=lastBulk?.length||0;lastBulk=null;redrawReview();toast(n+' confirmation'+(n===1?'':'s')+' undone.');};
    const next=$('#desk-next-check');if(next)next.onclick=()=>{const i=draft.rows.findIndex(r=>stateOf(r)==='check');if(i>=0)focusNeed(i);};
    const hide=$('#desk-hide-confirmed');if(hide)hide.onchange=()=>{hideConfirmed=hide.checked;redrawReview();};
    const one=$('#desk-one');if(one)one.onchange=()=>{oneAtATime=one.checked;redrawReview();focusNeed(currentRow);};
    document.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>focusNeed(+b.dataset.jump));
    const undoOne=$('#desk-undo-one');if(undoOne)undoOne.onclick=()=>{const i=lastConfirmed;draft.rows[i].confirmed=false;lastConfirmed=null;redrawReview();focusNeed(i);toast('Placement '+draft.rows[i].placement+' is open again.');};
  }
  function bindRow(row){
    row.querySelectorAll('[data-evidence]').forEach(el=>el.onclick=()=>{const [i,j]=el.dataset.evidence.split(',').map(Number);openEvidence(i,j);});
    row.querySelectorAll('[data-confirm]').forEach(el=>el.onclick=()=>confirmAndNext(+el.dataset.confirm));
    row.querySelectorAll('[data-edit]').forEach(el=>el.onclick=()=>{const i=+el.dataset.edit;draft.rows[i].confirmed=false;lastBulk=null;lastConfirmed=null;currentRow=i;redrawKeeping(`[data-kills="${i},0"]`);});
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
      const set=value=>{const p=draft.rows[i].players[j];p.kills=value;p.killEdited=true;
        // Typing the number from the screenshot settles that player's own reading doubts.
        if(draft.rows[i].flags)draft.rows[i].flags=draft.rows[i].flags.filter(f=>!(f.player===j&&['high_kills','clipped'].includes(f.code)));if(value!==null)p.killConfidence=100;draft.rows[i].confirmed=false;el.setAttribute('aria-invalid',String(value===null));el.closest('.desk-player')?.classList.toggle('is-missing',value===null);refreshRow(i);};
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
    if(page==='roster'){
      const search=$('#roster-search');const filter=()=>{rosterQuery=search.value;let count=0;document.querySelectorAll('.team-card').forEach(card=>{card.hidden=!card.textContent.toLowerCase().includes(rosterQuery.toLowerCase());if(!card.hidden)count++;});$('#roster-count').textContent=`${count} of ${state.teams.length} teams`;$('#roster-empty').hidden=count>0;};search.oninput=filter;filter();
    }
    if(page==='upload'){
      const input=$('#screenshots'),drop=$('#dropzone');if(pendingFiles.length){const transfer=new DataTransfer();pendingFiles.forEach(f=>transfer.items.add(f));input.files=transfer.files;}
      const summarize=()=>{
        clearUploadPreviews();pendingFiles=[...input.files];
        $('#file-summary').textContent=pendingFiles.length?`${pendingFiles.length} of 6 images added · drop more images to add them`:'PNG, JPG or WebP · up to 6 images · 15 MB each';
        const previews=$('#selected-previews');
        previews.replaceChildren();previews.hidden=!pendingFiles.length;
        pendingFiles.forEach((file,index)=>{
          const url=URL.createObjectURL(file);previewURLs.push(url);
          const figure=document.createElement('figure'),link=document.createElement('a'),image=document.createElement('img'),caption=document.createElement('figcaption'),remove=document.createElement('button');
          link.href=url;link.target='_blank';link.rel='noopener';link.setAttribute('aria-label','Open screenshot '+(index+1)+' preview');
          image.src=url;image.alt='Screenshot '+(index+1)+': '+file.name;image.decoding='async';caption.textContent=file.name;
          image.onerror=()=>{caption.textContent='Preview unavailable: '+file.name;};
          remove.type='button';remove.className='remove-upload';remove.textContent='× Remove image';remove.setAttribute('aria-label','Remove '+file.name);remove.disabled=busy;
          remove.onclick=event=>{
            event.preventDefault();event.stopPropagation();if(busy)return toast('Wait for screenshot reading to finish.','warning');
            const transfer=new DataTransfer();[...input.files].forEach((selected,selectedIndex)=>{if(selectedIndex!==index)transfer.items.add(selected);});
            input.files=transfer.files;if(!input.files.length)input.value='';summarize();uploadStatus();
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
        setSelection(combined);summarize();uploadStatus();
      };
      input.onchange=()=>addFiles([...input.files]);summarize();uploadStatus();
      const stage=$('#war-stage');stage?.addEventListener('change',()=>{const name=$('#match-name');if(name&&/^(Set [ABC] · )?Match \d+$/.test(name.value)&&stage.value)name.value='Set '+stage.value+' · Match '+(state.matches.filter(m=>m.stage===stage.value).length+1);setContext();syncMap();});
      $('#match-name').addEventListener('input',syncMap);setContext();syncMap();
      drop.ondragover=e=>{e.preventDefault();if(!busy)drop.classList.add('drag-active');};drop.ondragleave=()=>drop.classList.remove('drag-active');drop.ondrop=e=>{e.preventDefault();e.stopPropagation();drop.classList.remove('drag-active');const items=Array.from(e.dataTransfer.items||[]).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);addFiles(items.length?items:Array.from(e.dataTransfer.files||[]));};
      ['#match-name','#match-map'].forEach(selector=>$(selector).addEventListener('input',remember));
      const manual=$('#manual').onclick;$('#manual').onclick=async()=>{await manual();remember();};
    }
  };
  render=function(){remember();clearUploadPreviews();prior.render();};
  finalize=async function(){remember();if(draft?.rows.some(row=>!valid(row))){draft.rows.forEach(row=>{if(!valid(row))row.confirmed=false;});redrawReview();return toast('Check the flagged teams, registered players and kill counts before saving.','error');}await prior.finalize();if(!draft){forget();pendingFiles=[];}};
  discard=async function(){await prior.discard();if(!draft){forget();pendingFiles=[];render();}};
  logout=async function(){remember();if(busy)return toast('Wait for reading to finish.','warning');try{await api('logout',{});draft=null;clearImages();pendingFiles=[];await init();}catch(e){toast(e.message,'error');}};
  window.addEventListener('focus',()=>refreshWorkspace());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)remember();else refreshWorkspace();});
  window.addEventListener('pagehide',remember);
  window.isMatchDraftSaved=()=>draftSaved&&!!savedDraft();
  draftTimer=setInterval(()=>{if(draft)remember();},1500);
  // Boot runs after the appearance layer has registered its page renderers.
})();



