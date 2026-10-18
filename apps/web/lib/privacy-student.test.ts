import { createSafetyRepository, exportOwnerSafetyData } from './safety-repository.ts';
import { createEvidenceStore } from './evidence-repository.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AccountId } from '../../../packages/domain/identity-contracts.ts';
import type { Preferences } from '../../../packages/domain/contracts.ts';
import { fixtureList } from '../../../packages/domain/fixtures.ts';
import { createAccountStore } from './account-repository.ts';
import { createRepository } from './repository.ts';
import { createStudentRepository, deleteAccountStudentData, exportAccountStudentData } from './student-repository.ts';
import { migrateStudentOwners } from './privacy-migration.ts';
import { initializeNotificationSchema } from './notification-repository.ts';

const now = new Date('2026-10-17T09:00:00Z');
const alex: AccountId = 'account-11111111-1111-4111-8111-111111111111';
const sam: AccountId = 'account-22222222-2222-4222-8222-222222222222';
const preferences: Preferences = { ageMin: 18, ageMax: 20, availableFrom: '2026-10-17T00:00:00Z', availableUntil: '2026-11-15T00:00:00Z', mode: 'ANY', area: '', interests: ['environment'], maxFee: 0, hasTraining: false, hasGuardian: false, requiresSchoolCredit: false };
const consent = { policyVersion: 'adult-account-v1', adultConfirmed: true, personalization: false };
const profileInput = (expectedVersion = 0) => ({ expectedVersion, preferences, goal: 'EXPLORE', storageConsent: true, ...(expectedVersion === 0 ? { privacyConsent: consent } : {}) });
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'comground-privacy-')), filename = join(directory, 'private.sqlite');
  const db = new DatabaseSync(filename); db.exec('PRAGMA foreign_keys=ON');
  createAccountStore(db, { notificationSink() {} });
  for (const [id, email] of [[alex, 'fictional-alex@example.invalid'], [sam, 'fictional-sam@example.invalid']]) {
    db.prepare("INSERT INTO accounts(id,email_norm,password_hash,role,email_verified_at,adult_attested_at,created_at,updated_at) VALUES(?,?,?,'STUDENT',?,?,?,?)").run(id, email, 'test-only-not-a-login-hash', now.toISOString(), now.toISOString(), now.toISOString(), now.toISOString());
  }
  const supply = createRepository(':memory:'); supply.seedDemo(fixtureList(now), now);
  const store = createStudentRepository(filename, supply);
  return { filename, db, supply, store, close: () => { store.close(); supply.close(); db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('account profile admission requires a verified adult student and explicit current privacy consent', () => {
  const { db, store, close } = setup();
  try {
    assert.throws(() => store.saveProfile(alex, { ...profileInput(), privacyConsent: undefined }, now), { code: 'PRIVACY_CONSENT_REQUIRED' });
    for (const privacyConsent of [{ ...consent, adultConfirmed: false }, { ...consent, policyVersion: 'outdated' }, { ...consent, personalization: 'yes' }, { ...consent, aiExplanations: 'yes' }, { ...consent, fullName: 'not permitted' }]) assert.throws(() => store.saveProfile(alex, { ...profileInput(), privacyConsent }, now));
    assert.throws(() => store.saveProfile(alex, { ...profileInput(), preferences: { ...preferences, ageMin: 17 } }, now), { code: 'ADULT_COHORT_ONLY' });
    for (const change of ["email_verified_at=NULL", "adult_attested_at=NULL", "role='OPERATOR'"]) {
      db.prepare(`UPDATE accounts SET ${change} WHERE id=?`).run(alex);
      assert.throws(() => store.saveProfile(alex, profileInput(), now), { code: 'ACCOUNT_REQUIRED' });
      db.prepare("UPDATE accounts SET role='STUDENT',email_verified_at=?,adult_attested_at=? WHERE id=?").run(now.toISOString(), now.toISOString(), alex);
    }
    const profile = store.saveProfile(alex, profileInput(), now);
    assert.equal(profile.consentVersion, 'adult-account-v1'); assert.equal(profile.label, 'Student account');
    assert.deepEqual(store.listActivity(alex, now), [], 'accounts never receive a seeded demo handoff');
    assert.equal(store.getPrivacy(alex).personalization, false); assert.equal(store.getPrivacy(alex).aiExplanations, false);
    assert.equal(store.measurement.consent(alex).enabled, false); assert.equal(store.getAlerts(alex).inApp, false);
    assert.throws(() => store.matches(alex, now), { code: 'PERSONALIZATION_CONSENT_REQUIRED' });
    assert.deepEqual(store.dashboard(alex, now).matches.data, []);
    assert.throws(() => store.saveProfile(alex, { ...profileInput(profile.version), preferences: { ...preferences, ageMin: 17 } }, now), { code: 'ADULT_COHORT_ONLY' });
  } finally { close(); }
});

test('privacy choices are independent, version checked, revocable and cannot bypass consent through profile updates', () => {
  const { store, close } = setup();
  try {
    const profile = store.saveProfile(alex, profileInput(), now), initial = store.getPrivacy(alex);
    const enabled = store.updatePrivacy(alex, { ...consent, personalization: true, aiExplanations: true, expectedVersion: initial.version, expectedProfileVersion: profile.version }, now);
    assert.equal(enabled.personalization, true); assert.equal(enabled.aiExplanations, true); assert.ok(store.matches(alex, now));
    assert.equal(store.getAlerts(alex).inApp, false); assert.equal(store.measurement.consent(alex).enabled, false);
    assert.throws(() => store.updatePrivacy(alex, { ...consent, expectedVersion: initial.version, expectedProfileVersion: profile.version }, now), { code: 'VERSION_CONFLICT' });
    assert.throws(() => store.saveProfile(alex, { ...profileInput(profile.version), privacyConsent: consent }, now), { code: 'PRIVACY_UPDATE_REQUIRED' });
    const revoked = store.updatePrivacy(alex, { ...consent, expectedVersion: enabled.version, expectedProfileVersion: profile.version }, now);
    assert.equal(revoked.personalization, false); assert.equal(revoked.aiExplanations, false);
    assert.throws(() => store.matches(alex, now), { code: 'PERSONALIZATION_CONSENT_REQUIRED' });
    assert.equal(store.exportData(alex, now).privacy.version, revoked.version);
    const edited = store.saveProfile(alex, profileInput(profile.version), now);
    assert.throws(() => store.updatePrivacy(alex, { ...consent, expectedVersion: revoked.version, expectedProfileVersion: profile.version }, now), { code: 'VERSION_CONFLICT' });
    assert.equal(store.getPrivacy(alex).profileVersion, edited.version);
  } finally { close(); }
});

test('private account data is isolated and storage withdrawal cascades while retaining identity and rejecting stale tabs', () => {
  const { db, supply, store, close } = setup();
  try {
    const profile = store.saveProfile(alex, profileInput(), now); store.saveProfile(sam, profileInput(), now);
    const item = supply.listPublic({}, now).data[0];
    store.saveOpportunity(alex, item.id, now, item.occurrenceId); const activity = store.handoff(alex, item.id, now, item.occurrenceId);
    store.updateActivity(alex, activity.id, { expectedVersion: activity.version, status: 'APPLIED' }, now);
    store.submitFeedback(alex, { opportunityId: item.id, occurrenceId: item.occurrenceId, kind: 'WRONG_DETAILS' }, now);
    store.setAlerts(alex, { inApp: true, eventReminders: true, catalogueUpdates: false, expectedProfileVersion: profile.version });
    store.measurement.setConsent(alex, { expectedVersion: 0, expectedProfileVersion: profile.version, enabled: true }, now);
    const other = store.exportData(sam, now);
    assert.throws(() => store.updateActivity(sam, activity.id, { expectedVersion: 2, status: 'WITHDRAWN' }, now), { code: 'NOT_FOUND' });
    assert.equal(store.outcomes().applied, 0, 'account outcomes cannot enter the unconsented demo aggregate');
    assert.throws(() => store.deleteProfile(alex, profile.version + 10), { code: 'VERSION_CONFLICT' });
    store.deleteProfile(alex, profile.version);
    const removed = store.exportData(alex, now);
    assert.equal(removed.profile, null); assert.deepEqual(removed.saved, []); assert.deepEqual(removed.activity, []); assert.deepEqual(removed.feedback, []);
    assert.equal(removed.privacy.storage, false); assert.equal(removed.measurement.consent.enabled, false); assert.equal(store.listReports().length, 0);
    assert.ok(db.prepare('SELECT 1 FROM accounts WHERE id=?').get(alex)); assert.deepEqual(store.exportData(sam, now), other);
    const recreated = store.saveProfile(alex, profileInput(), now);
    assert.ok(recreated.version > profile.version);
    assert.throws(() => store.updatePrivacy(alex, { ...consent, expectedVersion: 1, expectedProfileVersion: profile.version }, now), { code: 'VERSION_CONFLICT' });
    assert.throws(() => store.setAlerts(alex, { inApp: true, eventReminders: true, catalogueUpdates: true, expectedProfileVersion: profile.version }), { code: 'VERSION_CONFLICT' });
    assert.throws(() => store.deleteProfile(alex, profile.version), { code: 'VERSION_CONFLICT' });
    assert.equal(store.getAlerts(alex).inApp, false);
  } finally { close(); }
});

test('account deletion helper participates in its caller transaction and rollback preserves private data', () => {
  const { db, store, close } = setup();
  try {
    const own = store.saveProfile(alex, profileInput(), now); store.saveProfile(sam, profileInput(), now);
    initializeNotificationSchema(db);
    for (const owner of [alex, sam]) {
      db.prepare('INSERT INTO notification_preferences(owner,enabled,version,updated_at) VALUES(?,1,1,?)').run(owner, now.toISOString());
      db.prepare("INSERT INTO notification_outbox(id,account_id,purpose,state,dedupe_key,idempotency_key,envelope,expires_at,created_at,updated_at) VALUES(?,?,'EVENT_REMINDER','QUEUED',?,?,?, ?,?,?)").run(`queue-${owner}`, owner, `dedupe-${owner}`, `idem-${owner}`, 'private-encrypted-envelope-placeholder', '2026-11-01T00:00:00Z', now.toISOString(), now.toISOString());
    }
    const before = store.exportData(alex, now);
    const other = store.exportData(sam, now);
    assert.equal(before.notifications.outbox.length, 1);
    assert.equal(JSON.stringify(before.notifications).includes('private-encrypted-envelope-placeholder'), false);
    db.exec("CREATE TRIGGER abort_profile_delete BEFORE DELETE ON student_profiles BEGIN SELECT RAISE(ABORT,'Injected rollback test'); END;");
    assert.throws(() => store.deleteProfile(alex, own.version), /Injected rollback test/);
    assert.deepEqual(store.exportData(alex, now), before, 'notification purge must roll back with profile deletion failure');
    db.exec('DROP TRIGGER abort_profile_delete');
    db.exec('BEGIN IMMEDIATE');
    deleteAccountStudentData(db, alex);
    assert.equal(db.prepare('SELECT 1 FROM student_profiles WHERE persona_id=?').get(alex), undefined);
    db.exec('ROLLBACK');
    assert.deepEqual(store.exportData(alex, now), before);
    db.exec('BEGIN IMMEDIATE'); deleteAccountStudentData(db, alex); db.prepare('DELETE FROM accounts WHERE id=?').run(alex); db.exec('COMMIT');
    assert.equal(db.prepare('SELECT 1 FROM student_profiles WHERE persona_id=?').get(alex), undefined);
    assert.equal(db.prepare('SELECT 1 FROM accounts WHERE id=?').get(alex), undefined);
    assert.equal(db.prepare('SELECT 1 FROM notification_outbox WHERE account_id=?').get(alex), undefined);
    assert.equal(db.prepare('SELECT 1 FROM notification_preferences WHERE owner=?').get(alex), undefined);
    assert.ok(store.getProfile(sam));
    assert.deepEqual(store.exportData(sam, now), other);
  } finally { close(); }
});

test('account deletion before onboarding removes its outbox without requiring student schema', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON'); createAccountStore(db, { notificationSink() {} });
    db.prepare("INSERT INTO accounts(id,email_norm,password_hash,role,email_verified_at,adult_attested_at,created_at,updated_at) VALUES(?,?,?,'STUDENT',?,?,?,?)").run(alex, 'never-onboarded@example.invalid', 'test-only-hash', now.toISOString(), now.toISOString(), now.toISOString(), now.toISOString());
    initializeNotificationSchema(db);
    db.prepare("INSERT INTO notification_outbox(id,account_id,purpose,state,dedupe_key,idempotency_key,envelope,expires_at,created_at,updated_at) VALUES('verification',?,'VERIFY_EMAIL','BLOCKED','unique','unique','test-only-envelope',?,?,?)").run(alex, '2026-11-01T00:00:00Z', now.toISOString(), now.toISOString());
    db.exec('BEGIN IMMEDIATE'); deleteAccountStudentData(db, alex); db.prepare('DELETE FROM accounts WHERE id=?').run(alex); db.exec('COMMIT');
    assert.equal(db.prepare('SELECT 1 FROM notification_outbox').get(), undefined);
    assert.equal(db.prepare('SELECT 1 FROM accounts').get(), undefined);
  } finally { db.close(); }
});

