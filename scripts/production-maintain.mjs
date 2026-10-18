import { maintainProductionData } from '../deploy/maintenance.mjs';
import { commandArgs, productionConfig, reportFailure } from '../deploy/lib.mjs';
import { withOperationLock } from '../deploy/locks.mjs';
try {
  const config = await productionConfig();
  const args = commandArgs(['--confirm-policy-approved', '--unverified-days', '--security-event-days']);
  if (!args['--confirm-policy-approved'] || !args['--unverified-days'] || !args['--security-event-days']) throw new Error('Supply explicit approved account retention periods and --confirm-policy-approved.');
  await withOperationLock(config, 'retention', () => maintainProductionData(config, { unverifiedDays: Number(args['--unverified-days']), securityEventDays: Number(args['--security-event-days']) }));
  console.log(JSON.stringify({ ok: true, maintained: true, externalServicesContacted: false }));
} catch (error) { reportFailure(error); }
