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
    if (name.endsWith('.html') && /<form(?:\s|>)/i.test(text)) throw new Error(`Application form in public export: ${name}`);
    if (/COMGROUND_(?:OPERATOR|DEMO|OUTBOX|BACKUP|DB_PATH)|OPENAI_API_KEY|RESEND_API_KEY|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b|\/Users\/[a-z][^/]*\//i.test(text)) {
      throw new Error(`Private configuration or machine path in public export: ${name}`);
    }
  }
}
if (!files.includes(join(root, 'index.html')) || !files.includes(join(root, '404.html'))) throw new Error('Incomplete static export');
console.log(`Public export audited: ${files.length} static files; no account, admin, API, database, source-map or recognized credential artifacts. Pattern scan is bounded, not a general secret guarantee.`);
