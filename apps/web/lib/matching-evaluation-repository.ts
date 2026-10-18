import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { MatchingEvaluationCase, MatchingEvaluationComparison, MatchingEvaluationDecision, MatchingEvaluationRun, MatchingEvaluationSummary } from '../../../packages/domain/matching-evaluation-contracts.ts';
import { curatedEvaluationCases, EVALUATION_CASE_SET_VERSION, EVALUATION_CLOCK } from '../../../packages/domain/matching-evaluation-cases.ts';
import { evaluateEligibility } from '../../../packages/domain/rules.ts';
import { MEASUREMENT_RULES_VERSION } from './measurement-repository.ts';
import { RepositoryError } from './errors.ts';
import { objectInput } from './http.ts';
const fail=(code:string,status:number,message:string):never=>{throw new RepositoryError(code,status,message);};
function actorId(value:string):string { return /^(account-[A-Za-z0-9-]{1,100}|demo-reviewer)$/.test(value)?value:fail('INVALID_ACTOR',422,'An authenticated reviewer identity is required.'); }
export function initializeMatchingEvaluationSchema(db:DatabaseSync):void {
 db.exec(`CREATE TABLE IF NOT EXISTS matching_evaluation_runs(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,result_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS matching_evaluation_decisions(run_id TEXT NOT NULL REFERENCES matching_evaluation_runs(id),version INTEGER NOT NULL,decision TEXT NOT NULL CHECK(decision IN ('APPROVE','REJECT')),reason TEXT NOT NULL,actor TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(run_id,version));
 CREATE TRIGGER IF NOT EXISTS matching_evaluation_runs_no_update BEFORE UPDATE ON matching_evaluation_runs BEGIN SELECT RAISE(ABORT,'Evaluation results are immutable'); END;
 CREATE TRIGGER IF NOT EXISTS matching_evaluation_runs_no_delete BEFORE DELETE ON matching_evaluation_runs BEGIN SELECT RAISE(ABORT,'Evaluation results are immutable'); END;
 CREATE TRIGGER IF NOT EXISTS matching_evaluation_decisions_no_update BEFORE UPDATE ON matching_evaluation_decisions BEGIN SELECT RAISE(ABORT,'Evaluation decisions are immutable'); END;
 CREATE TRIGGER IF NOT EXISTS matching_evaluation_decisions_no_delete BEFORE DELETE ON matching_evaluation_decisions BEGIN SELECT RAISE(ABORT,'Evaluation decisions are immutable'); END;`);
}
export function createMatchingEvaluationRepository(filename:string) {
 const db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');initializeMatchingEvaluationSchema(db);
 function transaction<T>(action:()=>T):T {db.exec('BEGIN IMMEDIATE');try{const result=action();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
 function get(id:string):MatchingEvaluationRun {
  const row=db.prepare('SELECT result_json FROM matching_evaluation_runs WHERE id=?').get(id) as {result_json:string}|undefined;
  if(!row)return fail('NOT_FOUND',404,'Evaluation run not found.');
  const result=JSON.parse(row.result_json) as MatchingEvaluationRun;
  const decisions=db.prepare('SELECT version,decision,reason,actor,at FROM matching_evaluation_decisions WHERE run_id=? ORDER BY version').all(id) as MatchingEvaluationDecision[];
  const latest=decisions.at(-1);
  return {...result,version:latest?.version??1,status:latest?(latest.decision==='APPROVE'?'APPROVED':'REJECTED'):'PENDING',decisions};
 }
 function list():MatchingEvaluationSummary[] {return (db.prepare('SELECT id FROM matching_evaluation_runs ORDER BY created_at DESC,rowid DESC LIMIT 50').all() as {id:string}[]).map(({id})=>{const {cases:_cases,decisions:_decisions,...summary}=get(id);return summary;});}
 function run(actor:string,options:{evaluate?:typeof evaluateEligibility;rulesVersion?:string;now?:Date}={}):MatchingEvaluationRun {
  actorId(actor);const fixtures=curatedEvaluationCases(),clock=new Date(EVALUATION_CLOCK),evaluate=options.evaluate??evaluateEligibility;
  const cases:MatchingEvaluationCase[]=fixtures.map(item=>{
   try {const result=evaluate(item.record,item.preferences,clock);return {id:item.id,title:item.title,expected:item.expected,expectedReason:item.expectedReason,actual:result.status,reasonCodes:result.reasonCodes,reasons:result.reasons,passed:result.status===item.expected&&(!item.expectedReason||result.reasonCodes.includes(item.expectedReason))&&result.reasons.length>0};}
   catch{return {id:item.id,title:item.title,expected:item.expected,expectedReason:item.expectedReason,actual:'ERROR',reasonCodes:[],reasons:['The eligibility engine could not evaluate this synthetic case.'],passed:false};}
  });
  // Hash non-finite fixtures without conflating them with null source facts.
  const caseSetHash=createHash('sha256').update(JSON.stringify(fixtures,(_key,value)=>typeof value==='number'&&!Number.isFinite(value)?String(value):value)).digest('hex');
  const result:MatchingEvaluationRun={id:randomUUID(),createdAt:(options.now??new Date()).toISOString(),createdBy:actor,caseSetVersion:EVALUATION_CASE_SET_VERSION,caseSetHash,rulesVersion:options.rulesVersion??MEASUREMENT_RULES_VERSION,fixtureClock:EVALUATION_CLOCK,total:cases.length,passed:cases.filter(item=>item.passed).length,failed:cases.filter(item=>!item.passed).length,version:1,status:'PENDING',evidenceLabel:'Synthetic offline eligibility evaluation',studentDataIncluded:false,cases,decisions:[]};
  db.prepare('INSERT INTO matching_evaluation_runs(id,created_at,result_json) VALUES(?,?,?)').run(result.id,result.createdAt,JSON.stringify(result));return result;
 }
 function decide(id:string,input:unknown,actor:string,now=new Date()):MatchingEvaluationRun {
  actorId(actor);const value=objectInput(input,['expectedVersion','decision','reason']);
  if(!Number.isSafeInteger(value.expectedVersion)||Number(value.expectedVersion)<1||(value.decision!=='APPROVE'&&value.decision!=='REJECT')||typeof value.reason!=='string'||value.reason.trim().length<3||value.reason.trim().length>1000)return fail('INVALID_INPUT',422,'Provide a current version, decision and a reason between 3 and 1000 characters.');
  return transaction(()=>{const current=get(id);if(current.version!==value.expectedVersion)return fail('VERSION_CONFLICT',409,'This evaluation changed. Reload it before deciding.');
   if(value.decision==='APPROVE'&&current.rulesVersion!==MEASUREMENT_RULES_VERSION)return fail('STALE_EVALUATION',409,'The active rules version changed. Run the current suite before approving.');
   if(value.decision==='APPROVE'&&(current.failed>0||current.total<60))return fail('EVALUATION_FAILED',422,'Approval requires at least 60 cases with no failures.');
   const next=value.decision==='APPROVE'?'APPROVED':'REJECTED';if(current.status===next)return fail('STATE_CONFLICT',409,'This decision is already current. Reload the evaluation.');
   db.prepare('INSERT INTO matching_evaluation_decisions(run_id,version,decision,reason,actor,at) VALUES(?,?,?,?,?,?)').run(id,current.version+1,value.decision as string,(value.reason as string).trim(),actor,now.toISOString());return get(id);});
 }
 function compare(beforeId:string,afterId:string):MatchingEvaluationComparison {
  const before=get(beforeId),after=get(afterId),old=new Map(before.cases.map(item=>[item.id,item])),current=new Map(after.cases.map(item=>[item.id,item]));
  const shared=after.cases.filter(item=>old.has(item.id));
  return {beforeId,afterId,sameCaseSet:before.caseSetHash===after.caseSetHash,beforeRulesVersion:before.rulesVersion,afterRulesVersion:after.rulesVersion,regressions:shared.filter(item=>old.get(item.id)!.passed&&!item.passed).map(item=>item.id),improvements:shared.filter(item=>!old.get(item.id)!.passed&&item.passed).map(item=>item.id),changed:shared.filter(item=>JSON.stringify(old.get(item.id))!==JSON.stringify(item)).map(item=>item.id),added:after.cases.filter(item=>!old.has(item.id)).map(item=>item.id),removed:before.cases.filter(item=>!current.has(item.id)).map(item=>item.id),label:'Synthetic case comparison; not production evidence'};
 }
 return {get,list,run,decide,compare,close(){db.close();}};
}
export type MatchingEvaluationRepository=ReturnType<typeof createMatchingEvaluationRepository>;
