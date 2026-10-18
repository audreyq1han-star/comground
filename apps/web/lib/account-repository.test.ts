import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IdentityNotification } from '../../../packages/domain/identity-contracts.ts';
import { ACCOUNT_GENERIC_MESSAGE } from '../../../packages/domain/identity-contracts.ts';
import { canDispatchAccountNotification, createAccountStore, requireStudentAccount, type AccountStoreOptions } from './account-repository.ts';
import { hashPassword, validatePassword, verifyPassword } from './account-password.ts';
import { RepositoryError } from './errors.ts';

const now=new Date('2031-05-01T12:00:00Z');
const email='adult@example.invalid',password='A synthetic long passphrase 123';
const later=(seconds:number)=>new Date(now.getTime()+seconds*1000);
function setup(filename=':memory:',overrides:Partial<AccountStoreOptions>={}) {
  const db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const messages:IdentityNotification[]=[];
  const store=createAccountStore(db,{notificationSink:(_db,message)=>messages.push(structuredClone(message)),beforeDelete:()=>{},...overrides});
  return {db,messages,store,close:()=>db.close()};
}
async function verified(state:ReturnType<typeof setup>,address=email) {
  await state.store.register({email:address,password,adultConfirmed:true},now);
  const message=state.messages.at(-1)!;
  await state.store.verifyEmail({token:message.token,password},now);
  return (await state.store.login({email:address,password},now));
}

test('passwords use salted scrypt and enforce bounded passphrases without truncation',async()=>{
  assert.throws(()=>validatePassword('short'),{code:'INVALID_PASSWORD'});
  assert.throws(()=>validatePassword('a'.repeat(129)),{code:'INVALID_PASSWORD'});
  const encoded=await hashPassword(password), second=await hashPassword(password);
  assert.match(encoded,/^scrypt\$131072\$8\$1\$/);assert.notEqual(encoded,second);
  assert.equal(await verifyPassword(password,encoded),true);
  assert.equal(await verifyPassword('wrong',encoded),false);
  assert.equal(await verifyPassword(password,null),false);
  assert.equal(await verifyPassword(password,'malformed'),false);
});

test('register is generic, canonical, adult-only and cannot choose roles or replace existing credentials',async()=>{
  const state=setup();
  try {
    const first=await state.store.register({email:' Adult@Example.Invalid ',password,adultConfirmed:true},now);
    const second=await state.store.register({email,password:'Different synthetic password 456',adultConfirmed:true},now);
    assert.deepEqual(first,second);assert.equal(first.message,ACCOUNT_GENERIC_MESSAGE);assert.equal(state.messages.length,1);
    const row=state.db.prepare('SELECT * FROM accounts').get() as Record<string,unknown>;
    assert.equal(row.email_norm,email);assert.equal(row.role,'STUDENT');assert.match(String(row.id),/^account-/);
    assert.notEqual(row.password_hash,password);assert.equal(row.email_verified_at,null);assert.equal(row.adult_attested_at,now.toISOString());
    await assert.rejects(state.store.register({email:'other@example.invalid',password,adultConfirmed:false}),{code:'ADULT_CONFIRMATION_REQUIRED'});
    await assert.rejects(state.store.register({email:'other@example.invalid',password,adultConfirmed:true,role:'OPERATOR'}),{code:'INVALID_INPUT'});
    const login=await state.store.login({email,password},now);
    assert.equal(login.state.account?.emailVerified,false);
    assert.throws(()=>state.store.requireSession(login.token,{},now),{code:'EMAIL_VERIFICATION_REQUIRED'});
    assert.throws(()=>requireStudentAccount(state.db,String(row.id)),{code:'ACCOUNT_REQUIRED'});
    assert.equal(state.store.requireSession(login.token,{verified:false},now).account.id,row.id);
    const json=JSON.stringify(login.state);assert.equal(json.includes(login.token),false);assert.equal(json.includes(String(row.password_hash)),false);
  }finally{state.close();}
});

