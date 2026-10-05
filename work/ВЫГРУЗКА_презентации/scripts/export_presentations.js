/* Native Slides extraction. No network, filesystem, credentials, OCR or writes.
 * Load in functions.exec with new Function(source + ';return SlidesExport;')().
 * Node uses require() for offline tests. Source: Google Slides pages REST schema.
 */
var SlidesExport = (() => {
  'use strict';
  const VERSION = 1;
  const FIELDS = 'presentationId,title,revisionId,pageSize,slides(objectId,pageElements,pageProperties,slideProperties(layoutObjectId,masterObjectId)),layouts(objectId,pageElements,pageProperties),masters(objectId,pageElements,pageProperties)';
  const clone = value => JSON.parse(JSON.stringify(value));
  const key = text => String(text).normalize('NFC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
  const refKey = ref => JSON.stringify([ref.presentationId, ref.slideId, ref.elementId]);
  const identity = [1, 0, 0, 1, 0, 0];
  const pt = value => value?.unit === 'EMU' ? (value.magnitude || 0) / 12700 : (value?.magnitude || 0);
  function matrix(t) {
    if (!t) return identity;
    const factor = t.unit === 'EMU' ? 1 / 12700 : 1;
    return [t.scaleX ?? 0, t.shearY ?? 0, t.shearX ?? 0, t.scaleY ?? 0,
      (t.translateX || 0) * factor, (t.translateY || 0) * factor];
  }
  function multiply(a, b) {
    return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
      a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
      a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
  }
  function bounds(e, m) {
    const w = pt(e.size?.width), h = pt(e.size?.height);
    const points = [[0,0], [w,0], [0,h], [w,h]].map(([x,y]) =>
      [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]]);
    return {x:Math.min(...points.map(p=>p[0])), y:Math.min(...points.map(p=>p[1]))};
  }
  function unwrap(result) {
    if (result?.isError) throw new Error('Connector returned an error; extraction stopped.');
    let data = result?.structuredContent ?? result;
    if (data?.error) throw new Error('Connector returned an error; extraction stopped.');
    if (data?.presentation) data = data.presentation;
    if (!data?.presentationId && result?.content) {
      const block = result.content.find(b=>b.type === 'text' && b.text?.trim().startsWith('{'));
      if (block) data = JSON.parse(block.text);
    }
    if (!data?.presentationId || !Array.isArray(data.slides))
      throw new Error('A full native presentation with slides is required, not an outline.');
    return data;
  }
  function inferDay(title) {
    const days = [...String(title).matchAll(/(?:день|day)\s*(\d+)/giu)].map(m=>Number(m[1]));
    return days.length && new Set(days).size === 1 && days[0] > 0 ? days[0] : null;
  }
  function normaliseNumbers(text) {
    const reviews = [];
    const output = text.replace(/\+?\d+(?:[ \u00a0\u202f]+\d+)+(?:[.,]\d+)?/gu, (match, offset) => {
      const before = text.slice(Math.max(0, offset-32), offset);
      const after = text.slice(offset+match.length, offset+match.length+20);
      if (match.startsWith('+') || /(?:тел(?:ефон)?|phone|tel|whatsapp)\.?\s*:?\s*$/iu.test(before)) return match;
      if (!/^\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?$/u.test(match)) return match;
      const currency = /(?:[$€£₽]\s*|(?:цена|price|стоимость)\s*:?\s*)$/iu.test(before) ||
        /^\s*(?:[$€£₽]|руб\.?|р\.(?:\s|$)|USD\b|EUR\b|RUB\b|рубл)/iu.test(after);
      if (currency) return match.replace(/[ \u00a0\u202f]/gu, '');
      reviews.push(match); // Bare grouped digits may be a phone or independent numbers.
      return match;
    });
    return {text:output, reviews};
  }
  function nativeText(content) {
    let text = '', auto = false, bullets = false;
    for (const part of content?.textElements || []) {
      if (part.textRun) text += part.textRun.content || '';
      if (part.autoText) { text += part.autoText.content || ''; auto = true; }
      if (part.paragraphMarker?.bullet) bullets = true;
    }
    // Slides adds one terminal paragraph newline; keep all internal line breaks.
    return {text:text.replace(/\r\n?/g,'\n').replace(/\n$/, ''), auto, bullets};
  }
  function extract(result, options) {
    const p = unwrap(result);
    if (!['ru','en'].includes(options?.language)) throw new Error('Confirm language: ru or en.');
    const defaultDay = options.day ?? inferDay(p.title);
    const out = {version:VERSION, presentationId:p.presentationId, title:p.title || '',
      revisionId:p.revisionId || null, language:options.language, slides:[], blocks:[], media:[], issues:[]};
    const issue = (code, ref, detail) => out.issues.push({id:out.issues.length, code, ref, detail, resolved:false});
    function visit(elements, parent, base, inherited=false) {
      for (const e of elements || []) {
        if (!e.objectId) throw new Error('Missing element objectId; incomplete source.');
        const ref = {...base, elementId:e.objectId};
        const m = multiply(parent, matrix(e.transform));
        const position = bounds(e,m);
        if (e.elementGroup) {
          if (!Array.isArray(e.elementGroup.children)) throw new Error('Group children are missing.');
          visit(e.elementGroup.children, m, base, inherited);
          continue;
        }
        const addBlock = (raw, type, extra={}) => {
          if (!raw.trim()) return;
          const n = normaliseNumbers(raw);
          const b = {id:refKey(ref), ...ref, day:base.day, language:options.language,
            type, rawText:raw, text:n.text, position, inherited, ...extra};
          out.blocks.push(b);
          if(Math.abs(m[1])>0.00001 || Math.abs(m[2])>0.00001)
            issue('rotated_text_order',ref,'Check reading order for rotated/sheared text.');
          if (n.reviews.length) issue('ambiguous_numbers', ref, n.reviews);
          if (inherited) issue('inherited_text_visibility',ref,'Confirm visible text; ignore master/layout placeholders.');
        };
        if (e.shape) {
          if (inherited && e.shape.placeholder) continue;
          const t = nativeText(e.shape.text);
          addBlock(t.text,'shape');
          if (t.auto) issue('auto_text',ref,'Check rendered automatic text and slide numbers.');
          if (t.bullets && t.text.trim()) issue('list_markers',ref,'Check list markers generated outside text runs.');
        } else if (e.table) {
          const rows = e.table.tableRows;
          if (!Array.isArray(rows) || (e.table.rows != null && rows.length !== e.table.rows))
            throw new Error('Table rows are missing or incomplete.');
          const cells = rows.map((row,ri)=>(row.tableCells || []).map((cell,ci)=>({
            row:cell.location?.rowIndex ?? ri, column:cell.location?.columnIndex ?? ci,
            ...nativeText(cell.text)})));
          addBlock(cells.map(row=>row.map(c=>c.text).join('\t')).join('\n'),'table',{cells});
          if (cells.flat().some(c=>c.auto || c.bullets)) issue('table_markers',ref,'Check automatic text/list markers in table.');
        } else if (e.wordArt) {
          addBlock(e.wordArt.renderedText || '', 'wordArt');
        } else if (e.image || e.video || e.sheetsChart || e.speakerSpotlight) {
          const type = e.image ? 'image' : e.video ? 'video' : e.sheetsChart ? 'chart' : 'speakerSpotlight';
          out.media.push({id:refKey(ref), ...ref, day:base.day, type, position, inherited,
            contentUrl:e.image?.contentUrl || e.video?.thumbnailUrl || e.sheetsChart?.contentUrl || null,
            sourceUrl:e.image?.sourceUrl || null, status:'pending', decision:null});
        } else if (!e.line) issue('unsupported_element',ref,Object.keys(e));
      }
    }
    for (let i=0; i<p.slides.length; i++) {
      const s = p.slides[i];
      if (!s.objectId) throw new Error('Missing slide objectId.');
      const day = options.slideDays?.[s.objectId] ?? defaultDay;
      if (!Number.isInteger(day) || day<1) throw new Error('Confirm day for slide '+s.objectId);
      const base = {presentationId:p.presentationId, slideId:s.objectId, slideNumber:i+1, day};
      if (!Array.isArray(s.pageElements) && s.pageElements != null) throw new Error('Invalid pageElements.');
      visit(s.pageElements, identity, base);
      const bg = s.pageProperties?.pageBackgroundFill?.stretchedPictureFill;
      if (bg) out.media.push({id:refKey({...base,elementId:'@background'}),...base,elementId:'@background',
        type:'background',contentUrl:bg.contentUrl || null,status:'pending',decision:null});
      const local = out.blocks.filter(b=>b.slideId===s.objectId);
      for (const b of local) {
        const marker = b.text.trim().match(/^(?:день|day)\s+(\d+)\s*$/iu);
        if (marker && Number(marker[1])!==day) issue('day_marker_conflict',base,b.text);
      }
      local.sort((a,b)=>a.position.y-b.position.y || a.position.x-b.position.x);
      out.slides.push({...base, blockIds:local.map(b=>b.id),
        mediaIds:out.media.filter(m=>m.slideId===s.objectId).map(m=>m.id)});
    }
    // Inherited elements may be visible, but master placeholder text is not slide text.
    const usedPages = new Map();
    for (const s of p.slides) for (const id of [s.slideProperties?.layoutObjectId,s.slideProperties?.masterObjectId]) {
      if (id) usedPages.set(id,[...(usedPages.get(id)||[]),s.objectId]);
    }
    for (const page of [...(p.layouts||[]),...(p.masters||[])]) if (usedPages.has(page.objectId)) {
      const first = out.slides.find(s=>usedPages.get(page.objectId).includes(s.slideId));
      const base = {presentationId:p.presentationId, slideId:page.objectId, slideNumber:null,
        day:first.day, usedOnSlides:usedPages.get(page.objectId)};
      visit(page.pageElements, identity, base, true);
      const bg=page.pageProperties?.pageBackgroundFill?.stretchedPictureFill;
      if(bg) out.media.push({id:refKey({...base,elementId:'@background'}),...base,elementId:'@background',
        type:'background',inherited:true,contentUrl:bg.contentUrl||null,status:'pending',decision:null});
    }
    return out;
  }
  function resolveIssue(extraction, id, resolution) {
    const item=extraction.issues.find(x=>x.id===id);
    if (!item || !resolution?.reason) throw new Error('Issue and reviewed reason required.');
    if (resolution.blockText !== undefined) {
      const block=extraction.blocks.find(b=>b.id===refKey(item.ref));
      if (!block || typeof resolution.blockText!=='string') throw new Error('Unknown text block.');
      block.text=resolution.blockText;
    }
    if (resolution.excludeBlock) {
      const block=extraction.blocks.find(b=>b.id===refKey(item.ref));
      if (!block) throw new Error('Unknown text block.');
      block.excluded=true;
    }
    item.resolved=true; item.resolution=clone(resolution);
    return extraction;
  }
  function decideMedia(extraction, id, decision) {
    const media=extraction.media.find(m=>m.id===id);
    if (!media || !decision?.reason) throw new Error('Media id and decision reason required.');
    if (!['excluded','reused','included','blocked'].includes(decision.status)) throw new Error('Invalid media status.');
    if (decision.status==='reused' && (!decision.fileUrl || !decision.ocrRange))
      throw new Error('Reuse requires both an existing file and OCR location.');
    if (decision.status==='included' && (!decision.fileUrl || !decision.ocrVerified ||
        !['ru','en'].includes(decision.language) || !Array.isArray(decision.blocks) ||
        !decision.blocks.length || decision.blocks.some(t=>typeof t!=='string' || !t.trim())))
      throw new Error('Included image requires uploaded file, verified OCR blocks and language.');
    media.status=decision.status; media.decision=clone(decision);
    return extraction;
  }
  function placeInherited(extraction, id, slideId) {
    const item=extraction.blocks.find(b=>b.id===id) || extraction.media.find(m=>m.id===id);
    const slide=extraction.slides.find(s=>s.slideId===slideId);
    if(!item?.inherited || !slide) throw new Error('Inherited item and actual destination slide required.');
    item.originPageId=item.slideId;
    item.slideId=slideId; item.slideNumber=slide.slideNumber; item.day=slide.day; item.inherited=false;
    if(extraction.blocks.includes(item)) {
      slide.blockIds.push(item.id);
      const byId=new Map(extraction.blocks.map(b=>[b.id,b]));
      slide.blockIds.sort((a,b)=>byId.get(a).position.y-byId.get(b).position.y || byId.get(a).position.x-byId.get(b).position.x);
    }
    else slide.mediaIds.push(item.id);
    return extraction;
  }
  function buildPlan(extractions, options={}) {
    const decks=extractions.map((e,index)=>({e,index})).sort((a,b)=>
      Math.min(...a.e.slides.map(s=>s.day))-Math.min(...b.e.slides.map(s=>s.day)) || a.index-b.index).map(x=>x.e);
    if (!decks.length) throw new Error('No extractions.');
    if (new Set(decks.map(d=>d.presentationId)).size!==decks.length) throw new Error('Duplicate presentation ID.');
    const plan={version:VERSION, rows:[], duplicates:[], media:[], issues:[], review:[], counts:{}, complete:false};
    const seen=new Map(), seenSlides=new Map();
    let activeDay=null;
    function addDay(language,day) {
      if (activeDay!==day) {
        activeDay=day;
        plan.rows.push({text:language==='ru'?'День '+day:'Day '+day,language,column:language==='ru'?'A':'B',day,kind:'day'});
      }
    }
    function add(text,language,day,source,kind='text') {
      if (!text.trim()) return;
      addDay(language,day);
      plan.rows.push({text,language,column:language==='ru'?'A':'B',day,kind,source});
    }
    for (const e of decks) {
      plan.issues.push(...e.issues.filter(x=>!x.resolved).map(x=>({...x,presentationId:e.presentationId})));
      plan.media.push(...e.media);
    }
    const ordered=decks.flatMap((e,deckIndex)=>e.slides.map((s,slideIndex)=>({e,s,deckIndex,slideIndex})))
      .sort((a,b)=>a.s.day-b.s.day || a.deckIndex-b.deckIndex || a.slideIndex-b.slideIndex);
    for (const {e,s} of ordered) {
        addDay(e.language,s.day);
        const byId=new Map(e.blocks.map(b=>[b.id,b]));
        const blocks=s.blockIds.map(id=>byId.get(id)).filter(b=>b && !b.excluded && b.text.trim());
        const signature=JSON.stringify([e.language,...blocks.map(b=>key(b.text))]);
        const repeated=blocks.length && seenSlides.has(signature);
        if(blocks.length && !repeated) seenSlides.set(signature,{presentationId:e.presentationId,slideId:s.slideId});
        for (const b of blocks) {
          const dayLabel=b.text.trim().match(/^(?:день|day)\s+(\d+)\s*$/iu);
          if(dayLabel && Number(dayLabel[1])===s.day) {
            plan.duplicates.push({source:b.id,first:'day:'+s.day,reason:'day_header'});continue;
          }
          const textKey=e.language+'|'+key(b.text);
          const previous=seen.get(textKey);
          // Short repeated labels/numbers may carry different contextual meaning.
          const substantial=(b.text.match(/\p{L}/gu)||[]).length>=24 || b.type==='table';
          const decision=options.duplicateDecisions?.[b.id];
          if (previous && (repeated || substantial || decision==='drop') && decision!=='keep') {
            plan.duplicates.push({source:b.id,first:previous,reason:repeated?'same_native_slide':'same_block'});
            continue;
          }
          if(previous && !substantial && decision!=='keep' && decision!=='drop')
            plan.review.push({code:'short_repeat',source:b.id,first:previous,text:b.text});
          if(!previous) seen.set(textKey,b.id);
          add(b.text,b.language,b.day,{presentationId:b.presentationId,slideId:b.slideId,elementId:b.elementId});
        }
        // Text deduplication never removes the image checklist of a repeated slide.
        for (const m of e.media.filter(m=>m.slideId===s.slideId && m.status==='included')) {
          for (const text of m.decision.blocks) {
            const n=normaliseNumbers(text);
            if(n.reviews.length && !m.decision.numbersReviewed) plan.review.push({code:'ocr_numbers',source:m.id,text});
            const k=m.decision.language+'|'+key(n.text);
            if(seen.has(k)) {plan.duplicates.push({source:m.id,first:seen.get(k),reason:'same_ocr_block'});continue;}
            seen.set(k,m.id);
            add(n.text,m.decision.language,m.day,{mediaId:m.id,fileUrl:m.decision.fileUrl},'ocr');
          }
        }
    }
    for (const e of decks) {
      for (const b of e.blocks.filter(b=>b.inherited && !b.excluded))
        plan.review.push({code:'inherited_placement',source:b.id,text:b.text});
      for (const m of e.media.filter(m=>m.inherited && m.status==='included'))
        plan.review.push({code:'inherited_ocr_placement',source:m.id});
    }
    const statuses={};for(const m of plan.media) statuses[m.status]=(statuses[m.status]||0)+1;
    plan.counts={presentations:decks.length,slides:decks.reduce((n,e)=>n+e.slides.length,0),
      nativeBlocks:decks.reduce((n,e)=>n+e.blocks.length,0),rows:plan.rows.length,
      duplicates:plan.duplicates.length,media:plan.media.length,mediaStatuses:statuses,
      unresolvedIssues:plan.issues.length,reviewItems:plan.review.length};
    plan.complete=!plan.issues.length && !plan.review.length && !statuses.pending && !statuses.blocked;
    return plan;
  }
  function summary(plan) { return {...plan.counts,complete:plan.complete}; }
  function reviewGroups(plan) {
    const groups=new Map();
    for(const item of plan.review) {
      const k=JSON.stringify([item.code,item.text||'']);
      if(!groups.has(k)) groups.set(k,{code:item.code,text:item.text,sources:[]});
      groups.get(k).sources.push(item.source);
    }
    return [...groups.values()];
  }
  function page(items, offset=0, limit=20) {
    if (!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)
      throw new Error('Use a bounded page: offset>=0, limit=1..100.');
    return {total:items.length,offset,items:items.slice(offset,offset+limit),next:offset+limit<items.length?offset+limit:null};
  }
  function prepareWrite(plan, {sheetId,startRow=2,before,reviewed=false,batchSize=200}) {
    if(!reviewed || !plan.complete) throw new Error('Resolve media/issues and review the plan before preparing writes.');
    if(!Number.isInteger(sheetId)||sheetId<0||!Number.isInteger(startRow)||startRow<2)
      throw new Error('Fresh sheetId and one-based startRow>=2 required.');
    if(!Array.isArray(before)||before.length<plan.rows.length)
      throw new Error('Read and pad target A:B through the existing used range first.');
    if(before.slice(plan.rows.length).some(row=>(row||[]).some(v=>v!=='' && v!=null)))
      throw new Error('Existing trailing content requires alignment review; no automatic clearing.');
    if(!Number.isInteger(batchSize)||batchSize<1||batchSize>500) throw new Error('Invalid batchSize.');
    // First implementation writes only confirmed empty rows or an exact rerun.
    // Existing translations/source changes must use the skill alignment procedure.
    for(let i=0;i<plan.rows.length;i++) {
      const row=plan.rows[i],column=row.column==='A'?0:1, old=before[i]||[];
      const value=old[column]??'',other=old[1-column]??'';
      if(typeof value==='string' && value.startsWith('=')) throw new Error('Preserve existing formula at row '+(startRow+i));
      if(value!=='' && value!==row.text) throw new Error('Target contains different content at row '+(startRow+i));
      if(other!=='' && value!==row.text) throw new Error('Potential translation alignment change at row '+(startRow+i));
    }
    const requests=[];
    for(let i=0;i<plan.rows.length;) {
      const col=plan.rows[i].column,begin=i,column=col==='A'?0:1;
      if((before[i]?.[column]??'')===plan.rows[i].text) { i++; continue; }
      while(i<plan.rows.length && plan.rows[i].column===col && i-begin<batchSize &&
        (before[i]?.[column]??'')!==plan.rows[i].text)i++;
      requests.push({updateCells:{start:{sheetId,rowIndex:startRow-1+begin,columnIndex:col==='A'?0:1},
        rows:plan.rows.slice(begin,i).map(r=>({values:[{userEnteredValue:{stringValue:r.text}}]})),fields:'userEnteredValue'}});
    }
    for(let i=0;i<plan.rows.length;i++) if(plan.rows[i].kind==='day') requests.push({repeatCell:{
      range:{sheetId,startRowIndex:startRow-1+i,endRowIndex:startRow+i,startColumnIndex:0,endColumnIndex:2},
      cell:{userEnteredFormat:{backgroundColor:{red:1,green:1,blue:0}}},fields:'userEnteredFormat.backgroundColor'}});
    return {requests,startRow,sheetId,expected:plan.rows.map(r=>({column:r.column,text:r.text})),before:clone(before)};
  }
  function verifyReadback(prepared, after) {
    const mismatches=[];
    for(let i=0;i<prepared.expected.length;i++) {
      const e=prepared.expected[i],column=e.column==='A'?0:1,actual=after[i]||[];
      if((actual[column]??'')!==e.text) mismatches.push({row:prepared.startRow+i,column:e.column,reason:'written_value'});
      if((actual[1-column]??'')!==(prepared.before[i]?.[1-column]??''))
        mismatches.push({row:prepared.startRow+i,column:column===0?'B':'A',reason:'neighbour_changed'});
    }
    return {ok:!mismatches.length,checkedRows:prepared.expected.length,mismatches};
  }
  return {VERSION,FIELDS,unwrap,inferDay,normaliseNumbers,extract,resolveIssue,decideMedia,placeInherited,
    buildPlan,summary,reviewGroups,page,prepareWrite,verifyReadback};
})();
if (typeof module !== 'undefined' && module.exports) module.exports=SlidesExport;
