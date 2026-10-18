export type PermissionStatus = 'APPROVED' | 'PENDING' | 'REVOKED';
export type OpportunityStatus = 'DRAFT' | 'PUBLISHED' | 'REJECTED';
export type AttendanceMode = 'IN_PERSON' | 'REMOTE';
/** Stable dated session identity. Repeats are stored explicitly, never generated on reads. */
export type OpportunityOccurrence = { id: string; startsAt: string; endsAt: string; timezone: string; validUntil: string; isCancelled: boolean };
export type FixtureRecord = {
  isSynthetic: true;
  source: { id: string; name: string; url: string; method: 'FIXTURE'; permission: PermissionStatus; permissionEvidence: string };
  organization: { id: string; name: string; url: string };
  externalId: string;
  title: string;
  summary: string;
  category: string;
  interests: string[];
  minAge: number | null;
  maxAge: number | null; // null means no upper age restriction; minAge must be known.
  startsAt: string;
  endsAt: string;
  timezone: string;
  mode: AttendanceMode;
  area: string;
  fee: number | null;
  requiresTraining: boolean | null;
  requiresGuardian: boolean | null;
  schoolCreditApproved: boolean | null;
  signupUrl: string;
  sourceUpdatedAt: string;
  fetchedAt: string;
  confirmedAt: string;
  validUntil: string;
  isCancelled: boolean;
  occurrences?: OpportunityOccurrence[];
  evidence: { field: string; excerpt: string; sourceUrl: string }[];
};
export type PublicOpportunity = {
  id: string;
  occurrenceId?: string;
  /** Current available dates only; top-level schedule describes occurrenceId. */
  occurrences?: OpportunityOccurrence[];
  version: number;
  isSynthetic: true;
  title: string;
  summary: string;
  category: string;
  interests: string[];
  organization: { id: string; name: string; url: string };
  source: { name: string; url: string };
  minAge: number | null;
  maxAge: number | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  mode: AttendanceMode;
  area: string;
  fee: number | null;
  requiresTraining: boolean | null;
  requiresGuardian: boolean | null;
  schoolCreditApproved: boolean | null;
  signupUrl: string;
  fetchedAt: string;
  confirmedAt: string;
  validUntil: string;
  evidence: { field: string; excerpt: string; sourceUrl: string }[];
};
export type AdminOpportunity = {
  id: string;
  version: number;
  status: OpportunityStatus;
  record: FixtureRecord;
  issues: string[];
  createdAt: string;
  updatedAt: string;
  reviewEvents: { decision: 'PUBLISH' | 'REJECT'; reason: string; at: string; version: number }[];
};
export type Preferences = {
  /** School stage is separate from age; the initial audience includes adult high-school students. */
  schoolStage?: 'HIGH_SCHOOL';
  /** Opaque synthetic program reference; never a school name or credit certification. */
  schoolProgramId?: string;
  /** Optional bounded synthetic travel estimate; absent preserves exact coarse-area matching. */
  maxTravelMinutes?: number;
  ageMin: number;
  ageMax: number;
  availableFrom: string;
  availableUntil: string;
  mode: 'ANY' | AttendanceMode;
  area: string;
  interests: string[];
  maxFee: number;
  hasTraining: boolean;
  hasGuardian: boolean;
  requiresSchoolCredit: boolean;
};
export type EligibilityResult = {
  status: 'ELIGIBLE' | 'INELIGIBLE' | 'NEEDS_CONFIRMATION';
  reasonCodes: string[];
  reasons: string[];
};
export type MatchResult = {
  opportunity: PublicOpportunity;
  eligibility: EligibilityResult;
  reasons: string[];
  rankScore: number; // internal ordering; never render as percent confidence.
  ranking?: { policyVersion: string; interest: number; travel: number; freshness: number };
};
export type ReviewInput = { expectedVersion: number; decision: 'PUBLISH' | 'REJECT'; reason: string };
export type FixtureOption = { fixtureId: string; label: string; record: FixtureRecord };
