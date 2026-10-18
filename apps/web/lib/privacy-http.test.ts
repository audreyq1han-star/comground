import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AccountId } from '../../../packages/domain/identity-contracts.ts';
import type { Preferences } from '../../../packages/domain/contracts.ts';
import { accounts } from './account-runtime.ts';
import { repository } from './runtime.ts';
import { students } from './student-runtime.ts';
import { postStudentFeedback, putStudentProfile } from './student-handlers.ts';
import { putMeasurementConsent } from './measurement-handlers.ts';

const managedKeys = ['COMGROUND_MODE', 'COMGROUND_ORIGIN', 'COMGROUND_DB_PATH', 'COMGROUND_OUTBOX_KEY', 'COMGROUND_EMAIL_ENABLED', 'COMGROUND_AI_ENABLED', 'COMGROUND_TEST_FIXTURES', 'COMGROUND_SKIP_DEMO_SEED'];

test('student mutations authenticate after a held body finishes and cannot reuse a revoked durable session', async t => {
  const previous = new Map(managedKeys.map(key => [key, process.env[key]]));
  const folder = mkdtempSync(join(tmpdir(), 'comground-private-http-')), filename = join(folder, 'test.sqlite');
  const origin = 'http://localhost:3109';
  Object.assign(process.env, { COMGROUND_MODE: 'test', COMGROUND_ORIGIN: origin, COMGROUND_DB_PATH: filename, COMGROUND_OUTBOX_KEY: randomBytes(32).toString('base64'), COMGROUND_EMAIL_ENABLED: '0', COMGROUND_AI_ENABLED: '0', COMGROUND_TEST_FIXTURES: '1' });
  delete process.env.COMGROUND_SKIP_DEMO_SEED;
  let db: DatabaseSync | undefined;
  try {
    const identity = accounts(), store = students(), supply = repository();
    db = new DatabaseSync(filename); db.exec('PRAGMA foreign_keys=ON');
    const owner: AccountId = `account-${randomUUID()}`, at = new Date().toISOString();
    db.prepare("INSERT INTO accounts(id,email_norm,password_hash,role,email_verified_at,adult_attested_at,created_at,updated_at) VALUES(?,?,?,'STUDENT',?,?,?,?)")
      .run(owner, 'synthetic-held-body@example.invalid', 'synthetic-fixture-not-a-password-hash', at, at, at, at);
    const preferences: Preferences = { ageMin: 18, ageMax: 22, availableFrom: new Date(Date.now() - 86400000).toISOString(), availableUntil: new Date(Date.now() + 60 * 86400000).toISOString(), mode: 'ANY', area: '', interests: ['environment'], maxFee: 0, hasTraining: false, hasGuardian: false, requiresSchoolCredit: false };
    store.saveProfile(owner, { expectedVersion: 0, preferences, goal: 'EXPLORE', storageConsent: true, privacyConsent: { policyVersion: 'adult-account-v1', adultConfirmed: true, personalization: true } });
    const opportunity = supply.listPublic({}).data[0]; assert.ok(opportunity);
    function session(): string {
      const token = randomBytes(32).toString('base64url'), now = new Date().toISOString();
      db!.prepare('INSERT INTO account_sessions(id,token_hash,account_id,created_at,last_seen_at,expires_at,authenticated_at) VALUES(?,?,?,?,?,?,?)')
        .run(randomUUID(), createHash('sha256').update(token).digest('hex'), owner, now, now, new Date(Date.now() + 3600000).toISOString(), now);
      assert.equal(identity.requireSession(token).account.id, owner);
      return token;
    }
    const cases = [
      { name: 'profile preferences', path: 'profile', method: 'PUT', handler: putStudentProfile, input: () => ({ expectedVersion: store.getProfile(owner)!.version, preferences: { ...preferences, interests: ['reading'] }, goal: 'EXPLORE', storageConsent: true }), state: () => store.getProfile(owner) },
      { name: 'measurement consent', path: 'measurement/consent', method: 'PUT', handler: putMeasurementConsent, input: () => ({ expectedVersion: 0, expectedProfileVersion: store.getProfile(owner)!.version, enabled: true }), state: () => store.measurement.consent(owner) },
      { name: 'listing feedback', path: 'feedback', method: 'POST', handler: postStudentFeedback, input: () => ({ opportunityId: opportunity.id, occurrenceId: opportunity.occurrenceId ?? 'primary', kind: 'WRONG_DETAILS' }), state: () => store.listFeedback(owner) },
    ];
    for (const item of cases) await t.test(item.name, async () => {
      const token = session(), input = item.input(), before = item.state();
      let controller!: ReadableStreamDefaultController<Uint8Array>, reading!: () => void;
      const readStarted = new Promise<void>(resolve => { reading = resolve; });
      // Zero buffering means pull runs only when the handler actually reads the body.
      const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, pull() { reading(); } }, { highWaterMark: 0 });
      const headers = { host: 'localhost:3109', origin, 'content-type': 'application/json', cookie: `comground_account=${token}` };
      const request = new Request(`${origin}/api/student/${item.path}`, { method: item.method, headers, body, duplex: 'half' } as RequestInit);
      const pending = item.handler(request);
      await readStarted;
      identity.logout(token);
      assert.equal(identity.readSession(token).authenticated, false);
      controller.enqueue(new TextEncoder().encode(JSON.stringify(input))); controller.close();
      const response = await pending;
      assert.equal(response.status, 401); assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
      assert.deepEqual(item.state(), before, 'revocation must prevent every private write');
      const active = await item.handler(new Request(`${origin}/api/student/${item.path}`, { method: item.method, headers: { ...headers, cookie: `comground_account=${session()}` }, body: JSON.stringify(input) }));
      assert.equal(active.status, 200, 'the same valid request succeeds with a current session');
      assert.notDeepEqual(item.state(), before);
    });
  } finally {
    db?.close();
    try { students().close(); } catch {}
    try { accounts().close(); } catch {}
    try { repository().close(); } catch {}
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(folder, { recursive: true, force: true });
  }
});
