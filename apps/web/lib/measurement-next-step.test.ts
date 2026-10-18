import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRepository } from './repository.ts';
import { createStudentRepository } from './student-repository.ts';
import { fixtureList } from '../../../packages/domain/fixtures.ts';
import { randomUUID } from 'node:crypto';
import { createAccountStore } from './account-repository.ts';
import { createPrivacyStore } from './privacy-store.ts';
import { initializeEvidenceSchema } from './evidence-repository.ts';
import { createMeasurementStore, MEASUREMENT_RULES_VERSION } from './measurement-repository.ts';
import { EVIDENCE_LABEL, type EvidenceClaim } from '../../../packages/domain/evidence-contracts.ts';
import type { AccountId } from '../../../packages/domain/identity-contracts.ts';

const DAY=86400000, now=new Date('2031-06-01T12:00:00Z'), consent='2031-05-01T12:00:00.000Z';
const presented=new Date(now.getTime()-2*DAY), ack=new Date(presented.getTime()+DAY).toISOString();
const ref={opportunityId:'garden',occurrenceId:'morning',version:2}, dates={startsAt:'2031-06-04T09:00:00.000Z',endsAt:'2031-06-04T10:00:00.000Z'};
function setup(count=3,dated=true){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');createAccountStore(db,{notificationSink(){}});
 db.exec('CREATE TABLE student_profiles(persona_id TEXT PRIMARY KEY,profile_json TEXT NOT NULL); CREATE TABLE published_occurrence_snapshots(opportunity_id TEXT NOT NULL,occurrence_id TEXT NOT NULL,version INTEGER NOT NULL,snapshot_json TEXT NOT NULL,PRIMARY KEY(opportunity_id,occurrence_id,version))');
 if(dated)db.prepare('INSERT INTO published_occurrence_snapshots VALUES(?,?,?,?)').run(ref.opportunityId,ref.occurrenceId,ref.version,JSON.stringify({id:ref.opportunityId,occurrenceId:ref.occurrenceId,version:ref.version,...dates}));
 const privacy=createPrivacyStore(db);initializeEvidenceSchema(db);const store=createMeasurementStore(db),owners:AccountId[]=[];
 for(let i=0;i<count;i++){
  const owner:AccountId=`account-${randomUUID()}`;owners.push(owner);db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?)').run(owner,`student-${i}@example.invalid`,'synthetic-only','STUDENT',consent,consent,consent,consent);
  db.prepare('INSERT INTO student_profiles VALUES(?,?)').run(owner,JSON.stringify({personaId:owner,version:1,preferences:{schoolStage:'HIGH_SCHOOL',ageMin:18,ageMax:24},consentVersion:'adult-account-v1',consentedAt:consent,updatedAt:consent}));
  privacy.save(owner,{policyVersion:'adult-account-v1',adultConfirmed:true,personalization:false,aiExplanations:false},new Date(consent));store.setConsent(owner,{enabled:true,expectedVersion:0,expectedProfileVersion:1},new Date(consent));
 }
 const expose=(owner:AccountId,at=presented,rulesVersion=MEASUREMENT_RULES_VERSION)=>store.recordExposure({owner,requestId:randomUUID(),issuedAt:at.toISOString(),consentVersion:store.consent(owner).version,profileVersion:1,rulesVersion,items:[ref]},at);
 const claim=(owner:AccountId,changes:Partial<EvidenceClaim>={})=>{
  const value:EvidenceClaim={id:randomUUID(),kind:'INTRODUCTION',opportunityId:ref.opportunityId,occurrenceId:ref.occurrenceId,organizationId:'private-org',title:'Private historic title',...dates,status:'RECORDED',version:3,createdAt:presented.toISOString(),sharedAt:presented.toISOString(),updatedAt:ack,expiresAt:ack,evidence:{reference:'synthetic:private-reference',validFrom:ack,validUntil:'2031-07-01T12:00:00.000Z'},history:[],evidenceLabel:EVIDENCE_LABEL,...changes};
  db.prepare('INSERT INTO student_evidence_claims(id,owner,record_json) VALUES(?,?,?)').run(value.id,owner,JSON.stringify(value));return value;
 };
 const editClaims=(change:(claim:EvidenceClaim)=>void)=>{for(const row of db.prepare('SELECT id,record_json FROM student_evidence_claims').all() as {id:string;record_json:string}[]){const c=JSON.parse(row.record_json) as EvidenceClaim;change(c);db.prepare('UPDATE student_evidence_claims SET record_json=? WHERE id=?').run(JSON.stringify(c),row.id);}};
 const applied=(owner:AccountId,at=new Date(ack),eventDates=dates)=>store.recordOutcome(owner,{...ref,...eventDates,kind:'APPLIED',eventKey:randomUUID()},at);
 return {db,store,owners,expose,claim,editClaims,applied};
}

