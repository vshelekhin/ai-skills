/* Pure planning/verification, plus explicit local checkpoints. No cloud calls or OCR. */
var LandingExport = (() => {
  'use strict';
  const VERSION='1.0.0', ORDER=['long','short','sales'];
  const SHEETS={long:'ПОДПИСНАЯ ДЛИННАЯ',short:'ПОДПИСНАЯ КОРОТКАЯ',sales:'ПРОДАЖНИК'};
  const clone=x=>JSON.parse(JSON.stringify(x)), assert=(ok,message)=>{if(!ok)throw Error(message);};
  const nonempty=x=>typeof x==='string' && x.trim().length>0;
  const stamp=()=>new Date().toISOString();
  const sourceUrl=raw=>{assert(/^https?:\/\/[^\s/?#:@]+(?::\d+)?(?:[/?#]|$)/i.test(raw || ''),'Absolute source URL required');return raw.split('#')[0];};
  const entered=c=>c?.userEnteredValue || {};
  const value=c=>{const v=entered(c);return v.stringValue ?? v.numberValue ?? v.boolValue ?? v.formulaValue ?? '';};
  const signature=b=>JSON.stringify([b.text,b.type,b.annotations || []]);
  function newJob({spreadsheetId,pages}) {
    assert(nonempty(spreadsheetId) && Array.isArray(pages) && pages.length===3,'Current card and all three page roles required');
    assert(new Set(pages.map(p=>p.key)).size===3 && ORDER.every(k=>pages.some(p=>p.key===k)),'long, short and sales required');
    const result={schema:1,version:VERSION,spreadsheetId,pages:{},media:[],pending:{},createdAt:stamp()};
    for(const key of ORDER) {const p=pages.find(p=>p.key===key);assert(['ru','en'].includes(p.language),'Confirm ru/en for each page');result.pages[key]={...p,url:sourceUrl(p.url),captures:{},decisions:{},retainedOCR:[],reviewed:false,receipt:null};}
    return result;
  }
  function assetUrl(m) {
    if(nonempty(m.linkedUrl) && /\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#]|$)/i.test(m.linkedUrl))return m.linkedUrl;
    const cs=(m.candidates || []).filter(c=>/^https?:/i.test(c.url));
    for(const via of ['data-original','data-src','data-lazy-src']) {const c=cs.find(c=>c.via===via);if(c)return c.url;}
    const sizes=cs.filter(c=>c.descriptor).sort((a,b)=>parseFloat(b.descriptor)-parseFloat(a.descriptor));
    return sizes[0]?.url || cs.find(c=>c.via==='currentSrc')?.url || cs[0]?.url || '';
  }
  function addCapture(job,key,capture,{stateKey='base',redirectReviewed=false,reason=''}={}) {
    const p=job.pages[key];assert(p && capture.status==='captured' && capture.blocks?.length,'Missing/empty content is not a valid landing');
    assert(!capture.loginVisible,'Visible password/login requires checking before extraction');
    assert(sourceUrl(capture.url)===p.url || (redirectReviewed && nonempty(reason)),'Unreviewed redirect');
    for(const b of capture.blocks)assert(nonempty(b.anchor) && typeof b.text==='string' && Number.isFinite(b.domOrder),'Block provenance required');
    const other=Object.entries(p.captures).filter(([state])=>state!==stateKey).map(([,c])=>c);
    const oldBlocks=new Set(other.flatMap(c=>c.blocks).map(b=>b.anchor+'|'+signature(b)));
    const oldMedia=new Set(other.flatMap(c=>c.media || []).map(m=>JSON.stringify([m.anchor,assetUrl(m),m.candidates,m.category])));
    const stored=clone(capture);
    stored.observedBlocks=stored.blocks.length;stored.observedMedia=stored.media.length;
    stored.blocks=stored.blocks.filter(b=>!oldBlocks.has(b.anchor+'|'+signature(b)));
    stored.media=stored.media.filter(m=>!oldMedia.has(JSON.stringify([m.anchor,assetUrl(m),m.candidates,m.category])));
    p.captures[stateKey]=stored;p.reviewed=false;p.receipt=null;
    refreshMedia(job);
    return {blocks:capture.blocks.length,images:capture.media.length,review:capture.review};
  }
  function refreshMedia(job) {
    const old=job.media, media=[];
    for(const key of ORDER)for(const [state,c] of Object.entries(job.pages[key].captures))for(const m of c.media || []) {
      const url=assetUrl(m), groupKey=url || key+'|'+state+'|'+m.anchor;
      let found=media.find(x=>x.groupKey===groupKey);
      if(!found) {
        const previous=old.find(x=>x.groupKey===groupKey);
        found={id:previous?.id || 'image-'+(Math.max(-1,...old.map(x=>Number(x.id.split('-')[1])),...media.map(x=>Number(x.id.split('-')[1])))+1),groupKey,url,
          owner:key,category:m.category || 'candidate',occurrences:[],decision:previous?.decision || {status:'pending'}};media.push(found);
      }
      if(m.category==='review')found.category='review';
      found.occurrences.push({page:key,state,...clone(m)});
    }
    job.media=media;
  }
  function reviewPage(job,key,{reason}={}) {
    const p=job.pages[key];assert(p && Object.keys(p.captures).length && nonempty(reason),'Capture and review complete scroll, disclosures, forms/frames and tariffs');
    p.reviewed=true;p.reviewReason=reason;p.reviewedAt=stamp();
  }
  function decideBlock(job,key,id,decision) {
    const p=job.pages[key];assert(p && nonempty(decision.reason) && ['keep','drop'].includes(decision.action),'Reviewed keep/drop decision required');
    assert(Object.entries(p.captures).some(([state,c])=>c.blocks.some(b=>key+'|'+state+'|'+b.anchor===id)),'Unknown block');
    if(decision.text!==undefined)assert(typeof decision.text==='string','Replacement must remain literal text');
    p.decisions[id]=clone(decision);p.receipt=null;
  }
  function decideMedia(job,id,decision) {
    const m=job.media.find(m=>m.id===id);assert(m && nonempty(decision.reason),'Image and reason required');
    assert(['excluded','included','reused','blocked','needs_manual_check'].includes(decision.status),'Explicit image status required');
    if(m.category==='review' && decision.status==='excluded')assert(decision.reviewNotTextConfirmed===true,'Reviews with meaningful text must have both file and OCR');
    if(decision.status==='included') {
      assert(nonempty(decision.fileUrl) && nonempty(decision.fileName) && decision.fileVerified===true && decision.ocrVisualVerified===true,'Verify original file and OCR visually first');
      assert(['ru','en'].includes(decision.language) && Array.isArray(decision.blocks) && decision.blocks.length && decision.blocks.every(nonempty),'Literal OCR blocks and language required');
    }
    if(decision.status==='reused')assert(nonempty(decision.fileUrl) && nonempty(decision.ocrRange) && decision.fileVerified===true && decision.ocrVerified===true,'Verify existing file and OCR location');
    m.decision=clone(decision);job.pages[m.owner].receipt=null;
  }
  function retainOCR(job,key,record) {
    assert(job.pages[key] && nonempty(record.id) && nonempty(record.marker) && ['ru','en'].includes(record.language) && Array.isArray(record.blocks) && record.blocks.every(nonempty),'Preserved OCR block must include identity, marker, text and language');
    const p=job.pages[key],old=p.retainedOCR.findIndex(r=>r.id===record.id);
    if(old<0)p.retainedOCR.push(clone(record));else p.retainedOCR[old]=clone(record);
    p.receipt=null;
  }
  function nativeBlocks(job,key) {
    const p=job.pages[key], blocks=[],seen=new Set(),review=[];
    for(const [state,c] of Object.entries(p.captures))for(const raw of c.blocks) {
      const id=key+'|'+state+'|'+raw.anchor,decision=p.decisions[id];
      if(decision?.action==='drop')continue;
      const b={...clone(raw),id,text:decision?.text ?? raw.text,state};
      const occurrence=b.anchor+'|'+signature(b);
      if(seen.has(occurrence))continue;seen.add(occurrence);blocks.push(b);
    }
    blocks.sort((a,b)=>a.domOrder-b.domOrder);
    const groups=new Map();for(const b of blocks)if(b.technicalGroup){if(!groups.has(b.technicalGroup))groups.set(b.technicalGroup,[]);groups.get(b.technicalGroup).push(b);}
    const dropped=new Set(),known=new Map();
    for(const group of groups.values()) {
      const sig=JSON.stringify(group.map(signature));
      if(known.has(sig))for(const b of group)dropped.add(b.id);else known.set(sig,group);
    }
    for(const b of blocks)if(b.clone && !dropped.has(b.id)) {
      if(blocks.some(x=>!x.clone && signature(x)===signature(b)))dropped.add(b.id);
      else review.push({type:'orphan_clone',id:b.id});
    }
    const kept=blocks.filter(b=>!dropped.has(b.id));
    const repeated=new Map();for(const b of kept) {if(!repeated.has(b.text))repeated.set(b.text,[]);repeated.get(b.text).push(b);}
    for(const group of repeated.values())if(group.length>1 && (group[0].text.length>=40 || group.some(b=>b.tariff)))review.push({type:'contextual_repeat',ids:group.map(b=>b.id)});
    return {blocks:kept,review,automaticDuplicates:dropped.size};
  }
  function numbers(text,price=false,reviewed=false) {
    const ambiguities=[];
    const normalized=text.replace(/\b\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?\b/g,(match,offset)=>{
      const before=text.slice(Math.max(0,offset-12),offset),after=text.slice(offset+match.length,offset+match.length+12);
      const money=/(?:[$€₽£]|USD|EUR|RUB)\s*$/i.test(before) || /^\s*(?:[$€₽£]|руб(?:\.|ля|лей)?(?=\s|$|[.,!?;:)])|р\.?(?=\s|$|[.,!?;:)])|USD\b|EUR\b|RUB\b)/i.test(after);
      if(price || money)return match.replace(/[ \u00a0\u202f]/g,'');
      if(!reviewed)ambiguities.push({offset,text:match});return match;
    });
    return {text:normalized,ambiguities};
  }
  function buildPlan(job) {
    const plan={spreadsheetId:job.spreadsheetId,pages:{},issues:[],complete:true};
    for(const key of ORDER) {
      const p=job.pages[key],native=nativeBlocks(job,key),rows=[];
      if(!p.reviewed)plan.issues.push({page:key,type:'page_not_reviewed'});
      for(const b of native.blocks) {
        const normalized=key==='sales'?numbers(b.text,b.type==='price',p.decisions[b.id]?.numbersReviewed===true):{text:b.text,ambiguities:[]};
        if(normalized.ambiguities.length)plan.issues.push({page:key,type:'numbers',id:b.id,groups:normalized.ambiguities});
        rows.push({language:p.language,text:normalized.text,kind:'html',id:b.id,domOrder:b.domOrder});
      }
      for(const m of job.media.filter(m=>m.owner===key)) {
        const d=m.decision;
        if(!['excluded','included','reused'].includes(d.status)) {plan.issues.push({page:key,type:'image_'+d.status,id:m.id,category:m.category});continue;}
        if(d.status==='included') {
          const pos=m.occurrences.find(o=>o.page===key && !o.clone) || m.occurrences.find(o=>o.page===key);
          const order=d.afterBlockId?rows.find(r=>r.id===d.afterBlockId)?.domOrder:pos?.order;
          assert(Number.isFinite(order),'Image OCR placement must refer to a confirmed block');
          const textBlocks=['[ТЕКСТ НА ИЗОБРАЖЕНИИ — '+d.fileName+']',...d.blocks];
          textBlocks.forEach((text,i)=>rows.push({language:d.language,text:key==='sales'?numbers(text,false,true).text:text,kind:'ocr',id:m.id+'|'+i,mediaId:m.id,domOrder:order+.1+i*.0001}));
        }
      }
      for(const r of p.retainedOCR) {
        const matched=rows.find(x=>x.id===r.afterBlockId);
        const order=matched?.domOrder ?? r.domOrder;
        assert(Number.isFinite(order),'Preserved OCR needs confirmed placement');
        [r.marker,...r.blocks].forEach((text,i)=>rows.push({language:r.language,text,kind:'ocr',id:'retained|'+r.id+'|'+i,domOrder:order+.2+i*.0001}));
      }
      rows.sort((a,b)=>a.domOrder-b.domOrder);
      plan.pages[key]={key,sheetTitle:SHEETS[key],language:p.language,rows,review:native.review,automaticDuplicates:native.automaticDuplicates};
    }
    plan.complete=plan.issues.length===0;
    return plan;
  }
  function snapshot(sheet,rowCount) {
    assert(Number.isInteger(sheet?.properties?.sheetId) && Number.isInteger(rowCount) && rowCount>=2,'Metadata and A1:B bounded snapshot required');
    const cells=Array.from({length:rowCount},()=>[{},{}]);
    for(const data of sheet.data || [])for(let i=0;i<(data.rowData || []).length;i++)for(let j=0;j<(data.rowData[i].values || []).length;j++) {
      const row=(data.startRow || 0)+i,col=(data.startColumn || 0)+j;
      if(row<rowCount && col<2)cells[row][col]=clone(data.rowData[i].values[j]);
    }
    return {sheetId:sheet.properties.sheetId,sheetTitle:sheet.properties.title,cells,merges:clone(sheet.merges || []),gridProperties:clone(sheet.properties.gridProperties || {})};
  }
  function prepareWrite(job,plan,key,before,{reviewed=false}={}) {
    assert(reviewed && plan.spreadsheetId===job.spreadsheetId && plan.complete,'Review all three sources and resolve blocking items before clearing');
    assert(!Object.keys(job.pending).length,'Verify pending write before another plan');
    const page=plan.pages[key],col=page.language==='ru'?0:1,other=1-col;
    assert(before.sheetTitle===SHEETS[key] && Number.isInteger(before.sheetId),'Wrong target sheet');
    const n=before.cells.length;assert(n>=page.rows.length+1 && (before.gridProperties?.rowCount || 0)>=n && (before.gridProperties?.columnCount || 0)>=2,'Read whole old A:B range and enough rows for new content');
    assert(!(before.merges || []).some(m=>(m.startRowIndex || 0)<n && (m.endRowIndex ?? Infinity)>1 && (m.startColumnIndex || 0)<2 && (m.endColumnIndex ?? Infinity)>0),'Merged cells overlap target');
    const expected=clone(before.cells), requests=[], selectedRows=[];
    for(let i=1;i<n;i++) {
      const row=page.rows[i-1],sourceText=row?.language===page.language?row.text:'',old=before.cells[i] || [];
      assert(!entered(old[col]).formulaValue,'Source contains formula; reconcile before replacing');
      assert(!(old[col]?.textFormatRuns?.length) || value(old[col])===sourceText,'Styled source text changed; reconcile rich text before replacing');
      if(Object.keys(entered(old[other])).length)assert(value(old[col])===sourceText,'Would misalign existing translation or foreign OCR');
      expected[i][col]={...expected[i][col],userEnteredValue:sourceText?{stringValue:sourceText}:{}};
      selectedRows.push({values:[{...(sourceText?{userEnteredValue:{stringValue:sourceText}}:{}),textFormatRuns:clone(old[col]?.textFormatRuns || [])}]});
      if(row && row.language!==page.language) {
        assert(!entered(old[other]).formulaValue && (Object.keys(entered(old[other])).length===0 || value(old[other])===row.text),'Foreign-language OCR would overwrite existing translation');
        expected[i][other]={...expected[i][other],userEnteredValue:{stringValue:row.text}};
        if(value(old[other])!==row.text)requests.push({updateCells:{range:{sheetId:before.sheetId,startRowIndex:i,endRowIndex:i+1,startColumnIndex:other,endColumnIndex:other+1},rows:[{values:[{userEnteredValue:{stringValue:row.text}}]}],fields:'userEnteredValue'}});
      }
    }
    for(let c=0;c<2;c++)for(let i=1;i<n;i++)if(/^\[ТЕКСТ НА ИЗОБРАЖЕНИИ\s*[—-]/.test(String(value(before.cells[i]?.[c])))) {
      const marker=value(before.cells[i][c]);assert(expected.slice(1).filter(r=>value(r[c])===marker).length===1,'Existing OCR marker must survive exactly once');
      if(c===col) {
        const start=page.rows.findIndex(r=>r.kind==='ocr' && r.text===marker && (r.language==='ru'?0:1)===c);
        assert(start>=0,'Bind existing OCR to retainedOCR or verified image result before rebuilding');
        const group=page.rows[start].mediaId || page.rows[start].id.replace(/\|\d+$/,'');
        const sequence=[];for(let k=start;k<page.rows.length;k++) {const r=page.rows[k];if(r.kind!=='ocr' || (r.mediaId || r.id.replace(/\|\d+$/,''))!==group)break;sequence.push(r.text);}
        assert(sequence.every((text,k)=>value(before.cells[i+k]?.[c])===text),'Existing OCR text changed; reconcile it before clearing');
      }
    }
    requests.unshift({updateCells:{range:{sheetId:before.sheetId,startRowIndex:1,endRowIndex:n,startColumnIndex:col,endColumnIndex:col+1},rows:selectedRows,fields:'userEnteredValue,textFormatRuns'}});
    return {id:key+'|'+stamp(),spreadsheetId:job.spreadsheetId,key,before:clone(before),expected,requests,rowCount:page.rows.length,contentRows:clone(page.rows)};
  }
  function verifyReadback(prepared,after) {
    const errors=[];
    if(after.sheetId!==prepared.before.sheetId || after.sheetTitle!==prepared.before.sheetTitle || after.cells.length!==prepared.expected.length)return {ok:false,errors:[{type:'range_mismatch'}]};
    for(let i=0;i<prepared.expected.length;i++)for(let c=0;c<2;c++) {
      if(JSON.stringify(entered(after.cells[i]?.[c]))!==JSON.stringify(entered(prepared.expected[i]?.[c])))errors.push({type:i===0?'header_changed':'value_mismatch',row:i+1,column:c});
      for(const field of ['userEnteredFormat','note','dataValidation'])if(JSON.stringify(after.cells[i]?.[c]?.[field] || {})!==JSON.stringify(prepared.before.cells[i]?.[c]?.[field] || {}))errors.push({type:'metadata_changed',field,row:i+1,column:c});
      if(JSON.stringify(after.cells[i]?.[c]?.textFormatRuns || [])!==JSON.stringify(prepared.before.cells[i]?.[c]?.textFormatRuns || []))errors.push({type:'rich_text_changed',row:i+1,column:c});
    }
    return {ok:errors.length===0,errors};
  }
  function stageWrite(job,prepared) {
    assert(prepared.spreadsheetId===job.spreadsheetId && !Object.keys(job.pending).length,'Current project, one pending write only');job.pending[prepared.id]=clone(prepared);return prepared.id;
  }
  function confirmWrite(job,id,after) {
    const p=job.pending[id];assert(p,'Persist staged write before cloud mutation');
    assert(JSON.stringify(buildPlan(job).pages[p.key].rows)===JSON.stringify(p.contentRows),'Content changed while write was pending');
    const result=verifyReadback(p,after);if(result.ok){job.pages[p.key].receipt={sheetId:after.sheetId,rowCount:p.rowCount,verifiedAt:stamp()};delete job.pending[id];}return result;
  }
  function summary(job) {
    const plan=buildPlan(job),pages={};for(const key of ORDER){const p=plan.pages[key];pages[key]={rows:p.rows.length,automaticDuplicates:p.automaticDuplicates,reviewItems:p.review.length,reviewed:job.pages[key].reviewed,written:!!job.pages[key].receipt};}
    const statuses={};for(const m of job.media)statuses[m.decision.status]=(statuses[m.decision.status] || 0)+1;
    const reviews=job.media.filter(m=>m.category==='review');
    return {version:VERSION,pages,images:job.media.length,imageStatuses:statuses,reviews:{found:reviews.length,savedOrReused:reviews.filter(m=>['included','reused'].includes(m.decision.status)).length,excludedNoText:reviews.filter(m=>m.decision.status==='excluded').length,remaining:reviews.filter(m=>!['included','reused','excluded'].includes(m.decision.status)).length},issues:plan.issues.length,pendingWrites:Object.keys(job.pending).length,complete:plan.complete && Object.keys(job.pending).length===0 && ORDER.every(k=>job.pages[k].receipt)};
  }
  async function saveJob(path,job) {
    const fs=await import('node:fs'),p=await import('node:path'),crypto=await import('node:crypto');
    const abs=p.resolve(path),tmp=abs+'.'+crypto.randomUUID()+'.tmp';fs.mkdirSync(p.dirname(abs),{recursive:true});fs.writeFileSync(tmp,JSON.stringify(job,null,2),{encoding:'utf8',flag:'wx'});
    try{fs.renameSync(tmp,abs);}catch(e){fs.unlinkSync(tmp);throw e;}return {path:abs};
  }
  async function loadJob(path,{spreadsheetId}={}) {
    const fs=await import('node:fs'),job=JSON.parse(fs.readFileSync(path,'utf8'));assert(job.schema===1 && job.spreadsheetId===spreadsheetId,'Checkpoint belongs to another card/schema');return job;
  }
  return {VERSION,ORDER,SHEETS,newJob,assetUrl,addCapture,reviewPage,decideBlock,decideMedia,retainOCR,nativeBlocks,numbers,buildPlan,snapshot,prepareWrite,verifyReadback,stageWrite,confirmWrite,summary,saveJob,loadJob};
})();
export default LandingExport;
