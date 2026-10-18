import { EVIDENCE_LABEL, type EvidenceClaim } from './evidence-contracts.ts';
const DAY=86400000;
export type EvidenceCohort='ADULT_ACCOUNT'|'DEMO';
/** Internal calculation input only. Never return owner keys from an HTTP route. */
export type EvidenceMetricOwner={owner:string;cohort:EvidenceCohort;consentedAt:string;claims:EvidenceClaim[]};
export type EvidenceMetricValues={eligibleProfiles:number;introductions:number;documentedApplications:number;introductionsOrApplications:number;organizerAttendance:number;attendanceDenominator:number;attendanceWithPriorStep:number;attendanceRate:number|null;repeat:{observedParticipants:number;matureParticipants:number;partialParticipants:number;repeatedWithin28Days:number;rate:number|null}};
export type EvidenceMetricsSummary={generatedAt:string;evidenceLabel:typeof EVIDENCE_LABEL;externalVerification:'DISABLED';windowDays:28;historyDays:90;minimumCohort:3;studentIdentitiesIncluded:false;suppressed:boolean;suppressionReason:string|null;metrics:EvidenceMetricValues|null;cohorts:{cohort:EvidenceCohort;metrics:EvidenceMetricValues|null}[];definitions:{denominator:string;attendance:string;repeat:string;consent:string;limitations:string}};
function compute(rows:EvidenceMetricOwner[],now:Date){
 const cutoff=now.getTime()-28*DAY,historyCutoff=now.getTime()-90*DAY;
 const owners=new Set(rows.map(row=>row.owner)),introductions=new Set<string>(),applications=new Set<string>(),steps=new Set<string>(),attendance=new Set<string>(),denominator=new Set<string>(),paired=new Set<string>(),observed=new Set<string>(),mature=new Set<string>(),partial=new Set<string>(),repeated=new Set<string>();
 for(const row of rows){
  const consent=Date.parse(row.consentedAt);if(!Number.isFinite(consent)||consent>now.getTime())continue;
  const active=row.claims.filter(claim=>claim.status==='RECORDED'&&claim.evidenceLabel===EVIDENCE_LABEL&&claim.evidence&&Date.parse(claim.createdAt)>=consent&&Date.parse(claim.evidence.validFrom)>=consent&&Date.parse(claim.evidence.validFrom)<=now.getTime()&&Date.parse(claim.evidence.validUntil)>now.getTime()&&Number.isFinite(Date.parse(claim.startsAt))&&Date.parse(claim.endsAt)>Date.parse(claim.startsAt));
  const recent=active.filter(claim=>Date.parse(claim.evidence!.validFrom)>=cutoff);
  if(recent.some(claim=>claim.kind==='INTRODUCTION'))introductions.add(row.owner);
  if(recent.some(claim=>claim.kind==='DOCUMENTED_APPLICATION'))applications.add(row.owner);
  if(introductions.has(row.owner)||applications.has(row.owner))steps.add(row.owner);
  const ended=active.filter(claim=>Date.parse(claim.endsAt)<=now.getTime()&&Date.parse(claim.endsAt)>=Math.max(cutoff,consent));
  const stepKeys=new Set(ended.filter(claim=>claim.kind==='INTRODUCTION'||claim.kind==='DOCUMENTED_APPLICATION').map(claim=>`${claim.opportunityId}|${claim.occurrenceId}|${claim.startsAt}|${claim.endsAt}`));
  if(stepKeys.size)denominator.add(row.owner);
  const attended=ended.filter(claim=>claim.kind==='ORGANIZER_ATTENDANCE');
  if(attended.length)attendance.add(row.owner);
  if(attended.some(claim=>stepKeys.has(`${claim.opportunityId}|${claim.occurrenceId}|${claim.startsAt}|${claim.endsAt}`)))paired.add(row.owner);
  const distinct=new Map<string,number>();
  for(const claim of active.filter(claim=>claim.kind==='ORGANIZER_ATTENDANCE')){const at=Date.parse(claim.endsAt);if(at>now.getTime()||at<Math.max(historyCutoff,consent))continue;distinct.set(claim.opportunityId,Math.min(at,distinct.get(claim.opportunityId)??at));}
  const dates=[...distinct.values()].sort((a,b)=>a-b);if(!dates.length)continue;observed.add(row.owner);
  if(dates[0]+28*DAY<=now.getTime()){mature.add(row.owner);if(dates.length>1&&dates[1]<=dates[0]+28*DAY)repeated.add(row.owner);}else partial.add(row.owner);
 }
 const metrics:EvidenceMetricValues={eligibleProfiles:owners.size,introductions:introductions.size,documentedApplications:applications.size,introductionsOrApplications:steps.size,organizerAttendance:attendance.size,attendanceDenominator:denominator.size,attendanceWithPriorStep:paired.size,attendanceRate:denominator.size?paired.size/denominator.size:null,repeat:{observedParticipants:observed.size,matureParticipants:mature.size,partialParticipants:partial.size,repeatedWithin28Days:repeated.size,rate:mature.size?repeated.size/mature.size:null}};
 // Published unions, subsets and ratios also expose these differences. Check them
 // explicitly so an apparently safe total cannot reveal one or two participants.
 const difference=(left:Set<string>,right:Set<string>)=>new Set([...left].filter(owner=>!right.has(owner)));
 const intersection=new Set([...introductions].filter(owner=>applications.has(owner)));
 return {metrics,owners,cells:[introductions,applications,steps,attendance,denominator,paired,observed,mature,partial,repeated,intersection,difference(introductions,applications),difference(applications,introductions),difference(denominator,paired),difference(attendance,paired),difference(mature,repeated)]};
}
/** Pure calculation. Suppress all related totals/partitions together; hidden values are never zeros. */
export function calculateEvidenceMetrics(rows:EvidenceMetricOwner[],now=new Date()):EvidenceMetricsSummary {
 const unique=new Map<string,EvidenceMetricOwner>();for(const row of rows)if((row.cohort==='ADULT_ACCOUNT'||row.cohort==='DEMO')&&Number.isFinite(Date.parse(row.consentedAt))&&Date.parse(row.consentedAt)<=now.getTime()){const previous=unique.get(row.owner);if(previous&&previous.cohort===row.cohort)previous.claims.push(...row.claims);else if(!previous)unique.set(row.owner,{...row,claims:[...row.claims]});}
 const values=[...unique.values()],all=compute(values,now),groups=(['ADULT_ACCOUNT','DEMO'] as const).map(cohort=>({cohort,...compute(values.filter(row=>row.cohort===cohort),now)}));
 const small=(size:number)=>size>0&&size<3;
 const suppressed=all.owners.size<3||groups.some(group=>small(group.owners.size)||small(all.owners.size-group.owners.size))||[all,...groups].some(group=>group.cells.some(cell=>small(cell.size)||small(group.owners.size-cell.size)));
 return {generatedAt:now.toISOString(),evidenceLabel:EVIDENCE_LABEL,externalVerification:'DISABLED',windowDays:28,historyDays:90,minimumCohort:3,studentIdentitiesIncluded:false,suppressed,suppressionReason:suppressed?'Counts and rates are hidden together when the cohort, any non-empty metric group, or its complement contains fewer than three currently opted-in profiles. Hidden values are not zeros.':null,metrics:suppressed?null:all.metrics,cohorts:groups.map(group=>({cohort:group.cohort,metrics:suppressed?null:group.metrics})),definitions:{denominator:'Currently stored, admitted adult high-school accounts and local demo profiles with explicit active measurement consent. Introduction/application counts use evidence recorded in the last 28 days.',attendance:'Attendance count uses exact occurrence end dates in the last 28 days. The rate denominator is distinct profiles with current introduction/application evidence for an ended date; its numerator requires current attendance evidence for the same opportunity, occurrence and stored dates.',repeat:'Up to 90 days of currently valid attendance evidence. Denominator: profiles with a full 28-day observation window after their first ended opportunity. Numerator: a second distinct opportunity within that window. Partial windows stay separate; repeat sessions of one opportunity do not count as another opportunity.',consent:'Teen accounts are excluded. Profile deletion, revoked admission, measurement opt-out and expired/revoked evidence remove contributions. Claims created before the current measurement opt-in are excluded; re-enabling consent does not restore older contributions.',limitations:'Synthetic operator records are not independent real-world verification, certified hours or school credit. These 28-day local measures adapt the original pilot metrics and do not satisfy their expansion targets. Self-reports remain separate.'}};
}
