// Scan integration with synthetic screenshots/workers; no browser profile or saved database.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const batch=require('../public/ocr-batch.js'),ocr=require('../public/ocr.js');
const fields=new Map();for(const id of ['#scan','#manual','#screenshots','#ocr-progress','#ocr-status','#match-name','#match-map'])fields.set(id,{disabled:false,hidden:true,value:id==='#match-name'?'Test':'Bermuda',textContent:''});
fields.get('#screenshots').files=[{name:'first',size:10},{name:'second',size:10}];
let nextURL=0,started=0,closed=0,inFlight=0,maxInFlight=0;const merges=[],completed=[];
const context=vm.createContext({console,structuredClone,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,DOMException,crypto:require('node:crypto').webcrypto,
 document:{querySelector:s=>fields.get(s),getElementById:()=>null,createElement:()=>({})},window:{addEventListener(){},Tesseract:true,WarOCRBatch:true},navigator:{hardwareConcurrency:8,deviceMemory:8},
 Image:class{async decode(){}},URL:{createObjectURL:()=>String(nextURL++),revokeObjectURL(){}},
 Tesseract:{createWorker:async()=>{started++;return {setParameters:async()=>{},terminate:async()=>closed++};}},
 WarOCRBatch:batch,WarOCRLearning:{load:async()=>{}},
 WarOCR:{...ocr,extract:async(_,image)=>{inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);await new Promise(r=>setTimeout(r,image.src==='0'?25:1));inFlight--;completed.push(image.src);return [{placement:1,teamId:'team0',players:Array.from({length:4},(_,i)=>({playerId:'p'+i,name:'Player '+i,kills:Number(image.src)+1}))}];},merge:(existing,row)=>{merges.push(row.players[0].kills);return ocr.merge(existing,row);}},
 setMatchLoading(){},toast(){}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8'),context);
vm.runInContext("state={teams:Array.from({length:12},(_,i)=>({id:'team'+i,players:[]})),matches:[]};api=async()=>({available:false});showSources=()=>{};redrawReview=()=>{};toast=()=>{};",context);
(async()=>{
 await vm.runInContext('scan()',context);assert.equal(maxInFlight,2);assert.equal(started,2);assert.equal(closed,2);assert.deepEqual(completed,['1','0']);assert.deepEqual(merges,[1,2]);
 assert.equal(vm.runInContext('draft.rows[0].players[0].kills',context),null,'Conflicting screenshots must remain flagged');
 assert.equal(vm.runInContext('busy',context),false);assert.equal(fields.get('#scan').disabled,false);assert.equal(fields.get('#ocr-progress').value,1);
 assert.equal(vm.runInContext('images[0].rows[0].players[0].kills',context),1);assert.equal(vm.runInContext('images[1].rows[0].players[0].kills',context),2);
 // Panel boxes drawn on the 1392-wide editor scale to the image actually sent (a large photo is sent at 2400px).
 const scaled=JSON.parse(vm.runInContext('JSON.stringify(scaleBounds([{x:696,y:100,width:348,height:200}],2400))',context))[0];
 assert.deepEqual(Object.fromEntries(Object.entries(scaled).map(([k,v])=>[k,Math.round(v*1000)/1000])),{x:1200,y:172.414,width:600,height:344.828});
 assert.equal(vm.runInContext('scaleBounds([],2400)',context),undefined);
 console.log('PASS: parallel scan wiring, original merge order, conflict review, evidence alignment, aggregate progress and worker/UI cleanup, panel bounds scaled to the sent image.');
})().catch(e=>{console.error(e);process.exitCode=1});
