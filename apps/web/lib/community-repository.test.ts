import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createCommunityStore } from './community-repository.ts';

const input = { slug: 'fictional-school-club', title: 'Fictional school club', description: 'Explore manually reviewed example volunteering opportunities.', channel: 'SCHOOL_CLUB' };
const actor = 'demo-reviewer';
test('community pages require explicit review, reset approval on edit, pause and archive with versions', () => {
  const db = new DatabaseSync(':memory:'), store = createCommunityStore(db); try {
    const draft = store.create(input, actor);
    assert.equal(draft.state, 'DRAFT'); assert.equal(draft.partnerVerified, false); assert.equal(draft.isSynthetic, true);
    assert.throws(() => store.publicBySlug(input.slug), { code: 'NOT_FOUND' });
    const approved = store.update(draft.id, { action: 'APPROVE', expectedVersion: 1 }, actor);
    assert.equal(store.publicBySlug(input.slug).disclosure, 'Synthetic example — no school, community or organizer partnership is claimed.');
    assert.equal('audit' in store.publicBySlug(input.slug), false);
    assert.equal(store.campaigns(true)[0].id, draft.id);
    assert.throws(() => store.update(draft.id, { action: 'PAUSE', expectedVersion: 1 }, actor), { code: 'VERSION_CONFLICT' });
    assert.throws(() => store.remove(draft.id, { expectedVersion: 2 }, actor), { code: 'STATE_CONFLICT' });
    const edited = store.update(draft.id, { ...input, title: 'Another fictional club', action: 'EDIT', expectedVersion: approved.version }, actor);
    assert.equal(edited.state, 'DRAFT'); assert.equal(store.campaigns(true).length, 0);
    const again = store.update(draft.id, { action: 'APPROVE', expectedVersion: edited.version }, actor);
    const paused = store.update(draft.id, { action: 'PAUSE', expectedVersion: again.version }, actor);
    assert.throws(() => store.publicBySlug(input.slug), { code: 'NOT_FOUND' });
    assert.equal(store.campaigns()[0].paused, true); assert.equal(paused.audit.at(-1)?.actor, actor);
    store.remove(draft.id, { expectedVersion: paused.version }, actor); assert.equal(store.list().total, 1);
    assert.equal(store.get(draft.id).state, 'ARCHIVED'); assert.equal(store.get(draft.id).audit.at(-1)?.action, 'ARCHIVE');
    assert.throws(() => store.update(draft.id, { ...input, action: 'EDIT', expectedVersion: store.get(draft.id).version }, actor), { code: 'STATE_CONFLICT' });
  } finally { db.close(); }
});
test('community copy cannot invent relationships and content cannot bypass the review step', () => {
  const db = new DatabaseSync(':memory:'), store = createCommunityStore(db); try {
    for (const title of ['Official school club', 'Our partner school', 'Sponsored activities', '<b>Fictional</b>']) assert.throws(() => store.create({ ...input, title }, actor));
    const draft = store.create(input, actor);
    assert.throws(() => store.create(input, actor), { code: 'SLUG_CONFLICT' });
    assert.throws(() => store.create({ ...input, slug: 'safe-slug', partnerVerified: true }, actor), { code: 'INVALID_INPUT' });
    assert.throws(() => store.update(draft.id, { action: 'APPROVE', expectedVersion: 1, title: 'Unreviewed title' }, actor), { code: 'INVALID_INPUT' });
    assert.equal(store.list(0, 1).items.length, 1);
  } finally { db.close(); }
});
test('production community policy permits empty reads and prevents every synthetic mutation without writes', () => {
  const db = new DatabaseSync(':memory:'), store = createCommunityStore(db, { mutationsEnabled: false }); try {
    assert.deepEqual(store.list().items, []);
    assert.throws(() => store.create(input, actor), { code: 'COMMUNITY_EXERCISE_DISABLED' });
    assert.throws(() => store.update('missing', { action: 'APPROVE', expectedVersion: 1 }, actor), { code: 'COMMUNITY_EXERCISE_DISABLED' });
    assert.throws(() => store.remove('missing', { expectedVersion: 1 }, actor), { code: 'COMMUNITY_EXERCISE_DISABLED' });
    assert.equal((db.prepare('SELECT COUNT(*) AS total FROM distribution_community_pages').get() as { total: number }).total, 0);
  } finally { db.close(); }
});
test('community bounds retain audit history and leave a final path to pause and archive', () => {
  const db = new DatabaseSync(':memory:'), store = createCommunityStore(db); try {
    let page = store.create(input, actor);
    while (page.audit.length < 100) page = store.update(page.id, { action: page.state === 'DRAFT' ? 'APPROVE' : 'DRAFT', expectedVersion: page.version }, actor);
    assert.equal(page.state, 'APPROVED');
    assert.throws(() => store.update(page.id, { action: 'DRAFT', expectedVersion: page.version }, actor), { code: 'COMMUNITY_REVIEW_LIMIT' });
    const paused = store.update(page.id, { action: 'PAUSE', expectedVersion: page.version }, actor);
    assert.throws(() => store.update(page.id, { action: 'APPROVE', expectedVersion: paused.version }, actor), { code: 'COMMUNITY_REVIEW_LIMIT' });
    store.remove(page.id, { expectedVersion: paused.version }, actor);
    assert.equal(store.get(page.id).audit.length, 102); assert.equal(store.get(page.id).state, 'ARCHIVED');
    for (let index = 1; index < 1000; index++) store.create({ ...input, slug: `fictional-club-${index}` }, actor);
    assert.throws(() => store.create({ ...input, slug: 'fictional-limit' }, actor), { code: 'COMMUNITY_LIMIT' });
    assert.equal(store.list().total, 1000);
  } finally { db.close(); }
});
