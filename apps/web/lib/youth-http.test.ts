import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { IdentityNotification } from '../../../packages/domain/identity-contracts.ts';
import { createAccountRepository } from './account-repository.ts';
import { bindDatabaseMode } from './database-mode.ts';
import { accounts } from './account-runtime.ts';
import { exportAccountData, getAccountSession, loginAccount, registerAccount } from './account-handlers.ts';
import { createYouthReview, decideYouthReview, getYouthAccess, listYouthReviews, withdrawYouthReview } from './youth-handlers.ts';

test('youth HTTP workflow binds owner/reviewer, rejects forged authority, and refreshes admission on revocation', async () => {
  const previous = { ...process.env }, folder = mkdtempSync(join(tmpdir(), 'comground-youth-http-')), file = join(folder, 'test.sqlite');
  const origin = 'http://localhost:3191', password = 'Synthetic HTTP test passphrase';
  const messages: IdentityNotification[] = [];
  let fixture: ReturnType<typeof createAccountRepository> | undefined;
  try {
    for (const key of Object.keys(process.env)) if (key.startsWith('COMGROUND_') || key === 'LOCAL_REVIEW_TOKEN') delete process.env[key];
    Object.assign(process.env, { COMGROUND_MODE: 'test', COMGROUND_ORIGIN: origin, COMGROUND_DB_PATH: file, COMGROUND_OUTBOX_KEY: randomBytes(32).toString('base64'), COMGROUND_TEST_FIXTURES: '1' });
    bindDatabaseMode(file, 'test');
    fixture = createAccountRepository(file, { runtimeMode: 'test', syntheticYouthEnabled: true, notificationSink: (_db, message) => messages.push(message), beforeDelete() {} });
    const request = (path: string, body?: unknown, cookie?: string, method = body === undefined ? 'GET' : 'POST', source = origin) => new Request(`${origin}/api/account/${path}`, { method, headers: { host: 'localhost:3191', origin: source, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const signIn = async (email: string) => { const response = await loginAccount(request('session', { email, password })); assert.equal(response.status, 200); return response.headers.get('set-cookie')!.split(';')[0]; };
    await fixture.register({ email: 'reviewer@example.invalid', password, adultConfirmed: true });
    await fixture.verifyEmail({ token: messages[0].token, password });
    const reviewerCookie = await signIn('reviewer@example.invalid');
    const adult = (await (await getAccountSession(request('session', undefined, reviewerCookie))).json()).account;
    const teenEmail = 'teen@example.invalid';
    assert.equal((await registerAccount(request('register', { email: teenEmail, password, ageBand: 'TEEN_13_17', synthetic: true }))).status, 202);
    const teenCookie = await signIn(teenEmail);
    assert.equal((await getYouthAccess(request('youth'))).status, 401);
    assert.equal((await getYouthAccess(request('youth?accountId=other', undefined, teenCookie))).status, 400);
    assert.equal((await createYouthReview(request('youth/requests', { route: 'GUARDIAN', policyVersion: 'teen-local-v1', reviewerId: adult.id }, teenCookie))).status, 422);
    assert.equal((await createYouthReview(request('youth/requests', { route: 'GUARDIAN', policyVersion: 'teen-local-v1' }, teenCookie, 'POST', 'https://other.invalid'))).status, 403);
    let response = await createYouthReview(request('youth/requests', { route: 'GUARDIAN', policyVersion: 'teen-local-v1' }, teenCookie));
    assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store');
    const review = (await response.json()).data;
    const decision = { expectedVersion: 1, decision: 'APPROVED', policyVersion: 'teen-local-v1' };
    const unassigned = await decideYouthReview(request(`youth/reviews/${review.id}`, decision, reviewerCookie, 'PATCH'), review.id);
    const missing = await decideYouthReview(request('youth/reviews/missing', decision, reviewerCookie, 'PATCH'), 'missing');
    assert.equal(unassigned.status, 404); assert.deepEqual(await unassigned.json(), await missing.json());
    assert.deepEqual((await (await listYouthReviews(request('youth/reviews', undefined, reviewerCookie))).json()).data, []);
    const assignment = JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('../../../scripts/youth-test-assign.mjs', import.meta.url)), review.id, adult.id], { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } }));
    assert.equal(assignment.synthetic, true); assert.equal(assignment.request.version, 2); assert.equal(JSON.stringify(assignment).includes(adult.id), false);
    const assigned = (await (await listYouthReviews(request('youth/reviews', undefined, reviewerCookie))).json()).data[0];
    assert.equal(assigned.version, 2); assert.equal(JSON.stringify(assigned).includes(teenEmail), false); assert.equal(JSON.stringify(assigned).includes(adult.id), false);
    response = await decideYouthReview(request(`youth/reviews/${review.id}`, decision, reviewerCookie, 'PATCH'), review.id); assert.equal(response.status, 409);
    response = await decideYouthReview(request(`youth/reviews/${review.id}`, { ...decision, expectedVersion: 2 }, reviewerCookie, 'PATCH'), review.id); assert.equal(response.status, 200);
    assert.equal((await (await getAccountSession(request('session', undefined, teenCookie))).json()).account.admission, 'ADMITTED');
    assert.equal((await (await exportAccountData(request('export', undefined, teenCookie))).json()).identity.youth.ownedRequests[0].status, 'APPROVED');
    response = await withdrawYouthReview(request(`youth/requests/${review.id}`, { expectedVersion: 3, action: 'WITHDRAW' }, teenCookie, 'PATCH'), review.id); assert.equal(response.status, 200);
    assert.equal((await (await getAccountSession(request('session', undefined, teenCookie))).json()).account.admission, 'REVIEW_REQUIRED');
    assert.equal((await exportAccountData(request('export', undefined, teenCookie))).status, 200);
    const db = new DatabaseSync(file);
    try { assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='notification_outbox'").get(), undefined, 'Synthetic signup does not initialize or enqueue outbound messages.'); }
    finally { db.close(); }
    process.env.COMGROUND_TEST_FIXTURES = '0';
    assert.equal((await getYouthAccess(request('youth', undefined, teenCookie))).status, 403);
  } finally {
    fixture?.close();
    process.env.COMGROUND_TEST_FIXTURES = '1'; try { accounts().close(); } catch {}
    delete (globalThis as typeof globalThis & { comgroundAccountRepository?: unknown }).comgroundAccountRepository;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous);
    rmSync(folder, { recursive: true, force: true });
  }
});
