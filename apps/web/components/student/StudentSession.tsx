'use client';
import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DemoPersonaId, StudentSession } from '../../../../packages/domain/app-contracts.ts';
import { api, ApiError, messageOf } from '../Api';
import { CampaignProvider, useCampaign } from './CampaignContext';
import { RuntimeBoundary, useRuntime } from '../account/RuntimeContext';
const anonymous: StudentSession = { authenticated: false, persona: null, account: null, profile: null };
type SessionContext = { session: StudentSession; loading: boolean; error: string; readRevision: number; getSessionEpoch: () => number; refresh: () => Promise<void>; selectPersona: (id: DemoPersonaId) => Promise<void>; changeSession: <T>(url:string,options:RequestInit)=>Promise<T>; endSession: () => Promise<void>; request: <T>(url: string, options?: RequestInit) => Promise<T> };
const Context = createContext<SessionContext | null>(null);
export function StudentProvider({ children }: { children: ReactNode }) {
  const { runtime } = useRuntime();
  const [session, setSession] = useState<StudentSession>(anonymous);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [readRevision, setReadRevision] = useState(0);
  const generation = useRef(0);
  const identity = useRef<string | null>(null);
  const identityEpoch = useRef(0);
  const getSessionEpoch = useCallback(() => identityEpoch.current, []);
  const clearIdentity = useCallback(() => { ++identityEpoch.current; identity.current = null; }, []);
  const channel = useRef<BroadcastChannel | null>(null);
  const refresh = useCallback(async () => {
    if (!runtime) return;
    const current = ++generation.current;
    try { const next = await api<StudentSession>('/api/student/session'); if (current === generation.current) { const nextIdentity = next.account ? `${next.account.id}:${next.account.admission}:${next.account.role}:${next.account.emailVerified}` : next.persona?.id ?? null; if (identity.current !== nextIdentity) { ++identityEpoch.current; identity.current = nextIdentity; } setSession(next); setError(''); setReadRevision(revision => revision + 1); } }
    catch (e) { if (current === generation.current) { clearIdentity(); setSession(anonymous); setError(messageOf(e)); } }
    finally { if (current === generation.current) setLoading(false); }
  }, [clearIdentity, runtime]);
  const request = useCallback(async <T,>(url: string, options?: RequestInit) => {
    const epoch = identityEpoch.current;
    try { return await api<T>(url, options); }
    catch (e) { if (epoch === identityEpoch.current) { if (e instanceof ApiError && (e.status === 401 || e.code === 'INVALID_SESSION')) { ++generation.current; clearIdentity(); setSession(anonymous); setError(runtime?.capabilities.demoPersonas ? 'Your local demo session ended. Choose a persona to continue.' : 'Your account session ended. Sign in to continue.'); } else if (e instanceof ApiError && ['CONSENT_REQUIRED','PRIVACY_CONSENT_REQUIRED','YOUTH_REVIEW_REQUIRED'].includes(e.code ?? '')) { if(e.code==='YOUTH_REVIEW_REQUIRED')clearIdentity(); setSession(current => ({ ...current, profile: null, account:e.code==='YOUTH_REVIEW_REQUIRED'&&current.account?{...current.account,admission:'REVIEW_REQUIRED'}:current.account })); } } throw e; }
  }, [clearIdentity, runtime]);
  useEffect(() => {
    if (!runtime) return;
    void refresh();
    // Keep same-persona forms mounted while a routine background check completes.
    // The returned identity (or an invalid session) still changes the provider key.
    const check = () => { void refresh(); };
    const changed = () => { clearIdentity(); setSession(anonymous); setLoading(true); void refresh(); };
    const visible = () => { if (document.visibilityState === 'visible') check(); };
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', visible);
    if ('BroadcastChannel' in window) { channel.current = new BroadcastChannel(runtime.capabilities.demoPersonas ? 'comground-demo-session' : 'comground-account-session'); channel.current.onmessage = changed; }
    return () => { window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', visible); channel.current?.close(); };
  }, [refresh, clearIdentity, runtime]);
  async function selectPersona(personaId: DemoPersonaId) {
    if (!runtime?.capabilities.demoPersonas) throw new Error('Demo personas are unavailable in account mode.');
    ++generation.current; clearIdentity(); setSession(anonymous); setError(''); setLoading(true);
    try { await api('/api/student/session', { method: 'POST', body: JSON.stringify({ personaId }) }); await refresh(); channel.current?.postMessage('changed'); }
    catch (e) { setLoading(false); setError(messageOf(e)); throw e; }
  }
  async function changeSession<T>(url:string, options:RequestInit) {
    if (!runtime?.capabilities.accounts) throw new Error('Accounts are unavailable in demo mode.');
    ++generation.current; clearIdentity(); setSession(anonymous); setError(''); setLoading(true);
    try { const result = await api<T>(url,options); await refresh(); channel.current?.postMessage('changed'); return result; }
    catch (cause) { await refresh(); setError(messageOf(cause)); throw cause; }
  }
  async function endSession() {
    ++generation.current; clearIdentity(); setSession(anonymous); setLoading(true); setError('');
    try { await api(runtime?.capabilities.accounts ? '/api/account/session' : '/api/student/session', { method: 'DELETE' }); channel.current?.postMessage('changed'); }
    catch (e) { await refresh(); setError(messageOf(e)); throw e; }
    finally { setLoading(false); }
  }
  return <CampaignProvider><Context.Provider value={{ session, loading, error, readRevision, getSessionEpoch, refresh, selectPersona, changeSession, endSession, request }}><div key={session.account ? `${session.account.id}:${session.account.admission}:${session.account.role}:${session.account.emailVerified}` : session.persona?.id ?? 'anonymous'}>{children}</div></Context.Provider></CampaignProvider>;
}
export function useStudent() { const value = useContext(Context); if (!value) throw new Error('StudentProvider is required.'); return value; }
export function StudentGate({ children, requireProfile = true }: { children: ReactNode; requireProfile?: boolean }) {
  const { session, loading, error, refresh } = useStudent();
  const { runtime } = useRuntime();
  const { withCampaign } = useCampaign();
  if (!runtime) return <RuntimeBoundary>{null}</RuntimeBoundary>;
  if (runtime.capabilities.accounts) {
    if (loading) return <p role="status" className="loading-label">Checking your account session…</p>;
    if (!session.authenticated) return <section className="student-gate"><h2>Sign in to save your next step.</h2><p>Browse publicly, or sign in to manage your own profile, saved dates and activity.</p>{error&&<p className="notice error" role="alert">{error}</p>}<div className="button-row"><Link className="button primary" href={withCampaign('/account/login')}>Sign in</Link><Link className="button secondary" href={withCampaign('/account/signup')}>Create an account</Link><Link className="text-link" href="/opportunities">Browse opportunities →</Link></div></section>;
    if (!session.account?.emailVerified) return <section className="student-gate"><h2>Verify your email to continue.</h2><p>Profile storage and private student features require a verified account.</p><Link className="button primary" href="/account/verify">Email verification</Link></section>;
    if (session.account.role !== 'STUDENT') return <section className="student-gate"><h2>This is an operator account.</h2><p>Student preferences and private activity are available to student accounts.</p><Link className="button primary" href="/admin">Open operator console</Link></section>;
    if (session.account.admission==='REVIEW_REQUIRED') return <section className="student-gate"><h2>A local review is needed first.</h2><p>Teen preferences stay private and unavailable until the assigned guardian or school reviewer records a current local decision. This synthetic workflow is not verified legal consent.</p><Link className="button primary" href="/account/youth-review">Open review status</Link><Link className="text-link" href="/account/privacy">Export or withdraw stored data →</Link></section>;
    if (requireProfile && !session.profile) return <section className="student-gate"><h2>Choose your preferences and privacy settings.</h2><p>Storage and personalized matching need your consent. Email reminders and measurement are separate choices.</p><Link className="button primary" href={withCampaign('/onboarding')}>Complete onboarding</Link></section>;
    return children;
  }
  if (loading) return <div className="student-loading" role="status"><p>Opening your local demo…</p><div className="skeleton" /></div>;
  if (!session.authenticated || (requireProfile && !session.profile)) return <section className="student-gate"><span className="empty-symbol" aria-hidden="true">↗</span><h2>{session.authenticated ? 'Set your example preferences.' : 'Choose a demo persona to begin.'}</h2><p>Use synthetic details only. These shared local personas are examples, not private production accounts.</p>{error && <p className="notice error" role="alert">{error}<button className="plain-button" onClick={() => void refresh()}>Retry session check</button></p>}<Link className="button primary" href={withCampaign('/onboarding')}>{session.authenticated ? 'Complete onboarding' : 'Choose a demo persona'}</Link><Link className="text-link" href="/opportunities">Or browse without a profile →</Link></section>;
  return children;
}
