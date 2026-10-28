// Approved direction: labeled screenshots, digit exemplars, and match-separated evaluation.
const fs=require('fs'),path=require('path');
const {dep,launchOptions}=require('./deps.cjs');
const {createCanvas,loadImage}=dep('@napi-rs/canvas');
const OCR=require('../public/ocr.js'),Layout=require('../public/layout.js');
require('../public/digit-templates.js');
const folder=process.argv[2]||path.join(__dirname,'../ocr-data/images');
// Player order is top-left, top-right, bottom-left, bottom-right. Paired frames share a match.
const matches=[
 {id:'match-1',split:'train',files:['21','22'],kills:[[7,9,7,11],[0,2,0,1],[1,1,1,1],[4,3,1,2],[3,0,2,2],[0,0,0,1],[2,1,2,0],[1,4,0,0],[0,1,0,0],[5,0,0,1],[1,1,2,4],[1,0,0,0]]},
 {id:'match-2',split:'train',files:['30','30 (1)'],kills:[[1,11,5,5],[6,2,3,5],[1,1,3,4],[1,3,2,3],[2,1,2,3],[0,4,5,3],[1,2,3,0],[0,3,0,0],[0,2,0,0],[0,0,0,1],[2,1,1,1],[1,0,0,1]]},
 {id:'match-3',split:'train',files:['31','31 (1)'],kills:[[5,8,2,3],[2,2,6,3],[0,2,0,1],[2,4,0,1],[1,0,1,2],[1,4,6,4],[0,3,3,0],[0,1,2,0],[2,1,0,0],[1,1,1,0],[0,1,0,0],[0,0,0,0]]},
 {id:'match-4',split:'held-out',files:['39','39 (1)'],kills:[[7,2,0,4],[4,5,7,5],[1,4,3,2],[3,3,3,1],[0,1,1,1],[2,1,0,0],[3,3,0,4],[0,2,0,1],[0,0,0,0],[1,0,0,0],[1,0,1,2],[0,0,0,0]]},
 {id:'match-5',split:'held-out',files:['47','48'],kills:[[3,3,4,2],[6,5,5,1],[5,1,1,2],[2,5,3,2],[2,2,2,0],[1,1,2,2],[3,1,1,1],[0,3,3,2],[1,1,2,1],[1,0,0,0],[0,0,0,1],[0,0,1,0]]}
];
async function main(){
 const out=path.join(__dirname,'../ocr-data');fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'labels.json'),JSON.stringify({order:['top-left','top-right','bottom-left','bottom-right'],matches},null,2));
 const Tesseract=dep('tesseract.js'),worker=await Tesseract.createWorker('eng',1,{cachePath:path.join(__dirname,'../.ocr-cache')});
 const results=[];
 try{for(const match of matches)for(const suffix of match.files){
  const file=`WhatsApp Image 2026-10-18 at 20.02.${suffix}.jpeg`,image=await loadImage(path.join(folder,file));
  const rows=await OCR.extract(worker,image,[],createCanvas);
  const fields=rows.flatMap(r=>r.players.map((p,i)=>({placement:r.placement,player:i,expected:match.kills[r.placement-1][i],actual:p.kills})));
  const result={match:match.id,split:match.split,file,layout:rows.layout,fields};results.push(result);
  console.log(JSON.stringify({file,panels:rows.length,correct:fields.filter(f=>f.actual===f.expected).length,wrong:fields.filter(f=>f.actual!==null&&f.actual!==f.expected),unresolved:fields.filter(f=>f.actual===null).length}));
 }}finally{await worker.terminate();}
 fs.writeFileSync(path.join(out,process.env.OCR_REPORT||'evaluation.json'),JSON.stringify(results,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});


