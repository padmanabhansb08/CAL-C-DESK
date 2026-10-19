/* Insights use saved match results only; no estimates or death-based ratios. */
(function(root){
  const points=[12,9,8,7,6,5,4,3,2,1,0,0];
  function build(state){
    const matches=state.matches||[],teams=state.teams||[];
    if(!matches.length)return ['FFK PRASANTH IS LIVE'];
    const name=row=>teams.find(t=>t.id===row.teamId)?.name||row.teamName||'Team';
    const kills=row=>row.players.reduce((sum,p)=>sum+p.kills,0);
    function standings(list){
      const map=new Map();
      list.forEach(m=>m.rows.forEach(r=>{const t=map.get(r.teamId)||{id:r.teamId,name:name(r),total:0,kills:0,wins:0,place:0};
        const k=kills(r),p=points[r.placement-1]||0;
        t.kills+=k;t.place+=p;t.wins+=r.placement===1?1:0;t.total+=k+p+(r.adjustments||[]).reduce((s,a)=>s+a.value,0);map.set(t.id,t);
      }));
      const rows=[...map.values()].sort((a,b)=>b.total-a.total||b.kills-a.kills||b.wins-a.wins||b.place-a.place||a.name.localeCompare(b.name));
      rows.forEach((t,i)=>{const prev=rows[i-1];t.rank=prev&&t.total===prev.total&&t.kills===prev.kills&&t.wins===prev.wins&&t.place===prev.place?prev.rank:i+1;});
      return rows;
    }
    const messages=[],current=standings(matches),previous=standings(matches.slice(0,-1)),latest=matches.at(-1);
    const history=new Map();matches.forEach(m=>m.rows.forEach(r=>{if(!history.has(r.teamId))history.set(r.teamId,[]);history.get(r.teamId).push(kills(r));}));
    current.forEach(t=>{
      const values=history.get(t.id);
      if(values.length>=6){const avg=v=>v.reduce((a,b)=>a+b,0)/v.length,old=avg(values.slice(-6,-3)),recent=avg(values.slice(-3));
        if(recent-old>=1)messages.push(`${t.name} averaged ${Number(recent.toFixed(1))} kills in their last 3 matches, up from ${Number(old.toFixed(1))} in the previous 3.`);
      }
    });
    if(current.length>1){const gap=current[0].total-current[1].total;
      if(gap>0)messages.push(`${current[0].name} leads the overall standings by ${gap} ${gap===1?'point':'points'}.`);
      else messages.push(`${current[0].name} and ${current[1].name} share ${current[0].total} points at the top.`);
    }
    current.forEach(t=>{const old=previous.find(p=>p.id===t.id);if(old&&old.rank>t.rank)messages.push(`${t.name} climbed from #${old.rank} to #${t.rank} overall after ${latest.name}.`);});
    const rows=latest.rows,highest=Math.max(0,...rows.map(kills)),leaders=rows.filter(r=>kills(r)===highest);
    if(highest>0&&leaders.length)messages.push(`${leaders.slice(0,2).map(name).join(' and ')}${leaders.length>2?' and '+(leaders.length-2)+' other teams':''} ${leaders.length===1?'led':'shared the lead in'} ${latest.name} with ${highest} kills${leaders.length>1?' each':''}.`);
    const winner=rows.find(r=>r.placement===1);if(winner)messages.push(`${name(winner)} won ${latest.name} with ${kills(winner)} kills.`);
    if(!messages.length)messages.push(`${matches.length} ${matches.length===1?'match saved':'matches saved'} · Overall standings are up to date.`);
    return messages.slice(0,12);
  }
  function mount(bar,state){
    const messages=build(state),region=document.createElement('div');region.className='insights-ticker';region.setAttribute('role','region');region.setAttribute('aria-label','Match insights');
    const viewport=document.createElement('div');viewport.className='insights-viewport';const track=document.createElement('div');track.className='insights-track';
    const group=document.createElement('div');group.className='insights-group';
    messages.forEach(message=>{const item=document.createElement('span');item.className='insight-item';item.textContent=message;group.append(item);});
    const duplicate=group.cloneNode(true);duplicate.setAttribute('aria-hidden','true');track.append(group,duplicate);track.style.animationDuration=Math.max(18,messages.join('').length/11)+'s';viewport.append(track);
    const label=document.createElement('span');label.className='insights-label';label.textContent='MATCH INSIGHTS';
    const pause=document.createElement('button');pause.type='button';pause.className='insights-pause';pause.textContent='Ⅱ';pause.setAttribute('aria-label','Pause insights');pause.setAttribute('aria-pressed','false');
    function toggle(){const stopped=region.classList.toggle('is-paused');pause.textContent=stopped?'▶':'Ⅱ';pause.setAttribute('aria-label',stopped?'Play insights':'Pause insights');pause.setAttribute('aria-pressed',String(stopped));}
    pause.onclick=toggle;
    region.append(label,viewport,pause);bar.prepend(region);
    const distance=Math.max(group.getBoundingClientRect().width,viewport.clientWidth);
    group.style.minWidth=viewport.clientWidth+'px';duplicate.style.minWidth=viewport.clientWidth+'px';
    track.style.animationDuration=Math.max(15,distance/65)+'s';
  }
  const api={build,mount};if(typeof module!=='undefined')module.exports=api;else root.WarInsights=api;
})(typeof window==='undefined'?globalThis:window);
