/**
 * A small static server for trying the app on this computer: `npm run serve` (http://127.0.0.1:8080). With `--lan`
 * it also listens on the local network so a phone on the same Wi-Fi can open it; without HTTPS the phone can't
 * install it or use it offline, so that is only for a quick look — GitHub Pages is the real home.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function startServer({ port = 8080, host = '127.0.0.1' } = {}) {
  const server = createServer(async (request, response) => {
    try {
      let path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = resolve(ROOT, `.${normalize(path)}`);
      // Only files inside the app folder, and nothing hidden (such as .git).
      if (!file.startsWith(ROOT) || file.slice(ROOT.length).split(sep).some((part) => part.startsWith('.'))) throw new Error('outside');
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      response.end(body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
  return new Promise((done) => server.listen(port, host, () => done(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lan = process.argv.includes('--lan');
  const portArg = process.argv.indexOf('--port');
  const port = portArg > -1 ? Number(process.argv[portArg + 1]) : 8080;
  await startServer({ port, host: lan ? '0.0.0.0' : '127.0.0.1' });
  process.stdout.write(`Questline Pocket: http://127.0.0.1:${port}/\n`);
  if (lan) {
    for (const address of Object.values(networkInterfaces()).flat()) {
      if (address && address.family === 'IPv4' && !address.internal) process.stdout.write(`On your phone (same Wi-Fi): http://${address.address}:${port}/\n`);
    }
  }
}
