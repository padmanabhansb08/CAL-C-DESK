// One-page image PDF; no API, service, or browser print settings required.
function scoreboardPDF(canvas){
  const jpeg=Uint8Array.from(atob(canvas.toDataURL('image/jpeg',.97).split(',')[1]),c=>c.charCodeAt(0));
  const encoder=new TextEncoder(),parts=[],offsets=[0],pageHeight=1182*canvas.height/canvas.width;let length=0;
  const append=part=>{const bytes=typeof part==='string'?encoder.encode(part):part;parts.push(bytes);length+=bytes.length;};
  function object(id,body){offsets[id]=length;append(id+' 0 obj\n');append(body);append('\nendobj\n');}
  append('%PDF-1.4\n');
  object(1,'<< /Type /Catalog /Pages 2 0 R >>');
  object(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1182 '+pageHeight+'] /Resources << /XObject << /Scoreboard 4 0 R >> >> /Contents 5 0 R >>');
  offsets[4]=length;append('4 0 obj\n<< /Type /XObject /Subtype /Image /Width '+canvas.width+' /Height '+canvas.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpeg.length+' >>\nstream\n');append(jpeg);append('\nendstream\nendobj\n');
  const content='q\n1182 0 0 '+pageHeight+' 0 0 cm\n/Scoreboard Do\nQ\n';object(5,'<< /Length '+encoder.encode(content).length+' >>\nstream\n'+content+'endstream');
  const xref=length;append('xref\n0 6\n0000000000 65535 f \n');for(let i=1;i<=5;i++)append(String(offsets[i]).padStart(10,'0')+' 00000 n \n');append('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
  return new Blob(parts,{type:'application/pdf'});
}
function downloadPosterPDF(){const canvas=document.querySelector('#poster-canvas');if(!canvas||!canvas.width)return;const match=resultMatch(),url=URL.createObjectURL(scoreboardPDF(canvas)),link=document.createElement('a');link.href=url;link.download=(match?.name||'FFK').replace(/[^a-z0-9]/gi,'-')+'-scoreboard.pdf';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}

