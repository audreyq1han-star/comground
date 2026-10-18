import { requireReviewer } from './auth.ts';
import { requireAccount } from './account-auth.ts';
import { getRuntimeConfig } from './runtime-config.ts';
import { apiError, assertLoopback, assertSameOrigin, jsonResponse, objectInput, readJson } from './http.ts';
import { RepositoryError } from './errors.ts';
import { matchingEvaluations } from './matching-evaluation-runtime.ts';
import { EVALUATION_CASE_SET_VERSION } from '../../../packages/domain/matching-evaluation-cases.ts';
import { MEASUREMENT_RULES_VERSION } from './measurement-repository.ts';
function actor(request:Request):string { requireReviewer(request);return getRuntimeConfig().mode==='demo'?'demo-reviewer':requireAccount(request,{role:'OPERATOR',verified:true}).id; }
function checkQuery(request:Request,keys:string[]=[]):URLSearchParams {const params=new URL(request.url).searchParams;for(const key of params.keys())if(!keys.includes(key)||params.getAll(key).length!==1)throw new RepositoryError('INVALID_QUERY',400,'Unsupported or repeated evaluation query.');return params;}
function id(value:string|null):string {if(!value||!/^[0-9a-f-]{36}$/.test(value))throw new RepositoryError('INVALID_INPUT',422,'Choose a stored evaluation run.');return value;}
async function guarded(request:Request,action:()=>Response|Promise<Response>):Promise<Response>{try{assertLoopback(request);return await action();}catch(error){return apiError(error);}}
export function getMatchingEvaluations(request:Request):Promise<Response>{return guarded(request,()=>{checkQuery(request);actor(request);return jsonResponse({data:{currentRulesVersion:MEASUREMENT_RULES_VERSION,currentCaseSetVersion:EVALUATION_CASE_SET_VERSION,runs:matchingEvaluations().list(),limit:50}});});}
export function postMatchingEvaluation(request:Request):Promise<Response>{return guarded(request,async()=>{checkQuery(request);assertSameOrigin(request);objectInput(await readJson(request),[]);const reviewer=actor(request);return jsonResponse({data:matchingEvaluations().run(reviewer)},201);});}
export function getMatchingEvaluation(request:Request,runId:string):Promise<Response>{return guarded(request,()=>{checkQuery(request);actor(request);return jsonResponse({data:matchingEvaluations().get(id(runId))});});}
export function patchMatchingEvaluation(request:Request,runId:string):Promise<Response>{return guarded(request,async()=>{checkQuery(request);assertSameOrigin(request);const input=await readJson(request),reviewer=actor(request);return jsonResponse({data:matchingEvaluations().decide(id(runId),input,reviewer)});});}
export function compareMatchingEvaluations(request:Request):Promise<Response>{return guarded(request,()=>{const params=checkQuery(request,['before','after']);actor(request);return jsonResponse({data:matchingEvaluations().compare(id(params.get('before')),id(params.get('after')))});});}
