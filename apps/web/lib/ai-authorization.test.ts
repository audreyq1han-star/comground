import { createRepository } from './repository.ts';
import { createSourceControlRepository, SOURCE_RECORD_FIELDS } from './source-control-repository.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AccountId } from '../../../packages/domain/identity-contracts.ts';
import { fixtureList } from '../../../packages/domain/fixtures.ts';
import { accounts } from './account-runtime.ts';
import { repository } from './runtime.ts';
import { students } from './student-runtime.ts';
import { postMatchExplanations } from './ai-handlers.ts';

const managedKeys = ['COMGROUND_MODE', 'COMGROUND_ORIGIN', 'COMGROUND_DB_PATH', 'COMGROUND_OUTBOX_KEY', 'COMGROUND_ADULT_POLICY_ACK', 'COMGROUND_EMAIL_ENABLED', 'COMGROUND_AI_ENABLED', 'COMGROUND_AI_POLICY_ACK', 'COMGROUND_AI_MODEL', 'OPENAI_API_KEY', 'LOCAL_REVIEW_TOKEN', 'COMGROUND_TEST_FIXTURES'];

test('AI checks durable authorization after body reads and again after the provider await', async () => {
  const previous = new Map(managedKeys.map(key => [key, process.env[key]])), originalFetch = globalThis.fetch;
  const folder = mkdtempSync(join(tmpdir(), 'comground-ai-auth-')), filename = join(folder, 'test.sqlite');
  const origin = 'https://synthetic-review.example.invalid';
  // Synthetic production configuration exercises the real adapter; fetch is replaced
  // only inside this isolated node-test process. No external request is possible.
  Object.assign(process.env, { COMGROUND_MODE: 'production', COMGROUND_ORIGIN: origin, COMGROUND_DB_PATH: filename, COMGROUND_OUTBOX_KEY: randomBytes(32).toString('base64'), COMGROUND_ADULT_POLICY_ACK: 'adult-account-v1', COMGROUND_EMAIL_ENABLED: '0', COMGROUND_AI_ENABLED: '1', COMGROUND_AI_POLICY_ACK: 'grounded-reasons-v1', COMGROUND_AI_MODEL: 'synthetic-test-model', OPENAI_API_KEY: 'synthetic-local-test-key-not-a-credential' });
  delete process.env.LOCAL_REVIEW_TOKEN; delete process.env.COMGROUND_TEST_FIXTURES;
  let db: DatabaseSync | undefined, providerCalls = 0, revokeDuringProvider = '';
  globalThis.fetch = async (url, options) => {
    providerCalls++; assert.equal(url, 'https://api.openai.com/v1/responses');
    const candidates = JSON.parse(JSON.parse(String(options?.body)).input).candidates as { candidateId: string }[];
    if (revokeDuringProvider) accounts().logout(revokeDuringProvider);
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ items: candidates.map(item => ({ candidateId: item.candidateId, reasonIds: ['REQUIREMENTS_MET'] })) }) }] }] }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const identity = accounts(), supply = repository();
    assert.equal(supply.listPublic({}).data.length, 0, 'production runtime starts without fixture data');
    // Explicit test setup, confined to this disposable database.
    const fixtures=fixtureList(),setupSupply=createRepository(filename);setupSupply.seedDemo(fixtures);setupSupply.close();
    db = new DatabaseSync(filename); db.exec('PRAGMA foreign_keys=ON');
    const operator=`account-${randomUUID()}`,stamp=new Date().toISOString();
    db.prepare("INSERT INTO accounts(id,email_norm,password_hash,role,email_verified_at,adult_attested_at,created_at,updated_at) VALUES(?,?,?,'OPERATOR',?,?,?,?)").run(operator,'synthetic-source-review@example.invalid','fixture-not-a-password',stamp,stamp,stamp,stamp);
    const sourceControl=createSourceControlRepository(filename);
    try{for(const record of new Map(fixtures.map(item=>[item.record.source.id,item.record])).values())sourceControl.savePermission(record.source.id,{expectedVersion:0,state:'ACTIVE',method:'JSON',origin:new URL(record.source.url).origin,pathPrefix:'/',fields:SOURCE_RECORD_FIELDS,attribution:'Synthetic provider contract test',evidence:'Synthetic source permission evidence only',ownerId:operator,removalRoute:'Synthetic operator queue',cadenceMinutes:60,expiresAt:new Date(Date.now()+86400000).toISOString(),synthetic:true,reason:'Disposable isolated test setup'},operator);}finally{sourceControl.close();}
    const store = students();
    const owner: AccountId = `account-${randomUUID()}`, now = new Date().toISOString();
    db.prepare("INSERT INTO accounts(id,email_norm,password_hash,role,email_verified_at,adult_attested_at,created_at,updated_at) VALUES(?,?,?,'STUDENT',?,?,?,?)")
      .run(owner, 'synthetic-ai@example.invalid', 'synthetic-fixture-not-a-password-hash', now, now, now, now);
    const profile = store.saveProfile(owner, { expectedVersion: 0, preferences: { ageMin: 18, ageMax: 22, availableFrom: new Date(Date.now() - 86400000).toISOString(), availableUntil: new Date(Date.now() + 60 * 86400000).toISOString(), mode: 'ANY', area: '', interests: ['environment'], maxFee: 0, hasTraining: false, hasGuardian: false, requiresSchoolCredit: false }, goal: 'EXPLORE', storageConsent: true, privacyConsent: { policyVersion: 'adult-account-v1', adultConfirmed: true, personalization: true, aiExplanations: true } });
    assert.ok(store.matches(owner).data.length > 0, 'a current authenticated request would reach the provider');
    function session(): string {
      const token = randomBytes(32).toString('base64url'), at = new Date().toISOString();
      db!.prepare('INSERT INTO account_sessions(id,token_hash,account_id,created_at,last_seen_at,expires_at,authenticated_at) VALUES(?,?,?,?,?,?,?)')
        .run(randomUUID(), createHash('sha256').update(token).digest('hex'), owner, at, at, new Date(Date.now() + 3600000).toISOString(), at);
      assert.equal(identity.requireSession(token).account.id, owner); return token;
    }
    const token = session(), input = JSON.stringify({ expectedProfileVersion: profile.version });
    const headers = (value: string) => ({ host: 'synthetic-review.example.invalid', origin, 'content-type': 'application/json', cookie: `__Host-comground_account=${value}` });
    let controller!: ReadableStreamDefaultController<Uint8Array>, reading!: () => void;
    const readStarted = new Promise<void>(resolve => { reading = resolve; });
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, pull() { reading(); } }, { highWaterMark: 0 });
    const pending = postMatchExplanations(new Request(`${origin}/api/student/matches/explanations`, { method: 'POST', headers: headers(token), body, duplex: 'half' } as RequestInit));
    await readStarted; identity.logout(token);
    controller.enqueue(new TextEncoder().encode(input)); controller.close();
    const rejected = await pending;
    assert.equal(rejected.status, 401); assert.equal((await rejected.json()).error.code, 'UNAUTHENTICATED');
    assert.equal(providerCalls, 0);
    const usageTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_usage'").get();
    if (usageTable) assert.equal(db.prepare('SELECT count(*) AS n FROM ai_usage WHERE owner=?').get(owner)?.n, 0);

    // The later authorization check also protects results when revocation happens
    // during the allowed external await rather than while receiving the body.
    revokeDuringProvider = session();
    const inFlight = await postMatchExplanations(new Request(`${origin}/api/student/matches/explanations`, { method: 'POST', headers: headers(revokeDuringProvider), body: input }));
    assert.equal(providerCalls, 1); assert.equal(inFlight.status, 401);
    assert.equal((await inFlight.json()).error.code, 'UNAUTHENTICATED');
    assert.equal(db.prepare('SELECT count FROM ai_usage WHERE owner=?').get(owner)?.count, 1);
  } finally {
    globalThis.fetch = originalFetch; db?.close();
    try { students().close(); } catch {}
    try { accounts().close(); } catch {}
    try { repository().close(); } catch {}
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(folder, { recursive: true, force: true });
  }
});
