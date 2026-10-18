'use client';

import Link from 'next/link';
import { useId, useRef, useState, type FormEvent } from 'react';
import type { FeedbackKind, StudentFeedback } from '../../../../packages/domain/app-contracts.ts';
import { messageOf } from '../Api';
import { useRuntime } from '../account/RuntimeContext';
import { useStudent } from './StudentSession';

function FeedbackForm({ opportunityId, occurrenceId }: { opportunityId: string; occurrenceId: string }) {
  const { request } = useStudent();const {runtime}=useRuntime();const account=!!runtime?.capabilities.accounts;
  const fieldId = useId();
  const [kind, setKind] = useState<FeedbackKind>('NOT_RELEVANT');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<StudentFeedback | null>(null);
  const busy = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    setSaved(null);
    try {
      const response = await request<{ data: StudentFeedback }>('/api/student/feedback', { method: 'POST', body: JSON.stringify({ opportunityId, occurrenceId, kind }) });
      setSaved(response.data);
    } catch (cause) { setError(messageOf(cause)); }
    finally { busy.current = false; setPending(false); }
  }

  return <section className="settings-panel" aria-labelledby={`${fieldId}-heading`}>
    <p className="eyebrow">FEEDBACK / SYNTHETIC EXAMPLE</p><h2 id={`${fieldId}-heading`}>Not the right fit, or something wrong?</h2>
    <p>Record a fit preference or flag a listing fact. This does not record an application, attendance or withdrawal.</p>
    <form onSubmit={submit}>
      <div className="field"><label htmlFor={fieldId}>Feedback about this date</label>
        <select id={fieldId} value={kind} disabled={pending} onChange={event => { setKind(event.target.value as FeedbackKind); setSaved(null); setError(''); }} aria-describedby={`${fieldId}-sharing`}>
          <option value="NOT_RELEVANT">Not relevant to me · private</option>
          <option value="WRONG_DETAILS">The listing details look wrong · share with reviewer</option>
          <option value="UNAVAILABLE">The opportunity appears unavailable · share with reviewer</option>
        </select>
      </div>
      <p id={`${fieldId}-sharing`} className="fine-print">{kind === 'NOT_RELEVANT' ? account?'This fit feedback stays private to your account. It does not change your matching requirements.':'This fit feedback stays with your demo persona. It is not shared with the reviewer and does not change your matching requirements.' : 'Only this listing and the selected issue are shared with the local reviewer. Your identity and preferences are not included.'}</p>
      <button className="button secondary" type="submit" disabled={pending}>{pending ? 'Recording feedback…' : 'Record feedback'}</button>
    </form>
    {error && <p className="notice error" role="alert">{error} You can retry using Record feedback.</p>}
    {saved && <p className="action-status" role="status">{saved.kind === 'NOT_RELEVANT' ? 'Fit feedback saved privately.' : saved.status === 'RESOLVED' ? 'This listing report is already addressed. Its resolution is in your feedback history.' : 'Listing report recorded for the local reviewer.'} <Link href="/activity#feedback-history">View your feedback history →</Link></p>}
  </section>;
}

export function OpportunityFeedback({ opportunityId, occurrenceId }: { opportunityId: string; occurrenceId: string }) {
  const { session, loading } = useStudent();const{runtime}=useRuntime();const account=!!runtime?.capabilities.accounts;
  if (loading) return <p className="loading-label" role="status">Checking your session…</p>;
  if (!session.authenticated || !session.profile) return <p className="fine-print"><Link href={account&&!session.authenticated?'/account/login':'/onboarding'}>{account?'Set up a verified account and consented profile':'Choose a demo persona and consent to storage'}</Link> to save private fit feedback or report a listing issue.</p>;
  return <FeedbackForm key={`${session.profile?.personaId}-${opportunityId}-${occurrenceId}`} opportunityId={opportunityId} occurrenceId={occurrenceId} />;
}
