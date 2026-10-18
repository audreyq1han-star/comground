import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixtureList } from '../../../packages/domain/fixtures.ts';
import { createRepository, RepositoryError } from './repository.ts';
import { changedRevisionFields, matchesCatalogueStatus, utcDateTimeInput } from '../components/admin/catalogue-view.ts';

const now = new Date('2031-05-01T12:00:00Z');
const records = fixtureList(now);
const record = (id: string) => structuredClone(records.find(item => item.fixtureId === id)!.record);
const fails = (status: number) => (error: unknown) => error instanceof RepositoryError && error.status === status;

test('edit, withdraw, restore and fresh review preserve public snapshots and append-only audit', () => {
  const repo = createRepository(':memory:');
  try {
    let item = repo.importRecord(record('garden'), now).opportunity;
    item = repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Synthetic initial publication' }, now);
    const original = repo.getPublic(item.id, now)!;
    item = repo.editOpportunity(item.id, { expectedVersion: item.version, reason: 'Synthetic change', changes: { title: 'Changed synthetic garden' } }, now);
    assert.equal(item.status, 'DRAFT'); assert.equal(repo.getPublic(item.id, now), null);
    assert.equal(repo.getPublicSnapshot(item.id)?.title, original.title);
    assert.equal(repo.listImportRuns()[0].title, original.title);
    assert.throws(() => repo.editOpportunity(item.id, { expectedVersion: item.version - 1, reason: 'Stale', changes: { title: 'Unsafe' } }, now), fails(409));
    assert.throws(() => repo.editOpportunity(item.id, { expectedVersion: item.version, reason: 'Cannot assert real credit', changes: { schoolCreditApproved: true } }, now), fails(422));
    item = repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Synthetic revised publication' }, now);
    item = repo.catalogueAction(item.id, { expectedVersion: item.version, action: 'WITHDRAW', reason: 'Withdraw demo' }, now);
    assert.equal(item.effectiveStatus, 'WITHDRAWN'); assert.equal(repo.getPublic(item.id, now), null);
    item = repo.catalogueAction(item.id, { expectedVersion: item.version, action: 'RESTORE', reason: 'Return to review' }, now);
    assert.equal(item.status, 'DRAFT'); assert.equal(repo.getPublic(item.id, now), null);
    assert.deepEqual(item.auditEvents.map(e => e.action), ['IMPORT', 'PUBLISH', 'EDIT', 'PUBLISH', 'WITHDRAW', 'RESTORE']);
  } finally { repo.close(); }
});

