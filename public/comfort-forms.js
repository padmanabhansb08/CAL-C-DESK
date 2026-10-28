/* Guided form presentation. Existing inputs, scoring and persistence stay in control. */
(function(root){
  'use strict';
  let focusedTeam=null, reviewDraft=null;
  const query=(selector,within=document)=>within.querySelector(selector);
  const all=(selector,within=document)=>Array.from(within.querySelectorAll(selector));
  const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
  const button=(text,fn,className)=>{const el=node('button',className,text);el.type='button';el.onclick=fn;return el;};
  function mountTeamForm(id){
    const form=query('#team-form'),dialog=query('#modal');
    if(!form||form.dataset.comfort)return;
    form.dataset.comfort='true';dialog.classList.add('comfort-team-dialog');
    dialog.addEventListener('close',()=>{dialog.classList.remove('comfort-team-dialog');if(dialog.getAttribute('aria-labelledby')==='comfort-team-title')dialog.removeAttribute('aria-labelledby');},{once:true});
    const title=query('h2',dialog);if(title){title.id='comfort-team-title';dialog.setAttribute('aria-labelledby',title.id);}
    const team=form.elements.namedItem('team'),players=Array.from({length:5},(_,i)=>form.elements.namedItem('p'+i));
    if(!team||players.some(p=>!p))return;
    const editing=!!id,header=node('div','comfort-form-intro');
    header.append(node('p','',editing?'Update the team name or any player.':'A team name and its four players. A substitute is optional.'));
    if(title)title.after(header);
    const steps=node('div','comfort-form-steps');steps.setAttribute('aria-label','Team registration steps');
    const stepButtons=[button('1  Team name',()=>setStep(0)),button('2  Players',()=>next())];steps.append(...stepButtons);form.prepend(steps);
    const identity=node('section','comfort-team-identity'),roster=node('section','comfort-team-players');
    const teamLabel=team.closest('label');identity.append(teamLabel);
    team.placeholder='For example, FFK Phoenix';team.autocomplete='off';team.spellcheck=false;
    const summary=node('div','comfort-roster-summary');summary.append(node('strong','','Your team'),node('span','','0 of 4 players added'));summary.setAttribute('aria-live','polite');
    roster.append(node('h3','','Starting four'),node('p','comfort-help','Use each player’s exact in-game name, symbols included, so screenshots match.'));
    const grid=node('div','comfort-player-fields');
    players.slice(0,4).forEach((input,index)=>{
      const label=input.closest('label');label.style.marginTop='';label.classList.add('comfort-player-field');
      const text=Array.from(label.childNodes).find(n=>n.nodeType===3);if(text)text.textContent='Player '+(index+1);
      input.placeholder=index===0?'For example, FFK Prasanth':'Exact in-game name';input.autocomplete='off';input.spellcheck=false;grid.append(label);
    });
    roster.append(grid);
    const substitute=node('details','comfort-substitute'),subSummary=node('summary','','Add a substitute');
    const subLabel=players[4].closest('label');subLabel.style.marginTop='';players[4].placeholder='Substitute’s in-game name';players[4].autocomplete='off';players[4].spellcheck=false;
    substitute.open=!!players[4].value;substitute.append(subSummary,node('p','','Optional. Four active players are still required for each match.'),subLabel);roster.append(substitute);
    const oldHelp=query('p.caption',form);oldHelp?.remove();
    const actions=query('.actions',form),save=query('.primary',actions),cancel=query('button[type="button"]',actions),error=query('#form-error',form);
    if(error){error.setAttribute('role','alert');error.setAttribute('tabindex','-1');}
    const back=button('← Team name',()=>setStep(0),'comfort-back'),continueButton=button('Continue to players →',next,'primary comfort-form-next');
    actions.prepend(back);actions.append(continueButton);form.insertBefore(identity,actions);form.insertBefore(roster,actions);
    save.textContent=editing?'Save roster':'Register team';save.type='submit';cancel?.classList.add('comfort-cancel');
    let current=0;
    function validateNames(){
      const values=players.map(p=>p.value.trim());
      players.forEach((input,index)=>{const duplicate=!!values[index]&&values.some((value,j)=>j!==index&&value===values[index]);input.setCustomValidity(duplicate?'Each player needs a different in-game name.':'');});
      const count=values.slice(0,4).filter(Boolean).length;
      query('strong',summary).textContent=team.value.trim()||'Your team';query('span',summary).textContent=count+' of 4 players added';
      summary.classList.toggle('is-complete',count===4&&players.every(p=>!p.validationMessage));
      subSummary.textContent=values[4]?'Substitute added · '+values[4]:'Add a substitute';
    }
    function setStep(step){
      // A single screen: team name and players together. Validation runs on submit.
      current=1;identity.hidden=false;roster.hidden=false;back.hidden=true;save.hidden=false;continueButton.hidden=true;steps.hidden=true;
      if(title)title.textContent=editing?'Edit team':'Register a team';
      validateNames();team.focus({preventScroll:true});
    }
    function next(){
      team.setCustomValidity(!team.value.trim()?'Enter a team name.':'');
      if(!team.reportValidity())return;
      if(typeof state!=='undefined'&&state.teams.some(t=>t.id!==id&&t.name.toLowerCase()===team.value.trim().toLowerCase())){
        team.setCustomValidity('This team name is already registered.');team.reportValidity();return;
      }
      setStep(1);
    }
    team.addEventListener('input',()=>{team.setCustomValidity('');validateNames();});players.forEach(input=>input.addEventListener('input',validateNames));
    form.addEventListener('keydown',event=>{if(event.key==='Enter'&&current===0){event.preventDefault();next();}});
    const submit=form.onsubmit;form.onsubmit=async function(event){
      team.setCustomValidity(!team.value.trim()?'Enter a team name.':typeof state!=='undefined'&&state.teams.some(t=>t.id!==id&&t.name.toLowerCase()===team.value.trim().toLowerCase())?'This team name is already registered.':'');
      if(!form.reportValidity()){event.preventDefault();return;}
      const label=save.textContent;save.disabled=true;save.textContent='Saving roster…';
      try{return await submit.call(this,event);}finally{if(form.isConnected){save.disabled=false;save.textContent=label;if(error?.textContent)error.focus();}}
    };
    setStep(0);
  }
  function mountIntake(){
    const panel=query('.intake-panel');if(!panel)return;
    panel.classList.add('comfort-intake');
    const isDraft=typeof draft!=='undefined'&&!!draft;
    const summary=query(':scope > summary',panel);if(summary)summary.textContent=isDraft?'Match setup & screenshots':'Set up this match';
    const fields=query('.form-grid',panel);fields?.classList.add('comfort-match-fields');
    const input=query('#screenshots'),drop=query('#dropzone'),scan=query('#scan'),manual=query('#manual');
    if(!input||!drop||!scan)return;
    if(!panel.dataset.comfort){
      panel.dataset.comfort='true';
      const intro=node('p','comfort-intake-intro','Choose the tournament set and map, then add the final result screenshots.');fields?.before(intro);
      const context=node('div','comfort-set-context');context.id='comfort-set-context';context.setAttribute('role','status');fields?.after(context);
      const stage=query('#war-stage');stage?.addEventListener('change',()=>{const input=query('#match-name');if(input&&/^(Set [ABC] · )?Match \d+$/.test(input.value)&&stage.value){const count=typeof state!=='undefined'?state.matches.filter(m=>m.stage===stage.value).length:0;input.value='Set '+stage.value+' · Match '+(count+1);}updateContext();});
      if(stage){stage.setAttribute('aria-describedby',context.id);query('small',stage.closest('label'))?.classList.add('comfort-old-help');}
      const picker=query('.upload-picker',drop);
      if(picker){const strong=query('strong',picker);if(strong)strong.textContent='Add your match screenshots';const span=picker.lastElementChild;if(span&&span!==strong)span.textContent='Drop images here or click to choose';}
      all(':scope > h2,:scope > p:not(#file-summary)',drop).forEach(el=>el.hidden=true);
      const help=node('p','comfort-upload-help','Cover all 12 placements. Overlapping screenshots are okay.');if(picker)picker.after(help);else drop.prepend(help);
      const status=node('p','comfort-file-status');status.id='comfort-file-status';status.setAttribute('aria-live','polite');
      const actions=scan.closest('.actions');actions.classList.add('comfort-intake-actions');actions.after(status);
      if(manual){manual.textContent='Enter results by hand';manual.classList.add('comfort-manual');const alternative=node('div','comfort-manual-path');alternative.append(node('span','','No screenshots?'),manual);status.after(alternative);}
      input.addEventListener('change',()=>{updateUpload();});
      new MutationObserver(updateUpload).observe(drop,{childList:true,subtree:true});
      query('#match-name')?.setAttribute('placeholder','For example, Set A · Match 1');
      const map=query('#match-map');if(map)map.setAttribute('aria-label','Map played in this match');
      query('#match-name')?.addEventListener('input',syncMap);
    }
    updateContext();updateUpload();
    function syncMap(){
      if(typeof draft!=='undefined'&&draft)return;
      if(!root.WarGuide?.mapForMatch)return;
      const map=query('#match-map'),name=query('#match-name'),set=query('#war-stage')?.value||'';
      if(!map||!name)return;
      const explicit=name.value.match(/(?:^|\s)Match\s+(\d+)$/i);
      const number=explicit?Number(explicit[1]):(typeof state!=='undefined'?state.matches.filter(m=>set?m.stage===set:true).length:0)+1;
      const key=set+':'+number;if(map.dataset.rotationKey===key)return;
      map.value=root.WarGuide.mapForMatch(number);map.dataset.rotationKey=key;
    }
    function updateContext(){
      syncMap();
      const context=query('#comfort-set-context');if(!context)return;
      const stage=query('#war-stage'),set=stage?.value;
      let text='Practice match · saved results stay outside the tournament standings.';
      if(set){
        const w=typeof state!=='undefined'?state.war:null;
        const count=w?(set==='C'?(w.qualified?.A?.length||0)+(w.qualified?.B?.length||0):(w.groups?.[set]?.length||0)):0;
        text='Set '+set+(set==='C'?' · Semi-final':' · Qualifier')+' · Battle Royale · '+(set==='C'?'Top 4 advance to CS finals.':'Top 6 advance to Set C.');
        if(set!=='C'&&count!==12)text+=' The 12 teams in your first saved points table become this set’s team list.';
        if(set==='C'&&count!==12)text+=' Confirm the top 6 from Set A and Set B first.';
        if(w?.qualified?.[set])text+=' Qualification is locked.';
      }
      context.textContent=text;context.classList.toggle('is-practice',!set);
    }
    function updateUpload(){
      const count=input.files?.length||0,running=typeof busy!=='undefined'&&busy;
      const status=query('#comfort-file-status');
      scan.disabled=!!running||count===0;scan.textContent=running?'Reading your screenshots…':count?'Read '+count+' screenshot'+(count===1?'':'s')+' →':'Read screenshots →';
      if(status)status.textContent=count?'Ready when you are. You’ll check the results before saving.':'Choose your screenshots to continue.';
      drop.classList.toggle('has-screenshots',count>0);
    }
  }
  // The results check is rendered directly by workspace.js; nothing to rewrite here.
  function mountReview(){}
  function mount(){mountTeamForm();mountIntake();mountReview();}
  root.ComfortForms={mount};
  if(typeof teamForm==='function'){const prior=teamForm;teamForm=function(id){const result=prior.apply(this,arguments);mountTeamForm(id);return result;};}
  if(typeof redrawReview==='function'){const prior=redrawReview;redrawReview=function(){const result=prior.apply(this,arguments);mountIntake();mountReview();return result;};}
  if(typeof confirmRow==='function'){const prior=confirmRow;confirmRow=function(i){const result=prior.apply(this,arguments);if(typeof draft!=='undefined'&&draft?.rows[i]?.confirmed){const pending=draft.rows.map((row,index)=>({row,index})).filter(item=>!item.row.confirmed);focusedTeam=pending.find(item=>item.index>i)?.index??pending[0]?.index??i;mountReview();}return result;};}
})(window);
