import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ExternalNotificationPreferences, NotificationExport, NotificationOperatorSummary, NotificationPurpose, NotificationReason, NotificationReceiptStatus, NotificationState, NotificationSuppression, OwnedNotification } from '../../../packages/domain/notification-contracts.ts';
import type { DigestDispatchReference } from '../../../packages/domain/distribution-contracts.ts';
import { readYouthAccess } from './youth-repository.ts';
import { RepositoryError } from './errors.ts';
import { objectInput } from './http.ts';
import { decryptNotification, encryptNotification, notificationEncryptionConfigured, notificationWebhookConfigured } from './notification-crypto.ts';
import { trustedNotificationOrigin, validNotificationAddress, validNotificationSender, type DeliveryResult, type NotificationConfiguration, type NotificationMessage } from './notification-delivery.ts';

const STATES: NotificationState[] = ['BLOCKED', 'QUEUED', 'LEASED', 'RETRY', 'ACCEPTED', 'DEAD_LETTER', 'CANCELLED'];
const PURPOSES: NotificationPurpose[] = ['VERIFY_EMAIL', 'RESET_PASSWORD', 'EVENT_REMINDER', 'DIGEST'];
const RECEIPTS: NotificationReceiptStatus[] = ['DELIVERED', 'FAILED', 'BOUNCED', 'COMPLAINED'];
const ACTIVE = "('BLOCKED','QUEUED','LEASED','RETRY')";
const MAX_ATTEMPTS = 5, LEASE_MS = 60_000, IDEMPOTENCY_MS = 23 * 60 * 60 * 1000;
const RECEIPT_RETENTION_MS = 30 * 86400000;
const fail = (code: string, status: number, message: string): never => { throw new RepositoryError(code, status, message); };
export type IdentityNotification = { purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD'; accountId: string; email: string; token: string; expiresAt: string };
export type NotificationOccurrence = { opportunityId: string; occurrenceId: string; opportunityVersion: number; startsAt: string };
export type NotificationOwner = { exists: boolean; profileVersion: number | null; email: string | null; verified: boolean; adult: boolean; student: boolean; demo: boolean; optionalConsentCurrent: boolean };
type Envelope = { origin: string; to: string; subject: string; text: string; frozenMessage?: NotificationMessage };
type OutboxRow = { id: string; account_id: string; purpose: NotificationPurpose; state: NotificationState; dedupe_key: string; idempotency_key: string; envelope: string | null; profile_version: number | null; consent_version: number | null; reference_json: string | null; token_hash: string | null; expires_at: string; created_at: string; updated_at: string; next_attempt_at: string | null; attempts: number; reason: NotificationReason; lease_token: string | null; lease_until: string | null; dispatch_started_at: string | null; first_attempt_at: string | null; provider_accepted_at: string | null; provider_email_id: string | null; receipt_status: NotificationReceiptStatus | null; receipt_occurred_at: string | null; receipt_received_at: string | null };
type PreferenceRow = { enabled: number; version: number; updated_at: string };
type ReceiptCorrelation = { outbox_id: string; account_id: string; lease_token: string | null; provider_email_id: string | null; expires_at: string };
export type NotificationLease = { id: string; token: string };
export type ResendReceipt = { eventId: string; providerEmailId: string; status: NotificationReceiptStatus; occurredAt: string };
export type NotificationStoreOptions = { config: () => NotificationConfiguration; owner?: (id: string) => NotificationOwner; occurrenceAvailable?: (owner: string, occurrence: NotificationOccurrence, now: Date) => boolean; digestCurrent?: (owner: string, reference: DigestDispatchReference, now: Date) => boolean; accountTokenAvailable?: (message: { purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD'; accountId: string; tokenHash: string; expiresAt: string }, now: Date) => boolean };
const hasTable = (db: DatabaseSync, name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
function profileVersion(db: DatabaseSync, owner: string): number | null {
  if (!hasTable(db, 'student_profiles')) return null;
  const row = db.prepare('SELECT profile_json FROM student_profiles WHERE persona_id=?').get(owner) as { profile_json: string } | undefined;
  return row ? (JSON.parse(row.profile_json) as { version: number }).version : null;
}
export function notificationOwner(db: DatabaseSync, owner: string): NotificationOwner {
  const version = profileVersion(db, owner), demo = owner === 'demo-alex' || owner === 'demo-sam';
  if (demo || !hasTable(db, 'accounts')) return { exists: demo && version !== null, profileVersion: version, email: null, verified: false, adult: false, student: false, demo, optionalConsentCurrent: false };
  const row = db.prepare('SELECT email_norm,email_verified_at,adult_attested_at,role FROM accounts WHERE id=?').get(owner) as { email_norm: string; email_verified_at: string | null; adult_attested_at: string | null; role: string } | undefined;
  const privacy = hasTable(db, 'student_privacy') ? db.prepare('SELECT policy_version,adult_confirmed FROM student_privacy WHERE owner=?').get(owner) as { policy_version: string; adult_confirmed: number } | undefined : undefined;
  const profileRow = version !== null ? db.prepare('SELECT profile_json FROM student_profiles WHERE persona_id=?').get(owner) as { profile_json: string } | undefined : undefined;
  const profile = profileRow ? JSON.parse(profileRow.profile_json) as { consentVersion: string; preferences: { ageMin: number } } : null;
  const access = readYouthAccess(db, owner), adult = !!row?.adult_attested_at && access.ageBand === 'ADULT' && access.admission === 'ADMITTED';
  const optionalConsentCurrent = adult && privacy?.policy_version === 'adult-account-v1' && privacy.adult_confirmed === 1 && profile?.consentVersion === 'adult-account-v1' && profile.preferences.ageMin >= 18;
  return { exists: !!row, profileVersion: version, email: row?.email_norm ?? null, verified: !!row?.email_verified_at, adult, student: row?.role === 'STUDENT', demo: false, optionalConsentCurrent };
}
/** Runs after receipt FK migration, so dropping the old outbox cannot cascade receipts.
 * Keep every encrypted payload, lease, provider correlation and explicit index. */
function migrateDigestPurpose(db: DatabaseSync): void {
  const schema = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='notification_outbox'").get() as { sql: string }).sql;
  if (schema.includes("'DIGEST'")) return;
  db.exec('SAVEPOINT notification_digest_migration');
  try {
    const dependents = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).filter(table => (db.prepare(`PRAGMA foreign_key_list("${table.name.replaceAll('"', '""')}")`).all() as { table: string }[]).some(key => key.table === 'notification_outbox'));
    if (dependents.length) return fail('NOTIFICATION_MIGRATION_REQUIRED', 503, 'Unexpected outbox dependencies require a reviewed migration.');
    const objects = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='notification_outbox' AND type IN('index','trigger') AND sql IS NOT NULL").all() as { sql: string }[];
    const upgraded = schema.replace(/CREATE TABLE\s+(?:"notification_outbox"|notification_outbox)/i, 'CREATE TABLE notification_outbox_digest_new').replace("'EVENT_REMINDER'", "'EVENT_REMINDER','DIGEST'");
    if (upgraded === schema || !upgraded.includes("'DIGEST'")) return fail('NOTIFICATION_MIGRATION_REQUIRED', 503, 'The outbox purpose schema requires review.');
    db.exec(upgraded);
    if (db.prepare('SELECT 1 FROM notification_outbox LIMIT 1').get()) db.exec('INSERT INTO notification_outbox_digest_new SELECT * FROM notification_outbox');
    db.exec('DROP TABLE notification_outbox; ALTER TABLE notification_outbox_digest_new RENAME TO notification_outbox;');
    for (const object of objects) db.exec(object.sql);
    if (db.prepare('PRAGMA foreign_key_check').all().length) return fail('NOTIFICATION_MIGRATION_REQUIRED', 503, 'The outbox migration failed its foreign-key check.');
    db.exec('RELEASE notification_digest_migration');
  } catch (error) { db.exec('ROLLBACK TO notification_digest_migration; RELEASE notification_digest_migration'); throw error; }
}
export function initializeNotificationSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_clock(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO notification_clock VALUES(1,0);
    CREATE TABLE IF NOT EXISTS notification_preferences(owner TEXT PRIMARY KEY REFERENCES student_profiles(persona_id) ON DELETE CASCADE,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),version INTEGER NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notification_outbox(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,purpose TEXT NOT NULL CHECK(purpose IN ('VERIFY_EMAIL','RESET_PASSWORD','EVENT_REMINDER','DIGEST')),state TEXT NOT NULL CHECK(state IN ('BLOCKED','QUEUED','LEASED','RETRY','ACCEPTED','DEAD_LETTER','CANCELLED')),dedupe_key TEXT NOT NULL UNIQUE,idempotency_key TEXT NOT NULL UNIQUE,envelope TEXT,profile_version INTEGER,consent_version INTEGER,reference_json TEXT,token_hash TEXT,expires_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,next_attempt_at TEXT,attempts INTEGER NOT NULL DEFAULT 0,reason TEXT,lease_token TEXT,lease_until TEXT,dispatch_started_at TEXT,first_attempt_at TEXT,provider_accepted_at TEXT);
    CREATE INDEX IF NOT EXISTS notification_outbox_due ON notification_outbox(state,next_attempt_at);
    CREATE INDEX IF NOT EXISTS notification_outbox_owner ON notification_outbox(account_id,created_at);
    CREATE TABLE IF NOT EXISTS notification_scan_cursor(singleton INTEGER PRIMARY KEY CHECK(singleton=1),owner TEXT NOT NULL,opportunity_id TEXT NOT NULL,occurrence_id TEXT NOT NULL);
    INSERT OR IGNORE INTO notification_scan_cursor VALUES(1,'','','');
  `);
  // Additive migration preserves existing encrypted jobs and their retry leases.
  const columns = new Set((db.prepare('PRAGMA table_info(notification_outbox)').all() as { name: string }[]).map(column => column.name));
  for (const name of ['provider_email_id', 'receipt_status', 'receipt_occurred_at', 'receipt_received_at']) if (!columns.has(name)) db.exec(`ALTER TABLE notification_outbox ADD COLUMN ${name} TEXT`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS notification_provider_email ON notification_outbox(provider_email_id) WHERE provider_email_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS notification_suppression(account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,reason TEXT NOT NULL CHECK(reason IN ('BOUNCED','COMPLAINED')),created_at TEXT NOT NULL);`);
  const needsCorrelationBackfill = !hasTable(db, 'notification_receipt_correlations');
  const oldReceiptParent = hasTable(db, 'notification_receipt_events') && (db.prepare('PRAGMA foreign_key_list(notification_receipt_events)').all() as { table: string }[]).some(key => key.table === 'notification_outbox');
  // SAVEPOINT also works when identity enqueue already owns a transaction. A failed
  // FK migration must leave the original receipt ledger and associations intact.
  db.exec('SAVEPOINT notification_receipt_migration');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS notification_receipt_correlations(outbox_id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,lease_token TEXT,provider_email_id TEXT UNIQUE,expires_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS notification_correlation_expiry ON notification_receipt_correlations(expires_at);`);
    if (needsCorrelationBackfill && hasTable(db, 'accounts')) db.exec(`INSERT INTO notification_receipt_correlations(outbox_id,account_id,lease_token,provider_email_id,expires_at)
      SELECT id,account_id,CASE WHEN provider_email_id IS NULL THEN lease_token ELSE NULL END,provider_email_id,strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(dispatch_started_at,provider_accepted_at),'+30 days')
      FROM notification_outbox WHERE (provider_email_id IS NOT NULL AND provider_accepted_at IS NOT NULL) OR dispatch_started_at IS NOT NULL ON CONFLICT(outbox_id) DO NOTHING;`);
    if (oldReceiptParent) db.exec('ALTER TABLE notification_receipt_events RENAME TO notification_receipt_events_legacy;');
    db.exec("CREATE TABLE IF NOT EXISTS notification_receipt_events(event_id TEXT PRIMARY KEY,outbox_id TEXT NOT NULL REFERENCES notification_receipt_correlations(outbox_id) ON DELETE CASCADE,status TEXT NOT NULL CHECK(status IN ('DELIVERED','FAILED','BOUNCED','COMPLAINED')),occurred_at TEXT NOT NULL,received_at TEXT NOT NULL);");
    if (oldReceiptParent) db.exec('INSERT INTO notification_receipt_events SELECT * FROM notification_receipt_events_legacy; DROP TABLE notification_receipt_events_legacy;');
    db.exec('CREATE INDEX IF NOT EXISTS notification_receipt_outbox ON notification_receipt_events(outbox_id); RELEASE notification_receipt_migration;');
  } catch (error) { db.exec('ROLLBACK TO notification_receipt_migration; RELEASE notification_receipt_migration;'); throw error; }
  migrateDigestPurpose(db);
}
export function notificationSuppression(db: DatabaseSync, owner: string): NotificationSuppression | null {
  return hasTable(db, 'notification_suppression') ? db.prepare('SELECT reason,created_at AS createdAt FROM notification_suppression WHERE account_id=?').get(owner) as NotificationSuppression | undefined ?? null : null;
}
function assertNotSuppressed(db: DatabaseSync, owner: string): void {
  if (notificationSuppression(db, owner)) fail('NOTIFICATION_RECIPIENT_SUPPRESSED', 409, 'Email is stopped after a delivery failure or complaint. Account recovery and reminders cannot bypass this restriction.');
}
function basePreferences(db: DatabaseSync, owner: string): NotificationExport['preferences'] {
  const row = hasTable(db, 'notification_preferences') ? db.prepare('SELECT enabled,version,updated_at FROM notification_preferences WHERE owner=?').get(owner) as PreferenceRow | undefined : undefined;
  return { enabled: !!row?.enabled, version: row?.version ?? 0, profileVersion: profileVersion(db, owner), updatedAt: row?.updated_at ?? null };
}
function ownedDto(row: OutboxRow): OwnedNotification {
  const reference = row.purpose === 'EVENT_REMINDER' && row.reference_json ? JSON.parse(row.reference_json) as NotificationOccurrence : null;
  const receipt = row.receipt_status && row.receipt_occurred_at && row.receipt_received_at ? { status: row.receipt_status, occurredAt: row.receipt_occurred_at, receivedAt: row.receipt_received_at } : null;
  return { id: row.id, purpose: row.purpose, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at, nextAttemptAt: row.next_attempt_at, attempts: row.attempts, reason: row.reason, opportunityId: reference?.opportunityId ?? null, occurrenceId: reference?.occurrenceId ?? null, providerAcceptedAt: row.provider_accepted_at, cancellationMayBeInFlight: row.state === 'CANCELLED' && !!row.dispatch_started_at, receipt };
}
/** Safe for privacy export before notification tables have ever been initialized. */
export function exportOwnerNotifications(db: DatabaseSync, owner: string, now = new Date()): NotificationExport {
  const retainedReceiptCorrelations = hasTable(db, 'notification_receipt_correlations') ? db.prepare('SELECT COUNT(*) AS count,MAX(expires_at) AS latestExpiresAt FROM notification_receipt_correlations WHERE account_id=? AND expires_at>?').get(owner, now.toISOString()) as NotificationExport['retainedReceiptCorrelations'] : { count: 0, latestExpiresAt: null };
  return { preferences: basePreferences(db, owner), outbox: hasTable(db, 'notification_outbox') ? (db.prepare('SELECT * FROM notification_outbox WHERE account_id=? ORDER BY created_at,id').all(owner) as OutboxRow[]).map(ownedDto) : [], suppression: notificationSuppression(db, owner), retainedReceiptCorrelations: { ...retainedReceiptCorrelations } };
}
/** Caller owns the transaction. Profile history is erased; minimal account-owned
 * receipt correlations survive for at most 30 days, or cascade on account deletion. */
export function purgeOwnerNotifications(db: DatabaseSync, owner: string): void {
  if (hasTable(db, 'notification_outbox') && hasTable(db, 'accounts')) db.prepare('DELETE FROM notification_outbox WHERE account_id=?').run(owner);
  if (hasTable(db, 'notification_preferences') && hasTable(db, 'student_profiles')) db.prepare('DELETE FROM notification_preferences WHERE owner=?').run(owner);
  if (hasTable(db, 'notification_scan_cursor')) db.prepare("UPDATE notification_scan_cursor SET owner='',opportunity_id='',occurrence_id='' WHERE owner=?").run(owner);
}
/** Restore tooling must call this before releasing a restored database. */
export function cancelRestoredNotifications(db: DatabaseSync, now = new Date()): void {
  if (!hasTable(db, 'notification_outbox')) return;
  db.prepare(`UPDATE notification_outbox SET state='CANCELLED',reason='RESTORE_QUARANTINE',envelope=NULL,token_hash=NULL,next_attempt_at=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE state IN ${ACTIVE}`).run(now.toISOString());
  // A restored pending lease cannot authorize settlement by a pre-restore worker.
  if (hasTable(db, 'notification_receipt_correlations') && hasTable(db, 'accounts')) db.prepare('DELETE FROM notification_receipt_correlations WHERE provider_email_id IS NULL OR expires_at<=?').run(now.toISOString());
}
/** Maintenance runs even while provider delivery is disabled. Never sends. */
export function pruneNotifications(db: DatabaseSync, now = new Date()): void {
  // Demo inspection can initialize the empty queue before account tables exist.
  if (!hasTable(db, 'notification_outbox') || !hasTable(db, 'accounts')) return;
  db.prepare(`UPDATE notification_outbox SET state='CANCELLED',reason=CASE WHEN purpose IN('EVENT_REMINDER','DIGEST') THEN 'OPPORTUNITY_UNAVAILABLE' ELSE 'TOKEN_EXPIRED' END,envelope=NULL,next_attempt_at=NULL,lease_until=NULL,updated_at=? WHERE state IN ${ACTIVE} AND expires_at<=?`).run(now.toISOString(), now.toISOString());
  db.prepare("DELETE FROM notification_outbox WHERE state IN ('ACCEPTED','DEAD_LETTER','CANCELLED') AND updated_at<?").run(new Date(now.getTime() - 30 * 86400000).toISOString());
  // Cascades the replay ledger too. Receipt activity never extends this deadline.
  if (hasTable(db, 'notification_receipt_correlations')) db.prepare('DELETE FROM notification_receipt_correlations WHERE expires_at<=?').run(now.toISOString());
}
export function notificationQueueOrigin(config: NotificationConfiguration): string | null {
  if (config.mode === 'production') return trustedNotificationOrigin(config.origin);
  if (config.mode !== 'test') return null;
  try { const url = new URL(config.origin ?? ''); return /^https?:$/.test(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' ? url.origin : null; } catch { return null; }
}
export function notificationConfigured(config: NotificationConfiguration): boolean { return !!notificationQueueOrigin(config) && notificationEncryptionConfigured(config.encryptionKey) && !!config.apiKey && validNotificationSender(config.from); }
function canSend(config: NotificationConfiguration): boolean { return config.mode === 'production' && config.deliveryEnabled && notificationConfigured(config); }
function queueEnvelope(db: DatabaseSync, input: { owner: string; purpose: NotificationPurpose; dedupeKey: string; payload: Envelope; profileVersion?: number; consentVersion?: number; reference?: NotificationOccurrence | DigestDispatchReference; tokenHash?: string; expiresAt: string }, config: NotificationConfiguration, now: Date): OwnedNotification {
  const existing = db.prepare('SELECT * FROM notification_outbox WHERE dedupe_key=?').get(input.dedupeKey) as OutboxRow | undefined;
  if (existing) return ownedDto(existing);
  const id = randomUUID(), at = now.toISOString(), ready = canSend(config);
  db.prepare('INSERT INTO notification_outbox(id,account_id,purpose,state,dedupe_key,idempotency_key,envelope,profile_version,consent_version,reference_json,token_hash,expires_at,created_at,updated_at,next_attempt_at,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, input.owner, input.purpose, ready ? 'QUEUED' : 'BLOCKED', input.dedupeKey, `comground-${id}`, encryptNotification(input.payload, id, config.encryptionKey), input.profileVersion ?? null, input.consentVersion ?? null, input.reference ? JSON.stringify(input.reference) : null, input.tokenHash ?? null, input.expiresAt, at, at, at, ready ? null : 'CONFIGURATION_BLOCKED');
  return ownedDto(db.prepare('SELECT * FROM notification_outbox WHERE id=?').get(id) as OutboxRow);
}
/** Synchronous insertion participates in the identity transaction; never begins its own. */
export function enqueueIdentityNotification(db: DatabaseSync, message: IdentityNotification, config: NotificationConfiguration, now = new Date()): OwnedNotification {
  initializeNotificationSchema(db);
  assertNotSuppressed(db, message.accountId);
  if (readYouthAccess(db, message.accountId).ageBand !== 'ADULT') return fail('TEEN_EMAIL_DISABLED', 403, 'Outbound email is disabled for teen accounts.');
  const origin = notificationQueueOrigin(config);
  if (!origin || !notificationEncryptionConfigured(config.encryptionKey)) return fail('NOTIFICATION_CONFIGURATION_MISSING', 503, 'Account email requires a configured origin and encrypted outbox. External delivery can remain disabled.');
  if (!validNotificationAddress(message.email) || !/^account-[a-f0-9-]{36}$/i.test(message.accountId) || !/^[A-Za-z0-9_-]{32,256}$/.test(message.token) || !Number.isFinite(Date.parse(message.expiresAt)) || Date.parse(message.expiresAt) <= now.getTime()) return fail('INVALID_NOTIFICATION', 422, 'A valid pending account action is required.');
  const tokenHash = createHash('sha256').update(message.token).digest('hex');
  const path = message.purpose === 'VERIFY_EMAIL' ? '/account/verify' : '/account/reset';
  const link = `${origin}${path}#token=${encodeURIComponent(message.token)}`;
  const subject = message.purpose === 'VERIFY_EMAIL' ? 'Verify your CommonGround email' : 'Reset your CommonGround password';
  const text = `${message.purpose === 'VERIFY_EMAIL' ? 'You requested an account on CommonGround. Verify your email to continue.' : 'You requested a CommonGround password reset.'}\n\n${link}\n\nThis link expires at ${message.expiresAt}. If you did not request this, ignore this message. This is an account security message, not an optional reminder.`;
  const dedupeKey = createHash('sha256').update(`${message.accountId}:${message.purpose}:${tokenHash}`).digest('hex');
  return queueEnvelope(db, { owner: message.accountId, purpose: message.purpose, dedupeKey, payload: { origin, to: message.email, subject, text }, tokenHash, expiresAt: message.expiresAt }, config, now);
}

export function createNotificationStore(db: DatabaseSync, options: NotificationStoreOptions) {
  initializeNotificationSchema(db);
  const ownerState = options.owner ?? ((owner: string) => notificationOwner(db, owner));
  function transaction<T>(action: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const result = action(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  function preferences(owner: string): ExternalNotificationPreferences {
    const base = basePreferences(db, owner), account = ownerState(owner), config = options.config(), suppression = notificationSuppression(db, owner);
    const availability = account.demo || config.mode === 'demo' ? 'DEMO_DISABLED' : suppression ? 'RECIPIENT_SUPPRESSED' : !account.verified ? 'VERIFICATION_REQUIRED' : !config.deliveryEnabled ? 'DELIVERY_DISABLED' : !notificationConfigured(config) ? 'CONFIGURATION_MISSING' : 'READY';
    return { ...base, profileVersion: account.profileVersion, recipientVerified: account.verified, availability, provider: 'RESEND', purpose: 'OPTIONAL_EVENT_REMINDERS', suppression };
  }
  function cancelOptional(owner: string, reason: NotificationReason, now: Date): void {
    db.prepare(`UPDATE notification_outbox SET state='CANCELLED',reason=?,envelope=NULL,next_attempt_at=NULL,updated_at=? WHERE account_id=? AND purpose='EVENT_REMINDER' AND state IN ${ACTIVE}`).run(reason, now.toISOString(), owner);
  }
  function setPreferences(owner: string, input: unknown, now = new Date()): ExternalNotificationPreferences {
    const value = objectInput(input, ['expectedVersion', 'expectedProfileVersion', 'enabled']);
    if (!Number.isSafeInteger(value.expectedVersion) || Number(value.expectedVersion) < 0 || !Number.isSafeInteger(value.expectedProfileVersion) || Number(value.expectedProfileVersion) < 1 || typeof value.enabled !== 'boolean') return fail('INVALID_INPUT', 422, 'Provide the current profile and notification versions and an enabled choice.');
    return transaction(() => {
      const account = ownerState(owner), current = preferences(owner);
      if (!account.exists || account.profileVersion === null) return fail('CONSENT_REQUIRED', 403, 'Create a current profile before choosing optional reminders.');
      if (current.version !== value.expectedVersion || account.profileVersion !== value.expectedProfileVersion) return fail('VERSION_CONFLICT', 409, 'Profile or notification settings changed. Reload before saving.');
      if (value.enabled) assertNotSuppressed(db, owner);
      if (value.enabled && (account.demo || !account.verified || !account.adult || !account.student)) return fail('VERIFICATION_REQUIRED', 403, 'Optional external reminders require a verified adult student account.');
      if (value.enabled && !account.optionalConsentCurrent) return fail('CONSENT_REQUIRED', 403, 'Current adult profile consent is required for optional reminders.');
      if (current.enabled !== value.enabled) {
        const revision = (db.prepare('SELECT revision FROM notification_clock WHERE singleton=1').get() as { revision: number }).revision + 1;
        if (!Number.isSafeInteger(revision)) return fail('REVISION_UNAVAILABLE', 503, 'The notification revision is unavailable.');
        db.prepare('UPDATE notification_clock SET revision=? WHERE singleton=1').run(revision);
        db.prepare('INSERT INTO notification_preferences(owner,enabled,version,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET enabled=excluded.enabled,version=excluded.version,updated_at=excluded.updated_at').run(owner, value.enabled ? 1 : 0, revision, now.toISOString());
      }
      if (!value.enabled) cancelOptional(owner, 'CONSENT_WITHDRAWN', now);
      return preferences(owner);
    });
  }
  function enqueueReminderWithResult(owner: string, occurrence: NotificationOccurrence, now = new Date()): { notification: OwnedNotification; created: boolean } {
    return transaction(() => {
      const account = ownerState(owner), consent = preferences(owner), config = options.config(), origin = notificationQueueOrigin(config);
      assertNotSuppressed(db, owner);
      if (account.demo || !account.exists || !account.verified || !account.adult || !account.student || account.profileVersion === null || !validNotificationAddress(account.email)) return fail('VERIFICATION_REQUIRED', 403, 'A verified adult student recipient is required.');
      if (!account.optionalConsentCurrent) return fail('CONSENT_REQUIRED', 403, 'Current adult profile consent is required for optional reminders.');
      if (!consent.enabled) return fail('NOTIFICATION_CONSENT_REQUIRED', 403, 'Optional external reminders are off.');
      if (!origin || !notificationEncryptionConfigured(config.encryptionKey)) return fail('NOTIFICATION_CONFIGURATION_MISSING', 503, 'The encrypted notification outbox is not configured.');
      if (!options.occurrenceAvailable?.(owner, occurrence, now) || Date.parse(occurrence.startsAt) <= now.getTime()) return fail('OCCURRENCE_UNAVAILABLE', 409, 'This occurrence is no longer available or eligible.');
      const link = `${origin}/opportunities/${encodeURIComponent(occurrence.opportunityId)}?occurrence=${encodeURIComponent(occurrence.occurrenceId)}`;
      const dedupeKey = createHash('sha256').update(`${owner}:EVENT_REMINDER:${consent.version}:${JSON.stringify(occurrence)}`).digest('hex');
      const created = !db.prepare('SELECT 1 FROM notification_outbox WHERE dedupe_key=?').get(dedupeKey);
      const notification = queueEnvelope(db, { owner, purpose: 'EVENT_REMINDER', dedupeKey, payload: { origin, to: account.email, subject: 'Your CommonGround volunteering reminder', text: `You opted in to an event reminder on CommonGround. Sign in to check the current date, eligibility and organizer information before acting.\n\n${link}\n\nThis message does not confirm an application or attendance. Manage or stop optional emails in your CommonGround notification settings.` }, profileVersion: account.profileVersion, consentVersion: consent.version, reference: occurrence, expiresAt: occurrence.startsAt }, config, now);
      return { notification, created };
    });
  }
  function enqueueReminder(owner: string, occurrence: NotificationOccurrence, now = new Date()): OwnedNotification { return enqueueReminderWithResult(owner, occurrence, now).notification; }
  function enqueueDigest(owner: string, reference: DigestDispatchReference, now = new Date()): OwnedNotification {
    return transaction(() => {
      const account = ownerState(owner), config = options.config(), origin = notificationQueueOrigin(config);
      assertNotSuppressed(db, owner);
      if (account.demo || !account.exists || !account.verified || !account.adult || !account.student || account.profileVersion === null || !validNotificationAddress(account.email)) return fail('VERIFICATION_REQUIRED', 403, 'A verified adult student recipient is required.');
      if (!account.optionalConsentCurrent) return fail('CONSENT_REQUIRED', 403, 'Current adult profile consent is required for digest emails.');
      if (!origin || !notificationEncryptionConfigured(config.encryptionKey)) return fail('NOTIFICATION_CONFIGURATION_MISSING', 503, 'The encrypted notification outbox is not configured.');
      if (!reference || typeof reference.batchId !== 'string' || !/^[a-f0-9-]{36}$/.test(reference.batchId) || ![reference.batchVersion, reference.subscriptionVersion, reference.profileVersion].every(value => Number.isSafeInteger(value) && value > 0) || reference.profileVersion !== account.profileVersion || !options.digestCurrent?.(owner, reference, now)) return fail('DIGEST_APPROVAL_REQUIRED', 409, 'A current reviewed batch and unchanged digest subscription are required.');
      const dedupeKey = createHash('sha256').update(`${owner}:DIGEST:${reference.batchId}:${reference.batchVersion}`).digest('hex');
      return queueEnvelope(db, { owner, purpose: 'DIGEST', dedupeKey, payload: { origin, to: account.email, subject: 'Your CommonGround shortlist is ready to review', text: `You chose optional shortlist digests on CommonGround. Sign in to review the current opportunities and dates before taking a next step.\n\n${origin}/digest\n\nThis message does not confirm an application or attendance. You can stop shortlist digest emails on the same page. Event reminders are a separate choice.` }, profileVersion: reference.profileVersion, consentVersion: reference.subscriptionVersion, reference, expiresAt: new Date(now.getTime() + 86400000).toISOString() }, config, now);
    });
  }
  function row(id: string): OutboxRow | undefined { return db.prepare('SELECT * FROM notification_outbox WHERE id=?').get(id) as OutboxRow | undefined; }
  function finish(id: string, state: NotificationState, reason: NotificationReason, now: Date): void { db.prepare('UPDATE notification_outbox SET state=?,reason=?,envelope=NULL,next_attempt_at=NULL,lease_until=NULL,updated_at=? WHERE id=?').run(state, reason, now.toISOString(), id); }
  function tokenAvailable(item: OutboxRow, now: Date): boolean {
    if (!item.token_hash || item.purpose !== 'VERIFY_EMAIL' && item.purpose !== 'RESET_PASSWORD') return false;
    if (options.accountTokenAvailable) return options.accountTokenAvailable({ purpose: item.purpose, accountId: item.account_id, tokenHash: item.token_hash, expiresAt: item.expires_at }, now);
    if (!hasTable(db, 'account_action_tokens')) return false;
    return !!db.prepare('SELECT 1 FROM account_action_tokens WHERE account_id=? AND token_hash=? AND purpose=? AND expires_at=? AND used_at IS NULL').get(item.account_id, item.token_hash, item.purpose, item.expires_at);
  }
  function invalidReason(item: OutboxRow, now: Date): NotificationReason {
    const account = ownerState(item.account_id);
    if (!account.exists || account.demo || !account.adult) return 'OWNER_UNAVAILABLE';
    if (notificationSuppression(db, item.account_id)) return 'RECIPIENT_SUPPRESSED';
    if (Date.parse(item.expires_at) <= now.getTime()) return item.purpose === 'EVENT_REMINDER' || item.purpose === 'DIGEST' ? 'OPPORTUNITY_UNAVAILABLE' : 'TOKEN_EXPIRED';
    if (item.purpose === 'VERIFY_EMAIL' || item.purpose === 'RESET_PASSWORD') return !tokenAvailable(item, now) || item.purpose === 'VERIFY_EMAIL' && account.verified || item.purpose === 'RESET_PASSWORD' && !account.verified ? 'TOKEN_EXPIRED' : null;
    if (!account.verified || !account.adult || !account.student) return 'RECIPIENT_UNVERIFIED';
    if (!account.optionalConsentCurrent) return 'CONSENT_WITHDRAWN';
    if (item.purpose === 'DIGEST') {
      const reference = item.reference_json ? JSON.parse(item.reference_json) as DigestDispatchReference : null;
      if (!reference || reference.profileVersion !== account.profileVersion || reference.profileVersion !== item.profile_version || reference.subscriptionVersion !== item.consent_version) return 'CONSENT_CHANGED';
      return options.digestCurrent?.(item.account_id, reference, now) ? null : 'CONSENT_CHANGED';
    }
    const consent = preferences(item.account_id);
    if (!consent.enabled) return 'CONSENT_WITHDRAWN';
    if (consent.version !== item.consent_version || account.profileVersion !== item.profile_version) return 'CONSENT_CHANGED';
    const reference = item.reference_json ? JSON.parse(item.reference_json) as NotificationOccurrence : null;
    return !reference || !options.occurrenceAvailable?.(item.account_id, reference, now) ? 'OPPORTUNITY_UNAVAILABLE' : null;
  }
  function claim(now = new Date()): NotificationLease | null {
    if (!canSend(options.config())) return null;
    return transaction(() => {
      db.prepare("UPDATE notification_receipt_correlations SET lease_token=NULL WHERE provider_email_id IS NULL AND outbox_id IN (SELECT id FROM notification_outbox WHERE state='LEASED' AND lease_until<=?)").run(now.toISOString());
      db.prepare("UPDATE notification_outbox SET state='RETRY',next_attempt_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE state='LEASED' AND lease_until<=?").run(now.toISOString(), now.toISOString(), now.toISOString());
      const candidate = db.prepare("SELECT * FROM notification_outbox WHERE state IN ('BLOCKED','QUEUED','RETRY') AND next_attempt_at<=? ORDER BY next_attempt_at,created_at,id LIMIT 1").get(now.toISOString()) as OutboxRow | undefined;
      if (!candidate) return null;
      const token = randomUUID();
      db.prepare("UPDATE notification_outbox SET state='LEASED',lease_token=?,lease_until=?,updated_at=? WHERE id=?").run(token, new Date(now.getTime() + LEASE_MS).toISOString(), now.toISOString(), candidate.id);
      return { id: candidate.id, token };
    });
  }
  function prepare(lease: NotificationLease, now = new Date()): { message: NotificationMessage; idempotencyKey: string } | null {
    return transaction(() => {
      const item = row(lease.id), config = options.config();
      if (!item || item.state !== 'LEASED' || item.lease_token !== lease.token || !item.lease_until || Date.parse(item.lease_until) <= now.getTime()) return null;
      if (!canSend(config)) { db.prepare("UPDATE notification_outbox SET state='BLOCKED',reason='CONFIGURATION_BLOCKED',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now.toISOString(), item.id); return null; }
      const invalid = invalidReason(item, now);
      if (invalid) { finish(item.id, 'CANCELLED', invalid, now); return null; }
      if (item.attempts >= MAX_ATTEMPTS) { finish(item.id, 'DEAD_LETTER', 'MAX_ATTEMPTS', now); return null; }
      if (item.first_attempt_at && now.getTime() - Date.parse(item.first_attempt_at) >= IDEMPOTENCY_MS) { finish(item.id, 'DEAD_LETTER', 'IDEMPOTENCY_WINDOW_EXPIRED', now); return null; }
      let payload: Envelope;
      try { payload = decryptNotification<Envelope>(item.envelope ?? '', item.id, config.encryptionKey); } catch { finish(item.id, 'DEAD_LETTER', 'PAYLOAD_UNAVAILABLE', now); return null; }
      if (payload.origin !== notificationQueueOrigin(config) || payload.to !== ownerState(item.account_id).email) { finish(item.id, 'CANCELLED', 'OWNER_UNAVAILABLE', now); return null; }
      const message = payload.frozenMessage ?? { from: config.from!, to: [payload.to], subject: payload.subject, text: payload.text };
      // Freeze the full provider payload on first dispatch. Retries reuse it exactly.
      if (!payload.frozenMessage) { payload.frozenMessage = message; db.prepare('UPDATE notification_outbox SET envelope=? WHERE id=?').run(encryptNotification(payload, item.id, config.encryptionKey), item.id); }
      const at = now.toISOString();
      db.prepare('UPDATE notification_outbox SET attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?),dispatch_started_at=?,updated_at=?,reason=NULL WHERE id=?').run(at, at, at, item.id);
      // This account-owned lease survives profile withdrawal so the already-started
      // request can retain its provider ID without restoring any deleted history.
      db.prepare(`INSERT INTO notification_receipt_correlations(outbox_id,account_id,lease_token,provider_email_id,expires_at) VALUES(?,?,?,NULL,?)
        ON CONFLICT(outbox_id) DO UPDATE SET lease_token=excluded.lease_token,expires_at=excluded.expires_at WHERE notification_receipt_correlations.provider_email_id IS NULL`).run(item.id, item.account_id, lease.token, new Date(now.getTime() + RECEIPT_RETENTION_MS).toISOString());
      return { message, idempotencyKey: item.idempotency_key };
    });
  }
  function settle(lease: NotificationLease, result: DeliveryResult, now = new Date()): void {
    transaction(() => {
      const item = row(lease.id);
      if (item && (item.lease_token !== lease.token || !['LEASED', 'CANCELLED'].includes(item.state))) return;
      const correlation = db.prepare('SELECT * FROM notification_receipt_correlations WHERE outbox_id=? AND lease_token=? AND expires_at>?').get(lease.id, lease.token, now.toISOString()) as ReceiptCorrelation | undefined;
      if (!correlation || !db.prepare('SELECT 1 FROM accounts WHERE id=?').get(correlation.account_id)) return;
      if (result.kind === 'ACCEPTED' && !/^[A-Za-z0-9_-]{1,160}$/.test(result.providerId)) return fail('INVALID_PROVIDER_RESPONSE', 502, 'The provider acceptance reference is invalid.');
      if (result.kind === 'ACCEPTED') db.prepare('UPDATE notification_receipt_correlations SET provider_email_id=?,lease_token=NULL WHERE outbox_id=?').run(result.providerId, lease.id);
      else db.prepare('DELETE FROM notification_receipt_correlations WHERE outbox_id=? AND provider_email_id IS NULL').run(lease.id);
      if (!item) return;
      if (item.state === 'CANCELLED') { if (result.kind === 'ACCEPTED') db.prepare('UPDATE notification_outbox SET provider_email_id=?,provider_accepted_at=?,updated_at=? WHERE id=?').run(result.providerId, now.toISOString(), now.toISOString(), item.id); return; }
      if (result.kind === 'ACCEPTED') { finish(item.id, 'ACCEPTED', null, now); db.prepare('UPDATE notification_outbox SET provider_email_id=?,provider_accepted_at=? WHERE id=?').run(result.providerId, now.toISOString(), item.id); return; }
      if (result.kind === 'PERMANENT') { finish(item.id, 'DEAD_LETTER', result.reason, now); return; }
      if (item.attempts >= MAX_ATTEMPTS) { finish(item.id, 'DEAD_LETTER', 'MAX_ATTEMPTS', now); return; }
      const jitter = parseInt(createHash('sha256').update(item.id).digest('hex').slice(0, 4), 16) % 10;
      const seconds = Math.max(result.retryAfterSeconds ?? 0, Math.min(3600, 30 * 2 ** (item.attempts - 1)) + jitter);
      const next = new Date(now.getTime() + seconds * 1000);
      if (item.first_attempt_at && next.getTime() - Date.parse(item.first_attempt_at) >= IDEMPOTENCY_MS) { finish(item.id, 'DEAD_LETTER', 'IDEMPOTENCY_WINDOW_EXPIRED', now); return; }
      db.prepare("UPDATE notification_outbox SET state='RETRY',reason=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(result.reason, next.toISOString(), now.toISOString(), item.id);
    });
  }
  /** Called only after raw-body signature verification. Correlation is account-owned
   * so profile withdrawal cannot discard a later bounce or complaint. */
  function recordReceipt(receipt: ResendReceipt, now = new Date()): 'APPLIED' | 'DUPLICATE' | 'UNKNOWN' {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(receipt.eventId) || !/^[A-Za-z0-9_-]{1,160}$/.test(receipt.providerEmailId) || !RECEIPTS.includes(receipt.status) || !Number.isFinite(Date.parse(receipt.occurredAt)) || Date.parse(receipt.occurredAt) > now.getTime() + 300000) return fail('INVALID_WEBHOOK_EVENT', 422, 'The receipt event is invalid.');
    return transaction(() => {
      const correlation = db.prepare('SELECT * FROM notification_receipt_correlations WHERE provider_email_id=? AND expires_at>?').get(receipt.providerEmailId, now.toISOString()) as ReceiptCorrelation | undefined;
      if (!correlation || !db.prepare('SELECT 1 FROM accounts WHERE id=?').get(correlation.account_id)) return 'UNKNOWN';
      const existing = db.prepare('SELECT outbox_id,status,occurred_at FROM notification_receipt_events WHERE event_id=?').get(receipt.eventId) as { outbox_id: string; status: string; occurred_at: string } | undefined;
      if (existing) {
        if (existing.outbox_id !== correlation.outbox_id || existing.status !== receipt.status || existing.occurred_at !== receipt.occurredAt) return fail('WEBHOOK_EVENT_CONFLICT', 409, 'The receipt event conflicts with an existing event.');
        return 'DUPLICATE';
      }
      // Receipt IDs are retained only alongside a known job and bounded per job.
      const count = db.prepare('SELECT COUNT(*) AS n FROM notification_receipt_events WHERE outbox_id=?').get(correlation.outbox_id) as { n: number };
      if (count.n >= 64) return fail('WEBHOOK_EVENT_LIMIT', 429, 'The receipt history limit has been reached.');
      const receivedAt = now.toISOString();
      db.prepare('INSERT INTO notification_receipt_events(event_id,outbox_id,status,occurred_at,received_at) VALUES(?,?,?,?,?)').run(receipt.eventId, correlation.outbox_id, receipt.status, receipt.occurredAt, receivedAt);
      const current = row(correlation.outbox_id);
      if (current) {
        const previousRank = current.receipt_status ? RECEIPTS.indexOf(current.receipt_status) : -1, nextRank = RECEIPTS.indexOf(receipt.status);
        if (nextRank > previousRank || nextRank === previousRank && receipt.occurredAt > (current.receipt_occurred_at ?? '')) db.prepare('UPDATE notification_outbox SET receipt_status=?,receipt_occurred_at=?,receipt_received_at=?,updated_at=? WHERE id=?').run(receipt.status, receipt.occurredAt, receivedAt, receivedAt, current.id);
      }
      if (receipt.status === 'BOUNCED' || receipt.status === 'COMPLAINED') {
        db.prepare("INSERT INTO notification_suppression(account_id,reason,created_at) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET reason=CASE WHEN excluded.reason='COMPLAINED' THEN 'COMPLAINED' ELSE notification_suppression.reason END").run(correlation.account_id, receipt.status, receivedAt);
        // Security messages must not bypass a hard bounce or spam complaint either.
        db.prepare(`UPDATE notification_outbox SET state='CANCELLED',reason='RECIPIENT_SUPPRESSED',envelope=NULL,next_attempt_at=NULL,updated_at=? WHERE account_id=? AND state IN ${ACTIVE}`).run(receivedAt, correlation.account_id);
      }
      return 'APPLIED';
    });
  }
  function summary(now = new Date()): NotificationOperatorSummary {
    const counts = (purpose?: NotificationPurpose) => Object.fromEntries(STATES.map(state => {
      const count = (purpose ? db.prepare('SELECT COUNT(*) AS n FROM notification_outbox WHERE state=? AND purpose=?').get(state, purpose) : db.prepare('SELECT COUNT(*) AS n FROM notification_outbox WHERE state=?').get(state)) as { n: number };
      return [state, Number(count.n)];
    })) as Record<NotificationState, number>;
    const config = options.config();
    const receiptCounts = Object.fromEntries(RECEIPTS.map(status => [status, (db.prepare('SELECT COUNT(*) AS n FROM notification_outbox WHERE receipt_status=?').get(status) as { n: number }).n])) as Record<NotificationReceiptStatus, number>;
    const recentReceipts = (db.prepare('SELECT * FROM notification_outbox WHERE receipt_status IS NOT NULL ORDER BY receipt_received_at DESC,id LIMIT 50').all() as OutboxRow[]).map(item => ({ id: item.id, purpose: item.purpose, receipt: ownedDto(item).receipt! }));
    const suppressedAccounts = (db.prepare('SELECT COUNT(*) AS n FROM notification_suppression').get() as { n: number }).n;
    return { generatedAt: now.toISOString(), provider: 'RESEND', deliveryEnabled: canSend(config), configured: notificationConfigured(config), workerRequired: true, counts: counts(), byPurpose: PURPOSES.map(purpose => ({ purpose, counts: counts(purpose) })), deadLetters: (db.prepare("SELECT id,purpose,reason,attempts,updated_at AS updatedAt FROM notification_outbox WHERE state='DEAD_LETTER' ORDER BY updated_at DESC,id LIMIT 50").all() as NotificationOperatorSummary['deadLetters']), pendingRequests: (db.prepare(`SELECT id,purpose,state,reason,attempts,updated_at AS updatedAt FROM notification_outbox WHERE state IN ${ACTIVE} ORDER BY updated_at DESC,id LIMIT 50`).all() as NotificationOperatorSummary['pendingRequests']), receiptCounts, recentReceipts, suppressedAccounts, webhookConfigured: notificationWebhookConfigured(config.webhookKey), includesRecipients: false, includesMessageBodies: false, acceptedIsDeliveryConfirmation: false };
  }
  function cancel(id: string, input: unknown, now = new Date()): void {
    const value = objectInput(input, ['action', 'expectedUpdatedAt']);
    if (value.action !== 'CANCEL' || typeof value.expectedUpdatedAt !== 'string') return fail('INVALID_INPUT', 422, 'Choose a versioned cancellation.');
    transaction(() => { const current = row(id) ?? fail('NOT_FOUND', 404, 'Notification not found.'); if (current.updated_at !== value.expectedUpdatedAt) return fail('VERSION_CONFLICT', 409, 'Notification state changed. Reload before cancelling.'); if (current.state === 'ACCEPTED') return fail('STATE_CONFLICT', 409, 'The provider already accepted this message; it cannot be recalled here.'); finish(id, 'CANCELLED', 'MANUALLY_CANCELLED', now); });
  }
  function prune(now = new Date()): void { pruneNotifications(db, now); }
  return { preferences, setPreferences, enqueueReminder, enqueueReminderWithResult, enqueueDigest, claim, prepare, settle, recordReceipt, summary, cancel, prune, exportData: (owner: string, now = new Date()) => exportOwnerNotifications(db, owner, now), enabledOwners: () => (db.prepare('SELECT owner FROM notification_preferences WHERE enabled=1 ORDER BY owner').all() as { owner: string }[]).map(item => item.owner) };
}
export type NotificationStore = ReturnType<typeof createNotificationStore>;
