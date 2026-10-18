import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { StudentProfile } from '../../../packages/domain/app-contracts.ts';
import { evaluateEligibility, occurrenceList } from '../../../packages/domain/rules.ts';
import { canDispatchAccountNotification } from './account-repository.ts';
import { bindDatabaseMode } from './database-mode.ts';
import { RepositoryError } from './errors.ts';
import { createResendDelivery, type NotificationConfiguration } from './notification-delivery.ts';
import { createNotificationStore, enqueueIdentityNotification, type IdentityNotification, type NotificationOccurrence, type NotificationStore } from './notification-repository.ts';
import { getRuntimeConfig } from './runtime-config.ts';
import { repository } from './runtime.ts';
import { runNotificationWorkerOnce } from './notification-worker.ts';
import { notificationInterestActive, scanNotificationCandidates } from './notification-scanner.ts';
import { distribution } from './distribution-runtime.ts';

export function notificationConfiguration(): NotificationConfiguration {
  const config = getRuntimeConfig();
  return { mode: config.mode, deliveryEnabled: config.notification.enabled, origin: config.origin, encryptionKey: config.notification.outboxKey, apiKey: config.notification.key, from: config.notification.from, webhookKey: config.notification.webhookKey };
}
/** Called by the identity store inside its account/token transaction. */
export function enqueueAccountNotification(db: DatabaseSync, message: IdentityNotification): void { enqueueIdentityNotification(db, message, notificationConfiguration()); }

const retained = globalThis as typeof globalThis & { comgroundNotifications?: { path: string; db: DatabaseSync; store: NotificationStore } };
function currentOccurrence(db: DatabaseSync, owner: string, reference: NotificationOccurrence, now: Date): boolean {
  if (!notificationInterestActive(db, owner, reference)) return false;
  const row = db.prepare('SELECT profile_json FROM student_profiles WHERE persona_id=?').get(owner) as { profile_json: string } | undefined;
  if (!row) return false;
  const profile = JSON.parse(row.profile_json) as StudentProfile;
  const opportunity = repository().getPublic(reference.opportunityId, now, reference.occurrenceId);
  if (!opportunity || opportunity.version !== reference.opportunityVersion || getRuntimeConfig().mode === 'production' && opportunity.isSynthetic) return false;
  const occurrence = occurrenceList(opportunity).find(item => item.id === reference.occurrenceId);
  if (!occurrence || occurrence.startsAt !== reference.startsAt) return false;
  const selected = { ...opportunity, occurrenceId: occurrence.id, startsAt: occurrence.startsAt, endsAt: occurrence.endsAt, validUntil: occurrence.validUntil, timezone: occurrence.timezone };
  return evaluateEligibility(selected, profile.preferences, now).status === 'ELIGIBLE';
}
export function notifications(): NotificationStore {
  const config = getRuntimeConfig();
  if (retained.comgroundNotifications && retained.comgroundNotifications.path !== config.dbPath) throw new RepositoryError('NOTIFICATION_CONFIGURATION_CHANGED', 503, 'Restart after changing notification storage configuration.');
  if (!retained.comgroundNotifications) {
    // Initialize private tables before a worker owns the outbox write transaction.
    // The digest predicate must remain read-only when called inside prepare().
    distribution();
    mkdirSync(dirname(config.dbPath), { recursive: true }); bindDatabaseMode(config.dbPath, config.mode);
    const db = new DatabaseSync(config.dbPath); db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    try { retained.comgroundNotifications = { path: config.dbPath, db, store: createNotificationStore(db, { config: notificationConfiguration, occurrenceAvailable: (owner, reference, now) => currentOccurrence(db, owner, reference, now), digestCurrent: (owner, reference, now) => distribution().dispatchCurrent(owner, reference, now), accountTokenAvailable: (message, now) => canDispatchAccountNotification(db, message, now) }) }; }
    catch (error) { db.close(); throw error; }
  }
  return retained.comgroundNotifications.store;
}
/** Bounded scan of explicitly enabled owners; no external delivery is performed here. */
export function enqueueDueEventNotifications(now = new Date()): { examined: number; queued: number } {
  const store = notifications(), db = retained.comgroundNotifications!.db;
  if (getRuntimeConfig().mode === 'demo') return { examined: 0, queued: 0 };
  return scanNotificationCandidates(db, candidate => {
    const current = repository().getPublic(candidate.opportunity_id, now, candidate.occurrence_id), date = current ? occurrenceList(current).find(item => item.id === candidate.occurrence_id) : null;
    if (!current || !date || Date.parse(date.startsAt) <= now.getTime() || Date.parse(date.startsAt) > now.getTime() + 86400000) return null;
    const reference = { opportunityId: current.id, occurrenceId: date.id, opportunityVersion: current.version, startsAt: date.startsAt };
    return currentOccurrence(db, candidate.owner, reference, now) ? reference : null;
  }, (owner, occurrence) => store.enqueueReminderWithResult(owner, occurrence, now));
}
export async function dispatchNotificationOnce(): Promise<{ claimed: boolean; dispatched: boolean }> {
  const store = notifications(); store.prune();
  return runNotificationWorkerOnce(store, createResendDelivery(notificationConfiguration));
}
export function maintainNotifications(): { maintained: true } { notifications().prune(); return { maintained: true }; }
