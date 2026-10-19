// Fit numeral exemplars using training matches only; never fit held-out frames.
const fs=require('fs'),path=require('path');
const deps=process.env.OCR_NODE_MODULES||'C:/Users/Acer/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {createCanvas,loadImage}=require(path.join(deps,'@napi-rs/canvas'));
const OCR=require('../public/ocr.js'),Layout=require('../public/layout.js');
async function main(){
 const folder=process.argv[2]||'C:/Users/Acer/OneDrive/Desktop/photos of end ss';
 const baseline=require('../ocr-data/baseline.json'),templates=require('../ocr-data/reference-templates.json').map(t=>({...t}));
 const imageDir=path.join(__dirname,'../ocr-data/images');fs.mkdirSync(imageDir,{recursive:true});
 let added=0;
 for(const frame of baseline){
  const input=path.join(folder,frame.file);fs.copyFileSync(input,path.join(imageDir,frame.file));
  if(frame.split!=='train')continue;
  const image=await loadImage(input),canvas=createCanvas(1392,Math.round(image.height*1392/image.width));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  const layout=Layout.detect(canvas);
  if(layout.panels.length*4!==frame.fields.length)throw Error('Panel/label count mismatch: '+frame.file);
  for(let j=0;j<layout.panels.length;j++)for(let i=0;i<4;i++){
   const field=frame.fields[j*4+i],box=OCR.playerRegion(layout.panels[j],i).digits;
   const feature=OCR.digitFeature(OCR.prepare(canvas,box,'digits',createCanvas,1).canvas);
   if(feature){templates.push({label:field.expected,...feature});added++;}
  }
 }
 fs.writeFileSync(path.join(__dirname,'../public/digit-templates.js'),'// Numeral exemplars: original reference plus labeled training matches 1–3. Matches 4–5 excluded.\nglobalThis.WarDigitTemplates='+JSON.stringify(templates)+';\n');
 console.log(JSON.stringify({added,total:templates.length,labels:[...new Set(templates.map(t=>t.label))].sort((a,b)=>a-b)}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
