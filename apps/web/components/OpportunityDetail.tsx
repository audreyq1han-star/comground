'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import type { PublicOpportunity } from '../../../packages/domain/contracts.ts';
import { api, ApiError, messageOf } from './Api';
import { ageText, eventDate, eventTime, feeText, requirementText, occurrenceLabel } from './OpportunityCard';
import { OpportunityActions } from './student/OpportunityActions';
import { OpportunityFeedback } from './student/OpportunityFeedback';

export function ExampleAddress({ url, label }: { url: string; label: string }) {
  // Addresses remain visible text: this synthetic demo never navigates to an outside provider.
  return <div className="example-address"><span>{label} · example address only</span><code>{url}</code></div>;
}

function DetailContent({ id }: { id: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const selectedQuery = new URLSearchParams();
  for (const value of params.getAll('occurrence')) selectedQuery.append('occurrence', value);
  const occurrenceQuery = selectedQuery.toString();
  const [item, setItem] = useState<PublicOpportunity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError(''); setMissing(false); setItem(null);
    const query = occurrenceQuery ? `?${occurrenceQuery}` : '';
    api<{ data: PublicOpportunity }>(`/api/opportunities/${encodeURIComponent(id)}${query}`).then(r => { if (active) setItem(r.data); }).catch(e => { if (active) { setMissing(e instanceof ApiError && e.status === 404); setError(messageOf(e)); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, occurrenceQuery, attempt]);
  function selectOccurrence(value: string) { const query = new URLSearchParams(params.toString()); query.set('occurrence', value); router.push(`/opportunities/${encodeURIComponent(id)}?${query}`, { scroll: false }); }
  return <div className="page-shell detail-page"><Link href="/opportunities" className="back-link">← All opportunities</Link>
    {loading ? <div className="detail-loading" aria-busy="true"><h1>Loading opportunity…</h1><div className="skeleton" /></div> : error || !item ? <section className="empty-state" role="alert"><h1>{missing ? 'This opportunity is unavailable.' : 'We couldn’t load this opportunity.'}</h1><p>{missing ? 'Only current, published examples can be viewed. It may have expired or changed since you last looked.' : error}</p>{!missing && <button className="button secondary" onClick={() => setAttempt(n => n + 1)}>Try again</button>}<Link className="button primary" href="/opportunities">Back to the catalogue</Link></section> : <>
      <header className="detail-heading"><div className="card-top"><span className="category-badge">{item.category}</span><span className="synthetic-label">Synthetic example</span></div><h1>{item.title}</h1><p className="detail-organization">With {item.organization.name}<span className="verification-note">Synthetic — not verified</span></p><p className="lead">{item.summary}</p></header>
      <section className="settings-panel" aria-labelledby="selected-date-heading"><h2 id="selected-date-heading">Choose a date</h2><div className="field"><label htmlFor="selected-occurrence">Current available date</label><select id="selected-occurrence" value={item.occurrenceId ?? 'primary'} onChange={event => selectOccurrence(event.target.value)}>{(item.occurrences?.length ? item.occurrences : [{ ...item, id: item.occurrenceId ?? 'primary' }]).map(occurrence => <option key={occurrence.id} value={occurrence.id}>{occurrenceLabel(occurrence.startsAt, occurrence.endsAt, occurrence.timezone)}</option>)}</select></div><p className="fine-print">The requirements, save, signup preview and feedback below apply to this date. Choosing another date does not mean it meets your stored availability; check Matches for an eligible date.</p></section>
      <div className="detail-columns"><div className="detail-content"><section className="detail-section"><h2>The details, up front.</h2><dl className="detail-facts"><div><dt>When</dt><dd>{eventDate(item.startsAt, item.timezone)}<span>{eventTime(item.startsAt, item.timezone)}–{eventTime(item.endsAt, item.timezone)} · {item.timezone}</span></dd></div><div><dt>Where</dt><dd>{item.mode === 'REMOTE' ? 'Remote' : item.area}<span>{item.mode === 'REMOTE' ? 'Online example opportunity' : 'Coarse area only · not a travel-time estimate'}</span></dd></div><div><dt>Who</dt><dd>{ageText(item.minAge, item.maxAge)}</dd></div><div><dt>Cost</dt><dd>{feeText(item.fee)}</dd></div></dl></section>
      <section className="detail-section"><h2>Before you take the next step</h2><ul className="requirement-list"><li><span>Training</span><strong>{requirementText(item.requiresTraining, 'Required before attending', 'No prior training required')}</strong></li><li><span>Guardian</span><strong>{requirementText(item.requiresGuardian, 'Guardian required', 'No guardian requirement in the fixture')}</strong></li><li><span>School credit</span><strong>{requirementText(item.schoolCreditApproved, 'Synthetic field only — no real approval claimed', 'No school approval claimed')}</strong></li></ul><p className="fine-print">These are illustrative source facts, not verified real-world permissions. School credit and safeguarding decisions would require the relevant school and organizer.</p></section>
      <section className="detail-section"><h2>Trace it back to the source</h2><p>Each requirement should have an origin you can inspect. All evidence below is synthetic.</p><div className="evidence-list">{item.evidence.map((e, i) => <blockquote key={`${e.field}-${i}`}><p className="evidence-field">{e.field}</p><p>“{e.excerpt}”</p><cite>{e.sourceUrl}</cite></blockquote>)}</div><ExampleAddress label={item.source.name} url={item.source.url} /><dl className="source-dates"><div><dt>Example fetched</dt><dd>{eventDate(item.fetchedAt, item.timezone)}</dd></div><div><dt>Example confirmed</dt><dd>{eventDate(item.confirmedAt, item.timezone)}</dd></div><div><dt>Valid through</dt><dd>{eventDate(item.validUntil, item.timezone)} · {eventTime(item.validUntil, item.timezone)}</dd></div></dl></section><OpportunityFeedback opportunityId={item.id} occurrenceId={item.occurrenceId ?? 'primary'}/></div>
      <aside className="next-step-panel"><p className="eyebrow">YOUR NEXT STEP</p><h2>Know where signup happens.</h2><p>In the future, you’ll complete signup on the organizer’s official website. This local demo shows its example address only.</p><ExampleAddress label="Organizer signup" url={item.signupUrl} /><OpportunityActions key={`${item.id}:${item.occurrenceId ?? 'primary'}`} id={item.id} occurrenceId={item.occurrenceId ?? 'primary'} signupUrl={item.signupUrl}/><Link className="text-link" href="/matches">See my explained matches →</Link><Link className="text-link" href={`/safety?opportunityId=${encodeURIComponent(item.id)}&occurrenceId=${encodeURIComponent(item.occurrenceId??'primary')}`}>Report a safety concern →</Link><Link className="text-link" href="/evidence">Record private fit or evidence →</Link><div className="panel-divider" /><p className="eyebrow">YOUR INTERESTS</p><div className="tag-list">{item.interests.map(i => <span className="interest-tag" key={i}>{i}</span>)}</div></aside></div>
    </>}
  </div>;
}
export function OpportunityDetail({ id }: { id: string }) { return <Suspense fallback={<p className="loading-label" role="status">Loading the selected date…</p>}><DetailContent id={id} /></Suspense>; }
