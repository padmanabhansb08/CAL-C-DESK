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
  const prior={finalize,api,bind};
  let working=false;
  const war=()=>state.war||initial();
  const locked=set=>!!war().qualified[set];
  function allowed(set){return sets.includes(set)&&!locked(set)&&availableTeams(state,set).length>=12&&(set!=='C'||members(war(),'C').length===12);}
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
  api=async function(path,data,options){
    if(path==='state'&&data){
      // Read locks without resetting the workspace's last-seen revision.
      const response=await fetch('/api/state');
      const old=await response.json().catch(()=>({}));
      if(response.status===401){sessionExpired();const e=Error('Your sign-in has ended. Sign in again; your match draft is kept.');e.status=401;e.expired=true;throw e;}
      if(!response.ok)throw Error(old.error||'Could not check tournament locks.');
      for(const set of sets)if(old.war?.qualified[set]&&data.war?.qualified[set]){
        if(JSON.stringify(matches(old,set))!==JSON.stringify(matches(data,set))||JSON.stringify(members(old.war,set))!==JSON.stringify(members(data.war,set)))throw Error('Set '+set+' is locked. Reopen qualification in War manager before changing its results or teams.');
      }
    }
    if(path==='matches/delete'){
      const match=state.matches.find(m=>m.id===data.id);if(match?.stage&&locked(match.stage))throw Error('Reopen Set '+match.stage+' in War manager before deleting this match.');
    }
    return prior.api(path,data,options);
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
  window.warClearCS=async key=>{
    if(!await confirmAction({title:'Clear '+playoffLabels[key]+'?',message:'This clears its score and any later results that depend on it. Other opening-match results are kept.',accept:'Clear result',cancel:'Keep result'}))return false;
    return change(()=>clearCS(state.war,key),'Result cleared');
  };
  window.warNew=async set=>{if(!allowed(set))return toast('Register 12 available teams, or confirm the semi-final qualifiers first.','error');if(draft)return toast('Finish or discard your current match draft before starting a new set match.','error');try{await loadModules('reader');}catch(e){return toast(e.message,'error');}go('upload');const stage=document.querySelector('#war-stage');if(stage)stage.value=set;};
})(typeof window==='undefined'?globalThis:window);
