/* Original FFK War artwork template; table values come only from saved match data. */
(function(root){
  const pad=n=>String(n).padStart(2,'0');
  function text(ctx,value,x,y,maxWidth,font='700 21px "Barlow Condensed", sans-serif',color='#111',align='center'){
    ctx.font=font;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillStyle=color;
    let size=Number(font.match(/(\d+)px/)[1]);while(ctx.measureText(String(value)).width>maxWidth&&size>11){size--;ctx.font=font.replace(/\d+px/,size+'px');}ctx.fillText(String(value),x,y);
  }
  async function render(canvas,rows,options={}){
    if(document.fonts)await document.fonts.ready;
    const art=new Image();art.src='assets/scoreboard-reference.png';await art.decode();
    canvas.width=2364;canvas.height=1194;const ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.drawImage(art,0,0,1182,597);
    // Cover every reference result/date before drawing the current match.
    ctx.fillStyle='#090909';ctx.fillRect(48,145,660,429);ctx.fillRect(355,113,274,30);
    const dateGradient=ctx.createLinearGradient(355,0,620,0);dateGradient.addColorStop(0,'#e00000');dateGradient.addColorStop(.6,'#8c0000');dateGradient.addColorStop(1,'#111');ctx.fillStyle=dateGradient;ctx.fillRect(362,116,262,24);
    text(ctx,options.date||'',436,128,140,'700 24px "Barlow Condensed", sans-serif','#fff');text(ctx,'WEEK '+(options.week||'01'),565,128,99,'700 21px "Barlow Condensed", sans-serif','#fff');
    const x=[55,106,308,385,463,547,626,700],y=150,rowHeight=32,headers=['POS','TEAM NAME','MATCH','PLACE','FINISH','TOTAL','WINS'];
    for(let col=0;col<7;col++){ctx.fillStyle='#e8edf0';ctx.fillRect(x[col],y,x[col+1]-x[col]-1,30);text(ctx,headers[col],(x[col]+x[col+1])/2,y+15,x[col+1]-x[col]-8,'700 18px "Barlow Condensed", sans-serif');}
    rows.forEach((r,i)=>{
      const yy=y+32+i*rowHeight,highlight=i<Number(options.highlight??6),fill=ctx.createLinearGradient(0,yy,0,yy+30);fill.addColorStop(0,highlight?'#e50909':'#f3f5f7');fill.addColorStop(1,highlight?'#a50000':'#cdd7dd');
      const values=[pad(r.rank??(i+1)),r.name,r.matches??(options.match||'01'),pad(r.place),pad(r.kills),pad(r.total),r.wins?pad(r.wins):'–'];
      for(let col=0;col<7;col++){ctx.fillStyle=col===5?'#ffcd2e':fill;ctx.fillRect(x[col],yy,x[col+1]-x[col]-1,30);const color=col===5||!highlight?'#111':'#fff';if(col===1){ctx.beginPath();ctx.arc(125,yy+15,12,0,Math.PI*2);ctx.fillStyle='#b80000';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.stroke();text(ctx,'FFK',125,yy+15,20,'700 11px "Barlow Condensed", sans-serif','#fff');text(ctx,values[col],146,yy+15,x[col+1]-151,'700 21px "Barlow Condensed", sans-serif',color,'left');}else{text(ctx,values[col],(x[col]+x[col+1])/2,yy+15,x[col+1]-x[col]-8,'700 22px "Barlow Condensed", sans-serif',color);}}
    });
    ctx.fillStyle='#080808';ctx.fillRect(53,569,650,19);text(ctx,options.note||'1 KILL = 1 POINT  /  TOTAL INCLUDES HOST ADJUSTMENTS',58,579,638,'600 12px "Barlow Condensed", sans-serif','#fff','left');
    return canvas;
  }
  root.WarScoreboard={render};
})(window);

