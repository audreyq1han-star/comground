import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { StudentMatches } from '../../../packages/domain/app-contracts.ts';
import type { DigestDispatchReference } from '../../../packages/domain/distribution-contracts.ts';
import { fixtureList } from '../../../packages/domain/fixtures.ts';
import { createDistributionStore, exportOwnerDistribution, purgeOwnerDistribution } from './distribution-repository.ts';

const now = new Date('2031-05-01T09:00:00Z'), owner = 'account-11111111-1111-4111-8111-111111111111', actor = 'demo-reviewer';
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE student_profiles(persona_id TEXT PRIMARY KEY,profile_json TEXT NOT NULL)');
  db.prepare('INSERT INTO student_profiles VALUES(?,?)').run(owner, JSON.stringify({ version: 1 }));
  const state = { adult: true, exists: true, version: 1, available: true, opportunityVersion: 1, startsAt: '2031-05-02T12:00:00Z' };
  const item = fixtureList(now)[0].record;
  const queued: { owner: string; reference: DigestDispatchReference }[] = [];
  const store = createDistributionStore(db, {
    owner: () => ({ exists: state.exists, profileVersion: state.exists ? state.version : null, externalEligible: state.exists && state.adult }),
    matches: () => ({ profileVersion: state.version, engine: 'DETERMINISTIC_RULES', eligibleCount: state.available ? 1 : 0, preferences: { secret: 'never copy this' }, data: state.available ? [{ opportunity: { ...item, id: 'public-garden', version: state.opportunityVersion, startsAt: state.startsAt, endsAt: '2031-05-02T14:00:00Z', title: 'Fictional garden session', timezone: 'UTC' }, eligibility: { status: 'ELIGIBLE', reasonCodes: [], reasons: ['sensitive age fact'] }, reasons: ['private profile reason'], rankScore: 1 }] : [] } as unknown as StudentMatches),
    enqueue: (id, reference) => { queued.push({ owner: id, reference }); return { id: `job-${queued.length}` }; },
  });
  const enable = () => store.setSubscription(owner, { enabled: true, expectedVersion: store.subscription(owner).version, expectedProfileVersion: state.version }, now);
  const prepare = () => store.prepareBatch({ label: 'Synthetic weekly review' }, actor, now);
  const approve = () => { const draft = prepare(); return store.updateBatch(draft.id, { action: 'APPROVE', expectedVersion: draft.version }, actor, now); };
  return { db, state, store, queued, enable, prepare, approve };
}
test('digest consent defaults off; minors have private previews but cannot subscribe to external delivery', () => {
  const f = fixture(); try {
    assert.equal(f.store.subscription(owner).enabled, false);
    assert.equal(f.prepare().counts.prepared, 0);
    f.state.adult = false;
    assert.equal(f.store.privatePreview(owner, now).opportunities.length, 1);
    assert.throws(f.enable, { code: 'DIGEST_EXTERNAL_DISABLED' });
    assert.equal(f.queued.length, 0);
  } finally { f.db.close(); }
});
test('reviewed batches expose only public facts and require versioned approval before idempotent enqueue', () => {
  const f = fixture(); try {
    f.enable(); const draft = f.prepare(), serialized = JSON.stringify(draft);
    for (const privateFact of [owner, 'secret', 'sensitive age fact', 'private profile reason']) assert.equal(serialized.includes(privateFact), false);
    assert.equal(draft.counts.prepared, 1); assert.equal(f.queued.length, 0);
    assert.throws(() => f.store.updateBatch(draft.id, { action: 'DISPATCH', expectedVersion: 1 }, actor, now), { code: 'STATE_CONFLICT' });
    assert.throws(() => f.store.updateBatch(draft.id, { action: 'APPROVE', expectedVersion: 2 }, actor, now), { code: 'VERSION_CONFLICT' });
    const approved = f.store.updateBatch(draft.id, { action: 'APPROVE', expectedVersion: 1 }, actor, now);
    assert.equal(approved.audit.at(-1)?.actor, actor);
    f.store.updateBatch(draft.id, { action: 'DISPATCH', expectedVersion: approved.version }, actor, now);
    f.store.updateBatch(draft.id, { action: 'DISPATCH', expectedVersion: approved.version }, actor, now);
    assert.equal(f.queued.length, 1); assert.equal(f.store.dispatchCurrent(owner, f.queued[0].reference, now), true);
    f.store.updateBatch(draft.id, { action: 'CANCEL', expectedVersion: approved.version }, actor, now);
    assert.equal(f.store.dispatchCurrent(owner, f.queued[0].reference, now), false);
  } finally { f.db.close(); }
});
test('withdrawal and re-enrollment cannot resurrect a batch approval or already queued dispatch', () => {
  const f = fixture(); try {
    f.enable(); const batch = f.approve();
    f.store.updateBatch(batch.id, { action: 'DISPATCH', expectedVersion: batch.version }, actor, now);
    f.store.setSubscription(owner, { enabled: false, expectedVersion: 1, expectedProfileVersion: 1 }, now);
    f.enable(); assert.equal(f.store.dispatchCurrent(owner, f.queued[0].reference, now), false);
    assert.equal(f.store.batch(batch.id).counts.prepared, 0);
    assert.deepEqual(exportOwnerDistribution(f.db, owner).batches, []);
  } finally { f.db.close(); }
});
test('dispatch recomputes current publication, exact dates, profile and approval expiry', () => {
  for (const change of ['available', 'date', 'version', 'profile', 'adult', 'expiry'] as const) {
    const f = fixture(); try {
      f.enable(); const batch = f.approve();
      if (change === 'available') f.state.available = false;
      if (change === 'date') f.state.startsAt = '2031-05-02T13:00:00Z';
      if (change === 'version') f.state.opportunityVersion++;
      if (change === 'profile') f.state.version++;
      if (change === 'adult') f.state.adult = false;
      const at = change === 'expiry' ? new Date(now.getTime() + 86400000) : now;
      const reference = { batchId: batch.id, batchVersion: batch.version, subscriptionVersion: 1, profileVersion: 1 };
      assert.equal(f.store.dispatchCurrent(owner, reference, at), false, change);
      if (change !== 'expiry') f.store.updateBatch(batch.id, { action: 'DISPATCH', expectedVersion: batch.version }, actor, at);
      assert.equal(f.queued.length, 0, change);
    } finally { f.db.close(); }
  }
});
test('owned export, purge, cascade deletion and retention erase recipient associations', () => {
  const f = fixture(); try {
    f.enable(); f.prepare(); assert.equal(exportOwnerDistribution(f.db, owner).batches.length, 1);
    assert.deepEqual(exportOwnerDistribution(f.db, 'another-owner').batches, []);
    purgeOwnerDistribution(f.db, owner); assert.equal(exportOwnerDistribution(f.db, owner).batches.length, 0);
    f.enable(); f.prepare(); f.db.prepare('DELETE FROM student_profiles WHERE persona_id=?').run(owner);
    assert.equal(exportOwnerDistribution(f.db, owner).subscription.enabled, false);
    assert.equal(exportOwnerDistribution(f.db, owner).batches.length, 0);
    f.store.prune(new Date(now.getTime() + 31 * 86400000));
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM digest_batches').get() as { n: number }).n, 0);
  } finally { f.db.close(); }
});
