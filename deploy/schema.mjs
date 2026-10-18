import { DatabaseSync } from 'node:sqlite';
import { assertDatabaseIntegrity, assertNoDemoData, assertProductionBinding, assertRequiredSchema, SCHEMA_REVISION } from './lib.mjs';

/** Explicit schema-only constructors. No fixtures, accounts, provider calls or dispatch. */
export async function initializeProductionSchema(config) {
  if (config.mode !== 'production') throw new Error('Production schema initialization requires production configuration.');
  const { bindDatabaseMode } = await import('../apps/web/lib/database-mode.ts');
  try { bindDatabaseMode(config.dbPath, 'production'); }
  catch (error) {
    // Only this explicit stopped-service migration may resume an interrupted migration.
    // Binding, quarantine and integrity are still checked below; startup never bypasses them.
    if (error?.code !== 'MIGRATION_INCOMPLETE') throw error;
  }
  const marker = new DatabaseSync(config.dbPath);
  try {
    assertProductionBinding(marker, { allowMigration: true });
    assertNoDemoData(marker);
    marker.prepare("INSERT INTO deployment_meta(key,value) VALUES('migration_state','running') ON CONFLICT(key) DO UPDATE SET value='running'").run();
  } finally { marker.close(); }
  const { createRepository } = await import('../apps/web/lib/repository.ts');
  const { createAccountRepository } = await import('../apps/web/lib/account-repository.ts');
  const { createStudentRepository } = await import('../apps/web/lib/student-repository.ts');
  const { initializeNotificationSchema } = await import('../apps/web/lib/notification-repository.ts');
  const { initializeAiUsageSchema } = await import('../apps/web/lib/ai-runtime.ts');
  const { initializeSafetySchema } = await import('../apps/web/lib/safety-repository.ts');
  const { initializeYouthSchema } = await import('../apps/web/lib/youth-repository.ts');
  const { initializeEvidenceSchema } = await import('../apps/web/lib/evidence-repository.ts');
  const { initializeDistributionSchema } = await import('../apps/web/lib/distribution-repository.ts');
  const { initializeCommunitySchema } = await import('../apps/web/lib/community-repository.ts');
  const { initializeSourceControlSchema } = await import('../apps/web/lib/source-control-repository.ts');
  const { initializeMatchingEvaluationSchema } = await import('../apps/web/lib/matching-evaluation-repository.ts');
  const supply = createRepository(config.dbPath, { seedExamples: false });
  let accounts, students;
  try {
    accounts = createAccountRepository(config.dbPath, { notificationSink() { throw new Error('Schema initialization must never enqueue a notification.'); } });
    students = createStudentRepository(config.dbPath, supply, { allowDemo: false, seedExamples: false });
    const db = new DatabaseSync(config.dbPath);
    try {
      db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
      initializeNotificationSchema(db);
      initializeAiUsageSchema(db);
      initializeSafetySchema(db);
      initializeYouthSchema(db);
      initializeEvidenceSchema(db);
      initializeDistributionSchema(db);
      initializeCommunitySchema(db);
      initializeSourceControlSchema(db);
      initializeMatchingEvaluationSchema(db);
      assertRequiredSchema(db, false); assertNoDemoData(db); assertDatabaseIntegrity(db, true);
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec('CREATE TABLE IF NOT EXISTS comground_deployment_migrations(revision TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
        db.prepare('INSERT OR IGNORE INTO comground_deployment_migrations(revision,applied_at) VALUES(?,?)').run(SCHEMA_REVISION, new Date().toISOString());
        db.prepare("DELETE FROM deployment_meta WHERE key='migration_state'").run();
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } finally { db.close(); }
  } finally { students?.close(); accounts?.close(); supply.close(); }
}