test('source pause applies to every listing, blocks imports/publication, survives reopen and resumes safely', () => {
  const directory = mkdtempSync(join(tmpdir(), 'comground-source-'));
  const filename = join(directory, 'test.sqlite'); let repo = createRepository(filename);
  try {
    for (const id of ['garden', 'pantry']) {
      const item = repo.importRecord(record(id), now).opportunity;
      repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Synthetic publication' }, now);
    }
    const source = repo.listSources(now).find(s => s.id === record('garden').source.id)!;
    assert.equal(source.currentCount, 2);
    const paused = repo.updateSource(source.id, { expectedVersion: source.version, paused: true, reason: 'Pause example feed' }, now);
    assert.equal(paused.health, 'PAUSED'); assert.equal(repo.listPublic({}, now).total, 0);
    assert.throws(() => repo.importRecord(record('garden'), now), fails(409));
    repo.close(); repo = createRepository(filename);
    assert.equal(repo.listSources(now)[0].paused, true);
    const exception = repo.listExceptions(now).find(e => e.kind === 'SOURCE_PAUSED')!;
    assert.throws(() => repo.updateException(exception.id, { action: 'RESOLVE', reason: 'Still paused' }, now), fails(409));
    repo.updateSource(source.id, { expectedVersion: paused.version, paused: false, reason: 'Resume example feed' }, now);
    assert.equal(repo.listPublic({}, now).total, 2);
    assert.equal(repo.listExceptions(now).find(e => e.id === exception.id)?.canResolve, true);
    assert.equal(repo.updateException(exception.id, { action: 'RESOLVE', reason: 'Underlying pause removed' }, now).status, 'RESOLVED');
    assert.equal(repo.listPublic({}, new Date('2031-06-01T00:00:00Z')).total, 0);
  } finally { repo.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('filters apply before pagination and validate unsupported values', () => {
  const repo = createRepository(':memory:');
  try {
    repo.seedDemo(records, now);
    const all = repo.listPublic({ limit: 50 }, now);
    assert.equal(all.total, 7);
    const remote = repo.listPublic({ mode: 'REMOTE', limit: 1, offset: 0 }, now);
    assert.ok(remote.total >= 2); assert.equal(remote.data.length, 1);
    assert.equal(repo.listPublic({ mode: 'REMOTE', limit: 1, offset: 1 }, now).total, remote.total);
    assert.notEqual(repo.listPublic({ mode: 'REMOTE', limit: 1, offset: 1 }, now).data[0].id, remote.data[0].id);
    assert.equal(repo.listPublic({ q: 'garden', maxFee: 0 }, now).data[0].category, 'Environment');
    assert.equal(repo.listPublic({ q: 'nonexistent term' }, now).total, 0);
    assert.throws(() => repo.listPublic({ from: 'not-date' }, now), fails(400));
    assert.throws(() => repo.listPublic({ from: '2031-02-30T01:00:00Z' }, now), fails(400));
    assert.throws(() => repo.listPublic({ from: '2031-05-31', until: '2031-05-01' }, now), fails(400));
    assert.throws(() => repo.listPublic({ maxFee: -1 }, now), fails(400));
  } finally { repo.close(); }
});

test('repaired exceptions can resolve and reopen on recurrence; large valid edits remain supported', () => {
  const repo = createRepository(':memory:');
  try {
    let item = repo.importRecord(record('missing-age'), now).opportunity;
    const issue = repo.listExceptions(now).find(entry => entry.opportunityId === item.id)!;
    assert.equal(repo.updateException(issue.id, {action:'ACKNOWLEDGE',reason:'Checking example facts'},now).status,'ACKNOWLEDGED');
    assert.throws(() => repo.updateException(issue.id,{action:'RESOLVE',reason:'Not repaired yet'},now),fails(409));
    item = repo.editOpportunity(item.id,{expectedVersion:item.version,reason:'Repair synthetic age and description',changes:{minAge:16,summary:'Synthetic description. '.repeat(70)}},now);
    assert.equal(repo.updateException(issue.id,{action:'RESOLVE',reason:'Age now supplied'},now).status,'RESOLVED');
    item = repo.editOpportunity(item.id,{expectedVersion:item.version,reason:'Demonstrate recurrence',changes:{minAge:null}},now);
    assert.equal(repo.listExceptions(now).find(entry=>entry.id===issue.id)?.status,'OPEN');
    assert.equal(repo.getPublic(item.id,now),null);
  } finally { repo.close(); }
});

test('additive migration preserves a legacy published record and audit history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'comground-legacy-'));
  const filename = join(directory, 'legacy.sqlite'); const legacy = new DatabaseSync(filename);
  const fixture = record('garden');
  legacy.exec(`CREATE TABLE sources(id TEXT PRIMARY KEY,record_json TEXT NOT NULL);
    CREATE TABLE organizations(id TEXT PRIMARY KEY,record_json TEXT NOT NULL);
    CREATE TABLE opportunities(id TEXT PRIMARY KEY,source_id TEXT,organization_id TEXT,external_id TEXT,version INTEGER,status TEXT,record_json TEXT,content_hash TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE import_runs(id TEXT PRIMARY KEY,opportunity_id TEXT,source_id TEXT,content_hash TEXT,result TEXT,at TEXT);
    CREATE TABLE review_events(id TEXT PRIMARY KEY,opportunity_id TEXT,decision TEXT,reason TEXT,at TEXT,version INTEGER);`);
  legacy.prepare('INSERT INTO sources VALUES(?,?)').run(fixture.source.id, JSON.stringify(fixture.source));
  legacy.prepare('INSERT INTO organizations VALUES(?,?)').run(fixture.organization.id, JSON.stringify(fixture.organization));
  legacy.prepare('INSERT INTO opportunities VALUES(?,?,?,?,?,?,?,?,?,?)').run('legacy-id', fixture.source.id, fixture.organization.id, fixture.externalId, 2, 'PUBLISHED', JSON.stringify(fixture), 'legacy-hash', now.toISOString(), now.toISOString());
  legacy.prepare('INSERT INTO import_runs VALUES(?,?,?,?,?,?)').run('legacy-run', 'legacy-id', fixture.source.id, 'legacy-hash', 'CREATED', now.toISOString());
  legacy.prepare('INSERT INTO review_events VALUES(?,?,?,?,?,?)').run('legacy-review', 'legacy-id', 'PUBLISH', 'Legacy synthetic review', now.toISOString(), 1);
  legacy.close();
  const repo = createRepository(filename);
  try {
    assert.equal(repo.getPublic('legacy-id', now)?.title, fixture.title);
    assert.equal(repo.getPublic('legacy-id', now, 'primary')?.startsAt, fixture.startsAt);
    assert.equal(repo.getPublic('legacy-id', now, 'missing'), null);
    assert.equal(repo.getPublicSnapshot('legacy-id')?.title, fixture.title);
    assert.equal(repo.getPublicSnapshot('legacy-id')?.occurrenceId, 'primary');
    assert.equal(repo.getPublicSnapshot('legacy-id', 'missing'), null);
    assert.equal(repo.getAdmin('legacy-id', now)?.reviewEvents[0].reason, 'Legacy synthetic review');
    assert.deepEqual(repo.getAdmin('legacy-id', now)?.revisions, [], 'migration must not invent lost historical facts');
    assert.equal(repo.listImportRuns().length, 1); assert.equal(repo.seedDemo(records, now), false);
    const inspect = new DatabaseSync(filename);
    assert.throws(() => inspect.exec("UPDATE import_runs SET result='CHANGED'"), /append-only/);
    assert.throws(() => inspect.exec('DELETE FROM review_events'), /append-only/);
    const edited = repo.editOpportunity('legacy-id', { expectedVersion: 2, reason: 'Record the first retained edit', changes: { minAge: 18 } }, now);
    assert.equal(edited.revisions.length, 1);
    assert.equal(edited.revisions[0].before?.minAge, 16);
    assert.equal(edited.revisions[0].after.minAge, 18);
    assert.throws(() => inspect.exec('DELETE FROM catalogue_revisions'), /append-only/);
    assert.throws(() => inspect.exec("UPDATE catalogue_revisions SET after_json='{}'"), /append-only/);
    assert.throws(() => inspect.exec('DELETE FROM published_occurrence_snapshots'), /append-only/);
    assert.throws(() => inspect.exec("UPDATE published_occurrence_snapshots SET snapshot_json='{}'"), /append-only/);
    inspect.close();
  } finally { repo.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('edits invalidate aggregate requirement evidence without claiming a new fetch or confirmation', () => {
  const repo = createRepository(':memory:');
  const later = new Date('2031-05-02T12:00:00Z');
  try {
    for (const fixtureId of ['pantry', 'garden']) {
      const original = record(fixtureId);
      let item = repo.importRecord(original, now).opportunity;
      item = repo.editOpportunity(item.id, { expectedVersion: item.version, reason: 'Change synthetic participation facts', changes: { minAge: 18, requiresGuardian: !original.requiresGuardian, fee: 5 } }, later);
      for (const field of ['confirmedAt', 'fetchedAt', 'sourceUpdatedAt', 'validUntil'] as const) assert.equal(item.record[field], original[field]);
      assert.equal(item.record.evidence.some(e => ['participation', 'requirements'].includes(e.field)), false);
      assert.equal(item.record.evidence.some(e => e.field === 'minAge' && e.excerpt.includes('18')), true);
      item = repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Review the changed local facts' }, later);
      assert.deepEqual(repo.getPublic(item.id, later)?.evidence, item.record.evidence);
      assert.equal(item.revisions.at(-1)?.before?.evidence.some(e => ['participation', 'requirements'].includes(e.field)), true);
    }
  } finally { repo.close(); }
});

test('expired records remain editable without refreshing their availability', () => {
  const repo = createRepository(':memory:');
  try {
    const original = record('expired');
    let item = repo.importRecord(original, now).opportunity;
    item = repo.editOpportunity(item.id, { expectedVersion: item.version, reason: 'Correct historical label', changes: { title: 'Corrected historical synthetic title' } }, now);
    assert.equal(item.record.title, 'Corrected historical synthetic title');
    assert.equal(item.record.confirmedAt, original.confirmedAt);
    assert.equal(item.record.validUntil, original.validUntil);
    assert.equal(item.effectiveStatus, 'EXPIRED');
    assert.throws(() => repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Must remain blocked' }, now), fails(422));
    assert.equal(repo.getPublic(item.id, now), null);
  } finally { repo.close(); }
});

test('all fact revisions survive repeated edits, fixture changes, publication and database reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'comground-revisions-'));
  const filename = join(directory, 'test.sqlite'); let repo = createRepository(filename);
  try {
    let item = repo.importRecord(record('garden'), now).opportunity;
    item = repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Initial review' }, now);
    item = repo.editOpportunity(item.id, { expectedVersion: item.version, reason: 'First age change', changes: { minAge: 17 } }, now);
    item = repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Review first change' }, now);
    item = repo.importRecord(record('garden-changed'), now).opportunity;
    item = repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Review fixture change' }, now);
    assert.deepEqual(item.revisions.map(r => [r.version, r.before?.minAge ?? null, r.after.minAge]), [[1, null, 16], [3, 16, 17], [5, 17, 18]]);
    assert.deepEqual(item.revisions.map(r => r.action), ['IMPORT', 'EDIT', 'IMPORT']);
    assert.ok(changedRevisionFields(item.revisions[2]).includes('minAge'));
    assert.ok(changedRevisionFields(item.revisions[2]).includes('evidence'));
    assert.equal(repo.getPublicSnapshot(item.id)?.minAge, 18);
    const before = item.revisions;
    assert.equal(repo.importRecord(record('garden-changed'), now).opportunity.revisions.length, 3, 'unchanged replays do not invent fact changes');
    assert.throws(() => repo.editOpportunity(item.id, { expectedVersion: 1, reason: 'Stale revision must not append', changes: { minAge: 19 } }, now), fails(409));
    repo.close(); repo = createRepository(filename);
    assert.deepEqual(repo.getAdmin(item.id, now)?.revisions, before);
  } finally { repo.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('review status filters keep rejected cancelled and expired records discoverable', () => {
  const repo = createRepository(':memory:');
  try {
    for (const fixtureId of ['cancelled', 'expired']) {
      let item = repo.importRecord(record(fixtureId), now).opportunity;
      assert.equal(matchesCatalogueStatus(item, 'DRAFT'), true);
      item = repo.review(item.id, { expectedVersion: item.version, decision: 'REJECT', reason: 'Reject unavailable occurrence' }, now);
      assert.equal(matchesCatalogueStatus(item, 'REJECTED'), true);
      assert.equal(matchesCatalogueStatus(item, fixtureId === 'cancelled' ? 'CANCELLED' : 'EXPIRED'), true);
      assert.equal(matchesCatalogueStatus(item, 'DRAFT'), false);
    }
  } finally { repo.close(); }
});

test('public catalogue ordering uses instants across offsets, including equivalent-time tie breaks', () => {
  const repo = createRepository(':memory:');
  try {
    assert.equal(utcDateTimeInput('2031-05-03T09:00:00+02:00'), '2031-05-03T07:00');
    const input = record('garden');
    for (const [externalId, startsAt, endsAt] of [
      ['later-utc', '2031-05-03T08:00:00Z', '2031-05-03T09:00:00Z'],
      ['earlier-offset', '2031-05-03T09:00:00+02:00', '2031-05-03T10:00:00+02:00'],
      ['equivalent-utc', '2031-05-03T07:00:00Z', '2031-05-03T08:00:00Z'],
    ]) {
      const item = repo.importRecord({ ...input, externalId, startsAt, endsAt }, now).opportunity;
      repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Synthetic offset test' }, now);
    }
    const data = repo.listPublic({ limit: 50 }, now).data;
    assert.deepEqual(data.map(item => Date.parse(item.startsAt)), [Date.parse('2031-05-03T07:00:00Z'), Date.parse('2031-05-03T07:00:00Z'), Date.parse('2031-05-03T08:00:00Z')]);
    assert.equal(data[0].id.localeCompare(data[1].id) < 0, true);
    assert.equal(repo.listPublic({ limit: 1, offset: 2 }, now).data[0].id, data[2].id);
  } finally { repo.close(); }
});

test('stale exception acknowledgement cannot overwrite resolution and decision history survives recurrence', () => {
  const repo = createRepository(':memory:');
  try {
    let item = repo.importRecord(record('missing-age'), now).opportunity;
    const issue = repo.listExceptions(now).find(entry => entry.opportunityId === item.id)!;
    repo.updateException(issue.id, { action: 'ACKNOWLEDGE', reason: 'Investigate missing age' }, now);
    item = repo.editOpportunity(item.id, { expectedVersion: item.version, reason: 'Repair missing age', changes: { minAge: 16 } }, now);
    const resolved = repo.updateException(issue.id, { action: 'RESOLVE', reason: 'Age repaired' }, now);
    assert.throws(() => repo.updateException(issue.id, { action: 'ACKNOWLEDGE', reason: 'Stale tab acknowledgement' }, now), fails(409));
    assert.deepEqual(repo.updateException(issue.id, { action: 'RESOLVE', reason: 'Repeated resolution' }, now), resolved);
    assert.deepEqual(resolved.decisions.map(d => d.action), ['ACKNOWLEDGE', 'RESOLVE']);
    repo.editOpportunity(item.id, { expectedVersion: item.version, reason: 'Demonstrate recurrence', changes: { minAge: null } }, now);
    const reopened = repo.listExceptions(now).find(entry => entry.id === issue.id)!;
    assert.equal(reopened.status, 'OPEN');
    assert.deepEqual(reopened.decisions.map(d => d.action), ['ACKNOWLEDGE', 'RESOLVE', 'REOPEN']);
  } finally { repo.close(); }
});

test('seeding is once-only, respects existing records and preserves historical snapshots', () => {
  const directory = mkdtempSync(join(tmpdir(), 'comground-seed-'));
  const filename = join(directory, 'test.sqlite'); let repo = createRepository(filename);
  try {
    assert.equal(repo.seedDemo(records, now), true);
    const history = repo.getHistoricalSnapshot('synthetic-past-reading-001');
    assert.ok(history); assert.equal(repo.getPublic(history.id, now), null);
    const count = repo.listReview().length; const runs = repo.listImportRuns().length;
    repo.close(); repo = createRepository(filename);
    assert.equal(repo.seedDemo(fixtureList(new Date('2031-05-02T12:00:00Z')), now), false);
    assert.equal(repo.listReview().length, count); assert.equal(repo.listImportRuns().length, runs);
    assert.ok(repo.listOrganizations().every(org => org.verification === 'SYNTHETIC_NOT_VERIFIED'));
    const page = repo.getCommunity('demo-neighborhood', false, now)!;
    assert.equal(page.opportunities.length, 7);
    repo.updateCommunity(page.slug, { expectedVersion: page.version, published: false, reason: 'Pause fictional page' }, now);
    assert.equal(repo.getCommunity(page.slug, false, now), null);
    assert.equal(repo.getCommunity(page.slug, true, now)?.published, false);
  } finally { repo.close(); rmSync(directory, { recursive: true, force: true }); }
  const existing = createRepository(':memory:');
  try { existing.importRecord(record('garden'), now); assert.equal(existing.seedDemo(records, now), false); assert.equal(existing.listReview().length, 1); }
  finally { existing.close(); }
});

test('explicit dates stay one catalogue parent and exact selection never falls back', () => {
  const repo = createRepository(':memory:');
  try {
    const series = record('garden-series');
    let item = repo.importRecord(series, now).opportunity;
    item = repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Review three synthetic dates' }, now);
    assert.equal(repo.listPublic({}, now).total, 1);
    assert.deepEqual(repo.getPublic(item.id, now)?.occurrences?.map(date => date.id), ['primary', 'week-2', 'week-3']);
    assert.equal(repo.getPublic(item.id, now, 'week-2')?.startsAt, series.occurrences![1].startsAt);
    assert.equal(repo.getPublic(item.id, now, 'missing'), null);
    assert.equal(repo.getPublicSnapshot(item.id, 'missing'), null);
    const afterPrimary = new Date(Date.parse(series.occurrences![0].validUntil) + 1);
    assert.equal(repo.getPublic(item.id, afterPrimary)?.occurrenceId, 'week-2');
    assert.equal(repo.getPublic(item.id, afterPrimary, 'primary'), null);
    assert.equal(repo.getAdmin(item.id, afterPrimary)?.effectiveStatus, 'PUBLISHED');
    assert.deepEqual(repo.getPublic(item.id, afterPrimary)?.occurrences?.map(date => date.id), ['week-2', 'week-3']);
    assert.equal(repo.getPublicSnapshot(item.id)?.startsAt, series.occurrences![0].startsAt, 'historical primary keeps its own date');
    assert.equal(repo.getPublicSnapshot(item.id, 'week-2')?.startsAt, series.occurrences![1].startsAt);
    assert.equal(repo.listExceptions(afterPrimary).some(issue => issue.opportunityId === item.id), false);
    assert.equal(repo.listPublic({}, new Date('2031-06-01T00:00:00Z')).total, 0);
  } finally { repo.close(); }
});

test('occurrence date filters select compatible siblings before parent pagination using UTC boundaries', () => {
  const repo = createRepository(':memory:');
  try {
    const series = record('garden-series');
    const laterDay = series.occurrences![1].startsAt.slice(0, 10);
    const imported = [];
    for (const externalId of ['series-first', 'series-second']) {
      const item = repo.importRecord({ ...series, externalId }, now).opportunity;
      repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Review the date filter fixture' }, now);
      imported.push(item.id);
    }
    const early = repo.importRecord(record('garden'), now).opportunity;
    repo.review(early.id, { expectedVersion: early.version, decision: 'PUBLISH', reason: 'Review early single date' }, now);
    const query = { from: laterDay, until: laterDay, limit: 1 };
    const first = repo.listPublic(query, now); const second = repo.listPublic({ ...query, offset: 1 }, now);
    assert.equal(first.total, 2); assert.equal(second.total, 2);
    assert.equal(first.data[0].occurrenceId, 'week-2'); assert.equal(second.data[0].occurrenceId, 'week-2');
    assert.deepEqual([first.data[0].id, second.data[0].id], imported.sort());
    assert.equal(repo.listPublic({ ...query, offset: 2 }, now).data.length, 0);
    assert.equal(repo.listPublic({ from: `${laterDay}T12:00:00+02:00`, until: `${laterDay}T14:00:00+02:00` }, now).total, 2);
    assert.equal(repo.listPublic({ from: `${laterDay}T12:00:01+02:00`, until: laterDay }, now).total, 0);
    assert.equal(repo.listPublic({ from: laterDay, until: `${laterDay}T11:59:59Z` }, now).total, 0);
  } finally { repo.close(); }
});

test('per-date cancellation requires review and retains the last published exact snapshot', () => {
  const repo = createRepository(':memory:');
  try {
    const series = record('garden-series');
    let item = repo.importRecord(series, now).opportunity;
    item = repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Initial dates' }, now);
    const primary = repo.getPublicSnapshot(item.id, 'primary');
    const dates = series.occurrences!.map(date => ({ ...date, isCancelled: date.id === 'primary' }));
    item = repo.editOpportunity(item.id, { expectedVersion: item.version, reason: 'Cancel only the first date', changes: { occurrences: dates } }, now);
    assert.equal(item.status, 'DRAFT'); assert.equal(item.record.isCancelled, false);
    assert.equal(repo.getPublic(item.id, now, 'week-2'), null);
    assert.deepEqual(repo.getPublicSnapshot(item.id, 'primary'), primary);
    item = repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Review independent cancellation' }, now);
    assert.equal(repo.getPublic(item.id, now, 'primary'), null);
    assert.equal(repo.getPublic(item.id, now)?.occurrenceId, 'week-2');
    assert.deepEqual(repo.getPublic(item.id, now)?.occurrences?.map(date => date.id), ['week-2', 'week-3']);
    assert.deepEqual(repo.getPublicSnapshot(item.id, 'primary'), primary);
    assert.equal(repo.getPublicSnapshot(item.id, 'week-2')?.version, item.version);
    item = repo.editOpportunity(item.id, { expectedVersion: item.version, reason: 'Cancel the entire synthetic series', changes: { isCancelled: true } }, now);
    assert.equal(item.record.occurrences![1].isCancelled, false, 'parent cancellation must not rewrite individual row flags');
    assert.equal(item.effectiveStatus, 'CANCELLED');
    assert.throws(() => repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Blocked series publication' }, now), fails(422));
  } finally { repo.close(); }
});

test('catalogue edits reject date removal or renaming without changing published facts or history', () => {
  const repo = createRepository(':memory:');
  try {
    const series = record('garden-series');
    let item = repo.importRecord(series, now).opportunity;
    item = repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Original stable dates' }, now);
    const published = repo.getPublic(item.id, now, 'week-2');
    for (const dates of [
      series.occurrences!.filter(date => date.id !== 'week-2'),
      series.occurrences!.map(date => date.id === 'week-2' ? { ...date, id: 'renamed-date' } : date),
    ]) {
      assert.throws(() => repo.editOpportunity(item.id, { expectedVersion: item.version, reason: 'Attempt to replace a retained ID', changes: { occurrences: dates } }, now),
        (error: unknown) => error instanceof RepositoryError && error.status === 422 && error.code === 'INVALID_OCCURRENCE_TRANSITION');
      assert.deepEqual(repo.getAdmin(item.id, now), item);
      assert.deepEqual(repo.getPublic(item.id, now, 'week-2'), published);
      assert.equal(repo.getPublicSnapshot(item.id, 'renamed-date'), null);
    }
    const unchanged = repo.editOpportunity(item.id, { expectedVersion: item.version, reason: 'Retry unchanged dates', changes: { occurrences: series.occurrences } }, now);
    assert.deepEqual(unchanged, item);
  } finally { repo.close(); }
});

test('changed fixture imports cannot remove dates or mutate shared facts and audit on rejection', () => {
  const repo = createRepository(':memory:');
  try {
    const series = record('garden-series');
    let item = repo.importRecord(series, now).opportunity;
    item = repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Retain imported dates' }, now);
    const sources = repo.listSources(now); const organizations = repo.listOrganizations(); const imports = repo.listImportRuns();
    const historical = repo.getPublicSnapshot(item.id, 'week-2');
    for (const occurrences of [
      undefined,
      series.occurrences!.filter(date => date.id !== 'week-2'),
      series.occurrences!.map(date => date.id === 'week-2' ? { ...date, id: 'replacement-date' } : date),
    ]) {
      assert.throws(() => repo.importRecord({ ...series, occurrences, title: 'Rejected replacement', source: { ...series.source, name: 'Rejected source change' }, organization: { ...series.organization, name: 'Rejected organization change' } }, now),
        (error: unknown) => error instanceof RepositoryError && error.status === 422 && error.code === 'INVALID_OCCURRENCE_TRANSITION');
      assert.deepEqual(repo.getAdmin(item.id, now), item);
      assert.deepEqual(repo.listSources(now), sources); assert.deepEqual(repo.listOrganizations(), organizations);
      assert.deepEqual(repo.listImportRuns(), imports); assert.deepEqual(repo.getPublicSnapshot(item.id, 'week-2'), historical);
    }
  } finally { repo.close(); }
});

test('manual dates survive legacy fixture reimport while retained-ID imports and retries remain supported', () => {
  const repo = createRepository(':memory:');
  try {
    const legacy = record('garden'); const dates = record('garden-series').occurrences!;
    let item = repo.importRecord(legacy, now).opportunity;
    item = repo.editOpportunity(item.id, { expectedVersion: item.version, reason: 'Add dates to a legacy listing', changes: { occurrences: dates } }, now);
    item = repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Review added dates' }, now);
    const repeated = repo.importRecord(item.record, now).opportunity;
    assert.equal(repeated.version, item.version); assert.equal(repeated.status, 'PUBLISHED');
    assert.deepEqual(repeated.revisions, item.revisions);
    assert.throws(() => repo.importRecord(legacy, now),
      (error: unknown) => error instanceof RepositoryError && error.code === 'INVALID_OCCURRENCE_TRANSITION');
    const updated = { ...item.record, title: 'Changed facts with stable dates', occurrences: dates.map(date => ({ ...date, isCancelled: date.id === 'week-2' })) };
    item = repo.importRecord(updated, now).opportunity;
    assert.equal(item.version, repeated.version + 1); assert.equal(item.status, 'DRAFT');
    assert.deepEqual(item.record.occurrences?.map(date => date.id), dates.map(date => date.id));
    assert.equal(item.record.occurrences?.find(date => date.id === 'week-2')?.isCancelled, true);
    const retried = repo.importRecord(updated, now).opportunity;
    assert.equal(retried.version, item.version); assert.deepEqual(retried.revisions, item.revisions);
    assert.throws(() => repo.importRecord({ ...updated, occurrences: updated.occurrences.filter(date => date.id !== 'week-2') }, now),
      (error: unknown) => error instanceof RepositoryError && error.code === 'INVALID_OCCURRENCE_TRANSITION', 'cancellation retains the ID too');
    item = repo.editOpportunity(item.id, { expectedVersion: item.version, reason: 'Legacy primary schedule edit', changes: { startsAt: '2031-05-04T13:00:00Z', endsAt: '2031-05-04T15:00:00Z' } }, now);
    assert.equal(item.record.occurrences?.find(date => date.id === 'primary')?.startsAt, '2031-05-04T13:00:00Z');
    assert.equal(item.record.occurrences?.find(date => date.id === 'week-2')?.isCancelled, true);
  } finally { repo.close(); }
});

test('rescheduling an exact date creates immutable published versions and survives reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'comground-occurrence-'));
  const filename = join(directory, 'test.sqlite'); let repo = createRepository(filename);
  try {
    const series = record('garden-series');
    let item = repo.importRecord(series, now).opportunity;
    item = repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Original dates' }, now);
    const oldSecond = repo.getPublicSnapshot(item.id, 'week-2')!;
    const nextDates = series.occurrences!.map(date => date.id === 'week-2' ? { ...date, startsAt: '2031-05-10T13:00:00Z', endsAt: '2031-05-10T15:00:00Z' } : date);
    item = repo.editOpportunity(item.id, { expectedVersion: item.version, reason: 'Move the same second occurrence', changes: { occurrences: nextDates } }, now);
    assert.deepEqual(repo.getPublicSnapshot(item.id, 'week-2'), oldSecond, 'draft schedules do not leak into activity snapshots');
    item = repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Review rescheduled second date' }, now);
    assert.equal(repo.getPublicSnapshot(item.id, 'week-2')?.startsAt, '2031-05-10T13:00:00Z');
    assert.equal(repo.getPublic(item.id, now, 'primary')?.startsAt, series.startsAt);
    const revisions = item.revisions;
    const inspect = new DatabaseSync(filename);
    const history = inspect.prepare('SELECT snapshot_json FROM published_occurrence_snapshots WHERE opportunity_id=? AND occurrence_id=? ORDER BY version').all(item.id, 'week-2') as { snapshot_json: string }[];
    assert.equal(history.length, 2); assert.deepEqual(JSON.parse(history[0].snapshot_json), oldSecond);
    assert.throws(() => inspect.exec('DELETE FROM published_occurrence_snapshots'), /append-only/); inspect.close();
    repo.close(); repo = createRepository(filename);
    assert.deepEqual(repo.getAdmin(item.id, now)?.revisions, revisions);
    assert.equal(repo.getPublicSnapshot(item.id, 'week-2')?.startsAt, '2031-05-10T13:00:00Z');
    assert.equal(repo.getPublicSnapshot(item.id, 'primary')?.startsAt, series.startsAt);
  } finally { repo.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('occurrence validation rolls back and legacy schedule edits update only primary', () => {
  const repo = createRepository(':memory:');
  try {
    const series = record('garden-series');
    let item = repo.importRecord(series, now).opportunity;
    for (const occurrences of [[], series.occurrences!.slice(1), Array.from({ length: 13 }, (_, i) => ({ ...series.occurrences![0], id: i === 0 ? 'primary' : `date-${i}` }))]) {
      assert.throws(() => repo.editOpportunity(item.id, { expectedVersion: item.version, reason: 'Invalid date set', changes: { occurrences } }, now), fails(422));
      assert.equal(repo.getAdmin(item.id, now)?.version, item.version);
      assert.equal(repo.getAdmin(item.id, now)?.revisions.length, 1);
    }
    item = repo.editOpportunity(item.id, { expectedVersion: item.version, reason: 'Legacy primary schedule correction', changes: { startsAt: '2031-05-03T11:00:00Z', endsAt: '2031-05-03T13:00:00Z' } }, now);
    assert.equal(item.record.occurrences![0].startsAt, item.record.startsAt);
    assert.equal(item.record.startsAt, '2031-05-03T11:00:00Z');
    assert.deepEqual(item.record.occurrences!.slice(1), series.occurrences!.slice(1));
    assert.equal(item.record.confirmedAt, series.confirmedAt);
    assert.equal(item.record.fetchedAt, series.fetchedAt);
  } finally { repo.close(); }
});

test('legacy publication snapshot stays primary after explicit migration with an expired primary', () => {
  const directory = mkdtempSync(join(tmpdir(), 'comground-primary-migration-'));
  const filename = join(directory, 'test.sqlite'); let repo = createRepository(filename);
  try {
    const original = record('garden');
    let item = repo.importRecord(original, now).opportunity;
    item = repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Publish the legacy primary' }, now);
    const oldPrimary = repo.getPublicSnapshot(item.id)!;
    const dates = record('garden-series').occurrences!;
    const afterPrimary = new Date(Date.parse(dates[0].validUntil) + 1);
    item = repo.editOpportunity(item.id, { expectedVersion: item.version, reason: 'Add future dates after first date elapsed', changes: { occurrences: dates } }, afterPrimary);
    item = repo.review(item.id, { expectedVersion: item.version, decision: 'PUBLISH', reason: 'Review only currently available siblings' }, afterPrimary);
    assert.equal(repo.getPublic(item.id, afterPrimary)?.occurrenceId, 'week-2');
    assert.equal(repo.getPublic(item.id, afterPrimary, 'primary'), null);
    assert.deepEqual(repo.getPublicSnapshot(item.id, 'primary'), oldPrimary);
    repo.close(); repo = createRepository(filename);
    assert.deepEqual(repo.getPublicSnapshot(item.id, 'primary'), oldPrimary);
    assert.equal(repo.getPublicSnapshot(item.id, 'week-2')?.occurrenceId, 'week-2');
  } finally { repo.close(); rmSync(directory, { recursive: true, force: true }); }
});
