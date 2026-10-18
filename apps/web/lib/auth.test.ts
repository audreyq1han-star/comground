import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionCookie, hasReviewerSession, validLoginToken, requireReviewer, SESSION_SECONDS } from './auth.ts';
import { assertSameOrigin, assertLoopback, readJson, MAX_JSON_BYTES, apiError } from './http.ts';
import { RepositoryError } from './errors.ts';

const token = 'synthetic-test-token-not-a-real-credential';
function request(headers: Record<string, string> = {}, body?: string) {
  return new Request('http://127.0.0.1:3100/api/admin/session', { method: body ? 'POST' : 'GET', headers: { host: '127.0.0.1:3100', origin: 'http://127.0.0.1:3100', ...headers }, ...(body ? { body } : {}) });
}

test('reviewer cookie is signed, bounded, HttpOnly, and invalid after token rotation', () => {
  const old = process.env.LOCAL_REVIEW_TOKEN;
  process.env.LOCAL_REVIEW_TOKEN = token;
  try {
    assert.equal(validLoginToken(token), true);
    assert.equal(validLoginToken(`${token}x`), false);
    const now = Date.now();
    const setCookie = createSessionCookie(request(), now);
    assert.match(setCookie, /HttpOnly; SameSite=Strict/);
    assert.match(setCookie, /Path=\/api\/admin/);
    const cookie = setCookie.split(';')[0];
    assert.equal(hasReviewerSession(request({ cookie }), now), true);
    assert.equal(hasReviewerSession(request({ cookie }), now + SESSION_SECONDS * 1000 + 1), false);
    assert.equal(hasReviewerSession(request({ cookie: cookie + 'x' }), now), false);
    assert.throws(() => requireReviewer(request()), (e: unknown) => e instanceof RepositoryError && e.status === 401);
    process.env.LOCAL_REVIEW_TOKEN = 'different-synthetic-process-token';
    assert.equal(hasReviewerSession(request({ cookie }), now), false);
  } finally { if (old === undefined) delete process.env.LOCAL_REVIEW_TOKEN; else process.env.LOCAL_REVIEW_TOKEN = old; }
});

test('loopback host and exact Origin are both required for mutations', () => {
  assert.doesNotThrow(() => assertSameOrigin(request()));
  assert.doesNotThrow(() => assertSameOrigin(request({ host: 'localhost:3100', origin: 'http://localhost:3100' })));
  const invalidHeaders: Record<string, string>[] = [{ host: 'attacker.example' }, { host: '127.0.0.1.attacker.example' }, { origin: 'http://localhost:3100' }, { origin: '' }, { 'sec-fetch-site': 'cross-site' }, { host: '127.0.0.1:99999' }];
  for (const headers of invalidHeaders) {
    assert.throws(() => assertSameOrigin(request(headers)), (e: unknown) => e instanceof RepositoryError && e.status === 403);
  }
  assert.throws(() => assertLoopback(new Request('http://localhost:3100/')), (e: unknown) => e instanceof RepositoryError && e.status === 403);
});

test('JSON reader bounds actual bytes and rejects malformed input without exposing details', async () => {
  assert.deepEqual(await readJson(request({ 'content-type': 'application/json' }, '{"fixtureId":"garden"}')), { fixtureId: 'garden' });
  await assert.rejects(readJson(request({ 'content-type': 'application/json' }, '{')), (e: unknown) => e instanceof RepositoryError && e.status === 400);
  await assert.rejects(readJson(request({ 'content-type': 'application/json' }, JSON.stringify({ x: 'x'.repeat(MAX_JSON_BYTES) }))), (e: unknown) => e instanceof RepositoryError && e.status === 413);
  await assert.rejects(readJson(request({ 'content-type': 'text/plain' }, '{}')), (e: unknown) => e instanceof RepositoryError && e.status === 400);
  const error = apiError(new Error('secret database path'));
  assert.equal(error.status, 500);
  assert.equal((await error.text()).includes('secret'), false);
  const earlierModuleError = Object.assign(new Error('Publication requires review.'), { code: 'PUBLICATION_BLOCKED', status: 422, [Symbol.for('comground.RepositoryError')]: true });
  assert.equal(apiError(earlierModuleError).status, 422);
});
