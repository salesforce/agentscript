/**
 * Build script for the AgentScript VS Code extension.
 *
 * Produces two bundles:
 * 1. dist/extension.js — The VS Code extension client (platform: node, external: vscode)
 * 2. dist/server.mjs   — The LSP server (bundles @agentscript/lsp-server)
 *
 * With --stage, assembles a staging/ directory ready for VSIX packaging.
 */

import * as esbuild from 'esbuild';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const stage = process.argv.includes('--stage');

/** Shared build options */
const shared = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
};

/** Extension client bundle */
const extensionBuild = {
  ...shared,
  entryPoints: [join(__dirname, 'src/extension.ts')],
  outfile: join(__dirname, 'dist/extension.js'),
  format: 'cjs',
  external: ['vscode'],
};

/** LSP server bundle. */
const serverBuild = {
  ...shared,
  entryPoints: [join(__dirname, '../lsp-server/src/index.ts')],
  outfile: join(__dirname, 'dist/server.mjs'),
  format: 'esm',
  banner: {
    js: `
      import { createRequire } from 'module';
      const require = createRequire(import.meta.url);
    `,
  },
  external: ['vscode', 'tree-sitter', '@agentscript/parser-tree-sitter'],
};

async function build() {
  if (watch) {
    const extCtx = await esbuild.context(extensionBuild);
    const srvCtx = await esbuild.context(serverBuild);
    await Promise.all([extCtx.watch(), srvCtx.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([
      esbuild.build(extensionBuild),
      esbuild.build(serverBuild),
    ]);
  }
}

/**
 * Assemble staging/ directory for VSIX packaging.
 * Copies build output, icons, supporting files, and a modified package.json.
 */
function stageForPackaging() {
  const stagingDir = join(__dirname, 'staging');
  const publishDir = join(__dirname, 'publish');

  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  mkdirSync(publishDir, { recursive: true });

  cpSync(join(__dirname, 'dist'), join(stagingDir, 'dist'), {
    recursive: true,
  });
  cpSync(join(__dirname, 'icons'), join(stagingDir, 'icons'), {
    recursive: true,
  });

  for (const file of [
    'LICENSE.txt',
    'CHANGELOG.md',
    'README.md',
    'language-configuration.json',
  ]) {
    copyFileSync(join(__dirname, file), join(stagingDir, file));
  }

  const pkg = JSON.parse(
    readFileSync(join(__dirname, 'package.json'), 'utf-8')
  );
  pkg.main = './dist/extension.js';
  pkg.name = 'agent-script-language-client';
  delete pkg.scripts;
  delete pkg.dependencies;
  delete pkg.devDependencies;
  writeFileSync(
    join(stagingDir, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n'
  );

  console.log('Staging directory assembled at staging/');
}

if (stage) {
  stageForPackaging();
} else {
  build().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
