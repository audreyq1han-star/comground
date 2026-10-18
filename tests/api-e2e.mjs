import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const directory=await mkdtemp(join(tmpdir(),'comground-e2e-'));
const base='http://127.0.0.1:3101';
const token='synthetic-local-e2e-token';
const log=[];const checks=[];
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','apps/web','--webpack','--hostname','127.0.0.1','--port','3101'],{
 cwd:process.cwd(),env:{...process.env, COMGROUND_MODE: 'demo',LOCAL_REVIEW_TOKEN:token,COMGROUND_DB_PATH:join(directory,'test.sqlite'),NEXT_TELEMETRY_DISABLED:'1',COMGROUND_SKIP_DEMO_SEED:'1'},stdio:['ignore','pipe','pipe']
});
child.stdout.on('data',d=>log.push(d.toString()));child.stderr.on('data',d=>log.push(d.toString()));
let cookie='';
async function request(path,{method='GET',body,origin=base,auth=true,headers={}}={}){
 const response=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(method!=='GET'&&origin?{origin}:{}),...(auth&&cookie?{cookie}:{}),...headers},body:body?JSON.stringify(body):undefined});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data={raw:text.slice(0,200)};}
 return {response,status:response.status,data};
}
// Fetch may normalize the forbidden Host header. Use a raw HTTP request to prove
// the actual network boundary rejects a hostile Host value on the wire.
function requestWithHost(path,body,host){
 const serialized=JSON.stringify(body);
 return new Promise((resolve,reject)=>{
  const req=httpRequest(new URL(base+path),{method:'POST',headers:{host,origin:base,cookie,'content-type':'application/json','content-length':Buffer.byteLength(serialized)}},res=>{
   let text='';res.setEncoding('utf8');res.on('data',part=>text+=part);res.on('end',()=>{let data;try{data=JSON.parse(text);}catch{data={raw:text.slice(0,200)};}resolve({status:res.statusCode,data});});
  });
  req.on('error',reject);req.end(serialized);
 });
}
async function check(name,fn){await fn();checks.push({name,passed:true});console.log('PASS',name);}
try{
 let ready=false;
 for(let i=0;i<90;i++){try{const r=await request('/api/opportunities');if(r.status===200){ready=true;break;}}catch{}await delay(500);}
 assert.ok(ready,'local server became ready');
 await check('unauthenticated review access is rejected',async()=>assert.equal((await request('/api/admin/opportunities',{auth:false})).status,401));
 await check('cross-origin login is rejected',async()=>assert.equal((await request('/api/admin/session',{method:'POST',body:{token},origin:'https://untrusted.invalid',auth:false})).status,403));
 await check('missing-origin mutation is rejected',async()=>assert.equal((await request('/api/admin/session',{method:'POST',body:{token},origin:'',auth:false})).status,403));
 await check('ephemeral reviewer login succeeds with protected cookie',async()=>{
  const r=await request('/api/admin/session',{method:'POST',body:{token},auth:false});assert.equal(r.status,200,JSON.stringify(r.data));
  const cookies=r.response.headers.getSetCookie();assert.ok(cookies.some(c=>/HttpOnly/i.test(c)&&/SameSite=Strict/i.test(c)));
  cookie=cookies.map(c=>c.split(';')[0]).join('; ');assert.ok(cookie);
 });
 let opportunity;
 await check('fixture import creates one private draft',async()=>{
  const r=await request('/api/admin/imports',{method:'POST',body:{fixtureId:'garden'}});assert.ok([200,201].includes(r.status),JSON.stringify(r.data));
  opportunity=r.data.opportunity;assert.equal(opportunity.status,'DRAFT');assert.equal(r.data.created,true);
  assert.equal((await request('/api/opportunities')).data.data.length,0);
  assert.equal((await request('/api/opportunities/'+opportunity.id)).status,404);
 });
 await check('same fixture replay is idempotent',async()=>{
  const r=await request('/api/admin/imports',{method:'POST',body:{fixtureId:'garden'}});assert.ok([200,201].includes(r.status));
  assert.equal(r.data.created,false);assert.equal(r.data.opportunity.id,opportunity.id);opportunity=r.data.opportunity;
 });
 await check('reviewed publication exposes only safe public fields',async()=>{
  const r=await request('/api/admin/reviews',{method:'POST',body:{id:opportunity.id,expectedVersion:opportunity.version,decision:'PUBLISH',reason:'Synthetic fixture reviewed in local acceptance test'}});
  assert.equal(r.status,200,JSON.stringify(r.data));opportunity=r.data.data;assert.equal(opportunity.status,'PUBLISHED');
  const pub=await request('/api/opportunities');assert.equal(pub.data.data.length,1);
  const encoded=JSON.stringify(pub.data);for(const forbidden of ['permissionEvidence','reviewEvents','Synthetic fixture reviewed in local acceptance test'])assert.ok(!encoded.includes(forbidden));
 });
 const record=opportunity.record;
 const preferences={ageMin:16,ageMax:17,availableFrom:new Date(Date.parse(record.startsAt)-3600000).toISOString(),availableUntil:new Date(Date.parse(record.endsAt)+3600000).toISOString(),mode:'ANY',area:record.area,interests:record.interests,maxFee:100,hasTraining:true,hasGuardian:true,requiresSchoolCredit:false};
 await check('eligible preferences produce template explanations',async()=>{
  const r=await request('/api/matches',{method:'POST',body:preferences});assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.engine,'DETERMINISTIC_RULES');assert.ok(r.data.data.some(m=>m.opportunity.id===opportunity.id));assert.ok(r.data.data[0].reasons.length>0);
 });
 await check('under-age preferences cannot bypass the hard gate',async()=>{
  const r=await request('/api/matches',{method:'POST',body:{...preferences,ageMin:12,ageMax:13}});assert.equal(r.status,200);assert.equal(r.data.data.length,0);
 });
 for(const fixtureId of ['missing-age','expired','cancelled','no-permission']){
  await check(fixtureId+' remains unpublishable',async()=>{
   const r=await request('/api/admin/imports',{method:'POST',body:{fixtureId}});assert.ok([200,201].includes(r.status),JSON.stringify(r.data));const d=r.data.opportunity;
   const review=await request('/api/admin/reviews',{method:'POST',body:{id:d.id,expectedVersion:d.version,decision:'PUBLISH',reason:'Must fail validation'}});assert.equal(review.status,422,JSON.stringify(review.data));
   assert.equal((await request('/api/opportunities/'+d.id)).status,404);
  });
 }
 await check('material reimport suspends publication and stale reviews conflict',async()=>{
  const oldVersion=opportunity.version;
  const changed=await request('/api/admin/imports',{method:'POST',body:{fixtureId:'garden-changed'}});assert.ok([200,201].includes(changed.status));assert.equal(changed.data.opportunity.id,opportunity.id);assert.equal(changed.data.opportunity.status,'DRAFT');
  assert.equal((await request('/api/opportunities/'+opportunity.id)).status,404);
  const stale=await request('/api/admin/reviews',{method:'POST',body:{id:opportunity.id,expectedVersion:oldVersion,decision:'PUBLISH',reason:'Stale review must fail'}});assert.equal(stale.status,409,JSON.stringify(stale.data));
 });
 await check('malformed and unsafe mutations are rejected',async()=>{
  assert.equal((await request('/api/admin/imports',{method:'POST',body:{fixtureId:'https://private.invalid'}})).status,422);
  const r=await requestWithHost('/api/admin/reviews',{id:opportunity.id,expectedVersion:1,decision:'PUBLISH',reason:'x'},'evil.invalid');assert.ok([400,403].includes(r.status),`Host guard returned ${r.status}: ${JSON.stringify(r.data)}`);
 });
 await check('logout revokes reviewer access',async()=>{
  assert.equal((await request('/api/admin/session',{method:'DELETE'})).status,200);cookie='';assert.equal((await request('/api/admin/opportunities')).status,401);
 });
 await mkdir('docs/evidence',{recursive:true});await writeFile('docs/evidence/api-e2e.json',JSON.stringify({scope:'localhost synthetic fixture acceptance',checks},null,2)+'\n');
 console.log('Completed',checks.length,'HTTP acceptance checks.');
}catch(error){console.error(error);console.error(log.join('').slice(-6000));process.exitCode=1;}
finally{child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),delay(5000)]);await rm(directory,{recursive:true,force:true});}
