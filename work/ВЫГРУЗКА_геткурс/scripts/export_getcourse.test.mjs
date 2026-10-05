import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import X from './export_getcourse.mjs';

const root = 'https://school.example/teach/control/stream/view/id/1';
const stream = n => `https://school.example/teach/control/stream/view/id/${n}`;
const lesson = n => `https://school.example/teach/control/lesson/view/id/${n}`;
const link = (url, title='Урок') => ({url,title,visible:true});
const listing = (url, links=[], pagination=[]) => ({status:'captured',url,title:'Курс',links,pagination});
const reviewed = {reviewed:true, reason:'Checked source and destination in fixture'};
function job(language='ru',count=2) {
  const j = X.newJob({spreadsheetId:'fixture',language,roots:[{kind:'course',url:root}]});
  X.addListing(j,listing(root,Array.from({length:count},(_,i)=>link(lesson(i+10)))),reviewed);
  for (const l of X.inventory(j).lessons) X.putLesson(j,l.id,{status:'captured',url:l.url,title:'Урок '+l.order,text:'Повторный учебный текст\n\nВторая строка',media:[]},reviewed);
  return j;
}
const ids = j => X.inventory(j).lessons.map(l=>l.id);
const cell = s => ({userEnteredValue:{stringValue:s}});
function before(j, length=ids(j).length*2) {
  return {sheetId:7,sheetTitle:X.SHEETS.course,startRow:2,cells:Array.from({length},()=>[{},{}]),merges:[],gridProperties:{rowCount:100,columnCount:10}};
}
// Tiny Sheets request emulator: applies field masks, so tests catch damage to neighbours.
function apply(plan) {
  const a = structuredClone(plan.before);
  for (const req of plan.requests) {
    const r = req.updateCells || req.repeatCell, range=r.range;
    for(let row=range.startRowIndex;row<range.endRowIndex;row++) for(let col=range.startColumnIndex;col<range.endColumnIndex;col++) {
      const dest=a.cells[row-a.startRow+1][col];
      const src=req.updateCells ? r.rows[row-range.startRowIndex].values[col-range.startColumnIndex] : r.cell;
      for(const field of r.fields.split(',')) {
        const parts=field.split('.');let d=dest,s=src;
        for(const k of parts.slice(0,-1)) {d[k] ||= {};d=d[k];s=s[k];}
        d[parts.at(-1)]=structuredClone(s[parts.at(-1)]);
      }
    }
  }
  return a;
}
test('two GetCourse route styles identify the same lesson, schools stay separate',()=>{
  assert.equal(X.identify(lesson(10)).key,X.identify('https://school.example/pl/teach/control/lesson/view?id=10&editMode=0#x').key);
  assert.notEqual(X.identify(lesson(10)).key,X.identify(lesson(10).replace('school','other')).key);
  assert.throws(()=>X.identify('https://school.example/teach/control/lesson/update?id=10'));
});
test('nested bonuses, pagination, cycles and repeated links preserve teaching order',()=>{
  const j=X.newJob({spreadsheetId:'x',language:'ru',roots:[{kind:'bonus',url:root}]});
  X.addListing(j,listing(root,[link(stream(2)),link(stream(3))]),reviewed);
  assert.equal(X.inventory(j).issues.length,2);
  X.addListing(j,listing(stream(2),[link(lesson(10)),link(root),link(lesson(10))],[link(stream(2)+'?page=2')]),reviewed);
  X.addListing(j,listing(stream(2)+'?page=2',[link(lesson(11))]),reviewed);
  X.addListing(j,listing(stream(3),[link(lesson(12)),link(lesson(10))]),reviewed);
  assert.deepEqual(X.inventory(j).lessons.map(l=>X.identify(l.url).key),[10,11,12].map(n=>X.identify(lesson(n)).key));
  assert.equal(X.inventory(j).lessons[0].paths.length,2);
  assert.equal(X.inventory(j).ready,true);
});
test('same titles and text in distinct lessons never disappear',()=>{
  const j=job(); assert.equal(ids(j).length,2);
  assert.equal(X.prepareWrite(j,ids(j),before(j),reviewed).expected.length,4);
});
test('same lesson in course and bonus remains associated with each destination',()=>{
  const j=X.newJob({spreadsheetId:'x',language:'en',roots:[{kind:'course',url:root},{kind:'bonus',url:root}]});
  X.addListing(j,listing(root,[link(lesson(10))]),reviewed);
  assert.deepEqual(X.inventory(j).lessons.map(l=>l.kind),['course','bonus']);
});
test('unlinked lessons require an explicit explanation and count as unavailable',()=>{
  const j=job(), p=listing(root,[]);p.unlinked=[{title:'Locked',status:'needs_manual_check'}];
  assert.throws(()=>X.addListing(j,p,reviewed),/unlinked/);
  p.unlinked[0]={title:'Locked',status:'no_access',reason:'No authorized access'};
  X.addListing(j,p,reviewed);assert.equal(X.summary(j).course.no_access,1);assert.equal(X.summary(j).complete,false);
});
test('login and unexpected redirects cannot become lesson content',()=>{
  const j=job(); assert.throws(()=>X.putLesson(j,ids(j)[0],{status:'login_required'},reviewed),/login/);
  assert.throws(()=>X.putLesson(j,ids(j)[0],{status:'captured',url:lesson(99)},reviewed),/Redirected/);
});
test('unfinished nested inventory prevents mass write',()=>{
  const j=job();X.addListing(j,listing(root,[link(lesson(10)),link(stream(8))]),reviewed);
  assert.throws(()=>X.prepareWrite(j,[ids(j)[0]],before(j,2),reviewed),/nested/);
});
test('RU and EN write literal strings to the correct column, including leading equals',()=>{
  for(const language of ['ru','en']) {
    const j=job(language), target=language==='ru'?0:1;j.records[ids(j)[0]].source.text='=1+1';
    const p=X.prepareWrite(j,ids(j),before(j),reviewed),a=apply(p);
    assert.equal(a.cells[1][target].userEnteredValue.stringValue,'=1+1');
    assert.deepEqual(a.cells[1][1-target],{});
    assert.equal(X.verifyReadback(p,a).ok,true);
  }
});
test('conflicting text, formulas and translations are refused without destructive clearing',()=>{
  const j=job();
  for(const c of [cell('Different'),{userEnteredValue:{formulaValue:'=1'}}]) {
    const b=before(j);b.cells[0][0]=c;assert.throws(()=>X.prepareWrite(j,ids(j),b,reviewed),/differs/);
  }
  const b=before(j);b.cells[0][1]=cell('Existing translation');
  assert.throws(()=>X.prepareWrite(j,ids(j),b,reviewed),/translation/);
});
test('exact rerun preserves neighbour formulas and body formatting',()=>{
  const j=job(),p=X.prepareWrite(j,ids(j),before(j),reviewed),a=apply(p);
  a.cells[1][1]={userEnteredValue:{formulaValue:'=A2'},userEnteredFormat:{numberFormat:{type:'TEXT'},textFormat:{italic:true}}};
  const again=X.prepareWrite(j,ids(j),a,reviewed),result=apply(again);
  assert.deepEqual(result.cells[1][1],a.cells[1][1]);assert.equal(X.verifyReadback(again,result).ok,true);
  result.cells[1][1].userEnteredValue={stringValue:'=A2'};
  assert.equal(X.verifyReadback(again,result).errors[0].type,'translation_changed');
});
test('wrong destination, row order, range size and merged cells are rejected',()=>{
  const j=job();const b=before(j);b.sheetTitle=X.SHEETS.bonus;
  assert.throws(()=>X.prepareWrite(j,ids(j),b,reviewed),/destination/);
  assert.throws(()=>X.prepareWrite(j,ids(j).reverse(),before(j),reviewed),/order/);
  assert.throws(()=>X.prepareWrite(j,ids(j),before(j,2),reviewed),/exactly/);
  const merged=before(j);merged.merges=[{startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:2}];
  assert.throws(()=>X.prepareWrite(j,ids(j),merged,reviewed),/Merged/);
});
test('title formatting is required, body yellow is cleared without changing values',()=>{
  const j=job(),b=before(j);b.cells[1][1].userEnteredFormat={backgroundColor:{red:1,green:1}};
  const p=X.prepareWrite(j,ids(j),b,reviewed),a=apply(p);assert.equal(X.verifyReadback(p,a).ok,true);
  a.cells[0][0].userEnteredFormat.textFormat.bold=false;
  assert.equal(X.verifyReadback(p,a).errors[0].type,'title_format');
});
test('staging alone never marks text as verified, failures remain pending for resume',()=>{
  const j=job(),p=X.prepareWrite(j,ids(j),before(j),reviewed);X.stageWrite(j,p);
  assert.equal(X.summary(j).course.textVerified,0);
  const a=apply(p);a.cells[1][0]=cell('truncated');
  assert.equal(X.confirmWrite(j,p.id,a).ok,false);assert.equal(X.summary(j).pendingBatches,1);
  assert.throws(()=>X.prepareWrite(j,ids(j),before(j),reviewed),/Pending/);
  assert.equal(X.confirmWrite(j,p.id,apply(p)).ok,true);assert.equal(X.summary(j).pendingBatches,0);assert.equal(X.summary(j).complete,true);
});
test('source changes invalidate old text confirmation but keep known row placement',()=>{
  const j=job(),id=ids(j)[0],p=X.prepareWrite(j,ids(j),before(j),reviewed);X.stageWrite(j,p);X.confirmWrite(j,p.id,apply(p));
  X.putLesson(j,id,{status:'captured',url:lesson(10),title:'Урок 1',text:'New source',media:[]},reviewed);
  assert.equal(j.records[id].textReceipt,null);assert.equal(j.records[id].staleReceipt.startRow,2);
  assert.equal(X.summary(j).complete,false);
});
test('images stay pending after text confirmation, OCR cannot be silently skipped',()=>{
  const j=job(),id=ids(j)[0];X.putLesson(j,id,{status:'captured',url:lesson(10),title:'Урок 1',text:'Text',media:[{candidates:[{url:'https://school.example/image.png'}]}]},reviewed);
  const p=X.prepareWrite(j,ids(j),before(j),reviewed);X.stageWrite(j,p);X.confirmWrite(j,p.id,apply(p));
  assert.equal(X.summary(j).complete,false);const m=j.records[id].media[0].id;
  assert.throws(()=>X.decideMedia(j,id,m,{status:'reused',reason:'Same image',fileUrl:'drive'}),/Both/);
  X.decideMedia(j,id,m,{status:'needs_manual_check',reason:'Unreadable line'});assert.equal(X.summary(j).course.needs_manual_check,1);
  X.decideMedia(j,id,m,{status:'excluded',reason:'Decorative image after visual review'});assert.equal(X.summary(j).complete,true);
});
test('changed images reopen review without losing verified unchanged lesson text',()=>{
  const j=job(),id=ids(j)[0],p=X.prepareWrite(j,ids(j),before(j),reviewed);X.stageWrite(j,p);X.confirmWrite(j,p.id,apply(p));
  X.putLesson(j,id,{status:'captured',url:lesson(10),...j.records[id].source,media:[{candidates:[{url:'https://school.example/new.png'}]}]},reviewed);
  assert.ok(j.records[id].textReceipt);assert.equal(X.summary(j).complete,false);
});
test('inaccessible and failed lessons remain explicit and prevent a false completion',()=>{
  const j=job();X.markError(j,ids(j)[0],'no_access','Access denied');X.markError(j,ids(j)[1],'load_error','Two failed attempts');
  assert.equal(X.summary(j).course.no_access,1);assert.equal(X.summary(j).course.load_error,1);assert.equal(X.summary(j).complete,false);
});
test('blocked training is reported and does not prevent exporting accessible lessons',()=>{
  const j=job();X.addListing(j,listing(root,[link(lesson(10)),link(stream(8))]),reviewed);
  X.markTrainingError(j,stream(8),'no_access','Visible access denied page');
  assert.equal(X.inventory(j).ready,true);assert.equal(X.inventory(j).issues[0].type,'training_no_access');
  assert.equal(X.prepareWrite(j,ids(j),before(j),reviewed).placements.length,1);
  assert.equal(X.summary(j).complete,false);
});
test('bounded grid snapshot handles omitted blank cells and nonzero offsets',()=>{
  const s=X.snapshot({properties:{sheetId:7,title:'x'},data:[{startRow:4,startColumn:1,rowData:[{values:[cell('EN')]}]}]},5,2);
  assert.equal(s.cells[0][1].userEnteredValue.stringValue,'EN');assert.deepEqual(s.cells[1],[{},{}]);
});
test('checkpoint survives process restart, rejects a different project and is atomically replaceable',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'gc-export-test-'));
  try {
    const filename=path.join(temp,'state.json'),j=job(),p=X.prepareWrite(j,ids(j),before(j),reviewed);X.stageWrite(j,p);
    await X.saveJob(filename,j);const restored=await X.loadJob(filename,{spreadsheetId:'fixture',language:'ru'});
    assert.equal(X.confirmWrite(restored,p.id,apply(p)).ok,true);await X.saveJob(filename,restored);
    assert.equal(X.summary(await X.loadJob(filename,{spreadsheetId:'fixture',language:'ru'})).complete,true);
    await assert.rejects(X.loadJob(filename,{spreadsheetId:'wrong',language:'ru'}),/mismatch/);
  } finally {
    assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('gc-export-test-'));
    await fs.rm(temp,{recursive:true});
  }
});
