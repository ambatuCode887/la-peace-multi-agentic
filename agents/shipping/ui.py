from __future__ import annotations

from fastapi.responses import HTMLResponse


def dashboard_page() -> HTMLResponse:
    return HTMLResponse(
        """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shipping Document Verification</title>
<style>
:root{font-family:Inter,Segoe UI,sans-serif;color:#182230;background:#f4f7f5}*{box-sizing:border-box}body{margin:0}.shell{max-width:1120px;margin:auto;padding:32px 20px}.eyebrow{color:#167c66;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px}.head{display:flex;justify-content:space-between;gap:20px;align-items:end;margin-bottom:28px}.head h1{font-size:clamp(30px,5vw,54px);line-height:1;margin:8px 0}.head p{color:#5f6d78;max-width:620px}.panel{background:white;border:1px solid #dce6e0;border-radius:12px;padding:22px;box-shadow:0 8px 24px #183c2b0d;margin-bottom:18px}.form{display:grid;grid-template-columns:1fr 1fr;gap:14px}.wide{grid-column:1/-1}label{display:grid;gap:7px;font-weight:700;font-size:13px}input,textarea{font:inherit;border:1px solid #cbd8d1;border-radius:8px;padding:11px}textarea{min-height:80px;resize:vertical}button{border:0;border-radius:8px;background:#167c66;color:white;font-weight:700;padding:12px 18px;cursor:pointer}button.secondary{background:#e7f1ed;color:#12614f}.status{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}.badge{border-radius:999px;padding:8px 12px;font-weight:800;font-size:13px}.OK{background:#dff5e9;color:#147044}.MISMATCH{background:#ffe5df;color:#ad3d27}.NEEDS_REVIEW{background:#fff2c9;color:#8a6500}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.card{border:1px solid #dce6e0;border-radius:9px;padding:15px}.card h3{margin-top:0}.field{display:grid;grid-template-columns:150px 1fr;gap:8px;padding:8px 0;border-bottom:1px solid #edf1ee}.field:last-child{border:0}.diff{background:#fff4f0}.muted{color:#687681}.error{color:#b42318;font-weight:700;white-space:pre-wrap}@media(max-width:700px){.head,.form,.grid{display:block}.panel{margin-bottom:14px}.form>*{margin-bottom:12px}.field{grid-template-columns:1fr}}
</style></head>
<body><main class="shell">
<header class="head"><div><div class="eyebrow">Operations desk</div><h1>Shipping document verification</h1><p>Upload an email and its SI/BL attachments. The verifier extracts, compares, and highlights what needs attention.</p></div></header>
<section class="panel"><form id="verify" class="form">
<label>Email ID<input name="email_id" required placeholder="email_new_001"></label>
<label>Sender<input name="sender" placeholder="docs@example.com"></label>
<label class="wide">Subject<input name="subject" required placeholder="TO CONFIRM DOCS"></label>
<label class="wide">Message<textarea name="body" placeholder="Please compare the SI and draft BL."></textarea></label>
<label class="wide">SI and BL attachments<input id="attachments" name="attachments" type="file" multiple required accept=".txt,.pdf,.docx,.xlsx"><small class="muted">Select both files at once, or add them in multiple selections.</small><div id="file-list" class="muted"></div></label>
<div class="wide"><button>Verify documents</button></div>
</form><div id="error" class="error"></div></section>
<section id="result" class="panel" hidden><div id="summary"></div><div id="documents" class="grid"></div><div id="correction" hidden><h3>Human correction</h3><button id="accept" class="secondary">Accept current result</button></div></section>
</main>
<script>
const form=document.querySelector('#verify'), result=document.querySelector('#result'), error=document.querySelector('#error'), fileInput=document.querySelector('#attachments'), fileList=document.querySelector('#file-list');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let selectedFiles=[];
fileInput.addEventListener('change',()=>{selectedFiles=[...selectedFiles,...fileInput.files];const unique=[];for(const file of selectedFiles){if(!unique.some(item=>item.name===file.name&&item.size===file.size))unique.push(file)}selectedFiles=unique;const transfer=new DataTransfer();selectedFiles.forEach(file=>transfer.items.add(file));fileInput.files=transfer.files;fileList.textContent=selectedFiles.length?selectedFiles.map(file=>file.name).join(' | '):'No attachments selected';});
function render(report){result.hidden=false; const status=report.status||'INFO'; document.querySelector('#summary').innerHTML=`<div class="eyebrow">${esc(report.email_id)} · ${esc(report.category)}</div><div class="status"><span class="badge ${esc(status)}">${esc(status)}</span>${report.review_reason?`<span class="badge NEEDS_REVIEW">${esc(report.review_reason)}</span>`:''}</div><p>${report.defect_fields?.length?`Fields needing attention: <strong>${report.defect_fields.map(esc).join(', ')}</strong>`:status==='OK'?'No mismatch detected.':report.message||''}</p>`; const docs=report.documents||{}; document.querySelector('#documents').innerHTML=Object.entries(docs).map(([kind,doc])=>`<div class="card"><h3>${esc(kind.toUpperCase())}</h3>${Object.entries(doc.fields||{}).map(([k,v])=>`<div class="field"><strong>${esc(k)}</strong><span>${esc(v)}</span></div>`).join('')}</div>`).join(''); document.querySelector('#correction').hidden=status!=='NEEDS_REVIEW'; window.current=report;}
form.addEventListener('submit',async e=>{e.preventDefault();error.textContent='';const data=new FormData(form);try{const r=await fetch('/verify',{method:'POST',body:data});const j=await r.json();if(!r.ok)throw Error(j.detail||'Upload failed');render(j.report)}catch(x){error.textContent=x.message}});
document.querySelector('#accept').addEventListener('click',async()=>{const r=window.current;const correction={category:r.category,status:r.status,review_reason:r.review_reason,has_defect:false,defect_fields:[]};const response=await fetch('/reviews/'+encodeURIComponent(r.email_id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(correction)});if(response.ok){document.querySelector('#correction').innerHTML='<p><strong>Correction saved.</strong></p>'}});
</script></body></html>"""
    )