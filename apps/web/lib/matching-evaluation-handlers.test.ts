import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSessionCookie} from './auth.ts';
import {getMatchingEvaluations,postMatchingEvaluation,getMatchingEvaluation,patchMatchingEvaluation,compareMatchingEvaluations} from './matching-evaluation-handlers.ts';
import {matchingEvaluations} from './matching-evaluation-runtime.ts';
const origin='http://127.0.0.1:3100';
function request(path:string,method='GET',body?:unknown,cookie?:string){return new Request(origin+path,{method,headers:{host:'127.0.0.1:3100',origin,...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
function reset(){const state=globalThis as typeof globalThis & {comgroundMatchingEvaluations?:ReturnType<typeof matchingEvaluations>};state.comgroundMatchingEvaluations?.close();delete state.comgroundMatchingEvaluations;}

test('evaluation HTTP enforces reviewer, origin, body allowlist, actor ownership and versioned decisions',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'eval-http-'));const original={...process.env};process.env.COMGROUND_MODE='demo';process.env.COMGROUND_DB_PATH=join(dir,'test.sqlite');process.env.LOCAL_REVIEW_TOKEN='synthetic-evaluation-review-token';delete process.env.COMGROUND_ORIGIN;reset();
 try{
  assert.equal((await getMatchingEvaluations(request('/api/admin/matching-evaluations'))).status,401);
  const cookie=createSessionCookie(request('/api/admin/session')).split(';')[0];
  assert.equal((await postMatchingEvaluation(request('/api/admin/matching-evaluations','POST',{actor:'forged'},cookie))).status,422);
  const created=await postMatchingEvaluation(request('/api/admin/matching-evaluations','POST',{},cookie));assert.equal(created.status,201);assert.equal(created.headers.get('cache-control'),'no-store');const run=(await created.json()).data;
  assert.equal(run.createdBy,'demo-reviewer');assert.equal(run.studentDataIncluded,false);assert.equal(run.failed,0);
  assert.equal((await getMatchingEvaluation(request(`/api/admin/matching-evaluations/${run.id}`),run.id)).status,401);
  assert.equal((await getMatchingEvaluations(request('/api/admin/matching-evaluations?owner=forged','GET',undefined,cookie))).status,400);
  const body={expectedVersion:1,decision:'APPROVE',reason:'Inspected synthetic cases'};
  const wrongOrigin=request(`/api/admin/matching-evaluations/${run.id}`,'PATCH',body,cookie);wrongOrigin.headers.set('origin','https://untrusted.invalid');assert.equal((await patchMatchingEvaluation(wrongOrigin,run.id)).status,403);
  const approved=await patchMatchingEvaluation(request(`/api/admin/matching-evaluations/${run.id}`,'PATCH',body,cookie),run.id);assert.equal(approved.status,200);assert.equal((await approved.json()).data.decisions[0].actor,'demo-reviewer');
  assert.equal((await patchMatchingEvaluation(request(`/api/admin/matching-evaluations/${run.id}`,'PATCH',body,cookie),run.id)).status,409);
  const next=(await (await postMatchingEvaluation(request('/api/admin/matching-evaluations','POST',{},cookie))).json()).data;
  const comparison=await compareMatchingEvaluations(request(`/api/admin/matching-evaluations/compare?before=${run.id}&after=${next.id}`,'GET',undefined,cookie));assert.equal(comparison.status,200);assert.deepEqual((await comparison.json()).data.regressions,[]);
  assert.equal((await compareMatchingEvaluations(request(`/api/admin/matching-evaluations/compare?before=${run.id}&before=${run.id}&after=${next.id}`,'GET',undefined,cookie))).status,400);
 }finally{reset();for(const key of ['COMGROUND_MODE','COMGROUND_DB_PATH','LOCAL_REVIEW_TOKEN','COMGROUND_ORIGIN']){if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];}rmSync(dir,{recursive:true,force:true});}
});

test('reviewer invalidation while mutation body arrives prevents evaluation write',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'eval-revoke-'));const original={...process.env};process.env.COMGROUND_MODE='demo';process.env.COMGROUND_DB_PATH=join(dir,'test.sqlite');process.env.LOCAL_REVIEW_TOKEN='synthetic-evaluation-review-token';delete process.env.COMGROUND_ORIGIN;reset();
 try{
  const cookie=createSessionCookie(request('/api/admin/session')).split(';')[0];let controller!:ReadableStreamDefaultController<Uint8Array>;
  const stream=new ReadableStream<Uint8Array>({start(value){controller=value;}});
  const held=new Request(origin+'/api/admin/matching-evaluations',{method:'POST',headers:{host:'127.0.0.1:3100',origin,cookie,'content-type':'application/json'},body:stream,duplex:'half'} as RequestInit);
  const response=postMatchingEvaluation(held);controller.enqueue(new TextEncoder().encode('{'));process.env.LOCAL_REVIEW_TOKEN='different-synthetic-review-token';controller.enqueue(new TextEncoder().encode('}'));controller.close();
  assert.equal((await response).status,403);assert.equal(matchingEvaluations().list().length,0);
 }finally{reset();for(const key of ['COMGROUND_MODE','COMGROUND_DB_PATH','LOCAL_REVIEW_TOKEN','COMGROUND_ORIGIN']){if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];}rmSync(dir,{recursive:true,force:true});}
});
