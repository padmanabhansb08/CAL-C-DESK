/* Bounded parallelism only. Every screenshot keeps the full OCR/review pipeline. */
(function(root){
  function capacity(count,device={}){
    const cores=Number(device.hardwareConcurrency)||2,memory=Number(device.deviceMemory)||4;
    return Math.min(count,cores>=4&&memory>=4?2:1);
  }
  async function run(items,{createWorker,process,maxWorkers=1,onWorkerFailure=()=>{}}){
    if(!items.length)return [];
    const count=Math.min(items.length,Math.max(1,Math.min(2,maxWorkers))),workers=[];
    try{
      const started=await Promise.allSettled(Array.from({length:count},(_,i)=>createWorker(i)));
      for(const result of started){if(result.status==='fulfilled')workers.push(result.value);else onWorkerFailure(result.reason);}
      if(!workers.length)throw started[0].reason;
      const results=new Array(items.length);let cursor=0;
      const lanes=await Promise.allSettled(workers.map(async worker=>{
        while(cursor<items.length){const index=cursor++;results[index]=await process(worker,items[index],index);}
      }));
      const failure=lanes.find(result=>result.status==='rejected');if(failure)throw failure.reason;
      return results;
    }finally{
      await Promise.allSettled(workers.map(worker=>Promise.resolve().then(()=>worker.terminate())));
    }
  }
  const api={run,capacity};if(typeof module!=='undefined')module.exports=api;else root.WarOCRBatch=api;
})(typeof window==='undefined'?globalThis:window);
