import type { DatabaseSync } from 'node:sqlite';
import { RepositoryError } from './errors.ts';

/** SQLite's old two-persona CHECK needs a verified table rebuild; child FKs keep their target name. */
export function migrateStudentOwners(db: DatabaseSync): void {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='student_profiles'").get() as { sql: string } | undefined;
  if (!table || !/CHECK\s*\(\s*persona_id\s+IN/i.test(table.sql)) return;
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
  try {
    db.exec(`CREATE TABLE student_profiles_account_migration (persona_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL);
      INSERT INTO student_profiles_account_migration SELECT persona_id,profile_json FROM student_profiles;`);
    const different = db.prepare('SELECT persona_id,profile_json FROM student_profiles EXCEPT SELECT persona_id,profile_json FROM student_profiles_account_migration').all();
    const count = (name: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get() as { n: number }).n;
    if (different.length || count('student_profiles') !== count('student_profiles_account_migration')) throw new RepositoryError('MIGRATION_FAILED', 500, 'Profile migration could not verify every existing profile.');
    db.exec('DROP TABLE student_profiles; ALTER TABLE student_profiles_account_migration RENAME TO student_profiles;');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new RepositoryError('MIGRATION_FAILED', 500, 'Profile migration found invalid private record relationships.');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.exec('PRAGMA foreign_keys=ON'); }
}
