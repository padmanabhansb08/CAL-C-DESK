// Tournament checks use synthetic teams and never open the real database.
const assert=require('node:assert/strict');
const war=require('../public/tournament.js');
const teams=Array.from({length:24},(_,i)=>({id:'t'+i,name:'Team '+String(i).padStart(2,'0'),players:[]}));
const state={teams,matches:[],war:war.initial()};
state.war.groups={A:teams.slice(0,12).map(t=>t.id),B:teams.slice(12).map(t=>t.id)};
function match(set,ids){return {id:set,stage:set,rows:ids.map((id,i)=>({teamId:id,teamName:id,placement:i+1,players:[{playerId:id,kills:12-i}],adjustments:[]}))};}
assert.throws(()=>war.qualify(state,'A'),/exactly/);
for(let i=0;i<5;i++)state.matches.push({...match('A',state.war.groups.A),id:'A'+i},{...match('B',state.war.groups.B),id:'B'+i});
assert.throws(()=>war.qualify(state,'A'),/exactly 6/,'Cannot qualify before the sixth match');
state.matches.push({...match('A',state.war.groups.A),id:'A6'},{...match('B',state.war.groups.B),id:'B6'});
state.war.qualified.A=war.qualify(state,'A');state.war.qualified.B=war.qualify(state,'B');
assert.equal(war.members(state.war,'C').length,12);
assert.equal(war.standings(state,'C').length,0,'Set C starts fresh');
assert.deepEqual(state.war.qualified.A,state.war.groups.A.slice(0,6));
const bad=structuredClone(state);bad.matches[0].rows[0].teamId='t23';assert.throws(()=>war.qualify(bad,'A'),/all 12/);
for(let i=0;i<6;i++)state.matches.push({...match('C',war.members(state.war,'C')),id:'C'+i});state.war.qualified.C=war.qualify(state,'C');
assert.deepEqual(war.fixture(state.war,'q1'),['t0','t1']);
assert.deepEqual(war.fixture(state.war,'eliminator'),['t2','t3']);
assert.throws(()=>war.recordCS(state.war,'final',4,1),/Both teams/);
assert.throws(()=>war.recordCS(state.war,'q1',4,4),/different/);
war.recordCS(state.war,'q1',4,1);war.recordCS(state.war,'eliminator',1,4);
assert.deepEqual(war.fixture(state.war,'q2'),['t1','t3']);assert.equal(state.war.cs.eliminator.loser,'t2');
assert.throws(()=>war.recordCS(state.war,'final',4,2),/Both teams/);
war.recordCS(state.war,'q2',1,4);assert.deepEqual(war.fixture(state.war,'final'),['t0','t3']);war.recordCS(state.war,'final',4,2);
assert.equal(state.war.cs.final.winner,'t0');assert.throws(()=>war.recordCS(state.war,'q1',1,4),/Clear/);
war.recordCS(state.war,'q1',5,1);assert.equal(state.war.cs.final.winner,'t0','Same-winner score corrections preserve later results');
const comeback=structuredClone(state.war);war.clearCS(comeback,'q2');war.recordCS(comeback,'q2',4,1);war.recordCS(comeback,'final',1,4);assert.equal(comeback.cs.final.winner,'t1','Qualifier 1 loser can return and win the title');
war.clearCS(comeback,'q1');assert.equal(comeback.cs.q2,undefined);assert.equal(comeback.cs.final,undefined);assert.ok(comeback.cs.eliminator);
const legacy={qualified:{C:['t0','t1','t2','t3']},cs:{sf1:{teams:['t0','t3'],scores:[7,2],winner:'t0'}}};const old=structuredClone(legacy.cs);war.migratePlayoffs(legacy);assert.deepEqual(legacy.cs,{});assert.deepEqual(legacy.csHistory[0].results,old);war.migratePlayoffs(legacy);assert.equal(legacy.csHistory.length,1);
// A clean cutoff tie with no Booyahs or placement differences.
const cutoff=structuredClone(state);cutoff.matches=[match('A',cutoff.war.groups.A)];
cutoff.war.targets.A=1;
cutoff.matches[0].rows[6]=structuredClone(cutoff.matches[0].rows[5]);cutoff.matches[0].rows[6].teamId='t6';
assert.throws(()=>war.qualify(cutoff,'A'),/cutoff tie/);
assert.throws(()=>war.qualify(cutoff,'A',['t23']),/cutoff tie/);
assert.deepEqual(war.qualify(cutoff,'A',['t6']),['t0','t1','t2','t3','t4','t6']);
console.log('PASS: isolated standings, 6+6 progression, fresh semi-final, roster validation, cutoff ties, CS seeding and champion corrections.');
