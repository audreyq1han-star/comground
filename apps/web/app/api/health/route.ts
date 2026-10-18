import { DatabaseSync } from 'node:sqlite';
import { apiError, assertLoopback, jsonResponse } from '../../../lib/http.ts';
import { getRuntimeConfig } from '../../../lib/runtime-config.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request): Response {
  try {
    assertLoopback(request);
    const config = getRuntimeConfig(), db = new DatabaseSync(config.dbPath, { readOnly: true });
    try {
      const binding = db.prepare("SELECT value FROM deployment_meta WHERE key='mode'").get() as { value: string } | undefined;
      const quarantine = db.prepare("SELECT value FROM deployment_meta WHERE key='restore_quarantined'").get() as { value: string } | undefined;
      const migration = db.prepare("SELECT value FROM deployment_meta WHERE key='migration_state'").get() as { value: string } | undefined;
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('accounts','student_profiles','student_privacy','notification_outbox','opportunities')").all();
      if (binding?.value !== config.mode || migration?.value === 'running' || quarantine?.value === '1' || (config.mode !== 'demo' && tables.length !== 5)) return jsonResponse({ ready: false }, 503);
      return jsonResponse({ ready: true });
    } finally { db.close(); }
  } catch (error) { return apiError(error); }
}
