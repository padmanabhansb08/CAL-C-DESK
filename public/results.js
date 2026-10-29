/* Standings page: one renderer for every view (teams, players, kill graph, position graph),
   for a single match or the overall table. Markup is built once, in its final form. */
(function(root){
  const VIEWS=[['teams','Teams'],['players','Players'],['kills','Kill graph'],['positions','Position graph']];
  let chartTeam='';
  root.resultViews=VIEWS;
  root.viewLabel=v=>(VIEWS.find(([id])=>id===v)||VIEWS[0])[1];
  root.selectGraphTeam=value=>{chartTeam=value;render();};
  root.graphTeam=()=>chartTeam;

  // Shared ranks: equal values get the same rank number, the next distinct value skips ahead.
  function sharedRanks(items,same){return items.map((item,i)=>{let r=i;while(r>0&&same(items[r-1],item))r--;return r+1;});}
  function playerRows(match){
    const list=match.rows.flatMap(r=>r.players.map(p=>({...p,teamName:r.teamName})));
    list.sort((a,b)=>b.kills-a.kills||String(a.name).localeCompare(String(b.name)));
    const ranks=sharedRanks(list,(a,b)=>a.kills===b.kills);return list.map((p,i)=>({...p,rank:ranks[i]}));
  }
  function teamRows(match){
    if(match.isOverall)return match.rows;
    // A single match cannot tie: every team has a different finish.
    return rankedRows(match).map((r,i)=>({...r,rank:i+1}));
  }
  root.resultTeamRows=teamRows;root.resultPlayerRows=playerRows;

  function podium(match,rows){
    const top=rows.filter(r=>r.rank<=3).slice(0,6);if(!top.length)return '';
    const trophy='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h8v6a4 4 0 0 1-8 0V3m0 2H3v3a4 4 0 0 0 5 4m8-7h5v3a4 4 0 0 1-5 4M12 13v7m-5 1h10"/></svg>';
    const shared=rank=>rows.filter(r=>r.rank===rank).length>1;
    const ties=top.some(r=>shared(r.rank));
    return `<section class="results-podium${ties?' has-ties':''}" aria-label="Top teams by points">${top.map(row=>{const s=score(row),tie=shared(row.rank);
      return `<button type="button" class="podium-team podium-place-${row.rank}${tie?' podium-tied':''}" onclick="${match.isOverall?`overallBreakdown('${esc(row.teamId)}')`:`details('${esc(row.teamId)}')`}" aria-label="${esc(row.teamName)}, ${tie?'shared ':''}rank ${row.rank}, ${s.total} points. View details">
        <span class="podium-medal" aria-hidden="true">${row.rank===1?trophy:String(row.rank).padStart(2,'0')}</span>
        <span class="podium-name">${esc(row.teamName)}</span>
        <span class="podium-points">${s.total}<small>points</small></span>
        <span class="podium-meta">${s.kills} kills · ${match.isOverall?row.wins+(row.wins===1?' win':' wins'):'Finish #'+row.placement}</span>
        <span class="podium-step">${tie?'Shared ':''}#${row.rank}</span></button>`;}).join('')}</section>${ties?'<p class="caption podium-note">Teams with identical records share a rank and are listed by team name.</p>':''}`;
  }
  function teamTable(match,rows){
    const overall=match.isOverall;
    const head=overall?['Rank','Team',['Played','extra'],['Wins','extra'],'Kills',['Place pts','extra'],['Adj.','extra'],'Points','']
      :['Rank','Team',['Finish','extra'],'Kills',['Place pts','extra'],['Adj.','extra'],'Points',''];
    const th=h=>Array.isArray(h)?`<th class="col-${h[1]}" scope="col">${h[0]}</th>`:h?`<th scope="col">${h}</th>`:'<th scope="col" class="no-print"><span class="sr-only">Details</span></th>';
    const sign=v=>(v>0?'+':'')+v;
    return `<table class="standings-table"><thead><tr>${head.map(th).join('')}</tr></thead><tbody>${rows.map(r=>{const s=score(r),open=overall?`overallBreakdown('${esc(r.teamId)}')`:`details('${esc(r.teamId)}')`;
      return `<tr><td class="rank">${String(r.rank).padStart(2,'0')}</td><td class="team-cell"><strong>${esc(r.teamName)}</strong>${!overall&&r.placement===1?' <span class="badge">BOOYAH</span>':''}</td>${overall?`<td class="col-extra">${r.matches}</td><td class="col-extra">${r.wins}</td>`:`<td class="col-extra">#${r.placement}</td>`}<td>${s.kills}</td><td class="col-extra">${s.placement}</td><td class="col-extra">${sign(s.adjustment)}</td><td class="total">${s.total}</td><td class="no-print"><button type="button" class="row-details" onclick="${open}" aria-label="${overall?'Match breakdown':'Players, corrections and penalties'} for ${esc(r.teamName)}">Details</button></td></tr>`;}).join('')}</tbody></table>`;
  }
  function playerTable(match){
    const list=playerRows(match);
    return `<table class="standings-table"><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Team</th><th scope="col">${match.isOverall?'Total kills':'Kills'}</th></tr></thead><tbody>${list.map(p=>`<tr><td class="rank">${p.rank}</td><td class="team-cell"><strong>${esc(p.name)}</strong>${p.isSubstitute?' <span class="badge">SUB</span>':''}</td><td>${esc(p.teamName)}</td><td class="total">${p.kills}</td></tr>`).join('')}</tbody></table>`;
  }
  function graphPanel(match){
    const label=match.isOverall?'Across all '+match.matchCount+' saved matches':match.name;
    if(tab==='kills'){
      const rows=WarGraphs.kills(match),total=rows.reduce((sum,r)=>sum+r.kills,0);
      return `<div class="graph-heading"><div><span class="eyebrow">${esc(label)}</span><h2>Team eliminations</h2><p>${match.isOverall?'Cumulative':'This match’s'} kills by team. Higher is better.</p></div><div class="graph-metric"><strong>${total}</strong><span>TOTAL KILLS</span></div></div><div class="chart-scroll" id="export-graph">${WarGraphs.bars(rows,'kills','Team kill comparison')}</div><details class="chart-data"><summary>Show graph data</summary><table><thead><tr><th>Team</th><th>Kills</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.kills}</td></tr>`).join('')}</tbody></table></details>`;
    }
    if(match.isOverall){
      const teams=match.rows;if(!teams.some(t=>t.teamId===chartTeam))chartTeam=teams[0]?.teamId;const team=teams.find(t=>t.teamId===chartTeam),rows=WarGraphs.positions(state.matches,chartTeam),played=rows.filter(r=>r.placement!==null),average=played.length?(played.reduce((sum,r)=>sum+r.placement,0)/played.length).toFixed(1):'—';
      return `<div class="graph-heading"><div><span class="eyebrow">${esc(label)}</span><h2>Finishing position by match</h2><p>#1 is best. Gaps mean the team did not play that match.</p></div><div class="graph-metric"><strong>${average}</strong><span>AVERAGE FINISH</span></div></div><label class="graph-team-select">Team<select id="graph-team" onchange="selectGraphTeam(this.value)">${teams.map(t=>`<option value="${esc(t.teamId)}" ${t.teamId===chartTeam?'selected':''}>${esc(t.teamName)}</option>`).join('')}</select></label><div class="chart-scroll" id="export-graph">${WarGraphs.trend(rows,team?.teamName||'Team')}</div><details class="chart-data"><summary>Show graph data and match names</summary><table><thead><tr><th>Match order</th><th>Match</th><th>Finish</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.match)}</td><td>${r.placement===null?'Did not play':'#'+r.placement}</td></tr>`).join('')}</tbody></table></details>`;
    }
    const rows=match.rows.map(r=>({name:r.teamName,placement:r.placement})).sort((a,b)=>a.placement-b.placement);
    return `<div class="graph-heading"><div><span class="eyebrow">${esc(label)}</span><h2>Team finishing positions</h2><p>Actual match placement, independent of points. #1 is best; shorter bars mean a better finish.</p></div></div><div class="chart-scroll" id="export-graph">${WarGraphs.bars(rows,'placement','Match finishing positions. Number 1 is best.')}</div>`;
  }
  root.results=function(){
    if(!state.matches.length)return header('The scoreboard','Standings')+'<div class="panel empty"><h2>No matches recorded</h2><p>Your verified match tables and player leaderboards will appear here.</p><button class="primary brand-main-action" onclick="go(\'upload\')">Add the first match</button></div>';
    if(selected!=='__overall__'&&!state.matches.some(m=>m.id===selected))selected=state.matches.at(-1).id;
    const match=resultMatch();if(!VIEWS.some(([v])=>v===tab))tab='teams';
    const overall=match.isOverall,rows=teamRows(match);
    const actions=`<div class="actions">${overall?'':`<button type="button" class="icon-action-btn" onclick="deleteMatch()">${uiIcon('delete',{size:'sm'})}<span>Delete match</span></button>`}<button type="button" class="primary brand-main-action" id="export-results" onclick="exportResults()">${uiIcon('download',{size:'sm'})}<span>Export ${viewLabel(tab).toLowerCase()}</span></button></div>`;
    const select=`<label>Match<select id="match-select"><option value="__overall__" ${overall?'selected':''}>Overall points table · ${state.matches.length} match${state.matches.length===1?'':'es'}</option>${state.matches.map(x=>`<option value="${esc(x.id)}" ${!overall&&match.id===x.id?'selected':''}>${esc(x.name)} · ${esc(x.map)}</option>`).join('')}</select></label>`;
    const views=`<div class="tabs" role="group" aria-label="Result views">${VIEWS.map(([id,text])=>`<button type="button" class="${tab===id?'active':''}" aria-pressed="${tab===id}" onclick="tab='${id}';render()">${text}</button>`).join('')}</div>`;
    const context=overall?`Totals across all ${match.matchCount} saved matches, including practice and every set. Equal records share a rank.`
      :`${esc(match.map)} · ${match.stage?'Set '+esc(match.stage):'Practice'} · ${new Date(match.created).toLocaleDateString('en-IN')}`;
    let body;
    if(tab==='teams')body=`${podium(match,rows)}<section class="panel table-wrap">${teamTable(match,rows)}</section><p class="caption">Ranking: points → kills → ${overall?'wins':'Booyah'} → placement points.${overall?' Only teams that played are included.':''}</p>`;
    else if(tab==='players')body=`<section class="panel table-wrap">${playerTable(match)}</section><p class="caption">${overall?'Total kills across saved matches; substitutes included.':'Kills in this match; substitutes included.'}</p>`;
    else body=`<section class="panel graph-panel">${graphPanel(match)}</section>`;
    return header(overall?'All saved matches':'Verified match results',overall?'Overall points table':esc(match.name),actions)+`<div class="results-toolbar no-print"><div class="form-grid no-print results-controls compact-results-controls">${select}<button type="button" class="manage-matches" onclick="openMatchManager()">Manage matches</button></div>${views}</div><p class="results-context">${context}</p>${body}`;
  };

  function csv(records,name){
    const text='﻿'+records.map(row=>row.map(value=>'"'+String(value).replace(/^[=+@\-]/,"'$&").replaceAll('"','""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  root.fileStem=match=>match.isOverall?'overall':String(match.name).replace(/[^a-z0-9]/gi,'-');
  // CSV of exactly the view on screen.
  root.downloadCSV=function(){
    const match=resultMatch();if(!match)return;let records;
    if(tab==='teams')records=match.isOverall?[['Rank','Team','Matches','Wins','Kills','Placement points','Adjustment','Total'],...match.rows.map(r=>[r.rank,r.teamName,r.matches,r.wins,r.kills,r.placementPoints,r.adjustment,r.total])]
      :[['Rank','Team','Finish','Kills','Placement points','Adjustment','Total'],...teamRows(match).map(r=>{const s=score(r);return [r.rank,r.teamName,r.placement,s.kills,s.placement,s.adjustment,s.total];})];
    else if(tab==='players')records=[['Rank','Player','Team','Kills'],...playerRows(match).map(p=>[p.rank,p.name,p.teamName,p.kills])];
    else if(tab==='kills')records=[['Team','Kills'],...WarGraphs.kills(match).map(r=>[r.name,r.kills])];
    else if(match.isOverall){const team=match.rows.find(r=>r.teamId===chartTeam)||match.rows[0];records=[['Team','Match','Finishing position'],...WarGraphs.positions(state.matches,team?.teamId).map(r=>[team?.teamName||'',r.match,r.placement??'Did not play'])];}
    else records=[['Team','Finishing position'],...match.rows.slice().sort((a,b)=>a.placement-b.placement).map(r=>[r.teamName,r.placement])];
    csv(records,fileStem(match)+'-'+tab+'.csv');
  };
})(window);
