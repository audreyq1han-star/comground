import { apiError, assertLoopback, assertSameOrigin, jsonResponse, objectInput, readJson } from './http.ts';
import { requireStudent } from './student-auth.ts';
import { students } from './student-runtime.ts';
import { explainMatches } from './ai-explanations.ts';
import { optionalAiProvider } from './ai-runtime.ts';
import { getRuntimeConfig } from './runtime-config.ts';
import { RepositoryError } from './errors.ts';
import { recommendationRefs } from './measurement-presentation.ts';

export async function postMatchExplanations(request: Request): Promise<Response> {
  try {
    assertLoopback(request); assertSameOrigin(request);
    if (new URL(request.url).search) throw new RepositoryError('INVALID_QUERY', 400, 'This resource does not accept query parameters.');
    const input = objectInput(await readJson(request), ['expectedProfileVersion']);
    const owner = requireStudent(request), store = students();
    const matches = store.matches(owner), privacy = store.getPrivacy(owner), config = getRuntimeConfig();
    if (input.expectedProfileVersion !== matches.profileVersion) throw new RepositoryError('VERSION_CONFLICT', 409, 'Your profile changed. Refresh matches before requesting explanations.');
    if (config.ai.enabled && !privacy.aiExplanations) throw new RepositoryError('AI_CONSENT_REQUIRED', 403, 'Enable optional AI processing in privacy settings first.');
    // Never spend a request or send data for an empty eligible pool.
    const result = await explainMatches(matches, matches.data.length ? optionalAiProvider(owner) : null);
    const currentOwner = requireStudent(request), current = store.matches(owner), currentPrivacy = store.getPrivacy(owner);
    if (currentOwner !== owner || current.profileVersion !== matches.profileVersion || currentPrivacy.version !== privacy.version || JSON.stringify(recommendationRefs(current)) !== JSON.stringify(recommendationRefs(matches))) throw new RepositoryError('STALE_PRESENTATION', 409, 'Your profile, privacy choice, or listing changed. Refresh before requesting explanations.');
    return jsonResponse({ data: result });
  } catch (error) { return apiError(error); }
}
