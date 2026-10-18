import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAccountStore, requireStudentAccount } from './account-repository.ts';
import type { AccountId, IdentityNotification } from '../../../packages/domain/identity-contracts.ts';
import { YOUTH_POLICY_VERSION } from '../../../packages/domain/youth-contracts.ts';
import type { StudentProfile } from '../../../packages/domain/app-contracts.ts';
import { accountPrivacyInput, createPrivacyStore } from './privacy-store.ts';

const now = new Date('2031-05-01T12:00:00Z');
const password = 'Synthetic local teen passphrase 123';
const teen = 'account-11111111-1111-4111-8111-111111111111' as AccountId;
const reviewer = 'account-22222222-2222-4222-8222-222222222222' as AccountId;
const stranger = 'account-33333333-3333-4333-8333-333333333333' as AccountId;
function setup() {
  const db = new DatabaseSync(':memory:'); const messages: IdentityNotification[] = [];
  const store = createAccountStore(db, { runtimeMode: 'test', syntheticYouthEnabled: true, notificationSink: (_db, value) => messages.push(value), beforeDelete() {} });
  for (const [id, address, adult] of [[teen, 'teen@example.invalid', false], [reviewer, 'reviewer@example.invalid', true], [stranger, 'stranger@example.invalid', true]] as const) {
    db.prepare("INSERT INTO accounts(id,email_norm,password_hash,role,email_verified_at,adult_attested_at,created_at,updated_at) VALUES(?,?,?,'STUDENT',?,?,?,?)").run(id, address, 'fixture-not-a-password', now.toISOString(), adult ? now.toISOString() : null, now.toISOString(), now.toISOString());
    db.prepare('INSERT INTO account_age(account_id,age_band,synthetic,attested_at) VALUES(?,?,?,?)').run(id, adult ? 'ADULT' : 'TEEN_13_17', adult ? 0 : 1, now.toISOString());
  }
  return { db, store, messages, close: () => db.close() };
}
test('minor registration rejects production and unlabelled inputs before allocating account or abuse state', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = createAccountStore(db, { runtimeMode: 'production', syntheticYouthEnabled: true, notificationSink() {} });
    for (const ageBand of ['TEEN_13_17', 'UNDER_13']) await assert.rejects(store.register({ email: 'teen@example.invalid', password, ageBand, synthetic: true }, now));
    for (const table of ['accounts', 'account_age', 'account_abuse']) assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, 0);
  } finally { db.close(); }
});
test('synthetic teen signup is explicit, pending, reserved-address only, and never sends email', async () => {
  const state = setup();
  try {
    for (const input of [{ ageBand: 'TEEN_13_17' }, { ageBand: 'TEEN_13_17', synthetic: false }, { ageBand: 'UNDER_13', synthetic: true }]) await assert.rejects(state.store.register({ email: 'new@example.invalid', password, ...input }, now));
    await assert.rejects(state.store.register({ email: 'new@example.com', password, ageBand: 'TEEN_13_17', synthetic: true }, now), { code: 'SYNTHETIC_IDENTITY_REQUIRED' });
    await state.store.register({ email: 'new@example.invalid', password, ageBand: 'TEEN_13_17', synthetic: true }, now);
    const login = await state.store.login({ email: 'new@example.invalid', password }, now);
    assert.equal(login.state.account?.ageBand, 'TEEN_13_17'); assert.equal(login.state.account?.admission, 'REVIEW_REQUIRED'); assert.equal(login.state.account?.synthetic, true);
    assert.equal(login.state.account?.adultConfirmed, false); assert.equal(state.messages.length, 0);
    assert.throws(() => requireStudentAccount(state.db, login.state.account!.id), { code: 'YOUTH_REVIEW_REQUIRED' });
    assert.throws(() => state.store.requireSession(login.token, { role: 'STUDENT' }, now), { code: 'YOUTH_REVIEW_REQUIRED' });
    assert.doesNotThrow(() => state.store.exportIdentity(login.token, now));
    const request = state.store.youth.request(login.state.account!.id, { route: 'SCHOOL', policyVersion: YOUTH_POLICY_VERSION }, now);
    state.store.youth.assignReviewer(request.id, reviewer, now); state.store.youth.decide(reviewer, request.id, { expectedVersion: 2, decision: 'APPROVED', policyVersion: YOUTH_POLICY_VERSION }, now);
    const paused = createAccountStore(state.db, { runtimeMode: 'test', syntheticYouthEnabled: false, notificationSink() {}, beforeDelete() {} });
    assert.equal(paused.readSession(login.token, now).account?.admission, 'REVIEW_REQUIRED');
    assert.throws(() => paused.requireSession(login.token, { role: 'STUDENT' }, now), { code: 'YOUTH_REVIEW_REQUIRED' });
    assert.doesNotThrow(() => paused.exportIdentity(login.token, now), 'Pausing the synthetic workflow preserves owner export.');
    paused.deleteAccount(login.token, now); assert.equal(state.store.getAccount(login.state.account!.id), null);
  } finally { state.close(); }
});
test('scoped offline assignment, versioned decisions and withdrawal gate teen admission with minimal DTOs', () => {
  const { db, store, close } = setup();
  try {
    const request = store.youth.request(teen, { route: 'GUARDIAN', policyVersion: YOUTH_POLICY_VERSION }, now);
    assert.throws(() => store.youth.request(teen, { route: 'SCHOOL', policyVersion: YOUTH_POLICY_VERSION }, now), { code: 'REVIEW_STATE_CONFLICT' });
    assert.deepEqual(store.youth.reviews(reviewer), []);
    assert.throws(() => store.youth.decide(stranger, request.id, { expectedVersion: 1, decision: 'APPROVED', policyVersion: YOUTH_POLICY_VERSION }, now), { code: 'REVIEW_NOT_FOUND' });
    assert.throws(() => store.youth.assignReviewer(request.id, teen, now), { code: 'REVIEWER_REQUIRED' });
    const assigned = store.youth.assignReviewer(request.id, reviewer, now);
    assert.equal(assigned.version, 2);
    assert.throws(() => store.youth.decide(reviewer, request.id, { expectedVersion: 1, decision: 'APPROVED', policyVersion: YOUTH_POLICY_VERSION }, now), { code: 'VERSION_CONFLICT' });
    const approved = store.youth.decide(reviewer, request.id, { expectedVersion: 2, decision: 'APPROVED', policyVersion: YOUTH_POLICY_VERSION }, now);
    assert.equal(requireStudentAccount(db, teen).admission, 'ADMITTED');
    const serialized = JSON.stringify(store.youth.reviews(reviewer));
    for (const privateValue of [teen, reviewer, 'teen@example.invalid', 'reviewer@example.invalid', 'password']) assert.equal(serialized.includes(privateValue), false);
    assert.throws(() => store.youth.withdraw(stranger, request.id, { expectedVersion: 3, action: 'WITHDRAW' }, now), { code: 'REVIEW_NOT_FOUND' });
    store.youth.withdraw(teen, request.id, { expectedVersion: approved.version, action: 'WITHDRAW' }, now);
    assert.throws(() => requireStudentAccount(db, teen), { code: 'YOUTH_REVIEW_REQUIRED' });
    const school = store.youth.request(teen, { route: 'SCHOOL', policyVersion: YOUTH_POLICY_VERSION }, now);
    store.youth.assignReviewer(school.id, reviewer, now);
    store.youth.decide(reviewer, school.id, { expectedVersion: 2, decision: 'REJECTED', policyVersion: YOUTH_POLICY_VERSION }, now);
    assert.equal(store.youth.access(teen).request?.status, 'REJECTED');
    assert.equal(store.youth.exportData(teen).ownedRequests.length, 2);
    db.prepare('DELETE FROM accounts WHERE id=?').run(teen);
    assert.deepEqual(store.youth.reviews(reviewer), []); assert.equal((db.prepare('SELECT COUNT(*) AS n FROM youth_review_events').get() as { n: number }).n, 0);
  } finally { close(); }
});
test('reviewer deletion or loss of adult verification invalidates an approved request immediately', () => {
  const { db, store, close } = setup();
  try {
    const request = store.youth.request(teen, { route: 'SCHOOL', policyVersion: YOUTH_POLICY_VERSION }, now);
    store.youth.assignReviewer(request.id, reviewer, now);
    store.youth.decide(reviewer, request.id, { expectedVersion: 2, decision: 'APPROVED', policyVersion: YOUTH_POLICY_VERSION }, now);
    db.prepare('UPDATE accounts SET adult_attested_at=NULL WHERE id=?').run(reviewer);
    assert.throws(() => requireStudentAccount(db, teen), { code: 'YOUTH_REVIEW_REQUIRED' });
    db.prepare('UPDATE accounts SET adult_attested_at=? WHERE id=?').run(now.toISOString(), reviewer);
    assert.equal(requireStudentAccount(db, teen).admission, 'ADMITTED');
    db.prepare('DELETE FROM accounts WHERE id=?').run(reviewer);
    assert.throws(() => requireStudentAccount(db, teen), { code: 'YOUTH_REVIEW_REQUIRED' });
  } finally { close(); }
});
test('teen personalization requires both a current review and age-matched privacy consent; AI remains disabled', () => {
  const { db, store, close } = setup();
  try {
    db.exec('CREATE TABLE student_profiles(persona_id TEXT PRIMARY KEY,profile_json TEXT NOT NULL)');
    const privacy = createPrivacyStore(db);
    const profile: StudentProfile = { personaId: teen, label: 'Synthetic teen', version: 1, preferences: { ageMin: 16, ageMax: 17, availableFrom: '2031-05-01T00:00:00Z', availableUntil: '2031-05-31T00:00:00Z', mode: 'ANY', area: '', interests: [], maxFee: 0, hasTraining: false, hasGuardian: false, requiresSchoolCredit: false }, goal: 'EXPLORE', consentVersion: YOUTH_POLICY_VERSION, consentedAt: now.toISOString(), updatedAt: now.toISOString() };
    db.prepare('INSERT INTO student_profiles VALUES(?,?)').run(teen, JSON.stringify(profile));
    const consent = accountPrivacyInput({ policyVersion: YOUTH_POLICY_VERSION, adultConfirmed: false, personalization: true, aiExplanations: false }, 'TEEN_13_17');
    assert.throws(() => accountPrivacyInput(consent, 'ADULT'), { code: 'PRIVACY_POLICY_REQUIRED' });
    assert.throws(() => accountPrivacyInput({ ...consent, aiExplanations: true }, 'TEEN_13_17'), { code: 'TEEN_AI_DISABLED' });
    assert.throws(() => privacy.save(teen, consent, now), { code: 'YOUTH_REVIEW_REQUIRED' });
    const request = store.youth.request(teen, { route: 'SCHOOL', policyVersion: YOUTH_POLICY_VERSION }, now);
    store.youth.assignReviewer(request.id, reviewer, now); store.youth.decide(reviewer, request.id, { expectedVersion: 2, decision: 'APPROVED', policyVersion: YOUTH_POLICY_VERSION }, now);
    assert.equal(privacy.state(teen, profile).personalization, false, 'Review approval alone does not grant personalization.');
    privacy.save(teen, consent, now);
    assert.equal(privacy.state(teen, profile).personalization, true); assert.equal(privacy.state(teen, profile).aiExplanations, false);
    assert.equal(privacy.state(teen, { ...profile, preferences: { ...profile.preferences, ageMin: 16, ageMax: 16 } }).personalization, true, 'An explicitly narrowed age range can support eligibility without a birth date.');
    for (const [ageMin, ageMax] of [[12, 15], [17, 16], [16.5, 17]]) assert.equal(privacy.state(teen, { ...profile, preferences: { ...profile.preferences, ageMin, ageMax } }).storage, false);
    assert.equal(privacy.state(teen, { ...profile, preferences: { ...profile.preferences, ageMax: 18 } }).storage, false);
    db.prepare("UPDATE youth_review_requests SET policy_version='superseded' WHERE id=?").run(request.id);
    assert.equal(privacy.state(teen, profile).storage, false, 'A stale consent policy closes access.');
    db.prepare('UPDATE youth_review_requests SET policy_version=? WHERE id=?').run(YOUTH_POLICY_VERSION, request.id);
    store.youth.decide(reviewer, request.id, { expectedVersion: 3, decision: 'WITHDRAWN', policyVersion: YOUTH_POLICY_VERSION }, now);
    assert.equal(privacy.state(teen, profile).personalization, false); assert.equal(privacy.state(teen, profile).profileVersion, 1, 'Retain the owner version for storage withdrawal.');
  } finally { close(); }
});
test('review limits are owner scoped and failed audit writes roll back decisions atomically', () => {
  const { db, store, close } = setup();
  try {
    const first = store.youth.request(teen, { route: 'GUARDIAN', policyVersion: YOUTH_POLICY_VERSION }, now);
    store.youth.assignReviewer(first.id, reviewer, now);
    db.exec("CREATE TRIGGER fail_review_audit BEFORE INSERT ON youth_review_events BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
    assert.throws(() => store.youth.decide(reviewer, first.id, { expectedVersion: 2, decision: 'APPROVED', policyVersion: YOUTH_POLICY_VERSION }, now), /synthetic audit failure/);
    assert.equal(store.youth.access(teen).request?.status, 'PENDING'); assert.equal(store.youth.access(teen).request?.version, 2);
    db.exec('DROP TRIGGER fail_review_audit');
    store.youth.withdraw(teen, first.id, { expectedVersion: 2, action: 'WITHDRAW' }, now);
    for (let i = 1; i < 12; i++) { const request = store.youth.request(teen, { route: 'SCHOOL', policyVersion: YOUTH_POLICY_VERSION }, now); store.youth.withdraw(teen, request.id, { expectedVersion: 1, action: 'WITHDRAW' }, now); }
    assert.throws(() => store.youth.request(teen, { route: 'SCHOOL', policyVersion: YOUTH_POLICY_VERSION }, now), { code: 'REVIEW_LIMIT' });
    db.prepare("UPDATE account_age SET age_band='TEEN_13_17',synthetic=1 WHERE account_id=?").run(stranger);
    assert.equal(store.youth.request(stranger, { route: 'GUARDIAN', policyVersion: YOUTH_POLICY_VERSION }, now).status, 'PENDING');
    assert.ok(store.youth.exportData(teen).events.length <= 48);
  } finally { close(); }
});
