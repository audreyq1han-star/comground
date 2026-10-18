import { createHash } from 'node:crypto';
import { accessSync, closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_REVISION = 'production-schema-v1';
const SYNTHETIC_SOURCE_TABLES = ['source_permissions', 'source_permission_events', 'source_ingestion_runs', 'source_ingestion_attempts', 'source_staged_records', 'source_record_links', 'source_merges', 'source_merge_events', 'source_duplicate_decisions', 'source_review_time'];
export const REQUIRED_TABLES = [
  ...SYNTHETIC_SOURCE_TABLES,
  'sources', 'organizations', 'import_runs', 'import_run_details', 'review_events', 'opportunity_controls', 'source_controls', 'source_events',
  'published_snapshots', 'exception_states', 'exception_events', 'community_pages', 'community_events',
  'opportunities', 'catalogue_meta', 'catalogue_audit', 'catalogue_revisions', 'published_occurrence_snapshots',
  'accounts', 'account_sessions', 'account_action_tokens', 'account_auth_limits', 'account_abuse', 'account_meta', 'account_security_events',
  'account_age', 'youth_review_requests', 'youth_review_events',
  'student_profiles', 'student_privacy', 'student_schema_migrations', 'student_occurrence_saves', 'student_occurrence_activity', 'student_occurrence_feedback',
  'student_profile_clock', 'student_saves', 'student_activity', 'student_activity_events', 'student_alerts', 'student_reminder_state', 'student_feedback', 'student_occurrence_activity_events',
  'measurement_consent', 'measurement_campaigns', 'measurement_exposures', 'measurement_outcomes',
  'measurement_attribution', 'measurement_feedback', 'ai_usage',
  'safety_reports', 'safety_report_events', 'safety_report_limits',
  'student_failed_fits', 'student_evidence_claims', 'scope_evidence_records',
  'digest_subscriptions', 'digest_batches', 'digest_recipients', 'distribution_community_pages',
  'matching_evaluation_runs', 'matching_evaluation_decisions',
  'notification_preferences', 'notification_outbox', 'notification_clock', 'notification_scan_cursor',
  'notification_receipt_correlations', 'notification_receipt_events', 'notification_suppression',
];
const REQUIRED_COLUMNS = {
  matching_evaluation_runs: ['id', 'created_at', 'result_json'],
  matching_evaluation_decisions: ['run_id', 'version', 'decision', 'reason', 'actor', 'at'],
  import_runs: ['actor'], review_events: ['actor'], catalogue_audit: ['actor'], source_events: ['actor'], exception_events: ['actor'], community_events: ['actor'],
  exception_states: ['assigned_to'],
  source_permissions: ['source_id', 'version', 'permission_json'],
  source_permission_events: ['source_id', 'version', 'actor_id', 'reason', 'at', 'permission_json'],
  source_ingestion_runs: ['id', 'source_id', 'idempotency_key', 'version', 'state', 'cursor', 'attempts', 'next_attempt_at', 'heartbeat_at', 'created_at', 'updated_at', 'error_code', 'accepted', 'quarantined', 'lease_token', 'lease_until'],
  source_ingestion_attempts: ['run_id', 'attempt', 'started_at', 'finished_at', 'error_code'],
  source_staged_records: ['id', 'run_id', 'source_id', 'external_id', 'content_hash', 'state', 'error_code', 'opportunity_id', 'record_json', 'created_at'],
  source_record_links: ['source_id', 'external_id', 'normalized_url', 'opportunity_id', 'record_json', 'updated_at'],
  source_merges: ['id', 'from_id', 'to_id', 'version', 'active', 'actor_id', 'reason', 'at', 'reversed_at'],
  source_merge_events: ['merge_id', 'version', 'action', 'actor_id', 'reason', 'at'],
  source_duplicate_decisions: ['pair_key', 'actor_id', 'reason', 'at'], source_review_time: ['id', 'source_id', 'actor_id', 'minutes', 'at'],
  measurement_campaigns: ['name', 'channel', 'path'], measurement_attribution: ['campaign_snapshot_json'], measurement_exposures: ['campaign_snapshot_json'],
  digest_subscriptions: ['owner', 'enabled', 'version', 'updated_at'],
  digest_batches: ['id', 'label', 'state', 'version', 'created_at', 'updated_at', 'expires_at', 'opportunities_json', 'audit_json'],
  digest_recipients: ['batch_id', 'owner', 'subscription_version', 'profile_version', 'refs_json', 'state', 'created_at'],
  distribution_community_pages: ['id', 'slug', 'title', 'description', 'channel', 'state', 'version', 'created_at', 'updated_at', 'audit_json'],
  account_age: ['account_id', 'age_band', 'synthetic', 'attested_at'],
  youth_review_requests: ['id', 'account_id', 'reviewer_id', 'route', 'policy_version', 'status', 'version', 'created_at', 'updated_at'],
  youth_review_events: ['request_id', 'version', 'status', 'actor', 'at'],
  ai_usage: ['owner', 'day', 'count', 'last_at'],
  safety_reports: ['id', 'owner', 'target_json', 'category', 'narrative', 'status', 'rationale', 'version', 'quarantine_requested', 'created_at', 'updated_at'],
  safety_report_events: ['report_id', 'version', 'status', 'rationale', 'actor', 'quarantine_requested', 'at'],
  safety_report_limits: ['owner', 'window_started_at', 'count'],
  student_failed_fits: ['id', 'owner', 'opportunity_id', 'occurrence_id', 'record_json'],
  student_evidence_claims: ['id', 'owner', 'token_hash', 'assigned_operator', 'record_json', 'actor_audit_json'],
  scope_evidence_records: ['id', 'kind', 'organization_id', 'opportunity_id', 'program_id', 'record_json'],
  account_auth_limits: ['account_id', 'action', 'count', 'resets_at'],
  notification_receipt_correlations: ['outbox_id', 'account_id', 'lease_token', 'provider_email_id', 'expires_at'],
  notification_outbox: ['provider_email_id', 'receipt_status', 'receipt_occurred_at', 'receipt_received_at'],
  notification_receipt_events: ['event_id', 'outbox_id', 'status', 'occurred_at', 'received_at'],
  notification_suppression: ['account_id', 'reason', 'created_at'],
};

export function requireSupportedNode(version = process.versions.node) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (major !== 22 || minor < 23 || (minor === 23 && patch < 3)) throw new Error('Use Node 22.23.3 or a later reviewed 22.x release.');
}

