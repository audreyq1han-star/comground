'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DigestPreview, DigestSubscription } from '../../../../packages/domain/distribution-contracts.ts';
import { messageOf } from '../Api';
import { OpportunityCard } from '../OpportunityCard';
import styles from '../distribution.module.css';
import { EmptyPanel, LoadState, PageHeading } from './StudentCommon';
import { StudentGate, useStudent } from './StudentSession';
import { useStudentResource } from './useStudentResource';

function SubscriptionForm({ value, onSaved }: { value: DigestSubscription; onSaved: () => void }) {
  const { request, getSessionEpoch } = useStudent();
  const [enabled, setEnabled] = useState(value.enabled), [dirty, setDirty] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const busy = useRef(false);
  useEffect(() => { if (!dirty) setEnabled(value.enabled); }, [value.enabled, dirty]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current) return; busy.current = true;
    const epoch = getSessionEpoch(); setPending(true); setError(''); setMessage('');
    try { await request('/api/student/digest', { method: 'PUT', body: JSON.stringify({ enabled, expectedVersion: value.version, expectedProfileVersion: value.profileVersion }) }); if (epoch !== getSessionEpoch()) return; setDirty(false); setMessage(enabled ? 'Digest subscription saved. Delivery still requires a current reviewed batch and enabled email service.' : 'Digest subscription is off. Prepared selections were removed.'); onSaved(); }
    catch (cause) { if (epoch === getSessionEpoch()) setError(messageOf(cause)); }
    finally { busy.current = false; if (epoch === getSessionEpoch()) setPending(false); }
  }
  return <form className="settings-panel" onSubmit={save}><h2>Optional shortlist digest emails</h2><p>A digest invites you back to your current shortlist. It does not sign you up for an event. This choice is separate from event reminders and optional measurement.</p>
    {!value.externalEligible && <p className="notice warning">External digests are unavailable for this profile. Teen and demo profiles can use private in-app previews. Local review approval does not enable outbound email.</p>}
    <label className={styles.review}><input type="checkbox" checked={enabled} disabled={pending || !value.externalEligible && !value.enabled} onChange={event => { setEnabled(event.target.checked); setDirty(true); }} /><span>Enable optional shortlist digest emails<small className={styles.meta}> · Off by default. Turn off at any time.</small></span></label>
    <div className={styles.actions}><button type="submit" className="button primary" disabled={pending || !dirty || enabled && !value.externalEligible}>{pending ? 'Saving…' : 'Save digest choice'}</button><button type="button" className="button secondary" disabled={pending} onClick={() => { setDirty(false); setEnabled(value.enabled); onSaved(); }}>Reload saved choice</button></div>
    {error && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice success" role="status">{message}</p>}<p className="fine-print">Saved choice: {value.enabled ? 'on' : 'off'}. A message already in flight may arrive after you withdraw. No digest schedule is created here.</p><Link className="text-link" href="/account/notifications">Event reminder settings →</Link>
  </form>;
}
function DigestContent() {
  const subscription = useStudentResource<{ data: DigestSubscription }>('/api/student/digest');
  const { request, getSessionEpoch, readRevision } = useStudent();
  const [preview, setPreview] = useState<DigestPreview | null>(null), [pending, setPending] = useState(false), [error, setError] = useState('');
  const sequence = useRef(0), busy = useRef(false);
  useEffect(() => { ++sequence.current; setPreview(null); setError(''); setPending(false); busy.current = false; return () => { ++sequence.current; }; }, [readRevision]);
  async function loadPreview() {
    if (busy.current) return; busy.current = true; const epoch = getSessionEpoch(), current = ++sequence.current;
    setPending(true); setError(''); setPreview(null);
    try { const result = await request<{ data: DigestPreview }>('/api/student/digest/preview'); if (epoch === getSessionEpoch() && current === sequence.current) setPreview(result.data); }
    catch (cause) { if (epoch === getSessionEpoch() && current === sequence.current) setError(messageOf(cause)); }
    finally { if (current === sequence.current) { busy.current = false; setPending(false); } }
  }
  return <div className={styles.stack}><section className="settings-panel"><h2>Your private shortlist preview</h2><p>Check up to three current opportunities against your saved requirements. This preview stays in the app and does not subscribe you to email.</p><button className="button primary" onClick={() => void loadPreview()} disabled={pending}>{pending ? 'Checking current dates…' : 'Prepare private preview'}</button>
    {pending && <p role="status" aria-busy="true">Checking current published opportunities and exact dates…</p>}{error && <p className="notice error" role="alert">{error}</p>}
    {preview && <div className={styles.preview}><p role="status">{preview.opportunities.length} current options · checked {new Date(preview.generatedAt).toLocaleString()}.</p>{preview.opportunities.length ? <div className="dashboard-matches">{preview.opportunities.map(item => <OpportunityCard key={`${item.id}:${item.occurrenceId ?? 'primary'}`} opportunity={item} />)}</div> : <EmptyPanel title="No current shortlist options." text="No available occurrence meets your saved requirements. You can check your preferences or return when supply changes." href="/profile" label="Review preferences" />}</div>}
  </section><LoadState {...subscription} retry={subscription.reload}>{subscription.data && <SubscriptionForm value={subscription.data.data} onSaved={subscription.reload} />}</LoadState></div>;
}
export function ShortlistDigestPage() { return <div className="page-shell student-page"><PageHeading eyebrow="YOUR SHORTLIST" title="A fresh look at your next step." description="Preview current opportunities privately, then decide whether optional digest emails are useful to you." /><StudentGate><DigestContent /></StudentGate></div>; }
