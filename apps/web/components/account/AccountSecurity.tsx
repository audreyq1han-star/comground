'use client';
import Link from 'next/link';
import type { FormEvent } from 'react';
import type { AccountSession, AccountSessionSummary } from '../../../../packages/domain/identity-contracts.ts';
import { useStudent } from '../student/StudentSession';
import { useStudentResource } from '../student/useStudentResource';
import { LoadState } from '../student/StudentCommon';
import { AccountFrame, AccountGuard, ActionMessages, useAccountAction } from './AccountCommon';
import { PasswordField } from './AuthForms';
import { useRuntime } from './RuntimeContext';
import { YouthBoundaryNotice } from './YouthReviewCommon';

export function Reauthenticate({onConfirmed}: {onConfirmed?:()=>void}) {
  const action=useAccountAction();const {request,refresh}=useStudent();
  async function submit(event:FormEvent<HTMLFormElement>) {event.preventDefault();const form=event.currentTarget,password=String(new FormData(form).get('password'));form.reset();await action.run(async(isCurrent)=>{await request<AccountSession>('/api/account/reauthenticate',{method:'POST',body:JSON.stringify({password})});if(!isCurrent())return;await refresh();if(!isCurrent())return;onConfirmed?.();return 'Password confirmed. Sensitive actions are available for a limited time.';});}
  return <details className="account-reauth"><summary>Confirm your password for sensitive actions</summary><form onSubmit={submit}><PasswordField current/><button className="button secondary" disabled={action.pending} type="submit">{action.pending?'Confirming…':'Confirm password'}</button><ActionMessages {...action}/></form></details>;
}
export function AccountOverview() {
  const {endSession}=useStudent();const action=useAccountAction();const {runtime}=useRuntime();
  return <AccountFrame title="Your account, your choices." description="Manage account security independently from private high-school student preferences and optional features."><AccountGuard>{session=>{
    const teen=session.account?.ageBand==='TEEN_13_17';
    const needsReview=teen&&session.account?.admission!=='ADMITTED';
    return <div className="account-stack">{teen&&<YouthBoundaryNotice/>}<div className="account-grid">
      <section className="settings-panel"><h2>Account details</h2><p>{session.account?.email}</p><p>{session.account?.synthetic?'Synthetic local account. No mailbox ownership was verified.':`Email: ${session.account?.emailVerified?'verified':'not verified'}.`} Role: {session.account?.role==='OPERATOR'?'operator':'student'}.</p><p>Age band: {teen?'13–17 · fictional teen':'18 or over · self-reported adult'}.</p>{teen&&<p>Private student access: {needsReview?'local review required':'local review approved'}.</p>}<p className="fine-print">Session expires {session.expiresAt?new Date(session.expiresAt).toLocaleString():'when it ends'}.</p>{!session.account?.emailVerified&&<Link className="button primary" href="/account/verify">Email verification</Link>}<div className="account-links"><Link href="/account/password">Change password</Link><Link href="/account/sessions">Manage sessions</Link><Link href="/account/privacy">Export or delete account data</Link></div><button className="button secondary" disabled={action.pending} onClick={()=>void action.run(async()=>{await endSession();})}>Sign out</button><ActionMessages {...action}/></section>
      <section className="settings-panel"><h2>{teen?'Private student data and local review':'Student data and optional features'}</h2><p>{teen?'Your profile, saved dates and activity stay private. Profile storage and personalized matching are separate choices after local review. AI explanations, measurement and outbound email are disabled for teen accounts.':'Storage, personalization, AI explanations, measurement and email reminders are separate choices. Turning on one does not enable the others. Profiles, saved dates and activity stay private.'}</p><div className="account-links">{teen&&<Link href="/account/youth-review">Guardian or school review</Link>}{!needsReview&&<><Link href="/onboarding">Continue onboarding</Link><Link href="/profile">Edit preferences</Link></>}<Link href="/account/privacy">Privacy, export and deletion</Link>{!teen&&<Link href="/account/notifications">Email reminder preferences</Link>}{!teen&&runtime?.capabilities.syntheticYouth&&<Link href="/account/reviews">Assigned local reviews</Link>}</div>{!teen&&runtime?.capabilities.syntheticYouth&&<p className="fine-print">Adult reviewers can act only on requests explicitly assigned by the local test setup. Adult signup does not grant review authority.</p>}</section>
    </div></div>;
  }}</AccountGuard></AccountFrame>;
}
function PasswordEditor() {
  const action=useAccountAction();const {request,refresh}=useStudent();
  async function submit(event:FormEvent<HTMLFormElement>) {event.preventDefault();const form=event.currentTarget,fields=new FormData(form),currentPassword=String(fields.get('currentPassword')),newPassword=String(fields.get('newPassword'));form.reset();await action.run(async(isCurrent)=>{await request<AccountSession>('/api/account/password',{method:'PATCH',body:JSON.stringify({currentPassword,newPassword})});if(!isCurrent())return;await refresh();return 'Password changed. Review your active sessions below.';});}
  return <form className="profile-form account-form" onSubmit={submit}><PasswordField name="currentPassword" label="Current password" current/><PasswordField name="newPassword" label="New password"/><button className="button primary full-width" type="submit" disabled={action.pending}>{action.pending?'Changing password…':'Change password'}</button><ActionMessages {...action}/><div className="account-links"><Link href="/account/sessions">Review active sessions</Link><Link href="/account/recover">Recover a forgotten password</Link></div></form>;
}
export function PasswordPage(){return <AccountFrame title="Change your password." description="Use a unique password and confirm your current password to make a change."><AccountGuard>{()=> <PasswordEditor/>}</AccountGuard></AccountFrame>;}
function SessionList() {
  const state=useStudentResource<{data:AccountSessionSummary[]}>('/api/account/sessions');const action=useAccountAction();const {request,refresh,changeSession}=useStudent();
  async function revoke(item:AccountSessionSummary) {await action.run(async(isCurrent)=>{await request(`/api/account/sessions/${encodeURIComponent(item.id)}`,{method:'DELETE'});if(!isCurrent())return;if(item.current)await refresh();else state.reload();return 'Session revoked.';});}
  return <div className="account-stack"><section className="settings-panel"><h2>Active sessions</h2><p>Revoking a session ends its access. The list shows session times; it does not identify a device or its location.</p><Reauthenticate onConfirmed={state.reload}/><ActionMessages {...action}/><LoadState {...state} retry={state.reload}>{state.data&&<ul className="account-session-list">{state.data.data.map((item,index)=><li key={item.id}><strong>{item.current?'This session':`Other session ${index+1}`}</strong><p>Started {new Date(item.createdAt).toLocaleString()}<br/>Last seen {new Date(item.lastSeenAt).toLocaleString()}<br/>Expires {new Date(item.expiresAt).toLocaleString()}</p><button className="button secondary" disabled={action.pending} onClick={()=>void revoke(item)}>{item.current?'Revoke this session':`Revoke session ${index+1}`}</button></li>)}</ul>}</LoadState><button className="button danger" disabled={action.pending||state.loading} onClick={()=>void action.run(async()=>{await changeSession('/api/account/sessions',{method:'DELETE'});})}>Sign out all sessions</button><p className="fine-print">This also signs out the browser you are using now. Recent password confirmation is required.</p></section></div>;
}
export function SessionsPage(){return <AccountFrame title="Manage account sessions." description="Review active access and revoke sessions you no longer need."><AccountGuard>{()=> <SessionList/>}</AccountGuard></AccountFrame>;}
