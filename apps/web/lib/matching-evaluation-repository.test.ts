import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createMatchingEvaluationRepository } from './matching-evaluation-repository.ts';
const actor='account-synthetic-reviewer';

test('curated runs retain explicit outcomes, versions and actor across restart with immutable cases',()=>{
 const dir=mkdtempSync(join(tmpdir(),'evaluation-')),path=join(dir,'test.sqlite');let store=createMatchingEvaluationRepository(path);
 try{
  const run=store.run(actor);assert.ok(run.total>=60);assert.equal(run.failed,0);assert.equal(run.status,'PENDING');assert.equal(run.createdBy,actor);assert.equal(run.cases.length,run.total);
  assert.equal(new Set(run.cases.map(item=>item.id)).size,run.total);assert.ok(run.cases.every(item=>item.expected&&item.actual&&item.reasons.length));
  const approved=store.decide(run.id,{expectedVersion:1,decision:'APPROVE',reason:'Reviewed synthetic boundary cases'},actor);assert.equal(approved.status,'APPROVED');assert.equal(approved.version,2);assert.equal(approved.decisions[0].actor,actor);
  assert.throws(()=>store.decide(run.id,{expectedVersion:1,decision:'REJECT',reason:'Stale decision'},actor),{code:'VERSION_CONFLICT'});
  const rejected=store.decide(run.id,{expectedVersion:2,decision:'REJECT',reason:'Withdraw local release review'},actor);assert.equal(rejected.status,'REJECTED');assert.equal(rejected.decisions.length,2);
  store.close();store=createMatchingEvaluationRepository(path);assert.deepEqual(store.get(run.id),rejected);
  const db=new DatabaseSync(path);try{assert.throws(()=>db.prepare('UPDATE matching_evaluation_runs SET result_json=? WHERE id=?').run('{}',run.id),/immutable/);assert.throws(()=>db.exec('DELETE FROM matching_evaluation_decisions'),/immutable/);}finally{db.close();}
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('failures cannot be approved, comparisons identify regressions, actor and DTO injection are rejected',()=>{
 const store=createMatchingEvaluationRepository(':memory:');try{
  const good=store.run(actor),bad=store.run(actor,{evaluate:()=>({status:'ELIGIBLE',reasonCodes:[],reasons:['Injected unsafe engine result']})});
  assert.ok(bad.failed>0);assert.throws(()=>store.decide(bad.id,{expectedVersion:1,decision:'APPROVE',reason:'Attempt unsafe approval'},actor),{code:'EVALUATION_FAILED'});
  const comparison=store.compare(good.id,bad.id);assert.ok(comparison.regressions.length>0);assert.equal(comparison.beforeId,good.id);assert.equal(comparison.afterId,bad.id);
  assert.throws(()=>store.decide(good.id,{expectedVersion:1,decision:'APPROVE',reason:'Synthetic',actor:'forged'},actor),{code:'INVALID_INPUT'});
  const stale=store.run(actor,{rulesVersion:'prior-policy'});assert.throws(()=>store.decide(stale.id,{expectedVersion:1,decision:'APPROVE',reason:'Outdated policy'},actor),{code:'STALE_EVALUATION'});
  assert.throws(()=>store.run(''),{code:'INVALID_ACTOR'});assert.throws(()=>store.get('unknown'),{code:'NOT_FOUND'});
 }finally{store.close();}
});
