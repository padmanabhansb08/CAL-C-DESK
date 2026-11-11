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
function lastPage(){try{const saved=localStorage.getItem('ffk-last-page-v1');return ['war','roster','results','wheel'].includes(saved)?saved:'war';}catch{return 'war';}}
let serverError=null,state={teams:[],matches:[]}, page=lastPage(), selected=null, tab='teams', draft=null, images=[], busy=false, rosterQuery='';

// Heavy tools load on first use, in order: the screenshot reader on the results check page, the export
// tools when Export is chosen, and the in-browser reader only when the server cannot read screenshots.
const MODULES={reader:['digit-templates.js?v=2','layout.js?v=1','ocr.js?v=16','ocr-learning.js?v=1','ocr-batch.js?v=1','panel-editor.js?v=2'],export:['scoreboard.js?v=5','killgraph.js?v=1','scoreboard-pdf.js?v=4','templates.js?v=2','export-ui.js?v=5'],tesseract:['vendor/tesseract.min.js']};
const loadedModules={},loadedScripts=new Set();
// A failed group can be retried: scripts that already ran are skipped, so only the missing ones are requested again.
function loadModules(name){
  return loadedModules[name]||=MODULES[name].reduce((ready,src)=>ready.then(()=>loadedScripts.has(src)?undefined:new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=()=>{loadedScripts.add(src);resolve();};script.onerror=()=>{script.remove();delete loadedModules[name];reject(Error('Could not load '+src.split('?')[0]+'. Check the connection and try again.'));};document.head.append(script);})),Promise.resolve()).then(()=>{if(name==='reader')readerReady=true;});
}
let readerReady=false;
// The upload page waits for every reader script. If one fails, say which and offer a retry that reloads only that script.
function loadReaderPage(){
  loadModules('reader').then(()=>{if(page==='upload')render();}).catch(e=>{
    const box=document.querySelector('.content .empty');if(!box)return;
    box.innerHTML=`<p role="alert"></p><div class="actions"><button type="button" class="primary" id="reader-retry">Retry screenshot tools</button></div>`;
    box.querySelector('p').textContent=e.message;
    box.querySelector('#reader-retry').onclick=()=>{box.innerHTML='<p>Loading the screenshot tools…</p>';loadReaderPage();};
  });
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
// Read screenshots with the server's OCR engine and roster reasoning. The server has `workers` reader
// processes, so that many screenshots of the match are read at the same time.
async function scanOnServer(sources,files,candidates,updateProgress,signal,workers=1){
  const roster=serverRoster(candidates),rows=new Array(sources.length);
  let next=0,failure=null;
  async function readOne(i){
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    updateProgress(i,.05);
    const source=sources[i],sent=await fileToDataUrl(files[i],source.image),image=sent.dataUrl,regions=scaleBounds(source.bounds,sent.width);
    // If the readers are all busy (someone else's screenshots), wait and retry.
    let scan;
    for(let attempt=0;;attempt++){
      try{scan=await api('ocr/scan',{image,roster,regions},{signal});break;}
      catch(e){if(e.name==='AbortError'||!(e.busy||e.unreachable)||attempt>=5)throw e;
        $('#ocr-status').textContent=e.unreachable?`Cannot reach the desk server. Trying again (${attempt+1} of 5)…`:`Another screenshot is being read. Waiting your turn (${attempt+1} of 5)…`;await new Promise(r=>setTimeout(r,e.unreachable?3000:4000));}
    }
    const result=WarOCR.fromServerScan(scan);
    if(!result.length)throw Error(scan.warnings?.[0]||'No result panels were found in this screenshot.');
    source.layout=result.layout;source.rows=structuredClone(result);showSources();updateProgress(i,1);rows[i]=result;
  }
  async function lane(){
    while(!failure&&next<sources.length){const i=next++;try{await readOne(i);}catch(e){failure=failure||e;}}
  }
  await Promise.all(Array.from({length:Math.max(1,Math.min(workers,sources.length))},lane));
  if(failure)throw failure;
  return rows;
}
async function api(path,data,options={}){
  let r;
  try{r=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:options.signal});}
  catch(error){if(error.name==='AbortError')throw error;const e=Error('Cannot reach the desk server. Check that it is still running (start.bat) and try again.');e.unreachable=true;throw e;}
  // A proxy in front of a stopped server answers 502/503 instead of failing the connection.
  if(r.status===502||r.status===503){const e=Error('Cannot reach the desk server. Check that it is still running (start.bat) and try again.');e.status=r.status;e.unreachable=true;throw e;}
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
  if(document.querySelector('#session-dialog')||document.querySelector('main.login'))return;
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
function toast(message,type='success',actions=[]){
  const node=$('#toast');if(!node)return;clearTimeout(toastTimer);const error=type==='error';
  node.className=error?'toast-error':type==='warning'?'toast-warning':'toast-success';node.setAttribute('role',error?'alert':'status');node.replaceChildren();
  const text=document.createElement('span');text.textContent=message;node.append(text);
  // Optional buttons ("Review", "Undo"): a toast with actions stays up longer so there is time to use them.
  actions.forEach(a=>{const b=document.createElement('button');b.type='button';b.className='toast-action';b.textContent=a.label;b.onclick=()=>{node.style.display='none';a.run();};node.append(b);});
  const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Dismiss notification');close.onclick=()=>node.style.display='none';node.append(close);node.style.display='flex';
  if(!error)toastTimer=setTimeout(()=>node.style.display='none',actions.length?15000:type==='warning'?8000:6000);
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

async function init(){try{const session=await api('session');if(!session.authenticated)return auth(session.setup);storageTemporary=session.persistentStorage===false;databaseId=session.databaseId||null;state=await api('state');render();offerLocalCopy();}catch(e){$('#app').innerHTML='<div class="auth"><h1>Unable to connect</h1><p>'+esc(e.message)+'</p><button onclick="location.reload()">Retry</button></div>';}}

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
const NAV=[['war','Tournament','emoji_events'],['roster','Teams','groups'],['results','Standings','leaderboard'],['wheel','Map wheel','casino']];
const SOCIAL_ICON={instagram:'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M17.5 6.5h.01',youtube:'M9 8l7 4-7 4zM3 5h18v14H3z'};
const socialLinks=()=>`<div class="channel-socials">${[['instagram','https://www.instagram.com/ffk_prasanth/','Instagram'],['youtube','https://www.youtube.com/@FFK_Prasanth','YouTube']].map(([k,href,label])=>`<a href="${href}" target="_blank" rel="noopener noreferrer" aria-label="FFK Prasanth on ${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${SOCIAL_ICON[k]}"/></svg></a>`).join('')}</div>`;
let renderedPage=null;
function render(){
  const title=page==='upload'?'Add results':(NAV.find(([id])=>id===page)||[0,'Workspace'])[1],signout=`<button type="button" class="signout" onclick="logout()">${uiIcon('logout',{size:'sm'})}<span>Sign out</span></button>`;
  $('#app').innerHTML=`<div class="shell channel-shell comfort-shell" data-page="${page}"><aside class="sidebar"><div class="brand channel-brand"><img class="channel-profile" src="assets/channel-avatar.jpg" alt="" width="44" height="44"><span class="channel-wordmark">FFK<br>PRASANTH<small>WAR DESK</small></span></div>
    <nav class="nav" aria-label="Main">${NAV.map(([id,label,icon])=>`<button type="button" class="${page===id?'active':''}" onclick="${id==='upload'?'navAddResults()':id==='results'?`selected='__overall__';go('results')`:`go('${id}')`}"${page===id?' aria-current="page"':''}><span class="nav-icon">${uiIcon(icon,{size:'md'})}</span><span class="comfort-nav-label">${label}</span></button>`).join('')}</nav>
    <p class="sidebar-group">Tools</p><button type="button" class="host-access-button" onclick="openHostAccess()">${uiIcon('manage_accounts',{size:'md'})}<span>Host desk</span></button>
    <button type="button" class="host-access-button" onclick="openBackup()">${uiIcon('download',{size:'md'})}<span>Backup</span></button>
    <div class="sidebar-footer">${socialLinks()}${signout}</div></aside>
    <main class="main"><header class="topbar"><span class="comfort-top-title"><span>FFK WAR DESK</span><strong>${title}</strong></span><div class="topbar-right"><button type="button" class="sync-button" onclick="refreshWorkspace(true)" aria-label="Refresh saved data" title="Refresh saved data"><span id="sync-status">Up to date</span> ↻</button><details class="mobile-account"><summary aria-label="Channel and account menu">•••</summary><div class="mobile-account-panel"><button type="button" class="mobile-host-btn" onclick="this.closest('details').open=false;openHostAccess()">${uiIcon('manage_accounts',{size:'sm'})}<span>Host desk</span></button><button type="button" class="mobile-host-btn" onclick="this.closest('details').open=false;openBackup()">${uiIcon('download',{size:'sm'})}<span>Backup</span></button>${socialLinks()}${signout}</div></details></div></header>
    <div class="content">${backupWarning()}${page==='war'?renderWar():page==='roster'?roster():page==='upload'?(readerReady?intake():'<div class="panel empty" role="status"><p>Loading the screenshot tools…</p></div>'):page==='wheel'?wheelPage():results()}</div></main></div>`;
  if(page==='upload'&&!readerReady){loadReaderPage();return;}
  if(page==='wheel'){bindWheel();if(renderedPage!==page){window.scrollTo({top:0,behavior:'instant'});const h=document.querySelector('.content h1');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}renderedPage=page;return;}
  bind();
  // A new page starts at the top with focus on its heading, so keyboard and screen-reader users land there.
  if(renderedPage!==page){window.scrollTo({top:0,behavior:'instant'});const heading=document.querySelector('.content h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}
  renderedPage=page;window.pageMounted?.(page);scheduleLocalCopy();
}
// "Add results" goes straight to the next tournament match when one is due.
function navAddResults(){
  if(!draft&&window.WarGuide&&window.WarTournament){const set=WarGuide.next(state),p=WarGuide.progress(state,set);if(['A','B','C'].includes(set)&&WarTournament.availableTeams(state,set).length>=12&&!p.locked&&p.played<p.target)return warNew(set);}
  go('upload');
}

// Map wheel page. The wheel itself is wheel.html in embed mode (the same stage the OBS broadcast shows); the desk
// holds the controls. A spin is drawn by the server, so this page, the broadcast screen and any other open
// wheel all play the same spin.
const WHEEL_ART={Bermuda:'bermuda-map.jpeg',Purgatory:'purgatory-map.jpg',Kalahari:'kalahari-map.jpg',NexTerra:'nexterra-map.png',Solara:'solara-map.jpg',Alpine:'alpine-map.jpg'},WHEEL_MAPS=Object.keys(WHEEL_ART);
let wheelBroadcastURL=null,wheelSpinning=false;
function wheelSaved(){try{const s=JSON.parse(localStorage.getItem('ffk-wheel-maps')||'null');return Array.isArray(s)?s:null;}catch{return null;}}
function wheelSoundOn(){try{return localStorage.getItem('ffk-wheel-sound')!=='0';}catch{return true;}}
function wheelPage(){
  const saved=wheelSaved();
  return header('Final match','Map wheel',`<button type="button" id="wheel-copy">Copy broadcast link</button><button type="button" id="wheel-open">${uiIcon('open_in_new',{size:'sm'})} <span>Open broadcast screen</span></button>`)
    +`<p class="team-list-intro">Choose the maps, then spin. The server draws the map at random and every broadcast screen plays the same spin live.</p>
    <div class="wheel-layout"><div class="wheel-frame"><iframe id="wheel-frame" src="/wheel.html?v=7#embed=1" title="Final map wheel" allow="autoplay; fullscreen"></iframe>
    <button type="button" class="wheel-fullscreen" id="wheel-fullscreen" aria-label="Show the wheel full screen" title="Full screen">${uiIcon('fullscreen',{size:'md'})}</button>
    <div class="wheel-fs-bar" aria-label="Full screen wheel controls"><button type="button" class="primary wheel-fs-spin" id="wheel-fs-spin">${uiIcon('casino',{size:'md'})} <span>Spin the wheel</span></button><button type="button" class="wheel-fs-exit" id="wheel-fs-exit">Exit full screen</button></div></div>
    <section class="wheel-controls" aria-label="Wheel controls"><fieldset class="wheel-maps" id="wheel-maps"><legend>Maps on the wheel</legend>${WHEEL_MAPS.map(m=>`<label class="wheel-map"><input type="checkbox" value="${m}" ${!saved||saved.includes(m)?'checked':''}><span class="wheel-map-art" style="background-image:url('assets/${WHEEL_ART[m]}')"></span><span class="wheel-map-name">${m}</span></label>`).join('')}</fieldset>
    <div class="wheel-actions"><button type="button" class="primary brand-main-action wheel-spin" id="wheel-spin">${uiIcon('casino',{size:'md'})} <span>Spin the wheel</span></button><label class="wheel-sound"><input type="checkbox" id="wheel-sound" ${wheelSoundOn()?'checked':''}> Sound</label></div>
    <p id="wheel-note" class="caption" role="status"></p></section></div>`;
}
function wheelSelected(){return [...document.querySelectorAll('#wheel-maps input')].filter(b=>b.checked).map(b=>b.value);}
function wheelSync(){const off=wheelSpinning||wheelSelected().length<2;['#wheel-spin','#wheel-fs-spin'].forEach(id=>{const b=$(id);if(b)b.disabled=off;});$('.wheel-frame')?.classList.toggle('is-spinning',wheelSpinning);}
function wheelSend(message){$('#wheel-frame')?.contentWindow?.postMessage(message,location.origin);}
// The wheel tells the desk when a spin starts and ends, so Spin is off while one is playing.
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.data?.type!=='wheel-state')return;wheelSpinning=!!e.data.spinning;wheelSync();});
function bindWheel(){
  wheelSpinning=false;wheelSync();
  const note=$('#wheel-note');
  $('#wheel-maps').onchange=()=>{const list=wheelSelected();try{localStorage.setItem('ffk-wheel-maps',JSON.stringify(list));}catch{}note.textContent=list.length<2?'Choose at least two maps.':'';wheelSync();wheelSend({type:'wheel-maps',maps:list});};
  $('#wheel-sound').onchange=e=>{try{localStorage.setItem('ffk-wheel-sound',e.target.checked?'1':'0');}catch{}wheelSend({type:'wheel-sound',on:e.target.checked});};
  $('#wheel-spin').onclick=$('#wheel-fs-spin').onclick=async()=>{const list=wheelSelected();if(list.length<2)return;
    // A spin is live on every broadcast screen and cannot be taken back, so it is confirmed first.
    const current=await api('wheel').then(d=>d.spin?.result).catch(()=>null);
    if(!await confirmAction({title:'Spin the wheel live?',message:`The draw is final and plays on every broadcast screen now. Maps on the wheel: ${list.join(', ')}.${current?` This replaces the current result, ${current}.`:''}`,accept:'Spin now',cancel:'Not yet'}))return;
    wheelSpinning=true;wheelSync();note.textContent='';
    try{wheelSend({type:'wheel-spun',data:await api('wheel/spin',{maps:list})});}
    catch(e){note.textContent='Could not spin: '+e.message;wheelSpinning=false;wheelSync();}};
  // Full screen shows the wheel and its own Spin button (the page controls are hidden behind it).
  $('#wheel-fullscreen').onclick=()=>{const f=$('.wheel-frame');(f.requestFullscreen||f.webkitRequestFullscreen)?.call(f);};
  $('#wheel-fs-exit').onclick=()=>(document.exitFullscreen||document.webkitExitFullscreen)?.call(document);
  // The broadcast link carries the host key, like the host desk's broadcast link.
  const link=async()=>{if(!wheelBroadcastURL){const {key}=await api('host/access',{});const url=new URL('/wheel.html',location.origin);url.hash=new URLSearchParams({key,screen:'1'}).toString();wheelBroadcastURL=url.href;}return wheelBroadcastURL;};
  $('#wheel-open').onclick=async()=>{const w=window.open('about:blank','_blank');if(w)w.opener=null;try{const url=await link();if(w)w.location=url;else location.href=url;}catch(e){w?.close();toast(e.message,'error');}};
  $('#wheel-copy').onclick=async()=>{try{const url=await link();try{await navigator.clipboard.writeText(url);toast('Broadcast link copied. Add it to OBS as a 1920 × 1080 Browser Source.');}catch{note.textContent=url;}}catch(e){toast(e.message,'error');}};
}

