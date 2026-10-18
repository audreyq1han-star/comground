export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      ...options, cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(body?.error?.message || 'This request could not be completed. Please try again.', response.status, body?.error?.code);
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new Error('The server took too long to respond. Please try again.');
    throw new Error('Could not reach the server. Check your connection, then try again.');
  } finally { clearTimeout(timeout); }
}

export function messageOf(error: unknown): string { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
