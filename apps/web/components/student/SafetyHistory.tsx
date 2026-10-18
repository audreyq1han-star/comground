'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { SAFETY_CATEGORY_LABELS, SAFETY_RATIONALE_LABELS, SAFETY_STATUS_LABELS, SAFETY_URGENCY_LABELS, type SafetyReport } from '../../../../packages/domain/safety-contracts.ts';
import { messageOf } from '../Api';
import { eventDate, eventTime, opportunityHref } from '../OpportunityCard';
import { useStudent } from './StudentSession';
import { LoadState, EmptyPanel } from './StudentCommon';
import { useStudentResource } from './useStudentResource';

export function SafetyHistory({ revision }: { revision: number }) {
  const state = useStudentResource<{data:SafetyReport[]}>('/api/student/safety/reports');
  const [notice, setNotice] = useState('');
  useEffect(() => { if (revision) state.reload(); }, [revision, state.reload]);
  return <section className="dashboard-section" aria-labelledby="safety-history-heading"><div className="results-heading"><h2 id="safety-history-heading">Your reports and status</h2><button className="plain-button" type="button" disabled={state.loading || state.refreshing} onClick={state.reload}>Refresh report status</button></div><p>These statuses record actions inside this app. They do not confirm that an incident occurred or that outside support was contacted.</p>{notice && <p className="notice success" role="status">{notice}</p>}
    <LoadState {...state} retry={state.reload}>{state.data && (state.data.data.length ? <div className="reminder-list">{state.data.data.map(report => <SafetyHistoryCard key={`${report.id}:${report.version}`} report={report} disabled={state.refreshing || !!state.refreshError} onDeleted={() => { setNotice('Report and review history deleted. The reporting limit remains until its window resets.'); state.reload(); }} onReload={state.reload}/>)}</div> : <EmptyPanel title="No private reports recorded." text="Use the form above for a fictional platform concern, or open a listing date to report a concern about that activity."/>)}</LoadState>
    <Link className="text-link" href="/account/privacy">Export your reports with your account data →</Link>
  </section>;
}
function SafetyHistoryCard({ report, disabled, onDeleted, onReload }: { report: SafetyReport; disabled: boolean; onDeleted: () => void; onReload: () => void }) {
  const { request, getSessionEpoch } = useStudent();
  const [confirm, setConfirm] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const busy = useRef(false);
  async function remove() {
    if (busy.current || !confirm || disabled) return;
    const epoch = getSessionEpoch(); busy.current = true; setPending(true); setError('');
    try { await request(`/api/student/safety/reports/${encodeURIComponent(report.id)}`, { method: 'DELETE', body: JSON.stringify({ expectedVersion: report.version }) }); if (epoch === getSessionEpoch()) onDeleted(); }
    catch (cause) { if (epoch === getSessionEpoch()) setError(messageOf(cause)); }
    finally { busy.current = false; if (epoch === getSessionEpoch()) setPending(false); }
  }
  return <article className="reminder-card" style={{overflowWrap:'anywhere'}}><span className="category-badge">{SAFETY_STATUS_LABELS[report.status]}</span><h3>{report.target.kind === 'PLATFORM' ? 'Platform safety concern' : report.target.title}</h3><p>{SAFETY_CATEGORY_LABELS[report.category]} · {SAFETY_URGENCY_LABELS[report.urgency]}</p>{report.target.kind === 'LISTING' && <p><time dateTime={report.target.startsAt}>{eventDate(report.target.startsAt)} · {eventTime(report.target.startsAt)} UTC</time> · <Link href={opportunityHref(report.target.opportunityId, report.target.occurrenceId)}>Reported listing date</Link></p>}
    {report.narrative && <p style={{whiteSpace:'pre-wrap'}}>{report.narrative}</p>}<p className="fine-print">Report version {report.version} · Recorded <time dateTime={report.createdAt}>{eventDate(report.createdAt)}</time></p>
    {report.rationale && <p><strong>Recorded reason:</strong> {SAFETY_RATIONALE_LABELS[report.rationale]}</p>}{report.quarantineRequested && <p className="fine-print">An operator requested a listing withdrawal review. A request does not itself change listing visibility.</p>}
    <details><summary>Review history</summary><ol>{report.events.map(event => <li key={event.version}>{SAFETY_STATUS_LABELS[event.status]}{event.rationale ? ` · ${SAFETY_RATIONALE_LABELS[event.rationale]}` : ''} · <time dateTime={event.at}>{eventDate(event.at)} {eventTime(event.at)} UTC</time></li>)}</ol></details>
    <label className="delete-consent"><input type="checkbox" checked={confirm} disabled={pending || disabled} onChange={event => setConfirm(event.target.checked)}/><span>Delete this report and its review history.</span></label><button className="button danger" type="button" disabled={!confirm || pending || disabled} onClick={() => void remove()}>{pending ? 'Deleting…' : 'Delete report'}</button>
    {error && <div className="notice error" role="alert"><p>{error}</p><button type="button" className="plain-button" onClick={onReload} disabled={pending}>Reload report status</button></div>}
  </article>;
}