test('seven-day union deduplicates exact-date application and acknowledged synthetic introduction, keeps recipient denominator, and exports no private identifiers',()=>{const s=setup(6);try{
 for(const [i,owner] of s.owners.entries()){s.expose(owner);if(i<3){s.applied(owner);s.claim(owner);s.expose(owner,new Date(presented.getTime()+1000));}}
 const summary=s.store.summary(now),m=summary.live.metrics!;assert.equal(summary.live.suppressed,false);assert.equal(m.recipients,6);
 assert.deepEqual(m.nextStep,{appliedExactWithin7Days:3,syntheticIntroductionsWithin7Days:3,bothWithin7Days:3,recipientsWithin7Days:3,unlinkedAppliedWithin7Days:0,rate:.5,evidenceKind:'SELF_REPORT_OR_SYNTHETIC_NOT_VERIFIED'});
 for(const value of [...s.owners,'@example.invalid','private-org','synthetic:private-reference','Private historic title'])assert.equal(JSON.stringify(summary).includes(value),false);
}finally{s.db.close();}});

test('immutable shown version dates survive later publication/removal and disagreeing reschedules cannot join or record applications',()=>{const s=setup();try{
 for(const owner of s.owners){const batch=s.expose(owner);assert.deepEqual(batch.items,[{...ref,...dates}]);s.claim(owner);s.applied(owner,new Date(ack),{startsAt:'2031-06-05T09:00:00Z',endsAt:'2031-06-05T10:00:00Z'});assert.equal(s.store.exportData(owner,now).outcomes.length,0);}
 s.db.prepare('INSERT INTO published_occurrence_snapshots VALUES(?,?,?,?)').run(ref.opportunityId,ref.occurrenceId,3,JSON.stringify({id:ref.opportunityId,occurrenceId:ref.occurrenceId,version:3,startsAt:'2031-06-05T09:00:00Z',endsAt:'2031-06-05T10:00:00Z'}));s.db.exec('DELETE FROM published_occurrence_snapshots');
 assert.equal(s.store.summary(now).live.metrics?.nextStep.syntheticIntroductionsWithin7Days,3);
 s.editClaims(c=>{c.startsAt='2031-06-05T09:00:00Z';c.endsAt='2031-06-05T10:00:00Z';});assert.equal(s.store.summary(now).live.metrics?.nextStep.recipientsWithin7Days,0);
 for(const owner of s.owners)s.applied(owner);assert.equal(s.store.summary(now).live.metrics?.nextStep.appliedExactWithin7Days,3);
}finally{s.db.close();}});

test('legacy undated presentations keep labeled application history but never receive guessed current dates or join the union',()=>{const s=setup(3,false);try{
 for(const owner of s.owners){s.expose(owner);s.claim(owner);s.applied(owner);}
 const m=s.store.summary(now).live.metrics!;assert.equal(m.appliedWithin7Days,3);assert.equal(m.nextStep.unlinkedAppliedWithin7Days,3);assert.equal(m.nextStep.recipientsWithin7Days,0);
}finally{s.db.close();}});

test('introduction acknowledgement is inclusive at seven days and excludes pre-presentation, future and late acknowledgements',()=>{const s=setup();try{
 const at=new Date(now.getTime()-7*DAY);for(const owner of s.owners){s.expose(owner,at);s.claim(owner,{createdAt:at.toISOString()});}
 for(const [ackAt,expected] of [[now.toISOString(),3],[new Date(now.getTime()+1).toISOString(),0],[new Date(at.getTime()-1).toISOString(),0]] as const){s.editClaims(c=>{c.evidence!.validFrom=ackAt;});assert.equal(s.store.summary(now).live.metrics?.nextStep.recipientsWithin7Days,expected);}
 s.editClaims(c=>{c.evidence!.validFrom=new Date(now.getTime()+1).toISOString();});assert.equal(s.store.summary(new Date(now.getTime()+2)).live.metrics?.nextStep.recipientsWithin7Days,0);
}finally{s.db.close();}});

