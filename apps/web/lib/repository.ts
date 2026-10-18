import { createCommunityStore } from './community-repository.ts';
import { sourcePermissionIssue, sourceDuplicateIssue } from './source-control-repository.ts';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AdminOpportunity, FixtureOption, FixtureRecord, OpportunityOccurrence, Preferences, PublicOpportunity, ReviewInput } from '../../../packages/domain/contracts.ts';
import type { AdminCatalogueRecord, CatalogueActionInput, CatalogueAudit, CatalogueRevision, CommunityPage, CommunityUpdate, EditOpportunityInput, EffectiveOpportunityStatus, ExceptionInput, ImportRun, MatchingQaCase, OperatorException, OperatorOverview, OrganizationSummary, PublicQuery, SourceHealth, SourceUpdate } from '../../../packages/domain/app-contracts.ts';
import { parseFixture, publicationIssues, isCurrent, evaluateEligibility, occurrenceList, currentOccurrences } from '../../../packages/domain/rules.ts';
import { RepositoryError } from './errors.ts';
export { RepositoryError } from './errors.ts';

type Row = { id: string; source_id: string; external_id: string; version: number; status: AdminOpportunity['status']; record_json: string; content_hash: string; created_at: string; updated_at: string };
type ReviewRow = { decision: 'PUBLISH' | 'REJECT'; reason: string; at: string; version: number };
type SourceControl = { paused: number; version: number };
type ExceptionRow = { assigned_to:string|null; id: string; opportunity_id: string | null; source_id: string | null; title: string; kind: OperatorException['kind']; status: OperatorException['status']; reason: string; updated_at: string };
const EDIT_FIELDS = ['title', 'summary', 'category', 'interests', 'minAge', 'maxAge', 'startsAt', 'endsAt', 'timezone', 'mode', 'area', 'fee', 'requiresTraining', 'requiresGuardian', 'schoolCreditApproved', 'validUntil', 'isCancelled', 'occurrences'];
const REQUIREMENT_FIELDS = ['minAge', 'maxAge', 'startsAt', 'endsAt', 'timezone', 'mode', 'area', 'fee', 'requiresTraining', 'requiresGuardian', 'schoolCreditApproved', 'validUntil', 'isCancelled', 'occurrences'];

function reason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) throw new RepositoryError('INVALID_REASON', 422, 'Provide a reason of 1–1000 characters.');
  return value.trim();
}
function expectedVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new RepositoryError('INVALID_VERSION', 422, 'Provide the current record version.');
  return value;
}
function dateBoundary(value: string | undefined, end: boolean): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 40) throw new RepositoryError('INVALID_QUERY', 400, 'Use a calendar date or ISO datetime for date filters.');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const valid = day || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  const parsed = Date.parse(day ? `${value}T00:00:00Z` : value);
  const calendar = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  if (!valid || !Number.isFinite(parsed) || !Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== value.slice(0, 10) || (!day && (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59))) throw new RepositoryError('INVALID_QUERY', 400, 'Use a real calendar date or ISO datetime for date filters.');
  return parsed + (day && end ? 86_400_000 - 1 : 0);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

function requireRetainedOccurrenceIds(original: FixtureRecord, proposed: FixtureRecord): void {
  const retained = new Set(occurrenceList(proposed).map(item => item.id));
  if (occurrenceList(original).some(item => !retained.has(item.id))) {
    throw new RepositoryError('INVALID_OCCURRENCE_TRANSITION', 422, 'Keep every existing date ID. Cancel a date instead of removing or renaming it.');
  }
}

/** Public allowlist: adding fields to stored records never silently exposes them. */
function publicDTO(row: Row, record: FixtureRecord, selected = occurrenceList(record).find(item => item.id === 'primary')!, dates = [selected]): PublicOpportunity {
  return {
    id: row.id, version: row.version, occurrenceId: selected.id, occurrences: dates.map(item => ({ ...item })), isSynthetic: true, title: record.title, summary: record.summary,
    category: record.category, interests: [...record.interests],
    organization: { id: record.organization.id, name: record.organization.name, url: record.organization.url },
    source: { name: record.source.name, url: record.source.url }, minAge: record.minAge, maxAge: record.maxAge,
    startsAt: selected.startsAt, endsAt: selected.endsAt, timezone: selected.timezone, mode: record.mode, area: record.area,
    fee: record.fee, requiresTraining: record.requiresTraining, requiresGuardian: record.requiresGuardian,
    schoolCreditApproved: record.schoolCreditApproved, signupUrl: record.signupUrl, fetchedAt: record.fetchedAt,
    confirmedAt: record.confirmedAt, validUntil: selected.validUntil,
    evidence: record.evidence.map(({ field, excerpt, sourceUrl }) => ({ field, excerpt, sourceUrl }))
  };
}

