import { getAccountById } from './account-repository.ts';
import { DatabaseSync } from 'node:sqlite';
import { getRuntimeConfig } from './runtime-config.ts';
import { bindDatabaseMode } from './database-mode.ts';
import { RepositoryError } from './errors.ts';
import { createOpenAiExplanationProvider } from './ai-provider.ts';

/** Schema-only initialization; does not construct or invoke an external provider. */
export function initializeAiUsageSchema(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS ai_usage(owner TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, day TEXT NOT NULL, count INTEGER NOT NULL, last_at INTEGER NOT NULL)');
}

/** A durable daily cap and per-account cooldown bound optional provider spending. */
export function consumeAiBudget(db: DatabaseSync, owner: string, now = new Date()): void {
  initializeAiUsageSchema(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    const day = now.toISOString().slice(0, 10), at = now.getTime();
    db.prepare('DELETE FROM ai_usage WHERE day<?').run(day);
    const prior = db.prepare('SELECT day,count,last_at FROM ai_usage WHERE owner=?').get(owner) as { day: string; count: number; last_at: number } | undefined;
    if (prior && (at - prior.last_at < 30_000 || (prior.day === day && prior.count >= 20))) throw new RepositoryError('AI_RATE_LIMITED', 429, 'The optional AI request limit has been reached. Rule-based explanations remain available.');
    db.prepare('INSERT INTO ai_usage(owner,day,count,last_at) VALUES(?,?,1,?) ON CONFLICT(owner) DO UPDATE SET day=excluded.day,count=?,last_at=excluded.last_at').run(owner, day, at, prior?.day === day ? prior.count + 1 : 1);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function optionalAiProvider(owner: string) {
  const config = getRuntimeConfig();
  if (config.mode !== 'production' || !config.ai.enabled) return null;
  bindDatabaseMode(config.dbPath, config.mode);
  const db = new DatabaseSync(config.dbPath);
  try { db.exec('PRAGMA busy_timeout=5000'); const account=getAccountById(db,owner); if(!account||account.role!=='STUDENT'||!account.emailVerified||account.ageBand!=='ADULT'||account.admission!=='ADMITTED') throw new RepositoryError('AI_ACCOUNT_REQUIRED',403,'External AI explanations require a verified admitted adult student account.'); consumeAiBudget(db, owner); } finally { db.close(); }
  return createOpenAiExplanationProvider({ apiKey: config.ai.key!, model: config.ai.model! });
}