test('verification is hashed, purpose-bound, expiring and single use; dispatch rechecks exact token',async()=>{
  const state=setup();
  try {
    await state.store.register({email,password,adultConfirmed:true},now);
    const message=state.messages[0];
    const tokenHash=createHash('sha256').update(message.token).digest('hex');
    const stored=state.db.prepare('SELECT * FROM account_action_tokens').get() as Record<string,unknown>;
    assert.equal(stored.token_hash,tokenHash);assert.equal(JSON.stringify(stored).includes(message.token),false);
    assert.equal(canDispatchAccountNotification(state.db,{...message,tokenHash},now),true);
    assert.equal(canDispatchAccountNotification(state.db,{...message,tokenHash,purpose:'RESET_PASSWORD'},now),false);
    await assert.rejects(state.store.verifyEmail({token:message.token,password},later(86401)),{code:'INVALID_TOKEN'});
    await state.store.verifyEmail({token:message.token,password},now);
    assert.equal(canDispatchAccountNotification(state.db,{...message,tokenHash},now),false);
    await assert.rejects(state.store.verifyEmail({token:message.token,password},now),{code:'INVALID_TOKEN'});
    assert.equal(requireStudentAccount(state.db,message.accountId).emailVerified,true);
  }finally{state.close();}
});

test('sessions survive restart, store only hashes, expire by idle and absolute clocks and revoke by owner',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'comground-account-')),filename=join(folder,'test.sqlite');let state=setup(filename);
  try {
    const first=await verified(state), second=await state.store.login({email,password},now);
    const stored=state.db.prepare('SELECT * FROM account_sessions').all();assert.equal(JSON.stringify(stored).includes(first.token),false);
    const accountId=first.state.account!.id;
    state.close();state=setup(filename);
    assert.equal(state.store.readSession(first.token,now).account?.id,accountId);
    assert.equal(state.store.readSession(first.token+'x',now).authenticated,false);
    assert.equal(state.store.listSessions(first.token,now).length,2);
    const other=state.store.listSessions(first.token,now).find(row=>!row.current)!;
    assert.equal(state.store.revokeSessions(first.token,other.id,now),false);
    assert.equal(state.store.readSession(second.token,now).authenticated,false);
    assert.equal(state.store.readSession(first.token,later(86401)).authenticated,false);
    const absolute=await state.store.login({email,password},now);
    state.db.prepare('UPDATE account_sessions SET last_seen_at=? WHERE account_id=?').run(later(7*86400-1).toISOString(),accountId);
    assert.equal(state.store.readSession(absolute.token,later(7*86400)).authenticated,false);
  }finally{state.close();rmSync(folder,{recursive:true,force:true});}
});

test('recovery is generic and reset revokes all sessions, tokens and the previous password',async()=>{
  const state=setup();
  try {
    const login=await verified(state);await state.store.login({email,password},now);
    const known=await state.store.requestRecovery({email},now),unknown=await state.store.requestRecovery({email:'missing@example.invalid'},now);
    assert.deepEqual(known,unknown);assert.equal(state.messages.length,2);
    const reset=state.messages.at(-1)!;assert.equal(reset.purpose,'RESET_PASSWORD');
    await assert.rejects(state.store.verifyEmail({token:reset.token,password},now),{code:'INVALID_TOKEN'});
    const next='A changed synthetic passphrase 789';
    await state.store.resetPassword({token:reset.token,password:next},now);
    assert.equal(state.store.readSession(login.token,now).authenticated,false);
    await assert.rejects(state.store.login({email,password},now),{code:'INVALID_CREDENTIALS'});
    assert.equal((await state.store.login({email,password:next},now)).state.account?.emailVerified,true);
    await assert.rejects(state.store.resetPassword({token:reset.token,password:next},now),{code:'INVALID_TOKEN'});
    assert.equal((state.db.prepare('SELECT COUNT(*) AS n FROM account_action_tokens').get() as {n:number}).n,0);
  }finally{state.close();}
});

test('password change and reauthentication rotate sessions and require fresh proof for sensitive actions',async()=>{
  const state=setup();
  try {
    const login=await verified(state), another=await state.store.login({email,password},now);
    assert.throws(()=>state.store.revokeSessions(login.token,null,later(601)),{code:'RECENT_AUTH_REQUIRED'});
    const renewed=await state.store.reauthenticate(login.token,{password},later(601));
    assert.equal(state.store.readSession(login.token,later(601)).authenticated,false);
    assert.notEqual(renewed.token,login.token);
    const changed=await state.store.changePassword(renewed.token,{currentPassword:password,newPassword:'Another long synthetic passphrase'},later(602));
    assert.equal(state.store.readSession(renewed.token,later(602)).authenticated,false);
    assert.equal(state.store.readSession(another.token,later(602)).authenticated,false);
    assert.equal(state.store.readSession(changed.token,later(602)).authenticated,true);
    state.store.logout(changed.token);assert.equal(state.store.readSession(changed.token,later(602)).authenticated,false);
  }finally{state.close();}
});

