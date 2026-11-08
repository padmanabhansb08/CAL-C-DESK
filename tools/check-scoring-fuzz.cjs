// Randomized scoring check: thousands of generated tournaments (fixed seed, so a failure repeats) are scored by the
// standings code and by an independent recount written here from the rules. They must agree on every number and on
// the order, regardless of match order, and the source data must never be changed.
const assert=require('node:assert/strict'),{aggregate}=require('../public/overall.js');
const RULE=[12,9,8,7,6,5,4,3,2,1,0,0];
let seed=20261108;const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;},int=(a,b)=>a+Math.floor(rnd()*(b-a+1));
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=int(0,i);[a[i],a[j]]=[a[j],a[i]];}return a;};

function tournament(){
  const n=int(2,12),teams=Array.from({length:n},(_,i)=>({id:'t'+i,name:'Team '+String.fromCharCode(65+i)})),matches=[];
  for(let m=0;m<int(1,6);m++){
    const order=shuffle(teams.map(t=>t.id));
    // Small kill counts make ties on total, kills, Booyahs and placement common, so the tie-breaks really run.
    matches.push({id:'m'+m,name:'Match '+(m+1),rows:order.map((id,i)=>({teamId:id,teamName:id,placement:i+1,
      players:Array.from({length:4},(_,p)=>({playerId:id+'p'+p,name:id+'p'+p,kills:rnd()<.6?0:int(0,3)})),
      adjustments:rnd()<.08?[{value:int(-5,5)}]:[]}))});
  }
  return {teams,matches};
}

// The rules, recounted independently.
function recount(state){
  const by=new Map(state.teams.map(t=>[t.id,{teamId:t.id,teamName:t.name,total:0,kills:0,wins:0,placementPoints:0,adjustment:0,matches:0}]));
  for(const m of state.matches)for(const r of m.rows){const t=by.get(r.teamId),k=r.players.reduce((s,p)=>s+p.kills,0),a=r.adjustments.reduce((s,x)=>s+x.value,0);
    t.matches++;t.kills+=k;t.wins+=r.placement===1?1:0;t.placementPoints+=RULE[r.placement-1];t.adjustment+=a;t.total+=k+RULE[r.placement-1]+a;}
  const key=t=>[t.total,t.kills,t.wins,t.placementPoints];
  const rows=[...by.values()].filter(t=>t.matches);
  for(const t of rows)t.rank=1+rows.filter(o=>{const x=key(o),y=key(t);for(let i=0;i<4;i++)if(x[i]!==y[i])return x[i]>y[i];return false;}).length;
  return rows;
}

const RUNS=3000;let ties=0;
for(let run=0;run<RUNS;run++){
  const state=tournament(),before=JSON.stringify(state),got=aggregate(state).rows.filter(r=>r.matches),want=recount(state);
  assert.equal(JSON.stringify(state),before,'scoring changed the source data (run '+run+')');
  assert.equal(got.length,want.length,'run '+run);
  for(const g of got){const w=want.find(x=>x.teamId===g.teamId);
    for(const k of ['total','kills','wins','placementPoints','adjustment','matches','rank'])assert.equal(g[k],w[k],`run ${run}, ${g.teamId}, ${k}`);}
  // Listed best first, and the ranks only ever stay or step down.
  for(let i=1;i<got.length;i++){assert.ok(got[i].rank>=got[i-1].rank,'run '+run+' order');}
  if(new Set(got.map(r=>r.total)).size<got.length)ties++;
  // Match order does not matter.
  const again=aggregate({teams:state.teams,matches:shuffle(state.matches.slice())}).rows.filter(r=>r.matches);
  assert.deepEqual(again.map(r=>[r.teamId,r.total,r.rank]).sort(),got.map(r=>[r.teamId,r.total,r.rank]).sort(),'run '+run+' match order');
}
assert.ok(ties>RUNS/4,'too few equal totals to exercise the tie-breaks: '+ties);
console.log(`PASS: ${RUNS} random tournaments (${ties} with equal totals) score and rank exactly as an independent recount, in any match order, without changing the data.`);
