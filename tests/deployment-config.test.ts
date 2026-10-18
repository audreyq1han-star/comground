import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { getRuntimeConfig } from '../apps/web/lib/runtime-config.ts';
import { bindDatabaseMode } from '../apps/web/lib/database-mode.ts';

// Deployment libraries are executable JavaScript, independently of Next's build.
const lib = await import(new URL('../deploy/lib.mjs', import.meta.url).href);
const { initializeProductionSchema } = await import(new URL('../deploy/schema.mjs', import.meta.url).href);
const { backupDatabase, restoreBackup, backupKey } = await import(new URL('../deploy/backups.mjs', import.meta.url).href);
const { reconcileRestoredData, releaseRestoredDatabase } = await import(new URL('../deploy/reconcile.mjs', import.meta.url).href);
const { maintainProductionData } = await import(new URL('../deploy/maintenance.mjs', import.meta.url).href);
const { acquireServiceLease, assertNoMaintenance, withOperationLock } = await import(new URL('../deploy/locks.mjs', import.meta.url).href);
const root = fileURLToPath(new URL('..', import.meta.url));
const outboxKey = Buffer.alloc(32, 31).toString('base64');
const archiveKey = Buffer.alloc(32, 57);
function fixture() {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'comground-deploy-test-'));
  const config = getRuntimeConfig({ COMGROUND_MODE: 'production', COMGROUND_ORIGIN: 'https://acceptance.example.invalid', COMGROUND_DB_PATH: join(directory, 'live.sqlite'), COMGROUND_OUTBOX_KEY: outboxKey, COMGROUND_ADULT_POLICY_ACK: 'adult-account-v1' });
  return { directory, config, clean: () => rmSync(directory, { recursive: true, force: true }) };
}
async function initialize(config: ReturnType<typeof getRuntimeConfig>) {
  const mask = process.umask(0o077);
  try { await initializeProductionSchema(config); } finally { process.umask(mask); }
}
function receiptFixture(db: DatabaseSync, accountId: string, now: string) {
  const job = `receipt-${accountId}`;
  db.prepare(`INSERT INTO notification_outbox(id,account_id,purpose,state,dedupe_key,idempotency_key,expires_at,created_at,updated_at,provider_accepted_at,provider_email_id,receipt_status,receipt_occurred_at,receipt_received_at)
    VALUES(?,?,'VERIFY_EMAIL','ACCEPTED',?,?,?, ?,?,?,?,'BOUNCED',?,?)`).run(job, accountId, job, job, now, now, now, now, `provider-${accountId}`, now, now);
  db.prepare('INSERT INTO notification_receipt_correlations VALUES(?,?,NULL,?,?)').run(job, accountId, `provider-${accountId}`, new Date(Date.parse(now) + 30 * 86400000).toISOString());
  db.prepare("INSERT INTO notification_receipt_events VALUES(?,?,'BOUNCED',?,?)").run(`event-${accountId}`, job, now, now);
  db.prepare("INSERT INTO notification_suppression VALUES(?,'BOUNCED',?)").run(accountId, now);
  return job;
}

test('production executables fail closed with absent configuration before taking actions', () => {
  const scripts = readdirSync(join(root, 'scripts')).filter(name => /^production-.*\.mjs$/.test(name));
  assert.ok(scripts.length >= 6);
  for (const name of scripts) {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', join(root, 'scripts', name)], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, NODE_ENV: 'production' } });
    assert.equal(result.status, 1, name);
    assert.match(result.stderr, /COMGROUND_MODE=production/, name);
  }
});

test('configuration requires origin, persistent key and owner policy; test mode cannot enable external adapters', () => {
  const base = { COMGROUND_MODE: 'production', COMGROUND_ORIGIN: 'https://acceptance.example.invalid', COMGROUND_DB_PATH: '/data/comground.sqlite', COMGROUND_OUTBOX_KEY: outboxKey, COMGROUND_ADULT_POLICY_ACK: 'adult-account-v1' };
  for (const key of Object.keys(base).filter(key => key !== 'COMGROUND_MODE')) {
    const candidate: Record<string, string> = { ...base }; delete candidate[key];
    assert.throws(() => getRuntimeConfig(candidate));
  }
  assert.throws(() => getRuntimeConfig({ ...base, COMGROUND_DB_PATH: ':memory:' }));
  assert.throws(() => getRuntimeConfig({ ...base, COMGROUND_ORIGIN: 'http://acceptance.example.invalid' }));
  assert.throws(() => getRuntimeConfig({ ...base, COMGROUND_ORIGIN: 'https://acceptance.example.invalid/path' }));
  assert.throws(() => getRuntimeConfig({ ...base, LOCAL_REVIEW_TOKEN: 'synthetic-test-value' }));
  assert.throws(() => getRuntimeConfig({ ...base, COMGROUND_MODE: 'test', COMGROUND_ORIGIN: 'http://127.0.0.1:3199', COMGROUND_EMAIL_ENABLED: '1' }));
  assert.throws(() => getRuntimeConfig({ ...base, COMGROUND_MODE: 'test', COMGROUND_ORIGIN: 'http://127.0.0.1:3199', COMGROUND_AI_ENABLED: '1' }));
  assert.equal(getRuntimeConfig(base).notification.enabled, false);
  assert.equal(getRuntimeConfig(base).ai.enabled, false);
});

