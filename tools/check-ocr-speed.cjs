// Compare every OCR output against the pre-optimization reader on labeled screenshots.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module');
const {dep,launchOptions}=require('./deps.cjs');
const {createCanvas,loadImage}=dep('@napi-rs/canvas'),Tesseract=dep('tesseract.js');
const batch=require('../public/ocr-batch.js'),OCR=require('../public/ocr.js');require('../public/digit-templates.js');
const cache=path.resolve(__dirname,'../.ocr-cache'),baselinePath=process.env.OCR_BASELINE_PATH||path.resolve(__dirname,'../public/ocr.js');
const previous=new Module(path.resolve(__dirname,'../public/ocr.js'),module);previous.filename=path.resolve(__dirname,'../public/ocr.js');previous.paths=module.paths;previous._compile(fs.readFileSync(baselinePath,'utf8'),previous.filename);
const baseline=previous.exports;
async function worker(){const w=await Tesseract.createWorker('eng',1,{cachePath:cache});await w.setParameters({tessedit_pageseg_mode:'11'});return w;}
(async()=>{
  const folder=path.resolve(__dirname,'../ocr-data/images'),files=fs.readdirSync(folder).filter(f=>/\.jpe?g$/i.test(f)).sort().slice(0,Number(process.env.OCR_BENCH_LIMIT)||10);
  const items=await Promise.all(files.map(async file=>({file,image:await loadImage(path.join(folder,file))})));
  let before,after,baselineMs,parallelMs;
  async function serial(){const start=performance.now(),w=await worker();before=[];try{for(const item of items){before.push(await baseline.extract(w,item.image,[],createCanvas));console.log('Baseline '+before.length+'/'+items.length+': '+item.file);}}finally{await w.terminate();}baselineMs=performance.now()-start;}
  async function parallel(){const start=performance.now();after=await batch.run(items,{createWorker:worker,maxWorkers:2,process:async(w,item,index)=>{const rows=await OCR.extract(w,item.image,[],createCanvas);console.log('Parallel screenshot '+(index+1)+'/'+items.length+' complete');return rows;}});parallelMs=performance.now()-start;}
  if(process.env.OCR_BENCH_REVERSE){await parallel();await serial();}else{await serial();await parallel();}
  for(let i=0;i<items.length;i++)assert.deepEqual(JSON.parse(JSON.stringify(after[i])),JSON.parse(JSON.stringify(before[i])),items[i].file+' changed its OCR output');
  const fields=before.reduce((n,rows)=>n+rows.reduce((a,r)=>a+r.players.length,0),0);
  const report={screenshots:items.length,playerFields:fields,identicalOutputs:true,order:process.env.OCR_BENCH_REVERSE?'parallel-first':'serial-first',baselineSeconds:Math.round(baselineMs/100)/10,parallelSeconds:Math.round(parallelMs/100)/10,speedup:Number((baselineMs/parallelMs).toFixed(2)),timeSavedPercent:Math.round((1-parallelMs/baselineMs)*100)};
  fs.writeFileSync(path.join(cache,process.env.OCR_BENCH_REVERSE?'ocr-speed-report-reversed.json':'ocr-speed-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1});
