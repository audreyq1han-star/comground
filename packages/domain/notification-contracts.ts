export type NotificationPurpose = 'VERIFY_EMAIL' | 'RESET_PASSWORD' | 'EVENT_REMINDER' | 'DIGEST';
export type NotificationState = 'BLOCKED' | 'QUEUED' | 'LEASED' | 'RETRY' | 'ACCEPTED' | 'DEAD_LETTER' | 'CANCELLED';
export type NotificationAvailability = 'READY' | 'DELIVERY_DISABLED' | 'CONFIGURATION_MISSING' | 'VERIFICATION_REQUIRED' | 'DEMO_DISABLED' | 'RECIPIENT_SUPPRESSED';
export type NotificationReceiptStatus = 'DELIVERED' | 'FAILED' | 'BOUNCED' | 'COMPLAINED';
export type NotificationReceipt = { status: NotificationReceiptStatus; occurredAt: string; receivedAt: string };
export type NotificationSuppression = { reason: 'BOUNCED' | 'COMPLAINED'; createdAt: string };
export type NotificationReason = 'CONSENT_WITHDRAWN' | 'CONSENT_CHANGED' | 'OWNER_UNAVAILABLE' | 'RECIPIENT_UNVERIFIED' | 'RECIPIENT_SUPPRESSED' | 'OPPORTUNITY_UNAVAILABLE' | 'TOKEN_EXPIRED' | 'CONFIGURATION_BLOCKED' | 'PROVIDER_REJECTED' | 'PROVIDER_RETRYABLE' | 'DELIVERY_UNCERTAIN' | 'MAX_ATTEMPTS' | 'IDEMPOTENCY_WINDOW_EXPIRED' | 'PAYLOAD_UNAVAILABLE' | 'MANUALLY_CANCELLED' | 'RESTORE_QUARANTINE' | null;
export type ExternalNotificationPreferences = {
  enabled: boolean; version: number; profileVersion: number | null; updatedAt: string | null;
  recipientVerified: boolean; availability: NotificationAvailability; provider: 'RESEND'; purpose: 'OPTIONAL_EVENT_REMINDERS'; suppression: NotificationSuppression | null;
};
export type ExternalNotificationPreferencesInput = { expectedVersion: number; expectedProfileVersion: number; enabled: boolean };
export type OwnedNotification = { id: string; purpose: NotificationPurpose; state: NotificationState; createdAt: string; updatedAt: string; nextAttemptAt: string | null; attempts: number; reason: NotificationReason; opportunityId: string | null; occurrenceId: string | null; providerAcceptedAt: string | null; cancellationMayBeInFlight: boolean; receipt: NotificationReceipt | null };
export type NotificationExport = { preferences: Pick<ExternalNotificationPreferences, 'enabled' | 'version' | 'profileVersion' | 'updatedAt'>; outbox: OwnedNotification[]; suppression: NotificationSuppression | null; retainedReceiptCorrelations: { count: number; latestExpiresAt: string | null } };
export type NotificationOperatorSummary = {
  generatedAt: string; provider: 'RESEND'; deliveryEnabled: boolean; configured: boolean; workerRequired: true;
  counts: Record<NotificationState, number>; byPurpose: { purpose: NotificationPurpose; counts: Record<NotificationState, number> }[];
  deadLetters: { id: string; purpose: NotificationPurpose; reason: NotificationReason; attempts: number; updatedAt: string }[];
  pendingRequests: { id: string; purpose: NotificationPurpose; state: NotificationState; reason: NotificationReason; attempts: number; updatedAt: string }[];
  receiptCounts: Record<NotificationReceiptStatus, number>; recentReceipts: { id: string; purpose: NotificationPurpose; receipt: NotificationReceipt }[]; suppressedAccounts: number; webhookConfigured: boolean;
  includesRecipients: false; includesMessageBodies: false; acceptedIsDeliveryConfirmation: false;
};
export type NotificationAdminAction = { action: 'CANCEL'; expectedUpdatedAt: string };
