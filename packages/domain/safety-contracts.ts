export const SAFETY_CATEGORIES = ['UNSAFE_CONTACT', 'HARMFUL_CONTENT', 'UNSAFE_ACTIVITY', 'PLATFORM_SAFETY', 'OTHER'] as const;
export type SafetyCategory = typeof SAFETY_CATEGORIES[number];
export const SAFETY_STATUSES = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'] as const;
export type SafetyStatus = typeof SAFETY_STATUSES[number];
export const SAFETY_RATIONALES = ['REVIEW_STARTED', 'REVIEW_CONTINUES', 'REVIEW_COMPLETE', 'DUPLICATE', 'OUTSIDE_SCOPE', 'INSUFFICIENT_INFORMATION', 'REOPENED', 'QUARANTINE_REVIEW', 'ASSIGNMENT_UPDATED'] as const;
export type SafetyRationale = typeof SAFETY_RATIONALES[number];
export const SAFETY_URGENCIES = ['ROUTINE', 'TIME_SENSITIVE', 'IMMEDIATE_DANGER'] as const;
export type SafetyUrgency = typeof SAFETY_URGENCIES[number];
export const SAFETY_URGENCY_LABELS: Record<SafetyUrgency,string> = { ROUTINE: 'General concern', TIME_SENSITIVE: 'Time-sensitive concern', IMMEDIATE_DANGER: 'Someone may be in immediate danger' };
export type SafetyTargetInput = { kind: 'PLATFORM' } | { kind: 'LISTING'; opportunityId: string; occurrenceId: string };
export type SafetyTarget = { kind: 'PLATFORM' } | { kind: 'LISTING'; opportunityId: string; occurrenceId: string; title: string; startsAt: string; endsAt: string; listingVersion: number };
export type CreateSafetyReportInput = { storageConsent: true; target: SafetyTargetInput; category: SafetyCategory; urgency?: SafetyUrgency; narrative?: string };
export type SafetyModerationInput = { expectedVersion: number; status: SafetyStatus; rationale: SafetyRationale; requestQuarantine?: boolean; assignedOperatorId?: string | null };
export type SafetyEvent = { version: number; status: SafetyStatus; rationale: SafetyRationale | null; actor: 'REPORTER' | 'OPERATOR'; quarantineRequested: boolean; at: string };
/** No reporter identity, profile, email, preferences, or operator identity crosses this DTO. */
export type SafetyReport = { id: string; target: SafetyTarget; category: SafetyCategory; urgency: SafetyUrgency; narrative: string; status: SafetyStatus; rationale: SafetyRationale | null; version: number; quarantineRequested: boolean; createdAt: string; updatedAt: string; events: SafetyEvent[] };
/** Only the explicit operator queue includes opaque operator audit and assignment references. Reporter IDs are never included. */
export type OperatorSafetyReport = Omit<SafetyReport,'events'> & { assignedOperatorId: string | null; events: (SafetyEvent & { actorId: string | null; assignedOperatorId: string | null })[] };
export type SafetyExport = { reports: SafetyReport[]; reportingLimit: { windowStartedAt: string; count: number } | null };
export const SAFETY_CATEGORY_LABELS: Record<SafetyCategory, string> = { UNSAFE_CONTACT: 'Unsafe contact or behaviour', HARMFUL_CONTENT: 'Harmful content', UNSAFE_ACTIVITY: 'Unsafe activity or conditions', PLATFORM_SAFETY: 'Platform safety concern', OTHER: 'Another safety concern' };
export const SAFETY_STATUS_LABELS: Record<SafetyStatus, string> = { OPEN: 'Recorded', IN_REVIEW: 'In local review', RESOLVED: 'Local review complete', DISMISSED: 'Closed without action' };
export const SAFETY_RATIONALE_LABELS: Record<SafetyRationale, string> = { REVIEW_STARTED: 'Local review started', REVIEW_CONTINUES: 'Local review is continuing', REVIEW_COMPLETE: 'Local review completed', DUPLICATE: 'Duplicate concern', OUTSIDE_SCOPE: 'Outside the scope of this local app', INSUFFICIENT_INFORMATION: 'Not enough information to determine an action', REOPENED: 'Reopened for local review', QUARANTINE_REVIEW: 'Listing withdrawal requested for review', ASSIGNMENT_UPDATED: 'Local review assignment updated' };
