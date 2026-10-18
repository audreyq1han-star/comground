import { exportOwnerSafetyData, purgeOwnerSafetyData } from './safety-repository.ts';
import { exportOwnerDistribution, purgeOwnerDistribution } from './distribution-repository.ts';
import { exportOwnerEvidence, purgeOwnerEvidence, hasActiveSchoolProgramApproval } from './evidence-repository.ts';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { PublicOpportunity } from '../../../packages/domain/contracts.ts';
import type { ActivityInput, ActivityItem, ActivityStatus, AlertPreferences, StudentOwnerId, FeedbackKind, InAppReminder, OperatorReport, OutcomeSummary, ProfileInput, StudentDashboard, StudentExport, StudentFeedback, StudentMatches, StudentProfile, StudentSaved } from '../../../packages/domain/app-contracts.ts';
import { parsePreferences, rankMatches } from '../../../packages/domain/rules.ts';
import { RepositoryError } from './errors.ts';
import { objectInput } from './http.ts';
import { createMeasurementStore } from './measurement-repository.ts';
import type { StudentPrivacyState } from '../../../packages/domain/privacy-contracts.ts';
import { ACCOUNT_PRIVACY_VERSION, accountPrivacyInput, createPrivacyStore, isAccountOwner, validateStudentOwner } from './privacy-store.ts';
import { migrateStudentOwners } from './privacy-migration.ts';
import { getAccountById, requireStudentAccount } from './account-repository.ts';
import { exportOwnerNotifications, purgeOwnerNotifications } from './notification-repository.ts';
import { exportAccountStudentData } from './privacy-export.ts';
export { exportAccountStudentData } from './privacy-export.ts';

/** Only approved public projections cross this interface; no student row crosses back. */
export interface StudentSupplyReader {
  getPublic(id: string, now?: Date, occurrenceId?: string): PublicOpportunity | null;
  listPublic(query: { limit: number; offset: number }, now?: Date): { data: PublicOpportunity[]; total: number };
  getHistoricalSnapshot(externalId: string): PublicOpportunity | null;
  getPublicSnapshot(id: string, occurrenceId?: string): PublicOpportunity | null;
}
const DEFAULT_ALERTS: AlertPreferences = { inApp: false, eventReminders: false, catalogueUpdates: false };
const fail = (code: string, status: number, message: string): never => { throw new RepositoryError(code, status, message); };
function version(value: unknown, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) return fail('INVALID_INPUT', 422, 'Provide the current version as a whole number.');
  return value;
}
export function studentResourceId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) return fail('INVALID_INPUT', 422, 'Select a valid local resource.');
  return value;
}
export function studentOccurrenceId(value: unknown = 'primary'): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value)) return fail('INVALID_INPUT', 422, 'Select a valid dated occurrence.');
  return value;
}
function occurrenceKey(opportunityId: string, occurrenceId: string): string { return `${opportunityId}:${occurrenceId}`; }
function reminderId(kind: string, opportunityId: string, occurrenceId: string): string { return occurrenceId === 'primary' ? `${kind}:${opportunityId}` : `${kind}:${opportunityId}:${occurrenceId}`; }
function profileInput(input: unknown, ageBand: 'ADULT' | 'TEEN_13_17' = 'ADULT'): ProfileInput {
  const value = objectInput(input, ['expectedVersion', 'preferences', 'goal', 'storageConsent', 'privacyConsent']);
  if (value.storageConsent !== true) return fail('CONSENT_REQUIRED', 422, 'Consent to storing these private preferences is required.');
  if (typeof value.goal !== 'string' || !['EXPLORE', 'REGULAR', 'EXPERIENCE'].includes(value.goal)) return fail('INVALID_INPUT', 422, 'Choose a supported volunteering goal.');
  return { expectedVersion: version(value.expectedVersion, 0), preferences: parsePreferences(value.preferences), goal: value.goal as ProfileInput['goal'], storageConsent: true, ...(value.privacyConsent !== undefined ? { privacyConsent: accountPrivacyInput(value.privacyConsent, ageBand) } : {}) };
}
function alertInput(input: unknown): AlertPreferences {
  const value = objectInput(input, ['inApp', 'eventReminders', 'catalogueUpdates']);
  if (typeof value.inApp !== 'boolean' || typeof value.eventReminders !== 'boolean' || typeof value.catalogueUpdates !== 'boolean') return fail('INVALID_INPUT', 422, 'Set all three notification preferences to true or false.');
  return { inApp: value.inApp, eventReminders: value.eventReminders, catalogueUpdates: value.catalogueUpdates };
}
type ActivityFacts = Pick<PublicOpportunity, 'title' | 'startsAt' | 'endsAt' | 'signupUrl'>;
type ActivitySnapshot = ActivityFacts & { outcome?: ActivityFacts };
type ActivityRow = { id: string; opportunity_id: string; occurrence_id: string; snapshot_json: string; status: ActivityStatus; evidence_kind: ActivityItem['evidenceKind']; version: number; created_at: string; updated_at: string };
type SavedRow = { opportunity_id: string; occurrence_id: string; starts_at: string; ends_at: string; title: string; saved_at: string };
type ReminderState = { reminder_id: string; is_read: number; dismissed: number };
type FeedbackRow = { id: string; opportunity_id: string; occurrence_id: string; title: string; kind: FeedbackKind; status: StudentFeedback['status']; version: number; created_at: string; resolution: string | null; resolved_at: string | null };

