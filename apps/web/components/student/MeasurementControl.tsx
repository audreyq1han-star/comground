'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Attribution, MeasurementConsent } from '../../../../packages/domain/measurement-contracts.ts';
import { ApiError, messageOf } from '../Api';
import { useCampaign } from './CampaignContext';
import { LoadState } from './StudentCommon';
import { useStudent } from './StudentSession';
import { useStudentResource } from './useStudentResource';
import { useRuntime } from '../account/RuntimeContext';

function ConsentForm({ value, refreshing, onReload, onSaved }: { value: MeasurementConsent; refreshing: boolean; onReload:()=>void; onSaved: (value: MeasurementConsent) => void }) {
  const { request, getSessionEpoch } = useStudent();
  const {runtime}=useRuntime();const account=!!runtime?.capabilities.accounts;
  const { campaign, withCampaign } = useCampaign();
  const attribution = useStudentResource<{data:Attribution|null}>('/api/student/attribution');
  const [enabled, setEnabled] = useState(value.enabled);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [conflict, setConflict] = useState(false);
  const [baseline, setBaseline] = useState(value);
  const active = useRef(true), generation = useRef(0), saving = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; ++generation.current; saving.current = false; }; }, []);
  useEffect(() => { if (!dirty) { setEnabled(value.enabled); setBaseline(value); setConflict(false); } }, [value, dirty]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active.current || saving.current) return;
    const current = ++generation.current, epoch = getSessionEpoch();
    const isCurrent = () => active.current && current === generation.current && epoch === getSessionEpoch();
    saving.current = true; setPending(true); setError(''); setStatus('');
    try {
      const result = await request<{data:MeasurementConsent}>('/api/student/measurement', { method:'PUT', body:JSON.stringify({ expectedVersion:baseline.version, expectedProfileVersion:baseline.profileVersion, enabled }) });
      if (!isCurrent()) return;
      setDirty(false); setBaseline(result.data); setEnabled(result.data.enabled); onSaved(result.data);
      setStatus(result.data.enabled ? 'Optional measurement is on. Use Refresh matches to present a new measured shortlist.' : 'Optional measurement is off. New measurement has stopped and prior measurement records have been deleted.');
      if (result.data.enabled && campaign) {
        if (!isCurrent()) return;
        try { await request('/api/student/attribution', {method:'POST',body:JSON.stringify({campaignId:campaign.id})}); }
        catch (cause) { if (isCurrent()) setError(`Your measurement choice was saved. This campaign could not be assigned: ${messageOf(cause)}`); }
      }
      if (!isCurrent()) return;
      attribution.reload();
    } catch (cause) { if (isCurrent()) { setError(messageOf(cause)); setConflict(cause instanceof ApiError && cause.status === 409); } }
    finally { if (isCurrent()) { saving.current = false; setPending(false); } }
  }
  return <section className="settings-panel" aria-label={account?'Optional measurement':'Optional local measurement'}>
    <p className="eyebrow">OPTIONAL / OFF BY DEFAULT</p><h2>{account?'Choose measurement separately.':'Choose local measurement separately.'}</h2>
    <p>{account?'Allow your displayed shortlists, structured relevance choices and linked actions to contribute to aggregate product learning.':'Allow this synthetic persona’s displayed shortlists, structured relevance choices and linked actions to contribute to local learning.'} Storage consent and reminders do not enable this choice.</p>
    <p className="fine-print">No outside analytics or anonymous tracking. Records use listing/date references and a profile version, not copied preferences. Only aggregate results can reach the operator; small cohorts are suppressed. Saves and previews are not applications, and attendance stays self-reported.</p>
    <form onSubmit={save}><div className="check-list"><label><input type="checkbox" checked={enabled} disabled={pending} onChange={event=>{setEnabled(event.target.checked);setDirty(true);setStatus('');}}/><span>{account?'Enable optional measurement':'Enable optional local measurement'}</span></label></div>
      <button className="button secondary" type="submit" disabled={pending||refreshing||conflict||baseline.profileVersion===null}>{pending?'Saving measurement choice…':'Save measurement choice'}</button>
      {(dirty||conflict)&&<button className="plain-button" type="button" disabled={pending||refreshing} onClick={()=>{setDirty(false);setEnabled(value.enabled);setBaseline(value);setConflict(false);setError('');onReload();}}>Reload latest saved choice</button>}
    </form>
    {error&&<p className="notice error" role="alert">{error}</p>}{status&&<p className="action-status" role="status">{status}</p>}
    <p className="fine-print">Current saved choice: {value.enabled?'on':'off'}. Export includes consent, attribution, presented shortlist references, relevance and linked action records. Turn this off to delete measurement records, or {account?'withdraw profile storage consent':'delete the persona'} to remove all private student data.</p>
    <p className="fine-print">{campaign?`This visit carries the allowlisted synthetic link “${campaign.name}”.`:'This visit has no selected synthetic campaign.'} First eligible campaign attribution is recorded only after measurement consent; a later link does not replace it.</p>
    <LoadState {...attribution} retry={attribution.reload}>{attribution.data&&<p className="fine-print">Stored attribution: {attribution.data.data?.campaignId??'Direct / unattributed'}.</p>}</LoadState>
    <Link className="text-link" href={withCampaign('/matches')}>Open matches →</Link>
  </section>;
}
export function MeasurementControl({ onSaved }: { onSaved?: (value:MeasurementConsent)=>void }) {
  const state = useStudentResource<{data:MeasurementConsent}>('/api/student/measurement');
  return <LoadState {...state} retry={state.reload}>{state.data&&<ConsentForm value={state.data.data} refreshing={state.refreshing} onReload={state.reload} onSaved={value=>{state.setData({data:value});state.reload();onSaved?.(value);}}/>}</LoadState>;
}
