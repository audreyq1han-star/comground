import type { StudentMatches } from './app-contracts.ts';

/** Synthetic, explicitly consented local measurement; never an external tracker. */
export type MeasurementConsent = { enabled: boolean; version: number; profileVersion: number | null; consentedAt: string | null; retentionDays: 90 };
export type MeasurementConsentInput = { expectedVersion: number; expectedProfileVersion: number; enabled: boolean };
export type Campaign = { id: string; name: string; channel: 'SCHOOL_CLUB' | 'COMMUNITY'; paused: boolean; version: number; path: string; isSynthetic: true };
export type CampaignUpdate = { expectedVersion: number; paused: boolean };
export type Attribution = { campaignId: string; channel: Campaign['channel']; attributedAt: string; campaignSnapshot?: Campaign | null };
export type RecommendationRef = { opportunityId: string; occurrenceId: string; version: number; /** Immutable published dates captured server-side; legacy unknowns stay absent. */ startsAt?: string; endsAt?: string };
export type RecommendationPresentation = StudentMatches & { presentationToken: string | null; measurementEnabled: boolean; rulesVersion: string };
export type RecommendationExposure = { id: string; requestId: string; presentedAt: string; profileVersion: number; profileStartedAt?: string | null; rulesVersion: string; items: RecommendationRef[]; campaignId: string | null; campaignSnapshot?: Campaign | null; observationEndsAt: string };
export type RecommendationVerdict = 'RELEVANT' | 'NOT_RELEVANT';
export type RecommendationFeedbackInput = Pick<RecommendationRef, 'opportunityId' | 'occurrenceId'> & { exposureId: string; verdict: RecommendationVerdict };
export type RecommendationFeedback = RecommendationFeedbackInput & { at: string };
export type MeasurementOutcomeKind = 'SAVED' | 'OPENED' | 'APPLIED' | 'ATTENDED' | 'NOT_RELEVANT';
export type MeasurementOutcome = Pick<RecommendationRef, 'opportunityId' | 'occurrenceId'> & { exposureId: string; kind: MeasurementOutcomeKind; at: string; evidenceKind: 'LOCAL_ACTION' | 'SELF_REPORTED' | 'PRIVATE_FIT_FEEDBACK' };
export type MeasurementExport = { consent: MeasurementConsent; attribution: Attribution | null; exposures: RecommendationExposure[]; feedback: RecommendationFeedback[]; outcomes: MeasurementOutcome[] };
export type AggregateMetrics = {
  seekers: number; recipients: number; noMatchOnlySeekers: number; batches: number;
  respondents: number; relevantRecipients: number; notRelevantRecipients: number; lateRespondents: number; lateRelevantRecipients: number;
  savedRecipients: number; openedRecipients: number; appliedWithin7Days: number; attendedRecipients: number;
  completedObservationRecipients: number; partialObservationRecipients: number;
  usefulRate: number | null; applicationRate: number | null; coverageRate: number | null;
  nextStep: { appliedExactWithin7Days: number; syntheticIntroductionsWithin7Days: number; bothWithin7Days: number; recipientsWithin7Days: number; unlinkedAppliedWithin7Days: number; rate: number | null; evidenceKind: 'SELF_REPORT_OR_SYNTHETIC_NOT_VERIFIED' };
  firstUsefulMatch: { sampleCount: number; missingBaselineRecipients: number; medianHours: number | null; p90Hours: number | null; suppressed: boolean };
  repeatSelfReported: { evidenceKind: 'SELF_REPORTED'; historyDays: 90; observationDays: 28; observedParticipants: number; matureParticipants: number; partialParticipants: number; repeatedWithin28Days: number; rate: number | null };
};
export type MeasurementAggregate = { suppressed: boolean; suppressionReason: string | null; metrics: AggregateMetrics | null };
export type MeasurementSummary = {
  generatedAt: string; windowDays: 30; outcomeWindowDays: 7; cohortThreshold: 3; studentIdentitiesIncluded: false;
  evidenceLabel: 'Opted-in synthetic local actions and self-reports';
  live: MeasurementAggregate;
  periodVersion: 'presentation-cohorts-v2';
  weekly: MeasurementAggregate & { windowDays: 7; from: string; through: string };
  channels: (MeasurementAggregate & { campaignId: string; label: string })[];
  rulesVersions: (MeasurementAggregate & { rulesVersion: string })[];
  calculationExample: { label: 'Separate synthetic calculation example — not live activity'; description: string; metrics: AggregateMetrics; channels: { label: string; metrics: AggregateMetrics }[] };
  definitions: { usefulRate: string; applicationRate: string; nextStepRate: string; coverageRate: string; observation: string; privacy: string };
};
