/* Approved direction: extend the existing desk; isolated BR sets, confirmed qualifiers,
   fresh points in Set C, then Qualifier 1, Eliminator, Qualifier 2 and Grand Final. */
(function(root){
  const sets=['A','B','C'];
  const playoffFormat='page-playoff-v1';
  const initial=()=>({groups:{A:[],B:[]},targets:{A:6,B:6,C:6},qualified:{},decisions:{},cs:{},csFormat:playoffFormat});
  function members(w,set){return set==='C'?[...(w.qualified.A||[]),...(w.qualified.B||[])]:w.groups[set];}
  function matches(s,set){return s.matches.filter(m=>m.stage===set);}
  function established(s,set){return matches(s,set).length>0||!!s.war?.qualified?.[set];}
  function availableTeams(s,set){
    if(!sets.includes(set))return s.teams;
    const w=s.war||initial();
    if(set==='C'||established(s,set)){const ids=members(w,set);return s.teams.filter(t=>ids.includes(t.id));}
    const other=set==='A'?'B':'A',excluded=established(s,other)?w.groups[other]:[];
    return s.teams.filter(t=>!excluded.includes(t.id));
  }
  function registerResult(s,match){
    const set=match.stage;if(!sets.includes(set))throw Error('Choose Set A, Set B or Set C.');
    const w=s.war||initial(),ids=match.rows.map(row=>row.teamId);
    if(w.qualified[set])throw Error('Reopen Set '+set+' before changing its results.');
    if(ids.length!==12||new Set(ids).size!==12||ids.some(id=>!s.teams.some(t=>t.id===id)))throw Error('Confirm 12 different registered teams before saving this set.');
    const allowed=availableTeams(s,set).map(t=>t.id);
    if(ids.some(id=>!allowed.includes(id)))throw Error(set==='C'?'Use the 12 qualified semi-final teams.':established(s,set)?'Use the same 12 teams as the first saved Set '+set+' result.':'A team cannot play in both Set A and Set B. Check the selected teams.');
    if(set==='C'&&members(w,'C').length!==12)throw Error('Confirm the top 6 from both A and B before Set C.');
    if(set!=='C'&&!established(s,set))w.groups[set]=ids;
    s.war=w;
    return ids;
  }
  function standings(s,set){
    const ids=members(s.war,set),result=root.WarOverall.aggregate({teams:s.teams,matches:matches(s,set)}).rows;
    return result.filter(r=>ids.includes(r.teamId));
  }
  const equal=(a,b)=>a&&b&&['total','kills','wins','placementPoints'].every(k=>a[k]===b[k]);
  function qualify(s,set,choice=[]){
    const w=s.war,ids=members(w,set),ms=matches(s,set),count=set==='C'?4:6;
    if(ids.length!==12||new Set(ids).size!==12||ids.some(id=>!s.teams.some(t=>t.id===id)))throw Error('Assign 12 registered teams to this set first.');
    if(ms.length!==w.targets[set])throw Error('Save exactly '+w.targets[set]+' matches for Set '+set+' before qualification.');
    if(ms.some(m=>m.rows.length!==12||new Set(m.rows.map(r=>r.teamId)).size!==12||m.rows.some(r=>!ids.includes(r.teamId))))throw Error('Every match must contain all 12 teams assigned to its set.');
    const rows=standings(s,set),edge=rows[count-1],tied=rows.filter(r=>equal(r,edge));
    let winners=rows.slice(0,count).map(r=>r.teamId);
    if(equal(edge,rows[count])){
      const safe=rows.filter(r=>r.rank<edge.rank).map(r=>r.teamId),needed=count-safe.length;
      if(choice.length!==needed||new Set(choice).size!==needed||choice.some(id=>!tied.some(r=>r.teamId===id)))throw Error('Resolve the qualification cutoff tie: choose '+needed+' of the tied teams.');
      winners=[...safe,...choice];
    }
    return winners;
  }
  const playoffKeys=['q1','eliminator','q2','final'];
  const playoffLabels={q1:'Qualifier 1',eliminator:'Eliminator',q2:'Qualifier 2',final:'Grand Final'};
  function playoffResults(w){return w.csFormat===playoffFormat?(w.cs||{}):{};}
  function migratePlayoffs(w){
    if(w.csFormat===playoffFormat)return;
    if(w.cs&&Object.keys(w.cs).length){w.csHistory=w.csHistory||[];w.csHistory.push({format:'single-elimination',results:structuredClone(w.cs),archivedAt:new Date().toISOString()});}
    w.cs={};w.csFormat=playoffFormat;
  }
  function fixture(w,key){const seeds=w.qualified.C||[],cs=playoffResults(w);return key==='q1'?[seeds[0],seeds[1]]:key==='eliminator'?[seeds[2],seeds[3]]:key==='q2'?[cs.q1?.loser,cs.eliminator?.winner]:key==='final'?[cs.q1?.winner,cs.q2?.winner]:[];}
  function clearCS(w,key){
    const affected={q1:['q1','q2','final'],eliminator:['eliminator','q2','final'],q2:['q2','final'],final:['final']}[key];
    if(!affected)throw Error('Unknown fixture.');migratePlayoffs(w);affected.forEach(k=>delete w.cs[k]);
  }
  function recordCS(w,key,a,b){
    if(!playoffKeys.includes(key))throw Error('Unknown fixture.');
    const pair=fixture(w,key);
    if(pair.some(x=>!x))throw Error('Both teams must qualify before this fixture can be played.');
    if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>99||b>99||a===b)throw Error('Enter different whole scores from 0 to 99.');
    const cs=playoffResults(w),winner=pair[a>b?0:1],dependent=key==='q1'||key==='eliminator'?['q2','final']:key==='q2'?['final']:[];
    if(dependent.some(k=>cs[k])&&cs[key]?.winner!==winner)throw Error('Clear '+playoffLabels[key]+' and its dependent results before changing the winner.');
    migratePlayoffs(w);
    w.cs[key]={teams:pair,scores:[a,b],winner,loser:pair[a>b?1:0],at:new Date().toISOString()};
  }
  const core={initial,members,matches,standings,qualify,fixture,recordCS,established,availableTeams,registerResult,playoffFormat,playoffKeys,playoffLabels,playoffResults,migratePlayoffs,clearCS};
  if(typeof module!=='undefined'){root.WarOverall=require('./overall.js');module.exports=core;return;}
  root.WarTournament=core;
  const prior={intake,finalize,overview,api,bind,bindReview};
  let active='A',working=false;
  const war=()=>state.war||initial();
  const name=id=>state.teams.find(t=>t.id===id)?.name||'Awaiting qualifier';
  const option=(id,label,selected)=>`<option value="${esc(id)}" ${selected?'selected':''}>${esc(label)}</option>`;
  const locked=set=>!!war().qualified[set];
  function allowed(set){return sets.includes(set)&&!locked(set)&&availableTeams(state,set).length>=12&&(set!=='C'||members(war(),'C').length===12);}
  bindReview=function(){
    prior.bindReview();
    if(!draft?.stage)return;
    const ids=availableTeams(state,draft.stage).map(t=>t.id);
    document.querySelectorAll('[data-team]').forEach(select=>Array.from(select.options).forEach(option=>{
      if(option.value&&!ids.includes(option.value)){option.disabled=true;option.hidden=true;}
    }));
  };
  bind=function(){
    prior.bind();
    if(page!=='upload')return;
    for(const selector of ['#manual','#scan']){
      const button=document.querySelector(selector),run=button?.onclick;
      if(button)button.onclick=async()=>{
        const set=draft?.stage||document.querySelector('#war-stage')?.value;
        if(set&&!allowed(set))return toast(set==='C'?'Confirm qualifiers from A and B before Set C.':'Register at least 12 available teams for this set.','error');
        if(set&&matches(state,set).length>=war().targets[set])return toast('Planned match count reached. Update it in War manager first.','error');
        return run();
      };
    }
  };
  async function change(fn,success='Changes saved'){
    if(working)return false;working=true;const before=structuredClone(state);
    const surface=document.querySelector('.war-workspace');surface?.setAttribute('aria-busy','true');
    const buttons=[...document.querySelectorAll('.war-workspace button, #modal[open] button')].filter(button=>!button.disabled);
    buttons.forEach(button=>button.disabled=true);
    try{state.war=structuredClone(war());await fn();await save();render();toast(success);return true;}
    catch(e){state=before;const error=document.querySelector('#guide-score-error')||document.querySelector('#war-feedback');if(error){error.hidden=false;error.textContent=e.message;}toast(e.message,'error');return false;}
    finally{working=false;surface?.removeAttribute('aria-busy');buttons.forEach(button=>{if(button.isConnected)button.disabled=false;});}
  }
  // Completed sets are immutable until the organizer explicitly reopens them.
  api=async function(path,data){
    if(path==='state'&&data){
      // Read locks without resetting the workspace's last-seen revision.
      const response=await fetch('/api/state');
      const old=await response.json();if(!response.ok)throw Error(old.error||'Could not check tournament locks.');
      for(const set of sets)if(old.war?.qualified[set]&&data.war?.qualified[set]){
        if(JSON.stringify(matches(old,set))!==JSON.stringify(matches(data,set))||JSON.stringify(members(old.war,set))!==JSON.stringify(members(data.war,set)))throw Error('Set '+set+' is locked. Reopen qualification in War manager before changing its results or teams.');
      }
    }
    if(path==='matches/delete'){
      const match=state.matches.find(m=>m.id===data.id);if(match?.stage&&locked(match.stage))throw Error('Reopen Set '+match.stage+' in War manager before deleting this match.');
    }
    return prior.api(path,data);
  };
  intake=function(){
    const current=draft?.stage||'',w=war();
    const picker=`<label class="war-intake">Tournament set<select id="war-stage" ${draft?'disabled':''}>${option('','Practice / unassigned',!current)}${sets.map(set=>option(set,'Set '+set+(set==='C'?' · Semi-final':'')+(locked(set)?' · Locked':set==='C'&&members(w,set).length!==12?' · Awaiting qualifiers':''),set===current)).join('')}</select><small>The 12 teams in your first verified result become this set’s team list.</small></label>`;
    return prior.intake().replace('<div class="form-grid">','<div class="form-grid">'+picker);
  };
  finalize=async function(){
    if(draft?.stage){
      const set=draft.stage;
      if(!allowed(set))return toast('This set is locked or does not have 12 available teams.','error');
      if(matches(state,set).length>=war().targets[set])return toast('The planned match count is reached. Increase it in War manager first.','error');
      try{registerResult({...state,war:structuredClone(war())},draft);}catch(e){return toast(e.message,'error');}
    }
    return prior.finalize();
  };
  overview=function(){return `<section class="war-shortcut"><div><span class="eyebrow">24 TEAMS / ONE CHAMPION</span><h2>FFK War tournament</h2><p>Set A + Set B → Set C → Clash Squad finals</p></div><button onclick="go('war')">Manage war →</button></section>`+prior.overview();};
  window.warTab=set=>{active=set;render();};
  window.warSaveGroups=()=>change(()=>{
    const w=state.war;
    if(w.qualified.A||w.qualified.B||state.matches.some(m=>m.stage))throw Error('Group allocation is locked once tournament results exist.');
    const groups={A:[],B:[]};document.querySelectorAll('[data-war-team]').forEach(el=>{if(el.value)groups[el.value].push(el.dataset.warTeam);});
    if(groups.A.length!==12||groups.B.length!==12)throw Error('Choose exactly 12 teams for A and 12 for B.');
    w.groups=groups;
  },'Team allocation saved');
  window.warAutoGroups=()=>{
    if(state.teams.length!==24)return toast('Automatic allocation needs exactly 24 registered teams. Use the selectors for a larger roster.','error');
    document.querySelectorAll('[data-war-team]').forEach((el,i)=>el.value=i<12?'A':'B');
  };
  window.warTarget=set=>change(()=>{
    const value=Number(document.querySelector('#war-target').value);
    if(locked(set))throw Error('Reopen this set before changing its match count.');
    if(!Number.isInteger(value)||value<1||value>99||value<matches(state,set).length)throw Error('Choose 1–99 matches, at least the number already saved.');
    state.war.targets[set]=value;
  },'Set '+set+' match count updated');
  window.warQualify=set=>change(()=>{
    const choices=[...document.querySelectorAll('[data-war-tie]:checked')].map(el=>el.value);
    const reason=document.querySelector('#war-tie-reason')?.value.trim()||'';
    if(choices.length&&!reason)throw Error('Record the reason for your cutoff tie decision.');
    state.war.qualified[set]=qualify(state,set,choices);
    state.war.decisions[set]={at:new Date().toISOString(),reason,choices};
  },'Set '+set+' qualifiers confirmed');
  window.warReopen=async set=>{
    if(!await confirmAction({title:'Reopen Set '+set+'?',message:'This clears its qualifiers, downstream qualifications and all CS results. Saved BR matches remain; reassess Set C results if its participants change.',accept:'Reopen set',cancel:'Keep locked'}))return;
    change(()=>{const affected=set==='C'?['C']:[set,'C'];for(const s of affected){delete state.war.qualified[s];delete state.war.decisions[s];}state.war.cs={};});
  };
  window.warLink=id=>change(()=>{
    const m=state.matches.find(m=>m.id===id),set=document.querySelector(`[data-war-link="${CSS.escape(id)}"]`).value;
    if(m.stage&&locked(m.stage))throw Error('Reopen the original set first.');
    if(set&&(!allowed(set)||matches(state,set).length>=state.war.targets[set]))throw Error('Set unavailable or planned match count reached.');
    if(set){if(m.stage===set)return;registerResult(state,{...m,stage:set});}
    m.stage=set||undefined;
  });
  window.warScore=key=>change(()=>{
    const a=document.querySelector('#'+key+'-a').value,b=document.querySelector('#'+key+'-b').value;
    if(a===''||b==='')throw Error('Enter both CS scores.');recordCS(state.war,key,Number(a),Number(b));
  });
  window.warClearFinal=()=>change(()=>{delete state.war.cs.final;});
  window.warClearCS=async key=>{
    if(!await confirmAction({title:'Clear '+playoffLabels[key]+'?',message:'This clears its score and any later results that depend on it. Other opening-match results are kept.',accept:'Clear result',cancel:'Keep result'}))return false;
    return change(()=>clearCS(state.war,key),'Result cleared');
  };
  window.warNew=set=>{if(!allowed(set))return toast('Register 12 available teams, or confirm the semi-final qualifiers first.','error');if(draft)return toast('Finish or discard your current match draft before starting a new set match.','error');go('upload');document.querySelector('#war-stage').value=set;};
  window.renderWar=function(){
    const w=war(),s={...state,war:w},ids=members(w,active),rows=standings(s,active),ms=matches(s,active),cut=active==='C'?4:6;
    const edge=rows[cut-1],tie=equal(edge,rows[cut])?rows.filter(r=>equal(r,edge)):[];
    const groupLocked=!!(w.qualified.A||w.qualified.B||state.matches.some(m=>m.stage));
    return header('Tournament command','FFK WAR')+`<div class="war-path">${['A','B','C'].map(set=>`<button onclick="warTab('${set}')" class="${active===set?'active':''}"><span>${set==='C'?'SEMI-FINAL':'QUALIFIER'}</span><strong>SET ${set}</strong><small>${members(w,set).length}/12 teams · ${matches(s,set).length}/${w.targets[set]} BR matches${w.qualified[set]?' · Qualified':''}</small></button>`).join('')}<div><span>CLASH SQUAD</span><strong>FINALS</strong><small>${w.qualified.C?.length||0}/4 teams · ${w.cs.final?'Complete':'Knockout bracket'}</small></div></div>
    <details class="panel war-allocation" ${w.groups.A.length?'':'open'}><summary>Team allocation · 12 in Set A + 12 in Set B</summary><p>Choose 24 registered teams. Save groups before recording tournament matches.</p><div class="war-team-grid">${state.teams.map(t=>`<label>${esc(t.name)}<select data-war-team="${esc(t.id)}" ${groupLocked?'disabled':''}>${option('','Not playing',!w.groups.A.includes(t.id)&&!w.groups.B.includes(t.id))}${option('A','Set A',w.groups.A.includes(t.id))}${option('B','Set B',w.groups.B.includes(t.id))}</select></label>`).join('')}</div>${!groupLocked?'<div class="actions"><button onclick="warAutoGroups()">Allocate first 12 / next 12</button><button onclick="warSaveGroups()">Save allocation</button></div>':'<p class="caption">Allocation locked by tournament results.</p>'}</details>
    <section class="panel"><div class="panel-head"><div><span class="eyebrow">${active==='C'?'SEMI-FINAL · FRESH POINTS':'BATTLE ROYALE'}</span><h2>Set ${active} standings</h2></div><button onclick="warNew('${active}')" ${!allowed(active)?'disabled':''}>＋ Add match</button></div><div class="war-controls"><label>Planned BR matches<input id="war-target" type="number" min="1" max="99" value="${w.targets[active]}" ${locked(active)?'disabled':''}></label><button onclick="warTarget('${active}')" ${locked(active)?'disabled':''}>Save match count</button><p>${ms.length}/${w.targets[active]} saved · Top ${cut} advance · ${locked(active)?'Qualification locked':'Qualification pending'}</p></div>
    <div class="table-wrap"><table><thead><tr><th>Rank</th><th>Team</th><th>Played</th><th>Kills</th><th>Wins</th><th>Points</th><th>Status</th></tr></thead><tbody>${ids.map(id=>rows.find(r=>r.teamId===id)||{teamId:id,teamName:name(id),rank:'—',matches:0,kills:0,wins:0,total:0}).sort((a,b)=>(Number(a.rank)||999)-(Number(b.rank)||999)).map(r=>`<tr class="${w.qualified[active]?.includes(r.teamId)?'war-qualified':''}"><td>${r.rank}</td><td>${esc(r.teamName)}</td><td>${r.matches}</td><td>${r.kills}</td><td>${r.wins}</td><td class="total">${r.total}</td><td>${w.qualified[active]?.includes(r.teamId)?'QUALIFIED':locked(active)?'Eliminated':Number(r.rank)<=cut?'Above cutoff':'—'}</td></tr>`).join('')||'<tr><td colspan="7">'+(active==='C'?'Confirm top 6 from A and B to populate this set.':'Save team allocation to begin.')+'</td></tr>'}</tbody></table></div><p class="caption">Points → kills → wins → placement points. Each set starts at zero. Remaining ties at the qualification cutoff require a host decision. CS seeds follow this table; equal records retain the displayed team-name order.</p>
    ${tie.length&&!locked(active)?`<div class="notice"><strong>Qualification cutoff tie</strong><p>Choose the teams to advance from this tied group.</p>${tie.map(r=>`<label class="war-tie"><input type="checkbox" data-war-tie value="${esc(r.teamId)}">${esc(r.teamName)}</label>`).join('')}<label>Host decision reason<input id="war-tie-reason" maxlength="200" placeholder="Tiebreak match or host ruling"></label></div>`:''}
    <div class="actions">${locked(active)?`<button onclick="warReopen('${active}')">Reopen qualification</button><span>Confirmed ${esc(new Date(w.decisions[active].at).toLocaleString('en-IN'))}${w.decisions[active].reason?' · '+esc(w.decisions[active].reason):''}</span>`:`<button class="primary" onclick="warQualify('${active}')" ${ids.length!==12||ms.length!==w.targets[active]?'disabled':''}>Confirm top ${cut} → ${active==='C'?'CS finals':'Set C'}</button>`}</div></section>
    <details class="panel"><summary>Saved BR matches · assign to a set</summary><p>Existing matches remain unassigned until you choose a set. Only that set’s 12 teams may appear.</p>${state.matches.map(m=>`<div class="war-match"><span>${esc(m.name)}<small>${esc(m.map)} · ${m.stage?'Set '+m.stage:'Unassigned'}</small></span><select aria-label="Set for ${esc(m.name)}" data-war-link="${esc(m.id)}">${option('','Unassigned',!m.stage)}${sets.map(set=>option(set,'Set '+set,m.stage===set)).join('')}</select><button onclick="warLink('${esc(m.id)}')">Assign</button></div>`).join('')||'<p>No saved matches yet.</p>'}</details>
    <section class="panel"><div class="panel-head"><div><span class="eyebrow">FINAL FOUR / CLASH SQUAD</span><h2>Play for the crown</h2></div>${w.cs.final?'<button onclick="warClearFinal()">Clear final result</button>':''}</div><p>Q1: Seed 1 vs 2 · Eliminator: Seed 3 vs 4 · Q2 and Grand Final follow. Enter round or series scores using your event rules.</p><div class="war-bracket">${playoffKeys.map((key,i)=>{const pair=fixture(w,key),r=playoffResults(w)[key],ready=pair.every(Boolean);return `<article class="war-fixture"><span class="eyebrow">${playoffLabels[key].toUpperCase()}</span>${pair.map((id,j)=>`<label class="${r?.winner===id?'war-winner':''}"><span>${esc(name(id))}</span><input id="${key}-${j?'b':'a'}" type="number" min="0" max="99" aria-label="${playoffLabels[key]} team ${j+1} score" value="${r?.scores[j]??''}" ${!ready?'disabled':''}></label>`).join('')}<button onclick="warScore('${key}')" ${!ready?'disabled':''}>${r?'Update':'Save'} result</button>${r?'<small>Winner: '+esc(name(r.winner))+'</small>':''}</article>`;}).join('')}</div>${w.cs.final?`<div class="war-champion"><span>FFK WAR CHAMPION</span><h2>${esc(name(w.cs.final.winner))}</h2></div>`:''}</section>`;
  };
})(typeof window==='undefined'?globalThis:window);
