import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { StudentOwnerId } from '../../../packages/domain/app-contracts.ts';
import { SAFETY_CATEGORIES, SAFETY_RATIONALES, SAFETY_STATUSES, SAFETY_URGENCIES, type OperatorSafetyReport, type CreateSafetyReportInput, type SafetyEvent, type SafetyExport, type SafetyModerationInput, type SafetyReport, type SafetyTarget } from '../../../packages/domain/safety-contracts.ts';
import type { StudentSupplyReader } from './student-repository.ts';
import { RepositoryError } from './errors.ts';
import { objectInput } from './http.ts';
import { validateStudentOwner } from './privacy-store.ts';

const DAY_MS = 86_400_000;
const MAX_REPORTS_PER_OWNER = 100;
const MAX_REPORTS = 3000;
const MAX_REPORT_VERSIONS = 50;
type ReportRow = { id: string; target_json: string; category: SafetyReport['category']; urgency: SafetyReport['urgency']; assigned_operator_id: string|null; narrative: string; status: SafetyReport['status']; rationale: SafetyReport['rationale']; version: number; quarantine_requested: number; created_at: string; updated_at: string };
const columns = 'id,target_json,category,urgency,assigned_operator_id,narrative,status,rationale,version,quarantine_requested,created_at,updated_at';
function fail(code: string, status: number, message: string): never { throw new RepositoryError(code, status, message); }
function studentResourceId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) return fail('INVALID_INPUT', 422, 'Choose a valid resource.');
  return value;
}
function studentOccurrenceId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value)) return fail('INVALID_INPUT', 422, 'Choose an exact listing date.');
  return value;
}
function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return fail('INVALID_INPUT', 422, 'Provide the current report version.');
  return value;
}
function createInput(input: unknown): CreateSafetyReportInput {
  const value = objectInput(input, ['target', 'category', 'urgency', 'narrative', 'storageConsent']);
  if (value.storageConsent !== true) return fail('CONSENT_REQUIRED', 422, 'Confirm storage of this private report and its review history.');
  const target = objectInput(value.target, ['kind', 'opportunityId', 'occurrenceId']);
  if (target.kind !== 'PLATFORM' && target.kind !== 'LISTING') return fail('INVALID_INPUT', 422, 'Choose a listing date or platform safety concern.');
  if (target.kind === 'PLATFORM' && (target.opportunityId !== undefined || target.occurrenceId !== undefined)) return fail('INVALID_INPUT', 422, 'A platform concern cannot include listing fields.');
  if (!SAFETY_CATEGORIES.includes(value.category as SafetyReport['category'])) return fail('INVALID_INPUT', 422, 'Choose a supported safety category.');
  if (value.urgency !== undefined && !SAFETY_URGENCIES.includes(value.urgency as SafetyReport['urgency'])) return fail('INVALID_INPUT', 422, 'Choose a supported urgency.');
  if (value.narrative !== undefined && (typeof value.narrative !== 'string' || value.narrative.length > 500 || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]|\b[a-z][a-z0-9+.-]*:\/\/|\b(?:www\.|javascript:|data:)/i.test(value.narrative))) return fail('INVALID_INPUT', 422, 'Use at most 500 characters of plain text, without links, HTML, or identifying details.');
  if (target.kind === 'LISTING' && target.occurrenceId === undefined) return fail('INVALID_INPUT', 422, 'Choose the exact listing date.');
  return { storageConsent: true, target: target.kind === 'PLATFORM' ? { kind: 'PLATFORM' } : { kind: 'LISTING', opportunityId: studentResourceId(target.opportunityId), occurrenceId: studentOccurrenceId(target.occurrenceId) }, category: value.category as SafetyReport['category'], urgency: (value.urgency ?? 'ROUTINE') as SafetyReport['urgency'], narrative: typeof value.narrative === 'string' ? value.narrative.trim() : '' };
}
function moderationInput(input: unknown): SafetyModerationInput {
  const value = objectInput(input, ['expectedVersion', 'status', 'rationale', 'requestQuarantine', 'assignedOperatorId']);
  if (!SAFETY_STATUSES.includes(value.status as SafetyReport['status']) || !SAFETY_RATIONALES.includes(value.rationale as NonNullable<SafetyReport['rationale']>) || (value.requestQuarantine !== undefined && typeof value.requestQuarantine !== 'boolean')) return fail('INVALID_INPUT', 422, 'Choose a supported status and structured reason.');
  if (value.assignedOperatorId !== undefined && value.assignedOperatorId !== null) studentResourceId(value.assignedOperatorId);
  return { assignedOperatorId: value.assignedOperatorId as string|null|undefined, expectedVersion: version(value.expectedVersion), status: value.status as SafetyModerationInput['status'], rationale: value.rationale as SafetyModerationInput['rationale'], requestQuarantine: value.requestQuarantine === true };
}
function reportDTO(db: DatabaseSync, row: ReportRow): SafetyReport {
  const events = (db.prepare('SELECT version,status,rationale,actor,quarantine_requested,at FROM safety_report_events WHERE report_id=? ORDER BY version').all(row.id) as {version:number;status:SafetyEvent['status'];rationale:SafetyEvent['rationale'];actor:SafetyEvent['actor'];quarantine_requested:number;at:string}[]).map(item => ({ version: item.version, status: item.status, rationale: item.rationale, actor: item.actor, quarantineRequested: !!item.quarantine_requested, at: item.at }));
  return { id: row.id, target: JSON.parse(row.target_json) as SafetyTarget, category: row.category, urgency: row.urgency, narrative: row.narrative, status: row.status, rationale: row.rationale, version: row.version, quarantineRequested: !!row.quarantine_requested, createdAt: row.created_at, updatedAt: row.updated_at, events };
}
function operatorDTO(db: DatabaseSync, row: ReportRow): OperatorSafetyReport {
  const report = reportDTO(db,row);
  const audit = db.prepare('SELECT version,actor_id,assigned_operator_id FROM safety_report_events WHERE report_id=? ORDER BY version').all(row.id) as {version:number;actor_id:string|null;assigned_operator_id:string|null}[];
  return {...report, assignedOperatorId:row.assigned_operator_id, events:report.events.map((event,index)=>({...event,actorId:event.actor==='OPERATOR'?audit[index].actor_id:null,assignedOperatorId:audit[index].assigned_operator_id}))};
}
/** Called only by authenticated self-export. Does not create tables or require current personalization consent. */
export function exportOwnerSafetyData(db: DatabaseSync, owner: StudentOwnerId): SafetyExport {
  validateStudentOwner(owner);
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safety_reports'").get()) return { reports: [], reportingLimit: null };
  const reports = (db.prepare(`SELECT ${columns} FROM safety_reports WHERE owner=? ORDER BY created_at DESC,id`).all(owner) as ReportRow[]).map(row => reportDTO(db, row));
  const limit = db.prepare('SELECT window_started_at AS windowStartedAt,count FROM safety_report_limits WHERE owner=?').get(owner) as SafetyExport['reportingLimit'] | undefined;
  return { reports, reportingLimit: limit ? { ...limit } : null };
}
export function exportOwnerSafetyReports(db: DatabaseSync, owner: StudentOwnerId): SafetyReport[] { return exportOwnerSafetyData(db, owner).reports; }

