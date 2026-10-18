import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createCommunityStore } from './community-repository.ts';
import { createDistributionStore } from './distribution-repository.ts';
import { createDistributionHandlers } from './distribution-handler-core.ts';
import { RepositoryError } from './errors.ts';
import { getRuntimeConfig } from './runtime-config.ts';
import type { StudentMatches } from '../../../packages/domain/app-contracts.ts';

test('distribution handlers require the correct role, same-origin mutations, and no owner override', async () => {
  const previous = process.env.COMGROUND_MODE; process.env.COMGROUND_MODE = 'demo';
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON; CREATE TABLE student_profiles(persona_id TEXT PRIMARY KEY,profile_json TEXT)');
  for (const owner of ['demo-alex', 'demo-sam']) db.prepare('INSERT INTO student_profiles VALUES(?,?)').run(owner, JSON.stringify({ version: 1 }));
  const store = createDistributionStore(db, { owner: () => ({ exists: true, profileVersion: 1, externalEligible: false }), matches: () => ({ data: [], eligibleCount: 0, profileVersion: 1, engine: 'DETERMINISTIC_RULES', preferences: {} } as unknown as StudentMatches) });
  const communities = createCommunityStore(db);
  const handlers = createDistributionHandlers({ distribution: () => store, communities: () => communities,
    student: request => { if (request.headers.get('authorization') !== 'student') throw new RepositoryError('UNAUTHENTICATED', 401, 'Sign in.'); return 'demo-alex'; },
    operator: request => { if (request.headers.get('authorization') !== 'operator') throw new RepositoryError('FORBIDDEN', 403, 'Operator required.'); return 'demo-reviewer'; },
  });
  function req(path: string, method = 'GET', role = '', body?: unknown, origin = 'http://127.0.0.1:3110') { return new Request(`http://127.0.0.1:3110${path}`, { method, headers: { host: '127.0.0.1:3110', origin, authorization: role, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  try {
    assert.equal((await handlers.getSubscription(req('/api/student/digest'))).status, 401);
    assert.equal((await handlers.getBatches(req('/api/admin/distribution', 'GET', 'student'))).status, 403);
    assert.equal((await handlers.postBatch(req('/api/admin/distribution', 'POST', 'operator', { label: 'Review batch' }, 'https://attacker.invalid'))).status, 403);
    assert.equal((await handlers.putSubscription(req('/api/student/digest', 'PUT', 'student', { enabled: false, expectedVersion: 0, expectedProfileVersion: 1, owner: 'demo-sam' }))).status, 422);
    assert.equal((await handlers.getBatches(req('/api/admin/distribution?owner=demo-alex', 'GET', 'operator'))).status, 400);
    assert.equal((await handlers.getBatches(req('/api/admin/distribution?offset=0&offset=1', 'GET', 'operator'))).status, 400);
    assert.equal((await handlers.getPreview(req('/api/student/digest/preview', 'GET', 'student'))).status, 200);
    const response = await handlers.postBatch(req('/api/admin/distribution', 'POST', 'operator', { label: 'Review batch' }));
    assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store');
    const { data } = await response.json(); assert.equal(data.audit[0].actor, 'demo-reviewer');
    assert.equal((await handlers.postBatch(req('/api/admin/distribution', 'POST', 'operator', { label: 'Review batch', actor: 'invented' }))).status, 422);
    const created = await handlers.postCommunity(req('/api/admin/community-pages', 'POST', 'operator', { slug: 'fictional-club', title: 'Fictional club', description: 'Local example opportunities for students.', channel: 'SCHOOL_CLUB' }));
    assert.equal(created.status, 201);
    assert.equal((await handlers.getPublicCommunity(req('/api/community-pages/fictional-club'), 'fictional-club')).status, 404);
  } finally { db.close(); if (previous === undefined) delete process.env.COMGROUND_MODE; else process.env.COMGROUND_MODE = previous; }
});

test('revoking a session while a mutation body is held prevents every distribution mutation', async () => {
  const previous = process.env.COMGROUND_MODE; process.env.COMGROUND_MODE = 'demo';
  let valid = true, touched = false;
  const handlers = createDistributionHandlers({
    distribution: () => { touched = true; throw new Error('Storage must not be reached.'); },
    communities: () => { touched = true; throw new Error('Storage must not be reached.'); },
    student: () => { if (!valid) throw new RepositoryError('UNAUTHENTICATED', 401, 'Session ended.'); return 'demo-alex'; },
    operator: () => { if (!valid) throw new RepositoryError('UNAUTHENTICATED', 401, 'Session ended.'); return 'demo-reviewer'; },
  });
  try {
    const mutations = [handlers.putSubscription, handlers.postBatch, (req: Request) => handlers.patchBatch(req, 'batch'), handlers.postCommunity, (req: Request) => handlers.patchCommunity(req, 'page'), (req: Request) => handlers.deleteCommunity(req, 'page')];
    for (const mutate of mutations) {
      valid = true; touched = false;
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
      const request = new Request('http://127.0.0.1:3110/api/admin/distribution', { method: 'POST', headers: { host: '127.0.0.1:3110', origin: 'http://127.0.0.1:3110', 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit);
      const pending = mutate(request); valid = false;
      controller.enqueue(new TextEncoder().encode('{}')); controller.close();
      assert.equal((await pending).status, 401); assert.equal(touched, false);
    }
  } finally { if (previous === undefined) delete process.env.COMGROUND_MODE; else process.env.COMGROUND_MODE = previous; }
});

test('production community handlers permit empty reads and reject synthetic writes without changing readiness data', async () => {
  const environment = {
    COMGROUND_MODE: 'production', COMGROUND_ORIGIN: 'https://community-test.invalid',
    COMGROUND_DB_PATH: '/tmp/community-production-handler-test.sqlite',
    COMGROUND_OUTBOX_KEY: Buffer.alloc(32, 8).toString('base64'), COMGROUND_ADULT_POLICY_ACK: 'adult-account-v1',
    COMGROUND_EMAIL_ENABLED: '0', COMGROUND_AI_ENABLED: '0', COMGROUND_TEST_FIXTURES: '0', LOCAL_REVIEW_TOKEN: undefined,
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(environment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  const db = new DatabaseSync(':memory:');
  try {
    const communities = createCommunityStore(db, { mutationsEnabled: getRuntimeConfig().mode !== 'production' });
    const handlers = createDistributionHandlers({ communities: () => communities,
      distribution: () => { throw new Error('Digest storage should not be used.'); },
      student: () => { throw new Error('Student authentication should not be used.'); },
      operator: () => 'account-00000000-0000-4000-8000-000000000001',
    });
    function request(method: string, body?: unknown) { return new Request('https://community-test.invalid/api/admin/community-pages', { method, headers: { host: 'community-test.invalid', origin: 'https://community-test.invalid', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    const read = await handlers.getCommunities(request('GET'));
    assert.equal(read.status, 200); assert.equal((await read.json()).data.total, 0);
    const create = await handlers.postCommunity(request('POST', { slug: 'fictional-club', title: 'Fictional club', description: 'A local synthetic exercise.', channel: 'SCHOOL_CLUB' }));
    assert.equal(create.status, 403); assert.equal((await create.json()).error.code, 'COMMUNITY_EXERCISE_DISABLED');
    assert.equal((await handlers.patchCommunity(request('PATCH', { action: 'APPROVE', expectedVersion: 1 }), 'nonexistent')).status, 403);
    assert.equal((await handlers.deleteCommunity(request('DELETE', { expectedVersion: 1 }), 'nonexistent')).status, 403);
    assert.equal((db.prepare('SELECT COUNT(*) AS total FROM distribution_community_pages').get() as { total: number }).total, 0);
  } finally {
    db.close();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
