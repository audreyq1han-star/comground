import type { FixtureRecord } from './contracts.ts';
export type SourceMethod = 'JSON' | 'CSV' | 'HTML' | 'API';
export type SourcePermissionState = 'ACTIVE' | 'PAUSED' | 'REVOKED';
export type SourcePermission = { sourceId:string; version:number; state:SourcePermissionState; method:SourceMethod; origin:string; pathPrefix:string; fields:string[]; attribution:string; evidence:string; ownerId:string; removalRoute:string; cadenceMinutes:number; expiresAt:string; updatedAt:string; synthetic:true };
export type SourcePermissionInput = Omit<SourcePermission,'sourceId'|'version'|'updatedAt'> & {expectedVersion:number; reason:string};
export type SourceRunState = 'QUEUED'|'RUNNING'|'RETRY_WAIT'|'SUCCEEDED'|'DEAD_LETTER';
export type SourceRun = { id:string; sourceId:string; key:string; version:number; state:SourceRunState; cursor:string|null; attempts:number; nextAttemptAt:string; heartbeatAt:string|null; createdAt:string; updatedAt:string; errorCode:string|null; accepted:number; quarantined:number };
export type SourceStage = {id:string;runId:string;sourceId:string;externalId:string|null;state:'STAGED'|'QUARANTINED'|'IMPORTED';errorCode:string|null;opportunityId:string|null;record:FixtureRecord|null};
export type SourceHealth = {sourceId:string;permission:SourcePermission|null;queued:number;deadLetters:number;lastSuccessAt:string|null;heartbeatAt:string|null;lagMinutes:number|null;oldestQueueMinutes:number|null;missedHeartbeat:boolean;due:boolean;quotaRemaining:number;reviewAgeMinutes:{samples:number;median:number|null;p90:number|null};reviewMinutes:{samples:number;median:number|null;p90:number|null}};
export type SourceMerge = {id:string;fromId:string;toId:string;version:number;active:boolean;actorId:string;reason:string;at:string;reversedAt:string|null;events:{version:number;action:'MERGE'|'REVERSE';actorId:string;reason:string;at:string}[]};
export type SourceDuplicateCandidate = {fromId:string;toId:string;fromVersion:number;toVersion:number;title:string;sameDates:boolean;reason:'EXACT_URL'|'SIMILAR_TITLE'};
export type MetricDistribution = {samples:number;medianHours:number|null;p90Hours:number|null};
export type SourceOperationalMetrics = {
  synthetic:true;asOf:string;
  sync:{windowStart:string;windowEnd:string;sourceCount:number;dueIntervals:number;onTimeSuccesses:number;missedIntervals:number;lateSuccesses:number;failedIntervals:number;pendingIntervals:number;onTimePercent:number|null;unknownHistorySources:number;partialHistorySources:number;unobservedSourceHours:number;knownAuthorizedHours:number};
  changes:{windowStart:string;windowEnd:string;detectedInWindow:number;completed:MetricDistribution;outstanding:MetricDistribution;olderOutstanding:number;unknownLegacyChanges:number;excludedAliasSnapshots:number};
  workload:{windowStart:string;windowEnd:string;entries:number;reviewers:number;minutes:number;hours:number;scope:'SOURCE_REVIEW_ONLY'};
};
export type SourceControlOverview = {sources:{id:string;name:string;url:string}[];health:SourceHealth[];runs:SourceRun[];stages:SourceStage[];merges:SourceMerge[];duplicates:SourceDuplicateCandidate[];permissions:{sourceId:string;version:number;actorId:string;reason:string;at:string;permission:SourcePermission}[];metrics:SourceOperationalMetrics};

export const SOURCE_RECORD_FIELDS = ['title','summary','category','interests','minAge','maxAge','startsAt','endsAt','timezone','mode','area','fee','requiresTraining','requiresGuardian','schoolCreditApproved','signupUrl','sourceUpdatedAt','confirmedAt','validUntil','isCancelled','occurrences','organization'];
