#!/usr/bin/env node

/**
 * Post-install script to set up tree-sitter CLI
 *
 * The tree-sitter-cli npm package doesn't ship pre-built binaries for all architectures
 * (especially ARM64 Linux). This script creates a symlink from the npm package directory
 * to the system-installed tree-sitter binary (installed via cargo in the Dockerfile).
 *
 * This allows us to:
 * 1. Keep tree-sitter-cli version tracked in package.json
 * 2. Use the system binary that works on all architectures
 * 3. Have builds work automatically after pnpm install
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Find the tree-sitter-cli package directory
const cliPackageUrl = import.meta.resolve('tree-sitter-cli/package.json');
const cliPackagePath = path.dirname(fileURLToPath(cliPackageUrl));
const binaryPath = path.join(cliPackagePath, 'tree-sitter');

// Check if binary already exists (e.g., on x86_64 where npm package works)
if (fs.existsSync(binaryPath)) {
  console.log('tree-sitter binary already exists');
  process.exit(0);
}

// Try to find system tree-sitter
// Common locations where tree-sitter might be installed
const possibleLocations = [
  '/root/.cargo/bin/tree-sitter',
  '/usr/local/bin/tree-sitter',
  '/usr/bin/tree-sitter',
  process.env.HOME && path.join(process.env.HOME, '.cargo/bin/tree-sitter'),
].filter(Boolean);

let systemTreeSitter;
for (const location of possibleLocations) {
  if (fs.existsSync(location)) {
    systemTreeSitter = location;
    break;
  }
}

if (!systemTreeSitter) {
  console.warn('Warning: tree-sitter not found in common locations');
  console.warn('  Install it with: cargo install tree-sitter-cli');
  console.warn("  Or ensure it's in your PATH");
  process.exit(0); // Don't fail the install, just warn
}

// Create symlink
try {
  fs.symlinkSync(systemTreeSitter, binaryPath);
  console.log(`Created symlink: ${binaryPath} -> ${systemTreeSitter}`);
} catch (error) {
  console.warn(`Warning: Could not create symlink: ${error.message}`);
  console.warn(
    '  You may need to run tree-sitter commands directly from your PATH'
  );
  process.exit(0); // Don't fail the install
}
