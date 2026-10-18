import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { RepositoryError } from './errors.ts';

function encryptionKey(value: string | null): Buffer {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new RepositoryError('NOTIFICATION_CONFIGURATION_MISSING', 503, 'Notification encryption is not configured.');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) throw new RepositoryError('NOTIFICATION_CONFIGURATION_MISSING', 503, 'Notification encryption is not configured.');
  return key;
}
export function notificationEncryptionConfigured(value: string | null): boolean { try { encryptionKey(value); return true; } catch { return false; } }
/** Svix secrets are base64 bytes with a whsec_ prefix, independently of the outbox encryption key. */
function webhookKey(value: string | null | undefined): Buffer {
  if (!value?.startsWith('whsec_') || value.length > 96) throw new RepositoryError('WEBHOOK_CONFIGURATION_MISSING', 503, 'Receipt verification is not configured.');
  const encoded = value.slice(6), key = Buffer.from(encoded, 'base64');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || key.length < 16 || key.length > 64 || key.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new RepositoryError('WEBHOOK_CONFIGURATION_MISSING', 503, 'Receipt verification is not configured.');
  return key;
}
export function notificationWebhookConfigured(value: string | null | undefined): boolean { try { webhookKey(value); return true; } catch { return false; } }
/** Verify untouched bytes before JSON parsing. Signature rotation may supply several v1 values. */
export function verifyNotificationSignature(raw: Uint8Array, headers: Headers, secret: string | null | undefined, now = new Date()): string {
  const key = webhookKey(secret);
  const id = headers.get('svix-id'), timestamp = headers.get('svix-timestamp'), signatures = headers.get('svix-signature');
  const denied = () => new RepositoryError('INVALID_WEBHOOK_SIGNATURE', 401, 'The receipt signature is invalid or expired.');
  if (!id || !/^[A-Za-z0-9_-]{1,200}$/.test(id) || !timestamp || !/^[0-9]{1,12}$/.test(timestamp) || !signatures || signatures.length > 1024 || raw.byteLength > 32 * 1024) throw denied();
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(now.getTime() / 1000 - seconds) > 300) throw denied();
  const values = signatures.split(' ');
  if (!values.length || values.length > 8 || values.some(value => !/^v[0-9]+,[A-Za-z0-9+/]+={0,2}$/.test(value))) throw denied();
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(raw).digest();
  let matches = 0;
  for (const value of values) {
    const [version, encoded] = value.split(','), candidate = Buffer.from(encoded, 'base64');
    if (version === 'v1' && candidate.length === expected.length && candidate.toString('base64') === encoded) matches |= Number(timingSafeEqual(expected, candidate));
  }
  if (!matches) throw denied();
  return id;
}
/** AAD binds an encrypted payload to one immutable outbox ID. */
export function encryptNotification(value: unknown, id: string, key: string | null): string {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(key), nonce);
  cipher.setAAD(Buffer.from(`comground.notification.v1:${id}`));
  const plaintext = Buffer.from(JSON.stringify(value));
  if (plaintext.length > 16 * 1024) throw new RepositoryError('INVALID_NOTIFICATION', 422, 'The notification payload is too large.');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return ['v1', nonce.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}
export function decryptNotification<T>(value: string, id: string, key: string | null): T {
  try {
    const [version, nonce, tag, ciphertext, extra] = value.split('.');
    if (version !== 'v1' || extra !== undefined || !nonce || !tag || !ciphertext || value.length > 24 * 1024) throw new Error('invalid envelope');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(key), Buffer.from(nonce, 'base64'));
    decipher.setAAD(Buffer.from(`comground.notification.v1:${id}`)); decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8')) as T;
  } catch { throw new RepositoryError('NOTIFICATION_PAYLOAD_UNAVAILABLE', 503, 'The encrypted notification payload is unavailable.'); }
}
