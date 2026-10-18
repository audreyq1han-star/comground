import type { DatabaseSync } from 'node:sqlite';
import { RepositoryError } from './errors.ts';
import type { NotificationOccurrence } from './notification-repository.ts';

type Candidate = { owner: string; opportunity_id: string; occurrence_id: string };
const candidateSql = `SELECT n.owner,s.opportunity_id,s.occurrence_id FROM notification_preferences n JOIN student_occurrence_saves s ON s.persona_id=n.owner
  LEFT JOIN student_occurrence_activity a ON a.persona_id=s.persona_id AND a.opportunity_id=s.opportunity_id AND a.occurrence_id=s.occurrence_id
  WHERE n.enabled=1 AND (a.id IS NULL OR a.status IN ('OPENED','APPLIED'))
  UNION SELECT n.owner,a.opportunity_id,a.occurrence_id FROM notification_preferences n JOIN student_occurrence_activity a ON a.persona_id=n.owner WHERE n.enabled=1 AND a.status IN ('OPENED','APPLIED')`;
function interestSchemaExists(db: DatabaseSync): boolean {
  return ['notification_preferences', 'student_occurrence_saves', 'student_occurrence_activity'].every(table => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}
/** Recheck the same owner and occurrence interest at enqueue and immediately before dispatch. */
export function notificationInterestActive(db: DatabaseSync, owner: string, occurrence: Pick<NotificationOccurrence, 'opportunityId' | 'occurrenceId'>): boolean {
  if (!interestSchemaExists(db)) return false;
  return !!db.prepare(`WITH candidates AS (${candidateSql}) SELECT 1 FROM candidates WHERE owner=? AND opportunity_id=? AND occurrence_id=? LIMIT 1`).get(owner, occurrence.opportunityId, occurrence.occurrenceId);
}
/** Persist progress even across non-due/expired/deduplicated records; wrap on the next pass. */
export function scanNotificationCandidates(db: DatabaseSync, resolve: (candidate: Candidate) => NotificationOccurrence | null, enqueue: (owner: string, occurrence: NotificationOccurrence) => { created: boolean }): { examined: number; queued: number } {
  if (!interestSchemaExists(db)) return { examined: 0, queued: 0 };
  let cursor = db.prepare('SELECT owner,opportunity_id,occurrence_id FROM notification_scan_cursor WHERE singleton=1').get() as Candidate;
  const statement = db.prepare(`WITH candidates AS (${candidateSql}) SELECT owner,opportunity_id,occurrence_id FROM candidates WHERE (owner,opportunity_id,occurrence_id)>(?,?,?) ORDER BY owner,opportunity_id,occurrence_id LIMIT 100`);
  let candidates = statement.all(cursor.owner, cursor.opportunity_id, cursor.occurrence_id) as Candidate[];
  if (!candidates.length && cursor.owner) { cursor = { owner: '', opportunity_id: '', occurrence_id: '' }; candidates = statement.all('', '', '') as Candidate[]; }
  let queued = 0;
  for (const candidate of candidates) {
    const occurrence = resolve(candidate);
    if (occurrence) {
      try { if (enqueue(candidate.owner, occurrence).created) queued += 1; }
      catch (error) { if (!(error instanceof RepositoryError)) throw error; }
    }
    cursor = candidate;
    db.prepare('UPDATE notification_scan_cursor SET owner=?,opportunity_id=?,occurrence_id=? WHERE singleton=1').run(cursor.owner, cursor.opportunity_id, cursor.occurrence_id);
  }
  if (!candidates.length) db.prepare("UPDATE notification_scan_cursor SET owner='',opportunity_id='',occurrence_id='' WHERE singleton=1").run();
  return { examined: candidates.length, queued };
}
