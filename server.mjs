/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
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
  const filePath = join(STATIC_DIR, pathname);

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
    const docs404 = join(STATIC_DIR, 'docs', '404.html');
    if (await exists(docs404)) {
      const data = await readFile(docs404, 'utf-8');
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
      return;
    }
  }

  // SPA fallback for UI routes
  await serveFile(res, join(STATIC_DIR, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`  http://localhost:${PORT}/`);
});
