// Locate optional tool dependencies without machine-specific paths.
// Order: $OCR_NODE_MODULES (a node_modules folder), then normal resolution (npm install in the repo root
// or a global install via NODE_PATH).
const path=require('node:path');
function dep(name){
  const folder=process.env.OCR_NODE_MODULES;
  if(folder){try{return require(path.join(folder,name));}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}}
  try{return require(name);}
  catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;throw Error(`Missing "${name}". Run "npm install" in the repo root, or set OCR_NODE_MODULES to a node_modules folder that contains it.`);}
}
// Playwright launch options: CHROME_PATH or OCR_BROWSER_CHANNEL override the bundled Chromium.
function launchOptions(extra={}){
  const options={headless:true,...extra};
  if(process.env.CHROME_PATH)options.executablePath=process.env.CHROME_PATH;
  else if(process.env.OCR_BROWSER_CHANNEL)options.channel=process.env.OCR_BROWSER_CHANNEL;
  return options;
}
module.exports={dep,launchOptions};
