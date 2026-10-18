import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
test('online preview deploys only static public output with restrictive browser boundaries', () => {
  const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
  assert.equal(config.framework, null);
  assert.equal(config.buildCommand, 'npm run build:public');
  assert.equal(config.outputDirectory, 'apps/public-site/out');
  assert.match(config.installCommand, /--ignore-scripts/);
  assert.equal(config.functions, undefined);
  assert.equal(config.crons, undefined);
  assert.equal(config.rewrites, undefined);
  const headers = Object.fromEntries(config.headers[0].headers.map((h: { key: string; value: string }) => [h.key, h.value]));
  assert.equal(headers['X-Robots-Tag'], 'noindex, nofollow');
  assert.match(headers['Content-Security-Policy'], /form-action 'none'/);
  assert.match(headers['Content-Security-Policy'], /connect-src 'self'/);
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  const next = readFileSync(join(root, 'apps/public-site/next.config.mjs'), 'utf8');
  assert.match(next, /output: 'export'/);
  assert.doesNotMatch(next, /async headers/);
});

test('public source has no server routes, storage or account-provider imports', () => {
  const source = join(root, 'apps/public-site');
  function visit(directory: string) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (['.next', 'out', 'output', 'node_modules'].includes(item.name)) continue;
      const path = join(directory, item.name);
      if (item.isDirectory()) { assert.ok(!['api', 'admin', 'account'].includes(item.name), path); visit(path); }
      else if (/\.(tsx|ts)$/.test(item.name) && !item.name.endsWith('.test.ts')) {
        const text = readFileSync(path, 'utf8');
        assert.notEqual(item.name, 'route.ts');
        assert.doesNotMatch(text, /(?:localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.sendBeacon|\/api\/|from ['"][^'"]*(?:apps\/web|student-runtime|account-runtime))/);
      }
    }
  }
  visit(source);
});
