// Agreed direction: host-managed rosters, browser OCR with source review, individual-match scoring.

const $ = s => document.querySelector(s), esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const points = [12,9,8,7,6,5,4,3,2,1,0,0];
const HIGH_KILLS = 30; // one player above this in a squad match is possible but rare enough to check

function uiIcon(name, options = {}) {
  const size = options.size ? ` icon-${options.size}` : '';
  const cls = options.className ? ` ${options.className}` : '';
  const fill = options.fill ? ' icon-filled' : '';
  const hidden = options.label ? '' : ' aria-hidden="true"';
  const label = options.label ? ` aria-label="${options.label}"` : '';
  return `<span class="material-symbols-outlined${size}${cls}${fill}"${hidden}${label}>${name}</span>`;
}
if (typeof window !== 'undefined') window.uiIcon = uiIcon;

// The workspace reopens where the organizer left it. Add results is never restored: it needs a deliberate start.
function lastPage(){try{const saved=localStorage.getItem('ffk-last-page-v1');return ['war','roster','results'].includes(saved)?saved:'war';}catch{return 'war';}}
let state={teams:[],matches:[]}, page=lastPage(), selected=null, tab='teams', draft=null, images=[], busy=false, rosterQuery='';

// Heavy tools load on first use, in order: the screenshot reader on the results check page, the export
// tools when Export is chosen, and the in-browser reader only when the server cannot read screenshots.
const MODULES={reader:['digit-templates.js?v=2','layout.js?v=1','ocr.js?v=16','ocr-learning.js?v=1','ocr-batch.js?v=1','panel-editor.js?v=2'],export:['scoreboard.js?v=5','scoreboard-pdf.js?v=4','templates.js?v=2','export-ui.js?v=4'],tesseract:['vendor/tesseract.min.js']};
const loadedModules={};
function loadModules(name){
  return loadedModules[name]||=MODULES[name].reduce((ready,src)=>ready.then(()=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=()=>{delete loadedModules[name];reject(Error('Could not load '+src.split('?')[0]+'. Check the connection and try again.'));};document.head.append(script);})),Promise.resolve());
}
async function exportResults(){try{await loadModules('export');openExportChooser();}catch(e){toast(e.message,'error');}}
const uid=()=>crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');

// Returns the image to send and the width it actually has, so panel bounds can be scaled to it.
function fileToDataUrl(file,image){
  const width=image.naturalWidth||image.width;
  return new Promise((resolve,reject)=>{
    if(file.size<9_000_000){const reader=new FileReader();reader.onload=()=>resolve({dataUrl:reader.result,width});reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);return;}
    const scale=Math.min(1,2400/width),canvas=document.createElement('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round((image.naturalHeight||image.height)*scale);
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);resolve({dataUrl:canvas.toDataURL('image/jpeg',.95),width:canvas.width});
  });
}
// Manual panel bounds are drawn on a 1392-wide canvas; the server wants pixels of the image it receives.
function scaleBounds(bounds,sentWidth){if(!bounds?.length)return undefined;const k=sentWidth/1392;return bounds.map(b=>({x:b.x*k,y:b.y*k,width:b.width*k,height:b.height*k}));}
function serverRoster(teams){return {teams:teams.map(t=>({id:t.id,name:t.name,players:(t.players||[]).map(p=>({id:p.id,name:p.name,isCaptain:!!p.isCaptain,aliases:p.ocrAliases||[]}))}))};}
// Read screenshots with the server's OCR engine and roster reasoning (one at a time; the engine is shared).
async function scanOnServer(sources,files,candidates,updateProgress,signal){
  const roster=serverRoster(candidates),rows=[];
  for(let i=0;i<sources.length;i++){
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    $('#ocr-status').textContent=`Reading screenshot ${i+1} of ${sources.length}…`;updateProgress(i,.05);
    const source=sources[i],sent=await fileToDataUrl(files[i],source.image),image=sent.dataUrl,regions=scaleBounds(source.bounds,sent.width);
    // The server reads one screenshot at a time; if someone else's is in progress, wait and retry.
    let scan;
    for(let attempt=0;;attempt++){
      try{scan=await api('ocr/scan',{image,roster,regions},{signal});break;}
      catch(e){if(e.name==='AbortError'||!e.busy||attempt>=8)throw e;$('#ocr-status').textContent='Another screenshot is being read. Waiting your turn…';await new Promise(r=>setTimeout(r,4000));}
    }
    const result=WarOCR.fromServerScan(scan);
    if(!result.length)throw Error(scan.warnings?.[0]||'No result panels were found in this screenshot.');
    source.layout=result.layout;source.rows=structuredClone(result);showSources();updateProgress(i,1);rows.push(result);
  }
  return rows;
}
async function api(path,data,options={}){
  const r=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:options.signal});
  const body=await r.json().catch(()=>({}));
  if(!r.ok){
    const expired=r.status===401&&!['login','session','logout'].includes(path);
    const e=Error(expired?'Your sign-in has ended. Sign in again; your match draft is kept.':body.error||(r.status===429?'Too many requests. Wait a moment and try again.':'Request failed'));
    e.status=r.status;e.busy=!!body.busy;e.expired=expired;if(expired)sessionExpired();throw e;
  }
  return body;
}
// An expired sign-in is not a network problem: ask for the password in place, keep the page and draft.
function sessionExpired(){
  if(document.querySelector('#session-dialog'))return;
  const dialog=document.createElement('dialog');dialog.id='session-dialog';dialog.className='action-confirmation';dialog.setAttribute('aria-labelledby','session-title');
  dialog.innerHTML=`<h2 id="session-title">Sign in again</h2><p>Your organizer sign-in has ended. Your page and any unsaved match draft are kept on this device.</p><form id="session-form"><label for="session-password">Organizer password</label><input id="session-password" type="password" autocomplete="current-password" required minlength="1"><p id="session-error" class="login-error" role="alert"></p><div class="confirmation-actions"><button type="button" data-later>Later</button><button type="submit" class="confirmation-accept">Sign in</button></div></form>`;
  document.body.append(dialog);dialog.showModal();
  const form=dialog.querySelector('form'),field=dialog.querySelector('#session-password'),submit=form.querySelector('[type=submit]');field.focus();
  dialog.querySelector('[data-later]').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;
    try{await api('login',{password:field.value});dialog.close();const status=$('#sync-status');if(status)status.textContent='Up to date';toast('Signed in again. Repeat your last action if it did not finish.');window.refreshWorkspace?.(false);}
    catch(err){$('#session-error').textContent=err.message;submit.disabled=false;field.select();}};
}

// Notifications say what kind they are; nothing is guessed from the wording.
// 'error' stays until dismissed and is announced as an alert; 'warning' and 'success' dismiss themselves.
let toastTimer;
function toast(message,type='success'){
  const node=$('#toast');if(!node)return;clearTimeout(toastTimer);const error=type==='error';
  node.className=error?'toast-error':type==='warning'?'toast-warning':'toast-success';node.setAttribute('role',error?'alert':'status');node.replaceChildren();
  const text=document.createElement('span');text.textContent=message;node.append(text);
  const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Dismiss notification');close.onclick=()=>node.style.display='none';node.append(close);node.style.display='flex';
  if(!error)toastTimer=setTimeout(()=>node.style.display='none',type==='warning'?8000:6000);
}

async function save(){await api('state',state);}

