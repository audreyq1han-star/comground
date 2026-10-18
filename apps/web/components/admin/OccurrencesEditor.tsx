'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { AdminCatalogueRecord } from '../../../../packages/domain/app-contracts.ts';
import { api } from '../Api';
import { MutationNotice, useAdminMutation } from './AdminShared';
import { MAX_OCCURRENCES, occurrenceDraft, readOccurrence, readOccurrenceDrafts, repeatOccurrence, sameOccurrences, storedOccurrences, type OccurrenceDraft } from './occurrences-form';

export function OccurrencesEditor({ item, reload, loading }: { item: AdminCatalogueRecord; reload: () => Promise<void>; loading: boolean }) {
  const [dates, setDates] = useState(() => storedOccurrences(item.record).map(occurrenceDraft));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [draftNotice, setDraftNotice] = useState('');
  const [baseId, setBaseId] = useState('primary');
  const [interval, setInterval] = useState('7');
  const [count, setCount] = useState('1');
  const mutation = useAdminMutation();
  const disabled = loading || mutation.pending;
  const existing = storedOccurrences(item.record);
  const existingIds = new Set(existing.map(date => date.id));

  useEffect(() => {
    setDates(storedOccurrences(item.record).map(occurrenceDraft)); setReason(''); setError(''); setDraftNotice(''); setBaseId('primary');
  }, [item.id, item.version]);

  function change<K extends keyof OpportunityOccurrenceFields>(id: string, field: K, value: OpportunityOccurrenceFields[K]) {
    setDates(current => current.map(date => date.id === id ? { ...date, [field]: value } : date));
    setError(''); setDraftNotice('');
  }
  function generate(additionalCount: number, intervalDays: number) {
    setError('');
    try {
      const base = readOccurrence(dates.find(date => date.id === baseId) ?? dates[0]);
      const additions = repeatOccurrence(base, intervalDays, additionalCount, dates.map(date => date.id), () => crypto.randomUUID());
      setDates(current => [...current, ...additions.map(occurrenceDraft)]);
      setCount('1');
      setDraftNotice(`${additions.length} additional ${additions.length === 1 ? 'date is' : 'dates are'} in this unsaved draft. Inspect the explicit dates, then save for review.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The dates could not be generated.'); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setDraftNotice('');
    let occurrences;
    try {
      occurrences = readOccurrenceDrafts(dates, existing);
      if (sameOccurrences(occurrences, existing)) throw new Error('No dates have changed. Edit, add or cancel a date before saving.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Check the dated occurrences.'); return; }
    await mutation.run(async () => {
      await api(`/api/admin/opportunities/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ expectedVersion: item.version, reason: reason.trim(), changes: { occurrences } }) });
      await reload();
    }, 'Dated occurrences saved. The opportunity requires a new publication review.');
  }

  return <details className="op-panel op-editor" data-testid="occurrence-editor">
    <summary>Edit dated occurrences</summary>
    <p>Keep up to 12 explicit dates under this opportunity. Saved IDs cannot be changed or removed: cancel individual dates to preserve their saves and activity history. Any saved change returns the whole opportunity to review.</p>
    <p className="op-help">All time inputs are UTC. A display timezone names how a date is presented; changing it does not shift the stored instant. Per-date cancellation is separate from cancelling every date in Edit opportunity facts.</p>
    {item.record.isCancelled && <p className="notice warning">Every date is currently cancelled by the opportunity-wide control. Restore that control before any date can be published.</p>}
    <MutationNotice state={mutation} reload={() => void reload()}/>
    {error && <p className="notice error" role="alert">{error}</p>}
    {draftNotice && <p className="op-notice" role="status">{draftNotice}</p>}
    <fieldset disabled={disabled}>
        <section className="op-details" aria-labelledby="repeat-dates-title">
          <h3 id="repeat-dates-title">Add explicit dates</h3>
          <p>Repeats use a fixed interval of 24-hour UTC days. They do not follow daylight-saving changes in a local wall-clock schedule. New dates inherit the selected date’s validity deadline; generating dates does not fetch or reconfirm source facts.</p>
          <div className="field"><label htmlFor="repeat-base">Copy from date</label><select id="repeat-base" value={baseId} onChange={event => setBaseId(event.target.value)}>{dates.map(date => <option key={date.id} value={date.id}>{date.id}</option>)}</select></div>
          <div className="op-form-grid"><div className="field"><label htmlFor="repeat-interval">UTC interval in days</label><input id="repeat-interval" type="number" min="1" max="365" step="1" value={interval} onChange={event => setInterval(event.target.value)}/></div><div className="field"><label htmlFor="repeat-count">Additional dates</label><input id="repeat-count" type="number" min="1" max={Math.max(1, MAX_OCCURRENCES - dates.length)} step="1" value={count} onChange={event => setCount(event.target.value)}/></div></div>
          <div className="op-actions"><button className="button secondary" type="button" disabled={dates.length >= MAX_OCCURRENCES} onClick={() => generate(Number(count), Number(interval))}>Generate explicit repeat dates</button><button className="button secondary" type="button" disabled={dates.length >= MAX_OCCURRENCES} onClick={() => generate(1, 1)}>Add one date for editing</button></div>
          {dates.length >= MAX_OCCURRENCES && <p className="op-help">The 12-date limit includes cancelled dates so their identities remain available in history.</p>}
        </section>
    </fieldset>
    <form onSubmit={save}>
      <fieldset disabled={disabled}>
        <legend className="visually-hidden">Dated occurrences</legend>
        <p className="op-result-count">{dates.length} of {MAX_OCCURRENCES} dates in this draft</p>
        {dates.map((date, index) => <details className="op-details" key={date.id} data-occurrence-id={date.id} open={index === 0 || !existingIds.has(date.id)}>
          <summary>Date {date.id} · {date.startsAt.slice(0, 16).replace('T', ' ')} UTC{date.isCancelled ? ' · Cancelled' : ''}{!existingIds.has(date.id) ? ' · Not saved' : ''}</summary>
          <fieldset>
            <legend className="visually-hidden">Date {date.id}</legend>
            <p className="op-meta">Stable ID: <code>{date.id}</code>{date.id === 'primary' ? ' · Original date identity' : ''}</p>
            {(['startsAt', 'endsAt', 'validUntil'] as const).map(field => <div className="field" key={field}>
              <label htmlFor={`occurrence-${date.id}-${field}`}>{field === 'startsAt' ? 'Starts at' : field === 'endsAt' ? 'Ends at' : 'Valid until'} (UTC) · {date.id}</label>
              <input id={`occurrence-${date.id}-${field}`} type="datetime-local" step="0.001" required value={date[field]} onChange={event => change(date.id, field, event.target.value)}/>
            </div>)}
            <div className="field"><label htmlFor={`occurrence-${date.id}-timezone`}>Display timezone · {date.id}</label><input id={`occurrence-${date.id}-timezone`} value={date.timezone} onChange={event => change(date.id, 'timezone', event.target.value)} required maxLength={80}/></div>
            <label className="op-checkbox"><input type="checkbox" checked={date.isCancelled} onChange={event => change(date.id, 'isCancelled', event.target.checked)} aria-label={`Cancel date ${date.id}`}/><span>Cancel this date only</span></label>
            {!existingIds.has(date.id) && <button className="button secondary" type="button" onClick={() => { setDates(current => current.filter(value => value.id !== date.id)); setBaseId(current => current === date.id ? 'primary' : current); setDraftNotice('Unsaved date discarded. Saved date identities are unchanged.'); }}>Discard unsaved date {date.id}</button>}
          </fieldset>
        </details>)}

        <div className="field"><label htmlFor="occurrence-edit-reason">Reason for date changes</label><textarea id="occurrence-edit-reason" rows={3} value={reason} onChange={event => setReason(event.target.value)} required minLength={3} maxLength={1000}/></div>
        <button className="button primary" type="submit" disabled={disabled || reason.trim().length < 3}>{mutation.pending ? 'Saving dates…' : 'Save dated occurrences for review'}</button>
      </fieldset>
    </form>
  </details>;
}

type OpportunityOccurrenceFields = Pick<OccurrenceDraft, 'startsAt' | 'endsAt' | 'validUntil' | 'timezone' | 'isCancelled'>;
