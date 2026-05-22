/*
 * Regression test for path traversal (CWE-22) in server.mjs.
 *
 * Boots the real server.mjs (so future regressions to that file are caught),
 * then issues a series of HTTP requests covering:
 *   - baseline (must be served)
 *   - traversal payloads with the WHATWG-bypassing encodings
 *     (..%2f..%2f..%2f and %2e%2e%2f%2e%2e%2f%2e%2e%2f)
 *   - negative controls that the URL parser already normalizes
 *
 * A traversal "passes" only if the server does NOT return the contents of a
 * file outside the static dir. Exit code 0 = mitigated, 1 = vulnerable.
 *
 * Run with: node scripts/test-path-traversal.mjs
 */

import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const STATIC_DIR = join(REPO_ROOT, 'apps', 'ui', 'dist');
const STUB_INDEX = join(STATIC_DIR, 'index.html');
const BACKUP_INDEX = join(STATIC_DIR, 'index.html.regression-backup');
const BASELINE_MARKER = 'AGENTSCRIPT-PATH-TRAVERSAL-BASELINE';
const PORT = 8765;
const HOST = '127.0.0.1';

// Hermetic setup: always run the test against a known stub index.html,
// regardless of whether a previous `pnpm build` has already populated
// apps/ui/dist/. The original index.html (if any) is moved aside and
// restored during teardown so we never destroy a developer's build.
const state = { createdDist: false, backedUpIndex: false, wroteStub: false };

async function setupStaticDir() {
  if (!existsSync(STATIC_DIR)) {
    await mkdir(STATIC_DIR, { recursive: true });
    state.createdDist = true;
  }
  if (existsSync(STUB_INDEX)) {
    await rename(STUB_INDEX, BACKUP_INDEX);
    state.backedUpIndex = true;
  }
  await writeFile(
    STUB_INDEX,
    `<!doctype html><html><body>${BASELINE_MARKER}</body></html>\n`
  );
  state.wroteStub = true;
}

async function teardownStaticDir() {
  if (state.wroteStub) {
    await rm(STUB_INDEX, { force: true });
  }
  if (state.backedUpIndex) {
    await rename(BACKUP_INDEX, STUB_INDEX);
  }
  if (state.createdDist) {
    await rm(STATIC_DIR, { recursive: true, force: true });
  }
}

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: HOST, port: PORT, path, method: 'GET' },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf-8'),
          })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function waitForServer(maxMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      await httpGet('/');
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(
    `server did not respond on ${HOST}:${PORT} within ${maxMs}ms`
  );
}

const cases = [
  {
    name: 'baseline: GET / serves static index.html',
    path: '/',
    mustContain: BASELINE_MARKER,
    kind: 'baseline',
  },
  {
    name: 'traversal: half-encoded (..%2f) -> package.json',
    path: '/..%2f..%2f..%2fpackage.json',
    mustNotContain: '"agentscript-monorepo"',
    kind: 'traversal',
  },
  {
    name: 'traversal: full-encoded (%2e%2e%2f) -> package.json',
    path: '/%2e%2e%2f%2e%2e%2f%2e%2e%2fpackage.json',
    mustNotContain: '"agentscript-monorepo"',
    kind: 'traversal',
  },
  {
    name: 'traversal: half-encoded -> Procfile',
    path: '/..%2f..%2f..%2fProcfile',
    mustNotContain: 'web: node server.mjs',
    kind: 'traversal',
  },
  {
    name: 'traversal: half-encoded -> LICENSE.txt',
    path: '/..%2f..%2f..%2fLICENSE.txt',
    mustNotContain: 'Apache License',
    kind: 'traversal',
  },
  {
    name: 'control: literal ../ (URL parser normalizes)',
    path: '/../../../package.json',
    mustNotContain: '"agentscript-monorepo"',
    kind: 'control',
  },
  {
    name: 'control: %2e%2e/ with literal slash (URL parser normalizes)',
    path: '/%2e%2e/%2e%2e/%2e%2e/package.json',
    mustNotContain: '"agentscript-monorepo"',
    kind: 'control',
  },
];

async function main() {
  await setupStaticDir();

  const server = spawn(process.execPath, [join(REPO_ROOT, 'server.mjs')], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverLog = '';
  server.stdout.on('data', c => {
    serverLog += c.toString();
  });
  server.stderr.on('data', c => {
    serverLog += c.toString();
  });

  const failures = [];

  try {
    await waitForServer();

    console.log('='.repeat(72));
    console.log('  Path traversal regression — server.mjs');
    console.log(`  Bound: http://${HOST}:${PORT}   STATIC_DIR=${STATIC_DIR}`);
    console.log('='.repeat(72));

    for (const c of cases) {
      const res = await httpGet(c.path);
      const ok = c.mustContain
        ? res.body.includes(c.mustContain)
        : !res.body.includes(c.mustNotContain);
      const tag = ok
        ? 'PASS'
        : c.kind === 'traversal'
          ? 'FAIL — VULNERABLE'
          : c.kind === 'baseline'
            ? 'FAIL — BASELINE BROKEN'
            : 'FAIL';
      console.log(`  [${tag.padEnd(20)}] ${c.name}`);
      console.log(
        `       GET ${c.path}  ->  ${res.status}, ${res.body.length} bytes`
      );
      if (!ok) {
        failures.push({
          name: c.name,
          path: c.path,
          status: res.status,
          preview: res.body.slice(0, 240).replace(/\s+/g, ' '),
        });
      }
    }

    console.log('='.repeat(72));
    if (failures.length === 0) {
      console.log('  RESULT: all checks passed — path traversal is mitigated.');
    } else {
      console.log(`  RESULT: ${failures.length} check(s) failed:`);
      for (const f of failures) {
        console.log(`    - ${f.name}`);
        console.log(`        ${f.path}  ->  HTTP ${f.status}`);
        console.log(`        body[0..240]: ${f.preview}`);
      }
    }
    console.log('='.repeat(72));
  } catch (err) {
    console.error('test runner error:', err);
    if (serverLog) {
      console.error('--- server output ---');
      console.error(serverLog);
    }
    failures.push({
      name: 'runner',
      path: '-',
      status: 0,
      preview: String(err),
    });
  } finally {
    server.kill('SIGTERM');
    await new Promise(resolve => {
      server.once('exit', resolve);
      setTimeout(resolve, 1000).unref?.();
    });
    await teardownStaticDir();
  }

  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('fatal:', err);
  process.exit(2);
});
