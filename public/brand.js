/* Appearance only: existing handlers, IDs, match data and OCR workflow remain in place. */
(function(){
 const existing={render,overview,results,bind,roster,header,redrawReview};
 let expandedMatch=null;
 const channel='https://www.youtube.com/@FFK_Prasanth';
 /* Social icons — no Material Symbols equivalent for brand logos, keep custom SVGs */
 const paths={instagram:'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M17.5 6.5h.01',youtube:'M9 8l7 4-7 4zM3 5h18v14H3z',discord:'M8 5 4 6 2 17l5 3 1-3m8-12 4 1 2 11-5 3-1-3M7 16c3 2 7 2 10 0M8 11h.01M16 11h.01'};
 const svgIcon=(name)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
 /* Material Symbols helper — single source of truth for icon rendering */
 const ms=(name,size='sm',extra='')=>`<span class="material-symbols-outlined icon-${size}" aria-hidden="true"${extra}>${name}</span>`;
 /* Trophy brand mark used in booyah celebrations — kept as custom SVG */
 const trophySvg=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h8v6a4 4 0 0 1-8 0V3m0 2H3v3a4 4 0 0 0 5 4m8-7h5v3a4 4 0 0 1-5 4M12 13v7m-5 1h10"/></svg>`;
 const icon=(name)=>paths[name]?svgIcon(name):ms(name==='upload'?'upload_file':name==='trophy'?'emoji_events':name==='logout'?'logout':name==='download'?'download':name==='image'?'image':name==='trash'?'delete':name,'sm');
 function initials(name){return name.replace(/^FFK\s*/i,'').split(/\s+/).map(s=>s[0]).slice(0,2).join('').toUpperCase()||'FFK';}
 function section(html){const container=document.createElement('div');container.innerHTML=html;return container;}
 overview=function(){
  const original=section(existing.overview()),stats=original.querySelector('.stats')?.outerHTML||'',resume=original.querySelector('.resume-banner')?.outerHTML||'';
  const latest=state.matches.at(-1),winner=latest?.rows.find(r=>r.placement===1),leader=latest?rankedRows(latest)[0]:null;
  return `${original.querySelector('.war-shortcut')?.outerHTML||''}<section class="channel-hero"><div class="hero-copy"><span class="brand-kicker">FFK PRASANTH / TOURNAMENT OPERATIONS</span><h1>MATCH DESK</h1><p>Every drop. Every elimination. Every point.</p><button class="primary" onclick="go('upload')">${ms('add','sm')} <span>New match</span></button></div><span class="hero-edition">FREE FIRE · WAR DESK</span></section>${resume}${stats}<div class="section-label"><h2>Matches</h2><span>SELECT A MATCH TO EXPAND</span></div>${latest?`<div class="match-accordion">${state.matches.slice().reverse().map((match,index)=>{
    const winner=match.rows.find(r=>r.placement===1),leader=rankedRows(match)[0];
    const expanded=expandedMatch?expandedMatch===match.id:index===0;
    return `<details class="match-expand panel" name="overview-matches" data-match-id="${esc(match.id)}" ${expanded?'open':''}><summary><span><strong>${esc(match.name)}</strong><small>${esc(match.map)} · ${match.rows.length} teams · ${new Date(match.created).toLocaleDateString('en-IN')}</small></span><span class="match-expand-hint">${winner?`<span class="match-booyah"><span class="match-booyah-label">BOOYAH</span><span class="match-booyah-name"><svg viewBox="0 0 32 26" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20 2 7l9 7L16 2l5 12 9-9-5 15M5 24l20-.5"/></svg>${esc(state.teams.find(t=>t.id===winner.teamId)?.name||winner.teamName)}</span></span>`:''}</span></summary><div class="match-expanded-content"><div class="map-banner" data-map="${esc(match.map)}"><span class="map-label">${esc(match.map)}</span><span class="match-date">${new Date(match.created).toLocaleDateString('en-IN')}</span></div><div class="latest-body"><div><span class="caption">MATCH SUMMARY</span><h2>${esc(match.name)}</h2><p>${match.rows.length} teams · ${match.rows.reduce((n,r)=>n+score(r).kills,0)} eliminations</p></div><div class="winner-summary"><span class="booyah">${trophySvg} BOOYAH</span><strong>${esc(winner?.teamName||'Winner pending')}</strong>${leader?`<span class="caption">Points leader: ${esc(leader.teamName)} · ${score(leader).total} pts</span>`:''}</div><button onclick="selected='${match.id}';page='results';render()"><span>View results</span> <span class="material-symbols-outlined icon-sm" aria-hidden="true">arrow_forward</span></button></div></div></details>`;
   }).join('')}</div>`:'<div class="panel empty"><h2>Your next war starts here</h2><p>Add your first match to see it here.</p><button onclick="go(\'upload\')"><span class="material-symbols-outlined icon-sm" aria-hidden="true">add</span> <span>New match</span></button></div>'}<details class="desk-guide panel"><summary>How your match desk works</summary><p>Register teams → upload screenshots → review results → export standings.</p><p>Placement points + eliminations + host adjustments. Every change has a reason.</p></details>`;
 };
 results=function(){
  const html=existing.results();if(!state.matches.length||selected==="__overall__")return html;
  const match=state.matches.find(m=>m.id===selected)||state.matches.at(-1),ranked=rankedRows(match),first=ranked[0];if(!first)return html;
  const root=section(html),table=root.querySelector('table');
  if(tab==='teams'&&table){
   const total=score(first),hero=document.createElement('section');hero.className='winner-hero';
   hero.innerHTML=`<div class="winner-mark">${trophySvg}</div><div class="winner-copy"><span class="brand-kicker">#1 · TEAM STANDINGS</span><h2>${esc(first.teamName)}</h2>${first.placement===1?'<span class="booyah">BOOYAH</span>':'<span class="winner-label">POINTS LEADER</span>'}<p>Finish #${first.placement} <span>/</span> ${total.kills} eliminations <span>/</span> ${total.placement} placement points <span>/</span> ${total.adjustment} adjustment</p></div><div class="winner-total"><strong>${total.total}</strong><span>TOTAL POINTS</span></div><button onclick="details('${first.teamId}')" class="winner-details">Players / penalties →</button>`;
   const tabs=root.querySelector('.tabs');if(tabs)tabs.after(hero);else table.closest('section').before(hero);
   // Keep the leader in the complete standings table as well as the summary.
  }
  return root.innerHTML;
 };
 function brandChrome(){
  const shell=document.querySelector('.shell');if(!shell)return;shell.classList.add('channel-shell');shell.dataset.page=page;
  const sidebar=document.querySelector('.sidebar'),brand=sidebar.querySelector('.brand');
  brand.className='brand channel-brand';brand.innerHTML=`${page==='overview'?'<span class="channel-monogram">FFK</span>':'<img class="channel-profile" src="assets/channel-avatar.jpg" alt="FFK Prasanth channel profile">'}<span class="channel-wordmark">FFK<br>PRASANTH<small>WAR DESK</small></span>`;
  sidebar.querySelector('.subbrand')?.remove();
 /* Nav icons mapped to Material Symbols — overview/roster/upload/results/war */
 const navIcons=['home','groups','upload_file','leaderboard','emoji_events'];
 sidebar.querySelectorAll('.nav button').forEach((button,i)=>{const count=button.querySelector('small');if(count)count.className='nav-count';const span=document.createElement('span');span.className='nav-icon';span.innerHTML=ms(navIcons[i]||'chevron_right','md');button.prepend(span);});
  const hostButton=document.createElement('button');hostButton.className='host-access-button';hostButton.innerHTML=ms('manage_accounts','md')+'<span>Host desk</span>';hostButton.onclick=openHostAccess;sidebar.querySelector('.nav').after(hostButton);
  const footer=sidebar.querySelector('.sidebar-footer'),signout=footer.querySelector('button');signout.classList.add('signout');signout.innerHTML=ms('logout','sm')+'<span>Sign out</span>';
  footer.replaceChildren();const socials=document.createElement('div');socials.className='channel-socials';socials.innerHTML=`<a href="https://www.instagram.com/ffk_prasanth/" target="_blank" rel="noopener noreferrer" aria-label="FFK Prasanth on Instagram">${svgIcon('instagram')}</a><a href="${channel}" target="_blank" rel="noopener noreferrer" aria-label="FFK Prasanth on YouTube">${svgIcon('youtube')}</a>`;footer.append(socials,signout);
  const bar=document.querySelector('.topbar'),sync=bar.querySelector('.sync-button'),breadcrumbs=document.createElement('div');breadcrumbs.className='brand-breadcrumb';breadcrumbs.innerHTML=`<span>FFK WAR DESK</span><i>/</i><strong>${({overview:'Overview',roster:'Team roster',upload:'New match',results:'Match results',war:'War manager'})[page]}</strong>`;
  const right=document.createElement('div');right.className='topbar-right';right.innerHTML=`<span class="subscriber-count"><strong>915K</strong><small>SUBSCRIBERS</small></span><a class="watch-live" href="${channel}" target="_blank" rel="noopener noreferrer">${svgIcon('youtube')} Watch live</a>`;if(sync)right.append(sync);const account=document.createElement('details');account.className='mobile-account';account.innerHTML='<summary aria-label="Channel and account menu">•••</summary>';const accountPanel=document.createElement('div');accountPanel.className='mobile-account-panel';const mobileHost=document.createElement('button');mobileHost.type='button';mobileHost.className='mobile-host-btn';mobileHost.innerHTML=ms('manage_accounts','sm')+'<span>Host desk</span>';mobileHost.onclick=()=>{account.open=false;openHostAccess();};accountPanel.append(mobileHost,socials.cloneNode(true),signout.cloneNode(true));account.append(accountPanel);right.append(account);bar.replaceChildren(right);right.querySelector('.subscriber-count')?.remove();right.querySelector('.watch-live')?.remove();WarInsights.mount(bar,state);
  if(page==='overview'){
   document.querySelectorAll('.match-expand').forEach(card=>card.addEventListener('toggle',()=>{
    if(!card.open)return;
    expandedMatch=card.dataset.matchId;
    document.querySelectorAll('.match-expand').forEach(other=>{if(other!==card)other.open=false;});
   }));
  }
  if(page==='roster'){
   const search=document.querySelector('.search-bar'),input=document.querySelector('#roster-search');if(search){search.classList.add('topbar-search');document.querySelector('.heading').after(search);input.placeholder='Search teams or players';const count=search.querySelector('#roster-count');if(count){count.classList.add('roster-result-count');document.querySelector('.heading h1').after(count);}}
  }
  if(page==='upload'){
   const input=document.querySelector('#screenshots'),drop=document.querySelector('#dropzone');if(input&&drop){input.classList.add('native-file-input');const visual=document.createElement('label');visual.htmlFor='screenshots';visual.className='upload-picker';visual.innerHTML=`<span class="upload-symbol">${ms('upload_file','lg')}</span><strong>DROP YOUR FINAL SCORE.</strong><span>Drag screenshots here, or <u>browse files</u></span>`;drop.prepend(visual);}
   document.querySelector('#manual')?.classList.add('plain-action');
  }
  /* Results action buttons: delete, poster, CSV now use icon-button with Material Symbols */
  const actionIconsMs={'deleteMatch()':['delete','Delete match'],'openPoster()':['image','Scoreboard graphic'],'downloadCSV()':['download','Export CSV']};
  if(page==='results')document.querySelectorAll('.heading button').forEach(button=>{const info=actionIconsMs[button.getAttribute('onclick')];if(info){button.innerHTML=ms(info[0],'sm')+`<span>${info[1]}</span>`;button.classList.add('icon-action-btn');}});
  simplifyWorkspace();enforcePrimary();
 }
 function simplifyWorkspace(){
  if(page==='results'){
   const content=document.querySelector('.content'),select=document.querySelector('#match-select');
   const actions=content.querySelector('.heading .actions');
   if(actions){
    actions.querySelectorAll('[onclick="openPoster()"],[onclick="downloadCSV()"],[onclick="printResults()"]').forEach(button=>button.remove());
    const exportButton=document.createElement('button');exportButton.className='primary';exportButton.id='export-results';exportButton.innerHTML=ms('download','sm')+'<span>Export results</span>';exportButton.onclick=openExportChooser;actions.append(exportButton);
   }
   if(select){
    const controls=select.closest('.form-grid');controls?.classList.add('results-controls');
    const search=document.querySelector('.match-search'),count=document.querySelector('#match-search-count');
    if(search&&controls){const disclosure=document.createElement('details');disclosure.className='match-finder no-print';const summary=document.createElement('summary');summary.textContent='Find a match';disclosure.append(summary,search);if(count)disclosure.append(count);controls.append(disclosure);}
    if(controls){
     controls.classList.add('compact-results-controls');
     controls.querySelector('.notice')?.remove();
     controls.querySelector('.match-finder')?.remove();
     const manage=document.createElement('button');manage.type='button';manage.className='manage-matches';manage.textContent='Manage matches';manage.onclick=openMatchManager;controls.append(manage);
    }
    const tabs=content.querySelector('.tabs');if(tabs){tabs.setAttribute('aria-label','Result views');tabs.querySelectorAll('button').forEach(button=>{button.setAttribute('aria-pressed',String(button.classList.contains('active')));});}
   }
   if(tab==='teams'){
    const match=resultMatch(),ranked=match?.isOverall?match.rows:match?rankedRows(match):[];
    const leaders=ranked.slice(0,3);
    if(leaders.length){
     const podium=document.createElement('section');podium.className='results-podium';podium.setAttribute('aria-label','Top three teams by points');
     leaders.forEach((row,index)=>{
      const rank=row.rank||index+1,total=score(row),card=document.createElement('button');card.type='button';card.className='podium-team podium-place-'+(index+1);
      card.setAttribute('aria-label',`${row.teamName}, rank ${rank}, ${total.total} points. View details`);
      card.innerHTML=`<span class="podium-medal" aria-hidden="true">${index===0?trophySvg:String(rank).padStart(2,'0')}</span><span class="podium-name">${esc(row.teamName)}</span><span class="podium-points">${total.total}<small>POINTS</small></span><span class="podium-meta">${total.kills} kills · ${match.isOverall?row.wins+' wins':'Finish #'+row.placement}</span><span class="podium-step">#${rank}</span>`;
      card.onclick=()=>match.isOverall?overallBreakdown(row.teamId):details(row.teamId);podium.append(card);
     });
     const hero=content.querySelector('.winner-hero');if(hero)hero.replaceWith(podium);else content.querySelector('.tabs')?.after(podium);
    }
   }
   const toolbar=document.createElement('div');toolbar.className='results-toolbar no-print';
   const controls=content.querySelector('.results-controls'),views=content.querySelector('.tabs');
   if(controls&&views){controls.before(toolbar);toolbar.append(controls,views);}
   const labels={'Team standings':'Teams','Player kill leaderboard':'Players','Kill graph':'Kill graph','Position graph':'Position graph'};
   views?.querySelectorAll('button').forEach(button=>{button.textContent=labels[button.textContent.trim()]||button.textContent;});
   content.querySelectorAll('.table-wrap th').forEach(th=>{const text=th.textContent.trim();th.title=text;th.textContent=({'Placement pts':'Place pts','Total pts':'Points','Adjustment':'Adj.','Manage':'Details'})[text]||text;});
   content.querySelectorAll('.table-wrap td button').forEach(button=>{button.title=button.textContent;button.textContent='Details';});
   content.querySelectorAll('.heading .icon-button').forEach(button=>{const label=document.createElement('span');label.textContent=button.getAttribute('aria-label');button.append(label);});
  }
  if(page==='upload'){
   const summary=document.querySelector('.intake-panel>summary');if(summary)summary.textContent=draft?'Match details':'Match details';
   addReviewNavigation();
  }
 }
 function addReviewNavigation(){}
 function enforcePrimary(){
  const content=document.querySelector('.content');if(!content)return;
  const target=page==='overview'?content.querySelector('.channel-hero .primary'):page==='roster'?content.querySelector('.heading .primary'):page==='results'?content.querySelector('#export-results'):content.querySelector('#scan');
  content.querySelectorAll('.primary').forEach(button=>{if(!button.closest('#review'))button.classList.add('brand-outline-primary');});const main=target||[...content.querySelectorAll('.primary')].find(button=>!button.closest('#review'));if(main){main.classList.remove('brand-outline-primary');main.classList.add('brand-main-action');}
 }
 function openExportChooser(){
  const match=resultMatch();if(!match)return;

  modal(`<div class="panel-head"><div><span class="caption">${esc(match.name)}</span><h2>Choose your export</h2></div><button onclick="closeModal()" aria-label="Close export options">Close</button></div><p>Choose a template, then download or print your results.</p><div class="export-templates"><button class="export-template" id="choose-original"><img src="assets/scoreboard-reference.png" alt="Original uploaded FFK scoreboard template"><span><strong>Original FFK template</strong><small>Your uploaded artwork · PNG or PDF</small></span><span class="material-symbols-outlined icon-sm" aria-hidden="true">chevron_right</span></button><button class="export-template add-template" id="choose-add"><span class="export-layout-preview add-template-preview" aria-hidden="true"><span class="material-symbols-outlined icon-md">add</span></span><span><strong>Add template</strong><small>Upload artwork & position the results table</small></span><span class="material-symbols-outlined icon-sm" aria-hidden="true">chevron_right</span></button>${WarTemplates.list().map((t,i)=>`<button class="export-template" data-custom-template="${i}"><img src="${esc(t.image)}" alt="${esc(t.name)} template"><span><strong>${esc(t.name)}</strong><small>Saved in this browser · PNG or PDF</small></span><span class="material-symbols-outlined icon-sm" aria-hidden="true">chevron_right</span></button>`).join('')}</div><div class="export-data"><div><strong>Need the numbers?</strong><p>Download the current view as a CSV spreadsheet.</p></div><button id="choose-csv">${ms('download','sm')} <span>Export CSV</span></button></div>`);
  const dialog=document.querySelector('#modal');dialog.style.width='min(780px,96vw)';dialog.classList.add('brand-dialog');
  document.querySelector('#choose-original').onclick=()=>{closeModal();openPoster();};
  document.querySelector('#choose-add').onclick=()=>WarTemplates.open(null,openExportChooser); document.querySelectorAll('[data-custom-template]').forEach(button=>button.onclick=()=>WarTemplates.open(WarTemplates.list()[Number(button.dataset.customTemplate)],openExportChooser));
  document.querySelector('#choose-csv').onclick=()=>downloadCSV();
 }
 render=function(){existing.render();brandChrome();};
 redrawReview=function(){existing.redrawReview();addReviewNavigation();enforcePrimary();};
 const priorPoster=openPoster;openPoster=function(){priorPoster();const dialog=document.querySelector('#modal');dialog?.classList.add('brand-dialog');dialog?.querySelector('#poster-pdf')?.classList.add('brand-outline-primary');};
 init();
})();


