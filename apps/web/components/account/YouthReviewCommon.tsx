'use client';
import type { YouthReviewRequest, YouthReviewRoute, YouthReviewStatus } from '../../../../packages/domain/youth-contracts.ts';
import { useRuntime } from './RuntimeContext';

export const reviewRouteLabels: Record<YouthReviewRoute,string> = { GUARDIAN: 'Guardian review', SCHOOL: 'School review' };
export const reviewStatusLabels: Record<YouthReviewStatus,string> = { PENDING: 'Waiting for local review', APPROVED: 'Approved locally', REJECTED: 'Not approved locally', WITHDRAWN: 'Withdrawn or revoked locally' };

export function YouthBoundaryNotice() {
  const {runtime}=useRuntime();
  return <aside className="notice warning" aria-label="Teen enrollment boundary"><strong>Real minor enrollment is disabled.</strong><p>CommonGround is being developed for high-school students aged 13 and over, including students aged 18+. Under-13 accounts are unsupported. {runtime?.mode==='test'&&runtime.capabilities.syntheticYouth?'This local test supports fictional teen accounts only.':'Only the adult account path is currently available.'} A local review record does not verify a guardian’s identity, a school’s authority or legally approved consent.</p></aside>;
}

export function ReviewRecord({request}: {request:YouthReviewRequest}) {
  return <dl className="account-review-facts">
    <div><dt>Review path</dt><dd>{reviewRouteLabels[request.route]}</dd></div>
    <div><dt>Status</dt><dd>{reviewStatusLabels[request.status]}</dd></div>
    <div><dt>Last updated</dt><dd>{new Date(request.updatedAt).toLocaleString()}</dd></div>
    <div><dt>Record version</dt><dd>{request.version}</dd></div>
  </dl>;
}

export function LocalReviewMeaning() {
  return <p className="fine-print">This is a synthetic local workflow. Decisions are recorded locally and do not establish verified guardian identity, verified school authority or legally approved consent. Reviewers see this request’s route and status, not a student’s email, profile, saved dates or activity.</p>;
}