test('runtime and private storage checks reject old runtimes, broad permissions and symlinks', () => {
  const f = fixture();
  try {
    assert.throws(() => lib.requireSupportedNode('22.23.2'));
    assert.throws(() => lib.requireSupportedNode('24.0.0'));
    lib.requireSupportedNode('22.23.3');
    chmodSync(f.directory, 0o755); assert.throws(() => lib.privateDirectory(f.directory), /0700/);
    chmodSync(f.directory, 0o700); lib.privateDirectory(f.directory);
    const file = join(f.directory, 'private'); writeFileSync(file, 'synthetic', { mode: 0o600 });
    symlinkSync(file, join(f.directory, 'link'));
    assert.throws(() => lib.privateFile(join(f.directory, 'link')), /regular file/);
    chmodSync(file, 0o644); assert.throws(() => lib.privateFile(file), /0600/);
  } finally { f.clean(); }
});

test('schema-only production migration is idempotent, preserves data and never seeds examples or accounts', async () => {
  const f = fixture();
  try {
    await initialize(f.config);
    let db = lib.readReadyDatabase(f.config, { full: true });
    for (const table of ['accounts', 'opportunities', 'student_profiles', 'community_pages', 'measurement_campaigns', 'notification_outbox', 'notification_receipt_correlations', 'notification_receipt_events', 'notification_suppression']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, table);
    db.close();
    db = new DatabaseSync(f.config.dbPath); db.exec("CREATE TABLE preservation_probe(value TEXT); INSERT INTO preservation_probe VALUES('synthetic retained evidence');"); db.close();
    await initialize(f.config);
    db = lib.readReadyDatabase(f.config, { full: true });
    assert.equal(db.prepare('SELECT value FROM preservation_probe').get().value, 'synthetic retained evidence');
    assert.equal(db.prepare('SELECT count(*) AS n FROM comground_deployment_migrations').get().n, 1);
    db.close();
  } finally { f.clean(); }
});

test('demo bindings, interrupted migrations and quarantine fail readiness; only explicit migration resumes interruption', async () => {
  const f = fixture();
  try {
    await initialize(f.config);
    let db = new DatabaseSync(f.config.dbPath); db.prepare("INSERT INTO deployment_meta VALUES('migration_state','running')").run(); db.close();
    assert.throws(() => lib.readReadyDatabase(f.config), /did not finish/);
    assert.throws(() => bindDatabaseMode(f.config.dbPath, 'production'), /Complete the database migration/);
    await initialize(f.config);
    db = new DatabaseSync(f.config.dbPath); db.prepare("INSERT INTO deployment_meta VALUES('restore_quarantined','1')").run(); db.close();
    assert.throws(() => lib.readReadyDatabase(f.config), /quarantined/);
    await assert.rejects(initialize(f.config), /reconciliation/);
    assert.throws(() => bindDatabaseMode(f.config.dbPath, 'demo'));
  } finally { f.clean(); }
});

test('readiness refuses missing schema marker and synthetic rows instead of treating them as production', async () => {
  const f = fixture();
  try {
    await initialize(f.config);
    const db = new DatabaseSync(f.config.dbPath);
    db.prepare("INSERT INTO catalogue_meta(key,value) VALUES('demo-seed-v1','test')").run();
    assert.throws(() => lib.readReadyDatabase(f.config), /seeded demo/);
    db.prepare("DELETE FROM catalogue_meta WHERE key='demo-seed-v1'").run();
    db.exec('DELETE FROM comground_deployment_migrations');
    assert.throws(() => lib.readReadyDatabase(f.config), /explicit production migration/);
    db.close();
  } finally { f.clean(); }
});

test('encrypted online backup includes committed WAL data and restores only into a new quarantined path', async () => {
  const f = fixture();
  try {
    await initialize(f.config);
    const writer = new DatabaseSync(f.config.dbPath);
    writer.exec("PRAGMA wal_autocheckpoint=0; CREATE TABLE backup_probe(value TEXT); INSERT INTO backup_probe VALUES('synthetic WAL evidence'); INSERT INTO deployment_meta VALUES('restore_data_reconciled_reference','previous-restore-review');");
    const output = join(f.directory, 'backup-1');
    await backupDatabase(f.config, output, { key: archiveKey });
    writer.close();
    assert.deepEqual(readdirSync(output).sort(), ['database.sqlite.enc', 'manifest.json']);
    assert.equal(readFileSync(join(output, 'database.sqlite.enc')).includes(Buffer.from('synthetic WAL evidence')), false);
    await assert.rejects(backupDatabase(f.config, output, { key: archiveKey }), /exist/);
    await assert.rejects(restoreBackup(f.config, output, f.config.dbPath, { key: archiveKey }), /never the configured live path/);
    const target = join(f.directory, 'restored.sqlite');
    await restoreBackup(f.config, output, target, { key: archiveKey });
    const db = new DatabaseSync(target, { readOnly: true });
    assert.equal(db.prepare('SELECT value FROM backup_probe').get()?.value, 'synthetic WAL evidence');
    assert.equal(db.prepare("SELECT value FROM deployment_meta WHERE key='restore_quarantined'").get()?.value, '1');
    assert.equal(db.prepare("SELECT value FROM deployment_meta WHERE key='restore_data_reconciled_reference'").get(), undefined); db.close();
    assert.throws(() => lib.readReadyDatabase({ ...f.config, dbPath: target }), /quarantined/);
    await assert.rejects(restoreBackup(f.config, output, target, { key: archiveKey }), /already exist/);
  } finally { f.clean(); }
});

