import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { RepositoryError } from './errors.ts';
import { assertLoopback } from './http.ts';
import { getRuntimeConfig } from './runtime-config.ts';
import { accountIdentity, accountSessionToken, clearAccountCookie, requireAccount } from './account-auth.ts';
import { accounts } from './account-runtime.ts';

export const SESSION_COOKIE = 'comground_reviewer';
export const SESSION_SECONDS = 3600;

function configuredToken(): string {
  if (getRuntimeConfig().mode !== 'demo') throw new RepositoryError('DEMO_AUTH_DISABLED',403,'Demo reviewer tokens are disabled outside demo mode.');
  const token = process.env.LOCAL_REVIEW_TOKEN;
  if (!token || token.length < 16) throw new RepositoryError('SESSION_UNAVAILABLE', 503, 'Start the local app using its ephemeral reviewer-token launcher.');
  return token;
}

function equal(left: string, right: string): boolean {
  return timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
}

function signature(payload: string, token: string): string { return createHmac('sha256', token).update(payload).digest('base64url'); }

export function validLoginToken(candidate: unknown): boolean {
  if (getRuntimeConfig().mode !== 'demo') return false;
  const token = configuredToken();
  return typeof candidate === 'string' && candidate.length <= 512 && equal(candidate, token);
}

export function createSessionCookie(request: Request, now = Date.now()): string {
  const token = configuredToken();
  const payload = Buffer.from(JSON.stringify({ expiresAt: Math.floor(now / 1000) + SESSION_SECONDS, nonce: randomBytes(16).toString('hex') })).toString('base64url');
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  // HTTP is permitted only on loopback; production authentication is explicitly out of scope.
  return `${SESSION_COOKIE}=${payload}.${signature(payload, token)}; Path=/api/admin; Max-Age=${SESSION_SECONDS}; HttpOnly; SameSite=Strict${secure}`;
}

export function clearSessionCookie(request: Request): string {
  if (getRuntimeConfig().mode !== 'demo') { accounts().logout(accountSessionToken(request)); return clearAccountCookie(); }
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/api/admin; Max-Age=0; HttpOnly; SameSite=Strict${secure}`;
}

export function hasReviewerSession(request: Request, now = Date.now()): boolean {
  if (getRuntimeConfig().mode !== 'demo') {
    const account = accountIdentity(request,new Date(now));
    return !!account && account.role === 'OPERATOR' && account.emailVerified && account.adultConfirmed;
  }
  const token = process.env.LOCAL_REVIEW_TOKEN;
  if (!token || token.length < 16) return false;
  const value = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!value || value.length > 2048) return false;
  const parts = value.split('.');
  if (parts.length !== 2 || !equal(parts[1], signature(parts[0], token))) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { expiresAt?: unknown; nonce?: unknown };
    const seconds = Math.floor(now / 1000);
    return typeof payload.expiresAt === 'number' && Number.isSafeInteger(payload.expiresAt) && payload.expiresAt > seconds && payload.expiresAt <= seconds + SESSION_SECONDS && typeof payload.nonce === 'string' && /^[a-f0-9]{32}$/.test(payload.nonce);
  } catch { return false; }
}

export function requireReviewer(request: Request): string {
  assertLoopback(request);
  if (getRuntimeConfig().mode !== 'demo') { return requireAccount(request,{role:'OPERATOR',verified:true}).id; }
  if (!hasReviewerSession(request)) {
    const hasCookie = request.headers.get('cookie')?.includes(`${SESSION_COOKIE}=`);
    throw new RepositoryError(hasCookie ? 'INVALID_SESSION' : 'UNAUTHENTICATED', hasCookie ? 403 : 401, 'Unlock the local reviewer session to continue.');
  }
  return 'demo-reviewer';
}

let failedLogins: number[] = [];
export function checkLoginAttempt(now = Date.now()): void {
  failedLogins = failedLogins.filter(at => now - at < 60_000);
  if (failedLogins.length >= 10) throw new RepositoryError('TOO_MANY_ATTEMPTS', 429, 'Too many invalid attempts. Wait one minute and try again.');
}
export function recordFailedLogin(now = Date.now()): void { failedLogins.push(now); }
