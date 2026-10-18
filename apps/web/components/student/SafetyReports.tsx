'use client';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import type { SafetyTargetInput } from '../../../../packages/domain/safety-contracts.ts';
import { RuntimeBoundary, useRuntime } from '../account/RuntimeContext';
import { useStudent } from './StudentSession';
import { PageHeading } from './StudentCommon';
import { SafetyReportForm } from './SafetyReportForm';
import { SafetyHistory } from './SafetyHistory';

function SafetyGate({ children }: { children: ReactNode }) {
  const { runtime } = useRuntime(), { session, loading, error, refresh } = useStudent();
  if (!runtime) return <RuntimeBoundary>{null}</RuntimeBoundary>;
  if (runtime.capabilities.demoPersonas) return <section className="settings-panel"><h2>Private reports need an account.</h2><p>Shared demo personas cannot store private safety reports. This local example does not receive or respond to real safeguarding concerns.</p><Link className="text-link" href="/opportunities">Back to example opportunities →</Link></section>;
  if (loading) return <p className="loading-label" role="status">Checking your account…</p>;
  if (!session.authenticated) return <section className="student-gate"><h2>Sign in to record a private concern.</h2><p>Reports are visible only to the account that submitted them and authorized operators.</p>{error && <p className="notice error" role="alert">{error}</p>}<Link className="button primary" href="/account/login">Sign in</Link></section>;
  if (!session.account?.emailVerified) return <section className="settings-panel"><h2>Verify your email first.</h2><p>A verified account is required to record a private report.</p><Link className="button primary" href="/account/verify">Email verification</Link><button className="plain-button" type="button" onClick={() => void refresh()}>Refresh account status</button></section>;
  if (session.account.role !== 'STUDENT') return <section className="settings-panel"><h2>Use the operator review queue.</h2><p>Student reporting and operator review use separate permissions.</p><Link className="button primary" href="/admin/safety">Open safety review</Link></section>;
  return children;
}

function SafetyContent({ initialTarget }: { initialTarget: SafetyTargetInput | null }) {
  const [revision, setRevision] = useState(0);
  return <><SafetyReportForm initialTarget={initialTarget} onSaved={() => setRevision(value => value + 1)} /><SafetyHistory revision={revision}/></>;
}
export function SafetyReports({ initialTarget = null }: { initialTarget?: SafetyTargetInput | null }) {
  return <div className="page-shell student-page">
    <PageHeading eyebrow="SAFETY / PRIVATE REPORTS" title="Raise a concern. Keep control of your report." description="Record a safety concern about a specific listing date or this platform. You can read its status, export it, or delete it."/>
    <section className="settings-panel" aria-labelledby="safety-support-heading"><h2 id="safety-support-heading">If you need help now</h2><p>If someone is in immediate danger, contact local emergency services. For a personal concern, speak with a trusted adult or your school’s designated safeguarding contact. If the concern involves that person, choose another trusted adult.</p><p className="notice warning">This local app is not an emergency or monitored safeguarding service. It cannot promise a response. Use fictional examples only; do not submit a real incident or identifying details.</p></section>
    <div style={{marginTop:'1.5rem'}}><SafetyGate><SafetyContent initialTarget={initialTarget}/></SafetyGate></div>
  </div>;
}
