import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { StudentMatches } from '../../../packages/domain/app-contracts.ts';
import { fixtureList } from '../../../packages/domain/fixtures.ts';
import { cancelRestoredDistribution, createDistributionStore, type DistributionStore } from './distribution-repository.ts';
import { createNotificationStore, initializeNotificationSchema, notificationOwner, enqueueIdentityNotification } from './notification-repository.ts';
import { decryptNotification } from './notification-crypto.ts';
import type { NotificationConfiguration } from './notification-delivery.ts';
import { runNotificationWorkerOnce } from './notification-worker.ts';

const now = new Date('2031-05-01T09:00:00Z'), owner = 'account-11111111-1111-4111-8111-111111111111', key = Buffer.alloc(32, 41).toString('base64');
function fixture() {
  const db = new DatabaseSync(':memory:'); db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE accounts(id TEXT PRIMARY KEY,email_norm TEXT,role TEXT,email_verified_at TEXT,adult_attested_at TEXT);
    CREATE TABLE student_profiles(persona_id TEXT PRIMARY KEY,profile_json TEXT);
    CREATE TABLE student_privacy(owner TEXT PRIMARY KEY,policy_version TEXT,adult_confirmed INTEGER);
    CREATE TABLE account_age(account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,age_band TEXT,synthetic INTEGER,attested_at TEXT);`);
  db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?)').run(owner, 'synthetic@example.invalid', 'STUDENT', now.toISOString(), now.toISOString());
  db.prepare('INSERT INTO student_profiles VALUES(?,?)').run(owner, JSON.stringify({ version: 1, consentVersion: 'adult-account-v1', preferences: { ageMin: 18 } }));
  db.prepare('INSERT INTO student_privacy VALUES(?,?,1)').run(owner, 'adult-account-v1');
  db.prepare('INSERT INTO account_age VALUES(?,?,0,?)').run(owner, 'ADULT', now.toISOString());
  const state = { available: true, version: 1, startsAt: '2031-05-02T12:00:00Z' };
  const config: NotificationConfiguration = { mode: 'production', deliveryEnabled: true, origin: 'https://app.example.invalid', encryptionKey: key, apiKey: 'synthetic-test-key', from: 'service@example.invalid' };
  let distribution: DistributionStore;
  const notification = createNotificationStore(db, { config: () => config, occurrenceAvailable: () => true, digestCurrent: (id, ref, at) => distribution.dispatchCurrent(id, ref, at) });
  distribution = createDistributionStore(db, {
    owner: id => { const value = notificationOwner(db, id); return { exists: value.exists, profileVersion: value.profileVersion, externalEligible: value.adult && value.verified && value.student && value.optionalConsentCurrent }; },
    matches: () => ({ data: state.available ? [{ opportunity: { ...fixtureList(now)[0].record, id: 'public-date', version: state.version, title: 'Public fictional garden', startsAt: state.startsAt, endsAt: '2031-05-02T14:00:00Z', timezone: 'UTC' }, eligibility: { status: 'ELIGIBLE', reasons: ['private age and preferences'], reasonCodes: [] }, reasons: ['private saved preferences'], rankScore: 1 }] : [], profileVersion: 1, eligibleCount: 1, engine: 'DETERMINISTIC_RULES', preferences: { private: 'sensitive' } } as unknown as StudentMatches),
    enqueue: (id, ref, at) => notification.enqueueDigest(id, ref, at),
  });
  const enable = () => distribution.setSubscription(owner, { enabled: true, expectedVersion: distribution.subscription(owner).version, expectedProfileVersion: 1 }, now);
  const approve = () => { enable(); const draft = distribution.prepareBatch({ label: 'Synthetic review batch' }, 'demo-reviewer', now); return distribution.updateBatch(draft.id, { action: 'APPROVE', expectedVersion: 1 }, 'demo-reviewer', now); };
  const queue = () => { const batch = approve(); distribution.updateBatch(batch.id, { action: 'DISPATCH', expectedVersion: batch.version }, 'demo-reviewer', now); return batch; };
  return { db, config, state, notification, distribution, approve, queue };
}
test('approved digest queues independently of reminders and sends only a generic sign-in message through injected transport', async () => {
  const f = fixture(); try {
    assert.equal(f.notification.preferences(owner).enabled, false); const batch = f.queue();
    const item = f.notification.exportData(owner).outbox[0]; assert.equal(item.purpose, 'DIGEST'); assert.equal(item.opportunityId, null);
    const row = f.db.prepare('SELECT envelope,reference_json,expires_at FROM notification_outbox WHERE id=?').get(item.id) as { envelope: string; reference_json: string; expires_at: string };
    assert.equal(Date.parse(row.expires_at) - now.getTime(), 86400000);
    const payload = decryptNotification<{ text: string }>(row.envelope, item.id, key);
    assert.ok(payload.text.includes('https://app.example.invalid/digest'));
    for (const fact of ['public-date', 'Public fictional garden', '2031-05-02', 'private', 'sensitive']) assert.equal(payload.text.includes(fact), false);
    const reference = JSON.parse(row.reference_json);
    assert.equal(f.notification.enqueueDigest(owner, reference, now).id, item.id);
    assert.equal(f.notification.exportData(owner).outbox.length, 1);
    assert.equal(f.distribution.batch(batch.id).audit.at(-1)?.action, 'QUEUE_ATTEMPT');
    let calls = 0;
    const result = await runNotificationWorkerOnce(f.notification, async () => { calls++; return { kind: 'ACCEPTED', providerId: 'synthetic-digest-accepted' }; }, () => now);
    assert.equal(result.dispatched, true); assert.equal(calls, 1);
    assert.equal(f.notification.exportData(owner).outbox[0].state, 'ACCEPTED');
  } finally { f.db.close(); }
});
test('digest dispatch rechecks withdrawal, cancellation, publication, dates, profile and real account age after claim', () => {
  for (const mutation of ['withdraw', 'cancel', 'unpublish', 'date', 'profile', 'teen'] as const) {
    const f = fixture(); try {
      const batch = f.queue(), lease = f.notification.claim(now)!; assert.ok(lease);
      if (mutation === 'withdraw') { f.distribution.setSubscription(owner, { enabled: false, expectedVersion: 1, expectedProfileVersion: 1 }, now); f.distribution.setSubscription(owner, { enabled: true, expectedVersion: 2, expectedProfileVersion: 1 }, now); }
      if (mutation === 'cancel') f.distribution.updateBatch(batch.id, { action: 'CANCEL', expectedVersion: batch.version }, 'demo-reviewer', now);
      if (mutation === 'unpublish') f.state.available = false;
      if (mutation === 'date') f.state.startsAt = '2031-05-02T13:00:00Z';
      if (mutation === 'profile') f.db.prepare('UPDATE student_profiles SET profile_json=? WHERE persona_id=?').run(JSON.stringify({ version: 2, consentVersion: 'adult-account-v1', preferences: { ageMin: 18 } }), owner);
      if (mutation === 'teen') f.db.prepare("UPDATE account_age SET age_band='TEEN_13_17',synthetic=1 WHERE account_id=?").run(owner);
      assert.equal(f.notification.prepare(lease, now), null, mutation);
      assert.equal(f.notification.exportData(owner).outbox[0].state, 'CANCELLED', mutation);
    } finally { f.db.close(); }
  }
});
test('digest withdrawal cancels only digest requests and reminder opt-out cannot withdraw digest consent', () => {
  const f = fixture(); try {
    f.notification.setPreferences(owner, { expectedVersion: 0, expectedProfileVersion: 1, enabled: true }, now);
    f.notification.enqueueReminder(owner, { opportunityId: 'public-date', occurrenceId: 'primary', opportunityVersion: 1, startsAt: '2031-05-02T12:00:00Z' }, now);
    f.queue(); f.distribution.setSubscription(owner, { enabled: false, expectedVersion: 1, expectedProfileVersion: 1 }, now);
    const history = f.notification.exportData(owner).outbox;
    assert.equal(history.find(item => item.purpose === 'DIGEST')?.state, 'CANCELLED');
    assert.equal(history.find(item => item.purpose === 'EVENT_REMINDER')?.state, 'QUEUED');
    const second = f.queue();
    f.notification.setPreferences(owner, { expectedVersion: 1, expectedProfileVersion: 1, enabled: false }, now);
    assert.equal(f.distribution.subscription(owner).enabled, true);
    assert.equal(f.distribution.batch(second.id).counts.queued, 1);
    assert.ok(f.notification.exportData(owner).outbox.some(item => item.purpose === 'DIGEST' && item.state === 'QUEUED'));
  } finally { f.db.close(); }
});
test('outbox purpose migration preserves encrypted jobs, leases, receipt ledger, indexes and rollback semantics', () => {
  const f = fixture(); try {
    f.notification.setPreferences(owner, { expectedVersion: 0, expectedProfileVersion: 1, enabled: true }, now);
    f.notification.enqueueReminder(owner, { opportunityId: 'public-date', occurrenceId: 'primary', opportunityVersion: 1, startsAt: '2031-05-02T12:00:00Z' }, now);
    const lease = f.notification.claim(now)!; f.notification.prepare(lease, now);
    // Recreate the previous purpose CHECK while retaining its real row and independent receipt correlation.
    const schema = (f.db.prepare("SELECT sql FROM sqlite_master WHERE name='notification_outbox'").get() as { sql: string }).sql;
    const indexes = f.db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='notification_outbox' AND type='index' AND sql IS NOT NULL").all() as { sql: string }[];
    f.db.exec(schema.replace('notification_outbox', 'notification_outbox_legacy').replace(",'DIGEST'", ''));
    f.db.exec('INSERT INTO notification_outbox_legacy SELECT * FROM notification_outbox; DROP TABLE notification_outbox; ALTER TABLE notification_outbox_legacy RENAME TO notification_outbox;');
    for (const index of indexes) f.db.exec(index.sql);
    f.db.exec('CREATE INDEX notification_test_custom ON notification_outbox(attempts)');
    const before = f.db.prepare('SELECT * FROM notification_outbox').all(), correlations = f.db.prepare('SELECT * FROM notification_receipt_correlations').all();
    f.db.exec('BEGIN'); initializeNotificationSchema(f.db); f.db.exec('ROLLBACK');
    assert.equal((f.db.prepare("SELECT sql FROM sqlite_master WHERE name='notification_outbox'").get() as { sql: string }).sql.includes("'DIGEST'"), false);
    initializeNotificationSchema(f.db); initializeNotificationSchema(f.db);
    assert.deepEqual(f.db.prepare('SELECT * FROM notification_outbox').all(), before);
    assert.deepEqual(f.db.prepare('SELECT * FROM notification_receipt_correlations').all(), correlations);
    assert.ok(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='notification_test_custom'").get());
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
    f.notification.settle(lease, { kind: 'ACCEPTED', providerId: 'preserved-provider-id' }, now);
    f.notification.recordReceipt({ eventId: 'preserved-receipt', providerEmailId: 'preserved-provider-id', status: 'DELIVERED', occurredAt: now.toISOString() }, now);
    f.queue(); assert.ok(f.notification.exportData(owner).outbox.some(item => item.purpose === 'DIGEST'));
  } finally { f.db.close(); }
});
test('teen age records override adult-looking profile and attestation for all outbound messages', () => {
  const f = fixture(); try {
    f.db.prepare("UPDATE account_age SET age_band='TEEN_13_17',synthetic=1 WHERE account_id=?").run(owner);
    assert.equal(notificationOwner(f.db, owner).adult, false);
    assert.throws(() => f.distribution.setSubscription(owner, { enabled: true, expectedVersion: 0, expectedProfileVersion: 1 }, now), { code: 'DIGEST_EXTERNAL_DISABLED' });
    assert.throws(() => enqueueIdentityNotification(f.db, { purpose: 'RESET_PASSWORD', accountId: owner, email: 'synthetic@example.invalid', token: 'a'.repeat(43), expiresAt: '2031-05-01T10:00:00Z' }, f.config, now), { code: 'TEEN_EMAIL_DISABLED' });
  } finally { f.db.close(); }
});
test('restore quarantine revokes digest approvals and subscriptions idempotently', () => {
  const f = fixture(); try {
    const batch = f.queue(); cancelRestoredDistribution(f.db, now);
    const before = f.distribution.batch(batch.id), consent = f.distribution.subscription(owner);
    assert.equal(before.state, 'CANCELLED'); assert.equal(before.counts.prepared, 0); assert.equal(consent.enabled, false);
    assert.equal(before.audit.at(-1)?.actor, 'LOCAL_RESTORE');
    assert.equal(f.notification.exportData(owner).outbox[0].state, 'CANCELLED');
    cancelRestoredDistribution(f.db, new Date(now.getTime() + 1000));
    assert.deepEqual(f.distribution.batch(batch.id), before); assert.deepEqual(f.distribution.subscription(owner), consent);
  } finally { f.db.close(); }
});