// Every dialog is named by its first heading, so screen readers announce what opened.
let modalCount=0;
function modal(html,options={}){
  const dialog=$('#modal');dialog.className=options.className||'';dialog.style.width=options.width||(options.wide?'min(1120px,96vw)':'');dialog.innerHTML=html;
  const heading=dialog.querySelector('h1,h2,h3');if(heading){heading.id=heading.id||'modal-title-'+(++modalCount);dialog.setAttribute('aria-labelledby',heading.id);}else dialog.removeAttribute('aria-labelledby');
  if(!dialog.open)dialog.showModal();
}

function closeModal(){$('#modal').close();}

async function go(next){if(busy){toast('Wait for screenshot reading to finish.','warning');return;}if(page==='upload'&&draft&&next!=='upload'&&!await confirmAction({title:'Leave this match?',message:'Your unsaved changes will be lost.',accept:'Leave match',cancel:'Stay here'}))return;if(next==='overview')next='war';page=next;try{localStorage.setItem('ffk-last-page-v1',next);}catch{}render();}

window.addEventListener('beforeunload',e=>{if(busy||(draft&&(!window.isMatchDraftSaved||!window.isMatchDraftSaved()))){e.preventDefault();e.returnValue='';}});

async function init(){try{const session=await api('session');if(!session.authenticated)return auth(session.setup);state=await api('state');render();}catch(e){$('#app').innerHTML='<div class="auth"><h1>Unable to connect</h1><p>'+esc(e.message)+'</p><button onclick="location.reload()">Retry</button></div>';}}

function auth(setup){
  const action=setup?'Create organizer password':'Sign in';
  // One brand composition (the badge and the War Desk name), then a plain, quiet form.
  $('#app').innerHTML=`<main class="login">
    <section class="login-brand">
      <img class="login-badge" src="assets/mascot-badge.png" alt="" width="508" height="424">
      <p class="login-wordmark">FFK War Desk</p>
      <p class="login-tagline">Results, standings and finals for FFK Prasanth tournaments.</p>
    </section>
    <section class="login-panel" aria-labelledby="login-heading">
      <h1 id="login-heading">${setup?'Set up the organizer password':'Sign in'}</h1>
      <p class="login-intro">${setup?'This password controls teams, results and qualification. Use at least 10 characters.':'Only the organizer can change teams, results and qualification.'}</p>
      <form id="login" novalidate>
        <label for="organizer-password" class="field-label">Organizer password</label>
        <div class="login-password-field">
          <input id="organizer-password" type="password" name="password" minlength="10" required autocomplete="${setup?'new-password':'current-password'}" aria-describedby="login-error">
          <button class="login-password-toggle" type="button" aria-label="Show organizer password" aria-pressed="false">
            <span class="material-symbols-outlined toggle-eye-icon eye-show icon-sm" aria-hidden="true">visibility</span>
            <span class="material-symbols-outlined toggle-eye-icon eye-hide icon-sm" aria-hidden="true" hidden>visibility_off</span>
            <span class="toggle-text" aria-hidden="true">Show</span>
          </button>
        </div>
        
        <p id="login-error" class="login-error" role="alert" aria-live="polite"></p>
        <button class="primary login-submit" type="submit"><span class="submit-text">${action}</span><span class="submit-spinner" aria-hidden="true"></span></button>
      </form>
    </section>
  </main>`;

  const form=$('#login'),field=$('#organizer-password'),toggle=form.querySelector('.login-password-toggle'),submit=form.querySelector('.login-submit'),error=$('#login-error'),eyeShow=toggle.querySelector('.eye-show'),eyeHide=toggle.querySelector('.eye-hide'),toggleText=toggle.querySelector('.toggle-text');
  toggle.onclick=()=>{
    const isPassword=field.type==='password';
    field.type=isPassword?'text':'password';
    if(toggleText)toggleText.textContent=isPassword?'Hide':'Show';
    if(eyeShow)eyeShow.hidden=isPassword;
    if(eyeHide)eyeHide.hidden=!isPassword;
    toggle.setAttribute('aria-label',isPassword?'Hide organizer password':'Show organizer password');
    toggle.setAttribute('aria-pressed',String(isPassword));
    field.focus();
  };
  form.onsubmit=async e=>{
    e.preventDefault();
    error.textContent='';
    if(!form.reportValidity())return;
    submit.disabled=true;
    submit.setAttribute('aria-busy','true');
    try{
      await api('login',{password:field.value});
      await init();
    }catch(err){
      error.textContent=err.message||'Incorrect password';
      submit.disabled=false;
      submit.removeAttribute('aria-busy');
      field.focus();
    }
  };
}

