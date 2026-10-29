// Check exported score values and dimensions without writing organizer data.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const {dep,launchOptions}=require('./deps.cjs');
const {createCanvas,Image}=dep('@napi-rs/canvas');
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
 // A 70-character name (the longest a team may have) is shortened with an ellipsis, never drawn over MATCH/PLACE.
 const long=[{...rows[0],name:'FFK '+'VERYLONGTEAMNAME'.repeat(5).slice(0,66)},...rows.slice(1)];drawn.length=0;
 await sandbox.window.WarScoreboard.render(canvas,long,{date:'18/10/26',week:'03',match:'07',highlight:6});
 const shown=drawn.find(text=>text.startsWith('FFK VERYLONG'));assert.ok(shown&&shown.endsWith('…')&&shown.length<70,'long names are shortened: '+shown);
 // The preview goes to the ignored cache folder so running checks never changes tracked files.
 fs.mkdirSync(path.join(__dirname,'../.ocr-cache'),{recursive:true});
 fs.writeFileSync(path.join(__dirname,'../.ocr-cache/scoreboard-render-preview.png'),canvas.toBuffer('image/png'));
 console.log('PASS: 12 teams, seven columns, numeric values, labels, long-name ellipsis and 2364×1194 export dimensions preserved.');
})().catch(error=>{console.error(error);process.exitCode=1});

