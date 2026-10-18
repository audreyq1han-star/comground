import type { EligibilityResult } from './contracts.ts';
export type MatchingEvaluationCase = { id:string; title:string; expected:EligibilityResult['status']; expectedReason:string|null; actual:EligibilityResult['status']|'ERROR'; reasonCodes:string[]; reasons:string[]; passed:boolean };
export type MatchingEvaluationDecision = { version:number; decision:'APPROVE'|'REJECT'; reason:string; actor:string; at:string };
export type MatchingEvaluationSummary = { id:string; createdAt:string; createdBy:string; caseSetVersion:string; caseSetHash:string; rulesVersion:string; fixtureClock:string; total:number; passed:number; failed:number; version:number; status:'PENDING'|'APPROVED'|'REJECTED'; evidenceLabel:'Synthetic offline eligibility evaluation'; studentDataIncluded:false };
export type MatchingEvaluationRun = MatchingEvaluationSummary & { cases:MatchingEvaluationCase[]; decisions:MatchingEvaluationDecision[] };
export type MatchingEvaluationComparison = { beforeId:string; afterId:string; sameCaseSet:boolean; beforeRulesVersion:string; afterRulesVersion:string; regressions:string[]; improvements:string[]; changed:string[]; added:string[]; removed:string[]; label:'Synthetic case comparison; not production evidence' };
export type MatchingEvaluationIndex = { currentRulesVersion:string; currentCaseSetVersion:string; runs:MatchingEvaluationSummary[]; limit:50 };
