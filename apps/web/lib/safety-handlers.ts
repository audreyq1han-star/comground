import { requireAccount } from './account-auth.ts';
import { RepositoryError } from './errors.ts';
import { apiError, assertLoopback, assertSameOrigin, jsonResponse, readJson } from './http.ts';
import { getRuntimeConfig } from './runtime-config.ts';
import { safety } from './safety-runtime.ts';

type Action = (request: Request) => Response | Promise<Response>;
function guarded(action: Action): Action {
  return async request => {
    try {
      assertLoopback(request);
      if (new URL(request.url).search) throw new RepositoryError('INVALID_QUERY', 400, 'Private safety resources do not accept query parameters.');
      if (getRuntimeConfig().mode === 'demo') throw new RepositoryError('ACCOUNT_REQUIRED', 403, 'Private safety reporting requires a verified account. Shared demo personas cannot store private reports.');
      return await action(request);
    } catch (error) { return apiError(error); }
  };
}
function reporter(request: Request) { return requireAccount(request, { role: 'STUDENT', verified: true, allowPendingYouth: true }).id; }
export const getSafetyReports = guarded(request => jsonResponse({ data: safety().listOwn(reporter(request)) }));
export const postSafetyReport = guarded(async request => {
  assertSameOrigin(request);
  const input = await readJson(request), owner = reporter(request);
  return jsonResponse({ data: safety().create(owner, input) }, 201);
});
export function deleteSafetyReport(request: Request, id: string): Response | Promise<Response> {
  return guarded(async req => {
    assertSameOrigin(req);
    const input = await readJson(req), owner = reporter(req);
    safety().remove(owner, id, input);
    return jsonResponse({ data: null });
  })(request);
}
export const getOperatorSafetyReports = guarded(request => {
  const actor = requireAccount(request, { role: 'OPERATOR', verified: true });
  return jsonResponse({ data: { reports: safety().listQueue(), actorId: actor.id } });
});
export function patchOperatorSafetyReport(request: Request, id: string): Response | Promise<Response> {
  return guarded(async req => {
    assertSameOrigin(req);
    const input = await readJson(req);
    const actor = requireAccount(req, { role: 'OPERATOR', verified: true });
    return jsonResponse({ data: safety().moderate(id, input, actor.id) });
  })(request);
}
