/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const PORT = process.env.PORT || 8080;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

// Single merged directory: UI dist + docs copied into dist/docs/
const STATIC_DIR = join(__dirname, 'apps', 'ui', 'dist');
const STATIC_ROOT = resolve(STATIC_DIR);

// Boundary check used to mitigate CWE-22 path traversal.
// The WHATWG URL parser does not normalize `..` segments when the slash is
// percent-encoded (e.g. `..%2f..%2f` or `%2e%2e%2f`), so once we run the
// pathname through decodeURIComponent the `..` segments can survive. We
// must therefore re-resolve the joined path and confirm it is still
// confined to STATIC_ROOT before touching the filesystem.
function isInsideStaticRoot(absPath) {
  return absPath === STATIC_ROOT || absPath.startsWith(STATIC_ROOT + sep);
}

async function serveFile(res, filePath) {
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const isHashed = /\.[a-f0-9]{8,}\.\w+$/.test(filePath);
    const cacheControl = isHashed
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=60';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

async function exists(filePath) {
  try {
    const s = await stat(filePath);
    return s.isFile();
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  // Defense in depth: refuse decoded paths containing NUL bytes or
  // backslashes. These never appear in legitimate static asset URLs and
  // are common ingredients in path-confusion attacks.
  if (pathname.includes('\0') || pathname.includes('\\')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  // Resolve to an absolute, normalized path and confine to STATIC_ROOT.
  const filePath = resolve(STATIC_ROOT, '.' + pathname);
  if (!isInsideStaticRoot(filePath)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  // Try exact file
  if (await exists(filePath)) {
    await serveFile(res, filePath);
    return;
  }

  // Try directory/index.html (Docusaurus pages under /docs/)
  const indexPath = join(filePath, 'index.html');
  if (await exists(indexPath)) {
    await serveFile(res, indexPath);
    return;
  }

  // For /docs/* paths, serve the docs 404 page
  if (pathname.startsWith('/docs')) {
    const docs404 = join(STATIC_ROOT, 'docs', '404.html');
    if (await exists(docs404)) {
      const data = await readFile(docs404, 'utf-8');
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
      return;
    }
  }

  // SPA fallback for UI routes
  await serveFile(res, join(STATIC_ROOT, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`  http://localhost:${PORT}/`);
});
