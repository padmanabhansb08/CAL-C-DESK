/* FFK brand effects for the live screens (map wheel and broadcast standings), drawn on canvases so they move on stream:
   - lightning(canvas): crimson lightning that strikes along the outer edges, keeping the centre dark and readable;
   - wave(canvas): the footer's red energy waveform, flat under the centre emblem and alive at the sides. */
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

  // Footer energy wave: two layered lines; the amplitude is shaped so the centre (behind the emblem) stays calm.
  function wave(canvas){
    const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,mid=h/2;
    const draw=t=>{
      ctx.clearRect(0,0,w,h);
      for(const [amp,alpha,width,speed,blur] of [[1,.95,2.4,1,16],[.55,.5,1.2,-1.6,6]]){
        ctx.beginPath();
        for(let x=0;x<=w;x+=4){const u=x/w,env=Math.pow(Math.abs(u-.5)*2,1.6)*Math.min(1,(1-Math.abs(u-.5)*2)*6+.2);
          const y=mid+env*amp*(Math.sin(u*48+t*.004*speed)*h*.22+Math.sin(u*131-t*.009*speed)*h*.12+(Math.sin(u*400+t*.03)>.96?h*.3:0));x?ctx.lineTo(x,y):ctx.moveTo(x,y);}
        ctx.strokeStyle=`rgba(255,40,30,${alpha})`;ctx.lineWidth=width;ctx.shadowColor='#ff1a0a';ctx.shadowBlur=blur;ctx.stroke();
      }
      // A pulse of light runs outward from the emblem on each side.
      const p=(t*.00035)%1;for(const x of [w/2+p*w/2,w/2-p*w/2]){const g=ctx.createRadialGradient(x,mid,0,x,mid,22);g.addColorStop(0,`rgba(255,235,230,${.85*(1-p)})`);g.addColorStop(.4,`rgba(255,60,40,${.5*(1-p)})`);g.addColorStop(1,'rgba(255,40,30,0)');ctx.fillStyle=g;ctx.fillRect(x-22,mid-22,44,44);}
    };
    if(still()){draw(0);return;}
    (function tick(now){draw(now);requestAnimationFrame(tick);})(performance.now());
  }
  root.BrandFX={lightning,wave};
})(window);
