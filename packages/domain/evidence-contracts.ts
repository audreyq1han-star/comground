/** All records in this workflow are local synthetic examples, never certified outcomes. */
export const EVIDENCE_LABEL = 'SYNTHETIC_NOT_VERIFIED' as const;
export const FAILED_FIT_REASONS = ['WRONG_AGE','CLOSED','TIMING','TRAVEL','NO_RESPONSE','OTHER'] as const;
export type FailedFitReason = typeof FAILED_FIT_REASONS[number];
export type EvidenceKind = 'INTRODUCTION' | 'DOCUMENTED_APPLICATION' | 'ORGANIZER_ATTENDANCE';
export type ExactEvidenceOccurrence = { opportunityId:string; occurrenceId:string; title:string; startsAt:string; endsAt:string; organizationId:string };
export type EvidenceAudit = { action:string; actor:'OWNER'|'OPERATOR'; at:string; version:number };
export type FailedFitRecord = ExactEvidenceOccurrence & { id:string; reason:FailedFitReason; version:number; createdAt:string; updatedAt:string; history:{reason:FailedFitReason;at:string;version:number}[]; evidenceLabel:typeof EVIDENCE_LABEL };
export type FailedFitInput = { opportunityId:string;occurrenceId:string;reason:FailedFitReason };
export type FailedFitUpdate = { expectedVersion:number;reason:FailedFitReason };
export type EvidenceClaim = ExactEvidenceOccurrence & {
  id:string;kind:EvidenceKind;status:'OPEN'|'ASSIGNED'|'RECORDED'|'WITHDRAWN'|'REVOKED'|'EXPIRED';version:number;
  createdAt:string;updatedAt:string;expiresAt:string;sharedAt:string;
  evidence:{reference:string;validFrom:string;validUntil:string}|null;
  history:EvidenceAudit[];evidenceLabel:typeof EVIDENCE_LABEL;
};
export type CreateEvidenceClaimInput = {opportunityId:string;occurrenceId:string;kind:EvidenceKind;sharingConsent:true};
export type CreateEvidenceClaimResult = {data:EvidenceClaim;shareToken:string};
export type RecordEvidenceInput = {expectedVersion:number;action:'RECORD';evidenceReference:string;validUntil:string} | {expectedVersion:number;action:'REVOKE'};
export type ScopeEvidenceKind = 'SCHOOL_PROGRAM_APPROVAL'|'ORGANIZER_REVIEW';
export type ScopeEvidenceRecord = {
  id:string;kind:ScopeEvidenceKind;organizationId:string;opportunityId:string|null;programId:string|null;
  status:'ACTIVE'|'REVOKED'|'EXPIRED';version:number;evidenceReference:string;validFrom:string;validUntil:string;
  recordedBy:string;createdAt:string;updatedAt:string;history:(EvidenceAudit&{actorReference:string})[];evidenceLabel:typeof EVIDENCE_LABEL;
};
export type CreateScopeEvidenceInput = {kind:ScopeEvidenceKind;organizationId:string;opportunityId:string|null;programId:string|null;evidenceReference:string;validUntil:string};
export type EvidenceExport = {failedFits:FailedFitRecord[];claims:EvidenceClaim[];evidenceLabel:typeof EVIDENCE_LABEL};
export type EvidenceOverview = EvidenceExport & {externalVerification:'DISABLED';syntheticWorkflowEnabled:boolean};
export type OperatorEvidenceOverview = {claims:EvidenceClaim[];scopeRecords:ScopeEvidenceRecord[];externalVerification:'DISABLED';syntheticWorkflowEnabled:boolean};
