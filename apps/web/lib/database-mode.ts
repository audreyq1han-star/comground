import { closeSync, existsSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { RuntimeMode } from '../../../packages/domain/runtime-contracts.ts';
import { RepositoryError } from './errors.ts';

/** Bind a database before any schema/seed writes. Never silently promote demo data. */
export function bindDatabaseMode(filename: string, mode: RuntimeMode): void {
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  if (mode === 'production') {
    const directory = lstatSync(dirname(filename));
    if (directory.isSymbolicLink() || (directory.mode & 0o077) !== 0) throw new RepositoryError('DATA_PERMISSIONS', 503, 'Production storage requires a private data directory.');
    if (!existsSync(filename)) closeSync(openSync(filename, 'ax', 0o600));
    const file = lstatSync(filename);
    if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) !== 0) throw new RepositoryError('DATA_PERMISSIONS', 503, 'Production storage requires a private database file.');
  }
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    db.exec('CREATE TABLE IF NOT EXISTS deployment_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    const previous = db.prepare("SELECT value FROM deployment_meta WHERE key='mode'").get() as { value: string } | undefined;
    const migration = db.prepare("SELECT value FROM deployment_meta WHERE key='migration_state'").get() as { value: string } | undefined;
    if (migration?.value === 'running') throw new RepositoryError('MIGRATION_INCOMPLETE', 503, 'Complete the database migration before resuming service.');
    const quarantine = db.prepare("SELECT value FROM deployment_meta WHERE key='restore_quarantined'").get() as { value: string } | undefined;
    if (quarantine?.value === '1') throw new RepositoryError('RESTORE_QUARANTINED', 503, 'A restored database requires deletion reconciliation before service can resume.');
    if (previous && previous.value !== mode) throw new RepositoryError('DATABASE_MODE_MISMATCH', 503, 'Use a separate database for each operating mode.');
    if (!previous && mode !== 'demo') {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('opportunities','student_profiles','accounts','community_pages','measurement_campaigns')").all() as { name: string }[];
      for (const { name } of tables) if ((db.prepare(`SELECT count(*) AS n FROM ${name}`).get() as { n: number }).n > 0) throw new RepositoryError('DATABASE_MODE_MISMATCH', 503, 'A populated unbound database requires an explicit reviewed migration.');
    }
    db.prepare("INSERT OR IGNORE INTO deployment_meta(key,value) VALUES('mode',?)").run(mode);
    db.exec('COMMIT');
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}
