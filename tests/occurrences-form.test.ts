import test from 'node:test';
import assert from 'node:assert/strict';
import type { OpportunityOccurrence } from '../packages/domain/contracts.ts';
import { fixtureList } from '../packages/domain/fixtures.ts';
import { occurrenceDraft, readOccurrence, readOccurrenceDrafts, repeatOccurrence, sameOccurrences, storedOccurrences } from '../apps/web/components/admin/occurrences-form.ts';

const primary: OpportunityOccurrence = {
  id: 'primary', startsAt: '2026-03-07T10:00:00.123-05:00', endsAt: '2026-03-07T11:30:00.123-05:00',
  timezone: 'America/New_York', validUntil: '2026-03-10T08:00:00-05:00', isCancelled: false,
};
const nextDate = (id: string): OpportunityOccurrence => ({ ...primary, id });

test('an unchanged UTC form preserves original offsets, precision and field values', () => {
  const draft = occurrenceDraft(primary);
  assert.equal(draft.startsAt, '2026-03-07T15:00:00.123');
  assert.equal(draft.endsAt, '2026-03-07T16:30:00.123');
  assert.equal(draft.validUntil, '2026-03-10T13:00:00.000');
  assert.deepEqual(readOccurrence(draft), primary);
  assert.equal(sameOccurrences([primary], [readOccurrence(draft)]), true);
});

test('saved date IDs cannot be removed or renamed; cancellation retains their identity', () => {
  const existing = [primary, nextDate('second-date')];
  assert.throws(() => readOccurrenceDrafts([occurrenceDraft(primary)], existing), /Cancel a date instead/);
  assert.throws(() => readOccurrenceDrafts(existing.map(value => occurrenceDraft(value.id === 'primary' ? value : { ...value, id: 'renamed' })), existing), /Keep every saved date ID/);
  const cancelled = existing.map(value => ({ ...occurrenceDraft(value), isCancelled: value.id === 'second-date' }));
  const result = readOccurrenceDrafts(cancelled, existing);
  assert.deepEqual(result.map(value => value.id), ['primary', 'second-date']);
  assert.equal(result[0].isCancelled, false);
  assert.equal(result[1].isCancelled, true);
  assert.equal(result[1].startsAt, existing[1].startsAt);
  assert.equal(result[1].validUntil, existing[1].validUntil);
});

test('all draft collections require primary, unique IDs and at most twelve dates including cancelled dates', () => {
  assert.throws(() => readOccurrenceDrafts([], []), /between 1 and 12/);
  assert.throws(() => readOccurrenceDrafts([occurrenceDraft(nextDate('other'))], []), /Keep every saved date ID/);
  assert.throws(() => readOccurrenceDrafts([occurrenceDraft(primary), occurrenceDraft(primary)], [primary]), /unique ID/);
  const twelve = [primary, ...Array.from({ length: 11 }, (_, index) => ({ ...nextDate(`date-${index}`), isCancelled: true }))];
  assert.equal(readOccurrenceDrafts(twelve.map(occurrenceDraft), twelve).length, 12);
  assert.throws(() => readOccurrenceDrafts([...twelve, nextDate('thirteenth')].map(occurrenceDraft), twelve), /between 1 and 12/);
});

test('IDs follow the shared public and API format, including the forty-character limit', () => {
  for (const id of ['bad.dot', '_leading', '-leading', 'has space', 'x'.repeat(41)]) {
    assert.throws(() => readOccurrence(occurrenceDraft(nextDate(id))), /valid stable ID/);
  }
  for (const id of ['a', 'A_9-valid', 'x'.repeat(40), '7cd248bc-9e54-47f6-99bb-e8eb884ee18a']) {
    assert.equal(readOccurrence(occurrenceDraft(nextDate(id))).id, id);
  }
});

test('UTC input rejects impossible dates, explicit offset syntax, invalid zones and end before start', () => {
  const draft = occurrenceDraft(primary);
  for (const startsAt of ['2026-02-30T15:00', '2026-03-07T24:00', '2026-03-07T15:60', '2026-03-07T15:00Z', '2026-03-07T10:00-05:00', '']) {
    assert.throws(() => readOccurrence({ ...draft, startsAt }), /UTC date and time/);
  }
  assert.throws(() => readOccurrence({ ...draft, timezone: 'Not/A-Timezone' }), /recognized display timezone/);
  assert.throws(() => readOccurrence({ ...draft, endsAt: draft.startsAt }), /end must be after/);
});

