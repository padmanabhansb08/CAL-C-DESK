/* Approved UX direction: a guided organizer desk with one next action,
   progressive setup, focused score entry and familiar FFK branding. */
(function(root){
  const stages=['A','B','C','finals'];
  function next(s){
    const w=s.war;if(!w)return 'A';
    return ['A','B','C'].find(set=>!w.qualified[set])||'finals';
  }
  function progress(s,set){const w=s.war;return {played:s.matches.filter(m=>m.stage===set).length,target:w?.targets[set]||6,locked:!!w?.qualified[set]};}
  function mapForMatch(number){const rotation=['Bermuda','NexTerra','Purgatory','Kalahari','Solara'];return rotation[(Math.max(1,Math.floor(Number(number)||1))-1)%rotation.length];}
  if(typeof module!=='undefined'){module.exports={next,progress,mapForMatch};return;}
  root.WarGuide={next,progress,mapForMatch};
  let view=null,renderedPage=null,renderedStage=null;
  const w=()=>state.war||WarTournament.initial();
  const team=id=>state.teams.find(t=>t.id===id);
  const name=id=>team(id)?.name||'Awaiting qualifier';
  const label=set=>set==='C'?'Semi-final':set==='finals'?'CS finals':'Set '+set;
  const ms=(name,size='sm',extra='')=>`<span class="material-symbols-outlined icon-${size}" aria-hidden="true"${extra}>${name}</span>`;
  const iconMap={arrow:'arrow_forward',check:'check',shield:'security',cup:'emoji_events',plus:'add',file:'sports_esports',swap:'swap_horiz'};
  const icon=(type)=>ms(iconMap[type]||'chevron_right','sm');
  const action=(text,handler,primary=false,extra='')=>`<button class="guide-button ${primary?'guide-primary':''}" onclick="${handler}" ${extra}>${text}${primary?icon('arrow'):''}</button>`;
  function alert(message){const node=document.querySelector('#war-feedback');if(node){node.hidden=false;node.textContent=message;node.focus();}else toast(message,'error');}
  const withWar=()=>({...state,war:w()});
  function stageTabs(){
    const current=view||next(state),war=w();
    return `<nav class="guide-stages" aria-label="Tournament stages">${stages.map((set,i)=>{
      const done=set==='finals'?!!WarTournament.playoffResults(war).final:!!war.qualified[set],p=set==='finals'?null:progress(state,set);
      const text=done?'Completed':set==='finals'?(war.qualified.C?'Ready to play':'4 teams qualify'):set==='C'&&(!war.qualified.A||!war.qualified.B)?'After A + B':p.played+'/'+p.target+' matches';
      return `<button class="${current===set?'selected':''} ${done?'completed':''}" onclick="warTab('${set}')" ${current===set?'aria-current="step"':''}><span class="guide-step-dot">${done?icon('check'):String(i+1).padStart(2,'0')}</span><span><strong>${label(set)}</strong><small>${text}</small></span></button>`;
    }).join('')}</nav>`;
  }
  function head(kicker,title,description){return `<div class="guide-page-heading"><div><span class="guide-kicker">${kicker}</span><h1>${title}</h1><p>${description}</p></div>${page==='war'?'<button type="button" class="guide-reset" onclick="comfortResetWar()">↺ Reset the war</button>':'<span class="guide-live"><i></i> Organizer desk</span>'}</div>`;}
  let resetting=false;
  window.comfortResetWar=async()=>{
    if(busy||resetting)return toast('Wait for the current operation to finish.','error');
    const confirmed=await confirmAction({title:'Reset the war?',message:'This clears all saved BR matches, points tables, set lists, qualifiers and CS scores'+(draft?', plus your unfinished match draft':'')+'. Registered teams, players and learned name corrections are kept.',accept:'Reset the war',cancel:'Keep current war'});
    if(!confirmed||resetting)return;resetting=true;busy=true;
    const controls=[...document.querySelectorAll('.war-workspace button, .nav button')].filter(control=>!control.disabled);controls.forEach(control=>control.disabled=true);
    const button=document.querySelector('.guide-reset');if(button){button.disabled=true;button.textContent='Resetting…';}
    try{
      const clean={...state,matches:[],war:WarTournament.initial()};
      await api('state',clean);state=clean;draft=null;clearImages();root.clearDraftAfterWarReset?.();selected=null;tab='teams';view='A';page='war';busy=false;render();toast('War reset. Your teams are ready for a new war.');
    }catch(e){toast(e.message,'error');}
    finally{resetting=false;busy=false;controls.forEach(control=>{if(control.isConnected)control.disabled=false;});if(button?.isConnected){button.disabled=false;button.textContent='↺ Reset the war';}}
  };
  window.warTab=set=>{view=set;render();};
  window.comfortContinue=()=>{view=next(state);go('war');};
  const oldNew=warNew;
  window.warNew=set=>{
    if(busy)return toast('Wait for the current results to finish.','error');
    const p=progress(state,set);
    if(p.played>=p.target)return toast('All planned matches are saved. Confirm your qualifiers or change the match count.','error');
    oldNew(set);
    if(page==='upload'&&!draft&&document.querySelector('#war-stage')){
      document.querySelector('#war-stage').value=set;
      document.querySelector('#match-name').value='Set '+set+' · Match '+(p.played+1);
      root.ComfortForms?.mount();
    }
  };
  function stageView(set){
    const war=w(),s=withWar(),ids=(set==='C'||WarTournament.established(state,set))?WarTournament.members(war,set):[],p=progress(state,set),rows=WarTournament.standings(s,set),cut=set==='C'?4:6;
    const ready=ids.length===12&&new Set(ids).size===12&&ids.every(id=>team(id)),reached=p.played===p.target,edge=rows[cut-1],tie=rows[cut]&&edge&&['total','kills','wins','placementPoints'].every(k=>edge[k]===rows[cut][k]);
    const tied=tie?rows.filter(r=>['total','kills','wins','placementPoints'].every(k=>r[k]===edge[k])):[];
    let title,copy,cta;
    if(!ready){const canStart=set!=='C'&&WarTournament.availableTeams(state,set).length>=12;title=set==='C'?'Your semi-final is taking shape.':canStart?'Start Set '+set+' with its screenshots.':'Add your registered teams first.';copy=set==='C'?'Confirm the top 6 in both opening sets. Your 12 semi-finalists will appear here automatically.':canStart?'Upload the screenshots, verify the points table, and save. Those 12 teams automatically become Set '+set+'. No team allocation needed.':'Register at least 12 teams that are not already playing in the other opening set.';cta=set==='C'?action('Go to '+label(next(state)),"warTab('"+next(state)+"')",true):canStart?action('Add Set '+set+' screenshots',"warNew('"+set+"')",true):action('Open team roster',"go('roster')",true);}
    else if(p.locked){title='Set '+set+' is complete.';copy='The top '+cut+' are confirmed'+(set==='C'?' for Clash Squad.':' for the semi-final.')+' Saved results are protected.';const dest=next(state);cta=action(dest==='finals'?'Open CS finals':'Continue to '+label(dest),"warTab('"+dest+"')",true);}
    else if(reached){title='All results are in. Choose who advances.';copy='Review the standings'+(tie?' and resolve the cutoff tie':'')+', then confirm the top '+cut+'.';cta=action('Review top '+cut+" → "+(set==='C'?'finals':'semi-final'),"comfortQualify('"+set+"')",true);}
    else{title='Ready for match '+(p.played+1)+'?';copy='Add the result for Set '+set+'. We’ll calculate the points and update these standings.';cta=action('Add match '+(p.played+1)+' results',"warNew('"+set+"')",true);}
    const unplayed=ids.filter(id=>!rows.some(r=>r.teamId===id)),tableRows=[...rows,...unplayed.map(id=>({teamId:id,teamName:name(id),rank:'—',matches:0,kills:0,wins:0,total:0}))];
    return `<section class="guide-next"><div class="guide-next-icon">${icon(p.locked?'check':reached?'cup':'file')}</div><div class="guide-next-copy"><span class="guide-kicker">${p.locked?'STAGE COMPLETE':'YOUR NEXT STEP'}</span><h2>${title}</h2><p>${copy}</p></div>${cta}</section>
    ${!ready&&set!=='C'?`<section class="guide-card"><div class="guide-card-heading"><div><h2>Set ${set} team list</h2><p>Created from the 12 teams in your first saved points table.</p></div><span class="guide-tag">Waiting for results</span></div><details class="guide-disclosure"><summary>Scoring rules & match settings</summary><p>Placement points + kills + host adjustments. Top 6 advance to Set C.</p><div class="guide-settings"><label>Number of matches in Set ${set}<input id="war-target" type="number" min="1" max="99" value="${p.target}"></label>${action('Save match count',"warTarget('"+set+"')")}</div></details></section>`:''}
    ${ready?`<section class="guide-card"><div class="guide-card-heading"><div><h2>Set ${set} standings</h2><p>${set==='C'?'Semi-final · New points table':'Battle Royale'} <span>·</span> Top ${cut} advance</p></div><span class="guide-tag ${p.locked?'guide-tag-success':''}">${p.locked?icon('check')+' Qualifiers confirmed':p.played+' of '+p.target+' matches saved'}</span></div><div class="guide-progress"><span style="width:${Math.min(100,p.played/p.target*100)}%"></span></div>
    <div class="guide-table"><table><thead><tr><th>#</th><th>Team</th><th class="guide-table-extra">Played</th><th>Kills</th><th class="guide-table-extra">Wins</th><th>Points</th><th class="guide-table-status">Progress</th></tr></thead><tbody>${tableRows.map((r,i)=>`<tr class="${i===cut?'guide-cutoff':''} ${war.qualified[set]?.includes(r.teamId)?'guide-advanced':''}"><td>${r.rank}</td><td><span class="guide-team-name">${esc(r.teamName)}</span>${war.qualified[set]?.includes(r.teamId)?'<small class="guide-mobile-qualified">Qualified</small>':''}</td><td class="guide-table-extra">${r.matches}</td><td>${r.kills}</td><td class="guide-table-extra">${r.wins}</td><td class="guide-table-points">${r.total}</td><td class="guide-table-status">${war.qualified[set]?.includes(r.teamId)?'<span class="guide-qualified">'+icon('check')+' Qualified</span>':p.locked?'Finished':r.matches&&Number(r.rank)<=cut?'<span class="guide-tag">Above cutoff</span>':'—'}</td></tr>`).join('')}</tbody></table></div>
    <div class="guide-table-note"><span class="guide-cutoff-key"></span> Top ${cut} advance. ${p.played?'The dashed line marks the cutoff.':'Standings appear after the first match.'}</div>
    ${tied.length&&!p.locked?`<div class="guide-tie"><h3>One decision before you continue</h3><p>These teams have identical records at the cutoff. Choose ${cut-rows.filter(r=>r.rank<edge.rank).length} to advance and add your reason.</p><div>${tied.map(r=>`<label><input type="checkbox" data-war-tie value="${esc(r.teamId)}"><span>${esc(r.teamName)}</span></label>`).join('')}</div><label>Reason for your decision<input id="war-tie-reason" maxlength="200" placeholder="e.g. Winner of the tiebreak match"></label></div>`:''}
    <details class="guide-disclosure"><summary>Scoring rules & match settings</summary><p>Points → kills → wins → placement points. Every set starts at zero. Equal records share a rank. A host decision resolves qualification cutoff ties.</p><div class="guide-settings"><label>Number of matches in Set ${set}<input id="war-target" type="number" min="1" max="99" value="${p.target}" ${p.locked?'disabled':''}></label>${action('Save match count',"warTarget('"+set+"')",false,p.locked?'disabled':'')}</div>${p.locked?'<p>Reopen this set below if you need to correct a result.</p>':''}</details></section>`:''}
    ${ready?`<section class="guide-card guide-matches"><div class="guide-card-heading"><div><h2>Set ${set} matches</h2><p>Open a result to review players, points or adjustments.</p></div></div>${WarTournament.matches(s,set).map(m=>`<button class="guide-match-row" onclick="comfortResult('${esc(m.id)}')"><span class="guide-match-icon">${icon('file')}</span><span><strong>${esc(m.name)}</strong><small>${esc(m.map)} · ${m.rows.length} teams</small></span><span>View result ${icon('arrow')}</span></button>`).join('')||'<div class="guide-match-empty">Your saved matches will appear here.</div>'}</section>`:''}
    ${p.locked?`<details class="guide-disclosure guide-corrections"><summary>Need to correct this set?</summary><p>Reopening keeps BR matches and clears dependent qualifiers and CS results so you can correct the standings safely.</p>${action('Reopen Set '+set,"warReopen('"+set+"')")}</details>`:''}`;
  }
  window.comfortResult=id=>{selected=id;go('results');};
  window.comfortQualify=set=>{
    try{
      const choices=[...document.querySelectorAll('[data-war-tie]:checked')].map(el=>el.value),reason=document.querySelector('#war-tie-reason')?.value.trim();
      if(choices.length&&!reason)throw Error('Add a short reason for the tiebreak decision before continuing.');
      const winners=WarTournament.qualify(withWar(),set,choices);
      modal(`<div class="guide-dialog-heading"><span class="guide-kicker">CONFIRM QUALIFIERS</span><h2>${winners.length} teams. One step closer.</h2><p>These teams advance from Set ${set} to ${set==='C'?'the CS finals':'Set C, the semi-final'}.</p></div><ol class="guide-qualifier-list">${winners.map((id,i)=>`<li><span>${String(i+1).padStart(2,'0')}</span>${esc(name(id))}${icon('check')}</li>`).join('')}</ol><p class="guide-soft-note">Set ${set} results will be locked. You can reopen the set later if you need to make a correction.</p><div class="actions"><button onclick="closeModal()">Back to standings</button>${action('Confirm & advance',"comfortConfirmQualifiers('"+set+"')",true)}</div>`);
    }catch(e){alert(e.message);}
  };
  window.comfortConfirmQualifiers=async set=>{if(await warQualify(set)){closeModal();view=next(state);render();toast(w().qualified[set].length+' teams advanced from Set '+set+'.');}};
  function finalsView(){
    const war=w(),cs=WarTournament.playoffResults(war),ready=war.qualified.C?.length===4,completed=!!cs.final;
    const nextFixture=WarTournament.playoffKeys.find(key=>!cs[key])||'final',nextLabel=WarTournament.playoffLabels[nextFixture];
    const descriptions={q1:'The top two play first. The winner goes straight to the Grand Final; the loser gets a second chance.',eliminator:'Third plays fourth. The winner stays in the war; the loser is eliminated.',q2:'Qualifier 1’s loser meets the Eliminator’s winner. The winner takes the second Grand Final place.',final:'The winners of Qualifier 1 and Qualifier 2 play for the title.'};
    const history=[...(war.csHistory||[])];if(war.csFormat!==WarTournament.playoffFormat&&Object.keys(war.cs||{}).length)history.push({results:war.cs});
    return `${!ready?`<section class="guide-next"><div class="guide-next-icon">${icon('cup')}</div><div class="guide-next-copy"><span class="guide-kicker">THE FINAL FOUR</span><h2>The crown is waiting.</h2><p>Confirm the top 4 from Set C to unlock the Clash Squad playoffs.</p></div>${action('Open semi-final',"warTab('C')",true)}</section>`:''}
    ${completed?`<section class="guide-champion"><div class="guide-crown">${icon('cup')}</div><span class="guide-kicker">FFK WAR CHAMPION</span><h2>${esc(name(cs.final.winner))}</h2><p>Grand Final score <strong>${cs.final.scores.join(' – ')}</strong></p><span class="guide-tag">All stages complete</span></section>`:ready?`<section class="guide-next"><div class="guide-next-icon">${icon('cup')}</div><div class="guide-next-copy"><span class="guide-kicker">CLASH SQUAD / ${nextLabel.toUpperCase()}</span><h2>${nextFixture==='final'?'Two teams. One champion.':nextFixture==='q2'?'One last route to the final.':'Your final four are ready.'}</h2><p>${descriptions[nextFixture]}</p></div>${action('Enter '+nextLabel+' score',"comfortScore('"+nextFixture+"')",true)}</section>`:''}
    <div class="guide-playoffs"><section><h3>Opening matches</h3>${fixtureCard('q1','Qualifier 1',ready)}${fixtureCard('eliminator','Eliminator',ready)}</section><section><h3>Last chance</h3>${fixtureCard('q2','Qualifier 2',!!(cs.q1&&cs.eliminator))}</section><section><h3>The title match</h3>${fixtureCard('final','Grand Final',!!(cs.q1&&cs.q2))}</section></div>
    <details class="guide-disclosure"><summary>How CS playoffs work</summary><ol class="guide-playoff-rules"><li><strong>Qualifier 1 · #1 vs #2</strong><span>Winner → Grand Final. Loser → Qualifier 2.</span></li><li><strong>Eliminator · #3 vs #4</strong><span>Winner → Qualifier 2. Loser is eliminated.</span></li><li><strong>Qualifier 2</strong><span>Qualifier 1 loser vs Eliminator winner. Winner → Grand Final.</span></li><li><strong>Grand Final</strong><span>Qualifier 1 winner vs Qualifier 2 winner. Winner is champion.</span></li></ol><p>CS scores are separate from BR points.</p></details>
    ${history.length?`<details class="guide-disclosure"><summary>Previous finals format · saved scores</summary><p>These scores belong to the previous knockout format. They are kept for reference and do not advance teams in this bracket.</p>${history.flatMap(entry=>Object.entries(entry.results)).filter(([,r])=>r?.teams&&r?.scores).map(([key,r])=>`<div class="guide-history-score"><span>${key==='sf1'?'Previous semi-final 1':key==='sf2'?'Previous semi-final 2':'Previous final'}</span><strong>${esc(name(r.teams[0]))} ${r.scores[0]} – ${r.scores[1]} ${esc(name(r.teams[1]))}</strong></div>`).join('')}</details>`:''}`;
  }
  function fixtureCard(key,title,ready){
    const war=w(),cs=WarTournament.playoffResults(war),pair=WarTournament.fixture(war,key),r=cs[key];
    const pending={q1:['Set C rank #1','Set C rank #2'],eliminator:['Set C rank #3','Set C rank #4'],q2:['Loser of Qualifier 1','Winner of Eliminator'],final:['Winner of Qualifier 1','Winner of Qualifier 2']};
    const route={q1:'Winner → Grand Final · Loser → Qualifier 2',eliminator:'Winner → Qualifier 2 · Loser eliminated',q2:'Winner → Grand Final · Loser eliminated',final:'Winner → FFK War champion'};
    return `<article class="guide-fixture" data-fixture="${key}"><div><span>${title}</span><small>${r?'Completed':ready?'Ready to play':'Awaiting teams'}</small></div>${pair.map((id,i)=>`<div class="guide-fixture-team ${r?.winner===id?'winner':''}"><span>${esc(id?name(id):pending[key][i])}</span><strong>${r?r.scores[i]:'—'}</strong></div>`).join('')}<p class="guide-fixture-route">${route[key]}</p>${r&&key!=='q1'&&key!=='final'?'<p class="guide-eliminated">Eliminated: '+esc(name(r.loser))+'</p>':''}${ready?action(r?'Edit score':'Enter score',"comfortScore('"+key+"')"):''}${r?action('Clear result & dependent scores',"warClearCS('"+key+"')"):''}</article>`;
  }
  window.comfortScore=key=>{
    const war=w(),pair=WarTournament.fixture(war,key),r=WarTournament.playoffResults(war)[key];if(pair.some(id=>!id))return;
    const title=WarTournament.playoffLabels[key]+' score';
    modal(`<form id="guide-score-form"><div class="guide-dialog-heading"><span class="guide-kicker">CLASH SQUAD</span><h2>${title}</h2><p>Enter the final round or series score. The winner advances automatically.</p></div><div class="guide-score-pair">${pair.map((id,i)=>`<label><span>${esc(name(id))}</span><input id="${key}-${i?'b':'a'}" aria-label="${esc(name(id))} score" type="number" min="0" max="99" inputmode="numeric" required value="${r?.scores[i]??''}" placeholder="0"></label>`).join('<span class="guide-score-vs">vs</span>')}</div><p id="guide-score-preview" class="guide-score-preview" role="status">Enter both scores to see the winner.</p><p id="guide-score-error" class="guide-inline-error" role="alert" hidden></p><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button type="submit" class="guide-button guide-primary">Save score ${icon('check')}</button></div></form>`);
    const inputs=[...document.querySelectorAll('.guide-score-pair input')],preview=document.querySelector('#guide-score-preview');
    inputs.forEach(input=>input.oninput=()=>{const values=inputs.map(x=>x.value===''?null:Number(x.value));preview.textContent=values.some(x=>x===null)?'Enter both scores to see the winner.':values[0]===values[1]?'A CS match needs a winning score.':name(pair[values[0]>values[1]?0:1])+' wins '+Math.max(...values)+' – '+Math.min(...values);});
    document.querySelector('#guide-score-form').onsubmit=async event=>{
      event.preventDefault();const a=inputs[0].value,b=inputs[1].value,error=document.querySelector('#guide-score-error');
      if(a===''||b===''||Number(a)===Number(b)){error.hidden=false;error.textContent='Enter both scores. One team must have the higher score.';return;}
      if(await warScore(key)){closeModal();toast(key==='final'?'Champion confirmed. Your war is complete.':'Score saved. The winner has advanced.');}
    };
    inputs[0].focus();
  };
  function utilities(){
    return `<details class="guide-disclosure guide-tools"><summary>Teams & saved match tools</summary><div class="guide-tool-row"><div><strong>Teams come from saved results</strong><p>Select A or B and upload screenshots. The first verified points table defines that set’s 12 teams.</p></div>${action('Open roster',"go('roster')")}</div><details class="guide-disclosure"><summary>Assign an existing match to a set</summary><p>Choose a set for an earlier saved result. Its 12 teams define the set if it has no results yet.</p>${state.matches.map(m=>`<div class="war-match"><span>${esc(m.name)}<small>${m.stage?'Set '+m.stage:'Unassigned'}</small></span><select aria-label="Set for ${esc(m.name)}" data-war-link="${esc(m.id)}"><option value="">Unassigned</option>${['A','B','C'].map(set=>`<option value="${set}" ${m.stage===set?'selected':''}>Set ${set}</option>`).join('')}</select><button onclick="warLink('${esc(m.id)}')">Save</button></div>`).join('')||'<p>No saved matches yet.</p>'}</details></details>`;
  }
  window.renderWar=function(){
    const current=(view==='setup'?'A':view)||next(state);
    return `<div class="war-workspace">${head('FFK WAR / TOURNAMENT','Your war. Under control.','24 teams. Two opening sets. One champion. Take it one stage at a time.')}<p id="war-feedback" class="guide-inline-error" role="alert" tabindex="-1" hidden></p>${stageTabs()}${current==='finals'?finalsView():stageView(current)}${utilities()}</div>`;
  };
  overview=function(){
    const n=next(state),war=w(),completed=!!WarTournament.playoffResults(war).final;
    const stageProgress=n==='setup'?null:n==='finals'?null:progress(state,n);
    const latest=state.matches.slice().reverse().slice(0,5);
    const players=state.teams.reduce((acc,t)=>acc+(t.players?t.players.length:0),0);
    const totalKills=state.matches.reduce((acc,m)=>acc+m.rows.reduce((a,r)=>a+(r.players?r.players.reduce((b,p)=>b+(p.kills||0),0):0),0),0);
    const nextMap=mapForMatch((stageProgress?stageProgress.played:0)+1);
    const stagePct=stageProgress&&stageProgress.target?Math.min(100,Math.round((stageProgress.played/stageProgress.target)*100)):completed?100:0;

    let resume='';
    try{
      if(JSON.parse(localStorage.getItem('ffk-match-draft-v1')||'null')?.draft){
        resume=`<div class="cmd-draft-alert">
          <div class="cmd-draft-info">
            <span class="material-symbols-outlined icon-md cmd-draft-icon">pending_actions</span>
            <div>
              <strong>Unsaved match review in progress</strong>
              <small>Screenshot crops and team allocations are saved on this workstation.</small>
            </div>
          </div>
          <button class="cmd-btn cmd-btn-primary" onclick="resumeMatchDraft()">
            <span class="material-symbols-outlined icon-sm">play_arrow</span>
            <span>Resume review</span>
          </button>
        </div>`;
      }
    }catch(e){}

    const stageStatusText=completed?'WAR CHAMPION CONFIRMED':n==='setup'?'TEAMS READY FOR ALLOCATION':n==='finals'?'CLASH SQUAD PLAYOFFS':'STAGE ACTIVE';
    const stageBadgeClass=completed?'is-complete':n==='setup'?'is-setup':'is-live';
    const stageActionLabel=completed?'View final standings':n==='setup'?'Set up war stages':n==='finals'?'Open CS playoffs':'Record Match '+(stageProgress?stageProgress.played+1:1)+' ('+nextMap+')';
    const stageActionFn=completed?"go(\'results\')":n==='setup'?"go(\'war\')":n==='finals'?"go(\'war\')":`warNew('${n}')`;

    return `<div class="cmd-dashboard">
      <header class="cmd-header">
        <div class="cmd-title-group">
          <div class="cmd-eyebrow">
            <span class="cmd-eyebrow-brand">FFK PRASANTH</span>
            <span class="cmd-eyebrow-sep">/</span>
            <span>TOURNAMENT OPERATIONS</span>
          </div>
          <h1 class="cmd-title">OPERATIONS COMMAND DESK</h1>
          <p class="cmd-subtitle">Free Fire Season 11 · 24-Team War Format · Real-time standings & match coordination</p>
        </div>
        <div class="cmd-header-actions">
          <button class="cmd-btn cmd-btn-secondary" onclick="openHostAccess()">
            <span class="material-symbols-outlined icon-sm">manage_accounts</span>
            <span>Host desk</span>
          </button>
          <button class="cmd-btn cmd-btn-primary" onclick="${stageActionFn}">
            <span class="material-symbols-outlined icon-sm">${completed?'leaderboard':n==='finals'?'emoji_events':'add'}</span>
            <span>${stageActionLabel}</span>
          </button>
        </div>
      </header>

      ${resume}

      <section class="cmd-kpi-grid" aria-label="Tournament key performance indicators">
        <div class="cmd-kpi-card">
          <div class="cmd-kpi-header">
            <span class="cmd-kpi-label">REGISTERED TEAMS</span>
            <span class="material-symbols-outlined icon-sm cmd-kpi-icon">groups</span>
          </div>
          <div class="cmd-kpi-value">${state.teams.length}<span class="cmd-kpi-denom">/ 24</span></div>
          <div class="cmd-kpi-meta">${state.teams.length>=24?'Full 24-team war roster ready':'War Lists 1 & 2 in preparation'}</div>
        </div>
        <div class="cmd-kpi-card">
          <div class="cmd-kpi-header">
            <span class="cmd-kpi-label">PLAYERS READY</span>
            <span class="material-symbols-outlined icon-sm cmd-kpi-icon">person</span>
          </div>
          <div class="cmd-kpi-value">${players}</div>
          <div class="cmd-kpi-meta">4 starters + 1 substitute per squad</div>
        </div>
        <div class="cmd-kpi-card">
          <div class="cmd-kpi-header">
            <span class="cmd-kpi-label">VERIFIED MATCHES</span>
            <span class="material-symbols-outlined icon-sm cmd-kpi-icon">sports_esports</span>
          </div>
          <div class="cmd-kpi-value">${state.matches.length}</div>
          <div class="cmd-kpi-meta">${state.matches.length?state.matches.length+' saved results across stages':'Waiting for initial drop'}</div>
        </div>
        <div class="cmd-kpi-card">
          <div class="cmd-kpi-header">
            <span class="cmd-kpi-label">ELIMINATIONS LOGGED</span>
            <span class="material-symbols-outlined icon-sm cmd-kpi-icon">military_tech</span>
          </div>
          <div class="cmd-kpi-value">${totalKills}</div>
          <div class="cmd-kpi-meta">1 elimination = 1 tournament point</div>
        </div>
      </section>

      <div class="cmd-deck-grid">
        <div class="cmd-deck-main">
          <section class="cmd-panel cmd-active-stage" aria-labelledby="cmd-active-stage-title">
            <div class="cmd-panel-head">
              <div>
                <span class="cmd-panel-kicker">ACTIVE TOURNAMENT PHASE</span>
                <h2 id="cmd-active-stage-title">${completed?'Season 11 Champion Confirmed':n==='setup'?'Tournament Initialization':label(n)+' Tournament Stage'}</h2>
              </div>
              <span class="cmd-status-badge ${stageBadgeClass}">
                <span class="cmd-badge-dot" aria-hidden="true"></span>
                ${stageStatusText}
              </span>
            </div>
            <div class="cmd-stage-body">
              <div class="cmd-stage-progress-wrap">
                <div class="cmd-stage-progress-labels">
                  <span>Match completion</span>
                  <strong>${stageProgress?stageProgress.played+' of '+stageProgress.target+' matches recorded ('+stagePct+'%)':completed?'Playoffs concluded':'Initialization ready'}</strong>
                </div>
                <div class="cmd-progress-bar" role="progressbar" aria-valuenow="${stagePct}" aria-valuemin="0" aria-valuemax="100">
                  <div class="cmd-progress-fill" style="width: ${stagePct}%"></div>
                </div>
              </div>
              <div class="cmd-stage-intel">
                <div class="cmd-intel-item">
                  <span class="material-symbols-outlined icon-sm">explore</span>
                  <div>
                    <small>Next Drop Map</small>
                    <strong>${nextMap}</strong>
                  </div>
                </div>
                <div class="cmd-intel-item">
                  <span class="material-symbols-outlined icon-sm">flag</span>
                  <div>
                    <small>Stage Target</small>
                    <strong>${stageProgress?stageProgress.target+' BR matches':'4-Team CS Bracket'}</strong>
                  </div>
                </div>
                <div class="cmd-intel-item">
                  <span class="material-symbols-outlined icon-sm">verified</span>
                  <div>
                    <small>Advancement</small>
                    <strong>${n==='C'?'Top 4 to Grand Final':n==='finals'?'1 Champion':'Top 6 to Semi-finals'}</strong>
                  </div>
                </div>
              </div>
            </div>
            <div class="cmd-panel-actions">
              <button class="cmd-btn cmd-btn-primary" onclick="${stageActionFn}">
                <span class="material-symbols-outlined icon-sm">${completed?'leaderboard':n==='finals'?'emoji_events':'add'}</span>
                <span>${stageActionLabel}</span>
              </button>
              <button class="cmd-btn cmd-btn-ghost" onclick="go(\'war\')">
                <span class="material-symbols-outlined icon-sm">tune</span>
                <span>Stage management</span>
              </button>
            </div>
          </section>

          <section class="cmd-panel cmd-matches-panel" aria-labelledby="cmd-matches-title">
            <div class="cmd-panel-head">
              <div>
                <span class="cmd-panel-kicker">MATCH COORDINATION</span>
                <h2 id="cmd-matches-title">Recent matches</h2>
              </div>
              ${latest.length?`<button class="cmd-link-btn" onclick="go(\'results\')"><span>View all matches</span> <span class="material-symbols-outlined icon-sm">arrow_forward</span></button>`:''}
            </div>
            ${latest.length ? `
              <div class="cmd-match-list">
                ${latest.map(m => {
                  const winner = m.rows ? m.rows.find(r => r.placement === 1) : null;
                  const elims = m.rows ? m.rows.reduce((acc, r) => acc + (r.players ? r.players.reduce((b, p) => b + (p.kills || 0), 0) : 0), 0) : 0;
                  const dateStr = m.created ? new Date(m.created).toLocaleDateString('en-IN') : '';
                  return `<button class="cmd-match-card" onclick="comfortResult(\'${esc(m.id)}\')">
                    <div class="cmd-match-meta">
                      <div class="cmd-match-badge-wrap">
                        <span class="cmd-map-pill">${esc(m.map || 'Bermuda')}</span>
                        ${m.stage ? `<span class="cmd-stage-pill">Set ${esc(m.stage)}</span>` : ''}
                      </div>
                      <strong class="cmd-match-name">${esc(m.name)}</strong>
                      <div class="cmd-match-sub">${m.rows ? m.rows.length : 12} teams · ${elims} eliminations${dateStr ? ' · ' + dateStr : ''}</div>
                    </div>
                    ${winner ? `
                      <div class="cmd-match-winner">
                        <span class="cmd-booyah-tag">
                          <span class="material-symbols-outlined icon-xs">emoji_events</span>
                          BOOYAH
                        </span>
                        <strong>${esc(winner.teamName || 'Winner pending')}</strong>
                      </div>
                    ` : ''}
                    <span class="material-symbols-outlined icon-sm cmd-match-arrow">chevron_right</span>
                  </button>`;
                }).join('')}
              </div>
            ` : `
              <div class="cmd-empty-state">
                <span class="material-symbols-outlined icon-xl cmd-empty-icon">sports_esports</span>
                <h3>No matches recorded yet</h3>
                <p>24 teams from War Lists 1 and 2 are registered. Match 1 is scheduled on <strong>${nextMap}</strong>. Once the drop is finished, upload screenshot results or enter scores manually to begin standings.</p>
                <div class="cmd-empty-actions">
                  <button class="cmd-btn cmd-btn-primary" onclick="${n==='finals'?'go(\'war\')':'warNew(\'" + n + "\')'}">
                    <span class="material-symbols-outlined icon-sm">add</span>
                    <span>Record Match 1 (${nextMap})</span>
                  </button>
                  <button class="cmd-btn cmd-btn-ghost" onclick="go(\'roster\')">
                    <span class="material-symbols-outlined icon-sm">groups</span>
                    <span>View 24 team rosters</span>
                  </button>
                </div>
              </div>
            `}
          </section>
        </div>

        <aside class="cmd-deck-aside">
          <section class="cmd-panel cmd-actions-panel" aria-labelledby="cmd-actions-title">
            <div class="cmd-panel-head">
              <div>
                <span class="cmd-panel-kicker">SHORTCUTS</span>
                <h2 id="cmd-actions-title">Quick operations</h2>
              </div>
            </div>
            <div class="cmd-action-grid">
              <button class="cmd-action-card" onclick="go(\'upload\')">
                <span class="material-symbols-outlined icon-md cmd-action-icon">upload_file</span>
                <div class="cmd-action-content">
                  <strong>Record match</strong>
                  <small>Screenshot OCR intake & score review</small>
                </div>
                <span class="material-symbols-outlined icon-sm cmd-action-arrow">chevron_right</span>
              </button>
              <button class="cmd-action-card" onclick="go(\'war\')">
                <span class="material-symbols-outlined icon-md cmd-action-icon">emoji_events</span>
                <div class="cmd-action-content">
                  <strong>War stage manager</strong>
                  <small>Sets A/B/C tracking & qualification rules</small>
                </div>
                <span class="material-symbols-outlined icon-sm cmd-action-arrow">chevron_right</span>
              </button>
              <button class="cmd-action-card" onclick="go(\'roster\')">
                <span class="material-symbols-outlined icon-md cmd-action-icon">groups</span>
                <div class="cmd-action-content">
                  <strong>Team rosters</strong>
                  <small>Inspect 24 squads, captains & players</small>
                </div>
                <span class="material-symbols-outlined icon-sm cmd-action-arrow">chevron_right</span>
              </button>
              <button class="cmd-action-card" onclick="go(\'results\')">
                <span class="material-symbols-outlined icon-md cmd-action-icon">leaderboard</span>
                <div class="cmd-action-content">
                  <strong>Championship standings</strong>
                  <small>Overall points, top fraggers & CSV export</small>
                </div>
                <span class="material-symbols-outlined icon-sm cmd-action-arrow">chevron_right</span>
              </button>
              <button class="cmd-action-card" onclick="openHostAccess()">
                <span class="material-symbols-outlined icon-md cmd-action-icon">cast</span>
                <div class="cmd-action-content">
                  <strong>Host & broadcast desk</strong>
                  <small>Read-only OBS links & caster talking points</small>
                </div>
                <span class="material-symbols-outlined icon-sm cmd-action-arrow">open_in_new</span>
              </button>
            </div>
          </section>

          <section class="cmd-panel cmd-status-panel" aria-labelledby="cmd-telemetry-title">
            <div class="cmd-panel-head">
              <div>
                <span class="cmd-panel-kicker">TELEMETRY</span>
                <h2 id="cmd-telemetry-title">System readiness</h2>
              </div>
            </div>
            <div class="cmd-status-list">
              <div class="cmd-status-row">
                <span class="cmd-status-dot is-good"></span>
                <div class="cmd-status-info">
                  <strong>Rosters deployed</strong>
                  <small>${state.teams.length} teams registered across War Lists 1 & 2</small>
                </div>
                <span class="cmd-status-pill">${state.teams.length>=24?'READY':'IN PROGRESS'}</span>
              </div>
              <div class="cmd-status-row">
                <span class="cmd-status-dot is-good"></span>
                <div class="cmd-status-info">
                  <strong>Scoring engine</strong>
                  <small>Placement (12,9,8,7...) + 1 pt/kill + adjustments</small>
                </div>
                <span class="cmd-status-pill">ACTIVE</span>
              </div>
              <div class="cmd-status-row">
                <span class="cmd-status-dot is-good"></span>
                <div class="cmd-status-info">
                  <strong>Host desk link</strong>
                  <small>Caster interface & OBS 1080p browser source</small>
                </div>
                <span class="cmd-status-pill">ONLINE</span>
              </div>
              <div class="cmd-status-row">
                <span class="cmd-status-dot ${state.matches.length?'is-good':'is-standby'}"></span>
                <div class="cmd-status-info">
                  <strong>Tournament status</strong>
                  <small>${completed?'All stages completed':label(n)+' active'}</small>
                </div>
                <span class="cmd-status-pill">${completed?'COMPLETE':label(n).toUpperCase()}</span>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>`;  };
  const oldRender=render;
  render=function(){oldRender();mount();};
  function mount(){
    const shell=document.querySelector('.channel-shell');if(!shell)return;shell.classList.add('comfort-shell');
    const nav=shell.querySelector('.nav'),buttons=[...nav.querySelectorAll('button')];
    const entries=[['overview','Overview'],['war','War manager'],['roster','Team roster'],['upload','Record match'],['results','Standings']];
    for(const [id,text] of entries){const button=buttons.find(b=>b.getAttribute('onclick')===`go('${id}')`);if(!button)continue;
      [...button.childNodes].filter(n=>n.nodeType===3).forEach(n=>n.remove());const span=document.createElement('span');span.className='comfort-nav-label';span.textContent=text;button.append(span);button.querySelector('small')?.remove();button.setAttribute('aria-current',page===id?'page':'false');nav.append(button);
    }
    if(!document.querySelector('.comfort-sidebar-note')){const note=document.createElement('div');note.className='comfort-sidebar-note';note.innerHTML=ms('security','sm')+'<span>Tournament operations<small>Strict scoring & verified rules</small></span>';nav.after(note);}
    const top=shell.querySelector('.topbar');top.querySelector('.insights-ticker')?.remove();
    if(!top.querySelector('.comfort-top-title')){const title=document.createElement('span');title.className='comfort-top-title';title.innerHTML=`<span>FFK WAR DESK</span><strong>${({overview:'Operations desk',war:'War manager',roster:'Team roster',upload:'Record match',results:'Standings'})[page]||'Workspace'}</strong>`;top.prepend(title);}
    const sync=top.querySelector('.sync-button');if(sync){sync.setAttribute('aria-label','Refresh saved data');sync.title='Refresh saved data';}
    const content=document.querySelector('.content');content?.querySelectorAll('.guide-primary').forEach(button=>{button.classList.remove('brand-outline-primary');button.classList.add('brand-main-action');});
    if(page==='roster'){
      const heading=content.querySelector('.heading h1');if(heading)heading.textContent='Your teams';
      const intro=content.querySelector(':scope > p:not([id])');if(intro)intro.textContent='Keep team and player names up to date. Use the exact in-game names to make result checking easier.';
      const register=content.querySelector('.heading .primary');if(register)register.innerHTML=ms('add','sm')+' <span>Register team</span>';
    }
    const add=nav.querySelector('[onclick="go(\'upload\')"]');if(add&&!draft)add.onclick=()=>{
      const set=next(state);if(['A','B','C'].includes(set)&&WarTournament.availableTeams(state,set).length>=12&&!progress(state,set).locked&&progress(state,set).played<progress(state,set).target)return warNew(set);
      go('upload');
    };
    root.ComfortForms?.mount();
    const stage=page==='war'?((view==='setup'?'A':view)||next(state)):null;
    if(renderedPage!==page||(page==='war'&&renderedStage!==stage)){
      window.scrollTo({top:0,behavior:'instant'});const title=content?.querySelector('h1');if(title){title.tabIndex=-1;title.focus({preventScroll:true});}
    }
    renderedPage=page;renderedStage=stage;
  }
  root.ComfortDesk={mount};
  const oldAuth=auth;
  auth=function(setup){
    oldAuth(setup);const panel=document.querySelector('.auth'),form=document.querySelector('#login');if(!panel||!form)return;
    panel.classList.add('comfort-auth');panel.querySelector('h1').textContent=setup?'Your war starts here.':'Welcome back.';
    const intro=panel.querySelector('h1 + p');if(intro)intro.textContent=setup?'Create your organizer password. Then we’ll guide you through teams, matches and the finals.':'Sign in to your organizer desk. Your teams and saved results will be ready.';
    const field=form.querySelector('input[type=password]'),label=field?.closest('label');if(!field||!label)return;
    const wrapper=document.createElement('div');wrapper.className='comfort-password';field.before(wrapper);wrapper.append(field);
    const reveal=document.createElement('button');reveal.type='button';reveal.textContent='Show';reveal.setAttribute('aria-label','Show organizer password');reveal.setAttribute('aria-pressed','false');
    reveal.onclick=()=>{const shown=field.type==='password';field.type=shown?'text':'password';reveal.textContent=shown?'Hide':'Show';reveal.setAttribute('aria-label',shown?'Hide organizer password':'Show organizer password');reveal.setAttribute('aria-pressed',String(shown));};wrapper.append(reveal);
    const helper=document.createElement('p');helper.className='comfort-auth-help';helper.textContent=setup?'Use at least 10 characters. Keep this password for your organizer access.':'Only the organizer can change teams, results and qualification.';label.after(helper);
    const submit=form.querySelector('button.primary');if(submit)submit.textContent=setup?'Create organizer desk →':'Open my war desk →';
  };
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.querySelector('#modal')?.open)closeModal();});
})(typeof window==='undefined'?globalThis:window);
