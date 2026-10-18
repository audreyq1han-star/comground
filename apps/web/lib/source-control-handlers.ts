import { requireAccount } from './account-auth.ts';
import { apiError,assertLoopback,assertSameOrigin,jsonResponse,objectInput,readJson } from './http.ts';
import { RepositoryError } from './errors.ts';
import { fixtureList } from '../../../packages/domain/fixtures.ts';
import { repository,fixtureEpoch } from './runtime.ts';
import { sourceControl } from './source-control-runtime.ts';
import { getRuntimeConfig } from './runtime-config.ts';
const identifier=(value:unknown):string=>{if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value))throw new RepositoryError('INVALID_INPUT',422,'Choose a valid source or run.');return value;};
async function guard(request:Request,action:()=>Response|Promise<Response>):Promise<Response>{try{assertLoopback(request);if(new URL(request.url).search)throw new RepositoryError('INVALID_QUERY',400,'Source control does not accept query parameters.');if(getRuntimeConfig().mode==='demo')throw new RepositoryError('ACCOUNT_REQUIRED',403,'Source operations require a verified operator account.');return await action();}catch(error){return apiError(error);}}
export const getSourceControl=(request:Request)=>guard(request,()=>{const actor=requireAccount(request,{role:'OPERATOR',verified:true});return jsonResponse({data:{...sourceControl().overview(),actorId:actor.id}});});
export const postSourceControl=(request:Request)=>guard(request,async()=>{
  assertSameOrigin(request);const raw=await readJson(request),actor=requireAccount(request,{role:'OPERATOR',verified:true});
  const config=getRuntimeConfig();
  if(config.mode!=='test'||process.env.COMGROUND_TEST_FIXTURES!=='1')throw new RepositoryError('SOURCE_SIMULATION_DISABLED',403,'Synthetic source operations require the explicitly enabled local fixture workflow.');
  const kind=objectInput(raw,['action','sourceId','input','id','expectedVersion','minutes','reason']).action,store=sourceControl();
  if(kind==='SAVE_PERMISSION'){const value=objectInput(raw,['action','sourceId','input']);const input=objectInput(value.input,['expectedVersion','state','method','origin','pathPrefix','fields','attribution','evidence','ownerId','removalRoute','cadenceMinutes','expiresAt','synthetic','reason']);return jsonResponse({data:store.savePermission(identifier(value.sourceId),{...input,ownerId:input.ownerId??actor.id},actor.id)});}
  if(kind==='SCHEDULE'){objectInput(raw,['action']);return jsonResponse({data:store.scheduleDue(actor.id)});}
  if(kind==='QUEUE'){const value=objectInput(raw,['action','sourceId','id']);return jsonResponse({data:store.queue(identifier(value.sourceId),identifier(value.id),actor.id)},201);}
  if(kind==='RUN_SYNTHETIC'||kind==='SIMULATE_FAILURE'){const value=objectInput(raw,['action','id','expectedVersion']);const run=store.overview().runs.find(item=>item.id===value.id);if(!run)throw new RepositoryError('NOT_FOUND',404,'Run not found.');if(run.version!==value.expectedVersion)throw new RepositoryError('VERSION_CONFLICT',409,'Run changed. Reload before simulating.');const lease=store.claim(run.id);if(!lease.token)return jsonResponse({data:lease.run});if(kind==='SIMULATE_FAILURE')return jsonResponse({data:store.failRun(run.id,lease.token,'TRANSPORT_ERROR')});const records=fixtureList(fixtureEpoch()).filter(item=>item.record.source.id===run.sourceId).map(item=>item.record);return jsonResponse({data:store.commitBatch(run.id,lease.token,{expectedCursor:lease.run.cursor,nextCursor:'synthetic-fixtures-complete',records,complete:true})});}
  if(kind==='REPLAY'){const value=objectInput(raw,['action','id','expectedVersion']);return jsonResponse({data:store.replay(identifier(value.id),value.expectedVersion as number,actor.id)},201);}
  if(kind==='IMPORT_STAGED'){const value=objectInput(raw,['action','id']);const staged=store.overview().stages.find(item=>item.id===value.id);if(!staged?.record||staged.state!=='STAGED')throw new RepositoryError('STATE_CONFLICT',409,'Choose a current valid staged record.');const exact=store.linkExactRecord(staged.id,actor.id);if(exact)return jsonResponse({data:{opportunityId:exact,linked:true}});const result=repository().importRecord(staged.record,new Date(),actor.id);store.markImported(staged.id,result.opportunity.id,actor.id);return jsonResponse({data:{opportunityId:result.opportunity.id,linked:false}});}
  if(kind==='LOG_REVIEW'){const value=objectInput(raw,['action','sourceId','minutes']);store.logReview(identifier(value.sourceId),value.minutes as number,actor.id);return jsonResponse({data:null});}
  if(kind==='DUPLICATE_DECISION'){const value=objectInput(raw,['action','input']);store.decideDuplicate(value.input,actor.id);return jsonResponse({data:null});}
  if(kind==='REVERSE_MERGE'){const value=objectInput(raw,['action','id','expectedVersion','reason']);store.reverseMerge(identifier(value.id),value.expectedVersion as number,value.reason as string,actor.id);return jsonResponse({data:null});}
  throw new RepositoryError('INVALID_INPUT',422,'Choose a supported source-control action.');
});
