/* FFK brand effects for the live screens (map wheel and broadcast standings), drawn on canvases so they move on stream:
   - lightning(canvas): crimson lightning that strikes along the outer edges, keeping the centre dark and readable;
   - fire(canvas): a few drifting fire embers rising from the bottom corners. */
(function(root){
  const still=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

  // A jagged bolt from (x0,y0) toward (x1,y1), with side branches.
  function bolt(x0,y0,x1,y1,spread,depth=0){
    const pts=[[x0,y0]],n=14,dx=x1-x0,dy=y1-y0,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len,branches=[];
    for(let i=1;i<n;i++){const t=i/n,off=(Math.random()-.5)*spread*(1-Math.abs(t-.5));pts.push([x0+dx*t+nx*off,y0+dy*t+ny*off]);
      if(depth<2&&Math.random()<.22){const [bx,by]=pts[i],a=Math.atan2(dy,dx)+(Math.random()<.5?-1:1)*(.5+Math.random()*.6),l=len*(.18+Math.random()*.22);branches.push(bolt(bx,by,bx+Math.cos(a)*l,by+Math.sin(a)*l,spread*.6,depth+1));}}
    pts.push([x1,y1]);return {pts,branches,width:depth?1.6:3.2};
  }
  function stroke(ctx,b,alpha){
    ctx.beginPath();b.pts.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
    ctx.strokeStyle=`rgba(255,40,30,${alpha*.55})`;ctx.lineWidth=b.width*5;ctx.shadowColor='#ff1a0a';ctx.shadowBlur=30;ctx.stroke();
    ctx.strokeStyle=`rgba(255,220,210,${alpha})`;ctx.lineWidth=b.width;ctx.shadowBlur=12;ctx.stroke();
    b.branches.forEach(c=>stroke(ctx,c,alpha*.8));
  }
  // Strikes start at an edge and reach a little way in: left, right or a top corner.
  function strike(w,h){
    const side=Math.random();
    if(side<.35){const y=Math.random()*h*.8;return bolt(-10,y,w*(.08+Math.random()*.12),y+h*(.15+Math.random()*.25),90);}
    if(side<.7){const y=Math.random()*h*.8;return bolt(w+10,y,w*(.88-Math.random()*.12),y+h*(.15+Math.random()*.25),90);}
    const x=Math.random()<.5?w*(.02+Math.random()*.2):w*(.78+Math.random()*.2);return bolt(x,-10,x+(Math.random()-.5)*w*.12,h*(.18+Math.random()*.2),80);
  }
  function lightning(canvas,{every=[1600,4200]}={}){
    const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;let bolts=[],next=performance.now()+600;
    if(still()){stroke(ctx,strike(w,h),.5);return;}
    (function tick(now){
      ctx.clearRect(0,0,w,h);
      if(now>next){const b=strike(w,h);bolts.push({b,born:now,life:420+Math.random()*300,flicker:Math.random()<.5});if(Math.random()<.35)bolts.push({b:strike(w,h),born:now+60,life:380,flicker:false});next=now+every[0]+Math.random()*(every[1]-every[0]);canvas.dispatchEvent(new CustomEvent('strike'));}
      bolts=bolts.filter(x=>now-x.born<x.life);
      for(const x of bolts){if(now<x.born)continue;const t=(now-x.born)/x.life,a=(1-t)*(x.flicker&&t<.4&&Math.floor(t*20)%2?.35:1);stroke(ctx,x.b,a);}
      requestAnimationFrame(tick);
    })(performance.now());
  }

  // Fire embers: a few glowing sparks drifting up from the bottom edge, mostly near the two corners so the centre stays
  // clear. Made to read like real embers on camera:
  //  - depth: most are small, far and slow; a few are near, larger and faster, and a rare one is so close it is out of
  //    focus (a soft blurred disc with no trail);
  //  - motion: a quick pop upward that slows as the ember cools, carried by swirling hot air, with the odd gust;
  //  - look: a hot white-yellow core in an orange halo, a tapered motion-blur streak behind it, a tumbling twinkle,
  //    cooling to deep red before a last flare and winking out;
  //  - time-based, so the speed is the same on 60 Hz and 144 Hz screens.
  function fire(canvas,{reach=.38,rate=.035}={}){
    const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
    const sprite=(stops)=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d'),gr=x.createRadialGradient(32,32,0,32,32,32);
      stops.forEach(([o,col])=>gr.addColorStop(o,col));x.fillStyle=gr;x.fillRect(0,0,64,64);return c;};
    const halo=sprite([[0,'rgba(255,150,50,.9)'],[.25,'rgba(255,90,20,.45)'],[1,'rgba(200,30,0,0)']]);
    const bokeh=sprite([[0,'rgba(255,120,40,.5)'],[.6,'rgba(255,90,25,.35)'],[.8,'rgba(255,70,20,.12)'],[1,'rgba(255,60,10,0)']]);
    let sparks=[],t=0;
    const spot=()=>{const right=Math.random()<.5,d=Math.pow(Math.random(),1.4)*w*reach;return right?w-d:d;};
    // Swirling air: layered slow sine fields, so neighbouring embers drift together like real convection.
    const airX=(x,y)=>Math.sin(y*.009+t*.016)+.6*Math.sin(y*.023-t*.027+x*.004)+.35*Math.sin(x*.017+t*.041);
    const airY=(x,y)=>.5*Math.sin(x*.011-t*.019)+.3*Math.sin(y*.018+t*.031);
    function add(x){const z=Math.pow(Math.random(),2.2),near=z>.9;
      sparks.push({x,y:h+8,z,near,vx:(Math.random()-.5)*1.4,vy:-(2+Math.random()*2.8)*(.5+z*.9),age:0,life:150+Math.random()*200,
        size:.55+z*2.4,spin:.15+Math.random()*.5,seed:Math.random()*99,flare:.8+Math.random()*.15,trail:[]});}
    function spawn(dt){
      // Embers leave now and then, sometimes a little cluster together, never a steady stream.
      if(Math.random()>rate*dt*16.7)return;const x=spot(),n=Math.random()<.22?2+Math.floor(Math.random()*3):1;
      for(let i=0;i<n;i++)add(x+(Math.random()-.5)*40);
    }
    function step(dt){
      t+=dt;spawn(dt);
      for(const s of sparks){s.age+=dt;const sp=.45+s.z*.9;
        s.vx+=airX(s.x,s.y)*.045*dt;s.vy+=(airY(s.x,s.y)*.03-.01)*dt;   // swirl, plus a little lift from the hot air
        const drag=Math.pow(.978,dt);s.vx*=drag;s.vy*=Math.pow(.985,dt); // the first pop slows into a drift
        if(Math.random()<.003*dt)s.vx+=(Math.random()-.5)*2.2;           // an occasional gust flicks it sideways
        s.trail.push(s.x,s.y);if(s.trail.length>16)s.trail.splice(0,2);
        s.x+=s.vx*sp*dt;s.y+=s.vy*sp*dt;}
      sparks=sparks.filter(s=>s.age<s.life&&s.y>-30&&s.x>-30&&s.x<w+30);
    }
    function draw(){
      ctx.clearRect(0,0,w,h);ctx.globalCompositeOperation='lighter';ctx.lineCap='round';
      for(const s of sparks){const k=s.age/s.life;
        // Tumbling twinkle, a fade in at birth, cooling dim-down, and a last flare just before it dies.
        const twinkle=.7+.3*Math.sin(s.age*s.spin+s.seed)*Math.sin(s.age*s.spin*2.7+s.seed*2);
        const flare=k>s.flare?1+1.2*Math.sin(Math.min(1,(k-s.flare)/(1-s.flare))*Math.PI):1;
        const a=Math.max(0,Math.min(1,s.age/10)*(1-k*.75)*twinkle*flare*(k>.97?(1-k)/.03:1)*(.45+s.z*.55));
        if(s.near){const r=s.size*9;ctx.globalAlpha=a*.55;ctx.drawImage(bokeh,s.x-r,s.y-r,r*2,r*2);continue;}
        const g=Math.round(235-175*k),bl=Math.round(180*(1-k)*(1-k));
        // Motion-blur streak: thin and faint at the tail, full width at the ember.
        const tr=s.trail,n=tr.length/2;
        for(let i=1;i<n;i++){const f=i/n;ctx.globalAlpha=a*f*.55;ctx.strokeStyle=`rgb(255,${g},${bl})`;ctx.lineWidth=s.size*(.25+.75*f);
          ctx.beginPath();ctx.moveTo(tr[i*2-2],tr[i*2-1]);ctx.lineTo(i===n-1?s.x:tr[i*2],i===n-1?s.y:tr[i*2+1]);ctx.stroke();}
        const r=s.size*6;ctx.globalAlpha=a*.6;ctx.drawImage(halo,s.x-r,s.y-r,r*2,r*2);
        ctx.globalAlpha=a;ctx.fillStyle=`rgb(255,${Math.min(255,g+20)},${Math.min(255,bl+60)})`;ctx.beginPath();ctx.arc(s.x,s.y,s.size*.7,0,7);ctx.fill();}
      ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
    }
    if(still()){for(let i=0;i<500;i++)step(1);draw();return;}
    let last=performance.now();
    (function tick(now){const dt=Math.min(3,Math.max(.2,(now-last)/16.7));last=now;step(dt);draw();requestAnimationFrame(tick);})(last);
  }
  root.BrandFX={lightning,fire};
})(window);
