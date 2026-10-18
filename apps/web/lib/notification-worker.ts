import type { NotificationDelivery } from './notification-delivery.ts';
import type { NotificationStore } from './notification-repository.ts';

/** One bounded job; callers supply scheduling and an actual configured delivery adapter. */
export async function runNotificationWorkerOnce(store: NotificationStore, delivery: NotificationDelivery, now: () => Date = () => new Date()): Promise<{ claimed: boolean; dispatched: boolean }> {
  const lease = store.claim(now());
  if (!lease) return { claimed: false, dispatched: false };
  const prepared = store.prepare(lease, now());
  if (!prepared) return { claimed: true, dispatched: false };
  try { store.settle(lease, await delivery(prepared.message, prepared.idempotencyKey), now()); }
  catch { store.settle(lease, { kind: 'RETRY', reason: 'DELIVERY_UNCERTAIN' }, now()); }
  return { claimed: true, dispatched: true };
}
