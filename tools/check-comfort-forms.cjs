/* UI checks against invented teams in a temporary in-memory server. No real database access. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {dep,launchOptions}=require('./deps.cjs');
const {chromium}=dep('playwright');
const publicRoot=path.resolve(__dirname,'../public');
let fixture={teams:Array.from({length:24},(_,i)=>({id:'team-'+i,name:'FFK '+(i===0?'DEEPAK':i===1?'PRAGA':'SQUAD '+(i+1)),players:Array.from({length:4},(_,j)=>({id:`player-${i}-${j}`,name:`Player ${i+1}.${j+1}`}))})),matches:[]};
const server=http.createServer(async(req,res)=>{
  const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(req.url==='/api/session')return reply(200,{authenticated:true});
  if(req.url==='/api/ocr/status')return reply(200,{available:false});
  if(req.url==='/api/state'){
    if(req.method==='GET')return reply(200,fixture);
    let body='';for await(const chunk of req)body+=chunk;fixture=JSON.parse(body);return reply(200,{ok:true});
  }
  const target=path.resolve(publicRoot,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
  if(!target.startsWith(publicRoot+path.sep)){res.writeHead(403);return res.end();}
  try{
    const data=await fs.readFile(target),extension=path.extname(target);
    res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml'})[extension]||'text/html');res.end(data);
  }catch{res.writeHead(404);res.end();}
});
async function run(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  let browser;
  try{
    browser=await chromium.launch(launchOptions());
    const page=await browser.newPage({viewport:{width:1366,height:1000}}),pageErrors=[];
    page.on('pageerror',error=>pageErrors.push(error.message));
    await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:''}));
    let failNextSave=false;
    await page.route('**/api/state',route=>{
      if(failNextSave&&route.request().method()==='POST'){
        failNextSave=false;return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Simulated save failure'})});
      }
      return route.continue();
    });
    await page.goto(origin,{waitUntil:'domcontentloaded'});await page.waitForSelector('.comfort-shell');
    await page.locator('.nav').getByRole('button',{name:'Teams',exact:true}).click();
    await page.locator('.heading .primary').click();
    await page.locator('[name="team"]').fill('FFK DEEPAK');await page.getByRole('button',{name:'Continue to players'}).click();
    assert(await page.locator('[name="team"]').evaluate(el=>el.validationMessage.includes('already registered')),'Duplicate team should be blocked');
    await page.locator('[name="team"]').fill('FFK Test Squad');await page.getByRole('button',{name:'Continue to players'}).click();
    for(let j=0;j<4;j++)await page.locator('[name="p'+j+'"]').fill('Test Starter '+j);
    await page.locator('[name="p0"]').fill('Test Starter 1');
    assert(await page.locator('[name="p0"]').evaluate(el=>!!el.validationMessage),'Duplicate player should be blocked');
    await page.locator('[name="p0"]').fill('Test Starter 0');await page.getByRole('button',{name:'Register team',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('#modal').open);
    assert.equal(await page.evaluate(()=>state.teams.length),25,'Existing team save handler should run');
    assert.equal(await page.locator('#modal').evaluate(el=>el.classList.contains('comfort-team-dialog')),false,'Team presentation should not leak to other dialogs');
    // Failed saves must leave the form usable and retries must save the actual edit.
    await page.locator('.team-card').first().locator('.team-menu summary').click();
    await page.locator('.team-card').first().getByRole('button',{name:'Edit roster'}).click();
    await page.locator('[name="team"]').fill('FFK Retry Team');await page.getByRole('button',{name:'Continue to players'}).click();
    failNextSave=true;await page.getByRole('button',{name:'Save roster',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#form-error')?.textContent.includes('Simulated save failure'));
    assert(await page.getByRole('button',{name:'Save roster',exact:true}).isEnabled(),'Save should re-enable after failure');
    assert.equal(await page.locator('[name="team"]').inputValue(),'FFK Retry Team','Failed save should retain entered data');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'form-error','Failed save should focus the inline error');
    await page.getByRole('button',{name:'Save roster',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#modal').open);
    assert.equal(await page.evaluate(()=>state.teams[0].name),'FFK Retry Team','Retry should save the edited team');
    await page.locator('.nav').getByRole('button',{name:'War manager'}).click();
    await page.getByRole('button',{name:'Add Set A screenshots'}).click();
    assert.equal(await page.locator('#war-stage').inputValue(),'A');
    assert.equal(await page.locator('#match-map').inputValue(),'Bermuda');
    for(const [number,map] of [[2,'NexTerra'],[3,'Purgatory'],[4,'Kalahari'],[5,'Solara'],[6,'Bermuda']]){
      await page.locator('#match-name').fill('Set A · Match '+number);assert.equal(await page.locator('#match-map').inputValue(),map);
    }
    await page.locator('#match-map').selectOption('Alpine');await page.evaluate(()=>ComfortForms.mount());assert.equal(await page.locator('#match-map').inputValue(),'Alpine','Remount must preserve manual map override');
    await page.locator('#war-stage').selectOption('B');assert.equal(await page.locator('#match-name').inputValue(),'Set B · Match 1');
    await page.locator('#war-stage').selectOption('A');
    assert((await page.locator('#comfort-set-context').innerText()).includes('Set A'),'Tournament helper should follow the selected set');
    assert(await page.locator('#scan').isDisabled(),'Reading needs at least one screenshot');
    await page.getByRole('button',{name:'Enter results by hand'}).click();
    await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=600;canvas.height=80;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#10151c';ctx.fillRect(0,0,600,80);ctx.font='22px sans-serif';ctx.fillStyle='white';ctx.fillText('Player OCR',12,35);ctx.fillStyle='#ffdd22';ctx.fillText('9',182,35);
      draft.rows[0].players[0].rawName='Player OCR';draft.rows[0].players[0].kills=null;
      images=[{url:canvas.toDataURL(),image:canvas,rows:[{placement:1,players:[{ocrRegion:{name:[10,10,140,35],digits:[180,10,30,35],width:600,height:80}}]}]}];redrawReview();
    });
    const evidence=page.locator('#review-team-0 .review-player').first();
    assert(await evidence.locator('.review-evidence').evaluate(el=>el.open),'Uncertain player must show evidence immediately');
    assert(await evidence.locator('.evidence-crop').isVisible(),'Name and kill screenshot crop should be visible');
    assert.equal(await evidence.locator('[data-kills]').getAttribute('placeholder'),'?','Unknown kills must not look like zero');
    assert(await evidence.getByText('Not read',{exact:true}).isVisible());
    await page.waitForFunction(()=>document.querySelector('#review-team-0 .evidence-crop')?.naturalWidth===200);
    await page.screenshot({path:path.join(publicRoot,'../.ocr-cache/evidence-review-preview.png')});
    await page.evaluate(()=>{window.dispatchEvent(new Event('pagehide'));images=[];redrawReview();});
    assert(await evidence.locator('.evidence-crop').isVisible(),'Saved draft crop should work after sources are gone');
    assert(await page.evaluate(()=>!!JSON.parse(localStorage.getItem('ffk-match-draft-v1')).draft.rows[0].players[0].evidenceCrop),'Evidence must be persisted with the draft');
    await page.evaluate(()=>{ComfortForms.mount();ComfortForms.mount();});
    assert.equal(await page.locator('.comfort-review-nav').count(),1,'Mount should be idempotent');
    for(let i=0;i<12;i++){
      assert.equal(await page.locator('.review-card:visible').count(),1,'Only one team should be shown');
      if(i>0)assert.equal(await page.locator('.review-card:visible [data-team] option[value="team-0"]').count(),0,'Confirmed teams must be removed from the next team dropdown');
      if(i===1){
        await page.locator('.review-card:visible .comfort-team-finder summary').click();
        await page.locator('.review-card:visible [data-team-search]').fill('Retry');
        assert.equal(await page.locator('.review-card:visible [data-team] option[value="team-0"]').count(),0,'Searching must not bring back a confirmed team');
        await page.locator('.review-card:visible [data-team-search]').fill('');
        await page.evaluate(()=>setReviewMode('all'));
        assert.equal(await page.locator('#review-team-0 [data-team] option[value="team-0"]').count(),1,'A confirmed row must retain its own team for correction');
        await page.evaluate(()=>{draft.rows[0].confirmed=false;redrawReview();});
        assert.equal(await page.locator('#review-team-1 [data-team] option[value="team-0"]').count(),1,'Unconfirming must return the team to other dropdowns');
        await page.evaluate(()=>{draft.rows[0].confirmed=true;setReviewMode('pending');});
      }
      await page.locator('.review-card:visible [data-team]').selectOption('team-'+i);
      if(i===0)assert(await page.locator('.review-card:visible [data-team] option[value="team-20"]').evaluate(el=>!el.disabled&&!el.hidden),'First result should allow any registered team');
      for(let j=0;j<4;j++){
        await page.locator('.review-card:visible [data-player="'+i+','+j+'"]').selectOption('player-'+i+'-'+j);
        await page.locator('.review-card:visible [data-kills="'+i+','+j+'"]').fill(String(i===0?1:0));
        if(i===0&&j===0)assert(await evidence.getByText('Not read',{exact:true}).isHidden(),'Entering a kill count clears the missing indicator');
      }
      await page.locator('.review-card:visible .comfort-confirm-team').click();
      assert(await page.evaluate(index=>draft.rows[index].confirmed,i),'Team '+i+' should confirm');
    }
    assert.equal(await page.locator('.review-card:visible').count(),0,'Confirmed teams should leave the pending queue');
    const save=page.locator('.save-bar button[onclick="finalize()"]');assert(await save.isEnabled(),'All twelve confirmations should unlock save');
    await save.click();await page.waitForFunction(()=>state.matches.length===1&&!draft);
    assert.deepEqual(await page.evaluate(()=>({stage:state.matches[0].stage,rows:state.matches[0].rows.length})),{stage:'A',rows:12});
    assert.deepEqual(await page.evaluate(()=>state.war.groups.A),Array.from({length:12},(_,i)=>'team-'+i),'First saved PT must define Set A');
    assert.equal(await page.evaluate(()=>WarTournament.availableTeams(state,'B').some(t=>t.id==='team-0')),false,'Set B must exclude established Set A teams');
    await page.evaluate(()=>go('upload'));
    await page.locator('#screenshots').setInputFiles({name:'sample.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2H0AAAAASUVORK5CYII=','base64')});
    await page.waitForFunction(()=>document.querySelector('#scan').textContent.includes('1 screenshot'));
    assert(await page.locator('#scan').isEnabled(),'Adding an image should enable reading');
    await page.locator('.remove-upload').click();assert(await page.locator('#scan').isDisabled(),'Removing all images should disable reading');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Mobile view should fit the screen');
    assert.deepEqual(pageErrors,[],'Integrated forms should have no browser errors');
    console.log('PASS: guided registration, duplicate validation, save failure/retry, stage context/restrictions, focused 12-team review/save, screenshot add/remove, idempotence, 390px layout.');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
