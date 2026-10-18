import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AccountId } from '../../../packages/domain/identity-contracts.ts';
import { accounts } from './account-runtime.ts';
import { safety } from './safety-runtime.ts';
import { getSafetyReports, postSafetyReport, deleteSafetyReport, getOperatorSafetyReports, patchOperatorSafetyReport } from './safety-handlers.ts';

test('safety routes require verified account scope, OPERATOR role, origin and current sessions after body reads', async () => {
  const keys = ['COMGROUND_MODE','COMGROUND_ORIGIN','COMGROUND_DB_PATH','COMGROUND_OUTBOX_KEY','COMGROUND_EMAIL_ENABLED','COMGROUND_AI_ENABLED','COMGROUND_TEST_FIXTURES','COMGROUND_SKIP_DEMO_SEED'];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  const folder = mkdtempSync(join(tmpdir(), 'comground-safety-http-')), filename = join(folder, 'safety.sqlite');
  const origin = 'http://localhost:3114';
  Object.assign(process.env, { COMGROUND_MODE: 'test', COMGROUND_ORIGIN: origin, COMGROUND_DB_PATH: filename, COMGROUND_OUTBOX_KEY: randomBytes(32).toString('base64'), COMGROUND_EMAIL_ENABLED: '0', COMGROUND_AI_ENABLED: '0', COMGROUND_TEST_FIXTURES: '1' });
  delete process.env.COMGROUND_SKIP_DEMO_SEED;
  let db: DatabaseSync | undefined;
  try {
    const identity = accounts(); db = new DatabaseSync(filename); db.exec('PRAGMA foreign_keys=ON');
    const at = new Date().toISOString();
    function account(role: 'STUDENT' | 'OPERATOR', verified = true): AccountId {
      const id: AccountId = `account-${randomUUID()}`;
      db!.prepare('INSERT INTO accounts(id,email_norm,password_hash,role,email_verified_at,adult_attested_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, `${randomUUID()}@example.invalid`, 'synthetic-not-a-password', role, verified ? at : null, at, at, at);
      return id;
    }
    function session(id: AccountId): string {
      const token = randomBytes(32).toString('base64url');
      db!.prepare('INSERT INTO account_sessions(id,token_hash,account_id,created_at,last_seen_at,expires_at,authenticated_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), createHash('sha256').update(token).digest('hex'), id, at, at, new Date(Date.now() + 3600000).toISOString(), at);
      return token;
    }
    const student = account('STUDENT'), other = account('STUDENT'), operator = account('OPERATOR');
    const studentToken = session(student), otherToken = session(other), operatorToken = session(operator), unverified = session(account('STUDENT', false));
    const input = { storageConsent: true, target: { kind: 'PLATFORM' }, category: 'PLATFORM_SAFETY', narrative: 'Synthetic report without a profile.' };
    const request = (path: string, method = 'GET', body?: unknown, token?: string, requestOrigin = origin) => new Request(`${origin}${path}`, { method, headers: { host: 'localhost:3114', origin: requestOrigin, 'content-type': 'application/json', ...(token ? { cookie: `comground_account=${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal((await getSafetyReports(request('/api/student/safety/reports'))).status, 401);
    assert.equal((await postSafetyReport(request('/api/student/safety/reports', 'POST', input, unverified))).status, 403);
    assert.equal((await postSafetyReport(request('/api/student/safety/reports', 'POST', input, studentToken, 'https://other.invalid'))).status, 403);
    assert.equal((await getSafetyReports(request('/api/student/safety/reports?owner=other', 'GET', undefined, studentToken))).status, 400);
    assert.equal((await postSafetyReport(request('/api/student/safety/reports', 'POST', { ...input, owner: other }, studentToken))).status, 422);
    const created = await postSafetyReport(request('/api/student/safety/reports', 'POST', input, studentToken));
    assert.equal(created.status, 201); const report = (await created.json()).data;
    assert.equal(created.headers.get('cache-control'), 'no-store');
    const pendingTeen = account('STUDENT');
    db.prepare('UPDATE accounts SET adult_attested_at=NULL WHERE id=?').run(pendingTeen);
    db.prepare("INSERT INTO account_age(account_id,age_band,synthetic,attested_at) VALUES(?,'TEEN_13_17',1,?)").run(pendingTeen, at);
    const teenToken = session(pendingTeen);
    assert.throws(() => identity.requireSession(teenToken, { role: 'STUDENT' }), { code: 'YOUTH_REVIEW_REQUIRED' });
    const teenCreated = await postSafetyReport(request('/api/student/safety/reports', 'POST', input, teenToken));
    assert.equal(teenCreated.status, 201, 'a verified pending teen may report without a profile or review approval');
    const teenReport = (await teenCreated.json()).data;
    assert.equal((await getSafetyReports(request('/api/student/safety/reports', 'GET', undefined, teenToken))).status, 200);
    assert.equal((await getOperatorSafetyReports(request('/api/admin/safety/reports', 'GET', undefined, teenToken))).status, 403);
    assert.equal((await deleteSafetyReport(request(`/api/student/safety/reports/${teenReport.id}`, 'DELETE', { expectedVersion: 1 }, teenToken), teenReport.id)).status, 200);
    assert.deepEqual((await (await getSafetyReports(request('/api/student/safety/reports', 'GET', undefined, otherToken))).json()).data, []);
    assert.equal((await deleteSafetyReport(request(`/api/student/safety/reports/${report.id}`, 'DELETE', { expectedVersion: 1 }, otherToken), report.id)).status, 404);
    assert.equal((await getOperatorSafetyReports(request('/api/admin/safety/reports', 'GET', undefined, studentToken))).status, 403);
    const queue = await getOperatorSafetyReports(request('/api/admin/safety/reports', 'GET', undefined, operatorToken));
    assert.equal(queue.status, 200); const queueText = await queue.text();
    assert.ok(!queueText.includes(student)); assert.ok(!queueText.includes('@example.invalid')); assert.ok(!queueText.includes('preferences'));
    const update = { expectedVersion: 1, status: 'IN_REVIEW', rationale: 'REVIEW_STARTED' };
    assert.equal((await patchOperatorSafetyReport(request(`/api/admin/safety/reports/${report.id}`, 'PATCH', update, studentToken), report.id)).status, 403);
    const reviewedResponse=await patchOperatorSafetyReport(request(`/api/admin/safety/reports/${report.id}`, 'PATCH', update, operatorToken), report.id);
    assert.equal(reviewedResponse.status,200);const reviewed=(await reviewedResponse.json()).data;
    assert.equal(reviewed.assignedOperatorId,operator);assert.equal(reviewed.events.at(-1).actorId,operator);
    const privateText=await (await getSafetyReports(request('/api/student/safety/reports','GET',undefined,studentToken))).text();
    assert.ok(!privateText.includes(operator));assert.ok(!privateText.includes('actorId'));
    assert.equal((await patchOperatorSafetyReport(request(`/api/admin/safety/reports/${report.id}`,'PATCH',{expectedVersion:2,status:'IN_REVIEW',rationale:'ASSIGNMENT_UPDATED',assignedOperatorId:student},operatorToken),report.id)).status,403);
    assert.equal((await patchOperatorSafetyReport(request(`/api/admin/safety/reports/${report.id}`, 'PATCH', update, operatorToken), report.id)).status, 409);
    for (const item of [
      { token: session(student), method: 'POST', path: '/api/student/safety/reports', body: input, handle: postSafetyReport },
      { token: session(student), method: 'DELETE', path: `/api/student/safety/reports/${report.id}`, body: { expectedVersion: 2 }, handle: (req: Request) => deleteSafetyReport(req, report.id) },
      { token: session(operator), method: 'PATCH', path: `/api/admin/safety/reports/${report.id}`, body: { expectedVersion: 2, status: 'RESOLVED', rationale: 'REVIEW_COMPLETE' }, handle: (req: Request) => patchOperatorSafetyReport(req, report.id) },
    ]) {
      let controller!: ReadableStreamDefaultController<Uint8Array>, reading!: () => void;
      const readStarted = new Promise<void>(resolve => { reading = resolve; });
      const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, pull() { reading(); } }, { highWaterMark: 0 });
      const held = new Request(`${origin}${item.path}`, { method: item.method, headers: { host: 'localhost:3114', origin, 'content-type': 'application/json', cookie: `comground_account=${item.token}` }, body, duplex: 'half' } as RequestInit);
      const before = safety().listQueue(), pending = item.handle(held); await readStarted; identity.logout(item.token);
      controller.enqueue(new TextEncoder().encode(JSON.stringify(item.body))); controller.close();
      assert.equal((await pending).status, 401); assert.deepEqual(safety().listQueue(), before);
    }
    assert.equal((await deleteSafetyReport(request(`/api/student/safety/reports/${report.id}`, 'DELETE', { expectedVersion: 2 }, studentToken), report.id)).status, 200);
    assert.equal(safety().listQueue().length, 0);
  } finally {
    db?.close();
    const state = globalThis as typeof globalThis & { comgroundSafetyRepository?: {repository:{close:()=>void}}; comgroundAccountRepository?: {repository:{close:()=>void}}; comgroundRepository?: {close:()=>void}; comgroundFixtureEpoch?:Date };
    state.comgroundSafetyRepository?.repository.close(); delete state.comgroundSafetyRepository;
    state.comgroundAccountRepository?.repository.close(); delete state.comgroundAccountRepository;
    state.comgroundRepository?.close(); delete state.comgroundRepository; delete state.comgroundFixtureEpoch;
    for (const [key,value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(folder, { recursive: true, force: true });
  }
});
