'use client';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { YOUTH_POLICY_VERSION, type CreateYouthReviewInput, type WithdrawYouthReviewInput, type YouthAccessState, type YouthReviewRoute } from '../../../../packages/domain/youth-contracts.ts';
import { ApiError } from '../Api';
import { LoadState } from '../student/StudentCommon';
import { useStudent } from '../student/StudentSession';
import { useStudentResource } from '../student/useStudentResource';
import { AccountFrame, AccountGuard, ActionMessages, useAccountAction } from './AccountCommon';
import { useRuntime } from './RuntimeContext';
import { LocalReviewMeaning, ReviewRecord, reviewStatusLabels, YouthBoundaryNotice } from './YouthReviewCommon';

function YouthReviewControls({value,disabled,reload}: {value:YouthAccessState;disabled:boolean;reload:()=>void}) {
  const {request,refresh}=useStudent();const action=useAccountAction();
  const [route,setRoute]=useState<YouthReviewRoute>('GUARDIAN'),[confirmed,setConfirmed]=useState(false),[stale,setStale]=useState(false);
  const review=value.request;
  const active=review?.status==='PENDING'||review?.status==='APPROVED';
  useEffect(()=>{setStale(false);setConfirmed(false);},[value]);
  async function create(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action.run(async(isCurrent)=>{
      const body:CreateYouthReviewInput={route,policyVersion:YOUTH_POLICY_VERSION};
      try {await request('/api/account/youth/requests',{method:'POST',body:JSON.stringify(body)});}
      catch(cause){if(isCurrent()&&cause instanceof ApiError&&(cause.code==='VERSION_CONFLICT'||cause.code==='REVIEW_STATE_CONFLICT'))setStale(true);throw cause;}
      if(!isCurrent())return;reload();await refresh();return 'Review requested locally. No email was sent. The request needs an explicitly assigned adult reviewer.';
    });
  }
  async function withdraw() {
    if(!review||!confirmed)return;
    await action.run(async(isCurrent)=>{
      const body:WithdrawYouthReviewInput={expectedVersion:review.version,action:'WITHDRAW'};
      try {await request(`/api/account/youth/requests/${encodeURIComponent(review.id)}`,{method:'PATCH',body:JSON.stringify(body)});}
      catch(cause){if(isCurrent()&&cause instanceof ApiError&&(cause.code==='VERSION_CONFLICT'||cause.code==='REVIEW_STATE_CONFLICT'))setStale(true);throw cause;}
      if(!isCurrent())return;setConfirmed(false);reload();await refresh();return 'Review withdrawn locally. Profile access now requires a new approved review. Account export and deletion remain available.';
    });
  }
  return <div className="account-stack">
    <section className="settings-panel"><h2>{review?reviewStatusLabels[review.status]:'Choose a review path.'}</h2>
      {review?<ReviewRecord request={review}/>:<p>No review has been requested. Choose a guardian or school path for this fictional teen account.</p>}
      {review?.status==='PENDING'&&<p>Your request is waiting for local assignment and a reviewer’s decision. Selecting a path does not contact or identify a guardian or school. You can browse while you wait.</p>}
      {review?.status==='APPROVED'&&<><p>A reviewer assigned by the local test setup recorded approval. You can now make a separate choice to store this fictional student’s private preferences.</p><Link className="button primary" href="/onboarding">Continue to private preferences</Link></>}
      {review?.status==='REJECTED'&&<p>This request was not approved. No profile access was granted by this decision. You can choose a path and request another local review.</p>}
      {review?.status==='WITHDRAWN'&&<p>This review is no longer active. Request a new local review before using private student features. Export and account deletion remain available in Privacy.</p>}
      <LocalReviewMeaning/>
      {active&&<><div className="consent-box"><label><input type="checkbox" checked={confirmed} disabled={action.pending||disabled||stale} onChange={event=>setConfirmed(event.target.checked)}/><span>{review?.status==='APPROVED'?'Withdraw this local approval and pause private student access.':'Withdraw this pending review request.'}<small>You can submit a new request afterward, including to choose the other review path. This does not delete your account or stored data.</small></span></label></div><button className="button danger" disabled={!confirmed||action.pending||disabled||stale} onClick={()=>void withdraw()}>{action.pending?'Recording…':review?.status==='APPROVED'?'Withdraw local approval':'Withdraw review request'}</button></>}
    </section>
    {!active&&<form className="settings-panel account-form" onSubmit={create}><h2>{review?'Request another local review':'Request a local review'}</h2><div className="field"><label htmlFor="youth-review-route">Review path</label><select id="youth-review-route" value={route} disabled={action.pending||disabled||stale} onChange={event=>setRoute(event.target.value as YouthReviewRoute)}><option value="GUARDIAN">Guardian review</option><option value="SCHOOL">School review</option></select><small>Choose one path. Do not enter anyone’s contact details. An adult reviewer must be assigned through the local test setup.</small></div><p className="fine-print">Policy {YOUTH_POLICY_VERSION}. AI explanations, measurement and outbound email stay disabled for teen accounts.</p><button className="button primary" type="submit" disabled={action.pending||disabled||stale}>{action.pending?'Requesting…':'Request local review'}</button></form>}
    {stale&&<p className="notice warning" role="alert">This review changed while you were working. Reload its latest status before trying again.</p>}
    <ActionMessages {...action}/>
    <div className="button-row"><button className="button secondary" disabled={action.pending} onClick={reload}>Reload latest review status</button><Link className="text-link" href="/opportunities">Browse opportunities</Link><Link className="text-link" href="/safety">Report a concern</Link><Link className="text-link" href="/account/privacy">Export or delete account data</Link></div>
  </div>;
}

function YouthReviewStatus() {
  const state=useStudentResource<{data:YouthAccessState}>('/api/account/youth');
  return <LoadState {...state} retry={state.reload}>{state.data&&<YouthReviewControls value={state.data.data} disabled={state.refreshing||!!state.refreshError} reload={state.reload}/>}</LoadState>;
}

export function YouthReviewPage() {
  const {runtime}=useRuntime();
  return <AccountFrame title="Your guardian or school review." description="Follow the local review request for your fictional high-school student account."><div className="account-stack"><YouthBoundaryNotice/><AccountGuard verified>{session=>session.account?.ageBand!=='TEEN_13_17'?<section className="settings-panel"><h2>This page is for teen accounts.</h2><p>Adults can view only review requests explicitly assigned to their account.</p><Link className="button secondary" href="/account/reviews">Open assigned reviews</Link></section>:runtime?.mode==='test'&&runtime.capabilities.syntheticYouth?<YouthReviewStatus/>:<section className="settings-panel"><h2>The local teen workflow is unavailable.</h2><p>Real minor enrollment remains disabled. Account export and deletion remain available.</p><Link className="button secondary" href="/account/privacy">Privacy and account data</Link></section>}</AccountGuard></div></AccountFrame>;
}