/** Additive schema, initialized after the account schema by runtime or migration. */
export function initializeSafetySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS safety_reports (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      target_json TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN('UNSAFE_CONTACT','HARMFUL_CONTENT','UNSAFE_ACTIVITY','PLATFORM_SAFETY','OTHER')),
      narrative TEXT NOT NULL CHECK(length(narrative)<=500), status TEXT NOT NULL CHECK(status IN('OPEN','IN_REVIEW','RESOLVED','DISMISSED')),
      rationale TEXT, version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 50), quarantine_requested INTEGER NOT NULL DEFAULT 0 CHECK(quarantine_requested IN(0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS safety_reports_owner ON safety_reports(owner,created_at);
    CREATE TABLE IF NOT EXISTS safety_report_events (
      report_id TEXT NOT NULL REFERENCES safety_reports(id) ON DELETE CASCADE, version INTEGER NOT NULL,
      status TEXT NOT NULL, rationale TEXT, actor TEXT NOT NULL CHECK(actor IN('REPORTER','OPERATOR')),
      quarantine_requested INTEGER NOT NULL CHECK(quarantine_requested IN(0,1)), at TEXT NOT NULL, PRIMARY KEY(report_id,version));
    CREATE TABLE IF NOT EXISTS safety_report_limits (
      owner TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, window_started_at TEXT NOT NULL, count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 6));`);
  const addColumn = (table:string,name:string,definition:string) => { if (!(db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).some(column=>column.name===name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`); };
  addColumn('safety_reports','urgency',"TEXT NOT NULL DEFAULT 'ROUTINE' CHECK(urgency IN('ROUTINE','TIME_SENSITIVE','IMMEDIATE_DANGER'))");
  addColumn('safety_reports','assigned_operator_id','TEXT');
  addColumn('safety_report_events','actor_id','TEXT');
  addColumn('safety_report_events','assigned_operator_id','TEXT');
}

