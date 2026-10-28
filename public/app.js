// Agreed direction: host-managed rosters, browser OCR with source review, individual-match scoring.

const $ = s => document.querySelector(s), esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const points = [12,9,8,7,6,5,4,3,2,1,0,0];

function uiIcon(name, options = {}) {
  const size = options.size ? ` icon-${options.size}` : '';
  const cls = options.className ? ` ${options.className}` : '';
  const fill = options.fill ? ' icon-filled' : '';
  const hidden = options.label ? '' : ' aria-hidden="true"';
  const label = options.label ? ` aria-label="${options.label}"` : '';
  return `<span class="material-symbols-outlined${size}${cls}${fill}"${hidden}${label}>${name}</span>`;
}
if (typeof window !== 'undefined') window.uiIcon = uiIcon;

let state={teams:[],matches:[]}, page='overview', selected=null, tab='teams', draft=null, images=[], busy=false;

const uid=()=>crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');

function fileToDataUrl(file,image){
  return new Promise((resolve,reject)=>{
    if(file.size<9_000_000){const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);return;}
    const scale=Math.min(1,2400/(image.naturalWidth||image.width)),canvas=document.createElement('canvas');canvas.width=Math.round((image.naturalWidth||image.width)*scale);canvas.height=Math.round((image.naturalHeight||image.height)*scale);
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',.95));
  });
}
function serverRoster(teams){return {teams:teams.map(t=>({id:t.id,name:t.name,players:(t.players||[]).map(p=>({id:p.id,name:p.name,aliases:p.ocrAliases||[]}))}))};}
// Read screenshots with the server's OCR engine and roster reasoning (one at a time; the engine is shared).
async function scanOnServer(sources,files,candidates,updateProgress){
  const roster=serverRoster(candidates),rows=[];
  for(let i=0;i<sources.length;i++){
    $('#ocr-status').textContent=`Reading screenshot ${i+1} of ${sources.length}…`;updateProgress(i,.05);
    const source=sources[i],image=await fileToDataUrl(files[i],source.image);
    // Manual panel bounds are drawn on a 1392-wide canvas; the server wants original pixels.
    const k=(source.image.naturalWidth||source.image.width)/1392,regions=source.bounds?.length?source.bounds.map(b=>({x:b.x*k,y:b.y*k,width:b.width*k,height:b.height*k})):undefined;
    const scan=await api('ocr/scan',{image,roster,regions}),result=WarOCR.fromServerScan(scan);
    if(!result.length)throw Error(scan.warnings?.[0]||'No result panels were found in this screenshot.');
    source.layout=result.layout;source.rows=structuredClone(result);showSources();updateProgress(i,1);rows.push(result);
  }
  return rows;
}
async function api(path,data){const r=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const body=await r.json();if(!r.ok)throw Error(body.error||'Request failed');return body;}

function toast(msg){$('#toast').textContent=msg;$('#toast').style.display='block';setTimeout(()=>$('#toast').style.display='none',4500);}

async function save(){await api('state',state);}

function modal(html){$('#modal').style.width='';$('#modal').innerHTML=html;$('#modal').showModal();}

function closeModal(){$('#modal').close();}

async function go(next){if(busy){toast('Wait for screenshot reading to finish.');return;}if(page==='upload'&&draft&&next!=='upload'&&!await confirmAction({title:'Leave this match?',message:'Your unsaved changes will be lost.',accept:'Leave match',cancel:'Stay here'}))return;page=next;render();}

window.addEventListener('beforeunload',e=>{if(busy||(draft&&(!window.isMatchDraftSaved||!window.isMatchDraftSaved()))){e.preventDefault();e.returnValue='';}});

async function init(){try{const session=await api('session');if(!session.authenticated)return auth(session.setup,session.setupRequiresToken);state=await api('state');render();}catch(e){$('#app').innerHTML='<div class="auth"><h1>Unable to connect</h1><p>'+esc(e.message)+'</p><button onclick="location.reload()">Retry</button></div>';}}

