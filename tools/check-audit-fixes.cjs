/* Regression checks for the October 2026 audit, against invented teams in a temporary in-memory server.
   No real database access. Each block names the audit finding it protects. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {dep,launchOptions}=require('./deps.cjs');
const {chromium}=dep('playwright');
const publicRoot=path.resolve(__dirname,'../public');
const teams=Array.from({length:24},(_,i)=>({id:'team-'+i,name:i===2?'FFK BRONZE LONGNAME':'FFK SQUAD '+(i+1),players:Array.from({length:4},(_,j)=>({id:`player-${i}-${j}`,name:`Player ${i+1}.${j+1}`}))}));
const A=teams.slice(0,12).map(t=>t.id),B=teams.slice(12).map(t=>t.id);
const match=(n,ids,stage)=>({id:'m'+n,name:`Set ${stage} · Match ${n}`,map:'Bermuda',stage,created:new Date(2026,9,20+n).toISOString(),rows:ids.map((id,i)=>({placement:i+1,teamId:id,teamName:teams.find(t=>t.id===id).name,players:teams.find(t=>t.id===id).players.map(p=>({playerId:p.id,name:p.name,kills:1})),warnings:[],confirmed:true,adjustments:[]}))});
const initial=()=>({teams:structuredClone(teams),matches:[match(1,A,'A'),match(2,[...A].reverse(),'A'),match(3,B,'B')],war:{groups:{A,B},targets:{A:6,B:6,C:6},qualified:{},decisions:{},cs:{},csFormat:'page-playoff-v1'}});
let fixture=initial(),saves=0,hostDelay=null,hostCalls=0;
const server=http.createServer(async(req,res)=>{
  const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/session')return reply(200,{authenticated:true});
  if(url.pathname==='/api/ocr/status')return reply(200,{available:false,scan:false});
  if(url.pathname==='/api/host/access')return reply(200,{key:'k'});
  if(url.pathname==='/api/host/state'){hostCalls++;const snapshot=structuredClone(fixture);if(hostDelay)await hostDelay;return reply(200,snapshot);}
  if(url.pathname==='/api/state'){
    if(req.method==='GET')return reply(200,fixture);
    let body='';for await(const chunk of req)body+=chunk;saves++;fixture=JSON.parse(body);if(process.env.DEBUG_SAVES)console.log('SAVE',body.length,JSON.stringify(fixture.matches.map(m=>m.id+':'+m.rows.map(r=>(r.adjustments||[]).length).join(''))));return reply(200,{ok:true});
  }
  const target=path.resolve(publicRoot,'.'+url.pathname.replace(/\/$/,'/index.html'));
  if(!target.startsWith(publicRoot+path.sep)){res.writeHead(403);return res.end();}
  try{const data=await fs.readFile(target),extension=path.extname(target);res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json'})[extension]||'text/html');res.end(data);}
  catch{res.writeHead(404);res.end();}
});
const PNG1=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2H0AAAAASUVORK5CYII=','base64');
async function run(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  let browser;
  try{
    browser=await chromium.launch(launchOptions());
    const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    await context.route('https://fonts.googleapis.com/**',route=>route.fulfill({status:200,contentType:'text/css',body:''}));
    const page=await context.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
    const open=async()=>{await page.goto(origin+'/');await page.waitForSelector('.shell');};

    // #28 One eye icon at a time on the password toggle; #26 the page loads without script errors.
    await page.route('**/api/session',route=>route.fulfill({json:{authenticated:false,setup:false}}));
    await page.goto(origin+'/');await page.waitForSelector('#login');
    const icons=()=>page.locator('.login-password-toggle .material-symbols-outlined').evaluateAll(list=>list.filter(el=>getComputedStyle(el).display!=='none').map(el=>el.dataset.icon||el.textContent.trim()));
    assert.deepEqual(await icons(),['visibility'],'#28 only the show icon is visible');
    await page.click('.login-password-toggle');assert.deepEqual(await icons(),['visibility_off'],'#28 only the hide icon is visible');
    await page.unroute('**/api/session');

    // #1 A failed re-read keeps the reviewed draft (on screen and in autosave).
    await open();
    await page.evaluate(()=>go('upload'));await page.waitForSelector('#dropzone');
    await page.evaluate(()=>{draft={id:'kept',name:'Kept',map:'Bermuda',rows:blankRows()};draft.rows[0].players[0].kills=17;redrawReview();});
    await page.locator('#screenshots').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
    await page.locator('.intake-panel').evaluate(el=>el.open=true);
    await page.click('#scan');await page.getByRole('button',{name:'Replace results'}).click();
    await page.waitForFunction(()=>!busy&&document.querySelector('#toast').textContent.includes('Unable to read'));
    assert.equal(await page.evaluate(()=>draft?.id),'kept','#1 the earlier draft is still the draft');
    assert.equal(await page.evaluate(()=>draft.rows[0].players[0].kills),17,'#1 reviewed kills survive');
    await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ffk-match-draft-v1')).draft.rows[0].players[0].kills),17,'#1 autosave keeps the reviewed draft');
    assert.equal(await page.locator('#toast').getAttribute('role'),'alert','#27 a failure is an alert');

    // #7 Typing kills never brings back teams from another set.
    await page.evaluate(()=>{draft={id:'set-a',name:'Set A',map:'Bermuda',stage:'A',rows:blankRows()};redrawReview();});
    await page.locator('[data-kills="0,0"]').fill('3');
    assert.equal(await page.locator('#review-team-0 [data-team] option[value="team-12"]').count(),0,'#7 Set B teams stay out of a Set A result');
    assert.equal(await page.locator('#review-team-0 [data-team] option[value="team-0"]').count(),1);

    // #3 The reader's doubts reach the results check; a 99-kill reading is never "Looks right".
    const flagged=await page.evaluate(()=>{
      const cells=[0,1,2,3].map(i=>({name:'Player 1.'+(i+1),playerName:'Player 1.'+(i+1),playerId:'player-0-'+i,kills:i?2:99,killsConf:.99,matchScore:1,rawName:'P',boxes:{name:[0,0,10,10],digits:[10,0,5,10]}}));
      const rows=WarOCR.fromServerScan({width:100,height:100,panels:[{placement:1,team:{id:'team-0',score:1},cells,flags:[{code:'placement_assumed',player:null,text:'Placement was assumed from panel order, not read'}],review:[]}]});
      draft={id:'flags',name:'Flags',map:'Bermuda',rows:blankRows()};WarOCR.merge(draft.rows[0],rows[0]);redrawReview();
      return {flags:draft.rows[0].flags.length,status:rowStatus(draft.rows[0]),why:document.querySelector('#review-team-0 .desk-why')?.textContent||''};
    });
    assert.equal(flagged.flags,1,'#3 flags are carried into the row');assert.equal(flagged.status,'look','#3 a flagged row needs a look');
    assert(flagged.why.includes('assumed')&&flagged.why.includes('99 kills'),'#3 the row says why: '+flagged.why);

    // #5 Screenshots stay visible with View and Adjust panels; #30 panels can be set without a pointer.
    await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1392;c.height=640;c.getContext('2d').fillRect(0,0,1392,640);images=[{url:c.toDataURL(),image:c,layout:{panels:[1,2,3]},fileKey:'x'}];draft.entry=undefined;redrawReview();});
    assert(await page.locator('#sources').isVisible(),'#5 the screenshot tray is visible');
    assert(await page.locator('#sources').getByRole('button',{name:'Adjust panels'}).isVisible(),'#5 Adjust panels is reachable');
    await page.locator('#sources').getByRole('button',{name:'View',exact:true}).click();
    assert(await page.locator('#source-canvas').isVisible(),'#5 the full screenshot opens');
    await page.click('#source-zoom');assert.equal(await page.getAttribute('#source-zoom','aria-pressed'),'true');
    await page.evaluate(()=>{closeModal();editPanels(0);});await page.waitForFunction(()=>document.querySelector('#bounds-canvas').width===1392);
    await page.click('#bounds-default');assert(await page.locator('#bounds-save').isEnabled(),'#30 two boxes without drawing');
    const before=await page.locator('[data-box="0"][data-key="x"]').inputValue();
    await page.locator('#bounds-canvas').press('ArrowRight');
    assert.notEqual(await page.locator('[data-box="0"][data-key="x"]').inputValue(),before,'#30 arrow keys move the box');
    await page.evaluate(()=>{closeModal();draft=null;images=[];localStorage.removeItem('ffk-match-draft-v1');});

    // #2 Two quick submissions record one adjustment and one save.
    await open();await page.evaluate(()=>{selected='m3';go('results');details('team-12');});
    await page.fill('#adjust [name="value"]','-5');await page.fill('#adjust [name="reason"]','Late to lobby');
    const savesBefore=saves;
    await page.evaluate(()=>{const f=document.querySelector('#adjust');f.requestSubmit();f.requestSubmit();});
    await page.waitForFunction(()=>!document.querySelector('#modal').open);
    assert.equal(saves-savesBefore,1,'#2 one save');
    assert.equal(fixture.matches[2].rows.find(r=>r.teamId==='team-12').adjustments.length,1,'#2 one adjustment');
    assert.ok(fixture.matches[2].rows.find(r=>r.teamId==='team-12').adjustments[0].id,'#2 adjustments carry an ID');

    // #35 A saved result can be corrected (kills and finish), with a reason, and standings follow.
    await page.evaluate(()=>details('team-13'));
    await page.fill('#correct-k0','9');await page.selectOption('#correct-place','1');
    await page.getByRole('button',{name:'Save correction'}).click();
    assert((await page.locator('#correct-error').textContent()).includes('reason'),'#35 a correction needs a reason');
    await page.fill('#correct [name="reason"]','Kill feed review');await page.getByRole('button',{name:'Save correction'}).click();
    await page.waitForFunction(()=>!document.querySelector('#modal').open);
    const corrected=fixture.matches[2];
    assert.equal(corrected.rows.find(r=>r.teamId==='team-13').players[0].kills,9);
    assert.equal(corrected.rows.find(r=>r.teamId==='team-13').placement,1);
    assert.equal(corrected.rows.find(r=>r.teamId==='team-12').placement,2,'#35 the other team swaps finish');
    assert.equal(corrected.corrections.length,1);

    // #6 Fixing a spelling keeps the player; "New person" is the explicit way to replace one.
    await page.evaluate(()=>{go('roster');teamForm('team-0');});
    await page.fill('[name="p0"]','PLAYER 1.1');
    await page.click('[data-replace="1"]');await page.fill('[name="p1"]','Brand New');
    await page.locator('#team-form').getByRole('button',{name:'Save roster'}).click();await page.waitForFunction(()=>!document.querySelector('#modal').open);
    const roster=fixture.teams[0].players;
    assert.equal(roster[0].id,'player-0-0','#6 a rename keeps the ID');assert.deepEqual(roster[0].ocrAliases,['Player 1.1'],'#6 the old spelling still matches screenshots');
    assert.notEqual(roster[1].id,'player-0-1','#6 New person gets a new ID');
    const overallPlayers=await page.evaluate(()=>WarOverall.aggregate(state).rows.find(r=>r.teamId==='team-0').players.map(p=>p.name+':'+p.kills));
    assert(overallPlayers.includes('PLAYER 1.1:2'),'#6 kills stay together under the new spelling: '+overallPlayers);

    // #8 / #9 Export means the view on screen; the full overall table has every team.
    await page.evaluate(()=>{tab='kills';selected='m1';go('results');});
    await page.click('#export-results');await page.waitForSelector('#modal[open]');
    assert.equal((await page.locator('#modal h2').first().textContent()).trim(),'Export kill graph','#8 the dialog names the view');
    const label=await page.locator('#modal').evaluate(el=>document.getElementById(el.getAttribute('aria-labelledby'))?.textContent);
    assert.equal(label,'Export kill graph','#29 dialogs are named by their heading');
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('[data-export="png"]').click()]);
    assert(download.suggestedFilename().endsWith('-kills.png'),'#8 the kill graph is what downloads: '+download.suggestedFilename());
    await page.evaluate(()=>closeModal());
    const tall=await page.evaluate(async()=>{tab='teams';selected='__overall__';render();const c=await viewCanvas();return {height:c.height,teams:WarOverall.aggregate(state).rows.length};});
    assert.equal(tall.teams,24);assert.equal(tall.height,2*(118+38*(24+1)+56),'#9 the full table export has all 24 teams');

    // #25 Tied leaders share the podium honestly.
    const ties=await page.evaluate(()=>{const saved=state;state={...saved,matches:saved.matches.slice(0,2)};selected='__overall__';tab='teams';render();const out=[...document.querySelectorAll('.podium-team')].map(b=>b.className.includes('podium-place-1')?b.querySelector('.podium-step').textContent:'');state=saved;render();return out;});
    assert(ties.filter(t=>t.includes('Shared #1')).length>=2,'#25 shared first place is shown as shared: '+ties);

    // #19 Podium names are never cut through.
    await page.evaluate(()=>{selected='m1';tab='teams';render();});
    const names=await page.locator('.podium-name').evaluateAll(list=>list.map(el=>el.getBoundingClientRect().height));
    assert(names.every(h=>h>=20),'#19 podium names keep their full line height: '+names);

    // #33 Artwork labels are remembered whichever download is used.
    await page.click('#export-results');await page.click('#choose-original');await page.waitForFunction(()=>!document.querySelector('#poster-pdf').disabled);
    await page.fill('#poster-form [name="week"]','09');
    await Promise.all([page.waitForEvent('download'),page.click('#poster-pdf')]);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ffk-export-labels-v1')).m1.week),'09','#33 PDF downloads remember labels');

    // #31 Templates can be deleted.
    await page.evaluate(()=>{localStorage.setItem('ffk-export-templates-v1',JSON.stringify([{id:'t1',name:'Old art',image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2H0AAAAASUVORK5CYII=',x:5,y:25,width:65,height:65}]));openExportChooser();});
    await page.click('[data-delete-template="t1"]');await page.getByRole('button',{name:'Delete template'}).click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ffk-export-templates-v1')).length===0);
    await page.evaluate(()=>closeModal());

    // #27 A successful refresh is a success; #18 an expired sign-in asks for the password in place.
    await page.evaluate(()=>refreshWorkspace(true));await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('refreshed'));
    assert.equal(await page.locator('#toast').getAttribute('class'),'toast-success','#27 success is not an error');
    await page.route('**/api/state',route=>route.request().method()==='GET'?route.fulfill({status:401,json:{error:'Please sign in.'}}):route.continue());
    await page.evaluate(()=>refreshWorkspace(true));await page.waitForSelector('#session-dialog[open]');
    assert.equal(await page.locator('#sync-status').textContent(),'Signed out','#18 not shown as offline');
    await page.unroute('**/api/state');await page.evaluate(()=>document.querySelector('#session-dialog').close());

    // #20 / #21 Phone: points are visible, and the results check is compact with a pinned jump list.
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{selected='m1';tab='teams';go('results');});
    const pointsRight=await page.locator('.standings-table th',{hasText:'Points'}).evaluate(el=>el.getBoundingClientRect().right);
    assert(pointsRight<=390,'#20 Points is on screen: '+pointsRight);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390,'no sideways page scroll');
    await page.evaluate(()=>{draft={id:'phone',name:'Phone',map:'Bermuda',entry:'manual',rows:blankRows()};go('upload');});await page.waitForSelector('#desk-review');
    const phone=await page.evaluate(()=>({height:document.documentElement.scrollHeight,visibleRows:[...document.querySelectorAll('.desk-row')].filter(r=>!r.hidden).length,jump:document.querySelectorAll('.desk-jump button').length,sticky:getComputedStyle(document.querySelector('.desk-bar')).position}));
    assert.equal(phone.visibleRows,1,'#21 one team at a time on a phone');assert.equal(phone.jump,12);assert.equal(phone.sticky,'sticky','#21 progress stays pinned');
    assert(phone.height<3000,'#21 the check is no longer a 10,000px page: '+phone.height);
    await page.click('[data-jump="5"]');assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.desk-row')].filter(r=>!r.hidden)[0].id),'review-team-5','#21 the jump list moves between placements');
    assert.equal(await page.locator('.desk-crop').count(),0,'#22 manual entry has no repeated screenshot placeholders');
    await page.evaluate(()=>{draft=null;localStorage.removeItem('ffk-match-draft-v1');});
    await page.setViewportSize({width:1440,height:1000});

    // #11 Hold means hold, even for a refresh already in flight; #36 the broadcast follows the stage.
    const host=await context.newPage();host.on('pageerror',e=>pageErrors.push('host: '+e.message));
    await host.goto(origin+'/host.html#key=k');await host.waitForFunction(()=>document.querySelector('#match-context').textContent.includes('saved'));
    assert.equal((await host.locator('h1').textContent()).trim(),'Set A · Qualifier standings','#36 follows the current unqualified stage');
    const context0=await host.locator('#match-context').textContent();
    let release;hostDelay=new Promise(r=>release=r);
    fixture.matches.push(match(4,A,'A'));
    await host.click('#refresh');await host.waitForTimeout(200);await host.click('#freeze');release();hostDelay=null;await host.waitForTimeout(400);
    assert.equal(await host.locator('#match-context').textContent(),context0,'#11 a held screen does not change');
    await host.click('#freeze');await host.waitForFunction(c=>document.querySelector('#match-context').textContent!==c,context0);
    await host.selectOption('#stage-select','all');
    assert((await host.locator('#match-context').textContent()).includes('every set'),'#36 all-matches mode says what it includes');
    fixture.war.qualified={A:A.slice(0,6),B:B.slice(0,6),C:[A[0],A[1],B[0],B[1]]};
    await host.goto(origin+'/host.html#key=k&screen=1');await host.waitForFunction(()=>!document.querySelector('#finals').hidden);
    assert((await host.locator('#finals').textContent()).includes('Qualifier 1'),'#36 the broadcast shows the CS bracket during the finals');
    fixture=initial();

    assert.deepEqual(pageErrors,[],'no browser errors');
    console.log('PASS: failed re-read keeps the draft; one adjustment per submit; renames keep identity; reader flags reach the check; set restrictions hold; screenshots and panel adjustment are reachable (keyboard too); exports match the view and include every team; corrections recalculate; ties shared; podium names whole; labels remembered; templates deletable; success/expired sign-in handled; phone layout compact; host hold and stage-aware broadcast.');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