function header(kicker,title,action=''){return `<div class="eyebrow">${kicker}</div><div class="heading"><h1>${title}</h1>${action}</div>`;}

function roster(){
  const groups=state.war?.groups||{},setOf=id=>['A','B'].find(set=>(groups[set]||[]).includes(id));
  const name=text=>{const m=/^(FFK\s+)(.*)$/i.exec(text||'');return m?`<span class="ffk-prefix">${esc(m[1].trim())}</span> ${esc(m[2])}`:esc(text);};
  return header('Before the first drop','Your teams',`<span id="roster-count" class="caption roster-result-count" role="status">${state.teams.length} of ${state.teams.length} teams</span><button type="button" onclick="slotListForm()">Load slot list</button><button type="button" class="primary brand-main-action" onclick="teamForm()">${uiIcon('add',{size:'sm'})} <span>Register team</span></button>`)+`<div class="search-bar topbar-search"><label for="roster-search">Find a team or player<input id="roster-search" type="search" placeholder="Search teams or players" value="${esc(rosterQuery)}"></label></div><p class="team-list-intro">Keep team and player names up to date. Use the exact in-game names to make result checking easier.</p><p id="roster-empty" hidden>No teams match your search.</p><div class="team-grid team-list">${state.teams.map((t,i)=>{const set=setOf(t.id);return `<article class="team-card team-row"><span class="team-badge" aria-hidden="true">${esc((t.name||'').replace(/^FFK\s+/i,'').trim().charAt(0).toUpperCase()||'?')}</span><div class="team-row-id"><h2>${name(t.name)}</h2><span class="team-row-meta">${t.rosterList?`List ${t.rosterList} · slot ${t.slot}`:t.slot?`Slot ${t.slot}`:`Team ${i+1}`}${set?` · <span class="team-set">Set ${set}</span>`:''}</span></div><ol class="team-row-players">${t.players.map((p,j)=>`<li${j>3?' class="team-row-sub" title="Substitute"':''}>${name(p.name)}</li>`).join('')}</ol><div class="actions"><button onclick="teamForm('${t.id}')" aria-label="Edit roster for ${esc(t.name)}">Edit</button><button class="danger" onclick="deleteTeam('${t.id}')" aria-label="Remove ${esc(t.name)}">Remove</button></div></article>`;}).join('')||'<div class="empty"><h3>No teams registered yet</h3><p>Add your first team.</p></div>'}</div>`;}