export function createRepository(filename: string, options: { seedExamples?: boolean; requireSourcePermission?:boolean } = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, record_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, record_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
      organization_id TEXT NOT NULL REFERENCES organizations(id), external_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version > 0),
      status TEXT NOT NULL CHECK(status IN ('DRAFT','PUBLISHED','REJECTED')),
      record_json TEXT NOT NULL, content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(source_id, external_id)
    );
    CREATE TABLE IF NOT EXISTS import_runs (
      id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
      source_id TEXT NOT NULL REFERENCES sources(id), content_hash TEXT NOT NULL,
      result TEXT NOT NULL CHECK(result IN ('CREATED','UNCHANGED','CHANGED')), at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS review_events (
      id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
      decision TEXT NOT NULL CHECK(decision IN ('PUBLISH','REJECT')), reason TEXT NOT NULL,
      at TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0), UNIQUE(opportunity_id, version)
    );
    CREATE TRIGGER IF NOT EXISTS reviews_no_update BEFORE UPDATE ON review_events BEGIN SELECT RAISE(ABORT,'Review audit is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS reviews_no_delete BEFORE DELETE ON review_events BEGIN SELECT RAISE(ABORT,'Review audit is append-only'); END;
    CREATE INDEX IF NOT EXISTS opportunities_status ON opportunities(status);
    CREATE INDEX IF NOT EXISTS reviews_opportunity ON review_events(opportunity_id, at);
    CREATE TABLE IF NOT EXISTS catalogue_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS import_run_details (run_id TEXT PRIMARY KEY REFERENCES import_runs(id), title TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS opportunity_controls (opportunity_id TEXT PRIMARY KEY REFERENCES opportunities(id), withdrawn INTEGER NOT NULL DEFAULT 0 CHECK(withdrawn IN(0,1)));
    CREATE TABLE IF NOT EXISTS source_controls (source_id TEXT PRIMARY KEY REFERENCES sources(id), paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN(0,1)), version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, reason TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS source_events (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), paused INTEGER NOT NULL, version INTEGER NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS catalogue_audit (id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES opportunities(id), action TEXT NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL, version INTEGER NOT NULL, changes_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS catalogue_revisions (opportunity_id TEXT NOT NULL REFERENCES opportunities(id), version INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN('IMPORT','EDIT')), at TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL, PRIMARY KEY(opportunity_id,version));
    CREATE TABLE IF NOT EXISTS published_snapshots (opportunity_id TEXT PRIMARY KEY REFERENCES opportunities(id), snapshot_json TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS published_occurrence_snapshots (opportunity_id TEXT NOT NULL REFERENCES opportunities(id), occurrence_id TEXT NOT NULL, version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(opportunity_id,occurrence_id,version));
    CREATE TABLE IF NOT EXISTS exception_states (id TEXT PRIMARY KEY, opportunity_id TEXT, source_id TEXT, title TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS exception_events (id TEXT PRIMARY KEY, exception_id TEXT NOT NULL REFERENCES exception_states(id), action TEXT NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS community_pages (slug TEXT PRIMARY KEY, published INTEGER NOT NULL DEFAULT 1 CHECK(published IN(0,1)), version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS community_events (id TEXT PRIMARY KEY, slug TEXT NOT NULL REFERENCES community_pages(slug), published INTEGER NOT NULL, version INTEGER NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL);

    INSERT OR IGNORE INTO source_controls(source_id,paused,version,updated_at,reason) SELECT id,0,1,'1970-01-01T00:00:00.000Z','Additive local migration' FROM sources;
    INSERT OR IGNORE INTO opportunity_controls(opportunity_id,withdrawn) SELECT id,0 FROM opportunities;
  `);
  for(const table of ['import_runs','review_events','catalogue_audit','source_events','exception_events','community_events']) {
    if(!(db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).some(column=>column.name==='actor')) db.exec(`ALTER TABLE ${table} ADD COLUMN actor TEXT NOT NULL DEFAULT 'LEGACY_UNATTRIBUTED'`);
  }
  if(!(db.prepare('PRAGMA table_info(exception_states)').all() as {name:string}[]).some(column=>column.name==='assigned_to')) db.exec("ALTER TABLE exception_states ADD COLUMN assigned_to TEXT");
  if (options.seedExamples !== false) db.exec("INSERT OR IGNORE INTO community_pages(slug,published,version) VALUES('demo-neighborhood',1,1)");
  for (const table of ['import_runs', 'import_run_details', 'source_events', 'catalogue_audit', 'catalogue_revisions', 'published_occurrence_snapshots', 'exception_events', 'community_events']) {
    // Table names are a fixed internal allowlist, never request input.
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Audit history is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Audit history is append-only'); END;`);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    // Backfill only previously published public fields; preserve every legacy source/review row.
    for (const row of db.prepare("SELECT * FROM opportunities WHERE status='PUBLISHED' AND id NOT IN (SELECT opportunity_id FROM published_snapshots)").all() as Row[]) {
      db.prepare('INSERT OR IGNORE INTO published_snapshots(opportunity_id,snapshot_json,at) VALUES(?,?,?)').run(row.id, JSON.stringify(publicDTO(row, JSON.parse(row.record_json))), row.updated_at);
    }
    // Additive migration: old single-date public snapshots become stable primary rows.
    // Never rewrite a private student snapshot or an existing historical version.
    for (const row of db.prepare('SELECT opportunity_id,snapshot_json,at FROM published_snapshots').all() as { opportunity_id: string; snapshot_json: string; at: string }[]) {
      const prior = JSON.parse(row.snapshot_json) as PublicOpportunity;
      for (const date of occurrenceList(prior)) {
        const value: PublicOpportunity = { ...prior, occurrenceId: date.id, occurrences: [{ ...date }], startsAt: date.startsAt, endsAt: date.endsAt, timezone: date.timezone, validUntil: date.validUntil };
        db.prepare('INSERT OR IGNORE INTO published_occurrence_snapshots(opportunity_id,occurrence_id,version,snapshot_json,at) VALUES(?,?,?,?,?)').run(row.opportunity_id, date.id, prior.version, JSON.stringify(value), row.at);
      }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  let closed = false;
  let transactionDepth = 0;
  function transaction<T>(fn: () => T): T {
    if (transactionDepth) return fn();
    db.exec('BEGIN IMMEDIATE');
    transactionDepth++;
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { transactionDepth--; }
  }
  function rowFor(id: string): Row | undefined {
    return db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as Row | undefined;
  }
  function sourceControl(id: string): SourceControl { return (db.prepare('SELECT paused,version FROM source_controls WHERE source_id=?').get(id) as SourceControl | undefined) ?? { paused: 0, version: 1 }; }
  function withdrawn(id: string): boolean { return !!(db.prepare('SELECT withdrawn FROM opportunity_controls WHERE opportunity_id=?').get(id) as { withdrawn: number } | undefined)?.withdrawn; }
  function effectiveRecord(row: Row): FixtureRecord {
    const record = JSON.parse(row.record_json) as FixtureRecord;
    const source = db.prepare('SELECT record_json FROM sources WHERE id=?').get(row.source_id) as { record_json: string } | undefined;
    if (source) record.source = JSON.parse(source.record_json);
    return record;
  }
  function permissionIssue(sourceId:string,now:Date,record?:FixtureRecord){return sourcePermissionIssue(db,sourceId,now,{required:options.requireSourcePermission===true,record});}
  function effectiveStatus(row: Row, record: FixtureRecord, now: Date): EffectiveOpportunityStatus {
    if(sourceDuplicateIssue(db,row.id))return 'DUPLICATE_ALIAS';
    if(permissionIssue(row.source_id,now,record))return 'SOURCE_REVIEW_REQUIRED';
    if (withdrawn(row.id)) return 'WITHDRAWN';
    if (sourceControl(row.source_id).paused) return 'SOURCE_PAUSED';
    if (record.isCancelled || occurrenceList(record).every(item => item.isCancelled)) return 'CANCELLED';
    if (currentOccurrences(record, now).length === 0) return 'EXPIRED';
    return row.status;
  }
  function audit(id: string, action: CatalogueAudit['action'], note: string, at: string, version: number, changes: string[] = [], actor = 'LOCAL_SYSTEM') {
    db.prepare('INSERT INTO catalogue_audit(id,opportunity_id,action,reason,at,version,changes_json,actor) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), id, action, note, at, version, JSON.stringify(changes), actor);
  }
  function revision(id: string, version: number, action: CatalogueRevision['action'], at: string, before: FixtureRecord | null, after: FixtureRecord) {
    db.prepare('INSERT INTO catalogue_revisions(opportunity_id,version,action,at,before_json,after_json) VALUES(?,?,?,?,?,?)').run(id, version, action, at, before === null ? null : canonical(before), canonical(after));
  }
  function currentRow(id: string, version: number): Row {
    const row = rowFor(id);
    if (!row) throw new RepositoryError('NOT_FOUND', 404, 'Opportunity not found.');
    if (row.version !== expectedVersion(version)) throw new RepositoryError('VERSION_CONFLICT', 409, 'This record has changed. Reload before deciding.');
    return row;
  }
  function adminDTO(row: Row, now = new Date()): AdminCatalogueRecord {
    const record = effectiveRecord(row);
    const issues = publicationIssues(record, now);
    const permission=permissionIssue(row.source_id,now,record),duplicate=sourceDuplicateIssue(db,row.id);
    if(permission)issues.push(permission);if(duplicate)issues.push(duplicate);
    if (sourceControl(row.source_id).paused) issues.push('The source is paused. Resume it before publication.');
    if (withdrawn(row.id)) issues.push('This listing is withdrawn. Restore it to the review queue first.');
    const events = db.prepare('SELECT action,reason,at,version,changes_json,actor FROM catalogue_audit WHERE opportunity_id=? ORDER BY rowid').all(row.id) as { action: CatalogueAudit['action']; reason: string; at: string; version: number; changes_json: string; actor:string }[];
    const revisions = db.prepare('SELECT version,action,at,before_json,after_json FROM catalogue_revisions WHERE opportunity_id=? ORDER BY version').all(row.id) as { version: number; action: CatalogueRevision['action']; at: string; before_json: string | null; after_json: string }[];
    return { id: row.id, version: row.version, status: row.status, record,
      issues, createdAt: row.created_at, updatedAt: row.updated_at, effectiveStatus: effectiveStatus(row, record, now), withdrawn: withdrawn(row.id),
      auditEvents: events.map(({ changes_json, ...event }) => ({ ...event, changes: JSON.parse(changes_json) as string[] })),
      revisions: revisions.map(({ before_json, after_json, ...entry }) => ({ ...entry, before: before_json === null ? null : JSON.parse(before_json) as FixtureRecord, after: JSON.parse(after_json) as FixtureRecord })),
      reviewEvents: db.prepare('SELECT decision, reason, at, version, actor FROM review_events WHERE opportunity_id = ? ORDER BY version').all(row.id) as ReviewRow[] };
  }
  function available(row: Row, now: Date, occurrenceId?: string): PublicOpportunity | null {
    const record = effectiveRecord(row);
    if (row.status !== 'PUBLISHED' || withdrawn(row.id) || sourceControl(row.source_id).paused || permissionIssue(row.source_id,now,record) || sourceDuplicateIssue(db,row.id)) return null;
    if (!isCurrent(record, now) || publicationIssues(record, now).length > 0) return null;
    const dates = currentOccurrences(record, now);
    const selected = occurrenceId === undefined ? dates[0] : dates.find(item => item.id === occurrenceId);
    return selected ? publicDTO(row, record, selected, dates) : null;
  }
  function snapshot(id: string, occurrenceId = 'primary'): PublicOpportunity | null {
    const value = db.prepare('SELECT snapshot_json FROM published_occurrence_snapshots WHERE opportunity_id=? AND occurrence_id=? ORDER BY version DESC LIMIT 1').get(id, occurrenceId) as { snapshot_json: string } | undefined;
    return value ? JSON.parse(value.snapshot_json) as PublicOpportunity : null;
  }
  function liveExceptions(now: Date): Map<string, Omit<OperatorException, 'status' | 'reason' | 'updatedAt' | 'canResolve' | 'decisions'>> {
    const live = new Map<string, Omit<OperatorException, 'status' | 'reason' | 'updatedAt' | 'canResolve' | 'decisions'>>();
    for (const row of db.prepare('SELECT s.id,s.record_json FROM sources s JOIN source_controls c ON c.source_id=s.id WHERE c.paused=1').all() as { id: string; record_json: string }[]) {
      const source = JSON.parse(row.record_json) as FixtureRecord['source'];
      const id = `source:${row.id}:paused`;
      live.set(id, { id, opportunityId: null, sourceId: row.id, title: `${source.name}: source paused`, kind: 'SOURCE_PAUSED', owner: 'Local operator' });
    }
    for (const row of db.prepare("SELECT * FROM opportunities WHERE status!='REJECTED'").all() as Row[]) {
      if (withdrawn(row.id)) continue;
      const record = effectiveRecord(row);
      let kind: OperatorException['kind'] | null = null;
      if(permissionIssue(row.source_id,now,record))kind='SOURCE_PERMISSION';
      else if(sourceDuplicateIssue(db,row.id))kind='DUPLICATE_ALIAS';
      else if (record.isCancelled || occurrenceList(record).every(item => item.isCancelled)) kind = 'CANCELLED';
      else if (currentOccurrences(record, now).length === 0) kind = 'EXPIRED';
      else if (publicationIssues(record, now).length) kind = 'MISSING_FACTS';
      if (kind) {
        const id = `opportunity:${row.id}:${kind.toLowerCase()}`;
        live.set(id, { id, opportunityId: row.id, sourceId: row.source_id, title: record.title, kind, owner: 'Local operator' });
      }
    }
    return live;
  }
  function exceptions(now: Date): OperatorException[] {
    const live = liveExceptions(now);
    return transaction(() => {
      for (const item of live.values()) {
        db.prepare("INSERT OR IGNORE INTO exception_states(id,opportunity_id,source_id,title,kind,status,reason,updated_at) VALUES(?,?,?,?,?,'OPEN','',?)").run(item.id, item.opportunityId, item.sourceId, item.title, item.kind, now.toISOString());
        const existing = db.prepare('SELECT status FROM exception_states WHERE id=?').get(item.id) as { status: string };
        if (existing.status === 'RESOLVED') {
          db.prepare("UPDATE exception_states SET status='OPEN',reason='Underlying condition recurred.',updated_at=? WHERE id=?").run(now.toISOString(), item.id);
          db.prepare('INSERT INTO exception_events(id,exception_id,action,reason,at,actor) VALUES(?,?,?,?,?,?)').run(randomUUID(), item.id, 'REOPEN', 'Underlying condition recurred.', now.toISOString(), 'LOCAL_SYSTEM');
        }
        db.prepare('UPDATE exception_states SET title=? WHERE id=?').run(item.title, item.id);
      }
      return (db.prepare('SELECT * FROM exception_states ORDER BY updated_at DESC,id').all() as ExceptionRow[]).map(row => ({ id: row.id, opportunityId: row.opportunity_id, sourceId: row.source_id, title: row.title, kind: row.kind, status: row.status, owner: row.assigned_to ?? 'Unassigned', reason: row.reason, updatedAt: row.updated_at, canResolve: !live.has(row.id), decisions: (db.prepare('SELECT action,reason,at,actor FROM exception_events WHERE exception_id=? ORDER BY rowid').all(row.id) as OperatorException['decisions']).map(decision => ({ ...decision })) }));
    });
  }
  const repository = {
    importRecord(input: FixtureRecord, now = new Date(), actor = 'LOCAL_SYSTEM') {
      let record: FixtureRecord;
      try { record = parseFixture(input); }
      catch { throw new RepositoryError('INVALID_FIXTURE', 422, 'The synthetic record does not satisfy the import contract.'); }
      const serialized = canonical(record);
      const hash = createHash('sha256').update(serialized).digest('hex');
      return transaction(() => {
        const permission=permissionIssue(record.source.id,now,record);if(permission)throw new RepositoryError('SOURCE_PERMISSION_REQUIRED',409,permission);
        if (sourceControl(record.source.id).paused) throw new RepositoryError('SOURCE_PAUSED', 409, 'Resume this synthetic source before importing.');
        const existing = db.prepare('SELECT * FROM opportunities WHERE source_id = ? AND external_id = ?').get(record.source.id, record.externalId) as Row | undefined;
        if (existing && existing.content_hash !== hash) requireRetainedOccurrenceIds(JSON.parse(existing.record_json) as FixtureRecord, record);
        db.prepare('INSERT INTO sources(id,record_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json').run(record.source.id, JSON.stringify(record.source));
        db.prepare('INSERT OR IGNORE INTO source_controls(source_id,paused,version,updated_at,reason) VALUES(?,0,1,?,?)').run(record.source.id, now.toISOString(), 'Synthetic source first import');
        db.prepare('INSERT INTO organizations(id,record_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json').run(record.organization.id, JSON.stringify(record.organization));
        const id = existing?.id ?? randomUUID();
        const at = now.toISOString();
        const outcome = !existing ? 'CREATED' : existing.content_hash === hash ? 'UNCHANGED' : 'CHANGED';
        if (!existing) db.prepare('INSERT INTO opportunities(id,source_id,organization_id,external_id,version,status,record_json,content_hash,created_at,updated_at) VALUES(?,?,?,?,1,\'DRAFT\',?,?,?,?)').run(id, record.source.id, record.organization.id, record.externalId, serialized, hash, at, at);
        else if (outcome === 'CHANGED') db.prepare('UPDATE opportunities SET organization_id=?, version=version+1, status=\'DRAFT\', record_json=?, content_hash=?, updated_at=? WHERE id=?').run(record.organization.id, serialized, hash, at, id);
        db.prepare('INSERT OR IGNORE INTO opportunity_controls(opportunity_id,withdrawn) VALUES(?,0)').run(id);
        const runId = randomUUID();
        db.prepare('INSERT INTO import_runs(id,opportunity_id,source_id,content_hash,result,at,actor) VALUES(?,?,?,?,?,?,?)').run(runId, id, record.source.id, hash, outcome, at, actor);
        db.prepare('INSERT INTO import_run_details(run_id,title) VALUES(?,?)').run(runId, record.title);
        if (outcome !== 'UNCHANGED') revision(id, rowFor(id)!.version, 'IMPORT', at, existing ? JSON.parse(existing.record_json) as FixtureRecord : null, record);
        const changes = existing ? Object.keys(record).filter(key => canonical((JSON.parse(existing.record_json) as Record<string, unknown>)[key]) !== canonical((record as unknown as Record<string, unknown>)[key])) : ['initial synthetic import'];
        audit(id, 'IMPORT', `Synthetic fixture import: ${outcome.toLowerCase()}.`, at, rowFor(id)!.version, changes, actor);
        return { opportunity: adminDTO(rowFor(id)!, now), created: !existing, runId };
      });
    },
    listReview(now = new Date()): AdminCatalogueRecord[] {
      return (db.prepare('SELECT * FROM opportunities ORDER BY updated_at DESC, id').all() as Row[]).map(row => adminDTO(row, now));
    },
    getAdmin(id: string, now = new Date()): AdminCatalogueRecord | null { const row = rowFor(id); return row ? adminDTO(row, now) : null; },
    review(id: string, input: ReviewInput, now = new Date(), actor = 'LOCAL_SYSTEM'): AdminCatalogueRecord {
      if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || !['PUBLISH', 'REJECT'].includes(input.decision) || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000) throw new RepositoryError('INVALID_REVIEW', 422, 'A current version, decision and review reason (1–1000 characters) are required.');
      return transaction(() => {
        const row = rowFor(id);
        if (!row) throw new RepositoryError('NOT_FOUND', 404, 'Opportunity not found.');
        if (row.version !== input.expectedVersion || row.status !== 'DRAFT') throw new RepositoryError('VERSION_CONFLICT', 409, 'This record has changed or already been reviewed. Refresh before deciding.');
        const current = adminDTO(row, now);
        if (input.decision === 'PUBLISH' && current.issues.length > 0) throw new RepositoryError('PUBLICATION_BLOCKED', 422, 'Publication is blocked by missing, expired or disallowed source facts.');
        const at = now.toISOString();
        db.prepare('INSERT INTO review_events(id,opportunity_id,decision,reason,at,version,actor) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), id, input.decision, input.reason.trim(), at, row.version, actor);
        db.prepare('UPDATE opportunities SET status=?, version=version+1, updated_at=? WHERE id=? AND version=?').run(input.decision === 'PUBLISH' ? 'PUBLISHED' : 'REJECTED', at, id, row.version);
        const updated = rowFor(id)!;
        audit(id, input.decision, input.reason.trim(), at, updated.version, [], actor);
        if (input.decision === 'PUBLISH') {
          const published = effectiveRecord(updated); const dates = currentOccurrences(published, now);
          db.prepare('INSERT INTO published_snapshots(opportunity_id,snapshot_json,at) VALUES(?,?,?) ON CONFLICT(opportunity_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,at=excluded.at').run(id, JSON.stringify(publicDTO(updated, published, dates[0], dates)), at);
          for (const date of dates) db.prepare('INSERT INTO published_occurrence_snapshots(opportunity_id,occurrence_id,version,snapshot_json,at) VALUES(?,?,?,?,?)').run(id, date.id, updated.version, JSON.stringify(publicDTO(updated, published, date, [date])), at);
        }
        return adminDTO(rowFor(id)!, now);
      });
    },
    listPublic(options: PublicQuery = {}, now = new Date()): { data: PublicOpportunity[]; total: number } {
      const { category, area, mode = 'ANY', q, maxFee, limit = 20, offset = 0 } = options;
      if (Object.keys(options).some(key => !['q','category','area','mode','from','until','maxFee','limit','offset'].includes(key)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000 || [category,area,q].some(value => value !== undefined && (typeof value !== 'string' || value.length > 160)) || !['ANY','IN_PERSON','REMOTE'].includes(mode) || (maxFee !== undefined && (!Number.isFinite(maxFee) || maxFee < 0 || maxFee > 100_000))) throw new RepositoryError('INVALID_QUERY', 400, 'Use supported filters, limit 1–50 and offset 0–10000.');
      const from = dateBoundary(options.from, false); const until = dateBoundary(options.until, true);
      if (from !== undefined && until !== undefined && from > until) throw new RepositoryError('INVALID_QUERY', 400, 'The end filter must not precede the start filter.');
      const normalize = (value: string) => value.trim().toLocaleLowerCase('en');
      const eligible = (db.prepare("SELECT * FROM opportunities WHERE status = 'PUBLISHED' ORDER BY created_at, id").all() as Row[])
        .map(row => available(row, now)).filter((item): item is PublicOpportunity => item !== null)
        .filter(item => (!category || normalize(item.category) === normalize(category)) && (!area || normalize(item.area) === normalize(area)) && (mode === 'ANY' || item.mode === mode)
          && (!q || normalize([item.title,item.summary,item.organization.name,item.category,...item.interests].join(' ')).includes(normalize(q)))
          && (maxFee === undefined || (item.fee !== null && item.fee <= maxFee)))
        .map(item => {
          const selected = occurrenceList(item).find(date => (from === undefined || Date.parse(date.startsAt) >= from) && (until === undefined || Date.parse(date.endsAt) <= until));
          return selected ? { ...item, occurrenceId: selected.id, startsAt: selected.startsAt, endsAt: selected.endsAt, timezone: selected.timezone, validUntil: selected.validUntil } : null;
        }).filter((item): item is PublicOpportunity & { occurrenceId: string } => item !== null);
      eligible.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
      return { data: eligible.slice(offset, offset + limit), total: eligible.length };
    },
    getPublic(id: string, now = new Date(), occurrenceId?: string): PublicOpportunity | null { const row = rowFor(id); return row ? available(row, now, occurrenceId) : null; },
    getPublicSnapshot(id: string, occurrenceId = 'primary'): PublicOpportunity | null { return snapshot(id, occurrenceId); },
    getHistoricalSnapshot(externalId: string): PublicOpportunity | null {
      const row = db.prepare('SELECT o.id FROM opportunities o JOIN published_snapshots p ON p.opportunity_id=o.id WHERE o.external_id=? ORDER BY p.at DESC LIMIT 1').get(externalId) as { id: string } | undefined;
      return row ? snapshot(row.id) : null;
    },
    editOpportunity(id: string, input: EditOpportunityInput, now = new Date(), actor = 'LOCAL_SYSTEM'): AdminCatalogueRecord {
      const note = reason(input.reason); expectedVersion(input.expectedVersion);
      if (!input.changes || typeof input.changes !== 'object' || Array.isArray(input.changes) || !Object.keys(input.changes).length || Object.keys(input.changes).some(key => !EDIT_FIELDS.includes(key))) throw new RepositoryError('INVALID_EDIT', 422, 'Provide supported catalogue fields to edit.');
      if (input.changes.schoolCreditApproved === true) throw new RepositoryError('SYNTHETIC_CREDIT_ONLY', 422, 'This local demo cannot assert real school-credit approval.');
      return transaction(() => {
        const row = currentRow(id, input.expectedVersion);
        const original = JSON.parse(row.record_json) as FixtureRecord;
        const proposed = { ...input.changes };
        // Compatibility edits to the old schedule update only the primary row.
        if (original.occurrences && proposed.occurrences === undefined && ['startsAt','endsAt','timezone','validUntil'].some(key => key in proposed)) {
          const primaryChanges: Partial<OpportunityOccurrence> = {};
          for (const field of ['startsAt','endsAt','timezone','validUntil'] as const) if (proposed[field] !== undefined) primaryChanges[field] = proposed[field];
          proposed.occurrences = original.occurrences.map(item => item.id === 'primary' ? { ...item, ...primaryChanges } : { ...item });
        }
        const changes = Object.keys(proposed).filter(key => canonical((original as unknown as Record<string, unknown>)[key]) !== canonical((proposed as Record<string, unknown>)[key]));
        if (!changes.length) return adminDTO(row, now);
        const at = now.toISOString();
        const evidence = original.evidence.filter(entry => !changes.includes(entry.field) && !(['requirements', 'participation'].includes(entry.field) && changes.some(field => REQUIREMENT_FIELDS.includes(field))));
        for (const field of changes) {
          if (field === 'occurrences' && Array.isArray(proposed.occurrences)) {
            evidence.push({ field, excerpt: `Synthetic local edit: ${proposed.occurrences.length} dated occurrences recorded for review. Inspect the selected date and its availability. Source freshness is unchanged; no external verification is claimed.`, sourceUrl: original.source.url });
            continue;
          }
          const value = JSON.stringify((proposed as Record<string, unknown>)[field]);
          const excerpt = value.length > 700 ? `${value.slice(0, 700)}… (excerpt)` : value;
          evidence.push({ field, excerpt: `Synthetic local edit: ${field} = ${excerpt}. No external verification is claimed.`, sourceUrl: original.source.url });
        }
        let updated: FixtureRecord;
        // A local edit is not a new source fetch or confirmation. Keep its original freshness window.
        try { updated = parseFixture({ ...original, ...proposed, evidence: evidence.slice(-30) }); }
        catch { throw new RepositoryError('INVALID_EDIT', 422, 'The proposed fields have invalid values or inconsistent dates.'); }
        requireRetainedOccurrenceIds(original, updated);
        const serialized = canonical(updated); const hash = createHash('sha256').update(serialized).digest('hex');
        db.prepare("UPDATE opportunities SET status='DRAFT',version=version+1,record_json=?,content_hash=?,updated_at=? WHERE id=?").run(serialized, hash, at, id);
        revision(id, row.version + 1, 'EDIT', at, original, updated);
        audit(id, 'EDIT', note, at, row.version + 1, changes, actor);
        return adminDTO(rowFor(id)!, now);
      });
    },
    catalogueAction(id: string, input: CatalogueActionInput, now = new Date(), actor = 'LOCAL_SYSTEM'): AdminCatalogueRecord {
      const note = reason(input.reason); expectedVersion(input.expectedVersion);
      if (!['WITHDRAW','RESTORE'].includes(input.action)) throw new RepositoryError('INVALID_ACTION', 422, 'Choose WITHDRAW or RESTORE.');
      return transaction(() => {
        const row = currentRow(id, input.expectedVersion);
        const isWithdrawn = withdrawn(id);
        if ((input.action === 'WITHDRAW' && isWithdrawn) || (input.action === 'RESTORE' && !isWithdrawn)) throw new RepositoryError('STATE_CONFLICT', 409, 'This action does not match the current withdrawal state. Reload the record.');
        db.prepare('UPDATE opportunity_controls SET withdrawn=? WHERE opportunity_id=?').run(input.action === 'WITHDRAW' ? 1 : 0, id);
        const at = now.toISOString();
        db.prepare('UPDATE opportunities SET status=?,version=version+1,updated_at=? WHERE id=?').run(input.action === 'RESTORE' ? 'DRAFT' : row.status, at, id);
        audit(id, input.action, note, at, row.version + 1, ['withdrawn'], actor);
        return adminDTO(rowFor(id)!, now);
      });
    },
    listSources(now = new Date()): SourceHealth[] {
      return (db.prepare('SELECT * FROM sources ORDER BY id').all() as { id: string; record_json: string }[]).map(row => {
        const source = JSON.parse(row.record_json) as FixtureRecord['source']; const control = sourceControl(row.id);
        const listings = db.prepare('SELECT * FROM opportunities WHERE source_id=?').all(row.id) as Row[];
        const currentCount = listings.filter(item => available(item, now)).length;
        const latest = db.prepare('SELECT MAX(at) AS at FROM import_runs WHERE source_id=?').get(row.id) as { at: string | null };
        const health: SourceHealth['health'] = control.paused ? 'PAUSED' : source.permission !== 'APPROVED' || !source.permissionEvidence.trim() || listings.some(item => item.status === 'DRAFT' && publicationIssues(effectiveRecord(item), now).length > 0) ? 'NEEDS_REVIEW' : currentCount === 0 ? 'STALE' : 'HEALTHY';
        return { id: row.id, name: source.name, url: source.url, method: 'FIXTURE', permission: source.permission, permissionEvidence: source.permissionEvidence, paused: !!control.paused, version: control.version, health, lastImportAt: latest.at, listingCount: listings.length, currentCount, realFeedConnected: false };
      });
    },
    updateSource(id: string, input: SourceUpdate, now = new Date(), actor = 'LOCAL_SYSTEM'): SourceHealth {
      const note = reason(input.reason); expectedVersion(input.expectedVersion);
      if (typeof input.paused !== 'boolean') throw new RepositoryError('INVALID_SOURCE_UPDATE', 422, 'Provide a paused boolean.');
      return transaction(() => {
        if (!db.prepare('SELECT id FROM sources WHERE id=?').get(id)) throw new RepositoryError('NOT_FOUND', 404, 'Source not found.');
        const control = sourceControl(id);
        if (control.version !== input.expectedVersion) throw new RepositoryError('VERSION_CONFLICT', 409, 'This source changed. Reload before updating.');
        const at = now.toISOString();
        db.prepare('UPDATE source_controls SET paused=?,version=version+1,updated_at=?,reason=? WHERE source_id=?').run(input.paused ? 1 : 0, at, note, id);
        db.prepare('INSERT INTO source_events(id,source_id,paused,version,reason,at,actor) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), id, input.paused ? 1 : 0, control.version + 1, note, at, actor);
        return repository.listSources(now).find(source => source.id === id)!;
      });
    },
    listImportRuns(): ImportRun[] {
      return (db.prepare('SELECT r.*,d.title AS imported_title,o.record_json FROM import_runs r JOIN opportunities o ON o.id=r.opportunity_id LEFT JOIN import_run_details d ON d.run_id=r.id ORDER BY r.at DESC,r.rowid DESC').all() as { id: string; opportunity_id: string; source_id: string; result: ImportRun['result']; at: string; content_hash: string; record_json: string; imported_title: string | null }[]).map(row => ({ id: row.id, opportunityId: row.opportunity_id, title: row.imported_title ?? `${(JSON.parse(row.record_json) as FixtureRecord).title} (legacy title snapshot unavailable)`, sourceId: row.source_id, result: row.result, at: row.at, contentHash: row.content_hash, method: 'FIXTURE' }));
    },
    listOrganizations(): OrganizationSummary[] {
      return (db.prepare('SELECT o.id,o.record_json,COUNT(p.id) AS listing_count FROM organizations o LEFT JOIN opportunities p ON p.organization_id=o.id GROUP BY o.id ORDER BY o.id').all() as { id: string; record_json: string; listing_count: number }[]).map(row => {
        const organization = JSON.parse(row.record_json) as FixtureRecord['organization'];
        return { id: row.id, name: organization.name, url: organization.url, opportunityCount: row.listing_count, verification: 'SYNTHETIC_NOT_VERIFIED' };
      });
    },
    listExceptions(now = new Date()): OperatorException[] { return exceptions(now); },
    updateException(id: string, input: ExceptionInput, now = new Date(), actor = 'LOCAL_SYSTEM'): OperatorException {
      const note = reason(input.reason);
      if (!['ACKNOWLEDGE','RESOLVE'].includes(input.action)) throw new RepositoryError('INVALID_ACTION', 422, 'Choose ACKNOWLEDGE or RESOLVE.');
      return transaction(() => {
        const item = exceptions(now).find(entry => entry.id === id);
        if (!item) throw new RepositoryError('NOT_FOUND', 404, 'Exception not found.');
        if (item.status === 'RESOLVED') {
          if (input.action === 'RESOLVE') return item;
          throw new RepositoryError('STATE_CONFLICT', 409, 'This exception was already resolved. Reload before recording a new decision.');
        }
        if (input.action === 'RESOLVE' && !item.canResolve) throw new RepositoryError('CONDITION_ACTIVE', 409, 'Fix the underlying condition before resolving this exception.');
        const status = input.action === 'ACKNOWLEDGE' ? 'ACKNOWLEDGED' : 'RESOLVED'; const at = now.toISOString();
        db.prepare('UPDATE exception_states SET status=?,reason=?,updated_at=?,assigned_to=? WHERE id=?').run(status, note, at, actor, id);
        db.prepare('INSERT INTO exception_events(id,exception_id,action,reason,at,actor) VALUES(?,?,?,?,?,?)').run(randomUUID(), id, input.action, note, at, actor);
        return { ...item, owner:actor, status, reason: note, updatedAt: at, decisions: [...item.decisions, { action: input.action, reason: note, at, actor }] };
      });
    },
    getCommunity(slug: string, includeUnpublished = false, now = new Date()): CommunityPage | null {
      if(slug!=='demo-neighborhood')return null;
      let page;try{page=community.get('demo-community');}catch(error){if(error instanceof RepositoryError&&error.status===404)return null;throw error;}
      if(page.state==='ARCHIVED'||!includeUnpublished&&page.state!=='APPROVED')return null;
      return {slug,title:page.title,description:page.description,published:page.state==='APPROVED',version:page.version,isSynthetic:true,partnerVerified:false,opportunities:repository.listPublic({limit:50},now).data};
    },
    listCommunities(now = new Date()): CommunityPage[] { const page = repository.getCommunity('demo-neighborhood', true, now); return page ? [page] : []; },
    updateCommunity(slug: string, input: CommunityUpdate, now = new Date(), actor = 'LOCAL_SYSTEM'): CommunityPage {
      const note=reason(input.reason);expectedVersion(input.expectedVersion);
      if(typeof input.published!=='boolean')throw new RepositoryError('INVALID_COMMUNITY_UPDATE',422,'Provide a published boolean.');
      return transaction(()=>{
        const page=repository.getCommunity(slug,true,now);if(!page)throw new RepositoryError('NOT_FOUND',404,'Demo community not found.');
        if(page.version!==input.expectedVersion)throw new RepositoryError('VERSION_CONFLICT',409,'This community page changed. Reload before updating.');
        if(page.published===input.published)return page;
        const updated=community.update('demo-community',{action:input.published?'APPROVE':'PAUSE',expectedVersion:page.version},actor==='LOCAL_SYSTEM'?'demo-reviewer':actor,now);
        db.prepare('UPDATE community_pages SET published=?,version=? WHERE slug=?').run(input.published?1:0,updated.version,slug);
        db.prepare('INSERT INTO community_events(id,slug,published,version,reason,at,actor) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),slug,input.published?1:0,updated.version,note,now.toISOString(),actor);
        return repository.getCommunity(slug,true,now)!;
      });
    },
    overview(now = new Date()): OperatorOverview {
      const items = repository.listReview(now); const sources = repository.listSources(now); const imports = repository.listImportRuns(); const issues = exceptions(now);
      return { counts: { published: repository.listPublic({}, now).total, draft: items.filter(item => item.status === 'DRAFT').length, unavailable: items.filter(item => !['DRAFT','PUBLISHED'].includes(item.effectiveStatus) || (item.status === 'PUBLISHED' && !repository.getPublic(item.id, now))).length, sources: sources.length, imports: imports.length, openExceptions: issues.filter(item => item.status !== 'RESOLVED').length }, recentImports: imports.slice(0, 5), exceptions: issues.filter(item => item.status !== 'RESOLVED').slice(0, 8), integrations: { feeds: 'DEFERRED', authentication: 'LOCAL_DEMO', ai: 'DETERMINISTIC_RULES', emailSms: 'NOT_CONNECTED' } };
    },
    matchingQa(now = new Date()): MatchingQaCase[] {
      const cases: MatchingQaCase[] = [];
      for (const row of db.prepare("SELECT * FROM opportunities WHERE status='PUBLISHED'").all() as Row[]) {
        const record = effectiveRecord(row);
        const current = available(row, now);
        if (!current || record.minAge === null) continue;
        const preferences: Preferences = { ageMin: record.minAge, ageMax: record.minAge, availableFrom: current.startsAt, availableUntil: current.endsAt, mode: 'ANY', area: record.area, interests: record.interests, maxFee: record.fee ?? 0, hasTraining: true, hasGuardian: true, requiresSchoolCredit: false };
        const qualifying = evaluateEligibility(current, preferences, now);
        cases.push({ id: `${row.id}:qualifying`, title: `${record.title}: compatible preferences`, expected: 'ELIGIBLE', actual: qualifying.status, passed: qualifying.status === 'ELIGIBLE', reasons: qualifying.reasons });
        if (record.minAge > 0) {
          const underAge = evaluateEligibility(current, { ...preferences, ageMin: record.minAge - 1, ageMax: record.minAge - 1 }, now);
          cases.push({ id: `${row.id}:age`, title: `${record.title}: below minimum age`, expected: 'INELIGIBLE', actual: underAge.status, passed: underAge.status === 'INELIGIBLE', reasons: underAge.reasons });
        }
      }
      return cases;
    },
    seedDemo(fixtures: FixtureOption[], now = new Date()): boolean {
      return transaction(() => {
        if (db.prepare("SELECT value FROM catalogue_meta WHERE key='demo-seed-v1'").get()) return false;
        const count = (db.prepare('SELECT COUNT(*) AS count FROM opportunities').get() as { count: number }).count;
        db.prepare("INSERT INTO catalogue_meta(key,value) VALUES('demo-seed-v1',?)").run(now.toISOString());
        if (count > 0) return false;
        const currentIds = new Set(['garden','remote','pantry','river-cleanup','animal-care','youth-arts','remote-tech']);
        for (const fixture of fixtures) {
          if (fixture.fixtureId === 'garden-changed' || fixture.fixtureId === 'garden-series') continue;
          const reviewAt = fixture.fixtureId === 'past-reading' ? new Date(Date.parse(fixture.record.startsAt) - 3_600_000) : now;
          const item = repository.importRecord(fixture.record, reviewAt).opportunity;
          if (currentIds.has(fixture.fixtureId) || fixture.fixtureId === 'past-reading') repository.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Synthetic demo setup only. No real organizer verification, permission or attendance is asserted.' }, reviewAt);
        }
        return true;
      });
    },
    close() { if (!closed) { db.close(); closed = true; } }
  };
  const community=createCommunityStore(db,{opportunities:now=>repository.listPublic({limit:50},now).data});
  return repository;
}

export type Repository = ReturnType<typeof createRepository>;
