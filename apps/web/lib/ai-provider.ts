import type { GroundedCandidate, GroundedSelection } from '../../../packages/domain/ai-contracts.ts';

export interface GroundedExplanationProvider { select(candidates: GroundedCandidate[]): Promise<unknown>; }
export class AiProviderError extends Error { readonly kind: 'PROVIDER_UNAVAILABLE' | 'INVALID_OUTPUT'; constructor(kind: 'PROVIDER_UNAVAILABLE' | 'INVALID_OUTPUT') { super(kind); this.kind = kind; } }
const ENDPOINT = 'https://api.openai.com/v1/responses';
const MAX_RESPONSE_BYTES = 32_768;
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new AiProviderError('PROVIDER_UNAVAILABLE');
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw new AiProviderError('INVALID_OUTPUT');
  const reader = response.body?.getReader();
  if (!reader) throw new AiProviderError('INVALID_OUTPUT');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new AiProviderError('INVALID_OUTPUT'); } chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { if (error instanceof AiProviderError) throw error; throw new AiProviderError('INVALID_OUTPUT'); }
  finally { reader.releaseLock(); }
}
/** Actual HTTP adapter. Tests inject fetch; production never substitutes fake output. */
export function createOpenAiExplanationProvider(options: { apiKey: string; model: string; fetch?: typeof fetch; timeoutMs?: number }): GroundedExplanationProvider {
  return { async select(candidates) {
    if (!candidates.length) return { items: [] };
    const transport = options.fetch ?? fetch;
    const timeoutMs = Math.min(8_000, Math.max(1, options.timeoutMs ?? 6_000));
    const schema = { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', minItems: candidates.length, maxItems: candidates.length, items: { type: 'object', additionalProperties: false, required: ['candidateId', 'reasonIds'], properties: { candidateId: { type: 'string', enum: candidates.map(item => item.candidateId) }, reasonIds: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', enum: ['REQUIREMENTS_MET', 'INTEREST_OVERLAP', 'REMOTE', 'NO_FEE'] } } } } } } };
    try {
      const response = await transport(ENDPOINT, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: options.model, store: false, max_output_tokens: 800, instructions: 'For every supplied eligible candidate, select one to four allowedReasonIds in useful emphasis order. Return each candidate exactly once. Do not infer safety, school approval, admission, or any facts not supplied. Eligibility and ranking are already decided. Never add prose or identifiers.', input: JSON.stringify({ candidates }), text: { format: { type: 'json_schema', name: 'grounded_match_reasons', strict: true, schema } } }) });
      const payload = await boundedJson(response) as { status?: unknown; output?: { type?: string; role?: string; content?: { type?: string; text?: unknown }[] }[] };
      if (!payload || payload.status !== 'completed' || !Array.isArray(payload.output)) throw new AiProviderError('INVALID_OUTPUT');
      const messages = payload.output.filter(item => item.type === 'message');
      const content = messages.flatMap(item => item.content ?? []);
      if (messages.length !== 1 || messages[0].role !== 'assistant' || content.length !== 1 || content[0].type !== 'output_text' || typeof content[0].text !== 'string') throw new AiProviderError('INVALID_OUTPUT');
      return JSON.parse(content[0].text) as GroundedSelection;
    } catch (error) { if (error instanceof AiProviderError) throw error; throw new AiProviderError('PROVIDER_UNAVAILABLE'); }
  } };
}
