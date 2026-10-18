import { releaseRestoredDatabase } from '../deploy/reconcile.mjs';
import { commandArgs, productionConfig, reportFailure } from '../deploy/lib.mjs';
import { withOperationLock } from '../deploy/locks.mjs';
try {
  const config = await productionConfig();
  const args = commandArgs(['--confirm-service-stopped', '--confirm-deletions-reconciled', '--confirm-retention-reconciled', '--reference']);
  if (!args['--confirm-service-stopped'] || !args['--confirm-deletions-reconciled'] || !args['--confirm-retention-reconciled'] || !args['--reference']) throw new Error('Keep traffic/workers stopped and explicitly confirm deletion-register and retention reconciliation with a reference.');
  await withOperationLock(config, 'restore-release', () => releaseRestoredDatabase(config, args['--reference']), { stopped: true });
  console.log(JSON.stringify({ ok: true, quarantineReleased: true, sessionsRevoked: true, actionTokensRevoked: true, unsentNotificationsCancelled: true, externalServicesContacted: false }));
} catch (error) { reportFailure(error); }
