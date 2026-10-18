'use client';
import Link from 'next/link';
import { useId, useState, type FormEvent } from 'react';
import { SAFETY_CATEGORIES, SAFETY_CATEGORY_LABELS, SAFETY_RATIONALE_LABELS, SAFETY_STATUSES, SAFETY_STATUS_LABELS, SAFETY_URGENCIES, SAFETY_URGENCY_LABELS, type OperatorSafetyReport, type SafetyModerationInput, type SafetyReport } from '../../../../packages/domain/safety-contracts.ts';
import { api } from '../Api';
import { useRuntime } from '../account/RuntimeContext';
import { AdminPageHeading, MutationNotice, ResourceState, StatusPill, Timestamp, useAdminMutation, useAdminResource } from './AdminShared';

export function SafetyModeration() {
  const { runtime } = useRuntime();
  if (runtime?.capabilities.demoPersonas) return <section className="op-panel"><h1>Private safety review requires an operator account.</h1><p>Shared demo sessions cannot access private reports.</p></section>;
  return <SafetyQueue/>;
}
function SafetyQueue() {
  const state = useAdminResource<{reports:OperatorSafetyReport[];actorId:string}>('/api/admin/safety/reports');
  const id = useId(), [status, setStatus] = useState('OPEN'), [category, setCategory] = useState('ALL'), [notice, setNotice] = useState(''), [urgency, setUrgency] = useState('ALL');
  const rows = (state.data?.reports ?? []).filter(report => (status === 'ALL' || report.status === status) && (category === 'ALL' || report.category === category) && (urgency === 'ALL' || report.urgency === urgency));
  return <>
    <AdminPageHeading eyebrow="SAFETY / OPERATOR REVIEW" title="Review privately. Record a clear decision." description="Reports show the concern and exact published date without account identity, email, age, or preferences. Treat the text as an unverified report." action={<button className="button secondary" type="button" onClick={() => void state.reload()} disabled={state.loading}>Refresh safety queue</button>}/>
    <p className="notice warning">This local workflow does not provide an emergency or monitored safeguarding service. No external contact or response is promised. Use fictional reports only.</p>
    {notice && <p className="notice success" role="status">{notice}</p>}
    <div className="op-toolbar"><div className="field"><label htmlFor={`${id}-status`}>Report status</label><select id={`${id}-status`} value={status} onChange={event => setStatus(event.target.value)}>{SAFETY_STATUSES.map(value => <option key={value} value={value}>{SAFETY_STATUS_LABELS[value]}</option>)}<option value="ALL">All statuses</option></select></div><div className="field"><label htmlFor={`${id}-category`}>Concern category</label><select id={`${id}-category`} value={category} onChange={event => setCategory(event.target.value)}><option value="ALL">All categories</option>{SAFETY_CATEGORIES.map(value => <option key={value} value={value}>{SAFETY_CATEGORY_LABELS[value]}</option>)}</select></div></div>
    <div className="field"><label htmlFor={`${id}-urgency`}>Reported urgency</label><select id={`${id}-urgency`} value={urgency} onChange={event=>setUrgency(event.target.value)}><option value="ALL">All urgency levels</option>{SAFETY_URGENCIES.map(value=><option key={value} value={value}>{SAFETY_URGENCY_LABELS[value]}</option>)}</select></div>
    <ResourceState {...state} empty={!state.data} retry={() => void state.reload()}/>
    {state.data && <div className="op-stack">{rows.length ? rows.map(report => <SafetyReviewCard key={`${report.id}:${report.version}`} report={report} actorId={state.data!.actorId} disabled={state.loading || !!state.error} reload={state.reload} onSaved={() => setNotice('Decision recorded. The reporting account can read its updated status in the app. No outbound message was sent.')}/>) : <div className="op-empty"><h2>No safety reports in this view.</h2><p>Choose another filter or refresh after recording a fictional concern.</p></div>}</div>}
  </>;
}
type Choice = { label: string; status: SafetyModerationInput['status']; rationale: SafetyModerationInput['rationale']; requestQuarantine?: boolean };
function choices(report: SafetyReport): Choice[] {
  if (report.status === 'OPEN') return [{ label: 'Start review', status: 'IN_REVIEW', rationale: 'REVIEW_STARTED' }];
  if (report.status === 'RESOLVED' || report.status === 'DISMISSED') return [{ label: 'Reopen report', status: 'OPEN', rationale: 'REOPENED' }];
  return [
    { label: 'Keep in review', status: 'IN_REVIEW', rationale: 'REVIEW_CONTINUES' },
    { label: 'Complete local review', status: 'RESOLVED', rationale: 'REVIEW_COMPLETE' },
    { label: 'Close: duplicate', status: 'DISMISSED', rationale: 'DUPLICATE' },
    { label: 'Close: outside scope', status: 'DISMISSED', rationale: 'OUTSIDE_SCOPE' },
    { label: 'Close: insufficient information', status: 'DISMISSED', rationale: 'INSUFFICIENT_INFORMATION' },
    ...(report.target.kind === 'LISTING' && !report.quarantineRequested ? [{ label: 'Request listing withdrawal review', status: 'IN_REVIEW' as const, rationale: 'QUARANTINE_REVIEW' as const, requestQuarantine: true }] : []),
  ];
}
function SafetyReviewCard({ report, actorId, disabled, reload, onSaved }: { report: OperatorSafetyReport; actorId: string; disabled: boolean; reload: () => Promise<void>; onSaved: () => void }) {
  const mutation = useAdminMutation(), id = useId(), options = choices(report);
  const [choice, setChoice] = useState(0), [inspected, setInspected] = useState(false), [assignee, setAssignee] = useState(report.assignedOperatorId ?? '');
  const selected = options[choice], locked = disabled || mutation.pending || mutation.conflict;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked || (selected.requestQuarantine && !inspected)) return;
    await mutation.run(async () => {
      await api(`/api/admin/safety/reports/${encodeURIComponent(report.id)}`, { method: 'PATCH', body: JSON.stringify({ expectedVersion: report.version, status: selected.status, rationale: selected.rationale, requestQuarantine: selected.requestQuarantine === true }) });
      onSaved(); await reload();
    }, 'Report status updated.');
  }
  return <article className="op-panel" style={{overflowWrap:'anywhere'}}>
    <div className="op-section-heading"><div><p className="eyebrow">{SAFETY_CATEGORY_LABELS[report.category]} / VERSION {report.version}</p><h2>{report.target.kind === 'PLATFORM' ? 'Platform safety concern' : report.target.title}</h2></div><StatusPill value={report.status}/></div>
    <dl className="op-facts"><div><dt>Reported urgency</dt><dd>{SAFETY_URGENCY_LABELS[report.urgency]}</dd></div><div><dt>Assigned operator</dt><dd>{report.assignedOperatorId ?? 'Unassigned'}</dd></div><div><dt>Recorded</dt><dd><Timestamp value={report.createdAt}/></dd></div><div><dt>Student identity</dt><dd>Not included</dd></div>{report.target.kind === 'LISTING' && <><div><dt>Reported date</dt><dd><Timestamp value={report.target.startsAt}/></dd></div><div><dt>Published listing version</dt><dd>{report.target.listingVersion}</dd></div></>}</dl>
    {report.narrative ? <div className="op-decision-reason"><h3>Unverified report text</h3><p style={{whiteSpace:'pre-wrap'}}>{report.narrative}</p></div> : <p>No narrative was provided.</p>}
    {report.target.kind === 'LISTING' && <Link className="text-link" prefetch={false} href={`/admin/opportunities/${encodeURIComponent(report.target.opportunityId)}`}>Inspect listing and existing publication controls →</Link>}
    {report.quarantineRequested && <p className="notice warning">Listing withdrawal review requested. This report action does not hide or publish the listing. Inspect the current catalogue version and use its existing withdrawal control if appropriate; restoration still requires review.</p>}
    <details><summary>Versioned decision history</summary><ol className="audit-list">{report.events.map(event => <li key={event.version}><strong>Version {event.version} · {SAFETY_STATUS_LABELS[event.status]}</strong><p>{event.rationale ? SAFETY_RATIONALE_LABELS[event.rationale] : 'Report recorded'} · {event.actor === 'OPERATOR' ? `Operator ${event.actorId ?? 'unrecorded legacy action'}` : 'Reporter action'}</p>{event.assignedOperatorId && <p>Assigned: {event.assignedOperatorId}</p>}<Timestamp value={event.at}/></li>)}</ol></details>
    <form className="op-reason-form" onSubmit={async event=>{event.preventDefault();if(locked)return;await mutation.run(async()=>{await api(`/api/admin/safety/reports/${encodeURIComponent(report.id)}`,{method:'PATCH',body:JSON.stringify({expectedVersion:report.version,status:report.status,rationale:'ASSIGNMENT_UPDATED',assignedOperatorId:assignee.trim()||null})});onSaved();await reload();},'Assignment updated.');}}><div className="field"><label htmlFor={`${id}-assignee`}>Assigned operator account ID</label><input id={`${id}-assignee`} value={assignee} onChange={event=>setAssignee(event.target.value)} maxLength={160} disabled={locked}/><p className="fine-print">Use a current verified operator account ID. Starting a review assigns it to the operator recording the decision.</p></div><div className="button-row"><button className="button secondary" type="button" disabled={locked} onClick={()=>setAssignee(actorId)}>Use my operator ID</button><button className="button secondary" type="submit" disabled={locked||assignee.trim()===(report.assignedOperatorId??'')}>Save assignment</button></div></form>
    <form className="op-reason-form" onSubmit={submit}><div className="field"><label htmlFor={`${id}-decision`}>Next status and reason</label><select id={`${id}-decision`} value={choice} onChange={event => { setChoice(Number(event.target.value)); setInspected(false); }} disabled={locked}>{options.map((option, index) => <option key={option.rationale} value={index}>{option.label}</option>)}</select></div><p className="fine-print">The selected reason is visible to the reporting account. It records an app decision and does not verify the reported facts.</p>
      {selected.requestQuarantine && <label className="delete-consent"><input type="checkbox" checked={inspected} onChange={event => setInspected(event.target.checked)} disabled={locked} required/><span>I inspected the underlying listing and want a withdrawal review. This request alone will not change its visibility.</span></label>}
      <button className="button primary" type="submit" disabled={locked || (selected.requestQuarantine && !inspected)}>{mutation.pending ? 'Recording…' : 'Record decision'}</button>
    </form><MutationNotice state={mutation} reload={() => void reload()}/>
  </article>;
}
