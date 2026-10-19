// Reuse supplied match imagery as a scene banner; no generated or replacement brand artwork.
const fs=require('fs'),path=require('path');
const deps=process.env.OCR_NODE_MODULES||'C:/Users/Acer/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {createCanvas,loadImage}=require(path.join(deps,'@napi-rs/canvas'));
(async()=>{const image=await loadImage(path.join(__dirname,'../ocr-data/images/WhatsApp Image 2026-10-18 at 20.02.30.jpeg'));const canvas=createCanvas(480,135);canvas.getContext('2d').drawImage(image,160,0,480,135,0,0,480,135);fs.writeFileSync(path.join(__dirname,'../public/assets/bermuda-scene.jpg'),canvas.toBuffer('image/jpeg',85));})();
