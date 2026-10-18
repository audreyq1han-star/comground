/** Working local prototype policy only; this is not approved minor enrollment or verified consent. */
export const YOUTH_POLICY_VERSION = 'teen-local-v1' as const;
export type AccountAgeBand = 'ADULT' | 'TEEN_13_17';
export type AccountAdmission = 'ADMITTED' | 'REVIEW_REQUIRED';
export type YouthReviewRoute = 'GUARDIAN' | 'SCHOOL';
export type YouthReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
/** Same minimal view for the owner and explicitly assigned reviewer: no other person's identity. */
export type YouthReviewRequest = {
  id: string; route: YouthReviewRoute; policyVersion: typeof YOUTH_POLICY_VERSION;
  status: YouthReviewStatus; version: number; synthetic: true; createdAt: string; updatedAt: string;
};
export type YouthAccessState = {
  ageBand: AccountAgeBand; admission: AccountAdmission; synthetic: boolean;
  policyVersion: typeof YOUTH_POLICY_VERSION; request: YouthReviewRequest | null;
};
export type CreateYouthReviewInput = { route: YouthReviewRoute; policyVersion: typeof YOUTH_POLICY_VERSION };
export type WithdrawYouthReviewInput = { expectedVersion: number; action: 'WITHDRAW' };
export type DecideYouthReviewInput = { expectedVersion: number; decision: Exclude<YouthReviewStatus, 'PENDING'>; policyVersion: typeof YOUTH_POLICY_VERSION };
export type YouthExport = {
  access: YouthAccessState;
  ownedRequests: YouthReviewRequest[];
  assignedReviews: YouthReviewRequest[];
  events: { requestId: string; version: number; status: YouthReviewStatus; actor: 'OWNER' | 'REVIEWER' | 'ASSIGNMENT'; at: string }[];
};