test('backup keys must be separate and tampering or key mismatch cannot produce a restored database', async () => {
  const f = fixture();
  try {
    await initialize(f.config); const output = join(f.directory, 'backup');
    assert.throws(() => backupKey('bad'), /COMGROUND_BACKUP_KEY/);
    await assert.rejects(backupDatabase(f.config, output, { key: Buffer.from(outboxKey, 'base64') }), /separate backup/);
    await backupDatabase(f.config, output, { key: archiveKey });
    const target = join(f.directory, 'restored.sqlite');
    await assert.rejects(restoreBackup(f.config, output, target, { key: Buffer.alloc(32, 1) }), /does not match/);
    const manifestPath = join(output, 'manifest.json'), originalManifest = readFileSync(manifestPath, 'utf8');
    writeFileSync(manifestPath, JSON.stringify({ ...JSON.parse(originalManifest), buildId: 'tampered-build' }));
    await assert.rejects(restoreBackup(f.config, output, target, { key: archiveKey }), /authenticate/);
    assert.equal(existsSync(target), false);
    writeFileSync(manifestPath, originalManifest);
    const encrypted = join(output, 'database.sqlite.enc'), data = readFileSync(encrypted); data[0] ^= 1; writeFileSync(encrypted, data);
    await assert.rejects(restoreBackup(f.config, output, target, { key: archiveKey }), /checksum/);
    assert.equal(existsSync(target), false);
    assert.equal(readdirSync(f.directory).some(name => name.includes('.restoring-')), false);
  } finally { f.clean(); }
});

test('release requires quarantine, revokes restored credentials and cancels queued mail transactionally', async () => {
  const f = fixture();
  try {
    await initialize(f.config);
    await assert.rejects(releaseRestoredDatabase(f.config, 'test-review-1'), /Only a quarantined/);
    let db = new DatabaseSync(f.config.dbPath);
    db.exec(`INSERT INTO accounts VALUES('synthetic-account','synthetic@example.invalid','synthetic-hash','STUDENT','2026-01-01','2026-01-01','2026-01-01','2026-01-01');
      INSERT INTO account_sessions VALUES('synthetic-session','synthetic-session-hash','synthetic-account','2026-01-01','2026-01-01','2030-01-01','2026-01-01');
      INSERT INTO account_action_tokens VALUES('synthetic-token-hash','synthetic-account','VERIFY_EMAIL','2030-01-01',NULL,'2026-01-01');
      INSERT INTO notification_outbox(id,account_id,purpose,state,dedupe_key,idempotency_key,envelope,token_hash,expires_at,created_at,updated_at,next_attempt_at) VALUES('synthetic-mail','synthetic-account','VERIFY_EMAIL','QUEUED','dedupe','idempotency','synthetic-encrypted-envelope','synthetic-token-hash','2030-01-01','2026-01-01','2026-01-01','2026-01-01');
      INSERT INTO deployment_meta VALUES('restore_quarantined','1');
      INSERT INTO deployment_meta VALUES('restore_snapshot_at','2026-01-01T00:00:00.000Z');`); db.close();
    await assert.rejects(releaseRestoredDatabase(f.config, 'test-review-1'), /offline deletion-register/);
    await assert.rejects(reconcileRestoredData(f.config, { format: 'comground-deletion-register-v1', reviewedThrough: '2025-01-01T00:00:00Z', accountIds: [] }, 'test-review-1', { unverifiedDays: 30, securityEventDays: 90 }), /must cover the restored snapshot/);
    await reconcileRestoredData(f.config, { format: 'comground-deletion-register-v1', reviewedThrough: new Date().toISOString(), accountIds: [] }, 'test-review-1', { unverifiedDays: 30, securityEventDays: 90 });
    await releaseRestoredDatabase(f.config, 'test-review-1');
    db = lib.readReadyDatabase(f.config);
    assert.equal(db.prepare('SELECT count(*) AS n FROM account_sessions').get()?.n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM account_action_tokens').get()?.n, 0);
    const message = db.prepare('SELECT state,envelope,token_hash,next_attempt_at FROM notification_outbox').get();
    assert.deepEqual({ ...message }, { state: 'CANCELLED', envelope: null, token_hash: null, next_attempt_at: null });
    assert.equal(db.prepare("SELECT value FROM deployment_meta WHERE key='restore_reconciliation_reference'").get()?.value, 'test-review-1'); db.close();
  } finally { f.clean(); }
});

test('container config binds only loopback, persists SQLite and keeps credentials out of image layers', () => {
  const docker = readFileSync(join(root, 'Dockerfile'), 'utf8'), compose = readFileSync(join(root, 'deploy/compose.yaml'), 'utf8'), ignored = readFileSync(join(root, '.dockerignore'), 'utf8');
  assert.match(docker, /USER node/); assert.match(docker, /npm ci --ignore-scripts/); assert.match(docker, /production-check\.mjs/);
  assert.doesNotMatch(docker, /ARG (?:RESEND|OPENAI|COMGROUND_OUTBOX|COMGROUND_BACKUP)/);
  assert.match(compose, /127\.0\.0\.1:3100:3100/); assert.match(compose, /data:\/data/); assert.match(compose, /read_only: true/);
  assert.match(ignored, /\*\*\/\.env\*/); assert.match(ignored, /\.data/); assert.match(ignored, /\.tools/);
  assert.equal(dirname(fileURLToPath(new URL('../deploy/production.env.example', import.meta.url))), join(root, 'deploy'));
});

test('offline restore reconciliation replays declared deletions and retains quarantine until explicit release', async () => {
  const f = fixture();
  const id = 'account-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  try {
    await initialize(f.config);
    let db = new DatabaseSync(f.config.dbPath);
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?)').run(id, 'deleted-synthetic@example.invalid', 'synthetic-hash', 'STUDENT', '2026-01-01', '2026-01-01', '2026-01-01', '2026-01-01');
    db.prepare('INSERT INTO student_profiles VALUES(?,?)').run(id, '{"version":1}');
    db.prepare('INSERT INTO measurement_consent VALUES(?,1,1,?)').run(id, '2026-01-01');
    receiptFixture(db, id, new Date().toISOString());
    db.exec("INSERT INTO deployment_meta VALUES('restore_quarantined','1'); INSERT INTO deployment_meta VALUES('restore_snapshot_at','2026-01-01T00:00:00.000Z');"); db.close();
    const register = { format: 'comground-deletion-register-v1', reviewedThrough: new Date().toISOString(), accountIds: [id] };
    await reconcileRestoredData(f.config, register, 'delete-review-1', { unverifiedDays: 30, securityEventDays: 90 });
    await reconcileRestoredData(f.config, register, 'delete-review-1', { unverifiedDays: 30, securityEventDays: 90 });
    assert.throws(() => lib.readReadyDatabase(f.config), /quarantined/);
    db = new DatabaseSync(f.config.dbPath, { readOnly: true });
    for (const table of ['accounts', 'student_profiles', 'measurement_consent', 'notification_outbox', 'notification_receipt_correlations', 'notification_receipt_events', 'notification_suppression']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
    db.close();
    await releaseRestoredDatabase(f.config, 'delete-review-1');
    db = lib.readReadyDatabase(f.config); db.close();
  } finally { f.clean(); }
});