test('persistent abuse controls survive restart, bound buckets and do not store raw identities',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'comground-auth-limit-')),filename=join(folder,'test.sqlite');let state=setup(filename);
  try {
    await state.store.register({email,password,adultConfirmed:true},now);
    for(let i=0;i<8;i++)await assert.rejects(state.store.login({email,password:'wrong'},now),{code:'INVALID_CREDENTIALS'});
    state.close();state=setup(filename);
    await assert.rejects(state.store.login({email,password},now),{code:'INVALID_CREDENTIALS'});
    assert.equal(JSON.stringify(state.db.prepare('SELECT * FROM account_abuse').all()).includes(email),false);
    assert.equal(JSON.stringify(state.db.prepare('SELECT * FROM account_auth_limits').all()).includes(email),false);
    await assert.rejects(state.store.login({email,password:'wrong'},later(901)),{code:'INVALID_CREDENTIALS'});
    state.db.prepare('DELETE FROM account_abuse WHERE resets_at<=?').run(later(902).getTime());
    const insert=state.db.prepare('INSERT OR IGNORE INTO account_abuse(bucket_hash,count,resets_at) VALUES(?,1,?)');
    for(let i=0;i<4096;i++)insert.run(`test-${i}`,later(1800).getTime());
    const before=(state.db.prepare('SELECT COUNT(*) AS n FROM account_abuse').get() as {n:number}).n;
    await assert.rejects(state.store.login({email:'new@example.invalid',password:'wrong'},later(902)),{code:'INVALID_CREDENTIALS'});
    assert.equal((await state.store.login({email,password},later(902))).state.authenticated,true,'registration bucket capacity must not block existing accounts');
    assert.equal((await state.store.register({email:'new@example.invalid',password,adultConfirmed:true},later(902))).accepted,true);
    assert.equal(state.db.prepare('SELECT 1 FROM accounts WHERE email_norm=?').get('new@example.invalid'),undefined,'new registration fails closed when bucket capacity is full');
    assert.equal((state.db.prepare('SELECT COUNT(*) AS n FROM account_abuse').get() as {n:number}).n,before);
  }finally{state.close();rmSync(folder,{recursive:true,force:true});}
});

test('registration and token issuance roll back when the transactional notification sink fails',async()=>{
  const state=setup(':memory:',{notificationSink:(db)=>{db.exec('CREATE TABLE transient_delivery(id TEXT);');throw new Error('synthetic sink failure');}});
  try {
    await assert.rejects(state.store.register({email,password,adultConfirmed:true},now),/synthetic sink failure/);
    for(const table of ['accounts','account_action_tokens','account_sessions'])assert.equal((state.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {n:number}).n,0);
    assert.equal(state.db.prepare("SELECT name FROM sqlite_master WHERE name='transient_delivery'").get(),undefined);
  }finally{state.close();}
});

test('suppressed verification and recovery requests remain generic and roll back token and queue changes',async()=>{
  for(const purpose of ['VERIFY_EMAIL','RESET_PASSWORD'] as const){
    let suppressed=false;
    const messages:IdentityNotification[]=[];
    const state=setup(':memory:',{notificationSink:(db,message)=>{
      if(suppressed){
        // Even a sink that touched its queue before discovering suppression must roll back.
        db.prepare('INSERT INTO synthetic_queue VALUES(?)').run(message.accountId);
        throw new RepositoryError('NOTIFICATION_RECIPIENT_SUPPRESSED',409,'Recipient is suppressed.');
      }
      messages.push(message);
    }});
    try{
      state.db.exec('CREATE TABLE synthetic_queue(owner TEXT)');
      await state.store.register({email,password,adultConfirmed:true},now);
      if(purpose==='RESET_PASSWORD'){
        await state.store.verifyEmail({token:messages[0].token,password},now);
        await state.store.requestRecovery({email},now);
      }
      const before=state.db.prepare('SELECT * FROM account_action_tokens ORDER BY token_hash').all();
      const delivered=messages.length;
      suppressed=true;
      const request=purpose==='VERIFY_EMAIL'?state.store.requestVerification:state.store.requestRecovery;
      const started=performance.now(),known=await request({email},now);
      assert.ok(performance.now()-started>=150,'suppressed requests retain the public generic delay');
      const unknown=await request({email:'unknown-suppressed@example.invalid'},now);
      assert.deepEqual(known,unknown);assert.equal(known.message,ACCOUNT_GENERIC_MESSAGE);
      assert.deepEqual(state.db.prepare('SELECT * FROM account_action_tokens ORDER BY token_hash').all(),before);
      assert.equal(messages.length,delivered);
      assert.equal((state.db.prepare('SELECT COUNT(*) AS n FROM synthetic_queue').get() as {n:number}).n,0);
    }finally{state.close();}
  }
});

