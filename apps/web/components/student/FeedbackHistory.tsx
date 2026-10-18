'use client';

import { useId } from 'react';
import Link from 'next/link';
import type { StudentFeedback } from '../../../../packages/domain/app-contracts.ts';
import { eventDate, eventTime, opportunityHref } from '../OpportunityCard';
import { EmptyPanel, LoadState } from './StudentCommon';
import { StudentGate } from './StudentSession';
import { useStudentResource } from './useStudentResource';

const labels = { NOT_RELEVANT: 'Not relevant to me', WRONG_DETAILS: 'Listing details look wrong', UNAVAILABLE: 'Opportunity appears unavailable' };

function HistoryContent() {
  const headingId = useId();
  const state = useStudentResource<{ data: StudentFeedback[] }>('/api/student/feedback');
  return <section id="feedback-history" className="dashboard-section" aria-labelledby={headingId}>
    <div className="results-heading"><h2 id={headingId}>Your feedback</h2><button className="plain-button" type="button" disabled={state.loading || state.refreshing} onClick={state.reload}>Refresh feedback</button></div>
    <p>Private fit feedback and listing reports from this demo persona. Feedback does not imply an application or attendance.</p>
    <LoadState {...state} retry={state.reload}>
      {state.data && (state.data.data.length ? <div className="reminder-list">{state.data.data.map(item => <article className="reminder-card" key={item.id}>
        <div><span className="category-badge">{item.kind === 'NOT_RELEVANT' ? 'Private fit feedback' : 'Shared listing report'}</span></div>
        <h3>{item.title}</h3><Link className="text-link" href={opportunityHref(item.opportunityId,item.occurrenceId)}>Review this date →</Link><p>{labels[item.kind]}</p>
        <p><strong>{item.kind === 'NOT_RELEVANT' ? 'Saved privately' : item.status === 'RESOLVED' ? 'Addressed by reviewer' : 'Awaiting reviewer'}</strong></p>
        <p className="fine-print"><time dateTime={item.createdAt}>{eventDate(item.createdAt)} · {eventTime(item.createdAt)} UTC</time>{item.kind !== 'NOT_RELEVANT' && ` · Report version ${item.version}`}</p>
        {item.kind === 'NOT_RELEVANT' ? <p className="fine-print">Only this persona can read this fit feedback. It does not change your matching requirements.</p> : <p className="fine-print">The reviewer sees the listing issue without your persona identity or preferences.</p>}
        {item.resolution && <div className="notice success"><strong>Reviewer resolution</strong><p>{item.resolution}</p>{item.resolvedAt && <p className="fine-print"><time dateTime={item.resolvedAt}>{eventDate(item.resolvedAt)} · {eventTime(item.resolvedAt)} UTC</time></p>}</div>}
      </article>)}</div> : <EmptyPanel title="No feedback recorded yet." text="Use the feedback control on an opportunity to save a private fit preference or flag incorrect details or availability." href="/opportunities" label="Explore opportunities" />)}
    </LoadState>
  </section>;
}

export function FeedbackHistory() { return <StudentGate><HistoryContent /></StudentGate>; }