/** Additive, all-or-nothing transfer away from legacy parent-only unique keys. */
function migrateOccurrenceStorage(db: DatabaseSync, supply: StudentSupplyReader): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS student_schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS student_occurrence_saves (persona_id TEXT NOT NULL REFERENCES student_profiles(persona_id) ON DELETE CASCADE, opportunity_id TEXT NOT NULL, occurrence_id TEXT NOT NULL, title TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY(persona_id, opportunity_id, occurrence_id));
      CREATE TABLE IF NOT EXISTS student_occurrence_activity (id TEXT PRIMARY KEY, persona_id TEXT NOT NULL REFERENCES student_profiles(persona_id) ON DELETE CASCADE, opportunity_id TEXT NOT NULL, occurrence_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('OPENED','APPLIED','ATTENDED','NOT_ATTENDED','WITHDRAWN')), evidence_kind TEXT NOT NULL CHECK(evidence_kind IN ('DEMO_HANDOFF','SELF_REPORTED')), version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(persona_id, opportunity_id, occurrence_id));
      CREATE TABLE IF NOT EXISTS student_occurrence_activity_events (id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES student_occurrence_activity(id) ON DELETE CASCADE, status TEXT NOT NULL, evidence_kind TEXT NOT NULL, at TEXT NOT NULL, sequence INTEGER NOT NULL, UNIQUE(activity_id, sequence));
      CREATE TABLE IF NOT EXISTS student_occurrence_feedback (id TEXT PRIMARY KEY, persona_id TEXT NOT NULL REFERENCES student_profiles(persona_id) ON DELETE CASCADE, opportunity_id TEXT NOT NULL, occurrence_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('NOT_RELEVANT','WRONG_DETAILS','UNAVAILABLE')), status TEXT NOT NULL CHECK(status IN ('OPEN','RESOLVED')), version INTEGER NOT NULL, created_at TEXT NOT NULL, resolution TEXT, resolved_at TEXT, UNIQUE(persona_id, opportunity_id, occurrence_id, kind));
      CREATE INDEX IF NOT EXISTS student_occurrence_activity_owner ON student_occurrence_activity(persona_id, updated_at);
      CREATE INDEX IF NOT EXISTS student_occurrence_feedback_owner ON student_occurrence_feedback(persona_id, created_at);
    `);
    const migrated = db.prepare("SELECT name FROM student_schema_migrations WHERE name = 'student-occurrences-v1'").get();
    if (!migrated) {
      db.exec(`
        INSERT INTO student_occurrence_activity (id, persona_id, opportunity_id, occurrence_id, snapshot_json, status, evidence_kind, version, created_at, updated_at)
          SELECT id, persona_id, opportunity_id, 'primary', snapshot_json, status, evidence_kind, version, created_at, updated_at FROM student_activity;
        INSERT INTO student_occurrence_activity_events (id, activity_id, status, evidence_kind, at, sequence)
          SELECT id, activity_id, status, evidence_kind, at, sequence FROM student_activity_events;
        INSERT INTO student_occurrence_feedback (id, persona_id, opportunity_id, occurrence_id, title, kind, status, version, created_at, resolution, resolved_at)
          SELECT id, persona_id, opportunity_id, 'primary', title, kind, status, version, created_at, resolution, resolved_at FROM student_feedback;
      `);
      const oldSaves = db.prepare('SELECT persona_id, opportunity_id, title, saved_at FROM student_saves').all() as { persona_id: string; opportunity_id: string; title: string; saved_at: string }[];
      for (const row of oldSaves) {
        const published = supply.getPublicSnapshot(row.opportunity_id, 'primary');
        const snapshot = published && (published.occurrenceId ?? 'primary') === 'primary' ? published : null;
        const activity = db.prepare('SELECT snapshot_json FROM student_activity WHERE persona_id = ? AND opportunity_id = ?').get(row.persona_id, row.opportunity_id) as { snapshot_json: string } | undefined;
        const fallback = activity ? JSON.parse(activity.snapshot_json) as ActivitySnapshot : null;
        // Rare legacy rows without recoverable dates stay saved with empty dates;
        // no invented occurrence times or silent row loss during migration.
        db.prepare('INSERT INTO student_occurrence_saves (persona_id, opportunity_id, occurrence_id, title, starts_at, ends_at, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(row.persona_id, row.opportunity_id, 'primary', row.title, snapshot?.startsAt ?? fallback?.startsAt ?? '', snapshot?.endsAt ?? fallback?.endsAt ?? '', row.saved_at);
      }
      const transfers = [
        ['student_saves', 'student_occurrence_saves', 'persona_id, opportunity_id, title, saved_at'],
        ['student_activity', 'student_occurrence_activity', 'id, persona_id, opportunity_id, snapshot_json, status, evidence_kind, version, created_at, updated_at'],
        ['student_activity_events', 'student_occurrence_activity_events', 'id, activity_id, status, evidence_kind, at, sequence'],
        ['student_feedback', 'student_occurrence_feedback', 'id, persona_id, opportunity_id, title, kind, status, version, created_at, resolution, resolved_at'],
      ];
      for (const [legacy, canonical, columns] of transfers) {
        const oldCount = (db.prepare(`SELECT COUNT(*) AS n FROM ${legacy}`).get() as { n: number }).n;
        const newCount = (db.prepare(`SELECT COUNT(*) AS n FROM ${canonical}`).get() as { n: number }).n;
        const different = db.prepare(`SELECT ${columns} FROM ${legacy} EXCEPT SELECT ${columns} FROM ${canonical}`).all();
        if (oldCount !== newCount || different.length) throw new RepositoryError('MIGRATION_FAILED', 500, 'The local occurrence migration could not verify every legacy record.');
      }
      // Delete only the verified source copies inside the same transaction. Table
      // schemas remain; rollback restores all source rows if any step fails.
      db.exec('DELETE FROM student_activity_events; DELETE FROM student_activity; DELETE FROM student_saves; DELETE FROM student_feedback;');
      const invalid = db.prepare('PRAGMA foreign_key_check').all();
      if (invalid.length) throw new RepositoryError('MIGRATION_FAILED', 500, 'The local occurrence migration found invalid record relationships.');
      db.prepare("INSERT INTO student_schema_migrations (name, applied_at) VALUES ('student-occurrences-v1', ?)").run(new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

/** Caller owns the transaction; used by both profile withdrawal and account deletion. */
export function deleteAccountStudentData(db: DatabaseSync, owner: StudentOwnerId): void {
  validateStudentOwner(owner);
  purgeOwnerNotifications(db, owner);
  purgeOwnerSafetyData(db, owner);
  purgeOwnerDistribution(db, owner);
  purgeOwnerEvidence(db, owner);
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='student_profiles'").get()) db.prepare('DELETE FROM student_profiles WHERE persona_id=?').run(owner);
}

export function createStudentRepository(filename: string, supply: StudentSupplyReader, options: { allowDemo?: boolean; seedExamples?: boolean } = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS student_profiles (persona_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS student_profile_clock (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO student_profile_clock (singleton, revision) VALUES (1, 0);
    UPDATE student_profile_clock SET revision = MAX(revision, COALESCE((SELECT MAX(CAST(json_extract(profile_json, '$.version') AS INTEGER)) FROM student_profiles), 0)) WHERE singleton = 1;
    CREATE TABLE IF NOT EXISTS student_saves (persona_id TEXT NOT NULL REFERENCES student_profiles(persona_id) ON DELETE CASCADE, opportunity_id TEXT NOT NULL, title TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY(persona_id, opportunity_id));
    CREATE TABLE IF NOT EXISTS student_activity (id TEXT PRIMARY KEY, persona_id TEXT NOT NULL REFERENCES student_profiles(persona_id) ON DELETE CASCADE, opportunity_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('OPENED','APPLIED','ATTENDED','NOT_ATTENDED','WITHDRAWN')), evidence_kind TEXT NOT NULL CHECK(evidence_kind IN ('DEMO_HANDOFF','SELF_REPORTED')), version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(persona_id, opportunity_id));
    CREATE TABLE IF NOT EXISTS student_activity_events (id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES student_activity(id) ON DELETE CASCADE, status TEXT NOT NULL, evidence_kind TEXT NOT NULL, at TEXT NOT NULL, sequence INTEGER NOT NULL, UNIQUE(activity_id, sequence));
    CREATE TABLE IF NOT EXISTS student_alerts (persona_id TEXT PRIMARY KEY REFERENCES student_profiles(persona_id) ON DELETE CASCADE, preferences_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS student_reminder_state (persona_id TEXT NOT NULL REFERENCES student_profiles(persona_id) ON DELETE CASCADE, reminder_id TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, dismissed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(persona_id, reminder_id));
    CREATE TABLE IF NOT EXISTS student_feedback (id TEXT PRIMARY KEY, persona_id TEXT NOT NULL REFERENCES student_profiles(persona_id) ON DELETE CASCADE, opportunity_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('NOT_RELEVANT','WRONG_DETAILS','UNAVAILABLE')), status TEXT NOT NULL CHECK(status IN ('OPEN','RESOLVED')), version INTEGER NOT NULL, created_at TEXT NOT NULL, resolution TEXT, resolved_at TEXT, UNIQUE(persona_id, opportunity_id, kind));
    CREATE INDEX IF NOT EXISTS student_feedback_owner ON student_feedback(persona_id, created_at);
    CREATE INDEX IF NOT EXISTS student_activity_owner ON student_activity(persona_id, updated_at);
  `);
  function transaction<T>(action: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try { const value = action(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  try { migrateStudentOwners(db); migrateOccurrenceStorage(db, supply); } catch (error) { db.close(); throw error; }
  const measurement = createMeasurementStore(db, { seedExamples: options.seedExamples, allowOwner: owner => !isAccountOwner(owner) || getAccountById(db, owner)?.ageBand === 'ADULT' });
  const privacy = createPrivacyStore(db);
  function currentOccurrence(id: string, now: Date, occurrenceId: string): PublicOpportunity | null {
    const item = supply.getPublic(id, now, occurrenceId);
    return item && item.id === id && (item.occurrenceId ?? 'primary') === occurrenceId ? item : null;
  }
  function publishedOccurrence(id: string, occurrenceId: string): PublicOpportunity | null {
    const item = supply.getPublicSnapshot(id, occurrenceId);
    return item && item.id === id && (item.occurrenceId ?? 'primary') === occurrenceId ? item : null;
  }
  function ownProfile(owner: StudentOwnerId): StudentProfile | null {
    validateStudentOwner(owner);
    if(isAccountOwner(owner)){const account=getAccountById(db,owner);if(!account || account.role!=='STUDENT' || !account.emailVerified) return fail('ACCOUNT_REQUIRED',403,'A verified student account is required.');}
    else if(options.allowDemo===false) return fail('DEMO_DISABLED',403,'Fictional personas are unavailable in account mode.');
    const row=db.prepare('SELECT profile_json FROM student_profiles WHERE persona_id=?').get(owner) as {profile_json:string}|undefined;
    return row?JSON.parse(row.profile_json):null;
  }
  function getProfile(owner: StudentOwnerId): StudentProfile | null {
    validateStudentOwner(owner);
    if (isAccountOwner(owner)) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'").get()) return fail('ACCOUNT_REQUIRED', 403, 'A verified and admitted student account is required.');
      requireStudentAccount(db, owner);
    }
    else if (options.allowDemo === false) return fail('DEMO_DISABLED', 403, 'Fictional personas are unavailable in account mode.');
    const row = db.prepare('SELECT profile_json FROM student_profiles WHERE persona_id = ?').get(owner) as { profile_json: string } | undefined;
    return row ? JSON.parse(row.profile_json) : null;
  }
  function requireProfile(owner: StudentOwnerId): StudentProfile {
    const profile = getProfile(owner) ?? fail('CONSENT_REQUIRED', 403, 'Complete a profile and storage consent first.');
    privacy.requireStorage(owner, profile);
    return profile;
  }
  function activityFacts(row: ActivityRow): ActivityFacts {
    const stored = JSON.parse(row.snapshot_json) as ActivitySnapshot;
    // Completed reports keep the occurrence facts they described. Pending activity
    // follows the last published schedule; unpublished operator edits never leak.
    if ((row.status === 'ATTENDED' || row.status === 'NOT_ATTENDED') && stored.outcome) return stored.outcome;
    return publishedOccurrence(row.opportunity_id, row.occurrence_id) ?? stored;
  }
  function activityDTO(owner: StudentOwnerId, row: ActivityRow, now: Date): ActivityItem {
    const snapshot = activityFacts(row);
    const events = db.prepare('SELECT status, evidence_kind AS evidenceKind, at FROM student_occurrence_activity_events WHERE activity_id = ? ORDER BY sequence').all(row.id) as ActivityItem['events'];
    return { id: row.id, opportunityId: row.opportunity_id, occurrenceId: row.occurrence_id, title: snapshot.title, startsAt: snapshot.startsAt, endsAt: snapshot.endsAt, signupUrl: snapshot.signupUrl, status: row.status, evidenceKind: row.evidence_kind, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, available: !!currentOccurrence(row.opportunity_id, now, row.occurrence_id), isSynthetic: true, events };
  }
  function activityRow(owner: StudentOwnerId, id: string): ActivityRow | undefined { return db.prepare('SELECT * FROM student_occurrence_activity WHERE persona_id = ? AND id = ?').get(owner, id) as ActivityRow | undefined; }
  function insertActivity(owner: StudentOwnerId, opportunity: PublicOpportunity, now: Date): string {
    const id = randomUUID(), at = now.toISOString();
    const snapshot = { title: opportunity.title, startsAt: opportunity.startsAt, endsAt: opportunity.endsAt, signupUrl: opportunity.signupUrl };
    db.prepare("INSERT INTO student_occurrence_activity (id, persona_id, opportunity_id, occurrence_id, snapshot_json, status, evidence_kind, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'OPENED', 'DEMO_HANDOFF', 1, ?, ?)").run(id, owner, opportunity.id, opportunity.occurrenceId ?? 'primary', JSON.stringify(snapshot), at, at);
    db.prepare("INSERT INTO student_occurrence_activity_events (id, activity_id, status, evidence_kind, at, sequence) VALUES (?, ?, 'OPENED', 'DEMO_HANDOFF', ?, 1)").run(randomUUID(), id, at);
    return id;
  }
  function saveProfile(owner: StudentOwnerId, input: unknown, now = new Date()): StudentProfile {
    const identity = isAccountOwner(owner) ? requireStudentAccount(db,owner) : null;
    const details = profileInput(input,identity?.ageBand ?? 'ADULT');
    return transaction(() => {
      const current = getProfile(owner);
      if ((current?.version ?? 0) !== details.expectedVersion) return fail('VERSION_CONFLICT', 409, 'Your profile changed. Reload the latest version before saving.');
      const account = isAccountOwner(owner);
      if (identity && (identity.ageBand==='TEEN_13_17' ? details.preferences.ageMin<13 || details.preferences.ageMax>17 : details.preferences.ageMin<18)) return fail(identity?.ageBand==='TEEN_13_17'?'AGE_BAND_MISMATCH':'ADULT_COHORT_ONLY',403,'Choose a preference age band within your account age category. School stage does not change age eligibility.');
      if (account && !current && !details.privacyConsent) return fail('PRIVACY_CONSENT_REQUIRED', 403, 'Review the current age-appropriate privacy notice before creating a profile.');
      if (current && details.privacyConsent) return fail('PRIVACY_UPDATE_REQUIRED', 422, 'Use the versioned privacy settings to change consent.');
      if (current) privacy.requireStorage(owner, current);
      // One anonymous counter avoids reusing an earlier profile's version after
      // deletion/recreation, without retaining any deleted person's metadata.
      const clock = db.prepare('SELECT revision FROM student_profile_clock WHERE singleton = 1').get() as { revision: number };
      if (!Number.isSafeInteger(clock.revision + 1)) return fail('REVISION_UNAVAILABLE', 503, 'The local profile revision is unavailable.');
      const nextVersion = clock.revision + 1;
      db.prepare('UPDATE student_profile_clock SET revision = ? WHERE singleton = 1').run(nextVersion);
      const profile: StudentProfile = { personaId: owner, label: account ? 'Student account' : owner === 'demo-alex' ? 'Alex · demo' : 'Sam · demo', version: nextVersion, preferences: details.preferences, goal: details.goal, consentVersion: account ? identity?.ageBand==='TEEN_13_17' ? 'teen-local-v1' : ACCOUNT_PRIVACY_VERSION : 'local-demo-v1', consentedAt: current?.consentedAt ?? now.toISOString(), updatedAt: now.toISOString() };
      db.prepare('INSERT INTO student_profiles (persona_id, profile_json) VALUES (?, ?) ON CONFLICT(persona_id) DO UPDATE SET profile_json = excluded.profile_json').run(owner, JSON.stringify(profile));
      if (account && !current) privacy.save(owner, details.privacyConsent!, now);
      if (!current) {
        db.prepare('INSERT INTO student_alerts (persona_id, preferences_json) VALUES (?, ?)').run(owner, JSON.stringify(DEFAULT_ALERTS));
        const historical = account ? null : supply.getHistoricalSnapshot('synthetic-past-reading-001');
        // One explicit historical demo item permits trying self-report; never seeds an application.
        if (historical && Date.parse(historical.endsAt) <= now.getTime()) insertActivity(owner, historical, now);
      }
      return profile;
    });
  }
  function deleteProfile(owner: StudentOwnerId, expectedProfileVersion?: number): void {
    transaction(() => {
      const profile = ownProfile(owner);
      if (isAccountOwner(owner) && version(expectedProfileVersion, 0) !== (profile?.version ?? 0)) return fail('VERSION_CONFLICT', 409, 'Your profile changed. Reload before withdrawing storage consent.');
      deleteAccountStudentData(db, owner);
    });
  }
  function getPrivacy(owner: StudentOwnerId): StudentPrivacyState { return privacy.state(owner, ownProfile(owner)); }
  function updatePrivacy(owner: StudentOwnerId, input: unknown, now = new Date()): StudentPrivacyState {
    const value = objectInput(input, ['expectedVersion', 'expectedProfileVersion', 'policyVersion', 'adultConfirmed', 'personalization', 'aiExplanations']);
    const expectedVersion = version(value.expectedVersion, 0), expectedProfileVersion = version(value.expectedProfileVersion);
    const identity=isAccountOwner(owner)?requireStudentAccount(db,owner):null;
    const consent = accountPrivacyInput({ policyVersion: value.policyVersion, adultConfirmed: value.adultConfirmed, personalization: value.personalization, aiExplanations: value.aiExplanations },identity?.ageBand ?? 'ADULT');
    return transaction(() => {
      const profile = getProfile(owner) ?? fail('CONSENT_REQUIRED', 403, 'Create a profile before changing privacy choices.');
      if (!isAccountOwner(owner)) return fail('ACCOUNT_REQUIRED', 403, 'Account privacy choices are available to registered students.');
      if (profile.version !== expectedProfileVersion || privacy.state(owner, profile).version !== expectedVersion) return fail('VERSION_CONFLICT', 409, 'Your profile or privacy choices changed. Reload before saving.');
      if (identity && (identity.ageBand==='TEEN_13_17' ? profile.preferences.ageMin<13 || profile.preferences.ageMax>17 : profile.preferences.ageMin<18)) return fail(identity?.ageBand==='TEEN_13_17'?'AGE_BAND_MISMATCH':'ADULT_COHORT_ONLY',403,'The stored profile age band does not match this account.');
      privacy.save(owner, consent, now);
      return privacy.state(owner, profile);
    });
  }
  function savedData(owner: StudentOwnerId, now: Date): StudentSaved[] {
    return (db.prepare('SELECT opportunity_id, occurrence_id, title, starts_at, ends_at, saved_at FROM student_occurrence_saves WHERE persona_id = ? ORDER BY saved_at DESC, opportunity_id, occurrence_id').all(owner) as SavedRow[]).map(row => {
      const opportunity = currentOccurrence(row.opportunity_id, now, row.occurrence_id);
      // Unavailability must not rewind a reviewed reschedule to the original save.
      // Only this exact date's published facts may replace its retained snapshot.
      const facts = opportunity ?? publishedOccurrence(row.opportunity_id, row.occurrence_id);
      return { opportunityId: row.opportunity_id, occurrenceId: row.occurrence_id, title: facts?.title ?? row.title, startsAt: facts?.startsAt ?? row.starts_at, endsAt: facts?.endsAt ?? row.ends_at, savedAt: row.saved_at, available: !!opportunity, opportunity };
    });
  }
  function listSaves(owner: StudentOwnerId, now = new Date()): StudentSaved[] { requireProfile(owner); return savedData(owner, now); }
  function saveOpportunity(owner: StudentOwnerId, id: string, now = new Date(), occurrenceId = 'primary'): StudentSaved {
    requireProfile(owner); studentResourceId(id); studentOccurrenceId(occurrenceId);
    return transaction(() => {
      const opportunity = currentOccurrence(id, now, occurrenceId) ?? fail('NOT_FOUND', 404, 'This dated occurrence is no longer available to save.');
      const existing = listSaves(owner, now).find(item => item.opportunityId === id && item.occurrenceId === occurrenceId);
      if (existing) return existing;
      db.prepare('INSERT INTO student_occurrence_saves (persona_id, opportunity_id, occurrence_id, title, starts_at, ends_at, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(owner, id, occurrenceId, opportunity.title, opportunity.startsAt, opportunity.endsAt, now.toISOString());
      measurement.recordOutcome(owner, { opportunityId: id, occurrenceId, kind: 'SAVED', eventKey: randomUUID() }, now);
      return listSaves(owner, now).find(item => item.opportunityId === id && item.occurrenceId === occurrenceId)!;
    });
  }
  function removeSave(owner: StudentOwnerId, id: string, occurrenceId = 'primary'): void { requireProfile(owner); studentResourceId(id); studentOccurrenceId(occurrenceId); db.prepare('DELETE FROM student_occurrence_saves WHERE persona_id = ? AND opportunity_id = ? AND occurrence_id = ?').run(owner, id, occurrenceId); }
  function activityData(owner: StudentOwnerId, now: Date): ActivityItem[] {
    return (db.prepare('SELECT * FROM student_occurrence_activity WHERE persona_id = ? ORDER BY updated_at DESC, id').all(owner) as ActivityRow[]).map(row => activityDTO(owner, row, now));
  }
  function listActivity(owner: StudentOwnerId, now = new Date()): ActivityItem[] { requireProfile(owner); return activityData(owner, now); }
  function handoff(owner: StudentOwnerId, id: string, now = new Date(), occurrenceId = 'primary'): ActivityItem {
    requireProfile(owner); studentResourceId(id); studentOccurrenceId(occurrenceId);
    return transaction(() => {
      // Idempotence must not bypass current publication/source/freshness checks.
      // Retained activity remains readable, but cannot reopen an unavailable signup.
      const opportunity = currentOccurrence(id, now, occurrenceId) ?? fail('NOT_FOUND', 404, 'This dated occurrence is no longer available for a signup preview.');
      const existing = db.prepare('SELECT * FROM student_occurrence_activity WHERE persona_id = ? AND opportunity_id = ? AND occurrence_id = ?').get(owner, id, occurrenceId) as ActivityRow | undefined;
      if (existing) return activityDTO(owner, existing, now);
      const activityId = insertActivity(owner, opportunity, now);
      measurement.recordOutcome(owner, { opportunityId: id, occurrenceId, kind: 'OPENED', eventKey: `${activityId}:1` }, now);
      return activityDTO(owner, activityRow(owner, activityId)!, now);
    });
  }
  function updateActivity(owner: StudentOwnerId, id: string, input: unknown, now = new Date()): ActivityItem {
    requireProfile(owner); studentResourceId(id);
    const value = objectInput(input, ['expectedVersion', 'status']);
    const expectedVersion = version(value.expectedVersion);
    if (typeof value.status !== 'string' || !['APPLIED', 'ATTENDED', 'NOT_ATTENDED', 'WITHDRAWN'].includes(value.status)) return fail('INVALID_INPUT', 422, 'Choose a supported self-reported activity status.');
    const status = value.status as ActivityInput['status'];
    return transaction(() => {
      const row = activityRow(owner, id) ?? fail('NOT_FOUND', 404, 'Activity not found in this demo profile.');
      if (row.version !== expectedVersion) return fail('VERSION_CONFLICT', 409, 'This activity changed. Reload it before updating.');
      if (row.status === status) return activityDTO(owner, row, now);
      const facts = activityFacts(row);
      if ((status === 'ATTENDED' || status === 'NOT_ATTENDED') && Date.parse(facts.endsAt) > now.getTime()) return fail('OCCURRENCE_NOT_ENDED', 422, 'Attendance can only be self-reported after the latest published occurrence ends.');
      const snapshot = JSON.parse(row.snapshot_json) as ActivitySnapshot;
      if (status === 'ATTENDED' || status === 'NOT_ATTENDED') snapshot.outcome = { title: facts.title, startsAt: facts.startsAt, endsAt: facts.endsAt, signupUrl: facts.signupUrl };
      const at = now.toISOString();
      db.prepare("UPDATE student_occurrence_activity SET status = ?, evidence_kind = 'SELF_REPORTED', snapshot_json = ?, version = version + 1, updated_at = ? WHERE persona_id = ? AND id = ?").run(status, JSON.stringify(snapshot), at, owner, id);
      db.prepare("INSERT INTO student_occurrence_activity_events (id, activity_id, status, evidence_kind, at, sequence) VALUES (?, ?, ?, 'SELF_REPORTED', ?, ?)").run(randomUUID(), id, status, at, row.version + 1);
      if (status === 'APPLIED' || status === 'ATTENDED') measurement.recordOutcome(owner, { opportunityId: row.opportunity_id, occurrenceId: row.occurrence_id, startsAt: facts.startsAt, endsAt: facts.endsAt, kind: status, eventKey: `${id}:${row.version + 1}` }, now);
      return activityDTO(owner, activityRow(owner, id)!, now);
    });
  }
  function alertData(owner: StudentOwnerId): AlertPreferences {
    const row = db.prepare('SELECT preferences_json FROM student_alerts WHERE persona_id = ?').get(owner) as { preferences_json: string } | undefined;
    return row ? JSON.parse(row.preferences_json) : { ...DEFAULT_ALERTS };
  }
  function getAlerts(owner: StudentOwnerId): AlertPreferences { requireProfile(owner); return alertData(owner); }
  function setAlerts(owner: StudentOwnerId, input: unknown): AlertPreferences {
    return transaction(() => {
      const profile = requireProfile(owner);
      const value = objectInput(input, ['inApp', 'eventReminders', 'catalogueUpdates', 'expectedProfileVersion']);
      if (isAccountOwner(owner) && version(value.expectedProfileVersion) !== profile.version) return fail('VERSION_CONFLICT', 409, 'Your profile changed. Reload before choosing reminders.');
      const alerts = alertInput({ inApp: value.inApp, eventReminders: value.eventReminders, catalogueUpdates: value.catalogueUpdates });
      db.prepare('INSERT INTO student_alerts (persona_id, preferences_json) VALUES (?, ?) ON CONFLICT(persona_id) DO UPDATE SET preferences_json = excluded.preferences_json').run(owner, JSON.stringify(alerts));
      return alerts;
    });
  }
  function reminderStates(owner: StudentOwnerId) {
    return (db.prepare('SELECT reminder_id, is_read, dismissed FROM student_reminder_state WHERE persona_id = ? ORDER BY reminder_id').all(owner) as ReminderState[])
      .map(row => ({ id: row.reminder_id, read: !!row.is_read, dismissed: !!row.dismissed }));
  }
  function listReminders(owner: StudentOwnerId, now = new Date(), includeDismissed = false): InAppReminder[] {
    const alerts = getAlerts(owner);
    if (!alerts.inApp) return [];
    const result: InAppReminder[] = [];
    const activity = listActivity(owner, now);
    const activityByOpportunity = new Map(activity.map(item => [occurrenceKey(item.opportunityId, item.occurrenceId), item]));
    const pending = (item: ActivityItem) => item.status === 'OPENED' || item.status === 'APPLIED';
    const upcomingIds = new Set<string>();
    function addUpcoming(opportunity: PublicOpportunity, createdAt: string, message: string) {
      const startsAt = Date.parse(opportunity.startsAt), occurrenceId = opportunity.occurrenceId ?? 'primary', key = occurrenceKey(opportunity.id, occurrenceId);
      if (!alerts.eventReminders || startsAt <= now.getTime() || startsAt - now.getTime() > 14 * 86400000 || upcomingIds.has(key)) return;
      upcomingIds.add(key);
      result.push({ id: reminderId('upcoming', opportunity.id, occurrenceId), kind: 'UPCOMING', title: opportunity.title, message, opportunityId: opportunity.id, occurrenceId, href: `/opportunities/${encodeURIComponent(opportunity.id)}?occurrence=${encodeURIComponent(occurrenceId)}`, read: false, createdAt });
    }
    for (const item of listSaves(owner, now)) {
      if (!item.available && alerts.catalogueUpdates) result.push({ id: reminderId('unavailable', item.opportunityId, item.occurrenceId), kind: 'UNAVAILABLE', title: item.title, message: 'This saved listing is unavailable or needs a fresh review. Check other current opportunities.', opportunityId: item.opportunityId, occurrenceId: item.occurrenceId, href: '/saved', read: false, createdAt: item.savedAt });
      const tracked = activityByOpportunity.get(occurrenceKey(item.opportunityId, item.occurrenceId));
      // A retained save must not revive event reminders after a terminal outcome.
      if (item.opportunity && (!tracked || pending(tracked))) addUpcoming(item.opportunity, item.savedAt, 'Your saved occurrence is coming up. Check its requirements and current details before making plans.');
    }
    if (alerts.eventReminders) for (const item of activity) {
      if (!pending(item)) continue;
      // Public availability is checked at read time: paused, withdrawn, expired
      // or draft supply cannot create an actionable upcoming reminder.
      const opportunity = currentOccurrence(item.opportunityId, now, item.occurrenceId);
      if (opportunity) addUpcoming(opportunity, item.createdAt, item.status === 'APPLIED'
        ? 'Your self-reported application is for an upcoming occurrence. Check current details before making plans.'
        : 'An occurrence from your demo signup previews is coming up. Check current requirements and details before making plans.');
      if (Date.parse(item.endsAt) <= now.getTime()) result.push({ id: reminderId('follow-up', item.opportunityId, item.occurrenceId), kind: 'FOLLOW_UP', title: item.title, message: 'This synthetic occurrence has ended. You can record a self-reported outcome; it is not organizer confirmation.', opportunityId: item.opportunityId, occurrenceId: item.occurrenceId, href: '/activity', read: false, createdAt: item.endsAt });
    }
    const states = new Map(reminderStates(owner).map(row => [row.id, row]));
    return result.filter(item => includeDismissed || !states.get(item.id)?.dismissed).map(item => ({ ...item, read: !!states.get(item.id)?.read })).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }
  function updateReminder(owner: StudentOwnerId, id: string, action: unknown, now = new Date()): { id: string; read: boolean; dismissed: boolean } {
    requireProfile(owner); studentResourceId(id);
    if (action !== 'READ' && action !== 'DISMISS') return fail('INVALID_INPUT', 422, 'Choose READ or DISMISS.');
    const reminder = listReminders(owner, now, true).find(item => item.id === id) ?? fail('NOT_FOUND', 404, 'This reminder is no longer available.');
    db.prepare('INSERT INTO student_reminder_state (persona_id, reminder_id, is_read, dismissed) VALUES (?, ?, 1, ?) ON CONFLICT(persona_id, reminder_id) DO UPDATE SET is_read = 1, dismissed = MAX(student_reminder_state.dismissed, excluded.dismissed)').run(owner, reminder.id, action === 'DISMISS' ? 1 : 0);
    const state = db.prepare('SELECT reminder_id, is_read, dismissed FROM student_reminder_state WHERE persona_id = ? AND reminder_id = ?').get(owner, id) as ReminderState;
    return { id, read: !!state.is_read, dismissed: !!state.dismissed };
  }
  function matches(owner: StudentOwnerId, now = new Date()): StudentMatches {
    const profile = requireProfile(owner), candidates: PublicOpportunity[] = [];
    if (!privacy.state(owner, profile).personalization) return fail('PERSONALIZATION_CONSENT_REQUIRED', 403, 'Enable optional personalized matches in privacy settings first.');
    for (let offset = 0; offset <= 10000;) {
      const page = supply.listPublic({ limit: 50, offset }, now);
      candidates.push(...page.data); offset += page.data.length;
      if (!page.data.length || offset >= page.total) break;
    }
    const programId=profile.preferences.schoolProgramId;
    const syntheticSchoolProgramApprovals=programId?candidates.filter(item=>item.isSynthetic&&hasActiveSchoolProgramApproval(db,{programId,organizationId:item.organization.id,opportunityId:item.id},now)).map(item=>item.id):[];
    const ranked = rankMatches(candidates, profile.preferences, now,{syntheticSchoolProgramApprovals});
    return { data: ranked.slice(0, 3), eligibleCount: ranked.length, engine: 'DETERMINISTIC_RULES', profileVersion: profile.version, preferences: profile.preferences };
  }
  function dashboard(owner: StudentOwnerId, now = new Date()): StudentDashboard {
    const profile = requireProfile(owner), activity = listActivity(owner, now);
    const matched: StudentMatches = privacy.state(owner, profile).personalization ? matches(owner, now) : { data: [], eligibleCount: 0, engine: 'DETERMINISTIC_RULES', profileVersion: profile.version, preferences: profile.preferences };
    return { profile, counts: { saved: listSaves(owner, now).length, opened: activity.filter(item => item.status === 'OPENED').length, applied: activity.filter(item => item.status === 'APPLIED').length, attended: activity.filter(item => item.status === 'ATTENDED').length }, matches: matched, activity, reminders: listReminders(owner, now) };
  }
  function feedbackDTO(row: FeedbackRow): StudentFeedback {
    return { id: row.id, opportunityId: row.opportunity_id, occurrenceId: row.occurrence_id, title: row.title, kind: row.kind, status: row.status, version: row.version, createdAt: row.created_at, resolution: row.resolution, resolvedAt: row.resolved_at };
  }
  function reportDTO(row: FeedbackRow): OperatorReport {
    if (row.kind === 'NOT_RELEVANT') return fail('NOT_FOUND', 404, 'Report not found.');
    // Explicit operator allowlist: private identity/preferences never leave this store.
    return { id: row.id, opportunityId: row.opportunity_id, occurrenceId: row.occurrence_id, title: row.title, kind: row.kind, status: row.status, version: row.version, createdAt: row.created_at, resolution: row.resolution, resolvedAt: row.resolved_at, studentIdentitiesIncluded: false };
  }
  function feedbackData(owner: StudentOwnerId): StudentFeedback[] {
    return (db.prepare('SELECT id, opportunity_id, occurrence_id, title, kind, status, version, created_at, resolution, resolved_at FROM student_occurrence_feedback WHERE persona_id = ? ORDER BY created_at DESC, id').all(owner) as FeedbackRow[]).map(feedbackDTO);
  }
  function listFeedback(owner: StudentOwnerId): StudentFeedback[] { requireProfile(owner); return feedbackData(owner); }
  function submitFeedback(owner: StudentOwnerId, input: unknown, now = new Date()): StudentFeedback {
    requireProfile(owner);
    const value = objectInput(input, ['opportunityId', 'occurrenceId', 'kind']);
    const opportunityId = studentResourceId(value.opportunityId), occurrenceId = studentOccurrenceId(value.occurrenceId);
    if (typeof value.kind !== 'string' || !['NOT_RELEVANT', 'WRONG_DETAILS', 'UNAVAILABLE'].includes(value.kind)) return fail('INVALID_INPUT', 422, 'Choose a supported feedback category.');
    const kind = value.kind as FeedbackKind;
    return transaction(() => {
      const existing = db.prepare('SELECT id, opportunity_id, occurrence_id, title, kind, status, version, created_at, resolution, resolved_at FROM student_occurrence_feedback WHERE persona_id = ? AND opportunity_id = ? AND occurrence_id = ? AND kind = ?').get(owner, opportunityId, occurrenceId, kind) as FeedbackRow | undefined;
      if (existing) return feedbackDTO(existing);
      // Formerly published records may be reported from retained saved/activity
      // history. Draft-only records have no public snapshot and remain inaccessible.
      const opportunity = currentOccurrence(opportunityId, now, occurrenceId) ?? publishedOccurrence(opportunityId, occurrenceId) ?? fail('NOT_FOUND', 404, 'This opportunity has no published listing to report.');
      const row: FeedbackRow = { id: randomUUID(), opportunity_id: opportunityId, occurrence_id: occurrenceId, title: opportunity.title, kind, status: 'OPEN', version: 1, created_at: now.toISOString(), resolution: null, resolved_at: null };
      db.prepare("INSERT INTO student_occurrence_feedback (id, persona_id, opportunity_id, occurrence_id, title, kind, status, version, created_at, resolution, resolved_at) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', 1, ?, NULL, NULL)").run(row.id, owner, opportunityId, occurrenceId, row.title, kind, row.created_at);
      if (kind === 'NOT_RELEVANT') measurement.recordOutcome(owner, { opportunityId, occurrenceId, kind: 'NOT_RELEVANT', eventKey: row.id }, now);
      return feedbackDTO(row);
    });
  }
  function listReports(): OperatorReport[] {
    return (db.prepare("SELECT id, opportunity_id, occurrence_id, title, kind, status, version, created_at, resolution, resolved_at FROM student_occurrence_feedback WHERE kind IN ('WRONG_DETAILS','UNAVAILABLE') ORDER BY created_at DESC, id").all() as FeedbackRow[]).map(reportDTO);
  }
  function resolveReport(id: string, input: unknown, now = new Date()): OperatorReport {
    studentResourceId(id);
    const value = objectInput(input, ['expectedVersion', 'reason']);
    const expectedVersion = version(value.expectedVersion);
    if (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 1000) return fail('INVALID_INPUT', 422, 'Provide a resolution reason of 1–1000 characters.');
    const reason = value.reason.trim();
    return transaction(() => {
      const row = db.prepare("SELECT id, opportunity_id, occurrence_id, title, kind, status, version, created_at, resolution, resolved_at FROM student_occurrence_feedback WHERE id = ? AND kind IN ('WRONG_DETAILS','UNAVAILABLE')").get(id) as FeedbackRow | undefined;
      if (!row) return fail('NOT_FOUND', 404, 'Report not found.');
      if (row.version !== expectedVersion) return fail('VERSION_CONFLICT', 409, 'This report changed. Reload the latest version before resolving it.');
      if (row.status === 'RESOLVED') {
        if (row.resolution === reason) return reportDTO(row);
        return fail('STATE_CONFLICT', 409, 'This report already has a recorded resolution.');
      }
      const resolved: FeedbackRow = { ...row, status: 'RESOLVED', version: row.version + 1, resolution: reason, resolved_at: now.toISOString() };
      db.prepare("UPDATE student_occurrence_feedback SET status = 'RESOLVED', version = ?, resolution = ?, resolved_at = ? WHERE id = ?").run(resolved.version, resolved.resolution, resolved.resolved_at, id);
      return reportDTO(resolved);
    });
  }
  function exportData(owner: StudentOwnerId, now = new Date()): StudentExport {
    const profile = getProfile(owner);
    return exportAccountStudentData(db, owner, supply, now) ?? { schemaVersion: 1, exportedAt: now.toISOString(), profile, saved: [], activity: [], alerts: { ...DEFAULT_ALERTS }, reminderStates: [], feedback: [], measurement: measurement.exportData(owner, now), privacy: privacy.state(owner, profile), notifications: exportOwnerNotifications(db, owner, now), safety:exportOwnerSafetyData(db,owner), distribution:exportOwnerDistribution(db,owner), evidence:exportOwnerEvidence(db,owner,now) };
  }
  function outcomes(): OutcomeSummary {
    const counts = new Map((db.prepare("SELECT status, COUNT(*) AS count FROM student_occurrence_activity WHERE persona_id IN ('demo-alex','demo-sam') GROUP BY status").all() as { status: ActivityStatus; count: number }[]).map(row => [row.status, row.count]));
    return { evidenceLabel: 'Synthetic local self-reports', opened: counts.get('OPENED') ?? 0, applied: counts.get('APPLIED') ?? 0, attended: counts.get('ATTENDED') ?? 0, notAttended: counts.get('NOT_ATTENDED') ?? 0, withdrawn: counts.get('WITHDRAWN') ?? 0, organizerConfirmed: 0, studentIdentitiesIncluded: false };
  }
  return { measurement, getProfile, requireProfile, saveProfile, deleteProfile, getPrivacy, updatePrivacy, listSaves, saveOpportunity, removeSave, listActivity, handoff, updateActivity, getAlerts, setAlerts, listReminders, updateReminder, matches, dashboard, listFeedback, submitFeedback, listReports, resolveReport, exportData, outcomes, close: () => db.close() };
}
export type StudentRepository = ReturnType<typeof createStudentRepository>;
