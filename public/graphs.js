/* Charts derive exclusively from verified saved results. */
(function(root){
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function kills(match){return match.rows.map(r=>({teamId:r.teamId,name:r.teamName,kills:r.overall?r.kills:r.players.reduce((sum,p)=>sum+p.kills,0)})).sort((a,b)=>b.kills-a.kills||String(a.name).localeCompare(String(b.name)));}
 function positions(matches,teamId){return matches.map(m=>{const row=m.rows.find(r=>r.teamId===teamId);return {match:m.name,placement:row?.placement??null};});}
 function bars(rows,field,label){
  const width=880,height=rows.length*43+70,start=240,end=818,max=Math.max(1,...rows.map(r=>r[field]));
  return `<svg class="result-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(label)}"><title>${escape(label)}</title>${[0,.25,.5,.75,1].map(t=>`<line x1="${start+(end-start)*t}" y1="12" x2="${start+(end-start)*t}" y2="${height-43}" stroke="#352b31"/><text x="${start+(end-start)*t}" y="${height-19}" text-anchor="middle" fill="#A8A3A3" font-size="15">${Math.round(max*t*10)/10}</text>`).join('')}${rows.map((r,i)=>{const y=18+i*43,w=(end-start)*r[field]/max;return `<g tabindex="0"><title>${escape(r.name)}: ${field==='placement'?'position #':''}${r[field]}${field==='kills'?' kills':''}</title><text x="15" y="${y+18}" fill="#FFFFFF" font-size="17">${escape(r.name)}</text><rect x="${start}" y="${y}" width="${Math.max(0,w)}" height="27" rx="5" fill="${field==='placement'&&r[field]===1?'#B8962E':field==='kills'&&i===0?'#E50914':'#A8A3A3'}"/><text x="${Math.min(end+34,start+w+12)}" y="${y+18}" fill="#FFFFFF" font-size="17">${field==='placement'?'#':''}${r[field]}</text></g>`;}).join('')}</svg>`;
 }
 function trend(rows,name){
  const width=Math.max(880,rows.length*60+140),right=width-64,middle=(74+right)/2,x=i=>rows.length===1?middle:74+i*(right-74)/(rows.length-1),y=p=>42+(p-1)*25,segments=[];let segment=[];
  rows.forEach((r,i)=>{if(r.placement===null){if(segment.length)segments.push(segment);segment=[];}else segment.push([x(i),y(r.placement)]);});if(segment.length)segments.push(segment);
  return `<svg class="result-chart trend-chart" style="min-width:${rows.length>12?width:560}px" viewBox="0 0 ${width} 390" role="img" aria-label="Finishing position by match for ${escape(name)}"><title>Finishing position by match for ${escape(name)}. Number 1 is best.</title>${[1,3,6,9,12].map(p=>`<line x1="74" y1="${y(p)}" x2="${right}" y2="${y(p)}" stroke="#352b31"/><text x="50" y="${y(p)+4}" text-anchor="end" fill="#A8A3A3" font-size="16">#${p}</text>`).join('')}${segments.map(points=>`<polyline points="${points.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#E50914" stroke-width="3"/>`).join('')}${rows.map((r,i)=>`<text x="${x(i)}" y="354" text-anchor="middle" fill="#A8A3A3" font-size="15">${i+1}</text>${r.placement===null?'':`<g tabindex="0"><title>${escape(r.match)}: position #${r.placement}</title><circle cx="${x(i)}" cy="${y(r.placement)}" r="7" fill="${r.placement===1?'#B8962E':'#E50914'}" stroke="#FFFFFF" stroke-width="2"/><text x="${x(i)}" y="${y(r.placement)-14}" text-anchor="middle" fill="#FFFFFF" font-size="16">#${r.placement}</text></g>`}`).join('')}<text x="${middle}" y="382" text-anchor="middle" fill="#A8A3A3" font-size="15">SAVED MATCH ORDER</text></svg>`;
 }
 const api={kills,positions,bars,trend};if(typeof module!=='undefined')module.exports=api;else root.WarGraphs=api;
})(typeof window==='undefined'?globalThis:window);