test('account deletion is atomic, cascades identities and refuses deletion without configured lifecycle cleanup',async()=>{
  let shouldFail=true;
  const state=setup(':memory:',{beforeDelete:(db,id)=>{db.prepare('DELETE FROM private_example WHERE owner=?').run(id);if(shouldFail)throw new Error('synthetic cleanup failure');}});
  try {
    const login=await verified(state),id=login.state.account!.id;
    state.db.exec('CREATE TABLE private_example(owner TEXT,value TEXT); CREATE TABLE queued_example(owner TEXT REFERENCES accounts(id) ON DELETE CASCADE);');
    state.db.prepare('INSERT INTO private_example VALUES(?,?)').run(id,'synthetic');state.db.prepare('INSERT INTO queued_example VALUES(?)').run(id);
    assert.throws(()=>state.store.deleteAccount(login.token,now),/synthetic cleanup failure/);
    assert.ok(state.store.getAccount(id));assert.equal(state.store.readSession(login.token,now).authenticated,true);
    assert.equal((state.db.prepare('SELECT COUNT(*) AS n FROM private_example').get() as {n:number}).n,1);
    shouldFail=false;state.store.deleteAccount(login.token,now);
    assert.equal(state.store.getAccount(id),null);assert.equal(state.store.readSession(login.token,now).authenticated,false);
    for(const table of ['private_example','queued_example','account_sessions','account_action_tokens','account_security_events','account_auth_limits'])assert.equal((state.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {n:number}).n,0);
  }finally{state.close();}
});

test('operator bootstrap is explicit, verified, one-time and revokes prior student sessions',async()=>{
  const state=setup();
  try {
    const login=await verified(state), id=login.state.account!.id;
    assert.throws(()=>state.store.requireSession(login.token,{role:'OPERATOR'},now),{code:'FORBIDDEN'});
    const operator=state.store.bootstrapOperator(id,now);assert.equal(operator.role,'OPERATOR');
    assert.equal(state.store.readSession(login.token,now).authenticated,false);
    const next=await state.store.login({email,password},now);assert.equal(state.store.requireSession(next.token,{role:'OPERATOR'},now).account.id,id);
    assert.throws(()=>requireStudentAccount(state.db,id),{code:'ACCOUNT_REQUIRED'});
    assert.throws(()=>state.store.bootstrapOperator(id,now),{code:'BOOTSTRAP_CLOSED'});
  }finally{state.close();}
});

test('unverified owners can export and erase themselves after recent password authentication',async()=>{
  const state=setup();
  try{
    await state.store.register({email,password,adultConfirmed:true},now);
    const login=await state.store.login({email,password},now);
    const exported=state.store.exportIdentity(login.token,now);
    assert.equal(exported.account.emailVerified,false);assert.equal(exported.verification.emailVerifiedAt,null);
    assert.equal(exported.securityEvents.some(event=>event.kind==='REGISTERED'),true);
    const serialized=JSON.stringify(exported);
    assert.equal(serialized.includes(login.token),false);assert.equal(serialized.includes('password_hash'),false);assert.equal(serialized.includes('token_hash'),false);
    assert.throws(()=>state.store.exportIdentity(login.token,later(601)),{code:'RECENT_AUTH_REQUIRED'});
    assert.throws(()=>state.store.deleteAccount(login.token,later(601)),{code:'RECENT_AUTH_REQUIRED'});
    state.store.deleteAccount(login.token,now);
    assert.equal(state.store.getAccount(login.state.account!.id),null);
  }finally{state.close();}
});