test('revoked, withdrawn, expired, pre-opt-in, wrong-kind and non-synthetic claims cannot contribute',()=>{const s=setup();try{
 for(const owner of s.owners){s.expose(owner);s.claim(owner);}
 const reset=()=>s.editClaims(c=>{c.status='RECORDED';c.kind='INTRODUCTION';c.createdAt=presented.toISOString();c.evidenceLabel=EVIDENCE_LABEL;c.evidence!.validFrom=ack;c.evidence!.validUntil='2031-07-01T12:00:00.000Z';});
 for(const change of [(c:EvidenceClaim)=>{c.status='REVOKED';},(c:EvidenceClaim)=>{c.status='WITHDRAWN';},(c:EvidenceClaim)=>{c.evidence!.validUntil=now.toISOString();},(c:EvidenceClaim)=>{c.createdAt='2031-04-30T12:00:00Z';},(c:EvidenceClaim)=>{c.kind='DOCUMENTED_APPLICATION';},(c:EvidenceClaim)=>{c.evidenceLabel='unverified' as typeof EVIDENCE_LABEL;}]){reset();s.editClaims(change);assert.equal(s.store.summary(now).live.metrics?.nextStep.recipientsWithin7Days,0);}
 reset();assert.equal(s.store.summary(now).live.metrics?.nextStep.recipientsWithin7Days,3);
}finally{s.db.close();}});

test('current consent, storage, adult high-school admission and fresh opt-in are required at summary time',()=>{const s=setup();try{
 for(const owner of s.owners){s.expose(owner);s.claim(owner);}
 for(const change of ["UPDATE measurement_consent SET enabled=0","UPDATE student_privacy SET policy_version='obsolete'","UPDATE accounts SET email_verified_at=NULL","UPDATE accounts SET adult_attested_at=NULL"]){s.db.exec('SAVEPOINT test_change');s.db.exec(change);assert.equal(s.store.summary(now).live.metrics,null);s.db.exec('ROLLBACK TO test_change; RELEASE test_change');}
 s.db.prepare('INSERT INTO account_age VALUES(?,?,?,?)').run(s.owners[0],'TEEN_13_17',1,consent);assert.equal(s.store.summary(now).live.metrics,null);s.db.exec('DELETE FROM account_age');
 for(const owner of s.owners){s.store.setConsent(owner,{enabled:false,expectedVersion:1,expectedProfileVersion:1},presented);s.store.setConsent(owner,{enabled:true,expectedVersion:2,expectedProfileVersion:1},new Date(ack));s.expose(owner,new Date(ack));}
 assert.equal(s.store.summary(now).live.metrics?.nextStep.recipientsWithin7Days,0,'older claims cannot reappear after fresh opt-in');
}finally{s.db.close();}});

test('weekly presentation cohort has its own timing/sample/no-match metrics alongside retained thirty-day report',()=>{const s=setup(6);try{
 for(const [i,owner] of s.owners.entries()){const at=i<3?presented:new Date(now.getTime()-10*DAY),batch=s.expose(owner,at);s.store.feedback(owner,{exposureId:batch.id,opportunityId:ref.opportunityId,occurrenceId:ref.occurrenceId,verdict:'RELEVANT'},new Date(at.getTime()+3600000));}
 const summary=s.store.summary(now);assert.equal(summary.periodVersion,'presentation-cohorts-v2');assert.equal(summary.live.metrics?.recipients,6);assert.equal(summary.weekly.metrics?.recipients,3);assert.equal(summary.weekly.metrics?.noMatchOnlySeekers,0);assert.equal(summary.weekly.metrics?.firstUsefulMatch.sampleCount,3);assert.equal(summary.weekly.metrics?.firstUsefulMatch.medianHours,(presented.getTime()+3600000-Date.parse(consent))/3600000);assert.equal(summary.weekly.metrics?.firstUsefulMatch.p90Hours,summary.weekly.metrics?.firstUsefulMatch.medianHours);
}finally{s.db.close();}});

