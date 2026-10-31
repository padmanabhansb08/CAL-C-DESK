/* Reading progress: stays on the page, shows each screenshot, can be cancelled without losing earlier results. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {dep,launchOptions}=require('./deps.cjs');
const {chromium}=dep('playwright');
const publicRoot=path.resolve(__dirname,'../public');
const fixture={teams:Array.from({length:24},(_,i)=>({id:'team-'+i,name:'FFK SQUAD '+(i+1),players:Array.from({length:4},(_,j)=>({id:`p-${i}-${j}`,name:`Player ${i+1}.${j+1}`}))})),matches:[]};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2H0AAAAASUVORK5CYII=','base64');
let scanCalls=0,releaseScan;
const server=http.createServer(async(req,res)=>{
  const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(req.url==='/api/session')return reply(200,{authenticated:true});
  if(req.url==='/api/ocr/status')return reply(200,{available:false,scan:true});
  if(req.url==='/api/state')return req.method==='GET'?reply(200,fixture):reply(200,{ok:true});
  if(req.url==='/api/ocr/scan'){scanCalls++;await new Promise(resolve=>{releaseScan=resolve;});return reply(200,{panels:[],warnings:[]});}
  const target=path.resolve(publicRoot,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
  if(!target.startsWith(publicRoot+path.sep)){res.writeHead(403);return res.end();}
  try{const data=await fs.readFile(target);res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.png':'image/png'})[path.extname(target)]||'text/html');res.end(data);}
  catch{res.writeHead(404);res.end();}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;let browser;
  try{
    browser=await chromium.launch(launchOptions());
    const page=await browser.newPage({viewport:{width:1366,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://**',route=>route.fulfill({status:200,body:''}));
    await page.goto(origin);await page.waitForSelector('.comfort-shell');
    await page.evaluate(()=>go('upload'));
    // An earlier, unsaved result must survive a cancelled re-read.
    await page.getByRole('button',{name:'Enter results by hand'}).click();
    await page.evaluate(()=>{draft.rows[0].teamId='team-0';draft.name='Kept draft';redrawReview();});
    await page.locator('#screenshots').setInputFiles([{name:'first.png',mimeType:'image/png',buffer:png},{name:'second.png',mimeType:'image/png',buffer:png}]);
    await page.evaluate(()=>{window.__scan=scan(true);});
    await page.locator('#scan-card').waitFor();
    assert.equal(await page.locator('#match-loading').count(),0,'No full-screen overlay');
    assert(await page.locator('.nav').isVisible(),'Navigation stays visible while reading');
    assert.equal(await page.locator('.intake-panel').isVisible(),false,'The upload form gives way to the reading page');
    assert(await page.locator('#reading-pct').isVisible(),'The overall percentage is shown');
    assert.equal(await page.locator('#reading-line > span').count(),2,'One completion segment per screenshot');
    assert.equal(await page.locator('.scan-list li').count(),2,'One line per screenshot');
    await page.waitForFunction(()=>document.querySelector('#scan-item-0')?.classList.contains('is-active'));
    assert.equal(await page.locator('#scan-item-1 .scan-state').innerText(),'Waiting');
    await page.waitForFunction(()=>/so far/.test(document.querySelector('#scan-card-note')?.textContent||''),null,{timeout:4000});
    await page.locator('#scan-cancel').click();
    await page.waitForFunction(()=>!document.querySelector('#scan-card'));
    assert.equal(await page.evaluate(()=>document.body.classList.contains('is-reading')),false,'The reading page is gone after cancelling');
    assert((await page.locator('#toast').innerText()).includes('earlier results are unchanged'),'Says reading was cancelled and nothing was lost');
    assert.equal(await page.evaluate(()=>draft?.rows[0].teamId),'team-0','Earlier results are restored after cancelling');
    assert.equal(await page.locator('.desk-row').count(),12,'The earlier results check is shown again');
    assert.equal(scanCalls,1,'Cancelling stops before the next screenshot');
    assert.equal(await page.evaluate(()=>busy),false,'The desk is usable again');
    releaseScan?.();
    assert.deepEqual(errors,[]);
    console.log('PASS: reading shows its own page (percentage, completion line, one card per screenshot, elapsed time and cancel); cancelling keeps earlier results.');
  }finally{releaseScan?.();if(browser)await browser.close();server.closeAllConnections?.();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
