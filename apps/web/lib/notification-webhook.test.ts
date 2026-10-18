import test from 'node:test';
import assert from 'node:assert/strict';
import crypto, { createHash, createHmac, randomBytes } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNotificationStore, enqueueIdentityNotification } from './notification-repository.ts';
import { createResendDelivery, type NotificationConfiguration } from './notification-delivery.ts';
import { runNotificationWorkerOnce } from './notification-worker.ts';
import { createResendWebhookHandler, verifyNotificationSignature, verifyResendWebhook } from './notification-webhook.ts';

// Independent synthetic protocol fixtures. No real credential or transport is used.
// https://docs.svix.com/receiving/verifying-payloads/how-manual
const now = new Date('2031-05-01T12:00:00Z');
const owner = 'account-11111111-1111-4111-8111-111111111111';
const other = 'account-22222222-2222-4222-8222-222222222222';
const webhookKey = `whsec_${Buffer.alloc(24, 17).toString('base64')}`;
const encryptionKey = Buffer.alloc(32, 23).toString('base64');
const providerEmailId = 'a5aa132d-d5fb-4b79-8469-a0cadd235fcd';
const privateMarker = 'SYNTHETIC_PRIVATE_WEBHOOK_DETAIL';

function signature(raw: string, id: string, timestamp: string, key = webhookKey): string {
  return `v1,${createHmac('sha256', Buffer.from(key.slice(6), 'base64')).update(`${id}.${timestamp}.${raw}`).digest('base64')}`;
}
function signedRequest(raw: string, { id = 'msg_synthetic_event', timestamp = String(now.getTime() / 1000), key = webhookKey, headers = {} }: { id?: string; timestamp?: string; key?: string; headers?: Record<string, string> } = {}): Request {
  return new Request('https://app.example.invalid/api/webhooks/resend', { method: 'POST', headers: { host: 'app.example.invalid', 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature(raw, id, timestamp, key), ...headers }, body: raw });
}
function receipt(type = 'email.delivered', emailId = providerEmailId, createdAt = now.toISOString()): string {
  return JSON.stringify({ type, created_at: createdAt, data: { email_id: emailId, created_at: createdAt, from: 'service@example.invalid', to: ['synthetic-recipient@example.invalid'], subject: privateMarker, bounce: { message: privateMarker }, html: `<p>${privateMarker}</p>` } });
}
function fixture(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE accounts(id TEXT PRIMARY KEY,email_norm TEXT,role TEXT,email_verified_at TEXT,adult_attested_at TEXT);
    CREATE TABLE student_profiles(persona_id TEXT PRIMARY KEY,profile_json TEXT);
    CREATE TABLE student_privacy(owner TEXT PRIMARY KEY,policy_version TEXT,adult_confirmed INTEGER);
    CREATE TABLE account_action_tokens(token_hash TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,purpose TEXT,expires_at TEXT,used_at TEXT);`);
  for (const id of [owner, other]) {
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?)').run(id, id === owner ? 'synthetic-recipient@example.invalid' : 'other-recipient@example.invalid', 'STUDENT', now.toISOString(), now.toISOString());
    db.prepare('INSERT INTO student_profiles VALUES(?,?)').run(id, JSON.stringify({ version: 1, consentVersion: 'adult-account-v1', preferences: { ageMin: 18 } }));
    db.prepare('INSERT INTO student_privacy VALUES(?,?,1)').run(id, 'adult-account-v1');
  }
  const config: NotificationConfiguration = { mode: 'production', deliveryEnabled: true, origin: 'https://app.example.invalid', encryptionKey, apiKey: 'synthetic-injected-test-only', from: 'service@example.invalid', webhookKey };
  const store = createNotificationStore(db, { config: () => config, occurrenceAvailable: () => true });
  function queueReminder(id = owner, opportunityId = 'synthetic-event') {
    const preferences = store.preferences(id);
    if (!preferences.enabled) store.setPreferences(id, { expectedVersion: preferences.version, expectedProfileVersion: 1, enabled: true }, now);
    return store.enqueueReminder(id, { opportunityId, occurrenceId: 'primary', opportunityVersion: 1, startsAt: '2031-05-02T10:00:00Z' }, now);
  }
  function queueAccount(id = owner) {
    const token = randomBytes(32).toString('base64url'), expiresAt = '2031-05-01T12:30:00Z';
    db.prepare('INSERT INTO account_action_tokens VALUES(?,?,?,?,NULL)').run(createHash('sha256').update(token).digest('hex'), id, 'RESET_PASSWORD', expiresAt);
    return enqueueIdentityNotification(db, { purpose: 'RESET_PASSWORD', accountId: id, email: id === owner ? 'synthetic-recipient@example.invalid' : 'other-recipient@example.invalid', token, expiresAt }, config, now);
  }
  async function acceptQueued(emailId = providerEmailId) {
    let calls = 0;
    const delivery = createResendDelivery(() => config, (async () => { calls += 1; return new Response(JSON.stringify({ id: emailId }), { headers: { 'content-type': 'application/json' } }); }) as typeof fetch);
    await runNotificationWorkerOnce(store, delivery, () => now);
    assert.equal(calls, 1, 'receipt association starts with an actual adapter return through an injected HTTP transport');
  }
  return { db, store, config, queueReminder, queueAccount, acceptQueued };
}

const bytes = (raw: string) => new TextEncoder().encode(raw);
const oneSecondLater = () => new Date(now.getTime() + 1000);
function handler(state: ReturnType<typeof fixture>, clock = () => now) {
  return createResendWebhookHandler({ config: () => state.config, store: () => state.store, now: clock });
}
function rows(db: DatabaseSync, table: 'notification_receipt_events' | 'notification_suppression') {
  return db.prepare(`SELECT * FROM ${table}`).all();
}

test('Svix verification follows the published vector and authenticates exact raw bytes, ID and timestamp', () => {
  // Public Svix manual-verification vector, using its historical clock only in this test.
  const vector = '{"event_type":"ping","data":{"success":true}}';
  assert.equal(verifyNotificationSignature(bytes(vector), new Headers({ 'svix-id': 'msg_loFOjxBNrRLzqYUf', 'svix-timestamp': '1731705121', 'svix-signature': 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=' }), 'whsec_plJ3nmyCDGBKInavdOK15jsl', new Date(1731705121000)), 'msg_loFOjxBNrRLzqYUf');
  const raw = receipt().replace(privateMarker, 'Synthetic café 🥕').replace('{', '{\n  ');
  const request = signedRequest(raw), parsed = verifyResendWebhook(bytes(raw), request.headers, webhookKey, now);
  assert.deepEqual(parsed, { eventId: 'msg_synthetic_event', providerEmailId, status: 'DELIVERED', occurredAt: now.toISOString() });
  for (const changed of [raw + ' ', JSON.stringify(JSON.parse(raw)), raw.replace('café', 'cafe')]) assert.throws(() => verifyResendWebhook(bytes(changed), request.headers, webhookKey, now));
  for (const [name, value] of [['svix-id', 'msg_different'], ['svix-timestamp', String(now.getTime() / 1000 + 1)]] as const) {
    const headers = new Headers(request.headers); headers.set(name, value);
    assert.throws(() => verifyResendWebhook(bytes(raw), headers, webhookKey, now));
  }
  assert.throws(() => verifyResendWebhook(bytes(raw), request.headers, `whsec_${Buffer.alloc(24, 99).toString('base64')}`, now));
  const unpadded = `whsec_${Buffer.alloc(17, 11).toString('base64').replace(/=+$/, '')}`;
  assert.equal(verifyResendWebhook(bytes(raw), signedRequest(raw, { key: unpadded }).headers, unpadded, now)?.status, 'DELIVERED');
});

test('valid signatures use fixed-length constant-time comparison and support signature rotation', context => {
  const raw = receipt(), request = signedRequest(raw), original = crypto.timingSafeEqual;
  const comparisons: number[][] = [];
  const spy = context.mock.method(crypto, 'timingSafeEqual', (left: Uint8Array, right: Uint8Array) => { comparisons.push([left.byteLength, right.byteLength]); return original(left, right); });
  syncBuiltinESMExports();
  try {
    const headers = new Headers(request.headers);
    headers.set('svix-signature', `v2,ignored v1,${Buffer.alloc(32, 1).toString('base64')} ${request.headers.get('svix-signature')}`);
    assert.equal(verifyResendWebhook(bytes(raw), headers, webhookKey, now)?.status, 'DELIVERED');
    assert.ok(comparisons.length >= 1, 'the verifier must invoke the platform constant-time primitive');
    assert.ok(comparisons.every(pair => pair[0] === 32 && pair[1] === 32));
    assert.throws(() => verifyResendWebhook(bytes(raw), new Headers({ ...Object.fromEntries(request.headers), 'svix-signature': 'v1,AA==' }), webhookKey, now));
  } finally { spy.mock.restore(); syncBuiltinESMExports(); }
});

test('timestamp boundaries, malformed headers and missing keys fail closed', () => {
  const raw = receipt(), seconds = now.getTime() / 1000;
  for (const offset of [-300, 300]) assert.equal(verifyResendWebhook(bytes(raw), signedRequest(raw, { timestamp: String(seconds + offset) }).headers, webhookKey, now)?.status, 'DELIVERED');
  for (const timestamp of [String(seconds - 301), String(seconds + 301), 'NaN', `${seconds}.0`, '0', `${seconds},${seconds}`]) assert.throws(() => verifyResendWebhook(bytes(raw), signedRequest(raw, { timestamp }).headers, webhookKey, now));
  for (const name of ['svix-id', 'svix-timestamp', 'svix-signature']) {
    const headers = new Headers(signedRequest(raw).headers); headers.delete(name);
    assert.throws(() => verifyResendWebhook(bytes(raw), headers, webhookKey, now));
  }
  for (const secret of [null, '', 'whsec_', 'not-a-secret', `whsec_${'!'.repeat(32)}`]) assert.throws(() => verifyResendWebhook(bytes(raw), signedRequest(raw).headers, secret, now));
  const headers = new Headers(signedRequest(raw).headers); headers.append('svix-id', 'msg_conflicting');
  assert.throws(() => verifyResendWebhook(bytes(raw), headers, webhookKey, now));
  headers.set('svix-id', 'msg_synthetic_event'); headers.set('svix-signature', Array(9).fill(signedRequest(raw).headers.get('svix-signature')).join(' '));
  assert.throws(() => verifyResendWebhook(bytes(raw), headers, webhookKey, now));
});

test('HTTP guard verifies signatures and bounds actual bytes before opening receipt storage', async () => {
  const state = fixture(); let stores = 0;
  const endpoint = createResendWebhookHandler({ config: () => state.config, store: () => { stores += 1; return state.store; }, now: () => now });
  try {
    const raw = receipt();
    const wrongKey = await endpoint(signedRequest(raw, { key: `whsec_${Buffer.alloc(24, 2).toString('base64')}` }));
    assert.ok(wrongKey.status >= 400 && wrongKey.status < 500); assert.equal(stores, 0);
    const oversized = receipt().replace(privateMarker, 'x'.repeat(33 * 1024));
    const tooLarge = await endpoint(signedRequest(oversized, { headers: { 'content-length': '8' } }));
    assert.equal(tooLarge.status, 413); assert.equal(stores, 0, 'a false short Content-Length cannot bypass the stream bound');
    const malformed = await endpoint(signedRequest('{not valid JSON'));
    assert.ok(malformed.status >= 400 && malformed.status < 500); assert.equal(stores, 0);
    for (const invalid of [JSON.stringify({ type: 'email.delivered', created_at: now.toISOString(), data: {} }), receipt().replace(providerEmailId, '<invalid>'), receipt('email.delivered', providerEmailId, 'invalid-date')]) {
      const result = await endpoint(signedRequest(invalid));
      assert.ok(result.status >= 400 && result.status < 500); assert.equal(stores, 0);
    }
    const foreignHost = signedRequest(raw, { headers: { host: 'attacker.example.invalid' } });
    assert.equal((await endpoint(foreignHost)).status, 403); assert.equal(stores, 0);
    for (const mode of ['demo', 'test'] as const) { state.config.mode = mode; const response = await endpoint(signedRequest(raw)); assert.ok(response.status >= 400); assert.equal(stores, 0); }
    state.config.mode = 'production'; state.config.webhookKey = null;
    assert.ok((await endpoint(signedRequest(raw))).status >= 400); assert.equal(stores, 0);
    for (const response of [wrongKey, tooLarge, malformed]) { const text = await response.text(); assert.equal(text.includes(privateMarker), false); assert.equal(text.includes(webhookKey), false); }
  } finally { state.db.close(); }
});

test('only allowlisted receipt types reach storage; delivery state requires actual adapter-returned email identity', async () => {
  const state = fixture();
  try {
    const queued = state.queueReminder(); const endpoint = handler(state);
    const early = await endpoint(signedRequest(receipt(), { id: 'msg_early' }));
    assert.equal(early.status, 503); assert.equal(rows(state.db, 'notification_receipt_events').length, 0);
    await state.acceptQueued();
    const unrelated = await endpoint(signedRequest(receipt('email.delivered', queued.id), { id: 'msg_wrong_id' }));
    assert.equal(unrelated.status, 503, 'an internal outbox ID is not a provider email ID');
    for (const type of ['email.opened', 'email.clicked', 'email.sent', 'domain.updated', 'suppression.removed', 'arbitrary']) {
      assert.equal((await endpoint(signedRequest(receipt(type), { id: `msg_${type.replaceAll('.', '_')}` }))).status, 204);
    }
    assert.equal(rows(state.db, 'notification_receipt_events').length, 0);
    assert.equal((await endpoint(signedRequest(receipt(), { id: 'msg_early' }))).status, 204);
    const exported = state.store.exportData(owner).outbox.find(item => item.id === queued.id)!;
    assert.equal(exported.state, 'ACCEPTED');
    assert.deepEqual(exported.receipt, { status: 'DELIVERED', occurredAt: now.toISOString(), receivedAt: now.toISOString() });
    assert.equal(rows(state.db, 'notification_receipt_events').length, 1);
  } finally { state.db.close(); }
});

test('duplicate event IDs do not replay or regress state; receipt severity is monotonic across reordered callbacks', async () => {
  const state = fixture();
  try {
    state.queueReminder(); await state.acceptQueued(); const endpoint = handler(state);
    assert.equal((await endpoint(signedRequest(receipt(), { id: 'msg_duplicate' }))).status, 204);
    assert.equal((await endpoint(signedRequest(receipt(), { id: 'msg_duplicate' }))).status, 204);
    assert.equal((await endpoint(signedRequest(receipt('email.complained'), { id: 'msg_duplicate' }))).status, 409);
    assert.equal(rows(state.db, 'notification_receipt_events').length, 1); assert.equal(rows(state.db, 'notification_suppression').length, 0);
    for (const [type, id] of [['email.failed', 'msg_failed'], ['email.bounced', 'msg_bounced'], ['email.complained', 'msg_complained'], ['email.delivered', 'msg_delivered_late']] as const) assert.equal((await endpoint(signedRequest(receipt(type), { id }))).status, 204);
    assert.equal(state.store.exportData(owner).outbox[0].receipt?.status, 'COMPLAINED');
    assert.equal(rows(state.db, 'notification_receipt_events').length, 5);
  } finally { state.db.close(); }
});

test('unknown and deleted owners are not recreated and do not accumulate unassociated provider payloads', async () => {
  const state = fixture();
  try {
    state.queueReminder(); await state.acceptQueued(); const endpoint = handler(state);
    assert.equal((await endpoint(signedRequest(receipt('email.bounced', 'unknown-provider-id'), { id: 'msg_unknown' }))).status, 503);
    assert.equal(rows(state.db, 'notification_receipt_events').length, 0); assert.equal(rows(state.db, 'notification_suppression').length, 0);
    state.db.prepare('DELETE FROM accounts WHERE id=?').run(owner);
    assert.equal((await endpoint(signedRequest(receipt('email.complained'), { id: 'msg_deleted' }))).status, 503);
    assert.equal(rows(state.db, 'notification_receipt_events').length, 0); assert.equal(rows(state.db, 'notification_suppression').length, 0);
    assert.equal(state.db.prepare('SELECT 1 FROM accounts WHERE id=?').get(owner), undefined);
  } finally { state.db.close(); }
});

test('bounce and complaint suppress all remaining optional and transactional sends for only the associated owner', async () => {
  for (const type of ['email.bounced', 'email.complained']) {
    const state = fixture();
    try {
      const accepted = state.queueReminder(); await state.acceptQueued();
      const pendingReminder = state.queueReminder(owner, 'second-event'), pendingAccount = state.queueAccount(), unrelated = state.queueAccount(other);
      // The signed provider email ID controls association, never an address in the payload.
      assert.equal((await handler(state)(signedRequest(receipt(type).replace('synthetic-recipient@example.invalid', 'other-recipient@example.invalid')))).status, 204);
      for (const id of [pendingReminder.id, pendingAccount.id]) {
        const record = state.store.exportData(owner).outbox.find(item => item.id === id)!;
        assert.equal(record.state, 'CANCELLED');
        assert.equal((state.db.prepare('SELECT envelope FROM notification_outbox WHERE id=?').get(id) as { envelope: null }).envelope, null);
      }
      assert.equal(state.store.exportData(owner).outbox.find(item => item.id === accepted.id)?.state, 'ACCEPTED');
      assert.equal(state.store.exportData(other).outbox.find(item => item.id === unrelated.id)?.state, 'QUEUED');
      assert.equal(rows(state.db, 'notification_suppression').length, 1);
      let calls = 0;
      await runNotificationWorkerOnce(state.store, async () => { calls += 1; return { kind: 'ACCEPTED', providerId: 'other-owner-provider-id' }; }, oneSecondLater);
      assert.equal(calls, 1, 'only the unrelated owner remains dispatchable');
      await runNotificationWorkerOnce(state.store, async () => { calls += 1; return { kind: 'ACCEPTED', providerId: 'must-not-send' }; }, oneSecondLater);
      assert.equal(calls, 1);
      assert.throws(() => state.queueReminder(owner, 'new-event'), { code: 'NOTIFICATION_RECIPIENT_SUPPRESSED', status: 409 });
      assert.throws(() => state.queueAccount(), { code: 'NOTIFICATION_RECIPIENT_SUPPRESSED', status: 409 });
    } finally { state.db.close(); }
  }
});

test('receipt ledger and operator DTOs retain no recipient, raw payload, secret or provider diagnostic text', async () => {
  const state = fixture();
  try {
    state.queueReminder(); await state.acceptQueued();
    assert.equal((await handler(state)(signedRequest(receipt('email.complained')))).status, 204);
    const persisted = JSON.stringify({ events: rows(state.db, 'notification_receipt_events'), suppression: rows(state.db, 'notification_suppression'), outbox: state.db.prepare('SELECT * FROM notification_outbox').all() });
    const publicOperator = JSON.stringify(state.store.summary(now));
    for (const secret of [privateMarker, 'synthetic-recipient@example.invalid', 'service@example.invalid', webhookKey, encryptionKey, '<p>']) { assert.equal(persisted.includes(secret), false); assert.equal(publicOperator.includes(secret), false); }
    assert.equal(publicOperator.includes(owner), false); assert.equal(publicOperator.includes(providerEmailId), false);
    assert.equal(rows(state.db, 'notification_receipt_events').length, 1);
  } finally { state.db.close(); }
});

test('receipt replay protection persists across a database restart', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'comground-webhook-replay-')), filename = join(folder, 'test.sqlite');
  let db: DatabaseSync | undefined;
  try {
    const state = fixture(filename); db = state.db;
    state.queueReminder(); await state.acceptQueued();
    const raw = receipt('email.complained');
    assert.equal((await handler(state)(signedRequest(raw, { id: 'msg_durable' }))).status, 204);
    const before = JSON.stringify(state.store.exportData(owner));
    db.close(); db = new DatabaseSync(filename); db.exec('PRAGMA foreign_keys=ON;');
    const store = createNotificationStore(db, { config: () => state.config, occurrenceAvailable: () => true });
    const endpoint = createResendWebhookHandler({ config: () => state.config, store: () => store, now: oneSecondLater });
    assert.equal((await endpoint(signedRequest(raw, { id: 'msg_durable' }))).status, 204);
    assert.equal(JSON.stringify(store.exportData(owner)), before);
    assert.equal(rows(db, 'notification_receipt_events').length, 1); assert.equal(rows(db, 'notification_suppression').length, 1);
  } finally { db?.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('suppression survives profile withdrawal and cascades only when the owning account is deleted', async () => {
  const state = fixture();
  try {
    state.queueReminder(); await state.acceptQueued();
    assert.equal((await handler(state)(signedRequest(receipt('email.bounced')))).status, 204);
    state.db.prepare('DELETE FROM student_profiles WHERE persona_id=?').run(owner);
    assert.equal(rows(state.db, 'notification_suppression').length, 1);
    assert.throws(() => state.queueAccount(), { code: 'NOTIFICATION_RECIPIENT_SUPPRESSED' });
    state.db.prepare('DELETE FROM accounts WHERE id=?').run(owner);
    assert.equal(rows(state.db, 'notification_receipt_events').length, 0); assert.equal(rows(state.db, 'notification_suppression').length, 0);
    assert.ok(state.db.prepare('SELECT 1 FROM accounts WHERE id=?').get(other));
  } finally { state.db.close(); }
});
