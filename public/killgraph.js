/* Kill graph artwork: the FFK WAR "KILL GRAPH" poster (week, set, day, map) drawn from saved results. 1920 x 1080.
   Bar height is proportional to kills and nothing else; names sit under the floor at one size; the header is laid
   out from measured text so labels never collide; the top fragger is gold and crowned. */
(function(root){
  const W=1920,H=1080;
  const NEON=['#2ea8ff','#ff3b3b','#b44dff','#2bea6a','#ff8a1a','#ff4fc3','#4f7bff','#e15cff','#19d9c8','#e8e8e8','#ffb21a','#8cff3a','#ff6b6b','#4dd2ff','#c77dff','#ffd84d'];
  const GOLD='#ffc21a';
  const MAP_ART={bermuda:'bermuda-map.jpeg',purgatory:'purgatory-map.jpg',kalahari:'kalahari-map.jpg',solara:'solara-map.jpg',nexterra:'nexterra-map.png',alpine:'alpine-map.jpg'};
  const cache={};
  function image(src){return cache[src]||=new Promise((ok,no)=>{const im=new Image();im.onload=()=>ok(im);im.onerror=()=>{delete cache[src];no(Error('Could not load '+src));};im.src=src;});}
  const display=(size,weight=800)=>`${weight} ${size}px "Barlow Condensed", "DM Sans", sans-serif`;

  // Kills per team over the chosen matches. Slot order only when every team has its own slot; otherwise most kills
  // first. `tag` is what stands under the bar: the slot when ordered by slot, else the rank.
  function rows(state,matches,order='slot'){
    const by=new Map();
    matches.forEach(m=>m.rows.forEach(r=>{
      const kills=r.overall?r.kills:(r.players||[]).reduce((n,p)=>n+(Number(p.kills)||0),0);
      const cur=by.get(r.teamId)||{teamId:r.teamId,name:r.teamName,kills:0};cur.kills+=kills;by.set(r.teamId,cur);
    }));
    const list=[...by.values()].map(r=>{const team=(state.teams||[]).find(t=>t.id===r.teamId);return {...r,name:team?.name||r.name,slot:Number.isInteger(team?.slot)?team.slot:null};});
    const bySlot=order==='slot'&&list.every(r=>r.slot!==null)&&new Set(list.map(r=>r.slot)).size===list.length;
    list.sort((a,b)=>bySlot?a.slot-b.slot:b.kills-a.kills||String(a.name).localeCompare(String(b.name)));
    let rank=0;list.forEach((r,i)=>{if(i===0||r.kills!==list[i-1].kills)rank=i+1;r.tag=bySlot?'SLOT '+r.slot:'#'+rank;});
    return list;
  }

  // Draw text slanted like the poster lettering, anchored where it would stand upright.
  function slanted(ctx,draw,x,y,skew=-.16){ctx.save();ctx.translate(x,y);ctx.transform(1,0,skew,1,0,0);draw();ctx.restore();}
  function fitSize(ctx,text,max,size,min=14,weight=800){let s=size;ctx.font=display(s,weight);while(s>min&&ctx.measureText(text).width>max){s--;ctx.font=display(s,weight);}return s;}
  function strokeFill(ctx,text,x,y,fill,stroke,line){ctx.lineJoin='round';if(stroke){ctx.lineWidth=line;ctx.strokeStyle=stroke;ctx.strokeText(text,x,y);}ctx.fillStyle=fill;ctx.fillText(text,x,y);}
  function rng(seed){let s=seed>>>0||1;return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};}
  function brush(ctx,cx,cy,w,h,color,rand,tilt=0){
    ctx.save();ctx.translate(cx,cy);ctx.rotate(tilt);ctx.beginPath();ctx.moveTo(-w/2,-h/2);
    for(let i=1;i<=12;i++)ctx.lineTo(-w/2+w*i/12,-h/2+(rand()-.5)*h*.12);
    ctx.lineTo(w/2+h*.35,-h*.1);ctx.lineTo(w/2,h/2);
    for(let i=11;i>=0;i--)ctx.lineTo(-w/2+w*i/12,h/2+(rand()-.5)*h*.12);
    ctx.lineTo(-w/2-h*.35,h*.1);ctx.closePath();ctx.fillStyle=color;ctx.fill();ctx.restore();
  }
  function bolt(ctx,x,y,len,angle,rand,alpha){
    ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle='#ff4a3a';ctx.shadowColor='#ff1a1a';ctx.shadowBlur=14;ctx.lineJoin='round';
    const walk=(x,y,len,a,w,depth)=>{ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(x,y);const n=9;
      for(let i=0;i<n;i++){const d=a+(rand()-.5)*1;x+=Math.cos(d)*len/n;y+=Math.sin(d)*len/n;ctx.lineTo(x,y);if(depth<1&&rand()<.2){ctx.stroke();walk(x,y,len*.4,d+(rand()-.5)*1.2,w*.55,depth+1);ctx.beginPath();ctx.moveTo(x,y);}}
      ctx.stroke();};
    walk(x,y,len,angle,2.6,0);ctx.restore();
  }
  function crown(ctx,cx,cy,size){
    ctx.save();ctx.translate(cx,cy);ctx.scale(size/100,size/100);
    const g=ctx.createLinearGradient(0,-45,0,40);g.addColorStop(0,'#fff6b0');g.addColorStop(.5,'#ffc21a');g.addColorStop(1,'#b86b00');
    ctx.beginPath();ctx.moveTo(-50,28);ctx.lineTo(-56,-24);ctx.lineTo(-26,2);ctx.lineTo(0,-40);ctx.lineTo(26,2);ctx.lineTo(56,-24);ctx.lineTo(50,28);ctx.closePath();
    ctx.shadowColor='rgba(255,190,0,.9)';ctx.shadowBlur=26;ctx.fillStyle=g;ctx.fill();ctx.shadowBlur=0;ctx.lineWidth=4;ctx.strokeStyle='#6e3600';ctx.stroke();
    ctx.fillStyle=g;ctx.fillRect(-50,28,100,14);ctx.strokeRect(-50,28,100,14);
    [[-56,-24],[0,-40],[56,-24]].forEach(([x,y])=>{ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.fillStyle='#fff6b0';ctx.fill();ctx.stroke();});
    [-26,0,26].forEach(x=>{ctx.beginPath();ctx.arc(x,17,6,0,Math.PI*2);ctx.fillStyle='#e8124f';ctx.fill();});
    ctx.restore();
  }
  function crosshair(ctx,cx,cy,r,color){
    ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=r*.2;ctx.shadowColor=color;ctx.shadowBlur=8;
    ctx.beginPath();ctx.arc(cx,cy,r*.62,0,Math.PI*2);ctx.stroke();
    [[0,-1],[0,1],[-1,0],[1,0]].forEach(([dx,dy])=>{ctx.beginPath();ctx.moveTo(cx+dx*r*.38,cy+dy*r*.38);ctx.lineTo(cx+dx*r,cy+dy*r);ctx.stroke();});
    ctx.beginPath();ctx.arc(cx,cy,r*.15,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  function topRounded(ctx,x,y,w,h,r){r=Math.min(r,h,w/2);ctx.beginPath();ctx.moveTo(x,y+h);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);ctx.lineTo(x+w,y+h);ctx.closePath();}
  function niceStep(max){const raw=max/6,p=10**Math.floor(Math.log10(raw||1)),n=raw/p;return Math.max(1,(n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p);}
  function shade(hex,f){const n=parseInt(hex.slice(1),16),c=[n>>16,(n>>8)&255,n&255].map(v=>Math.round(f<0?v*(1+f):v+(255-v)*f));return `rgb(${c.join(',')})`;}

  async function render(canvas,list,options={}){
    if(document.fonts)await document.fonts.ready;
    canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d'),rand=rng(list.reduce((n,r)=>n*31+r.kills+String(r.name).length,7)||7);
    const mapKey=String(options.map||'').toLowerCase().replace(/[^a-z]/g,'');
    const [art,mascot]=await Promise.all([MAP_ART[mapKey]?image('assets/'+MAP_ART[mapKey]).catch(()=>null):null,image('assets/mascot-badge.png').catch(()=>null)]);

    // ---- Background: deep red, the map toned red on the right, a few bolts at the edges only.
    const bg=ctx.createLinearGradient(0,0,W,H);bg.addColorStop(0,'#3d0406');bg.addColorStop(.5,'#1c0203');bg.addColorStop(1,'#0a0101');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
    const glow=ctx.createRadialGradient(W*.3,H*.55,40,W*.3,H*.55,W*.55);glow.addColorStop(0,'rgba(200,10,10,.35)');glow.addColorStop(1,'rgba(200,10,10,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,W,H);
    if(art){
      // Tint the map red on its own layer, then fade that layer out to the left and bottom, so no hard edges.
      const side=1000,layer=document.createElement?document.createElement('canvas'):null,off=layer||new canvas.constructor(side,side);off.width=side;off.height=side;
      const o=off.getContext('2d');o.drawImage(art,0,0,side,side);o.globalCompositeOperation='multiply';o.fillStyle='#a51414';o.fillRect(0,0,side,side);
      o.globalCompositeOperation='destination-in';const mx=o.createLinearGradient(0,0,side*.55,0);mx.addColorStop(0,'rgba(0,0,0,0)');mx.addColorStop(1,'rgba(0,0,0,1)');o.fillStyle=mx;o.fillRect(0,0,side,side);
      const my=o.createLinearGradient(0,side*.45,0,side*.78);my.addColorStop(0,'rgba(0,0,0,1)');my.addColorStop(1,'rgba(0,0,0,0)');o.fillStyle=my;o.fillRect(0,0,side,side);
      ctx.save();ctx.globalAlpha=.6;ctx.drawImage(off,W-side+40,-230);ctx.restore();}
    bolt(ctx,0,40,300,.9,rand,.55);bolt(ctx,W,620,260,Math.PI+.5,rand,.4);bolt(ctx,30,980,240,-.6,rand,.35);

    // ---- Header, laid out left to right from measured text.
    let x=30;
    if(mascot){const mh=230,mw=mascot.width/mascot.height*mh;ctx.save();ctx.shadowColor='rgba(0,0,0,.85)';ctx.shadowBlur=22;ctx.drawImage(mascot,x,22,mw,mh);ctx.restore();x+=mw+34;}
    const red=ctx.createLinearGradient(0,40,0,250);red.addColorStop(0,'#ff4436');red.addColorStop(1,'#b00000');
    const silver=ctx.createLinearGradient(0,150,0,250);silver.addColorStop(0,'#ffffff');silver.addColorStop(1,'#b4b4b4');
    ctx.globalAlpha=1;ctx.font=display(112);const brandW=Math.max(ctx.measureText('FFK').width,ctx.measureText('WAR').width)+30;
    slanted(ctx,()=>{ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.font=display(112);strokeFill(ctx,'FFK',0,0,red,'#160000',10);strokeFill(ctx,'WAR',8,108,silver,'#160000',10);},x,128);
    x+=brandW+40;
    const meta=[options.week&&'WEEK '+options.week,options.season&&'SEASON '+options.season].filter(Boolean).join('  ·  ');
    const ribbon=[options.set,options.day].filter(Boolean);
    const titleRight=1450,gold=ctx.createLinearGradient(0,70,0,200);gold.addColorStop(0,'#fff38a');gold.addColorStop(.55,'#ffcf1a');gold.addColorStop(1,'#e07a00');
    const title=options.title||'KILL GRAPH',titleBase=meta?182:178;
    const tSize=fitSize(ctx,title,titleRight-x,meta?136:150,60);
    if(meta)slanted(ctx,()=>{ctx.font=display(44,700);ctx.textAlign='left';strokeFill(ctx,meta,4,0,'#ffffff','#000',6);},x+4,52);
    slanted(ctx,()=>{ctx.font=display(tSize);ctx.textAlign='left';ctx.shadowColor='rgba(255,180,0,.45)';ctx.shadowBlur=26;strokeFill(ctx,title,0,0,gold,'#3a0000',14);},x,titleBase);
    if(ribbon.length){ctx.font=display(58);const gap=36,widths=ribbon.map(t=>ctx.measureText(t).width),total=widths.reduce((a,b)=>a+b,0)+gap*(ribbon.length-1)+70,cx=x+total/2+10,cy=232;
      brush(ctx,cx,cy,total+40,74,'#c80000',rand,-.02);brush(ctx,cx,cy,total,56,'#5a0000',rand,-.02);
      ctx.save();ctx.translate(x+26,cy);ctx.fillStyle='#ff2a2a';ctx.beginPath();ctx.arc(0,-8,17,Math.PI,0);ctx.lineTo(0,24);ctx.closePath();ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=4;ctx.stroke();ctx.beginPath();ctx.arc(0,-8,6,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.restore();
      let tx=x+60;ribbon.forEach((t,i)=>{slanted(ctx,()=>{ctx.font=display(58);ctx.textAlign='left';ctx.textBaseline='middle';strokeFill(ctx,t,0,2,i===0?'#ffffff':'#ffe14d','#1a0000',7);},tx,cy);tx+=widths[i]+gap;});}
    // Right side: tagline and map name.
    ctx.save();ctx.translate(1770,96);ctx.rotate(-.1);brush(ctx,0,0,250,150,'rgba(8,0,0,.85)',rand);ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font=display(40);ctx.fillStyle='#fff';ctx.fillText('ONE TEAM',0,-36);ctx.fillText('ONE DREAM',0,4);ctx.font=display(48);ctx.fillStyle='#ff2a2a';ctx.fillText('FFK',0,46);ctx.restore();
    if(options.map){const name=String(options.map).toUpperCase();ctx.font=display(64);const w=Math.min(380,ctx.measureText(name).width+70);
      brush(ctx,1690,262,w+20,92,'#650000',rand,-.08);brush(ctx,1690,262,w,74,'#d00000',rand,-.08);
      slanted(ctx,()=>{ctx.font=display(fitSize(ctx,name,w-40,64,30));ctx.textAlign='center';ctx.textBaseline='middle';strokeFill(ctx,name,0,2,'#fff','#1a0000',7);},1690,262);}

    // ---- Chart. Bars stand on the floor; height is kills only.
    const plotL=170,plotR=W-50,floor=840,top=470,count=Math.max(1,list.length),slotW=(plotR-plotL)/count,barW=Math.min(122,slotW*.64);
    const max=Math.max(1,...list.map(r=>r.kills)),step=niceStep(max),axisMax=Math.ceil(max/step)*step,yOf=v=>floor-(floor-top)*v/axisMax;
    ctx.save();ctx.textAlign='right';ctx.textBaseline='middle';ctx.font=display(30,700);
    for(let v=0;v<=axisMax+1e-9;v+=step){const y=yOf(v);ctx.strokeStyle=v===0?'rgba(255,255,255,0)':'rgba(255,255,255,.14)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(plotL-8,y);ctx.lineTo(plotR,y);ctx.stroke();strokeFill(ctx,String(Math.round(v*10)/10),plotL-26,y,'#ffffff','#000',5);}
    ctx.strokeStyle='#ff2a2a';ctx.shadowColor='#ff0000';ctx.shadowBlur=12;ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(plotL-8,floor);ctx.lineTo(plotL-8,top-50);ctx.stroke();
    ctx.beginPath();ctx.moveTo(plotL-8,top-70);ctx.lineTo(plotL-21,top-44);ctx.lineTo(plotL+5,top-44);ctx.closePath();ctx.fillStyle='#ff2a2a';ctx.fill();ctx.restore();

    const best=Math.max(...list.map(r=>r.kills));let colorIndex=0;
    // Names: "FFK " shown as a small tag, the rest at ONE size for every team.
    const split=name=>{const m=/^(FFK)[\s._-]+(.+)$/i.exec(String(name).trim());return m?['FFK',m[2].toUpperCase()]:['',String(name).toUpperCase()];};
    const nameSize=Math.min(...list.map(r=>fitSize(ctx,split(r.name)[1],slotW-14,40,18)));
    list.forEach((r,i)=>{
      const crowned=r.kills===best&&best>0,color=crowned?GOLD:NEON[colorIndex++%NEON.length],cx=plotL+slotW*(i+.5),x=cx-barW/2;
      const yTop=Math.min(floor-8,yOf(r.kills)),h=floor-yTop;
      // Bar: glowing body, darker toward the floor, bright cap and a glass highlight.
      ctx.save();ctx.shadowColor=color;ctx.shadowBlur=30;topRounded(ctx,x,yTop,barW,h,10);const body=ctx.createLinearGradient(0,yTop,0,floor);body.addColorStop(0,color);body.addColorStop(1,shade(color,-.62));ctx.fillStyle=body;ctx.fill();ctx.restore();
      ctx.save();topRounded(ctx,x,yTop,barW,h,10);ctx.clip();ctx.fillStyle='rgba(255,255,255,.22)';ctx.fillRect(x+8,yTop,Math.max(4,barW*.12),h);
      ctx.fillStyle='rgba(0,0,0,.12)';for(let y=yTop+6;y<floor;y+=8)ctx.fillRect(x,y,barW,2);
      ctx.fillStyle=shade(color,.45);ctx.fillRect(x,yTop,barW,Math.min(8,h));ctx.restore();
      ctx.save();topRounded(ctx,x,yTop,barW,h,10);ctx.lineWidth=3;ctx.strokeStyle=shade(color,.3);ctx.stroke();ctx.restore();
      // Count with crosshair above; crown over the top fragger.
      const ny=yTop-36;ctx.font=display(64);const nw=ctx.measureText(String(r.kills)).width,groupW=nw+50,gx=cx-groupW/2;
      crosshair(ctx,gx+18,ny-4,19,color);
      slanted(ctx,()=>{ctx.font=display(64);ctx.textAlign='left';ctx.textBaseline='middle';ctx.shadowColor=color;ctx.shadowBlur=12;strokeFill(ctx,String(r.kills),0,0,color,'#000',8);},gx+46,ny);
      if(crowned)crown(ctx,cx,ny-70,78);
      // Under the floor: slot (or rank) tag, then the name.
      const [small,big]=split(r.name);
      ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=display(24,700);ctx.fillStyle=color;ctx.fillText([r.tag,small].filter(Boolean).join('  ·  '),cx,floor+30);ctx.restore();
      slanted(ctx,()=>{ctx.font=display(nameSize);ctx.textAlign='center';ctx.textBaseline='middle';strokeFill(ctx,big,0,0,'#ffffff',shade(color,-.25),6);},cx,floor+68);
    });
    // Floor.
    ctx.save();ctx.strokeStyle='#ff3a2a';ctx.shadowColor='#ff1a1a';ctx.shadowBlur=18;ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(plotL-8,floor);ctx.lineTo(plotR,floor);ctx.stroke();ctx.restore();

    // ---- Footer, centred.
    brush(ctx,W/2,1000,560,58,'rgba(170,0,0,.92)',rand,-.02);
    slanted(ctx,()=>{ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=display(62);strokeFill(ctx,'FFK WAR',0,0,red,'#160000',9);},W/2,994);
    slanted(ctx,()=>{ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=display(38);strokeFill(ctx,options.footer||'STRONGER TOGETHER',0,0,'#ffffff','#160000',7);},W/2,1046);
    return canvas;
  }
  const api={render,rows,size:{width:W,height:H}};
  if(typeof module!=='undefined')module.exports=api;else root.WarKillGraph=api;
})(typeof window==='undefined'?globalThis:window);
