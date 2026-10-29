// Temporary browser fixtures only: never opens or writes the organizer database.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {dep,launchOptions}=require('./deps.cjs'),{chromium}=dep('playwright');
const root=path.resolve(__dirname,'../public');
const teams=Array.from({length:12},(_,i)=>({id:'t'+i,name:'Team '+i,players:Array.from({length:4},(_,j)=>({id:`p${i}-${j}`,name:`Player ${i}.${j}`}))}));
const match=(id,name,map)=>({id,name,map,created:'2026-10-29T00:00:00Z',rows:teams.map((t,i)=>({teamId:t.id,teamName:t.name,placement:i+1,confirmed:true,adjustments:[],players:t.players.map(p=>({playerId:p.id,name:p.name,kills:1}))}))});
const fixture={teams,matches:[match('opening','Opening round','Bermuda'),match('evening','Evening game','Purgatory')]};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'),reply=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
 if(url.pathname==='/api/session')return reply({authenticated:true});
 if(url.pathname==='/api/state')return reply(fixture);
 if(url.pathname==='/api/ocr/status')return reply({available:false,scan:false});
 const file=path.resolve(root,'.'+url.pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 try{const data=await fs.readFile(file);res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'})[path.extname(file)]||'text/html');res.end(data);}catch{res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch(launchOptions());const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
  const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(new URL(r.url()).pathname));
  const origin='http://127.0.0.1:'+server.address().port;
  let failBatch=true;await page.route('**/ocr-batch.js*',r=>{if(failBatch){failBatch=false;return r.abort();}return r.continue();});
  await page.goto(origin);await page.waitForSelector('.shell');await page.evaluate(()=>go('upload'));
  await page.getByRole('button',{name:'Retry screenshot tools'}).waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>!!window.WarOCR),true,'an early reader module loaded before the failure');
  assert.equal(await page.locator('.intake-panel').count(),0,'partial tools must not expose an incomplete intake');
  await page.getByRole('button',{name:'Retry screenshot tools'}).click();await page.waitForSelector('#manual');
  assert.equal(await page.evaluate(()=>!!window.WarOCRBatch&&typeof editPanels==='function'),true,'retry completes every reader dependency');
  assert.equal(requests.filter(p=>p==='/ocr.js').length,1,'successful modules are not executed again during retry');
  assert.equal(requests.filter(p=>p==='/ocr-batch.js').length,2,'only the failed script is requested again');

  // A new match resets placement/Undo state; navigating the same draft retains its placement.
  await page.locator('#manual').click();await page.locator('[data-jump="11"]').click();
  await page.evaluate(()=>{draft.rows.forEach((r,i)=>{r.teamId=state.teams[i].id;r.players=state.teams[i].players.map(p=>({playerId:p.id,name:p.name,kills:1}));});redrawReview();});
  await page.locator('#desk-confirm-ready').click();assert.equal(await page.locator('#desk-undo-bulk').count(),1);
  const previousDraftId=await page.evaluate(()=>draft.id);
  await page.locator('.intake-panel').evaluate(el=>el.open=true);await page.locator('#manual').click();await page.getByRole('button',{name:'Start fresh',exact:true}).click();await page.waitForFunction(id=>draft.id!==id,previousDraftId);
  assert.equal(await page.locator('.desk-row:visible').getAttribute('id'),'review-team-0','a fresh draft starts at placement 1');
  assert.equal(await page.locator('#desk-undo-bulk,#desk-undo-one').count(),0,'a fresh draft has no stale Undo controls');
  await page.locator('[data-jump="5"]').click();await page.evaluate(()=>go('roster'));await page.evaluate(()=>go('upload'));
  assert.equal(await page.locator('.desk-row:visible').getAttribute('id'),'review-team-5','the same draft retains the review position');

  await page.evaluate(()=>{draft=null;openMatchManager();});
  await page.locator('#saved-match-search').fill('pUrGaToRy');assert.equal(await page.locator('#saved-match-list .saved-match-row').count(),1);
  assert.match(await page.locator('#saved-match-list').innerText(),/Evening game/,'saved matches can be found by map');
  await page.locator('#saved-match-search').fill('OPENING');assert.match(await page.locator('#saved-match-list').innerText(),/Opening round/,'saved matches can be found by name');
  await page.locator('#saved-match-search').fill('no such match');assert.equal(await page.locator('#saved-match-list .saved-match-row').count(),0);assert(await page.locator('#saved-match-empty').isVisible());
  await page.locator('#saved-match-search').fill('');assert.equal(await page.locator('#saved-match-list .saved-match-row').count(),2,'clearing search restores all matches');

  // Navigating away after a later-module failure must also retry, without relying on WarOCR alone.
  const next=await context.newPage();let failPanels=true;await next.route('**/panel-editor.js*',r=>{if(failPanels){failPanels=false;return r.abort();}return r.continue();});
  await next.goto(origin);await next.waitForSelector('.shell');await next.evaluate(()=>go('upload'));await next.locator('#reader-retry').waitFor({state:'visible'});
  await next.evaluate(()=>go('roster'));await next.evaluate(()=>go('upload'));await next.waitForSelector('#manual');assert.equal(await next.evaluate(()=>typeof editPanels),'function');
  await next.setViewportSize({width:1440,height:1000});await next.locator('#manual').click();
  assert.equal(await next.locator('.desk-row:visible').count(),12,'desktop drafts default to all teams');
  await next.setViewportSize({width:390,height:844});await next.evaluate(()=>{draft={id:'new-phone',name:'New phone draft',map:'Bermuda',entry:'manual',rows:blankRows()};redrawReview();});
  assert.equal(await next.locator('.desk-row:visible').count(),1,'a new phone draft adapts the default after a desktop draft');
  await next.locator('#desk-one').uncheck();await next.evaluate(()=>{draft={id:'explicit-all',name:'Keep all rows',map:'Bermuda',entry:'manual',rows:blankRows()};redrawReview();});
  assert.equal(await next.locator('.desk-row:visible').count(),12,'an explicit review-mode preference survives a new draft');
  if(process.env.FFK_AUDIT_SCREENSHOTS){
   const shots=path.resolve(__dirname,'../audit-artifacts');await fs.mkdir(shots,{recursive:true});
   await context.unroute('https://fonts.googleapis.com/**');
   await page.addStyleTag({url:'https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;0,900;1,700;1,800;1,900&family=DM+Sans:wght@400;500;600;700&display=swap'}).catch(()=>{});await page.evaluate(()=>document.fonts.ready);
   await page.evaluate(()=>{closeModal();draft=null;selected='opening';tab='teams';go('results');document.querySelector('#toast').style.display='none';});await page.setViewportSize({width:1440,height:1000});
   await page.screenshot({path:path.join(shots,'verified-results-desktop.png'),fullPage:true});
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(shots,'verified-results-phone.png'),fullPage:true});
   await page.evaluate(()=>{draft={id:'screenshot-review',name:'Synthetic match',map:'Bermuda',entry:'manual',rows:blankRows()};draft.rows.forEach((r,i)=>{r.teamId=state.teams[i].id;r.players=state.teams[i].players.map((p,j)=>({playerId:p.id,name:p.name,kills:j===0?12-i:0}));});go('upload');});
   await page.screenshot({path:path.join(shots,'verified-review-phone.png'),fullPage:true});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: partial reader loads retry completely without duplicate execution; saved matches filter by name/map; fresh drafts reset review and Undo while same-draft navigation retains position.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
