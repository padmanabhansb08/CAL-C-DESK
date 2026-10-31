/* Shared caster calculations. Standings use the same aggregate as the organizer. */
(function(root){
 function analyze(state,aggregate){
  const overall=aggregate(state),previous=aggregate({...state,matches:state.matches.slice(0,-1)}),latest=state.matches.at(-1);
  const teams=overall.rows.map(t=>{
   const old=previous.rows.find(p=>p.teamId===t.teamId),history=t.breakdown;
   return {...t,change:old?old.rank-t.rank:null,averageKills:t.kills/t.matches,averagePoints:t.total/t.matches,
    averageFinish:history.reduce((s,r)=>s+r.placement,0)/history.length,
    winRate:100*t.wins/t.matches,gap:overall.rows[0].total-t.total,
    form:history.slice(-3),killShare:t.kills?Math.max(...t.players.map(p=>p.kills),0)/t.kills*100:0};
  });
  const players=teams.flatMap(t=>t.players.map(p=>({...p,teamName:t.teamName,teamId:t.teamId}))).sort((a,b)=>b.kills-a.kills||a.name.localeCompare(b.name));
  const stories=[];
  if(teams.length>1){const a=teams[0],b=teams[1],gap=a.total-b.total;
   stories.push({label:'Title race',text:gap?`${a.teamName} leads ${b.teamName} by ${gap} points.`:`${a.teamName} and ${b.teamName} are level on ${a.total} points.`,detail:'Overall points include placement, kills and adjustments.'});
  }
  const movers=teams.filter(t=>t.change>0).sort((a,b)=>b.change-a.change);
  if(movers.length){const t=movers[0];stories.push({label:'Biggest climb',text:`${t.teamName} gained ${t.change} ${t.change===1?'place':'places'} to reach #${t.rank}.`,detail:`Compared with the standings before ${latest.name}.`});}
  if(latest){const winner=latest.rows.find(r=>r.placement===1);if(winner){const t=teams.find(t=>t.teamId===winner.teamId);stories.push({label:'Latest Booyah',text:`${t?.teamName||winner.teamName} won ${latest.name} with ${winner.players.reduce((s,p)=>s+p.kills,0)} kills.`,detail:`${latest.map} · ${latest.rows.length} teams`});}}
  if(players.length){const top=players.filter(p=>p.kills===players[0].kills);stories.push({label:'Fragging leaders',text:`${top.slice(0,3).map(p=>p.name+' ('+p.teamName+')').join(', ')}${top.length>3?' and '+(top.length-3)+' others':''} ${top.length===1?'leads':'share the lead'} with ${players[0].kills} kills.`,detail:'Total player kills across saved matches; unregistered substitutes are not ranked.'});}
  teams.forEach(t=>{const h=t.breakdown;if(h.length>=6){const mean=a=>a.reduce((s,r)=>s+r.kills,0)/a.length,a=mean(h.slice(-6,-3)),b=mean(h.slice(-3));if(b-a>=1)stories.push({label:'Rising form',text:`${t.teamName}: ${b.toFixed(1)} kills per match in their last 3, up from ${a.toFixed(1)}.`,detail:'Compared with their previous 3 appearances.'});}});
  return {overall,teams,players,stories,latest};
 }
 if(typeof module!=='undefined')module.exports={analyze};else root.HostStats={analyze};
})(typeof window==='undefined'?globalThis:window);
