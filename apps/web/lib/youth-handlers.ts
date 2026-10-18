import { accounts } from './account-runtime.ts';
import { requireAccount } from './account-auth.ts';
import { apiError, assertLoopback, assertSameOrigin, jsonResponse, readJson } from './http.ts';
import { getRuntimeConfig } from './runtime-config.ts';
import { RepositoryError } from './errors.ts';

type Action = (request: Request) => Response | Promise<Response>;
function guarded(action: Action): Action {
  return async request => {
    try {
      const config = getRuntimeConfig(); assertLoopback(request);
      if (new URL(request.url).search) throw new RepositoryError('INVALID_QUERY', 400, 'Youth review routes do not accept query parameters.');
      if (!config.syntheticYouth) throw new RepositoryError('YOUTH_WORKFLOW_DISABLED', 403, 'Teen review is available only in the explicitly enabled synthetic local test workflow.');
      return await action(request);
    } catch (error) { return apiError(error); }
  };
}
export const getYouthAccess = guarded(request => { const account = requireAccount(request); return jsonResponse({ data: accounts().youth.access(account.id) }); });
export const createYouthReview = guarded(async request => { assertSameOrigin(request); const input = await readJson(request), account = requireAccount(request); return jsonResponse({ data: accounts().youth.request(account.id, input) }, 201); });
export const listYouthReviews = guarded(request => { const account = requireAccount(request); return jsonResponse({ data: accounts().youth.reviews(account.id) }); });
export function withdrawYouthReview(request: Request, id: string) { return guarded(async req => { assertSameOrigin(req); const input = await readJson(req), account = requireAccount(req); return jsonResponse({ data: accounts().youth.withdraw(account.id, id, input) }); })(request); }
export function decideYouthReview(request: Request, id: string) { return guarded(async req => { assertSameOrigin(req); const input = await readJson(req), account = requireAccount(req, { recent: true }); return jsonResponse({ data: accounts().youth.decide(account.id, id, input) }); })(request); }
