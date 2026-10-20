// Controller checks with an in-memory store; no real browser profile or database writes.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const storage=new Map(),listeners={};let remote={teams:[{id:'t',name:'Original',players:[]}],matches:[]},writes=0,quota=false;
const context=vm.createContext({console,structuredClone,crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,setInterval:()=>0,URL,Blob,
 fetch:async()=>({ok:true,json:async()=>structuredClone(remote)}),
 document:{querySelector:()=>null,addEventListener(){},createElement(){return {};},querySelectorAll:()=>[]},
 window:{addEventListener(name,fn){listeners[name]=fn;}},
 localStorage:{getItem:key=>storage.get(key)||null,setItem(key,value){if(quota&&value.includes('evidenceCrop'))throw Error('Quota');storage.set(key,value);},removeItem:key=>storage.delete(key)},
});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8'),context);
context.mockAPI=async(route,data)=>{if(data===undefined)return structuredClone(remote);remote=JSON.parse(JSON.stringify(data));writes++;return {ok:true};};
vm.runInContext('api=mockAPI;init=async()=>{};',context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/workspace.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/tournament.js'),'utf8'),context);
(async()=>{
 await vm.runInContext("(async()=>{state=await api('state');state.teams[0].name='Local edit';})()",context);
 remote.teams.push({id:'new',name:'Added elsewhere',players:[]});
 await assert.rejects(vm.runInContext('save()',context),/Newer changes/);assert.equal(writes,0);assert.equal(remote.teams.length,2);
 await vm.runInContext("(async()=>{state=await api('state');state.teams[0].name='Reviewed edit';await save();})()",context);assert.equal(writes,1);assert.equal(remote.teams[0].name,'Reviewed edit');
 vm.runInContext("draft={id:'test-draft',name:'Recovered',rows:[{players:[{kills:7,evidenceCrop:'data:image/png;base64,test'}]}]};",context);listeners.pagehide();
 let saved=JSON.parse(storage.get('ffk-match-draft-v1'));assert.equal(saved.draft.rows[0].players[0].kills,7);assert.ok(saved.draft.rows[0].players[0].evidenceCrop);
 quota=true;vm.runInContext("draft.rows[0].players[0].kills=8",context);listeners.pagehide();saved=JSON.parse(storage.get('ffk-match-draft-v1'));assert.equal(saved.draft.rows[0].players[0].kills,8);assert.equal(saved.draft.rows[0].players[0].evidenceCrop,undefined);
 assert.equal(vm.runInContext('window.isMatchDraftSaved()',context),true);
 console.log('PASS: stale saves blocked, latest roster preserved, normal saves, draft/crop persistence, storage-quota fallback.');
})().catch(error=>{console.error(error);process.exitCode=1});
