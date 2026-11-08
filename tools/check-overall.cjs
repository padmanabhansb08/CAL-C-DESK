const assert=require('node:assert/strict'),{aggregate}=require('../public/overall.js');
const player=(id,kills)=>({playerId:id,name:id,kills}),row=(id,placement,players,adjustments=[])=>({teamId:id,teamName:id,placement,players,adjustments:adjustments.map(value=>({value}))});
const state={teams:[{id:'a',name:'Alpha'},{id:'b',name:'Beta'},{id:'c',name:'Gamma'},{id:'d',name:'Alpha'},{id:'unused',name:'Unplayed'}],matches:[
 {id:'m1',name:'Match 1',created:'2026-10-18T10:00:00Z',rows:[row('a',1,[player('a1',4),player('a2',1)],[-2]),row('b',2,[player('b1',10)]),row('c',12,[player('c1',0)])]},
 {id:'m2',name:'Match 2',created:'2026-10-18T11:00:00Z',rows:[row('a',2,[player('a1',7)],[3]),row('b',1,[player('b1',1)]),row('d',12,[player('d1',0)])]}
]};
const before=JSON.stringify(state),overall=aggregate(state),alpha=overall.rows.find(r=>r.teamId==='a');
assert.equal(overall.matchCount,2);assert.equal(overall.rows.length,5);assert.deepEqual([overall.rows.find(r=>r.teamId==='unused').matches,overall.rows.find(r=>r.teamId==='unused').missing],[0,2]);assert.equal(JSON.stringify(state),before);
assert.deepEqual([alpha.matches,alpha.kills,alpha.placementPoints,alpha.adjustment,alpha.total,alpha.wins],[2,12,21,1,34,1]);
assert.equal(alpha.players.find(p=>p.playerId==='a1').kills,11);assert.equal(overall.rows[0].teamId,'a');assert.equal(overall.rows.find(r=>r.teamId==='b').total,32);
assert.equal(overall.rows.find(r=>r.teamId==='c').rank,3);assert.equal(overall.rows.find(r=>r.teamId==='d').rank,3);
const removed=aggregate({...state,matches:[state.matches[0]]});assert.equal(removed.rows[0].teamId,'b');assert.equal(removed.rows.find(r=>r.teamId==='a').total,15);assert.ok(removed.rows.some(r=>r.teamId==='d')&&removed.rows.find(r=>r.teamId==='d').matches===0);
const adjusted=structuredClone(state);adjusted.matches[1].rows[0].adjustments.push({value:1});assert.equal(aggregate(adjusted).rows[0].total,35);
assert.equal(aggregate({teams:state.teams,matches:[]}).rows.length,0);
console.log('PASS: multi-match totals, wins, signed adjustments, player kills, team IDs, ties, deleted matches, unplayed teams and immutable source data.');
// A partial match (only some teams submitted) leaves the others missing, not scored as zero.
const partial=aggregate({teams:state.teams,matches:[...state.matches,{id:'m3',name:'Match 3',rows:[row('b',1,[player('b1',3)])]}]});
assert.equal(partial.provisional,true);assert.equal(partial.rows.find(r=>r.teamId==='b').missing,0);assert.deepEqual([partial.rows.find(r=>r.teamId==='a').missing,partial.rows.find(r=>r.teamId==='a').matches],[1,2]);
assert.equal(overall.rows.find(r=>r.teamId==='c').timeline.length,2);assert.equal(overall.rows.find(r=>r.teamId==='c').breakdown.length,1);
assert.equal(overall.provisional,true);assert.equal(overall.rows.find(r=>r.teamId==='c').missing,1);
console.log('PASS: partial matches mark the teams without a result as missing.');
// With a roster larger than one lobby and no saved pool, nobody is flagged as missing (never guess who was in the lobby).
const big=Array.from({length:24},(_,i)=>({id:'t'+i,name:'T'+i})),bigPartial=aggregate({teams:big,matches:[{id:'x',name:'X',rows:[row('t0',1,[player('p',1)]),row('t1',2,[player('q',1)])]}]});
assert.equal(bigPartial.provisional,false);assert.equal(bigPartial.rows[0].missing,0);
const pooled=aggregate({teams:big,matches:[{id:'x',name:'X',pool:['t0','t1','t2'],rows:[row('t0',1,[player('p',1)]),row('t1',2,[player('q',1)])]}]});
assert.equal(pooled.provisional,true);assert.equal(require('../public/overall.js').missingTeams({teams:big},{rows:[],pool:['t0','t2']}).join(),'t0,t2');
console.log('PASS: missing results only where the lobby is known.');
