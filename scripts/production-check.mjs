import { request } from 'node:http';
import { dirname } from 'node:path';
import { buildId, commandArgs, privateDirectory, productionConfig, readReadyDatabase, reportFailure, SCHEMA_REVISION } from '../deploy/lib.mjs';
import { assertNoMaintenance } from '../deploy/locks.mjs';

async function checkLocalHttp(config) {
  const port = Number(process.env.PORT || '3100');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  // Always loopback: this is never a request to COMGROUND_ORIGIN or a provider.
  await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/api/health', method: 'GET', headers: { Host: new URL(config.origin).host }, timeout: 5000 }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(new Error('Local health response exceeded its bound.')); });
      response.on('end', () => {
        try { if (response.statusCode !== 200 || JSON.parse(body).ready !== true) throw new Error('Local HTTP readiness failed.'); resolve(); }
        catch { reject(new Error('Local HTTP readiness failed.')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Local HTTP readiness timed out.'))); req.on('error', reject); req.end();
  });
}

try {
  const config = await productionConfig();
  const args = commandArgs(['--configuration-only', '--http']);
  if (args['--configuration-only'] && args['--http']) throw new Error('Choose configuration-only or full HTTP readiness.');
  privateDirectory(dirname(config.dbPath));
  if (!args['--configuration-only']) {
    assertNoMaintenance(config);
    const db = readReadyDatabase(config); db.close();
    if (!buildId()) throw new Error('The production build is missing. Build the image before starting it.');
    if (args['--http']) await checkLocalHttp(config);
    assertNoMaintenance(config);
  }
  console.log(JSON.stringify({ ok: true, check: args['--configuration-only'] ? 'configuration-and-storage-only' : args['--http'] ? 'database-build-and-local-http' : 'database-and-build', mode: config.mode, origin: config.origin, schemaRevision: SCHEMA_REVISION, emailEnabled: config.notification.enabled, aiEnabled: config.ai.enabled, externalServicesContacted: false }));
} catch (error) { reportFailure(error); }
