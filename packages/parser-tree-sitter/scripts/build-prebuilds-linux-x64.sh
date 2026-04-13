#!/usr/bin/env bash

# Copyright (c) 2026, Salesforce, Inc.
# All rights reserved.
# SPDX-License-Identifier: Apache-2.0
# For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
# Build linux-x64 prebuilds using Docker (required for CI).
# Run: pnpm run prebuild:linux-x64
# Requires Docker. Produces packages/parser-tree-sitter/prebuilds/linux-x64/
# Commit the new prebuilds/linux-x64/ folder after running.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

echo "Building linux-x64 prebuilds in Docker..."
docker run --rm --platform linux/amd64 \
  -v "$REPO_ROOT:/workspace" \
  -w /workspace \
  node:20 \
  bash -c '
    corepack enable && corepack prepare pnpm@latest --activate
    pnpm install
    cd packages/parser-tree-sitter && pnpm run prebuild
  '

echo ""
echo "Done. Prebuilds at packages/parser-tree-sitter/prebuilds/linux-x64/"
ls -la packages/parser-tree-sitter/prebuilds/linux-x64/
