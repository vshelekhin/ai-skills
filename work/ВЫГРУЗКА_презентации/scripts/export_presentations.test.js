'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const X=require('./export_presentations.js');
const text=(id,value,x=0,y=0)=>({objectId:id,transform:{scaleX:1,scaleY:1,translateX:x,translateY:y,unit:'PT'},
  shape:{text:{textElements:[{textRun:{content:value+'\n'}}]}}});
const image=id=>({objectId:id,image:{contentUrl:'https://example.test/'+id}});
const deck=(id,day,slides)=>({presentationId:id,title:'День '+day,slides:slides.map((es,i)=>({objectId:id+'s'+i,pageElements:es}))});
const extract=(p,other={})=>X.extract(p,{language:'ru',...other});

test('nested groups, fragmented runs, tables, word art; notes and alt text excluded',()=>{
  const p=deck('a',1,[[{objectId:'g',elementGroup:{children:[text('t','Заголовок\nВторая строка'),
    {objectId:'g2',elementGroup:{children:[image('i')]}}]}},
    {objectId:'tb',table:{rows:2,tableRows:[{tableCells:[{text:{textElements:[{textRun:{content:'Кисть\n'}}]}},
      {text:{textElements:[{textRun:{content:'2\n'}}]}}]},{tableCells:[{text:{textElements:[{textRun:{content:'Бумага\n'}}]}},
      {text:{textElements:[{textRun:{content:'2\n'}}]}}]}]}},
    {objectId:'w',wordArt:{renderedText:'Рисование'}}]]);
  p.slides[0].slideProperties={notesPage:{pageElements:[text('secret','Не выгружать заметки')]}};
  p.notesMaster={pageElements:[text('secret2','Не выгружать master notes')]};
  p.slides[0].pageElements[0].title='Не выгружать alt';
  const e=extract(p);
  assert.equal(e.blocks.length,3); assert.equal(e.media.length,1);
  assert.equal(e.blocks[1].text,'Кисть\t2\nБумага\t2');
  assert(!JSON.stringify(e).includes('Не выгружать'));
});
test('text runs concatenate without inserting spaces and preserve inner newlines',()=>{
  const e=text('t','');e.shape.text.textElements=[{paragraphMarker:{}},{textRun:{content:'Заг'}},{textRun:{content:'оловок\n\nТекст\n'}}];
  assert.equal(extract(deck('a',1,[[e]])).blocks[0].text,'Заголовок\n\nТекст');
});
test('reading order composes nested transforms and converts EMU',()=>{
  const p=deck('a',1,[[text('last','Последний',0,200),
    {objectId:'g',transform:{scaleX:1,scaleY:1,translateY:1270000,unit:'EMU'},
      elementGroup:{children:[text('middle','Средний',0,5)]}},text('first','Первый',0,0)]]);
  const e=extract(p);const plan=X.buildPlan([e]);
  assert.deepEqual(plan.rows.map(r=>r.text),['День 1','Первый','Средний','Последний']);
});
test('money normalization preserves phone numbers and dates; ambiguous bare numbers reviewed',()=>{
  assert.equal(X.normaliseNumbers('Цена 7 990 ₽, 15\u00a0980 ₽, 1\u202f000\u202f000 ₽').text,'Цена 7990 ₽, 15980 ₽, 1000000 ₽');
  assert.equal(X.normaliseNumbers('+7 999 123 45 67; 2026 10 05; 1 2 3').text,'+7 999 123 45 67; 2026 10 05; 1 2 3');
  assert.deepEqual(X.normaliseNumbers('100 200').reviews,['100 200']);
  assert.equal(X.normaliseNumbers('Телефон: 8 800 555').text,'Телефон: 8 800 555');
});
test('unconfirmed day/language and incomplete responses fail',()=>{
  assert.throws(()=>X.extract(deck('a',1,[]),{}),/language/);
  assert.throws(()=>extract({...deck('a',1,[[text('x','a')]]),title:'Встреча'}),/day/);
  assert.throws(()=>extract({isError:true}),/Connector/);
  assert.throws(()=>extract({presentationId:'a',outline:[]}),/full native/);
  assert.throws(()=>extract(deck('a',1,[[{objectId:'g',elementGroup:{}}]])),/children/);
});
test('day inferred only from unambiguous explicit day marker',()=>{
  assert.equal(X.inferDay('Курс 2026'),null);assert.equal(X.inferDay('Day 2'),2);
  assert.equal(X.inferDay('День 1 и День 2'),null);
});
test('same text slides dedupe across days without losing images',()=>{
  const a=extract(deck('a',1,[[text('t','Полное название творческого марафона'),image('i')]]));
  const b=extract(deck('b',2,[[text('t','ПОЛНОЕ  НАЗВАНИЕ ТВОРЧЕСКОГО МАРАФОНА'),image('j')]]));
  const plan=X.buildPlan([b,a]);assert.equal(plan.duplicates.length,1);
  assert.equal(plan.media.length,2);assert.equal(plan.counts.mediaStatuses.pending,2);
  assert.equal(plan.complete,false);
});
test('partially changed slide keeps changed block; short context labels require a decision',()=>{
  const e=extract(deck('a',1,[[text('one','Очень длинный повторяющийся заголовок'),text('n1','3')],
    [text('two','Очень длинный повторяющийся заголовок'),text('n2','3'),text('new','Новое')]]));
  let p=X.buildPlan([e]);assert.equal(p.duplicates.length,1);assert.equal(p.review.length,1);
  const id=p.review[0].source;p=X.buildPlan([e],{duplicateDecisions:{[id]:'keep'}});
  assert.equal(p.review.length,0);assert.equal(p.rows.filter(r=>r.text==='3').length,2);
});
test('days sort across multi-day decks; source slide order retained within each day',()=>{
  const p=deck('a',1,[[text('a1','Первый')],[text('a2','Третий')]]);
  const a=extract(p,{slideDays:{as0:1,as1:3}}), b=extract(deck('b',2,[[text('b1','Второй')]]));
  assert.deepEqual(X.buildPlan([a,b]).rows.map(r=>r.text),['День 1','Первый','День 2','Второй','День 3','Третий']);
});
test('pending/blocked pictures prevent completion; reuse needs both file and OCR',()=>{
  const e=extract(deck('a',1,[[image('i')]]));const id=e.media[0].id;
  assert.throws(()=>X.decideMedia(e,id,{status:'reused',reason:'same',fileUrl:'file'}),/both/);
  X.decideMedia(e,id,{status:'blocked',reason:'no access'});assert.equal(X.buildPlan([e]).complete,false);
  X.decideMedia(e,id,{status:'reused',reason:'same image verified',fileUrl:'file',ocrRange:'Sheet!A5'});
  assert.equal(X.buildPlan([e]).complete,true);
});
test('included OCR preserves its own language, dedupes native text, requires visual verification',()=>{
  const e=extract(deck('a',1,[[text('t','Повторяющийся заголовок'),image('i')]]));const id=e.media[0].id;
  assert.throws(()=>X.decideMedia(e,id,{status:'included',reason:'text'}),/verified/);
  X.decideMedia(e,id,{status:'included',reason:'meaningful text',fileUrl:'file',ocrVerified:true,language:'en',blocks:['New English text']});
  const p=X.buildPlan([e]);assert.equal(p.rows.at(-1).column,'B');assert.equal(p.complete,true);
});
test('master/layout placeholders ignored; non-placeholder text needs placement/visibility decision',()=>{
  const p=deck('a',1,[[text('t','Основной текст')]]);p.slides[0].slideProperties={masterObjectId:'master'};
  const placeholder=text('ph','Click to edit title');placeholder.shape.placeholder={type:'TITLE'};
  p.masters=[{objectId:'master',pageElements:[placeholder,text('footer','Footer')]}];
  const e=extract(p);assert.equal(e.blocks.length,2);assert.equal(e.issues.length,1);
  X.resolveIssue(e,0,{reason:'Visible on slide'});X.placeInherited(e,e.blocks[1].id,'as0');
  const plan=X.buildPlan([e]);assert.equal(plan.complete,true);assert(plan.rows.some(r=>r.text==='Footer'));
});
test('backgrounds and chart images retained in visual checklist',()=>{
  const p=deck('a',1,[[{objectId:'c',sheetsChart:{contentUrl:'chart'}}]]);
  p.slides[0].pageProperties={pageBackgroundFill:{stretchedPictureFill:{contentUrl:'background'}}};
  assert.deepEqual(extract(p).media.map(m=>m.type),['chart','background']);
});
test('native issues can be resolved with corrected text',()=>{
  const e=extract(deck('a',1,[[text('t','7 990')]]));assert.equal(e.issues.length,1);
  X.resolveIssue(e,0,{reason:'This is a price',blockText:'7990'});
  assert.equal(X.buildPlan([e]).complete,true);assert.equal(e.blocks[0].text,'7990');
});
test('writes require complete reviewed plan and preserve opposite language column',()=>{
  const p=X.buildPlan([extract(deck('a',1,[[text('t','Текст')]]))]);
  assert.throws(()=>X.prepareWrite(p,{sheetId:7,before:[[],[]]}),/review/);
  const w=X.prepareWrite(p,{sheetId:7,before:[[],[]],reviewed:true});
  assert.equal(w.requests[0].updateCells.start.columnIndex,0);
  assert.equal(w.requests[0].updateCells.fields,'userEnteredValue');
  assert.equal(w.requests.at(-1).repeatCell.range.endColumnIndex,2);
  assert(X.verifyReadback(w,[['День 1'],['Текст']]).ok);
  assert(!X.verifyReadback(w,[['День 1'],['Текст','unexpected']]).ok);
  assert.throws(()=>X.prepareWrite(p,{sheetId:7,before:[[],['','translation']],reviewed:true}),/alignment/);
  assert.throws(()=>X.prepareWrite(p,{sheetId:7,before:[[],['other']],reviewed:true}),/different/);
});
test('idempotent rerun sends no value updates and does not rewrite translations',()=>{
  const p=X.buildPlan([extract(deck('a',1,[[text('t','Текст')]]))]);
  const before=[['День 1','Day 1'],['Текст','Text']];
  const w=X.prepareWrite(p,{sheetId:7,before,reviewed:true});
  assert(!w.requests.some(r=>r.updateCells));assert(X.verifyReadback(w,before).ok);
});
test('connector envelope and bounded output page supported',()=>{
  const p=deck('a',1,[[text('t','Текст')]]);
  assert.equal(extract({structuredContent:p}).blocks[0].text,'Текст');
  assert.equal(X.page([1,2,3],0,2).next,2);assert.throws(()=>X.page([],0,101),/bounded/);
});
test('old trailing rows and formulas cannot be silently overwritten',()=>{
  const p=X.buildPlan([extract(deck('a',1,[[text('t','Текст')]]))]);
  assert.throws(()=>X.prepareWrite(p,{sheetId:7,before:[[],[],['Old tail']],reviewed:true}),/trailing/);
  assert.throws(()=>X.prepareWrite(p,{sheetId:7,before:[[],['=A1']],reviewed:true}),/formula/);
});
test('day headers retained even when an entire later day duplicates native text',()=>{
  const a=extract(deck('a',1,[[text('a','DAY 1'),text('b','Общий текст')]]));
  const b=extract(deck('b',2,[[text('c','Общий текст')]]));
  const p=X.buildPlan([a,b],{duplicateDecisions:{[b.blocks[0].id]:'drop'}});
  assert.deepEqual(p.rows.map(r=>r.text),['День 1','Общий текст','День 2']);
});
test('same OCR on an image is not duplicated after native text',()=>{
  const e=extract(deck('a',1,[[text('t','Повторяющийся заголовок'),image('i')]]));
  X.decideMedia(e,e.media[0].id,{status:'included',reason:'text',fileUrl:'file',language:'ru',
    ocrVerified:true,blocks:['Повторяющийся заголовок','Уникальный текст']});
  const p=X.buildPlan([e]);assert.equal(p.rows.filter(r=>r.text==='Повторяющийся заголовок').length,1);
  assert(p.rows.some(r=>r.text==='Уникальный текст'));
});
test('rotated text requires a reading-order review',()=>{
  const t=text('t','Повернутый текст');t.transform={scaleX:0,scaleY:0,shearX:-1,shearY:1};
  const e=extract(deck('a',1,[[t]]));assert(e.issues.some(i=>i.code==='rotated_text_order'));
});