test('explicit maintenance validates approved periods and prunes without creating supply or invoking delivery', async () => {
  const f = fixture();
  try {
    await initialize(f.config);
    await assert.rejects(maintainProductionData(f.config, { unverifiedDays: 0, securityEventDays: 90 }), /7–365/);
    let db = new DatabaseSync(f.config.dbPath);
    db.exec("INSERT INTO account_abuse VALUES('synthetic-bucket',1,0)"); db.close();
    await maintainProductionData(f.config, { unverifiedDays: 30, securityEventDays: 90 });
    db = lib.readReadyDatabase(f.config);
    assert.equal(db.prepare('SELECT count(*) AS n FROM account_abuse').get()?.n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM measurement_campaigns').get()?.n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM notification_outbox').get()?.n, 0); db.close();
  } finally { f.clean(); }
});

test('receipt readiness rejects missing tables, columns and unique association until additive migration repairs them', async () => {
  const f = fixture();
  try {
    await initialize(f.config);
    let db = new DatabaseSync(f.config.dbPath);
    db.exec('ALTER TABLE notification_outbox DROP COLUMN receipt_received_at'); db.close();
    assert.throws(() => lib.readReadyDatabase(f.config), /notification_outbox.receipt_received_at/);
    await initialize(f.config);
    db = new DatabaseSync(f.config.dbPath); db.exec('DROP TABLE notification_receipt_events'); db.close();
    assert.throws(() => lib.readReadyDatabase(f.config), /notification_receipt_events/);
    await initialize(f.config);
    db = new DatabaseSync(f.config.dbPath); db.exec('DROP INDEX notification_provider_email'); db.close();
    assert.throws(() => lib.readReadyDatabase(f.config), /unique provider-email/);
    await initialize(f.config);
    db = lib.readReadyDatabase(f.config);
    assert.equal(db.prepare('SELECT revision FROM comground_deployment_migrations').get()?.revision, 'production-schema-v1'); db.close();
  } finally { f.clean(); }
});

test('encrypted backup and restore release retain receipt history and account suppression without replaying queued mail', async () => {
  const f = fixture(), id = 'account-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', now = new Date().toISOString();
  try {
    await initialize(f.config);
    let db = new DatabaseSync(f.config.dbPath);
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?)').run(id, 'suppressed-synthetic@example.invalid', 'synthetic-hash', 'STUDENT', now, now, now, now);
    const job = receiptFixture(db, id, now);
    db.prepare(`INSERT INTO notification_outbox(id,account_id,purpose,state,dedupe_key,idempotency_key,envelope,token_hash,expires_at,created_at,updated_at,next_attempt_at)
      VALUES('queued-restore',?,'VERIFY_EMAIL','QUEUED','queued-restore','queued-restore','synthetic-envelope','synthetic-token','2099-01-01',?,?,?)`).run(id, now, now, now); db.close();
    await initialize(f.config);
    const output = join(f.directory, 'receipt-backup'), target = join(f.directory, 'receipt-restored.sqlite');
    await backupDatabase(f.config, output, { key: archiveKey });
    await restoreBackup(f.config, output, target, { key: archiveKey });
    const restored = { ...f.config, dbPath: target };
    assert.throws(() => lib.readReadyDatabase(restored), /quarantined/);
    await reconcileRestoredData(restored, { format: 'comground-deletion-register-v1', reviewedThrough: new Date().toISOString(), accountIds: [] }, 'receipt-restore-review', { unverifiedDays: 30, securityEventDays: 90 });
    await releaseRestoredDatabase(restored, 'receipt-restore-review');
    db = lib.readReadyDatabase(restored);
    assert.equal(db.prepare('SELECT reason FROM notification_suppression WHERE account_id=?').get(id)?.reason, 'BOUNCED');
    assert.equal(db.prepare('SELECT status FROM notification_receipt_events WHERE outbox_id=?').get(job)?.status, 'BOUNCED');
    assert.equal(db.prepare('SELECT receipt_status FROM notification_outbox WHERE id=?').get(job)?.receipt_status, 'BOUNCED');
    assert.equal(db.prepare("SELECT state FROM notification_outbox WHERE id='queued-restore'").get()?.state, 'CANCELLED');
    db.close();
  } finally { f.clean(); }
});

