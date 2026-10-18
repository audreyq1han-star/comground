import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { accounts } from './account-runtime.ts';
import { getEvidenceMetrics } from './evidence-metrics-handlers.ts';

test('evidence metrics require a current operator session, reject query slicing and return only no-store aggregates',async()=>{
 const keys=['COMGROUND_MODE','COMGROUND_ORIGIN','COMGROUND_DB_PATH','COMGROUND_OUTBOX_KEY','COMGROUND_EMAIL_ENABLED','COMGROUND_AI_ENABLED','COMGROUND_TEST_FIXTURES','COMGROUND_SKIP_DEMO_SEED'],previous=new Map(keys.map(key=>[key,process.env[key]]));
 const folder=mkdtempSync(join(tmpdir(),'comground-evidence-metrics-')),filename=join(folder,'test.sqlite'),origin='http://localhost:3118';
 Object.assign(process.env,{COMGROUND_MODE:'test',COMGROUND_ORIGIN:origin,COMGROUND_DB_PATH:filename,COMGROUND_OUTBOX_KEY:randomBytes(32).toString('base64'),COMGROUND_EMAIL_ENABLED:'0',COMGROUND_AI_ENABLED:'0',COMGROUND_TEST_FIXTURES:'1'});delete process.env.COMGROUND_SKIP_DEMO_SEED;
 let db:DatabaseSync|undefined;
 try{
  const identity=accounts();db=new DatabaseSync(filename);const at=new Date().toISOString();
  function fixture(role:'STUDENT'|'OPERATOR'){
   const owner=`account-${randomUUID()}`,token=randomBytes(32).toString('base64url');db!.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?)').run(owner,`${randomUUID()}@example.invalid`,'synthetic-only',role,at,at,at,at);
   db!.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?,?,?)').run(randomUUID(),createHash('sha256').update(token).digest('hex'),owner,at,at,new Date(Date.now()+3600000).toISOString(),at);return {owner,token};
  }
  const student=fixture('STUDENT'),operator=fixture('OPERATOR');
  const req=(token?:string,query='')=>new Request(`${origin}/api/admin/evidence/summary${query}`,{headers:{host:'localhost:3118',...(token?{cookie:`comground_account=${token}`}:{})}});
  assert.equal(getEvidenceMetrics(req()).status,401);assert.equal(getEvidenceMetrics(req(student.token)).status,403);assert.equal(getEvidenceMetrics(req(operator.token,'?owner=private')).status,400);
  const result=getEvidenceMetrics(req(operator.token));assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');const payload=await result.json();assert.equal(payload.data.metrics,null);assert.equal(payload.data.studentIdentitiesIncluded,false);for(const value of [student.owner,operator.owner,'@example.invalid','preferences'])assert.equal(JSON.stringify(payload).includes(value),false);
  identity.logout(operator.token);assert.equal(getEvidenceMetrics(req(operator.token)).status,401);
 }finally{
  db?.close();const state=globalThis as typeof globalThis&{comgroundEvidence?:{db:DatabaseSync};comgroundStudents?:{close:()=>void};comgroundAccountRepository?:{repository:{close:()=>void}};comgroundRepository?:{close:()=>void};comgroundFixtureEpoch?:Date};state.comgroundEvidence?.db.close();delete state.comgroundEvidence;state.comgroundStudents?.close();delete state.comgroundStudents;state.comgroundAccountRepository?.repository.close();delete state.comgroundAccountRepository;state.comgroundRepository?.close();delete state.comgroundRepository;delete state.comgroundFixtureEpoch;
  for(const[key,value]of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;}rmSync(folder,{recursive:true,force:true});
 }
});