// The workspace shell, rendered once in its final form: sidebar, top bar and the current page.
const NAV=[['war','Tournament','emoji_events'],['upload','Add results','upload_file'],['roster','Teams','groups'],['results','Standings','leaderboard']];
const SOCIAL_ICON={instagram:'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M17.5 6.5h.01',youtube:'M9 8l7 4-7 4zM3 5h18v14H3z'};
const socialLinks=()=>`<div class="channel-socials">${[['instagram','https://www.instagram.com/ffk_prasanth/','Instagram'],['youtube','https://www.youtube.com/@FFK_Prasanth','YouTube']].map(([k,href,label])=>`<a href="${href}" target="_blank" rel="noopener noreferrer" aria-label="FFK Prasanth on ${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${SOCIAL_ICON[k]}"/></svg></a>`).join('')}</div>`;
let renderedPage=null;
function render(){
  const title=(NAV.find(([id])=>id===page)||[0,'Workspace'])[1],signout=`<button type="button" class="signout" onclick="logout()">${uiIcon('logout',{size:'sm'})}<span>Sign out</span></button>`;
  $('#app').innerHTML=`<div class="shell channel-shell comfort-shell" data-page="${page}"><aside class="sidebar"><div class="brand channel-brand">${page==='war'?'<span class="channel-monogram">FFK</span>':'<img class="channel-profile" src="assets/channel-avatar.jpg" alt="FFK Prasanth channel profile">'}<span class="channel-wordmark">FFK<br>PRASANTH<small>WAR DESK</small></span></div>
    <nav class="nav" aria-label="Main">${NAV.map(([id,label,icon])=>`<button type="button" class="${page===id?'active':''}" onclick="${id==='upload'?'navAddResults()':`go('${id}')`}"${page===id?' aria-current="page"':''}><span class="nav-icon">${uiIcon(icon,{size:'md'})}</span><span class="comfort-nav-label">${label}</span></button>`).join('')}</nav>
    <button type="button" class="host-access-button" onclick="openHostAccess()">${uiIcon('manage_accounts',{size:'md'})}<span>Host desk</span></button>
    <div class="sidebar-footer">${socialLinks()}${signout}</div></aside>
    <main class="main"><header class="topbar"><span class="comfort-top-title"><span>FFK WAR DESK</span><strong>${title}</strong></span><div class="topbar-right"><button type="button" class="sync-button" onclick="refreshWorkspace(true)" aria-label="Refresh saved data" title="Refresh saved data"><span id="sync-status">Up to date</span> ↻</button><details class="mobile-account"><summary aria-label="Channel and account menu">•••</summary><div class="mobile-account-panel"><button type="button" class="mobile-host-btn" onclick="this.closest('details').open=false;openHostAccess()">${uiIcon('manage_accounts',{size:'sm'})}<span>Host desk</span></button>${socialLinks()}${signout}</div></details></div></header>
    <div class="content">${page==='war'?renderWar():page==='roster'?roster():page==='upload'?(window.WarOCR?intake():'<div class="panel empty" role="status"><p>Loading the screenshot tools…</p></div>'):results()}</div></main></div>`;
  if(page==='upload'&&!window.WarOCR){loadModules('reader').then(()=>{if(page==='upload')render();}).catch(e=>{const box=document.querySelector('.content .empty p');if(box)box.textContent=e.message;});return;}
  bind();
  // A new page starts at the top with focus on its heading, so keyboard and screen-reader users land there.
  if(renderedPage!==page){window.scrollTo({top:0,behavior:'instant'});const heading=document.querySelector('.content h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}
  renderedPage=page;window.pageMounted?.(page);
}
// "Add results" goes straight to the next tournament match when one is due.
function navAddResults(){
  if(!draft&&window.WarGuide&&window.WarTournament){const set=WarGuide.next(state),p=WarGuide.progress(state,set);if(['A','B','C'].includes(set)&&WarTournament.availableTeams(state,set).length>=12&&!p.locked&&p.played<p.target)return warNew(set);}
  go('upload');
}

function header(kicker,title,action=''){return `<div class="eyebrow">${kicker}</div><div class="heading"><h1>${title}</h1>${action}</div>`;}

function roster(){
  const groups=state.war?.groups||{},setOf=id=>['A','B'].find(set=>(groups[set]||[]).includes(id));
  const name=text=>{const m=/^(FFK\s+)(.*)$/i.exec(text||'');return m?`<span class="ffk-prefix">${esc(m[1].trim())}</span> ${esc(m[2])}`:esc(text);};
  return header('Before the first drop','Your teams',`<span id="roster-count" class="caption roster-result-count" role="status">${state.teams.length} of ${state.teams.length} teams</span><button type="button" class="primary brand-main-action" onclick="teamForm()">${uiIcon('add',{size:'sm'})} <span>Register team</span></button>`)+`<div class="search-bar topbar-search"><label for="roster-search">Find a team or player<input id="roster-search" type="search" placeholder="Search teams or players" value="${esc(rosterQuery)}"></label></div><p class="team-list-intro">Keep team and player names up to date. Use the exact in-game names to make result checking easier.</p><p id="roster-empty" hidden>No teams match your search.</p><div class="team-grid team-list">${state.teams.map((t,i)=>{const set=setOf(t.id);return `<article class="team-card team-row"><div class="team-row-id"><h2>${name(t.name)}</h2><span class="team-row-meta">${t.rosterList?`List ${t.rosterList} · slot ${t.slot}`:`Team ${i+1}`}${set?` · <span class="team-set">Set ${set}</span>`:''}</span></div><ol class="team-row-players">${t.players.map((p,j)=>`<li${j>3?' class="team-row-sub" title="Substitute"':''}>${name(p.name)}</li>`).join('')}</ol><div class="actions"><button onclick="teamForm('${t.id}')" aria-label="Edit roster for ${esc(t.name)}">Edit</button><button class="danger" onclick="deleteTeam('${t.id}')" aria-label="Remove ${esc(t.name)}">Remove</button></div></article>`;}).join('')||'<div class="empty"><h3>No teams registered yet</h3><p>Add your first team.</p></div>'}</div>`;}

// Each roster slot keeps its player's identity. Editing the text renames that player (spelling fixes keep
// their ID, history and learned aliases); "New person" explicitly replaces the slot with someone else.
function rosterUpdate(team,slots){
  const players=[];
  slots.forEach((slot,i)=>{
    if(!slot.name)return;
    const prior=team?.players[i];
    if(prior&&!slot.replace){
      const aliases=new Set(prior.ocrAliases||[]);if(prior.name!==slot.name)aliases.add(prior.name);aliases.delete(slot.name);
      players.push({...prior,name:slot.name,...(aliases.size?{ocrAliases:[...aliases]}:{})});
      if(!aliases.size)delete players.at(-1).ocrAliases;
    }else players.push({id:uid(),name:slot.name});
  });
  return players;
}
function teamForm(id){
  const t=state.teams.find(t=>t.id===id),editing=!!t;
  const slot=i=>{const prior=t?.players[i];return `<div class="comfort-player-field" data-slot="${i}"><label for="team-p${i}">${i===4?'Substitute':'Player '+(i+1)}</label><input id="team-p${i}" name="p${i}" ${i<4?'required':''} maxlength="90" autocomplete="off" spellcheck="false" value="${esc(prior?.name||'')}" placeholder="${i===0?'For example, FFK Prasanth':i===4?'Substitute’s in-game name':'Exact in-game name'}">${prior?`<button type="button" class="replace-player" data-replace="${i}" aria-pressed="false" aria-describedby="replace-note-${i}">New person</button><small class="replace-note" id="replace-note-${i}" aria-live="polite"></small>`:''}</div>`;};
  modal(`<h2>${editing?'Edit team':'Register a team'}</h2><p class="comfort-form-intro">${editing?'Fixing a name’s spelling keeps that player’s results together. If someone else has joined, choose “New person” for that slot.':'A team name and its four players. A substitute is optional.'}</p>
    <form id="team-form"><section class="comfort-team-identity"><label for="team-name">Team name</label><input id="team-name" name="team" required maxlength="70" autocomplete="off" spellcheck="false" value="${esc(t?.name||'')}" placeholder="For example, FFK Phoenix"></section>
    <section class="comfort-team-players"><h3>Starting four</h3><p class="comfort-help">Use each player’s exact in-game name, symbols included, so screenshots match.</p><div class="comfort-player-fields">${[0,1,2,3].map(slot).join('')}</div>
    <details class="comfort-substitute" ${t?.players[4]?'open':''}><summary>${t?.players[4]?'Substitute · '+esc(t.players[4].name):'Add a substitute'}</summary><p>Optional. Four active players are still required for each match.</p>${slot(4)}</details></section>
    <p id="form-error" class="error" role="alert" tabindex="-1"></p>
    <div class="actions"><button type="button" class="comfort-cancel" onclick="closeModal()">Cancel</button><button class="primary" type="submit">${editing?'Save roster':'Register team'}</button></div></form>`);
  const form=$('#team-form'),team=form.elements.team,inputs=[0,1,2,3,4].map(i=>form.elements['p'+i]),error=$('#form-error'),submit=form.querySelector('[type=submit]');
  const dialog=$('#modal');dialog.classList.add('comfort-team-dialog');dialog.addEventListener('close',()=>dialog.classList.remove('comfort-team-dialog'),{once:true});
  form.querySelectorAll('[data-replace]').forEach(button=>button.onclick=()=>{
    const i=+button.dataset.replace,on=button.getAttribute('aria-pressed')!=='true',note=$('#replace-note-'+i);
    button.setAttribute('aria-pressed',String(on));button.textContent=on?'Keep player':'New person';
    note.textContent=on?`Saved as a new player. Past results stay with ${t.players[i].name}.`:'';
    if(on){inputs[i].value='';inputs[i].focus();}else if(!inputs[i].value)inputs[i].value=t.players[i].name;
  });
  const check=()=>{
    const values=inputs.map(x=>x.value.trim());
    inputs.forEach((x,i)=>x.setCustomValidity(values[i]&&values.some((v,j)=>j!==i&&v===values[i])?'Each player needs a different in-game name.':''));
    const name=team.value.trim();
    team.setCustomValidity(!name?'Enter a team name.':state.teams.some(x=>x.id!==id&&x.name.toLowerCase()===name.toLowerCase())?'This team name is already registered.':'');
  };
  form.oninput=()=>{check();error.textContent='';};
  form.onsubmit=async e=>{
    e.preventDefault();check();if(submit.disabled||!form.reportValidity())return;
    const slots=inputs.map((x,i)=>({name:x.value.trim(),replace:form.querySelector(`[data-replace="${i}"]`)?.getAttribute('aria-pressed')==='true'}));
    const updated={...(t||{}),id:id||uid(),name:team.value.trim(),players:rosterUpdate(t,slots)};
    const prior=structuredClone(state);if(t)state.teams[state.teams.findIndex(x=>x.id===id)]=updated;else state.teams.push(updated);
    submit.disabled=true;const label=submit.textContent;submit.textContent='Saving…';
    try{await save();closeModal();render();toast(editing?'Roster saved':'Team registered');}
    catch(e){state=prior;error.textContent=e.message;error.focus();}
    finally{if(submit.isConnected){submit.disabled=false;submit.textContent=label;}}
  };
  check();team.focus({preventScroll:true});
}

async function deleteTeam(id){if(state.matches.some(m=>m.rows.some(r=>r.teamId===id)))return toast('This team has recorded results. Keep its roster for match history.','error');if(!await confirmAction({title:'Remove team?',message:'This team will be removed from your roster.',accept:'Remove team',cancel:'Keep team'}))return;const prior=structuredClone(state);state.teams=state.teams.filter(t=>t.id!==id);try{await save();render();}catch(e){state=prior;toast(e.message,'error');}}


function blankRows(){return Array.from({length:12},(_,i)=>({placement:i+1,teamId:'',players:Array.from({length:4},()=>({playerId:'',name:'',kills:null})),warnings:[],confirmed:false,adjustments:[]}));}

function applySubstitutes(row){if(!row.teamId)return;row.players.forEach((p,i)=>{if(!p.playerId){p.rawName=p.rawName||p.name;p.isSubstitute=true;p.name=(p.rawName||p.name||'').trim()||('Substitute '+(i+1));p.playerId='sub:'+row.teamId+':'+draft.id+':'+i;}});row.warnings=row.warnings.filter(w=>w!=='Some screenshot names do not match this registered roster');}


function redrawReview(){$('#review').innerHTML=review();bindReview();}


function rematchDraft(){let matched=0;draft.rows.forEach(r=>{const team=state.teams.find(t=>t.id===r.teamId),result=WarOCR.matchTeam(r.players,team?[team]:state.teams,team?{trustedTeamId:team.id}:{});if(result.teamId){r.teamId=result.teamId;applySubstitutes(r);r.confirmed=false;matched+=r.players.filter(p=>p.playerId&&!p.isSubstitute).length;}});redrawReview();toast(matched+' player names matched to registered rosters.');}

// 'confirmed', 'ready' (complete and every reading confident) or 'look' (needs the organizer's eyes).
function rowStatus(r){
  if(r.confirmed)return 'confirmed';
  const complete=r.teamId&&r.players.every(p=>p.playerId&&p.name.trim()&&Number.isInteger(p.kills)&&p.kills>=0&&p.kills<=99);
  const doubtful=r.players.some(p=>p.serverRead&&(p.killConfidence??100)<70||(!p.isSubstitute&&p.matchScore!==undefined&&p.matchScore<.7)||p.kills>HIGH_KILLS)||r.warnings.some(w=>w.includes('disagree'))||!!r.flags?.length;
  return complete&&!doubtful?'ready':'look';
}
function reviewSummary(){
  const rows=draft.rows,cells=rows.flatMap(r=>r.players),read=cells.filter(p=>Number.isInteger(p.kills)).length;
  const ready=rows.filter(r=>rowStatus(r)==='ready').length,look=rows.filter(r=>rowStatus(r)==='look').length;
  return {read,total:cells.length,teams:rows.filter(r=>r.teamId).length,ready,look,confirmed:rows.filter(r=>r.confirmed).length};
}


async function finalize(){
  if(busy||!draft)return;
  if(draft.rows.some(r=>!r.confirmed))return toast('Confirm all 12 team results before saving.','error');
  if(new Set(draft.rows.map(r=>r.teamId)).size!==12)return toast('Every placement needs a different team.','error');
  draft.name=$('#match-name').value.trim();draft.map=$('#match-map').value;if(!draft.name)return toast('Enter a match name.','error');
  const warBefore=state.war===undefined?undefined:structuredClone(state.war);
  if(draft.stage){try{WarTournament.registerResult(state,draft);}catch(e){return toast(e.message,'error');}}
  const rosterBefore=structuredClone(state.teams);
  const learnedNames=WarOCR.rememberAliases(state.teams,draft.rows);
  const m=structuredClone(draft);m.rows.forEach(r=>{r.teamName=state.teams.find(t=>t.id===r.teamId).name;delete r.flags;delete r._read;r.players.forEach(p=>{delete p.ocrRegion;delete p.killEdited;delete p.evidenceCrop;delete p.identityEdited;});});m.created=new Date().toISOString();
  busy=true;state.matches.push(m);
  try{await save();}catch(e){state.matches.pop();state.teams=rosterBefore;if(warBefore===undefined)delete state.war;else state.war=warBefore;busy=false;toast(e.message,'error');return;}
  let message='Verified match saved'+(learnedNames?' · '+learnedNames+' player name corrections remembered':'');
  try{
    const records=WarOCRLearning.capture({...draft,created:m.created},images,(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;});
    const count=await WarOCRLearning.store(records);if(count)message+=` · ${count} reviewed OCR examples saved in this browser`;
  }catch(e){console.warn(e);message+=' · OCR examples could not be saved in this browser';}
  draft=null;clearImages();selected=m.id;page='results';busy=false;render();toast(message);
}

async function exportOCRExamples(){try{const count=await WarOCRLearning.download();toast(count+' reviewed OCR examples exported');}catch(e){toast('Could not export OCR examples: '+e.message,'error');}}

function clearImages(){images.forEach(x=>URL.revokeObjectURL(x.url));images=[];}

async function discard(){if(await confirmAction({title:'Discard this match?',message:'The unsaved results will be removed.',accept:'Discard match',cancel:'Keep editing'})){draft=null;clearImages();render();}}

function bind(){if(page==='upload'){$('#scan').onclick=()=>scan();$('#manual').onclick=async()=>{if(draft&&!await confirmAction({title:'Start fresh?',message:'This will replace the current results with an empty match.',accept:'Start fresh',cancel:'Keep results'}))return;clearImages();draft={id:uid(),name:$('#match-name').value,map:$('#match-map').value,stage:$('#war-stage')?.value||undefined,entry:'manual',rows:blankRows()};redrawReview();};bindReview();showSources();}if(page==='results'&&$('#match-select'))$('#match-select').onchange=e=>{selected=e.target.value;render();};}

// The screenshots behind the current results: always visible above the check, each one can be viewed
// full size (and zoomed) or have its result panels adjusted.
function showSources(){
  const tray=$('#sources');if(!tray)return;tray.hidden=!images.length;
  tray.innerHTML=images.length?`<h3 class="source-tray-title">Screenshots</h3><div class="source-tray-items">${images.map((im,i)=>`<figure class="source-item"><button type="button" class="source-thumb" onclick="openSource(${i})" aria-label="View screenshot ${i+1} full size"><img src="${im.url}" alt=""></button><figcaption>${im.layout?im.layout.panels.length+' panels found':'Screenshot '+(i+1)}</figcaption><div class="source-actions"><button type="button" onclick="openSource(${i})">View</button><button type="button" onclick="editPanels(${i})" ${busy?'disabled':''}>Adjust panels</button></div></figure>`).join('')}</div>`:'';
}

// Full-size screenshot viewer. With a region, that player's row is outlined and scrolled into view.
function openSource(i,region){
  const source=images[i];if(!source)return;const image=source.image,w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;
  modal(`<div class="panel-head"><h2>Screenshot ${i+1}${region?' · highlighted row':''}</h2><div class="actions"><button type="button" id="source-zoom" aria-pressed="false">Zoom to 100%</button><button type="button" onclick="editPanels(${i})">Adjust panels</button><button type="button" onclick="closeModal()">Close</button></div></div><div class="source-viewer" id="source-viewer"><canvas id="source-canvas" role="img" aria-label="Screenshot ${i+1}${region?' with the selected player row outlined':''}"></canvas></div>`,{wide:true});
  const canvas=$('#source-canvas'),ctx=canvas.getContext('2d');canvas.width=w;canvas.height=h;ctx.drawImage(image,0,0);
  let mark=null;
  if(region){const sx=w/region.width,sy=h/region.height,x=Math.min(region.name[0],region.digits[0])*sx,y=Math.min(region.name[1],region.digits[1])*sy,r=Math.max(region.name[0]+region.name[2],region.digits[0]+region.digits[2])*sx,b=Math.max(region.name[1]+region.name[3],region.digits[1]+region.digits[3])*sy;
    mark={x,y,w:r-x,h:b-y};ctx.lineWidth=Math.max(3,w/400);ctx.strokeStyle='#ffcd2e';ctx.strokeRect(mark.x-6,mark.y-6,mark.w+12,mark.h+12);}
  const viewer=$('#source-viewer'),zoom=$('#source-zoom');
  const focusMark=()=>{if(!mark)return;const k=canvas.clientWidth/w;viewer.scrollTo({left:mark.x*k-viewer.clientWidth/2,top:mark.y*k-viewer.clientHeight/2});};
  zoom.onclick=()=>{const on=zoom.getAttribute('aria-pressed')!=='true';zoom.setAttribute('aria-pressed',String(on));zoom.textContent=on?'Fit to window':'Zoom to 100%';viewer.classList.toggle('is-zoomed',on);requestAnimationFrame(focusMark);};
  if(region){zoom.click();}
}

async function scan(skipConfirm=false){
  if(state.teams.length<12)return toast('Register at least 12 teams before reading a full match.','error');
  const files=[...$('#screenshots').files];
  if(!files.length)return toast('Select your result screenshots first.','error');
  if(files.length>6)return toast('Use at most 6 screenshots per match.','error');
  if(files.some(f=>f.size>15*1024*1024))return toast('Each screenshot must be smaller than 15 MB.','error');
  if(!window.WarOCRBatch)return toast('Unable to prepare results. Refresh the page and try again.','error');
  if(draft&&skipConfirm!==true&&!await confirmAction({title:'Replace current results?',message:'Your new screenshots will replace this unsaved match.',accept:'Replace results',cancel:'Keep results'}))return;
  // The new reading is built on the side. The draft on screen (and in autosave) only changes once
  // the reading has fully succeeded, so a failed or cancelled re-read can never erase reviewed work.
  const previousDraft=draft,previousImages=images;scanControl=new AbortController();const signal=scanControl.signal;
  busy=true;setMatchLoading(true);$('#scan').disabled=true;$('#manual').disabled=true;$('#screenshots').disabled=true;$('#ocr-progress').hidden=false;
  const previousBounds=files.map(f=>previousImages.find(im=>im.fileKey===f.name+':'+f.size)?.bounds);
  images=[];const incoming={id:uid(),name:$('#match-name').value,map:$('#match-map').value,stage:$('#war-stage')?.value||previousDraft?.stage||undefined,rows:blankRows()};
  const restore=()=>{images.forEach(x=>URL.revokeObjectURL(x.url));images=previousImages;draft=previousDraft;};
  const progress=files.map(()=>0);
  const updateProgress=(index,value)=>{
    progress[index]=Math.max(progress[index],Math.min(1,value));
    const overall=progress.reduce((sum,n)=>sum+n,0)/files.length;
    $('#ocr-progress').value=overall;$('#ocr-status').textContent='Reading screenshots · '+Math.round(overall*100)+'%';
    markScanItem(index,progress[index]);scanTick();
  };
  try{
    await WarOCRLearning.load().catch(e=>console.warn('Reviewed OCR examples unavailable:',e));
    const localOCR=await api('ocr/status').catch(()=>({available:false}));
    images=files.map((file,i)=>{const url=URL.createObjectURL(file),image=new Image();image.src=url;return {url,image,bounds:previousBounds[i],fileKey:file.name+':'+file.size};});
    await Promise.all(images.map(source=>source.image.decode()));showSources();showScanCard(files);
    const candidates=typeof WarTournament==='undefined'?state.teams:WarTournament.scanTeams(state,incoming.stage);
    let rowsByScreenshot=null;
    if(localOCR.scan){
      try{rowsByScreenshot=await scanOnServer(images,files,candidates,updateProgress,signal);}
      // A busy server is a queue, not a failure: it is reported as such instead of switching to the slow in-browser reader.
      catch(e){if(e.name==='AbortError'||e.busy)throw e;console.warn('Server screenshot reader failed; using the in-browser reader:',e);if(scanView)scanView.fallback=String(e.message||e).slice(0,140);$('#ocr-status').textContent='Switching to the in-browser reader…';progress.fill(0);}
    }
    if(!rowsByScreenshot)await loadModules('tesseract').catch(()=>{});
    if(!rowsByScreenshot&&!window.Tesseract)throw Error('The in-browser reader could not load (it needs an internet connection). Use a server with the screenshot reader installed, or enter results by hand.');
    if(!rowsByScreenshot)rowsByScreenshot=await WarOCRBatch.run(images,{
      maxWorkers:WarOCRBatch.capacity(files.length,navigator),
      createWorker:async()=>{
        const worker=await Tesseract.createWorker('eng',1,{logger:m=>{if(m.status&&progress.every(n=>n===0))$('#ocr-status').textContent='Preparing the screenshot reader…';}});
        try{await worker.setParameters({tessedit_pageseg_mode:'11'});return worker;}catch(e){await worker.terminate().catch(()=>{});throw e;}
      },
      onWorkerFailure:e=>console.warn('Using available screenshot readers:',e),
      process:async(worker,source,index)=>{
        if(signal.aborted)throw new DOMException('Cancelled','AbortError');
        const rows=await WarOCR.extract(worker,source.image,candidates,(width,height)=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return canvas;},(_text,value)=>updateProgress(index,value),{
          bounds:source.bounds,compare:localOCR.available?async(image,boxes)=>(await api('ocr',{image,boxes})).readings:undefined
        });
        source.layout=rows.layout;source.rows=structuredClone(rows);showSources();updateProgress(index,1);return rows;
      }
    });
    if(signal.aborted)throw new DOMException('Cancelled','AbortError');
    // Completion order never changes screenshot precedence or disagreement handling.
    rowsByScreenshot.forEach(rows=>rows.forEach(row=>WarOCR.merge(incoming.rows[row.placement-1],row)));
    // Applied only now: every step that can fail has succeeded.
    draft=incoming;previousImages.forEach(x=>URL.revokeObjectURL(x.url));
    draft.rows.forEach(row=>{applySubstitutes(row);if(!row.teamId)row.warnings.push('Team could not be matched confidently');if(row.players.some(p=>p.kills===null))row.warnings.push('Missing or uncertain kill counts');if(row.players.some(p=>!p.playerId))row.warnings.push('Some screenshot names do not match this registered roster');});
    // Teams that read cleanly are confirmed here; the organizer is only shown the ones that need a look.
    if(window.autoConfirmDraft)autoConfirmDraft();
    const sum=reviewSummary();
    $('#ocr-status').textContent=`Results ready · ${sum.read} of ${sum.total} kill counts read · ${sum.confirmed} teams confirmed automatically, ${sum.ready+sum.look} to check`;document.querySelector('.intake-panel')?.removeAttribute('open');redrawReview();
  }catch(e){
    restore();setMatchLoading(false);
    const kept=previousDraft?' Your earlier results are unchanged.':'';
    if(e.name==='AbortError'||signal.aborted){
      $('#ocr-status').textContent='Reading cancelled.'+kept;
      if(draft)redrawReview();else $('#review').innerHTML='';
      toast('Reading cancelled.'+kept);
      return;
    }
    console.error('Screenshot processing failed',e);
    const reason=e.busy?'The screenshot reader is still busy with another read. Wait a minute and try again, or enter results by hand.':'Unable to read these screenshots. Try clearer screenshots or enter results by hand.';
    $('#ocr-status').textContent=(e.busy?'The screenshot reader is busy.':'Unable to read these screenshots.')+kept;
    if(draft)redrawReview();else $('#review').innerHTML='';
    toast(reason+kept,'error');
  }finally{
    busy=false;setMatchLoading(false);$('#scan').disabled=false;$('#manual').disabled=false;$('#screenshots').disabled=false;showSources();window.refreshUploadStatus?.();
  }
}

function resultMatch(){return selected==="__overall__"?WarOverall.aggregate(state):state.matches.find(m=>m.id===selected);}
function score(r){if(r.overall)return {kills:r.kills,placement:r.placementPoints,adjustment:r.adjustment,total:r.total};const kills=r.players.reduce((n,p)=>n+p.kills,0),placement=points[r.placement-1],adjustment=(r.adjustments||[]).reduce((n,a)=>n+a.value,0);return {kills,placement,adjustment,total:kills+placement+adjustment};}

function rankedRows(m){if(m.isOverall)return m.rows;return m.rows.slice().sort((a,b)=>{const x=score(a),y=score(b);return y.total-x.total||y.kills-x.kills||Number(b.placement===1)-Number(a.placement===1)||y.placement-x.placement;});}


async function deleteMatch(){
  if(busy)return toast('Wait for the current operation to finish.','warning');
  const match=state.matches.find(m=>m.id===selected);if(!match)return;
  if(!await confirmAction({title:'Delete match?',message:`“${match.name}” and its results will be permanently deleted. Your teams will stay saved.`,accept:'Delete match',cancel:'Keep match'}))return;
  busy=true;
  try{state=await api('matches/delete',{id:match.id});selected=state.matches.at(-1)?.id||null;render();toast('Match deleted');}
  catch(e){toast('Could not delete match: '+e.message,'error');}
  finally{busy=false;}
}


// One saved team result: correct kills or finish (recorded with a reason), and apply point adjustments.
// Every write is guarded against double submission; the server also refuses repeated adjustment IDs.
let detailsWriting=false;
// Undo a failed edit without replacing the objects the open dialog still refers to.
function restoreInPlace(target,snapshot){
  const rows=target.rows;
  Object.keys(target).forEach(k=>{if(!(k in snapshot))delete target[k];});Object.assign(target,snapshot,{rows});
  rows.forEach((row,i)=>{Object.keys(row).forEach(k=>{if(!(k in snapshot.rows[i]))delete row[k];});Object.assign(row,snapshot.rows[i]);});
}
function details(teamId){
  const m=state.matches.find(m=>m.id===selected),r=m?.rows.find(r=>r.teamId===teamId);if(!r)return;
  const locked=!!(m.stage&&state.war?.qualified?.[m.stage]);
  const history=(m.corrections||[]).filter(c=>c.teamId===teamId);
  modal(`<h2>${esc(r.teamName)}</h2><p class="caption">${esc(m.name)} · finished #${r.placement} · ${score(r).total} pts</p>
    <form id="correct" class="details-section"><h3>Players and kills</h3>
      ${r.players.map((p,j)=>`<div class="correct-row"><label for="correct-k${j}">${esc(p.name)}${p.isSubstitute?' <span class="badge">SUB</span>':''}</label><input id="correct-k${j}" name="k${j}" type="number" inputmode="numeric" min="0" max="99" step="1" required value="${p.kills}" ${locked?'disabled':''}></div>`).join('')}
      <div class="correct-row"><label for="correct-place">Finish</label><select id="correct-place" name="placement" ${locked?'disabled':''}>${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${r.placement===i+1?'selected':''}>#${i+1}${i+1===r.placement?'':' · swaps with '+esc(m.rows.find(x=>x.placement===i+1)?.teamName||'')}</option>`).join('')}</select></div>
      ${locked?`<p class="notice">Set ${esc(m.stage)} is locked. Reopen it in Tournament to correct this result.</p>`:`<label>Reason for the correction<input name="reason" maxlength="200" placeholder="e.g. Kill feed review showed 6, not 5"></label><div class="actions"><button type="submit">Save correction</button></div>`}
      <p id="correct-error" class="error" role="alert"></p>
      ${history.length?`<details class="correction-log"><summary>${history.length} earlier correction${history.length===1?'':'s'}</summary>${history.map(c=>`<p>${esc(c.changes.join(' · '))}<br><small>${esc(c.reason)} · ${new Date(c.at).toLocaleString('en-IN')}</small></p>`).join('')}</details>`:''}
    </form>
    <section class="details-section"><h3>Point adjustments</h3>${(r.adjustments||[]).map(a=>`<p>${a.value>0?'+':''}${a.value} pts · ${esc(a.reason)}<br><small>${new Date(a.at).toLocaleString('en-IN')}</small></p>`).join('')||'<p>No adjustments applied.</p>'}
    <form id="adjust"><div class="form-grid"><label>Points (+ or −)<input name="value" type="number" required min="-999" max="999" step="1" placeholder="−5"></label><label>Reason<input name="reason" required maxlength="200" placeholder="Explain the host decision"></label></div><div class="actions"><button type="button" onclick="closeModal()">Close</button><button class="primary" type="submit">Apply adjustment</button></div><p id="adjust-error" class="error" role="alert"></p></form></section>`);
  const write=async(form,errorBox,change,success)=>{
    if(detailsWriting)return;detailsWriting=true;const buttons=[...form.querySelectorAll('button[type=submit]')];buttons.forEach(b=>b.disabled=true);
    const before=structuredClone(m);
    try{change();await save();closeModal();render();toast(success);}
    catch(e){restoreInPlace(m,before);$(errorBox).textContent=e.message;}
    finally{detailsWriting=false;buttons.forEach(b=>{if(b.isConnected)b.disabled=false;});}
  };
  if(!locked)$('#correct').onsubmit=e=>{
    e.preventDefault();const f=e.target,kills=r.players.map((_,j)=>f.elements['k'+j].value===''?NaN:Number(f.elements['k'+j].value)),place=Number(f.elements.placement.value),reason=f.elements.reason.value.trim();
    if(kills.some(k=>!Number.isInteger(k)||k<0||k>99))return $('#correct-error').textContent='Kills must be whole numbers from 0 to 99.';
    const changes=[];r.players.forEach((p,j)=>{if(p.kills!==kills[j])changes.push(`${p.name}: ${p.kills} → ${kills[j]} kills`);});
    const other=place!==r.placement?m.rows.find(x=>x.placement===place):null;if(other)changes.push(`Finish #${r.placement} → #${place} (swapped with ${other.teamName})`);
    if(!changes.length)return $('#correct-error').textContent='Nothing has changed.';
    if(!reason)return $('#correct-error').textContent='Add a short reason so the correction can be checked later.';
    write(f,'#correct-error',()=>{r.players.forEach((p,j)=>p.kills=kills[j]);if(other){other.placement=r.placement;r.placement=place;}m.corrections=[...(m.corrections||[]),{id:uid(),teamId,reason,changes,at:new Date().toISOString()}];},'Correction saved. Standings recalculated.');
  };
  $('#adjust').onsubmit=e=>{
    e.preventDefault();const value=Number(e.target.value.value),reason=e.target.reason.value.trim();
    if(!Number.isInteger(value)||!value||!reason)return $('#adjust-error').textContent='Enter non-zero whole points and a reason.';
    write(e.target,'#adjust-error',()=>{r.adjustments=[...(r.adjustments||[]),{id:uid(),value,reason,at:new Date().toISOString()}];},'Adjustment recorded');
  };
}