function auth(setup,needsToken){
  const action=setup?'Create organizer access':'Sign in to War Desk';
  const title=setup?'YOUR WAR.<br><span class="card-title-accent">YOUR COMMAND.</span>':'WELCOME BACK,<br><span class="card-title-accent">ORGANIZER.</span>';
  const intro=setup?'Create your organizer password. This account controls rosters, match results, and penalties.':'Sign in to manage your tournaments.';
  $('#app').innerHTML=`<main class="login-page">
    <div class="login-ambient" aria-hidden="true">
      <div class="ambient-glow-left"></div>
      <div class="ambient-glow-right"></div>
      <div class="ambient-grid"></div>
    </div>
    <section class="login-showcase" aria-labelledby="login-showcase-title">
      <div class="showcase-watermark-claws" aria-hidden="true"></div>
      <div class="showcase-top-meta">
        <p class="login-kicker">FFK WAR DESK <span class="kicker-sep">/</span> TOURNAMENT OPERATIONS</p>
        <span class="showcase-status-badge"><span class="badge-dot" aria-hidden="true"></span> COMMAND ACTIVE</span>
      </div>
      <div class="showcase-hero-art">
        <div class="mascot-frame">
          <div class="mascot-glow" aria-hidden="true"></div>
          <img class="mascot-img" src="assets/mascot-badge.png" alt="FFK Prasanth" width="508" height="424">
        </div>
      </div>
      <div class="login-showcase-copy">
        <p class="login-status"><i aria-hidden="true"></i> ORGANIZER ACCESS</p>
        <h1 id="login-showcase-title" class="showcase-headline">BACK IN<br><span class="headline-accent">COMMAND.</span></h1>
        <p class="showcase-subtext">Your tournament. Your operations.<br>One command center.</p>
      </div>
      <div class="login-showcase-footer" aria-hidden="true">
        <div class="telemetry-tag"><span class="telemetry-idx">[ 01 ]</span> <span>OPERATIONS CONSOLE</span></div>
        <div class="telemetry-bar"></div>
        <div class="telemetry-sys">FFK // DESK</div>
      </div>
    </section>
    <section class="login-panel-wrap" aria-label="Organizer sign in">
      <header class="login-mobile-brand">
        <div class="mobile-avatar-wrap">
          <img class="mobile-avatar" src="assets/channel-avatar.jpg" alt="FFK Prasanth" width="48" height="48">
          <span class="avatar-ring" aria-hidden="true"></span>
        </div>
        <div class="mobile-brand-meta">
          <span class="mobile-brand-name">FFK PRASANTH</span>
          <span class="mobile-brand-sub">WAR DESK · TOURNAMENT OPS</span>
        </div>
      </header>
      <div class="login-card">
        <div class="card-accent-strip" aria-hidden="true"></div>
        <div class="login-card-header">
          <div class="login-mark" aria-hidden="true">FFK<span>/</span></div>
          <div class="login-mark-text">
            <p class="login-mark-title">WAR DESK</p>
            <span class="login-mark-badge">ESPORTS</span>
          </div>
        </div>
        <div class="login-card-body">
          <p class="login-overline"><span class="overline-dot" aria-hidden="true"></span>ORGANIZER CONSOLE</p>
          <h2 class="card-title">${title}</h2>
          <p class="login-intro">${intro}</p>
          <form id="login" novalidate>
            <div class="form-group">
              <label for="organizer-password" class="field-label">Organizer password</label>
              <div class="login-password-field">
                <input id="organizer-password"
                       type="password"
                       name="password"
                       minlength="10"
                       required
                       autocomplete="${setup?'new-password':'current-password'}"
                       aria-describedby="login-help login-error"
                       placeholder="Enter your password">
                <button class="login-password-toggle"
                        type="button"
                        aria-label="Show organizer password"
                        aria-pressed="false">
                  <span class="material-symbols-outlined toggle-eye-icon eye-show icon-sm" aria-hidden="true">visibility</span>
                  <span class="material-symbols-outlined toggle-eye-icon eye-hide icon-sm" aria-hidden="true" style="display:none">visibility_off</span>
                  <span class="toggle-text" aria-hidden="true">Show</span>
                </button>
              </div>
            </div>
            ${setup&&needsToken?`<div class="form-group">
              <label for="setup-token" class="field-label">Setup token</label>
              <div class="login-password-field"><input id="setup-token" type="password" name="setupToken" autocomplete="off" required placeholder="From the SETUP_TOKEN server setting"></div>
            </div>`:''}
            <p id="login-help" class="login-help">${setup?'Use at least 10 characters. This password controls your organizer access.':'Only organizers can change teams, results, and qualification.'}</p>
            <p id="login-error" class="login-error" role="alert" aria-live="polite"></p>
            <button class="primary login-submit" type="submit">
              <span class="submit-text">${action}</span>
              <span class="submit-spinner" aria-hidden="true"></span>
              <span class="material-symbols-outlined submit-arrow icon-sm" aria-hidden="true">arrow_forward</span>
            </button>
          </form>
          <div class="login-card-footer">
            <span class="footer-divider"></span>
            <p class="footer-security-text">
              <span class="material-symbols-outlined security-shield-icon icon-xs" aria-hidden="true">lock</span>
              SECURE TOURNAMENT OPERATIONS
            </p>
            <span class="footer-divider"></span>
          </div>
        </div>
      </div>
      <p class="login-legal">FFK PRASANTH <b>•</b> FREE FIRE TOURNAMENT DESK</p>
    </section>
  </main>`;

  const form=$('#login'),field=$('#organizer-password'),toggle=form.querySelector('.login-password-toggle'),submit=form.querySelector('.login-submit'),error=$('#login-error'),eyeShow=toggle.querySelector('.eye-show'),eyeHide=toggle.querySelector('.eye-hide'),toggleText=toggle.querySelector('.toggle-text');
  toggle.onclick=()=>{
    const isPassword=field.type==='password';
    field.type=isPassword?'text':'password';
    if(toggleText)toggleText.textContent=isPassword?'Hide':'Show';
    if(eyeShow)eyeShow.style.display=isPassword?'none':'inline-block';
    if(eyeHide)eyeHide.style.display=isPassword?'inline-block':'none';
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
      await api('login',{password:field.value,setupToken:$('#setup-token')?.value});
      await init();
    }catch(err){
      error.textContent=err.message||'Incorrect password';
      submit.disabled=false;
      submit.removeAttribute('aria-busy');
      field.focus();
    }
  };
}

