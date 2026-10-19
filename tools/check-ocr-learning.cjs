// Exercise real browser persistence without touching the organizer's saved results or browser profile.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const deps=process.env.OCR_NODE_MODULES||'C:/Users/Acer/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(path.join(deps,'playwright'));
(async()=>{
 const server=http.createServer((req,res)=>{const file={'/ocr.js':'ocr.js','/learning.js':'ocr-learning.js','/app.js':'app.js'}[req.url];res.setHeader('Content-Type',file?'application/javascript':'text/html');let body=file?fs.readFileSync(path.join(__dirname,'../public',file),'utf8'):'<html><body>OCR storage verification</body></html>';if(file==='app.js')body=body.replace(/\binit\(\);\s*$/,'');res.end(body);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,channel:process.env.OCR_BROWSER_CHANNEL||'msedge'});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>{globalThis.WarDigitTemplates=[];});await page.addScriptTag({url:'/ocr.js'});await page.addScriptTag({url:'/learning.js'});
  const result=await page.evaluate(async()=>{
   const canvas=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
   const source=canvas(2784,1580),ctx=source.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,source.width,source.height);ctx.fillStyle='#ffdd22';ctx.font='30px sans-serif';ctx.fillText('8',200,240);
   const region={digits:[98,103,24,22],width:1392,height:790};
   const sources=[{image:source,fileKey:'test-source',rows:[{placement:1,players:[{kills:5,ocrRegion:region}]}]}];
   const match={id:'test-match-1',created:new Date().toISOString(),rows:[{placement:1,confirmed:true,players:[{killEdited:true,kills:8}]}]};
   const records=WarOCRLearning.capture(match,sources,canvas);globalThis.testSources=sources;
   const unconfirmed=WarOCRLearning.capture({...match,rows:[{...match.rows[0],confirmed:false}]},sources,canvas).length;
   const unedited=WarOCRLearning.capture({...match,rows:[{...match.rows[0],players:[{kills:8}]}]},sources,canvas).length;
   const unchanged=WarOCRLearning.capture({...match,rows:[{...match.rows[0],players:[{killEdited:true,kills:5}]}]},sources,canvas).length;
   const duplicateFrames=WarOCRLearning.capture(match,sources.concat(sources),canvas).length;
   await WarOCRLearning.store(records);const firstActive=WarDigitTemplates.length;
   await WarOCRLearning.store(records);const deduplicated=await WarOCRLearning.load();
   await WarOCRLearning.store(records.map(r=>({...r,id:'test-match-2:1:0',matchId:'test-match-2'})));
   const active=WarDigitTemplates.length;
   return {captured:records.length,unconfirmed,unedited,unchanged,duplicateFrames,firstActive,deduplicated,active,crop:records[0]?.crop.startsWith('data:image/png;base64,')};
  });
  assert.deepEqual(result,{captured:1,unconfirmed:0,unedited:0,unchanged:0,duplicateFrames:1,firstActive:0,deduplicated:1,active:2,crop:true});
  await page.addScriptTag({url:'/app.js'});
  const lifecycle=await page.evaluate(async()=>{
   document.body.innerHTML='<input id="match-name" value="Verified test"><select id="match-map"><option>Bermuda</option></select>';
   render=()=>{};toast=()=>{};
   state={teams:Array.from({length:12},(_,i)=>({id:'t'+i,name:'Team '+i})),matches:[]};
   draft={id:'test-match-3',rows:Array.from({length:12},(_,i)=>({placement:i+1,teamId:'t'+i,confirmed:true,players:[{kills:8,killEdited:i===0,ocrRegion:{digits:[1,1,2,2]}}]}))};
   images=testSources;
   save=async()=>{throw Error('Simulated failed match save');};await finalize();
   const failed={matches:state.matches.length,draft:!!draft,examples:await WarOCRLearning.load(),busy};
   save=async()=>{};await finalize();
   const saved={matches:state.matches.length,draft:!!draft,examples:await WarOCRLearning.load(),busy,metadata:'ocrRegion' in state.matches[0].rows[0].players[0]};
   return {failed,saved};
  });
  assert.deepEqual(lifecycle,{failed:{matches:0,draft:true,examples:2,busy:false},saved:{matches:1,draft:false,examples:3,busy:false,metadata:false}});
  await page.reload();await page.evaluate(()=>{globalThis.WarDigitTemplates=[];});await page.addScriptTag({url:'/learning.js'});assert.equal(await page.evaluate(()=>WarOCRLearning.load()),3);
  console.log('PASS: reviewed crops, native crop mapping, save/reload persistence, deduplication, draft exclusions, and two-match activation.');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