test('post-snapshot suppression replay is idempotent, cancels queued mail and never resurrects deleted or absent accounts', async () => {
  const f = fixture(), id = 'account-cccccccc-cccc-4ccc-8ccc-cccccccccccc', deleted = 'account-dddddddd-dddd-4ddd-8ddd-dddddddddddd', absent = 'account-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', now = new Date().toISOString();
  try {
    await initialize(f.config);
    let db = new DatabaseSync(f.config.dbPath);
    for (const [owner, email] of [[id, 'receipt-synthetic@example.invalid'], [deleted, 'deleted-synthetic@example.invalid']]) db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?)').run(owner, email, 'synthetic-hash', 'STUDENT', now, now, now, now);
    db.prepare(`INSERT INTO notification_outbox(id,account_id,purpose,state,dedupe_key,idempotency_key,envelope,token_hash,expires_at,created_at,updated_at,next_attempt_at,lease_token,lease_until)
      VALUES('pending-replay',?,'VERIFY_EMAIL','LEASED','pending-replay','pending-replay','synthetic-envelope','synthetic-token','2099-01-01',?,?,?,'synthetic-lease','2099-01-01')`).run(id, now, now, now); db.close();
    const output = join(f.directory, 'before-complaint'), target = join(f.directory, 'after-complaint.sqlite');
    await backupDatabase(f.config, output, { key: archiveKey }); await restoreBackup(f.config, output, target, { key: archiveKey });
    const restored = { ...f.config, dbPath: target }, cutoff = new Date().toISOString();
    const register = { format: 'comground-deletion-register-v1', reviewedThrough: cutoff, accountIds: [deleted], notificationSuppressions: [
      { accountId: id, reason: 'BOUNCED', occurredAt: cutoff }, { accountId: id, reason: 'COMPLAINED', occurredAt: cutoff }, { accountId: id, reason: 'BOUNCED', occurredAt: cutoff },
      { accountId: deleted, reason: 'COMPLAINED', occurredAt: cutoff }, { accountId: absent, reason: 'BOUNCED', occurredAt: cutoff },
    ] };
    for (let i = 0; i < 2; i++) await reconcileRestoredData(restored, register, 'post-snapshot-review', { unverifiedDays: 30, securityEventDays: 90 });
    db = new DatabaseSync(target, { readOnly: true });
    assert.equal(db.prepare('SELECT count(*) AS n FROM notification_suppression').get()?.n, 1);
    assert.equal(db.prepare('SELECT reason FROM notification_suppression WHERE account_id=?').get(id)?.reason, 'COMPLAINED');
    assert.equal(db.prepare('SELECT 1 FROM accounts WHERE id IN (?,?)').get(deleted, absent), undefined);
    const pending = db.prepare("SELECT state,reason,envelope,token_hash,lease_token,lease_until,next_attempt_at FROM notification_outbox WHERE id='pending-replay'").get();
    assert.deepEqual({ ...pending }, { state: 'CANCELLED', reason: 'RECIPIENT_SUPPRESSED', envelope: null, token_hash: null, lease_token: null, lease_until: null, next_attempt_at: null }); db.close();
    await releaseRestoredDatabase(restored, 'post-snapshot-review');
    db = lib.readReadyDatabase(restored); assert.equal(db.prepare('SELECT reason FROM notification_suppression WHERE account_id=?').get(id)?.reason, 'COMPLAINED'); db.close();
  } finally { f.clean(); }
});

test('encrypted restore release atomically invalidates digest approvals, recipients and subscriptions', async () => {
  const f = fixture(), id = 'account-12121212-1212-4121-8121-121212121212', now = new Date().toISOString();
  try {
    await initialize(f.config);
    let db = new DatabaseSync(f.config.dbPath);
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?)').run(id, 'digest-restore@example.invalid', 'synthetic-hash', 'STUDENT', now, now, now, now);
    db.prepare('INSERT INTO student_profiles VALUES(?,?)').run(id, '{"version":1}');
    db.prepare('INSERT INTO digest_subscriptions VALUES(?,1,1,?)').run(id, now);
    db.prepare("INSERT INTO digest_batches VALUES('restore-batch','Reviewed shortlist','APPROVED',2,?,?,?,'[]','[]')").run(now, now, '2099-01-01T00:00:00.000Z');
    db.prepare("INSERT INTO digest_recipients VALUES('restore-batch',?,1,1,'[]','QUEUED',?)").run(id, now);
    db.prepare(`INSERT INTO notification_outbox(id,account_id,purpose,state,dedupe_key,idempotency_key,envelope,expires_at,created_at,updated_at,next_attempt_at)
      VALUES('restore-digest',?,'DIGEST','QUEUED','restore-digest','restore-digest','synthetic-envelope','2099-01-01',?,?,?)`).run(id, now, now, now);
    db.close();
    const output = join(f.directory, 'digest-backup'), target = join(f.directory, 'digest-restored.sqlite');
    await backupDatabase(f.config, output, { key: archiveKey }); await restoreBackup(f.config, output, target, { key: archiveKey });
    const restored = { ...f.config, dbPath: target };
    await reconcileRestoredData(restored, { format: 'comground-deletion-register-v1', reviewedThrough: new Date().toISOString(), accountIds: [] }, 'digest-restore-review', { unverifiedDays: 30, securityEventDays: 90 });
    db = new DatabaseSync(target);
    db.exec("CREATE TRIGGER fail_digest_release BEFORE UPDATE ON digest_batches BEGIN SELECT RAISE(ABORT,'Injected digest release failure'); END;"); db.close();
    await assert.rejects(releaseRestoredDatabase(restored, 'digest-restore-review'), /Injected digest release failure/);
    db = new DatabaseSync(target);
    assert.equal(db.prepare("SELECT value FROM deployment_meta WHERE key='restore_quarantined'").get()?.value, '1');
    assert.equal(db.prepare('SELECT enabled FROM digest_subscriptions').get()?.enabled, 1);
    assert.equal(db.prepare("SELECT state FROM notification_outbox WHERE id='restore-digest'").get()?.state, 'QUEUED');
    assert.equal(db.prepare('SELECT count(*) AS n FROM digest_recipients').get()?.n, 1);
    db.exec('DROP TRIGGER fail_digest_release'); db.close();
    await releaseRestoredDatabase(restored, 'digest-restore-review');
    db = lib.readReadyDatabase(restored);
    assert.deepEqual({ ...db.prepare('SELECT enabled,version FROM digest_subscriptions').get() }, { enabled: 0, version: 2 });
    const batch = db.prepare('SELECT state,version,audit_json FROM digest_batches').get();
    assert.equal(batch?.state, 'CANCELLED'); assert.equal(batch?.version, 3);
    assert.equal(JSON.parse(String(batch?.audit_json)).at(-1).actor, 'LOCAL_RESTORE');
    assert.equal(db.prepare('SELECT count(*) AS n FROM digest_recipients').get()?.n, 0);
    assert.deepEqual({ ...db.prepare("SELECT state,envelope FROM notification_outbox WHERE id='restore-digest'").get() }, { state: 'CANCELLED', envelope: null });
    db.close();
  } finally { f.clean(); }
});