async function logout(){if(busy)return toast('Wait for reading to finish.','warning');if(draft&&!await confirmAction({title:'Sign out?',message:'Your unsaved match will be discarded.',accept:'Sign out',cancel:'Keep working'}))return;try{await api('logout',{});draft=null;clearImages();await init();}catch(e){toast(e.message,'error');}}




let scanControl=null,scanTimer=null,scanStatusWatch=null,scanView=null;
function setMatchLoading(active){
  document.querySelector('#review')?.setAttribute('aria-busy',String(active));
  if(!active){clearInterval(scanTimer);scanTimer=null;scanControl=null;scanStatusWatch?.disconnect();scanStatusWatch=null;scanView=null;document.body?.classList.remove('is-reading');document.querySelector('#scan-card')?.remove();}
}
// Reading gets a page of its own: overall percentage, one completion line segment per screenshot, each
// screenshot with what was found in it once it is done, and a way out. The upload form is hidden meanwhile.
const READING_RING=2*Math.PI*52,shortTeamName=name=>String(name||'').replace(/^FFK\s+/i,'').trim()||String(name||'');
const clock=ms=>{const s=Math.max(0,Math.round(ms/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
function showScanCard(files){
  const host=$('#review');if(!host)return;
  const n=files.length,started=Date.now();document.body?.classList.add('is-reading');
  scanView={n,started,real:Array(n).fill(0),begun:Array(n).fill(0),shown:0,special:null,stopping:false,queued:false,fallback:''};
  const check='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.6l4.2 4.2 8.8-9.4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  host.innerHTML=`<section class="reading-stage" id="scan-card" aria-label="Reading screenshots">
    <div class="reading-hero">
      <div class="reading-ring" aria-hidden="true"><svg viewBox="0 0 120 120"><circle class="ring-track" cx="60" cy="60" r="52"/><circle class="ring-fill" id="reading-ring" cx="60" cy="60" r="52" stroke-dasharray="${READING_RING.toFixed(1)}" stroke-dashoffset="${READING_RING.toFixed(1)}"/></svg><div class="ring-value"><strong id="reading-pct">0</strong><span>%</span></div></div>
      <div class="reading-main">
        <p class="reading-kicker">Step 2 of 3 · Reading</p>
        <h2>Reading ${n} screenshot${n===1?'':'s'}</h2>
        <p class="reading-live" id="scan-live" role="status"><i aria-hidden="true"></i><span>Getting ready…</span></p>
        <div class="reading-line" id="reading-line" role="progressbar" aria-label="Reading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">${files.map((_,i)=>`<span id="reading-seg-${i}"><i></i></span>`).join('')}</div>
        <p class="reading-count"><b id="reading-done">0 of ${n} done</b><span id="scan-card-note">0:00 so far · usually 5 to 15 seconds per screenshot</span></p>
      </div>
      <button type="button" id="scan-cancel">Cancel</button>
    </div>
    <p class="reading-notice" id="reading-notice" role="status" hidden></p>
    <dl class="reading-stats" aria-label="Found so far">
      <div><dt>Placements</dt><dd><b id="stat-placements">0</b><small>of 12</small></dd></div>
      <div><dt>Teams matched</dt><dd><b id="stat-teams">0</b><small>of 12</small></dd></div>
      <div><dt>Kill counts read</dt><dd><b id="stat-kills">0</b><small>of 48</small></dd></div>
    </dl>
    <ol class="scan-list">${files.map((f,i)=>`<li id="scan-item-${i}" class="is-waiting"><div class="scan-thumb">${images[i]?.url?`<img src="${images[i].url}" alt="">`:''}<span class="scan-index">${i+1}</span><span class="scan-badge" aria-hidden="true">${check}</span></div><div class="scan-meta"><span class="scan-name" title="${esc(f.name)}">${esc(f.name)}</span><span class="scan-state">Waiting</span></div><p class="scan-found" id="scan-found-${i}" hidden></p></li>`).join('')}</ol></section>`;
  $('#scan-cancel').onclick=()=>{scanControl?.abort();$('#scan-cancel').disabled=true;scanView.stopping=true;scanTick();};
  // Messages from the reader that explain a wait (another read in progress, switching readers) are shown for a few seconds.
  scanStatusWatch?.disconnect();const status=$('#ocr-status');
  const noteStatus=()=>{const text=(status.textContent||'').trim();if(!scanView)return;if(/^Another/.test(text))scanView.queued=true;if(/^(Another|Switching|Preparing)/.test(text))scanView.special={text,at:Date.now()};};
  if(status&&typeof MutationObserver!=='undefined'){scanStatusWatch=new MutationObserver(noteStatus);scanStatusWatch.observe(status,{childList:true,characterData:true,subtree:true});}
  if(status)noteStatus();
  clearInterval(scanTimer);scanTimer=setInterval(scanTick,250);scanTick();
  host.querySelector('#scan-card').scrollIntoView({block:'nearest'});
}
function setScanLive(text){const live=document.querySelector('#scan-live span');if(live&&live.textContent!==text)live.textContent=text;}
// The reader reports a screenshot as finished, not how far along it is, so the bar eases towards (never to) done
// while a screenshot is being read. The percentage never goes backwards and only reaches 100 when everything is read.
function scanTick(){
  const v=scanView;if(!v||!document.getElementById('reading-pct'))return;
  const now=Date.now(),each=v.real.map((real,i)=>real>=1?1:v.begun[i]?Math.max(real,v.queued?0:Math.min(.95,.05+.9*(1-Math.exp(-(now-v.begun[i])/9000)))):0);
  const done=v.real.filter(x=>x>=1).length;
  v.shown=Math.max(v.shown,Math.min(each.reduce((a,b)=>a+b,0)/v.n,done===v.n?1:.99));
  const pct=Math.round(v.shown*100);
  $('#reading-pct').textContent=pct;$('#reading-ring').setAttribute('stroke-dashoffset',(READING_RING*(1-v.shown)).toFixed(1));
  const line=$('#reading-line');line?.setAttribute('aria-valuenow',String(pct));
  each.forEach((value,i)=>{const seg=document.getElementById('reading-seg-'+i);if(!seg)return;seg.firstElementChild.style.width=(value*100).toFixed(1)+'%';seg.classList.toggle('is-done',value>=1);});
  $('#reading-done').textContent=`${done} of ${v.n} done`;
  const active=v.real.findIndex(x=>x>0&&x<1);
  setScanLive(v.stopping?'Stopping after the current step…':v.special&&now-v.special.at<12000?v.special.text:done===v.n?'Matching teams and players…':active>=0?(v.n>1?`Reading screenshot ${active+1} of ${v.n}…`:'Reading the screenshot…'):'Getting ready…');
  // Say how long the screenshot being read has been going, and say so plainly when something makes it slow.
  v.real.forEach((real,i)=>{if(real>0&&real<1&&v.begun[i]){const state=document.querySelector('#scan-item-'+i+' .scan-state');if(state)state.textContent=(v.queued?'In queue… ':'Reading… ')+clock(now-v.begun[i]);}});
  const slow=v.real.some((real,i)=>real>0&&real<1&&v.begun[i]&&now-v.begun[i]>45000);
  const notice=$('#reading-notice'),text=v.fallback?`The server reader could not read this (${v.fallback}). Using the slower in-browser reader, which can take a minute or more per screenshot.`:v.queued&&!done?'Another screenshot was still being read on the server, so this one is waiting for its turn. A read left running clears within two minutes.':slow?'This is taking longer than usual. The server may be busy. You can cancel and try again, or enter results by hand.':'';
  if(notice){if(notice.textContent!==text)notice.textContent=text;notice.hidden=!text;}
  const note=$('#scan-card-note');if(note)note.textContent=`${clock(now-v.started)} so far · usually 5 to 15 seconds per screenshot`;
}
// What one finished screenshot contained, and the running totals across all finished screenshots.
function scanTally(){
  const seen=new Map();
  images.forEach(source=>(source.rows||[]).forEach(row=>{const entry=seen.get(row.placement)||{team:false,kills:[]};if(row.teamId)entry.team=true;row.players.forEach((p,k)=>{if(Number.isInteger(p.kills))entry.kills[k]=true;});seen.set(row.placement,entry);}));
  const all=[...seen.values()];return {placements:seen.size,teams:all.filter(e=>e.team).length,kills:all.reduce((n,e)=>n+e.kills.filter(Boolean).length,0)};
}
function showScanFound(index){
  const rows=images[index]?.rows||[],target=document.getElementById('scan-found-'+index);if(!target)return;
  const names=rows.filter(r=>r.teamId).map(r=>shortTeamName(state.teams.find(t=>t.id===r.teamId)?.name)).filter(Boolean);
  target.innerHTML=`<strong>${rows.length} placement${rows.length===1?'':'s'}</strong> · ${names.length} team${names.length===1?'':'s'} matched${names.length?`<span class="scan-teams">${names.slice(0,6).map(name=>`<em>${esc(name)}</em>`).join('')}${names.length>6?`<em>+${names.length-6}</em>`:''}</span>`:''}`;
  target.hidden=false;
  const tally=scanTally();for(const [id,value] of [['placements',tally.placements],['teams',tally.teams],['kills',tally.kills]]){const el=document.getElementById('stat-'+id);if(el)el.textContent=value;}
}
function markScanItem(index,value){
  const v=scanView;if(v&&index<v.n){v.real[index]=Math.max(v.real[index],value);if(value>0&&!v.begun[index])v.begun[index]=Date.now();}
  const item=document.getElementById('scan-item-'+index);if(!item)return;
  const state=value>=1?'is-done':value>0?'is-active':'is-waiting';if(item.classList.contains(state))return;
  item.className=state;item.querySelector('.scan-state').textContent=value>=1?'Done':value>0?'Reading…':'Waiting';
  if(value>=1){if(v)v.queued=false;showScanFound(index);}
}

function openMatchManager(){
  modal(`<div class="panel-head"><h2>Saved matches</h2><button type="button" onclick="closeModal()">Close</button></div><div id="saved-match-list"></div>`);
  const list=document.querySelector('#saved-match-list');
  state.matches.slice().reverse().forEach(match=>{
    const row=document.createElement('div');row.className='saved-match-row';
    const info=document.createElement('div'),name=document.createElement('strong'),meta=document.createElement('p');
    name.textContent=match.name;meta.textContent=match.map;info.append(name,meta);
    const actions=document.createElement('div');actions.className='actions';
    const open=document.createElement('button');open.textContent='View';open.onclick=()=>{selected=match.id;closeModal();page='results';render();};
    const remove=document.createElement('button');remove.className='danger';remove.textContent='Delete';remove.setAttribute('aria-label','Delete '+match.name);
    remove.onclick=async()=>{
      const prior=selected;closeModal();selected=match.id;await deleteMatch();
      if(state.matches.some(m=>m.id===match.id)){selected=prior;render();openMatchManager();}
    };
    actions.append(open,remove);row.append(info,actions);list.append(row);
  });
}

let pendingConfirmation = null;
function confirmAction({title,message,accept='Continue',cancel='Cancel'}){
  if(pendingConfirmation)return Promise.resolve(false);
  return new Promise(resolve=>{
    const previousFocus=document.activeElement;
    const dialog=document.createElement('dialog');dialog.className='action-confirmation';
    dialog.setAttribute('aria-labelledby','confirmation-title');dialog.setAttribute('aria-describedby','confirmation-message');
    dialog.innerHTML=`<div class="confirmation-symbol" aria-hidden="true">!</div><h2 id="confirmation-title"></h2><p id="confirmation-message"></p><div class="confirmation-actions"><button type="button" data-cancel></button><button type="button" class="confirmation-accept" data-accept></button></div>`;
    dialog.querySelector('h2').textContent=title;dialog.querySelector('p').textContent=message;
    const keep=dialog.querySelector('[data-cancel]'),proceed=dialog.querySelector('[data-accept]');keep.textContent=cancel;proceed.textContent=accept;
    let answer=false;
    pendingConfirmation=dialog;
    keep.onclick=()=>dialog.close();proceed.onclick=()=>{answer=true;dialog.close();};
    dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
    dialog.addEventListener('close',()=>{pendingConfirmation=null;dialog.remove();if(previousFocus?.isConnected)previousFocus.focus();resolve(answer);},{once:true});
    document.body.append(dialog);dialog.showModal();keep.focus();
  });
}

async function openHostAccess(){
  try{
    const {key}=await api('host/access',{});
    const hostURL=new URL('/host.html',location.origin);hostURL.hash=new URLSearchParams({key}).toString();
    const broadcastURL=new URL(hostURL);broadcastURL.hash=new URLSearchParams({key,screen:'1'}).toString();
    modal(`<h2>Host access</h2><p>Give the host this read-only link. They can present results and view talking points without changing teams or matches.</p><label>Host link<input id="host-link" readonly></label><div class="actions"><button id="copy-host-link">Copy host link</button><a id="open-host-link" target="_blank" rel="noopener">Open host desk ↗</a></div><p class="caption">For OBS, use the broadcast link as a Browser Source (1920 × 1080). Only standings appear on that screen. If more than 12 teams played, choose the desired page in the broadcast tab.</p><label>Broadcast link<input id="broadcast-link" readonly></label><div class="actions"><button id="copy-broadcast-link">Copy broadcast link</button><a id="open-broadcast-link" target="_blank" rel="noopener">Open broadcast ↗</a></div><p class="caption">Anyone with either link can read saved results. Localhost works on this computer; another device needs this computer's network address. Keep this computer running.</p><div class="actions"><button id="rotate-host-key" class="danger">Reset host links</button><button onclick="closeModal()">Close</button></div>`);
    $('#host-link').value=hostURL;$('#broadcast-link').value=broadcastURL;$('#open-host-link').href=hostURL;$('#open-broadcast-link').href=broadcastURL;
    const copy=async(value,input)=>{try{await navigator.clipboard.writeText(value);toast('Link copied');}catch{$(input).select();toast('Select and copy the link.');}};
    $('#copy-host-link').onclick=()=>copy(hostURL.href,'#host-link');$('#copy-broadcast-link').onclick=()=>copy(broadcastURL.href,'#broadcast-link');
    $('#rotate-host-key').onclick=async()=>{if(!await confirmAction({title:'Reset host links?',message:'Existing host and broadcast links will stop working. Share the new links with your host.',accept:'Reset links',cancel:'Keep links'}))return;try{await api('host/access',{rotate:true});await openHostAccess();}catch(e){toast(e.message,'error');}};
  }catch(e){toast('Could not open host access: '+e.message,'error');}
}