/** Profile withdrawal removes reports even when the account itself is retained. */
export function purgeOwnerSafetyData(db: DatabaseSync, owner: StudentOwnerId): void {
  validateStudentOwner(owner);
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='safety_reports'").get()) return;
  db.prepare('DELETE FROM safety_reports WHERE owner=?').run(owner);
  db.prepare('DELETE FROM safety_report_limits WHERE owner=?').run(owner);
}
/** Reports have their own explicit storage purpose and do not require a personalization profile. */
export function createSafetyRepository(filename: string, supply: Pick<StudentSupplyReader, 'getPublicSnapshot'>) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  initializeSafetySchema(db);
  function transaction<T>(action: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const result = action(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  function requireOwner(owner: StudentOwnerId): void {
    validateStudentOwner(owner);
    const account = db.prepare('SELECT role,email_verified_at FROM accounts WHERE id=?').get(owner) as {role:string;email_verified_at:string|null} | undefined;
    if (!account || account.role !== 'STUDENT' || !account.email_verified_at) return fail('ACCOUNT_REQUIRED', 403, 'A verified student account is required to store or read a private safety report.');
  }
  function requireOperator(id:string):void {
    const account = db.prepare('SELECT role,email_verified_at FROM accounts WHERE id=?').get(id) as {role:string;email_verified_at:string|null}|undefined;
    if(!account||account.role!=='OPERATOR'||!account.email_verified_at) return fail('FORBIDDEN',403,'Review and assignment require a current verified operator account.');
  }
  function rowById(id: string): ReportRow { return db.prepare(`SELECT ${columns} FROM safety_reports WHERE id=?`).get(id) as ReportRow | undefined ?? fail('NOT_FOUND', 404, 'This report is unavailable.'); }
  function listOwn(owner: StudentOwnerId): SafetyReport[] { requireOwner(owner); return exportOwnerSafetyReports(db, owner); }
  function create(owner: StudentOwnerId, input: unknown, now = new Date()): SafetyReport {
    const value = createInput(input);
    return transaction(() => {
      requireOwner(owner);
      let target: SafetyTarget = { kind: 'PLATFORM' };
      if (value.target.kind === 'LISTING') {
        const requested = value.target, item = supply.getPublicSnapshot(requested.opportunityId, requested.occurrenceId);
        if (!item || item.id !== requested.opportunityId || (item.occurrenceId ?? 'primary') !== requested.occurrenceId) return fail('NOT_FOUND', 404, 'Choose a listing date that has been published in this local catalogue.');
        target = { kind: 'LISTING', opportunityId: item.id, occurrenceId: requested.occurrenceId, title: item.title, startsAt: item.startsAt, endsAt: item.endsAt, listingVersion: item.version };
      }
      const owned = (db.prepare('SELECT count(*) AS n FROM safety_reports WHERE owner=?').get(owner) as {n:number}).n;
      const total = (db.prepare('SELECT count(*) AS n FROM safety_reports').get() as {n:number}).n;
      if (owned >= MAX_REPORTS_PER_OWNER || total >= MAX_REPORTS) return fail('STORAGE_LIMIT', 409, 'The local report store is full. Export or delete older reports before creating another.');
      const limit = db.prepare('SELECT window_started_at,count FROM safety_report_limits WHERE owner=?').get(owner) as {window_started_at:string;count:number} | undefined;
      const sameWindow = !!limit && now.getTime() - Date.parse(limit.window_started_at) < DAY_MS;
      if (sameWindow && limit.count >= 6) return fail('RATE_LIMITED', 429, 'Up to six local reports may be created in 24 hours. Try again after the reporting window resets. This app is not an emergency service.');
      const at = now.toISOString(), id = randomUUID();
      db.prepare('INSERT INTO safety_report_limits(owner,window_started_at,count) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET window_started_at=excluded.window_started_at,count=excluded.count').run(owner, sameWindow ? limit.window_started_at : at, sameWindow ? limit.count + 1 : 1);
      db.prepare("INSERT INTO safety_reports(id,owner,target_json,category,urgency,narrative,status,rationale,version,quarantine_requested,created_at,updated_at) VALUES(?,?,?,?,?,?,'OPEN',NULL,1,0,?,?)").run(id, owner, JSON.stringify(target), value.category, value.urgency ?? 'ROUTINE', value.narrative ?? '', at, at);
      db.prepare("INSERT INTO safety_report_events(report_id,version,status,rationale,actor,quarantine_requested,at) VALUES(?,1,'OPEN',NULL,'REPORTER',0,?)").run(id, at);
      return reportDTO(db, rowById(id));
    });
  }
  function remove(owner: StudentOwnerId, id: string, input: unknown): void {
    studentResourceId(id); const value = objectInput(input, ['expectedVersion']), expectedVersion = version(value.expectedVersion);
    transaction(() => {
      requireOwner(owner);
      const current = db.prepare('SELECT version FROM safety_reports WHERE owner=? AND id=?').get(owner, id) as {version:number} | undefined;
      if (!current) return fail('NOT_FOUND', 404, 'This report is unavailable.');
      if (current.version !== expectedVersion) return fail('VERSION_CONFLICT', 409, 'This report changed. Refresh its status before deleting it.');
      db.prepare('DELETE FROM safety_reports WHERE owner=? AND id=?').run(owner, id);
    });
  }
  function listQueue(): OperatorSafetyReport[] { return (db.prepare(`SELECT ${columns} FROM safety_reports ORDER BY CASE urgency WHEN 'IMMEDIATE_DANGER' THEN 0 WHEN 'TIME_SENSITIVE' THEN 1 ELSE 2 END,created_at,id LIMIT 3000`).all() as ReportRow[]).map(row => operatorDTO(db, row)); }
  function moderate(id: string, input: unknown, actorId: string, now = new Date()): OperatorSafetyReport {
    studentResourceId(id); const value = moderationInput(input);
    return transaction(() => {
      requireOperator(actorId);
      if(value.assignedOperatorId) requireOperator(value.assignedOperatorId);
      const current = rowById(id), target = JSON.parse(current.target_json) as SafetyTarget;
      if (current.version !== value.expectedVersion) return fail('VERSION_CONFLICT', 409, 'This report changed. Reload it before making a decision.');
      if (current.version >= MAX_REPORT_VERSIONS) return fail('STORAGE_LIMIT', 409, 'This local report has reached its audit history limit.');
      const openReview = current.status === 'OPEN' && value.status === 'IN_REVIEW' && value.rationale === 'REVIEW_STARTED';
      const continueReview = current.status === 'IN_REVIEW' && value.status === 'IN_REVIEW' && ['REVIEW_CONTINUES', 'QUARANTINE_REVIEW'].includes(value.rationale);
      const closeReview = current.status === 'IN_REVIEW' && ((value.status === 'RESOLVED' && value.rationale === 'REVIEW_COMPLETE') || (value.status === 'DISMISSED' && ['DUPLICATE','OUTSIDE_SCOPE','INSUFFICIENT_INFORMATION'].includes(value.rationale)));
      const reopen = ['RESOLVED', 'DISMISSED'].includes(current.status) && value.status === 'OPEN' && value.rationale === 'REOPENED';
      const assignmentOnly = value.rationale === 'ASSIGNMENT_UPDATED' && value.status === current.status && value.assignedOperatorId !== undefined && value.assignedOperatorId !== current.assigned_operator_id;
      if (!openReview && !continueReview && !closeReview && !reopen && !assignmentOnly) return fail('STATE_CONFLICT', 409, 'Start a review before recording its outcome. Choose a reason that matches the next status.');
      if (!!value.requestQuarantine !== (value.rationale === 'QUARANTINE_REVIEW') || (value.requestQuarantine && (current.status !== 'IN_REVIEW' || target.kind !== 'LISTING' || !!current.quarantine_requested))) return fail('STATE_CONFLICT', 409, 'A listing withdrawal can be requested once, after its report enters review.');
      const assigned = value.assignedOperatorId !== undefined ? value.assignedOperatorId : openReview ? actorId : current.assigned_operator_id;
      const quarantine = Number(!!current.quarantine_requested || !!value.requestQuarantine), nextVersion = current.version + 1, at = now.toISOString();
      db.prepare('UPDATE safety_reports SET status=?,rationale=?,version=?,quarantine_requested=?,updated_at=?,assigned_operator_id=? WHERE id=?').run(value.status, value.rationale, nextVersion, quarantine, at, assigned, id);
      db.prepare("INSERT INTO safety_report_events(report_id,version,status,rationale,actor,quarantine_requested,at,actor_id,assigned_operator_id) VALUES(?,?,?,?,'OPERATOR',?,?,?,?)").run(id, nextVersion, value.status, value.rationale, quarantine, at, actorId, assigned);
      return operatorDTO(db, rowById(id));
    });
  }
  return { listOwn, create, remove, listQueue, moderate, close: () => db.close() };
}
export type SafetyRepository = ReturnType<typeof createSafetyRepository>;
