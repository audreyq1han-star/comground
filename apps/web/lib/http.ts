import { getRuntimeConfig, isLoopbackHost } from './runtime-config.ts';
import { isRepositoryError, RepositoryError } from './errors.ts';

export const MAX_JSON_BYTES = 32 * 1024;
export function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  const result = new Headers(headers);
  result.set('content-type', 'application/json; charset=utf-8');
  result.set('cache-control', 'no-store');
  result.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(value), { status, headers: result });
}

export function apiError(error: unknown): Response {
  if (isRepositoryError(error)) return jsonResponse({ error: { code: error.code, message: error.message } }, error.status);
  if (error instanceof Error && error.name === 'DomainError') return jsonResponse({ error: { code: 'INVALID_INPUT', message: error.message } }, 422);
  // Never include database content, request bodies, environment or stack traces.
  return jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } }, 500);
}

/** Legacy name retained: production accepts only the configured canonical HTTPS host. */
export function assertLoopback(request: Request): string {
  const config = getRuntimeConfig();
  const host = request.headers.get('host');
  if (config.mode === 'production') {
    const origin = config.origin!;
    if (host !== new URL(origin).host) throw new RepositoryError('ORIGIN_DENIED', 403, 'Use the configured service origin.');
    // TLS terminates at the trusted reverse proxy. Forwarded-host headers are never trusted.
    return origin;
  }
  if (!host || !isLoopbackHost(host)) throw new RepositoryError('LOCAL_ONLY', 403, 'This mode is available only on a loopback host.');
  const protocol = new URL(request.url).protocol;
  if (protocol !== 'http:' && protocol !== 'https:') throw new RepositoryError('LOCAL_ONLY', 403, 'An HTTP loopback origin is required.');
  const origin = `${protocol}//${host}`;
  try { if (new URL(origin).port && Number(new URL(origin).port) > 65535) throw new Error('port'); }
  catch { throw new RepositoryError('LOCAL_ONLY', 403, 'A valid loopback host is required.'); }
  if (config.origin && config.origin !== origin) throw new RepositoryError('ORIGIN_DENIED', 403, 'Use the configured service origin.');
  return origin;
}

export function assertSameOrigin(request: Request): void {
  const origin = assertLoopback(request);
  if (request.headers.get('origin') !== origin) throw new RepositoryError('ORIGIN_DENIED', 403, 'Use the same service origin for this action.');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') throw new RepositoryError('ORIGIN_DENIED', 403, 'Cross-site actions are not accepted.');
}

export async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new RepositoryError('INVALID_JSON', 400, 'Send an application/json request body.');
  const declaredSize = request.headers.get('content-length');
  if (declaredSize && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > MAX_JSON_BYTES)) throw new RepositoryError('BODY_TOO_LARGE', 413, 'JSON bodies are limited to 32 KiB.');
  const reader = request.body?.getReader();
  if (!reader) throw new RepositoryError('INVALID_JSON', 400, 'A JSON request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) {
        await reader.cancel();
        throw new RepositoryError('BODY_TOO_LARGE', 413, 'JSON bodies are limited to 32 KiB.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RepositoryError('INVALID_JSON', 400, 'The request body is not valid JSON.'); }
}

export function objectInput(input: unknown, keys: string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw new RepositoryError('INVALID_INPUT', 422, 'The request has unsupported fields or is not an object.');
  return input as Record<string, unknown>;
}
