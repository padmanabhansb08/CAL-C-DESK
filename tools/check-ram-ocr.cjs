// No images, real matches or saved organizer data are changed by these checks.
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const ocr=require('../public/ocr.js');
const ram={id:'ram',name:'FFK RAM',players:['RAM','BALA','ZORO','VEGITO'].map((n,i)=>({id:'ram-'+i,name:'FFK '+n}))};
const vini={id:'vini',name:'FFK VINI',players:['VINI','BALA','HAKAI','PADHU'].map((n,i)=>({id:'vini-'+i,name:'FFK '+n}))};
const zoro={id:'other',name:'FFK OTHER',players:['OTHER','ZORO','TOM','WHITE'].map((n,i)=>({id:'other-'+i,name:'FFK '+n}))};
const raw=['FFK TT Ram0?','FKTUmsUT FS','FFK TVEGITO?','FFR?-ZoT9'];
const players=()=>raw.map(name=>({name,playerId:'',kills:1}));
const observed=players(),result=ocr.matchTeam(observed,[vini,zoro,ram]);
assert.equal(result.teamId,'ram');assert.equal(observed[0].playerId,'ram-0');assert.equal(observed[2].playerId,'ram-3');
assert.equal(observed[1].playerId,'','Unintelligible name must not be guessed as BALA');assert.equal(observed[3].playerId,'','ZORO must stay unresolved without enough evidence');
assert.deepEqual(observed.map(p=>p.kills),[1,1,1,1],'Name matching must never change kills');
assert.equal(ocr.rosterSimilarity('FFK RAMBO','FFK RAM'),0);assert.equal(ocr.rosterSimilarity('FFK RAM123','FFK RAM'),0);
assert.equal(ocr.matchTeam(players().map(p=>({...p,name:'unreadable'})),[ram]).teamId,'','A single candidate is not inherently trusted');
const partial=players().map((p,i)=>({...p,name:i===2?raw[2]:'unreadable'}));
assert.equal(ocr.matchTeam(partial,[ram],{trustedTeamId:'ram'}).teamId,'ram');assert.equal(partial[2].playerId,'ram-3');assert.equal(partial[0].playerId,'');
const manual=players();manual[1]={...manual[1],rawName:raw[1],name:'FFK BALA',playerId:'ram-1',identityEdited:true};
manual[3]={...manual[3],rawName:raw[3],name:'Guest',playerId:'sub:ram:3',isSubstitute:true,identityEdited:true};
ocr.matchTeam(manual,[ram],{trustedTeamId:'ram'});assert.equal(manual[1].playerId,'ram-1');assert.equal(manual[3].name,'Guest');
const teams=structuredClone([ram,vini]);
assert.equal(ocr.rememberAliases(teams,[{teamId:'ram',confirmed:false,players:manual}]),0);
assert.equal(ocr.rememberAliases(teams,[{teamId:'ram',confirmed:true,players:manual}]),1);
assert.equal(ocr.rememberAliases(teams,[{teamId:'ram',confirmed:true,players:manual}]),0,'Repeated confirmation must not duplicate aliases');
assert.equal(ocr.playerSimilarity(raw[1],teams[1].players[1]),0,'RAM correction must not attach to VINI BALA');
const learned=players();ocr.matchTeam(learned,teams);assert.equal(learned[1].playerId,'ram-1');
const manualOther={...manual[1],playerId:'ram-2',name:'FFK ZORO'};assert.equal(ocr.rememberAliases(teams,[{teamId:'ram',confirmed:true,players:[manualOther]}]),0,'Conflicting aliases stay unresolved');
// A failed save must roll back newly learned aliases; retry should keep them after success.
const context=vm.createContext({console,structuredClone,WarOCR:ocr,WarTournament:require('../public/tournament.js'),crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,URL,Blob,
 document:{querySelector:sel=>sel==='#match-name'?{value:'Test match'}:sel==='#match-map'?{value:'Bermuda'}:null},window:{addEventListener(){}},
 WarOCRLearning:{capture:()=>[],store:async()=>0}});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8'),context);
context.inputTeams=structuredClone([ram,vini]);context.inputPlayers=structuredClone(manual);
(async()=>{
 vm.runInContext("state={teams:inputTeams,matches:[]};draft={id:'match',stage:'A',rows:Array.from({length:12},(_,i)=>({teamId:i===0?'ram':'extra'+i,confirmed:true,players:i===0?inputPlayers:[]}))};state.teams.push(...Array.from({length:11},(_,i)=>({id:'extra'+(i+1),name:'Extra',players:[]})));toast=()=>{};render=()=>{};save=async()=>{throw Error('offline')};",context);
 await vm.runInContext('finalize()',context);assert.equal(vm.runInContext('!!state.teams[0].players[1].ocrAliases',context),false);assert.equal(vm.runInContext('!!draft',context),true);assert.equal(vm.runInContext('state.war',context),undefined,'Failed first match must not establish a set');
 vm.runInContext('save=async()=>{}',context);await vm.runInContext('finalize()',context);
 assert.equal(vm.runInContext('state.teams[0].players[1].ocrAliases.length',context),1);assert.equal(vm.runInContext('draft',context),null);assert.equal(vm.runInContext('state.war.groups.A.length',context),12,'First successful match establishes all twelve teams');
 console.log('PASS: RAM screenshot variants, safe short-name matching, unknown-player review, explicit-team recovery, manual choice preservation, scoped name learning and save rollback/retry.');
})().catch(e=>{console.error(e);process.exitCode=1});
