import type { StudentMatches } from '../../../packages/domain/app-contracts.ts';
import type { AiExplanationResult, GroundedCandidate, GroundedReasonId, GroundedSelection } from '../../../packages/domain/ai-contracts.ts';
import { AiProviderError, type GroundedExplanationProvider } from './ai-provider.ts';

const LABELS: Record<GroundedReasonId, string> = {
  REQUIREMENTS_MET: 'The published facts meet your selected requirements; confirm details with the organizer.',
  INTEREST_OVERLAP: 'The listing overlaps with your selected interests.', REMOTE: 'The listing offers remote participation.', NO_FEE: 'The listing states there is no participation fee.',
};
const LIMITATION = 'AI selects emphasis only. Rules determine eligibility and order. Confirm requirements with the organizer.';
/** No identity, age, location, free text, dates, or database IDs leave the process. */
export function groundedCandidates(matches: StudentMatches): GroundedCandidate[] {
  if (matches.data.length > 3 || matches.data.some(item => item.eligibility.status !== 'ELIGIBLE')) throw new AiProviderError('INVALID_OUTPUT');
  return matches.data.map((item, index) => {
    const facts = { interestOverlap: Math.min(12, Math.max(0, Math.floor(item.rankScore))), remote: item.opportunity.mode === 'REMOTE', noFee: item.opportunity.fee === 0 };
    const allowedReasonIds: GroundedReasonId[] = ['REQUIREMENTS_MET'];
    if (facts.interestOverlap) allowedReasonIds.push('INTEREST_OVERLAP');
    if (facts.remote) allowedReasonIds.push('REMOTE');
    if (facts.noFee) allowedReasonIds.push('NO_FEE');
    return { candidateId: `candidate-${index + 1}`, facts, allowedReasonIds };
  });
}
export function validateGroundedSelection(value: unknown, candidates: GroundedCandidate[]): GroundedSelection {
  const invalid = () => { throw new AiProviderError('INVALID_OUTPUT'); };
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join() !== 'items') return invalid();
  const items = (value as GroundedSelection).items;
  if (!Array.isArray(items) || items.length !== candidates.length) return invalid();
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join() !== 'candidateId,reasonIds') return invalid();
    const candidate = candidates.find(candidate => candidate.candidateId === item.candidateId);
    if (!candidate || seen.has(item.candidateId) || !Array.isArray(item.reasonIds) || !item.reasonIds.length || item.reasonIds.length > 4 || new Set(item.reasonIds).size !== item.reasonIds.length || item.reasonIds.some(id => !candidate.allowedReasonIds.includes(id))) return invalid();
    seen.add(item.candidateId);
  }
  return { items };
}
export async function explainMatches(matches: StudentMatches, provider: GroundedExplanationProvider | null): Promise<AiExplanationResult> {
  const candidates = groundedCandidates(matches);
  const fallback = (reason: AiExplanationResult['reason']): AiExplanationResult => ({ mode: 'DETERMINISTIC_FALLBACK', reason, profileVersion: matches.profileVersion, limitation: LIMITATION, items: matches.data.map(item => ({ opportunityId: item.opportunity.id, occurrenceId: item.opportunity.occurrenceId ?? 'primary', version: item.opportunity.version, reasons: [...item.reasons] })) });
  if (!candidates.length) return fallback('EMPTY_ELIGIBLE_POOL');
  if (!provider) return fallback('DISABLED');
  try {
    const selection = validateGroundedSelection(await provider.select(candidates), candidates);
    return { mode: 'GROUNDED_AI_SELECTION', reason: 'COMPLETE', profileVersion: matches.profileVersion, limitation: LIMITATION, items: matches.data.map((item, index) => ({ opportunityId: item.opportunity.id, occurrenceId: item.opportunity.occurrenceId ?? 'primary', version: item.opportunity.version, reasons: selection.items.find(item => item.candidateId === candidates[index].candidateId)!.reasonIds.map(id => LABELS[id]) })) };
  } catch (error) { return fallback(error instanceof AiProviderError ? error.kind : 'PROVIDER_UNAVAILABLE'); }
}
