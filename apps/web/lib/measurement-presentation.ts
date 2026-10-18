import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { StudentOwnerId, StudentMatches } from '../../../packages/domain/app-contracts.ts';
import type { RecommendationExposure, RecommendationRef } from '../../../packages/domain/measurement-contracts.ts';
import { RepositoryError } from './errors.ts';
import { MEASUREMENT_RULES_VERSION, type PresentationReceipt } from './measurement-repository.ts';

const state = globalThis as typeof globalThis & { comgroundPresentationKey?: string };
function key(): string { return state.comgroundPresentationKey ??= randomBytes(32).toString('base64url'); }
function signature(payload: string, secret: string): string { return createHmac('sha256', secret).update(`comground.presentation.v1:${payload}`).digest('base64url'); }
export function presentationRequestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw new RepositoryError('INVALID_INPUT', 422, 'Provide a new UUID for this intentional shortlist request.');
  return value.toLowerCase();
}
export function recommendationRefs(matches: StudentMatches): RecommendationRef[] { return matches.data.map(({ opportunity }) => ({ opportunityId: opportunity.id, occurrenceId: opportunity.occurrenceId ?? 'primary', version: opportunity.version })); }
export function assertCurrentPositiveFeedback(verdict: unknown, batch: RecommendationExposure, presented: RecommendationRef, current: StudentMatches): void {
  // A formerly shown listing can become unsuitable. Negative feedback remains a
  // truthful response to that historical presentation; a positive claim must
  // still describe the current profile and published occurrence facts.
  if (verdict === 'RELEVANT' && (current.profileVersion !== batch.profileVersion || !recommendationRefs(current).some(item => item.opportunityId === presented.opportunityId && item.occurrenceId === presented.occurrenceId && item.version === presented.version))) throw new RepositoryError('STALE_PRESENTATION', 409, 'That shown occurrence or profile has changed. Generate a new shortlist before responding that it is relevant.');
}
export function signPresentation(owner: StudentOwnerId, requestId: string, matches: StudentMatches, consentVersion: number, now = new Date(), secret = key()): string {
  const receipt: PresentationReceipt = { owner, requestId: presentationRequestId(requestId), issuedAt: now.toISOString(), consentVersion, profileVersion: matches.profileVersion, rulesVersion: MEASUREMENT_RULES_VERSION, items: recommendationRefs(matches) };
  const payload = Buffer.from(JSON.stringify(receipt)).toString('base64url');
  return `${payload}.${signature(payload, secret)}`;
}
export function readPresentation(token: unknown, owner: StudentOwnerId, now = new Date(), secret = key()): PresentationReceipt {
  const invalid = () => new RepositoryError('INVALID_PRESENTATION', 409, 'This shown-shortlist receipt is invalid or expired. Generate a new shortlist.');
  if (typeof token !== 'string' || token.length > 8192) throw invalid();
  const [payload, signed, extra] = token.split('.');
  if (!payload || !signed || extra !== undefined || !timingSafeEqual(createHash('sha256').update(signed).digest(), createHash('sha256').update(signature(payload, secret)).digest())) throw invalid();
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PresentationReceipt;
    const age = now.getTime() - Date.parse(value.issuedAt);
    if (value.owner !== owner || !Number.isFinite(age) || age < 0 || age > 15 * 60 * 1000 || value.rulesVersion !== MEASUREMENT_RULES_VERSION || !Number.isSafeInteger(value.profileVersion) || !Number.isSafeInteger(value.consentVersion) || !Array.isArray(value.items) || value.items.length > 3) throw invalid();
    presentationRequestId(value.requestId);
    return value;
  } catch { throw invalid(); }
}