export async function productionConfig() {
  requireSupportedNode();
  if (process.env.COMGROUND_MODE !== 'production') throw new Error('Set COMGROUND_MODE=production explicitly for this command.');
  // The application owns validation. Never invent defaults or duplicate its secret parsing.
  const { getRuntimeConfig } = await import('../apps/web/lib/runtime-config.ts');
  const config = getRuntimeConfig();
  if (config.mode !== 'production') throw new Error('This command requires explicit COMGROUND_MODE=production and complete production configuration.');
  if (!config.origin || !config.dbPath || !isAbsolute(config.dbPath) || config.dbPath === ':memory:') throw new Error('Production requires an exact HTTPS origin and an absolute persistent database path.');
  if (config.adultPolicyVersion !== 'adult-account-v1') throw new Error('The approved adult-account-v1 policy acknowledgment is required.');
  if (!config.notification.outboxKey) throw new Error('The persistent outbox encryption key is required.');
  process.umask(0o077);
  return config;
}

export function privateDirectory(path, create = false) {
  if (!isAbsolute(path)) throw new Error('Use an absolute storage directory.');
  if (create) mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== resolve(path)) throw new Error('Use a real storage directory without symlink components.');
  if ((stat.mode & 0o077) !== 0) throw new Error('Storage directories must be private (mode 0700).');
  accessSync(path, constants.R_OK | constants.W_OK | constants.X_OK);
}

