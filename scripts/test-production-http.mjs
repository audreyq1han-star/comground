import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { randomBytes, createHash, createDecipheriv } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { getRuntimeConfig } from '../apps/web/lib/runtime-config.ts';
import { bindDatabaseMode } from '../apps/web/lib/database-mode.ts';
import { createAccountRepository } from '../apps/web/lib/account-repository.ts';

// Undici normalizes Host. Raw loopback HTTP is necessary to test the actual
// configured-host boundary and the local reverse-proxy simulation honestly.
function wireRequest(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method, headers: { ...(body === undefined ? {} : { 'content-length': Buffer.byteLength(body) }), ...headers } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const responseHeaders = new Headers();
        for (let i = 0; i < response.rawHeaders.length; i += 2) responseHeaders.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: responseHeaders }));
      });
    });
    request.setTimeout(20000, () => request.destroy(new Error('Synthetic HTTP probe timed out.')));
    request.on('error', reject); request.end(body);
  });
}

// Shared harness helpers contain no provider transport and never open a non-loopback socket.
export async function createProductionHarness(port = 3110) {
  const directory = await mkdtemp(join(tmpdir(), 'comground-account-acceptance-'));
  const base = `http://127.0.0.1:${port}`, key = randomBytes(32).toString('base64');
  const filename = join(directory, 'accounts.sqlite'), cookies = new Map(), logs = [];
  let child, origin = base, canonicalHost;
  function database(action) { const db = new DatabaseSync(filename); try { return action(db); } finally { db.close(); } }
  async function start(mode = 'test', overrides = {}) {
    origin = mode === 'production' ? 'https://acceptance.example.invalid' : base;
    canonicalHost = mode === 'production' ? new URL(origin).host : undefined;
    child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', 'apps/web', '--hostname', '127.0.0.1', '--port', String(port), '--keepAliveTimeout', '1000'], {
      env: { ...process.env, COMGROUND_MODE: mode, COMGROUND_ORIGIN: origin, COMGROUND_DB_PATH: filename, COMGROUND_OUTBOX_KEY: key, COMGROUND_ADULT_POLICY_ACK: 'adult-account-v1', COMGROUND_EMAIL_ENABLED: '0', COMGROUND_AI_ENABLED: '0', COMGROUND_TEST_FIXTURES: '0', COMGROUND_SKIP_DEMO_SEED: '1', LOCAL_REVIEW_TOKEN: '', RESEND_API_KEY: '', OPENAI_API_KEY: '', COMGROUND_EMAIL_FROM: '', NEXT_TELEMETRY_DISABLED: '1', ...overrides },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', value => logs.push(String(value))); child.stderr.on('data', value => logs.push(String(value)));
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null) throw new Error('Isolated account server exited during startup.');
      try { const response = await wireRequest(base + '/api/runtime', { headers: canonicalHost ? { host: canonicalHost } : {} }); if (response.ok) return; } catch {}
      await delay(200);
    }
    throw new Error('Isolated account server did not become ready.');
  }
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const ended = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM');
    const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 10000);
    try { await ended; } finally { clearTimeout(timer); }
  }
  async function request(path, { actor = 'anonymous', method = 'GET', body, raw, headers = {}, requestOrigin = origin, cookie, capture = true } = {}) {
    const response = await wireRequest(base + path, { method, headers: {
      ...(canonicalHost ? { host: canonicalHost } : {}), ...(cookie ?? cookies.get(actor) ? { cookie: cookie ?? cookies.get(actor) } : {}),
      ...(method !== 'GET' && requestOrigin !== null ? { origin: requestOrigin } : {}), ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}), ...headers,
    }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    if (capture) {
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(';')[0];
        if (pair.startsWith('comground_account=') || pair.startsWith('__Host-comground_account=')) cookies.set(actor, pair);
      }
    }
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = { unexpectedText: text.slice(0, 120) }; }
    return { status: response.status, data, headers: response.headers };
  }
  function account(email) { return database(db => db.prepare('SELECT id,email_norm,password_hash,role FROM accounts WHERE email_norm=?').get(email.toLowerCase())); }
  function actionLink(email, purpose) {
    return database(db => {
      const row = db.prepare('SELECT o.id,o.envelope,o.state FROM notification_outbox o JOIN accounts a ON a.id=o.account_id WHERE a.email_norm=? AND o.purpose=? ORDER BY o.rowid DESC LIMIT 1').get(email.toLowerCase(), purpose);
      assert(row?.envelope, 'The synthetic action has an encrypted local outbox payload.'); assert.equal(row.state, 'BLOCKED');
      const [version, nonce, tag, ciphertext] = row.envelope.split('.'); assert.equal(version, 'v1');
      const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), Buffer.from(nonce, 'base64'));
      decipher.setAAD(Buffer.from(`comground.notification.v1:${row.id}`)); decipher.setAuthTag(Buffer.from(tag, 'base64'));
      const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8'));
      assert.equal(payload.to, email.toLowerCase());
      const link = payload.text.match(/https?:\/\/[^\s]+#token=[A-Za-z0-9_-]+/)?.[0]; assert(link, 'Encrypted notification includes a fragment token link.');
      const url = new URL(link); assert.equal(url.origin, origin); assert.equal(url.search, '');
      const token = new URLSearchParams(url.hash.slice(1)).get('token'); assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      assert(!row.envelope.includes(token) && !row.envelope.includes(email));
      return { path: url.pathname + url.hash, token, outboxId: row.id };
    });
  }
  function bootstrap(email) {
    const row = account(email); assert(row);
    const store = createAccountRepository(filename, { notificationSink: () => { throw new Error('Bootstrap must not send a message.'); } });
    try { return store.bootstrapOperator(row.id); } finally { store.close(); }
  }
  async function beginStreamedRequest(path, { actor, method, body }) {
    const serialized = JSON.stringify(body), halfway = Math.floor(serialized.length / 2);
    let request, resolveResponse, rejectResponse;
    const response = new Promise((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
    request = httpRequest(base + path, { method, headers: { ...(canonicalHost ? { host: canonicalHost } : {}), origin, cookie: cookies.get(actor), 'content-type': 'application/json', 'content-length': Buffer.byteLength(serialized) } }, incoming => {
      const chunks = []; incoming.on('data', chunk => chunks.push(chunk)); incoming.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); let data; try { data = JSON.parse(raw); } catch { data = { unexpectedText: raw.slice(0, 120) }; } resolveResponse({ status: incoming.statusCode, data }); });
    });
    request.on('error', rejectResponse); request.setTimeout(20000, () => request.destroy(new Error('Held synthetic body timed out.')));
    await new Promise((resolve, reject) => request.write(serialized.slice(0, halfway), error => error ? reject(error) : resolve()));
    await delay(150);
    return { finish: () => { request.end(serialized.slice(halfway)); return response; } };
  }
  return { base, origin: () => origin, directory, filename, key, cookies, logs, database, start, stop, request, beginStreamedRequest, account, actionLink, bootstrap, cleanup: async () => { await stop(); await rm(directory, { recursive: true, force: true }); } };
}
export function expectStatus(response, status = 200) { assert.equal(response.status, status, JSON.stringify(response.data)); return response.data; }
export function dataOf(response, status = 200) { return expectStatus(response, status).data; }
export function expectDenied(response, allowed = [400, 401, 403, 404, 409, 413, 422, 503]) { assert(allowed.includes(response.status), `Unexpected status ${response.status}`); assert(response.data.error?.code); return response.data.error.code; }
export const syntheticPassword = () => `synthetic-only-${randomBytes(18).toString('base64url')}`;
export function adultProfile(expectedVersion = 0, personalization = false) {
  return { expectedVersion, storageConsent: true, privacyConsent: { policyVersion: 'adult-account-v1', adultConfirmed: true, personalization }, goal: 'EXPLORE', preferences: { ageMin: 18, ageMax: 24, availableFrom: new Date().toISOString(), availableUntil: new Date(Date.now() + 30 * 86400000).toISOString(), mode: 'ANY', area: 'Example neighborhood', interests: ['outdoors'], maxFee: 0, hasTraining: false, hasGuardian: false, requiresSchoolCredit: false } };
}
export function noSecrets(value) {
  const forbidden = new Set(['password', 'passwordHash', 'password_hash', 'token', 'token_hash', 'envelope', 'email', 'email_norm', 'recipient', 'to', 'text', 'owner', 'ownerId', 'accountId']);
  function visit(node) { if (!node || typeof node !== 'object') return; for (const [key, child] of Object.entries(node)) { assert(!forbidden.has(key), `Unexpected private projection field: ${key}`); visit(child); } }
  visit(value);
}

