import { exportOwnerSafetyData } from './safety-repository.ts';
import { exportOwnerDistribution } from './distribution-repository.ts';
import { exportOwnerEvidence } from './evidence-repository.ts';
import type { DatabaseSync } from 'node:sqlite';
import type { ActivityItem, ActivityStatus, AlertPreferences, StudentExport, StudentFeedback, StudentOwnerId, StudentProfile } from '../../../packages/domain/app-contracts.ts';
import type { PublicOpportunity } from '../../../packages/domain/contracts.ts';
import type { StudentSupplyReader } from './student-repository.ts';
import { exportMeasurementData } from './measurement-repository.ts';
import { exportOwnerNotifications } from './notification-repository.ts';
import { readPrivacyState, validateStudentOwner } from './privacy-store.ts';

type ActivityFacts = Pick<PublicOpportunity, 'title' | 'startsAt' | 'endsAt' | 'signupUrl'>;

/** Trusted self-export after account authentication; role changes never remove the right to export. */
export function exportAccountStudentData(db: DatabaseSync, owner: StudentOwnerId, supply: StudentSupplyReader, now = new Date()): StudentExport | null {
  validateStudentOwner(owner);
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='student_profiles'").get()) return null;
  const row = db.prepare('SELECT profile_json FROM student_profiles WHERE persona_id=?').get(owner) as { profile_json: string } | undefined;
  if (!row) return null;
  const profile = JSON.parse(row.profile_json) as StudentProfile;
  const exact = (item: PublicOpportunity | null, id: string, occurrenceId: string) => item && item.id === id && (item.occurrenceId ?? 'primary') === occurrenceId ? item : null;
  const saved = (db.prepare('SELECT opportunity_id,occurrence_id,title,starts_at,ends_at,saved_at FROM student_occurrence_saves WHERE persona_id=? ORDER BY saved_at DESC,opportunity_id,occurrence_id').all(owner) as { opportunity_id: string; occurrence_id: string; title: string; starts_at: string; ends_at: string; saved_at: string }[]).map(item => {
    const opportunity = exact(supply.getPublic(item.opportunity_id, now, item.occurrence_id), item.opportunity_id, item.occurrence_id);
    const facts = opportunity ?? exact(supply.getPublicSnapshot(item.opportunity_id, item.occurrence_id), item.opportunity_id, item.occurrence_id);
    return { opportunityId: item.opportunity_id, occurrenceId: item.occurrence_id, title: facts?.title ?? item.title, startsAt: facts?.startsAt ?? item.starts_at, endsAt: facts?.endsAt ?? item.ends_at, savedAt: item.saved_at, available: !!opportunity, opportunity };
  });
  const activity: ActivityItem[] = (db.prepare('SELECT * FROM student_occurrence_activity WHERE persona_id=? ORDER BY updated_at DESC,id').all(owner) as { id: string; opportunity_id: string; occurrence_id: string; snapshot_json: string; status: ActivityStatus; evidence_kind: ActivityItem['evidenceKind']; version: number; created_at: string; updated_at: string }[]).map(item => {
    const stored = JSON.parse(item.snapshot_json) as ActivityFacts & { outcome?: ActivityFacts };
    const facts = (item.status === 'ATTENDED' || item.status === 'NOT_ATTENDED') && stored.outcome ? stored.outcome : exact(supply.getPublicSnapshot(item.opportunity_id, item.occurrence_id), item.opportunity_id, item.occurrence_id) ?? stored;
    const events = db.prepare('SELECT status,evidence_kind AS evidenceKind,at FROM student_occurrence_activity_events WHERE activity_id=? ORDER BY sequence').all(item.id) as ActivityItem['events'];
    return { id: item.id, opportunityId: item.opportunity_id, occurrenceId: item.occurrence_id, title: facts.title, startsAt: facts.startsAt, endsAt: facts.endsAt, signupUrl: facts.signupUrl, status: item.status, evidenceKind: item.evidence_kind, version: item.version, createdAt: item.created_at, updatedAt: item.updated_at, available: !!exact(supply.getPublic(item.opportunity_id, now, item.occurrence_id), item.opportunity_id, item.occurrence_id), isSynthetic: true, events };
  });
  const alerts = db.prepare('SELECT preferences_json FROM student_alerts WHERE persona_id=?').get(owner) as { preferences_json: string } | undefined;
  const reminderStates = (db.prepare('SELECT reminder_id,is_read,dismissed FROM student_reminder_state WHERE persona_id=? ORDER BY reminder_id').all(owner) as { reminder_id: string; is_read: number; dismissed: number }[]).map(item => ({ id: item.reminder_id, read: !!item.is_read, dismissed: !!item.dismissed }));
  const feedback = db.prepare('SELECT id,opportunity_id AS opportunityId,occurrence_id AS occurrenceId,title,kind,status,version,created_at AS createdAt,resolution,resolved_at AS resolvedAt FROM student_occurrence_feedback WHERE persona_id=? ORDER BY created_at DESC,id').all(owner).map(item => ({ ...item })) as StudentFeedback[];
  return { schemaVersion: 1, exportedAt: now.toISOString(), profile, saved, activity, alerts: alerts ? JSON.parse(alerts.preferences_json) as AlertPreferences : { inApp: false, eventReminders: false, catalogueUpdates: false }, reminderStates, feedback, privacy: readPrivacyState(db, owner, profile), measurement: exportMeasurementData(db, owner, now), notifications: exportOwnerNotifications(db, owner, now), safety:exportOwnerSafetyData(db,owner), distribution:exportOwnerDistribution(db,owner), evidence:exportOwnerEvidence(db,owner,now) };
}
