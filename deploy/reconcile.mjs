import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assertDatabaseIntegrity, assertNoDemoData, assertProductionBinding, assertRequiredSchema, privateDirectory, privateFile } from './lib.mjs';
import { maintainDatabase } from './maintenance.mjs';

function validateReference(reference) {
  if (typeof reference !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{2,159}$/.test(reference)) throw new Error('Use a reconciliation ticket/reference of 3–160 characters, without personal data or spaces.');
}
const ACCOUNT_ID = /^account-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function validLedgerInstant(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
  const canonical = new Date(value).toISOString();
  return value === canonical || value === canonical.replace('.000Z', 'Z');
}

function reviewedSuppressions(register) {
  const values = register.notificationSuppressions === undefined ? [] : register.notificationSuppressions;
  if (!Array.isArray(values) || values.length > 10_000 || values.some(value => !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['accountId', 'reason', 'occurredAt'].includes(key)) || typeof value.accountId !== 'string' || !ACCOUNT_ID.test(value.accountId) || !['BOUNCED', 'COMPLAINED'].includes(value.reason) || !validLedgerInstant(value.occurredAt) || Date.parse(value.occurredAt) > Date.parse(register.reviewedThrough))) throw new Error('Use reviewed notification suppressions with accountId, BOUNCED or COMPLAINED reason, and a real UTC occurredAt through the reviewed cutoff.');
  return values;
}

export async function reconcileRestoredData(config, register, reference, policy, now = new Date()) {
  validateReference(reference);
  if (!register || typeof register !== 'object' || Array.isArray(register) || Object.keys(register).some(key => !['format', 'accountIds', 'reviewedThrough', 'notificationSuppressions'].includes(key)) || register.format !== 'comground-deletion-register-v1' || !Array.isArray(register.accountIds) || register.accountIds.length > 10_000 || register.accountIds.some(id => typeof id !== 'string' || !ACCOUNT_ID.test(id)) || new Set(register.accountIds).size !== register.accountIds.length || !validLedgerInstant(register.reviewedThrough) || Date.parse(register.reviewedThrough) > now.getTime()) throw new Error('Use a reviewed deletion-register export with unique account IDs and a valid reviewed-through timestamp.');
  const suppressions = reviewedSuppressions(register);
  if (!policy || ![policy.unverifiedDays, policy.securityEventDays].every(value => Number.isSafeInteger(value) && value >= 7 && value <= 365)) throw new Error('Explicit approved retention periods must each be 7–365 whole days.');
  privateDirectory(dirname(config.dbPath)); privateFile(config.dbPath);
  const { deleteAccountStudentData } = await import('../apps/web/lib/student-repository.ts');
  const db = new DatabaseSync(config.dbPath);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    assertProductionBinding(db, { allowQuarantine: true }); assertRequiredSchema(db); assertNoDemoData(db); assertDatabaseIntegrity(db, true);
    if (db.prepare("SELECT value FROM deployment_meta WHERE key='restore_quarantined'").get()?.value !== '1') throw new Error('Reconciliation requires a quarantined restored database.');
    const snapshotAt = db.prepare("SELECT value FROM deployment_meta WHERE key='restore_snapshot_at'").get()?.value;
    if (!Number.isFinite(Date.parse(snapshotAt)) || Date.parse(register.reviewedThrough) < Date.parse(snapshotAt)) throw new Error('The reviewed deletion register must cover the restored snapshot and all subsequent deletion requests through the maintenance cutoff.');
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const id of register.accountIds) { deleteAccountStudentData(db, id); db.prepare('DELETE FROM accounts WHERE id=?').run(id); }
      for (const entry of suppressions) {
        // Deleted/unknown owners remain absent. This ledger cannot create or resurrect accounts.
        if (!db.prepare('SELECT 1 FROM accounts WHERE id=?').get(entry.accountId)) continue;
        db.prepare("INSERT INTO notification_suppression(account_id,reason,created_at) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET reason=CASE WHEN excluded.reason='COMPLAINED' THEN 'COMPLAINED' ELSE notification_suppression.reason END").run(entry.accountId, entry.reason, new Date(entry.occurredAt).toISOString());
        db.prepare("UPDATE notification_outbox SET state='CANCELLED',reason='RECIPIENT_SUPPRESSED',envelope=NULL,token_hash=NULL,next_attempt_at=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE account_id=? AND state IN ('BLOCKED','QUEUED','LEASED','RETRY')").run(now.toISOString(), entry.accountId);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    await maintainDatabase(db, policy, now);
    assertDatabaseIntegrity(db, true);
    db.exec('BEGIN IMMEDIATE');
    try {
      const put = db.prepare('INSERT INTO deployment_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
      put.run('restore_data_reconciled_reference', reference); put.run('restore_data_reconciled_at', now.toISOString());
      put.run('restore_deletion_register_reviewed_through', new Date(register.reviewedThrough).toISOString());
      put.run('restore_retention_policy', JSON.stringify(policy));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
}

/** Call only after an operator has reconciled the independent deletion register and retention. */
export async function releaseRestoredDatabase(config, reference, now = new Date()) {
  validateReference(reference);
  privateDirectory(dirname(config.dbPath)); privateFile(config.dbPath);
  const { cancelRestoredNotifications } = await import('../apps/web/lib/notification-repository.ts');
  const { cancelRestoredDistribution } = await import('../apps/web/lib/distribution-repository.ts');
  const db = new DatabaseSync(config.dbPath);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
    assertProductionBinding(db, { allowQuarantine: true }); assertRequiredSchema(db); assertNoDemoData(db); assertDatabaseIntegrity(db, true);
    if (db.prepare("SELECT value FROM deployment_meta WHERE key='restore_quarantined'").get()?.value !== '1') throw new Error('Only a quarantined restored database can be released.');
    if (db.prepare("SELECT value FROM deployment_meta WHERE key='restore_data_reconciled_reference'").get()?.value !== reference) throw new Error('Run offline deletion-register and retention reconciliation with this review reference before releasing quarantine.');
    db.prepare('DELETE FROM account_sessions').run();
    db.prepare('DELETE FROM account_action_tokens').run();
    cancelRestoredNotifications(db, now);
    cancelRestoredDistribution(db, now);
    const put = db.prepare('INSERT INTO deployment_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    put.run('restore_reconciliation_reference', reference); put.run('restore_reconciled_at', now.toISOString());
    db.prepare("DELETE FROM deployment_meta WHERE key='restore_quarantined'").run();
    db.exec('COMMIT');
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}