if(typeof window!=='undefined'){
 (function(){
  const previousResults=results,previousCSV=downloadCSV,previousPrint=printResults;let chartTeam='';
  window.selectGraphTeam=function(value){chartTeam=value;render();};
  results=function(){
   const html=previousResults(),root=document.createElement('div');root.innerHTML=html;const tabs=root.querySelector('.tabs');if(!tabs)return html;
   tabs.insertAdjacentHTML('beforeend',`<button class="${tab==='kills'?'active':''}" onclick="tab='kills';render()">Kill graph</button><button class="${tab==='positions'?'active':''}" onclick="tab='positions';render()">Position graph</button>`);
   if(tab!=='kills'&&tab!=='positions')return root.innerHTML;
   const match=resultMatch();if(!match)return root.innerHTML;const panel=root.querySelector('section.table-wrap');if(!panel)return root.innerHTML;
   panel.className='panel graph-panel';const label=match.isOverall?'Across all '+match.matchCount+' saved matches':match.name;
   if(tab==='kills'){
    const rows=WarGraphs.kills(match),total=rows.reduce((sum,r)=>sum+r.kills,0);
    panel.innerHTML=`<div class="graph-heading"><div><span class="eyebrow">${esc(label)}</span><h2>Team eliminations</h2><p>Compare ${match.isOverall?'cumulative':'this match’s'} kills by team. Higher is better.</p></div><div class="graph-metric"><strong>${total}</strong><span>TOTAL KILLS</span></div></div><div class="chart-scroll">${WarGraphs.bars(rows,'kills','Team kill comparison')}</div><details class="chart-data"><summary>Show graph data</summary><table><thead><tr><th>Team</th><th>Kills</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.kills}</td></tr>`).join('')}</tbody></table></details>`;
   }else if(match.isOverall){
    const teams=match.rows;if(!teams.some(t=>t.teamId===chartTeam))chartTeam=teams[0]?.teamId;const team=teams.find(t=>t.teamId===chartTeam),rows=WarGraphs.positions(state.matches,chartTeam),played=rows.filter(r=>r.placement!==null),average=played.length?(played.reduce((sum,r)=>sum+r.placement,0)/played.length).toFixed(1):'—';
    panel.innerHTML=`<div class="graph-heading"><div><span class="eyebrow">${esc(label)}</span><h2>Finishing position by match</h2><p>#1 is best. Gaps mean the team did not play that match.</p></div><div class="graph-metric"><strong>${average}</strong><span>AVERAGE FINISH</span></div></div><label class="graph-team-select">Team<select id="graph-team" onchange="selectGraphTeam(this.value)">${teams.map(t=>`<option value="${t.teamId}" ${t.teamId===chartTeam?'selected':''}>${esc(t.teamName)}</option>`).join('')}</select></label><div class="chart-scroll">${WarGraphs.trend(rows,team?.teamName||'Team')}</div><details class="chart-data"><summary>Show graph data and match names</summary><table><thead><tr><th>Match order</th><th>Match</th><th>Finish</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.match)}</td><td>${r.placement===null?'Did not play':'#'+r.placement}</td></tr>`).join('')}</tbody></table></details>`;
   }else{
    const rows=match.rows.map(r=>({name:r.teamName,placement:r.placement})).sort((a,b)=>a.placement-b.placement);
    panel.innerHTML=`<div class="graph-heading"><div><span class="eyebrow">${esc(label)}</span><h2>Team finishing positions</h2><p>Actual match placement, independent of points. #1 is best; shorter bars mean a better finish.</p></div></div><div class="chart-scroll">${WarGraphs.bars(rows,'placement','Match finishing positions. Number 1 is best.')}</div>`;
   }
   Array.from(root.children).filter(node=>node.matches('p.caption')).forEach(node=>node.remove());
   return root.innerHTML;
  };
  downloadCSV=function(){
   if(tab!=='kills'&&tab!=='positions')return previousCSV();
   const match=resultMatch();let records;
   if(tab==='kills')records=[['Team','Kills'],...WarGraphs.kills(match).map(r=>[r.name,r.kills])];
   else if(match.isOverall){const team=match.rows.find(r=>r.teamId===chartTeam)||match.rows[0];records=[['Team','Match','Finishing position'],...WarGraphs.positions(state.matches,team?.teamId).map(r=>[team?.teamName||'',r.match,r.placement??'Did not play'])];}
   else records=[['Team','Finishing position'],...match.rows.slice().sort((a,b)=>a.placement-b.placement).map(r=>[r.teamName,r.placement])];
   const csv='\ufeff'+records.map(row=>row.map(value=>'"'+String(value).replace(/^[=+@\-]/,"'$&").replaceAll('"','""')+'"').join(',')).join('\r\n'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=(match.isOverall?'overall':match.name.replace(/[^a-z0-9]/gi,'-'))+'-'+tab+'-graph.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  printResults=function(){if(tab==='kills'||tab==='positions'){window.print();return;}return previousPrint();};
 })();
}


