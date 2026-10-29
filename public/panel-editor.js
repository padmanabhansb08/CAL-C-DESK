/* Result-panel boxes for one screenshot. Draw them with a pointer, or without one: "Start with two boxes"
   places a left and right box, then arrow keys move the selected box (Shift + arrows resizes) and exact
   numbers are available for each box. Coordinates are on a 1392-wide canvas, as the reader expects. */
function editPanels(index){
 const source=images[index];if(!source)return;
 const names=['Left results','Right results'];
 modal(`<h2>Adjust result panels</h2><p>Mark the left results table, then the right one. Include the placement numbers and every visible player row; leave out banners and the Back button.</p>
  <p id="bounds-step" class="notice" aria-live="polite"></p>
  <div class="actions bounds-tools"><button type="button" id="bounds-default">Start with two boxes</button><button type="button" id="bounds-select" aria-pressed="false" disabled>Selected: left</button><button type="button" id="bounds-reset">Clear boxes</button></div>
  <canvas id="bounds-canvas" tabindex="0" role="application" aria-label="Screenshot ${index+1}. Drag to draw a box. With a box selected, arrow keys move it and Shift plus arrow keys resize it." aria-describedby="bounds-step" style="display:block;width:100%;height:auto;touch-action:none;cursor:crosshair"></canvas>
  <details class="bounds-exact"><summary>Exact box positions</summary><div id="bounds-fields"></div></details>
  <div class="actions"><button type="button" id="bounds-save" class="primary" disabled>Use these panels &amp; read again</button><button type="button" onclick="closeModal()">Cancel</button></div>`,{wide:true});
 const canvas=$('#bounds-canvas'),ctx=canvas.getContext('2d'),im=new Image();let boxes=(source.bounds||[]).map(b=>({...b})),start=null,current=null,active=0;
 const clamp=b=>{b.width=Math.max(100,Math.min(canvas.width,b.width));b.height=Math.max(80,Math.min(canvas.height,b.height));b.x=Math.max(0,Math.min(canvas.width-b.width,b.x));b.y=Math.max(0,Math.min(canvas.height-b.height,b.y));['x','y','width','height'].forEach(k=>b[k]=Math.round(b[k]));};
 function draw(){ctx.drawImage(im,0,0,canvas.width,canvas.height);[...boxes,...(current?[current]:[])].forEach((b,i)=>{const color=i===0?'#68e7f3':'#ffbd49';ctx.strokeStyle=color;ctx.lineWidth=i===active&&!current?5:3;ctx.fillStyle=color+'22';ctx.fillRect(b.x,b.y,b.width,b.height);ctx.strokeRect(b.x,b.y,b.width,b.height);ctx.font='bold 18px sans-serif';ctx.fillStyle=color;ctx.fillText(names[i]?.toUpperCase()||'',b.x+5,b.y+22);});}
 function sync(){
  draw();
  $('#bounds-step').textContent=boxes.length===0?'1. Mark the left results table: drag on the screenshot, or choose “Start with two boxes”.':boxes.length===1?'2. Now mark the right results table.':`Both panels marked. ${names[active]} is selected: arrow keys move it, Shift + arrow keys resize it.`;
  $('#bounds-save').disabled=boxes.length!==2;
  const select=$('#bounds-select');select.disabled=boxes.length<2;select.textContent='Selected: '+(active===0?'left':'right');
  $('#bounds-fields').innerHTML=boxes.map((b,i)=>`<fieldset><legend>${names[i]}</legend>${['x','y','width','height'].map(k=>`<label>${k==='x'?'Left':k==='y'?'Top':k[0].toUpperCase()+k.slice(1)}<input type="number" data-box="${i}" data-key="${k}" value="${b[k]}" min="0" max="${k==='x'||k==='width'?canvas.width:canvas.height}"></label>`).join('')}</fieldset>`).join('')||'<p class="caption">Mark a box first.</p>';
  document.querySelectorAll('[data-box]').forEach(input=>input.onchange=()=>{const b=boxes[+input.dataset.box];b[input.dataset.key]=Number(input.value)||0;clamp(b);active=+input.dataset.box;sync();});
 }
 const point=e=>{const r=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(canvas.width,(e.clientX-r.left)*canvas.width/r.width)),y:Math.max(0,Math.min(canvas.height,(e.clientY-r.top)*canvas.height/r.height))};};
 canvas.onpointerdown=e=>{if(boxes.length>=2)return;start=point(e);canvas.setPointerCapture(e.pointerId);};
 canvas.onpointermove=e=>{if(!start)return;const end=point(e);current={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(start.x-end.x),height:Math.abs(start.y-end.y)};draw();};
 canvas.onpointerup=()=>{if(current&&current.width>100&&current.height>80){clamp(current);boxes.push(current);active=boxes.length-1;}start=null;current=null;sync();};
 canvas.onkeydown=e=>{const b=boxes[active],step=e.altKey?2:10,d={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];if(!b||!d)return;e.preventDefault();if(e.shiftKey){b.width+=d[0];b.height+=d[1];}else{b.x+=d[0];b.y+=d[1];}clamp(b);sync();};
 $('#bounds-default').onclick=()=>{const w=canvas.width,h=canvas.height;boxes=[{x:w*.04,y:h*.17,width:w*.44,height:h*.76},{x:w*.52,y:h*.17,width:w*.44,height:h*.76}];boxes.forEach(clamp);active=0;sync();canvas.focus();};
 $('#bounds-select').onclick=()=>{active=active?0:1;sync();canvas.focus();};
 $('#bounds-reset').onclick=()=>{boxes=[];current=null;start=null;active=0;sync();};
 $('#bounds-save').onclick=()=>{source.bounds=boxes;closeModal();scan(true);};
 im.onload=()=>{canvas.width=1392;canvas.height=Math.round(im.naturalHeight*1392/im.naturalWidth);boxes.forEach(clamp);sync();};im.src=source.url;
}
