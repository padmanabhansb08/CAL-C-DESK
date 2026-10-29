/* Host-stage and readability regressions. Synthetic teams/results only; no organizer database. */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {dep,launchOptions}=require('./deps.cjs');
const {chromium}=dep('playwright');
const publicRoot=path.resolve(__dirname,'../public');
const teams=Array.from({length:24},(_,i)=>({id:'team-'+i,name:'FFK Squad '+String(i+1).padStart(2,'0'),players:Array.from({length:4},(_,j)=>({id:`p-${i}-${j}`,name:`Player ${i+1}.${j+1}`}))}));
const A=teams.slice(0,12).map(t=>t.id),B=teams.slice(12).map(t=>t.id);
const match=(id,stage,ids)=>({id,name:'Set '+stage+' · '+id,stage,map:'Bermuda',created:'2026-10-29T10:00:00Z',rows:ids.map((teamId,i)=>({teamId,teamName:teams.find(t=>t.id===teamId).name,placement:i+1,confirmed:true,adjustments:[],players:teams.find(t=>t.id===teamId).players.map((p,j)=>({playerId:p.id,name:p.name,kills:j===0?12-i:0}))}))});
let fixture={teams,matches:[match('a1','A',A),match('b1','B',B)],war:{groups:{A,B},targets:{A:1,B:1,C:1},qualified:{},decisions:{},cs:{},csFormat:'page-playoff-v1'}};
const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/api/host/state'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify(fixture));}
  const file=path.resolve(publicRoot,'.'+pathname);
  if(!file.startsWith(publicRoot+path.sep)){res.writeHead(403);return res.end();}
  try{const data=await fs.readFile(file);res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html'})[path.extname(file)]||'application/octet-stream');res.end(data);}
  catch{res.writeHead(404);res.end();}
});
async function visibleTextBelowFloor(page){
  return page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>{
    if(![...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()))return false;
    const style=getComputedStyle(el),box=el.getBoundingClientRect();
    return style.visibility!=='hidden'&&style.display!=='none'&&box.width>0&&box.height>0&&parseFloat(style.fontSize)<12;
  }).map(el=>({tag:el.tagName,text:el.textContent.trim().slice(0,60),font:getComputedStyle(el).fontSize})));
}
async function run(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  let browser;
  try{
    browser=await chromium.launch(launchOptions());
    const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];
    const capture=async name=>{if(process.env.CHECK_HOST_PREVIEW_DIR)await page.screenshot({path:path.join(process.env.CHECK_HOST_PREVIEW_DIR,name),fullPage:true});};
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
    await page.goto(origin+'/host.html#key=fixture');
    await page.waitForFunction(()=>document.body.dataset.stage==='A');
    assert.equal(await page.locator('h1').textContent(),'Set A · Qualifier standings','Follow uses the same first-unqualified stage as War manager, even if B was saved most recently.');
    assert.deepEqual(await visibleTextBelowFloor(page),[],'Host desktop text is at least 12px.');
    await page.setViewportSize({width:390,height:844});
    assert.deepEqual(await visibleTextBelowFloor(page),[],'Host phone text is at least 12px.');
    await capture('verified-host-phone.png');

    fixture.war.qualified.A=A.slice(0,6);
    await page.click('#refresh');
    await page.waitForFunction(()=>document.body.dataset.stage==='B');
    assert.equal(await page.locator('h1').textContent(),'Set B · Qualifier standings','Qualifying A advances Follow immediately.');
    fixture.war.qualified.B=B.slice(0,6);
    await page.click('#refresh');
    await page.waitForFunction(()=>document.body.dataset.stage==='C');
    assert.equal(await page.locator('#match-context').textContent(),'No saved matches in this stage yet','Follow advances to C before the first semi-final result exists.');
    assert.equal(await page.locator('#standings-body tr').count(),1);

    // A pinned stage and the historical aggregate remain explicit choices after progression.
    await page.selectOption('#stage-select','A');
    assert.equal(await page.locator('h1').textContent(),'Set A · Qualifier standings');
    await page.reload();
    await page.waitForFunction(()=>document.body.dataset.stage==='A');
    assert.equal(await page.locator('#stage-select').inputValue(),'A','A pinned stage survives reload.');
    await page.selectOption('#stage-select','all');
    assert.match(await page.locator('#match-context').textContent(),/2 saved matches.*includes practice and every set/);
    await page.selectOption('#stage-select','auto');
    assert.equal(await page.locator('h1').textContent(),'Set C · Semi-final standings');

    // Twelve teams still fit the standard 1080p OBS frame after raising the type floor.
    const C=[...fixture.war.qualified.A,...fixture.war.qualified.B];
    fixture.matches.push(match('c1','C',C));
    await page.setViewportSize({width:1920,height:1080});
    await page.goto(origin+'/host.html#key=fixture&screen=1');
    await page.waitForFunction(()=>document.body.dataset.stage==='C'&&document.querySelectorAll('#standings-body tr').length===12);
    assert.deepEqual(await visibleTextBelowFloor(page),[],'Broadcast text is at least 12px.');
    assert(await page.evaluate(()=>document.documentElement.scrollHeight<=1080),'The full twelve-team broadcast fits 1920×1080.');
    await capture('verified-host-broadcast.png');

    // Switch from a populated BR table to finals: hidden author-level grids must truly disappear.
    fixture.war.qualified.C=C.slice(0,4);
    await page.goto(origin+'/host.html#key=fixture&screen=1');
    await page.waitForFunction(()=>document.body.dataset.stage==='finals');
    assert(await page.locator('#finals').isVisible(),'The final bracket is visible.');
    for(const el of await page.locator('.stage-standings').all()){
      assert.equal(await el.evaluate(node=>getComputedStyle(node).display),'none','Hidden BR sections must not survive their grid/block layout rules.');
      assert.equal(await el.isVisible(),false);
    }
    assert.deepEqual(await visibleTextBelowFloor(page),[],'Finals broadcast type keeps the same floor.');
    await capture('verified-finals-broadcast.png');
    await page.goto(origin+'/host.html#key=fixture');
    await page.waitForFunction(()=>document.body.dataset.stage==='finals');
    for(const el of await page.locator('.stage-standings').all())assert.equal(await el.isVisible(),false,'Host finals also hide stale BR sections.');
    await page.selectOption('#stage-select','B');
    assert(await page.locator('.host-grid').isVisible(),'Pinning a BR stage after finals restores its standings.');
    assert.equal(await page.locator('#finals').isVisible(),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: Follow advances A → B → C → finals before next-stage results; explicit pins persist; finals hide BR grids; host type is at least 12px on phone/desktop; twelve-team broadcast fits 1080p.');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
