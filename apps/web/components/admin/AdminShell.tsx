'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { RuntimeBoundary, useRuntime } from '../account/RuntimeContext';
import { api, messageOf } from '../Api';

const AdminSessionContext = createContext({ invalidate: () => {} });
export const useAdminSession = () => useContext(AdminSessionContext);
const navigation = [
  ['/admin', 'Overview'], ['/admin/review', 'Review queue'], ['/admin/opportunities', 'Catalogue'],
  ['/admin/sources', 'Sources'], ['/admin/source-control','Source operations'], ['/admin/import-runs', 'Import history'], ['/admin/organizations', 'Organizations'],
  ['/admin/matching-qa', 'Matching QA'], ['/admin/outcomes', 'Outcomes'], ['/admin/measurement', 'Measurement'], ['/admin/acquisition', 'Acquisition'],
  ['/admin/distribution', 'Shortlist digests'], ['/admin/community-pages', 'Community pages'], ['/admin/evidence', 'Evidence review'], ['/admin/safety', 'Safety reports'], ['/admin/readiness', 'Expansion review'], ['/admin/notifications', 'Notifications'], ['/admin/exceptions', 'Exceptions'], ['/admin/reports', 'Listing reports'],
];

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { runtime } = useRuntime();
  const demo = runtime?.capabilities.demoPersonas === true;
  const [authenticated, setAuthenticated] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const busy = useRef(false);
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current += 1;
    setAuthenticated(false); setToken('');
    setNotice('Your reviewer session ended or expired. Sign in again to continue.');
  }, []);
  const check = useCallback(async () => {
    if (!runtime) return;
    const current = generation.current;
    try {
      const result = await api<{ authenticated: boolean }>('/api/admin/session');
      if (current === generation.current) { setAuthenticated(result.authenticated); if (!result.authenticated) setToken(''); setError(''); }
    } catch (e) { if (current === generation.current) { setAuthenticated(false); setError(messageOf(e)); } }
    finally { setInitializing(false); }
  }, [runtime]);
  useEffect(() => { void check(); }, [check, pathname]);
  useEffect(() => {
    const onFocus = () => { void check(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') void check(); };
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onVisibility);
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisibility); };
  }, [check]);
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy.current) return; busy.current = true;
    generation.current += 1; setPending(true); setError(''); setNotice('');
    try { await api('/api/admin/session', { method: 'POST', body: JSON.stringify({ token: token.trim() }) }); setToken(''); setAuthenticated(true); }
    catch (e) { setError(messageOf(e)); }
    finally { busy.current = false; setPending(false); }
  }
  async function logout() {
    if (busy.current) return; busy.current = true;
    generation.current += 1; setPending(true); setError('');
    // Remove private UI immediately; a failed request remains visible and retryable.
    setAuthenticated(false); setToken('');
    try { await api(demo ? '/api/admin/session' : '/api/account/session', { method: 'DELETE' }); setNotice('Reviewer session ended.'); }
    catch (e) { setError(messageOf(e) + ' Session clearing was not confirmed. Use “Retry ending session”.'); }
    finally { busy.current = false; setPending(false); }
  }
  if (!runtime) return <RuntimeBoundary>{null}</RuntimeBoundary>;
  return <AdminSessionContext.Provider value={{ invalidate }}><div className="op-app">
    <div className="op-context"><div><span className="op-context-mark" aria-hidden="true">CG</span><div><strong>Operator workspace</strong><span>{demo ? 'Synthetic local data only' : 'Verified operator access · feeds pending'}</span></div></div>{authenticated && <button className="button secondary" onClick={logout} disabled={pending}>End reviewer session</button>}</div>
    {notice && <p className="op-notice" role="status">{notice}</p>}
    {error && <div className="notice error" role="alert"><p>{error}</p><div className="op-actions"><button className="button secondary" onClick={() => { void check(); }} disabled={pending}>Retry connection</button><button className="button secondary" onClick={logout} disabled={pending}>Retry ending session</button></div></div>}
    {initializing ? <div className="op-loading" role="status" aria-busy="true">Checking reviewer session…</div> : !authenticated ? <div className="op-entry">
      {demo ? <form className="op-panel op-login" onSubmit={login}><p className="eyebrow">REVIEWER ACCESS</p><h1>Keep the catalogue trustworthy.</h1><p>Open a local reviewer session to inspect sources, review changes and test the complete publication flow.</p><div className="field"><label htmlFor="operator-token">Temporary reviewer token</label><input id="operator-token" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} required maxLength={512} spellCheck={false} /><small>Printed by the local start command. It is not stored in this form or a credential file.</small></div><button className="button primary" type="submit" disabled={pending || !token.trim()}>{pending ? 'Opening session…' : 'Open reviewer session'}</button></form> : <section className="op-panel op-login"><p className="eyebrow">OPERATOR ACCESS</p><h1>Keep the catalogue trustworthy.</h1><p>Sign in with a verified operator account. Student accounts cannot access this workspace.</p><Link className="button primary" href="/account/login">Sign in to your account</Link><button className="button secondary" onClick={()=>void check()}>Check access again</button></section>}
      <aside className="op-entry-notes"><p className="eyebrow">{demo ? 'A LOCAL DEMONSTRATION' : 'REVIEW BEFORE PUBLICATION'}</p><h2>Keep every decision<br />connected to evidence.</h2><ol><li>Review evidence before publishing a listing.</li><li>Pause sources and investigate exceptions.</li><li>Keep clicks, applications and attendance distinct.</li></ol><p>No real feeds, verified organizers, external AI or messages are connected. Account access and optional services require explicit configuration.</p><Link className="text-link" href="/opportunities">View the student catalogue →</Link></aside>
    </div> : <div className="op-workspace"><nav className="op-nav" aria-label="Operator sections">{navigation.map(([href,label]) => <Link prefetch={false} key={href} href={href} aria-current={(pathname === href || (href === '/admin/opportunities' && pathname.startsWith(href + '/'))) ? 'page' : undefined}>{label}</Link>)}<p>Organizations and partner pages are synthetic and not verified.</p></nav><div className="op-content" key="authenticated-content">{children}</div></div>}
  </div></AdminSessionContext.Provider>;
}
