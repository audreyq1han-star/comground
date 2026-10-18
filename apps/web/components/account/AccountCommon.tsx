'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AccountSession } from '../../../../packages/domain/identity-contracts.ts';
import { messageOf } from '../Api';
import { PageHeading, LoadState } from '../student/StudentCommon';
import { useStudent } from '../student/StudentSession';
import { useStudentResource } from '../student/useStudentResource';
import { RuntimeBoundary, useRuntime } from './RuntimeContext';

export function AccountAccess({ children }: { children: ReactNode }) {
  const { runtime } = useRuntime();
  const {loading}=useStudent();
  // A token must not be consumed before the initial owner-key change completes.
  return <RuntimeBoundary>{runtime?.capabilities.accounts ? loading?<div className="page-shell student-page" role="status"><p>Checking your account session…</p></div>:children : <div className="page-shell student-page"><PageHeading eyebrow="DEMO MODE" title="This app uses shared example personas." description="Account signup, passwords and email verification are available only in account mode. No real account details are collected here."/><Link className="button primary" href="/onboarding">Open demo onboarding</Link></div>}</RuntimeBoundary>;
}
export function AccountFrame({title, description, children}: {title:string;description:string;children:ReactNode}) {
  const {error,session}=useStudent();const {runtime}=useRuntime();const teen=session.account?.ageBand==='TEEN_13_17';
  return <div className="page-shell student-page account-page"><PageHeading eyebrow="YOUR ACCOUNT" title={title} description={description}/><nav className="account-nav" aria-label="Account navigation"><Link href="/account">Overview</Link><Link href="/profile">Preferences</Link><Link href="/account/privacy">Privacy</Link>{!teen&&<Link href="/account/notifications">Email reminders</Link>}<Link href="/account/sessions">Sessions</Link>{teen&&<Link href="/account/youth-review">Guardian or school review</Link>}{runtime?.capabilities.syntheticYouth&&session.account?.ageBand==='ADULT'&&<Link href="/account/reviews">Assigned reviews</Link>}</nav>{error&&<p className="notice error" role="alert">{error}</p>}{children}</div>;
}
export function AccountGuard({children, verified=false}: {children:(session:AccountSession)=>ReactNode;verified?:boolean}) {
  const state = useStudentResource<AccountSession>('/api/account/session');
  return <LoadState {...state} retry={state.reload}>{state.data && (state.data.account ? verified && !state.data.account.emailVerified ? <section className="settings-panel"><h2>Verify your email first.</h2><p>Your account is signed in. Verify its email address before storing a profile or using private student features.</p><Link className="button primary" href="/account/verify">Email verification</Link></section> : children(state.data) : <section className="settings-panel"><h2>Sign in to continue.</h2><p>Your account controls are private to your signed-in account.</p><div className="button-row"><Link className="button primary" href="/account/login">Sign in</Link><Link className="button secondary" href="/account/signup">Create an account</Link></div></section>)}</LoadState>;
}
export function EmailDeliveryNotice() {
  const { runtime } = useRuntime();const {session}=useStudent();
  if(session.account?.ageBand==='TEEN_13_17')return <p className="notice warning" role="status">Outbound email is disabled for this fictional teen account, including verification and password recovery messages. A recorded request does not confirm delivery or mailbox ownership.</p>;
  return !runtime?.capabilities.emailDelivery ? <p className="notice warning" role="status">Email delivery is not activated for this app. Verification and password recovery requests cannot currently reach an inbox. A saved request does not verify an account or confirm delivery.</p> : <p className="fine-print">Account verification and recovery emails are security messages, separate from optional reminder emails. A queued request is not a delivery confirmation.</p>;
}
export function useAccountAction() {
  const { getSessionEpoch } = useStudent();
  const [pending,setPending] = useState(false), [error,setError] = useState(''), [status,setStatus] = useState('');
  const active = useRef(true), busy = useRef(false), generation = useRef(0);
  useEffect(() => { active.current = true; return () => { active.current = false; ++generation.current; }; }, []);
  async function run(action:(isCurrent:()=>boolean)=>Promise<string|void>) {
    if (busy.current || !active.current) return;
    const current = ++generation.current, epoch = getSessionEpoch();
    const isCurrent = () => active.current && current === generation.current && epoch === getSessionEpoch();
    busy.current=true; setPending(true); setError(''); setStatus('');
    try { const message = await action(isCurrent); if (isCurrent() && message) setStatus(message); }
    catch(cause) { if(isCurrent()) setError(messageOf(cause)); }
    finally { if(active.current && current===generation.current) { busy.current=false;setPending(false); } }
  }
  return {pending,error,status,run};
}
export function ActionMessages({error,status}: {error:string;status:string}) { return <>{error&&<p className="notice error" role="alert">{error}</p>}{status&&<p className="notice success" role="status">{status}</p>}</>; }
