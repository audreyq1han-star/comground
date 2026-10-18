import { backupDatabase } from '../deploy/backups.mjs';
import { commandArgs, productionConfig, reportFailure } from '../deploy/lib.mjs';
import { withOperationLock } from '../deploy/locks.mjs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
try {
  const config = await productionConfig(); const args = commandArgs(['--output', '--scheduled']);
  if (!!args['--output'] === !!args['--scheduled']) throw new Error('Choose --output with a new absolute backup directory, or --scheduled for a unique bundle under /backups.');
  const output = args['--scheduled'] ? join('/backups', `backup-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`) : args['--output'];
  const manifest = await withOperationLock(config, 'backup', () => backupDatabase(config, output));
  console.log(JSON.stringify({ ok: true, encrypted: true, output, schemaRevision: manifest.schemaRevision, externalServicesContacted: false }));
} catch (error) { reportFailure(error); }
