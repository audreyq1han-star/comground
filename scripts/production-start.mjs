import { spawn } from 'node:child_process';
import { buildId, commandArgs, productionConfig, readReadyDatabase, reportFailure } from '../deploy/lib.mjs';
import { acquireServiceLease, withOperationLock } from '../deploy/locks.mjs';

let child, releaseService;
try {
  const config = await productionConfig(); commandArgs([]);
  await withOperationLock(config, 'startup', () => {
    const db = readReadyDatabase(config); db.close();
    if (!buildId()) throw new Error('A production build is required before startup.');
    const port = Number(process.env.PORT || '3100');
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
    releaseService = acquireServiceLease(config);
    child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', 'apps/web', '--hostname', '0.0.0.0', '--port', String(port)], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' } });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
    child.on('error', reportFailure);
    child.on('close', (code, signal) => {
      process.exitCode = code ?? (signal ? 1 : 0);
      try { releaseService(); } catch (error) { reportFailure(error); }
    });
  });
} catch (error) {
  if (child) child.kill('SIGTERM');
  else if (releaseService) { try { releaseService(); } catch (cleanupError) { reportFailure(cleanupError); } }
  reportFailure(error);
}
