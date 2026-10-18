import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { RepositoryError } from './errors.ts';

// OWASP scrypt minimum: N=2^17, r=8, p=1. Bound concurrent 128-MiB jobs.
const PARAMETERS = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
let activeJobs = 0;
export function requirePasswordCapacity(): void {
  if (activeJobs >= 2) throw new RepositoryError('AUTH_BUSY', 503, 'Account authentication is temporarily busy. Please retry shortly.');
}
export function validatePassword(value: unknown): string {
  if (typeof value !== 'string' || [...value].length < 15 || [...value].length > 128 || Buffer.byteLength(value, 'utf8') > 512) throw new RepositoryError('INVALID_PASSWORD', 422, 'Use a password of 15–128 characters.');
  return value;
}
function derive(password: string, salt: Buffer): Promise<Buffer> {
  requirePasswordCapacity();
  activeJobs++;
  return new Promise((resolve, reject) => scrypt(password, salt, 64, PARAMETERS, (error, key) => {
    activeJobs--;
    if (error) reject(new RepositoryError('AUTH_UNAVAILABLE', 503, 'Account authentication is temporarily unavailable.'));
    else resolve(key);
  }));
}
export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(16), digest = await derive(password, salt);
  return `scrypt$131072$8$1$${salt.toString('hex')}$${digest.toString('hex')}`;
}
export async function verifyPassword(password: unknown, stored: string | null): Promise<boolean> {
  // Use the same expensive operation for unknown accounts and malformed hashes.
  const parsed = stored ? /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(stored) : null;
  const safe = typeof password === 'string' && Buffer.byteLength(password, 'utf8') <= 512 ? password : '';
  const digest = await derive(safe, parsed ? Buffer.from(parsed[1], 'hex') : Buffer.alloc(16));
  return !!parsed && typeof password === 'string' && timingSafeEqual(digest, Buffer.from(parsed[2], 'hex'));
}
