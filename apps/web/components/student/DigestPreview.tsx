'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { StudentMatches } from '../../../../packages/domain/app-contracts.ts';
import { messageOf } from '../Api';
import { OpportunityCard } from '../OpportunityCard';
import { EmptyPanel } from './StudentCommon';
import { StudentGate, useStudent } from './StudentSession';

function PreviewContent() {
  const { request, session, readRevision } = useStudent();
  const headingId = useId();
  const [result, setResult] = useState<StudentMatches | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    sequence.current += 1;
    busy.current = false;
    setResult(null);
    setPending(false);
    setError('');
    return () => { sequence.current += 1; };
  }, [readRevision, session.profile?.version]);

  async function preview() {
    if (busy.current) return;
    busy.current = true;
    const current = ++sequence.current;
    setPending(true);
    setError('');
    setResult(null);
    try {
      const response = await request<StudentMatches>('/api/student/matches', { method: 'POST', body: '{}' });
      if (current === sequence.current) setResult(response);
    } catch (cause) {
      if (current === sequence.current) setError(messageOf(cause));
    } finally {
      if (current === sequence.current) { busy.current = false; setPending(false); }
    }
  }

  return <section className="dashboard-section" aria-labelledby={headingId}>
    <div className="results-heading"><div><p className="eyebrow">SHORTLIST DIGEST / MANUAL PREVIEW</p><h2 id={headingId}>A preview of your shortlist.</h2></div>
      <button className="button secondary" type="button" disabled={pending} onClick={() => void preview()}>{pending ? 'Preparing preview…' : 'Preview shortlist'}</button>
    </div>
    <p>See up to three current eligible examples using your saved preferences and the same requirements-first matching rules.</p>
    <p className="notice warning">Preview only. Nothing is scheduled or sent.</p>
    {pending && <p className="loading-label" role="status" aria-busy="true">Checking the current catalogue and preparing your preview…</p>}
    {error && <div className="notice error" role="alert"><p>{error}</p><button className="button secondary" type="button" onClick={() => void preview()}>Retry shortlist preview</button></div>}
    {result && <><p role="status">Preview ready: {Math.min(3, result.data.length)} examples from {result.eligibleCount} eligible options · profile version {result.profileVersion}.</p>
      {result.data.length ? <div className="dashboard-matches">{result.data.slice(0, 3).map((match, index) => <OpportunityCard key={match.opportunity.id} opportunity={match.opportunity} reasons={match.reasons} position={index + 1} />)}</div>
        : <EmptyPanel title="No current examples for this preview." text="No available example meets all your saved requirements. Your requirements remain intact; review your preferences or try again when supply changes." href="/profile" label="Review preferences" />}
      <p className="fine-print">This is a snapshot from the current local catalogue. Open a listing to recheck its availability and evidence before taking a next step.</p>
    </>}
  </section>;
}

export function DigestPreview() { return <StudentGate><PreviewContent /></StudentGate>; }
