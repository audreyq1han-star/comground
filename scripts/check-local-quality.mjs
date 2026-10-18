import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireSupportedNode } from '../deploy/lib.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('quality:local [--browser]: diff, type, unit, production build, synthetic HTTP, local performance; optional browser acceptance requires an existing Playwright module/browser. No installation.');
  process.exit(0);
}
if (args.some(value => value !== '--browser') || args.length > 1) throw new Error('Use quality:local with optional --browser only.');
const root = fileURLToPath(new URL('..', import.meta.url));
requireSupportedNode();
const tests = ['packages/domain', 'apps/web/lib', 'tests'].flatMap(directory => readdirSync(join(root, directory)).filter(name => name.endsWith('.test.ts')).sort().map(name => `${directory}/${name}`));
const steps = [
  ['Working-tree whitespace', 'git', ['diff', '--check'], 30000],
  ['Type checking', process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], 120000],
  ['Unit and contract tests', process.execPath, ['--experimental-strip-types', '--test', ...tests], 180000],
  ['Production build', process.execPath, ['node_modules/next/dist/bin/next', 'build', 'apps/web', '--webpack'], 300000],
  ['Synthetic HTTP acceptance', process.execPath, ['--experimental-strip-types', 'scripts/test-production-http.mjs'], 180000],
  ['Local performance budget', process.execPath, ['--experimental-strip-types', 'scripts/test-local-performance.mjs'], 180000],
];
if (args.includes('--browser')) steps.push(['Browser acceptance', process.execPath, ['--experimental-strip-types', 'scripts/test-production-browser.mjs'], 240000]);
for (const [label, command, argv, timeout] of steps) {
  console.log(`\n${label}`);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(command, argv, { cwd: root, stdio: 'inherit', detached: process.platform !== 'win32', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
    const terminate = signal => { try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
    let interrupted = false;
    const onInterrupt = () => { interrupted = true; terminate('SIGINT'); }, onTerminate = () => { interrupted = true; terminate('SIGTERM'); };
    process.on('SIGINT', onInterrupt); process.on('SIGTERM', onTerminate);
    let forceTimer;
    const timer = setTimeout(() => { interrupted = true; terminate('SIGTERM'); forceTimer = setTimeout(() => terminate('SIGKILL'), 10000); }, timeout);
    child.on('error', error => { clearTimeout(timer); clearTimeout(forceTimer); process.off('SIGINT', onInterrupt); process.off('SIGTERM', onTerminate); reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timer); clearTimeout(forceTimer); process.off('SIGINT', onInterrupt); process.off('SIGTERM', onTerminate); resolve(interrupted ? 1 : code ?? (signal ? 1 : 0)); });
  });
  if (result !== 0) { console.error(`${label} failed; later checks were not run.`); process.exitCode = 1; break; }
}
