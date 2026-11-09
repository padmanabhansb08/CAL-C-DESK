/* Final-map wheel. The server draws the map (POST /api/wheel/spin); every open screen polls GET /api/wheel and plays the
   same spin, landing on the same segment (the landing offset comes from the spin id). The desk's Map wheel
   page embeds this page (#embed=1) and holds the controls; the broadcast screen (#screen=1&key=…, for OBS) only watches. */
(function(){
  const ART={Bermuda:'bermuda-map.jpeg',Purgatory:'purgatory-map.jpg',Kalahari:'kalahari-map.jpg',NexTerra:'nexterra-map.png',Solara:'solara-map.jpg',Alpine:'alpine-map.jpg'};
  const SPIN_MS=7600,TURNS=7,POLL_MS=1200;
  const params=new URLSearchParams(location.hash.slice(1)),key=params.get('key')||'',screen=params.get('screen')==='1',embed=params.get('embed')==='1'&&window.parent!==window;
  // Embedded in the desk's Map wheel page: the desk holds the controls and talks to this page by messages.
  const tellDesk=()=>{if(embed)parent.postMessage({type:'wheel-state',spinning:!!spinning},location.origin);};
  const $=s=>document.querySelector(s);
  const stage=$('#stage'),wheel=$('#wheel'),rim=$('#rim'),pointer=$('#pointer');
  let maps=[],shown=[],images={},angle=0,spinning=null,currentId=null,lastFrame=performance.now(),won=null,soundOn=false;

  // ---------- Layout: the 1920 x 1080 stage scaled to the window.
  function fit(){const vp=$('#viewport').getBoundingClientRect(),s=Math.min(vp.width/1920,vp.height/1080);stage.style.transform=`translate(-50%,-50%) scale(${s})`;stage.style.left='50%';stage.style.top='50%';stage.style.transformOrigin='50% 50%';}
  addEventListener('resize',fit);

  // ---------- Images.
  function load(name){return images[name]||=new Promise(ok=>{const im=new Image();im.onload=()=>ok(im);im.onerror=()=>ok(null);im.src='assets/'+ART[name];});}

  // ---------- Wheel drawing (static art; rotation is a CSS transform).
  const C=500,R=452;
  async function drawWheel(list,winner){
    const ctx=wheel.getContext('2d'),seg=Math.PI*2/list.length,arts=await Promise.all(list.map(load));
    ctx.clearRect(0,0,1000,1000);
    list.forEach((name,i)=>{
      const a0=-Math.PI/2+i*seg,a1=a0+seg,mid=a0+seg/2,lose=winner&&name!==winner;
      ctx.save();ctx.beginPath();ctx.moveTo(C,C);ctx.arc(C,C,R,a0,a1);ctx.closePath();ctx.clip();
      const art=arts[i];if(art){const size=R*1.25,cx=C+Math.cos(mid)*R*.55,cy=C+Math.sin(mid)*R*.55;ctx.drawImage(art,cx-size/2,cy-size/2,size,size);}
      else{ctx.fillStyle='#3a0204';ctx.fillRect(0,0,1000,1000);}
      // Alternate red and black tints so neighbours read apart, darker toward the hub.
      ctx.fillStyle=i%2?'rgba(120,0,0,.42)':'rgba(10,0,0,.48)';ctx.fillRect(0,0,1000,1000);
      const shade=ctx.createRadialGradient(C,C,90,C,C,R);shade.addColorStop(0,'rgba(0,0,0,.85)');shade.addColorStop(.45,'rgba(0,0,0,.25)');shade.addColorStop(1,'rgba(0,0,0,.05)');ctx.fillStyle=shade;ctx.fillRect(0,0,1000,1000);
      if(lose){ctx.fillStyle='rgba(0,0,0,.62)';ctx.fillRect(0,0,1000,1000);}
      if(winner&&!lose){const g=ctx.createRadialGradient(C,C,100,C,C,R);g.addColorStop(0,'rgba(255,59,59,0)');g.addColorStop(1,'rgba(255,59,59,.38)');ctx.fillStyle=g;ctx.fillRect(0,0,1000,1000);}
      ctx.restore();
      // Map name along the segment, reading outward.
      ctx.save();ctx.translate(C,C);ctx.rotate(mid);ctx.textAlign='right';ctx.textBaseline='middle';
      const label=name.toUpperCase();let size=list.length>4?62:74;ctx.font=`800 ${size}px "Barlow Condensed", sans-serif`;
      while(ctx.measureText(label).width>R*.6&&size>30){size-=2;ctx.font=`800 ${size}px "Barlow Condensed", sans-serif`;}
      ctx.lineJoin='round';ctx.lineWidth=9;ctx.strokeStyle='#160000';ctx.strokeText(label,R-36,0);
      ctx.fillStyle=lose?'rgba(255,255,255,.4)':'#ffffff';if(winner&&!lose){ctx.shadowColor='#ff2a1a';ctx.shadowBlur=26;}ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=10;ctx.fillText(label,R-36,0);ctx.restore();
    });
    // Gold separators.
    list.forEach((_,i)=>{const a=-Math.PI/2+i*seg;ctx.save();ctx.strokeStyle='#160000';ctx.lineWidth=12;ctx.beginPath();ctx.moveTo(C,C);ctx.lineTo(C+Math.cos(a)*R,C+Math.sin(a)*R);ctx.stroke();
      const g=ctx.createLinearGradient(C,C,C+Math.cos(a)*R,C+Math.sin(a)*R);g.addColorStop(0,'#6a6a6a');g.addColorStop(1,'#ffffff');ctx.strokeStyle=g;ctx.lineWidth=5;ctx.stroke();ctx.restore();});
    ctx.save();ctx.beginPath();ctx.arc(C,C,R,0,Math.PI*2);ctx.lineWidth=6;ctx.strokeStyle='#f5f5f5';ctx.stroke();ctx.restore();
  }

  // ---------- Rim with chase lights (fixed; redrawn as the lights move).
  const BULBS=36;let chase=0,flash=0;
  function drawRim(){
    const ctx=rim.getContext('2d');ctx.clearRect(0,0,1000,1000);
    const ring=ctx.createLinearGradient(0,0,1000,1000);ring.addColorStop(0,'#e10600');ring.addColorStop(.5,'#2a0000');ring.addColorStop(1,'#e10600');
    ctx.beginPath();ctx.arc(C,C,497,0,Math.PI*2);ctx.arc(C,C,R+2,0,Math.PI*2,true);ctx.fillStyle=ring;ctx.fill();
    ctx.lineWidth=5;ctx.strokeStyle='#f5f5f5';ctx.beginPath();ctx.arc(C,C,497,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(C,C,R+4,0,Math.PI*2);ctx.stroke();
    for(let i=0;i<BULBS;i++){
      const a=-Math.PI/2+i*Math.PI*2/BULBS,x=C+Math.cos(a)*475,y=C+Math.sin(a)*475;
      const lit=flash>0?(Math.floor(flash/4)%2===0):((i+Math.floor(chase))%3===0);
      ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);
      if(lit){ctx.fillStyle='#ffffff';ctx.shadowColor=won?'#ff2a1a':'#ffd2c8';ctx.shadowBlur=22;}else{ctx.fillStyle='#3a0606';ctx.shadowBlur=0;}
      ctx.fill();ctx.shadowBlur=0;
    }
  }

  // ---------- Sound (Web Audio; silent when the browser blocks it).
  let audio=null;
  function ac(){if(!soundOn)return null;try{audio||=new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();return audio;}catch{return null;}}
  function tick(){const a=ac();if(!a)return;const o=a.createOscillator(),g=a.createGain();o.type='square';o.frequency.value=1500;g.gain.setValueAtTime(.09,a.currentTime);g.gain.exponentialRampToValueAtTime(.0001,a.currentTime+.05);o.connect(g).connect(a.destination);o.start();o.stop(a.currentTime+.06);}
  function fanfare(){const a=ac();if(!a)return;[523.25,659.25,783.99,1046.5].forEach((f,i)=>{const o=a.createOscillator(),g=a.createGain(),t=a.currentTime+i*.12;o.type='sawtooth';o.frequency.value=f;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.12,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+(i===3?1.2:.35));o.connect(g).connect(a.destination);o.start(t);o.stop(t+1.3);});}

  // ---------- Embers and confetti.
  const ember=$('#embers').getContext('2d'),embers=Array.from({length:70},()=>({x:Math.random()*1920,y:Math.random()*1080,r:1+Math.random()*3,v:.4+Math.random()*1.2,d:Math.random()*Math.PI*2}));
  const conf=$('#confetti').getContext('2d');let pieces=[];
  function burst(){const colors=['#ff3b3b','#ffffff','#e10600','#cfcfcf','#8b0e0e'];
    for(let i=0;i<260;i++){const a=-Math.PI/2+(Math.random()-.5)*2.2,s=8+Math.random()*16;pieces.push({x:740,y:150,vx:Math.cos(a)*s,vy:Math.sin(a)*s,r:Math.random()*Math.PI,vr:(Math.random()-.5)*.4,w:8+Math.random()*10,h:4+Math.random()*6,c:colors[i%colors.length],life:1});}
    for(let i=0;i<160;i++){const a=Math.random()*Math.PI*2,s=4+Math.random()*10;pieces.push({x:1570,y:520,vx:Math.cos(a)*s,vy:Math.sin(a)*s-6,r:Math.random()*Math.PI,vr:(Math.random()-.5)*.4,w:8+Math.random()*10,h:4+Math.random()*6,c:colors[i%colors.length],life:1});}}

  // ---------- Spin. Pointer is at the top; segment i is centred at (i + .5) * seg clockwise from the top.
  const seg=()=>360/shown.length;
  function hash(s){let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0)/4294967296;}
  function landing(spin){const k=spin.maps.indexOf(spin.result),jitter=(hash(spin.id)-.5)*.6*seg();return ((-((k+.5)*seg()+jitter))%360+360)%360;}
  const ease=t=>1-Math.pow(1-t,4.2);
  function startSpin(spin,ageMs){
    const target=landing(spin),from=angle,delta=((target-from)%360+360)%360+TURNS*360;
    spinning={spin,from,to:from+delta,start:performance.now()-Math.max(0,ageMs),lastSeg:Math.floor(from/seg())};
    won=null;stage.classList.add('is-spinning');stage.classList.remove('is-won');$('#result').hidden=true;$('#pool').hidden=false;
    $('#status').textContent='Spinning…';tellDesk();
  }
  async function settle(spin,celebrate){
    spinning=null;angle=((landing(spin))%360);won=spin.result;stage.classList.remove('is-spinning');stage.classList.add('is-won');
    await drawWheel(shown,won);
    $('#status').textContent='The final match map is decided';
    document.querySelectorAll('#pool li').forEach(li=>li.classList.toggle('hot',li.dataset.map===won));
    $('#result-art').style.backgroundImage=`url("assets/${ART[won]}")`;$('#result-name').textContent=won.toUpperCase();
    $('#pool').hidden=true;$('#result').hidden=false;
    if(celebrate){flash=48;burst();fanfare();}
    tellDesk();
  }

  function frame(now){
    const dt=Math.min(64,now-lastFrame);lastFrame=now;
    if(spinning){
      const t=Math.min(1,(now-spinning.start)/SPIN_MS),a=spinning.from+(spinning.to-spinning.from)*ease(t);
      const s=Math.floor(a/seg());if(s!==spinning.lastSeg){spinning.lastSeg=s;tick();pointer.classList.add('flick');setTimeout(()=>pointer.classList.remove('flick'),45);}
      const speed=(a-angle)/Math.max(1,dt);angle=a;chase+=Math.min(1.5,.05+speed*.6);
      if(t>=1)settle(spinning.spin,true);
    }else if(!won){angle+=dt*.006;chase+=dt*.004;}
    else chase+=dt*.003;
    if(flash>0)flash--;
    wheel.style.transform=`rotate(${angle}deg)`;drawRim();
    // Embers drift up; confetti falls.
    ember.clearRect(0,0,1920,1080);embers.forEach(e=>{e.y-=e.v;e.x+=Math.sin(e.d+=.02)*.6;if(e.y<-10){e.y=1090;e.x=Math.random()*1920;}ember.beginPath();ember.arc(e.x,e.y,e.r,0,Math.PI*2);ember.fillStyle=`rgba(255,${80+Math.floor(e.r*30)},40,${.35+e.r*.12})`;ember.shadowColor='#ff3b1a';ember.shadowBlur=8;ember.fill();});
    if(pieces.length){conf.clearRect(0,0,1920,1080);pieces.forEach(p=>{p.vy+=.35;p.vx*=.99;p.x+=p.vx;p.y+=p.vy;p.r+=p.vr;p.life-=.004;conf.save();conf.translate(p.x,p.y);conf.rotate(p.r);conf.globalAlpha=Math.max(0,p.life);conf.fillStyle=p.c;conf.fillRect(-p.w/2,-p.h/2,p.w,p.h);conf.restore();});pieces=pieces.filter(p=>p.y<1150&&p.life>0);if(!pieces.length)conf.clearRect(0,0,1920,1080);}
    requestAnimationFrame(frame);
  }

  // ---------- Pool chips and wheel contents.
  async function setShown(list){
    if(JSON.stringify(list)===JSON.stringify(shown))return;
    shown=list.slice();await drawWheel(shown,won&&shown.includes(won)?won:null);
    $('#pool').innerHTML=shown.map(m=>`<li data-map="${m}" style="background-image:url('assets/${ART[m]}')"><span>${m.toUpperCase()}</span></li>`).join('');
  }

  // ---------- Server.
  async function call(method,path,body){
    const r=await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json',...(key?{'X-Host-Key':key}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});
    const data=await r.json().catch(()=>({}));if(!r.ok){const e=Error(data.error||'Request failed');e.status=r.status;throw e;}return data;
  }
  async function handle(data){
    maps=data.maps||maps;const spin=data.spin;
    if(!spin){if(!currentId)await setShown(selected());return;}
    if(spin.id===currentId)return;
    const first=currentId===null;currentId=spin.id;
    await setShown(spin.maps);
    const age=(data.now-spin.at)*1000;
    // A spin that already finished (page opened later) shows its result without replaying it.
    if(first&&age>SPIN_MS+1500){won=null;await settle(spin,false);return;}
    if(won){won=null;await drawWheel(shown,null);}
    startSpin(spin,first?age:0);
  }
  let failures=0;
  async function poll(){
    try{handle(await call('GET','wheel'));failures=0;$('#gate').hidden=true;}
    catch(e){failures++;if(e.status===401){$('#gate').hidden=false;$('#gate').innerHTML=screen?'This broadcast link is no longer valid. Ask the organizer for a new host link.':embed?'Your sign-in has ended. Sign in again on the desk.':'Sign in on the <a href="/">desk</a> first, then open the map wheel again.';}}
    finally{setTimeout(poll,failures>3?4000:POLL_MS);}
  }

  // ---------- Desk controls (the desk's Map wheel page embeds this page; the maps chosen there are saved on this device).
  function selected(){let saved=null;try{saved=JSON.parse(localStorage.getItem('ffk-wheel-maps')||'null');}catch{}const all=maps.length?maps:Object.keys(ART);return Array.isArray(saved)?all.filter(m=>saved.includes(m)):all;}
  function resetTo(list){if(spinning)return;won=null;stage.classList.remove('is-won');$('#result').hidden=true;$('#pool').hidden=false;$('#status').textContent='Ready to spin';setShown(list);}
  function setupEmbed(){
    document.body.classList.add('embed');
    try{soundOn=localStorage.getItem('ffk-wheel-sound')!=='0';}catch{soundOn=true;}
    addEventListener('message',e=>{
      if(e.origin!==location.origin||e.source!==parent)return;const m=e.data||{};
      if(m.type==='wheel-maps'&&Array.isArray(m.maps))resetTo(m.maps.filter(x=>ART[x]));
      else if(m.type==='wheel-sound'){soundOn=!!m.on;ac();}
      else if(m.type==='wheel-spun'&&m.data){ac();handle(m.data);}
    });
    return call('GET','wheel').then(d=>{maps=d.maps||maps;}).catch(()=>{});
  }

  // ---------- Start. Opened on its own (not the broadcast screen), the wheel lives on the desk's Map wheel page.
  if(!screen&&!embed){try{localStorage.setItem('ffk-last-page-v1','wheel');}catch{}location.replace('/');return;}
  document.body.classList.toggle('screen',screen);
  fit();drawRim();requestAnimationFrame(frame);
  if(window.BrandFX){BrandFX.lightning($('#bolts'));BrandFX.wave($('.ffk-footer canvas'));}
  if(screen){soundOn=params.get('sound')!=='0';}
  (screen?Promise.resolve():setupEmbed()).finally(()=>{if(!shown.length)setShown(screen?(maps.length?maps:Object.keys(ART)):selected());poll();});
  window.__wheel={state:()=>({angle,won,shown,currentId,spinning:!!spinning})};
})();
