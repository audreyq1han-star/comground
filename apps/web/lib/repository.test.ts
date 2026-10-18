import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FixtureRecord } from '../../../packages/domain/contracts.ts';
import { createRepository, RepositoryError } from './repository.ts';

const now = new Date('2030-05-01T12:00:00Z');
const fixture = (): FixtureRecord => ({
  isSynthetic: true,
  source: { id: 'test-source', name: 'Synthetic permitted source', url: 'https://example.invalid/feed', method: 'FIXTURE', permission: 'APPROVED', permissionEvidence: 'Synthetic permission evidence: reviewer only' },
  organization: { id: 'test-org', name: 'Synthetic organization', url: 'https://example.invalid/org' },
  externalId: 'garden', title: 'Synthetic garden project', summary: 'Example record for local tests only.', category: 'Environment', interests: ['outdoors'],
  minAge: 16, maxAge: null, startsAt: '2030-05-04T10:00:00Z', endsAt: '2030-05-04T12:00:00Z', timezone: 'UTC', mode: 'IN_PERSON', area: 'Example area', fee: 0,
  requiresTraining: false, requiresGuardian: false, schoolCreditApproved: false, signupUrl: 'https://example.invalid/signup',
  sourceUpdatedAt: now.toISOString(), fetchedAt: now.toISOString(), confirmedAt: now.toISOString(), validUntil: '2030-05-05T12:00:00Z', isCancelled: false,
  evidence: [{ field: 'minAge', excerpt: 'Example ages 16 and older.', sourceUrl: 'https://example.invalid/feed' }]
});

test('durable idempotent imports, reviewed publication and explicit public data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'comground-db-'));
  const filename = join(directory, 'catalogue.sqlite');
  let repo = createRepository(filename);
  try {
    const first = repo.importRecord(fixture(), now);
    const repeated = repo.importRecord(fixture(), now);
    assert.equal(first.created, true);
    assert.equal(repeated.created, false);
    assert.equal(repeated.opportunity.id, first.opportunity.id);
    assert.notEqual(first.runId, repeated.runId);
    assert.equal(repo.listReview().length, 1);
    assert.equal(repo.listPublic({}, now).total, 0);
    assert.equal(repo.getPublic(first.opportunity.id, now), null);
    const published = repo.review(first.opportunity.id, { expectedVersion: 1, decision: 'PUBLISH', reason: 'Private reviewer note.' }, now);
    assert.equal(published.status, 'PUBLISHED');
    assert.equal(published.version, 2);
    assert.equal(published.reviewEvents.length, 1);
    assert.throws(() => repo.review(first.opportunity.id, { expectedVersion: 1, decision: 'REJECT', reason: 'Stale decision' }, now), (e: unknown) => e instanceof RepositoryError && e.status === 409);
    const publicResult = repo.listPublic({}, now);
    assert.equal(publicResult.total, 1);
    const serialized = JSON.stringify(publicResult);
    for (const privateText of ['permissionEvidence', 'reviewEvents', 'Private reviewer note', 'Synthetic permission evidence', 'externalId']) assert.equal(serialized.includes(privateText), false);
    repo.close();
    repo = createRepository(filename);
    assert.equal(repo.getPublic(first.opportunity.id, now)?.title, fixture().title);
    assert.equal(repo.getAdmin(first.opportunity.id)?.reviewEvents.length, 1);
    const changed = repo.importRecord({ ...fixture(), title: 'Materially changed synthetic event' }, now);
    assert.equal(changed.opportunity.id, first.opportunity.id);
    assert.equal(changed.opportunity.status, 'DRAFT');
    assert.equal(changed.opportunity.version, 3);
    assert.equal(changed.opportunity.reviewEvents.length, 1);
    assert.equal(repo.listPublic({}, now).total, 0);
  } finally { repo.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('read-time expiry and cancellation cannot escape through public queries', () => {
  const repo = createRepository(':memory:');
  try {
    const imported = repo.importRecord(fixture(), now);
    repo.review(imported.opportunity.id, { expectedVersion: 1, decision: 'PUBLISH', reason: 'Reviewed example.' }, now);
    assert.equal(repo.listPublic({}, new Date('2030-05-06T12:00:00Z')).total, 0);
    assert.equal(repo.getPublic(imported.opportunity.id, new Date('2030-05-06T12:00:00Z')), null);
    const cancelled = repo.importRecord({ ...fixture(), isCancelled: true }, now);
    assert.throws(() => repo.review(cancelled.opportunity.id, { expectedVersion: cancelled.opportunity.version, decision: 'PUBLISH', reason: 'Attempt to publish cancelled example.' }, now), (e: unknown) => e instanceof RepositoryError && e.status === 422);
    assert.equal(repo.listPublic({}, now).total, 0);
  } finally { repo.close(); }
});

test('incomplete and revoked records remain review blocked; parameters are bounded', () => {
  const repo = createRepository(':memory:');
  try {
    for (const record of [{ ...fixture(), minAge: null }, { ...fixture(), externalId: 'revoked', source: { ...fixture().source, permission: 'REVOKED' as const } }]) {
      const imported = repo.importRecord(record, now);
      assert.ok(imported.opportunity.issues.length);
      assert.throws(() => repo.review(imported.opportunity.id, { expectedVersion: 1, decision: 'PUBLISH', reason: 'Cannot publish this.' }, now), (e: unknown) => e instanceof RepositoryError && e.status === 422);
    }
    assert.throws(() => repo.listPublic({ limit: 51 }, now), (e: unknown) => e instanceof RepositoryError && e.status === 400);
    assert.throws(() => repo.listPublic({ offset: -1 }, now), (e: unknown) => e instanceof RepositoryError && e.status === 400);
    assert.equal(repo.getPublic("' OR 1=1 --", now), null);
  } finally { repo.close(); }
});


test('operator decisions retain authenticated actor references and exception acknowledgement takes ownership',()=>{
 const repo=createRepository(':memory:');const actor='account-11111111-1111-4111-8111-111111111111';
 try{
  const imported=repo.importRecord(fixture(),now,actor).opportunity;
  assert.equal(imported.auditEvents[0].actor,actor);
  const published=repo.review(imported.id,{expectedVersion:1,decision:'PUBLISH',reason:'Synthetic review'},now,actor);
  assert.equal(published.auditEvents.at(-1)?.actor,actor);
  assert.equal(JSON.stringify(repo.getPublic(imported.id,now)).includes(actor),false);
  repo.updateSource(fixture().source.id,{expectedVersion:1,paused:true,reason:'Synthetic pause'},now,actor);
  const issue=repo.listExceptions(now).find(item=>item.kind==='SOURCE_PAUSED')!;
  const acknowledged=repo.updateException(issue.id,{action:'ACKNOWLEDGE',reason:'I own this local review'},now,actor);
  assert.equal(acknowledged.owner,actor);assert.equal(repo.listExceptions(now).find(item=>item.id===issue.id)?.owner,actor);
  assert.equal(acknowledged.decisions.at(-1)?.actor,actor);
 }finally{repo.close();}
});
