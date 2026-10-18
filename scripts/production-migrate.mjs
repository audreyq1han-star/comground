import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { backupDatabase } from '../deploy/backups.mjs';
import { commandArgs, privateDirectory, productionConfig, readReadyDatabase, reportFailure, SCHEMA_REVISION } from '../deploy/lib.mjs';
import { initializeProductionSchema } from '../deploy/schema.mjs';
import { withOperationLock } from '../deploy/locks.mjs';
try {
  const config = await productionConfig(); const args = commandArgs(['--confirm-service-stopped', '--backup']);
  if (!args['--confirm-service-stopped']) throw new Error('Stop the service and workers, then pass --confirm-service-stopped.');
  privateDirectory(dirname(config.dbPath), true);
  await withOperationLock(config, 'migration', async () => {
    if (existsSync(config.dbPath)) {
      if (!args['--backup']) throw new Error('Existing databases require --backup with a new encrypted backup directory before migration.');
      await backupDatabase(config, args['--backup'], { allowUnprepared: true });
    }
    await initializeProductionSchema(config);
    const db = readReadyDatabase(config, { full: true }); db.close();
    console.log(JSON.stringify({ ok: true, schemaRevision: SCHEMA_REVISION, createdAccounts: 0, seededFixtures: 0, externalServicesContacted: false }));
  }, { stopped: true });
} catch (error) { reportFailure(error); }
