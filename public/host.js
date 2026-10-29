(function(){
 window.addEventListener('hashchange',()=>location.reload());
 const params=new URLSearchParams(location.hash.slice(1)),key=params.get('key')||'',screen=params.get('screen')==='1';
 document.body.classList.toggle('broadcast',screen);
 // Which stage the screen shows: 'auto' follows the tournament, or a fixed stage pinned in the link.
 let mode=['all','A','B','C','finals'].includes(params.get('stage'))?params.get('stage'):'auto';
 let state=null,stats=null,last='',held=false,heldData=null,loading=false,page=0,chosen='';const size=12;
 const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=v=>Number(v).toFixed(1),move=t=>t.change===null?'NEW':t.change>0?'<span class="material-symbols-outlined icon-sm move-up" aria-hidden="true">arrow_upward</span> '+t.change:t.change<0?'<span class="material-symbols-outlined icon-sm move-down" aria-hidden="true">arrow_downward</span> '+Math.abs(t.change):'—';
 const LABEL={all:'All saved matches',A:'Set A · Qualifier',B:'Set B · Qualifier',C:'Set C · Semi-final',finals:'Clash Squad finals'};
 function activeStage(){
  const w=state.war;if(!w)return 'all';if(w.qualified?.C?.length)return 'finals';
  const staged=state.matches.filter(m=>m.stage);return staged.at(-1)?.stage||'all';
 }
 const stage=()=>mode==='auto'?activeStage():mode;
 // Only the matches of the chosen stage count; every set starts from zero, as in Tournament.
 function stageState(set){return set==='all'||set==='finals'?state:{...state,matches:state.matches.filter(m=>m.stage===set)};}
 function metrics(items){return items.map(([label,value])=>`<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');}
 function spotlight(){const t=stats.teams.find(t=>t.teamId===chosen)||stats.teams[0];if(!t){$('#team-detail').textContent='Team stats appear after the first saved match.';return;}chosen=t.teamId;
  $('#team-detail').innerHTML=`<h3>${esc(t.teamName)} <small>#${t.rank} in ${esc(LABEL[stage()])}</small></h3><div class="spotlight-metrics">${metrics([['Kills / match',fmt(t.averageKills)],['Points / match',fmt(t.averagePoints)],['Average finish','#'+fmt(t.averageFinish)],['Win rate',fmt(t.winRate)+'%']])}</div><h4>Last ${t.form.length} appearances</h4><div class="form-list">${t.form.map(r=>`<div><strong>${esc(r.name)}</strong><span>Finish #${r.placement}</span><span>${r.kills} kills</span><b>${r.total} pts</b></div>`).join('')}</div>`;
 }
 const teamName=id=>state.teams.find(t=>t.id===id)?.name||'To be decided';
 function finals(){
  const w=state.war||{},cs=w.csFormat==='page-playoff-v1'?(w.cs||{}):{},seeds=w.qualified?.C||[];
  const fixtures=[['q1','Qualifier 1',[seeds[0],seeds[1]]],['eliminator','Eliminator',[seeds[2],seeds[3]]],['q2','Qualifier 2',[cs.q1?.loser,cs.eliminator?.winner]],['final','Grand Final',[cs.q1?.winner,cs.q2?.winner]]];
  $('#finals').innerHTML=`${cs.final?`<div class="finals-champion"><span>FFK WAR CHAMPION</span><strong>${esc(teamName(cs.final.winner))}</strong></div>`:''}<div class="finals-grid">${fixtures.map(([k,label,pair])=>{const r=cs[k];return `<article class="finals-fixture${r?' is-done':''}"><h3>${label}</h3>${pair.map((id,i)=>`<div class="${r?.winner&&r.winner===id?'winner':''}"><span>${esc(id?teamName(id):'To be decided')}</span><b>${r?r.scores[i]:'–'}</b></div>`).join('')}</article>`;}).join('')}</div>`;
 }
 function render(){
  const set=stage(),scoped=stageState(set);
  $('#stage-select').value=mode;document.body.dataset.stage=set;
  $('#stage-label').textContent=mode==='auto'?LABEL[set]+' · following the tournament':LABEL[set];
  const showFinals=set==='finals';$('#finals').hidden=!showFinals;document.querySelectorAll('.stage-standings').forEach(el=>el.hidden=showFinals);
  $('h1').textContent=showFinals?'Clash Squad finals':set==='all'?'Overall standings':LABEL[set]+' standings';
  if(showFinals){finals();$('#match-context').textContent='Knockout bracket · scores entered by the organizer';return;}
  stats=HostStats.analyze(scoped,WarOverall.aggregate);const {teams,players,stories,latest}=stats;
  const count=scoped.matches.length;
  $('#match-context').textContent=count?`${count} saved ${count===1?'match':'matches'} · Through ${latest.name} · ${latest.map}${set==='all'?' · includes practice and every set':''}`:'No saved matches in this stage yet';
  $('#summary').innerHTML=metrics([['Points leader',teams[0]?.teamName||'—'],['Lead margin',teams.length>1?(teams[0].total-teams[1].total)+' pts':'—'],['Latest Booyah',latest?.rows.find(r=>r.placement===1)?teamName(latest.rows.find(r=>r.placement===1).teamId):'—'],['Total kills',teams.reduce((n,t)=>n+t.kills,0)]]);
  const pages=Math.max(1,Math.ceil(teams.length/size));page=Math.min(page,pages-1);
  $('#page-buttons').replaceChildren();if(pages>1)for(let i=0;i<pages;i++){const button=document.createElement('button');button.type='button';button.textContent=`${i*size+1}–${Math.min((i+1)*size,teams.length)}`;button.setAttribute('aria-pressed',String(page===i));button.onclick=()=>{page=i;render();};$('#page-buttons').append(button);}
  const shown=teams.slice(page*size,(page+1)*size);$('#table-range').textContent=teams.length?`Teams ${page*size+1}–${page*size+shown.length} of ${teams.length}`:'Awaiting results';
  $('#standings-body').innerHTML=shown.map(t=>`<tr class="${t.rank===1?'leader':''}"><td>${t.rank}</td><td><strong>${esc(t.teamName)}</strong></td><td>${t.matches}</td><td>${t.wins}</td><td>${t.kills}</td><td>${t.placementPoints}</td><td>${t.adjustment>0?'+':''}${t.adjustment}</td><td class="points">${t.total}</td><td>${t.gap?'−'+t.gap:'—'}</td><td class="${t.change>0?'up':t.change<0?'down':''}">${move(t)}</td></tr>`).join('')||'<tr><td colspan="10">The standings will appear when the organizer saves a match in this stage.</td></tr>';
  $('#stories').innerHTML=stories.map(s=>`<article class="story"><span>${esc(s.label)}</span><p>${esc(s.text)}</p><small>${esc(s.detail)}</small></article>`).join('')||'<p>Save a match to unlock talking points.</p>';
  $('#team-select').innerHTML=teams.map(t=>`<option value="${esc(t.teamId)}" ${t.teamId===chosen?'selected':''}>${esc(t.teamName)}</option>`).join('');spotlight();
  $('#fraggers').innerHTML=players.slice(0,8).map(p=>`<article><span>#${players.findIndex(x=>x.kills===p.kills)+1}</span><div><strong>${esc(p.name)}</strong><small>${esc(p.teamName)}</small></div><b>${p.kills}<small>KILLS</small></b></article>`).join('')||'<p>No player results yet.</p>';
 }
 function apply(data){const signature=JSON.stringify(data);if(signature!==last){state=data;last=signature;render();}}
 async function refresh(){
  if(loading||held)return;loading=true;
  try{const r=await fetch('/api/host/state',{headers:key?{'X-Host-Key':key}:{},cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to load results');
   // Held while the request was in flight: keep the new data aside and show it on resume.
   if(held){heldData=data;$('#connection').textContent='Updates held · newer results waiting';return;}
   apply(data);$('#error').hidden=true;$('#connection').textContent='Updated '+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}
  catch(e){$('#error').hidden=false;$('#error').textContent=e.message+(state?' Showing the last successful update.':'');$('#connection').textContent='Updates unavailable';}
  finally{loading=false;}
 }
 $('#team-select').onchange=e=>{chosen=e.target.value;spotlight();};
 $('#stage-select').onchange=e=>{mode=e.target.value;page=0;const p=new URLSearchParams(location.hash.slice(1));if(mode==='auto')p.delete('stage');else p.set('stage',mode);history.replaceState(null,'','#'+p);if(state)render();};
 $('#refresh').onclick=()=>{if(held){$('#connection').textContent='Updates held — select Resume updates first';return;}refresh();};
 $('#freeze').onclick=()=>{held=!held;$('#freeze').setAttribute('aria-pressed',String(held));$('#freeze').innerHTML=held?'<span class="material-symbols-outlined icon-sm" aria-hidden="true">play_arrow</span> <span>Resume updates</span>':'<span class="material-symbols-outlined icon-sm" aria-hidden="true">pause</span> <span>Hold updates</span>';$('#connection').textContent=held?'Updates held':'Refreshing…';
  if(!held){if(heldData){apply(heldData);heldData=null;}refresh();}};
 $('#broadcast').onclick=()=>{const p=new URLSearchParams();if(key)p.set('key',key);p.set('screen','1');if(mode!=='auto')p.set('stage',mode);window.open('/host.html#'+p,'_blank','noopener');};
 refresh();setInterval(refresh,10000);
})();
