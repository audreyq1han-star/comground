import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { PublicOpportunity } from '../../../packages/domain/contracts.ts';
import { createSafetyRepository, exportOwnerSafetyData, purgeOwnerSafetyData } from './safety-repository.ts';

const alex = 'account-00000000-0000-0000-0000-000000000001', sam = 'account-00000000-0000-0000-0000-000000000002';
const operator = 'account-00000000-0000-0000-0000-000000000003';
const now = new Date('2026-10-17T09:00:00Z');
const platform = { storageConsent: true, target: { kind: 'PLATFORM' }, category: 'PLATFORM_SAFETY', narrative: 'Synthetic concern only.' };
function setup() {
  const folder = mkdtempSync(join(tmpdir(), 'comground-safety-')), file = join(folder, 'data.sqlite');
  const db = new DatabaseSync(file); db.exec('PRAGMA foreign_keys=ON; CREATE TABLE accounts(id TEXT PRIMARY KEY,role TEXT NOT NULL,email_verified_at TEXT);');
  for (const owner of [alex, sam]) db.prepare('INSERT INTO accounts VALUES(?,?,?)').run(owner, 'STUDENT', now.toISOString());
  db.prepare('INSERT INTO accounts VALUES(?,?,?)').run(operator, 'OPERATOR', now.toISOString());
  const supply = { getPublicSnapshot: (id: string, occurrenceId?: string) => id === 'known' ? { id, occurrenceId: occurrenceId === 'secondary' ? 'secondary' : 'primary', title: 'Synthetic listing', startsAt: '2026-10-18T09:00:00Z', endsAt: '2026-10-18T10:00:00Z', version: 2 } as PublicOpportunity : null };
  const store = createSafetyRepository(file, supply);
  return { db, store, cleanup() { store.close(); db.close(); rmSync(folder, { recursive: true, force: true }); } };
}
test('private reports resolve an exact published date, reject invented targets and do not expose another owner', () => {
  const { store, cleanup } = setup();
  try {
    const created = store.create(alex, { storageConsent: true, target: { kind: 'LISTING', opportunityId: 'known', occurrenceId: 'secondary' }, category: 'UNSAFE_ACTIVITY' }, now);
    assert.equal(created.target.kind, 'LISTING');
    assert.equal(created.target.kind === 'LISTING' && created.target.occurrenceId, 'secondary');
    assert.equal(created.status, 'OPEN'); assert.equal(created.version, 1);
    assert.deepEqual(store.listOwn(sam), []);
    assert.throws(() => store.remove(sam, created.id, { expectedVersion: 1 }), { code: 'NOT_FOUND' });
    for (const occurrenceId of ['missing', '']) assert.throws(() => store.create(alex, { storageConsent: true, target: { kind: 'LISTING', opportunityId: 'known', occurrenceId }, category: 'UNSAFE_ACTIVITY' }, now));
    assert.throws(() => store.create(alex, { storageConsent: true, target: { kind: 'LISTING', opportunityId: 'invented', occurrenceId: 'primary' }, category: 'UNSAFE_ACTIVITY' }, now), { code: 'NOT_FOUND' });
    const queue = store.listQueue(); assert.equal(queue.length, 1);
    for (const forbidden of ['owner','personaId','profile','email','preferences']) assert.equal(forbidden in queue[0], false);
  } finally { cleanup(); }
});
test('schema bounds plain text and strict fields; failed writes leave no report or reporting count', () => {
  const { store, db, cleanup } = setup();
  try {
    for (const input of [{ ...platform, owner: sam }, { ...platform, narrative: 'x'.repeat(501) }, { ...platform, narrative: '<script>bad</script>' }, { ...platform, narrative: 'https://example.invalid' }, { ...platform, category: 'fake' }, { ...platform, target: { kind: 'PLATFORM', opportunityId: 'known' } }]) assert.throws(() => store.create(alex, input, now), { code: 'INVALID_INPUT' });
    assert.equal(store.listQueue().length, 0);
    assert.deepEqual(exportOwnerSafetyData(db, alex), { reports: [], reportingLimit: null });
    assert.throws(() => store.create(alex, { ...platform, storageConsent: false }, now), { code: 'CONSENT_REQUIRED' });
    const report = store.create(alex, platform, now);
    assert.equal(report.narrative, platform.narrative);
  } finally { cleanup(); }
});
test('per-account report and audit caps bound storage; privacy withdrawal purges reports, history and limits', () => {
  const { store, db, cleanup } = setup();
  try {
    const first = store.create(alex, platform, now);
    let report = store.moderate(first.id, { expectedVersion: 1, status: 'IN_REVIEW', rationale: 'REVIEW_STARTED' }, operator, now);
    while (report.version < 50) report = store.moderate(first.id, { expectedVersion: report.version, status: 'IN_REVIEW', rationale: 'REVIEW_CONTINUES' }, operator, now);
    assert.throws(() => store.moderate(first.id, { expectedVersion: 50, status: 'RESOLVED', rationale: 'REVIEW_COMPLETE' }, operator, now), { code: 'STORAGE_LIMIT' });
    for (let i = 1; i < 100; i++) store.create(alex, platform, new Date(now.getTime() + i * 86400000));
    assert.throws(() => store.create(alex, platform, new Date(now.getTime() + 100 * 86400000)), { code: 'STORAGE_LIMIT' });
    assert.equal(exportOwnerSafetyData(db, alex).reports.length, 100);
    const other = store.create(sam, platform, now);
    purgeOwnerSafetyData(db, alex);
    assert.deepEqual(exportOwnerSafetyData(db, alex), { reports: [], reportingLimit: null });
    assert.equal(store.listQueue().length, 1); assert.equal(store.listQueue()[0].id, other.id);
  } finally { cleanup(); }
});
test('moderation records bounded rationales, versions and history; stale decisions and unreviewed quarantine fail', () => {
  const { store, cleanup } = setup();
  try {
    const first = store.create(alex, platform, now);
    assert.throws(() => store.moderate(first.id, { expectedVersion: 1, status: 'RESOLVED', rationale: 'REVIEW_COMPLETE' }, operator, now), { code: 'STATE_CONFLICT' });
    const reviewed = store.moderate(first.id, { expectedVersion: 1, status: 'IN_REVIEW', rationale: 'REVIEW_STARTED' }, operator, now);
    assert.equal(reviewed.version, 2); assert.equal(reviewed.events.length, 2);
    assert.throws(() => store.moderate(first.id, { expectedVersion: 1, status: 'RESOLVED', rationale: 'REVIEW_COMPLETE' }, operator, now), { code: 'VERSION_CONFLICT' });
    assert.throws(() => store.moderate(first.id, { expectedVersion: 2, status: 'RESOLVED', rationale: 'REVIEW_COMPLETE', requestQuarantine: true }, operator, now), { code: 'STATE_CONFLICT' });
    const resolved = store.moderate(first.id, { expectedVersion: 2, status: 'RESOLVED', rationale: 'REVIEW_COMPLETE' }, operator, now);
    assert.equal(resolved.status, 'RESOLVED'); assert.equal(store.listOwn(alex)[0].rationale, 'REVIEW_COMPLETE');
    assert.throws(() => store.remove(alex, first.id, { expectedVersion: 2 }), { code: 'VERSION_CONFLICT' });
    store.remove(alex, first.id, { expectedVersion: 3 }); assert.equal(store.listQueue().length, 0);
  } finally { cleanup(); }
});
test('listing quarantine is an explicit review request and never changes catalogue publication', () => {
  const { store, cleanup } = setup();
  try {
    const first = store.create(alex, { storageConsent: true, target: { kind: 'LISTING', opportunityId: 'known', occurrenceId: 'primary' }, category: 'UNSAFE_ACTIVITY' }, now);
    assert.throws(() => store.moderate(first.id, { expectedVersion: 1, status: 'IN_REVIEW', rationale: 'REVIEW_STARTED', requestQuarantine: true }, operator, now), { code: 'STATE_CONFLICT' });
    const reviewed = store.moderate(first.id, { expectedVersion: 1, status: 'IN_REVIEW', rationale: 'REVIEW_STARTED' }, operator, now);
    const requested = store.moderate(first.id, { expectedVersion: reviewed.version, status: 'IN_REVIEW', rationale: 'QUARANTINE_REVIEW', requestQuarantine: true }, operator, now);
    assert.equal(requested.quarantineRequested, true); assert.equal(requested.events.at(-1)?.quarantineRequested, true);
    assert.equal(requested.target.kind === 'LISTING' && requested.target.listingVersion, 2);
  } finally { cleanup(); }
});
test('delete/recreate loops cannot bypass daily rate limits; counters and audit cascade with the account', () => {
  const { store, db, cleanup } = setup();
  try {
    for (let i = 0; i < 6; i++) { const row = store.create(alex, platform, now); store.remove(alex, row.id, { expectedVersion: 1 }); }
    assert.throws(() => store.create(alex, platform, now), { code: 'RATE_LIMITED' });
    assert.equal(exportOwnerSafetyData(db, alex).reportingLimit?.count, 6);
    const later = store.create(alex, platform, new Date(now.getTime() + 86400000));
    assert.equal(exportOwnerSafetyData(db, alex).reports[0].id, later.id);
    db.prepare('DELETE FROM accounts WHERE id=?').run(alex);
    assert.deepEqual(exportOwnerSafetyData(db, alex), { reports: [], reportingLimit: null });
    assert.equal((db.prepare('SELECT count(*) AS n FROM safety_report_events').get() as {n:number}).n, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { cleanup(); }
});
test('urgency sorts the queue and operator assignment keeps actor references out of owner data',()=>{
  const {store,db,cleanup}=setup();try{
    const routine=store.create(alex,platform,now);
    const urgent=store.create(sam,{...platform,urgency:'IMMEDIATE_DANGER'},now);
    assert.equal(store.listQueue()[0].id,urgent.id);
    assert.throws(()=>store.create(alex,{...platform,urgency:'FAKE'},now),{code:'INVALID_INPUT'});
    const review={expectedVersion:1,status:'IN_REVIEW',rationale:'REVIEW_STARTED'};
    assert.throws(()=>store.moderate(routine.id,review,alex,now),{code:'FORBIDDEN'});
    const started=store.moderate(routine.id,review,operator,now);
    assert.equal(started.assignedOperatorId,operator);assert.equal(started.events[1].actorId,operator);
    assert.equal(started.events[0].actorId,null);
    const assign={expectedVersion:2,status:'IN_REVIEW',rationale:'ASSIGNMENT_UPDATED',assignedOperatorId:sam};
    assert.throws(()=>store.moderate(routine.id,assign,operator,now),{code:'FORBIDDEN'});
    const other='account-00000000-0000-0000-0000-000000000004';
    db.prepare('INSERT INTO accounts VALUES(?,?,?)').run(other,'OPERATOR',now.toISOString());
    const assigned=store.moderate(routine.id,{...assign,assignedOperatorId:other},operator,now);
    assert.equal(assigned.assignedOperatorId,other);assert.equal(assigned.events.at(-1)?.actorId,operator);
    assert.equal(assigned.events.at(-1)?.assignedOperatorId,other);
    assert.throws(()=>store.moderate(routine.id,{...assign,assignedOperatorId:null},operator,now),{code:'VERSION_CONFLICT'});
    const own=JSON.stringify(exportOwnerSafetyData(db,alex));assert.ok(!own.includes(operator));assert.ok(!own.includes(other));assert.ok(!own.includes('actorId'));assert.ok(!own.includes('assignedOperatorId'));
    const queue=JSON.stringify(store.listQueue());assert.ok(!queue.includes(alex));assert.ok(!queue.includes(sam));
    db.prepare("UPDATE accounts SET role='STUDENT' WHERE id=?").run(other);
    assert.throws(()=>store.moderate(routine.id,{...assign,expectedVersion:3,assignedOperatorId:other},operator,now),{code:'FORBIDDEN'});
    assert.throws(()=>store.moderate(routine.id,{expectedVersion:3,status:'RESOLVED',rationale:'REVIEW_COMPLETE'},other,now),{code:'FORBIDDEN'});
  }finally{cleanup();}
});
