import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { platform, arch, cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { createProductionHarness } from './test-production-http.mjs';

// Small regression budget, deliberately neither a load test nor a capacity claim.
const routes = ['/', '/opportunities', '/account/login', '/account/signup', '/api/runtime', '/api/opportunities'];
const budgets = { warmP95Ms: 2000, htmlBytes: 300 * 1024, apiBytes: 256 * 1024, samplesPerRoute: 5, warmupsPerRoute: 1, totalDeadlineMs: 120000 };
if (process.argv.length !== 2) throw new Error('Run test:performance without arguments after a production build.');
const buildId = (await readFile('apps/web/.next/BUILD_ID', 'utf8')).trim();
const git = args => { const value = spawnSync('git', args, { encoding: 'utf8', timeout: 5000 }); return value.status === 0 ? value.stdout.trim() : null; };
const report = {
  format: 'comground-local-performance-v1', measuredAt: new Date().toISOString(), status: 'RUNNING',
  scope: 'Sequential loopback HTTP on a disposable empty production-mode database, with delivery and AI disabled',
  machine: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown', node: process.version },
  buildId, commit: git(['rev-parse', 'HEAD']), workingTreeDirty: git(['status', '--porcelain']) !== '',
  budgets, routes: [], failures: [],
  limits: ['Local machine timing only; this is not public TLS, nginx, browser rendering, Web Vitals, load, production capacity or populated-data evidence.', 'Five warm samples use nearest-rank p95 (the slowest sample); startup and the first request to each route are excluded.', 'Byte counts are uncompressed response bodies, excluding headers and browser assets. No external provider is enabled.'],
};
const h = await createProductionHarness(3118), deadline = Date.now() + budgets.totalDeadlineMs;
function probe(path) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Total local performance deadline exceeded.');
  const api = path.startsWith('/api/'), maxBytes = api ? budgets.apiBytes : budgets.htmlBytes;
  return new Promise((resolve, reject) => {
    const started = performance.now(); let bytes = 0;
    const req = request(h.base + path, { headers: { host: 'acceptance.example.invalid', 'accept-encoding': 'identity' }, agent: false }, response => {
      response.on('error', reject);
      response.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) req.destroy(new Error(`${path} exceeded its response-byte budget.`)); });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`${path} returned HTTP ${response.statusCode}.`));
        const type = response.headers['content-type'] ?? '';
        if (!(api ? type.includes('application/json') : type.includes('text/html'))) return reject(new Error(`${path} returned an unexpected content type.`));
        resolve({ elapsedMs: Number((performance.now() - started).toFixed(3)), bytes });
      });
    });
    // Wall-clock timeout, including a body that keeps delivering tiny chunks.
    const timer = setTimeout(() => req.destroy(new Error(`${path} exceeded its request deadline.`)), Math.min(10000, remaining));
    req.once('close', () => clearTimeout(timer)); req.once('error', reject); req.end();
  });
}
try {
  await h.start('production');
  const runtime = await h.request('/api/runtime');
  assert.equal(runtime.status, 200); assert.equal(runtime.data.mode, 'production');
  assert.equal(runtime.data.capabilities.emailDelivery, false); assert.equal(runtime.data.capabilities.aiExplanations, false);
  assert.equal(runtime.data.capabilities.realFeeds, false);
  for (const path of routes) {
    await probe(path);
    const samples = [];
    for (let index = 0; index < budgets.samplesPerRoute; index++) samples.push(await probe(path));
    const p95Ms = [...samples].map(sample => sample.elapsedMs).sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1];
    const maxBytes = Math.max(...samples.map(sample => sample.bytes));
    report.routes.push({ path, samples, p95Ms, maxBytes });
    if (p95Ms > budgets.warmP95Ms) report.failures.push(`${path} exceeded the warm p95 budget.`);
  }
  report.status = report.failures.length ? 'FAILED' : 'PASSED';
} catch (error) {
  report.status = 'FAILED';
  // Probe errors contain fixed paths only. Avoid exposing server logs/configuration.
  report.failures.push(error instanceof Error && /^(\/|Total local performance)/.test(error.message) ? error.message : 'Harness startup or disabled-provider assertion failed.');
} finally {
  await h.cleanup();
  await mkdir('docs/evidence', { recursive: true });
  await writeFile('docs/evidence/local-performance.json', JSON.stringify(report, null, 2) + '\n');
}
console.log(`${report.status}: ${report.routes.length}/${routes.length} routes measured; see docs/evidence/local-performance.json.`);
if (report.status !== 'PASSED') process.exitCode = 1;