export function privateFile(path) {
  if (!isAbsolute(path)) throw new Error('Use an absolute file path.');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== resolve(path)) throw new Error('Use a regular file without symlink components.');
  if ((stat.mode & 0o077) !== 0) throw new Error('Database and backup files must be private (mode 0600).');
}

export function tableNames(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name));
}

export function assertDatabaseIntegrity(db, full = false) {
  const checks = db.prepare(full ? 'PRAGMA integrity_check' : 'PRAGMA quick_check').all();
  if (checks.length !== 1 || Object.values(checks[0])[0] !== 'ok') throw new Error('Database integrity check failed. Keep the original files and investigate before serving.');
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database foreign-key check failed.');
}

export function assertNoDemoData(db) {
  const tables = tableNames(db);
  if (tables.has('catalogue_meta') && db.prepare("SELECT 1 FROM catalogue_meta WHERE key='demo-seed-v1'").get()) throw new Error('A seeded demo database cannot be used for production.');
  if (tables.has('student_profiles') && db.prepare("SELECT 1 FROM student_profiles WHERE persona_id IN ('demo-alex','demo-sam') LIMIT 1").get()) throw new Error('Demo personas cannot enter a production database.');
  if (tables.has('opportunities') && db.prepare("SELECT 1 FROM opportunities WHERE json_extract(record_json,'$.isSynthetic') = 1 LIMIT 1").get()) throw new Error('Synthetic opportunities cannot enter a production database.');
  if (tables.has('community_pages') && db.prepare("SELECT 1 FROM community_pages WHERE slug='demo-neighborhood'").get()) throw new Error('Synthetic community data cannot enter a production database.');
  if (tables.has('measurement_campaigns') && db.prepare("SELECT 1 FROM measurement_campaigns WHERE id IN ('demo-school-club','demo-community')").get()) throw new Error('Synthetic campaigns cannot enter a production database.');
  if (tables.has('account_age') && db.prepare("SELECT 1 FROM account_age WHERE synthetic=1 OR age_band='TEEN_13_17' LIMIT 1").get()) throw new Error('Synthetic youth accounts cannot enter a production database.');
  if (tables.has('account_meta') && db.prepare("SELECT 1 FROM account_meta WHERE key='youth-workflow' AND value='synthetic-test-only'").get()) throw new Error('A synthetic youth workflow database cannot enter production.');
  for (const table of [...SYNTHETIC_SOURCE_TABLES, 'distribution_community_pages', 'youth_review_requests', 'youth_review_events', 'student_failed_fits', 'student_evidence_claims', 'scope_evidence_records']) {
    if (tables.has(table) && db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) throw new Error('Synthetic workflow records cannot enter production.');
  }
}

export function assertProductionBinding(db, { allowQuarantine = false, allowMigration = false } = {}) {
  if (!tableNames(db).has('deployment_meta') || db.prepare("SELECT value FROM deployment_meta WHERE key='mode'").get()?.value !== 'production') throw new Error('Database is not bound to production mode.');
  if (!allowQuarantine && db.prepare("SELECT value FROM deployment_meta WHERE key='restore_quarantined'").get()?.value === '1') throw new Error('Restored database is quarantined pending deletion and retention reconciliation.');
  if (!allowMigration && db.prepare("SELECT value FROM deployment_meta WHERE key='migration_state'").get()?.value === 'running') throw new Error('A migration did not finish. Retry the migration before serving.');
}

