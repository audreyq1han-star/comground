import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createResendDelivery, type NotificationConfiguration } from './notification-delivery.ts';
import { cancelRestoredNotifications, createNotificationStore, enqueueIdentityNotification, initializeNotificationSchema, purgeOwnerNotifications } from './notification-repository.ts';
import { createResendWebhookHandler } from './notification-webhook.ts';
import { runNotificationWorkerOnce } from './notification-worker.ts';

const now = new Date('2031-05-01T12:00:00Z');
const owner = 'account-11111111-1111-4111-8111-111111111111';
const other = 'account-22222222-2222-4222-8222-222222222222';
const email = 'synthetic-recipient@example.invalid';
const providerId = 'synthetic-accepted-provider-id';
const thirtyDays = 30 * 86400000;

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE accounts(id TEXT PRIMARY KEY,email_norm TEXT,role TEXT,email_verified_at TEXT,adult_attested_at TEXT);
    CREATE TABLE student_profiles(persona_id TEXT PRIMARY KEY,profile_json TEXT);
    CREATE TABLE student_privacy(owner TEXT PRIMARY KEY,policy_version TEXT,adult_confirmed INTEGER);
    CREATE TABLE account_action_tokens(token_hash TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,purpose TEXT,expires_at TEXT,used_at TEXT);`);
  for (const id of [owner, other]) {
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?)').run(id, id === owner ? email : 'other@example.invalid', 'STUDENT', now.toISOString(), now.toISOString());
    db.prepare('INSERT INTO student_profiles VALUES(?,?)').run(id, JSON.stringify({ version: 1, consentVersion: 'adult-account-v1', preferences: { ageMin: 18 } }));
    db.prepare('INSERT INTO student_privacy VALUES(?,?,1)').run(id, 'adult-account-v1');
  }
  const config: NotificationConfiguration = { mode: 'production', deliveryEnabled: true, origin: 'https://app.example.invalid', encryptionKey: Buffer.alloc(32, 23).toString('base64'), apiKey: 'synthetic-injected-only', from: 'service@example.invalid', webhookKey: `whsec_${Buffer.alloc(24, 17).toString('base64')}` };
  const store = createNotificationStore(db, { config: () => config, occurrenceAvailable: () => true });
  store.setPreferences(owner, { expectedVersion: 0, expectedProfileVersion: 1, enabled: true }, now);
  const queued = store.enqueueReminder(owner, { opportunityId: 'private-occurrence-reference', occurrenceId: 'primary', opportunityVersion: 1, startsAt: '2031-05-02T10:00:00Z' }, now);
  function withdraw(deleteAccount = false) {
    db.exec('BEGIN');
    purgeOwnerNotifications(db, owner);
    db.prepare('DELETE FROM student_profiles WHERE persona_id=?').run(owner);
    if (deleteAccount) db.prepare('DELETE FROM accounts WHERE id=?').run(owner);
    db.exec('COMMIT');
  }
  function queueRecovery() {
    const token = randomBytes(32).toString('base64url'), expiresAt = '2031-05-01T12:30:00Z';
    db.prepare('INSERT INTO account_action_tokens VALUES(?,?,?,?,NULL)').run(createHash('sha256').update(token).digest('hex'), owner, 'RESET_PASSWORD', expiresAt);
    return enqueueIdentityNotification(db, { purpose: 'RESET_PASSWORD', accountId: owner, email, token, expiresAt }, config, now);
  }
  const delivery = createResendDelivery(() => config, (async () => new Response(JSON.stringify({ id: providerId }), { headers: { 'content-type': 'application/json' } })) as typeof fetch);
  async function receipt(status = 'email.complained', eventId = 'msg_late_complaint', at = now, emailId = providerId) {
    const raw = JSON.stringify({ type: status, created_at: at.toISOString(), data: { email_id: emailId } }), timestamp = String(Math.floor(at.getTime() / 1000));
    const signature = createHmac('sha256', Buffer.from(config.webhookKey!.slice(6), 'base64')).update(`${eventId}.${timestamp}.${raw}`).digest('base64');
    return createResendWebhookHandler({ config: () => config, store: () => store, now: () => at })(new Request('https://app.example.invalid/api/webhooks/resend', { method: 'POST', headers: { host: 'app.example.invalid', 'content-type': 'application/json', 'svix-id': eventId, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` }, body: raw }));
  }
  return { db, store, config, queued, withdraw, queueRecovery, delivery, receipt };
}

test('authenticated late complaints survive profile withdrawal and block subsequent recovery without restoring history', async () => {
  const state = fixture();
  try {
    await runNotificationWorkerOnce(state.store, state.delivery, () => now);
    state.withdraw();
    assert.equal((await state.receipt()).status, 204);
    assert.equal(state.store.exportData(owner).suppression?.reason, 'COMPLAINED');
    assert.deepEqual(state.store.exportData(owner).outbox, []);
    assert.throws(() => state.queueRecovery(), { code: 'NOTIFICATION_RECIPIENT_SUPPRESSED' });
    assert.equal(state.store.exportData(other).suppression, null);
    assert.equal((await state.receipt()).status, 204, 'the replay ledger survives the same withdrawal');
    assert.equal((state.db.prepare('SELECT count(*) AS n FROM notification_receipt_events').get() as { n: number }).n, 1);
  } finally { state.db.close(); }
});

