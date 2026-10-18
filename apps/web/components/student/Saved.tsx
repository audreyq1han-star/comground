'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { StudentSaved } from '../../../../packages/domain/app-contracts.ts';
import { OpportunityCard, eventDate, occurrenceLabel } from '../OpportunityCard';
import { messageOf } from '../Api';
import { useStudent, StudentGate } from './StudentSession';
import { useStudentResource } from './useStudentResource';
import { PageHeading, LoadState, EmptyPanel } from './StudentCommon';
function SavedContent() {
  const resource = useStudentResource<{data:StudentSaved[]}>('/api/student/saves');
  const { request } = useStudent();
  const [pending,setPending] = useState(''); const [error,setError] = useState(''); const [status,setStatus] = useState('');
  async function remove(item: StudentSaved) {
    setPending(`${item.opportunityId}:${item.occurrenceId}`); setError('');
    try { await request(`/api/student/saves/${encodeURIComponent(item.opportunityId)}/${encodeURIComponent(item.occurrenceId)}`, {method:'DELETE'}); setStatus('Removed from your saved ideas.'); resource.reload(); }
    catch(e) { setError(messageOf(e)); } finally { setPending(''); }
  }
  return <>
    <PageHeading eyebrow="SAVED / YOUR NEXT POSSIBILITIES" title="Keep the good ideas close." description="A saved date is a bookmark, not a registration. Different dates stay separate, including when one becomes unavailable." action={<Link className="button secondary" href="/opportunities">Explore more</Link>}/>
    {error&&<p className="notice error" role="alert">{error}</p>}{status&&<p className="action-status" role="status">{status}</p>}
    <LoadState {...resource} retry={resource.reload}>
      {resource.data?.data.length ? <div className="opportunity-grid saved-grid">{resource.data.data.map(item => <section key={`${item.opportunityId}:${item.occurrenceId}`} className="saved-item" data-occurrence-id={item.occurrenceId}>
        {item.available && item.opportunity ? <OpportunityCard opportunity={item.opportunity}/> : <div className="unavailable-card"><span className="status-badge status-rejected">UNAVAILABLE</span><h2>{item.title}</h2><p>{item.startsAt && item.endsAt ? occurrenceLabel(item.startsAt,item.endsAt) : 'The original date is unavailable in this retained record.'}</p><p>This saved date is no longer available. It may have expired, been cancelled or withdrawn, or have a paused source. Other dates are separate choices.</p><Link className="text-link" href="/opportunities">Find another opportunity →</Link></div>}
        <div className="saved-meta"><span>Saved {eventDate(item.savedAt)}</span><button className="plain-button" onClick={()=>void remove(item)} disabled={!!pending}>{pending===`${item.opportunityId}:${item.occurrenceId}`?'Removing…':'Remove saved idea'}</button></div>
      </section>)}</div> : <EmptyPanel title="A little space for good possibilities." text="Choose a current date on an opportunity's detail page, then save it. You can come back before deciding what to do next." href="/opportunities" label="Explore opportunities"/>}
    </LoadState>
  </>;
}
export function Saved(){return <div className="page-shell student-page"><StudentGate><SavedContent/></StudentGate></div>;}