// The week's slot list: one slot per line, four players each, IGL first. Teams are matched by their IGL, so
// changed players keep the team's history and results stay attached.
function slotListForm(presetSet=''){
  // Each line is "N. Team name" or "N. Player1, Player2, Player3, Player4" (optionally "N. Team: P1, P2, P3, P4").
  // Players may be split by commas, "|", tabs or 2+ spaces; lines without a number count in order.
  const readList=text=>{const names={},players={};let order=0;
    String(text||'').split(/\r?\n/).forEach(raw=>{const line=raw.trim().replace(/\*/g,'');if(!line)return;
      const m=/^\W*?(\d{1,2})\s*[.):\-]\s*(.+?)\s*$/.exec(line);const n=m?+m[1]:++order,body=(m?m[2]:line).trim();if(m)order=n;
      let parts=body.split(/\s*(?:,|\||\t|\s{2,})\s*/).filter(Boolean);
      if(parts.length>=4){let team='';const colon=/^([^:]+):\s*(.+)$/.exec(body);
        if(colon&&colon[2].split(/\s*(?:,|\||\t|\s{2,})\s*/).filter(Boolean).length>=4){team=colon[1].trim();parts=colon[2].split(/\s*(?:,|\||\t|\s{2,})\s*/).filter(Boolean);}
        else if(parts.length>4)team=parts.shift();
        if(!(n in players))players[n]=parts.slice(0,4).map(p=>p.replace(/^IGL\s*[-:]\s*/i,''));if(team&&!(n in names))names[n]=team;}
      else if(m&&body&&!(n in names))names[n]=body.replace(/\W+$/,'');});
    return {names,players};};
  const dataUrl=file=>new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>no(r.error);r.readAsDataURL(file);});
  const merge=reads=>{const by={};reads.forEach(r=>r.slots.forEach(s=>{const cur=by[s.slot]||(by[s.slot]=['','','','']),n=a=>a.filter(Boolean).length;
    const [fuller,other]=n(s.players)>n(cur)?[s.players,cur]:[cur,s.players];by[s.slot]=fuller.map((v,i)=>v||other[i]);}));return by;};
  let slots=null;
  modal(`<h2>${presetSet?'Set '+presetSet+' teams':'Load slots from the lobby'}</h2><p class="comfort-form-intro">Paste the slot list and add the room lobby screenshots. Each lobby slot gives that team its four players, so match screenshots are matched to the right team without checking names. A list line can be a team name ("1. TEAM ONE") or the four players ("1. P1, P2, P3, P4").</p>
    <form id="slot-form"><label>These teams play in<select name="set"><option value="">No set yet</option><option value="A" ${presetSet==='A'?'selected':''}>Set A</option><option value="B" ${presetSet==='B'?'selected':''}>Set B</option></select></label>
    <label>Slot list<textarea name="text" rows="7" placeholder="1. TEAM ONE&#10;2. P1, P2, P3, P4"></textarea></label>
    <label>Lobby screenshots (optional when the list has players)<input type="file" name="files" accept="image/*" multiple></label>
    <div id="slot-preview"></div>
    <div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary" type="submit" id="slot-submit">Read lobby</button></div>
    <p id="slot-status" role="status"></p><p id="slot-error" class="error" role="alert"></p></form>`);
  const form=$('#slot-form'),status=t=>{$('#slot-status').textContent=t;},fail=t=>{$('#slot-error').textContent=t;};
  const saveSlots=async entries=>{
    const submit=$('#slot-submit');submit.disabled=true;
    const set=form.elements.set.value,body=set?{entries,set}:{entries};
    try{state=await api('slots',body);closeModal();render();
      const placed=set&&(state.war?.groups?.[set]||[]).length===entries.length;
      toast(`${entries.length} teams loaded by slot`+(set?(placed?` for Set ${set}`:`; Set ${set} already has results or shares a team, so its teams were not changed`):''),set&&!placed?'warning':undefined);}
    catch(err){fail(err.message);submit.disabled=false;}
  };
  form.onsubmit=async e=>{
    e.preventDefault();fail('');const submit=$('#slot-submit');
    if(slots){
      return saveSlots(slots.map(n=>({slot:n,name:form.querySelector(`[data-slot="${n}"][data-f="name"]`).value.trim(),
        players:[0,1,2,3].map(j=>form.querySelector(`[data-slot="${n}"][data-f="p${j}"]`).value.trim())})));
    }
    const files=[...form.elements.files.files],list=readList(form.elements.text.value);
    if(!files.length&&!Object.keys(list.players).length)return fail('Add the lobby screenshots, or put four players on each line of the slot list.');
    submit.disabled=true;const reads=[];
    try{
      for(let i=0;i<files.length;i++){
        status(`Reading screenshot ${i+1} of ${files.length}…`);const image=await dataUrl(files[i]);
        for(let attempt=0;;attempt++){
          try{reads.push(await api('lobby/scan',{image}));break;}
          catch(err){if(!err.busy||attempt>=5)throw err;await new Promise(r=>setTimeout(r,4000));}
        }
      }
      const names=list.names,by=merge(reads);
      // Typed players in the slot list are exact spellings; the lobby read can garble a stylised name ("SOULITITANV").
      // A lobby name close to a typed one takes the typed spelling (keeping the lobby's order); typed names left over
      // fill the slot's empty places.
      const key=t=>String(t||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
      const lev=(a,b)=>{let row=[...Array(b.length+1).keys()];for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next.push(Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]!==b[j-1])));row=next;}return row[b.length];};
      const like=(a,b)=>{a=key(a);b=key(b);return a&&b?1-lev(a,b)/Math.max(a.length,b.length):0;};
      Object.entries(list.players).forEach(([n,ps])=>{const cur=(by[n]||['','','','']).slice(),free=ps.filter(Boolean);
        cur.forEach((v,i)=>{if(!v)return;let best=-1,score=.6;free.forEach((t,j)=>{const k=like(v,t);if(k>=score){score=k;best=j;}});if(best>=0)cur[i]=free.splice(best,1)[0];});
        by[n]=cur.map(v=>v||free.shift()||'');});
      slots=Object.keys(by).map(Number).sort((a,b)=>a-b);
      if(!slots.length){slots=null;throw new Error('No slots were found. Use screenshots of the room lobby with the slot numbers showing.');}
      const warn=[...new Set(reads.flatMap(r=>r.warnings||[]))];
      // Sure enough to save without a check: no reader warnings, slots 1..N with no gaps (12 for a set), four names in each.
      const complete=!warn.length&&slots.every((n,i)=>n===i+1&&by[n].every(p=>p.trim()))&&(!form.elements.set.value||slots.length===12);
      if(complete){status(`${slots.length} slots read · saving…`);return saveSlots(slots.map(n=>({slot:n,name:names[n]||'',players:by[n].map(p=>p.trim())})));}
      $('#slot-preview').innerHTML=`<p class="comfort-help">Some slots need a look before saving: fill in the blanks${form.elements.set.value?' (a set needs slots 1 to 12)':''} or add another lobby screenshot.</p>`+
        slots.map(n=>`<fieldset class="slot-card" style="margin:.5rem 0;padding:.5rem"><legend>Slot ${n}</legend><label>Team name<input data-slot="${n}" data-f="name" value="${esc(names[n]||'')}" placeholder="Slot ${n}"></label>`+
          by[n].map((p,j)=>`<label>Player ${j+1}<input data-slot="${n}" data-f="p${j}" value="${esc(p)}"></label>`).join('')+`</fieldset>`).join('');
      submit.textContent=`Save ${slots.length} teams`;submit.disabled=false;status(`${slots.length} slots read.`);
    }catch(err){fail(err.message);submit.disabled=false;status('');}
  };
}

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
    const clashes=inputs.map(x=>x.value.trim()).filter(Boolean).map(n=>[n,state.teams.find(x=>x.id!==id&&(x.players||[]).some(p=>p.name.toLowerCase()===n.toLowerCase()))]).filter(([,other])=>other);
    if(clashes.length&&!await confirmAction({title:'Player already in another team?',message:clashes.map(([n,other])=>`${n} is also in ${other.name}.`).join(' ')+' Screenshot reading can match the wrong team when two teams share a player name.',accept:'Save anyway',cancel:'Go back'}))return;
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


