// Scoring rules: placement points 12-9-8-7-6-5-4-3-2-1-0-0, one point per kill, signed adjustments, and the ranking
// order total > kills > Booyahs > placement points (equal on all four = shared rank). Every copy of the points table
// (desk, standings, server validation) must agree, and the single-match ranking must order like the standings.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {aggregate}=require('../public/overall.js');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const RULE=[12,9,8,7,6,5,4,3,2,1,0,0];

// 1. One points table everywhere.
const table=(file,re)=>{const m=re.exec(read(file));assert.ok(m,'points table not found in '+file);return m[1].split(',').map(Number);};
assert.deepEqual(table('public/app.js',/const points\s*=\s*\[([\d,\s]+)\]/),RULE,'desk table');
assert.deepEqual(table('public/overall.js',/placementPoints\s*=\s*\[([\d,\s]+)\]/),RULE,'standings table');
assert.deepEqual(table('ffk_core/validate.py',/placement_points\s*=\s*\[([\d,\s]+)\]/),RULE,'server table');

// The desk's per-match scoring and ranking functions, taken from app.js as written.
const src=read('public/app.js'),grab=name=>{const m=new RegExp('function '+name+'\\(r?m?\\)\\{[^\\n]*').exec(src);assert.ok(m,name+' not found');return m[0];};
const desk=vm.runInNewContext(`const points=${JSON.stringify(RULE)};${grab('score')}\n${grab('rankedRows')}\n({score,rankedRows})`);

const player=(id,kills)=>({playerId:id,name:id,kills});
const row=(id,placement,kills,adjustments=[])=>({teamId:id,teamName:id,placement,players:kills.map((k,i)=>player(id+i,k)),adjustments:adjustments.map(value=>({value}))});
const teams=n=>Array.from({length:n},(_,i)=>({id:'t'+(i+1),name:'Team '+(i+1)}));

// 2. Every placement scores its points; kills and adjustments add on top.
const full={id:'m1',name:'Match 1',rows:RULE.map((_,i)=>row('t'+(i+1),i+1,[i%3,1]))};
const one=aggregate({teams:teams(12),matches:[full]});
for(let i=0;i<12;i++){
  const r=one.rows.find(x=>x.teamId==='t'+(i+1)),kills=i%3+1;
  assert.deepEqual([r.placementPoints,r.kills,r.total,r.wins],[RULE[i],kills,RULE[i]+kills,i===0?1:0],'placement '+(i+1));
  assert.deepEqual({...desk.score(full.rows[i])},{kills,placement:RULE[i],adjustment:0,total:RULE[i]+kills});
}
const adj=aggregate({teams:teams(2),matches:[{id:'m',name:'M',rows:[row('t1',1,[5],[-3,1]),row('t2',2,[0],[2])]}]}).rows;
assert.deepEqual(adj.map(r=>[r.teamId,r.adjustment,r.total]),[['t1',-2,15],['t2',2,11]],'signed adjustments');
assert.equal(aggregate({teams:teams(1),matches:[{id:'m',name:'M',rows:[row('t1',12,[0,0,0,0])]}]}).rows[0].total,0,'last place, no kills: zero');

// 3. Tie-breaks, one rule at a time.
const rank=rows=>aggregate({teams:teams(rows.length),matches:[{id:'m',name:'M',rows}]}).rows.map(r=>r.teamId+':'+r.rank).join(' ');
// Equal total: more kills ranks higher (2nd place 9+3=12 vs 1st place 12+0=12 -> kills first).
assert.equal(rank([row('t1',1,[0]),row('t2',2,[3])]),'t2:1 t1:2','kills break an equal total');
// Equal total and kills over two matches: more Booyahs ranks higher.
const two=(a,b)=>aggregate({teams:teams(a.length),matches:[{id:'a',name:'A',rows:a},{id:'b',name:'B',rows:b}]}).rows.map(r=>r.teamId+':'+r.rank).join(' ');
// t1: 1st (12) + 11th (0) = 12, 2 kills. t2: 4th (7) + 6th (5) = 12, 2 kills. Same total and kills, t1 has the Booyah.
assert.equal(two([row('t1',1,[1]),row('t2',4,[1])],[row('t1',11,[1]),row('t2',6,[1])]),'t1:1 t2:2','Booyahs break equal total and kills');
// Equal total, kills and Booyahs: more placement points ranks higher (kills from an adjustment make up the gap).
assert.equal(rank([row('t1',3,[0]),row('t2',4,[0],[1])]),'t1:1 t2:2','placement points break the rest');
// Equal on everything: shared rank, and the next team skips (1, 1, 3).
const shared=aggregate({teams:teams(3),matches:[{id:'a',name:'A',rows:[row('t1',2,[2]),row('t2',5,[1]),row('t3',3,[0])]},{id:'b',name:'B',rows:[row('t1',5,[1]),row('t2',2,[2]),row('t3',3,[0])]}]}).rows;
assert.deepEqual(shared.map(r=>r.rank),[1,1,3],'full ties share a rank');

// 4. The single-match ranking orders like the standings of that match.
const sample=[row('t1',2,[3]),row('t2',1,[0]),row('t3',3,[5]),row('t4',4,[1],[2])];
assert.deepEqual([...desk.rankedRows({rows:sample})].map(r=>r.teamId),aggregate({teams:teams(4),matches:[{id:'m',name:'M',rows:sample}]}).rows.map(r=>r.teamId));
console.log('PASS: one points table (desk, standings, server), placement + kills + signed adjustments, tie-breaks total > kills > Booyahs > placement, shared ranks, match ranking matches standings.');
