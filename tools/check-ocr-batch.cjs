const assert=require('node:assert/strict'),batch=require('../public/ocr-batch.js');
(async()=>{
 assert.equal(batch.capacity(6,{hardwareConcurrency:8,deviceMemory:8}),2);assert.equal(batch.capacity(6,{hardwareConcurrency:2}),1);assert.equal(batch.capacity(6,{hardwareConcurrency:8,deviceMemory:2}),1);assert.equal(batch.capacity(1,{hardwareConcurrency:8}),1);
 let active=0,maximum=0,closed=0;
 const result=await batch.run([0,1,2,3],{maxWorkers:9,createWorker:async()=>({terminate:async()=>closed++}),process:async(_,n)=>{active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,n%2?1:15));active--;return n*2;}});
 assert.deepEqual(result,[0,2,4,6]);assert.equal(maximum,2);assert.equal(closed,2);
 let failures=0;closed=0;
 assert.deepEqual(await batch.run([1,2],{maxWorkers:2,createWorker:async i=>{if(i)throw Error('memory');return {terminate:async()=>closed++};},onWorkerFailure:()=>failures++,process:async(_,n)=>n}),[1,2]);assert.equal(failures,1);assert.equal(closed,1);
 closed=0;await assert.rejects(batch.run([0,1,2],{maxWorkers:2,createWorker:async()=>({terminate:async()=>closed++}),process:async(_,n)=>{if(n===1)throw Error('failed');return n;}}),/failed/);assert.equal(closed,2);
 await assert.rejects(batch.run([1],{createWorker:async()=>{throw Error('startup')},process:async()=>{}}),/startup/);
 console.log('PASS: device limits, two-worker cap, ordered results, single-worker fallback, error draining and worker cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1});
