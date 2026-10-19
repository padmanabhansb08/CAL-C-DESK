(function(){
 window.addEventListener('hashchange',()=>location.reload());
 const params=new URLSearchParams(location.hash.slice(1)),key=params.get('key')||'',screen=params.get('screen')==='1';
 document.body.classList.toggle('broadcast',screen);
 let state=null,stats=null,last='',held=false,loading=false,page=0,chosen='';const size=12;
 const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=v=>Number(v).toFixed(1),move=t=>t.change===null?'NEW':t.change>0?'↑ '+t.change:t.change<0?'↓ '+Math.abs(t.change):'—';
 function metrics(items){return items.map(([label,value])=>`<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');}
 function spotlight(){const t=stats.teams.find(t=>t.teamId===chosen)||stats.teams[0];if(!t){$('#team-detail').textContent='Team stats appear after the first saved match.';return;}chosen=t.teamId;
  $('#team-detail').innerHTML=`<h3>${esc(t.teamName)} <small>#${t.rank} overall</small></h3><div class="spotlight-metrics">${metrics([['Kills / match',fmt(t.averageKills)],['Points / match',fmt(t.averagePoints)],['Average finish','#'+fmt(t.averageFinish)],['Win rate',fmt(t.winRate)+'%']])}</div><h4>Last ${t.form.length} appearances</h4><div class="form-list">${t.form.map(r=>`<div><strong>${esc(r.name)}</strong><span>Finish #${r.placement}</span><span>${r.kills} kills</span><b>${r.total} pts</b></div>`).join('')}</div>`;
 }
 function render(){
  stats=HostStats.analyze(state,WarOverall.aggregate);const {teams,players,stories,latest}=stats;
  const count=state.matches.length;$('#match-context').textContent=count?`${count} saved ${count===1?'match':'matches'} · Through ${latest.name} · ${latest.map}`:'No saved matches yet';
  $('#summary').innerHTML=metrics([['Points leader',teams[0]?.teamName||'—'],['Lead margin',teams.length>1?(teams[0].total-teams[1].total)+' pts':'—'],['Latest Booyah',stories.find(s=>s.label==='Latest Booyah')?teams.find(t=>latest.rows.some(r=>r.teamId===t.teamId&&r.placement===1))?.teamName||'—':'—'],['Total kills',teams.reduce((n,t)=>n+t.kills,0)]]);
  const pages=Math.max(1,Math.ceil(teams.length/size));page=Math.min(page,pages-1);
  $('#page-buttons').replaceChildren();if(pages>1)for(let i=0;i<pages;i++){const button=document.createElement('button');button.textContent=`${i*size+1}–${Math.min((i+1)*size,teams.length)}`;button.setAttribute('aria-pressed',String(page===i));button.onclick=()=>{page=i;render();};$('#page-buttons').append(button);}
  const shown=teams.slice(page*size,(page+1)*size);$('#table-range').textContent=teams.length?`Teams ${page*size+1}–${page*size+shown.length} of ${teams.length}`:'Awaiting results';
  $('#standings-body').innerHTML=shown.map(t=>`<tr class="${t.rank===1?'leader':''}"><td>${t.rank}</td><td><strong>${esc(t.teamName)}</strong></td><td>${t.matches}</td><td>${t.wins}</td><td>${t.kills}</td><td>${t.placementPoints}</td><td>${t.adjustment>0?'+':''}${t.adjustment}</td><td class="points">${t.total}</td><td>${t.gap?'−'+t.gap:'—'}</td><td class="${t.change>0?'up':t.change<0?'down':''}">${move(t)}</td></tr>`).join('')||'<tr><td colspan="10">The standings will appear when the organizer saves a match.</td></tr>';
  $('#stories').innerHTML=stories.map(s=>`<article class="story"><span>${esc(s.label)}</span><p>${esc(s.text)}</p><small>${esc(s.detail)}</small></article>`).join('')||'<p>Save a match to unlock talking points.</p>';
  $('#team-select').innerHTML=teams.map(t=>`<option value="${esc(t.teamId)}" ${t.teamId===chosen?'selected':''}>${esc(t.teamName)}</option>`).join('');spotlight();
  $('#fraggers').innerHTML=players.slice(0,8).map((p,i)=>`<article><span>#${players.findIndex(x=>x.kills===p.kills)+1}</span><div><strong>${esc(p.name)}</strong><small>${esc(p.teamName)}</small></div><b>${p.kills}<small>KILLS</small></b></article>`).join('')||'<p>No player results yet.</p>';
 }
 async function refresh(){if(loading||held)return;loading=true;try{const r=await fetch('/api/host/state',{headers:key?{'X-Host-Key':key}:{},cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to load results');const signature=JSON.stringify(data);if(signature!==last){state=data;render();last=signature;}$('#error').hidden=true;$('#connection').textContent='Updated '+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}catch(e){$('#error').hidden=false;$('#error').textContent=e.message+(state?' Showing the last successful update.':'');$('#connection').textContent='Updates unavailable';}finally{loading=false;}}
 $('#team-select').onchange=e=>{chosen=e.target.value;spotlight();};$('#refresh').onclick=()=>{if(held){$('#connection').textContent='Updates held — select Resume updates first';return;}refresh();};
 $('#freeze').onclick=()=>{held=!held;$('#freeze').setAttribute('aria-pressed',String(held));$('#freeze').textContent=held?'Resume updates':'Hold updates';$('#connection').textContent=held?'Updates held':'Refreshing…';if(!held)refresh();};
 $('#broadcast').onclick=()=>{const p=new URLSearchParams();if(key)p.set('key',key);p.set('screen','1');window.open('/host.html#'+p,'_blank','noopener');};
 refresh();setInterval(refresh,10000);
})();
