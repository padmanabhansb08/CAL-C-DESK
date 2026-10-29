/* Tournament page: the whole event at a glance. Each screen leads with where the war stands and
   the next action, then the standings or bracket. No pep talk; the information is the interface. */
(function(root){
  const STAGES=['A','B','C','finals'];
  function next(s){
    const w=s.war;if(!w)return 'A';
    return ['A','B','C'].find(set=>!w.qualified[set])||'finals';
  }
  function progress(s,set){const w=s.war;return {played:s.matches.filter(m=>m.stage===set).length,target:w?.targets[set]||6,locked:!!w?.qualified[set]};}
  function mapForMatch(number){const rotation=['Bermuda','NexTerra','Purgatory','Kalahari','Solara'];return rotation[(Math.max(1,Math.floor(Number(number)||1))-1)%rotation.length];}
  if(typeof module!=='undefined'){module.exports={next,progress,mapForMatch};return;}
  root.WarGuide={next,progress,mapForMatch};

  let view=null;
  const w=()=>state.war||WarTournament.initial();
  const team=id=>state.teams.find(t=>t.id===id);
  const name=id=>team(id)?.name||'To be decided';
  const label=set=>set==='C'?'Semi-final':set==='finals'?'Finals':'Set '+set;
  const cutOf=set=>set==='C'?4:6;
  const SVG=d=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const ICON={check:SVG('m5 12 4 4L19 6'),cup:SVG('M8 3h8v6a4 4 0 0 1-8 0V3m0 2H3v3a4 4 0 0 0 5 4m8-7h5v3a4 4 0 0 1-5 4m-4 1v7m-5 1h10')};
  const action=(text,handler,primary=false,extra='')=>`<button type="button" class="${primary?'primary brand-main-action':''}" onclick="${handler}" ${extra}>${text}</button>`;
  function alert(message){const node=document.querySelector('#war-feedback');if(node){node.hidden=false;node.textContent=message;node.focus();}else toast(message,'error');}
  const withWar=()=>({...state,war:w()});
  const ready=set=>{const ids=(set==='C'||WarTournament.established(state,set))?WarTournament.members(w(),set):[];return ids.length===12&&new Set(ids).size===12&&ids.every(id=>team(id));};

  // An organizer with a few matches behind them does not need explanations repeated.
  const veteran=()=>state.matches.length>=3;
  const draftInfo=()=>{try{const stored=JSON.parse(localStorage.getItem('ffk-match-draft-v1')||'null');if(stored?.draft){const d=stored.draft;return {name:d.name||'Untitled',done:(d.rows||[]).filter(r=>r.confirmed).length};}}catch{}return null;};
  const TIE_KEYS=['total','kills','wins','placementPoints'];
  function tiedAt(set){const rows=WarTournament.standings(withWar(),set),cut=cutOf(set),edge=rows[cut-1];if(!edge||!rows[cut]||!TIE_KEYS.every(k=>edge[k]===rows[cut][k]))return [];return rows.filter(r=>TIE_KEYS.every(k=>r[k]===edge[k]));}
  // Everything that needs the organizer, in one list, each with the button that fixes it.
  function attention(current){
    const items=[],d=draftInfo(),p=current==='finals'?null:progress(state,current),loose=state.matches.filter(m=>!m.stage).length;
    if(d)items.push({text:`Unfinished match: ${d.name} · ${d.done} of 12 teams checked`,label:'Resume',on:'resumeMatchDraft()'});
    if(p&&!p.locked&&ready(current)&&p.played>=p.target&&tiedAt(current).length)items.push({text:`${label(current)} has a tie at the cutoff`,label:'Resolve',on:"document.querySelector('#tie-title')?.scrollIntoView({behavior:'smooth',block:'center'})"});
    if(p&&!p.locked&&loose)items.push({text:`${loose} saved match${loose>1?'es are':' is'} not in a set, so ${loose>1?'they do':'it does'} not count`,label:'Assign',on:"document.querySelector('#loose-matches')?.scrollIntoView({behavior:'smooth',block:'center'})"});
    return items;
  }
  const attentionList=items=>items.length?`<section class="war-attention" aria-labelledby="attention-title"><h2 id="attention-title">Needs attention <span>${items.length}</span></h2><ul>${items.map(i=>`<li><span>${esc(i.text)}</span><button type="button" onclick="${i.on}">${i.label}</button></li>`).join('')}</ul></section>`:'';
  // The operational picture in four numbers: where we are, what is left, what is locked, what is waiting on me.
  function facts(current,items){
    const war=w(),cs=WarTournament.playoffResults(war),locked=['A','B','C'].filter(set=>war.qualified[set]).length,p=current==='finals'?null:progress(state,current);
    const decided=WarTournament.playoffKeys.filter(k=>cs[k]).length,cell=(k,v,sub)=>`<div><dt>${k}</dt><dd>${v}</dd><small>${sub}</small></div>`;
    return `<dl class="war-facts" aria-label="Tournament summary">${cell('Stage',label(current),current==='finals'?(cs.final?'Complete':'Clash Squad'):p.locked?'Top '+cutOf(current)+' confirmed':'Battle royale')}${cell('Matches',current==='finals'?decided+'/4':p.played+'/'+p.target,current==='finals'?'finals matches decided':p.locked?'all saved':(p.target-p.played)+' left to play')}${cell('Confirmed',locked+'/3','sets locked')}${cell('Needs attention',items.length||'None',items.length?'listed below':'nothing waiting')}</dl>`;
  }
  const assignRow=m=>`<div class="war-match-assign"><span>${esc(m.name)}<small>${m.stage?'Set '+m.stage:'Not in a set'}</small></span><select aria-label="Set for ${esc(m.name)}" data-war-link="${esc(m.id)}"><option value="">Practice</option>${['A','B','C'].map(set=>`<option value="${set}" ${m.stage===set?'selected':''}>Set ${set}</option>`).join('')}</select><button type="button" onclick="warLink('${esc(m.id)}')">Save</button></div>`;

  // One line that says where a stage stands, and the one action that moves it forward.
  function status(set){
    const war=w();
    if(set==='finals'){
      const cs=WarTournament.playoffResults(war);
      if(cs.final)return {meta:`Finals · complete · ${name(cs.final.winner)} won the Grand Final ${cs.final.scores.join('–')}`,action:null};
      if(war.qualified.C?.length!==4)return {meta:'Finals · waiting for the top 4 from the semi-final',action:action('Open the semi-final',"warTab('C')",true)};
      const key=WarTournament.playoffKeys.find(k=>!cs[k]),title=WarTournament.playoffLabels[key];
      return {meta:`Finals · Next: ${title}`,action:action(`Enter ${title} score`,`comfortScore('${key}')`,true)};
    }
    const p=progress(state,set),cut=cutOf(set);
    if(p.locked){const dest=next(state);return {meta:`${label(set)} · complete · top ${cut} confirmed`,action:action(`Continue to ${label(dest)}`,`warTab('${dest}')`,true)};}
    if(!ready(set)){
      if(set==='C')return {meta:'Semi-final · waiting for the top 6 from Set A and Set B',action:action(`Open ${label(next(state))}`,`warTab('${next(state)}')`,true)};
      if(WarTournament.availableTeams(state,set).length<12)return {meta:`${label(set)} · needs 12 teams that are not playing in the other set`,action:action('Open teams',"go('roster')",true)};
      return {meta:`${label(set)} · not started · ${p.target} matches planned`,action:action(`Add ${label(set)} match 1`,`warNew('${set}')`,true)};
    }
    if(p.played>=p.target)return {meta:`${label(set)} · ${p.played}/${p.target} matches · Next: confirm the top ${cut}`,action:action(`Review the top ${cut}`,`comfortQualify('${set}')`,true)};
    return {meta:`${label(set)} · ${p.played}/${p.target} matches · Next: match ${p.played+1}`,action:action(`Add match ${p.played+1}`,`warNew('${set}')`,true)};
  }

  // Set A → Set B → Semi-final → Finals, connected, with done / current / upcoming states.
  function stageStrip(compact=false){
    const war=w(),current=next(state),viewed=view||current,cs=WarTournament.playoffResults(war);
    return `<ol class="stage-strip${compact?' is-compact':''}" aria-label="Tournament stages">${STAGES.map(set=>{
      const done=set==='finals'?!!cs.final:!!war.qualified[set],state_=done?'done':set===current?'current':'upcoming',p=set==='finals'?null:progress(state,set);
      const sub=done?(set==='finals'?'Champion crowned':'Complete'):set==='finals'?(war.qualified.C?'Playing now':'Top 4 from semi-final'):set==='C'&&!ready('C')?'After Set A and Set B':`${p.played}/${p.target} matches`;
      const marker=done?ICON.check:set==='finals'?ICON.cup:'';
      const inner=`<span class="stage-marker">${marker}</span><span class="stage-text"><strong>${label(set)}</strong><small>${sub}</small></span>`;
      return `<li class="stage is-${state_}${!compact&&viewed===set?' is-viewed':''}">${compact?`<span class="stage-item">${inner}</span>`:`<button type="button" onclick="warTab('${set}')" ${viewed===set?'aria-current="step"':''} aria-label="${label(set)}: ${sub}">${inner}</button>`}</li>`;
    }).join('')}</ol>`;
  }
  function pageHead(title,meta,act){
    return `<header class="page-head"><div><h1>${title}</h1><p class="page-meta">${esc(meta)}</p></div>${act?`<div class="page-actions">${act}</div>`:''}</header>`;
  }

  let resetting=false;
  window.comfortResetWar=async()=>{
    if(busy||resetting)return toast('Wait for the current operation to finish.','warning');
    const confirmed=await confirmAction({title:'Reset the war?',message:'This clears all saved BR matches, points tables, set lists, qualifiers and CS scores'+(draft?', plus your unfinished match draft':'')+'. Registered teams, players and learned name corrections are kept.',accept:'Reset the war',cancel:'Keep current war'});
    if(!confirmed||resetting)return;resetting=true;busy=true;
    const controls=[...document.querySelectorAll('.war-workspace button, .nav button')].filter(control=>!control.disabled);controls.forEach(control=>control.disabled=true);
    const button=document.querySelector('.war-reset');if(button){button.disabled=true;button.textContent='Resetting…';}
    try{
      const clean={...state,matches:[],war:WarTournament.initial()};
      await api('state',clean);state=clean;draft=null;clearImages();root.clearDraftAfterWarReset?.();selected=null;tab='teams';view='A';page='war';busy=false;render();toast('War reset. Your teams are ready for a new war.');
    }catch(e){toast(e.message,'error');}
    finally{resetting=false;busy=false;controls.forEach(control=>{if(control.isConnected)control.disabled=false;});if(button?.isConnected){button.disabled=false;button.textContent='Reset the war…';}}
  };
  window.warTab=set=>{view=set;render();};
  window.comfortContinue=()=>{view=next(state);go('war');};
  const oldNew=warNew;
  window.warNew=async set=>{
    if(busy)return toast('Wait for the current results to finish.','warning');
    const p=progress(state,set);
    if(p.played>=p.target)return toast('All planned matches are saved. Confirm your qualifiers or change the match count.','error');
    await oldNew(set);
    if(page==='upload'&&!draft&&document.querySelector('#war-stage')){
      const stage=document.querySelector('#war-stage');stage.value=set;stage.dispatchEvent(new Event('change'));
      document.querySelector('#match-name').value='Set '+set+' · Match '+(p.played+1);
    }
  };

  function standingsRows(set){
    const war=w(),s=withWar(),ids=WarTournament.members(war,set),rows=WarTournament.standings(s,set);
    const unplayed=ids.filter(id=>!rows.some(r=>r.teamId===id));
    return [...rows,...unplayed.map(id=>({teamId:id,teamName:name(id),rank:'—',matches:0,kills:0,wins:0,total:0}))];
  }
  function standingsTable(set,limit){
    const war=w(),p=progress(state,set),cut=cutOf(set),rows=standingsRows(set).slice(0,limit||Infinity),qualified=war.qualified[set]||[];
    return `<div class="table-wrap war-table-wrap"><table class="war-table"><thead><tr><th scope="col">#</th><th scope="col">Team</th><th scope="col" class="col-extra">Played</th><th scope="col">Kills</th><th scope="col" class="col-extra">Wins</th><th scope="col">Points</th><th scope="col" class="col-status"><span class="sr-only">Status</span></th></tr></thead><tbody>${rows.map((r,i)=>{
      const q=qualified.includes(r.teamId),through=q||(!p.locked&&r.matches&&Number(r.rank)<=cut);
      return `<tr class="${i===cut?'is-cutoff ':''}${q?'is-qualified':''}"><td class="rank">${r.rank}</td><td class="team-cell">${esc(r.teamName)}</td><td class="col-extra">${r.matches}</td><td>${r.kills}</td><td class="col-extra">${r.wins}</td><td class="total">${r.total}</td><td class="col-status">${q?`<span class="tag tag-ok">${ICON.check}Qualified</span>`:through?'<span class="tag">In the top '+cut+'</span>':''}</td></tr>`;}).join('')}</tbody></table></div>`;
  }
  function stageView(set){
    const war=w(),s=withWar(),p=progress(state,set),cut=cutOf(set),rows=WarTournament.standings(s,set);
    const edge=rows[cut-1],tie=rows[cut]&&edge&&['total','kills','wins','placementPoints'].every(k=>edge[k]===rows[cut][k]);
    const tied=tie?rows.filter(r=>['total','kills','wins','placementPoints'].every(k=>r[k]===edge[k])):[];
    const matches=WarTournament.matches(s,set);
    const settings=`<div class="war-setting war-count"><label>Matches in ${label(set)}<input id="war-target" type="number" min="1" max="99" value="${p.target}" ${p.locked?'disabled':''}></label>${action('Save match count',"warTarget('"+set+"')",false,p.locked?'disabled':'')}${p.locked?action('Reopen '+label(set),"warReopen('"+set+"')",false,'title="Reopening keeps the BR matches and clears the qualifiers and finals results that depend on them."'):''}</div>`;
    const loose=state.matches.filter(m=>!m.stage),assign=loose.length&&!p.locked?`<section class="war-section" id="loose-matches" aria-labelledby="loose-title"><div class="section-head"><h2 id="loose-title">Not in a set</h2><p>Assign them so they count</p></div>${loose.map(assignRow).join('')}</section>`:'';
    if(!ready(set))return `<section class="war-section war-empty"><p>${set==='C'?'The 12 semi-finalists appear here when the top 6 of Set A and Set B are confirmed.':`The 12 teams in the first saved ${label(set)} result become this set’s team list.${veteran()?'':' No allocation needed.'}`}</p></section>${set==='C'?'':settings}${assign}`;
    return `<section class="war-section" aria-labelledby="standings-title">
      <div class="section-head"><h2 id="standings-title">${label(set)} standings</h2><p>Top ${cut} advance${set==='C'?' to the finals':' to the semi-final'} · ranked by points, kills, wins, placement</p></div>
      <div class="war-progress" role="progressbar" aria-label="${label(set)} matches played" aria-valuemin="0" aria-valuemax="${p.target}" aria-valuenow="${p.played}"><span style="width:${Math.min(100,p.played/p.target*100)}%"></span></div>
      ${standingsTable(set)}
      ${tied.length&&!p.locked?`<div class="war-tie" role="group" aria-labelledby="tie-title"><h3 id="tie-title">Tie at the cutoff</h3><p>These teams have identical records. Choose ${cut-rows.filter(r=>r.rank<edge.rank).length} to advance and give the reason.</p><div class="war-tie-options">${tied.map(r=>`<label><input type="checkbox" data-war-tie value="${esc(r.teamId)}"><span>${esc(r.teamName)}</span></label>`).join('')}</div><label>Reason<input id="war-tie-reason" maxlength="200" placeholder="e.g. Winner of the tiebreak match"></label></div>`:''}
    </section>
    <section class="war-section" aria-labelledby="matches-title"><div class="section-head"><h2 id="matches-title">Matches</h2><p>${matches.length} of ${p.target} saved</p></div>
      ${matches.length?`<ul class="war-matches">${matches.map(m=>`<li><button type="button" onclick="comfortResult('${esc(m.id)}')"><strong>${esc(m.name)}</strong><span>${esc(m.map)} · ${new Date(m.created).toLocaleDateString('en-IN')}</span><span class="war-match-open">View</span></button></li>`).join('')}</ul>`:'<p class="war-empty">No matches saved yet.</p>'}
    </section>${assign}<section class="war-section">${settings}</section>`;
  }
  window.comfortResult=id=>{selected=id;go('results');};
  window.comfortQualify=set=>{
    try{
      const choices=[...document.querySelectorAll('[data-war-tie]:checked')].map(el=>el.value),reason=document.querySelector('#war-tie-reason')?.value.trim();
      if(choices.length&&!reason)throw Error('Add a short reason for the tiebreak decision before continuing.');
      const winners=WarTournament.qualify(withWar(),set,choices);
      modal(`<h2>Confirm the top ${winners.length}</h2><p>These teams advance from ${label(set)} to ${set==='C'?'the finals':'the semi-final'}. ${label(set)} results are then locked; you can reopen the set to correct them.</p><ol class="qualifier-list">${winners.map(id=>`<li>${esc(name(id))}</li>`).join('')}</ol><div class="actions"><button type="button" onclick="closeModal()">Back</button>${action('Confirm and advance',"comfortConfirmQualifiers('"+set+"')",true)}</div>`);
    }catch(e){alert(e.message);}
  };
  window.comfortConfirmQualifiers=async set=>{if(await warQualify(set)){closeModal();view=next(state);render();toast(w().qualified[set].length+' teams advanced from '+label(set)+'.');}};

  // ---- Finals: a drawn bracket. Opening round → second chance → Grand Final.
  const SEEDS={q1:['Semi-final #1','Semi-final #2'],eliminator:['Semi-final #3','Semi-final #4'],q2:['Loser of Qualifier 1','Winner of Eliminator'],final:['Winner of Qualifier 1','Winner of Qualifier 2']};
  const ROUTE={q1:'Winner → Grand Final · loser → Qualifier 2',eliminator:'Winner → Qualifier 2 · loser out',q2:'Winner → Grand Final · loser out',final:'Winner is the FFK War champion'};
  function fixture(key){
    const war=w(),cs=WarTournament.playoffResults(war),pair=WarTournament.fixture(war,key),r=cs[key],playable=pair.every(Boolean),title=WarTournament.playoffLabels[key];
    const seed=id=>{const i=(war.qualified.C||[]).indexOf(id);return i<0?'':'#'+(i+1);};
    const note=id=>{if(!r||!id)return '';if(r.winner===id)return key==='final'?'Champion':key==='eliminator'?'To Qualifier 2':'To Grand Final';return key==='q1'?'Second chance':'Out';};
    return `<article class="fixture${r?' is-done':playable?' is-ready':''}${key==='final'?' is-final':''}" data-fixture="${key}" aria-label="${title}">
      <header><h3>${title}</h3><span class="fixture-state">${r?'Final':playable?'Ready':'Waiting'}</span></header>
      <ol class="fixture-teams">${pair.map((id,i)=>`<li class="fx-team${r?(r.winner===id?' is-winner':' is-out'):''}" data-slot="${i}"><span class="fx-seed">${id?seed(id):''}</span><span class="fx-name">${esc(id?name(id):SEEDS[key][i])}</span><small class="fx-note${r&&id&&r.winner!==id&&key==='q1'?' is-second':''}">${note(id)}</small><b class="fx-score">${r?r.scores[i]:''}</b></li>`).join('')}</ol>
      ${r?'':`<p class="fixture-route">${ROUTE[key]}</p>`}
      ${playable?`<div class="fixture-actions">${action(r?'Edit score':'Enter score',`comfortScore('${key}')`,!r,`aria-label="${r?'Edit':'Enter'} ${title} score"`)}${r?action('Clear',`warClearCS('${key}')`,false,`aria-label="Clear ${title} result and later results"`):''}</div>`:''}
    </article>`;
  }
  function champion(compact=false){
    const cs=WarTournament.playoffResults(w());if(!cs.final)return '';
    return `<section class="champion${compact?' is-compact':''}" aria-label="FFK War champion"><div class="champion-cup">${ICON.cup}</div><div><span class="champion-label">FFK War champion</span><h2 class="champion-name">${esc(name(cs.final.winner))}</h2><p>Won the Grand Final ${cs.final.scores.join('–')} against ${esc(name(cs.final.loser))}</p></div></section>`;
  }
  function finalsView(){
    const war=w(),readyFinals=war.qualified.C?.length===4,history=[...(war.csHistory||[])];
    if(war.csFormat!==WarTournament.playoffFormat&&Object.keys(war.cs||{}).length)history.push({results:war.cs});
    return `${champion()}
    ${readyFinals?'':'<p class="war-empty">The bracket fills in when the top 4 of the semi-final are confirmed.</p>'}
    <section class="bracket" id="bracket" aria-label="Clash Squad bracket">
      <div class="bracket-col"><h3 class="bracket-round">Opening round</h3>${fixture('q1')}${fixture('eliminator')}</div>
      <div class="bracket-col"><h3 class="bracket-round">Second chance</h3>${fixture('q2')}</div>
      <div class="bracket-col"><h3 class="bracket-round">Title match</h3>${fixture('final')}</div>
      <svg class="bracket-lines" aria-hidden="true"></svg>
    </section>
    <p class="bracket-legend"><span class="legend-win">Winner advances</span><span class="legend-second">Qualifier 1 loser’s second chance</span></p>
    ${veteran()?'':'<p class="caption">Clash Squad scores are separate from BR points. Enter round or series scores using your event rules.</p>'}
    ${history.length?`<details class="war-tools"><summary>Previous finals format · saved scores</summary><div class="war-tools-body">${history.flatMap(entry=>Object.entries(entry.results)).filter(([,r])=>r?.teams&&r?.scores).map(([key,r])=>`<p>${key==='sf1'?'Previous semi-final 1':key==='sf2'?'Previous semi-final 2':'Previous final'}: ${esc(name(r.teams[0]))} ${r.scores[0]}–${r.scores[1]} ${esc(name(r.teams[1]))}</p>`).join('')}</div></details>`:''}`;
  }
  // Connector lines, measured from the rendered cards so they always meet the right team row.
  function drawBracket(){
    const box=document.querySelector('#bracket'),svg=box?.querySelector('.bracket-lines');if(!svg)return;
    const narrow=getComputedStyle(box).getPropertyValue('--bracket-lines').trim()==='none';svg.innerHTML='';if(narrow)return;
    const area=box.getBoundingClientRect();svg.setAttribute('viewBox',`0 0 ${area.width} ${area.height}`);
    const card=k=>box.querySelector(`[data-fixture="${k}"]`),row=(k,i)=>card(k)?.querySelector(`[data-slot="${i}"]`),cs=WarTournament.playoffResults(w());
    const at=(el,side)=>{const r=el.getBoundingClientRect();return {x:(side==='right'?r.right:r.left)-area.left,y:r.top+r.height/2-area.top};};
    const line=(from,to,kind,decided)=>{const a=at(from,'right'),b=at(to,'left'),mid=a.x+Math.max(14,(b.x-a.x)/2);
      svg.insertAdjacentHTML('beforeend',`<path class="bracket-line is-${kind}${decided?' is-decided':''}" d="M${a.x} ${a.y}H${mid}V${b.y}H${b.x}"/>`);};
    line(card('q1'),row('final',0),'win',!!cs.q1);
    line(card('q1'),row('q2',0),'second',!!cs.q1);
    line(card('eliminator'),row('q2',1),'win',!!cs.eliminator);
    line(card('q2'),row('final',1),'win',!!cs.q2);
  }
  let observer;
  function mountBracket(){observer?.disconnect();const box=document.querySelector('#bracket');if(!box)return;drawBracket();observer=new ResizeObserver(()=>drawBracket());observer.observe(box);}

  window.comfortScore=key=>{
    const war=w(),pair=WarTournament.fixture(war,key),r=WarTournament.playoffResults(war)[key];if(pair.some(id=>!id))return;
    const title=WarTournament.playoffLabels[key]+' score';
    modal(`<form id="score-form"><h2>${title}</h2><p>Enter the final round or series score. The winner advances automatically.</p><div class="score-pair">${pair.map((id,i)=>`<label><span>${esc(name(id))}</span><input id="${key}-${i?'b':'a'}" aria-label="${esc(name(id))} score" type="number" min="0" max="99" inputmode="numeric" required value="${r?.scores[i]??''}" placeholder="0"></label>`).join('<span class="score-vs">vs</span>')}</div><p id="score-preview" class="score-preview" role="status">Enter both scores to see the winner.</p><p id="score-error" class="error" role="alert" hidden></p><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button type="submit" class="primary">Save score</button></div></form>`);
    const inputs=[...document.querySelectorAll('.score-pair input')],preview=document.querySelector('#score-preview');
    inputs.forEach(input=>input.oninput=()=>{const values=inputs.map(x=>x.value===''?null:Number(x.value));preview.textContent=values.some(x=>x===null)?'Enter both scores to see the winner.':values[0]===values[1]?'A CS match needs a winning score.':name(pair[values[0]>values[1]?0:1])+' wins '+Math.max(...values)+'–'+Math.min(...values);});
    document.querySelector('#score-form').onsubmit=async event=>{
      event.preventDefault();const a=inputs[0].value,b=inputs[1].value,error=document.querySelector('#score-error');
      if(a===''||b===''||Number(a)===Number(b)){error.hidden=false;error.textContent='Enter both scores. One team must have the higher score.';return;}
      if(await warScore(key)){closeModal();toast(key==='final'?'Champion confirmed. Your war is complete.':'Score saved. The winner has advanced.');}
    };
    inputs[0].focus();
  };
  function tools(){
    return `<details class="war-tools"><summary>Saved matches and reset</summary><div class="war-tools-body">
      <div class="war-setting war-assign"><h3>Assign an earlier match to a set</h3>${state.matches.map(m=>`<div class="war-match-assign"><span>${esc(m.name)}<small>${m.stage?'Set '+m.stage:'Practice'}</small></span><select aria-label="Set for ${esc(m.name)}" data-war-link="${esc(m.id)}"><option value="">Practice</option>${['A','B','C'].map(set=>`<option value="${set}" ${m.stage===set?'selected':''}>Set ${set}</option>`).join('')}</select><button type="button" onclick="warLink('${esc(m.id)}')">Save</button></div>`).join('')||'<p>No saved matches yet.</p>'}</div>
      <div class="war-setting war-danger"><div><h3>Reset the war</h3><p>Clears saved results, sets, qualifiers and finals. Teams, players and your password stay.</p></div><button type="button" class="danger war-reset" onclick="comfortResetWar()">Reset the war…</button></div>
    </div></details>`;
  }
  window.renderWar=function(){
    const current=view||next(state),st=status(current),items=attention(current),fresh=!state.matches.length&&!Object.keys(w().qualified||{}).length;
    const start=`<section class="war-section" aria-labelledby="start-title"><div class="section-head"><h2 id="start-title">Getting started</h2></div><ol class="home-steps"><li><strong>Check the teams.</strong> ${state.teams.length} registered; each set needs 12.</li><li><strong>Add Set A results.</strong> The first saved points table defines the set.</li><li><strong>Confirm qualifiers, then play the finals.</strong></li></ol></section>`;
    return `<div class="war-workspace">${pageHead('Tournament',st.meta,st.action)}<p id="war-feedback" class="error" role="alert" tabindex="-1" hidden></p>${facts(current,items)}${attentionList(items)}${stageStrip()}${fresh?start:''}${current==='finals'?finalsView():stageView(current)}${tools()}</div>`;
  };
  // The bracket's lines are drawn after the cards are on screen.
  root.pageMounted=current=>{
    const act=document.querySelector('.page-actions .primary');if(act&&current==='war'){act.setAttribute('aria-keyshortcuts','N');act.title='Shortcut: N';}
    if(current==='war'&&(view||next(state))==='finals')requestAnimationFrame(mountBracket);else observer?.disconnect();
  };
  // N does the next thing on the Tournament page, for organizers who know where they are.
  document.addEventListener('keydown',e=>{
    if(e.key.toLowerCase()!=='n'||e.ctrlKey||e.metaKey||e.altKey||page!=='war'||busy)return;
    if(e.target.closest?.('input,textarea,select,[contenteditable],dialog[open],summary'))return;
    const act=document.querySelector('.page-actions .primary');if(act){e.preventDefault();act.click();}
  });
})(typeof window==='undefined'?globalThis:window);
