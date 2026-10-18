import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { StudentMatches } from '../../../packages/domain/app-contracts.ts';
import type { DigestBatch, DigestDispatchReference, DigestOccurrence, DigestPreview, DigestSubscription, DistributionAudit, DistributionExport, DistributionPage } from '../../../packages/domain/distribution-contracts.ts';
import { objectInput } from './http.ts';
import { distributionActor, distributionFail as fail, distributionPagination, distributionVersion, plainDistributionCopy } from './distribution-validation.ts';

export type DigestOwner = { exists: boolean; profileVersion: number | null; externalEligible: boolean };
export type DistributionOptions = {
  owner: (owner: string) => DigestOwner;
  matches: (owner: string, now: Date) => StudentMatches;
  enqueue?: (owner: string, reference: DigestDispatchReference, now: Date) => { id: string };
};
type SubscriptionRow = { owner: string; enabled: number; version: number; updated_at: string };
type BatchRow = { id: string; label: string; state: DigestBatch['state']; version: number; created_at: string; updated_at: string; expires_at: string; opportunities_json: string; audit_json: string };
type RecipientRow = { batch_id: string; owner: string; subscription_version: number; profile_version: number; refs_json: string; state: 'PENDING' | 'QUEUED' | 'SKIPPED'; created_at: string };
const hasTable = (db: DatabaseSync, name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const DAY = 86400000;
function cancelPendingDigests(db: DatabaseSync, kind: 'owner' | 'batch', id: string, now: Date): void {
  if (!hasTable(db, 'notification_outbox')) return;
  const where = kind === 'owner' ? 'account_id=?' : "json_extract(reference_json,'$.batchId')=?";
  db.prepare(`UPDATE notification_outbox SET state='CANCELLED',reason=?,envelope=NULL,next_attempt_at=NULL,updated_at=? WHERE purpose='DIGEST' AND state IN('BLOCKED','QUEUED','LEASED','RETRY') AND ${where}`).run(kind === 'owner' ? 'CONSENT_WITHDRAWN' : 'MANUALLY_CANCELLED', now.toISOString(), id);
}
function baseSubscription(db: DatabaseSync, owner: string): Omit<DigestSubscription, 'externalEligible'> {
  const row = hasTable(db, 'digest_subscriptions') ? db.prepare('SELECT * FROM digest_subscriptions WHERE owner=?').get(owner) as SubscriptionRow | undefined : undefined;
  const profile = hasTable(db, 'student_profiles') ? db.prepare('SELECT profile_json FROM student_profiles WHERE persona_id=?').get(owner) as { profile_json: string } | undefined : undefined;
  return { enabled: !!row?.enabled, version: row?.version ?? 0, updatedAt: row?.updated_at ?? null, profileVersion: profile ? (JSON.parse(profile.profile_json) as { version: number }).version : null, purpose: 'OPTIONAL_SHORTLIST_DIGEST' };
}
/** Safe before this feature has been opened; only the authenticated owner's data. */
export function exportOwnerDistribution(db: DatabaseSync, owner: string): DistributionExport {
  const rows = hasTable(db, 'digest_recipients') ? db.prepare('SELECT * FROM digest_recipients WHERE owner=? ORDER BY created_at,batch_id').all(owner) as RecipientRow[] : [];
  return { subscription: baseSubscription(db, owner), batches: rows.map(row => ({ batchId: row.batch_id, state: row.state, subscriptionVersion: row.subscription_version, profileVersion: row.profile_version, occurrences: JSON.parse(row.refs_json) as DigestOccurrence[], createdAt: row.created_at })) };
}
/** Caller owns the deletion/withdrawal transaction. No recipient history survives. */
export function purgeOwnerDistribution(db: DatabaseSync, owner: string): void {
  if (hasTable(db, 'digest_recipients')) db.prepare('DELETE FROM digest_recipients WHERE owner=?').run(owner);
  if (hasTable(db, 'digest_subscriptions')) db.prepare('DELETE FROM digest_subscriptions WHERE owner=?').run(owner);
}
/** Restored approvals and subscriptions must never authorize new delivery. */
export function cancelRestoredDistribution(db: DatabaseSync, now = new Date()): void {
  if (hasTable(db, 'digest_recipients')) db.prepare('DELETE FROM digest_recipients').run();
  if (hasTable(db, 'digest_subscriptions')) db.prepare('UPDATE digest_subscriptions SET enabled=0,version=version+1,updated_at=? WHERE enabled=1').run(now.toISOString());
  if (hasTable(db, 'digest_batches')) for (const row of db.prepare("SELECT * FROM digest_batches WHERE state<>'CANCELLED'").all() as BatchRow[]) {
    const audit = JSON.parse(row.audit_json) as DistributionAudit[], version = row.version + 1;
    audit.push({ action: 'RESTORE_QUARANTINE', actor: 'LOCAL_RESTORE', at: now.toISOString(), version });
    db.prepare("UPDATE digest_batches SET state='CANCELLED',version=?,updated_at=?,audit_json=? WHERE id=?").run(version, now.toISOString(), JSON.stringify(audit), row.id);
    cancelPendingDigests(db, 'batch', row.id, now);
  }
}
export function pruneDistribution(db: DatabaseSync, now = new Date()): void {
  if (hasTable(db, 'digest_batches')) db.prepare('DELETE FROM digest_batches WHERE created_at<?').run(new Date(now.getTime() - 30 * DAY).toISOString());
}
export function initializeDistributionSchema(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS digest_subscriptions(owner TEXT PRIMARY KEY REFERENCES student_profiles(persona_id) ON DELETE CASCADE,enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),version INTEGER NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS digest_batches(id TEXT PRIMARY KEY,label TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('PREPARED','APPROVED','CANCELLED')),version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,expires_at TEXT NOT NULL,opportunities_json TEXT NOT NULL,audit_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS digest_recipients(batch_id TEXT NOT NULL REFERENCES digest_batches(id) ON DELETE CASCADE,owner TEXT NOT NULL REFERENCES student_profiles(persona_id) ON DELETE CASCADE,subscription_version INTEGER NOT NULL,profile_version INTEGER NOT NULL,refs_json TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('PENDING','QUEUED','SKIPPED')),created_at TEXT NOT NULL,PRIMARY KEY(batch_id,owner));
    CREATE INDEX IF NOT EXISTS digest_recipient_owner ON digest_recipients(owner);`);
}
export function createDistributionStore(db: DatabaseSync, options: DistributionOptions) {
  initializeDistributionSchema(db);
  function transaction<T>(action: () => T): T { db.exec('SAVEPOINT distribution_write'); try { const result = action(); db.exec('RELEASE distribution_write'); return result; } catch (error) { db.exec('ROLLBACK TO distribution_write; RELEASE distribution_write'); throw error; } }
  function subscription(owner: string): DigestSubscription { return { ...baseSubscription(db, owner), ...{ profileVersion: options.owner(owner).profileVersion, externalEligible: options.owner(owner).externalEligible } }; }
  function setSubscription(owner: string, input: unknown, now = new Date()): DigestSubscription {
    const value = objectInput(input, ['enabled', 'expectedVersion', 'expectedProfileVersion']);
    const expectedVersion = distributionVersion(value.expectedVersion), profileVersion = distributionVersion(value.expectedProfileVersion, 1);
    if (typeof value.enabled !== 'boolean') return fail('INVALID_INPUT', 422, 'Choose whether to receive optional shortlist digests.');
    return transaction(() => {
      const account = options.owner(owner), current = subscription(owner);
      if (!account.exists || account.profileVersion === null) return fail('CONSENT_REQUIRED', 403, 'Complete a profile before choosing digest delivery.');
      if (current.version !== expectedVersion || current.profileVersion !== profileVersion) return fail('VERSION_CONFLICT', 409, 'Your profile or digest settings changed. Reload before saving.');
      if (value.enabled && !account.externalEligible) return fail('DIGEST_EXTERNAL_DISABLED', 403, 'External digests require a verified eligible adult account and current privacy consent. Private in-app previews remain available.');
      if (current.enabled !== value.enabled) db.prepare('INSERT INTO digest_subscriptions VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET enabled=excluded.enabled,version=excluded.version,updated_at=excluded.updated_at').run(owner, value.enabled ? 1 : 0, current.version + 1, now.toISOString());
      // Withdrawal erases owned prepared selections. Re-enabling cannot resurrect approval.
      if (!value.enabled) { db.prepare('DELETE FROM digest_recipients WHERE owner=?').run(owner); cancelPendingDigests(db, 'owner', owner, now); }
      return subscription(owner);
    });
  }
  function currentSelection(owner: string, now: Date) {
    const result = options.matches(owner, now);
    const opportunities = result.data.filter(item => item.eligibility.status === 'ELIGIBLE' && Date.parse(item.opportunity.startsAt) > now.getTime()).slice(0, 3).map(item => item.opportunity);
    const refs: DigestOccurrence[] = opportunities.map(item => ({ opportunityId: item.id, occurrenceId: item.occurrenceId ?? 'primary', opportunityVersion: item.version, startsAt: item.startsAt, endsAt: item.endsAt, timezone: item.timezone }));
    return { profileVersion: result.profileVersion, opportunities, refs };
  }
  function privatePreview(owner: string, now = new Date()): DigestPreview {
    const current = currentSelection(owner, now);
    return { generatedAt: now.toISOString(), profileVersion: current.profileVersion, opportunities: current.opportunities, delivery: 'PRIVATE_IN_APP_ONLY' };
  }
  function prune(now = new Date()): void { pruneDistribution(db, now); }
  function batchRow(id: string): BatchRow { return db.prepare('SELECT * FROM digest_batches WHERE id=?').get(id) as BatchRow | undefined ?? fail('NOT_FOUND', 404, 'This digest batch is unavailable.'); }
  function batch(id: string): DigestBatch {
    const row = batchRow(id);
    const counts = { prepared: 0, queued: 0, skipped: 0, pending: 0 };
    for (const item of db.prepare('SELECT state,COUNT(*) AS total FROM digest_recipients WHERE batch_id=? GROUP BY state').all(id) as { state: RecipientRow['state']; total: number }[]) { counts.prepared += item.total; counts[item.state.toLowerCase() as 'pending' | 'queued' | 'skipped'] = item.total; }
    return { id: row.id, label: row.label, state: row.state, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at, counts, opportunities: JSON.parse(row.opportunities_json), audit: JSON.parse(row.audit_json), studentIdentitiesIncluded: false };
  }
  function batches(offset = 0, limit = 20, now = new Date()): DistributionPage<DigestBatch> {
    distributionPagination(offset, limit); prune(now);
    return { items: (db.prepare('SELECT id FROM digest_batches ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(limit, offset) as { id: string }[]).map(item => batch(item.id)), total: (db.prepare('SELECT COUNT(*) AS total FROM digest_batches').get() as { total: number }).total, offset, limit };
  }
  function prepareBatch(input: unknown, actor: string, now = new Date()): DigestBatch {
    const value = objectInput(input, ['label']), label = plainDistributionCopy(value.label, 100); distributionActor(actor);
    return transaction(() => {
      prune(now); const id = randomUUID(), at = now.toISOString();
      const prepared: { owner: string; subscriptionVersion: number; selection: ReturnType<typeof currentSelection> }[] = [];
      for (const row of db.prepare('SELECT owner,version FROM digest_subscriptions WHERE enabled=1 ORDER BY updated_at,owner LIMIT 200').all() as { owner: string; version: number }[]) {
        if (!options.owner(row.owner).externalEligible) continue;
        try { const selection = currentSelection(row.owner, now); if (selection.refs.length) prepared.push({ owner: row.owner, subscriptionVersion: row.version, selection }); } catch (error) { if (!(error instanceof Error && 'status' in error && [403,404].includes(Number(error.status)))) throw error; }
      }
      const union = new Map<string, DigestBatch['opportunities'][number]>();
      for (const item of prepared) item.selection.refs.forEach((ref, index) => union.set(`${ref.opportunityId}:${ref.occurrenceId}`, { ...ref, title: item.selection.opportunities[index].title }));
      const expiresAt = new Date(Math.min(now.getTime() + DAY, ...[...union.values()].map(item => Date.parse(item.startsAt)))).toISOString();
      const audit: DistributionAudit[] = [{ action: 'PREPARE', actor, at, version: 1 }];
      db.prepare('INSERT INTO digest_batches VALUES(?,?,?,?,?,?,?,?,?)').run(id, label, 'PREPARED', 1, at, at, expiresAt, JSON.stringify([...union.values()]), JSON.stringify(audit));
      for (const item of prepared) db.prepare('INSERT INTO digest_recipients VALUES(?,?,?,?,?,?,?)').run(id, item.owner, item.subscriptionVersion, item.selection.profileVersion, JSON.stringify(item.selection.refs), 'PENDING', at);
      return batch(id);
    });
  }
  function dispatchCurrent(owner: string, reference: DigestDispatchReference, now = new Date()): boolean {
    const row = db.prepare('SELECT * FROM digest_batches WHERE id=?').get(reference.batchId) as BatchRow | undefined;
    const recipient = db.prepare('SELECT * FROM digest_recipients WHERE batch_id=? AND owner=?').get(reference.batchId, owner) as RecipientRow | undefined;
    const account = options.owner(owner), consent = subscription(owner);
    if (!row || row.state !== 'APPROVED' || row.version !== reference.batchVersion || Date.parse(row.expires_at) <= now.getTime() || !recipient || recipient.state === 'SKIPPED' || !account.exists || !account.externalEligible || !consent.enabled || consent.version !== reference.subscriptionVersion || recipient.subscription_version !== reference.subscriptionVersion || account.profileVersion !== reference.profileVersion || recipient.profile_version !== reference.profileVersion) return false;
    try { const current = currentSelection(owner, now); return current.profileVersion === reference.profileVersion && current.refs.length > 0 && JSON.stringify(current.refs) === recipient.refs_json; } catch { return false; }
  }
  function updateBatch(id: string, input: unknown, actor: string, now = new Date()): DigestBatch {
    const value = objectInput(input, ['action', 'expectedVersion']), expectedVersion = distributionVersion(value.expectedVersion, 1); distributionActor(actor);
    if (!['APPROVE', 'CANCEL', 'DISPATCH'].includes(String(value.action))) return fail('INVALID_INPUT', 422, 'Choose approve, cancel or queue approved digests.');
    if (value.action === 'DISPATCH') {
      const row = batchRow(id);
      if (row.version !== expectedVersion) return fail('VERSION_CONFLICT', 409, 'This batch changed. Reload its review version.');
      if (row.state !== 'APPROVED' || Date.parse(row.expires_at) <= now.getTime()) return fail('STATE_CONFLICT', 409, 'Only a current approved batch can be queued.');
      if (!options.enqueue) return fail('DIGEST_QUEUE_UNAVAILABLE', 503, 'Digest delivery is not connected. The approved preview remains available.');
      const audit = JSON.parse(row.audit_json) as DistributionAudit[];
      if (audit.length >= 250) return fail('DIGEST_REVIEW_LIMIT', 409, 'This batch reached its action limit. Prepare a new review batch.');
      audit.push({ action: 'QUEUE_ATTEMPT', actor, at: now.toISOString(), version: expectedVersion });
      db.prepare('UPDATE digest_batches SET audit_json=?,updated_at=? WHERE id=? AND version=?').run(JSON.stringify(audit), now.toISOString(), id, expectedVersion);
      // No write lock is held while the existing outbox opens its own transaction.
      for (const recipient of db.prepare("SELECT * FROM digest_recipients WHERE batch_id=? AND state='PENDING' ORDER BY owner").all(id) as RecipientRow[]) {
        const reference = { batchId: id, batchVersion: expectedVersion, subscriptionVersion: recipient.subscription_version, profileVersion: recipient.profile_version };
        if (!dispatchCurrent(recipient.owner, reference, now)) { db.prepare("UPDATE digest_recipients SET state='SKIPPED' WHERE batch_id=? AND owner=?").run(id, recipient.owner); continue; }
        options.enqueue(recipient.owner, reference, now);
        db.prepare("UPDATE digest_recipients SET state='QUEUED' WHERE batch_id=? AND owner=? AND state='PENDING'").run(id, recipient.owner);
      }
      return batch(id);
    }
    return transaction(() => {
      const row = batchRow(id);
      if (row.version !== expectedVersion) return fail('VERSION_CONFLICT', 409, 'This batch changed. Reload its review version.');
      if (row.state === 'CANCELLED' || value.action === 'APPROVE' && (row.state !== 'PREPARED' || Date.parse(row.expires_at) <= now.getTime())) return fail('STATE_CONFLICT', 409, 'This batch cannot accept that decision. Prepare a new batch when necessary.');
      const version = row.version + 1, at = now.toISOString();
      const audit = JSON.parse(row.audit_json) as DistributionAudit[]; audit.push({ action: String(value.action), actor, at, version });
      db.prepare('UPDATE digest_batches SET state=?,version=?,updated_at=?,audit_json=? WHERE id=?').run(value.action === 'APPROVE' ? 'APPROVED' : 'CANCELLED', version, at, JSON.stringify(audit), id);
      if (value.action === 'CANCEL') { db.prepare('DELETE FROM digest_recipients WHERE batch_id=?').run(id); cancelPendingDigests(db, 'batch', id, now); }
      return batch(id);
    });
  }
  return { subscription, setSubscription, privatePreview, prepareBatch, batches, batch, updateBatch, dispatchCurrent, prune, exportData: (owner: string) => exportOwnerDistribution(db, owner) };
}
export type DistributionStore = ReturnType<typeof createDistributionStore>;
