import type { PublicOpportunity } from './contracts.ts';

export type DigestSubscription = { enabled: boolean; version: number; profileVersion: number | null; updatedAt: string | null; externalEligible: boolean; purpose: 'OPTIONAL_SHORTLIST_DIGEST' };
export type DigestOccurrence = { opportunityId: string; occurrenceId: string; opportunityVersion: number; startsAt: string; endsAt: string; timezone: string };
export type DigestDispatchReference = { batchId: string; batchVersion: number; subscriptionVersion: number; profileVersion: number };
export type DistributionAudit = { action: string; actor: string; at: string; version: number };
export type DigestBatch = {
  id: string; label: string; state: 'PREPARED' | 'APPROVED' | 'CANCELLED'; version: number;
  createdAt: string; updatedAt: string; expiresAt: string;
  counts: { prepared: number; queued: number; skipped: number; pending: number };
  opportunities: (DigestOccurrence & { title: string })[];
  audit: DistributionAudit[]; studentIdentitiesIncluded: false;
};
export type DigestPreview = { generatedAt: string; profileVersion: number; opportunities: PublicOpportunity[]; delivery: 'PRIVATE_IN_APP_ONLY' };
export type DistributionExport = { subscription: Omit<DigestSubscription, 'externalEligible'>; batches: { batchId: string; state: string; subscriptionVersion: number; profileVersion: number; occurrences: DigestOccurrence[]; createdAt: string }[] };
export type CommunityRecord = {
  id: string; slug: string; title: string; description: string; channel: 'SCHOOL_CLUB' | 'COMMUNITY';
  state: 'DRAFT' | 'APPROVED' | 'PAUSED' | 'ARCHIVED'; version: number; createdAt: string; updatedAt: string;
  isSynthetic: true; partnerVerified: false; disclosure: 'Synthetic example — no school, community or organizer partnership is claimed.';
  path: string; audit: DistributionAudit[];
};
export type PublicCommunityRecord = Omit<CommunityRecord, 'audit'> & { opportunities: PublicOpportunity[] };
export type DistributionPage<T> = { items: T[]; total: number; offset: number; limit: number };