function render(){const nav=[['overview','Overview','01'],['roster','Team roster',String(state.teams.length).padStart(2,'0')],['upload','Match intake','+'],['results','Match results',String(state.matches.length).padStart(2,'0')],['war','War manager','24']];$('#app').innerHTML=`<div class="shell"><aside class="sidebar"><div class="brand">FFK<span> /</span></div><div class="subbrand">WAR DESK</div><nav class="nav">${nav.map(([id,label,n])=>`<button class="${page===id?'active':''}" onclick="go('${id}')">${label}<small>${n}</small></button>`).join('')}</nav><div class="sidebar-footer"><span class="dot"></span>Organizer workspace<br>FREE FIRE / BR + CS<br><button onclick="logout()" style="margin-top:15px">Sign out</button></div></aside><main class="main"><header class="topbar"><span>WORKSPACE <span style="margin:0 12px">/</span> <strong>FFK WAR</strong></span><span><span class="dot"></span>Organizer <span class="avatar">FF</span></span></header><div class="content">${page==='war'?renderWar():page==='overview'?overview():page==='roster'?roster():page==='upload'?intake():results()}</div></main></div>`;bind();}

function header(kicker,title,action=''){return `<div class="eyebrow">${kicker}</div><div class="heading"><h1>${title}</h1>${action}</div>`;}
function overview(){const players=state.teams.reduce((n,t)=>n+t.players.length,0),kills=state.matches.reduce((n,m)=>n+m.rows.reduce((a,r)=>a+r.players.reduce((b,p)=>b+p.kills,0),0),0);return header('Tournament operations','Every point. Accounted for.','<button class="primary" onclick="go(\'upload\')"><span class="material-symbols-outlined icon-sm" aria-hidden="true">add</span> <span>New match</span></button>')+`<p style="margin-top:-15px;margin-bottom:30px">From the final zone to the final standings. Your match desk, in one place.</p><div class="stats">${[['Registered teams',state.teams.length,'12 teams per match'],['Players ready',players,'Up to 5 per roster'],['Matches recorded',state.matches.length,'Individual match standings'],['Eliminations logged',kills,'1 elimination = 1 point']].map(x=>`<div class="stat"><label>${x[0]}</label><strong>${String(x[1]).padStart(2,'0')}</strong><small>${x[2]}</small></div>`).join('')}</div><div class="grid"><section class="panel"><div class="panel-head"><h2>Match room</h2><span class="badge">BATTLE ROYALE</span></div>${state.matches.length?state.matches.slice().reverse().slice(0,4).map(matchItem).join(''):`<div class="empty"><div class="empty-symbol">[ 01 / 06 ]</div><h3>The next war starts here.</h3><p>Register your teams. Drop in the result screenshots.<br>We’ll help you turn the match into a points table.</p><button class="primary" onclick="go('roster')"><span>Set up your roster</span> <span class="material-symbols-outlined icon-sm" aria-hidden="true">arrow_forward</span></button></div>`}<div class="rule-strip"><span>12 TEAMS · 4 ACTIVE PLAYERS</span><span>NO API KEYS REQUIRED</span></div></section><section class="panel"><div class="panel-head"><h2>Ready. Read. Rank.</h2></div><div class="steps"><div class="step"><div><strong>Build your roster</strong><p>Add team names and exact in-game player names before the war.</p></div></div><div class="step"><div><strong>Bring the match results</strong><p>Upload overlapping screenshots. Repeated teams count once.</p></div></div><div class="step"><div><strong>Review & publish your table</strong><p>Resolve uncertain readings, apply penalties, then export.</p></div></div></div><div class="notice" style="margin:15px 0 0">Placement + eliminations + host adjustments.<br>Every change has a reason.</div></section></div>`;}

function roster(){return header('Before the first drop','Team roster',`<button class="primary" onclick="teamForm()"><span class="material-symbols-outlined icon-sm" aria-hidden="true">add</span> <span>Add team</span></button>`)+`<p>Teams from Season 11 War Lists 1 and 2 are ready below. Edit any team or player name, or add your own team.</p><div class="team-grid">${state.teams.map((t,i)=>`<article class="team-card"><div class="eyebrow">${t.rosterList?`WAR LIST ${t.rosterList} · SLOT ${String(t.slot).padStart(2,'0')}`:`TEAM ${String(i+1).padStart(2,'0')}`}</div><h2 style="margin-top:12px">${esc(t.name)}</h2><ol>${t.players.map(p=>`<li>${esc(p.name)}</li>`).join('')}</ol><div class="actions"><button onclick="teamForm('${t.id}')">Edit roster</button><button class="danger" onclick="deleteTeam('${t.id}')">Remove</button></div></article>`).join('')||'<div class="empty"><h3>No teams registered yet</h3><p>Add your first team.</p></div>'}</div>`;}

