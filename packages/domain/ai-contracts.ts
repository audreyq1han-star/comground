/** AI selects emphasis among checked facts; it cannot alter eligibility or ordering. */
export type GroundedReasonId = 'REQUIREMENTS_MET' | 'INTEREST_OVERLAP' | 'REMOTE' | 'NO_FEE';
export type GroundedCandidate = { candidateId: string; facts: { interestOverlap: number; remote: boolean; noFee: boolean }; allowedReasonIds: GroundedReasonId[] };
export type GroundedSelection = { items: { candidateId: string; reasonIds: GroundedReasonId[] }[] };
export type MatchExplanation = { opportunityId: string; occurrenceId: string; version: number; reasons: string[] };
export type AiExplanationResult = {
  mode: 'GROUNDED_AI_SELECTION' | 'DETERMINISTIC_FALLBACK';
  reason: 'COMPLETE' | 'DISABLED' | 'EMPTY_ELIGIBLE_POOL' | 'PROVIDER_UNAVAILABLE' | 'INVALID_OUTPUT';
  profileVersion: number; items: MatchExplanation[];
  limitation: 'AI selects emphasis only. Rules determine eligibility and order. Confirm requirements with the organizer.';
};
