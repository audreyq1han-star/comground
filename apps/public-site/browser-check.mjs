import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const base = process.env.PUBLIC_PREVIEW_URL || 'http://127.0.0.1:3120';
const output = process.env.PUBLIC_PREVIEW_OUTPUT || fileURLToPath(new URL('./output/browser/', import.meta.url));
for (const [name, script] of [['routes', 'review-route-templates.mjs'], ['journey', 'review-journey.mjs']]) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(`./browser/${script}`, import.meta.url))], {
    stdio: 'inherit',
    env: { ...process.env, PUBLIC_PREVIEW_URL: base, PUBLIC_PREVIEW_OUTPUT: resolve(output, name) },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
