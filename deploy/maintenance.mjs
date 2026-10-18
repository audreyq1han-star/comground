import { DatabaseSync } from 'node:sqlite';
import { readReadyDatabase } from './lib.mjs';

/** Explicit owner-approved retention only. No worker or provider is called. */
export async function maintainDatabase(db, policy, now = new Date()) {
  if (!policy || ![policy.unverifiedDays, policy.securityEventDays].every(value => Number.isSafeInteger(value) && value >= 7 && value <= 365)) throw new Error('Explicit approved retention periods must each be 7–365 whole days.');
  const { createAccountStore } = await import('../apps/web/lib/account-repository.ts');
  const { deleteAccountStudentData } = await import('../apps/web/lib/student-repository.ts');
  const { pruneNotifications } = await import('../apps/web/lib/notification-repository.ts');
  const { createMeasurementStore } = await import('../apps/web/lib/measurement-repository.ts');
  const { pruneDistribution } = await import('../apps/web/lib/distribution-repository.ts');
  const store = createAccountStore(db, { notificationSink() { throw new Error('Maintenance cannot send notifications.'); }, beforeDelete: deleteAccountStudentData });
  const result = store.maintain(policy, now);
  pruneNotifications(db, now);
  pruneDistribution(db, now);
  createMeasurementStore(db, { seedExamples: false }).prune(now);
  return result;
}

export async function maintainProductionData(config, policy, now = new Date()) {
  const check = readReadyDatabase(config); check.close();
  const db = new DatabaseSync(config.dbPath);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    return await maintainDatabase(db, policy, now);
  } finally { db.close(); }
}
