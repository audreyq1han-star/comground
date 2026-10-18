import { exportOwnerSafetyData } from './safety-repository.ts';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Account, AccountAuthAction, AccountExport, AccountId, AccountIdentityExport, AccountNotificationPurpose, AccountRetentionPolicy, AccountRole, AccountSession, AccountSessionSummary, GenericAccountResponse, IdentityNotification } from '../../../packages/domain/identity-contracts.ts';
import { ACCOUNT_GENERIC_MESSAGE, EMPTY_ACCOUNT_SESSION } from '../../../packages/domain/identity-contracts.ts';
import { isRepositoryError, RepositoryError } from './errors.ts';
import { objectInput } from './http.ts';
import { hashPassword, requirePasswordCapacity, validatePassword, verifyPassword } from './account-password.ts';
import { createYouthStore, readAccountAge, readYouthAccess } from './youth-repository.ts';
import type { RuntimeMode } from '../../../packages/domain/runtime-contracts.ts';

export const ACCOUNT_SESSION_SECONDS = 7 * 86400;
export const ACCOUNT_IDLE_SECONDS = 86400;
export const ACCOUNT_RECENT_SECONDS = 600;
export type AccountStoreOptions = {
  runtimeMode?: RuntimeMode;
  syntheticYouthEnabled?: boolean;
  notificationSink: (db: DatabaseSync, message: IdentityNotification) => void;
  beforeDelete?: (db: DatabaseSync, accountId: AccountId) => void;
  exportPrivateData?: (db: DatabaseSync, accountId: AccountId, now: Date) => Pick<AccountExport,'student'|'notifications'>;
};
type AccountRow = { id: AccountId; email_norm: string; password_hash: string; role: AccountRole; email_verified_at: string | null; adult_attested_at: string | null; created_at: string; updated_at: string };
type SessionRow = { id: string; token_hash: string; account_id: AccountId; created_at: string; last_seen_at: string; expires_at: string; authenticated_at: string };
export type AccountRequirement = { role?: AccountRole; verified?: boolean; recent?: boolean; allowPendingYouth?: boolean };
const error = (code: string, status: number, message: string): never => { throw new RepositoryError(code, status, message); };
const iso = (milliseconds: number) => new Date(milliseconds).toISOString();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const generic = (): GenericAccountResponse => ({ accepted: true, message: ACCOUNT_GENERIC_MESSAGE });
const waitGeneric = () => new Promise<void>(resolve => setTimeout(resolve, 200));
function timestamp(now: Date): number { const value = now.getTime(); if (!Number.isFinite(value)) throw new Error('Invalid account clock'); return value; }
// Keep injected test clocks deterministic while accounting for time spent awaiting KDF work.
function commitClock(now: Date): () => Date { const base=timestamp(now), started=performance.now(); return ()=>new Date(base+Math.max(0,performance.now()-started)); }
export function normalizeAccountEmail(input: unknown): string {
  if (typeof input !== 'string' || input.length > 254) return error('INVALID_EMAIL', 422, 'Provide a valid email address.');
  const value = input.trim().toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value) || value.startsWith('.') || value.includes('..') || value.includes('.@')) return error('INVALID_EMAIL', 422, 'Provide a valid email address.');
  return value;
}
function accountDTO(db: DatabaseSync, row: AccountRow): Account { const access = readYouthAccess(db, row.id); return { id: row.id, email: row.email_norm, role: row.role, emailVerified: row.email_verified_at !== null, adultConfirmed: row.adult_attested_at !== null, ageBand: access.ageBand, admission: access.admission, synthetic: access.synthetic, createdAt: row.created_at }; }
export function getAccountById(db: DatabaseSync, id: string): Account | null { const row = db.prepare('SELECT * FROM accounts WHERE id=?').get(id) as AccountRow | undefined; return row ? accountDTO(db, row) : null; }
export function requireStudentAccount(db: DatabaseSync, owner: string): Account {
  const account = getAccountById(db, owner);
  if (!account || account.role !== 'STUDENT' || !account.emailVerified || (account.ageBand === 'ADULT' && !account.adultConfirmed)) return error('ACCOUNT_REQUIRED', 403, 'A verified student account with current admission is required.');
  if (account.ageBand === 'TEEN_13_17' && account.admission !== 'ADMITTED') return error('YOUTH_REVIEW_REQUIRED', 403, 'Current guardian or school review is required for this synthetic teen profile.');
  return account;
}
export function canDispatchAccountNotification(db: DatabaseSync, message: { purpose: AccountNotificationPurpose; accountId: string; tokenHash: string; expiresAt: string }, now = new Date()): boolean {
  if (readAccountAge(db, message.accountId).ageBand === 'TEEN_13_17') return false;
  const row = db.prepare('SELECT t.expires_at,t.used_at,a.email_verified_at FROM account_action_tokens t JOIN accounts a ON a.id=t.account_id WHERE t.token_hash=? AND t.account_id=? AND t.purpose=?').get(message.tokenHash, message.accountId, message.purpose) as { expires_at: string; used_at: string | null; email_verified_at: string | null } | undefined;
  return !!row && row.used_at === null && row.expires_at === message.expiresAt && Date.parse(row.expires_at) > timestamp(now) && (message.purpose === 'VERIFY_EMAIL' ? row.email_verified_at === null : row.email_verified_at !== null);
}

