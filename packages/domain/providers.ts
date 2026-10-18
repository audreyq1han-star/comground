import type { EligibilityResult, FixtureRecord, PublicOpportunity } from './contracts.ts';

/** Extension seams. Concrete account, notification, and grounded-AI adapters live in apps/web/lib. Live activation is configuration-gated. */
export interface IdentityProvider {
  resolveSession(request: Request): Promise<{ subject: string; role: 'STUDENT' | 'OPERATOR' } | null>;
}
export interface PermittedSourceAdapter {
  readonly sourceId: string;
  readonly permissionEvidence: string;
  collect(cursor?: string): Promise<{ records: FixtureRecord[]; nextCursor?: string }>;
}
/** A future explainer receives checked facts, never authority to change eligibility. */
export interface MatchExplanationProvider {
  explain(input: { opportunity: PublicOpportunity; eligibility: EligibilityResult; groundedReasons: string[] }): Promise<string[]>;
}
export interface NotificationDeliveryProvider {
  deliver(input: { subject: string; consentVersion: string; reminderId: string; message: string }): Promise<{ accepted: boolean }>;
}
