import { getRuntimeConfig } from './runtime-config.ts';
import { fixtureList } from '../../../packages/domain/fixtures.ts';
import { parsePreferences, rankMatches } from '../../../packages/domain/rules.ts';
import type { PublicOpportunity, ReviewInput } from '../../../packages/domain/contracts.ts';
import type { CatalogueActionInput, CommunityUpdate, EditOpportunityInput, ExceptionInput, PublicQuery, SourceUpdate } from '../../../packages/domain/app-contracts.ts';
import { checkLoginAttempt, clearSessionCookie, createSessionCookie, hasReviewerSession, recordFailedLogin, requireReviewer, validLoginToken } from './auth.ts';
import { RepositoryError } from './errors.ts';
import { apiError, assertLoopback, assertSameOrigin, jsonResponse, objectInput, readJson } from './http.ts';
import { fixtureEpoch, repository } from './runtime.ts';

type Action = (request: Request) => Response | Promise<Response>;
function guarded(action: Action): Action {
  return async request => {
    try { assertLoopback(request); return await action(request); }
    catch (error) { return apiError(error); }
  };
}

export const listOpportunities = guarded(request => {
  const params = new URL(request.url).searchParams;
  const keys = ['q','category','area','mode','from','until','maxFee','limit','offset'];
  for (const key of params.keys()) if (!keys.includes(key)) throw new RepositoryError('INVALID_QUERY', 400, 'Unsupported query parameter.');
  for (const key of keys) if (params.getAll(key).length > 1) throw new RepositoryError('INVALID_QUERY', 400, 'Query parameters must not repeat.');
  const integer = (key: string, fallback: number) => {
    const value = params.get(key);
    if (value === null) return fallback;
    if (!/^\d+$/.test(value)) throw new RepositoryError('INVALID_QUERY', 400, 'Pagination values must be nonnegative integers.');
    return Number(value);
  };
  const options: PublicQuery = { limit: integer('limit', 20), offset: integer('offset', 0) };
  for (const key of ['q','category','area','from','until'] as const) if (params.has(key)) options[key] = params.get(key)!;
  if (params.has('mode')) {
    const mode = params.get('mode');
    if (mode !== 'ANY' && mode !== 'IN_PERSON' && mode !== 'REMOTE') throw new RepositoryError('INVALID_QUERY', 400, 'Choose a supported attendance mode.');
    options.mode = mode;
  }
  if (params.has('maxFee')) {
    const value = params.get('maxFee')!;
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new RepositoryError('INVALID_QUERY', 400, 'Use a nonnegative fee with at most two decimal places.');
    options.maxFee = Number(value);
  }
  return jsonResponse(repository().listPublic(options));
});

export async function getOpportunity(request: Request, id: string): Promise<Response> {
  return guarded(() => {
    if (id.length > 100) throw new RepositoryError('NOT_FOUND', 404, 'Opportunity not found.');
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== 'occurrence') || params.getAll('occurrence').length > 1) throw new RepositoryError('INVALID_QUERY', 400, 'Choose one occurrence parameter only.');
    const occurrenceId = params.get('occurrence') ?? undefined;
    if (occurrenceId !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(occurrenceId)) throw new RepositoryError('INVALID_QUERY', 400, 'Choose a valid occurrence.');
    const opportunity = repository().getPublic(id, new Date(), occurrenceId);
    if (!opportunity) throw new RepositoryError('NOT_FOUND', 404, 'Opportunity not found.');
    return jsonResponse({ data: opportunity });
  })(request);
}

export const createMatches = guarded(async request => {
  assertSameOrigin(request);
  if (getRuntimeConfig().mode !== 'demo') throw new RepositoryError('AUTH_REQUIRED', 401, 'Sign in and use your consented profile for matching.');
  const preferences = parsePreferences(await readJson(request));
  const now = new Date();
  const candidates: PublicOpportunity[] = [];
  let offset = 0;
  // The repository's bounded pages keep a stable HTTP contract; local matching walks all pages.
  while (true) {
    const page = repository().listPublic({ limit: 50, offset }, now);
    candidates.push(...page.data);
    offset += page.data.length;
    if (offset >= page.total || page.data.length === 0 || offset > 10000) break;
  }
  const matches = rankMatches(candidates, preferences, now);
  return jsonResponse({ data: matches.slice(0, 3), eligibleCount: matches.length, engine: 'DETERMINISTIC_RULES' });
});

export const getSession = guarded(request => jsonResponse({ authenticated: hasReviewerSession(request) }));

export const login = guarded(async request => {
  assertSameOrigin(request);
  const input = objectInput(await readJson(request), ['token']);
  if (getRuntimeConfig().mode !== 'demo') throw new RepositoryError('DEMO_DISABLED', 403, 'Use your account to sign in.');
  checkLoginAttempt();
  if (!validLoginToken(input.token)) {
    recordFailedLogin();
    throw new RepositoryError('INVALID_TOKEN', 403, 'The local reviewer token is not valid.');
  }
  return jsonResponse({ authenticated: true }, 200, { 'set-cookie': createSessionCookie(request) });
});

export const logout = guarded(request => {
  assertSameOrigin(request);
  return jsonResponse({ authenticated: false }, 200, { 'set-cookie': clearSessionCookie(request) });
});

export const listFixtures = guarded(request => {
  requireReviewer(request);
  if (getRuntimeConfig().mode === 'production') return jsonResponse({ data: [] });
  return jsonResponse({ data: fixtureList(fixtureEpoch()).map(({ fixtureId, label }) => ({ fixtureId, label })) });
});