async function run() {
  const checks = [], h = await createProductionHarness(), passwordA = syntheticPassword(), passwordB = syntheticPassword(), passwordOperator = syntheticPassword();
  const users = { alice: 'alice.synthetic@example.invalid', bob: 'bob.synthetic@example.invalid', operator: 'operator.synthetic@example.invalid' };
  const req = h.request, student = (actor, path, method = 'GET', body) => req('/api/student/' + path, { actor, method, body });
  const auth = (actor, path, method = 'GET', body) => req('/api/account/' + path, { actor, method, body });
  const check = async (name, action) => { await action(); checks.push(name); console.log('PASS', name); };
  let alice, bob, profileA, profileB, privacyA, resetPassword = syntheticPassword(), finalPassword = syntheticPassword();
  try {
    await check('Production configuration fails closed and test mode cannot enable live adapters', async () => {
      const valid = { COMGROUND_MODE: 'production', COMGROUND_ORIGIN: 'https://acceptance.example.invalid', COMGROUND_DB_PATH: h.filename, COMGROUND_OUTBOX_KEY: h.key, COMGROUND_ADULT_POLICY_ACK: 'adult-account-v1' };
      assert.equal(getRuntimeConfig(valid).mode, 'production');
      for (const change of [{ COMGROUND_MODE: 'unknown' }, { COMGROUND_ORIGIN: 'http://acceptance.example.invalid' }, { COMGROUND_ORIGIN: 'https://acceptance.example.invalid/path' }, { COMGROUND_ORIGIN: 'https://127.0.0.1' }, { COMGROUND_DB_PATH: 'relative.sqlite' }, { COMGROUND_OUTBOX_KEY: '' }, { COMGROUND_ADULT_POLICY_ACK: '' }, { LOCAL_REVIEW_TOKEN: 'forbidden-synthetic-reviewer-token' }, { COMGROUND_TEST_FIXTURES: '1' }, { COMGROUND_EMAIL_ENABLED: '1' }, { COMGROUND_AI_ENABLED: '1' }]) assert.throws(() => getRuntimeConfig({ ...valid, ...change }));
      for (const flag of ['COMGROUND_EMAIL_ENABLED', 'COMGROUND_AI_ENABLED']) assert.throws(() => getRuntimeConfig({ ...valid, COMGROUND_MODE: 'test', COMGROUND_ORIGIN: h.base, [flag]: '1' }));
      assert.throws(() => getRuntimeConfig({ NODE_ENV: 'production' }));
    });
    await check('Database binding prevents cross-mode reuse before application writes', async () => {
      const file = join(h.directory, 'binding.sqlite'); bindDatabaseMode(file, 'demo'); bindDatabaseMode(file, 'demo');
      await chmod(file, 0o600);
      assert.throws(() => bindDatabaseMode(file, 'test'), { code: 'DATABASE_MODE_MISMATCH' });
      assert.throws(() => bindDatabaseMode(file, 'production'), { code: 'DATABASE_MODE_MISMATCH' });
    });
    await h.start();
    await check('Test account mode exposes truthful disabled integrations and an unseeded catalogue', async () => {
      const runtime = expectStatus(await req('/api/runtime')); assert.equal(runtime.mode, 'test'); assert.equal(runtime.capabilities.accounts, true); assert.equal(runtime.capabilities.demoPersonas, false); assert.equal(runtime.capabilities.emailDelivery, false); assert.equal(runtime.capabilities.aiExplanations, false); assert.equal(runtime.capabilities.realFeeds, false);
      assert.deepEqual(dataOf(await req('/api/opportunities')), []);
      expectDenied(await req('/api/student/session', { method: 'POST', body: { personaId: 'demo-alex' } }));
      expectDenied(await req('/api/admin/session', { method: 'POST', body: { token: 'forbidden-synthetic-reviewer-token' } }));
      for (const path of ['/api/test/mailbox', '/api/account/test-tokens']) assert.equal((await req(path)).status, 404);
      expectDenied(await req('/api/account/register?role=OPERATOR', { method: 'POST', body: {} }), [400]);
    });
    await check('Account mutations enforce exact origin, request metadata and bounded DTOs before registration', async () => {
      const body = { email: users.alice, password: passwordA, adultConfirmed: true };
      for (const options of [{ requestOrigin: null }, { requestOrigin: 'https://other.example.invalid' }, { requestOrigin: h.base + '.attacker.invalid' }, { headers: { 'sec-fetch-site': 'cross-site' } }, { headers: { host: 'other.example.invalid', 'x-forwarded-host': new URL(h.base).host } }]) { const result = await req('/api/account/register', { method: 'POST', body, ...options }); assert.equal(result.status, 403, `Origin probe ${JSON.stringify(options)}: ${JSON.stringify(result.data)}`); }
      for (const change of [{ role: 'OPERATOR' }, { ownerId: 'account-forged' }, { emailVerified: true }, { adultConfirmed: false }, { password: 'short' }]) expectDenied(await req('/api/account/register', { method: 'POST', body: { ...body, ...change } }), [422]);
      expectDenied(await req('/api/account/register', { method: 'POST', raw: '{broken' }), [400]);
      expectDenied(await req('/api/account/register', { method: 'POST', raw: JSON.stringify({ ...body, extra: 'x'.repeat(33000) }) }), [413]);
    });
    await check('Signup creates only student accounts and stores verification messages encrypted without API tokens', async () => {
      for (const [actor, password] of [['alice', passwordA], ['bob', passwordB], ['operator', passwordOperator]]) {
        const response = await auth(actor, 'register', 'POST', { email: users[actor], password, adultConfirmed: true });
        const result = expectStatus(response, 202); assert.deepEqual(Object.keys(result).sort(), ['accepted', 'message']); assert.equal(result.accepted, true);
        const row = h.account(users[actor]); assert.equal(row.role, 'STUDENT'); assert(row.password_hash.startsWith('scrypt$')); assert(!row.password_hash.includes(password));
        const action = h.actionLink(users[actor], 'VERIFY_EMAIL'); assert(!JSON.stringify(result).includes(action.token));
        h.database(db => { const stored = db.prepare('SELECT token_hash FROM account_action_tokens WHERE account_id=?').get(row.id); assert.equal(stored.token_hash, createHash('sha256').update(action.token).digest('hex')); });
      }
      const duplicate = expectStatus(await auth('alice', 'register', 'POST', { email: 'ALICE.SYNTHETIC@example.invalid', password: passwordA, adultConfirmed: true }), 202);
      const unknown = expectStatus(await auth('anonymous', 'verification', 'POST', { email: 'nobody.synthetic@example.invalid' }), 202);
      assert.deepEqual(duplicate, unknown); assert.equal(h.database(db => db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n), 3);
    });
    await check('Unverified sessions cannot use private profiles, operator data or optional delivery', async () => {
      const session = expectStatus(await auth('alice', 'session', 'POST', { email: users.alice, password: passwordA })); assert.equal(session.authenticated, true); assert.equal(session.account.emailVerified, false);
      expectDenied(await student('alice', 'profile', 'PUT', adultProfile()), [403]); expectDenied(await req('/api/admin/opportunities', { actor: 'alice' }), [403]); expectDenied(await student('alice', 'notifications/preferences'), [403]);
      const cookie = h.cookies.get('alice'); assert(cookie); const response = await auth('alice', 'session', 'POST', { email: users.alice, password: passwordA });
      const flags = response.headers.getSetCookie().join(';'); assert(flags.includes('HttpOnly')); assert(flags.includes('SameSite=Strict')); assert(flags.includes('Path=/')); assert(!JSON.stringify(response.data).includes(h.cookies.get('alice').split('=')[1]));
    });
    await check('Verification is purpose-bound and one-use; replacement invalidates the former link', async () => {
      const old = h.actionLink(users.alice, 'VERIFY_EMAIL'); expectStatus(await auth('alice', 'verification', 'POST', { email: users.alice }), 202);
      const current = h.actionLink(users.alice, 'VERIFY_EMAIL'); assert.notEqual(old.token, current.token);
      expectDenied(await auth('alice', 'verification/confirm', 'POST', { token: old.token, password: passwordA }), [422]);
      expectDenied(await auth('alice', 'recovery/confirm', 'POST', { token: current.token, password: resetPassword }), [422]);
      const results = await Promise.all([auth('alice', 'verification/confirm', 'POST', { token: current.token, password: passwordA }), auth('alice', 'verification/confirm', 'POST', { token: current.token, password: passwordA })]);
      assert.deepEqual(results.map(item => item.status).sort(), [200, 422]);
      for (const actor of ['bob', 'operator']) expectStatus(await auth(actor, 'verification/confirm', 'POST', { token: h.actionLink(users[actor], 'VERIFY_EMAIL').token, password: actor === 'bob' ? passwordB : passwordOperator }));
      assert.equal(expectStatus(await auth('alice', 'session')).authenticated, false);
      alice = expectStatus(await auth('alice', 'session', 'POST', { email: users.alice, password: passwordA })).account; assert.equal(alice.emailVerified, true);
    });
    await check('Offline verified-adult bootstrap creates an operator without enabling a role-granting HTTP path', async () => {
      assert.equal(h.bootstrap(users.operator).role, 'OPERATOR'); assert.throws(() => h.bootstrap(users.bob), { code: 'BOOTSTRAP_CLOSED' });
      expectStatus(await auth('operator', 'session', 'POST', { email: users.operator, password: passwordOperator }));
      bob = expectStatus(await auth('bob', 'session', 'POST', { email: users.bob, password: passwordB })).account;
      dataOf(await req('/api/admin/opportunities', { actor: 'operator' }));
      expectDenied(await student('operator', 'profile'), [403]); expectDenied(await req('/api/admin/opportunities', { actor: 'bob' }), [403]); expectDenied(await req('/api/admin/opportunities'), [401, 403]);
    });
    await check('Adult profile admission and independent personalization consent are enforced server-side', async () => {
      const missing = adultProfile(); delete missing.privacyConsent; expectDenied(await student('alice', 'profile', 'PUT', missing), [403, 422]);
      const underage = adultProfile(); underage.preferences.ageMin = 16; underage.preferences.ageMax = 17; expectDenied(await student('alice', 'profile', 'PUT', underage), [403, 422]);
      profileA = dataOf(await student('alice', 'profile', 'PUT', adultProfile())); profileB = dataOf(await student('bob', 'profile', 'PUT', adultProfile()));
      assert.equal(profileA.personaId, alice.id); assert.equal(profileB.personaId, bob.id);
      privacyA = dataOf(await student('alice', 'privacy')); assert.equal(privacyA.personalization, false); assert.equal(privacyA.storage, true);
      assert.equal(expectDenied(await student('alice', 'matches', 'POST', {}), [403]), 'PERSONALIZATION_CONSENT_REQUIRED');
      dataOf(await student('alice', 'dashboard'));
      expectDenied(await student('alice', 'privacy', 'PUT', { expectedVersion: privacyA.version, expectedProfileVersion: profileA.version, policyVersion: 'adult-account-v1', adultConfirmed: true, personalization: true, ownerId: bob.id }), [422]);
      privacyA = dataOf(await student('alice', 'privacy', 'PUT', { expectedVersion: privacyA.version, expectedProfileVersion: profileA.version, policyVersion: 'adult-account-v1', adultConfirmed: true, personalization: true }));
      assert.deepEqual(expectStatus(await student('alice', 'matches', 'POST', {})).data, []);
      const explanation = expectStatus(await student('alice', 'matches/explanations', 'POST', { expectedProfileVersion: profileA.version }));
      assert(!JSON.stringify(explanation).includes('synthetic-only-'));
      assert.equal(dataOf(await student('alice', 'measurement')).enabled, false);
    });
    await check('Every private mutation namespace rejects cross-origin requests without changing persisted choices', async () => {
      const before = dataOf(await student('alice', 'privacy'));
      for (const [path, actor, body] of [
        ['/api/student/privacy', 'alice', { expectedVersion: before.version, expectedProfileVersion: profileA.version, policyVersion: 'adult-account-v1', adultConfirmed: true, personalization: false }],
        ['/api/student/notifications/preferences', 'alice', { expectedVersion: 0, expectedProfileVersion: profileA.version, enabled: true }],
        ['/api/student/matches/explanations', 'alice', { expectedProfileVersion: profileA.version }],
        ['/api/admin/imports', 'operator', { fixtureId: 'garden' }],
      ]) expectDenied(await req(path, { actor, method: path.endsWith('/privacy') || path.endsWith('/preferences') ? 'PUT' : 'POST', body, requestOrigin: 'https://attacker.example.invalid' }), [403]);
      assert.deepEqual(dataOf(await student('alice', 'privacy')), before);
      assert.equal(dataOf(await student('alice', 'notifications/preferences')).enabled, false);
      assert.deepEqual(dataOf(await req('/api/opportunities')), []);
    });
    await check('Optional notification consent remains independent and visibly delivery-disabled with safe queue projections', async () => {
      const before = dataOf(await student('alice', 'notifications/preferences')); assert.equal(before.enabled, false); assert(['DELIVERY_DISABLED', 'CONFIGURATION_MISSING'].includes(before.availability));
      const after = dataOf(await student('alice', 'notifications/preferences', 'PUT', { expectedVersion: before.version, expectedProfileVersion: profileA.version, enabled: true })); assert.equal(after.enabled, true); assert.notEqual(after.availability, 'READY');
      expectDenied(await student('alice', 'notifications/preferences', 'PUT', { expectedVersion: before.version, expectedProfileVersion: profileA.version, enabled: false }), [409]);
      noSecrets(dataOf(await student('alice', 'notifications')));
      const summary = dataOf(await req('/api/admin/notifications', { actor: 'operator' })); noSecrets(summary); assert.equal(summary.deliveryEnabled, false); assert.equal(summary.acceptedIsDeliveryConfirmation, false);
      assert.equal(h.database(db => db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE state='ACCEPTED'").get().n), 0);
    });
    await check('Durable account sessions and privacy choices survive process restart without demo re-selection', async () => {
      const before = h.cookies.get('alice'); await h.stop(); await h.start();
      const state = expectStatus(await auth('alice', 'session')); assert.equal(state.authenticated, true); assert.equal(state.account.id, alice.id); assert.equal(h.cookies.get('alice'), before);
      assert.equal(dataOf(await student('alice', 'privacy')).personalization, true); assert.equal(dataOf(await student('alice', 'notifications/preferences')).enabled, true);
      assert.equal(expectStatus(await auth('operator', 'session')).account.role, 'OPERATOR');
    });
    await check('Revocation while a real HTTP JSON body is held prevents student, notification, AI and operator work', async () => {
      const original = dataOf(await student('bob', 'privacy'));
      const bobPrivacy = dataOf(await student('bob', 'privacy', 'PUT', { expectedVersion: original.version, expectedProfileVersion: profileB.version, policyVersion: 'adult-account-v1', adultConfirmed: true, personalization: true }));
      const bobNotifications = dataOf(await student('bob', 'notifications/preferences'));
      const probes = [
        { owner: 'bob', password: passwordB, path: '/api/student/privacy', method: 'PUT', body: { expectedVersion: bobPrivacy.version, expectedProfileVersion: profileB.version, policyVersion: 'adult-account-v1', adultConfirmed: true, personalization: false } },
        { owner: 'bob', password: passwordB, path: '/api/student/notifications/preferences', method: 'PUT', body: { expectedVersion: bobNotifications.version, expectedProfileVersion: profileB.version, enabled: true } },
        { owner: 'bob', password: passwordB, path: '/api/student/matches/explanations', method: 'POST', body: { expectedProfileVersion: profileB.version } },
        { owner: 'operator', password: passwordOperator, path: '/api/admin/imports', method: 'POST', body: { fixtureId: 'garden' } },
      ];
      for (const probe of probes) {
        expectStatus(await auth('held', 'session', 'POST', { email: users[probe.owner], password: probe.password }));
        const selected = dataOf(await auth('held', 'sessions')).find(item => item.current); assert(selected);
        const held = await h.beginStreamedRequest(probe.path, { actor: 'held', method: probe.method, body: probe.body });
        expectStatus(await auth(probe.owner, `sessions/${selected.id}`, 'DELETE'));
        expectDenied(await held.finish(), [401]);
      }
      assert.deepEqual(dataOf(await student('bob', 'privacy')), bobPrivacy);
      assert.deepEqual(dataOf(await student('bob', 'notifications/preferences')), bobNotifications);
      assert.deepEqual(dataOf(await req('/api/opportunities')), []);
      assert.equal(h.database(db => db.prepare('SELECT COUNT(*) AS n FROM opportunities').get().n), 0);
    });
    await check('Session listing and revocation are owner-bound and invalidate only selected sessions', async () => {
      expectStatus(await auth('aliceOther', 'session', 'POST', { email: users.alice, password: passwordA }));
      const list = dataOf(await auth('alice', 'sessions')); assert(list.length >= 2); assert.equal(list.filter(item => item.current).length, 1); noSecrets(list);
      const other = dataOf(await auth('aliceOther', 'sessions')).find(item => item.current); assert(other);
      expectStatus(await auth('bob', `sessions/${other.id}`, 'DELETE')); assert.equal(expectStatus(await auth('aliceOther', 'session')).authenticated, true);
      expectStatus(await auth('alice', `sessions/${other.id}`, 'DELETE')); assert.equal(expectStatus(await auth('aliceOther', 'session')).authenticated, false); assert.equal(expectStatus(await auth('alice', 'session')).authenticated, true);
    });
    await check('Password recovery is generic, purpose-bound, one-use and revokes all prior account sessions', async () => {
      const known = expectStatus(await auth('alice', 'recovery', 'POST', { email: users.alice }), 202);
      const unknown = expectStatus(await auth('anonymous', 'recovery', 'POST', { email: 'absent.synthetic@example.invalid' }), 202); assert.deepEqual(known, unknown);
      const action = h.actionLink(users.alice, 'RESET_PASSWORD'), prior = h.cookies.get('alice');
      expectDenied(await auth('alice', 'verification/confirm', 'POST', { token: action.token, password: resetPassword }), [422]);
      expectStatus(await auth('alice', 'recovery/confirm', 'POST', { token: action.token, password: resetPassword }));
      expectDenied(await auth('alice', 'recovery/confirm', 'POST', { token: action.token, password: resetPassword }), [422]);
      assert.equal(expectStatus(await req('/api/account/session', { cookie: prior, capture: false })).authenticated, false);
      expectDenied(await auth('alice', 'session', 'POST', { email: users.alice, password: passwordA }), [401]);
      expectStatus(await auth('alice', 'session', 'POST', { email: users.alice, password: resetPassword })); assert.equal(expectStatus(await auth('bob', 'session')).account.id, bob.id);
    });
    await check('Password change checks current credentials, rotates the current session and revokes other sessions', async () => {
      expectStatus(await auth('aliceOther', 'session', 'POST', { email: users.alice, password: resetPassword }));
      const current = h.cookies.get('alice'), other = h.cookies.get('aliceOther');
      expectDenied(await auth('alice', 'password', 'PATCH', { currentPassword: passwordA, newPassword: finalPassword }), [401]);
      expectStatus(await auth('alice', 'password', 'PATCH', { currentPassword: resetPassword, newPassword: finalPassword })); assert.notEqual(h.cookies.get('alice'), current);
      for (const cookie of [current, other]) assert.equal(expectStatus(await req('/api/account/session', { cookie, capture: false })).authenticated, false);
      const before = h.cookies.get('alice'); expectStatus(await auth('alice', 'reauthenticate', 'POST', { password: finalPassword })); assert.notEqual(h.cookies.get('alice'), before);
    });
    await check('Full account export and destructive controls require recent authentication, with safe complete owned export after confirmation', async () => {
      const sessionToken = h.cookies.get('alice').split('=')[1];
      h.database(db => db.prepare('UPDATE account_sessions SET authenticated_at=? WHERE token_hash=?').run(new Date(Date.now() - 11 * 60000).toISOString(), createHash('sha256').update(sessionToken).digest('hex')));
      for (const [path, method, body] of [
        ['/api/account/export', 'GET'], ['/api/student/export', 'GET'],
        ['/api/account/sessions', 'DELETE'], ['/api/account/profile', 'DELETE', { confirmation: 'DELETE' }],
        ['/api/student/profile', 'DELETE', { confirmation: 'DELETE', expectedProfileVersion: profileA.version }],
      ]) assert.equal(expectDenied(await req(path, { actor: 'alice', method, body }), [403]), 'RECENT_AUTH_REQUIRED');
      assert.equal(dataOf(await student('alice', 'profile')).version, profileA.version);
      expectStatus(await auth('alice', 'reauthenticate', 'POST', { password: finalPassword }));
      const response = await auth('alice', 'export'), exported = expectStatus(response);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(exported.identity.account.id, alice.id); assert.equal(exported.identity.account.email, users.alice);
      assert.equal(exported.student.profile.personaId, alice.id); assert(exported.identity.sessions.length); assert(exported.identity.securityEvents.length); assert(exported.notifications);
      const serialized = JSON.stringify(exported);
      for (const secret of [sessionToken, passwordA, resetPassword, finalPassword]) assert(!serialized.includes(secret));
      for (const forbidden of ['password_hash', 'passwordHash', 'token_hash', 'envelope']) assert(!serialized.includes(`"${forbidden}"`));
      const operatorExport = expectStatus(await auth('operator', 'export')); assert.equal(operatorExport.identity.account.role, 'OPERATOR'); assert.equal(operatorExport.student, null);
    });
    await check('Profile deletion removes private and notification state while retaining only its account identity', async () => {
      const bobBefore = dataOf(await student('bob', 'export'));
      const exported = dataOf(await student('alice', 'export')); assert.equal(exported.profile.personaId, alice.id); assert(exported.privacy); assert(exported.notifications);
      expectStatus(await student('alice', 'profile', 'DELETE', { confirmation: 'DELETE', expectedProfileVersion: profileA.version }));
      assert.equal(expectStatus(await auth('alice', 'session')).account.id, alice.id); assert.equal(dataOf(await student('alice', 'profile')), null);
      assert.equal(h.database(db => db.prepare('SELECT COUNT(*) AS n FROM notification_outbox WHERE account_id=?').get(alice.id).n), 0);
      assert.deepEqual(dataOf(await student('bob', 'export')).profile, bobBefore.profile);
      const recreated = dataOf(await student('alice', 'profile', 'PUT', adultProfile())); assert(recreated.version > profileA.version);
      expectDenied(await student('alice', 'privacy', 'PUT', { expectedVersion: privacyA.version, expectedProfileVersion: profileA.version, policyVersion: 'adult-account-v1', adultConfirmed: true, personalization: true }), [409]);
    });
    await check('Account deletion invalidates tokens and sessions and removes owned rows without touching another account', async () => {
      const formerCookie = h.cookies.get('alice'), bobBefore = dataOf(await student('bob', 'export'));
      expectStatus(await auth('alice', 'recovery', 'POST', { email: users.alice }), 202); const pending = h.actionLink(users.alice, 'RESET_PASSWORD');
      expectDenied(await auth('alice', 'profile', 'DELETE', { confirmation: 'wrong' }), [422]);
      expectStatus(await auth('alice', 'profile', 'DELETE', { confirmation: 'DELETE' }));
      assert.equal(h.account(users.alice), undefined); assert.equal(expectStatus(await req('/api/account/session', { cookie: formerCookie, capture: false })).authenticated, false);
      expectDenied(await auth('alice', 'recovery/confirm', 'POST', { token: pending.token, password: finalPassword }), [422]);
      h.database(db => { for (const [table, column] of [['account_sessions', 'account_id'], ['account_action_tokens', 'account_id'], ['account_security_events', 'account_id'], ['notification_outbox', 'account_id'], ['student_profiles', 'persona_id']]) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}=?`).get(alice.id).n, 0, table); });
      assert.deepEqual(dataOf(await student('bob', 'export')).profile, bobBefore.profile);
    });
    await check('Authentication limits reject repeated wrong credentials without exposing internal errors', async () => {
      const email = 'rate-limit.synthetic@example.invalid', password = syntheticPassword(), other = 'unaffected.synthetic@example.invalid';
      for (const address of [email, other]) expectStatus(await auth('anonymous', 'register', 'POST', { email: address, password, adultConfirmed: true }), 202);
      for (let i = 0; i < 9; i++) {
        const known = await auth('anonymous', 'session', 'POST', { email, password: syntheticPassword() });
        const unknown = await auth('anonymous', 'session', 'POST', { email: 'unknown-limit.synthetic@example.invalid', password: syntheticPassword() });
        expectDenied(known, [401]); expectDenied(unknown, [401]); assert.deepEqual(known.data, unknown.data);
      }
      assert.equal(expectDenied(await auth('anonymous', 'session', 'POST', { email, password }), [401]), 'INVALID_CREDENTIALS');
      assert.equal(expectStatus(await auth('unaffected', 'session', 'POST', { email: other, password })).authenticated, true);
    });
  } finally { await h.cleanup(); }

  const production = await createProductionHarness(3110);
  try {
    await production.start('production');
    await check('Configured production stays empty, rejects demo entry points and uses secure host-only account cookies', async () => {
      const runtime = expectStatus(await production.request('/api/runtime')); assert.equal(runtime.mode, 'production'); assert.equal(runtime.catalogue, 'EMPTY_PENDING_FEEDS');
      assert.deepEqual(dataOf(await production.request('/api/opportunities')), []);
      expectDenied(await production.request('/api/communities/demo-neighborhood'), [404]);
      for (const [path, body] of [['/api/student/session', { personaId: 'demo-alex' }], ['/api/admin/session', { token: 'synthetic-token' }]]) expectDenied(await production.request(path, { method: 'POST', body }));
      expectDenied(await production.request('/api/runtime', { headers: { host: 'evil.example.invalid', 'x-forwarded-host': 'acceptance.example.invalid' } }), [403]);
      const email = 'production-probe.synthetic@example.invalid', password = syntheticPassword();
      expectStatus(await production.request('/api/account/register', { method: 'POST', body: { email, password, adultConfirmed: true } }), 202);
      const response = await production.request('/api/account/session', { method: 'POST', body: { email, password } }); expectStatus(response);
      const cookie = response.headers.getSetCookie().join(';'); assert(cookie.includes('__Host-comground_account=')); assert(cookie.includes('; Secure')); assert(cookie.includes('HttpOnly')); assert(cookie.includes('SameSite=Strict')); assert(!cookie.toLowerCase().includes('domain='));
      assert.equal(production.database(db => db.prepare('SELECT COUNT(*) AS n FROM opportunities').get().n), 0);
    });
  } finally { await production.cleanup(); }
  await mkdir('docs/evidence', { recursive: true });
  await writeFile('docs/evidence/production-http.json', JSON.stringify({ verifiedAt: new Date().toISOString(), checks, scope: 'Synthetic durable accounts through isolated test mode plus loopback reverse-proxy-header simulation of production; no live adapters', externalProviderCalls: 0, limits: ['No live email delivery, public TLS endpoint, deployed proxy, verified age, real accounts or feed data is claimed.', 'Notification retries and AI transports are verified separately through injected unit seams.'] }, null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await run();
