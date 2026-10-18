'use client';
import Link from 'next/link';
import { useId, useRef, useState, type FormEvent } from 'react';
import { SAFETY_CATEGORIES, SAFETY_CATEGORY_LABELS, SAFETY_URGENCIES, SAFETY_URGENCY_LABELS, type SafetyUrgency, type SafetyCategory, type SafetyReport, type SafetyTargetInput } from '../../../../packages/domain/safety-contracts.ts';
import { messageOf } from '../Api';
import { opportunityHref } from '../OpportunityCard';
import { useStudent } from './StudentSession';

export function SafetyReportForm({ initialTarget, onSaved }: { initialTarget: SafetyTargetInput | null; onSaved: () => void }) {
  const id = useId(), { request, getSessionEpoch } = useStudent();
  const [kind, setKind] = useState<'PLATFORM' | 'LISTING'>(initialTarget?.kind ?? 'PLATFORM');
  const [category, setCategory] = useState<SafetyCategory>(initialTarget?.kind === 'LISTING' ? 'UNSAFE_ACTIVITY' : 'PLATFORM_SAFETY'), [narrative, setNarrative] = useState(''), [consent, setConsent] = useState(false);
  const [urgency, setUrgency] = useState<SafetyUrgency>('ROUTINE');
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const busy = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current || !consent) return;
    const target = kind === 'LISTING' ? initialTarget : { kind: 'PLATFORM' as const };
    if (!target) { setError('Open a listing date to report a concern about it.'); return; }
    const epoch = getSessionEpoch(); busy.current = true; setPending(true); setError(''); setSuccess('');
    try {
      await request<{data:SafetyReport}>('/api/student/safety/reports', { method: 'POST', body: JSON.stringify({ target, category, urgency, narrative, storageConsent: true }) });
      if (epoch !== getSessionEpoch()) return;
      setNarrative(''); setConsent(false); setSuccess('Your example report was recorded. Its status is shown below. No message was sent to another person.'); onSaved();
    } catch (cause) { if (epoch === getSessionEpoch()) setError(messageOf(cause)); }
    finally { busy.current = false; if (epoch === getSessionEpoch()) setPending(false); }
  }
  return <section className="settings-panel" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>Record a private concern</h2><p>A profile or approved youth review is not required. Submitting stores this report for the separate purpose of recording and reviewing a concern.</p>
    <form onSubmit={submit} style={{display:'grid',gap:'1rem'}}>
      <div className="field"><label htmlFor={`${id}-target`}>What is this report about?</label><select id={`${id}-target`} value={kind} disabled={pending} onChange={event => { const next = event.target.value as typeof kind; setKind(next); setCategory(next === 'PLATFORM' ? 'PLATFORM_SAFETY' : 'UNSAFE_ACTIVITY'); }}><option value="PLATFORM">Platform safety</option>{initialTarget?.kind === 'LISTING' && <option value="LISTING">The selected listing date</option>}</select></div>
      {kind === 'LISTING' && initialTarget?.kind === 'LISTING' ? <p className="fine-print" style={{overflowWrap:'anywhere'}}>Selected listing {initialTarget.opportunityId}, date {initialTarget.occurrenceId}. <Link className="text-link" href={opportunityHref(initialTarget.opportunityId, initialTarget.occurrenceId)}>Check this listing date →</Link> The server checks that this exact date has been published.</p> : <p className="fine-print">To report an activity, use “Report a safety concern” on its listing date.</p>}
      <div className="field"><label htmlFor={`${id}-category`}>Concern category</label><select id={`${id}-category`} value={category} disabled={pending} onChange={event => setCategory(event.target.value as SafetyCategory)}>{SAFETY_CATEGORIES.map(value => <option key={value} value={value}>{SAFETY_CATEGORY_LABELS[value]}</option>)}</select></div>
      <div className="field"><label htmlFor={`${id}-urgency`}>How urgent is this concern?</label><select id={`${id}-urgency`} value={urgency} disabled={pending} onChange={event=>setUrgency(event.target.value as SafetyUrgency)}>{SAFETY_URGENCIES.map(value=><option key={value} value={value}>{SAFETY_URGENCY_LABELS[value]}</option>)}</select></div>
      {urgency==='IMMEDIATE_DANGER'&&<p className="notice warning" role="status">Do not wait for an app response. If someone may be in immediate danger, contact local emergency services or a trusted adult who can help now. This report does not send an emergency alert.</p>}
      <div className="field"><label htmlFor={`${id}-narrative`}>Optional example details</label><textarea id={`${id}-narrative`} value={narrative} onChange={event => setNarrative(event.target.value)} disabled={pending} rows={4} maxLength={500} aria-describedby={`${id}-privacy ${id}-count`}/><p id={`${id}-privacy`} className="fine-print">Use fictional, non-identifying details only. Do not include names, email addresses, phone numbers, locations, links, or HTML. Operators can read this text; it is not shared with other students.</p><p id={`${id}-count`} className="fine-print">{narrative.length}/500 characters</p></div>
      <div className="consent-box"><label><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={pending} required/><span>Store this example report and its review history.<small>I can delete the report here or export it through account privacy controls. Deleting my account removes it. Up to six reports can be created in 24 hours; deleting a report does not reset this limit.</small></span></label></div>
      <div className="button-row"><button className="button primary" disabled={pending || !consent} type="submit">{pending ? 'Recording…' : 'Record private concern'}</button><Link className="text-link" href="/account/privacy">Export and privacy controls →</Link></div>
      {error && <p className="notice error" role="alert">{error}</p>}{success && <p className="notice success" role="status">{success}</p>}
    </form>
  </section>;
}
