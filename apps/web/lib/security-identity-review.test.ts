import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { IdentityNotification } from '../../../packages/domain/identity-contracts.ts';
import { createAccountStore } from './account-repository.ts';
import { hashPassword } from './account-password.ts';

const now = new Date('2031-05-01T12:00:00Z');
const password = 'Synthetic identity review password 123';
const ownerPassword = 'Mailbox owner chooses this password 456';
function fixture() {
  const db = new DatabaseSync(':memory:');
  const messages: IdentityNotification[] = [];
  const store = createAccountStore(db, { notificationSink: (_, message) => messages.push(message), beforeDelete: () => {} });
  return { db, store, messages };
}
async function register(f: ReturnType<typeof fixture>, email = 'victim@example.invalid') {
  await f.store.register({ email, password, adultConfirmed: true }, now);
  return f.messages.at(-1)!;
}
async function verify(f: ReturnType<typeof fixture>, email = 'victim@example.invalid') {
  const message = await register(f, email);
  await f.store.verifyEmail({ token: message.token, password }, now);
  return message;
}

// Reproduced before the fix: mailbox confirmation activated the pre-registrant's
// existing session and password without proof that the mailbox owner chose them.
test('mailbox verification replaces preregistered credentials and revokes all prior authority', async () => {
  const f = fixture();
  try {
    const email = 'preregistered-victim@example.invalid';
    const original = await register(f, email);
    const attacker = await f.store.login({ email, password }, now);
    await f.store.requestVerification({ email }, now);
    const replacement = f.messages.at(-1)!;
    await assert.rejects(f.store.verifyEmail({ token: original.token, password: ownerPassword }, now), { code: 'INVALID_TOKEN' });
    await assert.rejects(f.store.verifyEmail({ token: replacement.token }, now), { code: 'INVALID_PASSWORD' });
    await f.store.verifyEmail({ token: replacement.token, password: ownerPassword }, now);
    assert.throws(() => f.store.requireSession(attacker.token, { role: 'STUDENT' }, now), { code: 'UNAUTHENTICATED' });
    await assert.rejects(f.store.login({ email, password }, now), { code: 'INVALID_CREDENTIALS' });
    const owner = await f.store.login({ email, password: ownerPassword }, now);
    assert.equal(f.store.requireSession(owner.token, { role: 'STUDENT' }, now).account.emailVerified, true);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM account_action_tokens').get()?.n, 0);
  } finally { f.db.close(); }
});

