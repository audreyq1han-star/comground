import { readdir, readFile, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../apps/public-site/out/', import.meta.url));
const files = [];
async function walk(directory) {
  for (const name of await readdir(directory)) {
    const path = join(directory, name), stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error('Static export must not contain symbolic links');
    if (stat.isDirectory()) await walk(path);
    else files.push(path);
  }
}
await walk(root);
const forbidden = /(?:^|\/)(?:api|admin|account|\.env[^/]*|\.data|node_modules)(?:\/|$)|\.(?:sqlite|db|pem|key|map)$/i;
for (const path of files) {
  const name = relative(root, path);
  if (forbidden.test(name)) throw new Error(`Private or server artifact in public export: ${name}`);
  if (/\.(?:html|txt|js|json|css)$/.test(name)) {
    const text = await readFile(path, 'utf8');
    if (/COMGROUND_(?:OPERATOR|DEMO|OUTBOX|BACKUP|DB_PATH)|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|\/Users\/[a-z][^/]*\//i.test(text)) {
      throw new Error(`Private configuration or machine path in public export: ${name}`);
    }
  }
}
if (!files.includes(join(root, 'index.html')) || !files.includes(join(root, '404.html'))) throw new Error('Incomplete static export');
console.log(`Public export audited: ${files.length} static files; no account, admin, API, database, credential or source-map artifacts.`);
