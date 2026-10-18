import { commandArgs, productionConfig, readReadyDatabase, reportFailure } from '../deploy/lib.mjs';
import { withOperationLock } from '../deploy/locks.mjs';
try {
  const config = await productionConfig(); const args = commandArgs(['--once', '--confirm-delivery-approved']);
  if (!args['--once'] || !args['--confirm-delivery-approved']) throw new Error('A bounded worker run requires --once and explicit --confirm-delivery-approved.');
  if (!config.notification.enabled) throw new Error('Live email delivery is disabled. No worker was started.');
  await withOperationLock(config, 'notification-worker', async () => {
    const check = readReadyDatabase(config); check.close();
    const { enqueueDueEventNotifications, dispatchNotificationOnce } = await import('../apps/web/lib/notification-runtime.ts');
    const queued = enqueueDueEventNotifications();
    const result = await dispatchNotificationOnce();
    console.log(JSON.stringify({ ok: true, ...queued, ...result, providerAcceptanceIsNotDeliveryConfirmation: true }));
  });
} catch (error) { reportFailure(error); }