test('times near a DST gap are interpreted as UTC instants, never as local wall-clock input', () => {
  const result = readOccurrence({ ...occurrenceDraft(primary), startsAt: '2026-03-08T02:30:00', endsAt: '2026-03-08T03:30:00' });
  assert.equal(result.startsAt, '2026-03-08T02:30:00.000Z');
  assert.equal(result.endsAt, '2026-03-08T03:30:00.000Z');
  assert.equal(result.timezone, 'America/New_York');
  const zoneOnly = readOccurrence({ ...occurrenceDraft(primary), timezone: 'Europe/London' });
  assert.equal(zoneOnly.startsAt, primary.startsAt);
  assert.equal(zoneOnly.endsAt, primary.endsAt);
});

test('repeats use fixed UTC intervals across DST without extending source validity', () => {
  let sequence = 0;
  const dates = repeatOccurrence(primary, 7, 2, ['primary'], () => `repeat-${++sequence}`);
  assert.deepEqual(dates.map(value => value.id), ['repeat-1', 'repeat-2']);
  assert.equal(dates[0].startsAt, '2026-03-14T15:00:00.123Z');
  assert.equal(dates[1].startsAt, '2026-03-21T15:00:00.123Z');
  assert.equal(Date.parse(dates[0].endsAt) - Date.parse(dates[0].startsAt), Date.parse(primary.endsAt) - Date.parse(primary.startsAt));
  for (const value of dates) {
    assert.equal(value.validUntil, primary.validUntil);
    assert.equal(value.timezone, primary.timezone);
    assert.equal(value.isCancelled, false);
  }
  assert.ok(Date.parse(dates[0].validUntil) < Date.parse(dates[0].startsAt), 'generation does not silently make the repeated date fresh');
});

test('generation validates whole-day bounds, remaining capacity and generated identities', () => {
  for (const interval of [0, -1, 0.5, 366, NaN, Infinity]) assert.throws(() => repeatOccurrence(primary, interval, 1, ['primary'], () => 'next'), /whole UTC interval/);
  for (const count of [0, -1, 0.5, 12, NaN, Infinity]) assert.throws(() => repeatOccurrence(primary, 7, count, ['primary'], () => 'next'), /up to 12/);
  let sequence = 0;
  assert.equal(repeatOccurrence(primary, 365, 11, ['primary'], () => `date-${++sequence}`).length, 11);
  assert.throws(() => repeatOccurrence(primary, 7, 1, ['primary'], () => 'primary'), /collided/);
  assert.throws(() => repeatOccurrence(primary, 7, 2, ['primary'], () => 'same'), /collided/);
  assert.throws(() => repeatOccurrence(primary, 7, 1, ['primary'], () => 'invalid.id'), /invalid/);
});

test('past dates and expired primary validity remain editable beside a current secondary date', () => {
  const expired = { ...primary, validUntil: '2020-01-01T00:00:00Z' };
  const later = { ...nextDate('later'), startsAt: '2030-01-01T15:00:00Z', endsAt: '2030-01-01T16:00:00Z', validUntil: '2030-01-02T00:00:00Z' };
  const result = readOccurrenceDrafts([occurrenceDraft(expired), occurrenceDraft(later)], [expired, later]);
  assert.equal(result[0].validUntil, expired.validUntil);
  assert.equal(result[1].validUntil, later.validUntil);
});

test('legacy records receive only the original primary identity and retain all recorded freshness facts', () => {
  const record = fixtureList(new Date('2026-03-01T00:00:00Z'))[0].record;
  const legacy = { ...record, occurrences: undefined, isCancelled: true };
  assert.deepEqual(storedOccurrences(legacy), [{ id: 'primary', startsAt: legacy.startsAt, endsAt: legacy.endsAt, validUntil: legacy.validUntil, timezone: legacy.timezone, isCancelled: true }]);
  const explicit = [primary, nextDate('second')];
  assert.deepEqual(storedOccurrences({ ...legacy, occurrences: explicit }), explicit);
});
