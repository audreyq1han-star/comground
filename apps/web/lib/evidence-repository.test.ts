import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAccountStore } from './account-repository.ts';
import { createEvidenceStore,exportOwnerEvidence,purgeOwnerEvidence,hasActiveSchoolProgramApproval } from './evidence-repository.ts';
import type { PublicOpportunity } from '../../../packages/domain/contracts.ts';
import type { AccountId } from '../../../packages/domain/identity-contracts.ts';
const now=new Date('2031-05-01T12:00:00Z');
const op='account-11111111-1111-4111-8111-111111111111' as AccountId;
const other='account-22222222-2222-4222-8222-222222222222' as AccountId;
function setup(enabled=true){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');createAccountStore(db,{notificationSink(){}});
 for(const [id,role] of [[op,'OPERATOR'],[other,'STUDENT']])db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?)').run(id,id+'@example.invalid','fixture-only',role,now.toISOString(),now.toISOString(),now.toISOString(),now.toISOString());
 db.exec('CREATE TABLE student_profiles(persona_id TEXT PRIMARY KEY,profile_json TEXT NOT NULL)');
 for(const owner of ['demo-alex','demo-sam'])db.prepare('INSERT INTO student_profiles VALUES(?,?)').run(owner,JSON.stringify({personaId:owner,version:1,consentVersion:'local-demo-v1',updatedAt:now.toISOString()}));
 let endsAt='2031-05-01T10:00:00Z';
 const item=()=>({id:'example',occurrenceId:'morning',title:'Fictional service date',startsAt:'2031-05-01T09:00:00Z',endsAt,organization:{id:'example-org'},isSynthetic:true} as PublicOpportunity);
 const supply={getPublicSnapshot:(id:string,date='primary')=>id==='example'&&(date==='morning'||date==='primary')?item():null,listOrganizations:()=>[{id:'example-org'}]};
 const store=createEvidenceStore(db,supply,{syntheticEnabled:enabled,allowDemo:true});
 return {db,store,changeEnd:(date:string)=>{endsAt=date;},close:()=>db.close()};
}
const claimInput={opportunityId:'example',occurrenceId:'morning',kind:'INTRODUCTION',sharingConsent:true};
const evidenceInput={expectedVersion:2,action:'RECORD',evidenceReference:'synthetic:fixture-001',validUntil:'2031-06-01T00:00:00Z'};
test('failed-fit taxonomy is private, exact-occurrence, bounded and versioned with retained history',()=>{const s=setup();try{
 const first=s.store.recordFailedFit('demo-alex',{opportunityId:'example',occurrenceId:'morning',reason:'WRONG_AGE'},now);
 assert.equal(first.evidenceLabel,'SYNTHETIC_NOT_VERIFIED');assert.equal(s.store.overview('demo-sam',now).failedFits.length,0);
 assert.throws(()=>s.store.recordFailedFit('demo-alex',{opportunityId:'example',occurrenceId:'wrong',reason:'CLOSED'},now),{code:'OCCURRENCE_NOT_FOUND'});
 assert.throws(()=>s.store.recordFailedFit('demo-sam',{opportunityId:'example',occurrenceId:'morning',reason:'OTHER',details:'personal text'},now),{code:'INVALID_INPUT'});
 assert.throws(()=>s.store.updateFailedFit('demo-sam',first.id,{expectedVersion:1,reason:'TRAVEL'},now),{code:'RECORD_NOT_FOUND'});
 const changed=s.store.updateFailedFit('demo-alex',first.id,{expectedVersion:1,reason:'TIMING'},now);assert.equal(changed.history.length,2);
 assert.throws(()=>s.store.updateFailedFit('demo-alex',first.id,{expectedVersion:1,reason:'NO_RESPONSE'},now),{code:'VERSION_CONFLICT'});
 assert.throws(()=>s.store.updateFailedFit('demo-alex',first.id,{expectedVersion:2,reason:'name@example.invalid'},now),{code:'INVALID_INPUT'});
}finally{s.close();}});
test('share reference is explicit, one-time, expires and never enters exports or operator projections',()=>{const s=setup();try{
 assert.throws(()=>s.store.createClaim('demo-alex',{...claimInput,sharingConsent:false},now),{code:'SHARING_CONSENT_REQUIRED'});
 const result=s.store.createClaim('demo-alex',claimInput,now);assert.equal(result.shareToken.length,43);
 assert.equal(JSON.stringify(exportOwnerEvidence(s.db,'demo-alex',now)).includes(result.shareToken),false);
 const assigned=s.store.exchangeClaim(op,{shareToken:result.shareToken},now);assert.equal(assigned.status,'ASSIGNED');assert.equal(assigned.version,2);
 const dto=JSON.stringify(s.store.operatorOverview(op,now));for(const secret of ['demo-alex','profile_json','email',result.shareToken])assert.equal(dto.includes(secret),false);
 assert.throws(()=>s.store.exchangeClaim(op,{shareToken:result.shareToken},now),{code:'CLAIM_UNAVAILABLE'});
 const expired=s.store.createClaim('demo-sam',claimInput,now);assert.throws(()=>s.store.exchangeClaim(op,{shareToken:expired.shareToken},new Date(now.getTime()+86400001)),{code:'CLAIM_UNAVAILABLE'});
}finally{s.close();}});
test('student cannot self-confirm or target another owner; operator decisions require the assignment and current version',()=>{const s=setup();try{
 const result=s.store.createClaim('demo-alex',claimInput,now);
 assert.throws(()=>s.store.exchangeClaim(other,{shareToken:result.shareToken},now),{code:'FORBIDDEN'});
 s.store.exchangeClaim(op,{shareToken:result.shareToken},now);
 assert.throws(()=>s.store.decideClaim('local-demo-operator',result.data.id,evidenceInput,now),{code:'RECORD_NOT_FOUND'});
 assert.throws(()=>s.store.decideClaim(op,result.data.id,{...evidenceInput,expectedVersion:1},now),{code:'VERSION_CONFLICT'});
 assert.throws(()=>s.store.decideClaim(op,result.data.id,{...evidenceInput,evidenceReference:'https://real.example/evidence'},now),{code:'INVALID_INPUT'});
 const recorded=s.store.decideClaim(op,result.data.id,evidenceInput,now);assert.equal(recorded.status,'RECORDED');assert.equal(recorded.evidenceLabel,'SYNTHETIC_NOT_VERIFIED');
 assert.throws(()=>s.store.withdrawClaim('demo-sam',recorded.id,{expectedVersion:3},now),{code:'RECORD_NOT_FOUND'});
 const revoked=s.store.decideClaim(op,recorded.id,{expectedVersion:3,action:'REVOKE'},now);assert.equal(revoked.status,'REVOKED');assert.deepEqual(revoked.history.map(e=>e.action),['CREATE','ASSIGN','RECORD','REVOKE']);
 assert.equal((s.db.prepare('SELECT actor_audit_json FROM student_evidence_claims').get() as {actor_audit_json:string}).actor_audit_json.includes(op),true);
}finally{s.close();}});
test('attendance requires ended exact dates at request and operator decision; schedule changes invalidate old requests',()=>{const s=setup();try{
 s.changeEnd('2031-05-02T10:00:00Z');assert.throws(()=>s.store.createClaim('demo-alex',{...claimInput,kind:'ORGANIZER_ATTENDANCE'},now),{code:'EVENT_NOT_ENDED'});
 s.changeEnd('2031-05-01T10:00:00Z');const claim=s.store.createClaim('demo-alex',{...claimInput,kind:'ORGANIZER_ATTENDANCE'},now);s.store.exchangeClaim(op,{shareToken:claim.shareToken},now);
 s.changeEnd('2031-05-02T10:00:00Z');assert.throws(()=>s.store.decideClaim(op,claim.data.id,evidenceInput,now),{code:'STATE_CONFLICT'});
 assert.equal(s.store.overview('demo-alex',now).claims[0].status,'ASSIGNED');
}finally{s.close();}});
test('owner withdrawal immediately invalidates token and assigned evidence; purge removes private history',()=>{const s=setup();try{
 const one=s.store.createClaim('demo-alex',claimInput,now);s.store.withdrawClaim('demo-alex',one.data.id,{expectedVersion:1},now);assert.throws(()=>s.store.exchangeClaim(op,{shareToken:one.shareToken},now),{code:'CLAIM_UNAVAILABLE'});
 const two=s.store.createClaim('demo-alex',claimInput,now);s.store.exchangeClaim(op,{shareToken:two.shareToken},now);s.store.decideClaim(op,two.data.id,evidenceInput,now);s.store.withdrawClaim('demo-alex',two.data.id,{expectedVersion:3},now);
 assert.equal(s.store.operatorOverview(op,now).claims[0].status,'WITHDRAWN');purgeOwnerEvidence(s.db,'demo-alex');assert.equal(exportOwnerEvidence(s.db,'demo-alex').claims.length,0);assert.equal(s.store.operatorOverview(op).claims.length,0);
 const three=s.store.createClaim('demo-sam',claimInput,now);assert.ok(three);s.db.prepare('DELETE FROM student_profiles WHERE persona_id=?').run('demo-sam');assert.equal(exportOwnerEvidence(s.db,'demo-sam').claims.length,0);
}finally{s.close();}});
test('school evidence is scoped by program, organization, opportunity, validity and revocation',()=>{const s=setup();try{
 const record=s.store.createScopeRecord(op,{kind:'SCHOOL_PROGRAM_APPROVAL',organizationId:'example-org',opportunityId:'example',programId:'synthetic:program-demo-service',evidenceReference:'synthetic:school-review',validUntil:'2031-06-01T00:00:00Z'},now);
 const scope={programId:'synthetic:program-demo-service',organizationId:'example-org',opportunityId:'example'};
 assert.equal(hasActiveSchoolProgramApproval(s.db,scope,now),true);assert.throws(()=>s.store.createScopeRecord(op,{kind:'SCHOOL_PROGRAM_APPROVAL',organizationId:'example-org',opportunityId:'example',programId:'synthetic:program-demo-service',evidenceReference:'synthetic:replacement',validUntil:'2031-06-01T00:00:00Z'},now),{code:'STATE_CONFLICT'});assert.equal(hasActiveSchoolProgramApproval(s.db,{...scope,programId:'different'},now),false);assert.equal(hasActiveSchoolProgramApproval(s.db,{...scope,opportunityId:'other'},now),false);assert.equal(hasActiveSchoolProgramApproval(s.db,scope,new Date('2031-06-02')),false);
 assert.throws(()=>s.store.revokeScopeRecord(op,record.id,{expectedVersion:2},now),{code:'VERSION_CONFLICT'});const revoked=s.store.revokeScopeRecord(op,record.id,{expectedVersion:1},now);assert.equal(revoked.history[1].actorReference,op);assert.equal(hasActiveSchoolProgramApproval(s.db,scope,now),false);
 const org=s.store.createScopeRecord(op,{kind:'ORGANIZER_REVIEW',organizationId:'example-org',opportunityId:null,programId:null,evidenceReference:'synthetic:organizer-review',validUntil:'2031-06-01T00:00:00Z'},now);assert.equal(org.kind,'ORGANIZER_REVIEW');assert.equal(hasActiveSchoolProgramApproval(s.db,scope,now),false);
}finally{s.close();}});
test('production-style disabled store never creates synthetic records or invokes a provider',()=>{const s=setup(false);try{
 assert.throws(()=>s.store.createClaim('demo-alex',claimInput,now),{code:'EVIDENCE_WORKFLOW_DISABLED'});assert.throws(()=>s.store.recordFailedFit('demo-alex',{opportunityId:'example',occurrenceId:'morning',reason:'OTHER'},now),{code:'EVIDENCE_WORKFLOW_DISABLED'});
 assert.equal(s.store.overview('demo-alex',now).externalVerification,'DISABLED');assert.equal(exportOwnerEvidence(s.db,'demo-alex',now).claims.length,0);
}finally{s.close();}});
