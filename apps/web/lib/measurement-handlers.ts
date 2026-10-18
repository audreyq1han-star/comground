import { requireReviewer } from './auth.ts';
import { RepositoryError } from './errors.ts';
import { apiError, assertLoopback, assertSameOrigin, jsonResponse, objectInput, readJson } from './http.ts';
import { MEASUREMENT_RULES_VERSION } from './measurement-repository.ts';
import { assertCurrentPositiveFeedback, presentationRequestId, readPresentation, recommendationRefs, signPresentation } from './measurement-presentation.ts';
import { requireStudent } from './student-auth.ts';
import { studentResourceId } from './student-repository.ts';
import { students } from './student-runtime.ts';
import { requireAccount } from './account-auth.ts';
import { getRuntimeConfig } from './runtime-config.ts';

type Action = (request: Request) => Response | Promise<Response>;
function guarded(action: Action): Action { return async request => { try { assertLoopback(request); if (new URL(request.url).search) throw new RepositoryError('INVALID_QUERY', 400, 'Measurement resources do not accept query parameters.'); return await action(request); } catch (error) { return apiError(error); } }; }
export const getMeasurementConsent = guarded(request => jsonResponse({ data: students().measurement.consent(requireStudent(request)) }));
export const putMeasurementConsent = guarded(async request => { assertSameOrigin(request); const input = await readJson(request), owner = requireStudent(request); return jsonResponse({ data: students().measurement.setConsent(owner, input) }); });
export const getAttribution = guarded(request => jsonResponse({ data: students().measurement.attribution(requireStudent(request)) }));
export const postAttribution = guarded(async request => { assertSameOrigin(request); const input = await readJson(request), owner = requireStudent(request); return jsonResponse({ data: students().measurement.attribute(owner, input) }); });
export const postRecommendations = guarded(async request => {
  assertSameOrigin(request); const input = objectInput(await readJson(request), ['requestId']), owner = requireStudent(request);
  const requestId = presentationRequestId(input.requestId), store = students(), matches = store.matches(owner), state = store.measurement.consent(owner);
  return jsonResponse({ ...matches, presentationToken: state.enabled ? signPresentation(owner, requestId, matches, state.version) : null, measurementEnabled: state.enabled, rulesVersion: MEASUREMENT_RULES_VERSION });
});
export const postExposure = guarded(async request => {
  assertSameOrigin(request); const input = objectInput(await readJson(request), ['presentationToken']), owner = requireStudent(request);
  const receipt = readPresentation(input.presentationToken, owner), store = students(), current = store.matches(owner);
  if (current.profileVersion !== receipt.profileVersion || JSON.stringify(recommendationRefs(current)) !== JSON.stringify(receipt.items)) throw new RepositoryError('STALE_PRESENTATION', 409, 'The profile or available recommendation dates changed. Generate a fresh shortlist before recording it.');
  return jsonResponse({ data: store.measurement.recordExposure(receipt) });
});
export const postRecommendationFeedback = guarded(async request => {
  assertSameOrigin(request); const input = objectInput(await readJson(request), ['exposureId', 'opportunityId', 'occurrenceId', 'verdict']), owner = requireStudent(request);
  const store = students(), batch = store.measurement.getExposure(owner, studentResourceId(input.exposureId)), current = store.matches(owner);
  const presented = batch.items.find(item => item.opportunityId === input.opportunityId && item.occurrenceId === input.occurrenceId);
  if (!presented) throw new RepositoryError('NOT_PRESENTED', 422, 'Choose an occurrence from this shown shortlist.');
  assertCurrentPositiveFeedback(input.verdict, batch, presented, current);
  return jsonResponse({ data: store.measurement.feedback(owner, input) });
});
export const getPublicCampaigns = guarded(() => jsonResponse({ data: students().measurement.campaigns(true) }));
export const getCampaigns = guarded(request => { requireReviewer(request); return jsonResponse({ data: students().measurement.campaigns() }); });
export function patchCampaign(request: Request, id: string): Response | Promise<Response> { return guarded(async req => { assertSameOrigin(req); const input = await readJson(req); requireReviewer(req); const actor = getRuntimeConfig().mode === 'demo' ? 'demo-reviewer' : requireAccount(req, { role: 'OPERATOR', verified: true }).id; return jsonResponse({ data: students().measurement.updateCampaign(studentResourceId(id), input, actor) }); })(request); }
export const getMeasurementSummary = guarded(request => { requireReviewer(request); return jsonResponse({ data: students().measurement.summary() }); });
