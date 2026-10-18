import { requireReviewer } from './auth.ts';
import { requireAccount } from './account-auth.ts';
import { requireStudent } from './student-auth.ts';
import { getRuntimeConfig } from './runtime-config.ts';
import { apiError,assertLoopback,assertSameOrigin,jsonResponse,readJson } from './http.ts';
import { RepositoryError } from './errors.ts';
import { evidence } from './evidence-runtime.ts';
type Action=(request:Request)=>Response|Promise<Response>;
function guard(action:Action):Action{return async request=>{try{assertLoopback(request);if(new URL(request.url).search)throw new RepositoryError('INVALID_QUERY',400,'Evidence resources do not accept query parameters.');return await action(request);}catch(error){return apiError(error);}};}
function actor(request:Request):string {requireReviewer(request);return getRuntimeConfig().mode==='demo'?'local-demo-operator':requireAccount(request,{role:'OPERATOR',verified:true}).id;}
export const getStudentEvidence=guard(request=>jsonResponse({data:evidence().overview(requireStudent(request))}));
export const postFailedFit=guard(async request=>{assertSameOrigin(request);const input=await readJson(request),owner=requireStudent(request);return jsonResponse({data:evidence().recordFailedFit(owner,input)},201);});
export function patchFailedFit(request:Request,id:string){return guard(async req=>{assertSameOrigin(req);const input=await readJson(req),owner=requireStudent(req);return jsonResponse({data:evidence().updateFailedFit(owner,id,input)});})(request);}
export const postEvidenceClaim=guard(async request=>{assertSameOrigin(request);const input=await readJson(request),owner=requireStudent(request);return jsonResponse(evidence().createClaim(owner,input),201);});
export function withdrawEvidenceClaim(request:Request,id:string){return guard(async req=>{assertSameOrigin(req);const input=await readJson(req),owner=requireStudent(req);return jsonResponse({data:evidence().withdrawClaim(owner,id,input)});})(request);}
export const getOperatorEvidence=guard(request=>jsonResponse({data:evidence().operatorOverview(actor(request))}));
export const exchangeEvidenceClaim=guard(async request=>{assertSameOrigin(request);const input=await readJson(request),operator=actor(request);return jsonResponse({data:evidence().exchangeClaim(operator,input)});});
export function decideEvidenceClaim(request:Request,id:string){return guard(async req=>{assertSameOrigin(req);const input=await readJson(req),operator=actor(req);return jsonResponse({data:evidence().decideClaim(operator,id,input)});})(request);}
export const postScopeEvidence=guard(async request=>{assertSameOrigin(request);const input=await readJson(request),operator=actor(request);return jsonResponse({data:evidence().createScopeRecord(operator,input)},201);});
export function revokeScopeEvidence(request:Request,id:string){return guard(async req=>{assertSameOrigin(req);const input=await readJson(req),operator=actor(req);return jsonResponse({data:evidence().revokeScopeRecord(operator,id,input)});})(request);}