export function assertRequiredSchema(db, requireMarker = true) {
  const tables = tableNames(db);
  const missing = REQUIRED_TABLES.filter(name => !tables.has(name));
  if (missing.length) throw new Error(`Production schema is incomplete: ${missing.join(', ')}. Run the explicit migration command.`);
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
    const missingColumns = required.filter(column => !columns.has(column));
    if (missingColumns.length) throw new Error(`Production schema is incomplete: ${missingColumns.map(column => `${table}.${column}`).join(', ')}. Run the explicit migration command.`);
  }
  const providerIndex = db.prepare('PRAGMA index_list(notification_outbox)').all().find(index => index.name === 'notification_provider_email' && index.unique === 1);
  if (!providerIndex || db.prepare('PRAGMA index_info(notification_provider_email)').all().map(column => column.name).join(',') !== 'provider_email_id') throw new Error('Production schema requires the unique provider-email receipt association index. Run the explicit migration command.');
  const youthIndex = db.prepare('PRAGMA index_list(youth_review_requests)').all().find(index => index.name === 'youth_review_active_owner' && index.unique === 1 && index.partial === 1);
  const youthSql = db.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND name='youth_review_active_owner'").get()?.sql ?? '';
  if (!youthIndex || db.prepare('PRAGMA index_info(youth_review_active_owner)').all().map(column => column.name).join(',') !== 'account_id' || !/WHERE\s+status\s+IN\s*\(\s*'PENDING'\s*,\s*'APPROVED'\s*\)/i.test(youthSql)) throw new Error('Production schema requires the unique active youth-review owner index. Run the explicit migration command.');
  const mergeIndex = db.prepare('PRAGMA index_list(source_merges)').all().find(index => index.name === 'source_merge_active_alias' && index.unique === 1 && index.partial === 1);
  const mergeSql = db.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND name='source_merge_active_alias'").get()?.sql ?? '';
  if (!mergeIndex || db.prepare('PRAGMA index_info(source_merge_active_alias)').all().map(column => column.name).join(',') !== 'from_id' || !/WHERE\s+active\s*=\s*1\s*$/i.test(mergeSql)) throw new Error('Production schema requires the unique active source-merge alias index. Run the explicit migration command.');
  if (!db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='notification_outbox'").get()?.sql.includes("'DIGEST'")) throw new Error('Production notification schema is missing DIGEST support. Run the explicit migration command.');
  for (const table of ['matching_evaluation_runs', 'matching_evaluation_decisions']) for (const action of ['update', 'delete']) {
    const trigger = db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=? AND tbl_name=?").get(`${table}_no_${action}`, table)?.sql ?? '';
    if (!new RegExp(`BEFORE\\s+${action}\\s+ON\\s+${table}\\s+BEGIN\\s+SELECT\\s+RAISE\\(ABORT,`, 'i').test(trigger)) throw new Error('Production schema requires immutable matching-evaluation audit triggers. Run the explicit migration command.');
  }
  if (!db.prepare('PRAGMA foreign_key_list(matching_evaluation_decisions)').all().some(key => key.from === 'run_id' && key.table === 'matching_evaluation_runs' && key.to === 'id' && key.on_delete === 'NO ACTION')) throw new Error('Production schema requires the retained matching-evaluation audit association. Run the explicit migration command.');
  for (const [table, from, target, to, deletion] of [['account_age', 'account_id', 'accounts', 'id', 'CASCADE'], ['youth_review_requests', 'account_id', 'accounts', 'id', 'CASCADE'], ['youth_review_requests', 'reviewer_id', 'accounts', 'id', 'SET NULL'], ['youth_review_events', 'request_id', 'youth_review_requests', 'id', 'CASCADE']]) {
    if (!db.prepare(`PRAGMA foreign_key_list(${table})`).all().some(key => key.from === from && key.table === target && key.to === to && key.on_delete === deletion)) throw new Error(`Production schema requires the ${table} ${from} deletion rule. Run the explicit migration command.`);
  }
  for (const table of ['student_failed_fits', 'student_evidence_claims', 'digest_subscriptions', 'digest_recipients']) {
    if (!db.prepare(`PRAGMA foreign_key_list(${table})`).all().some(key => key.from === 'owner' && key.table === 'student_profiles' && key.to === 'persona_id' && key.on_delete === 'CASCADE')) throw new Error(`Production schema requires the ${table} profile deletion cascade. Run the explicit migration command.`);
  }
  if (!db.prepare('PRAGMA foreign_key_list(digest_recipients)').all().some(key => key.from === 'batch_id' && key.table === 'digest_batches' && key.to === 'id' && key.on_delete === 'CASCADE')) throw new Error('Production schema requires the digest recipient batch deletion cascade. Run the explicit migration command.');
  for (const [table, from, target, to] of [['ai_usage', 'owner', 'accounts', 'id'], ['safety_reports', 'owner', 'accounts', 'id'], ['safety_report_events', 'report_id', 'safety_reports', 'id'], ['safety_report_limits', 'owner', 'accounts', 'id'], ['account_auth_limits', 'account_id', 'accounts', 'id'], ['notification_receipt_correlations', 'account_id', 'accounts', 'id'], ['notification_receipt_events', 'outbox_id', 'notification_receipt_correlations', 'outbox_id'], ['notification_suppression', 'account_id', 'accounts', 'id']]) {
    if (!db.prepare(`PRAGMA foreign_key_list(${table})`).all().some(key => key.from === from && key.table === target && key.to === to && key.on_delete === 'CASCADE')) throw new Error(`Production schema requires the ${table} deletion cascade. Run the explicit migration command.`);
  }
  const marker = tables.has('comground_deployment_migrations') ? db.prepare('SELECT revision FROM comground_deployment_migrations ORDER BY applied_at DESC LIMIT 1').get() : null;
  if (requireMarker && marker?.revision !== SCHEMA_REVISION) throw new Error('This release has not completed its explicit production migration.');
}

