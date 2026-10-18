import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getRuntimeConfig, publicRuntime } from './runtime-config.ts';
import { bindDatabaseMode } from './database-mode.ts';
import { assertSameOrigin, assertLoopback } from './http.ts';
const valid = { NODE_ENV: 'production', COMGROUND_MODE: 'production', COMGROUND_ORIGIN: 'https://volunteer.example.invalid', COMGROUND_DB_PATH: '/tmp/comground-config-test.sqlite', COMGROUND_OUTBOX_KEY: Buffer.alloc(32, 7).toString('base64'), COMGROUND_ADULT_POLICY_ACK: 'adult-account-v1' };
test('teen review capability requires explicit synthetic test mode and never enables live teen enrollment', () => {
  const local = { ...valid, COMGROUND_MODE: 'test', COMGROUND_ORIGIN: 'http://localhost:3110' };
  assert.equal(publicRuntime(getRuntimeConfig(local)).capabilities.syntheticYouth, false);
  assert.equal(publicRuntime(getRuntimeConfig({ ...local, COMGROUND_TEST_FIXTURES: '1' })).capabilities.syntheticYouth, true);
  assert.equal(publicRuntime(getRuntimeConfig({ ...local, COMGROUND_TEST_FIXTURES: '1' })).capabilities.teenEnrollment, false);
  assert.equal(publicRuntime(getRuntimeConfig(valid)).capabilities.teenEnrollment, false);
  assert.throws(() => getRuntimeConfig({ ...valid, COMGROUND_TEST_FIXTURES: '1' }));
  assert.throws(() => getRuntimeConfig({ ...local, COMGROUND_TEST_FIXTURES: 'yes' }));
});
test('production fails closed on configuration, activation, and test-mode contamination', () => {
  assert.equal(getRuntimeConfig(valid).mode, 'production');
  for (const field of ['COMGROUND_ORIGIN', 'COMGROUND_DB_PATH', 'COMGROUND_OUTBOX_KEY', 'COMGROUND_ADULT_POLICY_ACK']) assert.throws(() => getRuntimeConfig({ ...valid, [field]: '' }));
  for (const origin of ['http://volunteer.example.invalid', 'https://127.0.0.1', 'https://volunteer.example.invalid/path', 'https://user:pass@volunteer.example.invalid', 'https://volunteer.example.invalid/']) assert.throws(() => getRuntimeConfig({ ...valid, COMGROUND_ORIGIN: origin }));
  assert.throws(() => getRuntimeConfig({ ...valid, COMGROUND_TEST_FIXTURES: '1' }));
  assert.throws(() => getRuntimeConfig({ ...valid, LOCAL_REVIEW_TOKEN: 'test-token' }));
  assert.throws(() => getRuntimeConfig({ ...valid, COMGROUND_EMAIL_ENABLED: '1' }));
  assert.throws(() => getRuntimeConfig({ ...valid, COMGROUND_AI_ENABLED: '1', OPENAI_API_KEY: 'synthetic', COMGROUND_AI_MODEL: 'configured-model' }));
  assert.throws(() => getRuntimeConfig({ ...valid, COMGROUND_MODE: 'test', COMGROUND_ORIGIN: 'http://127.0.0.1:3110', COMGROUND_AI_ENABLED: '1' }));
  assert.equal(JSON.stringify(publicRuntime(getRuntimeConfig(valid))).includes(valid.COMGROUND_OUTBOX_KEY), false);
  for (const mode of ['demo', 'test', 'production']) {
    const config = getRuntimeConfig({ ...valid, COMGROUND_MODE: mode, COMGROUND_ORIGIN: mode === 'production' ? valid.COMGROUND_ORIGIN : 'http://127.0.0.1:3110', RESEND_API_KEY: 'synthetic-unused-email-key', OPENAI_API_KEY: 'synthetic-unused-ai-key' });
    assert.deepEqual(config.ai, { enabled: false, key: null, model: null });
    assert.equal(config.notification.key, null); assert.equal(config.notification.enabled, false);
    assert(!JSON.stringify(publicRuntime(config)).includes('synthetic-unused'));
  }
});
test('configured production host and CSRF origin cannot be overridden by forwarded headers', () => {
  const before = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) if (key.startsWith('COMGROUND_') || key === 'LOCAL_REVIEW_TOKEN') delete process.env[key];
    Object.assign(process.env, valid);
    const request = (host: string, origin: string) => new Request('http://internal-service/api/student/profile', { headers: { host, origin, 'x-forwarded-host': 'attacker.invalid', 'x-forwarded-proto': 'https' } });
    assert.doesNotThrow(() => assertSameOrigin(request('volunteer.example.invalid', valid.COMGROUND_ORIGIN)));
    assert.throws(() => assertSameOrigin(request('volunteer.example.invalid', 'https://attacker.invalid')));
    assert.throws(() => assertLoopback(request('attacker.invalid', valid.COMGROUND_ORIGIN)));
  } finally { for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]; Object.assign(process.env, before); }
});
test('database mode is sticky, legacy populated databases cannot become production, restores are quarantined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'comground-mode-'));
  try {
    const filename = join(dir, 'db.sqlite'); bindDatabaseMode(filename, 'demo');
    assert.throws(() => bindDatabaseMode(filename, 'production')); bindDatabaseMode(filename, 'demo');
    const legacy = join(dir, 'legacy.sqlite'); const db = new DatabaseSync(legacy); db.exec('CREATE TABLE opportunities(id TEXT); INSERT INTO opportunities VALUES(\'synthetic\')'); db.close();
    assert.throws(() => bindDatabaseMode(legacy, 'production'));
    const prod = join(dir, 'production.sqlite'); bindDatabaseMode(prod, 'production');
    const live = new DatabaseSync(prod); live.exec("INSERT INTO deployment_meta VALUES('restore_quarantined','1')"); live.close();
    assert.throws(() => bindDatabaseMode(prod, 'production'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
