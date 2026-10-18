import { getRuntimeConfig } from '../apps/web/lib/runtime-config.ts';
import { dispatchNotificationOnce, enqueueDueEventNotifications, maintainNotifications } from '../apps/web/lib/notification-runtime.ts';
import { productionConfig, readReadyDatabase } from '../deploy/lib.mjs';
import { withOperationLock } from '../deploy/locks.mjs';

// Explicit, bounded invocation. Scheduling and provider activation are owner actions.
const args = process.argv.slice(2);
if (args.length !== 1 || !['--enqueue-only', '--dispatch-once', '--maintenance'].includes(args[0])) {
  console.error('Use --maintenance for expiry/retention, --enqueue-only to queue due opted-in reminders, or --dispatch-once after explicitly enabling configured production delivery.');
  process.exitCode = 2;
} else {
  try {
    const config = getRuntimeConfig();
    if (args[0] === '--dispatch-once' && (config.mode !== 'production' || !config.notification.enabled)) throw new Error('Notification dispatch is disabled.');
    const run = () => args[0] === '--maintenance' ? maintainNotifications() : args[0] === '--enqueue-only' ? enqueueDueEventNotifications() : dispatchNotificationOnce();
    const result = config.mode === 'production' ? await withOperationLock(await productionConfig(), 'notification-cli', async () => {
      const check = readReadyDatabase(config); check.close();
      return await run();
    }) : await run();
    console.log(JSON.stringify(result));
  } catch { console.error('The notification worker could not complete. Check configuration and the operator notification summary.'); process.exitCode = 1; }
}