test('provider acceptance settling after profile withdrawal retains receipt association but no deleted history', async () => {
  const state = fixture();
  try {
    await runNotificationWorkerOnce(state.store, async (message, key) => { state.withdraw(); return state.delivery(message, key); }, () => now);
    assert.deepEqual(state.store.exportData(owner).outbox, []);
    assert.equal((await state.receipt('email.bounced')).status, 204);
    assert.equal(state.store.exportData(owner).suppression?.reason, 'BOUNCED');
    assert.throws(() => state.queueRecovery(), { code: 'NOTIFICATION_RECIPIENT_SUPPRESSED' });
  } finally { state.db.close(); }
});

test('account deletion removes accepted and in-flight correlations and late settlement cannot resurrect either', async () => {
  for (const inFlight of [false, true]) {
    const state = fixture();
    try {
      await runNotificationWorkerOnce(state.store, async (message, key) => { if (inFlight) state.withdraw(true); return state.delivery(message, key); }, () => now);
      if (!inFlight) state.withdraw(true);
      assert.equal((await state.receipt()).status, 503);
      assert.equal((state.db.prepare('SELECT count(*) AS n FROM notification_receipt_correlations').get() as { n: number }).n, 0);
      assert.equal(state.store.exportData(owner).suppression, null);
    } finally { state.db.close(); }
  }
});

test('profile withdrawal retains only minimal receipt association and owner-scoped export aggregates', async () => {
  const state = fixture();
  try {
    await runNotificationWorkerOnce(state.store, state.delivery, () => now);
    state.withdraw();
    const retained = state.db.prepare('SELECT * FROM notification_receipt_correlations').get()!;
    assert.deepEqual(Object.keys(retained).sort(), ['account_id', 'expires_at', 'lease_token', 'outbox_id', 'provider_email_id']);
    assert.equal(retained.lease_token, null, 'completed dispatch no longer retains a lease capability');
    const exported = state.store.exportData(owner, now), serialized = JSON.stringify(exported);
    assert.deepEqual(exported.retainedReceiptCorrelations, { count: 1, latestExpiresAt: new Date(now.getTime() + thirtyDays).toISOString() });
    assert.deepEqual(state.store.exportData(other, now).retainedReceiptCorrelations, { count: 0, latestExpiresAt: null });
    for (const privateValue of [providerId, state.queued.id, email, owner, 'private-occurrence-reference', 'lease_token', 'envelope']) {
      assert.equal(serialized.includes(privateValue), false);
      assert.equal(JSON.stringify(state.store.summary(now)).includes(privateValue), false);
    }
    assert.equal(JSON.stringify(retained).includes(email), false);
    assert.equal(JSON.stringify(retained).includes('private-occurrence-reference'), false);
  } finally { state.db.close(); }
});