export const importFixture = guarded(async request => {
  assertSameOrigin(request);
  const input = objectInput(await readJson(request), ['fixtureId']);
  const actor = requireReviewer(request);
  if (getRuntimeConfig().mode === 'production') throw new RepositoryError('FEEDS_DEFERRED', 403, 'Synthetic fixture import is disabled in production.');
  if (typeof input.fixtureId !== 'string' || input.fixtureId.length > 100) throw new RepositoryError('INVALID_FIXTURE', 422, 'Select an available synthetic fixture.');
  const fixture = fixtureList(fixtureEpoch()).find(item => item.fixtureId === input.fixtureId);
  if (!fixture) throw new RepositoryError('INVALID_FIXTURE', 422, 'Select an available synthetic fixture.');
  return jsonResponse(repository().importRecord(fixture.record, new Date(), actor));
});

export const listAdminOpportunities = guarded(request => {
  requireReviewer(request);
  return jsonResponse({ data: repository().listReview() });
});

export const reviewOpportunity = guarded(async request => {
  assertSameOrigin(request);
  const input = objectInput(await readJson(request), ['id', 'expectedVersion', 'decision', 'reason']);
  const actor = requireReviewer(request);
  if (typeof input.id !== 'string' || input.id.length > 100 || !Number.isSafeInteger(input.expectedVersion) || typeof input.expectedVersion !== 'number' || input.expectedVersion < 1 || (input.decision !== 'PUBLISH' && input.decision !== 'REJECT') || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000) throw new RepositoryError('INVALID_REVIEW', 422, 'Select a record and provide its current version, a decision and a reason (1–1000 characters).');
  const review: ReviewInput = { expectedVersion: input.expectedVersion, decision: input.decision, reason: input.reason };
  return jsonResponse({ data: repository().review(input.id, review, new Date(), actor) });
});

function adminRead(read: () => unknown): Action {
  return guarded(request => { requireReviewer(request); return jsonResponse({ data: read() }); });
}
export const getOverview = adminRead(() => { const overview = repository().overview(), config = getRuntimeConfig(); return { ...overview, integrations: { feeds: 'DEFERRED', authentication: config.mode === 'demo' ? 'LOCAL_DEMO' : 'DURABLE_ACCOUNTS', ai: config.ai.enabled ? 'OPTIONAL_GROUNDED_PROVIDER' : 'DETERMINISTIC_RULES', emailSms: config.notification.enabled ? 'CONFIGURED_NOT_LIVE_VERIFIED' : 'NOT_CONNECTED' } }; });
export const getSources = adminRead(() => repository().listSources());
export const getImportRuns = adminRead(() => repository().listImportRuns());
export const getOrganizations = adminRead(() => repository().listOrganizations());
export const getMatchingQa = adminRead(() => repository().matchingQa());
export const getExceptions = adminRead(() => repository().listExceptions());
export const getCommunities = adminRead(() => repository().listCommunities());

function boundedId(id: string): void {
  if (!id || id.length > 200) throw new RepositoryError('NOT_FOUND', 404, 'Resource not found.');
}
export async function getAdminOpportunity(request: Request, id: string): Promise<Response> {
  return guarded(() => {
    requireReviewer(request); boundedId(id);
    const item = repository().getAdmin(id);
    if (!item) throw new RepositoryError('NOT_FOUND', 404, 'Opportunity not found.');
    return jsonResponse({ data: item });
  })(request);
}
export async function editAdminOpportunity(request: Request, id: string): Promise<Response> {
  return guarded(async () => {
    assertSameOrigin(request); boundedId(id);
    const input = objectInput(await readJson(request), ['expectedVersion','reason','changes']);
    const actor = requireReviewer(request);
    // Repository validates every edit key, field value and version before mutation.
    return jsonResponse({ data: repository().editOpportunity(id, input as unknown as EditOpportunityInput, new Date(), actor) });
  })(request);
}
export async function actOnOpportunity(request: Request, id: string): Promise<Response> {
  return guarded(async () => {
    assertSameOrigin(request); boundedId(id);
    const input = objectInput(await readJson(request), ['expectedVersion','action','reason']);
    const actor = requireReviewer(request);
    return jsonResponse({ data: repository().catalogueAction(id, input as unknown as CatalogueActionInput, new Date(), actor) });
  })(request);
}
export async function updateSource(request: Request, id: string): Promise<Response> {
  return guarded(async () => {
    assertSameOrigin(request); boundedId(id);
    const input = objectInput(await readJson(request), ['expectedVersion','paused','reason']);
    const actor = requireReviewer(request);
    return jsonResponse({ data: repository().updateSource(id, input as unknown as SourceUpdate, new Date(), actor) });
  })(request);
}
export async function updateException(request: Request, id: string): Promise<Response> {
  return guarded(async () => {
    assertSameOrigin(request); boundedId(id);
    const input = objectInput(await readJson(request), ['action','reason']);
    const actor = requireReviewer(request);
    return jsonResponse({ data: repository().updateException(id, input as unknown as ExceptionInput, new Date(), actor) });
  })(request);
}
export async function updateCommunity(request: Request, slug: string): Promise<Response> {
  return guarded(async () => {
    assertSameOrigin(request); boundedId(slug);
    const input = objectInput(await readJson(request), ['expectedVersion','published','reason']);
    const actor = requireReviewer(request);
    return jsonResponse({ data: repository().updateCommunity(slug, input as unknown as CommunityUpdate, new Date(), actor) });
  })(request);
}
export async function getCommunity(request: Request, slug: string): Promise<Response> {
  return guarded(() => {
    boundedId(slug); const page = repository().getCommunity(slug);
    if (!page) throw new RepositoryError('NOT_FOUND', 404, 'Demo community page not found.');
    return jsonResponse({ data: page });
  })(request);
}
