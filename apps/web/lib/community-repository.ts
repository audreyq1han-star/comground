import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CommunityRecord, DistributionAudit, DistributionPage, PublicCommunityRecord } from '../../../packages/domain/distribution-contracts.ts';
import type { Campaign } from '../../../packages/domain/measurement-contracts.ts';
import type { PublicOpportunity } from '../../../packages/domain/contracts.ts';
import { objectInput } from './http.ts';
import { communitySlug, distributionActor, distributionFail as fail, distributionPagination, distributionVersion, plainDistributionCopy } from './distribution-validation.ts';

type Row = { id: string; slug: string; title: string; description: string; channel: CommunityRecord['channel']; state: CommunityRecord['state']; version: number; created_at: string; updated_at: string; audit_json: string };
const disclosure = 'Synthetic example — no school, community or organizer partnership is claimed.' as const;
function safeCopy(value: unknown, max: number): string {
  const copy = plainDistributionCopy(value, max);
  if (/\b(partners?|partnership|sponsors?|sponsored|endorsed|official|verified|accredited|authorized)\b/i.test(copy)) return fail('INVALID_COPY', 422, 'Use fictional descriptive copy without partnership, sponsorship or official-status claims. The required disclosure is added separately.');
  return copy;
}
function dto(row: Row): CommunityRecord { return { id: row.id, slug: row.slug, title: row.title, description: row.description, channel: row.channel, state: row.state, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, audit: JSON.parse(row.audit_json), isSynthetic: true, partnerVerified: false, disclosure, path: `/communities/${row.slug}?campaign=${encodeURIComponent(row.id)}` }; }
export function initializeCommunitySchema(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS distribution_community_pages(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,description TEXT NOT NULL,channel TEXT NOT NULL CHECK(channel IN('SCHOOL_CLUB','COMMUNITY')),state TEXT NOT NULL CHECK(state IN('DRAFT','APPROVED','PAUSED','ARCHIVED')),version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,audit_json TEXT NOT NULL);`);
  const schema = (db.prepare("SELECT sql FROM sqlite_master WHERE name='distribution_community_pages'").get() as { sql: string }).sql;
  if (!schema.includes("'ARCHIVED'")) {
    db.exec('SAVEPOINT community_archive_migration');
    try {
      db.exec(schema.replace('distribution_community_pages', 'distribution_community_pages_upgrade').replace("'PAUSED'", "'PAUSED','ARCHIVED'"));
      db.exec('INSERT INTO distribution_community_pages_upgrade SELECT * FROM distribution_community_pages; DROP TABLE distribution_community_pages; ALTER TABLE distribution_community_pages_upgrade RENAME TO distribution_community_pages; RELEASE community_archive_migration;');
    } catch (error) { db.exec('ROLLBACK TO community_archive_migration; RELEASE community_archive_migration'); throw error; }
  }
}
/** Preserve the two historical synthetic campaign IDs and the legacy public URL.
 * Never invent a real partner or infer a live campaign from ordinary catalogue data. */
export function migrateLegacyCommunityPages(db: DatabaseSync, seedExamples = false): void {
  const has = (name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const legacy = has('community_pages') ? db.prepare("SELECT published,version FROM community_pages WHERE slug='demo-neighborhood'").get() as { published: number; version: number } | undefined : undefined;
  for (const item of [
    { id: 'demo-community', slug: 'demo-neighborhood', title: 'Example neighborhood', channel: 'COMMUNITY' },
    { id: 'demo-school-club', slug: 'demo-school-club', title: 'Synthetic school club campaign', channel: 'SCHOOL_CLUB' },
  ]) {
    const campaign = has('measurement_campaigns') ? db.prepare('SELECT paused,version FROM measurement_campaigns WHERE id=?').get(item.id) as { paused: number; version: number } | undefined : undefined;
    if (!legacy && !campaign && !seedExamples) continue;
    const at = new Date().toISOString(), version = Math.max(legacy?.version ?? 1, campaign?.version ?? 1), state = legacy?.published === 0 || campaign?.paused ? 'PAUSED' : 'APPROVED';
    const audit: DistributionAudit[] = [{ action: 'MIGRATE_SYNTHETIC_LEGACY', actor: 'LOCAL_MIGRATION', at, version }];
    db.prepare('INSERT OR IGNORE INTO distribution_community_pages VALUES(?,?,?,?,?,?,?,?,?,?)').run(item.id, item.slug, item.title, 'A fictional front door for exploring manually reviewed example volunteering opportunities. No real organization or location is represented.', item.channel, state, version, at, at, JSON.stringify(audit));
  }
}
export function createCommunityStore(db: DatabaseSync, options: { opportunities?: (now: Date) => PublicOpportunity[]; seedExamples?: boolean; mutationsEnabled?: boolean } = {}) {
  initializeCommunitySchema(db);
  migrateLegacyCommunityPages(db, options.seedExamples === true);
  function requireExercise(): void { if (options.mutationsEnabled === false) fail('COMMUNITY_EXERCISE_DISABLED', 403, 'Synthetic community editing is available only in local demo or test mode.'); }
  function transaction<T>(action: () => T): T { db.exec('SAVEPOINT community_write'); try { const result = action(); db.exec('RELEASE community_write'); return result; } catch (error) { db.exec('ROLLBACK TO community_write; RELEASE community_write'); throw error; } }
  function rowFor(id: string): Row { return db.prepare('SELECT * FROM distribution_community_pages WHERE id=?').get(id) as Row | undefined ?? fail('NOT_FOUND', 404, 'This synthetic community record is unavailable.'); }
  function list(offset = 0, limit = 20): DistributionPage<CommunityRecord> {
    distributionPagination(offset, limit);
    return { items: (db.prepare('SELECT * FROM distribution_community_pages ORDER BY updated_at DESC,id LIMIT ? OFFSET ?').all(limit, offset) as Row[]).map(dto), total: (db.prepare('SELECT COUNT(*) AS total FROM distribution_community_pages').get() as { total: number }).total, offset, limit };
  }
  function fields(input: Record<string, unknown>) {
    const slug = communitySlug(input.slug), title = safeCopy(input.title, 100), description = safeCopy(input.description, 800);
    if (input.channel !== 'SCHOOL_CLUB' && input.channel !== 'COMMUNITY') return fail('INVALID_INPUT', 422, 'Choose a school club or community channel.');
    return { slug, title, description, channel: input.channel };
  }
  function assertUniqueSlug(slug: string, id = ''): void { if (db.prepare('SELECT 1 FROM distribution_community_pages WHERE slug=? AND id<>?').get(slug, id)) fail('SLUG_CONFLICT', 409, 'That public slug is already used. Choose another.'); }
  function create(input: unknown, actor: string, now = new Date()): CommunityRecord {
    requireExercise();
    const value = fields(objectInput(input, ['slug', 'title', 'description', 'channel'])); distributionActor(actor);
    return transaction(() => {
      assertUniqueSlug(value.slug);
      if ((db.prepare('SELECT COUNT(*) AS total FROM distribution_community_pages').get() as { total: number }).total >= 1000) return fail('COMMUNITY_LIMIT', 409, 'This local exercise has reached its 1,000-record limit, including archived history.');
      const id = randomUUID(), at = now.toISOString();
      const audit: DistributionAudit[] = [{ action: 'CREATE_DRAFT', actor, at, version: 1 }];
      db.prepare('INSERT INTO distribution_community_pages VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, value.slug, value.title, value.description, value.channel, 'DRAFT', 1, at, at, JSON.stringify(audit));
      return dto(rowFor(id));
    });
  }
  function update(id: string, input: unknown, actor: string, now = new Date()): CommunityRecord {
    requireExercise();
    const value = objectInput(input, ['expectedVersion', 'action', 'slug', 'title', 'description', 'channel']);
    const expectedVersion = distributionVersion(value.expectedVersion, 1); distributionActor(actor);
    if (!['EDIT', 'APPROVE', 'PAUSE', 'DRAFT'].includes(String(value.action))) return fail('INVALID_INPUT', 422, 'Choose edit, approve, pause or return to draft.');
    if (value.action !== 'EDIT' && ['slug','title','description','channel'].some(key => key in value)) return fail('INVALID_INPUT', 422, 'Edit content in a separate review step before approving it.');
    return transaction(() => {
      const row = rowFor(id); if (row.version !== expectedVersion) return fail('VERSION_CONFLICT', 409, 'This community page changed. Reload before editing or reviewing.');
      if (value.action === 'APPROVE' && !['DRAFT','PAUSED'].includes(row.state) || value.action === 'PAUSE' && row.state !== 'APPROVED' || value.action === 'DRAFT' && row.state === 'DRAFT') return fail('STATE_CONFLICT', 409, 'That action does not apply to the current review state.');
      if (row.state === 'ARCHIVED') return fail('STATE_CONFLICT', 409, 'Archived page history is retained and cannot be republished. Create a new draft.');
      const next = value.action === 'EDIT' ? fields(value) : row;
      assertUniqueSlug(next.slug, id);
      const state = value.action === 'APPROVE' ? 'APPROVED' : value.action === 'PAUSE' ? 'PAUSED' : 'DRAFT';
      const at = now.toISOString(), version = row.version + 1, audit = JSON.parse(row.audit_json) as DistributionAudit[];
      if (audit.length >= 100 && value.action !== 'PAUSE') return fail('COMMUNITY_REVIEW_LIMIT', 409, 'This page reached its review limit. Pause and archive it, then create a new draft.');
      audit.push({ action: String(value.action), actor, at, version });
      db.prepare('UPDATE distribution_community_pages SET slug=?,title=?,description=?,channel=?,state=?,version=?,updated_at=?,audit_json=? WHERE id=?').run(next.slug, next.title, next.description, next.channel, state, version, at, JSON.stringify(audit), id);
      return dto(rowFor(id));
    });
  }
  function remove(id: string, input: unknown, actor: string, now = new Date()): void {
    requireExercise();
    const value = objectInput(input, ['expectedVersion']); distributionActor(actor); const expectedVersion = distributionVersion(value.expectedVersion, 1);
    transaction(() => { const current = rowFor(id); if (current.version !== expectedVersion) return fail('VERSION_CONFLICT', 409, 'This page changed. Reload before deleting.'); if (current.state === 'ARCHIVED') return fail('STATE_CONFLICT', 409, 'This page is already archived.'); if (current.state === 'APPROVED') return fail('STATE_CONFLICT', 409, 'Pause or return an approved page to draft before deleting.'); const audit = JSON.parse(current.audit_json) as DistributionAudit[]; const version = current.version + 1; audit.push({ action: 'ARCHIVE', actor, at: now.toISOString(), version }); db.prepare("UPDATE distribution_community_pages SET state='ARCHIVED',version=?,updated_at=?,audit_json=? WHERE id=?").run(version, now.toISOString(), JSON.stringify(audit), id); });
  }
  function publicBySlug(slug: string, now = new Date()): PublicCommunityRecord {
    communitySlug(slug);
    const row = db.prepare("SELECT * FROM distribution_community_pages WHERE slug=? AND state='APPROVED'").get(slug) as Row | undefined;
    if (!row) return fail('NOT_FOUND', 404, 'This synthetic community page is not available.');
    const { audit: _audit, ...record } = dto(row);
    return { ...record, opportunities: (options.opportunities?.(now) ?? []).slice(0, 50) };
  }
  function campaigns(activeOnly = false): Campaign[] {
    return (db.prepare(`SELECT * FROM distribution_community_pages WHERE state${activeOnly ? "='APPROVED'" : "<>'DRAFT'"} ORDER BY title,id`).all() as Row[]).map(row => ({ id: row.id, name: row.title, channel: row.channel, paused: row.state !== 'APPROVED', version: row.version, path: dto(row).path, isSynthetic: true }));
  }
  return { list, get: (id: string) => dto(rowFor(id)), create, update, remove, publicBySlug, campaigns };
}
export type CommunityStore = ReturnType<typeof createCommunityStore>;
