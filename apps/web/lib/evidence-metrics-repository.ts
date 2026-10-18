import type { DatabaseSync } from 'node:sqlite';
import type { StudentOwnerId,StudentProfile } from '../../../packages/domain/app-contracts.ts';
import type { EvidenceClaim } from '../../../packages/domain/evidence-contracts.ts';
import { calculateEvidenceMetrics,type EvidenceMetricOwner } from '../../../packages/domain/evidence-metrics.ts';
import { getAccountById } from './account-repository.ts';
import { isAccountOwner,readPrivacyState } from './privacy-store.ts';
/** Read-only, fail closed on current cohort admission. No private row is returned. */
export function readEvidenceMetrics(db:DatabaseSync,now=new Date(),options:{allowDemo?:boolean}={}) {
 const exists=(table:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
 if(!['student_profiles','measurement_consent','student_evidence_claims'].every(exists))return calculateEvidenceMetrics([],now);
 const rows=db.prepare('SELECT p.persona_id AS owner,p.profile_json,c.consented_at FROM student_profiles p JOIN measurement_consent c ON c.owner=p.persona_id WHERE c.enabled=1 AND c.consented_at IS NOT NULL').all() as {owner:StudentOwnerId;profile_json:string;consented_at:string}[];
 const input:EvidenceMetricOwner[]=[];
 for(const row of rows){
  if(isAccountOwner(row.owner)){const account=exists('accounts')?getAccountById(db,row.owner):null;if(!account||account.role!=='STUDENT'||!account.emailVerified||!account.adultConfirmed||account.ageBand!=='ADULT'||account.admission!=='ADMITTED')continue;}
  else if(!options.allowDemo||!['demo-alex','demo-sam'].includes(row.owner))continue;
  const profile=JSON.parse(row.profile_json) as StudentProfile;
  if(isAccountOwner(row.owner)&&(!exists('student_privacy')||profile.preferences?.schoolStage!=='HIGH_SCHOOL'))continue;
  if(!readPrivacyState(db,row.owner,profile).storage)continue;
  const claims=(db.prepare('SELECT record_json FROM student_evidence_claims WHERE owner=?').all(row.owner) as {record_json:string}[]).map(item=>JSON.parse(item.record_json) as EvidenceClaim);
  input.push({owner:row.owner,cohort:isAccountOwner(row.owner)?'ADULT_ACCOUNT':'DEMO',consentedAt:row.consented_at,claims});
 }
 return calculateEvidenceMetrics(input,now);
}
