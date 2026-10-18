import type { CommunityStore } from './community-repository.ts';
import type { DistributionStore } from './distribution-repository.ts';
import { distributionPagination } from './distribution-validation.ts';
import { RepositoryError } from './errors.ts';
import { apiError, assertLoopback, assertSameOrigin, jsonResponse, readJson } from './http.ts';

type Action = (request: Request) => Response | Promise<Response>;
type Dependencies = { distribution: () => DistributionStore; communities: () => CommunityStore; student: (request: Request) => string; operator: (request: Request) => string };
export function createDistributionHandlers(dependencies: Dependencies) {
  function guarded(action: Action, allowPagination = false): Action { return async request => { try { assertLoopback(request); if (!allowPagination && new URL(request.url).search) throw new RepositoryError('INVALID_QUERY', 400, 'This resource does not accept query parameters.'); return await action(request); } catch (error) { return apiError(error); } }; }
  function pagination(request: Request) {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !['offset','limit'].includes(key)) || params.getAll('offset').length > 1 || params.getAll('limit').length > 1 || [...params.values()].some(value => !/^\d+$/.test(value))) throw new RepositoryError('INVALID_QUERY', 400, 'Choose valid offset and limit parameters.');
    return distributionPagination(Number(params.get('offset') ?? 0), Number(params.get('limit') ?? 20));
  }
  const getSubscription = guarded(request => { const owner = dependencies.student(request); return jsonResponse({ data: dependencies.distribution().subscription(owner) }); });
  const putSubscription = guarded(async request => { assertSameOrigin(request); const input = await readJson(request), owner = dependencies.student(request); return jsonResponse({ data: dependencies.distribution().setSubscription(owner, input) }); });
  const getPreview = guarded(request => { const owner = dependencies.student(request); return jsonResponse({ data: dependencies.distribution().privatePreview(owner) }); });
  const getOwned = guarded(request => { const owner = dependencies.student(request); return jsonResponse({ data: dependencies.distribution().exportData(owner) }); });
  const getBatches = guarded(request => { dependencies.operator(request); const page = pagination(request); return jsonResponse({ data: dependencies.distribution().batches(page.offset, page.limit) }); }, true);
  const postBatch = guarded(async request => { assertSameOrigin(request); const input = await readJson(request), actor = dependencies.operator(request); return jsonResponse({ data: dependencies.distribution().prepareBatch(input, actor) }, 201); });
  const getBatch = (request: Request, id: string) => guarded(req => { dependencies.operator(req); return jsonResponse({ data: dependencies.distribution().batch(id) }); })(request);
  const patchBatch = (request: Request, id: string) => guarded(async req => { assertSameOrigin(req); const input = await readJson(req), actor = dependencies.operator(req); return jsonResponse({ data: dependencies.distribution().updateBatch(id, input, actor) }); })(request);
  const getCommunities = guarded(request => { dependencies.operator(request); const page = pagination(request); return jsonResponse({ data: dependencies.communities().list(page.offset, page.limit) }); }, true);
  const postCommunity = guarded(async request => { assertSameOrigin(request); const input = await readJson(request), actor = dependencies.operator(request); return jsonResponse({ data: dependencies.communities().create(input, actor) }, 201); });
  const patchCommunity = (request: Request, id: string) => guarded(async req => { assertSameOrigin(req); const input = await readJson(req), actor = dependencies.operator(req); return jsonResponse({ data: dependencies.communities().update(id, input, actor) }); })(request);
  const deleteCommunity = (request: Request, id: string) => guarded(async req => { assertSameOrigin(req); const input = await readJson(req), actor = dependencies.operator(req); dependencies.communities().remove(id, input, actor); return jsonResponse({ data: null }); })(request);
  const getPublicCommunity = (request: Request, slug: string) => guarded(() => jsonResponse({ data: dependencies.communities().publicBySlug(slug) }))(request);
  return { getSubscription, putSubscription, getPreview, getOwned, getBatches, postBatch, getBatch, patchBatch, getCommunities, postCommunity, patchCommunity, deleteCommunity, getPublicCommunity };
}
