/* Derived standings only: saved match rows and adjustments are never modified. */
(function(root){
 const placementPoints=[12,9,8,7,6,5,4,3,2,1,0,0];
 // Teams that should have a result in this match but do not. Only a partial match can have gaps, and only when the lobby is
 // known: a saved pool, or a roster of 12 or fewer teams. With a larger roster and no pool nobody is flagged (never guess).
 function missingTeams(state,match){
  if(match.rows.length>=12)return [];
  const pool=match.pool||(state.teams.length<=12?state.teams.map(t=>t.id):[]);
  return pool.filter(id=>!match.rows.some(r=>r.teamId===id));
 }
 function aggregate(state){
  const teams=new Map();
  for(const match of state.matches)for(const row of match.rows){
   let team=teams.get(row.teamId);if(!team){team={teamId:row.teamId,teamName:state.teams.find(t=>t.id===row.teamId)?.name||row.teamName,matches:0,kills:0,placementPoints:0,adjustment:0,total:0,wins:0,players:[],breakdown:[]};teams.set(row.teamId,team);}
   const kills=row.players.reduce((sum,p)=>sum+p.kills,0),place=placementPoints[row.placement-1],adjustment=(row.adjustments||[]).reduce((sum,a)=>sum+a.value,0);
   team.matches++;team.kills+=kills;team.placementPoints+=place;team.adjustment+=adjustment;team.total+=kills+place+adjustment;team.wins+=row.placement===1?1:0;
   team.breakdown.push({id:match.id,name:match.name,placement:row.placement,kills,place,adjustment,total:kills+place+adjustment});
   const roster=state.teams.find(t=>t.id===row.teamId)?.players||[];
   // Players are grouped by ID, and shown under their current roster name (a spelling fix renames, it does not split).
   // Match-only substitutes count towards the team's kills above but are not tracked as players.
   for(const player of row.players){if(player.isSubstitute)continue;let entry=team.players.find(p=>p.playerId===player.playerId);if(!entry){entry={...player,name:roster.find(p=>p.id===player.playerId)?.name||player.name,kills:0};team.players.push(entry);}entry.kills+=player.kills;}
  }
  // A match without a team's row is a missing result for that team: it adds nothing and is never counted as a zero.
  const gaps=new Map(state.matches.map(m=>[m.id,new Set(missingTeams(state,m))]));
  // A team missing from every match still belongs in the table, with its gaps shown.
  for(const set of gaps.values())for(const id of set)if(!teams.has(id)){const t=state.teams.find(x=>x.id===id);if(t)teams.set(id,{teamId:id,teamName:t.name,matches:0,kills:0,placementPoints:0,adjustment:0,total:0,wins:0,players:[],breakdown:[]});}
  for(const team of teams.values()){
   team.timeline=state.matches.map(match=>team.breakdown.find(b=>b.id===match.id)||(gaps.get(match.id).has(team.teamId)?{id:match.id,name:match.name,missing:true}:{id:match.id,name:match.name,absent:true}));
   team.missing=team.timeline.filter(t=>t.missing).length;}
  const rows=[...teams.values()].sort((a,b)=>b.total-a.total||b.kills-a.kills||b.wins-a.wins||b.placementPoints-a.placementPoints||String(a.teamName).localeCompare(String(b.teamName)));
  rows.forEach((row,i)=>{const previous=rows[i-1];row.rank=previous&&previous.total===row.total&&previous.kills===row.kills&&previous.wins===row.wins&&previous.placementPoints===row.placementPoints?previous.rank:i+1;row.overall=true;});
  return {id:'__overall__',isOverall:true,name:'Overall points table',map:'All maps',created:state.matches.at(-1)?.created||new Date().toISOString(),matchCount:state.matches.length,provisional:rows.some(r=>r.missing>0),rows};
 }
 const api={aggregate,missingTeams};if(typeof module!=='undefined')module.exports=api;else root.WarOverall=api;
})(typeof window==='undefined'?globalThis:window);

if(typeof window!=='undefined'){
 window.overallBreakdown=function(teamId){const team=WarOverall.aggregate(state).rows.find(r=>r.teamId===teamId);if(!team)return;modal(`<h2>${esc(team.teamName)}</h2><p>${team.total} total points across ${team.matches} matches.</p><div class="table-wrap"><table><thead><tr><th>Match</th><th>Finish</th><th>Kills</th><th>Placement pts</th><th>Adjustment</th><th>Total</th></tr></thead><tbody>${team.timeline.filter(r=>!r.absent).map(r=>r.missing?`<tr><td>${esc(r.name)}</td><td colspan="5">Missing — no verified result (not counted as zero)</td></tr>`:`<tr><td>${esc(r.name)}</td><td>#${r.placement}</td><td>${r.kills}</td><td>${r.place}</td><td>${r.adjustment}</td><td>${r.total}</td></tr>`).join('')}</tbody></table></div><p class="caption">Open an individual match to correct kills or finish, or to apply point adjustments.</p><div class="actions"><button onclick="closeModal()">Close</button></div>`);};
}
