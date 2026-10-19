const assert=require('node:assert/strict'),{aggregate}=require('../public/overall.js');
const player=(id,kills)=>({playerId:id,name:id,kills}),row=(id,placement,players,adjustments=[])=>({teamId:id,teamName:id,placement,players,adjustments:adjustments.map(value=>({value}))});
const state={teams:[{id:'a',name:'Alpha'},{id:'b',name:'Beta'},{id:'c',name:'Gamma'},{id:'d',name:'Alpha'},{id:'unused',name:'Unplayed'}],matches:[
 {id:'m1',name:'Match 1',created:'2026-10-18T10:00:00Z',rows:[row('a',1,[player('a1',4),player('a2',1)],[-2]),row('b',2,[player('b1',10)]),row('c',12,[player('c1',0)])]},
 {id:'m2',name:'Match 2',created:'2026-10-18T11:00:00Z',rows:[row('a',2,[player('a1',7)],[3]),row('b',1,[player('b1',1)]),row('d',12,[player('d1',0)])]}
]};
const before=JSON.stringify(state),overall=aggregate(state),alpha=overall.rows.find(r=>r.teamId==='a');
assert.equal(overall.matchCount,2);assert.equal(overall.rows.length,4);assert.equal(JSON.stringify(state),before);
assert.deepEqual([alpha.matches,alpha.kills,alpha.placementPoints,alpha.adjustment,alpha.total,alpha.wins],[2,12,21,1,34,1]);
assert.equal(alpha.players.find(p=>p.playerId==='a1').kills,11);assert.equal(overall.rows[0].teamId,'a');assert.equal(overall.rows.find(r=>r.teamId==='b').total,32);
assert.equal(overall.rows.find(r=>r.teamId==='c').rank,3);assert.equal(overall.rows.find(r=>r.teamId==='d').rank,3);
const removed=aggregate({...state,matches:[state.matches[0]]});assert.equal(removed.rows[0].teamId,'b');assert.equal(removed.rows.find(r=>r.teamId==='a').total,15);assert.ok(!removed.rows.some(r=>r.teamId==='d'));
const adjusted=structuredClone(state);adjusted.matches[1].rows[0].adjustments.push({value:1});assert.equal(aggregate(adjusted).rows[0].total,35);
assert.equal(aggregate({teams:state.teams,matches:[]}).rows.length,0);
console.log('PASS: multi-match totals, wins, signed adjustments, player kills, team IDs, ties, deleted matches, unplayed teams and immutable source data.');
