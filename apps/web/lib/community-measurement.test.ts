import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createCommunityStore } from './community-repository.ts';
import { createMeasurementStore } from './measurement-repository.ts';

const now = new Date('2031-05-01T09:00:00Z'), actor = 'demo-reviewer';
test('persistent community campaigns are allowlisted only after approval and preserve historical attribution metadata through edits and archival', () => {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON; CREATE TABLE student_profiles(persona_id TEXT PRIMARY KEY,profile_json TEXT)');
  for (const owner of ['demo-alex','demo-sam']) db.prepare('INSERT INTO student_profiles VALUES(?,?)').run(owner, JSON.stringify({ version: 1, consentedAt: now.toISOString() }));
  try {
    const measurement = createMeasurementStore(db, { seedExamples: false }), community = createCommunityStore(db);
    const input = { slug: 'local-fictional-club', title: 'Fictional local school club', description: 'Explore public examples of student volunteering.', channel: 'SCHOOL_CLUB' };
    const draft = community.create(input, actor, now);
    for (const owner of ['demo-alex','demo-sam'] as const) measurement.setConsent(owner, { enabled: true, expectedVersion: 0, expectedProfileVersion: 1 }, now);
    assert.deepEqual(measurement.campaigns(), []);
    assert.throws(() => measurement.attribute('demo-alex', { campaignId: draft.id }, now), { code: 'INVALID_CAMPAIGN' });
    const approved = community.update(draft.id, { action: 'APPROVE', expectedVersion: 1 }, actor, now);
    const first = measurement.attribute('demo-alex', { campaignId: draft.id }, now);
    assert.equal(first.channel, 'SCHOOL_CLUB');
    measurement.recordExposure({ owner: 'demo-alex', requestId: 'first', issuedAt: now.toISOString(), consentVersion: 1, profileVersion: 1, rulesVersion: 'test', items: [{ opportunityId: 'public-date', occurrenceId: 'primary', version: 1 }] }, now);
    const before = db.prepare('SELECT campaign_snapshot_json FROM measurement_exposures').get();
    const edited = community.update(draft.id, { ...input, title: 'Fictional revised community', channel: 'COMMUNITY', action: 'EDIT', expectedVersion: approved.version }, actor, now);
    assert.equal(measurement.campaigns(true).length, 0);
    assert.equal((db.prepare('SELECT paused FROM measurement_campaigns WHERE id=?').get(draft.id) as { paused: number }).paused, 1);
    const again = community.update(draft.id, { action: 'APPROVE', expectedVersion: edited.version }, actor, now);
    assert.equal(measurement.attribute('demo-sam', { campaignId: draft.id }, now).channel, 'COMMUNITY');
    assert.equal(measurement.attribution('demo-alex', now)?.channel, 'SCHOOL_CLUB');
    assert.equal(measurement.exportData('demo-alex', now).attribution?.channel, 'SCHOOL_CLUB');
    assert.deepEqual(db.prepare('SELECT campaign_snapshot_json FROM measurement_exposures').get(), before);
    const paused = community.update(draft.id, { action: 'PAUSE', expectedVersion: again.version }, actor, now);
    community.remove(draft.id, { expectedVersion: paused.version }, actor, now);
    assert.equal(measurement.campaigns(true).length, 0);
    assert.throws(() => measurement.updateCampaign(draft.id, { paused: false, expectedVersion: community.get(draft.id).version }, actor), { code: 'STATE_CONFLICT' });
    assert.equal(measurement.summary(now).channels[0].label, input.title);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});
test('legacy campaign IDs and the neighborhood URL migrate once while empty production stays empty', () => {
  const empty = new DatabaseSync(':memory:'); try { assert.equal(createCommunityStore(empty).list().total, 0); } finally { empty.close(); }
  const db = new DatabaseSync(':memory:'); db.exec("CREATE TABLE community_pages(slug TEXT PRIMARY KEY,published INTEGER,version INTEGER); INSERT INTO community_pages VALUES('demo-neighborhood',1,3); CREATE TABLE measurement_campaigns(id TEXT PRIMARY KEY,paused INTEGER,version INTEGER); INSERT INTO measurement_campaigns VALUES('demo-school-club',1,4),('demo-community',0,2)");
  try {
    const store = createCommunityStore(db);
    assert.equal(store.publicBySlug('demo-neighborhood').id, 'demo-community');
    assert.equal(store.get('demo-school-club').state, 'PAUSED'); assert.equal(store.get('demo-school-club').version, 4);
    assert.equal(store.get('demo-community').audit[0].actor, 'LOCAL_MIGRATION');
    createCommunityStore(db); assert.equal(store.list().total, 2);
  } finally { db.close(); }
});