test('trusted account self-export retains former student data after role changes without widening student access', () => {
  const { db, store, supply, close } = setup();
  try {
    const profile = store.saveProfile(alex, profileInput(), now); store.saveProfile(sam, profileInput(), now);
    const item = supply.listPublic({}, now).data[0];
    store.saveOpportunity(alex, item.id, now, item.occurrenceId); store.handoff(alex, item.id, now, item.occurrenceId);
    const before = store.exportData(alex, now);
    db.prepare("UPDATE accounts SET role='OPERATOR' WHERE id=?").run(alex);
    assert.throws(() => store.getProfile(alex), { code: 'ACCOUNT_REQUIRED' });
    db.exec('BEGIN IMMEDIATE');
    const exported = exportAccountStudentData(db, alex, supply, now);
    db.exec('COMMIT');
    assert.deepEqual(exported, before); assert.equal(exported?.profile?.version, profile.version);
    assert.equal(exported?.saved.length, 1); assert.equal(exported?.activity.length, 1);
    assert.ok(!JSON.stringify(exported).includes('fictional-alex@example.invalid'));
    assert.ok(!JSON.stringify(exported).includes('test-only-not-a-login-hash'));
    assert.deepEqual(exportAccountStudentData(db, sam, supply, now)?.saved, []);
    assert.equal(exportAccountStudentData(db, 'account-99999999-9999-4999-8999-999999999999', supply, now), null);
  } finally { close(); }
});