export function createAccountStore(db: DatabaseSync, options: AccountStoreOptions) {
  db.exec('PRAGMA foreign_keys=ON;');
  if (!(db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys) throw new RepositoryError('ACCOUNT_UNAVAILABLE',503,'Account storage requires foreign-key enforcement.');
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email_norm TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('STUDENT','OPERATOR')), email_verified_at TEXT, adult_attested_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account_sessions (id TEXT NOT NULL UNIQUE, token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, authenticated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS account_sessions_owner ON account_sessions(account_id,created_at);
    CREATE TABLE IF NOT EXISTS account_action_tokens (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, purpose TEXT NOT NULL CHECK(purpose IN ('VERIFY_EMAIL','RESET_PASSWORD')), expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS account_tokens_owner ON account_action_tokens(account_id,purpose);
    CREATE TABLE IF NOT EXISTS account_abuse (bucket_hash TEXT PRIMARY KEY, count INTEGER NOT NULL, resets_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_auth_limits (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, action TEXT NOT NULL CHECK(action IN ('login','VERIFY_EMAIL','RESET_PASSWORD','confirm-verification','reset-password','reauthenticate','change-password')), count INTEGER NOT NULL, resets_at INTEGER NOT NULL, PRIMARY KEY(account_id,action));
    CREATE TABLE IF NOT EXISTS account_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account_security_events (id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,kind TEXT NOT NULL,at TEXT NOT NULL);
  `);
  const syntheticYouthEnabled = options.runtimeMode === 'test' && options.syntheticYouthEnabled === true;
  const youth = createYouthStore(db, syntheticYouthEnabled);
  if (options.runtimeMode === 'production' && db.prepare("SELECT 1 FROM account_age WHERE age_band='TEEN_13_17' LIMIT 1").get()) return error('ACCOUNT_UNAVAILABLE', 503, 'Synthetic teen records cannot be opened in production.');
  db.prepare("INSERT OR IGNORE INTO account_meta(key,value) VALUES('abuse-key',?)").run(randomBytes(32).toString('hex'));
  const abuseKey = (db.prepare("SELECT value FROM account_meta WHERE key='abuse-key'").get() as { value: string }).value;
  function tx<T>(fn: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (e) { db.exec('ROLLBACK'); throw e; } }
  function event(id: AccountId, kind: string, now: Date) { db.prepare('INSERT INTO account_security_events(id,account_id,kind,at) VALUES(?,?,?,?)').run(randomUUID(), id, kind, now.toISOString()); db.prepare('DELETE FROM account_security_events WHERE account_id=? AND id NOT IN(SELECT id FROM account_security_events WHERE account_id=? ORDER BY rowid DESC LIMIT 100)').run(id,id); }
  function accountRow(id: string): AccountRow | undefined { return db.prepare('SELECT * FROM accounts WHERE id=?').get(id) as AccountRow | undefined; }
  function runtimeAccount(row: AccountRow): Account { const account = accountDTO(db, row); if (account.ageBand === 'TEEN_13_17' && !syntheticYouthEnabled) account.admission = 'REVIEW_REQUIRED'; return account; }
  function emailRow(email: string): AccountRow | undefined { return db.prepare('SELECT * FROM accounts WHERE email_norm=?').get(email) as AccountRow | undefined; }
  // Only registration tracks unknown addresses. Its bounded capacity must never
  // prevent an existing account from signing in, verifying or recovering.
  function allowRegistration(email: string, now: Date): boolean {
    return tx(() => {
      const clock = timestamp(now), reset = clock + 15 * 60000;
      db.prepare('DELETE FROM account_abuse WHERE resets_at<=?').run(clock);
      const key = createHmac('sha256', abuseKey).update(`register:${email}`).digest('hex');
      const row = db.prepare('SELECT count FROM account_abuse WHERE bucket_hash=?').get(key) as { count: number } | undefined;
      if ((row?.count ?? 0) >= 3) return false;
      const size = (db.prepare('SELECT COUNT(*) AS n FROM account_abuse').get() as { n: number }).n;
      if (!row && size >= 4096) return false;
      db.prepare('INSERT INTO account_abuse(bucket_hash,count,resets_at) VALUES(?,1,?) ON CONFLICT(bucket_hash) DO UPDATE SET count=count+1').run(key, reset);
      return true;
    });
  }
  // Fixed action names bound this state to seven rows per durable account.
  // Unknown addresses/tokens cannot allocate rows or consume another owner's quota.
  function allowAccount(action: AccountAuthAction, accountId: AccountId, now: Date, limit = 8): boolean {
    return tx(() => {
      const clock = timestamp(now);
      db.prepare('DELETE FROM account_auth_limits WHERE account_id=? AND resets_at<=?').run(accountId,clock);
      const row = db.prepare('SELECT count FROM account_auth_limits WHERE account_id=? AND action=?').get(accountId,action) as { count: number } | undefined;
      if ((row?.count ?? 0) >= limit) return false;
      db.prepare('INSERT INTO account_auth_limits(account_id,action,count,resets_at) VALUES(?,?,1,?) ON CONFLICT(account_id,action) DO UPDATE SET count=count+1').run(accountId,action,clock+15*60000);
      return true;
    });
  }
  function limited(action: AccountAuthAction, accountId: AccountId, now: Date, limit?: number) { if (!allowAccount(action,accountId,now,limit)) error('TOO_MANY_ATTEMPTS',429,'Too many account requests. Wait fifteen minutes before trying again.'); }
  function sessionRow(token: string | null, now: Date, touch = true): SessionRow | null {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = db.prepare('SELECT * FROM account_sessions WHERE token_hash=?').get(digest(token)) as SessionRow | undefined;
    if (!row) return null;
    const clock = timestamp(now);
    if (Date.parse(row.expires_at) <= clock || Date.parse(row.last_seen_at) + ACCOUNT_IDLE_SECONDS * 1000 <= clock || Date.parse(row.created_at) > clock) { db.prepare('DELETE FROM account_sessions WHERE token_hash=?').run(row.token_hash); return null; }
    if (touch && clock - Date.parse(row.last_seen_at) >= 60000) db.prepare('UPDATE account_sessions SET last_seen_at=? WHERE token_hash=?').run(now.toISOString(),row.token_hash);
    return row;
  }
  function requireSession(token: string | null, requirement: AccountRequirement = {}, now = new Date()): { account: Account; session: SessionRow } {
    const session = sessionRow(token,now), row = session ? accountRow(session.account_id) : undefined;
    if (!session || !row) return error('UNAUTHENTICATED',401,'Sign in to your account to continue.');
    const account = runtimeAccount(row);
    if (requirement.verified !== false && !account.emailVerified) return error('EMAIL_VERIFICATION_REQUIRED',403,'Verify your email address to continue.');
    if ((account.ageBand === 'ADULT' ? !account.adultConfirmed : options.runtimeMode !== 'test' || !account.synthetic) || (requirement.role && account.role !== requirement.role)) return error('FORBIDDEN',403,'This account does not have permission for this action.');
    if (requirement.role === 'OPERATOR' && account.ageBand !== 'ADULT') return error('FORBIDDEN',403,'This account does not have permission for this action.');
    if (requirement.role === 'STUDENT' && !requirement.allowPendingYouth && account.admission !== 'ADMITTED') return error('YOUTH_REVIEW_REQUIRED',403,'Current guardian or school review is required for this synthetic teen profile.');
    if (requirement.recent && Date.parse(session.authenticated_at) + ACCOUNT_RECENT_SECONDS * 1000 <= timestamp(now)) return error('RECENT_AUTH_REQUIRED',403,'Confirm your password again before this sensitive action.');
    return { account, session };
  }
  function stateFor(row: SessionRow): AccountSession { const account = accountRow(row.account_id); return account ? { authenticated:true,account:runtimeAccount(account),expiresAt:row.expires_at,recentAuthUntil:iso(Date.parse(row.authenticated_at)+ACCOUNT_RECENT_SECONDS*1000) } : { ...EMPTY_ACCOUNT_SESSION }; }
  function readSession(token: string | null, now = new Date()): AccountSession { const row = sessionRow(token,now); return row ? stateFor(row) : { ...EMPTY_ACCOUNT_SESSION }; }
  function newSession(id: AccountId, now: Date): { token: string; state: AccountSession } {
    db.prepare('DELETE FROM account_sessions WHERE expires_at<=? OR last_seen_at<=?').run(now.toISOString(),iso(timestamp(now)-ACCOUNT_IDLE_SECONDS*1000));
    db.prepare('DELETE FROM account_sessions WHERE account_id=? AND id NOT IN(SELECT id FROM account_sessions WHERE account_id=? ORDER BY created_at DESC,rowid DESC LIMIT 9)').run(id,id);
    const token = randomBytes(32).toString('base64url'), at=now.toISOString();
    const row: SessionRow = { id:randomUUID(),token_hash:digest(token),account_id:id,created_at:at,last_seen_at:at,expires_at:iso(timestamp(now)+ACCOUNT_SESSION_SECONDS*1000),authenticated_at:at };
    db.prepare('INSERT INTO account_sessions(id,token_hash,account_id,created_at,last_seen_at,expires_at,authenticated_at) VALUES(?,?,?,?,?,?,?)').run(row.id,row.token_hash,id,at,at,row.expires_at,at);
    return { token,state:stateFor(row) };
  }
  function issueToken(row: AccountRow, purpose: AccountNotificationPurpose, now: Date) {
    db.prepare('DELETE FROM account_action_tokens WHERE account_id=? AND purpose=?').run(row.id,purpose);
    db.prepare('DELETE FROM account_action_tokens WHERE expires_at<=?').run(now.toISOString());
    const token=randomBytes(32).toString('base64url'), expiresAt=iso(timestamp(now)+(purpose==='VERIFY_EMAIL'?86400:1800)*1000);
    db.prepare('INSERT INTO account_action_tokens(token_hash,account_id,purpose,expires_at,created_at) VALUES(?,?,?,?,?)').run(digest(token),row.id,purpose,expiresAt,now.toISOString());
    options.notificationSink(db,{purpose,accountId:row.id,email:row.email_norm,token,expiresAt});
  }
  function actionToken(token: unknown, purpose: AccountNotificationPurpose, now: Date, consume = true): AccountRow {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return error('INVALID_TOKEN',422,'This account link is invalid or has expired. Request a new one.');
    const value=db.prepare('SELECT account_id,expires_at,used_at FROM account_action_tokens WHERE token_hash=? AND purpose=?').get(digest(token),purpose) as {account_id:string;expires_at:string;used_at:string|null}|undefined;
    if (!value || value.used_at || Date.parse(value.expires_at)<=timestamp(now)) return error('INVALID_TOKEN',422,'This account link is invalid or has expired. Request a new one.');
    const account=accountRow(value.account_id);
    if(!account || (purpose==='VERIFY_EMAIL' ? account.email_verified_at!==null : account.email_verified_at===null)) return error('INVALID_TOKEN',422,'This account link is invalid or has expired. Request a new one.');
    if(consume) db.prepare('UPDATE account_action_tokens SET used_at=? WHERE token_hash=?').run(now.toISOString(),digest(token)); return account;
  }
  async function register(input: unknown, now = new Date()): Promise<GenericAccountResponse> {
    const value=objectInput(input,['email','password','adultConfirmed','ageBand','synthetic']);
    if (value.ageBand === 'UNDER_13') return error('UNDER_13_UNSUPPORTED',403,'Accounts for children under 13 are not supported.');
    const teen = value.ageBand === 'TEEN_13_17';
    if (teen && !syntheticYouthEnabled) return error('TEEN_ENROLLMENT_DISABLED',403,'Real minor enrollment is disabled pending approved policy, consent verification and safeguarding.');
    if (value.ageBand !== undefined && value.ageBand !== 'ADULT' && value.ageBand !== 'TEEN_13_17') return error('INVALID_INPUT',422,'Choose an age band.');
    if (teen ? value.synthetic !== true || (value.adultConfirmed !== undefined && value.adultConfirmed !== false) : value.synthetic !== undefined) return error('SYNTHETIC_IDENTITY_REQUIRED',422,'Use the explicitly labeled synthetic teen workflow.');
    if (!teen && value.adultConfirmed!==true) return error('ADULT_CONFIRMATION_REQUIRED',422,'Confirm that you are aged 18 or older for the adult account path.');
    const email=normalizeAccountEmail(value.email), password=validatePassword(value.password);
    if (teen && !email.endsWith('.invalid')) return error('SYNTHETIC_IDENTITY_REQUIRED',422,'Synthetic accounts must use a reserved address ending in .invalid.');
    const response = () => teen ? { accepted: true as const, message: 'Synthetic account request accepted. Sign in to continue the local review workflow.' } : generic();
    requirePasswordCapacity();
    if(!allowRegistration(email,now)) { await waitGeneric(); return response(); }
    const passwordHash=await hashPassword(password);
    tx(()=>{ if(emailRow(email)) return; const id=`account-${randomUUID()}` as AccountId, at=now.toISOString(); db.prepare("INSERT INTO accounts(id,email_norm,password_hash,role,email_verified_at,adult_attested_at,created_at,updated_at) VALUES(?,?,?,'STUDENT',?,?,?,?)").run(id,email,passwordHash,teen?at:null,teen?null:at,at,at); db.prepare('INSERT INTO account_age(account_id,age_band,synthetic,attested_at) VALUES(?,?,?,?)').run(id,teen?'TEEN_13_17':'ADULT',Number(teen),at); if(!teen) issueToken(accountRow(id)!,'VERIFY_EMAIL',now); event(id,teen?'SYNTHETIC_TEEN_REGISTERED':'REGISTERED',now); });
    return response();
  }
  async function login(input: unknown, now = new Date()) {
    const value=objectInput(input,['email','password']),email=normalizeAccountEmail(value.email);
    requirePasswordCapacity();
    const row=emailRow(email);
    const allowed=!row || allowAccount('login',row.id,now);
    // Exhausted accounts follow the unknown-account KDF and error path. A
    // distinct throttling response would disclose registration after eight tries.
    const valid=await verifyPassword(value.password,allowed?row?.password_hash??null:null);
    if(!row || !allowed || !valid) return error('INVALID_CREDENTIALS',401,'The email or password is incorrect.');
    return tx(()=>{ const current=accountRow(row.id); if(!current || current.password_hash!==row.password_hash) return error('INVALID_CREDENTIALS',401,'The email or password is incorrect.'); event(row.id,'SIGNED_IN',now); return newSession(row.id,now); });
  }
  async function requestAction(input: unknown,purpose:AccountNotificationPurpose,now=new Date()):Promise<GenericAccountResponse> {
    const value=objectInput(input,['email']),email=normalizeAccountEmail(value.email);
    const candidate=emailRow(email);
    const applicable=candidate && (purpose==='VERIFY_EMAIL' ? candidate.email_verified_at===null : candidate.email_verified_at!==null);
    const allowed=applicable && allowAccount(purpose,candidate.id,now,3);
    if(allowed) {
      try { tx(()=>{ const row=emailRow(email); if(row && (purpose==='VERIFY_EMAIL' ? row.email_verified_at===null : row.email_verified_at!==null)) issueToken(row,purpose,now); }); }
      catch(error) {
        // The transaction has rolled back token changes. Public requests must not
        // reveal whether an address exists or has been suppressed by the provider.
        if(!isRepositoryError(error) || error.code!=='NOTIFICATION_RECIPIENT_SUPPRESSED') throw error;
      }
    }
    await waitGeneric(); return generic();
  }
  async function verifyEmail(input:unknown,now=new Date()):Promise<GenericAccountResponse> {
    const currentTime=commitClock(now);
    const value=objectInput(input,['token','password']),password=validatePassword(value.password);
    const initial=actionToken(value.token,'VERIFY_EMAIL',now,false);
    requirePasswordCapacity(); limited('confirm-verification',initial.id,now,30);
    const passwordHash=await hashPassword(password);
    return tx(()=>{ const committed=currentTime(),row=actionToken(value.token,'VERIFY_EMAIL',committed); db.prepare('UPDATE accounts SET password_hash=?,email_verified_at=?,updated_at=? WHERE id=?').run(passwordHash,committed.toISOString(),committed.toISOString(),row.id); db.prepare('DELETE FROM account_sessions WHERE account_id=?').run(row.id); db.prepare('DELETE FROM account_action_tokens WHERE account_id=?').run(row.id); event(row.id,'EMAIL_VERIFIED',committed); return generic(); });
  }
  async function resetPassword(input:unknown,now=new Date()):Promise<GenericAccountResponse> {
    const currentTime=commitClock(now);
    const value=objectInput(input,['token','password']),password=validatePassword(value.password);
    // Reject unknown, expired and wrong-purpose tokens before expensive hashing.
    const initial=actionToken(value.token,'RESET_PASSWORD',now,false);
    requirePasswordCapacity(); limited('reset-password',initial.id,now,30);
    const passwordHash=await hashPassword(password);
    return tx(()=>{ const committed=currentTime(),row=actionToken(value.token,'RESET_PASSWORD',committed); db.prepare('UPDATE accounts SET password_hash=?,updated_at=? WHERE id=?').run(passwordHash,committed.toISOString(),row.id); db.prepare('DELETE FROM account_sessions WHERE account_id=?').run(row.id); db.prepare('DELETE FROM account_action_tokens WHERE account_id=?').run(row.id); event(row.id,'PASSWORD_RESET',committed); return generic(); });
  }
  async function reauthenticate(token:string|null,input:unknown,now=new Date()) {
    const currentTime=commitClock(now);
    const value=objectInput(input,['password']), initial=requireSession(token,{verified:false},now), row=accountRow(initial.account.id)!;
    requirePasswordCapacity(); limited('reauthenticate',row.id,now);
    if(!await verifyPassword(value.password,row.password_hash)) return error('INVALID_CREDENTIALS',401,'The password is incorrect.');
    return tx(()=>{ const current=requireSession(token,{verified:false},currentTime()); if(accountRow(row.id)?.password_hash!==row.password_hash) return error('INVALID_CREDENTIALS',401,'The password changed. Sign in again.'); db.prepare('DELETE FROM account_sessions WHERE token_hash=?').run(current.session.token_hash); event(row.id,'REAUTHENTICATED',now); return newSession(row.id,now); });
  }
  async function changePassword(token:string|null,input:unknown,now=new Date()) {
    const currentTime=commitClock(now);
    const value=objectInput(input,['currentPassword','newPassword']), password=validatePassword(value.newPassword), initial=requireSession(token,{},now), row=accountRow(initial.account.id)!;
    requirePasswordCapacity(); limited('change-password',row.id,now);
    if(!await verifyPassword(value.currentPassword,row.password_hash)) return error('INVALID_CREDENTIALS',401,'The current password is incorrect.');
    const passwordHash=await hashPassword(password);
    return tx(()=>{ requireSession(token,{},currentTime()); if(accountRow(row.id)?.password_hash!==row.password_hash) return error('INVALID_CREDENTIALS',401,'The password changed. Sign in again.'); db.prepare('UPDATE accounts SET password_hash=?,updated_at=? WHERE id=?').run(passwordHash,now.toISOString(),row.id); db.prepare('DELETE FROM account_sessions WHERE account_id=?').run(row.id); db.prepare('DELETE FROM account_action_tokens WHERE account_id=?').run(row.id); event(row.id,'PASSWORD_CHANGED',now); return newSession(row.id,now); });
  }
  function logout(token:string|null) { if(token && token.length<=256) db.prepare('DELETE FROM account_sessions WHERE token_hash=?').run(digest(token)); }
  function listSessions(token:string|null,now=new Date()):AccountSessionSummary[] {
    const current=requireSession(token,{verified:false},now);
    return (db.prepare('SELECT * FROM account_sessions WHERE account_id=? AND expires_at>? AND last_seen_at>? ORDER BY created_at DESC,id').all(current.account.id,now.toISOString(),iso(timestamp(now)-ACCOUNT_IDLE_SECONDS*1000)) as SessionRow[]).map(row=>({id:row.id,createdAt:row.created_at,lastSeenAt:row.last_seen_at,expiresAt:row.expires_at,current:row.token_hash===current.session.token_hash}));
  }
  function revokeSessions(token:string|null,id:string|null,now=new Date()):boolean {
    return tx(()=>{ const current=requireSession(token,{recent:true},now); if(id!==null && !/^[a-f0-9-]{36}$/.test(id)) return error('INVALID_INPUT',422,'Select a valid session.'); if(id===null) db.prepare('DELETE FROM account_sessions WHERE account_id=?').run(current.account.id); else db.prepare('DELETE FROM account_sessions WHERE account_id=? AND id=?').run(current.account.id,id); event(current.account.id,'SESSIONS_REVOKED',now); return id===null || id===current.session.id; });
  }
  function deleteAccount(token:string|null,now=new Date()):void {
    tx(()=>{ const current=requireSession(token,{recent:true,verified:false},now); if(!options.beforeDelete) return error('ACCOUNT_DELETE_UNAVAILABLE',503,'Account deletion is not configured.'); options.beforeDelete(db,current.account.id); db.prepare('DELETE FROM accounts WHERE id=?').run(current.account.id); });
  }
  function exportIdentity(token:string|null,now=new Date()):AccountIdentityExport {
    const current=requireSession(token,{recent:true,verified:false},now), row=accountRow(current.account.id)!;
    const authenticationLimits=(db.prepare('SELECT action,count,resets_at FROM account_auth_limits WHERE account_id=? ORDER BY action').all(current.account.id) as {action:AccountAuthAction;count:number;resets_at:number}[]).map(limit=>({action:limit.action,count:limit.count,resetsAt:iso(limit.resets_at)}));
    return {account:current.account,verification:{emailVerifiedAt:row.email_verified_at,adultAttestedAt:row.adult_attested_at,ageAttestedAt:readAccountAge(db,row.id).attestedAt ?? row.adult_attested_at},youth:youth.exportData(current.account.id),sessions:listSessions(token,now),securityEvents:db.prepare('SELECT kind,at FROM account_security_events WHERE account_id=? ORDER BY at,rowid').all(current.account.id) as {kind:string;at:string}[],authenticationLimits};
  }
  function exportData(token:string|null,now=new Date()):AccountExport {
    return tx(()=>{
      const identity=exportIdentity(token,now);
      if(!options.exportPrivateData)return error('ACCOUNT_EXPORT_UNAVAILABLE',503,'Full account export is not configured.');
      const usage=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_usage'").get()
        ? db.prepare('SELECT day,count,last_at FROM ai_usage WHERE owner=?').get(identity.account.id) as {day:string;count:number;last_at:number}|undefined
        : undefined;
      const aiUsage=usage ? {day:usage.day,count:usage.count,lastAt:new Date(usage.last_at).toISOString()} : null;
      return {schemaVersion:1,exportedAt:now.toISOString(),identity,...options.exportPrivateData(db,identity.account.id,now),safety:exportOwnerSafetyData(db,identity.account.id),aiUsage};
    });
  }
  /** Explicit maintenance only: callers must approve/pass the retention policy. Never run on startup. */
  function maintain(policy:AccountRetentionPolicy,now=new Date()) {
    if(!policy || !Number.isSafeInteger(policy.unverifiedDays) || policy.unverifiedDays<7 || policy.unverifiedDays>365 || !Number.isSafeInteger(policy.securityEventDays) || policy.securityEventDays<7 || policy.securityEventDays>365) return error('INVALID_RETENTION_POLICY',422,'Account retention must use explicit whole-day policies between 7 and 365 days.');
    return tx(()=>{
      const clock=timestamp(now), at=now.toISOString(), cutoff=iso(clock-policy.unverifiedDays*86400000);
      // Recent authenticated activity keeps an unverified account from being considered abandoned.
      const abandoned=db.prepare('SELECT id FROM accounts a WHERE email_verified_at IS NULL AND created_at<? AND updated_at<? AND NOT EXISTS(SELECT 1 FROM account_security_events e WHERE e.account_id=a.id AND e.at>=?) AND NOT EXISTS(SELECT 1 FROM account_sessions s WHERE s.account_id=a.id AND s.last_seen_at>=?)').all(cutoff,cutoff,cutoff,cutoff) as {id:AccountId}[];
      if(abandoned.length && !options.beforeDelete) return error('ACCOUNT_DELETE_UNAVAILABLE',503,'Account retention cleanup is not configured.');
      for(const {id} of abandoned){options.beforeDelete!(db,id);db.prepare('DELETE FROM accounts WHERE id=?').run(id);}
      const expiredSessions=Number(db.prepare('DELETE FROM account_sessions WHERE expires_at<=? OR last_seen_at<=?').run(at,iso(clock-ACCOUNT_IDLE_SECONDS*1000)).changes);
      const expiredTokens=Number(db.prepare('DELETE FROM account_action_tokens WHERE expires_at<=?').run(at).changes);
      const expiredAbuseBuckets=Number(db.prepare('DELETE FROM account_abuse WHERE resets_at<=?').run(clock).changes)+Number(db.prepare('DELETE FROM account_auth_limits WHERE resets_at<=?').run(clock).changes);
      const expiredSecurityEvents=Number(db.prepare('DELETE FROM account_security_events WHERE at<?').run(iso(clock-policy.securityEventDays*86400000)).changes);
      return {abandonedAccounts:abandoned.length,expiredSessions,expiredTokens,expiredAbuseBuckets,expiredSecurityEvents};
    });
  }
  // Operations-only bootstrap: never exposed by an HTTP route and never auto-run.
  function bootstrapOperator(accountId:string,now=new Date()):Account {
    return tx(()=>{ const row=accountRow(accountId); if(!row || !row.email_verified_at || !row.adult_attested_at || readAccountAge(db, accountId).ageBand !== 'ADULT') return error('ACCOUNT_REQUIRED',422,'Bootstrap requires an existing verified adult account.'); if((db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE role='OPERATOR'").get() as {n:number}).n>0) return error('BOOTSTRAP_CLOSED',409,'An operator already exists; bootstrap is closed.'); db.prepare("UPDATE accounts SET role='OPERATOR',updated_at=? WHERE id=?").run(now.toISOString(),row.id); db.prepare('DELETE FROM account_sessions WHERE account_id=?').run(row.id); event(row.id,'OPERATOR_BOOTSTRAPPED',now); return accountDTO(db, accountRow(row.id)!); });
  }
  return { youth,register,login,readSession,requireSession,requestVerification:(input:unknown,now?:Date)=>requestAction(input,'VERIFY_EMAIL',now),requestRecovery:(input:unknown,now?:Date)=>requestAction(input,'RESET_PASSWORD',now),verifyEmail,resetPassword,reauthenticate,changePassword,logout,listSessions,revokeSessions,deleteAccount,exportIdentity,exportData,maintain,bootstrapOperator,getAccount:(id:string)=>getAccountById(db,id) };
}
export function createAccountRepository(filename:string,options:AccountStoreOptions) {
  if(filename!==':memory:') mkdirSync(dirname(filename),{recursive:true,mode:0o700});
  const db=new DatabaseSync(filename); db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  try { return {...createAccountStore(db,options),close:()=>db.close()}; } catch(error) { db.close(); throw error; }
}
export type AccountRepository = ReturnType<typeof createAccountRepository>;