test('suppression prevents deriving small APPLIED/introduction intersections even when both totals are at least three',()=>{const s=setup(6);try{
 for(const [i,owner] of s.owners.entries()){s.expose(owner);if(i<4)s.applied(owner);if(i>=2)s.claim(owner);}
 const summary=s.store.summary(now);assert.equal(summary.live.metrics,null);assert.equal(summary.weekly.metrics,null);assert.ok(summary.channels.every(c=>c.metrics===null));assert.deepEqual(summary.rulesVersions,[]);
}finally{s.db.close();}});

test('overlapping rule cohorts suppress one/two-person complements across all published totals',()=>{const s=setup(6);try{
 for(const [i,owner] of s.owners.entries()){if(i<4)s.expose(owner,presented,'policy-a');if(i>=2)s.expose(owner,presented,'policy-b');}
 assert.equal(s.store.summary(now).live.metrics,null);assert.equal(s.store.summary(now).weekly.metrics,null);
}finally{s.db.close();}});

test('owner export retains exact presentation dates and opt-out/delete cascade all owned join data',()=>{const s=setup();try{
 for(const owner of s.owners){s.expose(owner);s.claim(owner);s.applied(owner);}
 assert.deepEqual(s.store.exportData(s.owners[0],now).exposures[0].items,[{...ref,...dates}]);
 s.store.setConsent(s.owners[0],{enabled:false,expectedVersion:1,expectedProfileVersion:1},now);assert.equal(s.store.exportData(s.owners[0],now).exposures.length,0);assert.equal(s.store.exportData(s.owners[0],now).outcomes.length,0);
 s.db.prepare('DELETE FROM student_profiles WHERE persona_id=?').run(s.owners[1]);assert.equal((s.db.prepare('SELECT COUNT(*) AS n FROM student_evidence_claims WHERE owner=?').get(s.owners[1]) as {n:number}).n,0);assert.equal(s.store.summary(now).live.metrics,null);
}finally{s.db.close();}});


test('student activity APPLIED hook carries original occurrence dates into the exact presentation join',()=>{
 const directory=mkdtempSync(join(tmpdir(),'measurement-student-')),filename=join(directory,'app.sqlite');
 const db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON');createAccountStore(db,{notificationSink(){}});
 const supply=createRepository(filename);supply.seedDemo(fixtureList(now),now);const student=createStudentRepository(filename,supply,{seedExamples:false});
 try {
  const owner:AccountId=`account-${randomUUID()}`;db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?)').run(owner,'hook@example.invalid','synthetic-only','STUDENT',consent,consent,consent,consent);
  const profile=student.saveProfile(owner,{expectedVersion:0,preferences:{schoolStage:'HIGH_SCHOOL',ageMin:18,ageMax:20,availableFrom:now.toISOString(),availableUntil:new Date(now.getTime()+30*DAY).toISOString(),mode:'ANY',area:'',interests:['environment'],maxFee:0,hasTraining:false,hasGuardian:false,requiresSchoolCredit:false},goal:'EXPLORE',storageConsent:true,privacyConsent:{policyVersion:'adult-account-v1',adultConfirmed:true,personalization:false}},now);
  student.measurement.setConsent(owner,{enabled:true,expectedVersion:0,expectedProfileVersion:profile.version},now);
  const item=supply.listPublic({},now).data[0];assert.ok(item);assert.ok(item.occurrenceId);
  const exposure=student.measurement.recordExposure({owner,requestId:randomUUID(),issuedAt:now.toISOString(),consentVersion:1,profileVersion:profile.version,rulesVersion:MEASUREMENT_RULES_VERSION,items:[{opportunityId:item.id,occurrenceId:item.occurrenceId,version:item.version}]},now);
  assert.equal(exposure.items[0].startsAt,item.startsAt);assert.equal(exposure.items[0].endsAt,item.endsAt);
  const activity=student.handoff(owner,item.id,now,item.occurrenceId);student.updateActivity(owner,activity.id,{expectedVersion:activity.version,status:'APPLIED'},now);
  const outcome=student.measurement.exportData(owner,now).outcomes.find(o=>o.kind==='APPLIED');assert.equal(outcome?.exposureId,exposure.id);assert.equal(outcome?.evidenceKind,'SELF_REPORTED');
 } finally {student.close();supply.close();db.close();rmSync(directory,{recursive:true,force:true});}
});
