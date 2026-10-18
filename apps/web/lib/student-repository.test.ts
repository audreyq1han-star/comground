import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { PublicOpportunity, Preferences } from '../../../packages/domain/contracts.ts';
import { fixtureList } from '../../../packages/domain/fixtures.ts';
import { createStudentRepository, type StudentSupplyReader } from './student-repository.ts';
import { createRepository } from './repository.ts';

const now = new Date('2026-10-17T09:00:00Z');
const preferences: Preferences = { ageMin: 16, ageMax: 17, availableFrom: '2026-10-17T00:00:00Z', availableUntil: '2026-11-15T00:00:00Z', mode: 'ANY', area: 'Central', interests: ['environment'], maxFee: 0, hasTraining: false, hasGuardian: false, requiresSchoolCredit: false };
const input = (expectedVersion = 0) => ({ expectedVersion, preferences, goal: 'EXPLORE', storageConsent: true });
function opportunity(id: string, historical = false): PublicOpportunity {
  const record = fixtureList(now).find(item => item.fixtureId === 'garden')!.record;
  return { id, version: 2, isSynthetic: true, title: historical ? 'Synthetic historical demo reading example' : record.title, summary: record.summary, category: record.category, interests: record.interests, organization: record.organization, source: { name: record.source.name, url: record.source.url }, minAge: record.minAge, maxAge: record.maxAge, startsAt: historical ? '2026-10-14T10:00:00Z' : record.startsAt, endsAt: historical ? '2026-10-14T12:00:00Z' : record.endsAt, timezone: record.timezone, mode: record.mode, area: record.area, fee: record.fee, requiresTraining: record.requiresTraining, requiresGuardian: record.requiresGuardian, schoolCreditApproved: false, signupUrl: record.signupUrl, fetchedAt: record.fetchedAt, confirmedAt: record.confirmedAt, validUntil: record.validUntil, evidence: record.evidence };
}
function setup(filename = ':memory:') {
  const current = opportunity('future'), past = opportunity('past', true);
  let unavailable = false;
  const supply: StudentSupplyReader = {
    getPublic: (id, clock = now) => id === current.id && !unavailable && Date.parse(current.validUntil) > clock.getTime() && Date.parse(current.startsAt) > clock.getTime() ? current : null,
    listPublic: ({ limit, offset }, clock = now) => { const data = supply.getPublic(current.id, clock) ? [current] : []; return { data: data.slice(offset, offset + limit), total: data.length }; },
    getHistoricalSnapshot: externalId => externalId === 'synthetic-past-reading-001' ? past : null,
    getPublicSnapshot: id => id === current.id ? current : id === past.id ? past : null,
  };
  const store = createStudentRepository(filename, supply);
  return { store, current, past, supply, unavailable: () => { unavailable = true; } };
}
test('explicit consent creates a minimal versioned profile, default-off alerts and one OPENED historical demo', () => {
  const { store } = setup();
  try {
    assert.equal(store.getProfile('demo-alex'), null);
    assert.throws(() => store.listSaves('demo-alex'), { code: 'CONSENT_REQUIRED' });
    const profile = store.saveProfile('demo-alex', input(), now);
    assert.equal(profile.version, 1); assert.equal(profile.consentVersion, 'local-demo-v1');
    assert.deepEqual(store.getAlerts('demo-alex'), { inApp: false, eventReminders: false, catalogueUpdates: false });
    assert.deepEqual(store.listReminders('demo-alex', now), []);
    assert.equal(store.listActivity('demo-alex', now).length, 1);
    assert.equal(store.listActivity('demo-alex', now)[0].status, 'OPENED');
    assert.equal(store.listActivity('demo-alex', now)[0].evidenceKind, 'DEMO_HANDOFF');
    const edited = store.saveProfile('demo-alex', { ...input(1), goal: 'REGULAR' }, now);
    assert.equal(edited.version, 2); assert.equal(edited.consentedAt, profile.consentedAt);
    assert.equal(store.listActivity('demo-alex', now).length, 1);
    assert.throws(() => store.saveProfile('demo-alex', input(1), now), { code: 'VERSION_CONFLICT' });
  } finally { store.close(); }
});
test('profile validation rejects missing consent, unsupported fields, malformed goals, preferences and versions', () => {
  const { store } = setup();
  try {
    for (const candidate of [
      { ...input(), storageConsent: false }, { ...input(), ownerId: 'demo-sam' }, { ...input(), email: 'private@example.invalid' }, { ...input(), goal: ['EXPLORE'] }, { ...input(), goal: 'UNSUPPORTED' }, { ...input(), expectedVersion: -1 }, { ...input(), expectedVersion: 0.5 }, { ...input(), preferences: { ...preferences, ageMin: 20, ageMax: 16 } }, { ...input(), preferences: { ...preferences, fullName: 'Forbidden' } },
    ]) assert.throws(() => store.saveProfile('demo-alex', candidate, now));
    assert.equal(store.getProfile('demo-alex'), null);
  } finally { store.close(); }
});
test('separate personas own saves, activity, alerts and profile versions without caller-controlled identity', () => {
  const { store } = setup();
  try {
    store.saveProfile('demo-alex', input(), now); store.saveProfile('demo-sam', input(), now);
    const saved = store.saveOpportunity('demo-alex', 'future', now);
    assert.equal(saved.available, true); assert.equal(store.listSaves('demo-sam', now).length, 0);
    const activity = store.handoff('demo-alex', 'future', now);
    assert.throws(() => store.updateActivity('demo-sam', activity.id, { expectedVersion: 1, status: 'APPLIED' }, now), { code: 'NOT_FOUND' });
    store.setAlerts('demo-alex', { inApp: true, eventReminders: true, catalogueUpdates: true });
    assert.equal(store.getAlerts('demo-sam').inApp, false);
    const exported = store.exportData('demo-sam', now);
    assert.equal(exported.profile?.personaId, 'demo-sam'); assert.equal(exported.saved.length, 0);
    assert.ok(exported.activity.every(item => item.id !== activity.id));
  } finally { store.close(); }
});
test('save/remove and destination preview are idempotent and never create an applied event', () => {
  const { store } = setup();
  try {
    store.saveProfile('demo-alex', input(), now);
    assert.deepEqual(store.saveOpportunity('demo-alex', 'future', now), store.saveOpportunity('demo-alex', 'future', now));
    assert.equal(store.listSaves('demo-alex', now).length, 1);
    const first = store.handoff('demo-alex', 'future', now), repeated = store.handoff('demo-alex', 'future', now);
    assert.deepEqual(first, repeated); assert.equal(first.status, 'OPENED'); assert.equal(first.events.length, 1);
    assert.equal(first.events[0].evidenceKind, 'DEMO_HANDOFF');
    store.removeSave('demo-alex', 'future'); store.removeSave('demo-alex', 'future');
    assert.equal(store.listSaves('demo-alex', now).length, 0);
    assert.throws(() => store.saveOpportunity('demo-alex', 'does-not-exist', now), { code: 'NOT_FOUND' });
    assert.throws(() => store.handoff('demo-alex', 'does-not-exist', now), { code: 'NOT_FOUND' });
  } finally { store.close(); }
});
test('activity status changes are versioned, self-reported, ordered and reject future attendance', () => {
  const { store } = setup();
  try {
    store.saveProfile('demo-alex', input(), now);
    const activity = store.handoff('demo-alex', 'future', now);
    for (const status of ['ATTENDED', 'NOT_ATTENDED']) assert.throws(() => store.updateActivity('demo-alex', activity.id, { expectedVersion: 1, status }, now), { code: 'OCCURRENCE_NOT_ENDED' });
    for (const status of ['OPENED', 'ORGANIZER_CONFIRMED', ['APPLIED']]) assert.throws(() => store.updateActivity('demo-alex', activity.id, { expectedVersion: 1, status }, now), { code: 'INVALID_INPUT' });
    const applied = store.updateActivity('demo-alex', activity.id, { expectedVersion: 1, status: 'APPLIED' }, now);
    assert.equal(applied.version, 2); assert.equal(applied.evidenceKind, 'SELF_REPORTED');
    assert.deepEqual(applied.events.map(event => event.status), ['OPENED', 'APPLIED']);
    assert.throws(() => store.updateActivity('demo-alex', activity.id, { expectedVersion: 1, status: 'WITHDRAWN' }, now), { code: 'VERSION_CONFLICT' });
    assert.equal(store.updateActivity('demo-alex', activity.id, { expectedVersion: 2, status: 'APPLIED' }, now).version, 2);
    const past = store.listActivity('demo-alex', now).find(item => item.opportunityId === 'past')!;
    const attended = store.updateActivity('demo-alex', past.id, { expectedVersion: 1, status: 'ATTENDED' }, now);
    assert.equal(attended.status, 'ATTENDED'); assert.equal(attended.evidenceKind, 'SELF_REPORTED');
    assert.equal(store.outcomes().organizerConfirmed, 0); assert.equal(store.outcomes().studentIdentitiesIncluded, false);
    assert.equal(store.outcomes().attended, 1);
  } finally { store.close(); }
});
test('reminders are opt-in, persist read/dismiss, suppress future actions on unavailable supply and stop immediately on opt-out', () => {
  const { store, unavailable } = setup();
  try {
    store.saveProfile('demo-alex', input(), now); store.saveOpportunity('demo-alex', 'future', now);
    assert.deepEqual(store.listReminders('demo-alex', now), []);
    for (const invalid of [{ inApp: true }, { inApp: 'true', eventReminders: true, catalogueUpdates: true }, { inApp: true, eventReminders: true, catalogueUpdates: true, email: true }]) assert.throws(() => store.setAlerts('demo-alex', invalid), { code: 'INVALID_INPUT' });
    store.setAlerts('demo-alex', { inApp: true, eventReminders: true, catalogueUpdates: true });
    assert.deepEqual(store.listReminders('demo-alex', now).map(item => item.kind).sort(), ['FOLLOW_UP', 'UPCOMING']);
    store.updateReminder('demo-alex', 'upcoming:future', 'READ', now); store.updateReminder('demo-alex', 'upcoming:future', 'READ', now);
    assert.equal(store.listReminders('demo-alex', now).find(item => item.kind === 'UPCOMING')?.read, true);
    store.updateReminder('demo-alex', 'follow-up:past', 'DISMISS', now); store.updateReminder('demo-alex', 'follow-up:past', 'DISMISS', now);
    assert.equal(store.listReminders('demo-alex', now).some(item => item.kind === 'FOLLOW_UP'), false);
    unavailable();
    assert.deepEqual(store.listReminders('demo-alex', now).map(item => item.kind), ['UNAVAILABLE']);
    const saved = store.listSaves('demo-alex', now)[0]; assert.equal(saved.available, false); assert.equal(saved.opportunity, null); assert.ok(saved.title);
    store.setAlerts('demo-alex', { inApp: false, eventReminders: true, catalogueUpdates: true });
    assert.deepEqual(store.listReminders('demo-alex', now), []);
  } finally { store.close(); }
});
test('read-time expiry removes current matches and upcoming reminders while preserving retained saved labels', () => {
  const { store, current } = setup();
  try {
    store.saveProfile('demo-alex', { ...input(), preferences: { ...preferences, area: current.area, interests: current.interests } }, now);
    store.saveOpportunity('demo-alex', 'future', now); store.setAlerts('demo-alex', { inApp: true, eventReminders: true, catalogueUpdates: true });
    assert.equal(store.matches('demo-alex', now).eligibleCount, 1);
    const expired = new Date(Date.parse(current.validUntil) + 1);
    assert.equal(store.matches('demo-alex', expired).eligibleCount, 0);
    assert.equal(store.listReminders('demo-alex', expired).some(item => item.kind === 'UPCOMING'), false);
    assert.equal(store.listReminders('demo-alex', expired).some(item => item.kind === 'UNAVAILABLE'), true);
  } finally { store.close(); }
});
test('hard eligibility precedes stored ranking and profile version tracks the matching input', () => {
  const { store, current } = setup();
  try {
    store.saveProfile('demo-alex', { ...input(), preferences: { ...preferences, area: current.area } }, now);
    assert.equal(store.matches('demo-alex', now).engine, 'DETERMINISTIC_RULES');
    assert.equal(store.matches('demo-alex', now).profileVersion, 1);
    store.saveProfile('demo-alex', { ...input(1), preferences: { ...preferences, ageMin: 5, ageMax: 6, area: current.area } }, now);
    assert.equal(store.matches('demo-alex', now).eligibleCount, 0);
    assert.equal(store.matches('demo-alex', now).profileVersion, 2);
    assert.equal(store.dashboard('demo-alex', now).profile.version, 2);
  } finally { store.close(); }
});
test('profile deletion cascades all owned private data, preserves other personas and permits clean onboarding', () => {
  const folder = mkdtempSync(join(tmpdir(), 'comground-student-delete-')), file = join(folder, 'private.sqlite');
  const { store } = setup(file);
  try {
    for (const owner of ['demo-alex', 'demo-sam'] as const) {
      store.saveProfile(owner, input(), now); store.saveOpportunity(owner, 'future', now); store.handoff(owner, 'future', now);
      store.setAlerts(owner, { inApp: true, eventReminders: true, catalogueUpdates: true }); store.updateReminder(owner, 'upcoming:future', 'READ', now);
    }
    store.deleteProfile('demo-alex'); store.deleteProfile('demo-alex');
    assert.equal(store.getProfile('demo-alex'), null); assert.equal(store.getProfile('demo-sam')?.version, 2);
    assert.equal(store.exportData('demo-alex', now).activity.length, 0); assert.equal(store.listSaves('demo-sam', now).length, 1);
    const inspect = new DatabaseSync(file);
    for (const table of ['student_profiles', 'student_saves', 'student_activity', 'student_alerts', 'student_reminder_state', 'student_occurrence_saves', 'student_occurrence_activity', 'student_occurrence_feedback']) assert.equal((inspect.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE persona_id = ?`).get('demo-alex') as { count: number }).count, 0);
    assert.equal((inspect.prepare('SELECT COUNT(*) AS count FROM student_occurrence_activity_events WHERE activity_id NOT IN (SELECT id FROM student_occurrence_activity)').get() as { count: number }).count, 0);
    inspect.close();
    assert.equal(store.saveProfile('demo-alex', input(), now).version, 3);
    assert.deepEqual(store.getAlerts('demo-alex'), { inApp: false, eventReminders: false, catalogueUpdates: false });
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});
test('private preferences, state and activity history survive closing and reopening the database', () => {
  const folder = mkdtempSync(join(tmpdir(), 'comground-student-reopen-')), file = join(folder, 'private.sqlite');
  const first = setup(file);
  try {
    first.store.saveProfile('demo-alex', input(), now); first.store.saveOpportunity('demo-alex', 'future', now);
    const activity = first.store.handoff('demo-alex', 'future', now); first.store.updateActivity('demo-alex', activity.id, { expectedVersion: 1, status: 'APPLIED' }, now);
    first.store.setAlerts('demo-alex', { inApp: true, eventReminders: true, catalogueUpdates: false }); first.store.updateReminder('demo-alex', 'upcoming:future', 'READ', now);
    first.store.close();
    const second = setup(file);
    try {
      assert.equal(second.store.getProfile('demo-alex')?.version, 1); assert.equal(second.store.listSaves('demo-alex', now).length, 1);
      const restored = second.store.listActivity('demo-alex', now).find(item => item.id === activity.id)!;
      assert.equal(restored.status, 'APPLIED'); assert.equal(restored.events.length, 2);
      assert.equal(second.store.listReminders('demo-alex', now).find(item => item.kind === 'UPCOMING')?.read, true);
      assert.equal(second.store.getAlerts('demo-alex').inApp, true);
    } finally { second.store.close(); }
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
test('republished reschedules delay pending attendance and follow-up without rewriting completed reports', () => {
  const { store, past } = setup();
  try {
    store.saveProfile('demo-alex', input(), now); store.saveProfile('demo-sam', input(), now);
    store.setAlerts('demo-alex', { inApp: true, eventReminders: true, catalogueUpdates: false });
    const pending = store.listActivity('demo-alex', now)[0];
    const completed = store.listActivity('demo-sam', now)[0];
    store.updateActivity('demo-sam', completed.id, { expectedVersion: 1, status: 'ATTENDED' }, now);
    const originalEnd = past.endsAt;
    past.startsAt = '2026-10-25T10:00:00Z'; past.endsAt = '2026-10-25T12:00:00Z'; past.version++;
    assert.equal(store.listActivity('demo-alex', now)[0].endsAt, past.endsAt);
    assert.throws(() => store.updateActivity('demo-alex', pending.id, { expectedVersion: 1, status: 'ATTENDED' }, now), { code: 'OCCURRENCE_NOT_ENDED' });
    assert.equal(store.listReminders('demo-alex', now).some(item => item.kind === 'FOLLOW_UP'), false);
    assert.equal(store.listActivity('demo-sam', now)[0].endsAt, originalEnd);
    assert.equal(store.updateActivity('demo-sam', completed.id, { expectedVersion: 2, status: 'ATTENDED' }, now).version, 2);
    const ended = new Date('2026-10-25T13:00:00Z');
    assert.equal(store.updateActivity('demo-alex', pending.id, { expectedVersion: 1, status: 'ATTENDED' }, ended).endsAt, past.endsAt);
  } finally { store.close(); }
});

test('a stale tab cannot reuse a deleted profile version after consent is granted again', () => {
  const { store } = setup();
  try {
    const previous = store.saveProfile('demo-alex', input(), now);
    store.deleteProfile('demo-alex');
    const recreated = store.saveProfile('demo-alex', { ...input(), preferences: { ...preferences, interests: ['reading'] } }, now);
    assert.ok(recreated.version > previous.version);
    assert.throws(() => store.saveProfile('demo-alex', { ...input(previous.version), preferences: { ...preferences, interests: ['outdoors'] } }, now), { code: 'VERSION_CONFLICT' });
    assert.deepEqual(store.getProfile('demo-alex')?.preferences.interests, ['reading']);
  } finally { store.close(); }
});

test('repeated handoff respects current availability while retained historical activity stays readable', () => {
  const { store, unavailable, current } = setup();
  try {
    store.saveProfile('demo-alex', input(), now);
    const first = store.handoff('demo-alex', 'future', now);
    assert.deepEqual(store.handoff('demo-alex', 'future', now), first);
    const expired = new Date(Date.parse(current.validUntil) + 1);
    assert.throws(() => store.handoff('demo-alex', 'future', expired), { code: 'NOT_FOUND', status: 404 });
    unavailable();
    assert.throws(() => store.handoff('demo-alex', 'future', now), { code: 'NOT_FOUND', status: 404 });
    const retained = store.listActivity('demo-alex', now).find(item => item.id === first.id)!;
    assert.equal(retained.available, false); assert.equal(retained.version, 1);
    assert.equal(retained.status, 'OPENED'); assert.equal(retained.events.length, 1);
  } finally { store.close(); }
});

test('export includes stored reminder read/dismiss state after suppression, privately and after reopening', () => {
  const folder = mkdtempSync(join(tmpdir(), 'comground-student-export-')), file = join(folder, 'private.sqlite');
  let store = setup(file).store;
  try {
    for (const owner of ['demo-alex', 'demo-sam'] as const) {
      store.saveProfile(owner, input(), now); store.saveOpportunity(owner, 'future', now);
      store.setAlerts(owner, { inApp: true, eventReminders: true, catalogueUpdates: true });
    }
    store.updateReminder('demo-alex', 'upcoming:future', 'READ', now);
    store.updateReminder('demo-alex', 'follow-up:past', 'DISMISS', now);
    store.updateReminder('demo-sam', 'upcoming:future', 'DISMISS', now);
    const expected = [
      { id: 'follow-up:past', read: true, dismissed: true },
      { id: 'upcoming:future', read: true, dismissed: false },
    ];
    assert.deepEqual(store.exportData('demo-alex', now).reminderStates, expected);
    assert.deepEqual(store.exportData('demo-sam', now).reminderStates, [{ id: 'upcoming:future', read: true, dismissed: true }]);
    store.setAlerts('demo-alex', { inApp: false, eventReminders: false, catalogueUpdates: false });
    assert.equal(store.listReminders('demo-alex', now).length, 0);
    assert.deepEqual(store.exportData('demo-alex', now).reminderStates, expected);
    store.close(); store = setup(file).store;
    assert.deepEqual(store.exportData('demo-alex', now).reminderStates, expected);
    store.deleteProfile('demo-alex');
    assert.deepEqual(store.exportData('demo-alex', now).reminderStates, []);
    assert.deepEqual(store.exportData('demo-sam', now).reminderStates, [{ id: 'upcoming:future', read: true, dismissed: true }]);
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('unsaved opened and applied activity receives one current upcoming reminder, deduped against saves', () => {
  const { store } = setup();
  try {
    store.saveProfile('demo-alex', input(), now);
    store.setAlerts('demo-alex', { inApp: true, eventReminders: true, catalogueUpdates: true });
    const opened = store.handoff('demo-alex', 'future', now);
    assert.equal(store.listSaves('demo-alex', now).length, 0);
    let upcoming = store.listReminders('demo-alex', now).filter(item => item.kind === 'UPCOMING');
    assert.equal(upcoming.length, 1); assert.equal(upcoming[0].id, 'upcoming:future');
    assert.match(upcoming[0].message, /demo signup previews/);
    store.updateActivity('demo-alex', opened.id, { expectedVersion: opened.version, status: 'APPLIED' }, now);
    upcoming = store.listReminders('demo-alex', now).filter(item => item.kind === 'UPCOMING');
    assert.equal(upcoming.length, 1); assert.match(upcoming[0].message, /self-reported application/);
    store.updateReminder('demo-alex', upcoming[0].id, 'READ', now);
    store.saveOpportunity('demo-alex', 'future', now);
    upcoming = store.listReminders('demo-alex', now).filter(item => item.kind === 'UPCOMING');
    assert.equal(upcoming.length, 1); assert.equal(upcoming[0].read, true);
    store.updateReminder('demo-alex', upcoming[0].id, 'DISMISS', now);
    store.removeSave('demo-alex', 'future');
    assert.equal(store.listReminders('demo-alex', now).some(item => item.kind === 'UPCOMING'), false);
  } finally { store.close(); }
});

test('upcoming activity reminders respect opt-in, availability, reminder horizon and terminal outcomes', () => {
  const { store, unavailable, current } = setup();
  try {
    store.saveProfile('demo-alex', input(), now);
    const activity = store.handoff('demo-alex', 'future', now);
    store.setAlerts('demo-alex', { inApp: true, eventReminders: false, catalogueUpdates: true });
    assert.equal(store.listReminders('demo-alex', now).some(item => item.kind === 'UPCOMING'), false);
    store.setAlerts('demo-alex', { inApp: true, eventReminders: true, catalogueUpdates: true });
    const originalStart = current.startsAt, originalEnd = current.endsAt;
    current.startsAt = '2026-11-10T10:00:00Z'; current.endsAt = '2026-11-10T12:00:00Z';
    assert.equal(store.listReminders('demo-alex', now).some(item => item.kind === 'UPCOMING'), false);
    current.startsAt = originalStart; current.endsAt = originalEnd;
    assert.equal(store.listReminders('demo-alex', now).some(item => item.kind === 'UPCOMING'), true);
    const expired = new Date(Date.parse(current.validUntil) + 1);
    assert.equal(store.listReminders('demo-alex', expired).some(item => item.kind === 'UPCOMING'), false);
    store.saveOpportunity('demo-alex', 'future', now);
    const withdrawn = store.updateActivity('demo-alex', activity.id, { expectedVersion: activity.version, status: 'WITHDRAWN' }, now);
    assert.equal(store.listReminders('demo-alex', now).some(item => item.opportunityId === 'future'), false);
    store.updateActivity('demo-alex', activity.id, { expectedVersion: withdrawn.version, status: 'APPLIED' }, now);
    unavailable();
    const unavailableItems = store.listReminders('demo-alex', now).filter(item => item.opportunityId === 'future');
    assert.deepEqual(unavailableItems.map(item => item.kind), ['UNAVAILABLE']);
    store.removeSave('demo-alex', 'future');
    assert.equal(store.listReminders('demo-alex', now).some(item => item.opportunityId === 'future'), false);
  } finally { store.close(); }
});

test('not-attended and attended outcomes do not receive event reminders after republication', () => {
  for (const status of ['NOT_ATTENDED', 'ATTENDED'] as const) {
    const { store, current } = setup();
    try {
      store.saveProfile('demo-alex', input(), now);
      store.setAlerts('demo-alex', { inApp: true, eventReminders: true, catalogueUpdates: true });
      store.saveOpportunity('demo-alex', 'future', now);
      const opened = store.handoff('demo-alex', 'future', now);
      const ended = new Date(Date.parse(current.endsAt) + 1);
      store.updateActivity('demo-alex', opened.id, { expectedVersion: opened.version, status }, ended);
      const futureClock = new Date(ended.getTime() + 86400000);
      current.startsAt = new Date(futureClock.getTime() + 86400000).toISOString();
      current.endsAt = new Date(futureClock.getTime() + 90000000).toISOString();
      current.validUntil = new Date(futureClock.getTime() + 172800000).toISOString();
      assert.equal(store.listSaves('demo-alex', futureClock)[0].available, true);
      assert.equal(store.listReminders('demo-alex', futureClock).some(item => item.opportunityId === 'future'), false);
    } finally { store.close(); }
  }
});

test('match response preferences are the exact profile snapshot used for its version and ranking', () => {
  const { store, current, supply } = setup();
  try {
    const original = store.saveProfile('demo-alex', { ...input(), preferences: { ...preferences, area: current.area } }, now);
    const readPage = supply.listPublic;
    let changed = false;
    supply.listPublic = (query, clock) => {
      if (!changed) {
        changed = true;
        store.saveProfile('demo-alex', { ...input(original.version), preferences: { ...preferences, ageMin: 5, ageMax: 6, area: current.area } }, now);
      }
      return readPage(query, clock);
    };
    const response = store.matches('demo-alex', now);
    assert.equal(response.profileVersion, original.version);
    assert.deepEqual(response.preferences, original.preferences);
    assert.equal(response.eligibleCount, 1);
    assert.notEqual(store.getProfile('demo-alex')?.version, response.profileVersion);
    const updated = store.matches('demo-alex', now);
    assert.equal(updated.preferences.ageMin, 5); assert.equal(updated.eligibleCount, 0);
    response.preferences.interests.push('mutated-client-copy');
    assert.equal(store.getProfile('demo-alex')?.preferences.interests.includes('mutated-client-copy'), false);
  } finally { store.close(); }
});

test('structured feedback is owner-scoped, idempotent and never creates an application or activity', () => {
  const { store } = setup();
  try {
    assert.throws(() => store.listFeedback('demo-alex'), { code: 'CONSENT_REQUIRED' });
    assert.throws(() => store.submitFeedback('demo-alex', { opportunityId: 'future', kind: 'NOT_RELEVANT' }, now), { code: 'CONSENT_REQUIRED' });
    store.saveProfile('demo-alex', input(), now); store.saveProfile('demo-sam', input(), now);
    const activityBefore = store.listActivity('demo-alex', now);
    const privateFeedback = store.submitFeedback('demo-alex', { opportunityId: 'future', kind: 'NOT_RELEVANT' }, now);
    assert.equal(privateFeedback.status, 'OPEN'); assert.equal(privateFeedback.version, 1);
    assert.deepEqual(store.submitFeedback('demo-alex', { opportunityId: 'future', kind: 'NOT_RELEVANT' }, now), privateFeedback);
    assert.equal(store.listFeedback('demo-alex').length, 1); assert.equal(store.listFeedback('demo-sam').length, 0);
    const samFeedback = store.submitFeedback('demo-sam', { opportunityId: 'future', kind: 'NOT_RELEVANT' }, now);
    assert.notEqual(samFeedback.id, privateFeedback.id);
    assert.deepEqual(store.listActivity('demo-alex', now), activityBefore);
    assert.equal(store.outcomes().applied, 0); assert.deepEqual(store.listReports(), []);
  } finally { store.close(); }
});

test('feedback accepts current/formerly public listings and rejects draft-only IDs or caller identity/free text', () => {
  const { store, unavailable, current } = setup();
  try {
    store.saveProfile('demo-alex', input(), now);
    for (const invalid of [
      { opportunityId: 'future', kind: 'NOT_RELEVANT', ownerId: 'demo-sam' },
      { opportunityId: 'future', kind: 'WRONG_DETAILS', reason: 'private free text is unsupported' },
      { opportunityId: 'future', kind: ['UNAVAILABLE'] },
      { opportunityId: 'future', kind: 'APPLIED' },
      { opportunityId: '../private', kind: 'UNAVAILABLE' },
    ]) assert.throws(() => store.submitFeedback('demo-alex', invalid, now), { code: 'INVALID_INPUT' });
    assert.throws(() => store.submitFeedback('demo-alex', { opportunityId: 'draft-only-secret', kind: 'WRONG_DETAILS' }, now), { code: 'NOT_FOUND' });
    unavailable();
    const former = store.submitFeedback('demo-alex', { opportunityId: 'future', kind: 'UNAVAILABLE' }, now);
    assert.equal(former.title, current.title);
    const past = store.submitFeedback('demo-alex', { opportunityId: 'past', kind: 'WRONG_DETAILS' }, now);
    assert.equal(past.opportunityId, 'past');
    assert.equal(store.listFeedback('demo-alex').length, 2);
  } finally { store.close(); }
});

test('operator reports are a sanitized factual-only projection and private feedback IDs cannot be resolved', () => {
  const { store } = setup();
  try {
    store.saveProfile('demo-alex', input(), now); store.saveProfile('demo-sam', input(), now);
    const privateFeedback = store.submitFeedback('demo-alex', { opportunityId: 'future', kind: 'NOT_RELEVANT' }, now);
    const factual = store.submitFeedback('demo-alex', { opportunityId: 'future', kind: 'WRONG_DETAILS' }, now);
    const other = store.submitFeedback('demo-sam', { opportunityId: 'future', kind: 'UNAVAILABLE' }, now);
    const reports = store.listReports();
    assert.equal(reports.length, 2); assert.ok(reports.every(row => row.studentIdentitiesIncluded === false));
    assert.deepEqual(reports.map(row => row.id).sort(), [factual.id, other.id].sort());
    const allowed = ['id', 'opportunityId', 'occurrenceId', 'title', 'kind', 'status', 'version', 'createdAt', 'resolution', 'resolvedAt', 'studentIdentitiesIncluded'].sort();
    for (const row of reports) assert.deepEqual(Object.keys(row).sort(), allowed);
    const serialized = JSON.stringify(reports);
    for (const privateField of ['demo-alex', 'demo-sam', 'preferences', 'persona_id', 'NOT_RELEVANT']) assert.equal(serialized.includes(privateField), false);
    assert.throws(() => store.resolveReport(privateFeedback.id, { expectedVersion: 1, reason: 'Should not access private feedback' }, now), { code: 'NOT_FOUND' });
    assert.throws(() => store.resolveReport('unknown-report', { expectedVersion: 1, reason: 'Not found' }, now), { code: 'NOT_FOUND' });
  } finally { store.close(); }
});

test('factual report resolution is bounded, versioned and visible only to the owning student and operator', () => {
  const { store } = setup();
  try {
    store.saveProfile('demo-alex', input(), now); store.saveProfile('demo-sam', input(), now);
    const report = store.submitFeedback('demo-alex', { opportunityId: 'future', kind: 'WRONG_DETAILS' }, now);
    const other = store.submitFeedback('demo-sam', { opportunityId: 'future', kind: 'WRONG_DETAILS' }, now);
    for (const invalid of [
      { expectedVersion: 1, reason: '' }, { expectedVersion: 1, reason: '  ' },
      { expectedVersion: 1, reason: 'a'.repeat(1001) }, { expectedVersion: 0, reason: 'Checked' },
      { expectedVersion: 1, reason: 'Checked', ownerId: 'demo-alex' },
    ]) assert.throws(() => store.resolveReport(report.id, invalid, now), { code: 'INVALID_INPUT' });
    assert.throws(() => store.resolveReport(report.id, { expectedVersion: 2, reason: 'Checked' }, now), { code: 'VERSION_CONFLICT' });
    const resolved = store.resolveReport(report.id, { expectedVersion: 1, reason: '  Checked the synthetic listing evidence.  ' }, now);
    assert.equal(resolved.version, 2); assert.equal(resolved.status, 'RESOLVED');
    assert.equal(resolved.resolution, 'Checked the synthetic listing evidence.'); assert.equal(resolved.resolvedAt, now.toISOString());
    assert.throws(() => store.resolveReport(report.id, { expectedVersion: 1, reason: 'Checked again' }, now), { code: 'VERSION_CONFLICT' });
    assert.deepEqual(store.resolveReport(report.id, { expectedVersion: 2, reason: resolved.resolution }, now), resolved);
    assert.throws(() => store.resolveReport(report.id, { expectedVersion: 2, reason: 'Replace old reason' }, now), { code: 'STATE_CONFLICT' });
    assert.equal(store.listFeedback('demo-alex')[0].resolution, resolved.resolution);
    assert.equal(store.listFeedback('demo-sam')[0].id, other.id); assert.equal(store.listFeedback('demo-sam')[0].status, 'OPEN');
    const repeated = store.submitFeedback('demo-alex', { opportunityId: 'future', kind: 'WRONG_DETAILS' }, now);
    assert.equal(repeated.id, report.id); assert.equal(repeated.status, 'RESOLVED'); assert.equal(repeated.version, 2);
  } finally { store.close(); }
});

test('feedback exports and survives restart, then deletion removes only its owner reports and private feedback', () => {
  const folder = mkdtempSync(join(tmpdir(), 'comground-student-feedback-')), file = join(folder, 'private.sqlite');
  let store = setup(file).store;
  try {
    assert.deepEqual(store.exportData('demo-alex', now).feedback, []);
    store.saveProfile('demo-alex', input(), now); store.saveProfile('demo-sam', input(), now);
    const privateFeedback = store.submitFeedback('demo-alex', { opportunityId: 'future', kind: 'NOT_RELEVANT' }, now);
    const report = store.submitFeedback('demo-alex', { opportunityId: 'future', kind: 'UNAVAILABLE' }, now);
    const other = store.submitFeedback('demo-sam', { opportunityId: 'future', kind: 'UNAVAILABLE' }, now);
    store.resolveReport(report.id, { expectedVersion: 1, reason: 'Synthetic record rechecked.' }, now);
    const before = store.exportData('demo-alex', now);
    assert.deepEqual(before.feedback.map(row => row.id).sort(), [privateFeedback.id, report.id].sort());
    assert.ok(before.feedback.some(row => row.status === 'RESOLVED'));
    store.close(); store = setup(file).store;
    assert.deepEqual(store.exportData('demo-alex', now).feedback, before.feedback);
    store.deleteProfile('demo-alex');
    assert.deepEqual(store.exportData('demo-alex', now).feedback, []);
    assert.deepEqual(store.listReports().map(row => row.id), [other.id]);
    assert.equal(store.listFeedback('demo-sam')[0].id, other.id);
    assert.throws(() => store.resolveReport(report.id, { expectedVersion: 2, reason: 'No deleted report' }, now), { code: 'NOT_FOUND' });
    const inspect = new DatabaseSync(file);
    assert.equal((inspect.prepare('SELECT COUNT(*) AS count FROM student_occurrence_feedback WHERE persona_id = ?').get('demo-alex') as { count: number }).count, 0);
    inspect.close();
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});


function occurrenceSetup(filename = ':memory:') {
  const first = { ...opportunity('multi'), occurrenceId: 'primary', startsAt: '2026-10-18T10:00:00Z', endsAt: '2026-10-18T12:00:00Z', validUntil: '2026-10-25T00:00:00Z' };
  const later = { ...first, occurrenceId: 'later-session', startsAt: '2026-10-21T10:00:00Z', endsAt: '2026-10-21T12:00:00Z' };
  const rows = new Map([['primary', first], ['later-session', later]]);
  const unavailable = new Set<string>();
  const supply: StudentSupplyReader = {
    getPublic(id, clock = now, occurrenceId = 'primary') {
      const row = rows.get(occurrenceId);
      return id === 'multi' && row && !unavailable.has(occurrenceId) && Date.parse(row.startsAt) > clock.getTime() && Date.parse(row.validUntil) > clock.getTime() ? row : null;
    },
    getPublicSnapshot: (id, occurrenceId = 'primary') => id === 'multi' ? rows.get(occurrenceId) ?? null : null,
    getHistoricalSnapshot: () => null,
    listPublic: (_query, clock = now) => {
      const available = [...rows.keys()].map(id => supply.getPublic('multi', clock, id)).filter((row): row is PublicOpportunity => !!row);
      if (!available.length) return { data: [], total: 0 };
      return { data: [{ ...available[0], occurrences: available.map(row => ({ id: row.occurrenceId!, startsAt: row.startsAt, endsAt: row.endsAt, timezone: row.timezone, validUntil: row.validUntil, isCancelled: false })) }], total: 1 };
    },
  };
  return { store: createStudentRepository(filename, supply), supply, first, later, unavailable };
}

test('two dates of one parent have separate owner saves, handoffs and feedback with idempotent exact-date actions', () => {
  const { store } = occurrenceSetup();
  try {
    store.saveProfile('demo-alex', input(), now); store.saveProfile('demo-sam', input(), now);
    const first = store.saveOpportunity('demo-alex', 'multi', now, 'primary');
    const later = store.saveOpportunity('demo-alex', 'multi', now, 'later-session');
    assert.equal(store.listSaves('demo-alex', now).length, 2); assert.equal(store.listSaves('demo-sam', now).length, 0);
    assert.notEqual(first.startsAt, later.startsAt); assert.equal(later.occurrenceId, 'later-session');
    assert.deepEqual(store.saveOpportunity('demo-alex', 'multi', now, 'later-session'), later);
    const openedFirst = store.handoff('demo-alex', 'multi', now, 'primary');
    const openedLater = store.handoff('demo-alex', 'multi', now, 'later-session');
    assert.notEqual(openedFirst.id, openedLater.id);
    assert.deepEqual(store.handoff('demo-alex', 'multi', now, 'later-session'), openedLater);
    const feedbackFirst = store.submitFeedback('demo-alex', { opportunityId: 'multi', occurrenceId: 'primary', kind: 'WRONG_DETAILS' }, now);
    const feedbackLater = store.submitFeedback('demo-alex', { opportunityId: 'multi', occurrenceId: 'later-session', kind: 'WRONG_DETAILS' }, now);
    assert.notEqual(feedbackFirst.id, feedbackLater.id); assert.equal(store.listReports().length, 2);
    assert.deepEqual(store.submitFeedback('demo-alex', { opportunityId: 'multi', occurrenceId: 'later-session', kind: 'WRONG_DETAILS' }, now), feedbackLater);
    store.removeSave('demo-sam', 'multi', 'later-session');
    assert.equal(store.listSaves('demo-alex', now).length, 2);
    store.removeSave('demo-alex', 'multi');
    assert.deepEqual(store.listSaves('demo-alex', now).map(row => row.occurrenceId), ['later-session']);
    store.removeSave('demo-alex', 'multi', 'later-session'); store.removeSave('demo-alex', 'multi', 'later-session');
    assert.equal(store.listSaves('demo-alex', now).length, 0);
  } finally { store.close(); }
});

test('unknown, cancelled or foreign occurrence selection never falls back to an available sibling date', () => {
  const { store, supply, unavailable } = occurrenceSetup();
  try {
    store.saveProfile('demo-alex', input(), now);
    store.saveOpportunity('demo-alex', 'multi', now, 'primary'); store.handoff('demo-alex', 'multi', now, 'primary');
    unavailable.add('primary');
    for (const date of ['primary', 'unknown-date']) {
      assert.throws(() => store.saveOpportunity('demo-alex', 'multi', now, date), { code: 'NOT_FOUND' });
      assert.throws(() => store.handoff('demo-alex', 'multi', now, date), { code: 'NOT_FOUND' });
    }
    assert.equal(store.saveOpportunity('demo-alex', 'multi', now, 'later-session').available, true);
    assert.throws(() => store.submitFeedback('demo-alex', { opportunityId: 'multi', occurrenceId: 'unknown-date', kind: 'WRONG_DETAILS' }, now), { code: 'NOT_FOUND' });
    assert.equal(store.submitFeedback('demo-alex', { opportunityId: 'multi', occurrenceId: 'primary', kind: 'UNAVAILABLE' }, now).occurrenceId, 'primary');
    const correct = supply.getPublic;
    supply.getPublic = (id, clock) => correct(id, clock, 'later-session');
    assert.throws(() => store.handoff('demo-alex', 'multi', now, 'unknown-date'), { code: 'NOT_FOUND' });
    assert.throws(() => store.handoff('demo-alex', 'multi', now, 'primary'), { code: 'NOT_FOUND' });
    assert.throws(() => store.saveOpportunity('demo-alex', 'multi', now, '../bad-date'), { code: 'INVALID_INPUT' });
  } finally { store.close(); }
});

test('unavailable saves retain reviewed exact-date reschedules without using sibling snapshots', () => {
  const { store, supply, later, first, unavailable } = occurrenceSetup();
  try {
    store.saveProfile('demo-alex', input(), now);
    const saved = store.saveOpportunity('demo-alex', 'multi', now, 'later-session');
    later.title = 'Reviewed second-session correction';
    later.startsAt = '2026-10-22T13:00:00Z'; later.endsAt = '2026-10-22T15:00:00Z'; later.version++;
    const reviewed = store.listSaves('demo-alex', now)[0];
    assert.equal(reviewed.startsAt, later.startsAt); assert.notEqual(reviewed.startsAt, saved.startsAt);
    unavailable.add('later-session');
    const retained = store.listSaves('demo-alex', now)[0];
    assert.equal(retained.available, false); assert.equal(retained.opportunity, null);
    assert.equal(retained.title, later.title); assert.equal(retained.startsAt, later.startsAt); assert.equal(retained.endsAt, later.endsAt);
    assert.equal(store.exportData('demo-alex', now).saved[0].startsAt, later.startsAt);
    assert.equal(supply.getPublic('multi', now, 'primary')?.startsAt, first.startsAt, 'an available sibling does not replace the saved date');
    supply.getPublicSnapshot = () => first;
    const wrongDate = store.listSaves('demo-alex', now)[0];
    assert.equal(wrongDate.available, false); assert.equal(wrongDate.startsAt, saved.startsAt, 'mismatched snapshots are rejected, preserving the retained save');
    assert.equal(wrongDate.occurrenceId, 'later-session');
  } finally { store.close(); }
});

test('saved reschedules follow publication, then keep that schedule through cancellation and expiry', () => {
  const supply = createRepository(':memory:');
  const store = createStudentRepository(':memory:', supply);
  try {
    let item = supply.importRecord(fixtureList(now).find(row => row.fixtureId === 'garden-series')!.record, now).opportunity;
    item = supply.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Review synthetic series' }, now);
    store.saveProfile('demo-alex', input(), now);
    const original = store.saveOpportunity('demo-alex', item.id, now, 'week-2');
    const nextStart = new Date(Date.parse(original.startsAt) + 3 * 3600000).toISOString();
    const nextEnd = new Date(Date.parse(original.endsAt) + 3 * 3600000).toISOString();
    const dates = item.record.occurrences!.map(date => date.id === 'week-2' ? { ...date, startsAt: nextStart, endsAt: nextEnd } : date);
    item = supply.editOpportunity(item.id, { expectedVersion: item.version, reason: 'Reschedule the second date', changes: { occurrences: dates } }, now);
    const draft = store.listSaves('demo-alex', now)[0];
    assert.equal(draft.available, false); assert.equal(draft.opportunity, null);
    assert.equal(draft.startsAt, original.startsAt, 'unpublished schedule changes must not replace saved facts');
    item = supply.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Review rescheduled second date' }, now);
    assert.equal(store.listSaves('demo-alex', now)[0].startsAt, nextStart);
    const afterExpiry = new Date(Date.parse(dates[1].validUntil) + 1);
    assert.equal(store.listSaves('demo-alex', afterExpiry)[0].available, false);
    assert.equal(store.listSaves('demo-alex', afterExpiry)[0].startsAt, nextStart);
    item = supply.editOpportunity(item.id, { expectedVersion: item.version, reason: 'Cancel the reviewed second date', changes: { occurrences: dates.map(date => date.id === 'week-2' ? { ...date, isCancelled: true } : date) } }, now);
    item = supply.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Review cancellation with active siblings' }, now);
    const cancelled = store.listSaves('demo-alex', now)[0];
    assert.equal(cancelled.available, false); assert.equal(cancelled.opportunity, null);
    assert.equal(cancelled.startsAt, nextStart); assert.equal(cancelled.endsAt, nextEnd);
    assert.equal(store.exportData('demo-alex', now).saved[0].startsAt, nextStart);
  } finally { store.close(); supply.close(); }
});

test('reminder identity, dismissal, terminal suppression and availability apply to the selected occurrence only', () => {
  const { store, unavailable } = occurrenceSetup();
  try {
    store.saveProfile('demo-alex', input(), now); store.setAlerts('demo-alex', { inApp: true, eventReminders: true, catalogueUpdates: true });
    for (const date of ['primary', 'later-session']) { store.saveOpportunity('demo-alex', 'multi', now, date); store.handoff('demo-alex', 'multi', now, date); }
    let reminders = store.listReminders('demo-alex', now).filter(row => row.kind === 'UPCOMING');
    assert.equal(reminders.length, 2); assert.equal(new Set(reminders.map(row => row.id)).size, 2);
    assert.equal(reminders.find(row => row.occurrenceId === 'later-session')!.href, '/opportunities/multi?occurrence=later-session');
    store.updateReminder('demo-alex', 'upcoming:multi', 'DISMISS', now);
    assert.deepEqual(store.listReminders('demo-alex', now).filter(row => row.kind === 'UPCOMING').map(row => row.occurrenceId), ['later-session']);
    const firstActivity = store.listActivity('demo-alex', now).find(row => row.occurrenceId === 'primary')!;
    store.updateActivity('demo-alex', firstActivity.id, { expectedVersion: firstActivity.version, status: 'WITHDRAWN' }, now);
    assert.equal(store.listReminders('demo-alex', now).filter(row => row.kind === 'UPCOMING').length, 1);
    unavailable.add('later-session');
    reminders = store.listReminders('demo-alex', now);
    assert.equal(reminders.some(row => row.kind === 'UPCOMING'), false);
    assert.deepEqual(reminders.filter(row => row.kind === 'UNAVAILABLE').map(row => row.occurrenceId), ['later-session']);
  } finally { store.close(); }
});

test('attendance and pending reschedules use the exact dated session, preserving completed outcomes', () => {
  const { store, first, later } = occurrenceSetup();
  try {
    store.saveProfile('demo-alex', input(), now);
    const a = store.handoff('demo-alex', 'multi', now, 'primary');
    const b = store.handoff('demo-alex', 'multi', now, 'later-session');
    const afterFirst = new Date('2026-10-18T13:00:00Z');
    const attended = store.updateActivity('demo-alex', a.id, { expectedVersion: a.version, status: 'ATTENDED' }, afterFirst);
    assert.throws(() => store.updateActivity('demo-alex', b.id, { expectedVersion: b.version, status: 'ATTENDED' }, afterFirst), { code: 'OCCURRENCE_NOT_ENDED' });
    const oldEndsAt = attended.endsAt;
    first.startsAt = '2026-10-24T10:00:00Z'; first.endsAt = '2026-10-24T12:00:00Z';
    later.startsAt = '2026-10-23T10:00:00Z'; later.endsAt = '2026-10-23T12:00:00Z';
    const activity = store.listActivity('demo-alex', afterFirst);
    assert.equal(activity.find(row => row.id === a.id)!.endsAt, oldEndsAt);
    assert.equal(activity.find(row => row.id === b.id)!.endsAt, later.endsAt);
    assert.throws(() => store.updateActivity('demo-alex', b.id, { expectedVersion: b.version, status: 'ATTENDED' }, new Date('2026-10-21T13:00:00Z')), { code: 'OCCURRENCE_NOT_ENDED' });
  } finally { store.close(); }
});

function restoreLegacyTables(file: string): void {
  const db = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;
      INSERT INTO student_saves (persona_id, opportunity_id, title, saved_at) SELECT persona_id, opportunity_id, title, saved_at FROM student_occurrence_saves;
      INSERT INTO student_activity (id, persona_id, opportunity_id, snapshot_json, status, evidence_kind, version, created_at, updated_at) SELECT id, persona_id, opportunity_id, snapshot_json, status, evidence_kind, version, created_at, updated_at FROM student_occurrence_activity;
      INSERT INTO student_activity_events (id, activity_id, status, evidence_kind, at, sequence) SELECT id, activity_id, status, evidence_kind, at, sequence FROM student_occurrence_activity_events;
      INSERT INTO student_feedback (id, persona_id, opportunity_id, title, kind, status, version, created_at, resolution, resolved_at) SELECT id, persona_id, opportunity_id, title, kind, status, version, created_at, resolution, resolved_at FROM student_occurrence_feedback;
      DELETE FROM student_occurrence_activity_events; DELETE FROM student_occurrence_activity; DELETE FROM student_occurrence_saves; DELETE FROM student_occurrence_feedback;
      DELETE FROM student_schema_migrations WHERE name='student-occurrences-v1'; COMMIT;`);
  } finally { db.close(); }
}

test('legacy occurrence migration preserves IDs, versions, events, outcomes and reminders across two openings and deletion', () => {
  const folder = mkdtempSync(join(tmpdir(), 'comground-occurrence-migrate-')), file = join(folder, 'private.sqlite');
  let store = setup(file).store;
  try {
    for (const owner of ['demo-alex', 'demo-sam'] as const) {
      store.saveProfile(owner, input(), now); store.saveOpportunity(owner, 'future', now);
      const opened = store.handoff(owner, 'future', now); store.updateActivity(owner, opened.id, { expectedVersion: 1, status: 'APPLIED' }, now);
      const past = store.listActivity(owner, now).find(row => row.opportunityId === 'past')!; store.updateActivity(owner, past.id, { expectedVersion: 1, status: 'ATTENDED' }, now);
      store.setAlerts(owner, { inApp: true, eventReminders: true, catalogueUpdates: true }); store.updateReminder(owner, 'upcoming:future', 'DISMISS', now);
      const feedback = store.submitFeedback(owner, { opportunityId: 'future', kind: 'WRONG_DETAILS' }, now); store.resolveReport(feedback.id, { expectedVersion: 1, reason: 'Legacy synthetic review.' }, now);
    }
    const beforeAlex = store.exportData('demo-alex', now), beforeSam = store.exportData('demo-sam', now), beforeOutcomes = store.outcomes();
    store.close(); restoreLegacyTables(file); store = setup(file).store;
    assert.deepEqual(store.exportData('demo-alex', now), beforeAlex); assert.deepEqual(store.exportData('demo-sam', now), beforeSam); assert.deepEqual(store.outcomes(), beforeOutcomes);
    store.close(); store = setup(file).store;
    assert.deepEqual(store.exportData('demo-alex', now), beforeAlex); assert.deepEqual(store.outcomes(), beforeOutcomes);
    const inspect = new DatabaseSync(file);
    for (const table of ['student_saves', 'student_activity', 'student_activity_events', 'student_feedback']) assert.equal((inspect.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, 0);
    assert.equal((inspect.prepare("SELECT COUNT(*) AS n FROM student_schema_migrations WHERE name='student-occurrences-v1'").get() as { n: number }).n, 1);
    inspect.close();
    store.deleteProfile('demo-alex');
    assert.equal(store.exportData('demo-alex', now).activity.length, 0); assert.equal(store.exportData('demo-alex', now).feedback.length, 0); assert.equal(store.exportData('demo-alex', now).reminderStates.length, 0);
    assert.deepEqual(store.exportData('demo-sam', now), beforeSam);
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('failed migration verification rolls back all transferred data and leaves the marker absent', () => {
  const folder = mkdtempSync(join(tmpdir(), 'comground-occurrence-rollback-')), file = join(folder, 'private.sqlite');
  const initial = setup(file).store;
  try {
    initial.saveProfile('demo-alex', input(), now); initial.saveOpportunity('demo-alex', 'future', now);
    initial.submitFeedback('demo-alex', { opportunityId: 'future', kind: 'WRONG_DETAILS' }, now);
    initial.close(); restoreLegacyTables(file);
    const sabotage = new DatabaseSync(file);
    sabotage.exec("CREATE TRIGGER test_ignore_copy BEFORE INSERT ON student_occurrence_feedback BEGIN SELECT RAISE(IGNORE); END;"); sabotage.close();
    assert.throws(() => setup(file), { code: 'MIGRATION_FAILED' });
    const inspect = new DatabaseSync(file);
    assert.equal((inspect.prepare('SELECT COUNT(*) AS n FROM student_feedback').get() as { n: number }).n, 1);
    assert.equal((inspect.prepare('SELECT COUNT(*) AS n FROM student_saves').get() as { n: number }).n, 1);
    assert.equal((inspect.prepare('SELECT COUNT(*) AS n FROM student_occurrence_feedback').get() as { n: number }).n, 0);
    assert.equal((inspect.prepare('SELECT COUNT(*) AS n FROM student_occurrence_activity').get() as { n: number }).n, 0);
    assert.equal((inspect.prepare("SELECT COUNT(*) AS n FROM student_schema_migrations WHERE name='student-occurrences-v1'").get() as { n: number }).n, 0);
    inspect.exec('DROP TRIGGER test_ignore_copy'); inspect.close();
    const recovered = setup(file).store;
    assert.equal(recovered.listFeedback('demo-alex').length, 1); assert.equal(recovered.listSaves('demo-alex', now).length, 1); recovered.close();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('transactional measurement hooks link only new actions for the exposed occurrence after opt-in', () => {
  const { store, later } = occurrenceSetup();
  try {
    const profile = store.saveProfile('demo-alex', input(), now);
    store.handoff('demo-alex', 'multi', now, 'primary');
    assert.equal(store.exportData('demo-alex', now).measurement.outcomes.length, 0);
    const consent = store.measurement.setConsent('demo-alex', { expectedVersion: 0, expectedProfileVersion: profile.version, enabled: true }, now);
    const exposure = store.measurement.recordExposure({ owner: 'demo-alex', requestId: 'hook-test-request', issuedAt: now.toISOString(), consentVersion: consent.version, profileVersion: profile.version, rulesVersion: 'deterministic-occurrences-v2', items: [{ opportunityId: 'multi', occurrenceId: 'later-session', version: later.version }] }, now);
    store.saveOpportunity('demo-alex', 'multi', now, 'primary');
    assert.equal(store.exportData('demo-alex', now).measurement.outcomes.length, 0);
    store.saveOpportunity('demo-alex', 'multi', now, 'later-session'); store.saveOpportunity('demo-alex', 'multi', now, 'later-session');
    const opened = store.handoff('demo-alex', 'multi', now, 'later-session'); store.handoff('demo-alex', 'multi', now, 'later-session');
    const applied = store.updateActivity('demo-alex', opened.id, { expectedVersion: opened.version, status: 'APPLIED' }, now);
    store.updateActivity('demo-alex', opened.id, { expectedVersion: applied.version, status: 'APPLIED' }, now);
    store.submitFeedback('demo-alex', { opportunityId: 'multi', occurrenceId: 'later-session', kind: 'NOT_RELEVANT' }, now);
    store.submitFeedback('demo-alex', { opportunityId: 'multi', occurrenceId: 'later-session', kind: 'NOT_RELEVANT' }, now);
    const ended = new Date(Date.parse(later.endsAt) + 1);
    store.updateActivity('demo-alex', opened.id, { expectedVersion: applied.version, status: 'ATTENDED' }, ended);
    const outcomes = store.exportData('demo-alex', ended).measurement.outcomes;
    assert.deepEqual(outcomes.map(item => item.kind).sort(), ['APPLIED', 'ATTENDED', 'NOT_RELEVANT', 'OPENED', 'SAVED']);
    assert.ok(outcomes.every(item => item.occurrenceId === 'later-session' && item.exposureId === exposure.id));
    assert.equal(outcomes.find(item => item.kind === 'APPLIED')!.evidenceKind, 'SELF_REPORTED');
    store.measurement.setConsent('demo-alex', { expectedVersion: consent.version, expectedProfileVersion: profile.version, enabled: false }, ended);
    assert.equal(store.exportData('demo-alex', ended).measurement.exposures.length, 0);
    assert.equal(store.exportData('demo-alex', ended).measurement.outcomes.length, 0);
    assert.equal(store.listActivity('demo-alex', ended).find(item => item.id === opened.id)!.status, 'ATTENDED');
  } finally { store.close(); }
});

test('measurement hook failure rolls back the corresponding save, handoff, activity event or fit feedback', () => {
  const { store } = occurrenceSetup();
  try {
    store.saveProfile('demo-alex', input(), now);
    const record = store.measurement.recordOutcome;
    const reject = () => { throw new Error('synthetic transaction failure'); };
    store.measurement.recordOutcome = reject;
    assert.throws(() => store.saveOpportunity('demo-alex', 'multi', now, 'primary'), /synthetic transaction failure/);
    assert.equal(store.listSaves('demo-alex', now).length, 0);
    assert.throws(() => store.handoff('demo-alex', 'multi', now, 'primary'), /synthetic transaction failure/);
    assert.equal(store.listActivity('demo-alex', now).length, 0);
    store.measurement.recordOutcome = record;
    const opened = store.handoff('demo-alex', 'multi', now, 'primary');
    store.measurement.recordOutcome = reject;
    assert.throws(() => store.updateActivity('demo-alex', opened.id, { expectedVersion: opened.version, status: 'APPLIED' }, now), /synthetic transaction failure/);
    const unchanged = store.listActivity('demo-alex', now)[0];
    assert.equal(unchanged.version, 1); assert.equal(unchanged.events.length, 1); assert.equal(unchanged.status, 'OPENED');
    assert.throws(() => store.submitFeedback('demo-alex', { opportunityId: 'multi', occurrenceId: 'primary', kind: 'NOT_RELEVANT' }, now), /synthetic transaction failure/);
    assert.equal(store.listFeedback('demo-alex').length, 0);
    store.measurement.recordOutcome = record;
  } finally { store.close(); }
});

test('profile deletion cascades actual linked measurement while preserving the other owner', () => {
  const { store, later } = occurrenceSetup();
  try {
    for (const owner of ['demo-alex', 'demo-sam'] as const) {
      const profile = store.saveProfile(owner, input(), now);
      const consent = store.measurement.setConsent(owner, { expectedVersion: 0, expectedProfileVersion: profile.version, enabled: true }, now);
      store.measurement.attribute(owner, { campaignId: 'demo-community' }, now);
      store.measurement.recordExposure({ owner, requestId: `request-${owner}`, issuedAt: now.toISOString(), consentVersion: consent.version, profileVersion: profile.version, rulesVersion: 'deterministic-occurrences-v2', items: [{ opportunityId: 'multi', occurrenceId: 'later-session', version: later.version }] }, now);
      store.saveOpportunity(owner, 'multi', now, 'later-session');
    }
    const sam = store.exportData('demo-sam', now).measurement;
    assert.equal(sam.outcomes.length, 1);
    store.deleteProfile('demo-alex');
    const deleted = store.exportData('demo-alex', now).measurement;
    assert.equal(deleted.consent.enabled, false); assert.equal(deleted.attribution, null); assert.equal(deleted.exposures.length, 0); assert.equal(deleted.feedback.length, 0); assert.equal(deleted.outcomes.length, 0);
    assert.deepEqual(store.exportData('demo-sam', now).measurement, sam);
  } finally { store.close(); }
});

test('stored matching selects the eligible later date once per parent while actions remain availability-only', () => {
  const { store, later, unavailable } = occurrenceSetup();
  try {
    const profile = store.saveProfile('demo-alex', { ...input(), preferences: { ...preferences, area: later.area, availableFrom: '2026-10-21T09:00:00Z', availableUntil: '2026-10-21T13:00:00Z' } }, now);
    const result = store.matches('demo-alex', now);
    assert.equal(result.eligibleCount, 1); assert.equal(result.data.length, 1);
    assert.equal(result.data[0].opportunity.occurrenceId, 'later-session');
    assert.equal(result.data[0].opportunity.startsAt, later.startsAt); assert.equal(result.profileVersion, profile.version);
    assert.equal(store.saveOpportunity('demo-alex', 'multi', now, 'primary').available, true);
    assert.equal(store.handoff('demo-alex', 'multi', now, 'primary').status, 'OPENED');
    unavailable.add('later-session');
    assert.equal(store.matches('demo-alex', now).eligibleCount, 0);
  } finally { store.close(); }
});
