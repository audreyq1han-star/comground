import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudentCookie, clearStudentCookie, studentIdentity, persona, requireStudent, STUDENT_SESSION_SECONDS } from './student-auth.ts';
import { createSessionCookie, hasReviewerSession } from './auth.ts';
const now = Date.parse('2026-10-17T12:00:00Z');
function request(cookie = '') { return new Request('http://127.0.0.1:3100/api/student/profile', { headers: { host: '127.0.0.1:3100', cookie } }); }
function pair(cookie: string) { return cookie.split(';')[0]; }
test('student cookie has isolated path, HttpOnly and strict same-site with a fixed recognized persona', () => {
  const cookie = createStudentCookie(request(), 'demo-alex', now, 'only-test-key');
  assert.match(cookie, /Path=\/api\/student/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.equal(studentIdentity(request(pair(cookie)), now, 'only-test-key'), 'demo-alex');
  assert.equal(studentIdentity(request(pair(cookie)), now, 'rotated-test-key'), null);
  assert.equal(studentIdentity(request(pair(cookie)), now + STUDENT_SESSION_SECONDS * 1000, 'only-test-key'), null);
  assert.equal(studentIdentity(request(pair(cookie)), now - 1000, 'only-test-key'), null);
});
test('tampered, truncated, wrong-persona, duplicated-segment and missing student sessions cannot authenticate', () => {
  const cookie = pair(createStudentCookie(request(), 'demo-sam', now, 'test-key'));
  for (const invalid of ['', cookie.slice(0, -8), cookie + '.extra', cookie.replace('comground_student', 'comground_reviewer'), 'comground_student=invalid.signature']) assert.equal(studentIdentity(request(invalid), now, 'test-key'), null);
  assert.throws(() => persona('not-a-persona'), { code: 'INVALID_PERSONA' });
  assert.throws(() => requireStudent(request()), { code: 'UNAUTHENTICATED' });
  assert.throws(() => requireStudent(request('comground_student=invalid')), { code: 'INVALID_SESSION' });
  assert.match(clearStudentCookie(request()), /Max-Age=0/);
});
test('reviewer credentials and student identity do not cross role boundaries', () => {
  const old = process.env.LOCAL_REVIEW_TOKEN; process.env.LOCAL_REVIEW_TOKEN = 'synthetic-unit-review-token';
  try {
    const reviewer = pair(createSessionCookie(request(), now));
    assert.equal(studentIdentity(request(reviewer), now, 'test-key'), null);
    const student = pair(createStudentCookie(request(), 'demo-alex', now, 'test-key'));
    assert.equal(hasReviewerSession(request(student), now), false);
    assert.equal(studentIdentity(request(reviewer.replace('comground_reviewer', 'comground_student')), now, 'synthetic-unit-review-token'), null);
    assert.equal(hasReviewerSession(request(student.replace('comground_student', 'comground_reviewer')), now), false);
  } finally { if (old === undefined) delete process.env.LOCAL_REVIEW_TOKEN; else process.env.LOCAL_REVIEW_TOKEN = old; }
});
