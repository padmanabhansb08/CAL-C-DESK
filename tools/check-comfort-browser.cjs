// Real-browser journey using an isolated in-memory workspace. No real database is opened.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
let chromium;try{({chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'playwright'));}catch{({chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')));}
const root=path.resolve(__dirname,'../public');
let authenticated=true;
let failReset=false;
let remote={teams:Array.from({length:24},(_,i)=>({id:'t'+i,name:'FFK Team '+String(i+1).padStart(2,'0'),players:Array.from({length:4},(_,j)=>({id:'p'+i+'-'+j,name:'Player '+i+'.'+j}))})),matches:[]};
function match(set,id){const ids=set==='C'?[...remote.war.qualified.A,...remote.war.qualified.B]:remote.war.groups[set];return {id,name:'Set '+set+' · '+id,stage:set,map:'Bermuda',created:new Date().toISOString(),rows:ids.map((teamId,i)=>({teamId,teamName:remote.teams.find(t=>t.id===teamId).name,placement:i+1,confirmed:true,adjustments:[],players:remote.teams.find(t=>t.id===teamId).players.map((p,j)=>({playerId:p.id,name:p.name,kills:j===0?12-i:0}))}))};}
const server=http.createServer((req,res)=>{
  const target=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
  if(!target.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(target,(e,data)=>{if(e){res.writeHead(404);return res.end();}res.setHeader('Content-Type',target.endsWith('.js')?'application/javascript':target.endsWith('.css')?'text/css':target.endsWith('.png')?'image/png':'text/html');res.end(data);});
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'application/javascript',body:''}));
    await page.route('**/api/**',async route=>{
      const url=new URL(route.request().url()),p=url.pathname,method=route.request().method();
      if(p==='/api/session')return route.fulfill({json:{authenticated}});
      if(p==='/api/login'){authenticated=true;return route.fulfill({json:{ok:true}});}
      if(p==='/api/ocr/status')return route.fulfill({json:{available:false}});
      if(p==='/api/state'){if(method==='POST'){const incoming=route.request().postDataJSON();if(failReset&&!incoming.matches.length)return route.fulfill({status:503,json:{error:'Reset failed for test'}});remote=incoming;}return route.fulfill({json:method==='POST'?{ok:true}:remote});}
      return route.fulfill({status:404,json:{error:'Unsupported test route'}});
    });
    await page.goto(base);await page.getByRole('button',{name:'Continue Set A',exact:true}).click();
    assert.equal(await page.locator('.guide-group').count(),0,'No team allocation screen');
    await page.getByRole('button',{name:'Add Set A screenshots',exact:true}).click();
    assert.equal(remote.war,undefined,'Opening intake must not assign teams');
    assert.equal(await page.locator('#war-stage').inputValue(),'A');assert.equal(await page.locator('#match-name').inputValue(),'Set A · Match 1');
    await page.getByRole('button',{name:'War manager',exact:true}).click();
    await page.getByText('Scoring rules & match settings',{exact:true}).click();
    assert.equal(await page.locator('#war-target').inputValue(),'6','New sets default to six matches');
    await page.locator('#war-target').fill('2');await page.getByRole('button',{name:'Save match count',exact:true}).click();
    await page.getByText('Set A match count updated',{exact:true}).waitFor();
    assert.equal(remote.war.targets.A,2);
    remote.war.groups={A:remote.teams.slice(0,12).map(t=>t.id),B:remote.teams.slice(12,24).map(t=>t.id)};
    remote.war.targets.B=1;remote.war.targets.C=1; // Short fixtures keep the playoff smoke test focused.
    remote.matches=[match('A','a1'),match('A','a2'),match('B','b1')];
    await page.getByRole('button',{name:'Refresh saved data',exact:true}).click();
    await page.getByRole('button',{name:'Review top 6 → semi-final',exact:true}).click();
    assert.equal(await page.locator('.guide-qualifier-list li').count(),6);
    await page.getByRole('button',{name:'Confirm & advance',exact:true}).click();
    await page.getByRole('heading',{name:'Set B standings',exact:true}).waitFor();
    assert.equal(remote.war.qualified.A.length,6);
    await page.getByRole('button',{name:'Review top 6 → semi-final',exact:true}).click();
    await page.getByRole('button',{name:'Confirm & advance',exact:true}).click();
    await page.getByRole('heading',{name:'Set C standings',exact:true}).waitFor();
    assert.equal(remote.war.qualified.B.length,6);
    assert.equal(await page.locator('.guide-table-points').first().textContent(),'0','Semi-final must start from zero');
    remote.matches.push(match('C','c1'));
    await page.getByRole('button',{name:'Refresh saved data',exact:true}).click();
    await page.getByRole('button',{name:'Review top 4 → finals',exact:true}).click();
    await page.getByRole('button',{name:'Confirm & advance',exact:true}).click();
    await page.getByRole('heading',{name:'Your final four are ready.',exact:true}).waitFor();
    assert.equal(await page.locator('.war-workspace input:visible').count(),0,'Finals display should not expose score inputs');
    await page.getByRole('button',{name:'Enter Qualifier 1 score',exact:true}).click();
    await page.locator('#q1-a').fill('4');await page.locator('#q1-b').fill('4');
    await page.getByRole('button',{name:'Save score',exact:true}).click();assert.equal(await page.locator('#modal').getAttribute('open'),'');
    assert.match(await page.locator('#guide-score-error').textContent(),/higher/);
    await page.locator('#q1-b').fill('1');await page.getByRole('button',{name:'Save score',exact:true}).click();
    await page.getByRole('button',{name:'Enter Eliminator score',exact:true}).click();
    await page.locator('#eliminator-a').fill('4');await page.locator('#eliminator-b').fill('2');await page.getByRole('button',{name:'Save score',exact:true}).click();
    await page.getByRole('button',{name:'Enter Qualifier 2 score',exact:true}).click();
    await page.locator('#q2-a').fill('4');await page.locator('#q2-b').fill('2');await page.getByRole('button',{name:'Save score',exact:true}).click();
    await page.getByRole('button',{name:'Enter Grand Final score',exact:true}).waitFor();
    assert.equal(remote.war.cs.q2.teams[0],remote.war.cs.q1.loser);assert.equal(remote.war.cs.q2.teams[1],remote.war.cs.eliminator.winner);
    await page.getByRole('button',{name:'Enter Grand Final score',exact:true}).click();
    await page.locator('#final-a').fill('4');await page.locator('#final-b').fill('3');await page.getByRole('button',{name:'Save score',exact:true}).click();
    await page.locator('.guide-champion').waitFor();assert.equal(remote.war.cs.final.winner,remote.war.qualified.C[0]);
    for(const width of [390,760,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No page overflow at '+width);}
    await page.reload();await page.getByRole('button',{name:'View the champion',exact:true}).click();await page.locator('.guide-champion').waitFor();
    authenticated=false;await page.reload();await page.getByRole('heading',{name:'Welcome back.',exact:true}).waitFor();
    await page.getByRole('button',{name:'Show organizer password',exact:true}).click();assert.equal(await page.locator('#login input').getAttribute('type'),'text');
    await page.locator('#login input').fill('synthetic-test-password');await page.getByRole('button',{name:'Open my war desk',exact:false}).click();
    await page.getByRole('heading',{name:'Welcome to your war desk.',exact:true}).waitFor();
    await page.getByRole('button',{name:'View the champion',exact:true}).click();
    const beforeReset=structuredClone(remote);
    await page.evaluate(()=>{draft={id:'reset-draft',name:'Unfinished',map:'Bermuda',rows:[]};window.dispatchEvent(new Event('pagehide'));});
    await page.locator('.guide-reset').click();await page.locator('.action-confirmation').getByRole('button',{name:'Keep current war',exact:true}).click();assert.deepEqual(remote,beforeReset);
    assert.equal(await page.evaluate(()=>draft.id),'reset-draft','Cancel preserves draft');
    failReset=true;await page.locator('.guide-reset').click();await page.locator('.action-confirmation').getByRole('button',{name:'Reset the war',exact:true}).click();
    await page.getByText('Reset failed for test',{exact:true}).waitFor();assert.deepEqual(remote,beforeReset);assert.equal(await page.evaluate(()=>draft.id),'reset-draft','Failed reset preserves draft');
    failReset=false;await page.locator('.guide-reset').click();await page.locator('.action-confirmation').getByRole('button',{name:'Reset the war',exact:true}).click();
    await page.getByRole('heading',{name:'Start Set A with its screenshots.',exact:true}).waitFor();
    assert.equal(remote.matches.length,0);assert.deepEqual(remote.teams,beforeReset.teams);assert.deepEqual(remote.war.qualified,{});assert.deepEqual(remote.war.groups,{A:[],B:[]});assert.deepEqual(remote.war.cs,{});
    assert.deepEqual(remote.war.targets,{A:6,B:6,C:6},'Reset must restore six matches in every BR set');
    assert.equal(await page.evaluate(()=>draft),null);assert.equal(await page.evaluate(()=>localStorage.getItem('ffk-match-draft-v1')),null);
    assert.deepEqual(errors,[]);
    console.log('PASS: result-first entry without allocation, match context, match-count save, qualifiers preview, fresh Set C, focused CS entry, validation, champion persistence and responsive layouts.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
