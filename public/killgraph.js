/* Kill graph artwork: the FFK WAR "KILL GRAPH" poster (week, set, day, map) drawn from saved results.
   Teams stand in slot order like the weekly poster; the top fragger is gold and crowned. 1920 x 1080. */
(function(root){
  const W=1920,H=1080;
  const NEON=['#2ea8ff','#ff2b2b','#b23cff','#2bff6a','#ff8a1a','#ff3fbf','#3a6bff','#e040ff','#19e6d2','#f2f2f2','#ffb21a','#7cff2b','#ff5c5c','#4dd2ff','#c77dff','#ffd84d'];
  const GOLD='#ffc21a';
  const MAP_ART={bermuda:'bermuda-map.jpeg',purgatory:'purgatory-map.jpg',kalahari:'kalahari-map.jpg',solara:'solara-map.jpg',nexterra:'nexterra-map.png',alpine:'alpine-map.jpg'};
  const cache={};
  function image(src){return cache[src]||=new Promise((ok,no)=>{const im=new Image();im.onload=()=>ok(im);im.onerror=()=>{delete cache[src];no(Error('Could not load '+src));};im.src=src;});}
  const display=(size,weight=800)=>`${weight} ${size}px "Barlow Condensed", "DM Sans", sans-serif`;

  // Deterministic randomness, so the same results always give the same artwork.
  function rng(seed){let s=seed>>>0||1;return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};}

  // Kills per team over the chosen matches, in slot order (registered slot, else most kills first).
  function rows(state,matches,order='slot'){
    const by=new Map();
    matches.forEach(m=>m.rows.forEach(r=>{
      const kills=r.overall?r.kills:(r.players||[]).reduce((n,p)=>n+(Number(p.kills)||0),0);
      const cur=by.get(r.teamId)||{teamId:r.teamId,name:r.teamName,kills:0};cur.kills+=kills;by.set(r.teamId,cur);
    }));
    const list=[...by.values()].map(r=>{const team=(state.teams||[]).find(t=>t.id===r.teamId);return {...r,name:team?.name||r.name,slot:Number.isInteger(team?.slot)?team.slot:null};});
    const bySlot=list.every(r=>r.slot!==null)&&new Set(list.map(r=>r.slot)).size===list.length;
    list.sort((a,b)=>order==='slot'&&bySlot?a.slot-b.slot:b.kills-a.kills||String(a.name).localeCompare(String(b.name)));
    return list;
  }

  function slant(ctx,fn,skew=-0.18){ctx.save();ctx.transform(1,0,skew,1,0,0);fn();ctx.restore();}
  function fit(ctx,text,max,size,weight=800){let s=size;ctx.font=display(s,weight);while(s>12&&ctx.measureText(text).width>max){s--;ctx.font=display(s,weight);}return s;}
  function brush(ctx,x,y,w,h,color,rand,tilt=0){
    // A rough paint stroke: a slanted band with torn ends.
    ctx.save();ctx.translate(x,y);ctx.rotate(tilt);ctx.beginPath();ctx.moveTo(-w/2,-h/2);
    for(let i=0;i<=10;i++)ctx.lineTo(-w/2+w*i/10,-h/2+(rand()-.5)*h*.18);
    for(let i=0;i<5;i++)ctx.lineTo(w/2+rand()*h*.5,-h/2+h*(i+1)/5);
    for(let i=10;i>=0;i--)ctx.lineTo(-w/2+w*i/10,h/2+(rand()-.5)*h*.18);
    for(let i=5;i>0;i--)ctx.lineTo(-w/2-rand()*h*.5,-h/2+h*i/5);
    ctx.closePath();ctx.fillStyle=color;ctx.fill();ctx.restore();
  }
  function lightning(ctx,x,y,len,angle,rand,width=3){
    ctx.save();ctx.strokeStyle='rgba(255,70,50,.85)';ctx.shadowColor='#ff1a1a';ctx.shadowBlur=18;ctx.lineWidth=width;ctx.lineJoin='round';
    const walk=(x,y,len,angle,w,depth)=>{ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(x,y);let px=x,py=y;const steps=8+Math.floor(rand()*6);
      for(let i=0;i<steps;i++){const a=angle+(rand()-.5)*1.1,step=len/steps;px+=Math.cos(a)*step;py+=Math.sin(a)*step;ctx.lineTo(px,py);
        if(depth<2&&rand()<.22){ctx.stroke();walk(px,py,len*.45,a+(rand()-.5)*1.4,w*.6,depth+1);ctx.beginPath();ctx.moveTo(px,py);}}
      ctx.stroke();};
    walk(x,y,len,angle,width,0);ctx.restore();
  }
  function crown(ctx,cx,cy,size){
    ctx.save();ctx.translate(cx,cy);const s=size/100;ctx.scale(s,s);
    const g=ctx.createLinearGradient(0,-50,0,40);g.addColorStop(0,'#fff3a0');g.addColorStop(.45,'#ffc21a');g.addColorStop(1,'#b86b00');
    ctx.beginPath();ctx.moveTo(-50,30);ctx.lineTo(-56,-24);ctx.lineTo(-26,4);ctx.lineTo(0,-40);ctx.lineTo(26,4);ctx.lineTo(56,-24);ctx.lineTo(50,30);ctx.closePath();
    ctx.shadowColor='rgba(255,190,0,.8)';ctx.shadowBlur=24;ctx.fillStyle=g;ctx.fill();ctx.shadowBlur=0;ctx.lineWidth=4;ctx.strokeStyle='#7a3d00';ctx.stroke();
    ctx.fillStyle=g;ctx.fillRect(-50,30,100,14);ctx.strokeRect(-50,30,100,14);
    [[-56,-24],[0,-40],[56,-24]].forEach(([x,y])=>{ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.fillStyle='#fff3a0';ctx.fill();ctx.stroke();});
    [[-28,20,'#ff2a6a'],[0,18,'#ff2a6a'],[28,20,'#ff2a6a']].forEach(([x,y,c])=>{ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fillStyle=c;ctx.fill();});
    ctx.restore();
  }
  function crosshair(ctx,cx,cy,r,color){
    ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=r*.22;ctx.shadowColor=color;ctx.shadowBlur=10;
    ctx.beginPath();ctx.arc(cx,cy,r*.62,0,Math.PI*2);ctx.stroke();
    [[0,-1],[0,1],[-1,0],[1,0]].forEach(([dx,dy])=>{ctx.beginPath();ctx.moveTo(cx+dx*r*.35,cy+dy*r*.35);ctx.lineTo(cx+dx*r,cy+dy*r);ctx.stroke();});
    ctx.beginPath();ctx.arc(cx,cy,r*.16,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
  function niceStep(max){const raw=max/7,p=10**Math.floor(Math.log10(raw||1)),n=raw/p;return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p;}

  async function render(canvas,list,options={}){
    if(document.fonts)await document.fonts.ready;
    canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d'),rand=rng(list.reduce((n,r)=>n*31+r.kills+r.name.length,7));
    const mapKey=String(options.map||'').toLowerCase().replace(/[^a-z]/g,'');
    const [art,mascot]=await Promise.all([MAP_ART[mapKey]?image('assets/'+MAP_ART[mapKey]).catch(()=>null):Promise.resolve(null),image('assets/mascot-badge.png').catch(()=>null)]);

    // Background: deep red, the map scenery on the right fading into it, lightning across.
    const bg=ctx.createRadialGradient(W*.25,H*.35,80,W*.4,H*.5,W*.8);bg.addColorStop(0,'#5a0608');bg.addColorStop(.55,'#260304');bg.addColorStop(1,'#0b0101');
    ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
    if(art){const side=W*.5,sx=W-side,sy=-side*.18;ctx.save();ctx.globalAlpha=.78;ctx.drawImage(art,sx,sy,side,side);ctx.restore();
      const fade=ctx.createLinearGradient(sx,0,sx+side*.55,0);fade.addColorStop(0,'rgba(38,3,4,1)');fade.addColorStop(1,'rgba(38,3,4,0)');ctx.fillStyle=fade;ctx.fillRect(sx-2,0,side*.55+2,H);
      const low=ctx.createLinearGradient(0,H*.3,0,H*.62);low.addColorStop(0,'rgba(11,1,1,0)');low.addColorStop(1,'rgba(11,1,1,.95)');ctx.fillStyle=low;ctx.fillRect(sx,H*.3,side,H*.7);
      ctx.fillStyle='rgba(110,0,0,.22)';ctx.fillRect(sx,0,side,H);}
    for(let i=0;i<9;i++)lightning(ctx,rand()*W*.55,rand()*H*.5,180+rand()*320,rand()*Math.PI*2,rand,1.5+rand()*2.5);
    lightning(ctx,10,H*.18,260,Math.PI*.45,rand,3);lightning(ctx,W*.58,H*.02,220,Math.PI*.6,rand,2.5);

    // Mascot and title block.
    if(mascot){ctx.save();const mh=250,mw=mascot.width/mascot.height*mh;ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=20;ctx.drawImage(mascot,14,12,mw,mh);ctx.restore();}
    const red=ctx.createLinearGradient(0,40,0,250);red.addColorStop(0,'#ff3b30');red.addColorStop(1,'#a80000');
    slant(ctx,()=>{ctx.textAlign='left';ctx.textBaseline='alphabetic';
      ctx.font=display(136);ctx.lineWidth=10;ctx.strokeStyle='#1a0000';ctx.strokeText('FFK',380,140);ctx.fillStyle=red;ctx.fillText('FFK',380,140);
      ctx.strokeText('WAR',400,262);const silver=ctx.createLinearGradient(0,150,0,262);silver.addColorStop(0,'#ffffff');silver.addColorStop(1,'#b9b9b9');ctx.fillStyle=silver;ctx.fillText('WAR',400,262);});
    const eyebrow=[options.week?'WEEK '+options.week:'',options.season?'SEASON '+options.season:''].filter(Boolean);
    slant(ctx,()=>{ctx.textAlign='left';ctx.fillStyle='#fff';ctx.strokeStyle='#000';ctx.lineWidth=6;eyebrow.forEach((t,i)=>{ctx.font=display(54);ctx.strokeText(t,690,76+i*54);ctx.fillText(t,690,76+i*54);});});
    const yellow=ctx.createLinearGradient(0,110,0,250);yellow.addColorStop(0,'#fff27a');yellow.addColorStop(.5,'#ffd21a');yellow.addColorStop(1,'#e08a00');
    slant(ctx,()=>{ctx.save();ctx.translate(1010,235);ctx.rotate(-.05);const title=options.title||'KILL GRAPH';const size=fit(ctx,title,640,160);ctx.font=display(size);ctx.textAlign='center';
      ctx.lineWidth=16;ctx.strokeStyle='#3a0000';ctx.strokeText(title,0,0);ctx.shadowColor='rgba(255,190,0,.55)';ctx.shadowBlur=30;ctx.fillStyle=yellow;ctx.fillText(title,0,0);ctx.restore();});
    // Arrow chart icon after the title.
    ctx.save();ctx.translate(1350,30);const barsIcon=[[0,96,26],[34,74,48],[68,52,70]];barsIcon.forEach(([x,y,h])=>{ctx.fillStyle='#e00000';ctx.fillRect(x,y+(70-h),26,h+20);});
    ctx.strokeStyle='#e00000';ctx.lineWidth=10;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-10,90);ctx.lineTo(50,40);ctx.lineTo(70,58);ctx.lineTo(118,6);ctx.stroke();
    ctx.beginPath();ctx.moveTo(122,2);ctx.lineTo(88,6);ctx.lineTo(118,36);ctx.closePath();ctx.fillStyle='#e00000';ctx.fill();ctx.restore();
    const ribbon=[options.set,options.day].filter(Boolean).join('   ');
    if(ribbon){brush(ctx,960,305,620,88,'#d10000',rand,-.04);brush(ctx,960,305,580,66,'#7a0000',rand,-.04);
      ctx.save();ctx.translate(700,309);ctx.rotate(-.04);ctx.fillStyle='#ff2020';ctx.beginPath();ctx.arc(0,-12,24,Math.PI,0);ctx.lineTo(0,34);ctx.closePath();ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=5;ctx.stroke();ctx.beginPath();ctx.arc(0,-12,9,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.restore();
      slant(ctx,()=>{ctx.save();ctx.translate(985,329);ctx.rotate(-.04);const size=fit(ctx,ribbon,470,72);ctx.font=display(size);ctx.textAlign='center';ctx.lineWidth=8;ctx.strokeStyle='#200000';
        const parts=[options.set,options.day].filter(Boolean),gap=ctx.measureText('   ').width,widths=parts.map(p=>ctx.measureText(p).width),total=widths.reduce((a,b)=>a+b,0)+gap*(parts.length-1);let x=-total/2;
        parts.forEach((p,i)=>{ctx.textAlign='left';ctx.strokeText(p,x,0);ctx.fillStyle=i===0?'#ffffff':'#ffe14d';ctx.fillText(p,x,0);x+=widths[i]+gap;});ctx.restore();});}
    if(options.map){brush(ctx,1660,330,330,96,'#7a0000',rand,-.12);brush(ctx,1660,330,300,74,'#cf0000',rand,-.12);
      slant(ctx,()=>{ctx.save();ctx.translate(1700,356);ctx.rotate(-.12);const name=String(options.map).toUpperCase(),size=fit(ctx,name,270,74);ctx.font=display(size);ctx.textAlign='center';ctx.lineWidth=8;ctx.strokeStyle='#200000';ctx.strokeText(name,0,0);ctx.fillStyle='#fff';ctx.fillText(name,0,0);ctx.restore();});}
    if(options.tagline!==false){ctx.save();ctx.translate(1790,95);ctx.rotate(-.12);brush(ctx,0,0,250,150,'rgba(10,0,0,.82)',rand);ctx.font=display(40);ctx.textAlign='center';ctx.fillStyle='#fff';ctx.fillText('ONE TEAM',0,-24);ctx.fillText('ONE DREAM',0,16);ctx.fillStyle='#ff2020';ctx.font=display(50);ctx.fillText('FFK',0,62);ctx.restore();}

    // Chart: axis on the left, bars across. Each bar stands on a label plate; the axis zero is the plate's top,
    // so bar heights above the plates are exactly proportional to kills.
    const left=150,right=W-40,base=905,top=450,label=135,zero=base-label,count=Math.max(1,list.length),slotW=(right-left)/count,barW=Math.min(170,slotW*.8);
    const max=Math.max(1,...list.map(r=>r.kills)),step=niceStep(max),axisMax=Math.ceil(max/step)*step,scaleY=v=>zero-(zero-top)*v/axisMax;
    ctx.save();ctx.strokeStyle='rgba(255,255,255,.28)';ctx.lineWidth=2;ctx.font=display(32,700);ctx.textAlign='right';ctx.textBaseline='middle';
    for(let v=0;v<=axisMax+1e-9;v+=step){const y=scaleY(v);ctx.beginPath();ctx.moveTo(left-10,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillStyle='#fff';ctx.strokeStyle='#000';ctx.lineWidth=5;const t=String(Math.round(v*10)/10);ctx.strokeText(t,left-24,y);ctx.fillText(t,left-24,y);ctx.strokeStyle='rgba(255,255,255,.28)';ctx.lineWidth=2;}
    ctx.strokeStyle='#ff2020';ctx.lineWidth=5;ctx.shadowColor='#ff0000';ctx.shadowBlur=12;ctx.beginPath();ctx.moveTo(left-4,base);ctx.lineTo(left-4,top-20);ctx.stroke();
    ctx.beginPath();ctx.moveTo(left-4,top-36);ctx.lineTo(left-16,top-12);ctx.lineTo(left+8,top-12);ctx.closePath();ctx.fillStyle='#ff2020';ctx.fill();ctx.restore();

    const topKills=Math.max(...list.map(r=>r.kills)),palette=NEON.slice();let colorIndex=0;
    list.forEach((r,i)=>{
      const color=r.kills===topKills&&topKills>0?GOLD:palette[colorIndex++%palette.length],cx=left+slotW*(i+.5),x=cx-barW/2;
      const yTop=Math.min(zero-6,scaleY(r.kills)),h=base-yTop;
      // Reflection below the floor.
      ctx.save();ctx.globalAlpha=.22;const refl=ctx.createLinearGradient(0,base,0,base+120);refl.addColorStop(0,color);refl.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=refl;roundRect(ctx,x,base+6,barW,Math.min(h,120),6);ctx.fill();ctx.restore();
      // Bar body: glowing frame, translucent colour fill and a fine scanline texture.
      ctx.save();ctx.shadowColor=color;ctx.shadowBlur=34;roundRect(ctx,x,yTop,barW,h,8);const fill=ctx.createLinearGradient(0,yTop,0,base);fill.addColorStop(0,color);fill.addColorStop(1,'rgba(0,0,0,.65)');ctx.globalAlpha=.55;ctx.fillStyle=fill;ctx.fill();ctx.globalAlpha=1;ctx.lineWidth=5;ctx.strokeStyle=color;ctx.stroke();ctx.restore();
      ctx.save();roundRect(ctx,x,yTop,barW,h,8);ctx.clip();ctx.fillStyle='rgba(255,255,255,.07)';for(let y=yTop;y<base;y+=7)ctx.fillRect(x,y,barW,2);
      // The label plate at the bottom of each bar.
      const plate=ctx.createLinearGradient(0,base-label,0,base);plate.addColorStop(0,'rgba(0,0,0,.15)');plate.addColorStop(1,'rgba(0,0,0,.75)');ctx.fillStyle=plate;ctx.fillRect(x,base-label,barW,label);ctx.restore();
      ctx.save();ctx.strokeStyle=color;ctx.lineWidth=3;ctx.globalAlpha=.9;ctx.beginPath();ctx.moveTo(x+10,base-label+4);ctx.lineTo(x+barW-10,base-label+4);ctx.stroke();ctx.restore();
      // Slot badge: a shield with the slot number (or rank) in the bar colour.
      const sy=base-label+40,num=r.slot!==null&&options.order!=='kills'?r.slot:i+1;ctx.save();ctx.translate(cx,sy);ctx.beginPath();ctx.moveTo(0,-30);ctx.lineTo(26,-20);ctx.lineTo(22,12);ctx.lineTo(0,30);ctx.lineTo(-22,12);ctx.lineTo(-26,-20);ctx.closePath();
      ctx.fillStyle='rgba(0,0,0,.7)';ctx.fill();ctx.lineWidth=4;ctx.strokeStyle=color;ctx.shadowColor=color;ctx.shadowBlur=14;ctx.stroke();ctx.shadowBlur=0;ctx.fillStyle='#fff';ctx.font=display(30);ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(num),0,1);ctx.restore();
      // Team name: "FFK" small on top, the rest large, white with a coloured edge.
      const m=/^(FFK)\s+(.+)$/i.exec(String(r.name).trim()),small=m?m[1].toUpperCase():'',big=(m?m[2]:String(r.name)).toUpperCase();
      slant(ctx,()=>{ctx.textAlign='center';ctx.textBaseline='alphabetic';const shift=(base-14)*.12;
        if(small){ctx.font=display(30);ctx.lineWidth=6;ctx.strokeStyle='#000';ctx.strokeText(small,cx+shift-6,base-58);ctx.fillStyle='#fff';ctx.fillText(small,cx+shift-6,base-58);}
        const size=fit(ctx,big,barW-14,44);ctx.font=display(size);ctx.lineWidth=7;ctx.strokeStyle=color;ctx.strokeText(big,cx+shift,base-18);ctx.fillStyle='#fff';ctx.fillText(big,cx+shift,base-18);},-.12);
      // Kill count with crosshair above the bar; the top fragger also gets the crown.
      const ny=yTop-30;crosshair(ctx,cx-30,ny-6,20,color);
      slant(ctx,()=>{ctx.font=display(64);ctx.textAlign='left';ctx.textBaseline='middle';const shift=ny*.18;ctx.lineWidth=8;ctx.strokeStyle='#000';ctx.strokeText(String(r.kills),cx-2+shift,ny);ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=14;ctx.fillText(String(r.kills),cx-2+shift,ny);});
      if(color===GOLD)crown(ctx,cx,ny-78,110);
    });
    // Floor line and footer.
    ctx.save();ctx.strokeStyle='rgba(255,60,40,.9)';ctx.shadowColor='#ff1a1a';ctx.shadowBlur=16;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(left-4,base+2);ctx.lineTo(right,base+2);ctx.stroke();ctx.restore();
    brush(ctx,W/2,1010,540,64,'rgba(150,0,0,.9)',rand,-.03);crown(ctx,W/2+190,948,48);
    slant(ctx,()=>{ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.font=display(76);ctx.lineWidth=10;ctx.strokeStyle='#1a0000';ctx.strokeText('FFK WAR',W/2+182,1012);ctx.fillStyle=red;ctx.fillText('FFK WAR',W/2+182,1012);
      ctx.font=display(48);ctx.lineWidth=8;ctx.strokeText(options.footer||'STRONGER TOGETHER',W/2+190,1062);ctx.fillStyle='#fff';ctx.fillText(options.footer||'STRONGER TOGETHER',W/2+190,1062);});
    return canvas;
  }
  const api={render,rows,size:{width:W,height:H}};
  if(typeof module!=='undefined')module.exports=api;else root.WarKillGraph=api;
})(typeof window==='undefined'?globalThis:window);
