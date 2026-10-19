// Isolated UX fixture. Uses invented teams and in-memory matches, never war.sqlite3.
const http=require('http'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../public');
let state={teams:Array.from({length:24},(_,i)=>({id:'team-'+i,name:'FFK '+(i===0?'DEEPAK':i===1?'PRAGA':'SQUAD '+(i+1)),players:Array.from({length:4},(_,j)=>({id:`player-${i}-${j}`,name:`Player ${i+1}.${j+1}`}))})),matches:[]};
http.createServer((req,res)=>{
 const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(req.url==='/api/session')return reply(200,{authenticated:true});
 if(req.url==='/api/ocr/status')return reply(200,{available:false});
 if(req.url==='/api/state'){if(req.method==='GET')return reply(200,state);let body='';req.on('data',data=>body+=data);req.on('end',()=>{state=JSON.parse(body);reply(200,{ok:true});});return;}
 const target=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
 if(!target.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 fs.readFile(target,(error,data)=>{if(error){res.writeHead(404);return res.end();}res.setHeader('Content-Type',target.endsWith('.js')?'application/javascript':target.endsWith('.css')?'text/css':'text/html');res.end(data);});
}).listen(8091,'127.0.0.1',()=>console.log('Isolated UX preview: http://127.0.0.1:8091'));
