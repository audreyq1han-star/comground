import type { FixtureRecord, OpportunityOccurrence } from '../../../../packages/domain/contracts.ts';

export const MAX_OCCURRENCES = 12;
const OCCURRENCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/;
export type OccurrenceDraft = OpportunityOccurrence & { original: OpportunityOccurrence };
const utcValue = (value: string) => new Date(value).toISOString().slice(0, -1);

export function storedOccurrences(record: FixtureRecord): OpportunityOccurrence[] {
  return record.occurrences ?? [{ id: 'primary', startsAt: record.startsAt, endsAt: record.endsAt, timezone: record.timezone, validUntil: record.validUntil, isCancelled: record.isCancelled }];
}

export function occurrenceDraft(value: OpportunityOccurrence): OccurrenceDraft {
  return { ...value, startsAt: utcValue(value.startsAt), endsAt: utcValue(value.endsAt), validUntil: utcValue(value.validUntil), original: { ...value } };
}

function readUtc(value: string, original: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) throw new Error(`${label}: enter a complete UTC date and time.`);
  const date = new Date(`${value}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error(`${label}: enter a real UTC date and time.`);
  // Preserve the exact original instant representation when a field was not edited.
  return date.getTime() === Date.parse(original) ? original : date.toISOString();
}

export function readOccurrence(draft: OccurrenceDraft): OpportunityOccurrence {
  if (!OCCURRENCE_ID.test(draft.id)) throw new Error('Every date needs a valid stable ID.');
  const startsAt = readUtc(draft.startsAt, draft.original.startsAt, `Date ${draft.id} start`);
  const endsAt = readUtc(draft.endsAt, draft.original.endsAt, `Date ${draft.id} end`);
  const validUntil = readUtc(draft.validUntil, draft.original.validUntil, `Date ${draft.id} validity`);
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error(`Date ${draft.id}: the end must be after the start.`);
  try { new Intl.DateTimeFormat('en', { timeZone: draft.timezone }); } catch { throw new Error(`Date ${draft.id}: use a recognized display timezone, such as UTC.`); }
  return { id: draft.id, startsAt, endsAt, validUntil, timezone: draft.timezone, isCancelled: draft.isCancelled };
}

export function readOccurrenceDrafts(drafts: OccurrenceDraft[], existing: OpportunityOccurrence[]): OpportunityOccurrence[] {
  if (drafts.length < 1 || drafts.length > MAX_OCCURRENCES) throw new Error('Keep between 1 and 12 explicit dated occurrences.');
  const occurrences = drafts.map(readOccurrence);
  const ids = new Set(occurrences.map(item => item.id));
  if (ids.size !== occurrences.length) throw new Error('Every date must have a unique ID.');
  if (!ids.has('primary') || existing.some(item => !ids.has(item.id))) throw new Error('Keep every saved date ID. Cancel a date instead of removing it.');
  return occurrences;
}

export function sameOccurrences(left: OpportunityOccurrence[], right: OpportunityOccurrence[]): boolean {
  const fields = ['id', 'startsAt', 'endsAt', 'timezone', 'validUntil', 'isCancelled'] as const;
  return left.length === right.length && left.every((item, index) => fields.every(field => item[field] === right[index][field]));
}

export function repeatOccurrence(base: OpportunityOccurrence, intervalDays: number, additionalCount: number, existingIds: string[], createId: () => string): OpportunityOccurrence[] {
  if (!Number.isSafeInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) throw new Error('Choose a whole UTC interval of 1–365 days.');
  if (!Number.isSafeInteger(additionalCount) || additionalCount < 1 || existingIds.length + additionalCount > MAX_OCCURRENCES) throw new Error('Generate at least one additional date, up to 12 dates in total.');
  const ids = new Set(existingIds);
  return Array.from({ length: additionalCount }, (_, index) => {
    const id = createId();
    if (!OCCURRENCE_ID.test(id)) throw new Error('A generated date ID is invalid. Try generating again.');
    if (ids.has(id)) throw new Error('A generated date ID collided. Try generating again.');
    ids.add(id);
    const shift = (index + 1) * intervalDays * 86_400_000;
    return { ...base, id, startsAt: new Date(Date.parse(base.startsAt) + shift).toISOString(), endsAt: new Date(Date.parse(base.endsAt) + shift).toISOString(), isCancelled: false };
  });
}