function teamForm(id){const t=state.teams.find(t=>t.id===id);modal(`<h2>${t?'Edit':'Register'} team</h2><form id="team-form"><label>Team name<input name="team" required maxlength="70" value="${esc(t?.name||'')}" placeholder="e.g. FFK Phoenix"></label><p class="caption">Copy exact in-game names where possible. Duplicate names are flagged during matching.</p>${Array.from({length:5},(_,i)=>`<label style="margin-top:12px">Player ${i+1} ${i===4?'· optional substitute':''}<input name="p${i}" ${i<4?'required':''} maxlength="90" value="${esc(t?.players[i]?.name||'')}"></label>`).join('')}<div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">Save team</button></div><p id="form-error" class="error"></p></form>`);$('#team-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),name=f.get('team').trim(),names=Array.from({length:5},(_,i)=>f.get('p'+i).trim()).filter(Boolean);if(!name||names.length<4||new Set(names).size!==names.length)return $('#form-error').textContent='Enter a team name and at least four distinct players.';if(state.teams.some(x=>x.id!==id&&x.name.toLowerCase()===name.toLowerCase()))return $('#form-error').textContent='This team name is already registered.';const updated={...(t||{}),id:id||uid(),name,players:names.map(n=>({...t?.players.find(p=>p.name===n),id:t?.players.find(p=>p.name===n)?.id||uid(),name:n}))};const prior=structuredClone(state);if(t)state.teams[state.teams.findIndex(x=>x.id===id)]=updated;else state.teams.push(updated);try{await save();closeModal();render();toast('Roster saved');}catch(e){state=prior;$('#form-error').textContent=e.message;}};}

async function deleteTeam(id){if(state.matches.some(m=>m.rows.some(r=>r.teamId===id)))return toast('This team has recorded results. Keep its roster for match history.');if(!await confirmAction({title:'Remove team?',message:'This team will be removed from your roster.',accept:'Remove team',cancel:'Keep team'}))return;const prior=structuredClone(state);state.teams=state.teams.filter(t=>t.id!==id);try{await save();render();}catch(e){state=prior;toast(e.message);}}

function intake(){return header('Screenshot & standings','Match intake')+`<div class="notice">Two screenshots, one match. We locate Free Fire result panels and use registered names to suggest results. Use Adjust panels if the detected regions need correction. Unreadable or conflicting fields stay flagged. Review all results before saving.</div><div class="panel"><div class="form-grid"><label>Match name<input id="match-name" value="${esc(draft?.name||'Match '+(state.matches.length+1))}" maxlength="70"></label><label>Map<select id="match-map">${['Bermuda','NexTerra','Purgatory','Kalahari','Solara','Alpine'].map(x=>`<option ${draft?.map===x?'selected':''}>${x}</option>`).join('')}</select></label></div><div class="dropzone"><h2>Drop the final score.</h2><p>Select original PNG or JPG screenshots covering placements 1–12.</p><input id="screenshots" aria-label="Result screenshots" type="file" accept="image/png,image/jpeg,image/webp" multiple ${busy?'disabled':''}></div><div class="actions"><button class="primary" id="scan" ${busy?'disabled':''}>${busy?'Reading screenshots…':'<span>Read screenshots</span> <span class="material-symbols-outlined icon-sm" aria-hidden="true">arrow_forward</span>'}</button><button id="manual" ${busy?'disabled':''}>Enter results manually</button></div><p class="caption">Screenshots are read in your browser and compared on the organizer server when available. Full screenshots are not saved. Corrected kill crops are saved in this browser after you save a verified match.</p><p id="ocr-status" role="status"></p><progress id="ocr-progress" max="1" value="0" hidden></progress><div class="screenshot-list" id="sources"></div></div><div id="review">${draft?review():''}</div>`;}

function blankRows(){return Array.from({length:12},(_,i)=>({placement:i+1,teamId:'',players:Array.from({length:4},()=>({playerId:'',name:'',kills:null})),warnings:[],confirmed:false,adjustments:[]}));}

function applySubstitutes(row){if(!row.teamId)return;row.players.forEach((p,i)=>{if(!p.playerId){p.rawName=p.rawName||p.name;p.isSubstitute=true;p.name=(p.rawName||p.name||'').trim()||('Substitute '+(i+1));p.playerId='sub:'+row.teamId+':'+draft.id+':'+i;}});row.warnings=row.warnings.filter(w=>w!=='Some screenshot names do not match this registered roster');}

function review(){return `<div class="actions" style="margin-bottom:20px"><button onclick="exportOCRExamples()">Export reviewed OCR examples</button><button onclick="rematchDraft()">Match names to roster</button><button onclick="confirmReadyRows()">Confirm all complete results</button></div><div class="panel-head"><h2>Review the match</h2><span class="badge">${draft.rows.filter(r=>r.confirmed).length} / 12 REVIEWED</span></div><p class="muted">Choose the registered team and active players. Open a source screenshot to check uncertain fields. Unmatched players count as substitutes once the team is identified. Their kills count normally. Blank kills remain unresolved.</p><div class="review-grid">${draft.rows.map((r,i)=>`<section class="review-card ${r.confirmed?'':'unresolved'}"><div class="panel-head"><h3>#${r.placement} <span class="caption">${points[i]} placement pts</span></h3><span class="badge">${r.confirmed?'CONFIRMED':'REVIEW'}</span></div><label>Registered team<select data-team="${i}"><option value="">Select team</option>${state.teams.filter(t=>!draft.rows.some(other=>other!==r&&other.confirmed&&other.teamId===t.id)).map(t=>`<option value="${t.id}" ${r.teamId===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label>${r.players.map((p,j)=>`<div class="player-row"><label>Player ${j+1}<select data-player="${i},${j}"><option value="">${p.name?'Unmatched � select player':'Select player'}</option><option value="__sub" ${p.isSubstitute?'selected':''}>Substitute (not on roster)</option>${(state.teams.find(t=>t.id===r.teamId)?.players||[]).map(x=>`<option value="${x.id}" ${p.playerId===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select>${p.isSubstitute?`<input data-sub-name="${i},${j}" aria-label="Substitute player name" maxlength="90" value="${esc(p.name)}"><span class="badge" style="display:inline-block;margin-top:6px">SUB · KILLS INCLUDED</span>`:''}${p.playerId?'':`<span class="caption" style="display:block;margin-top:6px">OCR read: ${esc(p.rawName||p.name||'Unreadable')}</span>`}</label><label>Kills<input data-kills="${i},${j}" type="number" min="0" max="99" step="1" value="${p.kills??''}"></label></div>`).join('')}${r.warnings.length?`<p class="error caption">${r.warnings.map(esc).join(' · ')}</p>`:''}<button onclick="confirmRow(${i})">${r.confirmed?'Reconfirm':'Confirm team result'}</button></section>`).join('')}</div><div class="panel"><div class="actions"><button class="primary" onclick="finalize()">Save verified match ↗</button><button onclick="discard()">Discard draft</button></div></div>`;}

function redrawReview(){$('#review').innerHTML=review();bindReview();}

function bindReview(){document.querySelectorAll('[data-sub-name]').forEach(el=>el.oninput=()=>{const [i,j]=el.dataset.subName.split(',').map(Number);const player=draft.rows[i].players[j];player.rawName=player.rawName||player.name;player.name=el.value.trim();player.identityEdited=true;draft.rows[i].confirmed=false;});document.querySelectorAll('[data-team]').forEach(el=>el.onchange=()=>{const r=draft.rows[+el.dataset.team];r.teamId=el.value;r.confirmed=false;r.players.forEach(p=>{p.playerId='';p.isSubstitute=false;p.identityEdited=false;p.name=p.rawName||p.name;});const team=state.teams.find(t=>t.id===r.teamId);if(team)WarOCR.matchTeam(r.players,[team],{trustedTeamId:team.id});applySubstitutes(r);redrawReview();});document.querySelectorAll('[data-player]').forEach(el=>el.onchange=()=>{const [i,j]=el.dataset.player.split(',').map(Number),r=draft.rows[i],p=state.teams.find(t=>t.id===r.teamId)?.players.find(p=>p.id===el.value);const player=r.players[j];player.rawName=player.rawName||player.name;player.identityEdited=!!p||el.value==='__sub';player.playerId=p?.id||'';player.isSubstitute=false;player.name=p?.name||player.rawName||player.name;if(el.value==='__sub'){player.playerId='';applySubstitutes(r);}r.confirmed=false;redrawReview();});document.querySelectorAll('[data-kills]').forEach(el=>el.oninput=()=>{const [i,j]=el.dataset.kills.split(',').map(Number);draft.rows[i].players[j].kills=el.value===''?null:Number(el.value);draft.rows[i].players[j].killEdited=true;draft.rows[i].confirmed=false;});}

function rematchDraft(){let matched=0;draft.rows.forEach(r=>{const team=state.teams.find(t=>t.id===r.teamId),result=WarOCR.matchTeam(r.players,team?[team]:state.teams,team?{trustedTeamId:team.id}:{});if(result.teamId){r.teamId=result.teamId;applySubstitutes(r);r.confirmed=false;matched+=r.players.filter(p=>p.playerId&&!p.isSubstitute).length;}});redrawReview();toast(matched+' player names matched to registered rosters.');}

// 'confirmed', 'ready' (complete and every reading confident) or 'look' (needs the organizer's eyes).
function rowStatus(r){
  if(r.confirmed)return 'confirmed';
  const complete=r.teamId&&r.players.every(p=>p.playerId&&p.name.trim()&&Number.isInteger(p.kills)&&p.kills>=0&&p.kills<=99);
  const doubtful=r.players.some(p=>p.serverRead&&(p.killConfidence??100)<70||(p.matchScore!==undefined&&p.matchScore<.7))||r.warnings.some(w=>w.includes('disagree'));
  return complete&&!doubtful?'ready':'look';
}
function reviewSummary(){
  const rows=draft.rows,cells=rows.flatMap(r=>r.players),read=cells.filter(p=>Number.isInteger(p.kills)).length;
  const ready=rows.filter(r=>rowStatus(r)==='ready').length,look=rows.filter(r=>rowStatus(r)==='look').length;
  return {read,total:cells.length,teams:rows.filter(r=>r.teamId).length,ready,look};
}
function confirmReadyRows(){let count=0;draft.rows.forEach(r=>{if(rowStatus(r)==='ready'&&r.teamId&&!draft.rows.some(x=>x!==r&&x.teamId===r.teamId)&&r.players.every(p=>p.playerId&&p.name.trim()&&Number.isInteger(p.kills)&&p.kills>=0&&p.kills<=99)&&new Set(r.players.map(p=>p.playerId)).size===4&&!r.warnings.some(w=>w.includes('disagree'))){r.confirmed=true;r.warnings=[];count++;}});redrawReview();toast(count?count+' team result'+(count===1?'':'s')+' confirmed. Check the ones marked “Look”.':'No team is ready to confirm yet. Check the ones marked “Look”.');}

function confirmRow(i){const r=draft.rows[i];if(!r.teamId||r.players.some(p=>!p.playerId||!p.name.trim()||!Number.isInteger(p.kills)||p.kills<0||p.kills>99)||new Set(r.players.map(p=>p.playerId)).size!==4)return toast('Select a team, four different players, and valid kill counts.');if(draft.rows.some((x,j)=>i!==j&&x.teamId===r.teamId))return toast('This team is assigned to another placement.');r.confirmed=true;r.warnings=[];redrawReview();}

async function finalize(){
  if(busy||!draft)return;
  if(draft.rows.some(r=>!r.confirmed))return toast('Confirm all 12 team results before saving.');
  if(new Set(draft.rows.map(r=>r.teamId)).size!==12)return toast('Every placement needs a different team.');
  draft.name=$('#match-name').value.trim();draft.map=$('#match-map').value;if(!draft.name)return toast('Enter a match name.');
  const warBefore=state.war===undefined?undefined:structuredClone(state.war);
  if(draft.stage){try{WarTournament.registerResult(state,draft);}catch(e){return toast(e.message,'error');}}
  const rosterBefore=structuredClone(state.teams);
  const learnedNames=WarOCR.rememberAliases(state.teams,draft.rows);
  const m=structuredClone(draft);m.rows.forEach(r=>{r.teamName=state.teams.find(t=>t.id===r.teamId).name;r.players.forEach(p=>{delete p.ocrRegion;delete p.killEdited;delete p.evidenceCrop;delete p.identityEdited;});});m.created=new Date().toISOString();
  busy=true;state.matches.push(m);
  try{await save();}catch(e){state.matches.pop();state.teams=rosterBefore;if(warBefore===undefined)delete state.war;else state.war=warBefore;busy=false;toast(e.message);return;}
  let message='Verified match saved'+(learnedNames?' · '+learnedNames+' player name corrections remembered':'');
  try{
    const records=WarOCRLearning.capture({...draft,created:m.created},images,(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;});
    const count=await WarOCRLearning.store(records);if(count)message+=` · ${count} reviewed OCR examples saved in this browser`;
  }catch(e){console.warn(e);message+=' · OCR examples could not be saved in this browser';}
  draft=null;clearImages();selected=m.id;page='results';busy=false;render();toast(message);
}

async function exportOCRExamples(){try{const count=await WarOCRLearning.download();toast(count+' reviewed OCR examples exported');}catch(e){toast('Could not export OCR examples: '+e.message);}}

function clearImages(){images.forEach(x=>URL.revokeObjectURL(x.url));images=[];}

async function discard(){if(await confirmAction({title:'Discard this match?',message:'The unsaved results will be removed.',accept:'Discard match',cancel:'Keep editing'})){draft=null;clearImages();render();}}

function bind(){if(page==='upload'){$('#scan').onclick=()=>scan();$('#manual').onclick=async()=>{if(draft&&!await confirmAction({title:'Start fresh?',message:'This will replace the current results with an empty match.',accept:'Start fresh',cancel:'Keep results'}))return;clearImages();draft={id:uid(),name:$('#match-name').value,map:$('#match-map').value,stage:$('#war-stage')?.value||undefined,rows:blankRows()};redrawReview();showSources();};bindReview();showSources();}if(page==='results'&&$('#match-select'))$('#match-select').onchange=e=>{selected=e.target.value;render();};}

function showSources(){if(!$('#sources'))return;$('#sources').innerHTML=images.map((im,i)=>`<div><button style="padding:0" onclick="openSource(${i})" aria-label="Open screenshot ${i+1}"><img src="${im.url}" alt="Source screenshot ${i+1}"></button><p class="caption">${im.layout?im.layout.panels.length+' panels located'+(im.layout.comparison?' · OCR cross-checked':im.layout.comparisonError?' · comparison unavailable':''):'Source screenshot'}</p><button onclick="editPanels(${i})" ${busy?'disabled':''}>Adjust panels</button></div>`).join('');}

function openSource(i){window.open(images[i].url,'_blank','noopener');}

async function scan(skipConfirm=false){
  if(state.teams.length<12)return toast('Register at least 12 teams before reading a full match.');
  const files=[...$('#screenshots').files];
  if(!files.length)return toast('Select your result screenshots first.');
  if(files.length>6)return toast('Use at most 6 screenshots per match.');
  if(files.some(f=>f.size>15*1024*1024))return toast('Each screenshot must be smaller than 15 MB.');
  if(!window.WarOCRBatch)return toast('Unable to prepare results. Refresh the page and try again.');
  if(draft&&skipConfirm!==true&&!await confirmAction({title:'Replace current results?',message:'Your new screenshots will replace this unsaved match.',accept:'Replace results',cancel:'Keep results'}))return;
  busy=true;setMatchLoading(true);$('#scan').disabled=true;$('#manual').disabled=true;$('#screenshots').disabled=true;$('#ocr-progress').hidden=false;
  const previousBounds=files.map(f=>images.find(im=>im.fileKey===f.name+':'+f.size)?.bounds);
  clearImages();draft={id:uid(),name:$('#match-name').value,map:$('#match-map').value,stage:$('#war-stage')?.value||undefined,rows:blankRows()};
  const progress=files.map(()=>0);
  const updateProgress=(index,value)=>{
    progress[index]=Math.max(progress[index],Math.min(1,value));
    const overall=progress.reduce((sum,n)=>sum+n,0)/files.length;
    $('#ocr-progress').value=overall;$('#ocr-status').textContent='Reading screenshots · '+Math.round(overall*100)+'%';
  };
  try{
    await WarOCRLearning.load().catch(e=>console.warn('Reviewed OCR examples unavailable:',e));
    const localOCR=await api('ocr/status').catch(()=>({available:false}));
    images=files.map((file,i)=>{const url=URL.createObjectURL(file),image=new Image();image.src=url;return {url,image,bounds:previousBounds[i],fileKey:file.name+':'+file.size};});
    await Promise.all(images.map(source=>source.image.decode()));showSources();
    const candidates=typeof WarTournament==='undefined'?state.teams:WarTournament.availableTeams(state,draft.stage);
    let rowsByScreenshot=null;
    if(localOCR.scan){
      try{rowsByScreenshot=await scanOnServer(images,files,candidates,updateProgress);}
      catch(e){console.warn('Server screenshot reader failed; using the in-browser reader:',e);$('#ocr-status').textContent='Switching to the in-browser reader…';progress.fill(0);}
    }
    if(!rowsByScreenshot&&!window.Tesseract)throw Error('The in-browser reader could not load (it needs an internet connection). Use a server with the screenshot reader installed, or enter results by hand.');
    if(!rowsByScreenshot)rowsByScreenshot=await WarOCRBatch.run(images,{
      maxWorkers:WarOCRBatch.capacity(files.length,navigator),
      createWorker:async()=>{
        const worker=await Tesseract.createWorker('eng',1,{logger:m=>{if(m.status&&progress.every(n=>n===0))$('#ocr-status').textContent='Preparing the screenshot reader…';}});
        try{await worker.setParameters({tessedit_pageseg_mode:'11'});return worker;}catch(e){await worker.terminate().catch(()=>{});throw e;}
      },
      onWorkerFailure:e=>console.warn('Using available screenshot readers:',e),
      process:async(worker,source,index)=>{
        const rows=await WarOCR.extract(worker,source.image,candidates,(width,height)=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return canvas;},(_text,value)=>updateProgress(index,value),{
          bounds:source.bounds,compare:localOCR.available?async(image,boxes)=>(await api('ocr',{image,boxes})).readings:undefined
        });
        source.layout=rows.layout;source.rows=structuredClone(rows);showSources();updateProgress(index,1);return rows;
      }
    });
    // Completion order never changes screenshot precedence or disagreement handling.
    rowsByScreenshot.forEach(rows=>rows.forEach(row=>WarOCR.merge(draft.rows[row.placement-1],row)));
    draft.rows.forEach(row=>{applySubstitutes(row);if(!row.teamId)row.warnings.push('Team could not be matched confidently');if(row.players.some(p=>p.kills===null))row.warnings.push('Missing or uncertain kill counts');if(row.players.some(p=>!p.playerId))row.warnings.push('Some screenshot names do not match this registered roster');});
    const sum=reviewSummary();
    $('#ocr-status').textContent=`Results ready · ${sum.read} of ${sum.total} kill counts read · ${sum.teams} of 12 teams matched · ${sum.ready} ready to confirm, ${sum.look} to check`;redrawReview();
  }catch(e){
    console.error('Screenshot processing failed',e);$('#ocr-status').textContent='Unable to prepare results. Try clearer screenshots or enter results manually.';toast('Unable to prepare results. Try again or enter results manually.');
  }finally{
    busy=false;setMatchLoading(false);$('#scan').disabled=false;$('#manual').disabled=false;$('#screenshots').disabled=false;showSources();
  }
}

function resultMatch(){return selected==="__overall__"?WarOverall.aggregate(state):state.matches.find(m=>m.id===selected);}
function score(r){if(r.overall)return {kills:r.kills,placement:r.placementPoints,adjustment:r.adjustment,total:r.total};const kills=r.players.reduce((n,p)=>n+p.kills,0),placement=points[r.placement-1],adjustment=(r.adjustments||[]).reduce((n,a)=>n+a.value,0);return {kills,placement,adjustment,total:kills+placement+adjustment};}

function rankedRows(m){if(m.isOverall)return m.rows;return m.rows.slice().sort((a,b)=>{const x=score(a),y=score(b);return y.total-x.total||y.kills-x.kills||Number(b.placement===1)-Number(a.placement===1)||y.placement-x.placement;});}

function matchItem(m){return `<div class="match-item"><div><h3>${esc(m.name)}</h3><span class="caption">${esc(m.map)} · ${m.rows.length} teams · ${new Date(m.created).toLocaleDateString('en-IN')}</span></div><button onclick="selected='${m.id}';page='results';render()">View results ↗</button></div>`;}

async function deleteMatch(){
  if(busy)return toast('Wait for the current operation to finish.');
  const match=state.matches.find(m=>m.id===selected);if(!match)return;
  if(!await confirmAction({title:'Delete match?',message:`“${match.name}” and its results will be permanently deleted. Your teams will stay saved.`,accept:'Delete match',cancel:'Keep match'}))return;
  busy=true;
  try{state=await api('matches/delete',{id:match.id});selected=state.matches.at(-1)?.id||null;render();toast('Match deleted');}
  catch(e){toast('Could not delete match: '+e.message);}
  finally{busy=false;}
}

function results(){if(selected==="__overall__"&&state.matches.length)return overallResults();if(!state.matches.length)return header('The scoreboard','Match results')+'<div class="panel empty"><h2>No matches recorded</h2><p>Your verified match tables and player leaderboards will appear here.</p><button class="primary" onclick="go(\'upload\')">Add the first match</button></div>';const m=state.matches.find(m=>m.id===selected)||state.matches.at(-1);selected=m.id;const rows=rankedRows(m),players=m.rows.flatMap(r=>r.players.map(p=>({...p,teamName:r.teamName}))).sort((a,b)=>b.kills-a.kills);return header('Verified match results',esc(m.name),'<div class="actions"><button onclick="deleteMatch()">Delete match</button><button onclick="openPoster()">Scoreboard graphic</button><button onclick="downloadCSV()">Export CSV ↓</button><button class="primary" onclick="printResults()">Print / save PDF ↗</button></div>')+`<div class="form-grid no-print"><label>Match<select id="match-select"><option value="__overall__">Overall points table</option>${state.matches.map(x=>`<option value="${x.id}" ${m.id===x.id?'selected':''}>${esc(x.name)} · ${esc(x.map)}</option>`).join('')}</select></label><div class="notice">${esc(m.map)} · 12 teams<br>1 kill = 1 point. Host resolves any remaining ties.</div></div><div class="tabs"><button class="${tab==='teams'?'active':''}" onclick="tab='teams';render()">Team standings</button><button class="${tab==='players'?'active':''}" onclick="tab='players';render()">Player kill leaderboard</button></div><section class="panel table-wrap">${tab==='teams'?`<table><thead><tr><th>Rank</th><th>Team</th><th>Finish</th><th>Kills</th><th>Placement pts</th><th>Adjustment</th><th>Total pts</th><th class="no-print">Manage</th></tr></thead><tbody>${rows.map((r,i)=>{const s=score(r),prev=i?score(rows[i-1]):null,tied=prev&&prev.total===s.total&&prev.kills===s.kills&&rows[i-1].placement===r.placement;return `<tr><td class="rank">${tied?'TIE':String(i+1).padStart(2,'0')}</td><td><strong>${esc(r.teamName)}</strong>${r.placement===1?' <span class="badge">BOOYAH</span>':''}</td><td>#${r.placement}</td><td>${s.kills}</td><td>${s.placement}</td><td>${s.adjustment>0?'+':''}${s.adjustment}</td><td class="total">${s.total}</td><td class="no-print"><button onclick="details('${r.teamId}')">Players / penalties</button></td></tr>`;}).join('')}</tbody></table>`:`<table><thead><tr><th>Rank</th><th>Player</th><th>Team</th><th>Kills</th></tr></thead><tbody>${players.map((p,i)=>`<tr><td class="rank">${i&&players[i-1].kills===p.kills?players.findIndex(x=>x.kills===p.kills)+1:i+1}</td><td><strong>${esc(p.name)}</strong>${p.isSubstitute?' <span class="badge">SUB</span>':''}</td><td>${esc(p.teamName)}</td><td class="total">${p.kills}</td></tr>`).join('')}</tbody></table>`}</section><p class="caption">TEAM RANKING: TOTAL POINTS → KILLS → BOOYAHS → PLACEMENT POINTS</p>`;}

function details(teamId){const m=state.matches.find(m=>m.id===selected),r=m.rows.find(r=>r.teamId===teamId);modal(`<h2>${esc(r.teamName)}</h2>${r.players.map(p=>`<div class="match-item"><span>${esc(p.name)}${p.isSubstitute?' <span class="badge">SUB</span>':''}</span><strong>${p.kills} kills</strong></div>`).join('')}<h3 style="margin-top:24px">Point adjustments</h3>${r.adjustments.map(a=>`<p>${a.value>0?'+':''}${a.value} pts · ${esc(a.reason)}<br><small>${new Date(a.at).toLocaleString('en-IN')}</small></p>`).join('')||'<p>No adjustments applied.</p>'}<form id="adjust"><div class="form-grid"><label>Points (+ or −)<input name="value" type="number" required min="-999" max="999" step="1" placeholder="−5"></label><label>Reason<input name="reason" required maxlength="200" placeholder="Explain the host decision"></label></div><div class="actions"><button type="button" onclick="closeModal()">Close</button><button class="primary">Apply adjustment</button></div><p id="adjust-error" class="error"></p></form>`);$('#adjust').onsubmit=async e=>{e.preventDefault();const value=Number(e.target.value.value),reason=e.target.reason.value.trim();if(!Number.isInteger(value)||!value||!reason)return $('#adjust-error').textContent='Enter non-zero whole points and a reason.';r.adjustments.push({value,reason,at:new Date().toISOString()});try{await save();closeModal();render();toast('Adjustment recorded');}catch(e){r.adjustments.pop();$('#adjust-error').textContent=e.message;}};}

function downloadCSV(){if(selected==="__overall__")return downloadOverallCSV();const m=state.matches.find(m=>m.id===selected);const records=tab==='teams'?[['Rank','Team','Finish','Kills','Placement points','Adjustment','Total'],...rankedRows(m).map((r,i)=>{const s=score(r);return [i+1,r.teamName,r.placement,s.kills,s.placement,s.adjustment,s.total];})]:[['Player','Team','Kills'],...m.rows.flatMap(r=>r.players.map(p=>[p.name,r.teamName,p.kills])).sort((a,b)=>b[2]-a[2])];const csv='\ufeff'+records.map(r=>r.map(v=>'"'+String(v).replace(/^[=+@\-]/,"'$&").replaceAll('"','""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=m.name.replace(/[^a-z0-9]/gi,'-')+'-'+tab+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

async function logout(){if(busy)return toast('Wait for reading to finish.');if(draft&&!await confirmAction({title:'Sign out?',message:'Your unsaved match will be discarded.',accept:'Sign out',cancel:'Keep working'}))return;try{await api('logout',{});draft=null;clearImages();await init();}catch(e){toast(e.message);}}




function setMatchLoading(active){
  const overlay=document.querySelector('#match-loading');
  if(overlay){overlay.hidden=!active;document.querySelector('#app').inert=active;}
  document.querySelector('#review')?.setAttribute('aria-busy',String(active));
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
    $('#rotate-host-key').onclick=async()=>{if(!await confirmAction({title:'Reset host links?',message:'Existing host and broadcast links will stop working. Share the new links with your host.',accept:'Reset links',cancel:'Keep links'}))return;try{await api('host/access',{rotate:true});await openHostAccess();}catch(e){toast(e.message);}};
  }catch(e){toast('Could not open host access: '+e.message);}
}
