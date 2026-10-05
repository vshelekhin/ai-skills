/* No network, credentials, translation or OCR. Cloud calls remain in connected tools. */
var GetCourseExport = (() => {
  'use strict';
  const VERSION = '1.0.0';
  const SHEETS = {course: 'КУРС ТЕКСТЫ', bonus: 'БОНУСЫ ТЕКСТЫ', media: 'МАТЕРИАЛЫ (картинки на перевод)'};
  const clone = x => JSON.parse(JSON.stringify(x));
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const stamp = () => new Date().toISOString();
  const nonempty = x => typeof x === 'string' && x.trim().length > 0;
  const fingerprint = value => {
    const s = JSON.stringify(value); let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return s.length + '-' + (h >>> 0).toString(16);
  };
  function identify(raw) {
    // Restricted source routes only. No URL global is available in functions.exec V8.
    const m = String(raw).match(/^(https?):\/\/([^\s/?#:@]+(?::\d+)?)(\/(?:pl\/)?teach\/control\/(lesson|stream)\/view(?:\/id\/(\d+))?\/?)(?:\?([^#]*))?(?:#.*)?$/i);
    assert(m, 'Not an absolute GetCourse lesson/training view URL');
    const decode = s => decodeURIComponent(s.replace(/\+/g, ' '));
    const params = (m[6] || '').split('&').filter(Boolean).map(s => {const at=s.indexOf('=');return at < 0 ? [decode(s),''] : [decode(s.slice(0,at)),decode(s.slice(at+1))];});
    const id = m[5] || params.find(([k]) => k === 'id')?.[1];
    assert(/^\d+$/.test(id || ''), 'Missing numeric lesson/training ID');
    const protocol = m[1].toLowerCase();
    const host = m[2].toLowerCase().replace(protocol === 'https' ? /:443$/ : /:80$/, '');
    const origin = protocol + '://' + host, type = m[4].toLowerCase();
    const key = origin + '/' + type + '/' + id;
    const extra = params.filter(([k]) => !['id', 'editMode'].includes(k) && !k.startsWith('utm_')).sort().map(([k,v]) => encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');
    return {key, pageKey: key + (extra ? '?' + extra : ''), type, origin, url:String(raw).split('#')[0]};
  }
  function newJob({spreadsheetId, language, roots}) {
    assert(nonempty(spreadsheetId) && ['ru', 'en'].includes(language), 'Current spreadsheetId and ru/en required');
    assert(Array.isArray(roots) && roots.length, 'Current GetCourse roots required');
    const seen = new Set();
    const normalized = roots.map(r => {
      assert(['course', 'bonus'].includes(r.kind), 'Root kind must be course or bonus');
      const u = identify(r.url); assert(u.type === 'stream', 'Root must be a training');
      const id = r.kind + '|' + u.key; assert(!seen.has(id), 'Duplicate root'); seen.add(id);
      return {...r, id, key: u.key, pageKey: u.pageKey};
    });
    return {schema: 1, version: VERSION, spreadsheetId, language, roots: normalized, listings: {}, records: {}, pending: {}, createdAt: stamp()};
  }
  function addListing(job, capture, {reviewed, reason} = {}) {
    assert(capture.status === 'captured' && reviewed === true && nonempty(reason), 'Review list boundaries, pagination and hidden entries first');
    const parent = identify(capture.url); assert(parent.type === 'stream', 'Listing is not a training');
    assert(job.roots.some(r => identify(r.url).origin === parent.origin), 'Training outside project schools');
    assert(!(capture.unlinked || []).some(e => e.status !== 'no_access' || !nonempty(e.reason)), 'Resolve unlinked entries or document no_access before sealing listing');
    const links = [], ignored = [];
    for (const link of capture.links || []) {
      let u;
      try { u = identify(link.url); } catch { ignored.push({url: link.url, reason: 'not_training_or_lesson'}); continue; }
      if (u.origin !== parent.origin) { ignored.push({url: link.url, reason: 'different_school'}); continue; }
      links.push({...u, title: link.title, visible: link.visible});
    }
    const pagination = (capture.pagination || []).map(l => {
      const u = identify(l.url); assert(u.key === parent.key, 'Pagination leaves training'); return u;
    });
    job.listings[parent.pageKey] = {url: capture.url, title: capture.title, links, pagination, unlinked:clone(capture.unlinked || []), reason, checkedAt: stamp()};
    return {links: links.length, pagination: pagination.length, ignored};
  }
  function inventory(job) {
    const lessons = [], issues = [], unavailable = [], trainings = new Set(), byId = new Map();
    for (const root of job.roots) {
      const visited = new Set();
      function walk(pageKey, path, active) {
        if (active.has(pageKey) || visited.has(pageKey)) return;
        visited.add(pageKey);
        const p = job.listings[pageKey];
        if (!p) { issues.push({type: 'unvisited_training', kind: root.kind, root: root.url, pageKey, path}); return; }
        if (p.status === 'no_access' || p.status === 'load_error') { issues.push({type:'training_'+p.status, kind:root.kind, pageKey, reason:p.reason}); return; }
        const nextPath = [...path, {title: p.title, url: p.url}];
        for (const entry of p.unlinked || []) unavailable.push({...entry, kind:root.kind, path:nextPath});
        trainings.add(root.kind + '|' + identify(p.url).key);
        const nextActive = new Set(active); nextActive.add(pageKey);
        for (const link of p.links) {
          if (link.type === 'stream') { walk(link.pageKey, nextPath, nextActive); continue; }
          const id = root.kind + '|' + link.key;
          const sourcePath = {root: root.url, path: nextPath};
          if (byId.has(id)) { const found = byId.get(id); if (!found.paths.some(p => JSON.stringify(p) === JSON.stringify(sourcePath))) found.paths.push(sourcePath); continue; }
          const lesson = {id, kind: root.kind, url: link.url, title: link.title, order: lessons.filter(l => l.kind === root.kind).length + 1, paths: [sourcePath]};
          lessons.push(lesson); byId.set(id, lesson);
        }
        for (const page of p.pagination) walk(page.pageKey, path, nextActive);
      }
      walk(root.pageKey, [], new Set());
    }
    return {lessons, issues, unavailable, trainings: [...trainings], ready: issues.every(e => e.type !== 'unvisited_training')};
  }
  function markTrainingError(job, url, status, reason) {
    const u = identify(url);
    assert(u.type === 'stream' && ['no_access','load_error'].includes(status) && nonempty(reason), 'Training error requires status and reason');
    assert(job.roots.some(r => r.pageKey === u.pageKey) || inventory(job).issues.some(i => i.pageKey === u.pageKey), 'Training must be in discovered project inventory');
    job.listings[u.pageKey] = {url, status, reason};
  }
  function putLesson(job, id, capture, {reviewed, reason} = {}) {
    const item = inventory(job).lessons.find(l => l.id === id); assert(item, 'Lesson absent from current inventory');
    assert(capture.status === 'captured', 'Cannot accept login, missing content or load error as lesson');
    assert(identify(capture.url).key === identify(item.url).key, 'Redirected to another lesson');
    assert(reviewed === true && nonempty(reason) && nonempty(capture.title), 'Review title, text, hidden blocks and frames first');
    assert(typeof capture.text === 'string', 'Lesson text required (empty is allowed after review)');
    const source = {title: capture.title, text: capture.text, media: capture.media || []};
    const old = job.records[id];
    // Exact comparison, not a short hash, determines whether old confirmations survive.
    const sameText = old?.source?.title === source.title && old?.source?.text === source.text;
    const sameMedia = JSON.stringify(old?.source?.media) === JSON.stringify(source.media);
    const media = source.media.map((m, i) => ({...m, id: id + '|image|' + i, decision: sameMedia ? clone(old.media[i].decision) : {status: 'pending'}}));
    job.records[id] = {id, source, media, reviewedAt: stamp(), reason, textReceipt: sameText ? old?.textReceipt || null : null,
      staleReceipt: !sameText && old?.textReceipt ? old.textReceipt : old?.staleReceipt || null, status: 'captured'};
    return {characters: source.text.length, images: media.length, textChanged: !!old && !sameText, mediaChanged: !!old && !sameMedia};
  }
  function markError(job, id, status, reason) {
    assert(['no_access', 'load_error'].includes(status) && nonempty(reason), 'Explicit error status/reason required');
    assert(inventory(job).lessons.some(l => l.id === id), 'Unknown lesson');
    job.records[id] = {...job.records[id], id, status, error: reason};
  }
  function decideMedia(job, lessonId, mediaId, decision) {
    const m = job.records[lessonId]?.media?.find(x => x.id === mediaId); assert(m, 'Unknown image');
    const allowed = ['pending', 'excluded', 'reused', 'saved', 'needs_manual_check', 'blocked'];
    assert(allowed.includes(decision.status) && nonempty(decision.reason), 'Image status and reason required');
    if (['reused', 'saved'].includes(decision.status)) {
      assert(nonempty(decision.fileUrl) && nonempty(decision.ocrRange), 'Both Drive file and existing OCR location required');
      assert(decision.fileVerified === true && decision.ocrVerified === true, 'Verify file and OCR readback first');
      if (decision.status === 'saved') assert(decision.sheetTitle === SHEETS.media, 'New OCR belongs only in materials sheet');
    }
    m.decision = clone(decision);
  }
  const entered = cell => cell?.userEnteredValue || {};
  const value = cell => {
    const v = entered(cell); return v.stringValue ?? v.numberValue ?? v.boolValue ?? v.formulaValue ?? '';
  };
  const matrix = (cells, n) => Array.from({length: n}, (_, i) => Array.from({length: 2}, (_, j) => clone(cells[i]?.[j] || {})));
  const rgb = cell => {
    const f = cell?.effectiveFormat || cell?.userEnteredFormat || {};
    return f.backgroundColorStyle?.rgbColor || f.backgroundColor || {};
  };
  const yellow = cell => {const c = rgb(cell);return (c.red || 0) > .95 && (c.green || 0) > .95 && (c.blue || 0) < .05;};
  function snapshot(sheet, startRow, rowCount) {
    assert(Number.isInteger(startRow) && startRow >= 1 && Number.isInteger(rowCount) && rowCount > 0, 'Invalid bounded snapshot range');
    assert(Number.isInteger(sheet?.properties?.sheetId), 'Sheet metadata required');
    const cells = matrix([], rowCount);
    for (const data of sheet.data || []) for (let i = 0; i < (data.rowData || []).length; i++) {
      const row = (data.startRow || 0) + i - (startRow - 1);
      if (row < 0 || row >= rowCount) continue;
      const values = data.rowData[i].values || [];
      for (let j = 0; j < values.length; j++) {const col = (data.startColumn || 0) + j; if (col < 2) cells[row][col] = clone(values[j]);}
    }
    return {sheetId: sheet.properties.sheetId, sheetTitle: sheet.properties.title, startRow, cells, merges: clone(sheet.merges || []), gridProperties: clone(sheet.properties.gridProperties || {})};
  }
  function prepareWrite(job, ids, before, {reviewed = false} = {}) {
    assert(reviewed && ids.length > 0 && new Set(ids).size === ids.length, 'Review destination and unique lesson IDs first');
    const inv = inventory(job); assert(inv.ready, 'Finish all nested listings before mass export');
    const lessons = ids.map(id => {const item = inv.lessons.find(l => l.id === id); assert(item, 'Unknown lesson'); return item;});
    const kind = lessons[0].kind;
    assert(lessons.every((l, i) => l.kind === kind && (!i || l.order > lessons[i-1].order)), 'Preserve lesson/source order');
    assert(before.sheetTitle === SHEETS[kind] && Number.isInteger(before.sheetId), 'Wrong destination sheet');
    assert(Number.isInteger(before.startRow) && before.startRow >= 2, 'Keep RU/EN header above data');
    const rowCount = ids.length * 2;
    assert(before.cells.length === rowCount, 'Read exactly the planned A:B range including blank cells');
    assert((before.gridProperties?.rowCount || 0) >= before.startRow + rowCount - 1, 'Insufficient sheet rows; prepare grid first');
    assert((before.gridProperties?.columnCount || 0) >= 2, 'A:B required');
    for (const merge of before.merges || []) assert(!((merge.startRowIndex || 0) < before.startRow - 1 + rowCount && (merge.endRowIndex ?? Infinity) > before.startRow - 1 && (merge.startColumnIndex || 0) < 2 && (merge.endColumnIndex ?? Infinity) > 0), 'Merged cells overlap destination');
    const col = job.language === 'ru' ? 0 : 1, other = 1 - col;
    const cells = matrix(before.cells, rowCount), requests = [], expected = [], placements = [];
    lessons.forEach((l, i) => {
      const r = job.records[l.id]; assert(r?.status === 'captured' && r.source, 'Uncaptured/failed lesson');
      const values = [r.source.title, r.source.text];
      const row = before.startRow + i * 2;
      const receipt = r.textReceipt || r.staleReceipt;
      if (receipt) assert(receipt.sheetId === before.sheetId && receipt.startRow === row && receipt.column === col, 'Saved placement differs; reconcile existing rows first');
      assert(!Object.values(job.pending).some(p => p.ids.includes(l.id)), 'Pending write: verify it before preparing another');
      for (const record of Object.values(job.records)) {
        if (record.id === l.id) continue;
        const p = record.textReceipt || record.staleReceipt;
        if (p?.sheetId === before.sheetId) assert(!(p.startRow < row + 2 && p.startRow + 2 > row), 'Another lesson owns these rows');
      }
      const exact = values.every((v, j) => !entered(cells[i*2+j][col]).formulaValue && value(cells[i*2+j][col]) === v);
      const empty = [0,1].every(j => Object.keys(entered(cells[i*2+j][col])).length === 0);
      assert(exact || empty, 'Existing source differs; review row mapping, do not overwrite automatically');
      assert(exact || [0,1].every(j => Object.keys(entered(cells[i*2+j][other])).length === 0), 'Would misalign an existing translation');
      requests.push({updateCells: {range: {sheetId: before.sheetId, startRowIndex: row-1, endRowIndex: row+1, startColumnIndex: col, endColumnIndex: col+1}, rows: values.map(v => ({values: [{userEnteredValue: {stringValue: v}}]})), fields: 'userEnteredValue'}});
      requests.push({repeatCell: {range: {sheetId: before.sheetId, startRowIndex: row-1, endRowIndex: row, startColumnIndex: 0, endColumnIndex: 2}, cell: {userEnteredFormat: {backgroundColorStyle: {rgbColor: {red:1,green:1,blue:0}}, textFormat: {bold:true}, horizontalAlignment: 'CENTER'}}, fields: 'userEnteredFormat.backgroundColorStyle,userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment'}});
      for (let c = 0; c < 2; c++) if (yellow(cells[i*2+1][c])) requests.push({repeatCell: {range: {sheetId: before.sheetId, startRowIndex: row, endRowIndex: row+1, startColumnIndex:c, endColumnIndex:c+1}, cell:{userEnteredFormat:{backgroundColorStyle:{rgbColor:{red:1,green:1,blue:1}}}}, fields:'userEnteredFormat.backgroundColorStyle'}});
      expected.push(...values); placements.push({id:l.id, sheetId:before.sheetId, startRow:row, column:col, title:values[0], text:values[1]});
    });
    const plan = {spreadsheetId:job.spreadsheetId, language:job.language, ids, before:clone(before), column:col, expected, placements, requests};
    plan.id = fingerprint([job.spreadsheetId, before.sheetId, before.startRow, expected]);
    return plan;
  }
  function verifyReadback(plan, after) {
    const errors = [];
    if (after.sheetId !== plan.before.sheetId || after.sheetTitle !== plan.before.sheetTitle || after.startRow !== plan.before.startRow || after.cells.length !== plan.expected.length) return {ok:false, errors:[{type:'range_mismatch'}]};
    for (let i = 0; i < plan.expected.length; i++) {
      const row = after.cells[i] || [], before = plan.before.cells[i] || [];
      if (entered(row[plan.column]).formulaValue || value(row[plan.column]) !== plan.expected[i]) errors.push({type:'source_mismatch', row:after.startRow+i});
      if (JSON.stringify(entered(row[1-plan.column])) !== JSON.stringify(entered(before[1-plan.column]))) errors.push({type:'translation_changed',row:after.startRow+i});
      for (let c = 0; c < 2; c++) {
        const f = row[c]?.effectiveFormat || row[c]?.userEnteredFormat || {};
        if (!(i % 2) && (!yellow(row[c]) || f.textFormat?.bold !== true || f.horizontalAlignment !== 'CENTER')) errors.push({type:'title_format',row:after.startRow+i,column:c});
        if (i % 2 && yellow(row[c])) errors.push({type:'body_yellow',row:after.startRow+i,column:c});
      }
    }
    return {ok: errors.length === 0, errors};
  }
  function stageWrite(job, plan) {
    assert(plan.spreadsheetId === job.spreadsheetId && plan.language === job.language, 'Plan belongs to another project/language');
    for (const p of Object.values(job.pending)) assert(!(p.before.sheetId === plan.before.sheetId && p.before.startRow < plan.before.startRow + plan.expected.length && p.before.startRow + p.expected.length > plan.before.startRow), 'Pending ranges overlap');
    assert(!job.pending[plan.id], 'Plan already staged'); job.pending[plan.id] = clone(plan);
    return plan.id;
  }
  function confirmWrite(job, planId, after) {
    const plan = job.pending[planId]; assert(plan, 'Stage and save the plan before cloud write');
    const result = verifyReadback(plan, after); if (!result.ok) return result;
    for (const p of plan.placements) {
      const r = job.records[p.id]; assert(r?.source?.title === p.title && r?.source?.text === p.text, 'Source changed while write was pending');
    }
    for (const p of plan.placements) {job.records[p.id].textReceipt = {...p, verifiedAt:stamp()};job.records[p.id].staleReceipt = null;}
    delete job.pending[planId]; return result;
  }
  function summary(job) {
    const inv = inventory(job), groups = {};
    for (const kind of ['course','bonus']) {
      const items = inv.lessons.filter(l => l.kind === kind);
      const unavailable = inv.unavailable.filter(e => e.kind === kind).length;
      groups[kind] = {found:items.length+unavailable, captured:0, textVerified:0, complete:0, no_access:unavailable, load_error:0, images:0, pendingImages:0, needs_manual_check:0};
      for (const item of items) {
        const r = job.records[item.id], g = groups[kind]; if (!r) continue;
        if (['no_access','load_error'].includes(r.status)) {g[r.status]++;continue;}
        g.captured++; if (r.textReceipt) g.textVerified++;
        const media = r.media || []; g.images += media.length;
        g.needs_manual_check += media.filter(m => m.decision.status === 'needs_manual_check').length;
        g.pendingImages += media.filter(m => !['excluded','reused','saved'].includes(m.decision.status)).length;
        if (r.textReceipt && media.every(m => ['excluded','reused','saved'].includes(m.decision.status))) g.complete++;
      }
    }
    return {version:VERSION, ...groups, trainingPages:Object.keys(job.listings).length, trainings:inv.trainings.length,
      unresolvedTrainings:inv.issues.length, pendingBatches:Object.keys(job.pending).length,
      complete:inv.issues.length === 0 && Object.keys(job.pending).length === 0 && Object.values(groups).every(g => g.found === g.complete)};
  }
  async function saveJob(path, job) {
    const fs = await import('node:fs'), p = await import('node:path');
    const abs = p.resolve(path); fs.mkdirSync(p.dirname(abs), {recursive:true});
    const tmp = abs + '.' + (await import('node:crypto')).randomUUID() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(job, null, 2), {encoding:'utf8', flag:'wx'});
    try { fs.renameSync(tmp, abs); } catch (error) { fs.unlinkSync(tmp); throw error; }
    return {path:abs, ...summary(job)};
  }
  async function loadJob(path, {spreadsheetId, language} = {}) {
    const fs = await import('node:fs');
    const job = JSON.parse(fs.readFileSync(path, 'utf8'));
    assert(job.schema === 1 && job.spreadsheetId === spreadsheetId && job.language === language, 'Checkpoint schema/project/language mismatch');
    return job;
  }
  return {VERSION, SHEETS, identify, newJob, addListing, inventory, putLesson, markError, markTrainingError, decideMedia, snapshot,
    prepareWrite, verifyReadback, stageWrite, confirmWrite, summary, saveJob, loadJob};
})();
export default GetCourseExport;
