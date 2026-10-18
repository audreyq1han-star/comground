import { readFileSync, statSync } from 'node:fs';
import { reconcileRestoredData } from '../deploy/reconcile.mjs';
import { commandArgs, privateFile, productionConfig, reportFailure } from '../deploy/lib.mjs';
import { withOperationLock } from '../deploy/locks.mjs';
try {
  const config = await productionConfig();
  const args = commandArgs(['--confirm-service-stopped', '--confirm-policy-approved', '--register', '--reference', '--unverified-days', '--security-event-days']);
  if (!args['--confirm-service-stopped'] || !args['--confirm-policy-approved'] || !args['--register'] || !args['--reference'] || !args['--unverified-days'] || !args['--security-event-days']) throw new Error('Confirm stopped service and approved retention policy; supply the private deletion register, review reference and explicit retention periods.');
  privateFile(args['--register']);
  if (statSync(args['--register']).size > 1_048_576) throw new Error('Deletion register export exceeds its 1 MiB bound.');
  const register = JSON.parse(readFileSync(args['--register'], 'utf8'));
  await withOperationLock(config, 'restore-reconciliation', () => reconcileRestoredData(config, register, args['--reference'], { unverifiedDays: Number(args['--unverified-days']), securityEventDays: Number(args['--security-event-days']) }), { stopped: true });
  console.log(JSON.stringify({ ok: true, dataReconciled: true, stillQuarantined: true, externalServicesContacted: false }));
} catch (error) { reportFailure(error); }
