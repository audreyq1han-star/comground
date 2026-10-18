import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DemoPersona, DemoPersonaId } from '../../../packages/domain/app-contracts.ts';
import { RepositoryError } from './errors.ts';
import { assertLoopback } from './http.ts';
import { getRuntimeConfig } from './runtime-config.ts';
import { accountIdentity, requireAccount } from './account-auth.ts';
import type { AccountId } from '../../../packages/domain/identity-contracts.ts';

export const STUDENT_COOKIE = 'comground_student';
export const STUDENT_SESSION_SECONDS = 3600;
export const DEMO_PERSONAS: readonly DemoPersona[] = [
  { id: 'demo-alex', label: 'Alex · demo', description: 'A fictional student profile for trying the local app.' },
  { id: 'demo-sam', label: 'Sam · demo', description: 'A second fictional profile with separate saved items and activity.' },
];
export function persona(value: unknown): DemoPersona {
  const found = DEMO_PERSONAS.find(item => item.id === value);
  if (!found) throw new RepositoryError('INVALID_PERSONA', 422, 'Choose one of the two fictional demo personas.');
  return { ...found };
}

// Separate from the reviewer token and retained only through this process's dev reloads.
const state = globalThis as typeof globalThis & { comgroundStudentSigningKey?: string };
function processKey(): string { return state.comgroundStudentSigningKey ??= randomBytes(32).toString('base64url'); }
function sign(payload: string, key: string): string { return createHmac('sha256', key).update(`comground.student.v1:${payload}`).digest('base64url'); }
function equal(a: string, b: string): boolean { return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest()); }
function cookieValue(request: Request): string | undefined {
  return request.headers.get('cookie')?.split(';').map(item => item.trim()).find(item => item.startsWith(`${STUDENT_COOKIE}=`))?.slice(STUDENT_COOKIE.length + 1);
}
function cookieSuffix(request: Request): string { return `Path=/api/student; HttpOnly; SameSite=Strict${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`; }
export function createStudentCookie(request: Request, id: DemoPersonaId, now = Date.now(), key = processKey()): string {
  if (getRuntimeConfig().mode !== 'demo') throw new RepositoryError('DEMO_AUTH_DISABLED',403,'Demo personas are disabled outside demo mode.');
  persona(id);
  const payload = Buffer.from(JSON.stringify({ subject: id, audience: 'comground.student.v1', expiresAt: Math.floor(now / 1000) + STUDENT_SESSION_SECONDS, nonce: randomBytes(16).toString('hex') })).toString('base64url');
  return `${STUDENT_COOKIE}=${payload}.${sign(payload, key)}; Max-Age=${STUDENT_SESSION_SECONDS}; ${cookieSuffix(request)}`;
}
export function clearStudentCookie(request: Request): string { return `${STUDENT_COOKIE}=; Max-Age=0; ${cookieSuffix(request)}`; }
export function studentIdentity(request: Request, now = Date.now(), key = processKey()): DemoPersonaId | AccountId | null {
  if (getRuntimeConfig().mode !== 'demo') {
    const account=accountIdentity(request,new Date(now));
    return account?.role==='STUDENT' && account.emailVerified && account.admission==='ADMITTED' ? account.id : null;
  }
  const cookie = cookieValue(request);
  if (!cookie || cookie.length > 2048) return null;
  const [payload, signature, extra] = cookie.split('.');
  if (!payload || !signature || extra !== undefined || !equal(signature, sign(payload, key))) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const seconds = Math.floor(now / 1000);
    if (value.audience !== 'comground.student.v1' || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= seconds || value.expiresAt > seconds + STUDENT_SESSION_SECONDS || typeof value.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(value.nonce)) return null;
    return persona(value.subject).id;
  } catch { return null; }
}
export function requireStudent(request: Request): DemoPersonaId | AccountId {
  assertLoopback(request);
  if (getRuntimeConfig().mode !== 'demo') return requireAccount(request,{role:'STUDENT',verified:true}).id;
  const id = studentIdentity(request);
  if (!id) throw new RepositoryError(cookieValue(request) ? 'INVALID_SESSION' : 'UNAUTHENTICATED', cookieValue(request) ? 403 : 401, 'Choose a demo persona to continue. Sessions end when the local server restarts.');
  return id;
}
