import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {AccountId} from '../../../packages/domain/identity-contracts.ts';
import {accounts} from './account-runtime.ts';
import {students} from './student-runtime.ts';
import {repository} from './runtime.ts';
import {evidence} from './evidence-runtime.ts';
import {getStudentEvidence,postFailedFit,postEvidenceClaim,exchangeEvidenceClaim,getOperatorEvidence,decideEvidenceClaim,withdrawEvidenceClaim,postScopeEvidence} from './evidence-handlers.ts';
test('evidence HTTP enforces origin, identity, input scope, one-time sharing and fresh auth after held bodies',async()=>{
 const keys=['COMGROUND_MODE','COMGROUND_ORIGIN','COMGROUND_DB_PATH','COMGROUND_OUTBOX_KEY','COMGROUND_EMAIL_ENABLED','COMGROUND_AI_ENABLED','COMGROUND_TEST_FIXTURES','COMGROUND_SKIP_DEMO_SEED'];const previous=new Map(keys.map(key=>[key,process.env[key]]));
 const folder=mkdtempSync(join(tmpdir(),'comground-evidence-http-')),filename=join(folder,'test.sqlite'),origin='http://localhost:3116';
 Object.assign(process.env,{COMGROUND_MODE:'test',COMGROUND_ORIGIN:origin,COMGROUND_DB_PATH:filename,COMGROUND_OUTBOX_KEY:randomBytes(32).toString('base64'),COMGROUND_EMAIL_ENABLED:'0',COMGROUND_AI_ENABLED:'0',COMGROUND_TEST_FIXTURES:'1'});delete process.env.COMGROUND_SKIP_DEMO_SEED;
 let db:DatabaseSync|undefined;
 try{
  const identity=accounts(),store=students(),supply=repository();db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON');const at=new Date().toISOString();
  function createAccount(role:'STUDENT'|'OPERATOR'):AccountId{const id:AccountId=`account-${randomUUID()}`;db!.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?)').run(id,randomUUID()+'@example.invalid','synthetic-fixture',role,at,at,at,at);return id;}
  function session(owner:AccountId){const token=randomBytes(32).toString('base64url');db!.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?,?,?)').run(randomUUID(),createHash('sha256').update(token).digest('hex'),owner,at,at,new Date(Date.now()+3600000).toISOString(),at);return token;}
  const owner=createAccount('STUDENT'),other=createAccount('STUDENT'),operator=createAccount('OPERATOR');
  const input={expectedVersion:0,preferences:{schoolStage:'HIGH_SCHOOL',ageMin:18,ageMax:22,availableFrom:new Date(Date.now()-86400000).toISOString(),availableUntil:new Date(Date.now()+60*86400000).toISOString(),mode:'ANY',area:'',interests:['environment'],maxFee:0,hasTraining:false,hasGuardian:false,requiresSchoolCredit:false},goal:'EXPLORE',storageConsent:true,privacyConsent:{policyVersion:'adult-account-v1',adultConfirmed:true,personalization:false,aiExplanations:false}};
  store.saveProfile(owner,input);store.saveProfile(other,input);
  const item=supply.listPublic({}).data[0];assert.ok(item);const fit={opportunityId:item.id,occurrenceId:item.occurrenceId??'primary',reason:'WRONG_AGE'},claim={opportunityId:item.id,occurrenceId:item.occurrenceId??'primary',kind:'INTRODUCTION',sharingConsent:true};
  const ownerToken=session(owner),otherToken=session(other),opToken=session(operator);
  const req=(path:string,method='GET',body?:unknown,token?:string,requestOrigin=origin)=>new Request(origin+path,{method,headers:{host:'localhost:3116',origin:requestOrigin,'content-type':'application/json',...(token?{cookie:`comground_account=${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal((await getStudentEvidence(req('/api/student/evidence'))).status,401);
  assert.equal((await getOperatorEvidence(req('/api/admin/evidence','GET',undefined,ownerToken))).status,403);
  assert.equal((await postFailedFit(req('/api/student/evidence/failed-fit','POST',fit,ownerToken,'https://other.invalid'))).status,403);
  assert.equal((await postFailedFit(req('/api/student/evidence/failed-fit','POST',{...fit,owner:other},ownerToken))).status,422);
  assert.equal((await getStudentEvidence(req('/api/student/evidence?owner=other','GET',undefined,ownerToken))).status,400);
  const created=await postFailedFit(req('/api/student/evidence/failed-fit','POST',fit,ownerToken));assert.equal(created.status,201);assert.equal(created.headers.get('cache-control'),'no-store');
  assert.equal((await (await getStudentEvidence(req('/api/student/evidence','GET',undefined,otherToken))).json()).data.failedFits.length,0);
  const shared=await (await postEvidenceClaim(req('/api/student/evidence/claims','POST',claim,ownerToken))).json();assert.ok(shared.shareToken);
  assert.equal((await exchangeEvidenceClaim(req('/api/admin/evidence/claims/exchange','POST',{shareToken:shared.shareToken},ownerToken))).status,403);
  assert.equal((await exchangeEvidenceClaim(req('/api/admin/evidence/claims/exchange','POST',{shareToken:shared.shareToken},opToken))).status,200);
  assert.equal((await exchangeEvidenceClaim(req('/api/admin/evidence/claims/exchange','POST',{shareToken:shared.shareToken},opToken))).status,404);
  const queue=await (await getOperatorEvidence(req('/api/admin/evidence','GET',undefined,opToken))).text();for(const value of [owner,'@example.invalid','WRONG_AGE','preferences'])assert.equal(queue.includes(value),false);
  const record={expectedVersion:2,action:'RECORD',evidenceReference:'synthetic:http-test',validUntil:new Date(Date.now()+86400000).toISOString()};
  for(const scenario of [
   {actor:owner,path:'/api/student/evidence/failed-fit',method:'POST',body:fit,handle:postFailedFit},
   {actor:owner,path:'/api/student/evidence/claims',method:'POST',body:claim,handle:postEvidenceClaim},
   {actor:owner,path:`/api/student/evidence/claims/${shared.data.id}`,method:'PATCH',body:{expectedVersion:2},handle:(r:Request)=>withdrawEvidenceClaim(r,shared.data.id)},
   {actor:operator,path:'/api/admin/evidence/claims/exchange',method:'POST',body:{shareToken:shared.shareToken},handle:exchangeEvidenceClaim},
   {actor:operator,path:`/api/admin/evidence/claims/${shared.data.id}`,method:'PATCH',body:record,handle:(r:Request)=>decideEvidenceClaim(r,shared.data.id)},
   {actor:operator,path:'/api/admin/evidence/scope-records',method:'POST',body:{kind:'ORGANIZER_REVIEW',organizationId:item.organization.id,opportunityId:null,programId:null,evidenceReference:'synthetic:http',validUntil:new Date(Date.now()+86400000).toISOString()},handle:postScopeEvidence},
  ]){
   const token=session(scenario.actor);let controller!:ReadableStreamDefaultController<Uint8Array>,reading!:()=>void;const started=new Promise<void>(resolve=>{reading=resolve;});const body=new ReadableStream<Uint8Array>({start(value){controller=value;},pull(){reading();}},{highWaterMark:0});
   const held=new Request(origin+scenario.path,{method:scenario.method,headers:{host:'localhost:3116',origin,'content-type':'application/json',cookie:`comground_account=${token}`},body,duplex:'half'} as RequestInit);
   const before=evidence().overview(owner),pending=scenario.handle(held);await started;identity.logout(token);controller.enqueue(new TextEncoder().encode(JSON.stringify(scenario.body)));controller.close();assert.equal((await pending).status,401);assert.deepEqual(evidence().overview(owner),before);
  }
  assert.equal((await decideEvidenceClaim(req(`/api/admin/evidence/claims/${shared.data.id}`,'PATCH',record,opToken),shared.data.id)).status,200);
 }finally{
  db?.close();const state=globalThis as typeof globalThis&{comgroundEvidence?:{db:DatabaseSync};comgroundStudents?:{close:()=>void};comgroundAccountRepository?:{repository:{close:()=>void}};comgroundRepository?:{close:()=>void};comgroundFixtureEpoch?:Date};state.comgroundEvidence?.db.close();delete state.comgroundEvidence;state.comgroundStudents?.close();delete state.comgroundStudents;state.comgroundAccountRepository?.repository.close();delete state.comgroundAccountRepository;state.comgroundRepository?.close();delete state.comgroundRepository;delete state.comgroundFixtureEpoch;for(const[key,value]of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;}rmSync(folder,{recursive:true,force:true});
 }
});