async function finalize(auto=false){
  if(busy||!draft)return;
  if(draft.rows.some(r=>!r.confirmed))return toast('Confirm every placement, or mark it “No result”, before saving.','error');
  // Placements marked "No result" are not saved: teams without a result are missing from this match, never scored as zero.
  const results=draft.rows.filter(r=>!r.noResult);
  if(!results.length)return toast('Record at least one team result before saving.','error');
  if(draft.stage&&results.length!==12)return toast('Tournament set matches need all 12 results before they can be saved.','error');
  if(new Set(results.map(r=>r.teamId)).size!==results.length)return toast('Every placement needs a different team.','error');
  draft.name=$('#match-name').value.trim();draft.map=$('#match-map').value;if(!draft.name)return toast('Enter a match name.','error');
  const warBefore=state.war===undefined?undefined:structuredClone(state.war);
  if(draft.stage){try{WarTournament.registerResult(state,draft);}catch(e){return toast(e.message,'error');}}
  const rosterBefore=structuredClone(state.teams);
  const learnedNames=WarOCR.rememberAliases(state.teams,draft.rows);
  const m=structuredClone(draft);m.rows=m.rows.filter(r=>!r.noResult);if(m.rows.length<12&&state.teams.length<=12)m.pool=state.teams.map(t=>t.id);m.rows.forEach(r=>{r.teamName=state.teams.find(t=>t.id===r.teamId).name;delete r.flags;delete r._read;delete r.hostTouched;r.players.forEach(p=>{delete p.ocrRegion;delete p.killEdited;delete p.evidenceCrop;delete p.identityEdited;});});m.created=new Date().toISOString();
  busy=true;state.matches.push(m);
  try{await save();}catch(e){state.matches.pop();state.teams=rosterBefore;if(warBefore===undefined)delete state.war;else state.war=warBefore;busy=false;toast(e.message,'error');return;}
  let message=(auto?'Saved automatically: all 12 teams read with confidence':'Verified match saved')+(learnedNames?' · '+learnedNames+' player name corrections remembered':'');
  try{
    const records=WarOCRLearning.capture({...draft,created:m.created},images,(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;});
    const count=await WarOCRLearning.store(records);if(count)message+=` · ${count} reviewed OCR examples saved in this browser`;
  }catch(e){console.warn(e);message+=' · OCR examples could not be saved in this browser';}
  // A tournament match goes back to the Tournament page, where the next step is waiting.
  draft=null;clearImages();selected=m.id;page=m.stage?'war':'results';busy=false;render();
  // Nobody checked an automatic save, so its result is one click away, and so is taking it back.
  toast(message,'success',auto?[{label:'Review',run:()=>{selected=m.id;go('results');}},{label:'Undo',run:()=>{selected=m.id;deleteMatch();}}]:[]);
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
    markScanItem(index,progress[index]);const bar=$('#scan-meter-bar');if(bar)bar.style.width=Math.max(4,overall*100)+'%';
  };
  try{
    await WarOCRLearning.load().catch(e=>console.warn('Reviewed OCR examples unavailable:',e));
    const localOCR=await api('ocr/status').catch(e=>{if(e.unreachable||e.expired)throw e;return {available:false};});
    images=files.map((file,i)=>{const url=URL.createObjectURL(file),image=new Image();image.src=url;return {url,image,bounds:previousBounds[i],fileKey:file.name+':'+file.size};});
    await Promise.all(images.map(source=>source.image.decode()));showSources();showScanCard(files);
    const candidates=typeof WarTournament==='undefined'?state.teams:WarTournament.scanTeams(state,incoming.stage);
    let rowsByScreenshot=null;serverError=null;
    if(localOCR.scan){
      try{rowsByScreenshot=await scanOnServer(images,files,candidates,updateProgress,signal,localOCR.workers||1);}
      // A stopped server or an ended sign-in is not a reader failure: stop and say so instead of reading badly.
      catch(e){if(e.name==='AbortError'||e.unreachable||e.expired)throw e;serverError=e;console.warn('Server screenshot reader failed; using the in-browser reader:',e);$('#ocr-status').textContent='Switching to the in-browser reader…';progress.fill(0);}
    }
    // Say so plainly: the browser reader is several times slower and far less accurate than the server's.
    if(!rowsByScreenshot)toast(localOCR.scan?'The server reader failed, so the slower in-browser reader is used. Check the results carefully.':'The server screenshot reader is not running, so the slower, less accurate in-browser reader is used. Start the desk with start.bat to fix this.','warning');
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
    // A tournament match saves itself only when every team read with confidence AND every screenshot is full size:
    // the reader is verified error-free on full-size game screenshots (1600 x 720 from WhatsApp), while half-size
    // or blurred copies can be misread with high confidence, so those always get the organizer's check.
    const fullSize=images.every(s=>{const w=s.image.naturalWidth||0,h=s.image.naturalHeight||0;return Math.max(w,h)>=1400&&Math.min(w,h)>=640;});
    const sure=draft.stage&&draft.rows.length===12&&draft.rows.every(r=>r.confirmed&&r.teamId)&&new Set(draft.rows.map(r=>r.teamId)).size===12&&$('#match-name').value.trim();
    if(sure&&fullSize){
      setMatchLoading(false);busy=false;$('#ocr-status').textContent='All 12 teams read with confidence · saving…';redrawReview();await finalize(true);return;
    }
    if(sure&&!fullSize){$('#ocr-status').textContent='Every team read, but the screenshots are smaller than full size, so check them before saving.';redrawReview();return;}
    $('#ocr-status').textContent=`Results ready · ${sum.read} of ${sum.total} kill counts read · ${sum.confirmed} teams confirmed automatically, ${sum.ready+sum.look} to check`;redrawReview();
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
    // Say why the server reader failed: "unable to read" alone hid a server error behind the browser fallback.
    const reason=serverError?.message?' Server reader: '+serverError.message:'';
    $('#ocr-status').textContent='Unable to read these screenshots.'+reason+kept;
    if(draft)redrawReview();else $('#review').innerHTML='';
    toast('Unable to read these screenshots. Try clearer screenshots or enter results by hand.'+reason+kept,'error');
  }finally{
    // After an automatic save the page has moved on to the Tournament, so there are no reader controls left to restore.
    busy=false;if($('#scan')){setMatchLoading(false);$('#scan').disabled=false;$('#manual').disabled=false;$('#screenshots').disabled=false;showSources();window.refreshUploadStatus?.();}
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
      <div class="correct-row"><label for="correct-place">Finish</label><select id="correct-place" name="placement" ${locked?'disabled':''}>${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${r.placement===i+1?'selected':''}>#${i+1}${i+1===r.placement?'':m.rows.some(x=>x.placement===i+1)?' · swaps with '+esc(m.rows.find(x=>x.placement===i+1).teamName):' · free'}</option>`).join('')}</select></div>
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


// A result that arrives after the match was saved (a team's own screenshot). It fills only that team's gap;
// a team that already has a result is never offered, so the same evidence cannot be added twice.
function lateResult(teamId){
  const m=state.matches.find(x=>x.id===selected),team=state.teams.find(t=>t.id===teamId);
  if(!m||!team||m.rows.some(r=>r.teamId===teamId)||(m.stage&&state.war?.qualified?.[m.stage]))return;
  const free=Array.from({length:12},(_,i)=>i+1).filter(n=>!m.rows.some(r=>r.placement===n));
  const roster=team.players||[];
  modal(`<h2>${esc(team.name)}</h2><p class="caption">${esc(m.name)} · add a result that arrived after the match was saved</p>
    <form id="late" class="details-section">
      <div class="correct-row"><label for="late-place">Finished</label><select id="late-place" name="placement">${free.map(n=>`<option value="${n}">#${n}</option>`).join('')}</select></div>
      ${[0,1,2,3].map(j=>`<div class="correct-row"><select name="p${j}" aria-label="Player ${j+1}">${roster.map((p,k)=>`<option value="${esc(p.id)}" ${k===j?'selected':''}>${esc(p.name)}</option>`).join('')}<option value="__sub">Substitute (not on roster)</option></select><input name="n${j}" maxlength="90" placeholder="Substitute name" aria-label="Substitute ${j+1} name"><input name="k${j}" type="number" inputmode="numeric" min="0" max="99" step="1" required placeholder="kills" aria-label="Player ${j+1} kills"></div>`).join('')}
      <label>Evidence / source<input name="reason" required maxlength="200" placeholder="e.g. Screenshot sent by the team captain"></label>
      <div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary" type="submit">Add result</button></div>
      <p id="late-error" class="error" role="alert"></p></form>`);
  $('#late').onsubmit=async e=>{
    e.preventDefault();if(detailsWriting)return;const f=e.target,fail=t=>{$('#late-error').textContent=t;};
    const placement=Number(f.elements.placement.value),reason=f.elements.reason.value.trim(),players=[];
    for(let j=0;j<4;j++){
      const kills=f.elements['k'+j].value===''?NaN:Number(f.elements['k'+j].value),pick=f.elements['p'+j].value;
      if(!Number.isInteger(kills)||kills<0||kills>99)return fail('Kills must be whole numbers from 0 to 99.');
      if(pick==='__sub'){const name=f.elements['n'+j].value.trim();if(!name)return fail('Name each substitute.');players.push({playerId:`sub:${teamId}:${m.id}:${j}`,name,kills,isSubstitute:true});}
      else{const p=roster.find(x=>x.id===pick);if(!p)return fail('Pick a player for every slot.');players.push({playerId:p.id,name:p.name,kills});}
    }
    if(new Set(players.map(p=>p.playerId)).size!==4)return fail('Each player can only be picked once.');
    if(!free.includes(placement)||m.rows.some(r=>r.placement===placement))return fail('That placement already has a team.');
    if(!reason)return fail('Add where this result came from.');
    detailsWriting=true;const before=structuredClone(m),buttons=[...f.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
    try{
      m.rows.push({placement,teamId,teamName:team.name,players,warnings:[],confirmed:true,adjustments:[]});m.rows.sort((a,b)=>a.placement-b.placement);
      const kills=players.reduce((n,p)=>n+p.kills,0);
      m.corrections=[...(m.corrections||[]),{id:uid(),teamId,reason,changes:[`Late result added: finished #${placement}, ${kills} kills`],at:new Date().toISOString()}];
      await save();closeModal();render();toast('Result added. Standings recalculated.');
    }catch(err){restoreInPlace(m,before);fail(err.message);}
    finally{detailsWriting=false;buttons.forEach(b=>{if(b.isConnected)b.disabled=false;});}
  };
}


async function logout(){if(busy)return toast('Wait for reading to finish.','warning');if(draft&&!await confirmAction({title:'Sign out?',message:'Your unsaved match will be discarded.',accept:'Sign out',cancel:'Keep working'}))return;try{await api('logout',{});draft=null;clearImages();await init();}catch(e){toast(e.message,'error');}}




let scanControl=null,scanTimer=null;
function setMatchLoading(active){
  document.querySelector('#review')?.setAttribute('aria-busy',String(active));
  if(!active){clearInterval(scanTimer);scanTimer=null;scanControl=null;document.querySelector('#scan-card')?.remove();}
}
// Reading progress stays on the page: one line per screenshot, elapsed time, and a way out.
function showScanCard(files){
  const host=$('#review');if(!host)return;const started=Date.now();
  host.innerHTML=`<section class="scan-card" id="scan-card"><div class="scan-card-head"><div><h2>Reading ${files.length} screenshot${files.length===1?'':'s'}</h2><p id="scan-card-note" aria-live="polite">Usually 5 to 15 seconds per screenshot.</p></div><button type="button" id="scan-cancel">Cancel</button></div><div class="scan-meter" aria-hidden="true"><span id="scan-meter-bar"></span></div><ol class="scan-list">${files.map((f,i)=>`<li id="scan-item-${i}" class="is-waiting">${images[i]?.url?`<img src="${images[i].url}" alt="">`:''}<span class="scan-name">${esc(f.name)}</span><span class="scan-state">Waiting</span></li>`).join('')}</ol></section>`;
  $('#scan-cancel').onclick=()=>{scanControl?.abort();$('#scan-cancel').disabled=true;$('#scan-card-note').textContent='Stopping after the current step…';};
  clearInterval(scanTimer);scanTimer=setInterval(()=>{const note=$('#scan-card-note'),seconds=Math.round((Date.now()-started)/1000);if(note&&!$('#scan-cancel')?.disabled)note.textContent=`${seconds} s so far · usually 5 to 15 seconds per screenshot`;},1000);
  host.querySelector('#scan-card').scrollIntoView({block:'nearest'});
}
function markScanItem(index,value){
  const item=document.getElementById('scan-item-'+index);if(!item)return;
  const state=value>=1?'is-done':value>0?'is-active':'is-waiting';if(item.classList.contains(state))return;
  item.className=state;item.querySelector('.scan-state').textContent=value>=1?'Done':value>0?'Reading…':'Waiting';
}

function openMatchManager(){
  modal(`<div class="panel-head"><h2>Saved matches</h2><button type="button" onclick="closeModal()">Close</button></div><label class="saved-match-search">Find a match<input id="saved-match-search" type="search" autocomplete="off" placeholder="Name or map"></label><div id="saved-match-list"></div><p id="saved-match-empty" class="caption" hidden>No saved match fits that search.</p>`);
  const list=document.querySelector('#saved-match-list'),search=document.querySelector('#saved-match-search'),empty=document.querySelector('#saved-match-empty');
  const draw=()=>{
  const needle=search.value.trim().toLowerCase();list.innerHTML='';
  const shown=state.matches.slice().reverse().filter(m=>!needle||`${m.name} ${m.map||''}`.toLowerCase().includes(needle));
  empty.hidden=shown.length>0;
  shown.forEach(match=>{
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
  };
  search.oninput=draw;draw();
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

// Backup: the whole tournament (teams, matches, sets, the drawn final map) as one file kept off the server.
let storageTemporary=false;
function backupWarning(){return storageTemporary?`<div class="storage-warning" role="alert">${uiIcon('download',{size:'md'})}<p><strong>This server's storage is temporary.</strong> A redeploy or restart will erase the tournament. Add a volume mounted at <code>/data</code> in your hosting settings (on Railway: the service → Volumes → New volume, mount path <code>/data</code>), and download a backup after every match until then.</p><button type="button" onclick="openBackup()">Backup</button></div>`:'';}
function openBackup(){
  modal(`<h2>Backup</h2><p>Download the whole tournament as one file: teams, matches, sets, qualifiers and the drawn final map. Keep it on your phone or computer, and download a new one after each match.</p>${storageTemporary?'<p class="caption storage-warning-text">This server\'s storage is temporary, so this file may be the only copy after a redeploy.</p>':''}<div class="actions"><button type="button" class="primary" id="backup-download">${uiIcon('download',{size:'sm'})} <span>Download backup file</span></button></div>
    <h3>Restore</h3><p class="caption">Replaces everything on this desk with a backup file. The server keeps a copy of the current data first.</p><label class="backup-file">Backup file<input type="file" id="backup-file" accept=".json,application/json"></label><div class="actions"><button type="button" onclick="closeModal()">Close</button></div>`);
  $('#backup-download').onclick=async()=>{try{const data=await api('backup');const stamp=new Date().toISOString().slice(0,16).replace(/[-:T]/g,'').replace(/^(\d{8})/,'$1-');
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,1)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`ffk-war-backup-${stamp}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
    toast(`Backup downloaded: ${data.state.teams.length} teams, ${data.state.matches.length} matches.`);}catch(e){toast('Could not download the backup: '+e.message,'error');}};
  $('#backup-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;let data;
    try{data=JSON.parse(await file.text());}catch{e.target.value='';return toast('That file is not a backup file.','error');}
    if(data?.format!=='ffk-war-desk-backup'||!data.state){e.target.value='';return toast('That file is not an FFK War Desk backup.','error');}
    const when=data.savedAt?new Date(data.savedAt*1000).toLocaleString():'an unknown date';
    if(!await confirmAction({title:'Restore this backup?',message:`Everything on this desk will be replaced with the backup from ${when}: ${data.state.teams?.length||0} teams and ${data.state.matches?.length||0} matches.`,accept:'Replace with backup',cancel:'Keep current data'})){e.target.value='';return;}
    try{const r=await api('state/restore',data);state=await api('state');draft=null;closeModal();render();toast(`Backup restored: ${r.teams} teams, ${r.matches} matches.`);}
    catch(err){e.target.value='';toast(err.message,'error');}};
}
async function openHostAccess(){
  try{
    const {key}=await api('host/access',{});
    const hostURL=new URL('/host.html',location.origin);hostURL.hash=new URLSearchParams({key}).toString();
    const broadcastURL=new URL(hostURL);broadcastURL.hash=new URLSearchParams({key,screen:'1'}).toString();
    modal(`<h2>Host access</h2><p>Give the host this read-only link. They can present results and view talking points without changing teams or matches.</p><label>Host link<input id="host-link" readonly></label><div class="actions"><button id="copy-host-link">Copy host link</button><a id="open-host-link" target="_blank" rel="noopener">Open host desk ↗</a></div><p class="caption">For OBS, use the broadcast link as a Browser Source (1920 × 1080). Only standings appear on that screen. If more than 12 teams played, choose the desired page in the broadcast tab.</p><label>Broadcast link<input id="broadcast-link" readonly></label><div class="actions"><button id="copy-broadcast-link">Copy broadcast link</button><a id="open-broadcast-link" target="_blank" rel="noopener">Open broadcast ↗</a></div><p class="caption">Final map wheel for the stream: add this link to OBS as a 1920 × 1080 Browser Source. It spins live when you press SPIN in Map wheel.</p><label>Map wheel broadcast link<input id="wheel-link" readonly></label><div class="actions"><button id="copy-wheel-link">Copy map wheel link</button><a id="open-wheel-link" target="_blank" rel="noopener">Open map wheel screen ↗</a></div><p class="caption">Anyone with either link can read saved results. Localhost works on this computer; another device needs this computer's network address. Keep this computer running.</p><div class="actions"><button id="rotate-host-key" class="danger">Reset host links</button><button onclick="closeModal()">Close</button></div>`);
    $('#host-link').value=hostURL;$('#broadcast-link').value=broadcastURL;$('#open-host-link').href=hostURL;$('#open-broadcast-link').href=broadcastURL;
    const copy=async(value,input)=>{try{await navigator.clipboard.writeText(value);toast('Link copied');}catch{$(input).select();toast('Select and copy the link.');}};
    $('#copy-host-link').onclick=()=>copy(hostURL.href,'#host-link');$('#copy-broadcast-link').onclick=()=>copy(broadcastURL.href,'#broadcast-link');
    const wheelURL=new URL('/wheel.html',location.origin);wheelURL.hash=new URLSearchParams({key,screen:'1'}).toString();
    $('#wheel-link').value=wheelURL;$('#open-wheel-link').href=wheelURL;$('#copy-wheel-link').onclick=()=>copy(wheelURL.href,'#wheel-link');
    $('#rotate-host-key').onclick=async()=>{if(!await confirmAction({title:'Reset host links?',message:'Existing host and broadcast links will stop working. Share the new links with your host.',accept:'Reset links',cancel:'Keep links'}))return;try{await api('host/access',{rotate:true});await openHostAccess();}catch(e){toast(e.message,'error');}};
  }catch(e){toast('Could not open host access: '+e.message,'error');}
}

// A copy of the tournament kept in this browser. Without a volume, a redeploy gives the server a fresh, empty
// database; the copy lets the organizer put everything back in one click. Each server database has its own ID:
// a copy from a different database that holds more than the server now has means the server lost its data (an
// organizer's own "Reset the war" keeps the ID, so it is never offered back). The copy is only refreshed once
// that check is done, so the empty new server can never overwrite it first.
const LOCAL_COPY_KEY='ffk-desk-copy-v1';let databaseId=null,localCopyReady=false,localCopyTimer=0;
function readLocalCopy(){try{return JSON.parse(localStorage.getItem(LOCAL_COPY_KEY)||'null');}catch{return null;}}
function scheduleLocalCopy(){
  if(!localCopyReady||!databaseId)return;clearTimeout(localCopyTimer);
  localCopyTimer=setTimeout(()=>{if(!state.teams?.length&&!state.matches?.length)return;
    try{localStorage.setItem(LOCAL_COPY_KEY,JSON.stringify({databaseId,savedAt:Date.now(),state}));}catch(e){console.warn('Browser copy not saved:',e);}},800);
}
async function offerLocalCopy(){
  const copy=readLocalCopy(),held=copy?.state,count=s=>(s?.matches?.length||0);
  if(databaseId&&held&&copy.databaseId!==databaseId&&count(held)>count(state)){
    const when=new Date(copy.savedAt).toLocaleString();
    const ok=await confirmAction({title:'Restore your tournament?',message:`This server has a new, empty database (it was probably redeployed without a volume). This browser kept a copy from ${when}: ${held.teams?.length||0} teams and ${count(held)} match${count(held)===1?'':'es'}. Restore it now? Your copy stays in this browser either way.`,accept:'Restore my tournament',cancel:'Start fresh'});
    if(ok){
      try{const r=await api('state/restore',{format:'ffk-war-desk-backup',version:1,savedAt:copy.savedAt/1000,state:held});state=await api('state');render();toast(`Tournament restored from this browser: ${r.teams} teams, ${r.matches} matches.`);}
      catch(e){toast('Could not restore the browser copy: '+e.message,'error');return;}
    }else{
      // Keep the old copy under a second key so "Start fresh" never loses it outright.
      try{localStorage.setItem(LOCAL_COPY_KEY+'-previous',JSON.stringify(copy));}catch{}
    }
  }
  localCopyReady=true;scheduleLocalCopy();
}