test('verification rechecks expiry and replacement at commit and cannot be replayed concurrently', async () => {
  const f = fixture();
  try {
    let message = await register(f);
    f.db.prepare('UPDATE account_action_tokens SET expires_at=?').run(new Date(now.getTime()+1).toISOString());
    await assert.rejects(f.store.verifyEmail({ token: message.token, password: ownerPassword }, now), { code: 'INVALID_TOKEN' });
    assert.equal(f.store.getAccount(message.accountId)?.emailVerified, false);
    await f.store.requestVerification({ email: message.email }, now);
    message = f.messages.at(-1)!;
    const pending = f.store.verifyEmail({ token: message.token, password: ownerPassword }, now);
    const replaced = f.store.requestVerification({ email: message.email }, now);
    await assert.rejects(pending, { code: 'INVALID_TOKEN' });
    await replaced;
    message = f.messages.at(-1)!;
    const results = await Promise.allSettled([
      f.store.verifyEmail({ token: message.token, password: ownerPassword }, now),
      f.store.verifyEmail({ token: message.token, password: 'Competing synthetic password 789' }, now),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'INVALID_TOKEN').length, 1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM account_action_tokens').get()?.n, 0);
  } finally { f.db.close(); }
});

// Reproduced before the fix: 30 malformed inputs exhausted a shared 15-minute
// cooldown, denying every mailbox's valid verification and reset token.
test('invalid token floods cannot spend an issued token owner quota or block their valid link', async () => {
  const f = fixture();
  try {
    const message = await register(f);
    for (const token of ['invalid', 'x'.repeat(43)]) {
      for (let i=0; i<35; i++) {
        await assert.rejects(f.store.verifyEmail({ token, password }, now), { code: 'INVALID_TOKEN' });
        await assert.rejects(f.store.resetPassword({ token, password }, now), { code: 'INVALID_TOKEN' });
      }
    }
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM account_auth_limits').get()?.n, 0);
    await f.store.verifyEmail({ token: message.token, password }, now);
    await f.store.requestRecovery({ email: message.email }, now);
    await f.store.resetPassword({ token: f.messages.at(-1)!.token, password: ownerPassword }, now);
    assert.equal((await f.store.login({ email: message.email, password: ownerPassword }, now)).state.authenticated, true);
  } finally { f.db.close(); }
});

test('unknown, expired, wrong-purpose and already-verified legacy tokens fail before password work', async () => {
  const f = fixture();
  try {
    const message = await verify(f);
    const legacyToken = 'l'.repeat(43);
    f.db.prepare('INSERT INTO account_action_tokens(token_hash,account_id,purpose,expires_at,created_at) VALUES(?,?,?,?,?)').run(createHash('sha256').update(legacyToken).digest('hex'), message.accountId, 'VERIFY_EMAIL', new Date(now.getTime()+86400000).toISOString(), now.toISOString());
    await f.store.requestRecovery({ email: message.email }, now);
    const reset = f.messages.at(-1)!;
    const jobs = [hashPassword(password), hashPassword(password)];
    try {
      await assert.rejects(f.store.verifyEmail({ token: legacyToken, password }, now), { code: 'INVALID_TOKEN' });
      await assert.rejects(f.store.verifyEmail({ token: reset.token, password }, now), { code: 'INVALID_TOKEN' });
      await assert.rejects(f.store.resetPassword({ token: 'x'.repeat(43), password }, now), { code: 'INVALID_TOKEN' });
      f.db.prepare("UPDATE account_action_tokens SET expires_at=? WHERE purpose='RESET_PASSWORD'").run(now.toISOString());
      await assert.rejects(f.store.resetPassword({ token: reset.token, password }, now), { code: 'INVALID_TOKEN' });
    } finally { await Promise.all(jobs); }
  } finally { f.db.close(); }
});

// Reproduced before the fix: 118 AUTH_BUSY replies still spent a shared login
// allowance, causing an unrelated user's correct login to fail for 15 minutes.
test('unknown addresses and capacity-rejected requests cannot create a shared authentication cooldown', async () => {
  const f = fixture();
  try {
    const message = await verify(f);
    const outcomes = await Promise.allSettled(Array.from({ length: 120 }, (_, i) => f.store.login({ email: `unknown-${i}@example.invalid`, password: 'wrong' }, now)));
    assert.equal(outcomes.filter(outcome => outcome.status === 'rejected' && outcome.reason.code === 'AUTH_BUSY').length, 118);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM account_auth_limits WHERE action='login'").get()?.n, 0);
    const login = await f.store.login({ email: message.email, password }, now);
    assert.equal(login.state.authenticated, true);
    const before = f.db.prepare('SELECT * FROM account_auth_limits ORDER BY action').all();
    await Promise.all(Array.from({ length: 120 }, (_, i) => f.store.requestRecovery({ email: `unknown-${i}@example.invalid` }, now)));
    assert.deepEqual(f.db.prepare('SELECT * FROM account_auth_limits ORDER BY action').all(), before);
    const jobs = [hashPassword(password), hashPassword(password)];
    try {
      await assert.rejects(f.store.login({ email: message.email, password }, now), { code: 'AUTH_BUSY' });
      assert.deepEqual(f.db.prepare('SELECT * FROM account_auth_limits ORDER BY action').all(), before);
    } finally { await Promise.all(jobs); }
  } finally { f.db.close(); }
});

test('known-account quotas remain owner scoped, exported privately, bounded and deleted with the owner', async () => {
  const f = fixture();
  try {
    const first = await verify(f, 'first@example.invalid');
    const second = await verify(f, 'second@example.invalid');
    for (let i=0; i<8; i++) await assert.rejects(f.store.login({ email: first.email, password: 'wrong' }, now), { code: 'INVALID_CREDENTIALS' });
    await assert.rejects(f.store.login({ email: first.email, password }, now), { code: 'INVALID_CREDENTIALS' });
    await assert.rejects(f.store.login({ email: 'absent@example.invalid', password }, now), { code: 'INVALID_CREDENTIALS' });
    const login = await f.store.login({ email: second.email, password }, now);
    const exported = f.store.exportIdentity(login.token, now);
    assert.deepEqual(exported.authenticationLimits.find(limit => limit.action === 'login'), { action: 'login', count: 1, resetsAt: new Date(now.getTime()+900000).toISOString() });
    assert.equal(JSON.stringify(exported).includes(first.accountId), false);
    assert.throws(() => f.db.prepare('INSERT INTO account_auth_limits VALUES(?,?,1,?)').run(second.accountId, 'unbounded-action', now.getTime()), /CHECK/);
    f.store.deleteAccount(login.token, now);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM account_auth_limits WHERE account_id=?').get(second.accountId)?.n, 0);
    assert.ok(Number(f.db.prepare('SELECT count(*) AS n FROM account_auth_limits WHERE account_id=?').get(first.accountId)?.n) > 0);
  } finally { f.db.close(); }
});
