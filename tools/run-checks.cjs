// Runs every check script and prints one line per script. Exit code 1 if any check fails.
//   node tools/run-checks.cjs                 logic + Python checks (fast, no browser)
//   CHECK_BROWSER=1 node tools/run-checks.cjs also runs the checks that drive a real browser
// Checks that need an optional dependency (rapidocr, playwright...) report SKIP instead of failing.
const {spawnSync}=require('node:child_process'),path=require('node:path');
const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3');
const logic=['check-comfort','check-graphs','check-overall','check-workspace','check-tournament','check-set-membership','check-ocr-batch','check-ocr-scan','check-ram-ocr'];
const browser=['check-comfort-forms','check-comfort-browser','check-ocr-learning','check-brand-render'];
const pythonChecks=['check-default-rosters','check-match-deletion','check-tournament-locks','check-security-policy','check-ops','check-ocr-reasoning','check-ocr-accuracy'];
const jobs=[...logic.map(n=>[n,'node',[path.join(__dirname,n+'.cjs')]]),...pythonChecks.map(n=>[n,python,[path.join(__dirname,n+'.py')]])];
if(process.env.CHECK_BROWSER)jobs.push(...browser.map(n=>[n,'node',[path.join(__dirname,n+'.cjs')]]));
let failed=0;
for(const [name,cmd,args] of jobs){
  const r=spawnSync(cmd,args,{encoding:'utf8',timeout:600000,cwd:path.resolve(__dirname,'..')});
  const out=(r.stdout||'')+(r.stderr||''),last=out.trim().split('\n').filter(l=>!/^127\.0\.0\.1 /.test(l)).pop()||'';
  const skipped=r.status===0&&/^SKIP/.test(last);
  console.log((r.status===0?(skipped?'SKIP':'PASS'):'FAIL')+'  '+name+(r.status===0?'':'\n'+out.split('\n').slice(-12).join('\n')));
  if(r.status!==0)failed++;
}
console.log(failed?`\n${failed} check(s) failed`:'\nAll checks passed');process.exit(failed?1:0);
