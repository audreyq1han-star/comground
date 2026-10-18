import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

// The portable runtime is a local setup artifact, never downloaded on launch.
// Keep the Mac's global / agent Node installation untouched.
const portable = fileURLToPath(new URL(`../.tools/node-v22.23.3-${process.platform}-${process.arch}/bin/node`, import.meta.url));
const executable = existsSync(portable) ? portable : process.execPath;
const version = execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim();
const [major, minor, patch] = version.replace(/^v/, '').split('.').map(Number);
if (major !== 22 || minor < 23 || (minor === 23 && patch < 3)) {
  console.error('Use the reviewed Node 22.23.3 runtime or a later 22.x release. See LOCAL_README.md. No runtime is downloaded automatically.');
  process.exit(1);
}
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(`CommonGround runtime: ${version} (${executable})`);
} else {
  const child = spawn(executable, args, { stdio: 'inherit', env: process.env });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error.message); process.exit(1); });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
