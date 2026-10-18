import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AccountId } from '../../../packages/domain/identity-contracts.ts';
import { YOUTH_POLICY_VERSION, type AccountAgeBand, type YouthAccessState, type YouthExport, type YouthReviewRequest, type YouthReviewRoute, type YouthReviewStatus } from '../../../packages/domain/youth-contracts.ts';
import { RepositoryError } from './errors.ts';
import { objectInput } from './http.ts';

type AgeRow = { age_band: AccountAgeBand; synthetic: number; attested_at: string };
type ReviewRow = { id: string; account_id: AccountId; reviewer_id: AccountId | null; route: YouthReviewRoute; policy_version: string; status: YouthReviewStatus; version: number; created_at: string; updated_at: string };
const fail = (code: string, status: number, message: string): never => { throw new RepositoryError(code, status, message); };
const tableExists = (db: DatabaseSync, name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
export function initializeYouthSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_age (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      age_band TEXT NOT NULL CHECK(age_band IN ('ADULT','TEEN_13_17')),
      synthetic INTEGER NOT NULL CHECK(synthetic IN (0,1)), attested_at TEXT NOT NULL,
      CHECK(age_band='ADULT' OR synthetic=1)
    );
    CREATE TABLE IF NOT EXISTS youth_review_requests (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      reviewer_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      route TEXT NOT NULL CHECK(route IN ('GUARDIAN','SCHOOL')), policy_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
      version INTEGER NOT NULL CHECK(version>0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      CHECK(reviewer_id IS NULL OR reviewer_id<>account_id)
    );
    CREATE INDEX IF NOT EXISTS youth_review_owner ON youth_review_requests(account_id,created_at);
    CREATE INDEX IF NOT EXISTS youth_review_reviewer ON youth_review_requests(reviewer_id,created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS youth_review_active_owner ON youth_review_requests(account_id) WHERE status IN ('PENDING','APPROVED');
    CREATE TABLE IF NOT EXISTS youth_review_events (
      request_id TEXT NOT NULL REFERENCES youth_review_requests(id) ON DELETE CASCADE,
      version INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
      actor TEXT NOT NULL CHECK(actor IN ('OWNER','REVIEWER','ASSIGNMENT')), at TEXT NOT NULL,
      PRIMARY KEY(request_id,version)
    );
  `);
}
export function readAccountAge(db: DatabaseSync, id: string): { ageBand: AccountAgeBand; synthetic: boolean; attestedAt: string | null } {
  const row = tableExists(db, 'account_age') ? db.prepare('SELECT age_band,synthetic,attested_at FROM account_age WHERE account_id=?').get(id) as AgeRow | undefined : undefined;
  // Existing adults predate this additive table; their adult attestation remains authoritative.
  return { ageBand: row?.age_band ?? 'ADULT', synthetic: !!row?.synthetic, attestedAt: row?.attested_at ?? null };
}
function validReviewer(db: DatabaseSync, id: string | null): boolean {
  if (!id) return false;
  const row = db.prepare('SELECT email_verified_at,adult_attested_at,email_norm FROM accounts WHERE id=?').get(id) as { email_verified_at: string | null; adult_attested_at: string | null; email_norm: string } | undefined;
  return !!row?.email_verified_at && !!row.adult_attested_at && row.email_norm.endsWith('.invalid') && readAccountAge(db, id).ageBand === 'ADULT';
}
function reviewDTO(row: ReviewRow): YouthReviewRequest {
  return { id: row.id, route: row.route, policyVersion: YOUTH_POLICY_VERSION, status: row.status, version: row.version, synthetic: true, createdAt: row.created_at, updatedAt: row.updated_at };
}
export function readYouthAccess(db: DatabaseSync, accountId: string): YouthAccessState {
  const age = readAccountAge(db, accountId);
  const row = tableExists(db, 'youth_review_requests') ? db.prepare('SELECT * FROM youth_review_requests WHERE account_id=? ORDER BY rowid DESC LIMIT 1').get(accountId) as ReviewRow | undefined : undefined;
  const localOnly = tableExists(db, 'account_meta') && !!db.prepare("SELECT 1 FROM account_meta WHERE key='youth-workflow' AND value='synthetic-test-only'").get();
  const approved = age.synthetic && localOnly && row?.status === 'APPROVED' && row.policy_version === YOUTH_POLICY_VERSION && validReviewer(db, row.reviewer_id);
  return { ageBand: age.ageBand, synthetic: age.synthetic, admission: age.ageBand === 'ADULT' || approved ? 'ADMITTED' : 'REVIEW_REQUIRED', policyVersion: YOUTH_POLICY_VERSION, request: row ? reviewDTO(row) : null };
}

/** Local synthetic review exercise only. Authority is assigned offline, never from a client claim. */
export function createYouthStore(db: DatabaseSync, enabled: boolean) {
  initializeYouthSchema(db);
  if (enabled) db.prepare("INSERT OR IGNORE INTO account_meta(key,value) VALUES('youth-workflow','synthetic-test-only')").run();
  function requireEnabled() { if (!enabled) fail('YOUTH_WORKFLOW_DISABLED', 403, 'Teen review is available only in the explicitly enabled synthetic local test workflow.'); }
  function transaction<T>(work: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function requireTeen(id: AccountId) {
    requireEnabled();
    const age = readAccountAge(db, id);
    const row = db.prepare('SELECT role,email_verified_at,email_norm FROM accounts WHERE id=?').get(id) as { role: string; email_verified_at: string | null; email_norm: string } | undefined;
    if (!row || row.role !== 'STUDENT' || !row.email_verified_at || !row.email_norm.endsWith('.invalid') || age.ageBand !== 'TEEN_13_17' || !age.synthetic) fail('TEEN_ACCOUNT_REQUIRED', 403, 'A verified synthetic teen account is required.');
  }
  function ownedRequest(id: string, owner: AccountId, reviewer = false): ReviewRow {
    const row = db.prepare(`SELECT * FROM youth_review_requests WHERE id=? AND ${reviewer ? 'reviewer_id' : 'account_id'}=?`).get(id, owner) as ReviewRow | undefined;
    if (!row) return fail('REVIEW_NOT_FOUND', 404, 'The review request is not available.');
    return row;
  }
  function expected(row: ReviewRow, version: unknown) {
    if (!Number.isSafeInteger(version) || Number(version) < 1) fail('INVALID_INPUT', 422, 'Provide the current review version.');
    if (row.version !== version) fail('VERSION_CONFLICT', 409, 'This review changed. Reload it before continuing.');
  }
  function log(row: ReviewRow, actor: 'OWNER' | 'REVIEWER' | 'ASSIGNMENT', now: Date) {
    db.prepare('INSERT INTO youth_review_events(request_id,version,status,actor,at) VALUES(?,?,?,?,?)').run(row.id, row.version, row.status, actor, now.toISOString());
  }
  function update(row: ReviewRow, status: YouthReviewStatus, actor: 'OWNER' | 'REVIEWER' | 'ASSIGNMENT', now: Date): YouthReviewRequest {
    const changed = { ...row, status, version: row.version + 1, updated_at: now.toISOString() };
    db.prepare('UPDATE youth_review_requests SET status=?,version=?,updated_at=? WHERE id=?').run(status, changed.version, changed.updated_at, row.id);
    log(changed, actor, now); return reviewDTO(changed);
  }
  function request(owner: AccountId, input: unknown, now = new Date()): YouthReviewRequest {
    requireEnabled();
    const value = objectInput(input, ['route', 'policyVersion']);
    if (value.route !== 'GUARDIAN' && value.route !== 'SCHOOL') return fail('INVALID_INPUT', 422, 'Choose guardian or school review.');
    if (value.policyVersion !== YOUTH_POLICY_VERSION) return fail('YOUTH_POLICY_REQUIRED', 422, 'Review the current synthetic teen notice.');
    return transaction(() => {
      requireTeen(owner);
      if (db.prepare("SELECT 1 FROM youth_review_requests WHERE account_id=? AND status IN ('PENDING','APPROVED')").get(owner)) return fail('REVIEW_STATE_CONFLICT', 409, 'Withdraw the current request before choosing a new review route.');
      if ((db.prepare('SELECT COUNT(*) AS n FROM youth_review_requests WHERE account_id=?').get(owner) as { n: number }).n >= 12) return fail('REVIEW_LIMIT', 429, 'The synthetic account has reached its review request limit.');
      const row: ReviewRow = { id: `review-${randomUUID()}`, account_id: owner, reviewer_id: null, route: value.route as YouthReviewRoute, policy_version: YOUTH_POLICY_VERSION, status: 'PENDING', version: 1, created_at: now.toISOString(), updated_at: now.toISOString() };
      db.prepare('INSERT INTO youth_review_requests(id,account_id,route,policy_version,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(row.id, owner, row.route, row.policy_version, row.status, 1, row.created_at, row.updated_at);
      log(row, 'OWNER', now); return reviewDTO(row);
    });
  }
  function withdraw(owner: AccountId, id: string, input: unknown, now = new Date()): YouthReviewRequest {
    requireEnabled(); const value = objectInput(input, ['expectedVersion', 'action']);
    if (value.action !== 'WITHDRAW') return fail('INVALID_INPUT', 422, 'Choose withdrawal for your review request.');
    return transaction(() => { const row = ownedRequest(id, owner); requireTeen(owner); expected(row, value.expectedVersion); if (!['PENDING', 'APPROVED'].includes(row.status)) return fail('REVIEW_STATE_CONFLICT', 409, 'This review is already closed.'); return update(row, 'WITHDRAWN', 'OWNER', now); });
  }
  function reviews(reviewer: AccountId): YouthReviewRequest[] {
    requireEnabled();
    // Unassigned adult accounts receive an empty inbox, never a searchable directory.
    if (!validReviewer(db, reviewer)) return [];
    return (db.prepare('SELECT * FROM youth_review_requests WHERE reviewer_id=? ORDER BY rowid DESC').all(reviewer) as ReviewRow[]).map(reviewDTO);
  }
  function decide(reviewer: AccountId, id: string, input: unknown, now = new Date()): YouthReviewRequest {
    requireEnabled(); const value = objectInput(input, ['expectedVersion', 'decision', 'policyVersion']);
    return transaction(() => {
      if (!validReviewer(db, reviewer)) return fail('REVIEW_NOT_FOUND', 404, 'The review request is not available.');
      const row = ownedRequest(id, reviewer, true); expected(row, value.expectedVersion);
      if (value.policyVersion !== YOUTH_POLICY_VERSION || row.policy_version !== YOUTH_POLICY_VERSION) return fail('YOUTH_POLICY_REQUIRED', 422, 'Review the current synthetic teen notice.');
      const decision = value.decision;
      if ((row.status === 'PENDING' && decision !== 'APPROVED' && decision !== 'REJECTED') || (row.status === 'APPROVED' && decision !== 'WITHDRAWN') || !['PENDING', 'APPROVED'].includes(row.status)) return fail('REVIEW_STATE_CONFLICT', 409, 'This decision is not available for the current review state.');
      requireTeen(row.account_id);
      return update(row, decision as YouthReviewStatus, 'REVIEWER', now);
    });
  }
  /** Offline synthetic fixture provisioning only; deliberately absent from every HTTP handler. */
  function assignReviewer(id: string, reviewer: AccountId, now = new Date()): YouthReviewRequest {
    requireEnabled();
    return transaction(() => {
      const row = db.prepare('SELECT * FROM youth_review_requests WHERE id=?').get(id) as ReviewRow | undefined;
      if (!row) return fail('REVIEW_NOT_FOUND', 404, 'The review request is not available.');
      if (row.account_id === reviewer || !validReviewer(db, reviewer)) return fail('REVIEWER_REQUIRED', 422, 'Assign an existing verified adult account with a reserved synthetic email address.');
      requireTeen(row.account_id);
      if (row.status !== 'PENDING' || row.reviewer_id) return fail('REVIEW_STATE_CONFLICT', 409, 'Only an unassigned pending request can be assigned.');
      db.prepare('UPDATE youth_review_requests SET reviewer_id=? WHERE id=?').run(reviewer, id);
      return update(row, 'PENDING', 'ASSIGNMENT', now);
    });
  }
  function exportData(owner: AccountId): YouthExport {
    const owned = db.prepare('SELECT * FROM youth_review_requests WHERE account_id=? ORDER BY rowid').all(owner) as ReviewRow[];
    const assigned = db.prepare('SELECT * FROM youth_review_requests WHERE reviewer_id=? ORDER BY rowid').all(owner) as ReviewRow[];
    const events = db.prepare('SELECT e.request_id AS requestId,e.version,e.status,e.actor,e.at FROM youth_review_events e JOIN youth_review_requests r ON r.id=e.request_id WHERE r.account_id=? OR r.reviewer_id=? ORDER BY e.at,e.rowid').all(owner, owner) as YouthExport['events'];
    return { access: readYouthAccess(db, owner), ownedRequests: owned.map(reviewDTO), assignedReviews: assigned.map(reviewDTO), events };
  }
  return { access: (owner: AccountId) => readYouthAccess(db, owner), request, withdraw, reviews, decide, assignReviewer, exportData, requireEnabled };
}
