'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import type { OperatorReport } from '../../../../packages/domain/app-contracts.ts';
import { api } from '../Api';
import { AdminPageHeading, MutationNotice, ReasonAction, ResourceState, StatusPill, Timestamp, useAdminMutation, useAdminResource } from './AdminShared';

export function ReportsPage() {
  const state = useAdminResource<OperatorReport[]>('/api/admin/reports');
  const filterId = useId();
  const [filter, setFilter] = useState('OPEN');
  const [notice, setNotice] = useState('');
  const rows = (state.data ?? []).filter(item => filter === 'ALL' || item.status === filter);
  return <>
    <AdminPageHeading eyebrow="REVIEW / LISTING REPORTS" title="Inspect the issue. Record the response." description="Factual listing reports from synthetic demo use. Persona identities, private preferences and private fit feedback are not included." action={<button className="button secondary" type="button" disabled={state.loading} onClick={() => void state.reload()}>Refresh reports</button>} />
    {notice && <p className="notice success" role="status">{notice}</p>}
    <div className="op-toolbar"><div className="field"><label htmlFor={filterId}>Report status</label><select id={filterId} value={filter} onChange={event => setFilter(event.target.value)}><option value="OPEN">Awaiting review</option><option value="RESOLVED">Addressed</option><option value="ALL">All reports</option></select></div></div>
    <ResourceState {...state} empty={!state.data} retry={() => void state.reload()} />
    {state.data && <div className="op-stack">{rows.length ? rows.map(item => <ReportCard key={item.id} item={item} loading={state.loading || !!state.error} reload={state.reload} onResolved={() => setNotice('Listing report addressed. Its resolution is available in the reporting persona’s feedback history.')} />) : <div className="op-empty"><h2>No reports in this view.</h2><p>Choose another status or refresh after recording a listing issue from an opportunity.</p></div>}</div>}
  </>;
}

function ReportCard({ item, loading, reload, onResolved }: { item: OperatorReport; loading: boolean; reload: () => Promise<void>; onResolved: () => void }) {
  const mutation = useAdminMutation();
  async function resolve(reason: string) {
    return mutation.run(async () => {
      await api(`/api/admin/reports/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ expectedVersion: item.version, reason }) });
      onResolved();
      await reload();
    }, 'Listing report addressed. The resolution is available in the reporting persona’s own feedback history.');
  }
  return <article className="op-panel">
    <div className="op-section-heading"><div><p className="eyebrow">{item.kind === 'WRONG_DETAILS' ? 'LISTING DETAILS' : 'AVAILABILITY'} / VERSION {item.version}</p><h2>{item.title}</h2></div><StatusPill value={item.status} /></div>
    <p>{item.kind === 'WRONG_DETAILS' ? 'The reporting persona flagged potentially incorrect listing details.' : 'The reporting persona flagged the opportunity as potentially unavailable.'}</p>
    <dl className="op-facts"><div><dt>Reported</dt><dd><Timestamp value={item.createdAt} /></dd></div><div><dt>Student data</dt><dd>No persona identity or private preferences included.</dd></div></dl>
    <Link prefetch={false} className="text-link" href={`/admin/opportunities/${encodeURIComponent(item.opportunityId)}`}>Inspect the underlying listing →</Link>
    {item.resolution && <div className="op-decision-reason"><h3>Recorded resolution</h3><p>{item.resolution}</p><Timestamp value={item.resolvedAt} /></div>}
    <MutationNotice state={mutation} reload={() => void reload()} />
    {item.status === 'OPEN' && <ReasonAction id={`report-${item.id}`} label="Mark report addressed" description="Inspect and correct or withdraw the listing as needed. Addressing this report records your response only; it does not edit the listing or certify the reported facts. Your reason is visible in the reporting persona’s feedback history. Use synthetic details only." pending={mutation.pending || loading} disabled={mutation.conflict} onSubmit={resolve} />}
  </article>;
}
