import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createAccountStore,getAccountById } from './account-repository.ts';
import { createPrivacyStore } from './privacy-store.ts';
import { createYouthStore } from './youth-repository.ts';
import { initializeEvidenceSchema } from './evidence-repository.ts';
import { readEvidenceMetrics } from './evidence-metrics-repository.ts';
import { EVIDENCE_LABEL,type EvidenceClaim } from '../../../packages/domain/evidence-contracts.ts';
import type { AccountId } from '../../../packages/domain/identity-contracts.ts';

const now=new Date('2031-06-01T12:00:00Z'),at='2031-05-22T12:00:00.000Z',consent='2031-05-01T12:00:00.000Z';
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');createAccountStore(db,{notificationSink(){}});
 db.exec('CREATE TABLE student_profiles(persona_id TEXT PRIMARY KEY,profile_json TEXT NOT NULL); CREATE TABLE measurement_consent(owner TEXT PRIMARY KEY REFERENCES student_profiles(persona_id) ON DELETE CASCADE,enabled INTEGER NOT NULL,version INTEGER NOT NULL,consented_at TEXT)');
 const privacy=createPrivacyStore(db);initializeEvidenceSchema(db);const owners:AccountId[]=[];
 for(let i=0;i<3;i++){
  const owner:AccountId=`account-${randomUUID()}`;owners.push(owner);db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?)').run(owner,`student-${i}@example.invalid`,'synthetic-only','STUDENT',consent,consent,consent,consent);
  db.prepare('INSERT INTO student_profiles VALUES(?,?)').run(owner,JSON.stringify({personaId:owner,version:1,preferences:{schoolStage:'HIGH_SCHOOL',ageMin:18,ageMax:24},consentVersion:'adult-account-v1',updatedAt:consent}));privacy.save(owner,{policyVersion:'adult-account-v1',adultConfirmed:true,personalization:false,aiExplanations:false},new Date(consent));
  db.prepare('INSERT INTO measurement_consent VALUES(?,1,1,?)').run(owner,consent);
  const claim:EvidenceClaim={id:randomUUID(),kind:'INTRODUCTION',opportunityId:'historical-opportunity',occurrenceId:'historical-date',organizationId:'historical-org',title:'Stored historical date',startsAt:'2031-05-22T09:00:00Z',endsAt:'2031-05-22T10:00:00Z',status:'RECORDED',version:3,createdAt:at,sharedAt:at,updatedAt:at,expiresAt:'2031-05-23T12:00:00Z',evidence:{reference:'synthetic:private-reference',validFrom:at,validUntil:'2031-07-01T12:00:00Z'},history:[],evidenceLabel:EVIDENCE_LABEL};
  db.prepare('INSERT INTO student_evidence_claims(id,owner,record_json) VALUES(?,?,?)').run(claim.id,owner,JSON.stringify(claim));
 }
 return {db,owners};
}
test('current measurement consent, storage and account eligibility are read on every summary',()=>{const {db,owners}=fixture();try{
 const baseline=readEvidenceMetrics(db,now);assert.equal(baseline.metrics?.introductions,3);
 db.prepare('UPDATE measurement_consent SET enabled=0 WHERE owner=?').run(owners[0]);assert.equal(readEvidenceMetrics(db,now).metrics,null);
 db.prepare('UPDATE measurement_consent SET enabled=1,consented_at=?').run(now.toISOString());assert.equal(readEvidenceMetrics(db,now).metrics?.introductions,0);
 db.prepare('UPDATE measurement_consent SET consented_at=?').run(consent);db.prepare('UPDATE student_privacy SET policy_version=? WHERE owner=?').run('obsolete-policy',owners[0]);assert.equal(readEvidenceMetrics(db,now).metrics,null);
 db.prepare('UPDATE student_privacy SET policy_version=? WHERE owner=?').run('adult-account-v1',owners[0]);db.prepare('UPDATE accounts SET email_verified_at=NULL WHERE id=?').run(owners[0]);assert.equal(readEvidenceMetrics(db,now).metrics,null);
}finally{db.close();}});
test('profile deletion removes claims and measurement contribution without returning any owner or private data',()=>{const {db,owners}=fixture();try{
 const dto=JSON.stringify(readEvidenceMetrics(db,now));for(const value of [...owners,'@example.invalid','historical-org','synthetic:private-reference','preferences'])assert.equal(dto.includes(value),false);
 db.prepare('DELETE FROM student_profiles WHERE persona_id=?').run(owners[0]);assert.equal((db.prepare('SELECT COUNT(*) AS n FROM student_evidence_claims WHERE owner=?').get(owners[0]) as {n:number}).n,0);assert.equal(readEvidenceMetrics(db,now).metrics,null);
}finally{db.close();}});
test('teen accounts never join measurement even with forged opt-in and current approval; revoked review remains excluded',()=>{const {db,owners}=fixture();try{
 const teen=owners[0],reviewer=owners[1];db.prepare('INSERT INTO account_age VALUES(?,?,?,?)').run(teen,'TEEN_13_17',1,consent);db.prepare('UPDATE accounts SET adult_attested_at=NULL WHERE id=?').run(teen);
 const youth=createYouthStore(db,true),request=youth.request(teen,{route:'SCHOOL',policyVersion:'teen-local-v1'},now);const assigned=youth.assignReviewer(request.id,reviewer,now);youth.decide(reviewer,request.id,{expectedVersion:assigned.version,decision:'APPROVED',policyVersion:'teen-local-v1'},now);
 assert.equal(getAccountById(db,teen)?.admission,'ADMITTED');assert.equal(readEvidenceMetrics(db,now).metrics,null);
 db.prepare('UPDATE accounts SET email_verified_at=NULL WHERE id=?').run(reviewer);assert.equal(getAccountById(db,teen)?.admission,'REVIEW_REQUIRED');assert.equal(readEvidenceMetrics(db,now).metrics,null);
}finally{db.close();}});
test('historical exact evidence survives catalogue removal but expiry and revocation stop its contribution',()=>{const {db}=fixture();try{
 // No catalogue tables exist: measurement uses the historical dates the operator recorded.
 assert.equal(readEvidenceMetrics(db,now).metrics?.attendanceDenominator,3);
 const expired=readEvidenceMetrics(db,new Date('2031-07-01T12:00:00Z'));assert.equal(expired.metrics?.introductions,0);
 const rows=db.prepare('SELECT id,record_json FROM student_evidence_claims').all() as {id:string;record_json:string}[];
 for(const row of rows){const claim=JSON.parse(row.record_json) as EvidenceClaim;claim.status='REVOKED';db.prepare('UPDATE student_evidence_claims SET record_json=? WHERE id=?').run(JSON.stringify(claim),row.id);}
 assert.equal(readEvidenceMetrics(db,now).metrics?.introductions,0);
}finally{db.close();}});
test('missing measurement schema fails closed and demo cohorts require explicit allowance',()=>{const db=new DatabaseSync(':memory:');try{assert.equal(readEvidenceMetrics(db,now).suppressed,true);}finally{db.close();}
 const s=fixture();try{for(const owner of ['demo-alex','demo-sam']){s.db.prepare('INSERT INTO student_profiles VALUES(?,?)').run(owner,JSON.stringify({personaId:owner,version:1,updatedAt:consent}));s.db.prepare('INSERT INTO measurement_consent VALUES(?,1,1,?)').run(owner,consent);}assert.equal(readEvidenceMetrics(s.db,now).metrics?.eligibleProfiles,3);assert.equal(readEvidenceMetrics(s.db,now,{allowDemo:true}).metrics,null);}finally{s.db.close();}
});