test('correlations and replay events expire after thirty days without receipt activity extending retention or removing suppression', async () => {
  const state = fixture();
  try {
    await runNotificationWorkerOnce(state.store, state.delivery, () => now);
    state.withdraw();
    const beforeExpiry = new Date(now.getTime() + thirtyDays - 1000), expiry = new Date(now.getTime() + thirtyDays);
    assert.equal((await state.receipt('email.bounced', 'msg_before_expiry', beforeExpiry)).status, 204);
    assert.equal(state.store.exportData(owner, beforeExpiry).retainedReceiptCorrelations.latestExpiresAt, expiry.toISOString());
    assert.equal((await state.receipt('email.complained', 'msg_after_expiry', expiry)).status, 503, 'expiry is enforced even before maintenance');
    assert.deepEqual(state.store.exportData(owner, expiry).retainedReceiptCorrelations, { count: 0, latestExpiresAt: null });
    state.store.prune(expiry);
    initializeNotificationSchema(state.db);
    for (const table of ['notification_receipt_correlations', 'notification_receipt_events']) assert.equal((state.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n, 0);
    assert.equal(state.store.exportData(owner, expiry).suppression?.reason, 'BOUNCED');
    assert.throws(() => state.queueRecovery(), { code: 'NOTIFICATION_RECIPIENT_SUPPRESSED' });
  } finally { state.db.close(); }
});

test('expired in-flight correlation cannot be resurrected by late acceptance after withdrawal', async () => {
  const state = fixture();
  try {
    const lease = state.store.claim(now)!; state.store.prepare(lease, now); state.withdraw();
    const expiry = new Date(now.getTime() + thirtyDays);
    state.store.settle(lease, { kind: 'ACCEPTED', providerId }, expiry);
    assert.equal((await state.receipt('email.complained', 'msg_too_late', expiry)).status, 503);
    state.store.prune(expiry);
    assert.equal((state.db.prepare('SELECT count(*) AS n FROM notification_receipt_correlations').get() as { n: number }).n, 0);
  } finally { state.db.close(); }
});

test('delayed acceptance cannot extend the original thirty-day correlation deadline', async () => {
  const state = fixture();
  try {
    const lease = state.store.claim(now)!; state.store.prepare(lease, now); state.withdraw();
    const later = new Date(now.getTime() + 10000), expiry = new Date(now.getTime() + thirtyDays);
    state.store.settle(lease, { kind: 'ACCEPTED', providerId }, later);
    assert.equal(state.store.exportData(owner, later).retainedReceiptCorrelations.latestExpiresAt, expiry.toISOString());
    assert.equal((await state.receipt('email.bounced', 'msg_delayed_acceptance', later)).status, 204);
  } finally { state.db.close(); }
});

test('lease reclamation fences stale settlement even when profile withdrawal deletes the outbox', async () => {
  const state = fixture();
  try {
    const first = state.store.claim(now)!; state.store.prepare(first, now);
    const later = new Date(now.getTime() + 60001), second = state.store.claim(later)!;
    state.store.prepare(second, later); state.withdraw();
    state.store.settle(first, { kind: 'ACCEPTED', providerId: 'stale-provider' }, later);
    assert.equal((await state.receipt('email.bounced', 'msg_stale', later, 'stale-provider')).status, 503);
    state.store.settle(second, { kind: 'ACCEPTED', providerId }, later);
    assert.equal((await state.receipt('email.bounced', 'msg_current', later)).status, 204);
    assert.deepEqual(state.store.exportData(owner, later).outbox, []);
  } finally { state.db.close(); }
});

test('restore retains accepted receipt correlation but invalidates unresolved dispatch capabilities', async () => {
  for (const accepted of [false, true]) {
    const state = fixture();
    try {
      const lease = state.store.claim(now)!; state.store.prepare(lease, now);
      if (accepted) state.store.settle(lease, { kind: 'ACCEPTED', providerId }, now);
      state.withdraw();
      cancelRestoredNotifications(state.db, now);
      state.store.settle(lease, { kind: 'ACCEPTED', providerId }, now);
      assert.equal((await state.receipt()).status, accepted ? 204 : 503);
      assert.equal(state.store.exportData(owner, now).retainedReceiptCorrelations.count, accepted ? 1 : 0);
    } finally { state.db.close(); }
  }
});

test('migration preserves accepted IDs and existing replay events atomically and is repeatable inside an outer transaction', async () => {
  const state = fixture();
  try {
    await runNotificationWorkerOnce(state.store, state.delivery, () => now);
    assert.equal((await state.receipt('email.delivered', 'msg_before_migration')).status, 204);
    // Reconstruct the exact previous parent relationship with a real stored receipt.
    state.db.exec(`DROP TABLE notification_receipt_events; DROP TABLE notification_receipt_correlations;
      CREATE TABLE notification_receipt_events(event_id TEXT PRIMARY KEY,outbox_id TEXT NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,status TEXT NOT NULL CHECK(status IN ('DELIVERED','FAILED','BOUNCED','COMPLAINED')),occurred_at TEXT NOT NULL,received_at TEXT NOT NULL);
      CREATE INDEX notification_receipt_outbox ON notification_receipt_events(outbox_id);`);
    state.db.prepare("INSERT INTO notification_receipt_events VALUES(?,?,'DELIVERED',?,?)").run('msg_before_migration', state.queued.id, now.toISOString(), now.toISOString());
    state.db.exec('BEGIN'); initializeNotificationSchema(state.db); state.db.exec('ROLLBACK');
    assert.equal((state.db.prepare('PRAGMA foreign_key_list(notification_receipt_events)').get() as { table: string }).table, 'notification_outbox');
    assert.equal(state.db.prepare("SELECT 1 FROM sqlite_master WHERE name='notification_receipt_correlations'").get(), undefined);
    initializeNotificationSchema(state.db); initializeNotificationSchema(state.db);
    assert.equal((state.db.prepare('PRAGMA foreign_key_list(notification_receipt_events)').get() as { table: string }).table, 'notification_receipt_correlations');
    assert.deepEqual(state.db.prepare('PRAGMA foreign_key_check').all(), []);
    state.withdraw();
    assert.equal((await state.receipt('email.delivered', 'msg_before_migration')).status, 204);
    assert.equal((state.db.prepare('SELECT count(*) AS n FROM notification_receipt_events').get() as { n: number }).n, 1);
    assert.equal((await state.receipt()).status, 204);
    assert.equal(state.store.exportData(owner).suppression?.reason, 'COMPLAINED');
  } finally { state.db.close(); }
});

test('migration retains an already-started lease so acceptance can settle after a later profile withdrawal', async () => {
  const state = fixture();
  try {
    const lease = state.store.claim(now)!; state.store.prepare(lease, now);
    state.db.exec('DROP TABLE notification_receipt_events; DROP TABLE notification_receipt_correlations;');
    initializeNotificationSchema(state.db); state.withdraw();
    state.store.settle(lease, { kind: 'ACCEPTED', providerId }, now);
    assert.equal((await state.receipt()).status, 204);
    assert.equal(state.store.exportData(owner).suppression?.reason, 'COMPLAINED');
  } finally { state.db.close(); }
});
