'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { AccountSession, GenericAccountResponse } from '../../../../packages/domain/identity-contracts.ts';
import { api } from '../Api';
import { useStudent } from '../student/StudentSession';
import { useCampaign } from '../student/CampaignContext';
import { AccountFrame, ActionMessages, EmailDeliveryNotice, useAccountAction } from './AccountCommon';
import { useRuntime } from './RuntimeContext';
import { YouthBoundaryNotice } from './YouthReviewCommon';

function EmailField() { return <div className="field"><label htmlFor="account-email">Email address</label><input id="account-email" name="email" type="email" autoComplete="email" maxLength={254} required autoCapitalize="none" spellCheck={false}/></div>; }
export function PasswordField({name='password',label='Password',current=false}: {name?:string;label?:string;current?:boolean}) { return <div className="field"><label htmlFor={`account-${name}`}>{label}</label><input id={`account-${name}`} name={name} type="password" autoComplete={current?'current-password':'new-password'} minLength={current?undefined:15} maxLength={128} required aria-describedby={current?undefined:`${name}-help`}/>{!current&&<small id={`${name}-help`}>Use 15–128 characters. A unique passphrase works well.</small>}</div>; }
export function LoginForm() {
  const {session,loading,error:sessionError,changeSession} = useStudent();
  const {withCampaign} = useCampaign();
  const action = useAccountAction();const[resetComplete,setResetComplete]=useState(false);
  const needsReview=session.account?.ageBand==='TEEN_13_17'&&session.account.admission!=='ADMITTED';
  const continuePath=!session.account?.emailVerified?'/account/verify':needsReview?'/account/youth-review':'/onboarding';
  const continueLabel=!session.account?.emailVerified?'Email verification':needsReview?'Guardian or school review':'Continue to onboarding';
  useEffect(()=>{const params=new URLSearchParams(window.location.search);if(params.get('notice')==='password-reset'){setResetComplete(true);params.delete('notice');window.history.replaceState(window.history.state,'',window.location.pathname+(params.size?'?'+params.toString():''));}},[]);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, fields = new FormData(form);
    const password = String(fields.get('password')); (form.elements.namedItem('password') as HTMLInputElement).value='';
    await action.run(async()=>{await changeSession<AccountSession>('/api/account/session',{method:'POST',body:JSON.stringify({email:fields.get('email'),password})});});
  }
  return <AccountFrame title="Sign in to CommonGround." description="Use your own account to manage saved dates, activity and privacy choices.">{resetComplete&&<p className="notice success" role="status">Password reset. Sign in with your new password.</p>}{session.authenticated ? <section className="settings-panel"><h2>You’re signed in.</h2><p>{!session.account?.emailVerified?'Verify your email before creating a student profile.':needsReview?'A guardian or school review must be recorded locally before this fictional teen account can store a profile.':'Continue to your private preferences and opportunities.'}</p><div className="button-row"><Link className="button primary" href={withCampaign(continuePath)}>{continueLabel}</Link><Link className="button secondary" href="/account">Account settings</Link></div></section> : <form className="profile-form account-form" onSubmit={submit}><EmailField/><PasswordField current/><button className="button primary full-width" disabled={action.pending||loading} type="submit">{action.pending?'Signing in…':'Sign in'}</button><ActionMessages error={action.error||sessionError} status={action.status}/><div className="account-links"><Link href="/account/recover">Forgot your password?</Link><Link href={withCampaign('/account/signup')}>Create an account</Link></div></form>}</AccountFrame>;
}
export function SignupForm() {
  const action=useAccountAction(); const {withCampaign}=useCampaign();const {runtime}=useRuntime();
  const [ageBand,setAgeBand]=useState('');
  const syntheticTeen=ageBand==='TEEN_13_17'&&runtime?.mode==='test'&&runtime.capabilities.syntheticYouth;
  const canRegister=ageBand==='ADULT'||syntheticTeen;
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(!canRegister)return;const form=event.currentTarget, fields=new FormData(form), password=String(fields.get('password'));(form.elements.namedItem('password') as HTMLInputElement).value='';
    await action.run(async()=>{const result=await api<GenericAccountResponse>('/api/account/register',{method:'POST',body:JSON.stringify({email:fields.get('email'),password,ageBand,...(syntheticTeen?{synthetic:fields.get('synthetic')==='on'}:{adultConfirmed:fields.get('adult')==='on'})})});return result.message;});
  }
  return <AccountFrame title="Create your account." description="Choose your age band to see the available account path. We do not ask for your date of birth."><div className="account-stack"><YouthBoundaryNotice/><form className="profile-form account-form" onSubmit={submit}>
    <div className="field"><label htmlFor="account-age-band">Age band</label><select id="account-age-band" name="ageBand" value={ageBand} disabled={action.pending} required onChange={event=>setAgeBand(event.target.value)} aria-describedby="account-age-help"><option value="">Choose an age band</option><option value="ADULT">Adult · 18 or over</option><option value="TEEN_13_17">Teen · 13–17</option><option value="UNDER_13">Under 13</option></select><small id="account-age-help">An age band is self-reported. It does not verify anyone’s age.</small></div>
    {ageBand==='UNDER_13'&&<section className="notice warning" role="status"><h2>Accounts are not available for under 13s.</h2><p>Do not enter a child’s details. Under-13 accounts are unsupported.</p></section>}
    {ageBand==='TEEN_13_17'&&!syntheticTeen&&<section className="notice warning" role="status"><h2>Real teen enrollment is not open.</h2><p>The teen journey requires an approved guardian or school process before a live launch. This app cannot enroll a real minor or accept their details.</p></section>}
    {canRegister&&<div className="account-stack" key={ageBand}>
      {syntheticTeen?<p className="notice warning" role="status">Synthetic teen test only. Use a fictional address ending in .invalid. No verification email is sent; local fixture access does not prove mailbox ownership, age or consent.</p>:<EmailDeliveryNotice/>}
      <EmailField/><PasswordField/>
      <div className="consent-box"><label>{syntheticTeen?<><input name="synthetic" type="checkbox" required disabled={action.pending}/><span>I am using a fictional teen account for a local test.<small>No real teen or adult details. A guardian or school review must be recorded locally before this test account can store preferences.</small></span></>:<><input name="adult" type="checkbox" required disabled={action.pending}/><span>I confirm I am at least 18 years old.<small>This is a self-attestation, not verified age. Create only your own account.</small></span></>}</label></div>
      <p className="fine-print">Creating an account stores an email address, a protected password credential, an age band and session information. Profiles stay private. Profile storage needs a separate choice. {syntheticTeen?'AI explanations, measurement and outbound email are disabled for teen accounts.':'Personalization, AI explanations, measurement and optional reminders start off.'}</p>
      <button className="button primary full-width" disabled={action.pending} type="submit">{action.pending?'Submitting…':syntheticTeen?'Create synthetic teen account':'Create account'}</button>
    </div>}
    <ActionMessages {...action}/><div className="account-links"><Link href={withCampaign('/account/login')}>Sign in</Link>{!syntheticTeen&&<Link href="/account/verify">Resend verification instructions</Link>}<Link href="/opportunities">Browse without an account</Link></div>
  </form></div></AccountFrame>;
}
function EmailRequest({kind}: {kind:'verification'|'recovery'}) {
  const action=useAccountAction();
  async function submit(event:FormEvent<HTMLFormElement>) {event.preventDefault();const fields=new FormData(event.currentTarget);await action.run(async()=>{const result=await api<GenericAccountResponse>(`/api/account/${kind}`,{method:'POST',body:JSON.stringify({email:fields.get('email')})});return result.message;});}
  return <form className="profile-form account-form" onSubmit={submit}><EmailField/><button className="button primary full-width" type="submit" disabled={action.pending}>{action.pending?'Submitting…':kind==='verification'?'Send verification instructions':'Send recovery instructions'}</button><ActionMessages {...action}/><p className="fine-print">This response does not disclose whether an email address has an account. If you receive a link, open the newest one; links expire and can be used only once.</p><div className="account-links"><Link href="/account/login">Back to sign in</Link>{kind==='recovery'&&<Link href="/account/signup">Create an account</Link>}</div></form>;
}
export function RecoveryForm() { return <AccountFrame title="Recover your account." description="Request a one-time password reset link. We give the same response whether or not an address is registered."><div className="account-stack"><EmailDeliveryNotice/><EmailRequest kind="recovery"/></div></AccountFrame>; }
function useFragmentToken() {
  const [value,setValue]=useState<{token:string|null;ready:boolean}>({token:null,ready:false});
  const read=useRef(false);
  useEffect(()=>{if(read.current)return;read.current=true;const values=new URLSearchParams(window.location.hash.slice(1)).getAll('token');const token=values.length===1&&values[0]&&values[0].length<=1024?values[0]:null;window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);setValue({token,ready:true});},[]);
  return {...value,clear:()=>setValue({token:null,ready:true})};
}
export function TokenForm({kind}: {kind:'verify'|'reset'}) {
  const token=useFragmentToken(), action=useAccountAction(), router=useRouter();const {refresh}=useStudent();
  const [complete,setComplete]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(!token.token)return;const form=event.currentTarget, fields=new FormData(form), password=String(fields.get('password')??'');(form.elements.namedItem('password') as HTMLInputElement).value='';
    await action.run(async(isCurrent)=>{await api(`/api/account/${kind==='verify'?'verification':'recovery'}/confirm`,{method:'POST',body:JSON.stringify({token:token.token,password})});if(!isCurrent())return;token.clear();setComplete(true);if(kind==='reset'){router.replace('/account/login?notice=password-reset');await refresh();return;}await refresh();return 'Email verified. Earlier sessions ended. Sign in with the password you chose.';});
  }
  return <AccountFrame title={kind==='verify'?'Verify your email.':'Set a new password.'} description={kind==='verify'?'Confirm mailbox ownership and choose your account password. Earlier sessions will end; sign in afterward.':'Use the one-time recovery link to choose a new password. Existing account sessions will be revoked.'}><div className="account-stack"><EmailDeliveryNotice/>{!token.ready?<p role="status">Checking the link…</p>:complete?<section className="settings-panel"><h2>{kind==='verify'?'Email verified.':'Password reset.'}</h2><Link className="button primary" href="/account/login">Continue to sign in</Link></section>:token.token?<form className="profile-form account-form" onSubmit={submit}><PasswordField label="New password"/><p>The one-time code has been removed from the address bar. Continue only if you requested this {kind==='verify'?'verification':'password reset'}.</p><button className="button primary full-width" type="submit" disabled={action.pending}>{action.pending?'Checking…':kind==='verify'?'Verify email':'Reset password'}</button><ActionMessages {...action}/><div className="account-links"><button type="button" className="plain-button" onClick={()=>{token.clear();if(kind==='reset')router.push('/account/recover');}}>Request a new link</button></div></form>:kind==='verify'?<EmailRequest kind="verification"/>:<section className="settings-panel"><h2>A valid recovery link is needed.</h2><p>Open the newest recovery email. If the link has expired or was already used, request another.</p><Link className="button primary" href="/account/recover">Request recovery instructions</Link></section>}</div></AccountFrame>;
}
