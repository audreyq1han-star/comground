import type { NotificationReason } from '../../../packages/domain/notification-contracts.ts';

export type NotificationConfiguration = { mode: 'demo' | 'test' | 'production'; deliveryEnabled: boolean; origin: string | null; encryptionKey: string | null; apiKey: string | null; from: string | null; webhookKey?: string | null };
export type NotificationMessage = { from: string; to: string[]; subject: string; text: string };
export type DeliveryResult = { kind: 'ACCEPTED'; providerId: string } | { kind: 'RETRY'; reason: NotificationReason; retryAfterSeconds?: number } | { kind: 'PERMANENT'; reason: NotificationReason };
export type NotificationDelivery = (message: NotificationMessage, idempotencyKey: string) => Promise<DeliveryResult>;

export function validNotificationAddress(value: unknown): value is string { return typeof value === 'string' && value.length <= 254 && /^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(value); }
export function validNotificationSender(value: string | null): boolean {
  if (!value || value.length > 320 || /[\r\n]/.test(value)) return false;
  return validNotificationAddress(value as unknown) || /^[A-Za-z0-9 ._-]{1,60} <[^<>]+>$/.test(value) && validNotificationAddress(value.slice(value.indexOf('<') + 1, -1));
}
export function trustedNotificationOrigin(value: string | null): string | null {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' ? url.origin : null; } catch { return null; }
}
function validMessage(message: NotificationMessage): boolean {
  return validNotificationSender(message.from) && message.to.length === 1 && validNotificationAddress(message.to[0]) && typeof message.subject === 'string' && message.subject.length > 0 && message.subject.length <= 160 && !/[\r\n]/.test(message.subject) && typeof message.text === 'string' && message.text.length > 0 && message.text.length <= 12 * 1024;
}
async function responseJson(response: Response): Promise<Record<string, unknown> | null> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) return null;
  const reader = response.body?.getReader(); if (!reader) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 16 * 1024) { await reader.cancel(); return null; } chunks.push(value); }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; } finally { reader.releaseLock(); }
}
/** Real adapter only. Tests inject fetch; no local successful-send fallback exists. */
export function createResendDelivery(config: () => NotificationConfiguration, fetchImpl: typeof fetch = fetch): NotificationDelivery {
  return async (message, idempotencyKey) => {
    const current = config();
    if (current.mode !== 'production' || !current.deliveryEnabled || !current.apiKey || !validNotificationSender(current.from) || !trustedNotificationOrigin(current.origin)) return { kind: 'PERMANENT', reason: 'CONFIGURATION_BLOCKED' };
    if (!validMessage(message) || message.from !== current.from || !/^[A-Za-z0-9._:-]{1,200}$/.test(idempotencyKey)) return { kind: 'PERMANENT', reason: 'PROVIDER_REJECTED' };
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetchImpl('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal: controller.signal, headers: { Authorization: `Bearer ${current.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(message) });
      const body = await responseJson(response);
      if (response.ok) return typeof body?.id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(body.id) ? { kind: 'ACCEPTED', providerId: body.id } : { kind: 'RETRY', reason: 'DELIVERY_UNCERTAIN' };
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500 || response.status === 409 && body?.name === 'concurrent_idempotent_requests';
      if (retryable) {
        const raw = response.headers.get('retry-after');
        const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
        return { kind: 'RETRY', reason: 'PROVIDER_RETRYABLE', ...(Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 86400 ? { retryAfterSeconds: seconds } : {}) };
      }
      // Never retain provider error text: it can echo recipients or secrets.
      return { kind: 'PERMANENT', reason: 'PROVIDER_REJECTED' };
    } catch { return { kind: 'RETRY', reason: 'DELIVERY_UNCERTAIN' }; }
    finally { clearTimeout(timeout); }
  };
}