test('malformed suppression ledger entries and storage failure leave deletion replay uncommitted', async () => {
  const f = fixture(), id = 'account-ffffffff-ffff-4fff-8fff-ffffffffffff', deleted = 'account-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', cutoff = new Date().toISOString();
  try {
    await initialize(f.config);
    let db = new DatabaseSync(f.config.dbPath);
    for (const [owner, email] of [[id, 'retain-synthetic@example.invalid'], [deleted, 'delete-synthetic@example.invalid']]) db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?)').run(owner, email, 'synthetic-hash', 'STUDENT', cutoff, cutoff, cutoff, cutoff);
    db.exec("INSERT INTO deployment_meta VALUES('restore_quarantined','1'); INSERT INTO deployment_meta VALUES('restore_snapshot_at','2026-01-01T00:00:00.000Z');"); db.close();
    const base = { format: 'comground-deletion-register-v1', reviewedThrough: cutoff, accountIds: [deleted] }, entry = { accountId: id, reason: 'BOUNCED', occurredAt: cutoff };
    for (const notificationSuppressions of [null, [{ ...entry, reason: 'DELIVERED' }], [{ ...entry, occurredAt: '2026-02-30T00:00:00.000Z' }], [{ ...entry, occurredAt: '2099-01-01T00:00:00.000Z' }], [{ ...entry, accountId: 'unknown' }], [{ ...entry, unexpected: 'field' }]]) {
      await assert.rejects(reconcileRestoredData(f.config, { ...base, notificationSuppressions }, 'invalid-review', { unverifiedDays: 30, securityEventDays: 90 }), /reviewed notification suppressions/);
    }
    db = new DatabaseSync(f.config.dbPath);
    assert.ok(db.prepare('SELECT id FROM accounts WHERE id=?').get(deleted));
    db.exec("CREATE TRIGGER fail_suppression_replay BEFORE INSERT ON notification_suppression BEGIN SELECT RAISE(ABORT,'Injected suppression storage failure'); END;"); db.close();
    await assert.rejects(reconcileRestoredData(f.config, { ...base, notificationSuppressions: [entry] }, 'failed-review', { unverifiedDays: 30, securityEventDays: 90 }), /Injected suppression storage failure/);
    db = new DatabaseSync(f.config.dbPath, { readOnly: true });
    assert.ok(db.prepare('SELECT id FROM accounts WHERE id=?').get(deleted));
    assert.equal(db.prepare('SELECT count(*) AS n FROM notification_suppression').get()?.n, 0);
    assert.equal(db.prepare("SELECT value FROM deployment_meta WHERE key='restore_data_reconciled_reference'").get(), undefined);
    assert.equal(db.prepare("SELECT value FROM deployment_meta WHERE key='restore_quarantined'").get()?.value, '1'); db.close();
  } finally { f.clean(); }
});

test('operational commands serialize before work, release failures and never remove another owner lock', async () => {
  const f = fixture(); let calls = 0;
  try {
    await withOperationLock(f.config, 'backup', async () => {
      assert.equal(lstatSync(`${f.config.dbPath}.operation-lock`).mode & 0o777, 0o600);
      await assert.rejects(withOperationLock(f.config, 'retention', () => calls++), /operational lock already exists/);
      assert.equal(calls, 0);
    });
    await assert.rejects(withOperationLock(f.config, 'failed', () => { throw new Error('synthetic job failure'); }), /synthetic job failure/);
    assert.equal(existsSync(`${f.config.dbPath}.operation-lock`), false);
    await withOperationLock(f.config, 'retention', () => calls++);
    assert.equal(calls, 1);
    await assert.rejects(withOperationLock(f.config, 'replacement-check', () => {
      unlinkSync(`${f.config.dbPath}.operation-lock`);
      writeFileSync(`${f.config.dbPath}.operation-lock`, 'replacement-owned', { mode: 0o600 });
    }), /ownership changed/);
    assert.equal(readFileSync(`${f.config.dbPath}.operation-lock`, 'utf8'), 'replacement-owned');
  } finally { f.clean(); }
});

