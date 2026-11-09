/* Broadcast standings screen (host.html#screen=1): a 1920 x 1080 FFK stage for OBS, in the same style as the map wheel.
   host.js fetches the results and calls BroadcastScreen.render(); this file only draws. Standings use the same
   aggregate as the desk, so the numbers on stream always match the organizer's. */
(function(){
  const ART={bermuda:'bermuda-map.jpeg',purgatory:'purgatory-map.jpg',kalahari:'kalahari-map.jpg',nexterra:'nexterra-map.png',solara:'solara-map.jpg',alpine:'alpine-map.jpg'};
  const PAGE=12,PAGE_MS=12000;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const art=map=>ART[String(map||'').toLowerCase().replace(/[^a-z]/g,'')];
  let stage=null,lastTotals=new Map(),lastSignature='',first=true,pageTimer=null,page=0,current=null;

  // ---------- Stage (built once) ----------
  const CROWN=`<svg viewBox="0 0 64 40" aria-hidden="true"><path d="M6 36 L2 8 L18 20 L32 2 L46 20 L62 8 L58 36 Z" fill="none" stroke="#f5f5f5" stroke-width="4" stroke-linejoin="round"/><circle cx="2" cy="8" r="3" fill="#f5f5f5"/><circle cx="32" cy="2" r="3" fill="#f5f5f5"/><circle cx="62" cy="8" r="3" fill="#f5f5f5"/><path d="M14 30 H50" stroke="#ff2a1a" stroke-width="4"/></svg>`;
  // Brand lockup: the channel avatar in a glowing red ring, a white crown, and the FFK PRASANTH wordmark.
  const BRAND=(tag)=>`<div class="ffk-brand"><span class="ffk-ring"><img src="assets/ffk-avatar.jpg" alt=""></span><div class="ffk-word"><i class="ffk-crown">${CROWN}</i><b>FFK</b><strong>PRASANTH</strong><span class="ffk-tag">${tag}</span></div></div>`;
  function build(){
    document.body.classList.add('bc-on');
    const vp=document.createElement('div');vp.id='bc-viewport';
    vp.innerHTML=`<div id="bc-stage" aria-live="polite"><div class="ffk-smoke" aria-hidden="true"></div><img class="bc-mascot" src="assets/ffk-mascot.webp" alt="" aria-hidden="true"><i class="ffk-slash tl" aria-hidden="true"></i><i class="ffk-slash br" aria-hidden="true"></i>
      <canvas id="bc-bolts" width="1920" height="1080" aria-hidden="true"></canvas><canvas id="bc-embers" width="1920" height="1080" aria-hidden="true"></canvas>
      <section class="bc-left"><div class="bc-title"><span class="bc-chip" id="bc-chip"></span><h1 id="bc-h1"></h1><p class="bc-context" id="bc-context"></p></div><div id="bc-body"></div></section>
      <aside class="bc-right"><header class="bc-brand">${BRAND('LIVE STANDINGS')}</header><div id="bc-cards"></div></aside>
      <div class="bc-banner" id="bc-banner" hidden><span>STANDINGS UPDATED</span><b id="bc-banner-text"></b></div>
      <footer class="ffk-footer"><canvas width="1920" height="70" aria-hidden="true"></canvas><span class="ffk-foot-l">ONE TEAM · ONE DREAM</span><span class="ffk-emblem"><i class="ffk-crown">${CROWN}</i>FFK</span><span class="ffk-foot-r">STRONGER TOGETHER</span></footer></div>`;
    document.body.prepend(vp);stage=vp.querySelector('#bc-stage');
    const fit=()=>{const s=Math.min(innerWidth/1920,innerHeight/1080);stage.style.transform=`translate(-50%,-50%) scale(${s})`;};
    addEventListener('resize',fit);fit();embers();
    if(window.BrandFX){BrandFX.lightning(stage.querySelector('#bc-bolts'));BrandFX.wave(stage.querySelector('.ffk-footer canvas'));}
  }
  function embers(){
    const ctx=stage.querySelector('#bc-embers').getContext('2d'),dots=Array.from({length:55},()=>({x:Math.random()*1920,y:Math.random()*1080,r:1+Math.random()*2.6,v:.3+Math.random()*1,d:Math.random()*6}));
    const still=matchMedia('(prefers-reduced-motion: reduce)').matches;
    (function tick(){ctx.clearRect(0,0,1920,1080);for(const e of dots){if(!still){e.y-=e.v;e.x+=Math.sin(e.d+=.02)*.5;if(e.y<-10){e.y=1090;e.x=Math.random()*1920;}}
      ctx.beginPath();ctx.arc(e.x,e.y,e.r,0,7);ctx.fillStyle=`rgba(255,${60+e.r*25|0},40,${.25+e.r*.1})`;ctx.shadowColor='#ff3b1a';ctx.shadowBlur=8;ctx.fill();}
      if(!still)requestAnimationFrame(tick);})();
  }

  // ---------- Numbers that count up ----------
  function countUp(root){
    root.querySelectorAll('[data-count]').forEach(el=>{const to=+el.dataset.count,from=+(el.dataset.from??to);if(from===to){el.textContent=to;return;}
      const t0=performance.now(),run=now=>{const k=Math.min(1,(now-t0)/900),e=1-Math.pow(1-k,3);el.textContent=Math.round(from+(to-from)*e);if(k<1)requestAnimationFrame(run);};requestAnimationFrame(run);});
  }

  // ---------- Standings ----------
  function cutFor(set,state){return set==='A'||set==='B'?6:set==='C'?4:0;}
  function move(t){
    if(t.change===null||t.change===undefined)return '<span class="bc-move new">NEW</span>';
    if(t.change>0)return `<span class="bc-move up">▲ ${t.change}</span>`;
    if(t.change<0)return `<span class="bc-move down">▼ ${-t.change}</span>`;
    return '<span class="bc-move same">—</span>';
  }
  function rowsHTML(teams,cut,animate){
    let html='';
    teams.forEach((t,i)=>{
      const medal=t.rank===1?' gold':t.rank===2?' silver':t.rank===3?' bronze':'',zone=cut&&t.rank<=cut?' in':'',prev=lastTotals.get(t.teamId);
      const bumped=animate&&prev!==undefined&&prev!==t.total?' bumped':'';
      html+=`<div class="bc-row${medal}${zone}${bumped}" style="--i:${i}"><span class="bc-rank">${t.rank??'—'}</span><span class="bc-team">${esc(t.teamName)}${t.rank===1&&t.matches?`<i class="bc-crown">${CROWN}</i>`:''}</span><span>${t.matches}</span><span>${t.wins}</span><span>${t.kills}</span><span>${t.placementPoints}</span><span class="bc-pts" data-count="${t.total}" data-from="${animate&&prev!==undefined?prev:t.total}">${t.total}</span>${move(t)}</div>`;
      if(cut&&t.rank<=cut&&teams[i+1]&&teams[i+1].rank>cut)html+=`<div class="bc-cut" style="--i:${i}"><span>TOP ${cut} ADVANCE${cut===6?' TO THE SEMI-FINAL':' TO THE FINALS'}</span></div>`;
    });
    return html;
  }
  function standings(teams,cut,animate){
    const pages=Math.max(1,Math.ceil(teams.length/PAGE));page=Math.min(page,pages-1);
    const shown=teams.slice(page*PAGE,(page+1)*PAGE);
    stage.querySelector('#bc-body').innerHTML=`<div class="bc-table${animate?' animate':''}"><div class="bc-head"><span>#</span><span>TEAM</span><span>M</span><span>BOOYAH</span><span>KILLS</span><span>PLACE</span><span>POINTS</span><span>MOVE</span></div>${rowsHTML(shown,cut,animate)}</div>${pages>1?`<div class="bc-pages">${Array.from({length:pages},(_,i)=>`<i class="${i===page?'on':''}"></i>`).join('')}<span>TEAMS ${page*PAGE+1}–${page*PAGE+shown.length} OF ${teams.length}</span></div>`:''}`;
    countUp(stage.querySelector('#bc-body'));
    clearInterval(pageTimer);
    if(pages>1)pageTimer=setInterval(()=>{page=(page+1)%pages;standings(teams,cut,true);},PAGE_MS);
  }
  function tracker(scoped,set,target){
    const played=scoped.matches,total=Math.max(target||0,played.length);if(!total)return '';
    return `<article class="bc-card bc-tracker"><span class="bc-kicker">MATCH TRACKER · ${played.length} OF ${total}</span><ol>${Array.from({length:total},(_,i)=>{const m=played[i],pic=m&&art(m.map);
      return `<li class="${m?'done':i===played.length?'next':''}"${pic?` style="--art:url('assets/${pic}')"`:''}><b>${i+1}</b><span>${m?esc(m.map||'PLAYED'):i===played.length?'NEXT':''}</span></li>`;}).join('')}</ol></article>`;
  }
  function cards(stats,set,scoped,target){
    const {teams,players,latest}=stats,leader=teams[0],second=teams[1];
    const win=latest?.rows.find(r=>r.placement===1),winner=win&&teams.find(t=>t.teamId===win.teamId);
    const top=players[0],fraggers=top?players.filter(p=>p.kills===top.kills):[];
    const picture=latest&&art(latest.map);
    return `<article class="bc-card bc-leader"><span class="bc-kicker">${CROWN} CURRENT LEADER</span><strong class="bc-big">${esc(leader.teamName)}</strong>
      <div class="bc-stats"><div><b data-count="${leader.total}" data-from="${lastTotals.get(leader.teamId)??leader.total}">${leader.total}</b><small>POINTS</small></div><div><b>${leader.kills}</b><small>KILLS</small></div><div><b>${leader.wins}</b><small>BOOYAH</small></div><div><b>${second?(leader.total-second.total?'+'+(leader.total-second.total):'LEVEL'):'—'}</b><small>${second?'LEAD':'AHEAD'}</small></div></div></article>
      ${top?`<article class="bc-card bc-fragger"><span class="bc-kicker">TOP FRAGGER</span><div class="bc-frag"><div><strong>${esc(top.name)}</strong><small>${esc(top.teamName)}${fraggers.length>1?` · TIED WITH ${fraggers.length-1} MORE`:''}</small></div><b>${top.kills}<small>KILLS</small></b></div></article>`:''}
      ${win?`<article class="bc-card bc-booyah"${picture?` style="--art:url('assets/${picture}')"`:''}><span class="bc-kicker">LATEST BOOYAH · ${esc(latest.name)}</span><strong class="bc-big">${esc(winner?.teamName||win.teamName)}</strong><span class="bc-sub">${esc(latest.map||'')}${latest.map?' · ':''}${win.players.reduce((s,p)=>s+p.kills,0)} KILLS</span></article>`:''}${tracker(scoped,set,target)}`;
  }

  // ---------- Finals bracket ----------
  function bracket(state,teamName){
    const w=state.war||{},cs=w.csFormat==='page-playoff-v1'?(w.cs||{}):{},seeds=w.qualified?.C||[];
    const fx=(k,label,pair)=>{const r=cs[k];return `<article class="bc-fixture${r?' done':''}"><h3>${label}</h3>${pair.map((id,i)=>`<div class="${r?.winner&&r.winner===id?'win':r?'lose':''}"><span>${esc(id?teamName(id):'TO BE DECIDED')}</span><b>${r?r.scores[i]:'–'}</b></div>`).join('')}</article>`;};
    return `${cs.final?`<div class="bc-champion">${CROWN}<span>FFK WAR CHAMPION</span><strong>${esc(teamName(cs.final.winner))}</strong></div>`:''}
      <div class="bc-bracket"><div class="bc-col">${fx('q1','QUALIFIER 1',[seeds[0],seeds[1]])}${fx('eliminator','ELIMINATOR',[seeds[2],seeds[3]])}</div>
      <div class="bc-col mid">${fx('q2','QUALIFIER 2',[cs.q1?.loser,cs.eliminator?.winner])}</div><div class="bc-col end">${fx('final','GRAND FINAL',[cs.q1?.winner,cs.q2?.winner])}</div></div>`;
  }

  // ---------- Entry ----------
  function title(set,label){
    const words={all:['OVERALL','STANDINGS'],A:['SET A','STANDINGS'],B:['SET B','STANDINGS'],C:['SEMI-FINAL','STANDINGS'],finals:['GRAND','FINALS']}[set]||['LIVE','STANDINGS'];
    return `${words[0]} <span>${words[1]}</span>`;
  }
  function banner(text){
    const b=stage.querySelector('#bc-banner');b.querySelector('#bc-banner-text').textContent=text;b.hidden=false;b.classList.remove('go');void b.offsetWidth;b.classList.add('go');
    clearTimeout(banner.t);banner.t=setTimeout(()=>{b.hidden=true;},4600);
  }
  function render({state,set,label,scoped,teamName}){
    if(!stage)build();
    stage.dataset.stage=set;
    stage.querySelector('#bc-chip').textContent=label.toUpperCase();
    stage.querySelector('#bc-h1').innerHTML=title(set,label);
    const signature=JSON.stringify([set,scoped.matches.length,scoped.matches.at(-1)?.rows,state.war?.cs]),changed=!first&&signature!==lastSignature;lastSignature=signature;
    if(set==='finals'){
      clearInterval(pageTimer);stage.classList.add('is-finals');
      stage.querySelector('#bc-context').textContent='CLASH SQUAD KNOCKOUT · TOP 4 FROM THE SEMI-FINAL';
      stage.querySelector('#bc-body').innerHTML=bracket(state,teamName);stage.querySelector('#bc-cards').innerHTML='';
      if(changed)banner('FINALS BRACKET');first=false;return;
    }
    stage.classList.remove('is-finals');
    const stats=HostStats.analyze(scoped,WarOverall.aggregate),count=scoped.matches.length,target=state.war?.targets?.[set];
    const latest=stats.latest;
    stage.querySelector('#bc-context').textContent=count?`AFTER ${String(latest.name||'MATCH '+count).toUpperCase()}${target?` · ${count} OF ${target} PLAYED`:''}${latest.map?' · '+String(latest.map).toUpperCase():''}`:'WAITING FOR THE FIRST RESULT';
    if(!stats.teams.length||!count){
      // Before the first result: the teams of this set, all level.
      const ids=set==='C'?[...(state.war?.qualified?.A||[]),...(state.war?.qualified?.B||[])]:state.war?.groups?.[set]||[];
      const waiting=ids.map(id=>({teamId:id,teamName:teamName(id),rank:null,matches:0,wins:0,kills:0,placementPoints:0,total:0,change:0}));
      if(waiting.length)standings(waiting,0,first||changed);
      else{clearInterval(pageTimer);stage.querySelector('#bc-body').innerHTML='<div class="bc-empty"><strong>STANDINGS GO LIVE</strong><span>after the first match result is saved</span></div>';}
      stage.querySelector('#bc-cards').innerHTML='<article class="bc-card bc-soon"><span class="bc-kicker">NEXT UP</span><strong class="bc-big">MATCH 1</strong><span class="bc-sub">STAY TUNED</span></article>'+tracker(scoped,set,target);
      first=false;return;
    }
    const animate=first||changed;
    if(changed)page=0;
    standings(stats.teams,cutFor(set,state),animate);
    const cardsEl=stage.querySelector('#bc-cards');cardsEl.innerHTML=cards(stats,set,scoped,target);cardsEl.classList.toggle('animate',animate);countUp(cardsEl);
    if(changed)banner(`AFTER ${String(latest.name||'').toUpperCase()}`);
    lastTotals=new Map(stats.teams.map(t=>[t.teamId,t.total]));first=false;current=stats;
  }
  window.BroadcastScreen={render};
})();