test('legacy profile constraint migration preserves all child data across repeated startup and keeps deletion cascading', () => {
  const { db, filename, supply, store, close } = setup();
  let reopened: ReturnType<typeof createStudentRepository> | null = null;
  try {
    const demo = store.saveProfile('demo-alex', { expectedVersion: 0, preferences, goal: 'EXPLORE', storageConsent: true }, now);
    store.measurement.setConsent('demo-alex', { expectedVersion: 0, expectedProfileVersion: demo.version, enabled: true }, now);
    const before = store.exportData('demo-alex', now);
    db.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
      CREATE TABLE legacy_profile_fixture(persona_id TEXT PRIMARY KEY CHECK(persona_id IN ('demo-alex','demo-sam')),profile_json TEXT NOT NULL);
      INSERT INTO legacy_profile_fixture SELECT * FROM student_profiles;
      DROP TABLE student_profiles; ALTER TABLE legacy_profile_fixture RENAME TO student_profiles; COMMIT; PRAGMA foreign_keys=ON;`);
    reopened = createStudentRepository(filename, supply); assert.deepEqual(reopened.exportData('demo-alex', now), before);
    reopened.close(); reopened = createStudentRepository(filename, supply); assert.deepEqual(reopened.exportData('demo-alex', now), before);
    const account = reopened.saveProfile(alex, profileInput(), now); assert.ok(account.version > demo.version);
    reopened.deleteProfile('demo-alex'); assert.deepEqual(reopened.exportData('demo-alex', now).activity, []); assert.ok(reopened.getProfile(alex));
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { reopened?.close(); close(); }
});

test('failed profile schema migration rolls back the original table and reenables foreign keys', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA foreign_keys=OFF;
      CREATE TABLE student_profiles(persona_id TEXT PRIMARY KEY CHECK(persona_id IN ('demo-alex','demo-sam')),profile_json TEXT NOT NULL);
      CREATE TABLE retained_child(owner TEXT REFERENCES student_profiles(persona_id) ON DELETE CASCADE);
      INSERT INTO student_profiles VALUES('demo-alex','{}'); INSERT INTO retained_child VALUES('missing'); PRAGMA foreign_keys=ON;`);
    assert.throws(() => migrateStudentOwners(db), { code: 'MIGRATION_FAILED' });
    assert.equal((db.prepare('SELECT profile_json FROM student_profiles').get() as { profile_json: string }).profile_json, '{}');
    assert.match((db.prepare("SELECT sql FROM sqlite_master WHERE name='student_profiles'").get() as { sql: string }).sql, /CHECK/);
    assert.equal((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='student_profiles_account_migration'").get(), undefined);
  } finally { db.close(); }
});


test('pending and revoked synthetic teen keeps erasure and export rights while private use and optional processing remain gated',()=>{
 const state=setup(),{db,filename,store,supply,close}=state;
 const identity=createAccountStore(db,{runtimeMode:'test',syntheticYouthEnabled:true,notificationSink(){throw new Error('No teen messages');}});
 const safety=createSafetyRepository(filename,supply);
 try{
  db.prepare("UPDATE accounts SET adult_attested_at=NULL WHERE id=?").run(alex);
  db.prepare("INSERT INTO account_age(account_id,age_band,synthetic,attested_at) VALUES(?,'TEEN_13_17',1,?)").run(alex,now.toISOString());
  safety.create(alex,{storageConsent:true,target:{kind:'PLATFORM'},category:'PLATFORM_SAFETY'},now);
  assert.equal(exportOwnerSafetyData(db,alex).reports.length,1);
  store.deleteProfile(alex,0);assert.deepEqual(exportOwnerSafetyData(db,alex),{reports:[],reportingLimit:null});
  const request=identity.youth.request(alex,{route:'SCHOOL',policyVersion:'teen-local-v1'},now);
  identity.youth.assignReviewer(request.id,sam,now);
  identity.youth.decide(sam,request.id,{expectedVersion:2,decision:'APPROVED',policyVersion:'teen-local-v1'},now);
  const profile=store.saveProfile(alex,{...profileInput(),preferences:{...preferences,ageMin:16,ageMax:16,schoolStage:'HIGH_SCHOOL'},privacyConsent:{policyVersion:'teen-local-v1',adultConfirmed:false,personalization:true,aiExplanations:false}},now);
  assert.equal(profile.consentVersion,'teen-local-v1');assert.equal(store.getPrivacy(alex).aiExplanations,false);
  assert.throws(()=>store.measurement.setConsent(alex,{expectedVersion:0,expectedProfileVersion:profile.version,enabled:true},now));
  const evidence=createEvidenceStore(db,supply,{syntheticEnabled:true});const item=supply.listPublic({},now).data[0];
  evidence.recordFailedFit(alex,{opportunityId:item.id,occurrenceId:item.occurrenceId??'primary',reason:'TIMING'},now);
  safety.create(alex,{storageConsent:true,target:{kind:'PLATFORM'},category:'PLATFORM_SAFETY'},now);
  const exported=store.exportData(alex,now);assert.equal(exported.safety.reports.length,1);assert.equal(exported.evidence.failedFits.length,1);assert.equal(exported.distribution.subscription.enabled,false);
  identity.youth.withdraw(alex,request.id,{expectedVersion:3,action:'WITHDRAW'},now);
  assert.throws(()=>store.getProfile(alex),{code:'YOUTH_REVIEW_REQUIRED'});assert.equal(store.getPrivacy(alex).storage,false);assert.equal(store.getPrivacy(alex).profileVersion,profile.version);
  assert.equal(exportAccountStudentData(db,alex,supply,now)?.evidence.failedFits.length,1);
  store.deleteProfile(alex,profile.version);assert.equal(exportAccountStudentData(db,alex,supply,now),null);assert.equal(exportOwnerSafetyData(db,alex).reports.length,0);
  assert.equal((db.prepare('SELECT count(*) AS n FROM student_failed_fits WHERE owner=?').get(alex) as {n:number}).n,0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{safety.close();close();}
});
