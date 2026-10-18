import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decryptNotification, encryptNotification } from './notification-crypto.ts';
import { createResendDelivery, type NotificationConfiguration, type NotificationMessage } from './notification-delivery.ts';
import { cancelRestoredNotifications, createNotificationStore, enqueueIdentityNotification, exportOwnerNotifications, initializeNotificationSchema, notificationOwner, pruneNotifications, purgeOwnerNotifications, type NotificationOccurrence } from './notification-repository.ts';
import { notificationInterestActive, scanNotificationCandidates } from './notification-scanner.ts';
import { runNotificationWorkerOnce } from './notification-worker.ts';

const now = new Date('2026-10-18T09:00:00Z');
const owner = 'account-11111111-1111-4111-8111-111111111111', other = 'account-22222222-2222-4222-8222-222222222222';
const key = Buffer.alloc(32, 7).toString('base64');
const config = (): NotificationConfiguration => ({ mode: 'production', deliveryEnabled: true, origin: 'https://app.example.invalid', encryptionKey: key, apiKey: 'unit-test-key-never-live', from: 'service@example.invalid' });
const occurrence: NotificationOccurrence = { opportunityId: 'garden', occurrenceId: 'evening', opportunityVersion: 3, startsAt: '2026-10-20T12:00:00Z' };
function setup(filename = ':memory:') {
  const db = new DatabaseSync(filename); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(`CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,email_norm TEXT,role TEXT,email_verified_at TEXT,adult_attested_at TEXT);
    CREATE TABLE IF NOT EXISTS student_profiles(persona_id TEXT PRIMARY KEY,profile_json TEXT);
    CREATE TABLE IF NOT EXISTS student_privacy(owner TEXT PRIMARY KEY,policy_version TEXT,adult_confirmed INTEGER);
    CREATE TABLE IF NOT EXISTS account_action_tokens(token_hash TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,purpose TEXT,expires_at TEXT,used_at TEXT);`);
  for (const [id, email, version] of [[owner, 'adult@example.invalid', 4], [other, 'other@example.invalid', 5]] as const) {
    db.prepare('INSERT OR IGNORE INTO accounts VALUES(?,?,?,?,?)').run(id, email, 'STUDENT', now.toISOString(), now.toISOString());
    db.prepare('INSERT OR IGNORE INTO student_profiles VALUES(?,?)').run(id, JSON.stringify({ version, consentVersion: 'adult-account-v1', preferences: { ageMin: 18 } }));
    db.prepare('INSERT OR IGNORE INTO student_privacy VALUES(?,?,1)').run(id, 'adult-account-v1');
  }
  const environment = config(), eligibility = { available: true };
  const store = createNotificationStore(db, { config: () => environment, occurrenceAvailable: (_owner, reference) => eligibility.available && reference.occurrenceId === 'evening' });
  return { db, store, environment, eligibility };
}
function enable(store: ReturnType<typeof createNotificationStore>, id = owner) { const current = store.preferences(id); return store.setPreferences(id, { expectedVersion: current.version, expectedProfileVersion: current.profileVersion, enabled: true }, now); }
function accountMessage(db: DatabaseSync, purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD' = 'VERIFY_EMAIL', id = owner) {
  db.prepare('UPDATE accounts SET email_verified_at=? WHERE id=?').run(purpose === 'VERIFY_EMAIL' ? null : now.toISOString(), id);
  const token = randomBytes(32).toString('base64url'), expiresAt = new Date(now.getTime() + 3600000).toISOString();
  db.prepare('INSERT INTO account_action_tokens VALUES(?,?,?,?,NULL)').run(createHash('sha256').update(token).digest('hex'), id, purpose, expiresAt);
  return { purpose, accountId: id, email: id === owner ? 'adult@example.invalid' : 'other@example.invalid', token, expiresAt };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

test('encryption is authenticated, randomized and bound to one outbox ID', () => {
  const value = { recipient: 'adult@example.invalid', token: 'secret-test-token' };
  const a = encryptNotification(value, 'one', key), b = encryptNotification(value, 'one', key);
  assert.notEqual(a, b); assert.equal(a.includes(value.recipient), false); assert.equal(a.includes(value.token), false);
  assert.deepEqual(decryptNotification(a, 'one', key), value);
  for (const call of [() => decryptNotification(a, 'two', key), () => decryptNotification(a, 'one', Buffer.alloc(32, 8).toString('base64')), () => decryptNotification(`${a.slice(0, -5)}AAAAA`, 'one', key)]) assert.throws(call, { code: 'NOTIFICATION_PAYLOAD_UNAVAILABLE' });
  assert.throws(() => encryptNotification(value, 'one', null), { code: 'NOTIFICATION_CONFIGURATION_MISSING' });
});
test('transactional account messages are encrypted, idempotent and durably BLOCKED with delivery off and no sender', () => {
  const { db, store, environment } = setup();
  try {
    environment.mode = 'test'; environment.origin = 'http://127.0.0.1:3110'; environment.deliveryEnabled = false; environment.apiKey = null; environment.from = null;
    const message = accountMessage(db), first = enqueueIdentityNotification(db, message, environment, now);
    assert.equal(first.state, 'BLOCKED'); assert.equal(store.preferences(owner).enabled, false);
    assert.equal(enqueueIdentityNotification(db, message, environment, now).id, first.id);
    const stored = db.prepare('SELECT * FROM notification_outbox WHERE id=?').get(first.id) as { envelope: string };
    assert.equal(JSON.stringify(stored).includes(message.email), false); assert.equal(JSON.stringify(stored).includes(message.token), false);
    const body = decryptNotification<{ text: string }>(stored.envelope, first.id, key);
    assert.ok(body.text.includes(`/account/verify#token=${message.token}`)); assert.equal(body.text.includes('?token='), false);
    assert.equal(store.claim(now), null); assert.equal(store.exportData(other).outbox.length, 0);
    assert.equal(JSON.stringify(store.summary(now)).includes(message.email), false);
    assert.equal(JSON.stringify(store.exportData(owner)).includes(message.token), false);
  } finally { db.close(); }
});
test('identity enqueue participates in rollback and refuses missing encryption/origin without a plaintext fallback', () => {
  const { db, environment } = setup();
  try {
    const message = accountMessage(db);
    db.exec('BEGIN'); enqueueIdentityNotification(db, message, environment, now); db.exec('ROLLBACK');
    assert.equal(exportOwnerNotifications(db, owner).outbox.length, 0);
    assert.throws(() => enqueueIdentityNotification(db, message, { ...environment, encryptionKey: null }, now), { code: 'NOTIFICATION_CONFIGURATION_MISSING' });
    assert.throws(() => enqueueIdentityNotification(db, message, { ...environment, mode: 'production', origin: 'http://127.0.0.1:3110' }, now), { code: 'NOTIFICATION_CONFIGURATION_MISSING' });
    assert.throws(() => enqueueIdentityNotification(db, message, { ...environment, mode: 'demo' }, now), { code: 'NOTIFICATION_CONFIGURATION_MISSING' });
  } finally { db.close(); }
});
test('optional consent is separate, versioned, default off and requires a current verified adult profile', () => {
  const { db, store } = setup();
  try {
    assert.equal(store.preferences(owner).enabled, false);
    assert.throws(() => store.enqueueReminder(owner, occurrence, now), { code: 'NOTIFICATION_CONSENT_REQUIRED' });
    const active = enable(store); assert.equal(active.enabled, true);
    assert.throws(() => store.setPreferences(owner, { expectedVersion: 0, expectedProfileVersion: 4, enabled: false }, now), { code: 'VERSION_CONFLICT' });
    assert.throws(() => store.setPreferences(owner, { expectedVersion: active.version, expectedProfileVersion: 3, enabled: false }, now), { code: 'VERSION_CONFLICT' });
    assert.throws(() => store.setPreferences(owner, { expectedVersion: active.version, expectedProfileVersion: 4, enabled: false, email: 'elsewhere@example.invalid' }, now), { code: 'INVALID_INPUT' });
    db.prepare('UPDATE accounts SET email_verified_at=NULL WHERE id=?').run(other);
    assert.throws(() => enable(store, other), { code: 'VERIFICATION_REQUIRED' });
    db.prepare('UPDATE accounts SET email_verified_at=? WHERE id=?').run(now.toISOString(), other);
    db.prepare("UPDATE student_privacy SET policy_version='outdated' WHERE owner=?").run(other);
    assert.throws(() => enable(store, other), { code: 'CONSENT_REQUIRED' });
    assert.equal(store.exportData(other).outbox.length, 0);
  } finally { db.close(); }
});
test('reminder dedupe is occurrence-specific and reports newly inserted rows truthfully', () => {
  const { db, store } = setup();
  try {
    enable(store);
    const first = store.enqueueReminderWithResult(owner, occurrence, now), second = store.enqueueReminderWithResult(owner, occurrence, now);
    assert.equal(first.created, true); assert.equal(second.created, false); assert.equal(second.notification.id, first.notification.id);
    assert.equal(store.exportData(owner).outbox[0].occurrenceId, 'evening');
    assert.throws(() => store.enqueueReminder(owner, { ...occurrence, occurrenceId: 'morning' }, now), { code: 'OCCURRENCE_UNAVAILABLE' });
  } finally { db.close(); }
});
test('opt-out cancels pending reminders and wipes payloads without cancelling explicit account recovery', () => {
  const { db, store, environment } = setup();
  try {
    const consent = enable(store), reminder = store.enqueueReminder(owner, occurrence, now);
    const recovery = enqueueIdentityNotification(db, accountMessage(db, 'RESET_PASSWORD'), environment, now);
    store.setPreferences(owner, { expectedVersion: consent.version, expectedProfileVersion: 4, enabled: false }, now);
    const records = store.exportData(owner).outbox;
    assert.equal(records.find(item => item.id === reminder.id)?.state, 'CANCELLED');
    assert.equal(records.find(item => item.id === recovery.id)?.state, 'QUEUED');
    assert.equal((db.prepare('SELECT envelope FROM notification_outbox WHERE id=?').get(reminder.id) as { envelope: null }).envelope, null);
    enable(store); assert.equal(store.exportData(owner).outbox.find(item => item.id === reminder.id)?.state, 'CANCELLED');
  } finally { db.close(); }
});
test('dispatch rechecks cancellation, consent epoch, profile, privacy, recipient and exact occurrence before invoking transport', async () => {
  for (const change of ['optout', 'profile', 'privacy', 'unverified', 'unavailable', 'owner'] as const) {
    const { db, store, eligibility } = setup();
    try {
      const consent = enable(store); store.enqueueReminder(owner, occurrence, now);
      if (change === 'optout') store.setPreferences(owner, { expectedVersion: consent.version, expectedProfileVersion: 4, enabled: false }, now);
      if (change === 'profile') db.prepare('UPDATE student_profiles SET profile_json=? WHERE persona_id=?').run(JSON.stringify({ version: 6, consentVersion: 'adult-account-v1', preferences: { ageMin: 18 } }), owner);
      if (change === 'privacy') db.prepare("UPDATE student_privacy SET policy_version='outdated' WHERE owner=?").run(owner);
      if (change === 'unverified') db.prepare('UPDATE accounts SET email_verified_at=NULL WHERE id=?').run(owner);
      if (change === 'unavailable') eligibility.available = false;
      if (change === 'owner') db.prepare('DELETE FROM accounts WHERE id=?').run(owner);
      let called = false;
      await runNotificationWorkerOnce(store, async () => { called = true; return { kind: 'ACCEPTED', providerId: 'never' }; }, () => now);
      assert.equal(called, false, change);
    } finally { db.close(); }
  }
});
test('used or expired account actions are cancelled before delivery, independently of optional reminders', async () => {
  for (const used of [true, false]) {
    const { db, store, environment } = setup();
    try {
      const message = accountMessage(db), queued = enqueueIdentityNotification(db, message, environment, now);
      if (used) db.prepare('UPDATE account_action_tokens SET used_at=? WHERE account_id=?').run(now.toISOString(), owner);
      let called = false; const clock = used ? now : new Date(Date.parse(message.expiresAt) + 1);
      await runNotificationWorkerOnce(store, async () => { called = true; return { kind: 'ACCEPTED', providerId: 'never' }; }, () => clock);
      assert.equal(called, false); assert.equal(store.exportData(owner).outbox.find(item => item.id === queued.id)?.reason, 'TOKEN_EXPIRED');
    } finally { db.close(); }
  }
});
test('retries honor backoff and reuse exact provider payload and stable idempotency key', async () => {
  const { db, store } = setup();
  try {
    enable(store); store.enqueueReminder(owner, occurrence, now);
    const calls: { body: string; key: string }[] = []; let clock = now;
    const delivery = async (message: NotificationMessage, idempotencyKey: string) => { calls.push({ body: JSON.stringify(message), key: idempotencyKey }); return calls.length === 1 ? { kind: 'RETRY' as const, reason: 'PROVIDER_RETRYABLE' as const, retryAfterSeconds: 120 } : { kind: 'ACCEPTED' as const, providerId: 'provider-id' }; };
    await runNotificationWorkerOnce(store, delivery, () => clock);
    const retry = store.exportData(owner).outbox[0]; assert.equal(retry.state, 'RETRY'); assert.equal(retry.attempts, 1);
    assert.equal(store.claim(new Date(now.getTime() + 119000)), null);
    clock = new Date(retry.nextAttemptAt!); await runNotificationWorkerOnce(store, delivery, () => clock);
    assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
    const accepted = store.exportData(owner).outbox[0]; assert.equal(accepted.state, 'ACCEPTED'); assert.ok(accepted.providerAcceptedAt);
    assert.equal((db.prepare('SELECT envelope FROM notification_outbox').get() as { envelope: null }).envelope, null);
  } finally { db.close(); }
});
test('durable leases prevent concurrent claims and stale workers cannot finalize a reclaimed job', () => {
  const directory = mkdtempSync(join(tmpdir(), 'comground-notification-lease-')); let first: ReturnType<typeof setup> | undefined, second: ReturnType<typeof setup> | undefined;
  try {
    first = setup(join(directory, 'queue.sqlite')); enable(first.store); first.store.enqueueReminder(owner, occurrence, now);
    second = setup(join(directory, 'queue.sqlite'));
    const a = first.store.claim(now)!; assert.equal(second.store.claim(now), null);
    const prepared = first.store.prepare(a, now)!;
    const later = new Date(now.getTime() + 60001), b = second.store.claim(later)!;
    assert.equal(a.id, b.id); assert.notEqual(a.token, b.token);
    first.store.settle(a, { kind: 'ACCEPTED', providerId: 'stale' }, later);
    assert.equal(second.store.exportData(owner).outbox[0].state, 'LEASED');
    assert.deepEqual(second.store.prepare(b, later), prepared);
    second.store.settle(b, { kind: 'ACCEPTED', providerId: 'accepted' }, later);
    assert.equal(second.store.exportData(owner).outbox[0].state, 'ACCEPTED');
  } finally { first?.db.close(); second?.db.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('opt-out during an in-flight provider call prevents retries and honestly retains acceptance uncertainty', async () => {
  const { db, store } = setup();
  try {
    const consent = enable(store); store.enqueueReminder(owner, occurrence, now);
    await runNotificationWorkerOnce(store, async () => { store.setPreferences(owner, { expectedVersion: consent.version, expectedProfileVersion: 4, enabled: false }, now); return { kind: 'ACCEPTED', providerId: 'accepted-in-flight' }; }, () => now);
    const item = store.exportData(owner).outbox[0]; assert.equal(item.state, 'CANCELLED'); assert.equal(item.cancellationMayBeInFlight, true); assert.ok(item.providerAcceptedAt);
    assert.equal(store.claim(new Date(now.getTime() + 60000)), null);
  } finally { db.close(); }
});
test('bounded retries stop at five attempts and before the provider idempotency window expires', async () => {
  const { db, store } = setup();
  try {
    enable(store); store.enqueueReminder(owner, occurrence, now); let clock = now;
    for (let attempt = 0; attempt < 5; attempt++) { await runNotificationWorkerOnce(store, async () => ({ kind: 'RETRY', reason: 'DELIVERY_UNCERTAIN' }), () => clock); const result = store.exportData(owner).outbox[0]; if (result.nextAttemptAt) clock = new Date(result.nextAttemptAt); }
    assert.equal(store.exportData(owner).outbox[0].state, 'DEAD_LETTER'); assert.equal(store.exportData(owner).outbox[0].reason, 'MAX_ATTEMPTS');
    const second = store.enqueueReminder(owner, { ...occurrence, opportunityId: 'other-garden' }, now);
    const lease = store.claim(now)!; store.prepare(lease, now); store.settle(lease, { kind: 'RETRY', reason: 'DELIVERY_UNCERTAIN', retryAfterSeconds: 86400 }, now);
    assert.equal(store.exportData(owner).outbox.find(item => item.id === second.id)?.reason, 'IDEMPOTENCY_WINDOW_EXPIRED');
  } finally { db.close(); }
});
test('wrong encryption key dead-letters the payload instead of sending a substitute', async () => {
  const { db, store, environment } = setup();
  try {
    enable(store); store.enqueueReminder(owner, occurrence, now); environment.encryptionKey = Buffer.alloc(32, 9).toString('base64');
    let called = false; await runNotificationWorkerOnce(store, async () => { called = true; return { kind: 'ACCEPTED', providerId: 'never' }; }, () => now);
    assert.equal(called, false); assert.equal(store.exportData(owner).outbox[0].reason, 'PAYLOAD_UNAVAILABLE');
  } finally { db.close(); }
});
test('owner deletion is atomic, isolated and cannot be undone by a late delivery result', () => {
  const { db, store } = setup();
  try {
    enable(store); enable(store, other); store.enqueueReminder(owner, occurrence, now); store.enqueueReminder(other, occurrence, now);
    const lease = store.claim(now)!; store.prepare(lease, now);
    db.exec('BEGIN'); purgeOwnerNotifications(db, owner); db.exec('ROLLBACK'); assert.equal(store.exportData(owner).outbox.length, 1);
    db.exec('BEGIN'); purgeOwnerNotifications(db, owner); db.prepare('DELETE FROM student_profiles WHERE persona_id=?').run(owner); db.exec('COMMIT');
    store.settle(lease, { kind: 'ACCEPTED', providerId: 'late' }, now);
    assert.equal(store.exportData(owner).outbox.length, 0); assert.equal(store.exportData(other).outbox.length, 1);
  } finally { db.close(); }
});
test('account deletion before student-profile schema exists has an absent-table-safe purge', () => {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON; CREATE TABLE accounts(id TEXT PRIMARY KEY);');
  try { initializeNotificationSchema(db); assert.doesNotThrow(() => purgeOwnerNotifications(db, owner)); assert.deepEqual(exportOwnerNotifications(db, owner).outbox, []); } finally { db.close(); }
});
test('demo inspection before account schema exists leaves deletion and maintenance safe', () => {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON;');
  try {
    initializeNotificationSchema(db);
    assert.doesNotThrow(() => purgeOwnerNotifications(db, 'demo-alex'));
    assert.doesNotThrow(() => pruneNotifications(db, now));
    assert.doesNotThrow(() => cancelRestoredNotifications(db, now));
    assert.deepEqual(exportOwnerNotifications(db, 'demo-alex').outbox, []);
  } finally { db.close(); }
});
test('restore reconciliation cancels unsent jobs, clears encrypted payloads and prevents dispatch', () => {
  const { db, store } = setup();
  try { enable(store); store.enqueueReminder(owner, occurrence, now); const lease = store.claim(now)!; store.prepare(lease, now); cancelRestoredNotifications(db, now); assert.equal(store.exportData(owner).outbox[0].reason, 'RESTORE_QUARANTINE'); assert.equal(store.claim(new Date(now.getTime() + 60000)), null); assert.equal((db.prepare('SELECT envelope FROM notification_outbox').get() as { envelope: null }).envelope, null); } finally { db.close(); }
});
test('operator summaries never expose recipients, account IDs, bodies or token hashes and cancellation checks current state', () => {
  const { db, store } = setup();
  try {
    enable(store); const queued = store.enqueueReminder(owner, occurrence, now), summary = store.summary(now), serialized = JSON.stringify(summary);
    for (const sensitive of [owner, 'adult@example.invalid', 'Sign in to check', 'token_hash', 'envelope']) assert.equal(serialized.includes(sensitive), false);
    assert.equal(summary.pendingRequests[0].id, queued.id);
    assert.throws(() => store.cancel(queued.id, { action: 'CANCEL', expectedUpdatedAt: 'outdated' }, now), { code: 'VERSION_CONFLICT' });
    store.cancel(queued.id, { action: 'CANCEL', expectedUpdatedAt: queued.updatedAt }, now);
    assert.equal(store.summary(now).counts.CANCELLED, 1);
  } finally { db.close(); }
});
test('maintenance expires encrypted blocked account messages while delivery is off and prunes terminal metadata after thirty days', () => {
  const { db, store, environment } = setup();
  try {
    environment.deliveryEnabled = false;
    const message = accountMessage(db), queued = enqueueIdentityNotification(db, message, environment, now);
    const expired = new Date(Date.parse(message.expiresAt) + 1); store.prune(expired);
    assert.equal(store.exportData(owner).outbox[0].state, 'CANCELLED');
    assert.equal(store.exportData(owner).outbox[0].reason, 'TOKEN_EXPIRED');
    assert.equal((db.prepare('SELECT envelope FROM notification_outbox WHERE id=?').get(queued.id) as { envelope: null }).envelope, null);
    store.prune(new Date(expired.getTime() + 31 * 86400000)); assert.equal(store.exportData(owner).outbox.length, 0);
  } finally { db.close(); }
});
test('bounded reminder scan persists a cursor, reaches items beyond the first 100 and counts only new enqueue results', () => {
  const { db, store } = setup();
  try {
    enable(store);
    db.exec('CREATE TABLE student_occurrence_saves(persona_id TEXT,opportunity_id TEXT,occurrence_id TEXT); CREATE TABLE student_occurrence_activity(id TEXT,persona_id TEXT,opportunity_id TEXT,occurrence_id TEXT,status TEXT);');
    for (let i = 0; i < 101; i++) db.prepare('INSERT INTO student_occurrence_saves VALUES(?,?,?)').run(owner, `event-${String(i).padStart(3, '0')}`, 'evening');
    const resolve = (candidate: { opportunity_id: string }) => candidate.opportunity_id === 'event-100' ? { ...occurrence, opportunityId: candidate.opportunity_id } : null;
    const enqueue = (id: string, reference: NotificationOccurrence) => store.enqueueReminderWithResult(id, reference, now);
    assert.deepEqual(scanNotificationCandidates(db, resolve, enqueue), { examined: 100, queued: 0 });
    assert.deepEqual(scanNotificationCandidates(db, resolve, enqueue), { examined: 1, queued: 1 });
    assert.deepEqual(scanNotificationCandidates(db, resolve, enqueue), { examined: 100, queued: 0 });
    assert.deepEqual(scanNotificationCandidates(db, resolve, enqueue), { examined: 1, queued: 0 });
    assert.equal(store.exportData(owner).outbox.length, 1);
    purgeOwnerNotifications(db, owner); assert.equal((db.prepare('SELECT owner FROM notification_scan_cursor').get() as { owner: string }).owner, '');
  } finally { db.close(); }
});
test('dispatch rechecks exact current interest: unsaved and terminal activities cancel while an active application remains eligible', async () => {
  for (const status of ['UNSAVED', 'WITHDRAWN', 'ATTENDED', 'NOT_ATTENDED', 'APPLIED'] as const) {
    const { db, environment } = setup();
    try {
      db.exec('CREATE TABLE student_occurrence_saves(persona_id TEXT,opportunity_id TEXT,occurrence_id TEXT); CREATE TABLE student_occurrence_activity(id TEXT,persona_id TEXT,opportunity_id TEXT,occurrence_id TEXT,status TEXT);');
      const store = createNotificationStore(db, { config: () => environment, occurrenceAvailable: (id, reference) => notificationInterestActive(db, id, reference) });
      enable(store);
      db.prepare('INSERT INTO student_occurrence_saves VALUES(?,?,?)').run(owner, occurrence.opportunityId, occurrence.occurrenceId);
      assert.equal(notificationInterestActive(db, other, occurrence), false);
      assert.equal(notificationInterestActive(db, owner, { ...occurrence, occurrenceId: 'different-date' }), false);
      store.enqueueReminder(owner, occurrence, now);
      if (status === 'UNSAVED') db.prepare('DELETE FROM student_occurrence_saves WHERE persona_id=?').run(owner);
      else db.prepare('INSERT INTO student_occurrence_activity VALUES(?,?,?,?,?)').run('activity', owner, occurrence.opportunityId, occurrence.occurrenceId, status);
      if (status === 'APPLIED') db.prepare('DELETE FROM student_occurrence_saves WHERE persona_id=?').run(owner);
      let calls = 0;
      await runNotificationWorkerOnce(store, async () => { calls += 1; return { kind: 'ACCEPTED', providerId: 'test-provider' }; }, () => now);
      assert.equal(calls, status === 'APPLIED' ? 1 : 0, status);
      assert.equal(store.exportData(owner).outbox[0].state, status === 'APPLIED' ? 'ACCEPTED' : 'CANCELLED', status);
      if (status !== 'APPLIED') assert.equal(store.exportData(owner).outbox[0].reason, 'OPPORTUNITY_UNAVAILABLE', status);
    } finally { db.close(); }
  }
});
test('real Resend adapter is activation-gated and validates provider acceptance without exposing provider error text', async () => {
  const environment = config(), calls: { url: string; options: RequestInit }[] = [];
  const message: NotificationMessage = { from: environment.from!, to: ['adult@example.invalid'], subject: 'Test subject', text: 'Test body' };
  let response = json({ id: 'provider-123' });
  const fetcher = (async (url, options) => { calls.push({ url: String(url), options: options! }); return response; }) as typeof fetch;
  const send = createResendDelivery(() => environment, fetcher);
  environment.deliveryEnabled = false; assert.equal((await send(message, 'comground-test')).kind, 'PERMANENT'); assert.equal(calls.length, 0);
  environment.mode = 'test'; environment.deliveryEnabled = true; assert.equal((await send(message, 'comground-test')).kind, 'PERMANENT'); assert.equal(calls.length, 0);
  environment.mode = 'production'; assert.deepEqual(await send(message, 'comground-test'), { kind: 'ACCEPTED', providerId: 'provider-123' });
  assert.equal(calls[0].url, 'https://api.resend.com/emails'); assert.equal(calls[0].options.redirect, 'error');
  assert.equal((calls[0].options.headers as Record<string, string>)['Idempotency-Key'], 'comground-test');
  response = json({ message: 'private recipient adult@example.invalid', name: 'validation_error' }, 403);
  assert.deepEqual(await send(message, 'comground-test'), { kind: 'PERMANENT', reason: 'PROVIDER_REJECTED' });
  response = json({ name: 'concurrent_idempotent_requests' }, 409); assert.equal((await send(message, 'comground-test')).kind, 'RETRY');
  response = json({ name: 'invalid_idempotent_request' }, 409); assert.equal((await send(message, 'comground-test')).kind, 'PERMANENT');
  response = json({}, 429, { 'retry-after': '90' }); assert.deepEqual(await send(message, 'comground-test'), { kind: 'RETRY', reason: 'PROVIDER_RETRYABLE', retryAfterSeconds: 90 });
});
test('ambiguous, oversized, malformed and network-failed provider replies never become accepted', async () => {
  const environment = config(), message: NotificationMessage = { from: environment.from!, to: ['adult@example.invalid'], subject: 'Test', text: 'Test' };
  for (const response of [json({}), json({ id: '<script>' }), new Response('not-json'), json({ id: 'ok', excessive: 'x'.repeat(20000) })]) assert.deepEqual(await createResendDelivery(() => environment, (async () => response) as typeof fetch)(message, 'idempotent-key'), { kind: 'RETRY', reason: 'DELIVERY_UNCERTAIN' });
  assert.deepEqual(await createResendDelivery(() => environment, (async () => { throw new Error('private provider detail'); }) as typeof fetch)(message, 'idempotent-key'), { kind: 'RETRY', reason: 'DELIVERY_UNCERTAIN' });
});
test('restart retains encrypted queue, preference versions, leases and retry state', () => {
  const directory = mkdtempSync(join(tmpdir(), 'comground-notification-restart-')); let opened: ReturnType<typeof setup> | undefined;
  try {
    const filename = join(directory, 'queue.sqlite'); opened = setup(filename); enable(opened.store); opened.store.enqueueReminder(owner, occurrence, now);
    const lease = opened.store.claim(now)!; opened.store.prepare(lease, now); opened.store.settle(lease, { kind: 'RETRY', reason: 'DELIVERY_UNCERTAIN' }, now);
    const before = opened.store.exportData(owner); opened.db.close(); opened = undefined;
    opened = setup(filename); assert.deepEqual(opened.store.exportData(owner), before); assert.equal(notificationOwner(opened.db, owner).optionalConsentCurrent, true);
  } finally { opened?.db.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('receipt schema migration preserves encrypted jobs, preferences and leases from the earlier outbox schema', () => {
  const { db, store } = setup();
  try {
    enable(store); store.enqueueReminder(owner, occurrence, now); const lease = store.claim(now)!; store.prepare(lease, now);
    const before = store.exportData(owner), encrypted = db.prepare('SELECT envelope,lease_token FROM notification_outbox').get();
    db.exec('DROP TABLE notification_receipt_events; DROP TABLE notification_suppression; DROP INDEX notification_provider_email;');
    for (const column of ['provider_email_id', 'receipt_status', 'receipt_occurred_at', 'receipt_received_at']) db.exec(`ALTER TABLE notification_outbox DROP COLUMN ${column}`);
    initializeNotificationSchema(db); initializeNotificationSchema(db);
    assert.deepEqual(store.exportData(owner), before);
    assert.deepEqual(db.prepare('SELECT envelope,lease_token FROM notification_outbox').get(), encrypted);
    store.settle(lease, { kind: 'ACCEPTED', providerId: 'migrated-provider' }, now);
    assert.equal(store.recordReceipt({ eventId: 'migration-event', providerEmailId: 'migrated-provider', status: 'DELIVERED', occurredAt: now.toISOString() }, now), 'APPLIED');
    assert.equal(store.exportData(owner).outbox[0].receipt?.status, 'DELIVERED');
    store.prune(new Date(now.getTime() + 31 * 86400000));
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM notification_receipt_events').get() as { n: number }).n, 0);
  } finally { db.close(); }
});
