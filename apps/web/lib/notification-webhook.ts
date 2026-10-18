import { RepositoryError } from './errors.ts';
import { apiError } from './http.ts';
import { notificationWebhookConfigured, verifyNotificationSignature } from './notification-crypto.ts';
import { trustedNotificationOrigin, type NotificationConfiguration } from './notification-delivery.ts';
import type { NotificationStore, ResendReceipt } from './notification-repository.ts';

export type { ResendReceipt } from './notification-repository.ts';
export { verifyNotificationSignature } from './notification-crypto.ts';
export const MAX_WEBHOOK_BYTES = 32 * 1024;
const statuses = { 'email.delivered': 'DELIVERED', 'email.failed': 'FAILED', 'email.bounced': 'BOUNCED', 'email.complained': 'COMPLAINED' } as const;
const invalid = () => new RepositoryError('INVALID_WEBHOOK_EVENT', 422, 'The receipt event is invalid.');
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Official Resend/Svix raw-body protocol. Only four minimal receipt event fields leave this parser. */
export function verifyResendWebhook(raw: Uint8Array, headers: Headers, secret: string | null | undefined, now = new Date()): ResendReceipt | null {
  if (raw.byteLength > MAX_WEBHOOK_BYTES) throw new RepositoryError('BODY_TOO_LARGE', 413, 'Receipt bodies are limited to 32 KiB.');
  const eventId = verifyNotificationSignature(raw, headers, secret, now);
  let event: unknown;
  try { event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { throw invalid(); }
  if (!object(event) || typeof event.type !== 'string') throw invalid();
  if (!Object.hasOwn(statuses, event.type)) return null;
  if (!object(event.data) || typeof event.data.email_id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(event.data.email_id) || typeof event.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(event.created_at)) throw invalid();
  const date = Date.parse(event.created_at);
  if (!Number.isFinite(date) || date > now.getTime() + 300000) throw invalid();
  return { eventId, providerEmailId: event.data.email_id, status: statuses[event.type as keyof typeof statuses], occurredAt: new Date(date).toISOString() };
}
async function readRawBody(request: Request): Promise<Uint8Array> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || request.headers.has('content-encoding') && request.headers.get('content-encoding') !== 'identity') throw new RepositoryError('INVALID_WEBHOOK_BODY', 400, 'Send an uncompressed JSON receipt body.');
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_WEBHOOK_BYTES)) throw new RepositoryError('BODY_TOO_LARGE', 413, 'Receipt bodies are limited to 32 KiB.');
  const reader = request.body?.getReader(); if (!reader) throw invalid();
  const chunks: Uint8Array[] = []; let size = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new RepositoryError('WEBHOOK_BODY_TIMEOUT', 408, 'The receipt body did not complete in time.')), 10000); });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_WEBHOOK_BYTES) throw new RepositoryError('BODY_TOO_LARGE', 413, 'Receipt bodies are limited to 32 KiB.');
      chunks.push(value);
    }
    if (declared && Number(declared) !== size) throw invalid();
    return Buffer.concat(chunks);
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { clearTimeout(timeout); reader.releaseLock(); }
}
type HandlerOptions = { config: () => NotificationConfiguration; store: () => Pick<NotificationStore, 'recordReceipt'>; now?: () => Date };
function assertEndpoint(request: Request, config: NotificationConfiguration): void {
  if (config.mode !== 'production' || !notificationWebhookConfigured(config.webhookKey) || !trustedNotificationOrigin(config.origin)) throw new RepositoryError('WEBHOOK_CONFIGURATION_MISSING', 503, 'Receipt verification is not configured.');
  if (request.method !== 'POST') throw new RepositoryError('METHOD_NOT_ALLOWED', 405, 'Use POST for delivery receipts.');
  if (request.headers.get('host') !== new URL(config.origin!).host || new URL(request.url).search) throw new RepositoryError('WEBHOOK_ORIGIN_DENIED', 403, 'Use the configured receipt endpoint.');
}
/** No browser session or CSRF exemption fallback: the provider signature is the only authentication. */
export function createResendWebhookHandler(options: HandlerOptions): (request: Request) => Promise<Response> {
  return async request => {
    try {
      assertEndpoint(request, options.config());
      const raw = await readRawBody(request), config = options.config();
      assertEndpoint(request, config);
      const now = options.now?.() ?? new Date(), receipt = verifyResendWebhook(raw, request.headers, config.webhookKey, now);
      if (receipt && options.store().recordReceipt(receipt, now) === 'UNKNOWN') throw new RepositoryError('WEBHOOK_REFERENCE_UNAVAILABLE', 503, 'The receipt reference is not available. Retry later.');
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
    } catch (error) { return apiError(error); }
  };
}
