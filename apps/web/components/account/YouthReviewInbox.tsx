'use client';
import { useEffect, useState } from 'react';
import { YOUTH_POLICY_VERSION, type DecideYouthReviewInput, type YouthReviewRequest } from '../../../../packages/domain/youth-contracts.ts';
import { ApiError } from '../Api';
import { LoadState } from '../student/StudentCommon';
import { useStudent } from '../student/StudentSession';
import { useStudentResource } from '../student/useStudentResource';
import { AccountFrame, AccountGuard, ActionMessages, useAccountAction } from './AccountCommon';
import { useRuntime } from './RuntimeContext';
import { LocalReviewMeaning, ReviewRecord, reviewRouteLabels, YouthBoundaryNotice } from './YouthReviewCommon';

function AssignedReview({review,number,disabled,reload}: {review:YouthReviewRequest;number:number;disabled:boolean;reload:()=>void}) {
  const {request}=useStudent();const action=useAccountAction();
  const [confirmed,setConfirmed]=useState(false),[stale,setStale]=useState(false);
  const pending=review.status==='PENDING',approved=review.status==='APPROVED';
  useEffect(()=>{setConfirmed(false);setStale(false);},[review]);
  async function decide(decision:DecideYouthReviewInput['decision']) {
    if(!confirmed)return;
    await action.run(async(isCurrent)=>{
      const body:DecideYouthReviewInput={expectedVersion:review.version,decision,policyVersion:YOUTH_POLICY_VERSION};
      try {await request(`/api/account/youth/reviews/${encodeURIComponent(review.id)}`,{method:'PATCH',body:JSON.stringify(body)});}
      catch(cause){if(isCurrent()&&cause instanceof ApiError&&(cause.code==='VERSION_CONFLICT'||cause.code==='REVIEW_STATE_CONFLICT'))setStale(true);throw cause;}
      if(!isCurrent())return;setConfirmed(false);reload();return decision==='APPROVED'?'Approval recorded locally. The synthetic teen can separately choose to store a private profile.':decision==='REJECTED'?'Rejection recorded locally. This request does not grant student profile access.':'Approval revoked locally. Private student access now needs a new approved review.';
    });
  }
  const locked=action.pending||disabled||stale;
  return <article className="settings-panel" aria-labelledby={`review-heading-${review.id}`}>
    <h3 id={`review-heading-${review.id}`}>Request {number} · {reviewRouteLabels[review.route]}</h3><ReviewRecord request={review}/>
    <p className="fine-print">Request reference: {review.id}. Policy {review.policyVersion}.</p>
    {(pending||approved)&&<><div className="consent-box"><label><input type="checkbox" checked={confirmed} disabled={locked} onChange={event=>setConfirmed(event.target.checked)}/><span>{approved?'I understand that revoking this local approval pauses private student access.':'I understand that this records a local test decision for this assigned request.'}<small>{approved?'Revoking does not delete the account or its stored data.':'Approval permits this fictional teen account to make a separate profile storage choice. It does not verify a person, relationship or school.'}</small></span></label></div><div className="button-row">{pending?<><button className="button primary" disabled={!confirmed||locked} onClick={()=>void decide('APPROVED')}>{action.pending?'Recording…':'Approve locally'}</button><button className="button secondary" disabled={!confirmed||locked} onClick={()=>void decide('REJECTED')}>Reject locally</button></>:<button className="button danger" disabled={!confirmed||locked} onClick={()=>void decide('WITHDRAWN')}>{action.pending?'Recording…':'Revoke local approval'}</button>}</div></>}
    {!pending&&!approved&&<p>This request is closed. Any new review must be separately requested and assigned.</p>}
    {stale&&<p className="notice warning" role="alert">This review changed while you were working. Reload assigned reviews before choosing another action.</p>}
    <ActionMessages {...action}/>
  </article>;
}

function AssignedReviews() {
  const state=useStudentResource<{data:YouthReviewRequest[]}>('/api/account/youth/reviews');
  return <section className="account-stack" aria-labelledby="assigned-reviews-heading"><div><h2 id="assigned-reviews-heading">Assigned review inbox</h2><p>Access comes from an explicit assignment in the local test setup. Signing up, choosing an adult age band or checking a box does not grant review authority.</p></div><LocalReviewMeaning/>
    <LoadState {...state} retry={state.reload}>{state.data&&(state.data.data.length?<div className="account-stack">{state.data.data.map((review,index)=><AssignedReview key={review.id} review={review} number={index+1} disabled={state.refreshing||!!state.refreshError} reload={state.reload}/>)}</div>:<section className="settings-panel"><h3>No reviews are assigned to you.</h3><p>There are no review requests available to this account. The local test setup must explicitly assign a request before you can act on it.</p></section>)}</LoadState>
    <button className="button secondary" disabled={state.loading||state.refreshing} onClick={state.reload}>Reload assigned reviews</button>
  </section>;
}

export function YouthReviewInboxPage() {
  const {runtime}=useRuntime();
  return <AccountFrame title="Your assigned local reviews." description="Record a decision only for a synthetic teen request explicitly assigned to your adult account."><div className="account-stack"><YouthBoundaryNotice/><AccountGuard verified>{session=>session.account?.ageBand!=='ADULT'?<section className="settings-panel"><h2>An assigned adult reviewer is required.</h2><p>Teen accounts cannot review their own request or another account’s request.</p></section>:runtime?.mode==='test'&&runtime.capabilities.syntheticYouth?<AssignedReviews/>:<section className="settings-panel"><h2>Local reviews are unavailable in this app.</h2><p>The synthetic review workflow is available only in an enabled local test. Real minor enrollment remains disabled.</p></section>}</AccountGuard></div></AccountFrame>;
}
