// Check exported score values and dimensions without writing organizer data.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const deps=process.env.OCR_NODE_MODULES||'C:/Users/Acer/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {createCanvas,Image}=require(path.join(deps,'@napi-rs/canvas'));
class LocalImage extends Image{set src(value){this.ready=new Promise((resolve,reject)=>{this.onload=resolve;this.onerror=reject;});super.src=fs.readFileSync(path.join(__dirname,'../public',value));}async decode(){await this.ready;return this;}}
(async()=>{
 const canvas=createCanvas(1,1),context=canvas.getContext('2d'),drawn=[];
 const original=context.fillText.bind(context);context.fillText=(value,...args)=>{drawn.push(String(value));return original(value,...args);};
 const sandbox={window:{},document:{fonts:{ready:Promise.resolve()}},Image:LocalImage,console};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/scoreboard.js'),'utf8'),sandbox);
 const rows=Array.from({length:12},(_,i)=>({name:'Team '+(i+1),place:12-i,kills:20-i,total:32-i*2,wins:i===0?1:0})),before=JSON.stringify(rows);
 await sandbox.window.WarScoreboard.render(canvas,rows,{date:'18/10/26',week:'03',match:'07',highlight:6});
 assert.equal(canvas.width,2364);assert.equal(canvas.height,1194);assert.equal(JSON.stringify(rows),before);
 for(const name of ['POS','TEAM NAME','MATCH','PLACE','FINISH','TOTAL','WINS'])assert.ok(drawn.includes(name),name);
 for(const row of rows){assert.ok(drawn.includes(row.name));assert.ok(drawn.includes(String(row.kills).padStart(2,'0')));assert.ok(drawn.includes(String(row.total).padStart(2,'0')));}
 fs.writeFileSync(path.join(__dirname,'../restored-scoreboard-preview.png'),canvas.toBuffer('image/png'));
 console.log('PASS: 12 teams, seven columns, numeric values, labels and 2364×1194 export dimensions preserved.');
})().catch(error=>{console.error(error);process.exitCode=1});

