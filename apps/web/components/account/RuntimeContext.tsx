'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { RuntimeCapabilities } from '../../../../packages/domain/runtime-contracts.ts';
import { api, messageOf } from '../Api';

type RuntimeState = { runtime: RuntimeCapabilities | null; loading: boolean; error: string; reload: () => void };
const Context = createContext<RuntimeState | null>(null);
export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<RuntimeCapabilities | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    api<RuntimeCapabilities>('/api/runtime').then(value => { if (active) setRuntime(value); }).catch(cause => { if (active) { setRuntime(null); setError(messageOf(cause)); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  return <Context.Provider value={{runtime, loading, error, reload}}>{children}</Context.Provider>;
}
export function useRuntime() { const value = useContext(Context); if (!value) throw new Error('RuntimeProvider is required.'); return value; }
export function RuntimeBoundary({ children }: { children: ReactNode }) {
  const { runtime, loading, error, reload } = useRuntime();
  if (loading) return <div className="student-loading" role="status"><p>Checking available features…</p><div className="skeleton" /></div>;
  if (!runtime) return <section className="notice error" role="alert"><h2>We couldn’t check this app’s configuration.</h2><p>{error}</p><button className="button secondary" onClick={reload}>Retry configuration check</button></section>;
  return children;
}
export function SiteFooter() {
  const { runtime } = useRuntime();
  return <footer className="site-footer"><p><strong>CommonGround</strong><span>Small steps. Shared ground.</span></p><p>{runtime?.capabilities.demoPersonas ? <>Synthetic local app · No real listings or verified organizations.<br />Shared demo personas. Use example details only.</> : runtime ? <>For high-school students · Real minor enrollment is disabled.<br />{runtime.capabilities.syntheticYouth?'Fictional teen accounts and reviews are local tests only. ':''}{runtime.catalogue === 'EMPTY_PENDING_FEEDS' ? 'Real opportunity feeds are not connected.' : 'Synthetic listings are not real opportunities.'}</> : 'Checking the application configuration.'}</p></footer>;
}
