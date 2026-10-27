import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlanEndpointHandler } from './server/aiPlanner.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const planHandler = createPlanEndpointHandler();

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/api/generate-plan') {
    await planHandler(request, response);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(dist, `.${requestedPath}`);
  if (!filePath.startsWith(`${dist}${path.sep}`)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const fileStat = await stat(filePath);
    const resolvedPath = fileStat.isDirectory()
      ? path.join(filePath, 'index.html')
      : filePath;
    const contents = await readFile(resolvedPath);
    response.writeHead(200, {
      'Content-Type':
        mimeTypes[path.extname(resolvedPath)] ?? 'application/octet-stream',
      'Content-Length': contents.length,
    });
    response.end(request.method === 'HEAD' ? undefined : contents);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

const port = Number(process.env.PORT || 4173);
server.listen(port, '0.0.0.0', () => {
  console.log(`Animator server listening on http://localhost:${port}`);
});
