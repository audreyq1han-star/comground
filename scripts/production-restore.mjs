import { restoreBackup } from '../deploy/backups.mjs';
import { commandArgs, productionConfig, reportFailure } from '../deploy/lib.mjs';
import { withOperationLock } from '../deploy/locks.mjs';
try {
  const config = await productionConfig(); const args = commandArgs(['--backup', '--target']);
  if (!args['--backup'] || !args['--target']) throw new Error('Provide --backup and a new --target absolute path.');
  const result = await withOperationLock(config, 'restore', () => restoreBackup(config, args['--backup'], args['--target']));
  console.log(JSON.stringify({ ok: true, ...result, next: 'Keep traffic and workers stopped. Reapply post-backup deletions, reconcile retention, and use the explicit release-restore command.', externalServicesContacted: false }));
} catch (error) { reportFailure(error); }