test('explicit retention removes abandoned unverified identities and expired security state without deleting verified or recently active accounts',async()=>{
  const cleaned:string[]=[];
  const state=setup(':memory:',{beforeDelete:(_db,id)=>{cleaned.push(id);}});
  try{
    await state.store.register({email:'abandoned@example.invalid',password,adultConfirmed:true},now);
    const abandoned=state.messages.at(-1)!.accountId;
    await state.store.register({email:'recent@example.invalid',password,adultConfirmed:true},now);
    const recent=state.messages.at(-1)!.accountId;
    const verifiedLogin=await verified(state,'verified@example.invalid');
    const day31=later(31*86400);
    await state.store.login({email:'recent@example.invalid',password},day31);
    assert.ok(state.store.getAccount(abandoned),'retention never runs automatically');
    const result=state.store.maintain({unverifiedDays:30,securityEventDays:30},day31);
    assert.equal(result.abandonedAccounts,1);assert.deepEqual(cleaned,[abandoned]);
    assert.equal(state.store.getAccount(abandoned),null);assert.ok(state.store.getAccount(recent));assert.ok(state.store.getAccount(verifiedLogin.state.account!.id));
    assert.equal((state.db.prepare('SELECT COUNT(*) AS n FROM account_action_tokens').get() as {n:number}).n,0);
    assert.equal((state.db.prepare('SELECT COUNT(*) AS n FROM account_security_events WHERE at<?').get(later(86400).toISOString()) as {n:number}).n,0);
    assert.throws(()=>state.store.maintain({unverifiedDays:0,securityEventDays:90},day31),{code:'INVALID_RETENTION_POLICY'});
    assert.equal(state.store.maintain({unverifiedDays:30,securityEventDays:30},day31).abandonedAccounts,0);
  }finally{state.close();}
});

test('full account export includes only its own optional AI budget metadata and deletion cascades it',async()=>{
  const state=setup(':memory:',{exportPrivateData:()=>({student:null,notifications:{preferences:{enabled:false,version:0,profileVersion:null,updatedAt:null},outbox:[],suppression:null,retainedReceiptCorrelations:{count:0,latestExpiresAt:null}}})});
  try{
    const login=await verified(state),owner=login.state.account!.id;
    assert.equal(state.store.exportData(login.token,now).aiUsage,null,'export works before AI storage exists');
    state.db.exec('CREATE TABLE ai_usage(owner TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,day TEXT NOT NULL,count INTEGER NOT NULL,last_at INTEGER NOT NULL)');
    await state.store.register({email:'other-ai@example.invalid',password,adultConfirmed:true},now);
    const other=state.messages.at(-1)!.accountId;
    state.db.prepare('INSERT INTO ai_usage VALUES(?,?,?,?)').run(other,'2031-05-01',7,now.getTime());
    assert.equal(state.store.exportData(login.token,now).aiUsage,null,'another owner budget cannot appear');
    state.db.prepare('INSERT INTO ai_usage VALUES(?,?,?,?)').run(owner,'2031-05-01',2,now.getTime());
    const exported=state.store.exportData(login.token,now);
    assert.deepEqual(exported.aiUsage,{day:'2031-05-01',count:2,lastAt:now.toISOString()});
    assert.equal(JSON.stringify(exported).includes(other),false);
    state.store.deleteAccount(login.token,now);
    assert.equal(state.db.prepare('SELECT 1 FROM ai_usage WHERE owner=?').get(owner),undefined);
    assert.ok(state.db.prepare('SELECT 1 FROM ai_usage WHERE owner=?').get(other));
  }finally{state.close();}
});

test('asynchronous password work cannot extend an expiring session or consume an expired recovery token',async()=>{
  const state=setup();
  try{
    let login=await verified(state);
    const expires=()=>new Date(now.getTime()+1).toISOString();
    state.db.prepare('UPDATE account_sessions SET expires_at=?').run(expires());
    await assert.rejects(state.store.reauthenticate(login.token,{password},now),{code:'UNAUTHENTICATED'});
    login=await state.store.login({email,password},now);
    state.db.prepare('UPDATE account_sessions SET expires_at=?').run(expires());
    await assert.rejects(state.store.changePassword(login.token,{currentPassword:password,newPassword:'New synthetic passphrase 456'},now),{code:'UNAUTHENTICATED'});
    await state.store.requestRecovery({email},now);
    const token=state.messages.at(-1)!.token;
    state.db.prepare("UPDATE account_action_tokens SET expires_at=? WHERE purpose='RESET_PASSWORD'").run(expires());
    await assert.rejects(state.store.resetPassword({token,password:'Another synthetic passphrase 789'},now),{code:'INVALID_TOKEN'});
    assert.equal((await state.store.login({email,password},now)).state.authenticated,true,'rejected expired actions must not change credentials');
  }finally{state.close();}
});
