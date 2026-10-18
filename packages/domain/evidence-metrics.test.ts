import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEvidenceMetrics,type EvidenceMetricOwner } from './evidence-metrics.ts';
import { EVIDENCE_LABEL,type EvidenceClaim,type EvidenceKind } from './evidence-contracts.ts';

const now=new Date('2031-06-01T12:00:00Z'),DAY=86400000;
const at=(daysAgo:number)=>new Date(now.getTime()-daysAgo*DAY).toISOString();
function claim(kind:EvidenceKind,opportunityId='date-a',daysAgo=10,patch:Partial<EvidenceClaim>={}):EvidenceClaim {
 return {id:`${kind}-${opportunityId}-${daysAgo}`,kind,opportunityId,occurrenceId:'morning',organizationId:'fictional-org',title:'Fictional date',startsAt:new Date(Date.parse(at(daysAgo))-3600000).toISOString(),endsAt:at(daysAgo),status:'RECORDED',version:3,createdAt:at(daysAgo),updatedAt:at(daysAgo),sharedAt:at(daysAgo),expiresAt:at(daysAgo-1),evidence:{reference:'synthetic:local-proof',validFrom:at(daysAgo),validUntil:at(-30)},history:[],evidenceLabel:EVIDENCE_LABEL,...patch};
}
function owners(count:number,make:(i:number)=>EvidenceClaim[]=()=>[]):EvidenceMetricOwner[]{return Array.from({length:count},(_,i)=>({owner:`private-owner-${i}`,cohort:'ADULT_ACCOUNT',consentedAt:at(100),claims:make(i)}));}

test('counts distinct profiles and pairs attendance only with the exact stored occurrence dates',()=>{
 const rows=owners(6,i=>[claim('INTRODUCTION'),claim('INTRODUCTION'),claim('DOCUMENTED_APPLICATION'),claim('ORGANIZER_ATTENDANCE','date-a',i<3?10:9)]);
 const summary=calculateEvidenceMetrics(rows,now);assert.equal(summary.suppressed,false);assert.ok(summary.metrics);
 assert.equal(summary.metrics.introductions,6);assert.equal(summary.metrics.documentedApplications,6);assert.equal(summary.metrics.introductionsOrApplications,6);
 assert.equal(summary.metrics.organizerAttendance,6);assert.equal(summary.metrics.attendanceDenominator,6);assert.equal(summary.metrics.attendanceWithPriorStep,3);assert.equal(summary.metrics.attendanceRate,.5);
 const serialized=JSON.stringify(summary);for(const secret of ['private-owner','fictional-org','synthetic:local-proof','date-a'])assert.equal(serialized.includes(secret),false);
 assert.equal(summary.evidenceLabel,EVIDENCE_LABEL);assert.equal(summary.externalVerification,'DISABLED');
});

test('only active evidence created and recorded after current opt-in contributes; future and expired attendance never counts',()=>{
 const inactive=[claim('INTRODUCTION','a',10,{status:'REVOKED'}),claim('INTRODUCTION','b',10,{status:'WITHDRAWN'}),claim('DOCUMENTED_APPLICATION','c',10,{evidence:{reference:'synthetic:expired',validFrom:at(10),validUntil:at(0)}}),claim('INTRODUCTION','d',10,{createdAt:at(101)}),claim('INTRODUCTION','e',10,{evidence:{reference:'synthetic:future',validFrom:at(-1),validUntil:at(-10)}}),claim('ORGANIZER_ATTENDANCE','f',-2),claim('ORGANIZER_ATTENDANCE','g',101)];
 const summary=calculateEvidenceMetrics(owners(3,()=>inactive),now);assert.ok(summary.metrics);assert.equal(summary.metrics.introductionsOrApplications,0);assert.equal(summary.metrics.organizerAttendance,0);assert.equal(summary.metrics.attendanceRate,null);assert.equal(summary.metrics.repeat.observedParticipants,0);
 const optedInAgain=owners(3,()=>[claim('INTRODUCTION')]).map(row=>({...row,consentedAt:at(5)}));assert.equal(calculateEvidenceMetrics(optedInAgain,now).metrics?.introductions,0);
});

test('repeat uses distinct opportunities, a complete 28-day window and bounded historical evidence',()=>{
 const rows=owners(6,i=>[claim('INTRODUCTION','date-a',20),claim('ORGANIZER_ATTENDANCE','date-a',40),claim('ORGANIZER_ATTENDANCE',i<3?'date-b':'date-a',20)]);
 const summary=calculateEvidenceMetrics(rows,now);assert.ok(summary.metrics);assert.equal(summary.metrics.repeat.observedParticipants,6);assert.equal(summary.metrics.repeat.matureParticipants,6);assert.equal(summary.metrics.repeat.partialParticipants,0);assert.equal(summary.metrics.repeat.repeatedWithin28Days,3);assert.equal(summary.metrics.repeat.rate,.5);
 const partial=calculateEvidenceMetrics(owners(3,()=>[claim('ORGANIZER_ATTENDANCE','recent',27)]),now);assert.equal(partial.metrics?.repeat.matureParticipants,0);assert.equal(partial.metrics?.repeat.partialParticipants,3);assert.equal(partial.metrics?.repeat.rate,null);
 const outsideHistory=calculateEvidenceMetrics(owners(3,()=>[claim('ORGANIZER_ATTENDANCE','older',91)]),now);assert.equal(outsideHistory.metrics?.repeat.observedParticipants,0);
});

test('suppresses small cohorts, outcome groups, complements, intersections and conditional denominator remainders',()=>{
 const cases:EvidenceMetricOwner[][]=[owners(2),owners(6,i=>i===0?[claim('INTRODUCTION')]:[]),owners(6,i=>i<5?[claim('INTRODUCTION')]:[]),owners(8,i=>[...(i<3?[claim('INTRODUCTION')]:[]),...(i>=2&&i<5?[claim('DOCUMENTED_APPLICATION')]:[])]),owners(8,i=>[...(i<4?[claim('INTRODUCTION')]:[]),...(i<3?[claim('ORGANIZER_ATTENDANCE')]:[])])];
 for(const rows of cases){const summary=calculateEvidenceMetrics(rows,now);assert.equal(summary.suppressed,true);assert.equal(summary.metrics,null);assert.deepEqual(summary.cohorts.map(group=>group.metrics),[null,null]);}
 const safe=calculateEvidenceMetrics(owners(6,i=>i<3?[claim('INTRODUCTION')]:[]),now);assert.equal(safe.suppressed,false);assert.equal(safe.metrics?.introductions,3);
});

test('suppresses cohort partition subtraction and does not mutate duplicate owner inputs',()=>{
 const rows=owners(6,()=>[claim('INTRODUCTION')]);rows[0].cohort='DEMO';assert.equal(calculateEvidenceMetrics(rows,now).suppressed,true);
 const original=owners(3,()=>[claim('INTRODUCTION')]),before=JSON.stringify(original);const summary=calculateEvidenceMetrics([...original,...original],now);assert.equal(JSON.stringify(original),before);assert.equal(summary.metrics?.eligibleProfiles,3);assert.equal(summary.metrics?.introductions,3);
});
