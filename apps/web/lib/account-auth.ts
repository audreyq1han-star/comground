import type { Account, AccountSession } from '../../../packages/domain/identity-contracts.ts';
import { accounts } from './account-runtime.ts';
import { ACCOUNT_SESSION_SECONDS, type AccountRequirement } from './account-repository.ts';
import { getRuntimeConfig } from './runtime-config.ts';
import { assertLoopback } from './http.ts';

export function accountCookieName(): string { return getRuntimeConfig().mode==='production'?'__Host-comground_account':'comground_account'; }
export function accountSessionToken(request:Request):string|null {
  const name=accountCookieName();
  const candidates=(request.headers.get('cookie')??'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(`${name}=`));
  if(candidates.length!==1) return null;
  const value=candidates[0].slice(name.length+1);
  return /^[A-Za-z0-9_-]{43}$/.test(value)?value:null;
}
export function createAccountCookie(token:string):string {
  const config=getRuntimeConfig();
  return `${accountCookieName()}=${token}; Path=/; Max-Age=${ACCOUNT_SESSION_SECONDS}; HttpOnly; SameSite=Strict${config.mode==='production'||config.origin?.startsWith('https:')?'; Secure':''}`;
}
export function clearAccountCookie():string { return createAccountCookie('').replace(`Max-Age=${ACCOUNT_SESSION_SECONDS}`,'Max-Age=0'); }
export function accountSession(request:Request,now=new Date()):AccountSession { assertLoopback(request); return accounts().readSession(accountSessionToken(request),now); }
export function accountIdentity(request:Request,now=new Date()):Account|null { return accountSession(request,now).account; }
export function requireAccount(request:Request,requirement:AccountRequirement={},now=new Date()):Account { assertLoopback(request); return accounts().requireSession(accountSessionToken(request),requirement,now).account; }
