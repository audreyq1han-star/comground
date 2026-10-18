import Link from 'next/link';
import type { PublicOpportunity } from '../../../packages/domain/contracts.ts';

export function eventDate(value: string, timeZone = 'UTC') {
  try { return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone }).format(new Date(value)); }
  catch { return value; }
}
export function eventTime(value: string, timeZone = 'UTC') {
  try { return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(value)); }
  catch { return value; }
}
export function ageText(min: number | null, max: number | null) { return min === null ? 'Age requirement unconfirmed' : max === null ? `Ages ${min}+` : `Ages ${min}–${max}`; }
export function feeText(fee: number | null) { return fee === null ? 'Fee unconfirmed' : fee === 0 ? 'No fee' : `Fee: ${fee} (demo units)`; }
export function requirementText(value: boolean | null, yes: string, no: string) { return value === null ? 'Not confirmed' : value ? yes : no; }
export function opportunityHref(id: string, occurrenceId?: string) { return `/opportunities/${encodeURIComponent(id)}?occurrence=${encodeURIComponent(occurrenceId ?? 'primary')}`; }
export function occurrenceLabel(startsAt: string, endsAt: string, timeZone = 'UTC') { return `${eventDate(startsAt, timeZone)} · ${eventTime(startsAt, timeZone)}–${eventTime(endsAt, timeZone)} · ${timeZone}`; }

export function OpportunityCard({ opportunity: o, reasons, position }: { opportunity: PublicOpportunity; reasons?: string[]; position?: number }) {
  return <article className="opportunity-card">
    <div className="card-top"><span className="category-badge">{o.category}</span><span className="synthetic-label">Synthetic example</span></div>
    <div className="card-title-row">{position && <span className="match-position">{position.toString().padStart(2, '0')}</span>}<h3><Link href={opportunityHref(o.id, o.occurrenceId)}>{o.title}</Link></h3></div>
    <p className="organization">{o.organization.name}<span className="verification-note">Synthetic — not verified</span></p>
    <p className="card-summary">{o.summary}</p>
    <dl className="card-facts">
      <div><dt>When</dt><dd>{eventDate(o.startsAt, o.timezone)} · {eventTime(o.startsAt, o.timezone)}–{eventTime(o.endsAt, o.timezone)}<span className="subtle-block">{o.timezone}</span></dd></div>
      <div><dt>Where</dt><dd>{o.mode === 'REMOTE' ? 'Remote' : o.area}</dd></div>
      <div><dt>Who</dt><dd>{ageText(o.minAge, o.maxAge)}</dd></div>
      <div><dt>Fee</dt><dd>{feeText(o.fee)}</dd></div>
    </dl>
    {!!o.occurrences && o.occurrences.length > 1 && <p className="fine-print">{o.occurrences.length} current dates. This card describes the selected date; review other dates in the details.</p>}
    <p className="requirement-note">{requirementText(o.requiresTraining, 'Training required', 'No prior training required')} · {requirementText(o.requiresGuardian, 'Guardian required', 'No guardian requirement')}</p>
    {reasons && <div className="match-reasons"><h4>Why it fits</h4><ul>{reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul><p>Based on rules and the synthetic source facts.</p></div>}
    <div className="card-bottom"><p><span className="source-dot" aria-hidden="true" />Source: {o.source.name}<span className="subtle-block">Example confirmation: {eventDate(o.confirmedAt, o.timezone)}</span></p><Link className="text-link" href={opportunityHref(o.id, o.occurrenceId)}>Read requirements <span aria-hidden="true">↗</span></Link></div>
  </article>;
}