test('managed service lease rejects second app and stopped-only jobs while allowing online maintenance', async () => {
  const f = fixture(); let release: (() => void) | undefined;
  try {
    await withOperationLock(f.config, 'startup', () => { release = acquireServiceLease(f.config); });
    await assert.rejects(withOperationLock(f.config, 'second-startup', () => acquireServiceLease(f.config)), /operational lock already exists/);
    let migrated = false;
    await assert.rejects(withOperationLock(f.config, 'migration', () => { migrated = true; }, { stopped: true }), /managed application is running/);
    assert.equal(migrated, false);
    assert.equal(existsSync(`${f.config.dbPath}.maintenance-lock`), false);
    await withOperationLock(f.config, 'online-backup', () => assert.ok(existsSync(`${f.config.dbPath}.service-lock`)));
    release!(); release = undefined;
    await withOperationLock(f.config, 'migration', () => {
      assert.throws(() => assertNoMaintenance(f.config), /maintenance is in progress/);
      assert.throws(() => acquireServiceLease(f.config), /maintenance is in progress/);
    }, { stopped: true });
    assertNoMaintenance(f.config);
    assert.equal(existsSync(`${f.config.dbPath}.operation-lock`), false);
  } finally { release?.(); f.clean(); }
});

test('a terminated operation leaves a fail-closed lock instead of unsafe automatic stale-lock stealing', async () => {
  const f = fixture();
  try {
    const code = `import { withOperationLock } from ${JSON.stringify(new URL('../deploy/locks.mjs', import.meta.url).href)}; await withOperationLock({dbPath:process.argv[1]},'interrupted',()=>process.exit(0));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code, f.config.dbPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(`${f.config.dbPath}.operation-lock`), true);
    await assert.rejects(withOperationLock(f.config, 'retry', () => assert.fail('must not run')), /operational lock already exists/);
    // An operator-confirmed manual recovery is deliberately the only removal path.
    unlinkSync(`${f.config.dbPath}.operation-lock`);
    await withOperationLock(f.config, 'retry', () => undefined);
  } finally { f.clean(); }
});

test('readiness covers catalogue, private event history, measurement and AI budget schemas', async () => {
  const f = fixture();
  try {
    await initialize(f.config);
    for (const table of ['sources', 'community_pages', 'student_profile_clock', 'student_occurrence_activity_events', 'measurement_feedback', 'measurement_attribution', 'ai_usage', 'account_age', 'youth_review_events', 'safety_report_events', 'safety_report_limits', 'student_evidence_claims', 'student_failed_fits', 'scope_evidence_records', 'digest_recipients', 'digest_subscriptions', 'distribution_community_pages', 'source_ingestion_attempts', 'source_record_links', 'source_review_time', 'matching_evaluation_decisions', 'matching_evaluation_runs']) {
      const db = new DatabaseSync(f.config.dbPath); db.exec(`DROP TABLE ${table}`); db.close();
      assert.throws(() => lib.readReadyDatabase(f.config), new RegExp(table));
      await initialize(f.config);
      const ready = lib.readReadyDatabase(f.config); ready.close();
    }
  } finally { f.clean(); }
});

test('matching QA evidence is permitted in production but its immutable audit triggers are required', async () => {
  const f = fixture();
  try {
    await initialize(f.config);
    let db = new DatabaseSync(f.config.dbPath);
    db.prepare('INSERT INTO matching_evaluation_runs VALUES(?,?,?)').run('offline-qa', new Date().toISOString(), '{"studentDataIncluded":false}');
    assert.throws(() => db.prepare("DELETE FROM matching_evaluation_runs WHERE id='offline-qa'").run(), /immutable/);
    db.exec('DROP TRIGGER matching_evaluation_runs_no_delete'); db.close();
    assert.throws(() => lib.readReadyDatabase(f.config), /immutable matching-evaluation/);
    await initialize(f.config);
    db = lib.readReadyDatabase(f.config);
    assert.equal(db.prepare('SELECT count(*) AS n FROM matching_evaluation_runs').get()?.n, 1); db.close();
  } finally { f.clean(); }
});

test('production readiness rejects synthetic youth/evidence state and repairs required active-review uniqueness only by migration', async () => {
  const f = fixture();
  try {
    await initialize(f.config);
    let db = new DatabaseSync(f.config.dbPath);
    db.exec('DROP INDEX youth_review_active_owner'); db.close();
    assert.throws(() => lib.readReadyDatabase(f.config), /unique active youth-review/);
    await initialize(f.config);
    db = new DatabaseSync(f.config.dbPath);
    db.exec("INSERT INTO account_meta VALUES('youth-workflow','synthetic-test-only')"); db.close();
    assert.throws(() => lib.readReadyDatabase(f.config), /synthetic youth workflow/);
    db = new DatabaseSync(f.config.dbPath);
    db.exec("DELETE FROM account_meta WHERE key='youth-workflow'; INSERT INTO scope_evidence_records VALUES('synthetic-scope','ORGANIZER_REVIEW','synthetic-org',NULL,NULL,'{}')"); db.close();
    assert.throws(() => lib.readReadyDatabase(f.config), /Synthetic workflow/);
  } finally { f.clean(); }
});

test('nginx source contract uses socket-address auth budgets, bounded concurrency and fixed upstream identity (not a proxy execution test)', () => {
  const nginx = readFileSync(join(root, 'deploy/nginx.conf.example'), 'utf8');
  const directives = nginx.split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
  assert.match(directives, /map "\$request_method:\$uri" \$comground_auth_ip/);
  assert.match(directives, /POST\|PUT\|PATCH\|DELETE\):\/api\/account/);
  assert.match(directives, /limit_req_zone \$comground_auth_ip.*rate=10r\/m/);
  assert.match(directives, /limit_req_zone \$comground_auth_global.*rate=4r\/s/);
  assert.match(directives, /limit_conn comground_auth_connections 2/);
  assert.match(directives, /limit_conn comground_auth_total_connections 8/);
  assert.match(directives, /limit_conn_status 429/);
  assert.match(directives, /limit_req_status 429/);
  assert.match(directives, /proxy_set_header X-Forwarded-For \$remote_addr/);
  assert.match(directives, /proxy_set_header Host app\.example\.invalid/);
  assert.match(directives, /proxy_set_header Forwarded ""/);
  assert.doesNotMatch(directives, /real_ip_header|set_real_ip_from|proxy_protocol|proxy_add_x_forwarded_for/);
  assert.match(directives, /if \(\$http_host !~\*/);
  assert.match(directives, /ssl_reject_handshake on/);
  assert.match(directives, /client_max_body_size 64k/);
  assert.match(directives, /proxy_request_buffering on/);
  assert.match(directives, /client_header_timeout 10s/);
  const accessFormat = directives.match(/log_format comground ([^;]+);/)?.[1] ?? '';
  assert.doesNotMatch(accessFormat, /request_uri|remote_addr|http_|args|cookie/);
});

test('schedule and CI source contracts are opt-in, bounded and contain no deployment action (not systemd or hosted CI execution)', () => {
  for (const name of ['worker', 'backup', 'maintenance']) {
    const service = readFileSync(join(root, `deploy/systemd/comground-${name}.service.example`), 'utf8');
    const timer = readFileSync(join(root, `deploy/systemd/comground-${name}.timer.example`), 'utf8');
    assert.match(service, new RegExp(`ConditionPathExists=/etc/comground/enabled/${name}`));
    assert.match(service, /Type=oneshot/);
    assert.match(service, /--pull never --no-build/);
    assert.match(service, new RegExp(`ExecStopPost=-/usr/bin/docker rm --force comground-${name}-job`));
    assert.match(service, /TimeoutStartSec=\d+/);
    assert.match(service, /UMask=0077/);
    assert.match(timer, /Persistent=false/);
    assert.doesNotMatch(timer, /OnBootSec/);
  }
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(ci, /contents: read/);
  assert.match(ci, /npm ci --ignore-scripts --no-audit --no-fund/);
  for (const command of ['git diff --check', 'npm run typecheck', 'npm test', 'npm run build', 'npm run test:production-http']) assert.ok(ci.includes(command));
  assert.doesNotMatch(ci.split('\n').filter(line => !line.trim().startsWith('#')).join('\n'), /secrets\.|run:.*(?:docker|deploy|curl)|schedule:/);
});

test('quality entry point documents optional browser prerequisites without starting jobs on help', () => {
  const result = spawnSync(process.execPath, [join(root, 'scripts/check-local-quality.mjs'), '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /No installation/);
  for (const script of ['test-local-performance.mjs', 'check-local-quality.mjs']) {
    const parsed = spawnSync(process.execPath, ['--check', join(root, 'scripts', script)], { encoding: 'utf8' });
    assert.equal(parsed.status, 0, parsed.stderr);
  }
});

test('the bundled expansion review and offline command remain no-go with unknown evidence', () => {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', join(root, 'scripts/check-expansion-readiness.mjs')], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, NODE_ENV: 'test' } });
  assert.equal(result.status, 1, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.decision, 'NO_GO'); assert.equal(data.externalEvidenceVerified, false); assert.equal(data.deploymentAuthorized, false);
  assert.ok(data.blockers.some((blocker: string) => blocker.includes('Production teen admission')));
  assert.ok(data.blockers.some((blocker: string) => blocker.includes('unknown')));
  const f = fixture();
  try {
    const path = join(f.directory, 'malformed.json'); writeFileSync(path, '{"secret":"synthetic-sensitive-value"', { mode: 0o600 });
    const rejected = spawnSync(process.execPath, ['--experimental-strip-types', join(root, 'scripts/check-expansion-readiness.mjs'), '--record', path], { encoding: 'utf8' });
    assert.equal(rejected.status, 1); assert.doesNotMatch(rejected.stdout + rejected.stderr, /synthetic-sensitive-value/);
  } finally { f.clean(); }
});

test('expansion review route requires a reviewer and exposes no record to anonymous or foreign-host requests', async () => {
  const values = { COMGROUND_MODE: 'demo', COMGROUND_ORIGIN: 'http://127.0.0.1:3100', COMGROUND_EMAIL_ENABLED: '0', COMGROUND_AI_ENABLED: '0', LOCAL_REVIEW_TOKEN: 'synthetic-expansion-review-token' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    const { GET } = await import(new URL('../apps/web/app/api/admin/readiness/route.ts', import.meta.url).href);
    const { createSessionCookie } = await import('../apps/web/lib/auth.ts');
    const url = 'http://127.0.0.1:3100/api/admin/readiness';
    const anonymous = GET(new Request(url, { headers: { host: '127.0.0.1:3100' } })); assert.equal(anonymous.status, 401); assert.equal((await anonymous.json()).data, undefined);
    const foreign = GET(new Request('http://untrusted.example.invalid/api/admin/readiness')); assert.equal(foreign.status, 403);
    const cookie = createSessionCookie(new Request(url)).split(';')[0];
    const allowed = GET(new Request(url, { headers: { cookie, host: '127.0.0.1:3100' } }));
    assert.equal(allowed.status, 200); const data = (await allowed.json()).data;
    assert.equal(data.decision, 'NO_GO'); assert.equal(data.record.version, 1);
    assert.equal(GET(new Request(`${url}?override=go`, { headers: { cookie, host: '127.0.0.1:3100' } })).status, 400);
  } finally {
    for (const key of Object.keys(values)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});
