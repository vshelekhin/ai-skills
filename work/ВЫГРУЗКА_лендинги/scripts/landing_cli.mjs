import X from './export_landings.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const [mode,statePath,...args]=process.argv.slice(2);
const read=async filename=>JSON.parse(await fs.readFile(filename,'utf8'));
async function write(filename,data) {
  const target=path.resolve(filename),temp=target+'.'+randomUUID()+'.tmp';
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.writeFile(temp,JSON.stringify(data,null,2),{encoding:'utf8',flag:'wx'});
  try{await fs.rename(temp,target);}catch(e){await fs.unlink(temp);throw e;}
}
try {
  const job=await read(statePath);
  if(mode==='summary')console.log(JSON.stringify(X.summary(job)));
  else if(mode==='plan') {const plan=X.buildPlan(job);await write(args[0],plan);console.log(JSON.stringify({complete:plan.complete,issues:plan.issues,pages:Object.fromEntries(X.ORDER.map(k=>[k,{rows:plan.pages[k].rows.length,review:plan.pages[k].review.length}]))}));}
  else if(mode==='prepare') {
    const [key,beforePath,outPath]=args,plan=X.buildPlan(job),before=await read(beforePath);
    const prepared=X.prepareWrite(job,plan,key,before,{reviewed:true});
    X.stageWrite(job,prepared);
    await write(outPath,prepared);await X.saveJob(statePath,job);
    console.log(JSON.stringify({id:prepared.id,page:key,rows:prepared.rowCount,requests:prepared.requests.length}));
  }
  else if(mode==='confirm') {
    const [id,afterPath]=args,result=X.confirmWrite(job,id,await read(afterPath));
    if(result.ok)await X.saveJob(statePath,job);
    console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
  }
  else if(mode==='requests') {
    // statePath is the prepared-plan path in this read-only mode.
    const offset=Number(args[0] || 0),limit=Number(args[1] || job.requests?.length);
    if(!Array.isArray(job.requests) || !Number.isInteger(offset) || offset<0 || !Number.isInteger(limit) || limit<1)throw Error('Prepared requests, offset and limit required');
    console.log(JSON.stringify({requests:job.requests.slice(offset,offset+limit),total:job.requests.length}));
  }
  else throw Error('Usage: summary <state> | plan <state> <out> | prepare <state> <page> <before> <out> | confirm <state> <id> <after> | requests <prepared> [offset] [limit]');
} catch(e) {console.error(e.message);process.exitCode=1;}
