import { NextRequest, NextResponse } from 'next/server';

/** Fresh per-document nonce; pages use dynamic rendering so Next applies it. */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const development = process.env.NODE_ENV === 'development';
  const production = (process.env.COMGROUND_MODE ?? (development ? 'demo' : 'production')) === 'production';
  const policy = [
    "default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'", `connect-src 'self'${development ? ' ws://127.0.0.1:* ws://localhost:*' : ''}`,
    "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", ...(production ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce); headers.set('content-security-policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', policy);
  response.headers.set('cache-control', 'private, no-store');
  if (production) response.headers.set('strict-transport-security', 'max-age=31536000');
  return response;
}
export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] };
