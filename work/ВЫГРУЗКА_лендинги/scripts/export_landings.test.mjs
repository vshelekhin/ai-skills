import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import X from './export_landings.mjs';

const pages=X.ORDER.map(key=>({key,url:'https://fixture.example/'+key,language:'ru'}));
const b=(anchor,text,domOrder,extra={})=>({anchor,text,domOrder,type:'p',annotations:[],...extra});
const capture=(key,blocks,media=[])=>({status:'captured',url:'https://fixture.example/'+key,blocks,media,review:[]});
const c=text=>({userEnteredValue:{stringValue:text}});
function job(language='ru') {
  const j=X.newJob({spreadsheetId:'fixture',pages:pages.map(p=>({...p,language}))});
  for(const key of X.ORDER) {X.addCapture(j,key,capture(key,[b('a','Заголовок',1),b('b','Текст',2)]));X.reviewPage(j,key,{reason:'Full source reviewed'});}
  return j;
}
function before(key='long',count=5) {
  return {sheetId:7,sheetTitle:X.SHEETS[key],cells:[ [c('РУС'),c('EN')],...Array.from({length:count-1},()=>[{},{}]) ],merges:[],gridProperties:{rowCount:100,columnCount:5}};
}
function apply(prepared) {
  const a=structuredClone(prepared.before);
  for(const request of prepared.requests) {
    const r=request.updateCells;assert.ok(['userEnteredValue','userEnteredValue,textFormatRuns'].includes(r.fields));
    for(let i=r.range.startRowIndex;i<r.range.endRowIndex;i++)for(let col=r.range.startColumnIndex;col<r.range.endColumnIndex;col++) {
      const src=r.rows[i-r.range.startRowIndex]?.values[col-r.range.startColumnIndex];
      a.cells[i][col].userEnteredValue=structuredClone(src?.userEnteredValue || {});
      a.cells[i][col].textFormatRuns=structuredClone(r.fields.includes('textFormatRuns')?src?.textFormatRuns || []:[]);
    }
  }
  return a;
}
const media=(url,anchor='image',extra={})=>({anchor,order:2,category:'candidate',candidates:[{url,via:'data-src'}],...extra});
test('all three destinations and actual languages are required',()=>{
  assert.throws(()=>X.newJob({spreadsheetId:'x',pages:pages.slice(0,2)}));
  assert.throws(()=>X.newJob({spreadsheetId:'x',pages:pages.map(p=>({...p,language:'mixed'}))}));
});
test('dynamic captures retain new FAQ answers and do not copy common content again',()=>{
  const j=job();X.addCapture(j,'long',capture('long',[b('a','Заголовок',1),b('b','Текст',2),b('faq','Ответ на вопрос',3)]),{stateKey:'faq1'});
  assert.equal(j.pages.long.captures.faq1.blocks.length,1);
  assert.deepEqual(X.nativeBlocks(j,'long').blocks.map(b=>b.text),['Заголовок','Текст','Ответ на вопрос']);
});
test('exact adaptive containers and proven carousel clones are removed',()=>{
  const j=job();X.addCapture(j,'long',capture('long',[b('a','Первый блок',1,{technicalGroup:'desktop'}),b('b','Второй блок',2,{technicalGroup:'desktop'}),b('c','Первый блок',3,{technicalGroup:'mobile'}),b('d','Второй блок',4,{technicalGroup:'mobile'}),b('e','Текст карусели',5),b('f','Текст карусели',6,{clone:true})]));
  const n=X.nativeBlocks(j,'long');assert.equal(n.blocks.length,3);assert.equal(n.automaticDuplicates,3);
});
test('different tariff inclusion/strike states and unique prices survive repetition',()=>{
  const j=job();X.addCapture(j,'sales',capture('sales',[b('a','Проверка работ',1,{technicalGroup:'tariff1',tariff:'1',annotations:[{struck:true}]}),b('b','Проверка работ',2,{technicalGroup:'tariff2',tariff:'2',annotations:[]}),b('c','7 990 ₽',3,{type:'price'}),b('d','9 990 ₽',4,{type:'price'})]));X.reviewPage(j,'sales',{reason:'Tariffs compared'});
  const plan=X.buildPlan(j);assert.equal(plan.pages.sales.rows.length,4);assert.deepEqual(plan.pages.sales.rows.slice(2).map(r=>r.text),['7990 ₽','9990 ₽']);
});
test('ordinary same words in different contexts are preserved',()=>{
  const j=job();X.addCapture(j,'long',capture('long',[b('a','Записаться',1),b('b','Записаться',2)]));assert.equal(X.nativeBlocks(j,'long').blocks.length,2);
});
test('sales prices normalize spaces/NBSP/narrow NBSP, registration stays literal',()=>{
  for(const text of ['3 000 ₽','15\u00a0980 ₽','от 1\u202f495р','1 000 000 рублей'])assert.equal(X.numbers(text).ambiguities.length,0);
  assert.equal(X.numbers('от 1\u202f495р').text,'от 1495р');
  const j=job();X.addCapture(j,'long',capture('long',[b('a','3 000 ₽',1)]));X.reviewPage(j,'long',{reason:'Complete'});assert.equal(X.buildPlan(j).pages.long.rows[0].text,'3 000 ₽');
});
test('phone numbers and independent groups are never blindly joined',()=>{
  const text='Телефон +7 999 123 45 67, дата 01 02 2026';assert.equal(X.numbers(text).text,text);assert.ok(X.numbers(text).ambiguities.length);
  const j=job();X.addCapture(j,'sales',capture('sales',[b('phone',text,1)]));X.reviewPage(j,'sales',{reason:'Complete'});assert.equal(X.buildPlan(j).complete,false);
  const id=X.nativeBlocks(j,'sales').blocks[0].id;X.decideBlock(j,'sales',id,{action:'keep',numbersReviewed:true,reason:'Phone/date unchanged'});assert.equal(X.buildPlan(j).complete,true);
});
test('images dedupe once across pages, lazy sources and full originals take precedence',()=>{
  const j=job(),url='https://fixture.example/review.webp';for(const key of X.ORDER)X.addCapture(j,key,capture(key,[b('a','Text',1)],[media(url,'img')]));
  assert.equal(j.media.length,1);assert.equal(j.media[0].owner,'long');assert.equal(j.media[0].occurrences.length,3);
  assert.equal(X.assetUrl({...media(url),linkedUrl:'https://fixture.example/full.webp'}),'https://fixture.example/full.webp');
});
test('reviews cannot be silently excluded; pending file/OCR prevents clearing',()=>{
  const j=job();X.addCapture(j,'long',capture('long',[b('a','Text',1)],[media('https://fixture.example/review.webp','i',{category:'review'})]));X.reviewPage(j,'long',{reason:'Complete text'});
  assert.equal(X.summary(j).reviews.remaining,1);assert.throws(()=>X.prepareWrite(j,X.buildPlan(j),'long',before(),{reviewed:true}),/blocking/);
  assert.throws(()=>X.decideMedia(j,j.media[0].id,{status:'excluded',reason:'Skip'}),/Reviews/);
  assert.throws(()=>X.decideMedia(j,j.media[0].id,{status:'reused',reason:'Found file',fileUrl:'x'}),/existing/);
  X.decideMedia(j,j.media[0].id,{status:'excluded',reason:'Verified: arrow icon, no text',reviewNotTextConfirmed:true});assert.equal(X.summary(j).reviews.excludedNoText,1);
});
test('new image generates one marker and verified literal OCR on its first page',()=>{
  const j=job();X.addCapture(j,'long',capture('long',[b('a','Text',1)],[media('https://fixture.example/review.webp','i')]));X.reviewPage(j,'long',{reason:'Complete'});
  X.decideMedia(j,j.media[0].id,{status:'included',reason:'Review',fileUrl:'drive',fileName:'review.webp',fileVerified:true,ocrVisualVerified:true,language:'ru',blocks:['Первый отзыв','Строка 2']});
  const p=X.buildPlan(j);assert.equal(p.pages.long.rows.filter(r=>r.kind==='ocr').length,3);assert.equal(p.pages.short.rows.filter(r=>r.kind==='ocr').length,0);
});
test('existing OCR must retain marker AND full text during regeneration',()=>{
  const j=job(),a=before('long',7);a.cells[2][0]=c('[ТЕКСТ НА ИЗОБРАЖЕНИИ — old.png]');a.cells[3][0]=c('Старый отзыв');
  assert.throws(()=>X.prepareWrite(j,X.buildPlan(j),'long',a,{reviewed:true}),/OCR/);
  X.retainOCR(j,'long',{id:'old',marker:'[ТЕКСТ НА ИЗОБРАЖЕНИИ — old.png]',language:'ru',blocks:['Старый отзыв'],domOrder:3});
  assert.equal(X.verifyReadback(X.prepareWrite(j,X.buildPlan(j),'long',a,{reviewed:true}),apply(X.prepareWrite(j,X.buildPlan(j),'long',a,{reviewed:true}))).ok,true);
  j.pages.long.retainedOCR[0].blocks=['Новый другой текст'];assert.throws(()=>X.prepareWrite(j,X.buildPlan(j),'long',a,{reviewed:true}),/OCR text changed/);
});
test('writes preserve headers, formatting, notes, validations and untouched formulas; stale source tail clears',()=>{
  const j=job(),a=before();a.cells[1][0]=c('Заголовок');a.cells[1][1]={userEnteredValue:{formulaValue:'=A2'},userEnteredFormat:{textFormat:{bold:true}},note:'Keep',dataValidation:{strict:true}};a.cells[4][0]=c('Старый хвост');
  const p=X.prepareWrite(j,X.buildPlan(j),'long',a,{reviewed:true}),after=apply(p);
  assert.deepEqual(after.cells[0],a.cells[0]);assert.deepEqual(after.cells[1][1],a.cells[1][1]);assert.deepEqual(after.cells[4][0].userEnteredValue,{});assert.equal(X.verifyReadback(p,after).ok,true);
});
test('existing translations refuse shifted/new source, formula sources and merged targets fail',()=>{
  const j=job(),a=before();a.cells[1][0]=c('Other source');a.cells[1][1]=c('Existing translation');assert.throws(()=>X.prepareWrite(j,X.buildPlan(j),'long',a,{reviewed:true}),/misalign/);
  const f=before();f.cells[1][0]={userEnteredValue:{formulaValue:'=1'}};assert.throws(()=>X.prepareWrite(j,X.buildPlan(j),'long',f,{reviewed:true}),/formula/);
  const merged=before();merged.merges=[{startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:2}];assert.throws(()=>X.prepareWrite(j,X.buildPlan(j),'long',merged,{reviewed:true}),/Merged/);
});
test('unchanged rich text is preserved explicitly; changed styled source requires reconciliation',()=>{
  const j=job(),a=before();a.cells[1][0]={userEnteredValue:{stringValue:'Заголовок'},textFormatRuns:[{startIndex:0,format:{bold:true}}]};
  const p=X.prepareWrite(j,X.buildPlan(j),'long',a,{reviewed:true});assert.equal(X.verifyReadback(p,apply(p)).ok,true);
  a.cells[1][0].userEnteredValue.stringValue='Другая строка';assert.throws(()=>X.prepareWrite(j,X.buildPlan(j),'long',a,{reviewed:true}),/Styled source/);
});
test('EN native source writes B, foreign OCR writes only empty A cells with literal leading equals',()=>{
  const j=job('en');X.addCapture(j,'long',capture('long',[b('a','=literal',1)],[media('https://fixture.example/ru.png')]));X.reviewPage(j,'long',{reason:'Complete'});X.decideMedia(j,j.media[0].id,{status:'included',reason:'Russian card',fileUrl:'drive',fileName:'ru.png',fileVerified:true,ocrVisualVerified:true,language:'ru',blocks:['Русский OCR']});
  const p=X.prepareWrite(j,X.buildPlan(j),'long',before('long',8),{reviewed:true}),after=apply(p);
  assert.equal(after.cells[1][1].userEnteredValue.stringValue,'=literal');assert.ok(after.cells.some(r=>r[0].userEnteredValue?.stringValue==='Русский OCR'));assert.equal(X.verifyReadback(p,after).ok,true);
});
test('readback catches corruption and never confirms after header/style/translation damage',()=>{
  const j=job(),p=X.prepareWrite(j,X.buildPlan(j),'long',before(),{reviewed:true});X.stageWrite(j,p);
  const a=apply(p);a.cells[0][0]=c('Changed header');assert.equal(X.confirmWrite(j,p.id,a).ok,false);assert.equal(Object.keys(j.pending).length,1);
  const good=apply(p);assert.equal(X.confirmWrite(j,p.id,good).ok,true);assert.ok(j.pages.long.receipt);assert.equal(X.summary(j).complete,false);
});
test('changed source during pending write cannot be falsely confirmed',()=>{
  const j=job(),p=X.prepareWrite(j,X.buildPlan(j),'long',before(),{reviewed:true});X.stageWrite(j,p);X.addCapture(j,'long',capture('long',[b('a','Changed',1)]));assert.throws(()=>X.confirmWrite(j,p.id,apply(p)),/Content changed/);
});
test('source errors and incomplete three-page review prevent clearing',()=>{
  const j=job();assert.throws(()=>X.addCapture(j,'long',{status:'missing_content'}));j.pages.sales.reviewed=false;assert.throws(()=>X.prepareWrite(j,X.buildPlan(j),'long',before(),{reviewed:true}),/all three/);
});
test('checkpoint and CLI prepare/confirm work without model reading the large state',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'landing-export-test-'));
  try {
    const state=path.join(temp,'state.json'),input=path.join(temp,'before.json'),preparedPath=path.join(temp,'prepared.json'),afterPath=path.join(temp,'after.json');
    await X.saveJob(state,job());await fs.writeFile(input,JSON.stringify(before()));
    const cli=path.join(import.meta.dirname,'landing_cli.mjs');
    const r=spawnSync(process.execPath,[cli,'prepare',state,'long',input,preparedPath],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
    const prepared=JSON.parse(await fs.readFile(preparedPath,'utf8'));await fs.writeFile(afterPath,JSON.stringify(apply(prepared)));
    const confirmed=spawnSync(process.execPath,[cli,'confirm',state,prepared.id,afterPath],{encoding:'utf8'});assert.equal(confirmed.status,0,confirmed.stderr);
    assert.ok((await X.loadJob(state,{spreadsheetId:'fixture'})).pages.long.receipt);
    await assert.rejects(X.loadJob(state,{spreadsheetId:'wrong'}));
    const requests=spawnSync(process.execPath,[cli,'requests',preparedPath],{encoding:'utf8'});assert.equal(JSON.parse(requests.stdout).requests.length,prepared.requests.length);
  } finally {assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));assert.ok(path.basename(temp).startsWith('landing-export-test-'));await fs.rm(temp,{recursive:true});}
});