export function schemaFingerprint(db) {
  const rows = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name").all();
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

export function keyFingerprint(config) {
  return createHash('sha256').update(Buffer.from(config.notification.outboxKey, 'base64')).digest('hex');
}

export function readReadyDatabase(config, { full = false } = {}) {
  privateDirectory(dirname(config.dbPath));
  privateFile(config.dbPath);
  const db = new DatabaseSync(config.dbPath, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000;');
    assertDatabaseIntegrity(db, full); assertProductionBinding(db); assertRequiredSchema(db); assertNoDemoData(db);
    const mode = Object.values(db.prepare('PRAGMA journal_mode').get())[0];
    if (mode !== 'wal') throw new Error('Production database must use WAL mode. Run the explicit migration command.');
    return db;
  } catch (error) { db.close(); throw error; }
}

export function buildId() {
  const path = new URL('../apps/web/.next/BUILD_ID', import.meta.url);
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null;
}

export function syncFile(path) { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
export function syncDirectory(path) { syncFile(path); }

export function commandArgs(allowed) {
  const args = process.argv.slice(2), values = {};
  while (args.length) {
    const key = args.shift();
    if (!allowed.includes(key) || key in values) throw new Error(`Unsupported or duplicate argument: ${key}`);
    if (['--configuration-only', '--http', '--confirm-service-stopped', '--confirm-deletions-reconciled', '--confirm-retention-reconciled', '--confirm-policy-approved', '--confirm-delivery-approved', '--once', '--scheduled'].includes(key)) values[key] = true;
    else { const value = args.shift(); if (!value || value.startsWith('--')) throw new Error(`${key} needs a value.`); values[key] = value; }
  }
  return values;
}

export function reportFailure(error) {
  // Errors from providers or configuration can contain supplied values. Keep command output secret-free.
  console.error(JSON.stringify({ ok: false, error: error instanceof Error && !/key|secret|credential|password|token/i.test(error.message) ? error.message : 'Production validation failed. Check configuration and private storage; no secret values are printed.' }));
  process.exitCode = 1;
}
