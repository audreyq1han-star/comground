'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { DemoPersona, ProfileInput } from '../../../../packages/domain/app-contracts.ts';
import { api, messageOf } from '../Api';
import { PreferenceForm } from './PreferenceForm';
import { StudentGate, useStudent } from './StudentSession';
import { PageHeading } from './StudentCommon';
import { useCampaign } from './CampaignContext';
import { MeasurementControl } from './MeasurementControl';
import { RuntimeBoundary, useRuntime } from '../account/RuntimeContext';
import { ActionMessages, useAccountAction } from '../account/AccountCommon';
function AccountOnboarding() {
  const {session,request,refresh}=useStudent();const router=useRouter();const {withCampaign}=useCampaign();const action=useAccountAction();
  async function save(value:ProfileInput){await action.run(async(isCurrent)=>{await request('/api/student/profile',{method:'PUT',body:JSON.stringify(value)});if(!isCurrent())return;await refresh();if(isCurrent())router.push(withCampaign(value.privacyConsent?.personalization?'/matches':'/'));});}
  return <div className="page-shell student-page"><PageHeading eyebrow="ACCOUNT / GET STARTED" title="Choose what helps you take part." description="Start with high-school volunteering goals, a coarse area and an age band. High-school students can be under or over 18; school stage does not replace age eligibility. Teen workflows use synthetic accounts only until live enrollment is approved."/><StudentGate requireProfile={false}>{session.profile?<section className="settings-panel"><h2>Your student profile is ready.</h2><p>Personalization, AI explanations, measurement and reminders each have their own controls.</p><div className="button-row"><Link className="button primary" href={withCampaign('/')}>Open dashboard</Link><Link className="button secondary" href="/profile">Edit preferences</Link><Link className="button secondary" href="/account/privacy">Review privacy choices</Link></div></section>:<><ActionMessages {...action}/><PreferenceForm profile={null} pending={action.pending} onSave={save}/></>}</StudentGate></div>;
}
export function Onboarding() {
  const {runtime}=useRuntime();
  const { session, loading, error: sessionError, selectPersona, request, refresh } = useStudent();
  const [personas, setPersonas] = useState<DemoPersona[]>([]);
  const [error, setError] = useState(''); const [pending, setPending] = useState(false); const [attempt, setAttempt] = useState(0);
  const router = useRouter();
  const { campaign, withCampaign } = useCampaign();
  useEffect(() => { if(!runtime?.capabilities.demoPersonas)return;let active = true; api<{data:DemoPersona[]}>('/api/student/personas').then(r => { if (active) setPersonas(r.data); }).catch(e => { if (active) setError(messageOf(e)); }); return () => { active = false; }; }, [attempt,runtime]);
  async function save(value: ProfileInput) { setPending(true); setError(''); try { await request('/api/student/profile', { method:'PUT', body:JSON.stringify(value) }); await refresh(); router.push(withCampaign(campaign ? '/matches' : '/'));  } catch(e) { setError(messageOf(e)); } finally { setPending(false); } }
  if(!runtime)return <RuntimeBoundary>{null}</RuntimeBoundary>;
  if(runtime.capabilities.accounts)return <AccountOnboarding/>;
  return <div className="page-shell student-page"><PageHeading eyebrow="A SHARED LOCAL DEMO" title="Choose a starting point." description="Two fixed example personas. No real account, identity or sensitive information needed." />
    {(error || sessionError) && <div className="notice error" role="alert">{error || sessionError}<button className="plain-button" onClick={() => { setError(''); setAttempt(n=>n+1); void refresh(); }}>Try again</button></div>}
    <div className="onboarding-layout"><div><section className="persona-section" aria-labelledby="persona-title"><h2 id="persona-title">1. Choose a demo persona</h2><div className="persona-options">{personas.map((p,i) => <button className={`persona-card ${session.persona?.id === p.id ? 'selected' : ''}`} key={p.id} disabled={pending || loading} aria-pressed={session.persona?.id === p.id} onClick={async () => { setPending(true); setError(''); try { await selectPersona(p.id); } catch(e) { setError(messageOf(e)); } finally { setPending(false); } }}><span className={`persona-avatar avatar-${i}`} aria-hidden="true">{p.label.slice(0,1)}</span><strong>{p.label}</strong><span>{p.description}</span><span className="persona-state">{session.persona?.id === p.id ? 'Selected ✓' : 'Choose persona →'}</span></button>)}</div></section>
    {loading ? <p role="status" className="loading-label">Checking the demo session…</p> : session.authenticated && (session.profile ? <div className="existing-profile"><h2>This persona is ready.</h2><p>Its saved preferences are available on this Mac. Switch personas above, or continue to the dashboard.</p><div className="button-row"><Link className="button primary" href={withCampaign('/matches')}>Continue to matches →</Link><Link className="button secondary" href={withCampaign('/')}>Open dashboard →</Link><Link className="button secondary" href="/profile">Edit preferences</Link></div><MeasurementControl/></div> : <><h2 className="onboarding-step">2. Set preferences and consent</h2><PreferenceForm key={session.persona?.id} profile={null} pending={pending} onSave={save} /></>)}</div>
    <aside className="student-aside"><p className="eyebrow">BUILT FOR CLEAR CHOICES</p><h2>Start small.<br />Know what fits.</h2><ol><li>Browse synthetic opportunities with their source facts.</li><li>Get a shortlist based on hard requirements.</li><li>Save ideas and preview the example signup destination.</li><li>Try self-reported activity and in-app reminders.</li></ol><p>There are no external provider calls, real applications, verified organizations or certified hours. Optional local measurement is off by default and controlled separately in Matches or Profile.</p><Link className="text-link" href="/opportunities">Browse without storing a profile →</Link></aside></div>
  </div>;
}
