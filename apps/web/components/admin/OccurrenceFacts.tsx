'use client';
import type { AdminCatalogueRecord } from '../../../../packages/domain/app-contracts.ts';
import { StatusPill } from './AdminShared';
import { storedOccurrences } from './occurrences-form';

export function OccurrenceFacts({ item }: { item: AdminCatalogueRecord }) {
  const dates = storedOccurrences(item.record);
  const now = Date.now();
  return <section className="op-panel" data-testid="occurrence-facts">
    <h2>Dated occurrences</h2>
    <p className="op-quiet">{dates.length} explicit {dates.length === 1 ? 'date' : 'dates'}. Times below use each date’s display timezone. Source state, publication review and opportunity-wide cancellation also govern availability.</p>
    {dates.map(date => {
      const label = date.isCancelled ? 'CANCELLED' : Date.parse(date.startsAt) <= now ? 'STARTED' : Date.parse(date.validUntil) <= now ? 'EXPIRED' : 'UPCOMING';
      const display = (instant: string) => new Date(instant).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: date.timezone });
      return <section className="op-details" key={date.id}>
        <div className="op-inline"><h3>Date {date.id}</h3><StatusPill value={label}/></div>
        <dl className="op-facts"><div><dt>Starts</dt><dd><time dateTime={date.startsAt}>{display(date.startsAt)}</time></dd></div><div><dt>Ends</dt><dd><time dateTime={date.endsAt}>{display(date.endsAt)}</time></dd></div><div><dt>Display timezone</dt><dd>{date.timezone}</dd></div><div><dt>Validity deadline</dt><dd><time dateTime={date.validUntil}>{display(date.validUntil)}</time></dd></div></dl>
      </section>;
    })}
  </section>;
}
