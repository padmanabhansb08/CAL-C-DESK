/* Locate repeated yellow kill columns at the image's own aspect ratio. */
(function(root){
function median(a){const s=a.slice().sort((a,b)=>a-b);return s[Math.floor(s.length/2)];}
function detect(source,bounds){
 const {width:w,height:h}=source,ctx=source.getContext('2d'),d=ctx.getImageData(0,0,w,h).data,mask=new Uint8Array(w*h),seen=new Uint8Array(w*h),components=[];
 for(let i=0;i<mask.length;i++){const r=d[i*4],g=d[i*4+1],b=d[i*4+2];mask[i]=r>155&&g>120&&r-b>70&&g-b>55?1:0;}
 for(let y=5;y<h-5;y++)for(let x=Math.floor(w*.15);x<w*.96;x++){const start=y*w+x;if(!mask[start]||seen[start])continue;let x0=x,x1=x,y0=y,y1=y,n=0;const queue=[start];seen[start]=1;
  for(let q=0;q<queue.length;q++){const i=queue[q],xx=i%w,yy=Math.floor(i/w);n++;x0=Math.min(x0,xx);x1=Math.max(x1,xx);y0=Math.min(y0,yy);y1=Math.max(y1,yy);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=xx+dx,ny=yy+dy;if(nx<0||nx>=w||ny<0||ny>=h)continue;const j=ny*w+nx;if(mask[j]&&!seen[j]){seen[j]=1;queue.push(j);}}}
  const cw=x1-x0+1,ch=y1-y0+1,inBounds=!bounds||bounds.some(b=>(x0+x1)/2>=b.x&&(x0+x1)/2<=b.x+b.width&&(y0+y1)/2>=b.y&&(y0+y1)/2<=b.y+b.height);if(inBounds&&ch>=8&&ch<=34&&cw>=2&&cw<=40&&n>=12)components.push({x0,x1,y0,y1,x:(x0+x1)/2,y:(y0+y1)/2,n});
 }
 const clusters=[];for(const c of components.sort((a,b)=>a.x-b.x)){let group=clusters.find(g=>Math.abs(g.x-c.x)<22);if(!group){group={x:c.x,items:[]};clusters.push(group);}group.items.push(c);group.x=median(group.items.map(v=>v.x));}
 const eligible=clusters.filter(g=>g.items.length>=5);let columns=[],bestScore=-Infinity;
 for(let a=0;a<eligible.length;a++)for(let b=a+1;b<eligible.length;b++)for(let c=b+1;c<eligible.length;c++)for(let e=c+1;e<eligible.length;e++){
  const set=[eligible[a],eligible[b],eligible[c],eligible[e]],left=set[1].x-set[0].x,middle=set[2].x-set[1].x,right=set[3].x-set[2].x;
  if(left<150||right<125||middle<150||left/right<1.05||left/right>1.7)continue;
  const score=set.reduce((n,c)=>n+Math.min(12,c.items.length),0)-30*Math.abs(left/right-1.36)-20*Math.abs(middle/left-1.2);
  if(score>bestScore){columns=set;bestScore=score;}
 }
 if(columns.length!==4||columns.some((c,i)=>i&&c.x-columns[i-1].x<100))return {candidates:clusters.map(c=>({x:c.x,n:c.items.length})),columns:[],panels:[],reason:'Could not locate four complete kill columns. Adjust the result-panel bounds.'};
 columns.forEach(c=>{const lines=[];for(const item of c.items.sort((a,b)=>a.y-b.y)){let line=lines.find(l=>Math.abs(l.y-item.y)<8);if(!line){line={y:item.y,items:[]};lines.push(line);}line.items.push(item);line.y=median(line.items.map(v=>v.y));}c.lines=lines.map(l=>({y:l.y,x0:Math.min(...l.items.map(i=>i.x0)),x1:Math.max(...l.items.map(i=>i.x1)),y0:Math.min(...l.items.map(i=>i.y0)),y1:Math.max(...l.items.map(i=>i.y1))}));c.x0=median(c.lines.map(l=>l.x0));c.x1=median(c.lines.map(l=>l.x1));});
 const panels=[];for(let side=0;side<2;side++){
  const first=columns[side*2],second=columns[side*2+1],all=[...first.lines,...second.lines].sort((a,b)=>a.y-b.y),ys=[];for(const line of all){const group=ys.find(g=>Math.abs(g.y-line.y)<8);if(group){group.values.push(line.y);group.y=median(group.values);}else ys.push({y:line.y,values:[line.y]});}
  ys.sort((a,b)=>a.y-b.y);const gaps=ys.slice(1).map((v,i)=>v.y-ys[i].y).filter(g=>g>15&&g<65);if(!gaps.length)continue;const normal=median(gaps);
  // Pair adjacent player lines only when the inter-line gap is shorter than the next panel gap.
  let i=0;while(i<ys.length-1){const gap=ys[i+1].y-ys[i].y,next=i+2<ys.length?ys[i+2].y-ys[i+1].y:Infinity;
   if(gap>=16&&gap<=normal*1.25&&(next>=gap*.95||i===ys.length-2)){const top=ys[i].y,bottom=ys[i+1].y,panelHeight=(bottom-top)*2.15,rankX=side===0?first.x-(second.x-first.x)*.72:first.x-(second.x-first.x)*.9;
    panels.push({side,top,bottom,rankBox:[Math.round(rankX-21),Math.round((top+bottom)/2-panelHeight*.3),42,Math.round(panelHeight*.6)],first,second});i+=2;
   }else i++;
  }
 }
 return {columns,panels,reason:panels.length?'':'Player rows could not be paired reliably.'};
}
const api={detect};if(typeof module!=='undefined')module.exports=api;else root.WarLayout=api;
})(typeof window!=='undefined'?window:globalThis);
