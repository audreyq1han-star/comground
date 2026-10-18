import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const root = fileURLToPath(new URL('../apps/public-site/out/', import.meta.url));
const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value]));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, headers).end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let path = resolve(root, `.${pathname}`);
    if (path !== resolve(root) && !path.startsWith(resolve(root) + sep)) { res.writeHead(404, headers).end(); return; }
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    const data = await readFile(path);
    res.writeHead(200, { ...headers, 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(resolve(root, '404.html')));
  }
}).listen(Number(process.env.PUBLIC_PREVIEW_PORT || 3120), '127.0.0.1', () => console.log('Public static preview is listening on loopback only.'));
